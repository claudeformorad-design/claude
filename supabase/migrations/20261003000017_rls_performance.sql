-- =============================================================================
-- الترحيل 17: أداء سياسات أمان الصفوف (RLS) على الأحجام الكبيرة
--
-- المشكلة: السياسات بصيغة app.has_permission(hotel_id, 'x') تُقيَّم لكل صف على حدة؛
-- في فندق به عشرات آلاف سطور القيود يصبح ميزان المراجعة والمطابقة وقائمة القيود أبطأ
-- بعشرات المرات (قياس فعلي: المطابقة 1.6 ث، ميزان المراجعة 0.69 ث).
--
-- الحل (نفس الأمان حرفيًا): نحسب مرة واحدة لكل استعلام قائمة الفنادق التي يملك فيها
-- المستخدم الصلاحية، ونقارن hotel_id بها:
--     app.has_permission(hotel_id, 'x')   ⇔   hotel_id IN (SELECT app.permitted_hotels('x'))
--     app.is_hotel_member(hotel_id)       ⇔   hotel_id IN (SELECT app.member_hotels())
-- الاستعلام الفرعي غير مرتبط بالصف، فيُنفَّذ مرة واحدة (hashed subplan) بدل مرة لكل صف.
-- قيمة hotel_id الفارغة: الصيغتان تعطيان «لا وصول» (false / NULL).
-- =============================================================================

create or replace function app.permitted_hotels(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.hotel_id
  from public.hotel_members m
  join public.hotels h on h.id = m.hotel_id
  join public.user_hotel_roles uhr on uhr.hotel_id = m.hotel_id and uhr.user_id = m.user_id
  join public.role_permissions rp on rp.role_id = uhr.role_id
  where m.user_id = auth.uid()
    and m.is_active
    and h.is_active
    and rp.permission_code = p_permission;
$$;

create or replace function app.member_hotels()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.hotel_id
  from public.hotel_members m
  join public.hotels h on h.id = m.hotel_id
  where m.user_id = auth.uid()
    and m.is_active
    and h.is_active;
$$;

revoke execute on function app.permitted_hotels(text) from public, anon;
revoke execute on function app.member_hotels() from public, anon;
grant execute on function app.permitted_hotels(text) to authenticated;
grant execute on function app.member_hotels() to authenticated;

-- تأكد أن التعريفين مطابقان لـ has_permission / is_hotel_member (نفس الجداول والشروط)
do $$
begin
  if position('rp.permission_code = p_permission' in pg_get_functiondef('app.has_permission(uuid, text)'::regprocedure)) = 0 then
    raise exception 'app.has_permission changed; review app.permitted_hotels before applying';
  end if;
end $$;

-- إعادة كتابة كل السياسات في المخطط public التي تستخدم الصيغة المباشرة على عمود hotel_id
do $$
declare
  p record;
  v_qual text;
  v_check text;
  v_sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ 'app\.(has_permission|is_hotel_member)\(hotel_id'
        or coalesce(with_check, '') ~ 'app\.(has_permission|is_hotel_member)\(hotel_id')
  loop
    v_qual := regexp_replace(p.qual, 'app\.has_permission\(hotel_id, ''([^'']+)''::text\)',
                             '(hotel_id IN (SELECT app.permitted_hotels(''\1''::text)))', 'g');
    v_qual := regexp_replace(v_qual, 'app\.is_hotel_member\(hotel_id\)',
                             '(hotel_id IN (SELECT app.member_hotels()))', 'g');
    v_check := regexp_replace(p.with_check, 'app\.has_permission\(hotel_id, ''([^'']+)''::text\)',
                              '(hotel_id IN (SELECT app.permitted_hotels(''\1''::text)))', 'g');
    v_check := regexp_replace(v_check, 'app\.is_hotel_member\(hotel_id\)',
                              '(hotel_id IN (SELECT app.member_hotels()))', 'g');

    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
  end loop;

  -- لا يبقى أي استدعاء لكل صف على hotel_id
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'app\.(has_permission|is_hotel_member)\(hotel_id'
  ) then
    raise exception 'Some policies were not rewritten';
  end if;
end $$;

-- فهارس مساعدة لاستعلامات التقارير على الأحجام الكبيرة
create index if not exists je_hotel_status_date_idx on public.journal_entries (hotel_id, status, entry_date);
create index if not exists payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index if not exists payments_customer_only_idx on public.payments (customer_id) where customer_id is not null;
create index if not exists invoices_customer_only_idx on public.invoices (customer_id) where customer_id is not null;

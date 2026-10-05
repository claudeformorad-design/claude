-- =============================================================================
-- فورمات النظام (النسخة المنشورة): يمسح كل الفنادق وبياناتها وكل الحسابات عدا حساب صاحب النظام،
-- فيعود النظام جديدًا: صفر موظفين، صفر أدوار خاصة، صفر حركات. صاحب النظام يبقى مسجّلًا ويبدأ بإنشاء فندقه.
-- للمالك وحده، وبكلمة تأكيد مكتوبة. القيود المرحّلة وسجل التدقيق محميان من الحذف بالتريغرات،
-- فيُمسحان هنا فقط داخل هذه الدالة بتعطيل التريغرات مؤقتًا في نفس المعاملة.
-- =============================================================================

create or replace function public.factory_reset(p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  t record;
begin
  if v_owner is null or not app.is_owner(v_owner) then
    raise exception 'Only the system owner can format the system' using errcode = '42501';
  end if;
  if coalesce(trim(p_confirm), '') <> 'فورمات' then
    raise exception 'Type the confirmation word to format the system' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('nazeel.factory_reset'));

  -- 1) بيانات الفنادق: كل جدول فيه hotel_id (الأدوار الأساسية بلا فندق تبقى)
  perform set_config('session_replication_role', 'replica', true);
  delete from public.role_permissions where role_id in (select id from public.roles where hotel_id is not null);
  delete from public.assistant_messages;
  for t in
    select n.nspname as s, c.relname as r
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'hotel_id' and not a.attisdropped
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'app')
  loop
    execute format('delete from %I.%I where hotel_id is not null', t.s, t.r);
  end loop;
  delete from public.hotels;
  delete from app.temp_passwords;
  delete from public.users_profiles where id <> v_owner;
  update public.users_profiles set updated_by = null where id = v_owner;
  perform set_config('session_replication_role', 'origin', true);

  -- 2) الحسابات: يبقى صاحب النظام وحده (حذف الحساب يحذف جلساته وهوياته وملفه)
  delete from auth.users where id <> v_owner;
  perform set_config('app.password_flag', 'on', true);
  update public.users_profiles set default_hotel_id = null, is_active = true where id = v_owner;
  perform set_config('app.password_flag', 'off', true);
end;
$$;

revoke all on function public.factory_reset(text) from public, anon;
grant execute on function public.factory_reset(text) to authenticated;

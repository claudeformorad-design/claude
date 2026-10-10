-- =============================================================================
-- اختبارات الترحيل 17: سياسات RLS المحسّنة للأداء تحافظ على نفس الأمان حرفيًا
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008a1', 'gm-a@hotel.test'),
  ('00000000-0000-0000-0000-0000000008b1', 'gm-b@hotel.test'),
  ('00000000-0000-0000-0000-0000000008a2', 'cashier-a@hotel.test');

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  if p_user is null then reset role; else set role authenticated; end if;
end $$;

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

-- فندقان منفصلان، لكل منهما قيد وفوليو
select pg_temp.act_as('00000000-0000-0000-0000-0000000008a1');
insert into ids select 'ha', public.create_hotel('فندق أ', 'SA', 'SAR');
select pg_temp.act_as('00000000-0000-0000-0000-0000000008b1');
insert into ids select 'hb', public.create_hotel('فندق ب', 'SA', 'SAR');

select pg_temp.act_as(null);
insert into ids select 'acc_' || h.k || '_' || a.code, a.id
from public.chart_of_accounts a join ids h on h.v = a.hotel_id and h.k in ('ha', 'hb') where a.code in ('1103', '3101');
-- كاشير في الفندق أ (يرى الفوليو ولا يرى القيود)
insert into public.hotel_members (hotel_id, user_id) select v, '00000000-0000-0000-0000-0000000008a2' from ids where k = 'ha';
insert into public.user_hotel_roles (hotel_id, user_id, role_id)
select (select v from ids where k = 'ha'), '00000000-0000-0000-0000-0000000008a2', id from public.roles where is_system and code = 'cashier';

select pg_temp.act_as('00000000-0000-0000-0000-0000000008a1');
select public.save_journal_entry((select v from ids where k = 'ha'), current_date, 'رأس مال أ',
  jsonb_build_array(jsonb_build_object('account_id', (select v from ids where k = 'acc_ha_1103'), 'debit', 100),
                    jsonb_build_object('account_id', (select v from ids where k = 'acc_ha_3101'), 'credit', 100)), null, null, 1, null, true);
select public.open_folio((select v from ids where k = 'ha'), 'نزيل أ');
select pg_temp.act_as('00000000-0000-0000-0000-0000000008b1');
select public.save_journal_entry((select v from ids where k = 'hb'), current_date, 'رأس مال ب',
  jsonb_build_array(jsonb_build_object('account_id', (select v from ids where k = 'acc_hb_1103'), 'debit', 200),
                    jsonb_build_object('account_id', (select v from ids where k = 'acc_hb_3101'), 'credit', 200)), null, null, 1, null, true);
select public.open_folio((select v from ids where k = 'hb'), 'نزيل ب');

-- عزل الفنادق: كل مدير يرى فندقه فقط
select pg_temp.act_as('00000000-0000-0000-0000-0000000008a1');
do $$ begin
  assert (select count(*) from public.hotels) = 1, 'GM A sees only hotel A';
  assert (select count(*) from public.journal_entries) = 1, 'GM A sees only its journal entries';
  assert (select count(*) from public.journal_entry_lines) = 2, 'GM A sees only its lines';
  assert (select count(*) from public.guest_folios) = 1, 'GM A sees only its folios';
  assert not exists (select 1 from public.journal_entries where hotel_id = (select v from ids where k = 'hb')), 'no hotel B rows';
  assert (select count(*) from app.permitted_hotels('gl.journal.view')) = 1, 'permitted hotels';
end $$;

-- لا يستطيع الكتابة في فندق آخر
select pg_temp.act_as('00000000-0000-0000-0000-0000000008b1');
do $$ begin
  begin
    insert into public.customers (hotel_id, code, name_ar) values ((select v from ids where k = 'ha'), 'X', 'تسلل');
    raise exception 'cross-hotel insert should fail';
  exception when insufficient_privilege then null;
  end;
  update public.guest_folios set notes = 'x' where hotel_id = (select v from ids where k = 'ha');
  assert not found, 'cross-hotel update affects nothing';
end $$;

-- الكاشير: يرى الفوليو ولا يرى القيود (الصلاحية لا مجرد العضوية)
select pg_temp.act_as('00000000-0000-0000-0000-0000000008a2');
do $$ begin
  assert (select count(*) from public.guest_folios) = 1, 'cashier sees folios';
  assert (select count(*) from public.journal_entries) = 0, 'cashier cannot see journal entries';
  assert (select count(*) from public.journal_entry_lines) = 0, 'cashier cannot see lines';
  assert (select count(*) from app.permitted_hotels('gl.journal.view')) = 0, 'no journal permission';
end $$;

-- عضو معطّل يفقد الوصول فورًا
select pg_temp.act_as(null);
update public.hotel_members set is_active = false where user_id = '00000000-0000-0000-0000-0000000008a2';
select pg_temp.act_as('00000000-0000-0000-0000-0000000008a2');
do $$ begin
  assert (select count(*) from public.guest_folios) = 0, 'inactive member sees nothing';
end $$;

-- لا تبقى سياسات تستدعي فحص الصلاحية لكل صف على hotel_id
select pg_temp.act_as(null);
do $$ begin
  assert not exists (
    select 1 from pg_policies where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'app\.(has_permission|is_hotel_member)\(hotel_id'
  ), 'all hotel policies use the set-based form';
end $$;

\o
\echo '  ✓ RLS performance rewrite keeps identical security'

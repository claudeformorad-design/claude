-- =============================================================================
-- اختبارات الترحيل 35: فورمات النظام للمالك وحده، ويعود النظام جديدًا
-- (آخر ملف اختبار: يمسح كل الفنادق والحسابات عدا المالك)
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

create or replace function pg_temp.expect_error(p_sql text, p_contains text)
returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(p_contains in sqlerrm) = 0 then raise exception 'Expected "%", got "%"', p_contains, sqlerrm; end if;
    return;
  end;
  raise exception 'Expected error "%", but succeeded: %', p_contains, p_sql;
end $$;
create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  if p_user is null then reset role; else set role authenticated; end if;
end $$;
create temp table v (k text primary key, j jsonb);
grant all on v to anon, authenticated;
create or replace function pg_temp.uid(p_key text) returns uuid language sql as $$
  select coalesce((select (j ->> 'user_id')::uuid from v where k = p_key), (select (j #>> '{}')::uuid from v where k = p_key));
$$;

insert into v select 'owner', to_jsonb(app.new_account('owner22@test.local', 'مالك الفورمات')::text);
insert into app.system_settings (key, value) values ('owner_user', (select j #>> '{}' from v where k = 'owner'))
  on conflict (key) do update set value = excluded.value;
select pg_temp.act_as(pg_temp.uid('owner'));
create temp table h22 as select public.create_hotel('فندق الفورمات', 'YE', 'YER') as id;
reset role;
grant all on h22 to anon, authenticated;
select pg_temp.act_as(pg_temp.uid('owner'));
insert into v select 'emp', public.add_staff_member((select id from h22), 'موظف', array[(select id from public.roles where is_system and code = 'general_manager')]);
insert into public.roles (hotel_id, code, name_ar, name_en, is_system) values ((select id from h22), 'night_desk', 'استقبال ليلي', 'Night desk', false);
reset role;
do $$ begin
  assert exists (select 1 from public.audit_logs where hotel_id = (select id from h22)), 'audit rows exist';
  assert exists (select 1 from public.chart_of_accounts where hotel_id = (select id from h22)), 'accounts exist';
end $$;

-- الموظف (حتى بصلاحيات المدير العام) لا يفرمت، والمالك يحتاج كلمة التأكيد
select pg_temp.act_as(pg_temp.uid('emp'));
select pg_temp.expect_error($q$ select public.factory_reset('فورمات') $q$, 'Only the system owner');
reset role;
set role anon;
select pg_temp.expect_error($q$ select public.factory_reset('فورمات') $q$, 'permission denied');
reset role;
select pg_temp.act_as(pg_temp.uid('owner'));
select pg_temp.expect_error($q$ select public.factory_reset('yes') $q$, 'confirmation word');
select public.factory_reset('فورمات');
reset role;

do $$ begin
  assert not exists (select 1 from public.hotels), 'no hotels';
  assert not exists (select 1 from public.hotel_members), 'no members';
  assert not exists (select 1 from public.audit_logs where hotel_id is not null), 'audit cleared';
  assert not exists (select 1 from public.journal_entries), 'no journal entries';
  assert not exists (select 1 from public.roles where hotel_id is not null), 'custom roles removed';
  assert exists (select 1 from public.roles where is_system and code = 'general_manager'), 'system roles kept';
  assert exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.code = 'general_manager'), 'system role permissions kept';
  assert (select count(*) from auth.users) = 1, 'only the owner account remains';
  assert exists (select 1 from auth.users where id = pg_temp.uid('owner')), 'owner kept';
  assert app.is_owner(pg_temp.uid('owner')), 'still the owner';
  assert current_setting('session_replication_role') = 'origin', 'triggers back on';
end $$;

-- النظام يعمل من جديد: المالك ينشئ فندقًا جديدًا
select pg_temp.act_as(pg_temp.uid('owner'));
select public.create_hotel('فندق جديد', 'YE', 'YER');
reset role;
do $$ begin assert (select count(*) from public.hotels) = 1, 'new hotel created'; end $$;
-- الحراسة ما زالت تعمل بعد الفورمات: القيد المرحّل لا يُحذف
select pg_temp.expect_error($q$ delete from public.audit_logs $q$, '');

\o
select 'factory reset tests passed';

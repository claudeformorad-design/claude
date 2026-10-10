-- =============================================================================
-- اختبارات الترحيل 34: إيقاف الموظف وإعادته، حذفه من الفندق، حالة روابط الدخول
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

-- مالك جديد لهذا الاختبار (الاختبارات على PostgreSQL تتشارك قاعدة واحدة)
insert into v select 'owner', to_jsonb(app.new_account('owner21@test.local', 'مالك الاختبار')::text);
insert into app.system_settings (key, value) values ('owner_user', (select j #>> '{}' from v where k = 'owner'))
  on conflict (key) do update set value = excluded.value;
select pg_temp.act_as(pg_temp.uid('owner'));
create temp table h21 as select public.create_hotel('فندق الإدارة', 'YE', 'YER') as id;
reset role;
grant all on h21 to anon, authenticated;

select pg_temp.act_as(pg_temp.uid('owner'));
insert into v select 'a', public.add_staff_member((select id from h21), 'أحمد', array[(select id from public.roles where is_system and code = 'receptionist')]);
insert into v select 'b', public.add_staff_member((select id from h21), 'بدر', array[(select id from public.roles where is_system and code = 'receptionist')]);
reset role;

-- 1) حالة الروابط: لم يدخل أحد بعد، ولكل منهما رابط ساري
select pg_temp.act_as(pg_temp.uid('owner'));
do $$ begin
  assert (select not joined and link_expires_at > now() from public.staff_link_status((select id from h21)) where user_id = pg_temp.uid('a')), 'a pending';
end $$;
reset role;
set role anon;
insert into v select 'a_login', public.redeem_access_link((select j ->> 'token' from v where k = 'a'));
select pg_temp.expect_error($q$ select * from public.staff_link_status((select id from h21)) $q$, 'permission denied');
reset role;
select pg_temp.act_as(pg_temp.uid('owner'));
do $$ begin
  assert (select joined and link_expires_at is null from public.staff_link_status((select id from h21)) where user_id = pg_temp.uid('a')), 'a joined';
end $$;
reset role;

-- 2) الإيقاف: يخرج من أجهزته، ورابطه غير المستخدم يسقط، ولا يرى بيانات الفندق
insert into auth.sessions (user_id) values (pg_temp.uid('a'));
select pg_temp.act_as(pg_temp.uid('owner'));
insert into v select 'a_link', to_jsonb(public.create_access_link((select id from h21), pg_temp.uid('a')));
select public.set_staff_active((select id from h21), pg_temp.uid('a'), false);
reset role;
do $$ begin
  assert not (select is_active from public.hotel_members where hotel_id = (select id from h21) and user_id = pg_temp.uid('a')), 'suspended';
  assert not exists (select 1 from auth.sessions where user_id = pg_temp.uid('a')), 'sessions ended';
  assert not exists (select 1 from app.access_links where user_id = pg_temp.uid('a') and used_at is null), 'unused links dropped';
end $$;
select pg_temp.act_as(pg_temp.uid('a'));
do $$ begin assert not app.is_hotel_member((select id from h21)), 'suspended has no access'; end $$;
select pg_temp.expect_error($q$ select public.set_staff_active((select id from h21), pg_temp.uid('b'), false) $q$, 'Permission denied');
reset role;
-- إعادة التفعيل
select pg_temp.act_as(pg_temp.uid('owner'));
select public.set_staff_active((select id from h21), pg_temp.uid('a'), true);
reset role;
select pg_temp.act_as(pg_temp.uid('a'));
do $$ begin assert app.is_hotel_member((select id from h21)), 'resumed'; end $$;
-- الموظف لا يحذف زميله
select pg_temp.expect_error($q$ select public.remove_staff_member((select id from h21), pg_temp.uid('b')) $q$, 'Permission denied');
reset role;

-- 3) الحذف: تسقط العضوية والأدوار والروابط، ويُغلق الحساب الذي لم يبق له فندق
select pg_temp.act_as(pg_temp.uid('owner'));
insert into v select 'closed', to_jsonb(public.remove_staff_member((select id from h21), pg_temp.uid('a')));
-- المالك لا يُدار من هنا، ولا يحذف نفسه
select pg_temp.expect_error($q$ select public.remove_staff_member((select id from h21), pg_temp.uid('owner')) $q$, 'own account');
select pg_temp.expect_error($q$ select public.remove_staff_member((select id from h21), pg_temp.uid('a')) $q$, 'not in this hotel');
reset role;
do $$ begin
  assert (select j::boolean from v where k = 'closed'), 'account closed';
  assert not exists (select 1 from public.hotel_members where user_id = pg_temp.uid('a')), 'membership removed';
  assert not exists (select 1 from public.user_hotel_roles where user_id = pg_temp.uid('a')), 'roles removed';
  assert not exists (select 1 from app.access_links where user_id = pg_temp.uid('a')), 'links removed';
  assert not (select is_active from public.users_profiles where id = pg_temp.uid('a')), 'profile closed';
  assert not (select encrypted_password = extensions.crypt((select j ->> 'password' from v where k = 'a_login'), encrypted_password)
              from auth.users where id = pg_temp.uid('a')), 'old login no longer works';
  -- الحساب يبقى لحفظ اسمه على المستندات السابقة
  assert exists (select 1 from auth.users where id = pg_temp.uid('a')), 'account kept for history';
end $$;
-- رابط بدر ما زال يعمل، والمحذوف لا يُعطى رابطًا
set role anon;
select public.redeem_access_link((select j ->> 'token' from v where k = 'b'));
reset role;
select pg_temp.act_as(pg_temp.uid('owner'));
select pg_temp.expect_error($q$ select public.create_access_link((select id from h21), pg_temp.uid('a')) $q$, 'not in this hotel');
reset role;
set role anon;
select pg_temp.expect_error($q$ select public.remove_staff_member((select id from h21), pg_temp.uid('b')) $q$, 'permission denied');
reset role;

\o
select 'staff management tests passed';

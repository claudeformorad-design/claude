-- =============================================================================
-- اختبارات الترحيل 33: «ابدأ» لصاحب النظام مرة واحدة، روابط دخول الموظفين لمرة واحدة، كلمة المرور الاختيارية
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

-- إعدادات نظيفة (الاختبارات على PostgreSQL تتشارك قاعدة واحدة)
delete from app.system_settings;
-- 1) أول زائر يضغط «ابدأ» فيصبح المالك، ثم يُغلق الباب
set role anon;
do $$ begin assert not public.system_has_owner(), 'no owner yet'; end $$;
insert into v select 'owner', public.claim_owner();
-- قبل أن يضع المالك كلمة مرور يبقى «ابدأ» متاحًا ويعيد الدخول لنفس الحساب
do $$ begin assert not public.system_has_owner(), 'still open until a password is chosen'; end $$;
insert into v select 'owner_again', public.claim_owner();
-- الزائر لا يرى الإعدادات ولا ينشئ حسابات مباشرة
select pg_temp.expect_error($q$ select * from app.access_links $q$, 'permission denied');
reset role;
do $$ begin
  assert (select j ->> 'email' from v where k = 'owner_again') = 'admin@nazeel.local', 'same owner account';
  assert (select count(*) from auth.users where email = 'admin@nazeel.local') = 1, 'no second owner';
  -- الدخول الجديد يلغي كلمة الدخول السابقة
  assert not (select encrypted_password = extensions.crypt((select j ->> 'password' from v where k = 'owner'), encrypted_password)
              from auth.users where email = 'admin@nazeel.local'), 'old login replaced';
  update v set j = (select j from v where k = 'owner_again') where k = 'owner';
  assert (select j ->> 'email' from v where k = 'owner') = 'admin@nazeel.local', 'owner login email';
  assert (select encrypted_password = extensions.crypt((select j ->> 'password' from v where k = 'owner'), encrypted_password)
          from auth.users where email = 'admin@nazeel.local'), 'issued password works';
  assert app.invite_only(), 'sign-up closed after claim';
end $$;
select pg_temp.expect_error($q$ insert into auth.users (id, email) values (gen_random_uuid(), 'x@evil.test') $q$, 'invitation only');

-- بعد أن يختار المالك كلمة مرور يُغلق الباب نهائيًا
select pg_temp.act_as((select id from auth.users where email = 'admin@nazeel.local'));
select public.confirm_password_changed();
reset role;
set role anon;
do $$ begin assert public.system_has_owner(), 'closed after password'; end $$;
select pg_temp.expect_error($q$ select public.claim_owner() $q$, 'already has an owner');
reset role;

-- المالك ينشئ الفندق ويضيف موظفًا بالاسم والدور، فيحصل على رابط
insert into v select 'owner_id', to_jsonb(id::text) from auth.users where email = 'admin@nazeel.local';
select pg_temp.act_as((select (j #>> '{}')::uuid from v where k = 'owner_id'));
create temp table h20 as select public.create_hotel('فندق الروابط', 'YE', 'YER') as id;
reset role;
grant all on h20 to anon, authenticated;
select pg_temp.act_as((select (j #>> '{}')::uuid from v where k = 'owner_id'));
select pg_temp.expect_error($q$ select public.add_staff_member((select id from h20), 'x', '{}') $q$, 'Write the employee name');
insert into v select 'emp', public.add_staff_member((select id from h20), 'سارة', array[(select id from public.roles where is_system and code = 'receptionist')]);
reset role;
do $$ begin
  assert (select j ->> 'username' from v where k = 'emp') ~ '^staff[0-9]{5}$', 'auto username';
  assert length((select j ->> 'token' from v where k = 'emp')) = 64, 'token 256-bit';
  assert not exists (select 1 from app.access_links where token_hash = (select j ->> 'token' from v where k = 'emp')), 'only hash stored';
end $$;

-- 2) فتح الرابط: يعمل مرة واحدة فقط
set role anon;
select pg_temp.expect_error($q$ select public.redeem_access_link('wrong') $q$, 'no longer valid');
insert into v select 'login', public.redeem_access_link((select j ->> 'token' from v where k = 'emp'));
select pg_temp.expect_error($q$ select public.redeem_access_link((select j ->> 'token' from v where k = 'emp')) $q$, 'no longer valid');
reset role;
do $$ begin
  assert (select j ->> 'email' from v where k = 'login') = (select j ->> 'username' from v where k = 'emp') || '@nazeel.local', 'login for employee';
end $$;

-- رابط جديد يلغي السابق غير المستخدم، والرابط المنتهي لا يعمل
select pg_temp.act_as((select (j #>> '{}')::uuid from v where k = 'owner_id'));
insert into v select 'l1', to_jsonb(public.create_access_link((select id from h20), (select (j ->> 'user_id')::uuid from v where k = 'emp')));
insert into v select 'l2', to_jsonb(public.create_access_link((select id from h20), (select (j ->> 'user_id')::uuid from v where k = 'emp')));
reset role;
set role anon;
select pg_temp.expect_error($q$ select public.redeem_access_link((select j #>> '{}' from v where k = 'l1')) $q$, 'no longer valid');
reset role;
update app.access_links set expires_at = now() - interval '1 minute' where used_at is null;
set role anon;
select pg_temp.expect_error($q$ select public.redeem_access_link((select j #>> '{}' from v where k = 'l2')) $q$, 'no longer valid');
reset role;

-- الموظف الموقوف لا يدخل برابطه
select pg_temp.act_as((select (j #>> '{}')::uuid from v where k = 'owner_id'));
insert into v select 'l3', to_jsonb(public.create_access_link((select id from h20), (select (j ->> 'user_id')::uuid from v where k = 'emp')));
reset role;
update public.hotel_members set is_active = false where user_id = (select (j ->> 'user_id')::uuid from v where k = 'emp');
set role anon;
select pg_temp.expect_error($q$ select public.redeem_access_link((select j #>> '{}' from v where k = 'l3')) $q$, 'no longer valid');
reset role;
update public.hotel_members set is_active = true where user_id = (select (j ->> 'user_id')::uuid from v where k = 'emp');

-- الموظف لا ينشئ روابط، ولا أحد ينشئ رابطًا لحساب المالك
select pg_temp.act_as((select (j ->> 'user_id')::uuid from v where k = 'emp'));
select pg_temp.expect_error($q$ select public.create_access_link((select id from h20), (select (j #>> '{}')::uuid from v where k = 'owner_id')) $q$, 'Permission denied');
select pg_temp.expect_error($q$ select public.add_staff_member((select id from h20), 'دخيل', '{}') $q$, 'Permission denied');
-- 3) كلمة المرور الاختيارية: العلامة لا يغيّرها المستخدم بنفسه
select pg_temp.expect_error($q$ update public.users_profiles set password_chosen = true where id = auth.uid() $q$, 'permission denied');
select public.confirm_password_changed();
reset role;
do $$ begin
  assert (select password_chosen from public.users_profiles where id = (select (j ->> 'user_id')::uuid from v where k = 'emp')), 'password chosen';
end $$;
-- الموظف لا ينشئ فندقًا
select pg_temp.act_as((select (j ->> 'user_id')::uuid from v where k = 'emp'));
select pg_temp.expect_error($q$ select public.create_hotel('دخيل', 'YE', 'YER') $q$, 'Only the system owner');
reset role;

\o
select 'passwordless access tests passed';

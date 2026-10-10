-- =============================================================================
-- اختبارات الترحيل 32: التسجيل بالدعوة فقط، إنشاء الفنادق لصاحب النظام، حسابات الموظفين بكلمة مؤقتة،
-- إعادة التعيين والإخراج من الأجهزة بحراستها، وتضييق ملف المستخدم والزائر غير المسجّل
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

-- الوضع المفتوح (الافتراضي، والتثبيت المحلي): التسجيل مسموح
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001901', 'free@hotel.test');

-- تفعيل الدعوة فقط
insert into app.system_settings (key, value) values ('signup_mode', 'invite'), ('owner_email', 'Owner@Hotel.test');
select pg_temp.expect_error($q$ insert into auth.users (id, email) values (gen_random_uuid(), 'stranger@evil.test') $q$, 'invitation only');
-- صاحب النظام وحده يسجّل (البريد بلا حساسية للأحرف)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001902', 'owner@hotel.test');

-- صاحب حساب سابق ليس مالكًا: لا ينشئ فندقًا
select pg_temp.act_as('00000000-0000-0000-0000-000000001901');
select pg_temp.expect_error($q$ select public.create_hotel('فندق دخيل', 'YE', 'YER') $q$, 'Only the system owner');

select pg_temp.act_as('00000000-0000-0000-0000-000000001902');
create temp table h19 as select public.create_hotel('فندق الأمان', 'YE', 'YER') as id;
create temp table ids (k text primary key, v uuid);
grant all on h19, ids to authenticated;
insert into ids select 'recep', id from public.roles where is_system and code = 'receptionist';
insert into ids select 'gm', id from public.roles where is_system and code = 'general_manager';

-- إنشاء حساب موظف: تحقق الحقول ثم الإنشاء
select pg_temp.expect_error($q$ select public.create_staff_account((select id from h19), 'أحمد', 'A!', 'Passw0rd', array[(select v from ids where k = 'recep')]) $q$, 'Username must be');
select pg_temp.expect_error($q$ select public.create_staff_account((select id from h19), 'أحمد', 'ahmed', 'short1', array[(select v from ids where k = 'recep')]) $q$, 'at least 8 characters');
select pg_temp.expect_error($q$ select public.create_staff_account((select id from h19), 'أحمد', 'ahmed', 'onlyletters', array[(select v from ids where k = 'recep')]) $q$, 'at least 8 characters');
insert into ids select 'ahmed', public.create_staff_account((select id from h19), 'أحمد علي', 'Ahmed', 'Temp1234', array[(select v from ids where k = 'recep')]);
select pg_temp.expect_error($q$ select public.create_staff_account((select id from h19), 'آخر', 'ahmed', 'Temp1234', array[(select v from ids where k = 'recep')]) $q$, 'already taken');

reset role;
do $$ begin
  assert (select email = 'ahmed@nazeel.local' and email_confirmed_at is not null and aud = 'authenticated' and role = 'authenticated'
            and encrypted_password = extensions.crypt('Temp1234', encrypted_password)
          from auth.users where id = (select v from ids where k = 'ahmed')), 'staff auth user with bcrypt hash';
  assert exists (select 1 from auth.identities where user_id = (select v from ids where k = 'ahmed') and provider = 'email'), 'identity row';
  assert (select must_change_password and full_name = 'أحمد علي' from public.users_profiles where id = (select v from ids where k = 'ahmed')), 'must change on first login';
  assert exists (select 1 from public.user_hotel_roles where user_id = (select v from ids where k = 'ahmed') and role_id = (select v from ids where k = 'recep')), 'role granted';
end $$;

-- الموظف لا يرفع علامة «يجب التغيير» بنفسه، ولا يغيّر بريده أو تفعيله من ملفه
select pg_temp.act_as((select v from ids where k = 'ahmed'));
select pg_temp.expect_error($q$ update public.users_profiles set must_change_password = false where id = auth.uid() $q$, 'permission denied');
select pg_temp.expect_error($q$ update public.users_profiles set is_active = false where id = auth.uid() $q$, 'permission denied');
select pg_temp.expect_error($q$ update public.users_profiles set email = 'x@y.z' where id = auth.uid() $q$, 'permission denied');
update public.users_profiles set full_name = 'أحمد علي سالم', preferred_locale = 'en' where id = auth.uid();
-- «التغيير» دون تغيير الكلمة المؤقتة فعلًا مرفوض
select pg_temp.expect_error($q$ select public.confirm_password_changed() $q$, 'different from the temporary');
-- الموظف لا ينشئ حسابات ولا يعيد كلمات المرور
select pg_temp.expect_error($q$ select public.create_staff_account((select id from h19), 'س', 'sami', 'Temp1234', '{}') $q$, 'Permission denied');
select pg_temp.expect_error($q$ select public.reset_staff_password((select id from h19), (select v from ids where k = 'ahmed'), 'Other123') $q$, 'Permission denied');
-- لا يصل إلى إعدادات النظام ولا البصمات المؤقتة
select pg_temp.expect_error($q$ select * from app.system_settings $q$, 'permission denied');
select pg_temp.expect_error($q$ select * from app.temp_passwords $q$, 'permission denied');
select pg_temp.expect_error($q$ select app.set_temp_password(auth.uid(), 'Hack1234') $q$, 'permission denied');

-- بعد تغيير الكلمة (كما يفعل Supabase Auth) تُرفع العلامة
reset role;
update auth.users set encrypted_password = extensions.crypt('Mine5678', extensions.gen_salt('bf', 4)) where id = (select v from ids where k = 'ahmed');
select pg_temp.act_as((select v from ids where k = 'ahmed'));
select public.confirm_password_changed();
reset role;
do $$ begin
  assert not (select must_change_password from public.users_profiles where id = (select v from ids where k = 'ahmed')), 'flag cleared';
  assert not exists (select 1 from app.temp_passwords where user_id = (select v from ids where k = 'ahmed')), 'temp hash removed';
end $$;

-- إعادة التعيين: كلمة مؤقتة جديدة وإخراج من الأجهزة
insert into auth.sessions (user_id) values ((select v from ids where k = 'ahmed'));
select pg_temp.act_as('00000000-0000-0000-0000-000000001902');
select pg_temp.expect_error($q$ select public.reset_staff_password((select id from h19), (select v from ids where k = 'ahmed'), 'weak') $q$, 'at least 8 characters');
select public.reset_staff_password((select id from h19), (select v from ids where k = 'ahmed'), 'Reset123');
reset role;
do $$ begin
  assert (select must_change_password from public.users_profiles where id = (select v from ids where k = 'ahmed')), 'must change again';
  assert not exists (select 1 from auth.sessions where user_id = (select v from ids where k = 'ahmed')), 'sessions ended';
end $$;

-- لا يدير المدير حسابه بنفسه من هنا، ولا حساب صاحب النظام، ولا حسابات البريد الحقيقي
select pg_temp.act_as('00000000-0000-0000-0000-000000001902');
select pg_temp.expect_error($q$ select public.end_staff_sessions((select id from h19), '00000000-0000-0000-0000-000000001902') $q$, 'your own account');
insert into ids select 'gm2', public.create_staff_account((select id from h19), 'مدير ثان', 'gm2', 'Temp1234', array[(select v from ids where k = 'gm')]);
reset role;
update auth.users set encrypted_password = extensions.crypt('Gm2pass99', extensions.gen_salt('bf', 4)) where id = (select v from ids where k = 'gm2');
select pg_temp.act_as((select v from ids where k = 'gm2'));
select public.confirm_password_changed();
select pg_temp.expect_error($q$ select public.reset_staff_password((select id from h19), '00000000-0000-0000-0000-000000001902', 'Takeover1') $q$, 'system owner');
select pg_temp.expect_error($q$ select public.end_staff_sessions((select id from h19), '00000000-0000-0000-0000-000000001902') $q$, 'system owner');
-- مدير ثان لا يملك كل صلاحيات صاحب النظام؟ يملكها (دور المدير العام)، لكن الحماية بالبريد تكفي. وحساب بريد حقيقي غير المالك:
select public.add_hotel_member((select id from h19), 'free@hotel.test', array[(select v from ids where k = 'recep')]);
select pg_temp.expect_error($q$ select public.reset_staff_password((select id from h19), '00000000-0000-0000-0000-000000001901', 'Takeover1') $q$, 'Only staff accounts');
-- الموظف الأقل صلاحية لا يدير مديرًا
select pg_temp.act_as((select v from ids where k = 'ahmed'));
select pg_temp.expect_error($q$ select public.end_staff_sessions((select id from h19), (select v from ids where k = 'gm2')) $q$, 'Permission denied');

-- مدير فندق آخر لا يعيد كلمة موظف هذا الفندق حتى لو أضافه لفندقه
reset role;
delete from app.system_settings where key = 'signup_mode';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001903', 'other-gm@hotel.test');
select pg_temp.act_as('00000000-0000-0000-0000-000000001903');
create temp table h19b as select public.create_hotel('فندق آخر', 'YE', 'YER') as id;
reset role;
grant all on h19b to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-000000001903');
select public.add_hotel_member((select id from h19b), 'ahmed@nazeel.local', array[(select id from public.roles where is_system and code = 'receptionist')]);
select pg_temp.expect_error($q$ select public.reset_staff_password((select id from h19b), (select v from ids where k = 'ahmed'), 'Takeover1') $q$, 'permissions you do not have');
select pg_temp.expect_error($q$ select public.end_staff_sessions((select id from h19b), (select v from ids where k = 'ahmed')) $q$, 'permissions you do not have');

-- الزائر غير المسجّل: لا جداول ولا دوال
reset role;
set role anon;
select pg_temp.expect_error($q$ select count(*) from public.hotels $q$, 'permission denied');
select pg_temp.expect_error($q$ select count(*) from public.users_profiles $q$, 'permission denied');
select pg_temp.expect_error($q$ select public.create_hotel('x', 'YE', 'YER') $q$, 'permission denied');
select pg_temp.expect_error($q$ select public.create_staff_account(gen_random_uuid(), 'x', 'xyz', 'Temp1234', '{}') $q$, 'permission denied');
reset role;

\o
select 'account security tests passed';

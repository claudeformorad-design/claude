-- =============================================================================
-- أمان الحسابات (للنسخة المنشورة على Supabase، ولا يغيّر شيئًا في التثبيت المحلي ما لم يُفعَّل):
--   1) التسجيل بالدعوة فقط: عند تفعيل signup_mode = 'invite' ترفض قاعدة البيانات نفسها أي حساب جديد
--      إلا بريد صاحب النظام، أو حساب موظف ينشئه المدير من داخل النظام. استدعاء واجهة التسجيل
--      مباشرة لا يتجاوز هذا الشرط لأنه في تريغر على auth.users.
--   2) إنشاء الفنادق لصاحب النظام فقط في هذا الوضع.
--   3) حسابات الموظفين باسم مستخدم وكلمة مرور مؤقتة يضعها المدير، ويُلزم الموظف بتغييرها عند أول دخول
--      (ولا يُقبل «تغييرها» إلى نفس الكلمة المؤقتة). إعادة تعيين كلمة المرور وإخراج الموظف من أجهزته.
--   4) تضييق الصلاحيات: المستخدم يعدّل اسمه ولغته وهاتفه وفندقه الافتراضي فقط من ملفه،
--      والزائر غير المسجّل لا يصل إلى أي جدول أو دالة سوى استبيان النزيل برمزه.
-- الإعدادات (signup_mode و owner_email) تُضبط على المشروع نفسه ولا تُكتب في الترحيلات.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists app.system_settings (
  key    text primary key,
  value  text not null
);
revoke all on app.system_settings from public;
do $$ begin
  execute 'revoke all on app.system_settings from anon, authenticated';
end $$;

create or replace function app.setting(p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select value from app.system_settings where key = p_key;
$$;

create or replace function app.invite_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.setting('signup_mode'), 'open') = 'invite';
$$;

-- -----------------------------------------------------------------------------
-- 1) لا حساب جديد إلا لصاحب النظام أو بإنشاء المدير
-- -----------------------------------------------------------------------------
create or replace function app.guard_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.invite_only() then return new; end if;
  if current_setting('app.creating_staff', true) = 'on' then return new; end if;
  if nullif(app.setting('owner_email'), '') is not null and lower(new.email) = lower(app.setting('owner_email')) then
    return new;
  end if;
  raise exception 'Sign-up is by invitation only' using errcode = '42501';
end;
$$;
create trigger auth_users_guard_signup before insert on auth.users for each row execute function app.guard_signup();

-- -----------------------------------------------------------------------------
-- 2) إنشاء الفنادق لصاحب النظام فقط
-- -----------------------------------------------------------------------------
create or replace function app.guard_hotel_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.invite_only() and auth.uid() is not null and not exists (
    select 1 from auth.users u where u.id = auth.uid() and lower(u.email) = lower(coalesce(app.setting('owner_email'), ''))
  ) then
    raise exception 'Only the system owner can create hotels' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger hotels_guard_creation before insert on public.hotels for each row execute function app.guard_hotel_creation();

-- -----------------------------------------------------------------------------
-- 3) حسابات الموظفين
-- -----------------------------------------------------------------------------
alter table public.users_profiles add column if not exists must_change_password boolean not null default false;

-- البصمة المؤقتة: يُعرف بها أن الموظف غيّر كلمة المدير فعلًا
create table if not exists app.temp_passwords (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  hash     text not null,
  set_by   uuid,
  set_at   timestamptz not null default now()
);
revoke all on app.temp_passwords from public;
do $$ begin
  execute 'revoke all on app.temp_passwords from anon, authenticated';
end $$;

-- علامة «يجب تغيير كلمة المرور» لا يغيّرها المستخدم بنفسه
create or replace function app.guard_password_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.must_change_password is distinct from old.must_change_password
     and auth.uid() is not null and current_setting('app.password_flag', true) is distinct from 'on' then
    raise exception 'must_change_password is maintained by the system and cannot be changed directly' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger users_profiles_guard_password_flag before update on public.users_profiles
  for each row execute function app.guard_password_flag();

create or replace function app.strong_password(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and length(p) between 8 and 72 and p ~ '[A-Za-z]' and p ~ '[0-9]';
$$;

/** نطاق بريد حسابات الموظفين (اسم المستخدم + النطاق)، ولا تُرسل إليه رسائل */
create or replace function app.staff_domain()
returns text
language sql
immutable
set search_path = ''
as $$ select 'nazeel.local' $$;

create or replace function app.set_temp_password(p_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := extensions.crypt(p_password, extensions.gen_salt('bf', 10));
begin
  update auth.users set encrypted_password = v_hash, updated_at = now() where id = p_user;
  insert into app.temp_passwords (user_id, hash, set_by) values (p_user, v_hash, auth.uid())
  on conflict (user_id) do update set hash = excluded.hash, set_by = excluded.set_by, set_at = now();
  perform set_config('app.password_flag', 'on', true);
  update public.users_profiles set must_change_password = true where id = p_user;
  perform set_config('app.password_flag', 'off', true);
  -- كلمة جديدة تُخرج الموظف من كل الأجهزة
  delete from auth.sessions where user_id = p_user;
end;
$$;

-- المدير ينشئ حساب موظف: اسم مستخدم + كلمة مرور مؤقتة + أدوار في هذا الفندق
create or replace function public.create_staff_account(
  p_hotel_id uuid, p_full_name text, p_username text, p_password text, p_role_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid := gen_random_uuid();
  v_user  text := lower(trim(coalesce(p_username, '')));
  v_email text;
begin
  perform app.require_permission(p_hotel_id, 'settings.users.manage');
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Write the employee name' using errcode = '23514';
  end if;
  if v_user !~ '^[a-z0-9._]{3,32}$' then
    raise exception 'Username must be 3 to 32 English lowercase letters or digits' using errcode = '23514';
  end if;
  if not app.strong_password(p_password) then
    raise exception 'The password must be at least 8 characters with a letter and a digit' using errcode = '23514';
  end if;
  v_email := v_user || '@' || app.staff_domain();
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'This username is already taken' using errcode = '23505';
  end if;

  perform set_config('app.creating_staff', 'on', true);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email, '', now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', trim(p_full_name)),
    now(), now(), '', '', '', ''
  );
  perform set_config('app.creating_staff', 'off', true);
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now());

  perform app.set_temp_password(v_id, p_password);
  -- العضوية والأدوار بحراسة إضافة الأعضاء نفسها (لا يمنح المدير دورًا أعلى من صلاحياته)
  perform public.add_hotel_member(p_hotel_id, v_email, p_role_ids);
  return v_id;
end;
$$;

-- من يحق للمنفّذ إدارة حسابه: عضو في هذا الفندق، ليس المنفّذ نفسه ولا صاحب النظام، كل صلاحياته عند المنفّذ،
-- وكل فندق ينتمي إليه الموظف يملك فيه المنفّذ إدارة المستخدمين
create or replace function app.assert_can_manage_account(p_hotel_id uuid, p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'settings.users.manage');
  if p_user_id = auth.uid() then
    raise exception 'You cannot manage your own account from here' using errcode = '42501';
  end if;
  if not exists (select 1 from public.hotel_members where hotel_id = p_hotel_id and user_id = p_user_id) then
    raise exception 'The employee is not in this hotel' using errcode = 'P0002';
  end if;
  if exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = lower(coalesce(app.setting('owner_email'), ''))) then
    raise exception 'The system owner account cannot be managed by others' using errcode = '42501';
  end if;
  if exists (select 1 from public.hotel_members m where m.user_id = p_user_id and not app.has_permission(m.hotel_id, 'settings.users.manage')) then
    raise exception 'You cannot manage an employee who has permissions you do not have' using errcode = '42501';
  end if;
  if not app.actor_holds_all(p_hotel_id, array(select app.effective_permissions(p_hotel_id, p_user_id))) then
    raise exception 'You cannot manage an employee who has permissions you do not have' using errcode = '42501';
  end if;
end;
$$;

-- كلمة مرور مؤقتة جديدة لحساب موظف (حسابات البريد الحقيقي يغيّر أصحابها كلماتهم بأنفسهم)
create or replace function public.reset_staff_password(p_hotel_id uuid, p_user_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_can_manage_account(p_hotel_id, p_user_id);
  if not exists (select 1 from auth.users where id = p_user_id and email like '%@' || app.staff_domain()) then
    raise exception 'Only staff accounts created in the system can be reset here' using errcode = '42501';
  end if;
  if not app.strong_password(p_password) then
    raise exception 'The password must be at least 8 characters with a letter and a digit' using errcode = '23514';
  end if;
  perform app.set_temp_password(p_user_id, p_password);
end;
$$;

-- إخراج الموظف من كل أجهزته
create or replace function public.end_staff_sessions(p_hotel_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_can_manage_account(p_hotel_id, p_user_id);
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

-- بعد أن يغيّر الموظف كلمته المؤقتة: تُرفع العلامة إن كانت الكلمة تغيّرت فعلًا
create or replace function public.confirm_password_changed()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_temp text;
  v_cur  text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select hash into v_temp from app.temp_passwords where user_id = auth.uid();
  if v_temp is not null then
    select encrypted_password into v_cur from auth.users where id = auth.uid();
    if v_cur = v_temp then
      raise exception 'Choose a new password different from the temporary one' using errcode = '23514';
    end if;
    delete from app.temp_passwords where user_id = auth.uid();
  end if;
  perform set_config('app.password_flag', 'on', true);
  update public.users_profiles set must_change_password = false where id = auth.uid() and must_change_password;
  perform set_config('app.password_flag', 'off', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) تضييق الصلاحيات
-- -----------------------------------------------------------------------------
-- المستخدم يعدّل من ملفه: الاسم والهاتف واللغة والفندق الافتراضي فقط (لا البريد ولا التفعيل ولا العلامات)
revoke update on public.users_profiles from authenticated;
grant update (full_name, phone, preferred_locale, default_hotel_id) on public.users_profiles to authenticated;

-- الزائر غير المسجّل: لا جداول ولا دوال، سوى استبيان النزيل برمزه
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
grant execute on function public.submit_guest_survey(text, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text) to anon;
grant execute on function public.survey_info(text) to anon;

revoke execute on all functions in schema app from public, anon;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_staff_account(uuid, text, text, text, uuid[])',
    'public.reset_staff_password(uuid, uuid, text)',
    'public.end_staff_sessions(uuid, uuid)',
    'public.confirm_password_changed()'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
-- دوال app المستخدمة داخل سياسات RLS والتريغرات تبقى متاحة للمستخدم المسجّل كما في الترحيلات السابقة
grant execute on all functions in schema app to authenticated;
revoke execute on function app.set_temp_password(uuid, text) from authenticated;
revoke execute on function app.setting(text) from authenticated;

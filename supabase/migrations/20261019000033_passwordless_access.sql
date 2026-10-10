-- =============================================================================
-- الدخول بلا كلمات مرور (النسخة المنشورة):
--   1) أول من يفتح النظام الجديد يضغط «ابدأ» فيصبح صاحب النظام ويبقى جهازه مسجّلًا، ثم يُغلق هذا الباب نهائيًا.
--   2) المدير يضيف الموظف بالاسم والدور فقط، ويعطيه رابط دخول يُستخدم مرة واحدة خلال 7 أيام.
--      فتح الرابط يسجّل دخول الموظف على جهازه. رابط جديد يلغي ما قبله.
--   3) كلمة المرور اختيارية لكل حساب: يضعها صاحبه ليدخل من جهاز آخر باسم المستخدم.
-- كلمات الحسابات عشوائية لا يعرفها أحد، وتُستبدل بأخرى عند كل دخول برابط، فلا قيمة لاعتراض واحدة منها.
-- =============================================================================

alter table public.users_profiles add column if not exists password_chosen boolean not null default false;

-- علامتا كلمة المرور يغيّرهما النظام فقط
create or replace function app.guard_password_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.must_change_password is distinct from old.must_change_password or new.password_chosen is distinct from old.password_chosen)
     and auth.uid() is not null and current_setting('app.password_flag', true) is distinct from 'on' then
    raise exception 'must_change_password is maintained by the system and cannot be changed directly' using errcode = '42501';
  end if;
  return new;
end;
$$;

create table if not exists app.access_links (
  token_hash  text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists access_links_user on app.access_links (user_id);
revoke all on app.access_links from public;
do $$ begin
  execute 'revoke all on app.access_links from anon, authenticated';
end $$;

create or replace function app.is_owner(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and (
    p_user::text = coalesce(app.setting('owner_user'), '')
    or exists (select 1 from auth.users u where u.id = p_user and lower(u.email) = lower(coalesce(app.setting('owner_email'), '')))
  );
$$;

-- حساب جديد بكلمة عشوائية لا يعرفها أحد (الدخول بالرابط أو بكلمة يختارها صاحبه لاحقًا)
create or replace function app.new_account(p_email text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform set_config('app.creating_staff', 'on', true);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf', 10)), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', trim(p_full_name)),
    now(), now(), '', '', '', ''
  );
  perform set_config('app.creating_staff', 'off', true);
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true), 'email', now(), now());
  return v_id;
end;
$$;

-- كلمة دخول عشوائية جديدة تُعطى للخادم مرة واحدة ليفتح الجلسة بها، وتُلغي ما قبلها
create or replace function app.issue_login(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass  text := encode(extensions.gen_random_bytes(24), 'hex');
  v_email text;
begin
  update auth.users set encrypted_password = extensions.crypt(v_pass, extensions.gen_salt('bf', 10)), updated_at = now()
  where id = p_user returning email into v_email;
  delete from app.temp_passwords where user_id = p_user;
  perform set_config('app.password_flag', 'on', true);
  update public.users_profiles set must_change_password = false, password_chosen = false where id = p_user;
  perform set_config('app.password_flag', 'off', true);
  return jsonb_build_object('email', v_email, 'password', v_pass);
end;
$$;

-- -----------------------------------------------------------------------------
-- 1) صاحب النظام
-- -----------------------------------------------------------------------------
create or replace function public.system_has_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(app.setting('owner_user'), '') is not null
      or exists (select 1 from auth.users u where lower(u.email) = lower(coalesce(app.setting('owner_email'), '')));
$$;

create or replace function public.claim_owner()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- طلبان متزامنان: واحد فقط يصبح المالك
  perform pg_advisory_xact_lock(hashtext('nazeel.claim_owner'));
  if public.system_has_owner() then
    raise exception 'The system already has an owner' using errcode = '42501';
  end if;
  v_id := app.new_account('admin@' || app.staff_domain(), 'مدير النظام');
  insert into app.system_settings (key, value) values ('owner_user', v_id::text), ('signup_mode', 'invite')
  on conflict (key) do update set value = excluded.value;
  return app.issue_login(v_id);
end;
$$;

-- إنشاء الفنادق لصاحب النظام (بحسابه أو ببريده المعتمد)
create or replace function app.guard_hotel_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.invite_only() and auth.uid() is not null and not app.is_owner(auth.uid()) then
    raise exception 'Only the system owner can create hotels' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- حساب صاحب النظام لا يديره غيره
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
  if app.is_owner(p_user_id) then
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

-- -----------------------------------------------------------------------------
-- 2) روابط دخول الموظفين
-- -----------------------------------------------------------------------------
create or replace function public.create_access_link(p_hotel_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  perform app.assert_can_manage_account(p_hotel_id, p_user_id);
  if not exists (select 1 from auth.users where id = p_user_id and email like '%@' || app.staff_domain()) then
    raise exception 'Only staff accounts created in the system can be reset here' using errcode = '42501';
  end if;
  -- رابط جديد يلغي الروابط السابقة غير المستخدمة
  delete from app.access_links where user_id = p_user_id and used_at is null;
  insert into app.access_links (token_hash, user_id, hotel_id, created_by, expires_at)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_user_id, p_hotel_id, auth.uid(), now() + interval '7 days');
  return v_token;
end;
$$;

-- موظف جديد بالاسم والأدوار: اسم مستخدم تلقائي، ورابط دخول جاهز
create or replace function public.add_staff_member(p_hotel_id uuid, p_full_name text, p_role_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user text;
  v_id   uuid;
  v_try  integer := 0;
begin
  perform app.require_permission(p_hotel_id, 'settings.users.manage');
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Write the employee name' using errcode = '23514';
  end if;
  loop
    v_user := 'staff' || (10000 + floor(random() * 90000))::int;
    exit when not exists (select 1 from auth.users where lower(email) = v_user || '@' || app.staff_domain());
    v_try := v_try + 1;
    if v_try > 50 then raise exception 'This username is already taken' using errcode = '23505'; end if;
  end loop;
  v_id := app.new_account(v_user || '@' || app.staff_domain(), p_full_name);
  perform public.add_hotel_member(p_hotel_id, v_user || '@' || app.staff_domain(), p_role_ids);
  return jsonb_build_object('user_id', v_id, 'username', v_user, 'token', public.create_access_link(p_hotel_id, v_id));
end;
$$;

-- فتح الرابط: يُستخدم مرة واحدة، ولموظف ما زال نشطًا في الفندق
create or replace function public.redeem_access_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link app.access_links%rowtype;
begin
  select * into v_link from app.access_links
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;
  if v_link.token_hash is null or v_link.used_at is not null or v_link.expires_at < now()
     or not exists (select 1 from public.hotel_members m where m.hotel_id = v_link.hotel_id and m.user_id = v_link.user_id and m.is_active) then
    raise exception 'This access link is no longer valid' using errcode = '42501';
  end if;
  update app.access_links set used_at = now() where token_hash = v_link.token_hash;
  return app.issue_login(v_link.user_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) كلمة المرور الاختيارية
-- -----------------------------------------------------------------------------
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
  update public.users_profiles set must_change_password = false, password_chosen = true where id = auth.uid();
  perform set_config('app.password_flag', 'off', true);
end;
$$;

revoke execute on all functions in schema app from public, anon;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_access_link(uuid, uuid)',
    'public.add_staff_member(uuid, text, uuid[])',
    'public.confirm_password_changed()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.system_has_owner()',
    'public.claim_owner()',
    'public.redeem_access_link(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
grant execute on all functions in schema app to authenticated;
revoke execute on function app.set_temp_password(uuid, text) from authenticated;
revoke execute on function app.setting(text) from authenticated;
revoke execute on function app.new_account(text, text) from authenticated;
revoke execute on function app.issue_login(uuid) from authenticated;

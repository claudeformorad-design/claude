-- محاكاة مصغرة لبيئة Supabase (للاختبار المحلي فقط — لا تُطبق على مشروع Supabase حقيقي)
do $$ begin
  create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  -- أعمدة Supabase Auth التي تكتبها دالة إنشاء حسابات الموظفين
  instance_id uuid, aud text, role text, encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text
);
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);
create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now()
);
create schema if not exists extensions;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

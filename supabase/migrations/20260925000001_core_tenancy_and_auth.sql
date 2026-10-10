-- =============================================================================
-- المرحلة 1 / الترحيل 1: البنية الأساسية — الفنادق، المستخدمون، الأدوار والصلاحيات
-- Phase 1 / Migration 1: tenancy (hotels), users, roles & permissions, departments
-- =============================================================================
-- مبادئ عامة:
--  * كل جدول يخص فندقًا يحمل hotel_id، وتفرض سياسات RLS أن المستخدم عضو في الفندق
--    ويملك الصلاحية المطلوبة (multi-tenant: يدعم سلاسل الفنادق).
--  * الدوال المساعدة توضع في المخطط app (غير مكشوف عبر PostgREST).
--  * الدوال ذات SECURITY DEFINER تحدد search_path فارغًا وتستخدم أسماء مؤهلة بالكامل.
-- =============================================================================

create extension if not exists btree_gist;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- دوال التريغر العامة: updated_at / created_by
-- -----------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- يفرض أن created_by هو المستخدم الفعلي (لا يمكن للعميل انتحال مستخدم آخر)
create or replace function app.set_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  new.created_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- العملات (بيانات مرجعية عامة)
-- -----------------------------------------------------------------------------
create table public.currencies (
  code        char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name_ar     text not null,
  name_en     text not null,
  symbol      text not null,
  decimals    smallint not null default 2 check (decimals between 0 and 4),
  is_active   boolean not null default true
);

insert into public.currencies (code, name_ar, name_en, symbol, decimals) values
  ('SAR', 'ريال سعودي',   'Saudi Riyal',        'ر.س', 2),
  ('AED', 'درهم إماراتي', 'UAE Dirham',         'د.إ', 2),
  ('KWD', 'دينار كويتي',  'Kuwaiti Dinar',      'د.ك', 3),
  ('QAR', 'ريال قطري',    'Qatari Riyal',       'ر.ق', 2),
  ('BHD', 'دينار بحريني', 'Bahraini Dinar',     'د.ب', 3),
  ('OMR', 'ريال عماني',   'Omani Rial',         'ر.ع', 3),
  ('JOD', 'دينار أردني',  'Jordanian Dinar',    'د.أ', 3),
  ('EGP', 'جنيه مصري',    'Egyptian Pound',     'ج.م', 2),
  ('MAD', 'درهم مغربي',   'Moroccan Dirham',    'د.م', 2),
  ('TRY', 'ليرة تركية',   'Turkish Lira',       '₺',   2),
  ('USD', 'دولار أمريكي', 'US Dollar',          '$',   2),
  ('EUR', 'يورو',         'Euro',               '€',   2),
  ('GBP', 'جنيه إسترليني','Pound Sterling',     '£',   2);

-- -----------------------------------------------------------------------------
-- الفنادق (المستأجرون)
-- -----------------------------------------------------------------------------
create table public.hotels (
  id                       uuid primary key default gen_random_uuid(),
  name_ar                  text not null check (length(trim(name_ar)) > 0),
  name_en                  text,
  legal_name               text,
  tax_number               text,
  commercial_registration  text,
  country_code             char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  base_currency            char(3) not null references public.currencies(code),
  fiscal_year_start_month  smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  timezone                 text not null default 'Asia/Riyadh',
  default_locale           text not null default 'ar' check (default_locale in ('ar', 'en')),
  total_rooms              integer check (total_rooms is null or total_rooms >= 0),
  address                  text,
  phone                    text,
  email                    text,
  logo_url                 text,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  created_by               uuid references auth.users(id),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id)
);

create trigger hotels_set_created before insert on public.hotels
  for each row execute function app.set_created_by();
create trigger hotels_set_updated before update on public.hotels
  for each row execute function app.set_updated_at();

-- العملة الأساسية لا تتغير بعد وجود قيود (تُفرض في الترحيل 3 عبر تريغر)

-- -----------------------------------------------------------------------------
-- ملفات المستخدمين (مرتبطة بـ Supabase Auth)
-- -----------------------------------------------------------------------------
create table public.users_profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text not null default '',
  email             text,
  phone             text,
  preferred_locale  text not null default 'ar' check (preferred_locale in ('ar', 'en')),
  default_hotel_id  uuid references public.hotels(id) on delete set null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id)
);

create trigger users_profiles_set_updated before update on public.users_profiles
  for each row execute function app.set_updated_at();

-- إنشاء ملف تلقائي عند تسجيل مستخدم جديد في auth.users
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users_profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- الصلاحيات والأدوار
-- -----------------------------------------------------------------------------
-- الصلاحيات ثابتة (يعرّفها النظام) — الصيغة: module.resource.action
create table public.permissions (
  code        text primary key check (code ~ '^[a-z_]+(\.[a-z_]+)+$'),
  module      text not null,
  action      text not null,
  name_ar     text not null,
  name_en     text not null,
  sort_order  integer not null default 0
);

-- الأدوار: hotel_id = null ⇒ دور نظامي (قالب مشترك غير قابل للتعديل)
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid references public.hotels(id) on delete cascade,
  code        text not null check (code ~ '^[a-z_]+$'),
  name_ar     text not null,
  name_en     text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  constraint roles_system_has_no_hotel check (is_system = (hotel_id is null))
);

create unique index roles_code_uq on public.roles (coalesce(hotel_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

create trigger roles_set_created before insert on public.roles
  for each row execute function app.set_created_by();
create trigger roles_set_updated before update on public.roles
  for each row execute function app.set_updated_at();

create table public.role_permissions (
  role_id          uuid not null references public.roles(id) on delete cascade,
  permission_code  text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

-- عضوية المستخدم في فندق (مستخدم واحد قد يعمل في عدة فنادق بسلسلة)
-- الأدوار منفصلة في user_hotel_roles: للمستخدم عدة أدوار في نفس الفندق،
-- وصلاحياته = اتحاد صلاحيات كل أدواره.
create table public.hotel_members (
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  primary key (hotel_id, user_id)
);

create index hotel_members_user_idx on public.hotel_members (user_id);

create trigger hotel_members_set_created before insert on public.hotel_members
  for each row execute function app.set_created_by();
create trigger hotel_members_set_updated before update on public.hotel_members
  for each row execute function app.set_updated_at();

-- أدوار المستخدم في الفندق (متعدد لمتعدد). يشترط أن يكون المستخدم عضوًا في الفندق أولًا.
create table public.user_hotel_roles (
  hotel_id    uuid not null,
  user_id     uuid not null,
  role_id     uuid not null references public.roles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  primary key (hotel_id, user_id, role_id),
  foreign key (hotel_id, user_id) references public.hotel_members (hotel_id, user_id) on delete cascade
);

create index user_hotel_roles_user_idx on public.user_hotel_roles (user_id, hotel_id);
create index user_hotel_roles_role_idx on public.user_hotel_roles (role_id);

create trigger user_hotel_roles_set_created before insert on public.user_hotel_roles
  for each row execute function app.set_created_by();

-- الدور المخصص لفندق يجب أن يكون من نفس الفندق أو دورًا نظاميًا
create or replace function app.check_member_role_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role_hotel uuid;
begin
  select r.hotel_id into v_role_hotel from public.roles r where r.id = new.role_id;
  if v_role_hotel is not null and v_role_hotel <> new.hotel_id then
    raise exception 'Role belongs to another hotel' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger user_hotel_roles_role_scope before insert or update on public.user_hotel_roles
  for each row execute function app.check_member_role_scope();

-- حماية من قفل الفندق: لا يُزال آخر مدير عام فعّال (بحذف الدور أو تعطيل العضوية أو حذفها)
create or replace function app.has_other_active_general_manager(p_hotel_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_hotel_roles uhr
    join public.roles r on r.id = uhr.role_id and r.is_system and r.code = 'general_manager'
    join public.hotel_members m on m.hotel_id = uhr.hotel_id and m.user_id = uhr.user_id and m.is_active
    where uhr.hotel_id = p_hotel_id and uhr.user_id <> p_user_id
  );
$$;

create or replace function app.protect_last_general_manager()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_gm boolean;
begin
  -- سياق النظام (حذف فندق متتالٍ، ترحيلات) مسموح له
  if auth.uid() is null or not exists (select 1 from public.hotels h where h.id = old.hotel_id) then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'user_hotel_roles' then
    select exists (select 1 from public.roles r where r.id = old.role_id and r.is_system and r.code = 'general_manager')
      into v_is_gm;
  else
    -- hotel_members: الحذف أو التعطيل فقط يهمّنا
    if tg_op = 'UPDATE' and (new.is_active or not old.is_active) then
      return new;
    end if;
    select exists (
      select 1 from public.user_hotel_roles uhr
      join public.roles r on r.id = uhr.role_id and r.is_system and r.code = 'general_manager'
      where uhr.hotel_id = old.hotel_id and uhr.user_id = old.user_id
    ) into v_is_gm;
  end if;

  if v_is_gm and not app.has_other_active_general_manager(old.hotel_id, old.user_id) then
    raise exception 'Cannot remove the last active general manager of the hotel' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger user_hotel_roles_protect_last_gm before delete or update on public.user_hotel_roles
  for each row execute function app.protect_last_general_manager();
create trigger hotel_members_protect_last_gm before delete or update of is_active on public.hotel_members
  for each row execute function app.protect_last_general_manager();

-- لا يمكن تعديل صلاحيات الأدوار النظامية إلا عبر الترحيلات
create or replace function app.protect_system_role_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role_id uuid := coalesce(new.role_id, old.role_id);
begin
  if auth.uid() is not null and exists (
    select 1 from public.roles r where r.id = v_role_id and r.is_system
  ) then
    raise exception 'System roles cannot be modified' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger role_permissions_protect_system
  before insert or update or delete on public.role_permissions
  for each row execute function app.protect_system_role_permissions();

-- -----------------------------------------------------------------------------
-- دوال التحقق من العضوية والصلاحيات (أساس سياسات RLS)
-- SECURITY DEFINER لتفادي التكرار اللانهائي لسياسات RLS على hotel_members / user_hotel_roles
-- -----------------------------------------------------------------------------
create or replace function app.is_hotel_member(p_hotel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hotel_members m
    join public.hotels h on h.id = m.hotel_id
    where m.hotel_id = p_hotel_id
      and m.user_id = auth.uid()
      and m.is_active
      and h.is_active
  );
$$;

create or replace function app.has_permission(p_hotel_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hotel_members m
    join public.hotels h on h.id = m.hotel_id
    join public.user_hotel_roles uhr on uhr.hotel_id = m.hotel_id and uhr.user_id = m.user_id
    join public.role_permissions rp on rp.role_id = uhr.role_id
    where m.hotel_id = p_hotel_id
      and m.user_id = auth.uid()
      and m.is_active
      and h.is_active
      and rp.permission_code = p_permission
  );
$$;

-- يرفع خطأ صلاحيات إن لم يملك المستخدم الصلاحية. سياق النظام (auth.uid() فارغ،
-- مثل service_role أو الترحيلات) مسموح له.
create or replace function app.require_permission(p_hotel_id uuid, p_permission text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is not null and not app.has_permission(p_hotel_id, p_permission) then
    raise exception 'Permission denied: %', p_permission using errcode = '42501';
  end if;
end;
$$;

grant execute on function app.is_hotel_member(uuid) to authenticated;
grant execute on function app.has_permission(uuid, text) to authenticated;
grant execute on function app.require_permission(uuid, text) to authenticated;

-- واجهة عامة لقراءة صلاحيات المستخدم الحالي (تستخدمها الواجهة لإظهار/إخفاء العناصر)
create or replace function public.my_permissions(p_hotel_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  -- اتحاد صلاحيات كل أدوار المستخدم في الفندق
  select distinct rp.permission_code
  from public.hotel_members m
  join public.hotels h on h.id = m.hotel_id
  join public.user_hotel_roles uhr on uhr.hotel_id = m.hotel_id and uhr.user_id = m.user_id
  join public.role_permissions rp on rp.role_id = uhr.role_id
  where m.hotel_id = p_hotel_id
    and m.user_id = auth.uid()
    and m.is_active
    and h.is_active;
$$;

-- -----------------------------------------------------------------------------
-- الأقسام = مراكز التكلفة/الإيراد
-- -----------------------------------------------------------------------------
create type public.department_kind as enum ('revenue_center', 'cost_center', 'service_center');

create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  code        text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar     text not null,
  name_en     text,
  kind        public.department_kind not null,
  parent_id   uuid references public.departments(id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  unique (hotel_id, code),
  unique (hotel_id, id)
);

create trigger departments_set_created before insert on public.departments
  for each row execute function app.set_created_by();
create trigger departments_set_updated before update on public.departments
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- أسعار الصرف (سعر العملة الأجنبية مقابل العملة الأساسية للفندق)
-- -----------------------------------------------------------------------------
create table public.exchange_rates (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  currency_code  char(3) not null references public.currencies(code),
  rate_date      date not null,
  -- كم وحدة من العملة الأساسية تساوي وحدة واحدة من هذه العملة
  rate           numeric(20, 10) not null check (rate > 0),
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  unique (hotel_id, currency_code, rate_date)
);

create trigger exchange_rates_set_created before insert on public.exchange_rates
  for each row execute function app.set_created_by();

-- -----------------------------------------------------------------------------
-- بيانات مرجعية: الصلاحيات والأدوار النظامية
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, action, name_ar, name_en, sort_order) values
  ('settings.hotel.manage',     'settings', 'manage',  'إدارة إعدادات الفندق',          'Manage hotel settings',          10),
  ('settings.users.manage',     'settings', 'manage',  'إدارة المستخدمين والأدوار',      'Manage users & roles',           20),
  ('settings.departments.manage','settings','manage',  'إدارة الأقسام ومراكز التكلفة',   'Manage departments / cost centers', 30),
  ('settings.currencies.manage','settings', 'manage',  'إدارة أسعار الصرف',              'Manage exchange rates',          40),
  ('coa.accounts.view',         'coa',      'view',    'عرض دليل الحسابات',              'View chart of accounts',        100),
  ('coa.accounts.manage',       'coa',      'manage',  'إدارة دليل الحسابات',            'Manage chart of accounts',      110),
  ('gl.journal.view',           'gl',       'view',    'عرض القيود اليومية',             'View journal entries',          200),
  ('gl.journal.create',         'gl',       'create',  'إنشاء وتعديل مسودات القيود',     'Create / edit draft entries',   210),
  ('gl.journal.post',           'gl',       'approve', 'ترحيل القيود',                   'Post journal entries',          220),
  ('gl.journal.reverse',        'gl',       'approve', 'عكس القيود المرحّلة',            'Reverse posted entries',        230),
  ('gl.periods.view',           'gl',       'view',    'عرض الفترات المحاسبية',          'View accounting periods',       240),
  ('gl.periods.manage',         'gl',       'manage',  'إدارة وإقفال الفترات المحاسبية', 'Manage & close periods',        250),
  ('gl.periods.post_closed',    'gl',       'approve', 'الترحيل في فترة مقفلة (استثناء)','Post into closed period (override)', 260),
  ('reports.trial_balance.view','reports',  'view',    'عرض ميزان المراجعة',             'View trial balance',            300),
  ('audit.logs.view',           'audit',    'view',    'عرض سجل التدقيق',                'View audit log',                400);

insert into public.roles (hotel_id, code, name_ar, name_en, description, is_system) values
  (null, 'general_manager',    'مدير عام',   'General Manager',    'صلاحيات كاملة',                        true),
  (null, 'accountant',         'محاسب',      'Accountant',         'إدارة الحسابات والقيود والتقارير',      true),
  (null, 'auditor',            'مدقق',       'Auditor',            'قراءة فقط لكل البيانات المالية',       true),
  (null, 'cashier',            'كاشير',      'Cashier',            'عمليات الصندوق فقط',                   true),
  (null, 'department_manager', 'مدير قسم',   'Department Manager', 'عرض تقارير وقيود قسمه',               true);

-- مدير عام: كل الصلاحيات
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code = 'general_manager';

-- محاسب: كل شيء عدا إدارة المستخدمين/الفندق واستثناء الفترات المقفلة
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code = 'accountant'
  and p.code not in ('settings.hotel.manage', 'settings.users.manage', 'gl.periods.post_closed');

-- مدقق: صلاحيات العرض فقط
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code = 'auditor' and p.action = 'view';

-- كاشير: عرض دليل الحسابات فقط في المرحلة 1 (تتوسع مع وحدة المدفوعات)
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code = 'cashier' and p.code in ('coa.accounts.view');

-- مدير قسم
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code = 'department_manager'
  and p.code in ('coa.accounts.view', 'gl.journal.view', 'reports.trial_balance.view');

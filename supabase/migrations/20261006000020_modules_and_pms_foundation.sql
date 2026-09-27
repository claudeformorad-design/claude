-- =============================================================================
-- الترحيل 20: فصل الأقسام بالترخيص + أساس قسم إدارة الفندق (الحجوزات)
--
-- 1) الأقسام: لكل فندق أقسام مفعّلة (accounting / pms). كل صلاحية تتبع «منتجًا»
--    (core مشترك، accounting، pms)، ودوال التحقق من الصلاحيات لا تمنح صلاحية منتج غير مفعّل.
--    فالفصل مفروض في قاعدة البيانات نفسها (RLS والدوال) لا في الواجهة فقط.
-- 2) هيكل الفندق: الطوابق، أنواع الغرف (ليلية أو بالساعة)، الغرف وحالاتها.
-- 3) النزلاء.
-- 4) الحجوزات: منع الحجز المزدوج للغرفة بقيد استبعاد، والسعة لكل نوع مع حد الحجز الزائد،
--    وأسعار كل ليلة تُثبَّت لحظة الحجز (تغيير الأسعار لاحقًا لا يمس الحجوزات القائمة)،
--    والمواسم وأسعار نهاية الأسبوع، وعروض اللحظة الأخيرة، والتسعير الثابت والشهري للإقامات الطويلة،
--    والحجوزات الجماعية، والحجوزات المتكررة، وقائمة الانتظار.
-- الأموال (الفوليو والدفعات والفواتير) تبقى في المحاسبة وتُربط في المرحلة التالية.
-- =============================================================================

-- =============================================================================
-- 1) الأقسام المفعّلة والصلاحيات حسب المنتج
-- =============================================================================
alter table public.hotels
  add column enabled_modules text[] not null default array['accounting', 'pms']
    constraint hotels_modules_valid check (cardinality(enabled_modules) >= 1 and enabled_modules <@ array['accounting', 'pms']),
  add column check_in_time  time not null default '14:00',
  add column check_out_time time not null default '12:00',
  -- ليالي نهاية الأسبوع (0 = الأحد … 6 = السبت): ليلتا الخميس والجمعة افتراضيًا
  add column weekend_nights smallint[] not null default array[4, 5]::smallint[]
    constraint hotels_weekend_valid check (weekend_nights <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);

alter table public.permissions
  add column product text not null default 'accounting' check (product in ('core', 'accounting', 'pms'));

-- المشترك بين القسمين: الإعدادات والتدقيق والفوليو والعملاء والفواتير الضريبية الصادرة عن المغادرة
update public.permissions set product = 'core'
 where module in ('settings', 'audit', 'folio', 'customers') or code = 'invoices.view';

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
    join public.permissions p on p.code = rp.permission_code
    where m.hotel_id = p_hotel_id
      and m.user_id = auth.uid()
      and m.is_active
      and h.is_active
      and rp.permission_code = p_permission
      and (p.product = 'core' or p.product = any (h.enabled_modules))
  );
$$;

create or replace function app.permitted_hotels(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.hotel_id
  from public.hotel_members m
  join public.hotels h on h.id = m.hotel_id
  join public.user_hotel_roles uhr on uhr.hotel_id = m.hotel_id and uhr.user_id = m.user_id
  join public.role_permissions rp on rp.role_id = uhr.role_id
  join public.permissions p on p.code = rp.permission_code
  where m.user_id = auth.uid()
    and m.is_active
    and h.is_active
    and rp.permission_code = p_permission
    and (p.product = 'core' or p.product = any (h.enabled_modules));
$$;

create or replace function public.my_permissions(p_hotel_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct rp.permission_code
  from public.hotel_members m
  join public.hotels h on h.id = m.hotel_id
  join public.user_hotel_roles uhr on uhr.hotel_id = m.hotel_id and uhr.user_id = m.user_id
  join public.role_permissions rp on rp.role_id = uhr.role_id
  join public.permissions p on p.code = rp.permission_code
  where m.hotel_id = p_hotel_id
    and m.user_id = auth.uid()
    and m.is_active
    and h.is_active
    and (p.product = 'core' or p.product = any (h.enabled_modules));
$$;

-- تفعيل/إيقاف الأقسام (لاحقًا يرتبط بمفتاح الترخيص)
create or replace function public.set_hotel_modules(p_hotel_id uuid, p_modules text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'settings.hotel.manage');
  if p_modules is null or cardinality(p_modules) = 0 then
    raise exception 'At least one module must be enabled' using errcode = '23514';
  end if;
  update public.hotels
     set enabled_modules = (select array_agg(distinct m order by m) from unnest(p_modules) m)
   where id = p_hotel_id;
end;
$$;

-- =============================================================================
-- 2) صلاحيات قسم إدارة الفندق والأدوار
-- =============================================================================
insert into public.permissions (code, module, action, name_ar, name_en, sort_order, product) values
  ('pms.reservations.view',     'pms', 'view',    'عرض الحجوزات والنزلاء والغرف',          'View reservations, guests & rooms',  1000, 'pms'),
  ('pms.reservations.manage',   'pms', 'manage',  'إنشاء وتعديل الحجوزات والنزلاء والانتظار','Create / edit reservations & guests', 1010, 'pms'),
  ('pms.reservations.cancel',   'pms', 'manage',  'إلغاء الحجوزات وتسجيل عدم الحضور',      'Cancel reservations / no-shows',     1020, 'pms'),
  ('pms.reservations.overbook', 'pms', 'approve', 'الحجز الزائد فوق السعة',                'Overbook beyond capacity',           1030, 'pms'),
  ('pms.rates.manage',          'pms', 'manage',  'إدارة الأسعار والمواسم والعروض',         'Manage rates, seasons & deals',      1040, 'pms'),
  ('pms.rates.override',        'pms', 'approve', 'تحديد سعر يدوي أو شهري للحجز',           'Manual / monthly reservation rate',  1050, 'pms'),
  ('pms.rooms.status',          'pms', 'manage',  'تحديث حالة الغرف (النظافة والخدمة)',     'Update room status',                 1060, 'pms'),
  ('pms.setup.manage',          'pms', 'manage',  'إدارة الطوابق وأنواع الغرف والغرف',      'Manage floors, room types & rooms',  1070, 'pms');

insert into public.roles (hotel_id, code, name_ar, name_en, description, is_system) values
  (null, 'receptionist',      'موظف استقبال',  'Receptionist',          'الحجوزات والنزلاء وحالة الغرف',   true),
  (null, 'reservations_agent','موظف حجوزات',   'Reservations Agent',    'إنشاء الحجوزات وإدارتها',          true),
  (null, 'housekeeping',      'مشرف تدبير',    'Housekeeping Supervisor','حالة الغرف (النظافة والصيانة)',   true);

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and p.product = 'pms' and (
  r.code = 'general_manager'
  or (r.code = 'auditor' and p.action = 'view')
  or (r.code = 'accountant' and p.code = 'pms.reservations.view')
  or (r.code = 'receptionist' and p.code in ('pms.reservations.view', 'pms.reservations.manage', 'pms.reservations.cancel', 'pms.rooms.status'))
  or (r.code = 'reservations_agent' and p.code in ('pms.reservations.view', 'pms.reservations.manage', 'pms.reservations.cancel'))
  or (r.code = 'housekeeping' and p.code in ('pms.reservations.view', 'pms.rooms.status'))
)
on conflict do nothing;

-- موظف الاستقبال يرى العملاء (الشركات) لربط الحجوزات بها
insert into public.role_permissions (role_id, permission_code)
select r.id, 'customers.view' from public.roles r where r.is_system and r.code in ('receptionist', 'reservations_agent')
on conflict do nothing;

-- =============================================================================
-- 3) هيكل الفندق
-- =============================================================================
create type public.pms_booking_mode as enum ('nightly', 'hourly');
create type public.room_housekeeping_status as enum ('clean', 'dirty', 'inspected');
create type public.room_service_status as enum ('in_service', 'out_of_service');

create table public.floors (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  unique (hotel_id, name),
  unique (hotel_id, id)
);

create table public.room_types (
  id                 uuid primary key default gen_random_uuid(),
  hotel_id           uuid not null references public.hotels(id) on delete cascade,
  code               text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar            text not null check (length(trim(name_ar)) > 0),
  -- ليلية (غرف وأجنحة) أو بالساعة (قاعات، مسابح، شاليهات)
  booking_mode       public.pms_booking_mode not null default 'nightly',
  -- القاعات تتسع لمئات الأشخاص
  max_adults         smallint not null default 2 check (max_adults between 1 and 1000),
  max_children       smallint not null default 0 check (max_children between 0 and 50),
  -- سعر الليلة (أو سعر الساعة للوحدات بالساعة) قبل المواسم
  base_rate          numeric(19, 4) not null default 0 check (base_rate >= 0),
  weekend_rate       numeric(19, 4) check (weekend_rate is null or weekend_rate >= 0),
  min_hours          numeric(5, 2) not null default 1 check (min_hours > 0 and min_hours <= 24),
  -- عدد الحجوزات المسموح بها فوق عدد الغرف الفعلي (0 = لا حجز زائد)
  overbooking_limit  smallint not null default 0 check (overbooking_limit between 0 and 100),
  -- كود الرسوم الذي تُرحَّل عليه إيرادات هذا النوع (الحساب والقسم والضرائب)
  charge_code_id     uuid,
  description        text,
  is_active          boolean not null default true,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),
  unique (hotel_id, code),
  unique (hotel_id, id),
  foreign key (hotel_id, charge_code_id) references public.charge_codes (hotel_id, id)
);

create table public.rooms (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null references public.hotels(id) on delete cascade,
  room_number          text not null check (length(trim(room_number)) between 1 and 20),
  floor_id             uuid,
  room_type_id         uuid not null,
  housekeeping_status  public.room_housekeeping_status not null default 'clean',
  service_status       public.room_service_status not null default 'in_service',
  service_note         text,
  notes                text,
  is_active            boolean not null default true,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users(id),
  unique (hotel_id, room_number),
  unique (hotel_id, id),
  foreign key (hotel_id, floor_id) references public.floors (hotel_id, id),
  foreign key (hotel_id, room_type_id) references public.room_types (hotel_id, id)
);

create index rooms_type_idx on public.rooms (room_type_id);

create trigger floors_set_created before insert on public.floors for each row execute function app.set_created_by();
create trigger floors_set_updated before update on public.floors for each row execute function app.set_updated_at();
create trigger room_types_set_created before insert on public.room_types for each row execute function app.set_created_by();
create trigger room_types_set_updated before update on public.room_types for each row execute function app.set_updated_at();
create trigger rooms_set_created before insert on public.rooms for each row execute function app.set_created_by();
create trigger rooms_set_updated before update on public.rooms for each row execute function app.set_updated_at();

-- عدد الغرف المتاحة للبيع في تقارير الإشغال يُؤخذ من الغرف الفعلية (الليلية النشطة) متى وُجدت
create or replace function app.sync_total_rooms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.hotels h
     set total_rooms = c.cnt
    from (
      select r.hotel_id, count(*)::integer as cnt
      from public.rooms r
      join public.room_types t on t.id = r.room_type_id
      where r.is_active and t.booking_mode = 'nightly'
      group by r.hotel_id
    ) c
   where h.id = c.hotel_id and h.total_rooms is distinct from c.cnt;
  return null;
end;
$$;

create trigger rooms_sync_total after insert or update or delete on public.rooms
  for each statement execute function app.sync_total_rooms();
create trigger room_types_sync_total after update of booking_mode on public.room_types
  for each statement execute function app.sync_total_rooms();

-- =============================================================================
-- 4) النزلاء
-- =============================================================================
create type public.guest_id_type as enum ('national_id', 'passport', 'residence', 'other');

create table public.guests (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hotels(id) on delete cascade,
  full_name         text not null check (length(trim(full_name)) > 0),
  phone             text,
  email             text,
  nationality       text,
  id_type           public.guest_id_type,
  id_number         text,
  date_of_birth     date,
  -- الشركة/الجهة التي يتبعها النزيل (من عملاء المحاسبة)
  customer_id       uuid,
  notes             text,
  is_blacklisted    boolean not null default false,
  blacklist_reason  text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id),
  unique (hotel_id, id),
  foreign key (hotel_id, customer_id) references public.customers (hotel_id, id),
  constraint guests_id_pair check ((id_type is null) = (nullif(trim(id_number), '') is null)),
  constraint guests_blacklist_reason check (not is_blacklisted or length(trim(coalesce(blacklist_reason, ''))) > 0)
);

-- لا يتكرر نفس رقم الهوية لنزيلين في الفندق
create unique index guests_identity_uq on public.guests (hotel_id, id_type, upper(trim(id_number))) where id_number is not null;
create index guests_name_idx on public.guests (hotel_id, full_name);
create index guests_phone_idx on public.guests (hotel_id, phone) where phone is not null;

create trigger guests_set_created before insert on public.guests for each row execute function app.set_created_by();
create trigger guests_set_updated before update on public.guests for each row execute function app.set_updated_at();

-- =============================================================================
-- 5) الأسعار: المواسم وعروض اللحظة الأخيرة
-- =============================================================================
create table public.rate_seasons (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  date_from   date not null,
  date_to     date not null,
  -- نسبة تعديل على السعر الأساسي للأنواع التي لم يُحدَّد لها سعر في الموسم (مثلًا 20 أو ‎-15)
  adjust_pct  numeric(6, 2) check (adjust_pct is null or (adjust_pct > -100 and adjust_pct <= 500)),
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  unique (hotel_id, id),
  constraint rate_seasons_dates check (date_to >= date_from),
  -- موسم واحد فعّال لكل يوم (لا غموض في السعر)
  constraint rate_seasons_no_overlap exclude using gist (
    hotel_id with =, daterange(date_from, date_to, '[]') with &&
  ) where (is_active)
);

create table public.rate_season_prices (
  season_id     uuid not null references public.rate_seasons(id) on delete cascade,
  hotel_id      uuid not null,
  room_type_id  uuid not null,
  nightly_rate  numeric(19, 4) not null check (nightly_rate >= 0),
  weekend_rate  numeric(19, 4) check (weekend_rate is null or weekend_rate >= 0),
  primary key (season_id, room_type_id),
  foreign key (hotel_id, room_type_id) references public.room_types (hotel_id, id) on delete cascade
);

create table public.last_minute_rules (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  -- null = كل الأنواع الليلية
  room_type_id  uuid,
  -- يُطبَّق إذا كان الوصول خلال هذا العدد من الأيام من تاريخ الحجز (0 = نفس اليوم)
  days_before   smallint not null check (days_before between 0 and 30),
  discount_pct  numeric(5, 2) not null check (discount_pct > 0 and discount_pct < 100),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id),
  unique (hotel_id, id),
  foreign key (hotel_id, room_type_id) references public.room_types (hotel_id, id) on delete cascade
);

create trigger rate_seasons_set_created before insert on public.rate_seasons for each row execute function app.set_created_by();
create trigger rate_seasons_set_updated before update on public.rate_seasons for each row execute function app.set_updated_at();
create trigger last_minute_rules_set_created before insert on public.last_minute_rules for each row execute function app.set_created_by();
create trigger last_minute_rules_set_updated before update on public.last_minute_rules for each row execute function app.set_updated_at();

-- =============================================================================
-- 6) الحجوزات
-- =============================================================================
create type public.reservation_status as enum ('tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');
create type public.reservation_source as enum (
  'direct', 'phone', 'walk_in', 'website', 'booking_com', 'expedia', 'agent', 'corporate', 'other'
);
-- standard: سعر كل ليلة من المواسم/الأساسي | fixed: سعر يدوي ثابت لكل ليلة | monthly: سعر شهري للإقامات الطويلة
create type public.reservation_pricing as enum ('standard', 'fixed', 'monthly');
create type public.series_status as enum ('active', 'cancelled');
create type public.waitlist_status as enum ('waiting', 'converted', 'cancelled');

create table public.reservation_groups (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid not null references public.hotels(id) on delete cascade,
  group_number     text not null,
  name             text not null check (length(trim(name)) > 0),
  customer_id      uuid,
  leader_guest_id  uuid,
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  unique (hotel_id, group_number),
  unique (hotel_id, id),
  foreign key (hotel_id, customer_id) references public.customers (hotel_id, id),
  foreign key (hotel_id, leader_guest_id) references public.guests (hotel_id, id)
);

create table public.reservation_series (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  guest_id      uuid not null,
  customer_id   uuid,
  room_type_id  uuid not null,
  room_id       uuid,
  -- يوم الوصول في الأسبوع (0 = الأحد … 6 = السبت)
  weekday       smallint not null check (weekday between 0 and 6),
  nights        smallint check (nights between 1 and 6),
  start_time    time,
  end_time      time,
  start_date    date not null,
  end_date      date not null,
  adults        smallint not null default 1,
  children      smallint not null default 0,
  status        public.series_status not null default 'active',
  notes         text,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  unique (hotel_id, id),
  foreign key (hotel_id, guest_id) references public.guests (hotel_id, id),
  foreign key (hotel_id, customer_id) references public.customers (hotel_id, id),
  foreign key (hotel_id, room_type_id) references public.room_types (hotel_id, id),
  foreign key (hotel_id, room_id) references public.rooms (hotel_id, id),
  constraint series_dates check (end_date >= start_date and end_date - start_date <= 366),
  constraint series_shape check ((nights is not null) <> (start_time is not null and end_time is not null))
);

create table public.reservations (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null references public.hotels(id) on delete cascade,
  confirmation_number  text not null,
  guest_id             uuid not null,
  -- جهة الفوترة (شركة/وكالة من عملاء المحاسبة)
  customer_id          uuid,
  room_type_id         uuid not null,
  room_id              uuid,
  booking_mode         public.pms_booking_mode not null,
  arrival_date         date not null,
  departure_date       date not null,
  -- للوحدات بالساعة: وقت البداية والنهاية بالتوقيت المحلي للفندق
  starts_at            timestamp,
  ends_at              timestamp,
  period               tsrange generated always as (
    case when booking_mode = 'hourly' then tsrange(starts_at, ends_at, '[)')
         else tsrange(arrival_date::timestamp, departure_date::timestamp, '[)') end
  ) stored,
  adults               smallint not null default 1 check (adults between 1 and 1000),
  children             smallint not null default 0 check (children between 0 and 50),
  status               public.reservation_status not null default 'confirmed',
  source               public.reservation_source not null default 'direct',
  pricing              public.reservation_pricing not null default 'standard',
  -- السعر اليدوي لليلة (fixed) أو السعر الشهري (monthly)
  fixed_rate           numeric(19, 4) check (fixed_rate is null or fixed_rate >= 0),
  rate_reason          text,
  last_minute_pct      numeric(5, 2),
  total_amount         numeric(19, 4) not null default 0,
  group_id             uuid,
  series_id            uuid,
  tentative_until      date,
  special_requests     text,
  notes                text,
  cancelled_at         timestamptz,
  cancelled_by         uuid references auth.users(id),
  cancellation_reason  text,
  folio_id             uuid,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users(id),
  unique (hotel_id, confirmation_number),
  unique (hotel_id, id),
  foreign key (hotel_id, guest_id) references public.guests (hotel_id, id),
  foreign key (hotel_id, customer_id) references public.customers (hotel_id, id),
  foreign key (hotel_id, room_type_id) references public.room_types (hotel_id, id),
  foreign key (hotel_id, room_id) references public.rooms (hotel_id, id),
  foreign key (hotel_id, group_id) references public.reservation_groups (hotel_id, id),
  foreign key (hotel_id, series_id) references public.reservation_series (hotel_id, id),
  foreign key (hotel_id, folio_id) references public.guest_folios (hotel_id, id),
  constraint reservation_shape check (
    (booking_mode = 'nightly' and starts_at is null and ends_at is null
      and departure_date > arrival_date and departure_date - arrival_date <= 366)
    or (booking_mode = 'hourly' and room_id is not null and starts_at is not null and ends_at > starts_at
      and ends_at - starts_at <= interval '24 hours'
      and arrival_date = starts_at::date and departure_date = ends_at::date)
  ),
  -- لا تُحجز نفس الغرفة لفترتين متداخلتين أبدًا (حتى لو ضغط موظفان في نفس اللحظة)
  constraint reservation_room_no_overlap exclude using gist (room_id with =, period with &&)
    where (room_id is not null and status in ('tentative', 'confirmed', 'checked_in'))
);

create index reservations_dates_idx on public.reservations (hotel_id, arrival_date, departure_date);
create index reservations_type_idx on public.reservations (room_type_id, arrival_date);
create index reservations_guest_idx on public.reservations (guest_id);
create index reservations_series_idx on public.reservations (series_id) where series_id is not null;
create index reservations_group_idx on public.reservations (group_id) where group_id is not null;

-- سعر كل ليلة مثبّت لحظة الحجز (أو ساعات الوحدة بالساعة في سطر واحد)
create table public.reservation_nights (
  reservation_id  uuid not null references public.reservations(id) on delete cascade,
  hotel_id        uuid not null,
  stay_date       date not null,
  quantity        numeric(8, 2) not null default 1 check (quantity > 0),
  rate            numeric(19, 4) not null check (rate >= 0),
  discount        numeric(19, 4) not null default 0 check (discount >= 0),
  amount          numeric(19, 4) not null check (amount >= 0),
  season_id       uuid references public.rate_seasons(id) on delete set null,
  primary key (reservation_id, stay_date)
);

create index reservation_nights_date_idx on public.reservation_nights (hotel_id, stay_date);

create table public.waitlist_entries (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  guest_id        uuid,
  guest_name      text not null check (length(trim(guest_name)) > 0),
  phone           text,
  room_type_id    uuid not null,
  arrival_date    date not null,
  departure_date  date not null,
  adults          smallint not null default 1 check (adults between 1 and 50),
  children        smallint not null default 0 check (children between 0 and 50),
  notes           text,
  status          public.waitlist_status not null default 'waiting',
  reservation_id  uuid,
  series_id       uuid,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  unique (hotel_id, id),
  foreign key (hotel_id, guest_id) references public.guests (hotel_id, id),
  foreign key (hotel_id, room_type_id) references public.room_types (hotel_id, id),
  foreign key (hotel_id, reservation_id) references public.reservations (hotel_id, id),
  foreign key (hotel_id, series_id) references public.reservation_series (hotel_id, id),
  constraint waitlist_dates check (departure_date > arrival_date and departure_date - arrival_date <= 366)
);

create index waitlist_status_idx on public.waitlist_entries (hotel_id, status, arrival_date);

create trigger reservations_set_created before insert on public.reservations for each row execute function app.set_created_by();
create trigger reservations_set_updated before update on public.reservations for each row execute function app.set_updated_at();
create trigger waitlist_set_created before insert on public.waitlist_entries for each row execute function app.set_created_by();
create trigger waitlist_set_updated before update on public.waitlist_entries for each row execute function app.set_updated_at();

-- نوع الحجز (ليلي/بالساعة) ثابت بعد وجود حجوزات، وكذلك نوع الغرفة التي عليها حجوزات قائمة
create or replace function app.room_types_protect_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_mode is distinct from old.booking_mode
     and exists (select 1 from public.reservations where room_type_id = old.id) then
    raise exception 'Booking mode cannot change after the room type has reservations' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger room_types_protect_mode before update on public.room_types
  for each row execute function app.room_types_protect_mode();

create or replace function app.rooms_protect_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.room_type_id is distinct from old.room_type_id and exists (
    select 1 from public.reservations
    where room_id = old.id and status in ('tentative', 'confirmed', 'checked_in')
  ) then
    raise exception 'Room has active reservations; move them before changing its type' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger rooms_protect_type before update on public.rooms
  for each row execute function app.rooms_protect_type();

-- =============================================================================
-- 7) دوال التسعير والسعة (داخلية)
-- =============================================================================

-- سعر ليلة واحدة لنوع غرفة: موسم فعّال (سعر النوع فيه أو نسبة التعديل) وإلا السعر الأساسي،
-- مع سعر نهاية الأسبوع إن وُجد
create or replace function app.pms_night_rate(p_room_type_id uuid, p_date date)
returns table (rate numeric, season_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t        public.room_types%rowtype;
  v_weekend  boolean;
  v_dec      smallint;
  v_s        public.rate_seasons%rowtype;
  v_p        public.rate_season_prices%rowtype;
  v_base     numeric;
begin
  select * into v_t from public.room_types where id = p_room_type_id;
  select extract(dow from p_date)::smallint = any (h.weekend_nights), c.decimals
    into v_weekend, v_dec
    from public.hotels h join public.currencies c on c.code = h.base_currency
   where h.id = v_t.hotel_id;

  v_base := case when v_weekend then coalesce(v_t.weekend_rate, v_t.base_rate) else v_t.base_rate end;

  select * into v_s from public.rate_seasons s
   where s.hotel_id = v_t.hotel_id and s.is_active and p_date between s.date_from and s.date_to
   limit 1;
  if v_s.id is null then
    return query select round(v_base, v_dec), null::uuid;
    return;
  end if;

  select * into v_p from public.rate_season_prices sp where sp.season_id = v_s.id and sp.room_type_id = p_room_type_id;
  if v_p.season_id is not null then
    return query select round(case when v_weekend then coalesce(v_p.weekend_rate, v_p.nightly_rate) else v_p.nightly_rate end, v_dec), v_s.id;
    return;
  end if;
  return query select round(v_base * (1 + coalesce(v_s.adjust_pct, 0) / 100), v_dec), v_s.id;
end;
$$;

-- أعلى خصم لحظة أخيرة ينطبق على نوع الغرفة وتاريخ الوصول (من تاريخ اليوم)
create or replace function app.pms_last_minute_pct(p_room_type_id uuid, p_arrival date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select max(r.discount_pct)
  from public.room_types t
  join public.last_minute_rules r on r.hotel_id = t.hotel_id and r.is_active
   and (r.room_type_id is null or r.room_type_id = t.id)
  where t.id = p_room_type_id and t.booking_mode = 'nightly'
    and p_arrival - app.today_for_hotel(t.hotel_id) between 0 and r.days_before;
$$;

-- أسطر تسعير الحجز: ليلة لكل سطر (أو سطر ساعات للوحدات بالساعة)
create or replace function app.pms_price_lines(
  p_room_type_id  uuid,
  p_arrival       date,
  p_departure     date,
  p_pricing       public.reservation_pricing,
  p_fixed_rate    numeric,
  p_starts_at     timestamp,
  p_ends_at       timestamp,
  p_lm_pct        numeric
)
returns table (stay_date date, quantity numeric, rate numeric, discount numeric, amount numeric, season_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t      public.room_types%rowtype;
  v_dec    smallint;
  v_d      date;
  v_r      record;
  v_hours  numeric;
  v_rate   numeric;
  v_disc   numeric;
  v_seg_start date;
  v_seg_end   date;
  v_n         integer;
  v_dim       integer;
  v_seg_total numeric;
  v_each      numeric;
  v_i         integer;
begin
  select * into v_t from public.room_types where id = p_room_type_id;
  select c.decimals into v_dec from public.hotels h join public.currencies c on c.code = h.base_currency where h.id = v_t.hotel_id;

  if v_t.booking_mode = 'hourly' then
    v_hours := round(extract(epoch from (p_ends_at - p_starts_at)) / 3600, 2);
    v_rate := case when p_pricing = 'fixed' then p_fixed_rate else v_t.base_rate end;
    return query select p_starts_at::date, v_hours, round(v_rate, v_dec), 0::numeric, round(v_rate * v_hours, v_dec), null::uuid;
    return;
  end if;

  if p_pricing = 'fixed' then
    return query
      select d::date, 1::numeric, round(p_fixed_rate, v_dec), 0::numeric, round(p_fixed_rate, v_dec), null::uuid
      from generate_series(p_arrival, p_departure - 1, interval '1 day') d;
    return;
  end if;

  if p_pricing = 'monthly' then
    -- السعر الشهري يوزَّع على ليالي كل شهر تقويمي بنسبة أيامه، والفرق من التقريب على آخر ليلة في الشهر
    v_seg_start := p_arrival;
    while v_seg_start < p_departure loop
      v_seg_end := least(p_departure, (date_trunc('month', v_seg_start) + interval '1 month')::date);
      v_n := v_seg_end - v_seg_start;
      v_dim := extract(day from (date_trunc('month', v_seg_start) + interval '1 month - 1 day'))::integer;
      v_seg_total := round(p_fixed_rate * v_n / v_dim, v_dec);
      v_each := round(v_seg_total / v_n, v_dec);
      for v_i in 0 .. v_n - 1 loop
        v_rate := case when v_i = v_n - 1 then v_seg_total - v_each * (v_n - 1) else v_each end;
        return query select v_seg_start + v_i, 1::numeric, v_rate, 0::numeric, v_rate, null::uuid;
      end loop;
      v_seg_start := v_seg_end;
    end loop;
    return;
  end if;

  v_d := p_arrival;
  while v_d < p_departure loop
    select * into v_r from app.pms_night_rate(p_room_type_id, v_d);
    v_disc := round(v_r.rate * coalesce(p_lm_pct, 0) / 100, v_dec);
    return query select v_d, 1::numeric, v_r.rate, v_disc, v_r.rate - v_disc, v_r.season_id;
    v_d := v_d + 1;
  end loop;
end;
$$;

-- عدد الغرف القابلة للبيع من النوع (النشطة وفي الخدمة)
create or replace function app.pms_type_capacity(p_room_type_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.rooms
  where room_type_id = p_room_type_id and is_active and service_status = 'in_service';
$$;

-- الحجوزات القائمة على النوع في ليلة معيّنة (محجوز، مؤكد، مقيم)
create or replace function app.pms_type_sold(p_room_type_id uuid, p_date date, p_exclude uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.reservations
  where room_type_id = p_room_type_id
    and status in ('tentative', 'confirmed', 'checked_in')
    and p_date >= arrival_date and p_date < departure_date
    and (p_exclude is null or id <> p_exclude);
$$;

-- التحقق من السعة لكل ليلة. يُرجع true إن كان الحجز فوق السعة (حجز زائد مسموح به).
-- الخطأ بالرمز 23P01 (تعارض) ليتمكن الحجز المتكرر من تخطي الموعد المتعارض فقط.
create or replace function app.pms_check_availability(
  p_room_type_id uuid, p_arrival date, p_departure date, p_exclude uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t      public.room_types%rowtype;
  v_cap    integer;
  v_d      date;
  v_sold   integer;
  v_over   boolean := false;
begin
  select * into v_t from public.room_types where id = p_room_type_id;
  v_cap := app.pms_type_capacity(p_room_type_id);
  v_d := p_arrival;
  while v_d < p_departure loop
    v_sold := app.pms_type_sold(p_room_type_id, v_d, p_exclude);
    if v_sold + 1 > v_cap then
      if v_t.overbooking_limit = 0 then
        raise exception 'No availability for this room type on % (rooms %, booked %)', v_d, v_cap, v_sold
          using errcode = '23P01';
      end if;
      if v_sold + 1 > v_cap + v_t.overbooking_limit then
        raise exception 'Overbooking limit reached for this room type on % (limit %)', v_d, v_t.overbooking_limit
          using errcode = '23P01';
      end if;
      v_over := true;
    end if;
    v_d := v_d + 1;
  end loop;
  if v_over and auth.uid() is not null and not app.has_permission(v_t.hotel_id, 'pms.reservations.overbook') then
    raise exception 'Booking beyond room capacity requires the overbooking permission' using errcode = '23P01';
  end if;
  return v_over;
end;
$$;

-- التحقق من الغرفة المخصصة: من نفس الفندق والنوع، نشطة وفي الخدمة، وغير محجوزة لفترة متداخلة
create or replace function app.pms_check_room(
  p_room_id uuid, p_room_type_id uuid, p_period tsrange, p_exclude uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.id is null or not v_room.is_active then
    raise exception 'Room not found or inactive' using errcode = '23503';
  end if;
  if v_room.room_type_id <> p_room_type_id then
    raise exception 'Room % does not match the reservation room type', v_room.room_number using errcode = '23514';
  end if;
  if v_room.service_status <> 'in_service' then
    raise exception 'Room % is out of service', v_room.room_number using errcode = '23514';
  end if;
  if exists (
    select 1 from public.reservations r
    where r.room_id = p_room_id and r.status in ('tentative', 'confirmed', 'checked_in')
      and r.period && p_period and (p_exclude is null or r.id <> p_exclude)
  ) then
    raise exception 'Room % is already booked for an overlapping period', v_room.room_number using errcode = '23P01';
  end if;
end;
$$;

-- إعادة كتابة أسطر الليالي: الليالي الباقية تحتفظ بسعرها المثبّت، والجديدة تُسعَّر الآن
create or replace function app.pms_write_nights(p_reservation_id uuid, p_keep_existing boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = p_reservation_id;

  if p_keep_existing and v_r.pricing = 'standard' and v_r.booking_mode = 'nightly' then
    delete from public.reservation_nights e
     where e.reservation_id = p_reservation_id
       and (e.stay_date < v_r.arrival_date or e.stay_date >= v_r.departure_date);
  else
    delete from public.reservation_nights e where e.reservation_id = p_reservation_id;
  end if;

  insert into public.reservation_nights (reservation_id, hotel_id, stay_date, quantity, rate, discount, amount, season_id)
  select p_reservation_id, v_r.hotel_id, l.stay_date, l.quantity, l.rate, l.discount, l.amount, l.season_id
  from app.pms_price_lines(v_r.room_type_id, v_r.arrival_date, v_r.departure_date, v_r.pricing,
                           v_r.fixed_rate, v_r.starts_at, v_r.ends_at, v_r.last_minute_pct) l
  where not exists (
    select 1 from public.reservation_nights e where e.reservation_id = p_reservation_id and e.stay_date = l.stay_date
  );

  update public.reservations
     set total_amount = (select coalesce(sum(n.amount), 0) from public.reservation_nights n where n.reservation_id = p_reservation_id)
   where id = p_reservation_id;
end;
$$;

-- التحقق المشترك لبيانات الحجز (الإنشاء والتعديل)
create or replace function app.pms_validate_stay(
  p_t           public.room_types,
  p_arrival     date,
  p_departure   date,
  p_starts_at   timestamp,
  p_ends_at     timestamp,
  p_adults      integer,
  p_children    integer,
  p_pricing     public.reservation_pricing,
  p_fixed_rate  numeric,
  p_rate_reason text,
  p_check_past  boolean
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.today_for_hotel(p_t.hotel_id);
begin
  if p_adults > p_t.max_adults or p_children > p_t.max_children then
    raise exception 'Occupancy exceeds the room type capacity (max % adults, % children)', p_t.max_adults, p_t.max_children
      using errcode = '23514';
  end if;

  if p_t.booking_mode = 'nightly' then
    if p_arrival is null or p_departure is null or p_departure <= p_arrival or p_departure - p_arrival > 366 then
      raise exception 'Stay must be between 1 and 366 nights' using errcode = '23514';
    end if;
    if p_check_past and p_arrival < v_today then
      raise exception 'Arrival date cannot be in the past' using errcode = '23514';
    end if;
  else
    if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '24 hours' then
      raise exception 'Invalid booking time range' using errcode = '23514';
    end if;
    if extract(epoch from (p_ends_at - p_starts_at)) / 3600 < p_t.min_hours then
      raise exception 'Minimum booking for this unit is % hours', p_t.min_hours using errcode = '23514';
    end if;
    if p_check_past and p_starts_at::date < v_today then
      raise exception 'Arrival date cannot be in the past' using errcode = '23514';
    end if;
  end if;

  if p_pricing <> 'standard' then
    if p_fixed_rate is null or p_fixed_rate < 0 then
      raise exception 'Enter the manual rate' using errcode = '23514';
    end if;
    if auth.uid() is not null and not app.has_permission(p_t.hotel_id, 'pms.rates.override') then
      raise exception 'Permission denied: pms.rates.override' using errcode = '42501';
    end if;
  end if;
  if p_pricing = 'fixed' and length(trim(coalesce(p_rate_reason, ''))) = 0 then
    raise exception 'A reason is required for a manual rate' using errcode = '23514';
  end if;
  if p_pricing = 'monthly' then
    if p_t.booking_mode <> 'nightly' then
      raise exception 'Monthly pricing is for nightly room types' using errcode = '23514';
    end if;
    if p_departure - p_arrival < 28 then
      raise exception 'Monthly pricing requires a stay of at least 28 nights' using errcode = '23514';
    end if;
  end if;
end;
$$;

-- =============================================================================
-- 8) واجهات RPC للحجوزات
-- =============================================================================

create or replace function public.create_reservation(
  p_hotel_id          uuid,
  p_guest_id          uuid,
  p_room_type_id      uuid,
  p_arrival_date      date default null,
  p_departure_date    date default null,
  p_adults            smallint default 1,
  p_children          smallint default 0,
  p_room_id           uuid default null,
  p_status            public.reservation_status default 'confirmed',
  p_source            public.reservation_source default 'direct',
  p_customer_id       uuid default null,
  p_pricing           public.reservation_pricing default 'standard',
  p_fixed_rate        numeric default null,
  p_rate_reason       text default null,
  p_starts_at         timestamp default null,
  p_ends_at           timestamp default null,
  p_special_requests  text default null,
  p_notes             text default null,
  p_tentative_until   date default null,
  p_group_id          uuid default null,
  p_series_id         uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t      public.room_types%rowtype;
  v_guest  public.guests%rowtype;
  v_arr    date := p_arrival_date;
  v_dep    date := p_departure_date;
  v_id     uuid;
  v_lm     numeric;
begin
  perform app.require_permission(p_hotel_id, 'pms.reservations.manage');

  -- قفل النوع: كل الحجوزات على نفس النوع تتسلسل، فلا يتجاوز حجزان متزامنان السعة
  select * into v_t from public.room_types where id = p_room_type_id and hotel_id = p_hotel_id for update;
  if v_t.id is null or not v_t.is_active then
    raise exception 'Room type not found or inactive' using errcode = '23503';
  end if;

  select * into v_guest from public.guests where id = p_guest_id and hotel_id = p_hotel_id;
  if v_guest.id is null then
    raise exception 'Guest not found' using errcode = '23503';
  end if;
  if v_guest.is_blacklisted then
    raise exception 'Guest is blacklisted: %', v_guest.blacklist_reason using errcode = '23514';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id and hotel_id = p_hotel_id and is_active
  ) then
    raise exception 'Customer not found or inactive' using errcode = '23503';
  end if;
  if p_status not in ('tentative', 'confirmed') then
    raise exception 'New reservations must be tentative or confirmed' using errcode = '23514';
  end if;

  if v_t.booking_mode = 'hourly' then
    if p_room_id is null then
      raise exception 'Hourly units require a specific unit' using errcode = '23514';
    end if;
    v_arr := p_starts_at::date;
    v_dep := p_ends_at::date;
  else
    -- أوقات البداية والنهاية للوحدات بالساعة فقط
    p_starts_at := null;
    p_ends_at := null;
  end if;

  perform app.pms_validate_stay(v_t, v_arr, v_dep, p_starts_at, p_ends_at, coalesce(p_adults, 1), coalesce(p_children, 0),
                                p_pricing, p_fixed_rate, p_rate_reason, true);

  if p_room_id is not null then
    perform app.pms_check_room(p_room_id, p_room_type_id,
      case when v_t.booking_mode = 'hourly' then tsrange(p_starts_at, p_ends_at, '[)')
           else tsrange(v_arr::timestamp, v_dep::timestamp, '[)') end, null);
  end if;
  if v_t.booking_mode = 'nightly' then
    perform app.pms_check_availability(p_room_type_id, v_arr, v_dep, null);
    if p_pricing = 'standard' then
      v_lm := app.pms_last_minute_pct(p_room_type_id, v_arr);
    end if;
  end if;

  insert into public.reservations (
    hotel_id, confirmation_number, guest_id, customer_id, room_type_id, room_id, booking_mode,
    arrival_date, departure_date, starts_at, ends_at, adults, children, status, source,
    pricing, fixed_rate, rate_reason, last_minute_pct, group_id, series_id, tentative_until,
    special_requests, notes, created_by
  ) values (
    p_hotel_id, app.next_document_number(p_hotel_id, 'reservation', 'RSV', app.today_for_hotel(p_hotel_id)),
    p_guest_id, coalesce(p_customer_id, v_guest.customer_id), p_room_type_id, p_room_id, v_t.booking_mode,
    v_arr, v_dep, p_starts_at, p_ends_at, coalesce(p_adults, 1), coalesce(p_children, 0), p_status, p_source,
    p_pricing, case when p_pricing = 'standard' then null else p_fixed_rate end, nullif(trim(p_rate_reason), ''),
    v_lm, p_group_id, p_series_id, case when p_status = 'tentative' then p_tentative_until end,
    nullif(trim(p_special_requests), ''), nullif(trim(p_notes), ''), auth.uid()
  ) returning id into v_id;

  perform app.pms_write_nights(v_id, false);
  return v_id;
end;
$$;

create or replace function public.update_reservation(
  p_reservation_id    uuid,
  p_room_type_id      uuid,
  p_arrival_date      date default null,
  p_departure_date    date default null,
  p_adults            smallint default 1,
  p_children          smallint default 0,
  p_source            public.reservation_source default 'direct',
  p_customer_id       uuid default null,
  p_pricing           public.reservation_pricing default 'standard',
  p_fixed_rate        numeric default null,
  p_rate_reason       text default null,
  p_starts_at         timestamp default null,
  p_ends_at           timestamp default null,
  p_special_requests  text default null,
  p_notes             text default null,
  p_tentative_until   date default null,
  p_reprice           boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r        public.reservations%rowtype;
  v_t        public.room_types%rowtype;
  v_arr      date := p_arrival_date;
  v_dep      date := p_departure_date;
  v_room     uuid;
  v_keep     boolean;
  v_lm       numeric;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status not in ('tentative', 'confirmed') then
    raise exception 'Only tentative or confirmed reservations can be edited' using errcode = '23514';
  end if;

  -- قفل النوعين بترتيب ثابت لتفادي الاستعصاء
  perform 1 from public.room_types where id in (v_r.room_type_id, p_room_type_id) order by id for update;
  select * into v_t from public.room_types where id = p_room_type_id and hotel_id = v_r.hotel_id;
  if v_t.id is null or not v_t.is_active then
    raise exception 'Room type not found or inactive' using errcode = '23503';
  end if;
  if v_t.booking_mode <> v_r.booking_mode then
    raise exception 'Cannot switch between nightly and hourly bookings; create a new reservation' using errcode = '23514';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id and hotel_id = v_r.hotel_id and is_active
  ) then
    raise exception 'Customer not found or inactive' using errcode = '23503';
  end if;

  if v_t.booking_mode = 'hourly' then
    v_arr := p_starts_at::date;
    v_dep := p_ends_at::date;
  else
    p_starts_at := null;
    p_ends_at := null;
  end if;

  perform app.pms_validate_stay(v_t, v_arr, v_dep, p_starts_at, p_ends_at, coalesce(p_adults, 1), coalesce(p_children, 0),
                                p_pricing, p_fixed_rate, p_rate_reason,
                                v_arr is distinct from v_r.arrival_date or p_starts_at is distinct from v_r.starts_at);

  -- تغيير النوع يلغي تخصيص الغرفة الليلية (الغرفة من نوع آخر)؛ الوحدات بالساعة يُغيَّر نوعها بحجز جديد
  v_room := v_r.room_id;
  if p_room_type_id <> v_r.room_type_id then
    if v_t.booking_mode = 'hourly' then
      raise exception 'Hourly units require a specific unit' using errcode = '23514';
    end if;
    v_room := null;
  end if;
  if v_room is not null then
    perform app.pms_check_room(v_room, p_room_type_id,
      case when v_t.booking_mode = 'hourly' then tsrange(p_starts_at, p_ends_at, '[)')
           else tsrange(v_arr::timestamp, v_dep::timestamp, '[)') end, v_r.id);
  end if;
  if v_t.booking_mode = 'nightly' then
    perform app.pms_check_availability(p_room_type_id, v_arr, v_dep, v_r.id);
  end if;

  v_keep := not p_reprice and p_room_type_id = v_r.room_type_id and p_pricing = v_r.pricing;
  -- الليالي المضافة تُسعَّر بخصم اللحظة الأخيرة الساري الآن فقط
  v_lm := case when p_pricing = 'standard' and v_t.booking_mode = 'nightly' then app.pms_last_minute_pct(p_room_type_id, v_arr) end;

  update public.reservations set
    room_type_id = p_room_type_id, room_id = v_room, arrival_date = v_arr, departure_date = v_dep,
    starts_at = p_starts_at, ends_at = p_ends_at, adults = coalesce(p_adults, 1), children = coalesce(p_children, 0),
    source = p_source, customer_id = p_customer_id, pricing = p_pricing,
    fixed_rate = case when p_pricing = 'standard' then null else p_fixed_rate end,
    rate_reason = nullif(trim(p_rate_reason), ''), last_minute_pct = v_lm,
    special_requests = nullif(trim(p_special_requests), ''), notes = nullif(trim(p_notes), ''),
    tentative_until = case when v_r.status = 'tentative' then p_tentative_until end
  where id = v_r.id;

  perform app.pms_write_nights(v_r.id, v_keep);
end;
$$;

create or replace function public.assign_reservation_room(p_reservation_id uuid, p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status not in ('tentative', 'confirmed') then
    raise exception 'Only tentative or confirmed reservations can be edited' using errcode = '23514';
  end if;
  if p_room_id is null then
    if v_r.booking_mode = 'hourly' then
      raise exception 'Hourly units require a specific unit' using errcode = '23514';
    end if;
  else
    perform app.pms_check_room(p_room_id, v_r.room_type_id, v_r.period, v_r.id);
  end if;
  update public.reservations set room_id = p_room_id where id = v_r.id;
end;
$$;

create or replace function public.confirm_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status <> 'tentative' then
    raise exception 'Only tentative reservations can be confirmed' using errcode = '23514';
  end if;
  update public.reservations set status = 'confirmed', tentative_until = null where id = v_r.id;
end;
$$;

create or replace function public.cancel_reservation(p_reservation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.cancel');
  if v_r.status not in ('tentative', 'confirmed') then
    raise exception 'Only tentative or confirmed reservations can be cancelled' using errcode = '23514';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to cancel a reservation' using errcode = '23514';
  end if;
  update public.reservations
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = trim(p_reason)
   where id = v_r.id;
end;
$$;

create or replace function public.mark_reservation_no_show(p_reservation_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.cancel');
  if v_r.status not in ('tentative', 'confirmed') then
    raise exception 'Only tentative or confirmed reservations can be marked as no-show' using errcode = '23514';
  end if;
  if v_r.arrival_date > app.today_for_hotel(v_r.hotel_id) then
    raise exception 'No-show can only be recorded on or after the arrival date' using errcode = '23514';
  end if;
  update public.reservations
     set status = 'no_show', cancelled_at = now(), cancelled_by = auth.uid(),
         cancellation_reason = nullif(trim(p_reason), '')
   where id = v_r.id;
end;
$$;

-- عرض سعر مباشر قبل الحفظ: الليالي بأسعارها ومواسمها والخصم والإجمالي، وحالة السعة
create or replace function public.quote_reservation(
  p_hotel_id        uuid,
  p_room_type_id    uuid,
  p_arrival_date    date default null,
  p_departure_date  date default null,
  p_pricing         public.reservation_pricing default 'standard',
  p_fixed_rate      numeric default null,
  p_starts_at       timestamp default null,
  p_ends_at         timestamp default null,
  p_exclude_reservation_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t      public.room_types%rowtype;
  v_lm     numeric;
  v_lines  jsonb;
  v_cap    integer;
  v_min    integer;
  v_arr    date := p_arrival_date;
  v_dep    date := p_departure_date;
begin
  perform app.require_permission(p_hotel_id, 'pms.reservations.view');
  select * into v_t from public.room_types where id = p_room_type_id and hotel_id = p_hotel_id;
  if v_t.id is null then
    raise exception 'Room type not found or inactive' using errcode = '23503';
  end if;
  if v_t.booking_mode = 'hourly' then
    if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '24 hours' then
      raise exception 'Invalid booking time range' using errcode = '23514';
    end if;
    v_arr := p_starts_at::date;
    v_dep := p_ends_at::date;
  elsif v_arr is null or v_dep is null or v_dep <= v_arr or v_dep - v_arr > 366 then
    raise exception 'Stay must be between 1 and 366 nights' using errcode = '23514';
  end if;
  if p_pricing <> 'standard' and p_fixed_rate is null then
    raise exception 'Enter the manual rate' using errcode = '23514';
  end if;

  if p_pricing = 'standard' and v_t.booking_mode = 'nightly' then
    v_lm := app.pms_last_minute_pct(p_room_type_id, v_arr);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'date', l.stay_date, 'quantity', l.quantity, 'rate', l.rate, 'discount', l.discount, 'amount', l.amount,
           'season', s.name) order by l.stay_date), '[]'::jsonb)
    into v_lines
    from app.pms_price_lines(p_room_type_id, v_arr, v_dep, p_pricing, p_fixed_rate, p_starts_at, p_ends_at, v_lm) l
    left join public.rate_seasons s on s.id = l.season_id;

  if v_t.booking_mode = 'nightly' then
    v_cap := app.pms_type_capacity(p_room_type_id);
    select min(v_cap - app.pms_type_sold(p_room_type_id, d::date, p_exclude_reservation_id))
      into v_min
      from generate_series(v_arr, v_dep - 1, interval '1 day') d;
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'total', (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(v_lines) x),
    'discount', (select coalesce(sum((x ->> 'discount')::numeric), 0) from jsonb_array_elements(v_lines) x),
    'nights', case when v_t.booking_mode = 'nightly' then v_dep - v_arr end,
    'last_minute_pct', v_lm,
    'booking_mode', v_t.booking_mode,
    'capacity', v_cap,
    'min_available', v_min,
    'overbooking_limit', v_t.overbooking_limit
  );
end;
$$;

-- السعة والمحجوز لكل نوع ليلي ولكل يوم (جدول الإشغال وتوفر الغرف)
create or replace function public.room_type_availability(p_hotel_id uuid, p_from date, p_to date)
returns table (room_type_id uuid, stay_date date, capacity integer, sold integer, available integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'pms.reservations.view');
  if p_to <= p_from or p_to - p_from > 93 then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  return query
  with rooms_by_type as (
    select r.room_type_id as type_id, count(*)::integer as n
    from public.rooms r
    where r.hotel_id = p_hotel_id and r.is_active and r.service_status = 'in_service'
    group by r.room_type_id
  ),
  booked_by_day as (
    select x.room_type_id as type_id, d::date as day, count(*)::integer as n
    from public.reservations x
    cross join lateral generate_series(greatest(x.arrival_date, p_from), least(x.departure_date, p_to) - 1, interval '1 day') d
    where x.hotel_id = p_hotel_id and x.booking_mode = 'nightly'
      and x.status in ('tentative', 'confirmed', 'checked_in')
      and x.arrival_date < p_to and x.departure_date > p_from
    group by x.room_type_id, d::date
  )
  select t.id, g::date, coalesce(rt.n, 0), coalesce(bd.n, 0), coalesce(rt.n, 0) - coalesce(bd.n, 0)
  from public.room_types t
  cross join generate_series(p_from, p_to - 1, interval '1 day') g
  left join rooms_by_type rt on rt.type_id = t.id
  left join booked_by_day bd on bd.type_id = t.id and bd.day = g::date
  where t.hotel_id = p_hotel_id and t.booking_mode = 'nightly' and t.is_active
  order by t.sort_order, t.code, g;
end;
$$;

-- =============================================================================
-- 9) الحجوزات الجماعية والمتكررة
-- =============================================================================
create or replace function public.create_group_reservation(
  p_hotel_id        uuid,
  p_name            text,
  p_guest_id        uuid,
  p_room_type_id    uuid,
  p_arrival_date    date,
  p_departure_date  date,
  p_rooms           smallint,
  p_adults          smallint default 1,
  p_children        smallint default 0,
  p_customer_id     uuid default null,
  p_status          public.reservation_status default 'confirmed',
  p_source          public.reservation_source default 'direct',
  p_notes           text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_i     integer;
begin
  perform app.require_permission(p_hotel_id, 'pms.reservations.manage');
  if p_rooms is null or p_rooms < 1 or p_rooms > 200 then
    raise exception 'A group can have between 1 and 200 rooms' using errcode = '23514';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Group name is required' using errcode = '23514';
  end if;
  insert into public.reservation_groups (hotel_id, group_number, name, customer_id, leader_guest_id, notes, created_by)
  values (p_hotel_id, app.next_document_number(p_hotel_id, 'reservation_group', 'GRP', app.today_for_hotel(p_hotel_id)),
          trim(p_name), p_customer_id, p_guest_id, nullif(trim(p_notes), ''), auth.uid())
  returning id into v_group;

  -- كل غرف المجموعة في معاملة واحدة: إن لم تكفِ السعة لا يُحجز شيء
  for v_i in 1 .. p_rooms loop
    perform public.create_reservation(
      p_hotel_id => p_hotel_id, p_guest_id => p_guest_id, p_room_type_id => p_room_type_id,
      p_arrival_date => p_arrival_date, p_departure_date => p_departure_date,
      p_adults => p_adults, p_children => p_children, p_status => p_status, p_source => p_source,
      p_customer_id => p_customer_id, p_notes => p_notes, p_group_id => v_group);
  end loop;
  return v_group;
end;
$$;

-- حجز متكرر أسبوعيًا (مثلًا كل خميس لليلتين، أو قاعة كل جمعة من 4 إلى 8).
-- المواعيد المتعارضة تُتخطى وتُضاف لقائمة الانتظار اختياريًا؛ الناتج: عدد ما حُجز وتواريخ ما تُخطي.
create or replace function public.create_reservation_series(
  p_hotel_id            uuid,
  p_guest_id            uuid,
  p_room_type_id        uuid,
  p_weekday             smallint,
  p_start_date          date,
  p_end_date            date,
  p_nights              smallint default null,
  p_start_time          time default null,
  p_end_time            time default null,
  p_room_id             uuid default null,
  p_adults              smallint default 1,
  p_children            smallint default 0,
  p_customer_id         uuid default null,
  p_source              public.reservation_source default 'direct',
  p_notes               text default null,
  p_waitlist_conflicts  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t        public.room_types%rowtype;
  v_series   uuid;
  v_d        date;
  v_count    integer := 0;
  v_skipped  date[] := '{}';
  v_wait     integer := 0;
  v_guest    public.guests%rowtype;
  v_occ      integer;
begin
  perform app.require_permission(p_hotel_id, 'pms.reservations.manage');
  select * into v_t from public.room_types where id = p_room_type_id and hotel_id = p_hotel_id;
  if v_t.id is null or not v_t.is_active then
    raise exception 'Room type not found or inactive' using errcode = '23503';
  end if;
  if p_weekday is null or p_weekday not between 0 and 6 or p_start_date is null or p_end_date is null
     or p_end_date < p_start_date or p_end_date - p_start_date > 366 then
    raise exception 'Invalid date range' using errcode = '23514';
  end if;
  if v_t.booking_mode = 'nightly' and (p_nights is null or p_nights not between 1 and 6) then
    raise exception 'Recurring stays must be between 1 and 6 nights' using errcode = '23514';
  end if;
  if v_t.booking_mode = 'hourly' and (p_start_time is null or p_end_time is null or p_end_time <= p_start_time) then
    raise exception 'Invalid booking time range' using errcode = '23514';
  end if;
  select count(*) into v_occ from generate_series(p_start_date, p_end_date, interval '1 day') d
   where extract(dow from d)::smallint = p_weekday;
  if v_occ = 0 then
    raise exception 'The selected weekday does not occur in this date range' using errcode = '23514';
  end if;
  select * into v_guest from public.guests where id = p_guest_id and hotel_id = p_hotel_id;

  insert into public.reservation_series (
    hotel_id, guest_id, customer_id, room_type_id, room_id, weekday, nights, start_time, end_time,
    start_date, end_date, adults, children, notes, created_by
  ) values (
    p_hotel_id, p_guest_id, p_customer_id, p_room_type_id, p_room_id, p_weekday,
    case when v_t.booking_mode = 'nightly' then p_nights end,
    case when v_t.booking_mode = 'hourly' then p_start_time end,
    case when v_t.booking_mode = 'hourly' then p_end_time end,
    p_start_date, p_end_date, coalesce(p_adults, 1), coalesce(p_children, 0), nullif(trim(p_notes), ''), auth.uid()
  ) returning id into v_series;

  for v_d in
    select d::date from generate_series(p_start_date, p_end_date, interval '1 day') d
    where extract(dow from d)::smallint = p_weekday order by 1
  loop
    begin
      if v_t.booking_mode = 'nightly' then
        perform public.create_reservation(
          p_hotel_id => p_hotel_id, p_guest_id => p_guest_id, p_room_type_id => p_room_type_id,
          p_arrival_date => v_d, p_departure_date => v_d + p_nights, p_adults => p_adults, p_children => p_children,
          p_room_id => p_room_id, p_source => p_source, p_customer_id => p_customer_id, p_notes => p_notes,
          p_series_id => v_series);
      else
        perform public.create_reservation(
          p_hotel_id => p_hotel_id, p_guest_id => p_guest_id, p_room_type_id => p_room_type_id,
          p_starts_at => v_d + p_start_time, p_ends_at => v_d + p_end_time, p_adults => p_adults, p_children => p_children,
          p_room_id => p_room_id, p_source => p_source, p_customer_id => p_customer_id, p_notes => p_notes,
          p_series_id => v_series);
      end if;
      v_count := v_count + 1;
    exception when exclusion_violation then
      -- موعد متعارض (لا سعة أو الغرفة محجوزة): يُتخطى وحده
      v_skipped := v_skipped || v_d;
      if p_waitlist_conflicts and v_t.booking_mode = 'nightly' then
        insert into public.waitlist_entries (
          hotel_id, guest_id, guest_name, phone, room_type_id, arrival_date, departure_date, adults, children, notes, series_id, created_by
        ) values (
          p_hotel_id, p_guest_id, v_guest.full_name, v_guest.phone, p_room_type_id, v_d, v_d + p_nights,
          coalesce(p_adults, 1), coalesce(p_children, 0), nullif(trim(p_notes), ''), v_series, auth.uid()
        );
        v_wait := v_wait + 1;
      end if;
    end;
  end loop;

  return jsonb_build_object('series_id', v_series, 'created', v_count, 'skipped', to_jsonb(v_skipped), 'waitlisted', v_wait);
end;
$$;

-- إلغاء بقية الحجز المتكرر من تاريخ معيّن (الماضي يبقى كما هو)
create or replace function public.cancel_reservation_series(p_series_id uuid, p_reason text, p_from_date date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s     public.reservation_series%rowtype;
  v_from  date;
  v_r     uuid;
  v_n     integer := 0;
begin
  select * into v_s from public.reservation_series where id = p_series_id for update;
  if v_s.id is null then
    raise exception 'Reservation series not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_s.hotel_id, 'pms.reservations.cancel');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to cancel a reservation' using errcode = '23514';
  end if;
  v_from := coalesce(p_from_date, app.today_for_hotel(v_s.hotel_id));
  for v_r in
    select id from public.reservations
    where series_id = v_s.id and status in ('tentative', 'confirmed') and arrival_date >= v_from
  loop
    perform public.cancel_reservation(v_r, p_reason);
    v_n := v_n + 1;
  end loop;
  update public.waitlist_entries set status = 'cancelled'
   where series_id = v_s.id and status = 'waiting' and arrival_date >= v_from;
  update public.reservation_series set status = 'cancelled', cancelled_at = now() where id = v_s.id;
  return v_n;
end;
$$;

-- =============================================================================
-- 10) قائمة الانتظار
-- =============================================================================
create or replace function public.add_waitlist_entry(
  p_hotel_id        uuid,
  p_room_type_id    uuid,
  p_arrival_date    date,
  p_departure_date  date,
  p_guest_id        uuid default null,
  p_guest_name      text default null,
  p_phone           text default null,
  p_adults          smallint default 1,
  p_children        smallint default 0,
  p_notes           text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t      public.room_types%rowtype;
  v_guest  public.guests%rowtype;
  v_id     uuid;
begin
  perform app.require_permission(p_hotel_id, 'pms.reservations.manage');
  select * into v_t from public.room_types where id = p_room_type_id and hotel_id = p_hotel_id;
  if v_t.id is null or not v_t.is_active then
    raise exception 'Room type not found or inactive' using errcode = '23503';
  end if;
  if v_t.booking_mode <> 'nightly' then
    raise exception 'The waitlist is for nightly room types' using errcode = '23514';
  end if;
  if p_arrival_date is null or p_departure_date is null or p_departure_date <= p_arrival_date
     or p_departure_date - p_arrival_date > 366 then
    raise exception 'Stay must be between 1 and 366 nights' using errcode = '23514';
  end if;
  if p_arrival_date < app.today_for_hotel(p_hotel_id) then
    raise exception 'Arrival date cannot be in the past' using errcode = '23514';
  end if;
  if p_guest_id is not null then
    select * into v_guest from public.guests where id = p_guest_id and hotel_id = p_hotel_id;
    if v_guest.id is null then
      raise exception 'Guest not found' using errcode = '23503';
    end if;
  elsif length(trim(coalesce(p_guest_name, ''))) = 0 then
    raise exception 'Guest name is required' using errcode = '23514';
  end if;

  insert into public.waitlist_entries (
    hotel_id, guest_id, guest_name, phone, room_type_id, arrival_date, departure_date, adults, children, notes, created_by
  ) values (
    p_hotel_id, p_guest_id, coalesce(v_guest.full_name, trim(p_guest_name)), coalesce(nullif(trim(p_phone), ''), v_guest.phone),
    p_room_type_id, p_arrival_date, p_departure_date, coalesce(p_adults, 1), coalesce(p_children, 0),
    nullif(trim(p_notes), ''), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

-- قائمة الانتظار مع حالة التوفر الآن: «متاح» يعني أن كل ليالي الطلب فيها غرفة شاغرة (دون حجز زائد)
create or replace function public.waitlist_overview(p_hotel_id uuid)
returns table (
  id uuid, guest_id uuid, guest_name text, phone text, room_type_id uuid, arrival_date date, departure_date date,
  adults smallint, children smallint, notes text, status public.waitlist_status, reservation_id uuid, series_id uuid,
  created_at timestamptz, is_available boolean, is_expired boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
begin
  perform app.require_permission(p_hotel_id, 'pms.reservations.view');
  v_today := app.today_for_hotel(p_hotel_id);
  return query
  select w.id, w.guest_id, w.guest_name, w.phone, w.room_type_id, w.arrival_date, w.departure_date,
         w.adults, w.children, w.notes, w.status, w.reservation_id, w.series_id, w.created_at,
         w.status = 'waiting' and w.arrival_date >= v_today and not exists (
           select 1 from generate_series(w.arrival_date, w.departure_date - 1, interval '1 day') d
           where app.pms_type_sold(w.room_type_id, d::date, null) >= app.pms_type_capacity(w.room_type_id)
         ),
         w.status = 'waiting' and w.arrival_date < v_today
  from public.waitlist_entries w
  where w.hotel_id = p_hotel_id
  order by (w.status = 'waiting') desc, w.arrival_date, w.created_at;
end;
$$;

-- عدد طلبات الانتظار التي أصبحت متاحة (تنبيه الواجهة)
create or replace function public.waitlist_ready_count(p_hotel_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.waitlist_overview(p_hotel_id) w where w.is_available;
$$;

create or replace function public.convert_waitlist_entry(p_entry_id uuid, p_room_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_w      public.waitlist_entries%rowtype;
  v_guest  uuid;
  v_res    uuid;
begin
  select * into v_w from public.waitlist_entries where id = p_entry_id for update;
  if v_w.id is null then
    raise exception 'Waitlist entry not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_w.hotel_id, 'pms.reservations.manage');
  if v_w.status <> 'waiting' then
    raise exception 'This waitlist entry is no longer waiting' using errcode = '23514';
  end if;
  v_guest := v_w.guest_id;
  if v_guest is null then
    insert into public.guests (hotel_id, full_name, phone) values (v_w.hotel_id, v_w.guest_name, v_w.phone)
    returning id into v_guest;
  end if;
  v_res := public.create_reservation(
    p_hotel_id => v_w.hotel_id, p_guest_id => v_guest, p_room_type_id => v_w.room_type_id,
    p_arrival_date => v_w.arrival_date, p_departure_date => v_w.departure_date,
    p_adults => v_w.adults, p_children => v_w.children, p_room_id => p_room_id,
    p_notes => v_w.notes, p_series_id => v_w.series_id);
  update public.waitlist_entries set status = 'converted', reservation_id = v_res, guest_id = v_guest where id = v_w.id;
  return v_res;
end;
$$;

create or replace function public.cancel_waitlist_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_w public.waitlist_entries%rowtype;
begin
  select * into v_w from public.waitlist_entries where id = p_entry_id for update;
  if v_w.id is null then
    raise exception 'Waitlist entry not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_w.hotel_id, 'pms.reservations.manage');
  if v_w.status <> 'waiting' then
    raise exception 'This waitlist entry is no longer waiting' using errcode = '23514';
  end if;
  update public.waitlist_entries set status = 'cancelled' where id = v_w.id;
end;
$$;

-- =============================================================================
-- 11) الغرف: الإنشاء دفعة واحدة وتحديث الحالة
-- =============================================================================
create or replace function public.create_rooms_bulk(
  p_hotel_id      uuid,
  p_room_type_id  uuid,
  p_from_number   integer,
  p_to_number     integer,
  p_floor_id      uuid default null,
  p_prefix        text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform app.require_permission(p_hotel_id, 'pms.setup.manage');
  if p_from_number is null or p_to_number is null or p_from_number < 0 or p_to_number < p_from_number
     or p_to_number - p_from_number >= 500 then
    raise exception 'Room range must contain between 1 and 500 rooms' using errcode = '23514';
  end if;
  if not exists (select 1 from public.room_types where id = p_room_type_id and hotel_id = p_hotel_id) then
    raise exception 'Room type not found or inactive' using errcode = '23503';
  end if;
  insert into public.rooms (hotel_id, room_number, floor_id, room_type_id, sort_order)
  select p_hotel_id, coalesce(trim(p_prefix), '') || n::text, p_floor_id, p_room_type_id, n
  from generate_series(p_from_number, p_to_number) n
  on conflict (hotel_id, room_number) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.set_room_status(
  p_room_id              uuid,
  p_housekeeping_status  public.room_housekeeping_status default null,
  p_service_status       public.room_service_status default null,
  p_service_note         text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.id is null then
    raise exception 'Room not found or inactive' using errcode = '23503';
  end if;
  perform app.require_permission(v_room.hotel_id, 'pms.rooms.status');
  if p_service_status = 'out_of_service' and length(trim(coalesce(p_service_note, ''))) = 0 then
    raise exception 'A reason is required to take a room out of service' using errcode = '23514';
  end if;
  update public.rooms set
    housekeeping_status = coalesce(p_housekeeping_status, housekeeping_status),
    service_status = coalesce(p_service_status, service_status),
    service_note = case when coalesce(p_service_status, service_status) = 'out_of_service'
                        then coalesce(nullif(trim(p_service_note), ''), service_note) end
  where id = v_room.id;
end;
$$;

-- ملخص الاستقبال لليوم
create or replace function public.front_desk_summary(p_hotel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_cap   integer;
  v_sold  integer;
begin
  perform app.require_permission(p_hotel_id, 'pms.reservations.view');
  v_today := app.today_for_hotel(p_hotel_id);
  select count(*) into v_cap from public.rooms r join public.room_types t on t.id = r.room_type_id
   where r.hotel_id = p_hotel_id and r.is_active and r.service_status = 'in_service' and t.booking_mode = 'nightly';
  select count(*) into v_sold from public.reservations
   where hotel_id = p_hotel_id and booking_mode = 'nightly' and status in ('tentative', 'confirmed', 'checked_in')
     and v_today >= arrival_date and v_today < departure_date;
  return jsonb_build_object(
    'today', v_today,
    'arrivals', (select count(*) from public.reservations where hotel_id = p_hotel_id and arrival_date = v_today
                   and status in ('tentative', 'confirmed')),
    'departures', (select count(*) from public.reservations where hotel_id = p_hotel_id and departure_date = v_today
                   and status in ('confirmed', 'checked_in') and booking_mode = 'nightly'),
    'in_house', (select count(*) from public.reservations where hotel_id = p_hotel_id and status = 'checked_in'),
    'capacity', v_cap,
    'sold_tonight', v_sold,
    'available_tonight', v_cap - v_sold,
    'out_of_service', (select count(*) from public.rooms where hotel_id = p_hotel_id and is_active and service_status = 'out_of_service'),
    'dirty', (select count(*) from public.rooms where hotel_id = p_hotel_id and is_active and housekeeping_status = 'dirty'),
    'tentative', (select count(*) from public.reservations where hotel_id = p_hotel_id and status = 'tentative'
                   and arrival_date >= v_today),
    'waitlist_ready', public.waitlist_ready_count(p_hotel_id)
  );
end;
$$;

-- =============================================================================
-- 12) RLS
-- =============================================================================
alter table public.floors              enable row level security;
alter table public.room_types          enable row level security;
alter table public.rooms               enable row level security;
alter table public.guests              enable row level security;
alter table public.rate_seasons        enable row level security;
alter table public.rate_season_prices  enable row level security;
alter table public.last_minute_rules   enable row level security;
alter table public.reservation_groups  enable row level security;
alter table public.reservation_series  enable row level security;
alter table public.reservations        enable row level security;
alter table public.reservation_nights  enable row level security;
alter table public.waitlist_entries    enable row level security;

-- هيكل الفندق: يقرؤه من يعمل في الحجوزات أو حالة الغرف أو الإعداد، ويعدّله من يملك صلاحية الإعداد
create policy floors_read on public.floors for select to authenticated using (
  hotel_id in (select app.permitted_hotels('pms.reservations.view'))
  or hotel_id in (select app.permitted_hotels('pms.rooms.status'))
  or hotel_id in (select app.permitted_hotels('pms.setup.manage')));
create policy floors_write on public.floors for all to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.setup.manage')))
  with check (hotel_id in (select app.permitted_hotels('pms.setup.manage')));

create policy room_types_read on public.room_types for select to authenticated using (
  hotel_id in (select app.permitted_hotels('pms.reservations.view'))
  or hotel_id in (select app.permitted_hotels('pms.rooms.status'))
  or hotel_id in (select app.permitted_hotels('pms.setup.manage')));
create policy room_types_write on public.room_types for all to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.setup.manage')))
  with check (hotel_id in (select app.permitted_hotels('pms.setup.manage')));

create policy rooms_read on public.rooms for select to authenticated using (
  hotel_id in (select app.permitted_hotels('pms.reservations.view'))
  or hotel_id in (select app.permitted_hotels('pms.rooms.status'))
  or hotel_id in (select app.permitted_hotels('pms.setup.manage')));
create policy rooms_write on public.rooms for all to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.setup.manage')))
  with check (hotel_id in (select app.permitted_hotels('pms.setup.manage')));

create policy guests_read on public.guests for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.reservations.view')));
create policy guests_insert on public.guests for insert to authenticated
  with check (hotel_id in (select app.permitted_hotels('pms.reservations.manage')));
create policy guests_update on public.guests for update to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.reservations.manage')))
  with check (hotel_id in (select app.permitted_hotels('pms.reservations.manage')));
create policy guests_delete on public.guests for delete to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.reservations.manage')));

create policy rate_seasons_read on public.rate_seasons for select to authenticated using (
  hotel_id in (select app.permitted_hotels('pms.reservations.view'))
  or hotel_id in (select app.permitted_hotels('pms.rates.manage')));
create policy rate_seasons_write on public.rate_seasons for all to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.rates.manage')))
  with check (hotel_id in (select app.permitted_hotels('pms.rates.manage')));

create policy rate_season_prices_read on public.rate_season_prices for select to authenticated using (
  hotel_id in (select app.permitted_hotels('pms.reservations.view'))
  or hotel_id in (select app.permitted_hotels('pms.rates.manage')));
create policy rate_season_prices_write on public.rate_season_prices for all to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.rates.manage')))
  with check (hotel_id in (select app.permitted_hotels('pms.rates.manage')));

create policy last_minute_rules_read on public.last_minute_rules for select to authenticated using (
  hotel_id in (select app.permitted_hotels('pms.reservations.view'))
  or hotel_id in (select app.permitted_hotels('pms.rates.manage')));
create policy last_minute_rules_write on public.last_minute_rules for all to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.rates.manage')))
  with check (hotel_id in (select app.permitted_hotels('pms.rates.manage')));

-- الحجوزات والليالي والمجموعات والتكرار والانتظار: قراءة فقط؛ الكتابة عبر دوال RPC حصرًا
create policy reservation_groups_read on public.reservation_groups for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.reservations.view')));
create policy reservation_series_read on public.reservation_series for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.reservations.view')));
create policy reservations_read on public.reservations for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.reservations.view')));
create policy reservation_nights_read on public.reservation_nights for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.reservations.view')));
create policy waitlist_entries_read on public.waitlist_entries for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.reservations.view')));

-- =============================================================================
-- 13) سجل التدقيق
-- =============================================================================
create trigger audit_floors after insert or update or delete on public.floors for each row execute function app.audit_trigger();
create trigger audit_room_types after insert or update or delete on public.room_types for each row execute function app.audit_trigger();
create trigger audit_rooms after insert or update or delete on public.rooms for each row execute function app.audit_trigger();
create trigger audit_guests after insert or update or delete on public.guests for each row execute function app.audit_trigger();
create trigger audit_rate_seasons after insert or update or delete on public.rate_seasons for each row execute function app.audit_trigger();
create trigger audit_last_minute_rules after insert or update or delete on public.last_minute_rules for each row execute function app.audit_trigger();
create trigger audit_reservation_groups after insert on public.reservation_groups for each row execute function app.audit_trigger();
create trigger audit_reservation_series after insert or update on public.reservation_series for each row execute function app.audit_trigger();
create trigger audit_reservations after insert or update on public.reservations for each row execute function app.audit_trigger();
create trigger audit_waitlist_entries after insert or update on public.waitlist_entries for each row execute function app.audit_trigger();

-- =============================================================================
-- 14) صلاحيات التنفيذ
-- =============================================================================
revoke execute on all functions in schema app from public, anon;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.set_hotel_modules(uuid, text[])',
    'public.create_reservation(uuid, uuid, uuid, date, date, smallint, smallint, uuid, public.reservation_status, public.reservation_source, uuid, public.reservation_pricing, numeric, text, timestamp, timestamp, text, text, date, uuid, uuid)',
    'public.update_reservation(uuid, uuid, date, date, smallint, smallint, public.reservation_source, uuid, public.reservation_pricing, numeric, text, timestamp, timestamp, text, text, date, boolean)',
    'public.assign_reservation_room(uuid, uuid)',
    'public.confirm_reservation(uuid)',
    'public.cancel_reservation(uuid, text)',
    'public.mark_reservation_no_show(uuid, text)',
    'public.quote_reservation(uuid, uuid, date, date, public.reservation_pricing, numeric, timestamp, timestamp, uuid)',
    'public.room_type_availability(uuid, date, date)',
    'public.create_group_reservation(uuid, text, uuid, uuid, date, date, smallint, smallint, smallint, uuid, public.reservation_status, public.reservation_source, text)',
    'public.create_reservation_series(uuid, uuid, uuid, smallint, date, date, smallint, time, time, uuid, smallint, smallint, uuid, public.reservation_source, text, boolean)',
    'public.cancel_reservation_series(uuid, text, date)',
    'public.add_waitlist_entry(uuid, uuid, date, date, uuid, text, text, smallint, smallint, text)',
    'public.waitlist_overview(uuid)',
    'public.waitlist_ready_count(uuid)',
    'public.convert_waitlist_entry(uuid, uuid)',
    'public.cancel_waitlist_entry(uuid)',
    'public.create_rooms_bulk(uuid, uuid, integer, integer, uuid, text)',
    'public.set_room_status(uuid, public.room_housekeeping_status, public.room_service_status, text)',
    'public.front_desk_summary(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

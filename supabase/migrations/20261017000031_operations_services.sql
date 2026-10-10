-- =============================================================================
-- خدمات التشغيل:
--   1) الصيانة: بلاغات أعطال للغرف والأجهزة، فني مسؤول، قطع غيار بتكلفتها (ومن المخزون إن وُجدت)،
--      وسجل الأجهزة. البلاغ قد يُخرج الغرفة من الخدمة حتى إنجازه.
--   2) المفقودات والأمانات: ما يتركه النزلاء وتسليمه أو التخلص منه، وأمانات الخزنة.
--   3) المغسلة: قائمة أسعار، طلبات غسيل النزلاء تُرحَّل على الفوليو عند التسليم، ومتابعة مفروشات الفندق.
--   4) المناسبات: عقد بالبنود والأسعار، حجز القاعة بلا تعارض مع الحجوزات بالساعة، فوليو للعربون والفاتورة،
--      وجدول التجهيز.
--   5) تقييمات النزلاء: استبيان يُنشأ تلقائيًا عند المغادرة برمز خاص، ويُعبّأ من جهاز الاستقبال أو بالرابط،
--      أو يُدخل يدويًا من ورقة.
-- =============================================================================

insert into public.permissions (code, module, action, name_ar, name_en, sort_order, product) values
  ('maintenance.report', 'maintenance', 'create', 'الإبلاغ عن الأعطال',                 'Report maintenance issues',  1300, 'core'),
  ('maintenance.manage', 'maintenance', 'manage', 'إدارة الصيانة والأجهزة وقطع الغيار', 'Manage maintenance',         1310, 'core'),
  ('lost_found.manage',  'guest_services', 'manage', 'المفقودات وأمانات الخزنة',        'Lost & found and safe deposits', 1320, 'pms'),
  ('laundry.manage',     'guest_services', 'manage', 'المغسلة والمفروشات',              'Laundry and linen',          1330, 'pms'),
  ('events.view',        'events', 'view',   'عرض المناسبات',                           'View events',                1340, 'pms'),
  ('events.manage',      'events', 'manage', 'إدارة المناسبات وعقودها',                 'Manage events',              1350, 'pms'),
  ('feedback.view',      'feedback', 'view',   'تقارير رضا النزلاء',                    'Guest satisfaction reports', 1360, 'pms'),
  ('feedback.manage',    'feedback', 'manage', 'تسجيل تقييمات النزلاء',                 'Record guest surveys',       1370, 'pms');

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and p.module in ('maintenance', 'guest_services', 'events', 'feedback') and (
  r.code = 'general_manager'
  or (r.code = 'receptionist' and p.code in ('maintenance.report', 'lost_found.manage', 'laundry.manage', 'events.view', 'feedback.manage'))
  or (r.code = 'housekeeping' and p.code in ('maintenance.report', 'lost_found.manage', 'laundry.manage'))
  or (r.code = 'reservations_agent' and p.code in ('events.view', 'events.manage', 'maintenance.report'))
  or (r.code = 'accountant' and p.code in ('events.view', 'feedback.view'))
  or (r.code = 'department_manager' and p.code in ('maintenance.report', 'events.view', 'feedback.view'))
)
on conflict do nothing;

-- =============================================================================
-- 1) الصيانة
-- =============================================================================
create table public.maintenance_assets (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  code            text check (code is null or code ~ '^[A-Za-z0-9_.-]{1,30}$'),
  name            text not null check (length(trim(name)) > 0),
  category        text not null default 'other' check (category in ('ac', 'electrical', 'plumbing', 'appliance', 'furniture', 'elevator', 'generator', 'it', 'other')),
  room_id         uuid,
  location        text,
  brand           text,
  serial_number   text,
  purchase_date   date,
  warranty_until  date,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  unique (hotel_id, id),
  foreign key (hotel_id, room_id) references public.rooms (hotel_id, id) on delete set null (room_id)
);
create unique index maintenance_assets_code on public.maintenance_assets (hotel_id, code) where code is not null;

create table public.maintenance_requests (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  request_number  text not null,
  title           text not null check (length(trim(title)) > 0),
  description     text,
  room_id         uuid,
  asset_id        uuid,
  location        text,
  priority        text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status          text not null default 'open' check (status in ('open', 'in_progress', 'on_hold', 'done', 'cancelled')),
  assignee        text,
  out_of_service  boolean not null default false,
  due_date        date,
  labor_cost      numeric(19, 4) not null default 0 check (labor_cost >= 0),
  resolution      text,
  reported_by     uuid references auth.users(id),
  reported_at     timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  completed_by    uuid references auth.users(id),
  unique (hotel_id, request_number),
  unique (hotel_id, id),
  foreign key (hotel_id, room_id) references public.rooms (hotel_id, id),
  foreign key (hotel_id, asset_id) references public.maintenance_assets (hotel_id, id),
  constraint maintenance_target check (room_id is not null or asset_id is not null or length(trim(coalesce(location, ''))) > 0)
);
create index maintenance_requests_open on public.maintenance_requests (hotel_id, status, reported_at desc);

create table public.maintenance_parts (
  id                 uuid primary key default gen_random_uuid(),
  hotel_id           uuid not null,
  request_id         uuid not null references public.maintenance_requests(id) on delete cascade,
  description        text not null check (length(trim(description)) > 0),
  quantity           numeric(14, 3) not null check (quantity > 0),
  unit_cost          numeric(19, 4) not null check (unit_cost >= 0),
  inventory_item_id  uuid,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  foreign key (hotel_id, inventory_item_id) references public.inventory_items (hotel_id, id)
);
create index maintenance_parts_request on public.maintenance_parts (request_id);

create or replace function public.create_maintenance_request(
  p_hotel_id uuid, p_title text, p_description text default null, p_room_id uuid default null, p_asset_id uuid default null,
  p_location text default null, p_priority text default 'normal', p_out_of_service boolean default false, p_due_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_room uuid := p_room_id;
begin
  perform app.require_permission(p_hotel_id, 'maintenance.report');
  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'Describe the maintenance issue' using errcode = '23514';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid priority' using errcode = '22023';
  end if;
  if p_room_id is not null and not exists (select 1 from public.rooms where id = p_room_id and hotel_id = p_hotel_id) then
    raise exception 'Room not found or inactive' using errcode = '23503';
  end if;
  if p_asset_id is not null then
    select coalesce(v_room, room_id) into v_room from public.maintenance_assets where id = p_asset_id and hotel_id = p_hotel_id;
    if not found then raise exception 'Equipment not found' using errcode = '23503'; end if;
  end if;
  if p_out_of_service and v_room is null then
    raise exception 'Only a room can be taken out of service' using errcode = '23514';
  end if;
  insert into public.maintenance_requests (hotel_id, request_number, title, description, room_id, asset_id, location, priority,
    out_of_service, due_date, reported_by)
  values (p_hotel_id, app.next_document_number(p_hotel_id, 'maintenance', 'MNT', app.today_for_hotel(p_hotel_id)), trim(p_title),
    nullif(trim(p_description), ''), v_room, p_asset_id, nullif(trim(p_location), ''), p_priority, p_out_of_service, p_due_date, auth.uid())
  returning id into v_id;
  if p_out_of_service then
    update public.rooms set service_status = 'out_of_service', service_note = trim(p_title) where id = v_room;
  end if;
  return v_id;
end;
$$;

create or replace function public.update_maintenance_request(
  p_request_id uuid, p_status text default null, p_assignee text default null, p_priority text default null,
  p_resolution text default null, p_labor_cost numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.maintenance_requests%rowtype;
begin
  select * into v_r from public.maintenance_requests where id = p_request_id for update;
  if v_r.id is null then raise exception 'Maintenance request not found' using errcode = '23503'; end if;
  perform app.require_permission(v_r.hotel_id, 'maintenance.manage');
  if v_r.status in ('done', 'cancelled') then
    raise exception 'This maintenance request is already closed' using errcode = '23514';
  end if;
  if p_status is not null and p_status not in ('open', 'in_progress', 'on_hold', 'done', 'cancelled') then
    raise exception 'Invalid task status' using errcode = '22023';
  end if;
  if p_priority is not null and p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid priority' using errcode = '22023';
  end if;
  if p_labor_cost is not null and p_labor_cost < 0 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;
  if p_status = 'done' and length(trim(coalesce(p_resolution, v_r.resolution, ''))) = 0 then
    raise exception 'Write what was done before closing the request' using errcode = '23514';
  end if;
  update public.maintenance_requests set
    status = coalesce(p_status, status),
    assignee = case when p_assignee is null then assignee else nullif(trim(p_assignee), '') end,
    priority = coalesce(p_priority, priority),
    resolution = case when p_resolution is null then resolution else nullif(trim(p_resolution), '') end,
    labor_cost = coalesce(p_labor_cost, labor_cost),
    started_at = case when p_status = 'in_progress' and started_at is null then now() else started_at end,
    completed_at = case when p_status in ('done', 'cancelled') then now() else completed_at end,
    completed_by = case when p_status in ('done', 'cancelled') then auth.uid() else completed_by end
  where id = v_r.id;
  -- الغرفة تعود للخدمة حين يُغلق آخر بلاغ أخرجها منها
  if p_status in ('done', 'cancelled') and v_r.out_of_service and v_r.room_id is not null
     and not exists (select 1 from public.maintenance_requests m where m.room_id = v_r.room_id and m.id <> v_r.id
                       and m.out_of_service and m.status not in ('done', 'cancelled')) then
    update public.rooms set service_status = 'in_service', service_note = null where id = v_r.room_id and service_status = 'out_of_service';
  end if;
end;
$$;

-- قطعة غيار: من المخزون (تُصرف بتكلفتها المتوسطة على قسم الصيانة) أو مشتراة مباشرة بتكلفة تُكتب
create or replace function public.add_maintenance_part(
  p_request_id uuid, p_description text, p_quantity numeric, p_unit_cost numeric default null, p_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r     public.maintenance_requests%rowtype;
  v_item  public.inventory_items%rowtype;
  v_cost  numeric;
  v_dept  uuid;
  v_id    uuid;
begin
  select * into v_r from public.maintenance_requests where id = p_request_id;
  if v_r.id is null then raise exception 'Maintenance request not found' using errcode = '23503'; end if;
  perform app.require_permission(v_r.hotel_id, 'maintenance.manage');
  if v_r.status in ('done', 'cancelled') then
    raise exception 'This maintenance request is already closed' using errcode = '23514';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Invalid quantity' using errcode = '22023'; end if;
  if p_item_id is not null then
    select * into v_item from public.inventory_items where id = p_item_id and hotel_id = v_r.hotel_id and is_active;
    if v_item.id is null then raise exception 'Item not found or inactive' using errcode = '23503'; end if;
    select id into v_dept from public.departments where hotel_id = v_r.hotel_id and code = 'MAINT';
    v_cost := round(v_item.average_cost, 4);
    -- الصرف من المخزون بصلاحية المستخدم نفسه على المخزون
    perform public.post_inventory_movement(v_item.id, 'issue', p_quantity, app.today_for_hotel(v_r.hotel_id), null, v_dept,
                                           null, 'صيانة ' || v_r.request_number);
  else
    if length(trim(coalesce(p_description, ''))) = 0 then raise exception 'Describe the item' using errcode = '23514'; end if;
    if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Enter the part cost' using errcode = '22023'; end if;
    v_cost := p_unit_cost;
  end if;
  insert into public.maintenance_parts (hotel_id, request_id, description, quantity, unit_cost, inventory_item_id, created_by)
  values (v_r.hotel_id, v_r.id, coalesce(nullif(trim(p_description), ''), v_item.name_ar), p_quantity, v_cost, p_item_id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- =============================================================================
-- 2) المفقودات وأمانات الخزنة
-- =============================================================================
create table public.lost_found_items (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references public.hotels(id) on delete cascade,
  item_number         text not null,
  found_date          date not null,
  found_location      text,
  room_id             uuid,
  description         text not null check (length(trim(description)) > 0),
  category            text not null default 'other' check (category in ('electronics', 'documents', 'money', 'jewelry', 'clothing', 'bags', 'other')),
  found_by            text,
  storage_location    text,
  guest_id            uuid,
  status              text not null default 'stored' check (status in ('stored', 'returned', 'disposed')),
  returned_to         text,
  returned_id_number  text,
  returned_at         timestamptz,
  returned_by         uuid references auth.users(id),
  closed_note         text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  unique (hotel_id, item_number),
  unique (hotel_id, id),
  foreign key (hotel_id, room_id) references public.rooms (hotel_id, id),
  foreign key (hotel_id, guest_id) references public.guests (hotel_id, id)
);
create index lost_found_items_status on public.lost_found_items (hotel_id, status, found_date desc);

create table public.safe_deposits (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  deposit_number  text not null,
  guest_id        uuid,
  guest_name      text not null check (length(trim(guest_name)) > 0),
  reservation_id  uuid,
  room_number     text,
  box_number      text not null check (length(trim(box_number)) > 0),
  items           text not null check (length(trim(items)) > 0),
  status          text not null default 'held' check (status in ('held', 'returned')),
  deposited_at    timestamptz not null default now(),
  received_by     uuid references auth.users(id),
  returned_at     timestamptz,
  returned_by     uuid references auth.users(id),
  return_note     text,
  unique (hotel_id, deposit_number),
  unique (hotel_id, id),
  foreign key (hotel_id, guest_id) references public.guests (hotel_id, id),
  foreign key (hotel_id, reservation_id) references public.reservations (hotel_id, id)
);
-- الصندوق الواحد لا يحمل أمانتين في وقت واحد
create unique index safe_deposits_box_held on public.safe_deposits (hotel_id, upper(trim(box_number))) where status = 'held';

create or replace function public.register_lost_item(
  p_hotel_id uuid, p_description text, p_found_date date default null, p_category text default 'other',
  p_room_id uuid default null, p_found_location text default null, p_found_by text default null,
  p_storage_location text default null, p_guest_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_found_date, app.today_for_hotel(p_hotel_id));
  v_id   uuid;
begin
  perform app.require_permission(p_hotel_id, 'lost_found.manage');
  if length(trim(coalesce(p_description, ''))) = 0 then
    raise exception 'Describe the item' using errcode = '23514';
  end if;
  if p_category not in ('electronics', 'documents', 'money', 'jewelry', 'clothing', 'bags', 'other') then
    raise exception 'Invalid category' using errcode = '22023';
  end if;
  insert into public.lost_found_items (hotel_id, item_number, found_date, found_location, room_id, description, category, found_by,
    storage_location, guest_id, created_by)
  values (p_hotel_id, app.next_document_number(p_hotel_id, 'lost_found', 'LF', v_date), v_date, nullif(trim(p_found_location), ''),
    p_room_id, trim(p_description), p_category, nullif(trim(p_found_by), ''), nullif(trim(p_storage_location), ''), p_guest_id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- إغلاق مفقود: تسليمه لصاحبه (اسم المستلم وهويته إلزاميان) أو التخلص منه بسبب
create or replace function public.close_lost_item(
  p_item_id uuid, p_action text, p_returned_to text default null, p_id_number text default null, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.lost_found_items%rowtype;
begin
  select * into v_i from public.lost_found_items where id = p_item_id for update;
  if v_i.id is null then raise exception 'Item not found' using errcode = '23503'; end if;
  perform app.require_permission(v_i.hotel_id, 'lost_found.manage');
  if v_i.status <> 'stored' then raise exception 'This item is already closed' using errcode = '23514'; end if;
  if p_action = 'return' then
    if length(trim(coalesce(p_returned_to, ''))) = 0 or length(trim(coalesce(p_id_number, ''))) = 0 then
      raise exception 'Enter the receiver name and ID number' using errcode = '23514';
    end if;
    update public.lost_found_items set status = 'returned', returned_to = trim(p_returned_to), returned_id_number = trim(p_id_number),
      returned_at = now(), returned_by = auth.uid(), closed_note = nullif(trim(p_note), '') where id = v_i.id;
  elsif p_action = 'dispose' then
    if length(trim(coalesce(p_note, ''))) = 0 then
      raise exception 'Write the reason for disposal' using errcode = '23514';
    end if;
    update public.lost_found_items set status = 'disposed', returned_at = now(), returned_by = auth.uid(), closed_note = trim(p_note)
     where id = v_i.id;
  else
    raise exception 'Invalid action' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.open_safe_deposit(
  p_hotel_id uuid, p_guest_name text, p_box_number text, p_items text, p_reservation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res  public.reservations%rowtype;
  v_room text;
  v_id   uuid;
begin
  perform app.require_permission(p_hotel_id, 'lost_found.manage');
  if length(trim(coalesce(p_guest_name, ''))) = 0 or length(trim(coalesce(p_box_number, ''))) = 0 or length(trim(coalesce(p_items, ''))) = 0 then
    raise exception 'Enter the guest, box number and deposited items' using errcode = '23514';
  end if;
  if p_reservation_id is not null then
    select * into v_res from public.reservations where id = p_reservation_id and hotel_id = p_hotel_id;
    if v_res.id is null then raise exception 'Reservation not found' using errcode = '23503'; end if;
    select room_number into v_room from public.rooms where id = v_res.room_id;
  end if;
  if exists (select 1 from public.safe_deposits where hotel_id = p_hotel_id and status = 'held' and upper(trim(box_number)) = upper(trim(p_box_number))) then
    raise exception 'This safe box already holds a deposit' using errcode = '23505';
  end if;
  insert into public.safe_deposits (hotel_id, deposit_number, guest_id, guest_name, reservation_id, room_number, box_number, items, received_by)
  values (p_hotel_id, app.next_document_number(p_hotel_id, 'safe_deposit', 'SD', app.today_for_hotel(p_hotel_id)), v_res.guest_id,
    trim(p_guest_name), v_res.id, v_room, trim(p_box_number), trim(p_items), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- النزلاء المقيمون الآن لاختيارهم في الأمانات وطلبات الغسيل
create or replace function public.services_in_house(p_hotel_id uuid)
returns table (reservation_id uuid, room_number text, guest_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.has_permission(p_hotel_id, 'laundry.manage') or app.has_permission(p_hotel_id, 'lost_found.manage')) then
    raise exception 'Permission denied: % required', 'laundry.manage' using errcode = '42501';
  end if;
  return query
  select r.id, rm.room_number, g.full_name
  from public.reservations r
  join public.guests g on g.id = r.guest_id
  left join public.rooms rm on rm.id = r.room_id
  where r.hotel_id = p_hotel_id and r.status = 'checked_in'
  order by rm.room_number;
end;
$$;

create or replace function public.return_safe_deposit(p_deposit_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.safe_deposits%rowtype;
begin
  select * into v_d from public.safe_deposits where id = p_deposit_id for update;
  if v_d.id is null then raise exception 'Deposit not found' using errcode = '23503'; end if;
  perform app.require_permission(v_d.hotel_id, 'lost_found.manage');
  if v_d.status <> 'held' then raise exception 'This deposit was already returned' using errcode = '23514'; end if;
  update public.safe_deposits set status = 'returned', returned_at = now(), returned_by = auth.uid(), return_note = nullif(trim(p_note), '')
   where id = v_d.id;
end;
$$;

-- =============================================================================
-- 3) المغسلة والمفروشات
-- =============================================================================
create table public.laundry_items (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  service         text not null default 'wash_iron' check (service in ('wash', 'iron', 'wash_iron', 'dry_clean')),
  price           numeric(19, 4) not null check (price > 0),
  charge_code_id  uuid not null,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  unique (hotel_id, id),
  foreign key (hotel_id, charge_code_id) references public.charge_codes (hotel_id, id)
);

create table public.laundry_orders (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  order_number    text not null,
  reservation_id  uuid not null,
  folio_id        uuid not null,
  room_number     text,
  guest_name      text not null,
  status          text not null default 'received' check (status in ('received', 'in_process', 'ready', 'delivered', 'cancelled')),
  express         boolean not null default false,
  express_pct     numeric(6, 2) not null default 0 check (express_pct between 0 and 300),
  promised_at     timestamptz,
  notes           text,
  total           numeric(19, 4) not null default 0,
  received_at     timestamptz not null default now(),
  received_by     uuid references auth.users(id),
  delivered_at    timestamptz,
  delivered_by    uuid references auth.users(id),
  unique (hotel_id, order_number),
  unique (hotel_id, id),
  foreign key (hotel_id, reservation_id) references public.reservations (hotel_id, id),
  foreign key (hotel_id, folio_id) references public.guest_folios (hotel_id, id)
);
create index laundry_orders_status on public.laundry_orders (hotel_id, status, received_at desc);

create table public.laundry_order_lines (
  order_id              uuid not null references public.laundry_orders(id) on delete cascade,
  line_no               integer not null,
  hotel_id              uuid not null,
  item_id               uuid not null,
  name                  text not null,
  quantity              integer not null check (quantity between 1 and 500),
  unit_price            numeric(19, 4) not null,
  folio_transaction_id  uuid references public.folio_transactions(id),
  primary key (order_id, line_no),
  foreign key (hotel_id, item_id) references public.laundry_items (hotel_id, id)
);

create table public.linen_types (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  par_level   integer not null default 0 check (par_level >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  unique (hotel_id, id),
  unique (hotel_id, name)
);

-- حركات المفروشات: شراء (يزيد المخزون)، إرسال للغسيل، استلام من الغسيل، تالف (ينقص المخزون)
create table public.linen_movements (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null,
  linen_type_id  uuid not null,
  movement_date  date not null,
  kind           text not null check (kind in ('purchased', 'sent', 'returned', 'damaged')),
  quantity       integer not null check (quantity > 0),
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  foreign key (hotel_id, linen_type_id) references public.linen_types (hotel_id, id) on delete cascade
);
create index linen_movements_type on public.linen_movements (linen_type_id, movement_date);

-- رصيد المفروشات: الإجمالي، وما في المغسلة الآن، والمتاح
create or replace view public.linen_balances with (security_invoker = true) as
select t.id as linen_type_id, t.hotel_id, t.name, t.par_level, t.is_active,
       coalesce(sum(m.quantity) filter (where m.kind = 'purchased'), 0) - coalesce(sum(m.quantity) filter (where m.kind = 'damaged'), 0) as total,
       coalesce(sum(m.quantity) filter (where m.kind = 'sent'), 0) - coalesce(sum(m.quantity) filter (where m.kind = 'returned'), 0) as at_laundry
from public.linen_types t
left join public.linen_movements m on m.linen_type_id = t.id
group by t.id;

create or replace function app.check_linen_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_out   integer;
begin
  select total, at_laundry into v_total, v_out from public.linen_balances where linen_type_id = new.linen_type_id;
  if new.kind = 'returned' and new.quantity > v_out then
    raise exception 'Returned quantity is more than what is at the laundry (%)', v_out using errcode = '23514';
  end if;
  if new.kind = 'sent' and new.quantity > v_total - v_out then
    raise exception 'Sent quantity is more than what is available (%)', v_total - v_out using errcode = '23514';
  end if;
  if new.kind = 'damaged' and new.quantity > v_total then
    raise exception 'Damaged quantity is more than the total stock (%)', v_total using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger linen_movements_check before insert on public.linen_movements for each row execute function app.check_linen_movement();

create or replace function public.create_laundry_order(
  p_reservation_id uuid, p_lines jsonb, p_express boolean default false, p_express_pct numeric default 0,
  p_promised_at timestamptz default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res    public.reservations%rowtype;
  v_item   public.laundry_items%rowtype;
  v_line   jsonb;
  v_qty    integer;
  v_order  uuid;
  v_n      integer := 0;
  v_room   text;
  v_guest  text;
  v_pct    numeric := case when p_express then coalesce(p_express_pct, 0) else 0 end;
  v_dec    smallint;
begin
  select * into v_res from public.reservations where id = p_reservation_id;
  if v_res.id is null then raise exception 'Reservation not found' using errcode = '23503'; end if;
  perform app.require_permission(v_res.hotel_id, 'laundry.manage');
  if v_res.status <> 'checked_in' or v_res.folio_id is null then
    raise exception 'Laundry orders are for in-house guests only' using errcode = '23514';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item to the order' using errcode = '22023';
  end if;
  if v_pct < 0 or v_pct > 300 then raise exception 'Invalid amount' using errcode = '22023'; end if;
  v_dec := app.currency_decimals(v_res.hotel_id);
  select room_number into v_room from public.rooms where id = v_res.room_id;
  select full_name into v_guest from public.guests where id = v_res.guest_id;
  insert into public.laundry_orders (hotel_id, order_number, reservation_id, folio_id, room_number, guest_name, express, express_pct,
    promised_at, notes, received_by)
  values (v_res.hotel_id, app.next_document_number(v_res.hotel_id, 'laundry', 'LND', app.today_for_hotel(v_res.hotel_id)), v_res.id,
    v_res.folio_id, v_room, v_guest, coalesce(p_express, false), v_pct, p_promised_at, nullif(trim(p_notes), ''), auth.uid())
  returning id into v_order;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.laundry_items where id = (v_line ->> 'item_id')::uuid and hotel_id = v_res.hotel_id and is_active;
    if v_item.id is null then raise exception 'Item not found or inactive' using errcode = '23503'; end if;
    v_qty := (v_line ->> 'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 500 then raise exception 'Invalid quantity' using errcode = '22023'; end if;
    v_n := v_n + 1;
    insert into public.laundry_order_lines (order_id, line_no, hotel_id, item_id, name, quantity, unit_price)
    values (v_order, v_n, v_res.hotel_id, v_item.id, v_item.name, v_qty, round(v_item.price * (1 + v_pct / 100), v_dec));
  end loop;
  update public.laundry_orders set total = (select sum(quantity * unit_price) from public.laundry_order_lines where order_id = v_order)
   where id = v_order;
  return v_order;
end;
$$;

-- مراحل الطلب؛ التسليم يرحّل البنود على فوليو النزيل، والإلغاء قبل التسليم فقط
create or replace function public.update_laundry_order(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o    public.laundry_orders%rowtype;
  v_l    public.laundry_order_lines%rowtype;
  v_cc   uuid;
  v_txn  uuid;
  v_rank constant text[] := array['received', 'in_process', 'ready', 'delivered'];
begin
  select * into v_o from public.laundry_orders where id = p_order_id for update;
  if v_o.id is null then raise exception 'Laundry order not found' using errcode = '23503'; end if;
  perform app.require_permission(v_o.hotel_id, 'laundry.manage');
  if v_o.status in ('delivered', 'cancelled') then
    raise exception 'This laundry order is already closed' using errcode = '23514';
  end if;
  if p_status = 'cancelled' then
    update public.laundry_orders set status = 'cancelled' where id = v_o.id;
    return;
  end if;
  if p_status is null or array_position(v_rank, p_status) is null or array_position(v_rank, p_status) <= array_position(v_rank, v_o.status) then
    raise exception 'Invalid task status' using errcode = '22023';
  end if;
  if p_status = 'delivered' then
    for v_l in select * from public.laundry_order_lines where order_id = v_o.id order by line_no loop
      select charge_code_id into v_cc from public.laundry_items where id = v_l.item_id;
      v_txn := public.post_folio_charge(v_o.folio_id, v_cc, v_l.unit_price, v_l.quantity, app.today_for_hotel(v_o.hotel_id),
                                        'غسيل: ' || v_l.name, v_o.order_number);
      update public.laundry_order_lines set folio_transaction_id = v_txn where order_id = v_o.id and line_no = v_l.line_no;
    end loop;
    update public.laundry_orders set status = 'delivered', delivered_at = now(), delivered_by = auth.uid() where id = v_o.id;
  else
    update public.laundry_orders set status = p_status where id = v_o.id;
  end if;
end;
$$;

-- =============================================================================
-- 4) المناسبات
-- =============================================================================
create table public.event_bookings (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  event_number    text not null,
  title           text not null check (length(trim(title)) > 0),
  event_type      text not null default 'other' check (event_type in ('wedding', 'conference', 'meeting', 'party', 'graduation', 'other')),
  status          text not null default 'tentative' check (status in ('tentative', 'confirmed', 'completed', 'cancelled')),
  customer_id     uuid,
  contact_name    text not null check (length(trim(contact_name)) > 0),
  contact_phone   text,
  hall_room_id    uuid,
  starts_at       timestamp not null,
  ends_at         timestamp not null,
  guests_count    integer not null default 0 check (guests_count between 0 and 100000),
  discount        numeric(19, 4) not null default 0 check (discount >= 0),
  folio_id        uuid,
  notes           text,
  terms           text,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  completed_at    timestamptz,
  unique (hotel_id, event_number),
  unique (hotel_id, id),
  foreign key (hotel_id, customer_id) references public.customers (hotel_id, id),
  foreign key (hotel_id, hall_room_id) references public.rooms (hotel_id, id),
  foreign key (hotel_id, folio_id) references public.guest_folios (hotel_id, id),
  constraint event_times check (ends_at > starts_at and ends_at - starts_at <= interval '3 days')
);
create index event_bookings_date on public.event_bookings (hotel_id, starts_at);

create table public.event_items (
  event_id        uuid not null references public.event_bookings(id) on delete cascade,
  line_no         integer not null,
  hotel_id        uuid not null,
  description     text not null check (length(trim(description)) > 0),
  per_person      boolean not null default false,
  quantity        numeric(12, 3) not null check (quantity > 0),
  unit_price      numeric(19, 4) not null check (unit_price >= 0),
  charge_code_id  uuid not null,
  primary key (event_id, line_no),
  foreign key (hotel_id, charge_code_id) references public.charge_codes (hotel_id, id)
);

create table public.event_tasks (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null,
  event_id    uuid not null references public.event_bookings(id) on delete cascade,
  due_at      timestamp not null,
  task        text not null check (length(trim(task)) > 0),
  owner       text,
  done        boolean not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
create index event_tasks_event on public.event_tasks (event_id, due_at);

-- القاعة لا تُحجز لمناسبتين ولا لمناسبة وحجز بالساعة في نفس الوقت
create or replace function app.event_hall_conflict(p_hotel_id uuid, p_room_id uuid, p_from timestamp, p_to timestamp, p_exclude_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_bookings e
    where e.hotel_id = p_hotel_id and e.hall_room_id = p_room_id and e.status in ('tentative', 'confirmed')
      and e.id is distinct from p_exclude_event and tsrange(e.starts_at, e.ends_at, '[)') && tsrange(p_from, p_to, '[)')
  ) or exists (
    select 1 from public.reservations r
    where r.hotel_id = p_hotel_id and r.room_id = p_room_id and r.status in ('tentative', 'confirmed', 'checked_in')
      and r.period && tsrange(p_from, p_to, '[)')
  );
$$;

create or replace function app.check_event_hall()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hall_room_id is not null and new.status in ('tentative', 'confirmed') then
    -- قفل القاعة حتى لا يحجزها طلبان متزامنان
    perform 1 from public.rooms where id = new.hall_room_id for update;
    if app.event_hall_conflict(new.hotel_id, new.hall_room_id, new.starts_at, new.ends_at, new.id) then
      raise exception 'The hall is already booked at this time' using errcode = '23P01';
    end if;
  end if;
  return new;
end;
$$;
create trigger event_bookings_hall before insert or update on public.event_bookings for each row execute function app.check_event_hall();

create or replace function app.check_reservation_vs_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.room_id is not null and new.status in ('tentative', 'confirmed', 'checked_in') and exists (
    select 1 from public.event_bookings e
    where e.hotel_id = new.hotel_id and e.hall_room_id = new.room_id and e.status in ('tentative', 'confirmed')
      -- period عمود مولَّد لا يُحسب قبل تنفيذ مشغلات before، فنحسبه هنا
      and tsrange(e.starts_at, e.ends_at, '[)') && case when new.booking_mode = 'hourly' then tsrange(new.starts_at, new.ends_at, '[)')
        else tsrange(new.arrival_date::timestamp, new.departure_date::timestamp, '[)') end
  ) then
    raise exception 'The hall is booked for an event at this time' using errcode = '23P01';
  end if;
  return new;
end;
$$;
create trigger reservations_zz_events before insert or update of room_id, starts_at, ends_at, arrival_date, departure_date, status
  on public.reservations for each row execute function app.check_reservation_vs_events();

-- حفظ المناسبة: الرأس والبنود معًا (البنود تُستبدل)، ما دامت غير مكتملة ولا ملغاة
create or replace function public.save_event(
  p_hotel_id uuid, p_event_id uuid, p_title text, p_event_type text, p_contact_name text, p_contact_phone text,
  p_customer_id uuid, p_hall_room_id uuid, p_starts_at timestamp, p_ends_at timestamp, p_guests_count integer,
  p_discount numeric, p_notes text, p_terms text, p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e     public.event_bookings%rowtype;
  v_id    uuid := p_event_id;
  v_line  jsonb;
  v_n     integer := 0;
  v_cc    uuid;
  v_total numeric := 0;
  v_qty   numeric;
  v_price numeric;
  v_pp    boolean;
begin
  perform app.require_permission(p_hotel_id, 'events.manage');
  if p_event_type not in ('wedding', 'conference', 'meeting', 'party', 'graduation', 'other') then
    raise exception 'Invalid event type' using errcode = '22023';
  end if;
  if p_hall_room_id is not null and not exists (
    select 1 from public.rooms rm join public.room_types t on t.id = rm.room_type_id
    where rm.id = p_hall_room_id and rm.hotel_id = p_hotel_id and t.booking_mode = 'hourly'
  ) then
    raise exception 'Choose an hourly hall' using errcode = '23514';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Add at least one item to the order' using errcode = '22023';
  end if;
  if v_id is not null then
    select * into v_e from public.event_bookings where id = v_id and hotel_id = p_hotel_id for update;
    if v_e.id is null then raise exception 'Event not found' using errcode = '23503'; end if;
    if v_e.status in ('completed', 'cancelled') then raise exception 'This event is closed' using errcode = '23514'; end if;
    update public.event_bookings set title = trim(p_title), event_type = p_event_type, contact_name = trim(p_contact_name),
      contact_phone = nullif(trim(p_contact_phone), ''), customer_id = p_customer_id, hall_room_id = p_hall_room_id,
      starts_at = p_starts_at, ends_at = p_ends_at, guests_count = coalesce(p_guests_count, 0), discount = coalesce(p_discount, 0),
      notes = nullif(trim(p_notes), ''), terms = nullif(trim(p_terms), '')
    where id = v_id;
    delete from public.event_items where event_id = v_id;
  else
    insert into public.event_bookings (hotel_id, event_number, title, event_type, contact_name, contact_phone, customer_id, hall_room_id,
      starts_at, ends_at, guests_count, discount, notes, terms, created_by)
    values (p_hotel_id, app.next_document_number(p_hotel_id, 'event', 'EV', p_starts_at::date), trim(p_title), p_event_type,
      trim(p_contact_name), nullif(trim(p_contact_phone), ''), p_customer_id, p_hall_room_id, p_starts_at, p_ends_at,
      coalesce(p_guests_count, 0), coalesce(p_discount, 0), nullif(trim(p_notes), ''), nullif(trim(p_terms), ''), auth.uid())
    returning id into v_id;
  end if;
  for v_line in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_line ->> 'quantity')::numeric;
    v_price := (v_line ->> 'unit_price')::numeric;
    v_pp := coalesce((v_line ->> 'per_person')::boolean, false);
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 then
      raise exception 'Invalid quantity' using errcode = '22023';
    end if;
    v_cc := nullif(v_line ->> 'charge_code_id', '')::uuid;
    if v_cc is null then
      select id into v_cc from public.charge_codes where hotel_id = p_hotel_id and code = 'EVENTS';
    end if;
    if v_cc is null or not exists (select 1 from public.charge_codes where id = v_cc and hotel_id = p_hotel_id) then
      raise exception 'Revenue code not found' using errcode = '23503';
    end if;
    v_n := v_n + 1;
    insert into public.event_items (event_id, line_no, hotel_id, description, per_person, quantity, unit_price, charge_code_id)
    values (v_id, v_n, p_hotel_id, trim(v_line ->> 'description'), v_pp, v_qty, v_price, v_cc);
    v_total := v_total + v_qty * v_price;
  end loop;
  if coalesce(p_discount, 0) > v_total then
    raise exception 'The discount is more than the event total' using errcode = '23514';
  end if;
  return v_id;
end;
$$;

-- تأكيد المناسبة: يُفتح فوليو باسم صاحبها لاستقبال العربون، وتصبح القاعة محجوزة نهائيًا
create or replace function public.confirm_event(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e     public.event_bookings%rowtype;
  v_folio uuid;
begin
  select * into v_e from public.event_bookings where id = p_event_id for update;
  if v_e.id is null then raise exception 'Event not found' using errcode = '23503'; end if;
  perform app.require_permission(v_e.hotel_id, 'events.manage');
  if v_e.status <> 'tentative' then raise exception 'Only a tentative event can be confirmed' using errcode = '23514'; end if;
  if not exists (select 1 from public.event_items where event_id = v_e.id) then
    raise exception 'Add at least one item to the order' using errcode = '22023';
  end if;
  v_folio := v_e.folio_id;
  if v_folio is null then
    -- الفوليو والعربون والفاتورة بصلاحيات الفوليو للمستخدم نفسه
    v_folio := public.open_folio(p_hotel_id => v_e.hotel_id, p_guest_name => v_e.contact_name,
      p_folio_type => (case when v_e.customer_id is null then 'non_guest' else 'company' end)::public.folio_type,
      p_customer_id => v_e.customer_id, p_arrival_date => v_e.starts_at::date, p_departure_date => v_e.ends_at::date,
      p_notes => v_e.event_number || '، ' || v_e.title);
  end if;
  update public.event_bookings set status = 'confirmed', folio_id = v_folio where id = v_e.id;
  return v_folio;
end;
$$;

-- إقفال المناسبة بعد إقامتها: تُرحَّل بنودها على فوليو المناسبة والخصم على أكبر بند، ثم تصدر الفاتورة من الفوليو بعد التسوية
create or replace function public.complete_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e      public.event_bookings%rowtype;
  v_i      public.event_items%rowtype;
  v_txn    uuid;
  v_big    uuid;
  v_bigamt numeric := -1;
  v_amt    numeric;
  v_date   date;
begin
  select * into v_e from public.event_bookings where id = p_event_id for update;
  if v_e.id is null then raise exception 'Event not found' using errcode = '23503'; end if;
  perform app.require_permission(v_e.hotel_id, 'events.manage');
  if v_e.status <> 'confirmed' then raise exception 'Only a confirmed event can be completed' using errcode = '23514'; end if;
  v_date := app.today_for_hotel(v_e.hotel_id);
  for v_i in select * from public.event_items where event_id = v_e.id and unit_price > 0 order by line_no loop
    v_txn := public.post_folio_charge(v_e.folio_id, v_i.charge_code_id, v_i.unit_price, v_i.quantity, v_date,
                                      v_i.description, v_e.event_number);
    select total_amount into v_amt from public.folio_transactions where id = v_txn;
    if v_amt > v_bigamt then v_big := v_txn; v_bigamt := v_amt; end if;
  end loop;
  if v_e.discount > 0 then
    if v_big is null or v_e.discount > v_bigamt then
      raise exception 'The discount is more than the event total' using errcode = '23514';
    end if;
    perform public.post_folio_allowance(v_e.folio_id, v_big, v_e.discount, 'خصم المناسبة ' || v_e.event_number, v_date);
  end if;
  update public.event_bookings set status = 'completed', completed_at = now() where id = v_e.id;
end;
$$;

create or replace function public.cancel_event(p_event_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.event_bookings%rowtype;
begin
  select * into v_e from public.event_bookings where id = p_event_id for update;
  if v_e.id is null then raise exception 'Event not found' using errcode = '23503'; end if;
  perform app.require_permission(v_e.hotel_id, 'events.manage');
  if v_e.status not in ('tentative', 'confirmed') then raise exception 'This event is closed' using errcode = '23514'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Write the cancellation reason' using errcode = '23514'; end if;
  update public.event_bookings set status = 'cancelled', cancel_reason = trim(p_reason) where id = v_e.id;
end;
$$;

-- =============================================================================
-- 5) تقييمات النزلاء
-- =============================================================================
create table public.guest_surveys (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  reservation_id  uuid unique,
  guest_name      text not null,
  room_number     text,
  token           text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  status          text not null default 'pending' check (status in ('pending', 'completed')),
  channel         text check (channel in ('kiosk', 'link', 'paper')),
  overall         smallint check (overall between 1 and 5),
  cleanliness     smallint check (cleanliness between 1 and 5),
  staff           smallint check (staff between 1 and 5),
  comfort         smallint check (comfort between 1 and 5),
  value           smallint check (value between 1 and 5),
  food            smallint check (food between 1 and 5),
  recommend       boolean,
  comment         text check (comment is null or length(comment) <= 2000),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  entered_by      uuid references auth.users(id),
  foreign key (hotel_id, reservation_id) references public.reservations (hotel_id, id),
  constraint survey_complete check (status = 'pending' or overall is not null)
);
create index guest_surveys_hotel on public.guest_surveys (hotel_id, status, completed_at desc);

-- عند المغادرة يُنشأ استبيان بانتظار النزيل
create or replace function app.survey_on_checkout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'checked_out' and old.status is distinct from 'checked_out' then
    insert into public.guest_surveys (hotel_id, reservation_id, guest_name, room_number)
    select new.hotel_id, new.id, coalesce((select full_name from public.guests where id = new.guest_id), ''),
           (select room_number from public.rooms where id = new.room_id)
    on conflict (reservation_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger reservations_survey after update of status on public.reservations for each row execute function app.survey_on_checkout();

-- تعبئة الاستبيان برمزه، بلا تسجيل دخول (من جهاز الاستقبال أو بالرابط)، ولمرة واحدة خلال 60 يومًا
create or replace function public.submit_guest_survey(
  p_token text, p_overall smallint, p_cleanliness smallint, p_staff smallint, p_comfort smallint, p_value smallint,
  p_food smallint, p_recommend boolean, p_comment text, p_channel text default 'kiosk'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.guest_surveys%rowtype;
begin
  select * into v_s from public.guest_surveys where token = p_token for update;
  if v_s.id is null or v_s.status <> 'pending' or v_s.created_at < now() - interval '60 days' then
    raise exception 'This survey link is no longer valid' using errcode = '23514';
  end if;
  if p_overall is null or p_overall not between 1 and 5 then
    raise exception 'Choose the overall rating' using errcode = '22023';
  end if;
  if p_channel not in ('kiosk', 'link') then raise exception 'Invalid action' using errcode = '22023'; end if;
  update public.guest_surveys set status = 'completed', channel = p_channel, overall = p_overall, cleanliness = p_cleanliness,
    staff = p_staff, comfort = p_comfort, value = p_value, food = p_food, recommend = p_recommend,
    comment = nullif(left(trim(coalesce(p_comment, '')), 2000), ''), completed_at = now()
  where id = v_s.id;
end;
$$;

-- ما تعرضه صفحة الاستبيان قبل تعبئته: اسم الفندق والنزيل وصلاحية الرابط
create or replace function public.survey_info(p_token text)
returns table (hotel_name text, hotel_name_en text, guest_name text, room_number text, valid boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select h.name_ar, h.name_en, s.guest_name, s.room_number,
         s.status = 'pending' and s.created_at >= now() - interval '60 days'
  from public.guest_surveys s join public.hotels h on h.id = s.hotel_id
  where s.token = p_token;
$$;

-- استبيان ورقي يُدخله الموظف
create or replace function public.record_paper_survey(
  p_hotel_id uuid, p_guest_name text, p_room_number text, p_overall smallint, p_cleanliness smallint, p_staff smallint,
  p_comfort smallint, p_value smallint, p_food smallint, p_recommend boolean, p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_permission(p_hotel_id, 'feedback.manage');
  if p_overall is null or p_overall not between 1 and 5 then
    raise exception 'Choose the overall rating' using errcode = '22023';
  end if;
  insert into public.guest_surveys (hotel_id, guest_name, room_number, status, channel, overall, cleanliness, staff, comfort, value, food,
    recommend, comment, completed_at, entered_by)
  values (p_hotel_id, coalesce(trim(p_guest_name), ''), nullif(trim(p_room_number), ''), 'completed', 'paper', p_overall,
    p_cleanliness, p_staff, p_comfort, p_value, p_food, p_recommend, nullif(left(trim(coalesce(p_comment, '')), 2000), ''), now(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- =============================================================================
-- RLS والتدقيق والصلاحيات
-- =============================================================================
alter table public.maintenance_assets enable row level security;
alter table public.maintenance_requests enable row level security;
alter table public.maintenance_parts enable row level security;
alter table public.lost_found_items enable row level security;
alter table public.safe_deposits enable row level security;
alter table public.laundry_items enable row level security;
alter table public.laundry_orders enable row level security;
alter table public.laundry_order_lines enable row level security;
alter table public.linen_types enable row level security;
alter table public.linen_movements enable row level security;
alter table public.event_bookings enable row level security;
alter table public.event_items enable row level security;
alter table public.event_tasks enable row level security;
alter table public.guest_surveys enable row level security;

-- من يبلّغ عن الأعطال أو يدير المفقودات والمناسبات يحتاج قائمة الغرف والقاعات
drop policy rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to authenticated using (
  hotel_id in (select app.permitted_hotels('pms.reservations.view'))
  or hotel_id in (select app.permitted_hotels('pms.rooms.status'))
  or hotel_id in (select app.permitted_hotels('pms.setup.manage'))
  or hotel_id in (select app.permitted_hotels('maintenance.report'))
  or hotel_id in (select app.permitted_hotels('maintenance.manage'))
  or hotel_id in (select app.permitted_hotels('lost_found.manage'))
  or hotel_id in (select app.permitted_hotels('events.view')));

create policy maintenance_assets_read on public.maintenance_assets for select to authenticated
  using (hotel_id in (select app.permitted_hotels('maintenance.report')) or hotel_id in (select app.permitted_hotels('maintenance.manage')));
create policy maintenance_assets_write on public.maintenance_assets for all to authenticated
  using (hotel_id in (select app.permitted_hotels('maintenance.manage'))) with check (hotel_id in (select app.permitted_hotels('maintenance.manage')));
create policy maintenance_requests_read on public.maintenance_requests for select to authenticated
  using (hotel_id in (select app.permitted_hotels('maintenance.report')) or hotel_id in (select app.permitted_hotels('maintenance.manage')));
create policy maintenance_parts_read on public.maintenance_parts for select to authenticated
  using (hotel_id in (select app.permitted_hotels('maintenance.manage')));

create policy lost_found_items_read on public.lost_found_items for select to authenticated
  using (hotel_id in (select app.permitted_hotels('lost_found.manage')));
create policy safe_deposits_read on public.safe_deposits for select to authenticated
  using (hotel_id in (select app.permitted_hotels('lost_found.manage')));

create policy laundry_items_read on public.laundry_items for select to authenticated
  using (hotel_id in (select app.permitted_hotels('laundry.manage')));
create policy laundry_items_write on public.laundry_items for all to authenticated
  using (hotel_id in (select app.permitted_hotels('laundry.manage'))) with check (hotel_id in (select app.permitted_hotels('laundry.manage')));
create policy laundry_orders_read on public.laundry_orders for select to authenticated
  using (hotel_id in (select app.permitted_hotels('laundry.manage')));
create policy laundry_order_lines_read on public.laundry_order_lines for select to authenticated
  using (hotel_id in (select app.permitted_hotels('laundry.manage')));
create policy linen_types_read on public.linen_types for select to authenticated
  using (hotel_id in (select app.permitted_hotels('laundry.manage')));
create policy linen_types_write on public.linen_types for all to authenticated
  using (hotel_id in (select app.permitted_hotels('laundry.manage'))) with check (hotel_id in (select app.permitted_hotels('laundry.manage')));
create policy linen_movements_read on public.linen_movements for select to authenticated
  using (hotel_id in (select app.permitted_hotels('laundry.manage')));
create policy linen_movements_insert on public.linen_movements for insert to authenticated
  with check (hotel_id in (select app.permitted_hotels('laundry.manage')));

create policy event_bookings_read on public.event_bookings for select to authenticated
  using (hotel_id in (select app.permitted_hotels('events.view')) or hotel_id in (select app.permitted_hotels('events.manage')));
create policy event_items_read on public.event_items for select to authenticated
  using (hotel_id in (select app.permitted_hotels('events.view')) or hotel_id in (select app.permitted_hotels('events.manage')));
create policy event_tasks_read on public.event_tasks for select to authenticated
  using (hotel_id in (select app.permitted_hotels('events.view')) or hotel_id in (select app.permitted_hotels('events.manage')));
create policy event_tasks_write on public.event_tasks for all to authenticated
  using (hotel_id in (select app.permitted_hotels('events.manage'))) with check (hotel_id in (select app.permitted_hotels('events.manage')));

create policy guest_surveys_read on public.guest_surveys for select to authenticated
  using (hotel_id in (select app.permitted_hotels('feedback.view')) or hotel_id in (select app.permitted_hotels('feedback.manage')));

create trigger maintenance_assets_set_created before insert on public.maintenance_assets for each row execute function app.set_created_by();
create trigger laundry_items_set_created before insert on public.laundry_items for each row execute function app.set_created_by();
create trigger linen_types_set_created before insert on public.linen_types for each row execute function app.set_created_by();
create trigger linen_movements_set_created before insert on public.linen_movements for each row execute function app.set_created_by();
create trigger event_tasks_set_created before insert on public.event_tasks for each row execute function app.set_created_by();

create trigger audit_maintenance_assets after insert or update or delete on public.maintenance_assets for each row execute function app.audit_trigger();
create trigger audit_maintenance_requests after insert or update or delete on public.maintenance_requests for each row execute function app.audit_trigger();
create trigger audit_maintenance_parts after insert or update or delete on public.maintenance_parts for each row execute function app.audit_trigger();
create trigger audit_lost_found_items after insert or update or delete on public.lost_found_items for each row execute function app.audit_trigger();
create trigger audit_safe_deposits after insert or update or delete on public.safe_deposits for each row execute function app.audit_trigger();
create trigger audit_laundry_items after insert or update or delete on public.laundry_items for each row execute function app.audit_trigger();
create trigger audit_laundry_orders after insert or update or delete on public.laundry_orders for each row execute function app.audit_trigger();
create trigger audit_linen_movements after insert or update or delete on public.linen_movements for each row execute function app.audit_trigger();
create trigger audit_event_bookings after insert or update or delete on public.event_bookings for each row execute function app.audit_trigger();
create trigger audit_event_tasks after insert or update or delete on public.event_tasks for each row execute function app.audit_trigger();
create trigger audit_guest_surveys after insert or update or delete on public.guest_surveys for each row execute function app.audit_trigger();

revoke execute on all functions in schema app from public, anon;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_maintenance_request(uuid, text, text, uuid, uuid, text, text, boolean, date)',
    'public.update_maintenance_request(uuid, text, text, text, text, numeric)',
    'public.add_maintenance_part(uuid, text, numeric, numeric, uuid)',
    'public.register_lost_item(uuid, text, date, text, uuid, text, text, text, uuid)',
    'public.close_lost_item(uuid, text, text, text, text)',
    'public.open_safe_deposit(uuid, text, text, text, uuid)',
    'public.return_safe_deposit(uuid, text)',
    'public.services_in_house(uuid)',
    'public.create_laundry_order(uuid, jsonb, boolean, numeric, timestamptz, text)',
    'public.update_laundry_order(uuid, text)',
    'public.save_event(uuid, uuid, text, text, text, text, uuid, uuid, timestamp, timestamp, integer, numeric, text, text, jsonb)',
    'public.confirm_event(uuid)',
    'public.complete_event(uuid)',
    'public.cancel_event(uuid, text)',
    'public.record_paper_survey(uuid, text, text, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- الاستبيان برمزه متاح بلا دخول
revoke all on function public.submit_guest_survey(text, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text) from public;
grant execute on function public.submit_guest_survey(text, smallint, smallint, smallint, smallint, smallint, smallint, boolean, text, text) to anon, authenticated;
revoke all on function public.survey_info(text) from public;
grant execute on function public.survey_info(text) to anon, authenticated;
grant select on public.linen_balances to authenticated;

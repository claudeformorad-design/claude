-- =============================================================================
-- المرحلة الخامسة: الأقسام التشغيلية
--   1) نقاط البيع (مطعم، كافيه، ...): أصناف بأسعارها ورموز إيرادها؛ الطلب يُرحَّل على
--      فوليو غرفة النزيل المقيم، أو يُدفع فورًا فيصدر فاتورة ضريبية (عبر فوليو غير مقيم).
--   2) التدبير الفندقي: مهام يومية للغرف (مغادرة، إقامة مستمرة، فحص، صيانة) بإسنادها
--      لعامل وحالاتها؛ إنجاز التنظيف يجعل الغرفة نظيفة، والصيانة تُخرج الغرفة من الخدمة وتعيدها.
--   3) خطط الأسعار: نسبة تعديل على السعر وإضافة لكل ليلة (مثل الإفطار لكل شخص)،
--      ويمكن قصرها على شركة أو نوع غرفة.
-- =============================================================================

insert into public.permissions (code, module, action, name_ar, name_en, sort_order, product) values
  ('pos.sell',            'pos', 'manage', 'البيع في نقاط البيع',                 'Sell at points of sale',   1100, 'pms'),
  ('pos.manage',          'pos', 'manage', 'إعداد نقاط البيع وأصنافها',           'Set up outlets & items',   1110, 'pms'),
  ('pms.housekeeping',    'pms', 'manage', 'مهام التدبير الفندقي',                'Housekeeping tasks',       1120, 'pms');

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and p.code in ('pos.sell', 'pos.manage', 'pms.housekeeping') and (
  r.code = 'general_manager'
  or (r.code in ('receptionist', 'cashier') and p.code = 'pos.sell')
  or (r.code in ('receptionist', 'housekeeping') and p.code = 'pms.housekeeping')
)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 1) نقاط البيع
-- -----------------------------------------------------------------------------
create table public.pos_outlets (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  code        text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar     text not null check (length(trim(name_ar)) > 0),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  unique (hotel_id, code),
  unique (hotel_id, id)
);

create table public.pos_items (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null,
  outlet_id       uuid not null,
  name_ar         text not null check (length(trim(name_ar)) > 0),
  category        text,
  price           numeric(19, 4) not null check (price > 0),
  charge_code_id  uuid not null,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  unique (hotel_id, id),
  foreign key (hotel_id, outlet_id) references public.pos_outlets (hotel_id, id) on delete cascade,
  foreign key (hotel_id, charge_code_id) references public.charge_codes (hotel_id, id)
);
create index pos_items_outlet on public.pos_items (outlet_id, sort_order);

create table public.pos_orders (
  id                 uuid primary key default gen_random_uuid(),
  hotel_id           uuid not null,
  outlet_id          uuid not null,
  order_number       text not null,
  settle_mode        text not null check (settle_mode in ('room', 'paid')),
  reservation_id     uuid references public.reservations(id),
  folio_id           uuid not null,
  invoice_id         uuid references public.invoices(id),
  payment_method_id  uuid,
  total              numeric(19, 4) not null,
  note               text,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  unique (hotel_id, order_number),
  unique (hotel_id, id),
  foreign key (hotel_id, outlet_id) references public.pos_outlets (hotel_id, id),
  foreign key (hotel_id, folio_id) references public.guest_folios (hotel_id, id)
);
create index pos_orders_hotel_created on public.pos_orders (hotel_id, created_at desc);

create table public.pos_order_lines (
  order_id              uuid not null references public.pos_orders(id) on delete cascade,
  line_no               integer not null,
  hotel_id              uuid not null,
  item_id               uuid not null,
  name_ar               text not null,
  quantity              numeric(12, 3) not null check (quantity > 0),
  unit_price            numeric(19, 4) not null,
  folio_transaction_id  uuid references public.folio_transactions(id),
  primary key (order_id, line_no),
  foreign key (hotel_id, item_id) references public.pos_items (hotel_id, id)
);

-- النزلاء المقيمون للترحيل على غرفهم (لمن يبيع ولو لم يملك صلاحية الحجوزات)
create or replace function public.pos_in_house(p_hotel_id uuid)
returns table (reservation_id uuid, room_number text, guest_name text, confirmation_number text, folio_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'pos.sell');
  return query
  select r.id, rm.room_number, g.full_name, r.confirmation_number, r.folio_id
  from public.reservations r
  join public.guests g on g.id = r.guest_id
  left join public.rooms rm on rm.id = r.room_id
  where r.hotel_id = p_hotel_id and r.status = 'checked_in' and r.folio_id is not null
  order by rm.room_number;
end;
$$;

-- تسوية طلب: على الغرفة (فوليو الحجز) أو مدفوع فورًا (فوليو غير مقيم + دفعة + فاتورة)
create or replace function public.pos_settle_order(
  p_outlet_id         uuid,
  p_lines             jsonb,
  p_mode              text,
  p_reservation_id    uuid default null,
  p_payment_method_id uuid default null,
  p_note              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outlet  public.pos_outlets%rowtype;
  v_res     public.reservations%rowtype;
  v_item    public.pos_items%rowtype;
  v_line    jsonb;
  v_qty     numeric;
  v_folio   uuid;
  v_order   uuid;
  v_number  text;
  v_today   date;
  v_txn     uuid;
  v_n       integer := 0;
  v_total   numeric;
  v_invoice uuid;
begin
  select * into v_outlet from public.pos_outlets where id = p_outlet_id and is_active;
  if v_outlet.id is null then
    raise exception 'Point of sale not found or inactive' using errcode = '23503';
  end if;
  perform app.require_permission(v_outlet.hotel_id, 'pos.sell');
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item to the order' using errcode = '22023';
  end if;
  if p_mode not in ('room', 'paid') then
    raise exception 'Invalid settlement option' using errcode = '22023';
  end if;
  v_today := app.today_for_hotel(v_outlet.hotel_id);
  v_number := app.next_document_number(v_outlet.hotel_id, 'pos_order', 'POS', v_today);

  if p_mode = 'room' then
    select * into v_res from public.reservations where id = p_reservation_id and hotel_id = v_outlet.hotel_id;
    if v_res.id is null or v_res.status <> 'checked_in' or v_res.folio_id is null then
      raise exception 'Room charges are for in-house guests only' using errcode = '23514';
    end if;
    v_folio := v_res.folio_id;
  else
    if p_payment_method_id is null then
      raise exception 'Select a payment method' using errcode = '22023';
    end if;
    v_folio := public.open_folio(p_hotel_id => v_outlet.hotel_id, p_guest_name => 'زبون ' || v_outlet.name_ar,
                                 p_folio_type => 'non_guest', p_notes => v_number);
  end if;

  insert into public.pos_orders (hotel_id, outlet_id, order_number, settle_mode, reservation_id, folio_id, payment_method_id, total, note, created_by)
  values (v_outlet.hotel_id, v_outlet.id, v_number, p_mode, v_res.id, v_folio, p_payment_method_id, 0, nullif(trim(p_note), ''), auth.uid())
  returning id into v_order;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.pos_items
     where id = (v_line ->> 'item_id')::uuid and outlet_id = v_outlet.id and is_active;
    if v_item.id is null then
      raise exception 'Item not found or inactive' using errcode = '23503';
    end if;
    v_qty := (v_line ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 1000 or round(v_qty, 3) <> v_qty then
      raise exception 'Invalid quantity' using errcode = '22023';
    end if;
    v_txn := public.post_folio_charge(v_folio, v_item.charge_code_id, v_item.price, v_qty, v_today,
                                      v_outlet.name_ar || ': ' || v_item.name_ar, v_number);
    v_n := v_n + 1;
    insert into public.pos_order_lines (order_id, line_no, hotel_id, item_id, name_ar, quantity, unit_price, folio_transaction_id)
    values (v_order, v_n, v_outlet.hotel_id, v_item.id, v_item.name_ar, v_qty, v_item.price, v_txn);
  end loop;

  select coalesce(sum(t.total_amount), 0) into v_total
  from public.folio_transactions t join public.pos_order_lines l on l.folio_transaction_id = t.id
  where l.order_id = v_order;

  if p_mode = 'paid' then
    perform public.post_folio_payment(v_folio, p_payment_method_id, v_total, v_today, v_number, 'دفع طلب ' || v_number);
    v_invoice := public.checkout_folio(v_folio, v_today);
  end if;

  update public.pos_orders set total = v_total, invoice_id = v_invoice where id = v_order;
  return jsonb_build_object('order_id', v_order, 'order_number', v_number, 'total', v_total, 'invoice_id', v_invoice, 'folio_id', v_folio);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) التدبير الفندقي
-- -----------------------------------------------------------------------------
create table public.housekeeping_tasks (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null,
  room_id       uuid not null,
  task_date     date not null,
  kind          text not null check (kind in ('departure', 'stayover', 'inspection', 'maintenance', 'turndown')),
  status        text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  assignee      text,
  priority      smallint not null default 2 check (priority between 1 and 3),
  notes         text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  started_at    timestamptz,
  completed_at  timestamptz,
  completed_by  uuid references auth.users(id),
  foreign key (hotel_id, room_id) references public.rooms (hotel_id, id) on delete cascade
);
create unique index housekeeping_tasks_one_per_kind on public.housekeeping_tasks (room_id, task_date, kind) where status <> 'cancelled';
create index housekeeping_tasks_hotel_date on public.housekeeping_tasks (hotel_id, task_date);

-- مهام اليوم تلقائيًا: كل غرفة تحتاج تنظيف (مغادرة إن كانت شاغرة، وإلا إقامة مستمرة) وكل غرفة مشغولة
create or replace function public.generate_housekeeping_tasks(p_hotel_id uuid, p_date date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date  date;
  v_count integer;
begin
  perform app.require_permission(p_hotel_id, 'pms.housekeeping');
  v_date := coalesce(p_date, app.today_for_hotel(p_hotel_id));
  with occupied as (
    select distinct room_id from public.reservations
     where hotel_id = p_hotel_id and status = 'checked_in' and booking_mode = 'nightly' and room_id is not null
  ), candidates as (
    select rm.id as room_id,
           case when o.room_id is not null then 'stayover' else 'departure' end as kind,
           case when rm.housekeeping_status = 'dirty' and o.room_id is null then 1 else 2 end as priority
    from public.rooms rm
    join public.room_types t on t.id = rm.room_type_id and t.booking_mode = 'nightly'
    left join occupied o on o.room_id = rm.id
    where rm.hotel_id = p_hotel_id and rm.is_active and rm.service_status = 'in_service'
      and (rm.housekeeping_status = 'dirty' or o.room_id is not null)
  ), inserted as (
    insert into public.housekeeping_tasks (hotel_id, room_id, task_date, kind, priority, created_by)
    select p_hotel_id, c.room_id, v_date, c.kind, c.priority, auth.uid() from candidates c
    where not exists (select 1 from public.housekeeping_tasks h
                       where h.room_id = c.room_id and h.task_date = v_date and h.status <> 'cancelled'
                         and h.kind in ('departure', 'stayover'))
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

create or replace function public.add_housekeeping_task(
  p_room_id uuid, p_kind text, p_date date default null, p_notes text default null,
  p_assignee text default null, p_out_of_service boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_id   uuid;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.id is null then
    raise exception 'Room not found or inactive' using errcode = '23503';
  end if;
  perform app.require_permission(v_room.hotel_id, 'pms.housekeeping');
  if p_kind not in ('departure', 'stayover', 'inspection', 'maintenance', 'turndown') then
    raise exception 'Invalid task type' using errcode = '22023';
  end if;
  if p_kind = 'maintenance' and length(trim(coalesce(p_notes, ''))) = 0 then
    raise exception 'Describe the maintenance issue' using errcode = '23514';
  end if;
  insert into public.housekeeping_tasks (hotel_id, room_id, task_date, kind, notes, assignee, priority, created_by)
  values (v_room.hotel_id, v_room.id, coalesce(p_date, app.today_for_hotel(v_room.hotel_id)), p_kind,
          nullif(trim(p_notes), ''), nullif(trim(p_assignee), ''), case when p_kind = 'maintenance' then 1 else 2 end, auth.uid())
  returning id into v_id;
  if p_kind = 'maintenance' and p_out_of_service then
    update public.rooms set service_status = 'out_of_service', service_note = trim(p_notes) where id = v_room.id;
  end if;
  return v_id;
end;
$$;

-- تحديث مهمة: الإسناد، البدء، الإنجاز (ينعكس على حالة الغرفة) أو الإلغاء
create or replace function public.update_housekeeping_task(
  p_task_id uuid, p_status text default null, p_assignee text default null, p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.housekeeping_tasks%rowtype;
begin
  select * into v_t from public.housekeeping_tasks where id = p_task_id for update;
  if v_t.id is null then
    raise exception 'Housekeeping task not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_t.hotel_id, 'pms.housekeeping');
  if v_t.status in ('done', 'cancelled') then
    raise exception 'This task is already closed' using errcode = '23514';
  end if;
  if p_status is not null and p_status not in ('pending', 'in_progress', 'done', 'cancelled') then
    raise exception 'Invalid task status' using errcode = '22023';
  end if;
  update public.housekeeping_tasks set
    status = coalesce(p_status, status),
    assignee = case when p_assignee is null then assignee else nullif(trim(p_assignee), '') end,
    notes = case when p_notes is null then notes else nullif(trim(p_notes), '') end,
    started_at = case when p_status = 'in_progress' and started_at is null then now() else started_at end,
    completed_at = case when p_status = 'done' then now() else completed_at end,
    completed_by = case when p_status = 'done' then auth.uid() else completed_by end
  where id = v_t.id;

  if p_status = 'done' then
    if v_t.kind in ('departure', 'stayover', 'turndown') then
      update public.rooms set housekeeping_status = 'clean' where id = v_t.room_id and housekeeping_status = 'dirty';
    elsif v_t.kind = 'inspection' then
      update public.rooms set housekeeping_status = 'inspected' where id = v_t.room_id;
    elsif v_t.kind = 'maintenance' then
      update public.rooms set service_status = 'in_service', service_note = null where id = v_t.room_id and service_status = 'out_of_service';
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) خطط الأسعار
-- -----------------------------------------------------------------------------
create table public.rate_plans (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references public.hotels(id) on delete cascade,
  code                text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar             text not null check (length(trim(name_ar)) > 0),
  -- نسبة على سعر الليلة (−10 = خصم 10%)
  adjust_pct          numeric(7, 3) not null default 0 check (adjust_pct between -100 and 500),
  -- إضافة ثابتة لكل ليلة (مثل الإفطار)، لكل شخص بالغ أو لكل غرفة
  per_night           numeric(19, 4) not null default 0 check (per_night >= 0),
  per_person          boolean not null default false,
  includes_breakfast  boolean not null default false,
  customer_id         uuid,
  room_type_id        uuid,
  description         text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  unique (hotel_id, code),
  unique (hotel_id, id),
  foreign key (hotel_id, customer_id) references public.customers (hotel_id, id),
  foreign key (hotel_id, room_type_id) references public.room_types (hotel_id, id)
);

alter table public.reservations add column rate_plan_id uuid;
alter table public.reservations
  add constraint reservations_rate_plan_fk foreign key (hotel_id, rate_plan_id) references public.rate_plans (hotel_id, id);

-- أسطر الليالي بعد تطبيق خطة السعر (للتسعير القياسي الليلي فقط)
create or replace function app.pms_write_nights(p_reservation_id uuid, p_keep_existing boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r    public.reservations%rowtype;
  v_p    public.rate_plans%rowtype;
  v_keep boolean;
  v_dec  smallint;
  v_f    numeric := 1;
  v_add  numeric := 0;
begin
  select * into v_r from public.reservations where id = p_reservation_id;
  if exists (
    select 1 from public.reservation_nights e
    where e.reservation_id = p_reservation_id and e.folio_transaction_id is not null
      and (e.stay_date < v_r.arrival_date or e.stay_date >= v_r.departure_date)
  ) then
    raise exception 'Nights already charged to the folio cannot be removed' using errcode = '23514';
  end if;
  v_keep := p_keep_existing and v_r.pricing = 'standard' and v_r.booking_mode = 'nightly';
  v_dec := app.currency_decimals(v_r.hotel_id);
  if v_r.rate_plan_id is not null and v_r.pricing = 'standard' and v_r.booking_mode = 'nightly' then
    select * into v_p from public.rate_plans where id = v_r.rate_plan_id;
    v_f := 1 + v_p.adjust_pct / 100;
    v_add := v_p.per_night * case when v_p.per_person then v_r.adults else 1 end;
  end if;

  delete from public.reservation_nights e
   where e.reservation_id = p_reservation_id and e.folio_transaction_id is null
     and (not v_keep or e.stay_date < v_r.arrival_date or e.stay_date >= v_r.departure_date);

  insert into public.reservation_nights (reservation_id, hotel_id, stay_date, quantity, rate, discount, amount, season_id)
  select p_reservation_id, v_r.hotel_id, l.stay_date, l.quantity, x.rate, x.discount, x.amount, l.season_id
  from app.pms_price_lines(v_r.room_type_id, v_r.arrival_date, v_r.departure_date, v_r.pricing,
                           v_r.fixed_rate, v_r.starts_at, v_r.ends_at, v_r.last_minute_pct) l
  -- بلا خطة: الأسطر كما هي؛ مع خطة (ليلي قياسي، كمية 1): السعر والخصم بالنسبة ثم الإضافة
  cross join lateral (
    select case when v_f = 1 and v_add = 0 then l.rate else round(l.rate * v_f + v_add, v_dec) end as rate,
           case when v_f = 1 and v_add = 0 then l.discount else round(l.discount * v_f, v_dec) end as discount,
           case when v_f = 1 and v_add = 0 then l.amount
                else round(l.rate * v_f + v_add, v_dec) - round(l.discount * v_f, v_dec) end as amount
  ) x
  where not exists (
    select 1 from public.reservation_nights e where e.reservation_id = p_reservation_id and e.stay_date = l.stay_date
  );

  update public.reservations
     set total_amount = (select coalesce(sum(n.amount), 0) from public.reservation_nights n where n.reservation_id = p_reservation_id)
   where id = p_reservation_id;
end;
$$;

-- تطبيق خطة سعر على حجز: تُعاد تسعير الليالي غير المرحّلة
create or replace function public.set_reservation_rate_plan(p_reservation_id uuid, p_rate_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
  v_p public.rate_plans%rowtype;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status not in ('tentative', 'confirmed', 'checked_in') then
    raise exception 'Only active reservations can be changed' using errcode = '23514';
  end if;
  if p_rate_plan_id is not null then
    select * into v_p from public.rate_plans where id = p_rate_plan_id and hotel_id = v_r.hotel_id and is_active;
    if v_p.id is null then
      raise exception 'Rate plan not found or inactive' using errcode = '23503';
    end if;
    if v_r.booking_mode <> 'nightly' or v_r.pricing <> 'standard' then
      raise exception 'Rate plans apply to standard nightly pricing only' using errcode = '23514';
    end if;
    if v_p.customer_id is not null and v_p.customer_id is distinct from v_r.customer_id then
      raise exception 'This rate plan is reserved for another company' using errcode = '23514';
    end if;
    if v_p.room_type_id is not null and v_p.room_type_id <> v_r.room_type_id then
      raise exception 'This rate plan is for another room type' using errcode = '23514';
    end if;
  end if;
  update public.reservations set rate_plan_id = p_rate_plan_id where id = v_r.id;
  perform app.pms_write_nights(v_r.id, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS والتدقيق والصلاحيات
-- -----------------------------------------------------------------------------
alter table public.pos_outlets enable row level security;
alter table public.pos_items enable row level security;
alter table public.pos_orders enable row level security;
alter table public.pos_order_lines enable row level security;
alter table public.housekeeping_tasks enable row level security;
alter table public.rate_plans enable row level security;

create policy pos_outlets_read on public.pos_outlets for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pos.sell')) or hotel_id in (select app.permitted_hotels('pos.manage')));
create policy pos_outlets_write on public.pos_outlets for all to authenticated
  using (hotel_id in (select app.permitted_hotels('pos.manage'))) with check (hotel_id in (select app.permitted_hotels('pos.manage')));
create policy pos_items_read on public.pos_items for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pos.sell')) or hotel_id in (select app.permitted_hotels('pos.manage')));
create policy pos_items_write on public.pos_items for all to authenticated
  using (hotel_id in (select app.permitted_hotels('pos.manage'))) with check (hotel_id in (select app.permitted_hotels('pos.manage')));
create policy pos_orders_read on public.pos_orders for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pos.sell')) or hotel_id in (select app.permitted_hotels('pos.manage')));
create policy pos_order_lines_read on public.pos_order_lines for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pos.sell')) or hotel_id in (select app.permitted_hotels('pos.manage')));
create policy housekeeping_tasks_read on public.housekeeping_tasks for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.housekeeping')) or hotel_id in (select app.permitted_hotels('pms.reservations.view')));
create policy rate_plans_read on public.rate_plans for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.reservations.view')));
create policy rate_plans_write on public.rate_plans for all to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.rates.manage'))) with check (hotel_id in (select app.permitted_hotels('pms.rates.manage')));

create trigger pos_outlets_set_created before insert on public.pos_outlets for each row execute function app.set_created_by();
create trigger pos_items_set_created before insert on public.pos_items for each row execute function app.set_created_by();
create trigger rate_plans_set_created before insert on public.rate_plans for each row execute function app.set_created_by();
create trigger audit_pos_outlets after insert or update or delete on public.pos_outlets for each row execute function app.audit_trigger();
create trigger audit_pos_items after insert or update or delete on public.pos_items for each row execute function app.audit_trigger();
create trigger audit_pos_orders after insert or update or delete on public.pos_orders for each row execute function app.audit_trigger();
create trigger audit_housekeeping_tasks after insert or update or delete on public.housekeeping_tasks for each row execute function app.audit_trigger();
create trigger audit_rate_plans after insert or update or delete on public.rate_plans for each row execute function app.audit_trigger();

revoke execute on all functions in schema app from public, anon;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.pos_in_house(uuid)',
    'public.pos_settle_order(uuid, jsonb, text, uuid, uuid, text)',
    'public.generate_housekeeping_tasks(uuid, date)',
    'public.add_housekeeping_task(uuid, text, date, text, text, boolean)',
    'public.update_housekeeping_task(uuid, text, text, text)',
    'public.set_reservation_rate_plan(uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

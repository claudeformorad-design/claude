-- =============================================================================
-- المخزون الكامل:
--   فئات الأصناف ووحدات القياس، الباركود (توليد EAN-13 داخلي يبدأ بـ 200)، سعر البيع وسجل تغيّره
--   وتعديله جماعيًا بنسبة، تتبّع الصلاحية بدفعات (كل وارد دفعة بتاريخ انتهاء، والصادر يُخصم من الأقرب
--   انتهاءً أولًا)، والجرد الفعلي: إدخال الكميات المعدودة لعدة أصناف يرحّل الفروقات تسويات مخزون.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) الفئات والوحدات
-- -----------------------------------------------------------------------------
create table public.inventory_categories (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  code        text not null check (code ~ '^[A-Z0-9_.-]{1,20}$'),
  name_ar     text not null check (length(trim(name_ar)) > 0),
  name_en     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (hotel_id, code),
  unique (hotel_id, id)
);
alter table public.inventory_categories enable row level security;
create policy inventory_categories_read on public.inventory_categories for select to authenticated using (hotel_id in (select app.permitted_hotels('inventory.view')));
create policy inventory_categories_insert on public.inventory_categories for insert to authenticated with check (hotel_id in (select app.permitted_hotels('inventory.manage')));
create policy inventory_categories_update on public.inventory_categories for update to authenticated
  using (hotel_id in (select app.permitted_hotels('inventory.manage'))) with check (hotel_id in (select app.permitted_hotels('inventory.manage')));
create trigger audit_inventory_categories after insert or update or delete on public.inventory_categories for each row execute function app.audit_trigger();

create table public.inventory_units (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  name_ar     text not null check (length(trim(name_ar)) between 1 and 30),
  name_en     text,
  created_at  timestamptz not null default now(),
  unique (hotel_id, name_ar)
);
alter table public.inventory_units enable row level security;
create policy inventory_units_read on public.inventory_units for select to authenticated using (hotel_id in (select app.permitted_hotels('inventory.view')));
create policy inventory_units_insert on public.inventory_units for insert to authenticated with check (hotel_id in (select app.permitted_hotels('inventory.manage')));
create policy inventory_units_delete on public.inventory_units for delete to authenticated using (hotel_id in (select app.permitted_hotels('inventory.manage')));
create trigger audit_inventory_units after insert or update or delete on public.inventory_units for each row execute function app.audit_trigger();

-- وحدات شائعة لكل فندق (الحالي والجديد)
create or replace function app.seed_inventory_units(p_hotel_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.inventory_units (hotel_id, name_ar, name_en)
  select p_hotel_id, u.ar, u.en from (values ('حبة', 'Piece'), ('كرتون', 'Carton'), ('علبة', 'Box'), ('كيلو', 'Kg'),
    ('لتر', 'Liter'), ('عبوة', 'Pack'), ('رول', 'Roll'), ('طقم', 'Set')) u(ar, en)
  on conflict (hotel_id, name_ar) do nothing;
$$;
create or replace function app.hotels_seed_units() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform app.seed_inventory_units(new.id); return new; end; $$;
create trigger hotels_seed_inventory_units after insert on public.hotels for each row execute function app.hotels_seed_units();
select app.seed_inventory_units(id) from public.hotels;

-- -----------------------------------------------------------------------------
-- 2) حقول الصنف الجديدة
-- -----------------------------------------------------------------------------
alter table public.inventory_items
  add column category_id  uuid references public.inventory_categories(id) on delete set null,
  add column barcode      text check (barcode is null or barcode ~ '^[0-9A-Z-]{4,32}$'),
  add column sale_price   numeric(19, 4) check (sale_price is null or sale_price >= 0),
  add column track_expiry boolean not null default false;
create unique index inventory_items_barcode on public.inventory_items (hotel_id, barcode) where barcode is not null;

create or replace function app.inventory_items_category_check() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.category_id is not null and not exists (select 1 from public.inventory_categories where id = new.category_id and hotel_id = new.hotel_id) then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  return new;
end; $$;
create trigger inventory_items_category_check before insert or update of category_id on public.inventory_items
  for each row execute function app.inventory_items_category_check();

-- رقم الباركود التالي: EAN-13 داخلي (200 + تسلسل من 9 أرقام + رقم تحقق)
create or replace function public.next_item_barcode(p_hotel_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq  bigint;
  v_body text;
  v_sum  integer := 0;
  i      integer;
begin
  perform app.require_permission(p_hotel_id, 'inventory.manage');
  perform pg_advisory_xact_lock(hashtext('barcode:' || p_hotel_id::text));
  select coalesce(max(substr(barcode, 4, 9)::bigint), 0) + 1 into v_seq
    from public.inventory_items where hotel_id = p_hotel_id and barcode ~ '^200[0-9]{10}$';
  v_body := '200' || lpad(v_seq::text, 9, '0');
  for i in 1..12 loop
    v_sum := v_sum + substr(v_body, i, 1)::integer * case when i % 2 = 0 then 3 else 1 end;
  end loop;
  return v_body || ((10 - v_sum % 10) % 10)::text;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) سجل تغيّر سعر البيع، والتعديل الجماعي
-- -----------------------------------------------------------------------------
create table public.inventory_price_changes (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  item_id     uuid not null references public.inventory_items(id) on delete cascade,
  old_price   numeric(19, 4),
  new_price   numeric(19, 4),
  changed_at  timestamptz not null default now(),
  changed_by  uuid references auth.users(id)
);
create index inventory_price_changes_item_idx on public.inventory_price_changes (hotel_id, changed_at desc);
alter table public.inventory_price_changes enable row level security;
create policy inventory_price_changes_read on public.inventory_price_changes for select to authenticated using (hotel_id in (select app.permitted_hotels('inventory.view')));

create or replace function app.inventory_price_history() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.sale_price is distinct from old.sale_price then
    insert into public.inventory_price_changes (hotel_id, item_id, old_price, new_price, changed_by)
    values (new.hotel_id, new.id, old.sale_price, new.sale_price, auth.uid());
  end if;
  return new;
end; $$;
create trigger inventory_items_price_history after update of sale_price on public.inventory_items
  for each row execute function app.inventory_price_history();

-- رفع أو خفض أسعار البيع بنسبة (لفئة أو للكل)، مع تقريب اختياري لأقرب مضاعف
create or replace function public.bulk_change_prices(p_hotel_id uuid, p_percent numeric, p_category_id uuid default null, p_round_to numeric default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_dec   smallint;
begin
  perform app.require_permission(p_hotel_id, 'inventory.manage');
  if p_percent is null or p_percent = 0 or p_percent <= -100 or p_percent > 1000 then
    raise exception 'Enter a percentage between -99 and 1000' using errcode = '23514';
  end if;
  if p_round_to is not null and p_round_to <= 0 then
    raise exception 'Rounding must be greater than zero' using errcode = '23514';
  end if;
  v_dec := app.currency_decimals(p_hotel_id);
  update public.inventory_items
     set sale_price = case when p_round_to is null then round(sale_price * (1 + p_percent / 100), v_dec)
                           else greatest(round(sale_price * (1 + p_percent / 100) / p_round_to) * p_round_to, 0) end
   where hotel_id = p_hotel_id and sale_price is not null and is_active
     and (p_category_id is null or category_id = p_category_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) دفعات الصلاحية
-- -----------------------------------------------------------------------------
create table public.inventory_lots (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  item_id        uuid not null references public.inventory_items(id),
  receipt_txn_id uuid not null references public.inventory_transactions(id),
  received_on    date not null,
  expiry_date    date,
  received_qty   numeric(14, 3) not null check (received_qty > 0),
  remaining_qty  numeric(14, 3) not null check (remaining_qty >= 0),
  created_at     timestamptz not null default now(),
  constraint lot_remaining_le_received check (remaining_qty <= received_qty)
);
create index inventory_lots_open_idx on public.inventory_lots (hotel_id, expiry_date) where remaining_qty > 0;
create trigger inventory_lots_system_only before insert or update or delete on public.inventory_lots
  for each row execute function app.system_write_only();
alter table public.inventory_lots enable row level security;
create policy inventory_lots_read on public.inventory_lots for select to authenticated using (hotel_id in (select app.permitted_hotels('inventory.view')));

-- كل حركة على صنف يتتبع الصلاحية: الوارد ينشئ دفعة، والصادر يُخصم من الأقرب انتهاءً أولًا
create or replace function app.inventory_lots_apply() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_track  boolean;
  v_expiry date;
  v_left   numeric;
  v_take   numeric;
  r        record;
begin
  select track_expiry into v_track from public.inventory_items where id = new.item_id;
  if not coalesce(v_track, false) then return new; end if;
  if new.quantity > 0 then
    v_expiry := nullif(current_setting('app.lot_expiry', true), '')::date;
    if v_expiry is null and new.txn_type = 'receipt' then
      raise exception 'Enter the expiry date for this item' using errcode = '22023';
    end if;
    insert into public.inventory_lots (hotel_id, item_id, receipt_txn_id, received_on, expiry_date, received_qty, remaining_qty)
    values (new.hotel_id, new.item_id, new.id, new.txn_date, v_expiry, new.quantity, new.quantity);
  else
    v_left := -new.quantity;
    for r in select id, remaining_qty from public.inventory_lots
              where item_id = new.item_id and remaining_qty > 0
              order by expiry_date nulls last, received_on, created_at for update loop
      exit when v_left <= 0;
      v_take := least(v_left, r.remaining_qty);
      update public.inventory_lots set remaining_qty = remaining_qty - v_take where id = r.id;
      v_left := v_left - v_take;
    end loop;
  end if;
  return new;
end; $$;
create trigger inventory_transactions_lots after insert on public.inventory_transactions
  for each row execute function app.inventory_lots_apply();

-- حركة مخزون مع تاريخ الصلاحية للوارد (يمرّر التاريخ للمشغّل ثم يستدعي الحركة الموحّدة)
create or replace function public.post_inventory_movement_ex(
  p_item_id uuid, p_type public.inventory_txn_type, p_quantity numeric, p_date date default null,
  p_unit_cost numeric default null, p_department_id uuid default null, p_vendor_bill_id uuid default null,
  p_description text default null, p_expiry_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform set_config('app.lot_expiry', coalesce(p_expiry_date::text, ''), true);
  v_id := public.post_inventory_movement(p_item_id, p_type, p_quantity, p_date, p_unit_cost, p_department_id, p_vendor_bill_id, p_description);
  perform set_config('app.lot_expiry', '', true);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) الجرد الفعلي
-- -----------------------------------------------------------------------------
create table public.inventory_counts (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hotels(id) on delete cascade,
  count_number      text not null,
  count_date        date not null,
  note              text,
  items_counted     integer not null,
  items_changed     integer not null,
  value_difference  numeric(19, 4) not null,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  unique (hotel_id, count_number),
  unique (hotel_id, id)
);
create table public.inventory_count_lines (
  count_id          uuid not null references public.inventory_counts(id) on delete cascade,
  hotel_id          uuid not null,
  item_id           uuid not null references public.inventory_items(id),
  system_qty        numeric(14, 3) not null,
  counted_qty       numeric(14, 3) not null check (counted_qty >= 0),
  difference        numeric(14, 3) not null,
  value_difference  numeric(19, 4) not null,
  transaction_id    uuid references public.inventory_transactions(id),
  primary key (count_id, item_id)
);
create trigger inventory_counts_system_only before insert or update or delete on public.inventory_counts
  for each row execute function app.system_write_only();
create trigger inventory_count_lines_system_only before insert or update or delete on public.inventory_count_lines
  for each row execute function app.system_write_only();
alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;
create policy inventory_counts_read on public.inventory_counts for select to authenticated using (hotel_id in (select app.permitted_hotels('inventory.view')));
create policy inventory_count_lines_read on public.inventory_count_lines for select to authenticated using (hotel_id in (select app.permitted_hotels('inventory.view')));
create trigger audit_inventory_counts after insert on public.inventory_counts for each row execute function app.audit_trigger();

-- p_lines: [{item_id, counted}] ؛ كل فرق يُرحَّل تسوية مخزون بمتوسط التكلفة
create or replace function public.post_stock_count(p_hotel_id uuid, p_lines jsonb, p_date date default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date    date;
  v_id      uuid;
  v_no      text;
  v_line    jsonb;
  v_item    public.inventory_items%rowtype;
  v_counted numeric;
  v_diff    numeric;
  v_txn     uuid;
  v_value   numeric;
  v_total   numeric := 0;
  v_n       integer := 0;
  v_changed integer := 0;
begin
  perform app.require_permission(p_hotel_id, 'inventory.manage');
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Enter the counted quantity for at least one item' using errcode = '22023';
  end if;
  v_date := coalesce(p_date, app.today_for_hotel(p_hotel_id));
  v_no := app.next_document_number(p_hotel_id, 'stock_count', 'SC', v_date);
  perform set_config('app.system_posting', 'on', true);
  insert into public.inventory_counts (hotel_id, count_number, count_date, note, items_counted, items_changed, value_difference, created_by)
  values (p_hotel_id, v_no, v_date, nullif(trim(coalesce(p_note, '')), ''), 0, 0, 0, auth.uid())
  returning id into v_id;
  perform set_config('app.lot_expiry', '', true);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.inventory_items
     where id = (v_line ->> 'item_id')::uuid and hotel_id = p_hotel_id for update;
    if not found then
      raise exception 'Item not found' using errcode = 'P0002';
    end if;
    v_counted := (v_line ->> 'counted')::numeric;
    if v_counted is null or v_counted < 0 then
      raise exception 'Counted quantity for % must be zero or more', v_item.sku using errcode = '22023';
    end if;
    v_diff := v_counted - v_item.quantity_on_hand;
    v_txn := null; v_value := 0;
    if v_diff <> 0 then
      v_txn := public.post_inventory_movement(v_item.id, 'adjustment', v_diff, v_date, null, null, null, 'جرد ' || v_no);
      select case when quantity > 0 then total_cost else -total_cost end into v_value from public.inventory_transactions where id = v_txn;
      v_changed := v_changed + 1;
    end if;
    perform set_config('app.system_posting', 'on', true);
    insert into public.inventory_count_lines (count_id, hotel_id, item_id, system_qty, counted_qty, difference, value_difference, transaction_id)
    values (v_id, p_hotel_id, v_item.id, v_item.quantity_on_hand, v_counted, v_diff, v_value, v_txn);
    v_total := v_total + v_value;
    v_n := v_n + 1;
  end loop;

  perform set_config('app.system_posting', 'on', true);
  update public.inventory_counts set items_counted = v_n, items_changed = v_changed, value_difference = v_total where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.next_item_barcode(uuid)',
    'public.bulk_change_prices(uuid, numeric, uuid, numeric)',
    'public.post_inventory_movement_ex(uuid, public.inventory_txn_type, numeric, date, numeric, uuid, uuid, text, date)',
    'public.post_stock_count(uuid, jsonb, date, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

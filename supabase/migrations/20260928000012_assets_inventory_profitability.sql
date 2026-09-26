-- =============================================================================
-- المرحلة 4: الأصول الثابتة والإهلاك، المخزون وتكلفة المبيعات، ربحية مراكز التكلفة
-- =============================================================================

insert into public.permissions (code, module, action, name_ar, name_en, sort_order) values
  ('assets.view',          'assets',    'view',    'عرض الأصول الثابتة',        'View fixed assets',        1000),
  ('assets.manage',        'assets',    'manage',  'إدارة الأصول والإهلاك',     'Manage assets & depreciation', 1010),
  ('inventory.view',       'inventory', 'view',    'عرض المخزون',               'View inventory',           1100),
  ('inventory.manage',     'inventory', 'manage',  'حركات المخزون',             'Inventory movements',      1110),
  ('reports.profitability.view', 'reports', 'view', 'ربحية الأقسام',            'Department profitability', 320);

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and (
  (r.code in ('general_manager', 'accountant') and p.code in ('assets.view','assets.manage','inventory.view','inventory.manage','reports.profitability.view'))
  or (r.code = 'auditor' and p.code in ('assets.view','inventory.view','reports.profitability.view'))
  or (r.code = 'department_manager' and p.code in ('inventory.view','reports.profitability.view'))
) on conflict do nothing;

-- -----------------------------------------------------------------------------
-- حسابات إضافية في الدليل: أرباح/خسائر بيع الأصول، فروقات جرد المخزون
-- -----------------------------------------------------------------------------
create or replace function app.seed_phase4_accounts(p_hotel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chart_of_accounts (hotel_id, code, name_ar, name_en, account_type, account_subtype, is_postable, system_key, parent_id)
  select p_hotel_id, a.code, a.name_ar, a.name_en, a.t::public.account_type, a.st::public.account_subtype, true, a.k,
         (select id from public.chart_of_accounts where hotel_id = p_hotel_id and code = a.parent)
  from (values
    ('4203', '42', 'أرباح بيع أصول',        'Gain on asset disposal',   'revenue', 'other_revenue', 'asset_disposal_gain'),
    ('5402', '54', 'خسائر بيع/استبعاد أصول', 'Loss on asset disposal',   'expense', 'other_expense', 'asset_disposal_loss'),
    ('5104', '51', 'فروقات جرد المخزون',    'Inventory adjustments',    'expense', 'cost_of_sales', 'inventory_adjustment')
  ) as a(code, parent, name_ar, name_en, t, st, k)
  where exists (select 1 from public.chart_of_accounts where hotel_id = p_hotel_id and code = a.parent)
  on conflict (hotel_id, code) do nothing;
end;
$$;

do $$
declare h uuid;
begin
  for h in select distinct hotel_id from public.chart_of_accounts where system_key = 'guest_ledger' loop
    perform app.seed_phase4_accounts(h);
  end loop;
end $$;

-- الفنادق الجديدة: بعد إنشاء آخر حساب في الدليل الافتراضي (5401) تُضاف حسابات المرحلة 4
create or replace function app.trg_seed_phase4()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.code = '5401' then perform app.seed_phase4_accounts(new.hotel_id); end if;
  return null;
end;
$$;
create trigger coa_seed_phase4 after insert on public.chart_of_accounts
  for each row execute function app.trg_seed_phase4();

-- =============================================================================
-- الأصول الثابتة
-- =============================================================================
create type public.asset_status as enum ('active', 'fully_depreciated', 'disposed');

create table public.fixed_assets (
  id                        uuid primary key default gen_random_uuid(),
  hotel_id                  uuid not null references public.hotels(id),
  asset_number              text not null,
  name                      text not null,
  category                  text not null,
  asset_account_id          uuid not null,
  department_id             uuid,
  acquisition_date          date not null,
  cost                      numeric(19, 4) not null check (cost > 0),
  salvage_value             numeric(19, 4) not null default 0 check (salvage_value >= 0),
  useful_life_months        integer not null check (useful_life_months > 0),
  -- الإهلاك يبدأ من الشهر التالي للشراء (سياسة ثابتة وموثقة)
  depreciation_start        date not null,
  accumulated_depreciation  numeric(19, 4) not null default 0,
  status                    public.asset_status not null default 'active',
  -- أصل مسجّل من فاتورة مورد (القيد موجود) أو قيد تسجيل مستقل
  vendor_bill_id            uuid,
  journal_entry_id          uuid references public.journal_entries(id),
  disposal_date             date,
  disposal_proceeds         numeric(19, 4),
  disposal_journal_entry_id uuid references public.journal_entries(id),
  notes                     text,
  created_at                timestamptz not null default now(),
  created_by                uuid references auth.users(id),
  unique (hotel_id, asset_number),
  unique (hotel_id, id),
  foreign key (hotel_id, asset_account_id) references public.chart_of_accounts (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  foreign key (hotel_id, vendor_bill_id) references public.vendor_bills (hotel_id, id),
  constraint asset_salvage check (salvage_value < cost),
  constraint asset_accum check (accumulated_depreciation >= 0 and accumulated_depreciation <= cost - salvage_value)
);

create table public.depreciation_schedule (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null,
  asset_id          uuid not null,
  period_month      date not null,
  amount            numeric(19, 4) not null check (amount > 0),
  journal_entry_id  uuid references public.journal_entries(id),
  created_at        timestamptz not null default now(),
  unique (asset_id, period_month),
  foreign key (hotel_id, asset_id) references public.fixed_assets (hotel_id, id)
);

create trigger fixed_assets_system_only before insert or update or delete on public.fixed_assets
  for each row execute function app.system_write_only();
create trigger depreciation_schedule_system_only before insert or update or delete on public.depreciation_schedule
  for each row execute function app.system_write_only();

-- -----------------------------------------------------------------------------
-- الإهلاك الشهري بالقسط الثابت: (التكلفة − الخردة) / العمر بالأشهر، مقرّب،
-- والشهر الأخير يأخذ المتبقي بالضبط حتى يصل مجمع الإهلاك إلى (التكلفة − الخردة)
-- ⚠ مطابق لـ src/lib/accounting/depreciation.ts
-- -----------------------------------------------------------------------------
create or replace function app.monthly_depreciation(p_asset public.fixed_assets, p_months_done integer, p_decimals integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_months_done + 1 >= p_asset.useful_life_months
      then p_asset.cost - p_asset.salvage_value - p_asset.accumulated_depreciation
    else least(round((p_asset.cost - p_asset.salvage_value) / p_asset.useful_life_months, p_decimals),
               p_asset.cost - p_asset.salvage_value - p_asset.accumulated_depreciation)
  end;
$$;

-- تسجيل أصل. p_funding: 'bill' (من فاتورة مورد سبق ترحيلها على حساب الأصل — لا قيد جديد)
-- أو حساب مقابل (بنك/رأس مال...) لقيد تسجيل: مدين الأصل / دائن الحساب المقابل
create or replace function public.register_fixed_asset(
  p_hotel_id uuid, p_name text, p_category text, p_asset_account_id uuid, p_cost numeric,
  p_useful_life_months integer, p_acquisition_date date, p_salvage_value numeric default 0,
  p_department_id uuid default null, p_vendor_bill_id uuid default null, p_counter_account_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_key text;
  v_je uuid;
begin
  perform app.require_permission(p_hotel_id, 'assets.manage');
  perform app.assert_account(p_hotel_id, p_asset_account_id, array['asset']::public.account_type[]);
  if (select account_subtype from public.chart_of_accounts where id = p_asset_account_id) <> 'fixed_asset' then
    raise exception 'Asset account must be a fixed-asset account' using errcode = '23514';
  end if;
  select system_key into v_key from public.chart_of_accounts where id = p_asset_account_id;
  if v_key = 'accumulated_depreciation' then
    raise exception 'Choose the asset cost account, not accumulated depreciation' using errcode = '23514';
  end if;
  if (p_vendor_bill_id is null) = (p_counter_account_id is null) then
    raise exception 'Specify either the vendor bill or the counter account' using errcode = '22023';
  end if;
  if p_vendor_bill_id is not null and not exists (
    select 1 from public.vendor_bill_lines where bill_id = p_vendor_bill_id and hotel_id = p_hotel_id and account_id = p_asset_account_id
  ) then
    raise exception 'The vendor bill has no line on this asset account' using errcode = '23514';
  end if;
  if p_counter_account_id is not null then
    perform app.assert_account(p_hotel_id, p_counter_account_id, array['asset', 'liability', 'equity']::public.account_type[]);
    select system_key into v_key from public.chart_of_accounts where id = p_counter_account_id;
    if v_key in ('guest_ledger', 'ar_control', 'guest_deposits', 'ap_control') then
      raise exception 'Control account % cannot be used directly', v_key using errcode = '23514';
    end if;
  end if;

  perform set_config('app.system_posting', 'on', true);
  insert into public.fixed_assets (hotel_id, asset_number, name, category, asset_account_id, department_id, acquisition_date,
    cost, salvage_value, useful_life_months, depreciation_start, vendor_bill_id, notes, created_by)
  values (p_hotel_id, app.next_document_number(p_hotel_id, 'fixed_asset', 'FA', p_acquisition_date), trim(p_name), trim(p_category),
    p_asset_account_id, p_department_id, p_acquisition_date, p_cost, coalesce(p_salvage_value, 0), p_useful_life_months,
    (date_trunc('month', p_acquisition_date) + interval '1 month')::date, p_vendor_bill_id, nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;

  if p_counter_account_id is not null then
    v_je := app.post_system_entry(p_hotel_id, p_acquisition_date, 'تسجيل أصل / Asset acquisition — ' || trim(p_name),
      'depreciation', v_id, null, jsonb_build_array(
        jsonb_build_object('account_id', p_asset_account_id, 'department_id', p_department_id, 'debit', p_cost),
        jsonb_build_object('account_id', p_counter_account_id, 'credit', p_cost)));
    update public.fixed_assets set journal_entry_id = v_je where id = v_id;
  end if;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- تشغيل إهلاك شهر لكل الأصول الفعّالة (قيد واحد، سطر لكل قسم). يرفض تكرار نفس الشهر.
create or replace function public.run_depreciation(p_hotel_id uuid, p_month date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_dec   smallint := app.currency_decimals(p_hotel_id);
  a       public.fixed_assets%rowtype;
  v_amt   numeric;
  n       integer := 0;
  v_je    uuid;
  v_lines jsonb;
begin
  perform app.require_permission(p_hotel_id, 'assets.manage');
  perform set_config('app.system_posting', 'on', true);

  for a in select * from public.fixed_assets
           where hotel_id = p_hotel_id and status = 'active' and depreciation_start <= v_month
             and not exists (select 1 from public.depreciation_schedule d where d.asset_id = fixed_assets.id and d.period_month = v_month)
           for update loop
    v_amt := app.monthly_depreciation(a, (select count(*)::integer from public.depreciation_schedule where asset_id = a.id), v_dec);
    continue when v_amt <= 0;
    insert into public.depreciation_schedule (hotel_id, asset_id, period_month, amount) values (p_hotel_id, a.id, v_month, v_amt);
    update public.fixed_assets
       set accumulated_depreciation = accumulated_depreciation + v_amt,
           status = case when accumulated_depreciation + v_amt >= cost - salvage_value then 'fully_depreciated' else 'active' end::public.asset_status
     where id = a.id;
    n := n + 1;
  end loop;

  if n = 0 then
    perform set_config('app.system_posting', 'off', true);
    return 0;
  end if;

  select jsonb_agg(x) into v_lines from (
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'depreciation_expense'),
                              'department_id', f.department_id, 'debit', sum(d.amount)) as x
    from public.depreciation_schedule d join public.fixed_assets f on f.id = d.asset_id
    where d.hotel_id = p_hotel_id and d.period_month = v_month and d.journal_entry_id is null
    group by f.department_id
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'accumulated_depreciation'), 'credit', sum(d.amount))
    from public.depreciation_schedule d
    where d.hotel_id = p_hotel_id and d.period_month = v_month and d.journal_entry_id is null
  ) s;

  v_je := app.post_system_entry(p_hotel_id, v_end, 'إهلاك / Depreciation ' || to_char(v_month, 'YYYY-MM'),
                                'depreciation', null, to_char(v_month, 'YYYY-MM'), v_lines);
  update public.depreciation_schedule set journal_entry_id = v_je
   where hotel_id = p_hotel_id and period_month = v_month and journal_entry_id is null;
  perform set_config('app.system_posting', 'off', true);
  return n;
end;
$$;

-- استبعاد/بيع أصل: مدين مجمع الإهلاك + المتحصلات (إن وجدت) ± ربح/خسارة / دائن تكلفة الأصل
create or replace function public.dispose_fixed_asset(
  p_asset_id uuid, p_disposal_date date, p_proceeds numeric default 0, p_proceeds_account_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a       public.fixed_assets%rowtype;
  v_nbv   numeric;
  v_gain  numeric;
  v_je    uuid;
begin
  select * into a from public.fixed_assets where id = p_asset_id for update;
  if not found then raise exception 'Asset not found' using errcode = 'P0002'; end if;
  perform app.require_permission(a.hotel_id, 'assets.manage');
  if a.status = 'disposed' then raise exception 'Asset already disposed' using errcode = '23514'; end if;
  if coalesce(p_proceeds, 0) < 0 then raise exception 'Proceeds must not be negative' using errcode = '22023'; end if;
  if coalesce(p_proceeds, 0) > 0 then
    if p_proceeds_account_id is null then raise exception 'Proceeds account is required' using errcode = '22023'; end if;
    perform app.assert_account(a.hotel_id, p_proceeds_account_id, array['asset']::public.account_type[]);
  end if;
  if exists (select 1 from public.depreciation_schedule where asset_id = a.id and period_month > p_disposal_date) then
    raise exception 'Depreciation was posted after the disposal date' using errcode = '23514';
  end if;

  v_nbv := a.cost - a.accumulated_depreciation;
  v_gain := coalesce(p_proceeds, 0) - v_nbv;

  v_je := app.post_system_entry(a.hotel_id, p_disposal_date, 'استبعاد أصل / Asset disposal — ' || a.name,
    'depreciation', a.id, a.asset_number, jsonb_build_array(
      jsonb_build_object('account_id', app.account_by_key(a.hotel_id, 'accumulated_depreciation'), 'debit', a.accumulated_depreciation),
      jsonb_build_object('account_id', p_proceeds_account_id, 'debit', coalesce(p_proceeds, 0)),
      jsonb_build_object('account_id', app.account_by_key(a.hotel_id, 'asset_disposal_loss'), 'department_id', a.department_id, 'debit', greatest(-v_gain, 0)),
      jsonb_build_object('account_id', app.account_by_key(a.hotel_id, 'asset_disposal_gain'), 'department_id', a.department_id, 'credit', greatest(v_gain, 0)),
      jsonb_build_object('account_id', a.asset_account_id, 'department_id', a.department_id, 'credit', a.cost)));

  perform set_config('app.system_posting', 'on', true);
  update public.fixed_assets
     set status = 'disposed', disposal_date = p_disposal_date, disposal_proceeds = coalesce(p_proceeds, 0), disposal_journal_entry_id = v_je
   where id = a.id;
  perform set_config('app.system_posting', 'off', true);
  return v_je;
end;
$$;

-- =============================================================================
-- المخزون (متوسط التكلفة المرجّح)
-- =============================================================================
create type public.inventory_txn_type as enum ('receipt', 'issue', 'adjustment');

create table public.inventory_items (
  id                    uuid primary key default gen_random_uuid(),
  hotel_id              uuid not null references public.hotels(id),
  sku                   text not null check (sku ~ '^[A-Z0-9_.-]{1,30}$'),
  name_ar               text not null,
  name_en               text,
  unit                  text not null default 'unit',
  inventory_account_id  uuid not null,
  -- حساب الاستهلاك/تكلفة المبيعات عند الصرف
  expense_account_id    uuid not null,
  reorder_level         numeric(14, 3) not null default 0 check (reorder_level >= 0),
  quantity_on_hand      numeric(14, 3) not null default 0,
  average_cost          numeric(19, 6) not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id),
  unique (hotel_id, sku),
  unique (hotel_id, id),
  foreign key (hotel_id, inventory_account_id) references public.chart_of_accounts (hotel_id, id),
  foreign key (hotel_id, expense_account_id) references public.chart_of_accounts (hotel_id, id),
  constraint inv_qty_non_negative check (quantity_on_hand >= 0)
);
create trigger inventory_items_set_created before insert on public.inventory_items for each row execute function app.set_created_by();
create trigger inventory_items_set_updated before update on public.inventory_items for each row execute function app.set_updated_at();

-- الكمية والتكلفة تُحدّث فقط عبر الحركات؛ الحسابات يُتحقق منها
create or replace function app.inventory_items_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform app.assert_account(new.hotel_id, new.inventory_account_id, array['asset']::public.account_type[]);
  perform app.assert_account(new.hotel_id, new.expense_account_id, array['expense']::public.account_type[]);
  if not app.is_system_posting() then
    if tg_op = 'INSERT' then
      new.quantity_on_hand := 0; new.average_cost := 0;
    elsif new.quantity_on_hand <> old.quantity_on_hand or new.average_cost <> old.average_cost then
      raise exception 'Stock quantity and cost change only through inventory movements' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger inventory_items_guard before insert or update on public.inventory_items
  for each row execute function app.inventory_items_guard();

create table public.inventory_transactions (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null,
  item_id           uuid not null,
  txn_type          public.inventory_txn_type not null,
  txn_date          date not null,
  -- موجبة للوارد، سالبة للصادر
  quantity          numeric(14, 3) not null check (quantity <> 0),
  unit_cost         numeric(19, 6) not null check (unit_cost >= 0),
  total_cost        numeric(19, 4) not null,
  department_id     uuid,
  vendor_bill_id    uuid,
  description       text,
  journal_entry_id  uuid references public.journal_entries(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  foreign key (hotel_id, item_id) references public.inventory_items (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  foreign key (hotel_id, vendor_bill_id) references public.vendor_bills (hotel_id, id)
);
create index inventory_transactions_item_idx on public.inventory_transactions (item_id, txn_date);
create trigger inventory_transactions_system_only before insert or update or delete on public.inventory_transactions
  for each row execute function app.system_write_only();

-- حركة مخزون موحّدة:
--  receipt    : وارد بتكلفة. من فاتورة مورد (سبق قيدها على حساب المخزون) ⇒ بلا قيد؛
--               بدونها (رصيد افتتاحي/تحويل) ⇒ مدين المخزون / دائن فروقات الجرد (يتطلب صلاحية)
--  issue      : صرف للقسم بمتوسط التكلفة ⇒ مدين حساب الاستهلاك/COGS (بالقسم) / دائن المخزون
--  adjustment : جرد (± كمية) بمتوسط التكلفة ⇒ مقابل حساب فروقات الجرد
create or replace function public.post_inventory_movement(
  p_item_id uuid, p_type public.inventory_txn_type, p_quantity numeric, p_date date default null,
  p_unit_cost numeric default null, p_department_id uuid default null, p_vendor_bill_id uuid default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  it      public.inventory_items%rowtype;
  v_date  date;
  v_qty   numeric;
  v_cost  numeric;
  v_total numeric;
  v_new_q numeric;
  v_id    uuid;
  v_je    uuid;
  v_dec   smallint;
  v_desc  text;
begin
  select * into it from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Item not found' using errcode = 'P0002'; end if;
  perform app.require_permission(it.hotel_id, 'inventory.manage');
  if p_quantity is null or p_quantity = 0 then raise exception 'Quantity must not be zero' using errcode = '22023'; end if;
  v_date := coalesce(p_date, app.today_for_hotel(it.hotel_id));
  v_dec := app.currency_decimals(it.hotel_id);

  if p_type = 'receipt' then
    if p_quantity <= 0 or p_unit_cost is null or p_unit_cost < 0 then
      raise exception 'Receipts need a positive quantity and a unit cost' using errcode = '22023';
    end if;
    if p_vendor_bill_id is not null and not exists (
      select 1 from public.vendor_bill_lines where bill_id = p_vendor_bill_id and account_id = it.inventory_account_id
    ) then
      raise exception 'The vendor bill has no line on this item''s inventory account' using errcode = '23514';
    end if;
    v_qty := p_quantity; v_cost := p_unit_cost;
  elsif p_type = 'issue' then
    if p_quantity <= 0 then raise exception 'Issue quantity must be positive' using errcode = '22023'; end if;
    if p_department_id is null then raise exception 'Department is required for issues' using errcode = '22023'; end if;
    v_qty := -p_quantity; v_cost := it.average_cost;
  else
    v_qty := p_quantity; v_cost := coalesce(p_unit_cost, it.average_cost);
  end if;

  v_new_q := it.quantity_on_hand + v_qty;
  if v_new_q < 0 then
    raise exception 'Insufficient stock for % (on hand %)', it.sku, it.quantity_on_hand using errcode = '23514';
  end if;
  v_total := round(abs(v_qty) * v_cost, v_dec);
  v_desc := coalesce(nullif(trim(p_description), ''), it.name_ar);

  perform set_config('app.system_posting', 'on', true);
  insert into public.inventory_transactions (hotel_id, item_id, txn_type, txn_date, quantity, unit_cost, total_cost,
    department_id, vendor_bill_id, description, created_by)
  values (it.hotel_id, it.id, p_type, v_date, v_qty, v_cost, v_total, p_department_id, p_vendor_bill_id, v_desc, auth.uid())
  returning id into v_id;

  -- المتوسط المرجّح يتغير مع الوارد فقط
  update public.inventory_items
     set quantity_on_hand = v_new_q,
         average_cost = case when v_qty > 0 and v_new_q > 0
                             then (it.quantity_on_hand * it.average_cost + v_qty * v_cost) / v_new_q
                             else average_cost end
   where id = it.id;

  if v_total > 0 and not (p_type = 'receipt' and p_vendor_bill_id is not null) then
    v_je := app.post_system_entry(it.hotel_id, v_date, 'مخزون / Inventory — ' || v_desc, 'inventory', v_id, it.sku,
      case
        when p_type = 'issue' then jsonb_build_array(
          jsonb_build_object('account_id', it.expense_account_id, 'department_id', p_department_id, 'debit', v_total),
          jsonb_build_object('account_id', it.inventory_account_id, 'credit', v_total))
        when v_qty > 0 then jsonb_build_array(
          jsonb_build_object('account_id', it.inventory_account_id, 'debit', v_total),
          jsonb_build_object('account_id', app.account_by_key(it.hotel_id, 'inventory_adjustment'), 'department_id', p_department_id, 'credit', v_total))
        else jsonb_build_array(
          jsonb_build_object('account_id', app.account_by_key(it.hotel_id, 'inventory_adjustment'), 'department_id', p_department_id, 'debit', v_total),
          jsonb_build_object('account_id', it.inventory_account_id, 'credit', v_total))
      end);
    perform set_config('app.system_posting', 'on', true);
    update public.inventory_transactions set journal_entry_id = v_je where id = v_id;
  end if;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- =============================================================================
-- ربحية مراكز التكلفة: الإيرادات والتكاليف لكل قسم من القيود المرحّلة
-- =============================================================================
create or replace function public.department_profitability(p_hotel_id uuid, p_from date, p_to date)
returns table (department_id uuid, account_type public.account_type, account_subtype public.account_subtype, amount numeric)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'reports.profitability.view');
  return query
  select l.department_id, a.account_type, a.account_subtype,
         -- الإيرادات بطبيعتها الدائنة (موجب = إيراد)، والمصروفات بطبيعتها المدينة (موجب = تكلفة)
         sum(case when a.account_type = 'revenue' then l.base_credit - l.base_debit else l.base_debit - l.base_credit end)
  from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  join public.chart_of_accounts a on a.id = l.account_id and a.account_type in ('revenue', 'expense')
  where l.hotel_id = p_hotel_id and j.entry_date between p_from and p_to
  group by l.department_id, a.account_type, a.account_subtype;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS والصلاحيات والتدقيق
-- -----------------------------------------------------------------------------
alter table public.fixed_assets           enable row level security;
alter table public.depreciation_schedule  enable row level security;
alter table public.inventory_items        enable row level security;
alter table public.inventory_transactions enable row level security;

create policy fixed_assets_read on public.fixed_assets for select to authenticated using (app.has_permission(hotel_id, 'assets.view'));
create policy depreciation_read on public.depreciation_schedule for select to authenticated using (app.has_permission(hotel_id, 'assets.view'));
create policy inventory_items_read on public.inventory_items for select to authenticated using (app.has_permission(hotel_id, 'inventory.view'));
create policy inventory_items_insert on public.inventory_items for insert to authenticated with check (app.has_permission(hotel_id, 'inventory.manage'));
create policy inventory_items_update on public.inventory_items for update to authenticated
  using (app.has_permission(hotel_id, 'inventory.manage')) with check (app.has_permission(hotel_id, 'inventory.manage'));
create policy inventory_txn_read on public.inventory_transactions for select to authenticated using (app.has_permission(hotel_id, 'inventory.view'));

create trigger audit_fixed_assets after insert or update on public.fixed_assets for each row execute function app.audit_trigger();
create trigger audit_inventory_items after insert or update on public.inventory_items for each row execute function app.audit_trigger();
create trigger audit_inventory_txn after insert on public.inventory_transactions for each row execute function app.audit_trigger();

revoke execute on all functions in schema app from public;
grant execute on function app.is_hotel_member(uuid) to authenticated;
grant execute on function app.has_permission(uuid, text) to authenticated;
grant execute on function app.require_permission(uuid, text) to authenticated;
grant execute on function app.normal_balance_of(public.account_type) to authenticated, service_role;
grant execute on function app.subtype_matches_type(public.account_type, public.account_subtype) to authenticated, service_role;
grant execute on function app.is_system_posting() to authenticated, service_role;
grant execute on function app.assert_account(uuid, uuid, public.account_type[]) to authenticated, service_role;
grant execute on function app.today_for_hotel(uuid) to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.register_fixed_asset(uuid, text, text, uuid, numeric, integer, date, numeric, uuid, uuid, uuid, text)',
    'public.run_depreciation(uuid, date)',
    'public.dispose_fixed_asset(uuid, date, numeric, uuid)',
    'public.post_inventory_movement(uuid, public.inventory_txn_type, numeric, date, numeric, uuid, uuid, text)',
    'public.department_profitability(uuid, date, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

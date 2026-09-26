-- =============================================================================
-- المرحلة 2 / الترحيل 7: الفوليو (كشف حساب النزيل) وحركاته
--
-- مبدأ الاعتراف بالإيراد: كل رسم يُرحّل لدفتر الأستاذ لحظة تسجيله
-- (مدين ذمم النزلاء / دائن الإيراد والضرائب)، وليس عند المغادرة. هكذا يظهر إيراد
-- النزيل المقيم عبر نهاية الشهر في شهره الصحيح (أساس الاستحقاق).
-- عند المغادرة: تُطبّق الودائع، ويُسوّى الرصيد، وتصدر الفاتورة الضريبية.
--
-- ثابت محاسبي مختبَر: رصيد حساب "ذمم النزلاء" في الأستاذ = مجموع أرصدة كل الفوليوهات،
-- ورصيد "ودائع النزلاء" = مجموع ودائع الفوليوهات.
-- =============================================================================

create type public.folio_type as enum ('guest', 'master', 'company', 'non_guest');
create type public.folio_status as enum ('open', 'closed', 'cancelled');
create type public.folio_txn_type as enum (
  'charge', 'allowance', 'payment', 'refund',
  'deposit', 'deposit_application', 'deposit_refund',
  'transfer_in', 'transfer_out'
);

create table public.guest_folios (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid not null references public.hotels(id),
  folio_number     text not null,
  folio_type       public.folio_type not null default 'guest',
  status           public.folio_status not null default 'open',
  guest_name       text not null check (length(trim(guest_name)) > 0),
  -- جهة الفوترة (شركة/وكالة) — مطلوبة للتحويل إلى الآجل
  customer_id      uuid,
  room_number      text,
  reservation_ref  text,
  arrival_date     date,
  departure_date   date,
  adults           smallint check (adults is null or adults > 0),
  -- فوليو رئيسي لمجموعة/شركة (للتجميع؛ التحويل الفعلي عبر حركات transfer)
  master_folio_id  uuid,
  notes            text,
  closed_at        timestamptz,
  closed_by        uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  unique (hotel_id, folio_number),
  unique (hotel_id, id),
  foreign key (hotel_id, customer_id) references public.customers (hotel_id, id),
  foreign key (hotel_id, master_folio_id) references public.guest_folios (hotel_id, id),
  constraint folio_dates check (departure_date is null or arrival_date is null or departure_date >= arrival_date),
  constraint folio_not_own_master check (master_folio_id is distinct from id)
);

create index guest_folios_status_idx on public.guest_folios (hotel_id, status);

create table public.folio_transactions (
  id                      uuid primary key default gen_random_uuid(),
  hotel_id                uuid not null,
  folio_id                uuid not null,
  txn_type                public.folio_txn_type not null,
  -- 1 حركة عادية، −1 حركة إلغاء (void) لحركة سابقة
  direction               smallint not null default 1 check (direction in (1, -1)),
  business_date           date not null,
  charge_code_id          uuid,
  payment_method_id       uuid,
  department_id           uuid,
  customer_id             uuid,
  description             text not null,
  reference               text,
  quantity                numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price              numeric(19, 4),
  net_amount              numeric(19, 4) not null default 0 check (net_amount >= 0),
  tax_amount              numeric(19, 4) not null default 0 check (tax_amount >= 0),
  total_amount            numeric(19, 4) not null check (total_amount > 0),
  -- الأثر على رصيد الفوليو وعلى رصيد الودائع (مطابق لـ src/lib/accounting/folio.ts)
  ledger_effect           numeric(19, 4) generated always as (
    total_amount * direction * case txn_type
      when 'charge' then 1 when 'refund' then 1 when 'transfer_in' then 1
      when 'allowance' then -1 when 'payment' then -1 when 'deposit_application' then -1 when 'transfer_out' then -1
      else 0 end
  ) stored,
  deposit_effect          numeric(19, 4) generated always as (
    total_amount * direction * case txn_type
      when 'deposit' then 1 when 'deposit_application' then -1 when 'deposit_refund' then -1
      else 0 end
  ) stored,
  -- الحركة المرتبطة: البند الأصلي للخصم، أو الحركة الملغاة، أو الطرف الآخر للتحويل
  related_transaction_id  uuid references public.folio_transactions(id),
  counter_folio_id        uuid,
  voided_by_id            uuid unique references public.folio_transactions(id),
  journal_entry_id        uuid references public.journal_entries(id),
  created_at              timestamptz not null default now(),
  created_by              uuid references auth.users(id),
  unique (hotel_id, id),
  foreign key (hotel_id, folio_id) references public.guest_folios (hotel_id, id),
  foreign key (hotel_id, charge_code_id) references public.charge_codes (hotel_id, id),
  foreign key (hotel_id, payment_method_id) references public.payment_methods (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  foreign key (hotel_id, customer_id) references public.customers (hotel_id, id),
  foreign key (hotel_id, counter_folio_id) references public.guest_folios (hotel_id, id),
  constraint ftx_amounts check (net_amount + tax_amount = total_amount or txn_type not in ('charge', 'allowance')),
  constraint ftx_charge_fields check (txn_type not in ('charge', 'allowance') or charge_code_id is not null),
  constraint ftx_payment_fields check (
    txn_type not in ('payment', 'refund', 'deposit', 'deposit_refund') or payment_method_id is not null
  )
);

create index folio_transactions_folio_idx on public.folio_transactions (folio_id, created_at);
create index folio_transactions_date_idx on public.folio_transactions (hotel_id, business_date);

-- تفصيل الضرائب لكل حركة (أساس الفاتورة الضريبية وتقارير الضرائب)
create table public.folio_transaction_taxes (
  transaction_id  uuid not null references public.folio_transactions(id),
  hotel_id        uuid not null,
  tax_rate_id     uuid not null,
  taxable_base    numeric(19, 4) not null,
  amount          numeric(19, 4) not null,
  primary key (transaction_id, tax_rate_id),
  foreign key (hotel_id, tax_rate_id) references public.tax_rates (hotel_id, id)
);

-- -----------------------------------------------------------------------------
-- حماية: الحركات للإضافة فقط. التعديل الوحيد المسموح هو ربط الحركة بإلغائها (نظاميًا).
-- -----------------------------------------------------------------------------
create or replace function app.folio_transactions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- الأعمدة المولّدة تكون فارغة في NEW داخل تريغر BEFORE، فنستبعدها من المقارنة
  v_new jsonb := to_jsonb(new) - 'ledger_effect' - 'deposit_effect';
  v_old jsonb := to_jsonb(old) - 'ledger_effect' - 'deposit_effect';
begin
  if tg_op = 'DELETE' then
    raise exception 'Folio transactions cannot be deleted; void them instead' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and app.is_system_posting() then
    -- ربط الحركة بقيدها (مرة واحدة)
    if old.journal_entry_id is null and new.journal_entry_id is not null
       and (v_new - 'journal_entry_id') = (v_old - 'journal_entry_id') then
      return new;
    end if;
    -- ربط الحركة بحركة إلغائها (مرة واحدة)
    if old.voided_by_id is null and new.voided_by_id is not null
       and (v_new - 'voided_by_id') = (v_old - 'voided_by_id') then
      return new;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Folio transactions are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger folio_transactions_guard before update or delete on public.folio_transactions
  for each row execute function app.folio_transactions_guard();

create or replace function app.folio_transaction_taxes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Folio transaction taxes are immutable' using errcode = '42501';
end;
$$;

create trigger folio_transaction_taxes_guard before update or delete on public.folio_transaction_taxes
  for each row execute function app.folio_transaction_taxes_guard();

-- رأس الفوليو: الرقم والحالة والفندق تُدار نظاميًا فقط
create or replace function app.guest_folios_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not app.is_system_posting() then
      raise exception 'Folios are opened through open_folio()' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Folios cannot be deleted; cancel an empty folio instead' using errcode = '42501';
  end if;
  if not app.is_system_posting() and (
       new.status is distinct from old.status or new.folio_number is distinct from old.folio_number
       or new.hotel_id is distinct from old.hotel_id or new.closed_at is distinct from old.closed_at
       or new.created_by is distinct from old.created_by) then
    raise exception 'Folio status and numbering are managed by the system' using errcode = '42501';
  end if;
  if not app.is_system_posting() and old.status <> 'open' then
    raise exception 'Closed folios cannot be modified' using errcode = '42501';
  end if;
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger guest_folios_guard before insert or update or delete on public.guest_folios
  for each row execute function app.guest_folios_guard();

-- -----------------------------------------------------------------------------
-- عرض أرصدة الفوليو (security_invoker ⇒ يخضع لـ RLS)
-- -----------------------------------------------------------------------------
create view public.folio_balances
with (security_invoker = true) as
select f.id as folio_id,
       f.hotel_id,
       coalesce(sum(t.ledger_effect), 0) as balance,
       coalesce(sum(t.deposit_effect), 0) as deposit_balance,
       coalesce(sum(t.ledger_effect) filter (where t.txn_type in ('charge', 'allowance')), 0) as net_charges,
       count(t.id)::integer as transaction_count
from public.guest_folios f
left join public.folio_transactions t on t.folio_id = f.id
group by f.id, f.hotel_id;

-- =============================================================================
-- دوال مساعدة داخلية
-- =============================================================================
create or replace function app.today_for_hotel(p_hotel_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone h.timezone)::date from public.hotels h where h.id = p_hotel_id;
$$;

-- قفل الفوليو والتحقق من الصلاحية وحالته (SECURITY DEFINER يتجاوز RLS، لذا الفحص هنا إلزامي)
create or replace function app.lock_open_folio(p_folio_id uuid, p_permission text)
returns public.guest_folios
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.guest_folios%rowtype;
begin
  select * into v from public.guest_folios where id = p_folio_id for update;
  if not found then
    raise exception 'Folio not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v.hotel_id, p_permission);
  if v.status <> 'open' then
    raise exception 'Folio % is not open', v.folio_number using errcode = '23514';
  end if;
  return v;
end;
$$;

create or replace function app.folio_current_balances(p_folio_id uuid, out balance numeric, out deposits numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(ledger_effect), 0), coalesce(sum(deposit_effect), 0)
  from public.folio_transactions where folio_id = p_folio_id;
$$;

create or replace function app.active_payment_method(p_hotel_id uuid, p_method_id uuid)
returns public.payment_methods
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.payment_methods%rowtype;
begin
  select * into v from public.payment_methods where id = p_method_id and hotel_id = p_hotel_id and is_active;
  if not found then
    raise exception 'Payment method not found or inactive' using errcode = '23503';
  end if;
  return v;
end;
$$;

-- الرصيد الآجل القائم لعميل = فواتير غير مسددة − سندات قبض غير مخصصة (يُعرّف فعليًا في الترحيل 8)
create or replace function app.customer_outstanding(p_customer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select 0::numeric;
$$;

-- إدراج حركة (للاستخدام الداخلي فقط) — يعيد المعرف
create or replace function app.insert_folio_txn(p_txn public.folio_transactions)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.folio_transactions (
    hotel_id, folio_id, txn_type, direction, business_date, charge_code_id, payment_method_id,
    department_id, customer_id, description, reference, quantity, unit_price, net_amount, tax_amount,
    total_amount, related_transaction_id, counter_folio_id, created_by
  ) values (
    p_txn.hotel_id, p_txn.folio_id, p_txn.txn_type, coalesce(p_txn.direction, 1), p_txn.business_date,
    p_txn.charge_code_id, p_txn.payment_method_id, p_txn.department_id, p_txn.customer_id,
    p_txn.description, p_txn.reference, coalesce(p_txn.quantity, 1), p_txn.unit_price,
    coalesce(p_txn.net_amount, 0), coalesce(p_txn.tax_amount, 0), p_txn.total_amount,
    p_txn.related_transaction_id, p_txn.counter_folio_id, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

-- ترحيل قيد حركة الفوليو وربطه بها
create or replace function app.post_folio_txn_entry(p_txn_id uuid, p_folio public.guest_folios, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn public.folio_transactions%rowtype;
  v_je  uuid;
begin
  select * into v_txn from public.folio_transactions where id = p_txn_id;
  v_je := app.post_system_entry(
    v_txn.hotel_id, v_txn.business_date,
    v_txn.description || ' — ' || p_folio.folio_number || ' (' || p_folio.guest_name || ')',
    'folio', v_txn.id, p_folio.folio_number, p_lines
  );
  perform set_config('app.system_posting', 'on', true);
  update public.folio_transactions set journal_entry_id = v_je where id = p_txn_id;
  perform set_config('app.system_posting', 'off', true);
  return v_je;
end;
$$;

-- =============================================================================
-- واجهات RPC للفوليو
-- =============================================================================

create or replace function public.open_folio(
  p_hotel_id        uuid,
  p_guest_name      text,
  p_folio_type      public.folio_type default 'guest',
  p_customer_id     uuid default null,
  p_room_number     text default null,
  p_reservation_ref text default null,
  p_arrival_date    date default null,
  p_departure_date  date default null,
  p_adults          smallint default null,
  p_master_folio_id uuid default null,
  p_notes           text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_date date;
begin
  perform app.require_permission(p_hotel_id, 'folio.manage');
  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id and hotel_id = p_hotel_id and is_active
  ) then
    raise exception 'Customer not found or inactive' using errcode = '23503';
  end if;
  if p_master_folio_id is not null and not exists (
    select 1 from public.guest_folios where id = p_master_folio_id and hotel_id = p_hotel_id and status = 'open'
  ) then
    raise exception 'Master folio not found or not open' using errcode = '23503';
  end if;

  v_date := coalesce(p_arrival_date, app.today_for_hotel(p_hotel_id));
  perform set_config('app.system_posting', 'on', true);
  insert into public.guest_folios (
    hotel_id, folio_number, folio_type, guest_name, customer_id, room_number, reservation_ref,
    arrival_date, departure_date, adults, master_folio_id, notes, created_by
  ) values (
    p_hotel_id, app.next_document_number(p_hotel_id, 'folio', 'F', v_date), p_folio_type, trim(p_guest_name),
    p_customer_id, nullif(trim(p_room_number), ''), nullif(trim(p_reservation_ref), ''),
    p_arrival_date, p_departure_date, p_adults, p_master_folio_id, nullif(trim(p_notes), ''), auth.uid()
  ) returning id into v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- تسجيل رسم (غرفة، مطعم، ميني بار، سبا...) مع حساب الضرائب وترحيل القيد فورًا
create or replace function public.post_folio_charge(
  p_folio_id       uuid,
  p_charge_code_id uuid,
  p_unit_price     numeric,
  p_quantity       numeric default 1,
  p_business_date  date default null,
  p_description    text default null,
  p_reference      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folio public.guest_folios%rowtype;
  v_cc    public.charge_codes%rowtype;
  v_tax   jsonb;
  v_txn   public.folio_transactions%rowtype;
  v_id    uuid;
  v_lines jsonb;
  v_t     jsonb;
begin
  v_folio := app.lock_open_folio(p_folio_id, 'folio.manage');
  select * into v_cc from public.charge_codes where id = p_charge_code_id and hotel_id = v_folio.hotel_id and is_active;
  if not found then
    raise exception 'Charge code not found or inactive' using errcode = '23503';
  end if;
  if p_unit_price is null or p_unit_price <= 0 or coalesce(p_quantity, 0) <= 0 then
    raise exception 'Price and quantity must be greater than zero' using errcode = '22023';
  end if;

  v_tax := app.compute_taxes(
    p_unit_price * p_quantity, v_cc.price_includes_tax,
    array(select tax_rate_id from public.charge_code_taxes where charge_code_id = v_cc.id),
    app.currency_decimals(v_folio.hotel_id)
  );

  v_txn.hotel_id := v_folio.hotel_id;
  v_txn.folio_id := v_folio.id;
  v_txn.txn_type := 'charge';
  v_txn.business_date := coalesce(p_business_date, app.today_for_hotel(v_folio.hotel_id));
  v_txn.charge_code_id := v_cc.id;
  v_txn.department_id := v_cc.department_id;
  v_txn.description := coalesce(nullif(trim(p_description), ''), v_cc.name_ar);
  v_txn.reference := nullif(trim(p_reference), '');
  v_txn.quantity := p_quantity;
  v_txn.unit_price := p_unit_price;
  v_txn.net_amount := (v_tax ->> 'net')::numeric;
  v_txn.tax_amount := (v_tax ->> 'tax_total')::numeric;
  v_txn.total_amount := (v_tax ->> 'total')::numeric;
  v_id := app.insert_folio_txn(v_txn);

  insert into public.folio_transaction_taxes (transaction_id, hotel_id, tax_rate_id, taxable_base, amount)
  select v_id, v_folio.hotel_id, (e ->> 'tax_rate_id')::uuid, (e ->> 'taxable_base')::numeric, (e ->> 'amount')::numeric
  from jsonb_array_elements(v_tax -> 'taxes') e;

  -- القيد: مدين ذمم النزلاء بالإجمالي / دائن الإيراد بالصافي (بمركز تكلفة القسم) / دائن كل ضريبة
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', app.account_by_key(v_folio.hotel_id, 'guest_ledger'), 'debit', v_txn.total_amount),
    jsonb_build_object('account_id', v_cc.revenue_account_id, 'department_id', v_cc.department_id,
                       'credit', v_txn.net_amount, 'description', v_txn.description)
  );
  for v_t in select * from jsonb_array_elements(v_tax -> 'taxes') loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', (select account_id from public.tax_rates where id = (v_t ->> 'tax_rate_id')::uuid),
      'credit', (v_t ->> 'amount')::numeric
    ));
  end loop;
  perform app.post_folio_txn_entry(v_id, v_folio, v_lines);
  return v_id;
end;
$$;

-- خصم/تسوية على رسم سابق (مبلغ إجمالي شامل)، تُعكس ضرائبه بنفس النسب
create or replace function public.post_folio_allowance(
  p_folio_id        uuid,
  p_charge_txn_id   uuid,
  p_amount          numeric,
  p_reason          text,
  p_business_date   date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folio     public.guest_folios%rowtype;
  v_charge    public.folio_transactions%rowtype;
  v_remaining numeric;
  v_tax       jsonb;
  v_txn       public.folio_transactions%rowtype;
  v_id        uuid;
  v_lines     jsonb;
  v_t         jsonb;
begin
  v_folio := app.lock_open_folio(p_folio_id, 'folio.allowance');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required for allowances' using errcode = '22023';
  end if;
  select * into v_charge from public.folio_transactions
   where id = p_charge_txn_id and folio_id = v_folio.id and txn_type = 'charge' and direction = 1;
  if not found or v_charge.voided_by_id is not null then
    raise exception 'Original charge not found or voided' using errcode = '23503';
  end if;

  -- المتبقي القابل للخصم = إجمالي الرسم − الخصومات السابقة الفعّالة عليه
  select v_charge.total_amount - coalesce(sum(total_amount * direction), 0) into v_remaining
  from public.folio_transactions
  where related_transaction_id = v_charge.id and txn_type = 'allowance';
  if p_amount is null or p_amount <= 0 or p_amount > v_remaining then
    raise exception 'Allowance must be between 0 and %', v_remaining using errcode = '22023';
  end if;

  v_tax := app.compute_taxes(
    p_amount, true,
    array(select tax_rate_id from public.folio_transaction_taxes where transaction_id = v_charge.id),
    app.currency_decimals(v_folio.hotel_id)
  );

  v_txn.hotel_id := v_folio.hotel_id;
  v_txn.folio_id := v_folio.id;
  v_txn.txn_type := 'allowance';
  v_txn.business_date := coalesce(p_business_date, app.today_for_hotel(v_folio.hotel_id));
  v_txn.charge_code_id := v_charge.charge_code_id;
  v_txn.department_id := v_charge.department_id;
  v_txn.description := trim(p_reason);
  v_txn.related_transaction_id := v_charge.id;
  v_txn.net_amount := (v_tax ->> 'net')::numeric;
  v_txn.tax_amount := (v_tax ->> 'tax_total')::numeric;
  v_txn.total_amount := (v_tax ->> 'total')::numeric;
  v_id := app.insert_folio_txn(v_txn);

  insert into public.folio_transaction_taxes (transaction_id, hotel_id, tax_rate_id, taxable_base, amount)
  select v_id, v_folio.hotel_id, (e ->> 'tax_rate_id')::uuid, (e ->> 'taxable_base')::numeric, (e ->> 'amount')::numeric
  from jsonb_array_elements(v_tax -> 'taxes') e;

  -- القيد: مدين خصومات مسموح بها (بمركز تكلفة القسم) + مدين الضرائب / دائن ذمم النزلاء
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', app.account_by_key(v_folio.hotel_id, 'revenue_discounts'),
                       'department_id', v_charge.department_id, 'debit', v_txn.net_amount, 'description', v_txn.description),
    jsonb_build_object('account_id', app.account_by_key(v_folio.hotel_id, 'guest_ledger'), 'credit', v_txn.total_amount)
  );
  for v_t in select * from jsonb_array_elements(v_tax -> 'taxes') loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', (select account_id from public.tax_rates where id = (v_t ->> 'tax_rate_id')::uuid),
      'debit', (v_t ->> 'amount')::numeric
    ));
  end loop;
  perform app.post_folio_txn_entry(v_id, v_folio, v_lines);
  return v_id;
end;
$$;

-- دفعة/عربون/استرداد: كلها "حركة نقدية" على حساب طريقة الدفع
create or replace function app.post_folio_money(
  p_folio_id          uuid,
  p_type              public.folio_txn_type,
  p_payment_method_id uuid,
  p_amount            numeric,
  p_business_date     date,
  p_reference         text,
  p_description       text,
  p_customer_id       uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folio    public.guest_folios%rowtype;
  v_method   public.payment_methods%rowtype;
  v_bal      record;
  v_customer public.customers%rowtype;
  v_txn      public.folio_transactions%rowtype;
  v_id       uuid;
  v_debit    uuid;
  v_credit   uuid;
  v_decimals smallint;
begin
  v_folio := app.lock_open_folio(p_folio_id, 'folio.manage');
  v_method := app.active_payment_method(v_folio.hotel_id, p_payment_method_id);
  v_decimals := app.currency_decimals(v_folio.hotel_id);
  if p_amount is null or p_amount <= 0 or round(p_amount, v_decimals) <> p_amount then
    raise exception 'Amount must be positive with at most % decimals', v_decimals using errcode = '22023';
  end if;
  v_bal := app.folio_current_balances(v_folio.id);

  if v_method.kind = 'city_ledger' then
    if p_type <> 'payment' then
      raise exception 'Credit (city ledger) can only settle a folio balance' using errcode = '23514';
    end if;
    select * into v_customer from public.customers
     where id = coalesce(p_customer_id, v_folio.customer_id) and hotel_id = v_folio.hotel_id and is_active;
    if not found then
      raise exception 'A billing customer is required for credit settlement' using errcode = '23514';
    end if;
    if not v_customer.allow_credit then
      raise exception 'Customer % is not allowed credit', v_customer.code using errcode = '23514';
    end if;
    if v_customer.credit_limit is not null
       and app.customer_outstanding(v_customer.id) + p_amount > v_customer.credit_limit then
      raise exception 'Credit limit exceeded for customer %', v_customer.code using errcode = '23514';
    end if;
  end if;

  if p_type = 'payment' and p_amount > v_bal.balance and v_method.kind = 'city_ledger' then
    raise exception 'Credit settlement cannot exceed the folio balance' using errcode = '23514';
  end if;
  if p_type = 'refund' and p_amount > -v_bal.balance then
    raise exception 'Refund cannot exceed the guest credit balance (%)', -v_bal.balance using errcode = '23514';
  end if;
  if p_type = 'deposit_refund' and p_amount > v_bal.deposits then
    raise exception 'Refund cannot exceed the deposit balance (%)', v_bal.deposits using errcode = '23514';
  end if;

  v_txn.hotel_id := v_folio.hotel_id;
  v_txn.folio_id := v_folio.id;
  v_txn.txn_type := p_type;
  v_txn.business_date := coalesce(p_business_date, app.today_for_hotel(v_folio.hotel_id));
  v_txn.payment_method_id := v_method.id;
  v_txn.customer_id := v_customer.id;
  v_txn.description := coalesce(nullif(trim(p_description), ''), v_method.name_ar);
  v_txn.reference := nullif(trim(p_reference), '');
  v_txn.total_amount := p_amount;
  v_id := app.insert_folio_txn(v_txn);

  -- تحديد طرفي القيد
  case p_type
    when 'payment' then
      v_debit := v_method.account_id;  -- للآجل: حساب طريقة الدفع = ذمم مدينة - شركات
      v_credit := app.account_by_key(v_folio.hotel_id, 'guest_ledger');
    when 'refund' then
      v_debit := app.account_by_key(v_folio.hotel_id, 'guest_ledger');
      v_credit := v_method.account_id;
    when 'deposit' then
      v_debit := v_method.account_id;
      v_credit := app.account_by_key(v_folio.hotel_id, 'guest_deposits');
    when 'deposit_refund' then
      v_debit := app.account_by_key(v_folio.hotel_id, 'guest_deposits');
      v_credit := v_method.account_id;
    else
      raise exception 'Unsupported money transaction type %', p_type;
  end case;

  perform app.post_folio_txn_entry(v_id, v_folio, jsonb_build_array(
    jsonb_build_object('account_id', v_debit, 'debit', p_amount),
    jsonb_build_object('account_id', v_credit, 'credit', p_amount)
  ));
  return v_id;
end;
$$;

create or replace function public.post_folio_payment(
  p_folio_id uuid, p_payment_method_id uuid, p_amount numeric,
  p_business_date date default null, p_reference text default null,
  p_description text default null, p_customer_id uuid default null
)
returns uuid language sql security definer set search_path = '' as $$
  select app.post_folio_money(p_folio_id, 'payment', p_payment_method_id, p_amount, p_business_date, p_reference, p_description, p_customer_id);
$$;

create or replace function public.post_folio_refund(
  p_folio_id uuid, p_payment_method_id uuid, p_amount numeric,
  p_business_date date default null, p_reference text default null, p_description text default null
)
returns uuid language sql security definer set search_path = '' as $$
  select app.post_folio_money(p_folio_id, 'refund', p_payment_method_id, p_amount, p_business_date, p_reference, p_description, null);
$$;

create or replace function public.post_folio_deposit(
  p_folio_id uuid, p_payment_method_id uuid, p_amount numeric,
  p_business_date date default null, p_reference text default null, p_description text default null
)
returns uuid language sql security definer set search_path = '' as $$
  select app.post_folio_money(p_folio_id, 'deposit', p_payment_method_id, p_amount, p_business_date, p_reference, p_description, null);
$$;

create or replace function public.refund_folio_deposit(
  p_folio_id uuid, p_payment_method_id uuid, p_amount numeric,
  p_business_date date default null, p_reference text default null, p_description text default null
)
returns uuid language sql security definer set search_path = '' as $$
  select app.post_folio_money(p_folio_id, 'deposit_refund', p_payment_method_id, p_amount, p_business_date, p_reference, p_description, null);
$$;

-- تطبيق العربون على رصيد الفوليو (افتراضيًا: الأقل من العربون المتاح والرصيد المستحق)
create or replace function public.apply_folio_deposit(
  p_folio_id uuid, p_amount numeric default null, p_business_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folio  public.guest_folios%rowtype;
  v_bal    record;
  v_amount numeric;
  v_txn    public.folio_transactions%rowtype;
  v_id     uuid;
begin
  v_folio := app.lock_open_folio(p_folio_id, 'folio.manage');
  v_bal := app.folio_current_balances(v_folio.id);
  v_amount := coalesce(p_amount, least(v_bal.deposits, greatest(v_bal.balance, 0)));
  if v_amount <= 0 then
    return null;
  end if;
  if v_amount > v_bal.deposits then
    raise exception 'Amount exceeds the deposit balance (%)', v_bal.deposits using errcode = '23514';
  end if;

  v_txn.hotel_id := v_folio.hotel_id;
  v_txn.folio_id := v_folio.id;
  v_txn.txn_type := 'deposit_application';
  v_txn.business_date := coalesce(p_business_date, app.today_for_hotel(v_folio.hotel_id));
  v_txn.description := 'تطبيق العربون / Deposit applied';
  v_txn.total_amount := v_amount;
  v_id := app.insert_folio_txn(v_txn);

  perform app.post_folio_txn_entry(v_id, v_folio, jsonb_build_array(
    jsonb_build_object('account_id', app.account_by_key(v_folio.hotel_id, 'guest_deposits'), 'debit', v_amount),
    jsonb_build_object('account_id', app.account_by_key(v_folio.hotel_id, 'guest_ledger'), 'credit', v_amount)
  ));
  return v_id;
end;
$$;

-- تحويل مبلغ بين فوليوين (فصل الفواتير Split Billing / تجميع على فوليو رئيسي)
-- لا قيد محاسبي: الطرفان على نفس حساب ذمم النزلاء
create or replace function public.transfer_folio_balance(
  p_from_folio_id uuid, p_to_folio_id uuid, p_amount numeric,
  p_description text default null, p_business_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from   public.guest_folios%rowtype;
  v_to     public.guest_folios%rowtype;
  v_txn    public.folio_transactions%rowtype;
  v_out_id uuid;
  v_in_id  uuid;
  v_date   date;
begin
  if p_from_folio_id = p_to_folio_id then
    raise exception 'Cannot transfer to the same folio' using errcode = '22023';
  end if;
  -- قفل بترتيب ثابت لتفادي الجمود (deadlock)
  if p_from_folio_id < p_to_folio_id then
    v_from := app.lock_open_folio(p_from_folio_id, 'folio.manage');
    v_to := app.lock_open_folio(p_to_folio_id, 'folio.manage');
  else
    v_to := app.lock_open_folio(p_to_folio_id, 'folio.manage');
    v_from := app.lock_open_folio(p_from_folio_id, 'folio.manage');
  end if;
  if v_from.hotel_id <> v_to.hotel_id then
    raise exception 'Folios belong to different hotels' using errcode = '23514';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero' using errcode = '22023';
  end if;
  v_date := coalesce(p_business_date, app.today_for_hotel(v_from.hotel_id));

  v_txn.hotel_id := v_from.hotel_id;
  v_txn.business_date := v_date;
  v_txn.total_amount := p_amount;

  v_txn.folio_id := v_from.id;
  v_txn.txn_type := 'transfer_out';
  v_txn.counter_folio_id := v_to.id;
  v_txn.description := coalesce(nullif(trim(p_description), ''), 'تحويل إلى / Transfer to ' || v_to.folio_number);
  v_out_id := app.insert_folio_txn(v_txn);

  v_txn.folio_id := v_to.id;
  v_txn.txn_type := 'transfer_in';
  v_txn.counter_folio_id := v_from.id;
  v_txn.related_transaction_id := v_out_id;
  v_txn.description := coalesce(nullif(trim(p_description), ''), 'تحويل من / Transfer from ' || v_from.folio_number);
  v_in_id := app.insert_folio_txn(v_txn);

  return v_out_id;
end;
$$;

-- إلغاء حركة: حركة معاكسة (direction = −1) + عكس قيدها. لا حذف ولا تعديل للأصل.
create or replace function public.void_folio_transaction(p_txn_id uuid, p_reason text, p_business_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig  public.folio_transactions%rowtype;
  v_folio public.guest_folios%rowtype;
  v_void  public.folio_transactions%rowtype;
  v_bal   record;
  v_id    uuid;
  v_je    uuid;
begin
  select * into v_orig from public.folio_transactions where id = p_txn_id;
  if not found then
    raise exception 'Transaction not found' using errcode = 'P0002';
  end if;
  v_folio := app.lock_open_folio(v_orig.folio_id, 'folio.void');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to void a transaction' using errcode = '22023';
  end if;
  if v_orig.direction = -1 or v_orig.voided_by_id is not null then
    raise exception 'Transaction is already voided or is itself a void' using errcode = '23514';
  end if;
  if v_orig.txn_type in ('transfer_in', 'transfer_out') then
    raise exception 'Transfers are corrected by transferring back' using errcode = '23514';
  end if;
  if v_orig.txn_type = 'charge' and exists (
    select 1 from public.folio_transactions a
    where a.related_transaction_id = v_orig.id and a.txn_type = 'allowance' and a.direction = 1 and a.voided_by_id is null
  ) then
    raise exception 'Void the allowances on this charge first' using errcode = '23514';
  end if;

  v_void := v_orig;
  v_void.direction := -1;
  v_void.business_date := coalesce(p_business_date, app.today_for_hotel(v_orig.hotel_id));
  v_void.description := 'إلغاء / Void: ' || v_orig.description || ' — ' || trim(p_reason);
  v_void.related_transaction_id := v_orig.id;
  v_void.counter_folio_id := null;
  v_id := app.insert_folio_txn(v_void);

  insert into public.folio_transaction_taxes (transaction_id, hotel_id, tax_rate_id, taxable_base, amount)
  select v_id, hotel_id, tax_rate_id, taxable_base, amount
  from public.folio_transaction_taxes where transaction_id = v_orig.id;

  -- الإلغاء لا يجوز أن يجعل رصيد الودائع سالبًا (مثل إلغاء عربون تم تطبيقه)
  v_bal := app.folio_current_balances(v_folio.id);
  if v_bal.deposits < 0 then
    raise exception 'Voiding would make the deposit balance negative' using errcode = '23514';
  end if;

  if v_orig.journal_entry_id is not null then
    v_je := app.reverse_system_entry(v_orig.journal_entry_id, v_void.business_date,
                                     v_void.description || ' — ' || v_folio.folio_number);
  end if;

  perform set_config('app.system_posting', 'on', true);
  update public.folio_transactions set journal_entry_id = v_je where id = v_id;
  update public.folio_transactions set voided_by_id = v_id where id = v_orig.id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- إلغاء فوليو فارغ (فُتح بالخطأ)
create or replace function public.cancel_folio(p_folio_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folio public.guest_folios%rowtype;
begin
  v_folio := app.lock_open_folio(p_folio_id, 'folio.manage');
  if exists (select 1 from public.folio_transactions where folio_id = v_folio.id) then
    raise exception 'Only folios without transactions can be cancelled' using errcode = '23514';
  end if;
  perform set_config('app.system_posting', 'on', true);
  update public.guest_folios set status = 'cancelled', closed_at = now(), closed_by = auth.uid() where id = v_folio.id;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

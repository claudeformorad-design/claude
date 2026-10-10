-- =============================================================================
-- المرحلة 2 / الترحيل 8: الفواتير، سندات القبض والصرف، تخصيص السداد، تسجيل المغادرة
--
-- أنواع الفواتير:
--  * folio : تصدر آليًا عند إغلاق الفوليو (Checkout). الإيراد مُرحّل مسبقًا مع كل رسم،
--            لذا لا تنشئ الفاتورة قيدًا جديدًا؛ هي المستند الضريبي للنزيل/الشركة.
--            الجزء المحوّل للآجل (City Ledger) = amount_due ذمة مدينة على العميل.
--  * direct: فاتورة آجلة مباشرة لعميل (قاعة مؤتمرات لشركة مثلًا) — تنشئ قيدها:
--            مدين ذمم مدينة / دائن الإيراد والضرائب.
-- الفاتورة بعد إصدارها غير قابلة للتعديل: لا كتابة مباشرة إطلاقًا (app.system_write_only)،
-- والدوال النظامية لا تحدّث إلا المسدد والحالة. التصحيح بإشعار دائن — المرحلة 3.
-- =============================================================================

create type public.invoice_type as enum ('folio', 'direct');
create type public.invoice_status as enum ('issued', 'partially_paid', 'paid');

create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references public.hotels(id),
  invoice_number      text not null,
  invoice_type        public.invoice_type not null,
  folio_id            uuid unique,
  customer_id         uuid,
  bill_to_name        text not null,
  bill_to_tax_number  text,
  bill_to_address     text,
  issue_date          date not null,
  due_date            date,
  currency_code       char(3) not null references public.currencies(code),
  subtotal            numeric(19, 4) not null,
  tax_total           numeric(19, 4) not null,
  total               numeric(19, 4) not null,
  -- المبلغ الآجل المستحق على العميل (ذمة مدينة)؛ صفر للفواتير المسددة نقدًا بالكامل
  amount_due          numeric(19, 4) not null default 0 check (amount_due >= 0),
  amount_paid         numeric(19, 4) not null default 0 check (amount_paid >= 0),
  status              public.invoice_status not null,
  journal_entry_id    uuid references public.journal_entries(id),
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now(),
  unique (hotel_id, invoice_number),
  unique (hotel_id, id),
  foreign key (hotel_id, folio_id) references public.guest_folios (hotel_id, id),
  foreign key (hotel_id, customer_id) references public.customers (hotel_id, id),
  constraint invoice_totals check (subtotal + tax_total = total),
  constraint invoice_paid_le_due check (amount_paid <= amount_due),
  constraint invoice_due_needs_customer check (amount_due = 0 or customer_id is not null),
  constraint invoice_folio_link check ((invoice_type = 'folio') = (folio_id is not null))
);

create index invoices_customer_idx on public.invoices (hotel_id, customer_id) where customer_id is not null;
create index invoices_date_idx on public.invoices (hotel_id, issue_date desc);

create table public.invoice_items (
  id                     uuid primary key default gen_random_uuid(),
  invoice_id             uuid not null,
  hotel_id               uuid not null,
  line_no                integer not null,
  charge_code_id         uuid,
  department_id          uuid,
  business_date          date,
  description            text not null,
  quantity               numeric(12, 3) not null default 1,
  unit_price             numeric(19, 4),
  -- موجبة للرسوم، سالبة للخصومات
  net_amount             numeric(19, 4) not null,
  tax_amount             numeric(19, 4) not null,
  total_amount           numeric(19, 4) not null,
  source_transaction_id  uuid references public.folio_transactions(id),
  unique (invoice_id, line_no),
  foreign key (hotel_id, invoice_id) references public.invoices (hotel_id, id),
  foreign key (hotel_id, charge_code_id) references public.charge_codes (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  constraint invoice_item_totals check (net_amount + tax_amount = total_amount)
);

create table public.invoice_taxes (
  invoice_id    uuid not null,
  hotel_id      uuid not null,
  tax_rate_id   uuid not null,
  taxable_base  numeric(19, 4) not null,
  amount        numeric(19, 4) not null,
  primary key (invoice_id, tax_rate_id),
  foreign key (hotel_id, invoice_id) references public.invoices (hotel_id, id),
  foreign key (hotel_id, tax_rate_id) references public.tax_rates (hotel_id, id)
);

-- -----------------------------------------------------------------------------
-- السندات: قبض (Receipt) وصرف (Payment Voucher)
-- -----------------------------------------------------------------------------
create type public.voucher_type as enum ('receipt', 'disbursement');
create type public.voucher_party as enum ('customer', 'account');
create type public.voucher_status as enum ('posted', 'voided');

create table public.payments (
  id                     uuid primary key default gen_random_uuid(),
  hotel_id               uuid not null references public.hotels(id),
  voucher_number         text not null,
  voucher_type           public.voucher_type not null,
  party_type             public.voucher_party not null,
  payment_date           date not null,
  payment_method_id      uuid not null,
  amount                 numeric(19, 4) not null check (amount > 0),
  customer_id            uuid,
  -- الحساب المقابل لسندات "حساب" (مصروف، إيراد متنوع، جاري شركاء...)
  counter_account_id     uuid,
  department_id          uuid,
  party_name             text,
  reference              text,
  description            text not null,
  status                 public.voucher_status not null default 'posted',
  journal_entry_id       uuid references public.journal_entries(id),
  void_reason            text,
  voided_at              timestamptz,
  voided_by              uuid references auth.users(id),
  void_journal_entry_id  uuid references public.journal_entries(id),
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id),
  unique (hotel_id, voucher_number),
  unique (hotel_id, id),
  foreign key (hotel_id, payment_method_id) references public.payment_methods (hotel_id, id),
  foreign key (hotel_id, customer_id) references public.customers (hotel_id, id),
  foreign key (hotel_id, counter_account_id) references public.chart_of_accounts (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  constraint payment_party_fields check (
    (party_type = 'customer' and customer_id is not null and counter_account_id is null)
    or (party_type = 'account' and counter_account_id is not null and customer_id is null)
  )
);

create index payments_customer_idx on public.payments (hotel_id, customer_id) where customer_id is not null;
create index payments_date_idx on public.payments (hotel_id, payment_date desc);

create table public.payment_allocations (
  payment_id  uuid not null,
  invoice_id  uuid not null,
  hotel_id    uuid not null,
  amount      numeric(19, 4) not null check (amount > 0),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  primary key (payment_id, invoice_id),
  foreign key (hotel_id, payment_id) references public.payments (hotel_id, id),
  foreign key (hotel_id, invoice_id) references public.invoices (hotel_id, id)
);

-- -----------------------------------------------------------------------------
-- حماية عدم التعديل: الفواتير وبنودها وضرائبها والسندات والتخصيصات تُكتب عبر الدوال فقط
-- -----------------------------------------------------------------------------
create or replace function app.system_write_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.is_system_posting() then
    raise exception '% is maintained by the system and cannot be changed directly', tg_table_name
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception '% rows cannot be deleted', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger invoices_system_only before insert or update or delete on public.invoices
  for each row execute function app.system_write_only();
create trigger invoice_items_system_only before insert or update or delete on public.invoice_items
  for each row execute function app.system_write_only();
create trigger invoice_taxes_system_only before insert or update or delete on public.invoice_taxes
  for each row execute function app.system_write_only();
create trigger payments_system_only before insert or update or delete on public.payments
  for each row execute function app.system_write_only();
create trigger payment_allocations_system_only before insert or update or delete on public.payment_allocations
  for each row execute function app.system_write_only();

-- -----------------------------------------------------------------------------
-- أرصدة العملاء
-- -----------------------------------------------------------------------------
-- رصيد دائن غير مخصص للعميل = سندات قبض سارية − ما خُصص منها − سندات صرف سارية له
create or replace function app.customer_unapplied_credit(p_customer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
      select sum(p.amount - coalesce((select sum(a.amount) from public.payment_allocations a where a.payment_id = p.id), 0))
      from public.payments p
      where p.customer_id = p_customer_id and p.voucher_type = 'receipt' and p.status = 'posted'
    ), 0)
    - coalesce((
      select sum(p.amount) from public.payments p
      where p.customer_id = p_customer_id and p.voucher_type = 'disbursement' and p.status = 'posted'
    ), 0);
$$;

-- الرصيد القائم على العميل (يُستخدم لفحص الحد الائتماني) — يستبدل التعريف المؤقت في الترحيل 7
create or replace function app.customer_outstanding(p_customer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(amount_due - amount_paid) from public.invoices where customer_id = p_customer_id), 0)
       -- المبالغ المحوّلة للآجل على فوليوهات مفتوحة لم تصدر فاتورتها بعد
       + coalesce((
           select sum(t.total_amount * t.direction)
           from public.folio_transactions t
           join public.payment_methods m on m.id = t.payment_method_id and m.kind = 'city_ledger'
           join public.guest_folios f on f.id = t.folio_id and f.status = 'open'
           where t.customer_id = p_customer_id and t.txn_type = 'payment'
         ), 0)
       - app.customer_unapplied_credit(p_customer_id);
$$;

create or replace function app.check_credit_limit(p_customer public.customers, p_amount numeric)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not p_customer.allow_credit then
    raise exception 'Customer % is not allowed credit', p_customer.code using errcode = '23514';
  end if;
  if p_customer.credit_limit is not null
     and app.customer_outstanding(p_customer.id) + p_amount > p_customer.credit_limit then
    raise exception 'Credit limit exceeded for customer %', p_customer.code using errcode = '23514';
  end if;
end;
$$;

-- إعادة احتساب المسدد وحالة الفاتورة من التخصيصات السارية
create or replace function app.refresh_invoice_paid(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid numeric;
  v_due  numeric;
begin
  select coalesce(sum(a.amount), 0) into v_paid
  from public.payment_allocations a
  join public.payments p on p.id = a.payment_id and p.status = 'posted'
  where a.invoice_id = p_invoice_id;

  select amount_due into v_due from public.invoices where id = p_invoice_id;
  if v_paid > v_due then
    raise exception 'Allocations exceed the invoice amount due' using errcode = '23514';
  end if;

  update public.invoices
     set amount_paid = v_paid,
         status = case when v_paid >= v_due then 'paid'
                       when v_paid = 0 then 'issued'
                       else 'partially_paid' end::public.invoice_status
   where id = p_invoice_id;
end;
$$;

-- =============================================================================
-- تسجيل المغادرة وإصدار فاتورة الفوليو
-- =============================================================================
create or replace function public.checkout_folio(p_folio_id uuid, p_business_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folio      public.guest_folios%rowtype;
  v_bal        record;
  v_date       date;
  v_customer   public.customers%rowtype;
  v_customers  integer;
  v_credit     numeric;
  v_invoice_id uuid;
  v_subtotal   numeric;
  v_tax        numeric;
begin
  v_folio := app.lock_open_folio(p_folio_id, 'folio.checkout');
  v_date := coalesce(p_business_date, app.today_for_hotel(v_folio.hotel_id));

  if not exists (select 1 from public.folio_transactions where folio_id = v_folio.id) then
    raise exception 'Empty folios are cancelled, not checked out' using errcode = '23514';
  end if;

  -- 1) تطبيق العربون تلقائيًا على الرصيد المستحق
  perform public.apply_folio_deposit(v_folio.id, null, v_date);

  -- 2) يجب أن يكون الفوليو مسوّى تمامًا
  v_bal := app.folio_current_balances(v_folio.id);
  if v_bal.balance <> 0 then
    raise exception 'Folio balance must be zero before checkout (balance: %)', v_bal.balance using errcode = '23514';
  end if;
  if v_bal.deposits <> 0 then
    raise exception 'Unapplied deposit remains (%); refund it before checkout', v_bal.deposits using errcode = '23514';
  end if;

  -- 3) الجزء الآجل وعميل الفوترة
  select count(distinct t.customer_id), coalesce(sum(t.total_amount * t.direction), 0)
    into v_customers, v_credit
  from public.folio_transactions t
  join public.payment_methods m on m.id = t.payment_method_id and m.kind = 'city_ledger'
  where t.folio_id = v_folio.id and t.txn_type = 'payment';
  if v_customers > 1 then
    raise exception 'A folio can be billed on credit to one customer only' using errcode = '23514';
  end if;

  select c.* into v_customer from public.customers c
  where c.id = coalesce(
    (select t.customer_id from public.folio_transactions t
       join public.payment_methods m on m.id = t.payment_method_id and m.kind = 'city_ledger'
      where t.folio_id = v_folio.id and t.txn_type = 'payment' limit 1),
    v_folio.customer_id);

  -- 4) بنود الفاتورة = الرسوم والخصومات الفعّالة (بدون الملغاة وحركات الإلغاء)
  select coalesce(sum(case when txn_type = 'charge' then net_amount else -net_amount end), 0),
         coalesce(sum(case when txn_type = 'charge' then tax_amount else -tax_amount end), 0)
    into v_subtotal, v_tax
  from public.folio_transactions
  where folio_id = v_folio.id and txn_type in ('charge', 'allowance') and direction = 1 and voided_by_id is null;

  perform set_config('app.system_posting', 'on', true);

  insert into public.invoices (
    hotel_id, invoice_number, invoice_type, folio_id, customer_id, bill_to_name, bill_to_tax_number,
    bill_to_address, issue_date, due_date, currency_code, subtotal, tax_total, total, amount_due,
    amount_paid, status, created_by
  )
  select v_folio.hotel_id, app.next_document_number(v_folio.hotel_id, 'invoice', 'INV', v_date), 'folio',
         v_folio.id, v_customer.id,
         coalesce(case when v_customer.id is not null then v_customer.name_ar end, v_folio.guest_name),
         v_customer.tax_number, v_customer.address, v_date,
         case when v_credit > 0 then v_date + coalesce(v_customer.payment_terms_days, 30) end,
         h.base_currency, v_subtotal, v_tax, v_subtotal + v_tax, v_credit, 0,
         case when v_credit > 0 then 'issued' else 'paid' end::public.invoice_status, auth.uid()
  from public.hotels h where h.id = v_folio.hotel_id
  returning id into v_invoice_id;

  insert into public.invoice_items (
    invoice_id, hotel_id, line_no, charge_code_id, department_id, business_date, description,
    quantity, unit_price, net_amount, tax_amount, total_amount, source_transaction_id
  )
  select v_invoice_id, t.hotel_id,
         row_number() over (order by t.business_date, t.created_at),
         t.charge_code_id, t.department_id, t.business_date, t.description,
         t.quantity, t.unit_price,
         case when t.txn_type = 'charge' then t.net_amount else -t.net_amount end,
         case when t.txn_type = 'charge' then t.tax_amount else -t.tax_amount end,
         case when t.txn_type = 'charge' then t.total_amount else -t.total_amount end,
         t.id
  from public.folio_transactions t
  where t.folio_id = v_folio.id and t.txn_type in ('charge', 'allowance') and t.direction = 1 and t.voided_by_id is null;

  insert into public.invoice_taxes (invoice_id, hotel_id, tax_rate_id, taxable_base, amount)
  select v_invoice_id, v_folio.hotel_id, x.tax_rate_id,
         sum(case when t.txn_type = 'charge' then x.taxable_base else -x.taxable_base end),
         sum(case when t.txn_type = 'charge' then x.amount else -x.amount end)
  from public.folio_transactions t
  join public.folio_transaction_taxes x on x.transaction_id = t.id
  where t.folio_id = v_folio.id and t.txn_type in ('charge', 'allowance') and t.direction = 1 and t.voided_by_id is null
  group by x.tax_rate_id;

  update public.guest_folios
     set status = 'closed', closed_at = now(), closed_by = auth.uid(),
         departure_date = coalesce(departure_date, v_date)
   where id = v_folio.id;

  perform set_config('app.system_posting', 'off', true);
  return v_invoice_id;
end;
$$;

-- =============================================================================
-- فاتورة آجلة مباشرة لعميل
-- p_lines: [{charge_code_id, description?, quantity, unit_price}]
-- =============================================================================
create or replace function public.create_direct_invoice(
  p_hotel_id    uuid,
  p_customer_id uuid,
  p_lines       jsonb,
  p_issue_date  date default null,
  p_notes       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer   public.customers%rowtype;
  v_date       date;
  v_decimals   smallint;
  v_line       jsonb;
  v_cc         public.charge_codes%rowtype;
  v_tax        jsonb;
  v_invoice_id uuid;
  v_no         integer := 0;
  v_qty        numeric;
  v_price      numeric;
  v_je_lines   jsonb := '[]'::jsonb;
  v_subtotal   numeric := 0;
  v_tax_total  numeric := 0;
  v_je         uuid;
begin
  perform app.require_permission(p_hotel_id, 'invoices.create');
  select * into v_customer from public.customers where id = p_customer_id and hotel_id = p_hotel_id and is_active;
  if not found then
    raise exception 'Customer not found or inactive' using errcode = '23503';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'An invoice needs at least one line' using errcode = '22023';
  end if;

  v_date := coalesce(p_issue_date, app.today_for_hotel(p_hotel_id));
  v_decimals := app.currency_decimals(p_hotel_id);

  perform set_config('app.system_posting', 'on', true);
  insert into public.invoices (
    hotel_id, invoice_number, invoice_type, customer_id, bill_to_name, bill_to_tax_number, bill_to_address,
    issue_date, due_date, currency_code, subtotal, tax_total, total, amount_due, status, notes, created_by
  )
  select p_hotel_id, app.next_document_number(p_hotel_id, 'invoice', 'INV', v_date), 'direct',
         v_customer.id, v_customer.name_ar, v_customer.tax_number, v_customer.address,
         v_date, v_date + v_customer.payment_terms_days, h.base_currency, 0, 0, 0, 0, 'issued',
         nullif(trim(p_notes), ''), auth.uid()
  from public.hotels h where h.id = p_hotel_id
  returning id into v_invoice_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_no := v_no + 1;
    select * into v_cc from public.charge_codes
     where id = (v_line ->> 'charge_code_id')::uuid and hotel_id = p_hotel_id and is_active;
    if not found then
      raise exception 'Charge code not found or inactive (line %)', v_no using errcode = '23503';
    end if;
    v_qty := coalesce((v_line ->> 'quantity')::numeric, 1);
    v_price := (v_line ->> 'unit_price')::numeric;
    if v_qty <= 0 or v_price is null or v_price <= 0 then
      raise exception 'Invalid quantity or price (line %)', v_no using errcode = '22023';
    end if;

    v_tax := app.compute_taxes(v_qty * v_price, v_cc.price_includes_tax,
      array(select tax_rate_id from public.charge_code_taxes where charge_code_id = v_cc.id), v_decimals);

    insert into public.invoice_items (
      invoice_id, hotel_id, line_no, charge_code_id, department_id, business_date, description,
      quantity, unit_price, net_amount, tax_amount, total_amount
    ) values (
      v_invoice_id, p_hotel_id, v_no, v_cc.id, v_cc.department_id, v_date,
      coalesce(nullif(trim(v_line ->> 'description'), ''), v_cc.name_ar),
      v_qty, v_price, (v_tax ->> 'net')::numeric, (v_tax ->> 'tax_total')::numeric, (v_tax ->> 'total')::numeric
    );

    v_subtotal := v_subtotal + (v_tax ->> 'net')::numeric;
    v_tax_total := v_tax_total + (v_tax ->> 'tax_total')::numeric;
    v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_cc.revenue_account_id, 'department_id', v_cc.department_id,
      'credit', (v_tax ->> 'net')::numeric, 'description', coalesce(nullif(trim(v_line ->> 'description'), ''), v_cc.name_ar)
    ));
    -- تجميع ضرائب الفاتورة
    insert into public.invoice_taxes (invoice_id, hotel_id, tax_rate_id, taxable_base, amount)
    select v_invoice_id, p_hotel_id, (e ->> 'tax_rate_id')::uuid, (e ->> 'taxable_base')::numeric, (e ->> 'amount')::numeric
    from jsonb_array_elements(v_tax -> 'taxes') e
    on conflict (invoice_id, tax_rate_id) do update
      set taxable_base = public.invoice_taxes.taxable_base + excluded.taxable_base,
          amount = public.invoice_taxes.amount + excluded.amount;
  end loop;

  -- الحد الائتماني يُفحص على الإجمالي النهائي
  perform app.check_credit_limit(v_customer, v_subtotal + v_tax_total);

  -- سطور ضرائب القيد من ملخص ضرائب الفاتورة
  select v_je_lines || coalesce(jsonb_agg(jsonb_build_object('account_id', r.account_id, 'credit', it.amount)), '[]'::jsonb)
    into v_je_lines
  from public.invoice_taxes it join public.tax_rates r on r.id = it.tax_rate_id
  where it.invoice_id = v_invoice_id;

  v_je_lines := jsonb_build_array(jsonb_build_object(
    'account_id', app.account_by_key(p_hotel_id, 'ar_control'), 'debit', v_subtotal + v_tax_total
  )) || v_je_lines;

  update public.invoices
     set subtotal = v_subtotal, tax_total = v_tax_total, total = v_subtotal + v_tax_total,
         amount_due = v_subtotal + v_tax_total
   where id = v_invoice_id;

  v_je := app.post_system_entry(p_hotel_id, v_date,
            'فاتورة آجلة / Credit invoice — ' || v_customer.name_ar,
            'invoice', v_invoice_id,
            (select invoice_number from public.invoices where id = v_invoice_id), v_je_lines);

  perform set_config('app.system_posting', 'on', true);
  update public.invoices set journal_entry_id = v_je where id = v_invoice_id;
  perform set_config('app.system_posting', 'off', true);
  return v_invoice_id;
end;
$$;

-- =============================================================================
-- السندات
-- p_allocations (لسندات القبض من عميل فقط): [{invoice_id, amount}]
-- =============================================================================
create or replace function app.add_payment_allocations(p_payment public.payments, p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alloc     jsonb;
  v_invoice   public.invoices%rowtype;
  v_amount    numeric;
  v_allocated numeric;
begin
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    return;
  end if;
  if p_payment.voucher_type <> 'receipt' or p_payment.party_type <> 'customer' or p_payment.status <> 'posted' then
    raise exception 'Only posted customer receipts can be allocated to invoices' using errcode = '23514';
  end if;

  for v_alloc in select * from jsonb_array_elements(p_allocations) loop
    v_amount := (v_alloc ->> 'amount')::numeric;
    select * into v_invoice from public.invoices
     where id = (v_alloc ->> 'invoice_id')::uuid and hotel_id = p_payment.hotel_id for update;
    if not found or v_invoice.customer_id is distinct from p_payment.customer_id then
      raise exception 'Invoice not found for this customer' using errcode = '23503';
    end if;
    if v_amount is null or v_amount <= 0 or v_amount > v_invoice.amount_due - v_invoice.amount_paid then
      raise exception 'Allocation for invoice % must be between 0 and %', v_invoice.invoice_number,
        v_invoice.amount_due - v_invoice.amount_paid using errcode = '23514';
    end if;

    perform set_config('app.system_posting', 'on', true);
    insert into public.payment_allocations (payment_id, invoice_id, hotel_id, amount, created_by)
    values (p_payment.id, v_invoice.id, p_payment.hotel_id, v_amount, auth.uid());
    perform app.refresh_invoice_paid(v_invoice.id);
  end loop;

  select coalesce(sum(amount), 0) into v_allocated from public.payment_allocations where payment_id = p_payment.id;
  if v_allocated > p_payment.amount then
    raise exception 'Allocations (%) exceed the voucher amount (%)', v_allocated, p_payment.amount using errcode = '23514';
  end if;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

create or replace function public.create_payment_voucher(
  p_hotel_id           uuid,
  p_voucher_type       public.voucher_type,
  p_party_type         public.voucher_party,
  p_payment_method_id  uuid,
  p_amount             numeric,
  p_description        text,
  p_payment_date       date default null,
  p_customer_id        uuid default null,
  p_counter_account_id uuid default null,
  p_department_id      uuid default null,
  p_party_name         text default null,
  p_reference          text default null,
  p_allocations        jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method   public.payment_methods%rowtype;
  v_customer public.customers%rowtype;
  v_counter  uuid;
  v_payment  public.payments%rowtype;
  v_date     date;
  v_decimals smallint;
  v_je       uuid;
  v_key      text;
begin
  perform app.require_permission(p_hotel_id,
    case p_voucher_type when 'receipt' then 'payments.receipt' else 'payments.disbursement' end);
  v_method := app.active_payment_method(p_hotel_id, p_payment_method_id);
  if v_method.kind = 'city_ledger' then
    raise exception 'Vouchers require a cash or bank payment method' using errcode = '23514';
  end if;
  v_decimals := app.currency_decimals(p_hotel_id);
  if p_amount is null or p_amount <= 0 or round(p_amount, v_decimals) <> p_amount then
    raise exception 'Amount must be positive with at most % decimals', v_decimals using errcode = '22023';
  end if;
  if length(trim(coalesce(p_description, ''))) = 0 then
    raise exception 'Description is required' using errcode = '22023';
  end if;
  v_date := coalesce(p_payment_date, app.today_for_hotel(p_hotel_id));

  if p_party_type = 'customer' then
    select * into v_customer from public.customers where id = p_customer_id and hotel_id = p_hotel_id;
    if not found then
      raise exception 'Customer not found' using errcode = '23503';
    end if;
    v_counter := app.account_by_key(p_hotel_id, 'ar_control');
    -- سند صرف لعميل = رد رصيد دائن له، لا يتجاوز رصيده الدائن غير المخصص
    if p_voucher_type = 'disbursement' and p_amount > app.customer_unapplied_credit(v_customer.id) then
      raise exception 'Refund exceeds the customer unapplied credit (%)', app.customer_unapplied_credit(v_customer.id)
        using errcode = '23514';
    end if;
  else
    if p_counter_account_id is null then
      raise exception 'Counter account is required' using errcode = '22023';
    end if;
    perform app.assert_account(p_hotel_id, p_counter_account_id,
      array['asset', 'liability', 'equity', 'revenue', 'expense']::public.account_type[]);
    -- حسابات المراقبة للدفاتر الفرعية لا تُحرّك إلا من مستنداتها (فوليو/فواتير/سندات عملاء)
    select system_key into v_key from public.chart_of_accounts where id = p_counter_account_id;
    if v_key in ('guest_ledger', 'ar_control', 'guest_deposits', 'ap_control') then
      raise exception 'Control account % cannot be used directly in a voucher', v_key using errcode = '23514';
    end if;
    v_counter := p_counter_account_id;
  end if;
  if p_department_id is not null and not exists (
    select 1 from public.departments where id = p_department_id and hotel_id = p_hotel_id
  ) then
    raise exception 'Department not found' using errcode = '23503';
  end if;

  perform set_config('app.system_posting', 'on', true);
  insert into public.payments (
    hotel_id, voucher_number, voucher_type, party_type, payment_date, payment_method_id, amount,
    customer_id, counter_account_id, department_id, party_name, reference, description, created_by
  ) values (
    p_hotel_id,
    app.next_document_number(p_hotel_id, 'voucher_' || p_voucher_type::text,
                             case p_voucher_type when 'receipt' then 'RV' else 'PV' end, v_date),
    p_voucher_type, p_party_type, v_date, v_method.id, p_amount,
    v_customer.id, case when p_party_type = 'account' then v_counter end, p_department_id,
    coalesce(nullif(trim(p_party_name), ''), v_customer.name_ar), nullif(trim(p_reference), ''),
    trim(p_description), auth.uid()
  ) returning * into v_payment;
  perform set_config('app.system_posting', 'off', true);

  v_je := app.post_system_entry(p_hotel_id, v_date,
    trim(p_description) || coalesce(' — ' || v_payment.party_name, ''),
    'payment', v_payment.id, v_payment.voucher_number,
    case p_voucher_type
      when 'receipt' then jsonb_build_array(
        jsonb_build_object('account_id', v_method.account_id, 'debit', p_amount),
        jsonb_build_object('account_id', v_counter, 'credit', p_amount, 'department_id', p_department_id))
      else jsonb_build_array(
        jsonb_build_object('account_id', v_counter, 'debit', p_amount, 'department_id', p_department_id),
        jsonb_build_object('account_id', v_method.account_id, 'credit', p_amount))
    end);

  perform set_config('app.system_posting', 'on', true);
  update public.payments set journal_entry_id = v_je where id = v_payment.id;
  perform set_config('app.system_posting', 'off', true);
  v_payment.journal_entry_id := v_je;

  perform app.add_payment_allocations(v_payment, p_allocations);
  return v_payment.id;
end;
$$;

-- تخصيص لاحق لرصيد سند قبض على فواتير العميل
create or replace function public.allocate_payment(p_payment_id uuid, p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'Voucher not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_payment.hotel_id, 'payments.receipt');
  perform app.add_payment_allocations(v_payment, p_allocations);
end;
$$;

-- إلغاء سند: عكس قيده وإلغاء أثر تخصيصاته (السجل يبقى للتدقيق)
create or replace function public.void_payment_voucher(p_payment_id uuid, p_reason text, p_date date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_je      uuid;
  v_inv     uuid;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'Voucher not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_payment.hotel_id, 'payments.void');
  if v_payment.status <> 'posted' then
    raise exception 'Voucher is already voided' using errcode = '23514';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to void a voucher' using errcode = '22023';
  end if;
  -- إلغاء سند قبض لعميل يجب ألا يجعل رصيده الدائن سالبًا (بسبب سند صرف لاحق)
  if v_payment.voucher_type = 'receipt' and v_payment.customer_id is not null
     and app.customer_unapplied_credit(v_payment.customer_id)
         - (v_payment.amount - coalesce((select sum(amount) from public.payment_allocations where payment_id = v_payment.id), 0)) < 0 then
    raise exception 'Voiding would leave a negative customer credit; void the related refund first' using errcode = '23514';
  end if;

  v_je := app.reverse_system_entry(v_payment.journal_entry_id,
            coalesce(p_date, app.today_for_hotel(v_payment.hotel_id)),
            'إلغاء سند / Void ' || v_payment.voucher_number || ' — ' || trim(p_reason));

  perform set_config('app.system_posting', 'on', true);
  update public.payments
     set status = 'voided', void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid(),
         void_journal_entry_id = v_je
   where id = v_payment.id;
  for v_inv in select invoice_id from public.payment_allocations where payment_id = v_payment.id loop
    perform app.refresh_invoice_paid(v_inv);
  end loop;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- عرض أرصدة العملاء (security_invoker ⇒ يخضع لـ RLS على الفواتير والسندات)
-- -----------------------------------------------------------------------------
create view public.customer_balances
with (security_invoker = true) as
select c.id as customer_id,
       c.hotel_id,
       coalesce((select sum(i.amount_due - i.amount_paid) from public.invoices i where i.customer_id = c.id), 0) as open_invoices,
       coalesce((
         select sum(p.amount - coalesce((select sum(a.amount) from public.payment_allocations a where a.payment_id = p.id), 0))
         from public.payments p where p.customer_id = c.id and p.voucher_type = 'receipt' and p.status = 'posted'
       ), 0)
       - coalesce((
         select sum(p.amount) from public.payments p
         where p.customer_id = c.id and p.voucher_type = 'disbursement' and p.status = 'posted'
       ), 0) as unapplied_credit
from public.customers c;

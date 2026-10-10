-- =============================================================================
-- المرحلة 3 (تكملة): سداد الموردين، الرواتب، الإشعار الدائن، المطابقة البنكية، الأعمار
-- =============================================================================

-- -----------------------------------------------------------------------------
-- السندات للموردين
-- -----------------------------------------------------------------------------
alter table public.payments add column vendor_id uuid;
alter table public.payments add foreign key (hotel_id, vendor_id) references public.vendors (hotel_id, id);
alter table public.payments drop constraint payment_party_fields;
alter table public.payments add constraint payment_party_fields check (
  (party_type = 'customer' and customer_id is not null and counter_account_id is null and vendor_id is null)
  or (party_type = 'account' and counter_account_id is not null and customer_id is null and vendor_id is null)
  or (party_type = 'vendor' and vendor_id is not null and customer_id is null and counter_account_id is null)
);

create table public.bill_payment_allocations (
  payment_id  uuid not null,
  bill_id     uuid not null,
  hotel_id    uuid not null,
  amount      numeric(19, 4) not null check (amount > 0),
  created_at  timestamptz not null default now(),
  primary key (payment_id, bill_id),
  foreign key (hotel_id, payment_id) references public.payments (hotel_id, id),
  foreign key (hotel_id, bill_id) references public.vendor_bills (hotel_id, id)
);

-- كل هذه الجداول تُكتب عبر الدوال فقط
create trigger purchase_orders_system_only before insert or update or delete on public.purchase_orders
  for each row execute function app.system_write_only();
create trigger purchase_order_items_system_only before insert or update or delete on public.purchase_order_items
  for each row execute function app.system_write_only();
create trigger vendor_bills_system_only before insert or update or delete on public.vendor_bills
  for each row execute function app.system_write_only();
create trigger vendor_bill_lines_system_only before insert or update or delete on public.vendor_bill_lines
  for each row execute function app.system_write_only();
create trigger bill_payment_allocations_system_only before insert or update or delete on public.bill_payment_allocations
  for each row execute function app.system_write_only();

-- -----------------------------------------------------------------------------
-- حساب بنود المشتريات: يعيد السطر مع الضريبة (غير شامل)
-- -----------------------------------------------------------------------------
create or replace function app.purchase_line_tax(p_net numeric, p_tax_rate_id uuid, p_decimals integer)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select round(p_net * rate / 100, p_decimals) from public.tax_rates where id = p_tax_rate_id), 0);
$$;

-- أمر شراء. p_lines: [{description, account_id, department_id?, quantity, unit_price, tax_rate_id?}]
create or replace function public.create_purchase_order(
  p_hotel_id uuid, p_vendor_id uuid, p_lines jsonb, p_order_date date default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_date date := coalesce(p_order_date, app.today_for_hotel(p_hotel_id));
begin
  perform app.require_permission(p_hotel_id, 'purchases.manage');
  if not exists (select 1 from public.vendors where id = p_vendor_id and hotel_id = p_hotel_id and is_active) then
    raise exception 'Vendor not found or inactive' using errcode = '23503';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A purchase order needs at least one line' using errcode = '22023';
  end if;
  perform set_config('app.system_posting', 'on', true);
  insert into public.purchase_orders (hotel_id, po_number, vendor_id, order_date, notes, created_by)
  values (p_hotel_id, app.next_document_number(p_hotel_id, 'purchase_order', 'PO', v_date), p_vendor_id, v_date,
          nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;
  insert into public.purchase_order_items (po_id, hotel_id, line_no, description, account_id, department_id, quantity, unit_price, tax_rate_id)
  select v_id, p_hotel_id, ord, e ->> 'description', (e ->> 'account_id')::uuid, nullif(e ->> 'department_id', '')::uuid,
         (e ->> 'quantity')::numeric, (e ->> 'unit_price')::numeric, nullif(e ->> 'tax_rate_id', '')::uuid
  from jsonb_array_elements(p_lines) with ordinality as x(e, ord);
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- فاتورة مورد: من سطور مباشرة أو من أمر شراء (p_po_id). تنشئ قيدها:
-- مدين المصروف/الأصل (بمركز تكلفة) + مدين ضريبة المدخلات / دائن ذمم دائنة - موردون
create or replace function public.create_vendor_bill(
  p_hotel_id uuid, p_vendor_id uuid, p_lines jsonb default null, p_po_id uuid default null,
  p_bill_date date default null, p_vendor_invoice_no text default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor   public.vendors%rowtype;
  v_date     date := coalesce(p_bill_date, app.today_for_hotel(p_hotel_id));
  v_dec      smallint := app.currency_decimals(p_hotel_id);
  v_id       uuid;
  v_lines    jsonb := p_lines;
  v_je_lines jsonb;
  v_sub      numeric;
  v_tax      numeric;
begin
  perform app.require_permission(p_hotel_id, 'bills.create');
  select * into v_vendor from public.vendors where id = p_vendor_id and hotel_id = p_hotel_id and is_active;
  if not found then
    raise exception 'Vendor not found or inactive' using errcode = '23503';
  end if;

  if p_po_id is not null then
    if not exists (select 1 from public.purchase_orders where id = p_po_id and hotel_id = p_hotel_id
                   and vendor_id = p_vendor_id and status = 'open') then
      raise exception 'Purchase order not found or not open' using errcode = '23503';
    end if;
    select jsonb_agg(jsonb_build_object('description', description, 'account_id', account_id, 'department_id', department_id,
                                        'quantity', quantity, 'unit_price', unit_price, 'tax_rate_id', tax_rate_id) order by line_no)
      into v_lines from public.purchase_order_items where po_id = p_po_id;
  end if;
  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'A bill needs at least one line' using errcode = '22023';
  end if;

  perform set_config('app.system_posting', 'on', true);
  insert into public.vendor_bills (hotel_id, bill_number, vendor_id, vendor_invoice_no, po_id, bill_date, due_date,
                                   subtotal, tax_total, total, notes, created_by)
  values (p_hotel_id, app.next_document_number(p_hotel_id, 'vendor_bill', 'VB', v_date), p_vendor_id,
          nullif(trim(p_vendor_invoice_no), ''), p_po_id, v_date, v_date + v_vendor.payment_terms_days,
          0, 0, 0, nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;

  insert into public.vendor_bill_lines (bill_id, hotel_id, line_no, description, account_id, department_id,
                                        quantity, unit_price, net_amount, tax_rate_id, tax_amount)
  select v_id, p_hotel_id, ord, coalesce(nullif(trim(e ->> 'description'), ''), '-'),
         (e ->> 'account_id')::uuid, nullif(e ->> 'department_id', '')::uuid,
         (e ->> 'quantity')::numeric, (e ->> 'unit_price')::numeric,
         round((e ->> 'quantity')::numeric * (e ->> 'unit_price')::numeric, v_dec),
         nullif(e ->> 'tax_rate_id', '')::uuid,
         app.purchase_line_tax(round((e ->> 'quantity')::numeric * (e ->> 'unit_price')::numeric, v_dec),
                               nullif(e ->> 'tax_rate_id', '')::uuid, v_dec)
  from jsonb_array_elements(v_lines) with ordinality as x(e, ord);

  -- كل الحسابات تفصيلية ومن نفس الفندق (المصروف/الأصل/المخزون)
  perform app.assert_account(p_hotel_id, l.account_id, array['asset', 'expense']::public.account_type[])
  from public.vendor_bill_lines l where l.bill_id = v_id;
  if exists (select 1 from public.vendor_bill_lines where bill_id = v_id and (quantity <= 0 or unit_price <= 0)) then
    raise exception 'Invalid quantity or price' using errcode = '22023';
  end if;

  select sum(net_amount), sum(tax_amount) into v_sub, v_tax from public.vendor_bill_lines where bill_id = v_id;
  update public.vendor_bills set subtotal = v_sub, tax_total = v_tax, total = v_sub + v_tax where id = v_id;

  -- القيد: ضريبة القيمة المضافة ⇒ مدخلات قابلة للاسترداد، غيرها يُضاف إلى المصروف
  select jsonb_agg(x) into v_je_lines from (
    select jsonb_build_object('account_id', l.account_id, 'department_id', l.department_id, 'description', l.description,
             'debit', l.net_amount + case when t.kind = 'vat' then 0 else l.tax_amount end) as x
    from public.vendor_bill_lines l left join public.tax_rates t on t.id = l.tax_rate_id
    where l.bill_id = v_id
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'vat_input'), 'debit', sum(l.tax_amount))
    from public.vendor_bill_lines l join public.tax_rates t on t.id = l.tax_rate_id and t.kind = 'vat'
    where l.bill_id = v_id having sum(l.tax_amount) > 0
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'ap_control'), 'credit', v_sub + v_tax)
  ) s;

  update public.vendor_bills
     set journal_entry_id = app.post_system_entry(p_hotel_id, v_date, 'فاتورة مورد / Vendor bill — ' || v_vendor.name_ar,
                                                  'vendor_bill', v_id, coalesce(nullif(trim(p_vendor_invoice_no), ''), v_vendor.code), v_je_lines)
   where id = v_id;
  perform set_config('app.system_posting', 'on', true);
  if p_po_id is not null then
    update public.purchase_orders set status = 'billed' where id = p_po_id;
  end if;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

create or replace function app.refresh_bill_paid(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid numeric;
begin
  select coalesce(sum(a.amount), 0) into v_paid
  from public.bill_payment_allocations a join public.payments p on p.id = a.payment_id and p.status = 'posted'
  where a.bill_id = p_bill_id;
  update public.vendor_bills
     set amount_paid = v_paid,
         status = case when v_paid >= total then 'paid' when v_paid = 0 then 'open' else 'partially_paid' end::public.bill_status
   where id = p_bill_id;
end;
$$;

-- سداد مورد: سند صرف (مدين ذمم دائنة / دائن طريقة الدفع) مع تخصيص على فواتيره.
-- p_allocations: [{bill_id, amount}] — مجموعها يساوي مبلغ السند (لا دفعات مقدمة للموردين في هذه المرحلة)
create or replace function public.pay_vendor(
  p_hotel_id uuid, p_vendor_id uuid, p_payment_method_id uuid, p_allocations jsonb,
  p_payment_date date default null, p_reference text default null, p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor  public.vendors%rowtype;
  v_method  public.payment_methods%rowtype;
  v_date    date := coalesce(p_payment_date, app.today_for_hotel(p_hotel_id));
  v_amount  numeric;
  v_id      uuid;
  v_number  text;
  v_a       jsonb;
  v_bill    public.vendor_bills%rowtype;
begin
  perform app.require_permission(p_hotel_id, 'payments.disbursement');
  select * into v_vendor from public.vendors where id = p_vendor_id and hotel_id = p_hotel_id;
  if not found then
    raise exception 'Vendor not found' using errcode = '23503';
  end if;
  v_method := app.active_payment_method(p_hotel_id, p_payment_method_id);
  if v_method.kind = 'city_ledger' then
    raise exception 'Vouchers require a cash or bank payment method' using errcode = '23514';
  end if;
  select sum((e ->> 'amount')::numeric) into v_amount from jsonb_array_elements(coalesce(p_allocations, '[]')) e;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Select at least one bill to pay' using errcode = '22023';
  end if;

  perform set_config('app.system_posting', 'on', true);
  v_number := app.next_document_number(p_hotel_id, 'voucher_disbursement', 'PV', v_date);
  insert into public.payments (hotel_id, voucher_number, voucher_type, party_type, payment_date, payment_method_id,
                               amount, vendor_id, party_name, reference, description, created_by)
  values (p_hotel_id, v_number, 'disbursement', 'vendor', v_date, v_method.id, v_amount, v_vendor.id, v_vendor.name_ar,
          nullif(trim(p_reference), ''), coalesce(nullif(trim(p_description), ''), 'سداد مورد / Vendor payment'), auth.uid())
  returning id into v_id;

  for v_a in select * from jsonb_array_elements(p_allocations) loop
    select * into v_bill from public.vendor_bills
     where id = (v_a ->> 'bill_id')::uuid and hotel_id = p_hotel_id and vendor_id = v_vendor.id for update;
    if not found then
      raise exception 'Bill not found for this vendor' using errcode = '23503';
    end if;
    if (v_a ->> 'amount')::numeric <= 0 or (v_a ->> 'amount')::numeric > v_bill.total - v_bill.amount_paid then
      raise exception 'Allocation for bill % must be between 0 and %', v_bill.bill_number, v_bill.total - v_bill.amount_paid
        using errcode = '23514';
    end if;
    insert into public.bill_payment_allocations (payment_id, bill_id, hotel_id, amount)
    values (v_id, v_bill.id, p_hotel_id, (v_a ->> 'amount')::numeric);
    perform app.refresh_bill_paid(v_bill.id);
  end loop;

  update public.payments
     set journal_entry_id = app.post_system_entry(p_hotel_id, v_date, 'سداد مورد / Vendor payment — ' || v_vendor.name_ar,
           'payment', v_id, v_number, jsonb_build_array(
             jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'ap_control'), 'debit', v_amount),
             jsonb_build_object('account_id', v_method.account_id, 'credit', v_amount)))
   where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- إلغاء السند (يستبدل نسخة المرحلة 2): يعيد احتساب فواتير العملاء والموردين المرتبطة
create or replace function public.void_payment_voucher(p_payment_id uuid, p_reason text, p_date date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_je      uuid;
  v_id      uuid;
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
  if v_payment.voucher_type = 'receipt' and v_payment.customer_id is not null
     and app.customer_unapplied_credit(v_payment.customer_id)
         - (v_payment.amount - coalesce((select sum(amount) from public.payment_allocations where payment_id = v_payment.id), 0)) < 0 then
    raise exception 'Voiding would leave a negative customer credit; void the related refund first' using errcode = '23514';
  end if;

  v_je := app.reverse_system_entry(v_payment.journal_entry_id, coalesce(p_date, app.today_for_hotel(v_payment.hotel_id)),
            'إلغاء سند / Void ' || v_payment.voucher_number || ' — ' || trim(p_reason));

  perform set_config('app.system_posting', 'on', true);
  update public.payments
     set status = 'voided', void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid(), void_journal_entry_id = v_je
   where id = v_payment.id;
  for v_id in select invoice_id from public.payment_allocations where payment_id = v_payment.id loop
    perform app.refresh_invoice_paid(v_id);
  end loop;
  for v_id in select bill_id from public.bill_payment_allocations where payment_id = v_payment.id loop
    perform app.refresh_bill_paid(v_id);
  end loop;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- الرواتب (تكامل مبسط): مسيّر شهري بسطور موظفين
-- القيد: مدين الرواتب (أساسي) + البدلات + تأمينات حصة المنشأة (بمركز تكلفة القسم)
--        دائن رواتب مستحقة (الصافي) + مصروفات مستحقة (التأمينات بحصتيها) + الرواتب (الخصومات)
-- السداد لاحقًا بسند صرف على حساب "رواتب مستحقة".
-- -----------------------------------------------------------------------------
create table public.payroll_runs (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hotels(id),
  run_number        text not null,
  period_month      date not null check (extract(day from period_month) = 1),
  posting_date      date not null,
  total_gross       numeric(19, 4) not null,
  total_net         numeric(19, 4) not null,
  journal_entry_id  uuid references public.journal_entries(id),
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  unique (hotel_id, run_number),
  unique (hotel_id, period_month),
  unique (hotel_id, id)
);

create table public.payroll_lines (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null,
  hotel_id             uuid not null,
  employee_name        text not null,
  employee_code        text,
  department_id        uuid not null,
  basic                numeric(19, 4) not null default 0 check (basic >= 0),
  allowances           numeric(19, 4) not null default 0 check (allowances >= 0),
  deductions           numeric(19, 4) not null default 0 check (deductions >= 0),
  insurance_employee   numeric(19, 4) not null default 0 check (insurance_employee >= 0),
  insurance_employer   numeric(19, 4) not null default 0 check (insurance_employer >= 0),
  net_pay              numeric(19, 4) generated always as (basic + allowances - deductions - insurance_employee) stored,
  foreign key (hotel_id, run_id) references public.payroll_runs (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  constraint payroll_net_positive check (basic + allowances - deductions - insurance_employee >= 0)
);

create trigger payroll_runs_system_only before insert or update or delete on public.payroll_runs
  for each row execute function app.system_write_only();
create trigger payroll_lines_system_only before insert or update or delete on public.payroll_lines
  for each row execute function app.system_write_only();

-- p_lines: [{employee_name, employee_code?, department_id, basic, allowances, deductions, insurance_employee, insurance_employer}]
create or replace function public.post_payroll(
  p_hotel_id uuid, p_period_month date, p_lines jsonb, p_posting_date date default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_period_month)::date;
  v_date  date := coalesce(p_posting_date, (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date);
  v_id    uuid;
  v_lines jsonb;
begin
  perform app.require_permission(p_hotel_id, 'payroll.manage');
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Payroll needs at least one employee line' using errcode = '22023';
  end if;

  perform set_config('app.system_posting', 'on', true);
  insert into public.payroll_runs (hotel_id, run_number, period_month, posting_date, total_gross, total_net, notes, created_by)
  values (p_hotel_id, app.next_document_number(p_hotel_id, 'payroll', 'PR', v_date), v_month, v_date, 0, 0,
          nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;

  insert into public.payroll_lines (run_id, hotel_id, employee_name, employee_code, department_id, basic, allowances,
                                    deductions, insurance_employee, insurance_employer)
  select v_id, p_hotel_id, e ->> 'employee_name', nullif(e ->> 'employee_code', ''), (e ->> 'department_id')::uuid,
         coalesce((e ->> 'basic')::numeric, 0), coalesce((e ->> 'allowances')::numeric, 0),
         coalesce((e ->> 'deductions')::numeric, 0), coalesce((e ->> 'insurance_employee')::numeric, 0),
         coalesce((e ->> 'insurance_employer')::numeric, 0)
  from jsonb_array_elements(p_lines) e;

  update public.payroll_runs r
     set total_gross = s.gross, total_net = s.net
    from (select sum(basic + allowances) as gross, sum(net_pay) as net from public.payroll_lines where run_id = v_id) s
   where r.id = v_id;

  -- سطور القيد مجمّعة لكل قسم (مركز تكلفة)
  select jsonb_agg(x) into v_lines from (
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'salaries'), 'department_id', department_id, 'debit', sum(basic)) as x
      from public.payroll_lines where run_id = v_id group by department_id
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'benefits'), 'department_id', department_id, 'debit', sum(allowances))
      from public.payroll_lines where run_id = v_id group by department_id
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'social_insurance'), 'department_id', department_id, 'debit', sum(insurance_employer))
      from public.payroll_lines where run_id = v_id group by department_id
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'salaries'), 'department_id', department_id, 'credit', sum(deductions))
      from public.payroll_lines where run_id = v_id group by department_id
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'accrued_salaries'), 'credit', sum(net_pay))
      from public.payroll_lines where run_id = v_id
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'accrued_expenses'), 'credit', sum(insurance_employee + insurance_employer))
      from public.payroll_lines where run_id = v_id
  ) s;

  update public.payroll_runs
     set journal_entry_id = app.post_system_entry(p_hotel_id, v_date, 'مسيّر رواتب / Payroll ' || to_char(v_month, 'YYYY-MM'),
                                                  'payroll', v_id, to_char(v_month, 'YYYY-MM'), v_lines)
   where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- الإشعار الدائن على فاتورة آجلة: يخفّض المستحق ويعكس الإيراد والضريبة بالنسبة
-- -----------------------------------------------------------------------------
create table public.credit_notes (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hotels(id),
  credit_note_number text not null,
  invoice_id        uuid not null,
  issue_date        date not null,
  net_amount        numeric(19, 4) not null,
  tax_amount        numeric(19, 4) not null,
  total             numeric(19, 4) not null check (total > 0),
  reason            text not null,
  journal_entry_id  uuid references public.journal_entries(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  unique (hotel_id, credit_note_number),
  foreign key (hotel_id, invoice_id) references public.invoices (hotel_id, id),
  constraint cn_totals check (net_amount + tax_amount = total)
);
create trigger credit_notes_system_only before insert or update or delete on public.credit_notes
  for each row execute function app.system_write_only();

create or replace function public.create_credit_note(p_invoice_id uuid, p_amount numeric, p_reason text, p_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv   public.invoices%rowtype;
  v_dec   smallint;
  v_tax   numeric;
  v_net   numeric;
  v_date  date;
  v_id    uuid;
  v_lines jsonb;
  v_left  numeric;
  r       record;
  v_part  numeric;
  i       integer := 0;
  n       integer;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_inv.hotel_id, 'invoices.credit_note');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > v_inv.amount_due - v_inv.amount_paid then
    raise exception 'Credit note must be between 0 and the outstanding amount (%)', v_inv.amount_due - v_inv.amount_paid
      using errcode = '23514';
  end if;
  v_dec := app.currency_decimals(v_inv.hotel_id);
  v_date := coalesce(p_date, app.today_for_hotel(v_inv.hotel_id));
  v_tax := case when v_inv.total = 0 then 0 else round(p_amount * v_inv.tax_total / v_inv.total, v_dec) end;
  v_net := p_amount - v_tax;

  perform set_config('app.system_posting', 'on', true);
  insert into public.credit_notes (hotel_id, credit_note_number, invoice_id, issue_date, net_amount, tax_amount, total, reason, created_by)
  values (v_inv.hotel_id, app.next_document_number(v_inv.hotel_id, 'credit_note', 'CN', v_date), v_inv.id, v_date,
          v_net, v_tax, p_amount, trim(p_reason), auth.uid())
  returning id into v_id;
  -- المستحق يقل بقيمة الإشعار
  update public.invoices set amount_due = amount_due - p_amount where id = v_inv.id;
  perform app.refresh_invoice_paid(v_inv.id);

  -- توزيع ضريبة الإشعار على ضرائب الفاتورة بالنسبة (الأخير يأخذ فرق التقريب)
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', app.account_by_key(v_inv.hotel_id, 'revenue_discounts'), 'debit', v_net),
    jsonb_build_object('account_id', app.account_by_key(v_inv.hotel_id, 'ar_control'), 'credit', p_amount));
  v_left := v_tax;
  select count(*) into n from public.invoice_taxes where invoice_id = v_inv.id and amount <> 0;
  for r in select it.amount, t.account_id from public.invoice_taxes it join public.tax_rates t on t.id = it.tax_rate_id
           where it.invoice_id = v_inv.id and it.amount <> 0 order by t.code loop
    i := i + 1;
    v_part := case when i = n then v_left else round(v_tax * r.amount / v_inv.tax_total, v_dec) end;
    v_left := v_left - v_part;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', r.account_id, 'debit', v_part));
  end loop;

  update public.credit_notes
     set journal_entry_id = app.post_system_entry(v_inv.hotel_id, v_date, 'إشعار دائن / Credit note — ' || v_inv.invoice_number,
                                                  'invoice', v_id, v_inv.invoice_number, v_lines)
   where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- المطابقة البنكية: سطور كشف البنك تُطابق مع سطور القيود المرحّلة على نفس الحساب
-- -----------------------------------------------------------------------------
create table public.bank_statement_lines (
  id                    uuid primary key default gen_random_uuid(),
  hotel_id              uuid not null references public.hotels(id),
  account_id            uuid not null,
  txn_date              date not null,
  description           text not null,
  reference             text,
  -- موجب = إيداع، سالب = سحب
  amount                numeric(19, 4) not null check (amount <> 0),
  matched_line_id       uuid unique references public.journal_entry_lines(id),
  matched_at            timestamptz,
  matched_by            uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id),
  foreign key (hotel_id, account_id) references public.chart_of_accounts (hotel_id, id)
);
create trigger bank_statement_lines_set_created before insert on public.bank_statement_lines
  for each row execute function app.set_created_by();

create or replace function app.bank_lines_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.assert_account(new.hotel_id, new.account_id, array['asset']::public.account_type[]);
    new.matched_line_id := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.matched_line_id is not null then
      raise exception 'Unmatch the statement line before deleting it' using errcode = '23514';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - 'matched_line_id' - 'matched_at' - 'matched_by') <> (to_jsonb(old) - 'matched_line_id' - 'matched_at' - 'matched_by') then
    raise exception 'Statement lines are immutable; delete and re-import' using errcode = '42501';
  end if;
  if new.matched_line_id is not null and new.matched_line_id is distinct from old.matched_line_id and not exists (
    select 1 from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
    where l.id = new.matched_line_id and l.account_id = new.account_id and l.base_debit - l.base_credit = new.amount
  ) then
    raise exception 'Matched ledger line must be a posted line on the same account with the same amount' using errcode = '23514';
  end if;
  new.matched_at := case when new.matched_line_id is null then null else now() end;
  new.matched_by := case when new.matched_line_id is null then null else auth.uid() end;
  return new;
end;
$$;
create trigger bank_lines_guard before insert or update or delete on public.bank_statement_lines
  for each row execute function app.bank_lines_guard();

-- مطابقة تلقائية: نفس المبلغ والحساب، وأقرب تاريخ خلال ±7 أيام
create or replace function public.auto_match_bank_lines(p_hotel_id uuid, p_account_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  s   record;
  v_l uuid;
  n   integer := 0;
begin
  perform app.require_permission(p_hotel_id, 'bank.reconcile');
  for s in select * from public.bank_statement_lines
           where hotel_id = p_hotel_id and account_id = p_account_id and matched_line_id is null order by txn_date loop
    select l.id into v_l
    from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
    where l.account_id = p_account_id and l.base_debit - l.base_credit = s.amount
      and j.entry_date between s.txn_date - 7 and s.txn_date + 7
      and not exists (select 1 from public.bank_statement_lines b where b.matched_line_id = l.id)
    order by abs(j.entry_date - s.txn_date), l.created_at
    limit 1;
    if v_l is not null then
      update public.bank_statement_lines set matched_line_id = v_l where id = s.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- أعمار الذمم (مدينة ودائنة) حتى تاريخ معيّن: حالي، 1-30، 31-60، 61-90، +90 من تاريخ الاستحقاق
-- -----------------------------------------------------------------------------
create or replace function public.aging_report(p_hotel_id uuid, p_kind text, p_as_of date default null)
returns table (party_id uuid, party_name text, document_id uuid, document_number text, document_date date,
               due_date date, outstanding numeric, days_overdue integer, bucket text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_as_of date := coalesce(p_as_of, app.today_for_hotel(p_hotel_id));
begin
  perform app.require_permission(p_hotel_id, 'reports.aging.view');
  if p_kind = 'receivable' then
    return query
    select i.customer_id, c.name_ar, i.id, i.invoice_number, i.issue_date, coalesce(i.due_date, i.issue_date),
           i.amount_due - i.amount_paid, greatest(v_as_of - coalesce(i.due_date, i.issue_date), 0),
           case when v_as_of <= coalesce(i.due_date, i.issue_date) then 'current'
                when v_as_of - coalesce(i.due_date, i.issue_date) <= 30 then '1_30'
                when v_as_of - coalesce(i.due_date, i.issue_date) <= 60 then '31_60'
                when v_as_of - coalesce(i.due_date, i.issue_date) <= 90 then '61_90'
                else 'over_90' end
    from public.invoices i join public.customers c on c.id = i.customer_id
    where i.hotel_id = p_hotel_id and i.amount_due > i.amount_paid and i.issue_date <= v_as_of;
  elsif p_kind = 'payable' then
    return query
    select b.vendor_id, v.name_ar, b.id, b.bill_number, b.bill_date, b.due_date,
           b.total - b.amount_paid, greatest(v_as_of - b.due_date, 0),
           case when v_as_of <= b.due_date then 'current'
                when v_as_of - b.due_date <= 30 then '1_30'
                when v_as_of - b.due_date <= 60 then '31_60'
                when v_as_of - b.due_date <= 90 then '61_90'
                else 'over_90' end
    from public.vendor_bills b join public.vendors v on v.id = b.vendor_id
    where b.hotel_id = p_hotel_id and b.total > b.amount_paid and b.bill_date <= v_as_of;
  else
    raise exception 'kind must be receivable or payable' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- العهدة النثرية: طريقة دفع على حساب الصندوق النثري؛ التعزيز بسند صرف من البنك إلى حساب العهدة
-- -----------------------------------------------------------------------------
insert into public.payment_methods (hotel_id, code, name_ar, name_en, kind, account_id)
select h, 'PETTY', 'العهدة النثرية', 'Petty cash', 'cash', app.account_by_key(h, 'petty_cash')
from (select distinct hotel_id as h from public.chart_of_accounts where system_key = 'petty_cash') x
on conflict (hotel_id, code) do nothing;

create or replace function app.seed_phase3_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code = 'CASH' then
    insert into public.payment_methods (hotel_id, code, name_ar, name_en, kind, account_id)
    values (new.hotel_id, 'PETTY', 'العهدة النثرية', 'Petty cash', 'cash', app.account_by_key(new.hotel_id, 'petty_cash'))
    on conflict (hotel_id, code) do nothing;
  end if;
  return null;
end;
$$;
create trigger payment_methods_seed_petty after insert on public.payment_methods
  for each row execute function app.seed_phase3_defaults();

-- -----------------------------------------------------------------------------
-- RLS وسجل التدقيق والصلاحيات
-- -----------------------------------------------------------------------------
alter table public.vendors                  enable row level security;
alter table public.purchase_orders          enable row level security;
alter table public.purchase_order_items     enable row level security;
alter table public.vendor_bills             enable row level security;
alter table public.vendor_bill_lines        enable row level security;
alter table public.bill_payment_allocations enable row level security;
alter table public.payroll_runs             enable row level security;
alter table public.payroll_lines            enable row level security;
alter table public.credit_notes             enable row level security;
alter table public.bank_statement_lines     enable row level security;

create policy vendors_read on public.vendors for select to authenticated using (app.has_permission(hotel_id, 'vendors.view'));
create policy vendors_write on public.vendors for insert to authenticated with check (app.has_permission(hotel_id, 'vendors.manage'));
create policy vendors_update on public.vendors for update to authenticated
  using (app.has_permission(hotel_id, 'vendors.manage')) with check (app.has_permission(hotel_id, 'vendors.manage'));
create policy po_read on public.purchase_orders for select to authenticated
  using (app.has_permission(hotel_id, 'purchases.manage') or app.has_permission(hotel_id, 'bills.view'));
create policy po_items_read on public.purchase_order_items for select to authenticated
  using (app.has_permission(hotel_id, 'purchases.manage') or app.has_permission(hotel_id, 'bills.view'));
create policy bills_read on public.vendor_bills for select to authenticated using (app.has_permission(hotel_id, 'bills.view'));
create policy bill_lines_read on public.vendor_bill_lines for select to authenticated using (app.has_permission(hotel_id, 'bills.view'));
create policy bill_alloc_read on public.bill_payment_allocations for select to authenticated
  using (app.has_permission(hotel_id, 'bills.view') or app.has_permission(hotel_id, 'payments.view'));
-- الرواتب سرية: فقط لمن يملك صلاحية الرواتب (الكاشير والمدقق لا يرونها)
create policy payroll_runs_read on public.payroll_runs for select to authenticated using (app.has_permission(hotel_id, 'payroll.manage'));
create policy payroll_lines_read on public.payroll_lines for select to authenticated using (app.has_permission(hotel_id, 'payroll.manage'));
create policy credit_notes_read on public.credit_notes for select to authenticated using (app.has_permission(hotel_id, 'invoices.view'));
create policy bank_lines_all on public.bank_statement_lines for all to authenticated
  using (app.has_permission(hotel_id, 'bank.reconcile')) with check (app.has_permission(hotel_id, 'bank.reconcile'));

create trigger audit_vendors after insert or update or delete on public.vendors for each row execute function app.audit_trigger();
create trigger audit_vendor_bills after insert or update on public.vendor_bills for each row execute function app.audit_trigger();
create trigger audit_payroll_runs after insert on public.payroll_runs for each row execute function app.audit_trigger();
create trigger audit_credit_notes after insert on public.credit_notes for each row execute function app.audit_trigger();
create trigger audit_bank_lines after insert or update or delete on public.bank_statement_lines for each row execute function app.audit_trigger();

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
    'public.create_purchase_order(uuid, uuid, jsonb, date, text)',
    'public.create_vendor_bill(uuid, uuid, jsonb, uuid, date, text, text)',
    'public.pay_vendor(uuid, uuid, uuid, jsonb, date, text, text)',
    'public.void_payment_voucher(uuid, text, date)',
    'public.post_payroll(uuid, date, jsonb, date, text)',
    'public.create_credit_note(uuid, numeric, text, date)',
    'public.auto_match_bank_lines(uuid, uuid)',
    'public.aging_report(uuid, text, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

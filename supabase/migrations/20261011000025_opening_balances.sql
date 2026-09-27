-- =============================================================================
-- المرحلة السادسة: الأرصدة الافتتاحية عند الانتقال من نظام سابق
--   - أرصدة الحسابات العامة (الصندوق، البنوك، الأصول، القروض، رأس المال...) بقيد افتتاحي واحد
--   - أرصدة العملاء المدينة كفواتير افتتاحية تُحصَّل لاحقًا بسندات القبض كالمعتاد
--   - أرصدة الموردين الدائنة كفواتير موردين افتتاحية تُسدَّد لاحقًا
--   - فرق الأرصدة يُقفل في الأرباح المبقاة؛ تُرحَّل مرة واحدة فقط وتبقى الدفاتر الفرعية مطابقة للأستاذ
-- =============================================================================

alter type public.invoice_type add value if not exists 'opening';

create or replace function public.post_opening_balances(
  p_hotel_id  uuid,
  p_date      date,
  p_accounts  jsonb default '[]'::jsonb,
  p_customers jsonb default '[]'::jsonb,
  p_vendors   jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dec      smallint;
  v_base     char(3);
  v_je       uuid;
  v_no       integer := 0;
  v_e        jsonb;
  v_acc      public.chart_of_accounts%rowtype;
  v_debit    numeric;
  v_credit   numeric;
  v_amount   numeric;
  v_ar       numeric := 0;
  v_ap       numeric := 0;
  v_dr       numeric := 0;
  v_cr       numeric := 0;
  v_cust     public.customers%rowtype;
  v_vendor   public.vendors%rowtype;
  v_doc      uuid;
  v_retained uuid;
  v_prev     text := coalesce(current_setting('app.system_posting', true), 'off');
begin
  perform app.require_permission(p_hotel_id, 'gl.journal.post');
  perform app.require_permission(p_hotel_id, 'settings.hotel.manage');
  if p_date is null then
    raise exception 'Opening balance date is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.journal_entries where hotel_id = p_hotel_id and source = 'opening' and status = 'posted') then
    raise exception 'Opening balances were already posted' using errcode = '23505';
  end if;
  v_dec := app.currency_decimals(p_hotel_id);
  select base_currency into v_base from public.hotels where id = p_hotel_id;
  v_retained := app.account_by_key(p_hotel_id, 'retained_earnings');

  perform set_config('app.system_posting', 'on', true);
  insert into public.journal_entries
    (hotel_id, entry_date, period_id, description, reference, source, currency_code, exchange_rate)
  values (p_hotel_id, p_date, '00000000-0000-0000-0000-000000000000'::uuid, 'الأرصدة الافتتاحية', 'OPENING', 'opening', v_base, 1)
  returning id into v_je;

  -- 1) أرصدة الحسابات العامة
  for v_e in select * from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) loop
    select * into v_acc from public.chart_of_accounts
     where id = (v_e ->> 'account_id')::uuid and hotel_id = p_hotel_id and is_active and is_postable;
    if v_acc.id is null then
      raise exception 'Account not found, inactive or not postable' using errcode = '23503';
    end if;
    if app.is_control_account(v_acc.id) then
      raise exception 'Account % is a control account; enter customer, vendor or inventory balances in their own lists', v_acc.code
        using errcode = '23514';
    end if;
    v_debit := coalesce(nullif(v_e ->> 'debit', '')::numeric, 0);
    v_credit := coalesce(nullif(v_e ->> 'credit', '')::numeric, 0);
    if v_debit < 0 or v_credit < 0 or (v_debit > 0 and v_credit > 0) or round(v_debit, v_dec) <> v_debit or round(v_credit, v_dec) <> v_credit then
      raise exception 'Each line is either a debit or a credit with at most % decimals', v_dec using errcode = '22023';
    end if;
    continue when v_debit = 0 and v_credit = 0;
    v_no := v_no + 1;
    insert into public.journal_entry_lines (journal_entry_id, hotel_id, line_no, account_id, description, debit, credit)
    values (v_je, p_hotel_id, v_no, v_acc.id, 'رصيد افتتاحي', v_debit, v_credit);
    v_dr := v_dr + v_debit;
    v_cr := v_cr + v_credit;
  end loop;

  -- 2) أرصدة العملاء: فاتورة افتتاحية لكل عميل (ذمة مدينة قابلة للتحصيل)
  for v_e in select * from jsonb_array_elements(coalesce(p_customers, '[]'::jsonb)) loop
    select * into v_cust from public.customers where id = (v_e ->> 'customer_id')::uuid and hotel_id = p_hotel_id;
    if v_cust.id is null then
      raise exception 'Customer not found' using errcode = '23503';
    end if;
    v_amount := nullif(v_e ->> 'amount', '')::numeric;
    if v_amount is null or v_amount <= 0 or round(v_amount, v_dec) <> v_amount then
      raise exception 'Amount must be positive with at most % decimals', v_dec using errcode = '22023';
    end if;
    insert into public.invoices (hotel_id, invoice_number, invoice_type, customer_id, bill_to_name, bill_to_tax_number,
                                 issue_date, due_date, currency_code, subtotal, tax_total, total, amount_due, status,
                                 journal_entry_id, notes, created_by)
    values (p_hotel_id, app.next_document_number(p_hotel_id, 'opening_invoice', 'OB', p_date), 'opening', v_cust.id, v_cust.name_ar,
            v_cust.tax_number, p_date, p_date, v_base, v_amount, 0, v_amount, v_amount, 'issued', v_je,
            coalesce(nullif(trim(v_e ->> 'reference'), ''), 'رصيد افتتاحي'), auth.uid())
    returning id into v_doc;
    insert into public.invoice_items (invoice_id, hotel_id, line_no, business_date, description, quantity, unit_price, net_amount, tax_amount, total_amount)
    values (v_doc, p_hotel_id, 1, p_date, 'رصيد افتتاحي' || coalesce(' — ' || nullif(trim(v_e ->> 'reference'), ''), ''), 1, v_amount, v_amount, 0, v_amount);
    v_ar := v_ar + v_amount;
  end loop;

  -- 3) أرصدة الموردين: فاتورة مورد افتتاحية (ذمة دائنة قابلة للسداد)
  for v_e in select * from jsonb_array_elements(coalesce(p_vendors, '[]'::jsonb)) loop
    select * into v_vendor from public.vendors where id = (v_e ->> 'vendor_id')::uuid and hotel_id = p_hotel_id;
    if v_vendor.id is null then
      raise exception 'Vendor not found or inactive' using errcode = '23503';
    end if;
    v_amount := nullif(v_e ->> 'amount', '')::numeric;
    if v_amount is null or v_amount <= 0 or round(v_amount, v_dec) <> v_amount then
      raise exception 'Amount must be positive with at most % decimals', v_dec using errcode = '22023';
    end if;
    insert into public.vendor_bills (hotel_id, bill_number, vendor_id, vendor_invoice_no, bill_date, due_date,
                                     subtotal, tax_total, total, journal_entry_id, notes, created_by)
    values (p_hotel_id, app.next_document_number(p_hotel_id, 'opening_bill', 'OBV', p_date), v_vendor.id,
            nullif(trim(v_e ->> 'reference'), ''), p_date, p_date, v_amount, 0, v_amount, v_je, 'رصيد افتتاحي', auth.uid())
    returning id into v_doc;
    insert into public.vendor_bill_lines (bill_id, hotel_id, line_no, description, account_id, quantity, unit_price, net_amount, tax_amount)
    values (v_doc, p_hotel_id, 1, 'رصيد افتتاحي', v_retained, 1, v_amount, v_amount, 0);
    v_ap := v_ap + v_amount;
  end loop;

  if v_ar > 0 then
    v_no := v_no + 1;
    insert into public.journal_entry_lines (journal_entry_id, hotel_id, line_no, account_id, description, debit, credit)
    values (v_je, p_hotel_id, v_no, app.account_by_key(p_hotel_id, 'ar_control'), 'أرصدة العملاء الافتتاحية', v_ar, 0);
  end if;
  if v_ap > 0 then
    v_no := v_no + 1;
    insert into public.journal_entry_lines (journal_entry_id, hotel_id, line_no, account_id, description, debit, credit)
    values (v_je, p_hotel_id, v_no, app.account_by_key(p_hotel_id, 'ap_control'), 'أرصدة الموردين الافتتاحية', 0, v_ap);
  end if;
  if v_no = 0 then
    raise exception 'Enter at least one opening balance' using errcode = '22023';
  end if;

  -- الفرق يُقفل في الأرباح المبقاة
  v_amount := (v_dr + v_ar) - (v_cr + v_ap);
  if v_amount <> 0 then
    v_no := v_no + 1;
    insert into public.journal_entry_lines (journal_entry_id, hotel_id, line_no, account_id, description, debit, credit)
    values (v_je, p_hotel_id, v_no, v_retained, 'فرق الأرصدة الافتتاحية',
            case when v_amount < 0 then -v_amount else 0 end, case when v_amount > 0 then v_amount else 0 end);
  end if;

  update public.journal_entries set status = 'posted' where id = v_je;
  perform set_config('app.system_posting', v_prev, true);
  return v_je;
end;
$$;

revoke execute on function public.post_opening_balances(uuid, date, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.post_opening_balances(uuid, date, jsonb, jsonb, jsonb) to authenticated;

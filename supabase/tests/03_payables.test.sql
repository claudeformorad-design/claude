-- =============================================================================
-- اختبارات المرحلة 3: المشتريات والموردون، الرواتب، العهدة، الإشعار الدائن، البنك، الأعمار
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'gm3@hotel.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'cashier3@hotel.test');

create or replace function pg_temp.expect_error(p_sql text, p_contains text)
returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(p_contains in sqlerrm) = 0 then raise exception 'Expected "%", got "%"', p_contains, sqlerrm; end if;
    return;
  end;
  raise exception 'Expected error "%", but succeeded: %', p_contains, p_sql;
end $$;
create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  if p_user is null then reset role; else set role authenticated; end if;
end $$;
create or replace function pg_temp.gl(p_hotel uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  join public.chart_of_accounts a on a.id = l.account_id
  where l.hotel_id = p_hotel and a.system_key = p_key;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
create temp table h3 as select public.create_hotel('فندق المرحلة 3', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h3, ids to authenticated;

insert into public.hotel_members (hotel_id, user_id) select id, '00000000-0000-0000-0000-0000000000c2' from h3;
insert into public.user_hotel_roles (hotel_id, user_id, role_id)
select (select id from h3), '00000000-0000-0000-0000-0000000000c2', id from public.roles where is_system and code = 'cashier';

insert into public.tax_rates (hotel_id, code, name_ar, kind, rate, account_id)
select id, 'VAT', 'ض.ق.م', 'vat', 15, (select c.id from public.chart_of_accounts c where c.hotel_id = h3.id and system_key = 'vat_output') from h3;
insert into public.vendors (hotel_id, code, name_ar, payment_terms_days) select id, 'FOODCO', 'مورد الأغذية', 30 from h3;
insert into ids select 'vat', id from public.tax_rates where hotel_id = (select id from h3);
insert into ids select 'vendor', id from public.vendors where hotel_id = (select id from h3);
insert into ids select 'acc_' || code, id from public.chart_of_accounts where hotel_id = (select id from h3) and code in ('1120', '5204', '5201', '2103', '1103', '1102');
insert into ids select 'dept_' || lower(code), id from public.departments where hotel_id = (select id from h3);
insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h3);

do $$ begin assert (select v from ids where k = 'pm_petty') is not null, 'petty cash method seeded'; end $$;

-- =============================================================================
-- السيناريو 3: أمر شراء → فاتورة مورد → ذمة دائنة → سداد
-- =============================================================================
insert into ids select 'po', public.create_purchase_order((select id from h3), (select v from ids where k = 'vendor'),
  jsonb_build_array(jsonb_build_object('description', 'لحوم وخضار', 'account_id', (select v from ids where k = 'acc_1120'),
    'department_id', (select v from ids where k = 'dept_fnb'), 'quantity', 10, 'unit_price', 200, 'tax_rate_id', (select v from ids where k = 'vat'))));
insert into ids select 'bill', public.create_vendor_bill((select id from h3), (select v from ids where k = 'vendor'),
  p_po_id => (select v from ids where k = 'po'), p_vendor_invoice_no => 'S-100');

select pg_temp.act_as(null);
do $$
declare h uuid := (select id from h3); b public.vendor_bills%rowtype;
begin
  select * into b from public.vendor_bills where id = (select v from ids where k = 'bill');
  assert b.subtotal = 2000 and b.tax_total = 300 and b.total = 2300 and b.status = 'open', 'bill totals';
  assert b.due_date = b.bill_date + 30, 'due date';
  assert (select status from public.purchase_orders where id = (select v from ids where k = 'po')) = 'billed', 'PO billed';
  assert pg_temp.gl(h, 'inventory_food') = 2000, 'inventory debited';
  assert pg_temp.gl(h, 'vat_input') = 300, 'input VAT';
  assert pg_temp.gl(h, 'ap_control') = -2300, 'AP credited';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');

-- نفس رقم فاتورة المورد مرتين مرفوض، وأمر الشراء لا يُفوتر مرتين
select pg_temp.expect_error($q$
  select public.create_vendor_bill((select id from h3), (select v from ids where k = 'vendor'),
    jsonb_build_array(jsonb_build_object('description', 'x', 'account_id', (select v from ids where k = 'acc_5204'), 'quantity', 1, 'unit_price', 5)),
    p_vendor_invoice_no => 'S-100')
$q$, 'duplicate key');
select pg_temp.expect_error($q$
  select public.create_vendor_bill((select id from h3), (select v from ids where k = 'vendor'), p_po_id => (select v from ids where k = 'po'))
$q$, 'not open');

-- سداد جزئي ثم كامل
insert into ids select 'pv1', public.pay_vendor((select id from h3), (select v from ids where k = 'vendor'), (select v from ids where k = 'pm_bank'),
  jsonb_build_array(jsonb_build_object('bill_id', (select v from ids where k = 'bill'), 'amount', 1000)));
select pg_temp.expect_error($q$
  select public.pay_vendor((select id from h3), (select v from ids where k = 'vendor'), (select v from ids where k = 'pm_bank'),
    jsonb_build_array(jsonb_build_object('bill_id', (select v from ids where k = 'bill'), 'amount', 1301)))
$q$, 'must be between');
select public.pay_vendor((select id from h3), (select v from ids where k = 'vendor'), (select v from ids where k = 'pm_bank'),
  jsonb_build_array(jsonb_build_object('bill_id', (select v from ids where k = 'bill'), 'amount', 1300)));

select pg_temp.act_as(null);
do $$
begin
  assert (select status from public.vendor_bills where id = (select v from ids where k = 'bill')) = 'paid', 'bill paid';
  assert pg_temp.gl((select id from h3), 'ap_control') = 0, 'AP cleared';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');

-- إلغاء سند سداد يعيد الفاتورة لمسددة جزئيًا
select public.void_payment_voucher((select v from ids where k = 'pv1'), 'خطأ بنكي');
select pg_temp.act_as(null);
do $$
begin
  assert (select status from public.vendor_bills where id = (select v from ids where k = 'bill')) = 'partially_paid', 'void restores bill';
  assert pg_temp.gl((select id from h3), 'ap_control') = -1000, 'AP after void';
  -- الثابت: الذمم الدائنة في الأستاذ = المتبقي على فواتير الموردين
  assert -pg_temp.gl((select id from h3), 'ap_control') = (select sum(total - amount_paid) from public.vendor_bills where hotel_id = (select id from h3)), 'AP = subledger';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');

-- =============================================================================
-- السيناريو 4: الرواتب ثم صرفها
-- =============================================================================
insert into ids select 'payroll', public.post_payroll((select id from h3), date_trunc('month', current_date)::date,
  jsonb_build_array(
    jsonb_build_object('employee_name', 'موظف استقبال', 'department_id', (select v from ids where k = 'dept_rooms'),
      'basic', 5000, 'allowances', 1500, 'deductions', 200, 'insurance_employee', 450, 'insurance_employer', 600),
    jsonb_build_object('employee_name', 'طاهٍ', 'department_id', (select v from ids where k = 'dept_fnb'),
      'basic', 6000, 'allowances', 1000, 'deductions', 0, 'insurance_employee', 540, 'insurance_employer', 720)),
  current_date);
select pg_temp.expect_error($q$
  select public.post_payroll((select id from h3), date_trunc('month', current_date)::date,
    jsonb_build_array(jsonb_build_object('employee_name', 'x', 'department_id', (select v from ids where k = 'dept_rooms'), 'basic', 1)), current_date)
$q$, 'duplicate key');

select pg_temp.act_as(null);
do $$
declare h uuid := (select id from h3);
begin
  -- الصافي = 5000+1500-200-450 + 6000+1000-540 = 12310
  assert (select total_net from public.payroll_runs where id = (select v from ids where k = 'payroll')) = 12310, 'net pay';
  assert pg_temp.gl(h, 'accrued_salaries') = -12310, 'accrued salaries';
  assert pg_temp.gl(h, 'accrued_expenses') = -2310, 'insurance payable';
  -- تكلفة الرواتب لقسم الغرف = 5000 − 200 + 1500 + 600
  assert (select sum(l.debit - l.credit) from public.journal_entry_lines l
          join public.chart_of_accounts a on a.id = l.account_id and a.system_key in ('salaries', 'benefits', 'social_insurance')
          where l.department_id = (select v from ids where k = 'dept_rooms')) = 6900, 'rooms payroll cost';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');

-- صرف الرواتب بسند صرف على حساب الرواتب المستحقة
select public.create_payment_voucher((select id from h3), 'disbursement', 'account', (select v from ids where k = 'pm_bank'), 12310,
  'صرف رواتب الشهر', p_counter_account_id => (select v from ids where k = 'acc_2103'));

-- الكاشير لا يرى الرواتب
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
do $$ begin assert (select count(*) from public.payroll_runs) = 0 and (select count(*) from public.payroll_lines) = 0, 'payroll hidden from cashier'; end $$;
select pg_temp.expect_error($q$
  select public.post_payroll((select id from h3), '2000-01-01', '[{"employee_name":"x"}]'::jsonb)
$q$, 'Permission denied');

-- =============================================================================
-- العهدة النثرية: تعزيز من البنك ثم مصروف منها
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select public.create_payment_voucher((select id from h3), 'disbursement', 'account', (select v from ids where k = 'pm_bank'), 1000,
  'تعزيز العهدة', p_counter_account_id => (select v from ids where k = 'acc_1102'));
select public.create_payment_voucher((select id from h3), 'disbursement', 'account', (select v from ids where k = 'pm_petty'), 150,
  'مستلزمات صيانة', p_counter_account_id => (select id from public.chart_of_accounts where hotel_id = (select id from h3) and code = '5208'),
  p_department_id => (select v from ids where k = 'dept_maint'));
select pg_temp.act_as(null);
do $$ begin assert pg_temp.gl((select id from h3), 'petty_cash') = 850, 'petty cash balance'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');

-- =============================================================================
-- الإشعار الدائن على فاتورة آجلة
-- =============================================================================
insert into public.customers (hotel_id, code, name_ar, allow_credit) select id, 'CORP', 'شركة', true from h3;
insert into public.charge_code_taxes (hotel_id, charge_code_id, tax_rate_id)
select (select id from h3), c.id, (select v from ids where k = 'vat') from public.charge_codes c where c.hotel_id = (select id from h3) and c.code = 'EVENTS';
insert into ids select 'inv', public.create_direct_invoice((select id from h3),
  (select id from public.customers where hotel_id = (select id from h3) and code = 'CORP'),
  jsonb_build_array(jsonb_build_object('charge_code_id', (select id from public.charge_codes where hotel_id = (select id from h3) and code = 'EVENTS'), 'unit_price', 1000)));
select public.create_credit_note((select v from ids where k = 'inv'), 230, 'خصم تجاري بعد الإصدار');
select pg_temp.expect_error($q$ select public.create_credit_note((select v from ids where k = 'inv'), 1000, 'زيادة') $q$, 'outstanding amount');

select pg_temp.act_as(null);
do $$
declare h uuid := (select id from h3);
begin
  assert (select amount_due from public.invoices where id = (select v from ids where k = 'inv')) = 920, 'due reduced';
  assert (select net_amount = 200 and tax_amount = 30 from public.credit_notes where invoice_id = (select v from ids where k = 'inv')), 'credit note split';
  assert -pg_temp.gl(h, 'vat_output') = 120, 'VAT output net of credit note';
  assert pg_temp.gl(h, 'ar_control') = 920, 'AR = invoice outstanding';
  -- خصم الإشعار يحمل قسم البند ⇒ صافي إيراد القسم = 1000 − 200 ولا يوجد إيراد بلا قسم
  assert (select sum(amount) from public.department_profitability(h, current_date, current_date)
          where account_type = 'revenue' and department_id = (select department_id from public.invoice_items
                                                               where invoice_id = (select v from ids where k = 'inv'))) = 800, 'dept revenue net of credit note';
  assert not exists (select 1 from public.department_profitability(h, current_date, current_date)
                     where account_type = 'revenue' and department_id is null), 'no unassigned revenue';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');

-- =============================================================================
-- المطابقة البنكية
-- =============================================================================
insert into public.bank_statement_lines (hotel_id, account_id, txn_date, description, amount)
select id, (select v from ids where k = 'acc_1103'), current_date, 'Transfer to vendor', -1300 from h3;
insert into public.bank_statement_lines (hotel_id, account_id, txn_date, description, amount)
select id, (select v from ids where k = 'acc_1103'), current_date, 'Bank fee', -25 from h3;
do $$ begin
  assert public.auto_match_bank_lines((select id from h3), (select v from ids where k = 'acc_1103')) = 1, 'one auto match';
  assert (select count(*) from public.bank_statement_lines where matched_line_id is null) = 1, 'fee unmatched';
end $$;
-- مطابقة يدوية بمبلغ مختلف مرفوضة
select pg_temp.expect_error($q$
  update public.bank_statement_lines set matched_line_id = (
    select l.id from public.journal_entry_lines l where l.account_id = (select v from ids where k = 'acc_1103') limit 1)
  where amount = -25
$q$, 'same amount');

-- =============================================================================
-- أعمار الذمم
-- =============================================================================
do $$
begin
  assert (select sum(outstanding) from public.aging_report((select id from h3), 'payable')) = 1000, 'AP aging';
  assert (select bucket from public.aging_report((select id from h3), 'payable', current_date + 45)) = '1_30', 'AP bucket';
  assert (select sum(outstanding) from public.aging_report((select id from h3), 'receivable', current_date + 120)) = 920, 'AR aging';
  assert (select bucket from public.aging_report((select id from h3), 'receivable', current_date + 125)) = 'over_90', 'AR bucket';
end $$;

select pg_temp.act_as(null);
do $$ begin
  assert (select sum(debit) = sum(credit) from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id
          and j.status = 'posted' where l.hotel_id = (select id from h3)), 'GL balanced';
end $$;


-- ثابت عام: كل حسابات المراقبة تطابق دفاترها الفرعية وميزان المراجعة متوازن لكل فندق في هذا الاختبار
select pg_temp.act_as(null);
do $$
declare r record;
begin
  for r in select h.id, h.name_ar, x.* from public.hotels h cross join lateral public.ledger_reconciliation(h.id) x loop
    assert r.difference = 0, format('reconciliation %s (%s): gl %s, subledger %s, reconciling %s',
      r.control, r.name_ar, r.gl_balance, r.subledger_balance, r.reconciling_items);
  end loop;
end $$;

\o
\echo '  ✓ payables, payroll, petty cash, credit note, bank and aging tests passed'

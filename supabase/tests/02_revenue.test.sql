-- =============================================================================
-- اختبارات المرحلة 2: الضرائب، الفوليو، الفواتير، السندات، والثوابت المحاسبية
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'gm2@hotel.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'cashier2@hotel.test');

create or replace function pg_temp.expect_error(p_sql text, p_contains text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_contains in sqlerrm) = 0 then
      raise exception 'Expected error containing "%", got "%"', p_contains, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected error containing "%", but statement succeeded: %', p_contains, p_sql;
end $$;

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  if p_user is null then reset role; else set role authenticated; end if;
end $$;

-- رصيد حساب في الأستاذ (مدين − دائن) من القيود المرحّلة
create or replace function pg_temp.gl(p_hotel uuid, p_key text)
returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0)
  from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  join public.chart_of_accounts a on a.id = l.account_id
  where l.hotel_id = p_hotel and a.system_key = p_key;
$$;

-- -----------------------------------------------------------------------------
-- الإعداد: فندق + ضرائب قابلة للتهيئة + كاشير
-- -----------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
create temp table h2 as select public.create_hotel('فندق المرحلة 2', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h2, ids to authenticated;

do $$
declare h uuid := (select id from h2);
begin
  assert (select count(*) from public.payment_methods where hotel_id = h) = 7, 'default payment methods (incl. petty cash)';
  assert (select count(*) from public.charge_codes where hotel_id = h) = 12, 'default charge codes';
  assert (select count(*) from public.tax_rates where hotel_id = h) = 0, 'no taxes assumed';
end $$;

insert into public.tax_rates (hotel_id, code, name_ar, kind, rate, account_id)
select id, 'VAT', 'ضريبة القيمة المضافة', 'vat', 15, (select c.id from public.chart_of_accounts c where c.hotel_id = h2.id and system_key = 'vat_output') from h2;
insert into public.tax_rates (hotel_id, code, name_ar, kind, rate, account_id)
select id, 'MUNI', 'رسوم البلدية', 'municipality_fee', 2.5, (select c.id from public.chart_of_accounts c where c.hotel_id = h2.id and system_key = 'tourism_tax_payable') from h2;

-- الضريبة يجب أن ترتبط بحساب خصوم
select pg_temp.expect_error($q$
  insert into public.tax_rates (hotel_id, code, name_ar, kind, rate, account_id)
  select id, 'BAD', 'x', 'other', 5, (select c.id from public.chart_of_accounts c where c.hotel_id = h2.id and system_key = 'cash') from h2
$q$, 'liability');

insert into ids select 'vat', id from public.tax_rates where code = 'VAT' and hotel_id = (select id from h2);
insert into ids select 'muni', id from public.tax_rates where code = 'MUNI' and hotel_id = (select id from h2);
insert into ids select lower(code), id from public.charge_codes where hotel_id = (select id from h2);
insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h2);

insert into public.charge_code_taxes (hotel_id, charge_code_id, tax_rate_id)
select (select id from h2), c.v, t.v from ids c, ids t
where (c.k = 'room' and t.k in ('vat', 'muni')) or (c.k in ('food', 'minibar', 'events') and t.k = 'vat');

-- تطابق حساب الضرائب مع TypeScript (نفس المثال في tax.test.ts)
select pg_temp.act_as(null);
do $$
declare r jsonb;
begin
  r := app.compute_taxes(99.99, true, array[(select v from ids where k = 'vat'), (select v from ids where k = 'muni')], 2);
  assert (r ->> 'net')::numeric = 85.09 and (r ->> 'tax_total')::numeric = 14.90 and (r ->> 'total')::numeric = 99.99,
    'inclusive tax parity with TS: ' || r::text;
  r := app.compute_taxes(1000, false, array[(select v from ids where k = 'vat'), (select v from ids where k = 'muni')], 2);
  assert (r ->> 'tax_total')::numeric = 175, 'exclusive simple taxes';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');

-- عضو كاشير
insert into public.hotel_members (hotel_id, user_id) select id, '00000000-0000-0000-0000-0000000000b2' from h2;
insert into public.user_hotel_roles (hotel_id, user_id, role_id)
select (select id from h2), '00000000-0000-0000-0000-0000000000b2', id from public.roles where is_system and code = 'cashier';

-- =============================================================================
-- السيناريو 1: نزيل — عربون، غرفة، مطعم، ميني بار، خصم، مغادرة
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
insert into ids select 'f1', public.open_folio((select id from h2), 'أحمد علي', 'guest', null, '101');
select public.post_folio_deposit((select v from ids where k = 'f1'), (select v from ids where k = 'pm_cash'), 500);
insert into ids select 'room1', public.post_folio_charge((select v from ids where k = 'f1'), (select v from ids where k = 'room'), 500, 2);
select public.post_folio_charge((select v from ids where k = 'f1'), (select v from ids where k = 'food'), 200);
insert into ids select 'mb', public.post_folio_charge((select v from ids where k = 'f1'), (select v from ids where k = 'minibar'), 40);

select pg_temp.act_as(null);
do $$
declare
  f uuid := (select v from ids where k = 'f1');
  t public.folio_transactions%rowtype;
begin
  select * into t from public.folio_transactions where id = (select v from ids where k = 'room1');
  assert t.net_amount = 1000 and t.tax_amount = 175 and t.total_amount = 1175, 'room charge with VAT + municipality';
  assert (select balance from public.folio_balances where folio_id = f) = 1451, 'folio balance';
  assert (select deposit_balance from public.folio_balances where folio_id = f) = 500, 'deposit balance';
  -- الكاشير رحّل قيودًا دون أن يملك gl.journal.post (ترحيل نظامي)
  assert (select count(*) from public.journal_entries where source = 'folio' and hotel_id = (select id from h2)) = 4, 'auto-posted entries';
  assert (select entry_number from public.journal_entries where source_id = t.id) is not null, 'numbered';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');

-- الكاشير لا يمنح خصومات ولا يلغي حركات
select pg_temp.expect_error($q$
  select public.post_folio_allowance((select v from ids where k = 'f1'), (select v from ids where k = 'mb'), 46, 'x')
$q$, 'Permission denied');
select pg_temp.expect_error($q$
  select public.void_folio_transaction((select v from ids where k = 'mb'), 'x')
$q$, 'Permission denied');
-- ولا يكتب مباشرة في الجداول أو ينشئ قيدًا بمصدر آلي
select pg_temp.expect_error($q$
  insert into public.folio_transactions (hotel_id, folio_id, txn_type, business_date, description, total_amount)
  select (select id from h2), (select v from ids where k = 'f1'), 'payment', current_date, 'x', 100
$q$, 'row-level security');
select pg_temp.expect_error($q$
  update public.guest_folios set status = 'closed' where id = (select v from ids where k = 'f1')
$q$, 'managed by the system');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_error($q$
  insert into public.journal_entries (hotel_id, entry_date, period_id, description, source, currency_code)
  select id, current_date, '00000000-0000-0000-0000-000000000000', 'fake', 'folio', 'SAR' from h2
$q$, 'generated by their source documents');
-- القيود الآلية لا تُعكس يدويًا
select pg_temp.expect_error($q$
  select public.reverse_journal_entry((select journal_entry_id from public.folio_transactions where id = (select v from ids where k = 'mb')))
$q$, 'corrected from their source document');

-- خصم كامل على الميني بار (المدير)، يعكس الضريبة بنفس النسبة
select public.post_folio_allowance((select v from ids where k = 'f1'), (select v from ids where k = 'mb'), 46, 'خصم مجاملة');
select pg_temp.expect_error($q$
  select public.post_folio_allowance((select v from ids where k = 'f1'), (select v from ids where k = 'mb'), 1, 'زيادة')
$q$, 'Allowance must be between');

-- دفعة خاطئة ثم إلغاؤها
insert into ids select 'badpay', public.post_folio_payment((select v from ids where k = 'f1'), (select v from ids where k = 'pm_card'), 100);
select public.void_folio_transaction((select v from ids where k = 'badpay'), 'مبلغ خاطئ');
select pg_temp.expect_error($q$ select public.void_folio_transaction((select v from ids where k = 'badpay'), 'مرة ثانية') $q$, 'already voided');

-- الثابت المحاسبي: رصيد ذمم النزلاء والودائع في الأستاذ = مجموع أرصدة الفوليوهات
do $$
declare h uuid := (select id from h2);
begin
  assert pg_temp.gl(h, 'guest_ledger') = (select sum(balance) from public.folio_balances where hotel_id = h), 'GL guest ledger = folios';
  assert -pg_temp.gl(h, 'guest_deposits') = (select sum(deposit_balance) from public.folio_balances where hotel_id = h), 'GL deposits = folios';
  assert (select balance from public.folio_balances where folio_id = (select v from ids where k = 'f1')) = 1405, 'balance after allowance and void';
end $$;

-- المغادرة قبل التسوية مرفوضة (العربون يُطبّق تلقائيًا لكن يبقى رصيد)
select pg_temp.expect_error($q$ select public.checkout_folio((select v from ids where k = 'f1')) $q$, 'balance must be zero');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select public.post_folio_payment((select v from ids where k = 'f1'), (select v from ids where k = 'pm_card'), 905);
insert into ids select 'inv1', public.checkout_folio((select v from ids where k = 'f1'));

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
do $$
declare
  i public.invoices%rowtype;
begin
  select * into i from public.invoices where id = (select v from ids where k = 'inv1');
  assert i.subtotal = 1200 and i.tax_total = 205 and i.total = 1405, 'invoice totals: ' || i.subtotal || '/' || i.tax_total;
  assert i.status = 'paid' and i.amount_due = 0, 'cash-settled invoice is paid';
  assert i.invoice_number like 'INV-%', 'invoice numbered';
  assert (select amount from public.invoice_taxes where invoice_id = i.id and tax_rate_id = (select v from ids where k = 'vat')) = 180, 'VAT on invoice';
  assert (select amount from public.invoice_taxes where invoice_id = i.id and tax_rate_id = (select v from ids where k = 'muni')) = 25, 'municipality fee on invoice';
  assert (select count(*) from public.invoice_items where invoice_id = i.id) = 4, '3 charges + 1 allowance';
  assert (select status from public.guest_folios where id = (select v from ids where k = 'f1')) = 'closed', 'folio closed';
  -- الإيراد بالقسم: الغرف 1000، المطعم 200، الميني بار 40 − 40 خصم
  assert -pg_temp.gl((select id from h2), 'revenue_rooms') = 1000, 'rooms revenue';
  assert pg_temp.gl((select id from h2), 'revenue_discounts') = 40, 'allowance account';
  assert -pg_temp.gl((select id from h2), 'vat_output') = 180, 'VAT payable';
end $$;

select pg_temp.expect_error($q$
  select public.post_folio_charge((select v from ids where k = 'f1'), (select v from ids where k = 'food'), 10)
$q$, 'is not open');
-- المستخدم: RLS لا يسمح بأي تعديل (0 صفوف)؛ وحتى خارج RLS يمنعه التريغر
update public.invoices set total = 1 where id = (select v from ids where k = 'inv1');
do $$ begin assert (select total from public.invoices where id = (select v from ids where k = 'inv1')) = 1405, 'invoice unchanged'; end $$;
select pg_temp.act_as(null);
select pg_temp.expect_error($q$ update public.invoices set total = 1 where id = (select v from ids where k = 'inv1') $q$, 'maintained by the system');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');

-- =============================================================================
-- السيناريو 2: شركة — فوليو رئيسي، تحويل، آجل، سند قبض وتخصيص
-- =============================================================================
insert into public.customers (hotel_id, code, name_ar, customer_type, tax_number, allow_credit, credit_limit, payment_terms_days)
select id, 'ACME', 'شركة أكمي', 'company', '300000000000003', true, 5000, 30 from h2;
insert into public.customers (hotel_id, code, name_ar, allow_credit) select id, 'CASHONLY', 'عميل نقدي', false from h2;
insert into ids select 'acme', id from public.customers where code = 'ACME' and hotel_id = (select id from h2);
insert into ids select 'cashonly', id from public.customers where code = 'CASHONLY' and hotel_id = (select id from h2);

insert into ids select 'master', public.open_folio((select id from h2), 'مجموعة أكمي', 'master', (select v from ids where k = 'acme'));
insert into ids select 'g2', public.open_folio((select id from h2), 'موظف أكمي', 'guest', null, '205', null, null, null, null, (select v from ids where k = 'master'));
select public.post_folio_charge((select v from ids where k = 'g2'), (select v from ids where k = 'room'), 500, 2);
select public.transfer_folio_balance((select v from ids where k = 'g2'), (select v from ids where k = 'master'), 1175);

-- عميل غير مسموح له بالآجل
insert into ids select 'g3', public.open_folio((select id from h2), 'ضيف', 'guest', (select v from ids where k = 'cashonly'));
select public.post_folio_charge((select v from ids where k = 'g3'), (select v from ids where k = 'food'), 100);
select pg_temp.expect_error($q$
  select public.post_folio_payment((select v from ids where k = 'g3'), (select v from ids where k = 'pm_credit'), 115)
$q$, 'not allowed credit');
select public.post_folio_payment((select v from ids where k = 'g3'), (select v from ids where k = 'pm_cash'), 115);
select public.checkout_folio((select v from ids where k = 'g3'));

-- التحويل للآجل لا يتجاوز رصيد الفوليو
select pg_temp.expect_error($q$
  select public.post_folio_payment((select v from ids where k = 'master'), (select v from ids where k = 'pm_credit'), 2000)
$q$, 'cannot exceed the folio balance');
select public.post_folio_payment((select v from ids where k = 'master'), (select v from ids where k = 'pm_credit'), 1175);

insert into ids select 'inv_g2', public.checkout_folio((select v from ids where k = 'g2'));
insert into ids select 'inv_master', public.checkout_folio((select v from ids where k = 'master'));

select pg_temp.act_as(null);
do $$
declare i public.invoices%rowtype;
begin
  select * into i from public.invoices where id = (select v from ids where k = 'inv_master');
  assert i.customer_id = (select v from ids where k = 'acme') and i.amount_due = 1175 and i.status = 'issued', 'master invoice on credit';
  assert i.due_date = i.issue_date + 30, 'due date from payment terms';
  assert pg_temp.gl((select id from h2), 'ar_control') = 1175, 'AR in GL';
  assert app.customer_outstanding((select v from ids where k = 'acme')) = 1175, 'customer outstanding';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');

-- فاتورة مباشرة تتجاوز الحد الائتماني (1175 + 4600 > 5000)
select pg_temp.expect_error($q$
  select public.create_direct_invoice((select id from h2), (select v from ids where k = 'acme'),
    jsonb_build_array(jsonb_build_object('charge_code_id', (select v from ids where k = 'events'), 'unit_price', 4000)))
$q$, 'Credit limit exceeded');

-- فاتورة مباشرة لقاعة مؤتمرات: 2000 + 15% = 2300
insert into ids select 'inv_direct', public.create_direct_invoice((select id from h2), (select v from ids where k = 'acme'),
  jsonb_build_array(jsonb_build_object('charge_code_id', (select v from ids where k = 'events'), 'unit_price', 1000, 'quantity', 2, 'description', 'قاعة مؤتمرات يومين')));
do $$
begin
  assert (select total from public.invoices where id = (select v from ids where k = 'inv_direct')) = 2300, 'direct invoice total';
  assert pg_temp.gl((select id from h2), 'ar_control') = 3475, 'AR after direct invoice';
  assert -pg_temp.gl((select id from h2), 'revenue_events') = 2000, 'events revenue';
end $$;

-- سند قبض 1000 مخصص جزئيًا لفاتورة الفوليو الرئيسي
insert into ids select 'rv1', public.create_payment_voucher((select id from h2), 'receipt', 'customer',
  (select v from ids where k = 'pm_bank'), 1000, 'سداد دفعة', null, (select v from ids where k = 'acme'),
  p_allocations => jsonb_build_array(jsonb_build_object('invoice_id', (select v from ids where k = 'inv_master'), 'amount', 1000)));
do $$
begin
  assert (select status from public.invoices where id = (select v from ids where k = 'inv_master')) = 'partially_paid', 'partially paid';
end $$;

-- تخصيص يتجاوز المتبقي مرفوض
select pg_temp.expect_error($q$
  select public.create_payment_voucher((select id from h2), 'receipt', 'customer',
    (select v from ids where k = 'pm_bank'), 500, 'x', null, (select v from ids where k = 'acme'),
    p_allocations => jsonb_build_array(jsonb_build_object('invoice_id', (select v from ids where k = 'inv_master'), 'amount', 500)))
$q$, 'must be between');

-- سند 400: 175 للفاتورة والباقي 225 رصيد دائن على الحساب
insert into ids select 'rv2', public.create_payment_voucher((select id from h2), 'receipt', 'customer',
  (select v from ids where k = 'pm_cash'), 400, 'تسوية', null, (select v from ids where k = 'acme'),
  p_allocations => jsonb_build_array(jsonb_build_object('invoice_id', (select v from ids where k = 'inv_master'), 'amount', 175)));
select pg_temp.act_as(null);
do $$
begin
  assert (select status from public.invoices where id = (select v from ids where k = 'inv_master')) = 'paid', 'fully paid';
  assert app.customer_unapplied_credit((select v from ids where k = 'acme')) = 225, 'unapplied credit';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');

-- تخصيص الرصيد الدائن لاحقًا على الفاتورة المباشرة
select public.allocate_payment((select v from ids where k = 'rv2'), jsonb_build_array(
  jsonb_build_object('invoice_id', (select v from ids where k = 'inv_direct'), 'amount', 225)));
select pg_temp.act_as(null);
do $$
begin
  assert (select amount_paid from public.invoices where id = (select v from ids where k = 'inv_direct')) = 225, 'later allocation';
  assert app.customer_unapplied_credit((select v from ids where k = 'acme')) = 0, 'credit consumed';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');

-- إلغاء السند الأول يعيد الفاتورة إلى مسددة جزئيًا ويعكس القيد
select public.void_payment_voucher((select v from ids where k = 'rv1'), 'شيك مرتجع');
do $$
begin
  assert (select status from public.invoices where id = (select v from ids where k = 'inv_master')) = 'partially_paid', 'void restores balance';
  assert (select amount_paid from public.invoices where id = (select v from ids where k = 'inv_master')) = 175, 'paid after void';
end $$;

-- الثابت المحاسبي: ذمم مدينة في الأستاذ = المتبقي على الفواتير − الرصيد الدائن غير المخصص
select pg_temp.act_as(null);
do $$
declare h uuid := (select id from h2);
begin
  assert pg_temp.gl(h, 'ar_control') = (select sum(amount_due - amount_paid) from public.invoices where hotel_id = h)
         - app.customer_unapplied_credit((select v from ids where k = 'acme')), 'GL AR = subledger';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');

-- =============================================================================
-- سند صرف لمصروف (كهرباء) بمركز تكلفة، ومنع استخدام حسابات المراقبة
-- =============================================================================
select public.create_payment_voucher((select id from h2), 'disbursement', 'account',
  (select v from ids where k = 'pm_cash'), 300, 'فاتورة كهرباء سبتمبر',
  p_counter_account_id => (select id from public.chart_of_accounts where hotel_id = (select id from h2) and code = '5204'),
  p_department_id => (select id from public.departments where hotel_id = (select id from h2) and code = 'MAINT'));
select pg_temp.expect_error($q$
  select public.create_payment_voucher((select id from h2), 'receipt', 'account', (select v from ids where k = 'pm_cash'), 10, 'x',
    p_counter_account_id => (select id from public.chart_of_accounts where hotel_id = (select id from h2) and system_key = 'ar_control'))
$q$, 'Control account');
select pg_temp.expect_error($q$
  select public.create_payment_voucher((select id from h2), 'receipt', 'account', (select v from ids where k = 'pm_credit'), 10, 'x',
    p_counter_account_id => (select id from public.chart_of_accounts where hotel_id = (select id from h2) and code = '4201'))
$q$, 'cash or bank');

-- الكاشير لا يصدر سندات صرف
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_error($q$
  select public.create_payment_voucher((select id from h2), 'disbursement', 'account', (select v from ids where k = 'pm_cash'), 10, 'x',
    p_counter_account_id => (select id from public.chart_of_accounts where hotel_id = (select id from h2) and code = '5204'))
$q$, 'Permission denied');

-- =============================================================================
-- الثوابت النهائية: الأستاذ متوازن والدفاتر الفرعية مطابقة
-- =============================================================================
select pg_temp.act_as(null);
do $$
declare h uuid := (select id from h2);
begin
  assert (select sum(debit) = sum(credit) from public.journal_entry_lines l
          join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted' where l.hotel_id = h), 'GL balanced';
  assert pg_temp.gl(h, 'guest_ledger') = (select sum(balance) from public.folio_balances where hotel_id = h), 'guest ledger reconciles';
  assert pg_temp.gl(h, 'guest_deposits') = 0, 'no deposits left';
  -- النقد: عربون 500 + دفعة نقدية 115 + قبض 400 − صرف 300 = 715
  assert pg_temp.gl(h, 'cash') = 715, 'cash balance: ' || pg_temp.gl(h, 'cash');
end $$;

select pg_temp.expect_error($q$ delete from public.folio_transactions $q$, 'cannot be deleted');

\o
\echo '  ✓ revenue, folio, invoice and payment tests passed'

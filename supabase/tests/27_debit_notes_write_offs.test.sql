-- =============================================================================
-- اختبارات مرتجعات المشتريات وإعدام الديون: المبالغ، القيود، حالة الفاتورة، منع بنود المخزون،
-- الصلاحيات، وبقاء الدفاتر الفرعية مطابقة للأستاذ
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

-- الاختبارات السابقة قد تترك التسجيل بالدعوة فقط؛ مستخدمو الاختبار يُضافون مباشرة
delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002701', 'gm27@hotel.test'),
  ('00000000-0000-0000-0000-000000002702', 'cash27@hotel.test');

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
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'Check failed: %', p_msg; end if; end $$;
create or replace function pg_temp.gl(p_hotel uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  join public.chart_of_accounts a on a.id = l.account_id
  where l.hotel_id = p_hotel and a.system_key = p_key;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-000000002701');
create temp table h27 as select public.create_hotel('فندق المرتجعات', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h27, ids to authenticated;
create or replace function pg_temp.acc(p_code text) returns uuid language sql as $$
  select id from public.chart_of_accounts where hotel_id = (select id from h27) and code = p_code;
$$;
select public.add_hotel_member((select id from h27), 'cash27@hotel.test', array[(select id from public.roles where is_system and code = 'cashier')]);
insert into public.tax_rates (hotel_id, code, name_ar, kind, rate, account_id)
select id, 'VAT', 'ضريبة القيمة المضافة', 'vat', 15, (select a.id from public.chart_of_accounts a where a.hotel_id = h27.id and a.system_key = 'vat_output') from h27;
insert into ids select 'vat', id from public.tax_rates where hotel_id = (select id from h27) and code = 'VAT';
insert into public.vendors (hotel_id, code, name_ar) select id, 'V1', 'مورد المستلزمات' from h27;
insert into ids select 'vendor', id from public.vendors where hotel_id = (select id from h27);

-- فاتورة مورد: مستلزمات نظافة 1000 + ضريبة 150
insert into ids select 'bill', public.create_vendor_bill((select id from h27), (select v from ids where k = 'vendor'),
  jsonb_build_array(jsonb_build_object('description', 'منظفات', 'account_id', pg_temp.acc('5207'), 'quantity', 10, 'unit_price', 100, 'tax_rate_id', (select v from ids where k = 'vat'))));
select pg_temp.check((select total from public.vendor_bills where id = (select v from ids where k = 'bill')) = 1150, 'bill total 1150');

-- مرتجع 230 (200 صافي + 30 ضريبة)
select pg_temp.expect_error($q$ select public.create_vendor_debit_note((select v from ids where k = 'bill'), 2000, 'زيادة') $q$, 'outstanding amount');
select pg_temp.expect_error($q$ select public.create_vendor_debit_note((select v from ids where k = 'bill'), 230, '') $q$, 'reason is required');
insert into ids select 'dn', public.create_vendor_debit_note((select v from ids where k = 'bill'), 230, 'إرجاع عبوات تالفة');
select pg_temp.check((select net_amount from public.vendor_debit_notes where id = (select v from ids where k = 'dn')) = 200, 'dn net 200');
select pg_temp.check((select amount_paid from public.vendor_bills where id = (select v from ids where k = 'bill')) = 230, 'bill reduced by return');
select pg_temp.check((select status from public.vendor_bills where id = (select v from ids where k = 'bill')) = 'partially_paid', 'bill partially settled');
select pg_temp.check(pg_temp.gl((select id from h27), 'ap_control') = -920, 'AP 920 left');
select pg_temp.check(pg_temp.gl((select id from h27), 'vat_input') = 120, 'VAT input reduced to 120');
select pg_temp.check((select coalesce(sum(l.debit - l.credit), 0) from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id
  where j.hotel_id = (select id from h27) and l.account_id = pg_temp.acc('5207')) = 800, 'expense reduced to 800');

-- فاتورة على حساب مخزون تُستثنى
insert into public.inventory_items (hotel_id, sku, name_ar, unit, inventory_account_id, expense_account_id)
select id, 'SOAP', 'صابون', 'piece', pg_temp.acc('1122'), pg_temp.acc('5207') from h27;
insert into ids select 'bill_inv', public.create_vendor_bill((select id from h27), (select v from ids where k = 'vendor'),
  jsonb_build_array(jsonb_build_object('description', 'صابون', 'account_id', pg_temp.acc('1122'), 'quantity', 5, 'unit_price', 10)));
select pg_temp.expect_error($q$ select public.create_vendor_debit_note((select v from ids where k = 'bill_inv'), 10, 'مرتجع') $q$, 'inventory lines');

-- إعدام دين: فاتورة آجلة 1000 بلا ضريبة، يُعدم منها 400
insert into public.customers (hotel_id, code, name_ar, allow_credit) select id, 'ACME', 'شركة متعثرة', true from h27;
insert into ids select 'inv', public.create_direct_invoice((select id from h27), (select id from public.customers where hotel_id = (select id from h27) and code = 'ACME'),
  jsonb_build_array(jsonb_build_object('charge_code_id', (select id from public.charge_codes where hotel_id = (select id from h27) and code = 'EVENTS'), 'unit_price', 1000)));

select pg_temp.act_as('00000000-0000-0000-0000-000000002702');
select pg_temp.expect_error($q$ select public.write_off_invoice((select v from ids where k = 'inv'), 400, 'تعثر') $q$, 'Permission denied');
select pg_temp.expect_error($q$ select public.create_vendor_debit_note((select v from ids where k = 'bill'), 10, 'x') $q$, 'Permission denied');
select pg_temp.act_as('00000000-0000-0000-0000-000000002701');

select pg_temp.expect_error($q$ select public.write_off_invoice((select v from ids where k = 'inv'), 5000, 'x') $q$, 'outstanding amount');
insert into ids select 'wo', public.write_off_invoice((select v from ids where k = 'inv'), 400, 'تعثر الشركة');
select pg_temp.check((select amount_due from public.invoices where id = (select v from ids where k = 'inv')) = 600, 'due reduced to 600');
select pg_temp.check(pg_temp.gl((select id from h27), 'bad_debt_expense') = 400, 'bad debt expense 400');
select pg_temp.check(pg_temp.gl((select id from h27), 'ar_control') = 600, 'AR 600');
-- إعدام الباقي يجعل الفاتورة مسددة
select public.write_off_invoice((select v from ids where k = 'inv'), 600, 'إعدام الباقي');
select pg_temp.check((select status from public.invoices where id = (select v from ids where k = 'inv')) = 'paid', 'fully written off');

-- الدفاتر الفرعية للعملاء والموردين مطابقة للأستاذ
select pg_temp.act_as(null);
do $$
declare r record;
begin
  for r in select x.* from public.ledger_reconciliation((select id from h27)) x loop
    if r.difference <> 0 then
      raise exception 'Reconciliation difference for %: %', r.control, r.difference;
    end if;
  end loop;
end $$;

\o
select 'debit notes and write-offs tests passed';

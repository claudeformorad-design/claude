-- =============================================================================
-- اختبارات المرحلة الثالثة: ورديات الكاشير (العهدة، النسبة للوردية، العدّ وقيد العجز)،
-- الدفع بالعملة الأجنبية بسعر الصرف، وفوترة الشركات (الإقامة أو كل الفاتورة آجلًا)
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001101', 'gm11@hotel.test'),
  ('00000000-0000-0000-0000-000000001102', 'desk11@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000001101');
create temp table h11 as select public.create_hotel('فندق الصندوق', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
create temp table d (k text primary key, v date);
grant all on h11, ids, d to authenticated;
insert into d select 'today', app.today_for_hotel(id) from h11;
select public.add_hotel_member((select id from h11), 'desk11@hotel.test',
  array[(select id from public.roles where is_system and code = 'receptionist')]);

insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h11);
insert into public.room_types (hotel_id, code, name_ar, base_rate, max_adults) select id, 'DBL', 'مزدوجة', 200, 2 from h11;
insert into ids select 'rt', id from public.room_types where hotel_id = (select id from h11);
select public.create_rooms_bulk((select id from h11), (select v from ids where k = 'rt'), 101, 104);
insert into ids select 'room_' || room_number, id from public.rooms where hotel_id = (select id from h11);
insert into public.guests (hotel_id, full_name) select id, 'نزيل' from h11;
insert into ids select 'g', id from public.guests where hotel_id = (select id from h11);
insert into public.customers (hotel_id, code, name_ar, customer_type, allow_credit) select id, 'ACME', 'شركة النخبة', 'company', true from h11;
insert into ids select 'acme', id from public.customers where hotel_id = (select id from h11) and code = 'ACME';

-- طريقة دفع بالدولار (نقدًا) — العملة الأساسية لا تُسجَّل عملةً لطريقة
insert into public.payment_methods (hotel_id, code, name_ar, kind, account_id, currency_code)
select id, 'USD', 'نقدًا دولار', 'cash', (select c.id from public.chart_of_accounts c where c.hotel_id = h11.id and system_key = 'cash'), 'USD' from h11;
insert into public.payment_methods (hotel_id, code, name_ar, kind, account_id, currency_code)
select id, 'SAR2', 'نقدًا ريال', 'cash', (select c.id from public.chart_of_accounts c where c.hotel_id = h11.id and system_key = 'cash'), 'SAR' from h11;
insert into ids select 'pm_usd', id from public.payment_methods where hotel_id = (select id from h11) and code = 'USD';
do $$ begin
  assert (select currency_code from public.payment_methods where hotel_id = (select id from h11) and code = 'SAR2') is null, 'base currency stored as null';
end $$;
select pg_temp.expect_error($q$ insert into public.payment_methods (hotel_id, code, name_ar, kind, account_id, currency_code)
  select id, 'CRUSD', 'آجل دولار', 'city_ledger', (select c.id from public.chart_of_accounts c where c.hotel_id = h11.id and system_key = 'ar_control'), 'USD' from h11 $q$,
  'Credit (city ledger) is always in the base currency');

create or replace function pg_temp.book(p_room text, p_customer uuid default null) returns uuid language sql as $$
  select public.create_reservation(p_hotel_id => (select id from h11), p_guest_id => (select v from ids where k = 'g'),
    p_room_type_id => (select v from ids where k = 'rt'), p_room_id => (select v from ids where k = 'room_' || p_room),
    p_customer_id => p_customer,
    p_arrival_date => (select v from d where k = 'today'), p_departure_date => (select v from d where k = 'today') + 1);
$$;

-- =============================================================================
-- الوردية: فتح بعهدة، وردية واحدة مفتوحة للموظف
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001102');
insert into ids select 'shift', public.open_cashier_shift((select id from h11), 1000);
select pg_temp.expect_error($q$ select public.open_cashier_shift((select id from h11), 0) $q$, 'You already have an open cashier shift');
select pg_temp.expect_error($q$ select public.open_cashier_shift((select id from h11), -1) $q$, 'You already have an open cashier shift');
do $$ begin
  assert (select shift_number from public.cashier_shifts where id = (select v from ids where k = 'shift')) like 'SHF-%', 'shift numbered';
end $$;

insert into ids select 'r1', pg_temp.book('101');
select public.check_in_reservation((select v from ids where k = 'r1'));
select public.record_reservation_deposit((select v from ids where k = 'r1'), (select v from ids where k = 'pm_cash'), 200, null);
insert into ids select 'f1', folio_id from public.reservations where id = (select v from ids where k = 'r1');
do $$ begin
  assert (select cashier_shift_id from public.folio_transactions where folio_id = (select v from ids where k = 'f1') and txn_type = 'deposit')
         = (select v from ids where k = 'shift'), 'cash tagged to the open shift';
end $$;

-- =============================================================================
-- العملة الأجنبية: لا تُقبل بمبلغ أساسي، وتحتاج سعر صرف
-- =============================================================================
select pg_temp.expect_error($q$ select public.post_folio_payment((select v from ids where k = 'f1'), (select v from ids where k = 'pm_usd'), 100) $q$,
  'Enter the amount in USD');
select pg_temp.expect_error($q$ select public.post_folio_foreign_money((select v from ids where k = 'f1'), 'deposit', (select v from ids where k = 'pm_usd'), 100) $q$,
  'No exchange rate for USD');
select pg_temp.expect_error($q$ select public.set_exchange_rate((select id from h11), 'USD', 3.75) $q$, 'Permission denied');
select pg_temp.act_as('00000000-0000-0000-0000-000000001101');
select public.set_exchange_rate((select id from h11), 'USD', 3.70, (select v from d where k = 'today') - 3);
select public.set_exchange_rate((select id from h11), 'USD', 3.75);
select pg_temp.expect_error($q$ select public.set_exchange_rate((select id from h11), 'SAR', 1) $q$, 'The base currency has no exchange rate');
select pg_temp.act_as('00000000-0000-0000-0000-000000001102');
select pg_temp.expect_error($q$ select public.post_folio_foreign_money((select v from ids where k = 'f1'), 'deposit', (select v from ids where k = 'pm_cash'), 100) $q$,
  'is in the base currency');
insert into ids select 'fx1', public.post_folio_foreign_money((select v from ids where k = 'f1'), 'deposit', (select v from ids where k = 'pm_usd'), 100, 'USD-1');
do $$
declare t public.folio_transactions%rowtype;
begin
  select * into t from public.folio_transactions where id = (select v from ids where k = 'fx1');
  assert t.total_amount = 375 and t.foreign_amount = 100 and t.exchange_rate = 3.75 and t.currency_code = 'USD', format('fx deposit %s', to_jsonb(t));
  assert t.cashier_shift_id = (select v from ids where k = 'shift'), 'fx tagged to shift';
  assert (select deposit_balance from public.folio_balances where folio_id = t.folio_id) = 575, 'deposits in base currency';
end $$;
-- إلغاء حركة أجنبية يحمل مبلغها الأجنبي
-- (يلغيها المدير؛ الإلغاء يعود لوردية الحركة الأصلية المفتوحة)
select pg_temp.act_as('00000000-0000-0000-0000-000000001101');
select public.void_folio_transaction((select v from ids where k = 'fx1'), 'خطأ إدخال');
do $$
declare t public.folio_transactions%rowtype;
begin
  select * into t from public.folio_transactions where related_transaction_id = (select v from ids where k = 'fx1') and direction = -1;
  assert t.foreign_amount = 100 and t.currency_code = 'USD', 'void keeps foreign amount';
  assert t.cashier_shift_id = (select v from ids where k = 'shift'), 'void returns to the original shift';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-000000001102');
select public.post_folio_foreign_money((select v from ids where k = 'f1'), 'deposit', (select v from ids where k = 'pm_usd'), 50);

-- =============================================================================
-- تقرير الوردية والإغلاق: عجز 10 في الصندوق الأساسي يُقيَّد آليًا
-- =============================================================================
do $$
declare r jsonb := public.cashier_shift_report((select v from ids where k = 'shift'));
begin
  assert (select (m ->> 'expected')::numeric from jsonb_array_elements(r -> 'methods') m where m ->> 'code' = 'CASH') = 1200, format('cash expected %s', r -> 'methods');
  assert (select (m ->> 'expected')::numeric from jsonb_array_elements(r -> 'methods') m where m ->> 'code' = 'USD') = 50, 'usd expected';
  assert jsonb_array_length(r -> 'transactions') = 4, 'shift transactions';
end $$;
select pg_temp.expect_error($q$ select public.close_cashier_shift((select v from ids where k = 'shift'),
  jsonb_build_array(jsonb_build_object('payment_method_id', (select v from ids where k = 'pm_cash'), 'counted', 1190))) $q$, 'Count the cash in');
select public.close_cashier_shift((select v from ids where k = 'shift'), jsonb_build_array(
  jsonb_build_object('payment_method_id', (select v from ids where k = 'pm_cash'), 'counted', 1190),
  jsonb_build_object('payment_method_id', (select v from ids where k = 'pm_usd'), 'counted', 50)), 'عجز بسيط');
select pg_temp.expect_error($q$ select public.close_cashier_shift((select v from ids where k = 'shift'), '[]') $q$, 'already closed');

select pg_temp.act_as('00000000-0000-0000-0000-000000001101');
do $$
declare s public.cashier_shifts%rowtype;
begin
  select * into s from public.cashier_shifts where id = (select v from ids where k = 'shift');
  assert s.status = 'closed' and s.over_short_entry_id is not null, 'closed with over/short entry';
  assert pg_temp.gl((select id from h11), 'cash_over_short') = 10, 'shortage expensed';
  assert (select difference from public.cashier_shift_counts where shift_id = s.id and payment_method_id = (select v from ids where k = 'pm_cash')) = -10, 'count difference';
end $$;

-- إلزام الوردية للنقد (البطاقة لا تحتاج وردية)
update public.hotels set require_cashier_shift = true where id = (select id from h11);
select pg_temp.act_as('00000000-0000-0000-0000-000000001102');
select pg_temp.expect_error($q$ select public.post_folio_deposit((select v from ids where k = 'f1'), (select v from ids where k = 'pm_cash'), 10) $q$,
  'Open a cashier shift');
select public.post_folio_deposit((select v from ids where k = 'f1'), (select v from ids where k = 'pm_card'), 10);
do $$ begin
  assert (select count(*) from public.cashier_shifts) = 1, 'desk sees own shift only';
end $$;

-- =============================================================================
-- فوترة الشركات
-- =============================================================================
select pg_temp.expect_error($q$ select public.set_reservation_billing((select v from ids where k = 'r1'), 'company_all') $q$,
  'Link the reservation to a company');
select public.open_cashier_shift((select id from h11), 0);

-- الإقامة على الشركة والإضافات على النزيل
insert into ids select 'r2', pg_temp.book('102', (select v from ids where k = 'acme'));
select public.set_reservation_billing((select v from ids where k = 'r2'), 'company_room');
select public.check_in_reservation((select v from ids where k = 'r2'));
insert into ids select 'f2', folio_id from public.reservations where id = (select v from ids where k = 'r2');
select public.post_folio_charge((select v from ids where k = 'f2'),
  (select id from public.charge_codes where hotel_id = (select id from h11) and code = 'MINIBAR'), 30);
do $$
declare x jsonb := public.prepare_check_out((select v from ids where k = 'r2'));
begin
  assert (x ->> 'company_due')::numeric = 200 and (x ->> 'due')::numeric = 30, format('split %s', x);
end $$;
select pg_temp.expect_error($q$ select public.check_out_reservation((select v from ids where k = 'r2')) $q$, 'balance must be zero');
select public.post_folio_payment((select v from ids where k = 'f2'), (select v from ids where k = 'pm_cash'), 30);
insert into ids select 'inv2', public.check_out_reservation((select v from ids where k = 'r2'));
do $$ begin
  assert (select customer_id from public.invoices where id = (select v from ids where k = 'inv2')) = (select v from ids where k = 'acme'), 'invoice billed to the company';
  assert (select amount_due from public.invoices where id = (select v from ids where k = 'inv2')) = 200, 'company owes the room';
end $$;

-- كل الفاتورة على الشركة: لا مستحق على النزيل
insert into ids select 'r3', pg_temp.book('103', (select v from ids where k = 'acme'));
select public.set_reservation_billing((select v from ids where k = 'r3'), 'company_all');
select public.check_in_reservation((select v from ids where k = 'r3'));
insert into ids select 'f3', folio_id from public.reservations where id = (select v from ids where k = 'r3');
do $$ begin
  assert (select customer_id from public.guest_folios where id = (select v from ids where k = 'f3')) = (select v from ids where k = 'acme'), 'folio billed to company';
end $$;
select public.post_folio_charge((select v from ids where k = 'f3'),
  (select id from public.charge_codes where hotel_id = (select id from h11) and code = 'LAUNDRY'), 40);
do $$
declare x jsonb := public.prepare_check_out((select v from ids where k = 'r3'));
begin
  assert (x ->> 'company_due')::numeric = 240 and (x ->> 'due')::numeric = 0, format('all to company %s', x);
end $$;
insert into ids select 'inv3', public.check_out_reservation((select v from ids where k = 'r3'));
do $$ begin
  assert (select amount_due from public.invoices where id = (select v from ids where k = 'inv3')) = 240, 'company owes all';
end $$;

-- حساب النزيل (بدون شركة): الفوليو بلا جهة فوترة؛ عربون بالدولار يفتح الفوليو
insert into ids select 'r4', pg_temp.book('104', (select v from ids where k = 'acme'));
select public.record_reservation_deposit_fx((select v from ids where k = 'r4'), (select v from ids where k = 'pm_usd'), 20);
do $$ begin
  assert (select deposit_balance from public.folio_balances b join public.reservations r on r.folio_id = b.folio_id
           where r.id = (select v from ids where k = 'r4')) = 75, 'usd deposit on reservation folio';
end $$;
select public.check_in_reservation((select v from ids where k = 'r4'));
do $$ begin
  assert (select f.customer_id from public.guest_folios f join public.reservations r on r.folio_id = f.id where r.id = (select v from ids where k = 'r4')) is null,
    'guest billing keeps the folio unassigned';
end $$;

-- =============================================================================
-- التطابق المحاسبي
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001101');
do $$
declare h uuid := (select id from h11);
begin
  assert not exists (select 1 from public.ledger_reconciliation(h) where difference <> 0), 'ledger reconciles';
  assert pg_temp.gl(h, 'guest_ledger') = (select coalesce(sum(balance), 0) from public.folio_balances where hotel_id = h), 'guest ledger = folios';
  assert pg_temp.gl(h, 'ar_control') = 440, format('company receivable %s', pg_temp.gl(h, 'ar_control'));
end $$;

select pg_temp.act_as(null);
\o
select '✓ 11_cashier_fx_billing: all assertions passed';

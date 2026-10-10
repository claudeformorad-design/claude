-- =============================================================================
-- اختبارات الصندوق بعدة عملات: طبعتا الريال اليمني، صناديق ومحافظ بحسابات مستقلة،
-- رقم العملية الإلزامي وغير المكرر، عهدة الوردية بكل عملة، والسندات والتحويلات على الوردية،
-- وتقرير النقدية بالعملات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003401', 'gm34@hotel.test'),
  ('00000000-0000-0000-0000-000000003402', 'desk34@hotel.test'),
  ('00000000-0000-0000-0000-000000003403', 'hk34@hotel.test');

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

select pg_temp.check((select count(*) from public.currencies where code in ('YRO', 'YRN')) = 2, 'both Yemeni rial note series exist');

select pg_temp.act_as('00000000-0000-0000-0000-000000003401');
create temp table h34 as select public.create_hotel('فندق عدن', 'YE', 'YER') as id;
create temp table ids (k text primary key, v uuid);
create temp table d (k text primary key, v date);
grant all on h34, ids, d to authenticated;
insert into d select 'today', app.today_for_hotel(id) from h34;
select public.add_hotel_member((select id from h34), 'desk34@hotel.test', array[(select id from public.roles where is_system and code = 'receptionist')]);
select public.add_hotel_member((select id from h34), 'hk34@hotel.test', array[(select id from public.roles where is_system and code = 'housekeeping')]);
create or replace function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h34);

-- =============================================================================
-- صناديق ومحافظ بحساب مستقل لكل منها
-- =============================================================================
insert into ids select 'pm_usd', public.create_payment_box((select id from h34), 'cash', 'cash-usd', 'صندوق الدولار', 'USD cash', 'USD');
insert into ids select 'pm_sar', public.create_payment_box((select id from h34), 'cash', 'CASH-SAR', 'صندوق السعودي', null, 'SAR');
insert into ids select 'pm_old', public.create_payment_box((select id from h34), 'cash', 'CASH-OLD', 'صندوق الطبعة القديمة', null, 'YRO');
insert into ids select 'pm_jawali', public.create_payment_box((select id from h34), 'e_wallet', 'JAWALI', 'جوالي', 'Jawali', null, true);
insert into ids select 'pm_yer2', public.create_payment_box((select id from h34), 'cash', 'CASH2', 'صندوق المطعم', null, 'YER');
select pg_temp.expect_error($q$ select public.create_payment_box((select id from h34), 'cash', 'JAWALI', 'مكرر') $q$, 'already exists');
select pg_temp.expect_error($q$ select public.create_payment_box((select id from h34), 'card', 'CRD2', 'بطاقة') $q$, 'cash box, an e-wallet or a bank account');
select pg_temp.expect_error($q$ select public.create_payment_box((select id from h34), 'cash', 'X Y', 'خطأ') $q$, 'Code must be');
select pg_temp.expect_error($q$ select public.create_payment_box((select id from h34), 'cash', 'ABC', ' ') $q$, 'Write the name');
select pg_temp.expect_error($q$ select public.create_payment_box((select id from h34), 'cash', 'ABC', 'خطأ', null, 'ZZZ') $q$, 'Unknown currency');

do $$
declare m public.payment_methods%rowtype; a public.chart_of_accounts%rowtype; c public.chart_of_accounts%rowtype;
begin
  select * into m from public.payment_methods where id = pg_temp.v('pm_usd');
  select * into a from public.chart_of_accounts where id = m.account_id;
  select * into c from public.chart_of_accounts where hotel_id = m.hotel_id and system_key = 'cash';
  perform pg_temp.check(m.code = 'CASH-USD' and m.currency_code = 'USD' and m.kind = 'cash' and not m.requires_reference, 'USD box method');
  perform pg_temp.check(a.parent_id = c.parent_id and a.is_postable and a.name_ar = 'صندوق الدولار' and a.id <> c.id, 'own account beside main cash');
  perform pg_temp.check((select requires_reference from public.payment_methods where id = pg_temp.v('pm_jawali')), 'wallet requires reference');
  perform pg_temp.check((select currency_code from public.payment_methods where id = pg_temp.v('pm_yer2')) is null, 'base currency stored as null');
  perform pg_temp.check((select count(distinct account_id) from public.payment_methods where id in (pg_temp.v('pm_usd'), pg_temp.v('pm_sar'), pg_temp.v('pm_old'), pg_temp.v('pm_jawali'), pg_temp.v('pm_yer2'))) = 5, 'distinct accounts');
end $$;

select public.set_exchange_rate((select id from h34), 'USD', 1600, (select v from d where k = 'today') - 5);
select public.set_exchange_rate((select id from h34), 'SAR', 420, (select v from d where k = 'today') - 5);
select public.set_exchange_rate((select id from h34), 'YRO', 3, (select v from d where k = 'today') - 5);

-- الصلاحيات
select pg_temp.act_as('00000000-0000-0000-0000-000000003403');
select pg_temp.expect_error($q$ select public.create_payment_box((select id from h34), 'cash', 'HK', 'خطأ') $q$, 'Permission denied');
select pg_temp.expect_error($q$ select * from public.cash_by_currency((select id from h34), current_date, current_date) $q$, 'Permission denied');

-- =============================================================================
-- الوردية: عهدة بكل عملة
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000003401');
insert into public.room_types (hotel_id, code, name_ar, base_rate, max_adults) select id, 'DBL', 'مزدوجة', 20000, 2 from h34;
insert into ids select 'rt', id from public.room_types where hotel_id = (select id from h34);
select public.create_rooms_bulk((select id from h34), pg_temp.v('rt'), 101, 103);
insert into ids select 'room_' || room_number, id from public.rooms where hotel_id = (select id from h34);
insert into public.guests (hotel_id, full_name) select id, 'نزيل' from h34;
insert into ids select 'g', id from public.guests where hotel_id = (select id from h34);

select pg_temp.act_as('00000000-0000-0000-0000-000000003402');
select pg_temp.expect_error($q$ select public.open_cashier_shift((select id from h34), 1000,
  jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.v('pm_cash'), 'amount', 5))) $q$, 'one opening float');
select pg_temp.expect_error($q$ select public.open_cashier_shift((select id from h34), 1000,
  jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.v('pm_jawali'), 'amount', 5))) $q$, 'Payment method not found or inactive');
select pg_temp.expect_error($q$ select public.open_cashier_shift((select id from h34), 1000,
  jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.v('pm_usd'), 'amount', -5))) $q$, 'cannot be negative');
select pg_temp.expect_error($q$ select public.open_cashier_shift((select id from h34), 1000,
  jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.v('pm_usd'), 'amount', 1.001))) $q$, 'at most 2 decimals');
insert into ids select 'shift', public.open_cashier_shift((select id from h34), 50000, jsonb_build_array(
  jsonb_build_object('payment_method_id', pg_temp.v('pm_usd'), 'amount', 100),
  jsonb_build_object('payment_method_id', pg_temp.v('pm_sar'), 'amount', 0),
  jsonb_build_object('payment_method_id', pg_temp.v('pm_old'), 'amount', 6000)));
select pg_temp.check((select count(*) from public.cashier_shift_floats where shift_id = pg_temp.v('shift')) = 2, 'zero floats skipped');

insert into ids select 'r1', public.create_reservation(p_hotel_id => (select id from h34), p_guest_id => pg_temp.v('g'),
  p_room_type_id => pg_temp.v('rt'), p_room_id => pg_temp.v('room_101'),
  p_arrival_date => (select v from d where k = 'today'), p_departure_date => (select v from d where k = 'today') + 1);
select public.check_in_reservation(pg_temp.v('r1'));
insert into ids select 'f1', folio_id from public.reservations where id = pg_temp.v('r1');

-- دفعات بالعملات
select public.post_folio_foreign_money(pg_temp.v('f1'), 'deposit', pg_temp.v('pm_usd'), 20);
select public.post_folio_foreign_money(pg_temp.v('f1'), 'deposit', pg_temp.v('pm_old'), 3000);
select public.post_folio_deposit(pg_temp.v('f1'), pg_temp.v('pm_cash'), 10000);

-- =============================================================================
-- المحفظة: رقم العملية إلزامي ولا يتكرر
-- =============================================================================
select pg_temp.expect_error($q$ select public.post_folio_deposit(pg_temp.v('f1'), pg_temp.v('pm_jawali'), 5000) $q$, 'Enter the transaction number for جوالي');
select pg_temp.expect_error($q$ select public.post_folio_deposit(pg_temp.v('f1'), pg_temp.v('pm_jawali'), 5000, null, '  ') $q$, 'Enter the transaction number');
insert into ids select 'w1', public.post_folio_deposit(pg_temp.v('f1'), pg_temp.v('pm_jawali'), 5000, null, 'jw-778899');
select pg_temp.expect_error($q$ select public.post_folio_deposit(pg_temp.v('f1'), pg_temp.v('pm_jawali'), 100, null, ' JW-778899 ') $q$, 'already used for جوالي');
-- نفس الرقم على طريقة أخرى مقبول
select public.post_folio_deposit(pg_temp.v('f1'), pg_temp.v('pm_card'), 100, null, 'JW-778899');
-- بعد إلغاء الحركة يُقبل الرقم من جديد
select pg_temp.act_as('00000000-0000-0000-0000-000000003401');
select public.void_folio_transaction(pg_temp.v('w1'), 'خطأ في المبلغ');
select pg_temp.act_as('00000000-0000-0000-0000-000000003402');
select public.post_folio_deposit(pg_temp.v('f1'), pg_temp.v('pm_jawali'), 4000, null, 'JW-778899');
-- سند القبض بالمحفظة يتحقق من الرقم نفسه
select pg_temp.act_as('00000000-0000-0000-0000-000000003401');
insert into ids select 'misc', id from public.chart_of_accounts where hotel_id = (select id from h34) and account_type = 'revenue' and is_postable order by code limit 1;
select pg_temp.expect_error($q$ select public.create_payment_voucher((select id from h34), 'receipt', 'account', pg_temp.v('pm_jawali'), 700, 'إيراد',
  p_counter_account_id => pg_temp.v('misc')) $q$, 'Enter the transaction number');
select pg_temp.expect_error($q$ select public.create_payment_voucher((select id from h34), 'receipt', 'account', pg_temp.v('pm_jawali'), 700, 'إيراد',
  p_counter_account_id => pg_temp.v('misc'), p_reference => 'jw-778899') $q$, 'already used');
select public.create_payment_voucher((select id from h34), 'receipt', 'account', pg_temp.v('pm_jawali'), 700, 'إيراد',
  p_counter_account_id => pg_temp.v('misc'), p_reference => 'JW-1');

-- =============================================================================
-- السندات والتحويلات أثناء الوردية تُحسب عليها
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000003402');
select pg_temp.check((select cashier_shift_id from public.payments where reference = 'JW-1') is null, 'voucher by another user stays off this shift');
-- المدير يفتح ورديته: سند الصرف والتحويل الذي ينشئه يُحسب عليها
select pg_temp.act_as('00000000-0000-0000-0000-000000003401');
insert into ids select 'gm_shift', public.open_cashier_shift((select id from h34), 0);
insert into ids select 'pv', public.create_payment_voucher((select id from h34), 'disbursement', 'account', pg_temp.v('pm_cash'), 1500, 'صيانة',
  p_counter_account_id => (select id from public.chart_of_accounts where hotel_id = (select id from h34) and account_type = 'expense' and is_postable order by code limit 1));
-- تصريف 50 دولار من صندوق الدولار إلى الصندوق الرئيسي بـ 80000 ريال
insert into ids select 'tr', public.create_fund_transfer((select id from h34), pg_temp.v('pm_usd'), 50, pg_temp.v('pm_cash'), 80000);
select pg_temp.check((select cashier_shift_id from public.payments where id = pg_temp.v('pv')) = pg_temp.v('gm_shift'), 'voucher on creator shift');
select pg_temp.check((select cashier_shift_id from public.fund_transfers where id = pg_temp.v('tr')) = pg_temp.v('gm_shift'), 'transfer on creator shift');
do $$
declare r jsonb := public.cashier_shift_report(pg_temp.v('gm_shift'));
  e numeric;
begin
  select (m ->> 'expected')::numeric into e from jsonb_array_elements(r -> 'methods') m where m ->> 'code' = 'CASH';
  perform pg_temp.check(e = 80000 - 1500, format('gm cash expected %s', e));
  select (m ->> 'expected')::numeric into e from jsonb_array_elements(r -> 'methods') m where m ->> 'code' = 'CASH-USD';
  perform pg_temp.check(e = -50, format('gm usd expected %s', e));
  perform pg_temp.check(jsonb_array_length(r -> 'transactions') = 3, 'voucher + two transfer sides');
  perform pg_temp.check((select count(*) from jsonb_array_elements(r -> 'transactions') x where x ->> 'source' = 'transfer') = 2, 'transfer rows');
end $$;

-- تقرير وردية الموظف: عهدة بكل عملة + المقبوض
select pg_temp.act_as('00000000-0000-0000-0000-000000003402');
do $$
declare r jsonb := public.cashier_shift_report(pg_temp.v('shift'));
  x jsonb;
begin
  select m into x from jsonb_array_elements(r -> 'methods') m where m ->> 'code' = 'CASH';
  perform pg_temp.check((x ->> 'float')::numeric = 50000 and (x ->> 'expected')::numeric = 60000, format('cash %s', x));
  select m into x from jsonb_array_elements(r -> 'methods') m where m ->> 'code' = 'CASH-USD';
  perform pg_temp.check((x ->> 'float')::numeric = 100 and (x ->> 'expected')::numeric = 120 and (x ->> 'foreign')::boolean, format('usd %s', x));
  select m into x from jsonb_array_elements(r -> 'methods') m where m ->> 'code' = 'CASH-OLD';
  perform pg_temp.check((x ->> 'expected')::numeric = 9000 and x ->> 'currency_code' = 'YRO', format('old notes %s', x));
  select m into x from jsonb_array_elements(r -> 'methods') m where m ->> 'code' = 'JAWALI';
  perform pg_temp.check((x ->> 'expected')::numeric = 4000, format('wallet net of the voided one %s', x));
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(r -> 'methods') m where m ->> 'code' = 'CASH-SAR'), 'unused SAR box hidden');
end $$;
-- الإغلاق يطلب عدّ كل صندوق نقدي بعملته
select pg_temp.expect_error($q$ select public.close_cashier_shift(pg_temp.v('shift'), jsonb_build_array(
  jsonb_build_object('payment_method_id', pg_temp.v('pm_cash'), 'counted', 60000),
  jsonb_build_object('payment_method_id', pg_temp.v('pm_usd'), 'counted', 120))) $q$, 'Count the cash in');
select public.close_cashier_shift(pg_temp.v('shift'), jsonb_build_array(
  jsonb_build_object('payment_method_id', pg_temp.v('pm_cash'), 'counted', 60000),
  jsonb_build_object('payment_method_id', pg_temp.v('pm_usd'), 'counted', 118),
  jsonb_build_object('payment_method_id', pg_temp.v('pm_old'), 'counted', 9000)));
select pg_temp.check((select difference_base from public.cashier_shift_counts where shift_id = pg_temp.v('shift') and payment_method_id = pg_temp.v('pm_usd')) = -3200,
  'USD shortage 2 x 1600');
select pg_temp.check((select (m ->> 'expected')::numeric from jsonb_array_elements(public.cashier_shift_report(pg_temp.v('shift')) -> 'methods') m where m ->> 'code' = 'CASH-USD') = 120,
  'closed shift keeps its counted expectation');

-- =============================================================================
-- تقرير النقدية بالعملات
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000003401');
-- قيد يدوي بالدولار يصرف 10 دولار من صندوق الدولار
select public.save_journal_entry((select id from h34), (select v from d where k = 'today'), 'مصروف بالدولار',
  jsonb_build_array(jsonb_build_object('account_id', (select id from public.chart_of_accounts where hotel_id = (select id from h34) and account_type = 'expense' and is_postable order by code limit 1), 'debit', 10),
                    jsonb_build_object('account_id', (select account_id from public.payment_methods where id = pg_temp.v('pm_usd')), 'credit', 10)),
  null, 'USD', 1600, null, true);
create temp table cbc as select * from public.cash_by_currency((select id from h34), (select v from d where k = 'today'), (select v from d where k = 'today'));
grant all on cbc to authenticated;
do $$
declare x record; usd_acc uuid := (select account_id from public.payment_methods where id = pg_temp.v('pm_usd'));
begin
  -- الدولار: +20 إيداع −50 تحويل −2 عجز −10 قيد = −42
  select * into x from cbc where account_id = usd_acc and currency_code = 'USD';
  perform pg_temp.check(x.receipts = 20 and x.payments = 62 and x.closing = -42 and not x.is_base, format('usd row %s', to_jsonb(x)));
  perform pg_temp.check(x.rate = 1600 and x.closing_base = -67200, 'usd base equivalent');
  perform pg_temp.check(not exists (select 1 from cbc where account_id = usd_acc and is_base), 'dedicated foreign box has no base row');
  -- الطبعة القديمة: 3000
  select * into x from cbc where currency_code = 'YRO';
  perform pg_temp.check(x.closing = 3000 and x.closing_base = 9000, format('old notes row %s', to_jsonb(x)));
  -- الصندوق الرئيسي بالريال: 10000 عربون + 80000 تحويل − 1500 صرف = 88500
  select * into x from cbc where account_id = (select account_id from public.payment_methods where id = pg_temp.v('pm_cash')) and is_base;
  perform pg_temp.check(x.closing = 88500 and x.receipts = 90000 and x.payments = 1500 and x.opening = 0, format('main cash %s', to_jsonb(x)));
  -- جوالي: 5000 − 5000 (إلغاء) + 4000 + 700 سند
  select * into x from cbc where account_id = (select account_id from public.payment_methods where id = pg_temp.v('pm_jawali'));
  perform pg_temp.check(x.closing = 4700 and x.methods = 'جوالي', format('wallet %s', to_jsonb(x)));
  -- صندوق السعودي فارغ لكنه يظهر لأنه فعّال
  perform pg_temp.check(exists (select 1 from cbc where currency_code = 'SAR' and closing = 0), 'empty active SAR box listed');
  perform pg_temp.check(not exists (select 1 from cbc join public.chart_of_accounts a on a.id = cbc.account_id where a.system_key = 'card_clearing'), 'card clearing is not cash');
end $$;
-- الأيام اللاحقة: الرصيد يصبح أول المدة
do $$
declare x record;
begin
  select * into x from public.cash_by_currency((select id from h34), (select v from d where k = 'today') + 1, (select v from d where k = 'today') + 1)
   where currency_code = 'USD';
  perform pg_temp.check(x.opening = -42 and x.receipts = 0 and x.closing = -42, format('next day usd %s', to_jsonb(x)));
end $$;
select pg_temp.expect_error($q$ select * from public.cash_by_currency((select id from h34), current_date, current_date - 1) $q$, 'Invalid date range');

-- حساب مشترك: طريقة دولار على الصندوق الرئيسي لا تُفسد رصيده بالريال
insert into public.payment_methods (hotel_id, code, name_ar, kind, account_id, currency_code)
select id, 'USD-SHARED', 'دولار على الرئيسي', 'cash', (select account_id from public.payment_methods where id = pg_temp.v('pm_cash')), 'USD' from h34;
select public.post_folio_foreign_money(pg_temp.v('f1'), 'deposit', (select id from public.payment_methods where hotel_id = (select id from h34) and code = 'USD-SHARED'), 5);
do $$
declare main uuid := (select account_id from public.payment_methods where id = pg_temp.v('pm_cash')); x record;
begin
  select * into x from public.cash_by_currency((select id from h34), (select v from d where k = 'today'), (select v from d where k = 'today'))
   where account_id = main and is_base;
  perform pg_temp.check(x.closing = 88500, format('base row excludes the dollars %s', to_jsonb(x)));
  select * into x from public.cash_by_currency((select id from h34), (select v from d where k = 'today'), (select v from d where k = 'today'))
   where account_id = main and currency_code = 'USD';
  perform pg_temp.check(x.closing = 5 and x.closing_base = 8000, format('shared dollars %s', to_jsonb(x)));
end $$;

-- الدفاتر الفرعية تطابق الأستاذ
do $$
declare r record;
begin
  for r in select x.* from public.ledger_reconciliation((select id from h34)) x loop
    if r.difference <> 0 then raise exception 'Reconciliation difference for %: %', r.control, r.difference; end if;
  end loop;
end $$;

\o
select 'yemen cash tests passed';

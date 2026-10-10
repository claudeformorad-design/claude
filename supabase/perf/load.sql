-- حمل اختباري كبير (بيانات اختبار داخل قاعدة مؤقتة فقط): 4000 فوليو كامل الدورة، 1500 فاتورة آجلة، 1000 سند قبض، 3000 قيد يدوي ≈ 20 ألف قيد
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000aaaa', 'gm@load.test');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaaa', false);
set role authenticated;
create temp table h as select public.create_hotel('فندق الحمل', 'SA', 'SAR') as id;
reset role;
update public.hotels set total_rooms = 300 where id = (select id from h);
set role authenticated;
insert into public.customers (hotel_id, code, name_ar, allow_credit, credit_limit)
select (select id from h), 'C' || g, 'عميل ' || g, true, 1000000000 from generate_series(1, 150) g;

do $$
declare
  hid uuid := (select id from h);
  room uuid := (select id from public.charge_codes where hotel_id = hid and code = 'ROOM');
  food uuid := (select id from public.charge_codes where hotel_id = hid and code = 'FOOD');
  cash uuid := (select id from public.payment_methods where hotel_id = hid and code = 'CASH');
  f uuid; d date; i int;
begin
  for i in 1..4000 loop
    d := current_date - (i % 170);
    f := public.open_folio(hid, 'نزيل ' || i);
    perform public.post_folio_charge(f, room, 400, 2, d);
    perform public.post_folio_charge(f, food, 120, 1, d);
    perform public.post_folio_payment(f, cash, 920, d);
    perform public.checkout_folio(f, d);
  end loop;
end $$;

do $$
declare
  hid uuid := (select id from h);
  ev uuid := (select id from public.charge_codes where hotel_id = hid and code = 'EVENTS');
  bank uuid := (select id from public.payment_methods where hotel_id = hid and code = 'BANK');
  c uuid; i int;
begin
  for i in 1..1500 loop
    select id into c from public.customers where hotel_id = hid and code = 'C' || (1 + i % 150);
    perform public.create_direct_invoice(hid, c, jsonb_build_array(jsonb_build_object('charge_code_id', ev, 'unit_price', 1000)), current_date - (i % 170));
  end loop;
  for i in 1..1000 loop
    select id into c from public.customers where hotel_id = hid and code = 'C' || (1 + i % 150);
    perform public.create_payment_voucher(hid, 'receipt', 'customer', bank, 500, 'دفعة', current_date - (i % 170), p_customer_id => c);
  end loop;
end $$;

do $$
declare
  hid uuid := (select id from h);
  a1 uuid := (select id from public.chart_of_accounts where hotel_id = hid and code = '5204');
  a2 uuid := (select id from public.chart_of_accounts where hotel_id = hid and code = '1103');
  i int;
begin
  for i in 1..3000 loop
    perform public.save_journal_entry(hid, current_date - (i % 170), 'مصروف ' || i,
      jsonb_build_array(jsonb_build_object('account_id', a1, 'debit', 50 + i % 70), jsonb_build_object('account_id', a2, 'credit', 50 + i % 70)),
      null, null, 1, null, true);
  end loop;
end $$;
reset role;
select (select count(*) from public.journal_entries) je, (select count(*) from public.journal_entry_lines) lines,
       (select count(*) from public.folio_transactions) ftx, (select count(*) from public.invoices) inv, (select count(*) from public.audit_logs) audit;
analyze;

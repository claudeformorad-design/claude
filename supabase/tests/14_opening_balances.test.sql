-- =============================================================================
-- اختبارات الأرصدة الافتتاحية: قيد واحد، فواتير عملاء وموردين افتتاحية تُحصَّل وتُسدَّد،
-- حسابات المراقبة ممنوعة مباشرة، الفرق للأرباح المبقاة، ومرة واحدة فقط
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001401', 'gm14@hotel.test'),
  ('00000000-0000-0000-0000-000000001402', 'acc14@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000001401');
create temp table h14 as select public.create_hotel('فندق الانتقال', 'YE', 'YER') as id;
create temp table ids (k text primary key, v uuid);
create temp table d (k text primary key, v date);
grant all on h14, ids, d to authenticated;
create or replace function pg_temp.acc(p_key text) returns uuid language sql as $$
  select id from public.chart_of_accounts where hotel_id = (select id from h14) and system_key = p_key;
$$;
insert into d select 'today', app.today_for_hotel(id) from h14;
select public.add_hotel_member((select id from h14), 'acc14@hotel.test',
  array[(select id from public.roles where is_system and code = 'accountant')]);
insert into public.customers (hotel_id, code, name_ar, customer_type, allow_credit) select id, 'ACME', 'شركة النخبة', 'company', true from h14;
insert into public.vendors (hotel_id, code, name_ar) select id, 'V1', 'مورد الأغذية' from h14;
insert into ids select 'cust', id from public.customers where hotel_id = (select id from h14);
insert into ids select 'vendor', id from public.vendors where hotel_id = (select id from h14);

-- المحاسب بلا صلاحية إدارة الفندق لا يرحّل الأرصدة الافتتاحية
select pg_temp.act_as('00000000-0000-0000-0000-000000001402');
select pg_temp.expect_error($q$ select public.post_opening_balances((select id from h14), (select v from d where k = 'today'),
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('cash'), 'debit', 100))) $q$, 'Permission denied');

select pg_temp.act_as('00000000-0000-0000-0000-000000001401');
select pg_temp.expect_error($q$ select public.post_opening_balances((select id from h14), (select v from d where k = 'today'),
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('ar_control'), 'debit', 100))) $q$, 'is a control account');
select pg_temp.expect_error($q$ select public.post_opening_balances((select id from h14), (select v from d where k = 'today'),
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('cash'), 'debit', 100, 'credit', 5))) $q$, 'either a debit or a credit');
select pg_temp.expect_error($q$ select public.post_opening_balances((select id from h14), (select v from d where k = 'today')) $q$, 'at least one opening balance');

insert into ids select 'je', public.post_opening_balances((select id from h14), (select v from d where k = 'today'),
  jsonb_build_array(
    jsonb_build_object('account_id', pg_temp.acc('cash'), 'debit', 50000),
    jsonb_build_object('account_id', pg_temp.acc('bank'), 'debit', 150000),
    jsonb_build_object('account_id', pg_temp.acc('capital'), 'credit', 300000)),
  jsonb_build_array(jsonb_build_object('customer_id', (select v from ids where k = 'cust'), 'amount', 20000, 'reference', 'كشف 2025')),
  jsonb_build_array(jsonb_build_object('vendor_id', (select v from ids where k = 'vendor'), 'amount', 10000, 'reference', 'F-77')));

do $$
declare h uuid := (select id from h14);
begin
  assert (select status from public.journal_entries where id = (select v from ids where k = 'je')) = 'posted', 'opening posted';
  assert (select source from public.journal_entries where id = (select v from ids where k = 'je')) = 'opening', 'opening source';
  assert pg_temp.gl(h, 'cash') = 50000 and pg_temp.gl(h, 'bank') = 150000, 'cash and bank';
  assert pg_temp.gl(h, 'capital') = -300000, 'capital';
  assert pg_temp.gl(h, 'ar_control') = 20000 and pg_temp.gl(h, 'ap_control') = -10000, 'control accounts';
  -- 220000 مدين مقابل 310000 دائن ⇒ 90000 مدين في الأرباح المبقاة
  assert pg_temp.gl(h, 'retained_earnings') = 90000, format('retained %s', pg_temp.gl(h, 'retained_earnings'));
  assert (select sum(debit) - sum(credit) from public.journal_entry_lines where journal_entry_id = (select v from ids where k = 'je')) = 0, 'balanced';
  assert (select amount_due - amount_paid from public.invoices where hotel_id = h and invoice_type = 'opening') = 20000, 'customer invoice open';
  assert (select invoice_number from public.invoices where hotel_id = h and invoice_type = 'opening') like 'OB-%', 'numbered';
  assert (select total - amount_paid from public.vendor_bills where hotel_id = h) = 10000, 'vendor bill open';
  assert not exists (select 1 from public.ledger_reconciliation(h) where difference <> 0), 'subledgers reconcile';
end $$;

select pg_temp.expect_error($q$ select public.post_opening_balances((select id from h14), (select v from d where k = 'today'),
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('cash'), 'debit', 1))) $q$, 'already posted');

select pg_temp.act_as(null);
\o
select '✓ 14_opening_balances: all assertions passed';

-- =============================================================================
-- اختبارات الشيكات المؤجلة: الطرق والحسابات تُنشأ تلقائيًا، تسجيل الشيك على سنده، التحصيل والصرف،
-- الارتداد قبل التحصيل وبعده (تعود الفاتورة غير مسددة)، والصلاحيات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002601', 'gm26@hotel.test'),
  ('00000000-0000-0000-0000-000000002602', 'cash26@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000002601');
create temp table h26 as select public.create_hotel('فندق الشيكات', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h26, ids to authenticated;
create or replace function pg_temp.pm(p_code text) returns uuid language sql as $$
  select id from public.payment_methods where hotel_id = (select id from h26) and code = p_code;
$$;
select public.add_hotel_member((select id from h26), 'cash26@hotel.test', array[(select id from public.roles where is_system and code = 'cashier')]);

-- الطريقتان وحساباهما موجودة للفندق الجديد
select pg_temp.check(pg_temp.pm('CHQ_IN') is not null and pg_temp.pm('CHQ_OUT') is not null, 'cheque methods seeded');
select pg_temp.check((select account_type from public.chart_of_accounts where hotel_id = (select id from h26) and system_key = 'cheques_receivable') = 'asset', 'receivable account');
select pg_temp.check((select account_type from public.chart_of_accounts where hotel_id = (select id from h26) and system_key = 'cheques_payable') = 'liability', 'payable account');

-- فاتورة آجلة لعميل تُسدَّد بشيك مؤجل
insert into public.customers (hotel_id, code, name_ar, allow_credit) select id, 'ACME', 'شركة النخبة', true from h26;
insert into ids select 'cust', id from public.customers where hotel_id = (select id from h26) and code = 'ACME';
insert into ids select 'inv', public.create_direct_invoice((select id from h26), (select v from ids where k = 'cust'),
  jsonb_build_array(jsonb_build_object('charge_code_id', (select id from public.charge_codes where hotel_id = (select id from h26) and code = 'EVENTS'), 'unit_price', 1000)));
insert into ids select 'rv', public.create_payment_voucher((select id from h26), 'receipt', 'customer', pg_temp.pm('CHQ_IN'), 1000, 'شيك من الشركة',
  p_customer_id => (select v from ids where k = 'cust'),
  p_allocations => jsonb_build_array(jsonb_build_object('invoice_id', (select v from ids where k = 'inv'), 'amount', 1000)));
select pg_temp.check((select status from public.invoices where id = (select v from ids where k = 'inv')) = 'paid', 'invoice paid by cheque');
select pg_temp.check(pg_temp.gl((select id from h26), 'cheques_receivable') = 1000, 'cheque held under collection');

-- لا شيك على سند نقدي، ولا شيك مرتين
insert into ids select 'cash_rv', public.create_payment_voucher((select id from h26), 'receipt', 'account', pg_temp.pm('CASH'), 50, 'إيراد متنوع',
  p_counter_account_id => (select id from public.chart_of_accounts where hotel_id = (select id from h26) and code = '4201'));
select pg_temp.expect_error($q$ select public.register_cheque((select v from ids where k = 'cash_rv'), '1', 'x', current_date) $q$, 'not paid by a post-dated cheque');
insert into ids select 'chq', public.register_cheque((select v from ids where k = 'rv'), '000123', 'بنك الرياض', current_date + 30);
select pg_temp.expect_error($q$ select public.register_cheque((select v from ids where k = 'rv'), '000124', 'x', current_date) $q$, 'already has a cheque');

-- التحصيل يحتاج حسابًا بنكيًا
select pg_temp.expect_error($q$ select public.clear_cheque((select v from ids where k = 'chq'), pg_temp.pm('CASH')) $q$, 'bank account');
select public.clear_cheque((select v from ids where k = 'chq'), pg_temp.pm('BANK'));
select pg_temp.check(pg_temp.gl((select id from h26), 'cheques_receivable') = 0, 'cleared out of holding');
select pg_temp.check(pg_temp.gl((select id from h26), 'bank') = 1000, 'bank received');
select pg_temp.expect_error($q$ select public.clear_cheque((select v from ids where k = 'chq'), pg_temp.pm('BANK')) $q$, 'Only a pending cheque');

-- ارتداد بعد التحصيل: يعكس التحصيل ويلغي السند فتعود الفاتورة مستحقة
select pg_temp.expect_error($q$ select public.bounce_cheque((select v from ids where k = 'chq'), '') $q$, 'reason is required');
select public.bounce_cheque((select v from ids where k = 'chq'), 'رصيد غير كافٍ');
select pg_temp.check((select status from public.cheques where id = (select v from ids where k = 'chq')) = 'bounced', 'bounced');
select pg_temp.check((select status from public.payments where id = (select v from ids where k = 'rv')) = 'voided', 'voucher voided');
select pg_temp.check((select status from public.invoices where id = (select v from ids where k = 'inv')) = 'issued', 'invoice open again');
select pg_temp.check(pg_temp.gl((select id from h26), 'bank') = 0 and pg_temp.gl((select id from h26), 'cheques_receivable') = 0, 'ledger back to zero');

-- شيك صادر لمصروف، ثم صرفه من البنك
insert into ids select 'pv', public.create_payment_voucher((select id from h26), 'disbursement', 'account', pg_temp.pm('CHQ_OUT'), 700, 'صيانة المصاعد',
  p_counter_account_id => (select id from public.chart_of_accounts where hotel_id = (select id from h26) and code = '5208'));
insert into ids select 'chq_out', public.register_cheque((select v from ids where k = 'pv'), '900001', 'البنك الأهلي', current_date + 15);
select pg_temp.check(pg_temp.gl((select id from h26), 'cheques_payable') = -700, 'issued cheque payable');
select public.clear_cheque((select v from ids where k = 'chq_out'), pg_temp.pm('BANK'));
select pg_temp.check(pg_temp.gl((select id from h26), 'cheques_payable') = 0 and pg_temp.gl((select id from h26), 'bank') = -700, 'issued cheque cleared');
select pg_temp.expect_error($q$ select public.bounce_cheque((select v from ids where k = 'chq_out'), 'خطأ') $q$, 'can no longer');

-- الكاشير يسجل شيكًا واردًا لكنه لا يصرف شيكًا صادرًا
select pg_temp.act_as('00000000-0000-0000-0000-000000002602');
select pg_temp.check((select count(*) from public.cheques where hotel_id = (select id from h26)) = 2, 'cashier sees cheques');
select pg_temp.expect_error($q$ select public.register_cheque((select v from ids where k = 'pv'), '1', 'x', current_date) $q$, 'Permission denied');

select pg_temp.act_as(null);
\o
select 'cheques tests passed';

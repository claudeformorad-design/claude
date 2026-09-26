-- =============================================================================
-- اختبارات المرحلة 6: الموافقات، الإقفال السنوي، إدارة المستخدمين، الإقرار الضريبي
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'gm6@hotel.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'acct6@hotel.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'new6@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
create temp table h6 as select public.create_hotel('فندق المرحلة 6', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h6, ids to authenticated;
insert into ids select 'acc_' || code, id from public.chart_of_accounts where hotel_id = (select id from h6);
insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h6);

-- =============================================================================
-- إدارة المستخدمين
-- =============================================================================
select public.add_hotel_member((select id from h6), 'ACCT6@hotel.test',
  array[(select id from public.roles where is_system and code = 'accountant')]);
select pg_temp.expect_error($q$ select public.add_hotel_member((select id from h6), 'nobody@x.test', '{}') $q$, 'No registered user');
do $$ begin
  assert (select count(*) from public.hotel_members_overview((select id from h6))) = 2, 'two members';
  assert (select 'acct6@hotel.test' = email from public.hotel_members_overview((select id from h6)) where user_id = '00000000-0000-0000-0000-0000000000f2'), 'email listed';
end $$;

-- دور مخصص بصلاحيات محددة
insert into public.roles (hotel_id, code, name_ar, name_en) select id, 'night_auditor', 'مدقق ليلي', 'Night auditor' from h6;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'folio.view' from public.roles r where r.code = 'night_auditor' and r.hotel_id = (select id from h6);
select public.add_hotel_member((select id from h6), 'new6@hotel.test', array[(select id from public.roles where code = 'night_auditor' and hotel_id = (select id from h6))]);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f3');
do $$ begin assert (select array_agg(p) from public.my_permissions((select id from h6)) p) = array['folio.view'], 'custom role permissions'; end $$;
select pg_temp.expect_error($q$ select public.hotel_members_overview((select id from h6)) $q$, 'Permission denied');

-- =============================================================================
-- الموافقات (Maker-Checker)
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
update public.hotels set journal_approval_threshold = 10000, voucher_approval_threshold = 5000 where id = (select id from h6);

-- المحاسب ينشئ قيدًا كبيرًا: لا يستطيع ترحيله بنفسه
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
insert into ids select 'big', public.save_journal_entry((select id from h6), current_date, 'رأس مال كبير',
  jsonb_build_array(jsonb_build_object('account_id', (select v from ids where k = 'acc_1103'), 'debit', 100000),
                    jsonb_build_object('account_id', (select v from ids where k = 'acc_3101'), 'credit', 100000)));
select pg_temp.expect_error($q$ select public.post_journal_entry((select v from ids where k = 'big')) $q$, 'requires approval');
-- قيد صغير يرحّله المحاسب بنفسه
select public.save_journal_entry((select id from h6), current_date, 'قيد صغير',
  jsonb_build_array(jsonb_build_object('account_id', (select v from ids where k = 'acc_1101'), 'debit', 500),
                    jsonb_build_object('account_id', (select v from ids where k = 'acc_3101'), 'credit', 500)), null, null, 1, null, true);
-- سند صرف كبير يحتاج اعتمادًا
select pg_temp.expect_error($q$
  select public.create_payment_voucher((select id from h6), 'disbursement', 'account', (select v from ids where k = 'pm_bank'), 6000,
    'إيجار', p_counter_account_id => (select v from ids where k = 'acc_5301'))
$q$, 'requires approval');

-- المدير العام (شخص آخر) يعتمد ويرحّل
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select public.post_journal_entry((select v from ids where k = 'big'));
select public.create_payment_voucher((select id from h6), 'disbursement', 'account', (select v from ids where k = 'pm_bank'), 6000,
  'إيجار', p_counter_account_id => (select v from ids where k = 'acc_5301'));

-- المنشئ نفسه لا يعتمد قيده حتى لو كان مديرًا
insert into ids select 'big2', public.save_journal_entry((select id from h6), current_date, 'قيد المدير',
  jsonb_build_array(jsonb_build_object('account_id', (select v from ids where k = 'acc_1103'), 'debit', 20000),
                    jsonb_build_object('account_id', (select v from ids where k = 'acc_3101'), 'credit', 20000)));
select pg_temp.expect_error($q$ select public.post_journal_entry((select v from ids where k = 'big2')) $q$, 'different user');
delete from public.journal_entries where id = (select v from ids where k = 'big2');

-- =============================================================================
-- الإقرار الضريبي
-- =============================================================================
insert into public.tax_rates (hotel_id, code, name_ar, kind, rate, account_id)
select id, 'VAT', 'ض.ق.م', 'vat', 15, (select v from ids where k = 'acc_2110') from h6;
insert into public.charge_code_taxes (hotel_id, charge_code_id, tax_rate_id)
select (select id from h6), c.id, t.id from public.charge_codes c, public.tax_rates t
where c.hotel_id = (select id from h6) and c.code in ('ROOM', 'EVENTS') and t.hotel_id = (select id from h6);
insert into public.customers (hotel_id, code, name_ar, allow_credit) select id, 'C1', 'شركة', true from h6;

insert into ids select 'f', public.open_folio((select id from h6), 'نزيل');
insert into ids select 'room', public.post_folio_charge((select v from ids where k = 'f'),
  (select id from public.charge_codes where hotel_id = (select id from h6) and code = 'ROOM'), 1000);
select public.post_folio_allowance((select v from ids where k = 'f'), (select v from ids where k = 'room'), 115, 'خصم');
insert into ids select 'inv', public.create_direct_invoice((select id from h6), (select id from public.customers where hotel_id = (select id from h6)),
  jsonb_build_array(jsonb_build_object('charge_code_id', (select id from public.charge_codes where hotel_id = (select id from h6) and code = 'EVENTS'), 'unit_price', 2000)));
select public.create_credit_note((select v from ids where k = 'inv'), 230, 'خصم');
insert into public.vendors (hotel_id, code, name_ar) select id, 'V', 'مورد' from h6;
select public.create_vendor_bill((select id from h6), (select id from public.vendors where hotel_id = (select id from h6)),
  jsonb_build_array(jsonb_build_object('description', 'صيانة', 'account_id', (select v from ids where k = 'acc_5208'), 'quantity', 1, 'unit_price', 400,
    'tax_rate_id', (select id from public.tax_rates where hotel_id = (select id from h6)))));

do $$
declare r record;
begin
  select * into r from public.tax_return((select id from h6), current_date, current_date) where code = 'VAT';
  -- المبيعات: 1000 − 100 (خصم) + 2000 − 200 (إشعار) = 2700 ؛ الضريبة 150 − 15 + 300 − 30 = 405
  assert r.sales_base = 2700 and r.sales_tax = 405, format('sales %s / %s', r.sales_base, r.sales_tax);
  assert r.purchases_base = 400 and r.purchases_tax = 60, 'purchases';
end $$;
select pg_temp.act_as(null);
do $$ begin
  -- الإقرار يطابق الأستاذ: ضريبة المخرجات − المدخلات
  assert -pg_temp.gl((select id from h6), 'vat_output') = 405, 'output VAT GL';
  assert pg_temp.gl((select id from h6), 'vat_input') = 60, 'input VAT GL';
end $$;

-- =============================================================================
-- الإقفال السنوي
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
insert into ids select 'fy', id from public.fiscal_years where hotel_id = (select id from h6);
select pg_temp.expect_error($q$ select public.set_period_status('00000000-0000-0000-0000-000000000000', 'closed') $q$, 'not found');
select public.close_fiscal_year((select v from ids where k = 'fy'));

select pg_temp.act_as(null);
do $$
declare h uuid := (select id from h6); v_rev numeric;
begin
  -- كل حسابات الإيرادات والمصروفات صفرية بعد الإقفال
  select coalesce(sum(l.debit - l.credit), 0) into v_rev from public.journal_entry_lines l
    join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
    join public.chart_of_accounts a on a.id = l.account_id and a.account_type in ('revenue', 'expense')
   where l.hotel_id = h;
  assert v_rev = 0, 'P&L accounts zeroed: ' || v_rev;
  -- صافي الربح = إيراد 900 + 1800 (صافي الغرف والقاعات) − 6000 إيجار − 400 صيانة = −3700 ⇒ مدين الأرباح المبقاة
  assert pg_temp.gl(h, 'retained_earnings') = 3700, 'retained earnings: ' || pg_temp.gl(h, 'retained_earnings');
  assert (select status from public.fiscal_years where id = (select v from ids where k = 'fy')) = 'closed', 'year closed';
  assert (select count(*) from public.accounting_periods where fiscal_year_id = (select v from ids where k = 'fy') and status = 'open') = 0, 'periods closed';
end $$;

-- لا يُعاد فتح فترة من سنة مقفلة، ولا يُرحّل فيها (المحاسب لا يملك الاستثناء)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect_error($q$
  select public.set_period_status((select id from public.accounting_periods where fiscal_year_id = (select v from ids where k = 'fy') limit 1), 'open')
$q$, 'closed fiscal year');
select pg_temp.expect_error($q$ select public.close_fiscal_year((select v from ids where k = 'fy')) $q$, 'already closed');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select pg_temp.expect_error($q$
  select public.post_folio_charge((select v from ids where k = 'f'), (select id from public.charge_codes where hotel_id = (select id from h6) and code = 'ROOM'), 100)
$q$, 'is closed');


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
\echo '  ✓ approvals, year-end closing, user management and tax return tests passed'

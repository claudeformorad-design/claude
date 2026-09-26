-- =============================================================================
-- اختبارات التدقيق النهائي: ثغرات منطقية اكتُشفت في المراجعة (يجب أن تُرفض كلها)
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9', 'gm7@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a9');
create temp table h7 as select public.create_hotel('فندق التدقيق', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h7, ids to authenticated;
insert into ids select 'acc_' || code, id from public.chart_of_accounts where hotel_id = (select id from h7);
insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h7);

-- 1) القيد اليدوي لا يمس حسابات المراقبة (ذمم النزلاء/الودائع/المدينة/الدائنة)
select pg_temp.expect_error($q$
  select public.save_journal_entry((select id from h7), current_date, 'تلاعب بذمم النزلاء',
    jsonb_build_array(jsonb_build_object('account_id', (select v from ids where k = 'acc_1110'), 'debit', 100),
                      jsonb_build_object('account_id', (select v from ids where k = 'acc_4101'), 'credit', 100)))
$q$, 'control account');
select pg_temp.expect_error($q$
  select public.save_journal_entry((select id from h7), current_date, 'تلاعب بالموردين',
    jsonb_build_array(jsonb_build_object('account_id', (select v from ids where k = 'acc_5204'), 'debit', 100),
                      jsonb_build_object('account_id', (select v from ids where k = 'acc_2101'), 'credit', 100)))
$q$, 'control account');

-- 1ب) ولا حساب مخزون مرتبط بأصناف
insert into public.inventory_items (hotel_id, sku, name_ar, inventory_account_id, expense_account_id)
select id, 'SOAP', 'صابون', (select v from ids where k = 'acc_1122'), (select v from ids where k = 'acc_5207') from h7;
select pg_temp.expect_error($q$
  select public.save_journal_entry((select id from h7), current_date, 'تلاعب بالمخزون',
    jsonb_build_array(jsonb_build_object('account_id', (select v from ids where k = 'acc_1122'), 'debit', 100),
                      jsonb_build_object('account_id', (select v from ids where k = 'acc_3101'), 'credit', 100)))
$q$, 'control account');

-- 2) لا يُغيّر المستخدم المفتاح النظامي لحساب
select pg_temp.expect_error($q$
  update public.chart_of_accounts set system_key = null where id = (select v from ids where k = 'acc_1101')
$q$, 'System keys');
select pg_temp.expect_error($q$
  update public.chart_of_accounts set system_key = 'my_cash' where id = (select v from ids where k = 'acc_1103')
$q$, 'System keys');

-- 3) طريقة دفع مستخدمة لا يتغير نوعها أو حسابها، وصنف له حركات لا يتغير حسابه
insert into ids select 'f', public.open_folio((select id from h7), 'نزيل');
select public.post_folio_charge((select v from ids where k = 'f'), (select id from public.charge_codes where hotel_id = (select id from h7) and code = 'FOOD'), 100);
select public.post_folio_payment((select v from ids where k = 'f'), (select v from ids where k = 'pm_cash'), 50);
select pg_temp.expect_error($q$ update public.payment_methods set kind = 'city_ledger' where id = (select v from ids where k = 'pm_cash') $q$, 'already used');
select pg_temp.expect_error($q$ update public.payment_methods set account_id = (select v from ids where k = 'acc_1103') where id = (select v from ids where k = 'pm_cash') $q$, 'already used');
update public.payment_methods set name_ar = 'نقد (الصندوق الرئيسي)' where id = (select v from ids where k = 'pm_cash');
select public.post_inventory_movement((select id from public.inventory_items where hotel_id = (select id from h7)), 'receipt', 5, current_date, 3);
select pg_temp.expect_error($q$
  update public.inventory_items set inventory_account_id = (select v from ids where k = 'acc_1120') where hotel_id = (select id from h7)
$q$, 'already has movements');

-- 4) قائمة الدخل وربحية الأقسام بعد الإقفال السنوي تبقى تُظهر ربح السنة
select public.close_fiscal_year((select id from public.fiscal_years where hotel_id = (select id from h7)));
do $$
declare h uuid := (select id from h7); fy public.fiscal_years%rowtype; v numeric;
begin
  select * into fy from public.fiscal_years where hotel_id = h;
  select sum(period_credit - period_debit) into v
  from public.gl_account_activity(h, fy.start_date, fy.start_date, fy.end_date, true) a
  join public.chart_of_accounts c on c.id = a.account_id and c.account_type = 'revenue';
  assert v = 100, 'income statement excludes closing entry: ' || coalesce(v::text, 'null');
  assert (select sum(amount) from public.department_profitability(h, fy.start_date, fy.end_date) where account_type = 'revenue') = 100, 'profitability excludes closing';
  assert (select sum(revenue) from public.monthly_pnl(h, fy.start_date, fy.end_date)) = 100, 'monthly pnl excludes closing';
end $$;

-- 5) require_permission يرفض أدوار الواجهة البرمجية بلا مستخدم (دفاع إضافي)
select pg_temp.act_as(null);
do $$
begin
  perform set_config('request.jwt.claim.role', 'anon', false);
  begin
    perform app.require_permission((select id from h7), 'coa.accounts.view');
    raise exception 'anon should be rejected';
  exception when others then
    if sqlerrm not like 'Permission denied%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.role', '', false);
  perform app.require_permission((select id from h7), 'coa.accounts.view'); -- سياق النظام الحقيقي مسموح
end $$;

-- 6) btree_gist خارج المخطط العام
do $$ begin
  assert (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'btree_gist') <> 'public', 'btree_gist not in public';
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
\echo '  ✓ hardening tests passed'

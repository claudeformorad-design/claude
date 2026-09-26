-- =============================================================================
-- اختبارات المرحلة 4: الأصول والإهلاك، المخزون، ربحية الأقسام
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'gm4@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
create temp table h4 as select public.create_hotel('فندق المرحلة 4', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h4, ids to authenticated;
insert into ids select 'acc_' || code, id from public.chart_of_accounts where hotel_id = (select id from h4);
insert into ids select 'dept_' || lower(code), id from public.departments where hotel_id = (select id from h4);

do $$ begin
  assert (select count(*) from public.chart_of_accounts where hotel_id = (select id from h4) and code in ('4203', '5402', '5104')) = 3, 'phase 4 accounts seeded';
end $$;

-- =============================================================================
-- الأصول: شراء أثاث 12,000 عمر 36 شهرًا وخردة 1,200 ⇒ إهلاك شهري 300
-- =============================================================================
insert into ids select 'asset', public.register_fixed_asset((select id from h4), 'أثاث اللوبي', 'أثاث',
  (select v from ids where k = 'acc_1202'), 12000, 36, date_trunc('year', current_date)::date, 1200,
  (select v from ids where k = 'dept_rooms'), null, (select v from ids where k = 'acc_3101'));

select pg_temp.expect_error($q$
  select public.register_fixed_asset((select id from h4), 'x', 'x', (select v from ids where k = 'acc_1101'), 100, 12, current_date,
    0, null, null, (select v from ids where k = 'acc_3101'))
$q$, 'fixed-asset account');

-- الإهلاك يبدأ من الشهر التالي للشراء
do $$
declare m0 date := date_trunc('year', current_date)::date;
begin
  assert public.run_depreciation((select id from h4), m0) = 0, 'no depreciation in acquisition month';
  assert public.run_depreciation((select id from h4), (m0 + interval '1 month')::date) = 1, 'first month';
  assert public.run_depreciation((select id from h4), (m0 + interval '1 month')::date) = 0, 'month not repeated';
  assert public.run_depreciation((select id from h4), (m0 + interval '2 month')::date) = 1, 'second month';
end $$;

select pg_temp.act_as(null);
do $$
declare h uuid := (select id from h4);
begin
  assert (select accumulated_depreciation from public.fixed_assets where id = (select v from ids where k = 'asset')) = 600, 'accumulated 600';
  assert pg_temp.gl(h, 'accumulated_depreciation') = -600, 'GL accumulated depreciation';
  assert pg_temp.gl(h, 'depreciation_expense') = 600, 'depreciation expense';
  assert (select sum(debit) from public.journal_entry_lines l join public.chart_of_accounts a on a.id = l.account_id and a.system_key = 'depreciation_expense'
          where l.department_id = (select v from ids where k = 'dept_rooms')) = 600, 'expense on rooms cost center';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');

-- بيع الأصل بـ 11,000: القيمة الدفترية 11,400 ⇒ خسارة 400
select public.dispose_fixed_asset((select v from ids where k = 'asset'), (date_trunc('year', current_date) + interval '2 month 10 days')::date,
  11000, (select v from ids where k = 'acc_1103'));
select pg_temp.expect_error($q$
  select public.dispose_fixed_asset((select v from ids where k = 'asset'), current_date)
$q$, 'already disposed');
select pg_temp.act_as(null);
do $$
declare h uuid := (select id from h4);
begin
  assert pg_temp.gl(h, 'asset_disposal_loss') = 400, 'loss on disposal';
  assert pg_temp.gl(h, 'accumulated_depreciation') = 0, 'accumulated cleared';
  assert (select coalesce(sum(debit - credit), 0) from public.journal_entry_lines where account_id = (select v from ids where k = 'acc_1202')) = 0, 'asset cost cleared';
end $$;

-- الإهلاك الكامل: الشهر الأخير يأخذ المتبقي بالضبط (1000 / 3 أشهر = 333.33، 333.33، 333.34)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
insert into ids select 'laptop', public.register_fixed_asset((select id from h4), 'حاسوب', 'أجهزة',
  (select v from ids where k = 'acc_1203'), 1000, 3, date_trunc('year', current_date)::date, 0, null, null, (select v from ids where k = 'acc_1103'));
do $$
declare m0 date := date_trunc('year', current_date)::date; i int;
begin
  for i in 1..5 loop perform public.run_depreciation((select id from h4), (m0 + make_interval(months => i))::date); end loop;
end $$;
select pg_temp.act_as(null);
do $$ begin
  assert (select status = 'fully_depreciated' and accumulated_depreciation = 1000 from public.fixed_assets where id = (select v from ids where k = 'laptop')), 'fully depreciated exactly';
  assert (select array_agg(amount order by period_month) from public.depreciation_schedule where asset_id = (select v from ids where k = 'laptop')) = array[333.33, 333.33, 333.34]::numeric[], 'last month takes remainder';
end $$;

-- =============================================================================
-- المخزون: متوسط التكلفة المرجّح، صرف للمطعم ⇒ تكلفة مبيعات بالقسم
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
insert into public.inventory_items (hotel_id, sku, name_ar, unit, inventory_account_id, expense_account_id, reorder_level, quantity_on_hand)
select id, 'RICE-5KG', 'أرز 5 كجم', 'bag', (select v from ids where k = 'acc_1120'), (select v from ids where k = 'acc_5101'), 5, 999 from h4;
insert into ids select 'rice', id from public.inventory_items where hotel_id = (select id from h4);
do $$ begin assert (select quantity_on_hand from public.inventory_items where id = (select v from ids where k = 'rice')) = 0, 'qty cannot be set directly'; end $$;
select pg_temp.expect_error($q$ update public.inventory_items set quantity_on_hand = 5 where id = (select v from ids where k = 'rice') $q$, 'inventory movements');

-- وارد من فاتورة مورد (بلا قيد إضافي) + وارد افتتاحي (بقيد)
insert into public.vendors (hotel_id, code, name_ar) select id, 'V1', 'مورد' from h4;
insert into ids select 'bill', public.create_vendor_bill((select id from h4), (select id from public.vendors where hotel_id = (select id from h4)),
  jsonb_build_array(jsonb_build_object('description', 'أرز', 'account_id', (select v from ids where k = 'acc_1120'), 'quantity', 10, 'unit_price', 50)));
select public.post_inventory_movement((select v from ids where k = 'rice'), 'receipt', 10, current_date, 50, null, (select v from ids where k = 'bill'));
select public.post_inventory_movement((select v from ids where k = 'rice'), 'receipt', 10, current_date, 60);

select pg_temp.act_as(null);
do $$ begin
  assert (select quantity_on_hand = 20 and average_cost = 55 from public.inventory_items where id = (select v from ids where k = 'rice')), 'weighted average 55';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');

select public.post_inventory_movement((select v from ids where k = 'rice'), 'issue', 8, current_date, null, (select v from ids where k = 'dept_fnb'));
select pg_temp.expect_error($q$
  select public.post_inventory_movement((select v from ids where k = 'rice'), 'issue', 13, current_date, null, (select v from ids where k = 'dept_fnb'))
$q$, 'Insufficient stock');
-- جرد: عجز كيس واحد
select public.post_inventory_movement((select v from ids where k = 'rice'), 'adjustment', -1, current_date, null, (select v from ids where k = 'dept_fnb'), null, 'عجز جرد');

select pg_temp.act_as(null);
do $$
declare h uuid := (select id from h4);
begin
  assert (select quantity_on_hand from public.inventory_items where id = (select v from ids where k = 'rice')) = 11, 'qty after issue and adjustment';
  assert pg_temp.gl(h, 'cogs_food') = 440, 'COGS = 8 × 55';
  assert pg_temp.gl(h, 'inventory_adjustment') = 55 - 600, 'adjustments: opening receipt credit 600, shortage debit 55';
  -- ثابت: حساب المخزون في الأستاذ = الكمية × متوسط التكلفة
  assert pg_temp.gl(h, 'inventory_food') = (select quantity_on_hand * average_cost from public.inventory_items where id = (select v from ids where k = 'rice')), 'GL inventory = stock value';
end $$;

-- وارد مرتبط بفاتورة مورد لا يتجاوز قيمة بنودها على حساب المخزون (الفاتورة 500 ووارد منها 500)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect_error($q$
  select public.post_inventory_movement((select v from ids where k = 'rice'), 'receipt', 1, current_date, 1, null, (select v from ids where k = 'bill'))
$q$, 'exceed the vendor bill');

-- لا انجراف تقريب: 3 وحدات بقيمة 10.00 تُصرف واحدة واحدة (3.33 + 3.34 + 3.33) ⇒ القيمة والأستاذ صفر بالضبط
insert into public.inventory_items (hotel_id, sku, name_ar, unit, inventory_account_id, expense_account_id)
select id, 'OIL-1L', 'زيت', 'btl', (select v from ids where k = 'acc_1120'), (select v from ids where k = 'acc_5101') from h4;
insert into ids select 'oil', id from public.inventory_items where hotel_id = (select id from h4) and sku = 'OIL-1L';
select public.post_inventory_movement((select v from ids where k = 'oil'), 'receipt', 3, current_date, 3.333333);
select public.post_inventory_movement((select v from ids where k = 'oil'), 'issue', 1, current_date, null, (select v from ids where k = 'dept_fnb'));
select public.post_inventory_movement((select v from ids where k = 'oil'), 'issue', 1, current_date, null, (select v from ids where k = 'dept_fnb'));
select public.post_inventory_movement((select v from ids where k = 'oil'), 'issue', 1, current_date, null, (select v from ids where k = 'dept_fnb'));
select pg_temp.act_as(null);
do $$
declare h uuid := (select id from h4);
begin
  assert (select quantity_on_hand = 0 and stock_value = 0 from public.inventory_items where id = (select v from ids where k = 'oil')), 'oil fully consumed';
  assert (select array_agg(total_cost order by total_cost) from public.inventory_transactions
          where item_id = (select v from ids where k = 'oil') and txn_type = 'issue') = array[3.33, 3.33, 3.34]::numeric[], 'issue values';
  assert pg_temp.gl(h, 'inventory_food') = (select sum(stock_value) from public.inventory_items where hotel_id = h), 'GL inventory = Σ stock value (no drift)';
end $$;

-- =============================================================================
-- ربحية الأقسام
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
insert into ids select 'folio', public.open_folio((select id from h4), 'نزيل');
select public.post_folio_charge((select v from ids where k = 'folio'), (select id from public.charge_codes where hotel_id = (select id from h4) and code = 'FOOD'), 1000);
do $$
declare fnb uuid := (select v from ids where k = 'dept_fnb');
begin
  assert (select sum(amount) from public.department_profitability((select id from h4), date_trunc('year', current_date)::date, current_date)
          where department_id = fnb and account_type = 'revenue') = 1000, 'F&B revenue';
  assert (select sum(amount) from public.department_profitability((select id from h4), date_trunc('year', current_date)::date, current_date)
          where department_id = fnb and account_type = 'expense') = 440 + 55 + 10, 'F&B costs (COGS + shortage + oil issues)';
end $$;

select pg_temp.act_as(null);
do $$ begin
  assert (select sum(debit) = sum(credit) from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id
          and j.status = 'posted' where l.hotel_id = (select id from h4)), 'GL balanced';
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
\echo '  ✓ fixed assets, depreciation, inventory and profitability tests passed'

-- =============================================================================
-- اختبارات المخزون الكامل: الفئات والوحدات، الباركود، الصلاحية بالدفعات والصرف من الأقرب انتهاءً،
-- الجرد وفروقاته، أسعار البيع وسجلها والتعديل الجماعي، والصلاحيات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

-- الاختبارات السابقة قد تترك التسجيل بالدعوة فقط؛ مستخدمو الاختبار يُضافون مباشرة
delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003201', 'gm32@hotel.test'),
  ('00000000-0000-0000-0000-000000003202', 'hk32@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000003201');
create temp table h32 as select public.create_hotel('فندق المخزون', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h32, ids to authenticated;
select public.add_hotel_member((select id from h32), 'hk32@hotel.test', array[(select id from public.roles where is_system and code = 'housekeeping')]);
create or replace function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
create or replace function pg_temp.acc(p_code text) returns uuid language sql as $$
  select id from public.chart_of_accounts where hotel_id = (select id from h32) and code = p_code;
$$;

-- الوحدات الافتراضية والفئات
select pg_temp.check((select count(*) from public.inventory_units where hotel_id = (select id from h32)) = 8, 'default units seeded');
insert into public.inventory_categories (hotel_id, code, name_ar) select id, 'FOOD', 'مواد غذائية' from h32;
insert into public.inventory_categories (hotel_id, code, name_ar) select id, 'CLEAN', 'منظفات' from h32;
insert into ids select 'c_' || lower(code), id from public.inventory_categories where hotel_id = (select id from h32);

-- الباركود التالي EAN-13 صحيح
create temp table bc as select public.next_item_barcode((select id from h32)) as code;
grant all on bc to authenticated;
select pg_temp.check((select code from bc) = '2000000000015', 'first internal barcode with check digit');
insert into public.inventory_items (hotel_id, sku, name_ar, unit, inventory_account_id, expense_account_id, category_id, barcode, sale_price, track_expiry)
select id, 'MILK', 'حليب', 'لتر', pg_temp.acc('1122'), pg_temp.acc('5207'), pg_temp.v('c_food'), (select code from bc), 10, true from h32;
insert into public.inventory_items (hotel_id, sku, name_ar, unit, inventory_account_id, expense_account_id, category_id, sale_price)
select id, 'SOAP', 'صابون', 'حبة', pg_temp.acc('1122'), pg_temp.acc('5207'), pg_temp.v('c_clean'), 4 from h32;
insert into ids select 'i_' || lower(sku), id from public.inventory_items where hotel_id = (select id from h32);
select pg_temp.check(public.next_item_barcode((select id from h32)) = '2000000000022', 'sequence continues');
select pg_temp.expect_error($q$ insert into public.inventory_items (hotel_id, sku, name_ar, unit, inventory_account_id, expense_account_id, barcode)
  select id, 'DUP', 'مكرر', 'حبة', pg_temp.acc('1122'), pg_temp.acc('5207'), '2000000000015' from h32 $q$, 'duplicate key');

-- الصلاحية: الوارد بلا تاريخ مرفوض، دفعتان، والصرف من الأقرب انتهاءً
select pg_temp.expect_error($q$ select public.post_inventory_movement_ex(pg_temp.v('i_milk'), 'receipt', 10, current_date, 5) $q$, 'expiry date');
select public.post_inventory_movement_ex(pg_temp.v('i_milk'), 'receipt', 10, current_date, 5, p_expiry_date => current_date + 30);
select public.post_inventory_movement_ex(pg_temp.v('i_milk'), 'receipt', 6, current_date, 5, p_expiry_date => current_date + 5);
select pg_temp.check((select count(*) from public.inventory_lots where item_id = pg_temp.v('i_milk')) = 2, 'two lots');
select public.post_inventory_movement_ex(pg_temp.v('i_milk'), 'issue', 8, current_date, p_department_id => (select id from public.departments where hotel_id = (select id from h32) and code = 'FNB'));
select pg_temp.check((select remaining_qty from public.inventory_lots where item_id = pg_temp.v('i_milk') and expiry_date = current_date + 5) = 0, 'nearest expiry consumed first');
select pg_temp.check((select remaining_qty from public.inventory_lots where item_id = pg_temp.v('i_milk') and expiry_date = current_date + 30) = 8, 'remaining from later lot');
-- الأصناف بلا تتبّع لا تنشئ دفعات
select public.post_inventory_movement_ex(pg_temp.v('i_soap'), 'receipt', 50, current_date, 2);
select pg_temp.check((select count(*) from public.inventory_lots where item_id = pg_temp.v('i_soap')) = 0, 'untracked item has no lots');

-- الجرد: الحليب 8 معدود 7، الصابون 50 معدود 53
select pg_temp.expect_error($q$ select public.post_stock_count((select id from h32), '[]'::jsonb) $q$, 'at least one item');
select pg_temp.expect_error($q$ select public.post_stock_count((select id from h32), jsonb_build_array(jsonb_build_object('item_id', pg_temp.v('i_soap'), 'counted', -1))) $q$, 'zero or more');
insert into ids select 'count', public.post_stock_count((select id from h32), jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.v('i_milk'), 'counted', 7),
  jsonb_build_object('item_id', pg_temp.v('i_soap'), 'counted', 53)), current_date, 'جرد نهاية الشهر');
select pg_temp.check((select quantity_on_hand from public.inventory_items where id = pg_temp.v('i_milk')) = 7, 'milk adjusted to 7');
select pg_temp.check((select quantity_on_hand from public.inventory_items where id = pg_temp.v('i_soap')) = 53, 'soap adjusted to 53');
select pg_temp.check((select items_changed from public.inventory_counts where id = pg_temp.v('count')) = 2, 'two differences');
select pg_temp.check((select value_difference from public.inventory_counts where id = pg_temp.v('count')) = 1, 'value: -5 milk +6 soap');
select pg_temp.check((select count_number from public.inventory_counts where id = pg_temp.v('count')) like 'SC-%', 'count numbered');
-- عجز الحليب خُصم من الدفعة المتبقية
select pg_temp.check((select sum(remaining_qty) from public.inventory_lots where item_id = pg_temp.v('i_milk')) = 7, 'lots follow the count');

-- الأسعار: تعديل فردي يسجَّل، ثم رفع 10% لفئة المنظفات مع تقريب لأقرب 0.5
update public.inventory_items set sale_price = 12 where id = pg_temp.v('i_milk');
select pg_temp.check((select count(*) from public.inventory_price_changes where item_id = pg_temp.v('i_milk')) = 1, 'price change logged');
select pg_temp.expect_error($q$ select public.bulk_change_prices((select id from h32), 0) $q$, 'percentage');
select pg_temp.check(public.bulk_change_prices((select id from h32), 10, pg_temp.v('c_clean'), 0.5) = 1, 'one item repriced');
select pg_temp.check((select sale_price from public.inventory_items where id = pg_temp.v('i_soap')) = 4.5, '4 + 10% = 4.4 rounds to 4.5');
select pg_temp.check((select sale_price from public.inventory_items where id = pg_temp.v('i_milk')) = 12, 'other category untouched');

-- الصلاحيات
select pg_temp.act_as('00000000-0000-0000-0000-000000003202');
select pg_temp.expect_error($q$ select public.next_item_barcode((select id from h32)) $q$, 'Permission denied');
select pg_temp.expect_error($q$ select public.post_stock_count((select id from h32), jsonb_build_array(jsonb_build_object('item_id', (select v from ids where k = 'i_soap'), 'counted', 1))) $q$, 'Permission denied');
select pg_temp.check((select count(*) from public.inventory_lots where hotel_id = (select id from h32)) = 0, 'housekeeping cannot read lots');
select pg_temp.act_as(null);

-- دفتر المخزون يطابق الأستاذ
do $$
declare r record;
begin
  for r in select x.* from public.ledger_reconciliation((select id from h32)) x loop
    if r.difference <> 0 then raise exception 'Reconciliation difference for %: %', r.control, r.difference; end if;
  end loop;
end $$;

\o
select 'inventory plus tests passed';

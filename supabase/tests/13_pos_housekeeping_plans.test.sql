-- =============================================================================
-- اختبارات المرحلة الخامسة: نقاط البيع (على الغرفة أو مدفوع بفاتورة)، التدبير الفندقي
-- (توليد المهام وإنجازها وأثرها على حالة الغرفة، الصيانة)، وخطط الأسعار
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001301', 'gm13@hotel.test'),
  ('00000000-0000-0000-0000-000000001302', 'cashier13@hotel.test'),
  ('00000000-0000-0000-0000-000000001303', 'hk13@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000001301');
create temp table h13 as select public.create_hotel('فندق التشغيل', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
create temp table d (k text primary key, v date);
grant all on h13, ids, d to authenticated;
insert into d select 'today', app.today_for_hotel(id) from h13;
select public.add_hotel_member((select id from h13), 'cashier13@hotel.test',
  array[(select id from public.roles where is_system and code = 'cashier')]);
select public.add_hotel_member((select id from h13), 'hk13@hotel.test',
  array[(select id from public.roles where is_system and code = 'housekeeping')]);

insert into ids select 'pm_cash', id from public.payment_methods where hotel_id = (select id from h13) and code = 'CASH';
insert into public.room_types (hotel_id, code, name_ar, base_rate, max_adults) select id, 'DBL', 'مزدوجة', 200, 3 from h13;
insert into ids select 'rt', id from public.room_types where hotel_id = (select id from h13);
select public.create_rooms_bulk((select id from h13), (select v from ids where k = 'rt'), 101, 104);
insert into ids select 'room_' || room_number, id from public.rooms where hotel_id = (select id from h13);
insert into public.guests (hotel_id, full_name) select id, 'سالم' from h13;
insert into ids select 'g', id from public.guests where hotel_id = (select id from h13);
insert into public.customers (hotel_id, code, name_ar, customer_type, allow_credit) select id, 'ACME', 'شركة', 'company', true from h13;
insert into ids select 'acme', id from public.customers where hotel_id = (select id from h13);

-- =============================================================================
-- خطط الأسعار: خصم 10% + إفطار 25 لكل شخص
-- =============================================================================
insert into public.rate_plans (hotel_id, code, name_ar, adjust_pct, per_night, per_person, includes_breakfast)
select id, 'BB', 'مع الإفطار', -10, 25, true, true from h13;
insert into public.rate_plans (hotel_id, code, name_ar, adjust_pct, customer_id)
select id, 'CORP', 'سعر الشركة', -20, (select v from ids where k = 'acme') from h13;
insert into ids select 'plan_' || lower(code), id from public.rate_plans where hotel_id = (select id from h13);

insert into ids select 'r1', public.create_reservation(p_hotel_id => (select id from h13), p_guest_id => (select v from ids where k = 'g'),
  p_room_type_id => (select v from ids where k = 'rt'), p_room_id => (select v from ids where k = 'room_101'), p_adults => 2::smallint,
  p_arrival_date => (select v from d where k = 'today'), p_departure_date => (select v from d where k = 'today') + 2);
select public.set_reservation_rate_plan((select v from ids where k = 'r1'), (select v from ids where k = 'plan_bb'));
do $$ begin
  -- 200 × 0.9 + 25 × 2 = 230 لكل ليلة
  assert (select total_amount from public.reservations where id = (select v from ids where k = 'r1')) = 460, 'plan applied';
  assert (select rate from public.reservation_nights where reservation_id = (select v from ids where k = 'r1') limit 1) = 230, 'night rate with plan';
end $$;
select pg_temp.expect_error($q$ select public.set_reservation_rate_plan((select v from ids where k = 'r1'), (select v from ids where k = 'plan_corp')) $q$,
  'reserved for another company');
-- تمديد الإقامة يسعّر الليلة الجديدة بنفس الخطة
select public.check_in_reservation((select v from ids where k = 'r1'));
select public.change_stay_departure((select v from ids where k = 'r1'), (select v from d where k = 'today') + 3);
do $$ begin
  assert (select total_amount from public.reservations where id = (select v from ids where k = 'r1')) = 690, 'extension keeps plan';
end $$;

-- =============================================================================
-- نقاط البيع
-- =============================================================================
insert into public.pos_outlets (hotel_id, code, name_ar) select id, 'REST', 'المطعم' from h13;
insert into ids select 'outlet', id from public.pos_outlets where hotel_id = (select id from h13);
insert into public.pos_items (hotel_id, outlet_id, name_ar, price, charge_code_id)
select id, (select v from ids where k = 'outlet'), 'مندي', 60, (select c.id from public.charge_codes c where c.hotel_id = h13.id and c.code = 'FOOD') from h13;
insert into public.pos_items (hotel_id, outlet_id, name_ar, price, charge_code_id)
select id, (select v from ids where k = 'outlet'), 'عصير', 10, (select c.id from public.charge_codes c where c.hotel_id = h13.id and c.code = 'BEV') from h13;
insert into ids select 'item_mandi', id from public.pos_items where name_ar = 'مندي' and hotel_id = (select id from h13);
insert into ids select 'item_juice', id from public.pos_items where name_ar = 'عصير' and hotel_id = (select id from h13);

select pg_temp.act_as('00000000-0000-0000-0000-000000001302');
do $$ begin
  assert (select count(*) from public.pos_in_house((select id from h13))) = 1, 'in-house list for cashier';
end $$;
select pg_temp.expect_error($q$ insert into public.pos_items (hotel_id, outlet_id, name_ar, price, charge_code_id)
  select id, (select v from ids where k = 'outlet'), 'x', 1, (select c.id from public.charge_codes c where c.hotel_id = h13.id and c.code = 'FOOD') from h13 $q$, 'row-level security');
select pg_temp.expect_error($q$ select public.pos_settle_order((select v from ids where k = 'outlet'), '[]', 'room', (select v from ids where k = 'r1')) $q$, 'Add at least one item');

-- على الغرفة
do $$
declare x jsonb := public.pos_settle_order((select v from ids where k = 'outlet'),
  jsonb_build_array(jsonb_build_object('item_id', (select v from ids where k = 'item_mandi'), 'quantity', 2),
                    jsonb_build_object('item_id', (select v from ids where k = 'item_juice'), 'quantity', 3)),
  'room', (select v from ids where k = 'r1'));
begin
  assert (x ->> 'total')::numeric = 150 and x ->> 'invoice_id' is null, format('room order %s', x);
  assert (x ->> 'folio_id')::uuid = (select folio_id from public.pos_in_house((select id from h13)) limit 1), 'posted on room folio';
  assert (select count(*) from public.pos_order_lines where order_id = (x ->> 'order_id')::uuid and folio_transaction_id is not null) = 2, 'lines linked';
end $$;

-- مدفوع فورًا: فاتورة ضريبية
do $$
declare x jsonb := public.pos_settle_order((select v from ids where k = 'outlet'),
  jsonb_build_array(jsonb_build_object('item_id', (select v from ids where k = 'item_juice'), 'quantity', 1)),
  'paid', null, (select v from ids where k = 'pm_cash'));
begin
  assert (x ->> 'invoice_id') is not null and (x ->> 'total')::numeric = 10, format('paid order %s', x);
  assert (select status from public.guest_folios where id = (x ->> 'folio_id')::uuid) = 'closed', 'walk-in folio closed';
  assert (select total from public.invoices where id = (x ->> 'invoice_id')::uuid) = 10, 'invoice total';
end $$;
select pg_temp.expect_error($q$ select public.pos_settle_order((select v from ids where k = 'outlet'),
  jsonb_build_array(jsonb_build_object('item_id', (select v from ids where k = 'item_juice'), 'quantity', 1)), 'room', (select v from ids where k = 'g')) $q$,
  'in-house guests only');
select pg_temp.expect_error($q$ select public.pos_settle_order((select v from ids where k = 'outlet'),
  jsonb_build_array(jsonb_build_object('item_id', (select v from ids where k = 'item_juice'), 'quantity', 0)), 'paid', null, (select v from ids where k = 'pm_cash')) $q$,
  'Invalid quantity');

-- =============================================================================
-- التدبير الفندقي
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001301');
select public.set_room_status((select v from ids where k = 'room_102'), 'dirty');
select pg_temp.act_as('00000000-0000-0000-0000-000000001303');
do $$ begin
  -- 101 مشغولة (إقامة مستمرة) و102 متسخة (مغادرة)
  assert public.generate_housekeeping_tasks((select id from h13)) = 2, 'two tasks generated';
  assert public.generate_housekeeping_tasks((select id from h13)) = 0, 'no duplicates';
  assert (select kind from public.housekeeping_tasks where room_id = (select v from ids where k = 'room_102')) = 'departure', 'departure clean';
  assert (select kind from public.housekeeping_tasks where room_id = (select v from ids where k = 'room_101')) = 'stayover', 'stayover clean';
end $$;
select public.update_housekeeping_task((select id from public.housekeeping_tasks where room_id = (select v from ids where k = 'room_102')), 'in_progress', 'فاطمة');
select public.update_housekeeping_task((select id from public.housekeeping_tasks where room_id = (select v from ids where k = 'room_102')), 'done');
do $$ begin
  assert (select housekeeping_status from public.rooms where id = (select v from ids where k = 'room_102')) = 'clean', 'room cleaned';
  assert (select assignee from public.housekeeping_tasks where room_id = (select v from ids where k = 'room_102')) = 'فاطمة', 'assignee kept';
end $$;
select pg_temp.expect_error($q$ select public.update_housekeeping_task((select id from public.housekeeping_tasks where room_id = (select v from ids where k = 'room_102')), 'pending') $q$,
  'already closed');
-- الصيانة تُخرج الغرفة من الخدمة وتعيدها عند الإنجاز
select pg_temp.expect_error($q$ select public.add_housekeeping_task((select v from ids where k = 'room_103'), 'maintenance') $q$, 'Describe the maintenance issue');
insert into ids select 'maint', public.add_housekeeping_task((select v from ids where k = 'room_103'), 'maintenance', null, 'تسريب مياه', 'أحمد', true);
do $$ begin
  assert (select service_status from public.rooms where id = (select v from ids where k = 'room_103')) = 'out_of_service', 'room out of service';
end $$;
select public.update_housekeeping_task((select v from ids where k = 'maint'), 'done');
do $$ begin
  assert (select service_status from public.rooms where id = (select v from ids where k = 'room_103')) = 'in_service', 'room back in service';
end $$;
select pg_temp.expect_error($q$ select public.pos_in_house((select id from h13)) $q$, 'Permission denied');

-- =============================================================================
-- التطابق المحاسبي
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001301');
do $$
declare h uuid := (select id from h13);
begin
  assert not exists (select 1 from public.ledger_reconciliation(h) where difference <> 0), 'ledger reconciles';
  assert -pg_temp.gl(h, 'revenue_restaurant') = 120, format('food revenue %s', -pg_temp.gl(h, 'revenue_restaurant'));
  assert -pg_temp.gl(h, 'revenue_beverage') = 40, 'beverage revenue';
end $$;

select pg_temp.act_as(null);
\o
select '✓ 13_pos_housekeeping_plans: all assertions passed';

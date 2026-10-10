-- =============================================================================
-- اختبارات الترحيل 31: الصيانة، المفقودات والأمانات، المغسلة والمفروشات، المناسبات، تقييمات النزلاء
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001801', 'gm18@hotel.test'),
  ('00000000-0000-0000-0000-000000001802', 'front18@hotel.test'),
  ('00000000-0000-0000-0000-000000001803', 'acc18@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000001801');
create temp table h18 as select public.create_hotel('فندق الخدمات', 'YE', 'YER') as id;
create temp table ids (k text primary key, v uuid);
create temp table d (k text primary key, v date);
grant all on h18, ids, d to authenticated;
insert into d select 'today', app.today_for_hotel(id) from h18;
select public.add_hotel_member((select id from h18), 'front18@hotel.test',
  array[(select id from public.roles where is_system and code = 'receptionist')]);
select public.add_hotel_member((select id from h18), 'acc18@hotel.test',
  array[(select id from public.roles where is_system and code = 'accountant')]);

insert into public.room_types (hotel_id, code, name_ar, base_rate, max_adults) select id, 'DBL', 'مزدوجة', 200, 3 from h18;
insert into public.room_types (hotel_id, code, name_ar, booking_mode, base_rate, min_hours, max_adults)
select id, 'HALL', 'قاعة', 'hourly', 100, 2, 300 from h18;
insert into ids select 'rt_' || lower(code), id from public.room_types where hotel_id = (select id from h18);
select public.create_rooms_bulk((select id from h18), (select v from ids where k = 'rt_dbl'), 101, 103);
select public.create_rooms_bulk((select id from h18), (select v from ids where k = 'rt_hall'), 1, 1, null, 'H');
insert into ids select 'room_' || room_number, id from public.rooms where hotel_id = (select id from h18);
insert into public.guests (hotel_id, full_name) select id, 'سالم أحمد' from h18;
insert into ids select 'g', id from public.guests where hotel_id = (select id from h18);
insert into ids select 'pm_cash', id from public.payment_methods where hotel_id = (select id from h18) and code = 'CASH';

-- =============================================================================
-- 1) الصيانة
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001802');
insert into ids select 'm1', public.create_maintenance_request((select id from h18), 'تسريب في المكيف', 'ماء على الأرض',
  p_room_id => (select v from ids where k = 'room_101'), p_priority => 'high', p_out_of_service => true);
insert into ids select 'm2', public.create_maintenance_request((select id from h18), 'مفتاح الإنارة لا يعمل',
  p_room_id => (select v from ids where k = 'room_101'), p_out_of_service => true);
do $$ begin
  assert (select service_status from public.rooms where id = (select v from ids where k = 'room_101')) = 'out_of_service', 'room out of service';
  assert (select request_number like 'MNT-%' from public.maintenance_requests where id = (select v from ids where k = 'm1')), 'numbered';
  assert (select count(*) from public.maintenance_requests) = 2, 'receptionist sees requests';
end $$;
select pg_temp.expect_error($q$ select public.create_maintenance_request((select id from h18), ' ') $q$, 'Describe the maintenance issue');
select pg_temp.expect_error($q$ select public.create_maintenance_request((select id from h18), 'عطل', p_location => 'المطبخ', p_out_of_service => true) $q$,
  'Only a room can be taken out of service');
-- الاستقبال يبلّغ ولا يدير
select pg_temp.expect_error($q$ select public.update_maintenance_request((select v from ids where k = 'm1'), 'in_progress') $q$, 'Permission denied');

select pg_temp.act_as('00000000-0000-0000-0000-000000001801');
select public.update_maintenance_request((select v from ids where k = 'm1'), 'in_progress', 'الفني محمد');
select public.add_maintenance_part((select v from ids where k = 'm1'), 'غاز تبريد', 2, 1500);
select pg_temp.expect_error($q$ select public.add_maintenance_part((select v from ids where k = 'm1'), 'قطعة', 1) $q$, 'Enter the part cost');
select pg_temp.expect_error($q$ select public.update_maintenance_request((select v from ids where k = 'm1'), 'done') $q$, 'Write what was done');
select public.update_maintenance_request((select v from ids where k = 'm1'), 'done', p_resolution => 'تعبئة غاز وتغيير خرطوم', p_labor_cost => 2000);
do $$ begin
  -- بلاغ آخر ما زال مفتوحًا على الغرفة فتبقى خارج الخدمة
  assert (select service_status from public.rooms where id = (select v from ids where k = 'room_101')) = 'out_of_service', 'still out of service';
  assert (select started_at is not null and completed_at is not null from public.maintenance_requests where id = (select v from ids where k = 'm1')), 'timestamps';
  assert (select sum(quantity * unit_cost) from public.maintenance_parts where request_id = (select v from ids where k = 'm1')) = 3000, 'parts cost';
end $$;
select pg_temp.expect_error($q$ select public.update_maintenance_request((select v from ids where k = 'm1'), 'open') $q$, 'already closed');
select public.update_maintenance_request((select v from ids where k = 'm2'), 'cancelled');
do $$ begin
  assert (select service_status from public.rooms where id = (select v from ids where k = 'room_101')) = 'in_service', 'room back after last request';
end $$;
-- سجل جهاز وبلاغ عليه يأخذ غرفته
insert into public.maintenance_assets (hotel_id, code, name, category, room_id) select id, 'AC-102', 'مكيف 102', 'ac', (select v from ids where k = 'room_102') from h18;
insert into ids select 'asset', id from public.maintenance_assets where code = 'AC-102';
insert into ids select 'm3', public.create_maintenance_request((select id from h18), 'صيانة دورية', p_asset_id => (select v from ids where k = 'asset'));
do $$ begin
  assert (select room_id from public.maintenance_requests where id = (select v from ids where k = 'm3')) = (select v from ids where k = 'room_102'), 'asset room';
end $$;
-- المحاسب لا يرى الصيانة
select pg_temp.act_as('00000000-0000-0000-0000-000000001803');
do $$ begin assert (select count(*) from public.maintenance_requests) = 0, 'accountant cannot read maintenance'; end $$;

-- =============================================================================
-- 2) المفقودات والأمانات
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001802');
insert into ids select 'lf', public.register_lost_item((select id from h18), 'هاتف أسود', p_category => 'electronics',
  p_room_id => (select v from ids where k = 'room_102'), p_found_by => 'عاملة النظافة', p_storage_location => 'خزنة الاستقبال');
select pg_temp.expect_error($q$ select public.close_lost_item((select v from ids where k = 'lf'), 'return', 'سالم') $q$, 'receiver name and ID');
select public.close_lost_item((select v from ids where k = 'lf'), 'return', 'سالم أحمد', '01020304');
select pg_temp.expect_error($q$ select public.close_lost_item((select v from ids where k = 'lf'), 'dispose', p_note => 'x') $q$, 'already closed');
insert into ids select 'lf2', public.register_lost_item((select id from h18), 'شاحن');
select pg_temp.expect_error($q$ select public.close_lost_item((select v from ids where k = 'lf2'), 'dispose') $q$, 'reason for disposal');
select public.close_lost_item((select v from ids where k = 'lf2'), 'dispose', p_note => 'مضى عليه 90 يومًا');
do $$ begin
  assert (select status from public.lost_found_items where id = (select v from ids where k = 'lf')) = 'returned', 'returned';
  assert (select status from public.lost_found_items where id = (select v from ids where k = 'lf2')) = 'disposed', 'disposed';
end $$;

insert into ids select 'sd', public.open_safe_deposit((select id from h18), 'سالم أحمد', 'B-7', 'جواز سفر ومبلغ نقدي');
select pg_temp.expect_error($q$ select public.open_safe_deposit((select id from h18), 'آخر', 'b-7', 'ساعة') $q$, 'already holds a deposit');
select public.return_safe_deposit((select v from ids where k = 'sd'), 'استلمها بنفسه');
select pg_temp.expect_error($q$ select public.return_safe_deposit((select v from ids where k = 'sd')) $q$, 'already returned');
-- الصندوق يتاح بعد التسليم
insert into ids select 'sd2', public.open_safe_deposit((select id from h18), 'آخر', 'b-7', 'ساعة');

-- =============================================================================
-- 3) المغسلة والمفروشات
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001801');
insert into public.laundry_items (hotel_id, name, service, price, charge_code_id)
select id, 'قميص', 'wash_iron', 500, (select c.id from public.charge_codes c where c.hotel_id = h18.id and c.code = 'LAUNDRY') from h18;
insert into ids select 'shirt', id from public.laundry_items where name = 'قميص';
insert into ids select 'r1', public.create_reservation(p_hotel_id => (select id from h18), p_guest_id => (select v from ids where k = 'g'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_room_id => (select v from ids where k = 'room_103'),
  p_arrival_date => (select v from d where k = 'today'), p_departure_date => (select v from d where k = 'today') + 2);

select pg_temp.act_as('00000000-0000-0000-0000-000000001802');
select pg_temp.expect_error($q$ select public.create_laundry_order((select v from ids where k = 'r1'),
  jsonb_build_array(jsonb_build_object('item_id', (select v from ids where k = 'shirt'), 'quantity', 2))) $q$, 'in-house guests only');
select public.check_in_reservation((select v from ids where k = 'r1'));
do $$ begin
  assert (select count(*) from public.services_in_house((select id from h18)) where reservation_id = (select v from ids where k = 'r1') and room_number = '103') = 1, 'in house list';
end $$;
insert into ids select 'lo', public.create_laundry_order((select v from ids where k = 'r1'),
  jsonb_build_array(jsonb_build_object('item_id', (select v from ids where k = 'shirt'), 'quantity', 3)), true, 50);
do $$ begin
  -- مستعجل +50%: 750 × 3
  assert (select total from public.laundry_orders where id = (select v from ids where k = 'lo')) = 2250, 'express total';
  assert (select count(*) from public.folio_transactions t join public.reservations r on r.folio_id = t.folio_id
          where r.id = (select v from ids where k = 'r1') and t.description like 'غسيل%') = 0, 'not posted before delivery';
end $$;
select public.update_laundry_order((select v from ids where k = 'lo'), 'ready');
select pg_temp.expect_error($q$ select public.update_laundry_order((select v from ids where k = 'lo'), 'in_process') $q$, 'Invalid task status');
select public.update_laundry_order((select v from ids where k = 'lo'), 'delivered');
do $$ begin
  assert (select sum(t.net_amount) from public.folio_transactions t join public.reservations r on r.folio_id = t.folio_id
          where r.id = (select v from ids where k = 'r1') and t.description like 'غسيل%') = 2250, 'posted on delivery';
  assert (select count(*) from public.laundry_order_lines where order_id = (select v from ids where k = 'lo') and folio_transaction_id is null) = 0, 'lines linked';
end $$;
select pg_temp.expect_error($q$ select public.update_laundry_order((select v from ids where k = 'lo'), 'cancelled') $q$, 'already closed');

insert into public.linen_types (hotel_id, name, par_level) select id, 'منشفة كبيرة', 60 from h18;
insert into ids select 'towel', id from public.linen_types where name = 'منشفة كبيرة';
insert into public.linen_movements (hotel_id, linen_type_id, movement_date, kind, quantity)
select id, (select v from ids where k = 'towel'), (select v from d where k = 'today'), 'purchased', 100 from h18;
insert into public.linen_movements (hotel_id, linen_type_id, movement_date, kind, quantity)
select id, (select v from ids where k = 'towel'), (select v from d where k = 'today'), 'sent', 30 from h18;
select pg_temp.expect_error($q$ insert into public.linen_movements (hotel_id, linen_type_id, movement_date, kind, quantity)
  select id, (select v from ids where k = 'towel'), (select v from d where k = 'today'), 'returned', 40 from h18 $q$, 'more than what is at the laundry');
select pg_temp.expect_error($q$ insert into public.linen_movements (hotel_id, linen_type_id, movement_date, kind, quantity)
  select id, (select v from ids where k = 'towel'), (select v from d where k = 'today'), 'sent', 80 from h18 $q$, 'more than what is available');
insert into public.linen_movements (hotel_id, linen_type_id, movement_date, kind, quantity)
select id, (select v from ids where k = 'towel'), (select v from d where k = 'today'), 'returned', 25 from h18;
insert into public.linen_movements (hotel_id, linen_type_id, movement_date, kind, quantity)
select id, (select v from ids where k = 'towel'), (select v from d where k = 'today'), 'damaged', 5 from h18;
do $$ begin
  assert (select total = 95 and at_laundry = 5 from public.linen_balances where linen_type_id = (select v from ids where k = 'towel')), 'linen balance';
end $$;

-- =============================================================================
-- 4) المناسبات
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001801');
create temp table t_ev (k text primary key, v timestamp);
grant all on t_ev to authenticated;
insert into t_ev values ('s', ((select v from d where k = 'today') + 10) + time '18:00'), ('e', ((select v from d where k = 'today') + 10) + time '23:00');
insert into ids select 'ev', public.save_event((select id from h18), null, 'حفل زفاف آل سالم', 'wedding', 'أحمد سالم', '777000111', null,
  (select v from ids where k = 'room_H1'), (select v from t_ev where k = 's'), (select v from t_ev where k = 'e'), 200, 10000, null, 'الدفعة المقدمة غير مستردة',
  jsonb_build_array(
    jsonb_build_object('description', 'عشاء للفرد', 'per_person', true, 'quantity', 200, 'unit_price', 3000),
    jsonb_build_object('description', 'تأجير القاعة', 'quantity', 1, 'unit_price', 150000)));
do $$ begin
  assert (select event_number like 'EV-%' and status = 'tentative' from public.event_bookings where id = (select v from ids where k = 'ev')), 'event created';
  assert (select count(*) from public.event_items where event_id = (select v from ids where k = 'ev')) = 2, 'items';
end $$;
-- القاعة محجوزة: مناسبة ثانية وحجز بالساعة في نفس الوقت يُرفضان
select pg_temp.expect_error($q$ select public.save_event((select id from h18), null, 'مؤتمر', 'conference', 'شركة', null, null,
  (select v from ids where k = 'room_H1'), (select v from t_ev where k = 's') + interval '1 hour', (select v from t_ev where k = 'e') + interval '1 hour', 50, 0, null, null,
  jsonb_build_array(jsonb_build_object('description', 'قاعة', 'quantity', 1, 'unit_price', 1000))) $q$, 'already booked');
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h18), p_guest_id => (select v from ids where k = 'g'),
  p_room_type_id => (select v from ids where k = 'rt_hall'), p_room_id => (select v from ids where k = 'room_H1'),
  p_starts_at => (select v from t_ev where k = 's') + interval '1 hour', p_ends_at => (select v from t_ev where k = 's') + interval '3 hours') $q$, 'booked for an event');
-- غرفة ليلية ليست قاعة
select pg_temp.expect_error($q$ select public.save_event((select id from h18), null, 'x', 'party', 'x', null, null, (select v from ids where k = 'room_102'),
  (select v from t_ev where k = 's'), (select v from t_ev where k = 'e'), 1, 0, null, null, '[]'::jsonb) $q$, 'Choose an hourly hall');
select pg_temp.expect_error($q$ select public.confirm_event((select v from ids where k = 'm1')) $q$, 'Event not found');
insert into ids select 'ev_folio', public.confirm_event((select v from ids where k = 'ev'));
select public.post_folio_deposit((select v from ids where k = 'ev_folio'), (select v from ids where k = 'pm_cash'), 200000);
-- تعديل المؤكد مسموح، وبعد الإقفال لا
select public.save_event((select id from h18), (select v from ids where k = 'ev'), 'حفل زفاف آل سالم', 'wedding', 'أحمد سالم', '777000111', null,
  (select v from ids where k = 'room_H1'), (select v from t_ev where k = 's'), (select v from t_ev where k = 'e'), 220, 10000, null, null,
  jsonb_build_array(
    jsonb_build_object('description', 'عشاء للفرد', 'per_person', true, 'quantity', 220, 'unit_price', 3000),
    jsonb_build_object('description', 'تأجير القاعة', 'quantity', 1, 'unit_price', 150000)));
select public.complete_event((select v from ids where k = 'ev'));
do $$ begin
  -- 220 × 3000 + 150000 = 810000 ثم خصم 10000 على أكبر بند
  assert (select sum(net_amount) filter (where txn_type = 'charge') from public.folio_transactions where folio_id = (select v from ids where k = 'ev_folio')) = 810000, 'charges posted';
  assert (select sum(net_amount) filter (where txn_type = 'allowance') from public.folio_transactions where folio_id = (select v from ids where k = 'ev_folio')) = 10000, 'discount posted';
  assert (select status from public.event_bookings where id = (select v from ids where k = 'ev')) = 'completed', 'completed';
end $$;
select pg_temp.expect_error($q$ select public.cancel_event((select v from ids where k = 'ev'), 'x') $q$, 'This event is closed');
-- بعد الإقفال تتحرر القاعة في ذلك الوقت لحجز آخر (المناسبة المكتملة لا تحجز)
insert into ids select 'ev2', public.save_event((select id from h18), null, 'اجتماع', 'meeting', 'شركة', null, null, (select v from ids where k = 'room_H1'),
  (select v from t_ev where k = 's'), (select v from t_ev where k = 'e'), 10, 0, null, null,
  jsonb_build_array(jsonb_build_object('description', 'قاعة', 'quantity', 1, 'unit_price', 1000)));
select pg_temp.expect_error($q$ select public.cancel_event((select v from ids where k = 'ev2'), ' ') $q$, 'cancellation reason');
select public.cancel_event((select v from ids where k = 'ev2'), 'ألغاه العميل');
-- الاستقبال يرى المناسبات ولا يديرها
select pg_temp.act_as('00000000-0000-0000-0000-000000001802');
do $$ begin assert (select count(*) from public.event_bookings) = 2, 'receptionist views events'; end $$;
select pg_temp.expect_error($q$ select public.cancel_event((select v from ids where k = 'ev'), 'x') $q$, 'Permission denied');

-- =============================================================================
-- 5) تقييمات النزلاء
-- =============================================================================
select pg_temp.act_as(null);
update public.reservations set status = 'checked_out', checked_out_at = now() where id = (select v from ids where k = 'r1');
insert into ids select 'survey', id from public.guest_surveys where reservation_id = (select v from ids where k = 'r1');
do $$ begin
  assert (select status = 'pending' and guest_name = 'سالم أحمد' and room_number = '103' and length(token) = 64
          from public.guest_surveys where id = (select v from ids where k = 'survey')), 'survey created on checkout';
end $$;
-- الاستبيان برمزه بلا دخول
set role anon;
select pg_temp.expect_error($q$ select public.submit_guest_survey('wrong', 5::smallint, null, null, null, null, null, true, null) $q$, 'no longer valid');
-- الزائر المجهول لا يرى الاستبيانات ولا رموزها
select pg_temp.expect_error($q$ select count(*) from public.guest_surveys $q$, 'permission denied');
reset role;
create temp table tok as select token from public.guest_surveys where id = (select v from ids where k = 'survey');
grant select on tok to anon;
set role anon;
do $$ begin
  assert (select valid and hotel_name = 'فندق الخدمات' and room_number = '103' from public.survey_info((select token from tok))), 'survey info for anon';
  assert not exists (select 1 from public.survey_info('wrong')), 'unknown token';
end $$;
select pg_temp.expect_error($q$ select public.submit_guest_survey((select token from tok), null, null, null, null, null, null, true, null) $q$, 'overall rating');
select public.submit_guest_survey((select token from tok), 5::smallint, 4::smallint, 5::smallint, 4::smallint, 3::smallint, null, true, 'إقامة ممتازة');
select pg_temp.expect_error($q$ select public.submit_guest_survey((select token from tok), 1::smallint, null, null, null, null, null, false, null) $q$, 'no longer valid');
do $$ begin
  assert not (select valid from public.survey_info((select token from tok))), 'used link no longer valid';
end $$;
reset role;
do $$ begin
  assert (select status = 'completed' and overall = 5 and channel = 'kiosk' from public.guest_surveys where id = (select v from ids where k = 'survey')), 'survey completed';
end $$;
-- الاستمارة الورقية: الاستقبال يُدخل والمحاسب يرى التقرير ولا يُدخل
select pg_temp.act_as('00000000-0000-0000-0000-000000001802');
select public.record_paper_survey((select id from h18), 'نزيل ورقي', '102', 3::smallint, 2::smallint, 4::smallint, 3::smallint, 3::smallint, null, false, 'الحمام يحتاج صيانة');
select pg_temp.act_as('00000000-0000-0000-0000-000000001803');
select pg_temp.expect_error($q$ select * from public.services_in_house((select id from h18)) $q$, 'Permission denied');
do $$ begin
  assert (select count(*) from public.guest_surveys where status = 'completed') = 2, 'accountant reads surveys';
  assert (select round(avg(overall), 1) from public.guest_surveys where status = 'completed') = 4.0, 'average';
end $$;
select pg_temp.expect_error($q$ select public.record_paper_survey((select id from h18), 'x', null, 5::smallint, null, null, null, null, null, true, null) $q$, 'Permission denied');

\o
select 'operations services tests passed';

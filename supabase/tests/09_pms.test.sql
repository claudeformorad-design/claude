-- =============================================================================
-- اختبارات قسم إدارة الفندق: فصل الأقسام، الغرف، الحجوزات، السعة والحجز الزائد،
-- المواسم وتثبيت الأسعار، عروض اللحظة الأخيرة، الإقامات الطويلة، الوحدات بالساعة،
-- الحجوزات المتكررة والجماعية، قائمة الانتظار، الصلاحيات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000901', 'gm9@hotel.test'),
  ('00000000-0000-0000-0000-000000000902', 'desk9@hotel.test'),
  ('00000000-0000-0000-0000-000000000903', 'hk9@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000000901');
create temp table h9 as select public.create_hotel('فندق الحجوزات', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
create temp table d (k text primary key, v date);
grant all on h9, ids, d to authenticated;
insert into d select 'today', app.today_for_hotel(id) from h9;

select public.add_hotel_member((select id from h9), 'desk9@hotel.test',
  array[(select id from public.roles where is_system and code = 'receptionist')]);
select public.add_hotel_member((select id from h9), 'hk9@hotel.test',
  array[(select id from public.roles where is_system and code = 'housekeeping')]);

-- =============================================================================
-- فصل الأقسام: الصلاحيات تتبع الأقسام المفعّلة
-- =============================================================================
do $$
declare h uuid := (select id from h9);
begin
  assert (select enabled_modules from public.hotels where id = h) = array['accounting', 'pms'], 'both modules by default';
  assert app.has_permission(h, 'pms.reservations.manage'), 'GM has PMS permissions';
  assert (select count(*) from public.my_permissions(h)) = (select count(*) from public.permissions), 'GM has all permissions';
end $$;

select public.set_hotel_modules((select id from h9), array['accounting']);
do $$
declare h uuid := (select id from h9);
begin
  assert not app.has_permission(h, 'pms.reservations.view'), 'PMS permission off when module disabled';
  assert not exists (select 1 from public.my_permissions(h) p where p like 'pms.%'), 'no PMS permission listed';
  assert app.has_permission(h, 'gl.journal.view'), 'accounting still on';
  assert app.has_permission(h, 'folio.manage'), 'shared folio permissions stay on';
end $$;
select pg_temp.expect_error($q$ select public.front_desk_summary((select id from h9)) $q$, 'Permission denied');

select public.set_hotel_modules((select id from h9), array['pms']);
do $$
declare h uuid := (select id from h9);
begin
  assert not app.has_permission(h, 'gl.journal.view'), 'accounting permission off';
  assert not app.has_permission(h, 'reports.financial.view'), 'accounting reports off';
  assert app.has_permission(h, 'folio.view'), 'folio is shared';
  assert app.has_permission(h, 'settings.hotel.manage'), 'settings are shared';
  assert app.has_permission(h, 'pms.reservations.manage'), 'PMS on';
end $$;
select pg_temp.expect_error($q$ select public.set_hotel_modules((select id from h9), '{}') $q$, 'At least one module');
select pg_temp.expect_error($q$ select public.set_hotel_modules((select id from h9), array['crm']) $q$, 'hotels_modules_valid');
select public.set_hotel_modules((select id from h9), array['pms', 'accounting', 'pms']);
do $$ begin
  assert (select enabled_modules from public.hotels where id = (select id from h9)) = array['accounting', 'pms'], 'normalized modules';
end $$;

-- =============================================================================
-- هيكل الفندق
-- =============================================================================
insert into public.floors (hotel_id, name, sort_order) select id, 'الطابق الأول', 1 from h9;
insert into ids select 'floor1', id from public.floors where hotel_id = (select id from h9);

insert into public.room_types (hotel_id, code, name_ar, base_rate, weekend_rate, max_adults, max_children, charge_code_id)
select id, 'DBL', 'غرفة مزدوجة', 300, 350, 2, 1, (select c.id from public.charge_codes c where c.hotel_id = h9.id and c.code = 'ROOM') from h9;
insert into public.room_types (hotel_id, code, name_ar, base_rate, overbooking_limit)
select id, 'STE', 'جناح', 800, 1 from h9;
insert into public.room_types (hotel_id, code, name_ar, booking_mode, base_rate, min_hours, max_adults)
select id, 'HALL', 'قاعة', 'hourly', 100, 2, 50 from h9;
insert into ids select 'rt_' || lower(code), id from public.room_types where hotel_id = (select id from h9);

do $$
declare h uuid := (select id from h9);
begin
  assert public.create_rooms_bulk(h, (select v from ids where k = 'rt_dbl'), 101, 103, (select v from ids where k = 'floor1')) = 3, 'three rooms';
  -- المدى المتداخل يضيف الجديد فقط
  assert public.create_rooms_bulk(h, (select v from ids where k = 'rt_dbl'), 102, 104) = 1, 'existing numbers skipped';
  assert public.create_rooms_bulk(h, (select v from ids where k = 'rt_ste'), 201, 201) = 1, 'suite';
  assert public.create_rooms_bulk(h, (select v from ids where k = 'rt_hall'), 1, 1, null, 'H') = 1, 'hall';
  -- عدد الغرف المتاحة للبيع يتبع الغرف الليلية الفعلية (القاعة لا تُحسب)
  assert (select total_rooms from public.hotels where id = h) = 5, 'total rooms synced';
end $$;
insert into ids select 'room_' || room_number, id from public.rooms where hotel_id = (select id from h9);
select pg_temp.expect_error($q$ select public.create_rooms_bulk((select id from h9), (select v from ids where k = 'rt_dbl'), 1, 600) $q$, 'between 1 and 500');

-- =============================================================================
-- النزلاء
-- =============================================================================
insert into public.guests (hotel_id, full_name, phone, id_type, id_number) select id, 'سالم أحمد', '777000001', 'national_id', 'A-1' from h9;
insert into public.guests (hotel_id, full_name, phone) select id, 'منى علي', '777000002' from h9;
insert into public.guests (hotel_id, full_name, is_blacklisted, blacklist_reason) select id, 'ممنوع', true, 'أضرار سابقة' from h9;
insert into ids select 'g_salem', id from public.guests where full_name = 'سالم أحمد';
insert into ids select 'g_mona', id from public.guests where full_name = 'منى علي';
insert into ids select 'g_banned', id from public.guests where full_name = 'ممنوع';
select pg_temp.expect_error($q$
  insert into public.guests (hotel_id, full_name, id_type, id_number) select id, 'آخر', 'national_id', ' a-1 ' from h9 $q$, 'guests_identity_uq');
select pg_temp.expect_error($q$
  insert into public.guests (hotel_id, full_name, id_type) select id, 'بلا رقم', 'passport' from h9 $q$, 'guests_id_pair');

-- =============================================================================
-- الحجز الليلي والتسعير الأساسي ونهاية الأسبوع
-- =============================================================================
create temp table r (k text primary key, v uuid);
grant all on r to authenticated;

insert into r select 'a', public.create_reservation(
  p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'),
  p_arrival_date => (select v from d where k = 'today') + 10, p_departure_date => (select v from d where k = 'today') + 12,
  p_adults => 2::smallint);

do $$
declare
  v_r public.reservations%rowtype;
  v_expected numeric;
begin
  select * into v_r from public.reservations where id = (select v from r where k = 'a');
  assert v_r.confirmation_number like 'RSV-%', 'confirmation number';
  assert v_r.status = 'confirmed' and v_r.booking_mode = 'nightly', 'status and mode';
  assert (select count(*) from public.reservation_nights where reservation_id = v_r.id) = 2, 'two nights';
  select sum(case when extract(dow from n)::int in (4, 5) then 350 else 300 end) into v_expected
    from generate_series(v_r.arrival_date, v_r.departure_date - 1, interval '1 day') n;
  assert v_r.total_amount = v_expected, format('weekday/weekend pricing: %s vs %s', v_r.total_amount, v_expected);
  -- عرض السعر يطابق ما حُفظ
  assert (public.quote_reservation(v_r.hotel_id, v_r.room_type_id, v_r.arrival_date, v_r.departure_date) ->> 'total')::numeric = v_expected, 'quote matches';
end $$;

-- أوقات البداية والنهاية تُتجاهل للغرف الليلية (نموذج الواجهة قد يرسل قيمًا افتراضية)
do $$
declare v_id uuid;
begin
  v_id := public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
    p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 250,
    p_departure_date => (select v from d where k = 'today') + 251,
    p_starts_at => ((select v from d where k = 'today') + 250) + time '16:00', p_ends_at => ((select v from d where k = 'today') + 250) + time '20:00');
  assert (select starts_at is null and ends_at is null from public.reservations where id = v_id), 'times ignored for nightly';
end $$;
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_banned'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 1,
  p_departure_date => (select v from d where k = 'today') + 2) $q$, 'blacklisted');
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 1,
  p_departure_date => (select v from d where k = 'today') + 2, p_adults => 3::smallint) $q$, 'Occupancy exceeds');
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') - 1,
  p_departure_date => (select v from d where k = 'today') + 2) $q$, 'cannot be in the past');
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 1,
  p_departure_date => (select v from d where k = 'today') + 400) $q$, 'between 1 and 366 nights');
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 1,
  p_departure_date => (select v from d where k = 'today') + 2, p_status => 'checked_in') $q$, 'tentative or confirmed');

-- =============================================================================
-- السعة: 4 غرف مزدوجة ولا حجز زائد
-- =============================================================================
do $$
declare
  h uuid := (select id from h9);
  i int;
begin
  for i in 1 .. 3 loop
    perform public.create_reservation(p_hotel_id => h, p_guest_id => (select v from ids where k = 'g_mona'),
      p_room_type_id => (select v from ids where k = 'rt_dbl'),
      p_arrival_date => (select v from d where k = 'today') + 10, p_departure_date => (select v from d where k = 'today') + 12);
  end loop;
  assert (select min(available) from public.room_type_availability(h, (select v from d where k = 'today') + 10, (select v from d where k = 'today') + 12)
          where room_type_id = (select v from ids where k = 'rt_dbl')) = 0, 'sold out';
  assert (public.quote_reservation(h, (select v from ids where k = 'rt_dbl'), (select v from d where k = 'today') + 10, (select v from d where k = 'today') + 12) ->> 'min_available')::int = 0, 'quote shows no availability';
end $$;
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 11,
  p_departure_date => (select v from d where k = 'today') + 13) $q$, 'No availability');

-- =============================================================================
-- الحجز الزائد: الجناح غرفة واحدة وحد زائد 1 (يتطلب صلاحية)
-- =============================================================================
insert into r select 'ste1', public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_ste'), p_arrival_date => (select v from d where k = 'today') + 5,
  p_departure_date => (select v from d where k = 'today') + 6);

select pg_temp.act_as('00000000-0000-0000-0000-000000000902');
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_ste'), p_arrival_date => (select v from d where k = 'today') + 5,
  p_departure_date => (select v from d where k = 'today') + 6) $q$, 'requires the overbooking permission');

select pg_temp.act_as('00000000-0000-0000-0000-000000000901');
insert into r select 'ste2', public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_ste'), p_arrival_date => (select v from d where k = 'today') + 5,
  p_departure_date => (select v from d where k = 'today') + 6);
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_ste'), p_arrival_date => (select v from d where k = 'today') + 5,
  p_departure_date => (select v from d where k = 'today') + 6) $q$, 'Overbooking limit reached');

-- =============================================================================
-- تخصيص الغرف ومنع الحجز المزدوج للغرفة
-- =============================================================================
insert into r select 'b', id from public.reservations
 where hotel_id = (select id from h9) and room_type_id = (select v from ids where k = 'rt_dbl')
   and id <> (select v from r where k = 'a') and arrival_date = (select v from d where k = 'today') + 10
 order by created_at limit 1;
select public.assign_reservation_room((select v from r where k = 'a'), (select v from ids where k = 'room_101'));
select pg_temp.expect_error($q$ select public.assign_reservation_room((select v from r where k = 'b'), (select v from ids where k = 'room_101')) $q$, 'already booked');
select pg_temp.expect_error($q$ select public.assign_reservation_room((select v from r where k = 'b'), (select v from ids where k = 'room_201')) $q$, 'does not match');
-- قيد الاستبعاد في القاعدة نفسها يمنع التداخل حتى لو تجاوز أحد الدوال
select pg_temp.act_as(null);
select pg_temp.expect_error($q$ update public.reservations set room_id = (select v from ids where k = 'room_101') where id = (select v from r where k = 'b') $q$,
  'reservation_room_no_overlap');
select pg_temp.act_as('00000000-0000-0000-0000-000000000901');

-- الإلغاء يحرر الغرفة
select pg_temp.expect_error($q$ select public.cancel_reservation((select v from r where k = 'a'), '  ') $q$, 'reason is required');
select public.cancel_reservation((select v from r where k = 'a'), 'طلب النزيل');
select public.assign_reservation_room((select v from r where k = 'b'), (select v from ids where k = 'room_101'));
select pg_temp.expect_error($q$ select public.cancel_reservation((select v from r where k = 'a'), 'مرة ثانية') $q$, 'can be cancelled');
select pg_temp.expect_error($q$ select public.update_reservation((select v from r where k = 'a'), (select v from ids where k = 'rt_dbl'),
  (select v from d where k = 'today') + 10, (select v from d where k = 'today') + 12) $q$, 'can be edited');
do $$ begin
  assert (select status from public.reservations where id = (select v from r where k = 'a')) = 'cancelled', 'cancelled';
  assert (select cancellation_reason from public.reservations where id = (select v from r where k = 'a')) = 'طلب النزيل', 'reason stored';
end $$;

-- =============================================================================
-- الحالات: مبدئي ← مؤكد، عدم الحضور
-- =============================================================================
insert into r select 'tent', public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today'),
  p_departure_date => (select v from d where k = 'today') + 1, p_status => 'tentative',
  p_tentative_until => (select v from d where k = 'today'));
insert into r select 'future', public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 3,
  p_departure_date => (select v from d where k = 'today') + 4);
select public.confirm_reservation((select v from r where k = 'tent'));
select pg_temp.expect_error($q$ select public.confirm_reservation((select v from r where k = 'tent')) $q$, 'Only tentative');
select pg_temp.expect_error($q$ select public.mark_reservation_no_show((select v from r where k = 'future')) $q$, 'on or after the arrival date');
select public.mark_reservation_no_show((select v from r where k = 'tent'), 'لم يحضر');
do $$ begin
  assert (select status from public.reservations where id = (select v from r where k = 'tent')) = 'no_show', 'no-show';
  assert (select tentative_until from public.reservations where id = (select v from r where k = 'tent')) is null, 'hold cleared on confirm';
end $$;

-- =============================================================================
-- المواسم وتثبيت الأسعار
-- =============================================================================
insert into public.rate_seasons (hotel_id, name, date_from, date_to, adjust_pct)
select id, 'موسم الصيف', (select v from d where k = 'today') + 30, (select v from d where k = 'today') + 40, 10 from h9;
insert into ids select 'season', id from public.rate_seasons where hotel_id = (select id from h9);
insert into public.rate_season_prices (season_id, hotel_id, room_type_id, nightly_rate, weekend_rate)
select (select v from ids where k = 'season'), id, (select v from ids where k = 'rt_dbl'), 500, 550 from h9;
select pg_temp.expect_error($q$ insert into public.rate_seasons (hotel_id, name, date_from, date_to)
  select id, 'متداخل', (select v from d where k = 'today') + 40, (select v from d where k = 'today') + 45 from h9 $q$, 'rate_seasons_no_overlap');
-- الموسم غير الفعّال لا يتعارض
insert into public.rate_seasons (hotel_id, name, date_from, date_to, is_active)
select id, 'مسودة', (select v from d where k = 'today') + 35, (select v from d where k = 'today') + 45, false from h9;

do $$
declare
  h uuid := (select id from h9);
  v_q jsonb;
  v_expected numeric;
begin
  -- نوع له سعر في الموسم (مع سعر نهاية الأسبوع)
  v_q := public.quote_reservation(h, (select v from ids where k = 'rt_dbl'), (select v from d where k = 'today') + 29, (select v from d where k = 'today') + 33);
  select sum(case when n::date < (select v from d where k = 'today') + 30
                  then case when extract(dow from n)::int in (4, 5) then 350 else 300 end
                  else case when extract(dow from n)::int in (4, 5) then 550 else 500 end end)
    into v_expected from generate_series((select v from d where k = 'today') + 29, (select v from d where k = 'today') + 32, interval '1 day') n;
  assert (v_q ->> 'total')::numeric = v_expected, format('season prices: %s vs %s', v_q ->> 'total', v_expected);
  assert (v_q -> 'lines' -> 1 ->> 'season') = 'موسم الصيف', 'season name on line';
  assert (v_q -> 'lines' -> 0 ->> 'season') is null, 'no season before it starts';
  -- نوع بلا سعر في الموسم: نسبة التعديل على الأساسي
  v_q := public.quote_reservation(h, (select v from ids where k = 'rt_ste'), (select v from d where k = 'today') + 31, (select v from d where k = 'today') + 32);
  assert (v_q ->> 'total')::numeric = 880, 'adjust_pct applied (800 +10%)';
end $$;

-- الحجز يثبّت سعره: تغيير السعر الأساسي لاحقًا لا يغيّر الليالي المحجوزة
insert into r select 'lock', public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 20,
  p_departure_date => (select v from d where k = 'today') + 22);
create temp table lock_before as select stay_date, amount from public.reservation_nights where reservation_id = (select v from r where k = 'lock');
grant all on lock_before to authenticated;
update public.room_types set base_rate = 999, weekend_rate = 999 where id = (select v from ids where k = 'rt_dbl');
do $$ begin
  assert (select sum(amount) from public.reservation_nights where reservation_id = (select v from r where k = 'lock')) = (select sum(amount) from lock_before),
    'existing reservation keeps its rates';
end $$;
-- تمديد ليلة: الليالي القديمة بسعرها، والجديدة بالسعر الحالي
select public.update_reservation((select v from r where k = 'lock'), (select v from ids where k = 'rt_dbl'),
  (select v from d where k = 'today') + 20, (select v from d where k = 'today') + 23);
do $$ begin
  assert (select count(*) from public.reservation_nights where reservation_id = (select v from r where k = 'lock')) = 3, 'three nights';
  assert (select sum(amount) from public.reservation_nights where reservation_id = (select v from r where k = 'lock'))
       = (select sum(amount) from lock_before) + 999, 'new night at the current rate';
  assert (select total_amount from public.reservations where id = (select v from r where k = 'lock'))
       = (select sum(amount) from lock_before) + 999, 'total updated';
end $$;
-- إعادة التسعير الكامل عند الطلب
select public.update_reservation(p_reservation_id => (select v from r where k = 'lock'), p_room_type_id => (select v from ids where k = 'rt_dbl'),
  p_arrival_date => (select v from d where k = 'today') + 20, p_departure_date => (select v from d where k = 'today') + 23, p_reprice => true);
do $$ begin
  assert (select total_amount from public.reservations where id = (select v from r where k = 'lock')) = 2997, 'repriced at current rates';
end $$;
update public.room_types set base_rate = 300, weekend_rate = 350 where id = (select v from ids where k = 'rt_dbl');

-- =============================================================================
-- الإقامات الطويلة: سعر شهري وسعر يدوي
-- =============================================================================
do $$
declare
  h uuid := (select id from h9);
  v_arr date := (select v from d where k = 'today') + 60;
  v_dep date := (select v from d where k = 'today') + 122;
  v_id uuid;
  v_expected numeric := 0;
  v_seg date;
  v_end date;
begin
  v_id := public.create_reservation(p_hotel_id => h, p_guest_id => (select v from ids where k = 'g_salem'),
    p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => v_arr, p_departure_date => v_dep,
    p_pricing => 'monthly', p_fixed_rate => 9000, p_source => 'corporate');
  -- المتوقع: لكل شهر تقويمي نسبة لياليه من أيامه
  v_seg := v_arr;
  while v_seg < v_dep loop
    v_end := least(v_dep, (date_trunc('month', v_seg) + interval '1 month')::date);
    v_expected := v_expected + round(9000::numeric * (v_end - v_seg)
      / extract(day from (date_trunc('month', v_seg) + interval '1 month - 1 day')), 2);
    v_seg := v_end;
  end loop;
  assert (select count(*) from public.reservation_nights where reservation_id = v_id) = 62, '62 nights in one reservation';
  assert (select total_amount from public.reservations where id = v_id) = v_expected,
    format('monthly total %s vs %s', (select total_amount from public.reservations where id = v_id), v_expected);
  insert into r values ('long', v_id);
end $$;
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 130,
  p_departure_date => (select v from d where k = 'today') + 140, p_pricing => 'monthly', p_fixed_rate => 9000) $q$, 'at least 28 nights');
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 130,
  p_departure_date => (select v from d where k = 'today') + 131, p_pricing => 'fixed', p_fixed_rate => 150) $q$, 'reason is required');
insert into r select 'fixed', public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 130,
  p_departure_date => (select v from d where k = 'today') + 133, p_pricing => 'fixed', p_fixed_rate => 150, p_rate_reason => 'عقد شركة');
do $$ begin
  assert (select total_amount from public.reservations where id = (select v from r where k = 'fixed')) = 450, 'fixed rate x3';
end $$;
-- موظف الاستقبال لا يحدد سعرًا يدويًا
select pg_temp.act_as('00000000-0000-0000-0000-000000000902');
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 130,
  p_departure_date => (select v from d where k = 'today') + 131, p_pricing => 'fixed', p_fixed_rate => 1, p_rate_reason => 'x') $q$, 'pms.rates.override');
select pg_temp.act_as('00000000-0000-0000-0000-000000000901');

-- =============================================================================
-- الوحدات بالساعة (القاعة)
-- =============================================================================
insert into r select 'hall1', public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_hall'), p_room_id => (select v from ids where k = 'room_H1'),
  p_starts_at => ((select v from d where k = 'today') + 3) + time '16:00', p_ends_at => ((select v from d where k = 'today') + 3) + time '20:00',
  p_adults => 30::smallint);
do $$ begin
  assert (select total_amount from public.reservations where id = (select v from r where k = 'hall1')) = 400, '4 hours x 100';
  assert (select quantity from public.reservation_nights where reservation_id = (select v from r where k = 'hall1')) = 4, 'hours stored';
end $$;
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_hall'), p_room_id => (select v from ids where k = 'room_H1'),
  p_starts_at => ((select v from d where k = 'today') + 3) + time '18:00', p_ends_at => ((select v from d where k = 'today') + 3) + time '22:00') $q$, 'already booked');
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_hall'), p_room_id => (select v from ids where k = 'room_H1'),
  p_starts_at => ((select v from d where k = 'today') + 4) + time '10:00', p_ends_at => ((select v from d where k = 'today') + 4) + time '11:00') $q$, 'Minimum booking');
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_hall'),
  p_starts_at => ((select v from d where k = 'today') + 4) + time '10:00', p_ends_at => ((select v from d where k = 'today') + 4) + time '13:00') $q$, 'specific unit');
-- حجز متلاصق (يبدأ عند انتهاء السابق) مسموح
select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_hall'), p_room_id => (select v from ids where k = 'room_H1'),
  p_starts_at => ((select v from d where k = 'today') + 3) + time '20:00', p_ends_at => ((select v from d where k = 'today') + 3) + time '22:00');

-- =============================================================================
-- الحجز المتكرر: تخطي الموعد المتعارض وإضافته لقائمة الانتظار
-- =============================================================================
do $$
declare
  h uuid := (select id from h9);
  v_start date := (select v from d where k = 'today') + 150;
  v_dow smallint := extract(dow from ((select v from d where k = 'today') + 150))::smallint;
  v_res jsonb;
begin
  -- الغرفة 103 مشغولة في الأسبوع الثالث
  perform public.create_reservation(p_hotel_id => h, p_guest_id => (select v from ids where k = 'g_mona'),
    p_room_type_id => (select v from ids where k = 'rt_dbl'), p_room_id => (select v from ids where k = 'room_103'),
    p_arrival_date => v_start + 14, p_departure_date => v_start + 15);
  v_res := public.create_reservation_series(p_hotel_id => h, p_guest_id => (select v from ids where k = 'g_salem'),
    p_room_type_id => (select v from ids where k = 'rt_dbl'), p_weekday => v_dow,
    p_start_date => v_start, p_end_date => v_start + 34, p_nights => 2::smallint, p_room_id => (select v from ids where k = 'room_103'));
  assert (v_res ->> 'created')::int = 4, format('4 of 5 weeks booked: %s', v_res);
  assert jsonb_array_length(v_res -> 'skipped') = 1 and (v_res -> 'skipped' ->> 0)::date = v_start + 14, 'conflict skipped';
  assert (v_res ->> 'waitlisted')::int = 1, 'conflict waitlisted';
  assert (select count(*) from public.reservations where series_id = (v_res ->> 'series_id')::uuid) = 4, 'linked to series';
  assert (select count(*) from public.waitlist_entries where series_id = (v_res ->> 'series_id')::uuid) = 1, 'waitlist linked';
  insert into ids values ('series', (v_res ->> 'series_id')::uuid);

  -- قاعة كل أسبوع من 10 إلى 12
  v_res := public.create_reservation_series(p_hotel_id => h, p_guest_id => (select v from ids where k = 'g_mona'),
    p_room_type_id => (select v from ids where k = 'rt_hall'), p_weekday => v_dow, p_start_date => v_start, p_end_date => v_start + 20,
    p_start_time => time '10:00', p_end_time => time '12:00', p_room_id => (select v from ids where k = 'room_H1'));
  assert (v_res ->> 'created')::int = 3, 'weekly hall sessions';
end $$;
select pg_temp.expect_error($q$ select public.create_reservation_series(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_weekday => 1::smallint, p_start_date => (select v from d where k = 'today') + 1,
  p_end_date => (select v from d where k = 'today') + 400, p_nights => 1::smallint) $q$, 'Invalid date range');
select pg_temp.expect_error($q$ select public.create_reservation_series(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_salem'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_weekday => extract(dow from (select v from d where k = 'today') + 2)::smallint,
  p_start_date => (select v from d where k = 'today') + 3, p_end_date => (select v from d where k = 'today') + 5, p_nights => 1::smallint) $q$, 'does not occur');
do $$
declare v_n int;
begin
  v_n := public.cancel_reservation_series((select v from ids where k = 'series'), 'انتهى العقد', (select v from d where k = 'today') + 160);
  -- الأسابيع: +150، +157، (+164 تُخطي)، +171، +178 ← الإلغاء من +160 يشمل آخر اثنين
  assert v_n = 2, format('future occurrences cancelled: %s', v_n);
  assert (select count(*) from public.reservations where series_id = (select v from ids where k = 'series') and status = 'confirmed') = 2, 'earlier occurrences kept';
  assert (select status from public.reservation_series where id = (select v from ids where k = 'series')) = 'cancelled', 'series cancelled';
  assert not exists (select 1 from public.waitlist_entries where series_id = (select v from ids where k = 'series') and status = 'waiting'), 'waitlist cancelled too';
end $$;

-- =============================================================================
-- قائمة الانتظار: تصبح متاحة عند تحرر غرفة وتتحول لحجز
-- =============================================================================
do $$
declare
  h uuid := (select id from h9);
  v_w uuid;
  v_res uuid;
  v_first uuid;
begin
  -- اليوم +10: بعد إلغاء الحجز a بقيت غرفة واحدة؛ نملؤها فيصبح مشغولًا بالكامل
  perform public.create_reservation(p_hotel_id => h, p_guest_id => (select v from ids where k = 'g_mona'),
    p_room_type_id => (select v from ids where k = 'rt_dbl'),
    p_arrival_date => (select v from d where k = 'today') + 10, p_departure_date => (select v from d where k = 'today') + 11);
  v_w := public.add_waitlist_entry(p_hotel_id => h, p_room_type_id => (select v from ids where k = 'rt_dbl'),
    p_arrival_date => (select v from d where k = 'today') + 10, p_departure_date => (select v from d where k = 'today') + 11,
    p_guest_name => 'ضيف منتظر', p_phone => '777999');
  assert not (select is_available from public.waitlist_overview(h) where id = v_w), 'not available while full';
  assert public.waitlist_ready_count(h) = 0, 'nothing ready';

  select id into v_first from public.reservations
   where hotel_id = h and room_type_id = (select v from ids where k = 'rt_dbl') and status = 'confirmed'
     and arrival_date = (select v from d where k = 'today') + 10 limit 1;
  perform public.cancel_reservation(v_first, 'أُلغي');
  assert (select is_available from public.waitlist_overview(h) where id = v_w), 'available after a cancellation';
  assert public.waitlist_ready_count(h) = 1, 'one ready';
  assert (public.front_desk_summary(h) ->> 'waitlist_ready')::int = 1, 'front desk alert';

  v_res := public.convert_waitlist_entry(v_w);
  assert (select status from public.waitlist_entries where id = v_w) = 'converted', 'converted';
  assert (select reservation_id from public.waitlist_entries where id = v_w) = v_res, 'linked';
  assert exists (select 1 from public.guests where id = (select guest_id from public.waitlist_entries where id = v_w) and full_name = 'ضيف منتظر'),
    'guest created from the waitlist entry';
  insert into ids values ('wait', v_w);
end $$;
select pg_temp.expect_error($q$ select public.convert_waitlist_entry((select v from ids where k = 'wait')) $q$, 'no longer waiting');
select pg_temp.expect_error($q$ select public.add_waitlist_entry(p_hotel_id => (select id from h9), p_room_type_id => (select v from ids where k = 'rt_hall'),
  p_arrival_date => (select v from d where k = 'today') + 1, p_departure_date => (select v from d where k = 'today') + 2, p_guest_name => 'x') $q$, 'nightly room types');

-- =============================================================================
-- الحجز الجماعي: كل الغرف أو لا شيء
-- =============================================================================
do $$
declare
  h uuid := (select id from h9);
  v_group uuid;
  v_before int;
begin
  v_group := public.create_group_reservation(p_hotel_id => h, p_name => 'وفد المؤتمر', p_guest_id => (select v from ids where k = 'g_salem'),
    p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 200,
    p_departure_date => (select v from d where k = 'today') + 203, p_rooms => 3::smallint);
  assert (select count(*) from public.reservations where group_id = v_group) = 3, 'three rooms in the group';
  assert (select group_number from public.reservation_groups where id = v_group) like 'GRP-%', 'group number';
  select count(*) into v_before from public.reservations where hotel_id = h;
  begin
    perform public.create_group_reservation(p_hotel_id => h, p_name => 'كبير', p_guest_id => (select v from ids where k = 'g_salem'),
      p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 210,
      p_departure_date => (select v from d where k = 'today') + 211, p_rooms => 5::smallint);
    raise exception 'group beyond capacity should fail';
  exception when exclusion_violation then null;
  end;
  assert (select count(*) from public.reservations where hotel_id = h) = v_before, 'nothing booked from a failed group';
end $$;

-- =============================================================================
-- خصم اللحظة الأخيرة
-- =============================================================================
insert into public.last_minute_rules (hotel_id, name, room_type_id, days_before, discount_pct)
select id, 'عرض الليلة', (select v from ids where k = 'rt_dbl'), 1, 20 from h9;
do $$
declare
  h uuid := (select id from h9);
  v_q jsonb;
  v_id uuid;
begin
  v_q := public.quote_reservation(h, (select v from ids where k = 'rt_dbl'), (select v from d where k = 'today') + 1, (select v from d where k = 'today') + 2);
  assert (v_q ->> 'last_minute_pct')::numeric = 20, 'last-minute applies within 1 day';
  assert (v_q ->> 'discount')::numeric = round(((v_q -> 'lines' -> 0 ->> 'rate')::numeric) * 0.2, 2), 'discount amount';
  v_q := public.quote_reservation(h, (select v from ids where k = 'rt_dbl'), (select v from d where k = 'today') + 5, (select v from d where k = 'today') + 6);
  assert v_q ->> 'last_minute_pct' is null, 'no last-minute discount 5 days ahead';
  v_id := public.create_reservation(p_hotel_id => h, p_guest_id => (select v from ids where k = 'g_mona'),
    p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 1,
    p_departure_date => (select v from d where k = 'today') + 2);
  assert (select last_minute_pct from public.reservations where id = v_id) = 20, 'stored on reservation';
  assert (select sum(discount) from public.reservation_nights where reservation_id = v_id) > 0, 'discount on the night';
  -- الحجز اليدوي لا يأخذ خصم اللحظة الأخيرة
  v_id := public.create_reservation(p_hotel_id => h, p_guest_id => (select v from ids where k = 'g_mona'),
    p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 1,
    p_departure_date => (select v from d where k = 'today') + 2, p_pricing => 'fixed', p_fixed_rate => 200, p_rate_reason => 'x');
  assert (select total_amount from public.reservations where id = v_id) = 200, 'no stacking with manual rate';
end $$;

-- =============================================================================
-- حالة الغرف ومشرف التدبير
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000000903');
select public.set_room_status((select v from ids where k = 'room_102'), 'dirty');
select pg_temp.expect_error($q$ select public.set_room_status((select v from ids where k = 'room_104'), null, 'out_of_service') $q$, 'reason is required');
select public.set_room_status((select v from ids where k = 'room_104'), null, 'out_of_service', 'تسريب مياه');
select pg_temp.expect_error($q$ select public.create_reservation(p_hotel_id => (select id from h9), p_guest_id => (select v from ids where k = 'g_mona'),
  p_room_type_id => (select v from ids where k = 'rt_dbl'), p_arrival_date => (select v from d where k = 'today') + 1,
  p_departure_date => (select v from d where k = 'today') + 2) $q$, 'Permission denied');
-- لا يعدّل بيانات الغرف مباشرة (الإعداد لمن يملك صلاحيته)
update public.rooms set room_number = 'X' where id = (select v from ids where k = 'room_102');
do $$ begin
  assert exists (select 1 from public.rooms where id = (select v from ids where k = 'room_102') and room_number = '102'), 'RLS blocks setup edits';
  assert (select housekeeping_status from public.rooms where id = (select v from ids where k = 'room_102')) = 'dirty', 'status updated';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-000000000901');
do $$
declare h uuid := (select id from h9);
begin
  -- الغرفة خارج الخدمة لا تُباع ولا تُخصَّص
  assert (public.quote_reservation(h, (select v from ids where k = 'rt_dbl'), (select v from d where k = 'today') + 300,
          (select v from d where k = 'today') + 301) ->> 'capacity')::int = 3, 'out-of-service room reduces capacity';
  assert (public.front_desk_summary(h) ->> 'out_of_service')::int = 1, 'summary counts out of service';
  assert (public.front_desk_summary(h) ->> 'dirty')::int = 1, 'summary counts dirty rooms';
end $$;
select pg_temp.expect_error($q$ select public.assign_reservation_room((select v from r where k = 'lock'), (select v from ids where k = 'room_104')) $q$, 'out of service');
-- نوع الغرفة لا يتغير وعليها حجز قائم (الغرفة 103 عليها حجوزات الحجز المتكرر)
select pg_temp.expect_error($q$ update public.rooms set room_type_id = (select v from ids where k = 'rt_ste') where id = (select v from ids where k = 'room_103') $q$, 'active reservations');
-- حذف غرفة مرتبطة بحجوزات يمنعه المفتاح الأجنبي
select pg_temp.expect_error($q$ delete from public.rooms where id = (select v from ids where k = 'room_103') $q$, 'foreign key');
-- نوع الحجز ثابت بعد وجود حجوزات
select pg_temp.expect_error($q$ update public.room_types set booking_mode = 'hourly' where id = (select v from ids where k = 'rt_dbl') $q$, 'Booking mode cannot change');

-- =============================================================================
-- الكتابة المباشرة ممنوعة، والتدقيق يسجّل
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000000902');
select pg_temp.expect_error($q$ insert into public.reservations (hotel_id, confirmation_number, guest_id, room_type_id, booking_mode, arrival_date, departure_date)
  select id, 'X', (select v from ids where k = 'g_mona'), (select v from ids where k = 'rt_dbl'), 'nightly', current_date + 400, current_date + 401 from h9 $q$,
  'row-level security');
select pg_temp.expect_error($q$ select public.set_hotel_modules((select id from h9), array['pms']) $q$, 'Permission denied');
do $$ begin
  assert (select count(*) from public.room_type_availability((select id from h9), (select v from d where k = 'today'), (select v from d where k = 'today') + 7)) = 14,
    'availability rows: 2 nightly types x 7 days';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-000000000901');
do $$ begin
  assert (select count(*) from public.audit_logs where hotel_id = (select id from h9) and table_name = 'reservations') > 10, 'reservations audited';
  assert (select count(*) from public.audit_logs where hotel_id = (select id from h9) and table_name = 'rooms') >= 6, 'rooms audited';
end $$;

select pg_temp.act_as(null);
\o
select '✓ 09_pms: all assertions passed';

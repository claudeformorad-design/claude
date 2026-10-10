-- =============================================================================
-- اختبارات تدقيق نهاية اليوم: ترحيل الليالي، عدم الحضور، لقطة تقرير المدير،
-- منع التكرار والتواريخ المستقبلية، الصلاحيات، وكشف النزلاء
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001201', 'gm12@hotel.test'),
  ('00000000-0000-0000-0000-000000001202', 'desk12@hotel.test'),
  ('00000000-0000-0000-0000-000000001203', 'hk12@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000001201');
create temp table h12 as select public.create_hotel('فندق التدقيق', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
create temp table d (k text primary key, v date);
grant all on h12, ids, d to authenticated;
insert into d select 'today', app.today_for_hotel(id) from h12;
select public.add_hotel_member((select id from h12), 'desk12@hotel.test',
  array[(select id from public.roles where is_system and code = 'receptionist')]);
select public.add_hotel_member((select id from h12), 'hk12@hotel.test',
  array[(select id from public.roles where is_system and code = 'housekeeping')]);

insert into ids select 'pm_cash', id from public.payment_methods where hotel_id = (select id from h12) and code = 'CASH';
insert into public.room_types (hotel_id, code, name_ar, base_rate, max_adults) select id, 'DBL', 'مزدوجة', 200, 2 from h12;
insert into ids select 'rt', id from public.room_types where hotel_id = (select id from h12);
select public.create_rooms_bulk((select id from h12), (select v from ids where k = 'rt'), 101, 105);
insert into ids select 'room_' || room_number, id from public.rooms where hotel_id = (select id from h12);
insert into public.guests (hotel_id, full_name, nationality, id_type, id_number, phone)
select id, 'علي صالح', 'يمني', 'national_id', '0101', '777' from h12;
insert into public.guests (hotel_id, full_name) select id, 'منى' from h12;
insert into ids select 'g1', id from public.guests where hotel_id = (select id from h12) and full_name = 'علي صالح';
insert into ids select 'g2', id from public.guests where hotel_id = (select id from h12) and full_name = 'منى';

create or replace function pg_temp.book(p_guest text, p_room text, p_nights int) returns uuid language sql as $$
  select public.create_reservation(p_hotel_id => (select id from h12), p_guest_id => (select v from ids where k = p_guest),
    p_room_type_id => (select v from ids where k = 'rt'), p_room_id => (select v from ids where k = 'room_' || p_room),
    p_arrival_date => (select v from d where k = 'today'), p_departure_date => (select v from d where k = 'today') + p_nights);
$$;

-- نزيلان مقيمان (أحدهما ليلتان) + حجز لم يحضر + حجز لاحق لا يتأثر
insert into ids select 'r1', pg_temp.book('g1', '101', 2);
insert into ids select 'r2', pg_temp.book('g2', '102', 1);
insert into ids select 'r3', pg_temp.book('g2', '103', 1);
insert into ids select 'r4', public.create_reservation(p_hotel_id => (select id from h12), p_guest_id => (select v from ids where k = 'g2'),
  p_room_type_id => (select v from ids where k = 'rt'), p_arrival_date => (select v from d where k = 'today') + 3, p_departure_date => (select v from d where k = 'today') + 4);
select public.check_in_reservation((select v from ids where k = 'r1'));
select public.check_in_reservation((select v from ids where k = 'r2'));
select public.record_reservation_deposit((select v from ids where k = 'r3'), (select v from ids where k = 'pm_cash'), 50);

-- =============================================================================
-- الصلاحيات والمعاينة
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001203');
select pg_temp.expect_error($q$ select public.night_audit_status((select id from h12)) $q$, 'Permission denied');
select pg_temp.expect_error($q$ select public.run_night_audit((select id from h12)) $q$, 'Permission denied');
select pg_temp.expect_error($q$ select * from public.guest_register((select id from h12)) $q$, 'Permission denied');

select pg_temp.act_as('00000000-0000-0000-0000-000000001202');
do $$
declare s jsonb := public.night_audit_status((select id from h12));
begin
  assert (s ->> 'done')::boolean = false, 'not yet audited';
  assert (s ->> 'unposted_nights')::int = 2, format('two nights to post %s', s);
  assert jsonb_array_length(s -> 'pending_no_shows') = 1, 'one pending no-show';
end $$;
select pg_temp.expect_error($q$ select public.run_night_audit((select id from h12), (select v from d where k = 'today') + 1) $q$, 'future date');

-- =============================================================================
-- التشغيل
-- =============================================================================
do $$
declare s jsonb := public.run_night_audit((select id from h12));
begin
  assert (s ->> 'nights_posted')::int = 2, format('nights posted %s', s);
  assert (s ->> 'no_shows_marked')::int = 1, 'no-show marked';
  assert (s ->> 'occupied')::int = 2 and (s ->> 'capacity')::int = 5, 'occupancy counts';
  assert (s ->> 'occupancy_pct')::numeric = 40, 'occupancy %';
  assert (s ->> 'room_revenue')::numeric = 400 and (s ->> 'adr')::numeric = 200 and (s ->> 'revpar')::numeric = 80, format('kpis %s', s);
  assert (s ->> 'arrivals')::int = 2, 'arrivals today';
  assert (select net from jsonb_to_recordset(s -> 'revenue_by_category') as x(category text, net numeric) where category = 'room') = 400, 'room revenue by category';
  assert (select amount from jsonb_to_recordset(s -> 'collections') as x(method text, kind text, amount numeric) where kind = 'cash') = 50, 'cash collected';
  assert (s ->> 'guests')::int = 2, 'guests in house';
end $$;
do $$ begin
  assert (select status from public.reservations where id = (select v from ids where k = 'r3')) = 'no_show', 'r3 no-show';
  assert (select status from public.reservations where id = (select v from ids where k = 'r4')) = 'confirmed', 'future booking untouched';
  -- العربون يبقى على الفوليو المفتوح لقرار الإدارة
  assert (select f.status from public.guest_folios f join public.reservations r on r.folio_id = f.id where r.id = (select v from ids where k = 'r3')) = 'open', 'deposit folio kept';
  assert (select count(*) from public.reservation_nights n where n.reservation_id in ((select v from ids where k = 'r1'), (select v from ids where k = 'r2'))
           and n.folio_transaction_id is not null) = 2, 'tonight posted, tomorrow not';
  assert (select count(*) from public.night_audits) = 1, 'audit readable';
end $$;
select pg_temp.expect_error($q$ select public.run_night_audit((select id from h12)) $q$, 'has already run');
select pg_temp.expect_error($q$ select public.run_night_audit((select id from h12), (select v from d where k = 'today') - 1) $q$, 'A later day has already been audited');

-- =============================================================================
-- كشف النزلاء
-- =============================================================================
do $$ begin
  assert (select count(*) from public.guest_register((select id from h12))) = 2, 'two guests tonight';
  assert (select id_number from public.guest_register((select id from h12)) where full_name = 'علي صالح') = '0101', 'identity shown';
  assert (select count(*) from public.guest_register((select id from h12), (select v from d where k = 'today') + 1)) = 1, 'one guest tomorrow';
end $$;

select pg_temp.act_as(null);
\o
select '✓ 12_night_audit: all assertions passed';

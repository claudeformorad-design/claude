-- =============================================================================
-- اختبارات كشف النزلاء للجهات الأمنية: المقيمون والواصلون والمغادرون والصلاحيات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003801', 'gm38@hotel.test'),
  ('00000000-0000-0000-0000-000000003802', 'hk38@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000003801');
create temp table h38 as select public.create_hotel('فندق الكشف', 'YE', 'YER') as id;
create temp table ids (k text primary key, v uuid);
create temp table d (k text primary key, v date);
grant all on h38, ids, d to authenticated;
insert into d select 'today', app.today_for_hotel(id) from h38;
select public.add_hotel_member((select id from h38), 'hk38@hotel.test', array[(select id from public.roles where is_system and code = 'housekeeping')]);
create or replace function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
create or replace function pg_temp.dt() returns date language sql as $$ select v from d where k = 'today' $$;
insert into public.room_types (hotel_id, code, name_ar, base_rate, max_adults) select id, 'DBL', 'مزدوجة', 100, 2 from h38;
insert into ids select 'rt', id from public.room_types where hotel_id = (select id from h38);
select public.create_rooms_bulk((select id from h38), pg_temp.v('rt'), 101, 104);
insert into ids select 'room_' || room_number, id from public.rooms where hotel_id = (select id from h38);
insert into public.guests (hotel_id, full_name, nationality, id_type, id_number) select id, 'أحمد', 'يمني', 'national_id', '0101' from h38;
insert into public.guests (hotel_id, full_name, nationality) select id, 'بلا هوية', 'سعودي' from h38;
insert into ids select 'g_' || full_name, id from public.guests where hotel_id = (select id from h38);

-- مقيم من أمس (يغادر غدًا)، وواصل اليوم بلا هوية، ومقيم يغادر اليوم
create or replace function pg_temp.stay(p_guest uuid, p_room text, p_arr date, p_dep date) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := public.create_reservation(p_hotel_id => (select id from h38), p_guest_id => p_guest, p_room_type_id => pg_temp.v('rt'),
         p_room_id => pg_temp.v('room_' || p_room), p_arrival_date => p_arr, p_departure_date => p_dep);
  return v;
end $$;
select pg_temp.act_as(null);
-- حجز بدأ أمس: يُنشأ ويُسجَّل وصوله اليوم ثم يُعاد تاريخ وصوله وتسجيله إلى أمس (بيانات اختبار)
select pg_temp.act_as('00000000-0000-0000-0000-000000003801');
insert into ids select 'r_old', pg_temp.stay(pg_temp.v('g_أحمد'), '101', pg_temp.dt(), pg_temp.dt() + 2);
select public.check_in_reservation(pg_temp.v('r_old'));
select pg_temp.act_as(null);
update public.reservations set arrival_date = pg_temp.dt() - 1, checked_in_at = now() - interval '1 day' where id = pg_temp.v('r_old');
select pg_temp.act_as('00000000-0000-0000-0000-000000003801');
insert into ids select 'r_new', pg_temp.stay(pg_temp.v('g_بلا هوية'), '102', pg_temp.dt(), pg_temp.dt() + 1);
select public.check_in_reservation(pg_temp.v('r_new'));
insert into ids select 'r_out', pg_temp.stay(pg_temp.v('g_أحمد'), '103', pg_temp.dt(), pg_temp.dt() + 1);
select public.check_in_reservation(pg_temp.v('r_out'));
select public.post_reservation_charges(pg_temp.v('r_out'), pg_temp.dt());
select public.post_folio_payment((select folio_id from public.reservations where id = pg_temp.v('r_out')),
  (select id from public.payment_methods where hotel_id = (select id from h38) and code = 'CASH'),
  (select balance from public.folio_balances where folio_id = (select folio_id from public.reservations where id = pg_temp.v('r_out'))));
select public.check_out_reservation(pg_temp.v('r_out'));

do $$ begin
  -- المقيمون الليلة: القديم والجديد (المغادر اليوم مغادرته تُقصّر الإقامة فلا يبقى مقيمًا)
  perform pg_temp.check((select count(*) from public.guest_movements((select id from h38), pg_temp.dt(), 'in_house')) = 2, format('in-house tonight %s', (select json_agg(json_build_object('room', x.room_number, 'arr', x.arrival_date, 'dep', x.departure_date)) from public.guest_movements((select id from h38), pg_temp.dt(), 'in_house') x)));
  perform pg_temp.check((select count(*) from public.guest_movements((select id from h38), pg_temp.dt(), 'arrivals')) = 2, 'arrived today: new and the early checkout');
  perform pg_temp.check((select array_agg(room_number order by room_number) from public.guest_movements((select id from h38), pg_temp.dt(), 'departures')) = array['103'], 'left today');
  perform pg_temp.check((select id_number from public.guest_movements((select id from h38), pg_temp.dt(), 'in_house') where room_number = '102') is null, 'missing ID shown as empty');
  perform pg_temp.check((select count(*) from public.guest_movements((select id from h38), pg_temp.dt() - 1, 'arrivals')) = 1, 'yesterday arrival');
end $$;
select pg_temp.expect_error($q$ select * from public.guest_movements((select id from h38), current_date, 'all') $q$, 'Unknown register list');
select pg_temp.act_as('00000000-0000-0000-0000-000000003802');
select pg_temp.expect_error($q$ select * from public.guest_movements((select id from h38), current_date, 'in_house') $q$, 'Permission denied');

\o
select 'police register tests passed';

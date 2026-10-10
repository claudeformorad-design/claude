-- =============================================================================
-- اختبارات التسكين والمغادرة: العربون على فوليو الحجز، التسكين، ترحيل الليالي بالضريبة،
-- التمديد والتقصير، نقل الغرفة، المغادرة المبكرة والفاتورة، الإلغاء مع العربون، الوحدات بالساعة،
-- وتطابق الأستاذ العام مع الفوليوهات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001001', 'gm10@hotel.test'),
  ('00000000-0000-0000-0000-000000001002', 'desk10@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000001001');
create temp table h10 as select public.create_hotel('فندق الإقامات', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
create temp table d (k text primary key, v date);
grant all on h10, ids, d to authenticated;
insert into d select 'today', app.today_for_hotel(id) from h10;
select public.add_hotel_member((select id from h10), 'desk10@hotel.test',
  array[(select id from public.roles where is_system and code = 'receptionist')]);

-- ضريبة 15% على الإقامة
insert into public.tax_rates (hotel_id, code, name_ar, kind, rate, account_id)
select id, 'VAT', 'ضريبة القيمة المضافة', 'vat', 15, (select c.id from public.chart_of_accounts c where c.hotel_id = h10.id and system_key = 'vat_output') from h10;
insert into public.charge_code_taxes (hotel_id, charge_code_id, tax_rate_id)
select h10.id, (select id from public.charge_codes where hotel_id = h10.id and code = 'ROOM'), (select id from public.tax_rates where hotel_id = h10.id and code = 'VAT') from h10;
insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h10);

insert into public.room_types (hotel_id, code, name_ar, base_rate, max_adults) select id, 'DBL', 'مزدوجة', 200, 2 from h10;
insert into public.room_types (hotel_id, code, name_ar, booking_mode, base_rate, min_hours, max_adults, charge_code_id)
select id, 'HALL', 'قاعة', 'hourly', 100, 1, 100, (select c.id from public.charge_codes c where c.hotel_id = h10.id and c.code = 'EVENTS') from h10;
insert into ids select 'rt_' || lower(code), id from public.room_types where hotel_id = (select id from h10);
select public.create_rooms_bulk((select id from h10), (select v from ids where k = 'rt_dbl'), 101, 103);
select public.create_rooms_bulk((select id from h10), (select v from ids where k = 'rt_hall'), 1, 1, null, 'H');
insert into ids select 'room_' || room_number, id from public.rooms where hotel_id = (select id from h10);
insert into public.guests (hotel_id, full_name) select id, 'سالم' from h10;
insert into ids select 'g', id from public.guests where hotel_id = (select id from h10);

create or replace function pg_temp.book(p_arr int, p_dep int) returns uuid language sql as $$
  select public.create_reservation(p_hotel_id => (select id from h10), p_guest_id => (select v from ids where k = 'g'),
    p_room_type_id => (select v from ids where k = 'rt_dbl'),
    p_arrival_date => (select v from d where k = 'today') + p_arr, p_departure_date => (select v from d where k = 'today') + p_dep);
$$;

-- =============================================================================
-- العربون قبل الوصول يفتح فوليو الحجز (بصلاحيات موظف الاستقبال)
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001002');
insert into ids select 'r1', pg_temp.book(0, 3);
select public.record_reservation_deposit((select v from ids where k = 'r1'), (select v from ids where k = 'pm_cash'), 300, 'إيصال 1');
do $$
declare v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = (select v from ids where k = 'r1');
  assert v_r.folio_id is not null, 'folio opened for the deposit';
  assert (select reservation_ref from public.guest_folios where id = v_r.folio_id) = v_r.confirmation_number, 'folio references the booking';
  assert (select deposit_balance from public.folio_balances where folio_id = v_r.folio_id) = 300, 'deposit on folio';
end $$;
-- العربون الثاني على نفس الفوليو
select public.record_reservation_deposit((select v from ids where k = 'r1'), (select v from ids where k = 'pm_card'), 50);
do $$ begin
  assert (select count(*) from public.guest_folios where hotel_id = (select id from h10)) = 1, 'one folio per reservation';
end $$;

-- =============================================================================
-- التسكين
-- =============================================================================
select pg_temp.expect_error($q$ select public.check_in_reservation((select v from ids where k = 'r1')) $q$, 'Assign a room');
select public.set_room_status((select v from ids where k = 'room_101'), 'dirty');
select pg_temp.expect_error($q$ select public.check_in_reservation((select v from ids where k = 'r1'), (select v from ids where k = 'room_101')) $q$, 'not clean');
select public.set_room_status((select v from ids where k = 'room_101'), 'inspected');
select pg_temp.expect_error($q$ select public.check_in_reservation((select v from ids where k = 'r1'), (select v from ids where k = 'room_101'), 0::smallint) $q$, 'between 1 and 9');
select pg_temp.expect_error($q$ select public.check_in_reservation((select v from ids where k = 'r1'), (select v from ids where k = 'room_101'), 10::smallint) $q$, 'between 1 and 9');
select public.check_in_reservation((select v from ids where k = 'r1'), (select v from ids where k = 'room_101'), 2::smallint);
do $$
declare v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = (select v from ids where k = 'r1');
  assert v_r.status = 'checked_in' and v_r.checked_in_at is not null, 'checked in';
  assert v_r.keys_issued = 2, 'room cards handed over are recorded';
  assert (select room_access from public.hotels where id = v_r.hotel_id) = 'card', 'hotels hand over cards by default';
  assert (select room_number from public.guest_folios where id = v_r.folio_id) = '101', 'folio room';
  assert (public.front_desk_summary(v_r.hotel_id) ->> 'in_house')::int = 1, 'in house';
end $$;
select pg_temp.expect_error($q$ select public.check_in_reservation((select v from ids where k = 'r1')) $q$, 'Only tentative or confirmed');
insert into ids select 'future', pg_temp.book(2, 3);
select pg_temp.expect_error($q$ select public.check_in_reservation((select v from ids where k = 'future'), (select v from ids where k = 'room_103')) $q$, 'Check-in opens');

-- =============================================================================
-- ترحيل الليالي: الليلة الحالية فقط، ولا تُرحَّل مرتين، وبالضريبة
-- =============================================================================
do $$
declare v_f uuid := (select folio_id from public.reservations where id = (select v from ids where k = 'r1'));
begin
  assert public.post_reservation_charges((select v from ids where k = 'r1')) = 1, 'tonight posted';
  assert public.post_reservation_charges((select v from ids where k = 'r1'), (select v from d where k = 'today') + 5) = 0, 'future nights wait for their date';
  assert (select balance from public.folio_balances where folio_id = v_f) = 230, 'night + 15% VAT';
  assert (select count(*) from public.reservation_nights where reservation_id = (select v from ids where k = 'r1') and folio_transaction_id is not null) = 1, 'marked posted';
end $$;

-- =============================================================================
-- التمديد والتقصير أثناء الإقامة
-- =============================================================================
select public.change_stay_departure((select v from ids where k = 'r1'), (select v from d where k = 'today') + 4);
do $$ begin
  assert (select total_amount from public.reservations where id = (select v from ids where k = 'r1')) = 800, 'extended to 4 nights';
end $$;
select public.change_stay_departure((select v from ids where k = 'r1'), (select v from d where k = 'today') + 2);
do $$ begin
  assert (select total_amount from public.reservations where id = (select v from ids where k = 'r1')) = 400, 'shortened to 2 nights';
  assert (select departure_date from public.guest_folios where id = (select folio_id from public.reservations where id = (select v from ids where k = 'r1')))
       = (select v from d where k = 'today') + 2, 'folio departure follows';
end $$;
select pg_temp.expect_error($q$ select public.change_stay_departure((select v from ids where k = 'r1'), (select v from d where k = 'today')) $q$, 'after today');

-- =============================================================================
-- نقل الغرفة
-- =============================================================================
select pg_temp.expect_error($q$ select public.move_reservation_room((select v from ids where k = 'r1'), (select v from ids where k = 'room_102'), ' ') $q$, 'reason is required');
select public.move_reservation_room((select v from ids where k = 'r1'), (select v from ids where k = 'room_102'), 'عطل في التكييف');
select pg_temp.expect_error($q$ select public.move_reservation_room((select v from ids where k = 'r1'), (select v from ids where k = 'room_102'), 'x') $q$, 'already in this room');
do $$
declare v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = (select v from ids where k = 'r1');
  assert v_r.room_id = (select v from ids where k = 'room_102'), 'moved';
  assert v_r.notes like '%101%102%عطل في التكييف%', 'move recorded';
  assert (select housekeeping_status from public.rooms where id = (select v from ids where k = 'room_101')) = 'dirty', 'old room to clean';
  assert (select room_number from public.guest_folios where id = v_r.folio_id) = '102', 'folio room updated';
end $$;

-- =============================================================================
-- المغادرة المبكرة: تُحتسب ليلة اليوم فقط، والعربون الزائد يُسترد قبل الإغلاق
-- =============================================================================
do $$
declare v_p jsonb;
begin
  v_p := public.prepare_check_out((select v from ids where k = 'r1'));
  assert (v_p ->> 'balance')::numeric = 230 and (v_p ->> 'deposits')::numeric = 350 and (v_p ->> 'due')::numeric = 0, format('prepare %s', v_p);
  assert (select departure_date from public.reservations where id = (select v from ids where k = 'r1')) = (select v from d where k = 'today') + 1, 'early departure shortens';
  assert (select count(*) from public.reservation_nights where reservation_id = (select v from ids where k = 'r1')) = 1, 'unused nights released';
end $$;
select pg_temp.expect_error($q$ select public.check_out_reservation((select v from ids where k = 'r1')) $q$, 'Unapplied deposit remains');
select public.refund_folio_deposit((select folio_id from public.reservations where id = (select v from ids where k = 'r1')), (select v from ids where k = 'pm_cash'), 120);
insert into ids select 'inv1', public.check_out_reservation((select v from ids where k = 'r1'));
do $$
declare v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = (select v from ids where k = 'r1');
  assert v_r.status = 'checked_out' and v_r.checked_out_at is not null, 'checked out';
  assert (select status from public.guest_folios where id = v_r.folio_id) = 'closed', 'folio closed';
  assert (select total from public.invoices where id = (select v from ids where k = 'inv1')) = 230, 'tax invoice';
  assert (select housekeeping_status from public.rooms where id = (select v from ids where k = 'room_102')) = 'dirty', 'room to clean';
end $$;
select pg_temp.expect_error($q$ select public.check_out_reservation((select v from ids where k = 'r1')) $q$, 'Only in-house');

-- =============================================================================
-- المغادرة مع رصيد مستحق: تُرفض حتى التحصيل
-- =============================================================================
insert into ids select 'r2', pg_temp.book(0, 1);
select public.check_in_reservation((select v from ids where k = 'r2'), (select v from ids where k = 'room_103'));
select pg_temp.expect_error($q$ select public.check_out_reservation((select v from ids where k = 'r2')) $q$, 'balance must be zero');
do $$ begin
  assert (select status from public.reservations where id = (select v from ids where k = 'r2')) = 'checked_in', 'still in house after a failed checkout';
  assert (public.prepare_check_out((select v from ids where k = 'r2')) ->> 'due')::numeric = 230, 'amount due';
end $$;
select public.post_folio_payment((select folio_id from public.reservations where id = (select v from ids where k = 'r2')), (select v from ids where k = 'pm_card'), 230);
select public.check_out_reservation((select v from ids where k = 'r2'));

-- =============================================================================
-- الإلغاء: فوليو فيه عربون يبقى مفتوحًا لاسترداده؛ والحجز بلا فوليو يُلغى مباشرة
-- =============================================================================
insert into ids select 'r3', pg_temp.book(5, 6);
select public.record_reservation_deposit((select v from ids where k = 'r3'), (select v from ids where k = 'pm_cash'), 100);
select public.cancel_reservation((select v from ids where k = 'r3'), 'تغيّرت الخطة');
do $$ begin
  assert (select g.status from public.guest_folios g join public.reservations r on r.folio_id = g.id where r.id = (select v from ids where k = 'r3')) = 'open',
    'folio with a deposit stays open for refund';
end $$;
select public.cancel_reservation((select v from ids where k = 'future'), 'لا حاجة');

-- =============================================================================
-- الوحدات بالساعة: تسكين وترحيل الجلسة ومغادرة
-- =============================================================================
insert into ids select 'hall', public.create_reservation(p_hotel_id => (select id from h10), p_guest_id => (select v from ids where k = 'g'),
  p_room_type_id => (select v from ids where k = 'rt_hall'), p_room_id => (select v from ids where k = 'room_H1'),
  p_starts_at => (select v from d where k = 'today') + time '10:00', p_ends_at => (select v from d where k = 'today') + time '12:30');
select public.check_in_reservation((select v from ids where k = 'hall'));
do $$
declare v_p jsonb := public.prepare_check_out((select v from ids where k = 'hall'));
begin
  assert (v_p ->> 'balance')::numeric = 250, format('2.5 hours x 100: %s', v_p);
  assert exists (select 1 from public.folio_transactions where folio_id = (v_p ->> 'folio_id')::uuid and description like '%10:00–12:30%'), 'session described';
end $$;
select public.post_folio_payment((select folio_id from public.reservations where id = (select v from ids where k = 'hall')), (select v from ids where k = 'pm_cash'), 250);
select public.check_out_reservation((select v from ids where k = 'hall'));

-- =============================================================================
-- الأستاذ العام يطابق الفوليوهات، وكل التحركات مسجّلة
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001001');
do $$
declare h uuid := (select id from h10);
begin
  assert not exists (select 1 from public.ledger_reconciliation(h) where difference <> 0), 'ledger reconciles';
  assert pg_temp.gl(h, 'guest_ledger') = (select coalesce(sum(balance), 0) from public.folio_balances where hotel_id = h), 'guest ledger = folios';
  assert -pg_temp.gl(h, 'guest_deposits') = (select coalesce(sum(deposit_balance), 0) from public.folio_balances where hotel_id = h), 'deposits = folios';
  assert -pg_temp.gl(h, 'revenue_rooms') = 400, format('room revenue %s', -pg_temp.gl(h, 'revenue_rooms'));
  assert -pg_temp.gl(h, 'vat_output') = 60, 'VAT on two nights';
  assert (select count(*) from public.audit_logs where hotel_id = h and table_name = 'reservations' and changed_fields @> array['status']) >= 5, 'status changes audited';
end $$;

select pg_temp.act_as(null);
\o
select '✓ 10_pms_stays: all assertions passed';

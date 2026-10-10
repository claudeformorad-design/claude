-- =============================================================================
-- اختبارات عمولات وكلاء الحجز: النسب، الحجوزات المستحقة بعد المغادرة على صافي الإيراد بلا ضريبة،
-- الترحيل مرة واحدة، العكس ثم إعادة الترحيل، والصلاحيات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

-- الاختبارات السابقة قد تترك التسجيل بالدعوة فقط؛ مستخدمو الاختبار يُضافون مباشرة
delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002801', 'gm28@hotel.test'),
  ('00000000-0000-0000-0000-000000002802', 'desk28@hotel.test');

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
create or replace function pg_temp.gl(p_hotel uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  join public.chart_of_accounts a on a.id = l.account_id
  where l.hotel_id = p_hotel and a.system_key = p_key;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-000000002801');
create temp table h28 as select public.create_hotel('فندق العمولات', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h28, ids to authenticated;
select public.add_hotel_member((select id from h28), 'desk28@hotel.test', array[(select id from public.roles where is_system and code = 'receptionist')]);
insert into public.tax_rates (hotel_id, code, name_ar, kind, rate, account_id)
select id, 'VAT', 'ضريبة القيمة المضافة', 'vat', 15, (select c.id from public.chart_of_accounts c where c.hotel_id = h28.id and system_key = 'vat_output') from h28;
insert into public.charge_code_taxes (hotel_id, charge_code_id, tax_rate_id)
select h28.id, (select id from public.charge_codes where hotel_id = h28.id and code = 'ROOM'), (select id from public.tax_rates where hotel_id = h28.id and code = 'VAT') from h28;
insert into public.room_types (hotel_id, code, name_ar, base_rate, max_adults) select id, 'DBL', 'مزدوجة', 200, 2 from h28;
insert into ids select 'rt', id from public.room_types where hotel_id = (select id from h28);
select public.create_rooms_bulk((select id from h28), (select v from ids where k = 'rt'), 101, 103);
insert into ids select 'room_' || room_number, id from public.rooms where hotel_id = (select id from h28);
insert into public.guests (hotel_id, full_name) select id, 'سالم' from h28;
insert into ids select 'g', id from public.guests where hotel_id = (select id from h28);
insert into ids select 'card', id from public.payment_methods where hotel_id = (select id from h28) and code = 'CARD';

-- حجز ليلة من Booking.com وآخر مباشر، يُسكَّنان ويغادران بعد السداد
create or replace function pg_temp.stay(p_source public.reservation_source, p_room text) returns uuid language plpgsql as $$
declare v_res uuid;
begin
  v_res := public.create_reservation(p_hotel_id => (select id from h28), p_guest_id => (select v from ids where k = 'g'),
    p_room_type_id => (select v from ids where k = 'rt'), p_arrival_date => app.today_for_hotel((select id from h28)),
    p_departure_date => app.today_for_hotel((select id from h28)) + 1, p_source => p_source);
  perform public.check_in_reservation(v_res, (select v from ids where k = p_room));
  perform public.post_folio_payment((select folio_id from public.reservations where id = v_res), (select v from ids where k = 'card'), 230);
  perform public.check_out_reservation(v_res);
  return v_res;
end $$;

-- الاستقبال لا يدير العمولات
select pg_temp.act_as('00000000-0000-0000-0000-000000002802');
select pg_temp.expect_error($q$ select public.save_channel_commission_rate((select id from h28), 'booking_com', 15) $q$, 'Permission denied');
select pg_temp.expect_error($q$ select * from public.pending_channel_commissions((select id from h28)) $q$, 'Permission denied');
select pg_temp.act_as('00000000-0000-0000-0000-000000002801');

select pg_temp.expect_error($q$ select public.save_channel_commission_rate((select id from h28), 'booking_com', 150) $q$, 'between 0 and 100');
select public.save_channel_commission_rate((select id from h28), 'booking_com', 18);
select public.save_channel_commission_rate((select id from h28), 'booking_com', 15);
select public.save_channel_commission_rate((select id from h28), 'expedia', 20);
select public.save_channel_commission_rate((select id from h28), 'expedia', 0);
select pg_temp.check((select count(*) from public.channel_commission_rates where hotel_id = (select id from h28)) = 1, 'zero rate removes the channel');
select pg_temp.check((select rate from public.channel_commission_rates where hotel_id = (select id from h28)) = 15, 'rate updated');

insert into ids select 'ota', pg_temp.stay('booking_com', 'room_101');
insert into ids select 'direct', pg_temp.stay('direct', 'room_102');

-- العمولة على صافي الليلة 200 بلا الضريبة، والحجز المباشر لا عمولة عليه
select pg_temp.check((select count(*) from public.pending_channel_commissions((select id from h28))) = 1, 'only the OTA stay is pending');
select pg_temp.check((select base_amount from public.pending_channel_commissions((select id from h28))) = 200, 'base excludes VAT');
select pg_temp.check((select amount from public.pending_channel_commissions((select id from h28))) = 30, '15% of 200');

select pg_temp.check(public.post_channel_commissions((select id from h28)) = 1, 'one commission posted');
select pg_temp.check(public.post_channel_commissions((select id from h28)) = 0, 'not posted twice');
select pg_temp.check(pg_temp.gl((select id from h28), 'commission_expense') = 30, 'expense 30');
select pg_temp.check(pg_temp.gl((select id from h28), 'commissions_payable') = -30, 'payable 30');
insert into ids select 'c1', id from public.reservation_commissions where reservation_id = (select v from ids where k = 'ota');
select pg_temp.check((select source::text from public.journal_entries where id = (select journal_entry_id from public.reservation_commissions where id = (select v from ids where k = 'c1'))) = 'commission', 'entry source');

-- العكس بسبب يعيد الحجز للقائمة ويمكن ترحيله من جديد
select pg_temp.expect_error($q$ select public.reverse_channel_commission((select v from ids where k = 'c1'), ' ') $q$, 'reason is required');
select public.reverse_channel_commission((select v from ids where k = 'c1'), 'نسبة خاطئة');
select pg_temp.expect_error($q$ select public.reverse_channel_commission((select v from ids where k = 'c1'), 'مرة ثانية') $q$, 'already reversed');
select pg_temp.check(pg_temp.gl((select id from h28), 'commission_expense') = 0, 'expense reversed');
select public.save_channel_commission_rate((select id from h28), 'booking_com', 12.5);
select pg_temp.check(public.post_channel_commissions((select id from h28), array[(select v from ids where k = 'ota')]) = 1, 'reposted');
select pg_temp.check(pg_temp.gl((select id from h28), 'commission_expense') = 25, 'new rate 12.5% of 200');

-- الكتابة المباشرة على الجداول ممنوعة
select pg_temp.expect_error($q$ insert into public.channel_commission_rates (hotel_id, source, rate) values ((select id from h28), 'agent', 5) $q$, 'channel_commission_rates');
delete from public.channel_commission_rates where hotel_id = (select id from h28);
select pg_temp.check((select count(*) from public.channel_commission_rates where hotel_id = (select id from h28)) = 1, 'direct delete has no effect');

select pg_temp.act_as(null);
\o
select 'channel commissions tests passed';

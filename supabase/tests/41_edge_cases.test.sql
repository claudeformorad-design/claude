-- =============================================================================
-- حالات حدّية: إشعار دائن أكبر من الفاتورة، إلغاء الحركة مرتين، إعادة حجز غرفة ملغاة،
-- حجز غرفة محجوزة، مغادرة برصيد غير صفري، وثبات الأستاذ العام بعدها
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000004101', 'gm41@hotel.test');
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

select pg_temp.act_as('00000000-0000-0000-0000-000000004101');
create temp table h41 as select public.create_hotel('فندق الحالات', 'YE', 'YER') as id;
create temp table ids (k text primary key, v uuid);
create temp table d (k text primary key, v date);
grant all on h41, ids, d to authenticated;
insert into d select 'today', app.today_for_hotel(id) from h41;
insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h41);
insert into public.room_types (hotel_id, code, name_ar, base_rate, max_adults) select id, 'DBL', 'مزدوجة', 100, 2 from h41;
insert into ids select 'rt', id from public.room_types where hotel_id = (select id from h41);
select public.create_rooms_bulk((select id from h41), (select v from ids where k = 'rt'), 101, 101);
insert into ids select 'room', id from public.rooms where hotel_id = (select id from h41);
insert into public.guests (hotel_id, full_name) select id, 'نزيل أ' from h41;
insert into public.guests (hotel_id, full_name) select id, 'نزيل ب' from h41;
insert into ids select 'ga', id from public.guests where full_name = 'نزيل أ';
insert into ids select 'gb', id from public.guests where full_name = 'نزيل ب';
select pg_temp.act_as('00000000-0000-0000-0000-000000004101');

-- حجز غرفة محجوزة في نفس الليالي مع منع الحجز الزائد
insert into ids select 'r1', public.create_reservation((select id from h41), (select v from ids where k = 'ga'), (select v from ids where k = 'rt'),
  (select v from d where k = 'today') + 3, (select v from d where k = 'today') + 5, 1::smallint, 0::smallint, (select v from ids where k = 'room'));
select pg_temp.expect_error($q$ select public.create_reservation((select id from h41), (select v from ids where k = 'gb'), (select v from ids where k = 'rt'),
  (select v from d where k = 'today') + 4, (select v from d where k = 'today') + 6, 1::smallint, 0::smallint, (select v from ids where k = 'room')) $q$, '');

-- بعد إلغاء الأول تُحجز الغرفة نفسها بنجاح
select public.cancel_reservation((select v from ids where k = 'r1'), 'اختبار');
insert into ids select 'r2', public.create_reservation((select id from h41), (select v from ids where k = 'gb'), (select v from ids where k = 'rt'),
  (select v from d where k = 'today') + 4, (select v from d where k = 'today') + 6, 1::smallint, 0::smallint, (select v from ids where k = 'room'));

-- إقامة ليلة ثم فاتورة ثم إشعار دائن أكبر من الفاتورة
insert into ids select 'r3', public.create_reservation((select id from h41), (select v from ids where k = 'ga'), (select v from ids where k = 'rt'),
  (select v from d where k = 'today'), (select v from d where k = 'today') + 1, 1::smallint, 0::smallint, (select v from ids where k = 'room'));
select public.check_in_reservation((select v from ids where k = 'r3'));
select public.post_reservation_charges((select v from ids where k = 'r3'));
select pg_temp.expect_error($q$ select public.check_out_reservation((select v from ids where k = 'r3')) $q$, '');
select public.post_folio_payment((select folio_id from public.reservations where id = (select v from ids where k = 'r3')), (select v from ids where k = 'pm_cash'), 100);
select public.check_out_reservation((select v from ids where k = 'r3'));
insert into ids select 'inv', id from public.invoices where hotel_id = (select id from h41) order by created_at desc limit 1;
select pg_temp.expect_error($q$ select public.create_credit_note((select v from ids where k = 'inv'), 100000, 'أكبر من الفاتورة') $q$, '');
select pg_temp.expect_error($q$ select public.create_credit_note((select v from ids where k = 'inv'), -5, 'سالب') $q$, '');

-- إلغاء حركة مرتين
insert into ids select 'f2', public.open_folio((select id from h41), 'زبون مطعم');
insert into ids select 'tx', public.post_folio_charge((select v from ids where k = 'f2'), (select id from public.charge_codes where hotel_id = (select id from h41) and code = 'BEV'), 50);
select public.void_folio_transaction((select v from ids where k = 'tx'), 'خطأ');
select pg_temp.expect_error($q$ select public.void_folio_transaction((select v from ids where k = 'tx'), 'مرة ثانية') $q$, 'already voided');

-- ثبات الأستاذ: ذمم النزلاء = مجموع أرصدة الفوليوهات، والقيود كلها متوازنة
do $$
declare v_h uuid := (select id from h41);
begin
  assert (select count(*) from (select journal_entry_id from public.journal_entry_lines l join public.journal_entries e on e.id = l.journal_entry_id
          where e.hotel_id = v_h and e.status = 'posted' group by journal_entry_id having sum(base_debit) <> sum(base_credit)) t) = 0, 'every entry balanced';
  assert (select coalesce(sum(l.debit - l.credit), 0) from public.journal_entry_lines l join public.journal_entries e on e.id = l.journal_entry_id
          join public.chart_of_accounts a on a.id = l.account_id where e.hotel_id = v_h and e.status = 'posted' and a.system_key = 'guest_ledger')
       = (select coalesce(sum(balance), 0) from public.folio_balances where hotel_id = v_h), 'guest ledger = folios';
end $$;

select pg_temp.act_as(null);
\o
select '✓ 41_edge_cases: all assertions passed';

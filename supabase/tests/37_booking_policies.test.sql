-- =============================================================================
-- اختبارات سياسات الحجز: العربون الإلزامي والتأكيد التلقائي، رسوم الإلغاء وعدم الحضور بحد العربون،
-- الإعفاء بصلاحية، وأقل عدد ليالٍ في الموسم
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003701', 'gm37@hotel.test'),
  ('00000000-0000-0000-0000-000000003702', 'desk37@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000003701');
create temp table h37 as select public.create_hotel('فندق السياسات', 'YE', 'YER') as id;
create temp table ids (k text primary key, v uuid);
create temp table d (k text primary key, v date);
grant all on h37, ids, d to authenticated;
insert into d select 'today', app.today_for_hotel(id) from h37;
select public.add_hotel_member((select id from h37), 'desk37@hotel.test', array[(select id from public.roles where is_system and code = 'receptionist')]);
create or replace function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
create or replace function pg_temp.dt(p_k text) returns date language sql as $$ select v from d where k = p_k $$;
insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h37);
insert into public.room_types (hotel_id, code, name_ar, base_rate, max_adults) select id, 'DBL', 'مزدوجة', 10000, 2 from h37;
insert into ids select 'rt', id from public.room_types where hotel_id = (select id from h37);
select public.create_rooms_bulk((select id from h37), pg_temp.v('rt'), 101, 110);
insert into public.guests (hotel_id, full_name) select id, 'نزيل' from h37;
insert into ids select 'g', id from public.guests where hotel_id = (select id from h37);
insert into public.customers (hotel_id, code, name_ar, customer_type, allow_credit) select id, 'CORP', 'شركة', 'company', true from h37;
insert into ids select 'corp', id from public.customers where hotel_id = (select id from h37) and code = 'CORP';
create or replace function pg_temp.book(p_arr date, p_nights int, p_customer uuid default null) returns uuid language sql as $$
  select public.create_reservation(p_hotel_id => (select id from h37), p_guest_id => pg_temp.v('g'), p_room_type_id => pg_temp.v('rt'),
    p_customer_id => p_customer, p_arrival_date => p_arr, p_departure_date => p_arr + p_nights);
$$;

-- بلا سياسة: كما كان (حجز مؤكد، إلغاء بلا رسوم)
insert into ids select 'r0', pg_temp.book(pg_temp.dt('today') + 5, 2);
select pg_temp.check((select status from public.reservations where id = pg_temp.v('r0')) = 'confirmed', 'no policy, confirmed');

-- =============================================================================
-- إعداد السياسة: عربون 30%، إلغاء مجاني حتى 48 ساعة قبل الوصول ثم الليلة الأولى، وعدم الحضور 50%
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000003702');
select pg_temp.expect_error($q$ select public.save_booking_policy((select id from h37), 30, 2, 48, 'first_night', 0, 'percent', 50) $q$, 'Permission denied');
select pg_temp.act_as('00000000-0000-0000-0000-000000003701');
select pg_temp.expect_error($q$ select public.save_booking_policy((select id from h37), 30, 2, 48, 'percent', 0, 'none', 0) $q$, 'fee percentage');
select pg_temp.expect_error($q$ select public.save_booking_policy((select id from h37), 30, 2, 48, 'weird', 0, 'none', 0) $q$, 'Unknown fee type');
select public.save_booking_policy((select id from h37), 30, 2, 48, 'first_night', 0, 'percent', 50);

-- =============================================================================
-- العربون الإلزامي
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000003702');
insert into ids select 'r1', pg_temp.book(pg_temp.dt('today') + 10, 3);
do $$
declare r public.reservations%rowtype; p jsonb;
begin
  select * into r from public.reservations where id = pg_temp.v('r1');
  perform pg_temp.check(r.status = 'tentative', 'held as tentative until deposit');
  perform pg_temp.check(r.tentative_until = pg_temp.dt('today') + 2, format('hold %s', r.tentative_until));
  p := public.reservation_policy_status(r.id);
  perform pg_temp.check((p ->> 'required_deposit')::numeric = 9000, format('30%% of 30000: %s', p));
  perform pg_temp.check((p ->> 'deposit_due')::numeric = 9000 and (p ->> 'cancel_fee')::numeric = 0, 'free cancel far ahead');
end $$;
-- الشركة بالآجل معفاة
insert into ids select 'rc', pg_temp.book(pg_temp.dt('today') + 10, 2, pg_temp.v('corp'));
select pg_temp.check((select status from public.reservations where id = pg_temp.v('rc')) = 'confirmed', 'credit company exempt');
-- لا تأكيد يدوي قبل العربون (موظف الاستقبال)
select pg_temp.expect_error($q$ select public.confirm_reservation(pg_temp.v('r1')) $q$, 'deposit of 9000');
-- عربون جزئي لا يكفي، ثم الاكتمال يؤكد تلقائيًا
select public.record_reservation_deposit(pg_temp.v('r1'), pg_temp.v('pm_cash'), 5000, null);
select pg_temp.check((select status from public.reservations where id = pg_temp.v('r1')) = 'tentative', 'partial deposit keeps tentative');
select public.record_reservation_deposit(pg_temp.v('r1'), pg_temp.v('pm_cash'), 4000, null);
select pg_temp.check((select status from public.reservations where id = pg_temp.v('r1')) = 'confirmed', 'full deposit confirms');
select pg_temp.check((select tentative_until from public.reservations where id = pg_temp.v('r1')) is null, 'hold cleared');
-- المدير يؤكد قبل العربون
insert into ids select 'r2', pg_temp.book(pg_temp.dt('today') + 12, 2);
select pg_temp.act_as('00000000-0000-0000-0000-000000003701');
select public.confirm_reservation(pg_temp.v('r2'));
select pg_temp.check((select status from public.reservations where id = pg_temp.v('r2')) = 'confirmed', 'manager override');

-- =============================================================================
-- الإلغاء
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000003702');
-- قبل المهلة: مجاني ويبقى العربون للإرجاع
select public.cancel_reservation(pg_temp.v('r1'), 'تغيّر السفر');
select pg_temp.check((select policy_fee from public.reservations where id = pg_temp.v('r1')) is null, 'free cancel, no fee');
select pg_temp.check((select deposit_balance from public.folio_balances where folio_id = (select folio_id from public.reservations where id = pg_temp.v('r1'))) = 9000, 'deposit kept for refund');

-- داخل المهلة: الليلة الأولى بحد العربون
insert into ids select 'r3', pg_temp.book(pg_temp.dt('today') + 1, 3);
select public.record_reservation_deposit(pg_temp.v('r3'), pg_temp.v('pm_cash'), 9000, null);
select pg_temp.check((select status from public.reservations where id = pg_temp.v('r3')) = 'confirmed', 'r3 confirmed by deposit');
do $$
declare p jsonb := public.reservation_policy_status(pg_temp.v('r3'));
begin
  perform pg_temp.check((p ->> 'cancel_fee')::numeric = 10000 and (p ->> 'cancel_charge')::numeric = 9000, format('fee capped by deposit %s', p));
end $$;
-- الإعفاء لمن يملك صلاحية التجاوز فقط
select pg_temp.expect_error($q$ select public.cancel_reservation(pg_temp.v('r3'), 'ظرف طارئ', true) $q$, 'Permission denied');
select public.cancel_reservation(pg_temp.v('r3'), 'لم يعد قادمًا');
do $$
declare r public.reservations%rowtype; f public.guest_folios%rowtype;
begin
  select * into r from public.reservations where id = pg_temp.v('r3');
  select * into f from public.guest_folios where id = r.folio_id;
  perform pg_temp.check(r.status = 'cancelled' and r.policy_fee = 9000, format('fee recorded %s', r.policy_fee));
  -- العربون غطّى الرسم كله: الفوليو أُغلق بفاتورة إن كان للموظف صلاحية الإغلاق، وإلا بقي مسوّى
  perform pg_temp.check((select balance from public.folio_balances where folio_id = f.id) = 0, 'folio settled');
  perform pg_temp.check((select deposit_balance from public.folio_balances where folio_id = f.id) = 0, 'deposit used');
  perform pg_temp.check(exists (select 1 from public.folio_transactions t join public.charge_codes c on c.id = t.charge_code_id
                                 where t.folio_id = f.id and c.code = 'CANCEL' and t.total_amount = 9000), 'CANCEL charge posted');
end $$;

-- المدير يعفي من الرسم
insert into ids select 'r4', pg_temp.book(pg_temp.dt('today') + 1, 2);
select public.record_reservation_deposit(pg_temp.v('r4'), pg_temp.v('pm_cash'), 6000, null);
select pg_temp.act_as('00000000-0000-0000-0000-000000003701');
select public.cancel_reservation(pg_temp.v('r4'), 'ظرف طارئ', true);
select pg_temp.check((select policy_fee from public.reservations where id = pg_temp.v('r4')) is null, 'waived');
select pg_temp.check((select deposit_balance from public.folio_balances where folio_id = (select folio_id from public.reservations where id = pg_temp.v('r4'))) = 6000, 'waived deposit kept');

-- عربون أكبر من الرسم: يُطبَّق بقدر الرسم ويبقى الباقي للإرجاع، والمدير يغلق الفوليو بفاتورة
insert into ids select 'r5', pg_temp.book(pg_temp.dt('today') + 1, 2);
select public.record_reservation_deposit(pg_temp.v('r5'), pg_temp.v('pm_cash'), 15000, null);
select public.cancel_reservation(pg_temp.v('r5'), 'إلغاء متأخر');
do $$
declare f uuid := (select folio_id from public.reservations where id = pg_temp.v('r5'));
begin
  perform pg_temp.check((select policy_fee from public.reservations where id = pg_temp.v('r5')) = 10000, 'first night fee');
  perform pg_temp.check((select deposit_balance from public.folio_balances where folio_id = f) = 5000, 'remaining deposit to refund');
  perform pg_temp.check((select status from public.guest_folios where id = f) = 'open', 'folio stays open for the refund');
end $$;

-- =============================================================================
-- عدم الحضور: 50% بحد العربون؛ بلا عربون لا رسم
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000003702');
insert into ids select 'r6', pg_temp.book(pg_temp.dt('today'), 2);
select public.record_reservation_deposit(pg_temp.v('r6'), pg_temp.v('pm_cash'), 6000, null);
select public.mark_reservation_no_show(pg_temp.v('r6'), 'لم يحضر');
select pg_temp.check((select policy_fee from public.reservations where id = pg_temp.v('r6')) = 6000, 'no-show 50% of 20000 capped at 6000');
insert into ids select 'r7', pg_temp.book(pg_temp.dt('today'), 2);
select pg_temp.act_as('00000000-0000-0000-0000-000000003701');
select public.confirm_reservation(pg_temp.v('r7'));
select public.mark_reservation_no_show(pg_temp.v('r7'), null);
select pg_temp.check((select policy_fee from public.reservations where id = pg_temp.v('r7')) is null, 'no deposit, nothing to charge');
select pg_temp.check((select folio_id from public.reservations where id = pg_temp.v('r7')) is null, 'no folio opened');

-- =============================================================================
-- أقل عدد ليالٍ في الموسم
-- =============================================================================
insert into public.rate_seasons (hotel_id, name, date_from, date_to, min_nights)
select id, 'العيد', pg_temp.dt('today') + 20, pg_temp.dt('today') + 25, 3 from h37;
select pg_temp.act_as('00000000-0000-0000-0000-000000003702');
select pg_temp.expect_error($q$ select pg_temp.book(pg_temp.dt('today') + 21, 2) $q$, 'minimum stay in season العيد is 3 nights');
-- حجز ينتهي قبل الموسم لا يتأثر، ويمر بليلة من الموسم يخضع له
select pg_temp.book(pg_temp.dt('today') + 18, 2);
select pg_temp.expect_error($q$ select pg_temp.book(pg_temp.dt('today') + 19, 2) $q$, 'minimum stay');
insert into ids select 'r8', pg_temp.book(pg_temp.dt('today') + 21, 3);
-- تقصير الحجز تحت الحد ممنوع
select pg_temp.expect_error($q$ select public.update_reservation(p_reservation_id => pg_temp.v('r8'), p_room_type_id => pg_temp.v('rt'),
  p_arrival_date => pg_temp.dt('today') + 21, p_departure_date => pg_temp.dt('today') + 22) $q$, 'minimum stay');
-- المدير يتجاوز
select pg_temp.act_as('00000000-0000-0000-0000-000000003701');
select pg_temp.book(pg_temp.dt('today') + 22, 1);

-- الدفاتر الفرعية تطابق الأستاذ
do $$
declare r record;
begin
  for r in select x.* from public.ledger_reconciliation((select id from h37)) x loop
    if r.difference <> 0 then raise exception 'Reconciliation difference for %: %', r.control, r.difference; end if;
  end loop;
end $$;

\o
select 'booking policies tests passed';

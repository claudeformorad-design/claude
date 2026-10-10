-- =============================================================================
-- الترحيل 21: التسكين والمغادرة — ربط الحجز بالفوليو في المحاسبة
--
-- • العربون قبل الوصول: يُفتح فوليو الحجز (إن لم يوجد) ويُسجَّل العربون عليه بقيده المحاسبي.
-- • التسكين: غرفة نظيفة في الخدمة، فتح/ربط الفوليو، والحالة «مقيم».
-- • ترحيل الليالي: كل ليلة محجوزة تُرحَّل رسمًا على الفوليو بسعرها المثبّت وكود إيراد نوع الغرفة
--   (الضرائب والقسم والحساب من كود الإيراد)، ولا تُرحَّل ليلة مرتين.
-- • المغادرة: المغادرة المبكرة تقصّر الإقامة وتحرر الليالي غير المستخدمة، ثم تُرحَّل بقية الليالي،
--   ويُغلق الفوليو بفاتورته الضريبية (بعد تسوية الرصيد)، والغرفة تصبح «تحتاج تنظيف».
-- • نقل الغرفة وتغيير تاريخ المغادرة للمقيمين، مع فحص السعة والتداخل.
-- الأموال كلها في المحاسبة: قسم إدارة الفندق لا يسجّل مبلغًا خارج الفوليو.
-- =============================================================================

alter table public.reservation_nights
  add column folio_transaction_id uuid references public.folio_transactions(id);
alter table public.reservations
  add column checked_in_at  timestamptz,
  add column checked_out_at timestamptz;

-- موظف الاستقبال يدير فوليو النزيل (رسوم ودفعات وعربون ومغادرة) ويرى الفاتورة الصادرة
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and (
  (r.code = 'receptionist' and p.code in ('folio.view', 'folio.manage', 'folio.checkout', 'invoices.view'))
  -- موظف الحجوزات يسجّل العربون على فوليو الحجز
  or (r.code = 'reservations_agent' and p.code in ('folio.view', 'folio.manage'))
)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- أسطر الليالي: الليالي المرحّلة على الفوليو لا تُحذف ولا يتغير سعرها
-- -----------------------------------------------------------------------------
create or replace function app.pms_write_nights(p_reservation_id uuid, p_keep_existing boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r    public.reservations%rowtype;
  v_keep boolean;
begin
  select * into v_r from public.reservations where id = p_reservation_id;
  if exists (
    select 1 from public.reservation_nights e
    where e.reservation_id = p_reservation_id and e.folio_transaction_id is not null
      and (e.stay_date < v_r.arrival_date or e.stay_date >= v_r.departure_date)
  ) then
    raise exception 'Nights already charged to the folio cannot be removed' using errcode = '23514';
  end if;
  v_keep := p_keep_existing and v_r.pricing = 'standard' and v_r.booking_mode = 'nightly';

  delete from public.reservation_nights e
   where e.reservation_id = p_reservation_id and e.folio_transaction_id is null
     and (not v_keep or e.stay_date < v_r.arrival_date or e.stay_date >= v_r.departure_date);

  insert into public.reservation_nights (reservation_id, hotel_id, stay_date, quantity, rate, discount, amount, season_id)
  select p_reservation_id, v_r.hotel_id, l.stay_date, l.quantity, l.rate, l.discount, l.amount, l.season_id
  from app.pms_price_lines(v_r.room_type_id, v_r.arrival_date, v_r.departure_date, v_r.pricing,
                           v_r.fixed_rate, v_r.starts_at, v_r.ends_at, v_r.last_minute_pct) l
  where not exists (
    select 1 from public.reservation_nights e where e.reservation_id = p_reservation_id and e.stay_date = l.stay_date
  );

  update public.reservations
     set total_amount = (select coalesce(sum(n.amount), 0) from public.reservation_nights n where n.reservation_id = p_reservation_id)
   where id = p_reservation_id;
end;
$$;

-- فوليو الحجز: يُفتح مرة واحدة ويُربط بالحجز (رقم التأكيد مرجعًا)
create or replace function app.pms_ensure_folio(p_reservation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.reservations%rowtype;
  v_guest  text;
  v_room   text;
  v_folio  uuid;
begin
  select * into v_r from public.reservations where id = p_reservation_id;
  if v_r.folio_id is not null and exists (select 1 from public.guest_folios where id = v_r.folio_id and status = 'open') then
    return v_r.folio_id;
  end if;
  if v_r.folio_id is not null then
    raise exception 'The reservation folio is already closed' using errcode = '23514';
  end if;
  select full_name into v_guest from public.guests where id = v_r.guest_id;
  select room_number into v_room from public.rooms where id = v_r.room_id;
  v_folio := public.open_folio(
    p_hotel_id => v_r.hotel_id, p_guest_name => v_guest, p_folio_type => 'guest', p_customer_id => v_r.customer_id,
    p_room_number => v_room, p_reservation_ref => v_r.confirmation_number, p_arrival_date => v_r.arrival_date,
    p_departure_date => v_r.departure_date, p_adults => v_r.adults);
  update public.reservations set folio_id = v_folio where id = v_r.id;
  return v_folio;
end;
$$;

-- -----------------------------------------------------------------------------
-- العربون قبل الوصول (أو أثناء الإقامة)
-- -----------------------------------------------------------------------------
create or replace function public.record_reservation_deposit(
  p_reservation_id    uuid,
  p_payment_method_id uuid,
  p_amount            numeric,
  p_reference         text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r     public.reservations%rowtype;
  v_folio uuid;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status not in ('tentative', 'confirmed', 'checked_in') then
    raise exception 'Deposits are recorded on active reservations only' using errcode = '23514';
  end if;
  v_folio := app.pms_ensure_folio(v_r.id);
  return public.post_folio_deposit(v_folio, p_payment_method_id, p_amount, app.today_for_hotel(v_r.hotel_id),
                                   p_reference, 'عربون الحجز ' || v_r.confirmation_number);
end;
$$;

-- -----------------------------------------------------------------------------
-- التسكين
-- -----------------------------------------------------------------------------
create or replace function public.check_in_reservation(p_reservation_id uuid, p_room_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.reservations%rowtype;
  v_room   public.rooms%rowtype;
  v_today  date;
  v_folio  uuid;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status not in ('tentative', 'confirmed') then
    raise exception 'Only tentative or confirmed reservations can be checked in' using errcode = '23514';
  end if;
  v_today := app.today_for_hotel(v_r.hotel_id);
  if v_r.arrival_date > v_today then
    raise exception 'Check-in opens on the arrival date (%)', v_r.arrival_date using errcode = '23514';
  end if;
  if v_r.booking_mode = 'nightly' and v_r.departure_date <= v_today then
    raise exception 'This stay has already ended; update the dates first' using errcode = '23514';
  end if;

  if p_room_id is not null and p_room_id is distinct from v_r.room_id then
    perform app.pms_check_room(p_room_id, v_r.room_type_id, v_r.period, v_r.id);
    v_r.room_id := p_room_id;
  end if;
  if v_r.room_id is null then
    raise exception 'Assign a room before check-in' using errcode = '23514';
  end if;
  select * into v_room from public.rooms where id = v_r.room_id for update;
  if v_room.service_status <> 'in_service' then
    raise exception 'Room % is out of service', v_room.room_number using errcode = '23514';
  end if;
  if v_r.booking_mode = 'nightly' and v_room.housekeeping_status = 'dirty' then
    raise exception 'Room % is not clean yet', v_room.room_number using errcode = '23514';
  end if;

  update public.reservations
     set room_id = v_r.room_id, status = 'checked_in', checked_in_at = now(), tentative_until = null
   where id = v_r.id;
  v_folio := app.pms_ensure_folio(v_r.id);
  perform set_config('app.system_posting', 'on', true);
  update public.guest_folios set room_number = v_room.room_number, departure_date = v_r.departure_date where id = v_folio;
  perform set_config('app.system_posting', 'off', true);
  return v_folio;
end;
$$;

-- -----------------------------------------------------------------------------
-- ترحيل الليالي على الفوليو (حتى تاريخ معيّن، افتراضيًا اليوم)
-- -----------------------------------------------------------------------------
create or replace function public.post_reservation_charges(p_reservation_id uuid, p_through date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.reservations%rowtype;
  v_cc     uuid;
  v_room   text;
  v_unit   text;
  v_n      record;
  v_txn    uuid;
  v_count  integer := 0;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status <> 'checked_in' then
    raise exception 'Charges are posted for in-house guests only' using errcode = '23514';
  end if;
  select coalesce(t.charge_code_id, (select c.id from public.charge_codes c where c.hotel_id = t.hotel_id and c.code = 'ROOM' and c.is_active)),
         t.name_ar
    into v_cc, v_unit
    from public.room_types t where t.id = v_r.room_type_id;
  if v_cc is null then
    raise exception 'Room type has no revenue charge code; set it in room setup' using errcode = '23514';
  end if;
  select room_number into v_room from public.rooms where id = v_r.room_id;

  for v_n in
    select * from public.reservation_nights
    where reservation_id = v_r.id and folio_transaction_id is null and amount > 0
      -- لا تُرحَّل ليلة قبل حلولها
      and stay_date <= least(coalesce(p_through, app.today_for_hotel(v_r.hotel_id)), app.today_for_hotel(v_r.hotel_id))
    order by stay_date
  loop
    v_txn := public.post_folio_charge(
      p_folio_id => v_r.folio_id, p_charge_code_id => v_cc, p_unit_price => v_n.amount, p_quantity => 1,
      p_business_date => v_n.stay_date,
      p_description => case when v_r.booking_mode = 'hourly'
        then v_unit || ' ' || v_room || ' — ' || to_char(v_r.starts_at, 'HH24:MI') || '–' || to_char(v_r.ends_at, 'HH24:MI')
             || ' (' || trim(to_char(v_n.quantity, 'FM999990.##')) || ' ساعات)'
        else 'إقامة ليلة ' || to_char(v_n.stay_date, 'YYYY-MM-DD') || ' — غرفة ' || v_room
             || case when v_n.discount > 0 then ' (بعد خصم ' || trim(to_char(v_n.discount, 'FM999999990.00')) || ')' else '' end
      end,
      p_reference => v_r.confirmation_number);
    update public.reservation_nights set folio_transaction_id = v_txn
     where reservation_id = v_r.id and stay_date = v_n.stay_date;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- تجهيز المغادرة: المغادرة المبكرة تقصّر الإقامة، ثم ترحيل كل الليالي المتبقية.
-- الناتج: رصيد الفوليو والعربون المتاح، لتحصيل المتبقي قبل الإغلاق.
-- -----------------------------------------------------------------------------
create or replace function public.prepare_check_out(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.reservations%rowtype;
  v_today  date;
  v_bal    record;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status <> 'checked_in' then
    raise exception 'Only in-house reservations can be checked out' using errcode = '23514';
  end if;
  v_today := app.today_for_hotel(v_r.hotel_id);

  -- مغادرة مبكرة: الليالي من اليوم فصاعدًا لم تُستخدم (ليلة واحدة على الأقل تُحتسب)
  if v_r.booking_mode = 'nightly' and v_r.departure_date > v_today then
    update public.reservations set departure_date = greatest(v_today, v_r.arrival_date + 1) where id = v_r.id;
    perform app.pms_write_nights(v_r.id, true);
    perform set_config('app.system_posting', 'on', true);
    update public.guest_folios set departure_date = greatest(v_today, v_r.arrival_date + 1) where id = v_r.folio_id;
    perform set_config('app.system_posting', 'off', true);
  end if;

  perform public.post_reservation_charges(v_r.id, (select max(stay_date) from public.reservation_nights where reservation_id = v_r.id));
  v_bal := app.folio_current_balances(v_r.folio_id);
  return jsonb_build_object('folio_id', v_r.folio_id, 'balance', v_bal.balance, 'deposits', v_bal.deposits,
                            'due', greatest(v_bal.balance - v_bal.deposits, 0));
end;
$$;

-- المغادرة: تجهيز ثم إغلاق الفوليو بفاتورته (يطبّق العربون ويشترط رصيدًا صفريًا)، والغرفة للتنظيف
create or replace function public.check_out_reservation(p_reservation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r        public.reservations%rowtype;
  v_invoice  uuid;
begin
  perform public.prepare_check_out(p_reservation_id);
  select * into v_r from public.reservations where id = p_reservation_id;
  if exists (select 1 from public.folio_transactions where folio_id = v_r.folio_id) then
    v_invoice := public.checkout_folio(v_r.folio_id, app.today_for_hotel(v_r.hotel_id));
  else
    -- إقامة مجانية بلا حركات: يُلغى الفوليو الفارغ
    perform public.cancel_folio(v_r.folio_id);
  end if;
  update public.reservations set status = 'checked_out', checked_out_at = now() where id = v_r.id;
  if v_r.booking_mode = 'nightly' then
    update public.rooms set housekeeping_status = 'dirty' where id = v_r.room_id;
  end if;
  return v_invoice;
end;
$$;

-- -----------------------------------------------------------------------------
-- نقل الغرفة أثناء الإقامة (نفس النوع أو ترقية إلى نوع آخر بفحص سعته)
-- -----------------------------------------------------------------------------
create or replace function public.move_reservation_room(p_reservation_id uuid, p_room_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.reservations%rowtype;
  v_new    public.rooms%rowtype;
  v_old    text;
  v_today  date;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status <> 'checked_in' then
    raise exception 'Room moves are for in-house guests; use room assignment for future reservations' using errcode = '23514';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to move rooms' using errcode = '23514';
  end if;
  select * into v_new from public.rooms where id = p_room_id and hotel_id = v_r.hotel_id and is_active;
  if v_new.id is null then
    raise exception 'Room not found or inactive' using errcode = '23503';
  end if;
  if v_new.id = v_r.room_id then
    raise exception 'The guest is already in this room' using errcode = '23514';
  end if;
  if (select booking_mode from public.room_types where id = v_new.room_type_id) <> v_r.booking_mode then
    raise exception 'Cannot switch between nightly and hourly bookings; create a new reservation' using errcode = '23514';
  end if;
  if v_new.housekeeping_status = 'dirty' then
    raise exception 'Room % is not clean yet', v_new.room_number using errcode = '23514';
  end if;
  v_today := app.today_for_hotel(v_r.hotel_id);
  -- نوع مختلف: الليالي المتبقية يجب أن تتسع في النوع الجديد
  if v_new.room_type_id <> v_r.room_type_id then
    perform 1 from public.room_types where id in (v_r.room_type_id, v_new.room_type_id) order by id for update;
    perform app.pms_check_availability(v_new.room_type_id, greatest(v_today, v_r.arrival_date), v_r.departure_date, v_r.id);
  end if;
  perform app.pms_check_room(v_new.id, v_new.room_type_id, v_r.period, v_r.id);

  select room_number into v_old from public.rooms where id = v_r.room_id;
  update public.reservations
     set room_id = v_new.id, room_type_id = v_new.room_type_id,
         notes = concat_ws(E'\n', notes, 'نُقل من الغرفة ' || v_old || ' إلى ' || v_new.room_number || ' (' || to_char(v_today, 'YYYY-MM-DD') || '): ' || trim(p_reason))
   where id = v_r.id;
  update public.rooms set housekeeping_status = 'dirty' where id = v_r.room_id;
  perform set_config('app.system_posting', 'on', true);
  update public.guest_folios set room_number = v_new.room_number where id = v_r.folio_id;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- تمديد أو تقصير إقامة المقيم (الليالي المرحّلة ثابتة، والمضافة تُسعَّر بالأسعار الحالية)
-- -----------------------------------------------------------------------------
create or replace function public.change_stay_departure(p_reservation_id uuid, p_departure_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.reservations%rowtype;
  v_today  date;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status <> 'checked_in' or v_r.booking_mode <> 'nightly' then
    raise exception 'Only in-house nightly stays can be extended or shortened here' using errcode = '23514';
  end if;
  v_today := app.today_for_hotel(v_r.hotel_id);
  if p_departure_date is null or p_departure_date <= v_today or p_departure_date <= v_r.arrival_date
     or p_departure_date - v_r.arrival_date > 366 then
    raise exception 'New departure must be after today and within 366 nights of arrival' using errcode = '23514';
  end if;
  if p_departure_date = v_r.departure_date then
    return;
  end if;
  perform 1 from public.room_types where id = v_r.room_type_id for update;
  if p_departure_date > v_r.departure_date then
    perform app.pms_check_availability(v_r.room_type_id, v_r.departure_date, p_departure_date, v_r.id);
    perform app.pms_check_room(v_r.room_id, v_r.room_type_id, tsrange(v_r.arrival_date::timestamp, p_departure_date::timestamp, '[)'), v_r.id);
  end if;
  update public.reservations set departure_date = p_departure_date where id = v_r.id;
  perform app.pms_write_nights(v_r.id, true);
  perform set_config('app.system_posting', 'on', true);
  update public.guest_folios set departure_date = p_departure_date where id = v_r.folio_id;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- الإلغاء وعدم الحضور: الفوليو الفارغ يُلغى معه؛ وإن كان عليه عربون يبقى مفتوحًا لاسترداده أو احتسابه
-- -----------------------------------------------------------------------------
create or replace function app.pms_release_folio(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folio uuid;
begin
  select folio_id into v_folio from public.reservations where id = p_reservation_id;
  if v_folio is not null
     and exists (select 1 from public.guest_folios where id = v_folio and status = 'open')
     and not exists (select 1 from public.folio_transactions where folio_id = v_folio) then
    perform public.cancel_folio(v_folio);
  end if;
end;
$$;

create or replace function public.cancel_reservation(p_reservation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.cancel');
  if v_r.status not in ('tentative', 'confirmed') then
    raise exception 'Only tentative or confirmed reservations can be cancelled' using errcode = '23514';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to cancel a reservation' using errcode = '23514';
  end if;
  update public.reservations
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = trim(p_reason)
   where id = v_r.id;
  perform app.pms_release_folio(v_r.id);
end;
$$;

create or replace function public.mark_reservation_no_show(p_reservation_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.cancel');
  if v_r.status not in ('tentative', 'confirmed') then
    raise exception 'Only tentative or confirmed reservations can be marked as no-show' using errcode = '23514';
  end if;
  if v_r.arrival_date > app.today_for_hotel(v_r.hotel_id) then
    raise exception 'No-show can only be recorded on or after the arrival date' using errcode = '23514';
  end if;
  update public.reservations
     set status = 'no_show', cancelled_at = now(), cancelled_by = auth.uid(),
         cancellation_reason = nullif(trim(p_reason), '')
   where id = v_r.id;
  perform app.pms_release_folio(v_r.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- صلاحيات التنفيذ
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema app from public, anon;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.record_reservation_deposit(uuid, uuid, numeric, text)',
    'public.check_in_reservation(uuid, uuid)',
    'public.post_reservation_charges(uuid, date)',
    'public.prepare_check_out(uuid)',
    'public.check_out_reservation(uuid)',
    'public.move_reservation_room(uuid, uuid, text)',
    'public.change_stay_departure(uuid, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

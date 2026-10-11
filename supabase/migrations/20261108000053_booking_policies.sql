-- =============================================================================
-- سياسات الحجز (لكل فندق، للحجوزات الليلية):
--   1) العربون الإلزامي: نسبة من قيمة الحجز. الحجز الجديد يبقى مبدئيًا حتى يُدفع العربون، ثم يتأكد تلقائيًا.
--      حجوزات الشركات بالآجل معفاة. التأكيد اليدوي قبل العربون لمن يملك صلاحية تجاوز الأسعار فقط.
--   2) رسوم الإلغاء: مجاني حتى عدد ساعات قبل موعد الوصول، وبعدها رسم (الليلة الأولى، أو نسبة، أو كامل المبلغ).
--   3) رسوم عدم الحضور: بنفس الأنواع.
--      الرسم يُخصم من العربون المدفوع فقط (لا يُطالَب النزيل الغائب بأكثر مما دفع): يُرحَّل على الفوليو برمز
--      «رسوم الإلغاء» ويُطبَّق عليه العربون، وإن لم يبق شيء يُغلق الفوليو بفاتورة، وإن بقي عربون يُرجَع من الفوليو.
--      الإعفاء من الرسم لمن يملك صلاحية تجاوز الأسعار.
--   4) أقل عدد ليالٍ في الموسم: حجز يمر بليلة من موسم له حد أدنى لا يقل عنه (إلا بصلاحية التجاوز).
-- =============================================================================

alter table public.hotels
  add column deposit_pct        numeric(5, 2) not null default 0 check (deposit_pct between 0 and 100),
  add column deposit_hold_days  smallint not null default 2 check (deposit_hold_days between 0 and 60),
  add column free_cancel_hours  integer not null default 24 check (free_cancel_hours between 0 and 8760),
  add column cancel_fee         text not null default 'none' check (cancel_fee in ('none', 'first_night', 'percent', 'full')),
  add column cancel_fee_pct     numeric(5, 2) not null default 0 check (cancel_fee_pct between 0 and 100),
  add column no_show_fee        text not null default 'none' check (no_show_fee in ('none', 'first_night', 'percent', 'full')),
  add column no_show_fee_pct    numeric(5, 2) not null default 0 check (no_show_fee_pct between 0 and 100);

alter table public.rate_seasons add column min_nights smallint check (min_nights is null or min_nights between 1 and 60);
alter table public.reservations add column policy_fee numeric(19, 4) check (policy_fee is null or policy_fee >= 0);

create or replace function public.save_booking_policy(
  p_hotel_id uuid, p_deposit_pct numeric, p_deposit_hold_days integer, p_free_cancel_hours integer,
  p_cancel_fee text, p_cancel_fee_pct numeric, p_no_show_fee text, p_no_show_fee_pct numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'pms.rates.manage');
  if coalesce(p_cancel_fee, '') not in ('none', 'first_night', 'percent', 'full') or coalesce(p_no_show_fee, '') not in ('none', 'first_night', 'percent', 'full') then
    raise exception 'Unknown fee type' using errcode = '22023';
  end if;
  if (p_cancel_fee = 'percent' and coalesce(p_cancel_fee_pct, 0) <= 0) or (p_no_show_fee = 'percent' and coalesce(p_no_show_fee_pct, 0) <= 0) then
    raise exception 'Enter the fee percentage' using errcode = '22023';
  end if;
  update public.hotels
     set deposit_pct = coalesce(p_deposit_pct, 0), deposit_hold_days = coalesce(p_deposit_hold_days, 2),
         free_cancel_hours = coalesce(p_free_cancel_hours, 0),
         cancel_fee = p_cancel_fee, cancel_fee_pct = case when p_cancel_fee = 'percent' then p_cancel_fee_pct else 0 end,
         no_show_fee = p_no_show_fee, no_show_fee_pct = case when p_no_show_fee = 'percent' then p_no_show_fee_pct else 0 end
   where id = p_hotel_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- حساب السياسة لحجز: العربون المطلوب والمدفوع، ورسم الإلغاء الآن، ورسم عدم الحضور
-- -----------------------------------------------------------------------------
create or replace function app.policy_fee(p_r public.reservations, p_kind text, p_pct numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(case p_kind
    when 'first_night' then coalesce((select n.amount from public.reservation_nights n where n.reservation_id = p_r.id order by n.stay_date limit 1), 0)
    when 'percent' then p_r.total_amount * coalesce(p_pct, 0) / 100
    when 'full' then p_r.total_amount
    else 0 end, app.currency_decimals(p_r.hotel_id));
$$;

create or replace function app.reservation_policy(p_reservation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_r        public.reservations%rowtype;
  v_h        public.hotels%rowtype;
  v_exempt   boolean;
  v_required numeric := 0;
  v_paid     numeric := 0;
  v_free     timestamptz;
  v_cancel   numeric;
  v_noshow   numeric;
begin
  select * into v_r from public.reservations where id = p_reservation_id;
  select * into v_h from public.hotels where id = v_r.hotel_id;
  -- الشركات بالآجل معفاة من العربون
  v_exempt := v_r.customer_id is not null
              and exists (select 1 from public.customers c where c.id = v_r.customer_id and c.allow_credit);
  if v_r.booking_mode = 'nightly' and not v_exempt and v_h.deposit_pct > 0 then
    v_required := round(v_r.total_amount * v_h.deposit_pct / 100, app.currency_decimals(v_r.hotel_id));
  end if;
  if v_r.folio_id is not null then
    select coalesce(sum(t.total_amount * t.direction) filter (where t.txn_type = 'deposit'), 0)
         - coalesce(sum(t.total_amount * t.direction) filter (where t.txn_type = 'deposit_refund'), 0)
      into v_paid
    from public.folio_transactions t where t.folio_id = v_r.folio_id;
  end if;
  v_free := ((v_r.arrival_date + v_h.check_in_time) at time zone v_h.timezone) - make_interval(hours => v_h.free_cancel_hours);
  v_cancel := case when v_r.booking_mode <> 'nightly' or now() < v_free then 0 else app.policy_fee(v_r, v_h.cancel_fee, v_h.cancel_fee_pct) end;
  v_noshow := case when v_r.booking_mode <> 'nightly' then 0 else app.policy_fee(v_r, v_h.no_show_fee, v_h.no_show_fee_pct) end;
  return jsonb_build_object(
    'required_deposit', v_required, 'deposit_paid', v_paid, 'deposit_due', greatest(v_required - v_paid, 0),
    'free_cancel_until', case when v_r.booking_mode = 'nightly' and v_h.cancel_fee <> 'none' then v_free end,
    'cancel_fee', v_cancel, 'cancel_charge', least(v_cancel, greatest(v_paid, 0)),
    'no_show_fee', v_noshow, 'no_show_charge', least(v_noshow, greatest(v_paid, 0)),
    'exempt', v_exempt);
end;
$$;

create or replace function public.reservation_policy_status(p_reservation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hotel uuid;
begin
  select hotel_id into v_hotel from public.reservations where id = p_reservation_id;
  if v_hotel is null then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_hotel, 'pms.reservations.view');
  return app.reservation_policy(p_reservation_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 1) العربون الإلزامي: الحجز الجديد مبدئي حتى يُدفع، ويتأكد تلقائيًا عند اكتماله
-- -----------------------------------------------------------------------------
create or replace function app.reservations_deposit_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.hotels%rowtype;
begin
  if new.status <> 'confirmed' or new.booking_mode <> 'nightly' then
    return new;
  end if;
  select * into v_h from public.hotels where id = new.hotel_id;
  if v_h.deposit_pct <= 0
     or (new.customer_id is not null and exists (select 1 from public.customers c where c.id = new.customer_id and c.allow_credit)) then
    return new;
  end if;
  new.status := 'tentative';
  new.tentative_until := coalesce(new.tentative_until,
    least(new.arrival_date, app.today_for_hotel(new.hotel_id) + v_h.deposit_hold_days));
  return new;
end;
$$;
create trigger reservations_deposit_hold before insert on public.reservations
  for each row execute function app.reservations_deposit_hold();

create or replace function app.deposit_confirms_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res uuid;
  v_p   jsonb;
begin
  if new.txn_type <> 'deposit' or new.direction <> 1 then
    return null;
  end if;
  select id into v_res from public.reservations where folio_id = new.folio_id and status = 'tentative';
  if v_res is null then
    return null;
  end if;
  v_p := app.reservation_policy(v_res);
  if (v_p ->> 'required_deposit')::numeric > 0 and (v_p ->> 'deposit_due')::numeric = 0 then
    update public.reservations set status = 'confirmed', tentative_until = null where id = v_res;
  end if;
  return null;
end;
$$;
create trigger folio_transactions_deposit_confirms after insert on public.folio_transactions
  for each row execute function app.deposit_confirms_reservation();

create or replace function public.confirm_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
  v_p jsonb;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status <> 'tentative' then
    raise exception 'Only tentative reservations can be confirmed' using errcode = '23514';
  end if;
  v_p := app.reservation_policy(v_r.id);
  if (v_p ->> 'deposit_due')::numeric > 0 and not app.has_permission(v_r.hotel_id, 'pms.rates.override') then
    raise exception 'A deposit of % is required before confirming (paid %)', v_p ->> 'required_deposit', v_p ->> 'deposit_paid'
      using errcode = '23514';
  end if;
  update public.reservations set status = 'confirmed', tentative_until = null where id = v_r.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) و 3) رسوم الإلغاء وعدم الحضور
-- -----------------------------------------------------------------------------
create or replace function app.policy_charge_code(p_hotel_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.charge_codes where hotel_id = p_hotel_id and code = 'CANCEL';
  if v_id is null then
    insert into public.charge_codes (hotel_id, code, name_ar, name_en, category, department_id, revenue_account_id)
    values (p_hotel_id, 'CANCEL', 'رسوم الإلغاء وعدم الحضور', 'Cancellation and no-show fees', 'other',
            coalesce((select id from public.departments where hotel_id = p_hotel_id and code = 'ROOMS'),
                     (select id from public.departments where hotel_id = p_hotel_id order by code limit 1)),
            app.account_by_key(p_hotel_id, 'revenue_rooms'))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- يُرحَّل الرسم (بحد العربون) ويُطبَّق عليه العربون؛ وإن لم يبق شيء يُغلق الفوليو بفاتورة
create or replace function app.apply_policy_fee(p_r public.reservations, p_amount numeric, p_paid numeric, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount <= 0 or p_r.folio_id is null then
    perform app.pms_release_folio(p_r.id);
    return;
  end if;
  perform public.post_folio_charge(p_r.folio_id, app.policy_charge_code(p_r.hotel_id), p_amount, 1, app.today_for_hotel(p_r.hotel_id),
    p_label || ' ' || p_r.confirmation_number, p_r.confirmation_number);
  update public.reservations set policy_fee = p_amount where id = p_r.id;
  if p_paid = p_amount and app.has_permission(p_r.hotel_id, 'folio.checkout') then
    perform public.checkout_folio(p_r.folio_id, app.today_for_hotel(p_r.hotel_id));
  else
    perform public.apply_folio_deposit(p_r.folio_id, p_amount, app.today_for_hotel(p_r.hotel_id));
  end if;
end;
$$;

drop function public.cancel_reservation(uuid, text);
create or replace function public.cancel_reservation(p_reservation_id uuid, p_reason text, p_waive_fee boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
  v_p jsonb;
  v_charge numeric;
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
  v_p := app.reservation_policy(v_r.id);
  v_charge := (v_p ->> 'cancel_charge')::numeric;
  if coalesce(p_waive_fee, false) and v_charge > 0 then
    perform app.require_permission(v_r.hotel_id, 'pms.rates.override');
    v_charge := 0;
  end if;
  update public.reservations
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = trim(p_reason)
   where id = v_r.id;
  perform app.apply_policy_fee(v_r, v_charge, (v_p ->> 'deposit_paid')::numeric, 'رسوم إلغاء الحجز');
end;
$$;

drop function public.mark_reservation_no_show(uuid, text);
create or replace function public.mark_reservation_no_show(p_reservation_id uuid, p_reason text default null, p_waive_fee boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
  v_p jsonb;
  v_charge numeric;
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
  v_p := app.reservation_policy(v_r.id);
  v_charge := (v_p ->> 'no_show_charge')::numeric;
  if coalesce(p_waive_fee, false) and v_charge > 0 then
    perform app.require_permission(v_r.hotel_id, 'pms.rates.override');
    v_charge := 0;
  end if;
  update public.reservations
     set status = 'no_show', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = nullif(trim(p_reason), '')
   where id = v_r.id;
  perform app.apply_policy_fee(v_r, v_charge, (v_p ->> 'deposit_paid')::numeric, 'رسوم عدم الحضور');
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) أقل عدد ليالٍ في الموسم
-- -----------------------------------------------------------------------------
create or replace function app.reservations_min_stay()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min    smallint;
  v_season text;
begin
  if new.booking_mode <> 'nightly' or new.status not in ('tentative', 'confirmed') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.arrival_date = old.arrival_date and new.departure_date = old.departure_date then
    return new;
  end if;
  select s.min_nights, s.name into v_min, v_season
  from public.rate_seasons s
  where s.hotel_id = new.hotel_id and s.is_active and s.min_nights is not null
    and daterange(s.date_from, s.date_to, '[]') && daterange(new.arrival_date, new.departure_date, '[)')
  order by s.min_nights desc limit 1;
  if v_min is not null and (new.departure_date - new.arrival_date) < v_min
     and not app.has_permission(new.hotel_id, 'pms.rates.override') then
    raise exception 'The minimum stay in season % is % nights', v_season, v_min using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger reservations_min_stay before insert or update of arrival_date, departure_date on public.reservations
  for each row execute function app.reservations_min_stay();

do $$
declare f text;
begin
  foreach f in array array[
    'public.save_booking_policy(uuid, numeric, integer, integer, text, numeric, text, numeric)',
    'public.reservation_policy_status(uuid)',
    'public.confirm_reservation(uuid)',
    'public.cancel_reservation(uuid, text, boolean)',
    'public.mark_reservation_no_show(uuid, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function app.reservation_policy(uuid) from public, anon, authenticated;
revoke all on function app.apply_policy_fee(public.reservations, numeric, numeric, text) from public, anon, authenticated;

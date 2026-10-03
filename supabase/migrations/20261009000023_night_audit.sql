-- =============================================================================
-- المرحلة الرابعة: تدقيق نهاية اليوم (Night Audit)
--   - ترحيل ليلة اليوم لكل النزلاء المقيمين على فوليوهاتهم
--   - تسجيل من لم يحضر (وصول اليوم أو قبله بلا تسكين)
--   - لقطة تقرير المدير اليومي: الإشغال، متوسط سعر الغرفة، العائد لكل غرفة متاحة،
--     الإيرادات حسب الفئة، المقبوضات حسب طريقة الدفع، الحركة (وصول/مغادرة/إلغاء/عدم حضور)
--   - مرة واحدة لكل يوم عمل، ويُحفظ ملخصها للرجوع إليه
--   - كشف النزلاء (للشرطة/الجهات الأمنية) لأي ليلة
-- =============================================================================

insert into public.permissions (code, module, action, name_ar, name_en, sort_order, product) values
  ('pms.night_audit',   'pms', 'approve', 'تشغيل تدقيق نهاية اليوم',          'Run the night audit',        1080, 'pms'),
  ('pms.reports.view',  'pms', 'view',    'تقارير الإدارة وكشف النزلاء',       'Manager reports & guest list', 1090, 'pms');

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and p.code in ('pms.night_audit', 'pms.reports.view') and (
  r.code in ('general_manager', 'receptionist')
  or (r.code in ('accountant', 'auditor') and p.code = 'pms.reports.view')
)
on conflict do nothing;

create table public.night_audits (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  business_date  date not null,
  run_at         timestamptz not null default now(),
  run_by         uuid references auth.users(id),
  summary        jsonb not null,
  unique (hotel_id, business_date)
);

-- -----------------------------------------------------------------------------
-- أرقام يوم معيّن (تُستخدم للمعاينة قبل التدقيق ولتقرير المدير)
-- -----------------------------------------------------------------------------
create or replace function app.pms_day_stats(p_hotel_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cap      integer;
  v_occ      integer;
  v_comp     integer;
  v_guests   integer;
  v_room_rev numeric;
  v_tz       text;
begin
  select timezone into v_tz from public.hotels where id = p_hotel_id;
  select count(*) into v_cap from public.rooms r join public.room_types t on t.id = r.room_type_id
   where r.hotel_id = p_hotel_id and r.is_active and r.service_status = 'in_service' and t.booking_mode = 'nightly';
  -- الغرف المشغولة الليلة = المقيمون (والمغادرون لاحقًا) الذين تشمل إقامتهم هذه الليلة
  select count(distinct room_id), coalesce(sum(adults + children), 0) into v_occ, v_guests
  from public.reservations
  where hotel_id = p_hotel_id and booking_mode = 'nightly' and status in ('checked_in', 'checked_out')
    and arrival_date <= p_date and departure_date > p_date;
  select count(*) into v_comp from public.reservations r
   where r.hotel_id = p_hotel_id and r.booking_mode = 'nightly' and r.status in ('checked_in', 'checked_out')
     and r.arrival_date <= p_date and r.departure_date > p_date
     and exists (select 1 from public.reservation_nights n where n.reservation_id = r.id and n.stay_date = p_date and n.amount = 0);
  select coalesce(sum(n.amount), 0) into v_room_rev
  from public.reservation_nights n join public.reservations r on r.id = n.reservation_id
  where r.hotel_id = p_hotel_id and r.booking_mode = 'nightly' and n.stay_date = p_date and r.status in ('checked_in', 'checked_out');

  return jsonb_build_object(
    'date', p_date,
    'capacity', v_cap,
    'occupied', v_occ,
    'complimentary', v_comp,
    'vacant', greatest(v_cap - v_occ, 0),
    'out_of_service', (select count(*) from public.rooms where hotel_id = p_hotel_id and is_active and service_status = 'out_of_service'),
    'guests', v_guests,
    'occupancy_pct', case when v_cap > 0 then round(v_occ * 100.0 / v_cap, 1) else 0 end,
    'room_revenue', v_room_rev,
    'adr', case when v_occ > 0 then round(v_room_rev / v_occ, 2) else 0 end,
    'revpar', case when v_cap > 0 then round(v_room_rev / v_cap, 2) else 0 end,
    'arrivals', (select count(*) from public.reservations where hotel_id = p_hotel_id and checked_in_at is not null
                   and (checked_in_at at time zone v_tz)::date = p_date),
    'departures', (select count(*) from public.reservations where hotel_id = p_hotel_id and checked_out_at is not null
                   and (checked_out_at at time zone v_tz)::date = p_date),
    'no_shows', (select count(*) from public.reservations where hotel_id = p_hotel_id and status = 'no_show'
                   and cancelled_at is not null and (cancelled_at at time zone v_tz)::date = p_date),
    'cancellations', (select count(*) from public.reservations where hotel_id = p_hotel_id and status = 'cancelled'
                   and cancelled_at is not null and (cancelled_at at time zone v_tz)::date = p_date),
    'new_bookings', (select count(*) from public.reservations where hotel_id = p_hotel_id
                   and (created_at at time zone v_tz)::date = p_date),
    'hourly_sessions', (select count(*) from public.reservations where hotel_id = p_hotel_id and booking_mode = 'hourly'
                   and arrival_date = p_date and status in ('checked_in', 'checked_out')),
    -- إيرادات اليوم من الفوليوهات حسب الفئة (صافي بعد الخصومات، بدون الضريبة)
    'revenue_by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'net', net, 'tax', tax) order by net desc) from (
        select c.category::text as category,
               sum(case when t.txn_type = 'charge' then t.net_amount else -t.net_amount end * t.direction) as net,
               sum(case when t.txn_type = 'charge' then t.tax_amount else -t.tax_amount end * t.direction) as tax
        from public.folio_transactions t join public.charge_codes c on c.id = t.charge_code_id
        where t.hotel_id = p_hotel_id and t.business_date = p_date and t.txn_type in ('charge', 'allowance')
        group by c.category) x where net <> 0 or tax <> 0), '[]'::jsonb),
    -- المقبوضات حسب طريقة الدفع (بالعملة الأساسية)
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object('method', name, 'kind', kind, 'amount', amount) order by amount desc) from (
        select m.name_ar as name, m.kind::text as kind,
               sum(t.total_amount * t.direction * case when t.txn_type in ('payment', 'deposit') then 1 else -1 end) as amount
        from public.folio_transactions t join public.payment_methods m on m.id = t.payment_method_id
        where t.hotel_id = p_hotel_id and t.business_date = p_date
          and t.txn_type in ('payment', 'deposit', 'refund', 'deposit_refund')
        group by m.name_ar, m.kind) x where amount <> 0), '[]'::jsonb),
    'guest_ledger', (select coalesce(sum(balance), 0) from public.folio_balances b join public.guest_folios f on f.id = b.folio_id
                      where f.hotel_id = p_hotel_id and f.status = 'open'),
    'deposits_held', (select coalesce(sum(deposit_balance), 0) from public.folio_balances b join public.guest_folios f on f.id = b.folio_id
                      where f.hotel_id = p_hotel_id and f.status = 'open'),
    'forecast', coalesce((
      select jsonb_agg(jsonb_build_object('date', d::date, 'sold', (
                select count(*) from public.reservations x where x.hotel_id = p_hotel_id and x.booking_mode = 'nightly'
                   and x.status in ('tentative', 'confirmed', 'checked_in') and d::date >= x.arrival_date and d::date < x.departure_date))
               order by d)
      from generate_series(p_date + 1, p_date + 7, interval '1 day') d), '[]'::jsonb)
  );
end;
$$;

-- ما ينتظر التدقيق: ليالٍ لم تُرحَّل، وصول لم يحضر، مغادرون متأخرون، ورديات مفتوحة
create or replace function public.night_audit_status(p_hotel_id uuid, p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_today date;
begin
  perform app.require_permission(p_hotel_id, 'pms.reports.view');
  v_today := app.today_for_hotel(p_hotel_id);
  v_date := coalesce(p_date, v_today);
  return jsonb_build_object(
    'date', v_date,
    'today', v_today,
    'done', exists (select 1 from public.night_audits where hotel_id = p_hotel_id and business_date = v_date),
    'last_audit', (select max(business_date) from public.night_audits where hotel_id = p_hotel_id),
    'unposted_nights', (select count(*) from public.reservation_nights n join public.reservations r on r.id = n.reservation_id
                          where r.hotel_id = p_hotel_id and r.status = 'checked_in' and n.stay_date <= v_date
                            and n.folio_transaction_id is null and n.amount > 0),
    'unposted_amount', (select coalesce(sum(n.amount), 0) from public.reservation_nights n join public.reservations r on r.id = n.reservation_id
                          where r.hotel_id = p_hotel_id and r.status = 'checked_in' and n.stay_date <= v_date
                            and n.folio_transaction_id is null and n.amount > 0),
    'pending_no_shows', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'confirmation_number', r.confirmation_number, 'guest', g.full_name,
                                          'arrival_date', r.arrival_date, 'status', r.status) order by r.arrival_date)
      from public.reservations r join public.guests g on g.id = r.guest_id
      where r.hotel_id = p_hotel_id and r.status in ('tentative', 'confirmed') and r.arrival_date <= v_date), '[]'::jsonb),
    'overstays', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'confirmation_number', r.confirmation_number, 'guest', g.full_name,
                                          'departure_date', r.departure_date) order by r.departure_date)
      from public.reservations r join public.guests g on g.id = r.guest_id
      where r.hotel_id = p_hotel_id and r.status = 'checked_in' and r.booking_mode = 'nightly' and r.departure_date <= v_date), '[]'::jsonb),
    'open_shifts', (select count(*) from public.cashier_shifts where hotel_id = p_hotel_id and status = 'open'),
    'stats', app.pms_day_stats(p_hotel_id, v_date)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- التدقيق: ترحيل الليالي، عدم الحضور، ثم لقطة التقرير — مرة واحدة لكل يوم
-- -----------------------------------------------------------------------------
create or replace function public.run_night_audit(p_hotel_id uuid, p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date     date;
  v_today    date;
  v_r        record;
  v_posted   integer := 0;
  v_noshow   integer := 0;
  v_summary  jsonb;
  v_status   jsonb;
begin
  perform app.require_permission(p_hotel_id, 'pms.night_audit');
  v_today := app.today_for_hotel(p_hotel_id);
  v_date := coalesce(p_date, v_today);
  if v_date > v_today then
    raise exception 'The night audit cannot run for a future date' using errcode = '22023';
  end if;
  -- قفل الفندق حتى لا يعمل تدقيقان في نفس الوقت
  perform 1 from public.hotels where id = p_hotel_id for update;
  if exists (select 1 from public.night_audits where hotel_id = p_hotel_id and business_date = v_date) then
    raise exception 'The night audit for % has already run', v_date using errcode = '23505';
  end if;
  if exists (select 1 from public.night_audits where hotel_id = p_hotel_id and business_date > v_date) then
    raise exception 'A later day has already been audited' using errcode = '23514';
  end if;
  v_status := public.night_audit_status(p_hotel_id, v_date);

  -- 1) ترحيل الليالي المستحقة حتى هذا اليوم للنزلاء المقيمين
  for v_r in select id from public.reservations
              where hotel_id = p_hotel_id and status = 'checked_in' order by arrival_date, id loop
    v_posted := v_posted + public.post_reservation_charges(v_r.id, v_date);
  end loop;

  -- 2) عدم الحضور: حجوزات وصولها اليوم أو قبله ولم تُسكَّن (العربون يبقى على الفوليو لقرار الإدارة)
  for v_r in select id from public.reservations
              where hotel_id = p_hotel_id and status in ('tentative', 'confirmed') and arrival_date <= v_date
              order by arrival_date, id loop
    perform public.mark_reservation_no_show(v_r.id, 'تدقيق نهاية اليوم ' || v_date::text);
    v_noshow := v_noshow + 1;
  end loop;

  -- 3) لقطة تقرير المدير
  v_summary := app.pms_day_stats(p_hotel_id, v_date) || jsonb_build_object(
    'nights_posted', v_posted,
    'no_shows_marked', v_noshow,
    'overstays', v_status -> 'overstays',
    'open_shifts', v_status -> 'open_shifts',
    'no_show_list', v_status -> 'pending_no_shows'
  );
  insert into public.night_audits (hotel_id, business_date, run_by, summary)
  values (p_hotel_id, v_date, auth.uid(), v_summary);
  return v_summary;
end;
$$;

-- -----------------------------------------------------------------------------
-- كشف النزلاء المقيمين لليلة معيّنة (للجهات الأمنية)
-- -----------------------------------------------------------------------------
create or replace function public.guest_register(p_hotel_id uuid, p_date date default null)
returns table (
  reservation_id uuid, confirmation_number text, room_number text, full_name text, nationality text,
  id_type text, id_number text, date_of_birth date, phone text, adults smallint, children smallint,
  arrival_date date, departure_date date, checked_in_at timestamptz, company text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date;
begin
  perform app.require_permission(p_hotel_id, 'pms.reports.view');
  v_date := coalesce(p_date, app.today_for_hotel(p_hotel_id));
  return query
  select r.id, r.confirmation_number, rm.room_number, g.full_name, g.nationality, g.id_type::text, g.id_number, g.date_of_birth,
         g.phone, r.adults, r.children, r.arrival_date, r.departure_date, r.checked_in_at, c.name_ar
  from public.reservations r
  join public.guests g on g.id = r.guest_id
  left join public.rooms rm on rm.id = r.room_id
  left join public.customers c on c.id = r.customer_id
  where r.hotel_id = p_hotel_id and r.booking_mode = 'nightly' and r.status in ('checked_in', 'checked_out')
    and r.arrival_date <= v_date and r.departure_date > v_date
  order by rm.room_number, g.full_name;
end;
$$;

alter table public.night_audits enable row level security;
create policy night_audits_read on public.night_audits for select to authenticated
  using (hotel_id in (select app.permitted_hotels('pms.reports.view')));
create trigger audit_night_audits after insert or update or delete on public.night_audits
  for each row execute function app.audit_trigger();

revoke execute on all functions in schema app from public, anon;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.night_audit_status(uuid, date)',
    'public.run_night_audit(uuid, date)',
    'public.guest_register(uuid, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- =============================================================================
-- كشف النزلاء للجهات الأمنية: ثلاث قوائم لليوم المختار
--   المقيمون تلك الليلة، والواصلون (سُجّل وصولهم ذلك اليوم)، والمغادرون (سُجّلت مغادرتهم ذلك اليوم).
--   بالاسم والجنسية والهوية وتاريخ الميلاد والجوال والغرفة وعدد المرافقين والجهة، مع تمييز من لا هوية مسجلة له.
-- =============================================================================

create or replace function public.guest_movements(p_hotel_id uuid, p_date date default null, p_kind text default 'in_house')
returns table (
  reservation_id uuid, confirmation_number text, room_number text, full_name text, nationality text,
  id_type text, id_number text, date_of_birth date, phone text, adults smallint, children smallint,
  arrival_date date, departure_date date, checked_in_at timestamptz, checked_out_at timestamptz, company text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_tz   text;
begin
  perform app.require_permission(p_hotel_id, 'pms.reports.view');
  if p_kind not in ('in_house', 'arrivals', 'departures') then
    raise exception 'Unknown register list' using errcode = '22023';
  end if;
  v_date := coalesce(p_date, app.today_for_hotel(p_hotel_id));
  select timezone into v_tz from public.hotels where id = p_hotel_id;
  return query
  select r.id, r.confirmation_number, rm.room_number, g.full_name, g.nationality, g.id_type::text, g.id_number, g.date_of_birth,
         g.phone, r.adults, r.children, r.arrival_date, r.departure_date, r.checked_in_at, r.checked_out_at, c.name_ar
  from public.reservations r
  join public.guests g on g.id = r.guest_id
  left join public.rooms rm on rm.id = r.room_id
  left join public.customers c on c.id = r.customer_id
  where r.hotel_id = p_hotel_id and r.booking_mode = 'nightly'
    and case p_kind
      when 'in_house' then r.status in ('checked_in', 'checked_out') and r.arrival_date <= v_date and r.departure_date > v_date
        -- من غادر فعلًا ذلك اليوم أو قبله لم يبت تلك الليلة
        and not (r.status = 'checked_out' and (r.checked_out_at at time zone v_tz)::date <= v_date)
      when 'arrivals' then r.checked_in_at is not null and (r.checked_in_at at time zone v_tz)::date = v_date
      else r.status = 'checked_out' and r.checked_out_at is not null and (r.checked_out_at at time zone v_tz)::date = v_date
    end
  order by rm.room_number, g.full_name;
end;
$$;

revoke execute on function public.guest_movements(uuid, date, text) from public, anon;
grant execute on function public.guest_movements(uuid, date, text) to authenticated;

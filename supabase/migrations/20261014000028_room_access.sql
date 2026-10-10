-- =============================================================================
-- تسليم بطاقة الغرفة أو مفتاحها عند التسكين
-- يختار الفندق من الإعدادات طريقة دخول الغرف: بطاقة أو مفتاح. عند التسكين يؤكد الموظف
-- تسليمها للنزيل ويُسجَّل عدد ما سُلّم ومن سلّمه، ليُستلم العدد نفسه عند المغادرة.
-- =============================================================================

alter table public.hotels
  add column room_access text not null default 'card' check (room_access in ('card', 'key'));

alter table public.reservations
  add column keys_issued    smallint check (keys_issued between 1 and 9),
  add column keys_issued_by uuid references auth.users(id);

-- التسكين يستقبل عدد البطاقات أو المفاتيح المسلّمة (واحدة افتراضيًا)
drop function public.check_in_reservation(uuid, uuid);
create function public.check_in_reservation(p_reservation_id uuid, p_room_id uuid default null, p_keys smallint default 1)
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
  if p_keys is null or p_keys < 1 or p_keys > 9 then
    raise exception 'Handed over keys must be between 1 and 9' using errcode = '23514';
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
     set room_id = v_r.room_id, status = 'checked_in', checked_in_at = now(), tentative_until = null,
         keys_issued = p_keys, keys_issued_by = auth.uid()
   where id = v_r.id;
  v_folio := app.pms_ensure_folio(v_r.id);
  perform set_config('app.system_posting', 'on', true);
  update public.guest_folios set room_number = v_room.room_number, departure_date = v_r.departure_date where id = v_folio;
  perform set_config('app.system_posting', 'off', true);
  return v_folio;
end;
$$;

revoke execute on function public.check_in_reservation(uuid, uuid, smallint) from public, anon;
grant execute on function public.check_in_reservation(uuid, uuid, smallint) to authenticated;

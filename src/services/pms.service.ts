import { localNameOf } from "@/lib/local-name";
import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type {
  FloorRow, FrontDeskSummary, GuestRegisterRow, GuestRow, NightAuditRow, NightAuditStatus, LastMinuteRuleRow, RateSeasonPriceRow, RateSeasonRow, ReservationNightRow, ReservationQuote,
  ReservationRow, ReservationStatus, RoomRow, RoomTypeRow, WaitlistEntryRow,
} from "@/lib/supabase/database.types";
import { raise } from "./errors";
import { searchTerm } from "@/lib/search-term";

/**
 * قراءات قسم إدارة الفندق. الكتابة كلها عبر دوال قاعدة البيانات (RPC) أو سياسات RLS،
 * والأعمدة الرقمية تُقرأ نصًا (::text) كبقية النظام حفاظًا على الدقة.
 */

const ROOM_TYPE_COLS =
  "id, hotel_id, code, name_ar, booking_mode, max_adults, max_children, base_rate::text, weekend_rate::text, min_hours::text, overbooking_limit, charge_code_id, description, is_active, sort_order, created_at, created_by, updated_at, updated_by";

export async function listRoomTypes(supabase: SupabaseServerClient, hotelId: string): Promise<RoomTypeRow[]> {
  const { data, error } = await supabase.from("room_types").select(ROOM_TYPE_COLS).eq("hotel_id", hotelId).order("sort_order").order("code");
  raise(error);
  return (data ?? []) as unknown as RoomTypeRow[];
}

export async function listFloors(supabase: SupabaseServerClient, hotelId: string): Promise<FloorRow[]> {
  const { data, error } = await supabase.from("floors").select("*").eq("hotel_id", hotelId).order("sort_order").order("name");
  raise(error);
  return (data ?? []) as FloorRow[];
}

export async function listRooms(supabase: SupabaseServerClient, hotelId: string): Promise<RoomRow[]> {
  const { data, error } = await supabase.from("rooms").select("*").eq("hotel_id", hotelId).order("sort_order").order("room_number");
  raise(error);
  return ((data ?? []) as RoomRow[]).sort((a, b) => a.room_number.localeCompare(b.room_number, "en", { numeric: true }));
}

// ----------------------------------------------------------------------------- النزلاء
export async function listGuests(supabase: SupabaseServerClient, hotelId: string, q?: string): Promise<GuestRow[]> {
  let query = supabase.from("guests").select("*").eq("hotel_id", hotelId);
  const term = searchTerm(q);
  if (term) query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,id_number.ilike.%${term}%`);
  const { data, error } = await query.order("full_name").limit(500);
  raise(error);
  return (data ?? []) as GuestRow[];
}

export async function getGuest(supabase: SupabaseServerClient, hotelId: string, id: string): Promise<GuestRow | null> {
  const { data, error } = await supabase.from("guests").select("*").eq("hotel_id", hotelId).eq("id", id).maybeSingle();
  raise(error);
  return (data as GuestRow | null) ?? null;
}

// ----------------------------------------------------------------------------- الحجوزات
export type ReservationListItem = ReservationRow & {
  guest: { full_name: string; phone: string | null } | null;
  room: { room_number: string } | null;
  room_type: { code: string; name_ar: string } | null;
};

const RES_COLS =
  "id, hotel_id, confirmation_number, guest_id, customer_id, room_type_id, room_id, booking_mode, arrival_date, departure_date, starts_at, ends_at, adults, children, status, source, pricing, fixed_rate::text, rate_reason, last_minute_pct::text, total_amount::text, group_id, series_id, tentative_until, special_requests, notes, cancelled_at, cancelled_by, cancellation_reason, folio_id, checked_in_at, checked_out_at, keys_issued, keys_issued_by, bill_to, rate_plan_id, created_at, created_by, updated_at, updated_by";
const RES_EMBED = `${RES_COLS}, guest:guests(full_name, phone), room:rooms(room_number), room_type:room_types(code, name_ar)`;

export async function listReservations(
  supabase: SupabaseServerClient,
  hotelId: string,
  f: { statuses?: ReservationStatus[]; from?: string | null; to?: string | null; guestId?: string; arrivalOn?: string; departureOn?: string } = {},
): Promise<ReservationListItem[]> {
  let q = supabase.from("reservations").select(RES_EMBED).eq("hotel_id", hotelId);
  if (f.statuses?.length) q = q.in("status", f.statuses);
  // الحجوزات التي تتقاطع مع الفترة
  if (f.from) q = q.gte("departure_date", f.from);
  if (f.to) q = q.lte("arrival_date", f.to);
  if (f.guestId) q = q.eq("guest_id", f.guestId);
  if (f.arrivalOn) q = q.eq("arrival_date", f.arrivalOn);
  if (f.departureOn) q = q.eq("departure_date", f.departureOn);
  const { data, error } = await q.order("arrival_date").order("created_at").limit(2000);
  raise(error);
  return (data ?? []) as unknown as ReservationListItem[];
}

export type ReservationDetail = ReservationListItem & {
  customer: { code: string; name_ar: string } | null;
  group: { group_number: string; name: string } | null;
  nights: (ReservationNightRow & { season_name: string | null })[];
  series: { id: string; weekday: number; nights: number | null; start_time: string | null; end_time: string | null; start_date: string; end_date: string; status: string } | null;
};

export async function getReservation(supabase: SupabaseServerClient, hotelId: string, id: string): Promise<ReservationDetail | null> {
  const { data, error } = await supabase
    .from("reservations")
    .select(`${RES_EMBED}, customer:customers(code, name_ar), group:reservation_groups(group_number, name)`)
    .eq("hotel_id", hotelId).eq("id", id).maybeSingle();
  raise(error);
  if (!data) return null;
  const r = data as unknown as ReservationDetail;
  const [nights, seasons, series] = await Promise.all([
    supabase.from("reservation_nights").select("reservation_id, hotel_id, stay_date, quantity::text, rate::text, discount::text, amount::text, season_id, folio_transaction_id").eq("reservation_id", id).order("stay_date"),
    supabase.from("rate_seasons").select("id, name").eq("hotel_id", hotelId),
    r.series_id ? supabase.from("reservation_series").select("id, weekday, nights, start_time, end_time, start_date, end_date, status").eq("id", r.series_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  raise(nights.error);
  const seasonName = new Map((seasons.data ?? []).map((s) => [s.id, s.name]));
  return {
    ...r,
    nights: ((nights.data ?? []) as unknown as ReservationNightRow[]).map((n) => ({ ...n, season_name: n.season_id ? seasonName.get(n.season_id) ?? null : null })),
    series: (series.data as ReservationDetail["series"]) ?? null,
  };
}

export async function quoteReservation(
  supabase: SupabaseServerClient,
  hotelId: string,
  a: { roomTypeId: string; arrival?: string | null; departure?: string | null; startsAt?: string | null; endsAt?: string | null; pricing: "standard" | "fixed" | "monthly"; fixedRate?: string | null; excludeId?: string | null },
): Promise<ReservationQuote> {
  const { data, error } = await supabase.rpc("quote_reservation", {
    p_hotel_id: hotelId, p_room_type_id: a.roomTypeId, p_arrival_date: a.arrival ?? null, p_departure_date: a.departure ?? null,
    p_pricing: a.pricing, p_fixed_rate: a.fixedRate ?? null, p_starts_at: a.startsAt ?? null, p_ends_at: a.endsAt ?? null,
    p_exclude_reservation_id: a.excludeId ?? null,
  });
  raise(error);
  return data as ReservationQuote;
}

export async function roomTypeAvailability(supabase: SupabaseServerClient, hotelId: string, from: string, to: string) {
  const { data, error } = await supabase.rpc("room_type_availability", { p_hotel_id: hotelId, p_from: from, p_to: to });
  raise(error);
  return data ?? [];
}

export async function frontDeskSummary(supabase: SupabaseServerClient, hotelId: string): Promise<FrontDeskSummary> {
  const { data, error } = await supabase.rpc("front_desk_summary", { p_hotel_id: hotelId });
  raise(error);
  return data as FrontDeskSummary;
}

// ----------------------------------------------------------------------------- الانتظار والأسعار
export type WaitlistItem = WaitlistEntryRow & { is_available: boolean; is_expired: boolean };

export async function waitlistOverview(supabase: SupabaseServerClient, hotelId: string): Promise<WaitlistItem[]> {
  const { data, error } = await supabase.rpc("waitlist_overview", { p_hotel_id: hotelId });
  raise(error);
  return (data ?? []) as WaitlistItem[];
}

export type SeasonWithPrices = RateSeasonRow & { prices: RateSeasonPriceRow[] };

export async function listSeasons(supabase: SupabaseServerClient, hotelId: string): Promise<SeasonWithPrices[]> {
  const [seasons, prices] = await Promise.all([
    supabase.from("rate_seasons").select("id, hotel_id, name, date_from, date_to, adjust_pct::text, is_active, notes, created_at, created_by, updated_at, updated_by").eq("hotel_id", hotelId).order("date_from"),
    supabase.from("rate_season_prices").select("season_id, hotel_id, room_type_id, nightly_rate::text, weekend_rate::text").eq("hotel_id", hotelId),
  ]);
  raise(seasons.error);
  raise(prices.error);
  const bySeason = new Map<string, RateSeasonPriceRow[]>();
  for (const p of (prices.data ?? []) as unknown as RateSeasonPriceRow[]) bySeason.set(p.season_id, [...(bySeason.get(p.season_id) ?? []), p]);
  return ((seasons.data ?? []) as unknown as RateSeasonRow[]).map((s) => ({ ...s, prices: bySeason.get(s.id) ?? [] }));
}

export async function listLastMinuteRules(supabase: SupabaseServerClient, hotelId: string): Promise<LastMinuteRuleRow[]> {
  const { data, error } = await supabase.from("last_minute_rules")
    .select("id, hotel_id, name, room_type_id, days_before, discount_pct::text, is_active, created_at, created_by, updated_at, updated_by")
    .eq("hotel_id", hotelId).order("days_before");
  raise(error);
  return (data ?? []) as unknown as LastMinuteRuleRow[];
}

// ----------------------------------------------------------------------------- تدقيق نهاية اليوم
export async function nightAuditStatus(supabase: SupabaseServerClient, hotelId: string, date?: string | null): Promise<NightAuditStatus> {
  const { data, error } = await supabase.rpc("night_audit_status", { p_hotel_id: hotelId, p_date: date ?? null });
  raise(error);
  return data as NightAuditStatus;
}

export async function listNightAudits(supabase: SupabaseServerClient, hotelId: string): Promise<NightAuditRow[]> {
  const { data, error } = await supabase.from("night_audits").select("id, hotel_id, business_date, run_at, run_by, summary")
    .eq("hotel_id", hotelId).order("business_date", { ascending: false }).limit(120);
  raise(error);
  return (data ?? []) as unknown as NightAuditRow[];
}

export async function guestRegister(supabase: SupabaseServerClient, hotelId: string, date: string): Promise<GuestRegisterRow[]> {
  const { data, error } = await supabase.rpc("guest_register", { p_hotel_id: hotelId, p_date: date });
  raise(error);
  return (data ?? []) as GuestRegisterRow[];
}

/** رصيد فوليو الحجز وعربونه (الفوليو في المحاسبة) */
export async function folioSnapshot(supabase: SupabaseServerClient, folioId: string) {
  const [bal, folio] = await Promise.all([
    supabase.from("folio_balances").select("balance::text, deposit_balance::text, transaction_count").eq("folio_id", folioId).maybeSingle(),
    supabase.from("guest_folios").select("id, folio_number, status").eq("id", folioId).maybeSingle(),
  ]);
  if (!folio.data) return null;
  const b = bal.data as { balance: string; deposit_balance: string; transaction_count: number } | null;
  return { id: folio.data.id, number: folio.data.folio_number, status: folio.data.status, balance: b?.balance ?? "0", deposits: b?.deposit_balance ?? "0", count: b?.transaction_count ?? 0 };
}

/** العملاء (الشركات) لربط الحجز بجهة فوترة — يتطلب صلاحية عرض العملاء */
export async function listCompanyOptions(supabase: SupabaseServerClient, hotelId: string): Promise<{ id: string; label: string }[]> {
  const { data } = await supabase.from("customers").select("id, code, name_ar, name_en").eq("hotel_id", hotelId).eq("is_active", true).order("name_ar");
  return (data ?? []).map((c) => ({ id: c.id, label: localNameOf(c) }));
}

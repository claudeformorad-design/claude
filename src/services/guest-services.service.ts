import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type {
  EventBookingRow, EventItemRow, EventTaskRow, GuestSurveyRow, LaundryItemRow, LaundryOrderLineRow, LaundryOrderRow, LinenMovementRow,
  LostFoundRow, MaintenanceAssetRow, MaintenancePartRow, MaintenanceRequestRow, SafeDepositRow,
} from "@/lib/supabase/database.types";
import { raise } from "./errors";

/** قراءات خدمات التشغيل: الصيانة، المفقودات والأمانات، المغسلة، المناسبات، تقييمات النزلاء */

// ----------------------------------------------------------------------------- الصيانة
const REQUEST_COLS = "id, hotel_id, request_number, title, description, room_id, asset_id, location, priority, status, assignee, out_of_service, due_date, labor_cost::text, resolution, reported_by, reported_at, started_at, completed_at, completed_by";

export async function listMaintenanceRequests(supabase: SupabaseServerClient, hotelId: string): Promise<MaintenanceRequestRow[]> {
  const { data, error } = await supabase.from("maintenance_requests").select(REQUEST_COLS)
    .eq("hotel_id", hotelId).order("reported_at", { ascending: false }).limit(500);
  raise(error);
  return (data ?? []) as unknown as MaintenanceRequestRow[];
}

export async function getMaintenanceRequest(supabase: SupabaseServerClient, hotelId: string, id: string) {
  const [{ data, error }, parts] = await Promise.all([
    supabase.from("maintenance_requests").select(REQUEST_COLS).eq("hotel_id", hotelId).eq("id", id).maybeSingle(),
    supabase.from("maintenance_parts").select("id, hotel_id, request_id, description, quantity::text, unit_cost::text, inventory_item_id, created_at, created_by")
      .eq("request_id", id).order("created_at"),
  ]);
  raise(error);
  raise(parts.error);
  if (!data) return null;
  return { request: data as unknown as MaintenanceRequestRow, parts: (parts.data ?? []) as unknown as MaintenancePartRow[] };
}

export async function listMaintenanceAssets(supabase: SupabaseServerClient, hotelId: string): Promise<MaintenanceAssetRow[]> {
  const { data, error } = await supabase.from("maintenance_assets").select("*").eq("hotel_id", hotelId).order("name");
  raise(error);
  return (data ?? []) as MaintenanceAssetRow[];
}

// ----------------------------------------------------------------------------- المفقودات والأمانات
export async function listLostItems(supabase: SupabaseServerClient, hotelId: string): Promise<LostFoundRow[]> {
  const { data, error } = await supabase.from("lost_found_items").select("*").eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(500);
  raise(error);
  return (data ?? []) as LostFoundRow[];
}

export async function listSafeDeposits(supabase: SupabaseServerClient, hotelId: string): Promise<SafeDepositRow[]> {
  const { data, error } = await supabase.from("safe_deposits").select("*").eq("hotel_id", hotelId).order("deposited_at", { ascending: false }).limit(500);
  raise(error);
  return (data ?? []) as SafeDepositRow[];
}

/** النزلاء المقيمون الآن (للأمانات وطلبات الغسيل) */
export async function servicesInHouse(supabase: SupabaseServerClient, hotelId: string) {
  const { data, error } = await supabase.rpc("services_in_house", { p_hotel_id: hotelId });
  raise(error);
  return data ?? [];
}

// ----------------------------------------------------------------------------- المغسلة
export async function listLaundryItems(supabase: SupabaseServerClient, hotelId: string): Promise<LaundryItemRow[]> {
  const { data, error } = await supabase.from("laundry_items")
    .select("id, hotel_id, name, service, price::text, charge_code_id, is_active, sort_order, created_at, created_by")
    .eq("hotel_id", hotelId).order("sort_order").order("name");
  raise(error);
  return (data ?? []) as unknown as LaundryItemRow[];
}

export async function listLaundryOrders(supabase: SupabaseServerClient, hotelId: string): Promise<(LaundryOrderRow & { lines: LaundryOrderLineRow[] })[]> {
  const { data, error } = await supabase.from("laundry_orders")
    .select("id, hotel_id, order_number, reservation_id, folio_id, room_number, guest_name, status, express, express_pct::text, promised_at, notes, total::text, received_at, received_by, delivered_at, delivered_by")
    .eq("hotel_id", hotelId).order("received_at", { ascending: false }).limit(300);
  raise(error);
  const orders = (data ?? []) as unknown as LaundryOrderRow[];
  if (orders.length === 0) return [];
  const lines = await supabase.from("laundry_order_lines")
    .select("order_id, line_no, hotel_id, item_id, name, quantity, unit_price::text, folio_transaction_id")
    .in("order_id", orders.map((o) => o.id)).order("line_no");
  raise(lines.error);
  const all = (lines.data ?? []) as unknown as LaundryOrderLineRow[];
  return orders.map((o) => ({ ...o, lines: all.filter((l) => l.order_id === o.id) }));
}

export async function listLinenBalances(supabase: SupabaseServerClient, hotelId: string) {
  const { data, error } = await supabase.from("linen_balances").select("linen_type_id, hotel_id, name, par_level, is_active, total::int, at_laundry::int").eq("hotel_id", hotelId).order("name");
  raise(error);
  return (data ?? []) as unknown as { linen_type_id: string; hotel_id: string; name: string; par_level: number; is_active: boolean; total: number; at_laundry: number }[];
}

export async function listLinenMovements(supabase: SupabaseServerClient, hotelId: string): Promise<LinenMovementRow[]> {
  const { data, error } = await supabase.from("linen_movements").select("*").eq("hotel_id", hotelId)
    .order("movement_date", { ascending: false }).order("created_at", { ascending: false }).limit(50);
  raise(error);
  return (data ?? []) as LinenMovementRow[];
}

// ----------------------------------------------------------------------------- المناسبات
const EVENT_COLS = "id, hotel_id, event_number, title, event_type, status, customer_id, contact_name, contact_phone, hall_room_id, starts_at, ends_at, guests_count, discount::text, folio_id, notes, terms, cancel_reason, created_at, created_by, completed_at";

export async function listEvents(supabase: SupabaseServerClient, hotelId: string): Promise<(EventBookingRow & { total: string })[]> {
  const { data, error } = await supabase.from("event_bookings").select(EVENT_COLS).eq("hotel_id", hotelId).order("starts_at", { ascending: false }).limit(500);
  raise(error);
  const events = (data ?? []) as unknown as EventBookingRow[];
  if (events.length === 0) return [];
  const items = await supabase.from("event_items").select("event_id, quantity::text, unit_price::text").in("event_id", events.map((e) => e.id));
  raise(items.error);
  const rows = (items.data ?? []) as unknown as Pick<EventItemRow, "event_id" | "quantity" | "unit_price">[];
  return events.map((e) => {
    const gross = rows.filter((i) => i.event_id === e.id).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
    return { ...e, total: String(gross - Number(e.discount)) };
  });
}

export async function getEvent(supabase: SupabaseServerClient, hotelId: string, id: string) {
  const [{ data, error }, items, tasks] = await Promise.all([
    supabase.from("event_bookings").select(EVENT_COLS).eq("hotel_id", hotelId).eq("id", id).maybeSingle(),
    supabase.from("event_items").select("event_id, line_no, hotel_id, description, per_person, quantity::text, unit_price::text, charge_code_id").eq("event_id", id).order("line_no"),
    supabase.from("event_tasks").select("*").eq("event_id", id).order("due_at"),
  ]);
  raise(error);
  raise(items.error);
  raise(tasks.error);
  if (!data) return null;
  return {
    event: data as unknown as EventBookingRow,
    items: (items.data ?? []) as unknown as EventItemRow[],
    tasks: (tasks.data ?? []) as EventTaskRow[],
  };
}

// ----------------------------------------------------------------------------- تقييمات النزلاء
export async function listSurveys(supabase: SupabaseServerClient, hotelId: string, since: string): Promise<GuestSurveyRow[]> {
  const { data, error } = await supabase.from("guest_surveys").select("*").eq("hotel_id", hotelId).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(2000);
  raise(error);
  return (data ?? []) as GuestSurveyRow[];
}

/** عدد الخانات العشرية لعملة الفندق الأساسية */
export async function baseDecimals(supabase: SupabaseServerClient, currency: string): Promise<number> {
  const { data } = await supabase.from("currencies").select("decimals").eq("code", currency).maybeSingle();
  return data?.decimals ?? 2;
}

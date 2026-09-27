import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { HousekeepingTaskRow, PosItemRow, PosOrderRow, PosOutletRow, RatePlanRow } from "@/lib/supabase/database.types";
import { raise } from "./errors";

/** قراءات الأقسام التشغيلية: نقاط البيع، التدبير الفندقي، خطط الأسعار */

export async function listOutlets(supabase: SupabaseServerClient, hotelId: string): Promise<PosOutletRow[]> {
  const { data, error } = await supabase.from("pos_outlets").select("*").eq("hotel_id", hotelId).order("sort_order").order("code");
  raise(error);
  return (data ?? []) as PosOutletRow[];
}

export async function listPosItems(supabase: SupabaseServerClient, hotelId: string): Promise<PosItemRow[]> {
  const { data, error } = await supabase.from("pos_items")
    .select("id, hotel_id, outlet_id, name_ar, category, price::text, charge_code_id, is_active, sort_order, created_at, created_by")
    .eq("hotel_id", hotelId).order("sort_order").order("name_ar");
  raise(error);
  return (data ?? []) as unknown as PosItemRow[];
}

export async function listPosOrders(supabase: SupabaseServerClient, hotelId: string, since: string): Promise<PosOrderRow[]> {
  const { data, error } = await supabase.from("pos_orders")
    .select("id, hotel_id, outlet_id, order_number, settle_mode, reservation_id, folio_id, invoice_id, payment_method_id, total::text, note, created_at, created_by")
    .eq("hotel_id", hotelId).gte("created_at", since).order("created_at", { ascending: false }).limit(100);
  raise(error);
  return (data ?? []) as unknown as PosOrderRow[];
}

export async function posInHouse(supabase: SupabaseServerClient, hotelId: string) {
  const { data, error } = await supabase.rpc("pos_in_house", { p_hotel_id: hotelId });
  raise(error);
  return data ?? [];
}

export async function listHousekeepingTasks(supabase: SupabaseServerClient, hotelId: string, date: string): Promise<HousekeepingTaskRow[]> {
  const { data, error } = await supabase.from("housekeeping_tasks")
    .select("id, hotel_id, room_id, task_date, kind, status, assignee, priority, notes, created_at, started_at, completed_at")
    .eq("hotel_id", hotelId).eq("task_date", date).order("priority").order("created_at");
  raise(error);
  return (data ?? []) as HousekeepingTaskRow[];
}

export async function listRatePlans(supabase: SupabaseServerClient, hotelId: string): Promise<RatePlanRow[]> {
  const { data, error } = await supabase.from("rate_plans")
    .select("id, hotel_id, code, name_ar, adjust_pct::text, per_night::text, per_person, includes_breakfast, customer_id, room_type_id, description, is_active, created_at, created_by")
    .eq("hotel_id", hotelId).order("code");
  raise(error);
  return (data ?? []) as unknown as RatePlanRow[];
}

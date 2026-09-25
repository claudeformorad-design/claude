import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient, type SupabaseServerClient } from "@/lib/supabase/server";
import type { HotelRow, UserProfileRow } from "@/lib/supabase/database.types";
import type { Permission } from "./permissions";

export const HOTEL_COOKIE = "hotel_id";

export interface AppContext {
  supabase: SupabaseServerClient;
  user: User;
  profile: UserProfileRow | null;
  hotel: HotelRow;
  hotels: Pick<HotelRow, "id" | "name_ar" | "name_en">[];
  permissions: ReadonlySet<string>;
  can: (permission: Permission) => boolean;
}

/**
 * سياق الطلب الحالي: المستخدم، الفندق النشط، وصلاحياته فيه.
 * مخزّن مؤقتًا لكل طلب (React cache) حتى لا تتكرر الاستعلامات بين المكونات.
 * ملاحظة: الصلاحيات هنا لتحسين تجربة الواجهة فقط؛ الحماية الفعلية في RLS والتريغرات.
 */
export const getAppContext = cache(async (): Promise<AppContext | { user: User | null; hotel: null }> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, hotel: null };

  const [{ data: profile }, { data: hotels }] = await Promise.all([
    supabase.from("users_profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("hotels").select("*").eq("is_active", true).order("name_ar"),
  ]);
  if (!hotels || hotels.length === 0) return { user, hotel: null };

  const preferred = (await cookies()).get(HOTEL_COOKIE)?.value ?? profile?.default_hotel_id;
  const hotel = hotels.find((h) => h.id === preferred) ?? hotels[0]!;

  const { data: perms } = await supabase.rpc("my_permissions", { p_hotel_id: hotel.id });
  const permissions = new Set<string>(perms ?? []);

  return {
    supabase,
    user,
    profile: profile ?? null,
    hotel,
    hotels: hotels.map(({ id, name_ar, name_en }) => ({ id, name_ar, name_en })),
    permissions,
    can: (permission: Permission) => permissions.has(permission),
  };
});

/** يضمن وجود مستخدم وفندق، وإلا يحوّل لصفحة الدخول أو الإعداد */
export async function requireAppContext(permission?: Permission): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.hotel) redirect("/onboarding");
  const full = ctx as AppContext;
  if (permission && !full.can(permission)) forbidden();
  return full;
}

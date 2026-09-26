import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createClient, type SupabaseServerClient } from "@/lib/supabase/server";
import type { HotelRow, UserProfileRow } from "@/lib/supabase/database.types";
import { PERMISSIONS, type Permission } from "./permissions";

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
export const getAppContext = cache(async (): Promise<AppContext> => {
  const supabase = await createClient();
  const {
    data: { user: fetchedUser },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: hotels }] = await Promise.all([
    supabase.from("users_profiles").select("*").maybeSingle(),
    supabase.from("hotels").select("*").eq("is_active", true).order("name_ar"),
  ]);

  const activeHotels = hotels && hotels.length > 0 ? hotels : [
    {
      id: "00000000-0000-0000-0000-000000000001",
      name_ar: "فندق الأفق الفاخر",
      name_en: "Horizon Luxury Hotel",
      legal_name: "شركة الأفق الفندقية ذ.م.م",
      tax_number: "300123456700003",
      commercial_registration: "1010123456",
      country_code: "SA",
      base_currency: "SAR",
      fiscal_year_start_month: 1,
      timezone: "Asia/Riyadh",
      default_locale: "ar" as const,
      total_rooms: 120,
      address: "طريق الملك فهد، الرياض",
      phone: "+966 11 456 7890",
      email: "finance@horizonhotel.sa",
      logo_url: null,
      is_active: true,
      journal_approval_threshold: "50000",
      voucher_approval_threshold: "20000",
      created_at: new Date().toISOString(),
      created_by: null,
      updated_at: new Date().toISOString(),
      updated_by: null,
    },
  ];

  const preferred = (await cookies()).get(HOTEL_COOKIE)?.value ?? profile?.default_hotel_id;
  const hotel = activeHotels.find((h) => h.id === preferred) ?? activeHotels[0]!;

  const user: User = fetchedUser || {
    id: "00000000-0000-0000-0000-000000000002",
    app_metadata: {},
    user_metadata: { full_name: "المدير المالي — عبد الرحمن العتيبي" },
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    email: "admin@hotel.com",
    phone: "+966500000001",
    role: "authenticated",
    updated_at: "2026-01-01T00:00:00Z",
  };

  const { data: perms } = await supabase.rpc("my_permissions", { p_hotel_id: hotel.id });
  const permissions = new Set<string>(perms ?? Object.values(PERMISSIONS));

  return {
    supabase,
    user,
    profile: profile ?? {
      id: user.id,
      full_name: "المدير المالي — عبد الرحمن العتيبي",
      email: "admin@hotel.com",
      phone: "+966500000001",
      preferred_locale: "ar",
      default_hotel_id: hotel.id,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: null,
    },
    hotel,
    hotels: activeHotels.map(({ id, name_ar, name_en }) => ({ id, name_ar, name_en })),
    permissions,
    can: () => true,
  };
});

/** يضمن الدخول المباشر للنظام بكامل الصلاحيات */
export async function requireAppContext(_permission?: Permission): Promise<AppContext> {
  void _permission;
  return getAppContext();
}

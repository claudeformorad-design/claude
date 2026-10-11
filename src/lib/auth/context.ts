import "@/i18n/locale-server";
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import type { NavAccess } from "@/components/layout/nav-config";
import { type FeatureState, featureState, sectionKeys, underHref } from "@/lib/features/state";
import { type LicenseStatus, licenseStatus, licensedSettings } from "@/lib/license/client";
import { createClient, type SupabaseServerClient } from "@/lib/supabase/server";
import type { HotelRow, UserProfileRow } from "@/lib/supabase/database.types";
import type { Permission } from "./permissions";
import { type AccessInterface, EMPTY_INTERFACE } from "./access-catalog";

const HOTEL_COOKIE = "hotel_id";

/** هوية المستخدم من رمز الدخول الموثّق */
export type SessionUser = { id: string; email: string | null };

export interface AppContext {
  supabase: SupabaseServerClient;
  user: SessionUser;
  profile: UserProfileRow | null;
  hotel: HotelRow;
  hotels: Pick<HotelRow, "id" | "name_ar" | "name_en">[];
  permissions: ReadonlySet<string>;
  can: (permission: Permission) => boolean;
  /** واجهة المستخدم حسب دوره وإعداداته: الصفحة الأولى، الإجراءات السريعة، ما يُخفى من اللوحة، والحدود */
  ui: AccessInterface;
  /** تخصيص النظام للفندق: ما أُطفئ من أقسام وأجزاء وخانات وأزرار */
  features: FeatureState;
  /** هل هذا الجزء أو الخانة أو الزر مفعّل في الفندق؟ */
  on: (key: string) => boolean;
  /** ما يظهر في التنقل: الأقسام المفعّلة والصلاحيات والصفحات المطفأة */
  access: NavAccess;
  /** ترخيص النظام من لوحة نزيل (حين يُطلب) */
  license: LicenseStatus;
}

/**
 * سياق الطلب الحالي: المستخدم، الفندق النشط، وصلاحياته فيه.
 * مخزّن مؤقتًا لكل طلب (React cache) حتى لا تتكرر الاستعلامات بين المكونات.
 * ملاحظة: الصلاحيات هنا لتحسين تجربة الواجهة فقط؛ الحماية الفعلية في RLS والتريغرات.
 */
export const getAppContext = cache(async (): Promise<AppContext | { user: SessionUser | null; hotel: null }> => {
  const supabase = await createClient();
  // getClaims: تحقق من توقيع رمز الدخول (محليًا مع مفاتيح التوقيع غير المتماثلة، فلا طلب شبكة لكل صفحة)
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return { user: null, hotel: null };
  const user: SessionUser = { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };

  // صلاحيات الفندق المحفوظ في الكوكي تُجلب بالتوازي مع الملف والفنادق (الحالة المعتادة)، فلا تنتظر جولة إضافية
  const cookieHotel = (await cookies()).get(HOTEL_COOKIE)?.value;
  const permsFor = (hotelId: string) => supabase.rpc("my_permissions", { p_hotel_id: hotelId });
  const [{ data: profile }, { data: hotels }, early] = await Promise.all([
    supabase.from("users_profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("hotels").select("*").eq("is_active", true).order("name_ar"),
    cookieHotel ? permsFor(cookieHotel) : null,
  ]);
  if (!hotels || hotels.length === 0) return { user, hotel: null };

  const preferred = cookieHotel ?? profile?.default_hotel_id;
  const hotel = hotels.find((h) => h.id === preferred) ?? hotels[0]!;

  const [{ data: perms }, { data: ui }] = await Promise.all([
    early && hotel.id === cookieHotel ? early : permsFor(hotel.id),
    supabase.rpc("my_interface", { p_hotel_id: hotel.id }),
  ]);
  const permissions = new Set<string>(perms ?? []);
  // الأقسام غير المشمولة في الترخيص تُطفأ فوق ما اختاره الفندق
  const license = await licenseStatus();
  const base = {
    enabled_modules: hotel.enabled_modules ?? ["accounting", "pms"],
    blocked_sections: hotel.blocked_sections ?? [],
    disabled_features: hotel.disabled_features ?? [],
  };
  const settings = license.required && license.ok ? licensedSettings(base, license.license, sectionKeys()) : base;
  const features = featureState(settings);

  return {
    supabase,
    user,
    profile: profile ?? null,
    hotel,
    hotels: hotels.map(({ id, name_ar, name_en }) => ({ id, name_ar, name_en })),
    permissions,
    can: (permission: Permission) => permissions.has(permission),
    ui: { ...EMPTY_INTERFACE, ...((ui ?? {}) as Partial<AccessInterface>) },
    features,
    on: (key: string) => !features.off.has(key),
    access: { modules: settings.enabled_modules, permissions: [...permissions].sort(), hidden: features.hiddenHrefs },
    license,
  };
});

/** يضمن وجود مستخدم وفندق، وإلا يحوّل لصفحة الدخول أو الإعداد */
export async function requireAppContext(permission?: Permission): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.hotel) redirect("/onboarding");
  const full = ctx as AppContext;
  // نظام يحتاج ترخيصًا ولم يُفعَّل أو أُوقف: شاشة التفعيل
  if (full.license.required && !full.license.ok) redirect("/activate");
  // صفحة أطفأها تخصيص النظام تُمنع حتى لو فُتحت برابطها (الوكيل يمرر مسار الطلب)
  const path = (await headers()).get("x-pathname");
  if (path && full.features.hiddenHrefs.some((h) => underHref(path, h))) redirect("/feature-off");
  if (permission && !full.can(permission)) forbidden();
  return full;
}

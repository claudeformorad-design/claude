import "server-only";
import type { AppContext } from "@/lib/auth/context";
import type { HotelModule } from "@/lib/supabase/database.types";
import { type FeatureSettings, maskedPermissions, permissionsUnder, sectionKeys } from "@/lib/features/state";
import { type LicensePayload, licenseStatus, licensedSettings, ownerBlocked, ownerBlockedPermissions } from "./client";

const KEEP = new Set(["settings.hotel.manage", "settings.users.manage"]);

/**
 * صلاحيات أوقفها صاحب النظام من اللوحة: ما أوقفه مباشرة، وصلاحيات ما أوقفه من الأجزاء والأزرار.
 * تسقط من كل الموظفين حتى المدير العام. إدارة الفندق والمستخدمين لا تُوقف حتى لا يُغلق النظام على صاحبه.
 */
export function ownerMaskedPermissions(license: LicensePayload): string[] {
  return [...new Set([...ownerBlockedPermissions(license), ...permissionsUnder(ownerBlocked(license))])].filter((p) => !KEEP.has(p)).sort();
}

/**
 * صلاحيات طبقة الأقسام التي تسقط في القاعدة: ما أطفأه الفندق بنفسه، وفوقه ما لم يشترِه في الترخيص
 * (وكل صلاحيات القسم الأساسي غير المشترى). ما يطفئه الترخيص لا يُكتب في اختيارات الفندق نفسها،
 * فإن أُضيف القسم للترخيص لاحقًا يعود كما كان دون أثر.
 */
export async function sectionPermissions(ctx: AppContext, manual: FeatureSettings): Promise<string[]> {
  const lic = await licenseStatus();
  if (!lic.required || !lic.ok) return maskedPermissions(manual, "section");
  const perms = new Set([...maskedPermissions(licensedSettings(manual, lic.license, sectionKeys()), "section"), ...ownerMaskedPermissions(lic.license)]);
  const unsold = (["pms", "accounting"] as const).filter((m) => !lic.license.sections.includes(m));
  if (unsold.length) {
    const { data } = await ctx.supabase.from("permissions").select("code, product").in("product", unsold);
    for (const p of (data ?? []) as { code: string }[]) perms.add(p.code);
  }
  return [...perms].filter((p) => !KEEP.has(p)).sort();
}

/**
 * يطبّق الترخيص على قاعدة البيانات أيضًا (لا الواجهة فقط): صلاحيات ما لم يُشترَ تسقط من كل الموظفين.
 * يُستدعى بعد التفعيل وفي صفحات المدير؛ لا يكتب إلا إن تغيّر شيء. إن لم يملك المستخدم الأقسام يُترك،
 * فالواجهة تطبّق الترخيص على كل حال.
 */
export async function syncLicenseToDatabase(ctx: AppContext): Promise<void> {
  const lic = await licenseStatus();
  if (!lic.required || !lic.ok) return;
  const h = ctx.hotel;
  const manual: FeatureSettings = { enabled_modules: h.enabled_modules ?? ["accounting", "pms"], blocked_sections: h.blocked_sections ?? [], disabled_features: h.disabled_features ?? [] };
  const perms = await sectionPermissions(ctx, manual);
  if (perms.join() === [...(h.section_permissions ?? [])].sort().join()) return;
  await ctx.supabase.rpc("save_hotel_sections", {
    p_hotel_id: h.id, p_modules: [...manual.enabled_modules] as HotelModule[], p_blocked: [...manual.blocked_sections], p_permissions: perms,
  });
}

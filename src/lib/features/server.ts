import "server-only";
import { tr } from "@/i18n/tr";
import type { AppContext } from "@/lib/auth/context";
import type { HotelModule } from "@/lib/supabase/database.types";
import { type FeatureCheck, type FeatureNode, featureTree, flatten } from "./registry";
import { type FeatureSettings, maskedPermissions } from "./state";
import { getI18n } from "@/i18n/server";
import { ServiceError } from "@/services/errors";

export type CheckResult = { level: "block" | "warn"; text: string };

/** فحص حي لبيانات الفندق قبل الإطفاء: يمنع ما يكسر عملًا قائمًا، وينبّه لما يتأثر */
async function runCheck(ctx: AppContext, check: FeatureCheck): Promise<CheckResult | null> {
  const { supabase, hotel } = ctx;
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    return r.error ? 0 : r.count ?? 0;
  };
  const head = { count: "exact" as const, head: true };
  switch (check) {
    case "shift_required":
      return hotel.require_cashier_shift
        ? { level: "block", text: tr("وردية الكاشير إلزامية في إعدادات الفندق. ألغِ الإلزام أولًا من إعدادات التشغيل.") }
        : null;
    case "open_shifts": {
      const n = await count(supabase.from("cashier_shifts").select("id", head).eq("hotel_id", hotel.id).eq("status", "open"));
      return n ? { level: "block", text: tr("يوجد {0} وردية مفتوحة، أقفلها أولًا.", n) } : null;
    }
    case "in_house": {
      const n = await count(supabase.from("reservations").select("id", head).eq("hotel_id", hotel.id).eq("status", "checked_in"));
      return n ? { level: "warn", text: tr("يوجد {0} نزيل مقيم الآن، ولن تظهر إقامتهم لأحد حتى يُشغَّل القسم.", n) } : null;
    }
    case "waitlist": {
      const n = await count(supabase.from("waitlist_entries").select("id", head).eq("hotel_id", hotel.id).eq("status", "waiting"));
      return n ? { level: "warn", text: tr("يوجد {0} طلب في قائمة الانتظار سيبقى معلقًا.", n) } : null;
    }
    case "open_laundry": {
      const n = await count(supabase.from("laundry_orders").select("id", head).eq("hotel_id", hotel.id).in("status", ["received", "in_process", "ready"]));
      return n ? { level: "warn", text: tr("يوجد {0} طلب مغسلة لم يُسلَّم بعد.", n) } : null;
    }
    case "open_maintenance": {
      const n = await count(supabase.from("maintenance_requests").select("id", head).eq("hotel_id", hotel.id).in("status", ["open", "in_progress", "on_hold"]));
      return n ? { level: "warn", text: tr("يوجد {0} بلاغ صيانة مفتوح.", n) } : null;
    }
    case "upcoming_events": {
      const n = await count(supabase.from("event_bookings").select("id", head).eq("hotel_id", hotel.id)
        .in("status", ["tentative", "confirmed"]).gte("ends_at", new Date().toISOString()));
      return n ? { level: "warn", text: tr("يوجد {0} مناسبة قادمة محجوزة.", n) } : null;
    }
    case "held_items": {
      const [a, b] = await Promise.all([
        count(supabase.from("safe_deposits").select("id", head).eq("hotel_id", hotel.id).eq("status", "held")),
        count(supabase.from("lost_found_items").select("id", head).eq("hotel_id", hotel.id).eq("status", "stored")),
      ]);
      return a + b ? { level: "warn", text: tr("يوجد {0} أمانة أو مفقود محفوظ لم يُسلَّم لصاحبه.", a + b) } : null;
    }
    case "employees": {
      const n = await count(supabase.from("hr_employees").select("id", head).eq("hotel_id", hotel.id).eq("status", "active"));
      return n ? { level: "warn", text: tr("يوجد {0} موظف مسجل، وبياناتهم تبقى محفوظة.", n) } : null;
    }
    case "inventory_items": {
      const n = await count(supabase.from("inventory_items").select("id", head).eq("hotel_id", hotel.id).eq("is_active", true));
      return n ? { level: "warn", text: tr("يوجد {0} صنف في المخزون. فواتير الموردين للأصناف المخزنية لن تُحفظ وهو مطفأ.", n) } : null;
    }
    case "fixed_assets": {
      const n = await count(supabase.from("fixed_assets").select("id", head).eq("hotel_id", hotel.id).eq("status", "active"));
      return n ? { level: "warn", text: tr("يوجد {0} أصل ثابت، ولن يُحسب إهلاكه وهو مطفأ.", n) } : null;
    }
    case "pos_orders": {
      const n = await count(supabase.from("pos_orders").select("id", head).eq("hotel_id", hotel.id));
      return n ? { level: "warn", text: tr("سجلات البيع السابقة تبقى في الفواتير والفوليوهات.") } : null;
    }
  }
}

export const settingsOf = (h: AppContext["hotel"]): FeatureSettings => ({
  enabled_modules: h.enabled_modules ?? ["accounting", "pms"],
  blocked_sections: h.blocked_sections ?? [],
  disabled_features: h.disabled_features ?? [],
});

export async function canManageSections(ctx: AppContext): Promise<boolean> {
  const { data } = await ctx.supabase.rpc("can_manage_sections", { p_hotel_id: ctx.hotel.id });
  return data === true;
}

export async function localizedTree(): Promise<FeatureNode[]> {
  const { t } = await getI18n();
  return featureTree(t.nav);
}

export type ToggleResult =
  | { ok: true }
  | { ok: false; level: "block" | "warn"; messages: string[] };

/**
 * تشغيل أو إطفاء عنصر: يمنع المقفول وما لا يملكه المستخدم، ويفحص الأثر قبل الإطفاء.
 * التحذير يحتاج تأكيدًا صريحًا (confirm)، والمنع لا يتجاوزه أحد.
 */
export async function toggleFeature(ctx: AppContext, key: string, on: boolean, confirm: boolean): Promise<ToggleResult> {
  const tree = await localizedTree();
  const entry = flatten(tree).find((x) => x.node.key === key);
  if (!entry) return { ok: false, level: "block", messages: [tr("عنصر غير معروف")] };
  const { node, parents } = entry;
  if (node.locked) return { ok: false, level: "block", messages: [node.locked] };
  const section = node.kind === "section";
  if (section && !(await canManageSections(ctx))) {
    return { ok: false, level: "block", messages: [tr("الأقسام يتحكم فيها صاحب النظام حسب ما اشتراه الفندق.")] };
  }
  const s = settingsOf(ctx.hotel);
  const next: FeatureSettings = { ...s };
  if (section && node.module) {
    const mods = on ? [...new Set([...s.enabled_modules, node.module])] : s.enabled_modules.filter((m) => m !== node.module);
    if (mods.length === 0) return { ok: false, level: "block", messages: [tr("يجب أن يبقى قسم أساسي واحد على الأقل: الحجوزات أو المحاسبة.")] };
    next.enabled_modules = mods;
  } else if (section) {
    next.blocked_sections = on ? s.blocked_sections.filter((k) => k !== key) : [...new Set([...s.blocked_sections, key])];
  } else {
    next.disabled_features = on ? s.disabled_features.filter((k) => k !== key) : [...new Set([...s.disabled_features, key])];
  }

  if (!on) {
    // الفحوص الحية للعنصر وما تحته (إطفاء قسم يطفئ أجزاءه)
    const below = flatten([node]).map((x) => x.node);
    const checks = [...new Set(below.flatMap((n) => n.check ?? []))];
    const results = (await Promise.all(checks.map((c) => runCheck(ctx, c)))).filter((r): r is CheckResult => r !== null);
    const blocks = results.filter((r) => r.level === "block").map((r) => r.text);
    if (blocks.length) return { ok: false, level: "block", messages: blocks };
    const warnings = [node.warn, ...results.map((r) => r.text)].filter((x): x is string => !!x);
    if (warnings.length && !confirm) return { ok: false, level: "warn", messages: warnings };
  } else if (parents.some((p) => isOff(p, s))) {
    return { ok: false, level: "block", messages: [tr("القسم الذي يتبعه هذا العنصر مطفأ، شغّل القسم أولًا.")] };
  }

  const r = section
    ? await ctx.supabase.rpc("save_hotel_sections", {
        p_hotel_id: ctx.hotel.id, p_modules: next.enabled_modules as HotelModule[], p_blocked: [...next.blocked_sections],
        p_permissions: maskedPermissions(next, "section", tree),
      })
    : await ctx.supabase.rpc("save_hotel_features", {
        p_hotel_id: ctx.hotel.id, p_disabled: [...next.disabled_features], p_permissions: maskedPermissions(next, "feature", tree),
      });
  if (r.error) throw r.error;
  return { ok: true };
}

const isOff = (n: FeatureNode, s: FeatureSettings) =>
  !n.locked && (n.kind === "section" ? (n.module ? !s.enabled_modules.includes(n.module) : s.blocked_sections.includes(n.key)) : s.disabled_features.includes(n.key));

/** إجراءات الأزرار التي لا تخصها صلاحية: الخادم يرفضها والعنصر مطفأ */
export function assertFeature(ctx: AppContext, key: string): void {
  if (!ctx.on(key)) throw new ServiceError("permission_denied", "This part is turned off for the hotel");
}

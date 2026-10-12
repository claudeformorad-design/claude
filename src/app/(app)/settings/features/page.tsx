import { tr } from "@/i18n/tr";
import { PageHeader } from "@/components/layout/page-header";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { FeatureNode } from "@/lib/features/registry";
import { canManageSections, localizedTree, settingsOf } from "@/lib/features/server";
import { selfOff } from "@/lib/features/state";
import { ownerBlocked } from "@/lib/license/client";
import { getI18n } from "@/i18n/server";
import { FeaturesEditor, type ViewNode } from "./features-editor";
import { LicenseCard } from "./license-card";

/**
 * تخصيص النظام: إطفاء قسم كامل أو جزء منه أو خانة أو زر لهذا الفندق.
 * الأقسام لصاحب النظام، والباقي لمدير الفندق. كل إطفاء يُفحص أثره قبل الحفظ.
 */
export default async function FeaturesPage() {
  const ctx = await requireAppContext(PERMISSIONS.hotelManage);
  const { t } = await getI18n();
  const [tree, owner] = await Promise.all([localizedTree(), canManageSections(ctx)]);
  const s = settingsOf(ctx.hotel);
  // نظام مرخّص من لوحة هوتيلنا: ما لم يُشترَ من الأقسام مقفل
  const sold = ctx.license.required && ctx.license.ok ? new Set(ctx.license.license.sections) : null;
  const unsold = (n: FeatureNode) => sold !== null && n.kind === "section" && n.key !== "general" && !sold.has(n.key);
  // ما أوقفه صاحب النظام من الأجزاء والخانات والأزرار: مقفل عند مدير الفندق
  const byOwner = new Set(ctx.license.required && ctx.license.ok ? ownerBlocked(ctx.license.license) : []);
  const ownerOff = (n: FeatureNode) => !n.locked && byOwner.has(n.key);
  const view = (n: FeatureNode): ViewNode => ({
    key: n.key, kind: n.kind, label: n.label, hint: n.hint ?? null,
    locked: unsold(n) ? tr("غير مشمول في ترخيص الفندق. يُضاف من صاحب النظام.")
      : ownerOff(n) ? tr("أوقفه صاحب النظام من لوحة التحكم.") : n.locked ?? null,
    on: !unsold(n) && !ownerOff(n) && !selfOff(n, s), unsold: unsold(n) || ownerOff(n),
    children: unsold(n) || ownerOff(n) ? [] : (n.children ?? []).map(view),
  });
  return (
    <>
      <PageHeader title={tr("تخصيص النظام")} />
      <p className="mb-6 max-w-3xl text-[16.5px] leading-relaxed text-slate-600">
        {tr("أطفئ ما لا يحتاجه الفندق: قسم كامل، أو جزء من قسم، أو خانة أو زر. المطفأ يختفي عن كل الموظفين ويُمنع حتى لو فُتح برابطه، والبيانات لا تُحذف أبدًا وترجع كما هي عند التشغيل. قبل الإطفاء يفحص النظام الأثر فينبهك أو يمنعك إن كان سيسبب مشكلة.")}
      </p>
      {ctx.license.required && ctx.license.ok && <LicenseCard license={ctx.license} />}
      <FeaturesEditor tree={tree.map(view)} owner={owner} errors={t.errors} />
    </>
  );
}

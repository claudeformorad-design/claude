import { tr } from "@/i18n/tr";
import { PageHeader } from "@/components/layout/page-header";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { FeatureNode } from "@/lib/features/registry";
import { canManageSections, localizedTree, settingsOf } from "@/lib/features/server";
import { selfOff } from "@/lib/features/state";
import { getI18n } from "@/i18n/server";
import { FeaturesEditor, type ViewNode } from "./features-editor";

/**
 * تخصيص النظام: إطفاء قسم كامل أو جزء منه أو خانة أو زر لهذا الفندق.
 * الأقسام لصاحب النظام، والباقي لمدير الفندق. كل إطفاء يُفحص أثره قبل الحفظ.
 */
export default async function FeaturesPage() {
  const ctx = await requireAppContext(PERMISSIONS.hotelManage);
  const { t } = await getI18n();
  const [tree, owner] = await Promise.all([localizedTree(), canManageSections(ctx)]);
  const s = settingsOf(ctx.hotel);
  const view = (n: FeatureNode): ViewNode => ({
    key: n.key, kind: n.kind, label: n.label, hint: n.hint ?? null, locked: n.locked ?? null,
    on: !selfOff(n, s), children: (n.children ?? []).map(view),
  });
  return (
    <>
      <PageHeader title={tr("تخصيص النظام")} />
      <p className="mb-6 max-w-3xl text-[16.5px] leading-relaxed text-slate-600">
        {tr("أطفئ ما لا يحتاجه الفندق: قسم كامل، أو جزء من قسم، أو خانة أو زر. المطفأ يختفي عن كل الموظفين ويُمنع حتى لو فُتح برابطه، والبيانات لا تُحذف أبدًا وترجع كما هي عند التشغيل. قبل الإطفاء يفحص النظام الأثر فينبهك أو يمنعك إن كان سيسبب مشكلة.")}
      </p>
      <FeaturesEditor tree={tree.map(view)} owner={owner} errors={t.errors} />
    </>
  );
}

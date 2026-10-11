import { tr } from "@/i18n/tr";
import { ToggleLeft } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";

/** صفحة أطفأها تخصيص النظام وفُتحت برابطها */
export default async function FeatureOffPage() {
  const ctx = await requireAppContext();
  return (
    <EmptyState
      icon={ToggleLeft}
      title={tr("هذا الجزء مطفأ في هذا الفندق")}
      description={ctx.can(PERMISSIONS.hotelManage) ? tr("يمكنك تشغيله من صفحة تخصيص النظام.") : tr("اطلب من مدير الفندق تشغيله إن كنت تحتاجه.")}
      actionHref={ctx.can(PERMISSIONS.hotelManage) ? "/settings/features" : undefined}
      actionLabel={tr("تخصيص النظام")}
    />
  );
}

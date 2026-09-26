import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { getI18n } from "@/i18n/server";
import { loadPurchaseOptions } from "../../_payables/options";
import { PurchaseDocForm } from "../doc-form";

export default async function NewPoPage() {
  const ctx = await requireAppContext(PERMISSIONS.purchasesManage);
  const { locale, t } = await getI18n();
  const o = await loadPurchaseOptions(ctx, locale);
  return (
    <>
      <PageHeader title={t.payables.newPo} description={t.payables.poSubtitle} />
      <Card><CardContent className="p-5">
        <PurchaseDocForm kind="po" locale={locale} today={todayInTimeZone(ctx.hotel.timezone)} vendors={o.vendors} accounts={o.accounts}
          departments={o.departments} taxes={o.taxes}
          t={{ payables: t.payables, folio: t.folio, common: t.common, errors: t.errors, journal: t.journal }} />
      </CardContent></Card>
    </>
  );
}

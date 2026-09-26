import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { listDepartments } from "@/services/accounts.service";
import { getI18n } from "@/i18n/server";
import { PayrollForm } from "./payroll-form";

export default async function NewPayrollPage() {
  const ctx = await requireAppContext(PERMISSIONS.payrollManage);
  const { locale, t } = await getI18n();
  const departments = await listDepartments(ctx.supabase, ctx.hotel.id);
  return (
    <>
      <PageHeader title={t.payables.newPayroll} description={t.payables.payrollSubtitle} />
      <Card><CardContent className="p-5">
        <PayrollForm t={{ payables: t.payables, common: t.common, errors: t.errors, journal: t.journal, folio: t.folio }} locale={locale}
          month={todayInTimeZone(ctx.hotel.timezone).slice(0, 7)}
          departments={departments.filter((d) => d.is_active).map((d) => ({ id: d.id, label: `${d.code} — ${(locale === "en" && d.name_en) || d.name_ar}` }))} />
      </CardContent></Card>
    </>
  );
}

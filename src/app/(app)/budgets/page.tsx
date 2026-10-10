import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/select";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { sumMoney } from "@/lib/accounting/money";
import { listDepartments } from "@/services/accounts.service";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { Target, TrendingDown, TrendingUp } from "lucide-react";
import { BudgetRows } from "../_ledger/forms";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** الموازنة التقديرية: مبلغ مخطط لكل حساب إيراد ومصروف في كل فترة من السنة المالية */
export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ fy?: string; department?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.budgetsManage);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const h = ctx.hotel.id;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [years, accounts, departments] = await Promise.all([
    ctx.supabase.from("fiscal_years").select("id, name, start_date, end_date").eq("hotel_id", h).order("start_date", { ascending: false }),
    ctx.supabase.from("chart_of_accounts").select("id, code, name_ar, name_en, account_type")
      .eq("hotel_id", h).eq("is_postable", true).eq("is_active", true).in("account_type", ["revenue", "expense"]).order("code"),
    listDepartments(ctx.supabase, h),
  ]);
  raise(years.error); raise(accounts.error);
  const fyList = years.data ?? [];
  const fy = fyList.find((y) => y.id === sp.fy) ?? fyList.find((y) => y.start_date <= today && y.end_date >= today) ?? fyList[0];
  const department = sp.department && UUID.test(sp.department) && departments.some((d) => d.id === sp.department) ? sp.department : null;
  const name = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;

  if (!fy) {
    return (<><PageHeader title={tr("الموازنة التقديرية")} />
      <EmptyState icon={Target} title={tr("لا توجد سنة مالية")} description={tr("أنشئ السنة المالية من إعدادات الفندق أولًا.")} /></>);
  }
  const [periods, budgets] = await Promise.all([
    ctx.supabase.from("accounting_periods").select("period_no, name").eq("fiscal_year_id", fy.id).order("period_no"),
    (() => {
      const q = ctx.supabase.from("budgets").select("account_id, amounts").eq("hotel_id", h).eq("fiscal_year_id", fy.id);
      return department ? q.eq("department_id", department) : q.is("department_id", null);
    })(),
  ]);
  raise(periods.error); raise(budgets.error);
  const periodNames = (periods.data ?? []).map((p) => p.name);
  const byAccount = new Map((budgets.data ?? []).map((b) => [b.account_id, b.amounts.map(String)]));
  const yearTotal = (id: string) => sumMoney(byAccount.get(id) ?? []);
  const list = accounts.data ?? [];
  const revenue = sumMoney(list.filter((a) => a.account_type === "revenue").map((a) => yearTotal(a.id).toString()));
  const expense = sumMoney(list.filter((a) => a.account_type === "expense").map((a) => yearTotal(a.id).toString()));
  const reportHref = `/reports/budget-vs-actual?to=${today < fy.end_date ? today : fy.end_date}${department ? `&department=${department}` : ""}`;

  return (
    <>
      <PageHeader title={tr("الموازنة التقديرية")}
        actions={<Button asChild variant="outline"><Link href={reportHref}>{tr("الموازنة مقابل الفعلي")}</Link></Button>} />
      <p className="max-w-3xl text-[15px] leading-relaxed text-slate-600">
        {tr("أدخل المبلغ المخطط لكل حساب إيراد ومصروف في كل شهر من السنة المالية، أو اكتب المبلغ السنوي ووزّعه بالتساوي. يمكن إعداد موازنة للفندق كله أو لكل قسم على حدة، ثم قارنها بالفعلي من تقرير «الموازنة مقابل الفعلي».")}
      </p>
      <form className="toolbar">
        <NativeSelect name="fy" defaultValue={fy.id} className="w-52" aria-label={tr("السنة المالية")}>
          {fyList.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </NativeSelect>
        <NativeSelect name="department" defaultValue={department ?? ""} className="w-56" aria-label={tr("القسم")}>
          <option value="">{tr("الفندق كله")}</option>
          {departments.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{name(d)}</option>)}
        </NativeSelect>
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>
      <StatGrid>
        <Stat currency={ctx.hotel.base_currency} icon={TrendingUp} tone="teal" label={tr("الإيرادات المخططة")} value={<Money value={revenue} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={TrendingDown} tone="clay" label={tr("المصروفات المخططة")} value={<Money value={expense} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={Target} tone="ink" label={tr("صافي الربح المخطط")} value={<Money value={revenue.minus(expense)} locale={locale} />} />
      </StatGrid>
      {(["revenue", "expense"] as const).map((type) => (
        <section key={type} className="space-y-2">
          <h2 className="text-lg font-semibold">{type === "revenue" ? tr("الإيرادات") : tr("المصروفات")}</h2>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-28">{tr("الرمز")}</TableHead><TableHead>{tr("الحساب")}</TableHead>
                <TableHead className="text-end">{tr("الموازنة السنوية")}</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                <BudgetRows fiscalYearId={fy.id} departmentId={department} periods={periodNames} errors={t.errors}
                  key={`${fy.id}-${department ?? ""}`}
                  rows={list.filter((a) => a.account_type === type).map((a) => ({
                    id: a.id, code: a.code, name: name(a), amounts: byAccount.get(a.id) ?? null,
                    total: <Money value={yearTotal(a.id)} locale={locale} />,
                  }))} />
              </TableBody>
            </Table>
          </Card>
        </section>
      ))}
    </>
  );
}

import { tr } from "@/i18n/tr";
import { ExportButtons } from "@/components/reports/export-buttons";
import { CodeName } from "@/components/ui/code-text";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { type DepartmentResult, summarizeProfitability } from "@/lib/accounting/profitability";
import { listDepartments } from "@/services/accounts.service";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { Package, PieChart, Receipt, TrendingUp } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";

export default async function ProfitabilityPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.profitabilityView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const to = sp.to && isIsoDate(sp.to) ? sp.to : today;
  const from = sp.from && isIsoDate(sp.from) && sp.from <= to ? sp.from : `${to.slice(0, 7)}-01`;
  const [res, departments] = await Promise.all([
    ctx.supabase.rpc("department_profitability", { p_hotel_id: ctx.hotel.id, p_from: from, p_to: to })
      .select("department_id, account_type, account_subtype, amount::text"),
    listDepartments(ctx.supabase, ctx.hotel.id),
  ]);
  raise(res.error);
  const { departments: rows, total } = summarizeProfitability((res.data ?? []) as never);
  const deptName = new Map(departments.map((d) => [d.id, `${d.code} ${(locale === "en" && d.name_en) || d.name_ar}`]));
  const p = t.profitability;
  const cells = (r: DepartmentResult) => (
    <>
      <TableCell className="text-end"><Money value={r.revenue} locale={locale} blankZero /></TableCell>
      <TableCell className="text-end"><Money value={r.costOfSales} locale={locale} blankZero /></TableCell>
      <TableCell className="text-end"><Money value={r.grossProfit} locale={locale} /></TableCell>
      <TableCell className="text-end"><Money value={r.operatingExpenses} locale={locale} blankZero /></TableCell>
      <TableCell className={cn("text-end font-semibold", r.netProfit.isNegative() ? "text-destructive" : "text-success")}><Money value={r.netProfit} locale={locale} /></TableCell>
      <TableCell className="num text-end">{r.margin ? `${r.margin.toFixed(1)}%` : ""}</TableCell>
    </>
  );
  return (
    <>
      <PageHeader title={t.nav.profitability}
        actions={<ExportButtons report={`profitability`} query={`from=${from}&to=${to}`} labels={{ excel: t.reports.exportExcel, pdf: t.reports.printPdf }} />} />
      <form className="toolbar">
        <Input type="date" name="from" defaultValue={from} dir="ltr" className="w-52" aria-label={t.common.from} />
        <Input type="date" name="to" defaultValue={to} dir="ltr" className="w-52" aria-label={t.common.to} />
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>
      <StatGrid>
        <Stat currency={ctx.hotel.base_currency} icon={TrendingUp} tone="teal" label={p.revenue} value={<Money value={total.revenue} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={Package} tone="clay" label={p.cos} value={<Money value={total.costOfSales} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={Receipt} tone="neutral" label={p.opex} value={<Money value={total.operatingExpenses} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={PieChart} tone="ink" label={p.net} value={<Money value={total.netProfit} locale={locale} />}
          valueClassName={total.netProfit.isNegative() ? "text-urgent" : "text-success"} hint={total.margin ? tr("هامش {0}%", total.margin.toFixed(1)) : undefined} />
      </StatGrid>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t.folio.department}</TableHead><TableHead className="text-end">{p.revenue}</TableHead><TableHead className="text-end">{p.cos}</TableHead>
            <TableHead className="text-end">{p.gross}</TableHead><TableHead className="text-end">{p.opex}</TableHead>
            <TableHead className="text-end">{p.net}</TableHead><TableHead className="text-end">{p.margin}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t.common.noData}</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.departmentId ?? "none"}>
                <TableCell>
                  <CodeName className="font-medium" label={(r.departmentId && deptName.get(r.departmentId)) || p.unassigned} />
                  {total.revenue.gt(0) && r.revenue.gt(0) && (
                    <span className="mt-1.5 block h-1.5 w-full max-w-40 overflow-hidden rounded-sm bg-subtle">
                      <span className="block h-full rounded-sm bg-accent1" style={{ width: `${Math.min(100, r.revenue.div(total.revenue).times(100).toNumber())}%` }} />
                    </span>
                  )}
                </TableCell>{cells(r)}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter><TableRow><TableCell>{t.common.total}</TableCell>{cells(total)}</TableRow></TableFooter>
        </Table>
      </Card>
    </>
  );
}

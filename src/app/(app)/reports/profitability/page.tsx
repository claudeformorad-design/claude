import { PageHeader } from "@/components/layout/page-header";
import { FileSpreadsheet } from "lucide-react";
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
  const deptName = new Map(departments.map((d) => [d.id, `${d.code} — ${(locale === "en" && d.name_en) || d.name_ar}`]));
  const p = t.profitability;
  const cells = (r: DepartmentResult) => (
    <>
      <TableCell className="text-end"><Money value={r.revenue} locale={locale} blankZero /></TableCell>
      <TableCell className="text-end"><Money value={r.costOfSales} locale={locale} blankZero /></TableCell>
      <TableCell className="text-end"><Money value={r.grossProfit} locale={locale} /></TableCell>
      <TableCell className="text-end"><Money value={r.operatingExpenses} locale={locale} blankZero /></TableCell>
      <TableCell className={cn("text-end font-semibold", r.netProfit.isNegative() ? "text-destructive" : "text-success")}><Money value={r.netProfit} locale={locale} /></TableCell>
      <TableCell className="num text-end">{r.margin ? `${r.margin.toFixed(1)}%` : "—"}</TableCell>
    </>
  );
  return (
    <>
      <PageHeader title={t.nav.profitability} description={p.subtitle}
        actions={<Button asChild variant="outline"><a href={`/api/export/profitability?from=${from}&to=${to}`}><FileSpreadsheet />{t.reports.exportExcel}</a></Button>} />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input type="date" name="from" defaultValue={from} dir="ltr" className="w-40" aria-label={t.common.from} />
        <Input type="date" name="to" defaultValue={to} dir="ltr" className="w-40" aria-label={t.common.to} />
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>
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
                <TableCell>{r.departmentId ? deptName.get(r.departmentId) : p.unassigned}</TableCell>{cells(r)}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter><TableRow><TableCell>{t.common.total}</TableCell>{cells(total)}</TableRow></TableFooter>
        </Table>
      </Card>
    </>
  );
}

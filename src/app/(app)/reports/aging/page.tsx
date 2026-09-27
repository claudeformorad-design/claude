import { ExportButtons } from "@/components/reports/export-buttons";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { AGING_BUCKETS, summarizeAging } from "@/lib/accounting/aging";
import { agingReport } from "@/services/payables.service";
import { getI18n } from "@/i18n/server";
import { CalendarCheck2, Clock } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EntityCell } from "@/components/ui/entity";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { EmptyState } from "@/components/ui/empty-state";

export default async function AgingPage({ searchParams }: { searchParams: Promise<{ kind?: string; asOf?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.agingView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const kind = sp.kind === "payable" ? "payable" : "receivable";
  const asOf = sp.asOf && isIsoDate(sp.asOf) ? sp.asOf : todayInTimeZone(ctx.hotel.timezone);
  const rows = await agingReport(ctx.supabase, ctx.hotel.id, kind, asOf);
  const { parties, totals } = summarizeAging(rows);
  const docBase = kind === "receivable" ? "/invoices" : "/bills";

  return (
    <>
      <PageHeader title={t.nav.aging} description={t.payables.agingSubtitle}
        actions={<ExportButtons report={`aging-${kind}`} query={`to=${asOf}`} labels={{ excel: t.reports.exportExcel, pdf: t.reports.printPdf }} />} />
      <StatGrid className="lg:grid-cols-5">
        {AGING_BUCKETS.map((b, i) => (
          <Stat key={b} icon={i === 0 ? CalendarCheck2 : Clock} tone={i === 0 ? "teal" : i >= 3 ? "clay" : "neutral"} label={t.payables.buckets[b]}
            value={<Money value={totals.buckets[b]} locale={locale} />}
            hint={totals.total.gt(0) ? `${totals.buckets[b].div(totals.total).times(100).toFixed(1)}%` : undefined} />
        ))}
      </StatGrid>
      <FilterTabs className="mb-4" active={kind} items={[
        { key: "receivable", href: `/reports/aging?kind=receivable&asOf=${asOf}`, label: t.payables.receivable },
        { key: "payable", href: `/reports/aging?kind=payable&asOf=${asOf}`, label: t.payables.payable },
      ]} />
      <form className="toolbar">
        <input type="hidden" name="kind" value={kind} />
        <Input type="date" name="asOf" defaultValue={asOf} dir="ltr" className="w-52" aria-label={t.payables.asOf} />
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t.vouchers.party}</TableHead>
            {AGING_BUCKETS.map((b) => <TableHead key={b} className="text-end">{t.payables.buckets[b]}</TableHead>)}
            <TableHead className="text-end">{t.common.total}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {parties.length === 0 && <TableRow><TableCell colSpan={7} className="py-8"><EmptyState title="لا توجد أرصدة قائمة" description="تظهر هنا المستندات غير المسددة موزعة حسب مدة تأخرها." icon={Clock} /></TableCell></TableRow>}
            {parties.map((p) => (
              <TableRow key={p.partyId}>
                <TableCell className="cell-fluid">
                  <EntityCell name={p.partyName} sub={
                    <>{p.documents.map((d) => <Link key={d.document_id} href={`${docBase}/${d.document_id}`} className="num me-2">{d.document_number}</Link>)}</>
                  } />
                </TableCell>
                {AGING_BUCKETS.map((b, i) => <TableCell key={b} className={`text-end ${i >= 3 && p.buckets[b].gt(0) ? "font-semibold text-urgent" : ""}`}><Money value={p.buckets[b]} locale={locale} blankZero /></TableCell>)}
                <TableCell className="text-end font-semibold"><Money value={p.total} locale={locale} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter><TableRow>
            <TableCell>{t.common.total}</TableCell>
            {AGING_BUCKETS.map((b) => <TableCell key={b} className="text-end"><Money value={totals.buckets[b]} locale={locale} /></TableCell>)}
            <TableCell className="text-end"><Money value={totals.total} locale={locale} /></TableCell>
          </TableRow></TableFooter>
        </Table>
      </Card>
    </>
  );
}

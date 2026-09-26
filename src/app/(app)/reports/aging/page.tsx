import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { AGING_BUCKETS, summarizeAging } from "@/lib/accounting/aging";
import { agingReport } from "@/services/payables.service";
import { getI18n } from "@/i18n/server";

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
      <PageHeader title={t.nav.aging} description={t.payables.agingSubtitle} />
      <form className="mb-4 flex flex-wrap gap-2">
        <NativeSelect name="kind" defaultValue={kind} className="w-56">
          <option value="receivable">{t.payables.receivable}</option><option value="payable">{t.payables.payable}</option>
        </NativeSelect>
        <Input type="date" name="asOf" defaultValue={asOf} dir="ltr" className="w-40" aria-label={t.payables.asOf} />
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
            {parties.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t.common.noData}</TableCell></TableRow>}
            {parties.map((p) => (
              <TableRow key={p.partyId}>
                <TableCell>
                  <p className="font-medium">{p.partyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.documents.map((d) => <Link key={d.document_id} href={`${docBase}/${d.document_id}`} className="num me-2 hover:underline">{d.document_number}</Link>)}
                  </p>
                </TableCell>
                {AGING_BUCKETS.map((b) => <TableCell key={b} className="text-end"><Money value={p.buckets[b]} locale={locale} blankZero /></TableCell>)}
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

import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fiscalYearStart, isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { trialBalanceColumns } from "@/lib/accounting/trial-balance";
import { getTrialBalance } from "@/services/reports.service";
import { getI18n } from "@/i18n/server";

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; zero?: string }>;
}) {
  const ctx = await requireAppContext(PERMISSIONS.trialBalanceView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const to = sp.to && isIsoDate(sp.to) ? sp.to : today;
  const from = sp.from && isIsoDate(sp.from) && sp.from <= to ? sp.from : fiscalYearStart(to, ctx.hotel.fiscal_year_start_month);
  const includeZero = sp.zero === "1";

  const tb = await getTrialBalance(ctx.supabase, {
    hotelId: ctx.hotel.id,
    fiscalYearStartMonth: ctx.hotel.fiscal_year_start_month,
    from,
    to,
    includeZeroRows: includeZero,
  });

  const name = (a: { name_ar: string; name_en: string | null }) => (locale === "en" && a.name_en) || a.name_ar;
  const m = (v: Parameters<typeof Money>[0]["value"]) => <Money value={v} locale={locale} blankZero />;

  return (
    <>
      <PageHeader title={t.trialBalance.title} description={`${t.trialBalance.subtitle} (${ctx.hotel.base_currency})`} />

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t.common.from}</span>
          <Input type="date" name="from" defaultValue={from} dir="ltr" className="w-40" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t.common.to}</span>
          <Input type="date" name="to" defaultValue={to} dir="ltr" className="w-40" />
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="zero" value="1" defaultChecked={includeZero} className="size-4" />
          {t.trialBalance.includeZero}
        </label>
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>

      <Alert variant={tb.isBalanced ? "success" : "destructive"} className="mb-4">
        {tb.isBalanced ? t.trialBalance.balancedNote : t.trialBalance.unbalancedNote}
      </Alert>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2}>{t.accounts.code}</TableHead>
              <TableHead rowSpan={2}>{t.journal.account}</TableHead>
              <TableHead colSpan={2} className="text-center">{t.trialBalance.opening}</TableHead>
              <TableHead colSpan={2} className="text-center">{t.trialBalance.movement}</TableHead>
              <TableHead colSpan={2} className="text-center">{t.trialBalance.closing}</TableHead>
            </TableRow>
            <TableRow>
              {[0, 1, 2].flatMap((i) => [
                <TableHead key={`d${i}`} className="text-end">{t.journal.debit}</TableHead>,
                <TableHead key={`c${i}`} className="text-end">{t.journal.credit}</TableHead>,
              ])}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tb.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">{t.common.noData}</TableCell>
              </TableRow>
            )}
            {tb.rows.map((row) => {
              const c = trialBalanceColumns(row);
              return (
                <TableRow key={row.account?.id ?? "unallocated"}>
                  <TableCell className="num">{row.account?.code ?? ""}</TableCell>
                  <TableCell>{row.account ? name(row.account) : t.trialBalance.unallocatedEarnings}</TableCell>
                  <TableCell className="text-end">{m(c.openingDebit)}</TableCell>
                  <TableCell className="text-end">{m(c.openingCredit)}</TableCell>
                  <TableCell className="text-end">{m(c.periodDebit)}</TableCell>
                  <TableCell className="text-end">{m(c.periodCredit)}</TableCell>
                  <TableCell className="text-end">{m(c.closingDebit)}</TableCell>
                  <TableCell className="text-end">{m(c.closingCredit)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>{t.common.total}</TableCell>
              <TableCell className="text-end"><Money value={tb.totals.openingDebit} locale={locale} /></TableCell>
              <TableCell className="text-end"><Money value={tb.totals.openingCredit} locale={locale} /></TableCell>
              <TableCell className="text-end"><Money value={tb.totals.periodDebit} locale={locale} /></TableCell>
              <TableCell className="text-end"><Money value={tb.totals.periodCredit} locale={locale} /></TableCell>
              <TableCell className="text-end"><Money value={tb.totals.closingDebit} locale={locale} /></TableCell>
              <TableCell className="text-end"><Money value={tb.totals.closingCredit} locale={locale} /></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
    </>
  );
}

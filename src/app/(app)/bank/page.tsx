import { tr } from "@/i18n/tr";
import { PageHeader } from "@/components/layout/page-header";
import { DocText } from "@/components/ui/code-text";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { formatMoney, sumMoney, toMoney } from "@/lib/accounting/money";
import { listAccounts } from "@/services/accounts.service";
import { listBankLines, listLedgerLines } from "@/services/payables.service";
import { getI18n } from "@/i18n/server";
import { AddBankLine, AutoMatch, LineActions } from "./bank-client";
import { CheckCircle2, FileText, Landmark, Link2Off } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";

export default async function BankPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.bankReconcile);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const accounts = (await listAccounts(ctx.supabase, ctx.hotel.id)).filter((a) => a.is_postable && a.account_type === "asset" && a.account_subtype === "current_asset");
  const banks = accounts.filter((a) => a.system_key === "bank" || a.code.startsWith("110"));
  const accountId = sp.account ?? banks.find((a) => a.system_key === "bank")?.id ?? banks[0]?.id;
  const name = (a: { name_ar: string; name_en: string | null }) => (locale === "en" && a.name_en) || a.name_ar;
  const [lines, ledger] = accountId
    ? await Promise.all([listBankLines(ctx.supabase, ctx.hotel.id, accountId), listLedgerLines(ctx.supabase, ctx.hotel.id, accountId)])
    : [[], []];
  const matchedIds = new Set(lines.map((l) => l.matched_line_id).filter(Boolean));
  const unmatchedLedger = ledger.filter((l) => !matchedIds.has(l.id));
  const glBalance = sumMoney(ledger.map((l) => toMoney(l.base_debit).minus(toMoney(l.base_credit))));
  const net = (l: (typeof ledger)[number]) => toMoney(l.base_debit).minus(toMoney(l.base_credit));
  const tt = { payables: t.payables, common: t.common, errors: t.errors, folio: t.folio };

  return (
    <>
      <PageHeader title={t.nav.bank} />
      <form className="toolbar">
        <NativeSelect name="account" defaultValue={accountId} className="w-72">
          {banks.map((a) => <option key={a.id} value={a.id}>{a.code} {name(a)}</option>)}
        </NativeSelect>
        <Button type="submit" variant="outline">{t.common.apply}</Button>
        {accountId && <AutoMatch label={t.payables.autoMatch} accountId={accountId} />}
      </form>
      {accountId && (
        <>
          <StatGrid>
            <Stat currency={ctx.hotel.base_currency} icon={Landmark} tone="ink" label={t.payables.glBalance} value={<Money value={glBalance} locale={locale} />} />
            <Stat currency={ctx.hotel.base_currency} icon={FileText} tone="teal" label={t.payables.statementTotal} value={<Money value={sumMoney(lines.map((l) => l.amount))} locale={locale} />} hint={tr("{0} سطر في الكشف", lines.length)} />
            <Stat currency={ctx.hotel.base_currency} icon={Link2Off} tone="clay" label={t.payables.unmatchedLedger} value={<Money value={sumMoney(unmatchedLedger.map(net))} locale={locale} />} hint={tr("{0} حركة", unmatchedLedger.length)} />
            <Stat icon={CheckCircle2} tone="neutral" label={tr("أسطر مطابقة")} value={<span className="num">{lines.filter((l) => l.matched_line_id).length} / {lines.length}</span>} />
          </StatGrid>
          <Card className="mb-4"><CardContent className="p-4"><AddBankLine t={tt} accountId={accountId} today={todayInTimeZone(ctx.hotel.timezone)} /></CardContent></Card>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t.common.date}</TableHead><TableHead>{t.common.description}</TableHead><TableHead>{t.common.reference}</TableHead>
                <TableHead className="text-end">{t.folio.amount}</TableHead><TableHead>{t.common.status}</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {lines.length === 0 && <TableRow><TableCell colSpan={6} className="py-8"><EmptyState title={tr("كشف الحساب فارغ")} description={tr("أضف أسطر كشف البنك من النموذج أعلاه، ثم طابقها مع حركات الأستاذ يدويًا أو تلقائيًا.")} icon={Landmark} /></TableCell></TableRow>}
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="num">{l.txn_date}</TableCell><TableCell><DocText text={l.description} /></TableCell><TableCell className="num">{l.reference ?? ""}</TableCell>
                    <TableCell className={`text-end font-semibold ${toMoney(l.amount).isNegative() ? "text-ink" : "text-success"}`}><Money value={l.amount} locale={locale} /></TableCell>
                    <TableCell><Badge variant={l.matched_line_id ? "success" : "warning"}>{l.matched_line_id ? t.payables.matched : t.payables.unmatched}</Badge></TableCell>
                    <TableCell>
                      <LineActions t={tt} lineId={l.id} matched={!!l.matched_line_id}
                        candidates={unmatchedLedger.filter((g) => net(g).eq(toMoney(l.amount))).map((g) => ({
                          id: g.id, label: `${g.journal_entries.entry_date} ${g.journal_entries.entry_number} ${formatMoney(net(g), { locale })}`,
                        }))} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}

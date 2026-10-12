import { tr } from "@/i18n/tr";
import { notFound } from "next/navigation";
import Link from "@/components/link";
import { ArrowDownLeft, ArrowUpRight, Scale, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PrintLink } from "@/components/print-link";
import { StatementTable, statementKind } from "@/components/reports/statement-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Money } from "@/components/money";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { plainText } from "@/lib/text";
import { vendorStatement } from "@/services/statements.service";

/** كشف حساب المورد لفترة، للمطابقة مع كشفه، مع طباعته */
export default async function VendorStatementPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.billsView);
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const to = sp.to && isIsoDate(sp.to) ? sp.to : today;
  const from = sp.from && isIsoDate(sp.from) && sp.from <= to ? sp.from : `${to.slice(0, 4)}-01-01`;
  const s = await vendorStatement(ctx.supabase, ctx.hotel.id, id, from, to);
  if (!s) notFound();
  const decimals = (await ctx.supabase.from("currencies").select("decimals").eq("code", ctx.hotel.base_currency).single()).data?.decimals ?? 2;
  const cur = ctx.hotel.base_currency;

  return (
    <>
      <PageHeader title={tr("كشف حساب {0}", s.vendor.name_ar)} actions={
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href={`/bills?vendor=${id}`}>{tr("فواتير المورد")}</Link></Button>
          <PrintLink href={`/print/vendor-statement/${id}?from=${from}&to=${to}`} label={tr("طباعة الكشف")} />
        </div>
      } />
      <form className="toolbar print:hidden">
        <Input type="date" name="from" defaultValue={from} dir="ltr" className="w-52" aria-label={tr("من")} />
        <Input type="date" name="to" defaultValue={to} dir="ltr" className="w-52" aria-label={tr("إلى")} />
        <Button type="submit" variant="outline">{tr("عرض")}</Button>
      </form>
      <StatGrid>
        <Stat currency={cur} icon={Wallet} tone="neutral" label={tr("الرصيد الافتتاحي")} value={<Money value={s.opening} locale="ar" />} hint={tr("في {0}", from)} />
        <Stat currency={cur} icon={ArrowUpRight} tone="clay" label={tr("دائن")} value={<Money value={s.credit} locale="ar" />} hint={tr("فواتير المورد")} />
        <Stat currency={cur} icon={ArrowDownLeft} tone="teal" label={tr("مدين")} value={<Money value={s.debit} locale="ar" />} hint={tr("سندات صرف ومرتجعات")} />
        <Stat currency={cur} icon={Scale} tone="ink" label={s.closing.isNegative() ? tr("رصيد مدين على المورد") : tr("المستحق للمورد")} value={<Money value={s.closing.abs()} locale="ar" />} hint={tr("في {0}", to)} />
      </StatGrid>
      <Card><CardContent className="p-5">
        <StatementTable links party="vendor" decimals={decimals} opening={s.opening} debit={s.debit} credit={s.credit} closing={s.closing}
          rows={s.lines.map((l) => ({ ...l, label: statementKind(l.kind), description: plainText(l.description) }))} />
      </CardContent></Card>
    </>
  );
}

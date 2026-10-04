import { notFound } from "next/navigation";
import Link from "@/components/link";
import { ArrowDownLeft, ArrowUpRight, Scale, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PrintLink } from "@/components/print-link";
import { StatementTable, statementKind } from "@/components/reports/statement-table";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Money } from "@/components/money";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { plainText } from "@/lib/text";
import { customerStatement } from "@/services/statements.service";

/** كشف حساب العميل لفترة، مع طباعته */
export default async function CustomerStatementPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.customersView);
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const to = sp.to && isIsoDate(sp.to) ? sp.to : today;
  const from = sp.from && isIsoDate(sp.from) && sp.from <= to ? sp.from : `${to.slice(0, 4)}-01-01`;
  const s = await customerStatement(ctx.supabase, ctx.hotel.id, id, from, to);
  if (!s) notFound();
  const decimals = (await ctx.supabase.from("currencies").select("decimals").eq("code", ctx.hotel.base_currency).single()).data?.decimals ?? 2;
  const cur = ctx.hotel.base_currency;

  return (
    <>
      <PageHeader title={`كشف حساب ${s.customer.name_ar}`} actions={
        <div className="flex flex-wrap gap-2">
          {ctx.can(PERMISSIONS.invoicesView) && <Button asChild variant="outline"><Link href={`/invoices?customer=${id}`}>فواتير العميل</Link></Button>}
          <PrintLink href={`/print/customer-statement/${id}?from=${from}&to=${to}`} label="طباعة الكشف" />
        </div>
      } />
      <form className="toolbar print:hidden">
        <Input type="date" name="from" defaultValue={from} dir="ltr" className="w-52" aria-label="من" />
        <Input type="date" name="to" defaultValue={to} dir="ltr" className="w-52" aria-label="إلى" />
        <Button type="submit" variant="outline">عرض</Button>
      </form>
      <StatGrid>
        <Stat currency={cur} icon={Wallet} tone="neutral" label="الرصيد الافتتاحي" value={<Money value={s.opening} locale="ar" />} hint={`في ${from}`} />
        <Stat currency={cur} icon={ArrowUpRight} tone="clay" label="مدين" value={<Money value={s.debit} locale="ar" />} hint="فواتير وسندات صرف" />
        <Stat currency={cur} icon={ArrowDownLeft} tone="teal" label="دائن" value={<Money value={s.credit} locale="ar" />} hint="سندات قبض وإشعارات دائن" />
        <Stat currency={cur} icon={Scale} tone="ink" label={s.closing.isNegative() ? "رصيد دائن للعميل" : "الرصيد المستحق"} value={<Money value={s.closing.abs()} locale="ar" />} hint={`في ${to}`} />
      </StatGrid>
      {!s.pendingFolios.isZero() && (
        <Alert className="mb-6">على العميل أيضًا <Money value={s.pendingFolios} locale="ar" /> محوّلة على حسابه في فوليوهات مفتوحة، تدخل الكشف عند إصدار فواتيرها.</Alert>
      )}
      <Card><CardContent className="p-5">
        <StatementTable links decimals={decimals} opening={s.opening} debit={s.debit} credit={s.credit} closing={s.closing}
          rows={s.lines.map((l) => ({ ...l, label: statementKind(l.kind), description: plainText(l.description) }))} />
      </CardContent></Card>
    </>
  );
}

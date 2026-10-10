import { tr } from "@/i18n/tr";
import { ExpandableRow, ExpandMark } from "@/components/ui/expandable-row";
import { DocText } from "@/components/ui/code-text";
import Link from "@/components/link";
import { CreditCard, HandCoins, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listVouchers } from "@/services/vouchers.service";
import { getI18n } from "@/i18n/server";
import { EmptyState } from "@/components/ui/empty-state";
import { Receipt } from "lucide-react";
import { Scale } from "lucide-react";
import { ZERO, toMoney } from "@/lib/accounting/money";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EntityCell } from "@/components/ui/entity";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Pager, pageSlice } from "@/components/ui/pager";

export default async function VouchersPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string; page?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.paymentsView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const vouchers = await listVouchers(ctx.supabase, ctx.hotel.id, sp);

  const live = vouchers.filter((v) => v.status !== "voided");
  const receipts = live.filter((v) => v.voucher_type === "receipt").reduce((a, v) => a.plus(toMoney(v.amount)), ZERO);
  const disbursements = live.filter((v) => v.voucher_type === "disbursement").reduce((a, v) => a.plus(toMoney(v.amount)), ZERO);
  const qs = (ty?: string) => {
    const p = new URLSearchParams();
    if (ty) p.set("type", ty);
    if (sp.q) p.set("q", sp.q);
    const q = p.toString();
    return q ? `/vouchers?${q}` : "/vouchers";
  };

  const shown = pageSlice(vouchers, sp.page);

  return (
    <>
      <PageHeader
        title={t.vouchers.title}
        actions={
          <>
            {ctx.can(PERMISSIONS.paymentsReceipt) && <Button asChild><Link href="/vouchers/new?type=receipt"><Plus />{t.vouchers.newReceipt}</Link></Button>}
            {ctx.can(PERMISSIONS.paymentsDisbursement) && <Button asChild variant="outline"><Link href="/vouchers/new?type=disbursement"><Plus />{t.vouchers.newDisbursement}</Link></Button>}
          </>
        }
      />
      <StatGrid>
        <Stat icon={Receipt} tone="ink" label={tr("سندات في القائمة")} value={<span className="num">{vouchers.length}</span>} />
        <Stat currency={ctx.hotel.base_currency} icon={HandCoins} tone="teal" label={tr("مقبوضات")} value={<Money value={receipts} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={CreditCard} tone="clay" label={tr("مدفوعات")} value={<Money value={disbursements} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={Scale} tone="neutral" label={tr("صافي الحركة")} value={<Money value={receipts.minus(disbursements)} locale={locale} />}
          valueClassName={receipts.minus(disbursements).isNegative() ? "text-urgent" : undefined} hint={tr("بدون السندات الملغاة")} />
      </StatGrid>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs active={sp.type ?? "all"} items={[
          { key: "all", href: qs(), label: tr("الكل") },
          { key: "receipt", href: qs("receipt"), label: t.vouchers.types.receipt },
          { key: "disbursement", href: qs("disbursement"), label: t.vouchers.types.disbursement },
        ]} />
        <form className="flex items-center gap-2">
          {sp.type && <input type="hidden" name="type" value={sp.type} />}
          <Input name="q" defaultValue={sp.q} placeholder={tr("ابحث برقم السند أو الجهة")} className="w-64 bg-white" />
          <Button type="submit" variant="outline">{t.common.apply}</Button>
        </form>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.vouchers.voucherNumber}</TableHead>
              <TableHead>{t.common.date}</TableHead>
              <TableHead>{t.vouchers.type}</TableHead>
              <TableHead>{t.vouchers.party}</TableHead>
              <TableHead>{t.common.description}</TableHead>
              <TableHead className="text-end">{t.folio.amount}</TableHead>
              <TableHead>{t.common.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vouchers.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8">
                  <EmptyState
                    title={tr("سجل سندات القبض والصرف فارغ")}
                    description={tr("لم يتم إصدار أي سند قبض أو صرف بعد. يمكنك تسجيل سند قبض جديد من النزلاء أو سند صرف للموردين.")}
                    actionHref="/vouchers/new?type=receipt"
                    actionLabel={tr("إصدار سند قبض جديد")}
                    icon={Receipt}
                  />
                </TableCell>
              </TableRow>
            )}
            {shown.rows.map((v) => (
              <ExpandableRow kind="voucher" id={v.id} colSpan={7} key={v.id} className={v.status === "voided" ? "opacity-60" : ""}>
                <TableCell><ExpandMark /><Link href={`/vouchers/${v.id}`} className="num font-semibold text-ink">{v.voucher_number}</Link></TableCell>
                <TableCell className="num">{v.payment_date}</TableCell>
                <TableCell><Badge variant={v.voucher_type === "receipt" ? "success" : "warning"}>{t.vouchers.types[v.voucher_type]}</Badge></TableCell>
                <TableCell>{v.party_name ? <div className="max-w-52"><EntityCell name={v.party_name} /></div> : <span className="text-slate-400"></span>}</TableCell>
                <TableCell className="cell-fluid"><DocText text={v.description} /></TableCell>
                <TableCell className={`text-end font-semibold ${v.voucher_type === "receipt" ? "text-success" : "text-ink"}`}><Money value={v.amount} locale={locale} /></TableCell>
                <TableCell><Badge variant={v.status === "voided" ? "destructive" : "secondary"}>{t.vouchers.statuses[v.status]}</Badge></TableCell>
              </ExpandableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Pager page={shown.page} pages={shown.pages} total={vouchers.length} basePath="/vouchers" params={{ type: sp.type, q: sp.q }} />
    </>
  );
}

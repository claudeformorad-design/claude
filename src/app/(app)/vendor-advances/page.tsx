import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { sumMoney, toMoney } from "@/lib/accounting/money";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { HandCoins, Hourglass } from "lucide-react";
import { ApplyAdvanceForm, VendorAdvanceForm } from "../_ledger/forms";

/** عربون الموردين: دفعات مقدمة قبل الفاتورة، ثم تطبيقها على فواتير المورد عند وصولها */
export default async function VendorAdvancesPage() {
  const ctx = await requireAppContext(PERMISSIONS.paymentsView);
  const { locale, t } = await getI18n();
  const h = ctx.hotel.id;
  const [advances, vendors, methods, bills, payments] = await Promise.all([
    ctx.supabase.from("vendor_advances").select("id, vendor_id, payment_id, amount::text, applied_amount::text, status, created_at").eq("hotel_id", h).order("created_at", { ascending: false }),
    ctx.supabase.from("vendors").select("id, code, name_ar, name_en, is_active").eq("hotel_id", h).order("code"),
    ctx.supabase.from("payment_methods").select("id, name_ar, name_en, kind, currency_code, is_active").eq("hotel_id", h).order("code"),
    ctx.supabase.from("vendor_bills").select("id, vendor_id, bill_number, total::text, amount_paid::text, status").eq("hotel_id", h).in("status", ["open", "partially_paid"]).order("bill_date"),
    ctx.supabase.from("payments").select("id, voucher_number, payment_date, reference").eq("hotel_id", h).eq("party_type", "vendor"),
  ]);
  raise(advances.error); raise(vendors.error); raise(methods.error); raise(bills.error); raise(payments.error);
  const name = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;
  const vendorBy = new Map((vendors.data ?? []).map((v) => [v.id, v]));
  const payBy = new Map((payments.data ?? []).map((p) => [p.id, p]));
  const list = advances.data ?? [];
  const open = list.filter((a) => a.status === "open");
  const remaining = (a: (typeof list)[number]) => toMoney(a.amount).minus(toMoney(a.applied_amount));
  const canPay = ctx.can(PERMISSIONS.paymentsDisbursement);

  return (
    <>
      <PageHeader title={tr("عربون الموردين")} />
      <p className="max-w-3xl text-[15px] leading-relaxed text-slate-600">
        {tr("ادفع للمورد مقدمًا قبل وصول فاتورته، فيُقيَّد العربون أصلًا في «دفعات مقدمة للموردين». عند وصول الفاتورة طبّق العربون عليها فيقل المستحق للمورد.")}
      </p>
      <StatGrid>
        <Stat currency={ctx.hotel.base_currency} icon={HandCoins} tone="clay" label={tr("عربون لم يُطبَّق")} value={<Money value={sumMoney(open.map((a) => remaining(a).toString()))} locale={locale} />} hint={tr("{0} عربون", open.length)} />
        <Stat icon={Hourglass} tone="ink" label={tr("فواتير مفتوحة للموردين")} value={<span className="num">{(bills.data ?? []).length}</span>} />
      </StatGrid>
      {canPay && (
        <Card className="space-y-2 p-4">
          <p className="font-semibold">{tr("عربون جديد")}</p>
          <VendorAdvanceForm today={todayInTimeZone(ctx.hotel.timezone)} errors={t.errors}
            vendors={(vendors.data ?? []).filter((v) => v.is_active).map((v) => ({ id: v.id, label: `${v.code} ${name(v)}` }))}
            methods={(methods.data ?? []).filter((m) => m.is_active && !m.currency_code && ["cash", "bank_transfer", "e_wallet", "card"].includes(m.kind)).map((m) => ({ id: m.id, label: name(m) }))} />
        </Card>
      )}
      {list.length === 0 ? (
        <EmptyState icon={HandCoins} title={tr("لا عربون بعد")} description={tr("سجّل أول دفعة مقدمة لمورد من النموذج أعلاه.")} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{tr("السند")}</TableHead><TableHead>{tr("المورد")}</TableHead><TableHead>{tr("التاريخ")}</TableHead>
              <TableHead className="text-end">{tr("المبلغ")}</TableHead><TableHead className="text-end">{tr("المتبقي")}</TableHead><TableHead>{tr("الحالة")}</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {list.map((a) => {
                const pay = payBy.get(a.payment_id), v = vendorBy.get(a.vendor_id);
                const vb = (bills.data ?? []).filter((b) => b.vendor_id === a.vendor_id)
                  .map((b) => ({ id: b.id, label: `${b.bill_number} ${toMoney(b.total).minus(toMoney(b.amount_paid)).toFixed(2)}`, outstanding: toMoney(b.total).minus(toMoney(b.amount_paid)).toFixed() }));
                return (
                  <TableRow key={a.id}>
                    <TableCell><Link href={`/vouchers/${a.payment_id}`} className="num text-action">{pay?.voucher_number ?? ""}</Link>{pay?.reference && <p className="text-[13px] text-slate-500">{pay.reference}</p>}</TableCell>
                    <TableCell>{v ? name(v) : ""}</TableCell>
                    <TableCell className="num">{pay?.payment_date ?? ""}</TableCell>
                    <TableCell className="text-end"><Money value={a.amount} locale={locale} /></TableCell>
                    <TableCell className="text-end"><Money value={remaining(a)} locale={locale} /></TableCell>
                    <TableCell>{a.status === "open" ? <Badge variant="info">{tr("مفتوح")}</Badge> : a.status === "applied" ? <Badge variant="success">{tr("طُبّق بالكامل")}</Badge> : <Badge variant="destructive">{tr("ملغى")}</Badge>}</TableCell>
                    <TableCell>{a.status === "open" && canPay && <ApplyAdvanceForm advanceId={a.id} bills={vb} max={remaining(a).toFixed()} errors={t.errors} />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}

import Link from "@/components/link";
import { CodeName, DocText } from "@/components/ui/code-text";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PrintButton } from "../../invoices/[id]/print-button";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toMoney, sumMoney } from "@/lib/accounting/money";
import { getVoucher } from "@/services/vouchers.service";
import { getI18n } from "@/i18n/server";
import { VoidVoucher } from "./void-voucher";

export default async function VoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.paymentsView);
  const { locale, t } = await getI18n();
  const detail = await getVoucher(ctx.supabase, ctx.hotel.id, id);
  if (!detail) notFound();
  const { voucher: v, allocations } = detail;
  const [method, counter] = await Promise.all([
    ctx.supabase.from("payment_methods").select("name_ar, name_en").eq("id", v.payment_method_id).single(),
    v.counter_account_id ? ctx.supabase.from("chart_of_accounts").select("code, name_ar, name_en").eq("id", v.counter_account_id).single() : null,
  ]);
  const name = (x: { name_ar: string; name_en: string | null } | null | undefined) => (x ? (locale === "en" && x.name_en) || x.name_ar : "");
  const unallocated = toMoney(v.amount).minus(sumMoney(allocations.map((a) => a.amount)));

  const meta: [string, React.ReactNode][] = [
    [t.common.date, <span key="d" className="num">{v.payment_date}</span>],
    [t.vouchers.party, v.party_name ?? ""],
    [t.folio.method, name(method.data)],
    [t.folio.amount, <Money key="a" value={v.amount} locale={locale} />],
    [t.common.reference, v.reference ?? ""],
    [t.common.description, v.description && <DocText key="desc" text={v.description} />],
    [t.vouchers.counterAccount, counter?.data && <CodeName key="ca" label={`${counter.data.code} ${name(counter.data)}`} />],
  ];

  return (
    <>
      <PageHeader
        title={`${t.vouchers.types[v.voucher_type]} ${v.voucher_number}`}
        actions={<div className="flex items-center gap-2"><Badge variant={v.status === "voided" ? "destructive" : "success"}>{t.vouchers.statuses[v.status]}</Badge><PrintButton label="طباعة السند" /></div>}
      />
      <Card className="mb-6">
        <CardContent className="grid gap-x-8 gap-y-5 p-6 text-sm sm:grid-cols-3">
          <div className="sm:col-span-3 flex items-center justify-between rounded-lg bg-panel px-5 py-4">
            <span className="text-[16.5px] text-slate-600">{t.folio.amount}</span>
            <span className={`text-[30px] font-bold ${v.voucher_type === "receipt" ? "text-success" : "text-ink"}`}><Money value={v.amount} locale={locale} /></span>
          </div>
          {meta.map(([label, value]) => (
            <div key={label} className="border-s-2 border-line ps-3"><p className="text-[15.5px] text-slate-500">{label}</p><div className="mt-0.5 font-semibold text-ink">{value}</div></div>
          ))}
          {v.journal_entry_id && (
            <div className="border-s-2 border-line ps-3"><p className="text-[15.5px] text-slate-500">{t.journal.entry}</p><Link className="mt-0.5 block font-semibold text-accent1" href={`/journal/${v.journal_entry_id}`}>{t.journal.entry}</Link></div>
          )}
          {v.status === "voided" && (
            <div className="sm:col-span-2"><p className="text-muted-foreground">{t.vouchers.voidedBecause}</p><p>{v.void_reason}</p></div>
          )}
        </CardContent>
      </Card>

      {allocations.length > 0 && (
        <Card className="mb-6">
          <CardContent className="space-y-2 p-5 text-sm">
            <p className="font-medium">{t.vouchers.allocations}</p>
            {allocations.map((a) => (
              <p key={a.invoice_id}>
                <Link href={`/invoices/${a.invoice_id}`} className="num text-primary">{a.invoice_number}</Link> بمبلغ <Money value={a.amount} locale={locale} />
              </p>
            ))}
            {v.voucher_type === "receipt" && v.party_type === "customer" && (
              <p className="text-muted-foreground">{t.vouchers.unallocated}: <Money value={unallocated} locale={locale} /></p>
            )}
          </CardContent>
        </Card>
      )}

      {v.status === "posted" && (
        <VoidVoucher id={v.id} t={{ vouchers: t.vouchers, errors: t.errors }} request={!ctx.can(PERMISSIONS.paymentsVoid)} />
      )}
    </>
  );
}

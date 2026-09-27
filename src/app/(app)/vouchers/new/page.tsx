import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import { listOpenInvoices } from "@/services/invoices.service";
import { listPaymentMethods } from "@/services/revenue-settings.service";
import { getI18n } from "@/i18n/server";
import { VoucherForm } from "./voucher-form";

const CONTROL_KEYS = new Set(["guest_ledger", "ar_control", "guest_deposits", "ap_control"]);

export default async function NewVoucherPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const type = (await searchParams).type === "disbursement" ? "disbursement" : "receipt";
  const ctx = await requireAppContext(type === "receipt" ? PERMISSIONS.paymentsReceipt : PERMISSIONS.paymentsDisbursement);
  const { locale, t } = await getI18n();
  const [methods, accounts, departments, customers, invoices] = await Promise.all([
    listPaymentMethods(ctx.supabase, ctx.hotel.id),
    listAccounts(ctx.supabase, ctx.hotel.id),
    listDepartments(ctx.supabase, ctx.hotel.id),
    ctx.supabase.from("customers").select("id, code, name_ar, name_en").eq("hotel_id", ctx.hotel.id).order("code"),
    ctx.can(PERMISSIONS.invoicesView) ? listOpenInvoices(ctx.supabase, ctx.hotel.id) : Promise.resolve([]),
  ]);
  const name = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;

  return (
    <>
      <PageHeader title={type === "receipt" ? t.vouchers.newReceipt : t.vouchers.newDisbursement} description={t.vouchers.subtitle} />
      <Card><CardContent className="p-5">
        <VoucherForm
          t={{ vouchers: t.vouchers, folio: t.folio, invoices: t.invoices, common: t.common, errors: t.errors }}
          locale={locale}
          type={type}
          today={todayInTimeZone(ctx.hotel.timezone)}
          methods={methods.filter((m) => m.is_active && m.kind !== "city_ledger" && !m.currency_code).map((m) => ({ id: m.id, label: name(m) }))}
          customers={(customers.data ?? []).map((c) => ({ id: c.id, label: `${c.code} ${name(c)}` }))}
          accounts={accounts.filter((a) => a.is_postable && a.is_active && !CONTROL_KEYS.has(a.system_key ?? "")).map((a) => ({ id: a.id, label: `${a.code} ${name(a)}` }))}
          departments={departments.filter((d) => d.is_active).map((d) => ({ id: d.id, label: `${d.code} ${name(d)}` }))}
          invoices={invoices.filter((i) => i.customer_id).map((i) => ({
            id: i.id, number: i.invoice_number, customer_id: i.customer_id, amount_due: i.amount_due, amount_paid: i.amount_paid, issue_date: i.issue_date,
          }))}
        />
      </CardContent></Card>
    </>
  );
}

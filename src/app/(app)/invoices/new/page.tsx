import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { listChargeCodes, listTaxRates } from "@/services/revenue-settings.service";
import { getI18n } from "@/i18n/server";
import { DirectInvoiceForm } from "./direct-invoice-form";

export default async function NewDirectInvoicePage() {
  const ctx = await requireAppContext(PERMISSIONS.invoicesCreate);
  const { locale, t } = await getI18n();
  const [codes, taxes, customers, currency] = await Promise.all([
    listChargeCodes(ctx.supabase, ctx.hotel.id),
    listTaxRates(ctx.supabase, ctx.hotel.id),
    ctx.supabase.from("customers").select("id, code, name_ar, name_en").eq("hotel_id", ctx.hotel.id).eq("allow_credit", true).eq("is_active", true).order("code"),
    ctx.supabase.from("currencies").select("decimals").eq("code", ctx.hotel.base_currency).single(),
  ]);
  const taxById = new Map(taxes.map((x) => [x.id, x]));
  const name = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;

  return (
    <>
      <PageHeader title={t.invoices.newDirect} />
      <Card><CardContent className="p-5">
        <DirectInvoiceForm
          t={{ invoices: t.invoices, folio: t.folio, common: t.common, errors: t.errors }}
          locale={locale}
          decimals={currency.data?.decimals ?? 2}
          today={todayInTimeZone(ctx.hotel.timezone)}
          customers={(customers.data ?? []).map((c) => ({ id: c.id, label: `${c.code} — ${name(c)}` }))}
          chargeCodes={codes.filter((c) => c.is_active).map((c) => ({
            id: c.id, label: `${c.code} — ${name(c)}`, price: c.default_price, inclusive: c.price_includes_tax,
            taxes: c.tax_rate_ids.map((id) => taxById.get(id)).filter((x) => !!x).map((x) => ({ id: x!.id, rate: x!.rate, is_compound: x!.is_compound })),
          }))}
        />
      </CardContent></Card>
    </>
  );
}

import { localName, localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";
import { FormDialog } from "@/components/ui/dialog";
import { CodeName } from "@/components/ui/code-text";
import { Coins } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { latestRates, listCurrencies, listExchangeRates } from "@/services/cashier.service";
import { listPaymentMethods } from "@/services/revenue-settings.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../../_assets/simple-form";
import { setExchangeRateAction } from "../../cashier/actions";

/**
 * العملات وأسعار الصرف: الفندق يقبض بالعملة الأجنبية (دولار، ريال سعودي...) عبر طريقة دفع بعملتها،
 * والمبلغ يُقيَّد بما يعادله بالعملة الأساسية بسعر اليوم (آخر سعر مسجّل في التاريخ أو قبله).
 */
export default async function CurrenciesPage() {
  const ctx = await requireAppContext(PERMISSIONS.currenciesManage);
  const { t } = await getI18n();
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [currencies, rates, methods] = await Promise.all([
    listCurrencies(ctx.supabase), listExchangeRates(ctx.supabase, ctx.hotel.id), listPaymentMethods(ctx.supabase, ctx.hotel.id),
  ]);
  const base = ctx.hotel.base_currency;
  const foreign = currencies.filter((c) => c.code !== base);
  const current = latestRates(rates, today);
  const used = new Set(methods.filter((m) => m.currency_code && m.is_active).map((m) => m.currency_code!));
  const shown = foreign.filter((c) => used.has(c.code) || current.has(c.code));
  const nameOf = new Map(currencies.map((c) => [c.code, localName(c)]));
  const fmt = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 6 });

  return (
    <>
      <PageHeader title={tr("العملات وأسعار الصرف")}
        actions={
          <FormDialog label={tr("تسجيل سعر صرف")} title={tr("تسجيل سعر صرف")} description={tr("تسجيل سعر لنفس اليوم يستبدله")}>
            <SimpleForm columns={2} submitLabel={tr("حفظ السعر")} errors={t.errors} action={setExchangeRateAction}
            initial={{ currency: [...used][0] ?? (foreign.find((c) => c.code === "USD") ?? foreign[0])?.code ?? "", rate: "", date: today }}
            fields={[
              { name: "currency", label: tr("العملة"), options: foreign.map((c) => ({ id: c.code, label: `${c.code} ${localNameOf(c)}` })) },
              { name: "rate", label: tr("السعر بعملة {0} لكل وحدة", base), type: "number" },
              { name: "date", label: tr("التاريخ"), type: "date" },
            ]} />
          </FormDialog>
        } />

      <div className="space-y-6">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>{tr("أسعار اليوم")}</CardTitle><CardDescription>{tr("تُستخدم لتحويل المقبوضات بالعملات الأجنبية وفروقات عدّ الصندوق")}</CardDescription></CardHeader>
            {shown.length === 0 ? (
              <CardContent><EmptyState icon={Coins} title={tr("لا توجد عملات أجنبية بعد")} description={tr("سجّل سعر صرف، ثم أضف طريقة دفع بعملتها من إعدادات الإيرادات مثل نقدًا دولار.")} /></CardContent>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>{tr("العملة")}</TableHead><TableHead className="text-end">{tr("السعر الساري")}</TableHead><TableHead>{tr("منذ")}</TableHead><TableHead>{tr("طريقة دفع")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {shown.map((c) => {
                    const r = current.get(c.code);
                    return (
                      <TableRow key={c.code}>
                        <TableCell><CodeName label={`${c.code} ${localNameOf(c)}`} /></TableCell>
                        <TableCell className="num text-end text-[17px] font-semibold">{r ? fmt(r.rate) : <Badge variant="warning">{tr("بلا سعر")}</Badge>}</TableCell>
                        <TableCell className="num">{r ? (r.date === today ? tr("اليوم") : r.date) : ""}</TableCell>
                        <TableCell>{used.has(c.code) ? <Badge variant="success">{tr("مفعّلة")}</Badge> : <span className="text-slate-400"></span>}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader><CardTitle>{tr("سجل الأسعار")}</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>{tr("التاريخ")}</TableHead><TableHead>{tr("العملة")}</TableHead><TableHead className="text-end">{tr("السعر")}</TableHead></TableRow></TableHeader>
              <TableBody>
                {rates.length === 0 && <TableRow><TableCell colSpan={3} className="py-8 text-center text-slate-500">{tr("لم تُسجَّل أسعار بعد")}</TableCell></TableRow>}
                {rates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="num">{r.rate_date}</TableCell>
                    <TableCell><CodeName label={`${r.currency_code} ${nameOf.get(r.currency_code) ?? ""}`} /></TableCell>
                    <TableCell className="num text-end">{fmt(r.rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

      </div>
    </>
  );
}

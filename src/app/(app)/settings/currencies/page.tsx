import { FormDialog } from "@/components/ui/dialog";
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
  const nameOf = new Map(currencies.map((c) => [c.code, c.name_ar]));
  const fmt = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 6 });

  return (
    <>
      <PageHeader title="العملات وأسعار الصرف" description={`العملة الأساسية ${nameOf.get(base) ?? base}، والسعر هو ما تساويه وحدة واحدة من العملة الأجنبية بالعملة الأساسية`}
        actions={
          <FormDialog label="تسجيل سعر صرف" title="تسجيل سعر صرف" description="تسجيل سعر لنفس اليوم يستبدله">
            <SimpleForm columns={2} submitLabel="حفظ السعر" errors={t.errors} action={setExchangeRateAction}
            initial={{ currency: [...used][0] ?? (foreign.find((c) => c.code === "USD") ?? foreign[0])?.code ?? "", rate: "", date: today }}
            fields={[
              { name: "currency", label: "العملة", options: foreign.map((c) => ({ id: c.code, label: `${c.code} ${c.name_ar}` })) },
              { name: "rate", label: `السعر بعملة ${base} لكل وحدة`, type: "number" },
              { name: "date", label: "التاريخ", type: "date" },
            ]} />
          </FormDialog>
        } />

      <div className="space-y-6">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>أسعار اليوم</CardTitle><CardDescription>تُستخدم لتحويل المقبوضات بالعملات الأجنبية وفروقات عدّ الصندوق</CardDescription></CardHeader>
            {shown.length === 0 ? (
              <CardContent><EmptyState icon={Coins} title="لا توجد عملات أجنبية بعد" description="سجّل سعر صرف، ثم أضف طريقة دفع بعملتها من إعدادات الإيرادات مثل نقدًا دولار." /></CardContent>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>العملة</TableHead><TableHead className="text-end">السعر الساري</TableHead><TableHead>منذ</TableHead><TableHead>طريقة دفع</TableHead></TableRow></TableHeader>
                <TableBody>
                  {shown.map((c) => {
                    const r = current.get(c.code);
                    return (
                      <TableRow key={c.code}>
                        <TableCell><span className="num font-bold">{c.code}</span> <span className="text-slate-500">{c.name_ar}</span></TableCell>
                        <TableCell className="num text-end text-[17px] font-semibold">{r ? fmt(r.rate) : <Badge variant="warning">بلا سعر</Badge>}</TableCell>
                        <TableCell className="num">{r ? (r.date === today ? "اليوم" : r.date) : ""}</TableCell>
                        <TableCell>{used.has(c.code) ? <Badge variant="success">مفعّلة</Badge> : <span className="text-slate-400"></span>}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader><CardTitle>سجل الأسعار</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>العملة</TableHead><TableHead className="text-end">السعر</TableHead></TableRow></TableHeader>
              <TableBody>
                {rates.length === 0 && <TableRow><TableCell colSpan={3} className="py-8 text-center text-slate-500">لم تُسجَّل أسعار بعد</TableCell></TableRow>}
                {rates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="num">{r.rate_date}</TableCell>
                    <TableCell><span className="num font-semibold">{r.currency_code}</span> <span className="text-slate-500">{nameOf.get(r.currency_code)}</span></TableCell>
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

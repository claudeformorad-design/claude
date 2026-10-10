import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { Coins } from "lucide-react";
import { FxRevaluationForm } from "../_ledger/forms";

/** إعادة تقييم أرصدة الصناديق والبنوك بالعملات الأجنبية بسعر اليوم */
export default async function FxRevaluationPage() {
  const ctx = await requireAppContext(PERMISSIONS.journalPost);
  const { locale, t } = await getI18n();
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [preview, history] = await Promise.all([
    ctx.supabase.rpc("fx_revaluation_preview", { p_hotel_id: ctx.hotel.id, p_date: today }),
    ctx.supabase.from("fx_revaluations").select("id, revaluation_date, total_gain::text, total_loss::text, journal_entry_id").eq("hotel_id", ctx.hotel.id).order("created_at", { ascending: false }).limit(30),
  ]);
  raise(preview.error); raise(history.error);
  const rows = (preview.data ?? []).map((r) => ({ id: r.payment_method_id, label: `${r.method_name} ${r.account_code}`, currency: r.currency_code, book: String(r.book_balance), rate: r.rate == null ? null : String(r.rate), shared: r.shared }));
  return (
    <>
      <PageHeader title={tr("إعادة تقييم العملات")} />
      <p className="max-w-3xl text-[15px] leading-relaxed text-slate-600">
        {tr("لكل صندوق أو بنك بعملة أجنبية، أدخل الرصيد الفعلي بالعملة (من العدّ أو كشف البنك). يُقيَّم بسعر الصرف المسجل لليوم، والفرق عن الرصيد الدفتري يُقيَّد أرباحًا أو خسائر فروقات عملة. يجب أن يكون لكل عملة حساب خاص بها في دليل الحسابات.")}
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={Coins} title={tr("لا صناديق بعملات أجنبية")} description={tr("أضف طريقة دفع بعملة أجنبية على حساب خاص بها من إعدادات الإيرادات، وسجّل سعر صرفها.")} />
      ) : (
        <Card className="p-4"><FxRevaluationForm rows={rows} today={today} errors={t.errors} /></Card>
      )}
      {(history.data ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{tr("سجل إعادة التقييم")}</h2>
          <Card className="overflow-hidden"><Table>
            <TableHeader><TableRow><TableHead>{tr("التاريخ")}</TableHead><TableHead className="text-end">{tr("الأرباح")}</TableHead><TableHead className="text-end">{tr("الخسائر")}</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{(history.data ?? []).map((x) => (
              <TableRow key={x.id}>
                <TableCell className="num">{x.revaluation_date}</TableCell>
                <TableCell className="text-end"><Money value={x.total_gain} locale={locale} /></TableCell>
                <TableCell className="text-end"><Money value={x.total_loss} locale={locale} /></TableCell>
                <TableCell className="text-end">{x.journal_entry_id && <Link href={`/journal/${x.journal_entry_id}`} className="text-action">{t.journal.entry}</Link>}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></Card>
        </section>
      )}
    </>
  );
}

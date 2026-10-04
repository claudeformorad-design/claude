import { notFound } from "next/navigation";
import { DocHeader, PageStyle, Signatures } from "@/components/reports/doc-header";
import { StatementTable, statementKind } from "@/components/reports/statement-table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime, isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { formatMoney } from "@/lib/accounting/money";
import { docMeta } from "@/lib/export/plain-report";
import { plainText } from "@/lib/text";
import { customerStatement } from "@/services/statements.service";
import { PrintToolbar } from "../../reports/[report]/print-toolbar";

export default async function PrintCustomerStatementPage({ params, searchParams }: {
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
  const meta = docMeta(ctx.hotel, formatDateTime(new Date().toISOString(), ctx.hotel.timezone), ctx.profile?.full_name);
  const c = s.customer;
  return (
    <div className="min-h-screen bg-[#f1f0ec] py-10 print:bg-white print:py-0">
      <title>{`كشف حساب ${c.name_ar}`}</title>
      <PrintToolbar />
      <article className="report-doc mx-auto bg-white text-ink">
        <PageStyle hotelName={meta.hotelName} />
        <DocHeader meta={meta} />
        <section className="grid gap-6 pt-6 pb-5 sm:grid-cols-[1fr_auto]">
          <div>
            <h1 className="text-[30px] font-bold leading-tight">كشف حساب عميل</h1>
            <p className="mt-2 text-[15px] text-slate-600">من <span className="num">{from}</span> إلى <span className="num">{to}</span></p>
          </div>
          <dl className="grid grid-cols-[auto_auto] content-start gap-x-5 gap-y-1 text-[13px]">
            <dt className="text-slate-500">العميل</dt><dd className="font-semibold">{c.name_ar}</dd>
            <dt className="text-slate-500">الرمز</dt><dd className="num font-semibold">{c.code}</dd>
            {c.tax_number && <><dt className="text-slate-500">الرقم الضريبي</dt><dd className="num font-semibold">{c.tax_number}</dd></>}
            {c.phone && <><dt className="text-slate-500">الهاتف</dt><dd className="num font-semibold" dir="ltr">{c.phone}</dd></>}
          </dl>
        </section>
        <StatementTable decimals={decimals} opening={s.opening} debit={s.debit} credit={s.credit} closing={s.closing}
          rows={s.lines.map((l) => ({ ...l, label: statementKind(l.kind), description: plainText(l.description) }))} />
        {!s.pendingFolios.isZero() && (
          <p className="mt-5 rounded-lg bg-panel px-4 py-2.5 text-[13px]">
            إضافة إلى الرصيد: <span className="num font-semibold">{formatMoney(s.pendingFolios, { locale: "ar", decimals })}</span> محوّلة على حساب العميل في فوليوهات مفتوحة، تدخل الكشف عند إصدار فواتيرها.
          </p>
        )}
        <Signatures names={["المحاسب", "المدير المالي", "توقيع العميل بالمصادقة"]} />
      </article>
    </div>
  );
}

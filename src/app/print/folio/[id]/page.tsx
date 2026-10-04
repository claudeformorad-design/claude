import { notFound } from "next/navigation";
import { DocHeader, PageStyle, Signatures } from "@/components/reports/doc-header";
import { StatementTable, type StatementRow } from "@/components/reports/statement-table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/accounting/fiscal";
import { ZERO, formatMoney, toMoney } from "@/lib/accounting/money";
import { docMeta } from "@/lib/export/plain-report";
import { plainText } from "@/lib/text";
import { getFolio } from "@/services/folio.service";
import { getI18n } from "@/i18n/server";
import { PrintToolbar } from "../../reports/[report]/print-toolbar";

/**
 * كشف حساب النزيل: كل الرسوم والمدفوعات النافذة على الفوليو برصيد جارٍ.
 * الحركات الملغاة وقيود إلغائها لا تظهر لأن أثرهما معًا صفر.
 */
export default async function PrintFolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.folioView);
  const { t } = await getI18n();
  const detail = await getFolio(ctx.supabase, ctx.hotel.id, id);
  if (!detail) notFound();
  const { folio } = detail;
  const decimals = (await ctx.supabase.from("currencies").select("decimals").eq("code", ctx.hotel.base_currency).single()).data?.decimals ?? 2;
  const meta = docMeta(ctx.hotel, formatDateTime(new Date().toISOString(), ctx.hotel.timezone), ctx.profile?.full_name);

  const rows: StatementRow[] = [];
  let running = ZERO;
  let debit = ZERO;
  let credit = ZERO;
  for (const x of detail.transactions) {
    const effect = toMoney(x.ledger_effect);
    if (x.direction !== 1 || x.voided_by_id || effect.isZero()) continue;
    running = running.plus(effect);
    if (effect.isNegative()) credit = credit.minus(effect); else debit = debit.plus(effect);
    rows.push({
      date: x.business_date, number: "", label: t.folio.txnTypes[x.txn_type], description: plainText(x.description),
      debit: effect.isNegative() ? ZERO : effect, credit: effect.isNegative() ? effect.negated() : ZERO, balance: running,
    });
  }
  const deposits = toMoney(detail.deposits);
  const info: [string, React.ReactNode][] = [
    ["النزيل", folio.guest_name],
    ...(folio.room_number ? [["الغرفة", <span key="r" className="num">{folio.room_number}</span>] as [string, React.ReactNode]] : []),
    ...(folio.arrival_date ? [["الإقامة", <span key="s">من <span className="num">{folio.arrival_date}</span>{folio.departure_date && <> إلى <span className="num">{folio.departure_date}</span></>}</span>] as [string, React.ReactNode]] : []),
    ["الحالة", t.folio.statuses[folio.status]],
  ];

  return (
    <div className="min-h-screen bg-[#f1f0ec] py-10 print:bg-white print:py-0">
      <title>{`كشف حساب النزيل ${folio.guest_name}`}</title>
      <PrintToolbar />
      <article className="report-doc mx-auto bg-white text-ink">
        <PageStyle hotelName={meta.hotelName} />
        <DocHeader meta={meta} />
        <section className="grid gap-6 pt-6 pb-5 sm:grid-cols-[1fr_auto]">
          <div>
            <h1 className="text-[30px] font-bold leading-tight">كشف حساب النزيل</h1>
            <p className="mt-2 text-[15px] text-slate-600">الفوليو <span className="num font-semibold text-ink">{folio.folio_number}</span></p>
          </div>
          <dl className="grid grid-cols-[auto_auto] content-start gap-x-5 gap-y-1 text-[13px]">
            {info.flatMap(([k, v]) => [<dt key={`${k}-t`} className="text-slate-500">{k}</dt>, <dd key={`${k}-d`} className="font-semibold">{v}</dd>])}
          </dl>
        </section>
        <StatementTable decimals={decimals} rows={rows} opening={ZERO} debit={debit} credit={credit} closing={running} />
        {!deposits.isZero() && (
          <p className="mt-5 rounded-lg bg-panel px-4 py-2.5 text-[13px]">
            عربون محفوظ للنزيل لم يُطبَّق بعد: <span className="num font-semibold">{formatMoney(deposits, { locale: "ar", decimals })}</span>، ويُخصم من الرصيد عند المغادرة.
          </p>
        )}
        <Signatures names={["موظف الاستقبال", "توقيع النزيل"]} />
      </article>
    </div>
  );
}

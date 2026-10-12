import { localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";
import { notFound } from "next/navigation";
import { DocHeader, PageStyle, Signatures } from "@/components/reports/doc-header";
import { StatementTable, statementKind } from "@/components/reports/statement-table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime, isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import { docMeta } from "@/lib/export/plain-report";
import { plainText } from "@/lib/text";
import { vendorStatement } from "@/services/statements.service";
import { PrintToolbar } from "../../reports/[report]/print-toolbar";

export default async function PrintVendorStatementPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.billsView);
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const to = sp.to && isIsoDate(sp.to) ? sp.to : today;
  const from = sp.from && isIsoDate(sp.from) && sp.from <= to ? sp.from : `${to.slice(0, 4)}-01-01`;
  const s = await vendorStatement(ctx.supabase, ctx.hotel.id, id, from, to);
  if (!s) notFound();
  const decimals = (await ctx.supabase.from("currencies").select("decimals").eq("code", ctx.hotel.base_currency).single()).data?.decimals ?? 2;
  const meta = docMeta(ctx.hotel, formatDateTime(new Date().toISOString(), ctx.hotel.timezone), ctx.profile?.full_name);
  const v = s.vendor;
  return (
    <div className="min-h-screen bg-[#f1f0ec] py-10 print:bg-white print:py-0">
      <title>{tr("كشف حساب {0}", v.name_ar)}</title>
      <PrintToolbar />
      <article className="report-doc mx-auto bg-white text-ink">
        <PageStyle hotelName={meta.hotelName} />
        <DocHeader meta={meta} />
        <section className="grid gap-6 pt-6 pb-5 sm:grid-cols-[1fr_auto]">
          <div>
            <h1 className="text-[30px] font-bold leading-tight">{tr("كشف حساب مورد")}</h1>
            <p className="mt-2 text-[15px] text-slate-600">{tr("من")}{" "}<span className="num">{from}</span>{" "}{tr("إلى")}{" "}<span className="num">{to}</span></p>
          </div>
          <dl className="grid grid-cols-[auto_auto] content-start gap-x-5 gap-y-1 text-[13px]">
            <dt className="text-slate-500">{tr("المورد")}</dt><dd className="font-semibold">{localNameOf(v)}</dd>
            <dt className="text-slate-500">{tr("الرمز")}</dt><dd className="num font-semibold">{v.code}</dd>
            {v.tax_number && <><dt className="text-slate-500">{tr("الرقم الضريبي")}</dt><dd className="num font-semibold">{v.tax_number}</dd></>}
            {v.phone && <><dt className="text-slate-500">{tr("الهاتف")}</dt><dd className="num font-semibold" dir="ltr">{v.phone}</dd></>}
          </dl>
        </section>
        <StatementTable party="vendor" decimals={decimals} opening={s.opening} debit={s.debit} credit={s.credit} closing={s.closing}
          rows={s.lines.map((l) => ({ ...l, label: statementKind(l.kind), description: plainText(l.description) }))} />
        <Signatures names={[tr("المحاسب"), tr("المدير المالي"), tr("توقيع المورد بالمصادقة")]} />
      </article>
    </div>
  );
}

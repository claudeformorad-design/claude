import { localNameOf } from "@/lib/local-name";
import { currentLocale, tr } from "@/i18n/tr";
import { notFound } from "next/navigation";
import { DocHeader, PageStyle, Signatures } from "@/components/reports/doc-header";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/accounting/fiscal";
import { formatMoney } from "@/lib/accounting/money";
import { amountInArabicWords, amountInEnglishWords } from "@/lib/accounting/tafqeet";
import { currencyName } from "@/lib/currency-name";
import { docMeta } from "@/lib/export/plain-report";
import { plainText } from "@/lib/text";
import { getVoucher } from "@/services/vouchers.service";
import { PrintToolbar } from "../../reports/[report]/print-toolbar";

/** سند القبض أو الصرف للطباعة: المبلغ بالأرقام والحروف، والطرف، وطريقة الدفع، والتخصيص على الفواتير، والتوقيعات */
export default async function PrintVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.paymentsView);
  const detail = await getVoucher(ctx.supabase, ctx.hotel.id, id);
  if (!detail) notFound();
  const { voucher: v, allocations } = detail;
  const [method, customer, counter, currency] = await Promise.all([
    ctx.supabase.from("payment_methods").select("name_ar, name_en").eq("id", v.payment_method_id).single(),
    v.customer_id ? ctx.supabase.from("customers").select("code, name_ar, name_en").eq("id", v.customer_id).single() : null,
    v.counter_account_id ? ctx.supabase.from("chart_of_accounts").select("code, name_ar, name_en").eq("id", v.counter_account_id).single() : null,
    ctx.supabase.from("currencies").select("decimals").eq("code", ctx.hotel.base_currency).single(),
  ]);
  const receipt = v.voucher_type === "receipt";
  const title = receipt ? tr("سند قبض") : tr("سند صرف");
  const decimals = currency.data?.decimals ?? 2;
  const party = v.party_name || customer?.data?.name_ar || "";
  const meta = docMeta(ctx.hotel, formatDateTime(new Date().toISOString(), ctx.hotel.timezone), ctx.profile?.full_name);

  const rows: [string, React.ReactNode][] = [
    [receipt ? tr("استلمنا من") : tr("صرفنا إلى"), party],
    [tr("طريقة الدفع"), method.data?.name_ar ?? ""],
    ...(v.reference ? [[tr("المرجع"), <span key="r" dir="ltr" className="num">{v.reference}</span>] as [string, React.ReactNode]] : []),
    [tr("البيان"), plainText(v.description)],
    ...(counter?.data ? [[tr("الحساب"), `${counter.data.code} ${localNameOf(counter.data)}`] as [string, React.ReactNode]] : []),
    ...(customer?.data ? [[tr("رمز العميل"), <span key="c" className="num">{customer.data.code}</span>] as [string, React.ReactNode]] : []),
  ];

  return (
    <div className="min-h-screen bg-[#f1f0ec] py-10 print:bg-white print:py-0">
      <title>{`${title} ${v.voucher_number}`}</title>
      <PrintToolbar />
      <article className="report-doc relative mx-auto bg-white text-ink">
        <PageStyle hotelName={meta.hotelName} />
        <DocHeader meta={meta} />
        {v.status === "voided" && (
          <p className="pointer-events-none absolute inset-x-0 top-[42%] text-center text-[96px] font-bold text-urgent/15 -rotate-12 select-none">{tr("ملغى")}</p>
        )}

        <section className="flex items-end justify-between gap-6 pt-6 pb-6">
          <div>
            <h1 className="text-[30px] font-bold leading-tight">{title}</h1>
            <p className="mt-2 text-[15px] text-slate-600">{tr("رقم")}{" "}<span className="num font-semibold text-ink">{v.voucher_number}</span>{" "}{tr("بتاريخ")}{" "}<span className="num font-semibold text-ink">{v.payment_date}</span></p>
          </div>
          <div className="rounded-xl bg-ink px-6 py-4 text-white">
            <p className="text-[12.5px] opacity-75">{tr("المبلغ")}{" "}{currencyName(ctx.hotel.base_currency)}</p>
            <p className="num text-[26px] font-bold">{formatMoney(v.amount, { locale: "ar", decimals })}</p>
          </div>
        </section>

        <p className="rounded-lg bg-panel px-5 py-3.5 text-[15px] font-semibold">{(currentLocale() === "en" ? amountInEnglishWords : amountInArabicWords)(v.amount, ctx.hotel.base_currency, decimals, currencyName(ctx.hotel.base_currency))}</p>

        <dl className="mt-6 divide-y divide-line border-y border-line text-[14px]">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[9rem_1fr] gap-4 py-3">
              <dt className="text-slate-500">{label}</dt><dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>

        {allocations.length > 0 && (
          <table className="report-doc-table mt-6 w-full border-separate border-spacing-0 overflow-hidden rounded-lg text-[13px]">
            <thead><tr><th className="bg-ink px-3.5 py-2.5 text-start text-white">{tr("سداد الفاتورة")}</th><th className="bg-ink px-3.5 py-2.5 text-end text-white">{tr("المبلغ")}</th></tr></thead>
            <tbody>
              {allocations.map((a) => (
                <tr key={a.invoice_id}>
                  <td className="num border-b border-line px-3.5 py-2.5">{a.invoice_number}</td>
                  <td className="num border-b border-line px-3.5 py-2.5 text-end">{formatMoney(a.amount, { locale: "ar", decimals })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {v.status === "voided" && v.void_reason && (
          <p className="mt-6 rounded-lg bg-urgent-tint px-4 py-2.5 text-[13px] font-semibold text-urgent">{tr("أُلغي هذا السند، والسبب:")}{" "}{v.void_reason}</p>
        )}

        <Signatures names={receipt ? [tr("المستلم"), tr("المحاسب"), tr("المدير")] : [tr("المستفيد"), tr("المحاسب"), tr("المدير")]} />
      </article>
    </div>
  );
}

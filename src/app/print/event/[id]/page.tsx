import { tr } from "@/i18n/tr";
import { notFound } from "next/navigation";
import { DocHeader, PageStyle, Signatures } from "@/components/reports/doc-header";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/accounting/fiscal";
import { formatMoney, toMoney, ZERO } from "@/lib/accounting/money";
import { currencyName } from "@/lib/currency-name";
import { docMeta } from "@/lib/export/plain-report";
import { dayLabel, timeOf } from "@/lib/pms/dates";
import { EVENT_STATUS, EVENT_TYPE } from "@/lib/ops/labels";
import { baseDecimals, getEvent } from "@/services/guest-services.service";
import { PrintToolbar } from "../../reports/[report]/print-toolbar";

/** عقد المناسبة للطباعة والتوقيع: الأطراف والموعد والقاعة والبنود والخصم والشروط */
export default async function PrintEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.eventsView);
  const d = await getEvent(ctx.supabase, ctx.hotel.id, id);
  if (!d) notFound();
  const { event: e, items } = d;
  const [decimals, hall] = await Promise.all([
    baseDecimals(ctx.supabase, ctx.hotel.base_currency),
    e.hall_room_id ? ctx.supabase.from("rooms").select("room_number").eq("id", e.hall_room_id).maybeSingle() : null,
  ]);
  const meta = docMeta(ctx.hotel, formatDateTime(new Date().toISOString(), ctx.hotel.timezone), ctx.profile?.full_name);
  const money = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, { locale: "ar", decimals });
  const gross = items.reduce((s, i) => s.plus(toMoney(i.quantity).times(toMoney(i.unit_price))), ZERO);
  const net = gross.minus(toMoney(e.discount));
  const local = (ts: string) => ts.replace(" ", "T");
  const title = tr("عقد مناسبة");

  const rows: [string, React.ReactNode][] = [
    [tr("المناسبة"), `${e.title}، ${EVENT_TYPE[e.event_type]}`],
    [tr("صاحب المناسبة"), e.contact_name],
    ...(e.contact_phone ? [[tr("الجوال"), <span key="p" dir="ltr" className="num">{e.contact_phone}</span>] as [string, React.ReactNode]] : []),
    [tr("الموعد"), <span key="d">{dayLabel(local(e.starts_at).slice(0, 10), { weekday: "long", day: "numeric", month: "long", year: "numeric" })} <span className="num">{timeOf(local(e.starts_at))} {tr("إلى")} {timeOf(local(e.ends_at))}</span></span>],
    ...(hall?.data ? [[tr("القاعة"), <span key="h" className="num">{hall.data.room_number}</span>] as [string, React.ReactNode]] : []),
    [tr("عدد الحضور"), <span key="g" className="num">{e.guests_count}</span>],
  ];

  return (
    <div className="min-h-screen bg-[#f1f0ec] py-10 print:bg-white print:py-0">
      <title>{`${title} ${e.event_number}`}</title>
      <PrintToolbar />
      <article className="report-doc relative mx-auto bg-white text-ink">
        <PageStyle hotelName={meta.hotelName} />
        <DocHeader meta={meta} />
        {e.status === "cancelled" && (
          <p className="pointer-events-none absolute inset-x-0 top-[42%] text-center text-[96px] font-bold text-urgent/15 -rotate-12 select-none">{tr("ملغى")}</p>
        )}
        <section className="flex items-end justify-between gap-6 pt-6 pb-6">
          <div>
            <h1 className="text-[30px] font-bold leading-tight">{title}</h1>
            <p className="mt-2 text-[15px] text-slate-600">{tr("رقم")}{" "}<span className="num font-semibold text-ink">{e.event_number}</span>{" "}{tr("الحالة")}{" "}<span className="font-semibold text-ink">{EVENT_STATUS[e.status].label}</span></p>
          </div>
          <div className="rounded-xl bg-ink px-6 py-4 text-white">
            <p className="text-[12.5px] opacity-75">{tr("قيمة العقد")}{" "}{currencyName(ctx.hotel.base_currency)}</p>
            <p className="num text-[26px] font-bold">{money(net)}</p>
          </div>
        </section>

        <dl className="divide-y divide-line border-y border-line text-[14px]">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[9rem_1fr] gap-4 py-3"><dt className="text-slate-500">{label}</dt><dd className="font-semibold">{value}</dd></div>
          ))}
        </dl>

        <table className="report-doc-table mt-6 w-full border-separate border-spacing-0 overflow-hidden rounded-lg text-[13px]">
          <thead>
            <tr>
              <th className="bg-ink px-3.5 py-2.5 text-start text-white">{tr("البند")}</th>
              <th className="bg-ink px-3.5 py-2.5 text-end text-white">{tr("الكمية")}</th>
              <th className="bg-ink px-3.5 py-2.5 text-end text-white">{tr("السعر")}</th>
              <th className="bg-ink px-3.5 py-2.5 text-end text-white">{tr("المبلغ")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.line_no}>
                <td className="border-b border-line px-3.5 py-2.5">{i.description}</td>
                <td className="num border-b border-line px-3.5 py-2.5 text-end">{Number(i.quantity)}</td>
                <td className="num border-b border-line px-3.5 py-2.5 text-end">{money(i.unit_price)}</td>
                <td className="num border-b border-line px-3.5 py-2.5 text-end">{money(toMoney(i.quantity).times(toMoney(i.unit_price)))}</td>
              </tr>
            ))}
            {!toMoney(e.discount).isZero() && (
              <tr><td colSpan={3} className="border-b border-line px-3.5 py-2.5">{tr("الخصم")}</td><td className="num border-b border-line px-3.5 py-2.5 text-end">{money(toMoney(e.discount).negated())}</td></tr>
            )}
            <tr><td colSpan={3} className="px-3.5 py-2.5 font-bold">{tr("الإجمالي")}</td><td className="num px-3.5 py-2.5 text-end font-bold">{money(net)}</td></tr>
          </tbody>
        </table>

        <p className="mt-3 text-[13px] text-slate-500">{tr("الفاتورة الضريبية تصدر بعد تنفيذ المناسبة، ويُخصم منها ما دُفع من عربون.")}</p>

        {e.terms && (
          <section className="mt-6">
            <h2 className="mb-2 text-[15px] font-bold">{tr("الشروط")}</h2>
            <p className="whitespace-pre-line text-[14px] leading-7">{e.terms}</p>
          </section>
        )}

        <Signatures names={[tr("صاحب المناسبة"), tr("مسؤول المناسبات"), tr("المدير")]} />
      </article>
    </div>
  );
}

import { localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/accounting/money";
import { ID_TYPES } from "@/lib/pms/labels";
import { nightsBetween, nightsText, timeOf, timeRange } from "@/lib/pms/dates";
import { getGuest, getReservation } from "@/services/pms.service";
import { PrintButton } from "../../../invoices/[id]/print-button";

/** بطاقة تسجيل النزيل للطباعة والتوقيع عند الوصول */
export default async function RegistrationCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const r = await getReservation(ctx.supabase, ctx.hotel.id, id);
  if (!r) notFound();
  const g = await getGuest(ctx.supabase, ctx.hotel.id, r.guest_id);
  const hourly = r.booking_mode === "hourly";
  const nights = hourly ? 0 : nightsBetween(r.arrival_date, r.departure_date);
  const money = (v: string | number) => formatMoney(v, { locale: "ar" });
  const h = ctx.hotel;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton label={tr("طباعة البطاقة")} /></div>
      <div className="surface space-y-6 p-8 print:border-0 print:p-0">
        <header className="flex items-start justify-between border-b border-line pb-4">
          <div>
            <h1 className="text-[24px] font-bold text-ink">{localNameOf(h)}</h1>
            {h.legal_name && <p className="text-[14px] text-slate-600">{h.legal_name}</p>}
            {h.tax_number && <p className="num text-[13px] text-slate-500">{tr("الرقم الضريبي")}{" "}{h.tax_number}</p>}
          </div>
          <div className="text-end">
            <p className="text-[20px] font-bold text-ink">{tr("بطاقة تسجيل نزيل")}</p>
            <p className="num text-[15px] text-slate-600">{r.confirmation_number}</p>
          </div>
        </header>

        <section>
          <h2 className="mb-2 text-[16px] font-bold text-ink">{tr("بيانات النزيل")}</h2>
          <div className="grid grid-cols-2 gap-x-8">
            <Field label={tr("الاسم الكامل")} value={g?.full_name} />
            <Field label={tr("الجنسية")} value={g?.nationality} />
            <Field label={tr("نوع الهوية")} value={g?.id_type ? ID_TYPES[g.id_type] : ""} />
            <Field label={tr("رقم الهوية")} value={g?.id_number} ltr />
            <Field label={tr("تاريخ الميلاد")} value={g?.date_of_birth} ltr />
            <Field label={tr("الجوال")} value={g?.phone} ltr />
            <Field label={tr("البريد")} value={g?.email} ltr />
            <Field label={tr("الجهة / الشركة")} value={localNameOf(r.customer)} />
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[16px] font-bold text-ink">{tr("الإقامة")}</h2>
          <div className="grid grid-cols-2 gap-x-8">
            <Field label={hourly ? tr("الوحدة") : tr("الغرفة")} value={`${r.room?.room_number ?? ""} ${r.room_type?.name_ar ?? ""}`} />
            <Field label={tr("عدد الأشخاص")} value={`${r.adults}${r.children ? tr(" بالغ + {0} طفل", r.children) : tr(" بالغ")}`} />
            <Field label={tr("الوصول")} value={hourly ? `${r.arrival_date} ${timeOf(r.starts_at)}` : tr("{0} بعد {1}", r.arrival_date, h.check_in_time.slice(0, 5))} ltr />
            <Field label={tr("المغادرة")} value={hourly ? `${r.arrival_date} ${timeOf(r.ends_at)}` : tr("{0} قبل {1}", r.departure_date, h.check_out_time.slice(0, 5))} ltr />
            <Field label={hourly ? tr("المدة") : tr("عدد الليالي")} value={hourly ? timeRange(r.starts_at, r.ends_at) : nightsText(nights)} />
            <Field label={tr("إجمالي الإقامة قبل الضريبة")} value={`${money(r.total_amount)} ${h.base_currency}`} />
          </div>
          {r.special_requests && <p className="mt-3 text-[14.5px] text-slate-700">{tr("طلبات خاصة:")}{" "}{r.special_requests}</p>}
        </section>

        <section className="rounded-lg bg-panel p-4 text-[13.5px] leading-relaxed text-slate-700">
          <p className="mb-1 font-semibold text-ink">{tr("أقرّ بما يلي:")}</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>{tr("صحة البيانات أعلاه، والالتزام بأنظمة الفندق وقوانين البلد.")}</li>
            <li>{tr("سداد كامل مستحقات الإقامة والخدمات عند المغادرة أو عند الطلب.")}</li>
            <li>{tr("الفندق غير مسؤول عن المقتنيات الثمينة غير المودعة في الأمانات.")}</li>
            <li>{tr("المغادرة قبل الساعة")}{" "}{h.check_out_time.slice(0, 5)}{tr("، وقد تُحتسب ليلة إضافية بعدها.")}</li>
          </ul>
        </section>

        <footer className="grid grid-cols-2 gap-8 pt-6 text-[14px] text-slate-600">
          <div><p>{tr("توقيع النزيل")}</p><div className="mt-10 border-t border-slate-400" /></div>
          <div><p>{tr("موظف الاستقبال")}</p><div className="mt-10 border-t border-slate-400" /></div>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, value, ltr }: { label: string; value: React.ReactNode; ltr?: boolean }) {
  return (
    <div className="border-b border-dashed border-line py-2">
      <p className="text-[13px] text-slate-500">{label}</p>
      <p className={ltr ? "num text-[16.5px] font-semibold text-ink" : "text-[16.5px] font-semibold text-ink"} dir={ltr ? "ltr" : undefined}>{value || "\u00a0"}</p>
    </div>
  );
}

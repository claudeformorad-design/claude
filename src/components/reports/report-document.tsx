import { Building2 } from "lucide-react";
import { Money } from "@/components/money";
import { MoneyDecimal } from "@/lib/accounting/money";
import type { HotelRow } from "@/lib/supabase/database.types";
import { plainText } from "@/lib/text";
import { cn } from "@/lib/utils";
import type { Cell, ReportTable } from "@/services/report-tables";

/**
 * مستند التقرير للطباعة وحفظه PDF: ورقة A4 بهوية النظام، رأس باسم الفندق وبياناته النظامية،
 * عنوان التقرير وفترته، جدول برأس داكن وأقسام دافئة وإجمالي داكن، وترقيم صفحات في التذييل.
 */
export function ReportDocument({ report, hotel, locale, generatedAt, preparedBy }: {
  report: ReportTable; hotel: HotelRow; locale: string; generatedAt: string; preparedBy?: string;
}) {
  const landscape = report.columns.length > 5;
  const cell = (c: Cell) => (c instanceof MoneyDecimal ? <Money value={c} locale={locale} blankZero /> : plainText(c));
  const legal = [hotel.legal_name, hotel.tax_number && `الرقم الضريبي ${hotel.tax_number}`, hotel.commercial_registration && `السجل التجاري ${hotel.commercial_registration}`].filter(Boolean);
  const contact = [hotel.address, hotel.phone, hotel.email].filter(Boolean);
  return (
    <article className={cn("report-doc mx-auto bg-white text-ink", landscape ? "report-doc-landscape" : "")}>
      <style>{`
        @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 14mm 12mm 16mm;
          @bottom-left { content: "صفحة " counter(page) " من " counter(pages); font: 500 9pt var(--font-thmanyah), sans-serif; color: #6b6964; }
          @bottom-right { content: "${hotel.name_ar.replace(/"/g, "")}"; font: 500 9pt var(--font-thmanyah), sans-serif; color: #6b6964; }
        }
      `}</style>

      <div className="flex items-start justify-between gap-8 border-b border-line pb-6">
        <div className="flex items-center gap-4">
          {hotel.logo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={hotel.logo_url} alt="" className="size-14 rounded-xl object-contain" />
            : <div className="grid size-14 place-items-center rounded-xl bg-ink text-white"><Building2 className="size-7" strokeWidth={1.6} /></div>}
          <div className="space-y-1">
            <p className="text-[21px] font-bold leading-tight">{hotel.name_ar}</p>
            {legal.length > 0 && <p className="text-[12.5px] text-slate-500">{legal.join("، ")}</p>}
            {contact.length > 0 && <p className="text-[12.5px] text-slate-500">{contact.join("، ")}</p>}
          </div>
        </div>
        <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-5 gap-y-1 text-[12.5px]">
          <dt className="text-slate-500">تاريخ الإعداد</dt><dd className="num text-start font-semibold">{generatedAt}</dd>
          {preparedBy && <><dt className="text-slate-500">أعدّه</dt><dd className="font-semibold">{preparedBy}</dd></>}
          <dt className="text-slate-500">العملة</dt><dd className="font-semibold">{hotel.base_currency}</dd>
        </dl>
      </div>

      <section className="pt-6 pb-5">
        <h1 className="text-[30px] font-bold leading-tight">{report.title}</h1>
        {report.subtitle && <p className="mt-2 text-[15px] text-slate-600">{report.subtitle}</p>}
      </section>

      <div className="report-doc-frame overflow-hidden rounded-lg">
      <table className="report-doc-table w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {report.columns.map((c, i) => (
              <th key={c} className={cn("cell-ink bg-ink px-3.5 py-3 font-bold text-white", i === 0 ? "text-start" : "text-end")}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, ri) => {
            const final = row.kind === "total" && ri === report.rows.length - 1;
            return (
            <tr key={ri} className={cn("break-inside-avoid",
              row.kind === "section" && "font-bold",
              row.kind === "subtotal" && "font-bold",
              row.kind === "total" && "font-bold", final && "text-white")}>
              {row.cells.map((c, ci) => (
                <td key={ci} className={cn(
                  "px-3.5 py-2.5",
                  ci > 0 && "text-end",
                  row.kind === "line" && "border-b border-line",
                  row.kind === "line" && ci === 0 && "ps-8 text-slate-700",
                  row.kind === "section" && "cell-section bg-group-row pt-3",
                  row.kind === "subtotal" && "border-t border-line-strong bg-panel",
                  row.kind === "total" && !final && "border-t-2 border-ink py-3",
                  final && "cell-ink bg-ink py-3.5 text-[14.5px]",
                  row.kind === "total" && ri > 0 && report.rows[ri - 1]!.kind === "total" && !final && "border-t border-line-strong",
                )}>{cell(c)}</td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {report.note && (
        <p className={cn("mt-6 inline-block rounded-lg px-4 py-2 text-[13px] font-semibold",
          report.note.ok ? "bg-success/10 text-success" : "bg-urgent-tint text-urgent")}>{report.note.text}</p>
      )}

      <footer className="report-doc-sign mt-10 grid grid-cols-2 gap-16 text-[12.5px] text-slate-500">
        <div className="border-t border-line-strong pt-2">المحاسب</div>
        <div className="border-t border-line-strong pt-2">المدير المالي</div>
      </footer>
    </article>
  );
}

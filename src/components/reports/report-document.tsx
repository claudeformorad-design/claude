import { Building2 } from "lucide-react";
import type { DocMeta, PlainReport } from "@/lib/export/plain-report";
import { cn } from "@/lib/utils";

/**
 * مستند التقرير بهوية النظام (يُطبع أو يُحوَّل PDF): رأس باسم الفندق وبياناته النظامية، عنوان التقرير وفترته،
 * جدول برأس داكن وأقسام دافئة وإجمالي داكن، وتوقيعات. data-pdf تحدد مواضع قصّ الصفحات عند تحويله PDF.
 */
export function ReportDocument({ report, meta, capture = false }: { report: PlainReport; meta: DocMeta; capture?: boolean }) {
  const landscape = report.columns.length > 5;
  const last = report.rows.length - 1;
  return (
    <article className={cn("report-doc bg-white text-ink", capture ? "report-doc-capture" : "mx-auto", landscape && "report-doc-landscape")}>
      {!capture && (
        <style>{`
          @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 14mm 12mm 16mm;
            @bottom-left { content: "صفحة " counter(page) " من " counter(pages); font: 500 9pt var(--font-thmanyah), sans-serif; color: #6b6964; }
            @bottom-right { content: "${meta.hotelName.replace(/"/g, "")}"; font: 500 9pt var(--font-thmanyah), sans-serif; color: #6b6964; }
          }
        `}</style>
      )}

      <div data-pdf="head">
        <div className="flex items-start justify-between gap-8 border-b border-line pb-6">
          <div className="flex items-center gap-4">
            {meta.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={meta.logoUrl} alt="" className="size-14 rounded-xl object-contain" />
              : <div className="grid size-14 place-items-center rounded-xl bg-ink text-white"><Building2 className="size-7" strokeWidth={1.6} /></div>}
            <div className="space-y-1">
              <p className="text-[21px] font-bold leading-tight">{meta.hotelName}</p>
              {meta.legal.length > 0 && <p className="text-[12.5px] text-slate-500">{meta.legal.join("، ")}</p>}
              {meta.contact.length > 0 && <p className="text-[12.5px] text-slate-500">{meta.contact.join("، ")}</p>}
            </div>
          </div>
          <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-5 gap-y-1 text-[12.5px]">
            <dt className="text-slate-500">تاريخ الإعداد</dt><dd className="num text-start font-semibold">{meta.generatedAt}</dd>
            {meta.preparedBy && <><dt className="text-slate-500">أعدّه</dt><dd className="font-semibold">{meta.preparedBy}</dd></>}
            <dt className="text-slate-500">العملة</dt><dd className="font-semibold">{meta.currency}</dd>
          </dl>
        </div>
        <section className="pt-6 pb-5">
          <h1 className="text-[30px] font-bold leading-tight">{report.title}</h1>
          {report.subtitle && <p className="mt-2 text-[15px] text-slate-600">{report.subtitle}</p>}
        </section>
      </div>

      <div className="overflow-hidden rounded-lg">
        <table className="report-doc-table w-full border-separate border-spacing-0 text-[13px]">
          <thead data-pdf="thead">
            <tr>
              {report.columns.map((c, i) => (
                <th key={c} className={cn("cell-ink bg-ink px-3.5 py-3 font-bold text-white", i === 0 ? "text-start" : "text-end")}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row, ri) => {
              const final = row.kind === "total" && ri === last;
              const afterTotal = ri > 0 && report.rows[ri - 1]!.kind === "total";
              return (
                <tr key={ri} data-pdf="row" className={cn(row.kind !== "line" && "font-bold", final && "text-white")}>
                  {row.cells.map((c, ci) => (
                    <td key={ci} className={cn(
                      "px-3.5 py-2.5",
                      ci > 0 && "text-end",
                      c.num && "num",
                      row.kind === "line" && "border-b border-line",
                      row.kind === "line" && ci === 0 && "ps-8 text-slate-700",
                      row.kind === "section" && "cell-section bg-group-row pt-3",
                      row.kind === "subtotal" && "border-t border-line-strong bg-panel",
                      row.kind === "total" && !final && (afterTotal ? "border-t border-line-strong py-3" : "border-t-2 border-ink py-3"),
                      final && "cell-ink bg-ink py-3.5 text-[14.5px]",
                    )}>{c.text}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div data-pdf="tail">
        {report.note && (
          <p className={cn("mt-6 inline-block rounded-lg px-4 py-2 text-[13px] font-semibold",
            report.note.ok ? "bg-success/10 text-success" : "bg-urgent-tint text-urgent")}>{report.note.text}</p>
        )}
        <footer className="report-doc-sign mt-10 grid grid-cols-2 gap-16 text-[12.5px] text-slate-500">
          <div className="border-t border-line-strong pt-2">المحاسب</div>
          <div className="border-t border-line-strong pt-2">المدير المالي</div>
        </footer>
      </div>
    </article>
  );
}

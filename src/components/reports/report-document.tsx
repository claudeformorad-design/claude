import { tr } from "@/i18n/tr";
import { codeColumn, hasCodes, type DocMeta, type PlainReport } from "@/lib/export/plain-report";
import { DocHeader, PageStyle, Signatures } from "./doc-header";
import { cn } from "@/lib/utils";

/**
 * مستند التقرير للطباعة بهوية النظام: رأس باسم الفندق وبياناته النظامية، عنوان التقرير وفترته،
 * جدول برأس داكن وأقسام دافئة وإجمالي داكن، وتوقيعات. رمز الحساب في عمود مستقل قبل اسمه.
 */
export function ReportDocument({ report, meta }: { report: PlainReport; meta: DocMeta }) {
  const landscape = report.columns.length > 5;
  const last = report.rows.length - 1;
  const codes = hasCodes(report.rows);
  return (
    <article className={cn("report-doc mx-auto bg-white text-ink", landscape && "report-doc-landscape")}>
      <PageStyle hotelName={meta.hotelName} size={`A4 ${landscape ? "landscape" : "portrait"}`} />

      <div>
        <DocHeader meta={meta} />
        <section className="pt-6 pb-5">
          <h1 className="text-[30px] font-bold leading-tight">{report.title}</h1>
          {report.subtitle && <p className="mt-2 text-[15px] text-slate-600">{report.subtitle}</p>}
        </section>
      </div>

      <div className="overflow-hidden rounded-lg">
        <table className="report-doc-table w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              {codes && <th className="w-24 bg-ink px-3.5 py-3 text-start font-bold text-white">{codeColumn()}</th>}
              {report.columns.map((c, i) => (
                <th key={c} className={cn("bg-ink px-3.5 py-3 font-bold text-white", i === 0 ? "text-start" : "text-end")}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row, ri) => {
              const final = row.kind === "total" && ri === last;
              const afterTotal = ri > 0 && report.rows[ri - 1]!.kind === "total";
              return (
                <tr key={ri} className={cn(row.kind !== "line" && "font-bold", final && "text-white")}>
                  {codes && row.kind === "line" && <td className="border-b border-line px-3.5 py-2.5 text-slate-500"><span className="num">{row.code}</span></td>}
                  {row.cells.map((c, ci) => (
                    <td key={ci} colSpan={codes && ci === 0 && row.kind !== "line" ? 2 : undefined} className={cn(
                      "px-3.5 py-2.5",
                      ci > 0 && "text-end",
                      c.num && "num",
                      row.kind === "line" && "border-b border-line",
                      row.kind === "line" && ci === 0 && (codes ? "text-slate-700" : "ps-8 text-slate-700"),
                      row.kind === "section" && "bg-group-row pt-3",
                      row.kind === "subtotal" && "border-t border-line-strong bg-panel",
                      row.kind === "total" && !final && (afterTotal ? "border-t border-line-strong py-3" : "border-t-2 border-ink py-3"),
                      final && "bg-ink py-3.5 text-[14.5px]",
                    )}>{c.text}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        {report.note && (
          <p className={cn("mt-6 inline-block rounded-lg px-4 py-2 text-[13px] font-semibold",
            report.note.ok ? "bg-success/10 text-success" : "bg-urgent-tint text-urgent")}>{report.note.text}</p>
        )}
        <Signatures names={[tr("المحاسب"), tr("المدير المالي")]} />
      </div>
    </article>
  );
}

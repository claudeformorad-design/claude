import { Building2 } from "lucide-react";
import type { DocMeta } from "@/lib/export/plain-report";
import { currencyName } from "@/lib/currency-name";

/** رأس المستندات المطبوعة: شعار الفندق وبياناته النظامية، ووقت الإعداد ومن أعدّه والعملة */
export function DocHeader({ meta, extra = [] }: { meta: DocMeta; extra?: [string, React.ReactNode][] }) {
  return (
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
        {extra.map(([label, value]) => <Row key={label} label={label}>{value}</Row>)}
        <Row label="تاريخ الإعداد"><span className="num">{meta.generatedAt}</span></Row>
        {meta.preparedBy && <Row label="أعدّه">{meta.preparedBy}</Row>}
        <Row label="العملة">{currencyName(meta.currency)}</Row>
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <><dt className="text-slate-500">{label}</dt><dd className="text-start font-semibold">{children}</dd></>;
}

/** صفحة الطباعة الافتراضية لمستند A4 بهوامش ورقم صفحة واسم الفندق في التذييل */
export function PageStyle({ hotelName, size = "A4 portrait" }: { hotelName: string; size?: string }) {
  return (
    <style>{`
      @page { size: ${size}; margin: 14mm 12mm 16mm;
        @bottom-left { content: "صفحة " counter(page) " من " counter(pages); font: 500 9pt var(--font-thmanyah), sans-serif; color: #6b6964; }
        @bottom-right { content: "${hotelName.replace(/"/g, "")}"; font: 500 9pt var(--font-thmanyah), sans-serif; color: #6b6964; }
      }
    `}</style>
  );
}

/** خانات التوقيع في ذيل المستند */
export function Signatures({ names }: { names: string[] }) {
  return (
    <footer className="report-doc-sign mt-12 grid gap-12 text-[12.5px] text-slate-500" style={{ gridTemplateColumns: `repeat(${names.length}, minmax(0, 1fr))` }}>
      {names.map((n) => <div key={n} className="border-t border-line-strong pt-2">{n}</div>)}
    </footer>
  );
}

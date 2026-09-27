import { FileSpreadsheet, Printer } from "lucide-react";
import { PdfButton } from "@/components/reports/pdf-button";
import { Button } from "@/components/ui/button";

/** تصدير التقرير: Excel وPDF ينزلان مباشرة بهوية النظام، والطباعة من نسخة الطباعة المصممة */
export function ExportButtons({ report, query, labels }: { report: string; query: string; labels: { excel: string; pdf: string } }) {
  return (
    <div className="flex gap-2 print:hidden">
      <Button asChild variant="outline"><a href={`/api/export/${report}?${query}`}><FileSpreadsheet />{labels.excel}</a></Button>
      <PdfButton href={`/api/export/${report}?${query}&format=json`} label={labels.pdf} />
      <Button asChild variant="outline" size="icon" aria-label="طباعة" title="طباعة">
        <a href={`/print/reports/${report}?${query}`} target="_blank" rel="noopener"><Printer /></a>
      </Button>
    </div>
  );
}

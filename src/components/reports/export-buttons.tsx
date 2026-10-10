import { tr } from "@/i18n/tr";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** تصدير التقرير: Excel وPDF ينزلان مباشرة من الخادم بهوية النظام، والطباعة من نسخة الطباعة المصممة */
export function ExportButtons({ report, query, labels }: { report: string; query: string; labels: { excel: string; pdf: string } }) {
  return (
    <div className="flex gap-2 print:hidden">
      <Button asChild variant="outline"><a href={`/api/export/${report}?${query}`}><FileSpreadsheet />{labels.excel}</a></Button>
      <Button asChild variant="outline"><a href={`/api/export/${report}?${query}&format=pdf`}><FileText />{labels.pdf}</a></Button>
      <Button asChild variant="outline" size="icon" aria-label={tr("طباعة")} title={tr("طباعة")}>
        <a href={`/print/reports/${report}?${query}`} target="_blank" rel="noopener"><Printer /></a>
      </Button>
    </div>
  );
}

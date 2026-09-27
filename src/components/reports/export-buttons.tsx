import { FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/** تصدير التقرير: Excel بهوية النظام، وPDF من نسخة الطباعة المصممة (تفتح في تبويب جديد) */
export function ExportButtons({ report, query, labels }: { report: string; query: string; labels: { excel: string; pdf: string } }) {
  return (
    <div className="flex gap-2 print:hidden">
      <Button asChild variant="outline"><a href={`/api/export/${report}?${query}`}><FileSpreadsheet />{labels.excel}</a></Button>
      <Button asChild variant="outline"><a href={`/print/reports/${report}?${query}`} target="_blank" rel="noopener"><FileText />{labels.pdf}</a></Button>
    </div>
  );
}

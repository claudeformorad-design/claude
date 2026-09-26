import { FileSpreadsheet } from "lucide-react";
import { Money } from "@/components/money";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MoneyDecimal } from "@/lib/accounting/money";
import { cn } from "@/lib/utils";
import type { Cell, ReportTable } from "@/services/report-tables";
import { PrintButton } from "@/app/(app)/invoices/[id]/print-button";

export function ReportView({ report, locale, exportHref, labels }: {
  report: ReportTable; locale: string; exportHref: string; labels: { excel: string; print: string };
}) {
  const cell = (c: Cell) => (c instanceof MoneyDecimal ? <Money value={c} locale={locale} blankZero /> : c ?? "");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        {report.note ? <Alert variant={report.note.ok ? "success" : "destructive"} className="py-2">{report.note.text}</Alert> : <span />}
        <div className="flex gap-2">
          <Button asChild variant="outline"><a href={exportHref}><FileSpreadsheet />{labels.excel}</a></Button>
          <PrintButton label={labels.print} />
        </div>
      </div>
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{report.title}</h1>
        <p className="text-sm">{report.subtitle}</p>
      </div>
      <Card className="overflow-hidden print:border-0 print:shadow-none">
        <Table>
          <TableHeader><TableRow>
            {report.columns.map((c, i) => <TableHead key={c} className={i > 0 ? "text-end" : ""}>{c}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {report.rows.map((row, ri) => (
              <TableRow key={ri} className={cn(
                row.kind === "section" && "bg-muted/40 font-semibold hover:bg-muted/40",
                row.kind === "subtotal" && "font-medium",
                row.kind === "total" && "border-t-2 bg-muted/60 font-bold",
              )}>
                {row.cells.map((c, ci) => (
                  <TableCell key={ci} className={cn(ci > 0 && "text-end", row.kind === "line" && ci === 0 && "ps-6")}>{cell(c)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

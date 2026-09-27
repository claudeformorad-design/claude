"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { ExpandableRow, ExpandMark } from "@/components/ui/expandable-row";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PlainReport } from "@/lib/export/plain-report";
import { cn } from "@/lib/utils";

/**
 * عرض تقرير تفاعلي: كل قسم ينطوي وينفتح بالضغط على عنوانه، وكل حساب يُفتح على حركاته في الفترة.
 * أزرار التصدير تُمرَّر من الصفحة (actions).
 */
export function ReportView({ report, from, to, actions }: {
  report: PlainReport; from?: string; to: string; actions: React.ReactNode;
}) {
  const [closed, setClosed] = useState<Set<number>>(new Set());
  // كل صف يتبع آخر قسم قبله حتى أول إجمالي
  const group: (number | null)[] = [];
  let g: number | null = null;
  report.rows.forEach((r, i) => {
    if (r.kind === "section") g = i;
    else if (r.kind === "total") g = null;
    group.push(r.kind === "section" ? null : g);
  });
  const toggle = (i: number) => setClosed((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const cols = report.columns.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        {report.note ? <Alert variant={report.note.ok ? "success" : "destructive"} className="py-2">{report.note.text}</Alert> : <span />}
        {actions}
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            {report.columns.map((c, i) => <TableHead key={c} className={i > 0 ? "text-end" : ""}>{c}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {report.rows.map((row, ri) => {
              const owner = group[ri];
              if (owner != null && closed.has(owner) && row.kind === "line") return null;
              const cells = row.cells.map((c, ci) => (
                <TableCell key={ci} className={cn(ci > 0 && "text-end", c.num && "num", row.kind === "line" && ci === 0 && "ps-9 text-slate-700")}>
                  {ci === 0 && (row.kind === "section" || row.account) && <ExpandMark />}
                  {c.text}
                </TableCell>
              ));
              if (row.kind === "line" && row.account) {
                return <ExpandableRow key={ri} kind="account" id={row.account} colSpan={cols} from={from} to={to}>{cells}</ExpandableRow>;
              }
              if (row.kind === "section") {
                const open = !closed.has(ri);
                return (
                  <tr key={ri} aria-expanded={open} tabIndex={0} onClick={() => toggle(ri)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(ri); } }}
                    className="expandable-row section-row cursor-pointer border-b border-line bg-panel font-bold outline-none hover:bg-subtle">
                    {cells}
                  </tr>
                );
              }
              return (
                <TableRow key={ri} className={cn(
                  row.kind === "subtotal" && "bg-subtle/60 font-semibold hover:bg-subtle/60",
                  row.kind === "total" && "border-0 bg-ink font-bold text-white hover:bg-ink [&_td]:text-white",
                )}>{cells}</TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

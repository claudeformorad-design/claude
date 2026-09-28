"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EntityCell } from "@/components/ui/entity";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { ATTENDANCE_STATUS, minutesText } from "@/lib/hr/labels";
import { cn } from "@/lib/utils";
import { saveAttendanceAction } from "../actions";

export type SheetRow = {
  employee_id: string; name: string; shift: string | null; leave: string | null;
  status: "present" | "absent" | "leave" | "off"; check_in: string; check_out: string; notes: string;
  late: number; overtime: number;
};

/** الوقت بنظام 24 ساعة يُكتب مباشرة مثل 840 أو 8:40 أو 20، ويُضبط إلى 08:40 عند مغادرة الحقل */
function normalizeTime(v: string): string {
  const s = v.trim();
  const m = s.match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
  if (!m) return s;
  const h = Number(m[1]), min = Number(m[2] ?? 0);
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : s;
}
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * كشف حضور اليوم: كل موظف في سطر، والحالة الافتراضية حاضر (أو إجازة معتمدة أو راحة من جدول الورديات).
 * يكفي تسجيل الاستثناء: الغياب، ووقت الحضور والانصراف لمن تأخر أو عمل إضافيًا.
 */
export function AttendanceSheet({ day, rows, canEdit, errors }: { day: string; rows: SheetRow[]; canEdit: boolean; errors: Record<string, string> }) {
  const router = useRouter();
  const [data, setData] = useState(rows);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<SheetRow>) => { setData((d) => d.map((r, k) => (k === i ? { ...r, ...patch } : r))); setDirty(true); };
  const timeProps = { inputMode: "numeric" as const, dir: "ltr", maxLength: 5, placeholder: "--:--", className: "field num h-9 w-20 px-2 text-center disabled:opacity-40" };
  const counts = useMemo(() => Object.fromEntries(Object.keys(ATTENDANCE_STATUS).map((k) => [k, data.filter((r) => r.status === k).length])), [data]);

  const save = () => start(async () => {
    const rows = data.map(({ employee_id, status, check_in, check_out, notes }) => ({ employee_id, status, check_in: normalizeTime(check_in), check_out: normalizeTime(check_out), notes }));
    if (rows.some((r) => (r.check_in && !TIME.test(r.check_in)) || (r.check_out && !TIME.test(r.check_out)))) {
      toast("اكتب الوقت بنظام 24 ساعة مثل 08:30 أو 17:15", "error");
      return;
    }
    const r = await callAction(saveAttendanceAction(day, rows));
    if (r.ok) { toast("حُفظ كشف الحضور"); setDirty(false); router.refresh(); }
    else toast(actionErrorText(errors, r), "error");
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(ATTENDANCE_STATUS).map(([k, s]) => (
          <span key={k} className="rounded-lg bg-subtle px-3 py-1.5 text-[15px] text-slate-600">{s.label} <span className="num font-semibold text-ink">{counts[k]}</span></span>
        ))}
        {canEdit && (
          <span className="ms-auto flex gap-2">
            <Button variant="outline" size="sm" disabled={pending}
              onClick={() => { setData((d) => d.map((r) => (r.status === "absent" ? { ...r, status: "present" } : r))); setDirty(true); }}>الجميع حاضر</Button>
            <Button size="sm" onClick={save} loading={pending} disabled={!dirty}>حفظ الكشف</Button>
          </span>
        )}
      </div>
      <div className="surface overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>الموظف</TableHead><TableHead>الحالة</TableHead>
            <TableHead>الحضور</TableHead><TableHead>الانصراف</TableHead><TableHead>تأخير</TableHead><TableHead>إضافي</TableHead><TableHead>ملاحظة</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {data.map((r, i) => (
              <TableRow key={r.employee_id} className={cn(r.status === "absent" && "bg-urgent-tint/40")}>
                <TableCell className="whitespace-nowrap"><EntityCell name={r.name} sub={r.leave ?? r.shift ?? "بلا وردية"} href={`/hr/${r.employee_id}`} /></TableCell>
                <TableCell>
                  <div className="inline-flex rounded-lg bg-subtle p-0.5" role="radiogroup" aria-label={`حالة ${r.name}`}>
                    {(["present", "absent", "leave", "off"] as const).map((k) => (
                      <button key={k} type="button" role="radio" aria-checked={r.status === k} disabled={!canEdit}
                        onClick={() => set(i, { status: k, ...(k !== "present" ? { check_in: "", check_out: "" } : {}) })}
                        className={cn("rounded-md px-2.5 py-1 text-[14.5px] transition-colors",
                          r.status === k ? (k === "absent" ? "bg-white font-semibold text-urgent" : "bg-white font-semibold text-ink") : "text-slate-500 hover:text-ink")}>
                        {ATTENDANCE_STATUS[k]!.label}
                      </button>
                    ))}
                  </div>
                </TableCell>
                <TableCell><input value={r.check_in} disabled={!canEdit || r.status !== "present"} aria-label={`حضور ${r.name}`} {...timeProps}
                  onChange={(e) => set(i, { check_in: e.target.value })} onBlur={(e) => e.target.value && set(i, { check_in: normalizeTime(e.target.value) })} /></TableCell>
                <TableCell><input value={r.check_out} disabled={!canEdit || r.status !== "present"} aria-label={`انصراف ${r.name}`} {...timeProps}
                  onChange={(e) => set(i, { check_out: e.target.value })} onBlur={(e) => e.target.value && set(i, { check_out: normalizeTime(e.target.value) })} /></TableCell>
                <TableCell className={cn("num whitespace-nowrap", r.late ? "text-urgent" : "text-slate-400")}>{minutesText(r.late)}</TableCell>
                <TableCell className={cn("num whitespace-nowrap", r.overtime ? "text-success" : "text-slate-400")}>{minutesText(r.overtime)}</TableCell>
                <TableCell className="cell-fluid"><input value={r.notes} disabled={!canEdit} maxLength={300} aria-label={`ملاحظة ${r.name}`}
                  onChange={(e) => set(i, { notes: e.target.value })} className="field h-9 w-full min-w-28" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

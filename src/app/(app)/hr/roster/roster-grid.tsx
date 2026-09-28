"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { cn } from "@/lib/utils";
import { saveRosterAction } from "../actions";

type Employee = { id: string; name: string; defaultShift: string | null };
type Shift = { id: string; name: string };

/**
 * جدول ورديات الأسبوع: لكل موظف في كل يوم وردية معينة أو راحة، أو وردية الافتراضية.
 * تُحفظ الخلايا المعدّلة فقط.
 */
export function RosterGrid({ days, employees, shifts, initial, canEdit, errors }: {
  days: { date: string; label: string; weekend: boolean }[];
  employees: Employee[];
  shifts: Shift[];
  initial: Record<string, string>;
  canEdit: boolean;
  errors: Record<string, string>;
}) {
  const router = useRouter();
  const [cells, setCells] = useState(initial);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const key = (e: string, d: string) => `${e}|${d}`;
  // اسم مختصر داخل الخلية: «الصباحية» بدل «الوردية الصباحية»
  const short = (name: string) => name.replace(/^الوردية\s+/, "");
  const shiftName = new Map(shifts.map((s) => [s.id, short(s.name)]));

  const save = () => start(async () => {
    const rows = [...changed].map((k) => { const [employee_id, work_date] = k.split("|"); return { employee_id: employee_id!, work_date: work_date!, shift: cells[k] ?? "default" }; });
    const r = await callAction(saveRosterAction(rows));
    if (r.ok) { toast("حُفظ جدول الورديات"); setChanged(new Set()); router.refresh(); }
    else toast(actionErrorText(errors, r), "error");
  });

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} loading={pending} disabled={changed.size === 0}>حفظ الجدول</Button>
        </div>
      )}
      <div className="surface overflow-x-auto">
        <table className="w-full min-w-[900px] text-[15px]">
          <thead>
            <tr className="border-b border-line bg-panel text-slate-600">
              <th className="px-4 py-3 text-start font-medium">الموظف</th>
              {days.map((d) => (
                <th key={d.date} className={cn("px-2 py-3 text-start font-medium", d.weekend && "text-slate-400")}>
                  {d.label} <span className="num text-slate-400">{d.date.slice(8)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {employees.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink">{e.name}</td>
                {days.map((d) => {
                  const k = key(e.id, d.date);
                  const v = cells[k] ?? "default";
                  return (
                    <td key={d.date} className="px-1.5 py-2">
                      <NativeSelect value={v} disabled={!canEdit} aria-label={`${e.name} ${d.label}`}
                        className={cn("h-9 px-2.5 text-[14.5px]", v === "off" && "bg-subtle text-slate-500", changed.has(k) && "border-action")}
                        onChange={(ev) => { const val = ev.target.value; setCells((c) => ({ ...c, [k]: val })); setChanged((s) => new Set(s).add(k)); }}>
                        <option value="default">{e.defaultShift ? shiftName.get(e.defaultShift) ?? "الافتراضية" : d.weekend ? "راحة أسبوعية" : "بلا وردية"}</option>
                        {shifts.map((s) => <option key={s.id} value={s.id}>{short(s.name)}</option>)}
                        <option value="off">راحة</option>
                      </NativeSelect>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

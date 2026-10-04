"use client";
import { tr, trList } from "@/i18n/tr";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { Popover, setNativeValue } from "@/components/ui/popover";
import { useMergedRef } from "@/components/ui/use-merged-ref";
import { cn } from "@/lib/utils";

const MONTHS = trList(["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]);
const WEEKDAYS = trList(["س", "ح", "ن", "ث", "ر", "خ", "ج"]); // يبدأ الأسبوع بالسبت

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
const parse = (v: string) => { const [y, m] = v.split("-").map(Number); return { y: y!, m: m! - 1 }; };

/**
 * حقل تاريخ بتصميم النظام: يعرض التاريخ مقروءًا (27 سبتمبر 2026) ويفتح تقويمًا بنمط Notion.
 * تحته حقل date أصلي مخفي يحمل القيمة (yyyy-mm-dd) فيعمل مع النماذج وReact Hook Form كما هو.
 */
export function DateField({ className, onChange, ref, disabled, placeholder, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const [inputRef, setRefs] = useMergedRef(ref);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const [value, setValue] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const sync = React.useCallback(() => setValue(inputRef.current?.value ?? ""), [inputRef]);
  React.useEffect(sync);
  const close = React.useCallback(() => setOpen(false), []);

  const pick = (v: string) => {
    close();
    buttonRef.current?.focus();
    if (inputRef.current && inputRef.current.value !== v) setNativeValue(inputRef.current, v);
  };

  const d = value ? parse(value) : null;
  return (
    <div className={cn("relative min-w-40", className)}>
      <input ref={setRefs} type="date" tabIndex={-1} disabled={disabled} onChange={(e) => { sync(); onChange?.(e); }}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0" {...props} />
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={props["aria-label"]}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { sync(); setOpen((o) => !o); }}
        className={cn(
          "field flex h-11 w-full min-w-0 cursor-pointer items-center justify-between gap-3 py-2 text-start disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-action",
          className?.match(/\bh-\d+\b/)?.[0],
        )}
      >
        {d ? (
          <span className="truncate"><span className="num">{Number(value.slice(8))}</span> {MONTHS[d.m]} <span className="num">{d.y}</span></span>
        ) : <span className="truncate text-slate-400">{placeholder ?? tr("اختر التاريخ")}</span>}
        <CalendarDays className="size-[18px] shrink-0 stroke-[1.7] text-slate-400" />
      </button>
      <Popover open={open} anchor={buttonRef} onClose={close} width={300} maxHeight={420}>
        <Calendar value={value} min={props.min as string | undefined} max={props.max as string | undefined}
          clearable={!props.required} onPick={pick} />
      </Popover>
    </div>
  );
}

function Calendar({ value, min, max, clearable, onPick }: {
  value: string; min?: string; max?: string; clearable: boolean; onPick: (v: string) => void;
}) {
  const today = todayIso();
  const [view, setView] = React.useState(() => parse(value || today));
  const move = (delta: number) => setView(({ y, m }) => ({ y: y + Math.floor((m + delta) / 12), m: (m + delta + 12) % 12 }));
  const first = new Date(view.y, view.m, 1).getDay(); // 0 = الأحد
  const lead = (first + 1) % 7; // عدد الخانات الفارغة قبل أول يوم (الأسبوع يبدأ السبت)
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const out = (v: string) => (!!min && v < min) || (!!max && v > max);
  const prev = MONTHS[(view.m + 11) % 12];
  const next = MONTHS[(view.m + 1) % 12];

  return (
    <div className="p-1.5">
      <div className="mb-2 flex items-center justify-between gap-2 text-[15px]">
        <button type="button" onClick={() => move(-1)} className="rounded-md px-2 py-1 text-slate-500 transition-colors hover:bg-subtle hover:text-ink">{prev}</button>
        <span className="font-semibold text-ink">{MONTHS[view.m]} <span className="num">{view.y}</span></span>
        <button type="button" onClick={() => move(1)} className="rounded-md px-2 py-1 text-slate-500 transition-colors hover:bg-subtle hover:text-ink">{next}</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w) => <span key={w} className="py-1 text-[13.5px] text-slate-400">{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const v = iso(view.y, view.m, i + 1);
          const sel = v === value;
          return (
            <button key={v} type="button" disabled={out(v)} onClick={() => onPick(v)}
              className={cn(
                "num grid h-9 place-items-center rounded-lg text-[15px] transition-colors disabled:cursor-not-allowed disabled:opacity-30",
                sel ? "bg-ink font-semibold text-white" : "text-ink hover:bg-subtle",
                !sel && v === today && "font-bold text-action",
              )}>
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[15px]">
        <button type="button" disabled={out(today)} onClick={() => onPick(today)} className="rounded-md px-2 py-1 text-action transition-colors hover:bg-subtle disabled:opacity-40">{tr("اليوم")}</button>
        {clearable && value && <button type="button" onClick={() => onPick("")} className="rounded-md px-2 py-1 text-slate-500 transition-colors hover:bg-subtle hover:text-ink">{tr("مسح")}</button>}
      </div>
    </div>
  );
}

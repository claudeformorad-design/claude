"use client";

import * as React from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Plus } from "lucide-react";
import Link from "@/components/link";
import { loadDetailAction } from "@/app/(app)/_details/actions";
import { callAction } from "@/lib/action-error";
import type { Detail, DetailKind } from "@/lib/details";
import { cn } from "@/lib/utils";

/**
 * صف جدول يُفتح بالضغط عليه ليعرض تفاصيله تحته (سطور القيد، أصناف الفاتورة، حركات الحساب...)،
 * وتُحمَّل التفاصيل عند أول فتح فقط. الضغط على رابط أو زر داخل الصف لا يفتحه.
 */
export function ExpandableRow({ kind, id, colSpan, from, to, className, children }: {
  kind: DetailKind; id: string; colSpan: number; from?: string; to?: string; className?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || detail) return;
    setError(null);
    const r = await callAction(loadDetailAction({ kind, id, from, to }));
    if (r.ok) setDetail(r.data);
    else setError("message" in r && r.message ? r.message : "تعذّر تحميل التفاصيل");
  };

  return (
    <>
      <tr
        aria-expanded={open}
        tabIndex={0}
        onClick={(e) => { if (!(e.target as HTMLElement).closest("a, button, input, select, label")) void toggle(); }}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); void toggle(); } }}
        className={cn(
          "expandable-row cursor-pointer border-b border-line transition-colors duration-150 outline-none hover:bg-[#fbfaf7] focus-visible:bg-[#fbfaf7]",
          open && "bg-[#fbfaf7]",
          className,
        )}
      >
        {children}
      </tr>
      <AnimatePresence initial={false}>
        {open && (
          <tr className="border-b border-line bg-[#fbfaf7]">
            <td colSpan={colSpan} className="p-0">
              <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                <div className="px-5 pt-1 pb-5">
                  {error ? <p className="py-3 text-[15.5px] text-urgent">{error}</p>
                    : detail ? <DetailView detail={detail} />
                    : <div className="space-y-2 py-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-7 rounded-md" />)}</div>}
                </div>
              </m.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

/** علامة الفتح في أول خلية: زائد يدور إلى علامة إغلاق */
export function ExpandMark() {
  return <Plus aria-hidden className="expand-mark me-2 inline size-4 shrink-0 align-[-3px] text-slate-400 transition-transform duration-200" />;
}

function DetailView({ detail }: { detail: Detail }) {
  const cell = (c: Detail["rows"][number][number], i: number) => {
    const content = c.href ? <Link href={c.href} className="text-action hover:opacity-75">{c.text}</Link> : c.text;
    return (
      <td key={i} className={cn("px-3 py-2", i > 0 && c.num && "text-end", c.num && "num", c.tone === "neg" && "text-urgent", c.tone === "muted" && "text-slate-500")}>
        {content}
      </td>
    );
  };
  return (
    <div className="space-y-3">
      {detail.facts && detail.facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[15.5px]">
          {detail.facts.map((f) => (
            <div key={f.label} className="flex items-baseline gap-2">
              <dt className="text-slate-500">{f.label}</dt>
              <dd className={cn("font-semibold text-ink", f.num && "num")}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {detail.rows.length === 0 ? (
        detail.empty && <p className="text-[15.5px] text-slate-500">{detail.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-[15.5px]">
            <thead>
              <tr className="border-b border-line text-slate-500">
                {detail.columns.map((c, i) => (
                  <th key={c} className={cn("px-3 py-2 text-start font-medium", i > 0 && detail.rows[0]?.[i]?.num && "text-end")}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {detail.rows.map((r, ri) => <tr key={ri}>{r.map(cell)}</tr>)}
            </tbody>
            {detail.totals && (
              <tfoot><tr className="border-t border-line bg-panel font-semibold">{detail.totals.map(cell)}</tr></tfoot>
            )}
          </table>
        </div>
      )}
      {detail.link && (
        <Link href={detail.link.href} className="inline-block text-[15.5px] text-action hover:opacity-75">{detail.link.label}</Link>
      )}
    </div>
  );
}

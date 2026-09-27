"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { AnimatePresence, LayoutGroup } from "motion/react";
import * as m from "motion/react-m";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { OPEN_SEARCH_EVENT, type NavGroup, type NavItem } from "./nav-config";

/** تطبيع عربي للبحث: توحيد الألف والتاء المربوطة والياء وإزالة التشكيل */
const norm = (s: string) =>
  s.toLowerCase().replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

/** إبراز الجزء المطابق من الاسم (عند تطابق حرفي) */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-accent1-tint px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * بحث الصفحات في الشريط العلوي: حقل مدمج، والنتائج تنسدل تحته مباشرة في قائمة صغيرة
 * (لا نافذة كبيرة ولا تغطية للشريط الجانبي). تنفتح بكشف ناعم من الأعلى، والعنصر المحدد
 * يتحرك بينها بمؤشر منزلق. الأسهم للتنقل، Enter للفتح، Esc للإغلاق، وCtrl K أو / للتركيز.
 */
export function SearchBox({ groups, className, autoFocus = false, onDone }: {
  groups: NavGroup[];
  className?: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const all = useMemo(() => groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.items.length > 1 ? g.title ?? "" : "" }))), [groups]);
  const results = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return all.slice(0, 8);
    // الترتيب: ما يبدأ بالنص، ثم كلمة تبدأ به، ثم ما يحتويه، ثم اسم القسم
    const score = (i: (typeof all)[number]) => {
      const l = norm(i.label);
      if (l.startsWith(n)) return 0;
      if (l.split(/\s+/).some((w) => w.startsWith(n))) return 1;
      if (l.includes(n)) return 2;
      return norm(i.group).includes(n) ? 3 : 9;
    };
    return all.map((i) => ({ i, s: score(i) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s).map((x) => x.i).slice(0, 10);
  }, [q, all]);
  const safeIndex = Math.min(index, Math.max(0, results.length - 1));
  const activeHref = open ? results[safeIndex]?.href : undefined;

  // جلب الصفحة المحددة مسبقًا (بعد توقف قصير) فتفتح فور الضغط على Enter
  useEffect(() => {
    if (!activeHref) return;
    const t = setTimeout(() => router.prefetch(activeHref, { kind: PrefetchKind.FULL }), 120);
    return () => clearTimeout(t);
  }, [activeHref, router]);

  useEffect(() => {
    const focus = () => { inputRef.current?.focus(); setOpen(true); };
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, focus);
    document.addEventListener("mousedown", onDown);
    if (autoFocus) focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, focus);
      document.removeEventListener("mousedown", onDown);
    };
  }, [autoFocus]);

  const go = (item: NavItem | undefined) => {
    if (!item) return;
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    onDone?.();
    router.push(item.href);
  };

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <label className={cn(
        "flex h-10 items-center gap-2.5 rounded-lg border bg-white px-3 transition-[border-color] duration-200",
        open ? "border-action" : "border-line hover:border-line-strong",
      )}>
        <Search className={cn("size-[18px] shrink-0 stroke-[1.9] transition-colors", open ? "text-action" : "text-slate-500")} />
        <input
          ref={inputRef}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setIndex(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); onDone?.(); }
            if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); go(results[safeIndex]); }
          }}
          placeholder="ابحث عن صفحة أو تقرير…"
          aria-label="بحث"
          role="combobox"
          aria-controls={listId}
          aria-expanded={open}
          className="min-w-0 flex-1 bg-transparent text-[16.5px] text-ink outline-none placeholder:text-slate-500"
        />
        {!open && <kbd className="num hidden shrink-0 rounded border border-line bg-panel px-1.5 text-[12.5px] text-slate-500 lg:inline">Ctrl K</kbd>}
      </label>

      <AnimatePresence>
        {open && (
          <m.div
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -6, clipPath: "inset(0 0 100% 0 round 10px)" }}
            animate={{ opacity: 1, y: 0, clipPath: "inset(0 0 0% 0 round 10px)" }}
            exit={{ opacity: 0, y: -4, clipPath: "inset(0 0 100% 0 round 10px)", transition: { duration: 0.16 } }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 top-full z-50 mt-2 min-w-[22rem] overflow-hidden rounded-[10px] border border-line bg-white p-1.5 shadow-lift"
          >
            <p className="px-2.5 pb-1 pt-1 text-[13.5px] font-medium text-slate-500">{q.trim() ? `${results.length} نتيجة` : "انتقال سريع"}</p>
            {results.length === 0 && <p className="px-3 py-6 text-center text-[15.5px] text-slate-500">لا توجد صفحة بهذا الاسم</p>}
            <LayoutGroup id="search-results">
              <ul className="max-h-[55vh] overflow-y-auto">
                {results.map((item, i) => (
                  <m.li key={item.href} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 + Math.min(i, 8) * 0.018, duration: 0.2 }}>
                    <button
                      type="button"
                      onMouseEnter={() => setIndex(i)}
                      onClick={() => go(item)}
                      className="relative flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-start text-[16px]"
                    >
                      {i === safeIndex && (
                        <m.span layoutId="search-active" transition={{ type: "spring", stiffness: 600, damping: 42 }}
                          className="absolute inset-0 rounded-md bg-subtle" />
                      )}
                      <span className={cn("relative flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
                        i === safeIndex ? "border-action/30 bg-accent1-tint text-action" : "border-line bg-white text-slate-600")}>
                        <item.icon className="size-[15px] stroke-[1.9]" />
                      </span>
                      <span className={cn("relative flex-1 truncate", i === safeIndex ? "font-semibold text-ink" : "text-slate-700")}>
                        <Highlight text={item.label} q={q.trim()} />
                      </span>
                      {item.group && <span className="relative shrink-0 text-slate-500">{item.group}</span>}
                    </button>
                  </m.li>
                ))}
              </ul>
            </LayoutGroup>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

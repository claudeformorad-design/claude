"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string; disabled: boolean };

/**
 * قائمة اختيار بتصميم النظام: زر هادئ يفتح لوحة بيضاء بحواف ناعمة (بحث عند طول القائمة، ولوحة المفاتيح).
 * تحتها عنصر select أصلي مخفي يحمل القيمة، فتعمل مع النماذج وReact Hook Form والتسميات كما هي.
 */
export function NativeSelect({ className, children, onChange, ref, disabled, ...props }: React.ComponentProps<"select">) {
  const selectRef = React.useRef<HTMLSelectElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const [opts, setOpts] = React.useState<Opt[]>([]);
  const [current, setCurrent] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const setRefs = (el: HTMLSelectElement | null) => {
    selectRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.RefObject<HTMLSelectElement | null>).current = el;
  };

  // مزامنة الخيارات والقيمة المعروضة مع العنصر الأصلي (بعد أي إعادة رسم أو إعادة ضبط للنموذج)
  const sync = React.useCallback(() => {
    const el = selectRef.current;
    if (!el) return;
    const next = Array.from(el.options).map((o) => ({ value: o.value, label: o.text, disabled: o.disabled }));
    setOpts((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    setCurrent((prev) => (prev === el.value ? prev : el.value));
  }, []);
  React.useEffect(sync);

  const choose = (value: string) => {
    const el = selectRef.current;
    setOpen(false);
    buttonRef.current?.focus();
    if (!el || el.value === value) return;
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    sync();
  };

  const selected = opts.find((o) => o.value === current);
  const placeholder = !selected || selected.value === "";

  return (
    <div className="relative w-full min-w-0">
      <select
        ref={setRefs}
        tabIndex={-1}
        disabled={disabled}
        onChange={(e) => { sync(); onChange?.(e); }}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        {...props}
      >
        {children}
      </select>
      <button
        ref={buttonRef}
        type="button"
        data-slot="select"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props["aria-label"]}
        onClick={() => { sync(); setOpen((v) => !v); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sync(); setOpen(true); } }}
        className={cn(
          "field field-select relative flex h-11 w-full min-w-0 cursor-pointer items-center py-2 text-start disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-action",
          className,
        )}
      >
        <span className={cn("truncate", placeholder && "text-slate-400")}>{selected?.label ?? ""}</span>
      </button>
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && <SelectPanel anchor={buttonRef} options={opts} value={current} onChoose={choose} onClose={() => setOpen(false)} />}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

function SelectPanel({ anchor, options, value, onChoose, onClose }: {
  anchor: React.RefObject<HTMLButtonElement | null>; options: Opt[]; value: string;
  onChoose: (v: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const [pos, setPos] = React.useState<{ top: number; left: number; width: number; up: boolean; max: number } | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const searchable = options.length > 8;
  const shown = query ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : options;

  // التموضع تحت الزر (أو فوقه إن ضاقت المساحة)، ويتبع التمرير وتغيّر حجم النافذة
  React.useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 260 && above > below;
      setPos({ top: up ? r.top - 6 : r.bottom + 6, left: r.left, width: Math.max(r.width, 220), up, max: Math.min(360, Math.max(160, up ? above : below)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor]);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); anchor.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = shown[active]; if (o && !o.disabled) onChoose(o.value); }
    else if (e.key === "Tab") onClose();
  };

  if (!pos) return null;
  return (
        <motion.div
          ref={panelRef}
          role="listbox"
          tabIndex={-1}
          onKeyDown={onKey}
          className="select-panel fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-line bg-white p-1.5"
          style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }), maxHeight: pos.max }}
          initial={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          onAnimationStart={() => panelRef.current?.focus({ preventScroll: true })}
        >
          {searchable && (
            <div className="relative mb-1.5 shrink-0">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onKey}
                placeholder="بحث"
                className="h-9 w-full rounded-lg bg-subtle ps-9 pe-3 text-[15.5px] text-ink outline-none placeholder:text-slate-400"
              />
            </div>
          )}
          <div ref={listRef} className="min-h-0 overflow-y-auto overscroll-contain">
            {shown.length === 0 && <p className="px-3 py-2.5 text-[15px] text-slate-400">لا نتائج</p>}
            {shown.map((o, i) => {
              const isSel = o.value === value;
              return (
                <button
                  key={`${o.value}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  data-index={i}
                  disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onChoose(o.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-[16px] transition-colors disabled:opacity-40",
                    i === active ? "bg-subtle" : "",
                    isSel ? "font-semibold text-ink" : "text-slate-700",
                    o.value === "" && "text-slate-400",
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {isSel && o.value !== "" && <Check className="size-4 shrink-0 text-action" />}
                </button>
              );
            })}
          </div>
        </motion.div>
  );
}


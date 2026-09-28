"use client";

import * as React from "react";
import { Check, Search } from "lucide-react";
import { Popover, setNativeValue } from "@/components/ui/popover";
import { useMergedRef } from "@/components/ui/use-merged-ref";
import { cn } from "@/lib/utils";
import { CodeName } from "@/components/ui/code-text";

type Opt = { value: string; label: string; disabled: boolean };

/**
 * قائمة اختيار بتصميم النظام: زر هادئ يفتح لوحة بيضاء بحواف ناعمة (بحث عند طول القائمة، ولوحة المفاتيح).
 * تحتها عنصر select أصلي مخفي يحمل القيمة، فتعمل مع النماذج وReact Hook Form والتسميات كما هي.
 */
export function NativeSelect({ className, children, onChange, ref, disabled, ...props }: React.ComponentProps<"select">) {
  const [selectRef, setRefs] = useMergedRef(ref);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const [opts, setOpts] = React.useState<Opt[]>([]);
  const [current, setCurrent] = React.useState("");
  const [open, setOpen] = React.useState(false);

  // مزامنة الخيارات والقيمة المعروضة مع العنصر الأصلي (بعد أي إعادة رسم أو إعادة ضبط للنموذج)
  const sync = React.useCallback(() => {
    const el = selectRef.current;
    if (!el) return;
    const next = Array.from(el.options, (o) => ({ value: o.value, label: o.text, disabled: o.disabled }));
    setOpts((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    setCurrent(el.value);
  }, [selectRef]);
  React.useEffect(sync);

  const close = React.useCallback(() => setOpen(false), []);
  const choose = (value: string) => {
    close();
    buttonRef.current?.focus();
    if (selectRef.current && selectRef.current.value !== value) setNativeValue(selectRef.current, value);
  };

  const selected = opts.find((o) => o.value === current);
  return (
    <div className="relative w-full min-w-0">
      <select ref={setRefs} tabIndex={-1} disabled={disabled} onChange={(e) => { sync(); onChange?.(e); }}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0" {...props}>
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
          "field field-select flex h-11 w-full min-w-0 cursor-pointer items-center py-2 text-start disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-action",
          className,
        )}
      >
        <CodeName label={selected?.label ?? ""} className={cn("w-full", !selected?.value && "text-slate-400")} />
      </button>
      <Popover open={open} anchor={buttonRef} onClose={close}>
        <OptionList options={opts} value={current} onChoose={choose} />
      </Popover>
    </div>
  );
}

function OptionList({ options, value, onChoose }: { options: Opt[]; value: string; onChoose: (v: string) => void }) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = shown[active]; if (o && !o.disabled) onChoose(o.value); }
  };

  return (
    <div role="listbox" className="flex min-h-0 flex-col" onKeyDown={onKey}>
      {options.length > 8 && (
        <div className="relative mb-1.5 shrink-0">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input autoFocus value={query} placeholder="بحث" onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            className="h-9 w-full rounded-lg bg-subtle ps-9 pe-3 text-[15.5px] text-ink outline-none placeholder:text-slate-400" />
        </div>
      )}
      <div ref={listRef} className="min-h-0 overflow-y-auto overscroll-contain">
        {shown.length === 0 && <p className="px-3 py-2.5 text-[15px] text-slate-400">لا نتائج</p>}
        {shown.map((o, i) => {
          const isSel = o.value === value;
          return (
            <button key={`${o.value}-${i}`} type="button" role="option" aria-selected={isSel} data-index={i} disabled={o.disabled}
              onMouseEnter={() => setActive(i)} onClick={() => onChoose(o.value)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-[16px] transition-colors disabled:opacity-40",
                i === active && "bg-subtle",
                isSel ? "font-semibold text-ink" : "text-slate-700",
                !o.value && "text-slate-400",
              )}>
              <CodeName label={o.label} className="flex-1" />
              {isSel && o.value && <Check className="size-4 shrink-0 text-action" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

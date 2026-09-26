import Link from "@/components/link";
import { cn } from "@/lib/utils";

/** تبويبات تصفية (روابط حقيقية): تبويب واحد نشط، مع عدد اختياري */
export function FilterTabs({ items, active, className }: {
  items: { key: string; href: string; label: string; count?: number }[];
  active: string;
  className?: string;
}) {
  return (
    <nav className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-subtle p-1", className)}>
      {items.map((x) => {
        const on = x.key === active;
        return (
          <Link key={x.key} href={x.href} aria-current={on ? "page" : undefined}
            className={cn("flex items-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 py-1.5 text-[13px] transition-colors",
              on ? "bg-white font-semibold text-ink shadow-soft" : "font-medium text-slate-600 hover:text-ink")}>
            {x.label}
            {x.count !== undefined && (
              <span className={cn("num rounded-full px-1.5 text-[11px]", on ? "bg-ink text-white" : "bg-white text-slate-600")}>{x.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

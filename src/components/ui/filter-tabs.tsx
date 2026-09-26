"use client";

import { useId } from "react";
import { LayoutGroup, motion } from "motion/react";
import Link from "@/components/link";
import { cn } from "@/lib/utils";

/** تبويبات تصفية (روابط حقيقية): تبويب واحد نشط، ومؤشر أبيض ينزلق بينها */
export function FilterTabs({ items, active, className }: {
  items: { key: string; href: string; label: string; count?: number }[];
  active: string;
  className?: string;
}) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <nav className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-subtle p-1", className)}>
        {items.map((x) => {
          const on = x.key === active;
          return (
            <Link key={x.key} href={x.href} aria-current={on ? "page" : undefined}
              className={cn("relative flex items-center gap-2 whitespace-nowrap rounded-[10px] px-4 py-1.5 text-[16.5px] transition-colors duration-200",
                on ? "font-bold text-ink" : "font-medium text-slate-600 hover:text-ink")}>
              {on && (
                <motion.span layoutId="tab-pill" transition={{ type: "spring", stiffness: 520, damping: 38 }}
                  className="absolute inset-0 rounded-[10px] bg-white shadow-soft" />
              )}
              <span className="relative z-10">{x.label}</span>
              {x.count !== undefined && (
                <span className={cn("num relative z-10 rounded px-1.5 text-[14.5px]", on ? "bg-ink text-white" : "bg-white text-slate-600")}>{x.count}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}

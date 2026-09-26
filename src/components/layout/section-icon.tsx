"use client";

import { useSection } from "./use-section";

/** أيقونة الصفحة الحالية في مربع داكن (هوية كل قسم في رأس الصفحة) */
export function SectionIcon() {
  const section = useSection();
  const Icon = section?.item.icon;
  if (!Icon) return null;
  return (
    <span className="animate-pop flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-ink text-white shadow-[0_8px_18px_-8px_rgba(0,0,0,0.5)]">
      <Icon className="size-[22px] stroke-[1.75]" />
    </span>
  );
}

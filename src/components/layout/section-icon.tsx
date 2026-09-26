"use client";

import { useSection } from "./use-section";

/** أيقونة الصفحة الحالية في مربع داكن (هوية كل قسم في رأس الصفحة) */
export function SectionIcon() {
  const section = useSection();
  const Icon = section?.item.icon;
  if (!Icon) return null;
  return (
    <span className="animate-pop flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-ink text-white">
      <Icon className="size-[22px] stroke-[1.75]" />
    </span>
  );
}

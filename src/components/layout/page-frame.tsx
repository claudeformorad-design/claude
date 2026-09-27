"use client";

import { usePathname } from "next/navigation";
import { useSection } from "@/components/layout/use-section";

/**
 * إطار الصفحة: يُعاد تركيبه مع كل تنقّل (مفتاحه المسار) لحركة دخول CSS لا تُخفي شيئًا بلا JavaScript،
 * وأقسام الصفحة تظهر متتابعة، ولون القسم الحالي يُمرَّر كمتغير --section لكل عناصر الصفحة.
 * (بديل template.tsx الذي يطلق تحذير مفاتيح في Next 16)
 */
export function PageFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const section = useSection();
  const color = section && section.item.href !== "/" ? section.group.color : "#2483e1";
  return (
    <div key={pathname} className="page-enter stagger" style={{ ["--section" as string]: color }}>
      {children}
    </div>
  );
}

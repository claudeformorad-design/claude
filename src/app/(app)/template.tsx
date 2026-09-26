"use client";

import { useSection } from "@/components/layout/use-section";

/**
 * يُعاد تركيبه مع كل تنقّل: حركة دخول CSS (لا تُخفي شيئًا بلا JavaScript)، وأقسام الصفحة
 * تظهر متتابعة، ولون القسم الحالي يُمرَّر كمتغير --section لكل عناصر الصفحة.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const section = useSection();
  const color = section && section.item.href !== "/" ? section.group.color : "#2e90fa";
  return (
    <div className="page-enter stagger" style={{ ["--section" as string]: color }}>
      {children}
    </div>
  );
}

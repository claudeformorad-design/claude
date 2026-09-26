"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export const DENSITY_COOKIE = "table_density";

/** مريح / مضغوط — يغيّر مسافات كل الجداول فورًا ويُحفظ للزيارات التالية */
export function DensityToggle({ initial }: { initial: "comfortable" | "compact" }) {
  const [v, setV] = useState(initial);
  const set = (d: "comfortable" | "compact") => setV(d);
  useEffect(() => {
    document.documentElement.setAttribute("data-density", v);
    document.cookie = `${DENSITY_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
  }, [v]);
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-subtle p-1" role="group" aria-label="كثافة الجدول">
      {([["comfortable", "مريح"], ["compact", "مضغوط"]] as const).map(([k, label]) => (
        <button key={k} type="button" onClick={() => set(k)} aria-pressed={v === k}
          className={cn("rounded-md px-3.5 py-1.5 text-[16.5px] font-medium transition-colors",
            v === k ? "bg-ink text-white" : "text-slate-600 hover:text-ink")}>
          {label}
        </button>
      ))}
    </div>
  );
}

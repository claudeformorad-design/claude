import * as React from "react";
import { cn } from "@/lib/utils";

/** قائمة اختيار أصلية (native) — تعمل بشكل ممتاز مع RTL ولوحة المفاتيح وقوائم الحسابات الطويلة */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "flex h-9 w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAF9] px-3 py-1.5 text-xs text-[#0F172A] shadow-2xs outline-none transition-all focus:border-[#FFD369] focus:bg-white focus:ring-2 focus:ring-[#FFD369]/30 aria-invalid:border-red-500 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

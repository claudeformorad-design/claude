import * as React from "react";
import { cn } from "@/lib/utils";

/** قائمة اختيار أصلية (native) — تعمل بشكل ممتاز مع RTL ولوحة المفاتيح وقوائم الحسابات الطويلة */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn("h-10 cursor-pointer py-2 flex w-full min-w-0 rounded-xl border border-line bg-white px-3.5 text-[13px] text-ink outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-line-strong focus:border-brand-blue focus:ring-4 focus:ring-brand-blue/12 aria-invalid:border-brand-red aria-invalid:ring-brand-red/15 disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";

/** قائمة اختيار أصلية (native) — تعمل بشكل ممتاز مع RTL ولوحة المفاتيح وقوائم الحسابات الطويلة */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-card px-2 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

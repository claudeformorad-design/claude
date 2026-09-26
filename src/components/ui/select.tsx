import * as React from "react";
import { cn } from "@/lib/utils";

/** قائمة اختيار أصلية (native) — تعمل بشكل ممتاز مع RTL ولوحة المفاتيح وقوائم الحسابات الطويلة */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn("field-select h-11 cursor-pointer py-2 flex w-full min-w-0 field disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  );
}

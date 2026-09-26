import * as React from "react";
import { cn } from "@/lib/utils";
import { normalizeDigits } from "@/lib/accounting/money";

export function Input({ className, type, onChange, ...props }: React.ComponentProps<"input">) {
  const numeric = props.inputMode === "decimal" || props.inputMode === "numeric";
  return (
    <input
      type={type}
      data-slot="input"
      // الحقول الرقمية تقبل الأرقام العربية وتحوّلها فورًا (١٥٠٠٫٥ ⇒ 1500.5)
      onChange={numeric ? (e) => {
        const v = normalizeDigits(e.target.value);
        if (v !== e.target.value) e.target.value = v;
        onChange?.(e);
      } : onChange}
      className={cn("h-11 py-2 flex w-full min-w-0 field disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  );
}

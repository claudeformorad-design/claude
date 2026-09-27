"use client";

import * as React from "react";
import { DateField } from "@/components/ui/date-field";
import { cn } from "@/lib/utils";
import { normalizeDigits } from "@/lib/accounting/money";

export function Input({ className, type, onChange, onClick, ...props }: React.ComponentProps<"input">) {
  // حقول التاريخ بتقويم النظام بدل تقويم المتصفح
  if (type === "date") return <DateField className={className} onChange={onChange} onClick={onClick} {...props} />;
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
      // حقل الشهر: الضغط في أي مكان يفتح منتقي المتصفح
      onClick={type === "month" ? (e) => { try { e.currentTarget.showPicker?.(); } catch {} onClick?.(e); } : onClick}
      className={cn("h-11 py-2 flex w-full min-w-0 field disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  );
}

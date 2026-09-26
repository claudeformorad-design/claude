import * as React from "react";
import { cn } from "@/lib/utils";

export function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "destructive" | "success" | "warning" }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-2xl border px-5 py-3.5 text-xs font-semibold shadow-2xs",
        variant === "default" && "border-[#CBD5E1] bg-[#F8FAF9] text-[#0F172A]",
        variant === "warning" && "border-[#FFD369]/60 bg-[#FFD369]/15 text-[#222831]",
        variant === "destructive" && "border-red-200 bg-red-50 text-red-700",
        variant === "success" && "border-slate-300 bg-slate-100 text-[#222831]",
        className,
      )}
      {...props}
    />
  );
}

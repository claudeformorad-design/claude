import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-xl border border-[#CBD5E1] bg-[#F8FAF9] px-3 py-1.5 text-xs text-[#0F172A] shadow-2xs transition-all outline-none placeholder:text-[#94A3B8] disabled:cursor-not-allowed disabled:opacity-50",
        "focus:border-[#FFD369] focus:bg-white focus:ring-2 focus:ring-[#FFD369]/30",
        "aria-invalid:border-red-500 aria-invalid:ring-red-500/20",
        className,
      )}
      {...props}
    />
  );
}

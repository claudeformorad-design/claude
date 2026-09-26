import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full rounded-xl border border-[#CBD5E1] bg-[#F8FAF9] px-3 py-2 text-xs text-[#0F172A] shadow-2xs outline-none transition-all placeholder:text-[#94A3B8] focus:border-[#FFD369] focus:bg-white focus:ring-2 focus:ring-[#FFD369]/30 aria-invalid:border-red-500 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

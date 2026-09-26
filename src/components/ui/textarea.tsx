import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("min-h-20 py-2.5 flex w-full min-w-0 rounded-2xl border border-line bg-white/80 px-4 text-[13px] text-ink shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-blue focus:bg-white focus:ring-4 focus:ring-brand-blue/15 aria-invalid:border-brand-red aria-invalid:ring-brand-red/15 disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  );
}

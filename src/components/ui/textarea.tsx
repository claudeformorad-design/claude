import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("min-h-20 py-2.5 flex w-full min-w-0 rounded-[10px] border border-line bg-white px-3.5 text-[13px] text-ink outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-line-strong focus:border-slate-400 focus:ring-4 focus:ring-ink/5 aria-invalid:border-urgent aria-invalid:ring-urgent/15 disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  );
}

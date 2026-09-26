import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-xs font-bold whitespace-nowrap transition-colors", {
  variants: {
    variant: {
      default: "border-[#222831] bg-[#222831] text-[#FFD369] shadow-2xs",
      secondary: "border-[#CBD5E1] bg-[#F1F5F9] text-[#0F172A]",
      success: "border-slate-300 bg-slate-100 text-[#222831] font-bold",
      warning: "border-[#FFD369]/50 bg-[#FFD369]/20 text-[#222831] font-bold",
      destructive: "border-red-200 bg-red-50 text-red-700 font-bold",
      outline: "border-[#CBD5E1] bg-[#F8FAF9] text-[#64748B] font-medium",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

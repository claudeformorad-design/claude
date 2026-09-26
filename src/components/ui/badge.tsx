import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * وسم: مستطيل بحواف ناعمة (نمط Notion). الحالات: خلفية Tint فاتحة + نقطة ونص Shade من نفس اللون.
 * solid/outline للتصنيفات (مثل تجميعي/تفصيلي في شجرة الحسابات).
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[14px] font-medium leading-5",
  {
    variants: {
      variant: {
        default: "bg-neutral-tint text-neutral",
        secondary: "bg-neutral-tint text-neutral",
        outline: "border border-line-strong bg-white text-ink",
        solid: "bg-ink text-white",
        success: "bg-success-tint text-success before:size-1.5 before:rounded-full before:bg-success-dot before:content-['']",
        warning: "bg-amber-tint text-amber before:size-1.5 before:rounded-full before:bg-amber-dot before:content-['']",
        destructive: "bg-urgent-tint text-urgent before:size-1.5 before:rounded-full before:bg-urgent-dot before:content-['']",
        info: "bg-sky-tint text-sky before:size-1.5 before:rounded-full before:bg-sky-dot before:content-['']",
        review: "bg-sky-tint text-sky before:size-1.5 before:rounded-full before:bg-sky-dot before:content-['']",
        pending: "bg-urgent-tint text-urgent before:size-1.5 before:rounded-full before:bg-urgent-dot before:content-['']",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

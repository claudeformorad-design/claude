import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * وسم: مستطيل بحواف ناعمة (نمط Notion). الحالات: خلفية فاتحة ونص أغمق من نفس اللون، بلا نقاط.
 * solid/outline للتصنيفات (مثل تجميعي/تفصيلي في شجرة الحسابات).
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[15.5px] font-medium leading-5",
  {
    variants: {
      variant: {
        default: "bg-neutral-tint text-neutral",
        secondary: "bg-neutral-tint text-neutral",
        outline: "border border-line-strong bg-white text-ink",
        solid: "bg-ink text-white",
        success: "bg-success-tint text-success",
        warning: "bg-amber-tint text-amber",
        destructive: "bg-urgent-tint text-urgent",
        info: "bg-sky-tint text-sky",
        review: "bg-sky-tint text-sky",
        pending: "bg-urgent-tint text-urgent",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

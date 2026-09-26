import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** وسم حالة: حبة كاملة الاستدارة، خلفية باستيل فاتحة ونص أغمق من نفس العائلة */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-5",
  {
    variants: {
      variant: {
        default: "bg-neutral-tint text-neutral",
        secondary: "bg-neutral-tint text-neutral",
        outline: "bg-neutral-tint text-neutral",
        success: "bg-success-tint text-success",
        warning: "bg-amber-tint text-amber",
        destructive: "bg-urgent-tint text-urgent",
        info: "bg-info-tint text-info",
        review: "bg-review-tint text-review",
        pending: "bg-pending-tint text-pending",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

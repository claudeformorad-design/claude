import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-[13px] font-medium transition-all duration-200 cursor-pointer outline-none disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:ring-4 focus-visible:ring-brand-blue/20 active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "shine bg-ink text-white shadow-[0_8px_20px_-8px_rgba(14,17,22,0.6)] hover:bg-ink-soft hover:-translate-y-px",
        dark: "shine bg-ink text-white shadow-[0_8px_20px_-8px_rgba(14,17,22,0.6)] hover:bg-ink-soft hover:-translate-y-px",
        destructive: "bg-brand-red text-white shadow-[0_8px_20px_-10px_rgba(239,68,68,0.7)] hover:bg-red-600",
        outline: "border border-line bg-white/80 text-ink shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-white hover:border-slate-300",
        secondary: "bg-subtle text-ink hover:bg-slate-200/70",
        ghost: "text-ink hover:bg-white/70",
        link: "text-brand-blue underline-offset-4 hover:underline rounded-none",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3.5 text-xs",
        lg: "h-12 px-7 text-sm",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };

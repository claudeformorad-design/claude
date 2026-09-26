import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative isolate inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-[10px] text-[13px] font-medium transition-all duration-200 cursor-pointer outline-none disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75] focus-visible:ring-4 focus-visible:ring-ink/10 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-ink text-white hover:bg-ink-soft",
        dark: "bg-ink text-white hover:bg-ink-soft",
        destructive: "bg-urgent-tint text-urgent hover:bg-pending-tint",
        outline: "border border-line bg-white text-slate-700 hover:border-line-strong hover:text-ink",
        secondary: "bg-subtle text-slate-700 hover:bg-line hover:text-ink",
        ghost: "text-slate-700 hover:bg-subtle hover:text-ink",
        link: "rounded-none text-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs rounded-lg",
        lg: "h-11 px-6 text-sm",
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

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative isolate inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full text-[13px] font-normal transition-all duration-200 cursor-pointer outline-none disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:ring-4 focus-visible:ring-brand-blue/20 active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "bg-ink text-white hover:bg-ink-soft",
        dark: "bg-ink text-white hover:bg-ink-soft",
        destructive: "bg-brand-red text-white hover:brightness-95",
        outline: "border border-line bg-white text-ink hover:border-line-strong hover:bg-panel",
        secondary: "bg-subtle text-ink hover:bg-line",
        ghost: "text-ink hover:bg-white",
        link: "rounded-none text-brand-blue underline-offset-4 hover:underline",
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

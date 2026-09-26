import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-xs font-bold transition-all cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[#FFD369] active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-[#FFD369] hover:bg-[#F8CA4D] text-[#222831] font-extrabold shadow-xs rounded-xl",
        dark: "bg-[#222831] hover:bg-[#393E46] text-white font-bold shadow-xs rounded-xl",
        destructive: "bg-red-600 hover:bg-red-700 text-white shadow-xs rounded-xl",
        outline: "border border-[#CBD5E1] bg-white text-[#0F172A] shadow-2xs hover:border-[#FFD369] hover:bg-[#F8FAF9] rounded-xl",
        secondary: "bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] rounded-xl",
        ghost: "hover:bg-[#F1F5F9] text-[#0F172A] rounded-xl",
        link: "text-[#222831] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 rounded-xl",
        sm: "h-8 px-3 text-xs rounded-xl",
        lg: "h-11 px-6 text-sm rounded-xl",
        icon: "size-9 rounded-xl",
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

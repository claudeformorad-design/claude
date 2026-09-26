import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative isolate inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-[10px] text-[14px] font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] cursor-pointer outline-none disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75] focus-visible:ring-4 focus-visible:ring-ink/10 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-ink text-white shadow-[0_6px_14px_-8px_rgba(0,0,0,0.55)] hover:-translate-y-px hover:bg-ink-soft hover:shadow-[0_10px_20px_-10px_rgba(0,0,0,0.6)]",
        dark: "bg-ink text-white hover:bg-ink-soft",
        destructive: "bg-urgent-tint text-urgent hover:bg-pending-tint",
        outline: "border border-line bg-white text-slate-700 hover:border-line-strong hover:text-ink",
        secondary: "bg-subtle text-slate-700 hover:bg-line hover:text-ink",
        ghost: "text-slate-700 hover:bg-subtle hover:text-ink",
        link: "rounded-none text-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-8 px-3 text-xs rounded-lg",
        lg: "h-11 px-6 text-sm",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** أثناء تنفيذ العملية: مؤشر دوران ويُمنع الضغط المكرر */
  loading?: boolean;
}

export function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  if (asChild) {
    return <Slot data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props}>{children}</Slot>;
  }
  return (
    <button data-slot="button" aria-busy={loading || undefined} disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }), loading && "cursor-wait")} {...props}>
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export { buttonVariants };

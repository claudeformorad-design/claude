import * as React from "react";
import { cn } from "@/lib/utils";

export function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "destructive" | "success" | "warning" }) {
  return (
    <div
      role="alert"
      className={cn(
        "animate-fade rounded-xl px-5 py-3.5 text-[14px] leading-relaxed",
        variant === "default" && "bg-neutral-tint text-slate-700",
        variant === "warning" && "bg-amber-tint text-amber",
        variant === "destructive" && "bg-urgent-tint text-urgent",
        variant === "success" && "bg-success-tint text-success",
        className,
      )}
      {...props}
    />
  );
}

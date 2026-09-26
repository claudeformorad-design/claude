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
        "animate-fade rounded-2xl border px-5 py-3.5 text-[13px]",
        variant === "default" && "border-line bg-white text-ink",
        variant === "warning" && "border-amber-200 bg-amber-50 text-amber-800",
        variant === "destructive" && "border-red-200 bg-red-50 text-red-700",
        variant === "success" && "border-green-200 bg-green-50 text-green-800",
        className,
      )}
      {...props}
    />
  );
}

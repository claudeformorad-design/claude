import * as React from "react";
import { cn } from "@/lib/utils";

export function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "destructive" | "success" }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        variant === "destructive" && "border-destructive/30 bg-destructive/5 text-destructive",
        variant === "success" && "border-success/30 bg-success/5 text-success",
        className,
      )}
      {...props}
    />
  );
}

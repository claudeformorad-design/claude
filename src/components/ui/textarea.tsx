import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("min-h-24 py-3 flex w-full min-w-0 field disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  );
}

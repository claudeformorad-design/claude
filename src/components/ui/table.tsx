import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto rounded-2xl border border-[#E2E8F0] bg-white shadow-2xs">
      <table className={cn("w-full caption-bottom text-xs border-collapse", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead className={cn("bg-[#F8FAF9] border-b border-[#E2E8F0] uppercase tracking-wider text-[11px] font-extrabold text-[#475569]", className)} {...props} />
  );
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0 divide-y divide-[#E2E8F0]/70", className)} {...props} />;
}

export function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot className={cn("border-t-2 border-[#1E293B] bg-[#F8FAF9] font-extrabold text-xs text-[#0F172A]", className)} {...props} />
  );
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-[#E2E8F0]/70 transition-all hover:bg-[#F1F5F9]/60 hover:text-[#0F172A]",
        className
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("h-11 px-4 text-start align-middle font-extrabold whitespace-nowrap text-[#475569] text-[11px]", className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3.5 align-middle text-xs text-[#0F172A] font-medium", className)} {...props} />;
}

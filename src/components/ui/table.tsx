import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table" className="surface relative w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom border-collapse text-[14px]", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b-2 border-thead-line bg-thead text-[13px] text-thead-text [&_tr]:hover:bg-thead", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("rows-animate [&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot className={cn("border-t-2 border-thead-line bg-[#faf7ef] text-[14px] font-bold text-ink [&_tr]:hover:bg-[#faf7ef]", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-line/70 transition-colors duration-150 hover:bg-[#fafaf8]", className)} {...props} />;
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("h-12 whitespace-nowrap px-5 text-start align-middle font-bold tracking-tight first:ps-6 last:pe-6", className)} {...props} />;
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-5 py-3.5 align-middle text-[14px] text-ink first:ps-6 last:pe-6", className)} {...props} />;
}

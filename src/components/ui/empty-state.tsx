import React from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "@/components/link";

export function EmptyState({
  title = "لا توجد بيانات حالياً",
  description = "لم يتم تسجيل أي حركات أو بيانات حتى الآن.",
  actionHref,
  actionLabel,
  icon: Icon = FolderOpen,
}: {
  title?: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <div className="animate-pop mb-4 flex size-16 items-center justify-center rounded-3xl bg-gradient-to-br from-white to-subtle text-slate-500 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.25)] ring-1 ring-line">
        <Icon className="size-7 stroke-[1.5]" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>
      {actionHref && actionLabel && (
        <Button asChild className="mt-5" size="sm">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}

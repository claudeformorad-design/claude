import { tr } from "@/i18n/tr";
import React from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "@/components/link";

export function EmptyState({
  title = tr("لا توجد بيانات حالياً"),
  description = tr("لم يتم تسجيل أي حركات أو بيانات حتى الآن."),
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
      <div className="animate-pop mb-4 flex size-12 items-center justify-center rounded-lg bg-subtle text-slate-500">
        <Icon className="size-6 stroke-[1.5]" />
      </div>
      <h3 className="text-[18.5px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-[16.5px] leading-relaxed text-muted-foreground">{description}</p>
      {actionHref && actionLabel && (
        <Button asChild className="mt-5" size="sm" variant="outline">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}

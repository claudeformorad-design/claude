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
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-[#F1F5F9] text-[#64748B] mb-3 shadow-2xs border border-[#E2E8F0]">
        <Icon className="size-7 stroke-[1.5]" />
      </div>
      <h3 className="text-sm sm:text-base font-extrabold text-[#0F172A]">{title}</h3>
      <p className="max-w-md text-xs text-[#64748B] font-medium mt-1 leading-relaxed">{description}</p>
      {actionHref && actionLabel && (
        <Button asChild className="mt-4" size="sm">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}

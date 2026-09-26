"use client";

import { useSection } from "./use-section";

/**
 * رأس موحّد لكل الصفحات: بطاقة بأيقونة الصفحة بلون قسمها، واسم القسم، والعنوان والوصف،
 * والإجراءات في الجهة المقابلة.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  const section = useSection();
  const Icon = section?.item.icon;
  return (
    <div className="surface relative mb-5 flex flex-wrap items-center justify-between gap-4 overflow-hidden p-5">
      <span aria-hidden className="absolute inset-y-0 start-0 w-1 bg-[var(--section)]" />
      <div className="flex min-w-0 items-center gap-4">
        {Icon && (
          <span className="animate-pop flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--section)] text-white">
            <Icon className="size-[22px]" />
          </span>
        )}
        <div className="min-w-0 space-y-0.5">
          {section?.group.title && section.group.items.length > 1 && (
            <p className="text-[12px] font-medium text-[var(--section)]">{section.group.title}</p>
          )}
          <h1 className="text-[24px] font-normal leading-tight tracking-tight text-ink">{title}</h1>
          {description && <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

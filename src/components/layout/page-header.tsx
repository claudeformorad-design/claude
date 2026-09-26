import { SectionIcon } from "./section-icon";

/**
 * رأس موحّد لكل الصفحات: أيقونة القسم في مربع داكن، ثم العنوان والوصف، والإجراءات في الجهة المقابلة
 * (اسم القسم في مسار التنقّل أعلاه). الزر الأساسي الأسود (إن وُجد) هو نقطة التركيز الوحيدة.
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
  return (
    <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <SectionIcon />
        <div className="min-w-0 space-y-1">
          <h1 className="type-display text-[32px] text-ink">{title}</h1>
          {description && <p className="type-body max-w-3xl text-[17px] text-slate-600">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

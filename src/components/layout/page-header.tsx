/** رأس موحّد لكل الصفحات: اسم الصفحة فقط، والإجراءات في الجهة المقابلة */
export function PageHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
      <h1 className="type-display min-w-0 text-[32px] text-ink">{title}</h1>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

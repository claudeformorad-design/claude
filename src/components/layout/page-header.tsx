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
    <div className="animate-rise mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1.5">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink sm:text-[32px]">{title}</h1>
        {description && <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

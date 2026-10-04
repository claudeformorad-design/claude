/** هيكل تحميل لامع يظهر فورًا أثناء جلب بيانات الصفحة */
import { tr } from "@/i18n/tr";
export default function Loading() {
  return (
    <div className="animate-fade space-y-6" aria-busy="true" aria-label={tr("جارٍ التحميل")}>
      <div className="space-y-3">
        <div className="skeleton h-4 w-56 rounded" />
        <div className="skeleton h-9 w-80 rounded-[20px]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="surface space-y-4 p-5">
            <div className="skeleton size-11 rounded-[20px]" />
            <div className="skeleton h-7 w-2/3 rounded-lg" />
            <div className="skeleton h-3 w-1/2 rounded" />
          </div>
        ))}
      </div>
      <div className="surface space-y-3 p-5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-10 rounded-[20px]" style={{ opacity: 1 - i * 0.12 }} />
        ))}
      </div>
    </div>
  );
}

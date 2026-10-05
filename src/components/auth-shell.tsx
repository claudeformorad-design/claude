import { tr } from "@/i18n/tr";
import { BRAND_N } from "@/components/brand-mark";
import { LanguageSwitch } from "@/components/language-switch";

/**
 * علامة نزيل متحركة: المربع (الغرفة) يظهر، ثم حرف N، ثم تنزل النقطة الزرقاء (النزيل) إلى مكانها.
 * الحركة مرة واحدة عند فتح الصفحة، وتتوقف لمن يفضّل تقليل الحركة.
 */
function ArrivingMark() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className="size-[76px] overflow-visible">
      <rect className="mark-room" width="100" height="100" rx="24" fill="#312F2E" />
      <path className="mark-letter" fill="#FFFFFF" d={BRAND_N} />
      <circle className="mark-guest" cx="69.94" cy="69.75" r="5.25" fill="#2483E1" />
    </svg>
  );
}

/** إطار صفحات ما قبل الدخول: العلامة واسم النظام، ثم المحتوى (ابدأ، الدخول، رابط الموظف) */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-[#f7f5f0] px-6 py-16">
      <LanguageSwitch className="absolute end-5 top-5" />
      <div className="flex w-full max-w-[360px] flex-col items-center">
        <ArrivingMark />
        <p className="auth-in mt-7 text-[34px] font-bold leading-none tracking-tight text-ink" style={{ animationDelay: "650ms" }}>{tr("نزيل")}</p>
        <p className="auth-in mt-3 text-[15.5px] text-slate-500" style={{ animationDelay: "750ms" }}>{tr("إدارة الفندق والمحاسبة")}</p>
        <div className="auth-in mt-12 w-full" style={{ animationDelay: "900ms" }}>{children}</div>
      </div>
    </main>
  );
}

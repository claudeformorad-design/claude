import { tr } from "@/i18n/tr";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getAppContext } from "@/lib/auth/context";
import { currentLocalUserId, getAuthMode, mustChangePassword } from "@/lib/supabase/local-auth";
import { PasswordForm } from "./password-form";
import { loginName } from "@/lib/auth/staff";

export default async function ChangePasswordPage() {
  let forced: boolean;
  let firstPassword = false;
  let username: string | null = null;
  if (isSupabaseConfigured()) {
    const ctx = await getAppContext();
    if (!ctx.user) redirect("/login");
    const profile = "profile" in ctx ? ctx.profile : null;
    firstPassword = profile?.password_chosen === false;
    forced = (ctx.hotel ? profile?.must_change_password === true : false) || firstPassword;
    username = loginName(ctx.user.email) || null;
  } else {
    if ((await getAuthMode()) !== "multi") redirect("/");
    const userId = await currentLocalUserId();
    if (!userId) redirect("/login");
    forced = await mustChangePassword(userId);
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="surface animate-rise w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark className="size-11" />
          <p className="text-lg font-semibold text-ink">{tr("تغيير كلمة المرور")}</p>
        </div>
        {username && (
          <p className="mb-4 text-[15.5px] text-slate-600">{tr("اسم المستخدم للدخول")} <span dir="ltr" className="font-semibold text-ink">{username}</span></p>
        )}
        {firstPassword ? <p className="mb-4 text-[15.5px] leading-relaxed text-slate-600">{tr("جهازك داخل النظام بدون كلمة مرور. اختر كلمة مرور إذا أردت الدخول من جهاز آخر.")}</p>
          : forced && <p className="mb-4 text-[15.5px] leading-relaxed text-slate-600">{tr("هذه كلمة مرور مؤقتة من مدير النظام. اختر كلمة مرور خاصة بك قبل المتابعة.")}</p>}
        <PasswordForm forced={forced} />
      </div>
    </main>
  );
}

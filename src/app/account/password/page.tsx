import { tr } from "@/i18n/tr";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { currentLocalUserId, getAuthMode, mustChangePassword } from "@/lib/supabase/local-auth";
import { PasswordForm } from "./password-form";

export default async function ChangePasswordPage() {
  if (isSupabaseConfigured() || (await getAuthMode()) !== "multi") redirect("/");
  const userId = await currentLocalUserId();
  if (!userId) redirect("/login");
  const forced = await mustChangePassword(userId);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="surface animate-rise w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark className="size-11" />
          <p className="text-lg font-semibold text-ink">{tr("تغيير كلمة المرور")}</p>
        </div>
        {forced && <p className="mb-4 text-[15.5px] leading-relaxed text-slate-600">{tr("هذه كلمة مرور مؤقتة من مدير النظام. اختر كلمة مرور خاصة بك قبل المتابعة.")}</p>}
        <PasswordForm forced={forced} />
      </div>
    </main>
  );
}

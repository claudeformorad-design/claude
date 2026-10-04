import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitch } from "@/components/language-switch";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { currentLocalUserId, getAuthMode } from "@/lib/supabase/local-auth";
import { getI18n } from "@/i18n/server";
import { LoginForm } from "./login-form";
import { LocalLoginForm } from "./local-login-form";

export default async function LoginPage() {
  const local = !isSupabaseConfigured();
  // التثبيت المحلي: لا دخول في وضع المستخدم الواحد، ومن له جلسة سارية يدخل مباشرة
  if (local && ((await getAuthMode()) === "single" || (await currentLocalUserId()))) redirect("/");
  const { t } = await getI18n();
  return (
    <main className="relative flex min-h-screen items-center justify-center p-4">
      <LanguageSwitch className="absolute end-4 top-4" />
      <div className="surface animate-rise w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark className="size-11" />
          <p className="text-lg font-semibold text-ink">{t.app.name}</p>
        </div>
        {local ? <LocalLoginForm /> : <LoginForm t={{ auth: t.auth, errors: t.errors }} />}
      </div>
    </main>
  );
}

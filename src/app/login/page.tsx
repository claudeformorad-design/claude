import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getI18n } from "@/i18n/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  // وضع التجربة المحلي لا يحتاج تسجيل دخول
  if (!isSupabaseConfigured()) redirect("/");
  const { t } = await getI18n();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="surface animate-rise w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg bg-ink text-white"><Building2 className="size-5 stroke-[1.75]" /></div>
          <p className="text-lg font-semibold text-ink">{t.app.name}</p>
        </div>
        <LoginForm t={{ auth: t.auth, errors: t.errors }} />
      </div>
    </main>
  );
}

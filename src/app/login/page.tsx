import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { currentLocalUserId, getAuthMode } from "@/lib/supabase/local-auth";
import { getI18n } from "@/i18n/server";
import { LoginForm } from "./login-form";
import { LocalLoginForm } from "./local-login-form";
import { StartButton } from "./start-button";
import { anonRpc } from "@/lib/supabase/public-rpc";
import { tr } from "@/i18n/tr";

export default async function LoginPage() {
  const local = !isSupabaseConfigured();
  // التثبيت المحلي: لا دخول في وضع المستخدم الواحد، ومن له جلسة سارية يدخل مباشرة
  if (local && ((await getAuthMode()) === "single" || (await currentLocalUserId()))) redirect("/");
  const { t } = await getI18n();
  // النسخة المنشورة قبل أن يكون لها صاحب: زر واحد يجعل هذا الجهاز جهاز المدير
  const fresh = !local && (await anonRpc<boolean>("system_has_owner", {})).data === false;
  return (
    <AuthShell>
      {local ? <LocalLoginForm /> : fresh ? (
        <div className="space-y-5 text-center">
          <StartButton />
          <p className="text-[14.5px] leading-relaxed text-slate-500">{tr("ضع كلمة مرور لاحقًا لتدخل من أي جهاز.")}</p>
        </div>
      ) : <LoginForm t={{ auth: t.auth, errors: t.errors }} />}
    </AuthShell>
  );
}

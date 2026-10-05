import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { currentLocalUserId, getAuthMode } from "@/lib/supabase/local-auth";
import { getI18n } from "@/i18n/server";
import { LoginForm } from "./login-form";
import { LocalLoginForm } from "./local-login-form";
import { StartButton } from "./start-button";
import { anonRpc } from "@/lib/supabase/public-rpc";
import { tr } from "@/i18n/tr";

const STEPS = [
  { get title() { return tr("تصبح مدير النظام"); }, get text() { return tr("هذا الجهاز يبقى مسجّلًا باسمك."); } },
  { get title() { return tr("تنشئ فندقك"); }, get text() { return tr("الاسم والعملة وبداية السنة المالية."); } },
  { get title() { return tr("تضيف موظفيك"); }, get text() { return tr("ولكل موظف رابط دخول ترسله له."); } },
];

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
        <div className="space-y-8">
          <div className="space-y-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-action/10 px-3 py-1 text-[14px] font-medium text-action">
              <span className="size-1.5 rounded-full bg-action" />{tr("نظام جديد")}
            </span>
            <h1 className="text-[32px] font-bold leading-tight text-ink">{tr("أهلًا بك في نظامك")}</h1>
            <p className="text-[16.5px] leading-relaxed text-slate-600">{tr("اضغط ابدأ لتصبح مدير النظام.")}</p>
          </div>
          <StartButton />
          <ol className="space-y-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex items-start gap-3.5">
                <span className="num grid size-8 shrink-0 place-items-center rounded-full border border-line-strong bg-white text-[15px] font-semibold text-ink">{i + 1}</span>
                <span className="pt-0.5">
                  <span className="block font-semibold text-ink">{s.title}</span>
                  <span className="text-[15px] text-slate-500">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="flex items-start gap-2.5 border-t border-line pt-5 text-[14.5px] leading-relaxed text-slate-500">
            <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-success" />
            {tr("يمكنك لاحقًا وضع كلمة مرور للدخول من جهاز آخر.")}
          </p>
        </div>
      ) : <LoginForm t={{ auth: t.auth, errors: t.errors }} />}
    </AuthShell>
  );
}

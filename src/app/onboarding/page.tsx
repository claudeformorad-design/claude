import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/i18n/server";
import { OnboardingForm } from "./onboarding-form";
import { tr } from "@/i18n/tr";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { signOutAction } from "../login/actions";

export default async function OnboardingPage() {
  const ctx = await getAppContext();
  if (!ctx.user) redirect("/login");
  if (ctx.hotel) redirect("/");

  const { locale, t } = await getI18n();
  const supabase = await createClient();
  // في النسخة المنشورة ينشئ الفنادق صاحب النظام وحده: الموظف بلا فندق (أُوقف أو حُذف أو فُرمت النظام) يرى السبب ويخرج
  if (isSupabaseConfigured() && (await supabase.rpc("is_system_owner")).data !== true) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f5f0] p-6">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-white p-8 text-center">
          <p className="text-[22px] font-bold text-ink">{tr("لا يوجد فندق مرتبط بحسابك")}</p>
          <p className="leading-relaxed text-slate-600">{tr("قد يكون المدير أوقف دخولك أو حذف حسابك. تواصل معه ليعطيك رابط دخول جديد.")}</p>
          <form action={signOutAction}><Button type="submit" variant="dark" className="h-11 w-full">{tr("تسجيل الخروج")}</Button></form>
        </div>
      </main>
    );
  }
  const { data: currencies } = await supabase.from("currencies").select("code, name_ar, name_en").eq("is_active", true).order("code");

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="animate-rise w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-xl">{t.onboarding.title}</CardTitle>
          <CardDescription>{t.onboarding.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm
            locale={locale}
            t={{ onboarding: t.onboarding, errors: t.errors, months: t.months }}
            currencies={(currencies ?? []).map((c) => ({ code: c.code, name: locale === "ar" ? c.name_ar : c.name_en }))}
          />
        </CardContent>
      </Card>
    </main>
  );
}

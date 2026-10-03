import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/i18n/server";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const ctx = await getAppContext();
  if (!ctx.user) redirect("/login");
  if (ctx.hotel) redirect("/");

  const { locale, t } = await getI18n();
  const supabase = await createClient();
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

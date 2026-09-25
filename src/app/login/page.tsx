import { Card, CardContent } from "@/components/ui/card";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { getI18n } from "@/i18n/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const { locale, t } = await getI18n();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="text-center">
        <p className="text-2xl font-bold text-primary">{t.app.name}</p>
      </div>
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <LoginForm t={{ auth: t.auth, errors: t.errors }} />
        </CardContent>
      </Card>
      <LocaleSwitcher locale={locale} label={t.common.language} />
    </main>
  );
}

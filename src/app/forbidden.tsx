import Link from "@/components/link";
import { getI18n } from "@/i18n/server";
import { Button } from "@/components/ui/button";

export default async function Forbidden() {
  const { t } = await getI18n();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-5xl font-bold text-muted-foreground">403</p>
      <p className="text-lg">{t.errors.permission_denied}</p>
      <Button asChild variant="outline">
        <Link href="/">{t.nav.dashboard}</Link>
      </Button>
    </div>
  );
}

import { ShieldAlert } from "lucide-react";
import Link from "@/components/link";
import { getI18n } from "@/i18n/server";
import { Button } from "@/components/ui/button";

export default async function Forbidden() {
  const { t } = await getI18n();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="animate-pop flex size-20 items-center justify-center rounded-[28px] bg-ink text-white shadow-xl">
        <ShieldAlert className="size-9" />
      </div>
      <p className="animate-rise text-5xl font-semibold text-ink">403</p>
      <p className="animate-rise text-[15px] text-muted-foreground">{t.errors.permission_denied}</p>
      <Button asChild variant="outline">
        <Link href="/">{t.nav.dashboard}</Link>
      </Button>
    </div>
  );
}

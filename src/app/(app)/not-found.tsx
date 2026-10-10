import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";

/** مستند غير موجود (قيد، فاتورة، فوليو...) أو محذوف، أو رابط لا يخص هذا الفندق */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="num text-5xl font-bold text-ink">404</p>
      <p className="text-[18.5px] text-ink">{tr("المستند أو الصفحة غير موجودة")}</p>
      <p className="max-w-md text-[16.5px] leading-relaxed text-muted-foreground">{tr("ربما الرابط غير صحيح، أو المستند يخص فندقًا آخر.")}</p>
      <Button asChild variant="outline" className="mt-2">
        <Link href="/">{tr("الصفحة الرئيسية")}</Link>
      </Button>
    </div>
  );
}

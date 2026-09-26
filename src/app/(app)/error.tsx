"use client";

import { useEffect } from "react";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";

/** خطأ أثناء تحميل صفحة داخل النظام: يبقى الشريط الجانبي والعلوي، مع إعادة محاولة */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-[18px] font-semibold text-ink">تعذّر تحميل هذه الصفحة</p>
      <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
        حدث خطأ أثناء قراءة البيانات. أعد المحاولة، وإن تكرر فارجع إلى لوحة التحكم.
      </p>
      {error.digest && <p className="num text-[13px] text-slate-400">{error.digest}</p>}
      <div className="mt-2 flex gap-2">
        <Button onClick={reset}>إعادة المحاولة</Button>
        <Button asChild variant="outline">
          <Link href="/">لوحة التحكم</Link>
        </Button>
      </div>
    </div>
  );
}

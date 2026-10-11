"use client";
import { tr } from "@/i18n/tr";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { recheckAction } from "@/app/activate/actions";

export function RecheckButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" loading={pending} onClick={() => start(async () => {
      const r = await recheckAction();
      if (r.ok) { toast(tr("تم التحقق من لوحة نزيل")); router.refresh(); } else toast(r.message);
    })}><RefreshCw />{tr("تحقق الآن")}</Button>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, AlertOctagon, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resetHotelDataAction } from "../../_admin/actions";

export function ResetHotelDataButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleReset = () => {
    startTransition(async () => {
      setFailed(false);
      const res = await resetHotelDataAction();
      if (!res.ok) setFailed(true);
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => { router.replace("/onboarding"); router.refresh(); }, 800);
      }
    });
  };

  return (
    <div className="rounded-lg bg-urgent-tint/60 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <AlertOctagon className="size-4 stroke-[1.75] text-urgent" />
            <h4 className="text-[17.5px] font-semibold text-ink">تصفير وضع التجربة بالكامل</h4>
          </div>
          <p className="max-w-xl text-[16.5px] leading-relaxed text-muted-foreground">
            يحذف قاعدة بيانات التجربة المحلية بالكامل (الفندق، الإعدادات، القيود، الفوليو، الفواتير، السندات وكل الحركات) ويعيدك لشاشة إعداد فندق جديد. متاح في وضع التجربة فقط، ولا يمكن التراجع عنه.
          </p>
        </div>

        {!open ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => setOpen(true)}
            className="shrink-0 bg-white text-urgent shadow-soft hover:bg-white"
          >
            <RotateCcw className="size-3.5 me-1" />
            تصفير بيانات النظام
          </Button>
        ) : (
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setConfirmed(false);
                }}
                
              >
                إلغاء
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={!confirmed || isPending || success}
                onClick={handleReset}
                className="bg-urgent text-white hover:bg-pending"
              >
                {success ? (
                  <>
                    <Check className="size-3.5 me-1" />
                    تم التصفير بنجاح!
                  </>
                ) : isPending ? (
                  "جاري التصفير..."
                ) : (
                  "تأكيد الحذف الكامل الآن"
                )}
              </Button>
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-[15.5px] text-slate-600">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="size-3.5"
              />
              أنا متأكد من حذف جميع بيانات التجربة
            </label>
            {failed && <p className="text-[15.5px] text-urgent">تعذّر التصفير — أعد المحاولة، وإن تكرر فأعد تشغيل الخادم.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

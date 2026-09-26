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

  const handleReset = () => {
    startTransition(async () => {
      const res = await resetHotelDataAction();
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => { router.replace("/onboarding"); router.refresh(); }, 800);
      }
    });
  };

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/50 p-5 shadow-2xs">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <AlertOctagon className="size-4 text-red-600 font-bold" />
            <h4 className="text-sm font-bold text-red-900">تصفير وضع التجربة بالكامل</h4>
          </div>
          <p className="text-xs text-red-700 max-w-xl">
            يحذف قاعدة بيانات التجربة المحلية بالكامل (الفندق، الإعدادات، القيود، الفوليو، الفواتير، السندات وكل الحركات) ويعيدك لشاشة إعداد فندق جديد. متاح في وضع التجربة فقط، ولا يمكن التراجع عنه.
          </p>
        </div>

        {!open ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-xl bg-red-600 hover:bg-red-700 text-xs font-bold text-white shadow-xs"
          >
            <RotateCcw className="size-3.5 mr-1" />
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
                className="rounded-xl text-xs"
              >
                إلغاء
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={!confirmed || isPending || success}
                onClick={handleReset}
                className="rounded-xl bg-red-700 hover:bg-red-800 text-xs font-extrabold text-white"
              >
                {success ? (
                  <>
                    <Check className="size-3.5 mr-1" />
                    تم التصفير بنجاح!
                  </>
                ) : isPending ? (
                  "جاري التصفير..."
                ) : (
                  "تأكيد الحذف الكامل الآن"
                )}
              </Button>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-red-800 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="size-3.5 rounded border-red-300 text-red-600"
              />
              أنا متأكد من حذف جميع بيانات التجربة
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

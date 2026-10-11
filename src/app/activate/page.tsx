import { tr } from "@/i18n/tr";
import { redirect } from "next/navigation";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { machineId } from "@/lib/license/client";
import { ActivateForm } from "./activate-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "تفعيل النظام" };

/** شاشة التفعيل: كود الربط من لوحة نزيل، أو مفتاح يدوي لجهاز بلا إنترنت */
export default async function ActivatePage() {
  const ctx = await getAppContext();
  if (!ctx.user) redirect("/login");
  if (!ctx.hotel) redirect("/onboarding");
  const full = ctx as AppContext;
  if (!full.license.required || full.license.ok) redirect("/");
  const reason = full.license.reason;
  return (
    <main className="flex min-h-screen items-center justify-center bg-content px-4 py-12">
      <div className="surface w-full max-w-lg space-y-6 p-8">
        <div className="space-y-1.5">
          <h1 className="text-[26px] font-bold text-ink">{tr("تفعيل نزيل")}</h1>
          <p className="text-[16.5px] leading-relaxed text-slate-600">
            {reason === "suspended" ? tr("هذا الفندق موقوف من صاحب النظام. تواصل معه، وبعد إعادة التفعيل اضغط تحقق الآن.")
              : reason === "other_machine" ? tr("ترخيص هذا النظام لجهاز آخر. أرسل رقم هذا الجهاز لصاحب النظام ليعطيك مفتاحًا جديدًا.")
              : tr("اكتب كود الربط الذي أعطاك إياه صاحب النظام. مرة واحدة فقط، وبعدها يعمل النظام مباشرة.")}
          </p>
        </div>
        {full.can(PERMISSIONS.hotelManage)
          ? <ActivateForm suspended={reason === "suspended"} machine={isSupabaseConfigured() ? null : machineId()} />
          : <p className="rounded-lg bg-subtle p-4 text-[16px] text-slate-700">{tr("النظام بانتظار تفعيل مدير الفندق.")}</p>}
      </div>
    </main>
  );
}

import { tr } from "@/i18n/tr";
import { BadgeCheck } from "lucide-react";
import type { LicenseStatus } from "@/lib/license/client";
import { RecheckButton } from "./recheck-button";

/** حالة الترخيص من لوحة نزيل: الفندق، الربط، آخر تواصل */
export function LicenseCard({ license }: { license: Extract<LicenseStatus, { ok: true }> }) {
  const last = license.lastCheckin ? license.lastCheckin.slice(0, 16).replace("T", " ") : null;
  return (
    <section className="surface mb-6 flex flex-wrap items-center gap-4 p-5" data-testid="license-card">
      <span className="flex size-10 items-center justify-center rounded-lg bg-success-tint text-success"><BadgeCheck className="size-5" /></span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[17px] font-semibold text-ink">{tr("مرخّص لـ {0}", license.license.hotel_name)}</p>
        <p className="text-[15px] text-slate-600">
          {license.linked
            ? last ? tr("مربوط بلوحة نزيل، آخر تواصل {0}", last) : tr("مربوط بلوحة نزيل")
            : tr("مفعّل بمفتاح يدوي على هذا الجهاز")}
          {"، "}{tr("التحديثات مجانية للأبد")}
        </p>
        {license.lastError && <p className="text-[14px] text-amber">{tr("تعذر آخر تواصل مع اللوحة، والترخيص الحالي يعمل.")}</p>}
      </div>
      {license.linked && <RecheckButton />}
    </section>
  );
}

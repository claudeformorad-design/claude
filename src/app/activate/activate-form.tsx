"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { activateCodeAction, activateKeyAction, recheckAction } from "./actions";

export function ActivateForm({ suspended, machine }: { suspended: boolean; machine: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [key, setKey] = useState("");
  const [manual, setManual] = useState(false);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => start(async () => {
    setError(null);
    const r = await fn().catch(() => ({ ok: false as const, message: tr("حدث خطأ غير متوقع، حاول مرة أخرى") }));
    if (r.ok) { router.push("/"); router.refresh(); } else setError(r.message);
  });

  if (suspended) {
    return (
      <div className="space-y-4">
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button loading={pending} onClick={() => run(recheckAction)}>{tr("تحقق الآن")}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && <Alert variant="destructive">{error}</Alert>}
      {!manual ? (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => activateCodeAction(code)); }}>
          <div className="field-group space-y-1.5">
            <Label htmlFor="activation_code">{tr("كود الربط")}</Label>
            <Input id="activation_code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="NZL-XXXX-XXXX" autoComplete="off" autoFocus className="text-center text-[20px] tracking-wider" />
          </div>
          <Button type="submit" loading={pending} disabled={code.trim().length < 6} className="w-full">{tr("تفعيل الآن")}</Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => activateKeyAction(key)); }}>
          {machine && (
            <div className="space-y-1.5 rounded-lg bg-subtle p-4">
              <p className="text-[15px] text-slate-600">{tr("رقم هذا الجهاز، أرسله لصاحب النظام:")}</p>
              <p className="num text-center text-[22px] font-bold tracking-wider text-ink" dir="ltr" data-testid="machine-id">{machine}</p>
            </div>
          )}
          <div className="field-group space-y-1.5">
            <Label htmlFor="license_key">{tr("المفتاح اليدوي")}</Label>
            <Textarea id="license_key" dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} className="h-28 font-mono text-[12px]" />
          </div>
          <Button type="submit" loading={pending} disabled={key.trim().length < 20} className="w-full">{tr("تفعيل بالمفتاح")}</Button>
        </form>
      )}
      <button type="button" className="text-[15px] font-medium text-action hover:underline" onClick={() => { setManual(!manual); setError(null); }}>
        {manual ? tr("عندي كود ربط") : tr("لا يوجد إنترنت؟ فعّل بمفتاح يدوي")}
      </button>
    </div>
  );
}

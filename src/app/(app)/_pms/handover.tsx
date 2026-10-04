"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import type { RoomAccess } from "@/lib/supabase/database.types";
import { checkInAction } from "./actions";

/** كلمات ما يُسلَّم للنزيل حسب إعداد الفندق: بطاقة أو مفتاح */
export function accessWords(access: RoomAccess) {
  return access === "key"
    ? { one: tr("المفتاح"), count: tr("عدد المفاتيح"), confirm: tr("سلّمتُ المفتاح للنزيل"), done: tr("تم التسكين وتسليم المفتاح"), issued: tr("المفاتيح المسلّمة"), collect: tr("استلم المفاتيح من النزيل عند المغادرة، وعددها") }
    : { one: tr("البطاقة"), count: tr("عدد البطاقات"), confirm: tr("سلّمتُ البطاقة للنزيل"), done: tr("تم التسكين وتسليم البطاقة"), issued: tr("البطاقات المسلّمة"), collect: tr("استلم البطاقات من النزيل عند المغادرة، وعددها") };
}

/** حقلا التسليم: العدد، وتأكيد أن الموظف سلّمها بيده للنزيل */
export function HandoverFields({ access, keys, onKeys, confirmed, onConfirmed, idPrefix }: {
  access: RoomAccess; keys: string; onKeys: (v: string) => void; confirmed: boolean; onConfirmed: (v: boolean) => void; idPrefix: string;
}) {
  const w = accessWords(access);
  return (
    <>
      <div className="field-group w-32 space-y-1.5">
        <Label htmlFor={`${idPrefix}_keys`}>{w.count}</Label>
        <Input id={`${idPrefix}_keys`} type="number" inputMode="numeric" dir="ltr" min={1} max={9} value={keys} onChange={(e) => onKeys(e.target.value)} />
      </div>
      <label className="flex h-11 cursor-pointer items-center gap-2.5 rounded-md border border-line px-3 text-[15.5px] text-ink">
        <input type="checkbox" className="size-4" checked={confirmed} onChange={(e) => onConfirmed(e.target.checked)} />
        {w.confirm}
      </label>
    </>
  );
}

export const validKeys = (v: string) => /^[1-9]$/.test(v.trim());

/** زر تسكين سريع في لوحة الاستقبال: ينسدل منه تأكيد التسليم قبل التنفيذ */
export function QuickCheckIn({ reservationId, roomId, access, errors }: {
  reservationId: string; roomId: string | null; access: RoomAccess; errors: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState("1");
  const [confirmed, setConfirmed] = useState(false);
  const w = accessWords(access);
  const ready = confirmed && validKeys(keys);

  const submit = () =>
    start(async () => {
      const r = await callAction(checkInAction(reservationId, roomId, Number(keys)));
      if (r.ok) { toast(w.done); setOpen(false); setConfirmed(false); router.refresh(); }
      else toast(actionErrorText(errors, r), "error");
    });

  return (
    <div className="relative inline-flex flex-col">
      <Button type="button" size="sm" onClick={() => setOpen((x) => !x)}><KeyRound className="size-4" />{tr("تسكين")}</Button>
      <AnimatePresence>
        {open && (
          <m.form
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
            onSubmit={(e) => { e.preventDefault(); if (ready) submit(); }}
            className="absolute end-0 top-full z-30 mt-2 w-80 space-y-3 rounded-lg border border-line bg-white p-3 text-start shadow-lift"
          >
            <p className="text-[15px] font-medium text-ink">{tr("تسليم")}{" "}{w.one}</p>
            <div className="flex flex-wrap items-end gap-2">
              <HandoverFields access={access} keys={keys} onKeys={setKeys} confirmed={confirmed} onConfirmed={setConfirmed} idPrefix={`quick_${reservationId}`} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={pending} disabled={!ready}>{tr("إتمام التسكين")}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{tr("تراجع")}</Button>
            </div>
          </m.form>
        )}
      </AnimatePresence>
    </div>
  );
}

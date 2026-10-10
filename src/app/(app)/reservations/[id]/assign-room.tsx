"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { assignRoomAction } from "../../_pms/actions";

/** تخصيص غرفة للحجز أو تغييرها أو إلغاء التخصيص — قاعدة البيانات ترفض الغرفة المحجوزة لفترة متداخلة */
export function AssignRoom({ reservationId, current, rooms, allowNone, errors }: {
  reservationId: string;
  current: string | null;
  rooms: { id: string; label: string; busy: boolean }[];
  allowNone: boolean;
  errors: Record<string, string>;
}) {
  const router = useRouter();
  const [room, setRoom] = useState(current ?? "");
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await callAction(assignRoomAction(reservationId, room || null));
      if (r.ok) { toast(room ? tr("تم تخصيص الغرفة") : tr("أُلغي تخصيص الغرفة")); router.refresh(); }
      else toast(actionErrorText(errors, r), "error");
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect value={room} onChange={(e) => setRoom(e.target.value)} className="w-56" aria-label={tr("الغرفة")}>
        {allowNone && <option value="">{tr("بدون تخصيص")}</option>}
        {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}{r.busy ? tr("، محجوزة في الفترة") : ""}</option>)}
      </NativeSelect>
      <Button type="button" variant="outline" size="sm" loading={pending} disabled={(room || null) === current} onClick={save}>{tr("حفظ الغرفة")}</Button>
    </div>
  );
}

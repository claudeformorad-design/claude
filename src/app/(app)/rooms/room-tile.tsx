"use client";
import { tr } from "@/i18n/tr";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { CircleCheck, Wrench } from "lucide-react";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { cn } from "@/lib/utils";
import type { HousekeepingStatus, RoomServiceStatus } from "@/lib/supabase/database.types";
import { setRoomStatusAction } from "../_pms/actions";

export type TileOccupancy = { kind: "occupied" | "reserved" | "free"; guest?: string; reservationId?: string; until?: string };

const HK: Record<HousekeepingStatus, { label: string; dot: string }> = {
  clean: { get label() { return tr("نظيفة"); }, dot: "bg-success-dot" },
  dirty: { get label() { return tr("تحتاج تنظيف"); }, dot: "bg-amber-dot" },
  inspected: { get label() { return tr("مفحوصة"); }, dot: "bg-sky-dot" },
};

/**
 * بطاقة غرفة في خريطة الغرف: الرقم والنوع، وشاغلها الليلة، وحالة النظافة بنقطة لونية.
 * النقر يفتح قائمة صغيرة لتغيير الحالة (لمن يملك صلاحية حالة الغرف).
 */
export function RoomTile({
  id, number, housekeeping, service, serviceNote, occupancy, canEdit, errors,
}: {
  id: string; number: string; housekeeping: HousekeepingStatus; service: RoomServiceStatus; serviceNote: string | null;
  occupancy: TileOccupancy; canEdit: boolean; errors: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [askNote, setAskNote] = useState(false);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const oos = service === "out_of_service";

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setAskNote(false); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const set = (v: { housekeeping_status?: HousekeepingStatus; service_status?: RoomServiceStatus; service_note?: string }) =>
    start(async () => {
      const r = await callAction(setRoomStatusAction({ room_id: id, ...v }));
      if (r.ok) { toast(tr("تم تحديث الغرفة {0}", number)); setOpen(false); setAskNote(false); setNote(""); router.refresh(); }
      else toast(actionErrorText(errors, r), "error");
    });

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => canEdit && setOpen((x) => !x)} disabled={!canEdit && !occupancy.reservationId}
        className={cn(
          "group flex h-[104px] w-full flex-col justify-between rounded-lg border p-3 text-start transition-colors duration-150",
          oos ? "border-urgent/30 bg-urgent-tint/60" :
          occupancy.kind === "occupied" ? "border-ink bg-ink text-white" :
          occupancy.kind === "reserved" ? "border-action/40 bg-accent1-tint/60" : "border-line bg-white hover:border-line-strong",
          canEdit && "cursor-pointer",
        )}>
        <div className="flex items-start justify-between gap-2">
          <span className="num text-[21px] font-bold leading-none">{number}</span>
        </div>
        <div className="min-w-0">
          <p className={cn("truncate text-[15px]", occupancy.kind === "occupied" ? "text-white/85" : "text-slate-600")}>
            {oos ? (serviceNote || tr("خارج الخدمة")) : occupancy.guest ?? tr("شاغرة")}
          </p>
          <p className={cn("mt-1 flex items-center gap-1.5 text-[15px]", occupancy.kind === "occupied" ? "text-white/70" : "text-slate-500")}>
            {oos && <Wrench className="size-3.5" />}
            {oos ? tr("خارج الخدمة") : HK[housekeeping].label}
          </p>
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <m.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            className="absolute start-0 top-full z-30 mt-2 w-64 space-y-1 rounded-lg border border-line bg-white p-2 shadow-lift">
            <p className="px-2 pb-1 pt-0.5 text-[14px] font-medium text-slate-500">{tr("الغرفة")}{" "}{number}</p>
            {(["clean", "dirty", "inspected"] as const).map((k) => (
              <button key={k} type="button" disabled={pending || k === housekeeping} onClick={() => set({ housekeeping_status: k })}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-[15.5px] hover:bg-subtle disabled:opacity-50">
                {HK[k].label}
                {k === housekeeping && <span className="ms-auto text-[13px] text-slate-400">{tr("الحالية")}</span>}
              </button>
            ))}
            <div className="my-1 border-t border-line" />
            {oos ? (
              <button type="button" disabled={pending} onClick={() => set({ service_status: "in_service" })}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-[15.5px] hover:bg-subtle">
                <CircleCheck className="size-4 text-success" />{tr("إعادتها للخدمة")}</button>
            ) : askNote ? (
              <form className="space-y-2 p-1" onSubmit={(e) => { e.preventDefault(); if (note.trim()) set({ service_status: "out_of_service", service_note: note.trim() }); }}>
                <Input autoFocus placeholder={tr("السبب، مثل تسريب مياه")} value={note} onChange={(e) => setNote(e.target.value)} />
                <Button type="submit" size="sm" variant="destructive" loading={pending} disabled={!note.trim()}>{tr("إخراج من الخدمة")}</Button>
              </form>
            ) : (
              <button type="button" onClick={() => setAskNote(true)}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-[15.5px] text-urgent hover:bg-urgent-tint/60">
                <Wrench className="size-4" />{tr("إخراج من الخدمة…")}</button>
            )}
            {occupancy.reservationId && (
              <Link href={`/reservations/${occupancy.reservationId}`} className="block rounded-md px-2.5 py-2 text-[15.5px] text-action hover:bg-subtle">{tr("فتح الحجز")}{occupancy.until ? tr("، حتى {0}", occupancy.until) : ""}
              </Link>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

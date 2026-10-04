"use client";
import { tr } from "@/i18n/tr";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, LayoutGroup } from "motion/react";
import * as m from "motion/react-m";
import { AlertTriangle, BadgePercent, CalendarRange, CheckCircle2, Hourglass, Repeat, Search, UserPlus, Users, X, XCircle } from "lucide-react";
import Link from "@/components/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { formatMoney } from "@/lib/accounting/money";
import { addDays, dayLabel, nightsBetween, weekdayOf } from "@/lib/pms/dates";
import { ID_TYPES, PRICING_LABEL, RESERVATION_SOURCE, WEEKDAYS } from "@/lib/pms/labels";
import { cn } from "@/lib/utils";
import type { BookingMode, ReservationPricing, ReservationQuote, ReservationSource } from "@/lib/supabase/database.types";
import { createReservationAction, quoteAction, updateReservationAction } from "../_pms/actions";

export type RoomTypeOption = { id: string; code: string; name: string; mode: BookingMode; maxAdults: number; maxChildren: number; minHours: number };
export type RoomOption = { id: string; number: string; typeId: string };
export type GuestOption = { id: string; name: string; phone: string | null; idNumber: string | null; blacklisted: boolean };

type Kind = "single" | "group" | "series";
export type ReservationFormValues = {
  kind: Kind;
  guest_id: string;
  new_guest_name: string; new_guest_phone: string; new_guest_id_type: string; new_guest_id_number: string; new_guest_nationality: string;
  room_type_id: string; room_id: string;
  arrival_date: string; departure_date: string;
  session_date: string; start_time: string; end_time: string;
  adults: string; children: string;
  status: "tentative" | "confirmed"; tentative_until: string;
  source: ReservationSource; customer_id: string;
  pricing: ReservationPricing; fixed_rate: string; rate_reason: string;
  special_requests: string; notes: string;
  group_name: string; group_rooms: string;
  weekday: string; series_start: string; series_end: string; series_nights: string; waitlist_conflicts: boolean;
  reprice: boolean;
};

const KINDS: { key: Kind; label: string; icon: typeof Users; hint: string }[] = [
  { key: "single", get label() { return tr("حجز فردي"); }, icon: CalendarRange, get hint() { return tr("من ليلة إلى عدة أشهر"); } },
  { key: "group", get label() { return tr("مجموعة"); }, icon: Users, get hint() { return tr("عدة غرف لنفس الفترة"); } },
  { key: "series", get label() { return tr("متكرر"); }, icon: Repeat, get hint() { return tr("نفس الحجز كل أسبوع"); } },
];

/**
 * نموذج الحجز: فردي أو مجموعة أو متكرر، لغرف ليلية أو وحدات بالساعة، مع عرض سعر حي
 * (ليلة بليلة بالمواسم وخصم اللحظة الأخيرة) وحالة التوفر قبل الحفظ.
 */
export function ReservationForm({
  mode, reservationId, initial, roomTypes, rooms, guests, companies, today, canOverride, canOverbook, errors, lockedKind,
}: {
  mode: "create" | "edit";
  reservationId?: string;
  initial: ReservationFormValues;
  roomTypes: RoomTypeOption[];
  rooms: RoomOption[];
  guests: GuestOption[];
  companies: { id: string; label: string }[];
  today: string;
  canOverride: boolean;
  canOverbook: boolean;
  errors: Record<string, string>;
  lockedKind?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<ReservationFormValues>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ReservationFormValues>(k: K, value: ReservationFormValues[K]) => setV((x) => ({ ...x, [k]: value }));

  const type = roomTypes.find((x) => x.id === v.room_type_id);
  const hourly = type?.mode === "hourly";
  const typeRooms = rooms.filter((r) => r.typeId === v.room_type_id);
  const nights = !hourly && v.arrival_date && v.departure_date ? nightsBetween(v.arrival_date, v.departure_date) : 0;

  // ---------------------------------------------------------------- عرض السعر الحي
  const quoteInput = useMemo(() => {
    if (!type) return null;
    // للحجز المتكرر: سعر الموعد الأول
    const arrival = v.kind === "series" ? v.series_start : v.arrival_date;
    const departure = v.kind === "series" && v.series_start && v.series_nights ? addDays(v.series_start, Number(v.series_nights) || 1) : v.departure_date;
    const session = v.kind === "series" ? v.series_start : v.session_date;
    if (hourly ? !(session && v.start_time && v.end_time) : !(arrival && departure && departure > arrival)) return null;
    if (v.pricing !== "standard" && !v.fixed_rate) return null;
    return {
      room_type_id: type.id, arrival_date: hourly ? "" : arrival, departure_date: hourly ? "" : departure,
      session_date: hourly ? session : "", start_time: hourly ? v.start_time : "", end_time: hourly ? v.end_time : "",
      pricing: v.kind === "group" ? "standard" : v.pricing, fixed_rate: v.kind === "group" ? "" : v.fixed_rate, exclude_id: reservationId ?? "",
    };
  }, [type, hourly, v.kind, v.arrival_date, v.departure_date, v.session_date, v.start_time, v.end_time, v.pricing, v.fixed_rate, v.series_start, v.series_nights, reservationId]);

  // آخر نتيجة مع مفتاح مدخلاتها: «جارٍ الحساب» = المدخلات تغيّرت ولم تصل نتيجتها بعد (يبقى السعر السابق ظاهرًا)
  const quoteKey = quoteInput ? JSON.stringify(quoteInput) : "";
  const latestKey = useRef("");
  const [result, setResult] = useState<{ key: string; quote: ReservationQuote | null; error: string | null }>({ key: "", quote: null, error: null });
  useEffect(() => {
    latestKey.current = quoteKey;
    if (!quoteInput) return;
    const timer = setTimeout(async () => {
      const r = await callAction(quoteAction(quoteInput));
      if (latestKey.current !== quoteKey) return;
      setResult(r.ok ? { key: quoteKey, quote: r.data, error: null } : { key: quoteKey, quote: null, error: actionErrorText(errors, r) });
    }, 300);
    return () => clearTimeout(timer);
  }, [quoteInput, quoteKey, errors]);
  const quote = quoteKey ? result.quote : null;
  const quoteError = quoteKey && result.key === quoteKey ? result.error : null;
  const quoting = !!quoteKey && result.key !== quoteKey;

  // ---------------------------------------------------------------- الحفظ
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // حقول الموعد بالساعة لا تُرسل للغرف الليلية (والعكس)
    const payload = hourly
      ? { ...v, arrival_date: "", departure_date: "" }
      : { ...v, session_date: "", start_time: "", end_time: "" };
    start(async () => {
      if (mode === "edit" && reservationId) {
        const r = await callAction(updateReservationAction({ id: reservationId, ...payload }));
        if (r.ok) { toast(tr("تم تحديث الحجز")); router.push(`/reservations/${reservationId}`); }
        else setError(actionErrorText(errors, r));
        return;
      }
      const r = await callAction(createReservationAction({ ...payload, weekday: v.kind === "series" ? v.weekday : "" }));
      if (r.ok) { toast(r.data.message); router.push(r.data.href); }
      else setError(actionErrorText(errors, r));
    });
  };

  const field = "field-group space-y-1.5";
  return (
    <form onSubmit={submit} className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-6">
        {error && <Alert variant="destructive">{error}</Alert>}

        {mode === "create" && !lockedKind && (
          <LayoutGroup id="kind">
            <div className="grid gap-3 sm:grid-cols-3">
              {KINDS.map((k) => {
                const on = v.kind === k.key;
                return (
                  <button key={k.key} type="button" onClick={() => set("kind", k.key)}
                    className={cn("relative flex items-start gap-3 rounded-lg border p-4 text-start transition-colors",
                      on ? "border-ink" : "border-line bg-white hover:border-line-strong")}>
                    {on && <m.span layoutId="kind-bg" transition={{ type: "spring", stiffness: 500, damping: 40 }} className="absolute inset-0 rounded-lg bg-panel" />}
                    <span className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-[10px]", on ? "bg-ink text-white" : "bg-subtle text-slate-600")}>
                      <k.icon className="size-[18px] stroke-[1.9]" />
                    </span>
                    <span className="relative min-w-0">
                      <span className="block text-[16.5px] font-semibold text-ink">{k.label}</span>
                      <span className="mt-0.5 block text-[14.5px] text-slate-500">{k.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>
        )}

        {mode === "create" && (
          <Card>
            <CardHeader><CardTitle>{tr("النزيل")}</CardTitle></CardHeader>
            <CardContent>
              <GuestPicker guests={guests} value={v} onChange={(patch) => setV((x) => ({ ...x, ...patch }))} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>{hourly ? tr("الوحدة والموعد") : tr("الإقامة")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className={field}>
                <Label htmlFor="room_type_id">{tr("نوع الغرفة / الوحدة")}</Label>
                <NativeSelect id="room_type_id" value={v.room_type_id} onChange={(e) => setV((x) => ({ ...x, room_type_id: e.target.value, room_id: "" }))}>
                  <option value="" disabled>{tr("اختر النوع")}</option>
                  {roomTypes.map((x) => <option key={x.id} value={x.id}>{x.name}{x.mode === "hourly" ? tr(" بالساعة") : ""}</option>)}
                </NativeSelect>
              </div>
              {v.kind !== "group" && (
                <div className={field}>
                  <Label htmlFor="room_id">{hourly ? tr("الوحدة") : tr("الغرفة")}</Label>
                  <NativeSelect id="room_id" value={v.room_id} onChange={(e) => set("room_id", e.target.value)} disabled={mode === "edit"}>
                    <option value="">{hourly ? tr("اختر الوحدة") : tr("بدون تخصيص الآن")}</option>
                    {typeRooms.map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}
                  </NativeSelect>
                </div>
              )}
            </div>

            {v.kind === "series" ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className={field}>
                  <Label htmlFor="series_start">{tr("من تاريخ")}</Label>
                  <Input id="series_start" type="date" dir="ltr" min={today} value={v.series_start}
                    onChange={(e) => setV((x) => ({ ...x, series_start: e.target.value, weekday: e.target.value ? String(weekdayOf(e.target.value)) : x.weekday }))} />
                </div>
                <div className={field}>
                  <Label htmlFor="series_end">{tr("إلى تاريخ")}</Label>
                  <Input id="series_end" type="date" dir="ltr" min={v.series_start || today} value={v.series_end} onChange={(e) => set("series_end", e.target.value)} />
                </div>
                <div className={field}>
                  <Label htmlFor="weekday">{tr("كل يوم")}</Label>
                  <NativeSelect id="weekday" value={v.weekday} onChange={(e) => set("weekday", e.target.value)}>
                    <option value="" disabled>{tr("اليوم")}</option>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </NativeSelect>
                </div>
                {hourly ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className={field}><Label htmlFor="start_time">{tr("من")}</Label><Input id="start_time" type="time" dir="ltr" value={v.start_time} onChange={(e) => set("start_time", e.target.value)} /></div>
                    <div className={field}><Label htmlFor="end_time">{tr("إلى")}</Label><Input id="end_time" type="time" dir="ltr" value={v.end_time} onChange={(e) => set("end_time", e.target.value)} /></div>
                  </div>
                ) : (
                  <div className={field}>
                    <Label htmlFor="series_nights">{tr("ليالٍ كل مرة")}</Label>
                    <Input id="series_nights" inputMode="numeric" dir="ltr" value={v.series_nights} onChange={(e) => set("series_nights", e.target.value)} />
                  </div>
                )}
              </div>
            ) : hourly ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className={field}><Label htmlFor="session_date">{tr("التاريخ")}</Label><Input id="session_date" type="date" dir="ltr" min={mode === "create" ? today : undefined} value={v.session_date} onChange={(e) => set("session_date", e.target.value)} /></div>
                <div className={field}><Label htmlFor="start_time">{tr("من الساعة")}</Label><Input id="start_time" type="time" dir="ltr" value={v.start_time} onChange={(e) => set("start_time", e.target.value)} /></div>
                <div className={field}><Label htmlFor="end_time">{tr("إلى الساعة")}</Label><Input id="end_time" type="time" dir="ltr" value={v.end_time} onChange={(e) => set("end_time", e.target.value)} /></div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className={field}>
                  <Label htmlFor="arrival_date">{tr("الوصول")}</Label>
                  <Input id="arrival_date" type="date" dir="ltr" min={mode === "create" ? today : undefined} value={v.arrival_date}
                    onChange={(e) => setV((x) => ({ ...x, arrival_date: e.target.value,
                      departure_date: e.target.value && (!x.departure_date || x.departure_date <= e.target.value) ? addDays(e.target.value, Math.max(1, nights)) : x.departure_date }))} />
                </div>
                <div className={field}>
                  <Label htmlFor="departure_date">{tr("المغادرة")}</Label>
                  <Input id="departure_date" type="date" dir="ltr" min={v.arrival_date ? addDays(v.arrival_date, 1) : today} value={v.departure_date} onChange={(e) => set("departure_date", e.target.value)} />
                </div>
                <div className={field}>
                  <Label htmlFor="nights">{tr("عدد الليالي")}</Label>
                  <Input id="nights" inputMode="numeric" dir="ltr" value={nights ? String(nights) : ""} placeholder=""
                    onChange={(e) => { const n = Number(e.target.value); if (v.arrival_date && n >= 1 && n <= 366) set("departure_date", addDays(v.arrival_date, n)); }} />
                </div>
              </div>
            )}

            {v.kind === "group" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className={field}><Label htmlFor="group_name">{tr("اسم المجموعة")}</Label><Input id="group_name" value={v.group_name} onChange={(e) => set("group_name", e.target.value)} placeholder={tr("مثل: وفد مؤتمر الطاقة")} /></div>
                <div className={field}><Label htmlFor="group_rooms">{tr("عدد الغرف")}</Label><Input id="group_rooms" inputMode="numeric" dir="ltr" value={v.group_rooms} onChange={(e) => set("group_rooms", e.target.value)} /></div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className={field}><Label htmlFor="adults">{tr("بالغون")}{type ? tr("، حتى {0}", type.maxAdults) : ""}</Label><Input id="adults" inputMode="numeric" dir="ltr" value={v.adults} onChange={(e) => set("adults", e.target.value)} /></div>
              <div className={field}><Label htmlFor="children">{tr("أطفال")}{type ? tr("، حتى {0}", type.maxChildren) : ""}</Label><Input id="children" inputMode="numeric" dir="ltr" value={v.children} onChange={(e) => set("children", e.target.value)} /></div>
              <div className={field}>
                <Label htmlFor="source">{tr("مصدر الحجز")}</Label>
                <NativeSelect id="source" value={v.source} onChange={(e) => set("source", e.target.value as ReservationSource)}>
                  {Object.entries(RESERVATION_SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              </div>
              {companies.length > 0 && (
                <div className={field}>
                  <Label htmlFor="customer_id">{tr("الشركة أو جهة الفوترة")}</Label>
                  <NativeSelect id="customer_id" value={v.customer_id} onChange={(e) => set("customer_id", e.target.value)}>
                    <option value="">{tr("اختر")}</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </NativeSelect>
                </div>
              )}
            </div>

            {v.kind === "series" && !hourly && (
              <label className="flex items-center gap-2 text-[15.5px] text-slate-700">
                <input type="checkbox" className="size-4" checked={v.waitlist_conflicts} onChange={(e) => set("waitlist_conflicts", e.target.checked)} />{tr("المواعيد التي لا تتوفر فيها غرف تُضاف لقائمة الانتظار تلقائيًا")}</label>
            )}
          </CardContent>
        </Card>

        {v.kind === "single" && canOverride && (
          <Card>
            <CardHeader>
              <CardTitle>{tr("التسعير")}</CardTitle>
              <CardDescription>{tr("السعر يُثبَّت لكل ليلة لحظة الحجز؛ تغيير الأسعار لاحقًا لا يغيّر هذا الحجز.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(["standard", "fixed", "monthly"] as const).filter((p) => !(hourly && p === "monthly")).map((p) => (
                  <button key={p} type="button" onClick={() => set("pricing", p)} aria-pressed={v.pricing === p}
                    className={cn("h-10 rounded-md border px-4 text-[15.5px] font-medium transition-colors",
                      v.pricing === p ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700 hover:border-line-strong")}>
                    {PRICING_LABEL[p]}
                  </button>
                ))}
              </div>
              {v.pricing !== "standard" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className={field}>
                    <Label htmlFor="fixed_rate">{v.pricing === "monthly" ? tr("السعر الشهري") : hourly ? tr("سعر الساعة") : tr("سعر الليلة")}</Label>
                    <Input id="fixed_rate" inputMode="decimal" dir="ltr" value={v.fixed_rate} onChange={(e) => set("fixed_rate", e.target.value)} />
                  </div>
                  <div className={field}>
                    <Label htmlFor="rate_reason">{tr("السبب")}</Label>
                    <Input id="rate_reason" value={v.rate_reason} onChange={(e) => set("rate_reason", e.target.value)} placeholder={tr("مثل: عقد شركة، عرض خاص")} />
                  </div>
                </div>
              )}
              {v.pricing === "monthly" && <p className="text-[14.5px] text-slate-500">{tr("للإقامات من 28 ليلة فأكثر: يوزَّع السعر الشهري على ليالي كل شهر تقويمي بنسبة أيامه.")}</p>}
              {mode === "edit" && (
                <label className="flex items-center gap-2 text-[15.5px] text-slate-700">
                  <input type="checkbox" className="size-4" checked={v.reprice} onChange={(e) => set("reprice", e.target.checked)} />{tr("إعادة تسعير كل الليالي بالأسعار الحالية، وإلا تبقى الليالي القائمة بسعرها وتُسعَّر المضافة فقط")}</label>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>{tr("الحالة والملاحظات")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {mode === "create" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className={field}>
                  <Label htmlFor="status">{tr("حالة الحجز")}</Label>
                  <NativeSelect id="status" value={v.status} onChange={(e) => set("status", e.target.value as "tentative" | "confirmed")}>
                    <option value="confirmed">{tr("مؤكد")}</option>
                    <option value="tentative">{tr("مبدئي بانتظار التأكيد")}</option>
                  </NativeSelect>
                </div>
                {v.status === "tentative" && v.kind === "single" && (
                  <div className={field}><Label htmlFor="tentative_until">{tr("يُحجز مبدئيًا حتى")}</Label><Input id="tentative_until" type="date" dir="ltr" value={v.tentative_until} onChange={(e) => set("tentative_until", e.target.value)} /></div>
                )}
              </div>
            )}
            {mode === "edit" && initial.status === "tentative" && (
              <div className={cn(field, "max-w-xs")}><Label htmlFor="tentative_until">{tr("يُحجز مبدئيًا حتى")}</Label><Input id="tentative_until" type="date" dir="ltr" value={v.tentative_until} onChange={(e) => set("tentative_until", e.target.value)} /></div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div className={field}><Label htmlFor="special_requests">{tr("طلبات النزيل")}</Label><Textarea id="special_requests" value={v.special_requests} onChange={(e) => set("special_requests", e.target.value)} placeholder={tr("سرير إضافي، طابق مرتفع، وصول متأخر…")} /></div>
              <div className={field}><Label htmlFor="notes">{tr("ملاحظات داخلية")}</Label><Textarea id="notes" value={v.notes} onChange={(e) => set("notes", e.target.value)} /></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 xl:sticky xl:top-2">
        <QuoteCard quote={quote} error={quoteError} loading={quoting} kind={v.kind} groupRooms={Number(v.group_rooms) || 0} canOverbook={canOverbook}
          waitlistHref={!hourly && v.room_type_id && v.arrival_date && v.departure_date
            ? `/waitlist?new=1&type=${v.room_type_id}&arrival=${v.arrival_date}&departure=${v.departure_date}` : undefined} />
        <Button type="submit" className="h-12 w-full text-[17px]" loading={pending}>
          {mode === "edit" ? tr("حفظ التعديلات") : v.kind === "group" ? tr("حجز المجموعة") : v.kind === "series" ? tr("إنشاء الحجز المتكرر") : tr("تأكيد الحجز")}
        </Button>
        {mode === "edit" && reservationId && (
          <Button asChild variant="outline" className="w-full"><Link href={`/reservations/${reservationId}`}>{tr("تراجع")}</Link></Button>
        )}
      </div>
    </form>
  );
}

// ============================================================================ اختيار النزيل
function GuestPicker({ guests, value, onChange }: {
  guests: GuestOption[];
  value: ReservationFormValues;
  onChange: (patch: Partial<ReservationFormValues>) => void;
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(!value.guest_id);
  const selected = guests.find((g) => g.id === value.guest_id);
  const matches = useMemo(() => {
    const s = q.trim();
    if (!s) return [];
    return guests.filter((g) => g.name.includes(s) || g.phone?.includes(s) || g.idNumber?.includes(s)).slice(0, 8);
  }, [q, guests]);
  const field = "field-group space-y-1.5";

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel p-3">
        <div className="min-w-0">
          <p className="truncate text-[17px] font-semibold text-ink">{selected.name}</p>
          <p className="num truncate text-[14.5px] text-slate-500">{[selected.phone, selected.idNumber].filter(Boolean).join(tr("، ")) || ""}</p>
          {selected.blacklisted && <p className="mt-1 text-[14.5px] font-medium text-urgent">{tr("هذا النزيل في القائمة السوداء؛ لن يُقبل الحجز.")}</p>}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => { onChange({ guest_id: "" }); setCreating(false); }}><X className="size-4" />{tr("تغيير")}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
        <Input value={q} onChange={(e) => { setQ(e.target.value); setCreating(false); }} placeholder={tr("ابحث عن نزيل سابق بالاسم أو الجوال أو الهوية")} className="ps-10" />
        <AnimatePresence>
          {matches.length > 0 && (
            <m.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
              className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-lg border border-line bg-white p-1 shadow-lift">
              {matches.map((g) => (
                <li key={g.id}>
                  <button type="button" onClick={() => { onChange({ guest_id: g.id }); setQ(""); }}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-start hover:bg-subtle">
                    <span className="truncate text-[16px] font-medium text-ink">{g.name}{g.blacklisted && <span className="ms-2 text-[13.5px] text-urgent">{tr("محظور")}</span>}</span>
                    <span className="num shrink-0 text-[14px] text-slate-500">{g.phone ?? g.idNumber ?? ""}</span>
                  </button>
                </li>
              ))}
            </m.ul>
          )}
        </AnimatePresence>
      </div>
      {!creating ? (
        <button type="button" onClick={() => { setCreating(true); onChange({ new_guest_name: q.trim() || value.new_guest_name }); }}
          className="flex items-center gap-2 text-[15.5px] font-medium text-action">
          <UserPlus className="size-4" />{tr("نزيل جديد")}{q.trim() ? `: ${q.trim()}` : ""}
        </button>
      ) : (
        <div className="grid gap-4 rounded-lg border border-dashed border-line-strong p-4 sm:grid-cols-2">
          <div className={field}><Label htmlFor="new_guest_name">{tr("اسم النزيل")}</Label><Input id="new_guest_name" value={value.new_guest_name} onChange={(e) => onChange({ new_guest_name: e.target.value })} /></div>
          <div className={field}><Label htmlFor="new_guest_phone">{tr("الجوال")}</Label><Input id="new_guest_phone" dir="ltr" value={value.new_guest_phone} onChange={(e) => onChange({ new_guest_phone: e.target.value })} /></div>
          <div className={field}>
            <Label htmlFor="new_guest_id_type">{tr("نوع الهوية")}</Label>
            <NativeSelect id="new_guest_id_type" value={value.new_guest_id_type} onChange={(e) => onChange({ new_guest_id_type: e.target.value })}>
              <option value="">{tr("اختر")}</option>
              {Object.entries(ID_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </NativeSelect>
          </div>
          <div className={field}><Label htmlFor="new_guest_id_number">{tr("رقم الهوية")}</Label><Input id="new_guest_id_number" dir="ltr" value={value.new_guest_id_number} onChange={(e) => onChange({ new_guest_id_number: e.target.value })} /></div>
          <div className={cn(field, "sm:col-span-2")}><Label htmlFor="new_guest_nationality">{tr("الجنسية")}</Label><Input id="new_guest_nationality" value={value.new_guest_nationality} onChange={(e) => onChange({ new_guest_nationality: e.target.value })} /></div>
        </div>
      )}
    </div>
  );
}

// ============================================================================ بطاقة السعر
function QuoteCard({ quote, error, loading, kind, groupRooms, canOverbook, waitlistHref }: {
  quote: ReservationQuote | null; error: string | null; loading: boolean; kind: Kind; groupRooms: number; canOverbook: boolean; waitlistHref?: string;
}) {
  const [all, setAll] = useState(false);
  const money = (n: number) => formatMoney(n, { locale: "ar" });
  const need = kind === "group" ? Math.max(1, groupRooms) : 1;
  const avail = quote?.min_available;
  const availability = quote && quote.booking_mode === "nightly" && avail !== null && avail !== undefined
    ? avail >= need ? { tone: "ok" as const, text: tr("متاح، {0} في كل الليالي", avail === 1 ? tr("غرفة شاغرة واحدة") : tr("{0} غرف شاغرة", avail)) }
    : avail + quote.overbooking_limit >= need ? { tone: "warn" as const, text: canOverbook ? tr("حجز زائد: لا غرف شاغرة في بعض الليالي، والمسموح حتى {0}", quote.overbooking_limit) : tr("لا غرف شاغرة في بعض الليالي، والحجز الزائد يتطلب صلاحية") }
    : { tone: "bad" as const, text: kind === "group" ? tr("المتاح {0} فقط من {1} غرف", Math.max(0, avail), need) : tr("لا توجد غرف متاحة من هذا النوع في بعض الليالي") }
    : null;
  const lines = quote?.lines ?? [];
  const visible = all ? lines : lines.slice(0, 7);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="justify-between">
          <span>{kind === "series" ? tr("سعر الموعد الأول") : kind === "group" ? tr("سعر الغرفة الواحدة") : tr("ملخص السعر")}</span>
          {loading && <span className="size-4 animate-spin rounded-full border-2 border-line border-t-action" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!quote && !error && <p className="text-[15.5px] leading-relaxed text-slate-500">{tr("اختر النوع والتواريخ لعرض سعر كل ليلة وحالة التوفر.")}</p>}
        {error && <p className="text-[15.5px] text-urgent">{error}</p>}
        {quote && (
          <m.div key={quote.total} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="space-y-4">
            {availability && (
              <div className={cn("flex items-start gap-2 rounded-md p-3 text-[15px] leading-relaxed",
                availability.tone === "ok" ? "bg-success-tint text-success" : availability.tone === "warn" ? "bg-amber-tint text-amber" : "bg-urgent-tint text-urgent")}>
                {availability.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : availability.tone === "warn" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
                <span>{availability.text}
                  {availability.tone === "bad" && waitlistHref && kind !== "group" && (
                    <Link href={waitlistHref} className="mt-1 flex items-center gap-1 font-semibold"><Hourglass className="size-3.5" />{tr("أضفه لقائمة الانتظار")}</Link>
                  )}
                </span>
              </div>
            )}
            {quote.last_minute_pct && (
              <p className="flex items-center gap-2 rounded-md bg-accent1-tint px-3 py-2 text-[15px] font-medium text-sky"><BadgePercent className="size-4" />{tr("خصم اللحظة الأخيرة")}{" "}{Number(quote.last_minute_pct)}%</p>
            )}
            <ul className="divide-y divide-line rounded-md border border-line">
              {visible.map((l) => (
                <li key={l.date} className="flex items-center justify-between gap-2 px-3 py-2 text-[15px]">
                  <span className="min-w-0 truncate text-slate-700">
                    {quote.booking_mode === "hourly" ? tr("{0} ساعات × {1}", Number(l.quantity), money(Number(l.rate))) : dayLabel(l.date)}
                    {l.season && <span className="ms-2 rounded bg-subtle px-1.5 text-[13px] text-slate-600">{l.season}</span>}
                  </span>
                  <span className="num shrink-0 font-medium text-ink">
                    {Number(l.discount) > 0 && <span className="me-2 text-[13.5px] text-slate-400 line-through">{money(Number(l.rate))}</span>}
                    {money(Number(l.amount))}
                  </span>
                </li>
              ))}
            </ul>
            {lines.length > 7 && (
              <button type="button" onClick={() => setAll((x) => !x)} className="text-[14.5px] font-medium text-action">
                {all ? tr("عرض أقل") : tr("عرض كل الليالي، {0}", lines.length)}
              </button>
            )}
            <div className="space-y-1 border-t border-line pt-3">
              {Number(quote.discount) > 0 && (
                <div className="flex justify-between text-[15px] text-slate-600"><span>{tr("الخصم")}</span><span className="num">−{money(Number(quote.discount))}</span></div>
              )}
              <div className="flex items-end justify-between">
                <span className="text-[16px] font-medium text-slate-600">{quote.nights ? `${quote.nights} ${quote.nights === 1 ? tr("ليلة") : quote.nights <= 10 ? tr("ليالٍ") : tr("ليلة")}` : tr("الإجمالي")}</span>
                <span className="display-num text-[28px] font-bold text-ink">{money(Number(quote.total))}</span>
              </div>
              {kind === "group" && groupRooms > 1 && (
                <div className="flex justify-between text-[15px] text-slate-600"><span>{tr("للمجموعة،")}{" "}{groupRooms}{" "}{tr("غرف")}</span><span className="num font-semibold text-ink">{money(Number(quote.total) * groupRooms)}</span></div>
              )}
              <p className="text-[13.5px] text-slate-500">{tr("الضرائب تُطبَّق حسب إعداد كود الإيراد عند الترحيل على الفوليو.")}</p>
            </div>
          </m.div>
        )}
      </CardContent>
    </Card>
  );
}

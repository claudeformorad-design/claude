"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftRight, BedDouble, CalendarPlus, KeyRound, LogOut, ReceiptText, Wallet } from "lucide-react";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText } from "@/lib/action-error";
import { formatMoney } from "@/lib/accounting/money";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/services/errors";
import {
  changeDepartureAction, checkInAction, moveRoomAction, postChargesAction, prepareCheckOutAction, recordDepositAction, settleAndCheckOutAction,
} from "../../_pms/actions";

type Option = { id: string; label: string };
type Method = Option & { kind: string };

/**
 * لوحة الإقامة في صفحة الحجز: العربون، التسكين، ترحيل الليالي، التمديد والتقصير، نقل الغرفة، والمغادرة.
 * كل مبلغ يُسجَّل على فوليو الحجز في المحاسبة بقيده، والمغادرة تُصدر الفاتورة الضريبية.
 */
export function StayPanel({
  reservationId, status, hourly, canCheckIn, today, arrival, departure, folio, methods, customer, checkInRooms, moveRooms,
  currentRoomId, canViewFolio, canViewInvoices, errors,
}: {
  reservationId: string;
  status: string;
  hourly: boolean;
  canCheckIn: boolean;
  today: string;
  arrival: string;
  departure: string;
  folio: { id: string; number: string; balance: string; deposits: string } | null;
  methods: Method[];
  customer: Option | null;
  checkInRooms: (Option & { note?: string })[];
  moveRooms: Option[];
  currentRoomId: string | null;
  canViewFolio: boolean;
  canViewInvoices: boolean;
  errors: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const money = (n: number | string) => formatMoney(n, { locale: "ar" });
  const cashMethods = methods.filter((m) => m.kind !== "city_ledger");

  const run = (key: string, fn: () => Promise<ActionResult<unknown>>, done: string, after?: (data: unknown) => void) =>
    start(async () => {
      setBusy(key);
      const r = await fn();
      setBusy(null);
      if (r.ok) { toast(done); if (after) after(r.data); else router.refresh(); }
      else toast(actionErrorText(errors, r), "error");
    });

  // الحقول
  const [dep, setDep] = useState({ method: cashMethods[0]?.id ?? "", amount: "", reference: "" });
  const [room, setRoom] = useState(currentRoomId ?? checkInRooms[0]?.id ?? "");
  const [newDeparture, setNewDeparture] = useState(departure);
  const [move, setMove] = useState({ room: "", reason: "" });
  const [bill, setBill] = useState<{ due: number; balance: number; deposits: number } | null>(null);
  const [pay, setPay] = useState({ method: cashMethods[0]?.id ?? "", amount: "" });

  const field = "field-group space-y-1.5";
  const active = status === "tentative" || status === "confirmed" || status === "checked_in";

  return (
    <div className="space-y-6">
      {status === "checked_in" && (
        <Card className="border-ink/20">
          <CardHeader>
            <CardTitle><LogOut className="size-5" />تسجيل المغادرة</CardTitle>
            <CardDescription>
              {departure > today ? "مغادرة مبكرة: تُحتسب الليالي حتى اليوم وتُحرَّر البقية." : "تُرحَّل الليالي المتبقية، ويُطبَّق العربون، وتصدر الفاتورة الضريبية."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!bill ? (
              <Button type="button" variant="dark" loading={busy === "prep"} disabled={pending}
                onClick={() => run("prep", () => prepareCheckOutAction(reservationId), "تم ترحيل الليالي وتجهيز الفاتورة", (d) => {
                  const x = d as { due: number; balance: number; deposits: number };
                  setBill({ due: Number(x.due), balance: Number(x.balance), deposits: Number(x.deposits) });
                  setPay((p) => ({ ...p, amount: Number(x.due) > 0 ? String(Number(x.due)) : "" }));
                  router.refresh();
                })}>
                <ReceiptText className="size-4" />تجهيز الفاتورة
              </Button>
            ) : (
              <AnimatePresence>
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <dl className="grid grid-cols-3 gap-3 rounded-lg border border-line bg-panel p-4 text-center">
                    <div><dt className="text-[14px] text-slate-500">الرصيد</dt><dd className="num text-[20px] font-bold text-ink">{money(bill.balance)}</dd></div>
                    <div><dt className="text-[14px] text-slate-500">العربون</dt><dd className="num text-[20px] font-bold text-success">{money(bill.deposits)}</dd></div>
                    <div><dt className="text-[14px] text-slate-500">المستحق</dt><dd className={cn("num text-[20px] font-bold", bill.due > 0 ? "text-urgent" : "text-ink")}>{money(bill.due)}</dd></div>
                  </dl>
                  {bill.deposits > bill.balance && (
                    <p className="rounded-md bg-amber-tint px-3 py-2 text-[15px] text-amber">
                      العربون أكبر من الرصيد بـ {money(bill.deposits - bill.balance)} — استرده من صفحة الفوليو قبل المغادرة.
                    </p>
                  )}
                  {bill.due > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className={field}>
                        <Label htmlFor="pay_method">طريقة التحصيل</Label>
                        <NativeSelect id="pay_method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                          {cashMethods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                          {customer && methods.filter((m) => m.kind === "city_ledger").map((m) => <option key={m.id} value={m.id}>{m.label} — {customer.label}</option>)}
                        </NativeSelect>
                      </div>
                      <div className={field}><Label htmlFor="pay_amount">المبلغ</Label><Input id="pay_amount" inputMode="decimal" dir="ltr" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
                    </div>
                  )}
                  <Button type="button" className="w-full" loading={busy === "out"} disabled={pending}
                    onClick={() => run("out", () => settleAndCheckOutAction(reservationId, {
                      method: pay.method, amount: bill.due > 0 ? pay.amount : "",
                      customer_id: methods.find((m) => m.id === pay.method)?.kind === "city_ledger" ? customer?.id : undefined,
                    }), "تمت المغادرة وصدرت الفاتورة", (inv) => {
                      if (inv && canViewInvoices) router.push(`/invoices/${inv}`); else router.refresh();
                    })}>
                    {bill.due > 0 ? "تحصيل وتسجيل المغادرة" : "تسجيل المغادرة وإصدار الفاتورة"}
                  </Button>
                </motion.div>
              </AnimatePresence>
            )}
          </CardContent>
        </Card>
      )}

      {canCheckIn && (status === "tentative" || status === "confirmed") && (
        <Card className="border-action/30">
          <CardHeader>
            <CardTitle><KeyRound className="size-5" />تسجيل الوصول</CardTitle>
            <CardDescription>{hourly ? "بدء الجلسة وفتح فوليو الحجز." : "غرفة نظيفة في الخدمة؛ يُفتح فوليو الحجز (أو يُستخدم فوليو العربون)."}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            {!hourly && (
              <div className={cn(field, "min-w-56 flex-1")}>
                <Label htmlFor="checkin_room">الغرفة</Label>
                <NativeSelect id="checkin_room" value={room} onChange={(e) => setRoom(e.target.value)}>
                  {!room && <option value="">اختر غرفة</option>}
                  {checkInRooms.map((r) => <option key={r.id} value={r.id}>{r.label}{r.note ? ` — ${r.note}` : ""}</option>)}
                </NativeSelect>
              </div>
            )}
            <Button type="button" loading={busy === "in"} disabled={pending || (!hourly && !room)}
              onClick={() => run("in", () => checkInAction(reservationId, hourly ? null : room), "تم تسجيل الوصول")}>
              <KeyRound className="size-4" />تسكين
            </Button>
          </CardContent>
        </Card>
      )}

      {status === "checked_in" && (
        <Card>
          <CardHeader><CardTitle><BedDouble className="size-5" />أثناء الإقامة</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-panel p-3">
              <p className="text-[15.5px] text-slate-600">ترحيل الليالي المستحقة حتى اليوم على الفوليو (يتم تلقائيًا عند المغادرة).</p>
              <Button type="button" variant="outline" size="sm" loading={busy === "post"} disabled={pending}
                onClick={() => run("post", () => postChargesAction(reservationId), "تم ترحيل الليالي")}>ترحيل الليالي</Button>
            </div>
            {!hourly && (
              <div className="flex flex-wrap items-end gap-3">
                <div className={cn(field, "w-52")}>
                  <Label htmlFor="new_departure">تاريخ المغادرة</Label>
                  <Input id="new_departure" type="date" dir="ltr" min={today > arrival ? today : arrival} value={newDeparture} onChange={(e) => setNewDeparture(e.target.value)} />
                </div>
                <Button type="button" variant="outline" loading={busy === "dep"} disabled={pending || newDeparture === departure}
                  onClick={() => run("dep", () => changeDepartureAction(reservationId, newDeparture), newDeparture > departure ? "تم تمديد الإقامة" : "تم تقصير الإقامة")}>
                  <CalendarPlus className="size-4" />{newDeparture >= departure ? "تمديد" : "تقصير"}
                </Button>
              </div>
            )}
            {!hourly && moveRooms.length > 0 && (
              <div className="flex flex-wrap items-end gap-3">
                <div className={cn(field, "w-52")}>
                  <Label htmlFor="move_room">نقل إلى غرفة</Label>
                  <NativeSelect id="move_room" value={move.room} onChange={(e) => setMove({ ...move, room: e.target.value })}>
                    <option value="">اختر</option>
                    {moveRooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </NativeSelect>
                </div>
                <div className={cn(field, "min-w-48 flex-1")}>
                  <Label htmlFor="move_reason">السبب</Label>
                  <Input id="move_reason" value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} placeholder="مثل: عطل في التكييف، ترقية" />
                </div>
                <Button type="button" variant="outline" loading={busy === "move"} disabled={pending || !move.room || !move.reason.trim()}
                  onClick={() => run("move", () => moveRoomAction(reservationId, move.room, move.reason.trim()), "تم نقل النزيل")}>
                  <ArrowLeftRight className="size-4" />نقل
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(folio || active) && (
        <Card>
          <CardHeader>
            <CardTitle className="justify-between">
              <span className="flex items-center gap-2"><Wallet className="size-5" />الفوليو والعربون</span>
              {folio && canViewFolio && <Link href={`/folios/${folio.id}`} className="text-[15px] font-medium text-action hover:underline">فتح الفوليو {folio.number}</Link>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {folio ? (
              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-panel p-3"><dt className="text-[14px] text-slate-500">رصيد الفوليو</dt><dd className="num text-[20px] font-bold text-ink">{money(folio.balance)}</dd></div>
                <div className="rounded-lg bg-panel p-3"><dt className="text-[14px] text-slate-500">عربون متاح</dt><dd className="num text-[20px] font-bold text-success">{money(folio.deposits)}</dd></div>
              </dl>
            ) : <p className="text-[15.5px] text-slate-500">لم يُفتح فوليو بعد؛ يُفتح عند أول عربون أو عند التسكين.</p>}
            {active && cashMethods.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-[1fr_120px_1fr_auto] sm:items-end">
                <div className={field}>
                  <Label htmlFor="dep_method">عربون جديد</Label>
                  <NativeSelect id="dep_method" value={dep.method} onChange={(e) => setDep({ ...dep, method: e.target.value })}>
                    {cashMethods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </NativeSelect>
                </div>
                <div className={field}><Label htmlFor="dep_amount">المبلغ</Label><Input id="dep_amount" inputMode="decimal" dir="ltr" value={dep.amount} onChange={(e) => setDep({ ...dep, amount: e.target.value })} /></div>
                <div className={field}><Label htmlFor="dep_ref">مرجع (اختياري)</Label><Input id="dep_ref" value={dep.reference} onChange={(e) => setDep({ ...dep, reference: e.target.value })} placeholder="رقم الإيصال أو الحوالة" /></div>
                <Button type="button" variant="outline" loading={busy === "dep_add"} disabled={pending || !dep.amount}
                  onClick={() => run("dep_add", () => recordDepositAction(reservationId, dep), "تم تسجيل العربون", () => { setDep({ ...dep, amount: "", reference: "" }); router.refresh(); })}>
                  تسجيل
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

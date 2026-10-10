"use client";
import { tr } from "@/i18n/tr";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { BedDouble, CalendarPlus, DoorOpen, KeyRound, LogOut, ReceiptText, Wallet } from "lucide-react";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { formatMoney } from "@/lib/accounting/money";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/services/errors";
import {
  changeDepartureAction, checkInAction, moveRoomAction, payStayAction, postChargesAction, prepareCheckOutAction, recordDepositAction,
  settleAndCheckOutAction,
} from "../../_pms/actions";
import { HandoverFields, accessWords, validKeys } from "../../_pms/handover";
import type { RoomAccess } from "@/lib/supabase/database.types";

type Option = { id: string; label: string };
/** currency: عملة أجنبية للطريقة (null = الأساسية) و rate سعرها الساري */
type Method = Option & { kind: string; currency: string | null; rate: number | null; ref?: boolean };
type Bill = { due: number; balance: number; deposits: number; company: number };

/**
 * لوحة الإقامة في صفحة الحجز: العربون، التسكين، ترحيل الليالي، التمديد والتقصير، نقل الغرفة، والمغادرة.
 * كل مبلغ يُسجَّل على فوليو الحجز في المحاسبة بقيده، والمغادرة تُصدر الفاتورة الضريبية.
 */
export function StayPanel({
  reservationId, status, hourly, canCheckIn, today, arrival, departure, folio, methods, customer, checkInRooms, moveRooms,
  currentRoomId, canViewFolio, canViewInvoices, errors, baseCurrency, billTo, roomAccess, keysIssued,
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
  baseCurrency: string;
  billTo: "guest" | "company_room" | "company_all";
  roomAccess: RoomAccess;
  keysIssued: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const money = (n: number | string) => formatMoney(n, { locale: "ar" });
  const cashMethods = methods.filter((m) => m.kind !== "city_ledger");

  // قفل فوري: الضغطة الثانية قبل إعادة الرسم لا تسجّل العملية مرتين (عربون، دفعة، تسكين)
  const inFlight = useRef(false);
  const run = (key: string, fn: () => Promise<ActionResult<unknown>>, done: string, after?: (data: unknown) => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    start(async () => {
      setBusy(key);
      const r = await callAction(fn());
      inFlight.current = false;
      setBusy(null);
      if (r.ok) { toast(done); if (after) after(r.data); else router.refresh(); }
      else toast(actionErrorText(errors, r), "error");
    });
  };

  // الحقول
  const [dep, setDep] = useState({ method: cashMethods[0]?.id ?? "", amount: "", reference: "" });
  const [room, setRoom] = useState(currentRoomId ?? checkInRooms[0]?.id ?? "");
  const [newDeparture, setNewDeparture] = useState(departure);
  const [move, setMove] = useState({ room: "", reason: "", handed: false });
  const [keys, setKeys] = useState("1");
  const [handed, setHanded] = useState(false);
  const words = accessWords(roomAccess);
  const [bill, setBill] = useState<Bill | null>(null);
  const [pay, setPay] = useState({ method: cashMethods[0]?.id ?? "", amount: "", reference: "" });

  const field = "field-group space-y-1.5";
  const methodOf = (id: string) => methods.find((m) => m.id === id);
  const toBill = (d: unknown): Bill => {
    const x = d as { due: number; balance: number; deposits: number; company_due: number };
    return { due: Number(x.due), balance: Number(x.balance), deposits: Number(x.deposits), company: Number(x.company_due ?? 0) };
  };
  // ما يعادل المبلغ بالعملة الأساسية لطريقة بعملة أجنبية
  const approx = (methodId: string, amount: string) => {
    const m = methodOf(methodId);
    if (!m?.currency || !m.rate || !amount || Number.isNaN(Number(amount))) return null;
    return tr("يعادل {0} {1} بسعر {2}", money(Number(amount) * m.rate), baseCurrency, m.rate);
  };
  const payMethod = methodOf(pay.method);
  const payForeign = !!payMethod?.currency;
  // رصيد دائن للنزيل بعد التسوية: دفعة زائدة (إرجاع) أو عربون يزيد عن الرصيد (استرداد عربون)
  const credit = bill ? (bill.balance < 0 ? { amount: -bill.balance, kind: "refund" as const }
    : bill.deposits > bill.balance ? { amount: bill.deposits - bill.balance, kind: "deposit_refund" as const } : null) : null;
  const baseCash = methods.find((m) => m.kind === "cash" && !m.currency);
  const active = status === "tentative" || status === "confirmed" || status === "checked_in";

  return (
    <div className="@container space-y-6">
      {status === "checked_in" && (
        <Card className="border-ink/20">
          <CardHeader>
            <CardTitle><LogOut className="size-5" />{tr("تسجيل المغادرة")}</CardTitle>
            <CardDescription>
              {departure > today ? tr("مغادرة مبكرة: تُحتسب الليالي حتى اليوم وتُحرَّر البقية.") : tr("تُرحَّل الليالي المتبقية، ويُطبَّق العربون، وتصدر الفاتورة الضريبية.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {keysIssued != null && (
              <p className="flex items-center gap-2 rounded-lg bg-panel p-3 text-[15.5px] text-ink"><KeyRound className="size-4 text-slate-500" />{words.collect} <span className="num font-semibold">{keysIssued}</span></p>
            )}
            {!bill ? (
              <Button type="button" variant="dark" loading={busy === "prep"} disabled={pending}
                onClick={() => run("prep", () => prepareCheckOutAction(reservationId), tr("تم ترحيل الليالي وتجهيز الفاتورة"), (d) => {
                  const b = toBill(d);
                  setBill(b);
                  setPay((p) => ({ ...p, amount: b.due > 0 ? String(b.due) : "" }));
                  router.refresh();
                })}>
                <ReceiptText className="size-4" />{tr("تجهيز الفاتورة")}</Button>
            ) : (
              <AnimatePresence>
                <m.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <dl className={cn("grid grid-cols-2 gap-3 rounded-lg border border-line bg-panel p-4 text-center", bill.company > 0 ? "@xl:grid-cols-4" : "@xl:grid-cols-3")}>
                    <div><dt className="text-[14px] text-slate-500">{tr("الرصيد")}</dt><dd className="num text-[20px] font-bold text-ink">{money(bill.balance)}</dd></div>
                    <div><dt className="text-[14px] text-slate-500">{tr("العربون")}</dt><dd className="num text-[20px] font-bold text-success">{money(bill.deposits)}</dd></div>
                    {bill.company > 0 && <div><dt className="text-[14px] text-slate-500">{tr("على الشركة")}</dt><dd className="num text-[20px] font-bold text-sky">{money(bill.company)}</dd></div>}
                    <div><dt className="text-[14px] text-slate-500">{tr("على النزيل")}</dt><dd className={cn("num text-[20px] font-bold", bill.due > 0 ? "text-urgent" : "text-ink")}>{money(bill.due)}</dd></div>
                  </dl>
                  {bill.company > 0 && (
                    <p className="rounded-md bg-accent1-tint/70 px-3 py-2 text-[15px] text-sky">
                      {billTo === "company_all" ? tr("كل الفاتورة") : tr("رسوم الإقامة")}{" "}{tr("تُحوَّل آجلًا على")}{" "}{customer?.label ?? tr("الشركة")}{" "}{tr("عند المغادرة، وتصدر الفاتورة باسمها.")}</p>
                  )}
                  {credit && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-tint px-3 py-2 text-[15px] text-amber">
                      <span>{credit.kind === "refund" ? tr("الباقي للنزيل") : tr("عربون زائد عن الرصيد")}: <b className="num">{money(credit.amount)}</b></span>
                      {baseCash && (
                        <Button type="button" size="sm" variant="outline" loading={busy === "change"} disabled={pending}
                          onClick={() => run("change", () => payStayAction(reservationId, { method: baseCash.id, amount: String(credit.amount), kind: credit.kind }),
                            tr("تم إرجاع المبلغ للنزيل"), (d) => { setBill(toBill(d)); router.refresh(); })}>{tr("إرجاعه نقدًا")}</Button>
                      )}
                    </div>
                  )}
                  {bill.due > 0 && (
                    <div className="grid gap-3 @md:grid-cols-2">
                      <div className={field}>
                        <Label htmlFor="pay_method">{tr("طريقة التحصيل")}</Label>
                        <NativeSelect id="pay_method" value={pay.method} onChange={(e) => {
                          const m = methodOf(e.target.value);
                          setPay({ method: e.target.value, amount: m?.currency && m.rate ? (Math.ceil((bill.due / m.rate) * 100) / 100).toString() : String(bill.due), reference: pay.reference });
                        }}>
                          {cashMethods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                          {customer && methods.filter((m) => m.kind === "city_ledger").map((m) => <option key={m.id} value={m.id}>{m.label}{" "}{tr("على")}{" "}{customer.label}</option>)}
                        </NativeSelect>
                      </div>
                      <div className={field}>
                        <Label htmlFor="pay_amount">{tr("المبلغ")}{payForeign ? tr(" بعملة {0}", payMethod!.currency) : ""}</Label>
                        <Input id="pay_amount" inputMode="decimal" dir="ltr" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
                        {approx(pay.method, pay.amount) && <p className="num text-[13.5px] text-slate-500">{approx(pay.method, pay.amount)}</p>}
                      </div>
                      {payMethod?.ref && (
                        <div className={field}>
                          <Label htmlFor="pay_ref">{tr("رقم العملية")}</Label>
                          <Input id="pay_ref" dir="ltr" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder={tr("رقم العملية في المحفظة، إلزامي")} />
                        </div>
                      )}
                    </div>
                  )}
                  {bill.due > 0 && (payForeign || (pay.amount && Number(pay.amount) < bill.due)) ? (
                    <Button type="button" variant="outline" className="w-full" loading={busy === "part"} disabled={pending || !pay.amount || (!!payMethod?.ref && !pay.reference.trim())}
                      onClick={() => run("part", () => payStayAction(reservationId, { method: pay.method, amount: pay.amount, reference: pay.reference }), tr("تم تسجيل الدفعة"), (d) => {
                        const b = toBill(d);
                        setBill(b);
                        setPay({ method: cashMethods.find((m) => !m.currency)?.id ?? pay.method, amount: b.due > 0 ? String(b.due) : "", reference: "" });
                        router.refresh();
                      })}>{tr("تسجيل الدفعة")}{payForeign ? tr(" بالعملة الأجنبية") : tr(" الجزئية")}
                    </Button>
                  ) : (
                    <Button type="button" className="w-full" loading={busy === "out"} disabled={pending || !!credit || (bill.due > 0 && !!payMethod?.ref && !pay.reference.trim())}
                      onClick={() => run("out", () => settleAndCheckOutAction(reservationId, {
                        method: pay.method, amount: bill.due > 0 ? pay.amount : "", reference: pay.reference,
                        customer_id: methodOf(pay.method)?.kind === "city_ledger" ? customer?.id : undefined,
                      }), tr("تمت المغادرة وصدرت الفاتورة"), (inv) => {
                        if (inv && canViewInvoices) router.push(`/invoices/${inv}`); else router.refresh();
                      })}>
                      {bill.due > 0 ? tr("تحصيل وتسجيل المغادرة") : tr("تسجيل المغادرة وإصدار الفاتورة")}
                    </Button>
                  )}
                </m.div>
              </AnimatePresence>
            )}
          </CardContent>
        </Card>
      )}

      {canCheckIn && (status === "tentative" || status === "confirmed") && (
        <Card className="border-action/30">
          <CardHeader>
            <CardTitle><KeyRound className="size-5" />{tr("تسجيل الوصول")}</CardTitle>
            <CardDescription>{hourly ? tr("بدء الجلسة وفتح فوليو الحجز، وتسليم {0} للنزيل.", words.one) : tr("غرفة نظيفة في الخدمة، وتسليم {0} للنزيل، ويُفتح فوليو الحجز أو يُستخدم فوليو العربون.", words.one)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!hourly && (
              <div className={field}>
                <Label htmlFor="checkin_room">{tr("الغرفة")}</Label>
                <NativeSelect id="checkin_room" value={room} onChange={(e) => setRoom(e.target.value)}>
                  {!room && <option value="">{tr("اختر غرفة")}</option>}
                  {checkInRooms.map((r) => <option key={r.id} value={r.id}>{r.label}{r.note ? tr("، {0}", r.note) : ""}</option>)}
                </NativeSelect>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <HandoverFields access={roomAccess} keys={keys} onKeys={setKeys} confirmed={handed} onConfirmed={setHanded} idPrefix="checkin" />
            </div>
            <Button type="button" className="w-full" loading={busy === "in"} disabled={pending || (!hourly && !room) || !handed || !validKeys(keys)}
              onClick={() => run("in", () => checkInAction(reservationId, hourly ? null : room, Number(keys)), words.done)}>
              <KeyRound className="size-4" />{tr("إتمام التسكين")}</Button>
          </CardContent>
        </Card>
      )}

      {status === "checked_in" && (
        <Card>
          <CardHeader>
            <CardTitle className="justify-between">
              <span className="flex items-center gap-2"><BedDouble className="size-5" />{tr("أثناء الإقامة")}</span>
              {keysIssued != null && <span className="text-[15px] font-medium text-slate-500">{words.issued} <span className="num text-ink">{keysIssued}</span></span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-panel p-3">
              <p className="text-[15.5px] text-slate-600">{tr("ترحيل الليالي المستحقة حتى اليوم على الفوليو، ويتم تلقائيًا عند المغادرة.")}</p>
              <Button type="button" variant="outline" size="sm" loading={busy === "post"} disabled={pending}
                onClick={() => run("post", () => postChargesAction(reservationId), tr("تم ترحيل الليالي"))}>{tr("ترحيل الليالي")}</Button>
            </div>
            {!hourly && (
              <div className="grid gap-3 @md:grid-cols-[1fr_auto] @md:items-end">
                <div className={field}>
                  <Label htmlFor="new_departure">{tr("تاريخ المغادرة")}</Label>
                  <Input id="new_departure" type="date" dir="ltr" min={today > arrival ? today : arrival} value={newDeparture} onChange={(e) => setNewDeparture(e.target.value)} />
                </div>
                <Button type="button" variant="outline" loading={busy === "dep"} disabled={pending || newDeparture === departure}
                  onClick={() => run("dep", () => changeDepartureAction(reservationId, newDeparture), newDeparture > departure ? tr("تم تمديد الإقامة") : tr("تم تقصير الإقامة"))}>
                  <CalendarPlus className="size-4" />{newDeparture >= departure ? tr("تمديد") : tr("تقصير")}
                </Button>
              </div>
            )}
            {!hourly && moveRooms.length > 0 && (
              <div className="space-y-3 border-t border-line pt-5">
                <div className="grid gap-3 @md:grid-cols-2">
                <div className={field}>
                  <Label htmlFor="move_room">{tr("نقل إلى غرفة")}</Label>
                  <NativeSelect id="move_room" value={move.room} onChange={(e) => setMove({ ...move, room: e.target.value })}>
                    <option value="">{tr("اختر")}</option>
                    {moveRooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </NativeSelect>
                </div>
                <div className={field}>
                  <Label htmlFor="move_reason">{tr("السبب")}</Label>
                  <Input id="move_reason" value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} placeholder={tr("مثل: عطل في التكييف، ترقية")} />
                </div>
                </div>
                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border border-line px-3 text-[15.5px] text-ink">
                  <input type="checkbox" className="size-4 shrink-0" checked={move.handed} onChange={(e) => setMove({ ...move, handed: e.target.checked })} />{tr("سلّمتُ")}{" "}{words.one}{" "}{tr("للغرفة الجديدة واستلمتُ السابقة")}</label>
                <Button type="button" variant="outline" className="w-full" loading={busy === "move"} disabled={pending || !move.room || !move.reason.trim() || !move.handed}
                  onClick={() => run("move", () => moveRoomAction(reservationId, move.room, move.reason.trim()), tr("تم نقل النزيل"), () => { setMove({ room: "", reason: "", handed: false }); router.refresh(); })}>
                  <DoorOpen className="size-4" />{tr("نقل")}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(folio || active) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex-wrap justify-between gap-y-1">
              <span className="flex items-center gap-2"><Wallet className="size-5" />{tr("الفوليو والعربون")}</span>
              {folio && canViewFolio && <Link href={`/folios/${folio.id}`} className="whitespace-nowrap text-[15px] font-medium text-action">{tr("فتح الفوليو")}{" "}<span className="num">{folio.number}</span></Link>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {folio ? (
              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-panel p-3"><dt className="text-[14px] text-slate-500">{tr("رصيد الفوليو")}</dt><dd className="num text-[20px] font-bold text-ink">{money(folio.balance)}</dd></div>
                <div className="rounded-lg bg-panel p-3"><dt className="text-[14px] text-slate-500">{tr("عربون متاح")}</dt><dd className="num text-[20px] font-bold text-success">{money(folio.deposits)}</dd></div>
              </dl>
            ) : <p className="text-[15.5px] text-slate-500">{tr("لم يُفتح فوليو بعد؛ يُفتح عند أول عربون أو عند التسكين.")}</p>}
            {active && cashMethods.length > 0 && (
              <div className="space-y-3 border-t border-line pt-4">
                <p className="text-[15.5px] font-medium text-ink">{tr("عربون جديد")}</p>
                <div className="grid gap-3 @md:grid-cols-2">
                <div className={field}>
                  <Label htmlFor="dep_method">{tr("طريقة الدفع")}</Label>
                  <NativeSelect id="dep_method" value={dep.method} onChange={(e) => setDep({ ...dep, method: e.target.value })}>
                    {cashMethods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </NativeSelect>
                </div>
                <div className={field}>
                  <Label htmlFor="dep_amount">{tr("المبلغ")}{methodOf(dep.method)?.currency ? tr(" بعملة {0}", methodOf(dep.method)!.currency) : ""}</Label>
                  <Input id="dep_amount" inputMode="decimal" dir="ltr" value={dep.amount} onChange={(e) => setDep({ ...dep, amount: e.target.value })} />
                  {approx(dep.method, dep.amount) && <p className="num text-[13px] text-slate-500">{approx(dep.method, dep.amount)}</p>}
                </div>
                </div>
                <div className={field}>
                  <Label htmlFor="dep_ref">{methodOf(dep.method)?.ref ? tr("رقم العملية") : tr("المرجع")}</Label>
                  <Input id="dep_ref" dir="ltr" value={dep.reference} onChange={(e) => setDep({ ...dep, reference: e.target.value })}
                    placeholder={methodOf(dep.method)?.ref ? tr("رقم العملية في المحفظة، إلزامي") : tr("رقم الإيصال أو الحوالة")} />
                </div>
                <Button type="button" variant="outline" className="w-full" loading={busy === "dep_add"} disabled={pending || !dep.amount || (!!methodOf(dep.method)?.ref && !dep.reference.trim())}
                  onClick={() => run("dep_add", () => recordDepositAction(reservationId, dep), tr("تم تسجيل العربون"), () => { setDep({ ...dep, amount: "", reference: "" }); router.refresh(); })}><Wallet className="size-4" />{tr("تسجيل العربون")}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

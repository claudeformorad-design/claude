import { localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";
import { notFound } from "next/navigation";
import Link from "@/components/link";
import { BadgePercent, BedDouble, CalendarRange, Pencil, Repeat, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime, todayInTimeZone } from "@/lib/accounting/fiscal";
import { ZERO, formatMoney, toMoney } from "@/lib/accounting/money";
import { ACTIVE_STATUSES, BILL_TO, PRICING_LABEL, RESERVATION_SOURCE, RESERVATION_STATUS, WEEKDAYS } from "@/lib/pms/labels";
import { dayLabel, nightsBetween, nightsText, timeRange } from "@/lib/pms/dates";
import { folioSnapshot, getReservation, listReservations, listRoomTypes, listRooms } from "@/services/pms.service";
import { listPaymentMethods } from "@/services/revenue-settings.service";
import { latestRates, listExchangeRates } from "@/services/cashier.service";
import { getI18n } from "@/i18n/server";
import { ActionButton } from "../../_pms/action-button";
import { requestReservationCancelAction } from "../../approvals/actions";
import { cancelReservationAction, cancelSeriesAction, cancelWaivedAction, confirmReservationAction, noShowAction, noShowWaivedAction } from "../../_pms/actions";
import type { ReservationPolicy } from "@/lib/supabase/database.types";
import { AssignRoom } from "./assign-room";
import { StayPanel } from "./stay-panel";
import { BillingSelect } from "./billing-select";
import { RatePlanSelect } from "./rate-plan-select";
import { listRatePlans } from "@/services/operations.service";
import { messageBuilder } from "@/services/messages.service";
import { WhatsAppButton } from "@/components/whatsapp-button";

export default async function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const { locale, t } = await getI18n();
  const r = await getReservation(ctx.supabase, ctx.hotel.id, id);
  if (!r) notFound();
  const today = todayInTimeZone(ctx.hotel.timezone);
  const editable = r.status === "tentative" || r.status === "confirmed";
  const canManage = ctx.can(PERMISSIONS.pmsManage) && editable;
  const canCancel = ctx.can(PERMISSIONS.pmsCancel) && editable;
  const hourly = r.booking_mode === "hourly";
  const nights = hourly ? 0 : nightsBetween(r.arrival_date, r.departure_date);
  const status = RESERVATION_STATUS[r.status];
  const discount = r.nights.reduce((a, n) => a.plus(toMoney(n.discount)), ZERO);

  const stayOpen = r.status === "tentative" || r.status === "confirmed" || r.status === "checked_in";
  const canStay = ctx.can(PERMISSIONS.pmsManage) && (stayOpen || !!r.folio_id);

  // الغرف المرشحة للتخصيص: من نفس النوع، مع تمييز المحجوزة في نفس الفترة
  let roomChoices: { id: string; label: string; busy: boolean }[] = [];
  let checkInRooms: { id: string; label: string; note?: string }[] = [];
  let moveRooms: { id: string; label: string }[] = [];
  if (canManage || (canStay && stayOpen)) {
    const [rooms, overlapping, types] = await Promise.all([
      listRooms(ctx.supabase, ctx.hotel.id),
      listReservations(ctx.supabase, ctx.hotel.id, { statuses: ACTIVE_STATUSES, from: r.arrival_date, to: r.departure_date }),
      listRoomTypes(ctx.supabase, ctx.hotel.id),
    ]);
    const nightlyTypes = new Set(types.filter((x) => x.booking_mode === "nightly" && x.is_active).map((x) => x.id));
    const others = overlapping.filter((x) => x.id !== r.id && x.room_id);
    const busyIn = (from: string, to: string) => new Set(others.filter((x) => (hourly
      ? x.starts_at! < r.ends_at! && r.starts_at! < x.ends_at!
      : x.arrival_date < to && from < x.departure_date)).map((x) => x.room_id!));
    const busy = busyIn(r.arrival_date, r.departure_date);
    const usable = rooms.filter((x) => x.is_active && x.service_status === "in_service");
    const sameType = usable.filter((x) => x.room_type_id === r.room_type_id);
    roomChoices = sameType.map((x) => ({ id: x.id, label: tr("الغرفة {0}", x.room_number), busy: busy.has(x.id) }));
    checkInRooms = sameType.filter((x) => !busy.has(x.id))
      .map((x) => ({ id: x.id, label: tr("الغرفة {0}", x.room_number), note: x.housekeeping_status === "dirty" ? tr("تحتاج تنظيف") : undefined }))
      .sort((a, b) => Number(!!a.note) - Number(!!b.note));
    if (r.status === "checked_in" && !hourly) {
      const rest = busyIn(today > r.arrival_date ? today : r.arrival_date, r.departure_date);
      moveRooms = usable.filter((x) => x.id !== r.room_id && !rest.has(x.id) && x.housekeeping_status !== "dirty" && nightlyTypes.has(x.room_type_id))
        .map((x) => ({ id: x.id, label: tr("الغرفة {0}{1}", x.room_number, x.room_type_id !== r.room_type_id ? tr("، نوع آخر") : "") }));
    }
  }

  // الفوليو وطرق الدفع للوحة الإقامة (المال كله في المحاسبة)
  const [folio, methods, rates] = canStay
    ? await Promise.all([
        r.folio_id ? folioSnapshot(ctx.supabase, r.folio_id) : Promise.resolve(null),
        listPaymentMethods(ctx.supabase, ctx.hotel.id),
        listExchangeRates(ctx.supabase, ctx.hotel.id),
      ])
    : [null, [], []];
  const fx = latestRates(rates, today);
  const posted = r.nights.filter((n) => n.folio_transaction_id).length;
  // خطط الأسعار المتاحة لهذا الحجز (الليلي القياسي فقط)
  const planable = !hourly && r.pricing === "standard";
  const plans = planable ? await listRatePlans(ctx.supabase, ctx.hotel.id) : [];
  const planOptions = plans.filter((p) => (p.is_active || p.id === r.rate_plan_id)
    && (!p.customer_id || p.customer_id === r.customer_id) && (!p.room_type_id || p.room_type_id === r.room_type_id))
    .map((p) => ({ id: p.id, label: `${localNameOf(p)}${p.includes_breakfast ? tr(" مع الإفطار") : ""}` }));
  const planName = plans.find((p) => p.id === r.rate_plan_id)?.name_ar;

  // سياسة الحجز: العربون المطلوب، ورسم الإلغاء أو عدم الحضور لو نُفّذ الآن (بحد العربون المدفوع)
  const policy = editable
    ? ((await ctx.supabase.rpc("reservation_policy_status", { p_reservation_id: r.id })).data as ReservationPolicy | null)
    : null;
  const canWaive = ctx.can(PERMISSIONS.pmsRatesOverride);
  const money = (v: number) => formatMoney(v, { locale }) + " " + ctx.hotel.base_currency;

  // مراسلة النزيل بواتساب: تأكيد وتذكير قبل الوصول، وشكر مع رابط التقييم بعد المغادرة
  const msg = await messageBuilder(ctx.supabase, ctx.hotel);
  const waPhone = msg.phone(r.guest?.phone);
  const [survey, invoice] = r.status === "checked_out"
    ? await Promise.all([
        ctx.supabase.from("guest_surveys").select("token, status").eq("hotel_id", ctx.hotel.id).eq("reservation_id", r.id).maybeSingle().then((x) => x.data as { token: string; status: string } | null),
        r.folio_id ? ctx.supabase.from("invoices").select("invoice_number, total::text").eq("hotel_id", ctx.hotel.id).eq("folio_id", r.folio_id).maybeSingle().then((x) => x.data as { invoice_number: string; total: string } | null) : Promise.resolve(null),
      ])
    : [null, null];
  const waVars = {
    guest: r.guest?.full_name, confirmation: r.confirmation_number,
    arrival: hourly ? `${dayLabel(r.arrival_date, { weekday: "long", day: "numeric", month: "long" })} ${timeRange(r.starts_at, r.ends_at)}` : dayLabel(r.arrival_date, { weekday: "long", day: "numeric", month: "long" }),
    departure: hourly ? null : dayLabel(r.departure_date, { weekday: "long", day: "numeric", month: "long" }),
    nights: hourly ? null : nights, room_type: r.room_type?.name_ar, room: r.room?.room_number, total: msg.money(r.total_amount),
  };

  return (
    <>
      <PageHeader
        title={tr("الحجز {0}", r.confirmation_number)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.variant} className="text-[16px]">{status.label}</Badge>
            <Button asChild variant="outline" size="sm"><Link href={`/reservations/${r.id}/card`}>{tr("بطاقة التسجيل")}</Link></Button>
            {canManage && <Button asChild variant="outline" size="sm"><Link href={`/reservations/${r.id}/edit`}><Pencil className="size-4" />{tr("تعديل")}</Link></Button>}
            {canManage && r.status === "tentative" && (!policy || policy.deposit_due === 0 || canWaive) && (
              <ActionButton variant="default" label={tr("تأكيد الحجز")} done={tr("تم تأكيد الحجز")} errors={t.errors} run={confirmReservationAction.bind(null, r.id)}
                confirmText={policy && policy.deposit_due > 0 ? tr("لم يُدفع العربون المطلوب ({0}). تأكيده الآن تجاوز للسياسة.", money(policy.deposit_due)) : undefined} />
            )}
            {canCancel && r.arrival_date <= today && (
              <ActionButton label={tr("لم يحضر")} done={tr("سُجّل عدم الحضور")} errors={t.errors} reasonLabel={tr("ملاحظة")} reasonRequired={false} run={noShowAction.bind(null, r.id)}
                confirmText={policy && policy.no_show_charge > 0 ? tr("سيُخصم رسم عدم الحضور {0} من العربون المدفوع.", money(policy.no_show_charge)) : undefined} />
            )}
            {canCancel && r.arrival_date <= today && canWaive && policy && policy.no_show_charge > 0 && (
              <ActionButton label={tr("لم يحضر بدون رسوم")} done={tr("سُجّل عدم الحضور بدون رسوم")} errors={t.errors} reasonLabel={tr("سبب الإعفاء")} run={noShowWaivedAction.bind(null, r.id)} />
            )}
            {canCancel && (
              <ActionButton variant="destructive" label={tr("إلغاء الحجز")} done={tr("أُلغي الحجز")} errors={t.errors} reasonLabel={tr("سبب الإلغاء")} run={cancelReservationAction.bind(null, r.id)}
                confirmText={policy && policy.cancel_charge > 0 ? tr("الإلغاء الآن عليه رسم {0} يُخصم من العربون المدفوع.", money(policy.cancel_charge)) : undefined} />
            )}
            {canCancel && canWaive && policy && policy.cancel_charge > 0 && (
              <ActionButton variant="destructive" label={tr("إلغاء بدون رسوم")} done={tr("أُلغي الحجز بدون رسوم")} errors={t.errors} reasonLabel={tr("سبب الإعفاء")} run={cancelWaivedAction.bind(null, r.id)} />
            )}
            {canManage && !canCancel && (
              <ActionButton label={tr("طلب إلغاء")} done={tr("أُرسل طلب الإلغاء للمدير")} errors={t.errors} reasonLabel={tr("سبب الإلغاء")} run={requestReservationCancelAction.bind(null, r.id)} />
            )}
          </div>
        }
      />

      <StatGrid>
        <Stat icon={CalendarRange} tone="ink" label={hourly ? tr("الموعد") : tr("الإقامة")}
          value={hourly ? timeRange(r.starts_at, r.ends_at) : nightsText(nights)}
          hint={hourly ? dayLabel(r.arrival_date, { weekday: "long", day: "numeric", month: "long" }) : tr("من {0} إلى {1}", dayLabel(r.arrival_date), dayLabel(r.departure_date))} />
        <Stat icon={BedDouble} tone="teal" label={hourly ? tr("الوحدة") : tr("الغرفة")} value={r.room ? <span className="num">{r.room.room_number}</span> : <span className="text-slate-500">{tr("غير مخصصة")}</span>} hint={localNameOf(r.room_type)} />
        <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="clay" label={tr("المبلغ المثبّت")} value={<Money value={r.total_amount} locale={locale} />} hint={PRICING_LABEL[r.pricing]} />
        <Stat icon={Users} tone="neutral" label={tr("النزلاء")} value={<span className="num">{r.adults}{r.children ? tr(" بالغ و{0} طفل", r.children) : ""}</span>} hint={`${RESERVATION_SOURCE[r.source]}${r.customer ? tr("، {0}", r.customer.name_ar) : ""}`} />
      </StatGrid>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {canManage && (
            <Card>
              <CardHeader><CardTitle>{hourly ? tr("الوحدة") : tr("تخصيص الغرفة")}</CardTitle></CardHeader>
              <CardContent>
                {roomChoices.length === 0 ? <p className="text-slate-500">{tr("لا توجد غرف في الخدمة من هذا النوع.")}</p> : (
                  <AssignRoom reservationId={r.id} current={r.room_id} rooms={roomChoices} allowNone={!hourly} errors={t.errors} />
                )}
              </CardContent>
            </Card>
          )}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="justify-between">
                <span>{hourly ? tr("تفصيل السعر") : tr("أسعار الليالي المثبّتة وقت الحجز")}</span>
                <span className="flex flex-wrap gap-2">
                  {posted > 0 && <Badge variant="success">{tr("مُرحَّل على الفوليو:")}{" "}{posted}{" "}{tr("من")}{" "}{r.nights.length}</Badge>}
                  {r.last_minute_pct && <Badge variant="info"><BadgePercent className="size-3.5" />{tr("خصم اللحظة الأخيرة")}{" "}{Number(r.last_minute_pct)}%</Badge>}
                </span>
              </CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow><TableHead>{hourly ? tr("التاريخ") : tr("الليلة")}</TableHead><TableHead>{hourly ? tr("الساعات") : tr("الموسم")}</TableHead><TableHead className="text-end">{tr("السعر")}</TableHead><TableHead className="text-end">{tr("الخصم")}</TableHead><TableHead className="text-end">{tr("المبلغ")}</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {r.nights.map((n) => (
                  <TableRow key={n.stay_date}>
                    <TableCell>{dayLabel(n.stay_date, { weekday: "long", day: "numeric", month: "long" })}{n.folio_transaction_id && <Badge variant="success" className="ms-2">{tr("مُرحّلة")}</Badge>}</TableCell>
                    <TableCell>{hourly ? <span className="num">{Number(n.quantity)}</span> : n.season_name ? <Badge variant="outline">{n.season_name}</Badge> : <span className="text-slate-400"></span>}</TableCell>
                    <TableCell className="text-end"><Money value={n.rate} locale={locale} /></TableCell>
                    <TableCell className="text-end"><Money value={n.discount} locale={locale} blankZero /></TableCell>
                    <TableCell className="text-end font-semibold"><Money value={n.amount} locale={locale} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>{tr("الإجمالي")}{r.pricing !== "standard" && r.fixed_rate ? tr("، {0} {1}", PRICING_LABEL[r.pricing], Number(r.fixed_rate).toLocaleString("en")) : ""}</TableCell>
                  <TableCell className="text-end"><Money value={discount} locale={locale} blankZero /></TableCell>
                  <TableCell className="text-end"><Money value={r.total_amount} locale={locale} /></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          {policy && (policy.required_deposit > 0 || policy.free_cancel_until) && (
            <Card>
              <CardHeader><CardTitle>{tr("سياسة الحجز")}</CardTitle></CardHeader>
              <CardContent>
                <dl className="space-y-3 text-[16px]">
                  {policy.required_deposit > 0 && (
                    <>
                      <Row label={tr("العربون المطلوب")}><span className="num font-semibold">{money(policy.required_deposit)}</span></Row>
                      <Row label={tr("المدفوع")}><span className="num">{money(policy.deposit_paid)}</span></Row>
                      {policy.deposit_due > 0
                        ? <Row label={tr("المتبقي")}><Badge variant="warning"><span className="num">{money(policy.deposit_due)}</span></Badge>
                            {r.status === "tentative" && <span className="mt-1 block text-[14px] text-slate-500">{tr("يتأكد الحجز تلقائيًا عند اكتمال العربون.")}</span>}</Row>
                        : <Row label={tr("الحالة")}><Badge variant="success">{tr("العربون مكتمل")}</Badge></Row>}
                    </>
                  )}
                  {policy.free_cancel_until && (
                    <Row label={tr("الإلغاء المجاني")}>
                      {policy.cancel_fee > 0
                        ? <span>{tr("انتهت مهلته. رسم الإلغاء الآن {0}", money(policy.cancel_charge))}{policy.cancel_charge < policy.cancel_fee && <span className="block text-[14px] text-slate-500">{tr("بحد العربون المدفوع، والرسم الكامل {0}", money(policy.cancel_fee))}</span>}</span>
                        : <span>{tr("حتى {0}", formatDateTime(policy.free_cancel_until, ctx.hotel.timezone))}</span>}
                    </Row>
                  )}
                </dl>
              </CardContent>
            </Card>
          )}
          {r.status !== "cancelled" && r.status !== "no_show" && (
            <Card>
              <CardHeader><CardTitle>{tr("مراسلة النزيل")}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {(r.status === "tentative" || r.status === "confirmed" || r.status === "checked_in") && (
                    <WhatsAppButton phone={waPhone} label={tr("تأكيد الحجز")} text={msg.text("reservation_confirm", waVars)} />
                  )}
                  {(r.status === "tentative" || r.status === "confirmed") && (
                    <WhatsAppButton phone={waPhone} label={tr("تذكير بالوصول")} text={msg.text("arrival_reminder", waVars)} />
                  )}
                  {r.status === "checked_out" && (
                    <WhatsAppButton phone={waPhone} label={tr("شكر بعد المغادرة")} text={msg.text("checkout_thanks", {
                      ...waVars, total: invoice ? msg.money(invoice.total) : waVars.total, invoice: invoice?.invoice_number,
                      survey_link: survey?.status === "pending" ? `{origin}/survey/${survey.token}` : null,
                    })} />
                  )}
                </div>
                <p className="text-[14px] text-slate-500">
                  {waPhone ? tr("يفتح واتساب برسالة جاهزة على رقم النزيل، راجعها ثم اضغط إرسال.") : tr("لا يوجد رقم جوال صالح للنزيل؛ سيفتح واتساب لتختار المستلم بنفسك.")}
                </p>
              </CardContent>
            </Card>
          )}
          {canStay && (
            <StayPanel
              reservationId={r.id} status={r.status} hourly={hourly} canCheckIn={r.arrival_date <= today && (hourly || r.departure_date > today)}
              today={today} arrival={r.arrival_date} departure={r.departure_date}
              folio={folio && folio.status === "open" ? { id: folio.id, number: folio.number, balance: folio.balance, deposits: folio.deposits } : null}
              methods={methods.filter((m) => m.is_active).map((m) => ({
                id: m.id, label: localNameOf(m), kind: m.kind, currency: m.currency_code, ref: m.requires_reference,
                rate: m.currency_code ? Number(fx.get(m.currency_code)?.rate ?? 0) || null : null,
              }))}
              baseCurrency={ctx.hotel.base_currency} billTo={r.bill_to} roomAccess={ctx.hotel.room_access} keysIssued={r.keys_issued}
              customer={r.customer && r.customer_id ? { id: r.customer_id, label: localNameOf(r.customer) } : null}
              checkInRooms={checkInRooms} moveRooms={moveRooms} currentRoomId={r.room_id}
              canViewFolio={ctx.can(PERMISSIONS.folioView)} canViewInvoices={ctx.can(PERMISSIONS.invoicesView)} errors={t.errors}
            />
          )}
          <Card>
            <CardHeader><CardTitle>{tr("التفاصيل")}</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3 text-[16px]">
                <Row label={tr("النزيل")}><Link href={`/guests/${r.guest_id}`} className="font-semibold text-ink">{r.guest?.full_name}</Link>{r.guest?.phone && <span className="num ms-2 text-slate-500" dir="ltr">{r.guest.phone}</span>}</Row>
                {r.customer && <Row label={tr("الشركة")}>{localNameOf(r.customer)}</Row>}
                {r.customer && (
                  <Row label={tr("الفوترة")}>
                    {canStay && stayOpen ? <BillingSelect reservationId={r.id} current={r.bill_to} errors={t.errors} /> : BILL_TO[r.bill_to]}
                  </Row>
                )}
                {r.status === "tentative" && r.tentative_until && <Row label={tr("مبدئي حتى")}><span className="num">{r.tentative_until}</span></Row>}
                {planable && (planOptions.length > 0 || r.rate_plan_id) && (
                  <Row label={tr("خطة السعر")}>
                    {ctx.can(PERMISSIONS.pmsManage) && stayOpen
                      ? <RatePlanSelect reservationId={r.id} current={r.rate_plan_id} plans={planOptions} errors={t.errors} />
                      : (planName ?? tr("السعر القياسي"))}
                  </Row>
                )}
                {r.rate_reason && <Row label={tr("سبب السعر")}>{r.rate_reason}</Row>}
                {r.special_requests && <Row label={tr("طلبات النزيل")}>{r.special_requests}</Row>}
                {r.notes && <Row label={tr("ملاحظات")}>{r.notes}</Row>}
                {r.checked_in_at && <Row label={tr("الوصول")}><span className="num">{formatDateTime(r.checked_in_at, ctx.hotel.timezone)}</span></Row>}
                {r.checked_out_at && <Row label={tr("المغادرة")}><span className="num">{formatDateTime(r.checked_out_at, ctx.hotel.timezone)}</span></Row>}
                {folio && folio.status !== "open" && ctx.can(PERMISSIONS.folioView) && <Row label={tr("الفوليو")}><Link href={`/folios/${folio.id}`} className="num font-semibold text-action">{folio.number}</Link></Row>}
                {r.cancellation_reason && <Row label={r.status === "no_show" ? tr("عدم الحضور") : tr("سبب الإلغاء")}>{r.cancellation_reason}</Row>}
                {r.policy_fee && <Row label={r.status === "no_show" ? tr("رسم عدم الحضور") : tr("رسم الإلغاء")}><span className="num font-semibold">{money(Number(r.policy_fee))}</span></Row>}
                <Row label={tr("أُنشئ")}><span className="num">{formatDateTime(r.created_at, ctx.hotel.timezone)}</span></Row>
              </dl>
            </CardContent>
          </Card>
          {r.group && (
            <Card>
              <CardHeader><CardTitle><Users className="size-5" />{tr("مجموعة")}{" "}{r.group.name}</CardTitle></CardHeader>
              <CardContent><Button asChild variant="outline" size="sm"><Link href={`/reservations?group=${r.group_id}`}>{tr("كل حجوزات المجموعة")}{" "}<span className="num">{r.group.group_number}</span></Link></Button></CardContent>
            </Card>
          )}
          {r.series && (
            <Card>
              <CardHeader><CardTitle><Repeat className="size-5" />{tr("حجز متكرر")}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[16px] text-slate-700">{tr("كل")}{" "}{WEEKDAYS[r.series.weekday]} {r.series.nights ? tr("لـ {0} ليلة", r.series.nights) : tr("من {0} إلى {1}", r.series.start_time?.slice(0, 5), r.series.end_time?.slice(0, 5))}
                  <span className="block text-slate-500">{tr("من")}{" "}<span className="num">{r.series.start_date}</span>{" "}{tr("إلى")}{" "}<span className="num">{r.series.end_date}</span></span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm"><Link href={`/reservations?series=${r.series.id}`}>{tr("كل المواعيد")}</Link></Button>
                  {r.series.status === "active" && ctx.can(PERMISSIONS.pmsCancel) && (
                    <ActionButton variant="destructive" label={tr("إلغاء بقية المواعيد")} done={tr("أُلغيت المواعيد القادمة")} errors={t.errors}
                      reasonLabel={tr("سبب إلغاء بقية المواعيد من اليوم")} run={cancelSeriesAction.bind(null, r.series.id)} />
                  )}
                  {r.series.status === "cancelled" && <Badge variant="destructive">{tr("أُلغي التكرار")}</Badge>}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

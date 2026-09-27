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
import { ZERO, toMoney } from "@/lib/accounting/money";
import { ACTIVE_STATUSES, BILL_TO, PRICING_LABEL, RESERVATION_SOURCE, RESERVATION_STATUS, WEEKDAYS } from "@/lib/pms/labels";
import { dayLabel, nightsBetween, timeOf } from "@/lib/pms/dates";
import { folioSnapshot, getReservation, listReservations, listRoomTypes, listRooms } from "@/services/pms.service";
import { listPaymentMethods } from "@/services/revenue-settings.service";
import { latestRates, listExchangeRates } from "@/services/cashier.service";
import { getI18n } from "@/i18n/server";
import { ActionButton } from "../../_pms/action-button";
import { cancelReservationAction, cancelSeriesAction, confirmReservationAction, noShowAction } from "../../_pms/actions";
import { AssignRoom } from "./assign-room";
import { StayPanel } from "./stay-panel";
import { BillingSelect } from "./billing-select";
import { RatePlanSelect } from "./rate-plan-select";
import { listRatePlans } from "@/services/operations.service";

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
    roomChoices = sameType.map((x) => ({ id: x.id, label: `الغرفة ${x.room_number}`, busy: busy.has(x.id) }));
    checkInRooms = sameType.filter((x) => !busy.has(x.id))
      .map((x) => ({ id: x.id, label: `الغرفة ${x.room_number}`, note: x.housekeeping_status === "dirty" ? "تحتاج تنظيف" : undefined }))
      .sort((a, b) => Number(!!a.note) - Number(!!b.note));
    if (r.status === "checked_in" && !hourly) {
      const rest = busyIn(today > r.arrival_date ? today : r.arrival_date, r.departure_date);
      moveRooms = usable.filter((x) => x.id !== r.room_id && !rest.has(x.id) && x.housekeeping_status !== "dirty" && nightlyTypes.has(x.room_type_id))
        .map((x) => ({ id: x.id, label: `الغرفة ${x.room_number}${x.room_type_id !== r.room_type_id ? " (نوع آخر)" : ""}` }));
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
    .map((p) => ({ id: p.id, label: `${p.name_ar}${p.includes_breakfast ? " (مع الإفطار)" : ""}` }));
  const planName = plans.find((p) => p.id === r.rate_plan_id)?.name_ar;

  return (
    <>
      <PageHeader
        title={`الحجز ${r.confirmation_number}`}
        description={`${r.guest?.full_name ?? ""} — ${r.room_type?.name_ar ?? ""}${r.group ? ` — مجموعة ${r.group.name}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.variant} className="text-[16px]">{status.label}</Badge>
            {canManage && <Button asChild variant="outline" size="sm"><Link href={`/reservations/${r.id}/edit`}><Pencil className="size-4" />تعديل</Link></Button>}
            {canManage && r.status === "tentative" && (
              <ActionButton variant="default" label="تأكيد الحجز" done="تم تأكيد الحجز" errors={t.errors} run={confirmReservationAction.bind(null, r.id)} />
            )}
            {canCancel && r.arrival_date <= today && (
              <ActionButton label="لم يحضر" done="سُجّل عدم الحضور" errors={t.errors} reasonLabel="ملاحظة (اختيارية)" reasonRequired={false} run={noShowAction.bind(null, r.id)} />
            )}
            {canCancel && (
              <ActionButton variant="destructive" label="إلغاء الحجز" done="أُلغي الحجز" errors={t.errors} reasonLabel="سبب الإلغاء" run={cancelReservationAction.bind(null, r.id)} />
            )}
          </div>
        }
      />

      <StatGrid>
        <Stat icon={CalendarRange} tone="ink" label={hourly ? "الموعد" : "الإقامة"}
          value={<span className="num text-[21px]">{hourly ? `${timeOf(r.starts_at)}–${timeOf(r.ends_at)}` : `${nights} ${nights === 1 ? "ليلة" : "ليلة"}`}</span>}
          hint={hourly ? dayLabel(r.arrival_date, { weekday: "long", day: "numeric", month: "long" }) : `${dayLabel(r.arrival_date)} ← ${dayLabel(r.departure_date)}`} />
        <Stat icon={BedDouble} tone="teal" label={hourly ? "الوحدة" : "الغرفة"} value={r.room ? <span className="num">{r.room.room_number}</span> : <span className="text-[20px] text-slate-500">غير مخصصة</span>} hint={r.room_type?.name_ar} />
        <Stat icon={Wallet} tone="clay" label="المبلغ المثبّت" value={<Money value={r.total_amount} locale={locale} />} hint={PRICING_LABEL[r.pricing]} />
        <Stat icon={Users} tone="neutral" label="النزلاء" value={<span className="num">{r.adults}{r.children ? ` + ${r.children}` : ""}</span>} hint={`${RESERVATION_SOURCE[r.source]}${r.customer ? ` · ${r.customer.name_ar}` : ""}`} />
      </StatGrid>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {canManage && (
            <Card>
              <CardHeader><CardTitle>{hourly ? "الوحدة" : "تخصيص الغرفة"}</CardTitle></CardHeader>
              <CardContent>
                {roomChoices.length === 0 ? <p className="text-slate-500">لا توجد غرف في الخدمة من هذا النوع.</p> : (
                  <AssignRoom reservationId={r.id} current={r.room_id} rooms={roomChoices} allowNone={!hourly} errors={t.errors} />
                )}
              </CardContent>
            </Card>
          )}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="justify-between">
                <span>{hourly ? "تفصيل السعر" : "أسعار الليالي (مثبّتة وقت الحجز)"}</span>
                <span className="flex flex-wrap gap-2">
                  {posted > 0 && <Badge variant="success">مُرحَّل على الفوليو: {posted} من {r.nights.length}</Badge>}
                  {r.last_minute_pct && <Badge variant="info"><BadgePercent className="size-3.5" />خصم اللحظة الأخيرة {Number(r.last_minute_pct)}%</Badge>}
                </span>
              </CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow><TableHead>{hourly ? "التاريخ" : "الليلة"}</TableHead><TableHead>{hourly ? "الساعات" : "الموسم"}</TableHead><TableHead className="text-end">السعر</TableHead><TableHead className="text-end">الخصم</TableHead><TableHead className="text-end">المبلغ</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {r.nights.map((n) => (
                  <TableRow key={n.stay_date}>
                    <TableCell>{dayLabel(n.stay_date, { weekday: "long", day: "numeric", month: "long" })}{n.folio_transaction_id && <Badge variant="success" className="ms-2">مُرحّلة</Badge>}</TableCell>
                    <TableCell>{hourly ? <span className="num">{Number(n.quantity)}</span> : n.season_name ? <Badge variant="outline">{n.season_name}</Badge> : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-end"><Money value={n.rate} locale={locale} /></TableCell>
                    <TableCell className="text-end"><Money value={n.discount} locale={locale} blankZero /></TableCell>
                    <TableCell className="text-end font-semibold"><Money value={n.amount} locale={locale} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>الإجمالي{r.pricing !== "standard" && r.fixed_rate ? ` — ${PRICING_LABEL[r.pricing]}: ${Number(r.fixed_rate).toLocaleString("en")}` : ""}</TableCell>
                  <TableCell className="text-end"><Money value={discount} locale={locale} blankZero /></TableCell>
                  <TableCell className="text-end"><Money value={r.total_amount} locale={locale} /></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          {canStay && (
            <StayPanel
              reservationId={r.id} status={r.status} hourly={hourly} canCheckIn={r.arrival_date <= today && (hourly || r.departure_date > today)}
              today={today} arrival={r.arrival_date} departure={r.departure_date}
              folio={folio && folio.status === "open" ? { id: folio.id, number: folio.number, balance: folio.balance, deposits: folio.deposits } : null}
              methods={methods.filter((m) => m.is_active).map((m) => ({
                id: m.id, label: m.name_ar, kind: m.kind, currency: m.currency_code,
                rate: m.currency_code ? Number(fx.get(m.currency_code)?.rate ?? 0) || null : null,
              }))}
              baseCurrency={ctx.hotel.base_currency} billTo={r.bill_to}
              customer={r.customer && r.customer_id ? { id: r.customer_id, label: r.customer.name_ar } : null}
              checkInRooms={checkInRooms} moveRooms={moveRooms} currentRoomId={r.room_id}
              canViewFolio={ctx.can(PERMISSIONS.folioView)} canViewInvoices={ctx.can(PERMISSIONS.invoicesView)} errors={t.errors}
            />
          )}
          <Card>
            <CardHeader><CardTitle>التفاصيل</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3 text-[16px]">
                <Row label="النزيل"><Link href={`/guests/${r.guest_id}`} className="font-semibold text-ink hover:underline">{r.guest?.full_name}</Link>{r.guest?.phone && <span className="num ms-2 text-slate-500" dir="ltr">{r.guest.phone}</span>}</Row>
                {r.customer && <Row label="الشركة">{r.customer.name_ar}</Row>}
                {r.customer && (
                  <Row label="الفوترة">
                    {canStay && stayOpen ? <BillingSelect reservationId={r.id} current={r.bill_to} errors={t.errors} /> : BILL_TO[r.bill_to]}
                  </Row>
                )}
                {r.status === "tentative" && r.tentative_until && <Row label="مبدئي حتى"><span className="num">{r.tentative_until}</span></Row>}
                {planable && (planOptions.length > 0 || r.rate_plan_id) && (
                  <Row label="خطة السعر">
                    {ctx.can(PERMISSIONS.pmsManage) && stayOpen
                      ? <RatePlanSelect reservationId={r.id} current={r.rate_plan_id} plans={planOptions} errors={t.errors} />
                      : (planName ?? "السعر القياسي")}
                  </Row>
                )}
                {r.rate_reason && <Row label="سبب السعر">{r.rate_reason}</Row>}
                {r.special_requests && <Row label="طلبات النزيل">{r.special_requests}</Row>}
                {r.notes && <Row label="ملاحظات">{r.notes}</Row>}
                {r.checked_in_at && <Row label="الوصول"><span className="num">{formatDateTime(r.checked_in_at, ctx.hotel.timezone)}</span></Row>}
                {r.checked_out_at && <Row label="المغادرة"><span className="num">{formatDateTime(r.checked_out_at, ctx.hotel.timezone)}</span></Row>}
                {folio && folio.status !== "open" && ctx.can(PERMISSIONS.folioView) && <Row label="الفوليو"><Link href={`/folios/${folio.id}`} className="num font-semibold text-action hover:underline">{folio.number}</Link></Row>}
                {r.cancellation_reason && <Row label={r.status === "no_show" ? "عدم الحضور" : "سبب الإلغاء"}>{r.cancellation_reason}</Row>}
                <Row label="أُنشئ"><span className="num">{formatDateTime(r.created_at, ctx.hotel.timezone)}</span></Row>
              </dl>
            </CardContent>
          </Card>
          {r.group && (
            <Card>
              <CardHeader><CardTitle><Users className="size-5" />مجموعة {r.group.name}</CardTitle></CardHeader>
              <CardContent><Button asChild variant="outline" size="sm"><Link href={`/reservations?group=${r.group_id}`}>كل حجوزات المجموعة ({r.group.group_number})</Link></Button></CardContent>
            </Card>
          )}
          {r.series && (
            <Card>
              <CardHeader><CardTitle><Repeat className="size-5" />حجز متكرر</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[16px] text-slate-700">
                  كل {WEEKDAYS[r.series.weekday]} {r.series.nights ? `لـ ${r.series.nights} ليلة` : `من ${r.series.start_time?.slice(0, 5)} إلى ${r.series.end_time?.slice(0, 5)}`}
                  <span className="num block text-[15px] text-slate-500">{r.series.start_date} ← {r.series.end_date}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm"><Link href={`/reservations?series=${r.series.id}`}>كل المواعيد</Link></Button>
                  {r.series.status === "active" && ctx.can(PERMISSIONS.pmsCancel) && (
                    <ActionButton variant="destructive" label="إلغاء بقية المواعيد" done="أُلغيت المواعيد القادمة" errors={t.errors}
                      reasonLabel="سبب إلغاء بقية المواعيد (من اليوم)" run={cancelSeriesAction.bind(null, r.series.id)} />
                  )}
                  {r.series.status === "cancelled" && <Badge variant="destructive">أُلغي التكرار</Badge>}
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

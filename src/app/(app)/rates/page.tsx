import Link from "@/components/link";
import { BadgePercent, CalendarRange, Plus, Sun, Tags } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { formatMoney } from "@/lib/accounting/money";
import { addDays, dayLabel } from "@/lib/pms/dates";
import { WEEKDAYS } from "@/lib/pms/labels";
import { cn } from "@/lib/utils";
import { listLastMinuteRules, listRoomTypes, listSeasons, quoteReservation } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../_assets/simple-form";
import { ActionButton } from "../_pms/action-button";
import { deleteLastMinuteAction, deleteSeasonAction, saveLastMinuteAction } from "../_pms/actions";
import { SeasonForm } from "./season-form";

const DAYS = 14;

/**
 * الأسعار: السعر الأساسي وسعر نهاية الأسبوع لكل نوع، والمواسم بفتراتها وأسعارها، وعروض اللحظة الأخيرة،
 * وتقويم يعرض السعر الفعلي لكل نوع في الأسبوعين القادمين. كل حجز يثبّت سعر لياليه لحظة إنشائه.
 */
export default async function RatesPage({ searchParams }: { searchParams: Promise<{ season?: string; rule?: string; start?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const start = sp.start && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) ? sp.start : today;
  const [types, seasons, rules] = await Promise.all([
    listRoomTypes(ctx.supabase, ctx.hotel.id),
    listSeasons(ctx.supabase, ctx.hotel.id),
    listLastMinuteRules(ctx.supabase, ctx.hotel.id),
  ]);
  const nightly = types.filter((x) => x.is_active && x.booking_mode === "nightly");
  const canManage = ctx.can(PERMISSIONS.pmsRatesManage);
  const typeName = new Map(types.map((x) => [x.id, x.name_ar]));

  // تقويم الأسعار: السعر الفعلي لكل ليلة (الموسم ونهاية الأسبوع) دون خصم اللحظة الأخيرة
  const calendar = await Promise.all(nightly.map(async (x) => {
    const q = await quoteReservation(ctx.supabase, ctx.hotel.id, { roomTypeId: x.id, arrival: start, departure: addDays(start, DAYS), pricing: "standard" }).catch(() => null);
    return { type: x, lines: q?.lines ?? [] };
  }));
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));
  const weekend = new Set(ctx.hotel.weekend_nights);

  const editingSeason = canManage ? (sp.season === "new" ? null : seasons.find((s) => s.id === sp.season)) : undefined;
  const editingRule = canManage ? (sp.rule === "new" ? null : rules.find((r) => r.id === sp.rule)) : undefined;
  const activeSeason = seasons.find((s) => s.is_active && s.date_from <= today && today <= s.date_to);

  return (
    <>
      <PageHeader
        title={t.nav.rates}
        description="السعر الأساسي ونهاية الأسبوع والمواسم وعروض اللحظة الأخيرة. كل حجز يثبّت سعر لياليه وقت إنشائه، فتغيير الأسعار لا يمس الحجوزات القائمة."
        actions={canManage && (
          <>
            <Button asChild variant="outline"><Link href="/rates?rule=new"><BadgePercent />عرض لحظة أخيرة</Link></Button>
            <Button asChild><Link href="/rates?season=new"><Plus />موسم جديد</Link></Button>
          </>
        )}
      />
      <StatGrid>
        <Stat icon={Tags} tone="ink" label="أنواع ليلية بأسعار" value={<span className="num">{nightly.length}</span>} />
        <Stat icon={CalendarRange} tone="teal" label="المواسم الفعّالة" value={<span className="num">{seasons.filter((s) => s.is_active).length}</span>} hint={activeSeason ? `الآن: ${activeSeason.name}` : "لا موسم اليوم"} />
        <Stat icon={BadgePercent} tone="clay" label="عروض اللحظة الأخيرة" value={<span className="num">{rules.filter((r) => r.is_active).length}</span>} />
        <Stat icon={Sun} tone="neutral" label="ليالي نهاية الأسبوع" value={<span className="text-[20px]">{ctx.hotel.weekend_nights.map((d) => WEEKDAYS[d]).join(" و") || "—"}</span>}
          hint={ctx.can(PERMISSIONS.hotelManage) ? <Link href="/settings/hotel" className="text-action hover:underline">تعديل من الإعدادات</Link> : undefined} />
      </StatGrid>

      {(editingSeason !== undefined || editingRule !== undefined) && (
        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          {editingSeason !== undefined && (
            <Card>
              <CardHeader><CardTitle>{editingSeason ? `تعديل ${editingSeason.name}` : "موسم جديد"}</CardTitle>
                <CardDescription>موسم فعّال واحد لكل يوم؛ لا تتداخل فترات المواسم الفعّالة.</CardDescription></CardHeader>
              <CardContent>
                <SeasonForm key={editingSeason?.id ?? "new"} errors={t.errors}
                  types={nightly.map((x) => ({ id: x.id, label: x.name_ar, base: formatMoney(x.base_rate, { locale }) }))}
                  initial={{
                    ...(editingSeason ? { id: editingSeason.id } : {}),
                    name: editingSeason?.name ?? "", date_from: editingSeason?.date_from ?? today, date_to: editingSeason?.date_to ?? addDays(today, 30),
                    adjust_pct: editingSeason?.adjust_pct ? String(Number(editingSeason.adjust_pct)) : "", is_active: editingSeason?.is_active ?? true,
                    notes: editingSeason?.notes ?? "",
                    prices: (editingSeason?.prices ?? []).map((p) => ({ room_type_id: p.room_type_id, nightly_rate: String(Number(p.nightly_rate)), weekend_rate: p.weekend_rate ? String(Number(p.weekend_rate)) : "" })),
                  }} />
              </CardContent>
            </Card>
          )}
          {editingRule !== undefined && (
            <Card className="h-fit">
              <CardHeader><CardTitle>{editingRule ? `تعديل ${editingRule.name}` : "عرض لحظة أخيرة"}</CardTitle>
                <CardDescription>خصم تلقائي على الحجز الذي يصل خلال عدد أيام من تاريخ الحجز (0 = نفس اليوم)، للأسعار العادية فقط.</CardDescription></CardHeader>
              <CardContent>
                <SimpleForm key={editingRule?.id ?? "new"} columns={2} submitLabel={t.common.save} errors={t.errors} action={saveLastMinuteAction} onDone="/rates"
                  initial={{
                    ...(editingRule ? { id: editingRule.id } : {}),
                    name: editingRule?.name ?? "عرض الليلة", room_type_id: editingRule?.room_type_id ?? "",
                    days_before: String(editingRule?.days_before ?? 1), discount_pct: editingRule ? String(Number(editingRule.discount_pct)) : "15",
                    is_active: editingRule?.is_active ?? true,
                  }}
                  fields={[
                    { name: "name", label: "اسم العرض" },
                    { name: "room_type_id", label: "النوع (فارغ = كل الأنواع)", optional: true, options: nightly.map((x) => ({ id: x.id, label: x.name_ar })) },
                    { name: "days_before", label: "الوصول خلال (أيام)", type: "number" },
                    { name: "discount_pct", label: "نسبة الخصم %", type: "number" },
                    { name: "is_active", label: "فعّال", checkbox: true },
                  ]} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Card className="mb-6 overflow-hidden">
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1"><CardTitle>تقويم الأسعار</CardTitle><CardDescription>السعر الفعلي لكل ليلة بعد المواسم ونهاية الأسبوع.</CardDescription></div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm"><Link href={`/rates?start=${addDays(start, -DAYS)}`}>السابق</Link></Button>
            {start !== today && <Button asChild variant="outline" size="sm"><Link href="/rates">اليوم</Link></Button>}
            <Button asChild variant="outline" size="sm"><Link href={`/rates?start=${addDays(start, DAYS)}`}>التالي</Link></Button>
          </div>
        </CardHeader>
        {nightly.length === 0 ? <CardContent><p className="text-slate-500">لا توجد أنواع غرف ليلية.</p></CardContent> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[15px]">
              <thead>
                <tr className="bg-thead text-thead-text">
                  <th className="sticky start-0 z-10 bg-thead px-4 py-3 text-start font-bold">النوع</th>
                  {days.map((d) => (
                    <th key={d} className={cn("min-w-[62px] px-1 py-3 text-center font-medium", weekend.has(new Date(`${d}T00:00:00Z`).getUTCDay()) && "bg-white/10")}>
                      <span className="block text-[13px] opacity-75">{dayLabel(d, { weekday: "short" })}</span>
                      <span className="num">{d.slice(8)}/{d.slice(5, 7)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calendar.map(({ type, lines }) => (
                  <tr key={type.id} className="border-b border-line">
                    <td className="sticky start-0 z-10 whitespace-nowrap bg-white px-4 py-3 font-medium">{type.name_ar}</td>
                    {days.map((d) => {
                      const l = lines.find((x) => x.date === d);
                      return (
                        <td key={d} title={l?.season ?? undefined} className={cn("px-1 py-3 text-center", l?.season ? "bg-accent1-tint/60 font-semibold text-ink" : "text-slate-700")}>
                          <span className="num">{l ? formatMoney(l.rate, { locale, decimals: 0 }) : "—"}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>المواسم</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>الموسم</TableHead><TableHead>الفترة</TableHead><TableHead>الأسعار</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {seasons.length === 0 && (
                <TableRow><TableCell colSpan={4}><EmptyState icon={CalendarRange} title="لا توجد مواسم"
                  description="مثال: من 1 سبتمبر إلى 30 سبتمبر الليلة 500، ومن 1 أكتوبر الليلة 400." actionHref={canManage ? "/rates?season=new" : undefined} actionLabel="موسم جديد" /></TableCell></TableRow>
              )}
              {seasons.map((s) => (
                <TableRow key={s.id} className={s.is_active ? "" : "opacity-50"}>
                  <TableCell className="cell-fluid font-medium">{s.name}{!s.is_active && <Badge variant="secondary" className="ms-2">موقوف</Badge>}</TableCell>
                  <TableCell className="num whitespace-nowrap">{s.date_from} ← {s.date_to}</TableCell>
                  <TableCell className="text-[14.5px] text-slate-600">
                    {s.prices.map((p) => <span key={p.room_type_id} className="block">{typeName.get(p.room_type_id)}: <span className="num font-semibold text-ink">{formatMoney(p.nightly_rate, { locale })}</span></span>)}
                    {s.adjust_pct && <span className="block">البقية: <span className="num">{Number(s.adjust_pct) > 0 ? "+" : ""}{Number(s.adjust_pct)}%</span></span>}
                  </TableCell>
                  <TableCell className="text-end">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="sm"><Link href={`/rates?season=${s.id}`}>{t.common.edit}</Link></Button>
                        <ActionButton variant="ghost" label="حذف" done="حُذف الموسم" errors={t.errors} confirmText={`حذف ${s.name}؟ الحجوزات القائمة تحتفظ بأسعارها.`} run={deleteSeasonAction.bind(null, s.id)} />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>عروض اللحظة الأخيرة</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>العرض</TableHead><TableHead>الشرط</TableHead><TableHead>الخصم</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {rules.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-slate-500">لا توجد عروض. مثال: خصم 20% لمن يصل غدًا أو اليوم.</TableCell></TableRow>}
                {rules.map((r) => (
                  <TableRow key={r.id} className={r.is_active ? "" : "opacity-50"}>
                    <TableCell className="cell-fluid font-medium">{r.name}<span className="block text-[13.5px] text-slate-500">{r.room_type_id ? typeName.get(r.room_type_id) : "كل الأنواع"}</span></TableCell>
                    <TableCell>{r.days_before === 0 ? "الوصول نفس اليوم" : `الوصول خلال ${r.days_before} ${r.days_before === 1 ? "يوم" : "أيام"}`}</TableCell>
                    <TableCell><Badge variant="info"><span className="num">{Number(r.discount_pct)}%</span></Badge></TableCell>
                    <TableCell className="text-end">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <Button asChild variant="ghost" size="sm"><Link href={`/rates?rule=${r.id}`}>{t.common.edit}</Link></Button>
                          <ActionButton variant="ghost" label="حذف" done="حُذف العرض" errors={t.errors} confirmText={`حذف ${r.name}؟`} run={deleteLastMinuteAction.bind(null, r.id)} />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>الأسعار الأساسية</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>النوع</TableHead><TableHead className="text-end">الليلة / الساعة</TableHead><TableHead className="text-end">نهاية الأسبوع</TableHead><TableHead>حجز زائد</TableHead></TableRow></TableHeader>
              <TableBody>
                {types.filter((x) => x.is_active).map((x) => (
                  <TableRow key={x.id}>
                    <TableCell className="cell-fluid font-medium">{x.name_ar}{x.booking_mode === "hourly" && <Badge variant="info" className="ms-2">بالساعة</Badge>}</TableCell>
                    <TableCell className="text-end font-semibold"><Money value={x.base_rate} locale={locale} /></TableCell>
                    <TableCell className="text-end">{x.weekend_rate ? <Money value={x.weekend_rate} locale={locale} /> : "—"}</TableCell>
                    <TableCell className="num">{x.booking_mode === "nightly" && x.overbooking_limit ? `حتى ${x.overbooking_limit}` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {ctx.can(PERMISSIONS.pmsSetup) && <CardContent className="border-t border-line pt-4"><Link href="/room-setup" className="text-[15.5px] text-action hover:underline">تعديل الأسعار الأساسية من إعداد الغرف</Link></CardContent>}
          </Card>
        </div>
      </div>
    </>
  );
}

import { localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";
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
        actions={canManage && (
          <>
            <Button asChild variant="outline"><Link href="/rates?rule=new"><BadgePercent />{tr("عرض لحظة أخيرة")}</Link></Button>
            <Button asChild><Link href="/rates?season=new"><Plus />{tr("موسم جديد")}</Link></Button>
          </>
        )}
      />
      <StatGrid>
        <Stat icon={Tags} tone="ink" label={tr("أنواع ليلية بأسعار")} value={<span className="num">{nightly.length}</span>} />
        <Stat icon={CalendarRange} tone="teal" label={tr("المواسم الفعّالة")} value={<span className="num">{seasons.filter((s) => s.is_active).length}</span>} hint={activeSeason ? tr("الآن: {0}", activeSeason.name) : tr("لا موسم اليوم")} />
        <Stat icon={BadgePercent} tone="clay" label={tr("عروض اللحظة الأخيرة")} value={<span className="num">{rules.filter((r) => r.is_active).length}</span>} />
        <Stat icon={Sun} tone="neutral" label={tr("ليالي نهاية الأسبوع")} value={ctx.hotel.weekend_nights.map((d) => WEEKDAYS[d]).join(tr(" و"))}
          hint={ctx.can(PERMISSIONS.hotelManage) ? <Link href="/settings/hotel" className="text-action">{tr("تعديل من الإعدادات")}</Link> : undefined} />
      </StatGrid>

      {(editingSeason !== undefined || editingRule !== undefined) && (
        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          {editingSeason !== undefined && (
            <Card>
              <CardHeader><CardTitle>{editingSeason ? tr("تعديل {0}", editingSeason.name) : tr("موسم جديد")}</CardTitle>
                <CardDescription>{tr("موسم فعّال واحد لكل يوم؛ لا تتداخل فترات المواسم الفعّالة.")}</CardDescription></CardHeader>
              <CardContent>
                <SeasonForm key={editingSeason?.id ?? "new"} errors={t.errors}
                  types={nightly.map((x) => ({ id: x.id, label: localNameOf(x), base: formatMoney(x.base_rate, { locale }) }))}
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
              <CardHeader><CardTitle>{editingRule ? tr("تعديل {0}", editingRule.name) : tr("عرض لحظة أخيرة")}</CardTitle>
                <CardDescription>{tr("خصم تلقائي على الحجز الذي يصل خلال عدد أيام من تاريخ الحجز، والصفر يعني نفس اليوم، للأسعار العادية فقط.")}</CardDescription></CardHeader>
              <CardContent>
                <SimpleForm key={editingRule?.id ?? "new"} columns={2} submitLabel={t.common.save} errors={t.errors} action={saveLastMinuteAction} onDone="/rates"
                  initial={{
                    ...(editingRule ? { id: editingRule.id } : {}),
                    name: editingRule?.name ?? tr("عرض الليلة"), room_type_id: editingRule?.room_type_id ?? "",
                    days_before: String(editingRule?.days_before ?? 1), discount_pct: editingRule ? String(Number(editingRule.discount_pct)) : "15",
                    is_active: editingRule?.is_active ?? true,
                  }}
                  fields={[
                    { name: "name", label: tr("اسم العرض") },
                    { name: "room_type_id", label: tr("النوع، اتركه فارغًا لكل الأنواع"), optional: true, options: nightly.map((x) => ({ id: x.id, label: localNameOf(x) })) },
                    { name: "days_before", label: tr("الوصول خلال أيام"), type: "number" },
                    { name: "discount_pct", label: tr("نسبة الخصم %"), type: "number" },
                    { name: "is_active", label: tr("فعّال"), checkbox: true },
                  ]} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Card className="mb-6 overflow-hidden">
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1"><CardTitle>{tr("تقويم الأسعار")}</CardTitle><CardDescription>{tr("السعر الفعلي لكل ليلة بعد المواسم ونهاية الأسبوع.")}</CardDescription></div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm"><Link href={`/rates?start=${addDays(start, -DAYS)}`}>{tr("السابق")}</Link></Button>
            {start !== today && <Button asChild variant="outline" size="sm"><Link href="/rates">{tr("اليوم")}</Link></Button>}
            <Button asChild variant="outline" size="sm"><Link href={`/rates?start=${addDays(start, DAYS)}`}>{tr("التالي")}</Link></Button>
          </div>
        </CardHeader>
        {nightly.length === 0 ? <CardContent><p className="text-slate-500">{tr("لا توجد أنواع غرف ليلية.")}</p></CardContent> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[15px]">
              <thead>
                <tr className="bg-thead text-thead-text">
                  <th className="sticky start-0 z-10 bg-thead px-4 py-3 text-start font-bold">{tr("النوع")}</th>
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
                    <td className="sticky start-0 z-10 whitespace-nowrap bg-white px-4 py-3 font-medium">{localNameOf(type)}</td>
                    {days.map((d) => {
                      const l = lines.find((x) => x.date === d);
                      return (
                        <td key={d} title={l?.season ?? undefined} className={cn("px-1 py-3 text-center", l?.season ? "bg-accent1-tint/60 font-semibold text-ink" : "text-slate-700")}>
                          <span className="num">{l ? formatMoney(l.rate, { locale, decimals: 0 }) : ""}</span>
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
          <CardHeader><CardTitle>{tr("المواسم")}</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>{tr("الموسم")}</TableHead><TableHead>{tr("الفترة")}</TableHead><TableHead>{tr("الأسعار")}</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {seasons.length === 0 && (
                <TableRow><TableCell colSpan={4}><EmptyState icon={CalendarRange} title={tr("لا توجد مواسم")}
                  description={tr("مثال: من 1 سبتمبر إلى 30 سبتمبر الليلة 500، ومن 1 أكتوبر الليلة 400.")} actionHref={canManage ? "/rates?season=new" : undefined} actionLabel={tr("موسم جديد")} /></TableCell></TableRow>
              )}
              {seasons.map((s) => (
                <TableRow key={s.id} className={s.is_active ? "" : "opacity-50"}>
                  <TableCell className="cell-fluid font-medium">{s.name}{!s.is_active && <Badge variant="secondary" className="ms-2">{tr("موقوف")}</Badge>}</TableCell>
                  <TableCell className="whitespace-nowrap">{tr("من")}{" "}<span className="num">{s.date_from}</span>{" "}{tr("إلى")}{" "}<span className="num">{s.date_to}</span></TableCell>
                  <TableCell className="text-[14.5px] text-slate-600">
                    {s.prices.map((p) => <span key={p.room_type_id} className="block">{typeName.get(p.room_type_id)}: <span className="num font-semibold text-ink">{formatMoney(p.nightly_rate, { locale })}</span></span>)}
                    {s.adjust_pct && <span className="block">{tr("البقية:")}{" "}<span className="num">{Number(s.adjust_pct) > 0 ? "+" : ""}{Number(s.adjust_pct)}%</span></span>}
                  </TableCell>
                  <TableCell className="text-end">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="sm"><Link href={`/rates?season=${s.id}`}>{t.common.edit}</Link></Button>
                        <ActionButton variant="ghost" label={tr("حذف")} done={tr("حُذف الموسم")} errors={t.errors} confirmText={tr("حذف {0}؟ الحجوزات القائمة تحتفظ بأسعارها.", s.name)} run={deleteSeasonAction.bind(null, s.id)} />
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
            <CardHeader><CardTitle>{tr("عروض اللحظة الأخيرة")}</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>{tr("العرض")}</TableHead><TableHead>{tr("الشرط")}</TableHead><TableHead>{tr("الخصم")}</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {rules.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-slate-500">{tr("لا توجد عروض. مثال: خصم 20% لمن يصل غدًا أو اليوم.")}</TableCell></TableRow>}
                {rules.map((r) => (
                  <TableRow key={r.id} className={r.is_active ? "" : "opacity-50"}>
                    <TableCell className="cell-fluid font-medium">{r.name}<span className="block text-[13.5px] text-slate-500">{r.room_type_id ? typeName.get(r.room_type_id) : tr("كل الأنواع")}</span></TableCell>
                    <TableCell>{r.days_before === 0 ? tr("الوصول نفس اليوم") : tr("الوصول خلال {0} {1}", r.days_before, r.days_before === 1 ? tr("يوم") : tr("أيام"))}</TableCell>
                    <TableCell><Badge variant="info"><span className="num">{Number(r.discount_pct)}%</span></Badge></TableCell>
                    <TableCell className="text-end">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <Button asChild variant="ghost" size="sm"><Link href={`/rates?rule=${r.id}`}>{t.common.edit}</Link></Button>
                          <ActionButton variant="ghost" label={tr("حذف")} done={tr("حُذف العرض")} errors={t.errors} confirmText={tr("حذف {0}؟", r.name)} run={deleteLastMinuteAction.bind(null, r.id)} />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>{tr("الأسعار الأساسية")}</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>{tr("النوع")}</TableHead><TableHead className="text-end">{tr("الليلة / الساعة")}</TableHead><TableHead className="text-end">{tr("نهاية الأسبوع")}</TableHead><TableHead>{tr("حجز زائد")}</TableHead></TableRow></TableHeader>
              <TableBody>
                {types.filter((x) => x.is_active).map((x) => (
                  <TableRow key={x.id}>
                    <TableCell className="cell-fluid font-medium">{localNameOf(x)}{x.booking_mode === "hourly" && <Badge variant="info" className="ms-2">{tr("بالساعة")}</Badge>}</TableCell>
                    <TableCell className="text-end font-semibold"><Money value={x.base_rate} locale={locale} /></TableCell>
                    <TableCell className="text-end">{x.weekend_rate ? <Money value={x.weekend_rate} locale={locale} /> : ""}</TableCell>
                    <TableCell className="num">{x.booking_mode === "nightly" && x.overbooking_limit ? tr("حتى {0}", x.overbooking_limit) : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {ctx.can(PERMISSIONS.pmsSetup) && <CardContent className="border-t border-line pt-4"><Link href="/room-setup" className="text-[15.5px] text-action">{tr("تعديل الأسعار الأساسية من إعداد الغرف")}</Link></CardContent>}
          </Card>
        </div>
      </div>
    </>
  );
}

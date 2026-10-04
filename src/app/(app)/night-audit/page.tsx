import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { AlertTriangle, BedDouble, CheckCircle2, MoonStar, UserX, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Properties } from "@/components/ui/properties";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/accounting/fiscal";
import { dayLabel } from "@/lib/pms/dates";
import { cn } from "@/lib/utils";
import { listNightAudits, nightAuditStatus } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";
import { RunAuditButton } from "./run-button";

/**
 * تدقيق نهاية اليوم: مراجعة ما ينتظر (ليالٍ لم تُرحَّل، وصول لم يحضر، مغادرون متأخرون، ورديات مفتوحة)
 * ثم التشغيل مرة واحدة لليوم: يرحّل الليالي، ويسجّل عدم الحضور، ويحفظ تقرير المدير.
 */
export default async function NightAuditPage() {
  const ctx = await requireAppContext(PERMISSIONS.pmsReports);
  const { locale, t } = await getI18n();
  const [s, history] = await Promise.all([nightAuditStatus(ctx.supabase, ctx.hotel.id), listNightAudits(ctx.supabase, ctx.hotel.id)]);
  const canRun = ctx.can(PERMISSIONS.pmsNightAudit) && !s.done;
  const pending = s.pending_no_shows.length;

  return (
    <>
      <PageHeader title={tr("تدقيق نهاية اليوم")} />
      <Properties items={[
        [tr("يوم العمل"), dayLabel(s.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })],
        [tr("آخر تدقيق"), s.last_audit && <span className="num">{s.last_audit}</span>],
      ]} />

      <StatGrid>
        <Stat icon={BedDouble} tone="ink" label={tr("الإشغال الليلة")} value={<span className="num">{s.stats.occupancy_pct}%</span>} hint={tr("{0} من {1} غرفة", s.stats.occupied, s.stats.capacity)} />
        <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="teal" label={tr("ليالٍ لم تُرحَّل")} value={<span className="num">{s.unposted_nights}</span>} hint={<Money value={s.unposted_amount} locale={locale} />} />
        <Stat icon={UserX} tone="clay" label={tr("لم يحضروا بعد")} value={<span className="num">{pending}</span>} hint={tr("يُسجَّلون عدم حضور عند التدقيق")} />
        <Stat icon={AlertTriangle} tone="neutral" label={tr("ورديات مفتوحة")} value={<span className="num">{s.open_shifts}</span>} />
      </StatGrid>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {pending > 0 && (
            <Card className="overflow-hidden">
              <CardHeader><CardTitle>{tr("وصول لم يُسكَّن")}</CardTitle><CardDescription>{tr("سكّن من حضر قبل التدقيق؛ البقية تُسجَّل «لم يحضر» ويبقى عربونهم على الفوليو")}</CardDescription></CardHeader>
              <Table>
                <TableHeader><TableRow><TableHead>{tr("النزيل")}</TableHead><TableHead>{tr("الحجز")}</TableHead><TableHead>{tr("الوصول")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {s.pending_no_shows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="cell-fluid font-medium">{r.guest}</TableCell>
                      <TableCell><Link href={`/reservations/${r.id}`} className="num text-action">{r.confirmation_number}</Link></TableCell>
                      <TableCell className="num">{r.arrival_date}{r.arrival_date < s.date && <Badge variant="destructive" className="ms-2">{tr("متأخر")}</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          {s.overstays.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader><CardTitle>{tr("مغادرة مستحقة لم تُسجَّل")}</CardTitle><CardDescription>{tr("سجّل مغادرتهم أو مدّد إقامتهم")}</CardDescription></CardHeader>
              <Table>
                <TableBody>
                  {s.overstays.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="cell-fluid font-medium">{r.guest}</TableCell>
                      <TableCell><Link href={`/reservations/${r.id}`} className="num text-action">{r.confirmation_number}</Link></TableCell>
                      <TableCell className="num">{r.departure_date}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>{tr("سجل التدقيق")}</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>{tr("اليوم")}</TableHead><TableHead className="text-end">{tr("الإشغال")}</TableHead><TableHead className="text-end">{tr("إيراد الغرف")}</TableHead><TableHead className="text-end">{tr("متوسط السعر")}</TableHead><TableHead>{tr("التشغيل")}</TableHead></TableRow></TableHeader>
              <TableBody>
                {history.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">{tr("لم يُشغَّل التدقيق بعد")}</TableCell></TableRow>}
                {history.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell><Link href={`/night-audit/${a.business_date}`} className="num font-semibold text-action">{a.business_date}</Link></TableCell>
                    <TableCell className="num text-end">{a.summary.occupancy_pct}%</TableCell>
                    <TableCell className="text-end"><Money value={a.summary.room_revenue} locale={locale} /></TableCell>
                    <TableCell className="text-end"><Money value={a.summary.adr} locale={locale} /></TableCell>
                    <TableCell className="num whitespace-nowrap text-slate-500">{formatDateTime(a.run_at, ctx.hotel.timezone)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        <Card className={cn("h-fit xl:sticky xl:top-0", s.done ? "border-success/40" : "border-ink/20")}>
          <CardHeader>
            <CardTitle>{s.done ? <><CheckCircle2 className="size-5 text-success" />{tr("دُقّق اليوم")}</> : <><MoonStar className="size-5" />{tr("جاهز للتدقيق")}</>}</CardTitle>
            <CardDescription>
              {s.done ? tr("يمكن مراجعة تقرير المدير وكشف النزلاء لهذا اليوم.") : tr("يُشغَّل مرة واحدة في آخر اليوم، ولا يُتراجع عنه.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2 text-[15.5px] text-slate-700">
              <li>{tr("ترحيل")}{" "}{s.unposted_nights}{" "}{tr("ليلة على فوليوهات المقيمين")}</li>
              <li>{tr("تسجيل")}{" "}{pending}{" "}{tr("حجز لم يحضر أصحابه")}</li>
              <li>{tr("حفظ تقرير المدير بالإشغال ومتوسط السعر والعائد لكل غرفة والإيرادات والمقبوضات")}</li>
            </ul>
            {s.open_shifts > 0 && !s.done && <p className="rounded-md bg-amber-tint px-3 py-2 text-[14.5px] text-amber">{tr("توجد")}{" "}{s.open_shifts}{" "}{tr("وردية كاشير مفتوحة، ويُفضَّل إغلاقها قبل التدقيق.")}</p>}
            {canRun && <RunAuditButton date={s.date} errors={t.errors} confirmText={tr("تشغيل تدقيق يوم {0}؟ سيُرحّل {1} ليلة ويُسجّل {2} عدم حضور.", dayLabel(s.date), s.unposted_nights, pending)} />}
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/night-audit/${s.date}`} className="rounded-md border border-line px-3 py-2 text-center text-[15px] font-medium text-ink hover:bg-panel">{tr("تقرير المدير")}</Link>
              <Link href={`/guest-register?date=${s.date}`} className="rounded-md border border-line px-3 py-2 text-center text-[15px] font-medium text-ink hover:bg-panel">{tr("كشف النزلاء")}</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

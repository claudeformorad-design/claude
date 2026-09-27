import Link from "@/components/link";
import { AlertTriangle, BedDouble, CheckCircle2, MoonStar, UserX, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
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
      <PageHeader title="تدقيق نهاية اليوم" description={`يوم العمل ${dayLabel(s.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${s.last_audit ? `، آخر تدقيق ${s.last_audit}` : ""}`} />

      <StatGrid>
        <Stat icon={BedDouble} tone="ink" label="الإشغال الليلة" value={<span className="num">{s.stats.occupancy_pct}%</span>} hint={`${s.stats.occupied} من ${s.stats.capacity} غرفة`} />
        <Stat icon={Wallet} tone="teal" label="ليالٍ لم تُرحَّل" value={<span className="num">{s.unposted_nights}</span>} hint={<Money value={s.unposted_amount} locale={locale} />} />
        <Stat icon={UserX} tone="clay" label="لم يحضروا بعد" value={<span className="num">{pending}</span>} hint="يُسجَّلون عدم حضور عند التدقيق" />
        <Stat icon={AlertTriangle} tone="neutral" label="ورديات مفتوحة" value={<span className="num">{s.open_shifts}</span>} />
      </StatGrid>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {pending > 0 && (
            <Card className="overflow-hidden">
              <CardHeader><CardTitle>وصول لم يُسكَّن</CardTitle><CardDescription>سكّن من حضر قبل التدقيق؛ البقية تُسجَّل «لم يحضر» ويبقى عربونهم على الفوليو</CardDescription></CardHeader>
              <Table>
                <TableHeader><TableRow><TableHead>النزيل</TableHead><TableHead>الحجز</TableHead><TableHead>الوصول</TableHead></TableRow></TableHeader>
                <TableBody>
                  {s.pending_no_shows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="cell-fluid font-medium">{r.guest}</TableCell>
                      <TableCell><Link href={`/reservations/${r.id}`} className="num text-action">{r.confirmation_number}</Link></TableCell>
                      <TableCell className="num">{r.arrival_date}{r.arrival_date < s.date && <Badge variant="destructive" className="ms-2">متأخر</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          {s.overstays.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader><CardTitle>مغادرة مستحقة لم تُسجَّل</CardTitle><CardDescription>سجّل مغادرتهم أو مدّد إقامتهم</CardDescription></CardHeader>
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
            <CardHeader><CardTitle>سجل التدقيق</CardTitle></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>اليوم</TableHead><TableHead className="text-end">الإشغال</TableHead><TableHead className="text-end">إيراد الغرف</TableHead><TableHead className="text-end">متوسط السعر</TableHead><TableHead>التشغيل</TableHead></TableRow></TableHeader>
              <TableBody>
                {history.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">لم يُشغَّل التدقيق بعد</TableCell></TableRow>}
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
            <CardTitle>{s.done ? <><CheckCircle2 className="size-5 text-success" />دُقّق اليوم</> : <><MoonStar className="size-5" />جاهز للتدقيق</>}</CardTitle>
            <CardDescription>
              {s.done ? "يمكن مراجعة تقرير المدير وكشف النزلاء لهذا اليوم." : "يُشغَّل مرة واحدة في آخر اليوم، ولا يُتراجع عنه."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2 text-[15.5px] text-slate-700">
              <li>ترحيل {s.unposted_nights} ليلة على فوليوهات المقيمين</li>
              <li>تسجيل {pending} حجز لم يحضر أصحابه</li>
              <li>حفظ تقرير المدير بالإشغال ومتوسط السعر والعائد لكل غرفة والإيرادات والمقبوضات</li>
            </ul>
            {s.open_shifts > 0 && !s.done && <p className="rounded-md bg-amber-tint px-3 py-2 text-[14.5px] text-amber">توجد {s.open_shifts} وردية كاشير مفتوحة، ويُفضَّل إغلاقها قبل التدقيق.</p>}
            {canRun && <RunAuditButton date={s.date} errors={t.errors} confirmText={`تشغيل تدقيق يوم ${s.date}؟ سيُرحّل ${s.unposted_nights} ليلة ويُسجّل ${pending} عدم حضور.`} />}
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/night-audit/${s.date}`} className="rounded-md border border-line px-3 py-2 text-center text-[15px] font-medium text-ink hover:bg-panel">تقرير المدير</Link>
              <Link href={`/guest-register?date=${s.date}`} className="rounded-md border border-line px-3 py-2 text-center text-[15px] font-medium text-ink hover:bg-panel">كشف النزلاء</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

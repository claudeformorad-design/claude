import { notFound } from "next/navigation";
import Link from "@/components/link";
import { BedDouble, CalendarCheck, Coins, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Properties } from "@/components/ui/properties";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/accounting/fiscal";
import { dayLabel } from "@/lib/pms/dates";
import type { AuditSummary, DayStats } from "@/lib/supabase/database.types";
import { listNightAudits, nightAuditStatus } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";
import { PrintButton } from "../../invoices/[id]/print-button";

/**
 * تقرير المدير اليومي: من لقطة التدقيق المحفوظة إن وُجدت (أرقام ثابتة كما كانت ليلتها)،
 * وإلا أرقام اليوم الحية قبل التدقيق.
 */
export default async function ManagerReportPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const ctx = await requireAppContext(PERMISSIONS.pmsReports);
  const { locale, t } = await getI18n();
  const audits = await listNightAudits(ctx.supabase, ctx.hotel.id);
  const audit = audits.find((a) => a.business_date === date);
  const live = audit ? null : await nightAuditStatus(ctx.supabase, ctx.hotel.id, date);
  const s: DayStats & Partial<AuditSummary> = audit ? audit.summary : live!.stats;
  const cats = t.revenueSettings.categories as Record<string, string>;
  const revenueTotal = s.revenue_by_category.reduce((a, x) => a + Number(x.net), 0);
  const taxTotal = s.revenue_by_category.reduce((a, x) => a + Number(x.tax), 0);
  const collected = s.collections.reduce((a, x) => a + Number(x.amount), 0);
  const i = audits.findIndex((a) => a.business_date === date);
  const prev = audits[i + 1]?.business_date, next = i > 0 ? audits[i - 1]?.business_date : undefined;

  return (
    <>
      <PageHeader
        title="تقرير المدير اليومي"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {audit ? <Badge variant="success" className="text-[15px]">مدقق {formatDateTime(audit.run_at, ctx.hotel.timezone)}</Badge> : <Badge variant="warning" className="text-[15px]">أرقام حية قبل التدقيق</Badge>}
            {prev && <Button asChild variant="outline" size="sm" className="print:hidden"><Link href={`/night-audit/${prev}`}>اليوم السابق</Link></Button>}
            {next && <Button asChild variant="outline" size="sm" className="print:hidden"><Link href={`/night-audit/${next}`}>اليوم التالي</Link></Button>}
            <PrintButton label="طباعة" />
          </div>
        }
      />

      <Properties items={[
        ["الفندق", ctx.hotel.name_ar],
        ["يوم العمل", dayLabel(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })],
      ]} />
      <StatGrid>
        <Stat icon={BedDouble} tone="ink" label="الإشغال" value={<span className="num">{s.occupancy_pct}%</span>} hint={`${s.occupied} مشغولة، ${s.vacant} شاغرة، ${s.out_of_service} خارج الخدمة`} />
        <Stat currency={ctx.hotel.base_currency} icon={Coins} tone="teal" label="متوسط سعر الغرفة" value={<Money value={s.adr} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={TrendingUp} tone="clay" label="العائد لكل غرفة متاحة" value={<Money value={s.revpar} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={CalendarCheck} tone="neutral" label="إيراد الغرف" value={<Money value={s.room_revenue} locale={locale} />} hint={`${s.guests} نزيل مقيم`} />
      </StatGrid>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>الإيرادات حسب الفئة</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>الفئة</TableHead><TableHead className="text-end">الصافي</TableHead><TableHead className="text-end">الضريبة</TableHead></TableRow></TableHeader>
            <TableBody>
              {s.revenue_by_category.length === 0 && <TableRow><TableCell colSpan={3} className="py-8 text-center text-slate-500">لا إيرادات مرحّلة لهذا اليوم</TableCell></TableRow>}
              {s.revenue_by_category.map((x) => (
                <TableRow key={x.category}>
                  <TableCell>{cats[x.category] ?? x.category}</TableCell>
                  <TableCell className="text-end"><Money value={x.net} locale={locale} /></TableCell>
                  <TableCell className="text-end"><Money value={x.tax} locale={locale} blankZero /></TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter><TableRow><TableCell>الإجمالي</TableCell><TableCell className="text-end"><Money value={revenueTotal} locale={locale} /></TableCell><TableCell className="text-end"><Money value={taxTotal} locale={locale} blankZero /></TableCell></TableRow></TableFooter>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader><CardTitle>المقبوضات حسب طريقة الدفع</CardTitle></CardHeader>
          <Table>
            <TableBody>
              {s.collections.length === 0 && <TableRow><TableCell colSpan={2} className="py-8 text-center text-slate-500">لا مقبوضات لهذا اليوم</TableCell></TableRow>}
              {s.collections.map((x) => (
                <TableRow key={x.method}><TableCell>{x.method}</TableCell><TableCell className="text-end"><Money value={x.amount} locale={locale} /></TableCell></TableRow>
              ))}
            </TableBody>
            <TableFooter><TableRow><TableCell>الصافي</TableCell><TableCell className="text-end"><Money value={collected} locale={locale} /></TableCell></TableRow></TableFooter>
          </Table>
        </Card>

        <Card>
          <CardHeader><CardTitle>حركة اليوم</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-3 text-center">
              {[
                ["وصول", s.arrivals], ["مغادرة", s.departures], ["حجوزات جديدة", s.new_bookings],
                ["عدم حضور", s.no_shows], ["إلغاء", s.cancellations], ["جلسات بالساعة", s.hourly_sessions],
              ].map(([label, v]) => (
                <div key={label as string} className="rounded-lg bg-panel p-3"><dt className="text-[14px] text-slate-500">{label}</dt><dd className="num text-[22px] font-bold text-ink">{v}</dd></div>
              ))}
            </dl>
            {audit && <p className="mt-4 text-[15px] text-slate-600">رحّل التدقيق <b className="num">{s.nights_posted}</b> ليلة، وسجّل <b className="num">{s.no_shows_marked}</b> عدم حضور.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>الأرصدة والتوقعات</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-panel p-3"><p className="text-[14px] text-slate-500">أرصدة الفوليوهات المفتوحة</p><Money value={s.guest_ledger} locale={locale} className="text-[20px] font-bold text-ink" /></div>
              <div className="rounded-lg bg-panel p-3"><p className="text-[14px] text-slate-500">عربون محتفظ به</p><Money value={s.deposits_held} locale={locale} className="text-[20px] font-bold text-success" /></div>
            </div>
            <div>
              <p className="mb-2 text-[15px] font-medium text-ink">الغرف المباعة للأيام السبعة القادمة</p>
              <div className="flex h-28 items-end gap-2">
                {s.forecast.map((f) => {
                  const pct = s.capacity ? Math.min(100, Math.round((f.sold / s.capacity) * 100)) : 0;
                  return (
                    <div key={f.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${f.sold} من ${s.capacity}`}>
                      <span className="num text-[12.5px] font-semibold text-ink">{pct}%</span>
                      <div className="relative w-full flex-1 overflow-hidden rounded bg-subtle"><div className="absolute inset-x-0 bottom-0 rounded bg-action/70" style={{ height: `${pct}%` }} /></div>
                      <span className="text-[12px] text-slate-500">{dayLabel(f.date, { weekday: "short" })}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

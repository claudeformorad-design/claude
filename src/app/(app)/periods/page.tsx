import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getI18n } from "@/i18n/server";
import { PeriodButton } from "./periods-client";
import { CalendarCheck, Lock, LockOpen } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";

export default async function PeriodsPage() {
  const ctx = await requireAppContext(PERMISSIONS.periodsView);
  const { t } = await getI18n();
  const [years, periods] = await Promise.all([
    ctx.supabase.from("fiscal_years").select("*").eq("hotel_id", ctx.hotel.id).order("start_date", { ascending: false }),
    ctx.supabase.from("accounting_periods").select("*").eq("hotel_id", ctx.hotel.id).order("start_date"),
  ]);
  const can = ctx.can(PERMISSIONS.periodsManage);
  const a = t.admin;
  const errs = t.errors as unknown as Record<string, string>;
  const latest = years.data?.[0];
  const nextStart = latest ? new Date(Date.parse(`${latest.end_date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : undefined;
  return (
    <>
      <PageHeader title={t.nav.periods} description={a.periodsSubtitle}
        actions={can && latest && nextStart && <PeriodButton op="newYear" id={latest.id} startDate={nextStart} label={`${a.newYear} (${nextStart})`} errorLabels={errs} />} />
      <StatGrid className="lg:grid-cols-3">
        <Stat icon={CalendarCheck} tone="ink" label="سنوات مالية" value={<span className="num">{(years.data ?? []).length}</span>} hint={`${(years.data ?? []).filter((y) => y.status === "open").length} مفتوحة`} />
        <Stat icon={LockOpen} tone="teal" label="فترات مفتوحة للترحيل" value={<span className="num">{(periods.data ?? []).filter((p) => p.status === "open").length}</span>} />
        <Stat icon={Lock} tone="clay" label="فترات مقفلة" value={<span className="num">{(periods.data ?? []).filter((p) => p.status !== "open").length}</span>} />
      </StatGrid>
      <div className="space-y-6">
        {(years.data ?? []).map((y) => (
          <Card key={y.id} className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{a.fiscalYear} {y.name} <span className="num text-[15px] font-normal text-slate-500">{y.start_date} → {y.end_date}</span></CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={y.status === "open" ? "success" : "secondary"}>{y.status === "open" ? t.folio.statuses.open : t.folio.statuses.closed}</Badge>
                {can && y.status === "open" && <PeriodButton op="closeYear" id={y.id} label={a.closeYear} confirmText={a.closeYearConfirm} variant="destructive" errorLabels={errs} />}
              </div>
            </CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>{t.journal.period}</TableHead><TableHead>{t.common.from}</TableHead><TableHead>{t.common.to}</TableHead><TableHead>{t.common.status}</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {(periods.data ?? []).filter((p) => p.fiscal_year_id === y.id).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="num font-semibold">{p.name}</TableCell><TableCell className="num">{p.start_date}</TableCell><TableCell className="num">{p.end_date}</TableCell>
                    <TableCell><Badge variant={p.status === "open" ? "success" : "secondary"}>{p.status === "open" ? t.folio.statuses.open : t.folio.statuses.closed}</Badge></TableCell>
                    <TableCell className="text-end">
                      {can && y.status === "open" && (p.status === "open"
                        ? <PeriodButton op="close" id={p.id} label={a.closePeriod} errorLabels={errs} />
                        : <PeriodButton op="open" id={p.id} label={a.reopenPeriod} variant="ghost" errorLabels={errs} />)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ))}
      </div>
    </>
  );
}

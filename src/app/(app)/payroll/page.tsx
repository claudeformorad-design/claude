import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listPayrollRuns } from "@/services/payables.service";
import { getI18n } from "@/i18n/server";
import { Banknote, UserCog, Wallet } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";

export default async function PayrollPage() {
  const ctx = await requireAppContext(PERMISSIONS.payrollManage);
  const { locale, t } = await getI18n();
  const runs = await listPayrollRuns(ctx.supabase, ctx.hotel.id);
  return (
    <>
      <PageHeader title={t.nav.payroll}
        actions={
          <div className="flex gap-2">
            {ctx.can(PERMISSIONS.hrView) && <Button asChild variant="outline"><Link href="/hr/payroll">مسيّر الموظفين</Link></Button>}
            <Button asChild><Link href="/payroll/new"><Plus />{t.payables.newPayroll}</Link></Button>
          </div>
        } />
      <StatGrid className="lg:grid-cols-3">
        <Stat icon={UserCog} tone="ink" label="مسيّرات مرحّلة" value={<span className="num">{runs.length}</span>} hint={runs[0] ? `آخرها ${runs[0].period_month.slice(0, 7)}` : undefined} />
        <Stat currency={ctx.hotel.base_currency} icon={Banknote} tone="teal" label="إجمالي آخر مسيّر" value={runs[0] ? <Money value={runs[0].total_gross} locale={locale} /> : ""} />
        <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="clay" label="صافي آخر مسيّر" value={runs[0] ? <Money value={runs[0].total_net} locale={locale} /> : ""} />
      </StatGrid>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>#</TableHead><TableHead>{t.payables.month}</TableHead><TableHead>{t.common.date}</TableHead>
            <TableHead className="text-end">{t.payables.gross}</TableHead><TableHead className="text-end">{t.payables.net}</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {runs.length === 0 && <TableRow><TableCell colSpan={6} className="py-8"><EmptyState title="لم يُرحَّل أي مسيّر رواتب" description="رحّل مسيّر الشهر ليُسجَّل مصروف الرواتب والتأمينات والمستحقات تلقائيًا." actionHref="/payroll/new" actionLabel="مسيّر جديد" icon={UserCog} /></TableCell></TableRow>}
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="num">{r.run_number}</TableCell><TableCell className="num">{r.period_month.slice(0, 7)}</TableCell>
                <TableCell className="num">{r.posting_date}</TableCell>
                <TableCell className="text-end"><Money value={r.total_gross} locale={locale} /></TableCell>
                <TableCell className="text-end font-semibold"><Money value={r.total_net} locale={locale} /></TableCell>
                <TableCell className="text-end">{r.journal_entry_id && <Link className="text-[15.5px] font-medium text-accent1" href={`/journal/${r.journal_entry_id}`}>{t.journal.entry}</Link>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

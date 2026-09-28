import { Gavel, HandCoins, Wallet } from "lucide-react";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { EntityCell } from "@/components/ui/entity";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { toMoney, ZERO } from "@/lib/accounting/money";
import { PENALTY_STATUS } from "@/lib/hr/labels";
import { listAdvances, listEmployees, listPenalties } from "@/services/hr.service";
import { listPaymentMethods } from "@/services/revenue-settings.service";
import { getI18n } from "@/i18n/server";
import { ActionButton } from "../../_pms/action-button";
import { SimpleForm } from "../../_assets/simple-form";
import { decidePenaltyAction, payAdvanceAction, savePenaltyAction } from "../actions";
import { advanceFields, penaltyFields } from "../forms";

/** السلف (تُصرف بقيد وتُستعاد أقساطًا من المسيّر) والجزاءات (تُعتمد ثم تُخصم في أول مسيّر) */
export default async function AdvancesPage() {
  const ctx = await requireAppContext(PERMISSIONS.hrView);
  const { locale, t } = await getI18n();
  const today = todayInTimeZone(ctx.hotel.timezone);
  const [advances, penalties, employees, methods] = await Promise.all([
    listAdvances(ctx.supabase, ctx.hotel.id), listPenalties(ctx.supabase, ctx.hotel.id),
    listEmployees(ctx.supabase, ctx.hotel.id), listPaymentMethods(ctx.supabase, ctx.hotel.id),
  ]);
  const canManage = ctx.can(PERMISSIONS.hrManage) && employees.length > 0;
  const who = employees.map((e) => ({ id: e.id, label: `${e.code} ${e.full_name}` }));
  const baseMethods = methods.filter((m) => m.is_active && (!m.currency_code || m.currency_code === ctx.hotel.base_currency)).map((m) => ({ id: m.id, label: m.name_ar }));
  const open = advances.filter((a) => a.status === "open");
  const outstanding = open.reduce((s, a) => s.plus(toMoney(a.amount).minus(toMoney(a.recovered))), ZERO);
  const pendingPenalties = penalties.filter((p) => p.status === "pending");

  return (
    <>
      <PageHeader title={t.nav.advances} actions={canManage && (
        <div className="flex gap-2">
          <FormDialog label="جزاء" title="جزاء جديد" variant="outline">
            <SimpleForm columns={2} submitLabel="حفظ الجزاء" errors={t.errors} action={savePenaltyAction}
              initial={{ employee_id: employees[0]!.id, penalty_date: today, amount: "", reason: "", approve: false }} fields={penaltyFields(who)} />
          </FormDialog>
          <FormDialog label="صرف سلفة" title="صرف سلفة">
            <SimpleForm columns={2} submitLabel="صرف السلفة" errors={t.errors} action={payAdvanceAction}
              initial={{ employee_id: employees[0]!.id, advance_date: today, amount: "", installments: "3", payment_method_id: baseMethods[0]?.id ?? "", notes: "" }}
              fields={advanceFields(baseMethods, who)} />
          </FormDialog>
        </div>
      )} />

      <StatGrid className="lg:grid-cols-3">
        <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="ink" label="السلف المتبقية على الموظفين" value={<Money value={outstanding} locale={locale} />} />
        <Stat icon={HandCoins} tone="teal" label="سلف قائمة" value={<span className="num">{open.length}</span>} />
        <Stat icon={Gavel} tone="clay" label="جزاءات بانتظار الاعتماد" value={<span className="num">{pendingPenalties.length}</span>} />
      </StatGrid>

      <div className="grid items-start gap-6">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>السلف</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow>
              <TableHead>الرقم</TableHead><TableHead>الموظف</TableHead><TableHead>التاريخ</TableHead><TableHead className="text-end">المبلغ</TableHead>
              <TableHead className="text-end">القسط</TableHead><TableHead className="text-end">المتبقي</TableHead><TableHead className="text-end">الحالة</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {advances.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-500">لا سلف مصروفة</TableCell></TableRow>}
              {advances.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.journal_entry_id ? <Link href={`/journal/${a.journal_entry_id}`} className="num text-action">{a.advance_number}</Link> : <span className="num">{a.advance_number}</span>}</TableCell>
                  <TableCell className="cell-fluid"><EntityCell name={a.employee?.full_name ?? ""} href={`/hr/${a.employee_id}`} /></TableCell>
                  <TableCell className="num">{a.advance_date}</TableCell>
                  <TableCell className="text-end"><Money value={a.amount} locale={locale} /></TableCell>
                  <TableCell className="text-end"><Money value={a.installment_amount} locale={locale} /></TableCell>
                  <TableCell className="text-end font-semibold"><Money value={toMoney(a.amount).minus(toMoney(a.recovered))} locale={locale} blankZero /></TableCell>
                  <TableCell className="text-end"><Badge variant={a.status === "open" ? "warning" : "success"}>{a.status === "open" ? "قائمة" : "مسددة"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader><CardTitle>الجزاءات</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow>
              <TableHead>الموظف</TableHead><TableHead>التاريخ</TableHead><TableHead>السبب</TableHead><TableHead className="text-end">المبلغ</TableHead><TableHead className="text-end">الحالة</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {penalties.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-500">لا جزاءات</TableCell></TableRow>}
              {penalties.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap"><EntityCell name={p.employee?.full_name ?? ""} href={`/hr/${p.employee_id}`} /></TableCell>
                  <TableCell className="num">{p.penalty_date}</TableCell>
                  <TableCell className="cell-fluid text-slate-600">{p.reason}</TableCell>
                  <TableCell className="text-end"><Money value={p.amount} locale={locale} /></TableCell>
                  <TableCell className="text-end">
                    {ctx.can(PERMISSIONS.hrManage) && p.status === "pending" ? (
                      <span className="inline-flex gap-1.5">
                        <ActionButton label="اعتماد" done="اعتُمد الجزاء" errors={t.errors} run={decidePenaltyAction.bind(null, p.id, "approved")} />
                        <ActionButton label="إلغاء" done="أُلغي الجزاء" variant="ghost" errors={t.errors} run={decidePenaltyAction.bind(null, p.id, "cancelled")} />
                      </span>
                    ) : <Badge variant={PENALTY_STATUS[p.status]!.tone}>{p.payroll_run_id ? "خُصم في المسيّر" : PENALTY_STATUS[p.status]!.label}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}

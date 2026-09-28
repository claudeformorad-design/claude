import { notFound } from "next/navigation";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { Properties } from "@/components/ui/properties";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { toMoney, ZERO } from "@/lib/accounting/money";
import { CONTRACT_TYPES, END_REASONS, LEAVE_STATUS, PENALTY_STATUS } from "@/lib/hr/labels";
import { listDepartments } from "@/services/accounts.service";
import { getEmployee, listLeaveTypes, listShifts } from "@/services/hr.service";
import { listPaymentMethods } from "@/services/revenue-settings.service";
import { getI18n } from "@/i18n/server";
import { ActionButton } from "../../_pms/action-button";
import { SimpleForm } from "../../_assets/simple-form";
import { decideLeaveAction, decidePenaltyAction, payAdvanceAction, saveEmployeeAction, saveLeaveAction, savePenaltyAction } from "../actions";
import { advanceFields, employeeFields, employeeInitial, leaveFields, penaltyFields } from "../forms";
import { SalaryEditor } from "./salary-editor";
import { TerminateForm } from "./terminate-form";

/** ملف الموظف: بياناته وعقده، وبنود راتبه، وأرصدة إجازاته، وسلفه وجزاءاته، والتسوية النهائية */
export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.hrView);
  const { locale, t } = await getI18n();
  const d = await getEmployee(ctx.supabase, ctx.hotel.id, id);
  if (!d) notFound();
  const { employee: e } = d;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const canManage = ctx.can(PERMISSIONS.hrManage) && e.status === "active";
  const [departments, shifts, types, methods] = await Promise.all([
    listDepartments(ctx.supabase, ctx.hotel.id), listShifts(ctx.supabase, ctx.hotel.id),
    listLeaveTypes(ctx.supabase, ctx.hotel.id), listPaymentMethods(ctx.supabase, ctx.hotel.id),
  ]);
  const monthly = (c: (typeof d.components)[number]) => {
    const v = toMoney(c.override ?? c.default_value);
    return c.calc === "percent" ? toMoney(e.basic_salary).times(v).div(100) : v;
  };
  const allowances = d.components.filter((c) => c.kind === "allowance");
  const deductions = d.components.filter((c) => c.kind === "deduction");
  const gross = allowances.reduce((a, c) => a.plus(monthly(c)), toMoney(e.basic_salary));
  const openAdvances = d.advances.filter((a) => a.status === "open").reduce((s, a) => s.plus(toMoney(a.amount).minus(toMoney(a.recovered))), ZERO);
  const baseMethods = methods.filter((m) => m.is_active && (!m.currency_code || m.currency_code === ctx.hotel.base_currency))
    .map((m) => ({ id: m.id, label: m.name_ar }));
  const typeOptions = types.filter((x) => x.is_active).map((x) => ({ id: x.id, label: x.name }));

  return (
    <>
      <PageHeader title={e.full_name} actions={
        <div className="flex flex-wrap items-center gap-2">
          {e.status === "terminated" && <Badge variant="secondary">انتهت خدمته</Badge>}
          {canManage && (
            <>
              <FormDialog label="تعديل البيانات" title={`تعديل ${e.full_name}`} variant="outline" icon={false} width="lg">
                <SimpleForm columns={2} submitLabel="حفظ" errors={t.errors} action={saveEmployeeAction} initial={employeeInitial(e)}
                  fields={employeeFields(departments.filter((x) => x.is_active).map((x) => ({ id: x.id, label: `${x.code} ${x.name_ar}` })),
                    shifts.filter((s) => s.is_active).map((s) => ({ id: s.id, label: s.name })))} />
              </FormDialog>
              <FormDialog label="إجازة" title={`إجازة ${e.full_name}`} variant="outline" icon={false}>
                <SimpleForm columns={2} submitLabel="حفظ الإجازة" errors={t.errors} action={saveLeaveAction}
                  initial={{ employee_id: e.id, leave_type_id: typeOptions[0]?.id ?? "", start_date: today, end_date: today, reason: "", approve: true }}
                  fields={leaveFields(typeOptions)} />
              </FormDialog>
              <FormDialog label="سلفة" title={`سلفة ${e.full_name}`} variant="outline" icon={false}>
                <SimpleForm columns={2} submitLabel="صرف السلفة" errors={t.errors} action={payAdvanceAction}
                  initial={{ employee_id: e.id, advance_date: today, amount: "", installments: "3", payment_method_id: baseMethods[0]?.id ?? "", notes: "" }}
                  fields={advanceFields(baseMethods)} />
              </FormDialog>
              <FormDialog label="جزاء" title={`جزاء على ${e.full_name}`} variant="outline" icon={false}>
                <SimpleForm columns={2} submitLabel="حفظ الجزاء" errors={t.errors} action={savePenaltyAction}
                  initial={{ employee_id: e.id, penalty_date: today, amount: "", reason: "", approve: false }} fields={penaltyFields()} />
              </FormDialog>
              <FormDialog label="إنهاء الخدمة" title={`إنهاء خدمة ${e.full_name}`} variant="destructive" icon={false} width="lg">
                <TerminateForm employeeId={e.id} today={today} errors={t.errors} />
              </FormDialog>
            </>
          )}
        </div>
      } />

      <Properties items={[
        ["الرمز", <span key="c" className="num">{e.code}</span>],
        ["المسمى الوظيفي", e.job_title],
        ["القسم", e.department?.name_ar],
        ["الوردية", e.shift?.name ?? "بلا وردية"],
        ["تاريخ التعيين", <span key="h" className="num">{e.hire_date}</span>],
        ["العقد", <>{CONTRACT_TYPES[e.contract_type]}{e.contract_end && <> حتى <span className="num">{e.contract_end}</span></>}</>],
        ["الجوال", e.phone && <span className="num" dir="ltr">{e.phone}</span>],
        ["الجنسية", e.nationality],
        ["الهوية", e.id_number && <><span className="num">{e.id_number}</span>{e.id_expiry && <> تنتهي <span className="num">{e.id_expiry}</span></>}</>],
        ["نهاية الخدمة", e.termination_date && <>{END_REASONS[e.termination_reason ?? ""]} <span className="num">{e.termination_date}</span></>],
      ]} />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>الراتب الشهري</CardTitle>
            {canManage && d.components.length > 0 && (
              <FormDialog label="بنود الراتب" title="بنود راتب الموظف" variant="ghost" size="sm" icon={false}>
                <SalaryEditor employeeId={e.id} errors={t.errors} rows={d.components} />
              </FormDialog>
            )}
          </CardHeader>
          <Table>
            <TableBody>
              <TableRow><TableCell className="font-medium">الراتب الأساسي</TableCell><TableCell className="text-end"><Money value={e.basic_salary} locale={locale} /></TableCell></TableRow>
              {allowances.filter((c) => !monthly(c).isZero()).map((c) => (
                <TableRow key={c.id}><TableCell>{c.name}{c.calc === "percent" && <span className="text-slate-500"> <span className="num">{Number(c.override ?? c.default_value)}</span>٪</span>}</TableCell>
                  <TableCell className="text-end"><Money value={monthly(c)} locale={locale} /></TableCell></TableRow>
              ))}
              {deductions.filter((c) => !monthly(c).isZero()).map((c) => (
                <TableRow key={c.id}><TableCell>{c.name}</TableCell><TableCell className="text-end text-urgent"><Money value={monthly(c).negated()} locale={locale} /></TableCell></TableRow>
              ))}
              <TableRow className="bg-panel font-semibold hover:bg-panel"><TableCell>إجمالي المستحق الشهري</TableCell><TableCell className="text-end"><Money value={gross} locale={locale} /></TableCell></TableRow>
            </TableBody>
          </Table>
        </Card>

        {e.status === "active" && <Card className="overflow-hidden">
          <CardHeader><CardTitle>أرصدة الإجازات لهذا العام</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>النوع</TableHead><TableHead className="text-end">الاستحقاق</TableHead><TableHead className="text-end">المرحّل</TableHead><TableHead className="text-end">المأخوذ</TableHead><TableHead className="text-end">المتبقي</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.balances.map((b) => (
                <TableRow key={b.leave_type_id}>
                  <TableCell>{b.name}{!b.paid && !b.name.includes("بدون راتب") && <span className="text-slate-500"> بدون راتب</span>}</TableCell>
                  {b.limited ? (
                    <>
                      <TableCell className="num text-end">{Number(b.entitlement)}</TableCell>
                      <TableCell className="num text-end">{Number(b.carried) || ""}</TableCell>
                      <TableCell className="num text-end">{Number(b.taken) || ""}</TableCell>
                      <TableCell className="num text-end font-semibold text-ink">{Number(b.remaining)}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell colSpan={2} className="text-end text-slate-500">بلا رصيد محدد</TableCell>
                      <TableCell className="num text-end">{Number(b.taken) || ""}</TableCell>
                      <TableCell />
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>}

        <Card className="overflow-hidden">
          <CardHeader><CardTitle>الإجازات</CardTitle></CardHeader>
          <Table>
            <TableBody>
              {d.leaves.length === 0 && <TableRow><TableCell className="py-6 text-center text-slate-500">لا إجازات مسجلة</TableCell></TableRow>}
              {d.leaves.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="cell-fluid">{l.leave_type?.name}{l.reason && <span className="block text-slate-500">{l.reason}</span>}</TableCell>
                  <TableCell><span className="num">{l.start_date}</span> إلى <span className="num">{l.end_date}</span></TableCell>
                  <TableCell className="whitespace-nowrap"><span className="num">{Number(l.days)}</span> يوم</TableCell>
                  <TableCell className="text-end">
                    {canManage && l.status === "pending" ? (
                      <span className="inline-flex gap-1.5">
                        <ActionButton label="اعتماد" done="اعتُمدت الإجازة" errors={t.errors} run={decideLeaveAction.bind(null, l.id, "approved")} />
                        <ActionButton label="رفض" done="رُفضت الإجازة" variant="ghost" errors={t.errors} run={decideLeaveAction.bind(null, l.id, "rejected")} />
                      </span>
                    ) : <Badge variant={LEAVE_STATUS[l.status]!.tone}>{LEAVE_STATUS[l.status]!.label}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>السلف</CardTitle>
            {!openAdvances.isZero() && <span className="text-[15.5px] text-slate-600">المتبقي <Money value={openAdvances} locale={locale} className="font-semibold text-ink" /></span>}
          </CardHeader>
          <Table>
            <TableBody>
              {d.advances.length === 0 && <TableRow><TableCell className="py-6 text-center text-slate-500">لا سلف</TableCell></TableRow>}
              {d.advances.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="num text-slate-500">{a.advance_number}</TableCell>
                  <TableCell className="num">{a.advance_date}</TableCell>
                  <TableCell className="text-end"><Money value={a.amount} locale={locale} /></TableCell>
                  <TableCell className="text-end text-slate-600">استُعيد <Money value={a.recovered} locale={locale} /></TableCell>
                  <TableCell className="text-end"><Badge variant={a.status === "open" ? "warning" : "success"}>{a.status === "open" ? "قائمة" : "مسددة"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader><CardTitle>الجزاءات</CardTitle></CardHeader>
          <Table>
            <TableBody>
              {d.penalties.length === 0 && <TableRow><TableCell className="py-6 text-center text-slate-500">لا جزاءات</TableCell></TableRow>}
              {d.penalties.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="num">{p.penalty_date}</TableCell>
                  <TableCell className="cell-fluid">{p.reason}</TableCell>
                  <TableCell className="text-end"><Money value={p.amount} locale={locale} /></TableCell>
                  <TableCell className="text-end">
                    {canManage && p.status === "pending" ? (
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

        {d.settlement && (
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>التسوية النهائية</CardTitle>
              {d.settlement.journal_entry_id && <Link href={`/journal/${d.settlement.journal_entry_id}`} className="text-[15.5px] text-action">القيد</Link>}
            </CardHeader>
            <Table>
              <TableBody>
                <TableRow><TableCell>مدة الخدمة</TableCell><TableCell className="text-end"><span className="num">{Number(d.settlement.service_years).toFixed(2)}</span> سنة</TableCell></TableRow>
                <TableRow><TableCell>مكافأة نهاية الخدمة</TableCell><TableCell className="text-end"><Money value={d.settlement.eos_amount} locale={locale} /></TableCell></TableRow>
                <TableRow><TableCell>تعويض الإجازات <span className="num">{Number(d.settlement.leave_days)}</span> يومًا</TableCell><TableCell className="text-end"><Money value={d.settlement.leave_amount} locale={locale} /></TableCell></TableRow>
                <TableRow><TableCell>السلف المخصومة</TableCell><TableCell className="text-end"><Money value={toMoney(d.settlement.advances_recovered).negated()} locale={locale} /></TableCell></TableRow>
                <TableRow className="bg-panel font-semibold hover:bg-panel"><TableCell>الصافي المستحق</TableCell><TableCell className="text-end"><Money value={d.settlement.net_amount} locale={locale} /></TableCell></TableRow>
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}

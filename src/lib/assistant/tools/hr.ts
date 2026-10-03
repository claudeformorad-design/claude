import "server-only";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { expiryAlerts, getHrSettings, listAdvances, listEmployees, listLeaves, payrollPreview } from "@/services/hr.service";
import { type ToolModule, asStr, denied, fn, monthStart, obj, round2, str, today } from "./shared";

/** أدوات الموظفين: نظرة شاملة على القوى العاملة والرواتب والإجازات والسلف وتنبيهات الوثائق */

export const hr: ToolModule = {
  specs: [
    fn("hr_overview", "نظرة شاملة على الموظفين: العدد حسب القسم، وتكلفة الرواتب المتوقعة للشهر بتفصيلها، والإجازات المعلقة والجارية، والسلف المفتوحة، والهويات والعقود التي تنتهي قريبًا مع روابط الموظفين.",
      obj({ month: str("شهر الرواتب بصيغة YYYY-MM، والافتراضي الشهر الحالي") })),
  ],
  run: {
    async hr_overview(env, a) {
      const { ctx } = env;
      if (!ctx.can(PERMISSIONS.hrView)) return denied("الموارد البشرية");
      const h = ctx.hotel.id, day = today(env);
      const month = /^\d{4}-\d{2}$/.test(asStr(a.month)) ? `${asStr(a.month)}-01` : monthStart(day);
      const [emps, settings, leaves, advances, payroll] = await Promise.all([
        listEmployees(ctx.supabase, h),
        getHrSettings(ctx.supabase, h).catch(() => null),
        listLeaves(ctx.supabase, h),
        listAdvances(ctx.supabase, h),
        payrollPreview(ctx.supabase, h, month).catch(() => null),
      ]);
      const active = emps.filter((e) => e.status === "active");
      const byDept = new Map<string, { department: string; count: number; basic: number }>();
      for (const e of active) {
        const k = e.department?.name_ar ?? "بدون قسم";
        const d = byDept.get(k) ?? { department: k, count: 0, basic: 0 };
        d.count++; d.basic = round2(d.basic + Number(e.basic_salary));
        byDept.set(k, d);
      }
      const sum = (f: (l: NonNullable<typeof payroll>[number]) => number) => round2((payroll ?? []).reduce((s, l) => s + f(l), 0));
      const net = (l: NonNullable<typeof payroll>[number]) => l.basic + l.allowances + l.overtime - l.deductions - l.insurance_employee - l.advance_recovery;
      const openAdv = advances.filter((x) => x.status === "open");
      return {
        currency: ctx.hotel.base_currency, date: day,
        headcount: { active: active.length, terminated: emps.length - active.length, by_department: [...byDept.values()].sort((x, y) => y.count - x.count) },
        payroll: payroll ? {
          month: month.slice(0, 7), employees: payroll.length,
          basic: sum((l) => l.basic), allowances: sum((l) => l.allowances), overtime: sum((l) => l.overtime), deductions: sum((l) => l.deductions),
          insurance_employee: sum((l) => l.insurance_employee), insurance_employer: sum((l) => l.insurance_employer), advance_recovery: sum((l) => l.advance_recovery),
          net_pay: sum(net), total_cost_to_hotel: sum((l) => l.basic + l.allowances + l.overtime - l.deductions + l.insurance_employer),
          highest: [...payroll].sort((x, y) => net(y) - net(x)).slice(0, 5).map((l) => ({ employee: l.employee_name, net: round2(net(l)), path: `/hr/${l.employee_id}` })),
          note: "معاينة محسوبة من الحضور والإجازات والسلف حتى اليوم، وليست مسيرًا معتمدًا",
        } : "تعذّرت معاينة الرواتب لهذا الشهر",
        leaves: {
          pending: leaves.filter((l) => l.status === "pending").map((l) => ({ employee: l.employee?.full_name, type: l.leave_type?.name, from: l.start_date, to: l.end_date, days: Number(l.days) })),
          on_leave_today: leaves.filter((l) => l.status === "approved" && l.start_date <= day && l.end_date >= day).map((l) => ({ employee: l.employee?.full_name, type: l.leave_type?.name, until: l.end_date })),
        },
        advances: {
          open_count: openAdv.length,
          outstanding: round2(openAdv.reduce((s, x) => s + Number(x.amount) - Number(x.recovered), 0)),
          items: openAdv.slice(0, 10).map((x) => ({ number: x.advance_number, employee: x.employee?.full_name, amount: Number(x.amount), recovered: Number(x.recovered), installment: Number(x.installment_amount) })),
        },
        expiring_documents: expiryAlerts(emps, day, settings?.expiry_alert_days ?? 60).map((x) => ({
          employee: x.employee.full_name, document: x.kind === "id" ? "الهوية" : "العقد", date: x.date, expired: x.expired, path: `/hr/${x.employee.id}`,
        })),
      };
    },
  },
  async snapshot({ ctx }) {
    if (!ctx.can(PERMISSIONS.hrView)) return {};
    const { count } = await ctx.supabase.from("hr_employees").select("id", { count: "exact", head: true }).eq("hotel_id", ctx.hotel.id).eq("status", "active");
    return { active_employees: count ?? null };
  },
};

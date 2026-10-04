import { forbidden } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { APPROVALS_PERMISSIONS, allowed } from "@/components/layout/nav-config";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/accounting/fiscal";
import type { ApprovalRequestRow, ApprovalStatus } from "@/lib/supabase/database.types";
import { getI18n } from "@/i18n/server";
import { raise } from "@/services/errors";
import { CancelRequest, DecideRequest } from "./approvals-client";

const STATUS: Record<ApprovalStatus, { label: string; variant: "warning" | "success" | "destructive" | "secondary" | "info" }> = {
  pending: { label: "بانتظار القرار", variant: "warning" },
  approved: { label: "موافق عليه", variant: "info" },
  executed: { label: "نُفّذ", variant: "success" },
  failed: { label: "تعذّر التنفيذ", variant: "destructive" },
  rejected: { label: "مرفوض", variant: "destructive" },
  cancelled: { label: "مسحوب", variant: "secondary" },
};

type Row = Pick<ApprovalRequestRow, "id" | "kind" | "summary" | "note" | "status" | "requested_by" | "requested_at" | "decided_by" | "decided_at" | "decision_note" | "result" | "error"> & { amount: string | null };

/**
 * الموافقات: الموظف يرسل العملية التي تتجاوز حده أو صلاحيته، والمدير يوافق فتُنفَّذ باسمه، أو يرفض.
 * لا يقرّر أحد في طلبه، والتنفيذ يخضع لصلاحيات وحدود من وافق.
 */
export default async function ApprovalsPage() {
  const ctx = await requireAppContext();
  if (!allowed(APPROVALS_PERMISSIONS, ctx.permissions)) forbidden();
  const { locale } = await getI18n();
  const decider = ctx.can(PERMISSIONS.approvalsDecide);
  const cols = "id, kind, summary, amount::text, note, status, requested_by, requested_at, decided_by, decided_at, decision_note, result, error";
  const [pending, recent] = await Promise.all([
    ctx.supabase.from("approval_requests").select(cols).eq("hotel_id", ctx.hotel.id).eq("status", "pending").order("requested_at"),
    ctx.supabase.from("approval_requests").select(cols).eq("hotel_id", ctx.hotel.id).neq("status", "pending").order("requested_at", { ascending: false }).limit(60),
  ]);
  raise(pending.error); raise(recent.error);
  const pendingRows = (pending.data ?? []) as unknown as Row[];
  const recentRows = (recent.data ?? []) as unknown as Row[];
  const people = [...new Set([...pendingRows, ...recentRows].flatMap((r) => [r.requested_by, r.decided_by]).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (people.length) {
    const { data, error } = await ctx.supabase.from("users_profiles").select("id, full_name").in("id", people);
    raise(error);
    for (const p of data ?? []) names.set(p.id, p.full_name || "موظف");
  }
  const who = (id: string | null) => (id === ctx.user.id ? "أنت" : (id && names.get(id)) || "موظف");
  const when = (iso: string) => formatDateTime(iso, ctx.hotel.timezone);
  const toDecide = pendingRows.filter((r) => decider && r.requested_by !== ctx.user.id);
  const mine = pendingRows.filter((r) => r.requested_by === ctx.user.id);

  const item = (r: Row, tools?: React.ReactNode) => (
    <div key={r.id} className="space-y-2 border-b border-line py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-ink">{r.summary}</p>
          <p className="text-[15px] text-slate-500">طلبه {who(r.requested_by)} في <span className="num">{when(r.requested_at)}</span></p>
          {r.note && <p className="text-[15px] text-slate-600">ملاحظة الموظف: {r.note}</p>}
          {r.decided_at && (
            <p className="text-[15px] text-slate-500">
              قرّره {who(r.decided_by)} في <span className="num">{when(r.decided_at)}</span>{r.decision_note ? `، ${r.decision_note}` : ""}
            </p>
          )}
          {r.status === "failed" && r.error && <p className="text-[15px] text-urgent">{r.error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {r.amount && <Money value={r.amount} locale={locale} />}
          <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
        </div>
      </div>
      {tools}
    </div>
  );

  return (
    <>
      <PageHeader title="الموافقات" />
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          {decider && (
            <Card>
              <CardHeader>
                <CardTitle className="justify-between"><span>بانتظار قرارك</span><span className="num font-medium text-slate-500">{toDecide.length}</span></CardTitle>
                <CardDescription>الموافقة تنفّذ العملية فورًا باسمك وضمن صلاحياتك وحدودك.</CardDescription>
              </CardHeader>
              <CardContent>
                {toDecide.length ? toDecide.map((r) => item(r, <DecideRequest id={r.id} />))
                  : <EmptyState icon={ShieldCheck} title="لا توجد طلبات معلّقة" description="حين يرسل موظف عملية تتجاوز حده أو صلاحيته تظهر هنا." />}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="justify-between"><span>طلباتي المعلّقة</span><span className="num font-medium text-slate-500">{mine.length}</span></CardTitle>
              <CardDescription>عمليات أرسلتها للمدير ولم يقرّر فيها بعد. يمكنك سحب الطلب قبل القرار.</CardDescription>
            </CardHeader>
            <CardContent>
              {mine.length ? mine.map((r) => item(r, <CancelRequest id={r.id} />))
                : <EmptyState icon={ShieldCheck} title="لا توجد طلبات منك" description="عند تجاوز حدك في عملية يظهر لك زر إرسالها للمدير." />}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader><CardTitle>آخر القرارات</CardTitle></CardHeader>
          <CardContent>
            {recentRows.length ? recentRows.map((r) => item(r))
              : <EmptyState icon={ShieldCheck} title="لا توجد قرارات بعد" description="تظهر هنا الطلبات بعد الموافقة أو الرفض أو السحب." />}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

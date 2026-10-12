import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { CalendarRange, Hourglass, ListChecks, Plus, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RouteDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { sumMoney, toMoney } from "@/lib/accounting/money";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { PostDuePrepaidButton, PrepaidForm, StopPrepaidButton } from "./prepaid-forms";

/** آخر يوم في الشهر رقم n من بداية الجدول (نفس قاعدة القاعدة app.prepaid_month_end) */
const monthEnd = (start: string, n: number) => {
  const [y, m] = start.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n + 1, 0)).toISOString().slice(0, 10);
};

/** المصروفات المدفوعة مقدمًا: إيجار سنة أو تأمين يُوزَّع على أشهره بقسط في آخر كل شهر */
export default async function PrepaidExpensesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.journalView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const { data, error } = await ctx.supabase.from("prepaid_expenses")
    .select("id, name, prepaid_account_id, expense_account_id, department_id, total_amount::text, months, start_date, posted_months, amortized_amount::text, status, last_entry_id, notes")
    .eq("hotel_id", ctx.hotel.id).order("status").order("start_date", { ascending: false });
  raise(error);
  const rows = (data ?? []) as unknown as { id: string; name: string; expense_account_id: string; department_id: string | null; total_amount: string; months: number;
    start_date: string; posted_months: number; amortized_amount: string; status: "active" | "completed" | "stopped"; last_entry_id: string | null; notes: string | null }[];
  const canEdit = ctx.can(PERMISSIONS.journalCreate);
  const canPost = canEdit && ctx.can(PERMISSIONS.journalPost);
  const due = (r: (typeof rows)[number]) => {
    if (r.status !== "active") return 0;
    let n = 0;
    for (let i = r.posted_months; i < r.months && monthEnd(r.start_date, i) <= today; i++) n++;
    return n;
  };
  const active = rows.filter((r) => r.status === "active");
  const totalDue = rows.reduce((n, r) => n + due(r), 0);
  const remaining = sumMoney(active.map((r) => toMoney(r.total_amount).minus(toMoney(r.amortized_amount))));
  const decimals = (await ctx.supabase.from("currencies").select("decimals").eq("code", ctx.hotel.base_currency).single()).data?.decimals ?? 2;

  const [accounts, departments] = await Promise.all([listAccounts(ctx.supabase, ctx.hotel.id), canEdit && sp.new ? listDepartments(ctx.supabase, ctx.hotel.id) : []]);
  const label = (a: { code: string; name_ar: string; name_en: string | null }) => `${a.code} ${(locale === "en" && a.name_en) || a.name_ar}`;
  const postable = accounts.filter((a) => a.is_postable && a.is_active);
  const prepaidAccounts = postable.filter((a) => a.account_type === "asset").sort((a, b) => Number(b.system_key === "prepaid") - Number(a.system_key === "prepaid"));
  const allAccounts = new Map(accounts.map((a) => [a.id, a]));
  const STATUS = { active: [tr("يُوزَّع"), "success"], completed: [tr("اكتمل"), "secondary"], stopped: [tr("موقوف"), "warning"] } as const;

  return (
    <>
      <PageHeader title={t.nav.prepaidExpenses} actions={
        <div className="flex flex-wrap gap-2">
          {canPost && <PostDuePrepaidButton due={totalDue} errors={t.errors} />}
          {canEdit && <Button asChild variant="outline"><Link href="/prepaid-expenses?new=1"><Plus />{tr("مصروف مقدم جديد")}</Link></Button>}
        </div>
      } />
      <p className="mb-5 max-w-3xl text-[15px] leading-relaxed text-slate-600">
        {tr("مبلغ دُفع مقدمًا عن عدة أشهر، مثل إيجار سنة أو تأمين أو ترخيص، يُوزَّع على أشهره: قسط في آخر كل شهر من حساب المدفوع مقدمًا إلى حساب المصروف، فيظهر مصروف كل شهر في شهره. «ترحيل الأقساط المستحقة» يرحّل كل قسط حان حتى اليوم ويلحق ما فات.")}
      </p>
      <StatGrid>
        <Stat icon={ListChecks} tone="ink" label={tr("جداول تُوزَّع")} value={<span className="num">{active.length}</span>} />
        <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="teal" label={tr("باقٍ للتوزيع")} value={<Money value={remaining} locale={locale} />} />
        <Stat icon={Hourglass} tone="clay" label={tr("أقساط مستحقة الآن")} value={<span className="num">{totalDue}</span>} />
      </StatGrid>
      {rows.length === 0 ? (
        <EmptyState icon={CalendarRange} title={tr("لا توجد مصروفات مقدمة")} description={tr("أضف إيجارًا أو تأمينًا دُفع مقدمًا ليُوزَّع على أشهره تلقائيًا.")}
          actionHref={canEdit ? "/prepaid-expenses?new=1" : undefined} actionLabel={canEdit ? tr("مصروف مقدم جديد") : undefined} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{tr("المصروف")}</TableHead>
              <TableHead>{tr("حساب المصروف")}</TableHead>
              <TableHead className="text-end">{tr("المبلغ")}</TableHead>
              <TableHead className="text-end">{tr("وُزِّع")}</TableHead>
              <TableHead>{tr("الأشهر")}</TableHead>
              <TableHead>{tr("الحالة")}</TableHead>
              {canEdit && <TableHead />}
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const acc = allAccounts.get(r.expense_account_id);
                const d = due(r);
                return (
                  <TableRow key={r.id} data-prepaid={r.name}>
                    <TableCell><p className="font-medium">{r.name}</p><p className="text-[14px] text-slate-500">{tr("من")}{" "}<span className="num">{r.start_date.slice(0, 7)}</span>{r.notes ? ` · ${r.notes}` : ""}</p></TableCell>
                    <TableCell>{acc ? label(acc) : ""}</TableCell>
                    <TableCell className="text-end"><Money value={r.total_amount} locale={locale} /></TableCell>
                    <TableCell className="text-end"><Money value={r.amortized_amount} locale={locale} /></TableCell>
                    <TableCell className="num">{r.posted_months} / {r.months}
                      {d > 0 && <Badge className="ms-2" variant="secondary">{tr("مستحق {0}", d)}</Badge>}
                      {r.last_entry_id && <>{" "}<Link href={`/journal/${r.last_entry_id}`} className="text-[14px] text-action">{tr("آخر قيد")}</Link></>}</TableCell>
                    <TableCell><Badge variant={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></TableCell>
                    {canEdit && <TableCell className="text-end">{r.status === "active" && <StopPrepaidButton id={r.id} errors={t.errors} />}</TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      {canEdit && sp.new && (
        <RouteDialog closeHref="/prepaid-expenses" title={tr("مصروف مقدم جديد")}>
          <PrepaidForm errors={t.errors} decimals={decimals} start={`${today.slice(0, 7)}-01`}
            expenseAccounts={postable.filter((a) => a.account_type === "expense").map((a) => ({ id: a.id, label: label(a) }))}
            prepaidAccounts={prepaidAccounts.map((a) => ({ id: a.id, label: label(a) }))}
            defaultPrepaid={prepaidAccounts[0]?.id ?? ""}
            departments={departments.filter((d) => d.is_active).map((d) => ({ id: d.id, label: `${d.code} ${(locale === "en" && d.name_en) || d.name_ar}` }))} />
        </RouteDialog>
      )}
    </>
  );
}

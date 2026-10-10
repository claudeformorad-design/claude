import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { sumMoney } from "@/lib/accounting/money";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { Repeat } from "lucide-react";
import { PostDueButton, RecurringRowActions } from "../../_ledger/forms";

const FREQ: Record<string, string> = { weekly: "أسبوعي", monthly: "شهري", quarterly: "ربع سنوي", yearly: "سنوي" };

/** القيود الدورية: الإيجارات والاشتراكات وتوزيع المصروفات المدفوعة مقدمًا */
export default async function RecurringEntriesPage() {
  const ctx = await requireAppContext(PERMISSIONS.journalView);
  const { locale, t } = await getI18n();
  const [rows, due] = await Promise.all([
    ctx.supabase.from("recurring_entries").select("id, name, description, lines, frequency, start_date, end_date, total_count, posted_count, is_active, last_entry_id")
      .eq("hotel_id", ctx.hotel.id).order("is_active", { ascending: false }).order("name"),
    ctx.supabase.rpc("recurring_entries_due", { p_hotel_id: ctx.hotel.id }),
  ]);
  raise(rows.error); raise(due.error);
  const dueById = new Map((due.data ?? []).map((d) => [d.id, d]));
  const totalDue = (rows.data ?? []).filter((r) => r.is_active).reduce((n, r) => n + (dueById.get(r.id)?.due_count ?? 0), 0);
  const canEdit = ctx.can(PERMISSIONS.journalCreate);
  const amount = (lines: unknown) => sumMoney(((lines as { debit?: string | number }[]) ?? []).map((l) => String(l.debit ?? 0)));

  return (
    <>
      <PageHeader title={tr("القيود الدورية")}
        actions={canEdit && ctx.can(PERMISSIONS.journalPost) ? <PostDueButton due={totalDue} errors={t.errors} /> : undefined} />
      <p className="max-w-3xl text-[15px] leading-relaxed text-slate-600">
        {tr("قيد يتكرر بنفس الحسابات والمبالغ: الإيجار، الاشتراكات، وتوزيع المصروفات المدفوعة مقدمًا على الأشهر. لإنشاء قيد دوري افتح أي قيد يدوي مرحّل واضغط «اجعله قيدًا دوريًا». «ترحيل القيود المستحقة» يرحّل كل موعد حان حتى اليوم، ويلحق ما فات.")}
      </p>
      {(rows.data ?? []).length === 0 ? (
        <EmptyState icon={Repeat} title={tr("لا توجد قيود دورية")} description={tr("افتح قيدًا يدويًا مرحّلًا من القيود اليومية واجعله قيدًا دوريًا.")}
          actionHref="/journal" actionLabel={t.nav.journal} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{tr("القيد الدوري")}</TableHead>
              <TableHead>{tr("التكرار")}</TableHead>
              <TableHead>{tr("الموعد القادم")}</TableHead>
              <TableHead className="text-end">{tr("المبلغ")}</TableHead>
              <TableHead>{tr("المرحّل")}</TableHead>
              <TableHead>{tr("الحالة")}</TableHead>
              {canEdit && <TableHead />}
            </TableRow></TableHeader>
            <TableBody>
              {(rows.data ?? []).map((r) => {
                const d = dueById.get(r.id);
                return (
                  <TableRow key={r.id}>
                    <TableCell><p className="font-medium">{r.name}</p><p className="text-[14px] text-slate-500">{r.description}</p></TableCell>
                    <TableCell>{tr(FREQ[r.frequency] ?? r.frequency)}</TableCell>
                    <TableCell className="num">{d?.next_date ?? tr("انتهى")}{d && d.due_count > 0 && r.is_active ? <Badge className="ms-2" variant="secondary">{tr("مستحق {0}", d.due_count)}</Badge> : null}</TableCell>
                    <TableCell className="text-end"><Money value={amount(r.lines)} locale={locale} /></TableCell>
                    <TableCell className="num">{r.posted_count}{r.total_count ? ` / ${r.total_count}` : ""}
                      {r.last_entry_id && <>{" "}<Link href={`/journal/${r.last_entry_id}`} className="text-action text-[14px]">{tr("آخر قيد")}</Link></>}</TableCell>
                    <TableCell>{r.is_active ? <Badge variant="success">{tr("فعّال")}</Badge> : <Badge variant="secondary">{tr("موقوف")}</Badge>}</TableCell>
                    {canEdit && <TableCell><RecurringRowActions id={r.id} active={r.is_active} errors={t.errors} /></TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}

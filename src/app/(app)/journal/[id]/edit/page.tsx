import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toMoney } from "@/lib/accounting/money";
import { getJournalEntry } from "@/services/journal.service";
import { getI18n } from "@/i18n/server";
import { JournalForm } from "../../journal-form";
import { loadJournalFormData } from "../../form-data";

export default async function EditJournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.journalCreate);
  const { locale, t } = await getI18n();
  const detail = await getJournalEntry(ctx.supabase, ctx.hotel.id, id);
  if (!detail) notFound();
  // القيود المرحّلة غير قابلة للتعديل
  if (detail.entry.status !== "draft") redirect(`/journal/${id}`);

  const data = await loadJournalFormData(ctx, locale);
  const amount = (v: string) => (toMoney(v).isZero() ? "" : toMoney(v).toFixed());

  return (
    <>
      <PageHeader title={`${t.journal.draftNumber} — ${t.common.edit}`} />
      <Card>
        <CardContent className="p-5">
          <JournalForm
            t={{ journal: t.journal, common: t.common, errors: t.errors }}
            locale={locale}
            canPost={ctx.can(PERMISSIONS.journalPost)}
            entryId={id}
            {...data}
            initial={{
              entry_date: detail.entry.entry_date,
              description: detail.entry.description,
              reference: detail.entry.reference ?? "",
              currency_code: detail.entry.currency_code,
              exchange_rate: toMoney(detail.entry.exchange_rate).toFixed(),
              lines: detail.lines.map((l) => ({
                account_id: l.account_id,
                department_id: l.department_id ?? "",
                description: l.description ?? "",
                debit: amount(l.debit),
                credit: amount(l.credit),
              })),
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}

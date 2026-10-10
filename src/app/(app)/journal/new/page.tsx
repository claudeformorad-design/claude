import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { emptyJournalLine } from "@/lib/validation/journal-entry";
import { getI18n } from "@/i18n/server";
import { JournalForm } from "../journal-form";
import { loadJournalFormData } from "../form-data";

export default async function NewJournalEntryPage() {
  const ctx = await requireAppContext(PERMISSIONS.journalCreate);
  const { locale, t } = await getI18n();
  const data = await loadJournalFormData(ctx, locale);

  return (
    <>
      <PageHeader title={t.journal.newEntry} />
      <Card>
        <CardContent className="p-5">
          <JournalForm
            t={{ journal: t.journal, common: t.common, errors: t.errors }}
            locale={locale}
            canPost={ctx.can(PERMISSIONS.journalPost)}
            {...data}
            initial={{
              entry_date: todayInTimeZone(ctx.hotel.timezone),
              description: "",
              reference: "",
              currency_code: ctx.hotel.base_currency,
              exchange_rate: "1",
              lines: [emptyJournalLine(), emptyJournalLine()],
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}

import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { listJournalEntries } from "@/services/journal.service";
import { getI18n } from "@/i18n/server";
import { StatusBadge } from "./status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BookOpen } from "lucide-react";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string; q?: string }>;
}) {
  const ctx = await requireAppContext(PERMISSIONS.journalView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const status = sp.status === "draft" || sp.status === "posted" ? sp.status : undefined;

  const entries = await listJournalEntries(ctx.supabase, ctx.hotel.id, {
    status,
    from: sp.from && isIsoDate(sp.from) ? sp.from : undefined,
    to: sp.to && isIsoDate(sp.to) ? sp.to : undefined,
    search: sp.q,
  });

  return (
    <>
      <PageHeader
        title={t.journal.title}
        description={t.journal.subtitle}
        actions={
          ctx.can(PERMISSIONS.journalCreate) && (
            <Button asChild>
              <Link href="/journal/new"><Plus />{t.journal.newEntry}</Link>
            </Button>
          )
        }
      />

      <form className="toolbar">
        <Input name="q" defaultValue={sp.q} placeholder={t.common.search} className="w-56" />
        <NativeSelect name="status" defaultValue={status ?? ""} className="w-36">
          <option value="">{t.common.status}</option>
          <option value="draft">{t.journal.status.draft}</option>
          <option value="posted">{t.journal.status.posted}</option>
        </NativeSelect>
        <Input type="date" name="from" defaultValue={sp.from} dir="ltr" className="w-40" aria-label={t.common.from} />
        <Input type="date" name="to" defaultValue={sp.to} dir="ltr" className="w-40" aria-label={t.common.to} />
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.journal.entryNumber}</TableHead>
              <TableHead>{t.common.date}</TableHead>
              <TableHead>{t.common.description}</TableHead>
              <TableHead>{t.journal.source}</TableHead>
              <TableHead className="text-end">{t.common.total}</TableHead>
              <TableHead>{t.common.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8">
                  <EmptyState
                    title="دفتر القيود فارغ"
                    description="لم يتم إدخال أي قيود محاسبية بعد. يمكنك إنشاء قيد جديد كبدء لميزانيتك الفندقية."
                    actionHref="/journal/new"
                    actionLabel="تسجيل قيد جديد"
                    icon={BookOpen}
                  />
                </TableCell>
              </TableRow>
            )}
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Link href={`/journal/${e.id}`} className="num font-medium text-primary hover:underline">
                    {e.entry_number ?? t.journal.draftNumber}
                  </Link>
                </TableCell>
                <TableCell className="num">{e.entry_date}</TableCell>
                <TableCell className="max-w-md truncate">{e.description}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t.journal.sources[e.source]}</Badge>
                </TableCell>
                <TableCell className="text-end">
                  <Money value={e.total_debit} locale={locale} /> <span className="text-xs text-muted-foreground">{e.currency_code}</span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={e.status} reversed={!!e.reversed_by_id} labels={t.journal.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

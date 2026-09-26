import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate } from "@/lib/accounting/fiscal";
import { listJournalEntries } from "@/services/journal.service";
import { getI18n } from "@/i18n/server";
import { StatusBadge } from "./status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BookOpen, FilePen, CheckCircle2, Undo2 } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Pager, pageSlice } from "@/components/ui/pager";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string; q?: string; page?: string }>;
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

  const drafts = entries.filter((e) => e.status === "draft").length;
  const posted = entries.filter((e) => e.status === "posted").length;
  const reversed = entries.filter((e) => !!e.reversed_by_id).length;
  const qs = (st?: string) => {
    const p = new URLSearchParams();
    if (st) p.set("status", st);
    if (sp.q) p.set("q", sp.q);
    if (sp.from) p.set("from", sp.from);
    if (sp.to) p.set("to", sp.to);
    const q = p.toString();
    return q ? `/journal?${q}` : "/journal";
  };

  const shown = pageSlice(entries, sp.page);

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

      <StatGrid>
        <Stat icon={BookOpen} tone="ink" label="قيود في القائمة" value={<span className="num">{entries.length}</span>} />
        <Stat icon={CheckCircle2} tone="teal" label={t.journal.status.posted} value={<span className="num">{posted}</span>} hint="تؤثر على الأرصدة" />
        <Stat icon={FilePen} tone="clay" label="مسودات" value={<span className="num">{drafts}</span>} hint="لا تؤثر حتى الترحيل" />
        <Stat icon={Undo2} tone="neutral" label="قيود معكوسة" value={<span className="num">{reversed}</span>} />
      </StatGrid>

      <FilterTabs className="mb-4" active={status ?? "all"} items={[
        { key: "all", href: qs(), label: "الكل" },
        { key: "posted", href: qs("posted"), label: t.journal.status.posted },
        { key: "draft", href: qs("draft"), label: t.journal.status.draft },
      ]} />

      <form className="toolbar">
        {status && <input type="hidden" name="status" value={status} />}
        <Input name="q" defaultValue={sp.q} placeholder="ابحث بالوصف أو رقم القيد" className="w-64" />
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
            {shown.rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Link href={`/journal/${e.id}`} className="num font-semibold text-ink hover:underline">
                    {e.entry_number ?? t.journal.draftNumber}
                  </Link>
                </TableCell>
                <TableCell className="num">{e.entry_date}</TableCell>
                <TableCell className="cell-fluid font-medium">{e.description}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t.journal.sources[e.source]}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-end font-semibold">
                  <Money value={e.total_debit} locale={locale} /> <span className="text-xs font-normal text-slate-500">{e.currency_code}</span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={e.status} reversed={!!e.reversed_by_id} labels={t.journal.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Pager page={shown.page} pages={shown.pages} total={entries.length} basePath="/journal" params={{ status: sp.status, from: sp.from, to: sp.to, q: sp.q }} />
    </>
  );
}

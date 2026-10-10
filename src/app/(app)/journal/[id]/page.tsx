import { tr } from "@/i18n/tr";
import Link from "@/components/link";
import { DocText } from "@/components/ui/code-text";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime, todayInTimeZone } from "@/lib/accounting/fiscal";
import { sumMoney } from "@/lib/accounting/money";
import { listAccounts, listDepartments } from "@/services/accounts.service";
import { getJournalEntry } from "@/services/journal.service";
import { getI18n } from "@/i18n/server";
import { StatusBadge } from "../status-badge";
import { EntryActions } from "./entry-actions";
import { RecurringFromEntry } from "../../_ledger/forms";

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.journalView);
  const { locale, t } = await getI18n();
  const [detail, accounts, departments] = await Promise.all([
    getJournalEntry(ctx.supabase, ctx.hotel.id, id),
    listAccounts(ctx.supabase, ctx.hotel.id),
    listDepartments(ctx.supabase, ctx.hotel.id),
  ]);
  if (!detail) notFound();

  const { entry, lines, related, users } = detail;
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const name = (a: { name_ar: string; name_en: string | null } | undefined) => (a ? (locale === "en" && a.name_en) || a.name_ar : "?");
  const isForeign = entry.currency_code !== ctx.hotel.base_currency;

  const meta: [string, React.ReactNode][] = [
    [t.journal.entryDate, <span key="d" className="num">{entry.entry_date}</span>],
    [t.journal.period, <span key="p" className="num">{detail.periodName ?? ""}</span>],
    [t.journal.source, <Badge key="s" variant="outline">{t.journal.sources[entry.source]}</Badge>],
    [t.common.reference, entry.reference ?? ""],
    [t.common.currency, isForeign ? <span key="c" className="num">{entry.currency_code} × {entry.exchange_rate}</span> : entry.currency_code],
    [t.journal.createdBy, entry.created_by ? users[entry.created_by] ?? "" : ""],
    [t.journal.postedBy, entry.posted_by ? users[entry.posted_by] ?? "" : ""],
    [t.journal.postedAt, entry.posted_at ? <span key="pa" className="num">{formatDateTime(entry.posted_at, ctx.hotel.timezone)}</span> : ""],
  ];

  return (
    <>
      <PageHeader
        title={`${t.journal.entry} ${entry.entry_number ?? t.journal.draftNumber}`}
        actions={<StatusBadge status={entry.status} reversed={!!entry.reversed_by_id} labels={t.journal.status} />}
      />

      <Card className="mb-6">
        <CardContent className="grid gap-x-8 gap-y-5 p-6 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {entry.description && (
            <div className="border-s-2 border-line ps-3 sm:col-span-2 lg:col-span-4">
              <p className="text-[15.5px] text-slate-500">{t.common.description}</p>
              <div className="mt-0.5 font-semibold text-ink"><DocText text={entry.description} /></div>
            </div>
          )}
          {meta.map(([label, value]) => (
            <div key={label} className="border-s-2 border-line ps-3">
              <p className="text-[15.5px] text-slate-500">{label}</p>
              <div className="mt-0.5 font-semibold text-ink">{value}</div>
            </div>
          ))}
          {entry.reversal_of_id && (
            <div>
              <p className="text-muted-foreground">{t.journal.reversalOf}</p>
              <Link className="num font-medium text-primary" href={`/journal/${entry.reversal_of_id}`}>
                {related[entry.reversal_of_id]?.entry_number}
              </Link>
            </div>
          )}
          {entry.reversed_by_id && (
            <div>
              <p className="text-muted-foreground">{t.journal.reversedBy}</p>
              <Link className="num font-medium text-primary" href={`/journal/${entry.reversed_by_id}`}>
                {related[entry.reversed_by_id]?.entry_number}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>{tr("الرمز")}</TableHead>
              <TableHead>{t.journal.account}</TableHead>
              <TableHead>{t.journal.department}</TableHead>
              <TableHead>{t.common.description}</TableHead>
              <TableHead className="text-end">{t.journal.debit}</TableHead>
              <TableHead className="text-end">{t.journal.credit}</TableHead>
              {isForeign && <TableHead className="text-end">{t.journal.debit}{" "}{tr("بالعملة الأساسية")}</TableHead>}
              {isForeign && <TableHead className="text-end">{t.journal.credit}{" "}{tr("بالعملة الأساسية")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const account = accountById.get(l.account_id);
              const dept = l.department_id ? deptById.get(l.department_id) : undefined;
              return (
                <TableRow key={l.id}>
                  <TableCell className="num text-muted-foreground">{l.line_no}</TableCell>
                  <TableCell className="num text-slate-500">{account?.code}</TableCell>
                  <TableCell className="font-medium">{name(account)}</TableCell>
                  <TableCell>{dept ? name(dept) : ""}</TableCell>
                  <TableCell className="text-muted-foreground"><DocText text={l.description} /></TableCell>
                  <TableCell className="text-end font-semibold text-accent1"><Money value={l.debit} locale={locale} blankZero /></TableCell>
                  <TableCell className="text-end font-semibold text-accent2"><Money value={l.credit} locale={locale} blankZero /></TableCell>
                  {isForeign && <TableCell className="text-end"><Money value={l.base_debit} locale={locale} blankZero /></TableCell>}
                  {isForeign && <TableCell className="text-end"><Money value={l.base_credit} locale={locale} blankZero /></TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5}>{t.journal.totals}</TableCell>
              <TableCell className="text-end"><Money value={sumMoney(lines.map((l) => l.debit))} locale={locale} /></TableCell>
              <TableCell className="text-end"><Money value={sumMoney(lines.map((l) => l.credit))} locale={locale} /></TableCell>
              {isForeign && <TableCell className="text-end"><Money value={sumMoney(lines.map((l) => l.base_debit))} locale={locale} /></TableCell>}
              {isForeign && <TableCell className="text-end"><Money value={sumMoney(lines.map((l) => l.base_credit))} locale={locale} /></TableCell>}
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      <EntryActions
        t={{ journal: t.journal, common: t.common, errors: t.errors }}
        entryId={entry.id}
        status={entry.status === "draft" ? "draft" : entry.reversed_by_id ? "reversed" : entry.reversal_of_id ? "reversal" : "posted"}
        canCreate={ctx.can(PERMISSIONS.journalCreate)}
        canPost={ctx.can(PERMISSIONS.journalPost)}
        canReverse={ctx.can(PERMISSIONS.journalReverse)}
        today={todayInTimeZone(ctx.hotel.timezone)}
      />
      {entry.status === "posted" && entry.source === "manual" && !entry.reversal_of_id && ctx.can(PERMISSIONS.journalCreate) && (
        <div className="mt-4">
          <RecurringFromEntry entryId={entry.id} defaultName={entry.description.slice(0, 120)} errors={t.errors}
            defaultStart={nextMonth(entry.entry_date)} />
        </div>
      )}
    </>
  );
}

/** نفس اليوم من الشهر التالي (أو آخر يوم فيه) */
function nextMonth(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

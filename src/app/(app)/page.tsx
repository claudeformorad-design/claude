import Link from "next/link";
import { BookOpen, FileClock, ListTree, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/money";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { sumMoney } from "@/lib/accounting/money";
import { getI18n } from "@/i18n/server";

export default async function DashboardPage() {
  const ctx = await requireAppContext();
  const { locale, t } = await getI18n();
  const { supabase, hotel } = ctx;
  const today = todayInTimeZone(hotel.timezone);
  const canJournal = ctx.can(PERMISSIONS.journalView);

  const [posted, drafts, accounts, period, cashAccounts] = await Promise.all([
    canJournal
      ? supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("hotel_id", hotel.id).eq("status", "posted")
      : null,
    canJournal
      ? supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("hotel_id", hotel.id).eq("status", "draft")
      : null,
    supabase.from("chart_of_accounts").select("id", { count: "exact", head: true }).eq("hotel_id", hotel.id),
    supabase
      .from("accounting_periods")
      .select("name, status")
      .eq("hotel_id", hotel.id)
      .lte("start_date", today)
      .gte("end_date", today)
      .maybeSingle(),
    supabase.from("chart_of_accounts").select("id").eq("hotel_id", hotel.id).in("system_key", ["cash", "petty_cash", "bank"]),
  ]);

  // رصيد النقدية = Σ(مدين − دائن) بالعملة الأساسية لحسابات النقد والبنوك من القيود المرحّلة
  let cashBalance: string | null = null;
  if (canJournal && cashAccounts.data?.length) {
    const { data: lines } = await supabase
      .from("journal_entry_lines")
      .select("base_debit::text, base_credit::text, journal_entries!inner(status)")
      .eq("hotel_id", hotel.id)
      .eq("journal_entries.status", "posted")
      .in("account_id", cashAccounts.data.map((a) => a.id));
    const rows = (lines ?? []) as unknown as { base_debit: string; base_credit: string }[];
    cashBalance = sumMoney(rows.map((l) => l.base_debit)).minus(sumMoney(rows.map((l) => l.base_credit))).toFixed();
  }

  const stats = [
    { label: t.dashboard.postedEntries, value: posted?.count ?? "—", icon: BookOpen, href: "/journal?status=posted" },
    { label: t.dashboard.draftEntries, value: drafts?.count ?? "—", icon: FileClock, href: "/journal?status=draft" },
    { label: t.dashboard.accountsCount, value: accounts.count ?? "—", icon: ListTree, href: "/accounts" },
  ];

  return (
    <>
      <PageHeader
        title={ctx.profile?.full_name ? `${t.dashboard.welcome}${locale === "ar" ? "، " : ", "}${ctx.profile.full_name}` : t.dashboard.title}
      />
      <Alert className="mb-6">{t.dashboard.phaseNote}</Alert>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t.dashboard.cashBalance}</CardTitle>
            <Wallet className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {cashBalance === null ? "—" : <Money value={cashBalance} locale={locale} />}{" "}
            <span className="text-sm font-normal text-muted-foreground">{hotel.base_currency}</span>
          </CardContent>
        </Card>
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="transition-colors hover:bg-accent/40">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
                <s.icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="num text-2xl font-bold">{s.value}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        {t.dashboard.openPeriod}: <span className="num">{period.data?.name ?? "—"}</span>
      </p>
    </>
  );
}

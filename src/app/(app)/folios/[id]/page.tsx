import Link from "@/components/link";
import { CodeTag, DocText } from "@/components/ui/code-text";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { plainText } from "@/lib/text";
import { PrintLink } from "@/components/print-link";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatMoney, toMoney } from "@/lib/accounting/money";
import { getFolio } from "@/services/folio.service";
import { listChargeCodes, listPaymentMethods, listTaxRates } from "@/services/revenue-settings.service";
import { getI18n } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { FolioActions } from "./folio-actions";
import { CalendarRange, HandCoins, UserRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Stat, StatGrid } from "@/components/ui/stat";

export default async function FolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.folioView);
  const { locale, t } = await getI18n();
  const detail = await getFolio(ctx.supabase, ctx.hotel.id, id);
  if (!detail) notFound();
  const { folio, transactions } = detail;
  const isOpen = folio.status === "open";
  const name = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;

  const [codes, methods, taxes, customers, openFolios, currency] = isOpen
    ? await Promise.all([
        listChargeCodes(ctx.supabase, ctx.hotel.id),
        listPaymentMethods(ctx.supabase, ctx.hotel.id),
        listTaxRates(ctx.supabase, ctx.hotel.id),
        ctx.supabase.from("customers").select("id, code, name_ar, name_en").eq("hotel_id", ctx.hotel.id).eq("allow_credit", true).eq("is_active", true),
        ctx.supabase.from("guest_folios").select("id, folio_number, guest_name").eq("hotel_id", ctx.hotel.id).eq("status", "open").neq("id", id),
        ctx.supabase.from("currencies").select("decimals").eq("code", ctx.hotel.base_currency).single(),
      ])
    : [[], [], [], null, null, null];
  const taxById = new Map(taxes.map((x) => [x.id, x]));
  const decimals = currency?.data?.decimals ?? 2;

  const effective = transactions.filter((x) => x.direction === 1 && !x.voided_by_id);
  const summary = (x: (typeof transactions)[number]) =>
    `${t.folio.txnTypes[x.txn_type]}، ${plainText(x.description)}، ${formatMoney(x.total_amount, { locale })}`;

  return (
    <>
      <PageHeader
        title={`${t.folio.folioNumber} ${folio.folio_number}`}
        actions={
          <div className="flex items-center gap-2">
            {detail.invoiceId && <Button asChild variant="outline"><Link href={`/invoices/${detail.invoiceId}`}>{t.folio.invoice}</Link></Button>}
            <Badge variant={isOpen ? "success" : "secondary"}>{t.folio.statuses[folio.status]}</Badge>
            <PrintLink href={`/print/folio/${folio.id}`} label="طباعة كشف الحساب" />
          </div>
        }
      />

      <StatGrid>
        <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="ink" label={t.folio.balance} value={<Money value={detail.balance} locale={locale} />} />
        <Stat currency={ctx.hotel.base_currency} icon={HandCoins} tone="teal" label={t.folio.deposits} value={<Money value={detail.deposits} locale={locale} />} />
        <Stat icon={CalendarRange} tone="clay" label="الإقامة" value={folio.arrival_date ? <span>من <span className="num">{folio.arrival_date}</span> إلى <span className="num">{folio.departure_date ?? ""}</span></span> : ""} hint={t.folio.types[folio.folio_type]} />
        <Stat icon={UserRound} tone="neutral" label="النزيل" value={folio.guest_name} hint={folio.room_number ? `${t.folio.room} ${folio.room_number}` : undefined} />
      </StatGrid>

      {isOpen && (
        <Card className="mb-6"><CardContent className="p-5">
          <FolioActions
            t={{ folio: t.folio, common: t.common, errors: t.errors }}
            locale={locale}
            decimals={decimals}
            folioId={folio.id}
            hasTransactions={transactions.length > 0}
            chargeCodes={codes.filter((c) => c.is_active).map((c) => ({
              id: c.id, label: `${c.code} ${name(c)}`, price: c.default_price, inclusive: c.price_includes_tax,
              taxes: c.tax_rate_ids.map((tid) => taxById.get(tid)).filter((x) => !!x).map((x) => ({ id: x!.id, rate: x!.rate, is_compound: x!.is_compound })),
            }))}
            methods={methods.filter((m) => m.is_active).map((m) => ({ id: m.id, label: m.currency_code ? `${m.currency_code} ${name(m)}` : name(m), kind: m.kind }))}
            customers={(customers?.data ?? []).map((c) => ({ id: c.id, label: `${c.code} ${name(c)}` }))}
            defaultCustomerId={folio.customer_id}
            charges={effective.filter((x) => x.txn_type === "charge").map((x) => ({ id: x.id, label: summary(x) }))}
            voidable={effective.filter((x) => !x.txn_type.startsWith("transfer")).map((x) => ({ id: x.id, label: summary(x) }))}
            openFolios={(openFolios?.data ?? []).map((f) => ({ id: f.id, label: `${f.folio_number} ${f.guest_name}` }))}
            can={{
              manage: ctx.can(PERMISSIONS.folioManage), allowance: ctx.can(PERMISSIONS.folioAllowance),
              void: ctx.can(PERMISSIONS.folioVoid), checkout: ctx.can(PERMISSIONS.folioCheckout),
            }}
          />
        </CardContent></Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader><CardTitle>{t.folio.transactions}</CardTitle></CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.folio.businessDate}</TableHead>
              <TableHead>{t.common.status}</TableHead>
              <TableHead>{t.common.description}</TableHead>
              <TableHead className="text-end">{t.folio.net}</TableHead>
              <TableHead className="text-end">{t.folio.tax}</TableHead>
              <TableHead className="text-end">{t.folio.charges}</TableHead>
              <TableHead className="text-end">{t.folio.deposits}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t.common.noData}</TableCell></TableRow>
            )}
            {transactions.map((x) => (
              <TableRow key={x.id} className={cn((x.voided_by_id || x.direction === -1) && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                <TableCell className="num">{x.business_date}</TableCell>
                <TableCell><Badge variant="outline">{t.folio.txnTypes[x.txn_type]}</Badge></TableCell>
                <TableCell><DocText text={x.description} />{x.reference && <CodeTag>{x.reference}</CodeTag>}</TableCell>
                <TableCell className="text-end"><Money value={x.net_amount} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end"><Money value={x.tax_amount} locale={locale} blankZero /></TableCell>
                <TableCell className={cn("text-end", toMoney(x.ledger_effect).isNegative() && "text-success")}><Money value={x.ledger_effect} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end"><Money value={x.deposit_effect} locale={locale} blankZero /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

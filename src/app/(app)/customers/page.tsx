import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { CustomerFormInput } from "@/lib/validation/revenue";
import { listCustomers } from "@/services/customers.service";
import { getI18n } from "@/i18n/server";
import { CustomerForm } from "./customer-form";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.customersView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const customers = await listCustomers(ctx.supabase, ctx.hotel.id);
  const canManage = ctx.can(PERMISSIONS.customersManage);
  const name = (x: { name_ar: string; name_en: string | null }) => (locale === "en" && x.name_en) || x.name_ar;

  let initial: CustomerFormInput | null = null;
  const c = sp.edit ? customers.find((x) => x.id === sp.edit) : undefined;
  if (canManage && c) {
    initial = {
      id: c.id, code: c.code, name_ar: c.name_ar, name_en: c.name_en ?? "", customer_type: c.customer_type,
      tax_number: c.tax_number ?? "", commercial_registration: c.commercial_registration ?? "", email: c.email ?? "",
      phone: c.phone ?? "", address: c.address ?? "", allow_credit: c.allow_credit, credit_limit: c.credit_limit ?? "",
      payment_terms_days: String(c.payment_terms_days), notes: c.notes ?? "", is_active: c.is_active,
    };
  } else if (canManage && sp.new) {
    initial = {
      code: "", name_ar: "", name_en: "", customer_type: "company", tax_number: "", commercial_registration: "",
      email: "", phone: "", address: "", allow_credit: false, credit_limit: "", payment_terms_days: "30", notes: "", is_active: true,
    };
  }

  return (
    <>
      <PageHeader
        title={t.customers.title}
        description={t.customers.subtitle}
        actions={canManage && <Button asChild><Link href="/customers?new=1"><Plus />{t.customers.newCustomer}</Link></Button>}
      />
      <div className={`grid gap-6 ${initial ? "xl:grid-cols-[1fr_380px]" : ""}`}>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.customers.code}</TableHead>
                <TableHead>{t.customers.name}</TableHead>
                <TableHead>{t.customers.type}</TableHead>
                <TableHead>{t.customers.allowCredit}</TableHead>
                <TableHead className="text-end">{t.customers.creditLimit}</TableHead>
                <TableHead className="text-end">{t.customers.openInvoices}</TableHead>
                <TableHead className="text-end">{t.customers.unappliedCredit}</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length === 0 && (
                <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">{t.common.noData}</TableCell></TableRow>
              )}
              {customers.map((x) => (
                <TableRow key={x.id} className={x.is_active ? "" : "opacity-50"}>
                  <TableCell className="num">{x.code}</TableCell>
                  <TableCell><Link href={`/invoices?customer=${x.id}`} className="hover:underline">{name(x)}</Link></TableCell>
                  <TableCell>{t.customers.types[x.customer_type]}</TableCell>
                  <TableCell>{x.allow_credit ? <Badge variant="success">{t.common.yes}</Badge> : <Badge variant="secondary">{t.common.no}</Badge>}</TableCell>
                  <TableCell className="text-end">{x.credit_limit ? <Money value={x.credit_limit} locale={locale} /> : "—"}</TableCell>
                  <TableCell className="text-end"><Money value={x.open_invoices} locale={locale} blankZero /></TableCell>
                  <TableCell className="text-end"><Money value={x.unapplied_credit} locale={locale} blankZero /></TableCell>
                  {canManage && (
                    <TableCell className="text-end"><Button asChild variant="ghost" size="sm"><Link href={`/customers?edit=${x.id}`}>{t.common.edit}</Link></Button></TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        {initial && (
          <Card className="h-fit">
            <CardHeader><CardTitle>{initial.id ? t.common.edit : t.customers.newCustomer}</CardTitle></CardHeader>
            <CardContent><CustomerForm key={initial.id ?? "new"} t={{ customers: t.customers, common: t.common, errors: t.errors }} initial={initial} /></CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

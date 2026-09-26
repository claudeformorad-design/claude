import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listVendors } from "@/services/payables.service";
import { getI18n } from "@/i18n/server";
import { VendorForm } from "./vendor-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Truck } from "lucide-react";

export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.vendorsView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const vendors = await listVendors(ctx.supabase, ctx.hotel.id);
  const can = ctx.can(PERMISSIONS.vendorsManage);
  const e = vendors.find((v) => v.id === sp.edit);
  const initial = can && (e || sp.new)
    ? {
        id: e?.id, code: e?.code ?? "", name_ar: e?.name_ar ?? "", name_en: e?.name_en ?? "", tax_number: e?.tax_number ?? "",
        phone: e?.phone ?? "", email: e?.email ?? "", address: e?.address ?? "", payment_terms_days: String(e?.payment_terms_days ?? 30),
        is_active: e?.is_active ?? true,
      }
    : null;
  return (
    <>
      <PageHeader title={t.nav.vendors} description={t.payables.vendorsSubtitle}
        actions={can && <Button asChild><Link href="/vendors?new=1"><Plus />{t.payables.newVendor}</Link></Button>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t.customers.code}</TableHead><TableHead>{t.customers.name}</TableHead>
              <TableHead>{t.customers.taxNumber}</TableHead><TableHead>{t.customers.paymentTerms}</TableHead>
              <TableHead>{t.common.status}</TableHead>{can && <TableHead />}
            </TableRow></TableHeader>
            <TableBody>
              {vendors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8">
                    <EmptyState
                      title="سجل الموردين فارغ"
                      description="لم يتم تسجيل أي موردين بعد. يمكنك إضافة الموردين المعتمدين للفندق لإصدار فواتير الشراء وأوامر التوريد."
                      actionHref="/vendors?new=1"
                      actionLabel="إضافة مورد جديد"
                      icon={Truck}
                    />
                  </TableCell>
                </TableRow>
              )}
              {vendors.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="num">{v.code}</TableCell>
                  <TableCell><Link href={`/bills?vendor=${v.id}`} className="hover:underline">{(locale === "en" && v.name_en) || v.name_ar}</Link></TableCell>
                  <TableCell className="num">{v.tax_number ?? "—"}</TableCell>
                  <TableCell className="num">{v.payment_terms_days}</TableCell>
                  <TableCell><Badge variant={v.is_active ? "success" : "secondary"}>{v.is_active ? t.common.active : t.common.inactive}</Badge></TableCell>
                  {can && <TableCell className="text-end"><Button asChild variant="ghost" size="sm"><Link href={`/vendors?edit=${v.id}`}>{t.common.edit}</Link></Button></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        {initial && (
          <Card className="h-fit"><CardHeader><CardTitle>{initial.id ? t.common.edit : t.payables.newVendor}</CardTitle></CardHeader>
            <CardContent><VendorForm key={initial.id ?? "new"} t={{ customers: t.customers, common: t.common, errors: t.errors }} initial={initial} /></CardContent></Card>
        )}
      </div>
    </>
  );
}

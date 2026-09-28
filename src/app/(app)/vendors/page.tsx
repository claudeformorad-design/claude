import { ExpandableRow, ExpandMark } from "@/components/ui/expandable-row";
import { RouteDialog } from "@/components/ui/dialog";
import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listVendors } from "@/services/payables.service";
import { getI18n } from "@/i18n/server";
import { VendorForm } from "./vendor-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Truck } from "lucide-react";
import { BadgeCheck, CalendarClock } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EntityCell } from "@/components/ui/entity";

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
      <PageHeader title={t.nav.vendors}
        actions={can && <Button asChild><Link href="/vendors?new=1"><Plus />{t.payables.newVendor}</Link></Button>} />
      <StatGrid className="lg:grid-cols-3">
        <Stat icon={Truck} tone="ink" label="الموردون" value={<span className="num">{vendors.length}</span>} />
        <Stat icon={BadgeCheck} tone="teal" label="فعّالون" value={<span className="num">{vendors.filter((v) => v.is_active).length}</span>} />
        <Stat icon={CalendarClock} tone="clay" label="متوسط مدة السداد" value={<span className="num">{vendors.length ? Math.round(vendors.reduce((a, v) => a + v.payment_terms_days, 0) / vendors.length) : 0} يومًا</span>} />
      </StatGrid>
      <div className="grid gap-6">
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
                <ExpandableRow kind="vendor" id={v.id} colSpan={can ? 6 : 5} key={v.id}>
                  <TableCell className="text-slate-600"><ExpandMark /><span className="num">{v.code}</span></TableCell>
                  <TableCell><EntityCell name={(locale === "en" && v.name_en) || v.name_ar} sub={v.phone ?? v.email ?? undefined} href={`/bills?vendor=${v.id}`} /></TableCell>
                  <TableCell className="num">{v.tax_number ?? ""}</TableCell>
                  <TableCell><span className="num">{v.payment_terms_days}</span> <span className="text-slate-500">يومًا</span></TableCell>
                  <TableCell><Badge variant={v.is_active ? "success" : "secondary"}>{v.is_active ? t.common.active : t.common.inactive}</Badge></TableCell>
                  {can && <TableCell className="text-end"><Button asChild variant="ghost" size="sm"><Link href={`/vendors?edit=${v.id}`}>{t.common.edit}</Link></Button></TableCell>}
                </ExpandableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        {initial && (
          <RouteDialog key={initial.id ?? "new"} closeHref="/vendors" title={initial.id ? `تعديل ${initial.name_ar}` : t.payables.newVendor}>
            <VendorForm t={{ customers: t.customers, common: t.common, errors: t.errors }} initial={initial} />
          </RouteDialog>
        )}
      </div>
    </>
  );
}

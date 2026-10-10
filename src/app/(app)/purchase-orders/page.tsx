import { tr } from "@/i18n/tr";
import { ExpandableRow, ExpandMark } from "@/components/ui/expandable-row";
import Link from "@/components/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listPurchaseOrders, listVendors } from "@/services/payables.service";
import { getI18n } from "@/i18n/server";
import { ConvertToBill } from "./convert-button";
import { PackageCheck, PackageOpen, ShoppingCart } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EntityCell } from "@/components/ui/entity";
import { EmptyState } from "@/components/ui/empty-state";

export default async function PurchaseOrdersPage() {
  const ctx = await requireAppContext(PERMISSIONS.purchasesManage);
  const { locale, t } = await getI18n();
  const [pos, vendors] = await Promise.all([listPurchaseOrders(ctx.supabase, ctx.hotel.id), listVendors(ctx.supabase, ctx.hotel.id)]);
  const vName = new Map(vendors.map((v) => [v.id, (locale === "en" && v.name_en) || v.name_ar]));
  return (
    <>
      <PageHeader title={t.nav.purchaseOrders}
        actions={<Button asChild><Link href="/purchase-orders/new"><Plus />{t.payables.newPo}</Link></Button>} />
      <StatGrid className="lg:grid-cols-3">
        <Stat icon={ShoppingCart} tone="ink" label={tr("أوامر الشراء")} value={<span className="num">{pos.length}</span>} />
        <Stat icon={PackageOpen} tone="clay" label={tr("مفتوحة بانتظار الفوترة")} value={<span className="num">{pos.filter((p) => p.status === "open").length}</span>} />
        <Stat icon={PackageCheck} tone="teal" label={tr("مكتملة")} value={<span className="num">{pos.filter((p) => p.status !== "open").length}</span>} />
      </StatGrid>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t.payables.poNumber}</TableHead><TableHead>{t.common.date}</TableHead><TableHead>{t.payables.vendor}</TableHead>
            <TableHead>{t.common.status}</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {pos.length === 0 && <TableRow><TableCell colSpan={5} className="py-8"><EmptyState title={tr("لا توجد أوامر شراء")} description={tr("أنشئ أمر شراء للمورد ثم حوّله إلى فاتورة عند الاستلام.")} actionHref="/purchase-orders/new" actionLabel={tr("أمر شراء جديد")} icon={ShoppingCart} /></TableCell></TableRow>}
            {pos.map((p) => (
              <ExpandableRow kind="purchase-order" id={p.id} colSpan={5} key={p.id}>
                <TableCell className="font-semibold"><ExpandMark /><span className="num">{p.po_number}</span></TableCell><TableCell className="num">{p.order_date}</TableCell>
                <TableCell><EntityCell name={vName.get(p.vendor_id) ?? ""} /></TableCell>
                <TableCell><Badge variant={p.status === "open" ? "warning" : "success"}>{t.payables.statuses[p.status]}</Badge></TableCell>
                <TableCell className="text-end">
                  {p.status === "open" && ctx.can(PERMISSIONS.billsCreate) && (
                    <ConvertToBill poId={p.id} vendorId={p.vendor_id} label={t.payables.toBill} errors={t.errors} />
                  )}
                </TableCell>
              </ExpandableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

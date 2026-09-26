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

export default async function PurchaseOrdersPage() {
  const ctx = await requireAppContext(PERMISSIONS.purchasesManage);
  const { locale, t } = await getI18n();
  const [pos, vendors] = await Promise.all([listPurchaseOrders(ctx.supabase, ctx.hotel.id), listVendors(ctx.supabase, ctx.hotel.id)]);
  const vName = new Map(vendors.map((v) => [v.id, (locale === "en" && v.name_en) || v.name_ar]));
  return (
    <>
      <PageHeader title={t.nav.purchaseOrders} description={t.payables.poSubtitle}
        actions={<Button asChild><Link href="/purchase-orders/new"><Plus />{t.payables.newPo}</Link></Button>} />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t.payables.poNumber}</TableHead><TableHead>{t.common.date}</TableHead><TableHead>{t.payables.vendor}</TableHead>
            <TableHead>{t.common.status}</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {pos.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">{t.common.noData}</TableCell></TableRow>}
            {pos.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="num">{p.po_number}</TableCell><TableCell className="num">{p.order_date}</TableCell>
                <TableCell>{vName.get(p.vendor_id)}</TableCell>
                <TableCell><Badge variant={p.status === "open" ? "default" : "secondary"}>{t.payables.statuses[p.status]}</Badge></TableCell>
                <TableCell className="text-end">
                  {p.status === "open" && ctx.can(PERMISSIONS.billsCreate) && (
                    <ConvertToBill poId={p.id} vendorId={p.vendor_id} label={t.payables.toBill} errorLabel={t.errors.unknown} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

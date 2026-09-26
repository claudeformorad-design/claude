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
import { listFolios } from "@/services/folio.service";
import { getI18n } from "@/i18n/server";
import { EmptyState } from "@/components/ui/empty-state";
import { BedDouble } from "lucide-react";

export default async function FoliosPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.folioView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const folios = await listFolios(ctx.supabase, ctx.hotel.id, { status: status === "all" ? undefined : status, q: sp.q });

  return (
    <>
      <PageHeader
        title={t.folio.title}
        description={t.folio.subtitle}
        actions={ctx.can(PERMISSIONS.folioManage) && (
          <Button asChild><Link href="/folios/new"><Plus />{t.folio.newFolio}</Link></Button>
        )}
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder={t.common.search} className="w-56" />
        <NativeSelect name="status" defaultValue={status} className="w-36">
          <option value="open">{t.folio.statuses.open}</option>
          <option value="closed">{t.folio.statuses.closed}</option>
          <option value="cancelled">{t.folio.statuses.cancelled}</option>
          <option value="all">—</option>
        </NativeSelect>
        <Button type="submit" variant="outline">{t.common.apply}</Button>
      </form>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.folio.folioNumber}</TableHead>
              <TableHead>{t.folio.guestName}</TableHead>
              <TableHead>{t.folio.room}</TableHead>
              <TableHead>{t.folio.folioType}</TableHead>
              <TableHead>{t.folio.arrival}</TableHead>
              <TableHead className="text-end">{t.folio.deposits}</TableHead>
              <TableHead className="text-end">{t.folio.balance}</TableHead>
              <TableHead>{t.common.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {folios.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8">
                  <EmptyState
                    title="لا توجد حسابات نزلاء (فوليو) مفتوحة"
                    description="لم يتم فتح أي فوليو حالياً. يمكنك إضافة فتح حساب نزيل أو مجموعة عند وصول الضيوف."
                    actionHref="/folios/new"
                    actionLabel="فتح حساب فوليو جديد"
                    icon={BedDouble}
                  />
                </TableCell>
              </TableRow>
            )}
            {folios.map((f) => (
              <TableRow key={f.id}>
                <TableCell><Link href={`/folios/${f.id}`} className="num font-medium text-primary hover:underline">{f.folio_number}</Link></TableCell>
                <TableCell>{f.guest_name}</TableCell>
                <TableCell className="num">{f.room_number ?? "—"}</TableCell>
                <TableCell>{t.folio.types[f.folio_type]}</TableCell>
                <TableCell className="num">{f.arrival_date ?? "—"}</TableCell>
                <TableCell className="text-end"><Money value={f.deposit_balance} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end font-medium"><Money value={f.balance} locale={locale} /></TableCell>
                <TableCell>
                  <Badge variant={f.status === "open" ? "success" : "secondary"}>{t.folio.statuses[f.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

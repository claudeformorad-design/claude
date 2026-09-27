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
import { listFolios } from "@/services/folio.service";
import { getI18n } from "@/i18n/server";
import { EmptyState } from "@/components/ui/empty-state";
import { BedDouble, DoorOpen, HandCoins, Wallet } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EntityCell } from "@/components/ui/entity";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { ZERO, toMoney } from "@/lib/accounting/money";
import { Pager, pageSlice } from "@/components/ui/pager";

export default async function FoliosPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.folioView);
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const folios = await listFolios(ctx.supabase, ctx.hotel.id, { status: status === "all" ? undefined : status, q: sp.q });

  const totalBalance = folios.reduce((a, f) => a.plus(toMoney(f.balance)), ZERO);
  const totalDeposits = folios.reduce((a, f) => a.plus(toMoney(f.deposit_balance)), ZERO);
  const withBalance = folios.filter((f) => !toMoney(f.balance).isZero()).length;
  const tabHref = (k: string) => `/folios?status=${k}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`;

  const shown = pageSlice(folios, sp.page);

  return (
    <>
      <PageHeader
        title={t.folio.title}
        description={t.folio.subtitle}
        actions={ctx.can(PERMISSIONS.folioManage) && (
          <Button asChild><Link href="/folios/new"><Plus />{t.folio.newFolio}</Link></Button>
        )}
      />
      <StatGrid>
        <Stat icon={BedDouble} tone="ink" label={status === "open" ? "فوليوهات مفتوحة" : "فوليوهات في القائمة"} value={<span className="num">{folios.length}</span>} />
        <Stat icon={Wallet} tone="teal" label="أرصدة مستحقة على النزلاء" value={<Money value={totalBalance} locale={locale} />} hint={`${withBalance} فوليو برصيد`} />
        <Stat icon={HandCoins} tone="clay" label="عربون غير مطبّق" value={<Money value={totalDeposits} locale={locale} />} />
        <Stat icon={DoorOpen} tone="neutral" label="غرف مشغولة" value={<span className="num">{new Set(folios.filter((f) => f.status === "open" && f.room_number).map((f) => f.room_number)).size}</span>} hint="من الفوليوهات المفتوحة المعروضة" />
      </StatGrid>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterTabs active={status} items={[
          { key: "open", href: tabHref("open"), label: t.folio.statuses.open },
          { key: "closed", href: tabHref("closed"), label: t.folio.statuses.closed },
          { key: "cancelled", href: tabHref("cancelled"), label: t.folio.statuses.cancelled },
          { key: "all", href: tabHref("all"), label: "الكل" },
        ]} />
        <form className="flex items-center gap-2">
          <input type="hidden" name="status" value={status} />
          <Input name="q" defaultValue={sp.q} placeholder="ابحث بالاسم أو الغرفة أو الرقم" className="w-64 bg-white" />
          <Button type="submit" variant="outline">{t.common.apply}</Button>
        </form>
      </div>
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
                    title="لا توجد حسابات نزلاء مفتوحة"
                    description="لم يتم فتح أي فوليو حالياً. يمكنك إضافة فتح حساب نزيل أو مجموعة عند وصول الضيوف."
                    actionHref="/folios/new"
                    actionLabel="فتح حساب فوليو جديد"
                    icon={BedDouble}
                  />
                </TableCell>
              </TableRow>
            )}
            {shown.rows.map((f) => (
              <TableRow key={f.id}>
                <TableCell><Link href={`/folios/${f.id}`} className="num font-medium text-primary">{f.folio_number}</Link></TableCell>
                <TableCell className="cell-fluid"><EntityCell name={f.guest_name} sub={f.departure_date ? `مغادرة ${f.departure_date}` : undefined} /></TableCell>
                <TableCell>{f.room_number ? <span className="num inline-flex h-7 min-w-10 items-center justify-center rounded-lg bg-subtle px-2 text-[15.5px] font-semibold text-ink">{f.room_number}</span> : <span className="text-slate-400"></span>}</TableCell>
                <TableCell>{t.folio.types[f.folio_type]}</TableCell>
                <TableCell className="num">{f.arrival_date ?? ""}</TableCell>
                <TableCell className="text-end"><Money value={f.deposit_balance} locale={locale} blankZero /></TableCell>
                <TableCell className="text-end font-semibold"><Money value={f.balance} locale={locale} /></TableCell>
                <TableCell>
                  <Badge variant={f.status === "open" ? "success" : "secondary"}>{t.folio.statuses[f.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Pager page={shown.page} pages={shown.pages} total={folios.length} basePath="/folios" params={{ status: sp.status, q: sp.q }} />
    </>
  );
}

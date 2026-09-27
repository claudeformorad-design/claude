import { RouteDialog } from "@/components/ui/dialog";
import Link from "@/components/link";
import { Ban, Plus, Search, UserRound, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityCell } from "@/components/ui/entity";
import { Input } from "@/components/ui/input";
import { Pager, pageSlice } from "@/components/ui/pager";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ID_TYPES } from "@/lib/pms/labels";
import { listCompanyOptions, listGuests } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../_assets/simple-form";
import { saveGuestAction } from "../_pms/actions";
import { guestFormFields, guestInitial } from "./guest-fields";

/** النزلاء: بحث بالاسم أو الجوال أو رقم الهوية، وإضافة وتعديل، والقائمة السوداء */
export default async function GuestsPage({ searchParams }: { searchParams: Promise<{ q?: string; new?: string; edit?: string; page?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const { t } = await getI18n();
  const sp = await searchParams;
  const canManage = ctx.can(PERMISSIONS.pmsManage);
  const [guests, companies] = await Promise.all([
    listGuests(ctx.supabase, ctx.hotel.id, sp.q),
    ctx.can(PERMISSIONS.customersView) ? listCompanyOptions(ctx.supabase, ctx.hotel.id) : Promise.resolve([]),
  ]);
  const editing = canManage ? (sp.edit ? guests.find((g) => g.id === sp.edit) ?? null : sp.new ? null : undefined) : undefined;
  const shown = pageSlice(guests, sp.page);
  const companyName = new Map(companies.map((c) => [c.id, c.label]));

  return (
    <>
      <PageHeader
        title={t.nav.guests}
        description="ملفات النزلاء ببياناتهم وهوياتهم وتاريخ إقامتهم. رقم الهوية لا يتكرر لنزيلين."
        actions={canManage && <Button asChild><Link href="/guests?new=1"><Plus />نزيل جديد</Link></Button>}
      />
      <StatGrid>
        <Stat icon={Users} tone="ink" label="النزلاء" value={<span className="num">{guests.length}</span>} hint={sp.q ? "نتائج البحث" : undefined} />
        <Stat icon={UserRound} tone="teal" label="بهوية مسجّلة" value={<span className="num">{guests.filter((g) => g.id_number).length}</span>} />
        <Stat icon={Users} tone="clay" label="تابعون لشركات" value={<span className="num">{guests.filter((g) => g.customer_id).length}</span>} />
        <Stat icon={Ban} tone="neutral" label="القائمة السوداء" value={<span className="num">{guests.filter((g) => g.is_blacklisted).length}</span>} />
      </StatGrid>

      <form className="mb-5 flex max-w-xl gap-2" action="/guests">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="ابحث بالاسم أو الجوال أو رقم الهوية" className="ps-10" />
        </div>
        <Button type="submit" variant="outline">بحث</Button>
      </form>

      <div className="grid gap-6">
        <div>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow><TableHead>النزيل</TableHead><TableHead>الجوال</TableHead><TableHead>الهوية</TableHead><TableHead>الجنسية</TableHead><TableHead>الشركة</TableHead>{canManage && <TableHead />}</TableRow>
              </TableHeader>
              <TableBody>
                {guests.length === 0 && (
                  <TableRow><TableCell colSpan={6}><EmptyState icon={UserRound} title={sp.q ? "لا يوجد نزيل بهذا البحث" : "لا يوجد نزلاء بعد"}
                    description="يُنشأ النزيل تلقائيًا عند إنشاء حجز له، أو أضفه مباشرة." actionHref={canManage ? "/guests?new=1" : undefined} actionLabel="نزيل جديد" /></TableCell></TableRow>
                )}
                {shown.rows.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="cell-fluid"><EntityCell name={g.full_name} href={`/guests/${g.id}`} sub={g.is_blacklisted ? <span className="text-urgent">القائمة السوداء</span> : g.email ?? undefined} /></TableCell>
                    <TableCell className="num" dir="ltr">{g.phone ?? ""}</TableCell>
                    <TableCell className="whitespace-nowrap">{g.id_number ? <>{ID_TYPES[g.id_type!]} <span className="num">{g.id_number}</span></> : ""}</TableCell>
                    <TableCell>{g.nationality ?? ""}</TableCell>
                    <TableCell>{g.customer_id ? companyName.get(g.customer_id) ?? "" : ""}</TableCell>
                    {canManage && <TableCell className="text-end"><Button asChild variant="ghost" size="sm"><Link href={`/guests?edit=${g.id}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}>{t.common.edit}</Link></Button></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Pager page={shown.page} pages={shown.pages} total={guests.length} basePath="/guests" params={{ q: sp.q }} />
        </div>
        {editing !== undefined && (
          <RouteDialog closeHref={sp.q ? `/guests?q=${encodeURIComponent(sp.q)}` : "/guests"} width="lg" title={<>{editing ? `تعديل ${editing.full_name}` : "نزيل جديد"}</>}>
            {editing?.is_blacklisted && <Badge variant="destructive" className="mb-3">في القائمة السوداء</Badge>}
            <SimpleForm key={editing?.id ?? "new"} columns={2} submitLabel={t.common.save} errors={t.errors} action={saveGuestAction} onDone="/guests"
              initial={guestInitial(editing ?? null)} fields={guestFormFields(companies)} />
          </RouteDialog>
        )}
      </div>
    </>
  );
}

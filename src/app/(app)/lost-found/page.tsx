import { tr } from "@/i18n/tr";
import { Archive, KeyRound, PackageCheck, PackageSearch } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTime, todayInTimeZone } from "@/lib/accounting/fiscal";
import { addDays, dayLabel } from "@/lib/pms/dates";
import { LOST_CATEGORY, LOST_STATUS } from "@/lib/ops/labels";
import { listRooms } from "@/services/pms.service";
import { listLostItems, listSafeDeposits, servicesInHouse } from "@/services/guest-services.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../_assets/simple-form";
import { ActionButton } from "../_pms/action-button";
import { disposeLostItemAction, openSafeDepositAction, registerLostItemAction, returnLostItemAction, returnSafeDepositAction } from "../_services/actions";

type Tab = "stored" | "closed" | "safe" | "safe_done";
/** مدة الحفظ المعتادة قبل جواز الإتلاف أو التبرع */
const KEEP_DAYS = 90;

/**
 * المفقودات وأمانات الخزنة: ما يُعثر عليه في الغرف والمرافق يُسجّل ويُحفظ حتى يُسلّم لصاحبه بهويته
 * أو يُتلف بعد مدة الحفظ، وأمانات النزلاء في صناديق الخزنة تُسلّم وتُستلم بتوقيت ومسؤول.
 */
export default async function LostFoundPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.lostFoundManage);
  const { t } = await getI18n();
  const sp = await searchParams;
  const today = todayInTimeZone(ctx.hotel.timezone);
  const tz = ctx.hotel.timezone;
  const [items, deposits, rooms, inHouse] = await Promise.all([
    listLostItems(ctx.supabase, ctx.hotel.id), listSafeDeposits(ctx.supabase, ctx.hotel.id), listRooms(ctx.supabase, ctx.hotel.id),
    servicesInHouse(ctx.supabase, ctx.hotel.id),
  ]);
  const room = new Map(rooms.map((r) => [r.id, r.room_number]));
  const tab: Tab = sp.tab === "closed" || sp.tab === "safe" || sp.tab === "safe_done" ? sp.tab : "stored";
  const stored = items.filter((i) => i.status === "stored");
  const held = deposits.filter((d) => d.status === "held");
  const overdue = stored.filter((i) => addDays(i.found_date, KEEP_DAYS) <= today);
  const isSafe = tab === "safe" || tab === "safe_done";

  return (
    <>
      <PageHeader title={tr("المفقودات والأمانات")} actions={
        <div className="flex gap-2">
          <FormDialog label={tr("أمانة في الخزنة")} title={tr("استلام أمانة من نزيل")} variant="outline">
            <SimpleForm columns={2} submitLabel={tr("استلام الأمانة")} errors={t.errors} action={openSafeDepositAction}
              initial={{ reservation_id: "", guest_name: "", box_number: "", items: "" }}
              fields={[
                { name: "reservation_id", label: tr("النزيل المقيم"), optional: true, options: inHouse.map((g) => ({ id: g.reservation_id, label: g.room_number ? tr("{0} غرفة {1}", g.guest_name, g.room_number) : g.guest_name })) },
                { name: "guest_name", label: tr("الاسم إن لم يكن مقيمًا") },
                { name: "box_number", label: tr("رقم الصندوق"), ltr: true },
                { name: "items", label: tr("الأغراض المودعة") },
              ]} />
          </FormDialog>
          <FormDialog label={tr("تسجيل مفقود")} title={tr("تسجيل غرض معثور عليه")} width="lg">
            <SimpleForm columns={2} submitLabel={tr("تسجيل")} errors={t.errors} action={registerLostItemAction}
              initial={{ description: "", category: "other", found_date: today, room_id: "", found_location: "", found_by: "", storage_location: "" }}
              fields={[
                { name: "description", label: tr("وصف الغرض") },
                { name: "category", label: tr("التصنيف"), options: Object.entries(LOST_CATEGORY).map(([id, label]) => ({ id, label })) },
                { name: "found_date", label: tr("تاريخ العثور"), type: "date" },
                { name: "room_id", label: tr("الغرفة"), optional: true, options: rooms.map((r) => ({ id: r.id, label: r.room_number })) },
                { name: "found_location", label: tr("المكان إن لم يكن غرفة") },
                { name: "found_by", label: tr("وجده") },
                { name: "storage_location", label: tr("مكان الحفظ") },
              ]} />
          </FormDialog>
        </div>
      } />
      <StatGrid>
        <Stat icon={PackageSearch} tone="ink" label={tr("مفقودات محفوظة")} value={<span className="num">{stored.length}</span>} />
        <Stat icon={Archive} tone="clay" label={tr("تجاوزت مدة الحفظ")} value={<span className="num">{overdue.length}</span>} hint={tr("{0} يومًا", KEEP_DAYS)} />
        <Stat icon={PackageCheck} tone="teal" label={tr("سُلِّمت لأصحابها")} value={<span className="num">{items.filter((i) => i.status === "returned").length}</span>} />
        <Stat icon={KeyRound} tone="neutral" label={tr("أمانات في الخزنة")} value={<span className="num">{held.length}</span>} />
      </StatGrid>

      <Card className="overflow-hidden">
        <CardHeader>
          <FilterTabs active={tab} items={[
            { key: "stored", href: "/lost-found", label: tr("المحفوظة"), count: stored.length },
            { key: "closed", href: "/lost-found?tab=closed", label: tr("المسلّمة والمتلفة") },
            { key: "safe", href: "/lost-found?tab=safe", label: tr("أمانات الخزنة"), count: held.length },
            { key: "safe_done", href: "/lost-found?tab=safe_done", label: tr("أمانات مستلمة") },
          ]} />
        </CardHeader>
        {!isSafe ? (
          <Table>
            <TableHeader>
              <TableRow><TableHead>{tr("الرقم")}</TableHead><TableHead>{tr("الغرض")}</TableHead><TableHead>{tr("أين وُجد")}</TableHead><TableHead>{tr("العثور")}</TableHead><TableHead>{tr("الحالة")}</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {(tab === "stored" ? stored : items.filter((i) => i.status !== "stored")).length === 0 && (
                <TableRow><TableCell colSpan={6}><EmptyState icon={PackageSearch} title={tr("لا توجد مفقودات")} description={tr("سجّل كل ما يُعثر عليه في الغرف والمرافق، ويُسلَّم لصاحبه باسمه ورقم هويته.")} /></TableCell></TableRow>
              )}
              {(tab === "stored" ? stored : items.filter((i) => i.status !== "stored")).map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="whitespace-nowrap num font-medium">{i.item_number}</TableCell>
                  <TableCell className="cell-fluid">
                    <span className="font-medium text-ink">{i.description}</span><Badge variant="outline" className="ms-2">{LOST_CATEGORY[i.category]}</Badge>
                    {i.storage_location && <span className="block text-[14px] text-slate-500">{tr("محفوظ في {0}", i.storage_location)}</span>}
                    {i.status === "returned" && <span className="block text-[14px] text-slate-500">{tr("استلمه {0} بهوية رقم {1}", i.returned_to ?? "", i.returned_id_number ?? "")}</span>}
                    {i.status === "disposed" && i.closed_note && <span className="block text-[14px] text-slate-500">{i.closed_note}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {i.room_id ? <span className="num font-semibold">{room.get(i.room_id)}</span> : i.found_location}
                    {i.found_by && <span className="block text-[14px] text-slate-500">{i.found_by}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600">{dayLabel(i.found_date)}</TableCell>
                  <TableCell>
                    <Badge variant={LOST_STATUS[i.status].variant}>{LOST_STATUS[i.status].label}</Badge>
                    {i.status === "stored" && addDays(i.found_date, KEEP_DAYS) <= today && <Badge variant="secondary" className="ms-2">{tr("تجاوز مدة الحفظ")}</Badge>}
                  </TableCell>
                  <TableCell className="text-end">
                    {i.status === "stored" && (
                      <div className="flex justify-end gap-1">
                        <FormDialog label={tr("تسليم")} title={tr("تسليم {0}", i.description)} variant="outline" size="sm" icon={false}>
                          <SimpleForm columns={2} submitLabel={tr("تسليم لصاحبه")} errors={t.errors} action={returnLostItemAction.bind(null, i.id)}
                            initial={{ returned_to: "", id_number: "", note: "" }}
                            fields={[
                              { name: "returned_to", label: tr("اسم المستلم") }, { name: "id_number", label: tr("رقم الهوية"), ltr: true },
                              { name: "note", label: tr("ملاحظة") },
                            ]} />
                        </FormDialog>
                        <ActionButton variant="ghost" label={tr("إتلاف")} done={tr("سُجِّل الإتلاف")} errors={t.errors} reasonLabel={tr("سبب الإتلاف أو جهة التبرع")}
                          run={disposeLostItemAction.bind(null, i.id)} />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>{tr("الرقم")}</TableHead><TableHead>{tr("الصندوق")}</TableHead><TableHead>{tr("النزيل")}</TableHead><TableHead>{tr("الأغراض")}</TableHead><TableHead>{tr("الإيداع")}</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {(tab === "safe" ? held : deposits.filter((d) => d.status === "returned")).length === 0 && (
                <TableRow><TableCell colSpan={6}><EmptyState icon={KeyRound} title={tr("لا توجد أمانات")} description={tr("أمانات النزلاء في صناديق الخزنة تُسجَّل باستلامها وتسليمها.")} /></TableCell></TableRow>
              )}
              {(tab === "safe" ? held : deposits.filter((d) => d.status === "returned")).map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="whitespace-nowrap num font-medium">{d.deposit_number}</TableCell>
                  <TableCell className="whitespace-nowrap num font-semibold">{d.box_number}</TableCell>
                  <TableCell className="whitespace-nowrap">{d.guest_name}{d.room_number && <span className="block text-[14px] text-slate-500">{tr("غرفة {0}", d.room_number)}</span>}</TableCell>
                  <TableCell className="cell-fluid">{d.items}</TableCell>
                  <TableCell className="whitespace-nowrap num text-slate-600">
                    {formatDateTime(d.deposited_at, tz)}
                    {d.returned_at && <span className="block text-[14px]">{tr("سُلِّمت {0}", formatDateTime(d.returned_at, tz))}</span>}
                  </TableCell>
                  <TableCell className="text-end">
                    {d.status === "held" && (
                      <ActionButton label={tr("تسليم للنزيل")} done={tr("سُلِّمت الأمانة")} errors={t.errors} reasonLabel={tr("ملاحظة التسليم")} reasonRequired={false}
                        run={returnSafeDepositAction.bind(null, d.id)} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}

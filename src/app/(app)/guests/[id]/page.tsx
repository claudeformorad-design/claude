import { FormDialog } from "@/components/ui/dialog";
import { notFound } from "next/navigation";
import Link from "@/components/link";
import { BedDouble, CalendarDays, Plus, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Properties } from "@/components/ui/properties";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ZERO, toMoney } from "@/lib/accounting/money";
import { ID_TYPES, RESERVATION_STATUS } from "@/lib/pms/labels";
import { nightsBetween, timeRange } from "@/lib/pms/dates";
import { getGuest, listCompanyOptions, listReservations } from "@/services/pms.service";
import { getI18n } from "@/i18n/server";
import { SimpleForm } from "../../_assets/simple-form";
import { saveGuestAction } from "../../_pms/actions";
import { guestFormFields, guestInitial } from "../guest-fields";

/** ملف النزيل: بياناته وتاريخ حجوزاته وإجمالي إقاماته */
export default async function GuestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAppContext(PERMISSIONS.pmsView);
  const { locale, t } = await getI18n();
  const guest = await getGuest(ctx.supabase, ctx.hotel.id, id);
  if (!guest) notFound();
  const canManage = ctx.can(PERMISSIONS.pmsManage);
  const [reservations, companies] = await Promise.all([
    listReservations(ctx.supabase, ctx.hotel.id, { guestId: id }),
    ctx.can(PERMISSIONS.customersView) ? listCompanyOptions(ctx.supabase, ctx.hotel.id) : Promise.resolve([]),
  ]);
  const stays = reservations.filter((r) => !["cancelled", "no_show"].includes(r.status));
  const nights = stays.filter((r) => r.booking_mode === "nightly").reduce((a, r) => a + nightsBetween(r.arrival_date, r.departure_date), 0);
  const total = stays.reduce((a, r) => a.plus(toMoney(r.total_amount)), ZERO);

  return (
    <>
      <PageHeader
        title={guest.full_name}
        actions={
          <div className="flex items-center gap-2">
            {guest.is_blacklisted && <Badge variant="destructive">القائمة السوداء: {guest.blacklist_reason}</Badge>}
            {canManage && (
              <FormDialog label="تعديل البيانات" title={`تعديل ${guest.full_name}`} variant="outline" icon={false} width="lg">
                <SimpleForm columns={2} submitLabel={t.common.save} errors={t.errors} action={saveGuestAction} initial={guestInitial(guest)} fields={guestFormFields(companies)} />
              </FormDialog>
            )}
            {canManage && !guest.is_blacklisted && <Button asChild><Link href={`/reservations/new?guest=${guest.id}`}><Plus />حجز لهذا النزيل</Link></Button>}
          </div>
        }
      />
      <Properties items={[
        ["الجوال", guest.phone && <span className="num" dir="ltr">{guest.phone}</span>],
        ["الجنسية", guest.nationality],
        [guest.id_type ? ID_TYPES[guest.id_type] : "الهوية", guest.id_number && <span className="num">{guest.id_number}</span>],
      ]} />
      <StatGrid>
        <Stat icon={CalendarDays} tone="ink" label="الحجوزات" value={<span className="num">{reservations.length}</span>} hint={`${stays.length} فعّال أو منفَّذ`} />
        <Stat icon={BedDouble} tone="teal" label="الليالي" value={<span className="num">{nights}</span>} />
        <Stat currency={ctx.hotel.base_currency} icon={Wallet} tone="clay" label="قيمة الحجوزات" value={<Money value={total} locale={locale} />} />
        <Stat icon={CalendarDays} tone="neutral" label="آخر وصول" value={<span className="num">{stays.at(-1)?.arrival_date ?? ""}</span>} />
      </StatGrid>

      <div className="grid gap-6">
        <Card className="h-fit overflow-hidden">
          <CardHeader><CardTitle>سجل الحجوزات</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>الحجز</TableHead><TableHead>الإقامة</TableHead><TableHead>الغرفة</TableHead><TableHead>الحالة</TableHead><TableHead className="text-end">المبلغ</TableHead></TableRow></TableHeader>
            <TableBody>
              {reservations.length === 0 && <TableRow><TableCell colSpan={5}><EmptyState icon={CalendarDays} title="لا توجد حجوزات لهذا النزيل" /></TableCell></TableRow>}
              {[...reservations].reverse().map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link href={`/reservations/${r.id}`} className="num font-semibold text-ink">{r.confirmation_number}</Link></TableCell>
                  <TableCell>{r.booking_mode === "hourly" ? <span className="num">{`${r.arrival_date} ${timeRange(r.starts_at, r.ends_at)}`}</span> : <>من <span className="num">{r.arrival_date}</span> إلى <span className="num">{r.departure_date}</span></>}</TableCell>
                  <TableCell>{r.room ? <span className="num font-semibold">{r.room.room_number}</span> : <span className="text-slate-500">{r.room_type?.name_ar}</span>}</TableCell>
                  <TableCell><Badge variant={RESERVATION_STATUS[r.status].variant}>{RESERVATION_STATUS[r.status].label}</Badge></TableCell>
                  <TableCell className="text-end font-semibold"><Money value={r.total_amount} locale={locale} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}

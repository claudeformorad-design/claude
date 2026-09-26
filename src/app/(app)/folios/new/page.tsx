import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { getI18n } from "@/i18n/server";
import { OpenFolioForm } from "./open-folio-form";

export default async function NewFolioPage() {
  const ctx = await requireAppContext(PERMISSIONS.folioManage);
  const { locale, t } = await getI18n();
  const [customers, masters] = await Promise.all([
    ctx.supabase.from("customers").select("id, code, name_ar, name_en").eq("hotel_id", ctx.hotel.id).eq("is_active", true).order("code"),
    ctx.supabase.from("guest_folios").select("id, folio_number, guest_name").eq("hotel_id", ctx.hotel.id).eq("status", "open").in("folio_type", ["master", "company"]),
  ]);
  return (
    <>
      <PageHeader title={t.folio.newFolio} />
      <Card><CardContent className="p-5">
        <OpenFolioForm
          t={{ folio: t.folio, common: t.common, errors: t.errors }}
          today={todayInTimeZone(ctx.hotel.timezone)}
          customers={(customers.data ?? []).map((c) => ({ id: c.id, label: `${c.code} — ${(locale === "en" && c.name_en) || c.name_ar}` }))}
          masters={(masters.data ?? []).map((m) => ({ id: m.id, label: `${m.folio_number} — ${m.guest_name}` }))}
        />
      </CardContent></Card>
    </>
  );
}

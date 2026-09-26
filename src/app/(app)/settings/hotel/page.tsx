import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toMoney } from "@/lib/accounting/money";
import { listDepartments } from "@/services/accounts.service";
import { getI18n } from "@/i18n/server";
import { saveDepartmentAction, saveHotelAction } from "../../_admin/actions";
import { SimpleForm } from "../../_assets/simple-form";

export default async function HotelSettingsPage() {
  const ctx = await requireAppContext(PERMISSIONS.accountsView);
  const { locale, t } = await getI18n();
  const h = ctx.hotel;
  const a = t.admin;
  const departments = await listDepartments(ctx.supabase, h.id);
  const amt = (v: string | null) => (v ? toMoney(v).toString() : "");
  return (
    <>
      <PageHeader title={t.nav.hotelSettings} description={a.hotelSubtitle} />
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card><CardHeader><CardTitle>{h.name_ar}</CardTitle></CardHeader><CardContent>
          {ctx.can(PERMISSIONS.hotelManage) ? (
            <SimpleForm columns={2} submitLabel={t.common.save} errors={t.errors} action={saveHotelAction}
              initial={{
                name_ar: h.name_ar, name_en: h.name_en ?? "", legal_name: h.legal_name ?? "", tax_number: h.tax_number ?? "",
                commercial_registration: h.commercial_registration ?? "", address: h.address ?? "", phone: h.phone ?? "", email: h.email ?? "",
                timezone: h.timezone, total_rooms: h.total_rooms?.toString() ?? "",
                journal_approval_threshold: amt(h.journal_approval_threshold), voucher_approval_threshold: amt(h.voucher_approval_threshold),
              }}
              fields={[
                { name: "name_ar", label: t.onboarding.nameAr }, { name: "name_en", label: t.onboarding.nameEn, ltr: true },
                { name: "legal_name", label: a.legalName }, { name: "tax_number", label: a.taxNumber, ltr: true },
                { name: "commercial_registration", label: a.cr, ltr: true }, { name: "phone", label: a.phone, ltr: true },
                { name: "email", label: a.email, ltr: true }, { name: "address", label: a.address },
                { name: "timezone", label: a.timezone, ltr: true }, { name: "total_rooms", label: a.totalRooms, type: "number" },
                { name: "journal_approval_threshold", label: a.journalThreshold, type: "number" },
                { name: "voucher_approval_threshold", label: a.voucherThreshold, type: "number" },
              ]} />
          ) : <p className="text-muted-foreground">{t.errors.permission_denied}</p>}
          <p className="mt-4 text-sm text-muted-foreground">{a.baseCurrency}: <strong className="num">{h.base_currency}</strong></p>
        </CardContent></Card>
        <Card className="overflow-hidden"><CardHeader><CardTitle>{a.departments}</CardTitle></CardHeader>
          <Table>
            <TableHeader><TableRow><TableHead>{t.customers.code}</TableHead><TableHead>{t.customers.name}</TableHead><TableHead>{t.vouchers.type}</TableHead></TableRow></TableHeader>
            <TableBody>
              {departments.map((d) => (
                <TableRow key={d.id}><TableCell className="num">{d.code}</TableCell><TableCell>{(locale === "en" && d.name_en) || d.name_ar}</TableCell>
                  <TableCell><Badge variant="outline">{a.kinds[d.kind]}</Badge></TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
          {ctx.can(PERMISSIONS.departmentsManage) && (
            <CardContent className="border-t pt-4">
              <SimpleForm columns={2} submitLabel={a.addDepartment} errors={t.errors} action={saveDepartmentAction}
                initial={{ code: "", name_ar: "", name_en: "", kind: "revenue_center" }}
                fields={[{ name: "code", label: t.customers.code, ltr: true }, { name: "name_ar", label: t.customers.name },
                  { name: "name_en", label: `${t.customers.name} (EN)`, ltr: true },
                  { name: "kind", label: t.vouchers.type, options: (["revenue_center", "cost_center", "service_center"] as const).map((k) => ({ id: k, label: a.kinds[k] })) }]} />
            </CardContent>
          )}
        </Card>
      </div>
    </>
  );
}

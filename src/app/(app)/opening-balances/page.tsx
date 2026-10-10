import { tr } from "@/i18n/tr";
import { localName } from "@/lib/local-name";
import Link from "@/components/link";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/accounting/fiscal";
import { listAccounts } from "@/services/accounts.service";
import { listCustomers } from "@/services/customers.service";
import { listVendors } from "@/services/payables.service";
import { getI18n } from "@/i18n/server";
import { OpeningForm } from "./opening-form";

const CONTROL_KEYS = new Set(["guest_ledger", "guest_deposits", "ar_control", "ap_control", "employee_advances"]);

/**
 * الأرصدة الافتتاحية عند بدء استخدام النظام: تُرحَّل مرة واحدة بقيد افتتاحي، وأرصدة العملاء
 * والموردين تصبح فواتير مفتوحة تُحصَّل وتُسدَّد بالطريقة المعتادة، والدفاتر الفرعية تبقى مطابقة للأستاذ.
 */
export default async function OpeningBalancesPage() {
  const ctx = await requireAppContext(PERMISSIONS.hotelManage);
  const { t } = await getI18n();
  const { data: posted } = await ctx.supabase.from("journal_entries").select("id, entry_number, entry_date")
    .eq("hotel_id", ctx.hotel.id).eq("source", "opening").eq("status", "posted").limit(1).maybeSingle();

  if (posted) {
    return (
      <>
        <PageHeader title={tr("الأرصدة الافتتاحية")} />
        <Card className="max-w-2xl">
          <CardHeader><CardTitle><CheckCircle2 className="size-5 text-success" />{tr("رُحّلت الأرصدة الافتتاحية")}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-[16px] text-slate-700">
            <p>{tr("بتاريخ")}{" "}<span className="num">{posted.entry_date}</span>{" "}{tr("بالقيد")}{" "}<span className="num font-semibold">{posted.entry_number}</span>{tr(". لأي تصحيح استخدم قيد تسوية.")}</p>
            <Button asChild variant="outline"><Link href={`/journal/${posted.id}`}>{tr("عرض القيد")}</Link></Button>
          </CardContent>
        </Card>
      </>
    );
  }

  const [accounts, customers, vendors] = await Promise.all([
    listAccounts(ctx.supabase, ctx.hotel.id), listCustomers(ctx.supabase, ctx.hotel.id), listVendors(ctx.supabase, ctx.hotel.id),
  ]);
  return (
    <>
      <PageHeader title={tr("الأرصدة الافتتاحية")} />
      <OpeningForm today={todayInTimeZone(ctx.hotel.timezone)} errors={t.errors}
        accounts={accounts.filter((a) => a.is_postable && a.is_active && !CONTROL_KEYS.has(a.system_key ?? "")).map((a) => ({ id: a.id, label: `${a.code} ${localName(a)}` }))}
        customers={customers.filter((c) => c.is_active).map((c) => ({ id: c.id, label: `${localName(c)} ${c.code}` }))}
        vendors={vendors.filter((v) => v.is_active).map((v) => ({ id: v.id, label: `${localName(v)} ${v.code}` }))} />
    </>
  );
}

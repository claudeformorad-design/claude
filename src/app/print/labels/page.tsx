import { tr } from "@/i18n/tr";
import { requireAppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { toMoney } from "@/lib/accounting/money";
import { barcodeSvg } from "@/lib/barcode";
import { raise } from "@/services/errors";
import { getI18n } from "@/i18n/server";
import { PrintToolbar } from "../reports/[report]/print-toolbar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** ملصقات الباركود للأصناف: اسم الصنف وسعره والباركود، بعدد النسخ المطلوب */
export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ items?: string; copies?: string; price?: string }> }) {
  const ctx = await requireAppContext(PERMISSIONS.inventoryView);
  const { locale } = await getI18n();
  const sp = await searchParams;
  const ids = (sp.items ?? "").split(",").filter((x) => UUID.test(x)).slice(0, 200);
  const copies = Math.min(Math.max(Number.parseInt(sp.copies ?? "1", 10) || 1, 1), 50);
  let q = ctx.supabase.from("inventory_items").select("id, sku, name_ar, name_en, barcode, sale_price::text").eq("hotel_id", ctx.hotel.id).order("sku");
  if (ids.length) q = q.in("id", ids);
  const { data, error } = await q;
  raise(error);
  const labels = (data ?? []).filter((x) => x.barcode).flatMap((x) => Array.from({ length: copies }, () => x));
  return (
    <div className="min-h-screen bg-[#f1f0ec] py-10 print:bg-white print:py-0">
      <title>{tr("ملصقات الباركود")}</title>
      <style>{"@page { size: A4; margin: 8mm } .label svg { width: 100%; height: auto }"}</style>
      <PrintToolbar />
      <div className="mx-auto grid max-w-[210mm] grid-cols-3 gap-2 bg-white p-4 print:p-0">
        {labels.length === 0 && <p className="col-span-3 p-6 text-center text-slate-500">{tr("لا أصناف لها باركود. ولّد الباركود من شاشة المخزون أولًا.")}</p>}
        {labels.map((x, i) => (
          <div key={`${x.id}-${i}`} className="label flex h-[34mm] flex-col items-center justify-between overflow-hidden rounded border border-dashed border-slate-300 p-1.5 text-center break-inside-avoid">
            <p className="w-full truncate text-[11px] font-semibold">{(locale === "en" && x.name_en) || x.name_ar}</p>
            <div className="w-[48mm]" dangerouslySetInnerHTML={{ __html: barcodeSvg(x.barcode!) }} />
            {sp.price !== "0" && x.sale_price && <p className="num text-[11px] font-bold">{toMoney(x.sale_price).toFixed(2)} {ctx.hotel.base_currency}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

import "server-only";
import QRCode from "qrcode";
import type { HotelRow } from "@/lib/supabase/database.types";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import { toMoney } from "@/lib/accounting/money";
import { zatcaQrBase64, zatcaTimestamp, zatcaUblXml } from "@/lib/zatca";
import { raise } from "./errors";

export interface ZatcaRecord {
  doc_kind: "invoice" | "credit_note";
  doc_id: string;
  doc_number: string;
  icv: number;
  uuid: string;
  invoice_type: "standard" | "simplified";
  seller_vat: string;
  buyer_vat: string | null;
  issued_at: string;
  total: string;
  tax_total: string;
  pih: string;
  hash: string;
}

const COLS = "doc_kind, doc_id, doc_number, icv, uuid, invoice_type, seller_vat, buyer_vat, issued_at, total::text, tax_total::text, pih, hash";

export async function zatcaRecord(supabase: SupabaseServerClient, hotelId: string, docId: string): Promise<ZatcaRecord | null> {
  const { data, error } = await supabase.from("zatca_documents").select(COLS).eq("hotel_id", hotelId).eq("doc_id", docId).maybeSingle();
  raise(error);
  return (data as unknown as ZatcaRecord) ?? null;
}

export async function zatcaRecords(supabase: SupabaseServerClient, hotelId: string, docIds: string[]): Promise<Map<string, ZatcaRecord>> {
  if (!docIds.length) return new Map();
  const { data, error } = await supabase.from("zatca_documents").select(COLS).eq("hotel_id", hotelId).in("doc_id", docIds);
  raise(error);
  return new Map(((data ?? []) as unknown as ZatcaRecord[]).map((r) => [r.doc_id, r]));
}

/** اسم البائع في رمز QR: الاسم القانوني المسجل، وإلا اسم الفندق */
export const sellerName = (hotel: Pick<HotelRow, "legal_name" | "name_ar">) => (hotel.legal_name?.trim() || hotel.name_ar).slice(0, 120);

export function qrText(hotel: Pick<HotelRow, "legal_name" | "name_ar">, r: ZatcaRecord): string {
  return zatcaQrBase64({
    sellerName: sellerName(hotel),
    vatNumber: r.seller_vat,
    timestamp: zatcaTimestamp(r.issued_at),
    total: toMoney(r.total).toFixed(2),
    vatTotal: toMoney(r.tax_total).toFixed(2),
  });
}

/** رمز QR كصورة SVG جاهزة للعرض والطباعة */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1f1d1b", light: "#ffffff" } });
}

/** ملف UBL للفاتورة أو الإشعار الدائن */
export async function documentXml(supabase: SupabaseServerClient, hotel: HotelRow, docId: string): Promise<{ xml: string; number: string } | null> {
  const r = await zatcaRecord(supabase, hotel.id, docId);
  if (!r) return null;
  const invoiceId = r.doc_kind === "invoice" ? r.doc_id
    : (await supabase.from("credit_notes").select("invoice_id").eq("id", r.doc_id).maybeSingle()).data?.invoice_id;
  if (!invoiceId) return null;
  const [inv, items, rates, note] = await Promise.all([
    supabase.from("invoices").select("invoice_number, bill_to_name, bill_to_tax_number, bill_to_address, currency_code, subtotal::text, tax_total::text, total::text").eq("id", invoiceId).maybeSingle(),
    supabase.from("invoice_items").select("line_no, description, quantity::text, net_amount::text, tax_amount::text").eq("invoice_id", invoiceId).order("line_no"),
    supabase.from("invoice_taxes").select("taxable_base::text, amount::text").eq("invoice_id", invoiceId),
    r.doc_kind === "credit_note"
      ? supabase.from("credit_notes").select("net_amount::text, tax_amount::text, total::text, reason").eq("id", r.doc_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  raise(inv.error); raise(items.error); raise(rates.error);
  if (!inv.data) return null;
  const base = (rates.data ?? []).reduce((n, x) => n.plus(toMoney(x.taxable_base)), toMoney("0"));
  const tax = (rates.data ?? []).reduce((n, x) => n.plus(toMoney(x.amount)), toMoney("0"));
  const pct = base.isZero() ? "0" : tax.div(base).times(100).toFixed(2);
  const cn = note.data as { net_amount: string; tax_amount: string; total: string; reason: string } | null;
  const lines = cn
    ? [{ id: 1, name: cn.reason, quantity: "1", net: cn.net_amount, tax: cn.tax_amount, taxPercent: pct }]
    : (items.data ?? []).map((l) => {
      const net = toMoney(l.net_amount);
      return { id: l.line_no, name: l.description, quantity: toMoney(l.quantity).toString(), net: l.net_amount, tax: l.tax_amount,
        taxPercent: net.isZero() ? "0" : toMoney(l.tax_amount).div(net).times(100).toFixed(2) };
    });
  const xml = zatcaUblXml({
    kind: r.doc_kind, number: r.doc_number, uuid: r.uuid, icv: r.icv, pih: r.pih, invoiceType: r.invoice_type, issuedAt: r.issued_at,
    currency: inv.data.currency_code,
    seller: { name: sellerName(hotel), vat: r.seller_vat, crn: hotel.commercial_registration, address: hotel.address, country: hotel.country_code },
    buyer: { name: inv.data.bill_to_name, vat: r.buyer_vat, address: inv.data.bill_to_address },
    lines,
    subtotal: cn ? cn.net_amount : inv.data.subtotal,
    taxTotal: cn ? cn.tax_amount : inv.data.tax_total,
    total: cn ? cn.total : inv.data.total,
    qr: qrText(hotel, r),
    billingReference: cn ? inv.data.invoice_number : undefined,
    reason: cn?.reason,
  });
  return { xml, number: r.doc_number };
}

/** فحص سلامة سلسلة البصمات والعدّاد: أول خلل إن وُجد */
export async function verifyChain(supabase: SupabaseServerClient, hotelId: string): Promise<{ ok: boolean; problems: { icv: number; doc_number: string; problem: string }[] }> {
  const { data, error } = await supabase.rpc("zatca_verify_chain", { p_hotel_id: hotelId });
  raise(error);
  const problems = (data ?? []) as { icv: number; doc_number: string; problem: string }[];
  return { ok: problems.length === 0, problems };
}

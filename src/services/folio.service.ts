import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { FolioTransactionRow, GuestFolioRow } from "@/lib/supabase/database.types";
import type { FolioAction, OpenFolioInput } from "@/lib/validation/revenue";
import { openFolioSchema } from "@/lib/validation/revenue";
import { toMoney } from "@/lib/accounting/money";
import { raise } from "./errors";
import { searchTerm } from "@/lib/search-term";

const TXN_COLUMNS =
  "id, hotel_id, folio_id, txn_type, direction, business_date, charge_code_id, payment_method_id, department_id, customer_id, description, reference, quantity::text, unit_price::text, net_amount::text, tax_amount::text, total_amount::text, ledger_effect::text, deposit_effect::text, related_transaction_id, counter_folio_id, voided_by_id, journal_entry_id, created_at, created_by";

export type FolioSummary = GuestFolioRow & { balance: string; deposit_balance: string };

export async function listFolios(
  supabase: SupabaseServerClient,
  hotelId: string,
  filters: { status?: string; q?: string } = {},
): Promise<FolioSummary[]> {
  let query = supabase.from("guest_folios").select("*").eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(300);
  if (filters.status === "open" || filters.status === "closed" || filters.status === "cancelled") query = query.eq("status", filters.status);
  if (filters.q) {
    const s = searchTerm(filters.q);
    if (s) query = query.or(`guest_name.ilike.%${s}%,folio_number.ilike.%${s}%,room_number.ilike.%${s}%`);
  }
  const { data, error } = await query;
  raise(error);
  const folios = data ?? [];
  if (!folios.length) return [];
  const { data: bal, error: e2 } = await supabase
    .from("folio_balances")
    .select("folio_id, balance::text, deposit_balance::text")
    .in("folio_id", folios.map((f) => f.id));
  raise(e2);
  const byId = new Map((bal ?? []).map((b) => [b.folio_id, b]));
  return folios.map((f) => ({ ...f, balance: byId.get(f.id)?.balance ?? "0", deposit_balance: byId.get(f.id)?.deposit_balance ?? "0" }));
}

export interface FolioDetail {
  folio: GuestFolioRow;
  transactions: FolioTransactionRow[];
  balance: string;
  deposits: string;
  invoiceId: string | null;
}

export async function getFolio(supabase: SupabaseServerClient, hotelId: string, id: string): Promise<FolioDetail | null> {
  const { data: folio, error } = await supabase.from("guest_folios").select("*").eq("hotel_id", hotelId).eq("id", id).maybeSingle();
  raise(error);
  if (!folio) return null;
  const [txns, bal, inv] = await Promise.all([
    supabase.from("folio_transactions").select(TXN_COLUMNS).eq("folio_id", id).order("created_at"),
    supabase.from("folio_balances").select("balance::text, deposit_balance::text").eq("folio_id", id).maybeSingle(),
    supabase.from("invoices").select("id").eq("folio_id", id).maybeSingle(),
  ]);
  raise(txns.error);
  return {
    folio,
    transactions: (txns.data ?? []) as unknown as FolioTransactionRow[],
    balance: bal.data?.balance ?? "0",
    deposits: bal.data?.deposit_balance ?? "0",
    invoiceId: inv.data?.id ?? null,
  };
}

export async function openFolio(supabase: SupabaseServerClient, hotelId: string, input: OpenFolioInput): Promise<string> {
  const v = openFolioSchema.parse(input);
  const { data, error } = await supabase.rpc("open_folio", {
    p_hotel_id: hotelId,
    p_guest_name: v.guest_name,
    p_folio_type: v.folio_type,
    p_customer_id: v.customer_id,
    p_room_number: v.room_number,
    p_reservation_ref: v.reservation_ref,
    p_arrival_date: v.arrival_date,
    p_departure_date: v.departure_date,
    p_adults: v.adults,
    p_master_folio_id: v.master_folio_id,
    p_notes: v.notes,
  });
  raise(error);
  return data!;
}

const fixed = (v: string) => toMoney(v).toFixed();

/** تنفيذ إجراء على الفوليو عبر دالة RPC المناسبة (كل القواعد مفروضة في قاعدة البيانات) */
export async function runFolioAction(supabase: SupabaseServerClient, folioId: string, a: FolioAction): Promise<void> {
  let result: { error: { message: string } | null };
  // طريقة دفع بعملة أجنبية: المبلغ المُدخل بعملتها ويُحوَّل بسعر اليوم
  if (a.kind === "payment" || a.kind === "deposit" || a.kind === "refund" || a.kind === "depositRefund") {
    const { data: m } = await supabase.from("payment_methods").select("currency_code").eq("id", a.payment_method_id).maybeSingle();
    if ((m as { currency_code: string | null } | null)?.currency_code) {
      result = await supabase.rpc("post_folio_foreign_money", {
        p_folio_id: folioId, p_txn_type: a.kind === "depositRefund" ? "deposit_refund" : a.kind, p_payment_method_id: a.payment_method_id,
        p_foreign_amount: fixed(a.amount), p_reference: a.reference,
      });
      raise(result.error);
      return;
    }
  }
  switch (a.kind) {
    case "charge":
      result = await supabase.rpc("post_folio_charge", {
        p_folio_id: folioId, p_charge_code_id: a.charge_code_id, p_unit_price: fixed(a.unit_price),
        p_quantity: fixed(a.quantity), p_description: a.description, p_reference: a.reference,
      });
      break;
    case "payment":
      result = await supabase.rpc("post_folio_payment", {
        p_folio_id: folioId, p_payment_method_id: a.payment_method_id, p_amount: fixed(a.amount),
        p_reference: a.reference, p_customer_id: a.customer_id,
      });
      break;
    case "deposit":
    case "refund":
    case "depositRefund": {
      const fn = a.kind === "deposit" ? "post_folio_deposit" : a.kind === "refund" ? "post_folio_refund" : "refund_folio_deposit";
      result = await supabase.rpc(fn, {
        p_folio_id: folioId, p_payment_method_id: a.payment_method_id, p_amount: fixed(a.amount), p_reference: a.reference,
      });
      break;
    }
    case "allowance":
      result = await supabase.rpc("post_folio_allowance", {
        p_folio_id: folioId, p_charge_txn_id: a.charge_txn_id, p_amount: fixed(a.amount), p_reason: a.reason,
      });
      break;
    case "transfer":
      result = await supabase.rpc("transfer_folio_balance", {
        p_from_folio_id: folioId, p_to_folio_id: a.to_folio_id, p_amount: fixed(a.amount), p_description: a.description,
      });
      break;
    case "void":
      result = await supabase.rpc("void_folio_transaction", { p_txn_id: a.txn_id, p_reason: a.reason });
      break;
  }
  raise(result.error);
}

export async function checkoutFolio(supabase: SupabaseServerClient, folioId: string): Promise<string> {
  const { data, error } = await supabase.rpc("checkout_folio", { p_folio_id: folioId });
  raise(error);
  return data!;
}

export async function cancelFolio(supabase: SupabaseServerClient, folioId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_folio", { p_folio_id: folioId });
  raise(error);
}

import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";
import type { JournalEntryLineRow, JournalEntryRow, JournalStatus } from "@/lib/supabase/database.types";
import type { JournalEntryFormValues } from "@/lib/validation/journal-entry";
import { isBlankLine } from "@/lib/accounting/journal";
import { toMoney } from "@/lib/accounting/money";
import { raise, ServiceError } from "./errors";

const ENTRY_COLUMNS =
  "id, hotel_id, entry_number, entry_date, period_id, description, reference, source, source_id, currency_code, exchange_rate::text, status, posted_at, posted_by, reversal_of_id, reversed_by_id, created_at, created_by, updated_at, updated_by";

const LINE_COLUMNS =
  "id, journal_entry_id, hotel_id, line_no, account_id, department_id, description, debit::text, credit::text, base_debit::text, base_credit::text, created_at";

export type JournalEntrySummary = JournalEntryRow & { total_debit: string; line_count: number };

export interface JournalListFilters {
  status?: JournalStatus;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
}

export async function listJournalEntries(
  supabase: SupabaseServerClient,
  hotelId: string,
  filters: JournalListFilters = {},
): Promise<JournalEntrySummary[]> {
  let query = supabase
    .from("journal_entries")
    .select(ENTRY_COLUMNS)
    .eq("hotel_id", hotelId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.from) query = query.gte("entry_date", filters.from);
  if (filters.to) query = query.lte("entry_date", filters.to);
  if (filters.search) {
    const s = filters.search.replace(/[%,()]/g, " ").trim();
    if (s) query = query.or(`description.ilike.%${s}%,entry_number.ilike.%${s}%,reference.ilike.%${s}%`);
  }

  const { data, error } = await query;
  raise(error);
  const entries = (data ?? []) as unknown as JournalEntryRow[];
  if (entries.length === 0) return [];

  const { data: totals, error: totalsError } = await supabase
    .from("journal_entry_totals")
    .select("journal_entry_id, line_count, total_debit::text")
    .in("journal_entry_id", entries.map((e) => e.id));
  raise(totalsError);
  const byId = new Map((totals ?? []).map((t) => [t.journal_entry_id, t]));

  return entries.map((e) => ({
    ...e,
    total_debit: byId.get(e.id)?.total_debit ?? "0",
    line_count: byId.get(e.id)?.line_count ?? 0,
  }));
}

export interface JournalEntryDetail {
  entry: JournalEntryRow;
  lines: JournalEntryLineRow[];
  related: Record<string, Pick<JournalEntryRow, "id" | "entry_number">>;
  users: Record<string, string>;
  periodName: string | null;
}

export async function getJournalEntry(
  supabase: SupabaseServerClient,
  hotelId: string,
  id: string,
): Promise<JournalEntryDetail | null> {
  const { data: entryData, error } = await supabase
    .from("journal_entries")
    .select(ENTRY_COLUMNS)
    .eq("hotel_id", hotelId)
    .eq("id", id)
    .maybeSingle();
  raise(error);
  if (!entryData) return null;
  const entry = entryData as unknown as JournalEntryRow;

  const relatedIds = [entry.reversal_of_id, entry.reversed_by_id].filter((x): x is string => !!x);
  const userIds = [entry.created_by, entry.posted_by].filter((x): x is string => !!x);

  const [lines, related, users, period] = await Promise.all([
    supabase.from("journal_entry_lines").select(LINE_COLUMNS).eq("journal_entry_id", id).order("line_no"),
    relatedIds.length
      ? supabase.from("journal_entries").select("id, entry_number").in("id", relatedIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase.from("users_profiles").select("id, full_name, email").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("accounting_periods").select("name").eq("id", entry.period_id).maybeSingle(),
  ]);
  raise(lines.error);

  return {
    entry,
    lines: (lines.data ?? []) as unknown as JournalEntryLineRow[],
    related: Object.fromEntries((related.data ?? []).map((r) => [r.id, r])),
    users: Object.fromEntries((users.data ?? []).map((u) => [u.id, u.full_name || u.email || u.id])),
    periodName: period.data?.name ?? null,
  };
}

/** حفظ قيد يدوي (مسودة أو ترحيل مباشر) عبر RPC ذرّية في قاعدة البيانات */
export async function saveJournalEntry(
  supabase: SupabaseServerClient,
  hotelId: string,
  values: JournalEntryFormValues,
  options: { entryId?: string; post: boolean },
): Promise<string> {
  const lines = values.lines
    .filter((l) => !isBlankLine(l))
    .map((l) => ({
      account_id: l.account_id,
      department_id: l.department_id || null,
      description: l.description || null,
      // نرسل المبالغ كنصوص عشرية دقيقة (وليس float)
      debit: toMoney(l.debit).toFixed(),
      credit: toMoney(l.credit).toFixed(),
    }));

  const { data, error } = await supabase.rpc("save_journal_entry", {
    p_hotel_id: hotelId,
    p_entry_date: values.entry_date,
    p_description: values.description,
    p_lines: lines,
    p_reference: values.reference || null,
    p_currency_code: values.currency_code,
    p_exchange_rate: toMoney(values.exchange_rate).toFixed(),
    p_entry_id: options.entryId ?? null,
    p_post: options.post,
  });
  raise(error);
  return data!;
}

export async function postJournalEntry(supabase: SupabaseServerClient, entryId: string): Promise<string> {
  const { data, error } = await supabase.rpc("post_journal_entry", { p_entry_id: entryId });
  raise(error);
  return data!;
}

export async function reverseJournalEntry(
  supabase: SupabaseServerClient,
  entryId: string,
  reversalDate: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc("reverse_journal_entry", {
    p_entry_id: entryId,
    p_reversal_date: reversalDate,
  });
  raise(error);
  return data!;
}

export async function deleteDraftJournalEntry(
  supabase: SupabaseServerClient,
  hotelId: string,
  entryId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("journal_entries")
    .delete()
    .eq("hotel_id", hotelId)
    .eq("id", entryId)
    .eq("status", "draft")
    .select("id");
  raise(error);
  if (!data?.length) throw new ServiceError("posted_immutable", "Draft not found or not deletable");
}

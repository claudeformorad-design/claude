import "server-only";
import { createClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseEnv } from "./env";
import { ownerTransaction } from "./local-db";

/**
 * استدعاء دالة متاحة للزائر بلا تسجيل دخول (دور anon) مثل استبيان النزيل برمزه.
 * محليًا: معاملة بدور anon فتسري نفس الصلاحيات الممنوحة في قاعدة البيانات، ومع Supabase: عميل بالمفتاح العام بلا جلسة.
 */
export async function anonRpc<T = unknown>(fn: "survey_info" | "submit_guest_survey" | "system_has_owner" | "claim_owner" | "redeem_access_link", args: Record<string, unknown>): Promise<{ data: T | null; error: { message: string } | null }> {
  if (isSupabaseConfigured()) {
    const { url, anonKey } = supabaseEnv();
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc(fn, args);
    return { data: (data ?? null) as T | null, error: error ? { message: error.message } : null };
  }
  const names = Object.keys(args);
  const sql = `select * from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
  try {
    const rows = await ownerTransaction(async (tx) => {
      await tx.query("select set_config('role', 'anon', true)");
      return (await tx.query(sql, names.map((n) => args[n]))).rows;
    });
    return { data: rows as T, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

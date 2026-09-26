// اختبار أمني/وظيفي عبر الواجهة البرمجية الحقيقية (GoTrue + PostgREST) — مستخدمان في فندقين مختلفين
// التشغيل: SUPABASE_URL=... ANON_KEY=... node e2e/api-security.mjs
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const KEY = process.env.ANON_KEY;
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
const client = () => createClient(URL, KEY, { auth: { persistSession: false } });

async function user(email) {
  const c = client();
  const { error } = await c.auth.signUp({ email, password: "Passw0rd!123", options: { data: { full_name: email.split("@")[0] } } });
  if (error && !/already/.test(error.message)) throw error;
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: "Passw0rd!123" });
  if (e2) throw e2;
  return c;
}

const stamp = Date.now();
const A = await user(`owner-a-${stamp}@test.dev`);
const B = await user(`owner-b-${stamp}@test.dev`);
const anon = client();

// كل مستخدم ينشئ فندقه
const { data: hA, error: eA } = await A.rpc("create_hotel", { p_name_ar: "فندق أ", p_country_code: "SA", p_base_currency: "SAR" });
const { data: hB } = await B.rpc("create_hotel", { p_name_ar: "فندق ب", p_country_code: "AE", p_base_currency: "AED" });
check("create_hotel via API", !!hA && !eA, eA?.message);

// الفندق أ: فوليو برسوم ودفعة
const acc = async (c, h, code) => (await c.from("chart_of_accounts").select("id").eq("hotel_id", h).eq("code", code).single()).data.id;
const cc = async (c, h, code) => (await c.from("charge_codes").select("id").eq("hotel_id", h).eq("code", code).single()).data.id;
const pm = async (c, h, code) => (await c.from("payment_methods").select("id").eq("hotel_id", h).eq("code", code).single()).data.id;
const { data: folioA, error: ef } = await A.rpc("open_folio", { p_hotel_id: hA, p_guest_name: "نزيل أ" });
check("open_folio", !!folioA, ef?.message);
const { error: ec } = await A.rpc("post_folio_charge", { p_folio_id: folioA, p_charge_code_id: await cc(A, hA, "ROOM"), p_unit_price: "450.00", p_quantity: "2" });
check("post_folio_charge", !ec, ec?.message);

// ---------- هجمات من المستخدم ب على الفندق أ ----------
const probes = [
  ["B reads A hotels", async () => (await B.from("hotels").select("id").eq("id", hA)).data?.length === 0],
  ["B reads A folios", async () => (await B.from("guest_folios").select("id").eq("hotel_id", hA)).data?.length === 0],
  ["B reads A journal", async () => (await B.from("journal_entries").select("id").eq("hotel_id", hA)).data?.length === 0],
  ["B reads A accounts", async () => (await B.from("chart_of_accounts").select("id").eq("hotel_id", hA)).data?.length === 0],
  ["B reads A audit log", async () => (await B.from("audit_logs").select("id").eq("hotel_id", hA)).data?.length === 0],
  ["B posts charge on A folio", async () => !!(await B.rpc("post_folio_charge", { p_folio_id: folioA, p_charge_code_id: await cc(B, hB, "ROOM"), p_unit_price: "1" })).error],
  ["B pays A folio", async () => !!(await B.rpc("post_folio_payment", { p_folio_id: folioA, p_payment_method_id: await pm(B, hB, "CASH"), p_amount: "1" })).error],
  ["B checks out A folio", async () => !!(await B.rpc("checkout_folio", { p_folio_id: folioA })).error],
  ["B journal into A hotel", async () => !!(await B.rpc("save_journal_entry", { p_hotel_id: hA, p_entry_date: new Date().toISOString().slice(0, 10), p_description: "x", p_lines: [] })).error],
  ["B uses A account in own entry", async () => !!(await B.rpc("save_journal_entry", {
    p_hotel_id: hB, p_entry_date: new Date().toISOString().slice(0, 10), p_description: "cross",
    p_lines: [{ account_id: await acc(A, hA, "1101"), debit: "5" }, { account_id: await acc(B, hB, "3101"), credit: "5" }] })).error],
  ["B adds itself to A hotel", async () => !!(await B.from("hotel_members").insert({ hotel_id: hA, user_id: (await B.auth.getUser()).data.user.id })).error],
  ["B grants itself GM in A", async () => !!(await B.from("user_hotel_roles").insert({ hotel_id: hA, user_id: (await B.auth.getUser()).data.user.id,
    role_id: (await B.from("roles").select("id").eq("code", "general_manager").single()).data.id })).error],
  ["B reads A trial balance data", async () => !!(await B.rpc("gl_account_activity", { p_hotel_id: hA, p_fiscal_year_start: "2026-01-01", p_from: "2026-01-01", p_to: "2026-12-31" })).error],
  ["B aging of A", async () => !!(await B.rpc("aging_report", { p_hotel_id: hA, p_kind: "receivable" })).error],
  ["B lists A members", async () => !!(await B.rpc("hotel_members_overview", { p_hotel_id: hA })).error],
  ["B adds member to A", async () => !!(await B.rpc("add_hotel_member", { p_hotel_id: hA, p_email: "x@y.z", p_role_ids: [] })).error],
  ["B tax return of A", async () => !!(await B.rpc("tax_return", { p_hotel_id: hA, p_from: "2026-01-01", p_to: "2026-12-31" })).error],
  ["B cash report of A", async () => !!(await B.rpc("daily_cash_report", { p_hotel_id: hA, p_date: "2026-09-26" })).error],
  ["B updates A hotel", async () => { await B.from("hotels").update({ name_ar: "hacked" }).eq("id", hA); return (await A.from("hotels").select("name_ar").eq("id", hA).single()).data.name_ar === "فندق أ"; }],
  // مجهول الهوية
  ["anon reads hotels", async () => ((await anon.from("hotels").select("id")).data ?? []).length === 0],
  ["anon create_hotel", async () => !!(await anon.rpc("create_hotel", { p_name_ar: "x", p_country_code: "SA", p_base_currency: "SAR" })).error],
  ["anon open_folio", async () => !!(await anon.rpc("open_folio", { p_hotel_id: hA, p_guest_name: "x" })).error],
  ["anon reads users_profiles", async () => ((await anon.from("users_profiles").select("id")).data ?? []).length === 0],
  // سلامة البيانات من المالك نفسه
  ["A cannot edit posted entry", async () => { const j = (await A.from("journal_entries").select("id").eq("hotel_id", hA).eq("status", "posted").limit(1).single()).data;
    return !!(await A.from("journal_entries").update({ description: "tamper" }).eq("id", j.id)).error; }],
  ["A cannot delete folio txn", async () => { await A.from("folio_transactions").delete().eq("folio_id", folioA);
    return (await A.from("folio_transactions").select("id").eq("folio_id", folioA)).data.length === 1; }],
  ["A cannot insert invoice directly", async () => !!(await A.from("invoices").insert({ hotel_id: hA })).error],
  ["A cannot fake created_by", async () => { const other = (await B.auth.getUser()).data.user.id;
    const { data } = await A.rpc("save_journal_entry", { p_hotel_id: hA, p_entry_date: new Date().toISOString().slice(0, 10), p_description: "d",
      p_lines: [{ account_id: await acc(A, hA, "1101"), debit: "1" }, { account_id: await acc(A, hA, "3101"), credit: "1" }] });
    await A.from("journal_entries").update({ created_by: other }).eq("id", data);
    return (await A.from("journal_entries").select("created_by").eq("id", data).single()).data.created_by !== other; }],
];
for (const [name, fn] of probes) {
  try { check(name, await fn()); } catch (e) { check(name, false, String(e.message ?? e)); }
}

// الأرقام تُقرأ نصًا بدقة
const { data: tx } = await A.from("folio_transactions").select("total_amount::text").eq("folio_id", folioA).single();
check("numeric precision via API", tx.total_amount === "900.0000", tx.total_amount);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

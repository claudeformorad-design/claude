// اختبار أدوات المساعد كلها على بيانات حقيقية: نموذج محاكي محلي يستدعي كل أداة يعرضها الخادم،
// ثم يجلب تفاصيل أول نتيجة من كل بحث، ثم يكتب إجابة فيها رسم بياني ورابط لسجل حقيقي.
// شغّل الخادم أولًا: GEMINI_API_KEY=test AI_BASE_URL=http://127.0.0.1:3399 npm start
// ثم: BASE_URL=http://127.0.0.1:3000 LOCAL=1 node e2e/ui-assistant-tools.mjs
import http from "node:http";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp";
const problems = [];

const iso = (d) => d.toISOString().slice(0, 10);
const plus = (n) => iso(new Date(Date.now() + n * 86_400_000));

/** معطيات كل أداة: قائمة استدعاءات لتغطية كل أنواعها */
function plan(tool) {
  const p = tool.function.parameters?.properties ?? {};
  const name = tool.function.name;
  switch (name) {
    case "system_guide": return [{ id: p.id.enum[0] }];
    case "run_report": return p.report.enum.map((report) => ({ report }));
    case "search_records": return p.kind.enum.map((kind) => ({ kind, query: "" }));
    case "hotel_search": return [{ kind: "reservation", query: "" }, { kind: "guest", query: "" }];
    case "top_accounts": return [{ kind: "revenue", from: plus(-180) }, { kind: "expense", from: plus(-180) }];
    case "aging_summary": return [{ kind: "receivable" }, { kind: "payable" }];
    case "monthly_trend": return [{ months: 6 }];
    case "compare_periods": return [{}, { from: plus(-60), to: plus(-31), compare_from: plus(-120), compare_to: plus(-91) }];
    case "availability_quote": return [{ arrival: plus(3), departure: plus(6) }, {}];
    case "occupancy_forecast": return [{ days: 30 }, {}];
    case "pos_sales": return [{ from: plus(-180) }];
    case "record_details": case "reservation_details": case "guest_profile": return [];
    default: return [{}];
  }
}

/** ما يجب ألا يكون فارغًا على البيانات التجريبية */
const EXPECT = {
  monthly_trend: (r) => r.months?.length > 0 && r.months.some((m) => m.revenue > 0),
  health_check: (r) => r.findings?.length > 0,
  hotel_snapshot: (r) => Boolean(r.today && r.base_currency),
  run_report: (r) => Array.isArray(r.rows),
  occupancy_forecast: (r) => r.daily?.length > 0 && r.daily.length === r.daily.filter((d) => d.date >= r.from && d.date <= r.to).length && r.daily.at(-1).date === r.to,
  availability_quote: (r) => r.quotes?.length > 0 && r.quotes.some((q) => q.total > 0),
  hr_overview: (r) => r.headcount?.active > 0,
  top_accounts: (r) => r.items?.length > 0,
  day_movements: (r) => typeof r.counts?.in_house === "number",
  housekeeping_status: (r) => r.total_rooms > 0,
  cash_position: (r) => typeof r.day_net === "number",
};

let offered = [];
const results = []; // { name, args, ok, note }
let link = null, chart = null;
const record = (name, args, content) => {
  let v;
  try { v = JSON.parse(content); } catch { results.push({ name, args, ok: false, note: `not json: ${content.slice(0, 80)}` }); return null; }
  if (v && typeof v === "object" && !Array.isArray(v) && v.error) { results.push({ name, args, ok: false, note: v.error }); return v; }
  const check = EXPECT[name];
  results.push({ name, args, ok: check ? Boolean(check(v)) : true, note: check && !check(v) ? "empty result" : "" });
  return v;
};

const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const callTools = (list) => list.forEach(([name, args], i) =>
      send({ choices: [{ delta: { tool_calls: [{ index: i, id: `c${j.messages.length}_${i}`, function: { name, arguments: JSON.stringify(args) } }] } }] }));
    const lastUser = j.messages.findLastIndex((m) => m.role === "user");
    const round = j.messages.slice(lastUser).filter((m) => m.role === "assistant").length;
    const sent = new Map(j.messages.filter((m) => m.role === "assistant").flatMap((m) => m.tool_calls ?? []).map((c) => [c.id, c.function]));
    const lastAssistant = j.messages.findLastIndex((m) => m.role === "assistant");
    const fresh = j.messages.slice(Math.max(lastUser, lastAssistant)).filter((m) => m.role === "tool").map((m) => {
      const f = sent.get(m.tool_call_id);
      return { name: f.name, args: JSON.parse(f.arguments || "{}"), value: record(f.name, JSON.parse(f.arguments || "{}"), m.content) };
    });

    if (round === 0) {
      offered = (j.tools ?? []).map((t) => t.function.name);
      callTools((j.tools ?? []).flatMap((t) => plan(t).map((a) => [t.function.name, a])));
    } else if (round === 1) {
      const next = [];
      for (const r of fresh) {
        const first = Array.isArray(r.value) ? r.value.find((x) => x.id) : null;
        if (!first) continue;
        if (r.name === "search_records") next.push(["record_details", { kind: r.args.kind, id: first.id }]);
        if (r.name === "hotel_search") next.push([r.args.kind === "guest" ? "guest_profile" : "reservation_details", { id: first.id }]);
        if (first.path && !link) link = { text: first.confirmation ?? first.full_name ?? first.id, path: first.path };
      }
      const trend = fresh.find((r) => r.name === "monthly_trend")?.value;
      if (trend?.months?.length) chart = { title: "الاتجاه الشهري", unit: trend.currency, labels: trend.months.map((m) => m.month), series: [{ name: "الإيرادات", data: trend.months.map((m) => m.revenue) }, { name: "المصروفات", data: trend.months.map((m) => m.expenses) }] };
      const occ = fresh.find((r) => r.name === "occupancy_forecast")?.value;
      if (!chart && occ?.daily?.length) chart = { title: "الإشغال المتوقع", unit: "%", labels: occ.daily.slice(0, 10).map((d) => d.date), series: [{ name: "الإشغال", data: occ.daily.slice(0, 10).map((d) => d.occupancy_pct ?? 0) }] };
      callTools(next);
    } else {
      const failed = results.filter((r) => !r.ok);
      const names = new Set(results.map((r) => r.name));
      const missing = offered.filter((n) => !names.has(n));
      const text = [
        failed.length || missing.length ? `TOOLS-FAIL ${failed.length + missing.length}` : `TOOLS-OK ${results.length}`,
        "",
        chart ? "```chart\n" + JSON.stringify(chart) + "\n```" : "",
        link ? `السجل الأول: [${link.text}](${link.path})` : "",
        ...failed.map((f) => `- ${f.name} ${JSON.stringify(f.args)}: ${f.note}`),
        ...missing.map((m) => `- ${m}: لم تُستدع`),
      ].join("\n");
      for (const part of text.match(/[\s\S]{1,40}/g)) send({ choices: [{ delta: { content: part } }] });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((r) => mock.listen(3399, "127.0.0.1", r));

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail-tools-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
};

await step("setup hotel", async () => {
  await page.goto(BASE + "/");
  await page.waitForLoadState("networkidle");
  if (!page.url().includes("onboarding")) return;
  await page.fill("#name_ar", "فندق الأدوات");
  await page.selectOption("#country_code", "SA"); await page.selectOption("#base_currency", "SAR"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", "Asia/Riyadh");
  await page.getByRole("button", { name: "إنشاء الفندق" }).click();
  await page.waitForURL((u) => !u.pathname.includes("onboarding"), { timeout: 30000 });
});
await step("load demo data", async () => {
  await page.goto(BASE + "/settings/hotel");
  await page.waitForLoadState("networkidle");
  const load = page.getByRole("button", { name: "إنشاء بيانات تجريبية" });
  if (!(await load.count())) return;
  await load.click();
  await page.waitForURL((u) => !u.pathname.startsWith("/settings"), { timeout: 300000 });
});
await step("every tool runs on real data without errors", async () => {
  await page.goto(BASE + "/assistant");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "اسأل عن أي شيء في النظام" }).fill("افحص كل أدواتك");
  await page.keyboard.press("Enter");
  await page.getByText(/TOOLS-(OK|FAIL)/).waitFor({ timeout: 240000 });
  console.log(`  tools offered: ${offered.length}, calls: ${results.length}`);
  for (const r of results) console.log(`  ${r.ok ? "ok " : "ERR"} ${r.name} ${JSON.stringify(r.args)}${r.note ? ` ${r.note}` : ""}`);
  const bad = results.filter((r) => !r.ok);
  if (bad.length) throw new Error(`${bad.length} tool calls failed`);
  const missing = offered.filter((n) => !results.some((r) => r.name === n));
  if (missing.length) throw new Error(`not exercised: ${missing.join(", ")}`);
});
await step("chart renders as bars", async () => {
  if (!chart) throw new Error("no chart data");
  await page.locator("main figure").first().waitFor();
  if ((await page.locator("main").innerText()).includes("```")) throw new Error("raw fence visible");
  await page.screenshot({ path: `${SHOTS}/assistant-tools-answer.png` });
});
await step("record link opens the record page", async () => {
  if (!link) throw new Error("no record link");
  const a = page.locator(`main a[href="${link.path}"]`).first();
  await a.waitFor();
  await a.click();
  await page.waitForURL((u) => link.path.startsWith(u.pathname) || u.pathname === link.path.split("?")[0], { timeout: 60000 });
});

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
mock.close();
process.exit(problems.length ? 1 : 0);

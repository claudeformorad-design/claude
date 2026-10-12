// يملأ كل نموذج في النظام بمدخلات خاطئة ويحفظ: فارغ، أرقام سالبة وضخمة، نص طويل ورموز.
// النموذج يجب أن يرفض برسالة، لا أن يطيح (500 أو خطأ متصفح أو صفحة الخطأ).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3401";
const OUT = process.env.OUT ?? `${process.env.SHOTS ?? "/tmp"}/fuzz.json`;
const PAGES = `/bills/new /events/new /folios/new /invoices/new /journal/new /laundry/new /payroll/new /purchase-orders/new /reservations/new /vouchers/new
/customers /vendors /guests /rooms /room-setup /rates /rate-plans /waitlist /maintenance /maintenance/assets /lost-found /laundry/setup /laundry/linen
/pos/setup /events /cheques /commissions /budgets /transfers /vendor-advances /fx-revaluation /inventory /assets /bank /periods /opening-balances
/journal/recurring /hr /hr/attendance /hr/leaves /hr/advances /settings/hotel /settings/currencies /settings/hr /settings/revenue /settings/users
/housekeeping /cashier /night-audit /accounts /account/password`.split(/\s+/).filter(Boolean);
const OPENERS = /^(\+|إضافة|جديد|أضف|تسجيل|فتح|إنشاء|New|Add|Open|Create|Record)/;

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ locale: "ar-SA", viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "nazeel_locale", value: "ar", url: BASE }]);
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
page.on("dialog", (d) => d.accept());

const findings = [];
let where = "";
const add = (kind, detail) => findings.push({ kind, where, detail: String(detail).slice(0, 300) });
page.on("pageerror", (e) => add("pageerror", e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(400|401|403|404|409|422)/.test(m.text())) add("console", m.text()); });
page.on("response", (r) => { if (r.status() >= 500) add("http5xx", `${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });

const boundary = async () => {
  const t = await page.locator("body").innerText().catch(() => "");
  if (/تعذّر تحميل هذه الصفحة|Application error|Internal Server Error/.test(t)) add("error-boundary", t.slice(0, 160).replace(/\s+/g, " "));
};

const JUNK_TEXT = `'"; drop table x; -- <b>x</b> ${"ي".repeat(400)} 😀`;
const junkFor = (type, name) => {
  if (type === "number") return name && /qty|quantity|count|nights|adults|children|kids/i.test(name) ? "-3" : "-99999999999999";
  if (type === "email") return "not-an-email";
  if (type === "tel") return "+abc";
  if (type === "date" || type === "time" || type === "datetime-local" || type === "month") return null;
  return JUNK_TEXT;
};

/** يجرب النموذج داخل scope: حفظ فارغ، ثم حفظ بمدخلات خاطئة */
async function hammer(scope, label) {
  const submit = scope.locator("button[type=submit]:visible").first();
  if (!(await submit.count())) return false;
  where = `${label} [empty]`;
  await submit.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200); await boundary();
  where = `${label} [junk]`;
  const inputs = scope.locator("input:visible:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([readonly]):not([disabled]), textarea:visible");
  const n = Math.min(await inputs.count(), 40);
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    const type = (await el.getAttribute("type").catch(() => "text")) ?? "text";
    const name = (await el.getAttribute("name").catch(() => "")) ?? "";
    const v = junkFor(type, name);
    if (v !== null) await el.fill(v, { timeout: 2000 }).catch(() => {});
  }
  const selects = scope.locator("select:visible:not([disabled])");
  for (let i = 0; i < Math.min(await selects.count(), 20); i++) {
    const s = selects.nth(i);
    const values = await s.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean)).catch(() => []);
    if (values.length) await s.selectOption(values[values.length - 1], { timeout: 2000 }).catch(() => {});
  }
  if (await submit.isVisible().catch(() => false)) await submit.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500); await boundary();
  return true;
}

let forms = 0;
for (const p of PAGES) {
  where = p;
  try {
    await page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    // نماذج ظاهرة في الصفحة نفسها
    if (await hammer(page.locator("main"), p)) forms++;
    // نوافذ الإضافة: كل زر يبدأ بـ إضافة/جديد يفتح نافذة فيها نموذج
    await page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const openers = await page.locator("main button:visible").evaluateAll((bs, re) => bs.map((b, i) => [i, (b.textContent ?? "").trim()]).filter(([, t]) => new RegExp(re).test(t)), OPENERS.source);
    for (const [, text] of openers.slice(0, 4)) {
      await page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      const btn = page.locator("main button:visible", { hasText: text }).first();
      if (!(await btn.count())) continue;
      await btn.click({ timeout: 5000 }).catch(() => {});
      const dialog = page.locator("[role=dialog]:visible").last();
      if (await dialog.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) {
        if (await hammer(dialog, `${p} > ${text}`)) forms++;
      }
    }
  } catch (e) {
    add("fuzz-failed", String(e.message).split("\n")[0]);
  }
  console.log(`${p}: ${findings.length} findings so far`);
}
await browser.close();
writeFileSync(OUT, JSON.stringify({ forms, findings }, null, 1));
const groups = new Map();
for (const f of findings) {
  const key = `${f.kind} | ${f.detail.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").slice(0, 150)}`;
  const g = groups.get(key) ?? { n: 0, where: new Set() };
  g.n++; g.where.add(f.where); groups.set(key, g);
}
console.log(`\n${forms} forms hammered, ${findings.length} findings, ${groups.size} distinct`);
for (const [k, g] of groups) console.log(`${g.n}x ${k}\n     at ${[...g.where].slice(0, 4).join("  |  ")}`);

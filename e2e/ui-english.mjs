// الواجهة الإنجليزية: التبديل من زر اللغة، الاتجاه من اليسار، النماذج والرسائل ورسائل قواعد العمل بالإنجليزية،
// السند بالتفقيط الإنجليزي، وثبات اللغة للمستخدم، ثم العودة للعربية.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp";
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const context = await browser.newContext({ locale: "ar-SA", viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("dialog", (d) => d.accept());
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail-en-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
};
const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
const has = async (...texts) => {
  const until = Date.now() + 15000;
  for (;;) {
    const b = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const missing = texts.find((t) => !b.includes(t));
    if (missing === undefined) return;
    if (Date.now() > until) throw new Error(`missing "${missing}"`);
    await page.waitForTimeout(250);
  }
};
const pick = async (sel, re) => {
  const l = page.locator(sel);
  await l.first().waitFor({ state: "attached" });
  const texts = await l.locator("option").allTextContents();
  const i = texts.findIndex((t) => re.test(t));
  if (i < 0) throw new Error(`no option matching ${re} in ${texts.slice(0, 6)}`);
  await l.selectOption({ index: i });
};
const lang = async () => {
  for (let i = 0; ; i++) {
    try { return await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir })); }
    catch (e) { if (i > 20) throw e; await page.waitForTimeout(300); }
  }
};
/** يبدّل اللغة وينتظر إعادة تحميل الصفحة بها */
const switchTo = async (button, code) => {
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: button }).click()]);
  await page.waitForLoadState("networkidle");
  if ((await lang()).lang !== code) throw new Error(`still ${(await lang()).lang}`);
};

await page.goto(BASE + "/"); await page.waitForURL(/onboarding/, { timeout: 120000 });
await page.fill("#name_ar", "فندق اللغات");
await page.selectOption("#country_code", "YE"); await page.selectOption("#base_currency", "YER"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", "Asia/Aden");
await page.getByRole("button", { name: "إنشاء الفندق" }).click();
await page.waitForURL((u) => u.pathname === "/", { timeout: 120000 });

await step("starts in Arabic, right to left", async () => {
  const l = await lang();
  if (l.lang !== "ar" || l.dir !== "rtl") throw new Error(JSON.stringify(l));
  await has("لوحة التحكم");
});
await step("language button switches to English, left to right", async () => {
  await switchTo("English", "en");
  const l = await lang();
  if (l.dir !== "ltr") throw new Error(JSON.stringify(l));
  await has("Dashboard", "This month", "Revenue");
  await page.screenshot({ path: `${SHOTS}/en-dashboard.png` });
});
await step("navigation and pages in English", async () => {
  for (const [path, text] of [["/accounts", "Chart of accounts"], ["/front-desk", "Arrivals today"], ["/settings/users", "Users and permissions"],
    ["/reports/income-statement", "Income statement"], ["/hr", "Employees"], ["/settings/import", "Data import"]]) {
    await go(path); await has(text);
  }
});
await step("form validation message in English", async () => {
  await go("/customers?new=1");
  await page.getByRole("button", { name: "Save" }).click();
  await has("Check the required fields");
});
await step("save a customer in English", async () => {
  await page.fill("#code", "ACME"); await page.fill("#name_ar", "شركة أكمي");
  await page.check("input[name=allow_credit]"); await page.fill("#credit_limit", "10000");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/customers$/); await has("شركة أكمي", "Customers");
});
await step("business rule error comes in English", async () => {
  await go("/folios/new");
  await page.fill("#guest_name", "Guest One"); await page.fill("#room_number", "101");
  await page.getByRole("button", { name: "Open" }).click();
  await page.waitForURL(/folios\/[0-9a-f-]{36}$/);
  await pick("#charge_code_id", /ROOM/);
  await page.fill("#quantity", "1"); await page.fill("#unit_price", "100");
  await page.getByRole("button", { name: "Save" }).click();
  await has("Posted to the folio");
  await page.getByRole("button", { name: "Payment", exact: true }).click();
  await pick("#payment_method_id", /city ledger|آجل/i);
  await page.fill("#amount", "5000");
  await pick("#customer_id", /ACME|أكمي/);
  await page.getByRole("button", { name: "Save" }).click();
  await page.locator("[role=alert]").filter({ hasText: /\w/ }).first().waitFor();
  const alert = await page.locator("[role=alert]").filter({ hasText: /\w/ }).first().innerText();
  if (/[؀-ۿ]/.test(alert) || !alert.trim()) throw new Error(`alert: ${alert}`);
});
await step("receipt voucher printed with English amount in words", async () => {
  await go("/vouchers/new?type=receipt");
  await pick("#customer_id", /ACME/);
  await pick("#payment_method_id", /Cash/);
  await page.fill("#amount", "1250"); await page.fill("#description", "Advance payment");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/vouchers\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop();
  const doc = await context.newPage();
  await doc.goto(`${BASE}/print/voucher/${id}`); await doc.waitForLoadState("networkidle");
  const body = await doc.locator("body").innerText();
  if (!body.includes("Receipt voucher") || !body.includes("Only one thousand two hundred fifty Yemeni rials")) throw new Error(body.slice(0, 300));
  await doc.screenshot({ path: `${SHOTS}/en-voucher.png`, fullPage: true });
  await doc.close();
});
await step("language is remembered across visits", async () => {
  await go("/");
  if ((await lang()).lang !== "en") throw new Error("lost English");
});
await step("switch back to Arabic", async () => {
  await switchTo("العربية", "ar");
  if ((await lang()).dir !== "rtl") throw new Error("not rtl");
  await has("لوحة التحكم");
});

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
process.exit(problems.length ? 1 : 0);

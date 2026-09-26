// جولة واجهة كاملة في متصفح حقيقي على مكدس Supabase حقيقي:
// تسجيل → إعداد فندق → قيد يدوي → فوليو (رسوم/دفع/مغادرة) → الفاتورة → كل الصفحات والتقارير → تصدير Excel
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp";
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ locale: "ar-SA", viewport: { width: 1400, height: 900 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_")}.png` }); }
};
const noErrorScreen = async () => {
  const body = await page.locator("body").innerText();
  if (/Application error|Unhandled Runtime Error|حدث خطأ غير متوقع|This page could not be found/.test(body)) throw new Error("error screen: " + body.slice(0, 150));
};
const pick = async (loc, re) => {
  const l = typeof loc === "string" ? page.locator(loc) : loc;
  const texts = await l.locator("option").allTextContents();
  const i = texts.findIndex((t) => re.test(t));
  if (i < 0) throw new Error(`no option matching ${re}`);
  await l.selectOption({ index: i });
};
const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); await noErrorScreen(); };

const email = `ui-${Date.now()}@test.dev`;
// وضع التجربة المحلي (LOCAL=1): لا يوجد تسجيل دخول، أول زيارة تحوّل لإعداد الفندق
await step("signup", async () => {
  if (process.env.LOCAL) { await page.goto(BASE + "/"); await page.waitForURL(/onboarding/, { timeout: 60000 }); return; }
  await page.goto(BASE + "/login");
  await page.getByRole("button", { name: /أنشئ حسابًا/ }).click();
  await page.fill("#full_name", "مدير الاختبار");
  await page.fill("#email", email);
  await page.fill("#password", "Passw0rd!123");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL(/onboarding/, { timeout: 15000 });
});
await step("onboarding", async () => {
  await page.fill("#name_ar", "فندق الواجهة");
  await page.fill("#name_en", "UI Hotel");
  await page.getByRole("button", { name: "إنشاء الفندق" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20000 });
  await noErrorScreen();
});
await step("hotel settings: set 20 rooms", async () => {
  await go("/settings/hotel");
  await page.fill("#total_rooms", "20");
  await page.getByRole("button", { name: "حفظ" }).first().click();
  await page.waitForTimeout(1500);
  await noErrorScreen();
});
await step("revenue settings: add VAT 15% and apply to ROOM", async () => {
  await go("/settings/revenue?new=tax");
  await page.fill("#code", "VAT");
  await page.fill("#name_ar", "ضريبة القيمة المضافة");
  await page.fill("#rate", "15");
  await pick("#account_id", /2110/);
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/settings\/revenue$/, { timeout: 10000 });
  const roomRow = page.locator("tr", { has: page.locator('td:text-is("ROOM")') });
  await roomRow.getByRole("link", { name: "تعديل" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/VAT/).check();
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/settings\/revenue$/, { timeout: 10000 });
  if (!(await page.locator("tr", { has: page.locator('td:text-is("ROOM")') }).innerText()).includes("VAT")) throw new Error("tax not linked");
});
await step("manual journal entry: capital 50,000", async () => {
  await go("/journal/new");
  await page.fill("#description", "رأس المال");
  const selects = page.locator("tbody select");
  await pick(selects.nth(0), /1103/);
  await pick(selects.nth(2), /3101/);
  const nums = page.locator("tbody input[inputmode=decimal]");
  await nums.nth(0).fill("50000");
  await nums.nth(3).fill("50000");
  await page.getByText("متوازن", { exact: true }).waitFor();
  await page.getByRole("button", { name: "حفظ وترحيل" }).click();
  await page.waitForURL(/journal\/[0-9a-f-]{36}$/, { timeout: 10000 });
  await page.getByText(/JV-\d{4}-\d{6}/).first().waitFor();
});
await step("unbalanced entry blocked in UI", async () => {
  await go("/journal/new");
  await page.fill("#description", "غير متوازن");
  const selects = page.locator("tbody select");
  await pick(selects.nth(0), /1101/);
  await pick(selects.nth(2), /4101/);
  const nums = page.locator("tbody input[inputmode=decimal]");
  await nums.nth(0).fill("100");
  await nums.nth(3).fill("90");
  await page.getByText("غير متوازن").first().waitFor();
  if (await page.getByRole("button", { name: "حفظ وترحيل" }).isEnabled()) throw new Error("post button enabled for unbalanced entry");
});
await step("open folio", async () => {
  await go("/folios/new");
  await page.fill("#guest_name", "نزيل الاختبار");
  await page.fill("#room_number", "305");
  await page.getByRole("button", { name: "فتح" }).click();
  await page.waitForURL(/folios\/[0-9a-f-]{36}$/, { timeout: 10000 });
});
await step("post room charge 2 nights × 500 (+VAT)", async () => {
  await pick("#charge_code_id", /ROOM/);
  await page.fill("#quantity", "2");
  await page.fill("#unit_price", "500");
  await page.getByText("1,150.00").first().waitFor(); // معاينة الضريبة
  await page.getByRole("button", { name: "حفظ" }).click();
  // الحركة المسجلة فعلًا في جدول الحركات (وليس المعاينة)
  await page.locator("tbody tr", { hasText: "رسم" }).first().waitFor({ timeout: 10000 });
  if (await page.locator("[role=alert]").filter({ hasText: /تحقق|خطأ/ }).count()) throw new Error("form error shown");
});
await step("cash payment 1,150", async () => {
  await page.getByRole("button", { name: "دفعة" }).click();
  await pick("#payment_method_id", /نقد/);
  await page.fill("#amount", "1150");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.locator("tbody tr", { hasText: "دفعة" }).first().waitFor({ timeout: 10000 });
  await noErrorScreen();
});
await step("checkout → tax invoice", async () => {
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "مغادرة وإصدار الفاتورة" }).click();
  await page.waitForURL(/invoices\/[0-9a-f-]{36}$/, { timeout: 15000 });
  await page.getByText("فاتورة ضريبية").waitFor();
  const t = await page.locator("body").innerText();
  for (const s of ["1,000.00", "150.00", "1,150.00", "INV-"]) if (!t.includes(s)) throw new Error(`invoice missing ${s}`);
  await page.screenshot({ path: `${SHOTS}/invoice.png`, fullPage: true });
});
const pages = [
  "/", "/accounts", "/journal", "/folios?status=all", "/invoices", "/vouchers", "/vouchers/new?type=receipt", "/vouchers/new?type=disbursement",
  "/customers?new=1", "/vendors?new=1", "/purchase-orders", "/purchase-orders/new", "/bills", "/bills/new", "/payroll", "/payroll/new", "/bank",
  "/assets", "/inventory?new=1", "/reports/income-statement", "/reports/balance-sheet", "/reports/cash-flow", "/reports/trial-balance",
  "/reports/rooms", "/reports/daily-cash", "/reports/tax-return", "/reports/aging", "/reports/aging?kind=payable", "/reports/profitability",
  "/settings/hotel", "/settings/revenue", "/settings/users", "/periods", "/audit", "/invoices/new",
];
for (const p of pages) await step(`page ${p}`, () => go(p));
await step("income statement shows 1,000 room revenue", async () => {
  await go("/reports/income-statement");
  if (!(await page.locator("body").innerText()).includes("1,000.00")) throw new Error("revenue missing");
});
await step("balance sheet balances", async () => { await go("/reports/balance-sheet"); await page.getByText("الميزانية متوازنة").waitFor(); });
await step("trial balance balances", async () => { await go("/reports/trial-balance"); await page.getByText("الميزان متوازن").waitFor(); });
await step("occupancy KPI computed", async () => {
  await go("/reports/rooms");
  if (!(await page.locator("body").innerText()).match(/\d+\.\d%/)) throw new Error("no occupancy %");
});
await step("dashboard renders charts", async () => { await go("/"); await page.locator("[data-chart=financial] svg").first().waitFor({ timeout: 10000 }); await page.locator("#reconciliation").waitFor(); if (await page.locator("#reconciliation .text-red-700").count()) throw new Error("reconciliation difference on dashboard"); await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true }); });
await step("excel export downloads", async () => {
  const res = await page.request.get(`${BASE}/api/export/income-statement`);
  if (res.status() !== 200 || !(res.headers()["content-type"] ?? "").includes("spreadsheet")) throw new Error(`status ${res.status()}`);
  const buf = await res.body();
  if (buf.subarray(0, 2).toString() !== "PK") throw new Error("not an xlsx zip");
});
console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
process.exit(problems.length ? 1 : 0);

// حالات حدّية قاسية عبر الواجهة كمستخدم حقيقي: مدخلات خاطئة وسالبة وضخمة، نصوص طويلة ورموز، ضغط مزدوج،
// تبويبان على نفس العملية، وحذف بيانات مرتبطة. المطلوب في كل حالة: سلوك آمن ورسالة واضحة، ولا أثر خاطئ في البيانات.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp";
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ locale: "ar-SA", viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
const problems = [];
let alerted = false;
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("dialog", (d) => { if (d.type() === "alert") alerted = true; d.accept(); });
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail-edge-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
};
const go = async (p, pg = page) => { await pg.goto(BASE + p); await pg.waitForLoadState("networkidle"); };
const pick = async (loc, re, pg = page) => {
  const l = pg.locator(loc);
  await l.first().waitFor({ state: "attached" });
  const texts = await l.locator("option").allTextContents();
  const i = texts.findIndex((t) => re.test(t));
  if (i < 0) throw new Error(`no option matching ${re}`);
  await l.selectOption({ index: i });
};
const toastOrAlert = (re, pg = page) => pg.locator('[role="alert"], [aria-live] > *').filter({ hasText: re }).first().waitFor({ timeout: 15000 });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const plus = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const countReservations = async () => { await go("/reservations"); return (await page.locator('a[href^="/reservations/"]').evaluateAll((as) => new Set(as.map((a) => a.getAttribute("href")).filter((h) => /^\/reservations\/[0-9a-f-]{36}$/.test(h))).size)); };

// إعداد: فندق، نوع غرفة، غرفتان
await go("/");
await page.fill("#name_ar", "فندق الحالات الحدية");
await page.selectOption("#country_code", "SA"); await page.selectOption("#base_currency", "SAR"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", "Asia/Riyadh");
await page.getByRole("button", { name: "إنشاء الفندق" }).click();
await page.waitForURL((u) => u.pathname === "/", { timeout: 60000 });
await go("/room-setup?new=1");
await page.fill("#code", "STD"); await page.fill("#name_ar", "غرفة عادية"); await page.fill("#base_rate", "200");
await page.getByRole("button", { name: "حفظ" }).click(); await page.waitForURL(/room-setup$/);
await go("/room-setup?tab=rooms");
await page.getByRole("button", { name: "إضافة غرف دفعة واحدة" }).click();
await pick("#room_type_id", /عادية/); await page.fill("#from_number", "1"); await page.fill("#to_number", "2");
await page.getByRole("button", { name: "إضافة الغرف" }).click(); await page.locator("main").getByText("2", { exact: true }).first().waitFor();

const LONG = "نزيل".repeat(70);
const XSS = `<img src=x onerror=alert(1)>"'؛&<script>alert(2)</script>`;
let resId = "";

await step("zero and absurd nights are refused with a message", async () => {
  await go("/reservations/new");
  await page.getByRole("button", { name: /نزيل جديد/ }).click().catch(() => {});
  await page.fill("#new_guest_name", "اختبار الليالي");
  await pick("#room_type_id", /عادية/);
  await page.fill("#arrival_date", plus(3)); await page.fill("#nights", "0");
  await page.waitForTimeout(700);
  const btn = page.getByRole("button", { name: /تأكيد الحجز/ });
  await page.getByText("عدد الليالي من 1 إلى 366").waitFor();
  if (await btn.isEnabled()) throw new Error("confirm enabled with 0 nights");
  await page.fill("#nights", "5000");
  await page.getByText("عدد الليالي من 1 إلى 366").waitFor();
  if (await btn.isEnabled()) throw new Error("confirm enabled with 5000 nights");
  await page.fill("#nights", "2");
  if (!(await btn.isEnabled())) throw new Error("confirm stays locked after fixing nights");
});
await step("a past arrival date is refused", async () => {
  await go("/reservations/new");
  await page.getByRole("button", { name: /نزيل جديد/ }).click().catch(() => {});
  await page.fill("#new_guest_name", "وصول قديم");
  await pick("#room_type_id", /عادية/);
  await page.fill("#arrival_date", plus(-30)); await page.fill("#nights", "2");
  await page.waitForTimeout(700);
  const btn = page.getByRole("button", { name: /تأكيد الحجز/ });
  if (await btn.isEnabled()) { await btn.click(); await page.locator('[role="alert"]').first().waitFor(); }
  if (/reservations\/[0-9a-f-]{36}$/.test(page.url())) throw new Error("reservation in the past was created");
});
await step("double press on confirm creates one reservation, with long name and symbols shown safely", async () => {
  const before = await countReservations();
  await go("/reservations/new");
  await page.getByRole("button", { name: /نزيل جديد/ }).click().catch(() => {});
  await page.fill("#new_guest_name", `${LONG} ${XSS}`.slice(0, 200));
  await pick("#room_type_id", /عادية/);
  await page.fill("#arrival_date", plus(2)); await page.fill("#nights", "2");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /تأكيد الحجز/ }).click();
  // اسم أطول من المسموح: رسالة تسمي الحقل والحد، لا «تحقق من الحقول»
  await page.locator('[role="alert"]').filter({ hasText: /اسم النزيل أطول من المسموح، الحد 150/ }).waitFor();
  await page.fill("#new_guest_name", `${XSS} ${LONG}`.slice(0, 140));
  await pick("#room_type_id", /عادية/);
  await page.fill("#arrival_date", plus(2)); await page.fill("#nights", "2");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /تأكيد الحجز/ }).evaluate((b) => { b.click(); b.click(); });
  await page.waitForURL(/reservations\/[0-9a-f-]{36}$/, { timeout: 30000 });
  resId = page.url().split("/").pop();
  await page.waitForTimeout(1500);
  if (alerted) throw new Error("script in a name ran");
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 1) throw new Error(`long name pushes the page sideways ${over}px`);
  const after = await countReservations();
  if (after - before !== 1) throw new Error(`expected 1 new reservation, got ${after - before}`);
});
await step("negative, text and absurd deposits are refused and nothing is recorded", async () => {
  await go(`/reservations/${resId}`);
  for (const bad of ["-50", "abc", "999999999999999999"]) {
    await page.fill("#dep_amount", bad);
    await page.getByRole("button", { name: "تسجيل العربون" }).click();
    await toastOrAlert(/.+/);
    await page.waitForTimeout(400);
  }
  await go(`/reservations/${resId}`);
  const txt = await page.locator("main").innerText();
  if (/عربون متاح\s*\n?\s*[1-9]/.test(txt)) throw new Error("a bad deposit was recorded");
});
await step("a valid deposit is recorded once on double press", async () => {
  await page.fill("#dep_amount", "100");
  await page.getByRole("button", { name: "تسجيل العربون" }).evaluate((b) => { b.click(); b.click(); });
  await page.waitForTimeout(2500);
  await go(`/reservations/${resId}`);
  const dep = (await page.locator("dt", { hasText: "عربون متاح" }).locator("xpath=following-sibling::dd").innerText()).trim();
  if (dep !== "100.00") throw new Error(`available deposit is ${dep}, expected 100.00 once`);
});
await step("checking in the same reservation from two tabs: the second gets a clear message", async () => {
  await go("/reservations/new");
  await page.getByRole("button", { name: /نزيل جديد/ }).click().catch(() => {});
  await page.fill("#new_guest_name", "نزيل التبويبين");
  await pick("#room_type_id", /عادية/);
  await page.fill("#arrival_date", today); await page.fill("#nights", "1");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /تأكيد الحجز/ }).click();
  await page.waitForURL(/reservations\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop();
  const other = await ctx.newPage();
  await go(`/reservations/${id}`, other);
  for (const pg of [page, other]) await pg.locator("label").filter({ hasText: /سلّمتُ/ }).locator("input").check();
  await page.getByRole("button", { name: "إتمام التسكين" }).click();
  await page.locator("main").getByText("تسجيل المغادرة").first().waitFor();
  await other.getByRole("button", { name: "إتمام التسكين" }).click();
  await toastOrAlert(/.+/, other);
  await other.close();
});
await step("an unknown record shows a not found page, not a crash", async () => {
  const r = await page.goto(`${BASE}/reservations/00000000-0000-4000-8000-000000000000`);
  if (r.status() >= 500) throw new Error(`HTTP ${r.status()}`);
  const r2 = await page.goto(`${BASE}/reservations/not-a-uuid`);
  if (r2.status() >= 500) throw new Error(`HTTP ${r2.status()} for a bad id`);
});

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
process.exit(problems.length ? 1 : 0);

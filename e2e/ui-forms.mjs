// جولة ثانية: إرسال كل النماذج المتبقية عبر الواجهة والتحقق من النتائج المحاسبية
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp";
// HOST_RULES يحاكي فتح النظام من نطاق معاينة (مثل Google AI Studio): "MAP preview.run.app 127.0.0.1"
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: process.env.HOST_RULES ? [`--host-resolver-rules=${process.env.HOST_RULES}`, "--no-proxy-server"] : [] });
const page = await browser.newPage({ locale: "ar-SA", viewport: { width: 1400, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("dialog", (d) => d.accept());
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail2-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
};
const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
const pick = async (loc, re) => {
  const l = typeof loc === "string" ? page.locator(loc) : loc;
  await l.first().waitFor({ state: "attached" });
  const texts = await l.locator("option").allTextContents();
  const i = texts.findIndex((t) => re.test(t));
  if (i < 0) throw new Error(`no option matching ${re} in ${texts.slice(0, 5)}`);
  await l.selectOption({ index: i });
};
const noFormError = async () => {
  await page.waitForTimeout(400);
  const alerts = await page.locator("[role=alert]").filter({ hasText: /تحقق|خطأ|تجاوز|صلاحية|غير/ }).allTextContents();
  if (alerts.length) throw new Error("form error: " + alerts.join(" | "));
};
// ينتظر ظهور النصوص (حتى 10 ثوانٍ): بعد إعادة التوجيه من Server Action يتغيّر العنوان قبل وصول المحتوى
const bodyHas = async (...texts) => {
  const until = Date.now() + 10000;
  for (;;) {
    const b = await page.locator("body").innerText();
    const missing = texts.find((t) => !b.includes(t));
    if (missing === undefined) return;
    if (Date.now() > until) throw new Error(`missing "${missing}"`);
    await page.waitForTimeout(200);
  }
};

// مستخدم وفندق جديدان
const email = `forms-${Date.now()}@test.dev`;
if (process.env.LOCAL) {
  // وضع التجربة المحلي: قاعدة جديدة فارغة ⇒ أول زيارة تحوّل لإعداد الفندق
  await page.goto(BASE + "/"); await page.waitForURL(/onboarding/, { timeout: 60000 });
} else {
  await page.goto(BASE + "/login");
  await page.getByRole("button", { name: /أنشئ حسابًا/ }).click();
  await page.fill("#email", email); await page.fill("#password", "Passw0rd!123");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL(/onboarding/);
} await page.fill("#name_ar", "فندق النماذج");
await page.selectOption("#country_code", "SA"); await page.selectOption("#base_currency", "SAR"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", "Asia/Riyadh");
await page.getByRole("button", { name: "إنشاء الفندق" }).click();
await page.waitForURL((u) => u.pathname === "/");

await step("customer with credit", async () => {
  await go("/customers?new=1");
  await page.fill("#code", "ACME"); await page.fill("#name_ar", "شركة أكمي");
  await page.check("input[name=allow_credit]"); await page.fill("#credit_limit", "10000");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/customers$/); await bodyHas("شركة أكمي");
});
await step("direct credit invoice 2,000 (events)", async () => {
  await go("/invoices/new");
  await pick("#customer_id", /ACME/);
  await pick(page.locator("select[aria-label]").first(), /EVENTS/);
  await page.locator("input[placeholder='سعر الوحدة']").fill("2000");
  await page.getByRole("button", { name: "إنشاء" }).click();
  await page.waitForURL(/invoices\/[0-9a-f-]{36}$/, { timeout: 15000 }); await bodyHas("2,000.00", "INV-");
});
await step("credit note 500 on the invoice", async () => {
  await page.fill("input[placeholder='مبلغ الإشعار شامل الضريبة']", "500");
  await page.fill("input[placeholder='السبب']", "خصم تجاري");
  await page.getByRole("button", { name: "إشعار دائن" }).click();
  await page.getByText(/CN-\d{4}-\d{6}/).waitFor({ timeout: 10000 }); await noFormError();
});
await step("receipt voucher with auto-allocation", async () => {
  await go("/vouchers/new?type=receipt");
  await pick("#customer_id", /ACME/);
  await pick("#payment_method_id", /تحويل بنكي/);
  await page.fill("#amount", "1500"); await page.fill("#description", "دفعة من أكمي");
  await page.getByRole("button", { name: "تخصيص تلقائي للأقدم أولًا" }).click();
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/vouchers\/[0-9a-f-]{36}$/, { timeout: 15000 }); await bodyHas("RV-", "INV-");
});
await step("invoice now paid", async () => { await go("/invoices"); await bodyHas("مسددة"); });
await step("vendor", async () => {
  await go("/vendors?new=1");
  await page.fill("#code", "FOOD"); await page.fill("#name_ar", "مورد الأغذية");
  await page.getByRole("button", { name: "حفظ" }).click(); await page.waitForURL(/vendors$/); await bodyHas("مورد الأغذية");
});
await step("purchase order → bill", async () => {
  await go("/purchase-orders/new");
  await pick("#vendor_id", /FOOD/);
  await page.locator("input[placeholder='الوصف']").first().fill("أرز");
  await pick(page.locator("select[aria-label='حساب المصروف أو الأصل أو المخزون']").first(), /1120/);
  await page.locator("input[placeholder='الكمية']").first().fill("10");
  await page.locator("input[placeholder='سعر الوحدة']").first().fill("50");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/purchase-orders$/, { timeout: 10000 }); await bodyHas("PO-");
  await page.getByRole("button", { name: "تحويل لفاتورة" }).click();
  await page.waitForURL(/bills\/[0-9a-f-]{36}$/, { timeout: 15000 }); await bodyHas("VB-", "500.00");
});
await step("pay the bill", async () => {
  await pick(page.locator("select[aria-label='طريقة الدفع']"), /تحويل بنكي/);
  await page.getByRole("button", { name: "سداد المورد" }).click();
  await page.getByText("مسددة").first().waitFor({ timeout: 10000 }); await noFormError();
});
await step("inventory item + receipt from bill + issue to F&B", async () => {
  await go("/inventory?new=1");
  await page.fill("#sku", "RICE"); await page.fill("#name_ar", "أرز");
  await pick("#inventory_account_id", /1120/); await pick("#expense_account_id", /5101/);
  await page.getByRole("button", { name: "حفظ" }).first().click();
  await page.waitForURL(/inventory$/, { timeout: 10000 });
  await pick("#item_id", /RICE/); await page.selectOption("#type", "receipt");
  await page.fill("#quantity", "10"); await page.fill("#unit_cost", "50"); await pick("#vendor_bill_id", /VB-/);
  await page.getByRole("button", { name: "حفظ" }).click(); await page.waitForTimeout(1500); await noFormError();
  await pick("#item_id", /RICE/); await page.selectOption("#type", "issue");
  await page.fill("#quantity", "4"); await pick("#department_id", /FNB/);
  await page.getByRole("button", { name: "حفظ" }).click(); await page.waitForTimeout(1500); await noFormError();
  await bodyHas("300.00"); // 6 × 50
});
await step("fixed asset + depreciation run", async () => {
  await go("/assets");
  await page.fill("#name", "حاسوب الاستقبال"); await page.fill("#category", "أجهزة");
  await pick("#asset_account_id", /1203/); await page.fill("#cost", "3600"); await page.fill("#useful_life_months", "36");
  const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 2);
  await page.fill("#acquisition_date", d.toISOString().slice(0, 10));
  await pick("#counter_account_id", /3101/);
  await page.getByRole("button", { name: "تسجيل أصل" }).click(); await page.waitForTimeout(1500); await noFormError();
  await bodyHas("FA-");
  await page.getByRole("button", { name: "تشغيل إهلاك الشهر" }).click(); await page.waitForTimeout(1500); await noFormError();
  await bodyHas("100.00");
});
await step("payroll run", async () => {
  await go("/payroll/new");
  await page.locator("tbody input").first().fill("موظف الاستقبال");
  await pick(page.locator("tbody select").first(), /ROOMS/);
  const nums = page.locator("tbody input[inputmode=decimal]");
  await nums.nth(0).fill("5000"); await nums.nth(1).fill("1000"); await nums.nth(3).fill("450"); await nums.nth(4).fill("600");
  await page.getByRole("button", { name: "ترحيل" }).click();
  await page.waitForURL(/payroll$/, { timeout: 15000 }); await bodyHas("PR-", "5,550.00");
});
await step("disbursement voucher: pay salaries", async () => {
  await go("/vouchers/new?type=disbursement");
  await pick("#counter_account_id", /2103/); await pick("#payment_method_id", /تحويل بنكي/);
  await page.fill("#amount", "5550"); await page.fill("#description", "صرف رواتب");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/vouchers\/[0-9a-f-]{36}$/, { timeout: 15000 }); await bodyHas("PV-");
});
await step("bank reconciliation: statement line + auto match", async () => {
  await go("/bank");
  await page.locator("input[placeholder='الوصف']").fill("Salary transfer");
  await page.locator("input[placeholder='المبلغ']").fill("-5550");
  await page.getByRole("button", { name: "إضافة حركة من الكشف" }).click(); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "مطابقة تلقائية" }).click(); await page.waitForTimeout(1500);
  await page.getByText("مطابقة", { exact: true }).first().waitFor();
});
await step("draft journal: save, edit, post", async () => {
  await go("/journal/new");
  await page.fill("#description", "مسودة");
  const s = page.locator("tbody select");
  await pick(s.nth(0), /5204/); await pick(s.nth(2), /1101/);
  const n = page.locator("tbody input[inputmode=decimal]");
  await n.nth(0).fill("80"); await n.nth(3).fill("80");
  await page.getByRole("button", { name: "حفظ كمسودة" }).click();
  await page.waitForURL(/journal\/[0-9a-f-]{36}$/, { timeout: 10000 });
  await page.getByRole("link", { name: "تعديل" }).click(); await page.waitForURL(/edit$/);
  await page.fill("#description", "مسودة معدلة");
  await page.getByRole("button", { name: "حفظ وترحيل" }).click();
  await page.waitForURL(/journal\/[0-9a-f-]{36}$/, { timeout: 10000 }); await page.getByText(/JV-\d{4}-\d{6}/).first().waitFor();
  await page.getByRole("button", { name: "عكس القيد" }).click();
  await page.getByText("عكس للقيد").waitFor({ timeout: 15000 });
});
await step("control account blocked in manual journal (UI message)", async () => {
  await go("/journal/new");
  await page.fill("#description", "تلاعب");
  const s = page.locator("tbody select");
  await pick(s.nth(0), /1111/); await pick(s.nth(2), /4201/);
  const n = page.locator("tbody input[inputmode=decimal]");
  await n.nth(0).fill("10"); await n.nth(3).fill("10");
  await page.getByRole("button", { name: "حفظ وترحيل" }).click(); await page.waitForTimeout(1500);
  const alerts = await page.locator("[role=alert]").allTextContents();
  if (!alerts.some((a) => a.length > 0)) throw new Error("no error shown");
});
await step("add user + custom role", async () => {
  await go("/settings/users?role=new");
  await page.locator("input[placeholder='رمز الدور']").fill("night_audit");
  await page.locator("input[placeholder='الاسم']").fill("مدقق ليلي");
  await page.locator("input[placeholder='Name']").fill("Night auditor");
  await page.getByLabel("عرض الفوليو").check();
  await page.getByRole("button", { name: "حفظ" }).last().click();
  await page.waitForURL(/settings\/users$/, { timeout: 10000 }); await bodyHas("مدقق ليلي");
});
await step("tax return + aging + profitability show data", async () => {
  await go("/reports/tax-return"); await noFormError();
  await go("/reports/profitability"); await bodyHas("2,000.00".slice(0, 1));
  await go("/reports/aging"); await noFormError();
});
await step("close a period", async () => {
  await go("/periods");
  await page.getByRole("button", { name: "إقفال", exact: true }).first().click(); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "إعادة فتح" }).first().waitFor();
});
await step("audit log lists changes", async () => { await go("/audit"); await bodyHas("القيود", "إضافة"); });

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
process.exit(problems.length ? 1 : 0);

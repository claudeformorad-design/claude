// المستندات المطبوعة والاستيراد من Excel: قوالب الاستيراد، فحص الأخطاء قبل الحفظ، استيراد الغرف والنزلاء والعملاء
// والأصناف والموظفين، ثم سند القبض بالتفقيط، وكشف حساب العميل، وكشف حساب النزيل.
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp";
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const context = await browser.newContext({ locale: "ar-SA", viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("dialog", (d) => d.accept());
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail-docs-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
};
const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
const pick = async (loc, re) => {
  const l = typeof loc === "string" ? page.locator(loc) : loc;
  await l.first().waitFor({ state: "attached" });
  const texts = await l.locator("option").allTextContents();
  const i = texts.findIndex((t) => re.test(t));
  if (i < 0) throw new Error(`no option matching ${re} in ${texts.slice(0, 6)}`);
  await l.selectOption({ index: i });
};
const textOf = async (p = page) => p.locator("body").innerText();
const has = async (p, ...texts) => {
  const until = Date.now() + 15000;
  for (;;) {
    const b = (await textOf(p)).replace(/\s+/g, " ");
    const missing = texts.find((t) => !b.includes(t));
    if (missing === undefined) return;
    if (Date.now() > until) throw new Error(`missing "${missing}"`);
    await p.waitForTimeout(250);
  }
};
const xlsx = async (name, headers, rows) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("البيانات");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const path = join(SHOTS, name);
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()));
  return path;
};
const csv = (name, lines) => { const path = join(SHOTS, name); writeFileSync(path, "﻿" + lines.join("\n")); return path; };
/** يرفع الملف للفحص، ويرجع نص نتيجة الفحص */
const upload = async (kind, path) => {
  await go(`/settings/import?kind=${kind}`);
  await page.locator("input[type=file][aria-label='ملف الاستيراد']").setInputFiles(path);
  await page.getByText("نتيجة الفحص").first().waitFor();
  await page.waitForTimeout(300);
};
const importNow = async () => {
  await page.getByRole("button", { name: /^استيراد \d+ صف$/ }).click();
  await page.getByText(/تم استيراد \d+ صف بنجاح/).first().waitFor();
};

await page.goto(BASE + "/"); await page.waitForURL(/onboarding/, { timeout: 120000 });
await page.fill("#name_ar", "فندق المستندات");
await page.selectOption("#country_code", "SA"); await page.selectOption("#base_currency", "SAR"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", "Asia/Riyadh");
await page.getByRole("button", { name: "إنشاء الفندق" }).click();
await page.waitForURL((u) => u.pathname === "/", { timeout: 120000 });

await step("import page lists every data type", async () => {
  await go("/settings/import");
  await has(page, "استيراد البيانات", "الغرف", "النزلاء", "العملاء", "أصناف المخزون", "الموظفون");
});
await step("template downloads as a real workbook", async () => {
  const r = await page.request.get(`${BASE}/api/import-template/customers`);
  if (r.status() !== 200) throw new Error(`status ${r.status()}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await r.body());
  const head = wb.worksheets[0].getRow(1).values.filter(Boolean);
  if (!head.includes("الرمز *") || !head.includes("الاسم بالعربية *")) throw new Error(`headers ${head.join("|")}`);
  if (!wb.getWorksheet("التعليمات")) throw new Error("no instructions sheet");
});
await step("customers file with errors is refused row by row", async () => {
  await upload("customers", csv("customers-bad.csv", [
    "الرمز,الاسم بالعربية,يسمح بالآجل,الحد الائتماني",
    "C001,شركة الأمل,نعم,50000",
    "C001,مكرر,لا,",
    "C@3,رمز خاطئ,لا,",
    "C004,قيمة خاطئة,ربما,abc",
  ]));
  await has(page, "مكرر مع الصف 2", "الرمز حروف إنجليزية وأرقام فقط", "يسمح بالآجل يُكتب نعم أو لا", "الحد الائتماني يجب أن يكون رقمًا موجبًا");
  if (await page.getByRole("button", { name: /^استيراد \d+ صف$/ }).isEnabled()) throw new Error("import enabled with errors");
});
await step("customers import (csv)", async () => {
  await upload("customers", csv("customers.csv", [
    "الرمز,الاسم بالعربية,النوع,يسمح بالآجل,الحد الائتماني,مدة السداد بالأيام",
    "C001,شركة الأمل للتجارة,شركة,نعم,50000,30",
    "C002,وكالة السفر الذهبية,وكالة سفر,لا,,",
  ]));
  await has(page, "صالحة 2");
  await importNow();
  await go("/customers"); await has(page, "شركة الأمل للتجارة", "وكالة السفر الذهبية");
});
await step("same customers again are refused as duplicates", async () => {
  await upload("customers", csv("customers.csv", ["الرمز,الاسم بالعربية", "C001,شركة الأمل للتجارة"]));
  await has(page, "الرمز موجود مسبقًا في النظام");
});
await step("room type for the rooms import", async () => {
  await go("/room-setup?new=1");
  await page.fill("#code", "DBL"); await page.fill("#name_ar", "غرفة مزدوجة"); await page.fill("#base_rate", "300");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/room-setup$/);
});
await step("rooms import with an unknown type, then fixed", async () => {
  const headers = ["رقم الغرفة", "رمز نوع الغرفة", "الطابق"];
  await upload("rooms", await xlsx("rooms-bad.xlsx", headers, [["101", "DBL", "الطابق الأول"], ["102", "XYZ", "الطابق الأول"]]));
  await has(page, "نوع الغرفة XYZ غير موجود");
  await upload("rooms", await xlsx("rooms.xlsx", headers, [["101", "DBL", "الطابق الأول"], ["102", "dbl", "الطابق الأول"], ["201", "DBL", "الطابق الثاني"]]));
  await has(page, "صالحة 3");
  await importNow();
  await go("/rooms"); await has(page, "101", "102", "201");
});
await step("guests import (xlsx with dates and id types)", async () => {
  await upload("guests", await xlsx("guests.xlsx", ["الاسم الكامل", "الجوال", "نوع الهوية", "رقم الهوية", "تاريخ الميلاد"], [
    ["أحمد محمد علي", "777123456", "بطاقة شخصية", "0101", new Date("1990-05-20")],
    ["سارة خالد", "", "جواز سفر", "P998877", "15/02/1988"],
  ]));
  await has(page, "صالحة 2");
  await importNow();
  await go("/guests"); await has(page, "أحمد محمد علي", "سارة خالد");
});
await step("inventory items import", async () => {
  await upload("items", await xlsx("items.xlsx", ["رمز الصنف", "الاسم بالعربية", "الوحدة", "حد إعادة الطلب", "رمز حساب الصرف"], [
    ["rice-5kg", "أرز بسمتي", "كيس", 10, "5101"],
    ["OIL", "زيت طبخ", "علبة", 5, "9999"],
  ]));
  await has(page, "حساب الصرف 9999 غير موجود");
  await upload("items", await xlsx("items.xlsx", ["رمز الصنف", "الاسم بالعربية", "الوحدة", "حد إعادة الطلب", "رمز حساب الصرف"], [
    ["rice-5kg", "أرز بسمتي", "كيس", 10, "5101"], ["OIL", "زيت طبخ", "علبة", 5, "5101"],
  ]));
  await importNow();
  await go("/inventory"); await has(page, "RICE-5KG", "زيت طبخ");
});
await step("employees import gets automatic numbers", async () => {
  await upload("employees", await xlsx("employees.xlsx", ["الاسم الكامل", "رمز القسم", "تاريخ التعيين", "الراتب الأساسي", "نوع العقد"], [
    ["سالم أحمد ناصر", "ROOMS", "2024-01-01", 150000, "دائم"],
    ["منى علي", "FNB", "2024-03-15", 120000, "محدد المدة"],
  ]));
  await has(page, "صالحة 2");
  await importNow();
  await go("/hr"); await has(page, "سالم أحمد ناصر", "منى علي");
});

let voucherId = "";
let customerId = "";
await step("credit invoice, credit note and receipt for the imported customer", async () => {
  await go("/invoices/new");
  await pick("#customer_id", /C001/);
  await pick(page.locator("select[aria-label]").first(), /EVENTS/);
  await page.locator("input[placeholder='سعر الوحدة']").fill("2000");
  await page.getByRole("button", { name: "إنشاء" }).click();
  await page.waitForURL(/invoices\/[0-9a-f-]{36}$/);
  await page.fill("input[placeholder='مبلغ الإشعار شامل الضريبة']", "500");
  await page.fill("input[placeholder='السبب']", "خصم تجاري");
  await page.getByRole("button", { name: "إشعار دائن" }).click();
  await page.getByText(/CN-\d{4}-\d{6}/).waitFor();
  await go("/vouchers/new?type=receipt");
  await pick("#customer_id", /C001/);
  await pick("#payment_method_id", /نقد/);
  await page.fill("#amount", "1000"); await page.fill("#description", "دفعة من شركة الأمل");
  await page.getByRole("button", { name: "تخصيص تلقائي للأقدم أولًا" }).click();
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/vouchers\/[0-9a-f-]{36}$/);
  voucherId = page.url().split("/").pop();
});
await step("printed receipt shows the amount in words", async () => {
  const [doc] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: "طباعة السند" }).click()]);
  await doc.waitForLoadState("networkidle");
  await has(doc, "سند قبض", "استلمنا من", "شركة الأمل للتجارة", "فقط ألف ريال سعودي لا غير", "المستلم");
  await doc.screenshot({ path: `${SHOTS}/doc-voucher.png`, fullPage: true });
  await doc.close();
});
await step("customer statement balances invoice, credit note and receipt", async () => {
  await go("/customers");
  await page.locator("a", { hasText: "شركة الأمل للتجارة" }).first().click();
  await page.waitForURL(/customers\/[0-9a-f-]{36}/);
  customerId = new URL(page.url()).pathname.split("/").pop();
  await has(page, "إشعار دائن", "سند قبض", "الرصيد المستحق", "دفعة من شركة الأمل", "INV-");
  const b = await textOf(page);
  if (!b.includes("500.00") && !b.includes("800.00")) throw new Error("closing balance not shown");
});
await step("printed customer statement", async () => {
  const doc = await context.newPage();
  await doc.goto(`${BASE}/print/customer-statement/${customerId}`); await doc.waitForLoadState("networkidle");
  await has(doc, "كشف حساب عميل", "شركة الأمل للتجارة", "الرصيد الافتتاحي", "الرصيد الختامي المستحق", "توقيع العميل بالمصادقة");
  await doc.screenshot({ path: `${SHOTS}/doc-statement.png`, fullPage: true });
  await doc.close();
});
await step("printed guest folio statement", async () => {
  await go("/folios/new");
  await page.fill("#guest_name", "نزيل الكشف"); await page.fill("#room_number", "101");
  await page.getByRole("button", { name: "فتح" }).click();
  await page.waitForURL(/folios\/[0-9a-f-]{36}$/);
  await pick("#charge_code_id", /ROOM/);
  await page.fill("#quantity", "2"); await page.fill("#unit_price", "300");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.getByText("تم التسجيل على الفوليو").first().waitFor();
  const [doc] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: "طباعة كشف الحساب" }).click()]);
  await doc.waitForLoadState("networkidle");
  await has(doc, "كشف حساب النزيل", "نزيل الكشف", "الرصيد الختامي المستحق", "توقيع النزيل");
  await doc.screenshot({ path: `${SHOTS}/doc-folio.png`, fullPage: true });
  await doc.close();
});
await step("voided receipt prints with the void mark", async () => {
  await go(`/vouchers/${voucherId}`);
  await page.getByPlaceholder("سبب الإلغاء").fill("خطأ في المبلغ");
  await page.getByRole("button", { name: "إلغاء السند" }).click();
  await page.getByText("تم إلغاء السند").first().waitFor();
  const doc = await context.newPage();
  await doc.goto(`${BASE}/print/voucher/${voucherId}`); await doc.waitForLoadState("networkidle");
  await has(doc, "ملغى", "خطأ في المبلغ");
  await doc.close();
});

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
process.exit(problems.length ? 1 : 0);

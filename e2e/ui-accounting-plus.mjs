// كشف حساب المورد، استيراد كشف البنك، المصروفات المقدمة: على بيانات تجريبية في متصفح حقيقي
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const B = process.env.BASE_URL ?? "http://127.0.0.1:3460";
const S = process.env.SHOTS ?? "/tmp";
const SHOTS = `${S}/shots-acc4`; mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ locale: "ar-SA", viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "nazeel_locale", value: "ar", url: B }]);
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.on("dialog", (d) => d.accept());
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
let ok = 0, fail = 0;
const step = async (name, fn) => {
  try { await fn(); ok++; console.log("✓", name); }
  catch (e) { fail++; console.log("✗", name, String(e.message).split("\n")[0]); await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_")}.png`, fullPage: true }).catch(() => {}); }
};
const go = async (p) => { await page.goto(B + p); await page.waitForLoadState("networkidle").catch(() => {}); };
const has = async (...t) => { for (const x of t) await page.getByText(x, { exact: false }).first().waitFor(); };
const num = (s) => Number(String(s).replace(/[^\d.\-]/g, ""));
const out = { vendors: [] };

await step("setup hotel with demo data", async () => {
  await go("/");
  await page.fill("#name_ar", "فندق المحاسبة");
  await page.selectOption("#country_code", "YE"); await page.selectOption("#base_currency", "YER");
  await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", "Asia/Aden");
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => !u.pathname.includes("onboarding"), { timeout: 120000 });
  await go("/settings/hotel");
  await page.locator("button", { hasText: "إنشاء بيانات تجريبية" }).click();
  await page.waitForURL((u) => u.pathname === "/" || u.pathname === "/front-desk", { timeout: 600000 });
});

await step("vendor statement for every vendor, with print", async () => {
  await go("/vendors");
  const hrefs = [...new Set(await page.locator("a[href^='/vendors/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")).filter((h) => /^\/vendors\/[0-9a-f-]{36}$/.test(h))))];
  if (!hrefs.length) throw new Error("no vendor statement links");
  for (const h of hrefs) {
    await go(`${h}?from=2000-01-01`);
    await has("كشف حساب", "الرصيد الافتتاحي");
    const last = page.locator("table.report-doc-table tbody tr").last();
    const label = await last.locator("td").first().innerText();
    const value = num(await last.locator("td").last().innerText());
    out.vendors.push({ id: h.split("/").pop(), closing: label.includes("مدين على المورد") ? -value : value });
  }
  await page.screenshot({ path: `${SHOTS}/vendor-statement.png`, fullPage: true });
  await go(`/print/vendor-statement/${out.vendors[0].id}?from=2000-01-01`);
  await has("كشف حساب مورد", "توقيع المورد بالمصادقة");
});

await step("bank import: check, import with auto-match, re-import skips duplicates, bad file refused", async () => {
  await go("/bank");
  const today = new Date().toISOString().slice(0, 10).split("-").reverse().join("/");
  const csv = `التاريخ,البيان,المرجع,المبلغ,الرصيد\n,رصيد افتتاحي,,,"10,000"\n${today},إيداع نقدي,DEP-1,"5,000.00","15,000"\n${today},عمولة بنكية,,(25),"14,975"\n${today},تحويل وارد,TR-9,"1,250.5","16,225.5"\n`;
  writeFileSync(`${S}/bank.csv`, csv);
  await page.getByTestId("bank-import-file").setInputFiles(`${S}/bank.csv`);
  await has("الأعمدة المعروفة", "إيداع نقدي", "صفوف أرصدة ومجاميع تُتخطى");
  await page.screenshot({ path: `${SHOTS}/bank-check.png`, fullPage: true });
  await page.getByTestId("bank-import-run").click();
  await has("استُورد 3 سطر");
  for (const t of ["DEP-1", "TR-9", "عمولة بنكية"]) await page.locator("main table").getByText(t).first().waitFor();
  // نفس الملف مرة ثانية: كل أسطره مستوردة، فلا يُستورد شيء
  await page.getByTestId("bank-import-file").setInputFiles(`${S}/bank.csv`);
  await has("مستوردة من قبل وتُتخطى");
  if (await page.getByTestId("bank-import-run").isEnabled()) throw new Error("duplicate import allowed");
  // ملف بلا عمود تاريخ
  writeFileSync(`${S}/bad.csv`, "البيان,المبلغ\nx,5\n");
  await page.getByTestId("bank-import-file").setInputFiles(`${S}/bad.csv`);
  await has("لم يُعرف عمود التاريخ");
  // تاريخ خاطئ: يُعرض الخطأ ويُمنع الاستيراد
  writeFileSync(`${S}/bad2.csv`, "التاريخ,البيان,المبلغ\n2026-13-40,x,5\n");
  await page.getByTestId("bank-import-file").setInputFiles(`${S}/bad2.csv`);
  await has("تاريخ غير مفهوم");
  if (await page.getByTestId("bank-import-run").isEnabled()) throw new Error("import allowed with errors");
});

await step("bank import: US-format dates are detected, ambiguous files ask for the order", async () => {
  await go("/bank");
  writeFileSync(`${S}/us.csv`, "Date,Description,Amount\n03/15/2026,US deposit,700\n03/02/2026,US fee,-7\n");
  await page.getByTestId("bank-import-file").setInputFiles(`${S}/us.csv`);
  await has("US deposit", "2026-03-15", "2026-03-02");
  if (await page.getByTestId("bank-date-order").count()) throw new Error("unambiguous file asked for date order");
  writeFileSync(`${S}/amb.csv`, "التاريخ,البيان,المبلغ\n03/02/2026,حركة ملتبسة,90\n");
  await page.getByTestId("bank-import-file").setInputFiles(`${S}/amb.csv`);
  await page.getByTestId("bank-date-order").waitFor();
  await has("2026-02-03");
  await page.getByTestId("bank-date-order").locator("select").selectOption("mdy");
  await has("2026-03-02");
  await page.getByTestId("bank-import-run").click();
  await has("استُورد 1 سطر");
  await page.locator("main table").getByText("2026-03-02").first().waitFor();
  writeFileSync(`${S}/mixed.csv`, "التاريخ,البيان,المبلغ\n31/01/2026,a,1\n01/31/2026,b,2\n");
  await page.getByTestId("bank-import-file").setInputFiles(`${S}/mixed.csv`);
  await has("التواريخ في الملف مختلطة");
});

await step("prepaid expense: create, post due installments, stop", async () => {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 3);
  const start = d.toISOString().slice(0, 10);
  await go("/prepaid-expenses");
  await has("لا توجد مصروفات مقدمة");
  await go("/prepaid-expenses?new=1");
  await page.fill("#pp_name", "إيجار المستودع");
  await page.fill("#pp_amount", "1200");
  await page.fill("#pp_months", "12");
  await page.fill("#pp_start", start);
  const opt = await page.locator("#pp_expense option").nth(1).getAttribute("value");
  await page.selectOption("#pp_expense", opt);
  await has("القسط الشهري");
  await page.getByRole("button", { name: "حفظ الجدول" }).click();
  await page.waitForURL((u) => u.pathname === "/prepaid-expenses" && !u.search.includes("new"));
  await has("إيجار المستودع", "مستحق 3");
  await page.getByRole("button", { name: /ترحيل الأقساط المستحقة/ }).click();
  await has("رُحّل 3 قسط");
  await page.reload();
  const row = page.locator("[data-prepaid='إيجار المستودع']");
  const t = await row.innerText();
  if (!t.includes("3 / 12") || !t.includes("300")) throw new Error(`row after posting: ${t}`);
  await page.screenshot({ path: `${SHOTS}/prepaid.png`, fullPage: true });
  await row.getByRole("link", { name: "آخر قيد" }).click();
  await has("إطفاء مصروف مقدم");
  await go("/prepaid-expenses");
  await page.locator("[data-prepaid='إيجار المستودع']").getByRole("button", { name: "إيقاف" }).click();
  await has("أُوقف التوزيع");
  await page.reload();
  if (!(await page.locator("[data-prepaid='إيجار المستودع']").innerText()).includes("موقوف")) throw new Error("not stopped");
});

await step("mobile: new pages fit the screen", async () => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const p of ["/prepaid-expenses", `/vendors/${out.vendors[0].id}`, "/bank"]) {
    await go(p);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 2) throw new Error(`${p} overflows by ${over}px`);
    await page.screenshot({ path: `${SHOTS}/m${p.replace(/\W+/g, "_")}.png`, fullPage: false });
  }
});

writeFileSync(`${S}/acc4-out.json`, JSON.stringify(out));
await browser.close();
console.log(`\n${ok} ok, ${fail} failed`);
console.log(`problems (${problems.length}):`); for (const p of problems) console.log(" ", p);
process.exit(fail || problems.length ? 1 : 0);

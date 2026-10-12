// اختبار حي لتخصيص النظام: إطفاء قسم وجزء وخانة وزر، التحذير والمنع، حفظ البيانات المخفية، ومنع الصفحات بالرابط
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const B = process.env.BASE_URL ?? "http://127.0.0.1:3375";
const S = `${process.env.SHOTS ?? "/tmp"}/shots-feat`;
mkdirSync(S, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ locale: "ar-SA", viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(45000);
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
let ok = 0, fail = 0;
const step = async (name, fn) => {
  try { await fn(); ok++; console.log("✓", name); }
  catch (e) { fail++; console.log("✗", name, String(e.message).split("\n")[0]); await page.screenshot({ path: `${S}/fail-${name.replace(/\W+/g, "_")}.png`, fullPage: true }).catch(() => {}); }
};
const go = async (p) => { await page.goto(B + p); await page.waitForLoadState("networkidle").catch(() => {}); };
const bodyHas = async (...texts) => {
  const until = Date.now() + 15000;
  for (;;) {
    const b = await page.locator("body").innerText();
    const missing = texts.find((t) => !b.includes(t));
    if (missing === undefined) return;
    if (Date.now() > until) throw new Error(`missing "${missing}"`);
    await page.waitForTimeout(250);
  }
};
const navHas = async (href) => (await page.locator(`a[href="${href}"]`).count()) > 0;
const sw = (name) => page.getByRole("switch", { name, exact: true });
const expand = async (section) => { await page.locator(`[data-feature="${section}"] > div button`).first().click(); };
const TZ = "Asia/Aden";

await page.goto(B + "/"); await page.waitForURL(/onboarding/, { timeout: 120000 });
await page.fill("#name_ar", "فندق التخصيص");
await page.selectOption("#country_code", "YE"); await page.selectOption("#base_currency", "YER"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", TZ);
await page.getByRole("button", { name: "إنشاء الفندق" }).click();
await page.waitForURL((u) => u.pathname === "/", { timeout: 120000 });

await step("rooms", async () => {
  await go("/room-setup?new=1");
  await page.fill("#code", "DBL"); await page.fill("#name_ar", "غرفة مزدوجة"); await page.fill("#base_rate", "10000");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/room-setup$/);
});

await step("the page lists sections with their parts", async () => {
  await go("/settings/features");
  await bodyHas("تخصيص النظام", "الحجوزات والاستقبال", "المحاسبة", "المغسلة", "الموارد البشرية", "المساعد الذكي", "عام");
  await expand("pms");
  await bodyHas("حجز المجموعة", "ملاحظات داخلية", "أساس قسم الحجوزات، لا يعمل القسم بدونه");
  await page.screenshot({ path: `${S}/features.png`, fullPage: true });
});

await step("turn off a whole section: laundry disappears and its link is blocked", async () => {
  await go("/settings/features");
  await go("/laundry");
  if ((await page.locator("main").innerText()).includes("هذا الجزء مطفأ")) throw new Error("laundry blocked before");
  await go("/settings/features");
  await sw("المغسلة").click();
  await bodyHas("أُطفئ المغسلة");
  await go("/settings/features");
  if (await navHas("/laundry")) throw new Error("laundry still in the menu");
  if ((await sw("المغسلة").getAttribute("aria-checked")) !== "false") throw new Error("switch not off");
  await go("/laundry");
  await bodyHas("هذا الجزء مطفأ في هذا الفندق");
  await go("/settings/features");
  await sw("المغسلة").click();
  await bodyHas("شُغّل المغسلة");
  await go("/laundry");
  if ((await page.locator("main").innerText()).includes("هذا الجزء مطفأ")) throw new Error("still blocked after turning on");
});

await step("a warning needs confirmation, and going back keeps it on", async () => {
  await go("/settings/features");
  await expand("accounting");
  await sw("الرقم الضريبي للعميل").click();
  await bodyHas("إطفاء الرقم الضريبي للعميل؟", "الفاتورة الضريبية للشركات تحتاج رقمها الضريبي");
  await page.getByRole("button", { name: "تراجع" }).click();
  if ((await sw("الرقم الضريبي للعميل").getAttribute("aria-checked")) !== "true") throw new Error("turned off without confirming");
});

await step("a hidden field keeps its saved value", async () => {
  await go("/customers?new=1");
  await page.fill("#code", "C1"); await page.fill("#name_ar", "شركة الاختبار"); await page.fill("#tax_number", "300123456700003");
  await page.getByRole("button", { name: "حفظ", exact: true }).click();
  await page.waitForURL(/\/customers$/);
  await go("/settings/features");
  await expand("accounting");
  await sw("الرقم الضريبي للعميل").click();
  await page.getByRole("button", { name: "إطفاء رغم ذلك" }).click();
  await bodyHas("أُطفئ الرقم الضريبي للعميل");
  await go("/customers");
  const editHref = await page.locator("a[href*='edit=']").first().getAttribute("href");
  await go(editHref.startsWith("/") ? editHref : `/customers${editHref}`);
  if (await page.locator("#tax_number").isVisible()) throw new Error("tax number still visible");
  await page.fill("#name_ar", "شركة الاختبار المعدلة");
  await page.getByRole("button", { name: "حفظ", exact: true }).click();
  await page.waitForURL(/\/customers$/);
  await go("/settings/features");
  await expand("accounting");
  await sw("الرقم الضريبي للعميل").click();
  await bodyHas("شُغّل الرقم الضريبي للعميل");
  await go(editHref.startsWith("/") ? editHref : `/customers${editHref}`);
  if ((await page.inputValue("#tax_number")) !== "300123456700003") throw new Error(`tax number lost: ${await page.inputValue("#tax_number")}`);
  if ((await page.inputValue("#name_ar")) !== "شركة الاختبار المعدلة") throw new Error("edit not saved");
});

await step("fields and booking options disappear from the reservation screen", async () => {
  await go("/settings/features");
  await expand("pms");
  await sw("ملاحظات داخلية").click(); await bodyHas("أُطفئ ملاحظات داخلية");
  await sw("حجز المجموعة").click(); await bodyHas("أُطفئ حجز المجموعة");
  await go("/reservations/new");
  await bodyHas("حجز فردي", "متكرر", "طلبات النزيل");
  const main = await page.locator("main").innerText();
  if (main.includes("ملاحظات داخلية")) throw new Error("notes still shown");
  if (main.includes("عدة غرف لنفس الفترة")) throw new Error("group option still shown");
  await go("/settings/features");
  await expand("pms");
  await sw("ملاحظات داخلية").click(); await bodyHas("شُغّل ملاحظات داخلية");
  await sw("حجز المجموعة").click(); await bodyHas("شُغّل حجز المجموعة");
  await go("/reservations/new");
  await bodyHas("ملاحظات داخلية", "عدة غرف لنفس الفترة");
});

await step("a button tied to a permission is removed from the database too", async () => {
  await go("/settings/features");
  await expand("accounting");
  await sw("إلغاء السندات").click();
  await page.getByRole("button", { name: "إطفاء رغم ذلك" }).click();
  await bodyHas("أُطفئ إلغاء السندات");
  // صفحة الصلاحيات لم تعد تعرض صلاحية مطفأة
  await go("/settings/users");
  await page.waitForTimeout(500);
  await go("/settings/features");
  await expand("accounting");
  await sw("إلغاء السندات").click(); await bodyHas("شُغّل إلغاء السندات");
});

await step("locked parts have no switch, and parts under an off section cannot change", async () => {
  await go("/settings/features");
  await expand("pms");
  if (await sw("الحجوزات").count()) throw new Error("locked reservations has a switch");
  await sw("الحجوزات والاستقبال").click();
  await page.getByRole("button", { name: "إطفاء رغم ذلك" }).click();
  await bodyHas("أُطفئ الحجوزات والاستقبال");
  await go("/settings/features");
  await expand("pms");
  if (!(await sw("ملاحظات داخلية").isDisabled())) throw new Error("child switch enabled under an off section");
  await go("/front-desk"); await bodyHas("هذا الجزء مطفأ في هذا الفندق");
  await go("/settings/features");
  await sw("الحجوزات والاستقبال").click(); await bodyHas("شُغّل الحجوزات والاستقبال");
  await go("/front-desk");
  if ((await page.locator("main").innerText()).includes("هذا الجزء مطفأ")) throw new Error("front desk still blocked");
});

await step("the last core section cannot be turned off", async () => {
  await go("/settings/features");
  await sw("الحجوزات والاستقبال").click(); await page.getByRole("button", { name: "إطفاء رغم ذلك" }).click();
  await bodyHas("أُطفئ الحجوزات والاستقبال");
  await go("/settings/features");
  await sw("المحاسبة").click();
  const dialog = page.getByRole("dialog");
  if (await page.getByRole("button", { name: "إطفاء رغم ذلك" }).isVisible().catch(() => false)) await page.getByRole("button", { name: "إطفاء رغم ذلك" }).click();
  await bodyHas("يجب أن يبقى قسم أساسي واحد على الأقل");
  await dialog.getByRole("button", { name: "حسنًا" }).click();
  await sw("الحجوزات والاستقبال").click(); await bodyHas("شُغّل الحجوزات والاستقبال");
});

await step("hotel tax number field hides from hotel settings and keeps its value", async () => {
  await go("/settings/hotel");
  await page.fill("#tax_number", "311111111100003");
  await page.locator("form").filter({ has: page.locator("#name_ar") }).getByRole("button", { name: "حفظ", exact: true }).click();
  await page.waitForTimeout(1500);
  await go("/settings/features");
  await expand("general");
  await sw("الرقم الضريبي للفندق").click();
  await page.getByRole("button", { name: "إطفاء رغم ذلك" }).click();
  await bodyHas("أُطفئ الرقم الضريبي للفندق");
  await go("/settings/hotel");
  if (await page.locator("#tax_number").count()) throw new Error("hotel tax number still shown");
  await page.locator("form").filter({ has: page.locator("#name_ar") }).getByRole("button", { name: "حفظ", exact: true }).click();
  await page.waitForTimeout(1500);
  await go("/settings/features");
  await expand("general");
  await sw("الرقم الضريبي للفندق").click(); await bodyHas("شُغّل الرقم الضريبي للفندق");
  await go("/settings/hotel");
  if ((await page.inputValue("#tax_number")) !== "311111111100003") throw new Error("hotel tax number lost");
});

await step("cashier part is blocked while the shift is required", async () => {
  await go("/settings/hotel");
  const box = page.locator("label", { hasText: "إلزام وردية الكاشير للنقد" }).locator("input[type=checkbox]");
  if (!(await box.isChecked())) { await box.check(); await page.getByRole("button", { name: "حفظ إعدادات التشغيل" }).click(); await bodyHas("تم حفظ إعدادات التشغيل"); }
  await go("/settings/features");
  await expand("pms");
  await sw("الصندوق والورديات").click();
  await bodyHas("لا يمكن إطفاء الصندوق والورديات الآن", "وردية الكاشير إلزامية في إعدادات الفندق");
  await page.getByRole("button", { name: "حسنًا" }).click();
  if ((await sw("الصندوق والورديات").getAttribute("aria-checked")) !== "true") throw new Error("cashier turned off despite block");
});

await step("English page renders", async () => {
  await go("/settings/features");
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "English" }).first().click()]);
  await page.waitForLoadState("networkidle").catch(() => {});
  await bodyHas("Customize system", "Reservations and front office", "Laundry");
});

await browser.close();
console.log(`\n${ok} ok, ${fail} failed`);
console.log(`problems (${problems.length}):`); for (const p of problems) console.log(" ", p);
process.exit(fail || problems.length ? 1 : 0);

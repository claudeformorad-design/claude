import { chromium } from "playwright";
const B = process.env.BASE_URL ?? "http://127.0.0.1:3390";
const SHOTS = `${process.env.SHOTS ?? "/tmp"}/shots-panel-admin`;
import { mkdirSync } from "node:fs"; mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ locale: "ar-SA", viewport: { width: 1360, height: 900 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("dialog", (d) => d.accept());
let ok = 0, fail = 0;
const step = async (name, fn) => {
  try { await fn(); ok++; console.log("✓", name); }
  catch (e) { fail++; console.log("✗", name, String(e.message).split("\n")[0]); await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_")}.png`, fullPage: true }).catch(() => {}); }
};
const has = async (...t) => { for (const x of t) await page.getByText(x, { exact: false }).first().waitFor(); };
let code = "", hotelUrl = "";

await step("first visit goes to setup; wrong code refused", async () => {
  await page.goto(B + "/");
  await page.waitForURL(/\/setup$/);
  await has("مرحبًا بك في لوحة هوتيلنا", "كود الإعداد");
  await page.fill("#code", "nope-nope");
  await page.getByRole("button", { name: "التالي" }).click();
  await has("كود الإعداد غير صحيح");
  await page.screenshot({ path: `${SHOTS}/setup-1.png` });
});
await step("weak passwords cannot be used; strong one signs in", async () => {
  await page.fill("#code", "setup-code-xyz");
  await page.getByRole("button", { name: "التالي" }).click();
  await page.locator("#password").waitFor();
  const submit = page.getByRole("button", { name: "إنشاء كلمة المرور والدخول" });
  await page.fill("#password", "onlyletters"); await page.fill("#confirm", "onlyletters");
  if (await submit.isEnabled()) throw new Error("weak password accepted");
  if ((await page.getByTestId("strength").innerText()) === "قوية") throw new Error("weak shown as strong");
  await page.fill("#password", "Secret-pass-123!"); await page.fill("#confirm", "Secret-pass-12");
  await has("غير مطابقة");
  if (await submit.isEnabled()) throw new Error("mismatch accepted");
  await page.fill("#confirm", "Secret-pass-123!");
  await has("قوية");
  await page.screenshot({ path: `${SHOTS}/setup-2.png` });
  await submit.click();
  await page.waitForURL((u) => u.pathname === "/");
  await has("أضف أول فندق");
  await page.goto(B + "/setup"); await page.waitForURL(/\/(login)?$/);
});
await step("new hotel issues an activation code", async () => {
  await page.goto(B + "/hotels/new");
  await page.fill("#name", "فندق السلام"); await page.fill("#contact", "أحمد 777123456");
  await page.getByLabel("المغسلة").check();
  await page.getByRole("button", { name: "حفظ وإصدار كود الربط" }).click();
  await page.waitForURL(/\/hotels\/[0-9a-f-]{36}\?created=1$/);
  hotelUrl = page.url().replace("?created=1", "");
  code = (await page.locator("p.num").filter({ hasText: /^NZL-/ }).innerText()).trim();
  if (!/^NZL-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) throw new Error(`bad code ${code}`);
  await has("أُضيف الفندق", "أرسل الكود للفندق", "واتساب");
  await page.screenshot({ path: `${SHOTS}/hotel.png`, fullPage: true });
});
await step("fine-grained control: sections, details inside them, and staff permissions", async () => {
  const sw = (name) => page.getByRole("switch", { name, exact: true });
  // لا بد من قسم أساسي: إطفاء أحدهما يقفل الآخر
  await sw("الحجوزات والاستقبال: مشترى").click();
  if (!(await sw("المحاسبة: مشترى").isDisabled())) throw new Error("last core section can be turned off");
  await page.getByRole("button", { name: "تراجع" }).click();
  await sw("الموارد البشرية: مشترى").click();
  // تفاصيل داخل قسم: صفحة الكاشير وزر إلغاء حركة على الفوليو
  await page.locator("[data-section=pms] button[aria-expanded]").click();
  await page.locator("[data-node='pms.cashier']").getByRole("switch").click();
  await page.locator("[data-section=accounting] button[aria-expanded]").click();
  await page.locator("[data-node='folio.void']").getByRole("switch").click();
  // الأساسي مقفل ولا مفتاح له
  if (await page.locator("[data-node='accounting.journal']").getByRole("switch").count()) throw new Error("locked node has a switch");
  for (const sec of ["pms", "accounting"]) await page.locator(`[data-section=${sec}]`).getByText("1 موقوف").waitFor();
  // البحث يجد الخانة داخل القسم
  await page.getByPlaceholder("ابحث عن صفحة أو خانة أو زر").fill("جنسية");
  await page.locator("[data-node='guests.nationality']").waitFor();
  if (await page.locator("[data-section=hr]").count()) throw new Error("search did not filter");
  await page.getByPlaceholder("ابحث عن صفحة أو خانة أو زر").fill("");
  await page.screenshot({ path: `${SHOTS}/control-sections.png`, fullPage: true });
  // الصلاحيات: إيقاف صلاحية حتى عن المدير، وإدارة المستخدمين لا تُوقف
  await page.getByRole("tab", { name: /الصلاحيات/ }).click();
  await page.locator("[data-permission='invoices.write_off']").getByRole("switch").click();
  if (await page.locator("[data-permission='settings.users.manage']").getByRole("switch").count()) throw new Error("users.manage can be blocked");
  await page.screenshot({ path: `${SHOTS}/control-permissions.png`, fullPage: true });
  await page.getByTestId("control-save").click();
  await has("حُفظ. يصل التغيير لنظام الفندق");
  await page.goto(hotelUrl);
  if ((await sw("الموارد البشرية: مشترى").getAttribute("aria-checked")) !== "true") throw new Error("hr not saved");
  await page.locator("[data-section=pms] button[aria-expanded]").click();
  if ((await page.locator("[data-node='pms.cashier']").getByRole("switch").getAttribute("aria-checked")) !== "false") throw new Error("cashier block not saved");
  await page.getByRole("tab", { name: /الصلاحيات/ }).click();
  if ((await page.locator("[data-permission='invoices.write_off']").getByRole("switch").getAttribute("aria-checked")) !== "false") throw new Error("permission block not saved");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: /الأقسام/ }).click();
  await page.locator("[data-section=pms] button[aria-expanded]").click();
  await page.screenshot({ path: `${SHOTS}/control-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1360, height: 900 });
});
await step("details form saves separately", async () => {
  await page.goto(hotelUrl);
  await page.fill("#notes", "بيع بسعر خاص");
  await page.getByRole("button", { name: "حفظ البيانات" }).click();
  await has("حُفظت بيانات الفندق");
});
await step("activation through the API, then the hotel shows as linked", async () => {
  const r = await page.request.post(B + "/api/v1/activate", { data: { code, mode: "installer", machine: "ABCD-1234-EF56", version: "1.0.0" } });
  if (r.status() !== 200) throw new Error(`activate ${r.status()}`);
  const j = await r.json();
  if (!j.license || !j.secret || !j.instance_id) throw new Error("missing fields");
  await page.goto(B + "/hotels");
  await has("فندق السلام", "على جهاز", "الآن");
  await page.goto(hotelUrl);
  await has("متصل الآن", "على جهاز", "نقل الفندق لجهاز أو موقع آخر");
});
await step("suspend and reactivate", async () => {
  await page.getByRole("button", { name: "إيقاف الفندق" }).click();
  await has("هذا الفندق موقوف");
  await page.getByRole("button", { name: "إعادة التفعيل" }).click();
  await page.getByRole("button", { name: "إيقاف الفندق" }).waitFor();
});
await step("notices: all hotels, specific hotels, delete", async () => {
  await page.goto(B + "/notices");
  await page.fill("#title", "تحديث جديد"); await page.fill("#body", "أضفنا كشف الشرطة.");
  await page.getByRole("button", { name: "إرسال" }).click();
  await has("أُرسل الإشعار", "تحديث جديد", "كل الفنادق");
  await page.fill("#title", "صيانة الخادم"); await page.fill("#body", "توقف ساعة الليلة.");
  await page.getByLabel("مهم، يبقى ظاهرًا").check(); await page.getByLabel("فنادق محددة").check();
  await page.getByRole("button", { name: "إرسال" }).click();
  await has("اختر فندقًا واحدًا على الأقل");
  await page.fill("#title", "صيانة الخادم"); await page.fill("#body", "توقف ساعة الليلة.");
  await page.getByLabel("مهم، يبقى ظاهرًا").check(); await page.getByLabel("فنادق محددة").check(); await page.getByLabel("فندق السلام").check();
  await page.getByRole("button", { name: "إرسال" }).click();
  await has("صيانة الخادم", "مهم");
  await page.screenshot({ path: `${SHOTS}/notices.png`, fullPage: true });
  await page.locator("article").filter({ hasText: "تحديث جديد" }).getByRole("button", { name: "حذف" }).click();
  await page.waitForTimeout(800); await page.reload();
  if ((await page.locator("article").filter({ hasText: "تحديث جديد" }).count()) !== 0) throw new Error("notice not deleted");
});
await step("settings shows the public key; logout and login", async () => {
  await page.goto(B + "/settings");
  const key = await page.getByLabel("المفتاح العام").inputValue();
  const api = await (await page.request.get(B + "/api/v1/public-key")).json();
  if (!key || key !== api.public_key) throw new Error("public key mismatch");
  await page.getByRole("button", { name: "خروج" }).click();
  await page.waitForURL(/\/login$/);
  await page.goto(B + "/notices"); await page.waitForURL(/\/login$/);
  await page.fill("#password", "wrong-password"); await page.getByRole("button", { name: "دخول" }).click();
  await has("كلمة المرور غير صحيحة");
  await page.fill("#password", "Secret-pass-123!"); await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForURL((u) => u.pathname === "/");
});
await step("server actions refuse without a session", async () => {
  const anon = await browser.newContext();
  const p2 = await anon.newPage();
  await p2.goto(B + hotelUrl.replace(B, ""));
  await p2.waitForURL(/\/login$/);
  await anon.close();
});

await step("forgot password: recovery code sets a new one", async () => {
  await ctx.clearCookies();
  await page.goto(B + "/login");
  await page.getByRole("link", { name: "نسيت كلمة المرور؟" }).click();
  await page.waitForURL(/\/reset$/);
  await page.fill("#code", "wrong-code-99"); await page.getByRole("button", { name: "التالي" }).click();
  await has("كود الاستعادة غير صحيح");
  await page.fill("#code", "rcvr 7k2m 9qxa"); await page.getByRole("button", { name: "التالي" }).click();
  await page.fill("#password", "Brand-new-pass-1!"); await page.fill("#confirm", "Brand-new-pass-1!");
  await page.getByRole("button", { name: "حفظ كلمة المرور والدخول" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await ctx.clearCookies();
  await page.goto(B + "/reset");
  await page.fill("#code", "RCVR-7K2M-9QXA"); await page.getByRole("button", { name: "التالي" }).click();
  await has("هذا الكود استُخدم من قبل");
});

await browser.close();
console.log(`\n${ok} ok, ${fail} failed`);
console.log(`problems (${problems.length}):`); for (const p of problems) console.log(" ", p);
process.exit(fail || problems.length ? 1 : 0);

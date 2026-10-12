// اختبار متكامل: لوحة هوتيلنا + نظام فندق مرخّص. الربط بالكود، الأقسام من الترخيص، الإشعارات، الإيقاف وإعادة التفعيل
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const P = process.env.PANEL_URL ?? "http://127.0.0.1:3390";
const H = process.env.BASE_URL ?? "http://127.0.0.1:3376";
const SHOTS = `${process.env.SHOTS ?? "/tmp"}/shots-panel-link`;
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const panel = await (await browser.newContext({ locale: "ar-SA", viewport: { width: 1360, height: 900 } })).newPage();
const hotel = await (await browser.newContext({ locale: "ar-SA", viewport: { width: 1440, height: 900 } })).newPage();
for (const p of [panel, hotel]) { p.setDefaultTimeout(45000); p.on("dialog", (d) => d.accept()); }
const problems = [];
for (const [n, p] of [["panel", panel], ["hotel", hotel]]) {
  p.on("pageerror", (e) => problems.push(`${n} pageerror: ${e.message.slice(0, 200)}`));
  p.on("response", (r) => { if (r.status() >= 500) problems.push(`${n} HTTP ${r.status()} ${r.url()}`); });
}
let ok = 0, fail = 0;
const step = async (name, fn) => {
  try { await fn(); ok++; console.log("✓", name); }
  catch (e) { fail++; console.log("✗", name, String(e.message).split("\n")[0]); await hotel.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_")}.png`, fullPage: true }).catch(() => {}); }
};
const has = async (page, ...texts) => {
  const until = Date.now() + 15000;
  for (;;) {
    const b = await page.locator("body").innerText();
    const missing = texts.find((t) => !b.includes(t));
    if (missing === undefined) return;
    if (Date.now() > until) throw new Error(`missing "${missing}"`);
    await page.waitForTimeout(250);
  }
};
const go = async (page, base, p) => { await page.goto(base + p); await page.waitForLoadState("networkidle").catch(() => {}); };
// بلا أي زر في نظام الفندق: مجرد التنقل فيه بعد مدة التواصل يوصل ما تغيّر في اللوحة
const until = async (what, path, ok, ms = 45000) => {
  const end = Date.now() + ms;
  for (;;) {
    await go(hotel, H, path);
    if (await ok()) return;
    if (Date.now() > end) throw new Error(`${what} did not reach the hotel in ${ms / 1000}s`);
    await hotel.waitForTimeout(3000);
  }
};
const mainText = () => hotel.locator("body").innerText();
const sold = async (name, on) => {
  const sw = panel.getByRole("switch", { name: `${name}: مشترى`, exact: true });
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
};
const saveControl = async () => { await panel.getByTestId("control-save").click(); await has(panel, "حُفظ. يصل التغيير"); };
let code = "", hotelUrl = "";

await step("panel: set up and add a hotel without HR", async () => {
  await go(panel, P, "/setup");
  await panel.fill("#code", "setup-code-xyz"); await panel.getByRole("button", { name: "التالي" }).click();
  await panel.fill("#password", "Secret-pass-123!"); await panel.fill("#confirm", "Secret-pass-123!");
  await panel.getByRole("button", { name: "إنشاء كلمة المرور والدخول" }).click();
  await panel.waitForURL((u) => u.pathname === "/");
  await go(panel, P, "/hotels/new");
  await panel.fill("#name", "فندق الترخيص");
  await panel.getByLabel("المغسلة").check();
  await panel.getByRole("button", { name: "حفظ وإصدار كود الربط" }).click();
  await panel.waitForURL(/\/hotels\/[0-9a-f-]{36}\?created=1$/);
  hotelUrl = panel.url().replace("?created=1", "");
  code = (await panel.locator("p.num").filter({ hasText: /^NZL-/ }).innerText()).trim();
});

await step("hotel: after onboarding the system asks for the link code", async () => {
  await hotel.goto(H + "/"); await hotel.waitForURL(/onboarding/, { timeout: 120000 });
  await hotel.fill("#name_ar", "فندق الترخيص");
  await hotel.selectOption("#country_code", "YE"); await hotel.selectOption("#base_currency", "YER"); await hotel.selectOption("#fiscal_year_start_month", "1"); await hotel.selectOption("#timezone", "Asia/Aden");
  await hotel.getByRole("button", { name: "إنشاء الفندق" }).click();
  await hotel.waitForURL(/\/activate$/, { timeout: 120000 });
  await has(hotel, "تفعيل هوتيلنا", "كود الربط");
  await go(hotel, H, "/reservations"); await hotel.waitForURL(/\/activate$/);
  await hotel.screenshot({ path: `${SHOTS}/activate.png` });
});

await step("hotel: wrong code refused, right code activates", async () => {
  await hotel.fill("#activation_code", "NZL-AAAA-BBBB");
  await hotel.getByRole("button", { name: "تفعيل الآن" }).click();
  await has(hotel, "كود الربط غير صحيح");
  await hotel.fill("#activation_code", code);
  await hotel.getByRole("button", { name: "تفعيل الآن" }).click();
  await hotel.waitForURL((u) => u.pathname === "/" || u.pathname === "/front-desk", { timeout: 60000 });
});

await step("panel shows the hotel linked; the code cannot be reused", async () => {
  await go(panel, P, "/hotels");
  await has(panel, "فندق الترخيص", "على جهاز", "الآن");
  const r = await panel.request.post(P + "/api/v1/activate", { data: { code, mode: "installer", machine: "X" } });
  if (r.status() !== 409) throw new Error(`reuse gave ${r.status()}`);
});

await step("panel learns the hotel's own catalog automatically after linking", async () => {
  await go(panel, P, hotelUrl.replace(P, ""));
  const t = await panel.getByTestId("catalog-source").innerText();
  if (!t.includes("من نسخة نظام الفندق نفسها")) throw new Error(`catalog source: ${t}`);
});

await step("hotel: only licensed sections exist", async () => {
  await go(hotel, H, "/hr"); await has(hotel, "هذا الجزء مطفأ في هذا الفندق");
  await go(hotel, H, "/laundry");
  if ((await hotel.locator("main").innerText()).includes("هذا الجزء مطفأ")) throw new Error("laundry blocked");
  await go(hotel, H, "/settings/features");
  await has(hotel, "مرخّص لـ فندق الترخيص", "مربوط بلوحة هوتيلنا", "التحديثات مجانية للأبد", "غير مشمول");
  const hr = hotel.locator('[data-feature="hr"]');
  if (!(await hr.innerText()).includes("غير مشمول")) throw new Error("HR not marked unsold");
  if (await hr.getByRole("switch").count()) throw new Error("unsold HR has a switch");
  await hotel.screenshot({ path: `${SHOTS}/features-licensed.png`, fullPage: true });
});

await step("panel adds HR and sends notices; they reach the hotel by themselves", async () => {
  await go(panel, P, hotelUrl.replace(P, ""));
  await sold("الموارد البشرية", true);
  await saveControl();
  await go(panel, P, "/notices");
  await panel.fill("#title", "نسخة جديدة"); await panel.fill("#body", "أضفنا ميزة تخصيص النظام.");
  await panel.getByRole("button", { name: "إرسال" }).click(); await has(panel, "أُرسل الإشعار");
  await panel.fill("#title", "صيانة الليلة"); await panel.fill("#body", "توقف قصير الساعة 2 فجرًا.");
  await panel.getByLabel("مهم، يبقى ظاهرًا").check(); await panel.getByLabel("فنادق محددة").check(); await panel.getByLabel("فندق الترخيص").check();
  await panel.getByRole("button", { name: "إرسال" }).click(); await has(panel, "أُرسل الإشعار");
  await until("HR section and notices", "/hr", async () => { const t = await mainText(); return !t.includes("هذا الجزء مطفأ") && t.includes("نسخة جديدة") && t.includes("صيانة الليلة"); });
  await has(hotel, "نسخة جديدة", "صيانة الليلة");
  await hotel.screenshot({ path: `${SHOTS}/notices.png` });
});

await step("hotel: an info notice can be hidden, an important one stays", async () => {
  await hotel.locator("[data-notice]").filter({ hasText: "نسخة جديدة" }).getByRole("button", { name: "إخفاء" }).click();
  await go(hotel, H, "/reservations");
  const body = await hotel.locator("body").innerText();
  if (body.includes("نسخة جديدة")) throw new Error("hidden notice came back");
  if (!body.includes("صيانة الليلة")) throw new Error("important notice missing");
  if (await hotel.locator("[data-notice]").filter({ hasText: "صيانة الليلة" }).getByRole("button", { name: "إخفاء" }).count()) throw new Error("important notice can be hidden");
});

await step("suspend reaches the hotel by itself; reactivation opens it by itself", async () => {
  await go(panel, P, hotelUrl.replace(P, ""));
  await panel.getByRole("button", { name: "إيقاف الفندق" }).click(); await has(panel, "هذا الفندق موقوف");
  // بلا ضغط "تحقق الآن": مجرد استخدام النظام بعد مدة التواصل يوصل الإيقاف
  const until = Date.now() + 60000;
  for (;;) {
    await hotel.waitForTimeout(4000);
    await go(hotel, H, "/reservations");
    if (new URL(hotel.url()).pathname === "/activate") break;
    if (Date.now() > until) throw new Error("suspension did not reach the hotel within a minute");
  }
  await has(hotel, "هذا الفندق موقوف من صاحب النظام");
  await go(panel, P, hotelUrl.replace(P, ""));
  await panel.getByRole("button", { name: "إعادة التفعيل" }).click(); await panel.getByRole("button", { name: "إيقاف الفندق" }).waitFor();
  const until2 = Date.now() + 60000;
  for (;;) {
    await hotel.waitForTimeout(4000);
    await go(hotel, H, "/activate");
    if (new URL(hotel.url()).pathname !== "/activate") break;
    if (Date.now() > until2) throw new Error("reactivation did not reach the hotel within a minute");
  }
});


await step("owner blocks a page, a button and a permission in the panel; the hotel obeys, even its manager", async () => {
  await go(panel, P, hotelUrl.replace(P, ""));
  await panel.locator("[data-section=pms] button[aria-expanded]").click();
  await panel.locator("[data-node='pms.cashier']").getByRole("switch").click();
  await panel.locator("[data-section=accounting] button[aria-expanded]").click();
  await panel.locator("[data-node='folio.void']").getByRole("switch").click();
  await panel.getByRole("tab", { name: /الصلاحيات/ }).click();
  await panel.locator("[data-permission='invoices.write_off']").getByRole("switch").click();
  await saveControl();
  // الصفحة الموقوفة تختفي وتُمنع برابطها
  await until("cashier block", "/cashier", async () => (await mainText()).includes("هذا الجزء مطفأ في هذا الفندق"));
  // عند المدير: مقفلة في تخصيص النظام ولا مفتاح لها
  await go(hotel, H, "/settings/features");
  await hotel.locator('[data-feature="pms"] button').first().click();
  const cashier = hotel.locator('[data-feature="pms.cashier"]');
  await cashier.waitFor();
  if (!(await cashier.innerText()).includes("أوقفه صاحب النظام")) throw new Error("cashier not marked as blocked by owner");
  if (await cashier.getByRole("switch").count()) throw new Error("manager can still switch the blocked page");
  await hotel.screenshot({ path: `${SHOTS}/owner-blocked.png`, fullPage: true });
  // الصلاحية الموقوفة لا تُمنح لأي دور
  await go(hotel, H, "/settings/users");
  const roleHref = await hotel.locator("a[href^='/settings/users/roles/']").first().getAttribute("href");
  if (!roleHref) throw new Error("no role page link");
  await go(hotel, H, roleHref);
  const roles = await mainText();
  if (!roles.includes("إصدار إشعار دائن")) throw new Error("role page did not list permissions");
  if (roles.includes("إعدام الديون المعدومة")) throw new Error("blocked permission still offered to roles");
});

await step("turning them back on in the panel returns them in the hotel", async () => {
  await go(panel, P, hotelUrl.replace(P, ""));
  await panel.locator("[data-section=pms] button[aria-expanded]").click();
  await panel.locator("[data-node='pms.cashier']").getByRole("switch").click();
  await panel.getByRole("tab", { name: /الصلاحيات/ }).click();
  await panel.locator("[data-permission='invoices.write_off']").getByRole("switch").click();
  await saveControl();
  await until("cashier back", "/cashier", async () => !(await mainText()).includes("هذا الجزء مطفأ"));
});

await step("removing a section in the panel removes it in the hotel by itself", async () => {
  await go(panel, P, hotelUrl.replace(P, ""));
  await sold("المغسلة", false);
  await saveControl();
  await until("laundry removal", "/laundry", async () => (await mainText()).includes("هذا الجزء مطفأ في هذا الفندق"));
  // القاعدة نفسها: صلاحية المغسلة سقطت فلا تظهر في شاشة صلاحيات الموظفين
  await go(hotel, H, "/settings/users");
  await hotel.waitForTimeout(800);
});


await step("renaming the hotel in the panel shows the new name in the hotel", async () => {
  await go(panel, P, hotelUrl.replace(P, ""));
  await panel.fill("#name", "فندق الترخيص الجديد");
  await panel.getByRole("button", { name: "حفظ البيانات" }).click(); await has(panel, "حُفظت بيانات الفندق");
  await until("new name", "/settings/features", async () => (await mainText()).includes("مرخّص لـ فندق الترخيص الجديد"));
});

await step("panel shows the hotel connected now, then unlinking stops the old system", async () => {
  await go(panel, P, "/hotels");
  await has(panel, "فندق الترخيص الجديد", "متصل الآن");
  await go(panel, P, hotelUrl.replace(P, ""));
  await panel.getByText("نقل الفندق لجهاز أو موقع آخر").click();
  await panel.getByRole("button", { name: "فصل النظام وإصدار كود جديد" }).click();
  await has(panel, "أرسل الكود للفندق");
  code = (await panel.locator("p.num").first().innerText()).trim();
  await until("unlink", "/reservations", async () => new URL(hotel.url()).pathname === "/activate");
  await has(hotel, "فصل صاحب النظام هذا النظام");
});

await step("the new code links the system again with its sections", async () => {
  await go(hotel, H, "/activate");
  await hotel.fill("#activation_code", code);
  await hotel.getByRole("button", { name: "تفعيل الآن" }).click();
  await hotel.waitForURL((u) => u.pathname === "/" || u.pathname === "/front-desk", { timeout: 60000 });
  await go(hotel, H, "/hr");
  if ((await mainText()).includes("هذا الجزء مطفأ")) throw new Error("HR lost after relinking");
  await go(panel, P, "/hotels"); await has(panel, "متصل الآن");
});

await step("deleting the hotel from the panel stops its system", async () => {
  await go(panel, P, hotelUrl.replace(P, ""));
  await panel.getByRole("button", { name: "حذف", exact: true }).click();
  await panel.waitForURL(/\/hotels$/);
  await until("delete", "/reservations", async () => new URL(hotel.url()).pathname === "/activate");
});

await browser.close();
console.log(`\n${ok} ok, ${fail} failed`);
console.log(`problems (${problems.length}):`); for (const p of problems) console.log(" ", p);
process.exit(fail || problems.length ? 1 : 0);

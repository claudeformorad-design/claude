// الصلاحيات والمستخدمون: تفعيل الدخول، إضافة موظفين بأدوار، تغيير كلمة المرور الإجباري، القوائم والصفحات الممنوعة،
// الحدود وطلبات الموافقة وتنفيذها باسم المدير، الصفحة الأولى للدور، وإيقاف الحساب.
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
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail-perm-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
};
const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
const pick = async (sel, re) => {
  const l = page.locator(sel);
  await l.first().waitFor({ state: "attached" });
  const texts = await l.locator("option").allTextContents();
  const i = texts.findIndex((t) => re.test(t));
  if (i < 0) throw new Error(`no option matching ${re} in ${texts.slice(0, 6)}`);
  await l.selectOption({ index: i });
};
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
// روابط القائمة الجانبية الظاهرة للمستخدم
const navLinks = async () => page.locator("aside a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
const login = async (username, password) => {
  await context.clearCookies();
  // القائمة الموسّعة تعرض كل الروابط بأسمائها
  await context.addCookies([{ name: "sidebar_expanded", value: "1", url: BASE }]);
  await go("/login");
  await page.fill("#username", username); await page.fill("#password", password);
  await page.getByRole("button", { name: "دخول" }).click();
  // ينتهي الدخول بالانتقال من صفحة الدخول أو بظهور رسالة خطأ
  await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }),
    page.locator("form [role=alert]").first().waitFor({ timeout: 30000 }),
  ]).catch(() => {});
  await page.waitForLoadState("networkidle");
};
const settle = async () => { await page.waitForURL((u) => !u.search.includes("home=1"), { timeout: 30000 }); await page.waitForLoadState("networkidle"); };
const changePassword = async (pw) => {
  await page.waitForURL(/account\/password/);
  await page.fill("#password", pw); await page.fill("#confirm", pw);
  await page.getByRole("button", { name: "حفظ كلمة المرور" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/account"));
  await settle();
};
const toast = async (text) => page.getByText(text).first().waitFor({ timeout: 15000 });

// فندق جديد في وضع المستخدم الواحد (بلا تسجيل دخول)
await page.goto(BASE + "/"); await page.waitForURL(/onboarding/, { timeout: 120000 });
await page.fill("#name_ar", "فندق الصلاحيات");
await page.selectOption("#country_code", "YE"); await page.selectOption("#base_currency", "YER"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", "Asia/Aden");
await page.getByRole("button", { name: "إنشاء الفندق" }).click();
await page.waitForURL((u) => u.pathname === "/", { timeout: 120000 });

let folioUrl = "";
await step("single user mode opens without login", async () => {
  await go("/settings/users");
  await bodyHas("النظام الآن بدون تسجيل دخول");
});
await step("open folio with a room charge", async () => {
  await go("/folios/new");
  await page.fill("#guest_name", "نزيل الصلاحيات"); await page.fill("#room_number", "101");
  await page.getByRole("button", { name: "فتح" }).click();
  await page.waitForURL(/folios\/[0-9a-f-]{36}$/);
  folioUrl = new URL(page.url()).pathname;
  await pick("#charge_code_id", /ROOM/);
  await page.fill("#quantity", "1"); await page.fill("#unit_price", "500");
  await page.getByRole("button", { name: "حفظ" }).click();
  await toast("تم التسجيل على الفوليو");
});
await step("enable login for the owner", async () => {
  await go("/settings/users");
  await page.fill("#owner_username", "admin"); await page.fill("#owner_password", "Admin1234"); await page.fill("#owner_confirm", "Admin1234");
  await page.getByRole("button", { name: "تفعيل تسجيل الدخول" }).click();
  await bodyHas("تسجيل الدخول مفعّل");
});
await step("anonymous visitor is sent to login", async () => {
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + "/journal"); await p2.waitForURL(/login/);
  await ctx2.close();
});
const addEmployee = async (name, username, role) => {
  await go("/settings/users");
  await page.fill("#emp_name", name); await page.fill("#emp_username", username); await page.fill("#emp_password", "Temp1234");
  await pick("#emp_role", role);
  await page.getByRole("button", { name: "إضافة الموظف" }).click();
  await toast("تمت إضافة الموظف");
  await bodyHas(name);
};
await step("add cashier and accountant", async () => {
  await addEmployee("سالم الكاشير", "salem", /كاشير/);
  await addEmployee("منى المحاسبة", "mona", /محاسب/);
});
await step("duplicate username refused", async () => {
  await go("/settings/users");
  await page.fill("#emp_name", "مكرر"); await page.fill("#emp_username", "salem"); await page.fill("#emp_password", "Temp1234");
  await page.getByRole("button", { name: "إضافة الموظف" }).click();
  await bodyHas("اسم المستخدم مستخدم لحساب آخر");
});
await step("accountant role: allowance limit 50 and home journal", async () => {
  await go("/settings/users");
  await page.locator("a", { hasText: "محاسب" }).filter({ hasText: "دور أساسي" }).first().click();
  await page.waitForURL(/settings\/users\/roles\//);
  await page.selectOption("#role_home", "/journal");
  await page.fill("#role_max_allowance", "50");
  await page.getByRole("button", { name: "حفظ إعدادات الدور" }).click();
  await toast("تم حفظ إعدادات الدور");
});
await step("owner cannot edit own access", async () => {
  await go("/settings/users");
  await bodyHas("حسابك");
});

await step("cashier: forced password change, limited menu", async () => {
  await login("salem", "Temp1234");
  await changePassword("Salem1234");
  if (new URL(page.url()).pathname === "/") throw new Error("cashier should not land on the financial dashboard");
  const nav = await navLinks();
  for (const hidden of ["/journal", "/settings/users", "/audit", "/reports/income-statement", "/hr"]) if (nav.includes(hidden)) throw new Error(`cashier sees ${hidden}`);
  for (const path of ["/folios", "/cashier", "/pos"]) {
    await go(path);
    if ((await page.locator("main").innerText()).includes("403")) throw new Error(`cashier blocked from ${path}`);
  }
});
await step("cashier: forbidden pages return 403", async () => {
  for (const path of ["/settings/users", "/journal", "/audit", "/reports/income-statement", "/hr", "/settings/currencies"]) {
    await go(path);
    await bodyHas("403");
  }
});
await step("cashier: allowance goes to manager as a request", async () => {
  await go(folioUrl);
  await page.getByRole("button", { name: "خصم", exact: true }).click();
  await pick("#charge_txn_id", /.+/);
  await page.fill("#amount", "20"); await page.fill("#reason", "تأخر التنظيف");
  await page.getByRole("button", { name: "طلب موافقة المدير" }).click();
  await bodyHas("هذه العملية خارج صلاحيتك");
  await page.getByPlaceholder("ملاحظة للمدير").fill("النزيل اشتكى");
  await page.getByRole("button", { name: "إرسال طلب موافقة" }).click();
  await toast("أُرسل الطلب للمدير");
  await go("/approvals");
  await bodyHas("طلباتي المعلّقة", "خصم", "تأخر التنظيف");
});

await step("accountant lands on journal (role home)", async () => {
  await login("mona", "Temp1234");
  await changePassword("Mona12345");
  if (!new URL(page.url()).pathname.startsWith("/journal")) throw new Error(`landed on ${page.url()}`);
});
await step("accountant: allowance above limit asks for approval", async () => {
  await go(folioUrl);
  await page.getByRole("button", { name: "خصم", exact: true }).click();
  await pick("#charge_txn_id", /.+/);
  await page.fill("#amount", "80"); await page.fill("#reason", "ترضية");
  await page.getByRole("button", { name: "حفظ" }).click();
  await bodyHas("حدك");
  await page.getByRole("button", { name: "إرسال طلب موافقة" }).click();
  await toast("أُرسل الطلب للمدير");
});
await step("accountant: allowance within limit posts directly", async () => {
  await go(folioUrl);
  await page.getByRole("button", { name: "خصم", exact: true }).click();
  await pick("#charge_txn_id", /.+/);
  await page.fill("#amount", "30"); await page.fill("#reason", "خصم بسيط");
  await page.getByRole("button", { name: "حفظ" }).click();
  await toast("تم التسجيل على الفوليو");
});
await step("accountant cannot decide approvals", async () => {
  await go("/approvals");
  const b = await page.locator("body").innerText();
  if (b.includes("بانتظار قرارك")) throw new Error("accountant sees decision list");
});

await step("manager approves cashier request and rejects accountant request", async () => {
  await login("admin", "Admin1234");
  await go("/approvals");
  await bodyHas("بانتظار قرارك", "تأخر التنظيف", "ترضية");
  const salem = page.locator("div.border-b", { hasText: "تأخر التنظيف" }).first();
  await salem.getByRole("button", { name: "موافقة وتنفيذ" }).click();
  await toast("نُفّذت العملية على الفوليو");
  await go("/approvals");
  const mona = page.locator("div.border-b", { hasText: "ترضية" }).first();
  await mona.getByPlaceholder("ملاحظة للموظف").fill("المبلغ كبير");
  await mona.getByRole("button", { name: "رفض" }).click();
  await toast("رُفض الطلب");
  await go("/approvals");
  await bodyHas("نُفّذ", "مرفوض", "المبلغ كبير");
  await go(folioUrl);
  await bodyHas("تأخر التنظيف", "خصم بسيط");
});
await step("manager deactivates the cashier", async () => {
  await go("/settings/users");
  await page.locator("a", { hasText: "سالم الكاشير" }).first().click();
  await page.waitForURL(/settings\/users\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "إيقاف الدخول" }).click();
  await toast("أُوقف دخول");
  await bodyHas("إعادة التفعيل");
  await go("/settings/users");
  await bodyHas("موقوف");
});
await step("deactivated cashier cannot sign in", async () => {
  await login("salem", "Salem1234");
  await bodyHas("هذا الحساب موقوف");
});
await step("wrong password is refused", async () => {
  await login("mona", "Wrong1234");
  if (!page.url().includes("/login")) throw new Error("wrong password signed in");
});
await step("per-employee deny removes a page", async () => {
  await login("admin", "Admin1234");
  await go("/settings/users");
  await page.locator("a", { hasText: "منى المحاسبة" }).first().click();
  await page.waitForURL(/settings\/users\/[0-9a-f-]{36}$/);
  await page.getByLabel("بحث في الصلاحيات").fill("عرض القيود");
  const sw = page.getByRole("switch", { name: "عرض القيود اليومية" });
  if (await sw.getAttribute("aria-checked") !== "true") throw new Error("journal view should come from the role");
  await sw.click();
  await bodyHas("ممنوعة عنه", "لديك تغييرات لم تُحفظ");
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await toast("تم حفظ صلاحيات");
  await page.reload(); await page.waitForLoadState("networkidle");
  await page.getByLabel("بحث في الصلاحيات").fill("عرض القيود");
  if (await page.getByRole("switch", { name: "عرض القيود اليومية" }).getAttribute("aria-checked") !== "false") throw new Error("deny not saved");
  await login("mona", "Mona12345");
  await go("/journal");
  await bodyHas("403");
});

await step("reactivated cashier signs in again", async () => {
  await login("admin", "Admin1234");
  await go("/settings/users");
  await page.locator("a", { hasText: "سالم الكاشير" }).first().click();
  await page.waitForURL(/settings\/users\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "إعادة التفعيل" }).click();
  await toast("أُعيد تفعيل");
  await login("salem", "Salem1234");
  if (page.url().includes("/login")) throw new Error("reactivated cashier could not sign in");
});
await step("manager deletes an employee", async () => {
  await login("admin", "Admin1234");
  await addEmployee("موظف مؤقت", "temp1", /استقبال/);
  await page.locator("a", { hasText: "موظف مؤقت" }).first().click();
  await page.waitForURL(/settings\/users\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "حذف الموظف" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "حذف الموظف" }).click();
  await page.waitForURL((u) => u.pathname === "/settings/users");
  await page.waitForLoadState("networkidle");
  if ((await page.locator("main").innerText()).includes("موظف مؤقت")) throw new Error("deleted employee still listed");
  await login("temp1", "Temp1234");
  if (!page.url().includes("/login")) throw new Error("deleted employee signed in");
});

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
process.exit(problems.length ? 1 : 0);

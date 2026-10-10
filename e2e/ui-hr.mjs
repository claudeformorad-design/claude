// جولة الموارد البشرية عبر الواجهة: الإعدادات والورديات، إضافة الموظفين وبنود رواتبهم، كشف الحضور اليدوي
// بالتأخير بعد السماح والإضافي صافي ما زاد على طول الوردية،
// جدول الورديات، طلب الإجازة واعتمادها، صرف السلفة بقيدها، الجزاء، مسيّر الشهر المحسوب وترحيله،
// إنهاء الخدمة بالتسوية النهائية، وإخفاء حساب سلف الموظفين من القيود اليدوية
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp";
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: process.env.HOST_RULES ? [`--host-resolver-rules=${process.env.HOST_RULES}`, "--no-proxy-server"] : [] });
const page = await browser.newPage({ locale: "ar-SA", viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(60000);
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("dialog", (d) => d.accept());
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail-hr-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
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
const bodyHas = async (...texts) => {
  const until = Date.now() + 15000;
  for (;;) {
    const b = await page.locator("main").innerText();
    const missing = texts.find((t) => !(t instanceof RegExp ? t.test(b) : b.includes(t)));
    if (missing === undefined) return;
    if (Date.now() > until) throw new Error(`missing "${missing}"`);
    await page.waitForTimeout(250);
  }
};
const toastSays = (text) => page.getByText(text).first().waitFor({ timeout: 20000 });
const dialog = () => page.getByRole("dialog");
const TZ = "Asia/Aden";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const plus = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const month = today.slice(0, 7);
const yearsAgo = (n) => `${Number(today.slice(0, 4)) - n}${today.slice(4, 8)}01`;

// فندق جديد
if (process.env.LOCAL) {
  await page.goto(BASE + "/"); await page.waitForURL(/onboarding/, { timeout: 120000 });
} else {
  await page.goto(BASE + "/login");
  await page.getByRole("button", { name: /أنشئ حسابًا/ }).click();
  await page.fill("#email", `hr-${Date.now()}@test.dev`); await page.fill("#password", "Passw0rd!123");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL(/onboarding/);
}
await page.fill("#name_ar", "فندق الموظفين");
await page.selectOption("#country_code", "YE"); await page.selectOption("#base_currency", "YER"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", TZ);
await page.getByRole("button", { name: "إنشاء الفندق" }).click();
await page.waitForURL((u) => u.pathname === "/", { timeout: 120000 });

await step("hr settings: grace minutes and insurance rates", async () => {
  await go("/settings/hr");
  await bodyHas("الدوام والحضور", "مكافأة نهاية الخدمة", "أنواع الإجازات", "الإجازة السنوية", "بنود الراتب", "الورديات", "الوردية الليلية");
  await page.fill("#late_grace_minutes", "10");
  await page.fill("#insurance_employee_pct", "9");
  await page.fill("#insurance_employer_pct", "12");
  await page.getByRole("button", { name: "حفظ الإعدادات" }).click();
  await toastSays("حُفظت إعدادات الموارد البشرية");
  await go("/settings/hr");
  if (await page.inputValue("#insurance_employee_pct") !== "9") throw new Error("insurance not saved");
});

await step("hr settings: new shift", async () => {
  await page.getByRole("button", { name: "وردية جديدة" }).click();
  await dialog().locator("#name").fill("وردية الاستقبال");
  await dialog().locator("#start_time").fill("08:00");
  await dialog().locator("#end_time").fill("16:00");
  await dialog().getByRole("button", { name: "حفظ" }).click();
  await bodyHas("وردية الاستقبال", "08:00");
});

const addEmployee = async (name, job, dept, hire, basic, shift) => {
  await go("/hr");
  await page.getByRole("button", { name: "موظف جديد" }).click();
  await dialog().locator("#full_name").fill(name);
  await dialog().locator("#job_title").fill(job);
  await pick(dialog().locator("#department_id"), dept);
  await dialog().locator("#hire_date").fill(hire);
  await dialog().locator("#basic_salary").fill(basic);
  if (shift) await pick(dialog().locator("#shift_id"), shift);
  await dialog().getByRole("button", { name: "حفظ الموظف" }).click();
  await bodyHas(name);
};

await step("add employees with automatic codes", async () => {
  await addEmployee("سالم أحمد", "موظف استقبال", /ROOMS/, yearsAgo(2), "6000", /وردية الاستقبال/);
  await addEmployee("نوال سعيد", "محاسبة", /ADMIN/, yearsAgo(1), "4000", /الصباحية/);
  await bodyHas("E0001", "E0002", "سالم أحمد", "نوال سعيد", "الموظفون النشطون");
});

let salem = "";
await step("employee profile and salary components", async () => {
  await page.getByRole("link", { name: "سالم أحمد" }).first().click();
  await page.waitForURL(/\/hr\/[0-9a-f-]{36}$/);
  salem = page.url().split("/hr/")[1];
  await bodyHas("E0001", "موظف استقبال", "وردية الاستقبال", "الراتب الشهري", "أرصدة الإجازات لهذا العام", "الإجازة السنوية");
  await page.getByRole("button", { name: "بنود الراتب" }).click();
  await dialog().getByLabel("بدل السكن").fill("25");
  await dialog().getByLabel("بدل النقل").fill("400");
  await dialog().getByRole("button", { name: "حفظ بنود الراتب" }).click();
  await bodyHas("بدل السكن", "1,500.00", "400.00", "7,900.00");
});

await step("attendance sheet: late arrival and absence", async () => {
  await go("/hr/attendance");
  await bodyHas("سالم أحمد", "نوال سعيد", "وردية الاستقبال");
  await page.getByRole("radiogroup", { name: "حالة سالم أحمد" }).getByRole("radio", { name: "حاضر" }).click();
  await page.getByLabel("حضور سالم أحمد").fill("08:40");
  await page.getByLabel("انصراف سالم أحمد").fill("17:00");
  await page.getByRole("radiogroup", { name: "حالة نوال سعيد" }).getByRole("radio", { name: "غائب" }).click();
  await page.getByRole("button", { name: "حفظ الكشف" }).click();
  await toastSays("حُفظ كشف الحضور");
  await go("/hr/attendance");
  await bodyHas("40 د", "20 د");
  if (await page.getByRole("radiogroup", { name: "حالة نوال سعيد" }).getByRole("radio", { name: "غائب" }).getAttribute("aria-checked") !== "true") throw new Error("absence not saved");
});

await step("roster: day off saved", async () => {
  await go("/hr/roster");
  const cell = page.locator('select[aria-label^="سالم أحمد"]').nth(3);
  await cell.selectOption("off");
  await page.getByRole("button", { name: "حفظ الجدول" }).click();
  await toastSays("حُفظ جدول الورديات");
  await go("/hr/roster");
  if (await page.locator('select[aria-label^="سالم أحمد"]').nth(3).inputValue() !== "off") throw new Error("roster not saved");
});

await step("leave request then approval", async () => {
  await go("/hr/leaves");
  await page.getByRole("button", { name: "إجازة جديدة" }).click();
  await pick(dialog().locator("#employee_id"), /نوال/);
  await pick(dialog().locator("#leave_type_id"), /السنوية/);
  await dialog().locator("#start_date").fill(plus(10));
  await dialog().locator("#end_date").fill(plus(13));
  await dialog().locator("#reason").fill("سفر");
  await dialog().getByLabel("اعتمادها مباشرة").uncheck();
  await dialog().getByRole("button", { name: "حفظ الإجازة" }).click();
  await bodyHas("نوال سعيد", "بانتظار القرار");
  await page.getByRole("button", { name: "اعتماد" }).first().click();
  await toastSays("اعتُمدت الإجازة");
  await go("/hr/leaves?tab=approved");
  await bodyHas("نوال سعيد", "معتمدة");
});

await step("advance paid with journal entry", async () => {
  await go("/hr/advances");
  await page.getByRole("button", { name: "صرف سلفة" }).click();
  await pick(dialog().locator("#employee_id"), /سالم/);
  await dialog().locator("#amount").fill("900");
  await dialog().locator("#installments").fill("3");
  await dialog().getByRole("button", { name: "صرف السلفة" }).click();
  await bodyHas(/ADV-\d{4}-\d{6}/, "900.00", "300.00", "قائمة");
  await page.getByRole("link", { name: /ADV-/ }).first().click();
  await page.waitForURL(/journal\/[0-9a-f-]{36}$/);
  await bodyHas("سلف الموظفين", "900.00");
});

await step("approved penalty", async () => {
  await go("/hr/advances");
  await page.getByRole("button", { name: "جزاء", exact: true }).click();
  await pick(dialog().locator("#employee_id"), /نوال/);
  await dialog().locator("#amount").fill("150");
  await dialog().locator("#reason").fill("تأخير متكرر");
  await dialog().getByLabel("اعتماده مباشرة").check();
  await dialog().getByRole("button", { name: "حفظ الجزاء" }).click();
  await bodyHas("تأخير متكرر", "150.00", "معتمد");
});

await step("payroll preview then posting", async () => {
  await go("/hr/payroll");
  await bodyHas("سالم أحمد", "نوال سعيد", "300.00", "غياب 1 يوم", "جزاء", "معاينة محسوبة");
  await page.getByRole("button", { name: "ترحيل المسيّر" }).click();
  await toastSays("رُحّل المسيّر وقيوده");
  await bodyHas("مسيّر هذا الشهر مرحّل", "مرحّل");
  await page.getByRole("link", { name: "عرض القيد" }).click();
  await page.waitForURL(/journal\/[0-9a-f-]{36}$/);
  await bodyHas("سلف الموظفين", "300.00");
  await go("/payroll");
  await bodyHas(month);
});

await step("termination with final settlement", async () => {
  await go(`/hr/${salem}`);
  await page.getByRole("button", { name: "إنهاء الخدمة" }).click();
  await dialog().getByText("صافي المستحق للموظف").waitFor();
  await dialog().getByRole("button", { name: "اعتماد إنهاء الخدمة" }).click();
  await toastSays("سُجّلت التسوية النهائية وقيدها");
  await bodyHas("انتهت خدمته", "التسوية النهائية", "مكافأة نهاية الخدمة", "الصافي المستحق");
  await go("/hr?status=terminated");
  await bodyHas("سالم أحمد", "استقالة");
  await go("/hr");
  await bodyHas("نوال سعيد");
});

await step("employee advances hidden from manual vouchers", async () => {
  await go("/vouchers/new");
  const opts = (await page.locator("select option").allTextContents()).join("|");
  if (opts.includes("سلف الموظفين")) throw new Error("employee advances account offered in vouchers");
});

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
process.exit(problems.length ? 1 : 0);

// فحص بصري آلي لكل شاشات النظام على الكمبيوتر والجوال ببيانات تجريبية:
// تجاوز أفقي للصفحة، أزرار مضغوطة (أقل من 36px أو نصها مقصوص)، نص مقصوص بلا تلميح، عناصر تفاعلية متداخلة.
// يحفظ لقطة لكل شاشة في SHOTS ويطبع المشاكل. BASE_URL لخادم محلي بقاعدة جديدة.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const SHOTS = process.env.SHOTS ?? "/tmp";
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const ROUTES = [
  "/", "/front-desk", "/tape-chart", "/reservations", "/reservations/new", "/rooms", "/room-setup", "/housekeeping", "/guests", "/guest-register",
  "/waitlist", "/rates", "/rate-plans", "/folios", "/folios/new", "/cashier", "/night-audit", "/pos", "/pos/setup", "/events", "/events/new",
  "/maintenance", "/maintenance/assets", "/laundry", "/laundry/new", "/laundry/linen", "/laundry/setup", "/lost-found", "/surveys",
  "/accounts", "/journal", "/journal/new", "/vouchers", "/vouchers/new", "/invoices", "/invoices/new", "/customers", "/vendors", "/bills", "/bills/new",
  "/purchase-orders", "/purchase-orders/new", "/inventory", "/assets", "/bank", "/periods", "/opening-balances", "/approvals", "/audit",
  "/reports/trial-balance", "/reports/aging", "/reports/profitability", "/reports/income-statement", "/reports/balance-sheet",
  "/hr", "/hr/attendance", "/hr/roster", "/hr/leaves", "/hr/advances", "/hr/payroll", "/payroll",
  "/settings/hotel", "/settings/users", "/settings/currencies", "/settings/hr", "/settings/import", "/settings/revenue", "/assistant",
];
// صفحات التفاصيل: أول رابط في القائمة
const DETAILS = [
  ["/reservations", /^\/reservations\/[0-9a-f-]{36}$/], ["/folios", /^\/folios\/[0-9a-f-]{36}$/], ["/guests", /^\/guests\/[0-9a-f-]{36}$/],
  ["/invoices", /^\/invoices\/[0-9a-f-]{36}$/], ["/journal", /^\/journal\/[0-9a-f-]{36}$/], ["/vouchers", /^\/vouchers\/[0-9a-f-]{36}$/],
  ["/bills", /^\/bills\/[0-9a-f-]{36}$/], ["/customers", /^\/customers\/[0-9a-f-]{36}$/], ["/events", /^\/events\/[0-9a-f-]{36}$/],
  ["/hr", /^\/hr\/[0-9a-f-]{36}$/], ["/cashier", /^\/cashier\/[0-9a-f-]{36}$/], ["/maintenance", /^\/maintenance\/[0-9a-f-]{36}$/],
  ["/settings/users", /^\/settings\/users\/[0-9a-f-]{36}$/],
];

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = [];

// يعمل داخل الصفحة: يجمع المشاكل البصرية القابلة للقياس
const inspect = () => {
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const over = document.documentElement.scrollWidth - window.innerWidth;
  if (over > 1) out.push(`page scrolls sideways by ${over}px`);
  const main = document.querySelector("main") ?? document.body;
  const buttons = [...main.querySelectorAll("button, a[class*='rounded'][class*='bg-'], [role='button']")].filter(vis);
  for (const b of buttons) {
    const r = b.getBoundingClientRect();
    if (b.closest("table, [role='menu'], nav, [aria-hidden='true']")) continue;
    const text = label(b);
    if (b.scrollWidth > b.clientWidth + 2 && text) out.push(`button text cut: "${text}"`);
    if (r.height < 30 && text.length > 1 && !b.className.includes("link")) out.push(`small button ${Math.round(r.height)}px: "${text}"`);
    if (r.right > window.innerWidth + 1 || r.left < -1) out.push(`button off screen: "${text}"`);
  }
  // أزرار متلاصقة أو متداخلة في نفس الصف
  for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < Math.min(buttons.length, i + 8); j++) {
    const a = buttons[i].getBoundingClientRect(), b = buttons[j].getBoundingClientRect();
    if (buttons[i].contains(buttons[j]) || buttons[j].contains(buttons[i])) continue;
    const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    if (overlap) out.push(`buttons overlap: "${label(buttons[i])}" and "${label(buttons[j])}"`);
  }
  // عناوين وخلايا مقصوصة بلا تلميح
  for (const el of [...main.querySelectorAll("h1, h2, h3, label, th")].filter(vis)) {
    if (el.scrollWidth > el.clientWidth + 2 && !el.title && getComputedStyle(el).overflow !== "visible") out.push(`text cut: "${label(el)}"`);
  }
  return [...new Set(out)];
};

const visit = async (path, tag) => {
  try {
    const res = await page.goto(BASE + path, { timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    if (res && res.status() >= 400) report.push(`${tag} ${path}: HTTP ${res.status()}`);
    const issues = await page.evaluate(inspect);
    for (const i of issues) report.push(`${tag} ${path}: ${i}`);
    // المحتوى يتمرر داخل main: يُفك الارتفاع الثابت لتلتقط الصورة الصفحة كاملة
    await page.evaluate(() => { document.querySelectorAll(".h-screen, main").forEach((e) => { e.style.height = "auto"; e.style.overflow = "visible"; }); });
    await page.screenshot({ path: `${SHOTS}/audit-${tag}${path.replace(/[^\w]+/g, "_")}.png`, fullPage: true });
  } catch (e) { report.push(`${tag} ${path}: ${String(e.message).split("\n")[0]}`); }
};

// إعداد: فندق جديد ثم بيانات تجريبية
await page.goto(BASE + "/"); await page.waitForLoadState("networkidle");
if (page.url().includes("onboarding")) {
  await page.fill("#name_ar", "فندق التدقيق");
  await page.selectOption("#country_code", "SA"); await page.selectOption("#base_currency", "SAR"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", "Asia/Riyadh");
  await page.getByRole("button", { name: "إنشاء الفندق" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30000 });
  await page.goto(BASE + "/settings/hotel"); await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "إنشاء بيانات تجريبية" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 300000 });
}

const details = [];
for (const [list, re] of DETAILS) {
  await page.goto(BASE + list); await page.waitForLoadState("networkidle").catch(() => {});
  const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const hit = hrefs.find((h) => h && re.test(h.split("?")[0]));
  if (hit) details.push(hit.split("?")[0]); else report.push(`no detail link found on ${list}`);
}
const res = details.find((d) => d.startsWith("/reservations/"));
if (res) details.push(`${res}/edit`, `${res}/card`);

const all = [...ROUTES, ...details].filter((p) => !ONLY || ONLY.test(p));
for (const p of all) await visit(p, "desk");
await page.setViewportSize({ width: 390, height: 844 });
for (const p of all) await visit(p, "mob");

console.log(report.join("\n"));
console.log(`\n${report.length} findings over ${all.length} screens`);
await browser.close();

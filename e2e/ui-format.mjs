// فورمات النظام من الواجهة في النسخة المنشورة، على Supabase محاكي ببيانات اختبار (لا يمس الإنتاج):
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_ANON_KEY=test npm run build
//   PORT=3230 node .next/standalone/server.js
//   BASE_URL=http://127.0.0.1:3230 node e2e/ui-format.mjs
import { chromium } from "playwright";
import { OWNER, STAFF, sessionCookie, startMockSupabase } from "./mock-supabase.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3230";
const SHOTS = process.env.SHOTS ?? "/tmp";
const problems = [];
const { server, state } = startMockSupabase(54399);

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const as = async (sub) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "sb-127-auth-token", value: sessionCookie(sub), url: BASE }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  return page;
};
let page;
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page?.screenshot({ path: `${SHOTS}/fail-format-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
};
const resets = () => state.calls.filter((c) => c.endsWith("/rpc/factory_reset")).length;
const dialog = () => page.getByRole("dialog");

await step("a manager who is not the owner does not see the format card", async () => {
  page = await as(STAFF);
  await page.goto(`${BASE}/settings/hotel`); await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "إعدادات الفندق" }).waitFor();
  if (await page.getByRole("button", { name: "فورمات النظام" }).count()) throw new Error("format card shown to a non owner");
  await page.context().close();
});
await step("the owner sees the card and the confirm button stays locked until the word is typed", async () => {
  page = await as(OWNER);
  await page.goto(`${BASE}/settings/hotel`); await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "فورمات النظام" }).click();
  const go = dialog().getByRole("button", { name: "فورمات الآن" });
  if (!(await go.isDisabled())) throw new Error("enabled before typing");
  await dialog().getByLabel("كلمة التأكيد").fill("فورمت");
  if (!(await go.isDisabled())) throw new Error("enabled with a wrong word");
  await dialog().getByRole("button", { name: "إلغاء" }).click();
  if (resets() !== 0) throw new Error("cancel called the server");
});
await step("a server failure shows a message and keeps the data", async () => {
  state.failReset = true;
  await page.getByRole("button", { name: "فورمات النظام" }).click();
  await dialog().getByLabel("كلمة التأكيد").fill("فورمات");
  await dialog().getByRole("button", { name: "فورمات الآن" }).click();
  await dialog().locator('[role="alert"], .bg-urgent-tint').first().waitFor({ timeout: 15000 });
  if (!state.hotels.length) throw new Error("data wiped on failure");
  if (!page.url().includes("/settings/hotel")) throw new Error("navigated away on failure");
  state.failReset = false;
});
await step("pressing twice sends one request, then the owner lands on hotel setup", async () => {
  const before = resets();
  // ضغطتان متتاليتان في نفس اللحظة، قبل أن يُعاد رسم الزر معطّلًا
  await dialog().getByRole("button", { name: "فورمات الآن" }).evaluate((b) => { b.click(); b.click(); });
  await page.waitForURL(/\/onboarding/, { timeout: 30000 });
  if (resets() - before !== 1) throw new Error(`expected 1 reset call, got ${resets() - before}`);
  if (state.hotels.length) throw new Error("hotels not wiped");
  await page.locator("#name_ar").waitFor();
  await page.context().close();
});
await step("a staff member after the format sees why and can sign out", async () => {
  page = await as(STAFF);
  await page.goto(`${BASE}/`); await page.waitForLoadState("networkidle");
  await page.getByText("لا يوجد فندق مرتبط بحسابك").waitFor();
  if (await page.locator("#name_ar").count()) throw new Error("hotel setup offered to staff");
  await page.screenshot({ path: `${SHOTS}/format-staff-after.png` });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.waitForURL(/\/login/, { timeout: 30000 });
});

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);

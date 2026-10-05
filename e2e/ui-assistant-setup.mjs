// تفعيل المساعد من الإعدادات بلا متغيرات بيئة، ورسائل الأخطاء الحقيقية، ومنع الإرسال المزدوج والرد المقطوع.
// شغّل الخادم بلا مفتاح، والعنوان يشير إلى المزود المحاكي الذي يفتحه هذا الملف على المنفذ 3399:
//   AI_BASE_URL=http://127.0.0.1:3399 node .next/standalone/server.js
// ثم: BASE_URL=http://127.0.0.1:3000 node e2e/ui-assistant-setup.mjs
import http from "node:http";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp";
const GOOD = "AIzaSyGoodKey0000000000000000000000Ab12";
const BAD = "AIzaSyWrongKey000000000000000000000Zz99";
const problems = [];

// ---- مزود محاكي بسلوك Gemini: المفتاح الخطأ 400 داخل مصفوفة، والحد 429، والبث المقطوع
let mode = "ok";
const streams = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body);
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${GOOD}`) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify([{ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }]));
    }
    if (!j.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }));
    }
    streams.push({ auth, at: Date.now(), question: j.messages.at(-1)?.content });
    if (mode === "429") {
      res.writeHead(429, { "Content-Type": "application/json" });
      return res.end(JSON.stringify([{ error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } }]));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    if (mode === "cut") {
      send({ choices: [{ delta: { content: "جزء أول من الرد " } }] });
      return setTimeout(() => res.socket.destroy(), 150);
    }
    const reply = "المساعد **جاهز** ويقرأ بيانات الفندق.";
    setTimeout(() => { for (const part of reply.match(/.{1,8}/gs)) send({ choices: [{ delta: { content: part } }] }); res.write("data: [DONE]\n\n"); res.end(); }, 400);
  });
});
await new Promise((r) => mock.listen(3399, "127.0.0.1", r));

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail-aisetup-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
};
const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
const launcher = () => page.locator("header").getByRole("button", { name: /المساعد/ });
const card = () => page.locator("#assistant");
const ask = async (q) => {
  const box = page.locator('[role="dialog"] textarea');
  await box.fill(q);
  await box.press("Enter");
};

await step("setup hotel", async () => {
  await go("/");
  if (!page.url().includes("onboarding")) return;
  await page.fill("#name_ar", "فندق التفعيل");
  await page.selectOption("#country_code", "SA"); await page.selectOption("#base_currency", "SAR"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", "Asia/Riyadh");
  await page.getByRole("button", { name: "إنشاء الفندق" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30000 });
});
await step("without a key the launcher is hidden and the page explains how to turn it on", async () => {
  await go("/");
  if (await launcher().count()) throw new Error("launcher shown without a key");
  await go("/assistant");
  await page.getByText("المساعد غير مفعّل بعد").waitFor();
  await page.getByRole("link", { name: "إضافة المفتاح" }).click();
  await page.waitForURL(/\/settings\/hotel/);
  await card().getByText("غير مفعّل").waitFor();
});
await step("a value that is not a key is refused with a clear message", async () => {
  await card().getByLabel("مفتاح الذكاء الاصطناعي").fill("this-is-not-an-api-key-at-all-123");
  await card().getByRole("button", { name: "حفظ وتفعيل" }).click();
  await card().getByText(/لا يشبه مفتاح Google Gemini/).waitFor();
});
await step("a wrong key is tested with the provider and not saved", async () => {
  await card().getByLabel("مفتاح الذكاء الاصطناعي").fill(BAD);
  await card().getByRole("button", { name: "حفظ وتفعيل" }).click();
  await card().getByText(/مفتاح الذكاء الاصطناعي غير صحيح أو أُلغي/).waitFor({ timeout: 30000 });
  await card().getByText("غير مفعّل").waitFor();
});
await step("the right key turns the assistant on and is never sent back to the browser", async () => {
  await card().getByLabel("مفتاح الذكاء الاصطناعي").fill(GOOD);
  await card().getByRole("button", { name: "حفظ وتفعيل" }).click();
  await card().getByText("مفعّل", { exact: true }).waitFor({ timeout: 30000 });
  await card().getByText(`••••${GOOD.slice(-4)}`).waitFor();
  await page.reload(); await page.waitForLoadState("networkidle");
  if ((await page.content()).includes(GOOD.slice(4, 20))) throw new Error("full key reached the page");
  await card().getByText("المفتاح محفوظ من هذه الصفحة").waitFor();
});
await step("test connection reports success", async () => {
  await card().getByRole("button", { name: "اختبار الاتصال" }).click();
  await card().getByText("الاتصال يعمل، والمساعد جاهز للأسئلة.").waitFor({ timeout: 30000 });
});
await step("the launcher appears and the assistant answers with the saved key", async () => {
  await go("/");
  await launcher().first().click();
  await page.getByRole("menuitem", { name: /لوحة جانبية/ }).click();
  await ask("هل تعمل الآن؟");
  await page.locator('[role="dialog"]').getByText("ويقرأ بيانات الفندق").waitFor({ timeout: 30000 });
  if (streams.at(-1)?.auth !== `Bearer ${GOOD}`) throw new Error("saved key not used by the server");
});
await step("pressing send twice sends one question", async () => {
  const before = streams.length;
  const box = page.locator('[role="dialog"] textarea');
  await box.fill("سؤال بضغطتين");
  await box.press("Enter");
  await box.press("Enter").catch(() => {});
  await page.locator('[role="dialog"] button[aria-label="إرسال"]').click({ timeout: 500 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (streams.length - before !== 1) throw new Error(`expected 1 request, got ${streams.length - before}`);
});
await step("provider limit shows a clear message", async () => {
  mode = "429";
  await ask("سؤال وقت الضغط");
  await page.locator('[role="dialog"]').getByText(/تجاوزت حد الاستخدام المسموح/).waitFor({ timeout: 30000 });
});
await step("a cut stream is reported instead of a silent half answer", async () => {
  mode = "cut";
  await ask("سؤال ينقطع");
  const dlg = page.locator('[role="dialog"]');
  await dlg.getByText(/انقطع الرد من مزود الذكاء الاصطناعي/).waitFor({ timeout: 30000 });
  // ما وصل قبل الانقطاع يبقى مقروءًا خارج فقاعة الخطأ
  await dlg.getByText("جزء أول من الرد").waitFor();
  mode = "ok";
});
await step("retry after the cut replaces the partial answer with a full one", async () => {
  const dlg = page.locator('[role="dialog"]');
  await dlg.getByRole("button", { name: "إعادة المحاولة" }).last().click();
  await dlg.getByText("ويقرأ بيانات الفندق").nth(2).waitFor({ timeout: 30000 });
  if (await dlg.getByText("جزء أول من الرد").count()) throw new Error("partial answer still shown after retry");
});
await step("remove key asks first, then turns the assistant off", async () => {
  await go("/settings/hotel");
  await card().getByRole("button", { name: "حذف المفتاح" }).click();
  await page.getByRole("dialog").getByText("سيتوقف المساعد عن العمل").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "حذف المفتاح" }).click();
  await card().getByText("غير مفعّل").waitFor({ timeout: 30000 });
  await go("/");
  if (await launcher().count()) throw new Error("launcher still shown after removing the key");
});
await step("mobile settings card fits the screen", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await go("/settings/hotel");
  await card().scrollIntoViewIfNeeded();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 1) throw new Error(`horizontal overflow ${over}px`);
  await card().screenshot({ path: `${SHOTS}/ai-setup-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await card().screenshot({ path: `${SHOTS}/ai-setup-desktop.png` });
});

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
mock.close();
process.exit(problems.length ? 1 : 0);

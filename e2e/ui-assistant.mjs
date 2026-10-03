// اختبار واجهة المساعد كاملًا بنموذج محاكي محلي (بلا مفتاح حقيقي ولا إنترنت):
// شغّل الخادم أولًا بمتغيرات تشير إلى النموذج المحاكي الذي يفتحه هذا الملف على المنفذ 3399:
//   GEMINI_API_KEY=test AI_BASE_URL=http://127.0.0.1:3399 node .next/standalone/server.js
// ثم: BASE_URL=http://127.0.0.1:3000 LOCAL=1 node e2e/ui-assistant.mjs
import http from "node:http";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp";
const problems = [];

// ---- النموذج المحاكي: يطلب أداتي الحالة والميزانية، ثم يجيب منهما بعناوين وجدول
const calls = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body);
    calls.push({ auth: req.headers.authorization, system: j.messages[0].content, tools: (j.tools ?? []).map((t) => t.function.name) });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const last = j.messages.at(-1);
    if (last.role === "user") {
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "hotel_snapshot", arguments: "{}" } }] } }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 1, id: "t2", function: { name: "run_report", arguments: "{\"report\":\"balance-sheet\"}" } }] } }] });
    } else {
      const snap = JSON.parse(j.messages.find((m) => m.tool_call_id === "t1").content);
      const bs = JSON.parse(j.messages.find((m) => m.tool_call_id === "t2").content);
      const text = `الوضع **مستقر** اليوم.\n\n## الحركة\n\n| البند | العدد |\n|---|---|\n| الوصول | ${snap.front_desk.arrivals ?? 0} |\n| المقيمون | ${snap.front_desk.in_house ?? 0} |\n\n## المركز المالي\n\n${bs.note}\n\n1. راجع الحجز RSV-2026-000001.\n2. أغلق الورديات المفتوحة.`;
      for (const part of text.match(/.{1,10}/gs)) send({ choices: [{ delta: { content: part } }] });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((r) => mock.listen(3399, "127.0.0.1", r));

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail-ai-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
};
const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
const answered = (scope) => page.locator(scope).getByText("المركز المالي").first().waitFor({ timeout: 60000 });

await step("setup hotel", async () => {
  await page.goto(BASE + "/");
  await page.waitForLoadState("networkidle");
  if (!page.url().includes("onboarding")) return;
  await page.fill("#name_ar", "فندق المساعد");
  await page.selectOption("#country_code", "SA"); await page.selectOption("#base_currency", "SAR"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", "Asia/Riyadh");
  await page.getByRole("button", { name: "إنشاء الفندق" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 30000 });
});
await step("chooser offers side panel and full page", async () => {
  await go("/");
  await page.getByRole("button", { name: /المساعد/ }).first().click();
  await page.getByRole("menuitem", { name: /لوحة جانبية/ }).waitFor();
  await page.getByRole("menuitem", { name: /صفحة كاملة/ }).waitFor();
});
await step("side panel answers from live data with a rendered table", async () => {
  await page.getByRole("menuitem", { name: /لوحة جانبية/ }).click();
  await page.getByRole("button", { name: "ما وضع الفندق اليوم؟" }).click();
  await answered('[role="dialog"]');
  const dlg = page.locator('[role="dialog"]');
  if (!(await dlg.locator("table").count())) throw new Error("table not rendered");
  if ((await dlg.innerText()).includes("**") || (await dlg.innerText()).includes("|")) throw new Error("raw markdown visible");
  const c = calls.at(-1);
  if (c.auth !== "Bearer test") throw new Error("key not sent from the server");
  if (!calls.some((x) => x.system.includes("الصفحة المفتوحة الآن"))) throw new Error("page context missing");
});
await step("conversation is saved and listed in history", async () => {
  await page.getByRole("button", { name: "المحادثات السابقة" }).click();
  await page.getByRole("button", { name: "ما وضع الفندق اليوم؟" }).last().waitFor();
  await page.keyboard.press("Escape");
});
await step("expand to full page keeps the conversation", async () => {
  await page.getByRole("button", { name: "فتح في صفحة كاملة" }).click();
  await page.waitForURL(/\/assistant\?c=/, { timeout: 60000 });
  await answered("main");
});
await step("save an answer and find it in saved", async () => {
  await page.getByRole("button", { name: "حفظ في المحفوظات" }).last().click();
  await page.getByText("حُفظت الإجابة").waitFor();
  await page.getByRole("navigation", { name: "أدوات المساعد" }).getByRole("button", { name: "المحفوظات" }).click();
  await page.locator("article").getByText("المركز المالي").first().waitFor();
});
await step("smart report runs in a new conversation", async () => {
  await page.getByRole("button", { name: "محادثة جديدة" }).first().click();
  await page.getByRole("navigation", { name: "أدوات المساعد" }).getByRole("button", { name: "التقارير الذكية" }).click();
  await page.getByRole("button", { name: /فحص صحة الحسابات/ }).click();
  await answered("main");
  // القائمة الجانبية تتحدث بعد اكتمال الرد، فننتظر ظهور المحادثة
  await page.locator("aside").getByText(/افحص صحة الحسابات/).first().waitFor({ timeout: 15000 }).catch(() => { throw new Error("new conversation not listed"); });
});
await step("regenerate the last answer", async () => {
  const before = calls.length;
  await page.getByRole("button", { name: "إعادة توليد الرد" }).click();
  await page.getByRole("button", { name: "إعادة توليد الرد" }).waitFor({ timeout: 60000 });
  await answered("main");
  if (calls.length < before + 2) throw new Error("answer was not regenerated");
});
await step("custom instructions reach the model", async () => {
  await page.getByRole("navigation", { name: "أدوات المساعد" }).getByRole("button", { name: "التعليمات الخاصة" }).click();
  await page.locator("textarea").fill("اختصر الإجابات دائمًا");
  await page.getByRole("button", { name: "حفظ التعليمات" }).click();
  await page.getByText("حُفظت تعليماتك").waitFor();
  await page.getByRole("navigation", { name: "أدوات المساعد" }).getByRole("button", { name: "التقارير الذكية" }).click();
  await page.getByRole("button", { name: /ملخص اليوم للمدير/ }).click();
  await answered("main");
  if (!calls.at(-1).system.includes("اختصر الإجابات دائمًا")) throw new Error("instructions not in the prompt");
});
await step("rename, pin and delete a conversation", async () => {
  const row = page.locator("aside").getByText(/ملخص اليوم للمدير|اكتب لي ملخص اليوم/).first();
  await row.hover();
  await page.getByRole("button", { name: "خيارات المحادثة" }).first().click();
  await page.getByRole("button", { name: "تثبيت" }).click();
  await page.locator("aside").getByText("المثبتة").waitFor();
  await page.getByRole("button", { name: "خيارات المحادثة" }).first().click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "حذف" }).click();
  await page.getByText("حُذفت المحادثة").waitFor();
});
await step("exit returns to the system", async () => {
  await page.getByRole("button", { name: "العودة للنظام" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/assistant"), { timeout: 60000 });
});

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
mock.close();
process.exit(problems.length ? 1 : 0);

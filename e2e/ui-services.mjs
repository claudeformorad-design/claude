// خدمات التشغيل عبر الواجهة: الصيانة وإخراج الغرفة من الخدمة، سجل الأجهزة، المفقودات وأمانات الخزنة،
// المغسلة وترحيلها على الفوليو والمفروشات، القاعات والمناسبات بلا تعارض وعقدها المطبوع، وتقييم النزيل بعد المغادرة.
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
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail-svc-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
};
const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
const has = async (...texts) => {
  const until = Date.now() + 15000;
  for (;;) {
    const b = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const missing = texts.find((t) => !b.includes(t));
    if (missing === undefined) return;
    if (Date.now() > until) throw new Error(`missing "${missing}"`);
    await page.waitForTimeout(250);
  }
};
const pick = async (sel, re) => {
  const l = typeof sel === "string" ? page.locator(sel) : sel;
  await l.first().waitFor({ state: "attached" });
  const texts = await l.locator("option").allTextContents();
  const i = texts.findIndex((t) => re.test(t));
  if (i < 0) throw new Error(`no option matching ${re} in ${texts.slice(0, 8)}`);
  await l.selectOption({ index: i });
};
const dialog = () => page.locator("[role=dialog]");
const alertHas = async (text) => { await dialog().locator("[role=alert]").filter({ hasText: text }).first().waitFor(); };
const save = async (name) => { await dialog().getByRole("button", { name }).click(); };
const closed = async () => { await dialog().waitFor({ state: "detached" }); await page.waitForLoadState("networkidle"); };
const TZ = "Asia/Aden";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const plus = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

await page.goto(BASE + "/"); await page.waitForURL(/onboarding/, { timeout: 120000 });
await page.fill("#name_ar", "فندق الخدمات");
await page.selectOption("#country_code", "YE"); await page.selectOption("#base_currency", "YER"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", TZ);
await page.getByRole("button", { name: "إنشاء الفندق" }).click();
await page.waitForURL((u) => u.pathname === "/", { timeout: 120000 });

await step("setup rooms, a hall and an in-house guest", async () => {
  await go("/room-setup?new=1");
  await page.fill("#code", "DBL"); await page.fill("#name_ar", "غرفة مزدوجة"); await page.fill("#base_rate", "300");
  await page.getByRole("button", { name: "حفظ" }).click(); await page.waitForURL(/room-setup$/);
  await go("/room-setup?new=1");
  await page.fill("#code", "HALL"); await page.fill("#name_ar", "قاعة الأفراح");
  await page.selectOption("#booking_mode", "hourly"); await page.fill("#base_rate", "100"); await page.fill("#min_hours", "2"); await page.fill("#max_adults", "300");
  await page.getByRole("button", { name: "حفظ" }).click(); await page.waitForURL(/room-setup$/);
  await go("/room-setup?tab=rooms");
  await page.getByRole("button", { name: "إضافة غرف دفعة واحدة" }).click();
  await pick("#room_type_id", /مزدوجة/); await page.fill("#from_number", "101"); await page.fill("#to_number", "103");
  await page.getByRole("button", { name: "إضافة الغرف" }).click(); await has("101", "103");
  await page.getByRole("button", { name: "إضافة غرف دفعة واحدة" }).click();
  await pick("#room_type_id", /الأفراح/); await page.fill("#from_number", "1"); await page.fill("#to_number", "1"); await page.fill("#prefix", "H");
  await page.getByRole("button", { name: "إضافة الغرف" }).click(); await has("H1");

  await go("/reservations/new");
  await page.getByRole("button", { name: /نزيل جديد/ }).click().catch(() => {});
  await page.fill("#new_guest_name", "سالم المقيم");
  await pick("#room_type_id", /مزدوجة/); await page.fill("#arrival_date", today); await page.fill("#nights", "2");
  await pick("#room_id", /101/);
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /تأكيد الحجز/ }).click();
  await page.waitForURL(/reservations\/[0-9a-f-]{36}$/);
  await page.getByLabel(/سلّمتُ/).first().check();
  await page.getByRole("button", { name: "إتمام التسكين" }).click();
  await has("مقيم", "تسجيل المغادرة");
});
const stayUrl = page.url();

// ----------------------------------------------------------------------------- الصيانة
await step("report a fault that takes room 102 out of service", async () => {
  await go("/maintenance");
  await page.getByRole("button", { name: "بلاغ عطل" }).click();
  await page.fill("#title", "تسرب مياه في الحمام"); await pick("#priority", /عاجلة/); await pick("#room_id", /102/);
  await page.check("input[name=out_of_service]");
  await save("إرسال البلاغ"); await closed();
  await has("MNT-", "تسرب مياه في الحمام", "الغرفة خارج الخدمة", "عاجلة");
  await go("/rooms"); await has("102");
});
await step("closing without what was done is refused; part and labor; done returns the room", async () => {
  await go("/maintenance");
  await page.getByRole("link", { name: "تسرب مياه في الحمام" }).click(); await page.waitForURL(/maintenance\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "قطعة غيار" }).click();
  await page.fill("#description", "خلاط مياه"); await page.fill("#quantity", "1"); await page.fill("#unit_cost", "4500");
  await save("إضافة"); await closed(); await has("خلاط مياه", "4,500");
  await page.getByRole("button", { name: "تحديث البلاغ" }).click();
  await page.selectOption("#status", "done"); await page.fill("#assignee", "فني السباكة"); await page.fill("#labor_cost", "1500");
  await save("حفظ"); await alertHas("اكتب ما تم إنجازه");
  await page.fill("#resolution", "تغيير الخلاط وإحكام الوصلات");
  await save("حفظ"); await closed();
  await has("منجز", "تغيير الخلاط وإحكام الوصلات", "6,000", "عادت الغرفة للخدمة");
});
await step("equipment register", async () => {
  await go("/maintenance/assets");
  await page.getByRole("button", { name: "جهاز جديد" }).click();
  await page.fill("#name", "مكيف الردهة"); await pick("#category", /تكييف/); await page.fill("#warranty_until", plus(200));
  await save("إضافة"); await closed(); await has("مكيف الردهة", "تكييف");
});

// ----------------------------------------------------------------------------- المفقودات والأمانات
await step("lost item: handover needs the receiver ID", async () => {
  await go("/lost-found");
  await page.getByRole("button", { name: "تسجيل مفقود" }).click();
  await page.fill("#description", "ساعة يد فضية"); await pick("#category", /مجوهرات/); await pick("#room_id", /103/); await page.fill("#storage_location", "خزنة الاستقبال");
  await save("تسجيل"); await closed(); await has("LF-", "ساعة يد فضية", "محفوظ");
  await page.getByRole("row", { name: /ساعة يد فضية/ }).getByRole("button", { name: "تسليم" }).click();
  await page.fill("#returned_to", "سالم"); await save("تسليم لصاحبه"); await alertHas("رقم هويته");
  await page.fill("#id_number", "0123456789"); await save("تسليم لصاحبه"); await closed();
  await go("/lost-found?tab=closed"); await has("ساعة يد فضية", "سُلِّم لصاحبه", "0123456789");
});
await step("safe deposit for the in-house guest; a held box cannot be reused", async () => {
  await go("/lost-found?tab=safe");
  await page.getByRole("button", { name: "أمانة في الخزنة" }).click();
  await pick("#reservation_id", /سالم المقيم/); await page.fill("#box_number", "A1"); await page.fill("#items", "جواز سفر ومبلغ نقدي");
  await save("استلام الأمانة"); await closed(); await has("SD-", "A1", "سالم المقيم", "غرفة 101");
  await page.getByRole("button", { name: "أمانة في الخزنة" }).click();
  await page.fill("#guest_name", "آخر"); await page.fill("#box_number", "a1"); await page.fill("#items", "ساعة");
  await save("استلام الأمانة"); await alertHas("فيه أمانة لم تُسلَّم");
  await page.keyboard.press("Escape");
  await page.getByRole("row", { name: /A1/ }).getByRole("button", { name: "تسليم للنزيل" }).first().click();
  await page.locator("form").filter({ hasText: "ملاحظة التسليم" }).getByRole("button", { name: "تسليم للنزيل" }).click();
  await go("/lost-found?tab=safe_done"); await has("جواز سفر ومبلغ نقدي", "سُلِّمت");
});

// ----------------------------------------------------------------------------- المغسلة والمفروشات
await step("laundry price list", async () => {
  await go("/laundry/setup");
  await page.getByRole("button", { name: "صنف جديد" }).click();
  await page.fill("#name", "قميص"); await page.fill("#price", "500");
  await save("إضافة"); await closed(); await has("قميص", "500");
});
let laundryTotal = "";
await step("express laundry order for the in-house guest", async () => {
  await go("/laundry/new");
  await pick("#reservation_id", /101/);
  await page.getByRole("button", { name: "إضافة قميص" }).click(); await page.getByRole("button", { name: "إضافة قميص" }).click();
  await page.getByLabel("خدمة مستعجلة").check(); await page.fill("#express_pct", "50");
  await has("1,500");
  await page.getByRole("button", { name: "استلام الطلب" }).click();
  await page.waitForURL(/laundry$/); await has("LND-", "مستعجل", "قميص × 2", "1,500");
  laundryTotal = "1,500";
});
await step("laundry moves forward and posts on the folio at delivery", async () => {
  await page.getByRole("button", { name: "أُرسل للمغسلة" }).click(); await has("في المغسلة");
  await page.getByRole("button", { name: "جاهز", exact: true }).click();
  await go("/laundry?tab=ready"); await has("جاهز للتسليم");
  await page.getByRole("button", { name: "تسليم للنزيل" }).click();
  await go("/laundry?tab=done"); await has("سُلِّم للنزيل");
  await page.getByRole("link", { name: "الفوليو" }).first().click(); await page.waitForURL(/folios\/[0-9a-f-]{36}$/);
  await has("غسيل: قميص", laundryTotal);
});
await step("linen stock never goes below what exists", async () => {
  await go("/laundry/linen");
  await page.getByRole("button", { name: "نوع جديد" }).click();
  await page.fill("#name", "منشفة حمام"); await page.fill("#par_level", "80");
  await save("إضافة"); await closed();
  await page.getByRole("button", { name: "حركة", exact: true }).click();
  await page.selectOption("#kind", "purchased"); await page.fill("#quantity", "100"); await save("تسجيل"); await closed();
  await page.getByRole("button", { name: "حركة", exact: true }).click();
  await page.selectOption("#kind", "sent"); await page.fill("#quantity", "120"); await save("تسجيل"); await alertHas("أكبر من المتاح");
  await page.fill("#quantity", "30"); await save("تسجيل"); await closed();
  await has("منشفة حمام", "أقل من الحد المطلوب", "شراء وإضافة", "إرسال للمغسلة");
  const row = (await page.getByRole("row", { name: /منشفة حمام/ }).first().innerText()).replace(/\s+/g, " ");
  if (!/100 30 70 80/.test(row)) throw new Error(row);
});

// ----------------------------------------------------------------------------- المناسبات
let eventUrl = "";
await step("event contract with per-person items and discount", async () => {
  await go("/events/new");
  await page.fill("#title", "حفل زفاف آل سالم"); await page.fill("#contact_name", "أحمد سالم"); await page.fill("#contact_phone", "777000111");
  await pick("#hall_room_id", /H1/);
  await page.fill("#starts_at", `${plus(10)}T18:00`); await page.fill("#ends_at", `${plus(10)}T23:00`); await page.fill("#guests_count", "200");
  await page.fill("#p0", "150000");
  await page.getByRole("button", { name: "بند", exact: true }).click();
  await page.fill("#d1", "عشاء للفرد"); await page.getByLabel("للفرد").nth(1).check(); await page.fill("#p1", "3000");
  await page.fill("#discount", "10000");
  await has("740,000");
  await page.getByRole("button", { name: "حفظ المناسبة" }).click();
  await page.waitForURL(/events\/[0-9a-f-]{36}$/); eventUrl = page.url();
  await has("EV-", "مبدئي", "عشاء للفرد", "200", "740,000");
});
await step("the hall cannot be double booked", async () => {
  await go("/events/new");
  await page.fill("#title", "مؤتمر"); await page.fill("#contact_name", "شركة"); await pick("#hall_room_id", /H1/);
  await page.fill("#starts_at", `${plus(10)}T20:00`); await page.fill("#ends_at", `${plus(10)}T22:00`); await page.fill("#guests_count", "50");
  await page.fill("#p0", "1000");
  await page.getByRole("button", { name: "حفظ المناسبة" }).click();
  await page.locator("[role=alert]").filter({ hasText: "القاعة محجوزة" }).waitFor();
});
await step("confirm opens the deposit folio; complete posts items and discount", async () => {
  await page.goto(eventUrl);
  await page.getByRole("button", { name: "مهمة", exact: true }).click();
  await page.fill("#task", "تجهيز الكوشة"); await page.fill("#owner", "فريق الديكور"); await save("إضافة"); await closed();
  await page.getByLabel("إنجاز تجهيز الكوشة").check(); await page.waitForTimeout(800);
  await page.getByRole("button", { name: "تأكيد المناسبة" }).click(); await has("مؤكد", "الفوليو والعربون");
  await page.getByRole("button", { name: "تنفيذ وترحيل" }).click(); await has("منفّذ");
  await page.getByRole("link", { name: "الفوليو والعربون" }).click(); await page.waitForURL(/folios\/[0-9a-f-]{36}$/);
  await has("أحمد سالم", "عشاء للفرد", "600,000", "خصم المناسبة");
});
await step("printed event contract", async () => {
  const id = eventUrl.split("/").pop();
  const doc = await context.newPage();
  await doc.goto(`${BASE}/print/event/${id}`); await doc.waitForLoadState("networkidle");
  const body = (await doc.locator("body").innerText()).replace(/\s+/g, " ");
  for (const t of ["عقد مناسبة", "حفل زفاف آل سالم", "أحمد سالم", "740,000", "صاحب المناسبة"]) if (!body.includes(t)) throw new Error(`contract missing ${t}`);
  await doc.screenshot({ path: `${SHOTS}/svc-event-contract.png`, fullPage: true });
  await doc.close();
});

// ----------------------------------------------------------------------------- تقييم النزيل
let surveyUrl = "";
await step("check-out creates a survey waiting for the guest", async () => {
  await page.goto(stayUrl); await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "تجهيز الفاتورة" }).click();
  await has("المستحق");
  await page.getByRole("button", { name: /تسجيل المغادرة/ }).last().click();
  await page.waitForURL(/invoices\/[0-9a-f-]{36}$/, { timeout: 30000 });
  await go("/surveys?tab=pending"); await has("سالم المقيم", "غرفة 101");
  surveyUrl = await page.getByRole("link", { name: "فتح الاستبيان للنزيل" }).first().getAttribute("href");
});
await step("guest fills the survey without signing in, once only", async () => {
  const guest = await browser.newContext({ locale: "ar-SA" });
  const g = await guest.newPage();
  g.on("pageerror", (e) => problems.push(`survey pageerror: ${e.message.slice(0, 200)}`));
  await g.goto(BASE + surveyUrl); await g.waitForLoadState("networkidle");
  await g.locator("text=أهلًا سالم المقيم").waitFor();
  await g.getByRole("button", { name: "إرسال التقييم" }).click();
  await g.locator("[role=alert]").filter({ hasText: "اختر التقييم العام" }).waitFor();
  await g.getByRole("radiogroup", { name: "تقييمك العام لإقامتك" }).getByRole("radio", { name: "4 من 5" }).click();
  await g.getByRole("radiogroup", { name: "النظافة" }).getByRole("radio", { name: "5 من 5" }).click();
  await g.getByRole("button", { name: "نعم" }).click();
  await g.fill("#comment", "إقامة مريحة والموظفون متعاونون");
  await g.getByRole("button", { name: "إرسال التقييم" }).click();
  await g.locator("text=وصل تقييمك").waitFor();
  await g.screenshot({ path: `${SHOTS}/svc-survey-done.png` });
  await g.goto(BASE + surveyUrl); await g.locator("text=وصل تقييم هذه الإقامة من قبل").waitFor();
  await guest.close();
});
await step("paper survey and the satisfaction report", async () => {
  await go("/surveys");
  await page.getByRole("button", { name: "استمارة ورقية" }).click();
  await page.fill("#guest_name", "نزيل ورقي"); await page.selectOption("#overall", "2"); await page.fill("#comment", "الحمام يحتاج صيانة");
  await save("حفظ التقييم"); await closed();
  await has("3.0", "100%", "إقامة مريحة والموظفون متعاونون", "الحمام يحتاج صيانة", "استمارة ورقية", "جهاز الاستقبال");
  await page.screenshot({ path: `${SHOTS}/svc-surveys.png`, fullPage: true });
});
await step("operations group in the sidebar", async () => {
  await go("/maintenance");
  await page.getByRole("link", { name: "خدمات التشغيل" }).hover();
  for (const t of ["الصيانة", "المفقودات والأمانات", "المغسلة", "القاعات والمناسبات", "تقييمات النزلاء"]) await has(t);
});

await step("automatic backup: back up now, list, download, bad folder refused", async () => {
  await go("/settings/hotel");
  await has("النسخ الاحتياطي التلقائي", "مفعّل يوميًا 03:00");
  await page.getByRole("button", { name: "نسخة الآن" }).click();
  await page.locator("text=/nazeel-backup-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.tar\\.gz/").first().waitFor();
  const href = await page.getByRole("link", { name: /تنزيل nazeel-backup/ }).first().getAttribute("href");
  const res = await page.request.get(BASE + href);
  if (res.status() !== 200 || (await res.body()).length < 1000) throw new Error(`download ${res.status()}`);
  const bad = await page.request.get(BASE + "/api/backup?file=" + encodeURIComponent("../auto-backup.json"));
  if (bad.status() !== 404) throw new Error(`path escape ${bad.status()}`);
  await page.fill("#backup_folder", "/proc/nazeel-no-write"); await page.fill("#backup_keep", "7");
  await page.getByRole("button", { name: "حفظ الإعدادات" }).click();
  await page.locator("text=لا يمكن الكتابة في هذا المجلد").first().waitFor();
});
await step("operations pages in English", async () => {
  await go("/maintenance");
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "English" }).click()]);
  await page.waitForLoadState("networkidle");
  for (const [path, texts] of [["/maintenance", ["Maintenance", "Report fault", "Open requests"]], ["/lost-found", ["Lost & found", "Safe deposit"]],
    ["/laundry", ["Laundry", "Price list", "Delivered"]], ["/events", ["Halls & events", "New event"]], ["/surveys", ["Guest feedback", "Overall rating distribution"]]]) {
    await go(path); await has(...texts);
  }
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "العربية" }).click()]);
});

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
process.exit(problems.length ? 1 : 0);

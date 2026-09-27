// جولة قسم إدارة الفندق عبر الواجهة: إعداد الغرف، الحجز والتخصيص ومنع الازدواج، السعة وقائمة الانتظار،
// الوحدات بالساعة، الحجز المتكرر والجماعي، المواسم وتثبيت الأسعار، عروض اللحظة الأخيرة، حالة الغرف،
// العربون والتسكين والتمديد ونقل الغرفة والمغادرة بالفاتورة (الفوليو في المحاسبة)، العملات وورديات الكاشير، تدقيق نهاية اليوم وكشف النزلاء، خطط الأسعار ونقاط البيع والتدبير الفندقي، الطباعة والأرصدة الافتتاحية والنسخ الاحتياطي، فصل الأقسام
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
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); console.log(`✗ ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${SHOTS}/fail-pms-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); }
};
const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); };
const pick = async (loc, re) => {
  const l = typeof loc === "string" ? page.locator(loc) : loc;
  const texts = await l.locator("option").allTextContents();
  const i = texts.findIndex((t) => re.test(t));
  if (i < 0) throw new Error(`no option matching ${re} in ${texts.slice(0, 6)}`);
  await l.selectOption({ index: i });
};
const bodyHas = async (...texts) => {
  const until = Date.now() + 15000;
  for (;;) {
    const b = await page.locator("main").innerText();
    const missing = texts.find((t) => !b.includes(t));
    if (missing === undefined) return;
    if (Date.now() > until) throw new Error(`missing "${missing}"`);
    await page.waitForTimeout(250);
  }
};
const bodyLacks = async (text) => { if ((await page.locator("body").innerText()).includes(text)) throw new Error(`unexpected "${text}"`); };
const TZ = "Asia/Aden";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const plus = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekend = (iso) => [4, 5].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });
const submitReservation = async () => {
  // مهلة قصيرة لعرض السعر الحي ثم الحفظ (قاعدة البيانات تعيد التحقق من كل شيء)
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /تأكيد الحجز|حجز المجموعة|إنشاء الحجز المتكرر/ }).click();
};
const newGuest = async (name, phone) => {
  await page.getByRole("button", { name: /نزيل جديد/ }).click().catch(() => {});
  await page.fill("#new_guest_name", name);
  if (phone) await page.fill("#new_guest_phone", phone);
};

// فندق جديد (القسمان مفعّلان افتراضيًا)
if (process.env.LOCAL) {
  await page.goto(BASE + "/"); await page.waitForURL(/onboarding/, { timeout: 120000 });
} else {
  await page.goto(BASE + "/login");
  await page.getByRole("button", { name: /أنشئ حسابًا/ }).click();
  await page.fill("#email", `pms-${Date.now()}@test.dev`); await page.fill("#password", "Passw0rd!123");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL(/onboarding/);
}
await page.fill("#name_ar", "فندق الحجوزات");
await page.selectOption("#country_code", "YE"); await page.selectOption("#base_currency", "YER"); await page.selectOption("#fiscal_year_start_month", "1"); await page.selectOption("#timezone", TZ);
await page.getByRole("button", { name: "إنشاء الفندق" }).click();
await page.waitForURL((u) => u.pathname === "/", { timeout: 120000 });

await step("room type DBL (nightly, weekend rate)", async () => {
  await go("/room-setup?new=1");
  await page.fill("#code", "DBL"); await page.fill("#name_ar", "غرفة مزدوجة");
  await page.fill("#base_rate", "300"); await page.fill("#weekend_rate", "350");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/room-setup$/); await bodyHas("DBL", "غرفة مزدوجة", "300.00");
});
await step("hourly hall type", async () => {
  await go("/room-setup?new=1");
  await page.fill("#code", "HALL"); await page.fill("#name_ar", "قاعة");
  await page.selectOption("#booking_mode", "hourly"); await page.fill("#base_rate", "100"); await page.fill("#min_hours", "2"); await page.fill("#max_adults", "150");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/room-setup$/); await bodyHas("HALL", "بالساعة");
});
await step("bulk rooms 101-103 and hall H1", async () => {
  await go("/room-setup?tab=rooms");
  await pick("#room_type_id", /DBL/); await page.fill("#from_number", "101"); await page.fill("#to_number", "103");
  await page.getByRole("button", { name: "إضافة الغرف" }).click(); await bodyHas("101", "102", "103");
  await pick("#room_type_id", /HALL/); await page.fill("#from_number", "1"); await page.fill("#to_number", "1"); await page.fill("#prefix", "H");
  await page.getByRole("button", { name: "إضافة الغرف" }).click(); await bodyHas("H1");
});

let firstId = "";
await step("reservation with a new guest (3 nights, weekend pricing)", async () => {
  await go("/reservations/new");
  await newGuest("سالم أحمد", "777000111");
  await pick("#room_type_id", /DBL/);
  await page.fill("#arrival_date", plus(10)); await page.fill("#nights", "3");
  const expected = [10, 11, 12].reduce((a, n) => a + (weekend(plus(n)) ? 350 : 300), 0);
  await page.locator(`text=${fmt(expected)}`).first().waitFor({ timeout: 20000 });
  await submitReservation();
  await page.waitForURL(/reservations\/[0-9a-f-]{36}$/);
  firstId = page.url().split("/").pop();
  await bodyHas("RSV-", "سالم أحمد", fmt(expected));
});
await step("assign room 101", async () => {
  await pick(page.locator("select[aria-label='الغرفة']"), /101/);
  await page.getByRole("button", { name: "حفظ الغرفة" }).click();
  await page.waitForTimeout(1200); await go(`/reservations/${firstId}`); await bodyHas("101");
});
await step("double booking of room 101 is blocked", async () => {
  await go("/reservations/new");
  await newGuest("منى علي");
  await pick("#room_type_id", /DBL/); await page.fill("#arrival_date", plus(11)); await page.fill("#nights", "1");
  await pick("#room_id", /101/);
  await submitReservation();
  await page.locator("[role=alert]").filter({ hasText: "محجوزة في فترة متداخلة" }).waitFor();
});
await step("fill the type, then quote shows no availability and waitlist link", async () => {
  for (const name of ["نزيل 2", "نزيل 3"]) {
    await go("/reservations/new"); await newGuest(name);
    await pick("#room_type_id", /DBL/); await page.fill("#arrival_date", plus(10)); await page.fill("#nights", "3");
    await submitReservation(); await page.waitForURL(/reservations\/[0-9a-f-]{36}$/);
  }
  await go("/reservations/new"); await newGuest("نزيل 4");
  await pick("#room_type_id", /DBL/); await page.fill("#arrival_date", plus(10)); await page.fill("#nights", "2");
  await page.locator("text=لا توجد غرف متاحة").first().waitFor();
  await page.getByRole("link", { name: "أضفه لقائمة الانتظار" }).click();
  await page.waitForURL(/waitlist\?new=1/);
  await page.fill("#guest_name", "ضيف منتظر"); await page.fill("#phone", "777999");
  await page.getByRole("button", { name: "إضافة للانتظار" }).click();
  await page.waitForURL(/waitlist$/); await bodyHas("ضيف منتظر", "لا تتوفر غرفة بعد");
});
await step("cancelling frees a room; waitlist converts to a reservation", async () => {
  await go(`/reservations/${firstId}`);
  await page.getByRole("button", { name: "إلغاء الحجز" }).click();
  await page.locator("form input").last().fill("طلب النزيل");
  await page.locator("form").getByRole("button", { name: "إلغاء الحجز" }).click();
  await bodyHas("ملغى", "طلب النزيل");
  await go("/front-desk"); await bodyHas("طلب انتظار أصبح متاحًا");
  await go("/waitlist"); await bodyHas("متاح الآن");
  await page.getByRole("button", { name: "تحويل لحجز" }).click();
  await page.waitForURL(/reservations\/[0-9a-f-]{36}$/); await bodyHas("ضيف منتظر", "مؤكد");
});
await step("hourly hall booking 4h = 400", async () => {
  await go("/reservations/new"); await newGuest("شركة الحفلات");
  await pick("#room_type_id", /HALL/); await pick("#room_id", /H1/);
  await page.fill("#session_date", plus(3)); await page.fill("#start_time", "16:00"); await page.fill("#end_time", "20:00");
  await page.fill("#adults", "80");
  await page.locator(`text=${fmt(400)}`).first().waitFor();
  await submitReservation(); await page.waitForURL(/reservations\/[0-9a-f-]{36}$/);
  await bodyHas("16:00–20:00", "400.00");
});
await step("weekly recurring stay (4 weeks)", async () => {
  await go("/reservations/new?kind=series"); await newGuest("نزيل الخميس");
  await pick("#room_type_id", /DBL/);
  await page.fill("#series_start", plus(30)); await page.fill("#series_end", plus(30 + 27)); await page.fill("#series_nights", "1");
  await submitReservation();
  await page.waitForURL(/reservations\?series=/); await bodyHas("الحجز المتكرر", "4 حجز مرتبط");
});
await step("group of 2 rooms", async () => {
  await go("/reservations/new?kind=group"); await newGuest("قائد الوفد");
  await pick("#room_type_id", /DBL/); await page.fill("#arrival_date", plus(40)); await page.fill("#nights", "2");
  await page.fill("#group_name", "وفد الاختبار"); await page.fill("#group_rooms", "2");
  await submitReservation();
  await page.waitForURL(/reservations\?group=/); await bodyHas("حجوزات المجموعة", "2 حجز مرتبط");
});
await step("new season prices future nights; existing bookings keep their rates", async () => {
  await go("/rates?season=new");
  await page.fill("#name", "موسم الاختبار"); await page.fill("#date_from", plus(30)); await page.fill("#date_to", plus(60));
  await page.locator("input[placeholder='—']").first().fill("500");
  await page.getByRole("button", { name: "حفظ الموسم" }).click();
  await page.waitForURL(/rates$/); await bodyHas("موسم الاختبار");
  await go(`/rates?start=${plus(30)}`); await bodyHas("500");
  // حجز المجموعة (+40) أُنشئ قبل الموسم فيبقى بسعره القديم
  await go("/reservations?tab=all&q=" + encodeURIComponent("قائد الوفد"));
  await bodyHas(fmt([40, 41].reduce((a, n) => a + (weekend(plus(n)) ? 350 : 300), 0)));
});
await step("last-minute deal applies to arrivals within a day", async () => {
  await go("/rates?rule=new");
  await page.getByRole("button", { name: "حفظ" }).click();
  await page.waitForURL(/rates$/); await bodyHas("عرض الليلة");
  await go("/reservations/new"); await newGuest("نزيل الليلة");
  await pick("#room_type_id", /DBL/); await page.fill("#arrival_date", plus(1)); await page.fill("#nights", "1");
  await page.locator("text=خصم اللحظة الأخيرة 15%").first().waitFor();
});
await step("room status: mark 102 dirty", async () => {
  await go("/rooms");
  await page.getByRole("button", { name: /^102/ }).click();
  await page.getByRole("button", { name: "تحتاج تنظيف", exact: true }).click();
  await page.waitForTimeout(1200); await go("/rooms?filter=dirty"); await bodyHas("102");
});
await step("tape chart and guest profile", async () => {
  await go("/tape-chart"); await bodyHas("جدول الإشغال", "101");
  await go("/guests?q=" + encodeURIComponent("سالم")); await page.getByRole("link", { name: /سالم أحمد/ }).first().click();
  await page.waitForURL(/guests\/[0-9a-f-]{36}$/); await bodyHas("سجل الحجوزات", "ملغى");
});
let stayId = "";
await step("deposit before arrival opens the folio in accounting", async () => {
  await go("/reservations/new"); await newGuest("نزيل التسكين", "777222333");
  await pick("#room_type_id", /DBL/); await page.fill("#arrival_date", today); await page.fill("#nights", "2");
  await pick("#room_id", /103/);
  await submitReservation(); await page.waitForURL(/reservations\/[0-9a-f-]{36}$/);
  stayId = page.url().split("/").pop();
  await page.fill("#dep_amount", "100"); await page.fill("#dep_ref", "TRX-1");
  await page.getByRole("button", { name: "تسجيل", exact: true }).click();
  await bodyHas("فتح الفوليو", "100.00");
});
await step("dirty room blocks check-in; clean room checks in", async () => {
  await pick("#checkin_room", /102/);
  await page.getByRole("button", { name: "تسكين" }).click();
  await page.locator("text=لم تُنظَّف بعد").first().waitFor();
  await pick("#checkin_room", /103/);
  await page.getByRole("button", { name: "تسكين" }).click();
  await bodyHas("مقيم", "تسجيل المغادرة", "أثناء الإقامة");
});
await step("post tonight, extend the stay and move rooms", async () => {
  await page.getByRole("button", { name: "ترحيل الليالي" }).click();
  await bodyHas("مُرحَّل على الفوليو: 1 من 2");
  await page.fill("#new_departure", plus(3));
  await page.getByRole("button", { name: "تمديد" }).click();
  await bodyHas("3 ليلة");
  await pick("#move_room", /101/); await page.fill("#move_reason", "ترقية");
  await page.getByRole("button", { name: "نقل", exact: true }).click();
  await page.waitForTimeout(1500); await go(`/reservations/${stayId}`);
  await bodyHas("نُقل", "101");
});
await step("early check-out: pay the balance and issue the tax invoice", async () => {
  await page.getByRole("button", { name: "تجهيز الفاتورة" }).click();
  await bodyHas("المستحق");
  await page.getByRole("button", { name: /تسجيل المغادرة/ }).last().click();
  await page.waitForURL(/invoices\/[0-9a-f-]{36}$/, { timeout: 30000 });
  await bodyHas("نزيل التسكين");
  await go(`/reservations/${stayId}`); await bodyHas("غادر", "1 ليلة");
  await go("/rooms?filter=dirty"); await bodyHas("101");
});
await step("front desk quick check-in and in-house list", async () => {
  // 103 أصبحت تحتاج تنظيف بعد نقل النزيل منها
  await go("/rooms");
  await page.getByRole("button", { name: /^103/ }).click();
  await page.getByRole("button", { name: "نظيفة", exact: true }).click();
  await page.waitForTimeout(1200);
  await go("/reservations/new"); await newGuest("نزيل سريع");
  await pick("#room_type_id", /DBL/); await page.fill("#arrival_date", today); await page.fill("#nights", "1");
  await pick("#room_id", /103/);
  await submitReservation(); await page.waitForURL(/reservations\/[0-9a-f-]{36}$/);
  await go("/front-desk");
  await page.getByRole("row", { name: /نزيل سريع/ }).getByRole("button", { name: "تسكين" }).click();
  await page.waitForTimeout(1500); await go("/front-desk");
  await bodyHas("المقيمون الآن", "نزيل سريع");
  if (!/المقيمون الآن[\s\S]*نزيل سريع/.test(await page.locator("main").innerText())) throw new Error("guest not in the in-house list");
});
await step("exchange rate and a US-dollar cash method", async () => {
  await go("/settings/currencies");
  await page.selectOption("#currency", "USD"); await page.fill("#rate", "530");
  await page.getByRole("button", { name: "حفظ السعر" }).click();
  await bodyHas("530");
  await go("/settings/revenue?new=method");
  await page.fill("#code", "USD"); await page.fill("#name_ar", "نقدًا دولار");
  await page.selectOption("#kind", "cash"); await pick("#account_id", /الصندوق الرئيسي/); await page.selectOption("#currency_code", "USD");
  await page.getByRole("button", { name: /حفظ/ }).first().click();
  await page.waitForURL(/settings\/revenue$/); await bodyHas("نقدًا دولار", "USD");
});
await step("cashier shift opens with a float", async () => {
  await go("/cashier");
  await page.fill("#opening_float", "1000");
  await page.getByRole("button", { name: "فتح الوردية" }).click();
  await bodyHas("SHF-", "إغلاق الوردية");
});
await step("dollar deposit, check-out refunds the extra deposit in cash", async () => {
  await go("/rooms");
  await page.getByRole("button", { name: /^102/ }).click();
  await page.getByRole("button", { name: "نظيفة", exact: true }).click();
  await page.waitForTimeout(1200);
  await go("/reservations/new"); await newGuest("نزيل الدولار");
  await pick("#room_type_id", /DBL/); await page.fill("#arrival_date", today); await page.fill("#nights", "1");
  await pick("#room_id", /102/);
  await submitReservation(); await page.waitForURL(/reservations\/[0-9a-f-]{36}$/);

  await pick("#dep_method", /USD/); await page.fill("#dep_amount", "1");
  await page.locator("text=≈ 530.00").first().waitFor();
  await page.getByRole("button", { name: "تسجيل", exact: true }).click();
  await bodyHas("530.00");
  await page.getByRole("button", { name: "تسكين" }).click();
  await bodyHas("مقيم", "تسجيل المغادرة");
  await page.getByRole("button", { name: "تجهيز الفاتورة" }).click();
  await bodyHas("عربون زائد عن الرصيد");
  await page.getByRole("button", { name: "إرجاعه نقدًا" }).click();
  await page.locator("text=عربون زائد عن الرصيد").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "تسجيل المغادرة وإصدار الفاتورة" }).click();
  await page.waitForURL(/invoices\/[0-9a-f-]{36}$/, { timeout: 30000 });
  await bodyHas("نزيل الدولار");
});
await step("closing the shift with a cash shortage posts the difference", async () => {
  await go("/cashier");
  await bodyHas("نقدًا دولار", "نزيل الدولار");
  const cash = page.locator("input[id^='count_']").first();
  const usd = page.locator("input[id^='count_']").nth(1);
  const expCash = Number((await cash.getAttribute("placeholder")).replace(/[^\d.]/g, ""));
  const expUsd = Number((await usd.getAttribute("placeholder")).replace(/[^\d.]/g, ""));
  if (expUsd !== 1) throw new Error(`usd expected ${expUsd}`);
  await cash.fill(String(expCash - 5)); await usd.fill("1");
  await page.locator("text=عجز 5.00").first().waitFor();
  await page.getByRole("button", { name: /إغلاق الوردية وتسليم الصندوق/ }).click();
  await page.waitForURL(/cashier\/[0-9a-f-]{36}$/);
  await bodyHas("مغلقة", "عجز", "5.00");
});
await step("night audit posts tonight, marks no-shows and saves the manager report", async () => {
  await go("/night-audit");
  await bodyHas("جاهز للتدقيق");
  await page.getByRole("button", { name: "تشغيل تدقيق نهاية اليوم" }).click();
  await page.waitForURL(new RegExp(`night-audit/${today}$`), { timeout: 60000 });
  await bodyHas("تقرير المدير اليومي", "مدقق", "الإيرادات حسب الفئة", "غرف");
  await go("/night-audit"); await bodyHas("دُقّق اليوم", today);
  if (await page.getByRole("button", { name: "تشغيل تدقيق نهاية اليوم" }).count()) throw new Error("audit can run twice");
});
await step("guest register lists tonight's in-house guests", async () => {
  await go(`/guest-register?date=${today}`);
  await bodyHas("كشف النزلاء", "نزيل سريع", "103");
});
await step("rate plan with breakfast reprices a booking", async () => {
  await go("/rate-plans");
  await page.fill("#code", "BB"); await page.fill("#name_ar", "مع الإفطار"); await page.fill("#per_night", "25");
  await page.locator("label", { hasText: "الإضافة لكل شخص بالغ" }).locator("input").check();
  await page.locator("label", { hasText: "تشمل الإفطار" }).locator("input").check();
  await page.getByRole("button", { name: "حفظ الخطة" }).click();
  await bodyHas("BB", "يشمل الإفطار");
  await go("/reservations/new"); await newGuest("نزيل الإفطار");
  await pick("#room_type_id", /DBL/); await page.fill("#arrival_date", plus(20)); await page.fill("#nights", "1");
  await submitReservation(); await page.waitForURL(/reservations\/[0-9a-f-]{36}$/);
  await pick(page.locator("select[aria-label='خطة السعر']"), /مع الإفطار/);
  await page.getByRole("button", { name: "تطبيق", exact: true }).click();
  await bodyHas(fmt((weekend(plus(20)) ? 350 : 300) + 25));
});
await step("point of sale: room charge and paid order with invoice", async () => {
  await go("/pos/setup");
  await page.fill("#code", "REST"); await page.fill("#name_ar", "المطعم");
  await page.getByRole("button", { name: "حفظ النقطة" }).click();
  await bodyHas("المطعم");
  await page.fill("#item_name", "مندي"); await page.fill("#price", "60");
  await page.getByRole("button", { name: "حفظ الصنف" }).click();
  await bodyHas("مندي", "60.00");
  await go("/pos");
  await page.getByRole("button", { name: /مندي/ }).click(); await page.getByRole("button", { name: /مندي/ }).click();
  await bodyHas("120.00");
  await pick("#pos_guest", /نزيل سريع/);
  await page.getByRole("button", { name: "ترحيل على الغرفة" }).click();
  await bodyHas("POS-", "على الغرفة");
  await page.getByRole("button", { name: /مندي/ }).click();
  await page.getByRole("button", { name: /دفع فوري/ }).click();
  await page.getByRole("button", { name: "دفع وإصدار الفاتورة" }).click();
  await page.getByRole("link", { name: /الفاتورة/ }).waitFor();
  await bodyHas("مدفوع");
});
await step("housekeeping: generate today's tasks and finish one", async () => {
  await go("/housekeeping");
  await page.getByRole("button", { name: "توليد مهام اليوم" }).click();
  await page.getByRole("button", { name: "تم", exact: true }).first().waitFor({ timeout: 20000 });
  await bodyHas("تنظيف مغادرة");
  await page.getByRole("button", { name: "تم", exact: true }).first().click();
  await page.waitForTimeout(1500); await go("/housekeeping?tab=done");
  await bodyHas("أُنجزت");
});
await step("registration card prints the guest and stay details", async () => {
  await go(`/reservations/${stayId}/card`);
  await bodyHas("بطاقة تسجيل نزيل", "نزيل التسكين", "توقيع النزيل");
});
await step("opening balances post once and balance to retained earnings", async () => {
  await go("/opening-balances");
  await pick(page.locator("select[aria-label='الحساب 1']"), /الصندوق الرئيسي/); await page.fill("input[aria-label='مدين 1']", "5000");
  await page.getByRole("button", { name: "سطر" }).click();
  await pick(page.locator("select[aria-label='الحساب 2']"), /رأس المال/); await page.fill("input[aria-label='دائن 2']", "4000");
  await bodyHas("الفرق للأرباح المبقاة");
  await page.getByRole("button", { name: "ترحيل الأرصدة الافتتاحية" }).click();
  await page.waitForURL(/journal\/[0-9a-f-]{36}$/, { timeout: 30000 });
  await bodyHas("الأرصدة الافتتاحية", "فرق الأرصدة الافتتاحية");
  await go("/opening-balances"); await bodyHas("رُحّلت الأرصدة الافتتاحية");
});
await step("backup downloads and restores the whole database", async () => {
  const res = await page.request.get(BASE + "/api/backup");
  if (res.status() !== 200) throw new Error(`backup status ${res.status()}`);
  const buf = await res.body();
  if (buf.length < 10000) throw new Error(`backup too small ${buf.length}`);
  await go("/settings/hotel");
  await page.locator("input[aria-label='ملف النسخة الاحتياطية']").setInputFiles({ name: "backup.tar.gz", mimeType: "application/gzip", buffer: buf });
  await page.waitForURL((u) => u.pathname === "/", { timeout: 120000 });
  await go("/guests"); await bodyHas("نزيل التسكين", "نزيل سريع");
});
await step("modules: disabling hotel management hides it and blocks its pages", async () => {
  await go("/settings/hotel");
  await page.locator("label", { hasText: "إدارة الفندق" }).locator("input[type=checkbox]").uncheck();
  await page.getByRole("button", { name: "حفظ", exact: true }).last().click();
  await page.waitForTimeout(1500);
  await go("/"); await bodyLacks("الاستقبال والحجوزات");
  await go("/front-desk"); await bodyHas("403");
  await go("/settings/hotel");
  await page.locator("label", { hasText: "إدارة الفندق" }).locator("input[type=checkbox]").check();
  await page.getByRole("button", { name: "حفظ", exact: true }).last().click();
  await page.waitForTimeout(1500);
  await go("/front-desk"); await bodyHas("لوحة الاستقبال");
});

console.log(`\nproblems (${problems.length}):`);
for (const p of problems) console.log(" - " + p);
await browser.close();
process.exit(problems.length ? 1 : 0);

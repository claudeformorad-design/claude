import type { Locale } from "@/i18n/config";

/**
 * الأوصاف التي تكتبها قاعدة البيانات بنفسها (قيود النظام والسندات والحركات) محفوظة نصًا ثابتًا:
 * القديمة عربية فقط ("عكس القيد ...")، والأحدث بالعربي والإنجليزي معًا ("إطفاء مصروف مقدم / Prepaid amortization — ...").
 * عند العرض: الواجهة العربية تأخذ الجزء العربي فقط، والإنجليزية تأخذ الإنجليزي وتترجم العبارات الثابتة المعروفة.
 * ما كتبه المستخدم بنفسه (أسماء، ملاحظات) يبقى كما كُتب.
 */

/** أزواج "عربي / English" كما تكتبها دوال القاعدة */
const PAIRS: [string, string][] = [
  ["إطفاء مصروف مقدم", "Prepaid amortization"],
  ["إعادة تقييم أرصدة العملات", "FX revaluation"],
  ["إعدام دين معدوم", "Bad debt write-off"],
  ["إشعار دائن", "Credit note"],
  ["إلغاء تحويل", "Transfer cancelled"],
  ["إلغاء سند", "Void"],
  ["إلغاء", "Void"],
  ["إهلاك", "Depreciation"],
  ["ارتداد شيك", "Cheque returned"],
  ["استبعاد أصل", "Asset disposal"],
  ["تبديل عملة", "Currency exchange"],
  ["تحصيل شيك وارد", "Cheque collected"],
  ["تحويل أموال", "Fund transfer"],
  ["تحويل إلى", "Transfer to"],
  ["تحويل من", "Transfer from"],
  ["تسجيل أصل", "Asset acquisition"],
  ["تطبيق العربون", "Deposit applied"],
  ["تطبيق عربون مورد", "Vendor advance applied"],
  ["سداد مورد", "Vendor payment"],
  ["صرف شيك صادر", "Cheque cleared"],
  ["عربون مورد", "Vendor advance"],
  ["عكس القيد", "Reversal of"],
  ["عكس عمولة وكيل حجز", "Booking commission reversal"],
  ["عمولة وكيل حجز", "Booking commission"],
  ["فاتورة آجلة", "Credit invoice"],
  ["فاتورة مورد", "Vendor bill"],
  ["قيد إقفال السنة", "Year-end closing"],
  ["مخزون", "Inventory"],
  ["مرتجع مشتريات", "Purchase return"],
  ["مسيّر رواتب", "Payroll"],
];

/** عبارات النظام العربية فقط (بداية الوصف أو بعد فاصل) ومقابلها بالإنجليزي */
const PHRASES: [string, string][] = [
  ...PAIRS,
  ["مخصص مكافأة نهاية الخدمة", "End-of-service provision"],
  ["فروقات إغلاق وردية الكاشير", "Cashier shift closing difference"],
  ["تدقيق نهاية اليوم", "Night audit"],
  ["التسوية النهائية", "Final settlement"],
  ["نُقل من الغرفة", "Moved from room"],
  ["رصيد افتتاحي", "Opening balance"],
  ["عربون الحجز", "Reservation deposit"],
  ["إقامة ليلة", "Night stay"],
  ["خصم المناسبة", "Event discount"],
  ["سلفة موظف", "Employee advance"],
  ["صرف رواتب", "Salaries payment"],
  ["تسوية مدفوعات البطاقات", "Card payments settlement"],
  ["دفع طلب", "Order payment"],
  ["بعد خصم", "after discount"],
  ["غسيل", "Laundry"],
  ["صيانة", "Maintenance"],
  ["زبون", "Customer"],
  ["غرفة", "Room"],
  ["جرد", "Stock count"],
  // أسماء طرق الدفع وبنود الخدمات الافتراضية (يكتبها النظام في أوصاف القيود؛ ما يضيفه الفندق يبقى كما كتبه)
  ["بطاقة ائتمان / مدى", "Credit/debit card"],
  ["تحويل بنكي", "Bank transfer"],
  ["محفظة إلكترونية", "E-wallet"],
  ["آجل (حساب شركة)", "City ledger (credit)"],
  ["العهدة النثرية", "Petty cash"],
  ["شيك وارد مؤجل", "Post-dated cheque received"],
  ["شيك صادر مؤجل", "Post-dated cheque issued"],
  ["إقامة / ليلة", "Room night"],
  ["مطعم - أطعمة", "Restaurant food"],
  ["خدمات السبا", "Spa services"],
  ["قاعات ومؤتمرات", "Banquets & events"],
  ["جولات سياحية", "Tours"],
  ["غسيل ملابس", "Laundry"],
  ["إيرادات متنوعة", "Miscellaneous"],
  ["رسوم الإلغاء وعدم الحضور", "Cancellation and no-show fees"],
  ["مشروبات", "Beverages"],
  ["ميني بار", "Minibar"],
  ["المتجر", "Shop"],
  ["مواقف", "Parking"],
  ["نقدًا", "Cash"],
  ["شيك", "Cheque"],
  ["نقل", "Transport"],
];

/** أوصاف كاملة شائعة (البيانات التجريبية وما يكتبه النظام كاملًا) */
const WHOLE: Record<string, string> = {
  "تحصيل فاتورة": "Invoice collection",
  "إيداع رأس المال": "Capital deposit",
  "حوالة مسبقة": "Advance transfer",
  "حركة بنكية": "Bank transaction",
  "إيجار المبنى": "Building rent",
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const longestFirst = <T extends [string, string]>(xs: T[]) => [...xs].sort((a, b) => b[0].length - a[0].length);

// "عربي / English" ← الجانب المطلوب
const PAIR_RES = longestFirst(PAIRS).map(([ar, en]) => ({ re: new RegExp(`${esc(ar)} / ${esc(en)}`, "g"), ar, en }));
// العبارة كلمة كاملة: قبلها بداية أو مسافة أو فاصل، وبعدها نهاية أو مسافة أو فاصل.
// الكلمة المفردة ("صيانة") لا تُترجم إن تلتها كلمة عربية، فـ"صيانة التكييف" التي كتبها المستخدم تبقى كما هي
const PHRASE_RES = longestFirst(PHRASES).map(([ar, en]) => {
  const after = ar.includes(" ") ? "(?=$|[\\s—–:،)])" : "(?=$|\\s*[—–:،)]|\\s+[^\\sء-ي])";
  return { re: new RegExp(`(?<=^|[\\s—–:،(])${esc(ar)}${after}`, "g"), en };
});

export function localizeStored(text: string, locale: Locale): string {
  const trimmed = text.trim();
  if (locale === "en" && WHOLE[trimmed]) return WHOLE[trimmed];
  let out = text;
  for (const p of PAIR_RES) out = out.replace(p.re, locale === "en" ? p.en : p.ar);
  if (locale === "en" && /[ء-ي]/.test(out)) {
    for (const p of PHRASE_RES) out = out.replace(p.re, p.en);
  }
  return out;
}

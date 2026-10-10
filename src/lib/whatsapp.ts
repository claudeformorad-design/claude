/**
 * رسائل واتساب: روابط wa.me تفتح محادثة النزيل برسالة جاهزة، والموظف يضغط إرسال من جهازه.
 * لا يُرسل شيء من الخادم، ولا يحتاج اشتراكًا.
 */

export const TEMPLATE_KEYS = ["reservation_confirm", "arrival_reminder", "payment_receipt", "checkout_thanks", "balance_reminder"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** النصوص الافتراضية؛ ما بين القوسين المعقوفين يُستبدل بقيمته */
export const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  reservation_confirm:
    "أهلًا {guest}،\nتم تأكيد حجزك في {hotel}.\nرقم الحجز: {confirmation}\nالوصول: {arrival}\nالمغادرة: {departure}\nالغرفة: {room_type}\nالمبلغ: {total}\nنتشرف باستقبالك.",
  arrival_reminder:
    "أهلًا {guest}،\nنذكّرك بموعد وصولك إلى {hotel} يوم {arrival}.\nرقم الحجز: {confirmation}\nننتظرك، وللاستفسار تواصل معنا على {hotel_phone}.",
  payment_receipt:
    "أهلًا {guest}،\nاستلمنا منك {amount} عن طريق {method}.\nرقم العملية: {reference}\nالمستند: {document}\nشكرًا لك، {hotel}.",
  checkout_thanks:
    "شكرًا {guest} على إقامتك في {hotel}.\nإجمالي الفاتورة: {total}\nيسعدنا رأيك في إقامتك: {survey_link}\nنتمنى نشوفك مرة ثانية.",
  balance_reminder:
    "السادة {customer}،\nنود تذكيركم بالرصيد المستحق لدى {hotel}: {balance}.\nنرجو التكرم بالسداد، وشكرًا لتعاونكم.",
};

/** الحقول المتاحة لكل رسالة (تظهر في شاشة تعديل النصوص) */
export const TEMPLATE_FIELDS: Record<TemplateKey, string[]> = {
  reservation_confirm: ["guest", "hotel", "confirmation", "arrival", "departure", "nights", "room_type", "room", "total", "hotel_phone"],
  arrival_reminder: ["guest", "hotel", "confirmation", "arrival", "departure", "room_type", "hotel_phone"],
  payment_receipt: ["guest", "hotel", "amount", "method", "reference", "document", "date", "hotel_phone"],
  checkout_thanks: ["guest", "hotel", "total", "invoice", "survey_link", "hotel_phone"],
  balance_reminder: ["customer", "hotel", "balance", "hotel_phone"],
};

/** مفتاح الاتصال الدولي لدول الفنادق المدعومة */
const DIAL: Record<string, string> = {
  YE: "967", SA: "966", AE: "971", KW: "965", QA: "974", BH: "973", OM: "968", EG: "20", JO: "962", IQ: "964", SD: "249",
  LB: "961", SY: "963", PS: "970", LY: "218", TN: "216", DZ: "213", MA: "212",
};

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/**
 * رقم بصيغة دولية (أرقام فقط) لرابط واتساب، أو null إن لم يكن رقمًا صالحًا.
 * يقبل: 777123456، 0777123456، 967777123456، +967 777 123 456، 00967777123456، وبالأرقام العربية.
 */
export function normalizePhone(raw: string | null | undefined, countryCode: string): string | null {
  if (!raw) return null;
  const s = raw.replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] ?? d).trim();
  const plus = s.startsWith("+");
  let digits = s.replace(/\D/g, "");
  if (!digits) return null;
  const dial = DIAL[countryCode.toUpperCase()] ?? "";
  if (plus) {
    // الرقم دولي أصلًا
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (dial && digits.startsWith(dial) && digits.length > dial.length + 6) {
    // يبدأ بمفتاح الدولة بلا +
  } else if (dial) {
    digits = dial + digits.replace(/^0+/, "");
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** تعبئة النص: {name} يُستبدل بقيمته، وأي سطر بقيت فيه قيمة فارغة يُحذف كاملًا */
export function fillTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template
    .split("\n")
    .flatMap((line) => {
      let empty = false;
      const out = line.replace(/\{([a-z_]+)\}/g, (m, k: string) => {
        if (!(k in vars)) return m;
        const v = vars[k];
        if (v === null || v === undefined || String(v).trim() === "") { empty = true; return ""; }
        return String(v);
      });
      return empty ? [] : [out];
    })
    .join("\n")
    .trim();
}

/** رابط واتساب: بالرقم إن وُجد، وإلا يفتح قائمة المحادثات ليختار الموظف المستلم */
export function whatsappLink(phone: string | null, text: string): string {
  const q = `text=${encodeURIComponent(text)}`;
  return phone ? `https://wa.me/${phone}?${q}` : `https://wa.me/?${q}`;
}

/** النص المعتمد للفندق: نصه الخاص إن وُجد، وإلا الافتراضي */
export function templateFor(key: TemplateKey, custom: Partial<Record<string, string>>): string {
  return custom[key]?.trim() || DEFAULT_TEMPLATES[key];
}

import { toMoney } from "./money";

/**
 * التفقيط: كتابة المبلغ بالحروف كما يُكتب في السندات والشيكات، مثل
 * «فقط خمسة آلاف ومائتان وخمسون ريال يمني لا غير».
 * الصيغة المحاسبية المعتادة بلا تنوين ولا إعراب لاسم العملة، والكسور بالوحدة الصغرى للعملة.
 */

const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const TEENS = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

/** المراتب: مفرد، مثنى، جمع (3 إلى 10) */
const SCALES: [string, string, string][] = [
  ["", "", ""],
  ["ألف", "ألفان", "آلاف"],
  ["مليون", "مليونان", "ملايين"],
  ["مليار", "ملياران", "مليارات"],
  ["تريليون", "تريليونان", "تريليونات"],
];

/** الوحدة الكبرى والصغرى لكل عملة، وغيرها يُكتب باسم العملة العام */
const CURRENCY_WORDS: Record<string, { major: string; minor: string }> = {
  YER: { major: "ريال يمني", minor: "فلس" },
  SAR: { major: "ريال سعودي", minor: "هللة" },
  USD: { major: "دولار أمريكي", minor: "سنت" },
  EUR: { major: "يورو", minor: "سنت" },
  AED: { major: "درهم إماراتي", minor: "فلس" },
  OMR: { major: "ريال عماني", minor: "بيسة" },
  KWD: { major: "دينار كويتي", minor: "فلس" },
  QAR: { major: "ريال قطري", minor: "درهم" },
  BHD: { major: "دينار بحريني", minor: "فلس" },
  EGP: { major: "جنيه مصري", minor: "قرش" },
  JOD: { major: "دينار أردني", minor: "قرش" },
  GBP: { major: "جنيه إسترليني", minor: "بنس" },
};

/** من 1 إلى 999 */
function belowThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]!);
  if (rest) {
    if (rest < 10) parts.push(ONES[rest]!);
    else if (rest < 20) parts.push(TEENS[rest - 10]!);
    else {
      const o = rest % 10;
      const tens = TENS[Math.floor(rest / 10)]!;
      parts.push(o ? `${ONES[o]} و${tens}` : tens);
    }
  }
  return parts.join(" و");
}

/** عدد صحيح موجب بالحروف */
export function integerToArabicWords(value: bigint | number): string {
  let n = BigInt(value);
  if (n === 0n) return "صفر";
  if (n < 0n) return `سالب ${integerToArabicWords(-n)}`;
  const groups: number[] = [];
  while (n > 0n) { groups.push(Number(n % 1000n)); n /= 1000n; }
  if (groups.length > SCALES.length) throw new Error("Number too large");
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (!g) continue;
    if (i === 0) { parts.push(belowThousand(g)); continue; }
    const [one, two, many] = SCALES[i]!;
    const tail = g % 100;
    if (g === 1) parts.push(one);
    else if (g === 2) parts.push(two);
    else if (tail >= 3 && tail <= 10) parts.push(`${belowThousand(g)} ${many}`);
    else parts.push(`${belowThousand(g)} ${one}`);
  }
  return parts.join(" و");
}

/** المبلغ بالحروف مع العملة: «فقط ... لا غير» */
export function amountInArabicWords(amount: string | number, currencyCode: string, decimals = 2, fallbackName?: string): string {
  const v = toMoney(String(amount)).abs().toDecimalPlaces(decimals);
  const [intPart, frac = ""] = v.toFixed(decimals).split(".");
  const words = CURRENCY_WORDS[currencyCode] ?? { major: fallbackName ?? currencyCode, minor: "" };
  const minor = frac ? Number(frac) : 0;
  let text = `${integerToArabicWords(BigInt(intPart!))} ${words.major}`;
  if (minor > 0) text += ` و${integerToArabicWords(minor)} ${words.minor || `من ${integerToArabicWords(10 ** decimals)}`}`;
  return `فقط ${text} لا غير`;
}

// -----------------------------------------------------------------------------
// المبلغ بالإنجليزية للواجهة الإنجليزية: "Only five thousand two hundred fifty Yemeni rials"
// -----------------------------------------------------------------------------
const EN_ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const EN_SCALES = ["", "thousand", "million", "billion", "trillion"];
const EN_CURRENCY: Record<string, { major: string; minor: string }> = {
  YER: { major: "Yemeni rials", minor: "fils" }, SAR: { major: "Saudi riyals", minor: "halalas" }, USD: { major: "US dollars", minor: "cents" },
  EUR: { major: "euros", minor: "cents" }, AED: { major: "UAE dirhams", minor: "fils" }, OMR: { major: "Omani rials", minor: "baisa" },
  KWD: { major: "Kuwaiti dinars", minor: "fils" }, QAR: { major: "Qatari riyals", minor: "dirhams" }, BHD: { major: "Bahraini dinars", minor: "fils" },
  EGP: { major: "Egyptian pounds", minor: "piastres" }, JOD: { major: "Jordanian dinars", minor: "piastres" }, GBP: { major: "pounds sterling", minor: "pence" },
};

function enBelowThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(`${EN_ONES[h]} hundred`);
  if (rest) parts.push(rest < 20 ? EN_ONES[rest]! : `${EN_TENS[Math.floor(rest / 10)]}${rest % 10 ? ` ${EN_ONES[rest % 10]}` : ""}`);
  return parts.join(" ");
}

export function integerToEnglishWords(value: bigint | number): string {
  let n = BigInt(value);
  if (n === 0n) return "zero";
  const groups: number[] = [];
  while (n > 0n) { groups.push(Number(n % 1000n)); n /= 1000n; }
  if (groups.length > EN_SCALES.length) throw new Error("Number too large");
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (g) parts.push(`${enBelowThousand(g)}${EN_SCALES[i] ? ` ${EN_SCALES[i]}` : ""}`);
  }
  return parts.join(" ");
}

export function amountInEnglishWords(amount: string | number, currencyCode: string, decimals = 2, fallbackName?: string): string {
  const v = toMoney(String(amount)).abs().toDecimalPlaces(decimals);
  const [intPart, frac = ""] = v.toFixed(decimals).split(".");
  const words = EN_CURRENCY[currencyCode] ?? { major: fallbackName ?? currencyCode, minor: "" };
  const minor = frac ? Number(frac) : 0;
  let text = `${integerToEnglishWords(BigInt(intPart!))} ${words.major}`;
  if (minor > 0) text += ` and ${integerToEnglishWords(minor)} ${words.minor || `of ${integerToEnglishWords(10 ** decimals)}`}`;
  return `Only ${text}`;
}

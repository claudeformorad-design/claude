import { tr } from "@/i18n/tr";
import { isValidAmount, toMoney } from "@/lib/accounting/money";
import type { RawSheet } from "./parse";

/**
 * قراءة كشف حساب البنك كما يصدّره البنك (Excel أو CSV) دون قالب خاص:
 * تُعرف الأعمدة من عناوينها الشائعة بالعربية والإنجليزية. المبلغ إما عمود واحد بإشارة (موجب إيداع وسالب سحب)
 * أو عمودان للإيداع والسحب. صفوف الأرصدة والمجاميع بلا مبلغ تُتخطى.
 */
export type BankLine = { line: number; txn_date: string; description: string; reference: string | null; amount: string };
export type BankParse = {
  lines: BankLine[];
  errors: { line: number; message: string }[];
  skipped: number;
  /** الأعمدة التي عُرفت (للعرض) */
  columns: { date: string; description: string | null; reference: string | null; amount: string };
};

const norm = (h: string) => h.replace(/[*:‏‎]/g, "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();

const NAMES = {
  date: ["التاريخ", "تاريخ", "تاريخ العمليه", "تاريخ الحركه", "تاريخ القيد", "تاريخ الاستحقاق", "date", "transaction date", "txn date", "posting date", "value date", "booking date"],
  description: ["البيان", "الوصف", "التفاصيل", "تفاصيل", "الشرح", "تفاصيل العمليه", "نوع العمليه", "description", "details", "narration", "particulars", "memo", "transaction details"],
  reference: ["المرجع", "رقم المرجع", "المرجع البنكي", "رقم العمليه", "رقم الشيك", "رقم المستند", "reference", "ref", "ref no", "reference no", "cheque no", "check no", "transaction id", "document no"],
  amount: ["المبلغ", "القيمه", "amount", "value", "transaction amount", "net amount"],
  credit: ["دائن", "ايداع", "الايداع", "ايداعات", "وارد", "الوارد", "credit", "credits", "deposit", "deposits", "money in", "cr"],
  debit: ["مدين", "سحب", "السحب", "مسحوبات", "صادر", "الصادر", "debit", "debits", "withdrawal", "withdrawals", "money out", "dr"],
} as const;

type Field = keyof typeof NAMES;

function locate(headers: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  // التطابق التام أولًا لكل الحقول، ثم الاحتواء، حتى لا يأخذ «تاريخ الاستحقاق» مكان «التاريخ»
  // في الاحتواء يُقدَّم الإيداع والسحب على المبلغ: «المبلغ المدين» عمود سحب لا عمود مبلغ
  const order: Field[] = ["date", "description", "reference", "credit", "debit", "amount"];
  for (const exact of [true, false]) {
    for (const f of exact ? (Object.keys(NAMES) as Field[]) : order) {
      if (out[f] !== undefined) continue;
      const i = headers.findIndex((h, idx) => !used.has(idx) && h && NAMES[f].some((n) => (exact ? norm(h) === norm(n) : norm(h).includes(norm(n)) && norm(n).length > 2)));
      if (i >= 0) { out[f] = i; used.add(i); }
    }
  }
  return out;
}

const DIGITS = "٠١٢٣٤٥٦٧٨٩";
/** رقم من نص البنك: فواصل الآلاف، الأرقام العربية، الأقواس للسالب، وعلامة CR/DR أو سالب في آخره */
export function bankNumber(raw: string): string | null {
  let v = raw.trim().replace(/[٠-٩]/g, (d) => String(DIGITS.indexOf(d))).replace(/٫/g, ".").replace(/٬/g, ",");
  if (!v || v === "-") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(v)) { sign = -1; v = v.slice(1, -1); }
  if (/\s*(dr|مدين)$/i.test(v)) { sign = -1; v = v.replace(/\s*(dr|مدين)$/i, ""); }
  else if (/\s*(cr|دائن)$/i.test(v)) v = v.replace(/\s*(cr|دائن)$/i, "");
  if (/-$/.test(v)) { sign = -sign; v = v.slice(0, -1); }
  if (v.startsWith("-")) { sign = -sign; v = v.slice(1); }
  v = v.replace(/[^\d.,]/g, "");
  // 1.234,50 بأسلوب أوروبي ← 1234.50؛ وإلا الفاصلة للآلاف
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else v = v.replace(/,/g, "");
  if (!v || !isValidAmount(v)) return null;
  const n = toMoney(v);
  return n.isZero() ? "0" : (sign < 0 ? n.negated() : n).toFixed();
}

/** تاريخ من نص البنك: 2026-01-31، 31/01/2026، 31-01-2026، 31.01.2026 */
export function bankDate(raw: string): string | null {
  const v = raw.trim().replace(/[٠-٩]/g, (d) => String(DIGITS.indexOf(d))).split(/[ T]/)[0]!;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!y) return null;
  const out = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  const dt = new Date(`${out}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== out ? null : out;
}

export function parseBankStatement(sheet: RawSheet): BankParse | { error: string } {
  const col = locate(sheet.headers);
  if (col.date === undefined) return { error: tr("لم يُعرف عمود التاريخ. اجعل عنوانه «التاريخ».") };
  const single = col.amount !== undefined;
  if (!single && col.credit === undefined && col.debit === undefined) {
    return { error: tr("لم يُعرف عمود المبلغ. اجعل عنوانه «المبلغ»، أو عمودين «إيداع» و«سحب».") };
  }
  const head = (i: number | undefined) => (i === undefined ? null : sheet.headers[i] ?? null);
  const out: BankParse = {
    lines: [], errors: [], skipped: 0,
    columns: {
      date: head(col.date)!, description: head(col.description), reference: head(col.reference),
      amount: single ? head(col.amount)! : [head(col.credit), head(col.debit)].filter(Boolean).join(" / "),
    },
  };
  const at = (cells: string[], i: number | undefined) => (i === undefined ? "" : (cells[i] ?? "").trim());
  for (const { line, cells } of sheet.rows) {
    let amount: string | null;
    if (single) {
      amount = bankNumber(at(cells, col.amount));
    } else {
      const cr = bankNumber(at(cells, col.credit));
      const dr = bankNumber(at(cells, col.debit));
      amount = cr === null && dr === null ? null : toMoney(cr ?? "0").abs().minus(toMoney(dr ?? "0").abs()).toFixed();
    }
    const rawDate = at(cells, col.date);
    // صف رصيد أو مجموع أو فاصل: لا تاريخ أو لا مبلغ
    if (amount === null || toMoney(amount).isZero() || !rawDate) { out.skipped++; continue; }
    const txn_date = bankDate(rawDate);
    if (!txn_date) { out.errors.push({ line, message: tr("تاريخ غير مفهوم: {0}", rawDate) }); continue; }
    const description = at(cells, col.description).slice(0, 300) || tr("حركة بنكية");
    const reference = at(cells, col.reference).slice(0, 80) || null;
    out.lines.push({ line, txn_date, description, reference, amount });
  }
  return out;
}

/** مفتاح لمنع تكرار السطر عند استيراد نفس الكشف مرتين */
export const bankLineKey = (l: { txn_date: string; amount: string; reference: string | null; description: string }) =>
  [l.txn_date, toMoney(l.amount).toFixed(4), (l.reference ?? "").trim(), l.description.trim()].join("|");

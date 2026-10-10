/**
 * فصل الرموز عن النصوص العربية: الرمز البادئ في تسميات مثل «1101 الصندوق الرئيسي» أو «USD دولار أمريكي»،
 * وأرقام المستندات داخل الأوصاف مثل «إيراد ليلة RSV-2026-000110».
 */
const LEAD = /^([0-9A-Z][0-9A-Z.\-_/]*)\s+(.+)$/s;

/** الرمز البادئ والاسم؛ الرمز فيه ثلاثة أرقام أو حرف لاتيني كبير، والاسم عربي، وإلا تبقى التسمية كما هي */
export function splitCode(label: string): { code: string | null; name: string } {
  const m = LEAD.exec(label.trim());
  if (!m || !/[؀-ۿ]/.test(m[2]!) || !/\d{3}|[A-Z]/.test(m[1]!)) return { code: null, name: label };
  return { code: m[1]!, name: m[2]! };
}

/** رقم مستند: بادئة لاتينية ثم أرقام بشرطات، مثل JV-2026-000123 أو F-2026-000042 */
export const DOC_CODE = /\b[A-Z]{1,6}(?:-[A-Z0-9]+)*-\d{2,}\b/g;

/** تاريخ بصيغة 2026-09-27: يُعزل اتجاهه حتى لا ينقلب بعد كلمة عربية فيظهر 27-09-2026 */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

export type TextPart = { text: string; kind: "text" | "code" | "date" };

/** يقسم النص إلى أجزاء نصية وأرقام مستندات وتواريخ بالترتيب */
export function splitDocCodes(text: string): TextPart[] {
  const found: { m: RegExpExecArray; kind: TextPart["kind"] }[] = [
    ...[...text.matchAll(DOC_CODE)].map((m) => ({ m, kind: "code" as const })),
    ...[...text.matchAll(ISO_DATE)].map((m) => ({ m, kind: "date" as const })),
  ].sort((a, b) => a.m.index - b.m.index);
  const out: TextPart[] = [];
  let last = 0;
  for (const { m, kind } of found) {
    if (m.index < last) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), kind: "text" });
    out.push({ text: m[0], kind });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: "text" });
  return out;
}

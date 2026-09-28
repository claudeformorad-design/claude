import "server-only";
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { currencyName } from "@/lib/currency-name";
import { CODE_COLUMN, hasCodes, type DocMeta, type PlainReport } from "./plain-report";

/**
 * ملف PDF حقيقي للتقرير (نص متجهي قابل للتحديد والبحث، لا صورة): خط «ثمانية» للعربي وInter للأرقام،
 * رأس باسم الفندق وبياناته، جدول برأس داكن يتكرر في كل صفحة، أقسام دافئة وإجمالي داكن، وتذييل بترقيم الصفحات.
 * الاتجاه من اليمين لليسار: الرمز ثم الاسم في اليمين، والمبالغ في الجهة المقابلة.
 */

const FONT_DIR = path.join(process.cwd(), "src/lib/export/fonts");
const FONTS = { ar: "thmanyah-medium.ttf", arBold: "thmanyah-bold.ttf", num: "inter-medium.ttf", numBold: "inter-bold.ttf" } as const;
type FontKey = keyof typeof FONTS;
let fontData: Record<FontKey, Buffer> | null = null;
const loadFonts = () =>
  (fontData ??= Object.fromEntries(Object.entries(FONTS).map(([k, f]) => [k, fs.readFileSync(path.join(FONT_DIR, f))])) as Record<FontKey, Buffer>);

const C = {
  ink: "#312f2e", soft: "#6b6964", muted: "#9b9892", body: "#3a3a3a",
  line: "#eceae3", lineStrong: "#dcd9d0", panel: "#fbf9f3", group: "#efeeea",
  success: "#4e8763", successTint: "#eaf2ec", urgent: "#b4463d", urgentTint: "#f8e9e7", white: "#ffffff",
};

const SIDE = 40;
const TOP = 42;
const BOTTOM = 58;
const PAD = 9;
const ARABIC = /[؀-ۿ]/;
const BIDI_MARKS = /[‎‏؜‪-‮⁦-⁩]/g;

type Doc = InstanceType<typeof PDFDocument>;
type TextStyle = { size: number; bold?: boolean; color?: string };

/** نص عربي من اليمين: الكلمات العربية تُرتَّب من اليمين، والكلمات اللاتينية والأرقام المتتالية تبقى بترتيبها */
function runs(text: string) {
  const groups: { ltr: boolean; words: string[] }[] = [];
  for (const w of text.replace(BIDI_MARKS, "").split(/\s+/).filter(Boolean)) {
    const ltr = !ARABIC.test(w);
    const last = groups.at(-1);
    if (last && last.ltr && ltr) last.words.push(w);
    else groups.push({ ltr, words: [w] });
  }
  return groups;
}

function useFont(doc: Doc, ltr: boolean, s: TextStyle) {
  doc.font(ltr ? (s.bold ? "numBold" : "num") : s.bold ? "arBold" : "ar").fontSize(s.size);
}

function measure(doc: Doc, text: string, s: TextStyle): number {
  let w = 0;
  const gs = runs(text);
  gs.forEach((g, i) => {
    useFont(doc, g.ltr, s);
    const space = doc.widthOfString(" ");
    w += g.words.reduce((a, x) => a + doc.widthOfString(x), 0) + space * (g.words.length - 1) + (i ? space : 0);
  });
  return w;
}

/** يقصّ النص من آخره بكلمات كاملة حتى يتسع للعرض المتاح */
function fit(doc: Doc, text: string, s: TextStyle, max: number): string {
  if (measure(doc, text, s) <= max) return text;
  const words = text.split(/\s+/);
  while (words.length > 1 && measure(doc, `${words.join(" ")} …`, s) > max) words.pop();
  return `${words.join(" ")} …`;
}

/** يرسم سطرًا على خط أساس y: من الحافة اليمنى (right) أو اليسرى (left) */
function draw(doc: Doc, text: string, s: TextStyle & { y: number; right?: number; left?: number }) {
  const clean = text.replace(BIDI_MARKS, "").trim();
  if (!clean) return;
  const width = measure(doc, clean, s);
  let x = s.right ?? (s.left ?? 0) + width;
  doc.fillColor(s.color ?? C.ink);
  runs(clean).forEach((g) => {
    useFont(doc, g.ltr, s);
    const space = doc.widthOfString(" ");
    if (g.ltr) {
      const t = g.words.join(" ");
      const w = doc.widthOfString(t);
      doc.text(t, x - w, s.y, { lineBreak: false, baseline: "alphabetic" });
      x -= w + space;
    } else {
      for (const word of g.words) {
        const w = doc.widthOfString(word);
        doc.text(word, x - w, s.y, { lineBreak: false, baseline: "alphabetic" });
        x -= w + space;
      }
    }
  });
}

/** مستطيل بزوايا مستديرة في الأعلى أو الأسفل فقط (رأس الجدول وإجماليه الأخير) */
function roundedBand(doc: Doc, x: number, y: number, w: number, h: number, r: number, edge: "top" | "bottom", color: string) {
  doc.save().fillColor(color);
  if (edge === "top") {
    doc.moveTo(x, y + h).lineTo(x, y + r).quadraticCurveTo(x, y, x + r, y).lineTo(x + w - r, y).quadraticCurveTo(x + w, y, x + w, y + r).lineTo(x + w, y + h).closePath();
  } else {
    doc.moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + h - r).quadraticCurveTo(x + w, y + h, x + w - r, y + h).lineTo(x + r, y + h).quadraticCurveTo(x, y + h, x, y + h - r).closePath();
  }
  doc.fill().restore();
}

export async function reportPdf(report: PlainReport, meta: DocMeta): Promise<Buffer> {
  const f = loadFonts();
  const codes = hasCodes(report.rows);
  const landscape = report.columns.length > 5;
  const doc = new PDFDocument({
    size: "A4", layout: landscape ? "landscape" : "portrait", margin: 0, bufferPages: true,
    info: { Title: report.title, Author: meta.hotelName, Creator: meta.hotelName },
  });
  for (const k of Object.keys(f) as FontKey[]) doc.registerFont(k, f[k]);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width, H = doc.page.height;
  const right = W - SIDE, width = W - SIDE * 2;

  // ---- رأس المستند (الصفحة الأولى)
  let y = TOP + 14;
  draw(doc, meta.hotelName, { size: 15, bold: true, y, right });
  const metaRows: [string, string][] = [
    ["تاريخ الإعداد", meta.generatedAt],
    ...(meta.preparedBy ? [["أعدّه", meta.preparedBy] as [string, string]] : []),
    ["العملة", currencyName(meta.currency)],
  ];
  const labelW = Math.max(...metaRows.map(([l]) => measure(doc, l, { size: 8.5 })));
  const valueW = Math.max(...metaRows.map(([, v]) => measure(doc, v, { size: 8.5, bold: true })));
  metaRows.forEach(([l, v], i) => {
    const ly = TOP + 10 + i * 14;
    draw(doc, l, { size: 8.5, color: C.soft, y: ly, right: SIDE + valueW + 12 + labelW });
    draw(doc, v, { size: 8.5, bold: true, y: ly, right: SIDE + valueW });
  });
  for (const lineText of [meta.legal.join("، "), meta.contact.join("، ")].filter(Boolean)) {
    y += 15;
    draw(doc, fit(doc, lineText, { size: 8.5 }, width - labelW - valueW - 40), { size: 8.5, color: C.soft, y, right });
  }
  y = Math.max(y, TOP + 10 + (metaRows.length - 1) * 14) + 16;
  doc.save().moveTo(SIDE, y).lineTo(right, y).lineWidth(0.6).strokeColor(C.line).stroke().restore();
  y += 30;
  draw(doc, report.title, { size: 20, bold: true, y, right });
  if (report.subtitle) { y += 19; draw(doc, report.subtitle, { size: 10, color: C.soft, y, right }); }
  y += 18;

  // ---- أعمدة الجدول: الرمز، ثم الاسم يأخذ المتبقي، ثم الأعمدة الرقمية بعرض محتواها
  const numeric = report.columns.map((_, i) => i > 0 && report.rows.some((r) => r.cells[i]?.num));
  const cellW = (i: number) => Math.max(
    measure(doc, report.columns[i]!, { size: 8.5, bold: true }),
    ...report.rows.map((r) => measure(doc, r.cells[i]?.text ?? "", { size: 9, bold: r.kind !== "line" })),
  ) + PAD * 2;
  const codeW = codes ? Math.max(44, measure(doc, CODE_COLUMN, { size: 8.5, bold: true }), ...report.rows.map((r) => measure(doc, r.code ?? "", { size: 9 }))) + PAD * 2 : 0;
  const restW = report.columns.slice(1).map((_, k) => Math.max(numeric[k + 1] ? 74 : 60, cellW(k + 1)));
  const restTotal = restW.reduce((a, b) => a + b, 0);
  const scale = Math.min(1, (width - codeW - 150) / Math.max(1, restTotal));
  const colsW = [width - codeW - restTotal * scale, ...restW.map((w) => w * scale)];
  // الحافة اليمنى لكل عمود من اليمين لليسار
  const edges: number[] = [];
  let edge = right - codeW;
  for (const w of colsW) { edges.push(edge); edge -= w; }

  const HEAD_H = 26;
  const headerRow = () => {
    roundedBand(doc, SIDE, y, width, HEAD_H, 6, "top", C.ink);
    const base = y + HEAD_H / 2 + 3.2;
    const s = { size: 8.5, bold: true, color: C.white, y: base };
    if (codes) draw(doc, CODE_COLUMN, { ...s, right: right - PAD });
    report.columns.forEach((c, i) => {
      if (numeric[i]) draw(doc, c, { ...s, left: edges[i]! - colsW[i]! + PAD });
      else draw(doc, fit(doc, c, s, colsW[i]! - PAD * 2), { ...s, right: edges[i]! - PAD });
    });
    y += HEAD_H;
  };

  const pageBreak = (h: number) => {
    if (y + h <= H - BOTTOM) return;
    doc.addPage({ size: "A4", layout: landscape ? "landscape" : "portrait", margin: 0 });
    y = TOP;
    headerRow();
  };

  headerRow();
  const last = report.rows.length - 1;
  report.rows.forEach((row, ri) => {
    const line = row.kind === "line";
    const h = row.kind === "section" ? 24 : row.kind === "total" ? 25 : line ? 21 : 22;
    pageBreak(h + (row.kind === "section" ? 21 : 0));
    const final = row.kind === "total" && ri === last;
    const prevTotal = ri > 0 && report.rows[ri - 1]!.kind === "total";
    if (final) roundedBand(doc, SIDE, y, width, h, 6, "bottom", C.ink);
    else if (row.kind === "section") doc.save().rect(SIDE, y, width, h).fill(C.group).restore();
    else if (row.kind === "subtotal") doc.save().rect(SIDE, y, width, h).fill(C.panel).restore();
    const rule = (yy: number, color: string, lw: number) => doc.save().moveTo(SIDE, yy).lineTo(right, yy).lineWidth(lw).strokeColor(color).stroke().restore();
    if (line) rule(y + h, C.line, 0.5);
    if (row.kind === "subtotal") rule(y, C.lineStrong, 0.6);
    if (row.kind === "total" && !final) rule(y, prevTotal ? C.lineStrong : C.ink, prevTotal ? 0.6 : 1);

    const base = y + h / 2 + 3.3;
    const bold = !line;
    const color = final ? C.white : line ? C.body : C.ink;
    if (codes && line && row.code) draw(doc, row.code, { size: 9, color: final ? C.white : C.soft, y: base, right: right - PAD });
    row.cells.forEach((c, i) => {
      if (!c.text) return;
      const size = final ? 9.5 : 9;
      if (numeric[i] || c.num) {
        const neg = c.text.replace(BIDI_MARKS, "").startsWith("-");
        draw(doc, c.text, { size, bold, color: final ? C.white : neg ? C.urgent : C.ink, y: base, left: edges[i]! - colsW[i]! + PAD });
      } else {
        // عنوان القسم والإجمالي يبدأ من الحافة ممتدًا على عمود الرمز، واسم الحساب بعد الرمز
        const edgeRight = i === 0 && (!line || !codes) ? right - PAD - (line ? 8 : 0) : edges[i]! - PAD;
        const room = i === 0 ? edgeRight - (edges[0]! - colsW[0]!) - PAD : colsW[i]! - PAD * 2;
        draw(doc, fit(doc, c.text, { size, bold }, room), { size, bold, color, y: base, right: edgeRight });
      }
    });
    y += h;
  });

  // ---- الخاتمة: ملاحظة التوازن والتوقيعات
  if (report.note) {
    pageBreak(40);
    y += 16;
    const s = { size: 9, bold: true };
    const w = measure(doc, report.note.text, s) + 24;
    doc.save().roundedRect(right - w, y, w, 22, 6).fill(report.note.ok ? C.successTint : C.urgentTint).restore();
    draw(doc, report.note.text, { ...s, color: report.note.ok ? C.success : C.urgent, y: y + 14.5, right: right - 12 });
    y += 22;
  }
  pageBreak(70);
  y += 46;
  const half = (width - 60) / 2;
  for (const [i, label] of ["المحاسب", "المدير المالي"].entries()) {
    const r = right - i * (half + 60);
    doc.save().moveTo(r - half, y).lineTo(r, y).lineWidth(0.6).strokeColor(C.lineStrong).stroke().restore();
    draw(doc, label, { size: 9, color: C.soft, y: y + 15, right: r });
  }

  // ---- التذييل: اسم الفندق وترقيم الصفحات
  const range = doc.bufferedPageRange();
  for (let p = 0; p < range.count; p++) {
    doc.switchToPage(range.start + p);
    const fy = H - 30;
    doc.save().moveTo(SIDE, fy - 14).lineTo(right, fy - 14).lineWidth(0.5).strokeColor(C.line).stroke().restore();
    draw(doc, `${meta.hotelName}، ${report.title}`, { size: 8, color: C.soft, y: fy, right });
    draw(doc, `صفحة ${p + 1} من ${range.count}`, { size: 8, color: C.soft, y: fy, left: SIDE });
  }
  doc.end();
  return done;
}

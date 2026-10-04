import ExcelJS from "exceljs";
import type { ImportColumn } from "./parse";

const INK = "FF1F1D1B";
const WARM = "FFF1F0EC";
const FONT = "Segoe UI";

/**
 * قالب الاستيراد: ورقة بيانات بعناوين الأعمدة (المطلوب بنجمة) وصف مثال يُستبدل،
 * وقوائم منسدلة للحقول ذات الخيارات، وورقة تعليمات تشرح كل عمود.
 */
export async function importTemplate(title: string, columns: ImportColumn[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "نزيل";
  const ws = wb.addWorksheet("البيانات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: Math.max(16, c.header.length + 8) }));
  const head = ws.getRow(1);
  head.height = 26;
  head.eachCell((cell) => {
    cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  ws.addRow(Object.fromEntries(columns.map((c) => [c.key, c.example])));
  columns.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    if (c.kind === "enum" && c.options) {
      const list = Object.keys(c.options).join(",");
      for (let r = 2; r <= 1000; r++) ws.getCell(`${letter}${r}`).dataValidation = { type: "list", allowBlank: !c.required, formulae: [`"${list}"`] };
    }
    if (c.kind === "bool") {
      for (let r = 2; r <= 1000; r++) ws.getCell(`${letter}${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"نعم,لا"'] };
    }
    if (c.kind === "date") ws.getColumn(i + 1).numFmt = "yyyy-mm-dd";
    if (c.kind === "text") ws.getColumn(i + 1).numFmt = "@";
  });

  const help = wb.addWorksheet("التعليمات", { views: [{ rightToLeft: true }] });
  help.columns = [{ width: 28 }, { width: 12 }, { width: 70 }];
  help.addRow([`قالب استيراد ${title}`]).font = { name: FONT, bold: true, size: 14 };
  help.addRow(["اكتب البيانات في ورقة البيانات بدءًا من الصف الثاني، واحذف صف المثال. لا تغيّر عناوين الأعمدة."]).font = { name: FONT };
  help.addRow([]);
  const h = help.addRow(["العمود", "مطلوب", "الشرح"]);
  h.eachCell((cell) => { cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; });
  for (const c of columns) {
    const kind = c.kind === "date" ? "تاريخ مثل 2026-01-31" : c.kind === "number" ? "رقم" : c.kind === "bool" ? "نعم أو لا"
      : c.kind === "enum" ? `واحد من: ${Object.keys(c.options ?? {}).join("، ")}` : c.max ? `نص حتى ${c.max} حرفًا` : "نص";
    const row = help.addRow([c.header, c.required ? "نعم" : "", [kind, c.hint].filter(Boolean).join("، ")]);
    row.font = { name: FONT };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARM } };
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

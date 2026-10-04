import { tr } from "@/i18n/tr";
import ExcelJS from "exceljs";
import { currentLocale } from "@/i18n/tr";
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
  wb.creator = tr("نزيل");
  const ws = wb.addWorksheet(tr("البيانات"), { views: [{ rightToLeft: currentLocale() === "ar", state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.required ? `${tr(c.header)} *` : tr(c.header), key: c.key, width: Math.max(16, tr(c.header).length + 8) }));
  const head = ws.getRow(1);
  head.height = 26;
  head.eachCell((cell) => {
    cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  ws.addRow(Object.fromEntries(columns.map((c) => [c.key, c.kind === "enum" && c.example ? tr(c.example) : c.example])));
  columns.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    if (c.kind === "enum" && c.options) {
      const list = Object.keys(c.options).map((k) => tr(k)).join(",");
      for (let r = 2; r <= 1000; r++) ws.getCell(`${letter}${r}`).dataValidation = { type: "list", allowBlank: !c.required, formulae: [`"${list}"`] };
    }
    if (c.kind === "bool") {
      for (let r = 2; r <= 1000; r++) ws.getCell(`${letter}${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [tr("\"نعم,لا\"")] };
    }
    if (c.kind === "date") ws.getColumn(i + 1).numFmt = "yyyy-mm-dd";
    if (c.kind === "text") ws.getColumn(i + 1).numFmt = "@";
  });

  const help = wb.addWorksheet(tr("التعليمات"), { views: [{ rightToLeft: currentLocale() === "ar" }] });
  help.columns = [{ width: 28 }, { width: 12 }, { width: 70 }];
  help.addRow([tr("قالب استيراد {0}", title)]).font = { name: FONT, bold: true, size: 14 };
  help.addRow([tr("اكتب البيانات في ورقة البيانات بدءًا من الصف الثاني، واحذف صف المثال. لا تغيّر عناوين الأعمدة.")]).font = { name: FONT };
  help.addRow([]);
  const h = help.addRow([tr("العمود"), tr("مطلوب"), tr("الشرح")]);
  h.eachCell((cell) => { cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; });
  for (const c of columns) {
    const kind = c.kind === "date" ? tr("تاريخ مثل 2026-01-31") : c.kind === "number" ? tr("رقم") : c.kind === "bool" ? tr("نعم أو لا")
      : c.kind === "enum" ? tr("واحد من: {0}", Object.keys(c.options ?? {}).map((k) => tr(k)).join(tr("، "))) : c.max ? tr("نص حتى {0} حرفًا", c.max) : tr("نص");
    const row = help.addRow([tr(c.header), c.required ? tr("نعم") : "", [kind, c.hint && tr(c.hint)].filter(Boolean).join(tr("، "))]);
    row.font = { name: FONT };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARM } };
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

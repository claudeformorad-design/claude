import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeDatabaseError, mapDatabaseError } from "./errors";

/** أخطاء برمجية داخلية لا يصل إليها المستخدم من الواجهة (فحوص سلامة الترحيلات ومعاملات الدوال) */
const INTERNAL = [
  "Some policies were not rewritten",
  "Some system descriptions were not converted to Arabic",
  "app.has_permission changed; review app.permitted_hotels before applying",
  "Unsupported money transaction type %",
  "kind must be receivable or payable",
  "p_lines must be a JSON array",
  "post_system_entry is only for document-generated entries",
];

describe("describeDatabaseError", () => {
  it("يعرض قواعد العمل بنص عربي مع القيم الواردة في الرسالة", () => {
    expect(describeDatabaseError("Insufficient stock for RICE-1 (on hand 3.500)")).toBe("الكمية غير كافية للصنف RICE-1 (المتوفر 3.500)");
    expect(describeDatabaseError("Entry total 60000.00 requires approval (threshold 50000.00)")).toContain("50000.00");
    expect(describeDatabaseError("Account 4100 has type revenue but {expense,asset} is required")).toBe(
      "الحساب 4100 من نوع «إيرادات» والمطلوب «مصروفات أو أصول»",
    );
    expect(describeDatabaseError("Invoice not found")).toBe("الفاتورة غير موجودة");
    expect(describeDatabaseError("Journal entry not found")).toBe("القيد غير موجود");
    expect(describeDatabaseError("Draft journal entry not found")).toBe("القيد المسودة غير موجود");
    expect(describeDatabaseError("something else")).toBeNull();
  });

  it("كل رسالة خطأ في ترحيلات قاعدة البيانات لها ترجمة عربية", () => {
    const dir = path.resolve(import.meta.dirname, "../../../supabase/migrations");
    const messages = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      for (const m of readFileSync(path.join(dir, file), "utf8").matchAll(/raise exception '((?:[^']|'')*)'/g)) messages.add(m[1]!);
    }
    expect(messages.size).toBeGreaterThan(100);
    const untranslated = [...messages]
      .filter((m) => !INTERNAL.includes(m))
      .map((m) => m.replace(/''/g, "'").replace(/%/g, "7"))
      .filter((m) => mapDatabaseError(m) === "unknown" && describeDatabaseError(m) === null);
    expect(untranslated).toEqual([]);
  });
});

"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth/context";
import { ImportFileError, readSheet } from "@/lib/import/parse";
import { type ImportCheck, checkImport, importDefinition, runImport } from "@/services/import.service";
import { type ActionResult, toActionResult } from "@/services/errors";

const REFRESH: Record<string, string[]> = {
  rooms: ["/rooms", "/room-setup", "/front-desk"], guests: ["/guests"], customers: ["/customers"], items: ["/inventory"], employees: ["/hr"],
};

async function load(formData: FormData) {
  const def = importDefinition(String(formData.get("kind") ?? ""));
  const file = formData.get("file");
  if (!def || !(file instanceof File) || !file.size) return null;
  const ctx = await requireAppContext(def.permission);
  const modules = ctx.hotel.enabled_modules ?? ["accounting", "pms"];
  if (def.module && !modules.includes(def.module)) return null;
  return { ctx, def, file };
}

const fileError = (e: unknown) => (e instanceof ImportFileError ? { ok: false as const, error: "unknown" as const, message: e.message } : null);

/** فحص الملف دون حفظ: عدد الصفوف الصالحة، وأخطاء كل صف برقمه في الملف */
export async function checkImportAction(formData: FormData): Promise<ActionResult<ImportCheck>> {
  const x = await load(formData);
  if (!x) return { ok: false, error: "validation" };
  try {
    const sheet = await readSheet(x.file);
    return await toActionResult(async () => (await checkImport(x.ctx, x.def, sheet)).check);
  } catch (e) {
    return fileError(e) ?? { ok: false, error: "unknown" };
  }
}

/** الاستيراد: يعيد الفحص كاملًا في الخادم، ولا يحفظ شيئًا إن وُجد خطأ واحد */
export async function runImportAction(formData: FormData): Promise<ActionResult<number>> {
  const x = await load(formData);
  if (!x) return { ok: false, error: "validation" };
  try {
    const sheet = await readSheet(x.file);
    const r = await toActionResult(async () => {
      const { check, rows } = await checkImport(x.ctx, x.def, sheet);
      if (check.missingColumns.length || check.errors.length || !rows.length) throw new ImportFileError("صحّح أخطاء الملف أولًا، فلا يُستورد شيء ما دام فيه خطأ");
      return runImport(x.ctx, x.def, rows);
    });
    if (r.ok) for (const p of REFRESH[x.def.kind] ?? []) revalidatePath(p);
    return r;
  } catch (e) {
    return fileError(e) ?? { ok: false, error: "unknown" };
  }
}

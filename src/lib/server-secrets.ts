import "server-only";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * أسرار يضعها صاحب النظام من الواجهة (مثل مفتاح المساعد الذكي) وتبقى على الخادم فقط:
 * لا تُحفظ في قاعدة البيانات (يصلها كل مستخدم بجلسته) ولا تُرسل للمتصفح.
 * على Netlify: مخزن Netlify Blobs الخاص بالموقع، لا تقرؤه إلا دوال الخادم.
 * محليًا أو على خادم آخر: ملف بصلاحية قراءة لمالكه فقط بجوار قاعدة البيانات المحلية.
 */

const STORE = "nazeel-private";
const FILE = path.join(path.dirname(path.resolve(/*turbopackIgnore: true*/ process.env.LOCAL_DB_DIR || path.join(process.cwd(), ".data", "pglite"))), "secrets.json");

type Backend = { name: "netlify" | "file"; get(key: string): Promise<string | null>; set(key: string, value: string | null): Promise<void> };

/** يُنشأ مع كل عملية: سياق المخزن (ورمزه) تضعه Netlify لكل استدعاء */
async function netlifyBackend(): Promise<Backend | null> {
  try {
    const { getStore } = await import("@netlify/blobs");
    // يرمي خطأ فورًا خارج Netlify (لا بيئة مخزن)، فيُستخدم الملف
    const store = getStore({ name: STORE, consistency: "strong" });
    return {
      name: "netlify",
      get: async (key) => (await store.get(key, { type: "text" })) ?? null,
      set: async (key, value) => { if (value === null) await store.delete(key); else await store.set(key, value); },
    };
  } catch {
    return null;
  }
}

function readFile(): Record<string, string> {
  try { return existsSync(/*turbopackIgnore: true*/ FILE) ? JSON.parse(readFileSync(/*turbopackIgnore: true*/ FILE, "utf8")) : {}; }
  catch { return {}; }
}

const fileBackend: Backend = {
  name: "file",
  get: async (key) => readFile()[key] ?? null,
  set: async (key, value) => {
    const all = readFile();
    if (value === null) delete all[key]; else all[key] = value;
    mkdirSync(/*turbopackIgnore: true*/ path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(all), { mode: 0o600 });
    renameSync(/*turbopackIgnore: true*/ tmp, FILE);
    try { chmodSync(/*turbopackIgnore: true*/ FILE, 0o600); } catch { /* أنظمة لا تدعم الصلاحيات */ }
  },
};

const pick = async () => (await netlifyBackend()) ?? fileBackend;

export async function readSecret(key: string): Promise<string | null> {
  return (await pick()).get(key);
}

export async function writeSecret(key: string, value: string | null): Promise<void> {
  await (await pick()).set(key, value);
}

/** فحص صحة مخزن الأسرار: أين يُحفظ، وهل القراءة منه تعمل (بلا كشف أي قيمة) */
export async function secretsHealth(): Promise<{ backend: Backend["name"]; ok: boolean }> {
  const b = await pick();
  try { await b.get("health-probe"); return { backend: b.name, ok: true }; } catch { return { backend: b.name, ok: false }; }
}

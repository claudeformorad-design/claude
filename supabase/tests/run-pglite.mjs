// تشغيل اختبارات قاعدة البيانات على PostgreSQL مضمّن (PGlite) — لا يحتاج تثبيت PostgreSQL.
// نفس ملفات الترحيل والاختبار التي يشغّلها run-local.sh، كل ملف اختبار على قاعدة جديدة.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => readFileSync(f, "utf8").split("\n").filter((l) => !l.startsWith("\\")).join("\n");
const migrations = readdirSync(`${root}/migrations`).filter((f) => f.endsWith(".sql")).sort();
const tests = readdirSync(`${root}/tests`).filter((f) => f.endsWith(".test.sql")).sort();

let failed = 0;
for (const test of tests) {
  const db = await PGlite.create({ extensions: { btree_gist, pgcrypto } });
  try {
    await db.exec(read(`${root}/tests/supabase_shim.sql`));
    for (const m of migrations) await db.exec(read(`${root}/migrations/${m}`));
    await db.exec(read(`${root}/tests/${test}`));
    console.log(`  ✓ ${test}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${test}: ${e.message}`);
  } finally {
    await db.close();
  }
}
if (failed) process.exit(1);
console.log("✓ all database tests passed (PGlite)");

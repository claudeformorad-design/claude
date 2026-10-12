/**
 * يصدّر فهرس التحكم للوحة هوتيلنا (مستودع sanad-admin): شجرة الأقسام والأجزاء والخانات والأزرار، وكل الصلاحيات.
 * اللوحة تعرض منه ما يمكن إيقافه لكل فندق، فيُعاد تشغيله بعد أي إضافة في registry.ts أو في صلاحيات القاعدة:
 *   bun scripts/panel-catalog.ts ../sanad-admin/src/lib/catalog.json
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { buildCatalog } from "@/lib/features/catalog";

const out = process.argv[2] ?? path.resolve(import.meta.dirname, "../../sanad-admin/src/lib/catalog.json");
const sb = path.resolve(import.meta.dirname, "../supabase");
const read = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => !l.startsWith("\\")).join("\n");

// الصلاحيات كما تنشئها ملفات الترحيل نفسها
const db = await PGlite.create({ extensions: { btree_gist, pgcrypto } });
await db.exec(read(`${sb}/tests/supabase_shim.sql`));
for (const m of readdirSync(`${sb}/migrations`).filter((f) => f.endsWith(".sql")).sort()) await db.exec(read(`${sb}/migrations/${m}`));
const { rows } = await db.query<{ code: string; module: string; name_ar: string; product: string }>(
  "select code, module, name_ar, product from public.permissions order by module, sort_order, code");
await db.close();

const catalog = buildCatalog(rows);
writeFileSync(out, `${JSON.stringify(catalog, null, 1)}\n`);
console.log(`catalog: ${catalog.tree.length} sections, ${catalog.permissions.length} permissions -> ${out}`);

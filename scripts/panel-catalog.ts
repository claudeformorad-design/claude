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
import { ar } from "@/i18n/dictionaries/ar";
import { type FeatureNode, featureTree } from "@/lib/features/registry";
import { PERMISSION_GROUPS } from "@/lib/auth/access-catalog";

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

type Node = { key: string; kind: FeatureNode["kind"]; label: string; hint?: string; locked?: string; permissions?: string[]; children?: Node[] };
const node = (n: FeatureNode): Node => ({
  key: n.key, kind: n.kind, label: n.label,
  ...(n.hint ? { hint: n.hint } : {}), ...(n.locked ? { locked: n.locked } : {}),
  ...(n.permissions?.length ? { permissions: [...n.permissions] } : {}),
  ...(n.children?.length ? { children: n.children.map(node) } : {}),
});

const groups = Object.keys(PERMISSION_GROUPS);
// المجموعة من وحدة الصلاحية، وإلا من أول مقطع في رمزها، وإلا «أخرى»
const groupOf = (r: { code: string; module: string }) =>
  groups.includes(r.module) ? r.module : groups.includes(r.code.split(".")[0]!) ? r.code.split(".")[0]! : "other";
// لا تُوقف من اللوحة حتى لا يُغلق النظام على صاحبه (نفس KEEP في src/lib/license/sync.ts)
const KEEP = new Set(["settings.hotel.manage", "settings.users.manage"]);
const permissions = rows.map((r) => ({ code: r.code, group: groupOf(r), label: r.name_ar, product: r.product, ...(KEEP.has(r.code) ? { locked: true } : {}) }));
const catalog = {
  generated_at: new Date().toISOString().slice(0, 10),
  tree: featureTree(ar.nav).map(node),
  permission_groups: [...groups.map((key) => ({ key, label: PERMISSION_GROUPS[key]! })), { key: "other", label: "أخرى" }]
    .filter((g) => permissions.some((p) => p.group === g.key)),
  permissions,
};
writeFileSync(out, `${JSON.stringify(catalog, null, 1)}\n`);
console.log(`catalog: ${catalog.tree.length} sections, ${catalog.permissions.length} permissions -> ${out}`);

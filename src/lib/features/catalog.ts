import { createHash } from "node:crypto";
import { inArabic } from "@/i18n/tr";
import { ar } from "@/i18n/dictionaries/ar";
import { PERMISSION_GROUPS } from "@/lib/auth/access-catalog";
import { type FeatureNode, featureTree } from "./registry";

/**
 * فهرس ما يمكن لصاحب النظام إيقافه في هذه النسخة: شجرة الأقسام والصفحات والخانات والأزرار، وكل الصلاحيات.
 * يرسله النظام للوحة هوتيلنا عند التواصل (حين لا تعرف اللوحة بصمته)، فتعرض اللوحة ما في نسخة الفندق نفسها بالضبط،
 * ويُولَّد منه أيضًا الفهرس الاحتياطي المحفوظ في مستودع اللوحة (scripts/panel-catalog.ts). النصوص بالعربية دائمًا.
 */
export type CatalogNode = { key: string; kind: FeatureNode["kind"]; label: string; hint?: string; locked?: string; permissions?: string[]; children?: CatalogNode[] };
export type CatalogPermission = { code: string; group: string; label: string; product: string; locked?: true };
export type Catalog = { tree: CatalogNode[]; permission_groups: { key: string; label: string }[]; permissions: CatalogPermission[] };
export type PermissionRow = { code: string; module: string; name_ar: string; product: string };

/** لا تُوقف من اللوحة حتى لا يُغلق النظام على صاحبه (نفس KEEP في src/lib/license/sync.ts) */
const KEEP = new Set(["settings.hotel.manage", "settings.users.manage"]);

const node = (n: FeatureNode): CatalogNode => ({
  key: n.key, kind: n.kind, label: n.label,
  ...(n.hint ? { hint: n.hint } : {}), ...(n.locked ? { locked: n.locked } : {}),
  ...(n.permissions?.length ? { permissions: [...n.permissions] } : {}),
  ...(n.children?.length ? { children: n.children.map(node) } : {}),
});

/** permissions: صفوف جدول الصلاحيات مرتبة (الوحدة، الترتيب، الرمز) */
export function buildCatalog(permissions: PermissionRow[]): Catalog {
  return inArabic(() => {
    const groups = Object.keys(PERMISSION_GROUPS);
    // المجموعة من وحدة الصلاحية، وإلا من أول مقطع في رمزها، وإلا «أخرى»
    const groupOf = (r: PermissionRow) =>
      groups.includes(r.module) ? r.module : groups.includes(r.code.split(".")[0]!) ? r.code.split(".")[0]! : "other";
    const perms: CatalogPermission[] = permissions.map((r) => ({ code: r.code, group: groupOf(r), label: r.name_ar, product: r.product, ...(KEEP.has(r.code) ? { locked: true as const } : {}) }));
    return {
      tree: featureTree(ar.nav).map(node),
      permission_groups: [...groups.map((key) => ({ key, label: PERMISSION_GROUPS[key]! })), { key: "other", label: "أخرى" }]
        .filter((g) => perms.some((p) => p.group === g.key)),
      permissions: perms,
    };
  });
}

/** بصمة الفهرس: تتغير بأي إضافة أو تعديل، وتحسبها اللوحة بنفس الطريقة من نفس النص */
export const catalogHash = (c: Catalog) => createHash("sha256").update(JSON.stringify(c)).digest("hex");

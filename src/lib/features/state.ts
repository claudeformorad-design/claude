import type { Dictionary } from "@/i18n/dictionaries/ar";
import { type FeatureNode, featureTree, flatten } from "./registry";

/** ما يحفظه الفندق من التخصيص (أعمدة جدول الفنادق) */
export type FeatureSettings = {
  enabled_modules: readonly string[];
  blocked_sections: readonly string[];
  disabled_features: readonly string[];
};

/** حساب الحالة لا يحتاج الأسماء، فتُستخدم أسماء وهمية بدل القاموس */
const KEY_LABELS = new Proxy({}, { get: (_, k) => String(k) }) as Dictionary["nav"];
let cachedTree: FeatureNode[] | null = null;
const keysTree = () => (cachedTree ??= featureTree(KEY_LABELS));

/** هل أُطفئت العقدة نفسها (بغض النظر عن أصلها)؟ المقفول لا يُطفأ أبدًا */
export function selfOff(node: FeatureNode, s: FeatureSettings): boolean {
  if (node.locked) return false;
  if (node.kind === "section") return node.module ? !s.enabled_modules.includes(node.module) : s.blocked_sections.includes(node.key);
  return s.disabled_features.includes(node.key);
}

export type FeatureState = {
  /** كل ما هو مطفأ، بما فيه ما يتبع قسمًا أو جزءًا مطفأً */
  off: ReadonlySet<string>;
  /** صفحات تختفي من القائمة وتُمنع إن فُتحت برابطها */
  hiddenHrefs: readonly string[];
};

export function featureState(s: FeatureSettings, tree: FeatureNode[] = keysTree()): FeatureState {
  const off = new Set<string>();
  const hidden: string[] = [];
  for (const { node, parents } of flatten(tree)) {
    if (selfOff(node, s) || parents.some((p) => off.has(p.key))) {
      off.add(node.key);
      hidden.push(...(node.hrefs ?? []));
    }
  }
  return { off, hiddenHrefs: [...new Set(hidden)] };
}

/**
 * الصلاحيات التي تسقط في القاعدة: صلاحيات كل ما هو مطفأ وما يتبعه.
 * section: ما أطفأه صاحب النظام (الأقسام وما تحتها)، feature: ما أطفأه المدير (الأجزاء والخانات وما تحتها).
 */
export function maskedPermissions(s: FeatureSettings, tier: "section" | "feature", tree: FeatureNode[] = keysTree()): string[] {
  const out = new Set<string>();
  const offRoots = new Set<string>();
  for (const { node, parents } of flatten(tree)) {
    const own = (tier === "section") === (node.kind === "section") && selfOff(node, s);
    if (own || parents.some((p) => offRoots.has(p.key))) {
      offRoots.add(node.key);
      for (const p of node.permissions ?? []) out.add(p);
    }
  }
  return [...out].sort();
}

export const findNode = (key: string, tree: FeatureNode[] = keysTree()) => flatten(tree).find((x) => x.node.key === key);

/** نفس قاعدة القائمة الجانبية: الرابط نفسه أو صفحة تحته */
export const underHref = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

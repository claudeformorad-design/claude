import { EN } from "./catalog-en";
import type { Locale } from "./config";

/**
 * ترجمة نصوص الواجهة. النص العربي هو المفتاح، والإنجليزية من الفهرس؛ وأي نص بلا ترجمة يبقى عربيًا.
 * اللغة: في المتصفح من وسم الصفحة <html lang>، وفي الخادم من كوكي اللغة للطلب الحالي
 * (يُسجَّل قارئه في locale-server.ts فلا تدخل وحدات الخادم حزمة المتصفح).
 * المتغيرات تُكتب {0} و{1} في النص وتُمرَّر بالترتيب.
 */

type Resolver = () => Locale;
const g = globalThis as typeof globalThis & { __nazeelLocale?: Resolver };

export function registerServerLocale(resolver: Resolver) {
  g.__nazeelLocale = resolver;
}

export function currentLocale(): Locale {
  if (typeof window !== "undefined") return document.documentElement.lang === "en" ? "en" : "ar";
  return g.__nazeelLocale?.() ?? "ar";
}

export function tr(text: string, ...args: unknown[]): string {
  let out = currentLocale() === "en" ? (EN[text] ?? text) : text;
  for (let i = 0; i < args.length; i++) out = out.split(`{${i}}`).join(String(args[i] ?? ""));
  return out;
}

/** قائمة نصوص تُترجم عند القراءة (للقوائم الثابتة على مستوى الوحدة مثل أيام الأسبوع) */
export function trList<T extends readonly string[]>(items: T): T {
  return new Proxy(items, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof prop === "string" && /^\d+$/.test(prop) && typeof v === "string") return tr(v);
      if (prop === Symbol.iterator) return function* () { for (const x of target) yield typeof x === "string" ? tr(x) : x; };
      if (typeof v === "function" && ["map", "forEach", "filter", "find", "findIndex", "slice", "join", "indexOf", "includes", "some", "every", "reduce", "flatMap", "at", "entries", "values"].includes(String(prop))) {
        return (...a: unknown[]) => (Array.from(target, (x) => (typeof x === "string" ? tr(x) : x)) as unknown as Record<string, (...b: unknown[]) => unknown>)[prop as string]!(...a);
      }
      return v;
    },
  });
}

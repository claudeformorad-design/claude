import "server-only";
import type { AppContext } from "@/lib/auth/context";
import { isIsoDate, todayInTimeZone } from "@/lib/accounting/fiscal";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import type { ToolSpec } from "../provider";

/**
 * أساس أدوات المساعد: كل أداة قراءة فقط، وتعمل بجلسة المستخدم نفسه فتطبق صلاحياته وحماية قاعدة البيانات.
 * الأدوات مقسمة إلى وحدات (أساسية، مالية، موظفون، فندق) تُجمع في index، فتأخذ كل نسخة من النظام ما يخصها.
 */

export type ToolArgs = Record<string, string | number | boolean | undefined>;
export type ToolEnv = { ctx: AppContext; t: Dictionary; locale: string };
export type ToolRunner = (env: ToolEnv, args: ToolArgs) => Promise<unknown>;

export interface ToolModule {
  specs: ToolSpec[];
  run: Record<string, ToolRunner>;
  /** إسهام الوحدة في لقطة الفندق العامة hotel_snapshot */
  snapshot?: (env: ToolEnv) => Promise<Record<string, unknown>>;
}

export const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
export const str = (description: string, e?: readonly string[]) => ({ type: "string", description, ...(e ? { enum: [...e] } : {}) });
export const int = (description: string) => ({ type: "integer", description });
export const fn = (name: string, description: string, parameters: Record<string, unknown> = obj({})): ToolSpec =>
  ({ type: "function", function: { name, description, parameters } });

export const MAX_OUTPUT = 14_000;
/** يقص النتيجة الطويلة مع إبقائها JSON سليمًا: يختصر أطول قائمة فيها مرة بعد مرة، ويذكر ذلك للنموذج */
export const clip = (v: unknown) => {
  let s = JSON.stringify(v) ?? "null";
  if (s.length <= MAX_OUTPUT) return s;
  const copy = JSON.parse(s) as unknown;
  const lists = (x: unknown, out: unknown[][] = []): unknown[][] => {
    if (Array.isArray(x)) { out.push(x); x.forEach((y) => lists(y, out)); }
    else if (x && typeof x === "object") Object.values(x).forEach((y) => lists(y, out));
    return out;
  };
  for (let i = 0; i < 40 && s.length > MAX_OUTPUT; i++) {
    const longest = lists(copy).sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
    if (!longest || longest.length < 2) break;
    longest.splice(Math.ceil(longest.length / 2));
    const wrapped = Array.isArray(copy) ? { items: copy, truncated: "اختُصرت القائمة لطولها، اطلب فترة أقصر للتفاصيل" } : { ...(copy as object), truncated: "اختُصرت بعض القوائم لطولها، اطلب فترة أقصر للتفاصيل" };
    s = JSON.stringify(wrapped);
  }
  return s.length <= MAX_OUTPUT ? s : JSON.stringify({ error: "النتيجة أطول من المسموح، اطلب فترة أو نطاقًا أضيق" });
};
export const denied = (what: string) => ({ error: `ليست لدى المستخدم صلاحية ${what}` });
export const safe = (q: unknown) => String(q ?? "").replace(/[%,()*]/g, " ").trim();
export const asStr = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export const today = (env: ToolEnv) => todayInTimeZone(env.ctx.hotel.timezone);
export const dateArg = (v: unknown, fallback: string) => (typeof v === "string" && isIsoDate(v) ? v : fallback);
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
export const addMonths = (iso: string, n: number) => {
  const d = new Date(`${monthStart(iso)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
export const intArg = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n !== 0 ? Math.min(max, Math.max(min, n)) : def;
};
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const pct = (part: number, whole: number) => (whole ? round2((part / whole) * 100) : null);
export const change = (now: number, before: number) => (before ? round2(((now - before) / Math.abs(before)) * 100) : null);

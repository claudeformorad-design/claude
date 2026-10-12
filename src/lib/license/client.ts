import "server-only";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname, platform, arch } from "node:os";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { readSecret, writeSecret } from "@/lib/server-secrets";
import pkg from "../../../package.json";

/**
 * ترخيص نظام الفندق من لوحة هوتيلنا (لوحة صاحب النظام، مستودع منفصل).
 *
 * يعمل فقط حين يُطلب (NAZEEL_REQUIRE_LICENSE=1)، وإلا يبقى النظام مفتوحًا كما كان (التطوير والنسخة التجريبية).
 * - الربط: كود الربط من اللوحة مرة واحدة، أو مفتاح يدوي لجهاز بلا إنترنت (مربوط ببصمة الجهاز).
 * - الترخيص موقّع بمفتاح اللوحة الخاص (Ed25519)، والنظام يحمل المفتاح العام فقط (NAZEEL_LICENSE_PUBLIC_KEY):
 *   يتحقق ولا يستطيع الإصدار، وأي تعديل على الأقسام يكسر التوقيع.
 * - التواصل الدوري (كل دقيقتين أثناء الاستخدام) موقّع بالسر المشترك، ويأخذ الأقسام والحالة والإشعارات.
 *   إن تعذر التواصل يبقى آخر ترخيص صالح: البيع دائم ولا تاريخ انتهاء.
 * حالة الربط تُحفظ على الخادم وحده (مخزن الأسرار)، لا في قاعدة البيانات.
 */
export type LicensePayload = {
  v: 1;
  kind: "nazeel-license";
  hotel_id: string;
  hotel_name: string;
  instance_id: string | null;
  machine: string | null;
  sections: string[];
  status: "active" | "suspended";
  updates: "forever";
  issued_at: string;
};

export type PanelNotice = { id: string; title: string; body: string; level: "info" | "important"; starts_at: string; ends_at: string | null };

type State = {
  instance_id: string | null;
  secret: string | null;
  license: string | null;
  notices: PanelNotice[];
  last_checkin: string | null;
  last_error: string | null;
};

const KEY = "nazeel-instance";
/** التواصل مع اللوحة كل دقيقتين أثناء استخدام النظام: الإيقاف وإعادة التفعيل وتغيير الأقسام تصل خلالهما */
const CHECKIN_EVERY = Math.max(10, Number(process.env.NAZEEL_CHECKIN_SECONDS) || 120) * 1000;
/** بعد فشل التواصل (اللوحة أو الإنترنت متوقف) تُعاد المحاولة بعد 10 دقائق */
const RETRY_AFTER = 10 * 60_000;
export const APP_VERSION: string = pkg.version;

export const licenseRequired = () => process.env.NAZEEL_REQUIRE_LICENSE === "1";
const panelUrl = () => (process.env.NAZEEL_PANEL_URL ?? "").replace(/\/+$/, "");
const EMPTY: State = { instance_id: null, secret: null, license: null, notices: [], last_checkin: null, last_error: null };

// ذاكرة قصيرة: لا يُقرأ المخزن في كل طلب
let cache: { at: number; state: State } | null = null;
async function readState(): Promise<State> {
  if (cache && Date.now() - cache.at < 60_000) return cache.state;
  let state = EMPTY;
  try { state = { ...EMPTY, ...(JSON.parse((await readSecret(KEY)) ?? "null") ?? {}) }; } catch { /* حالة تالفة = غير مربوط */ }
  cache = { at: Date.now(), state };
  return state;
}
async function writeState(next: State): Promise<void> {
  await writeSecret(KEY, JSON.stringify(next));
  cache = { at: Date.now(), state: next };
}

/**
 * معرّف الجهاز الثابت من نظام التشغيل: لا يتغير بفصل الشبكة أو تبديل الواي فاي أو تركيب برنامج VPN
 * (عنوان بطاقة الشبكة كان يتغير بهذه كلها فيُقفل النظام على الفندق).
 */
function osMachineGuid(): string | null {
  const opts = { encoding: "utf8" as const, timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"] };
  try {
    if (platform() === "win32") {
      const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], opts);
      return out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i)?.[1] ?? null;
    }
    if (platform() === "darwin") {
      return execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], opts).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? null;
    }
    for (const f of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      try { const v = readFileSync(/*turbopackIgnore: true*/ f, "utf8").trim(); if (v) return v; } catch { /* التالي */ }
    }
  } catch { /* بلا معرّف من النظام */ }
  return null;
}

let machine: string | null = null;
/** بصمة الجهاز لنسخة التثبيت بصيغة سهلة الإملاء. تُحسب مرة واحدة لكل تشغيل */
export function machineId(): string {
  if (machine) return machine;
  const source = osMachineGuid() ?? [hostname(), platform(), arch()].join("|");
  const hex = createHash("sha256").update(`hotelna|${source.toLowerCase()}`).digest("hex").slice(0, 16).toUpperCase();
  return (machine = hex.match(/.{4}/g)!.join("-"));
}

const mode = (): "cloud" | "installer" => (isSupabaseConfigured() ? "cloud" : "installer");

/** التحقق من توقيع الترخيص بالمفتاح العام */
export function verifyLicense(token: string | null | undefined): LicensePayload | null {
  const pub = process.env.NAZEEL_LICENSE_PUBLIC_KEY;
  if (!token || !pub) return null;
  const [body, sig] = token.trim().split(".");
  if (!body || !sig) return null;
  try {
    const key = createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" });
    if (!verify(null, Buffer.from(body), key, Buffer.from(sig, "base64url"))) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LicensePayload;
    return p.kind === "nazeel-license" && p.v === 1 && Array.isArray(p.sections) ? p : null;
  } catch {
    return null;
  }
}

export type LicenseStatus =
  | { required: false }
  | { required: true; ok: true; license: LicensePayload; notices: PanelNotice[]; lastCheckin: string | null; lastError: string | null; linked: boolean }
  | { required: true; ok: false; reason: "not_activated" | "invalid" | "other_machine" | "suspended"; license: LicensePayload | null };

/** حالة الترخيص الآن: صالح وفعّال، أو سبب المنع */
export async function licenseStatus(): Promise<LicenseStatus> {
  if (!licenseRequired()) return { required: false };
  const s = await readState();
  if (!s.license) return { required: true, ok: false, reason: "not_activated", license: null };
  const license = verifyLicense(s.license);
  if (!license) return { required: true, ok: false, reason: "invalid", license: null };
  // مفتاح جهاز يعمل على ذلك الجهاز فقط، وترخيص الربط لنظامه المربوط فقط
  if (license.machine && mode() === "installer" && license.machine !== machineId()) return { required: true, ok: false, reason: "other_machine", license };
  if (license.instance_id && license.instance_id !== s.instance_id) return { required: true, ok: false, reason: "invalid", license };
  if (license.status !== "active") return { required: true, ok: false, reason: "suspended", license };
  const now = new Date().toISOString();
  const notices = s.notices.filter((n) => n.starts_at <= now && (!n.ends_at || n.ends_at > now));
  return { required: true, ok: true, license, notices, lastCheckin: s.last_checkin, lastError: s.last_error, linked: !!s.instance_id };
}

export type ActivateResult = { ok: true } | { ok: false; error: "invalid_code" | "already_linked" | "suspended" | "unreachable" | "invalid_key" | "other_machine" | "not_configured" };

/** الربط بكود الربط من اللوحة */
export async function activateWithCode(code: string, siteUrl: string | null): Promise<ActivateResult> {
  if (!panelUrl() || !process.env.NAZEEL_LICENSE_PUBLIC_KEY) return { ok: false, error: "not_configured" };
  let res: Response;
  try {
    res = await fetch(`${panelUrl()}/api/v1/activate`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ code: code.trim(), mode: mode(), machine: mode() === "installer" ? machineId() : null, url: siteUrl, version: APP_VERSION }),
    });
  } catch {
    return { ok: false, error: "unreachable" };
  }
  const j = (await res.json().catch(() => ({}))) as { error?: string; instance_id?: string; secret?: string; license?: string; notices?: PanelNotice[] };
  if (!res.ok) {
    const e = j.error === "already_linked" || j.error === "suspended" ? j.error : res.status === 404 ? "invalid_code" : "unreachable";
    return { ok: false, error: e };
  }
  if (!j.instance_id || !j.secret || !verifyLicense(j.license)) return { ok: false, error: "unreachable" };
  await writeState({ instance_id: j.instance_id, secret: j.secret, license: j.license!, notices: j.notices ?? [], last_checkin: new Date().toISOString(), last_error: null });
  return { ok: true };
}

/** مفتاح يدوي من اللوحة لجهاز بلا إنترنت */
export async function activateWithKey(key: string): Promise<ActivateResult> {
  if (!process.env.NAZEEL_LICENSE_PUBLIC_KEY) return { ok: false, error: "not_configured" };
  const license = verifyLicense(key);
  if (!license || license.instance_id) return { ok: false, error: "invalid_key" };
  if (license.machine && license.machine !== machineId()) return { ok: false, error: "other_machine" };
  if (license.status !== "active") return { ok: false, error: "suspended" };
  const prev = await readState();
  await writeState({ ...prev, instance_id: null, secret: null, license: key.trim(), notices: [], last_error: null });
  return { ok: true };
}

/**
 * التواصل الدوري مع اللوحة. force: الآن مهما كان آخر تواصل.
 * يعيد true إن تغيّر الترخيص. الفشل يُسجَّل ولا يمس آخر ترخيص صالح.
 */
export async function checkin(force = false, siteUrl: string | null = null): Promise<boolean> {
  if (!licenseRequired() || !panelUrl()) return false;
  const s = await readState();
  if (!s.instance_id || !s.secret) return false;
  if (!force && s.last_checkin && Date.now() - Date.parse(s.last_checkin) < CHECKIN_EVERY) return false;
  const raw = JSON.stringify({ version: APP_VERSION, url: siteUrl });
  const send = (now: number) => {
    const ts = String(now);
    return fetch(`${panelUrl()}/api/v1/checkin`, {
      method: "POST", signal: AbortSignal.timeout(8000), body: raw,
      headers: { "content-type": "application/json", "x-instance-id": s.instance_id!, "x-timestamp": ts, "x-signature": createHmac("sha256", s.secret!).update(`${ts}.${raw}`).digest("base64url") },
    });
  };
  try {
    let res = await send(Date.now());
    let j = (await res.json().catch(() => ({}))) as { license?: string; notices?: PanelNotice[]; error?: string; now?: number };
    // ساعة الجهاز خاطئة (أو منطقته الزمنية): يُعاد التوقيع مرة بوقت اللوحة
    if (res.status === 401 && j.error === "clock" && typeof j.now === "number") {
      res = await send(j.now);
      j = (await res.json().catch(() => ({}))) as typeof j;
    }
    if (!res.ok || !verifyLicense(j.license)) throw new Error(j.error === "clock" ? "device clock is wrong" : `panel answered ${res.status}`);
    await writeState({ ...s, license: j.license!, notices: j.notices ?? [], last_checkin: new Date().toISOString(), last_error: null });
    return j.license !== s.license;
  } catch (e) {
    // تأجيل المحاولة التالية، مع بقاء الترخيص كما هو
    await writeState({ ...s, last_checkin: new Date(Date.now() - CHECKIN_EVERY + RETRY_AFTER).toISOString(), last_error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/** أقسام الترخيص كإعدادات الفندق: الأساسيان في enabled_modules، والبقية تُطفأ إن لم تُشترَ */
export function licensedSettings<T extends { enabled_modules: readonly string[]; blocked_sections: readonly string[] }>(
  s: T, license: LicensePayload, allSections: readonly string[],
): T {
  const sold = new Set(license.sections);
  const modules = s.enabled_modules.filter((m) => sold.has(m));
  return {
    ...s,
    // إن أطفأ الفندق كل ما اشتراه من الأساسيين يبقى المشترى منهما
    enabled_modules: modules.length ? modules : ["pms", "accounting"].filter((m) => sold.has(m)),
    blocked_sections: [...new Set([...s.blocked_sections, ...allSections.filter((k) => k !== "pms" && k !== "accounting" && k !== "general" && !sold.has(k))])],
  };
}

"use server";

import { headers } from "next/headers";
import { tr } from "@/i18n/tr";
import { getAppContext, type AppContext } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { activateWithCode, activateWithKey, checkin } from "@/lib/license/client";
import { syncLicenseToDatabase } from "@/lib/license/sync";

type Result = { ok: true } | { ok: false; message: string };

const MESSAGES: Record<string, () => string> = {
  invalid_code: () => tr("كود الربط غير صحيح. تأكد منه مع صاحب النظام."),
  already_linked: () => tr("هذا الكود استُخدم لنظام آخر. اطلب من صاحب النظام كودًا جديدًا."),
  suspended: () => tr("هذا الفندق موقوف من صاحب النظام."),
  unreachable: () => tr("تعذر الوصول للوحة نزيل. تأكد من الإنترنت، أو استخدم المفتاح اليدوي."),
  invalid_key: () => tr("المفتاح غير صحيح أو ناقص. انسخه كاملًا كما وصلك."),
  other_machine: () => tr("هذا المفتاح لجهاز آخر. أرسل رقم هذا الجهاز لصاحب النظام."),
  not_configured: () => tr("النظام غير مهيأ للتفعيل بعد. تواصل مع صاحب النظام."),
};

async function manager(): Promise<AppContext | null> {
  const ctx = await getAppContext();
  if (!ctx.user || !ctx.hotel) return null;
  const full = ctx as AppContext;
  return full.can(PERMISSIONS.hotelManage) ? full : null;
}

async function siteUrl(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : null;
}

export async function activateCodeAction(code: string): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, message: tr("التفعيل لمدير الفندق فقط.") };
  if (typeof code !== "string" || code.trim().length < 6 || code.length > 40) return { ok: false, message: MESSAGES.invalid_code!() };
  const r = await activateWithCode(code, await siteUrl());
  if (!r.ok) return { ok: false, message: MESSAGES[r.error]!() };
  await syncLicenseToDatabase(ctx);
  return { ok: true };
}

export async function activateKeyAction(key: string): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, message: tr("التفعيل لمدير الفندق فقط.") };
  if (typeof key !== "string" || key.length > 8000) return { ok: false, message: MESSAGES.invalid_key!() };
  const r = await activateWithKey(key);
  if (!r.ok) return { ok: false, message: MESSAGES[r.error]!() };
  await syncLicenseToDatabase(ctx);
  return { ok: true };
}

/** إعادة التواصل الآن (بعد إعادة تفعيل فندق موقوف مثلًا) */
export async function recheckAction(): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, message: tr("التفعيل لمدير الفندق فقط.") };
  await checkin(true, await siteUrl());
  await syncLicenseToDatabase(ctx);
  return { ok: true };
}

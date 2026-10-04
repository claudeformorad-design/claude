import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cache } from "react";
import { cookies } from "next/headers";
import { catalogQuery, getLocalDb, ownerTransaction } from "./local-db";

/**
 * تسجيل الدخول في وضع التثبيت المحلي.
 *
 * وضعان:
 *  - مستخدم واحد (الافتراضي): لا شاشة دخول، وكل الطلبات باسم مدير التشغيل. مناسب لفندق يديره شخص واحد.
 *  - عدة مستخدمين: يُفعَّل من الإعدادات بتعيين اسم دخول وكلمة مرور للمدير. بعدها كل طلب باسم صاحب الجلسة،
 *    وتطبَّق صلاحياته في قاعدة البيانات نفسها.
 *
 * كلمات المرور مشفرة بـ scrypt، ورمز الجلسة عشوائي لا يُحفظ إلا مُجزَّأً (sha256)، والجلسة تنتهي بعد فترة خمول.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
export const SESSION_COOKIE = "nazeel_session";
/** الخروج التلقائي بعد هذه المدة بلا استخدام */
export const IDLE_MINUTES = 240;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export type LocalAuthMode = "single" | "multi";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const normalizeUsername = (v: string) => v.trim().toLowerCase();
export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, saltHex, keyHex] = stored.split("$");
  if (algo !== "scrypt" || !n || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), keyHex.length / 2, { ...SCRYPT, N: Number(n) });
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** قوة كلمة المرور: 8 أحرف على الأقل، وفيها حرف ورقم */
export const strongPassword = (pw: string) => pw.length >= 8 && /[A-Za-z؀-ۿ]/.test(pw) && /\d/.test(pw);

export async function getAuthMode(): Promise<LocalAuthMode> {
  const [row] = await catalogQuery<{ value: string }>("select value from local_meta.settings where key = 'auth_mode'");
  return row?.value === "multi" ? "multi" : "single";
}

/** مستخدم التشغيل الأول (مالك النظام) */
export async function ownerUserId(): Promise<string> {
  return (await getLocalDb()).userId;
}

// -----------------------------------------------------------------------------
// محاولات الدخول الفاشلة: قفل مؤقت لاسم الدخول بعد 5 محاولات خلال 15 دقيقة
// -----------------------------------------------------------------------------
type Attempts = Map<string, { count: number; first: number }>;
const g = globalThis as typeof globalThis & { __nazeelAttempts?: Attempts };
const attempts: Attempts = (g.__nazeelAttempts ??= new Map());
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

export function isLockedOut(username: string): boolean {
  const a = attempts.get(username);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) { attempts.delete(username); return false; }
  return a.count >= MAX_ATTEMPTS;
}
function recordFailure(username: string) {
  const a = attempts.get(username);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(username, { count: 1, first: Date.now() });
  else a.count++;
}

// -----------------------------------------------------------------------------
// الجلسات
// -----------------------------------------------------------------------------
async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", secure: false });
}

async function createSession(userId: string, userAgent: string | null): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await ownerTransaction(async (tx) => {
    await tx.query("insert into local_meta.sessions (token_hash, user_id, user_agent) values ($1, $2, $3)", [sha256(token), userId, userAgent]);
    // تنظيف الجلسات المنتهية
    await tx.query(`delete from local_meta.sessions where last_seen < now() - make_interval(mins => $1)`, [IDLE_MINUTES]);
  });
  await setSessionCookie(token);
}

export type SignInResult = { ok: true; mustChange: boolean; locale: "ar" | "en" } | { ok: false; error: "invalid" | "locked" | "inactive" };

export async function signIn(usernameRaw: string, password: string, userAgent: string | null): Promise<SignInResult> {
  const username = normalizeUsername(usernameRaw);
  if (isLockedOut(username)) return { ok: false, error: "locked" };
  const [cred] = await catalogQuery<{ user_id: string; password_hash: string; must_change: boolean; active: boolean; locale: string | null }>(
    `select c.user_id, c.password_hash, c.must_change,
            exists (select 1 from public.hotel_members m where m.user_id = c.user_id and m.is_active) as active,
            (select p.preferred_locale from public.users_profiles p where p.id = c.user_id) as locale
       from local_meta.credentials c where c.username = $1`, [username]);
  // نفس زمن التحقق تقريبًا حتى لو لم يوجد الاسم، فلا يُعرف من التوقيت أي الأسماء موجودة
  const valid = cred ? await verifyPassword(password, cred.password_hash) : (await hashPassword(password), false);
  if (!cred || !valid) { recordFailure(username); return { ok: false, error: "invalid" }; }
  if (!cred.active) return { ok: false, error: "inactive" };
  attempts.delete(username);
  await createSession(cred.user_id, userAgent);
  return { ok: true, mustChange: cred.must_change, locale: cred.locale === "en" ? "en" : "ar" };
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await ownerTransaction((tx) => tx.query("delete from local_meta.sessions where token_hash = $1", [sha256(token)]));
  store.delete(SESSION_COOKIE);
}

/**
 * مستخدم الطلب الحالي. في وضع المستخدم الواحد هو مالك النظام دائمًا.
 * في وضع عدة مستخدمين: صاحب جلسة سارية لم تتجاوز مدة الخمول وحسابه نشط، وإلا لا أحد.
 */
export const currentLocalUserId = cache(async (): Promise<string | null> => {
  if ((await getAuthMode()) === "single") return ownerUserId();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const hash = sha256(token);
  const [s] = await catalogQuery<{ user_id: string; idle: boolean; stale: boolean; active: boolean }>(
    `select s.user_id,
            s.last_seen < now() - make_interval(mins => $2) as idle,
            s.last_seen < now() - interval '1 minute' as stale,
            exists (select 1 from public.hotel_members m where m.user_id = s.user_id and m.is_active)
              or not exists (select 1 from public.hotel_members m where m.user_id = s.user_id) as active
       from local_meta.sessions s where s.token_hash = $1`, [hash, IDLE_MINUTES]);
  if (!s || s.idle || !s.active) {
    if (s) await ownerTransaction((tx) => tx.query("delete from local_meta.sessions where token_hash = $1", [hash]));
    return null;
  }
  if (s.stale) await ownerTransaction((tx) => tx.query("update local_meta.sessions set last_seen = now() where token_hash = $1", [hash]));
  return s.user_id;
});

export async function mustChangePassword(userId: string): Promise<boolean> {
  const [c] = await catalogQuery<{ must_change: boolean }>("select must_change from local_meta.credentials where user_id = $1", [userId]);
  return Boolean(c?.must_change);
}

// -----------------------------------------------------------------------------
// إدارة بيانات الدخول (يتحقق المستدعي من الصلاحية قبلها)
// -----------------------------------------------------------------------------
export async function usernameTaken(username: string, exceptUserId?: string): Promise<boolean> {
  const rows = await catalogQuery<{ user_id: string }>("select user_id from local_meta.credentials where username = $1", [normalizeUsername(username)]);
  return rows.some((r) => r.user_id !== exceptUserId);
}

export async function usernamesOf(userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const rows = await catalogQuery<{ user_id: string; username: string }>(
    "select user_id, username from local_meta.credentials where user_id = any($1::uuid[])", [userIds]);
  return new Map(rows.map((r) => [r.user_id, r.username]));
}

/** تفعيل وضع عدة مستخدمين: يعيّن اسم دخول وكلمة مرور للمالك، ويبقيه داخلًا بجلسة جديدة */
export async function enableMultiUser(username: string, password: string, userAgent: string | null): Promise<void> {
  const owner = await ownerUserId();
  const hash = await hashPassword(password);
  await ownerTransaction(async (tx) => {
    await tx.query(
      `insert into local_meta.credentials (user_id, username, password_hash, must_change) values ($1, $2, $3, false)
       on conflict (user_id) do update set username = excluded.username, password_hash = excluded.password_hash, must_change = false, updated_at = now()`,
      [owner, normalizeUsername(username), hash]);
    await tx.query(
      `insert into local_meta.settings (key, value) values ('auth_mode', 'multi') on conflict (key) do update set value = 'multi'`);
  });
  await createSession(owner, userAgent);
}

/** إنشاء حساب موظف محلي: مستخدم في auth.users وبيانات دخوله بكلمة مرور مؤقتة يغيّرها عند أول دخول */
export async function createLocalAccount(fullName: string, username: string, password: string): Promise<{ userId: string; email: string }> {
  const uname = normalizeUsername(username);
  const email = `${uname}@nazeel.local`;
  const hash = await hashPassword(password);
  const userId = await ownerTransaction(async (tx) => {
    const r = await tx.query<{ id: string }>(
      "insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id", [email, fullName]);
    const id = r.rows[0]!.id;
    await tx.query("insert into local_meta.credentials (user_id, username, password_hash, must_change) values ($1, $2, $3, true)", [id, uname, hash]);
    return id;
  });
  return { userId, email };
}

/** حذف حساب أُنشئ ولم يكتمل ربطه بالفندق (فشل إضافته لصلاحيات المنفّذ) */
export async function discardLocalAccount(userId: string): Promise<void> {
  await ownerTransaction(async (tx) => {
    await tx.query("delete from local_meta.credentials where user_id = $1", [userId]);
    await tx.query("delete from auth.users where id = $1 and not exists (select 1 from public.hotel_members where user_id = $1)", [userId]);
  });
}

export async function setLocalPassword(userId: string, password: string, mustChange: boolean): Promise<void> {
  const hash = await hashPassword(password);
  await ownerTransaction(async (tx) => {
    await tx.query("update local_meta.credentials set password_hash = $2, must_change = $3, updated_at = now() where user_id = $1", [userId, hash, mustChange]);
    // تغيير كلمة المرور يُخرج كل جلسات الحساب الأخرى
    await tx.query("delete from local_meta.sessions where user_id = $1", [userId]);
  });
}

export async function endSessionsOf(userId: string): Promise<void> {
  await ownerTransaction((tx) => tx.query("delete from local_meta.sessions where user_id = $1", [userId]));
}

/** بعد تغيير المستخدم لكلمة مروره: جلسة جديدة له */
export async function renewSession(userId: string, userAgent: string | null): Promise<void> {
  await createSession(userId, userAgent);
}

export async function checkPassword(userId: string, password: string): Promise<boolean> {
  const [c] = await catalogQuery<{ password_hash: string }>("select password_hash from local_meta.credentials where user_id = $1", [userId]);
  return c ? verifyPassword(password, c.password_hash) : false;
}

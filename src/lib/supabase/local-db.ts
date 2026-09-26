import "server-only";
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

/**
 * وضع التجربة المحلي: قاعدة PostgreSQL حقيقية مضمّنة (PGlite) تُطبَّق عليها
 * نفس ملفات supabase/migrations حرفيًا — أي أن كل قواعد المحاسبة (توازن القيود،
 * منع تعديل المرحّل، الفترات المقفلة، الترقيم، RLS، الصلاحيات، الضرائب...)
 * تعمل هنا بنفس الكود المختبر الذي سيعمل على Supabase لاحقًا، دون أي منطق بديل.
 *
 * لا توجد أي بيانات تجريبية: القاعدة تبدأ فارغة تمامًا، ويُنشأ الفندق من شاشة الإعداد.
 */

const ROOT = process.cwd();
export const LOCAL_DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.LOCAL_DB_DIR || path.join(ROOT, ".data", "pglite"));
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const SHIM_FILE = path.join(ROOT, "supabase", "tests", "supabase_shim.sql");

export interface LocalDb {
  db: PGlite;
  userId: string;
}

type GlobalWithDb = typeof globalThis & { __hotelLocalDb?: Promise<LocalDb>; __hotelLocalQueue?: Promise<unknown> };
const g = globalThis as GlobalWithDb;

/** إزالة أوامر psql الخاصة (\set ...) إن وجدت */
function readSql(file: string): string {
  return readFileSync(/*turbopackIgnore: true*/ file, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("\\"))
    .join("\n");
}

async function bootstrap(): Promise<LocalDb> {
  mkdirSync(/*turbopackIgnore: true*/ LOCAL_DATA_DIR, { recursive: true });
  const db = new PGlite(LOCAL_DATA_DIR, { extensions: { btree_gist } });
  await db.waitReady;
  await db.exec("set timezone = 'UTC'");

  // سجل الترحيلات المطبّقة: يسمح بتطبيق الترحيلات الجديدة فقط عند تحديث النظام دون فقدان البيانات
  await db.exec(`
    create schema if not exists local_meta;
    create table if not exists local_meta.applied_migrations (name text primary key, applied_at timestamptz not null default now());
    create table if not exists local_meta.settings (key text primary key, value text not null);
  `);
  const applied = new Set(
    (await db.query<{ name: string }>("select name from local_meta.applied_migrations")).rows.map((r) => r.name),
  );
  if (applied.size === 0) await db.exec(readSql(SHIM_FILE));

  const files = readdirSync(/*turbopackIgnore: true*/ MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(readSql(path.join(MIGRATIONS_DIR, file)));
      await tx.query("insert into local_meta.applied_migrations (name) values ($1)", [file]);
    });
  }

  // مستخدم تشغيل محلي واحد (وضع التجربة بلا تسجيل دخول). ملفه الشخصي يُنشأ تلقائيًا بتريغر auth.users
  let userId = (await db.query<{ value: string }>("select value from local_meta.settings where key = 'local_user_id'")).rows[0]?.value;
  if (!userId) {
    await db.transaction(async (tx) => {
      const r = await tx.query<{ id: string }>(
        `insert into auth.users (email, raw_user_meta_data) values ('local@localhost', jsonb_build_object('full_name', 'مدير النظام'))
         returning id`,
      );
      userId = r.rows[0]!.id;
      await tx.query("insert into local_meta.settings (key, value) values ('local_user_id', $1)", [userId]);
    });
  }
  return { db, userId: userId! };
}

export function getLocalDb(): Promise<LocalDb> {
  if (!g.__hotelLocalDb) {
    g.__hotelLocalDb = bootstrap().catch((e) => {
      g.__hotelLocalDb = undefined;
      throw e;
    });
  }
  return g.__hotelLocalDb;
}

/**
 * تنفيذ عملية داخل معاملة واحدة بصلاحيات المستخدم المحلي (role authenticated + auth.uid())
 * حتى تُطبَّق سياسات RLS والصلاحيات تمامًا كما في Supabase. العمليات تُسلسل (اتصال واحد).
 */
export function withUserTransaction<T>(fn: (tx: Transaction, userId: string) => Promise<T>): Promise<T> {
  const run = async () => {
    const { db, userId } = await getLocalDb();
    return db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('role', 'authenticated', true)", [userId]);
      return fn(tx, userId);
    });
  };
  const prev = g.__hotelLocalQueue ?? Promise.resolve();
  const next = prev.then(run, run);
  g.__hotelLocalQueue = next.catch(() => undefined);
  return next;
}

/** استعلامات الكتالوج (أنواع الأعمدة وتواقيع الدوال) بصلاحية المالك */
export async function catalogQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const run = async () => {
    const { db } = await getLocalDb();
    return (await db.query<T>(sql, params)).rows;
  };
  const prev = g.__hotelLocalQueue ?? Promise.resolve();
  const next = prev.then(run, run);
  g.__hotelLocalQueue = next.catch(() => undefined);
  return next;
}

/** تصفير كامل: حذف القاعدة المحلية بالكامل؛ أول طلب بعده يبني قاعدة جديدة فارغة */
export async function wipeLocalDb(): Promise<void> {
  const run = async () => {
    const current = g.__hotelLocalDb;
    g.__hotelLocalDb = undefined;
    if (current) {
      try {
        await (await current).db.close();
      } catch {
        // القاعدة قد تكون فشلت في الإقلاع أصلًا
      }
    }
    if (existsSync(/*turbopackIgnore: true*/ LOCAL_DATA_DIR)) rmSync(/*turbopackIgnore: true*/ LOCAL_DATA_DIR, { recursive: true, force: true });
  };
  const prev = g.__hotelLocalQueue ?? Promise.resolve();
  const next = prev.then(run, run);
  g.__hotelLocalQueue = next.catch(() => undefined);
  return next;
}

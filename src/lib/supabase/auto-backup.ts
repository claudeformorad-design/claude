import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exportLocalBackup, LOCAL_DATA_ROOT } from "./local-db";

/**
 * النسخ الاحتياطي التلقائي اليومي (وضع التشغيل المحلي): نسخة كاملة للقاعدة كل يوم بعد الوقت المحدد
 * في مجلد يختاره المدير (قرص خارجي أو مجلد مزامنة)، مع الاحتفاظ بآخر عدد من النسخ وحذف الأقدم.
 * إن كان الجهاز مطفأً وقت النسخ تُؤخذ النسخة عند أول تشغيل بعده. الإعدادات والحالة في ملف خارج القاعدة،
 * فلا تتغير عند استعادة نسخة قديمة.
 */
export type AutoBackupSettings = { enabled: boolean; folder: string; time: string; keep: number };
export type AutoBackupStatus = { last_success_at: string | null; last_file: string | null; last_error: string | null; last_attempt_at: string | null };
export type BackupFile = { name: string; size: number; created_at: string };

const SETTINGS_FILE = path.join(LOCAL_DATA_ROOT, "auto-backup.json");
export const DEFAULT_BACKUP_FOLDER = path.join(LOCAL_DATA_ROOT, "backups");
const DEFAULTS: AutoBackupSettings = { enabled: true, folder: DEFAULT_BACKUP_FOLDER, time: "03:00", keep: 14 };
const EMPTY_STATUS: AutoBackupStatus = { last_success_at: null, last_file: null, last_error: null, last_attempt_at: null };
/** أسماء ملفات النسخ التلقائية فقط (لا يُحذف أو يُنزَّل غيرها من المجلد) */
export const BACKUP_FILE = /^nazeel-backup-\d{4}-\d{2}-\d{2}-\d{4}\.tar\.gz$/;
/** تُعد النسخة متأخرة إن مر على آخر نجاح أكثر من يوم وساعتين */
const STALE_MS = 26 * 3600_000;

type Stored = { settings: AutoBackupSettings; status: AutoBackupStatus };

/**
 * إنشاء المجلد ومجلداته الأم خطوة خطوة. لا يُستخدم mkdirSync مع recursive هنا: في بعض المسارات
 * (مثل /proc) يدخل في حلقة لا تنتهي فيتجمد الخادم كله، والمسار هنا يكتبه المستخدم.
 */
function ensureDir(dir: string): void {
  const parts = path.resolve(dir).split(path.sep);
  let cur = parts[0] === "" ? path.sep : parts[0]!;
  for (const part of parts.slice(1)) {
    if (!part) continue;
    cur = path.join(cur, part);
    try {
      mkdirSync(/*turbopackIgnore: true*/ cur);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  if (!statSync(/*turbopackIgnore: true*/ dir).isDirectory()) throw new Error(`Not a folder: ${dir}`);
}

function read(): Stored {
  try {
    const raw = JSON.parse(readFileSync(/*turbopackIgnore: true*/ SETTINGS_FILE, "utf8")) as Partial<Stored>;
    return { settings: { ...DEFAULTS, ...raw.settings }, status: { ...EMPTY_STATUS, ...raw.status } };
  } catch {
    return { settings: { ...DEFAULTS }, status: { ...EMPTY_STATUS } };
  }
}

function write(v: Stored): void {
  ensureDir(LOCAL_DATA_ROOT);
  const tmp = `${SETTINGS_FILE}.tmp`;
  writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(v, null, 2));
  renameSync(/*turbopackIgnore: true*/ tmp, SETTINGS_FILE);
}

export function getAutoBackup(): Stored & { stale: boolean } {
  const v = read();
  const last = v.status.last_success_at ? Date.parse(v.status.last_success_at) : 0;
  return { ...v, stale: v.settings.enabled && Date.now() - last > STALE_MS };
}

/** يحفظ الإعدادات بعد التأكد من إمكانية الكتابة في المجلد */
export function saveAutoBackupSettings(next: AutoBackupSettings): void {
  const folder = path.resolve(next.folder);
  ensureDir(folder);
  const probe = path.join(folder, `.nazeel-write-test-${process.pid}`);
  writeFileSync(/*turbopackIgnore: true*/ probe, "ok");
  rmSync(/*turbopackIgnore: true*/ probe, { force: true });
  const v = read();
  write({ ...v, settings: { ...next, folder } });
}

export function listBackupFiles(): BackupFile[] {
  const { folder } = read().settings;
  if (!existsSync(/*turbopackIgnore: true*/ folder)) return [];
  return readdirSync(/*turbopackIgnore: true*/ folder)
    .filter((f) => BACKUP_FILE.test(f))
    .map((name) => {
      const st = statSync(/*turbopackIgnore: true*/ path.join(folder, name));
      return { name, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** مسار ملف نسخة في المجلد الحالي (لتنزيله)، أو null إن لم يكن من ملفات النسخ */
export function backupFilePath(name: string): string | null {
  if (!BACKUP_FILE.test(name)) return null;
  const p = path.join(read().settings.folder, name);
  return existsSync(/*turbopackIgnore: true*/ p) ? p : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let running: Promise<BackupFile> | null = null;

/** يأخذ نسخة الآن ويحذف ما زاد على العدد المحفوظ. نسخة واحدة في الوقت نفسه */
export function runBackupNow(): Promise<BackupFile> {
  if (running) return running;
  running = (async () => {
    const v = read();
    const now = new Date();
    try {
      ensureDir(v.settings.folder);
      const blob = await exportLocalBackup();
      const name = `nazeel-backup-${stamp(now)}.tar.gz`;
      const target = path.join(v.settings.folder, name);
      // كتابة لملف مؤقت ثم إعادة تسمية: لا تبقى نسخة ناقصة باسم صحيح إن انقطع التشغيل
      writeFileSync(/*turbopackIgnore: true*/ `${target}.part`, Buffer.from(await blob.arrayBuffer()));
      renameSync(/*turbopackIgnore: true*/ `${target}.part`, target);
      for (const old of listBackupFiles().slice(Math.max(1, v.settings.keep))) rmSync(/*turbopackIgnore: true*/ path.join(v.settings.folder, old.name), { force: true });
      write({ ...read(), status: { last_success_at: now.toISOString(), last_file: name, last_error: null, last_attempt_at: now.toISOString() } });
      return { name, size: blob.size, created_at: now.toISOString() };
    } catch (e) {
      const cur = read();
      write({ ...cur, status: { ...cur.status, last_error: e instanceof Error ? e.message : String(e), last_attempt_at: now.toISOString() } });
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** هل حان وقت نسخة اليوم ولم تؤخذ بعد؟ (بتوقيت الجهاز) */
export function isBackupDue(now = new Date()): boolean {
  const { settings, status } = read();
  if (!settings.enabled) return false;
  const [h, m] = settings.time.split(":").map(Number);
  if (now.getHours() * 60 + now.getMinutes() < (h ?? 3) * 60 + (m ?? 0)) return false;
  const lastOk = status.last_success_at ? localDay(new Date(status.last_success_at)) : null;
  if (lastOk === localDay(now)) return false;
  // بعد محاولة فاشلة تُعاد المحاولة كل ساعة لا كل دقيقة
  if (status.last_attempt_at && status.last_error && now.getTime() - Date.parse(status.last_attempt_at) < 3600_000) return false;
  return true;
}

type GlobalWithTimer = typeof globalThis & { __nazeelBackupTimer?: ReturnType<typeof setInterval> };

/** يبدأ الفحص الدوري مرة واحدة لكل عملية خادم */
export function startAutoBackupScheduler(): void {
  const g = globalThis as GlobalWithTimer;
  if (g.__nazeelBackupTimer) return;
  const tick = () => {
    if (!isBackupDue()) return;
    runBackupNow().catch((e) => console.error("auto backup failed", e));
  };
  g.__nazeelBackupTimer = setInterval(tick, 5 * 60_000);
  g.__nazeelBackupTimer.unref?.();
  setTimeout(tick, 60_000).unref?.();
}

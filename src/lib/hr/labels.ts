/** تسميات الموارد البشرية المشتركة بين الصفحات */
import { tr, trList } from "@/i18n/tr";
export const CONTRACT_TYPES: Record<string, string> = { get permanent() { return tr("دائم"); }, get fixed() { return tr("محدد المدة"); }, get part_time() { return tr("دوام جزئي"); } };

export const ATTENDANCE_STATUS: Record<string, { label: string; tone: "success" | "destructive" | "info" | "secondary" }> = {
  present: { get label() { return tr("حاضر"); }, tone: "success" },
  absent: { get label() { return tr("غائب"); }, tone: "destructive" },
  leave: { get label() { return tr("إجازة"); }, tone: "info" },
  off: { get label() { return tr("راحة"); }, tone: "secondary" },
};

export const LEAVE_STATUS: Record<string, { label: string; tone: "warning" | "success" | "destructive" | "secondary" }> = {
  pending: { get label() { return tr("بانتظار القرار"); }, tone: "warning" },
  approved: { get label() { return tr("معتمدة"); }, tone: "success" },
  rejected: { get label() { return tr("مرفوضة"); }, tone: "destructive" },
  cancelled: { get label() { return tr("ملغاة"); }, tone: "secondary" },
};

export const PENALTY_STATUS: Record<string, { label: string; tone: "warning" | "success" | "secondary" }> = {
  pending: { get label() { return tr("بانتظار الاعتماد"); }, tone: "warning" },
  approved: { get label() { return tr("معتمد"); }, tone: "success" },
  cancelled: { get label() { return tr("ملغى"); }, tone: "secondary" },
};

export const END_REASONS: Record<string, string> = { get resignation() { return tr("استقالة"); }, get termination() { return tr("إنهاء من المنشأة"); } };

/** أيام الأسبوع بترتيب JavaScript وPostgreSQL: 0 الأحد */
export const WEEKDAYS = trList(["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]);

/** دقائق إلى نص مثل ساعة و20 دقيقة */
export function minutesText(m: number): string {
  if (!m) return "";
  const h = Math.floor(m / 60), r = m % 60;
  return [h ? tr("{0} س", h) : "", r ? tr("{0} د", r) : ""].filter(Boolean).join(" ");
}

export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

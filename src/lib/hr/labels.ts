/** تسميات الموارد البشرية المشتركة بين الصفحات */
export const CONTRACT_TYPES: Record<string, string> = { permanent: "دائم", fixed: "محدد المدة", part_time: "دوام جزئي" };

export const ATTENDANCE_STATUS: Record<string, { label: string; tone: "success" | "destructive" | "info" | "secondary" }> = {
  present: { label: "حاضر", tone: "success" },
  absent: { label: "غائب", tone: "destructive" },
  leave: { label: "إجازة", tone: "info" },
  off: { label: "راحة", tone: "secondary" },
};

export const LEAVE_STATUS: Record<string, { label: string; tone: "warning" | "success" | "destructive" | "secondary" }> = {
  pending: { label: "بانتظار القرار", tone: "warning" },
  approved: { label: "معتمدة", tone: "success" },
  rejected: { label: "مرفوضة", tone: "destructive" },
  cancelled: { label: "ملغاة", tone: "secondary" },
};

export const PENALTY_STATUS: Record<string, { label: string; tone: "warning" | "success" | "secondary" }> = {
  pending: { label: "بانتظار الاعتماد", tone: "warning" },
  approved: { label: "معتمد", tone: "success" },
  cancelled: { label: "ملغى", tone: "secondary" },
};

export const END_REASONS: Record<string, string> = { resignation: "استقالة", termination: "إنهاء من المنشأة" };

/** أيام الأسبوع بترتيب JavaScript وPostgreSQL: 0 الأحد */
export const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** دقائق إلى نص مثل ساعة و20 دقيقة */
export function minutesText(m: number): string {
  if (!m) return "";
  const h = Math.floor(m / 60), r = m % 60;
  return [h ? `${h} س` : "", r ? `${r} د` : ""].filter(Boolean).join(" ");
}

export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

import type {
  BookingMode, GuestIdType, HousekeepingStatus, ReservationPricing, ReservationSource, ReservationStatus, RoomServiceStatus,
  WaitlistStatus,
} from "@/lib/supabase/database.types";

/** نصوص قسم إدارة الفندق (النظام عربي بالكامل) وألوان الحالات بنفس نظام الوسوم */
export const RESERVATION_STATUS: Record<ReservationStatus, { label: string; variant: "warning" | "info" | "success" | "secondary" | "destructive" }> = {
  tentative: { label: "مبدئي", variant: "warning" },
  confirmed: { label: "مؤكد", variant: "info" },
  checked_in: { label: "مقيم", variant: "success" },
  checked_out: { label: "غادر", variant: "secondary" },
  cancelled: { label: "ملغى", variant: "destructive" },
  no_show: { label: "لم يحضر", variant: "destructive" },
};

export const RESERVATION_SOURCE: Record<ReservationSource, string> = {
  direct: "مباشر", phone: "هاتف", walk_in: "حضور مباشر", website: "الموقع", booking_com: "Booking.com",
  expedia: "Expedia", agent: "وكيل سفر", corporate: "شركة", other: "أخرى",
};

export const PRICING_LABEL: Record<ReservationPricing, string> = {
  standard: "حسب الأسعار والمواسم", fixed: "سعر يدوي لليلة", monthly: "سعر شهري للإقامة الطويلة",
};

export const HOUSEKEEPING_KIND = {
  departure: "تنظيف مغادرة", stayover: "تنظيف إقامة مستمرة", inspection: "فحص", maintenance: "صيانة", turndown: "تجهيز مسائي",
} as const;
export const HOUSEKEEPING_TASK_STATUS = {
  pending: { label: "بانتظار", variant: "warning" }, in_progress: { label: "قيد التنفيذ", variant: "info" },
  done: { label: "أُنجزت", variant: "success" }, cancelled: { label: "ملغاة", variant: "secondary" },
} as const;

export const BILL_TO = { guest: "على النزيل", company_room: "الإقامة على الشركة والإضافات على النزيل", company_all: "كل الفاتورة على الشركة" } as const;

export const BOOKING_MODE: Record<BookingMode, string> = { nightly: "ليلي", hourly: "بالساعة" };

export const HOUSEKEEPING: Record<HousekeepingStatus, { label: string; variant: "success" | "warning" | "info" }> = {
  clean: { label: "نظيفة", variant: "success" },
  dirty: { label: "تحتاج تنظيف", variant: "warning" },
  inspected: { label: "مفحوصة", variant: "info" },
};

export const SERVICE: Record<RoomServiceStatus, string> = { in_service: "في الخدمة", out_of_service: "خارج الخدمة" };

export const ID_TYPES: Record<GuestIdType, string> = {
  national_id: "بطاقة شخصية", passport: "جواز سفر", residence: "إقامة", other: "هوية أخرى",
};

export const WAITLIST_STATUS: Record<WaitlistStatus, string> = { waiting: "في الانتظار", converted: "تحوّل لحجز", cancelled: "ملغى" };

/** أيام الأسبوع (0 = الأحد) */
export const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;

/** الحالات التي تشغل الغرفة أو تحجز من السعة */
export const ACTIVE_STATUSES: ReservationStatus[] = ["tentative", "confirmed", "checked_in"];

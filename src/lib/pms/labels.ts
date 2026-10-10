import { tr, trList } from "@/i18n/tr";
import type {
  BookingMode, GuestIdType, HousekeepingStatus, ReservationPricing, ReservationSource, ReservationStatus, RoomServiceStatus,
  WaitlistStatus,
} from "@/lib/supabase/database.types";

/** نصوص قسم إدارة الفندق (النظام عربي بالكامل) وألوان الحالات بنفس نظام الوسوم */
export const RESERVATION_STATUS: Record<ReservationStatus, { label: string; variant: "warning" | "info" | "success" | "secondary" | "destructive" }> = {
  tentative: { get label() { return tr("مبدئي"); }, variant: "warning" },
  confirmed: { get label() { return tr("مؤكد"); }, variant: "info" },
  checked_in: { get label() { return tr("مقيم"); }, variant: "success" },
  checked_out: { get label() { return tr("غادر"); }, variant: "secondary" },
  cancelled: { get label() { return tr("ملغى"); }, variant: "destructive" },
  no_show: { get label() { return tr("لم يحضر"); }, variant: "destructive" },
};

export const RESERVATION_SOURCE: Record<ReservationSource, string> = {
  get direct() { return tr("مباشر"); }, get phone() { return tr("هاتف"); }, get walk_in() { return tr("حضور مباشر"); }, get website() { return tr("الموقع"); }, booking_com: "Booking.com",
  expedia: "Expedia", get agent() { return tr("وكيل سفر"); }, get corporate() { return tr("شركة"); }, get other() { return tr("أخرى"); },
};

export const PRICING_LABEL: Record<ReservationPricing, string> = {
  get standard() { return tr("حسب الأسعار والمواسم"); }, get fixed() { return tr("سعر يدوي لليلة"); }, get monthly() { return tr("سعر شهري للإقامة الطويلة"); },
};

export const HOUSEKEEPING_KIND = {
  get departure() { return tr("تنظيف مغادرة"); }, get stayover() { return tr("تنظيف إقامة مستمرة"); }, get inspection() { return tr("فحص"); }, get maintenance() { return tr("صيانة"); }, get turndown() { return tr("تجهيز مسائي"); },
} as const;
export const HOUSEKEEPING_TASK_STATUS = {
  pending: { get label() { return tr("بانتظار"); }, variant: "warning" }, in_progress: { get label() { return tr("قيد التنفيذ"); }, variant: "info" },
  done: { get label() { return tr("أُنجزت"); }, variant: "success" }, cancelled: { get label() { return tr("ملغاة"); }, variant: "secondary" },
} as const;

export const BILL_TO = { get guest() { return tr("على النزيل"); }, get company_room() { return tr("الإقامة على الشركة والإضافات على النزيل"); }, get company_all() { return tr("كل الفاتورة على الشركة"); } } as const;

export const BOOKING_MODE: Record<BookingMode, string> = { get nightly() { return tr("ليلي"); }, get hourly() { return tr("بالساعة"); } };

export const HOUSEKEEPING: Record<HousekeepingStatus, { label: string; variant: "success" | "warning" | "info" }> = {
  clean: { get label() { return tr("نظيفة"); }, variant: "success" },
  dirty: { get label() { return tr("تحتاج تنظيف"); }, variant: "warning" },
  inspected: { get label() { return tr("مفحوصة"); }, variant: "info" },
};

export const SERVICE: Record<RoomServiceStatus, string> = { get in_service() { return tr("في الخدمة"); }, get out_of_service() { return tr("خارج الخدمة"); } };

export const ID_TYPES: Record<GuestIdType, string> = {
  get national_id() { return tr("بطاقة شخصية"); }, get passport() { return tr("جواز سفر"); }, get residence() { return tr("إقامة"); }, get other() { return tr("هوية أخرى"); },
};

export const WAITLIST_STATUS: Record<WaitlistStatus, string> = { get waiting() { return tr("في الانتظار"); }, get converted() { return tr("تحوّل لحجز"); }, get cancelled() { return tr("ملغى"); } };

/** أيام الأسبوع (0 = الأحد) */
export const WEEKDAYS = trList(["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const);

/** الحالات التي تشغل الغرفة أو تحجز من السعة */
export const ACTIVE_STATUSES: ReservationStatus[] = ["tentative", "confirmed", "checked_in"];

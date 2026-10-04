import { tr } from "@/i18n/tr";
import type {
  EventStatus, EventType, LaundryService, LaundryStatus, LinenMovementKind, LostItemCategory, MaintenanceAssetCategory, MaintenancePriority, MaintenanceStatus,
} from "@/lib/supabase/database.types";

type Variant = "success" | "warning" | "info" | "secondary" | "destructive" | "outline";
type Labeled = { readonly label: string; readonly variant: Variant };

/** تسميات خدمات التشغيل وألوان حالاتها */
export const MAINTENANCE_STATUS: Record<MaintenanceStatus, Labeled> = {
  open: { get label() { return tr("جديد"); }, variant: "warning" },
  in_progress: { get label() { return tr("قيد العمل"); }, variant: "info" },
  on_hold: { get label() { return tr("معلّق"); }, variant: "outline" },
  done: { get label() { return tr("منجز"); }, variant: "success" },
  cancelled: { get label() { return tr("ملغى"); }, variant: "secondary" },
};

export const MAINTENANCE_PRIORITY: Record<MaintenancePriority, Labeled> = {
  low: { get label() { return tr("منخفضة"); }, variant: "secondary" },
  normal: { get label() { return tr("عادية"); }, variant: "outline" },
  high: { get label() { return tr("مرتفعة"); }, variant: "warning" },
  urgent: { get label() { return tr("عاجلة"); }, variant: "destructive" },
};

export const ASSET_CATEGORY: Record<MaintenanceAssetCategory, string> = {
  get ac() { return tr("تكييف"); }, get electrical() { return tr("كهرباء"); }, get plumbing() { return tr("سباكة"); },
  get appliance() { return tr("أجهزة"); }, get furniture() { return tr("أثاث"); }, get elevator() { return tr("مصاعد"); },
  get generator() { return tr("مولدات"); }, get it() { return tr("شبكات وأنظمة"); }, get other() { return tr("أخرى"); },
};

export const LOST_CATEGORY: Record<LostItemCategory, string> = {
  get electronics() { return tr("إلكترونيات"); }, get documents() { return tr("مستندات"); }, get money() { return tr("نقود"); },
  get jewelry() { return tr("مجوهرات"); }, get clothing() { return tr("ملابس"); }, get bags() { return tr("حقائب"); }, get other() { return tr("أخرى"); },
};

export const LOST_STATUS: Record<"stored" | "returned" | "disposed", Labeled> = {
  stored: { get label() { return tr("محفوظ"); }, variant: "warning" },
  returned: { get label() { return tr("سُلِّم لصاحبه"); }, variant: "success" },
  disposed: { get label() { return tr("أُتلف"); }, variant: "secondary" },
};

export const LAUNDRY_SERVICE: Record<LaundryService, string> = {
  get wash() { return tr("غسيل"); }, get iron() { return tr("كي"); }, get wash_iron() { return tr("غسيل وكي"); }, get dry_clean() { return tr("تنظيف جاف"); },
};

export const LAUNDRY_STATUS: Record<LaundryStatus, Labeled> = {
  received: { get label() { return tr("مستلم"); }, variant: "warning" },
  in_process: { get label() { return tr("في المغسلة"); }, variant: "info" },
  ready: { get label() { return tr("جاهز للتسليم"); }, variant: "success" },
  delivered: { get label() { return tr("سُلِّم للنزيل"); }, variant: "secondary" },
  cancelled: { get label() { return tr("ملغى"); }, variant: "secondary" },
};

/** الخطوة التالية لطلب الغسيل */
export const LAUNDRY_NEXT: Partial<Record<LaundryStatus, { status: LaundryStatus; readonly label: string }>> = {
  received: { status: "in_process", get label() { return tr("أُرسل للمغسلة"); } },
  in_process: { status: "ready", get label() { return tr("جاهز"); } },
  ready: { status: "delivered", get label() { return tr("تسليم للنزيل"); } },
};

export const LINEN_KIND: Record<LinenMovementKind, string> = {
  get purchased() { return tr("شراء وإضافة"); }, get sent() { return tr("إرسال للمغسلة"); }, get returned() { return tr("استلام من المغسلة"); }, get damaged() { return tr("تالف ومفقود"); },
};

export const EVENT_TYPE: Record<EventType, string> = {
  get wedding() { return tr("زفاف"); }, get conference() { return tr("مؤتمر"); }, get meeting() { return tr("اجتماع"); },
  get party() { return tr("حفل"); }, get graduation() { return tr("تخرج"); }, get other() { return tr("أخرى"); },
};

export const EVENT_STATUS: Record<EventStatus, Labeled> = {
  tentative: { get label() { return tr("مبدئي"); }, variant: "warning" },
  confirmed: { get label() { return tr("مؤكد"); }, variant: "info" },
  completed: { get label() { return tr("منفّذ"); }, variant: "success" },
  cancelled: { get label() { return tr("ملغى"); }, variant: "secondary" },
};

/** جوانب التقييم كما تظهر للنزيل وفي التقرير */
export const SURVEY_ASPECTS = [
  { key: "cleanliness", get label() { return tr("النظافة"); } },
  { key: "staff", get label() { return tr("تعامل الموظفين"); } },
  { key: "comfort", get label() { return tr("راحة الغرفة"); } },
  { key: "value", get label() { return tr("القيمة مقابل السعر"); } },
  { key: "food", get label() { return tr("الطعام"); } },
] as const;

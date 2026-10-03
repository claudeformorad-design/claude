import { formatMoney, MoneyDecimal } from "@/lib/accounting/money";
import type { HotelRow } from "@/lib/supabase/database.types";
import { plainText } from "@/lib/text";
import type { ReportTable } from "@/services/report-tables";

/** تقرير جاهز للعرض والتصدير: خلايا نصية منسّقة (يُرسل للمتصفح كما هو) */
export type PlainReport = {
  title: string;
  subtitle: string;
  columns: string[];
  rows: { kind: "section" | "line" | "subtotal" | "total"; cells: { text: string; num: boolean }[]; code?: string; account?: string }[];
  note?: { ok: boolean; text: string };
};

/** عنوان عمود الرمز حين يحمل التقرير رموزًا، ويظهر قبل عمود الاسم */
export const CODE_COLUMN = "الرمز";
export const hasCodes = (rows: { code?: string }[]) => rows.some((r) => !!r.code);

/** بيانات رأس المستند: الفندق وبياناته النظامية ووقت الإعداد */
export type DocMeta = {
  hotelName: string;
  legal: string[];
  contact: string[];
  logoUrl: string | null;
  currency: string;
  generatedAt: string;
  preparedBy?: string;
};

export function toPlainReport(table: ReportTable, locale: string): PlainReport {
  return {
    title: table.title,
    subtitle: table.subtitle,
    columns: table.columns,
    note: table.note,
    rows: table.rows.map((r) => ({
      kind: r.kind,
      code: r.code,
      account: r.account,
      cells: r.cells.map((c) => c instanceof MoneyDecimal
        ? { text: c.isZero() ? "" : formatMoney(c, { locale }), num: true }
        : { text: plainText(c), num: false }),
    })),
  };
}

export function docMeta(hotel: HotelRow, generatedAt: string, preparedBy?: string): DocMeta {
  return {
    hotelName: hotel.name_ar,
    legal: [hotel.legal_name, hotel.tax_number && `الرقم الضريبي ${hotel.tax_number}`, hotel.commercial_registration && `السجل التجاري ${hotel.commercial_registration}`]
      .filter((x): x is string => !!x),
    contact: [hotel.address, hotel.phone, hotel.email].filter((x): x is string => !!x),
    logoUrl: hotel.logo_url,
    currency: hotel.base_currency,
    generatedAt,
    preparedBy,
  };
}

/**
 * تفاصيل صف قابل للفتح في أي جدول: حقائق قصيرة، وجدول مصغّر، وإجمالي، ورابط للصفحة الكاملة.
 * نوع الخلية يحدد عرضها ومحاذاتها: النص والتاريخ والرمز من البداية، والمبلغ والكمية في النهاية.
 */
export type DetailCellType = "text" | "code" | "date" | "amount";
export type DetailCell = { text: string; type?: DetailCellType; href?: string; tone?: "neg" | "pos" | "muted" };

export type Detail = {
  facts?: { label: string; value: string; amount?: boolean }[];
  columns: string[];
  rows: DetailCell[][];
  totals?: DetailCell[];
  empty?: string;
  link?: { href: string; label: string };
};

export type DetailKind = "journal" | "invoice" | "voucher" | "bill" | "purchase-order" | "folio" | "reservation" | "account" | "customer" | "vendor";

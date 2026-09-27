/** تفاصيل صف قابل للفتح في أي جدول: حقائق قصيرة، وجدول مصغّر، وإجمالي، ورابط للصفحة الكاملة */
export type DetailCell = { text: string; num?: boolean; href?: string; tone?: "neg" | "pos" | "muted" };

export type Detail = {
  facts?: { label: string; value: string; num?: boolean }[];
  columns: string[];
  rows: DetailCell[][];
  totals?: DetailCell[];
  empty?: string;
  link?: { href: string; label: string };
};

export type DetailKind = "journal" | "invoice" | "voucher" | "bill" | "purchase-order" | "folio" | "reservation" | "account" | "customer" | "vendor";

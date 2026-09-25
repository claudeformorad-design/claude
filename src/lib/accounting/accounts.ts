/**
 * منطق دليل الحسابات (مستقل عن قاعدة البيانات والواجهة).
 * القواعد هنا مطابقة للقيود المفروضة في قاعدة البيانات (الترحيل 2)،
 * وتُستخدم في الواجهة لإعطاء المستخدم رسائل خطأ مبكرة وواضحة.
 */
export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_SUBTYPES = {
  asset: ["current_asset", "fixed_asset", "other_asset"],
  liability: ["current_liability", "long_term_liability"],
  equity: ["equity"],
  revenue: ["operating_revenue", "other_revenue"],
  expense: ["cost_of_sales", "operating_expense", "administrative_expense", "other_expense"],
} as const satisfies Record<AccountType, readonly string[]>;

export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[AccountType][number];
export const ALL_ACCOUNT_SUBTYPES = Object.values(ACCOUNT_SUBTYPES).flat() as AccountSubtype[];

export type BalanceSide = "debit" | "credit";

/** الطبيعة الافتراضية: الأصول والمصروفات مدينة؛ الخصوم وحقوق الملكية والإيرادات دائنة */
export function normalBalance(type: AccountType): BalanceSide {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

/** حسابات قائمة الدخل تُقفل سنويًا في الأرباح المبقاة؛ حسابات الميزانية تُرحّل أرصدتها */
export function isIncomeStatementAccount(type: AccountType): boolean {
  return type === "revenue" || type === "expense";
}

export function subtypeMatchesType(type: AccountType, subtype: string): subtype is AccountSubtype {
  return (ACCOUNT_SUBTYPES[type] as readonly string[]).includes(subtype);
}

export const ACCOUNT_CODE_PATTERN = /^[0-9]{1,12}$/;

export interface AccountNodeInput {
  id: string;
  code: string;
  parent_id: string | null;
  account_type: AccountType;
  is_postable: boolean;
}

export type AccountTreeNode<T extends AccountNodeInput> = T & {
  depth: number;
  children: AccountTreeNode<T>[];
};

/** بناء شجرة الحسابات من قائمة مسطحة، مرتبة حسب الرمز في كل مستوى */
export function buildAccountTree<T extends AccountNodeInput>(accounts: readonly T[]): AccountTreeNode<T>[] {
  const nodes = new Map<string, AccountTreeNode<T>>();
  for (const a of accounts) nodes.set(a.id, { ...a, depth: 0, children: [] });

  const roots: AccountTreeNode<T>[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortAndDepth = (list: AccountTreeNode<T>[], depth: number) => {
    list.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: false }));
    for (const n of list) {
      n.depth = depth;
      sortAndDepth(n.children, depth + 1);
    }
  };
  sortAndDepth(roots, 0);
  return roots;
}

/** تسطيح الشجرة بترتيب العرض (أب ثم أبناؤه) */
export function flattenAccountTree<T extends AccountNodeInput>(roots: AccountTreeNode<T>[]): AccountTreeNode<T>[] {
  const out: AccountTreeNode<T>[] = [];
  const walk = (list: AccountTreeNode<T>[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

export type AccountPlacementError =
  | "parent_not_found"
  | "parent_is_postable"
  | "type_mismatch"
  | "circular_reference";

/**
 * التحقق من إمكانية وضع حساب تحت أب معين:
 *  - الأب موجود وتجميعي (غير قابل للترحيل)
 *  - نفس نوع الحساب
 *  - لا حلقات (الأب ليس الحساب نفسه ولا أحد أحفاده)
 */
export function validateAccountPlacement(
  account: { id?: string; account_type: AccountType },
  parentId: string | null,
  accounts: readonly AccountNodeInput[],
): AccountPlacementError | null {
  if (!parentId) return null;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const parent = byId.get(parentId);
  if (!parent) return "parent_not_found";
  if (parent.account_type !== account.account_type) return "type_mismatch";
  if (parent.is_postable) return "parent_is_postable";

  if (account.id) {
    let cursor: AccountNodeInput | undefined = parent;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor.id === account.id || seen.has(cursor.id)) return "circular_reference";
      seen.add(cursor.id);
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
    }
  }
  return null;
}

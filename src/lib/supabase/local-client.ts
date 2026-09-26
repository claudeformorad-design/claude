import { getMockStore, saveMockStore, DEMO_HOTEL_ID, DEMO_USER_ID, type MockStoreData } from "./mock-data";
import type { Database } from "./database.types";
import type { User } from "@supabase/supabase-js";

export const LOCAL_DEMO_USER: User = {
  id: DEMO_USER_ID,
  app_metadata: {},
  user_metadata: { full_name: "المدير المالي — عبد الرحمن العتيبي" },
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00Z",
  email: "admin@hotel.com",
  phone: "+966500000001",
  role: "authenticated",
  updated_at: "2026-01-01T00:00:00Z",
};

type TableName = keyof Database["public"]["Tables"] | keyof Database["public"]["Views"] | "folio_balances" | "journal_entry_totals" | "charge_code_taxes" | "credit_notes" | "inventory_movements" | "audit_log_view";

interface FilterOp {
  col: string;
  op: "eq" | "neq" | "in" | "gte" | "lte" | "ilike";
  val: unknown;
}

class MockQueryBuilder {
  private tableName: string;
  private filters: FilterOp[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitNum: number | null = null;
  private rangeStart = 0;
  private rangeEnd: number | null = null;
  private isSingle = false;
  private isMaybeSingle = false;
  private operation: "select" | "insert" | "update" | "delete" = "select";
  private insertData: unknown = null;
  private updateData: unknown = null;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  select() {
    if (this.operation !== "insert" && this.operation !== "delete") {
      this.operation = "select";
    }
    return this;
  }

  insert(data: unknown) {
    this.operation = "insert";
    this.insertData = data;
    return this;
  }

  update(data: unknown) {
    this.operation = "update";
    this.updateData = data;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push({ col, op: "eq", val });
    return this;
  }

  neq(col: string, val: unknown) {
    this.filters.push({ col, op: "neq", val });
    return this;
  }

  in(col: string, val: unknown[]) {
    this.filters.push({ col, op: "in", val });
    return this;
  }

  gte(col: string, val: unknown) {
    this.filters.push({ col, op: "gte", val });
    return this;
  }

  lte(col: string, val: unknown) {
    this.filters.push({ col, op: "lte", val });
    return this;
  }

  is(col: string, val: unknown) {
    this.filters.push({ col, op: "eq", val });
    return this;
  }

  or() {
    // simplified text search fallback
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }

  range(from: number, to: number) {
    this.rangeStart = from;
    this.rangeEnd = to;
    return this;
  }

  limit(n: number) {
    this.limitNum = n;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  // Promise interface
  then(resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.execute()).then(resolve as never, reject as never);
  }

  private getCollection(): Record<string, unknown>[] {
    const store = getMockStore() as unknown as Record<string, Record<string, unknown>[]>;
    const aliasMap: Record<string, keyof MockStoreData> = {
      audit_log_view: "audit_logs",
    };
    const key = aliasMap[this.tableName] ?? (this.tableName as keyof MockStoreData);
    if (!store[key as string]) {
      store[key as string] = [];
    }
    return store[key as string]!;
  }

  private execute() {
    const collection = this.getCollection();

    if (this.operation === "insert") {
      const records = Array.isArray(this.insertData) ? this.insertData : [this.insertData];
      const inserted: Record<string, unknown>[] = [];
      for (const rec of records) {
        const item = {
          id: rec.id || `id_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          created_at: new Date().toISOString(),
          ...rec,
        };
        collection.push(item);
        inserted.push(item);
      }
      saveMockStore(getMockStore());
      return {
        data: this.isSingle ? inserted[0] : inserted,
        error: null,
      };
    }

    if (this.operation === "update") {
      let updatedCount = 0;
      const updatedList: Record<string, unknown>[] = [];
      for (const row of collection) {
        if (this.matchRow(row)) {
          Object.assign(row, this.updateData, { updated_at: new Date().toISOString() });
          updatedList.push(row);
          updatedCount++;
        }
      }
      saveMockStore(getMockStore());
      return {
        data: this.isSingle ? updatedList[0] ?? null : updatedList,
        error: null,
        count: updatedCount,
      };
    }

    if (this.operation === "delete") {
      const remaining: Record<string, unknown>[] = [];
      const deleted: Record<string, unknown>[] = [];
      for (const row of collection) {
        if (this.matchRow(row)) {
          deleted.push(row);
        } else {
          remaining.push(row);
        }
      }
      const store = getMockStore() as unknown as Record<string, Record<string, unknown>[]>;
      store[this.tableName] = remaining;
      saveMockStore(store as unknown as MockStoreData);
      return {
        data: deleted,
        error: null,
      };
    }

    // SELECT
    let rows = collection.filter((r) => this.matchRow(r));

    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      rows = [...rows].sort((a, b) => {
        const va = a[col];
        const vb = b[col];
        if (va === vb) return 0;
        if (va == null) return asc ? -1 : 1;
        if (vb == null) return asc ? 1 : -1;
        return (va < vb ? -1 : 1) * (asc ? 1 : -1);
      });
    }

    if (this.rangeEnd !== null) {
      rows = rows.slice(this.rangeStart, this.rangeEnd + 1);
    } else if (this.limitNum !== null) {
      rows = rows.slice(0, this.limitNum);
    }

    if (this.isSingle) {
      return {
        data: rows[0] ?? null,
        error: rows[0] ? null : { message: "Row not found" },
      };
    }

    if (this.isMaybeSingle) {
      return {
        data: rows[0] ?? null,
        error: null,
      };
    }

    return {
      data: rows,
      error: null,
      count: rows.length,
    };
  }

  private matchRow(row: Record<string, unknown>): boolean {
    for (const f of this.filters) {
      const val = row[f.col];
      switch (f.op) {
        case "eq":
          if (val !== f.val && String(val) !== String(f.val)) return false;
          break;
        case "neq":
          if (val === f.val || String(val) === String(f.val)) return false;
          break;
        case "in":
          if (!Array.isArray(f.val) || !f.val.map(String).includes(String(val))) return false;
          break;
        case "gte":
          if (val == null || (val as string | number) < (f.val as string | number)) return false;
          break;
        case "lte":
          if (val == null || (val as string | number) > (f.val as string | number)) return false;
          break;
      }
    }
    return true;
  }
}

export function createLocalSupabaseClient() {
  const store = getMockStore();

  return {
    auth: {
      async getUser() {
        return { data: { user: LOCAL_DEMO_USER }, error: null };
      },
      async getSession() {
        return {
          data: { session: { user: LOCAL_DEMO_USER, access_token: "mock_jwt" } },
          error: null,
        };
      },
      async signInWithPassword() {
        return { data: { user: LOCAL_DEMO_USER, session: {} }, error: null };
      },
      async signUp() {
        return { data: { user: LOCAL_DEMO_USER, session: {} }, error: null };
      },
      async signOut() {
        return { error: null };
      },
    },

    from(tableName: TableName | string) {
      return new MockQueryBuilder(tableName);
    },

    rpc(fnName: string, args: Record<string, unknown> = {}) {
      const execute = () => {
        switch (fnName) {
          case "my_permissions": {
            return {
              data: store.permissions.map((p) => p.code),
              error: null,
            };
          }

          case "hotel_members_overview": {
            return {
              data: [
                {
                  user_id: DEMO_USER_ID,
                  full_name: "المدير المالي — عبد الرحمن العتيبي",
                  email: "admin@hotel.com",
                  is_active: true,
                  role_ids: ["role_gm"],
                },
              ],
              error: null,
            };
          }

          case "department_profitability": {
            const map = new Map<string, { revenue: number; expense: number }>();
            store.journal_entries.forEach((e) => {
              if (e.status === "posted") {
                store.journal_entry_lines.forEach((l) => {
                  const deptId = String(l.department_id || "");
                  const accId = String(l.account_id || "");
                  if (l.journal_entry_id === e.id && deptId) {
                    const acc = store.chart_of_accounts.find((a) => a.id === accId);
                    const curr = map.get(deptId) || { revenue: 0, expense: 0 };
                    if (acc?.account_type === "revenue") {
                      curr.revenue += Number(l.credit || 0) - Number(l.debit || 0);
                    } else if (acc?.account_type === "expense") {
                      curr.expense += Number(l.debit || 0) - Number(l.credit || 0);
                    }
                    map.set(deptId, curr);
                  }
                });
              }
            });
            store.folio_transactions.forEach((ft) => {
              const deptId = String(ft.department_id || "");
              if (ft.txn_type === "charge" && deptId) {
                const curr = map.get(deptId) || { revenue: 0, expense: 0 };
                curr.revenue += Number(ft.net_amount || 0);
                map.set(deptId, curr);
              }
            });
            const data: Array<{ department_id: string; account_type: string; account_subtype: string; amount: string }> = [];
            map.forEach((val, deptId) => {
              if (val.revenue > 0) {
                data.push({ department_id: deptId, account_type: "revenue", account_subtype: "operating_revenue", amount: val.revenue.toFixed(2) });
              }
              if (val.expense > 0) {
                data.push({ department_id: deptId, account_type: "expense", account_subtype: "operating_expense", amount: val.expense.toFixed(2) });
              }
            });
            return { data, error: null };
          }

          case "cash_balance": {
            let sum = 0;
            store.payments.forEach((p) => {
              if (p.status === "posted") {
                if (p.voucher_type === "receipt") sum += Number(p.amount || 0);
                else sum -= Number(p.amount || 0);
              }
            });
            store.folio_transactions.forEach((ft) => {
              if (ft.txn_type === "payment") sum += Number(ft.total_amount || 0);
            });
            return { data: sum.toFixed(2), error: null };
          }

          case "gl_account_activity": {
            const accountTotals = new Map<string, { debit: number; credit: number }>();
            store.journal_entries.forEach((e) => {
              if (e.status === "posted") {
                store.journal_entry_lines.forEach((l) => {
                  const accId = String(l.account_id || "");
                  if (l.journal_entry_id === e.id && accId) {
                    const curr = accountTotals.get(accId) || { debit: 0, credit: 0 };
                    curr.debit += Number(l.debit || 0);
                    curr.credit += Number(l.credit || 0);
                    accountTotals.set(accId, curr);
                  }
                });
              }
            });
            const data = store.chart_of_accounts.map((a) => {
              const accId = String(a.id || "");
              const tot = accountTotals.get(accId) || { debit: 0, credit: 0 };
              return {
                account_id: accId,
                prior_years_debit: "0.00",
                prior_years_credit: "0.00",
                ytd_before_debit: "0.00",
                ytd_before_credit: "0.00",
                period_debit: tot.debit.toFixed(2),
                period_credit: tot.credit.toFixed(2),
              };
            });
            return { data, error: null };
          }

          case "cash_flow_lines": {
            const lines: Array<{ activity: string; account_id: string; amount: string }> = [];
            store.journal_entries.forEach((e) => {
              if (e.status === "posted") {
                store.journal_entry_lines.forEach((l) => {
                  const accId = String(l.account_id || "");
                  if (l.journal_entry_id === e.id && accId) {
                    const amt = Number(l.debit || 0) - Number(l.credit || 0);
                    if (amt !== 0) {
                      lines.push({ activity: "operating", account_id: accId, amount: amt.toFixed(2) });
                    }
                  }
                });
              }
            });
            return { data: lines, error: null };
          }

          case "aging_report": {
            const isRec = args.p_kind === "receivable";
            if (isRec) {
              const data = store.invoices
                .filter((inv) => inv.status !== "paid" && inv.status !== "voided")
                .map((inv) => ({
                  party_id: String(inv.customer_id || "cust_direct"),
                  party_name: String(inv.bill_to_name || "عميل"),
                  document_id: String(inv.id),
                  document_number: String(inv.invoice_number || ""),
                  document_date: String(inv.issue_date || ""),
                  due_date: String(inv.due_date || inv.issue_date || ""),
                  outstanding: String(Number(inv.total) - Number(inv.amount_paid || 0)),
                  days_overdue: 0,
                  bucket: "current",
                }));
              return { data, error: null };
            } else {
              const data = store.vendor_bills
                .filter((b) => b.status !== "paid" && b.status !== "voided")
                .map((b) => ({
                  party_id: String(b.vendor_id || ""),
                  party_name: String(store.vendors.find((v) => v.id === b.vendor_id)?.name_ar || "مورد"),
                  document_id: String(b.id),
                  document_number: String(b.bill_number || ""),
                  document_date: String(b.bill_date || ""),
                  due_date: String(b.due_date || ""),
                  outstanding: String(Number(b.total) - Number(b.amount_paid || 0)),
                  days_overdue: 0,
                  bucket: "current",
                }));
              return { data, error: null };
            }
          }

          case "save_journal_entry": {
            const entryId = (args.p_entry_id as string) || `jv_${Date.now()}`;
            const existing = store.journal_entries.find((e) => e.id === entryId);
            const entry = existing || {
              id: entryId,
              hotel_id: DEMO_HOTEL_ID,
              entry_number: args.p_post ? `JV-2026-${String(store.journal_entries.length + 1).padStart(4, "0")}` : null,
              entry_date: (args.p_entry_date as string) || new Date().toISOString().slice(0, 10),
              period_id: "period_2026_09",
              description: (args.p_description as string) || "قيد محاسبي جديد",
              reference: (args.p_reference as string) || null,
              source: "manual",
              source_id: null,
              currency_code: (args.p_currency_code as string) || "SAR",
              exchange_rate: (args.p_exchange_rate as string) || "1.0000",
              status: args.p_post ? "posted" : "draft",
              posted_at: args.p_post ? new Date().toISOString() : null,
              posted_by: args.p_post ? DEMO_USER_ID : null,
              reversal_of_id: null,
              reversed_by_id: null,
              created_at: new Date().toISOString(),
              created_by: DEMO_USER_ID,
              updated_at: new Date().toISOString(),
              updated_by: null,
            };

            if (!existing) store.journal_entries.unshift(entry);

            // lines
            const lines = (args.p_lines as Array<Record<string, unknown>>) || [];
            store.journal_entry_lines = store.journal_entry_lines.filter((l) => l.journal_entry_id !== entryId);
            lines.forEach((l, idx) => {
              store.journal_entry_lines.push({
                id: `jl_${Date.now()}_${idx}`,
                journal_entry_id: entryId,
                hotel_id: DEMO_HOTEL_ID,
                line_no: idx + 1,
                account_id: l.account_id as string,
                department_id: (l.department_id as string) || null,
                description: (l.description as string) || null,
                debit: String(l.debit || "0.00"),
                credit: String(l.credit || "0.00"),
                base_debit: String(l.debit || "0.00"),
                base_credit: String(l.credit || "0.00"),
                created_at: new Date().toISOString(),
              });
            });

            return { data: entryId, error: null };
          }

          case "post_journal_entry": {
            const entry = store.journal_entries.find((e) => e.id === args.p_entry_id);
            if (entry) {
              entry.status = "posted";
              entry.entry_number = `JV-2026-${String(store.journal_entries.length + 1).padStart(4, "0")}`;
              entry.posted_at = new Date().toISOString();
              entry.posted_by = DEMO_USER_ID;
            }
            return { data: args.p_entry_id, error: null };
          }

          case "reverse_journal_entry": {
            const entry = store.journal_entries.find((e) => e.id === args.p_entry_id);
            const revId = `jv_rev_${Date.now()}`;
            if (entry) {
              const revEntry = {
                ...entry,
                id: revId,
                entry_number: `REV-${entry.entry_number ?? "001"}`,
                description: `عكس القيد: ${entry.description}`,
                reversal_of_id: entry.id,
                reversed_by_id: null,
                status: "posted",
                posted_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
              };
              entry.reversed_by_id = revId;
              store.journal_entries.unshift(revEntry);
            }
            return { data: revId, error: null };
          }

          case "open_folio": {
            const id = `fol_${Date.now()}`;
            const num = `FOL-2026-${String(store.guest_folios.length + 1).padStart(3, "0")}`;
            store.guest_folios.unshift({
              id,
              hotel_id: DEMO_HOTEL_ID,
              folio_number: num,
              guest_name: args.p_guest_name as string,
              room_number: (args.p_room_number as string) || null,
              folio_type: "guest",
              status: "open",
              arrival_date: (args.p_arrival_date as string) || new Date().toISOString().slice(0, 10),
              departure_date: (args.p_departure_date as string) || null,
              reservation_ref: (args.p_reservation_ref as string) || null,
              customer_id: (args.p_customer_id as string) || null,
              adults: (args.p_adults as number) || 1,
              master_folio_id: (args.p_master_folio_id as string) || null,
              notes: (args.p_notes as string) || null,
              created_at: new Date().toISOString(),
              created_by: DEMO_USER_ID,
              updated_at: new Date().toISOString(),
              updated_by: null,
              closed_at: null,
              closed_by: null,
            });
            store.folio_balances.push({ folio_id: id, balance: "0.00", deposit_balance: "0.00" });
            return { data: id, error: null };
          }

          case "post_folio_charge": {
            const fid = args.p_folio_id as string;
            const price = Number(args.p_unit_price || 0) * Number(args.p_quantity || 1);
            const tax = price * 0.15;
            const total = (price + tax).toFixed(2);
            store.folio_transactions.push({
              id: `ftxn_${Date.now()}`,
              hotel_id: DEMO_HOTEL_ID,
              folio_id: fid,
              txn_type: "charge",
              direction: 1,
              business_date: new Date().toISOString().slice(0, 10),
              charge_code_id: (args.p_charge_code_id as string) || null,
              payment_method_id: null,
              department_id: "dept_rooms",
              customer_id: null,
              description: (args.p_description as string) || "بند رسوم إقامة",
              reference: (args.p_reference as string) || null,
              quantity: String(args.p_quantity || "1"),
              unit_price: String(args.p_unit_price || "0"),
              net_amount: price.toFixed(2),
              tax_amount: tax.toFixed(2),
              total_amount: total,
              ledger_effect: total,
              deposit_effect: "0.00",
              related_transaction_id: null,
              counter_folio_id: null,
              voided_by_id: null,
              journal_entry_id: null,
              created_at: new Date().toISOString(),
              created_by: DEMO_USER_ID,
            });
            const b = store.folio_balances.find((x) => x.folio_id === fid);
            if (b) b.balance = (Number(b.balance) + Number(total)).toFixed(2);
            return { data: "ok", error: null };
          }

          case "post_folio_payment": {
            const fid = args.p_folio_id as string;
            const amt = Number(args.p_amount || 0);
            store.folio_transactions.push({
              id: `ftxn_${Date.now()}`,
              hotel_id: DEMO_HOTEL_ID,
              folio_id: fid,
              txn_type: "payment",
              direction: 1,
              business_date: new Date().toISOString().slice(0, 10),
              charge_code_id: null,
              payment_method_id: (args.p_payment_method_id as string) || null,
              department_id: null,
              customer_id: (args.p_customer_id as string) || null,
              description: "دفعة سداد من النزيل",
              reference: (args.p_reference as string) || null,
              quantity: "1",
              unit_price: amt.toFixed(2),
              net_amount: amt.toFixed(2),
              tax_amount: "0.00",
              total_amount: amt.toFixed(2),
              ledger_effect: (-amt).toFixed(2),
              deposit_effect: "0.00",
              related_transaction_id: null,
              counter_folio_id: null,
              voided_by_id: null,
              journal_entry_id: null,
              created_at: new Date().toISOString(),
              created_by: DEMO_USER_ID,
            });
            const b = store.folio_balances.find((x) => x.folio_id === fid);
            if (b) b.balance = (Number(b.balance) - amt).toFixed(2);
            return { data: "ok", error: null };
          }

          case "post_folio_deposit": {
            const fid = args.p_folio_id as string;
            const amt = Number(args.p_amount || 0);
            const b = store.folio_balances.find((x) => x.folio_id === fid);
            if (b) b.deposit_balance = (Number(b.deposit_balance) + amt).toFixed(2);
            return { data: "ok", error: null };
          }

          case "checkout_folio": {
            const f = store.guest_folios.find((x) => x.id === args.p_folio_id);
            if (f) {
              f.status = "closed";
              f.closed_at = new Date().toISOString();
            }
            return { data: "inv_01", error: null };
          }

          case "create_direct_invoice": {
            const id = `inv_${Date.now()}`;
            store.invoices.unshift({
              id,
              hotel_id: DEMO_HOTEL_ID,
              invoice_number: `INV-2026-${String(store.invoices.length + 1).padStart(3, "0")}`,
              invoice_type: "direct",
              folio_id: null,
              customer_id: (args.p_customer_id as string) || null,
              bill_to_name: (args.p_bill_to_name as string) || "عميل مباشر",
              bill_to_tax_number: (args.p_bill_to_tax_number as string) || null,
              bill_to_address: (args.p_bill_to_address as string) || null,
              issue_date: (args.p_issue_date as string) || new Date().toISOString().slice(0, 10),
              due_date: (args.p_due_date as string) || null,
              currency_code: "SAR",
              subtotal: "1000.00",
              tax_total: "150.00",
              total: "1150.00",
              amount_due: "1150.00",
              amount_paid: "0.00",
              status: "issued",
              journal_entry_id: null,
              notes: (args.p_notes as string) || null,
              created_at: new Date().toISOString(),
              created_by: DEMO_USER_ID,
              updated_at: new Date().toISOString(),
            });
            return { data: id, error: null };
          }

          case "create_payment_voucher": {
            const id = `pay_${Date.now()}`;
            store.payments.unshift({
              id,
              hotel_id: DEMO_HOTEL_ID,
              voucher_number: `${args.p_voucher_type === "receipt" ? "RV" : "PV"}-2026-${String(store.payments.length + 1).padStart(3, "0")}`,
              voucher_type: (args.p_voucher_type as "receipt" | "disbursement") || "receipt",
              party_type: (args.p_party_type as "customer" | "account") || "customer",
              payment_date: (args.p_payment_date as string) || new Date().toISOString().slice(0, 10),
              payment_method_id: (args.p_payment_method_id as string) || "pm_cash",
              amount: String(args.p_amount || "0"),
              customer_id: (args.p_customer_id as string) || null,
              counter_account_id: (args.p_counter_account_id as string) || null,
              department_id: (args.p_department_id as string) || null,
              party_name: (args.p_party_name as string) || "الطرف المعني",
              reference: (args.p_reference as string) || null,
              description: (args.p_description as string) || "سند دفع/قبض",
              status: "posted",
              journal_entry_id: null,
              void_reason: null,
              voided_at: null,
              voided_by: null,
              void_journal_entry_id: null,
              created_at: new Date().toISOString(),
              created_by: DEMO_USER_ID,
            });
            return { data: id, error: null };
          }

          case "create_purchase_order": {
            const id = `po_${Date.now()}`;
            store.purchase_orders.unshift({
              id,
              hotel_id: DEMO_HOTEL_ID,
              po_number: `PO-2026-${String(store.purchase_orders.length + 1).padStart(3, "0")}`,
              vendor_id: (args.p_vendor_id as string) || "vnd_food",
              order_date: (args.p_order_date as string) || new Date().toISOString().slice(0, 10),
              status: "open",
              notes: (args.p_notes as string) || null,
              created_at: new Date().toISOString(),
              created_by: DEMO_USER_ID,
            });
            return { data: id, error: null };
          }

          case "create_vendor_bill": {
            const id = `bill_${Date.now()}`;
            store.vendor_bills.unshift({
              id,
              hotel_id: DEMO_HOTEL_ID,
              bill_number: `BILL-2026-${String(store.vendor_bills.length + 1).padStart(3, "0")}`,
              vendor_id: (args.p_vendor_id as string) || "vnd_food",
              vendor_invoice_no: (args.p_vendor_invoice_no as string) || null,
              po_id: (args.p_po_id as string) || null,
              bill_date: (args.p_bill_date as string) || new Date().toISOString().slice(0, 10),
              due_date: (args.p_due_date as string) || new Date().toISOString().slice(0, 10),
              subtotal: "5000.00",
              tax_total: "750.00",
              total: "5750.00",
              amount_paid: "0.00",
              status: "open",
              journal_entry_id: null,
              notes: (args.p_notes as string) || null,
              created_at: new Date().toISOString(),
              created_by: DEMO_USER_ID,
            });
            return { data: id, error: null };
          }

          case "register_fixed_asset": {
            const id = `ast_${Date.now()}`;
            store.fixed_assets.unshift({
              id,
              hotel_id: DEMO_HOTEL_ID,
              asset_number: `AST-2026-${String(store.fixed_assets.length + 1).padStart(3, "0")}`,
              name: args.p_name as string,
              category: args.p_category as string,
              asset_account_id: args.p_asset_account_id as string,
              department_id: (args.p_department_id as string) || null,
              acquisition_date: args.p_acquisition_date as string,
              cost: String(args.p_cost || "0"),
              salvage_value: String(args.p_salvage_value || "0"),
              useful_life_months: Number(args.p_useful_life_months || 60),
              depreciation_start: args.p_acquisition_date as string,
              accumulated_depreciation: "0.00",
              status: "active",
              vendor_bill_id: null,
              journal_entry_id: null,
              disposal_date: null,
              disposal_proceeds: null,
              disposal_journal_entry_id: null,
              notes: (args.p_notes as string) || null,
              created_at: new Date().toISOString(),
              created_by: DEMO_USER_ID,
            });
            return { data: id, error: null };
          }

          case "run_depreciation": {
            return { data: store.fixed_assets.length, error: null };
          }

          case "room_statistics": {
            const dateMap = new Map<string, { room_nights: number; room_revenue: number }>();
            store.folio_transactions.forEach((ft) => {
              if (ft.txn_type === "charge") {
                const dt = String(ft.business_date || new Date().toISOString().slice(0, 10));
                const curr = dateMap.get(dt) || { room_nights: 0, room_revenue: 0 };
                curr.room_revenue += Number(ft.total_amount || 0);
                curr.room_nights += Number(ft.quantity || 1);
                dateMap.set(dt, curr);
              }
            });
            const data = Array.from(dateMap.entries()).map(([business_date, val]) => ({
              business_date,
              room_nights: String(val.room_nights),
              room_revenue: val.room_revenue.toFixed(2),
              rooms_available: Number(store.hotels[0]?.total_rooms || 120),
            }));
            return { data, error: null };
          }

          case "monthly_pnl": {
            const monthMap = new Map<string, { revenue: number; expenses: number }>();
            store.journal_entries.forEach((e) => {
              if (e.status === "posted") {
                const entryDateStr = String(e.entry_date || "");
                const m = entryDateStr.slice(0, 7) + "-01";
                if (!m.startsWith("20")) return;
                const curr = monthMap.get(m) || { revenue: 0, expenses: 0 };
                store.journal_entry_lines.forEach((l) => {
                  if (l.journal_entry_id === e.id) {
                    const accId = String(l.account_id || "");
                    const acc = store.chart_of_accounts.find((a) => a.id === accId);
                    if (acc?.account_type === "revenue") {
                      curr.revenue += Number(l.credit || 0) - Number(l.debit || 0);
                    } else if (acc?.account_type === "expense") {
                      curr.expenses += Number(l.debit || 0) - Number(l.credit || 0);
                    }
                  }
                });
                monthMap.set(m, curr);
              }
            });
            store.folio_transactions.forEach((ft) => {
              if (ft.txn_type === "charge") {
                const bDateStr = String(ft.business_date || "");
                const m = bDateStr.slice(0, 7) + "-01";
                if (!m.startsWith("20")) return;
                const curr = monthMap.get(m) || { revenue: 0, expenses: 0 };
                curr.revenue += Number(ft.net_amount || 0);
                monthMap.set(m, curr);
              }
            });
            const data = Array.from(monthMap.entries()).map(([month, val]) => ({
              month,
              revenue: val.revenue.toFixed(2),
              expenses: val.expenses.toFixed(2),
            }));
            return { data, error: null };
          }

          case "daily_cash_report": {
            const methodMap = new Map<string, { receipts: number; payments: number; name: string; source: "folio" | "voucher" }>();
            store.payments.forEach((p) => {
              if (p.status === "posted" && p.payment_date === args.p_date) {
                const mid = String(p.payment_method_id || "pm_cash");
                const mName = String(store.payment_methods.find((m) => m.id === mid)?.name_ar || "وسيلة دفع");
                const curr = methodMap.get(mid) || { receipts: 0, payments: 0, name: mName, source: "voucher" };
                if (p.voucher_type === "receipt") curr.receipts += Number(p.amount || 0);
                else curr.payments += Number(p.amount || 0);
                methodMap.set(mid, curr);
              }
            });
            const data = Array.from(methodMap.entries()).map(([payment_method_id, val]) => ({
              payment_method_id,
              method_name: val.name,
              source: val.source,
              receipts: val.receipts.toFixed(2),
              payments: val.payments.toFixed(2),
            }));
            return { data, error: null };
          }

          case "tax_return": {
            let sales = 0, salesTax = 0, purchases = 0, purchasesTax = 0;
            store.invoices.forEach((inv) => {
              if (inv.status !== "voided") {
                sales += Number(inv.subtotal || 0);
                salesTax += Number(inv.tax_total || 0);
              }
            });
            store.vendor_bills.forEach((b) => {
              if (b.status !== "voided") {
                purchases += Number(b.subtotal || 0);
                purchasesTax += Number(b.tax_total || 0);
              }
            });
            return {
              data: {
                standard_sales: sales.toFixed(2),
                standard_sales_tax: salesTax.toFixed(2),
                zero_rated_sales: "0.00",
                exempt_sales: "0.00",
                total_sales: sales.toFixed(2),
                total_sales_tax: salesTax.toFixed(2),
                standard_purchases: purchases.toFixed(2),
                standard_purchases_tax: purchasesTax.toFixed(2),
                zero_rated_purchases: "0.00",
                exempt_purchases: "0.00",
                total_purchases: purchases.toFixed(2),
                total_purchases_tax: purchasesTax.toFixed(2),
                net_tax: (salesTax - purchasesTax).toFixed(2),
              },
              error: null,
            };
          }

          case "pay_vendor": {
            const bill = store.vendor_bills.find((b) => b.id === args.p_bill_id);
            if (bill) {
              bill.amount_paid = bill.total;
              bill.status = "paid";
            }
            return { data: `pay_${Date.now()}`, error: null };
          }

          case "post_payroll": {
            return { data: `jv_pay_${Date.now()}`, error: null };
          }

          case "create_credit_note": {
            return { data: `cn_${Date.now()}`, error: null };
          }

          case "auto_match_bank_lines": {
            return { data: { matched: 3, total: 3 }, error: null };
          }

          case "add_hotel_member": {
            return { data: "ok", error: null };
          }

          case "close_fiscal_year":
          case "create_fiscal_year":
          case "set_period_status": {
            return { data: "ok", error: null };
          }

          case "dispose_fixed_asset": {
            const ast = store.fixed_assets.find((a) => a.id === args.p_asset_id);
            if (ast) {
              ast.status = "disposed";
              ast.disposal_date = (args.p_disposal_date as string) || new Date().toISOString().slice(0, 10);
            }
            return { data: "ok", error: null };
          }

          case "post_inventory_movement": {
            return { data: `im_${Date.now()}`, error: null };
          }

          case "create_hotel": {
            return { data: DEMO_HOTEL_ID, error: null };
          }

          case "post_folio_allowance":
          case "transfer_folio_balance":
          case "void_folio_transaction":
          case "cancel_folio":
          case "void_payment_voucher": {
            return { data: "ok", error: null };
          }

          default:
            return { data: [], error: null };
        }
      };

      return {
        select: () => Promise.resolve(execute()),
        then: (resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) =>
          Promise.resolve(execute()).then(resolve, reject),
      };
    },
  };
}

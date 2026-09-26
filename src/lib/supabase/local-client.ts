import "server-only";
import type { Transaction } from "@electric-sql/pglite";
import { catalogQuery, withUserTransaction } from "./local-db";

/**
 * عميل متوافق مع واجهة supabase-js (الجزء المستخدم في النظام فقط) يترجم الاستعلامات
 * إلى SQL على قاعدة PGlite المحلية. المخرجات تُبنى بـ json_agg مثل PostgREST تمامًا،
 * فالأرقام والتواريخ تصل بنفس الشكل الذي تصل به من Supabase.
 */

export interface LocalError {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}
interface LocalResult {
  data: unknown;
  error: LocalError | null;
  count: number | null;
  status: number;
  statusText: string;
}

const ident = (name: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
};

function toError(e: unknown): LocalError {
  const err = e as { message?: string; code?: string; detail?: string; hint?: string };
  return { message: err?.message ?? String(e), code: err?.code ?? "", details: err?.detail ?? null, hint: err?.hint ?? null };
}

// ---------------------------------------------------------------------------
// الكتالوج: أنواع الأعمدة وتواقيع الدوال (تخزين مؤقت لكل عملية خادم)
// ---------------------------------------------------------------------------
const columnCache = new Map<string, Map<string, string>>();
async function columnTypes(table: string): Promise<Map<string, string>> {
  let m = columnCache.get(table);
  if (!m) {
    const rows = await catalogQuery<{ name: string; type: string }>(
      `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a where a.attrelid = ('public.' || quote_ident($1))::regclass and a.attnum > 0 and not a.attisdropped`,
      [table],
    );
    if (rows.length === 0) throw Object.assign(new Error(`relation "public.${table}" does not exist`), { code: "42P01" });
    m = new Map(rows.map((r) => [r.name, r.type]));
    columnCache.set(table, m);
  }
  return m;
}

/** علاقة many-to-one (قد تكون مركّبة مثل (hotel_id, journal_entry_id) → (hotel_id, id)) */
interface FkInfo { columns: string[]; refColumns: string[] }
const fkCache = new Map<string, FkInfo>();
async function manyToOne(table: string, rel: string): Promise<FkInfo> {
  const key = `${table}->${rel}`;
  let fk = fkCache.get(key);
  if (!fk) {
    const rows = await catalogQuery<FkInfo>(
      `select array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i)
                     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as columns,
              array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i)
                     join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) as "refColumns"
       from pg_constraint c
       where c.contype = 'f'
         and c.conrelid = ('public.' || quote_ident($1))::regclass and c.confrelid = ('public.' || quote_ident($2))::regclass`,
      [table, rel],
    );
    if (rows.length !== 1) throw new Error(`No unique relationship between ${table} and ${rel}`);
    fk = rows[0]!;
    fkCache.set(key, fk);
  }
  return fk;
}
function joinOn(fk: FkInfo, relAlias: string, alias: string): string {
  return fk.columns.map((c, i) => `${relAlias}.${ident(fk.refColumns[i]!)} = ${alias}.${ident(c)}`).join(" and ");
}

interface FnInfo { argNames: string[]; argTypes: string[]; retSet: boolean; retVoid: boolean; retScalar: boolean }
const fnCache = new Map<string, FnInfo[]>();
async function functionInfo(name: string): Promise<FnInfo[]> {
  let infos = fnCache.get(name);
  if (!infos) {
    const rows = await catalogQuery<{ arg_names: string[] | null; arg_types: string[] | null; retset: boolean; rettype: string; typtype: string; has_out: boolean }>(
      `select coalesce(p.proargnames[1:p.pronargs], '{}') as arg_names,
              (select array_agg(format_type(t, null) order by i) from unnest(p.proargtypes) with ordinality u(t, i)) as arg_types,
              p.proretset as retset, format_type(p.prorettype, null) as rettype, ty.typtype,
              coalesce('t' = any(p.proargmodes::text[]) or 'o' = any(p.proargmodes::text[]), false) as has_out
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type ty on ty.oid = p.prorettype
       where n.nspname = 'public' and p.proname = $1`,
      [name],
    );
    infos = rows.map((r) => ({
      argNames: r.arg_names ?? [],
      // format_type بلا typmod يعيد "character" أي char(1) — نستخدم bpchar حتى لا تُقتطع القيم
      argTypes: (r.arg_types ?? []).map((t) => (t === "character" ? "bpchar" : t === "character[]" ? "bpchar[]" : t)),
      retSet: r.retset,
      retVoid: r.rettype === "void",
      retScalar: !r.has_out && r.typtype !== "c" && r.rettype !== "record",
    }));
    fnCache.set(name, infos);
  }
  return infos;
}

// ---------------------------------------------------------------------------
// تحويل القيم إلى نص وسيط بحسب نوع العمود/الوسيط
// ---------------------------------------------------------------------------
function arrayLiteral(values: unknown[]): string {
  return `{${values
    .map((v) => (v === null || v === undefined ? "NULL" : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`))
    .join(",")}}`;
}
function serialize(value: unknown, type: string | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (type && type.endsWith("[]") && Array.isArray(value)) return arrayLiteral(value);
  if (type === "json" || type === "jsonb") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// تحليل قائمة الأعمدة بصيغة PostgREST: "a, b::text, alias:c, rel!inner(x, y)"
// ---------------------------------------------------------------------------
interface ColumnSpec { kind: "col"; name: string; cast?: string; alias: string }
interface EmbedSpec { kind: "embed"; rel: string; inner: boolean; alias: string; columns: SelectItem[] }
interface StarSpec { kind: "star" }
type SelectItem = ColumnSpec | EmbedSpec | StarSpec;

function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseSelect(input: string): SelectItem[] {
  return splitTopLevel(input.replace(/\s+/g, " ")).map((raw): SelectItem => {
    if (raw === "*") return { kind: "star" };
    const embed = /^(?:([a-zA-Z_][\w]*):)?([a-zA-Z_][\w]*)(!inner)?\s*\((.*)\)$/.exec(raw);
    if (embed) {
      return { kind: "embed", alias: embed[1] ?? embed[2]!, rel: embed[2]!, inner: Boolean(embed[3]), columns: parseSelect(embed[4]!) };
    }
    const col = /^(?:([a-zA-Z_][\w]*):)?([a-zA-Z_][\w]*)(?:::([a-zA-Z_][\w ]*))?$/.exec(raw);
    if (!col) throw new Error(`Unsupported select item: ${raw}`);
    return { kind: "col", alias: col[1] ?? col[2]!, name: col[2]!, cast: col[3]?.trim() };
  });
}

// ---------------------------------------------------------------------------
// بناء SQL
// ---------------------------------------------------------------------------
class Params {
  values: (string | null)[] = [];
  add(value: unknown, type?: string): string {
    this.values.push(serialize(value, type));
    return type ? `$${this.values.length}::${type}` : `$${this.values.length}`;
  }
}

type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "in" | "is";
interface Filter { kind: "op"; column: string; op: FilterOp; value: unknown }
interface OrFilter { kind: "or"; expr: string }

const SQL_OPS: Record<Exclude<FilterOp, "in" | "is" | "like" | "ilike">, string> = {
  eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=",
};

async function selectList(items: SelectItem[], table: string | null, alias: string, params: Params): Promise<string> {
  const parts: string[] = [];
  for (const item of items) {
    if (item.kind === "star") parts.push(`${alias}.*`);
    else if (item.kind === "col") {
      const ref = `${alias}.${ident(item.name)}`;
      parts.push(`${item.cast ? `${ref}::${item.cast}` : ref} as ${ident(item.alias)}`);
    } else {
      if (!table) throw new Error("Embedding is only supported on tables");
      const fk = await manyToOne(table, item.rel);
      const inner = await selectList(item.columns, item.rel, "r", params);
      parts.push(
        `(select row_to_json(e) from (select ${inner} from public.${ident(item.rel)} r where ${joinOn(fk, "r", alias)}) e) as ${ident(item.alias)}`,
      );
    }
  }
  return parts.join(", ") || `${alias}.*`;
}

async function condition(f: Filter, table: string | null, alias: string, params: Params): Promise<string> {
  const dot = f.column.indexOf(".");
  if (dot > 0 && table) {
    // تصفية على جدول مضمَّن: journal_entries.status
    const rel = f.column.slice(0, dot);
    const fk = await manyToOne(table, rel);
    const inner = await condition({ ...f, column: f.column.slice(dot + 1) }, rel, "r2", params);
    return `exists (select 1 from public.${ident(rel)} r2 where ${joinOn(fk, "r2", alias)} and ${inner})`;
  }
  const type = table ? (await columnTypes(table)).get(f.column) : undefined;
  if (table && !type) throw Object.assign(new Error(`column ${table}.${f.column} does not exist`), { code: "42703" });
  const ref = `${alias}.${ident(f.column)}`;
  switch (f.op) {
    case "in": {
      const list = f.value as unknown[];
      if (list.length === 0) return "false";
      return `${ref} in (${list.map((v) => params.add(v, type)).join(", ")})`;
    }
    case "is":
      if (f.value === null) return `${ref} is null`;
      return `${ref} is ${f.value ? "true" : "false"}`;
    case "like":
    case "ilike":
      return `${ref}::text ${f.op} ${params.add(String(f.value).replace(/\*/g, "%"), "text")}`;
    default:
      return `${ref} ${SQL_OPS[f.op]} ${params.add(f.value, type)}`;
  }
}

/** or("a.ilike.%x%,b.eq.1") بصيغة PostgREST */
async function orCondition(expr: string, table: string | null, alias: string, params: Params): Promise<string> {
  const parts: string[] = [];
  for (const piece of splitTopLevel(expr)) {
    const m = /^([a-zA-Z_][\w.]*)\.(eq|neq|gt|gte|lt|lte|like|ilike|is)\.(.*)$/.exec(piece);
    if (!m) throw new Error(`Unsupported or() filter: ${piece}`);
    const op = m[2] as FilterOp;
    const raw = m[3]!;
    const value = op === "is" ? (raw === "null" ? null : raw === "true") : raw;
    parts.push(await condition({ kind: "op", column: m[1]!, op, value }, table, alias, params));
  }
  return parts.length ? `(${parts.join(" or ")})` : "true";
}

// ---------------------------------------------------------------------------
// باني الاستعلام
// ---------------------------------------------------------------------------
type Mode = "select" | "insert" | "update" | "delete" | "rpc";

class LocalQueryBuilder implements PromiseLike<LocalResult> {
  private mode: Mode = "select";
  private columns: string | null = null;
  private returning = false;
  private countExact = false;
  private head = false;
  private filters: (Filter | OrFilter)[] = [];
  private orders: { column: string; ascending: boolean; nullsFirst?: boolean }[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private singleMode: "single" | "maybe" | null = null;
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;

  constructor(private readonly target: string, private readonly rpcArgs?: Record<string, unknown>) {
    if (rpcArgs) this.mode = "rpc";
  }

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.columns = columns;
    if (this.mode !== "select") this.returning = true;
    if (options?.count) this.countExact = true;
    if (options?.head) this.head = true;
    return this;
  }
  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    this.mode = "insert";
    this.payload = values;
    return this;
  }
  update(values: Record<string, unknown>) {
    this.mode = "update";
    this.payload = values;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  private op(column: string, op: FilterOp, value: unknown) {
    this.filters.push({ kind: "op", column, op, value });
    return this;
  }
  eq(c: string, v: unknown) { return this.op(c, "eq", v); }
  neq(c: string, v: unknown) { return this.op(c, "neq", v); }
  gt(c: string, v: unknown) { return this.op(c, "gt", v); }
  gte(c: string, v: unknown) { return this.op(c, "gte", v); }
  lt(c: string, v: unknown) { return this.op(c, "lt", v); }
  lte(c: string, v: unknown) { return this.op(c, "lte", v); }
  like(c: string, v: string) { return this.op(c, "like", v); }
  ilike(c: string, v: string) { return this.op(c, "ilike", v); }
  is(c: string, v: null | boolean) { return this.op(c, "is", v); }
  in(c: string, v: readonly unknown[]) { return this.op(c, "in", [...v]); }
  or(expr: string) {
    this.filters.push({ kind: "or", expr });
    return this;
  }
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true, nullsFirst: options?.nullsFirst });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }
  throwOnError() {
    return this;
  }

  then<R1 = LocalResult, R2 = never>(
    onfulfilled?: ((value: LocalResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async where(alias: string, params: Params, table: string | null): Promise<string> {
    const parts: string[] = [];
    for (const f of this.filters) {
      parts.push(f.kind === "or" ? await orCondition(f.expr, table, alias, params) : await condition(f, table, alias, params));
    }
    return parts.length ? ` where ${parts.join(" and ")}` : "";
  }

  private tail(alias: string): string {
    let sql = "";
    if (this.orders.length) {
      sql += ` order by ${this.orders
        .map((o) => `${alias}.${ident(o.column)} ${o.ascending ? "asc" : "desc"}${o.nullsFirst === undefined ? "" : o.nullsFirst ? " nulls first" : " nulls last"}`)
        .join(", ")}`;
    }
    if (this.limitN !== null) sql += ` limit ${Math.max(0, Math.floor(this.limitN))}`;
    if (this.offsetN !== null) sql += ` offset ${Math.max(0, Math.floor(this.offsetN))}`;
    return sql;
  }

  private async execute(): Promise<LocalResult> {
    try {
      const { rows, count } = await this.run();
      if (this.singleMode) {
        if (rows.length === 1) return ok(rows[0], count);
        if (rows.length === 0 && this.singleMode === "maybe") return ok(null, count);
        return fail({
          message: "JSON object requested, multiple (or no) rows returned",
          code: "PGRST116",
          details: `The result contains ${rows.length} rows`,
          hint: null,
        });
      }
      if (this.mode !== "select" && this.mode !== "rpc" && !this.returning) return ok(null, count);
      return ok(this.head ? null : this.rpcScalar ? this.rpcValue : rows, count);
    } catch (e) {
      return fail(toError(e));
    }
  }

  private rpcScalar = false;
  private rpcValue: unknown = null;

  private async run(): Promise<{ rows: unknown[]; count: number | null }> {
    if (this.mode === "rpc") return this.runRpc();
    const table = this.target;
    const types = await columnTypes(table);
    const items = parseSelect(this.columns ?? "*");
    const params = new Params();
    const t = ident(table);

    let sql: string;
    let countSql: string | null = null;
    if (this.mode === "select") {
      const where = await this.where("t", params, table);
      const list = await selectList(items, table, "t", params);
      sql = `select coalesce(json_agg(v), '[]'::json) as rows from (select ${list} from public.${t} t${where}${this.tail("t")}) v`;
      if (this.countExact) countSql = `select count(*)::int as n from public.${t} t${where}`;
    } else if (this.mode === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined)))];
      for (const k of keys) if (!types.has(k)) throw Object.assign(new Error(`column "${k}" of relation "${table}" does not exist`), { code: "42703" });
      const values = rows.map((r) => `(${keys.map((k) => (r[k] === undefined ? "default" : params.add(r[k], types.get(k)))).join(", ")})`);
      const insert = keys.length
        ? `insert into public.${t} (${keys.map(ident).join(", ")}) values ${values.join(", ")}`
        : `insert into public.${t} default values`;
      sql = this.returning
        ? `with w as (${insert} returning *) select coalesce(json_agg(v), '[]'::json) as rows from (select ${await selectList(items, table, "t", params)} from w t) v`
        : `${insert}`;
    } else if (this.mode === "update") {
      const entries = Object.entries(this.payload ?? {}).filter(([, v]) => v !== undefined);
      for (const [k] of entries) if (!types.has(k)) throw Object.assign(new Error(`column "${k}" of relation "${table}" does not exist`), { code: "42703" });
      const sets = entries.map(([k, v]) => `${ident(k)} = ${params.add(v, types.get(k))}`).join(", ");
      const where = await this.where("t", params, table);
      const update = `update public.${t} t set ${sets}${where}`;
      sql = this.returning
        ? `with w as (${update} returning t.*) select coalesce(json_agg(v), '[]'::json) as rows from (select ${await selectList(items, table, "t", params)} from w t) v`
        : update;
    } else {
      const where = await this.where("t", params, table);
      const del = `delete from public.${t} t${where}`;
      sql = this.returning
        ? `with w as (${del} returning t.*) select coalesce(json_agg(v), '[]'::json) as rows from (select ${await selectList(items, table, "t", params)} from w t) v`
        : del;
    }

    return withUserTransaction(async (tx: Transaction) => {
      let count: number | null = null;
      if (countSql) count = (await tx.query<{ n: number }>(countSql, params.values)).rows[0]?.n ?? 0;
      if (this.head) return { rows: [], count };
      const res = await tx.query<{ rows: unknown[] }>(sql, params.values);
      return { rows: (res.rows[0]?.rows as unknown[] | undefined) ?? [], count };
    });
  }

  private async runRpc(): Promise<{ rows: unknown[]; count: number | null }> {
    const name = this.target;
    const args = Object.fromEntries(Object.entries(this.rpcArgs ?? {}).filter(([, v]) => v !== undefined));
    const candidates = (await functionInfo(name)).filter((f) => Object.keys(args).every((k) => f.argNames.includes(k)));
    if (candidates.length === 0) {
      throw Object.assign(new Error(`Could not find the function public.${name}(${Object.keys(args).join(", ")})`), { code: "PGRST202" });
    }
    // عند وجود أكثر من نسخة للدالة نختار الأقل وسائط (نفس سلوك PostgREST تقريبًا)
    const fn = candidates.sort((a, b) => a.argNames.length - b.argNames.length)[0]!;
    const params = new Params();
    const call = `public.${ident(name)}(${Object.entries(args)
      .map(([k, v]) => `${ident(k)} => ${params.add(v, fn.argTypes[fn.argNames.indexOf(k)])}`)
      .join(", ")})`;

    let sql: string;
    if (fn.retSet && !fn.retScalar) {
      const items = parseSelect(this.columns ?? "*");
      const where = await this.where("f", params, null);
      sql = `select coalesce(json_agg(v), '[]'::json) as rows from (select ${await selectList(items, null, "f", params)} from ${call} f${where}${this.tail("f")}) v`;
    } else if (fn.retSet) {
      sql = `select coalesce(json_agg(f), '[]'::json) as rows from ${call} f`;
    } else if (fn.retVoid) {
      sql = `select ${call}`;
    } else {
      sql = `select to_json(${call}) as value`;
    }

    return withUserTransaction(async (tx: Transaction) => {
      const res = await tx.query<{ rows?: unknown[]; value?: unknown }>(sql, params.values);
      if (fn.retSet) return { rows: (res.rows[0]?.rows as unknown[] | undefined) ?? [], count: null };
      this.rpcScalar = true;
      this.rpcValue = fn.retVoid ? null : (res.rows[0]?.value ?? null);
      return { rows: [this.rpcValue], count: null };
    });
  }
}

function ok(data: unknown, count: number | null): LocalResult {
  return { data, error: null, count, status: 200, statusText: "OK" };
}
function fail(error: LocalError): LocalResult {
  return { data: null, error, count: null, status: 400, statusText: "Bad Request" };
}

/** المستخدم المحلي بصيغة Supabase User */
async function localUser() {
  const { getLocalDb } = await import("./local-db");
  const { userId } = await getLocalDb();
  return {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: "local@localhost",
    app_metadata: {},
    user_metadata: { full_name: "مدير النظام" },
    created_at: new Date(0).toISOString(),
  };
}

export function createLocalSupabaseClient() {
  return {
    from: (table: string) => new LocalQueryBuilder(table),
    rpc: (fn: string, args: Record<string, unknown> = {}) => new LocalQueryBuilder(fn, args),
    auth: {
      getUser: async () => ({ data: { user: await localUser() }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: { user: await localUser(), session: null }, error: null }),
      signUp: async () => ({ data: { user: await localUser(), session: {} }, error: null }),
      signOut: async () => ({ error: null }),
    },
  };
}

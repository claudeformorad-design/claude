"use client";
import { localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import { DASHBOARD_SECTIONS, LIMITS, type LimitKey, PERMISSION_GROUPS } from "@/lib/auth/access-catalog";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/services/errors";
import { saveRoleAction } from "../../_admin/actions";
import {
  addEmployeeAction, enableLoginAction, endSessionsAction, resetPasswordAction, saveMemberAccessAction, saveRoleSettingsAction,
} from "./actions";

const ERRORS: Record<string, string> = {
  get validation() { return tr("تحقق من الحقول المطلوبة"); },
  get permission_denied() { return tr("ليست لديك صلاحية لهذه العملية"); },
  get unknown() { return tr("تعذّر الحفظ، حاول مرة أخرى"); },
};
const field = "field-group space-y-1.5";

export type Option = { id: string; label: string };
export type PermissionItem = { code: string; module: string; label: string };
export type HomeOption = { href: string; label: string };

function useSubmit() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult<unknown>>, done: string, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await callAction(fn());
      if (r.ok) { toast(done); if (after) after(); else router.refresh(); }
      else setError(actionErrorText(ERRORS, r));
    });
  return { pending, error, run, router };
}

// -----------------------------------------------------------------------------
// تفعيل تسجيل الدخول
// -----------------------------------------------------------------------------
export function EnableLogin() {
  const { pending, error, run } = useSubmit();
  const [v, setV] = useState({ username: "", password: "", confirm: "" });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => enableLoginAction(v), tr("تم تفعيل تسجيل الدخول")); }}>
      {error && <Alert variant="destructive">{error}</Alert>}
      <p className="text-[15.5px] text-slate-600">{tr("اختر اسم دخول وكلمة مرور لحسابك أنت، مدير النظام. بعدها تضيف الموظفين بأسمائهم.")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={field}><Label htmlFor="owner_username">{tr("اسم المستخدم")}</Label>
          <Input id="owner_username" dir="ltr" autoCapitalize="none" value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} placeholder="admin" /></div>
        <div className={field}><Label htmlFor="owner_password">{tr("كلمة المرور")}</Label>
          <Input id="owner_password" type="password" dir="ltr" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
        <div className={field}><Label htmlFor="owner_confirm">{tr("تأكيد كلمة المرور")}</Label>
          <Input id="owner_confirm" type="password" dir="ltr" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} /></div>
      </div>
      <Button type="submit" loading={pending}><KeyRound className="size-4" />{tr("تفعيل تسجيل الدخول")}</Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// إضافة موظف
// -----------------------------------------------------------------------------
export function AddEmployee({ local, roles }: { local: boolean; roles: Option[] }) {
  const { pending, error, run, router } = useSubmit();
  const [v, setV] = useState({ full_name: "", username: "", email: "", password: "", role_id: roles.find((r) => r.label.includes("استقبال"))?.id ?? roles[0]?.id ?? "" });
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      run(() => addEmployeeAction(v), tr("تمت إضافة الموظف"), () => { setV({ ...v, full_name: "", username: "", email: "", password: "" }); router.refresh(); });
    }}>
      <p className="font-semibold text-ink">{tr("إضافة موظف")}</p>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {local ? (
          <>
            <div className={field}><Label htmlFor="emp_name">{tr("اسم الموظف")}</Label>
              <Input id="emp_name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></div>
            <div className={field}><Label htmlFor="emp_username">{tr("اسم المستخدم")}</Label>
              <Input id="emp_username" dir="ltr" autoCapitalize="none" value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} /></div>
            <div className={field}><Label htmlFor="emp_password">{tr("كلمة مرور مؤقتة")}</Label>
              <Input id="emp_password" dir="ltr" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
          </>
        ) : (
          <div className={field}><Label htmlFor="emp_email">{tr("البريد الإلكتروني")}</Label>
            <Input id="emp_email" type="email" dir="ltr" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
        )}
        <div className={field}><Label htmlFor="emp_role">{tr("الدور")}</Label>
          <NativeSelect id="emp_role" value={v.role_id} onChange={(e) => setV({ ...v, role_id: e.target.value })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </NativeSelect></div>
      </div>
      {local && <p className="text-[14.5px] text-slate-500">{tr("يغيّر الموظف كلمة المرور المؤقتة عند أول دخول.")}</p>}
      <Button type="submit" loading={pending}>{tr("إضافة الموظف")}</Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// شجرة الصلاحيات: لكل صلاحية «حسب الدور» أو «سماح» أو «منع»
// -----------------------------------------------------------------------------
type Choice = "role" | "allow" | "deny";

function groupsOf(permissions: PermissionItem[]) {
  const order: string[] = [];
  for (const p of permissions) if (!order.includes(p.module)) order.push(p.module);
  return order.map((m) => ({ module: m, title: PERMISSION_GROUPS[m] ?? m, items: permissions.filter((p) => p.module === m) }));
}

function LimitsFields({ value, onChange, inheritLabel, idPrefix }: {
  value: Partial<Record<LimitKey, string>>; onChange: (v: Partial<Record<LimitKey, string>>) => void; inheritLabel: string; idPrefix: string;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {LIMITS.map((l) => (
        <div key={l.key} className={field}>
          <Label htmlFor={`${idPrefix}_${l.key}`}>{l.label}{l.percent ? tr(" بالنسبة المئوية") : ""}</Label>
          <Input id={`${idPrefix}_${l.key}`} inputMode="decimal" dir="ltr" placeholder={inheritLabel} value={value[l.key] ?? ""}
            onChange={(e) => onChange({ ...value, [l.key]: e.target.value })} />
          <p className="text-[13.5px] text-slate-500">{l.hint}</p>
        </div>
      ))}
    </div>
  );
}

const toLimits = (v: Partial<Record<LimitKey, string>>) =>
  Object.fromEntries(LIMITS.map((l) => [l.key, v[l.key]?.trim() ? Number(v[l.key]) : null]));
const limitsValid = (v: Partial<Record<LimitKey, string>>) => LIMITS.every((l) => !v[l.key]?.trim() || (Number.isFinite(Number(v[l.key])) && Number(v[l.key]) >= 0));

export function MemberAccessEditor({ userId, name, local, roles, permissions, rolePermissions, homeOptions, initial }: {
  userId: string; name: string; local: boolean; roles: Option[]; permissions: PermissionItem[];
  rolePermissions: Record<string, string[]>; homeOptions: HomeOption[];
  initial: { role_ids: string[]; grants: string[]; denies: string[]; home_path: string | null; limits: Record<string, number | null>; is_active: boolean };
}) {
  const { pending, error, run } = useSubmit();
  const [roleIds, setRoleIds] = useState(new Set(initial.role_ids));
  const [choice, setChoice] = useState<Record<string, Choice>>(() => ({
    ...Object.fromEntries(initial.grants.map((c) => [c, "allow" as Choice])),
    ...Object.fromEntries(initial.denies.map((c) => [c, "deny" as Choice])),
  }));
  const [home, setHome] = useState(initial.home_path ?? "");
  const [limits, setLimits] = useState<Partial<Record<LimitKey, string>>>(() =>
    Object.fromEntries(Object.entries(initial.limits ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)])));
  const [active, setActive] = useState(initial.is_active);
  const [filter, setFilter] = useState("");

  const fromRoles = useMemo(() => new Set([...roleIds].flatMap((r) => rolePermissions[r] ?? [])), [roleIds, rolePermissions]);
  const effective = (code: string) => choice[code] === "allow" || (choice[code] !== "deny" && fromRoles.has(code));
  const count = permissions.filter((p) => effective(p.code)).length;
  const groups = groupsOf(permissions.filter((p) => !filter.trim() || p.label.includes(filter.trim()) || (PERMISSION_GROUPS[p.module] ?? "").includes(filter.trim())));

  const save = () => {
    if (!limitsValid(limits)) { toast(tr("الحدود أرقام موجبة فقط"), "error"); return; }
    const grants = Object.entries(choice).filter(([, c]) => c === "allow").map(([k]) => k);
    const denies = Object.entries(choice).filter(([, c]) => c === "deny").map(([k]) => k);
    run(() => saveMemberAccessAction(userId, { role_ids: [...roleIds], grants, denies, home_path: home || null, limits: toLimits(limits), is_active: active }),
      tr("تم حفظ صلاحيات {0}", name));
  };

  return (
    <div className="space-y-8">
      {error && <Alert variant="destructive">{error}</Alert>}

      <section className="space-y-3">
        <h2 className="text-[19px] font-semibold text-ink">{tr("الدور")}</h2>
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => {
            const on = roleIds.has(r.id);
            return (
              <label key={r.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[15.5px] font-medium transition-colors",
                on ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700 hover:border-line-strong")}>
                <input type="checkbox" className="sr-only" checked={on}
                  onChange={(e) => { const n = new Set(roleIds); if (e.target.checked) n.add(r.id); else n.delete(r.id); setRoleIds(n); }} />
                {r.label}
              </label>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className={field}>
          <Label htmlFor="member_home">{tr("الصفحة الأولى بعد الدخول")}</Label>
          <NativeSelect id="member_home" value={home} onChange={(e) => setHome(e.target.value)}>
            <option value="">{tr("حسب الدور")}</option>
            {homeOptions.map((o) => <option key={o.href} value={o.href}>{o.label}</option>)}
          </NativeSelect>
        </div>
        <div className={field}>
          <Label>{tr("حالة الحساب")}</Label>
          <label className="flex h-11 cursor-pointer items-center gap-2.5 rounded-md border border-line px-3 text-[15.5px] text-ink">
            <input type="checkbox" className="size-4" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {active ? tr("الحساب نشط ويستطيع الدخول") : tr("الحساب موقوف، ولا يستطيع الدخول")}
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[19px] font-semibold text-ink">{tr("الصلاحيات")}</h2>
            <p className="text-[15px] text-slate-500">{tr("حسب الدور ما لم تختر سماحًا أو منعًا لهذا الموظف. يملك الآن")}{" "}<span className="num">{count}</span>{" "}{tr("صلاحية.")}</p>
          </div>
          <Input className="w-64" placeholder={tr("بحث في الصلاحيات")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={tr("بحث في الصلاحيات")} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <div key={g.module} className="rounded-xl border border-line">
              <p className="border-b border-line bg-panel px-4 py-2.5 font-semibold text-ink">{g.title}</p>
              <ul className="divide-y divide-line">
                {g.items.map((p) => {
                  const c = choice[p.code] ?? "role";
                  const on = effective(p.code);
                  return (
                    <li key={p.code} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <span className={cn("min-w-0 text-[15.5px]", on ? "text-ink" : "text-slate-500")}>
                        {p.label}
                        {c === "role" && <span className="ms-2 text-[13.5px] text-slate-500">{fromRoles.has(p.code) ? tr("من الدور") : ""}</span>}
                      </span>
                      <span className="inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label={p.label}>
                        {([["role", tr("حسب الدور")], ["allow", tr("سماح")], ["deny", tr("منع")]] as [Choice, string][]).map(([k, label]) => (
                          <button key={k} type="button" role="radio" aria-checked={c === k}
                            onClick={() => setChoice((x) => { const n = { ...x }; if (k === "role") delete n[p.code]; else n[p.code] = k; return n; })}
                            className={cn("rounded px-2.5 py-1 text-[14px] font-medium transition-colors",
                              c === k ? (k === "deny" ? "bg-urgent text-white" : k === "allow" ? "bg-success text-white" : "bg-ink text-white") : "text-slate-600 hover:bg-subtle")}>
                            {label}
                          </button>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[19px] font-semibold text-ink">{tr("الحدود المالية لهذا الموظف")}</h2>
        <p className="text-[15px] text-slate-500">{tr("اتركها فارغة ليُطبَّق حد الدور. ما يتجاوز الحد يرسله الموظف طلب موافقة للمدير.")}</p>
        <LimitsFields value={limits} onChange={setLimits} inheritLabel={tr("حسب الدور")} idPrefix="member" />
      </section>

      <div className="flex flex-wrap gap-2 border-t border-line pt-5">
        <Button onClick={save} loading={pending}>{tr("حفظ الصلاحيات")}</Button>
      </div>

      {local && <AccountTools userId={userId} />}
    </div>
  );
}

function AccountTools({ userId }: { userId: string }) {
  const { pending, error, run } = useSubmit();
  const [pw, setPw] = useState("");
  return (
    <section className="space-y-3 rounded-xl border border-line p-5">
      <h2 className="text-[19px] font-semibold text-ink">{tr("الحساب")}</h2>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <div className={cn(field, "w-64")}>
          <Label htmlFor="reset_password">{tr("كلمة مرور مؤقتة جديدة")}</Label>
          <Input id="reset_password" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <Button variant="outline" loading={pending} disabled={!pw} onClick={() => run(() => resetPasswordAction(userId, pw), tr("تم تعيين كلمة مرور مؤقتة"), () => setPw(""))}>
          <KeyRound className="size-4" />{tr("تعيين كلمة المرور")}</Button>
        <Button variant="outline" loading={pending} onClick={() => run(() => endSessionsAction(userId), tr("تم إخراج الموظف من كل الأجهزة"))}>
          <LogOut className="size-4" />{tr("إخراج من كل الأجهزة")}</Button>
      </div>
      <p className="text-[14.5px] text-slate-500">{tr("يغيّر الموظف كلمة المرور المؤقتة عند دخوله التالي.")}</p>
    </section>
  );
}

// -----------------------------------------------------------------------------
// إعدادات الدور
// -----------------------------------------------------------------------------
export function RoleSettingsEditor({ roleId, homeOptions, quickOptions, initial }: {
  roleId: string; homeOptions: HomeOption[]; quickOptions: { key: string; label: string }[];
  initial: { home_path: string | null; quick_actions: string[]; dashboard_hidden: string[]; limits: Record<string, number | null> };
}) {
  const { pending, error, run } = useSubmit();
  const [home, setHome] = useState(initial.home_path ?? "");
  const [quick, setQuick] = useState(new Set(initial.quick_actions));
  const [hidden, setHidden] = useState(new Set(initial.dashboard_hidden));
  const [limits, setLimits] = useState<Partial<Record<LimitKey, string>>>(() =>
    Object.fromEntries(Object.entries(initial.limits ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)])));
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const chip = (on: boolean) => cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[15.5px] font-medium transition-colors",
    on ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-700 hover:border-line-strong");

  return (
    <div className="space-y-8">
      {error && <Alert variant="destructive">{error}</Alert>}
      <section className="grid gap-4 md:grid-cols-2">
        <div className={field}>
          <Label htmlFor="role_home">{tr("الصفحة الأولى بعد الدخول")}</Label>
          <NativeSelect id="role_home" value={home} onChange={(e) => setHome(e.target.value)}>
            <option value="">{tr("لوحة التحكم")}</option>
            {homeOptions.map((o) => <option key={o.href} value={o.href}>{o.label}</option>)}
          </NativeSelect>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-[19px] font-semibold text-ink">{tr("الإجراءات السريعة في أعلى الشاشة")}</h2>
        <div className="flex flex-wrap gap-2">
          {quickOptions.map((q) => (
            <label key={q.key} className={chip(quick.has(q.key))}>
              <input type="checkbox" className="sr-only" checked={quick.has(q.key)} onChange={() => setQuick(toggle(quick, q.key))} />{q.label}
            </label>
          ))}
        </div>
        <p className="text-[14.5px] text-slate-500">{tr("يظهر الإجراء فقط لمن يملك صلاحيته.")}</p>
      </section>
      <section className="space-y-3">
        <h2 className="text-[19px] font-semibold text-ink">{tr("أقسام مخفية من لوحة التحكم")}</h2>
        <div className="flex flex-wrap gap-2">
          {DASHBOARD_SECTIONS.map((d) => (
            <label key={d.key} className={chip(hidden.has(d.key))}>
              <input type="checkbox" className="sr-only" checked={hidden.has(d.key)} onChange={() => setHidden(toggle(hidden, d.key))} />{d.label}
            </label>
          ))}
        </div>
        <p className="text-[14.5px] text-slate-500">{tr("ما لا يملك الدور صلاحيته لا يظهر أصلًا، وهذا لإخفاء ما يملكه ولا يحتاجه.")}</p>
      </section>
      <section className="space-y-3">
        <h2 className="text-[19px] font-semibold text-ink">{tr("الحدود المالية للدور")}</h2>
        <p className="text-[15px] text-slate-500">{tr("اتركها فارغة لعدم وضع حد. ما يتجاوز الحد يرسله الموظف طلب موافقة.")}</p>
        <LimitsFields value={limits} onChange={setLimits} inheritLabel={tr("بلا حد")} idPrefix="role" />
      </section>
      <Button loading={pending} onClick={() => {
        if (!limitsValid(limits)) { toast(tr("الحدود أرقام موجبة فقط"), "error"); return; }
        run(() => saveRoleSettingsAction(roleId, { home_path: home || null, quick_actions: [...quick], dashboard_hidden: [...hidden], limits: toLimits(limits) }), tr("تم حفظ إعدادات الدور"));
      }}>{tr("حفظ إعدادات الدور")}</Button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// صلاحيات الدور الخاص
// -----------------------------------------------------------------------------
export function RolePermissionsEditor({ role, permissions, held }: {
  role: { id?: string; code: string; name_ar: string; name_en: string; permissions: string[] };
  permissions: PermissionItem[]; held: string[];
}) {
  const { pending, error, run, router } = useSubmit();
  const [v, setV] = useState(role);
  const [sel, setSel] = useState(new Set(role.permissions));
  const mine = new Set(held);
  return (
    <div className="space-y-5">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={field}><Label htmlFor="role_name">{tr("اسم الدور")}</Label>
          <Input id="role_name" value={localNameOf(v)} onChange={(e) => setV({ ...v, name_ar: e.target.value })} /></div>
        <div className={field}><Label htmlFor="role_name_en">{tr("الاسم بالإنجليزية")}</Label>
          <Input id="role_name_en" dir="ltr" value={v.name_en} onChange={(e) => setV({ ...v, name_en: e.target.value })} /></div>
        <div className={field}><Label htmlFor="role_code">{tr("الرمز")}</Label>
          <Input id="role_code" dir="ltr" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder="night_reception" /></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {groupsOf(permissions).map((g) => (
          <div key={g.module} className="rounded-xl border border-line">
            <p className="border-b border-line bg-panel px-4 py-2.5 font-semibold text-ink">{g.title}</p>
            <ul className="divide-y divide-line">
              {g.items.map((p) => (
                <li key={p.code} className="px-4 py-2.5">
                  <label className={cn("flex items-center gap-2.5 text-[15.5px]", mine.has(p.code) ? "cursor-pointer text-ink" : "text-slate-400")}>
                    <input type="checkbox" className="size-4" disabled={!mine.has(p.code) && !sel.has(p.code)} checked={sel.has(p.code)}
                      onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(p.code); else n.delete(p.code); setSel(n); }} />
                    {p.label}
                    {!mine.has(p.code) && <Badge variant="secondary">{tr("ليست عندك")}</Badge>}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Button loading={pending} onClick={() => run(() => saveRoleAction({ ...v, permissions: [...sel] }), tr("تم حفظ الدور"), () => router.push("/settings/users"))}>{tr("حفظ الدور")}</Button>
    </div>
  );
}


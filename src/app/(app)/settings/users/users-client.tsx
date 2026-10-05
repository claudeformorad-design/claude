"use client";
import { localNameOf } from "@/lib/local-name";
import { tr } from "@/i18n/tr";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Copy, KeyRound, Link2, LogOut, PauseCircle, PlayCircle, RotateCcw, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
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
  accessLinkAction, addEmployeeAction, addStaffWithLinkAction, enableLoginAction, endSessionsAction, removeStaffAction, resetPasswordAction, saveMemberAccessAction,
  saveRoleSettingsAction, setStaffActiveAction,
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
// رابط الدخول: يُنسخ ويُرسل للموظف، ويعمل مرة واحدة خلال 7 أيام
// -----------------------------------------------------------------------------
function AccessLinkBox({ token, username }: { token: string; username?: string }) {
  const url = typeof window === "undefined" ? `/join/${token}` : `${window.location.origin}/join/${token}`;
  return (
    <div className="space-y-2 rounded-lg border border-line bg-panel p-4" data-access-link={url}>
      <p className="font-semibold text-ink">{tr("أرسل هذا الرابط للموظف")}</p>
      <div className="flex gap-2">
        <Input readOnly dir="ltr" value={url} aria-label={tr("رابط الدخول")} onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="outline" onClick={() => { void navigator.clipboard?.writeText(url); toast(tr("نُسخ الرابط")); }}><Copy className="size-4" />{tr("نسخ")}</Button>
      </div>
      <p className="text-[14.5px] text-slate-500">
        {tr("يفتحه الموظف ويضغط دخول فيبقى جهازه مسجّلًا. يعمل مرة واحدة خلال 7 أيام.")}
        {username && <> {tr("اسم المستخدم إن وضع كلمة مرور لاحقًا:")} <span dir="ltr" className="num font-semibold text-ink">{username}</span></>}
      </p>
    </div>
  );
}

/** النسخة المنشورة: موظف بالاسم والدور فقط، ثم رابط دخوله */
export function AddEmployeeByLink({ roles }: { roles: Option[] }) {
  const { pending, error, run, router } = useSubmit();
  const [v, setV] = useState({ full_name: "", role_id: roles.find((r) => r.label.includes("استقبال"))?.id ?? roles[0]?.id ?? "" });
  const [link, setLink] = useState<{ token: string; username: string } | null>(null);
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      setLink(null);
      run(async () => {
        const r = await addStaffWithLinkAction(v);
        if (r.ok) setLink(r.data);
        return r;
      }, tr("تمت إضافة الموظف"), () => { setV({ ...v, full_name: "" }); router.refresh(); });
    }}>
      <p className="font-semibold text-ink">{tr("إضافة موظف")}</p>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={field}><Label htmlFor="emp_name">{tr("اسم الموظف")}</Label>
          <Input id="emp_name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></div>
        <div className={field}><Label htmlFor="emp_role">{tr("الدور")}</Label>
          <NativeSelect id="emp_role" value={v.role_id} onChange={(e) => setV({ ...v, role_id: e.target.value })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </NativeSelect></div>
      </div>
      <Button type="submit" loading={pending}>{tr("إضافة وإنشاء رابط دخول")}</Button>
      {link && <AccessLinkBox token={link.token} username={link.username} />}
    </form>
  );
}

// -----------------------------------------------------------------------------
// إضافة موظف
// -----------------------------------------------------------------------------
export function AddEmployee({ roles }: { roles: Option[] }) {
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
        <div className={field}><Label htmlFor="emp_name">{tr("اسم الموظف")}</Label>
          <Input id="emp_name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></div>
        <div className={field}><Label htmlFor="emp_username">{tr("اسم المستخدم")}</Label>
          <Input id="emp_username" dir="ltr" autoCapitalize="none" value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} /></div>
        <div className={field}><Label htmlFor="emp_password">{tr("كلمة مرور مؤقتة")}</Label>
          <Input id="emp_password" dir="ltr" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
        <div className={field}><Label htmlFor="emp_role">{tr("الدور")}</Label>
          <NativeSelect id="emp_role" value={v.role_id} onChange={(e) => setV({ ...v, role_id: e.target.value })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </NativeSelect></div>
      </div>
      <p className="text-[14.5px] text-slate-500">{tr("يغيّر الموظف كلمة المرور المؤقتة عند أول دخول.")}</p>
      <Button type="submit" loading={pending}>{tr("إضافة الموظف")}</Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// صلاحيات الموظف: مفتاح لكل صلاحية، والمختلف عن وظيفته يُحفظ استثناءً (سماح أو منع)
// -----------------------------------------------------------------------------

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

/** مفتاح تشغيل وإيقاف. mixed: بعض عناصر المجموعة مفعّلة */
function Switch({ on, mixed = false, onChange, label }: { on: boolean; mixed?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={mixed ? "mixed" : on} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onChange(mixed ? true : !on); }}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200",
        on ? "bg-success" : mixed ? "bg-success-dot/45" : "bg-slate-300")}>
      <span className={cn("absolute size-5 rounded-full bg-white shadow-sm transition-[inset-inline-start] duration-200",
        on ? "start-[22px]" : mixed ? "start-[12px]" : "start-0.5")} />
    </button>
  );
}

/** أسماء الأقسام التي يغطيها الدور، الأكثر صلاحيات أولًا، لتعرف الوظيفة من نظرة */
function areasOf(codes: string[], permissions: PermissionItem[]) {
  const held = new Set(codes);
  const counts = new Map<string, number>();
  for (const p of permissions) {
    if (!held.has(p.code)) continue;
    const t = PERMISSION_GROUPS[p.module] ?? p.module;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

export function MemberAccessEditor({ userId, name, roles, permissions, rolePermissions, homeOptions, isActive, initial }: {
  userId: string; name: string; roles: Option[]; permissions: PermissionItem[];
  rolePermissions: Record<string, string[]>; homeOptions: HomeOption[]; isActive: boolean;
  initial: { role_ids: string[]; grants: string[]; denies: string[]; home_path: string | null; limits: Record<string, number | null> };
}) {
  const { pending, error, run, router } = useSubmit();
  const start = useMemo(() => ({
    roles: new Set(initial.role_ids),
    overrides: { ...Object.fromEntries(initial.grants.map((c) => [c, true])), ...Object.fromEntries(initial.denies.map((c) => [c, false])) } as Record<string, boolean>,
    home: initial.home_path ?? "",
    limits: Object.fromEntries(Object.entries(initial.limits ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)])) as Partial<Record<LimitKey, string>>,
  }), [initial]);
  const [roleIds, setRoleIds] = useState(start.roles);
  const [overrides, setOverrides] = useState(start.overrides);
  const [home, setHome] = useState(start.home);
  const [limits, setLimits] = useState(start.limits);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState("");
  const touch = () => setDirty(true);

  const fromRoles = useMemo(() => new Set([...roleIds].flatMap((r) => rolePermissions[r] ?? [])), [roleIds, rolePermissions]);
  const has = (code: string) => overrides[code] ?? fromRoles.has(code);
  const changed = (code: string) => code in overrides && overrides[code] !== fromRoles.has(code);
  const changedCount = permissions.filter((p) => changed(p.code)).length;
  const count = permissions.filter((p) => has(p.code)).length;
  const q = filter.trim();
  const groups = groupsOf(permissions.filter((p) => !q || p.label.includes(q) || (PERMISSION_GROUPS[p.module] ?? "").includes(q)));

  const setMany = (codes: string[], on: boolean) => {
    setOverrides((x) => {
      const n = { ...x };
      for (const c of codes) { if (on === fromRoles.has(c)) delete n[c]; else n[c] = on; }
      return n;
    });
    touch();
  };
  const toggleOpen = (m: string) => setOpen((x) => { const n = new Set(x); if (n.has(m)) n.delete(m); else n.add(m); return n; });

  const reset = () => { setRoleIds(start.roles); setOverrides(start.overrides); setHome(start.home); setLimits(start.limits); setDirty(false); };
  const save = () => {
    if (!limitsValid(limits)) { toast(tr("الحدود أرقام موجبة فقط"), "error"); return; }
    const grants = permissions.filter((p) => overrides[p.code] === true && !fromRoles.has(p.code)).map((p) => p.code);
    const denies = permissions.filter((p) => overrides[p.code] === false && fromRoles.has(p.code)).map((p) => p.code);
    run(() => saveMemberAccessAction(userId, { role_ids: [...roleIds], grants, denies, home_path: home || null, limits: toLimits(limits), is_active: isActive }),
      tr("تم حفظ صلاحيات {0}", name), () => { setDirty(false); router.refresh(); });
  };

  return (
    <div className="space-y-6">
      {error && <Alert variant="destructive">{error}</Alert>}

      <section className="surface space-y-4 p-6">
        <h2 className="text-[19px] font-semibold text-ink">{tr("الوظيفة")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => {
            const on = roleIds.has(r.id);
            const areas = areasOf(rolePermissions[r.id] ?? [], permissions);
            return (
              <label key={r.id} className={cn("relative flex cursor-pointer flex-col gap-1.5 rounded-xl border p-4 transition-colors",
                on ? "border-ink bg-panel shadow-[inset_0_0_0_1px_var(--color-ink)]" : "border-line bg-white hover:border-line-strong")}>
                <input type="checkbox" className="sr-only" checked={on}
                  onChange={(e) => { const n = new Set(roleIds); if (e.target.checked) n.add(r.id); else n.delete(r.id); setRoleIds(n); touch(); }} />
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[16.5px] font-semibold text-ink">{r.label}</span>
                  <span className={cn("grid size-5 place-items-center rounded-full border", on ? "border-ink bg-ink text-white" : "border-line-strong")}>
                    {on && <Check className="size-3.5" />}
                  </span>
                </span>
                <span className="text-[14px] leading-relaxed text-slate-500">
                  {areas.length === 0 ? tr("بلا صلاحيات") : areas.slice(0, 3).join(tr("، "))}
                  {areas.length > 3 && <span className="num ms-1.5 rounded bg-subtle px-1.5 py-px text-[13px] text-slate-600" dir="ltr">+{areas.length - 3}</span>}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
          <div className="space-y-1">
            <h2 className="text-[19px] font-semibold text-ink">{tr("ماذا يستطيع أن يفعل")}</h2>
            <p className="text-[15px] text-slate-500"><span className="num font-semibold text-ink">{count}</span> {tr("من")} <span className="num">{permissions.length}</span> {tr("صلاحية مفعّلة")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {changedCount > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { setOverrides({}); touch(); }}>
                <RotateCcw className="size-4" />{tr("كما في الوظيفة")} <span className="num text-slate-500">({changedCount})</span>
              </Button>
            )}
            <Input className="w-56" placeholder={tr("بحث")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={tr("بحث في الصلاحيات")} />
          </div>
        </div>
        <ul className="divide-y divide-line border-t border-line">
          {groups.map((g) => {
            const codes = g.items.map((p) => p.code);
            const onCount = codes.filter(has).length;
            const expanded = open.has(g.module) || !!q;
            return (
              <li key={g.module}>
                <div className="flex cursor-pointer items-center gap-3 px-6 py-3.5 transition-colors hover:bg-panel" onClick={() => toggleOpen(g.module)}>
                  <ChevronDown className={cn("size-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{g.title}</span>
                    <span className="text-[14px] text-slate-500">
                      {onCount === 0 ? tr("لا شيء") : onCount === codes.length ? tr("كل الصلاحيات") : <><span className="num">{onCount}</span> {tr("من")} <span className="num">{codes.length}</span></>}
                    </span>
                  </span>
                  <Switch on={onCount === codes.length} mixed={onCount > 0 && onCount < codes.length} label={g.title} onChange={(v) => setMany(codes, v)} />
                </div>
                {expanded && (
                  <ul className="bg-panel/60 pb-2">
                    {g.items.map((p) => (
                      <li key={p.code} className="flex items-center gap-3 py-2.5 ps-[52px] pe-6">
                        <span className={cn("min-w-0 flex-1 text-[15.5px]", has(p.code) ? "text-ink" : "text-slate-500")}>
                          {p.label}
                          {changed(p.code) && <Badge variant="info" className="ms-2 text-[13px]">{has(p.code) ? tr("مضافة له") : tr("ممنوعة عنه")}</Badge>}
                        </span>
                        <Switch on={has(p.code)} label={p.label} onChange={(v) => setMany([p.code], v)} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <details className="surface group p-6">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span className="text-[19px] font-semibold text-ink">{tr("إعدادات إضافية")}</span>
          <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-5 space-y-6">
          <div className={cn(field, "max-w-md")}>
            <Label htmlFor="member_home">{tr("الصفحة الأولى بعد الدخول")}</Label>
            <NativeSelect id="member_home" value={home} onChange={(e) => { setHome(e.target.value); touch(); }}>
              <option value="">{tr("حسب الوظيفة")}</option>
              {homeOptions.map((o) => <option key={o.href} value={o.href}>{o.label}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-3">
            <p className="font-semibold text-ink">{tr("الحدود المالية")}</p>
            <p className="text-[15px] text-slate-500">{tr("ما يتجاوز الحد يرسله الموظف طلب موافقة لك. الفارغ يتبع الوظيفة.")}</p>
            <LimitsFields value={limits} onChange={(v) => { setLimits(v); touch(); }} inheritLabel={tr("حسب الوظيفة")} idPrefix="member" />
          </div>
        </div>
      </details>

      <div className={cn("sticky bottom-4 z-20 transition-[opacity,transform] duration-200", dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0")}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-strong bg-white px-5 py-3 shadow-[0_8px_30px_rgba(31,29,27,0.12)]">
          <span className="font-medium text-ink">{tr("لديك تغييرات لم تُحفظ")}</span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={reset} disabled={pending}>{tr("تراجع")}</Button>
            <Button onClick={save} loading={pending}>{tr("حفظ التغييرات")}</Button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** حالة الحساب وأزراره: رابط دخول، إيقاف وإعادة، إخراج من الأجهزة، كلمة مؤقتة (محليًا)، حذف */
export function StaffAccountPanel({ userId, name, isActive, linkMode, local, joined, linkExpiresAt }: {
  userId: string; name: string; isActive: boolean; linkMode: boolean; local: boolean; joined: boolean; linkExpiresAt: string | null;
}) {
  const { pending, error, run, router } = useSubmit();
  const [token, setToken] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pw, setPw] = useState("");
  const status = !isActive
    ? { tone: "secondary" as const, text: tr("موقوف"), hint: tr("لا يستطيع الدخول حتى تعيد تفعيله.") }
    : linkMode && !joined
      ? linkExpiresAt
        ? { tone: "warning" as const, text: tr("لم يدخل بعد"), hint: tr("أرسلت له رابطًا ولم يفتحه بعد.") }
        : { tone: "warning" as const, text: tr("لم يدخل بعد"), hint: tr("لا يوجد رابط ساري. أنشئ رابطًا جديدًا وأرسله له.") }
      : { tone: "success" as const, text: tr("نشط"), hint: tr("يستطيع الدخول والعمل بصلاحياته.") };

  return (
    <section className="surface space-y-4 p-6">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={status.tone}>{status.text}</Badge>
        <span className="text-[15.5px] text-slate-600">{status.hint}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {linkMode && isActive && (
          <Button variant="outline" loading={pending} onClick={() => run(async () => {
            const r = await accessLinkAction(userId);
            if (r.ok) setToken(r.data);
            return r;
          }, tr("أُنشئ رابط دخول جديد"), () => router.refresh())}><Link2 className="size-4" />{tr("رابط دخول جديد")}</Button>
        )}
        {isActive ? (
          <Button variant="outline" loading={pending} onClick={() => run(() => setStaffActiveAction(userId, false), tr("أُوقف دخول {0}", name))}>
            <PauseCircle className="size-4" />{tr("إيقاف الدخول")}</Button>
        ) : (
          <Button loading={pending} onClick={() => run(() => setStaffActiveAction(userId, true), tr("أُعيد تفعيل {0}", name))}>
            <PlayCircle className="size-4" />{tr("إعادة التفعيل")}</Button>
        )}
        {isActive && (
          <Button variant="ghost" loading={pending} onClick={() => run(() => endSessionsAction(userId), tr("تم إخراج الموظف من كل الأجهزة"))}>
            <LogOut className="size-4" />{tr("إخراج من كل الأجهزة")}</Button>
        )}
        <Button variant="destructive" className="ms-auto" onClick={() => setConfirm(true)}><Trash2 className="size-4" />{tr("حذف الموظف")}</Button>
      </div>
      {token && <AccessLinkBox token={token} />}
      {local && (
        <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <div className={cn(field, "w-64")}>
            <Label htmlFor="reset_password">{tr("كلمة مرور مؤقتة جديدة")}</Label>
            <Input id="reset_password" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <Button variant="outline" loading={pending} disabled={!pw} onClick={() => run(() => resetPasswordAction(userId, pw), tr("تم تعيين كلمة مرور مؤقتة"), () => setPw(""))}>
            <KeyRound className="size-4" />{tr("تعيين كلمة المرور")}</Button>
        </div>
      )}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={tr("حذف {0}؟", name)} width="sm">
        <div className="space-y-5">
          <p className="leading-relaxed text-slate-600">{tr("لن يستطيع الدخول بعد الآن، وتُلغى روابطه وصلاحياته. العمليات التي سجّلها تبقى باسمه في السجلات.")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>{tr("إلغاء")}</Button>
            <Button variant="destructive" loading={pending} onClick={() => run(() => removeStaffAction(userId), tr("حُذف {0}", name), () => router.push("/settings/users"))}>
              <Trash2 className="size-4" />{tr("حذف الموظف")}</Button>
          </div>
        </div>
      </Dialog>
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


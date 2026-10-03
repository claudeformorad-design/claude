"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { saveRoleAction, setMemberRolesAction } from "../../_admin/actions";
import { actionErrorText, callAction } from "@/lib/action-error";
import { Avatar } from "@/components/ui/entity";
import { toast } from "@/components/ui/toast";

type T = Pick<Dictionary, "admin" | "common" | "errors">;
type Role = { id: string; label: string; system: boolean };

export function MemberRow({ t, userId, email, name, active, roleIds, roles, isSelf }: {
  t: T; userId: string; email: string; name: string; active: boolean; roleIds: string[]; roles: Role[]; isSelf: boolean;
}) {
  const router = useRouter();
  const [sel, setSel] = useState(new Set(roleIds));
  const [isActive, setActive] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 border-b border-line p-5 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={name || email} className="size-10 text-[16.5px]" />
        <div className="min-w-0 leading-tight">
          <p className="font-semibold text-ink">{name || email}</p>
          <p className="text-[15.5px] text-slate-500" dir="ltr">{email}</p>
        </div>
        {!isActive && <Badge variant="secondary">{t.common.inactive}</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        {roles.map((r) => (
          <label key={r.id} className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[16.5px] font-medium transition-colors ${sel.has(r.id) ? "bg-ink text-white" : "bg-subtle text-slate-700 hover:bg-line"}`}>
            <input type="checkbox" className="sr-only" checked={sel.has(r.id)}
              onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSel(n); }} />
            {r.label}{r.system && <span className={`ms-1 ${sel.has(r.id) ? "text-white/70" : "text-slate-500"}`}>{t.admin.systemRole}</span>}
          </label>
        ))}
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex gap-2">
        <Button size="sm" loading={pending} onClick={() => start(async () => {
          const r = await callAction(setMemberRolesAction(userId, [...sel], isActive));
          if (r.ok) { toast("تم حفظ الأدوار"); router.refresh(); } else setError(actionErrorText(t.errors, r));
        })}>{t.admin.saveRoles}</Button>
        {!isSelf && <Button size="sm" variant="ghost" onClick={() => setActive(!isActive)}>{isActive ? t.admin.deactivate : t.admin.activate}</Button>}
      </div>
    </div>
  );
}

export function RoleEditor({ t, role, permissions }: {
  t: T; role: { id?: string; code: string; name_ar: string; name_en: string; permissions: string[] };
  permissions: { code: string; label: string; module: string }[];
}) {
  const router = useRouter();
  const [v, setV] = useState(role);
  const [sel, setSel] = useState(new Set(role.permissions));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const modules = [...new Set(permissions.map((p) => p.module))];
  return (
    <div className="space-y-3">
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-2 sm:grid-cols-3">
        <Input dir="ltr" placeholder={t.admin.roleCode} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
        <Input placeholder="الاسم" value={v.name_ar} onChange={(e) => setV({ ...v, name_ar: e.target.value })} />
        <Input dir="ltr" placeholder="Name" value={v.name_en} onChange={(e) => setV({ ...v, name_en: e.target.value })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((m) => (
          <div key={m} className="rounded-[10px] bg-panel p-3">
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{m}</p>
            {permissions.filter((p) => p.module === m).map((p) => (
              <label key={p.code} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="size-4" checked={sel.has(p.code)}
                  onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(p.code); else n.delete(p.code); setSel(n); }} />{p.label}
              </label>
            ))}
          </div>
        ))}
      </div>
      <Button loading={pending} onClick={() => start(async () => {
        const r = await callAction(saveRoleAction({ ...v, permissions: [...sel] }));
        if (r.ok) { toast("تم الحفظ"); router.push("/settings/users"); } else setError(actionErrorText(t.errors, r));
      })}>{t.common.save}</Button>
    </div>
  );
}

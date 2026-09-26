"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary } from "@/i18n/dictionaries/ar";
import { saveRoleAction, setMemberRolesAction } from "../../_admin/actions";
import { actionErrorText } from "@/lib/action-error";

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
    <div className="space-y-2 border-b p-4 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{name || email}</span><span className="text-sm text-muted-foreground" dir="ltr">{email}</span>
        {!isActive && <Badge variant="secondary">{t.common.inactive}</Badge>}
      </div>
      <div className="flex flex-wrap gap-3">
        {roles.map((r) => (
          <label key={r.id} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="size-4" checked={sel.has(r.id)}
              onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSel(n); }} />
            {r.label}{r.system && <span className="text-xs text-muted-foreground">({t.admin.systemRole})</span>}
          </label>
        ))}
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => start(async () => {
          const r = await setMemberRolesAction(userId, [...sel], isActive);
          if (r.ok) router.refresh(); else setError(actionErrorText(t.errors, r));
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
      <Button disabled={pending} onClick={() => start(async () => {
        const r = await saveRoleAction({ ...v, permissions: [...sel] });
        if (r.ok) router.push("/settings/users"); else setError(actionErrorText(t.errors, r));
      })}>{t.common.save}</Button>
    </div>
  );
}

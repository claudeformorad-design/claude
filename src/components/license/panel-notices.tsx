"use client";
import { tr } from "@/i18n/tr";

import { useEffect, useState } from "react";
import { Megaphone, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Notice = { id: string; title: string; body: string; level: "info" | "important" };
const KEY = "nazeel-dismissed-notices";

/**
 * إشعارات صاحب النظام من لوحة هوتيلنا: شريط أعلى الصفحة.
 * العادي يخفيه المستخدم على جهازه، والمهم يبقى حتى تنتهي مدته من اللوحة.
 */
export function PanelNotices({ notices }: { notices: Notice[] }) {
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => {
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { /* تخزين المتصفح غير متاح */ }
    // قراءة ما أخفاه المستخدم بعد التحميل فقط (لا يوجد في الخادم)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(saved);
  }, []);
  if (dismissed === null) return null;
  const shown = notices.filter((n) => n.level === "important" || !dismissed.includes(n.id));
  if (!shown.length) return null;
  const hide = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try { localStorage.setItem(KEY, JSON.stringify(next.slice(-50))); } catch { /* تخزين المتصفح غير متاح */ }
  };
  return (
    <div className="mb-4 space-y-2" role="region" aria-label={tr("إشعارات هوتيلنا")}>
      {shown.map((n) => (
        <div key={n.id} data-notice={n.id}
          className={cn("flex items-start gap-3 rounded-lg px-4 py-3", n.level === "important" ? "bg-amber-tint text-amber" : "bg-sky-tint text-sky")}>
          {n.level === "important" ? <TriangleAlert className="mt-0.5 size-5 shrink-0" /> : <Megaphone className="mt-0.5 size-5 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold">{n.title}</p>
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{n.body}</p>
          </div>
          {n.level === "info" && (
            <button type="button" onClick={() => hide(n.id)} aria-label={tr("إخفاء")} className="rounded p-1 text-slate-500 hover:bg-white/60"><X className="size-4" /></button>
          )}
        </div>
      ))}
    </div>
  );
}

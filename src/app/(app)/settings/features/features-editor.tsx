"use client";
import { tr } from "@/i18n/tr";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Lock, TriangleAlert, OctagonX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { actionErrorText, callAction } from "@/lib/action-error";
import type { FeatureKind } from "@/lib/features/registry";
import { cn } from "@/lib/utils";
import { toggleFeatureAction } from "./actions";

export type ViewNode = {
  key: string; kind: FeatureKind; label: string; hint: string | null; locked: string | null; on: boolean; children: ViewNode[];
  /** قسم غير مشمول في ترخيص الفندق */
  unsold?: boolean;
};

const KIND: Record<Exclude<FeatureKind, "section">, () => string> = {
  part: () => tr("جزء"), field: () => tr("خانة"), button: () => tr("زر"),
};

type Prompt = { node: ViewNode; on: boolean; level: "warn" | "block"; messages: string[] };

export function FeaturesEditor({ tree, owner, errors }: { tree: ViewNode[]; owner: boolean; errors: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (node: ViewNode, on: boolean, confirm = false) => start(async () => {
    setBusy(node.key);
    const r = await callAction(toggleFeatureAction(node.key, on, confirm));
    setBusy(null);
    if (!r.ok) { setPrompt({ node, on, level: "block", messages: [actionErrorText(errors, r)] }); return; }
    if (!r.data.ok) { setPrompt({ node, on, level: r.data.level, messages: r.data.messages }); return; }
    setPrompt(null);
    toast(on ? tr("شُغّل {0}", node.label) : tr("أُطفئ {0}", node.label));
    router.refresh();
  });

  const expand = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="space-y-4">
      {tree.map((section) => {
        const ownerOnly = !owner && !section.locked;
        // قسم غير مشمول: لا تُعرض أجزاؤه
        const expanded = open.has(section.key);
        const count = countItems(section);
        return (
          <section key={section.key} className={cn("surface overflow-hidden", !section.on && "opacity-80")} data-feature={section.key}>
            <div className="flex items-start gap-4 p-5">
              <button type="button" onClick={() => expand(section.key)} disabled={!section.children.length}
                className="flex min-w-0 flex-1 items-start gap-3 text-start disabled:cursor-default">
                {section.children.length > 0 && <ChevronDown className={cn("mt-1 size-5 shrink-0 text-slate-500 transition-transform", expanded && "rotate-180")} />}
                <span className="min-w-0 space-y-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[18.5px] font-semibold text-ink">{section.label}</span>
                    {!section.on && !section.unsold && <Badge variant="secondary">{tr("مطفأ")}</Badge>}
                    {ownerOnly && <Badge variant="outline">{tr("يتحكم فيه صاحب النظام")}</Badge>}
                    {count > 0 && <span className="text-[14px] text-slate-500">{tr("{0} عنصر", count)}</span>}
                  </span>
                  {section.hint && <span className="block text-[15.5px] text-slate-600">{section.hint}</span>}
                  {section.unsold && <span className="block text-[14.5px] text-slate-500">{section.locked}</span>}
                </span>
              </button>
              <Control node={section} disabled={ownerOnly || pending} busy={busy === section.key} onChange={(v) => toggle(section, v)} />
            </div>
            {expanded && section.children.length > 0 && (
              <div className="divide-y divide-line border-t border-line">
                {section.children.map((part) => (
                  <Row key={part.key} node={part} parentOn={section.on} depth={0} pending={pending} busy={busy} onToggle={toggle} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <Dialog open={prompt !== null} onClose={() => setPrompt(null)} width="sm"
        title={prompt?.level === "block" ? tr("لا يمكن إطفاء {0} الآن", prompt?.node.label ?? "") : tr("إطفاء {0}؟", prompt?.node.label ?? "")}>
        {prompt && (
          <div className="space-y-5">
            <ul className="space-y-2.5">
              {prompt.messages.map((m) => (
                <li key={m} className="flex gap-2.5 leading-relaxed text-slate-700">
                  {prompt.level === "block" ? <OctagonX className="mt-0.5 size-5 shrink-0 text-urgent" /> : <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" />}
                  <span>{m}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              {prompt.level === "block" ? (
                <Button onClick={() => setPrompt(null)}>{tr("حسنًا")}</Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => setPrompt(null)}>{tr("تراجع")}</Button>
                  <Button variant="destructive" loading={pending} onClick={() => toggle(prompt.node, prompt.on, true)}>{tr("إطفاء رغم ذلك")}</Button>
                </>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Row({ node, parentOn, depth, pending, busy, onToggle }: {
  node: ViewNode; parentOn: boolean; depth: number; pending: boolean; busy: string | null; onToggle: (n: ViewNode, on: boolean) => void;
}) {
  const effective = parentOn && node.on;
  return (
    <>
      <div className={cn("flex items-center gap-4 py-3 pe-5", depth === 0 ? "ps-14" : "ps-24", !effective && "bg-subtle/60")} data-feature={node.key}>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-[16.5px] text-ink", depth === 0 && "font-medium", !effective && "text-slate-500")}>{node.label}</span>
            {node.kind !== "section" && <span className="rounded bg-subtle px-1.5 py-0.5 text-[12.5px] text-slate-600">{KIND[node.kind]()}</span>}
          </div>
          {node.locked ? <p className="text-[14px] text-slate-500">{node.locked}</p> : node.hint && <p className="text-[14px] text-slate-500">{node.hint}</p>}
        </div>
        <Control node={node} disabled={!parentOn || pending} busy={busy === node.key} onChange={(v) => onToggle(node, v)} />
      </div>
      {node.children.map((c) => (
        <Row key={c.key} node={c} parentOn={effective} depth={depth + 1} pending={pending} busy={busy} onToggle={onToggle} />
      ))}
    </>
  );
}

/** مفتاح التشغيل، أو قفل لما لا يُطفأ */
function Control({ node, disabled, busy, onChange }: { node: ViewNode; disabled: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  if (node.locked) {
    return <span className="flex items-center gap-1.5 text-[14px] text-slate-500" title={node.locked}><Lock className="size-4" />{node.unsold ? (node.kind === "section" ? tr("غير مشمول") : tr("موقوف")) : tr("أساسي")}</span>;
  }
  return (
    <button type="button" role="switch" aria-checked={node.on} aria-label={node.label} disabled={disabled || busy}
      onClick={() => onChange(!node.on)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        node.on ? "bg-success" : "bg-slate-300", busy && "animate-pulse")}>
      <span className={cn("absolute size-5 rounded-full bg-white shadow-sm transition-[inset-inline-start] duration-200", node.on ? "start-[22px]" : "start-0.5")} />
    </button>
  );
}

const countItems = (n: ViewNode): number => n.children.reduce((a, c) => a + 1 + countItems(c), 0);

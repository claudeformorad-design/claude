"use client";
import { tr } from "@/i18n/tr";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Plus, X } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};

const DialogContext = createContext<{ close: () => void } | null>(null);

/** يغلق النافذة المحيطة (إن وُجدت) بعد نجاح الحفظ */
export function useDialogClose() {
  return useContext(DialogContext)?.close;
}

/**
 * نافذة منبثقة في منتصف الشاشة: خلفية مغبشة، حواف ناعمة، وحركة دخول هادئة.
 * كل نماذج الإدخال في النظام تُفتح بها بدل العمود الجانبي.
 */
function Dialog({
  open, onClose, title, description, width = "md", children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
}) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <m.div
            className="absolute inset-0 bg-[#1f1d1b]/20 backdrop-blur-[6px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <m.div
            role="dialog" aria-modal="true"
            className={cn(
              "dialog-panel relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-white",
              width === "sm" ? "max-w-md" : width === "md" ? "max-w-xl" : width === "lg" ? "max-w-3xl" : "max-w-5xl",
            )}
            initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-2">
              <div className="space-y-1">
                <h2 className="text-[21px] font-bold text-ink">{title}</h2>
                {description && <p className="text-[15.5px] text-slate-500">{description}</p>}
              </div>
              <button type="button" onClick={onClose} aria-label={tr("إغلاق")}
                className="-me-2 grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-subtle hover:text-ink">
                <X className="size-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-7 pt-3 pb-7">
              <DialogContext.Provider value={{ close: onClose }}>{children}</DialogContext.Provider>
            </div>
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** زر يفتح نموذجًا في نافذة منبثقة */
export function FormDialog({
  label, title, description, width, variant, size, icon = true, className, children, defaultOpen = false,
}: {
  label: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: boolean;
  className?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {icon && <Plus className="size-4" />}{label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description} width={width}>{children}</Dialog>
    </>
  );
}

/**
 * نافذة مرتبطة بالرابط (?new=1 أو ?edit=...): تظهر ما دام الرابط يطلبها،
 * والإغلاق يعيد للرابط الأساسي.
 */
export function RouteDialog({
  closeHref, title, description, width, children,
}: {
  closeHref: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const close = () => { setOpen(false); router.push(closeHref, { scroll: false }); };
  return <Dialog open={open} onClose={close} title={title} description={description} width={width}>{children}</Dialog>;
}

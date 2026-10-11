"use client";
import { tr } from "@/i18n/tr";

import { useFeature } from "@/components/features/feature";
import { Button } from "@/components/ui/button";
import { whatsappLink } from "@/lib/whatsapp";

/** شعار واتساب مبسّط (لا يوجد في مكتبة الأيقونات) */
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  );
}

/**
 * زر يفتح واتساب بالرسالة جاهزة لرقم النزيل؛ الموظف يراجعها ويضغط إرسال.
 * {origin} في النص يُستبدل بعنوان النظام وقت الضغط (لروابط التقييم والدخول).
 */
export function WhatsAppButton({ phone, text, label, size = "sm", variant = "outline", className }: {
  phone: string | null; text: string; label: string; size?: "sm" | "default"; variant?: "outline" | "ghost" | "secondary"; className?: string;
}) {
  // أزرار واتساب يمكن إطفاؤها كلها من تخصيص النظام
  const on = useFeature("general.whatsapp");
  if (!on) return null;
  return (
    <Button type="button" size={size} variant={variant} className={className}
      title={phone ? `+${phone}` : tr("لا يوجد رقم؛ اختر المستلم من واتساب")}
      onClick={() => {
        const body = text.replaceAll("{origin}", window.location.origin);
        window.open(whatsappLink(phone, body), "_blank", "noopener,noreferrer");
      }}>
      <span className="text-[#1f9d55]"><WhatsAppIcon /></span>{label}
    </Button>
  );
}

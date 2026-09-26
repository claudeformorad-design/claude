"use client";

import React, { useState } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

export function ResetSystemButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleReset(clean: boolean) {
    const confirmText = clean
      ? "هل أنت أسطول من أنك تريد تهيئة النظام كبدء جديد ونظيف تماماً بدون حركات سابقة؟"
      : "هل تريد تحميل البيانات التجريبية والاختبارية؟";
    
    if (!window.confirm(confirmText)) return;

    setLoading(true);
    try {
      const res = await fetch("/api/system/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clean }),
      });
      const data = await res.json();
      if (data.success) {
        router.refresh();
        window.location.reload();
      }
    } catch (err) {
      console.error("Reset error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={loading}
        onClick={() => handleReset(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAF9] px-2.5 py-1 text-[11px] font-bold text-[#0F172A] hover:bg-white hover:border-[#FFD369] transition-all cursor-pointer shadow-2xs disabled:opacity-50"
        title="تصفير النظام وبدء حسابات جديدة"
      >
        <RotateCcw className={`size-3 text-[#D97706] ${loading ? "animate-spin" : ""}`} />
        <span>نظام جديد (تصفير)</span>
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => handleReset(false)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1 text-[11px] font-bold text-[#64748B] hover:text-[#0F172A] hover:border-[#FFD369] transition-all cursor-pointer shadow-2xs disabled:opacity-50 hidden md:inline-flex"
        title="تحميل حركات تجريبية للاختبار"
      >
        <Sparkles className="size-3 text-[#2563EB]" />
        <span>بيانات تجريبية</span>
      </button>
    </div>
  );
}

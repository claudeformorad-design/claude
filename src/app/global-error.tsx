"use client";

import React from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-[#F8FAF9] flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border border-[#CBD5E1] bg-white p-6 shadow-xs text-center space-y-4">
          <h2 className="text-xl font-bold text-[#0F172A]">حدث خطأ عام في النظام</h2>
          <p className="text-xs text-[#64748B]">
            {error?.message || "يرجى تحديث الصفحة أو المحاولة مرة أخرى."}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl bg-[#222831] px-4 py-2 text-xs font-bold text-[#FFD369] shadow-xs hover:bg-[#393E46]"
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}

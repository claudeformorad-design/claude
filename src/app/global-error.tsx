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
      <body style={{ fontFamily: "system-ui, sans-serif", background: "linear-gradient(135deg,#f6efe8,#dfe8f7)" }} className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-[28px] border border-white bg-white/80 p-8 shadow-xl text-center space-y-4">
          <h2 className="text-xl font-bold text-slate-900">حدث خطأ عام في النظام</h2>
          <p className="text-xs text-slate-500">
            {error?.message || "يرجى تحديث الصفحة أو المحاولة مرة أخرى."}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-full bg-slate-900 px-5 py-2.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}

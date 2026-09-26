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
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#edf1f6" }} className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-[20px] bg-white p-8 shadow-sm text-center space-y-4">
          <h2 className="text-xl font-bold text-slate-900">حدث خطأ عام في النظام</h2>
          <p className="text-xs text-slate-500">
            يرجى تحديث الصفحة أو المحاولة مرة أخرى.
            {error?.digest && <span className="mt-1 block text-slate-400">{error.digest}</span>}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-[10px] bg-slate-900 px-5 py-2.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}

import Link from "@/components/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-frame p-6 text-center">
      <p className="num text-5xl text-ink">404</p>
      <p className="text-[15px] text-ink">الصفحة غير موجودة</p>
      <Link href="/" className="mt-2 rounded-full bg-ink px-5 py-2.5 text-[13px] text-white hover:bg-ink-soft">
        العودة إلى النظام
      </Link>
    </main>
  );
}

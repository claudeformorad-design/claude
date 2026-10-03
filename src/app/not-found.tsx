import Link from "@/components/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-frame p-6 text-center">
      <p className="num text-5xl font-bold text-ink">404</p>
      <p className="text-[18.5px] text-ink">الصفحة غير موجودة</p>
      <Link href="/" className="mt-2 rounded-[10px] bg-ink px-5 py-2.5 text-[16.5px] font-medium text-white hover:bg-ink-soft">
        العودة إلى النظام
      </Link>
    </main>
  );
}

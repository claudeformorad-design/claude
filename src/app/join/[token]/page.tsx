import { tr } from "@/i18n/tr";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitch } from "@/components/language-switch";
import { JoinButton } from "./join-button";

/**
 * رابط دخول الموظف. الدخول بزر لا بمجرد فتح الصفحة، حتى لا تستهلك معاينات الروابط في تطبيقات المراسلة
 * الرابط قبل أن يفتحه الموظف نفسه.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="relative flex min-h-screen items-center justify-center p-4">
      <LanguageSwitch className="absolute end-4 top-4" />
      <div className="surface animate-rise w-full max-w-md space-y-4 p-8">
        <div className="flex items-center gap-3">
          <BrandMark className="size-11" />
          <p className="text-lg font-semibold text-ink">{tr("الدخول إلى النظام")}</p>
        </div>
        <p className="leading-relaxed text-slate-600">{tr("هذا رابط دخولك الخاص من المدير. اضغط دخول فيبقى جهازك مسجّلًا، والرابط لا يعمل بعدها لغيرك.")}</p>
        <JoinButton token={token} />
      </div>
    </main>
  );
}

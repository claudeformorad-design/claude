import { tr } from "@/i18n/tr";
import { AuthShell } from "@/components/auth-shell";
import { JoinButton } from "./join-button";

/**
 * رابط دخول الموظف. الدخول بزر لا بمجرد فتح الصفحة، حتى لا تستهلك معاينات الروابط في تطبيقات المراسلة
 * الرابط قبل أن يفتحه الموظف نفسه.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthShell>
      <div className="space-y-5 text-center">
        <p className="text-[16px] leading-relaxed text-slate-600">{tr("هذا رابط دخولك الخاص من المدير. اضغط دخول فيبقى جهازك مسجّلًا.")}</p>
        <JoinButton token={token} />
        <p className="text-[14px] text-slate-500">{tr("الرابط يعمل مرة واحدة فقط، فلا تشاركه مع أحد.")}</p>
      </div>
    </AuthShell>
  );
}

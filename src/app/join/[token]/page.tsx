import { tr } from "@/i18n/tr";
import { ShieldCheck } from "lucide-react";
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
      <div className="space-y-7">
        <div className="space-y-3">
          <h1 className="text-[30px] font-bold text-ink">{tr("مرحبًا بك")}</h1>
          <p className="text-[16.5px] leading-relaxed text-slate-600">{tr("هذا رابط دخولك الخاص من المدير. اضغط دخول فيبقى جهازك مسجّلًا.")}</p>
        </div>
        <JoinButton token={token} />
        <p className="flex items-start gap-2.5 text-[14.5px] leading-relaxed text-slate-500">
          <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-success" />
          {tr("الرابط يعمل مرة واحدة فقط، فلا تشاركه مع أحد.")}
        </p>
      </div>
    </AuthShell>
  );
}

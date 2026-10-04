import { currentLocale, tr } from "@/i18n/tr";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitch } from "@/components/language-switch";
import { anonRpc } from "@/lib/supabase/public-rpc";
import { SurveyForm } from "./survey-form";

type Info = { hotel_name: string; hotel_name_en: string | null; guest_name: string; room_number: string | null; valid: boolean };

/** صفحة تقييم النزيل: تفتح من جهاز الاستقبال أو برابطه، بلا تسجيل دخول، ولمرة واحدة */
export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data } = /^[0-9a-f]{64}$/.test(token) ? await anonRpc<Info[]>("survey_info", { p_token: token }) : { data: null };
  const info = data?.[0];
  const hotel = info ? (currentLocale() === "en" && info.hotel_name_en) || info.hotel_name : "";

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-panel p-4">
      <LanguageSwitch className="absolute end-4 top-4" />
      <div className="surface w-full max-w-xl p-8">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark className="size-11" />
          <div>
            <p className="text-lg font-semibold text-ink">{hotel || tr("تقييم الإقامة")}</p>
            {info?.valid && <p className="text-slate-500">{info.guest_name ? tr("أهلًا {0}، رأيك يهمنا", info.guest_name) : tr("رأيك يهمنا")}</p>}
          </div>
        </div>
        {info?.valid ? <SurveyForm token={token} /> : (
          <div className="py-8 text-center">
            <p className="text-[20px] font-semibold text-ink">{info ? tr("شكرًا لك") : tr("الرابط غير صحيح")}</p>
            <p className="mt-2 text-slate-600">{info ? tr("وصل تقييم هذه الإقامة من قبل، أو انتهت مدة الرابط.") : tr("تأكد من الرابط أو اطلبه من الاستقبال.")}</p>
          </div>
        )}
      </div>
    </main>
  );
}

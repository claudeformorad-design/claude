import { currentLocale } from "@/i18n/tr";

type Named = { name_ar: string; name_en?: string | null };

/** الاسم بلغة الواجهة: الإنجليزي إن وُجد في الواجهة الإنجليزية، وإلا العربي */
export const localName = (x: Named) => (currentLocale() === "en" && x.name_en) || x.name_ar;
export const localNameOf = (x: Named | null | undefined) => (x ? localName(x) : "");

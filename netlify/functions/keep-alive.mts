/**
 * تنشيط يومي لقاعدة بيانات الفندق: مشروع Supabase المجاني يُوقف تلقائيًا إن لم يُستخدم أسبوعًا،
 * فتقرأ هذه المهمة المجدولة صفًا واحدًا كل يوم (قراءة فقط، لا تكتب شيئًا) ليبقى المشروع نشطًا
 * حتى لو لم يفتح أحد النظام. تعمل لكل موقع فندق على Netlify بمتغيراته هو، فلا تحتاج إعدادًا.
 */
export default async () => {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return new Response("not configured", { status: 200 });
  try {
    const res = await fetch(`${url}/rest/v1/currencies?select=code&limit=1`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    console.log(`keep-alive: database answered ${res.status}`);
    return new Response(`ok ${res.status}`, { status: 200 });
  } catch (e) {
    console.error("keep-alive failed", e);
    return new Response("failed", { status: 200 });
  }
};

export const config = { schedule: "@daily" };

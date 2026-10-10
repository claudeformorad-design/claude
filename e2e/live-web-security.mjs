// فحص أمني لطبقة الويب على النسخة المنشورة: رؤوس الأمان، الصفحات والواجهات بلا دخول، الطلبات من موقع آخر، صفحة الاستبيان العامة
// التشغيل: BASE_URL=https://... node e2e/live-web-security.mjs
const BASE = process.env.BASE_URL;
if (!BASE) throw new Error("BASE_URL required");
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
const get = (path, init = {}) => fetch(BASE + path, { redirect: "manual", ...init });

// رؤوس الأمان على صفحة الدخول
const login = await get("/login");
const h = login.headers;
const csp = h.get("content-security-policy") ?? "";
check("CSP with per-request nonce", /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/.test(csp), csp.slice(0, 90));
check("CSP blocks framing and plugins", csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"));
check("CSP forbids eval in production", !csp.includes("unsafe-eval"));
check("HSTS", /max-age=\d{7,}/.test(h.get("strict-transport-security") ?? ""), h.get("strict-transport-security") ?? "missing");
check("X-Frame-Options DENY", h.get("x-frame-options") === "DENY");
check("nosniff", h.get("x-content-type-options") === "nosniff");
check("Referrer-Policy", h.get("referrer-policy") === "strict-origin-when-cross-origin");
check("no X-Powered-By", !h.get("x-powered-by"));
const nonce2 = ((await get("/login")).headers.get("content-security-policy") ?? "").match(/nonce-([^']+)/)?.[1];
check("nonce changes every request", !!nonce2 && !csp.includes(nonce2));

// الصفحات المحمية تحوّل لصفحة الدخول
for (const p of ["/", "/accounts", "/journal", "/folios", "/settings/users", "/settings/hotel", "/reports/trial-balance", "/assistant", "/print/voucher/00000000-0000-0000-0000-000000000000"]) {
  const r = await get(p);
  check(`protected page ${p}`, r.status === 307 || r.status === 308 ? (r.headers.get("location") ?? "").includes("/login") : false, `${r.status} ${r.headers.get("location") ?? ""}`);
}
// الواجهات البرمجية ترفض بلا جلسة
for (const [p, init] of [
  ["/api/export/trial-balance", {}], ["/api/backup", {}], ["/api/import-template/rooms", {}],
  ["/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "x" }) }],
]) {
  const r = await get(p, init);
  check(`API without session ${p}`, r.status === 401 || r.status === 400 || r.status === 307, String(r.status));
}
// طلب Server Action من موقع آخر يُرفض (حماية CSRF)
{
  const r = await get("/login", { method: "POST", headers: { "Next-Action": "0".repeat(42), Origin: "https://evil.example", "Content-Type": "text/plain;charset=UTF-8" }, body: "[]" });
  check("cross-site server action rejected", r.status >= 400, String(r.status));
}
// صفحة الاستبيان العامة: رمز غير صحيح لا يكشف شيئًا
{
  const r = await get(`/survey/${"a".repeat(64)}`);
  const body = await r.text();
  check("survey with unknown token", r.status === 200 && /الرابط غير صحيح|Invalid link/.test(body), String(r.status));
  const r2 = await get("/survey/' or 1=1--");
  check("survey with malformed token", r2.status === 200 || r2.status === 404, String(r2.status));
}
// المسارات الحساسة غير موجودة
for (const p of ["/.env", "/.git/config", "/supabase/migrations", "/package.json"]) {
  const r = await get(p);
  check(`not exposed ${p}`, r.status === 404 || r.status === 307, String(r.status));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

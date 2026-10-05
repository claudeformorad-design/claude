// خادم Supabase محاكي صغير لاختبار شاشات النسخة المنشورة بلا مساس بقاعدة الإنتاج.
// يحاكي: التحقق من المستخدم، وجداول قليلة بحالة في الذاكرة، ودوال RPC التي تحتاجها شاشة إعدادات الفندق والفورمات.
// الحالة: فندق تجريبي واحد، وصاحب النظام مسجّل دخوله. factory_reset يمسح الفنادق كما تفعل الدالة الحقيقية.
import http from "node:http";

export const OWNER = "11111111-1111-4111-8111-111111111111";
export const STAFF = "22222222-2222-4222-8222-222222222222";
const HOTEL = "33333333-3333-4333-8333-333333333333";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** رمز دخول بخوارزمية HS256: عميل Supabase يتحقق منه عبر /auth/v1/user فلا يحتاج توقيعًا حقيقيًا */
export const tokenFor = (sub) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, email: `${sub === OWNER ? "admin" : "staff"}@nazeel.local`, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 * 24, session_id: "s1" })}.sig`;
export const sessionCookie = (sub) => `base64-${Buffer.from(JSON.stringify({
  access_token: tokenFor(sub), refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400,
  user: { id: sub, email: "x@nazeel.local", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
})).toString("base64url")}`;

const hotelRow = () => ({
  id: HOTEL, name_ar: "فندق الاختبار", name_en: null, legal_name: null, tax_number: null, commercial_registration: null, address: null, phone: null, email: null,
  timezone: "Asia/Riyadh", base_currency: "SAR", country_code: "SA", total_rooms: 10, is_active: true, enabled_modules: ["accounting", "pms"],
  check_in_time: "14:00:00", check_out_time: "12:00:00", weekend_nights: [4, 5], require_cashier_shift: false, room_access: "card",
  journal_approval_threshold: null, voucher_approval_threshold: null, fiscal_year_start_month: 1,
});

export function startMockSupabase(port = 54399) {
  const state = { hotels: [hotelRow()], calls: [], failReset: false };
  const userOf = (req) => {
    const m = /Bearer (.+)/.exec(req.headers.authorization ?? "");
    if (!m || m[1].split(".").length !== 3) return null;
    try { return JSON.parse(Buffer.from(m[1].split(".")[1], "base64url").toString()); } catch { return null; }
  };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const user = userOf(req);
      const send = (status, data, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(data === undefined ? "" : JSON.stringify(data)); };
      const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
      state.calls.push(`${req.method} ${url.pathname}`);
      if (url.pathname === "/auth/v1/user") return user?.sub ? send(200, { id: user.sub, email: user.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} }) : send(401, { message: "invalid" });
      if (url.pathname.startsWith("/auth/v1/logout")) return send(204);
      const owner = user?.sub === OWNER;
      const member = owner || user?.sub === STAFF;
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = url.pathname.slice("/rest/v1/rpc/".length);
        const args = body ? JSON.parse(body) : {};
        if (fn === "system_has_owner") return send(200, true);
        if (fn === "is_system_owner") return send(200, owner);
        if (fn === "my_permissions") return send(200, member && state.hotels.length ? ["settings.hotel.manage", "coa.accounts.view", "pms.view"] : []);
        if (fn === "my_interface") return send(200, {});
        if (fn === "factory_reset") {
          if (!owner) return send(403, { code: "42501", message: "Only the system owner can format the system" });
          if ((args.p_confirm ?? "").trim() !== "فورمات") return send(400, { code: "22023", message: "Type the confirmation word to format the system" });
          if (state.failReset) return send(500, { code: "XX000", message: "connection lost" });
          state.hotels = [];
          return send(204);
        }
        return send(200, null);
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.slice("/rest/v1/".length);
        let rows = [];
        if (table === "hotels") rows = member ? state.hotels : [];
        if (table === "users_profiles") rows = user ? [{ id: user.sub, full_name: owner ? "مدير النظام" : "موظف", default_hotel_id: state.hotels[0]?.id ?? null, must_change_password: false, password_chosen: true, is_active: true, language: "ar" }] : [];
        if (table === "currencies") rows = [{ code: "SAR", name_ar: "ريال سعودي", name_en: "Saudi Riyal" }];
        if (req.method === "HEAD") return send(200, undefined, { "Content-Range": `0-0/${rows.length}` });
        if (single) return rows[0] ? send(200, rows[0]) : send(406, { code: "PGRST116", message: "no rows" });
        return send(200, rows, { "Content-Range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
      }
      send(404, { message: "not mocked" });
    });
  });
  server.listen(port, "127.0.0.1");
  return { server, state };
}

if (import.meta.url === `file://${process.argv[1]}`) startMockSupabase(Number(process.env.PORT ?? 54399));

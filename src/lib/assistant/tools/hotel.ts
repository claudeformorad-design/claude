import "server-only";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { isIsoDate, startOfDayInTimeZone } from "@/lib/accounting/fiscal";
import type { ReservationStatus } from "@/lib/supabase/database.types";
import {
  frontDeskSummary, getGuest, getReservation, listReservations, listRooms, listRoomTypes, nightAuditStatus, quoteReservation, roomTypeAvailability,
} from "@/services/pms.service";
import { getRoomStats } from "@/services/financial.service";
import { listHousekeepingTasks } from "@/services/operations.service";
import {
  type ToolEnv, type ToolModule, addDays, asStr, dateArg, denied, fn, int, intArg, monthStart, obj, pct, round2, safe, str, today,
} from "./shared";

/** أدوات إدارة الفندق: الحجوزات والنزلاء والتوفر والتسعير والإشغال ونقاط البيع والتدبير الفندقي */

const ACTIVE: ReservationStatus[] = ["tentative", "confirmed", "checked_in"];
const resPath = (id: string) => `/reservations/${id}`;
const STATUS_AR: Record<ReservationStatus, string> = {
  tentative: "مبدئي", confirmed: "مؤكد", checked_in: "مقيم", checked_out: "غادر", cancelled: "ملغى", no_show: "لم يحضر",
};

type ResLike = {
  id: string; confirmation_number: string; status: ReservationStatus; arrival_date: string; departure_date: string; total_amount: string;
  adults?: number; children?: number; source?: string;
  guest?: { full_name: string; phone?: string | null } | null; room?: { room_number: string } | null; room_type?: { code: string; name_ar: string } | null;
};
const brief = (r: ResLike) => ({
  confirmation: r.confirmation_number, guest: r.guest?.full_name ?? null, room: r.room?.room_number ?? null, room_type: r.room_type?.name_ar ?? null,
  arrival: r.arrival_date, departure: r.departure_date, status: STATUS_AR[r.status] ?? r.status, total: round2(Number(r.total_amount)), path: resPath(r.id),
});

const needPms = (env: ToolEnv) => (env.ctx.can(PERMISSIONS.pmsView) ? null : denied("الحجوزات"));

export const hotel: ToolModule = {
  specs: [
    fn("hotel_search", "يبحث في الحجوزات برقم التأكيد أو اسم النزيل، أو في النزلاء بالاسم أو الجوال أو رقم الهوية. يعيد المعرّف ومسار الصفحة path لوضع رابط مباشر.",
      obj({ kind: str("النوع", ["reservation", "guest"]), query: str("نص البحث، ويمكن تركه فارغًا لآخر السجلات") }, ["kind"])),
    fn("reservation_details", "تفاصيل حجز كامل: النزيل والغرفة والنوع والتواريخ والحالة والمصدر والليالي بأسعارها ومواسمها والعميل والمجموعة والملاحظات.",
      obj({ id: str("معرّف الحجز uuid من hotel_search") }, ["id"])),
    fn("availability_quote", "التوفر والتسعير لفترة إقامة: لكل نوع غرفة ليلي عدد المتاح في أضيق ليلة والسعر الإجمالي وتفصيل الليالي حسب المواسم. استخدمه لسؤال هل يوجد غرف وكم السعر.",
      obj({ arrival: str("تاريخ الوصول YYYY-MM-DD، والافتراضي اليوم"), departure: str("تاريخ المغادرة YYYY-MM-DD، والافتراضي بعد ليلة"), room_type: str("رمز نوع الغرفة أو اسمه، اختياري") })),
    fn("day_movements", "حركة يوم محدد: الوصول المتوقع، والمغادرة، والمقيمون، ومن لم يسجل وصوله بعد، ومن تأخر عن المغادرة، مع روابط الحجوزات.",
      obj({ date: str("اليوم YYYY-MM-DD، والافتراضي اليوم") })),
    fn("occupancy_forecast", "توقع الإشغال للأيام القادمة من الحجوزات الحالية: لكل يوم الطاقة والمباع والمتاح ونسبة الإشغال، ولكل نوع غرفة متوسط إشغاله، مع أداء الشهر الحالي حتى اليوم: متوسط سعر الغرفة والإيراد لكل غرفة متاحة. مناسب للرسوم البيانية.",
      obj({ days: int("عدد الأيام من 1 إلى 60، والافتراضي 14") })),
    fn("guest_profile", "ملف نزيل كامل: بياناته وكل حجوزاته السابقة والقادمة وعدد الإقامات والليالي وإجمالي ما أنفقه وآخر زيارة وحالة الحظر.",
      obj({ id: str("معرّف النزيل uuid من hotel_search") }, ["id"])),
    fn("pos_sales", "مبيعات نقاط البيع لفترة: الإجمالي وعدد الطلبات ومتوسط الطلب، والتوزيع حسب المنفذ وطريقة التسوية على الغرفة أو مدفوع، وأكثر الأصناف مبيعًا. الافتراضي اليوم.",
      obj({ from: str("بداية الفترة YYYY-MM-DD"), to: str("نهاية الفترة YYYY-MM-DD") })),
    fn("housekeeping_status", "حالة الغرف والتدبير الفندقي: الغرف النظيفة والمتسخة والمفحوصة وخارج الخدمة مع أرقامها، ومهام اليوم حسب الحالة والمسؤول.",
      obj({ date: str("يوم المهام YYYY-MM-DD، والافتراضي اليوم") })),
  ],
  run: {
    async hotel_search(env, a) {
      const no = needPms(env); if (no) return no;
      const { ctx } = env;
      const s = ctx.supabase, h = ctx.hotel.id, q = safe(a.query), like = `%${q}%`;
      if (asStr(a.kind) === "guest") {
        let r = s.from("guests").select("id, full_name, phone, nationality, is_blacklisted").eq("hotel_id", h);
        if (q) r = r.or(`full_name.ilike.${like},phone.ilike.${like},id_number.ilike.${like}`);
        const { data, error } = await r.limit(15);
        return error ? { error: error.message } : (data ?? []).map((g) => ({ ...g, path: `/guests/${g.id}` }));
      }
      const cols = "id, confirmation_number, status, arrival_date, departure_date, total_amount::text, guest:guests(full_name), room:rooms(room_number), room_type:room_types(code, name_ar)";
      let r = s.from("reservations").select(cols).eq("hotel_id", h);
      if (q) r = r.ilike("confirmation_number", like);
      const first = await r.order("arrival_date", { ascending: false }).limit(15);
      if (first.error) return { error: first.error.message };
      let rows = (first.data ?? []) as unknown as ResLike[];
      if (q && !rows.length) {
        const { data: guests } = await s.from("guests").select("id").eq("hotel_id", h).ilike("full_name", like).limit(20);
        const ids = (guests ?? []).map((g) => g.id);
        if (ids.length) {
          const second = await s.from("reservations").select(cols).eq("hotel_id", h).in("guest_id", ids).order("arrival_date", { ascending: false }).limit(15);
          if (second.error) return { error: second.error.message };
          rows = (second.data ?? []) as unknown as ResLike[];
        }
      }
      return rows.map((x) => ({ id: x.id, ...brief(x) }));
    },
    async reservation_details(env, a) {
      const no = needPms(env); if (no) return no;
      const { ctx } = env;
      const r = await getReservation(env.ctx.supabase, env.ctx.hotel.id, asStr(a.id));
      if (!r) return { error: "الحجز غير موجود" };
      return {
        ...brief(r), id: r.id, adults: r.adults, children: r.children, source: r.source, pricing: r.pricing, booking_mode: r.booking_mode,
        phone: r.guest?.phone ?? null, customer: r.customer?.name_ar ?? null, group: r.group?.name ?? null, bill_to: r.bill_to,
        special_requests: r.special_requests, notes: r.notes, cancellation_reason: r.cancellation_reason,
        checked_in_at: r.checked_in_at, checked_out_at: r.checked_out_at, keys_handed_over: r.keys_issued, room_access: ctx.hotel.room_access === "key" ? "مفتاح" : "بطاقة", folio_path: r.folio_id ? `/folios/${r.folio_id}` : null,
        nights: r.nights.map((n) => ({ date: n.stay_date, rate: Number(n.rate), discount: Number(n.discount), amount: Number(n.amount), season: n.season_name, posted: Boolean(n.folio_transaction_id) })),
      };
    },
    async availability_quote(env, a) {
      const no = needPms(env); if (no) return no;
      const { ctx } = env;
      const arrival = dateArg(a.arrival, today(env));
      const departure = isIsoDate(asStr(a.departure)) && asStr(a.departure) > arrival ? asStr(a.departure) : addDays(arrival, 1);
      const want = asStr(a.room_type).trim().toLowerCase();
      const types = (await listRoomTypes(ctx.supabase, ctx.hotel.id))
        .filter((t) => t.is_active && t.booking_mode === "nightly")
        .filter((t) => !want || t.code.toLowerCase() === want || t.name_ar.toLowerCase().includes(want));
      if (!types.length) return { error: "لا يوجد نوع غرفة ليلي مطابق" };
      const avail = (await roomTypeAvailability(ctx.supabase, ctx.hotel.id, arrival, departure)) as { room_type_id: string; available: number; capacity: number }[];
      const quotes = await Promise.all(types.map(async (t) => {
        const rows = avail.filter((x) => x.room_type_id === t.id);
        const minAvail = rows.length ? Math.min(...rows.map((x) => Number(x.available))) : null;
        const q = await quoteReservation(ctx.supabase, ctx.hotel.id, { roomTypeId: t.id, arrival, departure, pricing: "standard" }).catch(() => null);
        return {
          room_type: t.name_ar, code: t.code, max_adults: t.max_adults, available_rooms: minAvail, can_book: (minAvail ?? 0) > 0,
          nights: q?.nights ?? null, total: q ? round2(Number(q.total)) : null, average_night: q && q.nights ? round2(Number(q.total) / q.nights) : null,
          discount: q ? round2(Number(q.discount)) : null, last_minute_pct: q?.last_minute_pct ?? null, lines: q?.lines ?? [],
        };
      }));
      return { currency: ctx.hotel.base_currency, arrival, departure, quotes, new_booking_path: "/reservations/new", note: "الأسعار حسب أسعار النوع والمواسم وقواعد آخر لحظة، قبل أي سعر خاص" };
    },
    async day_movements(env, a) {
      const no = needPms(env); if (no) return no;
      const { ctx } = env;
      const day = dateArg(a.date, today(env));
      const [arr, dep, house] = await Promise.all([
        listReservations(ctx.supabase, ctx.hotel.id, { arrivalOn: day, statuses: [...ACTIVE, "checked_out", "no_show"] }),
        listReservations(ctx.supabase, ctx.hotel.id, { departureOn: day, statuses: ["confirmed", "checked_in", "checked_out"] }),
        listReservations(ctx.supabase, ctx.hotel.id, { statuses: ["checked_in"] }),
      ]);
      const overdue = house.filter((r) => r.departure_date < day);
      return {
        date: day,
        counts: {
          arrivals: arr.length, arrived: arr.filter((r) => r.status === "checked_in" || r.status === "checked_out").length,
          not_arrived_yet: arr.filter((r) => r.status === "confirmed" || r.status === "tentative").length,
          departures: dep.length, departed: dep.filter((r) => r.status === "checked_out").length, in_house: house.length, overstays: overdue.length,
        },
        arrivals: arr.map(brief), departures: dep.map(brief), in_house: house.slice(0, 40).map(brief), overstays: overdue.map(brief),
      };
    },
    async occupancy_forecast(env, a) {
      const no = needPms(env); if (no) return no;
      const { ctx } = env;
      const days = intArg(a.days, 14, 1, 60), from = today(env), to = addDays(from, days - 1);
      // نهاية الفترة في دالة التوفر غير مشمولة، فنمرر اليوم التالي لآخر يوم
      const [types, avail, stats] = await Promise.all([
        listRoomTypes(ctx.supabase, ctx.hotel.id),
        roomTypeAvailability(ctx.supabase, ctx.hotel.id, from, addDays(to, 1)) as Promise<{ room_type_id: string; stay_date: string; capacity: number; sold: number; available: number }[]>,
        ctx.can(PERMISSIONS.financialView) ? getRoomStats(ctx.supabase, ctx.hotel.id, monthStart(from), from).catch(() => null) : null,
      ]);
      const byDay = new Map<string, { date: string; capacity: number; sold: number; available: number }>();
      const byType = new Map<string, { capacity: number; sold: number }>();
      for (const r of avail) {
        const d = byDay.get(r.stay_date) ?? { date: r.stay_date, capacity: 0, sold: 0, available: 0 };
        d.capacity += Number(r.capacity); d.sold += Number(r.sold); d.available += Number(r.available);
        byDay.set(r.stay_date, d);
        const t = byType.get(r.room_type_id) ?? { capacity: 0, sold: 0 };
        t.capacity += Number(r.capacity); t.sold += Number(r.sold);
        byType.set(r.room_type_id, t);
      }
      const daily = [...byDay.values()].sort((x, y) => x.date.localeCompare(y.date)).map((d) => ({ ...d, occupancy_pct: pct(d.sold, d.capacity) }));
      const cap = daily.reduce((s, d) => s + d.capacity, 0), sold = daily.reduce((s, d) => s + d.sold, 0);
      const k = stats?.kpis;
      return {
        from, to, average_occupancy_pct: pct(sold, cap),
        peak_day: daily.length ? daily.reduce((b, d) => ((d.occupancy_pct ?? 0) > (b.occupancy_pct ?? 0) ? d : b)) : null,
        lowest_day: daily.length ? daily.reduce((b, d) => ((d.occupancy_pct ?? 0) < (b.occupancy_pct ?? 0) ? d : b)) : null,
        daily,
        by_room_type: types.filter((t) => byType.has(t.id)).map((t) => ({ room_type: t.name_ar, occupancy_pct: pct(byType.get(t.id)!.sold, byType.get(t.id)!.capacity) })),
        month_to_date: k ? {
          currency: ctx.hotel.base_currency, occupancy_pct: k.occupancy ? round2(k.occupancy.toNumber()) : null,
          adr: k.adr ? round2(k.adr.toNumber()) : null, revpar: k.revpar ? round2(k.revpar.toNumber()) : null,
          room_revenue: round2(k.roomRevenue.toNumber()), room_nights: k.roomNightsSold.toNumber(),
        } : null,
      };
    },
    async guest_profile(env, a) {
      const no = needPms(env); if (no) return no;
      const { ctx } = env;
      const g = await getGuest(ctx.supabase, ctx.hotel.id, asStr(a.id));
      if (!g) return { error: "النزيل غير موجود" };
      const res = await listReservations(ctx.supabase, ctx.hotel.id, { guestId: g.id });
      const day = today(env);
      const stays = res.filter((r) => r.status === "checked_out" || r.status === "checked_in");
      const nights = stays.reduce((s, r) => s + Math.max(0, Math.round((Date.parse(r.departure_date) - Date.parse(r.arrival_date)) / 86_400_000)), 0);
      return {
        name: g.full_name, phone: g.phone, email: g.email, nationality: g.nationality, id_type: g.id_type, notes: g.notes,
        blacklisted: g.is_blacklisted, blacklist_reason: g.blacklist_reason, path: `/guests/${g.id}`,
        stats: {
          reservations: res.length, stays: stays.length, nights, total_spent: round2(stays.reduce((s, r) => s + Number(r.total_amount), 0)),
          cancelled: res.filter((r) => r.status === "cancelled").length, no_shows: res.filter((r) => r.status === "no_show").length,
          last_stay: stays.length ? stays.map((r) => r.departure_date).sort().at(-1) : null,
        },
        upcoming: res.filter((r) => r.arrival_date >= day && ACTIVE.includes(r.status)).map(brief),
        history: res.filter((r) => !(r.arrival_date >= day && ACTIVE.includes(r.status))).sort((x, y) => y.arrival_date.localeCompare(x.arrival_date)).slice(0, 15).map(brief),
      };
    },
    async pos_sales(env, a) {
      const { ctx } = env;
      if (!ctx.can(PERMISSIONS.posSell) && !ctx.can(PERMISSIONS.posManage)) return denied("نقاط البيع");
      const to = dateArg(a.to, today(env));
      const from = isIsoDate(asStr(a.from)) && asStr(a.from) <= to ? asStr(a.from) : to;
      const [orders, outlets] = await Promise.all([
        ctx.supabase.from("pos_orders").select("id, outlet_id, order_number, settle_mode, total::text, created_at")
          .eq("hotel_id", ctx.hotel.id).gte("created_at", startOfDayInTimeZone(from, ctx.hotel.timezone)).lt("created_at", startOfDayInTimeZone(addDays(to, 1), ctx.hotel.timezone)).limit(5000),
        ctx.supabase.from("pos_outlets").select("id, name_ar").eq("hotel_id", ctx.hotel.id),
      ]);
      if (orders.error) return { error: orders.error.message };
      const list = (orders.data ?? []) as unknown as { id: string; outlet_id: string; settle_mode: "room" | "paid"; total: string }[];
      const name = new Map((outlets.data ?? []).map((o) => [o.id, o.name_ar]));
      const total = round2(list.reduce((s, o) => s + Number(o.total), 0));
      const group = <K extends string>(key: (o: (typeof list)[number]) => K) => {
        const m = new Map<K, { orders: number; total: number }>();
        for (const o of list) { const g = m.get(key(o)) ?? { orders: 0, total: 0 }; g.orders++; g.total = round2(g.total + Number(o.total)); m.set(key(o), g); }
        return [...m.entries()].map(([k, v]) => ({ key: k, ...v, share_pct: pct(v.total, total) })).sort((x, y) => y.total - x.total);
      };
      const items = new Map<string, { item: string; quantity: number; sales: number }>();
      const ids = list.map((o) => o.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await ctx.supabase.from("pos_order_lines").select("name_ar, quantity::text, unit_price::text").in("order_id", ids.slice(i, i + 200));
        for (const l of (data ?? []) as unknown as { name_ar: string; quantity: string; unit_price: string }[]) {
          const it = items.get(l.name_ar) ?? { item: l.name_ar, quantity: 0, sales: 0 };
          it.quantity = round2(it.quantity + Number(l.quantity)); it.sales = round2(it.sales + Number(l.quantity) * Number(l.unit_price));
          items.set(l.name_ar, it);
        }
      }
      return {
        currency: ctx.hotel.base_currency, from, to, orders: list.length, total, average_order: list.length ? round2(total / list.length) : 0,
        by_outlet: group((o) => name.get(o.outlet_id) ?? "منفذ").map(({ key, ...r }) => ({ outlet: key, ...r })),
        by_settlement: group((o) => (o.settle_mode === "room" ? "على الغرفة" : "مدفوع")).map(({ key, ...r }) => ({ settlement: key, ...r })),
        top_items: [...items.values()].sort((x, y) => y.sales - x.sales).slice(0, 10),
      };
    },
    async housekeeping_status(env, a) {
      const { ctx } = env;
      if (!ctx.can(PERMISSIONS.pmsHousekeeping) && !ctx.can(PERMISSIONS.pmsView)) return denied("التدبير الفندقي");
      const day = dateArg(a.date, today(env));
      const [rooms, tasks] = await Promise.all([listRooms(ctx.supabase, ctx.hotel.id), listHousekeepingTasks(ctx.supabase, ctx.hotel.id, day)]);
      const active = rooms.filter((r) => r.is_active);
      const num = new Map(rooms.map((r) => [r.id, r.room_number]));
      const pick = (f: (r: (typeof active)[number]) => boolean) => active.filter(f).map((r) => r.room_number);
      const KIND: Record<string, string> = { departure: "مغادرة", stayover: "إقامة مستمرة", inspection: "فحص", maintenance: "صيانة", turndown: "تجهيز مسائي" };
      const STATUS: Record<string, string> = { pending: "معلقة", in_progress: "جارية", done: "منجزة", cancelled: "ملغاة" };
      return {
        date: day, total_rooms: active.length,
        rooms: {
          clean: pick((r) => r.housekeeping_status === "clean"), dirty: pick((r) => r.housekeeping_status === "dirty"),
          inspected: pick((r) => r.housekeeping_status === "inspected"),
          out_of_service: active.filter((r) => r.service_status === "out_of_service").map((r) => ({ room: r.room_number, note: r.service_note })),
        },
        tasks: {
          total: tasks.length,
          by_status: Object.entries(STATUS).map(([k, v]) => ({ status: v, count: tasks.filter((t) => t.status === k).length })),
          open: tasks.filter((t) => t.status === "pending" || t.status === "in_progress").map((t) => ({
            room: num.get(t.room_id) ?? null, kind: KIND[t.kind] ?? t.kind, status: STATUS[t.status] ?? t.status, assignee: t.assignee, priority: t.priority,
          })),
        },
        path: "/housekeeping",
      };
    },
  },
  async snapshot({ ctx }) {
    if (!ctx.can(PERMISSIONS.pmsView)) return { front_desk: "لا صلاحية أو القسم غير مفعّل", night_audit: "لا صلاحية أو القسم غير مفعّل" };
    const h = ctx.hotel.id;
    const [desk, audit] = await Promise.all([frontDeskSummary(ctx.supabase, h).catch(() => null), nightAuditStatus(ctx.supabase, h).catch(() => null)]);
    return {
      front_desk: desk ?? "القسم غير مفعّل",
      night_audit: audit ? {
        business_date: audit.date, done: audit.done, last_audit: audit.last_audit, unposted_nights: audit.unposted_nights,
        unposted_amount: audit.unposted_amount, pending_no_shows: audit.pending_no_shows.length, overstays: audit.overstays.length,
        open_shifts: audit.open_shifts, occupancy: audit.stats,
      } : "القسم غير مفعّل",
    };
  },
};

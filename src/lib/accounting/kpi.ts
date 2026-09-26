import { type Money, type MoneyInput, ZERO, toMoney } from "./money";

/**
 * مؤشرات الأداء الفندقية القياسية:
 *  - الإشغال % = الليالي المباعة / الليالي المتاحة × 100
 *  - ADR (متوسط سعر الغرفة) = إيراد الغرف / الليالي المباعة
 *  - RevPAR (الإيراد لكل غرفة متاحة) = إيراد الغرف / الليالي المتاحة = الإشغال × ADR
 * القسمة على صفر ⇒ null (لا يُعرض رقم مضلل)
 */
export interface RoomDay { room_nights: MoneyInput; room_revenue: MoneyInput; rooms_available: number }

export interface RoomKpis {
  roomNightsSold: Money;
  roomNightsAvailable: Money;
  roomRevenue: Money;
  occupancy: Money | null;
  adr: Money | null;
  revpar: Money | null;
}

export function roomKpis(days: readonly RoomDay[]): RoomKpis {
  let sold = ZERO, available = ZERO, revenue = ZERO;
  for (const d of days) {
    sold = sold.plus(toMoney(d.room_nights));
    available = available.plus(d.rooms_available);
    revenue = revenue.plus(toMoney(d.room_revenue));
  }
  return {
    roomNightsSold: sold,
    roomNightsAvailable: available,
    roomRevenue: revenue,
    occupancy: available.isZero() ? null : sold.div(available).times(100),
    adr: sold.isZero() ? null : revenue.div(sold),
    revpar: available.isZero() ? null : revenue.div(available),
  };
}

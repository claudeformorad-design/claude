import { tr } from "@/i18n/tr";
import type { Dictionary } from "@/i18n/dictionaries/ar";

/**
 * تخصيص النظام: كل ما يمكن إطفاؤه لفندق على ثلاثة مستويات (قسم، جزء من قسم، خانة أو زر).
 * القسم يتحكم فيه صاحب النظام (ما اشتراه الفندق)، والأجزاء والخانات والأزرار يتحكم فيها مدير الفندق.
 *
 * ما يُطفأ:
 *  - hrefs: صفحاته تختفي من القائمة وتُمنع إن فُتحت برابطها
 *  - permissions: صلاحياته الخاصة تسقط من كل موظفي الفندق، فيُمنع في القاعدة نفسها لا الواجهة فقط
 *    (لا تُذكر هنا إلا صلاحية يخص استخدامها هذا الشيء وحده، وإلا تعطل معه غيره)
 *  - الخانات والأزرار الباقية تخفيها الواجهة ويمنعها الخادم في إجرائها
 * لا يُحذف شيء: الإطفاء يخفي ويمنع، والتشغيل يعيد كل شيء كما كان.
 *
 * locked: لا يُطفأ ويُذكر السبب. warn: يُطفأ بعد تأكيد بعد قراءة الأثر. check: فحص حي للبيانات قبل الإطفاء
 * (مثل وردية مفتوحة) يمنع أو ينبّه حسب الحال.
 */
export type FeatureKind = "section" | "part" | "field" | "button";
export type FeatureCheck =
  | "in_house" | "open_shifts" | "shift_required" | "open_laundry" | "open_maintenance" | "upcoming_events"
  | "held_items" | "employees" | "inventory_items" | "fixed_assets" | "waitlist" | "pos_orders";

export type FeatureNode = {
  key: string;
  kind: FeatureKind;
  label: string;
  /** وصف قصير لما يخصه */
  hint?: string;
  /** القسم الأساسي المقابل في enabled_modules */
  module?: "accounting" | "pms";
  hrefs?: readonly string[];
  permissions?: readonly string[];
  locked?: string;
  warn?: string;
  check?: readonly FeatureCheck[];
  children?: FeatureNode[];
};

type NavLabels = Dictionary["nav"];

const page = (key: string, href: string, label: string, extra: Partial<FeatureNode> = {}): FeatureNode =>
  ({ key, kind: "part", label, hrefs: [href], ...extra });

/** شجرة التخصيص كاملة. الصفحات بأسماء القائمة نفسها حتى لا تختلف التسمية */
export function featureTree(l: NavLabels): FeatureNode[] {
  return [
    {
      key: "pms", kind: "section", module: "pms", label: tr("الحجوزات والاستقبال"),
      hint: tr("الحجوزات والنزلاء والغرف والأسعار والاستقبال"),
      warn: tr("تختفي كل شاشات الحجوزات والغرف والنزلاء عن كل الموظفين. البيانات تبقى محفوظة وترجع كما هي عند التشغيل."),
      check: ["in_house"],
      children: [
        page("pms.front_desk", "/front-desk", l.frontDesk),
        page("pms.reservations", "/reservations", l.reservations, {
          locked: tr("أساس قسم الحجوزات، لا يعمل القسم بدونه"),
          children: [
            { key: "reservations.group", kind: "field", label: tr("حجز المجموعة"), hint: tr("خيار عدة غرف لنفس الفترة في شاشة الحجز الجديد") },
            { key: "reservations.series", kind: "field", label: tr("الحجز المتكرر"), hint: tr("خيار نفس الحجز كل أسبوع") },
            { key: "reservations.source", kind: "field", label: tr("مصدر الحجز") },
            { key: "reservations.company", kind: "field", label: tr("الشركة أو جهة الفوترة"),
              warn: tr("لن يمكن ربط الحجوزات الجديدة بشركة، فتُفوتر كلها على النزيل نفسه.") },
            { key: "reservations.manual_rate", kind: "field", label: tr("السعر اليدوي والشهري"),
              hint: tr("تحديد سعر الليلة أو السعر الشهري يدويًا بدل سعر النظام") },
            { key: "reservations.special_requests", kind: "field", label: tr("طلبات النزيل") },
            { key: "reservations.notes", kind: "field", label: tr("ملاحظات داخلية") },
            { key: "guests.phone", kind: "field", label: tr("جوال النزيل الجديد"),
              warn: tr("أزرار واتساب للنزيل تحتاج رقم الجوال، فلن تعمل للنزلاء الجدد.") },
            { key: "guests.id", kind: "field", label: tr("هوية النزيل الجديد"),
              warn: tr("كشف النزلاء للجهات الأمنية يحتاج الهوية، وسيظهر كل نزيل جديد بلا هوية.") },
            { key: "guests.nationality", kind: "field", label: tr("جنسية النزيل الجديد") },
            { key: "reservations.overbook", kind: "button", label: tr("الحجز الزائد فوق السعة"), permissions: ["pms.reservations.overbook"] },
            { key: "reservations.waive_fees", kind: "button", label: tr("الإلغاء وعدم الحضور بدون رسوم"),
              hint: tr("زر الإعفاء من رسوم سياسة الحجز") },
          ],
        }),
        page("pms.tape_chart", "/tape-chart", l.tapeChart),
        page("pms.guests", "/guests", l.guests),
        page("pms.waitlist", "/waitlist", l.waitlist, { check: ["waitlist"] }),
        page("pms.cashier", "/cashier", l.cashier, {
          permissions: ["cashier.shifts", "cashier.shifts.manage"], check: ["shift_required", "open_shifts"],
        }),
        page("pms.night_audit", "/night-audit", l.nightAudit, {
          warn: tr("تدقيق نهاية اليوم يرحّل الليالي ويسجل عدم الحضور ويحفظ تقرير المدير اليومي. بدونه ترحّل الليالي من صفحة كل حجز."),
        }),
        page("pms.guest_register", "/guest-register", l.guestRegister, {
          warn: tr("كشف النزلاء مطلوب للجهات الأمنية في أغلب الدول."),
        }),
        page("pms.reservations_report", "/reports/reservations-report", l.reservationsReport),
        page("pms.guest_balances", "/reports/guest-balances", l.guestBalances),
        page("pms.rooms", "/rooms", l.rooms, { locked: tr("حالة الغرف أساس الاستقبال والتسكين") }),
        page("pms.rates", "/rates", l.rates, { warn: tr("لن يمكن تعديل الأسعار والمواسم والعروض وسياسة الحجز.") }),
        page("pms.rate_plans", "/rate-plans", l.ratePlans),
        page("pms.housekeeping", "/housekeeping", l.housekeeping, { permissions: ["pms.housekeeping"] }),
        page("pms.room_setup", "/room-setup", l.roomSetup, { locked: tr("منها تُضاف الغرف وأنواعها") }),
      ],
    },
    {
      key: "pos", kind: "section", label: l.pos, hint: tr("البيع في المطعم والكافيه على الغرفة أو نقدًا"),
      permissions: ["pos.sell", "pos.manage"], hrefs: ["/pos"], check: ["pos_orders"],
    },
    {
      key: "maintenance", kind: "section", label: l.maintenance, hint: tr("بلاغات الأعطال والأجهزة وقطع الغيار"),
      permissions: ["maintenance.report", "maintenance.manage"], hrefs: ["/maintenance"], check: ["open_maintenance"],
    },
    {
      key: "lost_found", kind: "section", label: l.lostFound, hint: tr("المفقودات وأمانات الخزنة"),
      permissions: ["lost_found.manage"], hrefs: ["/lost-found"], check: ["held_items"],
    },
    {
      key: "laundry", kind: "section", label: l.laundry, hint: tr("طلبات المغسلة والمفروشات"),
      permissions: ["laundry.manage"], hrefs: ["/laundry"], check: ["open_laundry"],
    },
    {
      key: "events", kind: "section", label: l.events, hint: tr("حجز القاعات والمناسبات وعقودها"),
      permissions: ["events.view", "events.manage"], hrefs: ["/events"], check: ["upcoming_events"],
    },
    {
      key: "surveys", kind: "section", label: l.surveys, hint: tr("تقييم النزلاء بعد المغادرة"),
      permissions: ["feedback.view", "feedback.manage"], hrefs: ["/surveys"],
    },
    {
      key: "accounting", kind: "section", module: "accounting", label: tr("المحاسبة"),
      hint: tr("القيود والفواتير والسندات والموردين والتقارير المالية"),
      warn: tr("تختفي كل الشاشات المالية عن كل الموظفين. البيانات تبقى محفوظة وترجع كما هي عند التشغيل."),
      children: [
        page("accounting.accounts", "/accounts", l.accounts, { locked: tr("أساس المحاسبة") }),
        page("accounting.journal", "/journal", l.journal, { locked: tr("أساس المحاسبة") }),
        page("accounting.recurring", "/journal/recurring", l.recurringEntries),
        page("accounting.fx_revaluation", "/fx-revaluation", l.fxRevaluation),
        page("accounting.folios", "/folios", l.folios, {
          locked: tr("فوليو النزيل أساس الحساب بين الحجز والمحاسبة"),
          children: [
            { key: "folio.allowance", kind: "button", label: tr("الخصم والتسوية على الفوليو"), permissions: ["folio.allowance"] },
            { key: "folio.void", kind: "button", label: tr("إلغاء حركة على الفوليو"), permissions: ["folio.void"],
              warn: tr("لن يمكن إلغاء رسم أو دفعة سُجلت بالخطأ، والتصحيح يكون بحركة عكسية.") },
          ],
        }),
        page("accounting.invoices", "/invoices", l.invoices, {
          locked: tr("فواتير النزلاء تصدر منها"),
          children: [
            { key: "invoices.direct", kind: "button", label: tr("الفواتير المباشرة"), hint: tr("فاتورة لعميل بدون حجز"), permissions: ["invoices.create"] },
            { key: "invoices.credit_note", kind: "button", label: tr("الإشعار الدائن"), permissions: ["invoices.credit_note"],
              warn: tr("لن يمكن تصحيح فاتورة صدرت إلا بقيد يدوي.") },
            { key: "invoices.write_off", kind: "button", label: tr("إعدام الديون المعدومة"), permissions: ["invoices.write_off"] },
          ],
        }),
        page("accounting.vouchers", "/vouchers", l.vouchers, {
          locked: tr("سندات القبض والصرف أساس الصندوق"),
          children: [
            { key: "payments.void", kind: "button", label: tr("إلغاء السندات"), permissions: ["payments.void"],
              warn: tr("لن يمكن إلغاء سند قبض أو صرف أو شيك أو تحويل بين الصناديق سُجل بالخطأ.") },
          ],
        }),
        page("accounting.cheques", "/cheques", l.cheques),
        page("accounting.transfers", "/transfers", l.transfers),
        page("accounting.customers", "/customers", l.customers, {
          children: [
            { key: "customers.name_en", kind: "field", label: tr("اسم العميل بالإنجليزية") },
            { key: "customers.tax_number", kind: "field", label: tr("الرقم الضريبي للعميل"),
              warn: tr("الفاتورة الضريبية للشركات تحتاج رقمها الضريبي، فستصدر بدونه.") },
            { key: "customers.cr", kind: "field", label: tr("السجل التجاري للعميل") },
            { key: "customers.credit", kind: "field", label: tr("البيع الآجل وحد الائتمان"),
              warn: tr("الحسابات الآجلة القائمة تبقى كما هي، ولن تظهر خاناتها عند إضافة عميل أو تعديله.") },
          ],
        }),
        page("accounting.vendors", "/vendors", l.vendors),
        page("accounting.purchase_orders", "/purchase-orders", l.purchaseOrders, { permissions: ["purchases.manage"] }),
        page("accounting.bills", "/bills", l.bills, {
          children: [{ key: "bills.debit_note", kind: "button", label: tr("مرتجعات المشتريات"), permissions: ["bills.debit_note"] }],
        }),
        page("accounting.commissions", "/commissions", l.commissions, { permissions: ["commissions.manage"] }),
        page("accounting.vendor_advances", "/vendor-advances", l.vendorAdvances),
        page("accounting.payroll", "/payroll", l.payroll, { permissions: ["payroll.manage"] }),
        page("accounting.bank", "/bank", l.bank, { permissions: ["bank.reconcile"] }),
        page("accounting.budgets", "/budgets", l.budgets, { hrefs: ["/budgets", "/reports/budget-vs-actual"], permissions: ["budgets.manage"] }),
        page("accounting.periods", "/periods", l.periods, {
          locked: tr("الفترات تحمي الأرقام المقفلة"),
          children: [{ key: "periods.post_closed", kind: "button", label: tr("الترحيل في فترة مقفلة"), permissions: ["gl.periods.post_closed"] }],
        }),
        page("accounting.opening_balances", "/opening-balances", l.openingBalances),
        { key: "accounting.reports", kind: "part", label: l.groupReports, hint: tr("القوائم والتقارير المالية"),
          hrefs: ["/reports/income-statement", "/reports/balance-sheet", "/reports/cash-flow", "/reports/trial-balance", "/reports/account-statement",
            "/reports/monthly-movement", "/reports/currency-trial-balance", "/reports/daily-totals", "/reports/rooms", "/reports/occupancy-monthly",
            "/reports/daily-cash", "/reports/cash-by-currency", "/reports/aging", "/reports/profitability", "/reports/missing-numbers"],
          locked: tr("التقارير المالية أساس المحاسبة") },
        page("accounting.tax_return", "/reports/tax-return", l.taxReturn),
      ],
    },
    {
      key: "hr", kind: "section", label: tr("الموارد البشرية"), hint: tr("الموظفون والحضور والإجازات والسلف والرواتب"),
      permissions: ["hr.view", "hr.manage"], hrefs: ["/hr", "/settings/hr"], check: ["employees"],
    },
    {
      key: "inventory", kind: "section", label: l.stock, hint: tr("الأصناف وحركات المخزون والجرد"),
      permissions: ["inventory.view", "inventory.manage"], hrefs: ["/inventory", "/reports/stock-balances", "/reports/expiring-stock"],
      check: ["inventory_items"],
    },
    {
      key: "assets", kind: "section", label: l.fixedAssets, hint: tr("الأصول الثابتة وإهلاكها"),
      permissions: ["assets.view", "assets.manage"], hrefs: ["/assets"], check: ["fixed_assets"],
    },
    {
      key: "assistant", kind: "section", label: tr("المساعد الذكي"), hint: tr("المساعد الذي يجيب عن أسئلة الأرقام والتقارير"),
      hrefs: ["/assistant"],
    },
    {
      key: "general", kind: "section", label: tr("عام"), hint: tr("أجزاء مشتركة بين الأقسام"),
      locked: tr("أساس النظام"),
      children: [
        page("general.dashboard", "/", l.dashboard, { locked: tr("الصفحة الرئيسية") }),
        page("general.approvals", "/approvals", l.approvals, {
          warn: tr("الموظف الذي لا يملك صلاحية لن يستطيع طلب موافقة المدير، وما ينتظر الموافقة يبقى معلقًا."),
        }),
        page("general.import", "/settings/import", l.dataImport),
        page("general.audit", "/audit", l.audit),
        { key: "general.whatsapp", kind: "button", label: tr("أزرار واتساب"),
          hint: tr("مراسلة النزيل والعميل والموظف من الحجوزات والإيصالات والكشوف") },
        { key: "hotel.tax_number", kind: "field", label: tr("الرقم الضريبي للفندق"),
          warn: tr("الفاتورة الضريبية والرمز QR يحتاجان الرقم الضريبي للفندق، فستصدر الفواتير بدونه.") },
        { key: "hotel.cr", kind: "field", label: tr("السجل التجاري للفندق") },
        { key: "hotel.legal_name", kind: "field", label: tr("الاسم القانوني للفندق") },
      ],
    },
  ];
}

/** كل العقد بترتيب الشجرة مع أصل كل منها */
export function flatten(tree: FeatureNode[]): { node: FeatureNode; parents: FeatureNode[] }[] {
  const out: { node: FeatureNode; parents: FeatureNode[] }[] = [];
  const walk = (nodes: FeatureNode[], parents: FeatureNode[]) => {
    for (const n of nodes) {
      out.push({ node: n, parents });
      if (n.children) walk(n.children, [...parents, n]);
    }
  };
  walk(tree, []);
  return out;
}

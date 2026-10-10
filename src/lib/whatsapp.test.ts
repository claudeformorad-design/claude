import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, TEMPLATE_FIELDS, TEMPLATE_KEYS, fillTemplate, normalizePhone, templateFor, whatsappLink } from "./whatsapp";

describe("normalizePhone", () => {
  it("يضيف مفتاح الدولة للأرقام المحلية", () => {
    expect(normalizePhone("777123456", "YE")).toBe("967777123456");
    expect(normalizePhone("0777123456", "YE")).toBe("967777123456");
    expect(normalizePhone("0551234567", "SA")).toBe("966551234567");
  });
  it("يقبل الصيغ الدولية والأرقام العربية والمسافات", () => {
    expect(normalizePhone("+967 777 123 456", "SA")).toBe("967777123456");
    expect(normalizePhone("00967777123456", "YE")).toBe("967777123456");
    expect(normalizePhone("967777123456", "YE")).toBe("967777123456");
    expect(normalizePhone("٧٧٧١٢٣٤٥٦", "YE")).toBe("967777123456");
    expect(normalizePhone("777-123-456", "YE")).toBe("967777123456");
  });
  it("يرفض الفارغ والقصير", () => {
    expect(normalizePhone("", "YE")).toBeNull();
    expect(normalizePhone(null, "YE")).toBeNull();
    expect(normalizePhone("123", "YE")).toBeNull();
    expect(normalizePhone("لا يوجد", "YE")).toBeNull();
  });
});

describe("fillTemplate", () => {
  it("يستبدل الحقول ويحذف السطور التي بقيت قيمتها فارغة", () => {
    expect(fillTemplate("أهلًا {guest}\nرقم العملية: {reference}\n{hotel}", { guest: "تركي", reference: "", hotel: "فندق عدن" }))
      .toBe("أهلًا تركي\nفندق عدن");
  });
  it("يترك الحقول غير المعروفة كما هي", () => {
    expect(fillTemplate("{guest} {x}", { guest: "أ" })).toBe("أ {x}");
  });
  it("كل حقل في النصوص الافتراضية معرَّف في قائمة حقولها", () => {
    for (const k of TEMPLATE_KEYS) {
      const used = [...DEFAULT_TEMPLATES[k].matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
      for (const f of used) expect(TEMPLATE_FIELDS[k]).toContain(f);
    }
  });
});

describe("whatsappLink", () => {
  it("يرمّز النص ويضع الرقم", () => {
    expect(whatsappLink("967777123456", "أهلًا & شكرًا")).toBe(`https://wa.me/967777123456?text=${encodeURIComponent("أهلًا & شكرًا")}`);
    expect(whatsappLink(null, "x")).toBe("https://wa.me/?text=x");
  });
  it("النص الخاص يتقدم على الافتراضي إلا إن كان فارغًا", () => {
    expect(templateFor("arrival_reminder", { arrival_reminder: "خاص" })).toBe("خاص");
    expect(templateFor("arrival_reminder", { arrival_reminder: "  " })).toBe(DEFAULT_TEMPLATES.arrival_reminder);
  });
});

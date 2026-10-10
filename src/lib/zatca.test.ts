import { describe, expect, it } from "vitest";
import { decodeZatcaQr, zatcaQrBase64, zatcaTimestamp, zatcaUblXml } from "./zatca";

describe("ZATCA QR (phase 1 TLV)", () => {
  const fields = { sellerName: "فندق الواحة", vatNumber: "300000000000003", timestamp: "2026-10-10T08:15:00Z", total: "1150.00", vatTotal: "150.00" };

  it("encodes the five tags in order and decodes back", () => {
    const qr = zatcaQrBase64(fields);
    expect(decodeZatcaQr(qr)).toEqual({ 1: fields.sellerName, 2: fields.vatNumber, 3: fields.timestamp, 4: fields.total, 5: fields.vatTotal });
  });

  it("uses the UTF-8 byte length, not the character count, for Arabic names", () => {
    const bytes = Buffer.from(zatcaQrBase64(fields), "base64");
    expect(bytes[0]).toBe(1);
    expect(bytes[1]).toBe(Buffer.byteLength(fields.sellerName, "utf8"));
    expect(bytes[1]).toBeGreaterThan(fields.sellerName.length);
  });

  it("matches the published reference encoding for an ASCII example", () => {
    const qr = zatcaQrBase64({ sellerName: "Bobs Records", vatNumber: "310122393500003", timestamp: "2022-04-25T15:30:00Z", total: "1000.00", vatTotal: "150.00" });
    expect(Buffer.from(qr, "base64").toString("hex")).toBe(
      "010c426f6273205265636f726473020f3331303132323339333530303030330314323032322d30342d32355431353a33303a30305a0407313030302e30300506313530" + "2e3030",
    );
  });

  it("rejects values longer than one TLV byte can describe", () => {
    expect(() => zatcaQrBase64({ ...fields, sellerName: "x".repeat(256) })).toThrow();
  });

  it("formats the timestamp in UTC without fractions", () => {
    expect(zatcaTimestamp("2026-10-10T11:15:00.123+03:00")).toBe("2026-10-10T08:15:00Z");
  });
});

describe("ZATCA UBL", () => {
  it("marks simplified invoices 0200000 and credit notes 381, and escapes text", () => {
    const xml = zatcaUblXml({
      kind: "credit_note", number: "CN-2026-000001", uuid: "u-1", icv: 3, pih: "p", invoiceType: "simplified", issuedAt: "2026-10-10T08:15:00Z",
      currency: "SAR", seller: { name: "A & B", vat: "300000000000003", country: "SA" }, buyer: { name: "<x>" },
      lines: [{ id: 1, name: "غرفة", quantity: "2", net: "200", tax: "30", taxPercent: "15" }],
      subtotal: "200", taxTotal: "30", total: "230", qr: "Q", billingReference: "INV-2026-000001", reason: "خصم",
    });
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0200000">381</cbc:InvoiceTypeCode>');
    expect(xml).toContain("A &amp; B");
    expect(xml).toContain("&lt;x&gt;");
    expect(xml).toContain("<cbc:IssueTime>08:15:00</cbc:IssueTime>");
    expect(xml).toContain('<cbc:PriceAmount currencyID="SAR">100.00</cbc:PriceAmount>');
  });
});

/**
 * الفوترة الإلكترونية حسب مواصفات هيئة الزكاة والضريبة والجمارك.
 * رمز QR للمرحلة الأولى: حقول TLV (الرقم، الطول بالبايت، القيمة UTF-8) مرمزة base64:
 *   1 اسم البائع، 2 الرقم الضريبي، 3 وقت الإصدار، 4 الإجمالي شامل الضريبة، 5 مبلغ الضريبة.
 * ملف UBL 2.1 للفاتورة بنفس الحقول التي تطلبها الهيئة، دون ختم التشفير (يتطلب شهادة المنشأة من بوابة فاتورة).
 */

export interface ZatcaQrFields {
  sellerName: string;
  vatNumber: string;
  /** ISO 8601 بتوقيت UTC، مثل 2026-10-10T08:15:00Z */
  timestamp: string;
  total: string;
  vatTotal: string;
}

function tlv(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 255) throw new Error(`ZATCA TLV value for tag ${tag} is longer than 255 bytes`);
  const out = new Uint8Array(bytes.length + 2);
  out[0] = tag;
  out[1] = bytes.length;
  out.set(bytes, 2);
  return out;
}

/** نص رمز QR (base64) كما تقرؤه تطبيقات الهيئة */
export function zatcaQrBase64(f: ZatcaQrFields): string {
  const parts = [tlv(1, f.sellerName), tlv(2, f.vatNumber), tlv(3, f.timestamp), tlv(4, f.total), tlv(5, f.vatTotal)];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { all.set(p, i); i += p.length; }
  return Buffer.from(all).toString("base64");
}

/** قراءة رمز QR إلى حقوله (للاختبار وللتحقق) */
export function decodeZatcaQr(b64: string): Record<number, string> {
  const buf = Buffer.from(b64, "base64");
  const out: Record<number, string> = {};
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i]!, len = buf[i + 1]!;
    out[tag] = new TextDecoder().decode(buf.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
}

/** وقت الإصدار بصيغة الهيئة: ثوانٍ بلا كسور وبتوقيت UTC */
export const zatcaTimestamp = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const amt = (v: string | number) => Number(v).toFixed(2);

export interface UblInput {
  kind: "invoice" | "credit_note";
  number: string;
  uuid: string;
  icv: number;
  pih: string;
  invoiceType: "standard" | "simplified";
  issuedAt: string;
  currency: string;
  seller: { name: string; vat: string; crn?: string | null; address?: string | null; country: string };
  buyer: { name: string; vat?: string | null; address?: string | null };
  lines: { id: number; name: string; quantity: string; net: string; tax: string; taxPercent: string }[];
  subtotal: string;
  taxTotal: string;
  total: string;
  qr: string;
  /** للإشعار الدائن: رقم الفاتورة الأصلية وسبب الإشعار */
  billingReference?: string;
  reason?: string;
}

/**
 * ملف UBL 2.1 بالهيكل الذي تعتمده الهيئة (نوع 388 للفاتورة و381 للإشعار الدائن، ورمز النوع 0100000
 * للفاتورة الضريبية و0200000 للمبسطة). بلا توقيع رقمي: يُضاف عند الربط بالمرحلة الثانية.
 */
export function zatcaUblXml(x: UblInput): string {
  const [date, timeZ] = zatcaTimestamp(x.issuedAt).split("T");
  const time = (timeZ ?? "00:00:00Z").replace("Z", "");
  const typeCode = x.kind === "invoice" ? "388" : "381";
  const subtype = x.invoiceType === "standard" ? "0100000" : "0200000";
  const cur = esc(x.currency);
  const lines = x.lines.map((l) => `
  <cac:InvoiceLine>
    <cbc:ID>${l.id}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">${esc(l.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${cur}">${amt(l.net)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${cur}">${amt(l.tax)}</cbc:TaxAmount>
      <cbc:RoundingAmount currencyID="${cur}">${amt(Number(l.net) + Number(l.tax))}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${esc(l.name)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${Number(l.taxPercent) > 0 ? "S" : "Z"}</cbc:ID>
        <cbc:Percent>${amt(l.taxPercent)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${cur}">${amt(Number(l.net) / Math.max(Number(l.quantity) || 1, 1e-9))}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(x.number)}</cbc:ID>
  <cbc:UUID>${esc(x.uuid)}</cbc:UUID>
  <cbc:IssueDate>${date}</cbc:IssueDate>
  <cbc:IssueTime>${time}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${subtype}">${typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${cur}</cbc:TaxCurrencyCode>${x.billingReference ? `
  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(x.billingReference)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : ""}
  <cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${x.icv}</cbc:UUID></cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${esc(x.pih)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${esc(x.qr)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty><cac:Party>${x.seller.crn ? `
    <cac:PartyIdentification><cbc:ID schemeID="CRN">${esc(x.seller.crn)}</cbc:ID></cac:PartyIdentification>` : ""}
    <cac:PostalAddress><cbc:StreetName>${esc(x.seller.address)}</cbc:StreetName><cac:Country><cbc:IdentificationCode>${esc(x.seller.country)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>${esc(x.seller.vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>${esc(x.seller.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PostalAddress><cbc:StreetName>${esc(x.buyer.address)}</cbc:StreetName></cac:PostalAddress>${x.buyer.vat ? `
    <cac:PartyTaxScheme><cbc:CompanyID>${esc(x.buyer.vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}
    <cac:PartyLegalEntity><cbc:RegistrationName>${esc(x.buyer.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>${x.reason ? `
  <cac:PaymentMeans><cbc:PaymentMeansCode>10</cbc:PaymentMeansCode><cbc:InstructionNote>${esc(x.reason)}</cbc:InstructionNote></cac:PaymentMeans>` : ""}
  <cac:TaxTotal><cbc:TaxAmount currencyID="${cur}">${amt(x.taxTotal)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${amt(x.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${amt(x.subtotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${amt(x.total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${cur}">${amt(x.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines}
</Invoice>
`;
}

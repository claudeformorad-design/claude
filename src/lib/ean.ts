/** رقم التحقق لـ EAN-13 من أول 12 رقمًا */
export function ean13CheckDigit(body12: string): number {
  const sum = [...body12].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

/** هل الرقم EAN-13 صحيح (12 رقمًا + رقم تحقق) */
export function isEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

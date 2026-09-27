/**
 * تحويل مستند التقرير المعروض (ReportDocument بوضع capture) إلى ملف PDF يُنزَّل مباشرة:
 * يُلتقط المستند كصورة عالية الدقة بخطوط النظام، ثم يُقسَّم إلى صفحات A4 عند حدود الصفوف،
 * مع تكرار رأس الجدول أعلى كل صفحة، وتذييل باسم الفندق ورقم الصفحة.
 * المكتبات تُحمَّل عند الضغط فقط، فلا تثقل أي صفحة.
 */
const SCALE = 2;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 64;
const FOOTER_Y = 34; // من أسفل الصفحة
const SIDE = 46;

type Box = { top: number; bottom: number };
type Part = { src: Box; dy: number };

export async function downloadReportPdf(root: HTMLElement, opts: { fileName: string; footer: string; landscape: boolean }) {
  const [{ jsPDF }, { domToCanvas }] = await Promise.all([import("jspdf"), import("modern-screenshot")]);
  await document.fonts.ready;

  const base = root.getBoundingClientRect();
  const box = (el: Element | null): Box => {
    const r = el!.getBoundingClientRect();
    return { top: r.top - base.top, bottom: r.bottom - base.top };
  };
  const thead = box(root.querySelector('[data-pdf="thead"]'));
  const rows = Array.from(root.querySelectorAll('[data-pdf="row"]'), box);
  const tail = box(root.querySelector('[data-pdf="tail"]'));

  const width = base.width;
  const height = opts.landscape ? width * (595.28 / 841.89) : width * (841.89 / 595.28);
  const limit = height - MARGIN_BOTTOM;

  // توزيع المحتوى على الصفحات: الرأس ورأس الجدول في الأولى، ثم الصفوف، ثم الخاتمة (الملاحظة والتوقيعات)
  const pages: Part[][] = [[{ src: { top: 0, bottom: thead.bottom }, dy: 0 }]];
  let y = thead.bottom;
  const place = (b: Box, repeatHead: boolean) => {
    const h = b.bottom - b.top;
    if (y + h > limit) {
      pages.push(repeatHead ? [{ src: thead, dy: MARGIN_TOP }] : []);
      y = MARGIN_TOP + (repeatHead ? thead.bottom - thead.top : 0);
    }
    pages.at(-1)!.push({ src: b, dy: y });
    y += h;
  };
  rows.forEach((r) => place(r, true));
  place({ top: rows.at(-1)?.bottom ?? thead.bottom, bottom: tail.bottom }, false);

  const shot = await domToCanvas(root, { scale: SCALE, backgroundColor: "#ffffff" });
  const pdf = new jsPDF({ orientation: opts.landscape ? "landscape" : "portrait", unit: "pt", format: "a4", compress: true });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const family = getComputedStyle(document.body).fontFamily;

  pages.forEach((parts, i) => {
    const page = document.createElement("canvas");
    page.width = Math.round(width * SCALE);
    page.height = Math.round(height * SCALE);
    const ctx = page.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, page.width, page.height);
    for (const { src, dy } of parts) {
      const h = src.bottom - src.top;
      ctx.drawImage(shot, 0, src.top * SCALE, width * SCALE, h * SCALE, 0, dy * SCALE, width * SCALE, h * SCALE);
    }
    ctx.fillStyle = "#6b6964";
    ctx.font = `500 ${11 * SCALE}px Inter, ${family}`;
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.fillText(opts.footer, (width - SIDE) * SCALE, (height - FOOTER_Y) * SCALE);
    ctx.textAlign = "left";
    ctx.fillText(`صفحة ${i + 1} من ${pages.length}`, SIDE * SCALE, (height - FOOTER_Y) * SCALE);
    if (i > 0) pdf.addPage();
    pdf.addImage(page.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pw, ph, undefined, "FAST");
  });

  pdf.setProperties({ title: opts.fileName });
  const url = URL.createObjectURL(pdf.output("blob"));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${opts.fileName}.pdf` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

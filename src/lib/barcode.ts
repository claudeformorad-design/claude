import "server-only";
import bwipjs from "bwip-js/node";
import { isEan13 } from "./ean";

/** صورة الباركود SVG: EAN-13 للأرقام الصحيحة، وإلا Code 128 */
export function barcodeSvg(code: string): string {
  return bwipjs.toSVG({ bcid: isEan13(code) ? "ean13" : "code128", text: code, includetext: true, textxalign: "center", height: 10, scale: 2 });
}

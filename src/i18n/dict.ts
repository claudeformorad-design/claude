import { ar, type Dictionary } from "./dictionaries/ar";
import { en } from "./dictionaries/en";
import { currentLocale } from "./tr";

/** قاموس اللغة الحالية؛ يعمل في الخادم والمتصفح */
export const dict = (): Dictionary => (currentLocale() === "en" ? en : ar);

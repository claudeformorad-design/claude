import "server-only";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { LOCALE_COOKIE } from "./config";
import { registerServerLocale } from "./tr";

/**
 * لغة الطلب الحالي في الخادم بقراءة متزامنة لكوكي الطلب من مخزن Next للطلب، فتعمل في الصفحات والمكونات
 * وServer Actions ومسارات الـ API دون تمرير اللغة يدويًا. خارج سياق طلب (البناء) تكون العربية.
 */
registerServerLocale(() => {
  const store = workUnitAsyncStorage.getStore();
  if (store && store.type === "request") return store.cookies.get(LOCALE_COOKIE)?.value === "en" ? "en" : "ar";
  return "ar";
});

/** نطاق بريد حسابات الموظفين (اسم المستخدم + النطاق)، يطابق app.staff_domain() في قاعدة البيانات ولا تُرسل إليه رسائل */
export const STAFF_DOMAIN = "nazeel.local";

/** اسم الدخول المعروض: اسم المستخدم لحسابات الموظفين، والبريد كما هو لغيرها */
export const loginName = (email: string | null | undefined): string =>
  email?.endsWith(`@${STAFF_DOMAIN}`) ? email.slice(0, -STAFF_DOMAIN.length - 1) : (email ?? "");

/** رموز الصلاحيات — مطابقة لجدول public.permissions (الترحيل 1) */
export const PERMISSIONS = {
  hotelManage: "settings.hotel.manage",
  usersManage: "settings.users.manage",
  departmentsManage: "settings.departments.manage",
  currenciesManage: "settings.currencies.manage",
  accountsView: "coa.accounts.view",
  accountsManage: "coa.accounts.manage",
  journalView: "gl.journal.view",
  journalCreate: "gl.journal.create",
  journalPost: "gl.journal.post",
  journalReverse: "gl.journal.reverse",
  periodsView: "gl.periods.view",
  periodsManage: "gl.periods.manage",
  periodsPostClosed: "gl.periods.post_closed",
  trialBalanceView: "reports.trial_balance.view",
  auditView: "audit.logs.view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

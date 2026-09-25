-- =============================================================================
-- المرحلة 1 / الترحيل 5: سياسات أمان مستوى الصف (RLS)
-- القاعدة: لا يرى المستخدم إلا بيانات الفنادق التي هو عضو فيها، وبحسب صلاحيات دوره.
-- جميع الجداول مفعّل عليها RLS؛ الجداول بلا سياسة كتابة لا تُكتب إلا عبر دوال النظام.
-- =============================================================================

alter table public.currencies          enable row level security;
alter table public.hotels              enable row level security;
alter table public.users_profiles      enable row level security;
alter table public.permissions         enable row level security;
alter table public.roles               enable row level security;
alter table public.role_permissions    enable row level security;
alter table public.hotel_members       enable row level security;
alter table public.departments         enable row level security;
alter table public.exchange_rates      enable row level security;
alter table public.chart_of_accounts   enable row level security;
alter table public.fiscal_years        enable row level security;
alter table public.accounting_periods  enable row level security;
alter table public.document_sequences  enable row level security;
alter table public.journal_entries     enable row level security;
alter table public.journal_entry_lines enable row level security;
alter table public.audit_logs          enable row level security;

-- -----------------------------------------------------------------------------
-- بيانات مرجعية
-- -----------------------------------------------------------------------------
create policy currencies_read on public.currencies
  for select to authenticated using (true);

create policy permissions_read on public.permissions
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- الفنادق (الإنشاء عبر public.create_hotel فقط)
-- -----------------------------------------------------------------------------
create policy hotels_read on public.hotels
  for select to authenticated using (app.is_hotel_member(id));

create policy hotels_update on public.hotels
  for update to authenticated
  using (app.has_permission(id, 'settings.hotel.manage'))
  with check (app.has_permission(id, 'settings.hotel.manage'));

-- -----------------------------------------------------------------------------
-- ملفات المستخدمين: المستخدم يرى ملفه وملفات زملائه في نفس الفندق
-- -----------------------------------------------------------------------------
create policy users_profiles_read on public.users_profiles
  for select to authenticated using (
    id = auth.uid()
    or exists (
      select 1 from public.hotel_members m
      where m.user_id = users_profiles.id and app.is_hotel_member(m.hotel_id)
    )
  );

create policy users_profiles_update_own on public.users_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- الأدوار والصلاحيات والعضويات
-- -----------------------------------------------------------------------------
create policy roles_read on public.roles
  for select to authenticated using (hotel_id is null or app.is_hotel_member(hotel_id));

create policy roles_write on public.roles
  for all to authenticated
  using (hotel_id is not null and not is_system and app.has_permission(hotel_id, 'settings.users.manage'))
  with check (hotel_id is not null and not is_system and app.has_permission(hotel_id, 'settings.users.manage'));

create policy role_permissions_read on public.role_permissions
  for select to authenticated using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and (r.hotel_id is null or app.is_hotel_member(r.hotel_id))
    )
  );

create policy role_permissions_write on public.role_permissions
  for all to authenticated
  using (exists (
    select 1 from public.roles r
    where r.id = role_permissions.role_id and not r.is_system
      and app.has_permission(r.hotel_id, 'settings.users.manage')
  ))
  with check (exists (
    select 1 from public.roles r
    where r.id = role_permissions.role_id and not r.is_system
      and app.has_permission(r.hotel_id, 'settings.users.manage')
  ));

create policy hotel_members_read on public.hotel_members
  for select to authenticated using (user_id = auth.uid() or app.is_hotel_member(hotel_id));

create policy hotel_members_write on public.hotel_members
  for all to authenticated
  using (app.has_permission(hotel_id, 'settings.users.manage'))
  with check (app.has_permission(hotel_id, 'settings.users.manage'));

-- -----------------------------------------------------------------------------
-- الأقسام وأسعار الصرف
-- -----------------------------------------------------------------------------
create policy departments_read on public.departments
  for select to authenticated using (app.is_hotel_member(hotel_id));

create policy departments_write on public.departments
  for all to authenticated
  using (app.has_permission(hotel_id, 'settings.departments.manage'))
  with check (app.has_permission(hotel_id, 'settings.departments.manage'));

create policy exchange_rates_read on public.exchange_rates
  for select to authenticated using (app.is_hotel_member(hotel_id));

create policy exchange_rates_write on public.exchange_rates
  for all to authenticated
  using (app.has_permission(hotel_id, 'settings.currencies.manage'))
  with check (app.has_permission(hotel_id, 'settings.currencies.manage'));

-- -----------------------------------------------------------------------------
-- دليل الحسابات
-- -----------------------------------------------------------------------------
create policy coa_read on public.chart_of_accounts
  for select to authenticated using (app.has_permission(hotel_id, 'coa.accounts.view'));

create policy coa_insert on public.chart_of_accounts
  for insert to authenticated with check (app.has_permission(hotel_id, 'coa.accounts.manage'));

create policy coa_update on public.chart_of_accounts
  for update to authenticated
  using (app.has_permission(hotel_id, 'coa.accounts.manage'))
  with check (app.has_permission(hotel_id, 'coa.accounts.manage'));

-- الحذف مسموح فقط لحساب بلا حركات وبلا أبناء (المفاتيح الأجنبية تمنع غير ذلك)
create policy coa_delete on public.chart_of_accounts
  for delete to authenticated using (app.has_permission(hotel_id, 'coa.accounts.manage'));

-- -----------------------------------------------------------------------------
-- السنوات والفترات المحاسبية
-- -----------------------------------------------------------------------------
create policy fiscal_years_read on public.fiscal_years
  for select to authenticated using (app.is_hotel_member(hotel_id));

create policy fiscal_years_write on public.fiscal_years
  for all to authenticated
  using (app.has_permission(hotel_id, 'gl.periods.manage'))
  with check (app.has_permission(hotel_id, 'gl.periods.manage'));

create policy accounting_periods_read on public.accounting_periods
  for select to authenticated using (app.is_hotel_member(hotel_id));

create policy accounting_periods_write on public.accounting_periods
  for all to authenticated
  using (app.has_permission(hotel_id, 'gl.periods.manage'))
  with check (app.has_permission(hotel_id, 'gl.periods.manage'));

-- document_sequences: لا سياسات ⇒ لا وصول مباشر (فقط عبر app.next_document_number)

-- -----------------------------------------------------------------------------
-- القيود اليومية
-- الترحيل/العكس/الحذف مقيدة إضافيًا داخل التريغرات (صلاحية الترحيل، منع تعديل المرحّل)
-- -----------------------------------------------------------------------------
create policy je_read on public.journal_entries
  for select to authenticated using (app.has_permission(hotel_id, 'gl.journal.view'));

create policy je_insert on public.journal_entries
  for insert to authenticated with check (app.has_permission(hotel_id, 'gl.journal.create'));

create policy je_update on public.journal_entries
  for update to authenticated
  using (
    app.has_permission(hotel_id, 'gl.journal.create')
    or app.has_permission(hotel_id, 'gl.journal.post')
    or app.has_permission(hotel_id, 'gl.journal.reverse')
  )
  with check (
    app.has_permission(hotel_id, 'gl.journal.create')
    or app.has_permission(hotel_id, 'gl.journal.post')
    or app.has_permission(hotel_id, 'gl.journal.reverse')
  );

create policy je_delete on public.journal_entries
  for delete to authenticated using (status = 'draft' and app.has_permission(hotel_id, 'gl.journal.create'));

create policy jel_read on public.journal_entry_lines
  for select to authenticated using (app.has_permission(hotel_id, 'gl.journal.view'));

create policy jel_write on public.journal_entry_lines
  for all to authenticated
  using (app.has_permission(hotel_id, 'gl.journal.create'))
  with check (app.has_permission(hotel_id, 'gl.journal.create'));

-- -----------------------------------------------------------------------------
-- سجل التدقيق: قراءة فقط لمن يملك الصلاحية
-- -----------------------------------------------------------------------------
create policy audit_logs_read on public.audit_logs
  for select to authenticated using (hotel_id is not null and app.has_permission(hotel_id, 'audit.logs.view'));

-- -----------------------------------------------------------------------------
-- صلاحيات تنفيذ الدوال العامة
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema app from public;
grant execute on function app.is_hotel_member(uuid) to authenticated;
grant execute on function app.has_permission(uuid, text) to authenticated;
grant execute on function app.require_permission(uuid, text) to authenticated;
-- تُستخدم في قيود CHECK والأعمدة المولّدة، فيجب أن تكون قابلة للتنفيذ
grant execute on function app.normal_balance_of(public.account_type) to authenticated, service_role;
grant execute on function app.subtype_matches_type(public.account_type, public.account_subtype) to authenticated, service_role;

revoke execute on function public.create_hotel(text, char, char, text, smallint, text, boolean) from public, anon;
revoke execute on function public.create_fiscal_year(uuid, date, text) from public, anon;
revoke execute on function public.save_journal_entry(uuid, date, text, jsonb, text, char, numeric, uuid, boolean) from public, anon;
revoke execute on function public.post_journal_entry(uuid) from public, anon;
revoke execute on function public.reverse_journal_entry(uuid, date, text) from public, anon;
revoke execute on function public.gl_account_activity(uuid, date, date, date) from public, anon;
revoke execute on function public.my_permissions(uuid) from public, anon;

grant execute on function public.create_hotel(text, char, char, text, smallint, text, boolean) to authenticated;
grant execute on function public.create_fiscal_year(uuid, date, text) to authenticated;
grant execute on function public.save_journal_entry(uuid, date, text, jsonb, text, char, numeric, uuid, boolean) to authenticated;
grant execute on function public.post_journal_entry(uuid) to authenticated;
grant execute on function public.reverse_journal_entry(uuid, date, text) to authenticated;
grant execute on function public.gl_account_activity(uuid, date, date, date) to authenticated;
grant execute on function public.my_permissions(uuid) to authenticated;

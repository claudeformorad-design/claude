-- =============================================================================
-- الترحيل 18: أوصاف القيود والحركات الآلية بالعربية فقط
--
-- القيود التي يولّدها النظام من المستندات (عكس، إهلاك، رواتب، فواتير الموردين،
-- المخزون، التحويل بين الفوليوهات...) كانت تُكتب بوصف مزدوج «عربي / English».
-- النظام عربي بالكامل، فتُعاد كتابة هذه النصوص داخل الدوال نفسها دون أي تغيير
-- آخر في منطقها: نقرأ تعريف كل دالة من الكتالوج، نستبدل النص، ونعيد إنشاءها
-- (CREATE OR REPLACE يحافظ على الصلاحيات والمالك وخصائص الأمان).
-- القيود المرحّلة سابقًا لا تُمس (غير قابلة للتعديل بطبيعتها).
-- =============================================================================

do $$
declare
  f record;
  v_def text;
  v_pair text[];
  v_pairs text[][] := array[
    ['عكس القيد / Reversal of ',              'عكس القيد '],
    ['تطبيق العربون / Deposit applied',        'تطبيق العربون'],
    ['تحويل إلى / Transfer to ',              'تحويل إلى '],
    ['تحويل من / Transfer from ',             'تحويل من '],
    ['إلغاء / Void: ',                        'إلغاء: '],
    ['فاتورة آجلة / Credit invoice — ',        'فاتورة آجلة — '],
    ['إلغاء سند / Void ',                     'إلغاء سند '],
    ['فاتورة مورد / Vendor bill — ',          'فاتورة مورد — '],
    ['سداد مورد / Vendor payment',            'سداد مورد'],
    ['مسيّر رواتب / Payroll ',                 'مسيّر رواتب '],
    ['إشعار دائن / Credit note — ',           'إشعار دائن — '],
    ['تسجيل أصل / Asset acquisition — ',      'تسجيل أصل — '],
    ['إهلاك / Depreciation ',                 'إهلاك '],
    ['استبعاد أصل / Asset disposal — ',       'استبعاد أصل — '],
    ['مخزون / Inventory — ',                  'مخزون — '],
    ['قيد إقفال السنة / Year-end closing ',   'قيد إقفال السنة ']
  ];
begin
  for f in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and p.prosrc ~ '[ء-ي] / [A-Z][a-z]+'
  loop
    v_def := pg_get_functiondef(f.oid);
    foreach v_pair slice 1 in array v_pairs loop
      v_def := replace(v_def, v_pair[1], v_pair[2]);
    end loop;
    execute v_def;
  end loop;

  -- لا يبقى أي وصف مزدوج في دوال النظام
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and p.prosrc ~ '[ء-ي] / [A-Z][a-z]+'
  ) then
    raise exception 'Some system descriptions were not converted to Arabic';
  end if;
end $$;

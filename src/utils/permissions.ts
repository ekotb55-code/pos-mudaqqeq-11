import type { PermissionDefinition, PermissionKey, UserAccount, UserRole } from '../types/index.ts';

export const ALL_PERMISSIONS: PermissionDefinition[] = [
  // 1. لوحة التحكم
  {
    key: 'dashboard.view',
    label: 'عرض لوحة التحكم',
    category: 'لوحة التحكم',
    description: 'الاطلاع على المؤشرات الإحصائية العامة وحركة المبيعات'
  },
  {
    key: 'dashboard.view_cashboxes',
    label: 'عرض أرصدة الخزن المعيّنة له في لوحة التحكم',
    category: 'لوحة التحكم',
    description: 'الاطلاع على أرصدة الخزن المخصصة للمستخدم داخل الصفحة الرئيسية'
  },

  // 2. الأصناف
  {
    key: 'items.view',
    label: 'عرض الأصناف',
    category: 'الأصناف والمخزون',
    description: 'الاطلاع على قائمة الأصناف والكميات'
  },
  {
    key: 'items.create',
    label: 'إضافة صنف جديد',
    category: 'الأصناف والمخزون',
    description: 'تسجيل أصناف جديدة في المخزن'
  },
  {
    key: 'items.edit',
    label: 'تعديل الصنف',
    category: 'الأصناف والمخزون',
    description: 'تعديل أسماء ومواصفات وصور الأصناف'
  },
  {
    key: 'items.status',
    label: 'إيقاف / تفعيل الصنف',
    category: 'الأصناف والمخزون',
    description: 'تغيير حالة الصنف بين نشط وموقوف'
  },
  {
    key: 'items.delete',
    label: 'حذف الصنف',
    category: 'الأصناف والمخزون',
    description: 'إيقاف أو حذف الصنف نهائيًا من المخزن'
  },
  {
    key: 'categories.view',
    label: 'عرض شجرة وقائمة التصنيفات',
    category: 'الأصناف والمخزون',
    description: 'الاطلاع على شجرة تصنيفات المنتجات وتصفح الأصناف التابعة لها'
  },
  {
    key: 'categories.manage',
    label: 'إدارة وتعديل وترتيب التصنيفات',
    category: 'الأصناف والمخزون',
    description: 'إنشاء تصنيفات رئيسية وفرعية وتعديلها وترتيبها وتفعيلها أو إيقافها والتحكم بالظهور في POS'
  },

  // 3. الأسعار
  {
    key: 'prices.view_sale',
    label: 'عرض سعر البيع',
    category: 'الأسعار والتكاليف',
    description: 'رؤية سعر بيع المنتج للمستهلك'
  },
  {
    key: 'prices.view_purchase',
    label: 'عرض سعر الشراء',
    category: 'الأسعار والتكاليف',
    description: 'رؤية سعر شراء المنتج من المورد (محجوب عن الموظف)'
  },
  {
    key: 'prices.view_packaging',
    label: 'عرض تكلفة التغليف',
    category: 'الأسعار والتكاليف',
    description: 'رؤية مصاريف كرتونة وتغليف الصنف (محجوب عن الموظف)'
  },
  {
    key: 'prices.override_min_price',
    label: 'تجاوز الحد الأدنى لسعر الصنف',
    category: 'الأسعار والتكاليف',
    description: 'السماح بالبيع أو التعديل بسعر أقل من الحد الأدنى للصنف'
  },

  // 4. المخزون
  {
    key: 'stock.view',
    label: 'عرض أرصدة المخزون',
    category: 'الأصناف والمخزون',
    description: 'الاطلاع على رصيد المخزن المتاح لكل صنف'
  },
  {
    key: 'stock.edit',
    label: 'تعديل كمية المخزون',
    category: 'الأصناف والمخزون',
    description: 'تعديل رصيد المخزن يدويًا'
  },
  {
    key: 'stock.adjust',
    label: 'تسوية الجرد المخزني',
    category: 'الأصناف والمخزون',
    description: 'إجراء تسويات الجرد والعجز والزيادة'
  },
  {
    key: 'stock.alerts',
    label: 'عرض تنبيهات نقص المخزون',
    category: 'الأصناف والمخزون',
    description: 'الاطلاع على الأصناف التي شارفت على النفاد'
  },
  {
    key: 'stock.override_negative',
    label: 'السماح بالبيع بالسالب (تجاوز نفاد المخزون)',
    category: 'الأصناف والمخزون',
    description: 'السماح بإتمام عمليات البيع حتى لو كان رصيد المخزون غير كافٍ'
  },
  // المخازن المتعددة
  {
    key: 'warehouses.view',
    label: 'عرض المخازن وأرصدة الأصناف',
    category: 'المخازن المتعددة',
    description: 'الاطلاع على قائمة المخازن المسجلة وأرصدة الأصناف في كل مخزن'
  },
  {
    key: 'warehouses.manage',
    label: 'إدارة المخازن وتعديلها',
    category: 'المخازن المتعددة',
    description: 'إنشاء وتعديل وإيقاف المخازن وربط المستخدمين بالمخازن المسموحة'
  },
  {
    key: 'warehouses.transfer',
    label: 'التحويل المخزني بين المخازن',
    category: 'المخازن المتعددة',
    description: 'تحويل كميات الأصناف بين المخازن المختلفة'
  },

  // 5. المنصات
  {
    key: 'platforms.view',
    label: 'عرض المنصات',
    category: 'المنصات والعملاء',
    description: 'استعراض منصات البيع والعملاء المسجلين'
  },
  {
    key: 'platforms.create',
    label: 'إضافة منصة جديدة',
    category: 'المنصات والعملاء',
    description: 'إضافة منصة تجارة إلكترونية أو معرض جديد'
  },
  {
    key: 'platforms.edit',
    label: 'تعديل المنصة',
    category: 'المنصات والعملاء',
    description: 'تعديل بيانات المنصة ونسب الخصم والشحن'
  },
  {
    key: 'platforms.status',
    label: 'إيقاف / تفعيل المنصة',
    category: 'المنصات والعملاء',
    description: 'تعطيل أو تنشيط منصة بيع معينة'
  },
  {
    key: 'platforms.pricing',
    label: 'إدارة تكاليف شحن المنصات',
    category: 'المنصات والعملاء',
    description: 'تحديد تكاليف الشحن وخصم شحن المرتجع لكل صنف على كل منصة'
  },

  // 6. الفواتير ونقاط البيع
  {
    key: 'invoices.view',
    label: 'عرض الفواتير',
    category: 'الفواتير ونقاط البيع',
    description: 'الاطلاع على سجل الفواتير ولقطات الأسعار التاريخية'
  },
  {
    key: 'invoices.view_in_pos',
    label: 'عرض فواتير البيع في شاشة POS',
    category: 'الفواتير ونقاط البيع',
    description: 'الاطلاع على سجل فواتيره المحفوظة داخل شاشة البيع المباشر'
  },
  {
    key: 'invoices.create',
    label: 'إنشاء فاتورة بيع (POS)',
    category: 'الفواتير ونقاط البيع',
    description: 'إصدار فواتير بيع جديدة وخصم المخزون'
  },
  {
    key: 'invoices.edit_cash_paid',
    label: 'تعديل المدفوع النقدي يدويًا (عند تفعيل الإدخال التلقائي)',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح للمستخدم بتعديل المبلغ المدفوع نقدًا أو استخدام فئات العملة عند تفعيل إدخال المدفوع تلقائيًا'
  },
  {
    key: 'invoices.edit_price_before_save',
    label: 'تعديل سعر البيع في POS قبل الحفظ',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بتعديل سعر بيع الصنف داخل شاشة البيع لهذه الفاتورة فقط'
  },
  {
    key: 'invoices.edit_tax_before_save',
    label: 'تعديل نسبة الضريبة في POS قبل الحفظ',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بتعديل نسبة الضريبة للصنف داخل شاشة البيع لهذه الفاتورة فقط'
  },
  {
    key: 'pos.edit_rates',
    label: 'تعديل نسب BNPL وعمولة المنصة في POS',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بتعديل نسبة BNPL ونسبة خصم المنصة في شاشة نقطة البيع لهذه الفاتورة فقط'
  },
  {
    key: 'invoices.edit',
    label: 'تعديل الفاتورة (عام)',
    category: 'الفواتير ونقاط البيع',
    description: 'تعديل ملاحظات أو تفاصيل الفاتورة'
  },
  {
    key: 'invoices.edit_after_save',
    label: 'تعديل الفاتورة بعد حفظها (رئيسي)',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بفتح وضع تعديل الفاتورة المحفوظة وتسجيل أثر مالي ومخزني'
  },
  {
    key: 'invoices.edit_price_after_save',
    label: 'تعديل أسعار الفاتورة بعد الحفظ',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بتعديل أسعار بيع الأصناف لفاتورة محفوظة'
  },
  {
    key: 'invoices.edit_tax_after_save',
    label: 'تعديل ضريبة الفاتورة بعد الحفظ',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بتعديل نسبة وقيمة الضريبة لفاتورة محفوظة'
  },
  {
    key: 'invoices.edit_quantity_after_save',
    label: 'تعديل كميات الفاتورة بعد الحفظ',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بتعديل كميات الأصناف وتصحيح أرصدة المخزون'
  },
  {
    key: 'invoices.edit_items_after_save',
    label: 'تعديل أصناف الفاتورة بعد الحفظ',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بإضافة أصناف جديدة أو إزالتها أو استبدالها في فاتورة محفوظة'
  },
  {
    key: 'invoices.edit_platform_after_save',
    label: 'تعديل المنصة بعد الحفظ',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بتغيير منصة الفاتورة وإعادة احتساب عمولتها ورسومها'
  },
  {
    key: 'invoices.edit_customer_after_save',
    label: 'تعديل العميل بعد الحفظ',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بتعديل اسم العميل والملاحظات في فاتورة محفوظة'
  },
  {
    key: 'invoices.edit_discount_shipping_after_save',
    label: 'تعديل الخصم والشحن بعد الحفظ',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بتعديل الخصم الإضافي أو مصاريف الشحن يدوياً'
  },
  {
    key: 'invoices.edit_cashbox_after_save',
    label: 'تعديل الخزنة بعد الحفظ',
    category: 'الفواتير ونقاط البيع',
    description: 'السماح بتغيير الخزنة المحول إليها الصافي المالي'
  },
  {
    key: 'invoices.cancel',
    label: 'إلغاء الفاتورة',
    category: 'الفواتير ونقاط البيع',
    description: 'إلغاء فاتورة بيع وتراجع المخزون'
  },
  {
    key: 'invoices.print',
    label: 'طباعة الإيصال',
    category: 'الفواتير ونقاط البيع',
    description: 'طباعة إيصال الفاتورة ومشاركته'
  },
  {
    key: 'invoices.export',
    label: 'تصدير الفواتير',
    category: 'الفواتير ونقاط البيع',
    description: 'تصدير سجل الفواتير إلى ملفات خارجية'
  },
  {
    key: 'invoices.collect_credit',
    label: 'تحصيل الفواتير الآجلة',
    category: 'الفواتير ونقاط البيع',
    description: 'تحصيل وتسوية الفواتير الآجلة المعلقة للعملاء والمنصات وتسجيل فروق التحصيل'
  },
  {
    key: 'offline.manage',
    label: 'إدارة المزامنة والعمل بدون إنترنت',
    category: 'الفواتير ونقاط البيع',
    description: 'إدارة العمليات المعلّقة والفاشلة ومراجعة فواتير الأوفلاين واستيراد وتصدير النسخ الاحتياطية'
  },

  // 7. المرتجعات
  {
    key: 'returns.view',
    label: 'عرض المرتجعات',
    category: 'المرتجعات',
    description: 'الاطلاع على سجل المرتجعات الكلية والجزئية'
  },
  {
    key: 'returns.create',
    label: 'تسجيل مرتجع جديد',
    category: 'المرتجعات',
    description: 'تسجيل مرتجع صنف مع تحديد حالة الصنف وتكلفة شحن المرتجع'
  },
  {
    key: 'returns.approve',
    label: 'اعتماد المرتجع',
    category: 'المرتجعات',
    description: 'الموافقة على طلب المرتجع وتسويته ماليًا'
  },
  {
    key: 'returns.restock',
    label: 'إعادة الصنف للمخزن',
    category: 'المرتجعات',
    description: 'زيادة المخزون في حالة اختيار صنف سليم (يرجع المخزن)'
  },

  // 8. الأرباح والتقارير
  {
    key: 'reports.view_profit',
    label: 'عرض الأرباح الصافية',
    category: 'التقارير والأرباح',
    description: 'رؤية أرباح الفواتير والأصناف والمنصات (محجوب للموظف)'
  },
  {
    key: 'reports.view_costs',
    label: 'عرض إجمالي التكاليف',
    category: 'التقارير والأرباح',
    description: 'رؤية إجمالي تكاليف الشراء والتغليف والشحن'
  },
  {
    key: 'reports.view_reports',
    label: 'عرض التقارير العامة',
    category: 'التقارير والأرباح',
    description: 'الاطلاع على إحصائيات المبيعات والأكثر مبيعًا'
  },
  {
    key: 'reports.export',
    label: 'تصدير التقارير',
    category: 'التقارير والأرباح',
    description: 'تصدير التقارير المالية والإحصائية'
  },
  {
    key: 'reports.item_movement.view',
    label: 'عرض تقرير حركة صنف خلال فترة',
    category: 'التقارير والأرباح',
    description: 'الاطلاع على السجل الزمني لحركات البيع والشراء والمرتجعات والتسويات لكل صنف'
  },
  {
    key: 'reports.unsold_cart_items.view',
    label: 'عرض تقرير أصناف شاشة البيع غير المباعة',
    category: 'التقارير والأرباح',
    description: 'الاطلاع على الأصناف التي دخلت فاتورة شاشة البيع ولم تُبع (حذف، تقليل كمية، تفريغ، إغلاق الصفحة أو الجهاز)'
  },
  {
    key: 'reports.stock_adjustments.view',
    label: 'عرض تقرير تعديلات كميات الأصناف',
    category: 'التقارير والأرباح',
    description: 'الاطلاع على سجل التعديلات المباشرة واليدوية على كميات المخزون وأسبابها والمستخدم المنفذ'
  },
  {
    key: 'reports.bnpl_view',
    label: 'عرض تقرير تقسيط المنصات (BNPL)',
    category: 'التقارير والأرباح',
    description: 'الاطلاع على تقرير مبيعات وتقسيط المنصات وتحليل فروقات الأسعار وعمولات المنصات'
  },
  {
    key: 'reports.platform_view',
    label: 'عرض تقرير المنصة',
    category: 'التقارير والأرباح',
    description: 'الاطلاع على تقرير أداء ومبيعات وأرباح المنصة ورصيد الآجل والأصناف الأكثر مبيعاً والراكدة'
  },

  // 9. المستخدمون
  {
    key: 'users.view',
    label: 'عرض المستخدمين',
    category: 'المستخدمون والصلاحيات',
    description: 'الاطلاع على قائمة المستخدمين وحالاتهم'
  },
  {
    key: 'users.create',
    label: 'إنشاء مستخدم جديد',
    category: 'المستخدمون والصلاحيات',
    description: 'إضافة حسابات موظفين أو مدراء جدد'
  },
  {
    key: 'users.edit',
    label: 'تعديل بيانات المستخدم',
    category: 'المستخدمون والصلاحيات',
    description: 'تعديل اسم أو رقم هاتف أو كلمة مرور المستخدم'
  },
  {
    key: 'users.status',
    label: 'إيقاف / إعادة تفعيل المستخدم',
    category: 'المستخدمون والصلاحيات',
    description: 'تجميد حساب أو إعادة تنشيطه'
  },

  // 10. الصلاحيات
  {
    key: 'permissions.view',
    label: 'عرض صفحة الصلاحيات',
    category: 'المستخدمون والصلاحيات',
    description: 'الاطلاع على مصفوفة صلاحيات المستخدمين'
  },
  {
    key: 'permissions.manage',
    label: 'إدارة وتعيين الصلاحيات',
    category: 'المستخدمون والصلاحيات',
    description: 'منح وتعديل وسحب الصلاحيات للمستخدمين'
  },

  // 11. إعدادات الشركة والمظهر
  {
    key: 'settings.company_appearance',
    label: 'هوية الشركة ومظهر التطبيق',
    category: 'الإعدادات المتقدمة',
    description: 'التحكم في اسم وشعار وألوان وهوية وبيانات الشركة الضريبية',
    designerOnly: true
  },

  // 12. إعدادات الفاتورة والطباعة
  {
    key: 'settings.invoice_print',
    label: 'إعدادات الفاتورة والطباعة',
    category: 'الإعدادات المتقدمة',
    description: 'تحديد مقاس الإيصال وحقول الفاتورة ونصوص التذييل والشروط'
  },

  // 13. إعدادات عرض الأصناف وشاشة المبيعات
  {
    key: 'settings.display_customization',
    label: 'تخصيص عرض الأصناف والمبيعات',
    category: 'الإعدادات المتقدمة',
    description: 'التحكم في الحقول وترتيب الأعمدة وحجم الصور وشاشة POS'
  },

  // 14. إعدادات النظام والربط
  {
    key: 'settings.system_integration',
    label: 'إعدادات النظام والربط',
    category: 'الإعدادات المتقدمة',
    description: 'عرض حالة قاعدة البيانات وفحص الاتصال وكود التهيئة'
  },
  {
    key: 'settings.backup',
    label: 'النسخ الاحتياطي واسترجاع البيانات',
    category: 'الإعدادات المتقدمة',
    description: 'تنزيل نسخة احتياطية كاملة من بيانات الشركة واسترجاعها. صلاحية حساسة: الملف يحتوي كل البيانات، والاسترجاع يستبدل البيانات الحالية'
  },
  {
    key: 'settings.bank_link',
    label: 'ربط الخزن برسائل البنك والمحافظ',
    category: 'الإعدادات المتقدمة',
    description: 'إنشاء خزن مربوطة بحساب بنكي أو محفظة أو إنستا باي، تفعيلها وإيقافها، ومتابعة مطابقة الرصيد مع رسائل البنك'
  },
  {
    key: 'settings.bank_templates',
    label: 'تعريف قوالب رسائل البنك',
    category: 'الإعدادات المتقدمة',
    description: 'تعريف وتعديل قوالب قراءة رسائل البنوك والمحافظ (خانة المبلغ وخانة الرصيد) والاطلاع على نص الرسائل. لمهندس النظام ومن يُمنح الصلاحية'
  },
  {
    key: 'settings.sales_rules',
    label: 'إعدادات البيع وقواعد السعر',
    category: 'الإعدادات المتقدمة',
    description: 'تحديد وضع البيع والمنصة والعميل الافتراضيين في شاشة البيع (أو إلزام الاختيار باليد)، والسماح أو المنع للبيع بسعر صفر أو بأقل من سعر الشراء. على النسخة كلها'
  },
  {
    key: 'settings.ui_scale',
    label: 'التحكم في حجم وشكل الواجهة',
    category: 'الإعدادات المتقدمة',
    description: 'تغيير حجم الواجهة وحجم وشكل نقطة البيع (عرض لوحة الفاتورة، حجم كروت الأصناف والتصنيفات، إظهار الصور) على الجهاز المستخدَم فقط'
  },
  {
    key: 'settings.visitor_display',
    label: 'إعدادات شاشة الزوار',
    category: 'الإعدادات المتقدمة',
    description: 'رفع وترتيب وحذف صور العرض في شاشة الزوار، ومدة كل صورة ومدة ظهور المنتج، ونص الترحيب والشعار. على النسخة كلها'
  },
  {
    key: 'visitor.display',
    label: 'شاشة الزوار',
    category: 'الفواتير ونقاط البيع',
    description: 'فتح شاشة الزوار (شاشة تقلّب صور العرض، والزبون يضرب باركود المنتج فيظهر اسمه وسعره وصورته). الحساب الذي معه هذه الصلاحية فقط يفتح على الشاشة مباشرة ولا يرى غيرها'
  },
  {
    key: 'items.print_labels',
    label: 'طباعة التكت',
    category: 'الأصناف والمخزون',
    description: 'طباعة تكت الباركود للأصناف يدويًا أو من ملف إكسيل (الصنف، عدد التكت، الباركود، تاريخ الصلاحية)'
  },
  {
    key: 'settings.label_print',
    label: 'إعدادات طابعة الباركود',
    category: 'الإعدادات المتقدمة',
    description: 'مقاس التكت والورق (رول أو A4)، عدد التكت في الصف، الهوامش، العناصر التي تظهر على التكت وأماكنها وأحجام خطوطها، ومقاس الباركود. على النسخة كلها'
  },
  {
    key: 'settings.invoice_numbering',
    label: 'ترقيم الفواتير',
    category: 'الإعدادات المتقدمة',
    description: 'شكل رقم فاتورة البيع (نص قبل الرقم، التاريخ، عدد الخانات، نص بعد الرقم)، وبداية العد من جديد (يومي، أسبوعي، شهري، سنوي، أبدًا) وتصفير العد يدويًا، ومنع أو سماح تكرار رقم طلب المنصة. على النسخة كلها'
  },
  {
    key: 'settings.reset_operations',
    label: 'إعادة ضبط العمليات (مسح الحركة مع بقاء الأسماء)',
    category: 'الإعدادات المتقدمة',
    description: 'مسح كل الفواتير والمشتريات والمرتجعات وحركات المخزون والخزائن وتصفير الكميات والأرصدة، مع بقاء أسماء الأصناف والعملاء والموردين والمنصات. صلاحية خطيرة ولا يمكن التراجع عن العملية'
  },
  {
    key: 'settings.factory_reset',
    label: 'إعادة ضبط المصنع (مسح كل شيء)',
    category: 'الإعدادات المتقدمة',
    description: 'مسح كل بيانات النظام وإرجاع الإعدادات للافتراضي مع بقاء حساب مالك النظام وحساب منفّذ العملية فقط. أخطر صلاحية في النظام ولا يمكن التراجع عن العملية'
  },
  {
    key: 'settings.negative_stock',
    label: 'التحكم في سياسة البيع بالسالب للمخزون',
    category: 'الإعدادات المتقدمة',
    description: 'تفعيل أو تعطيل السماح العام بالبيع بالسالب لجميع المستخدمين عند نفاد المخزون'
  },

  // 15. عرض سجل التدقيق
  {
    key: 'audit.view',
    label: 'عرض سجل التدقيق (Audit Logs)',
    category: 'المستخدمون والصلاحيات',
    description: 'متابعة سجل العمليات الحساسة وتغيير الصلاحيات'
  },
  // 16. الموردين والمشتريات
  {
    key: 'suppliers.view',
    label: 'عرض الموردين وكشف الحساب',
    category: 'الموردين والمشتريات',
    description: 'الاطلاع على قائمة الموردين وأرصدتهم وسنداتهم'
  },
  {
    key: 'suppliers.create',
    label: 'إضافة مورد جديد',
    category: 'الموردين والمشتريات',
    description: 'تسجيل مورد جديد في النظام'
  },
  {
    key: 'suppliers.edit',
    label: 'تعديل بيانات المورد',
    category: 'الموردين والمشتريات',
    description: 'تعديل بيانات ورصيد المورد'
  },
  {
    key: 'suppliers.delete',
    label: 'أرشفة المورد',
    category: 'الموردين والمشتريات',
    description: 'أرشفة أو إيقاف حساب المورد'
  },
  {
    key: 'purchases.view',
    label: 'عرض فواتير المشتريات',
    category: 'الموردين والمشتريات',
    description: 'الاطلاع على فواتير الشراء المسجلة'
  },
  {
    key: 'purchases.create',
    label: 'تسجيل فاتورة شراء جديدة',
    category: 'الموردين والمشتريات',
    description: 'إنشاء فواتير شراء وإضافة المخزون المباشر'
  },
  {
    key: 'purchases.return',
    label: 'تسجيل مرتجع مشتريات',
    category: 'الموردين والمشتريات',
    description: 'إرجاع بضاعة للمورد واسترداد القيمة'
  },
  // 17. العملاء
  {
    key: 'customers.view',
    label: 'عرض العملاء وكشف الحساب',
    category: 'العملاء والحسابات',
    description: 'الاطلاع على بيانات العملاء وأرصدتهم'
  },
  {
    key: 'customers.create',
    label: 'إضافة عميل جديد',
    category: 'العملاء والحسابات',
    description: 'تسجيل عميل جديد في النظام'
  },
  {
    key: 'customers.edit',
    label: 'تعديل بيانات العميل',
    category: 'العملاء والحسابات',
    description: 'تعديل بيانات وحد الائتمان للعميل'
  },
  // 18. الخزائن والتحويلات المالية
  {
    key: 'cashbox.view',
    label: 'عرض الخزائن والأرصدة',
    category: 'الخزائن المالية',
    description: 'الاطلاع على أرصدة الخزائن وحركاتها'
  },
  {
    key: 'cashbox.create',
    label: 'إنشاء خزينة جديدة',
    category: 'الخزائن المالية',
    description: 'إضافة خزائن نقدية أو حسابات بنكية'
  },
  {
    key: 'cashbox.transfer',
    label: 'التحويل بين الخزائن',
    category: 'الخزائن المالية',
    description: 'تحويل مبالغ نقدية من خزينة لأخرى'
  },
  {
    key: 'cashbox.receipt',
    label: 'تسجيل سند قبض',
    category: 'الخزائن المالية',
    description: 'قبض مبالغ نقدية من عميل أو إيداع'
  },
  {
    key: 'cashbox.payment',
    label: 'تسجيل سند صرف',
    category: 'الخزائن المالية',
    description: 'صرف مبالغ لمورد أو مصروفات'
  },
  // 19. استيراد وتصدير الأصناف
  {
    key: 'items.import_export',
    label: 'استيراد وتصدير الأصناف Excel/CSV',
    category: 'الأصناف والمخزون',
    description: 'استيراد دفعات الأصناف بالملفات وتصديرها'
  },
  {
    key: 'products.export',
    label: 'تصدير الأصناف إكسيل (.xlsx)',
    category: 'الأصناف والمخزون',
    description: 'تصدير جميع أصناف المخزن كاملة إلى ملف Excel من شاشة الأصناف'
  },
  {
    key: 'products.bulk_edit_excel',
    label: 'تعديل أسعار الأصناف بالإكسيل',
    category: 'الأصناف والمخزون',
    description: 'تعديل سعر البيع أو سعر الشراء للأصناف جماعياً عبر ملف Excel مع المعاينة والتأكيد'
  },
  {
    key: 'products.inline_edit',
    label: 'التعديل المباشر من جدول الأصناف',
    category: 'الأصناف والمخزون',
    description: 'تعديل بيانات وأسعار الأصناف مباشرة داخل جدول الأصناف عند تفعيل الإعداد'
  },
  {
    key: 'delivery.settings',
    label: 'إعدادات التوصيل',
    category: 'التوصيل',
    description: 'تشغيل وقفل التوصيل، مين بيوصّل (طيارين / شركات شحن / الاتنين)، الرسوم الثابتة أو حسب المنطقة، المناطق وأسعارها وعمولاتها، الطيارين ومرتباتهم وعمولاتهم وحسابات دخولهم، شركات الشحن ورسومها، وأقصى عهدة مع الطيار'
  },
  {
    key: 'delivery.view',
    label: 'عرض شاشة التوصيل',
    category: 'التوصيل',
    description: 'يشوف كل طلبات التوصيل وحالاتها وسجل كل طلب'
  },
  {
    key: 'delivery.manage',
    label: 'توزيع طلبات التوصيل وتغيير حالتها',
    category: 'التوصيل',
    description: 'يوزّع الطلب على طيار أو شركة شحن ويغيّر حالته (خرج، اتسلم، ما اتسلمش، رجع المحل، اتلغى). الرجوع والإلغاء بيعملوا مرتجع رسمي للبضاعة'
  },
  {
    key: 'delivery.edit_fee',
    label: 'تعديل رسوم التوصيل على الفاتورة',
    category: 'التوصيل',
    description: 'يكتب رسوم توصيل غير المحسوبة من المنطقة أو الرسوم الثابتة'
  },
  {
    key: 'delivery.settle',
    label: 'تسوية فلوس الطيارين وشركات الشحن',
    category: 'التوصيل',
    description: 'يستلم فلوس الطلبات اللي اتسلمت ويدخلها الخزنة ويسجل العجز، ويصرف مستحقات الطيار (المرتب والعمولة)'
  },
  {
    key: 'delivery.reports',
    label: 'تقارير التوصيل',
    category: 'التوصيل',
    description: 'الطلبات المفتوحة والمتأخرة، عهدة الطيارين والمستحق على الشركات، أداء الطيارين، رسوم التوصيل، التسويات، ومستحقات الطيارين'
  },
  {
    key: 'delivery.driver',
    label: 'طيار',
    category: 'التوصيل',
    description: 'يشوف طلباته هو بس من موبايله ويكتب «خرجت» و«اتسلم» و«ما اتسلمش + السبب». الحساب ده لازم يتربط بالطيار في إعدادات التوصيل'
  }
];

export const PERMISSIONS = ALL_PERMISSIONS;

// قوالب الأدوار الجاهزة
export const ROLE_TEMPLATES: Record<UserRole, PermissionKey[]> = {
  // مالك النظام: كامل الصلاحيات دون استثناء
  designer: ALL_PERMISSIONS.map(p => p.key),

  // المدير: إدارة تشغيلية كاملة باستثناء ملكية النظام وتعديل المالك
  manager: [
    'dashboard.view',
    'dashboard.view_cashboxes',
    'items.view', 'items.create', 'items.edit', 'items.status', 'items.delete', 'items.import_export', 'products.export', 'products.bulk_edit_excel', 'products.inline_edit',
    'categories.view', 'categories.manage',
    'prices.view_sale', 'prices.view_purchase', 'prices.view_packaging',
    'stock.view', 'stock.edit', 'stock.adjust', 'stock.alerts',
    'warehouses.view', 'warehouses.manage', 'warehouses.transfer',
    'platforms.view', 'platforms.create', 'platforms.edit', 'platforms.status', 'platforms.pricing',
    'invoices.view', 'invoices.create', 'invoices.edit_cash_paid', 'pos.edit_rates', 'invoices.edit', 'invoices.cancel', 'invoices.print', 'invoices.export', 'invoices.collect_credit', 'offline.manage',
    'returns.view', 'returns.create', 'returns.approve', 'returns.restock',
    'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete',
    'purchases.view', 'purchases.create', 'purchases.return',
    'customers.view', 'customers.create', 'customers.edit',
    'cashbox.view', 'cashbox.create', 'cashbox.transfer', 'cashbox.receipt', 'cashbox.payment',
    'reports.view_profit', 'reports.view_costs', 'reports.view_reports', 'reports.export',
    'reports.item_movement.view', 'reports.stock_adjustments.view', 'reports.bnpl_view', 'reports.platform_view', 'reports.unsold_cart_items.view',
    'users.view', 'users.create', 'users.edit', 'users.status',
    'permissions.view', 'permissions.manage',
    'settings.invoice_print',
    'settings.display_customization',
    'settings.system_integration',
    'audit.view'
  ],

  // الموظف / الكاشير: عمليات البيع والإيصالات والمخزون دون أي أرباح أو تكاليف
  employee: [
    'dashboard.view',
    'items.view',
    'prices.view_sale',
    'stock.view',
    'stock.alerts',
    'platforms.view',
    'invoices.view',
    'invoices.view_in_pos',
    'invoices.create',
    'invoices.print',
    'returns.view',
    'returns.create',
    'returns.restock',
    'reports.view_reports'
  ]
};

/**
 * التحقق من امتلاك المستخدم لصلاحية معينة
 * الأصل: المنع ما لم تُمنح الصلاحية صراحةً
 */
export function hasPermission(user: UserAccount | null | undefined, permission: PermissionKey): boolean {
  if (!user) return false;
  // مصمم / مالك النظام يمتلك كل الصلاحيات دائمًا
  if (user.role === 'designer' || Boolean(user.isOwner)) return true;
  // التحقق من قائمة الصلاحيات الخاصة بالمستخدم
  if (Array.isArray(user.permissions)) {
    return user.permissions.includes(permission);
  }
  return false;
}

/**
 * التحقق هل المستخدم هو مالك النظام (أعلى سلطة)
 */
export function isSystemOwner(user: UserAccount | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'designer' || Boolean(user.isOwner);
}

/**
 * التحقق من صلاحية تعديل مستخدم آخر:
 * - لا يمكن لأحد تعديل مصمم النظام إلا مصمم النظام نفسه
 * - المدير العادي لا يمكنه ترقية مستخدم لمصمم
 */
export function canManageTargetUser(currentUser: UserAccount | null | undefined, targetUser: UserAccount): boolean {
  if (!currentUser) return false;
  if (currentUser.role === 'designer') return true;
  if (targetUser.role === 'designer') return false; // لا يمكن لغير المصمم إدارة المصمم
  if (currentUser.id === targetUser.id) return true; // تعديل بياناته الذاتية الأساسية
  return hasPermission(currentUser, 'users.edit') || hasPermission(currentUser, 'permissions.manage');
}

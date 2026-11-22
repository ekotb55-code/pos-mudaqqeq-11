import React from 'react';
import {
  Building2,
  Palette,
  ShoppingCart,
  ScanBarcode,
  UserCheck,
  Layers,
  Truck,
  Eye,
  Package,
  Printer,
  Hash,
  Tag,
  Percent,
  Landmark,
  Database,
  Archive,
  Keyboard,
  Users
} from 'lucide-react';

export type SettingsSectionId =
  | 'company'
  | 'appearance'
  | 'pos_sales'
  | 'barcode_ordering'
  | 'pos_customer_display'
  | 'platforms_modes'
  | 'delivery'
  | 'visitor'
  | 'stock'
  | 'print'
  | 'invoice_numbering'
  | 'labels'
  | 'tax'
  | 'bank_link'
  | 'database'
  | 'backup_reset'
  | 'shortcuts'
  | 'users';

export type SettingsGroupId = 'general' | 'pos' | 'operations' | 'system';

export interface SettingsPermissionSnapshot {
  canManageCompany: boolean;
  canManageUiScale: boolean;
  canManageDisplay: boolean;
  canManageSalesRules: boolean;
  canManagePrint: boolean;
  canManageInvoiceNumbering: boolean;
  canManageLabelPrint: boolean;
  canManageVisitorDisplay: boolean;
  canManageNegativeStock: boolean;
  canManageBankLink: boolean;
  canManageIntegration: boolean;
  canManageBackup: boolean;
  canManageReset: boolean;
  canManageShortcuts: boolean;
  canManageUsers: boolean;
  salesOnlyCommitted: boolean;
}

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  groupId: SettingsGroupId;
  label: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  supportsUnifiedSaveBar: boolean;
  isVisible: (perms: SettingsPermissionSnapshot) => boolean;
}

export const SETTINGS_GROUPS: Array<{ id: SettingsGroupId; label: string }> = [
  { id: 'general', label: 'المنشأة والمظهر' },
  { id: 'pos', label: 'نقطة البيع والمبيعات' },
  { id: 'operations', label: 'المخزون والفواتير والضرائب' },
  { id: 'system', label: 'الربط، الأمان، والنظام' }
];

export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  // 1) المنشأة والمظهر
  {
    id: 'company',
    groupId: 'general',
    label: 'بيانات المنشأة والتواصل',
    title: 'بيانات المنشأة والتواصل',
    subtitle: 'هوية المنشأة، البيانات الضريبية، أرقام التواصل في شاشة الدخول، ومهلة عدم النشاط.',
    icon: Building2,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManageCompany
  },
  {
    id: 'appearance',
    groupId: 'general',
    label: 'المظهر والحجم',
    title: 'المظهر والحجم',
    subtitle: 'الثيمات، الخط، المؤثرات الحركية، مقاسات الواجهة على هذا الجهاز، وشكل عرض الأصناف.',
    icon: Palette,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManageCompany || p.canManageUiScale || p.canManageDisplay
  },

  // 2) نقطة البيع والمبيعات
  {
    id: 'pos_sales',
    groupId: 'pos',
    label: 'نقطة البيع وقواعد السعر',
    title: 'نقطة البيع وقواعد السعر',
    subtitle: 'الافتراضيات عند فتح شاشة البيع، قواعد السعر، خيارات تأكيد وتحصيل الفاتورة، والتصنيفات الظاهرة.',
    icon: ShoppingCart,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManageSalesRules || p.canManageDisplay || p.canManagePrint
  },
  {
    id: 'barcode_ordering',
    groupId: 'pos',
    label: 'الباركود وترتيب الأصناف',
    title: 'الباركود وترتيب الأصناف',
    subtitle: 'طريقة إضافة الكمية عند مسح الباركود، وترتيب أحدث صنف أولًا لكل شاشة معاملات بشكل مستقل.',
    icon: ScanBarcode,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManageDisplay
  },
  {
    id: 'pos_customer_display',
    groupId: 'pos',
    label: 'بيانات العميل في نقطة البيع',
    title: 'بيانات العميل في نقطة البيع',
    subtitle: 'التحكم في إظهار عنوان وهاتف ورصيد العميل داخل شاشة نقطة البيع وقائمة اختيار العميل.',
    icon: UserCheck,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManageDisplay
  },
  {
    id: 'platforms_modes',
    groupId: 'pos',
    label: 'المنصات ووضع البيع فقط',
    title: 'المنصات ووضع البيع فقط',
    subtitle: 'التحكم المركزي في تفعيل مبيعات ووظائف المنصات أو تشغيل البرنامج بوضع البيع المباشر فقط.',
    icon: Layers,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManageSalesRules
  },
  {
    id: 'delivery',
    groupId: 'pos',
    label: 'إعدادات التوصيل',
    title: 'إعدادات التوصيل',
    subtitle: 'تفعيل رسوم التوصيل الاختيارية على فاتورة نقطة البيع والوصول لإعدادات التوصيل التشغيلية.',
    icon: Truck,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManageCompany
  },
  {
    id: 'visitor',
    groupId: 'pos',
    label: 'شاشة الزوار',
    title: 'شاشة الزوار',
    subtitle: 'صور العرض المتقلّبة وإعدادات الترحيب واستعلام الزبون عن سعر المنتج بالباركود.',
    icon: Eye,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManageVisitorDisplay
  },

  // 3) المخزون والفواتير والضرائب
  {
    id: 'stock',
    groupId: 'operations',
    label: 'الأصناف والمخزون',
    title: 'الأصناف والمخزون',
    subtitle: 'سياسة البيع والتحويل بالسالب وإعدادات عرض رصيد المخزون والتعديل المباشر في جدول الأصناف.',
    icon: Package,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManageNegativeStock || p.canManageDisplay
  },
  {
    id: 'print',
    groupId: 'operations',
    label: 'طباعة الفواتير والإيصالات',
    title: 'طباعة الفواتير والإيصالات',
    subtitle: 'مقاس ورق الإيصال، البيانات المطبوعة في الترويسة والفوتر، ومعاينة الفاتورة المباشرة.',
    icon: Printer,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManagePrint
  },
  {
    id: 'invoice_numbering',
    groupId: 'operations',
    label: 'ترقيم الفواتير',
    title: 'ترقيم الفواتير',
    subtitle: 'صيغة رقم الفاتورة، التاريخ والفاصل، تصفير العد التلقائي، وتكرار رقم طلب المنصة.',
    icon: Hash,
    supportsUnifiedSaveBar: false,
    isVisible: (p) => p.canManageInvoiceNumbering
  },
  {
    id: 'labels',
    groupId: 'operations',
    label: 'طابعة الباركود',
    title: 'طابعة الباركود',
    subtitle: 'مقاس تكت الباركود، الورق والهوامش، دقة الطابعة، ترتيب العناصر، ومعاينة التكت بالمقاس الحقيقي.',
    icon: Tag,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManageLabelPrint && !p.salesOnlyCommitted
  },
  {
    id: 'tax',
    groupId: 'operations',
    label: 'الضريبة والعمولة',
    title: 'الضريبة والعمولة',
    subtitle: 'سياسة شمول الضريبة في أسعار البيع وطريقة احتساب عمولة المنصات.',
    icon: Percent,
    supportsUnifiedSaveBar: true,
    isVisible: (p) => p.canManageCompany
  },

  // 4) الربط، الأمان، والنظام
  {
    id: 'bank_link',
    groupId: 'system',
    label: 'الخزن المربوطة بالبنك',
    title: 'الخزن المربوطة بالبنك',
    subtitle: 'ربط خزن النظام بحسابات البنك والمحافظ وإنستا باي عبر رسائل الهاتف ومطابقة الأرصدة تلقائيًا.',
    icon: Landmark,
    supportsUnifiedSaveBar: false,
    isVisible: (p) => p.canManageBankLink
  },
  {
    id: 'database',
    groupId: 'system',
    label: 'قاعدة البيانات والصور',
    title: 'قاعدة البيانات والصور',
    subtitle: 'حالة الاتصال بقاعدة البيانات، فحص التهيئة، كود الإعداد، ونقل الصور المخزنة للسيرفر.',
    icon: Database,
    supportsUnifiedSaveBar: false,
    isVisible: (p) => p.canManageIntegration
  },
  {
    id: 'backup_reset',
    groupId: 'system',
    label: 'النسخ الاحتياطي وإعادة الضبط',
    title: 'النسخ الاحتياطي وإعادة الضبط',
    subtitle: 'تنزيل واسترجاع النسخ الاحتياطية، النسخ المحلي على الجهاز، وإعادة ضبط البيانات.',
    icon: Archive,
    supportsUnifiedSaveBar: false,
    isVisible: (p) => p.canManageBackup || p.canManageIntegration || p.canManageReset
  },
  {
    id: 'shortcuts',
    groupId: 'system',
    label: 'اختصارات لوحة المفاتيح',
    title: 'اختصارات لوحة المفاتيح',
    subtitle: 'إدارة اختصارات لوحة المفاتيح العامة للبرنامج كله وتخصيص المفاتيح وحالتها (حفظ فوري).',
    icon: Keyboard,
    supportsUnifiedSaveBar: false,
    isVisible: (p) => p.canManageShortcuts
  },
  {
    id: 'users',
    groupId: 'system',
    label: 'المستخدمون والجلسات النشطة',
    title: 'المستخدمون والجلسات النشطة',
    subtitle: 'إدارة حسابات المستخدمين والأدوار وتعيينات الخزائن ومراقبة وإنهاء الجلسات النشطة.',
    icon: Users,
    supportsUnifiedSaveBar: false,
    isVisible: (p) => p.canManageUsers
  }
];

export const SETTINGS_SECTION_MAP: Record<SettingsSectionId, SettingsSectionMeta> =
  SETTINGS_SECTIONS.reduce((acc, s) => {
    acc[s.id] = s;
    return acc;
  }, {} as Record<SettingsSectionId, SettingsSectionMeta>);

export function isValidSettingsSectionId(
  value: string | null | undefined
): value is SettingsSectionId {
  return Boolean(value && Object.prototype.hasOwnProperty.call(SETTINGS_SECTION_MAP, value));
}

export function getVisibleSettingsSections(
  perms: SettingsPermissionSnapshot
): SettingsSectionMeta[] {
  return SETTINGS_SECTIONS.filter((s) => s.isVisible(perms));
}

export function resolveFirstAllowedSection(
  perms: SettingsPermissionSnapshot
): SettingsSectionId {
  const visible = getVisibleSettingsSections(perms);
  return visible[0]?.id || 'company';
}

export function resolveSectionFromInitialTab(
  initialTab: string | undefined,
  perms: SettingsPermissionSnapshot,
  locationHash?: string
): SettingsSectionId {
  const isVisible = (id: SettingsSectionId) => SETTINGS_SECTION_MAP[id]?.isVisible(perms);
  const pickFirstVisible = (candidates: SettingsSectionId[]): SettingsSectionId => {
    for (const id of candidates) {
      if (isVisible(id)) return id;
    }
    return resolveFirstAllowedSection(perms);
  };

  if (!initialTab) {
    return resolveFirstAllowedSection(perms);
  }

  switch (initialTab) {
    case 'company':
      return pickFirstVisible(['company']);
    case 'appearance':
    case 'ui_scale':
      return pickFirstVisible(['appearance']);
    case 'sales':
    case 'display':
      return pickFirstVisible([
        'pos_sales',
        'barcode_ordering',
        'pos_customer_display',
        'platforms_modes',
        'delivery'
      ]);
    case 'visitor':
      return pickFirstVisible(['visitor']);
    case 'stock':
      return pickFirstVisible(['stock']);
    case 'print':
      return pickFirstVisible(['print', 'invoice_numbering']);
    case 'labels':
      return pickFirstVisible(['labels']);
    case 'tax':
      return pickFirstVisible(['tax']);
    case 'bank_link':
      return pickFirstVisible(['bank_link']);
    case 'backup':
      return pickFirstVisible(['backup_reset', 'database']);
    case 'integration':
      if (locationHash === '#backup') {
        return pickFirstVisible(['backup_reset', 'database']);
      }
      return pickFirstVisible(['database', 'backup_reset']);
    case 'shortcuts':
      return pickFirstVisible(['shortcuts']);
    case 'users':
      return pickFirstVisible(['users']);
    default:
      return resolveFirstAllowedSection(perms);
  }
}

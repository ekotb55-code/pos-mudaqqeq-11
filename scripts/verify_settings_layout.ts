import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NAV_GROUPS,
  isGroupVisible,
  isSubItemVisible,
  normalizeNavigationTarget,
  resolvePathToTarget
} from '../src/config/navigation.ts';
import { SettingsPage, type SettingsTab } from '../src/pages/SettingsPage.tsx';
import type { SystemConfig, UserAccount } from '../src/types/index.ts';

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

const navSrc = read('src/config/navigation.ts');
const settingsSrc = read('src/pages/SettingsPage.tsx');
const navbarSrc = read('src/components/Navbar.tsx');
const appSrc = read('src/App.tsx');
const cssSrc = read('src/index.css');
const typesSrc = read('src/types/index.ts');

// 1) Exact 10 settings pages in exact order
const settingsGroup = NAV_GROUPS.find((g) => g.id === 'settings')!;
assert.ok(settingsGroup, 'مجموعة الإعدادات موجودة');

const expectedSubItems = [
  { id: 'settings-company', tab: 'company', path: '/settings/company', labelAr: 'بيانات المنشأة' },
  { id: 'settings-appearance', tab: 'appearance', path: '/settings/appearance', labelAr: 'المظهر والحجم' },
  { id: 'settings-sales', tab: 'sales', path: '/settings/sales', labelAr: 'البيع ونقطة البيع' },
  { id: 'settings-visitor', tab: 'visitor', path: '/settings/visitor', labelAr: 'شاشة الزوار' },
  { id: 'settings-stock', tab: 'stock', path: '/settings/stock', labelAr: 'الأصناف والمخزون' },
  { id: 'settings-print', tab: 'print', path: '/settings/print', labelAr: 'الفواتير والطباعة' },
  { id: 'settings-labels', tab: 'labels', path: '/settings/labels', labelAr: 'طابعة الباركود' },
  { id: 'settings-tax', tab: 'tax', path: '/settings/tax', labelAr: 'الضريبة والعمولة' },
  { id: 'settings-bank-link', tab: 'bank_link', path: '/settings/bank-link', labelAr: 'الخزن المربوطة بالبنك' },
  { id: 'settings-integration', tab: 'integration', path: '/settings/integration', labelAr: 'قاعدة البيانات والنسخ الاحتياطي' },
  { id: 'settings-shortcuts', tab: 'shortcuts', path: '/settings/shortcuts', labelAr: 'اختصارات لوحة المفاتيح' }
];

assert.equal(
  settingsGroup.subItems.length,
  11,
  `مجموعة الإعدادات يجب أن تحتوي 11 صفحة فقط، الفعلي: ${settingsGroup.subItems.length}`
);

expectedSubItems.forEach((exp, idx) => {
  const actual = settingsGroup.subItems[idx];
  assert.equal(actual.id, exp.id, `العنصر #${idx + 1} ID`);
  assert.equal(actual.tab, exp.tab, `العنصر #${idx + 1} tab`);
  assert.equal(actual.path, exp.path, `العنصر #${idx + 1} path`);
  assert.equal(actual.labelAr, exp.labelAr, `العنصر #${idx + 1} labelAr`);
});

assert.ok(!settingsGroup.subItems.some((i) => i.id === 'settings-display'), 'حذف عنصر settings-display المكرر');
assert.ok(!settingsGroup.subItems.some((i) => i.id === 'settings-ui-scale'), 'حذف عنصر settings-ui-scale المستقل');

// 2) Legacy route redirects
const ownerUser: UserAccount = {
  id: 'u-owner',
  username: 'owner',
  name: 'مالك النظام',
  role: 'designer',
  status: 'active',
  isOwner: true,
  permissions: [],
  createdAt: '2026-01-01T00:00:00Z'
};

const resolvedDisplay = resolvePathToTarget('/settings/display', ownerUser);
assert.equal(resolvedDisplay.tab, 'sales');
assert.equal(resolvedDisplay.path, '/settings/sales');

const resolvedUiScale = resolvePathToTarget('/settings/ui-scale', ownerUser);
assert.equal(resolvedUiScale.tab, 'appearance');
assert.equal(resolvedUiScale.path, '/settings/appearance');

const resolvedBackup = resolvePathToTarget('/settings/backup', ownerUser);
assert.equal(resolvedBackup.tab, 'integration');
assert.equal(resolvedBackup.path, '/settings/integration#backup');

const normDisplay = normalizeNavigationTarget('settings', 'display', ownerUser);
assert.equal(normDisplay.tab, 'sales');
const normScale = normalizeNavigationTarget('settings', 'ui_scale', ownerUser);
assert.equal(normScale.tab, 'appearance');

// 3) Permission checks on reorganized items
const makeEmp = (perms: UserAccount['permissions']): UserAccount => ({
  id: 'u-emp',
  username: 'emp',
  name: 'موظف',
  role: 'cashier',
  status: 'active',
  permissions: perms,
  createdAt: '2026-01-01T00:00:00Z'
});

assert.equal(
  isSubItemVisible(settingsGroup.subItems[2], makeEmp(['settings.sales_rules'])),
  true,
  'settings-sales يظهر لمن معه settings.sales_rules'
);
assert.equal(
  isSubItemVisible(settingsGroup.subItems[1], makeEmp(['settings.ui_scale'])),
  true,
  'settings-appearance يظهر لمن معه settings.ui_scale'
);
assert.equal(
  isSubItemVisible(settingsGroup.subItems[1], makeEmp(['settings.display_customization'])),
  true,
  'settings-appearance يظهر لمن معه settings.display_customization'
);
assert.equal(
  isSubItemVisible(settingsGroup.subItems[3], makeEmp(['settings.visitor_display'])),
  true,
  'settings-visitor يظهر لمن معه settings.visitor_display'
);
assert.equal(
  isSubItemVisible(settingsGroup.subItems[4], makeEmp(['settings.negative_stock'])),
  true,
  'settings-stock يظهر لمن معه settings.negative_stock'
);
assert.equal(
  isSubItemVisible(settingsGroup.subItems[4], makeEmp(['settings.display_customization'])),
  true,
  'settings-stock يظهر لمن معه settings.display_customization'
);
assert.equal(
  isGroupVisible(settingsGroup, makeEmp(['invoices.create'])),
  false,
  'مجموعة الإعدادات لا تظهر للكاشير بلا صلاحيات إعدادات'
);

// 4) Zero duplication & removed legacy clutter in SettingsPage
const printSectionStart = settingsSrc.indexOf("{activeTab === 'print'");
const taxSectionStart = settingsSrc.indexOf("{activeTab === 'tax'");
const printSectionSlice = settingsSrc.slice(printSectionStart, taxSectionStart);
assert.ok(
  !printSectionSlice.includes('autoFillCashPaid'),
  'خيار تعبئة المدفوع النقدي تلقائيًا يجب أن يكون في صفحة البيع فقط ولا يظهر في صفحة الفواتير والطباعة'
);

const companySectionStart = settingsSrc.indexOf("{activeTab === 'company'");
const appearanceSectionStart = settingsSrc.indexOf("{activeTab === 'appearance'");
const companySectionSlice = settingsSrc.slice(companySectionStart, appearanceSectionStart);
assert.ok(
  !companySectionSlice.includes('enableDeliveryFee'),
  'خيار رسوم التوصيل نُقل من صفحة بيانات المنشأة إلى صفحة البيع ونقطة البيع'
);
assert.ok(
  !companySectionSlice.includes('renderOfflineBackupSection'),
  'النسخ الاحتياطي المحلي على الجهاز يظهر في صفحة قاعدة البيانات والنسخ الاحتياطي فقط'
);

assert.equal(
  (settingsSrc.match(/\{renderOfflineBackupSection\(\)\}/g) || []).length,
  1,
  'renderOfflineBackupSection تُعرض في مكان واحد فقط'
);

// Brand custom color removed from UI while preserved in types & baseline
assert.ok(!settingsSrc.includes('اللون المخصص للعلامة التجارية'), 'حذف حقل اللون المخصص للعلامة التجارية من الواجهة');
assert.ok(!settingsSrc.includes('company-brand-color'), 'حذف إدخال اللون المخصص من الواجهة');
assert.ok(typesSrc.includes('themeColor') && typesSrc.includes('accentColor'), 'الإبقاء على themeColor و accentColor في النوع');

// Technical permission strings not shown in headings/rows
assert.ok(!settingsSrc.includes('(products.inline_edit)'), 'عدم إظهار (products.inline_edit) في الواجهة');
assert.ok(!settingsSrc.includes('>settings.negative_stock<'), 'عدم إظهار settings.negative_stock في رأس القسم');
assert.ok(!settingsSrc.includes('تحكم مالك ومصمم النظام'), 'عدم إظهار شارة تحكم مالك ومصمم النظام');

// Header buttons moved out of SettingsPage & Change Password placed in Navbar
assert.ok(!settingsSrc.includes('مزامنة شاملة الآن'), 'حذف زر مزامنة شاملة الآن من هيدر الإعدادات');
assert.ok(!settingsSrc.includes('handleOpenChangeOwnPassword'), 'حذف تغيير كلمة السر من هيدر الإعدادات');
assert.ok(
  navbarSrc.includes('تغيير كلمة السر') && navbarSrc.includes('api.changeOwnPassword'),
  'نقل تغيير كلمة السر إلى قائمة المستخدم في الشريط العلوي'
);

// Unified sticky bottom Save bar + unsaved guard
assert.ok(
  settingsSrc.includes('settings-sticky-save-bar') &&
    settingsSrc.includes('يوجد تغييرات غير محفوظة') &&
    settingsSrc.includes('تراجع') &&
    settingsSrc.includes('handleUnifiedSave'),
  'وجود شريط الحفظ والتراجع الموحّد أسفل الصفحات 1-6'
);
assert.ok(
  appSrc.includes('يوجد تغييرات غير محفوظة. تخرج بدون حفظ؟') &&
    appSrc.includes('البقاء') &&
    appSrc.includes('خروج بدون حفظ') &&
    appSrc.includes('isSettingsDirty'),
  'وجود حارس التنقل عند وجود تغييرات غير محفوظة في App.tsx'
);

// Font CSS variable wired
assert.ok(cssSrc.includes('--app-font-family') && appSrc.includes('--app-font-family'), 'تطبيق --app-font-family على التطبيق كله');

// 5) Render all 9 pages statically via renderToStaticMarkup without throwing
const dummyConfig: SystemConfig = {
  storeName: 'متجر تجريبي',
  currency: 'ج.م',
  enableDeliveryFee: false,
  persistenceMode: 'supabase',
  companySettings: {
    storeName: 'متجر تجريبي',
    brandTagline: 'وصف',
    logoUrl: '',
    phone: '01000000000',
    email: 'test@example.com',
    address: 'القاهرة',
    taxNumber: '123',
    commercialRecord: '456',
    themeColor: '#0e7490',
    accentColor: '#14b8a6',
    fontFamily: 'Tajawal',
    appTheme: 'light-sky',
    motionEnabled: true
  }
};

const tabs: SettingsTab[] = [
  'company',
  'appearance',
  'sales',
  'visitor',
  'stock',
  'print',
  'labels',
  'tax',
  'bank_link',
  'integration',
  'shortcuts'
];

for (const tab of tabs) {
  const html = renderToStaticMarkup(
    React.createElement(SettingsPage, {
      config: dummyConfig,
      users: [ownerUser],
      currentUser: ownerUser,
      onSaveUser: async () => ({ success: true }),
      onSyncAll: async () => {},
      initialTab: tab
    })
  );
  assert.ok(html.length > 100, `رسم صفحة ${tab} بنجاح`);
  assert.ok(!html.includes('تغيير كلمة السر'), `خلو هيدر ${tab} من تغيير كلمة السر`);
  assert.ok(!html.includes('مزامنة شاملة الآن'), `خلو هيدر ${tab} من مزامنة شاملة الآن`);
}

// Verify nav.ts path syntax clean
assert.ok(navSrc.includes("path: '/settings/appearance'") && navSrc.includes("path: '/settings/sales'"));

console.log('🎉 كل اختبارات إعادة تنظيم الإعدادات (9 صفحات، صفر تكرار، شريط الحفظ، حارس التنقل) نجحت.');

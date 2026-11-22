/**
 * اختبار واجهة طباعة التكت وإعدادات طابعة الباركود
 * التشغيل: npx tsx scripts/verify_label_print_ui.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NAV_GROUPS,
  isSubItemVisible,
  resolvePathToTarget
} from '../src/config/navigation.ts';
import { LabelPrintPage } from '../src/pages/LabelPrintPage.tsx';
import { SettingsPage } from '../src/pages/SettingsPage.tsx';
import type { Item, SystemConfig, UserAccount } from '../src/types/index.ts';

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

let passed = 0;
function check(label: string, cond: unknown) {
  assert.ok(cond, label);
  passed++;
}

const clientSrc = read('src/api/client.ts');
const labelPageSrc = read('src/pages/LabelPrintPage.tsx');
const settingsSrc = read('src/pages/SettingsPage.tsx');
const appSrc = read('src/App.tsx');

// 1) الدوال في src/api/client.ts
check('وجود getLabelSettings في api client', clientSrc.includes('getLabelSettings'));
check('وجود saveLabelSettings في api client', clientSrc.includes('saveLabelSettings'));
check('وجود addItemBarcode في api client', clientSrc.includes('addItemBarcode'));
check(
  'استيراد LabelSettings من ../utils/labelPrint',
  clientSrc.includes("from '../utils/labelPrint'")
);

// 2) المسارات والصلاحيات في navigation.ts
const itemsGroup = NAV_GROUPS.find((g) => g.id === 'items')!;
const labelNavSubItem = itemsGroup.subItems.find((s) => s.id === 'items-label-print')!;
check('وجود عنصر طباعة التكت تحت الأصناف والمخزون', Boolean(labelNavSubItem));
check('مسار طباعة التكت هو /items/labels', labelNavSubItem.path === '/items/labels');
check('صلاحية طباعة التكت هي items.print_labels', labelNavSubItem.permission === 'items.print_labels');
check('اسم طباعة التكت بالعربية', labelNavSubItem.labelAr === 'طباعة التكت');

const settingsGroup = NAV_GROUPS.find((g) => g.id === 'settings')!;
const printIdx = settingsGroup.subItems.findIndex((s) => s.id === 'settings-print');
const labelsIdx = settingsGroup.subItems.findIndex((s) => s.id === 'settings-labels');
check('وجود تبويب طابعة الباركود في الإعدادات', labelsIdx > -1);
check('تبويب طابعة الباركود يأتي بعد الفواتير والطباعة مباشرة', labelsIdx === printIdx + 1);
const settingsLabelsSubItem = settingsGroup.subItems[labelsIdx];
check('مسار إعدادات طابعة الباركود هو /settings/labels', settingsLabelsSubItem.path === '/settings/labels');
check(
  'صلاحية إعدادات طابعة الباركود هي settings.label_print',
  settingsLabelsSubItem.permission === 'settings.label_print' ||
    typeof settingsLabelsSubItem.permission === 'function'
);

const makeUser = (perms: UserAccount['permissions'], isOwner = false): UserAccount => ({
  id: 'u-test',
  username: 'tester',
  name: 'مستخدم اختبار',
  role: isOwner ? 'designer' : 'employee',
  isOwner,
  status: 'active',
  permissions: perms,
  createdAt: '2026-01-01T00:00:00Z'
});

check(
  'صفحة طباعة التكت تظهر لمن معه items.print_labels',
  isSubItemVisible(labelNavSubItem, makeUser(['items.print_labels']))
);
check(
  'صفحة طباعة التكت لا تظهر لمن ليس معه items.print_labels',
  !isSubItemVisible(labelNavSubItem, makeUser(['items.view']))
);
check(
  'تبويب طابعة الباركود يظهر لمن معه settings.label_print',
  isSubItemVisible(settingsLabelsSubItem, makeUser(['settings.label_print']))
);
check(
  'تبويب طابعة الباركود لا يظهر لمن ليس معه settings.label_print',
  !isSubItemVisible(settingsLabelsSubItem, makeUser(['settings.invoice_print']))
);

const resolvedLabelsRoute = resolvePathToTarget('/items/labels', makeUser(['items.print_labels']));
check('حل المسار /items/labels يفتح صفحة label_print وليس تفاصيل صنف', resolvedLabelsRoute.page === 'label_print');

const resolvedSettingsLabelsRoute = resolvePathToTarget(
  '/settings/labels',
  makeUser(['settings.label_print'])
);
check(
  'حل المسار /settings/labels يفتح تبويب labels',
  resolvedSettingsLabelsRoute.page === 'settings' && resolvedSettingsLabelsRoute.tab === 'labels'
);

// 3) التحقق من متطلبات شاشة طباعة التكت (LabelPrintPage.tsx)
check('استدعاء parseLabelSheet في LabelPrintPage', labelPageSrc.includes('parseLabelSheet('));
check('استدعاء buildLabelPrintHtml في LabelPrintPage', labelPageSrc.includes('buildLabelPrintHtml('));
check('استدعاء defaultBarcodeFor في LabelPrintPage', labelPageSrc.includes('defaultBarcodeFor('));
check('استدعاء itemBarcodeList في LabelPrintPage', labelPageSrc.includes('itemBarcodeList('));
check(
  'حفظ علامة userChangedBarcode لعدم رجوع الباركود للافتراضي إذا غيّره المستخدم',
  labelPageSrc.includes('userChangedBarcode')
);
check(
  'خيار باركود آخر… لكتابة أي باركود حر',
  labelPageSrc.includes('باركود آخر…')
);
check(
  'إظهار عمود تاريخ الصلاحية فقط لو العنصر مفعّل في الإعدادات',
  labelPageSrc.includes("settings.elements.find((e) => e.key === 'expiry')?.show")
);
check(
  'السطر السريع لضرب الباركود وزيادة العدد لو مكرر ورسالة الصنف غير موجود',
  labelPageSrc.includes('الصنف غير موجود') && labelPageSrc.includes('handleQuickBarcodeScan')
);
check(
  'نموذج الإكسيل بالأعمدة الأربعة (الصنف، عدد التكت، الباركود، تاريخ الصلاحية)',
  labelPageSrc.includes("['الصنف', 'عدد التكت', 'الباركود', 'تاريخ الصلاحية']")
);
check(
  'قراءة ملف الإكسيل بـ XLSX واستدعاء parseLabelSheet',
  labelPageSrc.includes('XLSX.read') && labelPageSrc.includes('parseLabelSheet(rawRows')
);
check(
  'خيار اطبع على طول بعد الرفع محفوظ في localStorage',
  labelPageSrc.includes('اطبع على طول بعد الرفع') &&
    labelPageSrc.includes('mudaqqeq_label_auto_print_after_upload')
);
check(
  'تحذير الباركود غير المسجل بالنص المطلوب حرفيًا',
  labelPageSrc.includes('الباركود ده مش متسجل على الصنف: لو اتضرب في البيع مش هيلاقيه')
);
check(
  'زر ضيفه كباركود فرعي للصنف لمن معه items.edit يستدعي api.addItemBarcode',
  labelPageSrc.includes('ضيفه كباركود فرعي للصنف') &&
    labelPageSrc.includes('api.addItemBarcode(') &&
    labelPageSrc.includes('canEditItems')
);
check(
  'تحذير الباركود الرفيع جدًا (denseBarcodes) مع زر اطبع على أي حال',
  labelPageSrc.includes(
    'خطوط الباركود رفيعة جدًا على هذه الطابعة وقد لا تُقرأ — كبّر عرض الباركود من الإعدادات'
  ) && labelPageSrc.includes('اطبع على أي حال')
);
check(
  'الطباعة عبر iframe مخفي بدون window.open',
  labelPageSrc.includes('printHtmlInHiddenIframe') &&
    labelPageSrc.includes("document.createElement('iframe')") &&
    !labelPageSrc.includes('window.open')
);
check(
  'استخدام taxInclusive من إعدادات الضريبة الحالية',
  labelPageSrc.includes('config.taxSettings?.taxInclusive')
);

// 4) التحقق من تبويب إعدادات طابعة الباركود (SettingsPage.tsx)
check('وجود تبويب labels في SettingsPage', settingsSrc.includes("activeTab === 'labels'"));
check(
  'ربط تبويب labels بشريط الحفظ الموحد ودالة saveLabelSettings',
  settingsSrc.includes('api.saveLabelSettings(') && settingsSrc.includes('pageDiffs.labels')
);
check(
  'وجود أزرار المقاسات الجاهزة LABEL_SIZE_PRESETS في إعدادات طابعة الباركود',
  settingsSrc.includes('LABEL_SIZE_PRESETS.map')
);
check(
  'وجود تحكم الورق (رول / A4)، الهوامش، ودقة الطابعة 203 و300',
  settingsSrc.includes('203 نقطة/بوصة (الأشهر)') &&
    settingsSrc.includes('300 نقطة/بوصة') &&
    settingsSrc.includes('هوامش التكت الداخلية') &&
    settingsSrc.includes('هوامش الصفحة')
);
check(
  'وجود تحكم العناصر (يظهر، لأعلى، لأسفل، المحاذاة، حجم الخط، عريض)',
  settingsSrc.includes('LABEL_ELEMENT_LABELS[el.key]') &&
    settingsSrc.includes('لأعلى') &&
    settingsSrc.includes('لأسفل') &&
    settingsSrc.includes('اسم الصنف من') &&
    settingsSrc.includes('أضف رابط الشعار من صفحة بيانات المنشأة')
);
check(
  'وجود معاينة حية وزر طباعة تجريبية في إعدادات طابعة الباركود',
  settingsSrc.includes('label-settings-live-preview-iframe') &&
    settingsSrc.includes('طباعة تجريبية')
);
check(
  'وجود الملاحظة الثابتة لطابعات الرول بالنص المطلوب',
  settingsSrc.includes(
    'في طابعات الرول: اضبط مقاس الورق في تعريف الطابعة على الكمبيوتر بنفس مقاس التكت (أو عرض الصف كله لو أكثر من تكت في الصف)، واختر في نافذة الطباعة: الهوامش بلا، والمقياس 100%'
  )
);

// 5) رسم LabelPrintPage و SettingsPage(labels) عبر renderToStaticMarkup للتأكد من عدم وجود أخطاء
const sampleItems: Item[] = [
  {
    id: 'item-1',
    code: 'ITM-1',
    name: 'شاحن سريع 65W',
    printName: 'شاحن 65W',
    barcode: '6221234567896',
    secondaryBarcodes: ['6220000000019'],
    category: 'إكسسوارات',
    unit: 'قطعة',
    salePrice: 850,
    purchasePrice: 600,
    packagingCost: 10,
    stock: 20,
    reorderLimit: 5,
    taxRate: 14,
    status: 'نشط'
  }
];

const dummyConfig: SystemConfig = {
  storeName: 'متجر المدقق',
  currency: 'ج.م',
  enableDeliveryFee: false,
  taxSettings: {
    taxInclusive: true,
    platformCommissionOn: 'before_tax'
  },
  companySettings: {
    storeName: 'متجر المدقق',
    brandTagline: 'وصف',
    logoUrl: '',
    phone: '01000000000',
    email: 'test@example.com',
    address: 'القاهرة',
    taxNumber: '123',
    commercialRecord: '456',
    themeColor: '#0e7490',
    accentColor: '#14b8a6'
  }
};

const owner = makeUser([], true);
const labelPageHtml = renderToStaticMarkup(
  React.createElement(LabelPrintPage, {
    items: sampleItems,
    user: owner,
    config: dummyConfig
  })
);
check('رسم LabelPrintPage بنجاح', labelPageHtml.includes('طباعة التكت') && labelPageHtml.includes('تحميل نموذج الإكسيل'));
check(
  'عمود تاريخ الصلاحية مخفي افتراضيًا لأن expiry غير مفعّل في الإعدادات الافتراضية',
  !labelPageHtml.includes('>تاريخ الصلاحية<')
);

const settingsLabelsHtml = renderToStaticMarkup(
  React.createElement(SettingsPage, {
    config: dummyConfig,
    items: sampleItems,
    users: [owner],
    currentUser: owner,
    onSaveUser: async () => ({ success: true }),
    onSyncAll: async () => {},
    initialTab: 'labels'
  })
);
check(
  'رسم تبويب طابعة الباركود في SettingsPage بنجاح',
  settingsLabelsHtml.includes('طابعة الباركود') &&
    settingsLabelsHtml.includes('40×25') &&
    settingsLabelsHtml.includes('طباعة تجريبية')
);

check('ربط LabelPrintPage في App.tsx', appSrc.includes("currentPage === 'label_print'"));

console.log(`✓ نجح اختبار واجهة طباعة التكت وإعدادات طابعة الباركود (${passed} فحص)`);

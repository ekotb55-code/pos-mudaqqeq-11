import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NAV_GROUPS, isGroupVisible, isSubItemVisible } from '../src/config/navigation';
import { hasPermission } from '../src/utils/permissions';
import type { UserAccount } from '../src/types';

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

// 1) App.tsx calls applyUiPrefs with currentPage === 'pos' and shared displaySettings
const appSrc = read('src/App.tsx');
assert.ok(
  appSrc.includes("applyUiPrefs(uiPrefs, currentPage === 'pos'"),
  "App.tsx يجب أن يستدعي applyUiPrefs(uiPrefs, currentPage === 'pos', ...)"
);
assert.ok(
  appSrc.includes('config.displaySettings?.showItemImages') && appSrc.includes('config.displaySettings?.posLayout'),
  'App.tsx يجب أن يمرر showItemImages و posLayout من config.displaySettings إلى applyUiPrefs'
);
assert.ok(
  appSrc.includes('UI_PREFS_EVENT'),
  'App.tsx يجب أن يستمع لحدث UI_PREFS_EVENT'
);

// 2) index.css includes zoom: 1 inside @media print and rules for data-pos-frameless and data-pos-images
const cssSrc = read('src/index.css');
assert.ok(
  /@media\s+print[\s\S]*?zoom:\s*1\s*!important/.test(cssSrc),
  'index.css يجب أن يعيد zoom: 1 داخل @media print'
);
assert.ok(
  cssSrc.includes('[data-pos-images="off"]') && cssSrc.includes('.pos-card-image'),
  'index.css يجب أن يحتوي على قواعد إخفاء الصور [data-pos-images="off"]'
);
assert.ok(
  cssSrc.includes('[data-pos-frameless="on"]') && cssSrc.includes('.pos-surface'),
  'index.css يجب أن يحتوي على قواعد وضع بدون إطارات [data-pos-frameless="on"]'
);
assert.ok(
  !cssSrc.includes('100vh - 40px'),
  'index.css لا يجب أن يحتوي على 100vh غير مقسومة على var(--app-zoom, 1)'
);

// 3) Check that viewport units in all 11 components are divided by var(--app-zoom,1)
const viewportFiles = [
  'src/components/ui/ModalShell.tsx',
  'src/components/CameraBarcodeScannerModal.tsx',
  'src/components/PrintReceiptModal.tsx',
  'src/components/Sidebar.tsx',
  'src/components/MobileBottomNav.tsx',
  'src/App.tsx',
  'src/pages/LoginPage.tsx',
  'src/components/InitialAccountSetupModal.tsx',
  'src/pages/WarehouseTransferPage.tsx',
  'src/pages/POSPage.tsx',
  'src/pages/ProductFormPage.tsx',
];

for (const file of viewportFiles) {
  const content = read(file);
  assert.ok(
    !content.includes('min-h-screen') && !content.includes('h-screen') && !content.includes('max-h-screen'),
    `${file} لا يجب أن يحتوي على min-h-screen أو h-screen أو max-h-screen`
  );
  const rawViewportMatches = content.match(/\[\d+(?:vh|vw)\]/g);
  assert.equal(
    rawViewportMatches,
    null,
    `${file} لا يجب أن يحتوي على وحدات vh/vw خام بدون قسمة على var(--app-zoom,1)`
  );
}

// 4) Sidebar.tsx & ProductFormPage.tsx use toLayoutPx
const sidebarSrc = read('src/components/Sidebar.tsx');
assert.ok(
  sidebarSrc.includes('toLayoutPx('),
  'Sidebar.tsx يجب أن يستخدم toLayoutPx لتحويل قياسات الشاشة'
);

const productFormSrc = read('src/pages/ProductFormPage.tsx');
assert.ok(
  productFormSrc.includes('toLayoutPx('),
  'ProductFormPage.tsx يجب أن يستخدم toLayoutPx لتحويل قياسات الشاشة'
);
assert.ok(
  productFormSrc.includes('scrollIntoView'),
  'ProductFormPage.tsx يجب أن يستخدم scrollIntoView للتنقل بين الأقسام'
);

// 5) POSPage.tsx uses var(--pos-panel-w) and includes quick button "شكل الشاشة" guarded by settings.ui_scale with live preview + Save/Cancel + shared section
const posPageSrc = read('src/pages/POSPage.tsx');
assert.ok(
  posPageSrc.includes('lg:w-[var(--pos-panel-w)]'),
  'POSPage.tsx يجب أن يستخدم lg:w-[var(--pos-panel-w)] لعرض لوحة الفاتورة'
);
assert.ok(
  posPageSrc.includes('lg:flex-1'),
  'POSPage.tsx يجب أن يستخدم lg:flex-1 لعمود الأصناف'
);
assert.ok(
  posPageSrc.includes("hasPermission(user, 'settings.ui_scale')"),
  'POSPage.tsx يجب أن يتحقق من صلاحية settings.ui_scale لزر شكل الشاشة'
);
assert.ok(
  posPageSrc.includes("hasPermission(user, 'settings.display_customization')") && posPageSrc.includes('على النسخة كلها'),
  'POSPage.tsx يجب أن يعرض قسم «على النسخة كلها» لمن يملك صلاحية settings.display_customization'
);
assert.ok(
  posPageSrc.includes('pos-ui-appearance-btn') && posPageSrc.includes('pos-ui-appearance-popover'),
  'POSPage.tsx يجب أن يحتوي على زر ونافذة شكل الشاشة السريعة'
);
assert.ok(
  posPageSrc.includes('handleSavePosUiPrefs') && posPageSrc.includes('handleCancelPosUiPrefs'),
  'POSPage.tsx يجب أن يدعم الحفظ والإلغاء مع المعاينة المباشرة في نافذة شكل الشاشة'
);

// 6) PosProductGrid.tsx uses CSS variables for card width, image height, category height and font, and guards view toggle by canCustomizeDisplay
const posGridSrc = read('src/components/pos/PosProductGrid.tsx');
assert.ok(
  posGridSrc.includes('var(--pos-card-w)'),
  'PosProductGrid.tsx يجب أن يستخدم var(--pos-card-w)'
);
assert.ok(
  posGridSrc.includes('var(--pos-card-img-h)'),
  'PosProductGrid.tsx يجب أن يستخدم var(--pos-card-img-h)'
);
assert.ok(
  posGridSrc.includes('var(--pos-cat-h)') && posGridSrc.includes('var(--pos-cat-font)'),
  'PosProductGrid.tsx يجب أن يستخدم var(--pos-cat-h) و var(--pos-cat-font)'
);
assert.ok(
  posGridSrc.includes('pos-card-image') && posGridSrc.includes('pos-card-stock-no-img'),
  'PosProductGrid.tsx يجب أن يحتوي على أصناف pos-card-image و pos-card-stock-no-img'
);
assert.ok(
  posGridSrc.includes('{canCustomizeDisplay && ('),
  'PosProductGrid.tsx يجب أن يظهر زر التبديل بين الكروت والقائمة فقط لمن يملك صلاحية settings.display_customization'
);

// 7) SettingsPage.tsx contains "حجم وشكل الواجهة" guarded by settings.ui_scale with live preview + Save button
const settingsSrc = read('src/pages/SettingsPage.tsx');
assert.ok(
  settingsSrc.includes("hasPermission(currentUser, 'settings.ui_scale')"),
  'SettingsPage.tsx يجب أن يتحقق من صلاحية settings.ui_scale'
);
assert.ok(
  settingsSrc.includes('id="settings-ui-scale-section"') && settingsSrc.includes('handleSaveUiPrefs'),
  'SettingsPage.tsx يجب أن يحتوي على قسم settings-ui-scale-section وزر حفظ'
);

// 8) Navigation visibility check for owner, authorized employee, and unauthorized cashier
const ownerUser: UserAccount = {
  id: 'u-owner',
  username: 'owner',
  name: 'المالك',
  role: 'designer',
  status: 'active',
  isOwner: true,
  permissions: [],
};

const authorizedEmployee: UserAccount = {
  id: 'u-emp-scale',
  username: 'emp1',
  name: 'موظف مفوض',
  role: 'cashier',
  status: 'active',
  permissions: ['settings.ui_scale'],
};

const regularCashier: UserAccount = {
  id: 'u-cashier',
  username: 'cashier1',
  name: 'كاشير عادي',
  role: 'cashier',
  status: 'active',
  permissions: ['invoices.create'],
};

assert.equal(hasPermission(ownerUser, 'settings.ui_scale'), true, 'المالك يملك صلاحية settings.ui_scale تلقائيًا');
assert.equal(hasPermission(authorizedEmployee, 'settings.ui_scale'), true, 'الموظف المفوض يملك صلاحية settings.ui_scale');
assert.equal(hasPermission(regularCashier, 'settings.ui_scale'), false, 'الكاشير العادي لا يملك صلاحية settings.ui_scale');

const settingsGroup = NAV_GROUPS.find((g) => g.id === 'settings')!;
const uiScaleItem = settingsGroup.subItems.find((i) => i.id === 'settings-appearance')!;

assert.ok(uiScaleItem, 'عنصر settings-appearance موجود في مجموعة الإعدادات');
assert.equal(isGroupVisible(settingsGroup, ownerUser) && isSubItemVisible(uiScaleItem, ownerUser), true, 'عنصر المظهر والحجم يظهر للمالك في القائمة');
assert.equal(isGroupVisible(settingsGroup, authorizedEmployee) && isSubItemVisible(uiScaleItem, authorizedEmployee), true, 'عنصر المظهر والحجم يظهر للموظف المفوض بصلاحية settings.ui_scale');
assert.equal(isSubItemVisible(uiScaleItem, regularCashier), false, 'عنصر المظهر والحجم لا يظهر للكاشير بدون صلاحية settings.ui_scale');

console.log('🎉 كل اختبارات ربط واجهة حجم وشكل الواجهة نجحت.');

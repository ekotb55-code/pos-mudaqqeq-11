import fs from 'node:fs';
import path from 'node:path';
import {
  NAV_GROUPS,
  isSubItemVisible,
  isGroupVisible,
  isVisitorScreenOnlyUser,
  normalizeNavigationTarget,
  resolvePathToTarget
} from '../src/config/navigation';
import {
  normalizeVisitorBarcode,
  formatVisitorPrice,
  VISITOR_CATALOG_STORAGE_KEY
} from '../src/pages/VisitorDisplayPage';
import { UserAccount } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`❌ FAIL: ${message}`);
  }
}

function makeUser(overrides: Partial<UserAccount> & { permissions?: string[] }): UserAccount {
  return {
    id: overrides.id || 'u-test',
    name: overrides.name || 'مستخدم اختبار',
    username: overrides.username || 'testuser',
    phone: overrides.phone || '01000000000',
    role: overrides.role || 'employee',
    isOwner: Boolean(overrides.isOwner),
    status: overrides.status || 'active',
    permissions: (overrides.permissions || []) as any,
    createdAt: '2026-01-01T00:00:00.000Z'
  };
}

// 1. Navigation & RBAC for /visitor and /settings/visitor
const salesGroup = NAV_GROUPS.find((g) => g.id === 'sales');
const settingsGroup = NAV_GROUPS.find((g) => g.id === 'settings');
assert(Boolean(salesGroup), 'Sales group exists in NAV_GROUPS');
assert(Boolean(settingsGroup), 'Settings group exists in NAV_GROUPS');

const salesVisitorSub = salesGroup?.subItems.find((s) => s.id === 'sales-visitor-display');
assert(Boolean(salesVisitorSub), 'sales-visitor-display sub-item exists under sales group');
assert(salesVisitorSub?.page === 'visitor' && salesVisitorSub?.path === '/visitor', 'sales-visitor-display points to page=visitor, path=/visitor');
assert(salesVisitorSub?.labelAr === 'شاشة الزوار', 'sales-visitor-display labelAr is شاشة الزوار');

const settingsSubIds = settingsGroup?.subItems.map((s) => s.id) || [];
const salesIdx = settingsSubIds.indexOf('settings-sales');
const visitorIdx = settingsSubIds.indexOf('settings-visitor');
assert(salesIdx >= 0 && visitorIdx === salesIdx + 1, 'settings-visitor is placed immediately after settings-sales in settings group');

const settingsVisitorSub = settingsGroup?.subItems[visitorIdx];
assert(
  settingsVisitorSub?.page === 'settings' &&
    settingsVisitorSub?.tab === 'visitor' &&
    settingsVisitorSub?.path === '/settings/visitor' &&
    settingsVisitorSub?.labelAr === 'شاشة الزوار',
  'settings-visitor has page=settings, tab=visitor, path=/settings/visitor, labelAr=شاشة الزوار'
);

// Permission checks for settings-visitor & sales-visitor-display
const screenOnlyUser = makeUser({ permissions: ['visitor.display'] });
const visitorSettingsUser = makeUser({ permissions: ['settings.visitor_display'] });
const cashierUser = makeUser({ permissions: ['invoices.create'] });
const ownerUser = makeUser({ role: 'owner', isOwner: true, permissions: [] });

assert(isSubItemVisible(salesVisitorSub!, screenOnlyUser), 'sales-visitor-display visible to user with visitor.display');
assert(isSubItemVisible(salesVisitorSub!, visitorSettingsUser), 'sales-visitor-display visible to user with settings.visitor_display');
assert(!isSubItemVisible(salesVisitorSub!, cashierUser), 'sales-visitor-display hidden from user without visitor permissions');
assert(isSubItemVisible(salesVisitorSub!, ownerUser), 'sales-visitor-display visible to owner');

assert(!isSubItemVisible(settingsVisitorSub!, screenOnlyUser), 'settings-visitor hidden from screen-only user (visitor.display only)');
assert(isSubItemVisible(settingsVisitorSub!, visitorSettingsUser), 'settings-visitor visible to user with settings.visitor_display');
assert(isGroupVisible(settingsGroup!, visitorSettingsUser), 'settings group is visible to user with only settings.visitor_display');

// 2. Screen-only account detection & forced redirect to /visitor
assert(isVisitorScreenOnlyUser(screenOnlyUser) === true, 'User with only visitor.display is detected as screen-only account');
assert(isVisitorScreenOnlyUser(visitorSettingsUser) === false, 'User with settings.visitor_display is NOT a screen-only account');
assert(
  isVisitorScreenOnlyUser(makeUser({ permissions: ['visitor.display', 'invoices.create'] })) === false,
  'User with visitor.display + invoices.create is NOT a screen-only account'
);
assert(isVisitorScreenOnlyUser(ownerUser) === false, 'Owner is NOT a screen-only account');

// Screen-only user redirects from any path to /visitor
for (const testPath of ['/', '/dashboard', '/pos', '/items', '/settings/visitor', '/unknown']) {
  const resolved = resolvePathToTarget(testPath, screenOnlyUser);
  assert(
    resolved.page === 'visitor' && resolved.path === '/visitor',
    `Screen-only user navigating to ${testPath} resolves to /visitor (got ${resolved.path})`
  );
  assert(
    resolved.redirected === (testPath !== '/visitor'),
    `Screen-only user redirected flag for ${testPath} is ${testPath !== '/visitor'}`
  );
}
const normForScreenOnly = normalizeNavigationTarget('dashboard', undefined, screenOnlyUser);
assert(
  normForScreenOnly.page === 'visitor' && normForScreenOnly.path === '/visitor',
  'normalizeNavigationTarget("dashboard") for screen-only user returns /visitor'
);

// Non-screen-only user resolves /visitor and /settings/visitor properly
const resolvedVisitorForOwner = resolvePathToTarget('/visitor', ownerUser);
assert(
  resolvedVisitorForOwner.page === 'visitor' &&
    resolvedVisitorForOwner.path === '/visitor' &&
    resolvedVisitorForOwner.redirected === false,
  'Owner resolving /visitor gets page=visitor without redirect'
);
const resolvedSettingsVisitor = resolvePathToTarget('/settings/visitor', visitorSettingsUser);
assert(
  resolvedSettingsVisitor.page === 'settings' &&
    resolvedSettingsVisitor.tab === 'visitor' &&
    resolvedSettingsVisitor.path === '/settings/visitor' &&
    resolvedSettingsVisitor.redirected === false,
  'User with settings.visitor_display resolving /settings/visitor gets page=settings, tab=visitor'
);

// 3. Barcode normalization & price formatting helpers
assert(normalizeVisitorBarcode('  6221234 567890 \n') === '6221234567890', 'normalizeVisitorBarcode trims and removes spaces');
assert(normalizeVisitorBarcode('sku-ab 12') === 'SKU-AB12', 'normalizeVisitorBarcode uppercases alphanumeric barcodes');
assert(formatVisitorPrice(10) === '10.00', 'formatVisitorPrice formats integer with 2 decimals (10.00)');
assert(formatVisitorPrice(1250.5) === '1,250.50', 'formatVisitorPrice formats 1250.5 as 1,250.50');
assert(VISITOR_CATALOG_STORAGE_KEY === 'mudaqqeq_visitor_catalog_v1', 'Offline visitor catalog localStorage key is defined');

// 4. Static code verification of API client, ProductFormPage, SettingsPage, App.tsx, Sidebar.tsx, and VisitorDisplayPage.tsx
const clientSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/api/client.ts'), 'utf8');
assert(
  clientSrc.includes("folder?: 'items' | 'print' | 'company' | 'visitor' | 'misc'"),
  'api.uploadImage accepts optional folder parameter'
);
for (const methodName of [
  'getImagesStatus',
  'migrateImages',
  'getVisitorConfig',
  'visitorLookup',
  'getVisitorCatalog',
  'saveVisitorSettings',
  'addVisitorSlide',
  'deleteVisitorSlide',
  'orderVisitorSlides'
]) {
  assert(clientSrc.includes(`async ${methodName}(`), `api/client.ts defines ${methodName}`);
}

const productFormSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/ProductFormPage.tsx'), 'utf8');
assert(
  productFormSrc.includes("folder: 'items'"),
  'ProductFormPage passes folder: "items" to api.uploadImage'
);

const settingsSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/SettingsPage.tsx'), 'utf8');
assert(
  settingsSrc.includes("folder: 'print'"),
  'SettingsPage passes folder: "print" to api.uploadImage for receipt header image'
);
assert(
  settingsSrc.includes('تخزين الصور يعمل بعد ربط قاعدة البيانات'),
  'SettingsPage shows storage disabled message when database is not connected'
);
assert(
  settingsSrc.includes('كل الصور مرفوعة على السيرفر'),
  'SettingsPage shows all images uploaded message when inline.total === 0'
);
assert(
  settingsSrc.includes('صورة محفوظة داخل البيانات (تبطّئ البرنامج)') &&
    settingsSrc.includes('نقل الصور للسيرفر'),
  'SettingsPage shows inline images count and migration button when inline.total > 0'
);
assert(
  settingsSrc.includes('أضف رابط الشعار من صفحة بيانات المنشأة'),
  'SettingsPage visitor tab shows note when company logoUrl is empty'
);
assert(
  settingsSrc.includes('لتشغيل الشاشة على جهاز: أنشئ مستخدمًا من صفحة المستخدمين وأعطه صلاحية «شاشة الزوار» فقط، وادخل به على الجهاز'),
  'SettingsPage visitor tab includes device setup instruction text'
);

const visitorPageSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/VisitorDisplayPage.tsx'), 'utf8');
assert(
  visitorPageSrc.includes('الصنف غير موجود — اسأل الكاشير'),
  'VisitorDisplayPage includes not-found message: الصنف غير موجود — اسأل الكاشير'
);
assert(
  visitorPageSrc.includes('امسح باركود المنتج لمعرفة السعر'),
  'VisitorDisplayPage includes empty slides message: امسح باركود المنتج لمعرفة السعر'
);
assert(
  visitorPageSrc.includes('تعذر الوصول للأسعار الآن'),
  'VisitorDisplayPage includes offline no-catalog message: تعذر الوصول للأسعار الآن'
);
assert(
  visitorPageSrc.includes('CameraBarcodeScannerModal'),
  'VisitorDisplayPage integrates CameraBarcodeScannerModal for mobile camera scanning'
);
assert(
  visitorPageSrc.includes('3000') && visitorPageSrc.includes('visitor-exit-password-modal'),
  'VisitorDisplayPage supports 3-second long press password modal for screen-only account logout'
);

const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
assert(
  appSrc.includes("currentPage === 'visitor' || isScreenOnlyUser") &&
    appSrc.includes('<VisitorDisplayPage'),
  'App.tsx renders VisitorDisplayPage full-screen outside Navbar/Sidebar/MobileBottomNav shell'
);

const sidebarSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Sidebar.tsx'), 'utf8');
assert(
  sidebarSrc.includes('href="/visitor"') && sidebarSrc.includes('target="_blank"'),
  'Sidebar renders شاشة الزوار link opening /visitor in a new tab'
);

if (failed > 0) {
  console.error(`\n❌ Visitor Display UI verification failed (${failed} failed, ${passed} passed).`);
  process.exit(1);
} else {
  console.log(`✅ Visitor Display UI verification passed (${passed} assertions).`);
}

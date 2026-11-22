/**
 * اختبارات واجهة «قاعدة البيانات» و«النسخ الاحتياطي» وشاشة تهيئة الدخول وإزالة Google Sheets من الواجهة
 */
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import {
  ALL_NAV_SUB_ITEMS,
  NAV_GROUPS,
  isSubItemVisible,
  isGroupVisible,
  normalizeNavigationTarget,
  resolvePathToTarget,
} from '../src/config/navigation.ts';

const root = process.cwd();

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function getAllFiles(dirPath: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

let assertions = 0;
function check(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  assertions += 1;
}

console.log('1) التحقق من خلو src/pages و src/components و .env.example من Google Sheets / جوجل شيت / Apps Script...');
const uiDirs = [path.join(root, 'src', 'pages'), path.join(root, 'src', 'components')];
const forbiddenPatterns = [
  { label: 'Google Sheets', regex: /Google\s*Sheets/i },
  { label: 'جوجل شيت', regex: /جوجل\s*شيت/ },
  { label: 'Apps Script', regex: /Apps\s*Script/i },
  { label: 'ربط الشيت', regex: /ربط\s*الشيت/ },
];

for (const dir of uiDirs) {
  for (const file of getAllFiles(dir)) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);
    for (const pat of forbiddenPatterns) {
      check(!pat.regex.test(content), `الملف ${rel} ما زال يحتوي على "${pat.label}"`);
    }
  }
}

const envExample = readFile('.env.example');
check(!envExample.includes('APPS_SCRIPT_URL'), '.env.example يجب ألا يحتوي على APPS_SCRIPT_URL');
check(envExample.includes('SUPABASE_URL='), '.env.example يجب أن يحتوي على SUPABASE_URL');
check(envExample.includes('SUPABASE_SECRET_KEY='), '.env.example يجب أن يحتوي على SUPABASE_SECRET_KEY');

console.log('2) التحقق من دوال src/api/client.ts الخاصة بقاعدة البيانات والنسخ الاحتياطي...');
const apiClient = readFile('src/api/client.ts');
check(apiClient.includes('getDatabasePublicStatus'), 'وجود getDatabasePublicStatus في client.ts');
check(apiClient.includes('/api/database/public-status'), 'مسار /api/database/public-status في client.ts');
check(apiClient.includes('getDatabaseSetupSql'), 'وجود getDatabaseSetupSql في client.ts');
check(apiClient.includes('/api/database/setup-sql'), 'مسار /api/database/setup-sql في client.ts');
check(apiClient.includes('getDatabaseStatus'), 'وجود getDatabaseStatus في client.ts');
check(apiClient.includes('/api/database/status'), 'مسار /api/database/status في client.ts');
check(apiClient.includes('checkDatabase'), 'وجود checkDatabase في client.ts');
check(apiClient.includes('/api/database/check'), 'مسار /api/database/check في client.ts');
check(apiClient.includes('getBackupStatus'), 'وجود getBackupStatus في client.ts');
check(apiClient.includes('/api/backup/status'), 'مسار /api/backup/status في client.ts');
check(apiClient.includes('exportBackup'), 'وجود exportBackup في client.ts');
check(apiClient.includes('/api/backup/export'), 'مسار /api/backup/export في client.ts');
check(apiClient.includes('X-Backup-File-Name'), 'قراءة اسم ملف النسخة الاحتياطية من الهيدر X-Backup-File-Name');
check(apiClient.includes('inspectBackup'), 'وجود inspectBackup في client.ts');
check(apiClient.includes('/api/backup/inspect'), 'مسار /api/backup/inspect في client.ts');
check(apiClient.includes('restoreBackup'), 'وجود restoreBackup في client.ts');
check(apiClient.includes('/api/backup/restore'), 'مسار /api/backup/restore في client.ts');
check(!/Google\s+Sheets/i.test(apiClient), 'خلو رسائل client.ts من Google Sheets');

console.log('3) التحقق من قسمي «قاعدة البيانات» و«النسخ الاحتياطي» في src/pages/SettingsPage.tsx...');
const settingsPage = readFile('src/pages/SettingsPage.tsx');
check(settingsPage.includes("hasPermission(currentUser, 'settings.system_integration')"), 'حماية قسم قاعدة البيانات بصلاحية settings.system_integration');
check(settingsPage.includes("hasPermission(currentUser, 'settings.backup')"), 'حماية قسم النسخ الاحتياطي بصلاحية settings.backup');
check(settingsPage.includes('فحص الاتصال والتهيئة'), 'زر فحص الاتصال والتهيئة في قسم قاعدة البيانات');
check(settingsPage.includes('نسخ كود التهيئة'), 'زر نسخ كود التهيئة في قسم قاعدة البيانات');
check(settingsPage.includes('تم النسخ'), 'إشعار تم النسخ بعد نسخ كود التهيئة');
check(settingsPage.includes('فتح SQL Editor'), 'زر فتح SQL Editor');
check(settingsPage.includes('تجهيز سيرفر أو عميل جديد'), 'عنوان خطوات تجهيز سيرفر أو عميل جديد');
check(settingsPage.includes('وضع المعاينة — لم يتم ربط قاعدة بيانات بعد'), 'تحذير وضع المعاينة عند persistenceMode === none');
check(settingsPage.includes('تنزيل نسخة احتياطية الآن'), 'زر تنزيل نسخة احتياطية الآن');
check(settingsPage.includes('استرجاع نسخة احتياطية'), 'قسم استرجاع نسخة احتياطية');
check(settingsPage.includes('11 * 1024 * 1024'), 'التحقق من حد حجم ملف النسخة الاحتياطية 11 ميجابايت');
check(settingsPage.includes('هذه النسخة من شركة أخرى'), 'تحذير اختلاف العميل tenantMismatch');
check(settingsPage.includes('الاسترجاع يستبدل كل بيانات الشركة الحالية بمحتوى الملف ولا يمكن التراجع عنه. كلمات السر ترجع كما كانت وقت النسخة، وكل المستخدمين سيسجلون الدخول من جديد.'), 'مربع التحذير الأحمر قبل الاسترجاع');
check(settingsPage.includes('استرجاع الآن'), 'زر استرجاع الآن');
check(settingsPage.includes('تم استرجاع النسخة. سجّل الدخول من جديد'), 'رسالة نجاح الاسترجاع قبل تسجيل الخروج');
check(!settingsPage.includes('SUPABASE_SECRET_KEY='), 'عدم عرض قيمة المفتاح السري في SettingsPage');

console.log('4) التحقق من تنبيه النسخ الاحتياطي في src/pages/DashboardPage.tsx...');
const dashboardPage = readFile('src/pages/DashboardPage.tsx');
check(dashboardPage.includes('مرّ أكثر من 7 أيام على آخر نسخة احتياطية'), 'تنبيه مرور أكثر من 7 أيام على آخر نسخة احتياطية في لوحة التحكم');
check(dashboardPage.includes("hasPermission(user, 'settings.backup')"), 'ربط تنبيه لوحة التحكم بصلاحية settings.backup');
check(dashboardPage.includes("config.persistenceMode === 'supabase'"), 'ربط تنبيه لوحة التحكم بكون persistenceMode === supabase');

console.log('5) التحقق من لوحة «قاعدة البيانات غير جاهزة» في src/pages/LoginPage.tsx...');
const loginPage = readFile('src/pages/LoginPage.tsx');
check(loginPage.includes('قاعدة البيانات غير جاهزة'), 'عنوان لوحة تهيئة قاعدة البيانات في شاشة الدخول');
check(loginPage.includes('getDatabasePublicStatus'), 'استدعاء getDatabasePublicStatus عند فتح شاشة الدخول');
check(loginPage.includes('10_000'), 'إعادة الفحص التلقائي كل 10 ثوانٍ طالما needsSetup === true');
check(loginPage.includes('نسخ كود التهيئة'), 'زر نسخ كود التهيئة في شاشة الدخول');
check(loginPage.includes('فتح SQL Editor'), 'زر فتح SQL Editor في شاشة الدخول');
check(loginPage.includes('إعادة الفحص'), 'زر إعادة الفحص في شاشة الدخول');

console.log('6) التحقق من القائمة الجانبية الموحدة وشريط الحالة العلوي والمسار القديم...');
const navConfig = readFile('src/config/navigation.ts');
check(navConfig.includes("labelAr: 'قاعدة البيانات والنسخ الاحتياطي'"), 'تسمية العنصر الموحد «قاعدة البيانات والنسخ الاحتياطي» في القائمة الجانبية');
check(!navConfig.includes("id: 'settings-backup'"), 'عدم وجود عنصر مستقل مكرر للنسخ الاحتياطي في القائمة الجانبية');
check(
  settingsPage.includes('id="settings-backup-section"') && settingsPage.includes("window.location.hash === '#backup'"),
  'دعم النزول المباشر إلى قسم النسخ الاحتياطي عبر #backup'
);
check(
  settingsPage.includes("activeTab === 'integration' && canManageIntegration"),
  'عدم إظهار فاصل علوي أو قسم قاعدة البيانات لمن معه settings.backup فقط'
);
check(
  dashboardPage.includes("onNavigate('settings', 'backup')"),
  'زر التنبيه في لوحة التحكم ينقل إلى قسم النسخ الاحتياطي'
);

const settingsGroup = NAV_GROUPS.find((g) => g.id === 'settings')!;
const mergedItem = ALL_NAV_SUB_ITEMS.find((s) => s.id === 'settings-integration')!;

const userBackupOnly: any = {
  id: 'u-backup',
  username: 'backup_only',
  name: 'مستخدم نسخ احتياطي فقط',
  role: 'employee',
  status: 'active',
  permissions: ['settings.backup'],
};
const userIntegrationOnly: any = {
  id: 'u-int',
  username: 'int_only',
  name: 'مستخدم قاعدة بيانات فقط',
  role: 'employee',
  status: 'active',
  permissions: ['settings.system_integration'],
};
const userBoth: any = {
  id: 'u-both',
  username: 'both_perms',
  name: 'مستخدم بالاثنتين',
  role: 'employee',
  status: 'active',
  permissions: ['settings.system_integration', 'settings.backup'],
};
const userNone: any = {
  id: 'u-none',
  username: 'no_perms',
  name: 'مستخدم بلا صلاحيات إعدادات',
  role: 'employee',
  status: 'active',
  permissions: ['items.view'],
};

check(isSubItemVisible(mergedItem, userBackupOnly) && isGroupVisible(settingsGroup, userBackupOnly), 'ظهور العنصر لمن معه settings.backup فقط');
check(isSubItemVisible(mergedItem, userIntegrationOnly) && isGroupVisible(settingsGroup, userIntegrationOnly), 'ظهور العنصر لمن معه settings.system_integration فقط');
check(isSubItemVisible(mergedItem, userBoth) && isGroupVisible(settingsGroup, userBoth), 'ظهور العنصر لمن معه الصلاحيتان');
check(!isSubItemVisible(mergedItem, userNone), 'إخفاء العنصر لمن لا يملك أياً من الصلاحيتين');

const resolvedOldBackupRoute = resolvePathToTarget('/settings/backup', userBackupOnly);
check(
  resolvedOldBackupRoute.page === 'settings' &&
    resolvedOldBackupRoute.tab === 'integration' &&
    resolvedOldBackupRoute.path === '/settings/integration#backup' &&
    resolvedOldBackupRoute.redirected === true,
  `تحويل المسار القديم /settings/backup إلى /settings/integration#backup (المستلم: ${JSON.stringify(resolvedOldBackupRoute)})`
);

const normalizedDashboardBackupNav = normalizeNavigationTarget('settings', 'backup', userBackupOnly);
check(
  normalizedDashboardBackupNav.page === 'settings' &&
    normalizedDashboardBackupNav.tab === 'integration' &&
    normalizedDashboardBackupNav.path === '/settings/integration#backup',
  `توجيه زر لوحة التحكم إلى /settings/integration#backup (المستلم: ${JSON.stringify(normalizedDashboardBackupNav)})`
);

const navbar = readFile('src/components/Navbar.tsx');
check(navbar.includes('قاعدة البيانات متصلة — كل العمليات محفوظة'), 'تلميح اتصال قاعدة البيانات في شريط الحالة');
check(navbar.includes('وضع المعاينة — البيانات لا تُحفظ'), 'تلميح وضع المعاينة في شريط الحالة');

console.log(`نجحت جميع فحوصات واجهة قاعدة البيانات والنسخ الاحتياطي (${assertions} تحققًا).`);

/**
 * اختبار واجهة «إعدادات البيع وقواعد السعر» (فحص نصي للملفات بدون تشغيل المتصفح)
 * التشغيل: npx tsx scripts/verify_sales_rules_ui.ts
 */
import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`✅ ${name}`);
  } else {
    failed++;
    console.error(`❌ ${name}`);
  }
}

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const types = read('src/types/index.ts');
const perms = read('src/utils/permissions.ts');
const nav = read('src/config/navigation.ts');
const client = read('src/api/client.ts');
const settings = read('src/pages/SettingsPage.tsx');
const pos = read('src/pages/POSPage.tsx');
const panel = read('src/components/pos/PosInvoicePanel.tsx');

// ---- الأنواع والصلاحيات ----
check('الصلاحية settings.sales_rules في PermissionKey', types.includes("| 'settings.sales_rules'"));
const salesRulesType = types.slice(types.indexOf('export interface SalesRules'), types.indexOf('}', types.indexOf('export interface SalesRules')));
check(
  'النوع SalesRules بنفس أسماء حقول السيرفر',
  ['defaultSaleMode', 'platformSelection', 'defaultPlatformId', 'customerSelection', 'defaultCustomerId', 'allowZeroPriceSale', 'allowBelowCostSale', 'effectivePlatformSelection', 'effectiveCustomerSelection', 'defaultPlatformMissing', 'defaultCustomerMissing'].every(f => salesRulesType.includes(`${f}:`) || salesRulesType.includes(`${f}?:`))
);
check('لا أسماء حقول قديمة (defaultPlatformSelection / defaultCustomerSelection)', ![types, settings, pos, panel].some(t => /defaultPlatformSelection|defaultCustomerSelection/.test(t)));
check('الصلاحية معرفة في ALL_PERMISSIONS', perms.includes("key: 'settings.sales_rules'"));
const templates = perms.slice(perms.indexOf('ROLE_TEMPLATES'));
check('الصلاحية ليست في قالب المدير ولا الموظف (المالك يملكها تلقائيًا)', !templates.includes("'settings.sales_rules'"));

// ---- القائمة ----
check('مجموعة الإعدادات تظهر لمن معه settings.sales_rules', nav.includes("hasPermission(user, 'settings.sales_rules')"));

// ---- دوال الاتصال ----
const getFn = client.slice(client.indexOf('async getSalesRules('), client.indexOf('async getSalesRules(') + 200);
const saveFn = client.slice(client.indexOf('async saveSalesRules('), client.indexOf('async saveSalesRules(') + 400);
check('getSalesRules ← GET /api/settings/sales-rules', getFn.includes("'/api/settings/sales-rules'"));
check('saveSalesRules ← POST /api/settings/sales-rules', saveFn.includes("'/api/settings/sales-rules'") && saveFn.includes("method: 'POST'"));

// ---- صفحة الإعدادات ----
check('قسم «إعدادات البيع وقواعد السعر» بصلاحية settings.sales_rules', settings.includes('إعدادات البيع وقواعد السعر') && settings.includes("hasPermission(currentUser, 'settings.sales_rules')") && settings.includes('{canManageSalesRules && ('));
check('خيارات وضع البيع الثلاثة', ['آخر وضع استخدمه المستخدم', "label: 'بيع مباشر'", "label: 'بيع منصات'"].every(t => settings.includes(t)));
check('خيارات المنصة الثلاثة', ['أول منصة نشطة', 'منصة محددة', "id: 'manual', label: 'لازم يختار بإيده'"].every(t => settings.includes(t)));
check('خيارات العميل الثلاثة', ["label: 'بدون عميل'", 'عميل محدد'].every(t => settings.includes(t)) && (settings.match(/label: 'لازم يختار بإيده'/g) || []).length === 2);
check('قائمة المنصات بدون «البيع المباشر»', settings.includes("p.name !== 'البيع المباشر'"));
check('بحث في العملاء للعميل المحدد', settings.includes('بحث عن عميل بالاسم أو الهاتف'));
check('قوائم المنصات والعملاء من شكل رد السيرفر الصحيح', settings.includes('setSalesRulesPlatforms(res.platforms)') && settings.includes('setSalesRulesCustomers(res.customers)'));
check('تنبيه المنصة المحذوفة', settings.includes('defaultPlatformMissing') && settings.includes('المنصة المحددة حُذفت أو أُوقفت'));
check('تنبيه العميل المحذوف', settings.includes('defaultCustomerMissing') && settings.includes('العميل المحدد حُذف أو أُوقف'));
check('المفتاحان', settings.includes('السماح بالبيع بسعر صفر') && settings.includes('السماح بالبيع بأقل من سعر الشراء'));
check('نص التوضيح الثابت', settings.includes('عند المنع: البيع المخالف يُرفض، ما عدا من معه صلاحية «تجاوز الحد الأدنى للسعر»') && settings.includes('المقارنة على سعر القطعة بعد الخصم'));
check('الحفظ عبر api.saveSalesRules وسطر «آخر تعديل»', settings.includes('api.saveSalesRules') && settings.includes('آخر تعديل:'));
check('لا يظهر اسم الصلاحية التقني في الواجهة', !/>\s*settings\.sales_rules\s*</.test(settings));
check('افتراضي الصفحة = افتراضي السيرفر (مسموح)', /allowZeroPriceSale: true,\s*allowBelowCostSale: true/.test(settings));

// ---- شاشة البيع ----
check('جلب الإعدادات عند الفتح', pos.includes('api.getSalesRules()'));
check('نسخة محلية للعمل أوفلاين', pos.includes("'mudaqqeq_sales_rules_cache_v1'") && pos.includes('writeCachedSalesRules('));
check('بدون نسخة محلية: نفس سلوك السيرفر الافتراضي', /allowZeroPriceSale: true,\s*allowBelowCostSale: true/.test(pos));
check('وضع البيع: last ← آخر وضع، direct/platform ← الوضع المحدد', pos.includes("rules.defaultSaleMode === 'direct'") && pos.includes("rules.defaultSaleMode === 'platform'") && pos.includes('readLastPosSaleMode(storageKey)'));
check('المسودة المحفوظة لها الأولوية على الافتراضيات', pos.includes('if (!isDraftReady || pendingDraftPrompt || cart.length > 0) return;'));
check('بعد حفظ الفاتورة: المنصة والعميل يرجعوا للافتراضي', pos.includes('setSelectedPlatformId(nextDefaultPlatformId)') && pos.includes('setSelectedCustomerId(nextDefaultCustomerId)'));
check('منع الإرسال برسالة «اختر المنصة أولًا»', pos.includes("setErrorMsg('اختر المنصة أولًا')") && pos.includes('setPlatformFieldError(true)'));
check('منع الإرسال برسالة «اختر العميل أولًا»', pos.includes("setErrorMsg('اختر العميل أولًا')") && pos.includes('setCustomerFieldError(true)'));
check('تنبيه السعر صفر', pos.includes('» صفر — إعدادات البيع تمنع ذلك'));
check('تنبيه أقل من الشراء فقط لمن يرى سعر الشراء', pos.includes('(canViewCosts || canViewProfit)') && pos.includes('أقل من سعر الشراء ('));
check('من معه تجاوز الحد الأدنى لا يُنبَّه', pos.includes('if (!canOverrideMinPrice) {'));
check('لوحة الفاتورة: «اختر المنصة» / «اختر العميل» في وضع manual', panel.includes('اختر المنصة') && panel.includes("customerSelectionMode === 'manual' ? 'اختر العميل' : 'الجمهور'"));
check('لوحة الفاتورة: الخانة والسطر المخالف بالأحمر', panel.includes('aria-invalid={platformFieldError}') && panel.includes('aria-invalid={customerFieldError}') && panel.includes('data-price-violation'));

console.log(`\nالنتيجة: نجح ${passed} — فشل ${failed}`);
if (failed > 0) process.exit(1);
console.log(`🎉 كل اختبارات واجهة إعدادات البيع وقواعد السعر نجحت (${passed} تحققًا).`);
/**
 * اختبار إعدادات البيع وقواعد السعر (server/salesRules.ts)
 * التشغيل: npx tsx scripts/verify_sales_rules.ts
 */
import {
  defaultSalesRules,
  getSalesRules,
  saveSalesRules,
  describeSalesRules,
  priceRuleViolation,
  partyRuleViolation,
  getSalesRulesCollection,
  resetSalesRules,
  SalesRulesError
} from '../server/salesRules.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}
const arabic = /[\u0600-\u06FF]/;
function expectError(fn: () => unknown, label: string) {
  let caught: any = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof SalesRulesError && caught.code === 'INVALID_INPUT' && arabic.test(caught.message), label);
}

const platforms: any[] = [
  { id: 'plt-direct', name: 'البيع المباشر', status: 'نشطة' },
  { id: 'plt-noon', name: 'نون', status: 'نشطة' },
  { id: 'plt-old', name: 'منصة قديمة', status: 'موقوفة' }
];
const customers: any[] = [
  { id: 'cus-1', name: 'عميل نقدي', status: 'active' },
  { id: 'cus-2', name: 'عميل موقوف', status: 'inactive' }
];
const context = () => ({ platforms, customers, by: 'صاحب المحل', now: new Date('2026-11-19T10:00:00.000Z') });

// ---- الافتراضي = سلوك البرنامج الحالي ----
resetSalesRules();
let rules = getSalesRules();
assert(JSON.stringify(rules) === JSON.stringify(defaultSalesRules()), 'القيم الافتراضية');
assert(rules.defaultSaleMode === 'last' && rules.platformSelection === 'first' && rules.customerSelection === 'none' && rules.allowZeroPriceSale && rules.allowBelowCostSale, 'الافتراضي لا يغيّر سلوك البرنامج');
assert(priceRuleViolation({ unitPrice: 0, purchasePrice: 50, itemName: 'قلم' }) === null && priceRuleViolation({ unitPrice: 40, purchasePrice: 50, itemName: 'قلم' }) === null, 'بالافتراضي: السعر صفر وأقل من الشراء مسموحان');
assert(partyRuleViolation({ isPlatformSale: false }) === null, 'بالافتراضي: العميل اختياري');

// ---- رفض القيم الخاطئة ----
expectError(() => saveSalesRules(null, context()), 'بيانات فارغة تُرفض');
expectError(() => saveSalesRules({ defaultSaleMode: 'x' }, context()), 'وضع بيع غير معروف يُرفض');
expectError(() => saveSalesRules({ platformSelection: 'any' }, context()), 'اختيار منصة غير معروف يُرفض');
expectError(() => saveSalesRules({ customerSelection: 'any' }, context()), 'اختيار عميل غير معروف يُرفض');
expectError(() => saveSalesRules({ allowZeroPriceSale: 'نعم' }, context()), 'قيمة غير منطقية للسماح بالسعر صفر تُرفض');
expectError(() => saveSalesRules({ platformSelection: 'fixed' }, context()), 'منصة محددة بدون اختيار منصة تُرفض');
expectError(() => saveSalesRules({ platformSelection: 'fixed', defaultPlatformId: 'nope' }, context()), 'منصة غير موجودة تُرفض');
expectError(() => saveSalesRules({ platformSelection: 'fixed', defaultPlatformId: 'plt-old' }, context()), 'منصة موقوفة تُرفض');
expectError(() => saveSalesRules({ platformSelection: 'fixed', defaultPlatformId: 'plt-direct' }, context()), '«البيع المباشر» لا يُختار كمنصة افتراضية');
expectError(() => saveSalesRules({ customerSelection: 'fixed', defaultCustomerId: 'nope' }, context()), 'عميل غير موجود يُرفض');
expectError(() => saveSalesRules({ customerSelection: 'fixed', defaultCustomerId: 'cus-2' }, context()), 'عميل موقوف يُرفض');
assert(JSON.stringify(getSalesRules()) === JSON.stringify(defaultSalesRules()), 'المحاولات المرفوضة لا تغيّر شيئًا');

// ---- الحفظ ----
rules = saveSalesRules({ defaultSaleMode: 'platform', platformSelection: 'fixed', defaultPlatformId: 'plt-noon', customerSelection: 'fixed', defaultCustomerId: 'cus-1' }, context());
assert(rules.defaultSaleMode === 'platform' && rules.defaultPlatformId === 'plt-noon' && rules.defaultCustomerId === 'cus-1' && rules.updatedBy === 'صاحب المحل' && rules.updatedAt === '2026-11-19T10:00:00.000Z', 'حفظ منصة وعميل محددين');
assert(rules.allowZeroPriceSale && rules.allowBelowCostSale, 'الحقول غير المرسلة تبقى كما هي');
let view = describeSalesRules({ platforms, customers });
assert(view.defaultPlatformName === 'نون' && view.defaultCustomerName === 'عميل نقدي' && !view.defaultPlatformMissing && !view.defaultCustomerMissing && view.effectivePlatformSelection === 'fixed' && view.effectiveCustomerSelection === 'fixed', 'عرض الإعدادات لشاشة البيع');

// المنصة أو العميل المحددان حُذفا أو أُوقفا بعد الحفظ: الشاشة تطلب الاختيار باليد
view = describeSalesRules({ platforms: platforms.filter(p => p.id !== 'plt-noon'), customers: customers.map(c => (c.id === 'cus-1' ? { ...c, status: 'inactive' } : c)) });
assert(view.defaultPlatformMissing && view.defaultCustomerMissing && view.effectivePlatformSelection === 'manual' && view.effectiveCustomerSelection === 'manual', 'منصة محذوفة أو عميل موقوف: يتحول الاختيار إلى «باليد»');

// تغيير النوع يمسح المعرّف القديم
rules = saveSalesRules({ platformSelection: 'manual', customerSelection: 'manual' }, context());
assert(rules.platformSelection === 'manual' && rules.defaultPlatformId === '' && rules.customerSelection === 'manual' && rules.defaultCustomerId === '', '«لازم يختار بإيده» يمسح القيمة المحددة');

// ---- العميل «لازم يختار بإيده» ----
assert(arabic.test(String(partyRuleViolation({ isPlatformSale: false }))), 'بيع مباشر بدون عميل يُرفض برسالة عربية');
assert(partyRuleViolation({ isPlatformSale: false, customerId: '  ' }) !== null, 'معرّف عميل فارغ لا يكفي');
assert(partyRuleViolation({ isPlatformSale: false, customerId: 'cus-1' }) === null && partyRuleViolation({ isPlatformSale: false, customerName: 'عميل نقدي' }) === null, 'مع عميل: مسموح');
assert(partyRuleViolation({ isPlatformSale: true }) === null, 'بيع المنصات لا يشترط عميلًا');
saveSalesRules({ customerSelection: 'none' }, context());
assert(partyRuleViolation({ isPlatformSale: false }) === null, 'عند «بدون عميل» لا يُشترط شيء');

// ---- قواعد السعر ----
saveSalesRules({ allowZeroPriceSale: false }, context());
let violation = priceRuleViolation({ unitPrice: 0, purchasePrice: 0, itemName: 'قلم' });
assert(violation?.code === 'ZERO_PRICE' && arabic.test(violation.message) && violation.message.includes('قلم') && violation.reviewReason === 'بيع بسعر صفر', 'منع السعر صفر');
assert(priceRuleViolation({ unitPrice: -5, purchasePrice: 0, itemName: 'قلم' })?.code === 'ZERO_PRICE', 'السعر السالب يُعامل كصفر');
assert(priceRuleViolation({ unitPrice: 0.01, purchasePrice: 0, itemName: 'قلم' }) === null, 'أي سعر فوق الصفر مسموح');
assert(priceRuleViolation({ unitPrice: 40, purchasePrice: 50, itemName: 'قلم' }) === null, 'أقل من الشراء ما زال مسموحًا (مفتاح مستقل)');

saveSalesRules({ allowZeroPriceSale: true, allowBelowCostSale: false }, context());
violation = priceRuleViolation({ unitPrice: 40, purchasePrice: 50, itemName: 'قلم' });
assert(violation?.code === 'BELOW_COST' && arabic.test(violation.message) && violation.message.includes('40') && violation.reviewReason === 'بيع بأقل من سعر الشراء', 'منع البيع بأقل من سعر الشراء');
assert(!violation!.message.includes('50'), 'رسالة الرفض لا تكشف سعر الشراء للكاشير');
assert(priceRuleViolation({ unitPrice: 50, purchasePrice: 50, itemName: 'قلم' }) === null, 'البيع بسعر الشراء نفسه مسموح');
assert(priceRuleViolation({ unitPrice: 49.99, purchasePrice: 50, itemName: 'قلم' })?.code === 'BELOW_COST', 'أقل بقرش واحد ممنوع');
assert(priceRuleViolation({ unitPrice: 0, purchasePrice: 50, itemName: 'قلم' })?.code === 'BELOW_COST', 'صفر مع سعر شراء معروف = أقل من الشراء');
assert(priceRuleViolation({ unitPrice: 0, purchasePrice: 0, itemName: 'قلم' }) === null, 'صنف بلا سعر شراء: لا مقارنة (والسعر صفر مسموح بمفتاحه)');
assert(priceRuleViolation({ unitPrice: 'abc', purchasePrice: 50, itemName: 'قلم' }) === null, 'سعر غير رقمي لا يُفحص هنا');

saveSalesRules({ allowZeroPriceSale: false, allowBelowCostSale: false }, context());
assert(priceRuleViolation({ unitPrice: 0, purchasePrice: 50, itemName: 'قلم' })?.code === 'ZERO_PRICE', 'المفتاحان مغلقان: السعر صفر يُرفض أولًا');
// فحص بإعدادات تُمرَّر صراحة (بدون تغيير الإعدادات المحفوظة)
assert(priceRuleViolation({ unitPrice: 0, purchasePrice: 50, itemName: 'قلم' }, defaultSalesRules()) === null, 'الفحص بإعدادات تُمرَّر صراحة');

// ---- الحفظ والاسترجاع ----
const collection = getSalesRulesCollection();
assert(collection.name === 'settings.salesRules' && collection.kind === 'single', 'مجموعة الحفظ');
const snapshot = JSON.parse(JSON.stringify(collection.get()));
resetSalesRules();
assert(JSON.stringify(getSalesRules()) === JSON.stringify(defaultSalesRules()), 'إعادة ضبط المصنع ترجع الافتراضي');
collection.set(snapshot);
assert(getSalesRules().allowZeroPriceSale === false && getSalesRules().allowBelowCostSale === false && getSalesRules().defaultSaleMode === 'platform', 'الاسترجاع من قاعدة البيانات');
collection.set({ defaultSaleMode: 'weird', allowZeroPriceSale: 'x' });
assert(JSON.stringify({ ...getSalesRules(), updatedAt: '', updatedBy: '' }) === JSON.stringify(defaultSalesRules()), 'بيانات محفوظة تالفة ترجع للقيم الافتراضية');
collection.set(null);
assert(JSON.stringify(getSalesRules()) === JSON.stringify(defaultSalesRules()), 'قيمة فارغة ترجع للقيم الافتراضية');

console.log(`\n🎉 كل اختبارات إعدادات البيع وقواعد السعر نجحت (${passed} تحققًا).`);

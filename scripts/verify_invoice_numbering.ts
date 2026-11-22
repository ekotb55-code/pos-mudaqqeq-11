/**
 * اختبار ترقيم الفواتير ورقم طلب المنصة + قاعدة «بيع المنصات دايمًا آجل» (بدون سيرفر)
 * التشغيل: npx tsx scripts/verify_invoice_numbering.ts
 */
import {
  defaultInvoiceNumberingSettings,
  getInvoiceNumberingSettings,
  saveInvoiceNumberingSettings,
  formatInvoiceNumber,
  periodKeyFor,
  peekInvoiceNumber,
  commitInvoiceNumber,
  resetInvoiceCounter,
  getInvoiceCounterState,
  numberingMayRepeat,
  describeInvoiceNumbering,
  normalizePlatformOrderId,
  findPlatformOrderDuplicate,
  getInvoiceNumberingCollection,
  resetInvoiceCounterState,
  resetInvoiceNumbering,
  InvoiceNumberingError
} from '../server/invoiceNumbering.ts';
import { saveSalesRules, getSalesRules, platformPaymentViolation, resetSalesRules, getSalesRulesCollection } from '../server/salesRules.ts';

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
  assert(caught instanceof InvoiceNumberingError && arabic.test(caught.message), label);
}

// تواريخ بتوقيت القاهرة (UTC+2 في نوفمبر)
const at = (iso: string) => new Date(iso);
const FRI = at('2026-11-20T10:00:00+02:00'); // الجمعة
const SAT = at('2026-11-21T10:00:00+02:00'); // السبت
const NEXT_FRI = at('2026-11-27T10:00:00+02:00');
const LATE_NIGHT_UTC = at('2026-11-20T23:30:00Z'); // 01:30 السبت 21 بتوقيت القاهرة

const used = new Set<string>();
const isUsed = (n: string) => used.has(n);
const take = (now: Date) => {
  const r = peekInvoiceNumber(now, isUsed);
  commitInvoiceNumber(r);
  used.add(r.number);
  return r.number;
};

// ---- الافتراضي: نفس شكل الأرقام الحالية لكن متسلسل ----
resetInvoiceNumbering();
const d = getInvoiceNumberingSettings();
assert(d.prefix === 'INV-' && d.datePart === 'day' && d.separator === '-' && d.digits === 4 && d.suffix === '' && d.resetPeriod === 'daily' && d.startAt === 1 && d.platformOrderDuplicates === 'block', 'الإعدادات الافتراضية');
assert(JSON.stringify(d) === JSON.stringify(defaultInvoiceNumberingSettings()), 'الافتراضي ثابت');
assert(take(FRI) === 'INV-20261120-0001' && take(FRI) === 'INV-20261120-0002' && take(FRI) === 'INV-20261120-0003', 'متسلسل: 0001 ثم 0002 ثم 0003');
assert(take(SAT) === 'INV-20261121-0001', 'يوم جديد: العد يبدأ من 1');
assert(take(LATE_NIGHT_UTC) === 'INV-20261121-0002', 'اليوم بتوقيت القاهرة (بعد 12 بالليل في القاهرة قبلها في جرينتش)');

// ---- الحجز بدون تثبيت: الفاتورة المرفوضة ما تعملش فجوة ----
const peek1 = peekInvoiceNumber(SAT, isUsed);
const peek2 = peekInvoiceNumber(SAT, isUsed);
assert(peek1.number === 'INV-20261121-0003' && peek2.number === peek1.number, 'المعاينة لا تغيّر العد');
assert(take(SAT) === 'INV-20261121-0003', 'بعد المعاينة نفس الرقم');

// ---- الرقم المستخدم يتعدّى ----
used.add('INV-20261121-0004');
assert(take(SAT) === 'INV-20261121-0005', 'رقم مستخدم قبل كده يتعدّى');

// ---- الفترات ----
assert(periodKeyFor('never', FRI) === 'all' && periodKeyFor('yearly', FRI) === '2026' && periodKeyFor('monthly', FRI) === '2026-11' && periodKeyFor('daily', FRI) === '2026-11-20', 'مفاتيح الفترات');
assert(periodKeyFor('weekly', FRI) === 'W2026-11-14' && periodKeyFor('weekly', SAT) === 'W2026-11-21' && periodKeyFor('weekly', NEXT_FRI) === 'W2026-11-21', 'الأسبوع يبدأ السبت');
assert(periodKeyFor('yearly', at('2026-12-31T23:30:00Z')) === '2027', 'رأس السنة بتوقيت القاهرة');

// ---- الشكل ----
const fmt = (over: any, n: number, now = FRI) => formatInvoiceNumber(n, now, { ...defaultInvoiceNumberingSettings(), ...over });
assert(fmt({ prefix: '', datePart: 'none', digits: 1 }, 7) === '7', 'رقم عادي بس');
assert(fmt({ prefix: 'F', datePart: 'none', digits: 5 }, 42) === 'F00042', 'بادئة + رقم');
assert(fmt({ prefix: 'F-', datePart: 'month', separator: '/', digits: 3 }, 9) === 'F-202611/009', 'بادئة + الشهر + فاصل + رقم');
assert(fmt({ prefix: '', datePart: 'year', separator: '', digits: 4, suffix: '-ON' }, 12) === '20260012-ON', 'التاريخ + رقم + نص بعده');
assert(fmt({ prefix: 'فرع1-', datePart: 'none', digits: 2 }, 123) === 'فرع1-123', 'بادئة عربي، والعدد يكبر عن الخانات');

// ---- الحفظ والتحقق ----
expectError(() => saveInvoiceNumberingSettings(null, 'x'), 'بيانات فارغة تُرفض');
expectError(() => saveInvoiceNumberingSettings({ prefix: 'INV 1' }, 'x'), 'مسافة في النص قبل الرقم تُرفض');
expectError(() => saveInvoiceNumberingSettings({ prefix: 'A'.repeat(13) }, 'x'), 'نص طويل يُرفض');
expectError(() => saveInvoiceNumberingSettings({ suffix: 'x<y' }, 'x'), 'رموز غير مسموحة تُرفض');
expectError(() => saveInvoiceNumberingSettings({ digits: 9 }, 'x'), 'خانات أكتر من 8 تُرفض');
expectError(() => saveInvoiceNumberingSettings({ digits: 0 }, 'x'), 'خانات صفر تُرفض');
expectError(() => saveInvoiceNumberingSettings({ startAt: 0 }, 'x'), 'بداية صفر تُرفض');
expectError(() => saveInvoiceNumberingSettings({ startAt: 1.5 }, 'x'), 'بداية بكسر تُرفض');
expectError(() => saveInvoiceNumberingSettings({ resetPeriod: 'hourly' }, 'x'), 'فترة غير معروفة تُرفض');
expectError(() => saveInvoiceNumberingSettings({ datePart: 'week' }, 'x'), 'تاريخ غير معروف يُرفض');
expectError(() => saveInvoiceNumberingSettings({ platformOrderDuplicates: 'maybe' }, 'x'), 'قيمة تكرار غير معروفة تُرفض');
assert(getInvoiceNumberingSettings().prefix === 'INV-', 'الحفظ المرفوض لا يغيّر شيئًا');

let saved = saveInvoiceNumberingSettings({ prefix: 'S', datePart: 'none', digits: 6, resetPeriod: 'never', startAt: 1000 }, 'صاحب المحل', FRI);
assert(saved.prefix === 'S' && saved.digits === 6 && saved.resetPeriod === 'never' && saved.startAt === 1000 && saved.updatedBy === 'صاحب المحل' && saved.separator === '-', 'حفظ جزئي يحتفظ بالباقي');
// تغيير الفترة: العد يكمل من آخر رقم (5) لأن الرقم الجديد مختلف الشكل
assert(take(FRI) === 'S000006', 'تغيير الشكل والفترة: العد يكمل من آخر رقم');
resetInvoiceCounter({}, 'صاحب المحل', FRI);
assert(take(FRI) === 'S001000' && take(SAT) === 'S001001', 'تصفير يدوي: يبدأ من رقم البداية، و«أبدًا» لا يتصفر بتغير اليوم');
const counter = getInvoiceCounterState();
assert(counter.resetBy === 'صاحب المحل' && counter.last === 1001 && counter.periodKey === 'all', 'حالة العد');
resetInvoiceCounter({ startAt: 50 }, 'مدير', FRI);
assert(take(FRI) === 'S000050', 'تصفير برقم بداية مكتوب');
expectError(() => resetInvoiceCounter({ startAt: -3 }, 'x'), 'رقم بداية سالب في التصفير يُرفض');
resetInvoiceCounter({ startAt: 50 }, 'مدير', FRI);
assert(take(FRI) === 'S000051', 'تصفير لرقم مستخدم: يتعدّى المستخدم (لا تكرار أبدًا)');

// ---- تنبيه التكرار ----
assert(numberingMayRepeat({ ...defaultInvoiceNumberingSettings(), datePart: 'none', resetPeriod: 'daily' }) === true, 'بدون تاريخ + تصفير يومي: ممكن يكرر');
assert(numberingMayRepeat({ ...defaultInvoiceNumberingSettings(), datePart: 'month', resetPeriod: 'monthly' }) === false, 'الشهر + تصفير شهري: مش هيكرر');
assert(numberingMayRepeat({ ...defaultInvoiceNumberingSettings(), datePart: 'month', resetPeriod: 'weekly' }) === true, 'الشهر + تصفير أسبوعي: ممكن يكرر');
assert(numberingMayRepeat({ ...defaultInvoiceNumberingSettings(), datePart: 'none', resetPeriod: 'never' }) === false, 'بدون تاريخ + أبدًا: مش هيكرر');
saveInvoiceNumberingSettings({ resetPeriod: 'daily' }, 'x', FRI);
const view = describeInvoiceNumbering(FRI, isUsed);
assert(view.mayRepeat === true && arabic.test(view.mayRepeatNote) && typeof view.nextNumber === 'string' && view.settings.prefix === 'S' && view.counter.periodKey !== undefined, 'العرض: الرقم الجاي + تنبيه التكرار');

// ---- الحفظ والاسترجاع وإعادة الضبط ----
const collection = getInvoiceNumberingCollection();
assert(collection.name === 'settings.invoiceNumbering' && collection.kind === 'single', 'مجموعة الحفظ');
const snapshot = JSON.parse(JSON.stringify(collection.get()));
resetInvoiceCounterState();
assert(getInvoiceCounterState().last === 0 && getInvoiceNumberingSettings().prefix === 'S', 'إعادة ضبط العمليات: العد يتصفر والشكل يفضل');
resetInvoiceNumbering();
assert(JSON.stringify(getInvoiceNumberingSettings()) === JSON.stringify(defaultInvoiceNumberingSettings()) && getInvoiceCounterState().last === 0, 'إعادة ضبط المصنع: الافتراضي');
collection.set(snapshot);
assert(getInvoiceNumberingSettings().prefix === 'S' && getInvoiceCounterState().last === snapshot.state.last, 'الاسترجاع من قاعدة البيانات');
collection.set({ settings: { prefix: 'bad space', digits: 99, resetPeriod: 'x', startAt: -1 }, state: { last: -5 } });
const odd = getInvoiceNumberingSettings();
assert(odd.prefix === 'INV-' && odd.digits === 4 && odd.resetPeriod === 'daily' && odd.startAt === 1 && getInvoiceCounterState().last === 0, 'بيانات محفوظة تالفة تُنظَّف');
collection.set(null);
assert(getInvoiceNumberingSettings().prefix === 'INV-', 'بيانات فاضية = الافتراضي');

// ---- رقم طلب المنصة ----
assert(normalizePlatformOrderId('  402-55  77 ') === '402-55 77' && normalizePlatformOrderId(undefined) === '' && normalizePlatformOrderId(12345) === '12345', 'تنظيف رقم الطلب');
const invs = [
  { invoiceNumber: 'A1', platform: 'نون', platformId: 'p-noon', platformOrderId: 'NOON-77', status: 'تم البيع' },
  { invoiceNumber: 'A2', platform: 'جوميا', platformId: 'p-jumia', platformOrderId: 'J-1', status: 'ملغاة' },
  { invoiceNumber: 'A3', platform: 'أمازون', platformOrderId: 'AMZ-1', status: 'تم البيع' }
];
assert(findPlatformOrderDuplicate(invs, { platformId: 'p-noon', platformName: 'نون', orderId: 'noon-77' })?.invoiceNumber === 'A1', 'تكرار على نفس المنصة (الحروف الكبيرة والصغيرة واحد)');
assert(findPlatformOrderDuplicate(invs, { platformId: 'p-jumia', platformName: 'جوميا', orderId: 'NOON-77' }) === null, 'نفس الرقم على منصة تانية مش تكرار');
assert(findPlatformOrderDuplicate(invs, { platformId: 'p-jumia', platformName: 'جوميا', orderId: 'J-1' }) === null, 'الفاتورة الملغاة لا تُحسب');
assert(findPlatformOrderDuplicate(invs, { platformName: 'أمازون', orderId: 'AMZ-1' })?.invoiceNumber === 'A3', 'مطابقة باسم المنصة لو مفيش معرّف');
assert(findPlatformOrderDuplicate(invs, { platformId: 'p-noon', platformName: 'نون', orderId: 'NOON-77', exceptInvoiceNumber: 'A1' }) === null, 'تعديل نفس الفاتورة مش تكرار');
assert(findPlatformOrderDuplicate(invs, { platformId: 'p-noon', platformName: 'نون', orderId: '  ' }) === null, 'رقم فاضي مش تكرار');

// ---- «بيع المنصات دايمًا آجل على المنصة» ----
resetSalesRules();
const ctx = { platforms: [], customers: [], by: 'صاحب المحل' };
assert(getSalesRules().platformAlwaysCredit === false, 'الافتراضي: مقفول (لا يتغير شيء)');
assert(platformPaymentViolation({ isPlatformSale: true, paymentType: 'نقدي' }) === null, 'مقفول: بيع منصة نقدي مسموح');
const rules = saveSalesRules({ platformAlwaysCredit: true }, ctx);
assert(rules.platformAlwaysCredit === true && rules.allowZeroPriceSale === true, 'تشغيل المفتاح يحتفظ بالباقي');
let threw = false;
try {
  saveSalesRules({ platformAlwaysCredit: 'yes' }, ctx);
} catch {
  threw = true;
}
assert(threw, 'قيمة غير صحيحة للمفتاح تُرفض');
const v1 = platformPaymentViolation({ isPlatformSale: true, paymentType: 'نقدي' });
const v2 = platformPaymentViolation({ isPlatformSale: true, paymentType: 'جزئي' });
assert(v1 !== null && arabic.test(v1) && v2 !== null, 'مفتوح: نقدي وجزئي على منصة يُرفضوا');
assert(platformPaymentViolation({ isPlatformSale: true, paymentType: 'آجل', creditPartyType: 'platform' }) === null, 'آجل على المنصة مسموح');
assert(platformPaymentViolation({ isPlatformSale: true, paymentType: 'آجل' }) === null, 'آجل بدون طرف وبدون عميل = على المنصة');
assert(platformPaymentViolation({ isPlatformSale: true, paymentType: 'آجل', creditPartyType: 'customer' }) !== null, 'آجل على عميل في بيع منصة يُرفض');
assert(platformPaymentViolation({ isPlatformSale: true, paymentType: 'آجل', customerId: 'c1' }) !== null, 'آجل مع عميل وبدون طرف = على العميل ← يُرفض');
assert(platformPaymentViolation({ isPlatformSale: true, paymentType: 'آجل', creditPartyType: 'platform', customerId: 'c1' }) === null, 'العميل مكتوب في الفاتورة والآجل على المنصة: مسموح');
assert(platformPaymentViolation({ isPlatformSale: false, paymentType: 'نقدي' }) === null, 'البيع المباشر لا يتأثر');
const salesCollection = getSalesRulesCollection();
const savedRules = JSON.parse(JSON.stringify(salesCollection.get()));
resetSalesRules();
salesCollection.set(savedRules);
assert(getSalesRules().platformAlwaysCredit === true, 'المفتاح يتحفظ ويرجع من قاعدة البيانات');
salesCollection.set({ platformAlwaysCredit: 'x' });
assert(getSalesRules().platformAlwaysCredit === false, 'قيمة تالفة = مقفول');
resetSalesRules();

console.log(`\n🎉 كل اختبارات ترقيم الفواتير وآجل المنصة نجحت (${passed} تحققًا).`);

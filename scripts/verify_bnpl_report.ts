import crypto from 'crypto';
import {
  saveItem,
  savePlatform,
  createInvoice as rawCreateInvoice,
  cancelInvoice,
  createReturn as rawCreateReturn,
  getBnplReport
} from '../server/sheetsService';
import { Item, Platform } from '../src/types';
import { toCairoDateStr } from '../src/utils/dateUtils';

const createInvoice: typeof rawCreateInvoice = (payload: any, session?: any) =>
  rawCreateInvoice({ idempotencyKey: crypto.randomUUID(), ...payload }, session);
const createReturn: typeof rawCreateReturn = (payload: any, session?: any) =>
  rawCreateReturn({ idempotencyKey: crypto.randomUUID(), ...payload }, session);

async function runBnplReportTests() {
  console.log('--- بدء اختبارات تقرير تقسيط المنصات (BNPL) الشاملة ---\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`✅ [نجاح]: ${message}`);
      passed++;
    } else {
      console.error(`❌ [فشل]: ${message}`);
      failed++;
    }
  }

  const session = {
    role: 'designer' as const,
    token: 'test-token',
    name: 'المهندس المالي',
    permissions: ['reports.bnpl_view' as const]
  };

  // 1. إنشاء المنصات والأصناف التجريبية
  const platformNoon: Platform = {
    id: 'plt-noon-test',
    name: 'نون إكسبريس',
    discountPercentage: 10, // 10% عمولة
    pickupFee: 20,
    enableBnpl: true,
    bnplPercentage: 20,
    status: 'نشطة',
    notes: 'منصة نون للاختبار'
  };
  await savePlatform(platformNoon, session);

  const platformAmazon: Platform = {
    id: 'plt-amz-test',
    name: 'أمازون مصر',
    discountPercentage: 15,
    pickupFee: 15,
    enableBnpl: false,
    bnplPercentage: 0,
    status: 'نشطة',
    notes: 'منصة أمازون للاختبار'
  };
  await savePlatform(platformAmazon, session);

  // صنف 1: عليه BNPL 20%
  const itemPhone: any = {
    barcode: '6221000111',
    name: 'إلكترونيات - هاتف ذكي برو أزرق',
    salePrice: 5000,
    costPrice: 4000,
    stockQuantity: 50,
    minStock: 5,
    unit: 'قطعة',
    category: 'إلكترونيات',
    status: 'نشط',
    enableBnpl: true,
    bnplPercentage: 20
  };
  const phoneRes = await saveItem(itemPhone, session);
  const createdPhone = phoneRes.item!;

  // صنف 2: صنف عادي بدون BNPL
  const itemCase: any = {
    barcode: '6221000222',
    name: 'جراب حماية مدرّع شفاف',
    salePrice: 500,
    costPrice: 200,
    stockQuantity: 100,
    minStock: 10,
    unit: 'قطعة',
    category: 'إكسسوارات',
    status: 'نشط',
    enableBnpl: false,
    bnplPercentage: 0
  };
  const caseRes = await saveItem(itemCase, session);
  const createdCase = caseRes.item!;

  // 2. إصدار 3 فواتير:
  // فاتورة 1: فاتورة BNPL (هاتف بسعر أساسي 5000 + 20% BNPL = سعر العميل 6000، كمية 2)
  const inv1Res = await createInvoice({
    platformId: platformNoon.id,
    lines: [
      {
        itemId: createdPhone.id,
        quantity: 2,
        unitPrice: 5000,
        baseUnitPrice: 5000,
        bnplPercent: 20,
        customerUnitPrice: 6000,
        bnplUnitAmount: 1000
      }
    ],
    deliveryFee: 0,
    notes: 'فاتورة BNPL صالحة'
  }, session);

  assert(inv1Res.success, `تم إصدار الفاتورة 1 (BNPL) بنجاح ${inv1Res.error || ''}`);
  if (!inv1Res.success) {
    console.error('Invoice 1 creation failed:', inv1Res.error);
  }
  const inv1 = inv1Res.invoice!;

  // فاتورة 2: فاتورة عادية بدون BNPL (جراب عادي 500، كمية 1)
  const inv2Res = await createInvoice({
    platformId: platformAmazon.id,
    lines: [
      {
        itemId: createdCase.id,
        quantity: 1,
        unitPrice: 500,
        baseUnitPrice: 500,
        bnplPercent: 0,
        customerUnitPrice: 500,
        bnplUnitAmount: 0
      }
    ],
    notes: 'فاتورة عادية بدون تقسيط'
  }, session);

  assert(inv2Res.success, 'تم إصدار الفاتورة 2 (عادية) بنجاح');

  // فاتورة 3: فاتورة BNPL ثم إلغاؤها (لتصبح ملغاة)
  const inv3Res = await createInvoice({
    platformId: platformNoon.id,
    lines: [
      {
        itemId: createdPhone.id,
        quantity: 1,
        unitPrice: 5000,
        baseUnitPrice: 5000,
        bnplPercent: 20,
        customerUnitPrice: 6000,
        bnplUnitAmount: 1000
      }
    ],
    notes: 'فاتورة BNPL سيتم إلغاؤها'
  }, session);

  assert(inv3Res.success, 'تم إصدار الفاتورة 3 (BNPL مؤقتة) بنجاح');
  const inv3 = inv3Res.invoice!;

  // إلغاء الفاتورة 3
  const cancelRes = await cancelInvoice(inv3.invoiceNumber, 'إلغاء اختباري', session);
  assert(cancelRes.success, 'تم إلغاء الفاتورة 3 بنجاح');

  // 3. اختبار التقرير العام والتأكد من استبعاد العادية والملغاة:
  const rep1Res = await getBnplReport({}, session);
  assert(rep1Res.success && Boolean(rep1Res.report), 'تم جلب تقرير BNPL بنجاح');
  const rep1 = rep1Res.report!;

  // التحقق من أن التقرير يحتوي فقط على سطور الفاتورة 1
  // (هاتف 5000 × 2 قطعة، BNPL 20% -> سعر العميل للوحدة 6000، زيادة السعر للوحدة 1000، استقطاع BNPL للوحدة 1200، عمولة للوحدة 600)
  assert(rep1.summary.invoicesCount === 1, `عدد الفواتير المعروضة = 1 (استبعاد العادية والملغاة)، الفعلي: ${rep1.summary.invoicesCount}`);
  assert(rep1.summary.piecesCount === 2, `عدد القطع = 2، الفعلي: ${rep1.summary.piecesCount}`);
  assert(rep1.summary.totalCustomerPaid === 12000, `إجمالي ما دفعه العميل = 12000 ج.م، الفعلي: ${rep1.summary.totalCustomerPaid}`);
  assert(rep1.summary.totalPriceIncrease === 2000, `إجمالي زيادة السعر = 2000 ج.م، الفعلي: ${rep1.summary.totalPriceIncrease}`);
  assert(rep1.summary.totalBnplAmount === 2400, `إجمالي استقطاع BNPL = 2400 ج.م، الفعلي: ${rep1.summary.totalBnplAmount}`);
  assert(rep1.summary.totalBaseAmount === 10000, `إجمالي السعر الأساسي = 10000 ج.م، الفعلي: ${rep1.summary.totalBaseAmount}`);
  // عمولة نون 10% على سعر العميل 12000 = 1200 ج.م (تُقرأ من السطر المحفوظ)
  assert(rep1.summary.totalCommission === 1200, `عمولة المنصة المقروءة من السطر = 1200 ج.م، الفعلي: ${rep1.summary.totalCommission}`);
  // صافي الأسطر = 12000 - 2400 - 1200 = 8400 ج.م
  assert(rep1.summary.totalLinesNet === 8400, `صافي الأسطر = 8400 ج.م، الفعلي: ${rep1.summary.totalLinesNet}`);
  assert(rep1.rows[0].priceIncrease === 2000, `عمود زيادة السعر في الصف = 2000 ج.م، الفعلي: ${rep1.rows[0].priceIncrease}`);
  assert(rep1.rows[0].bnplAmount === 2400, `عمود استقطاع BNPL في الصف = 2400 ج.م، الفعلي: ${rep1.rows[0].bnplAmount}`);

  // 4. اختبار خصم المرتجعات: عمل مرتجع لقطعة واحدة من الفاتورة 1
  const returnRes = await createReturn({
    invoiceNumber: inv1.invoiceNumber,
    returnReason: 'طلب العميل إرجاع قطعة واحدة',
    lines: [
      {
        itemId: createdPhone.id,
        returnedQuantity: 1,
        returnShippingDeductionPerUnit: 0,
        totalLineReturnShippingDeduction: 0,
        itemCondition: 'يرجع المخزن'
      }
    ]
  }, session);

  assert(returnRes.success, 'تم تسجيل مرتجع لقطعة واحدة بنجاح');

  // جلب التقرير بعد المرتجع:
  const repAfterReturnRes = await getBnplReport({}, session);
  const repAfter = repAfterReturnRes.report!;

  assert(repAfter.summary.piecesCount === 1, `بعد المرتجع: عدد القطع المتبقية = 1، الفعلي: ${repAfter.summary.piecesCount}`);
  assert(repAfter.summary.totalCustomerPaid === 6000, `بعد المرتجع: ما دفعه العميل = 6000 ج.م، الفعلي: ${repAfter.summary.totalCustomerPaid}`);
  assert(repAfter.summary.totalPriceIncrease === 1000, `بعد المرتجع: زيادة السعر = 1000 ج.م، الفعلي: ${repAfter.summary.totalPriceIncrease}`);
  assert(repAfter.summary.totalBnplAmount === 1200, `بعد المرتجع: استقطاع BNPL = 1200 ج.م، الفعلي: ${repAfter.summary.totalBnplAmount}`);
  assert(repAfter.summary.totalBaseAmount === 5000, `بعد المرتجع: السعر الأساسي = 5000 ج.م، الفعلي: ${repAfter.summary.totalBaseAmount}`);
  assert(repAfter.summary.totalCommission === 600, `بعد المرتجع: العمولة المقروءة من السطر = 600 ج.م، الفعلي: ${repAfter.summary.totalCommission}`);
  assert(repAfter.summary.totalLinesNet === 4200, `بعد المرتجع: صافي الأسطر = 4200 ج.م، الفعلي: ${repAfter.summary.totalLinesNet}`);

  // 5. اختبار فلتر المنصة:
  // تصفية لمنصة نون -> تظهر الفاتورة
  const repNoon = await getBnplReport({ platformId: platformNoon.id }, session);
  assert(repNoon.report!.summary.invoicesCount === 1, `فلتر منصة نون: يظهر فاتورة واحدة`);

  // تصفية لمنصة أمازون -> 0 نتائج
  const repAmz = await getBnplReport({ platformId: platformAmazon.id }, session);
  assert(repAmz.report!.summary.invoicesCount === 0, `فلتر منصة أمازون: 0 نتائج (لا يوجد BNPL على أمازون)`);

  // 6. اختبار فلتر الصنف والبحث وتوحيد الحروف العربية:
  // البحث بـ "إلكترونيات" بالألف المهموزة
  const repSearch1 = await getBnplReport({ productQuery: 'إلكترونيات' }, session);
  assert(repSearch1.report!.summary.invoicesCount === 1, `البحث بـ "إلكترونيات" (ألف مكسورة): يجد الصنف`);

  // البحث بـ "الكترونيات" بالألف العادية (توحيد إ -> ا)
  const repSearch2 = await getBnplReport({ productQuery: 'الكترونيات' }, session);
  assert(repSearch2.report!.summary.invoicesCount === 1, `البحث بـ "الكترونيات" (ألف عادية موحدة): يجد الصنف بنجاح`);

  // البحث بالباركود:
  const repSearchBarcode = await getBnplReport({ productQuery: '6221000111' }, session);
  assert(repSearchBarcode.report!.summary.invoicesCount === 1, `البحث بالباركود: يجد الصنف بنجاح`);

  // البحث بصنف غير موجود:
  const repSearchNone = await getBnplReport({ productQuery: 'منتج غير موجود إطلاقاً' }, session);
  assert(repSearchNone.report!.summary.invoicesCount === 0, `البحث بكلمة غير موجودة: يعطي 0 نتائج`);

  // 7. اختبار فلتر التاريخ:
  const todayStr = toCairoDateStr(new Date());
  const repDateMatch = await getBnplReport({ from: todayStr, to: todayStr }, session);
  assert(repDateMatch.report!.summary.invoicesCount === 1, `فلتر تاريخ اليوم: يحتوي على الفاتورة`);

  const repDatePast = await getBnplReport({ from: '2020-01-01', to: '2020-01-02' }, session);
  assert(repDatePast.report!.summary.invoicesCount === 0, `فلتر تاريخ قديم: يعطي 0 نتائج`);

  // 8. اختبار التجميع الثلاثي (groupBy: item / platform / invoice):
  const repByItem = await getBnplReport({ groupBy: 'item' }, session);
  const repByPlt = await getBnplReport({ groupBy: 'platform' }, session);
  const repByInv = await getBnplReport({ groupBy: 'invoice' }, session);

  assert(repByItem.report!.rows.length === 1, `تجميع حسب الصنف: صف واحد للصنف`);
  assert(repByPlt.report!.rows.length === 1, `تجميع حسب المنصة: صف واحد للمنصة`);
  assert(repByInv.report!.rows.length === 1, `تجميع حسب الفاتورة: صف واحد للفاتورة`);

  assert(
    repByItem.report!.summary.totalLinesNet === repByPlt.report!.summary.totalLinesNet &&
    repByPlt.report!.summary.totalLinesNet === repByInv.report!.summary.totalLinesNet,
    `تطابق الإجماليات بدقة تامة في جميع أوضاع التجميع الثلاثة`
  );

  // 9. اختبار مثال 950 × 4 (BNPL 20%، عمولة 14.5% قبل الضريبة شاملة 14%) يعطي استقطاع 912 وزيادة 760 وعمولة 580:
  const platformValu: Platform = {
    id: 'plt-valu-950',
    name: 'منصة فاليو 950',
    discountPercentage: 14.5,
    pickupFee: 25,
    enableBnpl: true,
    bnplPercentage: 20,
    taxRate: 14,
    taxInclusive: true,
    platformCommissionOn: 'before_tax',
    status: 'نشطة'
  };
  await savePlatform(platformValu, session);

  const item950Res = await saveItem({
    barcode: '6221000950',
    name: 'صنف اختبار 950',
    salePrice: 950,
    costPrice: 700,
    taxRate: 14,
    stockQuantity: 50,
    minStock: 2,
    unit: 'قطعة',
    category: 'إلكترونيات',
    status: 'نشط',
    enableBnpl: true,
    bnplPercentage: 20
  } as any, session);
  const createdItem950 = item950Res.item!;

  const inv950Res = await createInvoice({
    platformId: platformValu.id,
    lines: [
      {
        itemId: createdItem950.id,
        quantity: 4,
        salePriceAtSale: 950
      }
    ],
    deliveryFee: 0
  }, session);
  assert(inv950Res.success, 'تم إنشاء فاتورة مثال 950 × 4 بنجاح');

  const rep950Res = await getBnplReport({ platformId: platformValu.id }, session);
  const rep950 = rep950Res.report!;
  assert(rep950.summary.totalCustomerPaid === 4560, `مثال 950 × 4: إجمالي ما دفعه العميل = 4560، الفعلي: ${rep950.summary.totalCustomerPaid}`);
  assert(rep950.summary.totalPriceIncrease === 760, `مثال 950 × 4: زيادة السعر = 760، الفعلي: ${rep950.summary.totalPriceIncrease}`);
  assert(rep950.summary.totalBnplAmount === 912, `مثال 950 × 4: استقطاع BNPL = 912، الفعلي: ${rep950.summary.totalBnplAmount}`);
  assert(rep950.summary.totalCommission === 580, `مثال 950 × 4: العمولة من السطر = 580، الفعلي: ${rep950.summary.totalCommission}`);
  assert(rep950.rows[0].priceIncrease === 760 && rep950.rows[0].bnplAmount === 912, `مثال 950 × 4: صف التقرير يحتوي على زيادة السعر 760 واستقطاع 912`);

  // 10. اختبار فاتورة قديمة بدون الحقل الجديد bnplDeductionUnit (يستخدم bnplUnitAmount كاحتياطي):
  const platformLegacy: Platform = {
    id: 'plt-legacy-bnpl',
    name: 'منصة فواتير قديمة',
    discountPercentage: 10,
    pickupFee: 0,
    enableBnpl: true,
    bnplPercentage: 20,
    status: 'نشطة'
  };
  await savePlatform(platformLegacy, session);

  const legacyInvRes = await createInvoice({
    platformId: platformLegacy.id,
    lines: [
      {
        itemId: createdItem950.id,
        quantity: 2,
        salePriceAtSale: 1000
      }
    ]
  }, session);
  assert(legacyInvRes.success && Boolean(legacyInvRes.invoice), 'تم إنشاء فاتورة لمحاكاة الفاتورة القديمة');
  const legacyInv = legacyInvRes.invoice!;
  // محاكاة فاتورة قديمة بحذف الحقلين الجديدين وإرجاع عمولة السطر للقديمة (100 للوحدة)
  delete (legacyInv.lines[0] as any).bnplDeductionUnit;
  delete (legacyInv.lines[0] as any).totalBnplDeduction;
  legacyInv.lines[0].unitDiscountValue = 100;

  const repLegacyRes = await getBnplReport({ platformId: platformLegacy.id }, session);
  const repLegacy = repLegacyRes.report!;
  assert(repLegacy.summary.totalPriceIncrease === 400, `فاتورة قديمة بدون bnplDeductionUnit: زيادة السعر = 400، الفعلي: ${repLegacy.summary.totalPriceIncrease}`);
  assert(repLegacy.summary.totalBnplAmount === 400, `فاتورة قديمة بدون bnplDeductionUnit: يستخدم bnplUnitAmount فيكون الاستقطاع = 400، الفعلي: ${repLegacy.summary.totalBnplAmount}`);
  assert(repLegacy.summary.totalCommission === 200, `فاتورة قديمة: يقرأ العمولة المحفوظة من السطر (100 × 2 = 200)، الفعلي: ${repLegacy.summary.totalCommission}`);

  console.log('\n========================================');
  console.log(`إجمالي الاختبارات: ${passed + failed} | الناجحة: ${passed} | الفاشلة: ${failed}`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runBnplReportTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

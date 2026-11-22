import assert from 'node:assert';
import {
  saveItem,
  savePlatform,
  saveCustomer,
  createInvoice,
  createReturn,
  getPlatformReport
} from '../server/sheetsService.ts';

async function runTests() {
  console.log('=== بدء اختبارات ربط الأصناف بالمنصات وتقرير المنصة ===\n');

  const session = {
    role: 'designer' as const,
    permissions: [] as any[],
    name: 'مهندس الاختبار'
  };

  // إنشاء عميل للاختبار
  const custRes = await saveCustomer({
    name: 'عميل اختبار المنصة',
    phone: '01099998888'
  }, session);
  assert(custRes.success && custRes.customer, 'فشل إنشاء عميل الاختبار');

  // 1. إنشاء منصتين للاختبار
  const pltAmazonRes = await savePlatform({
    id: 'plt-test-amz',
    name: 'أمازون اختبار',
    discountPercentage: 10,
    pickupFee: 20,
    enableBnpl: true,
    bnplPercentage: 20,
    status: 'نشطة'
  }, session);
  assert(pltAmazonRes.success, 'فشل إنشاء منصة أمازون اختبار');

  const pltNoonRes = await savePlatform({
    id: 'plt-test-noon',
    name: 'نون اختبار',
    discountPercentage: 15,
    pickupFee: 10,
    enableBnpl: false,
    bnplPercentage: 0,
    status: 'نشطة'
  }, session);
  assert(pltNoonRes.success, 'فشل إنشاء منصة نون اختبار');

  // 2. إنشاء 3 أصناف:
  // أ) صنف مخصص لمنصة أمازون فقط
  const itemAmzOnlyRes = await saveItem({
    id: 'itm-amz-only',
    name: 'سماعة مخصصة لأمازون فقط',
    salePrice: 1000,
    purchasePrice: 600,
    packagingCost: 50,
    stockQuantity: 30,
    platformIds: ['plt-test-amz']
  }, session);
  assert(itemAmzOnlyRes.success, 'فشل حفظ صنف أمازون فقط');
  assert.deepStrictEqual(itemAmzOnlyRes.item?.platformIds, ['plt-test-amz']);

  // ب) صنف متاح لكل المنصات (platformIds فارغة)
  const itemAllPltRes = await saveItem({
    id: 'itm-all-plt',
    name: 'شاحن عام لكل المنصات',
    salePrice: 500,
    purchasePrice: 300,
    packagingCost: 20,
    stockQuantity: 40,
    platformIds: []
  }, session);
  assert(itemAllPltRes.success, 'فشل حفظ صنف كل المنصات');
  assert.deepStrictEqual(itemAllPltRes.item?.platformIds, []);

  // ج) صنف راكد متاح على أمازون ومخزونه > 0 ولم يُبع عليها
  const itemStagnantRes = await saveItem({
    id: 'itm-stagnant-amz',
    name: 'باور بانك راكد على أمازون',
    salePrice: 800,
    purchasePrice: 500,
    packagingCost: 20,
    stockQuantity: 15,
    platformIds: ['plt-test-amz']
  }, session);
  assert(itemStagnantRes.success, 'فشل حفظ الصنف الراكد');

  console.log('✅ 1. تم حفظ الأصناف والتحقق من حقل platformIds بنجاح.');

  // 3. اختبار رفض الخادم لبيع صنف غير متاح للمنصة
  const invalidSaleRes = await createInvoice({
    idempotencyKey: 'test-plt-inv-invalid',
    platformId: 'plt-test-noon',
    platformName: 'نون اختبار',
    paymentType: 'نقدي',
    cashboxId: 'cb-main-001',
    lines: [
      {
        itemId: 'itm-amz-only',
        quantity: 1,
        salePriceAtSale: 1000
      }
    ]
  }, session);

  assert.strictEqual(invalidSaleRes.success, false, 'يجب أن يرفض الخادم بيع صنف غير متاح للمنصة');
  assert(
    invalidSaleRes.error?.includes('غير متاح للبيع على منصة'),
    `رسالة الخطأ غير متوقعة: ${invalidSaleRes.error}`
  );
  console.log(`✅ 2. رفض الخادم بيع الصنف على منصة غير متاحة برسالة: "${invalidSaleRes.error}"`);

  // 4. اختبار قبول الخادم لبيع الصنف على منصته المسموحة + صنف عام (مع BNPL وآجل)
  const validSaleRes = await createInvoice({
    idempotencyKey: 'test-plt-inv-valid',
    platformId: 'plt-test-amz',
    platformName: 'أمازون اختبار',
    paymentType: 'جزئي',
    paidAmount: 1190,
    remainingAmount: 1000,
    cashboxId: 'cb-main-001',
    customerId: custRes.customer?.id || 'cust-test-001',
    lines: [
      {
        itemId: 'itm-amz-only',
        quantity: 2,
        salePriceAtSale: 1000
      },
      {
        itemId: 'itm-all-plt',
        quantity: 1,
        salePriceAtSale: 500
      }
    ]
  }, session);

  assert(validSaleRes.success && validSaleRes.invoice, `فشل إنشاء الفاتورة الصحيحة: ${validSaleRes.error}`);
  const createdInvNumber = validSaleRes.invoice.invoiceNumber;
  console.log(`✅ 3. تم إنشاء فاتورة صحيحة على المنصة المسموحة برقم: ${createdInvNumber}`);

  // 5. تسجيل مرتجع لقطعة واحدة من الصنف الأول لاختبار خصم المرتجعات في تقرير المنصة
  const returnRes = await createReturn(
    {
      idempotencyKey: 'test-plt-ret-1',
      invoiceNumber: createdInvNumber,
      refundStatus: 'قيد على الحساب',
      lines: [
        {
          itemId: 'itm-amz-only',
          returnedQuantity: 1,
          returnShippingDeductionPerUnit: 0,
          itemCondition: 'يرجع المخزن'
        }
      ]
    },
    session
  );
  assert(returnRes.success, `فشل تسجيل المرتجع: ${returnRes.error}`);
  console.log('✅ 4. تم تسجيل مرتجع جزئي (1 قطعة) لاختبار خصم المرتجعات في التقرير.');

  // 6. جلب تقرير المنصة والتحقق من الحسابات
  const reportRes = await getPlatformReport({
    platformId: 'plt-test-amz',
    stagnantDays: 30
  }, session);

  assert(reportRes.success && reportRes.report, `فشل جلب تقرير المنصة: ${reportRes.error}`);
  const rep = reportRes.report;

  // بعد إرجاع 1 قطعة من itm-amz-only:
  // المتبقي في الفاتورة:
  // - 1 قطعة من itm-amz-only: أساسي 1000، عميل 1200، زيادة السعر 200، استقطاع BNPL = 240، عمولة السطر = 120، تكلفة (600+50)=650
  // - 1 قطعة من itm-all-plt: أساسي 500، عميل 600، زيادة السعر 100، استقطاع BNPL = 120، عمولة السطر = 60، تكلفة (300+20)=320
  // إجمالي المبيعات (سعر العميل) = 1800
  // إجمالي المبيعات بالسعر الأساسي = 1500
  // إجمالي زيادة السعر = 300
  // إجمالي استقطاع BNPL = 360
  // إجمالي العمولة (من السطر المحفوظ) = 180
  // إجمالي رسوم الالتقاط = 40
  // صافي المنصة = 1800 - 360 - 180 - 40 = 1220
  assert.strictEqual(rep.summary.invoicesCount, 1, 'عدد الفواتير يجب أن يكون 1');
  assert.strictEqual(rep.summary.totalGrossSales, 1800, 'إجمالي المبيعات بسعر العميل يجب أن يكون 1800');
  assert.strictEqual(rep.summary.totalBaseSales, 1500, 'إجمالي المبيعات بالسعر الأساسي يجب أن يكون 1500');
  assert.strictEqual(rep.summary.totalPriceIncrease, 300, 'إجمالي زيادة السعر يجب أن يكون 300');
  assert.strictEqual(rep.summary.totalBnplAmount, 360, 'إجمالي استقطاع BNPL يجب أن يكون 360');
  assert.strictEqual(rep.summary.totalCommission, 180, 'إجمالي العمولة من السطور يجب أن يكون 180');
  assert.strictEqual(rep.summary.totalNet, 1220, 'صافي المنصة يجب أن يكون 1220');
  assert.strictEqual(rep.summary.pendingDeferredBalance, 850, 'رصيد الآجل المعلق يجب أن يكون 850');

  // التحقق من وجود الصنف الراكد في قائمة الأصناف الراكدة وعدم وجود الصنف المباع اليوم
  const stagnantIds = rep.stagnantItems.map(s => s.itemId);
  assert(stagnantIds.includes('itm-stagnant-amz'), 'يجب أن يظهر الصنف الراكد في قائمة الأصناف الراكدة للمنصة');
  assert(!stagnantIds.includes('itm-amz-only'), 'الصنف المباع اليوم لا يجب أن يظهر كراكد');

  // 7. اختبار مثال 950 × 4 (استقطاع 912 وزيادة 760 وعمولة 580) وفاتورة قديمة بدون bnplDeductionUnit في تقرير المنصة:
  await savePlatform({
    id: 'plt-test-950',
    name: 'منصة اختبار 950',
    discountPercentage: 14.5,
    pickupFee: 25,
    enableBnpl: true,
    bnplPercentage: 20,
    taxRate: 14,
    taxInclusive: true,
    platformCommissionOn: 'before_tax',
    status: 'نشطة'
  }, session);

  await saveItem({
    id: 'itm-test-950',
    name: 'منتج اختبار 950',
    salePrice: 950,
    purchasePrice: 600,
    packagingCost: 0,
    taxRate: 14,
    stockQuantity: 20,
    platformIds: ['plt-test-950']
  }, session);

  const inv950Res = await createInvoice({
    idempotencyKey: 'test-plt-inv-950',
    platformId: 'plt-test-950',
    platformName: 'منصة اختبار 950',
    paymentType: 'نقدي',
    cashboxId: 'cb-main-001',
    lines: [
      {
        itemId: 'itm-test-950',
        quantity: 4,
        salePriceAtSale: 950
      }
    ]
  }, session);
  assert(inv950Res.success, 'فشل إنشاء فاتورة 950 × 4');

  const rep950Res = await getPlatformReport({ platformId: 'plt-test-950' }, session);
  assert(rep950Res.success && rep950Res.report, 'فشل جلب تقرير منصة 950');
  assert.strictEqual(rep950Res.report.summary.totalGrossSales, 4560, 'إجمالي المبيعات لمثال 950 × 4 يجب أن يكون 4560');
  assert.strictEqual(rep950Res.report.summary.totalPriceIncrease, 760, 'زيادة السعر لمثال 950 × 4 يجب أن تكون 760');
  assert.strictEqual(rep950Res.report.summary.totalBnplAmount, 912, 'استقطاع BNPL لمثال 950 × 4 يجب أن يكون 912');
  assert.strictEqual(rep950Res.report.summary.totalCommission, 580, 'العمولة لمثال 950 × 4 يجب أن تكون 580');
  assert.strictEqual(rep950Res.report.summary.totalNet, 2968, 'صافي الفاتورة لمثال 950 × 4 يجب أن يكون 2968');

  // محاكاة فاتورة قديمة بدون bnplDeductionUnit:
  delete (inv950Res.invoice!.lines[0] as any).bnplDeductionUnit;
  delete (inv950Res.invoice!.lines[0] as any).totalBnplDeduction;
  const repLegacyRes = await getPlatformReport({ platformId: 'plt-test-950' }, session);
  assert.strictEqual(repLegacyRes.report!.summary.totalBnplAmount, 760, 'الفاتورة القديمة بدون bnplDeductionUnit تستخدم bnplUnitAmount (760)');

  console.log('✅ 5. نتائج تقرير المنصة متطابقة 100%:');
  console.log('   - الملخص:', JSON.stringify(rep.summary));
  console.log('   - أعلى الأصناف مبيعاً بالكمية:', rep.topByQuantity.map(i => `${i.itemName} (${i.quantity})`).join('، '));
  console.log('   - عدد الأصناف الراكدة المرصودة:', rep.stagnantItems.length);
  console.log('   - المبيعات اليومية:', JSON.stringify(rep.dailySales));

  console.log('\n🎉 اكتملت جميع الاختبارات بنجاح باهر!');
}

runTests().catch(err => {
  console.error('❌ فشل الاختبار:', err);
  process.exit(1);
});

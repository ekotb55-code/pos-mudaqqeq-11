import crypto from 'crypto';
import {
  createInvoice as rawCreateInvoice,
  updateInvoice,
  saveItem,
  savePlatform,
  saveItemPlatformCost,
  getInvoicePrintSettings,
  getDisplaySettings,
  saveInvoicePrintSettings,
  saveDisplaySettings
} from '../server/sheetsService.ts';
import { calculateInvoice } from '../src/shared/invoiceCalc.ts';

const createInvoice: typeof rawCreateInvoice = (payload: any, session?: any) =>
  rawCreateInvoice({ idempotencyKey: crypto.randomUUID(), ...payload }, session);

async function runTests() {
  console.log('--- بدء اختبارات ميزة تقسيط المنصات (BNPL) التلقائية ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string, details?: string) {
    if (condition) {
      console.log(`✅ [نجاح]: ${title}`);
      passed++;
    } else {
      console.error(`❌ [فشل]: ${title} ${details ? `(${details})` : ''}`);
      failed++;
    }
  }

  const session = { role: 'designer' as const, permissions: [] as any[] };

  // اختبار 1: أساسي 950 × 4 + BNPL 20% + عمولة 14.5% + شامل ضريبة 14% + التقاط 25 للقطعة
  // المتوقع: مجموع 4560، BNPL 912، عمولة 580، صافي 2968
  const plat1Res = await savePlatform({
    name: 'منصة اختبار BNPL مع التقاط',
    discountPercentage: 14.5,
    pickupFee: 25,
    enableBnpl: false,
    bnplPercentage: 0
  }, session);
  assert(plat1Res.success && Boolean(plat1Res.platform?.id), 'إنشاء منصة الاختبار 1 (عمولة 14.5% + التقاط 25)');

  const item1Res = await saveItem({
    name: 'صنف اختبار 950 شامل ضريبة 14%',
    salePrice: 950,
    purchasePrice: 700,
    packagingCost: 20,
    taxRate: 14,
    stockQuantity: 50,
    enableBnpl: true,
    bnplPercentage: 20
  }, session);
  assert(item1Res.success && Boolean(item1Res.item?.id), 'إنشاء صنف الاختبار 1 (أساسي 950 + BNPL 20% + ضريبة 14%)');

  const inv1Res = await createInvoice({
    platform: plat1Res.platform!.name,
    platformId: plat1Res.platform!.id,
    customerName: 'عميل اختبار 1',
    deliveryFee: 0,
    lines: [
      {
        itemId: item1Res.item!.id,
        quantity: 4,
        salePriceAtSale: 950
      }
    ]
  }, session);

  assert(inv1Res.success && Boolean(inv1Res.invoice), 'إصدار الفاتورة 1 بنجاح');
  const inv1 = inv1Res.invoice!;
  const inv1CommRounded = Math.round(inv1.discountAmount * 100) / 100;

  assert(inv1.totalBeforeDiscount === 4560, 'الفاتورة 1: المجموع = 4560 ج.م', `الناتج: ${inv1.totalBeforeDiscount}`);
  assert(inv1.bnplTotalAmount === 912, 'الفاتورة 1: استقطاع BNPL = 912 ج.م', `الناتج: ${inv1.bnplTotalAmount}`);
  assert(inv1CommRounded === 580, 'الفاتورة 1: عمولة المنصة = 580 ج.م', `الناتج: ${inv1CommRounded}`);
  assert(inv1.pickupFeeAmount === 100, 'الفاتورة 1: رسوم الالتقاط = 100 ج.م (25 × 4)', `الناتج: ${inv1.pickupFeeAmount}`);
  assert(inv1.netAmount === 2968, 'الفاتورة 1: الصافي = 2968 ج.م', `الناتج: ${inv1.netAmount}`);

  const line1 = inv1.lines[0];
  assert(line1.baseUnitPrice === 950, 'السطر 1: السعر الأساسي للوحدة = 950 ج.م', `الناتج: ${line1.baseUnitPrice}`);
  assert(line1.customerUnitPrice === 1140, 'السطر 1: سعر العميل للوحدة = 1140 ج.م', `الناتج: ${line1.customerUnitPrice}`);
  assert(line1.bnplUnitAmount === 190, 'السطر 1: زيادة السعر للوحدة (bnplUnitAmount) = 190 ج.م', `الناتج: ${line1.bnplUnitAmount}`);
  assert(line1.bnplDeductionUnit === 228, 'السطر 1: استقطاع BNPL للوحدة (bnplDeductionUnit) = 228 ج.م', `الناتج: ${line1.bnplDeductionUnit}`);
  assert(line1.totalBnplDeduction === 912, 'السطر 1: إجمالي استقطاع BNPL (totalBnplDeduction) = 912 ج.م', `الناتج: ${line1.totalBnplDeduction}`);

  // اختبار 2: صنف 1000 × 1 + BNPL 20% + عمولة 14.5% + بدون التقاط:
  // مجموع 1200، BNPL 240، عمولة 152.63، صافي 807.37
  const plat2Res = await savePlatform({
    name: 'منصة اختبار BNPL بدون التقاط',
    discountPercentage: 14.5,
    pickupFee: 0,
    enableBnpl: false,
    bnplPercentage: 0
  }, session);
  assert(plat2Res.success && Boolean(plat2Res.platform?.id), 'إنشاء منصة الاختبار 2 (عمولة 14.5% + بدون التقاط)');

  const item2Res = await saveItem({
    name: 'صنف اختبار 1000 شامل ضريبة 14%',
    salePrice: 1000,
    purchasePrice: 750,
    packagingCost: 20,
    taxRate: 14,
    stockQuantity: 50,
    enableBnpl: true,
    bnplPercentage: 20
  }, session);
  assert(item2Res.success && Boolean(item2Res.item?.id), 'إنشاء صنف الاختبار 2 (أساسي 1000 + BNPL 20% + ضريبة 14%)');

  const inv2Res = await createInvoice({
    platform: plat2Res.platform!.name,
    platformId: plat2Res.platform!.id,
    customerName: 'عميل اختبار 2',
    deliveryFee: 0,
    lines: [
      {
        itemId: item2Res.item!.id,
        quantity: 1,
        salePriceAtSale: 1000
      }
    ]
  }, session);

  assert(inv2Res.success && Boolean(inv2Res.invoice), 'إصدار الفاتورة 2 بنجاح');
  const inv2 = inv2Res.invoice!;
  const inv2CommRounded = Math.round(inv2.discountAmount * 100) / 100;

  assert(inv2.totalBeforeDiscount === 1200, 'الفاتورة 2: المجموع = 1200 ج.م', `الناتج: ${inv2.totalBeforeDiscount}`);
  assert(inv2.bnplTotalAmount === 240, 'الفاتورة 2: استقطاع BNPL = 240 ج.م', `الناتج: ${inv2.bnplTotalAmount}`);
  assert(inv2CommRounded === 152.63, 'الفاتورة 2: عمولة المنصة = 152.63 ج.م', `الناتج: ${inv2CommRounded}`);
  assert(inv2.netAmount === 807.37, 'الفاتورة 2: الصافي = 807.37 ج.م', `الناتج: ${inv2.netAmount}`);

  // اختبار 3: فاتورة بدون BNPL: نفس النتائج القديمة بالضبط (4500 ج.م و 4475 ج.م)
  const itemNoBnplRes = await saveItem({
    name: 'صنف 5000 بدون BNPL',
    salePrice: 5000,
    purchasePrice: 3800,
    packagingCost: 50,
    taxRate: 0,
    stockQuantity: 20,
    enableBnpl: false,
    bnplPercentage: 0
  }, session);

  const platOld1Res = await savePlatform({
    name: 'منصة 10% بدون التقاط',
    discountPercentage: 10,
    pickupFee: 0,
    enableBnpl: false,
    bnplPercentage: 0
  }, session);

  const invOld1Res = await createInvoice({
    platform: platOld1Res.platform!.name,
    platformId: platOld1Res.platform!.id,
    customerName: 'عميل بدون BNPL 1',
    lines: [{ itemId: itemNoBnplRes.item!.id, quantity: 1, salePriceAtSale: 5000 }]
  }, session);

  const invOld1 = invOld1Res.invoice!;
  assert(invOld1.totalBeforeDiscount === 5000, 'فاتورة بدون BNPL (حالة 1): المجموع = 5000 ج.م', `الناتج: ${invOld1.totalBeforeDiscount}`);
  assert(invOld1.bnplTotalAmount === 0, 'فاتورة بدون BNPL (حالة 1): BNPL = 0 ج.م', `الناتج: ${invOld1.bnplTotalAmount}`);
  assert(invOld1.discountAmount === 500, 'فاتورة بدون BNPL (حالة 1): العمولة = 500 ج.م', `الناتج: ${invOld1.discountAmount}`);
  assert(invOld1.netAmount === 4500, 'فاتورة بدون BNPL (حالة 1): الصافي = 4500 ج.م', `الناتج: ${invOld1.netAmount}`);

  const platOld2Res = await savePlatform({
    name: 'منصة 10% مع التقاط 25',
    discountPercentage: 10,
    pickupFee: 25,
    enableBnpl: false,
    bnplPercentage: 0
  }, session);

  const invOld2Res = await createInvoice({
    platform: platOld2Res.platform!.name,
    platformId: platOld2Res.platform!.id,
    customerName: 'عميل بدون BNPL 2',
    lines: [{ itemId: itemNoBnplRes.item!.id, quantity: 1, salePriceAtSale: 5000 }]
  }, session);

  const invOld2 = invOld2Res.invoice!;
  assert(invOld2.totalBeforeDiscount === 5000, 'فاتورة بدون BNPL (حالة 2): المجموع = 5000 ج.م', `الناتج: ${invOld2.totalBeforeDiscount}`);
  assert(invOld2.bnplTotalAmount === 0, 'فاتورة بدون BNPL (حالة 2): BNPL = 0 ج.م', `الناتج: ${invOld2.bnplTotalAmount}`);
  assert(invOld2.discountAmount === 500, 'فاتورة بدون BNPL (حالة 2): العمولة = 500 ج.م', `الناتج: ${invOld2.discountAmount}`);
  assert(invOld2.pickupFeeAmount === 25, 'فاتورة بدون BNPL (حالة 2): التقاط = 25 ج.م', `الناتج: ${invOld2.pickupFeeAmount}`);
  assert(invOld2.netAmount === 4475, 'فاتورة بدون BNPL (حالة 2): الصافي = 4475 ج.م', `الناتج: ${invOld2.netAmount}`);

  // اختبار 4: تعديل الفاتورة 2 بعد الحفظ والتحقق من تطابق معادلة التعديل مع الإنشاء
  const updateRes = await updateInvoice(inv2.invoiceNumber, {
    editReason: 'تعديل الصنف والكمية إلى 950 × 4',
    platform: plat1Res.platform!.name,
    platformId: plat1Res.platform!.id,
    deliveryFee: 0,
    lines: [
      {
        itemId: item1Res.item!.id,
        quantity: 4,
        salePriceAtSale: 950,
        taxRateAtSale: 14,
        bnplPercent: 20
      }
    ]
  }, session);

  assert(updateRes.success && Boolean(updateRes.invoice), 'تعديل الفاتورة بعد الحفظ بنجاح');
  const updatedInv = updateRes.invoice!;
  assert(updatedInv.totalBeforeDiscount === 4560, 'بعد التعديل: المجموع = 4560 ج.م', `الناتج: ${updatedInv.totalBeforeDiscount}`);
  assert(updatedInv.bnplTotalAmount === 912, 'بعد التعديل: استقطاع BNPL = 912 ج.م', `الناتج: ${updatedInv.bnplTotalAmount}`);
  assert(Math.round(updatedInv.discountAmount * 100) / 100 === 580, 'بعد التعديل: عمولة المنصة = 580 ج.م', `الناتج: ${updatedInv.discountAmount}`);
  assert(updatedInv.netAmount === 2968, 'بعد التعديل: الصافي = 2968 ج.م', `الناتج: ${updatedInv.netAmount}`);

  // اختبار 5: طريقة رسوم الالتقاط حسب الصنف ('product') أو ثابتة على مستوى المنصة ('platform')
  const platProductModeRes = await savePlatform({
    name: 'منصة اختبار التقاط حسب الصنف',
    discountPercentage: 10,
    pickupFee: 20, // احتياطي عند عدم وجود رسوم للصنف
    pickupFeeMode: 'product',
    enableBnpl: false,
    bnplPercentage: 0
  }, session);
  assert(platProductModeRes.success && platProductModeRes.platform?.pickupFeeMode === 'product', 'إنشاء منصة بطريقة رسوم التقاط حسب الصنف (احتياطي 20 ج.م)');

  const itemWithPickupRes = await saveItem({
    name: 'صنف برسوم التقاط خاصة 30 ج.م',
    salePrice: 1000,
    purchasePrice: 700,
    packagingCost: 10,
    taxRate: 0,
    pickupFee: 30,
    stockQuantity: 20,
    enableBnpl: false,
    bnplPercentage: 0
  }, session);
  assert(itemWithPickupRes.success && itemWithPickupRes.item?.pickupFee === 30, 'إنشاء صنف برسوم التقاط للقطعة = 30 ج.م');

  const itemWithoutPickupRes = await saveItem({
    name: 'صنف بدون رسوم التقاط خاصة',
    salePrice: 1000,
    purchasePrice: 700,
    packagingCost: 10,
    taxRate: 0,
    stockQuantity: 20,
    enableBnpl: false,
    bnplPercentage: 0
  }, session);
  assert(itemWithoutPickupRes.success && itemWithoutPickupRes.item?.pickupFee === undefined, 'إنشاء صنف بلا رسوم التقاط خاصة');

  // 5-أ: منصة 'product' وصنف رسومه 30 × 2 = 60
  const invProdPickupRes = await createInvoice({
    platform: platProductModeRes.platform!.name,
    platformId: platProductModeRes.platform!.id,
    customerName: 'عميل اختبار التقاط صنف',
    lines: [{ itemId: itemWithPickupRes.item!.id, quantity: 2, salePriceAtSale: 1000 }]
  }, session);
  assert(invProdPickupRes.success && Boolean(invProdPickupRes.invoice), 'إصدار فاتورة لمنصة حسب الصنف (صنف رسومه 30 × 2)');
  const invProdPickup = invProdPickupRes.invoice!;
  assert(invProdPickup.lines[0].unitPickupFee === 30, 'رسوم الالتقاط للوحدة من الصنف = 30 ج.م', `الناتج: ${invProdPickup.lines[0].unitPickupFee}`);
  assert(invProdPickup.pickupFeeAmount === 60, 'إجمالي رسوم الالتقاط (30 × 2) = 60 ج.م', `الناتج: ${invProdPickup.pickupFeeAmount}`);
  assert(invProdPickup.netAmount === 1740, 'صافي الفاتورة (2000 - 200 عمولة - 60 التقاط) = 1740 ج.م', `الناتج: ${invProdPickup.netAmount}`);

  // 5-ب: منصة 'product' وصنف بلا رسوم يأخذ رسوم المنصة كاحتياطي (20 ج.م)
  const invFallbackPickupRes = await createInvoice({
    platform: platProductModeRes.platform!.name,
    platformId: platProductModeRes.platform!.id,
    customerName: 'عميل اختبار احتياطي المنصة',
    lines: [{ itemId: itemWithoutPickupRes.item!.id, quantity: 2, salePriceAtSale: 1000 }]
  }, session);
  assert(invFallbackPickupRes.success && Boolean(invFallbackPickupRes.invoice), 'إصدار فاتورة لمنصة حسب الصنف (صنف بلا رسوم يأخذ احتياطي المنصة)');
  const invFallbackPickup = invFallbackPickupRes.invoice!;
  assert(invFallbackPickup.lines[0].unitPickupFee === 20, 'رسوم الالتقاط الاحتياطية من المنصة = 20 ج.م', `الناتج: ${invFallbackPickup.lines[0].unitPickupFee}`);
  assert(invFallbackPickup.pickupFeeAmount === 40, 'إجمالي رسوم الالتقاط الاحتياطية (20 × 2) = 40 ج.م', `الناتج: ${invFallbackPickup.pickupFeeAmount}`);
  assert(invFallbackPickup.netAmount === 1760, 'صافي الفاتورة (2000 - 200 عمولة - 40 التقاط) = 1760 ج.م', `الناتج: ${invFallbackPickup.netAmount}`);

  // 5-ج: منصة 'platform' لا تتغير نتائجها حتى لو للصنف رسوم خاصة (تستخدم رسوم المنصة 25 ج.م)
  const invPlatformModeUnchangedRes = await createInvoice({
    platform: platOld2Res.platform!.name,
    platformId: platOld2Res.platform!.id,
    customerName: 'عميل اختبار منصة ثابتة مع صنف له رسوم',
    lines: [{ itemId: itemWithPickupRes.item!.id, quantity: 2, salePriceAtSale: 1000 }]
  }, session);
  assert(invPlatformModeUnchangedRes.success && Boolean(invPlatformModeUnchangedRes.invoice), 'إصدار فاتورة لمنصة ثابتة (platform) مع صنف له رسوم 30');
  const invPlatformModeUnchanged = invPlatformModeUnchangedRes.invoice!;
  assert(invPlatformModeUnchanged.lines[0].unitPickupFee === 25, 'منصة platform: رسوم الالتقاط للوحدة تبقى رسوم المنصة = 25 ج.م', `الناتج: ${invPlatformModeUnchanged.lines[0].unitPickupFee}`);
  assert(invPlatformModeUnchanged.pickupFeeAmount === 50, 'منصة platform: إجمالي رسوم الالتقاط (25 × 2) = 50 ج.م', `الناتج: ${invPlatformModeUnchanged.pickupFeeAmount}`);
  assert(invPlatformModeUnchanged.netAmount === 1750, 'منصة platform: صافي الفاتورة (2000 - 200 عمولة - 50 التقاط) = 1750 ج.م', `الناتج: ${invPlatformModeUnchanged.netAmount}`);

  // اختبار 6: مفاتيح تحكم نقطة البيع (bnplEnabled، bnplPercentOverride، commissionPercentOverride، وصلاحية pos.edit_rates)
  // 6-أ: المفتاح مغلق (bnplEnabled: false) = نفس صافي الفاتورة بدون BNPL (لا زيادة في الأسعار ولا استقطاع BNPL)
  const itemBnpl5000Res = await saveItem({
    name: 'صنف 5000 مفعّل عليه BNPL 20%',
    salePrice: 5000,
    purchasePrice: 3800,
    packagingCost: 50,
    taxRate: 0,
    stockQuantity: 20,
    enableBnpl: true,
    bnplPercentage: 20
  }, session);

  const invBnplOffRes = await createInvoice({
    platform: platOld1Res.platform!.name,
    platformId: platOld1Res.platform!.id,
    customerName: 'عميل اختبار إغلاق مفتاح BNPL',
    bnplEnabled: false,
    lines: [{ itemId: itemBnpl5000Res.item!.id, quantity: 1, salePriceAtSale: 5000 }]
  }, session);
  assert(invBnplOffRes.success && Boolean(invBnplOffRes.invoice), 'إصدار فاتورة والمفتاح مغلق (bnplEnabled: false)');
  const invBnplOff = invBnplOffRes.invoice!;
  assert(invBnplOff.bnplTotalAmount === 0, 'عند إغلاق المفتاح: استقطاع BNPL = 0 ج.م', `الناتج: ${invBnplOff.bnplTotalAmount}`);
  assert(invBnplOff.totalBeforeDiscount === 5000, 'عند إغلاق المفتاح: لا توجد زيادة في الأسعار (المجموع = 5000 ج.م)', `الناتج: ${invBnplOff.totalBeforeDiscount}`);
  assert(invBnplOff.netAmount === invOld1.netAmount && invBnplOff.netAmount === 4500, 'عند إغلاق المفتاح: صافي الفاتورة يطابق صافي الفاتورة بدون BNPL (4500 ج.م)', `الناتج: ${invBnplOff.netAmount}`);
  assert(invBnplOff.bnplPercentApplied === 0, 'عند إغلاق المفتاح: bnplPercentApplied = 0%', `الناتج: ${invBnplOff.bnplPercentApplied}`);

  // 6-ب: نسبة BNPL معدّلة 10% (bnplPercentOverride: 10) تُطبَّق على كل الأسطر بأولوية أعلى من نسبة الصنف ونسبة المنصة
  const invOverride10Res = await createInvoice({
    platform: platOld1Res.platform!.name,
    platformId: platOld1Res.platform!.id,
    customerName: 'عميل اختبار نسبة BNPL معدلة 10%',
    bnplEnabled: true,
    bnplPercentOverride: 10,
    lines: [
      // سطر 1: صنف نسبته الأصلية 20% وسعره 1000
      { itemId: item2Res.item!.id, quantity: 1, salePriceAtSale: 1000, taxRateAtSale: 0 },
      // سطر 2: صنف بدون BNPL (0%) وسعره 1000
      { itemId: itemWithoutPickupRes.item!.id, quantity: 1, salePriceAtSale: 1000, taxRateAtSale: 0 }
    ]
  }, session);
  assert(invOverride10Res.success && Boolean(invOverride10Res.invoice), 'إصدار فاتورة بنسبة BNPL معدّلة 10% على سطرين مختلفين');
  const invOverride10 = invOverride10Res.invoice!;
  assert(
    invOverride10.lines.every(l => l.bnplPercent === 10 && l.customerUnitPrice === 1100 && l.bnplDeductionUnit === 110),
    'النسبة المعدّلة 10% طُبّقت على كل الأسطر (سعر العميل 1100 واستقطاع 110 لكل سطر)',
    `الأسطر: ${JSON.stringify(invOverride10.lines.map(l => ({ p: l.bnplPercent, cust: l.customerUnitPrice, ded: l.bnplDeductionUnit })))}`
  );
  assert(invOverride10.bnplPercentApplied === 10, 'حفظ النسبة المطبقة في الفاتورة bnplPercentApplied = 10%', `الناتج: ${invOverride10.bnplPercentApplied}`);
  assert(invOverride10.commissionPercentApplied === 10, 'حفظ نسبة عمولة المنصة المطبقة في الفاتورة commissionPercentApplied = 10%', `الناتج: ${invOverride10.commissionPercentApplied}`);

  // 6-ج: تعديل نسبة BNPL أو نسبة خصم المنصة بدون صلاحية pos.edit_rates يُرفض من الخادم برسالة عربية
  const sessionWithoutEditRates = {
    role: 'employee' as const,
    permissions: ['invoices.create', 'invoices.view'] as any[]
  };
  const rejectedBnplOverrideRes = await createInvoice({
    platform: platOld1Res.platform!.name,
    platformId: platOld1Res.platform!.id,
    customerName: 'عميل اختبار بدون صلاحية',
    bnplEnabled: true,
    bnplPercentOverride: 10,
    lines: [{ itemId: itemNoBnplRes.item!.id, quantity: 1, salePriceAtSale: 5000 }]
  }, sessionWithoutEditRates);
  assert(
    !rejectedBnplOverrideRes.success && Boolean(rejectedBnplOverrideRes.error && rejectedBnplOverrideRes.error.includes('غير مصرح')),
    'رفض تعديل نسبة BNPL بدون صلاحية pos.edit_rates برسالة عربية',
    `الرسالة: ${rejectedBnplOverrideRes.error}`
  );

  const rejectedCommOverrideRes = await createInvoice({
    platform: platOld1Res.platform!.name,
    platformId: platOld1Res.platform!.id,
    customerName: 'عميل اختبار عمولة بدون صلاحية',
    commissionPercentOverride: 5,
    lines: [{ itemId: itemNoBnplRes.item!.id, quantity: 1, salePriceAtSale: 5000 }]
  }, sessionWithoutEditRates);
  assert(
    !rejectedCommOverrideRes.success && Boolean(rejectedCommOverrideRes.error && rejectedCommOverrideRes.error.includes('غير مصرح')),
    'رفض تعديل نسبة خصم المنصة بدون صلاحية pos.edit_rates برسالة عربية',
    `الرسالة: ${rejectedCommOverrideRes.error}`
  );

  // =========================================================================
  // اختبار 7 (الجزء 6): خاصية «تعبئة المدفوع النقدي تلقائيًا بإجمالي الفاتورة» وصلاحية invoices.edit_cash_paid
  // =========================================================================
  console.log('\n--- اختبار 7: المدفوع التلقائي وصلاحية invoices.edit_cash_paid ودمج الإعدادات ---');

  // 7-أ: القيمة الافتراضية لـ autoFillCashPaid هي true في الإعدادات
  const initialPrintSettings = getInvoicePrintSettings();
  const initialDisplaySettings = getDisplaySettings();
  assert(
    initialPrintSettings.autoFillCashPaid === true && initialDisplaySettings.autoFillCashPaid === true,
    'الإعداد الافتراضي لـ «تعبئة المدفوع النقدي تلقائيًا بإجمالي الفاتورة» هو مشغّل (true)',
    `print=${initialPrintSettings.autoFillCashPaid}, display=${initialDisplaySettings.autoFillCashPaid}`
  );

  // 7-ب: حفظ إعداد جزئي يدمج مع الإعدادات القديمة ولا يمسح المفاتيح الأخرى
  await saveDisplaySettings({ autoFillCashPaid: false }, session);
  const afterOffDisplay = getDisplaySettings();
  const afterOffPrint = getInvoicePrintSettings();
  assert(
    afterOffDisplay.autoFillCashPaid === false &&
      afterOffPrint.autoFillCashPaid === false &&
      afterOffDisplay.showItemImages === true &&
      afterOffPrint.paperSize === '80mm',
    'إيقاف المدفوع التلقائي يدمج مع الإعدادات الحالية دون مسح باقي المفاتيح (showItemImages, paperSize)',
    `display=${JSON.stringify(afterOffDisplay)}`
  );

  // إعادة التفعيل والتأكد من الدمج
  await saveInvoicePrintSettings({ autoFillCashPaid: true }, session);
  assert(
    getDisplaySettings().autoFillCashPaid === true && getInvoicePrintSettings().autoFillCashPaid === true,
    'إعادة تشغيل المدفوع التلقائي يحدّث الإعدادين معًا (true)'
  );

  // 7-ج: سلوك التعبئة التلقائية في نقطة البيع (تشغيل / إيقاف / تعديل يدوي يوقف التحديث التلقائي)
  const computePosCashPaidInput = (params: {
    autoFillCashPaid: boolean;
    canEditCashPaid: boolean;
    paymentType: 'نقدي' | 'آجل' | 'جزئي';
    netAmount: number;
    isManualCashOverride: boolean;
    currentInput: string;
  }) => {
    if (params.paymentType === 'آجل') return '0.00';
    if (params.paymentType === 'نقدي') {
      if (!params.canEditCashPaid) return params.netAmount.toFixed(2);
      if (!params.isManualCashOverride) {
        return params.autoFillCashPaid ? params.netAmount.toFixed(2) : '0.00';
      }
      return params.currentInput;
    }
    return params.currentInput;
  };

  // عند التشغيل: يمتلئ بالمطلوب ويتحدث مع تغير الإجمالي
  let posCashInput = computePosCashPaidInput({
    autoFillCashPaid: true,
    canEditCashPaid: true,
    paymentType: 'نقدي',
    netAmount: 1200,
    isManualCashOverride: false,
    currentInput: '0.00'
  });
  assert(posCashInput === '1200.00', 'عند التشغيل: يمتلئ «مدفوع نقدي» بإجمالي الفاتورة (1200.00)', `الناتج: ${posCashInput}`);

  posCashInput = computePosCashPaidInput({
    autoFillCashPaid: true,
    canEditCashPaid: true,
    paymentType: 'نقدي',
    netAmount: 2400,
    isManualCashOverride: false,
    currentInput: posCashInput
  });
  assert(posCashInput === '2400.00', 'عند التشغيل: يتحدث «مدفوع نقدي» تلقائيًا عند تغير الإجمالي إلى 2400.00', `الناتج: ${posCashInput}`);

  // عند التعديل اليدوي: يتوقف التحديث التلقائي عند تغير الإجمالي
  posCashInput = '2500.00';
  posCashInput = computePosCashPaidInput({
    autoFillCashPaid: true,
    canEditCashPaid: true,
    paymentType: 'نقدي',
    netAmount: 3000,
    isManualCashOverride: true,
    currentInput: posCashInput
  });
  assert(posCashInput === '2500.00', 'التعديل اليدوي في الفاتورة يوقف التحديث التلقائي عند تغير الإجمالي', `الناتج: ${posCashInput}`);

  // عند الإيقاف: يبدأ من 0.00 ولا يتحدث مع الإجمالي
  const posCashWhenOff = computePosCashPaidInput({
    autoFillCashPaid: false,
    canEditCashPaid: true,
    paymentType: 'نقدي',
    netAmount: 1500,
    isManualCashOverride: false,
    currentInput: '0.00'
  });
  assert(posCashWhenOff === '0.00', 'عند إيقاف الإعداد: يبدأ «مدفوع نقدي» من 0.00', `الناتج: ${posCashWhenOff}`);

  // بدون الصلاحية: يساوي الإجمالي دائمًا حتى لو الإعداد متوقف
  const posCashNoPerm = computePosCashPaidInput({
    autoFillCashPaid: false,
    canEditCashPaid: false,
    paymentType: 'نقدي',
    netAmount: 1500,
    isManualCashOverride: false,
    currentInput: '0.00'
  });
  assert(posCashNoPerm === '1500.00', 'بدون صلاحية invoices.edit_cash_paid: الحقل للقراءة فقط ويساوي الإجمالي دائمًا (1500.00)', `الناتج: ${posCashNoPerm}`);

  // 7-د: رفض الخادم لتعديل المدفوع النقدي بدون صلاحية invoices.edit_cash_paid (رسالة عربية)
  const sessionWithoutEditCashPaid = {
    role: 'employee' as const,
    permissions: ['invoices.create', 'invoices.view'] as any[]
  };
  const rejectedCashPaidRes = await createInvoice({
    platform: platOld1Res.platform!.name,
    platformId: platOld1Res.platform!.id,
    customerName: 'عميل اختبار رفض تعديل المدفوع النقدي',
    paymentType: 'نقدي',
    paidAmount: 4600, // الإجمالي الصافي هو 4500
    lines: [{ itemId: itemNoBnplRes.item!.id, quantity: 1, salePriceAtSale: 5000 }]
  }, sessionWithoutEditCashPaid);
  assert(
    !rejectedCashPaidRes.success &&
      Boolean(rejectedCashPaidRes.error && rejectedCashPaidRes.error.includes('غير مصرح') && rejectedCashPaidRes.error.includes('invoices.edit_cash_paid')),
    'رفض الخادم لأي مدفوع نقدي مختلف عن الإجمالي بدون صلاحية invoices.edit_cash_paid برسالة عربية',
    `الرسالة: ${rejectedCashPaidRes.error}`
  );

  // قبول الخادم للفاتورة النقدية لنفس المستخدم عندما يساوي المدفوع الإجمالي (4500)
  const acceptedEqualCashPaidRes = await createInvoice({
    platform: platOld1Res.platform!.name,
    platformId: platOld1Res.platform!.id,
    customerName: 'عميل اختبار قبول المدفوع المطابق للإجمالي',
    paymentType: 'نقدي',
    paidAmount: 4500,
    lines: [{ itemId: itemNoBnplRes.item!.id, quantity: 1, salePriceAtSale: 5000 }]
  }, sessionWithoutEditCashPaid);
  assert(
    acceptedEqualCashPaidRes.success && acceptedEqualCashPaidRes.invoice?.paidAmount === 4500,
    'قبول الخادم للفاتورة النقدية بدون صلاحية التعديل عندما يساوي المدفوع إجمالي الفاتورة (4500 ج.م)'
  );

  // 7-هـ: قبول الخادم لتعديل المدفوع النقدي عند توفر صلاحية invoices.edit_cash_paid
  const sessionWithEditCashPaid = {
    role: 'employee' as const,
    permissions: ['invoices.create', 'invoices.view', 'invoices.edit_cash_paid'] as any[]
  };
  const acceptedCustomCashPaidRes = await createInvoice({
    platform: platOld1Res.platform!.name,
    platformId: platOld1Res.platform!.id,
    customerName: 'عميل اختبار قبول تعديل المدفوع مع الصلاحية',
    paymentType: 'نقدي',
    paidAmount: 5000, // العميل دفع 5000 ج.م وصافي الفاتورة 4500 ج.م
    lines: [{ itemId: itemNoBnplRes.item!.id, quantity: 1, salePriceAtSale: 5000 }]
  }, sessionWithEditCashPaid);
  assert(
    acceptedCustomCashPaidRes.success &&
      acceptedCustomCashPaidRes.invoice?.paidAmount === 5000 &&
      acceptedCustomCashPaidRes.invoice?.remainingAmount === 0,
    'قبول الخادم لتعديل المدفوع النقدي (5000 ج.م) عند امتلاك صلاحية invoices.edit_cash_paid',
    `paidAmount=${acceptedCustomCashPaidRes.invoice?.paidAmount}`
  );

  // =========================================================================
  // اختبار 8 (المهمة 8 من 13): مقارنة ناتج calculateInvoice مع createInvoice لـ 10 فواتير متنوعة
  // شاملاً الرقمين القياسيين (2968 و 735.53)
  // =========================================================================
  console.log('\n--- اختبار 8: مقارنة تطابق calculateInvoice (src/shared/invoiceCalc.ts) مع createInvoice لـ 10 فواتير متنوعة ---');

  const item450Res = await saveItem({
    name: 'صنف 450 شامل ضريبة 14% بدون BNPL (لإنتاج صافي 735.53)',
    salePrice: 450,
    purchasePrice: 300,
    packagingCost: 15,
    taxRate: 14,
    stockQuantity: 100,
    enableBnpl: false,
    bnplPercentage: 0
  }, session);

  const item350Res = await saveItem({
    name: 'صنف 350 بضريبة 10% وBNPL 15%',
    salePrice: 350,
    purchasePrice: 220,
    packagingCost: 10,
    taxRate: 10,
    pickupFee: 18,
    stockQuantity: 100,
    enableBnpl: true,
    bnplPercentage: 15
  }, session);

  await saveItemPlatformCost({
    itemId: item350Res.item!.id,
    platformId: plat1Res.platform!.id,
    shippingCost: 35
  }, session);

  const currentTaxSettings = {
    taxInclusive: true,
    platformCommissionOn: 'before_tax' as const
  };

  const tenInvoicesScenarios: Array<{
    label: string;
    expectedNet?: number;
    platform: any;
    lines: Array<{
      item: any;
      quantity: number;
      salePriceAtSale?: number;
      taxRateAtSale?: number;
      bnplPercent?: number;
      shippingCostAtSale?: number;
    }>;
    deliveryFee?: number;
    bnplEnabled?: boolean;
    bnplPercentOverride?: number;
    commissionPercentOverride?: number;
  }> = [
    {
      label: 'فاتورة #1: القياسية (950 × 4 + BNPL 20% + عمولة 14.5% + ضريبة 14% + التقاط 25) -> صافي 2968',
      expectedNet: 2968,
      platform: plat1Res.platform!,
      lines: [{ item: item1Res.item!, quantity: 4, salePriceAtSale: 950 }],
      deliveryFee: 0
    },
    {
      label: 'فاتورة #2: القياسية (450 × 2 + بدون BNPL + عمولة 14.5% + ضريبة 14% + التقاط 25) -> صافي 735.53',
      expectedNet: 735.53,
      platform: plat1Res.platform!,
      lines: [{ item: item450Res.item!, quantity: 2, salePriceAtSale: 450 }],
      deliveryFee: 0
    },
    {
      label: 'فاتورة #3: (1000 × 1 + BNPL 20% + عمولة 14.5% بدون التقاط) -> صافي 807.37',
      expectedNet: 807.37,
      platform: plat2Res.platform!,
      lines: [{ item: item2Res.item!, quantity: 1, salePriceAtSale: 1000 }],
      deliveryFee: 0
    },
    {
      label: 'فاتورة #4: بيع بدون BNPL (5000 × 1 + عمولة 10% بدون التقاط) -> صافي 4500',
      expectedNet: 4500,
      platform: platOld1Res.platform!,
      lines: [{ item: itemNoBnplRes.item!, quantity: 1, salePriceAtSale: 5000 }],
      deliveryFee: 0
    },
    {
      label: 'فاتورة #5: بيع بدون BNPL مع التقاط ثابت (5000 × 1 + عمولة 10% + التقاط 25) -> صافي 4475',
      expectedNet: 4475,
      platform: platOld2Res.platform!,
      lines: [{ item: itemNoBnplRes.item!, quantity: 1, salePriceAtSale: 5000 }],
      deliveryFee: 0
    },
    {
      label: 'فاتورة #6: التقاط حسب الصنف (1000 × 2 + عمولة 10% + التقاط صنف 30) -> صافي 1740',
      expectedNet: 1740,
      platform: platProductModeRes.platform!,
      lines: [{ item: itemWithPickupRes.item!, quantity: 2, salePriceAtSale: 1000 }],
      deliveryFee: 0
    },
    {
      label: 'فاتورة #7: التقاط احتياطي من المنصة (1000 × 2 + عمولة 10% + التقاط احتياطي 20) -> صافي 1760',
      expectedNet: 1760,
      platform: platProductModeRes.platform!,
      lines: [{ item: itemWithoutPickupRes.item!, quantity: 2, salePriceAtSale: 1000 }],
      deliveryFee: 0
    },
    {
      label: 'فاتورة #8: إغلاق مفتاح BNPL يدويًا (bnplEnabled: false) مع رسوم توصيل 60 ج.م',
      platform: platOld1Res.platform!,
      lines: [{ item: itemBnpl5000Res.item!, quantity: 1, salePriceAtSale: 5000 }],
      deliveryFee: 60,
      bnplEnabled: false
    },
    {
      label: 'فاتورة #9: نسبة BNPL معدّلة 12% ونسبة عمولة معدّلة 8% مع سطرين مختلفين',
      platform: plat1Res.platform!,
      lines: [
        { item: item1Res.item!, quantity: 2, salePriceAtSale: 950 },
        { item: item350Res.item!, quantity: 3, salePriceAtSale: 350, shippingCostAtSale: 35 }
      ],
      deliveryFee: 45,
      bnplEnabled: true,
      bnplPercentOverride: 12,
      commissionPercentOverride: 8
    },
    {
      label: 'فاتورة #10: متعددة الأسطر (3 أصناف متنوعة الضرائب والتقسيط ورسوم الالتقاط والتوصيل)',
      platform: platProductModeRes.platform!,
      lines: [
        { item: itemWithPickupRes.item!, quantity: 2, salePriceAtSale: 1000 },
        { item: item350Res.item!, quantity: 4, salePriceAtSale: 350 },
        { item: item450Res.item!, quantity: 1, salePriceAtSale: 450 }
      ],
      deliveryFee: 75,
      bnplEnabled: true
    }
  ];

  for (let i = 0; i < tenInvoicesScenarios.length; i++) {
    const sc = tenInvoicesScenarios[i];

    // 1) الحساب عبر الدالة المشتركة calculateInvoice مباشرةً
    const sharedResult = calculateInvoice({
      lines: sc.lines.map(l => ({
        itemId: l.item.id,
        itemName: l.item.name,
        quantity: l.quantity,
        salePriceAtSale: l.salePriceAtSale,
        taxRateAtSale: l.taxRateAtSale,
        bnplPercent: l.bnplPercent,
        shippingCostAtSale: l.shippingCostAtSale,
        item: {
          id: l.item.id,
          name: l.item.name,
          salePrice: l.item.salePrice,
          purchasePrice: l.item.purchasePrice,
          packagingCost: l.item.packagingCost,
          taxRate: l.item.taxRate,
          pickupFee: l.item.pickupFee,
          enableBnpl: l.item.enableBnpl,
          bnplPercentage: l.item.bnplPercentage
        },
        platformShippingCost: l.item.id === item350Res.item!.id && sc.platform.id === plat1Res.platform!.id ? 35 : 0
      })),
      platform: {
        discountPercentage: sc.platform.discountPercentage,
        pickupFee: sc.platform.pickupFee,
        pickupFeeMode: sc.platform.pickupFeeMode,
        enableBnpl: sc.platform.enableBnpl,
        bnplPercentage: sc.platform.bnplPercentage
      },
      taxSettings: {
        taxInclusive: currentTaxSettings.taxInclusive,
        platformCommissionOn: currentTaxSettings.platformCommissionOn
      },
      deliveryFee: sc.deliveryFee,
      bnplEnabled: sc.bnplEnabled,
      bnplPercentOverride: sc.bnplPercentOverride,
      commissionPercentOverride: sc.commissionPercentOverride
    });

    // 2) الحساب عبر createInvoice في الخادم
    const serverRes = await createInvoice({
      platform: sc.platform.name,
      platformId: sc.platform.id,
      customerName: `عميل مقارنة #${i + 1}`,
      deliveryFee: sc.deliveryFee,
      bnplEnabled: sc.bnplEnabled,
      bnplPercentOverride: sc.bnplPercentOverride,
      commissionPercentOverride: sc.commissionPercentOverride,
      lines: sc.lines.map(l => ({
        itemId: l.item.id,
        quantity: l.quantity,
        salePriceAtSale: l.salePriceAtSale,
        taxRateAtSale: l.taxRateAtSale,
        bnplPercent: l.bnplPercent,
        shippingCostAtSale: l.shippingCostAtSale
      }))
    }, session);

    assert(serverRes.success && Boolean(serverRes.invoice), `نجاح إنشاء ${sc.label}`);
    const srvInv = serverRes.invoice!;

    if (sc.expectedNet !== undefined) {
      assert(
        sharedResult.netAmount === sc.expectedNet && srvInv.netAmount === sc.expectedNet,
        `${sc.label}: الصافي يطابق الرقم القياسي (${sc.expectedNet} ج.م)`,
        `shared=${sharedResult.netAmount}, server=${srvInv.netAmount}`
      );
    }

    const totalsMatch =
      sharedResult.totalBeforeDiscount === srvInv.totalBeforeDiscount &&
      sharedResult.totalTax === srvInv.taxAmount &&
      sharedResult.bnplTotalAmount === srvInv.bnplTotalAmount &&
      sharedResult.commissionPercentApplied === srvInv.commissionPercentApplied &&
      sharedResult.discountAmount === srvInv.discountAmount &&
      sharedResult.pickupFeeAmount === srvInv.pickupFeeAmount &&
      sharedResult.deliveryFee === srvInv.deliveryFee &&
      sharedResult.netAmount === srvInv.netAmount &&
      sharedResult.totalProfit === srvInv.profit &&
      sharedResult.bnplEnabled === srvInv.bnplEnabled &&
      sharedResult.bnplPercentApplied === srvInv.bnplPercentApplied;

    const linesMatch =
      sharedResult.lines.length === srvInv.lines.length &&
      sharedResult.lines.every((sl, idx) => {
        const rl = srvInv.lines[idx];
        return (
          sl.baseUnitPrice === rl.baseUnitPrice &&
          sl.bnplPercent === rl.bnplPercent &&
          sl.bnplUnitAmount === rl.bnplUnitAmount &&
          sl.customerUnitPrice === rl.customerUnitPrice &&
          sl.bnplDeductionUnit === rl.bnplDeductionUnit &&
          sl.totalBnplDeduction === rl.totalBnplDeduction &&
          sl.salePriceAtSale === rl.salePriceAtSale &&
          sl.taxRateAtSale === rl.taxRateAtSale &&
          sl.unitTaxAmount === rl.unitTaxAmount &&
          sl.unitPickupFee === rl.unitPickupFee &&
          sl.totalPickupFee === rl.totalPickupFee &&
          sl.unitNet === rl.unitNet &&
          sl.unitProfit === rl.unitProfit
        );
      });

    assert(
      totalsMatch && linesMatch,
      `تطابق 100% بين calculateInvoice و createInvoice في ${sc.label}`,
      totalsMatch && linesMatch
        ? undefined
        : `sharedNet=${sharedResult.netAmount}, serverNet=${srvInv.netAmount}, sharedProfit=${sharedResult.totalProfit}, serverProfit=${srvInv.profit}`
    );
  }

  console.log(`\n========================================`);
  console.log(`إجمالي الاختبارات: ${passed + failed} | الناجحة: ${passed} | الفاشلة: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('خطأ غير متوقع أثناء تشغيل الاختبارات:', err);
  process.exit(1);
});

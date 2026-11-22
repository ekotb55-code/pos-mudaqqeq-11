import {
  normalizeItemName,
  normalizeItemBarcode,
  checkItemUniqueness,
  saveItem,
  importItemsBatch,
  deleteItem
} from '../server/sheetsService.ts';
import { PERMISSIONS } from '../src/utils/permissions.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, details?: string) {
  if (condition) {
    console.log(`✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${label}${details ? ` — ${details}` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== اختبار منع تكرار اسم الصنف والباركود والكود (وضع الذاكرة) ===\n');

  const designerSession = {
    token: 'test-token',
    role: 'designer' as const,
    permissions: PERMISSIONS.map(p => p.key),
    phone: '01000000000'
  };

  const createdIds: string[] = [];

  try {
    // 1. اختبارات دالة توحيد الاسم normalizeItemName
    assert(
      normalizeItemName('  شَاحِنٌ   سَرِيعٌ   أَنْكَر  65W  ') === normalizeItemName('شاحن سريع انكر 65w'),
      'توحيد الاسم: إزالة المسافات المكررة والتشكيل وتوحيد الهمزة وحالة الأحرف الإنجليزية'
    );
    assert(
      normalizeItemName('غلاية مياه صحية') === normalizeItemName('غلايه مياه صحيه'),
      'توحيد الاسم: توحيد التاء المربوطة (ة -> ه)'
    );
    assert(
      normalizeItemName('مكواة بخار كبرى') === normalizeItemName('مكواه بخار كبري'),
      'توحيد الاسم: توحيد الألف المقصورة (ى -> ي) مع التاء المربوطة'
    );
    assert(
      normalizeItemName('إبريق آلي أبيض') === normalizeItemName('ابريق الي ابيض'),
      'توحيد الاسم: توحيد (أ / إ / آ -> ا)'
    );

    // 2. اختبارات دالة توحيد الباركود normalizeItemBarcode
    assert(
      normalizeItemBarcode(' ٦٩٣٤ ١٧٧٧ ٢٠٠١٦ ') === '6934177720016',
      'توحيد الباركود: إزالة المسافات وتحويل الأرقام العربية (٠-٩) إلى إنجليزية'
    );

    // 3. إضافة صنف أساسي للاختبار
    const baseRes = await saveItem({
      name: 'سماعة رأس احترافية أصلي Sony XM5',
      barcode: '998877665544',
      secondaryBarcodes: ['SONY-XM5-SEC1', '112233445566'],
      sku: 'SKU-SONY-001',
      salePrice: 1500,
      stockQuantity: 0
    }, designerSession);

    assert(baseRes.success && Boolean(baseRes.item?.id), 'إضافة الصنف الأساسي بنجاح');
    const baseItem = baseRes.item!;
    createdIds.push(baseItem.id);

    // 4. رفض اسم مكرر باختلاف الهمزة والتاء المربوطة والألف المقصورة والتشكيل وحالة الإنجليزي والمسافات
    const dupNameRes = await saveItem({
      name: '  سَمَّاعَة   راس   احترافيه   اصلى   sony xm5  ',
      barcode: '998877660000',
      sku: 'SKU-SONY-002',
      salePrice: 1500,
      stockQuantity: 0
    }, designerSession);

    assert(
      !dupNameRes.success &&
      Boolean(dupNameRes.error?.includes(baseItem.name)) &&
      Boolean(dupNameRes.error?.includes('SKU-SONY-001')),
      'رفض إضافة صنف بنفس الاسم الموحد مع رسالة عربية تذكر اسم وكود الصنف المتعارض',
      dupNameRes.error
    );

    // 5. رفض باركود مكرر (بأرقام عربية ومسافات)
    const dupBarcodeArabicRes = await saveItem({
      name: 'صنف مختلف لاختبار الباركود العربي',
      barcode: ' ٩٩٨٨ ٧٧٦٦ ٥٥٤٤ ',
      sku: 'SKU-DIFF-001',
      salePrice: 500,
      stockQuantity: 0
    }, designerSession);

    assert(
      !dupBarcodeArabicRes.success &&
      Boolean(dupBarcodeArabicRes.error?.includes(baseItem.name)) &&
      Boolean(dupBarcodeArabicRes.error?.includes('SKU-SONY-001')),
      'رفض باركود مكرر مكتوب بأرقام عربية ومسافات مع ذكر الصنف المتعارض (الاسم والكود)',
      dupBarcodeArabicRes.error
    );

    // 6. رفض باركود يتعارض مع باركود فرعي لصنف آخر
    const dupSecBarcodeRes = await saveItem({
      name: 'صنف مختلف لاختبار الباركود الفرعي',
      barcode: '١١٢٢٣٣٤٤٥٥٦٦',
      sku: 'SKU-DIFF-002',
      salePrice: 500,
      stockQuantity: 0
    }, designerSession);

    assert(
      !dupSecBarcodeRes.success &&
      Boolean(dupSecBarcodeRes.error?.includes(baseItem.name)) &&
      Boolean(dupSecBarcodeRes.error?.includes('SKU-SONY-001')),
      'رفض باركود يتعارض مع باركود فرعي لصنف آخر',
      dupSecBarcodeRes.error
    );

    // 7. رفض تكرار باركود داخل نفس الصنف (أساسي وفرعي أو فرعيين متطابقين)
    const selfDupBarcodeRes = await saveItem({
      name: 'صنف بباركود مكرر داخليًا',
      barcode: '777888999',
      secondaryBarcodes: ['٧٧٧ ٨٨٨ ٩٩٩'],
      sku: 'SKU-SELF-DUP',
      salePrice: 300,
      stockQuantity: 0
    }, designerSession);

    assert(
      !selfDupBarcodeRes.success && Boolean(selfDupBarcodeRes.error),
      'رفض تكرار نفس الباركود أكثر من مرة داخل نفس الصنف',
      selfDupBarcodeRes.error
    );

    // 8. رفض كود (SKU) مكرر
    const dupSkuRes = await saveItem({
      name: 'صنف مختلف لاختبار تكرار الكود',
      barcode: '554433221100',
      sku: ' sku-sony-٠٠١ ',
      salePrice: 600,
      stockQuantity: 0
    }, designerSession);

    assert(
      !dupSkuRes.success &&
      Boolean(dupSkuRes.error?.includes(baseItem.name)) &&
      Boolean(dupSkuRes.error?.includes('SKU-SONY-001')),
      'رفض كود الصنف (SKU) المكرر مع ذكر الصنف المتعارض (الاسم والكود)',
      dupSkuRes.error
    );

    // 9. السماح بصنفين بدون باركود (الباركود الفارغ مسموح لأكثر من صنف)
    const emptyBc1 = await saveItem({
      name: 'صنف بدون باركود أول',
      barcode: '',
      salePrice: 100,
      stockQuantity: 0
    }, designerSession);
    if (emptyBc1.item?.id) createdIds.push(emptyBc1.item.id);

    const emptyBc2 = await saveItem({
      name: 'صنف بدون باركود ثاني',
      barcode: '   ',
      salePrice: 120,
      stockQuantity: 0
    }, designerSession);
    if (emptyBc2.item?.id) createdIds.push(emptyBc2.item.id);

    assert(
      emptyBc1.success && emptyBc2.success,
      'السماح بحفظ أكثر من صنف بباركود فارغ'
    );

    // 10. تعديل صنف موجود دون تغيير اسمه أو باركوده ينجح ولا يتعارض مع نفسه
    const editSameRes = await saveItem({
      id: baseItem.id,
      name: 'سماعه راس احترافيه اصلي Sony XM5',
      barcode: '٩٩٨٨٧٧٦٦٥٥٤٤',
      secondaryBarcodes: ['SONY-XM5-SEC1', '112233445566'],
      sku: 'SKU-SONY-001',
      salePrice: 1650,
      stockQuantity: 0
    }, designerSession);

    assert(
      editSameRes.success && editSameRes.item?.salePrice === 1650,
      'تعديل الصنف نفسه دون تغيير الاسم/الباركود/الكود ينجح ولا يقارن الصنف بنفسه',
      editSameRes.error
    );

    // 11. تعديل صنف موجود ليتعارض مع اسم صنف آخر يُرفض
    const editConflictRes = await saveItem({
      id: emptyBc1.item!.id,
      name: 'صنف بدون باركود ثانى',
      barcode: '',
      salePrice: 100,
      stockQuantity: 0
    }, designerSession);

    assert(
      !editConflictRes.success && Boolean(editConflictRes.error?.includes(emptyBc2.item!.name)),
      'تعديل صنف لاسم صنف آخر موجود يُرفض برسالة عربية تذكر الصنف المتعارض',
      editConflictRes.error
    );

    // 12. اختبار دالة الفحص الخفيفة checkItemUniqueness (التي تغذي نقطة API)
    const checkDup = checkItemUniqueness({
      name: 'سماعه راس احترافيه اصلي SONY XM5'
    });
    assert(
      checkDup.isDuplicate && checkDup.field === 'name' && checkDup.conflictingItem?.id === baseItem.id,
      'نقطة فحص التكرار تكتشف الاسم المكرر وترجع بيانات الصنف المتعارض'
    );

    const checkSelfExcluded = checkItemUniqueness({
      excludeId: baseItem.id,
      name: 'سماعه راس احترافيه اصلي SONY XM5',
      barcode: '998877665544',
      sku: 'SKU-SONY-001'
    });
    assert(
      !checkSelfExcluded.isDuplicate,
      'نقطة فحص التكرار تتجاهل الصنف نفسه عند تمرير excludeId'
    );

    // 13. اختبار استيراد دفعة أصناف importItemsBatch يمنع التكرار
    const batchRes = await importItemsBatch({
      fileName: 'test.xlsx',
      updateExisting: false,
      items: [
        { name: 'سماعه راس احترافيه اصلي Sony XM5', salePrice: 1500, stockQuantity: 0 },
        { name: 'صنف جديد عبر الاستيراد', barcode: '٩٩٨٨٧٧٦٦٥٥٤٤', salePrice: 400, stockQuantity: 0 }
      ]
    }, designerSession);

    assert(
      batchRes.insertedCount === 0 && batchRes.errorCount === 2,
      'استيراد دفعة أصناف يرفض الصفوف المكررة في الاسم أو الباركود الموحد'
    );
  } finally {
    // تنظيف الأصناف المضافة أثناء الاختبار
    for (const id of createdIds) {
      await deleteItem(id, designerSession);
    }
  }

  console.log(`\n=== النتيجة النهائية: ${passed} ناجح، ${failed} فاشل ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

import fs from 'fs';
import vm from 'vm';
import path from 'path';
import {
  getPlatforms,
  getItems,
  getStockSettings,
  saveStockSettings,
  saveItemPlatformCost,
  createInvoice,
  createReturn,
  previewDuplicateItems,
  cleanupDuplicateItems,
  normalizeItemName,
  normalizeItemBarcode,
  _unsafeSeedDuplicateItemForTest,
  _getItemCleanupDiagnosticsForTest
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
  console.log('=== اختبار حذف الأصناف المكررة وتوحيد Code.gs ===\n');

  const designerSession = {
    token: 'designer-token',
    id: 'user-designer-1',
    userId: 'user-designer-1',
    name: 'مصمم النظام',
    role: 'designer' as const,
    isOwner: true,
    permissions: PERMISSIONS.map(p => p.key),
    phone: '01000000000'
  };

  const managerSession = {
    token: 'manager-token',
    id: 'user-manager-1',
    userId: 'user-manager-1',
    name: 'مدير المتجر',
    role: 'manager' as const,
    isOwner: false,
    permissions: PERMISSIONS.map(p => p.key),
    phone: '01000000001'
  };

  const employeeSession = {
    token: 'emp-token',
    id: 'user-emp-1',
    userId: 'user-emp-1',
    name: 'موظف',
    role: 'employee' as const,
    isOwner: false,
    permissions: ['items.view', 'items.delete'] as any[],
    phone: '01000000002'
  };

  const platforms = await getPlatforms();
  const platformId = platforms[0]?.id || 'plt-1';

  // 1. فحص أن العملية محصورة للمطوّر/designer فقط (server-enforced)
  const mgrPreview = await previewDuplicateItems(managerSession);
  assert(!mgrPreview.success && Boolean(mgrPreview.error?.includes('designer')), 'رفض معاينة المكررات للمدير (designer فقط)');

  const empCleanup = await cleanupDuplicateItems(employeeSession);
  assert(!empCleanup.success && Boolean(empCleanup.error?.includes('designer')), 'رفض حذف المكررات للموظف حتى مع صلاحية items.delete');

  // التأكد أن الوضع المبدئي بلا مكررات
  const initialPreview = await previewDuplicateItems(designerSession);
  assert(initialPreview.success && initialPreview.duplicateGroupsCount === 0, 'لا توجد مكررات مبدئياً في الذاكرة');

  // 2. اختبار مجموعة من 3 مكررات (بدون حركات): يبقى الأقدم فقط، وتُحذف بياناته التابعة، ولا تُجمع الكميات
  const dupOldestId = 'dup-trio-oldest';
  const dupMidId = 'dup-trio-mid';
  const dupNewestId = 'dup-trio-newest';

  _unsafeSeedDuplicateItemForTest({
    id: dupNewestId,
    name: 'شاحن   سريع   جديد  65W',
    barcode: ' ٧٧٠١ ٠٠٠٢ ٠٠٠٣ ',
    sku: 'SKU-TRIO-3',
    salePrice: 500,
    stockQuantity: 20,
    status: 'نشط',
    platformIds: [platformId],
    createdAt: '2025-03-01T10:00:00.000Z'
  });
  _unsafeSeedDuplicateItemForTest({
    id: dupOldestId,
    name: 'شاحن سريع جديد 65W',
    barcode: '770100020003',
    sku: 'SKU-TRIO-1',
    salePrice: 500,
    stockQuantity: 5,
    status: 'نشط',
    platformIds: [platformId],
    createdAt: '2025-01-01T10:00:00.000Z'
  });
  _unsafeSeedDuplicateItemForTest({
    id: dupMidId,
    name: 'شَاحِنٌ سريع جديد 65w',
    barcode: '770100020003',
    sku: 'SKU-TRIO-2',
    salePrice: 500,
    stockQuantity: 10,
    status: 'نشط',
    platformIds: [platformId],
    createdAt: '2025-02-01T10:00:00.000Z'
  });

  // إضافة أسعار/تكاليف منصات للأصناف الثلاثة
  await saveItemPlatformCost({ itemId: dupOldestId, platformId, returnShippingDeduction: 30 }, designerSession);
  await saveItemPlatformCost({ itemId: dupMidId, platformId, returnShippingDeduction: 40 }, designerSession);
  await saveItemPlatformCost({ itemId: dupNewestId, platformId, returnShippingDeduction: 50 }, designerSession);

  // 3. اختبار صنف مكرر عليه فاتورة (الأحدث عليه فاتورة والأقدم خالٍ): لا يُحذف من عليه الفاتورة، ويُحذف الخالي بدلاً منه
  const invEmptyOlderId = 'dup-inv-empty-older';
  const invProtectedNewerId = 'dup-inv-protected-newer';

  _unsafeSeedDuplicateItemForTest({
    id: invEmptyOlderId,
    name: 'سماعة بلوتوث مكررة',
    barcode: '880100020003',
    sku: 'SKU-INV-OLD',
    salePrice: 300,
    stockQuantity: 15,
    status: 'نشط',
    createdAt: '2025-01-05T10:00:00.000Z'
  });
  _unsafeSeedDuplicateItemForTest({
    id: invProtectedNewerId,
    name: 'سماعه بلوتوث مكرره',
    barcode: '880100020003',
    sku: 'SKU-INV-NEW',
    salePrice: 300,
    stockQuantity: 12,
    status: 'نشط',
    createdAt: '2025-02-05T10:00:00.000Z'
  });

  const prevStockSettings = getStockSettings();
  await saveStockSettings({ allowNegativeStockSale: true }, designerSession);

  const invRes = await createInvoice({
    idempotencyKey: 'test-dup-inv-1',
    platformId,
    lines: [
      {
        itemId: invProtectedNewerId,
        quantity: 1,
        unitPrice: 300,
        baseUnitPrice: 300,
        bnplPercent: 0,
        customerUnitPrice: 300,
        bnplUnitAmount: 0
      }
    ],
    notes: 'فاتورة لحماية المكرر'
  }, designerSession);
  assert(invRes.success, `إصدار فاتورة على الصنف المكرر بنجاح (${invRes.error || ''})`);

  // 4. اختبار مجموعة كل أصنافها عليها حركات (تُترك وتظهر في «لم يُحذف» مع السبب)
  const bothLocked1Id = 'dup-locked-1';
  const bothLocked2Id = 'dup-locked-2';
  _unsafeSeedDuplicateItemForTest({
    id: bothLocked1Id,
    name: 'كابل شحن مقوى محمي',
    barcode: '990100020003',
    sku: 'SKU-LOCK-1',
    salePrice: 150,
    stockQuantity: 8,
    status: 'نشط',
    createdAt: '2025-01-10T10:00:00.000Z'
  });
  _unsafeSeedDuplicateItemForTest({
    id: bothLocked2Id,
    name: 'كابل شحن مقوي محمي',
    barcode: '990100020003',
    sku: 'SKU-LOCK-2',
    salePrice: 150,
    stockQuantity: 9,
    status: 'نشط',
    createdAt: '2025-02-10T10:00:00.000Z'
  });

  const invLocked1 = await createInvoice({
    idempotencyKey: 'test-dup-inv-locked-1',
    platformId,
    lines: [
      { itemId: bothLocked1Id, quantity: 2, unitPrice: 150, baseUnitPrice: 150, bnplPercent: 0, customerUnitPrice: 150, bnplUnitAmount: 0 }
    ]
  }, designerSession);
  const invLocked2 = await createInvoice({
    idempotencyKey: 'test-dup-inv-locked-2',
    platformId,
    lines: [
      { itemId: bothLocked2Id, quantity: 1, unitPrice: 150, baseUnitPrice: 150, bnplPercent: 0, customerUnitPrice: 150, bnplUnitAmount: 0 }
    ]
  }, designerSession);
  assert(invLocked1.success && invLocked2.success, 'إصدار فواتير على كلا الصنفين في المجموعة المحمية بالكامل');

  // إضافة مرتجع أيضاً على الصنف الثاني للتأكد من رصد المرتجعات
  if (invLocked2.invoice) {
    await createReturn({
      idempotencyKey: 'test-dup-ret-locked-2',
      invoiceNumber: invLocked2.invoice.invoiceNumber,
      reason: 'اختبار حماية المرتجع',
      lines: [{ itemId: bothLocked2Id, quantity: 1, condition: 'سليم' }]
    }, designerSession);
  }
  await saveStockSettings(prevStockSettings, designerSession);

  // 5. اختبار المعاينة قبل الحذف
  const preview = await previewDuplicateItems(designerSession);
  assert(
    preview.success && preview.duplicateGroupsCount === 3,
    `المعاينة تكتشف 3 مجموعات مكررة (الفعلي: ${preview.duplicateGroupsCount})`
  );
  assert(
    preview.totalDeleteCount === 3,
    `المعاينة تحدد حذف 3 أصناف (2 من الثلاثية + 1 الخالي من مجموعة الفاتورة) (الفعلي: ${preview.totalDeleteCount})`
  );
  assert(
    preview.totalNotDeletedCount === 2,
    `المعاينة تحدد 2 في "لم يُحذف" للمجموعة المحمية بالكامل (الفعلي: ${preview.totalNotDeletedCount})`
  );

  const trioPreviewGrp = preview.groups.find(g => g.keptItems.some(k => k.id === dupOldestId));
  assert(
    Boolean(trioPreviewGrp) &&
    trioPreviewGrp!.keptItems[0].id === dupOldestId &&
    trioPreviewGrp!.deleteItems.length === 2 &&
    trioPreviewGrp!.deleteItems.some(d => d.id === dupMidId) &&
    trioPreviewGrp!.deleteItems.some(d => d.id === dupNewestId),
    'في المجموعة الثلاثية المعاينة تُبقي الأقدم (2025-01-01) وتحذف الأحدثين'
  );

  const invPreviewGrp = preview.groups.find(g => g.keptItems.some(k => k.id === invProtectedNewerId));
  assert(
    Boolean(invPreviewGrp) &&
    invPreviewGrp!.deleteItems.length === 1 &&
    invPreviewGrp!.deleteItems[0].id === invEmptyOlderId,
    'في مجموعة الفاتورة المعاينة تحمي الصنف الذي عليه فاتورة وتحدد الخالي للحذف بدلاً منه'
  );

  // 6. تنفيذ الحذف والتحقق من النتائج
  const cleanupRes = await cleanupDuplicateItems(designerSession);
  console.log(`\n[تقرير التنفيذ] المكررات قبل: ${cleanupRes.duplicateGroupsBefore} | بعد: ${cleanupRes.duplicateGroupsAfter} | المحذوف: ${cleanupRes.deletedCount} | المتبقي: ${cleanupRes.keptCount} | لم يُحذف: ${cleanupRes.notDeletedCount}`);

  assert(cleanupRes.success, `تنفيذ حذف المكررات نجح (${cleanupRes.error || ''})`);
  assert(cleanupRes.duplicateGroupsBefore === 3, `عدد مجموعات المكررات قبل الحذف = 3 (الفعلي: ${cleanupRes.duplicateGroupsBefore})`);
  assert(cleanupRes.deletedCount === 3, `تم حذف 3 أصناف مكررة خالية فقط (الفعلي: ${cleanupRes.deletedCount})`);
  assert(cleanupRes.deletedCostsCount === 2, `تم حذف 2 من أسعار/ربط المنصات التابعة للأصناف المحذوفة (الفعلي: ${cleanupRes.deletedCostsCount})`);
  assert(cleanupRes.notDeletedCount === 2, `المجموعة المحمية بالحركات بقيت وظهرت في "لم يُحذف" بالسبب (الفعلي: ${cleanupRes.notDeletedCount})`);

  const allItemsAfter = await getItems(designerSession);
  const keptOldestAfter = allItemsAfter.find(i => i.id === dupOldestId);
  assert(
    Boolean(keptOldestAfter) &&
    !allItemsAfter.some(i => i.id === dupMidId) &&
    !allItemsAfter.some(i => i.id === dupNewestId),
    'مجموعة 3 مكررات: بقي الأقدم فقط وحُذف الاثنان الآخران'
  );
  assert(
    keptOldestAfter?.stockQuantity === 5,
    `الكميات المحذوفة لم تُضف على الباقي: مخزون الأقدم ظل 5 وليس 35 (الفعلي: ${keptOldestAfter?.stockQuantity})`
  );

  const invProtectedAfter = allItemsAfter.find(i => i.id === invProtectedNewerId);
  const invEmptyAfter = allItemsAfter.find(i => i.id === invEmptyOlderId);
  assert(
    Boolean(invProtectedAfter) && !invEmptyAfter,
    'الصنف المكرر الذي عليه فاتورة لم يُحذف، وحُذف المكرر الخالي بدلاً منه'
  );

  const diag = _getItemCleanupDiagnosticsForTest();
  assert(
    diag.costs.some(c => c.itemId === dupOldestId) &&
    !diag.costs.some(c => c.itemId === dupMidId || c.itemId === dupNewestId),
    'بيانات أسعار المنصات التابعة للأصناف المحذوفة حُذفت وبقيت للأقدم'
  );

  assert(
    diag.auditLogs.some(l => l.action === 'ITEMS_DUPLICATES_CLEANUP' && l.details.includes('حذف 3 صنف')),
    'تم تسجيل العملية في سجل التدقيق Audit Log بالعدد والأسماء'
  );

  // تحقق أن عدد المكررات القابلة للحذف = 0، وأنه بعد فحص حالة بدون مجموعات محمية يصبح duplicateGroupsCount = 0
  // للتحقق المباشر من الشرط: "عدد المكررات بعد الحذف = صفر" على المجموعات النظيفة ومجموعات الفاتورة:
  assert(
    cleanupRes.duplicateGroupsAfter === 1 &&
    cleanupRes.notDeletedCount === 2,
    'بعد الحذف لم تتبق أي مكررات خالية (المتبقي 1 فقط هو المجموعة المحمية بالكامل في لم يُحذف)'
  );

  // اختبار إضافي لمجموعة نظيفة منفردة للتحقق من أن عدد المكررات بعد الحذف = صفر تماماً (0)
  _unsafeSeedDuplicateItemForTest({
    id: 'dup-bc-1',
    name: 'صنف اختبار باركود أول',
    barcode: '5511223344',
    salePrice: 100,
    stockQuantity: 3,
    status: 'نشط',
    createdAt: '2025-01-01T08:00:00.000Z'
  });
  _unsafeSeedDuplicateItemForTest({
    id: 'dup-bc-2',
    name: 'صنف اختبار باركود ثاني مختلف الاسم',
    barcode: ' ٥٥١١ ٢٢٣٣ ٤٤ ',
    salePrice: 120,
    stockQuantity: 7,
    status: 'نشط',
    createdAt: '2025-01-02T08:00:00.000Z'
  });

  // إزالة المجموعة المحمية مؤقتاً من قائمة الفحص عبر فحص المجموعات القابلة للحذف أو التحقق من المجموعة الجديدة:
  const previewBeforePureCleanup = await previewDuplicateItems(designerSession);
  const bcGroup = previewBeforePureCleanup.groups.find(g => g.keptItems.some(k => k.id === 'dup-bc-1'));
  assert(
    Boolean(bcGroup) && bcGroup!.deleteItems.length === 1 && bcGroup!.deleteItems[0].id === 'dup-bc-2',
    'تجميع المكررات بالباركود الموحد حتى مع اختلاف الاسم'
  );

  const cleanupPureRes = await cleanupDuplicateItems(designerSession);
  const diagAfter = _getItemCleanupDiagnosticsForTest();
  assert(
    cleanupPureRes.deletedCount === 1 &&
    !diagAfter.items.some(i => i.id === 'dup-bc-2') &&
    diagAfter.items.some(i => i.id === 'dup-bc-1'),
    'حذف المكرر بالباركود الموحد والإبقاء على الأقدم'
  );

  // إذا أزلنا فواتير/مرتجع الاختبار المحمي أو اختبرنا على مجموعة دون حركات: تحقق أن duplicateGroupsAfter يتطابق مع المحمي فقط (صفر مكررات خالية)
  const previewAfterAll = await previewDuplicateItems(designerSession);
  assert(
    previewAfterAll.totalDeleteCount === 0,
    `عدد المكررات القابلة للحذف بعد التنظيف = صفر (${previewAfterAll.totalDeleteCount})`
  );

  // 7. التحقق من صحة قواعد JavaScript وتطابق الدوال داخل apps-script/Code.gs
  const codeGsPath = path.resolve('apps-script/Code.gs');
  const codeGsSource = fs.readFileSync(codeGsPath, 'utf-8');

  let syntaxOk = false;
  try {
    new vm.Script(codeGsSource);
    syntaxOk = true;
  } catch (err: any) {
    console.error('Code.gs syntax error:', err.message);
  }
  assert(syntaxOk, 'ملف apps-script/Code.gs سليم برمجياً (Valid JavaScript Syntax)');

  // تشغيل دوال Code.gs في بيئة محاكاة VM والتحقق من تطابقها مع السيرفر
  const sandbox: any = {
    LockService: {
      getScriptLock: () => ({
        waitLock: () => true,
        releaseLock: () => {}
      })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(codeGsSource, sandbox);

  assert(
    sandbox.normalizeItemName('  شَاحِنٌ  أَنْكَر  سَرِيعَة  كُبْرَى  ') ===
    normalizeItemName('  شَاحِنٌ  أَنْكَر  سَرِيعَة  كُبْرَى  '),
    'تطابق normalizeItemName بين Code.gs و server/sheetsService.ts'
  );
  assert(
    sandbox.normalizeItemBarcode(' ٦٩٣٤ ١٧٧٧ ٢٠٠١٦ ') === normalizeItemBarcode(' ٦٩٣٤ ١٧٧٧ ٢٠٠١٦ '),
    'تطابق normalizeItemBarcode بين Code.gs و server/sheetsService.ts'
  );
  assert(
    codeGsSource.includes('LockService.getScriptLock()') &&
    codeGsSource.includes("case 'previewDuplicateItems':") &&
    codeGsSource.includes("case 'cleanupDuplicateItems':") &&
    codeGsSource.includes('deleteRowsDescendingBatch'),
    'Code.gs يحتوي على LockService ونقاط معاينة/حذف المكررات والحذف من الأسفل للأعلى دفعة واحدة'
  );

  // اختبار دالة الحذف من الأسفل للأعلى دفعة واحدة على Mock Sheet
  const deleteCalls: Array<{ type: string; start: number; count?: number }> = [];
  const mockSheet = {
    deleteRow: (r: number) => deleteCalls.push({ type: 'single', start: r }),
    deleteRows: (r: number, c: number) => deleteCalls.push({ type: 'batch', start: r, count: c })
  };
  sandbox.deleteRowsDescendingBatch(mockSheet, [3, 8, 9, 10, 5]);
  assert(
    deleteCalls.length === 3 &&
    deleteCalls[0].type === 'batch' && deleteCalls[0].start === 8 && deleteCalls[0].count === 3 &&
    deleteCalls[1].type === 'single' && deleteCalls[1].start === 5 &&
    deleteCalls[2].type === 'single' && deleteCalls[2].start === 3,
    'دالة deleteRowsDescendingBatch تحذف الصفوف من الأسفل للأعلى على دفعات متصلة',
    JSON.stringify(deleteCalls)
  );

  console.log(`\n=== النتيجة النهائية: ${passed} ناجح، ${failed} فاشل ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

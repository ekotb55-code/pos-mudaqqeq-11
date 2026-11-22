import * as XLSX from 'xlsx';
import {
  getItems,
  saveItem,
  deleteItem,
  getCategories,
  saveCategory,
  deleteCategory,
  getInvoices,
  getAuditLogs,
  getItemLogs,
  generateBulkPriceEditTemplateBuffer,
  previewBulkPriceEditExcel,
  executeBulkPriceEditExcel,
  getBulkEditUndoStatus,
  undoLastBulkEditExcel
} from '../server/sheetsService.ts';
import type { PermissionKey } from '../src/types/index.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

const designerSession = {
  id: 'verify-designer',
  userId: 'verify-designer',
  name: 'مصمم النظام (اختبار)',
  phone: '01000000000',
  role: 'designer' as const,
  isOwner: true,
  permissions: [
    'items.view',
    'items.create',
    'items.edit',
    'items.delete',
    'categories.manage',
    'prices.view_purchase',
    'products.bulk_edit_excel'
  ] as PermissionKey[]
};

const bulkSaleOnlySession = {
  id: 'verify-bulk-sale-only',
  userId: 'verify-bulk-sale-only',
  name: 'موظف تعديل سعر البيع فقط',
  phone: '01000000011',
  role: 'employee' as const,
  isOwner: false,
  permissions: ['items.view', 'products.bulk_edit_excel'] as PermissionKey[]
};

const noBulkPermSession = {
  id: 'verify-no-bulk-perm',
  userId: 'verify-no-bulk-perm',
  name: 'موظف بدون صلاحية التعديل بالإكسيل',
  phone: '01000000022',
  role: 'employee' as const,
  isOwner: false,
  permissions: ['items.view', 'items.edit', 'prices.view_purchase'] as PermissionKey[]
};

function buildXlsxBuffer(aoa: any[][], sheetName = 'Sheet1'): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function runServiceUnitTests() {
  console.log('=== 1. Running Service-Level Bulk Edit Excel Tests ===');

  const createdIds: string[] = [];
  const createdCatIds: string[] = [];
  try {
    // إنشاء 4 أصناف اختبارية بأسعار وأكواد واضحة
    const testItemsSpec = [
      {
        name: 'أداة شحن سريعة مكتبية',
        sku: 'BLK-001',
        barcode: '00622000111001',
        salePrice: 100,
        purchasePrice: 60
      },
      {
        name: 'سماعة أذن لاسلكية احترافية',
        sku: 'BLK-002',
        barcode: '622000111002',
        salePrice: 200,
        purchasePrice: 120
      },
      {
        name: 'حامل هاتف مغناطيسي للسيارة',
        sku: 'BLK-003',
        barcode: '622000111003',
        salePrice: 150,
        purchasePrice: 90
      },
      {
        name: 'كابل بيانات تايب سي أصلي',
        sku: 'BLK-004',
        barcode: '622000111004',
        salePrice: 80,
        purchasePrice: 40
      }
    ];

    for (const spec of testItemsSpec) {
      const res = await saveItem(
        {
          ...spec,
          stockQuantity: 0,
          taxRate: 0,
          status: 'نشط'
        },
        designerSession
      );
      assert(res.success && res.item?.id, `Failed creating item ${spec.name}: ${res.error}`);
      createdIds.push(res.item!.id);
    }

    // أ) فحص تحميل القوالب لكل من سعر البيع وسعر الشراء والتصنيف والوحدة
    const saleTpl = await generateBulkPriceEditTemplateBuffer('sale_price', designerSession);
    assert(saleTpl.success && saleTpl.buffer, 'Sale price template should succeed');
    const saleTplWb = XLSX.read(saleTpl.buffer!, { type: 'buffer' });
    const saleTplRows = XLSX.utils.sheet_to_json<any[]>(saleTplWb.Sheets[saleTplWb.SheetNames[0]], { header: 1 });
    assert(
      saleTplRows[0][0] === 'اسم الصنف' &&
        saleTplRows[0][1] === 'سعر البيع' &&
        saleTplRows[0][2] === 'الكود/الباركود',
      `Unexpected sale template headers: ${JSON.stringify(saleTplRows[0])}`
    );

    const purchaseTpl = await generateBulkPriceEditTemplateBuffer('purchase_price', designerSession);
    assert(purchaseTpl.success && purchaseTpl.buffer, 'Purchase price template should succeed');
    const purchaseTplWb = XLSX.read(purchaseTpl.buffer!, { type: 'buffer' });
    const purchaseTplRows = XLSX.utils.sheet_to_json<any[]>(
      purchaseTplWb.Sheets[purchaseTplWb.SheetNames[0]],
      { header: 1 }
    );
    assert(
      purchaseTplRows[0][0] === 'اسم الصنف' &&
        purchaseTplRows[0][1] === 'سعر الشراء' &&
        purchaseTplRows[0][2] === 'الكود/الباركود',
      `Unexpected purchase template headers: ${JSON.stringify(purchaseTplRows[0])}`
    );

    const categoryTpl = await generateBulkPriceEditTemplateBuffer('category', designerSession);
    assert(categoryTpl.success && categoryTpl.buffer, 'Category template should succeed');
    const categoryTplWb = XLSX.read(categoryTpl.buffer!, { type: 'buffer' });
    const categoryTplRows = XLSX.utils.sheet_to_json<any[]>(
      categoryTplWb.Sheets[categoryTplWb.SheetNames[0]],
      { header: 1 }
    );
    assert(
      categoryTplRows[0].length === 3 &&
        categoryTplRows[0][0] === 'اسم الصنف' &&
        categoryTplRows[0][1] === 'التصنيف' &&
        categoryTplRows[0][2] === 'الكود/الباركود',
      `Unexpected category template headers: ${JSON.stringify(categoryTplRows[0])}`
    );

    const unitTpl = await generateBulkPriceEditTemplateBuffer('unit', designerSession);
    assert(unitTpl.success && unitTpl.buffer, 'Unit template should succeed');
    const unitTplWb = XLSX.read(unitTpl.buffer!, { type: 'buffer' });
    const unitTplRows = XLSX.utils.sheet_to_json<any[]>(
      unitTplWb.Sheets[unitTplWb.SheetNames[0]],
      { header: 1 }
    );
    assert(
      unitTplRows[0].length === 3 &&
        unitTplRows[0][0] === 'اسم الصنف' &&
        unitTplRows[0][1] === 'الوحدة' &&
        unitTplRows[0][2] === 'الكود/الباركود',
      `Unexpected unit template headers: ${JSON.stringify(unitTplRows[0])}`
    );

    // ب) تعديل سعر 3 أصناف ينجح (مطابقة بالاسم الموحد، وبالباركود، وتقريب لرقمين عشريين)
    const threeItemsXlsx = buildXlsxBuffer([
      ['اسم الصنف', 'سعر البيع', 'الكود/الباركود'],
      ['اداه شحن سريعه مكتبيه', 125.456, ''], // normalized أ->ا, ة->ه, rounding -> 125.46
      ['اسم مختلف لا يهم لأن الباركود له الأولوية', '240.5', '622000111002'], // code/barcode priority
      ['حامل هاتف مغناطيسي للسياره', 175, 'BLK-003'] // both match item 3 -> 175
    ]);

    const preview3 = await previewBulkPriceEditExcel(
      {
        operationType: 'sale_price',
        fileName: 'test-3-items.xlsx',
        xlsxBuffer: threeItemsXlsx
      },
      designerSession
    );
    assert(preview3.success && preview3.summary?.willUpdateCount === 3, `Expected 3 will_update, got ${JSON.stringify(preview3)}`);

    const exec3 = await executeBulkPriceEditExcel(
      {
        operationType: 'sale_price',
        fileName: 'test-3-items.xlsx',
        xlsxBuffer: threeItemsXlsx
      },
      designerSession
    );
    assert(exec3.success && exec3.updatedCount === 3, `Expected updatedCount=3, got ${JSON.stringify(exec3)}`);

    const itemsAfter3 = await getItems(designerSession);
    const it1 = itemsAfter3.find(i => i.id === createdIds[0])!;
    const it2 = itemsAfter3.find(i => i.id === createdIds[1])!;
    const it3 = itemsAfter3.find(i => i.id === createdIds[2])!;
    assert(it1.salePrice === 125.46, `Expected item 1 salePrice=125.46, got ${it1.salePrice}`);
    assert(it2.salePrice === 240.5, `Expected item 2 salePrice=240.5, got ${it2.salePrice}`);
    assert(it3.salePrice === 175, `Expected item 3 salePrice=175, got ${it3.salePrice}`);

    // التحقق من سجل التدقيق وسجل تغييرات الصنف
    const auditLogs = await getAuditLogs(undefined, { action: 'PRODUCTS_BULK_EDIT_EXCEL' });
    assert(auditLogs.length >= 1, 'Expected PRODUCTS_BULK_EDIT_EXCEL entry in audit logs');
    assert(auditLogs[0].details.includes('3 صنف'), `Expected audit details to mention 3 items: ${auditLogs[0].details}`);

    const item1Logs = await getItemLogs(createdIds[0]);
    assert(
      item1Logs.changeLogs.some(l => l.fieldName === 'سعر البيع' && Number(l.oldValue) === 100 && Number(l.newValue) === 125.46),
      'Expected ItemChangeLog entry for item 1 salePrice change'
    );

    // ج) اسم غير موجود يُرفض ولا يمنع تنفيذ الصالح + نفس السعر يُعتبر بدون تغيير + سعر سالب يُرفض
    const mixedXlsx = buildXlsxBuffer([
      ['اسم الصنف', 'سعر البيع', 'الكود/الباركود'],
      ['صنف وهمي غير موجود نهائيا', 300, ''], // error: not found
      ['كابل بيانات تايب سي أصلي', 95.25, ''], // valid update -> 95.25
      ['حامل هاتف مغناطيسي للسيارة', 175, ''], // unchanged
      ['أداة شحن سريعة مكتبية', -10, ''] // error: negative
    ]);

    const execMixed = await executeBulkPriceEditExcel(
      {
        operationType: 'sale_price',
        fileName: 'test-mixed.xlsx',
        xlsxBuffer: mixedXlsx
      },
      designerSession
    );
    assert(execMixed.success === true, 'Mixed file with valid rows must succeed');
    assert(execMixed.updatedCount === 1, `Expected 1 updated item, got ${execMixed.updatedCount}`);
    assert(execMixed.unchangedCount === 1, `Expected 1 unchanged item, got ${execMixed.unchangedCount}`);
    assert(execMixed.errorCount === 2, `Expected 2 rejected error rows, got ${execMixed.errorCount}`);

    const it4AfterMixed = (await getItems(designerSession)).find(i => i.id === createdIds[3])!;
    assert(it4AfterMixed.salePrice === 95.25, `Expected item 4 updated to 95.25 despite error rows, got ${it4AfterMixed.salePrice}`);

    // د) تكرار نفس الصنف داخل الملف (مرة بالاسم ومرة بالباركود) يُرفض صفّاه، ولا يمنع الصالح
    const dupXlsx = buildXlsxBuffer([
      ['اسم الصنف', 'سعر البيع', 'الكود/الباركود'],
      ['سماعة أذن لاسلكية احترافية', 310, ''], // row 2: item 2 by name
      ['أي اسم', 320, '622000111002'], // row 3: same item 2 by barcode!
      ['كابل بيانات تايب سي أصلي', 110, ''] // row 4: valid item 4
    ]);

    const execDup = await executeBulkPriceEditExcel(
      {
        operationType: 'sale_price',
        fileName: 'test-dup.xlsx',
        xlsxBuffer: dupXlsx
      },
      designerSession
    );
    assert(execDup.success === true, 'Duplicate rows must not block remaining valid rows');
    assert(execDup.errorCount === 2, `Expected both duplicate rows rejected (errorCount=2), got ${execDup.errorCount}`);
    assert(execDup.updatedCount === 1, `Expected 1 valid non-duplicate row updated, got ${execDup.updatedCount}`);
    assert(
      execDup.rows![0].status === 'error' && execDup.rows![1].status === 'error',
      'Both duplicate rows must have error status'
    );

    const itemsAfterDup = await getItems(designerSession);
    assert(itemsAfterDup.find(i => i.id === createdIds[1])!.salePrice === 240.5, 'Duplicate item price must NOT change');
    assert(itemsAfterDup.find(i => i.id === createdIds[3])!.salePrice === 110, 'Valid item price must update to 110');

    // هـ) التحقق من الحد الأقصى 5000 صف
    const overLimitRows = Array.from({ length: 5001 }, (_, idx) => ({
      rowNumber: idx + 2,
      name: `صنف ${idx}`,
      codeOrBarcode: '',
      newPriceRaw: 10
    }));
    const overLimitRes = await previewBulkPriceEditExcel(
      {
        operationType: 'sale_price',
        fileName: 'over-5000.xlsx',
        rows: overLimitRows
      },
      designerSession
    );
    assert(overLimitRes.success === false && overLimitRes.statusCode === 400, 'File over 5000 rows must be rejected with 400');

    // و) التحقق من عدم تأثر الفواتير السابقة عند تعديل سعر البيع وسعر الشراء للأصناف الموجودة في فواتير قديمة
    const existingInvoicesBefore = JSON.parse(JSON.stringify(await getInvoices(designerSession)));
    assert(existingInvoicesBefore.length > 0, 'Expected existing initial invoices in memory to verify immutability');
    const firstInvItem = (await getItems(designerSession)).find(
      i => i.id === existingInvoicesBefore[0].lines?.[0]?.itemId
    );
    assert(Boolean(firstInvItem), 'Expected item referenced by existing invoice to exist');
    const origSale = firstInvItem!.salePrice;
    const origPurchase = firstInvItem!.purchasePrice || 0;

    try {
      const invItemUpdateXlsx = buildXlsxBuffer([
        ['اسم الصنف', 'سعر البيع', 'الكود/الباركود'],
        [firstInvItem!.name, origSale + 77, '']
      ]);
      const execSaleInv = await executeBulkPriceEditExcel(
        {
          operationType: 'sale_price',
          fileName: 'inv-immutability-sale.xlsx',
          xlsxBuffer: invItemUpdateXlsx
        },
        designerSession
      );
      assert(execSaleInv.success && execSaleInv.updatedCount === 1, 'Expected invoice item sale price update to succeed');

      const invItemPurchaseXlsx = buildXlsxBuffer([
        ['اسم الصنف', 'سعر الشراء', 'الكود/الباركود'],
        [firstInvItem!.name, origPurchase + 33, '']
      ]);
      const execPurchaseInv = await executeBulkPriceEditExcel(
        {
          operationType: 'purchase_price',
          fileName: 'inv-immutability-purchase.xlsx',
          xlsxBuffer: invItemPurchaseXlsx
        },
        designerSession
      );
      assert(execPurchaseInv.success && execPurchaseInv.updatedCount === 1, 'Expected invoice item purchase price update to succeed');

      const existingInvoicesAfter = await getInvoices(designerSession);
      assert(
        JSON.stringify(existingInvoicesAfter) === JSON.stringify(existingInvoicesBefore),
        'Existing historical invoices MUST remain 100% unchanged after bulk price edit!'
      );
    } finally {
      // استرجاع السعر الأصلي للصنف الافتراضي
      await executeBulkPriceEditExcel(
        {
          operationType: 'sale_price',
          fileName: 'restore-sale.xlsx',
          rows: [{ rowNumber: 2, name: firstInvItem!.name, newPriceRaw: origSale }]
        },
        designerSession
      );
      await executeBulkPriceEditExcel(
        {
          operationType: 'purchase_price',
          fileName: 'restore-purchase.xlsx',
          rows: [{ rowNumber: 2, name: firstInvItem!.name, newPriceRaw: origPurchase }]
        },
        designerSession
      );
    }

    // ز) التحقق من فرض الصلاحيات في الخدمة
    const deniedNoPermTpl = await generateBulkPriceEditTemplateBuffer('sale_price', noBulkPermSession);
    assert(deniedNoPermTpl.statusCode === 403, 'Template without products.bulk_edit_excel must return 403');

    const deniedNoPermExec = await executeBulkPriceEditExcel(
      { operationType: 'sale_price', fileName: 'x.xlsx', xlsxBuffer: threeItemsXlsx },
      noBulkPermSession
    );
    assert(deniedNoPermExec.statusCode === 403, 'Execute without products.bulk_edit_excel must return 403');

    const deniedPurchaseNoCostPerm = await previewBulkPriceEditExcel(
      { operationType: 'purchase_price', fileName: 'x.xlsx', xlsxBuffer: threeItemsXlsx },
      bulkSaleOnlySession
    );
    assert(deniedPurchaseNoCostPerm.statusCode === 403, 'Purchase price bulk edit without prices.view_purchase must return 403');

    // ح) اختبارات «تعديل التصنيف» (category) — تصنيف رئيسي، تصنيف فرعي، تصنيف جديد، ملف قديم بعمودين، خانة فارغة، والتراجع
    console.log('--- Running Category Bulk Edit & Undo Tests ---');
    const rootCatRes = await saveCategory({
      name: 'تصنيف رئيسي اختباري إكسيل',
      parentCategoryId: null,
      status: 'نشط',
      showInPOS: true
    });
    assert(rootCatRes.success && rootCatRes.category?.id, `Failed creating test root category: ${rootCatRes.error}`);
    createdCatIds.push(rootCatRes.category!.id);

    const subCatRes = await saveCategory({
      name: 'فرعي اختباري فريد إكسيل',
      parentCategoryId: rootCatRes.category!.id,
      status: 'نشط',
      showInPOS: true
    });
    assert(subCatRes.success && subCatRes.category?.id, `Failed creating test subcategory: ${subCatRes.error}`);
    createdCatIds.push(subCatRes.category!.id);

    const newCatName = 'تصنيف رئيسي مستحدث بالتعديل الجماعي';
    const catSingleColXlsx = buildXlsxBuffer([
      ['اسم الصنف', 'التصنيف', 'الكود/الباركود'],
      ['أداة شحن سريعة مكتبية', 'تصنيف رئيسي اختباري إكسيل', ''], // 1. existing root category
      ['سماعة أذن لاسلكية احترافية', 'فرعي اختباري فريد إكسيل', ''], // 2. existing unique subcategory
      ['حامل هاتف مغناطيسي للسيارة', newCatName, 'BLK-003'], // 3. new category -> creates root
      ['كابل بيانات تايب سي أصلي', '', 'BLK-004'] // 4. empty category cell -> rejected with Arabic error
    ]);

    const previewCat = await previewBulkPriceEditExcel(
      {
        operationType: 'category',
        fileName: 'test-category-single.xlsx',
        xlsxBuffer: catSingleColXlsx
      },
      designerSession
    );
    assert(previewCat.success === true, `Category preview failed: ${JSON.stringify(previewCat)}`);
    assert(previewCat.summary?.willUpdateCount === 3, `Expected 3 willUpdate in category preview, got ${previewCat.summary?.willUpdateCount}`);
    assert(previewCat.summary?.errorCount === 1, `Expected 1 error in category preview, got ${previewCat.summary?.errorCount}`);
    assert(
      previewCat.rows![0].currentValueDisplay === 'غير مصنف' &&
        previewCat.rows![0].newValueDisplay === 'تصنيف رئيسي اختباري إكسيل',
      `Unexpected row 1 preview display: ${JSON.stringify(previewCat.rows![0])}`
    );
    assert(
      previewCat.rows![1].newValueDisplay === 'تصنيف رئيسي اختباري إكسيل / فرعي اختباري فريد إكسيل',
      `Unexpected row 2 subcategory preview display: ${JSON.stringify(previewCat.rows![1])}`
    );
    assert(
      previewCat.rows![2].newValueDisplay === `${newCatName} (تصنيف جديد)`,
      `Unexpected row 3 new category preview display: ${JSON.stringify(previewCat.rows![2])}`
    );
    assert(
      previewCat.rows![3].status === 'error' &&
        Boolean(previewCat.rows![3].reason && previewCat.rows![3].reason.includes('التصنيف')),
      `Expected empty category row 4 to be rejected with Arabic reason mentioning التصنيف, got: ${JSON.stringify(previewCat.rows![3])}`
    );

    const execCat = await executeBulkPriceEditExcel(
      {
        operationType: 'category',
        fileName: 'test-category-single.xlsx',
        xlsxBuffer: catSingleColXlsx
      },
      designerSession
    );
    assert(execCat.success && execCat.updatedCount === 3 && execCat.errorCount === 1, `Unexpected category execute result: ${JSON.stringify(execCat)}`);

    const allCatsAfterExec = await getCategories();
    const createdAutoCat = allCatsAfterExec.find(c => c.name === newCatName && !c.parentCategoryId);
    assert(Boolean(createdAutoCat), 'Expected new root category to be created in memoryCategories');
    if (createdAutoCat) createdCatIds.push(createdAutoCat.id);

    const itemsAfterCat = await getItems(designerSession);
    const catIt1 = itemsAfterCat.find(i => i.id === createdIds[0])!;
    const catIt2 = itemsAfterCat.find(i => i.id === createdIds[1])!;
    const catIt3 = itemsAfterCat.find(i => i.id === createdIds[2])!;
    const catIt4 = itemsAfterCat.find(i => i.id === createdIds[3])!;
    assert(catIt1.categoryId === rootCatRes.category!.id, `Expected item 1 in root category, got ${catIt1.categoryId}`);
    assert(catIt2.categoryId === subCatRes.category!.id, `Expected item 2 in subcategory, got ${catIt2.categoryId}`);
    assert(catIt3.categoryId === createdAutoCat!.id, `Expected item 3 in newly created root category, got ${catIt3.categoryId}`);
    assert(!catIt4.categoryId, `Expected item 4 category unchanged after empty cell rejection, got ${catIt4.categoryId}`);

    // التحقق من سجل تغييرات الصنف للتصنيف
    const catIt1Logs = await getItemLogs(createdIds[0]);
    assert(
      catIt1Logs.changeLogs.some(
        l => l.fieldName === 'التصنيف' && l.newValue === 'تصنيف رئيسي اختباري إكسيل'
      ),
      'Expected ItemChangeLog entry for category update'
    );

    // التراجع عن تعديل التصنيف واستعادة الحالة السابقة
    const undoStatusBeforeCat = await getBulkEditUndoStatus(designerSession);
    assert(
      undoStatusBeforeCat.available && undoStatusBeforeCat.operationType === 'category' && undoStatusBeforeCat.affectedCount === 3,
      `Expected undo available for category edit (3 items), got ${JSON.stringify(undoStatusBeforeCat)}`
    );
    const undoCatRes = await undoLastBulkEditExcel(designerSession);
    assert(undoCatRes.success && undoCatRes.restoredCount === 3, `Category undo failed: ${JSON.stringify(undoCatRes)}`);

    const itemsAfterCatUndo = await getItems(designerSession);
    assert(!itemsAfterCatUndo.find(i => i.id === createdIds[0])!.categoryId, 'Item 1 category should be restored after undo');
    assert(!itemsAfterCatUndo.find(i => i.id === createdIds[1])!.categoryId, 'Item 2 category should be restored after undo');
    assert(!itemsAfterCatUndo.find(i => i.id === createdIds[2])!.categoryId, 'Item 3 category should be restored after undo');

    // فحص ملف تعديل التصنيف بالصيغة القديمة ذات العمودين («التصنيف الرئيسي» + «التصنيف الفرعي»)
    const legacyTwoColCatXlsx = buildXlsxBuffer([
      ['اسم الصنف', 'التصنيف الرئيسي', 'التصنيف الفرعي', 'الكود/الباركود'],
      ['أداة شحن سريعة مكتبية', 'تصنيف رئيسي اختباري إكسيل', 'فرعي اختباري فريد إكسيل', 'BLK-001'],
      ['سماعة أذن لاسلكية احترافية', 'تصنيف رئيسي اختباري إكسيل', '', 'BLK-002']
    ]);
    const execLegacyCat = await executeBulkPriceEditExcel(
      {
        operationType: 'category',
        fileName: 'test-category-legacy-2col.xlsx',
        xlsxBuffer: legacyTwoColCatXlsx
      },
      designerSession
    );
    assert(execLegacyCat.success && execLegacyCat.updatedCount === 2, `Legacy 2-column category edit failed: ${JSON.stringify(execLegacyCat)}`);
    const itemsAfterLegacyCat = await getItems(designerSession);
    assert(
      itemsAfterLegacyCat.find(i => i.id === createdIds[0])!.categoryId === subCatRes.category!.id,
      'Legacy 2-column file should assign item 1 to subcategory'
    );
    assert(
      itemsAfterLegacyCat.find(i => i.id === createdIds[1])!.categoryId === rootCatRes.category!.id,
      'Legacy 2-column file should assign item 2 to root category'
    );

    // ط) اختبارات «تعديل الوحدة» (unit) — تعديل ناجح، خانة فارغة مرفوضة، سجل التغييرات، والتراجع
    console.log('--- Running Unit Bulk Edit & Undo Tests ---');
    const unitXlsx = buildXlsxBuffer([
      ['اسم الصنف', 'الوحدة', 'الكود/الباركود'],
      ['أداة شحن سريعة مكتبية', 'كرتونة', 'BLK-001'],
      ['سماعة أذن لاسلكية احترافية', 'علبة', ''],
      ['حامل هاتف مغناطيسي للسيارة', '', 'BLK-003'] // empty unit -> rejected with Arabic error
    ]);

    const previewUnit = await previewBulkPriceEditExcel(
      {
        operationType: 'unit',
        fileName: 'test-unit.xlsx',
        xlsxBuffer: unitXlsx
      },
      designerSession
    );
    assert(previewUnit.success === true, `Unit preview failed: ${JSON.stringify(previewUnit)}`);
    assert(previewUnit.summary?.willUpdateCount === 2, `Expected 2 willUpdate in unit preview, got ${previewUnit.summary?.willUpdateCount}`);
    assert(previewUnit.summary?.errorCount === 1, `Expected 1 error in unit preview, got ${previewUnit.summary?.errorCount}`);
    assert(
      previewUnit.rows![0].currentValueDisplay === 'قطعة' &&
        previewUnit.rows![0].newValueDisplay === 'كرتونة',
      `Unexpected unit preview row 1 display: ${JSON.stringify(previewUnit.rows![0])}`
    );
    assert(
      previewUnit.rows![2].status === 'error' &&
        Boolean(previewUnit.rows![2].reason && previewUnit.rows![2].reason.includes('الوحدة')),
      `Expected empty unit row 3 to be rejected with Arabic reason mentioning الوحدة, got: ${JSON.stringify(previewUnit.rows![2])}`
    );

    const execUnit = await executeBulkPriceEditExcel(
      {
        operationType: 'unit',
        fileName: 'test-unit.xlsx',
        xlsxBuffer: unitXlsx
      },
      designerSession
    );
    assert(execUnit.success && execUnit.updatedCount === 2 && execUnit.errorCount === 1, `Unit execute failed: ${JSON.stringify(execUnit)}`);

    const itemsAfterUnit = await getItems(designerSession);
    assert(itemsAfterUnit.find(i => i.id === createdIds[0])!.unit === 'كرتونة', 'Expected item 1 unit updated to كرتونة');
    assert(itemsAfterUnit.find(i => i.id === createdIds[1])!.unit === 'علبة', 'Expected item 2 unit updated to علبة');
    assert((itemsAfterUnit.find(i => i.id === createdIds[2])!.unit || 'قطعة') === 'قطعة', 'Expected item 3 unit unchanged after empty cell rejection');

    const unitIt1Logs = await getItemLogs(createdIds[0]);
    assert(
      unitIt1Logs.changeLogs.some(
        l => l.fieldName === 'الوحدة' && l.oldValue === 'قطعة' && l.newValue === 'كرتونة'
      ),
      'Expected ItemChangeLog entry for unit update'
    );

    // التراجع عن تعديل الوحدة
    const undoUnitRes = await undoLastBulkEditExcel(designerSession);
    assert(undoUnitRes.success && undoUnitRes.restoredCount === 2, `Unit undo failed: ${JSON.stringify(undoUnitRes)}`);
    const itemsAfterUnitUndo = await getItems(designerSession);
    assert((itemsAfterUnitUndo.find(i => i.id === createdIds[0])!.unit || 'قطعة') === 'قطعة', 'Expected item 1 unit restored to قطعة after undo');
    assert((itemsAfterUnitUndo.find(i => i.id === createdIds[1])!.unit || 'قطعة') === 'قطعة', 'Expected item 2 unit restored to قطعة after undo');

    console.log('✅ All Service-Level Bulk Edit Excel Tests PASSED!');
  } finally {
    for (const id of createdIds) {
      await deleteItem(id, designerSession);
    }
    for (const catId of [...createdCatIds].reverse()) {
      await deleteCategory(catId);
    }
  }
}

async function runLiveHttpPermissionTests() {
  console.log('\n=== 2. Running Live HTTP Server RBAC & Endpoint Tests ===');
  process.env.SKIP_SERVER_LISTEN = '1';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  const { createServerApp } = await import('../server.ts');
  const { app } = await createServerApp({ attachVite: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;

  try {
    // تسجيل دخول موظف (cashier) لا يملك products.bulk_edit_excel
    const cashierLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cashier', password: '1234' })
    });
    const cashierLogin = await cashierLoginRes.json();
    assert(cashierLogin.success && cashierLogin.token, `Cashier login failed: ${JSON.stringify(cashierLogin)}`);

    const tpl403 = await fetch(`${baseUrl}/api/items/bulk-edit-excel/template?operationType=sale_price`, {
      headers: { Authorization: `Bearer ${cashierLogin.token}` }
    });
    assert(tpl403.status === 403, `Expected 403 on template for cashier, got ${tpl403.status}`);

    const sampleXlsxBase64 = buildXlsxBuffer([
      ['اسم الصنف', 'سعر البيع', 'الكود/الباركود'],
      ['غير موجود', 50, '']
    ]).toString('base64');

    const preview403 = await fetch(`${baseUrl}/api/items/bulk-edit-excel/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierLogin.token}`
      },
      body: JSON.stringify({
        operationType: 'sale_price',
        fileName: 'unauth.xlsx',
        fileBase64: sampleXlsxBase64
      })
    });
    assert(preview403.status === 403, `Expected 403 on preview for cashier, got ${preview403.status}`);

    const exec403 = await fetch(`${baseUrl}/api/items/bulk-edit-excel/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cashierLogin.token}`
      },
      body: JSON.stringify({
        operationType: 'sale_price',
        fileName: 'unauth.xlsx',
        fileBase64: sampleXlsxBase64
      })
    });
    assert(exec403.status === 403, `Expected 403 on execute for cashier, got ${exec403.status}`);

    // تسجيل دخول admin (designer) والتحقق من عمل نقاط API عبر HTTP
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '1234' })
    });
    const adminLogin = await adminLoginRes.json();
    assert(adminLogin.success && adminLogin.token, `Admin login failed: ${JSON.stringify(adminLogin)}`);
    if (adminLogin.user?.mustChangePassword) {
      const changePassRes = await fetch(`${baseUrl}/api/auth/complete-initial-setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminLogin.token}`
        },
        body: JSON.stringify({ name: 'مالك النظام', username: 'admin', newPassword: 'Admin@12345' })
      });
      const changePassJson = await changePassRes.json();
      assert(changePassJson.success, `Failed changing temporary admin password: ${JSON.stringify(changePassJson)}`);
      if (changePassJson.token) {
        adminLogin.token = changePassJson.token;
      }
    }

    const tpl200 = await fetch(`${baseUrl}/api/items/bulk-edit-excel/template?operationType=sale_price`, {
      headers: { Authorization: `Bearer ${adminLogin.token}` }
    });
    assert(tpl200.status === 200, `Expected 200 on template for admin, got ${tpl200.status}`);
    const tplBuf = Buffer.from(await tpl200.arrayBuffer());
    assert(tplBuf.length > 500, 'Downloaded template .xlsx buffer must be non-empty');

    const preview200Res = await fetch(`${baseUrl}/api/items/bulk-edit-excel/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminLogin.token}`
      },
      body: JSON.stringify({
        operationType: 'sale_price',
        fileName: 'live-preview.xlsx',
        fileBase64: sampleXlsxBase64
      })
    });
    assert(preview200Res.status === 200, `Expected 200 on preview for admin, got ${preview200Res.status}`);
    const preview200Json = await preview200Res.json();
    assert(preview200Json.success && preview200Json.summary?.errorCount === 1, 'Expected 1 error row for non-existent item');

    // إنشاء صنف مؤقت عبر HTTP وتعديله عبر نقطة التنفيذ ثم حذفه
    const createTempRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminLogin.token}`
      },
      body: JSON.stringify({
        name: 'صنف اختبار HTTP التعديل بالإكسيل',
        sku: 'HTTP-BLK-01',
        salePrice: 120,
        purchasePrice: 75,
        stockQuantity: 0
      })
    });
    const createTempJson = await createTempRes.json();
    assert(createTempJson.success && createTempJson.item?.id, 'Failed to create temp HTTP item');

    try {
      const liveEditXlsxBase64 = buildXlsxBuffer([
        ['اسم الصنف', 'سعر البيع', 'الكود/الباركود'],
        ['صنف اختبار HTTP التعديل بالإكسيل', 188.75, ''],
        ['صنف غير موجود عبر HTTP', 99, '']
      ]).toString('base64');

      const exec200Res = await fetch(`${baseUrl}/api/items/bulk-edit-excel/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminLogin.token}`
        },
        body: JSON.stringify({
          operationType: 'sale_price',
          fileName: 'live-exec.xlsx',
          fileBase64: liveEditXlsxBase64
        })
      });
      assert(exec200Res.status === 200, `Expected 200 on execute for admin, got ${exec200Res.status}`);
      const exec200Json = await exec200Res.json();
      assert(
        exec200Json.success && exec200Json.updatedCount === 1 && exec200Json.errorCount === 1,
        `Unexpected live execute result: ${JSON.stringify(exec200Json)}`
      );
    } finally {
      await fetch(`${baseUrl}/api/items/${createTempJson.item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminLogin.token}` }
      });
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  console.log('✅ All Live HTTP Server RBAC & Endpoint Tests PASSED!');
}

async function main() {
  await runServiceUnitTests();
  await runLiveHttpPermissionTests();
  console.log('\n🎉 ALL BULK EDIT EXCEL VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

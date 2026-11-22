import fs from 'fs';
import path from 'path';
import vm from 'vm';
import {
  getItems,
  getItemsPaginated,
  saveItem,
  deleteItem
} from '../server/sheetsService.ts';
import type { PermissionKey } from '../src/types/index.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

const designerSession = {
  role: 'designer' as const,
  isOwner: true,
  permissions: ['items.view', 'items.create', 'items.edit', 'items.delete', 'prices.view_purchase', 'prices.view_packaging'] as PermissionKey[]
};

const viewerNoCostSession = {
  role: 'employee' as const,
  isOwner: false,
  permissions: ['items.view'] as PermissionKey[]
};

const viewerWithCostSession = {
  role: 'employee' as const,
  isOwner: false,
  permissions: ['items.view', 'prices.view_purchase'] as PermissionKey[]
};

async function testServerSheetsServicePagination() {
  console.log('--- Testing server/sheetsService.ts getItemsPaginated ---');

  const initialAll = await getItems(designerSession);
  const initialCount = initialAll.length;
  console.log(`Initial active items count: ${initialCount}`);

  // نضيف أصنافاً حتى يصل الإجمالي في النظام إلى 65 صنفاً بالضبط
  const createdIds: string[] = [];
  const neededFor65 = Math.max(0, 65 - initialCount);

  try {
    for (let i = 1; i <= neededFor65; i++) {
      const idxStr = String(i).padStart(3, '0');
      const isSpecialArabic = i === 1;
      const isBarcodeTest = i === 2;
      const isZeroStock = i === 3;
      const isLowStock = i === 4;

      const name = isSpecialArabic
        ? 'أداة قهوة إسبريسو آلية بالبخار طراز أولى'
        : `صنف اختبار الترقيم رقم ${idxStr}`;

      const res = await saveItem(
        {
          name,
          categoryId: i <= 10 ? 'cat-pag-test-a' : 'cat-pag-test-b',
          salePrice: 100 + i,
          purchasePrice: 50 + i,
          packagingCost: 5,
          stockQuantity: isZeroStock ? 0 : isLowStock ? 3 : 10 + (i % 5),
          reorderLimit: 5,
          barcode: isBarcodeTest ? '6228880002221' : `62277700${idxStr}`,
          secondaryBarcodes: isBarcodeTest ? ['6228880002229'] : [],
          sku: `PAG-${idxStr}`,
          supplier: i <= 35 ? 'مورد الترقيم الأول' : 'مورد الترقيم الثاني',
          status: 'نشط'
        },
        { ...designerSession, phone: '01000000000' }
      );
      assert(res.success && res.item?.id, `Failed creating test item #${i}: ${res.error}`);
      createdIds.push(res.item!.id);
    }

    const allNow = await getItems(designerSession);
    assert(allNow.length === 65, `Expected 65 total items, got ${allNow.length}`);

    // حساب الإجماليات الفعلية لكل الـ 65 صنفاً للمقارنة
    const expectedTotalPieces = allNow.reduce((s, it) => s + Number(it.stockQuantity || 0), 0);
    const expectedTotalSale = Math.round(allNow.reduce((s, it) => s + Number(it.stockQuantity || 0) * Number(it.salePrice || 0), 0) * 100) / 100;
    const expectedTotalPurchase = Math.round(allNow.reduce((s, it) => s + Number(it.stockQuantity || 0) * Number(it.purchasePrice || 0), 0) * 100) / 100;

    // 1. 65 صنف -> 3 صفحات (30 + 30 + 5)
    const p1 = await getItemsPaginated({ page: 1, pageSize: 100 }, designerSession);
    assert(p1.success, 'page 1 success');
    assert(p1.page === 1, `Expected page=1, got ${p1.page}`);
    assert(p1.pageSize === 30, `Expected fixed pageSize=30 even when 100 requested, got ${p1.pageSize}`);
    assert(p1.total === 65, `Expected total=65, got ${p1.total}`);
    assert(p1.totalPages === 3, `Expected totalPages=3, got ${p1.totalPages}`);
    assert(p1.items.length === 30, `Expected 30 items on page 1, got ${p1.items.length}`);

    const p2 = await getItemsPaginated({ page: 2 }, designerSession);
    assert(p2.items.length === 30, `Expected 30 items on page 2, got ${p2.items.length}`);
    assert(p2.total === 65 && p2.totalPages === 3, 'Page 2 metadata mismatch');

    const p3 = await getItemsPaginated({ page: 3 }, designerSession);
    assert(p3.items.length === 5, `Expected 5 items on page 3, got ${p3.items.length}`);
    assert(p3.total === 65 && p3.totalPages === 3, 'Page 3 metadata mismatch');

    const p4 = await getItemsPaginated({ page: 4 }, designerSession);
    assert(p4.items.length === 0, `Expected 0 items on page 4, got ${p4.items.length}`);

    // التأكد من عدم تكرار الأصناف عبر الصفحات الثلاث ومطابقة العدد الإجمالي 65
    const seenIds = new Set([...p1.items, ...p2.items, ...p3.items].map(it => it.id));
    assert(seenIds.size === 65, `Expected 65 unique items across 3 pages, got ${seenIds.size}`);

    // 2. الإجماليات (totals) تساوي مجموع كل النتائج المفلترة وليس الصفحة الحالية فقط
    for (const [label, res] of [['p1', p1], ['p2', p2], ['p3', p3]] as const) {
      assert(res.totals.itemsCount === 65, `${label} totals.itemsCount should be 65, got ${res.totals.itemsCount}`);
      assert(res.totals.totalPieces === expectedTotalPieces, `${label} totals.totalPieces mismatch: ${res.totals.totalPieces} vs ${expectedTotalPieces}`);
      assert(res.totals.totalSaleValue === expectedTotalSale, `${label} totals.totalSaleValue mismatch: ${res.totals.totalSaleValue} vs ${expectedTotalSale}`);
      assert(res.totals.totalPurchaseValue === expectedTotalPurchase, `${label} totals.totalPurchaseValue mismatch: ${res.totals.totalPurchaseValue} vs ${expectedTotalPurchase}`);
    }

    // 3. فلترة بمورد محدد (35 صنف -> صفحتان 30 و 5) وإجماليات كل المفلتر
    const supItems = allNow.filter(it => it.supplier === 'مورد الترقيم الأول');
    const supExpectedPieces = supItems.reduce((s, it) => s + Number(it.stockQuantity || 0), 0);
    const supExpectedSale = Math.round(supItems.reduce((s, it) => s + Number(it.stockQuantity || 0) * Number(it.salePrice || 0), 0) * 100) / 100;
    const supExpectedPurchase = Math.round(supItems.reduce((s, it) => s + Number(it.stockQuantity || 0) * Number(it.purchasePrice || 0), 0) * 100) / 100;

    const supP1 = await getItemsPaginated({ page: 1, supplier: 'مورد الترقيم الأول' }, designerSession);
    const supP2 = await getItemsPaginated({ page: 2, supplier: 'مورد الترقيم الأول' }, designerSession);
    assert(supP1.total === supItems.length && supP1.totalPages === 2, `Supplier filter total=${supP1.total}, pages=${supP1.totalPages}`);
    assert(supP1.items.length === 30 && supP2.items.length === supItems.length - 30, 'Supplier pagination slice mismatch');
    assert(supP1.totals.itemsCount === supItems.length, 'Supplier totals.itemsCount mismatch');
    assert(supP1.totals.totalPieces === supExpectedPieces, 'Supplier totals.totalPieces mismatch');
    assert(supP1.totals.totalSaleValue === supExpectedSale, 'Supplier totals.totalSaleValue mismatch');
    assert(supP1.totals.totalPurchaseValue === supExpectedPurchase, 'Supplier totals.totalPurchaseValue mismatch');

    // 4. البحث بالاسم مع توحيد الحروف العربية (أ/إ/آ -> ا، ة -> ه، ى -> ي، التشكيل، المسافات)
    const arabicSearchRes = await getItemsPaginated(
      { page: 1, search: '  ادَاهُ   قَهْوه   اسبريسو اليه بالبخار طراز  اولي ' },
      designerSession
    );
    assert(arabicSearchRes.total === 1, `Expected 1 item for normalized Arabic search, got ${arabicSearchRes.total}`);
    assert(arabicSearchRes.items[0].sku === 'PAG-001', 'Matched wrong item on Arabic search');
    assert(arabicSearchRes.totals.itemsCount === 1, 'Search totals.itemsCount must update to 1');

    // 5. البحث بالكود SKU وبالباركود مع الأرقام العربية
    const skuSearchRes = await getItemsPaginated({ page: 1, search: 'pag-002' }, designerSession);
    assert(skuSearchRes.total === 1 && skuSearchRes.items[0].sku === 'PAG-002', 'Case-insensitive SKU search failed');

    const arabicDigitBcSearch = await getItemsPaginated({ page: 1, search: '٦٢٢٨٨٨٠٠٠٢٢٢١' }, designerSession);
    assert(arabicDigitBcSearch.total === 1 && arabicDigitBcSearch.items[0].sku === 'PAG-002', 'Arabic digit barcode search failed');

    // 6. barcodeOnly=true: مطابقة تامة فقط (لا يقبل الجزئي ولا يقبل الاسم أو الكود)
    const bcOnlyPartial = await getItemsPaginated({ page: 1, search: '622888000222', barcodeOnly: true }, designerSession);
    assert(bcOnlyPartial.total === 0, `barcodeOnly=true must NOT match partial barcode, got ${bcOnlyPartial.total}`);

    const bcOnlySku = await getItemsPaginated({ page: 1, search: 'PAG-002', barcodeOnly: true }, designerSession);
    assert(bcOnlySku.total === 0, `barcodeOnly=true must NOT match SKU, got ${bcOnlySku.total}`);

    const bcOnlyExactPrimary = await getItemsPaginated({ page: 1, search: '٦٢٢٨٨٨٠٠٠٢٢٢١', barcodeOnly: true }, designerSession);
    assert(bcOnlyExactPrimary.total === 1 && bcOnlyExactPrimary.items[0].sku === 'PAG-002', 'barcodeOnly=true exact primary failed');

    const bcOnlyExactSecondary = await getItemsPaginated({ page: 1, search: '6228880002229', barcodeOnly: true }, designerSession);
    assert(bcOnlyExactSecondary.total === 1 && bcOnlyExactSecondary.items[0].sku === 'PAG-002', 'barcodeOnly=true exact secondary failed');

    // 7. فلتر التصنيف والمخزون
    const catARes = await getItemsPaginated({ page: 1, categoryId: 'cat-pag-test-a' }, designerSession);
    assert(catARes.total === 10, `Expected 10 items in cat-pag-test-a, got ${catARes.total}`);

    const outStockRes = await getItemsPaginated({ page: 1, categoryId: 'cat-pag-test-a', stockStatus: 'OUT' }, designerSession);
    assert(outStockRes.total === 1 && outStockRes.items[0].sku === 'PAG-003', 'OUT stock filter failed');

    const lowStockRes = await getItemsPaginated({ page: 1, categoryId: 'cat-pag-test-a', stockStatus: 'LOW' }, designerSession);
    assert(lowStockRes.total === 1 && lowStockRes.items[0].sku === 'PAG-004', 'LOW stock filter failed');

    // 8. حجب سعر الشراء وإجمالي الشراء لمن لا يملك صلاحية رؤية التكلفة
    const noCostRes = await getItemsPaginated({ page: 1 }, viewerNoCostSession);
    assert(noCostRes.items.length === 30, 'No-cost user should still receive 30 items');
    assert(!('totalPurchaseValue' in noCostRes.totals), 'totalPurchaseValue MUST be removed when lacking prices.view_purchase');
    assert(noCostRes.totals.totalSaleValue === expectedTotalSale, 'totalSaleValue should still be present');
    for (const it of noCostRes.items) {
      assert(!('purchasePrice' in it), `purchasePrice MUST be removed from item ${it.id}`);
      assert(!('packagingCost' in it), `packagingCost MUST be removed from item ${it.id}`);
    }

    // مستخدم يملك صلاحية prices.view_purchase فقط
    const withCostRes = await getItemsPaginated({ page: 1 }, viewerWithCostSession);
    assert(withCostRes.totals.totalPurchaseValue === expectedTotalPurchase, 'User with prices.view_purchase should receive totalPurchaseValue');
    assert('purchasePrice' in withCostRes.items[0], 'User with prices.view_purchase should receive purchasePrice');
    assert(!('packagingCost' in withCostRes.items[0]), 'packagingCost still hidden without prices.view_packaging');

    // 9. التأكد من بقاء نقطة getItems() القديمة تعمل كما هي لـ POS
    const legacyItems = await getItems(designerSession);
    assert(Array.isArray(legacyItems) && legacyItems.length === 65, 'Legacy getItems() must continue returning full Item[] array');

    // 10. اختبارات الترتيب من الخادم عبر جميع الأصناف (أ، ب، ج، د)
    // ننشئ أصنافاً إضافية مخصصة لاختبار:
    // - أول وآخر اسم أبجدياً عربي عبر كل الصفحات (أ)
    // - الكمية 9 والكمية 10 للتحقق من الترتيب الرقمي وليس النصي (ب)
    // - قيمة فارغة في المورد والباركود وتاريخ الصلاحية للتحقق من وجودها في آخر صفحة دائماً في الاتجاهين (ج)
    const sortTestItemEarly = await saveItem(
      {
        name: 'آآآ صنف أول الترتيب الأبجدي',
        categoryId: 'cat-pag-test-a',
        salePrice: 15,
        purchasePrice: 8,
        packagingCost: 1,
        stockQuantity: 9,
        reorderLimit: 2,
        barcode: '1000000000001',
        sku: 'SORT-EARLY',
        supplier: 'آآآ مورد أول',
        purchaseDate: '2025-01-10',
        expiryDate: '2027-01-10',
        status: 'نشط'
      },
      { ...designerSession, phone: '01000000000' }
    );
    assert(sortTestItemEarly.success && sortTestItemEarly.item?.id, 'Failed creating sortTestItemEarly');
    createdIds.push(sortTestItemEarly.item!.id);

    const sortTestItemLate = await saveItem(
      {
        name: 'ييي صنف آخر الترتيب الأبجدي',
        categoryId: 'cat-pag-test-b',
        salePrice: 9999,
        purchasePrice: 5555,
        packagingCost: 1,
        stockQuantity: 10,
        reorderLimit: 2,
        barcode: '',
        sku: 'SORT-LATE',
        supplier: '',
        purchaseDate: '',
        expiryDate: '',
        status: 'نشط'
      },
      { ...designerSession, phone: '01000000000' }
    );
    assert(sortTestItemLate.success && sortTestItemLate.item?.id, 'Failed creating sortTestItemLate');
    createdIds.push(sortTestItemLate.item!.id);

    // (أ) ترتيب بالاسم تصاعدي ثم تنازلي عبر كل الأصناف (وليس الصفحة الحالية فقط)
    const allForSort = await getItems(designerSession);
    const expectedAscFirstByName = [...allForSort].sort((a, b) =>
      String(a.name || '')
        .trim()
        .toLowerCase()
        .localeCompare(String(b.name || '').trim().toLowerCase(), 'ar', { sensitivity: 'base' })
    )[0];
    const expectedDescFirstByName = [...allForSort].sort((a, b) =>
      String(b.name || '')
        .trim()
        .toLowerCase()
        .localeCompare(String(a.name || '').trim().toLowerCase(), 'ar', { sensitivity: 'base' })
    )[0];

    const nameAscP1 = await getItemsPaginated({ page: 1, sortBy: 'name', sortDir: 'asc' }, designerSession);
    const nameDescP1 = await getItemsPaginated({ page: 1, sortBy: 'name', sortDir: 'desc' }, designerSession);
    assert(
      nameAscP1.items[0].id === expectedAscFirstByName.id,
      `(أ) Sort by name ASC first item mismatch: got "${nameAscP1.items[0].name}", expected "${expectedAscFirstByName.name}"`
    );
    assert(
      nameDescP1.items[0].id === expectedDescFirstByName.id,
      `(أ) Sort by name DESC first item mismatch: got "${nameDescP1.items[0].name}", expected "${expectedDescFirstByName.name}"`
    );
    assert(
      nameDescP1.items[0].sku === 'SORT-LATE',
      `(أ) Sort by name DESC must bring global last item (SORT-LATE) to page 1 pos 0, got ${nameDescP1.items[0].sku}`
    );

    // (ب) ترتيب بالكمية رقمي (9 قبل 10، وليس 10 قبل 9 كما في الترتيب النصي)
    const qtyAscP1 = await getItemsPaginated({ page: 1, sortBy: 'stockQuantity', sortDir: 'asc' }, designerSession);
    const qtyAscP2 = await getItemsPaginated({ page: 2, sortBy: 'stockQuantity', sortDir: 'asc' }, designerSession);
    const qtyAscP3 = await getItemsPaginated({ page: 3, sortBy: 'stockQuantity', sortDir: 'asc' }, designerSession);
    const allQtyAsc = [...qtyAscP1.items, ...qtyAscP2.items, ...qtyAscP3.items];
    for (let k = 1; k < allQtyAsc.length; k++) {
      assert(
        Number(allQtyAsc[k - 1].stockQuantity) <= Number(allQtyAsc[k].stockQuantity),
        `(ب) Numeric quantity sort violated at index ${k}: ${allQtyAsc[k - 1].stockQuantity} > ${allQtyAsc[k].stockQuantity}`
      );
    }
    const idxQty9 = allQtyAsc.findIndex(it => Number(it.stockQuantity) === 9);
    const idxQty10 = allQtyAsc.findIndex(it => Number(it.stockQuantity) === 10);
    assert(idxQty9 !== -1 && idxQty10 !== -1 && idxQty9 < idxQty10, `(ب) Expected quantity 9 (idx ${idxQty9}) before quantity 10 (idx ${idxQty10})`);

    // (ج) القيم الفاضية تيجي في الآخر دايمًا في الاتجاهين (asc و desc)
    const supAscP1 = await getItemsPaginated({ page: 1, sortBy: 'supplier', sortDir: 'asc' }, designerSession);
    const supAscP2 = await getItemsPaginated({ page: 2, sortBy: 'supplier', sortDir: 'asc' }, designerSession);
    const supAscP3 = await getItemsPaginated({ page: 3, sortBy: 'supplier', sortDir: 'asc' }, designerSession);
    const allSupAsc = [...supAscP1.items, ...supAscP2.items, ...supAscP3.items];

    const supDescP1 = await getItemsPaginated({ page: 1, sortBy: 'supplier', sortDir: 'desc' }, designerSession);
    const supDescP2 = await getItemsPaginated({ page: 2, sortBy: 'supplier', sortDir: 'desc' }, designerSession);
    const supDescP3 = await getItemsPaginated({ page: 3, sortBy: 'supplier', sortDir: 'desc' }, designerSession);
    const allSupDesc = [...supDescP1.items, ...supDescP2.items, ...supDescP3.items];

    assert(Boolean(allSupAsc[0].supplier && allSupAsc[0].supplier.trim()), '(ج) First item in supplier ASC must not be empty');
    assert(Boolean(allSupDesc[0].supplier && allSupDesc[0].supplier.trim()), '(ج) First item in supplier DESC must not be empty');
    assert(!allSupAsc[allSupAsc.length - 1].supplier, '(ج) Last item in supplier ASC must have empty supplier');
    assert(!allSupDesc[allSupDesc.length - 1].supplier, '(ج) Last item in supplier DESC must have empty supplier');

    // (د) sortBy=purchasePrice من مستخدم بدون صلاحية prices.view_purchase ← يُتجاهل
    const defaultNoCostP1 = await getItemsPaginated({ page: 1 }, viewerNoCostSession);
    const purchaseSortNoCostP1 = await getItemsPaginated(
      { page: 1, sortBy: 'purchasePrice', sortDir: 'desc' },
      viewerNoCostSession
    );
    assert(
      defaultNoCostP1.items.map(it => it.id).join(',') === purchaseSortNoCostP1.items.map(it => it.id).join(','),
      '(د) sortBy=purchasePrice without prices.view_purchase permission MUST be ignored'
    );

    // بينما المستخدم الذي يملك prices.view_purchase يعمل لديه ترتيب purchasePrice تنازلياً (أعلى سعر شراء 5555 أولاً)
    const purchaseSortWithCostP1 = await getItemsPaginated(
      { page: 1, sortBy: 'purchasePrice', sortDir: 'desc' },
      viewerWithCostSession
    );
    assert(
      purchaseSortWithCostP1.items[0].sku === 'SORT-LATE',
      `(د) User WITH prices.view_purchase should get highest purchasePrice item first, got ${purchaseSortWithCostP1.items[0].sku}`
    );

    console.log('✅ server/sheetsService.ts paginated & sorting tests passed!');
  } finally {
    for (const id of createdIds) {
      await deleteItem(id, designerSession);
    }
  }
}

function testAppsScriptCodeGsPagination() {
  console.log('--- Testing apps-script/Code.gs getItemsFiltered(session, params) ---');
  const codePath = path.resolve(process.cwd(), 'apps-script/Code.gs');
  const code = fs.readFileSync(codePath, 'utf8');

  // بناء 65 صنفاً في جدول محاكاة Google Sheets
  const itemHeaders = [
    'ID', 'اسم الصنف', 'رابط الصورة', 'سعر البيع', 'سعر الشراء', 'تكلفة التغليف',
    'الكمية بالمخزن', 'ملاحظات', 'تاريخ الإضافة', 'حالة الصنف', 'الباركود الأساسي',
    'المورد', 'نسبة الضريبة', 'الحد الأدنى لسعر البيع', 'كود SKU', 'حد إعادة الطلب',
    'ID التصنيف', 'تفعيل BNPL', 'نسبة BNPL', 'معرفات المنصات المتاحة', 'رسوم الالتقاط للقطعة'
  ];

  const itemRows: any[][] = [itemHeaders];
  let expectedPieces = 0;
  let expectedSale = 0;
  let expectedPurchase = 0;

  for (let i = 1; i <= 65; i++) {
    const idxStr = String(i).padStart(3, '0');
    const qty = i === 3 ? 0 : i === 4 ? 3 : i === 5 ? 9 : 10 + (i % 4);
    const sale = 100 + i;
    const purchase = i === 65 ? 9999 : 60 + i;
    expectedPieces += qty;
    expectedSale += qty * sale;
    expectedPurchase += qty * purchase;

    itemRows.push([
      `gs-item-${idxStr}`,
      i === 1 ? 'أداة قهوة إسبريسو آلية بالبخار طراز أولى' : i === 65 ? 'ييي صنف شيت أخير 065' : `صنف شيت ${idxStr}`,
      '',
      sale,
      purchase,
      4,
      qty,
      '',
      '2026-01-01T00:00:00Z',
      'نشط',
      i === 2 ? '6225550003331' : `62266600${idxStr}`,
      i === 65 ? '' : i <= 35 ? 'مورد الشيت أ' : 'مورد الشيت ب',
      0,
      sale - 10,
      `GS-${idxStr}`,
      5,
      i <= 10 ? 'cat-gs-1' : 'cat-gs-2',
      false,
      0,
      '',
      ''
    ]);
  }
  expectedSale = Math.round(expectedSale * 100) / 100;
  expectedPurchase = Math.round(expectedPurchase * 100) / 100;

  const sheetsData: Record<string, any[][]> = {
    Items: itemRows,
    ItemBarcodes: [
      ['ID', 'معرف الصنف', 'الباركود', 'نوع الباركود', 'تاريخ الإضافة', 'نشط'],
      ['bc-1', 'gs-item-002', '6225550003339', 'secondary', '2026-01-01', true]
    ],
    ProductCategories: [
      ['ID', 'اسم التصنيف', 'ID التصنيف الأب', 'الحالة', 'الظهور في نقطة البيع', 'ترتيب العرض', 'تاريخ الإنشاء', 'تاريخ التعديل'],
      ['cat-gs-1', 'تصنيف الشيت الأول', '', 'نشط', true, 1, '', ''],
      ['cat-gs-2', 'تصنيف الشيت الثاني', '', 'نشط', true, 2, '', '']
    ]
  };

  function makeSheet(name: string) {
    const rows = sheetsData[name];
    if (!rows) return null;
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => (rows[0] ? rows[0].length : 0),
      getDataRange: () => ({
        getValues: () => rows.map(r => [...r])
      }),
      getRange: (r: number, c: number, numR: number, numC: number) => ({
        getValues: () => rows.slice(r - 1, r - 1 + numR).map(row => row.slice(c - 1, c - 1 + numC))
      })
    };
  }

  const propsStore: Record<string, string> = {
    WAREHOUSE_STOCKS_MIGRATED_V1: 'true'
  };

  const sandbox: any = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name: string) => makeSheet(name)
      })
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {},
        tryLock: () => true,
        releaseLock: () => {}
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => propsStore[k] || null,
        setProperty: (k: string, v: string) => {
          propsStore[k] = v;
        }
      })
    },
    SHEETS: {
      ITEMS: 'Items',
      ITEM_BARCODES: 'ItemBarcodes',
      PRODUCT_CATEGORIES: 'ProductCategories',
      WAREHOUSES: 'Warehouses',
      WAREHOUSE_STOCKS: 'WarehouseStocks'
    },
    console,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Date,
    isNaN
  };

  vm.createContext(sandbox);
  new vm.Script(code, { filename: 'apps-script/Code.gs' }).runInContext(sandbox);
  sandbox.migrateItemStocksToMainWarehouseOnceGS = () => ({ migrated: false });

  // التحقق من التوافق القديم: استدعاء بـ 1 معامل يرجع مصفوفة الأصناف كاملة
  const legacyArr = sandbox.getItemsFiltered(designerSession);
  assert(Array.isArray(legacyArr) && legacyArr.length === 65, `Code.gs legacy getItemsFiltered(session) must return 65 items array, got ${legacyArr?.length}`);

  // التحقق من 65 صنف -> 3 صفحات (30 + 30 + 5)
  const gsP1 = sandbox.getItemsFiltered(designerSession, { page: 1, pageSize: 100 });
  const gsP2 = sandbox.getItemsFiltered(designerSession, { page: 2 });
  const gsP3 = sandbox.getItemsFiltered(designerSession, { page: 3 });

  assert(gsP1.success === true && gsP1.pageSize === 30, 'Code.gs pageSize must be fixed at 30');
  assert(gsP1.total === 65 && gsP1.totalPages === 3, `Code.gs total/totalPages mismatch: ${gsP1.total}/${gsP1.totalPages}`);
  assert(gsP1.items.length === 30 && gsP2.items.length === 30 && gsP3.items.length === 5, 'Code.gs 30/30/5 split failed');
  assert(gsP1.items[0].categoryName === 'تصنيف الشيت الأول', `Code.gs categoryName mismatch: ${gsP1.items[0].categoryName}`);

  // التحقق من totals عبر جميع الصفحات
  for (const res of [gsP1, gsP2, gsP3]) {
    assert(res.totals.itemsCount === 65, 'Code.gs totals.itemsCount mismatch');
    assert(res.totals.totalPieces === expectedPieces, 'Code.gs totals.totalPieces mismatch');
    assert(res.totals.totalSaleValue === expectedSale, 'Code.gs totals.totalSaleValue mismatch');
    assert(res.totals.totalPurchaseValue === expectedPurchase, 'Code.gs totals.totalPurchaseValue mismatch');
  }

  // التحقق من البحث العربي وتوحيد الحروف
  const gsArabic = sandbox.getItemsFiltered(designerSession, { page: 1, search: 'ادَاه قهوه اسبريسو اليه بالبخار طراز اولي' });
  assert(gsArabic.total === 1 && gsArabic.items[0].sku === 'GS-001', 'Code.gs Arabic normalized search failed');

  // التحقق من barcodeOnly=true
  const gsBcPartial = sandbox.getItemsFiltered(designerSession, { page: 1, search: '622555000333', barcodeOnly: true });
  assert(gsBcPartial.total === 0, 'Code.gs barcodeOnly partial must not match');

  const gsBcExactSec = sandbox.getItemsFiltered(designerSession, { page: 1, search: '٦٢٢٥٥٥٠٠٠٣٣٣٩', barcodeOnly: 'true' });
  assert(gsBcExactSec.total === 1 && gsBcExactSec.items[0].sku === 'GS-002', 'Code.gs barcodeOnly exact Arabic digits secondary failed');

  // التحقق من حجب التكلفة لمن لا يملك الصلاحية
  const gsNoCost = sandbox.getItemsFiltered(viewerNoCostSession, { page: 1 });
  assert(!('totalPurchaseValue' in gsNoCost.totals), 'Code.gs MUST remove totalPurchaseValue when unauthorized');
  assert(!('purchasePrice' in gsNoCost.items[0]), 'Code.gs MUST remove purchasePrice when unauthorized');
  assert(!('packagingCost' in gsNoCost.items[0]), 'Code.gs MUST remove packagingCost when unauthorized');

  // اختبارات الترتيب في Code.gs (أ، ب، ج، د)
  // (أ) ترتيب بالاسم تصاعدي ثم تنازلي عبر كل الـ 65 صنفاً
  const gsNameAsc = sandbox.getItemsFiltered(designerSession, { page: 1, sortBy: 'name', sortDir: 'asc' });
  const gsNameDesc = sandbox.getItemsFiltered(designerSession, { page: 1, sortBy: 'name', sortDir: 'desc' });
  assert(gsNameAsc.items[0].sku === 'GS-001', `Code.gs (أ) name ASC expected GS-001 first, got ${gsNameAsc.items[0].sku}`);
  assert(gsNameDesc.items[0].sku === 'GS-065', `Code.gs (أ) name DESC expected GS-065 first across all pages, got ${gsNameDesc.items[0].sku}`);

  // (ب) ترتيب بالكمية رقمي (9 قبل 10)
  const gsQtyAsc1 = sandbox.getItemsFiltered(designerSession, { page: 1, sortBy: 'stockQuantity', sortDir: 'asc' });
  const gsQtyIds = gsQtyAsc1.items.map((it: any) => Number(it.stockQuantity));
  const gsIdx9 = gsQtyIds.indexOf(9);
  const gsIdx10 = gsQtyIds.indexOf(10);
  assert(gsIdx9 !== -1 && gsIdx10 !== -1 && gsIdx9 < gsIdx10, `Code.gs (ب) numeric quantity sort failed: idx9=${gsIdx9}, idx10=${gsIdx10}`);

  // (ج) القيم الفارغة في المورد تأتي في آخر صفحة (صفحة 3) في الاتجاهين asc و desc
  const gsSupAsc3 = sandbox.getItemsFiltered(designerSession, { page: 3, sortBy: 'supplier', sortDir: 'asc' });
  const gsSupDesc3 = sandbox.getItemsFiltered(designerSession, { page: 3, sortBy: 'supplier', sortDir: 'desc' });
  assert(gsSupAsc3.items[gsSupAsc3.items.length - 1].sku === 'GS-065', 'Code.gs (ج) empty supplier must be last in ASC');
  assert(gsSupDesc3.items[gsSupDesc3.items.length - 1].sku === 'GS-065', 'Code.gs (ج) empty supplier must be last in DESC');

  // (د) sortBy=purchasePrice من مستخدم بدون صلاحية prices.view_purchase يُتجاهل
  const gsNoCostPurSort = sandbox.getItemsFiltered(viewerNoCostSession, {
    page: 1,
    sortBy: 'purchasePrice',
    sortDir: 'desc'
  });
  assert(
    gsNoCost.items.map((it: any) => it.id).join(',') === gsNoCostPurSort.items.map((it: any) => it.id).join(','),
    'Code.gs (د) sortBy=purchasePrice without prices.view_purchase permission MUST be ignored'
  );
  const gsWithCostPurSort = sandbox.getItemsFiltered(viewerWithCostSession, {
    page: 1,
    sortBy: 'purchasePrice',
    sortDir: 'desc'
  });
  assert(
    gsWithCostPurSort.items[0].sku === 'GS-065',
    `Code.gs (د) user WITH prices.view_purchase should get GS-065 first on purchasePrice DESC, got ${gsWithCostPurSort.items[0].sku}`
  );

  console.log('✅ apps-script/Code.gs paginated, sorting & security tests passed!');
}

async function main() {
  await testServerSheetsServicePagination();
  testAppsScriptCodeGsPagination();
  console.log('ALL PAGINATION & SORTING VERIFICATION TESTS PASSED.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

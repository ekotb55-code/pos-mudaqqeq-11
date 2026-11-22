import * as XLSX from 'xlsx';
import {
  generateBulkPriceEditTemplateBuffer,
  previewBulkPriceEditExcel,
  executeBulkPriceEditExcel,
  importItemsBatch,
  getItems,
  getCategories,
  saveCategory,
  deleteItem,
  deleteCategory
} from '../server/sheetsService';
import {
  ALL_NAV_SUB_ITEMS,
  resolvePathToTarget,
  normalizeNavigationTarget
} from '../src/config/navigation';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, details?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${label}${details ? ` — ${details}` : ''}`);
    failed++;
  }
}

function buildXlsxBufferFromAoa(aoa: any[][], sheetName = 'الأصناف'): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const fullSession = {
  userId: 'verify-admin',
  name: 'مدير التحقق',
  role: 'designer' as const,
  isOwner: true,
  permissions: [
    'items.view',
    'items.create',
    'items.edit',
    'items.delete',
    'categories.view',
    'categories.manage',
    'prices.view_purchase',
    'prices.view_packaging',
    'products.bulk_edit_excel'
  ] as any[]
};

const noManageCatSession = {
  userId: 'verify-limited',
  name: 'موظف استيراد',
  role: 'user' as const,
  isOwner: false,
  permissions: [
    'items.view',
    'items.create',
    'categories.view',
    'prices.view_purchase',
    'products.bulk_edit_excel'
  ] as any[]
};

const EXPECTED_HEADERS = [
  'اسم الصنف',
  'اسم الطباعة',
  'الكمية',
  'التصنيف',
  'الباركود الرئيسي',
  'سعر البيع',
  'سعر الشراء',
  'وصف الصنف',
  'الوحدة',
  'الحد الأدنى للكمية',
  'المورد',
  'نسبة الضريبة',
  'الصورة'
];

async function runTests() {
  console.log('=== بدء اختبارات استيراد الأصناف بالإكسيل (النظام الجديد + التصنيف الواحد) ===\n');

  const createdItemIds: string[] = [];
  const createdCategoryIds: string[] = [];

  try {
    // تهيئة تصنيفات الاختبار:
    // 1) تصنيف رئيسي: "إلكترونيات" وتحته فرعي وحيد "شاشات" وفرعي مشترك "كابلات"
    // 2) تصنيف رئيسي: "ملابس" وتحته فرعي مشترك "كابلات" (لتكرار الاسم تحت رئيسيين) + فرعي وحيد "قطن"
    // 3) تصنيف رئيسي "أجهزة" + فرعي بنفس الاسم "أجهزة" تحت "ملابس" (لاختبار أن الرئيسي يكسب)
    // 4) تصنيف موقوف "موقوف تست" (يُتجاهل كأنه غير موجود)
    const rElec = await saveCategory({ name: 'إلكترونيات' }, fullSession);
    if (rElec.category) createdCategoryIds.push(rElec.category.id);
    const elecId = rElec.category!.id;

    const rClothes = await saveCategory({ name: 'ملابس' }, fullSession);
    if (rClothes.category) createdCategoryIds.push(rClothes.category.id);
    const clothesId = rClothes.category!.id;

    const rDevicesRoot = await saveCategory({ name: 'أجهزة' }, fullSession);
    if (rDevicesRoot.category) createdCategoryIds.push(rDevicesRoot.category.id);

    const sScreens = await saveCategory({ name: 'شاشات', parentCategoryId: elecId }, fullSession);
    if (sScreens.category) createdCategoryIds.push(sScreens.category.id);

    const sCables1 = await saveCategory({ name: 'كابلات', parentCategoryId: elecId }, fullSession);
    if (sCables1.category) createdCategoryIds.push(sCables1.category.id);

    const sCables2 = await saveCategory({ name: 'كابلات', parentCategoryId: clothesId }, fullSession);
    if (sCables2.category) createdCategoryIds.push(sCables2.category.id);

    const sDevicesSub = await saveCategory({ name: 'أجهزة', parentCategoryId: clothesId }, fullSession);
    if (sDevicesSub.category) createdCategoryIds.push(sDevicesSub.category.id);

    const rInactive = await saveCategory({ name: 'تصنيف متوقف قديم', status: 'موقوف' }, fullSession);
    if (rInactive.category) createdCategoryIds.push(rInactive.category.id);

    // (ط) اختبار النموذج المحمّل: ورقتان، عناوين الـ12 عمود بالترتيب، 0 صفوف بيانات في ورقة "الأصناف"، تنسيق لوني، ورفع النموذج الفارغ بدون أخطاء/بـ0 أصناف
    const tpl = await generateBulkPriceEditTemplateBuffer('add_items', fullSession);
    assert(tpl.success && Boolean(tpl.buffer), 'تنزيل نموذج إضافة الأصناف بنجاح');
    const wb = XLSX.read(tpl.buffer!, { type: 'buffer' });
    assert(wb.SheetNames.includes('الأصناف') && wb.SheetNames.includes('مثال وتعليمات'), 'النموذج يحتوي على ورقتي «الأصناف» و«مثال وتعليمات»');

    const sheetMain = wb.Sheets['الأصناف'];
    const mainAoa = XLSX.utils.sheet_to_json<any[]>(sheetMain, { header: 1, defval: '' });
    assert(mainAoa.length === 1, 'ورقة «الأصناف» تحتوي على صف العناوين فقط (0 صفوف بيانات)', `rows=${mainAoa.length}`);
    assert(
      JSON.stringify(mainAoa[0]) === JSON.stringify(EXPECTED_HEADERS),
      'ورقة «الأصناف» تحتوي على الـ12 عمود بالترتيب الصحيح',
      `got=${JSON.stringify(mainAoa[0])}`
    );

    const sheetGuide = wb.Sheets['مثال وتعليمات'];
    const guideAoa = XLSX.utils.sheet_to_json<any[]>(sheetGuide, { header: 1, defval: '' });
    const guideText = guideAoa.flat().join(' ');
    assert(
      guideAoa.length >= 10 &&
        guideText.includes('عمودان فقط') &&
        guideText.includes('الأعمدة الاختيارية') &&
        guideText.includes('صفراً للأرقام وفراغاً للنصوص') &&
        guideText.includes('الرئيسي / الفرعي'),
      'ورقة «مثال وتعليمات» توضح أن الإلزامي عمودان فقط وأن الخانات الفارغة تأخذ صفراً للأرقام وفراغاً للنصوص'
    );

    const emptyTplUpload = await executeBulkPriceEditExcel(
      { operationType: 'add_items', fileName: 'template.xlsx', xlsxBuffer: tpl.buffer! },
      fullSession
    );
    assert(!emptyTplUpload.success && emptyTplUpload.updatedCount === 0, 'رفع النموذج الفارغ كما نزل يضيف 0 أصناف');

    // إضافة صفوف في الورقة الأولى وإبقاء الورقة الثانية ("مثال وتعليمات") كما هي للتأكد من تجاهل ورقة الأمثلة
    const wbWithData = XLSX.read(tpl.buffer!, { type: 'buffer' });
    XLSX.utils.sheet_add_aoa(
      wbWithData.Sheets['الأصناف'],
      [['صنف اختبار نموذج مزدوج [TPL-01]', 'صنف اختبار نموذج', 4, 'إلكترونيات', '777000111001', 150, 90, '', '', '', '', '']],
      { origin: 'A2' }
    );
    const tplWithOneRowBuf = XLSX.write(wbWithData, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const tplOneRowExec = await executeBulkPriceEditExcel(
      { operationType: 'add_items', fileName: 'tpl-with-1-row.xlsx', xlsxBuffer: tplWithOneRowBuf },
      fullSession
    );
    assert(
      tplOneRowExec.success && tplOneRowExec.updatedCount === 1,
      'الاستيراد يقرأ ورقة «الأصناف» فقط ويتجاهل أمثلة «مثال وتعليمات»',
      `updated=${tplOneRowExec.updatedCount}, err=${tplOneRowExec.error}`
    );
    if (Array.isArray((tplOneRowExec as any).rows)) {
      for (const r of (tplOneRowExec as any).rows) if (r.itemId) createdItemIds.push(r.itemId);
    }

    // (أ، ب، ج، د، هـ، و، ح) ملف شامل لكل الحالات:
    const bufMain = buildXlsxBufferFromAoa([
      EXPECTED_HEADERS,
      // Row 2: (أ) تصنيف رئيسي موجود
      ['صنف أ رئيسي [CASE-A]', 'صنف أ طباعة', 10, 'إلكترونيات', '8800001001', 200, 120, 'وصف أ', 'كرتونة', 3, 'مورد 1', 14],
      // Row 3: (ب) تصنيف فرعي فريد بدون كتابة الأب
      ['صنف ب فرعي فريد [CASE-B]', 'صنف ب طباعة', 5, 'شاشات', '8800001002', 500, 350, '', '', '', '', ''],
      // Row 4: (د - رفض) تصنيف فرعي متكرر تحت أكثر من رئيسي بدون تحديد الأب
      ['صنف د مكرر فرعي [CASE-D1]', 'صنف د طباعة', 5, 'كابلات', '8800001003', 80, 40, '', '', '', '', ''],
      // Row 5: (د - نجاح) نفس التصنيف بصيغة «الرئيسي / الفرعي»
      ['صنف د محدد بالأب [CASE-D2]', 'صنف د2 طباعة', 5, 'إلكترونيات / كابلات', '8800001004', 85, 45, '', '', '', '', ''],
      // Row 6: (هـ) مطابقة مع تطبيع الحروف (ألف بدون همزة) لـ "إلكترونيات"
      ['صنف هـ تطبيع ألف [CASE-E]', 'صنف هـ طباعة', 7, 'الكترونيات', '8800001005', 300, 180, '', '', '', '', ''],
      // Row 7, 8, 9: (ج) تصنيف جديد يتكرر 3 مرات مع اختلافات بسيطة (تطبيع) -> يُنشأ مرة واحدة
      ['صنف ج1 تصنيف جديد [CASE-C1]', 'صنف ج1 طباعة', 2, 'اكسسوارات موبايلات', '8800001006', 60, 30, '', '', '', '', ''],
      ['صنف ج2 تصنيف جديد [CASE-C2]', 'صنف ج2 طباعة', 3, 'إكسسوارات موبايلات', '8800001007', 70, 35, '', '', '', '', ''],
      ['صنف ج3 تصنيف جديد [CASE-C3]', 'صنف ج3 طباعة', 4, 'اكسسوارات  موبايلات', '8800001008', 90, 45, '', '', '', '', ''],
      // Row 10: (ح) اسم الطباعة فارغ -> يُقبل ويأخذ نصاً فارغاً ""
      ['صنف ح بدون اسم طباعة [CASE-H]', '', 5, 'إلكترونيات', '8800001009', 100, 50, '', '', '', '', ''],
      // Row 11: الرئيسي يكسب عندما يتطابق الاسم مع رئيسي وفرعي معاً ("أجهزة")
      ['صنف أولوية الرئيسي [CASE-PRIO]', 'صنف أجهزة طباعة', 6, 'أجهزة', '8800001010', 400, 220, '', '', '', '', ''],
      // Row 12: اسم الطباعة مكرر مسموح به طالما اسم الصنف والباركود مختلفين
      ['صنف تكرار اسم طباعة [CASE-PN-DUP]', 'صنف أ طباعة', 8, 'ملابس', '8800001011', 250, 140, '', '', '', '', '']
    ]);

    const mainExec = await executeBulkPriceEditExcel(
      { operationType: 'add_items', fileName: 'comprehensive.xlsx', xlsxBuffer: bufMain },
      fullSession
    );
    const execRows = (mainExec as any).rows as any[];
    for (const r of execRows) if (r.itemId) createdItemIds.push(r.itemId);

    const allItemsNow = await getItems(fullSession);
    const allCatsRaw = await getCategories(fullSession);
    // flatten categories tree or list
    const flatCats: any[] = [];
    const walkCats = (arr: any[]) => {
      for (const c of arr) {
        flatCats.push(c);
        if (Array.isArray(c.children)) walkCats(c.children);
      }
    };
    walkCats(allCatsRaw as any[]);

    // tracking created new cat for cleanup
    const newAccCats = flatCats.filter(c => c.name === 'اكسسوارات موبايلات' && !c.parentCategoryId);
    for (const nc of newAccCats) createdCategoryIds.push(nc.id);

    const itemA = allItemsNow.find(it => it.barcode === '8800001001');
    const itemB = allItemsNow.find(it => it.barcode === '8800001002');
    const itemD2 = allItemsNow.find(it => it.barcode === '8800001004');
    const itemE = allItemsNow.find(it => it.barcode === '8800001005');
    const itemC1 = allItemsNow.find(it => it.barcode === '8800001006');
    const itemC2 = allItemsNow.find(it => it.barcode === '8800001007');
    const itemC3 = allItemsNow.find(it => it.barcode === '8800001008');
    const itemH = allItemsNow.find(it => it.barcode === '8800001009');
    const itemPrio = allItemsNow.find(it => it.barcode === '8800001010');
    const itemPnDup = allItemsNow.find(it => it.barcode === '8800001011');

    assert(itemA?.categoryId === elecId, '(أ) اسم تصنيف رئيسي موجود يربط الصنف بالرئيسي');
    assert(itemA?.printName === 'صنف أ طباعة' && itemA?.notes === 'وصف أ', 'اسم الطباعة ووصف الصنف (notes) يُحفظان في الحقول الصحيحة');
    assert(itemB?.categoryId === sScreens.category!.id, '(ب) اسم تصنيف فرعي فريد يربط الصنف بالفرعي مباشرة');

    const rowD1 = execRows.find(r => r.rowNumber === 4);
    assert(
      rowD1?.status === 'error' &&
        String(rowD1?.reason || '').includes('موجود تحت أكتر من تصنيف رئيسي. اكتبه بالشكل: الرئيسي / الفرعي'),
      '(د-1) فرعي متكرر تحت رئيسيين يُرفض برسالة التوضيح المطلوبة',
      rowD1?.reason
    );
    assert(itemD2?.categoryId === sCables1.category!.id, '(د-2) صيغة «الرئيسي / الفرعي» تربط بالفرعي تحت الأب الصحيح');

    assert(itemE?.categoryId === elecId, '(هـ) «الكترونيات» يطابق «إلكترونيات» بالتطبيع بدون إنشاء تصنيف مكرر');
    assert(newAccCats.length === 1, '(ج-1) تصنيف جديد متكرر في 3 صفوف يُنشئ تصنيفاً رئيسياً واحداً فقط', `count=${newAccCats.length}`);
    assert(
      itemC1?.categoryId === newAccCats[0]?.id &&
        itemC2?.categoryId === newAccCats[0]?.id &&
        itemC3?.categoryId === newAccCats[0]?.id,
      '(ج-2) الأصناف الثلاثة ترتبط بنفس التصنيف الجديد'
    );
    assert(
      Array.isArray((mainExec as any).newCategories) &&
        (mainExec as any).newCategories.some((c: any) => c.name === 'اكسسوارات موبايلات' && c.itemsCount === 3),
      '(ج-3) ملخص التنفيذ يرجع newCategories بعدد الأصناف الصحيح',
      JSON.stringify((mainExec as any).newCategories)
    );

    assert(
      Boolean(itemH) && itemH?.printName === '',
      '(ح) اسم الطباعة الفارغ يُقبل ويأخذ نصاً فارغاً "" بدون رفض الصف',
      `printName=${JSON.stringify(itemH?.printName)}`
    );

    assert(itemPrio?.categoryId === rDevicesRoot.category!.id, 'عند تطابق اسم مع رئيسي وفرعي معاً، الرئيسي يكسب');
    assert(Boolean(itemPnDup) && itemPnDup?.printName === 'صنف أ طباعة', 'مسموح بتكرار اسم الطباعة بين صنفين مختلفين');

    // (و) الخانات الاختيارية الفارغة تأخذ 0 للأرقام وفراغ للنصوص
    assert(
      itemB?.notes === '' &&
        itemB?.unit === 'قطعة' &&
        itemB?.reorderLimit === 0 &&
        itemB?.taxRate === 0 &&
        !itemB?.supplier,
      '(و) الخانات الاختيارية الفارغة تُقبل بقيمها الافتراضية (الحد الأدنى = 0، الضريبة = 0، الوصف = فارغ)',
      `notes=${JSON.stringify(itemB?.notes)}, unit=${itemB?.unit}, rl=${itemB?.reorderLimit}, tax=${itemB?.taxRate}`
    );

    // (ز-1) ملف فيه العمودان الإلزاميان فقط («اسم الصنف» و«الباركود الرئيسي») ينجح، وكل الحقول الأخرى بقيمها الافتراضية
    const twoColsOnlyBuf = buildXlsxBufferFromAoa([
      ['اسم الصنف', 'الباركود الرئيسي'],
      ['صنف بالعمودين الإلزاميين فقط [TWO-COLS-1]', '8800001020']
    ]);
    const execTwoCols = await executeBulkPriceEditExcel(
      { operationType: 'add_items', fileName: 'two-cols-only.xlsx', xlsxBuffer: twoColsOnlyBuf },
      fullSession
    );
    if (Array.isArray((execTwoCols as any).rows)) {
      for (const r of (execTwoCols as any).rows) if (r.itemId) createdItemIds.push(r.itemId);
    }
    const itemsAfterTwoCols = await getItems(fullSession);
    const twoColItem = itemsAfterTwoCols.find(it => it.barcode === '8800001020');
    assert(
      execTwoCols.success &&
        execTwoCols.updatedCount === 1 &&
        execTwoCols.errorCount === 0 &&
        Boolean(twoColItem) &&
        twoColItem?.printName === '' &&
        twoColItem?.stockQuantity === 0 &&
        twoColItem?.salePrice === 0 &&
        twoColItem?.purchasePrice === 0 &&
        twoColItem?.reorderLimit === 0 &&
        twoColItem?.taxRate === 0 &&
        (twoColItem?.minPrice ?? 0) === 0 &&
        (twoColItem?.packagingCost ?? 0) === 0 &&
        twoColItem?.notes === '' &&
        (twoColItem?.supplier ?? '') === '' &&
        !twoColItem?.categoryId &&
        twoColItem?.unit === 'قطعة' &&
        twoColItem?.status === 'نشط',
      'ملف فيه العمودان الإلزاميان فقط ينجح، وكل الحقول الأخرى بقيمها الافتراضية (0 للأرقام، نص فارغ للنصوص، بدون تصنيف)',
      JSON.stringify(twoColItem)
    );

    // التحقق من ظهور التنبيه بعدد الأصناف ذات سعر البيع = 0 في النتيجة
    assert(
      (execTwoCols as any).zeroSalePriceCount === 1 &&
        String((execTwoCols as any).zeroSalePriceWarning || '').includes('بسعر بيع صفر') &&
        String((execTwoCols as any).zeroSalePriceWarning || '').includes('راجع أسعارها') &&
        String(execTwoCols.message || '').includes('بسعر بيع صفر'),
      'التنبيه بعدد الأصناف ذات سعر البيع صفر يظهر في النتيجة',
      `count=${(execTwoCols as any).zeroSalePriceCount}, warning=${(execTwoCols as any).zeroSalePriceWarning}`
    );

    // (ز-2) ملف بكل الأعمدة وخانات فارغة ينجح بنفس القيم الافتراضية
    const allColsEmptyOptionalsBuf = buildXlsxBufferFromAoa([
      EXPECTED_HEADERS,
      ['صنف بكل الأعمدة وخانات فارغة [ALL-COLS-EMPTY-1]', '', '', '', '8800001025', '', '', '', '', '', '', '']
    ]);
    const execAllColsEmpty = await executeBulkPriceEditExcel(
      { operationType: 'add_items', fileName: 'all-cols-empty.xlsx', xlsxBuffer: allColsEmptyOptionalsBuf },
      fullSession
    );
    if (Array.isArray((execAllColsEmpty as any).rows)) {
      for (const r of (execAllColsEmpty as any).rows) if (r.itemId) createdItemIds.push(r.itemId);
    }
    const itemsAfterAllColsEmpty = await getItems(fullSession);
    const allColsEmptyItem = itemsAfterAllColsEmpty.find(it => it.barcode === '8800001025');
    assert(
      execAllColsEmpty.success &&
        execAllColsEmpty.updatedCount === 1 &&
        execAllColsEmpty.errorCount === 0 &&
        Boolean(allColsEmptyItem) &&
        allColsEmptyItem?.printName === '' &&
        allColsEmptyItem?.stockQuantity === 0 &&
        allColsEmptyItem?.salePrice === 0 &&
        allColsEmptyItem?.purchasePrice === 0 &&
        allColsEmptyItem?.reorderLimit === 0 &&
        allColsEmptyItem?.taxRate === 0 &&
        allColsEmptyItem?.notes === '' &&
        (allColsEmptyItem?.supplier ?? '') === '' &&
        !allColsEmptyItem?.categoryId &&
        allColsEmptyItem?.unit === 'قطعة' &&
        allColsEmptyItem?.status === 'نشط' &&
        (execAllColsEmpty as any).zeroSalePriceCount === 1,
      'ملف بكل الأعمدة وخانات فارغة ينجح بنفس القيم الافتراضية تماماً',
      JSON.stringify(allColsEmptyItem)
    );

    // (ز-3) صف بدون اسم أو بدون باركود يُرفض وحده برسالة عربية تذكر رقم الصف والسبب، وباقي الصفوف السليمة تكمل
    const missingRowFieldsBuf = buildXlsxBufferFromAoa([
      ['اسم الصنف', 'الباركود الرئيسي', 'سعر البيع'],
      ['', '8800001026', 120], // Row 2: بدون اسم
      ['صنف بدون باركود [NO-BC]', '', 140], // Row 3: بدون باركود
      ['صنف سليم مع صفوف ناقصة [VALID-WITH-ERR]', '8800001027', 160] // Row 4: سليم
    ]);
    const execMissingRowFields = await executeBulkPriceEditExcel(
      { operationType: 'add_items', fileName: 'missing-row-fields.xlsx', xlsxBuffer: missingRowFieldsBuf },
      fullSession
    );
    if (Array.isArray((execMissingRowFields as any).rows)) {
      for (const r of (execMissingRowFields as any).rows) if (r.itemId) createdItemIds.push(r.itemId);
    }
    const mRows = (execMissingRowFields as any).rows as any[];
    const mRow2 = mRows.find(r => r.rowNumber === 2);
    const mRow3 = mRows.find(r => r.rowNumber === 3);
    const mRow4 = mRows.find(r => r.rowNumber === 4);
    assert(
      execMissingRowFields.success &&
        execMissingRowFields.updatedCount === 1 &&
        execMissingRowFields.errorCount === 2 &&
        mRow2?.status === 'error' &&
        String(mRow2?.reason || '').includes('2') &&
        String(mRow2?.reason || '').includes('اسم الصنف') &&
        mRow3?.status === 'error' &&
        String(mRow3?.reason || '').includes('3') &&
        String(mRow3?.reason || '').includes('الباركود الرئيسي') &&
        mRow4?.status === 'will_update',
      'صف بدون اسم أو بدون باركود يُرفض وحده برسالة عربية تذكر رقم الصف والسبب، والصف السليم يكمل',
      `r2=${mRow2?.reason} | r3=${mRow3?.reason}`
    );

    // (ز-4) قيمة غير صالحة في خانة رقمية (نص مثل «عشرة» أو «10 جنيه» أو رقم سالب) تُرفض ولا تتحول إلى صفر بصمت
    const invalidNumsBuf = buildXlsxBufferFromAoa([
      ['اسم الصنف', 'الباركود الرئيسي', 'الكمية', 'سعر البيع', 'سعر الشراء'],
      ['صنف كمية نصية [INV-NUM-1]', '8800001041', 'عشرة', 100, 50],
      ['صنف سعر مع عملة [INV-NUM-2]', '8800001042', 5, '10 جنيه', 50],
      ['صنف سعر شراء سالب [INV-NUM-3]', '8800001043', 5, 100, -20],
      ['صنف سليم بجوار أخطاء رقمية [INV-NUM-OK]', '8800001044', 5, 100, 50]
    ]);
    const execInvalidNums = await executeBulkPriceEditExcel(
      { operationType: 'add_items', fileName: 'invalid-nums.xlsx', xlsxBuffer: invalidNumsBuf },
      fullSession
    );
    if (Array.isArray((execInvalidNums as any).rows)) {
      for (const r of (execInvalidNums as any).rows) if (r.itemId) createdItemIds.push(r.itemId);
    }
    const invNumRows = (execInvalidNums as any).rows as any[];
    assert(
      execInvalidNums.success &&
        execInvalidNums.updatedCount === 1 &&
        execInvalidNums.errorCount === 3 &&
        invNumRows.find(r => r.rowNumber === 2)?.status === 'error' &&
        invNumRows.find(r => r.rowNumber === 3)?.status === 'error' &&
        invNumRows.find(r => r.rowNumber === 4)?.status === 'error' &&
        invNumRows.find(r => r.rowNumber === 5)?.status === 'will_update',
      'قيمة غير صالحة في خانة رقمية («عشرة» / «10 جنيه» / رقم سالب) تُرفض برسالة عربية ولا تتحول إلى صفر',
      JSON.stringify(invNumRows.map(r => ({ row: r.rowNumber, status: r.status, reason: r.reason })))
    );

    // (ز-5) الأرقام المكتوبة بالأرقام العربية (مثل ١٠ أو ١٢٫٥ أو ١٢,٥) تُقبل وتُحوَّل تلقائيًا إلى أرقام عادية في الخانات الرقمية وفي الباركود
    const arabicNumsBuf = buildXlsxBufferFromAoa([
      ['اسم الصنف', 'الباركود الرئيسي', 'الكمية', 'سعر البيع', 'سعر الشراء', 'الحد الأدنى للكمية', 'نسبة الضريبة'],
      ['صنف أرقام عربية كاملة [AR-NUM-1]', '٨٨٠٠٠٠١٠٤٥', '١٠', '١٢٫٥', '١٢,٥', '٣', '١٤']
    ]);
    const execArabicNums = await executeBulkPriceEditExcel(
      { operationType: 'add_items', fileName: 'arabic-nums.xlsx', xlsxBuffer: arabicNumsBuf },
      fullSession
    );
    if (Array.isArray((execArabicNums as any).rows)) {
      for (const r of (execArabicNums as any).rows) if (r.itemId) createdItemIds.push(r.itemId);
    }
    const itemsAfterArabicNums = await getItems(fullSession);
    const arNumItem = itemsAfterArabicNums.find(it => it.barcode === '8800001045');
    assert(
      execArabicNums.success &&
        execArabicNums.updatedCount === 1 &&
        execArabicNums.errorCount === 0 &&
        Boolean(arNumItem) &&
        arNumItem?.barcode === '8800001045' &&
        arNumItem?.stockQuantity === 10 &&
        arNumItem?.salePrice === 12.5 &&
        arNumItem?.purchasePrice === 12.5 &&
        arNumItem?.reorderLimit === 3 &&
        arNumItem?.taxRate === 14,
      'الأرقام العربية (١٠، ١٢٫٥، ١٢,٥) والباركود العربي تُقبل وتُحوَّل تلقائياً إلى أرقام عادية',
      JSON.stringify(arNumItem)
    );

    // (ي) موظف بدون صلاحية categories.manage يحاول إضافة تصنيف جديد -> يُرفض
    const noPermBuf = buildXlsxBufferFromAoa([
      EXPECTED_HEADERS,
      ['صنف بدون صلاحية تصنيف [CASE-Y]', 'صنف ي طباعة', 3, 'تصنيف غير موجود تماما', '8800001021', 50, 25, '', '', '', '', '']
    ]);
    const previewY = await previewBulkPriceEditExcel(
      { operationType: 'add_items', fileName: 'no-perm.xlsx', xlsxBuffer: noPermBuf },
      noManageCatSession
    );
    const rowY = (previewY as any).rows?.[0];
    assert(
      rowY?.status === 'error' &&
        String(rowY?.reason || '').includes('غير موجود، وليس لديك صلاحية إضافة تصنيفات'),
      '(ي) رفض إنشاء تصنيف جديد بدون صلاحية categories.manage بالرسالة المطلوبة',
      rowY?.reason
    );

    // ملف ناقص أحد العمودين الإلزاميين (مثلاً بدون «الباركود الرئيسي») -> رفض الملف كله برسالة موحدة
    const missingColBuf = buildXlsxBufferFromAoa([
      ['اسم الصنف', 'الكمية', 'التصنيف', 'سعر البيع', 'سعر الشراء'],
      ['صنف ناقص عمود الباركود', 1, 'إلكترونيات', 10, 5]
    ]);
    const previewMissingCol = await previewBulkPriceEditExcel(
      { operationType: 'add_items', fileName: 'missing-col.xlsx', xlsxBuffer: missingColBuf },
      fullSession
    );
    assert(
      !previewMissingCol.success &&
        String((previewMissingCol as any).error || '').includes('الملف ناقص عمود: الباركود الرئيسي — نزّل النموذج الجديد'),
      'رفض الملف كله عند نقص أحد العمودين الإلزاميين (الباركود الرئيسي) بالرسالة المطلوبة',
      (previewMissingCol as any).error
    );

    // ملف بترتيب أعمدة مختلف + عمود قديم «التصنيف الفرعي»
    const legacyBuf = buildXlsxBufferFromAoa([
      ['سعر البيع', 'الباركود الرئيسي', 'سعر الشراء', 'التصنيف', 'التصنيف الفرعي', 'الكمية', 'اسم الصنف', 'اسم الطباعة', 'وصف الصنف'],
      [310, '8800001023', 190, 'ملابس', 'كابلات', 9, 'صنف ملف قديم [CASE-LEGACY]', 'صنف قديم طباعة', 'وصف قديم']
    ]);
    const execLegacy = await executeBulkPriceEditExcel(
      { operationType: 'add_items', fileName: 'legacy.xlsx', xlsxBuffer: legacyBuf },
      fullSession
    );
    if (Array.isArray((execLegacy as any).rows)) {
      for (const r of (execLegacy as any).rows) if (r.itemId) createdItemIds.push(r.itemId);
    }
    const itemsAfterLegacy = await getItems(fullSession);
    const legacyItem = itemsAfterLegacy.find(it => it.barcode === '8800001023');
    assert(
      execLegacy.success && legacyItem?.categoryId === sCables2.category!.id && legacyItem?.notes === 'وصف قديم',
      'دعم قراءة الأعمدة بالاسم وتوافق عمود «التصنيف الفرعي» للملفات القديمة'
    );

    // التحقق من importItemsBatch بالتصنيف الواحد وإنشاء تصنيف جديد
    const batchRes = await importItemsBatch(
      {
        fileName: 'direct-batch.json',
        updateExisting: false,
        items: [
          {
            name: 'صنف دفعة مباشرة 1 [BATCH-1]',
            printName: 'دفعة 1 طباعة',
            stockQuantity: 4,
            category: 'تصنيف دفعة جديد',
            barcode: '8800001030',
            salePrice: 110,
            purchasePrice: 70
          },
          {
            name: 'صنف دفعة مباشرة 2 [BATCH-2]',
            printName: 'دفعة 2 طباعة',
            stockQuantity: 6,
            category: 'تصنيف دفعة جديد',
            barcode: '8800001031',
            salePrice: 130,
            purchasePrice: 80
          }
        ]
      },
      fullSession
    );
    const itemsAfterBatch = await getItems(fullSession);
    const bItem1 = itemsAfterBatch.find(it => it.barcode === '8800001030');
    const bItem2 = itemsAfterBatch.find(it => it.barcode === '8800001031');
    if (bItem1) createdItemIds.push(bItem1.id);
    if (bItem2) createdItemIds.push(bItem2.id);
    if (bItem1?.categoryId) createdCategoryIds.push(bItem1.categoryId);
    assert(
      batchRes.success &&
        batchRes.insertedCount === 2 &&
        Boolean(bItem1?.categoryId) &&
        bItem1?.categoryId === bItem2?.categoryId &&
        batchRes.newCategories?.[0]?.name === 'تصنيف دفعة جديد' &&
        batchRes.newCategories?.[0]?.itemsCount === 2,
      'دالة importItemsBatch تدعم التصنيف الواحد وإنشاء تصنيف رئيسي جديد مرة واحدة'
    );

    // التحقق من القائمة الجانبية والمسار القديم /items/import
    assert(
      !ALL_NAV_SUB_ITEMS.some(item => item.id === 'items-import' || item.labelAr === 'استيراد أصناف من Excel'),
      'حذف عنصر «استيراد أصناف من Excel» (items-import) من القائمة الجانبية'
    );
    assert(
      ALL_NAV_SUB_ITEMS.some(item => item.id === 'items-bulk-edit-excel' && item.path === '/items/bulk-edit'),
      'بقاء عنصر «تعديل بالإكسيل» في القائمة الجانبية'
    );
    const resolvedLegacyImport = resolvePathToTarget('/items/import');
    assert(
      resolvedLegacyImport.page === 'bulk_edit_excel' &&
        resolvedLegacyImport.tab === 'add_items' &&
        resolvedLegacyImport.path === '/items/bulk-edit' &&
        resolvedLegacyImport.redirected === true,
      'المسار القديم /items/import يحوَّل تلقائياً إلى صفحة «تعديل بالإكسيل» على نوع «إضافة أصناف»',
      JSON.stringify(resolvedLegacyImport)
    );
    const normalizedBulkAdd = normalizeNavigationTarget('bulk_edit_excel', 'add_items');
    assert(
      normalizedBulkAdd.page === 'bulk_edit_excel' &&
        normalizedBulkAdd.tab === 'add_items' &&
        normalizedBulkAdd.path === '/items/bulk-edit',
      'زر الاستيراد في صفحة دليل الأصناف يفتح صفحة «تعديل بالإكسيل ← إضافة أصناف»',
      JSON.stringify(normalizedBulkAdd)
    );
  } finally {
    for (const id of createdItemIds) {
      await deleteItem(id, fullSession);
    }
    // حذف الفروع قبل الآباء
    for (let i = createdCategoryIds.length - 1; i >= 0; i--) {
      await deleteCategory(createdCategoryIds[i], fullSession);
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

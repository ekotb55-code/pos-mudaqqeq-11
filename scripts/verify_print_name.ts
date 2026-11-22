import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  saveItem,
  getItems,
  createInvoice,
  saveInvoicePrintSettings,
  getInvoicePrintSettings,
} from '../server/sheetsService';
import { ReceiptPrintArea, resolvePrintedItemName } from '../src/components/ReceiptPrintArea';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

async function run() {
  console.log('=== بدء اختبار اسم الطباعة (verify_print_name.ts) ===\n');

  const uniqueSuffix = Date.now().toString().slice(-6);
  const adminSession = { role: 'owner' as const, permissions: ['*'] as any };

  // 1) إنشاء صنف له اسم طباعة + صنف بدون اسم طباعة
  const resItem1 = await saveItem(
    {
      name: `كود_داخلي_شاي_العروسة_250جم_${uniqueSuffix}`,
      printName: 'شاي العروسة 250 جرام',
      barcode: `BC-PN-1-${uniqueSuffix}`,
      unit: 'عبوة',
      salePrice: 55,
      purchasePrice: 40,
      stockQuantity: 50,
      reorderLimit: 5,
      notes: 'وصف داخلي لا يتغير ولا يلمس',
    },
    adminSession
  );
  assert(Boolean(resItem1.success && resItem1.item), 'إنشاء الصنف الأول المزود باسم طباعة بنجاح');
  const itemWithPrintName = resItem1.item!;

  const resItem2 = await saveItem(
    {
      name: `سكر الأسرة 1 كيلو_${uniqueSuffix}`,
      printName: '',
      barcode: `BC-PN-2-${uniqueSuffix}`,
      unit: 'كيس',
      salePrice: 35,
      purchasePrice: 28,
      stockQuantity: 50,
      reorderLimit: 5,
      notes: 'وصف سكر الأسرة',
    },
    adminSession
  );
  assert(Boolean(resItem2.success && resItem2.item), 'إنشاء الصنف الثاني بدون اسم طباعة بنجاح');
  const itemWithoutPrintName = resItem2.item!;

  assert(
    itemWithPrintName.printName === 'شاي العروسة 250 جرام',
    'حفظ حقل printName على الصنف بشكل سليم'
  );
  assert(
    itemWithPrintName.notes === 'وصف داخلي لا يتغير ولا يلمس',
    'حقل الوصف (notes) بقي كما هو تمامًا بدون أي تغيير'
  );

  // إصدار فاتورة تحتوي على الصنفين
  const invoiceResult = await createInvoice(
    {
      idempotencyKey: `idem-print-name-test-${uniqueSuffix}-${Date.now()}`,
      paymentType: 'نقدي',
      customerName: 'عميل اختبار الطباعة',
      customerPhone: '01000000000',
      lines: [
        {
          itemId: itemWithPrintName.id,
          quantity: 2,
          salePriceAtSale: 55,
        },
        {
          itemId: itemWithoutPrintName.id,
          quantity: 1,
          salePriceAtSale: 35,
        },
      ],
    },
    adminSession
  );

  assert(Boolean(invoiceResult.success && invoiceResult.invoice), 'إنشاء فاتورة الاختبار بنجاح');
  const createdInvoice = invoiceResult.invoice!;
  const line1 = createdInvoice.lines.find((l) => l.itemId === itemWithPrintName.id)!;
  const line2 = createdInvoice.lines.find((l) => l.itemId === itemWithoutPrintName.id)!;

  assert(
    line1.itemPrintNameAtSale === 'شاي العروسة 250 جرام',
    'حفظ itemPrintNameAtSale في سطر الفاتورة وقت البيع من بيانات الصنف على السيرفر'
  );
  assert(
    line2.itemPrintNameAtSale === '',
    'سطر الفاتورة لصنف بدون اسم طباعة يحفظ itemPrintNameAtSale فارغًا'
  );

  const currentItems = await getItems();

  // (أ) الإعداد على «اسم الطباعة» والصنف له اسم طباعة -> النص المطبوع هو اسم الطباعة
  await saveInvoicePrintSettings({ printedItemLabel: 'printName' }, adminSession);
  const settingsPrintName = await getInvoicePrintSettings();
  assert(
    settingsPrintName.printedItemLabel === 'printName',
    '(أ-1) حفظ إعداد الاسم المطبوع للعميل = printName'
  );

  const resolvedA = resolvePrintedItemName(line1, settingsPrintName.printedItemLabel, currentItems);
  assert(
    resolvedA === 'شاي العروسة 250 جرام',
    '(أ-2) الإعداد على «اسم الطباعة» والصنف له اسم طباعة -> النص المطبوع هو اسم الطباعة'
  );

  const htmlA = renderToStaticMarkup(
    React.createElement(ReceiptPrintArea, {
      invoice: createdInvoice,
      invoicePrintSettings: settingsPrintName,
      items: currentItems,
    })
  );
  assert(
    htmlA.includes('شاي العروسة 250 جرام') && !htmlA.includes(itemWithPrintName.name),
    '(أ-3) مخرج الفاتورة المطبوعة HTML يعرض اسم الطباعة للعميل بدل الاسم الداخلي للصنف'
  );

  // (ب) الصنف اسم الطباعة فاضي -> النص المطبوع هو اسم الصنف
  const resolvedB = resolvePrintedItemName(line2, settingsPrintName.printedItemLabel, currentItems);
  assert(
    resolvedB === itemWithoutPrintName.name,
    '(ب-1) الصنف اسم الطباعة فاضي -> النص المطبوع يرجع تلقائيًا إلى اسم الصنف'
  );
  assert(
    htmlA.includes(itemWithoutPrintName.name),
    '(ب-2) مخرج الفاتورة المطبوعة HTML يعرض اسم الصنف عندما يكون اسم الطباعة فارغًا'
  );

  // (ج) تعديل اسم الطباعة بعد البيع -> إعادة طباعة الفاتورة القديمة ما زالت تعرض اسم الطباعة وقت البيع
  const resUpdated = await saveItem(
    {
      ...itemWithPrintName,
      printName: 'شاي العروسة عبوة جديدة بعد التعديل',
    },
    adminSession
  );
  assert(
    Boolean(resUpdated.success && resUpdated.item?.printName === 'شاي العروسة عبوة جديدة بعد التعديل'),
    '(ج-1) تم تعديل اسم الطباعة للصنف في الكتالوج بعد البيع'
  );

  const catalogAfterEdit = await getItems();
  const resolvedC = resolvePrintedItemName(line1, 'printName', catalogAfterEdit);
  assert(
    resolvedC === 'شاي العروسة 250 جرام',
    '(ج-2) إعادة طباعة الفاتورة القديمة ما زالت تعرض اسم الطباعة وقت البيع (itemPrintNameAtSale)'
  );

  const htmlC = renderToStaticMarkup(
    React.createElement(ReceiptPrintArea, {
      invoice: createdInvoice,
      invoicePrintSettings: settingsPrintName,
      items: catalogAfterEdit,
    })
  );
  assert(
    htmlC.includes('شاي العروسة 250 جرام') && !htmlC.includes('شاي العروسة عبوة جديدة بعد التعديل'),
    '(ج-3) مخرج إعادة طباعة الفاتورة القديمة HTML يحتفظ باسم الطباعة وقت البيع'
  );

  // (د) الإعداد على «اسم الصنف» -> النص المطبوع هو اسم الصنف كما كان
  await saveInvoicePrintSettings({ printedItemLabel: 'name' }, adminSession);
  const settingsItemName = await getInvoicePrintSettings();
  assert(
    settingsItemName.printedItemLabel === 'name',
    '(د-1) حفظ إعداد الاسم المطبوع للعميل = name'
  );

  const resolvedD = resolvePrintedItemName(line1, settingsItemName.printedItemLabel, catalogAfterEdit);
  assert(
    resolvedD === itemWithPrintName.name,
    '(د-2) الإعداد على «اسم الصنف» -> النص المطبوع هو اسم الصنف الداخلي كما كان'
  );

  const htmlD = renderToStaticMarkup(
    React.createElement(ReceiptPrintArea, {
      invoice: createdInvoice,
      invoicePrintSettings: settingsItemName,
      items: catalogAfterEdit,
    })
  );
  assert(
    htmlD.includes(itemWithPrintName.name),
    '(د-3) مخرج الفاتورة المطبوعة HTML عند اختيار «اسم الصنف» يعرض اسم الصنف كما كان'
  );

  // (هـ) صنفين بنفس اسم الطباعة -> الحفظ ينجح عادي بدون خطأ تكرار
  const sharedPrintName = `قهوة تركي محوج 100 جرام (${uniqueSuffix})`;
  const resDup1 = await saveItem(
    {
      name: `قهوة تركي محوج - مورد أ - ${uniqueSuffix}`,
      printName: sharedPrintName,
      barcode: `BC-DUP-1-${uniqueSuffix}`,
      unit: 'عبوة',
      salePrice: 60,
      purchasePrice: 45,
      stockQuantity: 20,
      reorderLimit: 2,
    },
    adminSession
  );

  const resDup2 = await saveItem(
    {
      name: `قهوة تركي محوج - مورد ب - ${uniqueSuffix}`,
      printName: sharedPrintName,
      barcode: `BC-DUP-2-${uniqueSuffix}`,
      unit: 'عبوة',
      salePrice: 62,
      purchasePrice: 46,
      stockQuantity: 15,
      reorderLimit: 2,
    },
    adminSession
  );

  assert(
    Boolean(resDup1.success && resDup2.success && resDup1.item?.id && resDup2.item?.id && resDup1.item.id !== resDup2.item.id),
    '(هـ-1) صنفين بنفس اسم الطباعة تم حفظهما بنجاح بدون خطأ تكرار'
  );
  assert(
    resDup1.item?.printName === sharedPrintName && resDup2.item?.printName === sharedPrintName,
    '(هـ-2) كلا الصنفين يحتفظان بنفس اسم الطباعة المشترك'
  );

  console.log('\n🎉 اجتازت جميع اختبارات اسم الطباعة (أ، ب، ج، د، هـ) بنجاح كامل!');
}

run().catch((err) => {
  console.error('❌ خطأ غير متوقع أثناء الاختبار:', err);
  process.exit(1);
});

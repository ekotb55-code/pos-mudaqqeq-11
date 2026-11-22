import assert from 'node:assert/strict';
import {
  getItems,
  saveCustomer,
  savePlatform,
  getCashboxes,
  getCashboxTransactions,
  createInvoice,
  getPartyLedger,
  collectCreditInvoices
} from '../server/sheetsService.ts';

async function runTests() {
  console.log('=== بدء اختبارات الفواتير الآجلة وسجل حساب الطرف وتحصيل الآجل ===\n');

  // 0. تجهيز البيانات الأساسية (صنف، عميلين، منصة، خزنة)
  const items = await getItems();
  assert(items.length > 0, 'يجب وجود أصناف للاختبار');
  const testItem = items.find(i => i.stockQuantity >= 20 && (!i.platformIds || i.platformIds.length === 0)) || items[0];
  const initialStock = testItem.stockQuantity;

  const cust1Res = await saveCustomer({
    name: 'عميل اختبار الآجل 1',
    phone: '01099990001',
    openingBalance: 0
  });
  assert(cust1Res.success && cust1Res.customer, 'فشل إنشاء العميل 1');
  const cust1 = cust1Res.customer;

  const cust2Res = await saveCustomer({
    name: 'عميل اختبار الآجل 2',
    phone: '01099990002',
    openingBalance: 0
  });
  assert(cust2Res.success && cust2Res.customer, 'فشل إنشاء العميل 2');
  const cust2 = cust2Res.customer;

  const pltRes = await savePlatform({
    name: 'منصة اختبار الآجل',
    discountPercentage: 10,
    pickupFee: 20,
    status: 'نشطة'
  });
  assert(pltRes.success && pltRes.platform, 'فشل إنشاء المنصة');
  const plt = pltRes.platform;

  const cashboxes = await getCashboxes();
  assert(cashboxes.length > 0, 'يجب وجود خزنة نشطة');
  const cashbox = cashboxes[0];
  const initialCashboxBalance = cashbox.currentBalance;
  const initialTxRes = await getCashboxTransactions(cashbox.id);
  const initialTxCount = initialTxRes.transactions.length;

  // ---------------------------------------------------------------------------
  // 1) اختبار إنشاء فاتورة آجلة على عميل + التحصيل المطابق (تحصيل مطابق)
  // ---------------------------------------------------------------------------
  console.log('1) اختبار فاتورة آجلة على عميل + تحصيل مطابق...');
  const unitPrice = 1000;
  const deliveryFee = 50;
  // إجمالي الفاتورة للعميل = 1000 + 50 = 1050، بينما الصافي = 1000 - 100 (عمولة 10%) + 50 - 20 = 930
  const invCustRes = await createInvoice({
    idempotencyKey: 'test-credit-inv-cust1',
    platformId: plt.id,
    platform: plt.name,
    paymentType: 'آجل',
    creditPartyType: 'customer',
    creditPartyId: cust1.id,
    creditPartyName: cust1.name,
    customerId: cust1.id,
    customerName: cust1.name,
    cashboxId: cashbox.id,
    deliveryFee,
    pickupFeeAmount: 20,
    totalBeforeDiscount: 1000,
    discountAmount: 100,
    netAmount: 930,
    lines: [
      {
        itemId: testItem.id,
        itemNameAtSale: testItem.name,
        quantity: 1,
        salePriceAtSale: unitPrice,
        baseUnitPrice: unitPrice,
        customerUnitPrice: unitPrice,
        bnplPercent: 0,
        bnplUnitAmount: 0,
        unitDiscountValue: 100,
        unitNet: 900
      }
    ],
    createdBy: 'مدير الاختبار'
  });

  assert(invCustRes.success && invCustRes.invoice, 'فشل إنشاء الفاتورة الآجلة للعميل');
  const invCust1 = invCustRes.invoice;

  // التحقق من حالة الفاتورة، الاستحقاق للعميل = إجمالي الفاتورة (1050)، خصم المخزون، وعدم تأثر الخزنة
  assert.equal(invCust1.status, 'معلّقة', 'يجب أن تكون حالة الفاتورة معلّقة');
  assert.equal(invCust1.creditStatus, 'معلّقة', 'يجب أن تكون حالة الآجل معلّقة');
  assert.equal(invCust1.creditDueAmount, 1050, 'مبلغ الاستحقاق للعميل يجب أن يساوي إجمالي الفاتورة (1050)');

  const itemsAfterSale1 = await getItems();
  const updatedItem1 = itemsAfterSale1.find(i => i.id === testItem.id)!;
  assert.equal(updatedItem1.stockQuantity, initialStock - 1, 'يجب خصم المخزون عند البيع الآجل');

  const cbAfterSale1 = (await getCashboxes()).find(c => c.id === cashbox.id)!;
  assert.equal(cbAfterSale1.currentBalance, initialCashboxBalance, 'لا يجب تسجيل أي حركة في الخزنة عند البيع الآجل');
  const txAfterSale1 = await getCashboxTransactions(cashbox.id);
  assert.equal(txAfterSale1.transactions.length, initialTxCount, 'عدد حركات الخزنة يجب ألا يتغير عند البيع الآجل');

  // التحقق من سجل حساب العميل قبل التحصيل
  const ledgerCust1Before = await getPartyLedger({ partyType: 'customer', partyId: cust1.id });
  assert.equal(ledgerCust1Before.currentBalance, 1050, 'رصيد العميل يجب أن يكون +1050 (مدين)');
  assert.equal(ledgerCust1Before.pendingInvoices.length, 1, 'يجب ظهور الفاتورة في قائمة الفواتير المعلّقة للعميل');

  // تنفيذ تحصيل مطابق (1050) بدون الحاجة لـ confirmDifference
  const exactCollectRes = await collectCreditInvoices({
    idempotencyKey: 'test-credit-collect-exact',
    partyType: 'customer',
    partyId: cust1.id,
    invoiceNumbers: [invCust1.invoiceNumber],
    receivedAmount: 1050,
    cashboxId: cashbox.id,
    confirmDifference: false
  });
  assert(exactCollectRes.success, `فشل التحصيل المطابق: ${exactCollectRes.error}`);
  assert.equal(exactCollectRes.partyBalance, 0, 'الرصيد بعد التحصيل المطابق يجب أن يصبح 0');

  const cbAfterExact = (await getCashboxes()).find(c => c.id === cashbox.id)!;
  assert.equal(cbAfterExact.currentBalance, initialCashboxBalance + 1050, 'يجب دخول المبلغ المستلم (1050) إلى الخزنة');

  const ledgerCust1After = await getPartyLedger({ partyType: 'customer', partyId: cust1.id });
  assert.equal(ledgerCust1After.pendingInvoices.length, 0, 'يجب اختفاء الفاتورة من المعلّقة بعد السداد');
  assert.equal(ledgerCust1After.currentBalance, 0, 'رصيد العميل يجب أن يصبح 0');
  console.log('   ✓ نجح اختبار الفاتورة الآجلة للعميل والتحصيل المطابق.\n');

  // ---------------------------------------------------------------------------
  // 2) اختبار منع التحصيل المزدوج لنفس الفاتورة بعد سدادها
  // ---------------------------------------------------------------------------
  console.log('2) اختبار منع التحصيل المزدوج لنفس الفاتورة...');
  const doubleCollectRes = await collectCreditInvoices({
    idempotencyKey: 'test-credit-collect-double',
    partyType: 'customer',
    partyId: cust1.id,
    invoiceNumbers: [invCust1.invoiceNumber],
    receivedAmount: 1050,
    cashboxId: cashbox.id,
    confirmDifference: true
  });
  assert.equal(doubleCollectRes.success, false, 'يجب رفض تحصيل فاتورة مسددة مسبقًا');
  assert.equal(doubleCollectRes.statusCode, 400, 'يجب إرجاع كود 400 عند محاولة التحصيل المزدوج');
  console.log(`   ✓ نجح منع التحصيل المزدوج (${doubleCollectRes.error}).\n`);

  // ---------------------------------------------------------------------------
  // 3) اختبار فاتورة آجلة على منصة (الاستحقاق = الصافي) + رفض بدون تأكيد + تحصيل أقل
  // ---------------------------------------------------------------------------
  console.log('3) اختبار فاتورة آجلة على منصة + رفض بدون تأكيد + تحصيل أقل (ترحيل الفرق مدين)...');
  const invPltRes1 = await createInvoice({
    idempotencyKey: 'test-credit-inv-plt1',
    platformId: plt.id,
    platform: plt.name,
    paymentType: 'آجل',
    creditPartyType: 'platform',
    creditPartyId: plt.id,
    creditPartyName: plt.name,
    cashboxId: cashbox.id,
    deliveryFee: 50,
    pickupFeeAmount: 20,
    totalBeforeDiscount: 1000,
    discountAmount: 100,
    netAmount: 930,
    lines: [
      {
        itemId: testItem.id,
        itemNameAtSale: testItem.name,
        quantity: 1,
        salePriceAtSale: 1000,
        baseUnitPrice: 1000,
        customerUnitPrice: 1000,
        taxRateAtSale: 0,
        bnplPercent: 0,
        bnplUnitAmount: 0,
        unitDiscountValue: 100,
        unitNet: 900
      }
    ],
    createdBy: 'مدير الاختبار'
  });
  assert(invPltRes1.success && invPltRes1.invoice, 'فشل إنشاء فاتورة آجلة على المنصة');
  const invPlt1 = invPltRes1.invoice;
  assert.equal(invPlt1.creditDueAmount, invPlt1.netAmount, 'مبلغ الاستحقاق للمنصة يجب أن يساوي الصافي');
  assert.equal(invPlt1.creditDueAmount, 930, 'مبلغ الاستحقاق للمنصة يجب أن يساوي الصافي (930)');

  // 3-أ: اختبار رفض فاتورة تخص طرفًا آخر (محاولة تحصيل فاتورة المنصة تحت حساب العميل 2)
  console.log('4) اختبار رفض فاتورة تخص طرفًا آخر...');
  const wrongPartyRes = await collectCreditInvoices({
    idempotencyKey: 'test-credit-collect-wrong-party',
    partyType: 'customer',
    partyId: cust2.id,
    invoiceNumbers: [invPlt1.invoiceNumber],
    receivedAmount: 930,
    cashboxId: cashbox.id,
    confirmDifference: true
  });
  assert.equal(wrongPartyRes.success, false, 'يجب رفض تحصيل فاتورة تخص طرفًا آخر');
  assert.equal(wrongPartyRes.statusCode, 400, 'يجب إرجاع كود 400 عند اختلاف الطرف');
  console.log(`   ✓ نجح رفض الفاتورة التي تخص طرفًا آخر (${wrongPartyRes.error}).\n`);

  // 3-ب: اختبار رفض التحصيل الأقل بدون تأكيد (confirmDifference: false)
  console.log('5) اختبار رفض التحصيل بفرق بدون تأكيد (confirmDifference: false)...');
  const rejectUnderWithoutConfirm = await collectCreditInvoices({
    idempotencyKey: 'test-credit-collect-under-noconfirm',
    partyType: 'platform',
    partyId: plt.id,
    invoiceNumbers: [invPlt1.invoiceNumber],
    receivedAmount: 800, // أقل بـ 130 من 930
    cashboxId: cashbox.id,
    confirmDifference: false
  });
  assert.equal(rejectUnderWithoutConfirm.success, false, 'يجب رفض الحفظ عند وجود فرق بدون تأكيد');
  assert.equal(rejectUnderWithoutConfirm.statusCode, 400, 'يجب إرجاع HTTP 400 عند عدم التأكيد');
  assert.equal(rejectUnderWithoutConfirm.requiresConfirmation, true, 'يجب إرجاع requiresConfirmation: true');
  assert(
    rejectUnderWithoutConfirm.error?.includes('المبلغ أقل من المستحق بمقدار 130') &&
      rejectUnderWithoutConfirm.error?.includes('وسيُرحَّل الفرق على'),
    `رسالة التأكيد غير مطابقة: ${rejectUnderWithoutConfirm.error}`
  );
  console.log(`   ✓ نجح رفض الحفظ بدون تأكيد (${rejectUnderWithoutConfirm.error}).\n`);

  // 3-ج: تنفيذ التحصيل الأقل مع التأكيد (confirmDifference: true)
  console.log('6) اختبار التحصيل الأقل مع التأكيد (الرصيد يبقى مدين بالفرق + حركة فرق تحصيل)...');
  const cbBeforeUnder = (await getCashboxes()).find(c => c.id === cashbox.id)!.currentBalance;
  const confirmUnderRes = await collectCreditInvoices({
    idempotencyKey: 'test-credit-collect-under-confirm',
    partyType: 'platform',
    partyId: plt.id,
    invoiceNumbers: [invPlt1.invoiceNumber],
    receivedAmount: 800, // أقل بـ 130
    cashboxId: cashbox.id,
    confirmDifference: true
  });
  assert(confirmUnderRes.success, `فشل التحصيل الأقل المؤكد: ${confirmUnderRes.error}`);
  assert.equal(confirmUnderRes.partyBalance, 130, 'الرصيد بعد التحصيل الأقل يجب أن يبقى مدينًا بالفرق (+130)');

  const cbAfterUnder = (await getCashboxes()).find(c => c.id === cashbox.id)!.currentBalance;
  assert.equal(cbAfterUnder, cbBeforeUnder + 800, 'يجب أن يدخل الخزنة المبلغ المستلم فقط (800)');

  const ledgerPltAfterUnder = await getPartyLedger({ partyType: 'platform', partyId: plt.id });
  assert.equal(ledgerPltAfterUnder.currentBalance, 130, 'رصيد المنصة من مجموع الحركات يجب أن يكون +130');
  const diffUnderEntry = ledgerPltAfterUnder.ledger.find(e => e.transactionType === 'فرق تحصيل');
  assert(diffUnderEntry, 'يجب تسجيل حركة منفصلة بنوع «فرق تحصيل»');
  assert.equal(diffUnderEntry.debit, 130, 'حركة فرق التحصيل الأقل يجب أن تكون مدين بـ 130');
  assert.equal(diffUnderEntry.credit, 0);
  console.log('   ✓ نجح اختبار التحصيل الأقل وترحيل الفرق كحركة مستقلة على الطرف.\n');

  // ---------------------------------------------------------------------------
  // 4) اختبار التحصيل الأعلى (رصيد دائن للطرف -X)
  // ---------------------------------------------------------------------------
  console.log('7) اختبار التحصيل الأعلى (يسجل كرصيد دائن للطرف)...');
  const invCust2Res = await createInvoice({
    idempotencyKey: 'test-credit-inv-cust2',
    platformId: plt.id,
    platform: plt.name,
    paymentType: 'آجل',
    creditPartyType: 'customer',
    creditPartyId: cust2.id,
    creditPartyName: cust2.name,
    customerId: cust2.id,
    customerName: cust2.name,
    cashboxId: cashbox.id,
    deliveryFee: 0,
    pickupFeeAmount: 0,
    totalBeforeDiscount: 1000,
    discountAmount: 0,
    netAmount: 1000,
    lines: [
      {
        itemId: testItem.id,
        itemNameAtSale: testItem.name,
        quantity: 1,
        salePriceAtSale: 1000,
        baseUnitPrice: 1000,
        customerUnitPrice: 1000,
        taxRateAtSale: 0,
        bnplPercent: 0,
        bnplUnitAmount: 0,
        unitDiscountValue: 0,
        unitNet: 1000
      }
    ],
    createdBy: 'مدير الاختبار'
  });
  assert(invCust2Res.success && invCust2Res.invoice, `فشل إنشاء الفاتورة للعميل 2: ${invCust2Res.error}`);
  const invCust2 = invCust2Res.invoice;
  assert.equal(invCust2.creditDueAmount, 1000);

  // محاولة تحصيل أعلى (1150 بدل 1000) بدون تأكيد -> رفض 400
  const rejectOverWithoutConfirm = await collectCreditInvoices({
    idempotencyKey: 'test-credit-collect-over-noconfirm',
    partyType: 'customer',
    partyId: cust2.id,
    invoiceNumbers: [invCust2.invoiceNumber],
    receivedAmount: 1150,
    cashboxId: cashbox.id,
    confirmDifference: false
  });
  assert.equal(rejectOverWithoutConfirm.success, false);
  assert.equal(rejectOverWithoutConfirm.statusCode, 400);
  assert(
    rejectOverWithoutConfirm.error?.includes('المبلغ أعلى من المستحق بمقدار 150') &&
      rejectOverWithoutConfirm.error?.includes('وسيُسجَّل كرصيد دائن لـ'),
    `رسالة التأكيد للتحصيل الأعلى غير مطابقة: ${rejectOverWithoutConfirm.error}`
  );

  // تأكيد التحصيل الأعلى (1150 مقابل 1000 -> رصيد دائن -150)
  const cbBeforeOver = (await getCashboxes()).find(c => c.id === cashbox.id)!.currentBalance;
  const confirmOverRes = await collectCreditInvoices({
    idempotencyKey: 'test-credit-collect-over-confirm',
    partyType: 'customer',
    partyId: cust2.id,
    invoiceNumbers: [invCust2.invoiceNumber],
    receivedAmount: 1150,
    cashboxId: cashbox.id,
    confirmDifference: true
  });
  assert(confirmOverRes.success, `فشل التحصيل الأعلى المؤكد: ${confirmOverRes.error}`);
  assert.equal(confirmOverRes.partyBalance, -150, 'الرصيد بعد التحصيل الأعلى يجب أن يصبح دائنًا (-150)');

  const cbAfterOver = (await getCashboxes()).find(c => c.id === cashbox.id)!.currentBalance;
  assert.equal(cbAfterOver, cbBeforeOver + 1150, 'يجب دخول المبلغ المستلم (1150) للخزنة');

  const ledgerCust2AfterOver = await getPartyLedger({ partyType: 'customer', partyId: cust2.id });
  assert.equal(ledgerCust2AfterOver.currentBalance, -150, 'رصيد العميل 2 يجب أن يكون -150 (دائن)');
  const diffOverEntry = ledgerCust2AfterOver.ledger.find(e => e.transactionType === 'فرق تحصيل');
  assert(diffOverEntry, 'يجب وجود حركة فرق تحصيل للعميل 2');
  assert.equal(diffOverEntry.debit, 0);
  assert.equal(diffOverEntry.credit, 150, 'حركة فرق التحصيل الأعلى يجب أن تكون دائن بـ 150');
  console.log('   ✓ نجح اختبار التحصيل الأعلى وتسجيل الرصيد الدائن (-150).\n');

  console.log('=== نجحت جميع اختبارات الفواتير الآجلة وتحصيل الآجل بنسبة 100% ===');
}

runTests().catch(err => {
  console.error('❌ فشل الاختبار:', err);
  process.exit(1);
});

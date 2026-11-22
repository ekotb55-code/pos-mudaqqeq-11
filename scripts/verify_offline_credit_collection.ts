import {
  createInvoice,
  collectCreditInvoices,
  syncOfflineOperation,
  getInvoices,
  saveItem,
  getCashboxes,
  getPartyLedger,
  saveCustomer,
  savePlatform
} from '../server/sheetsService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ فشل الاختبار: ${message}`);
  }
}

async function runTests() {
  console.log('=== بدء اختبارات المهمة 11: تحصيل الآجل من العملاء والمنصات بدون إنترنت ===\n');

  const session = {
    role: 'designer' as const,
    permissions: [] as any[],
    phone: '01000000000',
    userId: 'u-designer',
    name: 'المصمم'
  };

  const savedItemRes = await saveItem(
    {
      name: `صنف اختبار تحصيل آجل ${Date.now()}`,
      barcode: `BC-COL-${Date.now()}`,
      salePrice: 500,
      purchasePrice: 300,
      packagingCost: 0,
      stockQuantity: 100,
      taxRate: 0,
      status: 'نشط'
    },
    session
  );
  assert(Boolean(savedItemRes.success && savedItemRes.item), 'فشل إنشاء صنف الاختبار');
  const testItem = savedItemRes.item!;

  const cashboxes = await getCashboxes();
  assert(cashboxes.length > 0, 'يجب وجود خزينة واحدة على الأقل');
  const mainCashbox = cashboxes[0];

  // إعداد عميل اختباري ومنصة اختبارية
  const custRes = await saveCustomer(
    {
      name: `عميل اختبار تحصيل أوفلاين ${Date.now()}`,
      phone: '01099887766',
      openingBalance: 0
    },
    session
  );
  assert(Boolean(custRes.success && custRes.customer), 'فشل إنشاء عميل الاختبار');
  const testCustomer = custRes.customer!;

  const platRes = await savePlatform(
    {
      name: `منصة اختبار تحصيل أوفلاين ${Date.now()}`,
      discountPercentage: 10,
      pickupFee: 0,
      enableBnpl: false,
      bnplPercentage: 0,
      status: 'نشطة'
    },
    session
  );
  assert(Boolean(platRes.success && platRes.platform), 'فشل إنشاء منصة الاختبار');
  const testPlatform = platRes.platform!;

  // =========================================================================
  // 1) الاختبار الأول: تحصيل أوفلاين ثم مزامنة -> الفاتورة تصبح مسددة والرصيد يتحدث
  // =========================================================================
  console.log('1) اختبار: تحصيل آجل أوفلاين ثم مزامنة -> الفاتورة تصبح مسددة والرصيد والخزنة يتحدثان...');

  const inv1Key = crypto.randomUUID();
  const inv1Res = await createInvoice(
    {
      idempotencyKey: inv1Key,
      platformId: 'direct',
      platformName: 'البيع المباشر',
      paymentType: 'آجل',
      creditPartyType: 'customer',
      customerId: testCustomer.id,
      customerName: testCustomer.name,
      lines: [
        {
          itemId: testItem.id,
          itemNameAtSale: testItem.name,
          quantity: 1,
          salePriceAtSale: 200,
          baseUnitPrice: 200
        }
      ]
    },
    session
  );
  assert(Boolean(inv1Res.success && inv1Res.invoice), `فشل إنشاء فاتورة آجلة للعميل: ${inv1Res.error}`);
  const inv1 = inv1Res.invoice!;
  assert(inv1.status === 'معلّقة' && inv1.creditStatus === 'معلّقة', 'يجب أن تكون الفاتورة معلّقة قبل التحصيل');

  const ledgerBefore1 = await getPartyLedger({ partyType: 'customer', partyId: testCustomer.id }, session);
  const due1 = Number(inv1.creditDueAmount || inv1.netAmount);
  assert(Math.abs(Number(ledgerBefore1.currentBalance) - due1) < 0.01, `رصيد العميل قبل التحصيل يجب أن يساوي ${due1}`);

  const cbBefore1 = (await getCashboxes()).find(c => c.id === mainCashbox.id)!;
  const cbBalBefore1 = Number(cbBefore1.currentBalance);

  // محاكاة عملية تحصيل آجل سُجلت أوفلاين في outbox ثم رُفعت عبر syncOfflineOperation
  const offlineColKey1 = crypto.randomUUID();
  const syncColRes1 = await syncOfflineOperation(
    {
      id: offlineColKey1,
      idempotencyKey: offlineColKey1,
      type: 'collectCredit',
      operationType: 'collectCreditInvoices',
      deviceId: 'DEV-POS-01',
      deviceName: 'كاشير الفرع 1',
      deviceTime: new Date(Date.now() - 60000).toISOString(),
      payload: {
        type: 'collectCredit',
        operationType: 'collectCreditInvoices',
        partyType: 'customer',
        partyId: testCustomer.id,
        invoiceNumbers: [inv1.invoiceNumber],
        receivedAmount: due1,
        cashboxId: mainCashbox.id,
        confirmDifference: true,
        notes: 'تحصيل أوفلاين كامل'
      }
    },
    session
  );

  assert(syncColRes1.success === true, `فشل مزامنة تحصيل الآجل الأوفلاين: ${syncColRes1.error}`);
  assert(!syncColRes1.needsReview, 'التحصيل العادي الأول لا يجب أن يُعلَّم بـ needsReview');
  assert(
    Array.isArray(syncColRes1.settledInvoices) && syncColRes1.settledInvoices.includes(inv1.invoiceNumber),
    'يجب أن تتضمن settledInvoices رقم الفاتورة المحصلة'
  );

  const allInvoicesAfter1 = await getInvoices(session);
  const updatedInv1 = allInvoicesAfter1.find(i => i.invoiceNumber === inv1.invoiceNumber)!;
  assert(updatedInv1.status === 'مسددة' && updatedInv1.creditStatus === 'مسددة', 'يجب أن تصبح الفاتورة مسددة بعد المزامنة');
  assert(Number(updatedInv1.remainingAmount || 0) === 0, 'يجب أن يصبح المتبقي صفرًا بعد التحصيل');

  const ledgerAfter1 = await getPartyLedger({ partyType: 'customer', partyId: testCustomer.id }, session);
  assert(Math.abs(Number(ledgerAfter1.currentBalance)) < 0.01, `رصيد العميل بعد التحصيل الكامل يجب أن يصبح 0 (الحالي: ${ledgerAfter1.currentBalance})`);

  const cbAfter1 = (await getCashboxes()).find(c => c.id === mainCashbox.id)!;
  assert(
    Math.abs(Number(cbAfter1.currentBalance) - (cbBalBefore1 + due1)) < 0.01,
    `رصيد الخزنة يجب أن يزيد بمقدار ${due1}`
  );
  console.log('   ✅ نجح: الفاتورة أصبحت «مسددة» وتحدث رصيد العميل والخزنة بدقة.');

  // =========================================================================
  // 2) الاختبار الثاني: تحصيل نفس الفاتورة من جهازين
  //    الأول تحصيل عادي، والثاني رصيد دائن للطرف مع needsReview وسبب «تحصيل مكرر» ولا تُرفض العملية
  // =========================================================================
  console.log('2) اختبار: تحصيل نفس الفاتورة من جهازين -> الأول تحصيل عادي والثاني رصيد دائن مع needsReview وسبب «تحصيل مكرر»...');

  const inv2Key = crypto.randomUUID();
  const inv2Res = await createInvoice(
    {
      idempotencyKey: inv2Key,
      platformId: 'direct',
      platformName: 'البيع المباشر',
      paymentType: 'آجل',
      creditPartyType: 'customer',
      customerId: testCustomer.id,
      customerName: testCustomer.name,
      lines: [
        {
          itemId: testItem.id,
          itemNameAtSale: testItem.name,
          quantity: 1,
          salePriceAtSale: 500,
          baseUnitPrice: 500
        }
      ]
    },
    session
  );
  assert(Boolean(inv2Res.success && inv2Res.invoice), `فشل إنشاء الفاتورة الآجلة الثانية: ${inv2Res.error}`);
  const inv2 = inv2Res.invoice!;
  const due2 = Number(inv2.creditDueAmount || inv2.netAmount);
  assert(due2 === 500, `المستحق المتوقع 500 ج.م (الفعلي: ${due2})`);

  const cbBefore2 = (await getCashboxes()).find(c => c.id === mainCashbox.id)!;
  const cbBalBefore2 = Number(cbBefore2.currentBalance);

  // الجهاز الأول يحصّل الفاتورة بشكل عادي
  const dev1ColKey = crypto.randomUUID();
  const dev1ColRes = await collectCreditInvoices(
    {
      idempotencyKey: dev1ColKey,
      partyType: 'customer',
      partyId: testCustomer.id,
      invoiceNumbers: [inv2.invoiceNumber],
      receivedAmount: 500,
      cashboxId: mainCashbox.id,
      confirmDifference: false,
      notes: 'تحصيل من الجهاز الأول'
    },
    session
  );
  assert(dev1ColRes.success === true, 'يجب أن ينجح تحصيل الجهاز الأول');
  assert(!dev1ColRes.needsReview, 'تحصيل الجهاز الأول لا يحتاج مراجعة');
  assert(Number(dev1ColRes.partyBalance) === 0, 'رصيد العميل بعد تحصيل الجهاز الأول يجب أن يصبح 0');

  // الجهاز الثاني (كان أوفلاين وقت تحصيل الجهاز الأول) يرفع تحصيلًا لنفس الفاتورة
  const dev2ColKey = crypto.randomUUID();
  const dev2SyncRes = await syncOfflineOperation(
    {
      id: dev2ColKey,
      idempotencyKey: dev2ColKey,
      type: 'collectCredit',
      operationType: 'collectCreditInvoices',
      deviceId: 'DEV-POS-02',
      deviceName: 'كاشير الفرع 2',
      deviceTime: new Date().toISOString(),
      payload: {
        type: 'collectCredit',
        operationType: 'collectCreditInvoices',
        partyType: 'customer',
        partyId: testCustomer.id,
        invoiceNumbers: [inv2.invoiceNumber],
        receivedAmount: 500,
        cashboxId: mainCashbox.id,
        confirmDifference: true,
        notes: 'تحصيل أوفلاين من الجهاز الثاني لنفس الفاتورة'
      }
    },
    session
  );

  // التحقق أن العملية لم تُرفض وسُجلت كرصيد دائن للطرف مع needsReview وسبب «تحصيل مكرر»
  assert(dev2SyncRes.success === true, `لا يجوز رفض عملية التحصيل الأوفلاين المكررة! الخطأ: ${dev2SyncRes.error}`);
  assert(dev2SyncRes.needsReview === true, 'يجب تعليم العملية الثانية بـ needsReview: true');
  assert(
    Array.isArray(dev2SyncRes.reviewReasons) && dev2SyncRes.reviewReasons.includes('تحصيل مكرر'),
    `يجب أن يتضمن سبب المراجعة «تحصيل مكرر»، الفعلي: ${JSON.stringify(dev2SyncRes.reviewReasons)}`
  );
  assert(
    Array.isArray(dev2SyncRes.duplicateCollectionInvoices) &&
      dev2SyncRes.duplicateCollectionInvoices.includes(inv2.invoiceNumber),
    'يجب إدراج الفاتورة ضمن duplicateCollectionInvoices'
  );

  // رصيد العميل يجب أن يصبح دائنًا له بمقدار 500 (-500)
  assert(
    Math.abs(Number(dev2SyncRes.partyBalance) - -500) < 0.01,
    `يجب تسجيل المبلغ كرصيد دائن للعميل (-500 ج.م)، الفعلي: ${dev2SyncRes.partyBalance}`
  );

  const ledgerAfter2 = await getPartyLedger({ partyType: 'customer', partyId: testCustomer.id }, session);
  assert(
    Math.abs(Number(ledgerAfter2.currentBalance) - -500) < 0.01,
    `الرصيد في كشف حساب الطرف يجب أن يكون -500 ج.م (رصيد دائن للطرف)، الفعلي: ${ledgerAfter2.currentBalance}`
  );
  const dupLedgerEntry = (ledgerAfter2.ledger || []).find(
    e => e.transactionType === 'تحصيل مكرر' && Number(e.credit) === 500
  );
  assert(Boolean(dupLedgerEntry), 'يجب وجود قيد «تحصيل مكرر» دائن بقيمة 500 ج.م في سجل حساب الطرف');
  assert(
    dupLedgerEntry?.needsReview === true && dupLedgerEntry?.reviewReasons?.includes('تحصيل مكرر'),
    'يجب أن يحمل قيد السجل needsReview: true وسبب «تحصيل مكرر»'
  );

  // التحقق من تعليم الفاتورة نفسها بـ needsReview وسبب «تحصيل مكرر»
  const allInvoicesAfter2 = await getInvoices(session);
  const updatedInv2 = allInvoicesAfter2.find(i => i.invoiceNumber === inv2.invoiceNumber)!;
  assert(updatedInv2.needsReview === true, 'يجب تعليم الفاتورة نفسها بـ needsReview: true');
  assert(
    Array.isArray(updatedInv2.reviewReasons) && updatedInv2.reviewReasons.includes('تحصيل مكرر'),
    'يجب أن تحمل الفاتورة سبب المراجعة «تحصيل مكرر»'
  );

  // التحقق أن الخزنة دخلها المبلغان (500 + 500 = 1000)
  const cbAfter2 = (await getCashboxes()).find(c => c.id === mainCashbox.id)!;
  assert(
    Math.abs(Number(cbAfter2.currentBalance) - (cbBalBefore2 + 1000)) < 0.01,
    'يجب أن يدخل الخزنة إجمالي المبلغين المستلمين من الجهازين (1000 ج.م)'
  );
  console.log('   ✅ نجح: الجهاز الأول حصّل الفاتورة عاديًا، والجهاز الثاني سُجّل تحصيله كرصيد دائن (-500 ج.م) مع needsReview وسبب «تحصيل مكرر».');

  // =========================================================================
  // 3) الاختبار الثالث: فاتورة منصة آجلة أُنشئت أوفلاين برقم مؤقت (OFF-...) وحُصّلت أوفلاين ثم رُفعتا بالتسلسل
  // =========================================================================
  console.log('3) اختبار: إنشاء فاتورة منصة آجلة أوفلاين برقم مؤقت ثم تحصيلها أوفلاين ومزامنتهما بالتسلسل...');

  const provisionalPlatInvNo = 'OFF-DEV1-20261115-0099';
  const platInvKey = crypto.randomUUID();
  const syncPlatInvRes = await syncOfflineOperation(
    {
      id: platInvKey,
      idempotencyKey: platInvKey,
      type: 'createInvoice',
      operationType: 'createInvoice',
      offlineProvisionalNo: provisionalPlatInvNo,
      deviceId: 'DEV1',
      deviceTime: new Date(Date.now() - 120000).toISOString(),
      payload: {
        platformId: testPlatform.id,
        platformName: testPlatform.name,
        paymentType: 'آجل',
        creditPartyType: 'platform',
        creditPartyId: testPlatform.id,
        creditPartyName: testPlatform.name,
        lines: [
          {
            itemId: testItem.id,
            itemNameAtSale: testItem.name,
            quantity: 1,
            salePriceAtSale: 300,
            baseUnitPrice: 300
          }
        ]
      }
    },
    session
  );
  assert(Boolean(syncPlatInvRes.success && syncPlatInvRes.invoice), 'فشل مزامنة فاتورة المنصة الأوفلاين');
  const syncedPlatInv = syncPlatInvRes.invoice!;
  const platNetDue = Number(syncedPlatInv.netAmount);

  // الآن نرفع عملية تحصيل أوفلاين كانت تشير للرقم المؤقت provisionalPlatInvNo
  const platColKey = crypto.randomUUID();
  const syncPlatColRes = await syncOfflineOperation(
    {
      id: platColKey,
      idempotencyKey: platColKey,
      type: 'collectCredit',
      operationType: 'collectCreditInvoices',
      deviceId: 'DEV1',
      deviceTime: new Date(Date.now() - 60000).toISOString(),
      payload: {
        partyType: 'platform',
        partyId: testPlatform.id,
        invoiceNumbers: [provisionalPlatInvNo],
        receivedAmount: platNetDue,
        cashboxId: mainCashbox.id,
        confirmDifference: true
      }
    },
    session
  );
  assert(syncPlatColRes.success === true, `فشل تحصيل فاتورة المنصة بالرقم المؤقت: ${syncPlatColRes.error}`);
  assert(
    Array.isArray(syncPlatColRes.settledInvoices) &&
      syncPlatColRes.settledInvoices.includes(syncedPlatInv.invoiceNumber),
    'يجب ربط الرقم المؤقت بالرقم النهائي للفاتورة وتسديدها'
  );
  console.log('   ✅ نجح: ربط الرقم المؤقت للفاتورة بالرقم النهائي عند تحصيل آجل المنصة أوفلاين.');

  console.log('\n🎉 اكتملت جميع اختبارات المهمة 11 بنجاح تام!');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

import assert from 'node:assert/strict';
import {
  syncOfflineOperation,
  getInvoices,
  getItems,
  saveItem,
  getAuditLogs
} from '../server/sheetsService.ts';
import { ALL_PERMISSIONS } from '../src/utils/permissions.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, details?: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${name}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${name}${details ? ` — ${details}` : ''}`);
  }
}

const designerSession = {
  token: 'test-designer-token',
  role: 'designer' as const,
  permissions: ALL_PERMISSIONS,
  phone: '01000000000',
  userId: 'u-designer',
  name: 'مصمم النظام'
};

async function runTests() {
  console.log('================================================================');
  console.log('اختبار محرك مزامنة العمليات الأوفلاين (/api/offline/sync)');
  console.log('================================================================\n');

  const initialItems = await getItems(designerSession);
  const testItem = initialItems[0];
  assert(testItem, 'يجب وجود صنف واحد على الأقل للاختبار');

  // ---------------------------------------------------------------------------
  // 1. إرسال نفس العملية مرتين = فاتورة واحدة فقط (Idempotency)
  // ---------------------------------------------------------------------------
  console.log('1) اختبار: إرسال نفس العملية الأوفلاين مرتين = فاتورة واحدة فقط');
  const idemKey1 = `idem-offline-dup-${Date.now()}`;
  const provNo1 = 'OFF-DEV1-20261115-0001';
  const deviceTime1 = new Date().toISOString();
  const stockBefore1 = testItem.stockQuantity;

  const opPayload1 = {
    idempotencyKey: idemKey1,
    offlineProvisionalNo: provNo1,
    offlineDeviceId: 'dev-uuid-1234',
    deviceTime: deviceTime1,
    paymentType: 'نقدي',
    platform: 'البيع المباشر',
    platformId: 'direct',
    createdBy: 'كاشير الفرع 1',
    lines: [
      {
        itemId: testItem.id,
        itemNameAtSale: testItem.name,
        quantity: 1,
        salePriceAtSale: testItem.salePrice,
        baseUnitPrice: testItem.salePrice,
        taxRateAtSale: testItem.taxRate || 0
      }
    ]
  };

  const res1A = await syncOfflineOperation(opPayload1, designerSession);
  const res1B = await syncOfflineOperation(opPayload1, designerSession);

  const allInvoicesAfter1 = await getInvoices(designerSession);
  const matchingInvoices1 = allInvoicesAfter1.filter(inv => inv.idempotencyKey === idemKey1);
  const itemsAfter1 = await getItems(designerSession);
  const updatedItem1 = itemsAfter1.find(i => i.id === testItem.id)!;

  check('الاستدعاء الأول ينجح ويولّد رقم فاتورة نهائي INV-...', Boolean(res1A.success && res1A.finalInvoiceNumber?.startsWith('INV-')));
  check('حفظ الرقم المؤقت بجانب الرقم النهائي في الفاتورة', res1A.invoice?.offlineProvisionalNo === provNo1);
  check('حفظ وقت الجهاز ووقت الاستلام معًا', Boolean(res1A.invoice?.deviceTime === deviceTime1 && res1A.invoice?.receivedAt));
  check('الاستدعاء الثاني بنفس المفتاح يرجع duplicate: true ونفس الفاتورة', Boolean(res1B.success && res1B.duplicate === true && res1B.finalInvoiceNumber === res1A.finalInvoiceNumber));
  check('عدد الفواتير المنشأة بهذا المفتاح في السجل = 1 فقط', matchingInvoices1.length === 1);
  check('المخزون خُصم مرة واحدة فقط وليس مرتين', updatedItem1.stockQuantity === stockBefore1 - 1);

  const auditLogs1 = await getAuditLogs();
  const offlineAuditLog = auditLogs1.find(l => l.action === 'OFFLINE_INVOICE_SYNC' && l.targetId === res1A.finalInvoiceNumber);
  check('تسجيل العملية المرفوعة في سجل التدقيق كعملية أوفلاين (OFFLINE_INVOICE_SYNC)', Boolean(offlineAuditLog));

  // ---------------------------------------------------------------------------
  // 2. فاتورة أوفلاين بكمية لا تكفي + أسباب المراجعة الخمسة = تُحفظ مع علامة المراجعة
  // ---------------------------------------------------------------------------
  console.log('\n2) اختبار: فاتورة أوفلاين بكمية لا تكفي وباقي أسباب المراجعة = تُحفظ مع علامة المراجعة ولا تُرفض');

  // إنشاء صنف خاص للاختبار برصيد 2 فقط وسعر 200 ج.م
  const savedSpecialItemRes = await saveItem(
    {
      name: `صنف اختبار أوفلاين ${Date.now()}`,
      salePrice: 200,
      purchasePrice: 120,
      packagingCost: 10,
      stockQuantity: 2,
      taxRate: 14,
      status: 'نشط'
    },
    designerSession
  );
  assert(savedSpecialItemRes.success && savedSpecialItemRes.item);
  const specialItem = savedSpecialItemRes.item;

  // أ) بيع أوفلاين بكمية 5 (أكبر من المتاح 2) وبسعر وقت البيع 180 (تغير السعر بعد البيع إلى 200)
  // ووقت جهاز متأخر 25 دقيقة، ومستخدم موقوف
  const idemKey2 = `idem-offline-review-${Date.now()}`;
  const provNo2 = 'OFF-DEV1-20261115-0002';
  const oldDeviceTime = new Date(Date.now() - 25 * 60 * 1000).toISOString(); // قبل 25 دقيقة

  const res2 = await syncOfflineOperation(
    {
      idempotencyKey: idemKey2,
      offlineProvisionalNo: provNo2,
      offlineDeviceId: 'dev-uuid-1234',
      deviceTime: oldDeviceTime,
      paymentType: 'نقدي',
      platform: 'البيع المباشر',
      platformId: 'direct',
      createdBy: 'موظف موقوف',
      lines: [
        {
          itemId: specialItem.id,
          itemNameAtSale: specialItem.name,
          quantity: 5, // المتاح 2 فقط -> رصيد سالب (-3)
          salePriceAtSale: 180, // السعر الحالي في الخادم 200 -> سعر الصنف تغيّر بعد البيع
          baseUnitPrice: 180,
          taxRateAtSale: 14
        }
      ]
    },
    {
      ...designerSession,
      userSuspended: true // المستخدم موقوف وقت الرفع
    }
  );

  check('الفاتورة لا تُرفض رغم نقص الرصيد وتغير السعر وإيقاف المستخدم وفرق الوقت', res2.success === true);
  check('الفاتورة تُعلّم بـ needsReview: true', res2.invoice?.needsReview === true);
  check('استخدام سعر الفاتورة كما سُجل وقت البيع (180 × 5 = 900 ج.م)', res2.invoice?.totalBeforeDiscount === 900);
  check('سبب المراجعة يتضمن «رصيد سالب»', Boolean(res2.reviewReasons?.includes('رصيد سالب')));
  check('سبب المراجعة يتضمن «سعر الصنف تغيّر بعد البيع»', Boolean(res2.reviewReasons?.includes('سعر الصنف تغيّر بعد البيع')));
  check('سبب المراجعة يتضمن «المستخدم موقوف»', Boolean(res2.reviewReasons?.includes('المستخدم موقوف')));
  check('سبب المراجعة يتضمن «فرق في وقت الجهاز أكثر من 10 دقائق»', Boolean(res2.reviewReasons?.includes('فرق في وقت الجهاز أكثر من 10 دقائق')));

  const itemsAfter2 = await getItems(designerSession);
  const specialAfter2 = itemsAfter2.find(i => i.id === specialItem.id)!;
  check('السماح بالرصيد السالب لهذه العملية الأوفلاين (الرصيد أصبح -3)', specialAfter2.stockQuantity === -3);

  // ب) اختبار الصنف الموقوف أو المحذوف
  const idemKeyDeletedItem = `idem-offline-deleted-item-${Date.now()}`;
  const resDeletedItem = await syncOfflineOperation(
    {
      idempotencyKey: idemKeyDeletedItem,
      offlineProvisionalNo: 'OFF-DEV1-20261115-0003',
      offlineDeviceId: 'dev-uuid-1234',
      deviceTime: new Date().toISOString(),
      paymentType: 'نقدي',
      platform: 'البيع المباشر',
      platformId: 'direct',
      lines: [
        {
          itemId: 'deleted-item-id-999',
          itemNameAtSale: 'صنف حُذف بعد البيع أوفلاين',
          quantity: 2,
          salePriceAtSale: 150,
          baseUnitPrice: 150,
          purchasePriceAtSale: 100,
          packagingCostAtSale: 5,
          taxRateAtSale: 0
        }
      ]
    },
    designerSession
  );

  check('الفاتورة الأوفلاين لصنف محذوف لا تُرفض وتُحفظ بنجاح', resDeletedItem.success === true);
  check('سبب المراجعة يتضمن «الصنف موقوف أو محذوف»', Boolean(resDeletedItem.reviewReasons?.includes('الصنف موقوف أو محذوف')));

  // ج) اختبار رفض البيانات التالفة فقط مع سبب عربي واضح
  const corruptRes1 = await syncOfflineOperation(
    {
      idempotencyKey: `idem-corrupt-1-${Date.now()}`,
      offlineProvisionalNo: 'OFF-CORRUPT-1',
      lines: [] // بدون أصناف
    },
    designerSession
  );
  check('رفض العملية إذا كانت البيانات تالفة (خطوط فارغة) مع رسالة عربية', corruptRes1.success === false && Boolean(corruptRes1.error?.includes('بيانات الفاتورة تالفة')));

  const corruptRes2 = await syncOfflineOperation(
    {
      idempotencyKey: `idem-corrupt-2-${Date.now()}`,
      offlineProvisionalNo: 'OFF-CORRUPT-2',
      lines: [{ itemId: specialItem.id, quantity: -2, salePriceAtSale: 100 }]
    },
    designerSession
  );
  check('رفض العملية إذا كانت الكمية سالبة أو صفرية مع رسالة عربية', corruptRes2.success === false && Boolean(corruptRes2.error?.includes('بيانات الفاتورة تالفة')));

  // ---------------------------------------------------------------------------
  // 3. قطع الاتصال في منتصف المزامنة ثم إعادته = لا ضياع ولا تكرار
  // ---------------------------------------------------------------------------
  console.log('\n3) اختبار: قطع الاتصال في منتصف المزامنة ثم إعادته = لا ضياع ولا تكرار');

  // محاكاة طابور outbox به 3 عمليات مرتبة زمنيًا
  const batchTimestamp = Date.now();
  const simulatedOutbox = [
    {
      id: `idem-batch-1-${batchTimestamp}`,
      idempotencyKey: `idem-batch-1-${batchTimestamp}`,
      provisionalNo: 'OFF-DEV1-20261115-0101',
      createdAt: '2026-11-15T10:01:00.000Z',
      retryCount: 0,
      payload: {
        idempotencyKey: `idem-batch-1-${batchTimestamp}`,
        offlineProvisionalNo: 'OFF-DEV1-20261115-0101',
        offlineDeviceId: 'dev-uuid-1234',
        deviceTime: '2026-11-15T10:01:00.000Z',
        paymentType: 'نقدي',
        platform: 'البيع المباشر',
        platformId: 'direct',
        lines: [{ itemId: testItem.id, itemNameAtSale: testItem.name, quantity: 1, salePriceAtSale: 100, baseUnitPrice: 100 }]
      }
    },
    {
      id: `idem-batch-2-${batchTimestamp}`,
      idempotencyKey: `idem-batch-2-${batchTimestamp}`,
      provisionalNo: 'OFF-DEV1-20261115-0102',
      createdAt: '2026-11-15T10:02:00.000Z',
      retryCount: 0,
      payload: {
        idempotencyKey: `idem-batch-2-${batchTimestamp}`,
        offlineProvisionalNo: 'OFF-DEV1-20261115-0102',
        offlineDeviceId: 'dev-uuid-1234',
        deviceTime: '2026-11-15T10:02:00.000Z',
        paymentType: 'نقدي',
        platform: 'البيع المباشر',
        platformId: 'direct',
        lines: [{ itemId: testItem.id, itemNameAtSale: testItem.name, quantity: 2, salePriceAtSale: 100, baseUnitPrice: 100 }]
      }
    },
    {
      id: `idem-batch-3-${batchTimestamp}`,
      idempotencyKey: `idem-batch-3-${batchTimestamp}`,
      provisionalNo: 'OFF-DEV1-20261115-0103',
      createdAt: '2026-11-15T10:03:00.000Z',
      retryCount: 0,
      payload: {
        idempotencyKey: `idem-batch-3-${batchTimestamp}`,
        offlineProvisionalNo: 'OFF-DEV1-20261115-0103',
        offlineDeviceId: 'dev-uuid-1234',
        deviceTime: '2026-11-15T10:03:00.000Z',
        paymentType: 'نقدي',
        platform: 'البيع المباشر',
        platformId: 'direct',
        lines: [{ itemId: testItem.id, itemNameAtSale: testItem.name, quantity: 3, salePriceAtSale: 100, baseUnitPrice: 100 }]
      }
    }
  ];

  const provisionalToFinalMap: Record<string, string> = {};
  const executionOrder: string[] = [];

  // الجولة الأولى من المزامنة:
  // العملية 1 تنجح وتُحذف من الطابور.
  // العملية 2 تصل للخادم وتُحفظ هناك ولكن ينقطع الاتصال قبل وصول الرد للجهاز! (أخطر حالة انقطاع).
  // العملية 3 لا تُرسل بعد لأن المزامنة تتوقف عند انقطاع الاتصال.
  let round1SimulatedDropOnOp2 = true;
  for (const op of [...simulatedOutbox].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    executionOrder.push(op.provisionalNo);
    const serverRes = await syncOfflineOperation(op.payload, designerSession);
    if (op.provisionalNo === 'OFF-DEV1-20261115-0102' && round1SimulatedDropOnOp2) {
      // الخادم حفظ العملية 2 بالفعل، لكن الشبكة انقطعت قبل وصول التأكيد للواجهة!
      // لذلك لا نحذف العملية 2 من الجهاز ونزيد عداد المحاولات بنفس المفتاح
      op.retryCount += 1;
      break;
    }
    if (serverRes.success && serverRes.finalInvoiceNumber) {
      provisionalToFinalMap[op.provisionalNo] = serverRes.finalInvoiceNumber;
      const idx = simulatedOutbox.findIndex(x => x.id === op.id);
      if (idx >= 0) simulatedOutbox.splice(idx, 1);
    }
  }

  check('بعد انقطاع الاتصال في منتصف المزامنة: العملية 1 حُذفت بعد التأكيد وبقيت العمليتان 2 و 3 في الجهاز', simulatedOutbox.length === 2);
  check('العملية 2 احتفظت بنفس مفتاح منع التكرار (idempotencyKey) مع زيادة retryCount', simulatedOutbox[0].idempotencyKey === `idem-batch-2-${batchTimestamp}` && simulatedOutbox[0].retryCount === 1);

  // الجولة الثانية بعد رجوع الاتصال:
  // يعاد إرسال العملية 2 بنفس المفتاح (يرد الخادم بتأكيدها بدون تكرار)، ثم تُرسل العملية 3 وتُؤكد.
  round1SimulatedDropOnOp2 = false;
  for (const op of [...simulatedOutbox].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    executionOrder.push(op.provisionalNo);
    const serverRes = await syncOfflineOperation(op.payload, designerSession);
    if (serverRes.success && serverRes.finalInvoiceNumber) {
      provisionalToFinalMap[op.provisionalNo] = serverRes.finalInvoiceNumber;
      const idx = simulatedOutbox.findIndex(x => x.id === op.id);
      if (idx >= 0) simulatedOutbox.splice(idx, 1);
    }
  }

  const allInvoicesAfterBatch = await getInvoices(designerSession);
  const batchInvoicesOnServer = allInvoicesAfterBatch.filter(inv =>
    inv.idempotencyKey === `idem-batch-1-${batchTimestamp}` ||
    inv.idempotencyKey === `idem-batch-2-${batchTimestamp}` ||
    inv.idempotencyKey === `idem-batch-3-${batchTimestamp}`
  );

  check('بعد رجوع الاتصال واستكمال المزامنة: طابور outbox أصبح فارغًا بالكامل (0 معلّقة)', simulatedOutbox.length === 0);
  check('إرسال العمليات تم بترتيب تسجيلها الزمني بدقة', executionOrder.join(' -> ') === 'OFF-DEV1-20261115-0101 -> OFF-DEV1-20261115-0102 -> OFF-DEV1-20261115-0102 -> OFF-DEV1-20261115-0103');
  check('لا ضياع ولا تكرار: عدد الفواتير المسجلة في الخادم للعمليات الثلاث = 3 فواتير بالضبط', batchInvoicesOnServer.length === 3);
  check(
    'حفظ الرقم النهائي بجانب الرقم المؤقت لجميع العمليات الثلاث',
    Boolean(
      provisionalToFinalMap['OFF-DEV1-20261115-0101']?.startsWith('INV-') &&
      provisionalToFinalMap['OFF-DEV1-20261115-0102']?.startsWith('INV-') &&
      provisionalToFinalMap['OFF-DEV1-20261115-0103']?.startsWith('INV-')
    )
  );

  console.log('\n================================================================');
  console.log(`النتيجة النهائية: ${passed} نجح | ${failed} فشل`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('خطأ غير متوقع أثناء تشغيل الاختبارات:', err);
  process.exit(1);
});

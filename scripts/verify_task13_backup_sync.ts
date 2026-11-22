import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_PERMISSIONS, ROLE_TEMPLATES } from '../src/utils/permissions';
import {
  getBackupJsonlFileName,
  selectBackupDirectory,
  getBackupDirectoryStatus,
  activateBackupDirectoryPermission,
  createOfflineInvoiceInDb,
  createOfflineCreditCollectionInDb,
  checkStorageQuotaStatus,
  setStorageEstimateOverrideForTest,
  triggerHourlyPendingOperationsAlert,
  canPerformFinalLogoutOrClearData,
  clearLocalApplicationDataSafely,
  getOutboxSummaryForSyncScreen,
  exportOutboxToJsonlString,
  importJsonlBackupAndSync,
  saveOfflineSnapshot,
  getOutboxOperations,
  applyReviewedInvoiceToLocalDb
} from '../src/offline/db';
import { syncOfflineOperation, markOfflineInvoiceReviewed, getItems } from '../server/sheetsService';
import type { UserAccount, Item, Platform } from '../src/types';

function setupMockIndexedDB() {
  const stores = new Map<string, { keyPath: string; records: Map<string, any> }>();

  function clonePreservingHandles(val: any): any {
    if (val === null || val === undefined || typeof val !== 'object') return val;
    if (typeof CryptoKey !== 'undefined' && val instanceof CryptoKey) return val;
    if ('type' in val && 'extractable' in val && 'algorithm' in val && 'usages' in val) {
      return val;
    }
    if (typeof val.queryPermission === 'function' || typeof val.getFileHandle === 'function') {
      return val;
    }
    if (Array.isArray(val)) {
      return val.map(item => clonePreservingHandles(item));
    }
    const copy: any = {};
    for (const [k, v] of Object.entries(val)) {
      copy[k] = clonePreservingHandles(v);
    }
    return copy;
  }

  function makeRequest<T>(executor: () => T): any {
    const req: any = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null
    };
    queueMicrotask(() => {
      try {
        req.result = executor();
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      } catch (err) {
        req.error = err;
        if (typeof req.onerror === 'function') req.onerror({ target: req });
      }
    });
    return req;
  }

  const dbObj: any = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name)
    },
    createObjectStore: (name: string, opts: { keyPath: string }) => {
      const storeData = { keyPath: opts.keyPath, records: new Map<string, any>() };
      stores.set(name, storeData);
      return {
        createIndex: () => {}
      };
    },
    transaction: (_storeNames: string[], _mode?: string, _opts?: any) => {
      const tx: any = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore: (name: string) => {
          const s = stores.get(name)!;
          return {
            get: (key: string) =>
              makeRequest(() => {
                const v = s.records.get(String(key));
                return v !== undefined ? clonePreservingHandles(v) : undefined;
              }),
            getAll: (filterVal?: string) =>
              makeRequest(() => {
                const all = Array.from(s.records.values()).map(v => clonePreservingHandles(v));
                if (filterVal !== undefined) {
                  return all.filter(item => item.status === filterVal);
                }
                return all;
              }),
            put: (val: any) =>
              makeRequest(() => {
                const k = String(val[s.keyPath]);
                s.records.set(k, clonePreservingHandles(val));
                return k;
              }),
            delete: (key: string) =>
              makeRequest(() => {
                s.records.delete(String(key));
                return undefined;
              }),
            clear: () =>
              makeRequest(() => {
                s.records.clear();
                return undefined;
              }),
            index: (idxName: string) => ({
              getAll: (val?: string) =>
                makeRequest(() => {
                  const all = Array.from(s.records.values()).map(v => clonePreservingHandles(v));
                  if (val !== undefined) {
                    return all.filter(item => item[idxName] === val);
                  }
                  return all;
                })
            })
          };
        }
      };
      setTimeout(() => {
        if (typeof tx.oncomplete === 'function') tx.oncomplete();
      }, 5);
      return tx;
    },
    close: () => {}
  };

  (globalThis as any).indexedDB = {
    open: (_name: string, _version: number) => {
      const req: any = {
        result: dbObj,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null
      };
      queueMicrotask(() => {
        if (stores.size === 0 && typeof req.onupgradeneeded === 'function') {
          req.onupgradeneeded();
        }
        if (typeof req.onsuccess === 'function') {
          req.onsuccess();
        }
      });
      return req;
    }
  };
}

async function main() {
  setupMockIndexedDB();
  console.log('=== بدء اختبارات المهمة 13: النسخ الاحتياطي، التنبيهات، الحماية، وشاشة المزامنة ===');

  // 1) التحقق من صلاحية offline.manage في الأماكن الثلاثة
  const permInFrontend = ALL_PERMISSIONS.find(p => p.key === 'offline.manage');
  assert.ok(permInFrontend, 'يجب وجود صلاحية offline.manage في src/utils/permissions.ts');
  assert.ok(
    ROLE_TEMPLATES.manager.includes('offline.manage'),
    'يجب تضمين offline.manage في قالب المدير ROLE_TEMPLATES.manager'
  );

  const typesContent = fs.readFileSync(path.resolve('src/types/index.ts'), 'utf8');
  assert.ok(
    typesContent.includes("'offline.manage'"),
    'يجب وجود offline.manage في PermissionKey داخل src/types/index.ts'
  );

  const codeGsContent = fs.readFileSync(path.resolve('apps-script/Code.gs'), 'utf8');
  assert.ok(
    codeGsContent.includes("'offline.manage'") &&
      codeGsContent.includes("case 'markOfflineInvoiceReviewed':") &&
      codeGsContent.includes('markOfflineInvoiceReviewedGS'),
    'يجب وجود صلاحية offline.manage ودالة markOfflineInvoiceReviewedGS في apps-script/Code.gs'
  );
  console.log('✅ 1. التحقق من صلاحية offline.manage في الأماكن الثلاثة بنجاح');

  // تجهيز مستخدم وبيانات تجريبية في IndexedDB
  const testUser: UserAccount = {
    id: 'u-manager-1',
    username: 'manager',
    name: 'أحمد المدير',
    phone: '01000000001',
    role: 'manager',
    status: 'active',
    permissions: ROLE_TEMPLATES.manager
  };

  const sampleItems: Item[] = [
    {
      id: 'item-101',
      barcode: '6221001',
      name: 'سماعة بلوتوث احترافية',
      category: 'إلكترونيات',
      purchasePrice: 500,
      salePrice: 800,
      stockQuantity: 10,
      minStockLevel: 2,
      taxRate: 14,
      status: 'active'
    }
  ];

  const samplePlatforms: Platform[] = [
    {
      id: 'plat-direct',
      name: 'بيع مباشر',
      commissionPercent: 0,
      returnShippingCost: 0
    }
  ];

  await saveOfflineSnapshot({
    user: testUser,
    items: sampleItems,
    platforms: samplePlatforms,
    cashboxes: [
      {
        id: 'cb-main',
        code: 'CB-01',
        name: 'الخزينة الرئيسية',
        type: 'فرعية',
        currency: 'EGP',
        openingBalance: 1000,
        status: 'نشطة',
        createdAt: new Date().toISOString()
      }
    ],
    invoices: [
      {
        invoiceNumber: 'INV-0090',
        date: '2026-04-10',
        time: '12:00',
        platformId: 'plat-direct',
        platformName: 'بيع مباشر',
        paymentType: 'آجل',
        creditPartyType: 'platform',
        customerName: 'عميل تجريبي',
        subtotal: 500,
        totalTax: 0,
        totalCommission: 0,
        totalPickupFee: 0,
        deliveryFee: 0,
        netTotal: 500,
        netAmount: 500,
        paidAmount: 0,
        remainingAmount: 500,
        totalCost: 300,
        netProfit: 200,
        status: 'معلّقة',
        createdBy: 'أحمد المدير'
      } as any
    ],
    pendingInvoices: [
      {
        invoiceNumber: 'INV-0090',
        date: '2026-04-10',
        time: '12:00',
        platformId: 'plat-direct',
        platformName: 'بيع مباشر',
        paymentType: 'آجل',
        creditPartyType: 'platform',
        customerName: 'عميل تجريبي',
        subtotal: 500,
        totalTax: 0,
        totalCommission: 0,
        totalPickupFee: 0,
        deliveryFee: 0,
        netTotal: 500,
        netAmount: 500,
        paidAmount: 0,
        remainingAmount: 500,
        totalCost: 300,
        netProfit: 200,
        status: 'معلّقة',
        createdBy: 'أحمد المدير'
      } as any
    ]
  });

  // 2) اختبار النسخ الاحتياطي في مجلد (showDirectoryPicker) وإضافة سطر لملف اليوم قبل الطباعة
  const writtenFiles: Record<string, string> = {};
  let currentPermissionState: 'granted' | 'prompt' | 'denied' = 'granted';

  const mockDirHandle = {
    name: 'MudaqqeqBackups',
    queryPermission: async () => currentPermissionState,
    requestPermission: async () => {
      currentPermissionState = 'granted';
      return currentPermissionState;
    },
    getFileHandle: async (fileName: string, _opts?: { create?: boolean }) => {
      if (!(fileName in writtenFiles)) {
        writtenFiles[fileName] = '';
      }
      return {
        getFile: async () => ({
          size: Buffer.byteLength(writtenFiles[fileName] || '', 'utf8'),
          text: async () => writtenFiles[fileName] || ''
        }),
        createWritable: async () => {
          let buffer = '';
          return {
            write: async (data: string) => {
              buffer += data;
            },
            close: async () => {
              writtenFiles[fileName] = buffer;
            }
          };
        }
      };
    }
  };

  (globalThis as any).window = (globalThis as any).window || globalThis;
  (globalThis as any).showDirectoryPicker = async () => mockDirHandle;

  const pickRes = await selectBackupDirectory();
  assert.equal(pickRes.configured, true);
  assert.equal(pickRes.directoryName, 'MudaqqeqBackups');

  const todayFileName = getBackupJsonlFileName();
  assert.match(todayFileName, /^mudaqqeq-offline-\d{4}-\d{2}-\d{2}\.jsonl$/);

  // إنشاء فاتورة أوفلاين والتحقق من كتابة السطر في ملف اليوم فورًا (قبل الطباعة/الرجوع)
  const offlineInvRes = await createOfflineInvoiceInDb({
    user: testUser,
    invoicePayload: {
      platformId: 'plat-direct',
      paymentType: 'نقدي',
      cashboxId: 'cb-main',
      paidAmount: 800,
      lines: [
        {
          itemId: 'item-101',
          quantity: 1,
          salePrice: 800
        }
      ]
    }
  });

  assert.ok(offlineInvRes.invoice.invoiceNumber.startsWith('OFF-'));
  const fileContentAfterInvoice = writtenFiles[todayFileName] || '';
  const jsonlLines1 = fileContentAfterInvoice.trim().split('\n').filter(Boolean);
  assert.equal(jsonlLines1.length, 1, 'يجب كتابة سطر واحد في ملف اليوم بعد الفاتورة الأوفلاين');
  const parsedLine1 = JSON.parse(jsonlLines1[0]);
  assert.equal(parsedLine1.idempotencyKey, offlineInvRes.invoice.idempotencyKey);

  // عملية تحصيل آجل أوفلاين تكتب السطر الثاني في نفس ملف اليوم
  const offlineColRes = await createOfflineCreditCollectionInDb({
    user: testUser,
    payload: {
      idempotencyKey: 'col-idem-task13-1',
      partyType: 'platform',
      partyId: 'plat-direct',
      partyName: 'بيع مباشر',
      invoiceNumbers: ['INV-0090'],
      receivedAmount: 500,
      cashboxId: 'cb-main'
    }
  });
  assert.ok(offlineColRes.collectionId);
  const fileContentAfterCollection = writtenFiles[todayFileName] || '';
  const jsonlLines2 = fileContentAfterCollection.trim().split('\n').filter(Boolean);
  assert.equal(jsonlLines2.length, 2, 'يجب إضافة سطر ثانٍ في ملف اليوم بعد عملية التحصيل الأوفلاين');
  const parsedLine2 = JSON.parse(jsonlLines2[1]);
  assert.equal(parsedLine2.idempotencyKey, 'col-idem-task13-1');

  // محاكاة سقوط الإذن بعد إعادة تشغيل المتصفح (permission = 'prompt')
  currentPermissionState = 'prompt';
  const droppedStatus = await getBackupDirectoryStatus();
  assert.equal(droppedStatus.needsActivationBanner, true, 'يجب إظهار شريط فعّل النسخ الاحتياطي عند سقوط الإذن');

  const reactivated = await activateBackupDirectoryPermission();
  assert.equal(reactivated.configured, true);
  assert.equal(reactivated.permission, 'granted');
  console.log('✅ 2. النسخ الاحتياطي التلقائي في مجلد وشريط «فعّل النسخ الاحتياطي» يعملان بنجاح');

  // 3) اختبار التنبيه الساعي وتنبيه امتلاء التخزين (80% تحذير، وعند الامتلاء يتوقف البيع)
  const alertRes = await triggerHourlyPendingOperationsAlert({ forceDownloadOnUnsupported: true });
  assert.equal(alertRes.shouldAlert, true);
  assert.ok(
    alertRes.message?.includes('عملية لم تُرفع بعد. وصّل الإنترنت في أقرب وقت'),
    `رسالة التنبيه الساعي غير مطابقة: ${alertRes.message}`
  );
  assert.equal(alertRes.downloadedBackupFile, true);

  // عند 80% يظهر تحذير ولا يتوقف البيع
  setStorageEstimateOverrideForTest(async () => ({
    usage: 820 * 1024 * 1024,
    quota: 1000 * 1024 * 1024
  }));
  const quota80 = await checkStorageQuotaStatus();
  assert.equal(quota80.isWarning, true);
  assert.equal(quota80.isFull, false);
  assert.ok(quota80.warningMessage?.includes('تحذير: وصلت مساحة التخزين على الجهاز إلى'));

  // البيع يستمر عند 80%
  const invAt80 = await createOfflineInvoiceInDb({
    user: testUser,
    invoicePayload: {
      platformId: 'plat-direct',
      paymentType: 'نقدي',
      cashboxId: 'cb-main',
      paidAmount: 800,
      lines: [{ itemId: 'item-101', quantity: 1, salePrice: 800 }]
    }
  });
  assert.ok(invAt80.invoice.invoiceNumber);

  // عند الامتلاء الفعلي (100%) يتوقف البيع برسالة واضحة
  setStorageEstimateOverrideForTest(async () => ({
    usage: 1000 * 1024 * 1024,
    quota: 1000 * 1024 * 1024
  }));
  const quotaFull = await checkStorageQuotaStatus();
  assert.equal(quotaFull.isFull, true);

  let fullErrorCaught = false;
  try {
    await createOfflineInvoiceInDb({
      user: testUser,
      invoicePayload: {
        platformId: 'plat-direct',
        paymentType: 'نقدي',
        cashboxId: 'cb-main',
        paidAmount: 800,
        lines: [{ itemId: 'item-101', quantity: 1, salePrice: 800 }]
      }
    });
  } catch (err: any) {
    fullErrorCaught = true;
    assert.ok(
      String(err?.message || '').includes('مساحة التخزين على الجهاز ممتلئة بالكامل'),
      `رسالة إيقاف البيع عند الامتلاء غير مطابقة: ${err?.message}`
    );
  }
  assert.equal(fullErrorCaught, true, 'يجب إيقاف البيع عند امتلاء التخزين بالكامل');
  setStorageEstimateOverrideForTest(null);
  console.log('✅ 3. تنبيهات الساعة وتنبيه التخزين 80% وإيقاف البيع عند الامتلاء الفعلي تعمل بنجاح');

  // 4) اختبار الحماية: منع تسجيل الخروج النهائي أو مسح بيانات التطبيق طالما توجد عمليات معلّقة
  const logoutGuard = await canPerformFinalLogoutOrClearData();
  assert.equal(logoutGuard.allowed, false);
  assert.ok(logoutGuard.pendingCount >= 3);
  assert.ok(
    logoutGuard.reason?.includes('لا يمكن تسجيل الخروج النهائي أو مسح بيانات التطبيق') &&
      logoutGuard.reason?.includes('تبديل المستخدم أوفلاين'),
    `رسالة الحماية غير مطابقة: ${logoutGuard.reason}`
  );

  let clearBlocked = false;
  try {
    await clearLocalApplicationDataSafely();
  } catch (err: any) {
    clearBlocked = true;
    assert.ok(String(err?.message || '').includes('لا يمكن تسجيل الخروج النهائي أو مسح بيانات التطبيق'));
  }
  assert.equal(clearBlocked, true, 'يجب منع مسح بيانات التطبيق أثناء وجود عمليات معلّقة');
  console.log('✅ 4. حماية منع تسجيل الخروج النهائي ومسح بيانات التطبيق أثناء وجود عمليات معلّقة تعمل بنجاح');

  // 5) اختبار ملخص شاشة «المزامنة» وتصدير واستيراد ملف .jsonl بدون تكرار + مراجعة الفواتير
  const syncSummary = await getOutboxSummaryForSyncScreen();
  assert.equal(syncSummary.pendingCount, 3);
  // مجموع قيم العمليات المعلّقة: 800 + 500 + 800 = 2100
  assert.equal(syncSummary.pendingTotalAmount, 2100);

  const exportedRes = await exportOutboxToJsonlString();
  const exportedLines = exportedRes.jsonl.trim().split('\n').filter(Boolean);
  assert.equal(exportedLines.length, 3);

  // اختبار استيراد ملف .jsonl مع منع التكرار بالمفتاح (idempotencyKey)
  const syncedKeys = new Set<string>();
  let idxCounter = 0;
  const importRes1 = await importJsonlBackupAndSync(exportedRes.jsonl, {
    skipSnapshotRefresh: true,
    sender: async (payload: any) => {
      idxCounter++;
      const isDup = syncedKeys.has(payload.idempotencyKey);
      syncedKeys.add(payload.idempotencyKey);
      return {
        success: true,
        duplicate: isDup,
        finalInvoiceNumber: `INV-900${idxCounter}`,
        invoice: {
          invoiceNumber: `INV-900${idxCounter}`,
          offlineProvisionalNo: payload.offlineProvisionalNo,
          needsReview: true,
          reviewReasons: ['بيع بالسالب أوفلاين']
        }
      };
    }
  });

  assert.equal(importRes1.success, true);
  assert.equal(importRes1.validOperations, 3);
  assert.equal(importRes1.syncedCount, 3);

  // إعادة استيراد نفس الملف مرة ثانية: يجب اكتشاف التكرار بالمفتاح وعدم مضاعفة العمليات
  const importRes2 = await importJsonlBackupAndSync(exportedRes.jsonl, {
    skipSnapshotRefresh: true,
    sender: async (payload: any) => ({
      success: true,
      duplicate: syncedKeys.has(payload.idempotencyKey),
      finalInvoiceNumber: 'INV-9001'
    })
  });
  assert.equal(importRes2.duplicateCount, 3);

  const remainingOutbox = await getOutboxOperations();
  assert.equal(remainingOutbox.length, 0, 'بعد المزامنة يجب تفريغ صندوق الصادر');

  // الآن بعد عدم وجود عمليات معلّقة، يُسمح بتسجيل الخروج النهائي
  const logoutGuardAfterSync = await canPerformFinalLogoutOrClearData();
  assert.equal(logoutGuardAfterSync.allowed, true);

  // 6) اختبار «تحتاج مراجعة» وزر «تمت المراجعة» مع ملاحظة في الخادم والتخزين المحلي
  const designerSession = {
    token: 'test-designer-token',
    role: 'designer' as const,
    permissions: ALL_PERMISSIONS.map(p => p.key),
    phone: '01000000000',
    userId: 'u-designer',
    name: 'أحمد المدير'
  };
  const serverItems = await getItems(designerSession as any);
  const firstServerItem = serverItems[0];

  const syncSingleServerRes = await syncOfflineOperation(
    {
      idempotencyKey: 'task13-review-op-1',
      type: 'createInvoice',
      operationType: 'createInvoice',
      offlineProvisionalNo: 'OFF-DEV1-20260416-0001',
      offlineDeviceId: 'dev-uuid-1234',
      deviceId: 'dev-uuid-1234',
      deviceName: 'كاشير الفرع 1',
      deviceTime: new Date().toISOString(),
      platform: 'البيع المباشر',
      platformId: 'direct',
      paymentType: 'نقدي',
      paidAmount: 250,
      createdBy: 'أحمد المدير',
      lines: [
        {
          itemId: firstServerItem.id,
          itemNameAtSale: firstServerItem.name,
          quantity: 999, // يسبب بيع بالسالب ويعلّم needsReview = true
          salePriceAtSale: firstServerItem.salePrice,
          baseUnitPrice: firstServerItem.salePrice,
          taxRateAtSale: firstServerItem.taxRate || 0
        }
      ]
    },
    designerSession as any
  );

  assert.equal(syncSingleServerRes.success, true);
  const createdServerInv = syncSingleServerRes.invoice;
  assert.ok(createdServerInv, 'يجب إنشاء الفاتورة الأوفلاين على الخادم');
  assert.equal(createdServerInv.needsReview, true, 'الفاتورة الأوفلاين بالسالب يجب أن تُعلّم needsReview=true');

  const reviewRes = await markOfflineInvoiceReviewed(
    {
      invoiceNumber: createdServerInv.invoiceNumber,
      reviewNote: 'تم جرد المخزن ومطابقة الرصيد الفعلي',
      reviewedBy: 'أحمد المدير'
    },
    designerSession as any
  );

  assert.equal(reviewRes.success, true);
  assert.equal(reviewRes.invoice?.needsReview, false, 'بعد تمت المراجعة يجب أن يصبح needsReview=false');
  assert.equal(reviewRes.invoice?.reviewNote, 'تم جرد المخزن ومطابقة الرصيد الفعلي');
  assert.equal(reviewRes.invoice?.reviewedBy, 'أحمد المدير');
  assert.ok(reviewRes.invoice?.reviewedAt, 'يجب تسجيل وقت المراجعة reviewedAt');

  if (reviewRes.invoice) {
    await applyReviewedInvoiceToLocalDb({
      invoiceNumber: reviewRes.invoice.invoiceNumber,
      reviewNote: reviewRes.invoice.reviewNote || '',
      reviewedBy: reviewRes.invoice.reviewedBy,
      reviewedAt: reviewRes.invoice.reviewedAt
    });
  }

  console.log('✅ 5 & 6. شاشة المزامنة، استيراد/تصدير .jsonl بدون تكرار، واعتماد «تمت المراجعة» بملاحظة تعمل بنجاح');
  console.log('=== اكتملت جميع اختبارات المهمة 13 بنجاح 100% ===');
}

main().catch(err => {
  console.error('❌ فشل أحد اختبارات المهمة 13:', err);
  process.exit(1);
});

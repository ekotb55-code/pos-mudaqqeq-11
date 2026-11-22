/**
 * اختبار واجهة «إعادة الضبط» وحقبة البيانات (dataEpoch) والتعامل مع عمليات الأوفلاين قبل إعادة الضبط
 * التشغيل: npx tsx scripts/verify_data_reset_ui.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ALL_NAV_SUB_ITEMS,
  NAV_GROUPS,
  isGroupVisible,
  isSubItemVisible,
} from '../src/config/navigation.ts';
import {
  SystemResetSection,
  RESET_OPERATIONS_DETAILS,
  FACTORY_RESET_DETAILS,
} from '../src/components/settings/SystemResetSection.tsx';
import { SettingsPage } from '../src/pages/SettingsPage.tsx';
import {
  ensureDeviceIdentity,
  saveOfflineSnapshot,
  loadOfflineSnapshot,
  enqueueOutboxOperation,
  getOutboxOperations,
  getOutboxPendingCount,
  getOutboxSummaryForSyncScreen,
  syncOutboxOperations,
  applyDataEpochTransition,
  getStoredDataEpoch,
  canPerformFinalLogoutOrClearData,
  setMetaValue,
  getMetaValue,
  OUTBOX_CANCELLED_BEFORE_RESET_STATUS,
  DATA_EPOCH_STORAGE_KEY,
} from '../src/offline/db.ts';
import { api, setAuthToken } from '../src/api/client.ts';
import type { SystemConfig, UserAccount } from '../src/types/index.ts';

let passed = 0;
function check(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`فشل التحقق: ${message}`);
  }
  passed += 1;
}

function makeUser(overrides: Partial<UserAccount>): UserAccount {
  return {
    id: 'u-test',
    name: 'مستخدم اختبار',
    username: 'test_user',
    role: 'cashier',
    status: 'نشط',
    permissions: [],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const dummyConfig: SystemConfig = {
  storeName: 'متجر اختبار',
  currency: 'ج.م',
  enableDeliveryFee: false,
  persistenceMode: 'supabase',
  dataEpoch: '2026-10-01T00:00:00.000Z',
};

function setupMockBrowserStorage() {
  const lsMap = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => lsMap.get(k) ?? null,
    setItem: (k: string, v: string) => void lsMap.set(k, String(v)),
    removeItem: (k: string) => void lsMap.delete(k),
    clear: () => void lsMap.clear(),
  };

  const stores = new Map<string, { keyPath: string; records: Map<string, any> }>();

  function cloneValue(val: any): any {
    if (val === null || val === undefined || typeof val !== 'object') return val;
    if (typeof CryptoKey !== 'undefined' && val instanceof CryptoKey) return val;
    if ('type' in val && 'extractable' in val && 'algorithm' in val && 'usages' in val) {
      return val;
    }
    if (typeof val.queryPermission === 'function' || typeof val.getFileHandle === 'function') {
      return val;
    }
    if (Array.isArray(val)) return val.map((item) => cloneValue(item));
    const copy: any = {};
    for (const [k, v] of Object.entries(val)) {
      copy[k] = cloneValue(v);
    }
    return copy;
  }

  function makeRequest<T>(executor: () => T): any {
    const req: any = { result: undefined, error: null, onsuccess: null, onerror: null };
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
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string, opts: { keyPath: string }) => {
      const storeData = { keyPath: opts.keyPath, records: new Map<string, any>() };
      stores.set(name, storeData);
      return { createIndex: () => {} };
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
                return v !== undefined ? cloneValue(v) : undefined;
              }),
            getAll: (filterVal?: string) =>
              makeRequest(() => {
                const all = Array.from(s.records.values()).map((v) => cloneValue(v));
                if (filterVal !== undefined) {
                  return all.filter((item) => item.status === filterVal);
                }
                return all;
              }),
            put: (val: any) =>
              makeRequest(() => {
                const k = String(val[s.keyPath]);
                s.records.set(k, cloneValue(val));
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
                  const all = Array.from(s.records.values()).map((v) => cloneValue(v));
                  if (val !== undefined) {
                    return all.filter((item) => item[idxName] === val);
                  }
                  return all;
                }),
            }),
          };
        },
      };
      setTimeout(() => {
        if (typeof tx.oncomplete === 'function') tx.oncomplete();
      }, 4);
      return tx;
    },
    close: () => {},
  };

  (globalThis as any).indexedDB = {
    open: () => {
      const req: any = {
        result: dbObj,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        if (stores.size === 0 && typeof req.onupgradeneeded === 'function') {
          req.onupgradeneeded();
        }
        if (typeof req.onsuccess === 'function') req.onsuccess();
      });
      return req;
    },
  };
}

function runPermissionAndUiChecks() {
  console.log('1) التحقق من صلاحيات القائمة الجانبية وظهور البطاقات في SettingsPage...');
  const settingsGroup = NAV_GROUPS.find((g) => g.id === 'settings')!;
  const dbBackupSubItem = ALL_NAV_SUB_ITEMS.find((s) => s.id === 'settings-integration')!;

  const userResetOpsOnly = makeUser({
    id: 'u-reset-ops',
    permissions: ['settings.reset_operations'],
  });
  const userFactoryOnly = makeUser({
    id: 'u-factory',
    permissions: ['settings.factory_reset'],
  });
  const userBackupAndResetOps = makeUser({
    id: 'u-bk-reset',
    permissions: ['settings.backup', 'settings.reset_operations'],
  });
  const userNoReset = makeUser({
    id: 'u-no-reset',
    permissions: ['settings.system_integration', 'settings.backup'],
  });
  const ownerUser = makeUser({
    id: 'u-owner',
    role: 'designer',
    isOwner: true,
    permissions: [],
  });

  check(
    isGroupVisible(settingsGroup, userResetOpsOnly) &&
      isSubItemVisible(dbBackupSubItem, userResetOpsOnly),
    'صاحب settings.reset_operations فقط يرى مجموعة الإعدادات وعنصر قاعدة البيانات والنسخ الاحتياطي'
  );
  check(
    isGroupVisible(settingsGroup, userFactoryOnly) &&
      isSubItemVisible(dbBackupSubItem, userFactoryOnly),
    'صاحب settings.factory_reset فقط يرى مجموعة الإعدادات وعنصر قاعدة البيانات والنسخ الاحتياطي'
  );

  const settingsOpsOnlyHtml = renderToStaticMarkup(
    React.createElement(SettingsPage, {
      config: dummyConfig,
      users: [userResetOpsOnly],
      currentUser: userResetOpsOnly,
      onSaveUser: async () => ({ success: true }),
      onSyncAll: async () => {},
      initialTab: 'integration',
    })
  );
  check(
    settingsOpsOnlyHtml.includes('id="settings-reset-section"') &&
      settingsOpsOnlyHtml.includes('data-testid="reset-operations-card"') &&
      !settingsOpsOnlyHtml.includes('data-testid="factory-reset-card"') &&
      !settingsOpsOnlyHtml.includes('id="settings-backup-section"') &&
      !settingsOpsOnlyHtml.includes('فحص الاتصال والتهيئة'),
    'مستخدم settings.reset_operations فقط يرى بطاقة إعادة ضبط العمليات فقط ولا يرى المصنع أو القاعدة أو النسخ'
  );

  const settingsFactoryOnlyHtml = renderToStaticMarkup(
    React.createElement(SettingsPage, {
      config: dummyConfig,
      users: [userFactoryOnly],
      currentUser: userFactoryOnly,
      onSaveUser: async () => ({ success: true }),
      onSyncAll: async () => {},
      initialTab: 'integration',
    })
  );
  check(
    settingsFactoryOnlyHtml.includes('id="settings-reset-section"') &&
      !settingsFactoryOnlyHtml.includes('data-testid="reset-operations-card"') &&
      settingsFactoryOnlyHtml.includes('data-testid="factory-reset-card"'),
    'مستخدم settings.factory_reset فقط يرى بطاقة إعادة ضبط المصنع فقط ولا يرى إعادة ضبط العمليات'
  );

  const settingsNoResetHtml = renderToStaticMarkup(
    React.createElement(SettingsPage, {
      config: dummyConfig,
      users: [userNoReset],
      currentUser: userNoReset,
      onSaveUser: async () => ({ success: true }),
      onSyncAll: async () => {},
      initialTab: 'integration',
    })
  );
  check(
    !settingsNoResetHtml.includes('id="settings-reset-section"'),
    'مستخدم بدون صلاحيات إعادة الضبط لا يرى قسم إعادة الضبط'
  );

  const settingsOwnerHtml = renderToStaticMarkup(
    React.createElement(SettingsPage, {
      config: dummyConfig,
      users: [ownerUser],
      currentUser: ownerUser,
      onSaveUser: async () => ({ success: true }),
      onSyncAll: async () => {},
      initialTab: 'integration',
    })
  );
  check(
    settingsOwnerHtml.includes('data-testid="reset-operations-card"') &&
      settingsOwnerHtml.includes('data-testid="factory-reset-card"'),
    'مالك النظام يرى البطاقتين معًا (إعادة ضبط العمليات وإعادة ضبط المصنع)'
  );

  console.log('2) التحقق من محتوى البطاقتين ومراحل النوافذ الأربع في SystemResetSection...');
  const sampleStatus = {
    reset: {
      lastResetAt: '2026-10-15T12:30:00.000Z',
      lastResetType: 'operations' as const,
      lastResetBy: 'أحمد المدير',
    },
    canResetOperations: true,
    canFactoryReset: true,
    phrases: { operations: 'مسح العمليات', factory: 'مسح كل شيء' },
  };

  // خطوة 1: مراجعة ما يُمسح وما يبقى + التحذير
  const step1OpsHtml = renderToStaticMarkup(
    React.createElement(SystemResetSection, {
      canResetOperations: true,
      canFactoryReset: true,
      canManageBackup: true,
      onDownloadBackup: async () => true,
      formatDateTimeCairo: (s) => String(s || '—'),
      initialResetStatus: sampleStatus,
      initialModalKind: 'operations',
      initialModalStep: 1,
    })
  );
  check(
    RESET_OPERATIONS_DETAILS.wiped.every((t) => step1OpsHtml.includes(t)) &&
      RESET_OPERATIONS_DETAILS.kept.every((t) => step1OpsHtml.includes(t)) &&
      step1OpsHtml.includes('لا يمكن التراجع عن هذه العملية. كل المستخدمين سيسجلون الدخول من جديد.') &&
      step1OpsHtml.includes('الخطوة 1 من 4'),
    'الخطوة 1 (إعادة ضبط العمليات) تعرض قوائم يُمسح ويبقى والتحذير الصريح'
  );

  const step1FactoryHtml = renderToStaticMarkup(
    React.createElement(SystemResetSection, {
      canResetOperations: true,
      canFactoryReset: true,
      canManageBackup: true,
      onDownloadBackup: async () => true,
      formatDateTimeCairo: (s) => String(s || '—'),
      initialResetStatus: sampleStatus,
      initialModalKind: 'factory',
      initialModalStep: 1,
    })
  );
  check(
    FACTORY_RESET_DETAILS.wiped.every((t) => step1FactoryHtml.includes(t)) &&
      FACTORY_RESET_DETAILS.kept.every((t) => step1FactoryHtml.includes(t)) &&
      step1FactoryHtml.includes('مسح شامل للنظام'),
    'الخطوة 1 (إعادة ضبط المصنع) تعرض قوائم يُمسح ويبقى لإعادة ضبط المصنع'
  );

  // خطوة 2: بدون صلاحية النسخ الاحتياطي vs بصلاحية النسخ الاحتياطي
  const step2NoBackupHtml = renderToStaticMarkup(
    React.createElement(SystemResetSection, {
      canResetOperations: true,
      canFactoryReset: false,
      canManageBackup: false,
      onDownloadBackup: async () => false,
      formatDateTimeCairo: (s) => String(s || '—'),
      initialResetStatus: sampleStatus,
      initialModalKind: 'operations',
      initialModalStep: 2,
    })
  );
  check(
    step2NoBackupHtml.includes('لا تملك صلاحية النسخ الاحتياطي، لن تُحفظ نسخة قبل المسح') &&
      step2NoBackupHtml.includes('أفهم ذلك') &&
      step2NoBackupHtml.includes('disabled=""'),
    'الخطوة 2 بدون صلاحية النسخ تعرض التحذير ومربع «أفهم ذلك» وتُعطل زر المتابعة قبل التأشير'
  );

  const step2WithBackupHtml = renderToStaticMarkup(
    React.createElement(SystemResetSection, {
      canResetOperations: true,
      canFactoryReset: false,
      canManageBackup: true,
      onDownloadBackup: async () => true,
      formatDateTimeCairo: (s) => String(s || '—'),
      initialResetStatus: sampleStatus,
      initialModalKind: 'operations',
      initialModalStep: 2,
    })
  );
  check(
    step2WithBackupHtml.includes('تنزيل نسخة احتياطية كاملة مطلوب قبل تنفيذ إعادة الضبط'),
    'الخطوة 2 بصلاحية النسخ تطلب تنزيل النسخة الاحتياطية قبل الانتقال'
  );

  // خطوة 3: كلمة السر + عبارة التأكيد
  const step3FactoryHtml = renderToStaticMarkup(
    React.createElement(SystemResetSection, {
      canResetOperations: true,
      canFactoryReset: true,
      canManageBackup: true,
      onDownloadBackup: async () => true,
      formatDateTimeCairo: (s) => String(s || '—'),
      initialResetStatus: sampleStatus,
      initialModalKind: 'factory',
      initialModalStep: 3,
    })
  );
  check(
    step3FactoryHtml.includes('مسح كل شيء') &&
      step3FactoryHtml.includes('كلمة سر المستخدم الحالي') &&
      step3FactoryHtml.includes('تأكيد إعادة ضبط المصنع') &&
      step3FactoryHtml.includes('disabled=""'),
    'الخطوة 3 تعرض عبارة التأكيد وكلمة السر وتُبقي زر التنفيذ معطلاً قبل التطابق'
  );

  // خطوة 4: نتيجة النجاح
  const step4Html = renderToStaticMarkup(
    React.createElement(SystemResetSection, {
      canResetOperations: true,
      canFactoryReset: false,
      canManageBackup: true,
      onDownloadBackup: async () => true,
      formatDateTimeCairo: (s) => String(s || '—'),
      initialResetStatus: sampleStatus,
      initialModalKind: 'operations',
      initialModalStep: 4,
    })
  );
  check(
    step4Html.includes('تمت إعادة الضبط. سجّل الدخول من جديد') &&
      step4Html.includes('تسجيل الدخول من جديد'),
    'الخطوة 4 تعرض رسالة النجاح وزر تسجيل الدخول من جديد'
  );

  check(
    isSubItemVisible(dbBackupSubItem, userBackupAndResetOps),
    'عنصر القائمة الموحد يظهر لمستخدم يملك settings.backup + settings.reset_operations'
  );
}

async function runDataEpochAndOfflineTests() {
  console.log('3) التحقق من آلية dataEpoch وتفريغ النسخة المحلية وتعامل outbox مع 409 BEFORE_RESET...');
  setupMockBrowserStorage();

  // إعداد هوية الجهاز ومقبض مجلد نسخ احتياطي + بيانات محلية + عمليات قبل وبعد إعادة الضبط
  const { deviceId } = await ensureDeviceIdentity();
  await setMetaValue('backupDirectoryName', 'مجلد نسخ المحل');

  const testerUser = makeUser({ id: 'u-cash-1', name: 'أحمد الكاشير', role: 'cashier' });
  await saveOfflineSnapshot({
    user: testerUser,
    items: [
      {
        id: 'item-old-1',
        name: 'صنف قديم',
        purchasePrice: 50,
        salePrice: 100,
        stockQuantity: 10,
        unit: 'قطعة',
      } as any,
    ],
    categories: [{ id: 'cat-1', name: 'تصنيف قديم' } as any],
    platforms: [],
    costs: [],
    customers: [],
    cashboxes: [],
    cashboxAssignments: [],
    settings: undefined,
    users: [testerUser],
    invoices: [
      {
        invoiceNumber: 'INV-OLD-001',
        date: '2026-10-01T10:00:00.000Z',
        platform: 'البيع المباشر',
        paymentType: 'نقدي',
        totalBeforeDiscount: 100,
        discountAmount: 0,
        pickupFeeAmount: 0,
        taxAmount: 0,
        netAmount: 100,
        paidAmount: 100,
        remainingAmount: 0,
        cashierName: 'أحمد',
        lines: [],
      } as any,
    ],
    returns: [],
  });

  const beforeSnap = await loadOfflineSnapshot(testerUser);
  check(Boolean(beforeSnap) && beforeSnap!.items.length === 1 && beforeSnap!.invoices.length === 1, 'تم حفظ النسخة المحلية بنجاح قبل إعادة الضبط');

  const RESET_TIME_1 = '2026-10-15T12:00:00.000Z';
  const OLD_OP_TIME = '2026-10-15T11:30:00.000Z';
  const NEW_OP_TIME = '2026-10-15T12:05:00.000Z';

  // عملية أقدم من وقت إعادة الضبط + عملية أحدث منه
  const oldOp = await enqueueOutboxOperation({
    type: 'createInvoice',
    operationType: 'createInvoice',
    idempotencyKey: 'idem-pre-reset-1',
    invoiceNumber: 'OFF-DEV1-OLD-1',
    deviceTime: OLD_OP_TIME,
    userId: testerUser.id,
    userName: testerUser.name,
    payload: {
      offlineProvisionalNo: 'OFF-DEV1-OLD-1',
      deviceTime: OLD_OP_TIME,
      offlineInvoice: {
        invoiceNumber: 'OFF-DEV1-OLD-1',
        netAmount: 150,
        lines: [],
      },
    },
  });

  const newOp = await enqueueOutboxOperation({
    type: 'createInvoice',
    operationType: 'createInvoice',
    idempotencyKey: 'idem-post-reset-1',
    invoiceNumber: 'OFF-DEV1-NEW-1',
    deviceTime: NEW_OP_TIME,
    userId: testerUser.id,
    userName: testerUser.name,
    payload: {
      offlineProvisionalNo: 'OFF-DEV1-NEW-1',
      deviceTime: NEW_OP_TIME,
      offlineInvoice: {
        invoiceNumber: 'OFF-DEV1-NEW-1',
        netAmount: 250,
        lines: [],
      },
    },
  });

  // تطبيق تغيّر dataEpoch القادم من /api/config
  const epochRes1 = await applyDataEpochTransition(RESET_TIME_1);
  check(
    epochRes1.changed === true &&
      epochRes1.clearedSnapshot === true &&
      epochRes1.cancelledOutboxCount === 1,
    'تغيّر dataEpoch يفرّغ النسخة المحلية ويلغي العمليات الأقدم من إعادة الضبط فقط'
  );

  const afterSnap = await loadOfflineSnapshot(testerUser);
  check(
    Boolean(afterSnap) &&
      afterSnap!.items.length === 0 &&
      afterSnap!.categories.length === 0 &&
      !afterSnap!.invoices.some((i) => i.invoiceNumber === 'INV-OLD-001') &&
      !afterSnap!.invoices.some((i) => i.invoiceNumber === 'OFF-DEV1-OLD-1') &&
      afterSnap!.invoices.some((i) => i.invoiceNumber === 'OFF-DEV1-NEW-1'),
    'النسخة المحلية القديمة والعملية الملغاة فُرِّغت تمامًا بعد تغيّر dataEpoch بينما بقيت العملية الأحدث فقط'
  );
  check(
    (await ensureDeviceIdentity()).deviceId === deviceId &&
      (await getMetaValue<string>('backupDirectoryName')) === 'مجلد نسخ المحل',
    'هوية الجهاز وإعداد مجلد النسخ الاحتياطي تبقى محفوظة بعد تفريغ النسخة المحلية'
  );
  check(
    (await getStoredDataEpoch()) === RESET_TIME_1 &&
      (globalThis as any).localStorage.getItem(DATA_EPOCH_STORAGE_KEY) === RESET_TIME_1,
    'تم حفظ dataEpoch الجديد في IndexedDB و localStorage'
  );

  const opsAfterEpoch = await getOutboxOperations();
  const storedOldOp = opsAfterEpoch.find((o) => o.id === oldOp.id)!;
  const storedNewOp = opsAfterEpoch.find((o) => o.id === newOp.id)!;
  check(
    storedOldOp.status === OUTBOX_CANCELLED_BEFORE_RESET_STATUS &&
      storedNewOp.status === 'معلّقة',
    'العملية الأقدم من إعادة الضبط تحمل حالة «ملغاة — سُجّلت قبل إعادة ضبط النظام» بينما الأحدث تبقى معلّقة'
  );
  check(
    (await getOutboxPendingCount()) === 1,
    'getOutboxPendingCount يتجاهل العمليات الملغاة ولا يعطل الجهاز عن المزامنة'
  );

  // تكرار نفس dataEpoch لا يفرغ النسخة مرة أخرى
  await saveOfflineSnapshot({
    user: testerUser,
    items: [{ id: 'item-fresh', name: 'صنف جديد', purchasePrice: 10, salePrice: 20, stockQuantity: 5, unit: 'قطعة' } as any],
    categories: [],
    platforms: [],
    costs: [],
    customers: [],
    cashboxes: [],
    cashboxAssignments: [],
    settings: undefined,
    users: [testerUser],
    invoices: [],
    returns: [],
  });
  const epochResRepeat = await applyDataEpochTransition(RESET_TIME_1);
  const snapAfterRepeat = await loadOfflineSnapshot(testerUser);
  check(
    epochResRepeat.changed === false && Boolean(snapAfterRepeat) && snapAfterRepeat!.items.length === 1,
    'نفس قيمة dataEpoch لا تفرّغ النسخة المحلية الجديدة مرة أخرى'
  );

  // الآن نضيف عملية قديمة لم تكن مُعلَّمة بعد (مثل ساعة جهاز متأخرة) ونختبر رد الخادم 409 BEFORE_RESET
  const stale409Op = await enqueueOutboxOperation({
    type: 'createInvoice',
    operationType: 'createInvoice',
    idempotencyKey: 'idem-server-409-op',
    invoiceNumber: 'OFF-DEV1-409-1',
    deviceTime: '2026-10-15T12:04:00.000Z',
    userId: testerUser.id,
    userName: testerUser.name,
    payload: {
      offlineProvisionalNo: 'OFF-DEV1-409-1',
      deviceTime: '2026-10-15T12:04:00.000Z',
      offlineInvoice: {
        invoiceNumber: 'OFF-DEV1-409-1',
        netAmount: 90,
        lines: [],
      },
    },
  });

  const sentKeys: string[] = [];
  const syncResult = await syncOutboxOperations({
    user: testerUser,
    skipSnapshotRefresh: true,
    disableAutoRetrySchedule: true,
    sender: async (payload) => {
      sentKeys.push(payload.idempotencyKey);
      if (payload.idempotencyKey === 'idem-server-409-op') {
        return {
          success: false,
          code: 'BEFORE_RESET',
          statusCode: 409,
          error: 'هذه العملية سُجّلت على الجهاز قبل إعادة ضبط النظام ولن تُرفع.',
        };
      }
      return {
        success: true,
        finalInvoiceNumber: 'INV-AFTER-RESET-001',
        provisionalInvoiceNumber: payload.offlineProvisionalNo,
        invoice: {
          invoiceNumber: 'INV-AFTER-RESET-001',
          date: payload.deviceTime,
          platform: 'البيع المباشر',
          paymentType: 'نقدي',
          totalBeforeDiscount: 250,
          discountAmount: 0,
          pickupFeeAmount: 0,
          taxAmount: 0,
          netAmount: 250,
          paidAmount: 250,
          remainingAmount: 0,
          cashierName: 'أحمد الكاشير',
          lines: [],
        } as any,
      };
    },
  });

  check(
    sentKeys.includes('idem-server-409-op') && sentKeys.includes('idem-post-reset-1'),
    'محرك المزامنة يواصل رفع العمليات الأحدث ولا يتوقف عند 409 BEFORE_RESET'
  );
  check(
    !sentKeys.includes('idem-pre-reset-1'),
    'العملية الملغاة محليًا لا يُعاد إرسالها إلى الخادم إطلاقًا'
  );
  check(
    syncResult.success === true &&
      syncResult.syncedCount === 1 &&
      syncResult.cancelledBeforeResetCount === 1 &&
      syncResult.failedCount === 0 &&
      syncResult.remainingCount === 0,
    'نتيجة المزامنة تعتبر 409 BEFORE_RESET حالة نهائية دون إيقاف الطابور ودون خطأ مستمر'
  );

  const summaryAfterSync = await getOutboxSummaryForSyncScreen();
  const marked409Op = summaryAfterSync.cancelledOps.find((o) => o.id === stale409Op.id);
  check(
    summaryAfterSync.pendingCount === 0 &&
      summaryAfterSync.failedCount === 0 &&
      summaryAfterSync.cancelledCount === 2 &&
      marked409Op?.status === OUTBOX_CANCELLED_BEFORE_RESET_STATUS,
    'ملخص شاشة المزامنة يفصل العمليات الملغاة (2) ويبقيها للمراجعة ولا يحسبها كمعلقة أو فاشلة'
  );

  const logoutCheck = await canPerformFinalLogoutOrClearData();
  check(
    logoutCheck.allowed === true && logoutCheck.pendingCount === 0,
    'العمليات الملغاة بسبب إعادة الضبط لا تمنع تسجيل الخروج النهائي'
  );

  // اختبار استجابة api.syncOfflineOperation عند رجوع HTTP 409 BEFORE_RESET
  const originalFetch = globalThis.fetch;
  try {
    setAuthToken('dummy-token');
    (globalThis as any).fetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: 'BEFORE_RESET',
          error: 'العملية أقدم من إعادة الضبط',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    const client409Res = await api.syncOfflineOperation({ idempotencyKey: 'test-409' });
    check(
      client409Res.success === false &&
        client409Res.code === 'BEFORE_RESET' &&
        client409Res.statusCode === 409,
      'api.syncOfflineOperation يمرر 409 BEFORE_RESET بشكل منظم بدل تعطيل التدفق'
    );
  } finally {
    globalThis.fetch = originalFetch;
    setAuthToken(null);
  }
}

function runSourceIntegrityChecks() {
  console.log('4) التحقق من ربط الواجهة مع App.tsx و SyncPage.tsx و client.ts...');
  const appSource = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  const apiSource = fs.readFileSync(path.resolve('src/api/client.ts'), 'utf8');
  const syncPageSource = fs.readFileSync(path.resolve('src/pages/SyncPage.tsx'), 'utf8');
  const resetComponentSource = fs.readFileSync(
    path.resolve('src/components/settings/SystemResetSection.tsx'),
    'utf8'
  );

  check(
    apiSource.includes('/api/system/reset-status') &&
      apiSource.includes('/api/system/reset-operations') &&
      apiSource.includes('/api/system/factory-reset'),
    'client.ts يحتوي على دوال مسارات إعادة الضبط الثلاثة'
  );
  check(
    appSource.includes('applyDataEpochTransition(configData.dataEpoch)'),
    'App.tsx يقارن dataEpoch القادم من /api/config عند التحميل ويفعل الانتقال تلقائيًا'
  );
  check(
    appSource.includes('handleForceLogoutAfterReset') &&
      appSource.includes('onForceLogoutAfterReset={handleForceLogoutAfterReset}'),
    'App.tsx يمرر مسار الخروج الإجباري بعد إعادة الضبط دون تسجيل عملية OFFLINE_LOGOUT وهمية'
  );
  check(
    syncPageSource.includes('OUTBOX_CANCELLED_BEFORE_RESET_STATUS') &&
      syncPageSource.includes('عمليات ملغاة — سُجّلت قبل إعادة ضبط النظام'),
    'SyncPage.tsx يعرض قسم العمليات الملغاة بسبب إعادة ضبط النظام'
  );
  check(
    resetComponentSource.includes('onDownloadBackup') &&
      resetComponentSource.includes('handleFinishSessionLogout'),
    'SystemResetSection ينفذ تنزيل النسخة أولًا وينظف الجلسة بعد إعادة الضبط'
  );
}

async function main() {
  runPermissionAndUiChecks();
  await runDataEpochAndOfflineTests();
  runSourceIntegrityChecks();
  console.log(`\n🎉 نجحت جميع اختبارات واجهة إعادة الضبط و dataEpoch (${passed} تحققًا).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌', err?.stack || err?.message || err);
    process.exit(1);
  });

/**
 * اختبار التبويبات المتعددة ونقطة البيع المستقلة أونلاين + القفل الذري للأوفلاين
 * التشغيل: npx tsx scripts/verify_multitab_pos.ts
 * بدون اتصال بـ Supabase الحي أو خادم خارجي.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getHrefForTarget,
  getHrefForItemRoute,
  resolvePathToTarget,
  isPlainLeftClick,
  normalizeNavigationTarget,
  isSubItemVisible,
  ALL_NAV_SUB_ITEMS,
} from '../src/config/navigation.ts';
import {
  computeSessionTag,
  tryClaimLegacyPosDraftPrompt,
  clearLegacyDraftClaim,
  readSharedHumanActivity,
  writeSharedHumanActivity,
  clearSharedHumanActivity,
  LAST_HUMAN_ACTIVITY_STORAGE_KEY,
  TAB_ID_STORAGE_KEY,
  getOrInitTabId,
  subscribeTabIdChange,
} from '../src/utils/tabSession.ts';
import {
  setBoundSessionIdentity,
  setOnSessionMismatch,
  assertBoundSessionMatches,
  recordUserInteraction,
  getLastUserInteractionAt,
  setAuthToken,
  api,
} from '../src/api/client.ts';
import { CartJournalClient, type JournalStorage, type JournalEvent } from '../src/offline/cartJournal.ts';
import {
  acquireOfflineLock,
  releaseOfflineLock,
  hasOfflineLockOwnership,
  assertOfflineWriteOwnership,
  getOfflineLockSnapshot,
  __setOfflineLockAdapterForTests,
} from '../src/offline/offlineLock.ts';
import {
  createOfflineInvoiceInDb,
  createOfflineCreditCollectionInDb,
  syncOutboxOperations,
  importJsonlBackupAndSync,
} from '../src/offline/db.ts';
import { ALL_PERMISSIONS } from '../src/utils/permissions.ts';
import type { UserAccount } from '../src/types.ts';

let passed = 0;
function check(name: string, condition: unknown, details?: string) {
  if (!condition) {
    throw new Error(`فشل التحقق (${name})${details ? `: ${details}` : ''}`);
  }
  passed++;
  console.log(`  ✅ PASS: ${name}`);
}

function setGlobalNavigator(val: any) {
  Object.defineProperty(globalThis, 'navigator', {
    value: val,
    configurable: true,
    writable: true,
  });
}

function makeMemoryStorage(): Storage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function makeJournalStorage(): JournalStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

const fullUser: UserAccount = {
  id: 'u-admin-1',
  name: 'مدير النظام',
  username: 'admin',
  phone: '01000000001',
  role: 'designer',
  permissions: [...ALL_PERMISSIONS],
  status: 'نشط',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const cashierDirectOnly: UserAccount = {
  id: 'u-cashier-2',
  name: 'كاشير مبيعات',
  username: 'cashier2',
  phone: '01000000002',
  role: 'cashier',
  permissions: ['invoices.create', 'pos.sell', 'invoices.view'],
  status: 'نشط',
  createdAt: '2026-01-01T00:00:00.000Z',
};

async function testNavigationAndRoutes() {
  console.log('\n1) اختبار المسارات المعتمدة وبناء روابط href وتوافق المودز والصلاحيات');

  check('رابط لوحة التحكم الأساسي', getHrefForTarget('dashboard') === '/dashboard');
  check('رابط نقطة البيع', getHrefForTarget('pos') === '/pos');
  check('رابط تبويب مزامنة الأوفلاين الفاشلة', getHrefForTarget('sync', 'failed') === '/sync/failed');
  check('رابط كشف حساب العملاء', getHrefForTarget('customers', 'STATEMENT') === '/customers/statement');
  check(
    'رابط سياقي لمعرف المورد',
    getHrefForTarget('purchases', 'STATEMENT', { searchParams: { supplierId: 'sup-7' } }) ===
      '/purchases/statement?supplierId=sup-7'
  );
  check(
    'رابط سياقي لمعرف العميل والبحث',
    getHrefForTarget('customers', 'CREDIT_COLLECTION', { searchParams: { customerId: 'cust-9' } }) ===
      '/customers/credit-collection?customerId=cust-9'
  );
  check(
    'رابط سياقي لمعرف الخزينة',
    getHrefForTarget('cashboxes', 'TRANSACTIONS', { searchParams: { cashboxId: 'cb-4' } }) ===
      '/cashboxes/transactions?cashboxId=cb-4'
  );
  check(
    'رابط سياقي لتصنيف الأصناف',
    getHrefForTarget('items', undefined, { searchParams: { category: 'cat-12' } }) ===
      '/items?category=cat-12'
  );
  check(
    'رابط استيراد الأصناف بإكسل',
    getHrefForTarget('bulk_edit_excel', 'add_items', { searchParams: { operationType: 'add_items' } }) ===
      '/items/bulk-edit?operationType=add_items'
  );
  check('رابط صنف جديد', getHrefForItemRoute('new') === '/items/new');
  check('رابط تعديل صنف مع encodeURIComponent', getHrefForItemRoute('edit', 'item/a 1') === '/items/item%2Fa%201');

  const rNewItem = resolvePathToTarget('/items/new', fullUser);
  check(
    'تحليل مسار /items/new يفتح شاشة صنف جديد',
    rNewItem.page === 'items' && rNewItem.itemRoute?.mode === 'new' && !rNewItem.redirected
  );

  const rEditItem = resolvePathToTarget('/items/it-99?search=test', fullUser);
  check(
    'تحليل مسار /items/:id يفتح تعديل الصنف',
    rEditItem.page === 'items' && rEditItem.itemRoute?.mode === 'edit' && rEditItem.itemRoute.itemId === 'it-99'
  );

  const rBackupSection = resolvePathToTarget('/settings?section=backup', fullUser);
  check(
    'تحليل /settings?section=backup يحول إلى /settings/integration#backup',
    rBackupSection.page === 'settings' &&
      rBackupSection.tab === 'integration' &&
      rBackupSection.hash === '#backup' &&
      rBackupSection.path === '/settings/integration#backup'
  );

  const rSalesSection = resolvePathToTarget('/settings?section=sales', fullUser);
  check(
    'تحليل /settings?section=sales يفتح تبويب المبيعات',
    rSalesSection.page === 'settings' && rSalesSection.tab === 'sales' && rSalesSection.path === '/settings/sales'
  );

  const rPlatformDisabled = resolvePathToTarget('/platforms', fullUser, {
    platformsEnabled: false,
    salesOnlyMode: false,
  });
  check(
    'تعطيل المنصات يمنع فتح /platforms ويوجه لمسار مسموح',
    rPlatformDisabled.redirected && rPlatformDisabled.page !== 'platforms'
  );

  const rSalesOnly = resolvePathToTarget('/dashboard', fullUser, {
    platformsEnabled: true,
    salesOnlyMode: true,
  });
  check(
    'وضع البيع فقط يوجّه /dashboard تلقائياً إلى /pos',
    rSalesOnly.redirected && rSalesOnly.page === 'pos' && rSalesOnly.path === '/pos'
  );

  const usersNavItem = ALL_NAV_SUB_ITEMS.find((s) => s.path === '/settings/users')!;
  const normCashier = normalizeNavigationTarget('settings', 'users', cashierDirectOnly);
  const normBnplOff = normalizeNavigationTarget('reports', 'BNPL', fullUser, {
    platformsEnabled: false,
    salesOnlyMode: false,
  });
  check(
    'الصلاحيات المحدودة وقيود المنصات تمنع المسارات غير المصرح بها وتوجّه للمسار المسموح',
    isSubItemVisible(usersNavItem, cashierDirectOnly) === false &&
      normCashier.path !== '/settings/users' &&
      normBnplOff.tab === 'FINANCIAL'
  );

  // تحقق صريح من resolvePathToTarget عند فتح رابط عميق غير مصرح به مباشرة في تبويب جديد
  const rDirectForbiddenUsers = resolvePathToTarget('/settings/users', cashierDirectOnly);
  check(
    'فتح /settings/users مباشرة في تبويب جديد لكاشير بدون صلاحية يعيد التوجيه لمسار مسموح',
    rDirectForbiddenUsers.redirected === true &&
      rDirectForbiddenUsers.path !== '/settings/users'
  );

  const rDirectForbiddenReports = resolvePathToTarget('/reports/financial', cashierDirectOnly);
  check(
    'فتح /reports/financial مباشرة في تبويب جديد لكاشير بدون صلاحية تقارير يعيد التوجيه إلى /pos',
    rDirectForbiddenReports.redirected === true &&
      rDirectForbiddenReports.page === 'pos' &&
      rDirectForbiddenReports.path === '/pos'
  );

  const itemsViewOnlyUser: UserAccount = {
    ...cashierDirectOnly,
    id: 'u-items-viewer',
    permissions: ['items.view', 'pos.sell'],
  };
  const itemsCreateOnlyUser: UserAccount = {
    ...cashierDirectOnly,
    id: 'u-items-creator',
    permissions: ['items.view', 'items.create'],
  };
  const itemsEditOnlyUser: UserAccount = {
    ...cashierDirectOnly,
    id: 'u-items-editor',
    permissions: ['items.view', 'items.edit'],
  };

  const rNewItemForbidden = resolvePathToTarget('/items/new', itemsViewOnlyUser);
  check(
    'فتح /items/new لمستخدم يملك items.view فقط بدون items.create يعيد التوجيه إلى /items ويمنع itemRoute',
    rNewItemForbidden.redirected === true &&
      rNewItemForbidden.page === 'items' &&
      rNewItemForbidden.itemRoute === null &&
      rNewItemForbidden.path === '/items'
  );

  const rEditItemForbidden = resolvePathToTarget('/items/item-77', itemsViewOnlyUser);
  check(
    'فتح /items/:id لمستخدم يملك items.view فقط بدون items.edit يعيد التوجيه إلى /items ويمنع itemRoute',
    rEditItemForbidden.redirected === true &&
      rEditItemForbidden.page === 'items' &&
      rEditItemForbidden.itemRoute === null &&
      rEditItemForbidden.path === '/items'
  );

  const rNewItemAllowed = resolvePathToTarget('/items/new', itemsCreateOnlyUser);
  check(
    'فتح /items/new لمستخدم يملك items.view + items.create يُسمح به دون إعادة توجيه',
    rNewItemAllowed.redirected === false &&
      rNewItemAllowed.page === 'items' &&
      rNewItemAllowed.itemRoute?.mode === 'new'
  );

  const rEditItemAllowed = resolvePathToTarget('/items/item-77', itemsEditOnlyUser);
  check(
    'فتح /items/:id لمستخدم يملك items.view + items.edit يُسمح به دون إعادة توجيه',
    rEditItemAllowed.redirected === false &&
      rEditItemAllowed.page === 'items' &&
      rEditItemAllowed.itemRoute?.mode === 'edit' &&
      rEditItemAllowed.itemRoute?.itemId === 'item-77'
  );

  check(
    'isPlainLeftClick تسمح بالنقرة اليسرى العادية وتترك Ctrl/Cmd/Shift/Middle للمتصفح',
    isPlainLeftClick({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }) === true &&
      isPlainLeftClick({ button: 0, metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }) === false &&
      isPlainLeftClick({ button: 0, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }) === false &&
      isPlainLeftClick({ button: 1, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }) === false
  );

  // التحقق الساكن من ربط الروابط الداخلية الحقيقية <a href> دون المساس بـ /visitor و MUDAQQEQ_BRAND_URL
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const expectedLinkedFiles = [
    'src/components/Sidebar.tsx',
    'src/components/Navbar.tsx',
    'src/components/MobileBottomNav.tsx',
    'src/components/settings/SettingsSectionNav.tsx',
    'src/pages/DashboardPage.tsx',
    'src/components/DashboardAurora.tsx',
    'src/pages/ProductsPage.tsx',
    'src/pages/ProductFormPage.tsx',
    'src/pages/CategoriesPage.tsx',
    'src/pages/WarehouseTransferPage.tsx',
    'src/pages/WarehouseExcelTransferPage.tsx',
    'src/pages/WarehouseDispatchOrdersPage.tsx',
    'src/pages/InvoicesPage.tsx',
    'src/pages/PurchasesPage.tsx',
    'src/pages/CustomersPage.tsx',
    'src/pages/CashboxesPage.tsx',
    'src/pages/PlatformsPage.tsx',
    'src/pages/POSPage.tsx',
    'src/components/pos/PosProductGrid.tsx',
    'src/components/ItemImportModal.tsx',
  ];
  for (const rel of expectedLinkedFiles) {
    const content = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    check(
      `الملف ${rel} يستخدم href حقيقي عبر getHrefForTarget أو getHrefForItemRoute`,
      content.includes('href={') &&
        (content.includes('getHrefForTarget') || content.includes('getHrefForItemRoute'))
    );
  }
  const brandSrc = fs.readFileSync(path.join(rootDir, 'src/config/brand.ts'), 'utf8');
  check('MUDAQQEQ_BRAND_URL محفوظ كما هو دون تعديل', brandSrc.includes("https://modaqqeq.com"));
  const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  check('/visitor لا يزال معزولاً في App.tsx', appSrc.includes("currentPage === 'visitor'"));
}

import {
  enqueueOutboxOperation,
  updateOutboxOperation,
  removeOutboxOperation,
  recordOfflineAuthEventInOutbox,
  authenticateOfflineUser,
  updateOfflineUserPermissionsInDb,
  cancelOutboxOperationsBeforeEpoch,
  applyDataEpochTransition,
} from '../src/offline/db.ts';
import { CartJournal } from '../server/cartJournal.ts';
import {
  waitForTabIdentitySettled,
  getTabIdentitySettlement,
  forceFreshTabIdentity,
  __setTabIdentityAdapterForTests,
  __resetTabSessionForTests,
  TAB_LEASE_STALE_MS,
} from '../src/utils/tabSession.ts';

async function testPosPerTabIsolationAndLegacyClaim() {
  console.log('\n2) اختبار عزل مسودات وسلة كل تبويب + استعادة المسودة القديمة مرة واحدة عبر Web Locks + مسار IndexedDB الاحتياطي وحظر الهوية الملتبسة');

  const localStore = makeMemoryStorage();
  const sessionStore = makeMemoryStorage();
  const prevWin = (globalThis as any).window;
  const prevLs = (globalThis as any).localStorage;
  const prevNav = (globalThis as any).navigator;
  const prevBc = (globalThis as any).BroadcastChannel;

  const sentMessages: any[] = [];
  const activeChannels: MockBroadcastChannel[] = [];
  class MockBroadcastChannel {
    name: string;
    onmessage: ((ev: { data: any }) => void) | null = null;
    constructor(name: string) {
      this.name = name;
      activeChannels.push(this);
    }
    postMessage(msg: any) {
      sentMessages.push(msg);
    }
    close() {}
  }

  const heldLocks = new Set<string>();
  const mockNavigatorWithLocks = {
    locks: {
      request: (name: string, opts: any, cb?: (lock: any) => Promise<any>) => {
        const callback = typeof opts === 'function' ? opts : cb!;
        const options = typeof opts === 'object' && opts ? opts : {};
        if (options.ifAvailable && heldLocks.has(name)) {
          return Promise.resolve().then(() => callback(null));
        }
        heldLocks.add(name);
        return Promise.resolve()
          .then(() => callback({ name }))
          .finally(() => {
            heldLocks.delete(name);
          });
      },
    },
  };

  try {
    const fakeWindow: any = {
      localStorage: localStore,
      sessionStorage: sessionStore,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as any).window = fakeWindow;
    (globalThis as any).localStorage = localStore;
    (globalThis as any).BroadcastChannel = MockBroadcastChannel;
    // عند غياب Web Locks يتوقف الترحيل التلقائي بأمان (Fail-Closed)
    setGlobalNavigator({});
    const claimWithoutWebLocks = await tryClaimLegacyPosDraftPrompt('u-1', 'tabA');
    check('غياب Web Locks يوقف الترحيل التلقائي للمسودة القديمة بأمان (Fail-Closed)', claimWithoutWebLocks === false);

    // تفعيل Web Locks لاختبار الحصرية الذرية وتدوير tabId
    setGlobalNavigator(mockNavigatorWithLocks);
    __resetTabSessionForTests();

    const tabIdInitial = getOrInitTabId();
    let rotatedTo = '';
    const unsubRotate = subscribeTabIdChange((nextId) => {
      rotatedTo = nextId;
    });
    const helloMsg = sentMessages.find((m) => m.type === 'TAB_HELLO');
    check('بث TAB_HELLO عند تهيئة التبويب الأول', Boolean(helloMsg && helloMsg.tabId === tabIdInitial));
    activeChannels.forEach((ch) => {
      ch.onmessage?.({
        data: {
          type: 'TAB_CLAIMED',
          tabId: tabIdInitial,
          ownerInstanceId: 'other-original-tab-instance',
          sentAt: Date.now(),
        },
      });
    });
    unsubRotate();
    check(
      'استقبال TAB_CLAIMED لنفس tabId يدوّر معرف التبويب تلقائياً ويحفظه في sessionStorage',
      Boolean(rotatedTo) &&
        rotatedTo !== tabIdInitial &&
        sessionStore.getItem(TAB_ID_STORAGE_KEY) === rotatedTo
    );

    // اختبار المسار الاحتياطي الذري في IndexedDB عند غياب Web Locks (Duplicate Tab)
    const idbLeases = new Map<string, { instanceId: string; heartbeatAt: number }>();
    __setTabIdentityAdapterForTests({
      hasWebLocks: () => false,
      tryAcquireIdbLease: async (candidateTabId, instId, now) => {
        const existing = idbLeases.get(candidateTabId);
        if (existing && existing.instanceId !== instId && now - existing.heartbeatAt < TAB_LEASE_STALE_MS) {
          return 'occupied';
        }
        idbLeases.set(candidateTabId, { instanceId: instId, heartbeatAt: now });
        return 'acquired';
      },
      releaseIdbLease: async (candidateTabId, instId) => {
        const existing = idbLeases.get(candidateTabId);
        if (existing?.instanceId === instId) {
          idbLeases.delete(candidateTabId);
        }
      },
    });

    // التبويب الأصلي يمتلك الهوية tab_dup_shared في IndexedDB
    idbLeases.set('tab_dup_shared', { instanceId: 'original-live-tab-inst', heartbeatAt: Date.now() });
    sessionStore.setItem(TAB_ID_STORAGE_KEY, 'tab_dup_shared');
    __resetTabSessionForTests({ preExistingTabId: 'tab_dup_shared' });

    const settledDupId = await waitForTabIdentitySettled();
    const dupSettlement = getTabIdentitySettlement();
    check(
      'المسار الاحتياطي الذري عبر IndexedDB يكتشف التبويب المستنسخ (Duplicate Tab) ويدوّر tabId فوراً بدون Web Locks',
      settledDupId !== 'tab_dup_shared' &&
        dupSettlement.isAmbiguous === false &&
        dupSettlement.mode === 'indexeddb-lease' &&
        sessionStore.getItem(TAB_ID_STORAGE_KEY) === settledDupId
    );

    // اختبار التحديث (Refresh) للتبويب الأصلي بعد انتهاء/إغلاق المثيل السابق: يحتفظ بنفس tabId ومسودته
    idbLeases.set('tab_refresh_keep', {
      instanceId: 'previous-closed-instance',
      heartbeatAt: Date.now() - (TAB_LEASE_STALE_MS + 1000),
    });
    sessionStore.setItem(TAB_ID_STORAGE_KEY, 'tab_refresh_keep');
    __resetTabSessionForTests({ preExistingTabId: 'tab_refresh_keep' });
    const settledRefreshId = await waitForTabIdentitySettled();
    check(
      'تحديث التبويب الأصلي أو إعادة فتحه بعد انتهاء صلاحية المثيل السابق يحافظ على نفس tabId ومسودته',
      settledRefreshId === 'tab_refresh_keep' && !getTabIdentitySettlement().isAmbiguous
    );

    // اختبار الهوية الملتبسة (غياب Web Locks + غياب IndexedDB مع وجود tabId منسوخ في sessionStorage): إيقاف POS برسالة واضحة
    __setTabIdentityAdapterForTests({
      hasWebLocks: () => false,
      tryAcquireIdbLease: async () => 'unavailable',
    });
    sessionStore.setItem(TAB_ID_STORAGE_KEY, 'tab_ambiguous_copy');
    __resetTabSessionForTests({ preExistingTabId: 'tab_ambiguous_copy' });
    await waitForTabIdentitySettled();
    const ambiguousSettlement = getTabIdentitySettlement();
    check(
      'غياب Web Locks و IndexedDB معاً عند وجود tabId في sessionStorage يعلّم الهوية بأنها ملتبسة لإيقاف POS بأمان',
      ambiguousSettlement.isAmbiguous === true &&
        ambiguousSettlement.mode === 'ambiguous-blocked' &&
        Boolean(ambiguousSettlement.reason && /تضارب/.test(ambiguousSettlement.reason))
    );

    // بدء جلسة بهوية جديدة مستقلة يحل الالتباس
    const forcedFreshId = await forceFreshTabIdentity();
    check(
      'forceFreshTabIdentity يولّد هوية جديدة مستقلة ويزيل حالة الالتباس',
      forcedFreshId !== 'tab_ambiguous_copy' && getTabIdentitySettlement().isAmbiguous === false
    );

    __setTabIdentityAdapterForTests(null);
    setGlobalNavigator(mockNavigatorWithLocks);

    // اختبار مفاتيح المسودات المعزولة لكل تبويب مطابقة لما في POSPage
    const keyTab1 = `pos_open_invoice_draft_u-1__tab_tabA`;
    const keyTab2 = `pos_open_invoice_draft_u-1__tab_tabB`;
    localStore.setItem(keyTab1, JSON.stringify({ cart: [{ itemId: 'p1', quantity: 2 }] }));
    localStore.setItem(keyTab2, JSON.stringify({ cart: [{ itemId: 'p2', quantity: 5 }] }));
    check('مسودة التبويب الأول مستقلة عن التبويب الثاني', keyTab1 !== keyTab2 && localStore.getItem(keyTab1) !== localStore.getItem(keyTab2));

    // اختبار المطالبة بالمسودة القديمة المشتركة (بدون __tab_) مرة واحدة فقط عبر Web Locks
    const claimed1 = await tryClaimLegacyPosDraftPrompt('u-1', 'tabA');
    const claimed2 = await tryClaimLegacyPosDraftPrompt('u-1', 'tabB');
    const claimed1Again = await tryClaimLegacyPosDraftPrompt('u-1', 'tabA');
    check('أول تبويب يطالب بالمسودة القديمة بنجاح عبر Web Locks', claimed1 === true);
    check('التبويب الثاني لا يكرر نافذة استعادة نفس المسودة القديمة', claimed2 === false);
    check('نفس التبويب المالك يحتفظ بحق المطالبة حتى الحسم', claimed1Again === true);
    clearLegacyDraftClaim('u-1', 'tabA');
    await new Promise((r) => setTimeout(r, 5));
    const claimedAfterClear = await tryClaimLegacyPosDraftPrompt('u-1', 'tabB');
    check('بعد إزالة المطالبة وتحرير القفل يمكن لتبويب آخر المطالبة مجدداً عند الحاجة', claimedAfterClear === true);
    clearLegacyDraftClaim('u-1', 'tabB');

    // عزل cartId و deviceId في CartJournalClient لكل تبويب على نفس journal storage
    const sharedJournalStorage = makeJournalStorage();
    const cjTab1 = new CartJournalClient({
      storage: sharedJournalStorage,
      ownerTabId: 'tabAlpha',
      autoTimers: false,
      send: async () => ({ lastSeq: 1 }),
    });
    const cjTab2 = new CartJournalClient({
      storage: sharedJournalStorage,
      ownerTabId: 'tabBeta',
      autoTimers: false,
      send: async () => ({ lastSeq: 2 }),
    });
    check(
      'كل تبويب يحصل على cartId و deviceId خاصين ومستقلين مع ownerTabId',
      cjTab1.currentCartId() !== cjTab2.currentCartId() &&
        cjTab1.getDeviceId() !== cjTab2.getDeviceId() &&
        cjTab1.currentCartId().includes('Alpha') &&
        cjTab2.currentCartId().includes('Beta')
    );

    // تدوير tabId داخل CartJournalClient مع بقاء الأصناف المفتوحة وتدوير deviceId
    const beforeRotateCartId = cjTab1.currentCartId();
    const beforeRotateDeviceId = cjTab1.getDeviceId();
    cjTab1.syncCart([{ itemId: 'item-1', name: 'قلم', unitPrice: 15, quantity: 3 }]);
    cjTab1.setOwnerTabId('tabGamma');
    check(
      'تغيير ownerTabId يدوّر cartId و deviceId مع الاحتفاظ بأصناف الفاتورة المفتوحة',
      cjTab1.currentCartId() !== beforeRotateCartId &&
        cjTab1.getDeviceId() !== beforeRotateDeviceId &&
        cjTab1.currentCartId().includes('Gamma') &&
        cjTab1.tabPendingCount() >= 1
    );
    void rotatedTo;
  } finally {
    __setTabIdentityAdapterForTests(null);
    (globalThis as any).window = prevWin;
    (globalThis as any).localStorage = prevLs;
    setGlobalNavigator(prevNav);
    (globalThis as any).BroadcastChannel = prevBc;
  }
}

async function testSessionBindingActivityAndSwitchGuard() {
  console.log('\n3) اختبار ربط الجلسة، مزامنة النشاط البشري، عدم تسريب التوكن، وحماية تبديل المستخدم');

  const localStore = makeMemoryStorage();
  const prevWin = (globalThis as any).window;
  const prevLs = (globalThis as any).localStorage;
  const prevFetch = (globalThis as any).fetch;
  const prevNav = (globalThis as any).navigator;

  try {
    (globalThis as any).window = {
      localStorage: localStore,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as any).localStorage = localStore;
    setGlobalNavigator({ onLine: true, userAgent: 'Chrome Windows' });

    const rawSecretToken = 'tok_super_secret_do_not_leak_987654';
    const tag1 = computeSessionTag(rawSecretToken, 'usr-1');
    check(
      'computeSessionTag لا يحتوي على رمز الدخول الخام (pos_token)',
      Boolean(tag1) && !tag1.includes('tok_super_secret') && !tag1.includes('987654')
    );

    localStore.setItem('pos_token', rawSecretToken);
    localStore.setItem('pos_user', JSON.stringify({ id: 'usr-1', username: 'ahmed' }));
    setBoundSessionIdentity({ userId: 'usr-1', sessionTag: tag1 });

    // اختبار النشاط المشترك بين التبويبات: التفاعل البشري يحدّث، واستطلاع الخلفية يرسل X-Background-Poll=1
    clearSharedHumanActivity();
    const olderAt = Date.now() - 120_000;
    writeSharedHumanActivity(olderAt, { userId: 'usr-1', sessionTag: tag1 });
    recordUserInteraction();
    const afterInteraction = readSharedHumanActivity({ userId: 'usr-1', sessionTag: tag1 });
    check('التفاعل البشري يحدّث الطابع الزمني المشترك في localStorage', afterInteraction > olderAt && getLastUserInteractionAt() >= afterInteraction);

    const capturedHeaders: Record<string, string>[] = [];
    (globalThis as any).fetch = async (_url: string, init: RequestInit) => {
      capturedHeaders.push((init?.headers as Record<string, string>) || {});
      return new Response(JSON.stringify({ success: true, user: { id: 'usr-1', name: 'Ahmed', username: 'ahmed' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await api.getMe({ background: true });
    check(
      'طلبات الخلفية الدورية تحمل X-Background-Poll=1 و X-User-Activity=0 ولا تُحسب نشاطاً بشرياً',
      capturedHeaders.length === 1 &&
        capturedHeaders[0]['X-Background-Poll'] === '1' &&
        capturedHeaders[0]['X-User-Activity'] === '0'
    );

    // التأكد من حماية تبديل المستخدم: إذا تغير المستخدم أو التوكن في تبويب آخر يُمنع هذا التبويب من الإرسال ولا يحذف التوكن الأحدث
    let mismatchMsg = '';
    setOnSessionMismatch((msg) => {
      mismatchMsg = msg;
    });

    const newerUserToken = 'tok_user2_brand_new';
    setAuthToken(newerUserToken);
    localStore.setItem('pos_user', JSON.stringify({ id: 'usr-2', username: 'sara' }));

    let blockedByMismatch = false;
    try {
      assertBoundSessionMatches();
    } catch (err: any) {
      blockedByMismatch = err?.code === 'SESSION_MISMATCH' && err?.status === 401;
    }

    check('تبديل الحساب في تبويب آخر يوقف الطلبات في التبويب القديم برمز SESSION_MISMATCH', blockedByMismatch);
    check('إشعار sessionMismatchHandler استُدعي برسالة عربية واضحة', mismatchMsg.includes('تبديل'));
    check('رمز الجلسة الأحدث pos_token لم يُحذف من localStorage عند رفض التبويب القديم', localStore.getItem('pos_token') === newerUserToken);
  } finally {
    setBoundSessionIdentity(null);
    setOnSessionMismatch(null);
    (globalThis as any).window = prevWin;
    (globalThis as any).localStorage = prevLs;
    (globalThis as any).fetch = prevFetch;
    setGlobalNavigator(prevNav);
  }
}

async function testCartJournalConcurrentFlushSerialization() {
  console.log('\n4) اختبار طابور CartJournal المستقل لكل تبويب، ترحيل الطابور القديم، سياسة السقف، وعقد الخادم');

  const prevNav = (globalThis as any).navigator;
  const prevWin = (globalThis as any).window;

  try {
    (globalThis as any).window = {};
    setGlobalNavigator({});

    const sharedStorage = makeJournalStorage();
    const deliveredPayloads: { deviceId: string; events: JournalEvent[] }[] = [];

    const makeClient = (ownerTabId: string) =>
      new CartJournalClient({
        storage: sharedStorage,
        ownerTabId,
        autoTimers: false,
        send: async (payload) => {
          deliveredPayloads.push({
            deviceId: payload.deviceId,
            events: payload.events.map((e) => ({ ...e })),
          });
          const lastSeq = payload.events.reduce((m, e) => (e.seq > m ? e.seq : m), 0);
          return { lastSeq };
        },
      });

    const clientA = makeClient('tabOne');
    const clientB = makeClient('tabTwo');

    clientA.syncCart([{ itemId: 'it-1', name: 'صنف 1', unitPrice: 10, quantity: 1 }]);
    clientB.syncCart([{ itemId: 'it-2', name: 'صنف 2', unitPrice: 20, quantity: 2 }]);

    check(
      'مخزن أحداث التبويب الأول مفصول تماماً عن مخزن التبويب الثاني',
      clientA.tabPendingCount() === 1 &&
        clientB.tabPendingCount() === 1 &&
        sharedStorage.getItem('mq_cj_tab_buf_tabOne') !== sharedStorage.getItem('mq_cj_tab_buf_tabTwo')
    );

    // حتى في متصفح بدون Web Locks، كل تبويب يرفع طابوره الخاص بهويته المستقلة دون أن يمس مخزن التبويب الآخر
    const flushAOnly = await clientA.flush();
    check(
      'رفع التبويب الأول يفرغ مخزن التبويب الأول فقط ويبقي مخزن التبويب الثاني سليماً كما هو',
      flushAOnly === true && clientA.tabPendingCount() === 0 && clientB.tabPendingCount() === 1
    );

    const flushBOnly = await clientB.flush();
    check(
      'رفع التبويب الثاني يفرغ مخزن التبويب الثاني بمعرّف جهاز/تدفق مستقل',
      flushBOnly === true &&
        clientB.tabPendingCount() === 0 &&
        deliveredPayloads.length === 2 &&
        deliveredPayloads[0].deviceId !== deliveredPayloads[1].deviceId
    );

    // اختبار منع استدعاءات الرفع المتزامنة داخل التبويب نفسه
    let inTabConcurrentSends = 0;
    let maxInTabConcurrentSends = 0;
    const sameTabClient = new CartJournalClient({
      storage: makeJournalStorage(),
      ownerTabId: 'tabSerial',
      autoTimers: false,
      send: async ({ events }) => {
        inTabConcurrentSends++;
        maxInTabConcurrentSends = Math.max(maxInTabConcurrentSends, inTabConcurrentSends);
        await new Promise((r) => setTimeout(r, 15));
        inTabConcurrentSends--;
        return { lastSeq: events[events.length - 1].seq };
      },
    });
    sameTabClient.syncCart([{ itemId: 'it-s1', name: 'صنف أ', unitPrice: 10, quantity: 1 }]);
    const p1 = sameTabClient.flush();
    sameTabClient.syncCart([{ itemId: 'it-s2', name: 'صنف ب', unitPrice: 10, quantity: 2 }]);
    const p2 = sameTabClient.flush();
    await Promise.all([p1, p2]);
    check('منع استدعاءات الرفع المتزامنة داخل التبويب نفسه (التنفيذ المتوازي داخل التبويب = 1)', maxInTabConcurrentSends === 1 && sameTabClient.tabPendingCount() === 0);

    // اختبار ثبات eventId و seq عند إعادة المحاولة بعد فشل الشبكة
    const retryStorage = makeJournalStorage();
    let retryAttempt = 0;
    const retrySeenBatches: JournalEvent[][] = [];
    const retryClient = new CartJournalClient({
      storage: retryStorage,
      ownerTabId: 'tabRetry',
      autoTimers: false,
      send: async ({ events }) => {
        retryAttempt++;
        retrySeenBatches.push(events.map((e) => ({ ...e })));
        if (retryAttempt === 1) {
          throw new Error('انقطاع مؤقت في الشبكة');
        }
        return { lastSeq: events[events.length - 1].seq };
      },
    });
    retryClient.syncCart([{ itemId: 'it-retry', name: 'صنف إعادة محاولة', unitPrice: 50, quantity: 2 }]);
    await retryClient.flush().catch(() => false);
    await retryClient.flush();
    check(
      'إعادة المحاولة تحافظ على نفس eventId ونفس seq للحدث دون فقد من مخزن التبويب',
      retrySeenBatches.length === 2 &&
        retrySeenBatches[0][0].eventId === retrySeenBatches[1][0].eventId &&
        retrySeenBatches[0][0].seq === retrySeenBatches[1][0].seq &&
        retryClient.pendingCount() === 0
    );

    // اختبار سياسة السقف الواضحة وعدم حذف الأحداث القديمة بصمت + تنبيه فشل الكتابة
    const quotaStorage = makeJournalStorage();
    const quotaClient = new CartJournalClient({
      storage: quotaStorage,
      ownerTabId: 'tabQuota',
      maxTabPending: 2,
      maxTotalPending: 5,
      autoTimers: false,
      send: async ({ events }) => ({ lastSeq: events[events.length - 1].seq }),
    });
    quotaClient.syncCart([{ itemId: 'q1', name: 'صنف 1', unitPrice: 10, quantity: 1 }]);
    quotaClient.syncCart([{ itemId: 'q1', name: 'صنف 1', unitPrice: 10, quantity: 2 }]);
    // الحدث الثالث يتجاوز سقف التبويب (2): يجب أن يُحافظ على الحدثين الأول والثاني دون حذفهما ويُظهر حالة quota_reached
    quotaClient.syncCart([{ itemId: 'q1', name: 'صنف 1', unitPrice: 10, quantity: 3 }]);
    const quotaEvents = JSON.parse(quotaStorage.getItem('mq_cj_tab_buf_tabQuota') || '[]') as JournalEvent[];
    check(
      'بلوغ سقف التخزين المعلق يحافظ على الأحداث القديمة (seq=1 و seq=2) دون حذفها بصمت ويُفعّل تنبيه quota_reached',
      quotaEvents.length === 2 &&
        quotaEvents[0].seq === 1 &&
        quotaEvents[1].seq === 2 &&
        quotaClient.getStorageStatus().type === 'quota_reached' &&
        Boolean(quotaClient.getStorageStatus().message)
    );

    // اختبار فشل الكتابة عند امتلاء التخزين (QuotaExceededError)
    let failWrites = false;
    const failingStorage: JournalStorage = {
      getItem: (k) => quotaStorage.getItem(k),
      setItem: (k, v) => {
        if (failWrites) throw new Error('QuotaExceededError');
        quotaStorage.setItem(k, v);
      },
      removeItem: (k) => quotaStorage.removeItem(k),
    };
    const writeFailClient = new CartJournalClient({
      storage: failingStorage,
      ownerTabId: 'tabWriteFail',
      autoTimers: false,
      send: async () => ({ lastSeq: 1 }),
    });
    writeFailClient.syncCart([{ itemId: 'wf1', name: 'صنف محفوظ', unitPrice: 10, quantity: 1 }]);
    failWrites = true;
    writeFailClient.syncCart([{ itemId: 'wf1', name: 'صنف محفوظ', unitPrice: 10, quantity: 2 }]);
    check(
      'فشل الكتابة في التخزين لا يمسح الأحداث السابقة ويُظهر حالة write_failed للمستخدم',
      writeFailClient.tabPendingCount() === 1 &&
        writeFailClient.getStorageStatus().type === 'write_failed' &&
        Boolean(writeFailClient.getStorageStatus().message)
    );

    // اختبار الأحداث القديمة المحفوظة في mq_cj_pending قبل التحديث: لا تُمسح بصمت عند غياب Web Locks وتُرفع بأمان عند الطلب
    const legacyStorage = makeJournalStorage();
    legacyStorage.setItem('mq_cj_device', JSON.stringify('dev-legacybase01'));
    legacyStorage.setItem(
      'mq_cj_pending',
      JSON.stringify([
        {
          eventId: 'ev-leg-1',
          seq: 1,
          at: '2026-03-01T09:00:00.000Z',
          cartId: 'c-legacycart01',
          type: 'qty',
          itemId: 'it-leg',
          itemName: 'صنف قديم',
          unitPrice: 30,
          qty: 2,
        },
      ])
    );
    const legacySent: { deviceId: string; events: JournalEvent[] }[] = [];
    const legacyClient = new CartJournalClient({
      storage: legacyStorage,
      ownerTabId: 'tabModern',
      autoTimers: false,
      send: async (payload) => {
        legacySent.push(payload);
        return { lastSeq: payload.events[payload.events.length - 1].seq };
      },
    });
    check(
      'في المتصفح بدون Web Locks تبقى الأحداث القديمة في mq_cj_pending محفوظة مع إشعار legacy_pending_preserved',
      legacyClient.getStorageStatus().type === 'legacy_pending_preserved' &&
        legacyClient.getStorageStatus().legacyPreservedCount === 1
    );
    await legacyClient.flushLegacyPendingQueue();
    check(
      'استعادة/رفع الطابور القديم يرسله بمعرّف الجهاز الأساسي لمرة واحدة ويفرغ mq_cj_pending بعد تأكيد السيرفر',
      legacySent.length === 1 &&
        legacySent[0].deviceId === 'dev-legacybase01' &&
        legacySent[0].events[0].eventId === 'ev-leg-1' &&
        legacyClient.getStorageStatus().legacyPreservedCount === 0
    );

    // اختبار عقد الخادم CartJournal: عدم إسقاط أحداث أقدم إذا وصلت دفعة أحدث أولاً + منع التكرار بـ eventId
    const serverJournal = new CartJournal();
    const actor = { userId: 'u-1', userName: 'أحمد' };
    const newerBatchRes = await serverJournal.applyEvents(
      'dev-test-12345',
      [
        {
          eventId: 'ev-newer-002',
          seq: 2,
          cartId: 'c-tab1-123456',
          type: 'qty',
          itemId: 'item-a',
          itemName: 'صنف أ',
          unitPrice: 100,
          qty: 1,
          at: '2026-03-01T10:00:05.000Z',
        },
      ],
      actor
    );
    const olderBatchRes = await serverJournal.applyEvents(
      'dev-test-12345',
      [
        {
          eventId: 'ev-older-001',
          seq: 1,
          cartId: 'c-tab1-123456',
          type: 'qty',
          itemId: 'item-a',
          itemName: 'صنف أ',
          unitPrice: 100,
          qty: 3,
          at: '2026-03-01T10:00:01.000Z',
        },
      ],
      actor
    );
    const duplicateRetryRes = await serverJournal.applyEvents(
      'dev-test-12345',
      [
        {
          eventId: 'ev-older-001',
          seq: 1,
          cartId: 'c-tab1-123456',
          type: 'qty',
          itemId: 'item-a',
          itemName: 'صنف أ',
          unitPrice: 100,
          qty: 3,
          at: '2026-03-01T10:00:01.000Z',
        },
      ],
      actor
    );
    const reportAfterOutOfOrder = serverJournal.getReport();
    check(
      'الخادم يقبل الحدث الأقدم المتأخر (seq=1 بعد seq=2) ويحفظ ذروة الكمية (peakQty=3 -> currentQty=1) ويرفض تكرار نفس eventId',
      newerBatchRes.applied === 1 &&
        olderBatchRes.applied === 1 &&
        duplicateRetryRes.applied === 0 &&
        duplicateRetryRes.duplicates === 1 &&
        reportAfterOutOfOrder.rows.some((r) => r.event === 'reduce' && r.fromQty === 3 && r.toQty === 1)
    );
  } finally {
    setGlobalNavigator(prevNav);
    (globalThis as any).window = prevWin;
  }
}

async function testOfflineSingleTabLockFailClosed() {
  console.log('\n5) اختبار القفل الذري الصارم للعمل أوفلاين على جميع مسارات كتابة Outbox (تبويب واحد فقط + Fail-Closed)');

  try {
    // الحالة أ: المتصفح لا يدعم Web Locks API -> إغلاق آمن Fail-Closed
    __setOfflineLockAdapterForTests({
      isBrowserRuntime: () => true,
      hasWebLocks: () => false,
      requestExclusiveLockIfAvailable: async () => true,
    });
    const unsupportedSnap = await acquireOfflineLock();
    check(
      'عدم توفر Web Locks في المتصفح يعطي unsupported و hasOwnership=false',
      unsupportedSnap.status === 'unsupported' &&
        unsupportedSnap.hasOwnership === false &&
        hasOfflineLockOwnership() === false
    );

    let unsupportedBlockedMsg = '';
    try {
      await assertOfflineWriteOwnership();
    } catch (err: any) {
      unsupportedBlockedMsg = err?.message || '';
    }
    check('assertOfflineWriteOwnership يرفض الكتابة عند عدم دعم Web Locks برسالة عربية', /[\u0600-\u06FF]/.test(unsupportedBlockedMsg));

    // الحالة ب: تبويب آخر يمتلك القفل بالفعل (held_by_other)
    let lockHeldExternally = true;
    __setOfflineLockAdapterForTests({
      isBrowserRuntime: () => true,
      hasWebLocks: () => true,
      requestExclusiveLockIfAvailable: async (_name, onAcquired) => {
        if (lockHeldExternally) return false;
        void onAcquired();
        return true;
      },
    });

    const blockedSnap = await acquireOfflineLock();
    check(
      'عندما يكون القفل مملوكاً لتبويب آخر يرجع held_by_other و hasOwnership=false',
      blockedSnap.status === 'held_by_other' &&
        blockedSnap.hasOwnership === false &&
        getOfflineLockSnapshot().status === 'held_by_other'
    );

    let enqueueBlocked = false;
    try {
      await enqueueOutboxOperation({
        idempotencyKey: 'idem-test-1',
        type: 'createInvoice',
        payload: {},
      });
    } catch (err: any) {
      enqueueBlocked = Boolean(err?.message && /تبويب واحد/.test(err.message));
    }
    check('enqueueOutboxOperation يُمنع تلقائياً عندما القفل لتبويب آخر', enqueueBlocked);

    let updateOutboxBlocked = false;
    try {
      await updateOutboxOperation('op-1', { status: 'failed' });
    } catch (err: any) {
      updateOutboxBlocked = Boolean(err?.message && /تبويب واحد/.test(err.message));
    }
    check('updateOutboxOperation يُمنع تلقائياً عندما القفل لتبويب آخر', updateOutboxBlocked);

    let removeOutboxBlocked = false;
    try {
      await removeOutboxOperation('op-1');
    } catch (err: any) {
      removeOutboxBlocked = Boolean(err?.message && /تبويب واحد/.test(err.message));
    }
    check('removeOutboxOperation يُمنع تلقائياً عندما القفل لتبويب آخر', removeOutboxBlocked);

    let authEventBlocked = false;
    try {
      await recordOfflineAuthEventInOutbox({
        action: 'OFFLINE_LOGOUT',
        user: fullUser,
      });
    } catch (err: any) {
      authEventBlocked = Boolean(err?.message && /تبويب واحد/.test(err.message));
    }
    check('recordOfflineAuthEventInOutbox يُمنع تلقائياً عندما القفل لتبويب آخر', authEventBlocked);

    const offlineAuthBlockedRes = await authenticateOfflineUser('admin', 'secret123');
    check(
      'authenticateOfflineUser يرفض بدء جلسة أوفلاين أو كتابة OFFLINE_LOGIN عندما القفل لتبويب آخر',
      offlineAuthBlockedRes.success === false && /تبويب واحد/.test(offlineAuthBlockedRes.error)
    );

    let updatePermsBlocked = false;
    try {
      await updateOfflineUserPermissionsInDb({
        targetUserId: 'u-cashier-2',
        permissions: ['pos.sell'],
        actor: fullUser,
      });
    } catch (err: any) {
      updatePermsBlocked = Boolean(err?.message && /تبويب واحد/.test(err.message));
    }
    check('updateOfflineUserPermissionsInDb يُمنع تلقائياً عندما القفل لتبويب آخر', updatePermsBlocked);

    let cancelEpochBlocked = false;
    try {
      await cancelOutboxOperationsBeforeEpoch(new Date().toISOString());
    } catch (err: any) {
      cancelEpochBlocked = Boolean(err?.message && /تبويب واحد/.test(err.message));
    }
    check('cancelOutboxOperationsBeforeEpoch يُمنع تلقائياً عندما القفل لتبويب آخر', cancelEpochBlocked);

    let applyEpochBlocked = false;
    try {
      await applyDataEpochTransition(new Date().toISOString(), { forceClearSnapshot: true });
    } catch (err: any) {
      applyEpochBlocked = Boolean(err?.message && /تبويب واحد/.test(err.message));
    }
    check('applyDataEpochTransition يُمنع تلقائياً عندما القفل لتبويب آخر', applyEpochBlocked);

    let invoiceBlocked = false;
    try {
      await createOfflineInvoiceInDb({
        invoicePayload: { paymentType: 'نقدي', lines: [] },
        user: fullUser,
      });
    } catch (err: any) {
      invoiceBlocked = Boolean(err?.message && /تبويب واحد/.test(err.message));
    }
    check('createOfflineInvoiceInDb يُمنع تلقائياً دون لمس IndexedDB عندما القفل لتبويب آخر', invoiceBlocked);

    let collectionBlocked = false;
    try {
      await createOfflineCreditCollectionInDb({
        payload: {
          partyType: 'customer',
          partyId: 'c1',
          cashboxId: 'cb1',
          invoiceNumbers: ['INV-1'],
          receivedAmount: 100,
        },
        user: fullUser,
      });
    } catch (err: any) {
      collectionBlocked = Boolean(err?.message && /تبويب واحد/.test(err.message));
    }
    check('createOfflineCreditCollectionInDb يُمنع تلقائياً عندما القفل لتبويب آخر', collectionBlocked);

    let syncBlocked = false;
    try {
      await syncOutboxOperations({
        user: fullUser,
        syncFn: async () => ({ success: true }),
      });
    } catch (err: any) {
      syncBlocked = Boolean(err?.message && /تبويب واحد/.test(err.message));
    }
    check('syncOutboxOperations يُمنع تلقائياً عندما القفل لتبويب آخر', syncBlocked);

    let importJsonlBlocked = false;
    try {
      await importJsonlBackupAndSync('{"idempotencyKey":"k1","operationType":"create_sale_invoice","payload":{}}', {
        user: fullUser,
        sender: async () => ({ success: true }),
      });
    } catch (err: any) {
      importJsonlBlocked = Boolean(err?.message && /تبويب واحد/.test(err.message));
    }
    check('importJsonlBackupAndSync يُمنع تلقائياً عندما القفل لتبويب آخر', importJsonlBlocked);

    // الحالة ج: بعد تحرير التبويب الأول للقفل، يكتسب هذا التبويب القفل بنجاح
    lockHeldExternally = false;
    const acquiredSnap = await acquireOfflineLock();
    check(
      'بعد إغلاق/تحرير التبويب المالك ينجح التبويب التالي في اكتساب القفل',
      acquiredSnap.status === 'acquired' && acquiredSnap.hasOwnership === true && hasOfflineLockOwnership() === true
    );
    await assertOfflineWriteOwnership();
    check('assertOfflineWriteOwnership يمر بسلام بعد امتلاك القفل', true);
    releaseOfflineLock();
  } finally {
    __setOfflineLockAdapterForTests(null);
  }
}

async function main() {
  console.log('================================================================');
  console.log('التحقق الشامل لمعمارية التبويبات المتعددة و POS المستقل أونلاين');
  console.log('================================================================');

  await testNavigationAndRoutes();
  await testPosPerTabIsolationAndLegacyClaim();
  await testSessionBindingActivityAndSwitchGuard();
  await testCartJournalConcurrentFlushSerialization();
  await testOfflineSingleTabLockFailClosed();

  console.log(`\n🎉 نجحت جميع اختبارات التبويبات المتعددة والـ POS المستقل (${passed} تحققاً).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌', err?.stack || err?.message || err);
    process.exit(1);
  });

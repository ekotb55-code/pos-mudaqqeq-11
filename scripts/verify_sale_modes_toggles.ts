/**
 * اختبار شامل لمفتاحي أوضاع البيع المستقلين:
 *   1. السماح بالبيع على منصة (allowPlatformSale)
 *   2. السماح بالبيع المباشر للعميل (allowDirectSale)
 * يغطي: الحالات الأربع، التوافق مع platformsEnabled وsalesOnlyMode، عدم وجود منصة نشطة،
 *       الفحص على الخادم (أونلاين + مزامنة أوفلاين)، والتخزين المحلي IndexedDB + حفظ المرفوض للمراجعة بدون حلقة إعادة.
 *
 * التشغيل: npx tsx scripts/verify_sale_modes_toggles.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import fs from 'node:fs';
import path from 'node:path';
import {
  defaultSalesRules,
  getSalesRules,
  saveSalesRules,
  describeSalesRules,
  saleModeViolation,
  resetSalesRules,
  SalesRulesError
} from '../server/salesRules.ts';
import { createFakeTransport } from '../server/persistence/statePersistence.ts';
import {
  saveOfflineSnapshot,
  createOfflineInvoiceInDb,
  getOutboxOperations,
  getOutboxPendingCount,
  getOutboxSummaryForSyncScreen,
  syncOutboxOperations,
  OUTBOX_REJECTED_REVIEW_STATUS
} from '../src/offline/db.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(`❌ فشل التحقق: ${message}`);
  }
  passed++;
  console.log(`  ✅ ${message}`);
}

function setupMockIndexedDB() {
  const stores = new Map<string, { keyPath: string; records: Map<string, any> }>();

  function cloneVal(val: any): any {
    if (val === null || val === undefined || typeof val !== 'object') return val;
    if (typeof CryptoKey !== 'undefined' && val instanceof CryptoKey) return val;
    if ('type' in val && 'extractable' in val && 'algorithm' in val && 'usages' in val) {
      return val;
    }
    if (Array.isArray(val)) return val.map(v => cloneVal(v));
    const copy: any = {};
    for (const [k, v] of Object.entries(val)) {
      copy[k] = cloneVal(v);
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
      stores.set(name, { keyPath: opts.keyPath, records: new Map<string, any>() });
      return { createIndex: () => {} };
    },
    transaction: () => {
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
                return v !== undefined ? cloneVal(v) : undefined;
              }),
            getAll: (filterVal?: string) =>
              makeRequest(() => {
                const all = Array.from(s.records.values()).map(v => cloneVal(v));
                return filterVal !== undefined ? all.filter(i => i.status === filterVal) : all;
              }),
            put: (val: any) =>
              makeRequest(() => {
                const k = String(val[s.keyPath]);
                s.records.set(k, cloneVal(val));
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
                  const all = Array.from(s.records.values()).map(v => cloneVal(v));
                  return val !== undefined ? all.filter(i => i[idxName] === val) : all;
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
    open: () => {
      const req: any = {
        result: dbObj,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null
      };
      queueMicrotask(() => {
        if (stores.size === 0 && typeof req.onupgradeneeded === 'function') req.onupgradeneeded();
        if (typeof req.onsuccess === 'function') req.onsuccess();
      });
      return req;
    }
  };
}

async function runUnitChecks() {
  console.log('\n1) فحص منطق salesRules للحالات الأربع والتوافق مع platformsEnabled وsalesOnlyMode');
  const platforms: any[] = [
    { id: 'plt-direct', name: 'البيع المباشر', status: 'نشطة' },
    { id: 'plt-noon', name: 'نون', status: 'نشطة' }
  ];
  const customers: any[] = [{ id: 'cus-1', name: 'عميل 1', status: 'active' }];
  const ctx = () => ({ platforms, customers, by: 'المالك', now: new Date('2026-11-22T12:00:00.000Z') });

  resetSalesRules();
  let r = getSalesRules();
  assert(r.allowPlatformSale === true && r.allowDirectSale === true, 'الحالة الافتراضية: الوضعان مفعّلان');

  // 1) كلاهما مفعّل
  let desc = describeSalesRules({ platforms, customers });
  assert(desc.effectiveAllowPlatformSale && desc.effectiveAllowDirectSale, 'الحالة 1: الاثنان مفعّلان');
  assert(saleModeViolation({ isPlatformSale: true }) === null && saleModeViolation({ isPlatformSale: false }) === null, 'الحالة 1: لا منع لأي وضع');

  // 2) المباشر فقط
  saveSalesRules({ allowPlatformSale: false, allowDirectSale: true }, ctx());
  desc = describeSalesRules({ platforms, customers });
  assert(!desc.effectiveAllowPlatformSale && desc.effectiveAllowDirectSale && desc.effectiveSaleMode === 'direct', 'الحالة 2: البيع المباشر فقط');
  assert(saleModeViolation({ isPlatformSale: true })?.code === 'PLATFORM_SALE_DISABLED', 'الحالة 2: رفض بيع المنصة');
  assert(saleModeViolation({ isPlatformSale: false }) === null, 'الحالة 2: السماح بالبيع المباشر');

  // 3) المنصات فقط
  saveSalesRules({ allowPlatformSale: true, allowDirectSale: false }, ctx());
  desc = describeSalesRules({ platforms, customers });
  assert(desc.effectiveAllowPlatformSale && !desc.effectiveAllowDirectSale && desc.effectiveSaleMode === 'platform', 'الحالة 3: البيع على منصة فقط');
  assert(saleModeViolation({ isPlatformSale: true }) === null, 'الحالة 3: السماح ببيع المنصة');
  assert(saleModeViolation({ isPlatformSale: false })?.code === 'DIRECT_SALE_DISABLED', 'الحالة 3: رفض البيع المباشر');

  // 4) كلاهما معطّل
  saveSalesRules({ allowPlatformSale: false, allowDirectSale: false }, ctx());
  desc = describeSalesRules({ platforms, customers });
  assert(!desc.effectiveAllowPlatformSale && !desc.effectiveAllowDirectSale, 'الحالة 4: كلا الوضعين معطّل');
  assert(saleModeViolation({ isPlatformSale: true })?.code === 'ALL_SALE_MODES_DISABLED', 'الحالة 4: رفض بيع المنصة عند تعطيل الاثنين');
  assert(saleModeViolation({ isPlatformSale: false })?.code === 'ALL_SALE_MODES_DISABLED', 'الحالة 4: رفض البيع المباشر عند تعطيل الاثنين');

  // التوافق مع platformsEnabled و salesOnlyMode
  saveSalesRules({ platformsEnabled: false, salesOnlyMode: false, allowDirectSale: false }, ctx());
  let caughtCompat: any = null;
  try {
    saveSalesRules({ allowPlatformSale: true }, ctx());
  } catch (e) {
    caughtCompat = e;
  }
  assert(caughtCompat instanceof SalesRulesError, 'يُرفض تفعيل allowPlatformSale عندما تكون platformsEnabled متوقفة');
  assert(getSalesRules().allowDirectSale === false, 'لا يتغير allowDirectSale صمتًا عند رفض تفعيل المنصة');

  saveSalesRules({ salesOnlyMode: true, allowDirectSale: true }, ctx());
  desc = describeSalesRules({ platforms, customers });
  assert(!desc.effectiveAllowPlatformSale && desc.effectiveAllowDirectSale, 'وضع البيع فقط يعطّل البيع على منصة فعليًا ويبقي المباشر مستقلًا');
  let caughtSalesOnly: any = null;
  try {
    saveSalesRules({ allowPlatformSale: true }, ctx());
  } catch (e) {
    caughtSalesOnly = e;
  }
  assert(caughtSalesOnly instanceof SalesRulesError, 'يُرفض تفعيل allowPlatformSale أثناء تفعيل salesOnlyMode');

  // استعادة الافتراضي عبر التفعيل الصريح
  saveSalesRules({ salesOnlyMode: false, platformsEnabled: true, allowPlatformSale: true, allowDirectSale: true }, ctx());
  r = getSalesRules();
  assert(r.allowPlatformSale === true && r.allowDirectSale === true && r.platformsEnabled === true, 'استعادة الحالتين بنجاح');
}

async function runServerAndOfflineChecks() {
  console.log('\n2) فحص API الخادم والمزامنة وحماية عدم وجود منصة نشطة + Offline IndexedDB');
  const TENANT = 'test_salemodes_toggles';
  const ADMIN_PASS = 'Modes#Admin2026';
  const INITIAL_PASS = process.env.INITIAL_USER_PASSWORD || '1234';
  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { app, persistence } = await createServerApp({
    attachVite: false,
    persistenceTransport: fake.transport,
    persistenceTenant: TENANT
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: res.status, data };
  };

  try {
    const loginAs = async (username: string, name: string, newPassword: string) => {
      const login = await call('POST', '/api/auth/login', { username, password: INITIAL_PASS });
      const token = login.data.token as string;
      const setup = await call('POST', '/api/auth/complete-initial-setup', { name, username, newPassword }, token);
      assert(setup.status === 200, `تهيئة حساب ${username}`);
      return token;
    };
    const owner = await loginAs('admin', 'مالك النظام', ADMIN_PASS);
    const manager = await loginAs('manager', 'مشرف فرع', 'Modes#Manager2026');

    await call('POST', '/api/platforms', { name: 'البيع المباشر', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, owner);
    const noonRes = await call('POST', '/api/platforms', { name: 'نون', discountPercentage: 10, pickupFee: 5, status: 'نشطة' }, owner);
    const noonPlatform = noonRes.data.platform;
    assert(Boolean(noonPlatform?.id), 'إنشاء منصة نشطة (نون)');

    const catRes = await call('POST', '/api/categories', { name: 'إلكترونيات' }, owner);
    const itemRes = await call('POST', '/api/items', {
      name: 'سماعة اختبار',
      barcode: '6221000099911',
      purchasePrice: 50,
      salePrice: 120,
      stockQuantity: 100,
      categoryId: catRes.data.category.id,
      unit: 'قطعة'
    }, owner);
    const item = itemRes.data.item;
    assert(Boolean(item?.id), 'إنشاء صنف اختبار');

    // الصلاحيات على settings.sales_rules
    const unauthSave = await call('POST', '/api/settings/sales-rules', { allowPlatformSale: false }, manager);
    assert(unauthSave.status === 403, 'يُرفض تعديل مفتاحي البيع لمن لا يملك صلاحية settings.sales_rules (403)');

    let seq = 0;
    const sellDirect = () =>
      call('POST', '/api/invoices', {
        idempotencyKey: `m-direct-${Date.now()}-${++seq}`,
        platform: 'البيع المباشر',
        platformId: 'direct',
        paymentType: 'نقدي',
        lines: [{ itemId: item.id, quantity: 1 }]
      }, owner);

    const sellPlatform = (plat = noonPlatform) =>
      call('POST', '/api/invoices', {
        idempotencyKey: `m-plat-${Date.now()}-${++seq}`,
        platformId: plat.id,
        platformName: plat.name,
        paymentType: 'آجل',
        creditPartyType: 'platform',
        lines: [{ itemId: item.id, quantity: 1 }]
      }, owner);

    // 1. الاثنان مفعّلان
    assert((await sellDirect()).status === 200, 'API (الحالة 1): البيع المباشر يعمل');
    assert((await sellPlatform()).status === 200, 'API (الحالة 1): البيع على منصة يعمل');

    // 2. المباشر فقط
    let saveRulesRes = await call('POST', '/api/settings/sales-rules', { allowPlatformSale: false, allowDirectSale: true }, owner);
    assert(saveRulesRes.status === 200 && saveRulesRes.data.rules.allowPlatformSale === false, 'API: حفظ وضع المباشر فقط');
    assert((await sellDirect()).status === 200, 'API (الحالة 2): البيع المباشر يعمل');
    const platBlocked = await sellPlatform();
    assert(platBlocked.status === 403 && platBlocked.data.code === 'PLATFORM_SALE_DISABLED', 'API (الحالة 2): البيع على منصة مرفوض بـ 403');

    // 3. المنصة فقط
    saveRulesRes = await call('POST', '/api/settings/sales-rules', { allowPlatformSale: true, allowDirectSale: false }, owner);
    assert(saveRulesRes.status === 200 && saveRulesRes.data.rules.allowDirectSale === false, 'API: حفظ وضع المنصة فقط');
    assert((await sellPlatform()).status === 200, 'API (الحالة 3): البيع على منصة يعمل');
    const directBlocked = await sellDirect();
    assert(directBlocked.status === 403 && directBlocked.data.code === 'DIRECT_SALE_DISABLED', 'API (الحالة 3): البيع المباشر مرفوض بـ 403');
    const disguisedDirectOnline = await call('POST', '/api/invoices', {
      idempotencyKey: `m-direct-disguised-${Date.now()}-${++seq}`,
      platform: 'البيع المباشر',
      platformId: 'direct',
      paymentType: 'آجل',
      creditPartyType: 'platform',
      lines: [{ itemId: item.id, quantity: 1 }]
    }, owner);
    assert(disguisedDirectOnline.status === 403 && disguisedDirectOnline.data.code === 'DIRECT_SALE_DISABLED', 'API (الحالة 3): رفض البيع المباشر حتى لو أُرسل مع creditPartyType=platform');
    const disguisedDirectOfflineSync = await call('POST', '/api/offline/sync', {
      idempotencyKey: `m-direct-sync-disguised-${Date.now()}-${++seq}`,
      platform: 'البيع المباشر',
      platformId: 'direct',
      paymentType: 'آجل',
      creditPartyType: 'platform',
      lines: [{ itemId: item.id, quantity: 1 }]
    }, owner);
    assert(disguisedDirectOfflineSync.status === 403 && disguisedDirectOfflineSync.data.code === 'DIRECT_SALE_DISABLED', 'API sync (الحالة 3): رفض مزامنة بيع مباشر مموّه بـ creditPartyType=platform');

    // حالة عدم وجود منصة نشطة في وضع المنصة فقط: لا يسقط تلقائيًا للبيع المباشر ويمنع الحفظ
    const deactRes = await call('POST', '/api/platforms', { ...noonPlatform, status: 'موقوفة' }, owner);
    assert(deactRes.status === 200, 'API: إيقاف المنصة النشطة بنجاح');
    const noActivePlatRes = await sellPlatform();
    assert(noActivePlatRes.status === 400 && noActivePlatRes.data.code === 'ACTIVE_PLATFORM_REQUIRED', 'API: في وضع المنصة بدون منصة نشطة يُرفض الحفظ ولا يُحوّل للبيع المباشر');
    const reactRes = await call('POST', '/api/platforms', { ...noonPlatform, status: 'نشطة' }, owner);
    assert(reactRes.status === 200, 'API: إعادة تفعيل المنصة النشطة بنجاح');

    // 4. كلاهما معطّل
    saveRulesRes = await call('POST', '/api/settings/sales-rules', { allowPlatformSale: false, allowDirectSale: false }, owner);
    assert(saveRulesRes.status === 200, 'API: حفظ تعطيل الوضعين معًا');
    const bothPlat = await sellPlatform();
    const bothDirect = await sellDirect();
    assert(bothPlat.status === 403 && bothPlat.data.code === 'ALL_SALE_MODES_DISABLED', 'API (الحالة 4): البيع على منصة مرفوض بـ ALL_SALE_MODES_DISABLED');
    assert(bothDirect.status === 403 && bothDirect.data.code === 'ALL_SALE_MODES_DISABLED', 'API (الحالة 4): البيع المباشر مرفوض بـ ALL_SALE_MODES_DISABLED');

    // إعادة التحقق من الاستمرار بعد persistence.recover()
    await call('POST', '/api/settings/sales-rules', { allowPlatformSale: true, allowDirectSale: false }, owner);
    await persistence!.lock.run(async () => {
      await persistence!.recover();
    });
    const afterRecover = await call('GET', '/api/settings/sales-rules', undefined, owner);
    assert(afterRecover.data.rules.allowPlatformSale === true && afterRecover.data.rules.allowDirectSale === false, 'تُحفظ قيم المفتاحين وتُستعاد بعد إعادة التحميل');

    // =========================================================================
    // الجزء الثالث: IndexedDB أوفلاين + المزامنة مع رفض الخادم والحفظ للمراجعة بدون حلقة تكرار
    // =========================================================================
    console.log('\n3) فحص IndexedDB أوفلاين + رفض المزامنة عند تغير الإعدادات');
    setupMockIndexedDB();

    const cashboxesRes = await call('GET', '/api/cashboxes', undefined, owner);
    const cashbox = (cashboxesRes.data.cashboxes || [])[0];
    assert(Boolean(cashbox?.id), 'جلب الخزنة للاختبار المحلي');

    const ownerUser: any = {
      id: 'u-admin',
      name: 'مالك النظام',
      username: 'admin',
      role: 'designer',
      isOwner: true,
      permissions: []
    };

    const seedSnapshot = async (rulesOverride: any, platsOverride = [noonPlatform]) => {
      await saveOfflineSnapshot({
        user: ownerUser,
        items: [item],
        platforms: platsOverride,
        cashboxes: [cashbox],
        customers: [],
        settings: {
          taxSettings: { taxInclusive: true, platformCommissionOn: 'before_tax' },
          salesRules: {
            ...defaultSalesRules(),
            ...rulesOverride
          }
        }
      });
    };

    // فحص 4 حالات أوفلاين في createOfflineInvoiceInDb
    // أ) المباشر فقط: منصة مرفوضة، مباشر مسموح
    await seedSnapshot({ allowPlatformSale: false, allowDirectSale: true });
    let offErr: any = null;
    try {
      await createOfflineInvoiceInDb({
        invoicePayload: {
          idempotencyKey: `off-plat-blocked-${Date.now()}`,
          platformId: noonPlatform.id,
          platformName: noonPlatform.name,
          paymentType: 'آجل',
          creditPartyType: 'platform',
          lines: [{ itemId: item.id, quantity: 1, salePriceAtSale: 120 }]
        },
        user: ownerUser,
        salesRules: { ...defaultSalesRules(), allowPlatformSale: false, allowDirectSale: true }
      });
    } catch (e) {
      offErr = e;
    }
    assert(Boolean(offErr && /البيع على منصة/.test(offErr.message)), 'أوفلاين (المباشر فقط): يرفض حفظ فاتورة منصة محليًا');

    // ب) المنصة فقط: مباشر مرفوض، ومنصة موقوفة مرفوضة
    await seedSnapshot({ allowPlatformSale: true, allowDirectSale: false });
    offErr = null;
    try {
      await createOfflineInvoiceInDb({
        invoicePayload: {
          idempotencyKey: `off-dir-blocked-${Date.now()}`,
          platformId: 'direct',
          platformName: 'البيع المباشر',
          paymentType: 'نقدي',
          cashboxId: cashbox.id,
          lines: [{ itemId: item.id, quantity: 1, salePriceAtSale: 120 }]
        },
        user: ownerUser,
        salesRules: { ...defaultSalesRules(), allowPlatformSale: true, allowDirectSale: false }
      });
    } catch (e) {
      offErr = e;
    }
    assert(Boolean(offErr && /البيع المباشر/.test(offErr.message)), 'أوفلاين (المنصة فقط): يرفض حفظ فاتورة بيع مباشر محليًا');

    offErr = null;
    try {
      await createOfflineInvoiceInDb({
        invoicePayload: {
          idempotencyKey: `off-dir-disguised-${Date.now()}`,
          platformId: 'direct',
          platformName: 'البيع المباشر',
          paymentType: 'آجل',
          creditPartyType: 'platform',
          lines: [{ itemId: item.id, quantity: 1, salePriceAtSale: 120 }]
        },
        user: ownerUser,
        salesRules: { ...defaultSalesRules(), allowPlatformSale: true, allowDirectSale: false }
      });
    } catch (e) {
      offErr = e;
    }
    assert(Boolean(offErr && /البيع المباشر/.test(offErr.message)), 'أوفلاين (المنصة فقط): يرفض البيع المباشر المموّه بـ creditPartyType=platform');

    // عدم وجود منصة نشطة أوفلاين في وضع المنصة فقط
    await seedSnapshot({ allowPlatformSale: true, allowDirectSale: false }, []);
    offErr = null;
    try {
      await createOfflineInvoiceInDb({
        invoicePayload: {
          idempotencyKey: `off-no-plat-${Date.now()}`,
          platformId: noonPlatform.id,
          platformName: noonPlatform.name,
          paymentType: 'آجل',
          creditPartyType: 'platform',
          lines: [{ itemId: item.id, quantity: 1, salePriceAtSale: 120 }]
        },
        user: ownerUser,
        salesRules: { ...defaultSalesRules(), allowPlatformSale: true, allowDirectSale: false }
      });
    } catch (e) {
      offErr = e;
    }
    assert(Boolean(offErr && /لا توجد منصة نشطة/.test(offErr.message)), 'أوفلاين (المنصة فقط): يمنع الحفظ عند عدم وجود منصة نشطة');

    // ج) تعطيل الاثنين أوفلاين
    await seedSnapshot({ allowPlatformSale: false, allowDirectSale: false });
    offErr = null;
    try {
      await createOfflineInvoiceInDb({
        invoicePayload: {
          idempotencyKey: `off-both-blocked-${Date.now()}`,
          platformId: 'direct',
          platformName: 'البيع المباشر',
          paymentType: 'نقدي',
          cashboxId: cashbox.id,
          lines: [{ itemId: item.id, quantity: 1, salePriceAtSale: 120 }]
        },
        user: ownerUser,
        salesRules: { ...defaultSalesRules(), allowPlatformSale: false, allowDirectSale: false }
      });
    } catch (e) {
      offErr = e;
    }
    assert(Boolean(offErr && /معطلان/.test(offErr.message)), 'أوفلاين (كلاهما معطّل): يرفض إنشاء أي فاتورة');

    // د) تسجيل عمليتي أوفلاين (منصة + مباشر) أثناء تفعيل الاثنين، ثم تعطيل المنصة على السيرفر ومزامنة Outbox
    await seedSnapshot({ allowPlatformSale: true, allowDirectSale: true }, [noonPlatform]);
    const offPlatIdem = `off-sync-plat-${Date.now()}`;
    const offDirIdem = `off-sync-dir-${Date.now()}`;

    await createOfflineInvoiceInDb({
      invoicePayload: {
        idempotencyKey: offPlatIdem,
        platformId: noonPlatform.id,
        platformName: noonPlatform.name,
        paymentType: 'آجل',
        creditPartyType: 'platform',
        lines: [{ itemId: item.id, quantity: 1, salePriceAtSale: 120 }]
      },
      user: ownerUser,
      salesRules: { ...defaultSalesRules(), allowPlatformSale: true, allowDirectSale: true }
    });
    await createOfflineInvoiceInDb({
      invoicePayload: {
        idempotencyKey: offDirIdem,
        platformId: 'direct',
        platformName: 'البيع المباشر',
        paymentType: 'نقدي',
        cashboxId: cashbox.id,
        lines: [{ itemId: item.id, quantity: 1, salePriceAtSale: 120 }]
      },
      user: ownerUser,
      salesRules: { ...defaultSalesRules(), allowPlatformSale: true, allowDirectSale: true }
    });

    assert((await getOutboxPendingCount()) === 2, 'تسجيل عمليتي أوفلاين في صندوق الصادر قبل عودة الاتصال');

    // الآن الخادم يعطّل البيع على منصة ويبقي البيع المباشر مفعّلًا
    await call('POST', '/api/settings/sales-rules', { allowPlatformSale: false, allowDirectSale: true }, owner);

    const syncResult = await syncOutboxOperations({
      user: ownerUser,
      skipSnapshotRefresh: true,
      disableAutoRetrySchedule: true,
      sender: async (payload) => {
        const res = await call('POST', '/api/offline/sync', payload, owner);
        return res.data;
      }
    });

    assert(syncResult.syncedCount === 1, 'عملية البيع المباشر المسموحة تمت مزامنتها بنجاح');
    assert(syncResult.rejectedReviewCount === 1, 'عملية البيع على منصة المرفوضة سُجّلت في rejectedReviewCount');
    assert(syncResult.failedCount === 0, 'لا تُسجّل العملية المرفوضة كفشل مؤقت يُعاد تكراره تلقائيًا');
    assert(syncResult.nextRetryDelayMs === null, 'لم تُجدول حلقة إعادة محاولة تلقائية للعملية المرفوضة');
    assert((await getOutboxPendingCount()) === 0, 'توقفت قائمة الانتظار المعلقة عن محاولة رفعها تلقائيًا');

    const allOps = await getOutboxOperations();
    const preservedPlatOp = allOps.find(o => o.idempotencyKey === offPlatIdem);
    assert(Boolean(preservedPlatOp), 'العملية المرفوضة لم تُحذف وبقيت محفوظة في IndexedDB');
    assert(
      preservedPlatOp?.status === OUTBOX_REJECTED_REVIEW_STATUS && preservedPlatOp?.needsReview === true,
      'العملية المرفوضة أخذت حالة مرفوضة — تحتاج مراجعة مع needsReview: true'
    );
    assert(Boolean(preservedPlatOp?.lastError && /البيع على منصة/.test(preservedPlatOp.lastError)), 'سبب الرفض محفوظ بوضوح مع العملية');

    const summary = await getOutboxSummaryForSyncScreen();
    assert(summary.rejectedReviewCount === 1 && summary.failedOps.some(o => o.idempotencyKey === offPlatIdem), 'العملية المرفوضة تظهر في شاشة المزامنة للمراجعة');

    // فحص وجود ضوابط حماية المسودات والرسائل في ملفات الواجهة
    console.log('\n4) فحص ضوابط الواجهة لحماية المسودات وعدم وجود منصة نشطة');
    const posCode = fs.readFileSync(path.join(process.cwd(), 'src/pages/POSPage.tsx'), 'utf8');
    const panelCode = fs.readFileSync(path.join(process.cwd(), 'src/components/pos/PosInvoicePanel.tsx'), 'utf8');
    const settingsCode = fs.readFileSync(path.join(process.cwd(), 'src/pages/SettingsPage.tsx'), 'utf8');

    assert(settingsCode.includes('السماح بالبيع على منصة') && settingsCode.includes('السماح بالبيع المباشر للعميل'), 'الإعدادات تحتوي المفتاحين المستقلين');
    assert(posCode.includes("draft.saleMode === 'customer' ? 'customer' : 'platform'") && posCode.includes('saleModeBlockedReason'), 'POSPage يحفظ وضع المسودة المفتوحة ولا يعيد كتابته بصمت عند استعادتها');
    assert(panelCode.includes('تحويل المسودة إلى بيع مباشر') && panelCode.includes('تحويل المسودة إلى بيع على منصة') && panelCode.includes('لا توجد منصة نشطة متاحة'), 'PosInvoicePanel يعرض أزرار التحويل الصريحة للمسودة المحظورة ورسالة عدم وجود منصة نشطة');

    console.log(`\n🎉 جميع اختبارات مفتاحي البيع المسموح بها نجحت (${passed} تحققًا).`);
  } finally {
    persistence?.stop();
    server.close();
  }
}

async function main() {
  await runUnitChecks();
  await runServerAndOfflineChecks();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

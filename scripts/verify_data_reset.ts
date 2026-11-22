/**
 * اختبار إعادة الضبط (server/dataReset.ts) وربطها بالسيرفر عبر الـ API (بدون إنترنت — ناقل وهمي)
 * التشغيل:  npx tsx scripts/verify_data_reset.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import {
  resetOperations,
  factoryReset,
  findUnclassifiedCollections,
  getResetMeta,
  noteReset,
  isBeforeLastReset,
  getResetMetaCollection,
  OPERATION_COLLECTIONS
} from '../server/dataReset.ts';
import { createFakeTransport, type CollectionDef } from '../server/persistence/statePersistence.ts';

const TENANT = 'test_datareset';
const ADMIN_PASSWORD = 'Reset#Admin2026';
const MANAGER_PASSWORD = 'Reset#Manager2026';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

function unitTests() {
  const state: any = {
    items: [{ id: 'i1', name: 'قلم', stockQuantity: 7, totalStockQuantity: 7, salePrice: 10, warehouseStocks: [{ warehouseId: 'w1', quantity: 7 }] }],
    customers: [{ id: 'c1', name: 'عميل', openingBalance: 50, currentBalance: 120 }],
    suppliers: [{ id: 's1', name: 'مورد', openingBalance: 0, currentBalance: -300 }],
    platforms: [{ id: 'p1', name: 'منصة', discountPercentage: 5, currentBalance: 40 }],
    cashboxes: [{ id: 'cb1', name: 'الخزينة الرئيسية', openingBalance: 100, currentBalance: 900 }],
    invoices: [{ invoiceNumber: 'INV-1' }, { invoiceNumber: 'INV-2' }],
    stockMovements: [{ id: 'm1' }],
    warehouseStocks: [{ itemId: 'i1', warehouseId: 'w1', quantity: 7 }],
    users: [
      { id: 'u-owner', name: 'المالك', role: 'designer', warehouseConfig: { ids: ['w9'] } },
      { id: 'u-manager', name: 'مدير', role: 'manager', cashboxConfig: { id: 'cb9' } },
      { id: 'u-cashier', name: 'كاشير', role: 'employee' }
    ],
    userCashboxAssignments: [{ id: 'a1', userId: 'u-cashier' }],
    auditLogs: [{ id: 'l1' }],
    warehouseState: { warehouseDispatchSeq: 9, warehouseMigrationCompleted: true },
    undo: { something: true }
  };
  const list = (name: string, key: string): CollectionDef => ({ name, kind: 'list', get: () => state[key], set: v => { state[key] = v; } });
  const defs: CollectionDef[] = [
    list('items', 'items'), list('customers', 'customers'), list('suppliers', 'suppliers'), list('platforms', 'platforms'),
    list('cashboxes', 'cashboxes'), list('invoices', 'invoices'), list('stockMovements', 'stockMovements'), list('warehouseStocks', 'warehouseStocks'),
    list('users', 'users'), list('userCashboxAssignments', 'userCashboxAssignments'), list('auditLogs', 'auditLogs'),
    { name: 'state.warehouse', kind: 'single', get: () => state.warehouseState, set: v => { state.warehouseState = v; } },
    { name: 'state.bulkEditUndo', kind: 'single', get: () => state.undo, set: v => { state.undo = v; } }
  ];

  assert(findUnclassifiedCollections(defs).length === 0, 'كل المجموعات مصنفة');
  assert(findUnclassifiedCollections([...defs, list('brandNewThing', 'items')]).join() === 'brandNewThing', 'مجموعة جديدة غير مصنفة تُكتشف');

  const result = resetOperations(defs);
  assert(state.invoices.length === 0 && state.stockMovements.length === 0 && state.warehouseStocks.length === 0, 'العمليات مُسحت');
  assert(result.cleared.invoices === 2 && result.totalCleared === 4, 'عدد ما مُسح');
  assert(state.items.length === 1 && state.items[0].name === 'قلم' && state.items[0].salePrice === 10, 'الصنف باقٍ باسمه وسعره');
  assert(state.items[0].stockQuantity === 0 && state.items[0].totalStockQuantity === 0 && state.items[0].warehouseStocks[0].quantity === 0, 'كميات الصنف صُفّرت');
  assert(state.customers[0].name === 'عميل' && state.customers[0].openingBalance === 0 && state.customers[0].currentBalance === 0, 'العميل باقٍ ورصيده صفر');
  assert(state.suppliers[0].currentBalance === 0 && state.platforms[0].currentBalance === 0 && state.platforms[0].discountPercentage === 5, 'الموردون والمنصات: الرصيد صفر والبيانات باقية');
  assert(state.cashboxes[0].name === 'الخزينة الرئيسية' && state.cashboxes[0].currentBalance === 0 && state.cashboxes[0].openingBalance === 0, 'الخزينة باقية برصيد صفر');
  assert(state.users.length === 3 && state.auditLogs.length === 1, 'المستخدمون وسجل التدقيق باقون');
  assert(state.warehouseState.warehouseDispatchSeq === 0 && state.warehouseState.warehouseMigrationCompleted === true && state.undo === null, 'العدادات والتراجع');
  assert(OPERATION_COLLECTIONS.includes('invoices') && OPERATION_COLLECTIONS.includes('partyLedger'), 'قائمة مجموعات العمليات');

  // إعادة ضبط المصنع: يبقى المالك ومنفّذ العملية فقط
  const factory = factoryReset(defs, {
    applyCleanInitialState: () => {
      for (const def of defs) if (def.kind === 'list') def.set([]);
      state.cashboxes = [{ id: 'cb-main', name: 'الخزينة الرئيسية' }];
      state.users = [{ id: 'default-admin' }, { id: 'default-cashier' }];
    },
    keepUser: user => user.role === 'designer' || user.id === 'u-manager'
  });
  assert(state.users.map((u: any) => u.id).join() === 'u-owner,u-manager', 'يبقى المالك ومنفّذ العملية فقط');
  assert(!('warehouseConfig' in state.users[0]) && !('cashboxConfig' in state.users[1]), 'ربط المخازن والخزائن القديم يُزال');
  assert(state.items.length === 0 && state.customers.length === 0 && state.platforms.length === 0 && state.auditLogs.length === 0, 'كل البيانات مُسحت');
  assert(state.userCashboxAssignments.length === 2 && state.userCashboxAssignments.every((a: any) => a.cashboxId === 'cb-main'), 'ربط الحسابات الباقية بالخزينة الرئيسية');
  assert(factory.keptUsers.length === 2, 'نتيجة إعادة ضبط المصنع');
  let refused = false;
  try {
    factoryReset(defs, { applyCleanInitialState: () => undefined, keepUser: () => false });
  } catch {
    refused = true;
  }
  assert(refused && state.users.length === 2, 'لا تُنفَّذ لو لن يبقى أي حساب');

  // بيانات المتابعة
  assert(isBeforeLastReset('2020-01-01T00:00:00.000Z') === false, 'بدون إعادة ضبط سابقة لا يُرفض شيء');
  noteReset('operations', 'المالك', new Date('2026-11-19T10:00:00.000Z'));
  assert(isBeforeLastReset('2026-11-19T09:59:00.000Z') && !isBeforeLastReset('2026-11-19T10:01:00.000Z') && !isBeforeLastReset('not a date') && !isBeforeLastReset(undefined), 'تمييز العمليات الأقدم من إعادة الضبط');
  const metaDef = getResetMetaCollection();
  metaDef.set({});
  assert(getResetMeta().lastResetAt === '' && metaDef.name === 'state.resetMeta', 'مجموعة بيانات المتابعة');
  console.log('✅ اختبارات الوحدة نجحت');
}

async function httpTests() {
  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { getPersistenceCollections } = await import('../server/sheetsService.ts');
  const { app, persistence } = await createServerApp({ attachVite: false, persistenceTransport: fake.transport, persistenceTenant: TENANT });
  assert(persistence && persistence.isReady(), 'طبقة الحفظ جاهزة');
  const engine = persistence!;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  };
  const db = (collection: string) => fake.dump(TENANT).rows.filter(r => r.collection === collection);
  const loginAndSetup = async (username: string, name: string, password: string) => {
    const login = await call('POST', '/api/auth/login', { username, password: process.env.INITIAL_USER_PASSWORD || '1234' });
    assert(login.status === 200 && login.data?.token, `دخول ${username}`);
    const setup = await call('POST', '/api/auth/complete-initial-setup', { name, username, newPassword: password }, login.data.token);
    assert(setup.status === 200 && setup.data?.success, `استكمال إعداد ${username}: ${setup.data?.error || ''}`);
    return login.data.token as string;
  };
  const seed = async (token: string, suffix: string) => {
    assert((await call('POST', '/api/platforms', { name: `البيع المباشر ${suffix}`, discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, token)).status === 200, 'إضافة منصة');
    const item = await call('POST', '/api/items', { name: `قلم جاف ${suffix}`, barcode: `62212345${suffix}`, purchasePrice: 5, salePrice: 10, stockQuantity: 100, unit: 'قطعة' }, token);
    assert(item.status === 200 && item.data?.item?.id, `إضافة صنف: ${item.data?.error || ''}`);
    const invoice = await call('POST', '/api/invoices', { idempotencyKey: `rs-${suffix}-${Date.now()}`, platform: `البيع المباشر ${suffix}`, paymentType: 'نقدي', lines: [{ itemId: item.data.item.id, quantity: 3 }] }, token);
    assert(invoice.status === 200, `فاتورة: ${invoice.data?.error || ''}`);
    return item.data.item.id as string;
  };

  try {
    let admin = await loginAndSetup('admin', 'صاحب المحل', ADMIN_PASSWORD);
    const itemId = await seed(admin, '1001');
    assert(db('invoices').length === 1 && db('stockMovements').length >= 1 && db('items').length === 1, 'بيانات قبل إعادة الضبط');

    const status = await call('GET', '/api/system/reset-status', undefined, admin);
    assert(status.status === 200 && status.data.canResetOperations && status.data.canFactoryReset, 'حالة إعادة الضبط للمالك');
    assert(Array.isArray(status.data.unclassifiedCollections) && status.data.unclassifiedCollections.length === 0, `كل مجموعات النظام مصنفة في خطة إعادة الضبط (غير المصنف: ${(status.data.unclassifiedCollections || []).join('، ')})`);
    const opsPhrase = status.data.phrases.operations as string;
    const factoryPhrase = status.data.phrases.factory as string;

    // محاولات مرفوضة
    assert((await call('POST', '/api/system/reset-operations', { password: ADMIN_PASSWORD, confirmText: 'نعم' }, admin)).status === 400, 'بدون جملة التأكيد يُرفض');
    assert((await call('POST', '/api/system/reset-operations', { password: 'wrong', confirmText: opsPhrase }, admin)).status === 403, 'كلمة سر خاطئة تُرفض');
    assert((await call('POST', '/api/system/reset-operations', { password: ADMIN_PASSWORD, confirmText: opsPhrase })).status === 401, 'بدون دخول يُرفض');
    assert(db('invoices').length === 1, 'المحاولات المرفوضة لم تغيّر شيئًا');

    // فشل الحفظ: لا يتغير شيء
    fake.failNext('NETWORK');
    const failed = await call('POST', '/api/system/reset-operations', { password: ADMIN_PASSWORD, confirmText: opsPhrase }, admin);
    assert(failed.status === 503 && db('invoices').length === 1, 'فشل الحفظ: لم يُمسح شيء');
    assert((await call('GET', '/api/invoices', undefined, admin)).data.invoices.length === 1, 'النظام على حاله بعد محاولة فاشلة');

    // ---- إعادة ضبط العمليات ----
    const before = Date.now();
    const done = await call('POST', '/api/system/reset-operations', { password: ADMIN_PASSWORD, confirmText: opsPhrase }, admin);
    assert(done.status === 200 && done.data.success && done.data.cleared.invoices === 1, `إعادة ضبط العمليات: ${done.data?.error || ''}`);
    for (const name of ['invoices', 'stockMovements', 'warehouseStocks', 'cashboxTransactions', 'partyLedger', 'customerLedger']) {
      assert(db(name).length === 0, `"${name}" مُسحت من قاعدة البيانات`);
    }
    assert(db('items').length === 1 && db('platforms').length === 1 && db('users').length === 3, 'الأسماء والمستخدمون باقون');
    assert((db('items')[0].data as any).v.stockQuantity === 0, 'كمية الصنف صفر في قاعدة البيانات');
    assert(db('auditLogs').some(r => (r.data as any).v.action === 'SYSTEM_RESET_OPERATIONS'), 'العملية مسجلة في سجل التدقيق وسجل التدقيق باقٍ');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert((await call('GET', '/api/items', undefined, admin)).status === 401, 'كل الجلسات انتهت');
    admin = (await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD })).data.token;
    assert(admin, 'الدخول بعد إعادة ضبط العمليات');
    const items = await call('GET', '/api/items', undefined, admin);
    assert(items.data.items.length === 1 && items.data.items[0].stockQuantity === 0, 'الصنف ظاهر برصيد صفر');
    const config = await call('GET', '/api/config', undefined, admin);
    assert(config.data.dataEpoch && Date.parse(config.data.dataEpoch) >= before, '/api/config يعرض وقت آخر إعادة ضبط (dataEpoch)');
    const removed = await call('DELETE', `/api/items/${itemId}`, undefined, admin);
    assert(removed.status === 200 && removed.data?.success !== false, `بعد إعادة الضبط يمكن حذف الصنف: ${removed.data?.error || ''}`);

    // عملية أوفلاين أقدم من إعادة الضبط تُرفض
    const oldOp = await call('POST', '/api/offline/sync', { type: 'createInvoice', deviceTime: new Date(before - 60000).toISOString(), payload: { idempotencyKey: 'old-1', platform: 'البيع المباشر 1001', paymentType: 'نقدي', lines: [] } }, admin);
    assert(oldOp.status === 409 && oldOp.data.code === 'BEFORE_RESET' && /[\u0600-\u06FF]/.test(oldOp.data.error), 'عملية أوفلاين أقدم من إعادة الضبط تُرفض برسالة عربية');
    const newOp = await call('POST', '/api/offline/sync', { type: 'createInvoice', deviceTime: new Date(Date.now() + 1000).toISOString(), payload: { idempotencyKey: 'new-1', platform: 'البيع المباشر 1001', paymentType: 'نقدي', lines: [] } }, admin);
    assert(newOp.data?.code !== 'BEFORE_RESET', 'عملية أوفلاين بعد إعادة الضبط لا تُرفض بهذا السبب');

    // ---- إعادة ضبط المصنع بواسطة مستخدم غير المالك معه الصلاحية ----
    await seed(admin, '2002');
    const usersDef = getPersistenceCollections().find(def => def.name === 'users')!;
    const manager = (usersDef.get() as any[]).find(u => u.username === 'manager');
    manager.permissions = [...(manager.permissions || []), 'settings.factory_reset'];
    const managerToken = await loginAndSetup('manager', 'مدير الفرع', MANAGER_PASSWORD);
    assert((await call('POST', '/api/system/reset-operations', { password: MANAGER_PASSWORD, confirmText: opsPhrase }, managerToken)).status === 403, 'صلاحية إعادة ضبط المصنع لا تعطي صلاحية إعادة ضبط العمليات');
    const cashierLogin = await call('POST', '/api/auth/login', { username: 'cashier', password: process.env.INITIAL_USER_PASSWORD || '1234' });
    await call('POST', '/api/auth/complete-initial-setup', { name: 'أحمد كاشير', username: 'cashier', newPassword: 'Reset#Cashier2026' }, cashierLogin.data.token);
    assert((await call('POST', '/api/system/factory-reset', { password: 'Reset#Cashier2026', confirmText: factoryPhrase }, cashierLogin.data.token)).status === 403, 'الكاشير بدون الصلاحية لا ينفّذ إعادة ضبط المصنع');
    assert((await call('GET', '/api/system/reset-status', undefined, cashierLogin.data.token)).status === 403, 'الكاشير لا يرى حالة إعادة الضبط');

    const wiped = await call('POST', '/api/system/factory-reset', { password: MANAGER_PASSWORD, confirmText: factoryPhrase }, managerToken);
    assert(wiped.status === 200 && wiped.data.success && wiped.data.keptUsers.length === 2, `إعادة ضبط المصنع: ${wiped.data?.error || ''}`);
    for (const name of ['items', 'platforms', 'invoices', 'categories', 'customers', 'suppliers', 'stockMovements', 'itemBarcodes']) {
      assert(db(name).length === 0, `"${name}" مُسحت بالكامل`);
    }
    const usersLeft = db('users').map(r => (r.data as any).v.username).sort();
    assert(usersLeft.join() === 'admin,manager', `الباقي: حساب المالك وحساب منفّذ العملية فقط (${usersLeft.join()})`);
    assert(db('warehouses').length === 1 && db('cashboxes').length === 1 && (db('cashboxes')[0].data as any).v.currentBalance === 0, 'مخزن رئيسي وخزينة رئيسية فارغان');
    assert(db('auditLogs').length === 1 && (db('auditLogs')[0].data as any).v.action === 'SYSTEM_FACTORY_RESET', 'سجل التدقيق فيه سطر إعادة الضبط فقط');

    // إعادة تشغيل السيرفر: لا يرجع شيء مما مُسح
    await engine.lock.run(async () => {
      assert(await engine.recover(), 'تحميل الحالة بعد إعادة التشغيل');
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    const adminAgain = await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
    assert(adminAgain.status === 200 && adminAgain.data.token, 'حساب المالك باقٍ بكلمة سره');
    const managerAgain = await call('POST', '/api/auth/login', { username: 'manager', password: MANAGER_PASSWORD });
    assert(managerAgain.status === 200 && managerAgain.data.token, 'حساب منفّذ العملية باقٍ بكلمة سره');
    assert((await call('POST', '/api/auth/login', { username: 'cashier', password: 'Reset#Cashier2026' })).status !== 200, 'حساب الكاشير اتمسح');
    const logs = await call('GET', '/api/audit-logs', undefined, adminAgain.data.token);
    if (logs.status === 200) {
      const entries: any[] = logs.data.logs || logs.data.auditLogs || logs.data.data || [];
      assert(!entries.some(e => e.action === 'SYSTEM_RESET_OPERATIONS'), 'سجل التدقيق القديم لا يرجع بعد إعادة التشغيل');
    }
    assert((await call('GET', '/api/items', undefined, adminAgain.data.token)).data.items.length === 0, 'لا أصناف بعد إعادة ضبط المصنع');
    assert(engine.isReady() && !engine.hasPendingChanges(), 'لا تغييرات معلقة');
  } finally {
    engine.stop();
    server.close();
  }
}

async function main() {
  unitTests();
  await httpTests();
  console.log(`\n🎉 كل اختبارات إعادة الضبط نجحت (${passed} تحققًا).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌', err?.message || err);
    process.exit(1);
  });

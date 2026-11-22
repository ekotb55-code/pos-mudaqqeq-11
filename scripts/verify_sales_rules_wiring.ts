/**
 * اختبار ربط «إعدادات البيع وقواعد السعر» بالسيرفر عبر الـ API (بدون إنترنت — ناقل وهمي)
 * التشغيل:  npx tsx scripts/verify_sales_rules_wiring.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import { createFakeTransport } from '../server/persistence/statePersistence.ts';
import { readBackup } from '../server/backup.ts';

const TENANT = 'test_salesrules';
const ADMIN_PASSWORD = 'Sales#Admin2026';
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '1234';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

async function main() {
  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
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
    const buffer = Buffer.from(await res.arrayBuffer());
    let data: any = null;
    try {
      data = JSON.parse(buffer.toString('utf8'));
    } catch {
      data = null;
    }
    return { status: res.status, data, buffer };
  };
  const db = (collection: string) => fake.dump(TENANT).rows.filter(r => r.collection === collection);
  const savedRules = () => (db('settings.salesRules')[0]?.data as any)?.v ?? (db('settings.salesRules')[0]?.data as any);
  const arabic = /[\u0600-\u06FF]/;
  let counter = 0;

  try {
    const loginAs = async (username: string, name: string, newPassword: string) => {
      const login = await call('POST', '/api/auth/login', { username, password: INITIAL_PASSWORD });
      const token = login.data.token as string;
      const setup = await call('POST', '/api/auth/complete-initial-setup', { name, username, newPassword }, token);
      assert(setup.status === 200, `إعداد حساب ${username}: ${setup.data?.error || ''}`);
      return token;
    };
    let owner = await loginAs('admin', 'صاحب المحل', ADMIN_PASSWORD);
    const manager = await loginAs('manager', 'مدير الفرع', 'Sales#Manager2026');

    // ---- بيانات التجربة ----
    assert((await call('POST', '/api/platforms', { name: 'البيع المباشر', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, owner)).status === 200, 'منصة البيع المباشر');
    const noon = await call('POST', '/api/platforms', { name: 'نون', discountPercentage: 10, pickupFee: 0, status: 'نشطة' }, owner);
    assert(noon.status === 200 && noon.data?.platform?.id, `منصة نون: ${noon.data?.error || ''}`);
    const category = await call('POST', '/api/categories', { name: 'أدوات مكتبية' }, owner);
    const addItem = async (name: string, barcode: string, purchasePrice: number, salePrice: number) => {
      const item = await call('POST', '/api/items', { name, barcode, purchasePrice, salePrice, stockQuantity: 500, categoryId: category.data.category.id, unit: 'قطعة' }, owner);
      assert(item.status === 200 && item.data?.item?.id, `إضافة صنف ${name}: ${item.data?.error || ''}`);
      return item.data.item.id as string;
    };
    const itemNormal = await addItem('قلم بربح', '6221000000011', 50, 100);
    const itemLoss = await addItem('قلم بخسارة', '6221000000028', 50, 40);
    const itemFree = await addItem('هدية بسعر صفر', '6221000000035', 0, 0);
    const customer = await call('POST', '/api/customers', { name: 'عميل نقدي', phone: '01000000001' }, owner);
    const customerId = (customer.data?.customer?.id || customer.data?.data?.id || customer.data?.id) as string;
    assert(customer.status === 200 && customerId, `إضافة عميل: ${customer.data?.error || ''}`);

    const sell = (token: string, itemId: string, extra: Record<string, unknown> = {}) =>
      call('POST', '/api/invoices', { idempotencyKey: `rules-${Date.now()}-${++counter}`, platform: 'البيع المباشر', paymentType: 'نقدي', lines: [{ itemId, quantity: 1 }], ...extra }, token);
    const invoices = () => db('invoices').length;

    // ---- القراءة والصلاحية ----
    assert((await call('GET', '/api/settings/sales-rules')).status === 401, 'القراءة بدون دخول مرفوضة');
    let view = await call('GET', '/api/settings/sales-rules', undefined, manager);
    assert(view.status === 200 && view.data.rules.defaultSaleMode === 'last' && view.data.rules.platformSelection === 'first' && view.data.rules.customerSelection === 'none' && view.data.rules.allowZeroPriceSale === true && view.data.rules.allowBelowCostSale === true, 'أي مستخدم مسجل يقرأ الإعدادات، والافتراضي = السلوك الحالي');
    assert((await call('POST', '/api/settings/sales-rules', { allowBelowCostSale: false }, manager)).status === 403, 'التعديل بدون صلاحية settings.sales_rules مرفوض');

    // ---- بالافتراضي لا يتغير شيء ----
    const freeByDefault = await sell(manager, itemFree);
    assert(freeByDefault.status === 200, `بالافتراضي البيع بسعر صفر مسموح: ${freeByDefault.data?.error || ''}`);
    assert((await sell(manager, itemLoss)).status === 200, 'بالافتراضي البيع بأقل من سعر الشراء مسموح');

    // ---- منع البيع بأقل من سعر الشراء ----
    let saved = await call('POST', '/api/settings/sales-rules', { allowBelowCostSale: false }, owner);
    assert(saved.status === 200 && saved.data.rules.allowBelowCostSale === false && saved.data.rules.updatedBy === 'صاحب المحل', `المالك يحفظ الإعدادات: ${saved.data?.error || ''}`);
    assert(savedRules()?.allowBelowCostSale === false, 'الإعدادات محفوظة في قاعدة البيانات');
    let before = invoices();
    let refused = await sell(manager, itemLoss);
    assert(refused.status >= 400 && refused.status < 500 && refused.data.success === false && arabic.test(refused.data.error) && /سعر الشراء/.test(refused.data.error) && !refused.data.error.includes('50'), 'بدون صلاحية التجاوز: البيع بأقل من سعر الشراء يُرفض برسالة عربية لا تكشف سعر الشراء');
    assert(invoices() === before, 'الفاتورة المرفوضة لم تُحفظ');
    assert((await sell(manager, itemNormal)).status === 200, 'الصنف الرابح يُباع عادي');
    assert((await sell(manager, itemFree)).status === 200, 'صنف بلا سعر شراء لا يدخل في المقارنة');
    assert((await sell(owner, itemLoss)).status === 200, 'من معه صلاحية تجاوز الحد الأدنى للسعر يتعدى المنع');

    // ---- منع البيع بسعر صفر ----
    saved = await call('POST', '/api/settings/sales-rules', { allowBelowCostSale: true, allowZeroPriceSale: false }, owner);
    assert(saved.data.rules.allowZeroPriceSale === false && saved.data.rules.allowBelowCostSale === true, 'تبديل المفتاحين');
    before = invoices();
    refused = await sell(manager, itemFree);
    assert(refused.status >= 400 && refused.status < 500 && arabic.test(refused.data.error) && /صفر/.test(refused.data.error) && invoices() === before, 'بدون صلاحية التجاوز: البيع بسعر صفر يُرفض');
    assert((await sell(manager, itemLoss)).status === 200, 'أقل من الشراء مسموح الآن (مفتاح مستقل)');
    assert((await sell(owner, itemFree)).status === 200, 'صاحب صلاحية التجاوز يبيع بسعر صفر');

    // فاتورة أوفلاين مخالفة: تُقبل وتُعلَّم للمراجعة
    const offline = await sell(manager, itemFree, { isOfflineSync: true, invoiceNumber: 'OFF-RULES-1' });
    assert(offline.status === 200 && offline.data.needsReview === true && (offline.data.reviewReasons || []).includes('بيع بسعر صفر'), `فاتورة أوفلاين بسعر صفر تُقبل وتُعلَّم للمراجعة: ${offline.data?.error || JSON.stringify(offline.data?.reviewReasons)}`);

    // ---- العميل «لازم يختار بإيده» ----
    saved = await call('POST', '/api/settings/sales-rules', { allowZeroPriceSale: true, customerSelection: 'manual' }, owner);
    assert(saved.data.rules.customerSelection === 'manual' && saved.data.rules.effectiveCustomerSelection === 'manual', 'العميل: لازم يختار بإيده');
    before = invoices();
    refused = await sell(manager, itemNormal);
    assert(refused.status >= 400 && refused.status < 500 && refused.data.code === 'CUSTOMER_REQUIRED' && arabic.test(refused.data.error) && invoices() === before, 'بيع مباشر بدون عميل يُرفض');
    assert((await sell(owner, itemNormal)).status >= 400, 'شرط اختيار العميل يسري على الجميع حتى المالك');
    const withCustomer = await sell(manager, itemNormal, { customerId });
    assert(withCustomer.status === 200, `مع اختيار العميل تُحفظ الفاتورة: ${withCustomer.data?.error || ''}`);
    const platformSale = await sell(manager, itemNormal, { platform: 'نون', platformId: noon.data.platform.id, platformName: 'نون' });
    assert(platformSale.status === 200, `بيع المنصات لا يشترط عميلًا: ${platformSale.data?.error || ''}`);
    const offlineNoCustomer = await sell(manager, itemNormal, { isOfflineSync: true, invoiceNumber: 'OFF-RULES-2' });
    assert(offlineNoCustomer.status === 200 && (offlineNoCustomer.data.reviewReasons || []).includes('بيع مباشر بدون اختيار عميل'), 'فاتورة أوفلاين بدون عميل تُقبل وتُعلَّم للمراجعة');

    // ---- منصة وعميل محددان ----
    let bad = await call('POST', '/api/settings/sales-rules', { platformSelection: 'fixed', defaultPlatformId: 'nope' }, owner);
    assert(bad.status === 400 && arabic.test(bad.data.error), 'منصة غير موجودة تُرفض برسالة عربية');
    bad = await call('POST', '/api/settings/sales-rules', { customerSelection: 'fixed', defaultCustomerId: 'nope' }, owner);
    assert(bad.status === 400 && arabic.test(bad.data.error), 'عميل غير موجود يُرفض برسالة عربية');
    bad = await call('POST', '/api/settings/sales-rules', { defaultSaleMode: 'x' }, owner);
    assert(bad.status === 400 && arabic.test(bad.data.error), 'قيمة غير معروفة تُرفض');
    saved = await call('POST', '/api/settings/sales-rules', { defaultSaleMode: 'platform', platformSelection: 'fixed', defaultPlatformId: noon.data.platform.id, customerSelection: 'fixed', defaultCustomerId: customerId }, owner);
    assert(saved.status === 200 && saved.data.rules.defaultPlatformName === 'نون' && saved.data.rules.defaultCustomerName === 'عميل نقدي' && saved.data.rules.defaultPlatformMissing === false, 'حفظ منصة وعميل افتراضيين مع اسميهما');
    view = await call('GET', '/api/settings/sales-rules', undefined, manager);
    assert(view.data.rules.defaultSaleMode === 'platform' && view.data.rules.effectivePlatformSelection === 'fixed' && view.data.rules.defaultCustomerId === customerId, 'شاشة البيع تقرأ الافتراضيات الجديدة');
    assert((await sell(manager, itemNormal)).status === 200, 'العميل لم يعد إجباريًا بعد تغيير الإعداد');

    // ---- سجل التدقيق ----
    assert(db('auditLogs').some(r => String((r.data as any).v.action) === 'SALES_RULES_UPDATED'), 'تعديل الإعدادات مسجل في سجل التدقيق');

    // ---- إعادة تشغيل السيرفر ----
    const beforeRestart = JSON.stringify((await call('GET', '/api/settings/sales-rules', undefined, owner)).data.rules);
    await engine.lock.run(async () => {
      assert(await engine.recover(), 'تحميل الحالة بعد إعادة التشغيل');
    });
    assert(JSON.stringify((await call('GET', '/api/settings/sales-rules', undefined, owner)).data.rules) === beforeRestart, 'الإعدادات مطابقة بعد إعادة التشغيل');

    // ---- النسخة الاحتياطية تحمل إعدادات البيع والخزن المربوطة ----
    const exported = await call('GET', '/api/backup/export', undefined, owner);
    assert(exported.status === 200, 'تنزيل نسخة احتياطية');
    const parsed = readBackup(exported.buffer);
    assert((parsed.data['settings.salesRules'] as any)?.defaultSaleMode === 'platform', 'ملف النسخة فيه إعدادات البيع');
    for (const name of ['bank.accounts', 'bank.templates', 'bank.settings', 'bank.manualAccounts', 'bank.manualEntries']) {
      assert(Object.prototype.hasOwnProperty.call(parsed.data, name), `ملف النسخة فيه ${name}`);
    }
    await call('POST', '/api/settings/sales-rules', { defaultSaleMode: 'direct', platformSelection: 'manual', allowBelowCostSale: false }, owner);
    const restored = await call('POST', '/api/backup/restore', { fileBase64: exported.buffer.toString('base64'), password: ADMIN_PASSWORD, confirmText: 'استرجاع' }, owner);
    assert(restored.status === 200, `استرجاع النسخة: ${restored.data?.error || ''}`);
    assert(savedRules()?.defaultSaleMode === 'platform' && savedRules()?.platformSelection === 'fixed' && savedRules()?.allowBelowCostSale === true, 'الاسترجاع يرجّع إعدادات البيع كما كانت في النسخة');

    // ---- إعادة ضبط المصنع ترجع الافتراضي ----
    owner = (await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD })).data.token as string;
    const status = await call('GET', '/api/system/reset-status', undefined, owner);
    const factory = await call('POST', '/api/system/factory-reset', { password: ADMIN_PASSWORD, confirmText: status.data.phrases.factory }, owner);
    assert(factory.status === 200, `إعادة ضبط المصنع: ${factory.data?.error || ''}`);
    const afterReset = savedRules();
    assert(afterReset?.defaultSaleMode === 'last' && afterReset?.platformSelection === 'first' && afterReset?.customerSelection === 'none' && afterReset?.allowZeroPriceSale === true && afterReset?.allowBelowCostSale === true && afterReset?.defaultPlatformId === '', 'بعد إعادة ضبط المصنع: الإعدادات الافتراضية');

    console.log(`\n🎉 كل اختبارات ربط إعدادات البيع وقواعد السعر نجحت (${passed} تحققًا).`);
  } finally {
    engine.stop();
    server.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌', err?.message || err);
    process.exit(1);
  });

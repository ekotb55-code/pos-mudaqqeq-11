/**
 * اختبار ربط سجل شاشة البيع بالسيرفر عبر الـ API (بدون إنترنت — ناقل وهمي)
 * التشغيل:  npx tsx scripts/verify_cart_journal_wiring.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import { createFakeTransport } from '../server/persistence/statePersistence.ts';
import { CartJournalClient } from '../src/offline/cartJournal.ts';

const TENANT = 'test_cjwiring';
const NEW_PASSWORD = 'Journal#Test2026';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

async function main() {
  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { app, persistence, cartJournal } = await createServerApp({
    attachVite: false,
    persistenceTransport: fake.transport,
    persistenceTenant: TENANT
  });
  assert(persistence && persistence.isReady() && cartJournal && cartJournal.isReady(), 'طبقة الحفظ وسجل شاشة البيع جاهزان');

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
  const journalDb = (collection: string) => fake.dump(`${TENANT}_journal`).rows.filter(r => r.collection === collection).length;
  const loginAndSetup = async (username: string, name: string) => {
    const login = await call('POST', '/api/auth/login', { username, password: process.env.INITIAL_USER_PASSWORD || '1234' });
    assert(login.status === 200 && login.data?.token, `دخول ${username}`);
    const setup = await call('POST', '/api/auth/complete-initial-setup', { name, username, newPassword: NEW_PASSWORD }, login.data.token);
    assert(setup.status === 200 && setup.data?.success, `استكمال إعداد ${username}: ${setup.data?.error || ''}`);
    return login.data.token as string;
  };

  try {
    const admin = await loginAndSetup('admin', 'صاحب المحل');
    const platform = await call('POST', '/api/platforms', { name: 'البيع المباشر', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, admin);
    assert(platform.status === 200, 'إضافة منصة');
    const addItem = async (name: string, barcode: string) => {
      const res = await call('POST', '/api/items', { name, barcode, purchasePrice: 5, salePrice: 10, stockQuantity: 100, unit: 'قطعة' }, admin);
      assert(res.status === 200 && res.data?.item?.id, `إضافة صنف ${name}: ${res.data?.error || ''}`);
      return res.data.item as { id: string; name: string; barcode: string };
    };
    const pen = await addItem('قلم جاف أزرق', '6221111111111');
    const book = await addItem('كراس 60 ورقة', '6222222222222');

    // جهاز الكاشير: نفس كود الواجهة، والإرسال عبر الـ API الحقيقي
    const data = new Map<string, string>();
    const makeClient = (token: string) =>
      new CartJournalClient({
        storage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: k => void data.delete(k) },
        autoTimers: false,
        send: async payload => {
          const res = await call('POST', '/api/cart-journal/events', payload, token);
          if (res.status !== 200 || !res.data?.success) throw new Error(`فشل الإرسال ${res.status}`);
          return { lastSeq: res.data.lastSeq };
        }
      });
    const client = makeClient(admin);
    client.start();
    const line = (item: { id: string; name: string; barcode: string }, quantity: number) => ({ itemId: item.id, name: item.name, barcode: item.barcode, unitPrice: 10, quantity });

    // الأحداث لا تمر بطابور الحفظ الرئيسي
    const mainGeneration = persistence!.getStatus().generation;
    client.syncCart([line(pen, 8)], { warehouseName: 'المخزن الرئيسي', platform: 'البيع المباشر' });
    client.syncCart([line(pen, 8), line(book, 1)]);
    client.syncCart([line(pen, 2)]);
    assert(await client.flush(), 'رفع أحداث الفاتورة المفتوحة');
    assert(persistence!.getStatus().generation === mainGeneration, 'أحداث شاشة البيع لا تدخل طابور الحفظ الرئيسي');
    assert(journalDb('carts') === 1 && journalDb('devices') === 1, 'السجل محفوظ في قاعدة البيانات تحت شركة السجل المستقلة');

    let report = await call('GET', '/api/reports/unsold-cart-items', undefined, admin);
    assert(report.status === 200 && report.data?.report?.rows?.length === 3, 'التقرير يعرض الفاتورة المفتوحة لحظيًا');
    assert(report.data.report.summary.openCarts === 1, 'عدد الفواتير المفتوحة = 1');

    // حفظ الفاتورة ومعها cartId
    const cartId = client.currentCartId();
    const invoice = await call(
      'POST',
      '/api/invoices',
      { idempotencyKey: `cjw-${Date.now()}`, cartId, platform: 'البيع المباشر', paymentType: 'نقدي', lines: [{ itemId: pen.id, quantity: 2 }] },
      admin
    );
    assert(invoice.status === 200 && invoice.data?.invoice?.invoiceNumber, `حفظ الفاتورة: ${invoice.data?.error || ''}`);
    assert(invoice.data.invoice.cartId === cartId, 'الفاتورة المحفوظة تحمل cartId');
    client.cartSaved();
    await new Promise(resolve => setTimeout(resolve, 100));

    report = await call('GET', '/api/reports/unsold-cart-items', undefined, admin);
    const rows = report.data.report.rows as any[];
    assert(rows.length === 2 && rows.every(r => r.cartStatus === 'sold' && r.invoiceNumber === invoice.data.invoice.invoiceNumber), 'بعد البيع يبقى غير المباع فقط');
    const reduced = rows.find(r => r.itemId === pen.id);
    const removed = rows.find(r => r.itemId === book.id);
    assert(reduced?.event === 'reduce' && reduced.quantity === 6 && reduced.eventLabel === 'قلّت الكمية من 8 إلى 2', 'سطر «قلّت الكمية من 8 إلى 2» بكمية 6');
    assert(removed?.event === 'remove' && removed.quantity === 1 && removed.value === 10, 'سطر «حذف صنف من الفاتورة»');
    assert(report.data.report.summary.value === 70 && report.data.report.summary.byUser[0].userName === 'صاحب المحل', 'الملخص حسب المستخدم');
    assert(report.data.report.alerts.some((a: any) => a.type === 'new_device'), 'تنبيه «جهاز جديد»');

    // الفلاتر عبر الـ API
    const onlyReduce = await call('GET', '/api/reports/unsold-cart-items?event=reduce', undefined, admin);
    assert(onlyReduce.data.report.rows.length === 1, 'فلتر الحدث عبر الـ API');

    // الصلاحيات: بدون دخول = 401، الكاشير بدون الصلاحية = 403 لكنه يستطيع إرسال الأحداث
    const anonymous = await call('GET', '/api/reports/unsold-cart-items');
    assert(anonymous.status === 401, 'التقرير بدون تسجيل دخول مرفوض');
    const anonymousEvents = await call('POST', '/api/cart-journal/events', { deviceId: 'dev-anonymous-0001', events: [] });
    assert(anonymousEvents.status === 401, 'إرسال الأحداث بدون تسجيل دخول مرفوض');
    const cashier = await loginAndSetup('cashier', 'أحمد كاشير');
    const cashierReport = await call('GET', '/api/reports/unsold-cart-items', undefined, cashier);
    assert(cashierReport.status === 403, 'الكاشير بدون الصلاحية لا يرى التقرير');
    const cashierEvents = await call(
      'POST',
      '/api/cart-journal/events',
      { deviceId: 'dev-cashier-device-01', events: [{ seq: 1, cartId: 'c-cashiercart01', type: 'qty', itemId: book.id, itemName: book.name, unitPrice: 10, qty: 3 }] },
      cashier
    );
    assert(cashierEvents.status === 200 && cashierEvents.data.lastSeq === 1, 'الكاشير يستطيع إرسال أحداث شاشة البيع');
    report = await call('GET', '/api/reports/unsold-cart-items?status=open', undefined, admin);
    assert(report.data.report.rows.some((r: any) => r.userName === 'أحمد كاشير' && r.quantity === 3), 'اسم المستخدم يؤخذ من جلسة الدخول لا من الجهاز');

    // مدخلات غير صالحة
    const bad = await call('POST', '/api/cart-journal/events', { deviceId: 'x', events: [] }, admin);
    assert(bad.status === 400 && /[\u0600-\u06FF]/.test(String(bad.data?.error || '')), 'معرّف جهاز غير صالح يُرفض برسالة عربية');

    // فشل حفظ السجل: الجهاز يحتفظ بالحدث ويعيد المحاولة، والنظام الرئيسي لا يتأثر
    client.syncCart([line(book, 5)]);
    fake.failNext('NETWORK', 'app_persist_changes');
    let failed = false;
    try {
      await client.flush();
    } catch {
      failed = true;
    }
    assert(failed && client.pendingCount() === 1, 'فشل حفظ السجل: الحدث باقٍ على الجهاز');
    assert(persistence!.isReady(), 'النظام الرئيسي لم يتأثر بفشل السجل');
    assert(await client.flush(), 'إعادة المحاولة تنجح');
    client.cartSaved();

    console.log(`\n🎉 كل اختبارات ربط سجل شاشة البيع نجحت (${passed} تحققًا).`);
  } finally {
    persistence?.stop();
    cartJournal?.stop();
    server.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌', err?.message || err);
    process.exit(1);
  });

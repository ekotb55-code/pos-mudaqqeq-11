/**
 * اختبار سجل أصناف شاشة البيع غير المباعة (الجهاز + السيرفر معًا)
 * التشغيل:  npx tsx scripts/verify_cart_journal.ts
 * يعمل على ناقل وهمي داخل الذاكرة. لو متغيرات Supabase مضبوطة يُعاد على قاعدة البيانات
 * الحقيقية داخل شركة اختبار معزولة تبدأ بـ test_ ثم تُمسح.
 */
import { CartJournal, CartJournalError } from '../server/cartJournal.ts';
import { CartJournalClient, type JournalStorage, type JournalEvent } from '../src/offline/cartJournal.ts';
import {
  createFakeTransport,
  createSupabaseTransport,
  readPersistenceEnv,
  type RpcTransport,
  type FakeTransportHandle
} from '../server/persistence/statePersistence.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

const canon = (v: any): any =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
    : v;

function memoryStorage(): JournalStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: key => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: key => {
      data.delete(key);
    }
  };
}

const PEN = { itemId: 'item-pen', name: 'قلم جاف أزرق', barcode: '6221234567890', unitPrice: 10 };
const BOOK = { itemId: 'item-book', name: 'كراس 60 ورقة', barcode: '6220000000017', unitPrice: 25 };
const BAG = { itemId: 'item-bag', name: 'شنطة مدرسية', barcode: '6220000000024', unitPrice: 300 };
const CASHIER = { userId: 'usr-cashier-002', userName: 'أحمد كاشير' };

async function runSuite(label: string, transport: RpcTransport | null, tenant: string, fake: FakeTransportHandle | null) {
  console.log(`\n=== ${label} ===`);
  let clock = Date.parse('2026-11-18T10:00:00.000Z');
  const now = () => new Date(clock);
  const tick = (ms: number) => {
    clock += ms;
  };
  let journal = new CartJournal({ transport, tenant, now, log: () => undefined });
  assert(await journal.start(), 'بدء سجل السيرفر');

  let online = true;
  let idCounter = 0;
  const makeClient = (storage: JournalStorage) =>
    new CartJournalClient({
      storage,
      now: () => clock,
      randomId: () => `id${(++idCounter).toString(36).padStart(8, '0')}${label.length.toString(36)}`,
      autoTimers: false,
      send: async payload => {
        if (!online) throw new Error('offline');
        return journal.applyEvents(payload.deviceId, payload.events, CASHIER);
      }
    });

  const storage = memoryStorage();
  let client = makeClient(storage);
  client.start();
  const sell = async (lines: { itemId: string; quantity: number }[], invoiceNumber: string) => {
    const cartId = client.currentCartId();
    client.cartSaved();
    await journal.markCartSold(cartId, invoiceNumber, lines, CASHIER);
    return cartId;
  };
  const rowsOf = () => journal.getReport().rows;

  // 1) بيعة عادية: لا شيء في التقرير
  client.syncCart([{ ...PEN, quantity: 1 }], { warehouseName: 'المخزن الرئيسي', platform: 'البيع المباشر' });
  client.syncCart([{ ...PEN, quantity: 1 }, { ...BOOK, quantity: 2 }]);
  assert(await client.flush(), 'رفع الأحداث');
  let rows = rowsOf();
  assert(rows.length === 2 && rows.every(r => r.cartStatus === 'open' && r.event === 'open'), 'الفاتورة المفتوحة تظهر بحالة «مفتوحة الآن»');
  assert(journal.getReport().summary.openCarts === 1, 'عدد الفواتير المفتوحة = 1');
  await sell([{ itemId: PEN.itemId, quantity: 1 }, { itemId: BOOK.itemId, quantity: 2 }], 'INV-1');
  assert(rowsOf().length === 0, 'بعد حفظ الفاتورة لا يبقى شيء في التقرير');

  // 2) حذف صنف ثم بيع الباقي
  client.syncCart([{ ...PEN, quantity: 1 }, { ...BAG, quantity: 1 }]);
  tick(5000);
  client.syncCart([{ ...PEN, quantity: 1 }]);
  await client.flush();
  rows = rowsOf();
  assert(rows.some(r => r.itemId === BAG.itemId && r.event === 'remove' && r.cartStatus === 'open'), 'الحذف يظهر فورًا والفاتورة ما زالت مفتوحة');
  await sell([{ itemId: PEN.itemId, quantity: 1 }], 'INV-2');
  rows = rowsOf();
  assert(rows.length === 1 && rows[0].itemId === BAG.itemId && rows[0].event === 'remove' && rows[0].cartStatus === 'sold', 'الصنف المحذوف يبقى في التقرير بعد بيع الفاتورة');
  assert(rows[0].quantity === 1 && rows[0].value === 300 && rows[0].invoiceNumber === 'INV-2', 'الكمية والقيمة ورقم الفاتورة صحيحة');
  assert(rows[0].itemName === BAG.name && rows[0].barcode === BAG.barcode && rows[0].userName === CASHIER.userName, 'اسم الصنف والباركود والمستخدم مسجلة');
  assert(rows[0].warehouseName === '' || typeof rows[0].warehouseName === 'string', 'حقل المخزن موجود');

  // 3) تقليل الكمية من 8 إلى 2 ثم بيع 2
  client.syncCart([{ ...BOOK, quantity: 8 }]);
  client.syncCart([{ ...BOOK, quantity: 5 }]);
  client.syncCart([{ ...BOOK, quantity: 2 }]);
  await client.flush();
  await sell([{ itemId: BOOK.itemId, quantity: 2 }], 'INV-3');
  rows = rowsOf().filter(r => r.invoiceNumber === 'INV-3');
  assert(rows.length === 1 && rows[0].event === 'reduce' && rows[0].quantity === 6, 'تقليل الكمية يسجل الفرق (6)');
  assert(rows[0].eventLabel === 'قلّت الكمية من 8 إلى 2' && rows[0].fromQty === 8 && rows[0].toQty === 2, 'النص: قلّت الكمية من 8 إلى 2');
  assert(rows[0].value === 150, 'قيمة الفرق = 6 × 25');

  // 4) حذف ثم إعادة إضافة ثم بيع: لا شيء
  client.syncCart([{ ...PEN, quantity: 1 }]);
  client.syncCart([]);
  client.syncCart([{ ...PEN, quantity: 1 }]);
  await client.flush();
  await sell([{ itemId: PEN.itemId, quantity: 1 }], 'INV-4');
  assert(rowsOf().filter(r => r.invoiceNumber === 'INV-4').length === 0, 'حذف ثم إعادة إضافة ثم بيع لا يظهر في التقرير');

  // 5) تفريغ الفاتورة كلها
  client.syncCart([{ ...PEN, quantity: 2 }, { ...BAG, quantity: 1 }]);
  client.syncCart([]);
  await client.flush();
  rows = rowsOf().filter(r => r.event === 'clear');
  assert(rows.length === 2 && rows.reduce((s, r) => s + r.value, 0) === 320, 'تفريغ الفاتورة يسجل كل أصنافها');
  const clearedCart = rows[0].cartId;

  // 6) إغلاق الصفحة والفاتورة فيها أصناف
  client.syncCart([{ ...BAG, quantity: 1 }]);
  client.handlePageHide();
  await client.flush();
  rows = rowsOf().filter(r => r.event === 'page_close');
  assert(rows.length === 1 && rows[0].cartStatus === 'abandoned' && rows[0].itemId === BAG.itemId, 'إغلاق الصفحة يسجل الصنف كمتروك');
  client = makeClient(storage);
  client.start();
  await client.flush();
  assert(rowsOf().filter(r => r.event === 'page_close').length === 1, 'إعادة فتح الصفحة لا تكرر الحدث');
  assert(client.currentCartId() !== clearedCart, 'الفاتورة بعد إعادة الفتح تبدأ برقم جديد');

  // 7) إغلاق مفاجئ: لا إشارة من الجهاز
  client.syncCart([{ ...PEN, quantity: 3 }]);
  await client.flush();
  const crashedCart = client.currentCartId();
  tick(3 * 60 * 1000);
  assert(rowsOf().some(r => r.cartId === crashedCart && r.cartStatus === 'open'), 'قبل 10 دقائق: ما زالت «مفتوحة الآن»');
  tick(8 * 60 * 1000);
  rows = rowsOf().filter(r => r.cartId === crashedCart);
  assert(rows.length === 1 && rows[0].cartStatus === 'abandoned' && rows[0].event === 'crash' && rows[0].quantity === 3, 'بعد 10 دقائق بدون نشاط: متروكة (إغلاق مفاجئ)');
  client = makeClient(storage); // الجهاز فتح التطبيق من جديد
  client.start();
  await client.flush();
  rows = rowsOf().filter(r => r.cartId === crashedCart);
  assert(rows.length === 1 && rows[0].event === 'crash', 'عند إعادة الفتح يؤكد الجهاز الإغلاق المفاجئ بدون تكرار');

  // 8) تسجيل خروج والفاتورة فيها صنف
  client.syncCart([{ ...BOOK, quantity: 1 }]);
  client.closeCart('logout');
  await client.flush();
  assert(rowsOf().some(r => r.event === 'logout' && r.itemId === BOOK.itemId), 'تسجيل الخروج يسجل الصنف');

  // 9) أوفلاين: الأحداث تبقى على الجهاز ثم تُرفع، والفاتورة تُزامَن قبل السجل
  online = false;
  client.syncCart([{ ...PEN, quantity: 2 }, { ...BAG, quantity: 1 }]);
  client.syncCart([{ ...PEN, quantity: 2 }]);
  let offlineFailed = false;
  try {
    await client.flush();
  } catch {
    offlineFailed = true;
  }
  assert(offlineFailed && client.pendingCount() === 3, 'بدون إنترنت: الأحداث محفوظة على الجهاز');
  const offlineCart = client.currentCartId();
  client.cartSaved(); // الفاتورة حُفظت في صندوق الأوفلاين
  tick(30 * 60 * 1000);
  online = true;
  await journal.markCartSold(offlineCart, 'INV-OFF-1', [{ itemId: PEN.itemId, quantity: 2 }], CASHIER); // مزامنة الفاتورة أولًا
  assert(await client.flush(), 'رفع السجل بعد رجوع الإنترنت');
  rows = rowsOf().filter(r => r.cartId === offlineCart);
  assert(rows.length === 1 && rows[0].itemId === BAG.itemId && rows[0].event === 'remove' && rows[0].receivedLate, 'بعد المزامنة: يظهر المحذوف فقط ومعلَّم أنه وصل متأخرًا');

  // 10) التكرار: إعادة إرسال نفس الأحداث لا تغير شيئًا
  const snapshotBefore = JSON.stringify(journal.getReport());
  const replay: JournalEvent[] = [{ seq: 1, at: new Date(clock).toISOString(), cartId: offlineCart, type: 'qty', itemId: PEN.itemId, qty: 50 }];
  const dup = await journal.applyEvents(client.getDeviceId(), replay, CASHIER);
  assert(dup.applied === 0 && dup.duplicates === 1 && JSON.stringify(journal.getReport()) === snapshotBefore, 'الأحداث المكررة تُتجاهل');

  // 11) جهاز جديد وسجل ناقص
  let alerts = journal.getReport().alerts;
  assert(alerts.filter(a => a.type === 'new_device').length === 1, 'تنبيه «جهاز جديد» مرة واحدة للجهاز');
  const last = (await journal.applyEvents(client.getDeviceId(), [], CASHIER)).lastSeq;
  await journal.applyEvents(
    client.getDeviceId(),
    [{ seq: last + 4, cartId: 'c-gapcart0001', type: 'qty', itemId: PEN.itemId, itemName: PEN.name, unitPrice: 10, qty: 1 }],
    CASHIER
  );
  alerts = journal.getReport().alerts;
  assert(alerts.some(a => a.type === 'sequence_gap' && a.detail.includes(String(last + 1)) && a.detail.includes(String(last + 3))), 'تنبيه «سجل ناقص» يذكر الأرقام المفقودة');
  const wiped = makeClient(memoryStorage()); // نفس الجهاز بعد مسح بيانات المتصفح
  wiped.start();
  wiped.syncCart([{ ...PEN, quantity: 1 }]);
  await wiped.flush();
  assert(journal.getReport().alerts.filter(a => a.type === 'new_device').length === 2, 'مسح بيانات الجهاز يظهر كتنبيه «جهاز جديد»');
  wiped.cartSaved();

  // 12) مدخلات غير صالحة
  let invalid = 0;
  for (const attempt of [
    () => journal.applyEvents('x', [], CASHIER),
    () => journal.applyEvents(client.getDeviceId(), 'no' as any, CASHIER),
    () => journal.applyEvents(client.getDeviceId(), new Array(501).fill({}), CASHIER),
    () => journal.applyEvents(client.getDeviceId(), [], { userId: '', userName: '' })
  ]) {
    try {
      await attempt();
    } catch (err) {
      if (err instanceof CartJournalError && err.code === 'INVALID_INPUT' && /[\u0600-\u06FF]/.test(err.message)) invalid++;
    }
  }
  assert(invalid === 4, 'المدخلات غير الصالحة تُرفض برسائل عربية');

  // 13) الفلاتر والملخص
  const all = journal.getReport();
  assert(all.summary.rows === all.rows.length && all.summary.byUser.length === 1 && all.summary.byUser[0].userId === CASHIER.userId, 'ملخص حسب المستخدم');
  assert(journal.getReport({ event: 'reduce' }).rows.every(r => r.event === 'reduce') && journal.getReport({ event: 'reduce' }).rows.length === 1, 'فلتر الحدث');
  assert(journal.getReport({ status: 'sold' }).rows.every(r => r.cartStatus === 'sold'), 'فلتر الحالة');
  assert(journal.getReport({ userId: 'nobody' }).rows.length === 0, 'فلتر المستخدم');
  assert(journal.getReport({ from: new Date(clock + 60000).toISOString() }).rows.length === 0, 'فلتر التاريخ');

  // 14) التصحيح الذاتي: فاتورة محفوظة لم يصل إشعار بيعها
  client.syncCart([{ ...BAG, quantity: 1 }]);
  await client.flush();
  const healCart = client.currentCartId();
  client.cartSaved();
  journal.setSoldResolver(cartId => (cartId === healCart ? { invoiceNumber: 'INV-HEAL', lines: [{ itemId: BAG.itemId, quantity: 1 }] } : null));
  assert(!journal.getReport().rows.some(r => r.cartId === healCart), 'فاتورة محفوظة لا تظهر كمتروكة حتى لو لم يصل إشعار البيع');
  journal.setSoldResolver(() => null);

  // 15) إعادة تشغيل السيرفر: السجل باقٍ
  if (transport) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const before = JSON.stringify(canon(journal.getReport()));
    journal.stop();
    journal = new CartJournal({ transport, tenant, now, log: () => undefined });
    assert(await journal.start(), 'إعادة تشغيل السجل');
    assert(JSON.stringify(canon(journal.getReport())) === before, 'التقرير مطابق بعد إعادة تشغيل السيرفر');

    // 16) فشل الحفظ: الجهاز يحتفظ بالأحداث ويعيد المحاولة بدون فقد ولا تكرار
    if (fake) {
      client.syncCart([{ ...PEN, quantity: 4 }]);
      fake.failNext('NETWORK', 'app_persist_changes');
      let failed = false;
      try {
        await client.flush();
      } catch {
        failed = true;
      }
      assert(failed && client.pendingCount() === 1, 'فشل حفظ السيرفر: الحدث باقٍ على الجهاز');
      assert(!journal.getReport().rows.some(r => r.cartId === client.currentCartId()), 'السيرفر تراجع عن الحدث غير المحفوظ');
      assert(await client.flush(), 'إعادة المحاولة تنجح');
      const retried = journal.getReport().rows.filter(r => r.cartId === client.currentCartId());
      assert(retried.length === 1 && retried[0].quantity === 4, 'الحدث وصل مرة واحدة بعد إعادة المحاولة');
      client.cartSaved();
    }
  }

  // 17) عدة طلبات متزامنة تُحفظ معًا
  const burst = await Promise.all(
    [1, 2, 3, 4, 5].map(n =>
      journal.applyEvents(`dev-burst-device-${n}`, [{ seq: 1, cartId: `c-burstcart-${n}`, type: 'qty', itemId: PEN.itemId, itemName: PEN.name, unitPrice: 10, qty: n }], CASHIER)
    )
  );
  assert(burst.every(r => r.applied === 1) && journal.getReport().rows.filter(r => r.cartId.startsWith('c-burstcart-')).length === 5, 'خمسة أجهزة في نفس اللحظة: الكل مسجل');

  journal.stop();
  console.log(`✅ ${label}: نجح`);
}

async function main() {
  await runSuite('بدون قاعدة بيانات (ذاكرة فقط)', null, 'test_cj_mem', null);

  const fake = createFakeTransport();
  await runSuite('الناقل الوهمي', fake.transport, 'test_cj_fake', fake);

  const env = readPersistenceEnv();
  if (env.enabled && !env.problem) {
    const real = createSupabaseTransport({ url: env.url, secretKey: env.secretKey, restUrl: env.restUrl || undefined });
    const tenant = `test_cj_${Date.now().toString(36)}`;
    try {
      await runSuite('قاعدة البيانات الحقيقية (شركة اختبار معزولة)', real, tenant, null);
    } finally {
      await real('app_reset_test_tenant', { p_tenant: `${tenant}_journal` }).catch(() => undefined);
    }
  } else {
    console.log('\nℹ️ لم تُضبط متغيرات Supabase — تم تخطي اختبار قاعدة البيانات الحقيقية.');
  }
  console.log(`\n🎉 كل اختبارات سجل شاشة البيع نجحت (${passed} تحققًا).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌', err?.message || err);
    process.exit(1);
  });

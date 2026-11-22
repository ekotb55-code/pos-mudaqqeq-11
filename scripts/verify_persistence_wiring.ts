/**
 * اختبار ربط طبقة الحفظ الدائم بالسيرفر (بدون إنترنت — ناقل وهمي داخل الذاكرة)
 * التشغيل:  npx tsx scripts/verify_persistence_wiring.ts
 *
 * يتحقق من:
 *   1) كل متغيرات حالة الذاكرة في server/sheetsService.ts مسجلة في سجل الحفظ.
 *   2) البداية من قاعدة فارغة = حالة نظيفة بدون أي بيانات تجريبية.
 *   3) كل عملية كتابة عبر الـ API تُحفظ قبل الرد.
 *   4) «إعادة تشغيل السيرفر» ترجع نفس البيانات تمامًا.
 *   5) فشل الحفظ = رد بخطأ عربي + تراجع كامل عن العملية + رجوع تلقائي للعمل.
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeTransport } from '../server/persistence/statePersistence.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT = 'test_wiring';
const NEW_PASSWORD = 'Wiring#Test2026';

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

function checkRegistryCoversAllMemoryState() {
  const source = fs.readFileSync(path.resolve(__dirname, '../server/sheetsService.ts'), 'utf8');
  const start = source.indexOf('export function getPersistenceCollections');
  assert(start > 0, 'الدالة getPersistenceCollections موجودة في sheetsService.ts');
  const end = source.indexOf('\nexport function applyCleanInitialState', start);
  const registry = source.slice(start, end > start ? end : undefined);

  const declared = new Set<string>();
  for (const match of source.matchAll(/^(?:let|const)\s+(memory[A-Za-z0-9_]+)\b/gm)) declared.add(match[1]);
  // حالة أخرى خارج تسمية memory يجب أن تبقى بعد إعادة التشغيل
  for (const name of ['warehouseDispatchSeq', 'warehouseMigrationCompleted', 'warehouseMigrationReport', 'idempotencyCache']) {
    if (new RegExp(`^(?:let|const)\\s+${name}\\b`, 'm').test(source)) declared.add(name);
  }
  assert(declared.size >= 30, `عدد متغيرات الحالة المكتشفة منطقي (${declared.size})`);
  const missing = Array.from(declared).filter(name => !new RegExp(`\\b${name}\\b`).test(registry));
  assert(missing.length === 0, `متغيرات حالة غير مسجلة في سجل الحفظ: ${missing.join(', ')}`);
  console.log(`✅ سجل الحفظ يغطي كل متغيرات الحالة (${declared.size} متغيرًا)`);
}

async function main() {
  checkRegistryCoversAllMemoryState();

  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { applyCleanInitialState } = await import('../server/sheetsService.ts');
  const { app, persistence } = await createServerApp({
    attachVite: false,
    persistenceTransport: fake.transport,
    persistenceTenant: TENANT
  });
  assert(persistence && persistence.isReady(), 'طبقة الحفظ مفعّلة وجاهزة');
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
  const dbCount = (collection: string) => fake.dump(TENANT).rows.filter(r => r.collection === collection).length;

  try {
    // --- 2) بداية نظيفة ---
    assert(dbCount('users') === 3, 'الحسابات الثلاثة الافتراضية محفوظة في قاعدة البيانات');
    assert(dbCount('warehouses') === 1 && dbCount('cashboxes') === 1, 'مخزن رئيسي واحد وخزينة رئيسية واحدة');
    for (const demo of ['items', 'invoices', 'platforms', 'customers', 'suppliers', 'purchases', 'stockMovements', 'returns']) {
      assert(dbCount(demo) === 0, `لا توجد بيانات تجريبية في "${demo}"`);
    }

    const health = await call('GET', '/api/health');
    assert(health.data?.persistence?.enabled === true && health.data?.persistence?.ready === true, '/api/health يعرض حالة قاعدة البيانات');

    // --- 3) عمليات حقيقية عبر الـ API ---
    const login = await call('POST', '/api/auth/login', { username: 'admin', password: process.env.INITIAL_USER_PASSWORD || '1234' });
    assert(login.status === 200 && login.data?.token, 'دخول المدير بكلمة السر المؤقتة');
    const token = login.data.token as string;

    const setup = await call('POST', '/api/auth/complete-initial-setup', { name: 'صاحب المحل', username: 'admin', newPassword: NEW_PASSWORD }, token);
    assert(setup.status === 200 && setup.data?.success, `استكمال إعداد الحساب: ${setup.data?.error || ''}`);

    const config = await call('GET', '/api/config', undefined, token);
    assert(config.data?.persistenceMode === 'supabase', '/api/config يعرض persistenceMode = supabase');
    assert(config.data?.dataMode === 'memory', 'منطق التشغيل هو منطق الذاكرة');

    const generationBefore = engine.getStatus().generation;
    const platform = await call('POST', '/api/platforms', { name: 'البيع المباشر', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, token);
    assert(platform.status === 200 && platform.data?.platform?.id, `إضافة منصة: ${platform.data?.error || ''}`);
    assert(engine.getStatus().generation === generationBefore + 1, 'كل عملية كتابة = حفظ واحد ذرّي قبل الرد');
    assert(dbCount('platforms') === 1, 'المنصة موجودة في قاعدة البيانات فور الرد');

    const category = await call('POST', '/api/categories', { name: 'أدوات مكتبية' }, token);
    assert(category.status === 200 && category.data?.category?.id, `إضافة تصنيف: ${category.data?.error || ''}`);

    const item = await call(
      'POST',
      '/api/items',
      { name: 'قلم جاف أزرق', barcode: '6221234567890', purchasePrice: 5, salePrice: 10, stockQuantity: 100, categoryId: category.data.category.id, unit: 'قطعة' },
      token
    );
    assert(item.status === 200 && item.data?.item?.id, `إضافة صنف: ${item.data?.error || ''}`);
    const itemId = item.data.item.id as string;

    const invoice = await call(
      'POST',
      '/api/invoices',
      { idempotencyKey: `wiring-${Date.now()}`, platform: 'البيع المباشر', paymentType: 'نقدي', lines: [{ itemId, quantity: 3 }] },
      token
    );
    assert(invoice.status === 200 && invoice.data?.invoice?.invoiceNumber, `إنشاء فاتورة: ${invoice.data?.error || ''}`);
    assert(dbCount('invoices') === 1 && dbCount('stockMovements') >= 1, 'الفاتورة وحركة المخزون محفوظتان');

    // طلبات القراءة لا تكتب في قاعدة البيانات
    const generationAfterWrites = engine.getStatus().generation;
    const readPaths = ['/api/items', '/api/platforms', '/api/invoices', '/api/categories', '/api/cashboxes', '/api/warehouses'];
    const snapshotBefore: Record<string, unknown> = {};
    for (const p of readPaths) {
      const res = await call('GET', p, undefined, token);
      assert(res.status === 200, `قراءة ${p}`);
      snapshotBefore[p] = canon(res.data);
    }
    // بعض طلبات القراءة تحسب حقولًا مشتقة داخل الذاكرة (مثل رصيد المنصة)؛ هذه تُحفظ مع أول كتابة
    // أو مع الحفظ الدوري. نحفظها هنا يدويًا قبل المقارنة.
    await engine.lock.run(() => engine.persist());
    const stateBefore = canon(engine.exportState());
    const stockBefore = (snapshotBefore['/api/items'] as any).items.find((i: any) => i.id === itemId)?.stockQuantity;
    assert(stockBefore === 97, `رصيد الصنف بعد البيع = 97 (جاء ${stockBefore})`);

    // --- 4) محاكاة إعادة تشغيل السيرفر: امسح الذاكرة ثم حمّل من قاعدة البيانات ---
    await engine.lock.run(async () => {
      applyCleanInitialState();
      assert(await engine.recover(), 'تحميل الحالة من قاعدة البيانات بعد إعادة التشغيل');
    });
    assert(JSON.stringify(canon(engine.exportState())) === JSON.stringify(stateBefore), 'الحالة الكاملة بعد إعادة التشغيل مطابقة تمامًا');
    assert(!engine.hasPendingChanges(), 'لا تغييرات معلقة بعد إعادة التشغيل');
    for (const p of readPaths) {
      const res = await call('GET', p, undefined, token);
      assert(res.status === 200 && JSON.stringify(canon(res.data)) === JSON.stringify(snapshotBefore[p]), `نفس نتيجة ${p} بعد إعادة التشغيل`);
    }
    const relogin = await call('POST', '/api/auth/login', { username: 'admin', password: NEW_PASSWORD });
    assert(relogin.status === 200 && relogin.data?.user?.mustChangePassword !== true, 'كلمة السر الجديدة باقية بعد إعادة التشغيل');
    assert(engine.getStatus().generation >= generationAfterWrites, 'رقم الإصدار لا يرجع للخلف');

    // --- 5) فشل الحفظ: خطأ عربي + تراجع كامل ---
    const platformsBefore = dbCount('platforms');
    fake.failNext('NETWORK', 'app_persist_changes');
    const failedWrite = await call('POST', '/api/platforms', { name: 'منصة لن تُحفظ', discountPercentage: 1, pickupFee: 0, status: 'نشطة' }, relogin.data.token);
    assert(failedWrite.status === 503 && failedWrite.data?.code === 'SAVE_FAILED', 'فشل الحفظ يرجع 503 وكود SAVE_FAILED');
    assert(/[\u0600-\u06FF]/.test(String(failedWrite.data?.error || '')), 'رسالة الفشل عربية');
    assert(dbCount('platforms') === platformsBefore, 'لم يُحفظ شيء من العملية الفاشلة');
    const listAfterFail = await call('GET', '/api/platforms', undefined, relogin.data.token);
    assert(
      listAfterFail.status === 200 && !listAfterFail.data.platforms.some((p: any) => p.name === 'منصة لن تُحفظ'),
      'العملية الفاشلة غير ظاهرة في النظام (تراجع كامل)'
    );
    const retry = await call('POST', '/api/platforms', { name: 'منصة بعد الرجوع', discountPercentage: 1, pickupFee: 0, status: 'نشطة' }, relogin.data.token);
    assert(retry.status === 200 && dbCount('platforms') === platformsBefore + 1, 'بعد الفشل يرجع النظام للعمل وتنجح العملية التالية');

    console.log(`\n🎉 كل اختبارات ربط طبقة الحفظ نجحت (${passed} تحققًا).`);
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

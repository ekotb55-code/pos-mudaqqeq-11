/**
 * اختبار ربط «تخزين الصور» و«شاشة الزوار» بالسيرفر عبر الـ API
 * (بدون إنترنت — قاعدة بيانات وهمية وتخزين صور وهمي يحاكي Supabase Storage)
 * التشغيل:  npx tsx scripts/verify_visitor_display_wiring.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import { createFakeTransport } from '../server/persistence/statePersistence.ts';
import { ImageStorage } from '../server/imageStorage.ts';
import { readBackup } from '../server/backup.ts';
import { createFakeImageStorage, TEST_PNG, TEST_JPEG, TEST_GIF } from './helpers/fakeImageStorage.ts';

const TENANT = 'test_visitor';
const ADMIN_PASSWORD = 'Visitor#Admin2026';
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '1234';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

async function main() {
  const fake = createFakeTransport();
  const images = createFakeImageStorage();
  const storage = new ImageStorage({ url: images.baseUrl, secretKey: 'sb_secret_test', tenant: TENANT, fetchImpl: images.fetchImpl });
  const { createServerApp } = await import('../server.ts');
  const { app, persistence } = await createServerApp({ attachVite: false, persistenceTransport: fake.transport, persistenceTenant: TENANT, imageStorage: storage });
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
  const docOf = (row: any) => (row?.data as any)?.v ?? row?.data;
  const arabic = /[\u0600-\u06FF]/;
  const publicPrefix = `${images.baseUrl}/storage/v1/object/public/`;

  try {
    const login = async (username: string, password: string) => (await call('POST', '/api/auth/login', { username, password })).data?.token as string;
    let owner = await login('admin', INITIAL_PASSWORD);
    assert((await call('POST', '/api/auth/complete-initial-setup', { name: 'صاحب المحل', username: 'admin', newPassword: ADMIN_PASSWORD }, owner)).status === 200, 'إعداد المالك');

    // ---- رفع الصور: على التخزين، والبيانات فيها الرابط فقط ----
    const upload = await call('POST', '/api/upload-image', { imageBase64: `data:image/png;base64,${TEST_PNG}`, fileName: 'pen.png', mimeType: 'image/png', folder: 'items' }, owner);
    assert(upload.status === 200 && upload.data.url.startsWith(publicPrefix) && upload.data.url.includes(`/${TENANT}/items/`), `رفع صورة صنف على التخزين: ${upload.data?.error || ''}`);
    assert(images.objects.size === 1, 'الصورة موجودة في التخزين');
    assert((await call('POST', '/api/upload-image', { imageBase64: Buffer.from('not an image').toString('base64') }, owner)).status === 400, 'ملف ليس صورة يُرفض');
    const big = await call('POST', '/api/upload-image', { imageBase64: Buffer.alloc(2 * 1024 * 1024 + 50, 0xff).toString('base64') }, owner);
    assert(big.status === 413 && arabic.test(big.data.error), 'صورة أكبر من 2 ميجا تُرفض برسالة عربية');
    images.failNext(500);
    const down = await call('POST', '/api/upload-image', { imageBase64: TEST_JPEG }, owner);
    assert(down.status === 503 && arabic.test(down.data.error), 'التخزين غير متاح: رسالة عربية');
    assert((await call('POST', '/api/upload-image', { imageBase64: TEST_PNG })).status === 401, 'الرفع بدون دخول مرفوض');

    // ---- صنف بصورة على التخزين ----
    await call('POST', '/api/platforms', { name: 'البيع المباشر', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, owner);
    const category = await call('POST', '/api/categories', { name: 'أدوات مكتبية' }, owner);
    const item = await call('POST', '/api/items', { name: 'قلم 12 ق', printName: 'قلم جاف أزرق', barcode: '6221000000011', purchasePrice: 6, salePrice: 10, stockQuantity: 50, categoryId: category.data.category.id, unit: 'قطعة', imageUrl: upload.data.url }, owner);
    assert(item.status === 200 && item.data?.item?.id, `إضافة صنف: ${item.data?.error || ''}`);
    const noImage = await call('POST', '/api/items', { name: 'كراسة', barcode: '6221000000028', purchasePrice: 15, salePrice: 25.5, stockQuantity: 10, categoryId: category.data.category.id, unit: 'علبة' }, owner);
    assert(noImage.status === 200, 'صنف بدون صورة');
    const savedItem = db('items').map(docOf).find((d: any) => d.barcode === '6221000000011');
    assert(savedItem && savedItem.imageUrl === upload.data.url && !JSON.stringify(fake.dump(TENANT)).includes(TEST_PNG), 'قاعدة البيانات فيها رابط الصورة وليس الصورة نفسها');

    // ---- نقل الصور القديمة المحفوظة كنص ----
    const oldStyle = await call('POST', '/api/items', { name: 'مسطرة', barcode: '6221000000035', purchasePrice: 2, salePrice: 4, stockQuantity: 5, categoryId: category.data.category.id, unit: 'قطعة', imageUrl: `data:image/gif;base64,${TEST_GIF}` }, owner);
    assert(oldStyle.status === 200, 'صنف بصورة قديمة محفوظة كنص');
    let status = await call('GET', '/api/system/images/status', undefined, owner);
    assert(status.status === 200 && status.data.storageEnabled === true && status.data.inline.total === 1 && status.data.inline.byCollection.items === 1, 'عدد الصور المحفوظة كنص');
    const migrated = await call('POST', '/api/system/images/migrate', {}, owner);
    assert(migrated.status === 200 && migrated.data.moved === 1 && migrated.data.remaining === 0, `نقل الصور للتخزين: ${migrated.data?.error || ''}`);
    const movedItem = db('items').map(docOf).find((d: any) => d.barcode === '6221000000035');
    assert(movedItem.imageUrl.startsWith(publicPrefix) && movedItem.imageUrl.endsWith('.gif'), 'رابط الصورة بعد النقل محفوظ في قاعدة البيانات');
    status = await call('GET', '/api/system/images/status', undefined, owner);
    assert(status.data.inline.total === 0, 'لا صور محفوظة كنص بعد النقل');

    // ---- حساب شاشة الزوار: صلاحية واحدة فقط ----
    const created = await call('POST', '/api/users', { username: 'screen1', name: 'شاشة الفرع', phone: '01055550001', role: 'employee', password: 'Screen#2026x', status: 'active', permissions: ['visitor.display'] }, owner);
    assert(created.status === 200, `إنشاء حساب الشاشة: ${created.data?.error || ''}`);
    let screen = await login('screen1', 'Screen#2026x');
    const me = await call('GET', '/api/auth/me', undefined, screen);
    if (me.data?.user?.mustChangePassword) {
      assert((await call('POST', '/api/auth/complete-initial-setup', { name: 'شاشة الفرع', username: 'screen1', newPassword: 'Screen#2026y' }, screen)).status === 200, 'إعداد حساب الشاشة');
      screen = await login('screen1', 'Screen#2026y');
    }
    assert(Boolean(screen), 'دخول حساب الشاشة');

    // ---- الشاشة ----
    assert((await call('GET', '/api/visitor/config')).status === 401, 'الشاشة بدون دخول مرفوضة');
    let config = await call('GET', '/api/visitor/config', undefined, screen);
    assert(config.status === 200 && config.data.settings.slideSeconds === 8 && config.data.settings.showWelcome === true && 'company' in config.data, 'إعدادات الشاشة لحساب الشاشة');
    let found = await call('GET', '/api/visitor/lookup?barcode=6221000000011', undefined, screen);
    assert(found.status === 200 && found.data.found === true && found.data.product.name === 'قلم جاف أزرق' && found.data.product.price === 10 && found.data.product.imageUrl === upload.data.url && found.data.product.unit === 'قطعة', 'ضرب الباركود: اسم الطباعة والسعر والصورة');
    assert(JSON.stringify(Object.keys(found.data.product).sort()) === JSON.stringify(['imageUrl', 'name', 'price', 'unit']), 'الشاشة لا تستقبل سعر الشراء ولا الرصيد');
    found = await call('GET', '/api/visitor/lookup?barcode=6221000000028', undefined, screen);
    assert(found.data.product.name === 'كراسة' && found.data.product.imageUrl === '', 'صنف بدون صورة: بدون صورة');
    found = await call('GET', '/api/visitor/lookup?barcode=999999', undefined, screen);
    assert(found.status === 200 && found.data.found === false && found.data.product === null, 'باركود غير موجود');
    const catalog = await call('GET', '/api/visitor/catalog', undefined, screen);
    assert(catalog.status === 200 && catalog.data.catalog['6221000000011'].price === 10 && !JSON.stringify(catalog.data).includes('purchasePrice'), 'نسخة الأسعار للعمل بدون اتصال');

    // حساب الشاشة لا يفتح أي شيء آخر
    for (const path of ['/api/items', '/api/invoices', '/api/cashboxes', '/api/customers', '/api/reports/sales', '/api/bank-link/manual/overview']) {
      const r = await call('GET', path, undefined, screen);
      assert(r.status === 403 || r.status === 404, `حساب الشاشة لا يفتح ${path} (${r.status})`);
    }
    assert((await call('POST', '/api/visitor/settings', { slideSeconds: 5 }, screen)).status === 403, 'حساب الشاشة لا يغيّر الإعدادات');
    assert((await call('POST', '/api/invoices', { idempotencyKey: 'x1', platform: 'البيع المباشر', paymentType: 'نقدي', lines: [] }, screen)).status === 403, 'حساب الشاشة لا يبيع');

    // ---- إعدادات الشاشة (المالك) ----
    const bad = await call('POST', '/api/visitor/settings', { slideSeconds: 1 }, owner);
    assert(bad.status === 400 && arabic.test(bad.data.error), 'مدة غير صالحة تُرفض برسالة عربية');
    let saved = await call('POST', '/api/visitor/settings', { slideSeconds: 6, resultSeconds: 12, showWelcome: false, welcomeText: 'أهلًا بيك', showLogo: false }, owner);
    assert(saved.status === 200 && saved.data.settings.slideSeconds === 6 && saved.data.settings.showWelcome === false && saved.data.settings.showLogo === false, 'حفظ المدد وإلغاء الترحيب والشعار');
    const slideA = await call('POST', '/api/visitor/slides', { imageBase64: TEST_PNG }, owner);
    const slideB = await call('POST', '/api/visitor/slides', { imageBase64: TEST_JPEG }, owner);
    assert(slideA.status === 200 && slideB.status === 200 && slideA.data.slide.url.includes(`/${TENANT}/visitor/`), `رفع صور العرض على التخزين: ${slideA.data?.error || ''}`);
    assert((await call('POST', '/api/visitor/slides', { imageBase64: 'abc' }, owner)).status === 400, 'صورة عرض تالفة تُرفض');
    const order = await call('POST', '/api/visitor/slides/order', { ids: [slideB.data.slide.id, slideA.data.slide.id] }, owner);
    assert(order.status === 200 && order.data.settings.slides[0].id === slideB.data.slide.id, 'ترتيب صور العرض');
    config = await call('GET', '/api/visitor/config', undefined, screen);
    assert(config.data.settings.slides.length === 2 && config.data.settings.slides[0].url === slideB.data.slide.url && !('path' in config.data.settings.slides[0]) && config.data.settings.resultSeconds === 12, 'الشاشة ترى الصور بالترتيب الجديد (بدون مسارات التخزين)');
    const storedVisitor = docOf(db('settings.visitorDisplay')[0]);
    assert(storedVisitor.slides.length === 2 && storedVisitor.slides.every((s: any) => s.url.startsWith(publicPrefix)), 'إعدادات الشاشة محفوظة في قاعدة البيانات بروابط التخزين');

    const objectsBefore = images.objects.size;
    const del = await call('DELETE', `/api/visitor/slides/${slideB.data.slide.id}`, undefined, owner);
    assert(del.status === 200 && del.data.settings.slides.length === 1, 'حذف صورة عرض');
    await new Promise(r => setTimeout(r, 50));
    assert(images.objects.size === objectsBefore - 1, 'ملف الصورة المحذوفة اتحذف من التخزين');
    assert(images.objects.size >= 2, 'صورة الصنف وصورة العرض الباقية لم تُحذفا');

    // ---- إعادة التشغيل والنسخة الاحتياطية ----
    const beforeRestart = JSON.stringify((await call('GET', '/api/visitor/config', undefined, owner)).data.settings);
    await engine.lock.run(async () => {
      assert(await engine.recover(), 'تحميل الحالة بعد إعادة التشغيل');
    });
    assert(JSON.stringify((await call('GET', '/api/visitor/config', undefined, owner)).data.settings) === beforeRestart, 'إعدادات الشاشة مطابقة بعد إعادة التشغيل');
    const exported = await call('GET', '/api/backup/export', undefined, owner);
    const parsed = readBackup(exported.buffer);
    assert((parsed.data['settings.visitorDisplay'] as any)?.slides?.length === 1, 'ملف النسخة الاحتياطية فيه إعدادات شاشة الزوار');

    // ---- إعادة ضبط المصنع: الإعدادات ترجع للافتراضي وصور العرض تتحذف ----
    const objectsBeforeReset = images.objects.size;
    owner = await login('admin', ADMIN_PASSWORD);
    const resetStatus = await call('GET', '/api/system/reset-status', undefined, owner);
    const factory = await call('POST', '/api/system/factory-reset', { password: ADMIN_PASSWORD, confirmText: resetStatus.data.phrases.factory }, owner);
    assert(factory.status === 200, `إعادة ضبط المصنع: ${factory.data?.error || ''}`);
    await new Promise(r => setTimeout(r, 50));
    const afterReset = docOf(db('settings.visitorDisplay')[0]);
    assert(afterReset.slides.length === 0 && afterReset.slideSeconds === 8 && afterReset.showWelcome === true, 'بعد إعادة ضبط المصنع: إعدادات الشاشة الافتراضية');
    assert(images.objects.size === objectsBeforeReset - 1, 'صور العرض اتحذفت من التخزين مع إعادة ضبط المصنع');

    console.log(`\n🎉 كل اختبارات ربط تخزين الصور وشاشة الزوار نجحت (${passed} تحققًا).`);
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

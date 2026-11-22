/**
 * اختبار ربط «طباعة التكت» بالسيرفر عبر الـ API (بدون إنترنت — قاعدة بيانات وهمية)
 * التشغيل:  npx tsx scripts/verify_label_print_wiring.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import { createFakeTransport } from '../server/persistence/statePersistence.ts';
import { readBackup } from '../server/backup.ts';
import { parseLabelSheet, buildLabelPrintHtml } from '../src/utils/labelPrint.ts';

const TENANT = 'test_labels';
const ADMIN_PASSWORD = 'Labels#Admin2026';
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '1234';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

async function main() {
  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { app, persistence } = await createServerApp({ attachVite: false, persistenceTransport: fake.transport, persistenceTenant: TENANT, imageStorage: null });
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

  try {
    const login = async (username: string, password: string) => (await call('POST', '/api/auth/login', { username, password })).data?.token as string;
    let owner = await login('admin', INITIAL_PASSWORD);
    assert((await call('POST', '/api/auth/complete-initial-setup', { name: 'صاحب المحل', username: 'admin', newPassword: ADMIN_PASSWORD }, owner)).status === 200, 'إعداد المالك');

    // ---- أصناف للتجربة ----
    await call('POST', '/api/platforms', { name: 'البيع المباشر', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, owner);
    const category = await call('POST', '/api/categories', { name: 'أدوات مكتبية' }, owner);
    const pen = await call('POST', '/api/items', { name: 'قلم 12 ق', printName: 'قلم جاف أزرق', barcode: '4006381333931', purchasePrice: 6, salePrice: 10, stockQuantity: 50, categoryId: category.data.category.id, unit: 'قطعة' }, owner);
    const book = await call('POST', '/api/items', { name: 'كراسة', barcode: '6221000000028', purchasePrice: 15, salePrice: 25.5, stockQuantity: 10, categoryId: category.data.category.id, unit: 'علبة' }, owner);
    assert(pen.status === 200 && book.status === 200, 'إضافة صنفين');
    const penId = pen.data.item.id as string;

    // ---- مستخدم بصلاحية طباعة التكت فقط ----
    const created = await call('POST', '/api/users', { username: 'printer1', name: 'موظف المخزن', phone: '01055550002', role: 'employee', password: 'Printer#2026x', status: 'active', permissions: ['items.print_labels'] }, owner);
    assert(created.status === 200, `مستخدم طباعة التكت: ${created.data?.error || ''}`);
    let clerk = await login('printer1', 'Printer#2026x');
    if ((await call('GET', '/api/auth/me', undefined, clerk)).data?.user?.mustChangePassword) {
      await call('POST', '/api/auth/complete-initial-setup', { name: 'موظف المخزن', username: 'printer1', newPassword: 'Printer#2026y' }, clerk);
      clerk = await login('printer1', 'Printer#2026y');
    }

    // ---- الإعدادات ----
    assert((await call('GET', '/api/labels/settings')).status === 401, 'بدون دخول مرفوض');
    let got = await call('GET', '/api/labels/settings', undefined, clerk);
    assert(got.status === 200 && got.data.settings.labelWidthMm === 40 && got.data.settings.labelHeightMm === 25 && got.data.settings.paper === 'roll', 'صاحب «طباعة التكت» يقرأ الإعدادات (الافتراضي رول 40×25)');
    assert((await call('POST', '/api/labels/settings', { columns: 2 }, clerk)).status === 403, 'بدون «إعدادات طابعة الباركود» لا يعدّل');
    const bad = await call('POST', '/api/labels/settings', { labelWidthMm: 30, barcodeWidthMm: 35 }, owner);
    assert(bad.status === 400 && arabic.test(bad.data.error), 'إعدادات غلط تُرفض برسالة عربية');
    const saved = await call('POST', '/api/labels/settings', { columns: 2, gapXMm: 2, shopNameText: 'فرع منفلوط', elements: [{ key: 'price', show: true, align: 'center', fontSizePt: 9, bold: true }] }, owner);
    assert(saved.status === 200 && saved.data.settings.columns === 2 && saved.data.settings.shopNameText === 'فرع منفلوط' && saved.data.settings.elements[0].key === 'price' && saved.data.settings.elements.length === 8, 'حفظ: اثنين في الصف واسم الفرع وترتيب العناصر');
    assert(saved.data.settings.labelWidthMm === 40 && saved.data.settings.updatedBy === 'صاحب المحل', 'الحفظ الجزئي يحتفظ بالباقي');
    assert(docOf(db('settings.labelPrint')[0])?.columns === 2, 'الإعدادات محفوظة في قاعدة البيانات');
    assert(db('auditLogs').some(r => String(docOf(r).action) === 'LABEL_SETTINGS_UPDATED'), 'مسجل في سجل التدقيق');
    got = await call('GET', '/api/labels/settings', undefined, clerk);
    assert(got.data.settings.columns === 2, 'الموظف يقرأ الإعدادات الجديدة');

    // ---- ملف إكسيل بباركود غير مسجل ثم إضافته كباركود فرعي ----
    const items = (await call('GET', '/api/items', undefined, owner)).data.items as any[];
    const sheet = parseLabelSheet([['الصنف', 'عدد التكت', 'الباركود'], ['قلم 12 ق', 2, 'PEN-NEW'], ['6221000000028', 3]], items);
    assert(sheet.lines.length === 2 && sheet.warnings.length === 1 && sheet.lines[0].unregisteredBarcode, 'باركود غير مسجل: تحذير');
    assert((await call('POST', `/api/items/${penId}/barcodes`, { barcode: 'PEN-NEW' }, clerk)).status === 403, 'إضافة باركود تحتاج صلاحية تعديل الأصناف');
    assert((await call('POST', `/api/items/${penId}/barcodes`, { barcode: 'قلم' }, owner)).status === 400, 'باركود بحروف عربية يُرفض');
    assert((await call('POST', `/api/items/${penId}/barcodes`, { barcode: '6221000000028' }, owner)).status === 400, 'باركود صنف آخر يُرفض');
    assert((await call('POST', '/api/items/nope/barcodes', { barcode: 'X1' }, owner)).status === 404, 'صنف غير موجود');
    const addBc = await call('POST', `/api/items/${penId}/barcodes`, { barcode: 'PEN-NEW' }, owner);
    assert(addBc.status === 200, `إضافة باركود فرعي: ${addBc.data?.error || ''}`);
    const penAfter = docOf(db('items').find(r => docOf(r).id === penId));
    assert((penAfter.secondaryBarcodes || []).includes('PEN-NEW') && penAfter.salePrice === 10 && penAfter.barcode === '4006381333931', 'الباركود الفرعي اتضاف وباقي الصنف كما هو');
    assert(db('itemBarcodes').some(r => docOf(r).itemId === penId && docOf(r).barcode === 'PEN-NEW'), 'سجل الباركود محفوظ (ليجده البيع)');
    const again = await call('POST', `/api/items/${penId}/barcodes`, { barcode: 'pen-new' }, owner);
    assert(again.status === 200 && again.data.alreadyRegistered === true, 'إضافته مرة ثانية لا تكرره');
    const items2 = (await call('GET', '/api/items', undefined, owner)).data.items as any[];
    assert(parseLabelSheet([['قلم 12 ق', 2, 'PEN-NEW']], items2).warnings.length === 0, 'بعد الإضافة: لا تحذير');

    // ---- صفحة الطباعة بالإعدادات المحفوظة ----
    const job = buildLabelPrintHtml(sheet.lines, got.data.settings, { items: items2, companyName: 'مدقق', logoUrl: '', taxInclusive: true });
    assert(job.totalLabels === 5 && job.pages === 3 && job.html.includes('فرع منفلوط') && job.html.includes('10.00 ج.م') && job.html.includes('25.50 ج.م'), 'صفحة الطباعة: 5 تكت، اثنين في الصف = 3 صفوف');

    // ---- إعادة التشغيل، النسخة الاحتياطية، وإعادة ضبط المصنع ----
    const before = JSON.stringify((await call('GET', '/api/labels/settings', undefined, owner)).data.settings);
    await engine.lock.run(async () => {
      assert(await engine.recover(), 'تحميل الحالة بعد إعادة التشغيل');
    });
    assert(JSON.stringify((await call('GET', '/api/labels/settings', undefined, owner)).data.settings) === before, 'الإعدادات مطابقة بعد إعادة التشغيل');
    const exported = await call('GET', '/api/backup/export', undefined, owner);
    assert((readBackup(exported.buffer).data['settings.labelPrint'] as any)?.columns === 2, 'ملف النسخة الاحتياطية فيه إعدادات التكت');
    owner = await login('admin', ADMIN_PASSWORD);
    const status = await call('GET', '/api/system/reset-status', undefined, owner);
    const factory = await call('POST', '/api/system/factory-reset', { password: ADMIN_PASSWORD, confirmText: status.data.phrases.factory }, owner);
    assert(factory.status === 200, `إعادة ضبط المصنع: ${factory.data?.error || ''}`);
    const afterReset = docOf(db('settings.labelPrint')[0]);
    assert(afterReset.columns === 1 && afterReset.shopNameText === '' && afterReset.elements[0].key === 'shopName', 'بعد إعادة ضبط المصنع: الإعدادات الافتراضية');

    console.log(`\n🎉 كل اختبارات ربط طباعة التكت نجحت (${passed} تحققًا).`);
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

/**
 * اختبار استيراد وتصدير الأصناف بالصور مع السيرفر (قاعدة بيانات وتخزين صور وهميين — بدون إنترنت)
 * يغطي: نموذج الإكسيل، إضافة الأصناف من ملف مضغوط، رفع الصور وربطها، الاستبدال، مسح الصورة القديمة بأمان،
 * الصلاحيات، والتصدير ثم الاستيراد تاني بعد إعادة ضبط المصنع (الأصناف والصور ترجع زي ما هي).
 * التشغيل:  npx tsx scripts/verify_item_images_wiring.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { createFakeTransport } from '../server/persistence/statePersistence.ts';
import { ImageStorage } from '../server/imageStorage.ts';
import { createFakeImageStorage, TEST_PNG } from './helpers/fakeImageStorage.ts';
import {
  ADD_ITEMS_HEADERS,
  ITEMS_SHEET_NAME,
  readItemsPackage,
  matchPackageImages
} from '../src/utils/itemImagesPackage.ts';
import { importPackageImages, buildItemsExportZip } from '../src/utils/itemImagesTransfer.ts';

const TENANT = 'test_item_images';
const ADMIN_PASSWORD = 'Images#Admin2026';
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '1234';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

const jpeg = (n: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, n, n, n, n]);
const PNG = Buffer.from(TEST_PNG, 'base64');

function workbook(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  for (let r = 1; r < rows.length; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: 4 });
    if (ws[ref]) ws[ref] = { t: 's', v: String(ws[ref].v) };
  }
  XLSX.utils.book_append_sheet(wb, ws, ITEMS_SHEET_NAME);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
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
  // نسخة تانية من غير تخزين صور (لاختبار الرفض)
  const second = await createServerApp({ attachVite: false, persistenceTransport: createFakeTransport().transport, persistenceTenant: `${TENANT}_b`, imageStorage: null });
  const server2 = second.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server2.once('listening', resolve));
  const baseUrl2 = `http://127.0.0.1:${(server2.address() as any).port}`;

  const call = async (method: string, url: string, body?: unknown, token?: string, base = baseUrl) => {
    const res = await fetch(base + url, {
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
  const objectCount = () => [...images.objects.keys()].filter(k => k.includes(`/${TENANT}/items/`)).length;
  const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
  /** نفس اللي الشاشة بتعمله: رفع على /api/upload-image وربط على /api/items/images/set */
  const uploader = (token: string) => ({
    prepare: async (img: { bytes: Uint8Array }) => `data:image/jpeg;base64,${toBase64(img.bytes)}`,
    upload: async (dataUrl: string) => {
      const r = await call('POST', '/api/upload-image', { imageBase64: dataUrl, folder: 'items' }, token);
      if (r.status !== 200 || !r.data?.url) throw new Error(r.data?.error || 'فشل الرفع');
      return r.data.url as string;
    },
    setImages: async (entries: { key: string; url: string }[], replace: boolean) => {
      const r = await call('POST', '/api/items/images/set', { entries, replace }, token);
      if (r.status !== 200) throw new Error(r.data?.error || 'فشل الربط');
      return r.data.results;
    }
  });
  const fetchFromStorage = async (url: string) => {
    const path = storage.pathFromUrl(url);
    const obj = images.objects.get(`mudaqqeq-images/${path}`);
    if (!obj) throw new Error('السيرفر رد بـ 404');
    return new Uint8Array(obj.bytes);
  };

  try {
    const login = async (username: string, password: string) => (await call('POST', '/api/auth/login', { username, password })).data?.token as string;
    let owner = await login('admin', INITIAL_PASSWORD);
    assert((await call('POST', '/api/auth/complete-initial-setup', { name: 'صاحب المحل', username: 'admin', newPassword: ADMIN_PASSWORD }, owner)).status === 200, 'إعداد المالك');
    owner = await login('admin', ADMIN_PASSWORD);
    const created = await call('POST', '/api/users', { username: 'viewer1', name: 'موظف', phone: '01055550009', role: 'employee', password: 'Viewer#2026x', status: 'active', permissions: ['items.view'] }, owner);
    assert(created.status === 200, `مستخدم بدون صلاحية التعديل بالإكسيل: ${created.data?.error || ''}`);
    let viewer = await login('viewer1', 'Viewer#2026x');
    if ((await call('GET', '/api/auth/me', undefined, viewer)).data?.user?.mustChangePassword) {
      await call('POST', '/api/auth/complete-initial-setup', { name: 'موظف', username: 'viewer1', newPassword: 'Viewer#2026y' }, viewer);
      viewer = await login('viewer1', 'Viewer#2026y');
    }

    // ---- الإعدادات والنموذج ----
    const cfg = await call('GET', '/api/items/images/config', undefined, owner);
    assert(cfg.status === 200 && cfg.data.storageEnabled === true, 'تخزين الصور مفعّل');
    assert((await call('GET', '/api/items/images/config', undefined, owner, baseUrl2)).data.storageEnabled === false, 'نسخة من غير تخزين: مش مفعّل');
    const tpl = await call('GET', '/api/items/bulk-edit-excel/template?operationType=add_items', undefined, owner);
    const tplRows = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(tpl.buffer, { type: 'buffer' }).Sheets[ITEMS_SHEET_NAME], { header: 1, defval: '' });
    assert(tpl.status === 200 && JSON.stringify(tplRows[0]) === JSON.stringify(ADD_ITEMS_HEADERS), 'نموذج «إضافة أصناف» فيه عمود «الصورة» في الآخر');

    // ---- إضافة 5 أصناف من ملف مضغوط بالصور ----
    const warehouses = (await call('GET', '/api/warehouses', undefined, owner)).data.warehouses as any[];
    const mainWh = warehouses[0].id;
    const rows = [
      [...ADD_ITEMS_HEADERS],
      ['قلم جاف أزرق', 'قلم أزرق', 50, 'أدوات مكتبية', '6221000000011', 10, 6, 'قلم 1 مم', 'قطعة', 5, 'مورد النيل', 14, ''],
      ['كراسة 100 ورقة', '', 20, 'أدوات مكتبية', '6221000000028', 25.5, 15, '', 'قطعة', 0, '', 0, 'kerasa.PNG'],
      ['ممحاة', '', 10, '', '6221000000035', 5, 2, '', '', '', '', '', ''],
      ['مسطرة 30 سم', '', 8, '', '6221000000042', 7, 4, '', '', '', '', '', ''],
      ['برجل', '', 3, '', '6221000000059', 30, 20, '', '', '', '', '', '']
    ];
    const zip = new JSZip();
    zip.file('أصناف.xlsx', workbook(rows));
    zip.file('صور/6221000000011.jpg', jpeg(1));
    zip.file('صور/kerasa.png', PNG);
    zip.file('صور/6221000000035.jpg', jpeg(3));
    zip.file('صور/6221000000042.jpg', jpeg(3)); // نفس صورة الممحاة
    zip.file('صور/زيادة.jpg', jpeg(9));
    const pkg = await readItemsPackage(await zip.generateAsync({ type: 'uint8array' }), 'أصناف.zip');
    const match = matchPackageImages(pkg);
    assert(match.stats.rows === 5 && match.stats.withImage === 4 && match.unmatchedImages.join() === 'زيادة.jpg', 'المعاينة: 5 أصناف، 4 بصور، وصورة زيادة');
    const payload = { operationType: 'add_items', fileName: pkg.workbookName, fileBase64: toBase64(pkg.workbookBytes), warehouseId: mainWh };
    const preview = await call('POST', '/api/items/bulk-edit-excel/preview', payload, owner);
    assert(preview.status === 200 && preview.data.success, `معاينة السيرفر مع عمود الصورة: ${preview.data?.error || ''}`);
    const exec = await call('POST', '/api/items/bulk-edit-excel/execute', payload, owner);
    assert(exec.status === 200 && exec.data.updatedCount === 5, `الأصناف اتحفظت الأول: ${exec.data?.error || exec.data?.updatedCount}`);
    const progress: number[] = [];
    let report = await importPackageImages({ entries: match.entries, replace: false, ...uploader(owner), onProgress: d => progress.push(d) });
    assert(report.uploaded === 4 && report.updated === 4 && report.failed.length === 0 && progress[progress.length - 1] === 4, `الصور اترفعت واتربطت (${JSON.stringify(report.failed)})`);
    assert(objectCount() === 3, `الصورة المتكررة اتخزنت مرة واحدة (${objectCount()})`);
    let items = (await call('GET', '/api/items', undefined, owner)).data.items as any[];
    const byBarcode = (b: string) => items.find(i => i.barcode === b);
    assert(storage.pathFromUrl(byBarcode('6221000000011').imageUrl) && byBarcode('6221000000035').imageUrl === byBarcode('6221000000042').imageUrl && !byBarcode('6221000000059').imageUrl, 'روابط الصور على تخزين البرنامج');
    assert(db('items').every(r => !String(docOf(r).imageUrl || '').startsWith('data:')), 'مفيش صور محفوظة كنص جوه قاعدة البيانات');
    assert(db('auditLogs').some(r => docOf(r).action === 'ITEM_IMAGES_IMPORTED'), 'مسجل في سجل التدقيق');
    assert(db('itemChangeLogs').length === 0 || db('itemChangeLogs').some(r => docOf(r).fieldName === 'صورة الصنف'), 'سجل تغييرات الصنف');

    // ---- نفس الملف تاني (الاستبدال مقفول): مفيش حاجة تتغير ----
    report = await importPackageImages({ entries: match.entries, replace: false, ...uploader(owner) });
    assert(report.updated === 0 && report.skipped === 4 && objectCount() === 3, 'رفع نفس الملف تاني: الأصناف اللي ليها صورة اتسابت ومفيش ملفات زيادة');

    // ---- تعديل الصور بس + الاستبدال + مسح القديمة بأمان ----
    const onlyZip = new JSZip();
    onlyZip.file('صور.xlsx', (() => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['الصنف', 'الصورة'], ['6221000000011', 'جديد.jpg'], ['ممحاة', 'جديد2.jpg']]), 'Sheet1');
      return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    })());
    onlyZip.file('جديد.jpg', jpeg(21));
    onlyZip.file('جديد2.jpg', jpeg(22));
    const onlyPkg = await readItemsPackage(await onlyZip.generateAsync({ type: 'uint8array' }), 'صور.zip', 'images_only');
    const onlyMatch = matchPackageImages(onlyPkg, 'images_only');
    const oldPenUrl = byBarcode('6221000000011').imageUrl;
    const sharedUrl = byBarcode('6221000000035').imageUrl;
    report = await importPackageImages({ entries: onlyMatch.entries, replace: true, ...uploader(owner) });
    assert(report.updated === 2, `تعديل الصور: الصنف بالباركود وبالاسم (${JSON.stringify(report.failed)})`);
    items = (await call('GET', '/api/items', undefined, owner)).data.items as any[];
    assert(byBarcode('6221000000011').imageUrl !== oldPenUrl && byBarcode('6221000000035').imageUrl !== sharedUrl && byBarcode('6221000000042').imageUrl === sharedUrl, 'الصور اتغيرت للصنفين بس');
    assert(!images.objects.has(`mudaqqeq-images/${storage.pathFromUrl(oldPenUrl)}`), 'الصورة القديمة اللي مش مستخدمة اتمسحت من التخزين');
    assert(images.objects.has(`mudaqqeq-images/${storage.pathFromUrl(sharedUrl)}`), 'الصورة القديمة اللي صنف تاني بيستخدمها ما اتمسحتش');

    // ---- الرفض ----
    const goodUrl = byBarcode('6221000000011').imageUrl;
    let res = await call('POST', '/api/items/images/set', { entries: [{ key: '6221000000059', url: 'https://other-site.com/a.jpg' }], replace: true }, owner);
    assert(res.status === 200 && res.data.results[0].status === 'error' && res.data.results[0].error.includes('سيرفر البرنامج'), 'رابط لموقع تاني مرفوض');
    res = await call('POST', '/api/items/images/set', { entries: [{ key: 'صنف مش موجود', url: goodUrl }], replace: true }, owner);
    assert(res.data.results[0].status === 'error' && res.data.results[0].error.includes('مفيش صنف'), 'صنف مش موجود');
    assert((await call('POST', '/api/items/images/set', { entries: [], replace: true }, owner)).status === 400, 'طلب فاضي مرفوض');
    assert((await call('POST', '/api/items/images/set', { entries: new Array(101).fill({ key: 'x', url: goodUrl }), replace: true }, owner)).status === 400, 'أكتر من 100 في الطلب مرفوض');
    assert((await call('POST', '/api/items/images/set', { entries: [{ key: '6221000000059', url: goodUrl }] }, viewer)).status === 403, 'من غير صلاحية «تعديل بالإكسيل» مرفوض');
    const owner2Login = await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD }, undefined, baseUrl2);
    const noStorage = await call('POST', '/api/items/images/set', { entries: [{ key: '1', url: goodUrl }] }, owner2Login.data?.token, baseUrl2);
    assert(noStorage.status === 503 && noStorage.data.code === 'STORAGE_DISABLED' && /[\u0600-\u06FF]/.test(noStorage.data.error), `نسخة من غير تخزين صور: مرفوض برسالة عربية (${noStorage.status})`);

    // ---- التصدير ----
    items = (await call('GET', '/api/items', undefined, owner)).data.items as any[];
    const categories = (await call('GET', '/api/categories', undefined, owner)).data.categories as any[];
    const before = items
      .map(i => ({ name: i.name, barcode: i.barcode, salePrice: i.salePrice, purchasePrice: i.purchasePrice, unit: i.unit, imageUrl: i.imageUrl || '' }))
      .sort((a, b) => a.barcode.localeCompare(b.barcode));
    const exported = await buildItemsExportZip({ items, categories, shopName: 'مكتبة النور', fetchImage: fetchFromStorage });
    assert(exported.itemsCount === 5 && exported.imagesExported === 4 && exported.failed.length === 0, 'اتصدّر 5 أصناف و4 صور');

    // ---- إعادة ضبط المصنع ثم الاستيراد من الملف المصدّر ----
    const status = await call('GET', '/api/system/reset-status', undefined, owner);
    const factory = await call('POST', '/api/system/factory-reset', { password: ADMIN_PASSWORD, confirmText: status.data.phrases.factory }, owner);
    assert(factory.status === 200, `إعادة ضبط المصنع: ${factory.data?.error || ''}`);
    owner = await login('admin', ADMIN_PASSWORD);
    assert(((await call('GET', '/api/items', undefined, owner)).data.items as any[]).length === 0, 'مفيش أصناف بعد إعادة الضبط');
    const backPkg = await readItemsPackage(exported.zipBytes, exported.fileName);
    const backMatch = matchPackageImages(backPkg);
    const wh2 = ((await call('GET', '/api/warehouses', undefined, owner)).data.warehouses as any[])[0].id;
    const backExec = await call('POST', '/api/items/bulk-edit-excel/execute', { operationType: 'add_items', fileName: backPkg.workbookName, fileBase64: toBase64(backPkg.workbookBytes), warehouseId: wh2 }, owner);
    assert(backExec.status === 200 && backExec.data.updatedCount === 5, `استيراد الملف المصدّر: ${backExec.data?.error || backExec.data?.updatedCount}`);
    report = await importPackageImages({ entries: backMatch.entries, replace: false, ...uploader(owner) });
    assert(report.updated === 4 && report.failed.length === 0, 'الصور رجعت');
    const after = ((await call('GET', '/api/items', undefined, owner)).data.items as any[])
      .map(i => ({ name: i.name, barcode: i.barcode, salePrice: i.salePrice, purchasePrice: i.purchasePrice, unit: i.unit, imageUrl: i.imageUrl || '' }))
      .sort((a, b) => a.barcode.localeCompare(b.barcode));
    assert(JSON.stringify(after) === JSON.stringify(before), `الأصناف والصور رجعت زي ما هي\nقبل: ${JSON.stringify(before)}\nبعد: ${JSON.stringify(after)}`);
    const afterCats = (await call('GET', '/api/categories', undefined, owner)).data.categories as any[];
    assert(afterCats.some(c => c.name === 'أدوات مكتبية'), 'التصنيف رجع');

    console.log(`\n🎉 كل اختبارات ربط الأصناف بالصور نجحت (${passed} تحققًا).`);
  } finally {
    engine.stop();
    second.persistence?.stop();
    server.close();
    server2.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌', err?.message || err);
    process.exit(1);
  });

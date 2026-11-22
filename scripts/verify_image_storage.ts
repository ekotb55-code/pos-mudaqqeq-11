/**
 * اختبار تخزين الصور (server/imageStorage.ts) على تخزين وهمي يحاكي Supabase Storage
 * التشغيل: npx tsx scripts/verify_image_storage.ts
 */
import {
  ImageStorage,
  ImageStorageError,
  IMAGE_BUCKET,
  MAX_IMAGE_BYTES,
  sniffImageMime,
  decodeImage,
  isInlineImage,
  countInlineImages,
  migrateInlineImages
} from '../server/imageStorage.ts';
import { createFakeImageStorage, TEST_PNG, TEST_JPEG, TEST_GIF, TEST_WEBP } from './helpers/fakeImageStorage.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}
const arabic = /[\u0600-\u06FF]/;
async function expectError(fn: () => unknown, code: string, label: string) {
  let caught: any = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof ImageStorageError && caught.code === code && arabic.test(caught.message), label);
}

async function main() {
  // ---- التعرف على نوع الصورة من محتواها ----
  const b64 = (s: string) => Buffer.from(s, 'base64');
  assert(sniffImageMime(b64(TEST_PNG)) === 'image/png' && sniffImageMime(b64(TEST_JPEG)) === 'image/jpeg', 'PNG و JPEG');
  assert(sniffImageMime(b64(TEST_GIF)) === 'image/gif' && sniffImageMime(b64(TEST_WEBP)) === 'image/webp', 'GIF و WEBP');
  assert(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')) === null && sniffImageMime(Buffer.from('%PDF-1.4')) === null, 'SVG و PDF ليسا صورًا مقبولة');

  // ---- فك الصورة المرسلة ----
  assert(decodeImage(`data:image/png;base64,${TEST_PNG}`).mime === 'image/png' && decodeImage(TEST_PNG).ext === 'png', 'رابط data أو base64 فقط');
  assert(decodeImage(`data:image/png;base64,${TEST_JPEG}`).mime === 'image/jpeg', 'النوع يُؤخذ من المحتوى وليس من الاسم المرسل');
  await expectError(() => decodeImage(''), 'INVALID_INPUT', 'صورة فارغة');
  await expectError(() => decodeImage('data:image/png,abc'), 'INVALID_INPUT', 'رابط data بدون base64');
  await expectError(() => decodeImage('###'), 'INVALID_INPUT', 'نص تالف');
  await expectError(() => decodeImage(Buffer.from('<script>alert(1)</script>').toString('base64')), 'INVALID_INPUT', 'ملف ليس صورة');
  await expectError(() => decodeImage(Buffer.alloc(MAX_IMAGE_BYTES + 10, 0xff).toString('base64')), 'TOO_LARGE', 'أكبر من 2 ميجا');
  assert(isInlineImage(`data:image/png;base64,${TEST_PNG}`) && !isInlineImage('https://x.test/a.png') && !isInlineImage(null), 'التعرف على الصورة المحفوظة كنص');

  // ---- الرفع ----
  const fake = createFakeImageStorage();
  const storage = new ImageStorage({ url: `${fake.baseUrl}/`, secretKey: 'sb_secret_test', tenant: 'Main Shop', fetchImpl: fake.fetchImpl });
  const first = await storage.upload({ imageBase64: `data:image/png;base64,${TEST_PNG}`, folder: 'items' });
  assert(fake.buckets.has(IMAGE_BUCKET) && fake.buckets.get(IMAGE_BUCKET).public === true && fake.buckets.get(IMAGE_BUCKET).file_size_limit === MAX_IMAGE_BYTES, 'إنشاء حاوية عامة بحد 2 ميجا');
  assert(/^main_shop\/items\/[0-9a-f]{32}\.png$/.test(first.path) && first.mime === 'image/png' && first.bytes === b64(TEST_PNG).length, 'مسار الصورة: الشركة/المجلد/البصمة');
  assert(first.url === `${fake.baseUrl}/storage/v1/object/public/${IMAGE_BUCKET}/${first.path}`, 'الرابط العام للصورة');
  const upload = fake.calls.find(c => c.method === 'POST' && c.path.startsWith('/object/'))!;
  assert(upload.headers.apikey === 'sb_secret_test' && upload.headers.authorization === 'Bearer sb_secret_test' && upload.headers['x-upsert'] === 'true' && upload.headers['content-type'] === 'image/png', 'ترويسات الرفع');
  assert(fake.objects.get(`${IMAGE_BUCKET}/${first.path}`)!.bytes.equals(b64(TEST_PNG)), 'محتوى الصورة وصل كما هو');
  const again = await storage.upload({ imageBase64: TEST_PNG, folder: 'items' });
  assert(again.path === first.path && fake.objects.size === 1, 'نفس الصورة مرتين = ملف واحد');
  assert(fake.calls.filter(c => c.path.startsWith('/bucket')).length === 2, 'تجهيز الحاوية مرة واحدة فقط لكل تشغيل');
  const other = await storage.upload({ imageBase64: TEST_JPEG, folder: '../../etc' });
  assert(/^main_shop\/misc\/[0-9a-f]{32}\.jpg$/.test(other.path), 'مجلد غير معروف ← misc (لا خروج من المجلد)');
  assert(storage.pathFromUrl(first.url) === first.path && storage.pathFromUrl('https://evil.test/x.png') === '' && storage.pathFromUrl(undefined) === '', 'التعرف على روابطنا فقط');

  // ---- الأخطاء ----
  fake.failNext(500);
  await expectError(() => storage.upload({ imageBase64: TEST_GIF, folder: 'items' }), 'UNAVAILABLE', 'خطأ من التخزين');
  fake.failNext('network');
  await expectError(() => storage.upload({ imageBase64: TEST_GIF, folder: 'items' }), 'UNAVAILABLE', 'انقطاع الاتصال');
  const wrongKey = new ImageStorage({ url: fake.baseUrl, secretKey: '', tenant: 'x', fetchImpl: fake.fetchImpl });
  await expectError(() => wrongKey.upload({ imageBase64: TEST_PNG }), 'UNAVAILABLE', 'مفتاح غير صالح');
  // حاوية أُنشئت من سيرفر آخر في نفس اللحظة
  const fake2 = createFakeImageStorage();
  fake2.buckets.set('pre', { id: 'pre' });
  const racing = new ImageStorage({ url: fake2.baseUrl, secretKey: 'k', tenant: 't', bucket: 'pre', fetchImpl: fake2.fetchImpl });
  fake2.failNext(400);
  await racing.ensureBucket().catch(() => undefined);
  assert((await racing.upload({ imageBase64: TEST_PNG })).path.startsWith('t/misc/'), 'حاوية موجودة مسبقًا تُستخدم كما هي');

  // ---- الحذف: صور الشركة نفسها فقط ----
  assert((await storage.remove([first.path, 'other_tenant/items/x.png'])) && !fake.objects.has(`${IMAGE_BUCKET}/${first.path}`), 'حذف صورة');
  const deleteCall = fake.calls.filter(c => c.method === 'DELETE').pop()!;
  assert(deleteCall && fake.calls.filter(c => c.method === 'DELETE').length === 1, 'طلب حذف واحد');
  assert((await storage.remove(['other_tenant/items/x.png'])) && fake.calls.filter(c => c.method === 'DELETE').length === 1, 'صور شركة أخرى لا تُحذف');

  // ---- نقل الصور القديمة ----
  const items: any[] = [
    { id: 'i1', name: 'قلم', imageUrl: `data:image/png;base64,${TEST_PNG}` },
    { id: 'i2', name: 'كراسة', imageUrl: 'https://cdn.test/a.png' },
    { id: 'i3', name: 'ممحاة', imageUrl: '' },
    { id: 'i4', name: 'مسطرة', imageUrl: `data:image/jpeg;base64,${TEST_JPEG}` },
    { id: 'i5', name: 'تالفة', imageUrl: 'data:image/png;base64,AAAA' }
  ];
  let print: any = { headerImageUrl: `data:image/gif;base64,${TEST_GIF}` };
  let company: any = { storeName: 'محل', logoUrl: 'https://cdn.test/logo.png' };
  const collections: any[] = [
    { name: 'items', kind: 'list', get: () => items, set: (v: any) => v },
    { name: 'settings.invoicePrint', kind: 'single', get: () => print, set: (v: any) => { print = v; } },
    { name: 'settings.company', kind: 'single', get: () => company, set: (v: any) => { company = v; } }
  ];
  const before = countInlineImages(collections);
  assert(before.total === 4 && before.byCollection.items === 3 && before.byCollection['settings.invoicePrint'] === 1 && !before.byCollection['settings.company'], 'عدّ الصور المحفوظة كنص');
  const limited = await migrateInlineImages(collections, storage, 1);
  assert(limited.moved === 1 && limited.remaining === 3, 'النقل على دفعات');
  const result = await migrateInlineImages(collections, storage);
  assert(result.moved === 2 && result.failed === 1 && result.remaining === 1 && result.errors.length === 1 && result.errors[0].includes('تالفة'), 'نقل الباقي، والتالفة تبقى كما هي مع سبب');
  assert(items[0].imageUrl.startsWith(`${fake.baseUrl}/storage/v1/object/public/`) && items[3].imageUrl.includes('/items/') && items[1].imageUrl === 'https://cdn.test/a.png' && items[2].imageUrl === '', 'روابط الأصناف بعد النقل، والروابط العادية لم تتغير');
  assert(print.headerImageUrl.includes('/print/') && print.headerImageUrl.endsWith('.gif'), 'صورة هيدر الإيصال نُقلت');
  assert(items[4].imageUrl === 'data:image/png;base64,AAAA', 'الصورة التي فشل نقلها لم تضِع');

  console.log(`\n🎉 كل اختبارات تخزين الصور نجحت (${passed} تحققًا).`);
}

main().catch(err => {
  console.error('❌', err?.message || err);
  process.exit(1);
});

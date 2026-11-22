/**
 * اختبار شاشة الزوار (server/visitorDisplay.ts)
 * التشغيل: npx tsx scripts/verify_visitor_display.ts
 */
import {
  defaultVisitorSettings,
  getVisitorSettings,
  saveVisitorSettings,
  addVisitorSlide,
  removeVisitorSlide,
  reorderVisitorSlides,
  lookupVisitorProduct,
  buildVisitorCatalog,
  itemBarcodes,
  customerPrice,
  getVisitorSettingsCollection,
  resetVisitorSettings,
  VisitorDisplayError,
  MAX_VISITOR_SLIDES
} from '../server/visitorDisplay.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}
const arabic = /[\u0600-\u06FF]/;
function expectError(fn: () => unknown, code: string, label: string) {
  let caught: any = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof VisitorDisplayError && caught.code === code && arabic.test(caught.message), label);
}

const items: any[] = [
  { id: 'i1', name: 'قلم 12 ق', printName: 'قلم جاف أزرق', barcode: '6221000000011', secondaryBarcodes: ['A-77'], salePrice: 10, purchasePrice: 6, taxRate: 14, unit: 'قطعة', imageUrl: 'https://cdn.test/pen.png', stockQuantity: 50, supplier: 'مورد', status: 'نشط' },
  { id: 'i2', name: 'كراسة', barcode: '6221000000028', barcodes: [{ itemId: 'i2', barcode: 'BOX-9', type: 'secondary', active: true }, { itemId: 'i2', barcode: 'OLD-1', type: 'secondary', active: false }], salePrice: 25.5, unit: 'علبة', imageUrl: '', status: 'active' },
  { id: 'i3', name: 'موقوف', barcode: '6221000000035', salePrice: 5, status: 'موقوف' },
  { id: 'i4', name: 'مؤرشف', barcode: '6221000000042', salePrice: 5, status: 'مؤرشف' },
  { id: 'i5', name: 'صورة داخلية', barcode: '6221000000059', salePrice: 7, imageUrl: 'data:image/png;base64,AAAA', status: 'نشط' },
  { id: 'i6', name: 'رابط غريب', barcode: '6221000000066', salePrice: 7, imageUrl: 'javascript:alert(1)', status: 'نشط' }
];
const inclusive = { items, taxInclusive: true };

// ---- الإعدادات الافتراضية ----
resetVisitorSettings();
const defaults = getVisitorSettings();
assert(defaults.slides.length === 0 && defaults.slideSeconds === 8 && defaults.resultSeconds === 10 && defaults.showWelcome && defaults.showLogo && arabic.test(defaults.welcomeText), 'الإعدادات الافتراضية');

// ---- الحفظ ----
expectError(() => saveVisitorSettings(null, 'x'), 'INVALID_INPUT', 'بيانات فارغة تُرفض');
expectError(() => saveVisitorSettings({ slideSeconds: 2 }, 'x'), 'INVALID_INPUT', 'مدة أقل من 3 ثوان تُرفض');
expectError(() => saveVisitorSettings({ resultSeconds: 61 }, 'x'), 'INVALID_INPUT', 'مدة أكثر من 60 ثانية تُرفض');
expectError(() => saveVisitorSettings({ welcomeText: 'ن'.repeat(121) }, 'x'), 'INVALID_INPUT', 'نص ترحيب طويل يُرفض');
let saved = saveVisitorSettings({ slideSeconds: 5, resultSeconds: 15, showWelcome: false, welcomeText: '  أهلًا بيك  ', showLogo: false }, 'صاحب المحل', new Date('2026-11-19T10:00:00.000Z'));
assert(saved.slideSeconds === 5 && saved.resultSeconds === 15 && !saved.showWelcome && saved.welcomeText === 'أهلًا بيك' && !saved.showLogo && saved.updatedBy === 'صاحب المحل', 'حفظ المدد ونص الترحيب وإلغاء الترحيب والشعار');
saved = saveVisitorSettings({ showWelcome: true }, 'صاحب المحل');
assert(saved.showWelcome && saved.slideSeconds === 5 && !saved.showLogo, 'الحفظ الجزئي يحتفظ بالباقي');

// ---- الصور ----
expectError(() => addVisitorSlide({ url: 'data:image/png;base64,AAAA', path: '' }), 'INVALID_INPUT', 'الصورة لازم تكون رابطًا على السيرفر (ليست نصًا داخل البيانات)');
const s1 = addVisitorSlide({ url: 'https://cdn.test/1.png', path: 'main/visitor/1.png' });
const s2 = addVisitorSlide({ url: 'https://cdn.test/2.png', path: 'main/visitor/2.png' });
const s3 = addVisitorSlide({ url: 'https://cdn.test/1.png', path: 'main/visitor/1.png' });
assert(getVisitorSettings().slides.map(s => s.id).join() === [s1.id, s2.id, s3.id].join(), 'إضافة الصور بالترتيب');
assert(reorderVisitorSlides([s3.id, s1.id, s2.id]).map(s => s.id).join() === [s3.id, s1.id, s2.id].join(), 'إعادة الترتيب');
expectError(() => reorderVisitorSlides([s1.id]), 'INVALID_INPUT', 'ترتيب ناقص يُرفض');
expectError(() => reorderVisitorSlides([s1.id, s1.id, s2.id]), 'INVALID_INPUT', 'ترتيب مكرر يُرفض');
expectError(() => reorderVisitorSlides('x'), 'INVALID_INPUT', 'ترتيب غير صالح يُرفض');
let removed = removeVisitorSlide(s1.id);
assert(removed.path === 'main/visitor/1.png' && removed.stillUsed === true, 'حذف صورة لها نسخة أخرى: الملف يبقى');
removed = removeVisitorSlide(s2.id);
assert(removed.path === 'main/visitor/2.png' && removed.stillUsed === false && getVisitorSettings().slides.length === 1, 'حذف آخر استخدام: الملف يُحذف');
expectError(() => removeVisitorSlide('nope'), 'NOT_FOUND', 'حذف صورة غير موجودة');
for (let i = getVisitorSettings().slides.length; i < MAX_VISITOR_SLIDES; i++) addVisitorSlide({ url: `https://cdn.test/f${i}.png`, path: '' });
expectError(() => addVisitorSlide({ url: 'https://cdn.test/x.png', path: '' }), 'INVALID_INPUT', `الحد الأقصى ${MAX_VISITOR_SLIDES} صورة`);

// ---- الباركود ----
assert(itemBarcodes(items[0]).join() === '6221000000011,A-77' && itemBarcodes(items[1]).join() === '6221000000028,BOX-9', 'كل باركودات الصنف (الباركود الفرعي الموقوف لا يُحسب)');
let product = lookupVisitorProduct(' 6221000000011 ', inclusive);
assert(product && product.name === 'قلم جاف أزرق' && product.price === 10 && product.unit === 'قطعة' && product.imageUrl === 'https://cdn.test/pen.png', 'المنتج باسم الطباعة وسعره وصورته');
assert(JSON.stringify(Object.keys(product!).sort()) === JSON.stringify(['imageUrl', 'name', 'price', 'unit']), 'لا يخرج للشاشة إلا الاسم والسعر والوحدة والصورة');
assert(!JSON.stringify(product).includes('مورد') && !('purchasePrice' in product!) && !('stockQuantity' in product!), 'لا سعر شراء ولا رصيد ولا مورد');
assert(lookupVisitorProduct('a-77', inclusive)?.name === 'قلم جاف أزرق', 'الباركود الفرعي، وحروفه الصغيرة');
product = lookupVisitorProduct('BOX-9', inclusive);
assert(product?.name === 'كراسة' && product.price === 25.5 && product.imageUrl === '' && product.unit === 'علبة', 'بدون اسم طباعة: اسم الصنف، وبدون صورة: فارغ');
assert(lookupVisitorProduct('OLD-1', inclusive) === null, 'باركود موقوف لا يُعرض');
assert(lookupVisitorProduct('6221000000035', inclusive) === null && lookupVisitorProduct('6221000000042', inclusive) === null, 'الأصناف الموقوفة والمؤرشفة لا تُعرض');
assert(lookupVisitorProduct('', inclusive) === null && lookupVisitorProduct('x'.repeat(65), inclusive) === null && lookupVisitorProduct('999', inclusive) === null, 'باركود فارغ أو طويل أو غير موجود');
assert(lookupVisitorProduct('6221000000066', inclusive)?.imageUrl === '', 'رابط صورة غير آمن لا يُعرض');

// ---- السعر للزبون ----
assert(customerPrice(items[0], true) === 10 && customerPrice(items[0], false) === 11.4, 'الضريبة تُضاف للسعر لو الأسعار غير شاملة');
assert(lookupVisitorProduct('6221000000011', { items, taxInclusive: false })?.price === 11.4, 'الشاشة تعرض السعر الذي يدفعه الزبون');
assert(customerPrice(items[1], false) === 25.5, 'صنف بلا ضريبة');

// ---- النسخة المضغوطة للعمل بدون اتصال ----
const catalog = buildVisitorCatalog(inclusive);
assert(catalog['6221000000011']?.name === 'قلم جاف أزرق' && catalog['A-77']?.price === 10 && catalog['BOX-9']?.name === 'كراسة', 'كل الباركودات في النسخة المضغوطة');
assert(!catalog['6221000000035'] && !catalog['OLD-1'], 'بدون الموقوف');
assert(catalog['6221000000059'].imageUrl === '', 'الصور المحفوظة كنص لا تدخل النسخة المضغوطة');

// ---- الحفظ والاسترجاع وإعادة الضبط ----
const collection = getVisitorSettingsCollection();
assert(collection.name === 'settings.visitorDisplay' && collection.kind === 'single', 'مجموعة الحفظ');
const snapshot = JSON.parse(JSON.stringify(collection.get()));
const paths = resetVisitorSettings();
assert(paths.includes('main/visitor/1.png') && JSON.stringify(getVisitorSettings()) === JSON.stringify(defaultVisitorSettings()), 'إعادة ضبط المصنع: الافتراضي + مسارات الصور لحذفها');
collection.set(snapshot);
assert(getVisitorSettings().slides.length === MAX_VISITOR_SLIDES && getVisitorSettings().slideSeconds === 5, 'الاسترجاع من قاعدة البيانات');
collection.set({ slides: [{ url: 'data:image/png;base64,AAAA' }, { url: 'https://ok.test/a.png' }], slideSeconds: 999, showLogo: 'x' });
const odd = getVisitorSettings();
assert(odd.slides.length === 1 && odd.slides[0].url === 'https://ok.test/a.png' && odd.slideSeconds === 60 && odd.showLogo === true, 'بيانات محفوظة تالفة تُنظَّف');

console.log(`\n🎉 كل اختبارات شاشة الزوار نجحت (${passed} تحققًا).`);

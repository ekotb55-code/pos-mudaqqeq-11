/**
 * اختبار واجهة «استيراد وتصدير الأصناف بالصور» (فحص نصي للملفات بدون متصفح)
 * التشغيل: npx tsx scripts/verify_item_images_ui.ts
 */
import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`✅ ${name}`);
  } else {
    failed++;
    console.error(`❌ ${name}`);
  }
}

const root = process.cwd();
const read = (file: string) => (fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : '');
const readDir = (dir: string): string => {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return '';
  return fs
    .readdirSync(full, { withFileTypes: true })
    .map(entry => {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) return readDir(rel);
      return /\.(ts|tsx)$/.test(entry.name) ? read(rel) : '';
    })
    .join('\n');
};

const pkgJson = JSON.parse(read('package.json') || '{}');
const client = read('src/api/client.ts');
const bulk = read('src/pages/BulkEditExcelPage.tsx');
const products = read('src/pages/ProductsPage.tsx');
const dialog = read('src/components/ItemsImageExportDialog.tsx');
const panel = read('src/components/ItemsImagesImportPanel.tsx');
// شاشة «تعديل بالإكسيل» + أجزاء الصور بتاعتها
const importUi = bulk + '\n' + panel;
const allUi = bulk + '\n' + products + '\n' + readDir('src/components');

const fn = (name: string) => {
  const i = client.indexOf(`async ${name}(`);
  return i === -1 ? '' : client.slice(i, i + 500);
};

// ---- المكتبة ودوال الاتصال ----
check('JSZip في dependencies', Boolean(pkgJson.dependencies?.jszip));
check('getItemImagesConfig ← GET /api/items/images/config', fn('getItemImagesConfig').includes("'/api/items/images/config'"));
check('setItemImages ← POST /api/items/images/set بـ entries و replace', fn('setItemImages').includes("'/api/items/images/set'") && fn('setItemImages').includes("method: 'POST'") && fn('setItemImages').includes('replace'));
check('uploadImage بيقبل folder', /async uploadImage\(data: \{[^}]*folder\?: /.test(client));

// ---- شاشة «تعديل بالإكسيل»: الاستيراد ----
check('بتقبل ملف مضغوط', /accept="[^"]*\.zip/.test(bulk));
check('عملية «تعديل الصور»', bulk.includes("value=\"images_only\"") && bulk.includes('تعديل الصور'));
check('نموذج «تعديل الصور» من الشاشة بعمودين «الصنف» و«الصورة»', panel.includes('IMAGES_ONLY_HEADERS') && bulk.includes('downloadImagesOnlyTemplate()'));
check('بتقرا الملف بـ readItemsPackage وتربط بـ matchPackageImages', bulk.includes('readItemsPackage(') && bulk.includes('matchPackageImages('));
check('ملف الإكسيل اللي جوه المضغوط هو اللي بيتبعت للسيرفر', bulk.includes('workbookBytes') && bulk.includes('workbookName'));
check(
  'المعاينة قبل التأكيد: الأعداد الأربعة',
  ['عدد الأصناف في الملف', 'ليها صورة', 'من غير صورة', 'صور مش مربوطة بأي صنف'].every(t => allUi.includes(t))
);
check('اختيار «استبدال صور الأصناف اللي ليها صورة» مقفول من الأول', importUi.includes('استبدال صور الأصناف اللي ليها صورة') && bulk.includes('const [replaceExistingImages, setReplaceExistingImages] = useState(false)'));
check('«تعديل الصور»: سطر الأصناف اللي صورتها هتتغير', allUi.includes('ليهم صورة وهتتغير'));
check('زرار «تأكيد الاستيراد»', bulk.includes('تأكيد الاستيراد'));
check('الأصناف تتحفظ الأول وبعدين الصور', panel.includes('بيحفظ الأصناف…') && panel.includes('importPackageImages(') && /setExecuteResult\(res\)[\s\S]{0,200}runImagesUpload\(/.test(bulk));
check('خط التقدم «بيرفع الصور: X من Y»', panel.includes('بيرفع الصور:') && panel.includes("toLocaleString('en-US')"));
check('التصغير والرفع والربط', panel.includes('prepareImageForUpload') && panel.includes('api.uploadImage(') && panel.includes("folder: 'items'") && panel.includes('api.setItemImages(') && bulk.includes('uploadItemImages('));
check('الرفع من خلال سيرفر البرنامج بس (مفيش اتصال مباشر بتخزين الصور)', !/supabase/i.test(importUi + dialog));
check('إلغاء الرفع', bulk.includes('AbortController') && panel.includes('إلغاء') && bulk.includes('.abort()'));
check('تنبيه لو الصفحة اتقفلت أثناء الرفع', bulk.includes('beforeunload'));
check('تخزين الصور مش مفعّل: رسالة واضحة', bulk.includes('api.getItemImagesConfig()') && panel.includes('تخزين الصور على السيرفر مش مفعّل'));
check('التقرير: الأعداد', ['صنف اتضاف', 'صورة اترفعت', 'صورة فشلت'].every(t => allUi.includes(t)));
check('جدول الصور اللي ما اترفعتش + تحميله إكسيل', allUi.includes('صور ما اترفعتش') && allUi.includes('تحميل الجدول إكسيل') && allUi.includes('اسم الملف') && allUi.includes('السبب'));

// ---- التصدير ----
check('نافذة التصدير ItemsImageExportDialog', dialog.length > 0 && dialog.includes('buildItemsExportZip(') && dialog.includes('estimateExportSize('));
check('قبل التصدير: العدد واللي ليها صورة والحجم التقريبي + «ابدأ التصدير»', ['عدد الأصناف', 'ليها صورة', 'حجم تقريبي', 'ابدأ التصدير'].every(t => dialog.includes(t)));
check('أثناء التصدير: «بيجهّز الصور: X من Y» + «إلغاء»', dialog.includes('بيجهّز الصور:') && dialog.includes('إلغاء') && dialog.includes('AbortController'));
check('في الآخر: رسالة الملخص وتحميل الملف', dialog.includes('exportSummaryText(') && dialog.includes('createObjectURL'));
check('زرار «تصدير الأصناف بالصور» في «تعديل بالإكسيل»', bulk.includes('تصدير الأصناف بالصور') && bulk.includes('ItemsImageExportDialog'));
check('زرار «تصدير الأصناف بالصور» في عرض الأصناف (اللي ظاهر بس)', products.includes('تصدير الأصناف بالصور') && products.includes('ItemsImageExportDialog'));
check('نفس صلاحية التصدير العادي', products.includes('canExport') && bulk.includes("'products.export'"));

// ---- عربي فقط ----
// نص JSX بس (مش كود TypeScript بين علامتين < >)
const visible = (allUi.match(/>[^<>{}]*[A-Za-z]{4,}[^<>{}]*</g) || []).filter(t => !/[;=()]/.test(t));
check('لا نصوص إنجليزي ظاهرة في الأجزاء الجديدة', !visible.some(t => /images? (import|export)|upload(ing)?|zip file|cancel/i.test(t)));

console.log(`\nالنتيجة: نجح ${passed} — فشل ${failed}`);
if (failed > 0) process.exit(1);
console.log(`🎉 كل اختبارات واجهة الأصناف بالصور نجحت (${passed} تحققًا).`);

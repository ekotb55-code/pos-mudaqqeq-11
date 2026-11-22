/**
 * اختبار حجم وشكل الواجهة (src/utils/uiScale.ts)
 * التشغيل: npx tsx scripts/verify_ui_scale.ts
 */
import {
  DEFAULT_UI_PREFS,
  UI_PREFS_STORAGE_KEY,
  UI_SCALE_OPTIONS,
  POS_PANEL_WIDTHS,
  POS_CARD_SIZES,
  POS_CATEGORY_SIZES,
  clampScale,
  normalizeUiPrefs,
  readUiPrefs,
  writeUiPrefs,
  resetUiPrefs,
  applyUiPrefs,
  effectiveScale,
  getAppZoom,
  toLayoutPx,
  formatScale
} from '../src/utils/uiScale.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    }
  };
}
function brokenStorage() {
  return {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    }
  };
}
function fakeRoot() {
  const props = new Map<string, string>();
  const attrs = new Map<string, string>();
  return {
    props,
    attrs,
    style: {
      setProperty: (k: string, v: string) => {
        props.set(k, v);
      },
      removeProperty: (k: string) => {
        props.delete(k);
      }
    },
    setAttribute: (k: string, v: string) => {
      attrs.set(k, v);
    }
  };
}

// ---- الافتراضي ----
assert(DEFAULT_UI_PREFS.appScale === 1 && DEFAULT_UI_PREFS.posScale === 1, 'الحجم الافتراضي 100%');
assert(DEFAULT_UI_PREFS.posPanelWidth === 'medium' && DEFAULT_UI_PREFS.posCardSize === 'medium' && DEFAULT_UI_PREFS.posCategorySize === 'medium', 'الشكل الافتراضي وسط');
assert(DEFAULT_UI_PREFS.posFrameless === true && !('posShowImages' in DEFAULT_UI_PREFS) && !('posView' in DEFAULT_UI_PREFS), 'بدون إطارات افتراضيًا، والصور وطريقة العرض ليست إعدادًا للجهاز');
assert(Object.isFrozen(DEFAULT_UI_PREFS), 'الافتراضي لا يتغير بالخطأ');

// ---- الأحجام ----
assert(UI_SCALE_OPTIONS[0] === 0.8 && UI_SCALE_OPTIONS[UI_SCALE_OPTIONS.length - 1] === 1.25 && UI_SCALE_OPTIONS.includes(1), 'الأحجام من 80% إلى 125%');
assert(clampScale(0.5) === 0.8 && clampScale(3) === 1.25 && clampScale('abc') === 1 && clampScale(0.93) === 0.95 && clampScale('1.1') === 1.1, 'الحجم يُقرَّب لأقرب حجم متاح');
assert(formatScale(0.85) === '85%' && formatScale(1) === '100%' && formatScale(1.25) === '125%', 'نص الحجم');
assert(POS_PANEL_WIDTHS.narrow < POS_PANEL_WIDTHS.medium && POS_PANEL_WIDTHS.medium < POS_PANEL_WIDTHS.wide, 'عرض لوحة الفاتورة متدرج');
assert(POS_CARD_SIZES.small.width < POS_CARD_SIZES.medium.width && POS_CARD_SIZES.medium.width < POS_CARD_SIZES.large.width, 'حجم الكارت متدرج');
assert(POS_CATEGORY_SIZES.small.height < POS_CATEGORY_SIZES.large.height && POS_CATEGORY_SIZES.small.fontSize < POS_CATEGORY_SIZES.large.fontSize, 'حجم التصنيفات متدرج');

// ---- تنظيف القيم ----
assert(JSON.stringify(normalizeUiPrefs(null)) === JSON.stringify(DEFAULT_UI_PREFS), 'قيمة فارغة = الافتراضي');
const odd = normalizeUiPrefs({ appScale: 9, posScale: 0.81, posPanelWidth: 'huge', posCardSize: 'large', posCategorySize: 1, posShowImages: false, posView: 'list', posFrameless: false });
assert(odd.appScale === 1.25 && odd.posScale === 0.8 && odd.posPanelWidth === 'medium' && odd.posCardSize === 'large' && odd.posCategorySize === 'medium' && odd.posFrameless === false, 'القيم الغلط ترجع للافتراضي والصحيحة تبقى');
assert(!('posShowImages' in odd) && !('posView' in odd), 'قيم قديمة محفوظة على الجهاز للصور وطريقة العرض تُتجاهل');

// ---- الحفظ على الجهاز ----
const storage = memoryStorage();
assert(JSON.stringify(readUiPrefs(storage)) === JSON.stringify(DEFAULT_UI_PREFS), 'جهاز جديد = الافتراضي');
let saved = writeUiPrefs({ appScale: 0.9 }, storage);
assert(saved.appScale === 0.9 && saved.posScale === 1, 'حفظ حجم البرنامج فقط');
saved = writeUiPrefs({ posScale: 1.15, posPanelWidth: 'wide', posCardSize: 'small' }, storage);
assert(saved.appScale === 0.9 && saved.posScale === 1.15 && saved.posPanelWidth === 'wide' && saved.posCardSize === 'small', 'كل حفظ يحتفظ بباقي الإعدادات');
assert(JSON.stringify(readUiPrefs(storage)) === JSON.stringify(saved), 'القراءة بعد الحفظ');
storage.data.set(UI_PREFS_STORAGE_KEY, '{not json');
assert(JSON.stringify(readUiPrefs(storage)) === JSON.stringify(DEFAULT_UI_PREFS), 'بيانات تالفة على الجهاز = الافتراضي');
assert(JSON.stringify(readUiPrefs(brokenStorage())) === JSON.stringify(DEFAULT_UI_PREFS) && writeUiPrefs({ appScale: 1.1 }, brokenStorage()).appScale === 1.1, 'التخزين غير المتاح لا يكسر البرنامج');
assert(JSON.stringify(readUiPrefs(null)) === JSON.stringify(DEFAULT_UI_PREFS), 'بدون تخزين = الافتراضي');
writeUiPrefs({ appScale: 1.2 }, storage);
assert(JSON.stringify(resetUiPrefs(storage)) === JSON.stringify(DEFAULT_UI_PREFS) && JSON.stringify(readUiPrefs(storage)) === JSON.stringify(DEFAULT_UI_PREFS), 'زر الرجوع للافتراضي');

// ---- التطبيق على الصفحة ----
const prefs = normalizeUiPrefs({ appScale: 0.9, posScale: 1.15, posPanelWidth: 'narrow', posCardSize: 'large', posCategorySize: 'small', posFrameless: true });
const shared = { showItemImages: false, posLayout: 'list' };
assert(effectiveScale(prefs, false) === 0.9 && effectiveScale(prefs, true) === 1.15, 'نقطة البيع لها حجمها المنفصل');
const root = fakeRoot();
assert(applyUiPrefs(prefs, false, root, shared) === 0.9 && root.props.get('zoom') === '0.9' && root.props.get('--app-zoom') === '0.9', 'باقي البرنامج: zoom = حجم البرنامج');
assert(root.props.get('--pos-panel-w') === '380px' && root.props.get('--pos-card-w') === '200px' && root.props.get('--pos-card-img-h') === '124px', 'متغيرات لوحة الفاتورة والكارت');
assert(root.props.get('--pos-cat-h') === '30px' && root.props.get('--pos-cat-font') === '11px', 'متغيرات التصنيفات');
assert(root.attrs.get('data-pos-frameless') === 'on' && root.attrs.get('data-pos-images') === 'off' && root.attrs.get('data-pos-view') === 'list', 'سمات الشكل: الصور وطريقة العرض من إعدادات النسخة');
applyUiPrefs(prefs, true, root, shared);
assert(root.props.get('zoom') === '1.15' && root.props.get('--app-zoom') === '1.15', 'نقطة البيع: zoom = حجم نقطة البيع');
applyUiPrefs(normalizeUiPrefs(null), false, root);
assert(!root.props.has('zoom') && root.props.get('--app-zoom') === '1', 'الحجم 100% يشيل zoom تمامًا');
assert(root.attrs.get('data-pos-images') === 'on' && root.attrs.get('data-pos-view') === 'cards', 'بدون إعدادات النسخة: الصور ظاهرة وكروت');
applyUiPrefs(prefs, true, root, { showItemImages: true, posLayout: 'compact' });
assert(root.attrs.get('data-pos-images') === 'on' && root.attrs.get('data-pos-view') === 'cards', 'العرض المضغوط القديم = كروت');
assert(applyUiPrefs(prefs, true, null) === 1.15, 'بدون صفحة (اختبار/سيرفر) لا يحدث خطأ');

// ---- تحويل قياسات الشاشة ----
assert(getAppZoom({ currentCSSZoom: 0.85 }) === 0.85 && getAppZoom({ style: { zoom: '1.2' } }) === 1.2 && getAppZoom(null) === 1, 'قراءة الحجم الحالي');
assert(toLayoutPx(425, 0.85) === 500 && toLayoutPx(600, 1.2) === 500 && toLayoutPx(500, 1) === 500 && toLayoutPx(500, 0) === 500, 'قياس الشاشة ← قيمة style');

console.log(`\n🎉 كل اختبارات حجم وشكل الواجهة نجحت (${passed} تحققًا).`);

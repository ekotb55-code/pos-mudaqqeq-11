/**
 * حجم وشكل الواجهة — POS مدقق
 * ---------------------------------------------------------------------------
 * إعدادات على هذا الجهاز فقط (كل شاشة مقاسها مختلف) — بصلاحية settings.ui_scale:
 *   - حجم الواجهة لكل البرنامج، وحجم نقطة البيع منفصلًا عنه.
 *     التكبير/التصغير يتم بخاصية CSS «zoom» على عنصر الصفحة الجذر، فيكبر أو يصغر كل شيء
 *     (الخط والأيقونات والمسافات)، والشبكات تعيد ترتيب نفسها: عند التصغير يدخل في الصف عناصر أكثر.
 *   - شكل نقطة البيع: عرض لوحة الفاتورة، حجم كروت الأصناف، حجم أزرار التصنيفات،
 *     وبدون إطارات (الصفحة قطعة واحدة).
 * أما إظهار صور الأصناف وعرض الأصناف كروت أو قائمة فهما على النسخة كلها (إعدادات العرض
 * displaySettings.showItemImages و displaySettings.posLayout بصلاحية settings.display_customization)،
 * وتُمرَّر لـ applyUiPrefs حتى تُطبَّق بنفس الطريقة.
 *
 * ملاحظتان لمن يستخدم الملف:
 *   - قياسات الشاشة (getBoundingClientRect / clientX / innerHeight) تأتي «مكبّرة»؛ قبل وضعها في style
 *     تُقسم على الحجم الحالي عبر toLayoutPx().
 *   - ارتفاعات الشاشة (100vh) داخل الصفحة المكبّرة تُكتب calc(100vh / var(--app-zoom, 1)) حتى تملأ الشاشة.
 */

export type PosPanelWidth = 'narrow' | 'medium' | 'wide';
export type PosSize = 'small' | 'medium' | 'large';

export interface UiPrefs {
  /** حجم الواجهة لكل البرنامج (1 = الحجم الأصلي) */
  appScale: number;
  /** حجم نقطة البيع (منفصل عن باقي البرنامج) */
  posScale: number;
  posPanelWidth: PosPanelWidth;
  posCardSize: PosSize;
  posCategorySize: PosSize;
  /** بدون إطارات: لوحة الفاتورة وشبكة الأصناف على سطح واحد بدون حدود أو ظلال */
  posFrameless: boolean;
}

export const UI_PREFS_STORAGE_KEY = 'mudaqqeq_ui_prefs_v1';
export const UI_PREFS_EVENT = 'mudaqqeq-ui-prefs-changed';

/** الأحجام المتاحة: من 80% إلى 125% بخطوة 5% */
export const UI_SCALE_OPTIONS: readonly number[] = [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25];

/** عرض لوحة الفاتورة بالبكسل (قبل تطبيق حجم نقطة البيع) */
export const POS_PANEL_WIDTHS: Readonly<Record<PosPanelWidth, number>> = { narrow: 380, medium: 460, wide: 560 };

/** كارت الصنف: العرض وارتفاع الصورة بالبكسل */
export const POS_CARD_SIZES: Readonly<Record<PosSize, { width: number; imageHeight: number }>> = {
  small: { width: 128, imageHeight: 72 },
  medium: { width: 160, imageHeight: 96 },
  large: { width: 200, imageHeight: 124 }
};

/** زر التصنيف: الارتفاع وحجم الخط بالبكسل */
export const POS_CATEGORY_SIZES: Readonly<Record<PosSize, { height: number; fontSize: number }>> = {
  small: { height: 30, fontSize: 11 },
  medium: { height: 36, fontSize: 12.5 },
  large: { height: 44, fontSize: 14 }
};

export const POS_PANEL_WIDTH_LABELS: Readonly<Record<PosPanelWidth, string>> = { narrow: 'ضيقة', medium: 'وسط', wide: 'عريضة' };
export const POS_SIZE_LABELS: Readonly<Record<PosSize, string>> = { small: 'صغير', medium: 'وسط', large: 'كبير' };

export const DEFAULT_UI_PREFS: Readonly<UiPrefs> = Object.freeze({
  appScale: 1,
  posScale: 1,
  posPanelWidth: 'medium',
  posCardSize: 'medium',
  posCategorySize: 'medium',
  posFrameless: true
});

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

/** أقرب حجم من الأحجام المتاحة */
export function clampScale(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  let best = UI_SCALE_OPTIONS[0];
  for (const option of UI_SCALE_OPTIONS) if (Math.abs(option - n) < Math.abs(best - n)) best = option;
  return best;
}

export function normalizeUiPrefs(value: unknown): UiPrefs {
  const source: any = value && typeof value === 'object' ? value : {};
  return {
    appScale: source.appScale === undefined ? DEFAULT_UI_PREFS.appScale : clampScale(source.appScale),
    posScale: source.posScale === undefined ? DEFAULT_UI_PREFS.posScale : clampScale(source.posScale),
    posPanelWidth: oneOf(source.posPanelWidth, ['narrow', 'medium', 'wide'] as const, DEFAULT_UI_PREFS.posPanelWidth),
    posCardSize: oneOf(source.posCardSize, ['small', 'medium', 'large'] as const, DEFAULT_UI_PREFS.posCardSize),
    posCategorySize: oneOf(source.posCategorySize, ['small', 'medium', 'large'] as const, DEFAULT_UI_PREFS.posCategorySize),
    posFrameless: typeof source.posFrameless === 'boolean' ? source.posFrameless : DEFAULT_UI_PREFS.posFrameless
  };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** يقرأ إعدادات هذا الجهاز (أو الافتراضي لو غير موجودة أو تالفة أو التخزين غير متاح) */
export function readUiPrefs(storage: StorageLike | null = defaultStorage()): UiPrefs {
  try {
    const raw = storage?.getItem(UI_PREFS_STORAGE_KEY);
    return normalizeUiPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeUiPrefs(null);
  }
}

/** يحفظ الإعدادات على هذا الجهاز ويبلّغ الصفحة لتطبيقها فورًا */
export function writeUiPrefs(prefs: Partial<UiPrefs>, storage: StorageLike | null = defaultStorage()): UiPrefs {
  const next = normalizeUiPrefs({ ...readUiPrefs(storage), ...prefs });
  try {
    storage?.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // التخزين غير متاح (نافذة خاصة مثلًا): تُطبَّق الإعدادات في هذه الجلسة فقط
  }
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UI_PREFS_EVENT, { detail: next }));
    }
  } catch {
    // لا شيء
  }
  return next;
}

/** يرجع كل الإعدادات للافتراضي على هذا الجهاز */
export function resetUiPrefs(storage: StorageLike | null = defaultStorage()): UiPrefs {
  try {
    storage?.removeItem?.(UI_PREFS_STORAGE_KEY);
  } catch {
    // لا شيء
  }
  return writeUiPrefs({ ...DEFAULT_UI_PREFS }, storage);
}

interface RootLike {
  style: { setProperty(name: string, value: string): void; removeProperty?(name: string): void };
  setAttribute(name: string, value: string): void;
}

/** الحجم الفعلي حسب الصفحة الحالية */
export function effectiveScale(prefs: UiPrefs, isPosPage: boolean): number {
  return isPosPage ? prefs.posScale : prefs.appScale;
}

/** إعدادات العرض المشتركة على النسخة كلها (من displaySettings) */
export interface SharedPosDisplay {
  showItemImages?: boolean;
  posLayout?: string;
}

/**
 * يطبق الإعدادات على عنصر الصفحة الجذر (document.documentElement):
 * zoom + متغيرات CSS لنقطة البيع + سمات data للتنسيقات.
 * shared = إعدادات العرض المشتركة على النسخة (الصور، كروت أو قائمة).
 */
export function applyUiPrefs(
  prefs: UiPrefs,
  isPosPage: boolean,
  root: RootLike | null = typeof document !== 'undefined' ? document.documentElement : null,
  shared: SharedPosDisplay = {}
): number {
  const scale = effectiveScale(prefs, isPosPage);
  if (!root) return scale;
  const card = POS_CARD_SIZES[prefs.posCardSize];
  const category = POS_CATEGORY_SIZES[prefs.posCategorySize];
  if (scale === 1) {
    if (root.style.removeProperty) root.style.removeProperty('zoom');
    else root.style.setProperty('zoom', '1');
  } else {
    root.style.setProperty('zoom', String(scale));
  }
  root.style.setProperty('--app-zoom', String(scale));
  root.style.setProperty('--pos-panel-w', `${POS_PANEL_WIDTHS[prefs.posPanelWidth]}px`);
  root.style.setProperty('--pos-card-w', `${card.width}px`);
  root.style.setProperty('--pos-card-img-h', `${card.imageHeight}px`);
  root.style.setProperty('--pos-cat-h', `${category.height}px`);
  root.style.setProperty('--pos-cat-font', `${category.fontSize}px`);
  root.setAttribute('data-pos-frameless', prefs.posFrameless ? 'on' : 'off');
  root.setAttribute('data-pos-images', shared.showItemImages === false ? 'off' : 'on');
  root.setAttribute('data-pos-view', shared.posLayout === 'list' ? 'list' : 'cards');
  return scale;
}

/** الحجم المطبق حاليًا على الصفحة */
export function getAppZoom(root: any = typeof document !== 'undefined' ? document.documentElement : null): number {
  if (!root) return 1;
  const fromBrowser = Number(root.currentCSSZoom);
  if (Number.isFinite(fromBrowser) && fromBrowser > 0) return fromBrowser;
  const fromStyle = Number(root.style?.zoom || (typeof getComputedStyle === 'function' ? getComputedStyle(root).zoom : ''));
  return Number.isFinite(fromStyle) && fromStyle > 0 ? fromStyle : 1;
}

/** يحوّل قياسًا من الشاشة (getBoundingClientRect / clientX / innerHeight) إلى قيمة توضع في style */
export function toLayoutPx(screenPx: number, zoom: number = getAppZoom()): number {
  return zoom > 0 ? screenPx / zoom : screenPx;
}

/** نص الحجم للعرض: 0.9 ← «90%» */
export function formatScale(scale: number): string {
  return `${Math.round(clampScale(scale) * 100)}%`;
}

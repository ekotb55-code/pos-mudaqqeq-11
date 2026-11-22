/**
 * شاشة الزوار — POS مدقق
 * ---------------------------------------------------------------------------
 * شاشة عرض أو تابلت جنب الرفوف: تقلّب صورًا، ولما الزبون يضرب باركود منتج يظهر اسمه وسعره وصورته.
 * الجهاز يدخل بحساب مخصص صلاحيته الوحيدة «شاشة الزوار» (visitor.display).
 *
 * الأمان: ما يخرج للشاشة هو الاسم (اسم الطباعة لو موجود) والسعر والوحدة والصورة فقط.
 * لا سعر شراء ولا رصيد ولا مورد ولا أي حقل آخر.
 *
 * الإعدادات (صور العرض، المدد، نص الترحيب، الشعار) على النسخة كلها بصلاحية settings.visitor_display.
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import { randomBytes } from 'node:crypto';
import type { CollectionDef } from './persistence/statePersistence.ts';

export interface VisitorSlide {
  id: string;
  url: string;
  /** مسار الصورة في التخزين (لحذفها عند حذف الشريحة) */
  path: string;
  createdAt: string;
}

export interface VisitorDisplaySettings {
  slides: VisitorSlide[];
  /** مدة كل صورة بالثواني */
  slideSeconds: number;
  /** مدة ظهور نتيجة المنتج قبل الرجوع للصور بالثواني */
  resultSeconds: number;
  showWelcome: boolean;
  welcomeText: string;
  showLogo: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface VisitorProduct {
  name: string;
  price: number;
  unit: string;
  imageUrl: string;
}

export class VisitorDisplayError extends Error {
  code: 'INVALID_INPUT' | 'NOT_FOUND';
  constructor(code: 'INVALID_INPUT' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'VisitorDisplayError';
    this.code = code;
  }
}

export const MAX_VISITOR_SLIDES = 20;

export function defaultVisitorSettings(): VisitorDisplaySettings {
  return { slides: [], slideSeconds: 8, resultSeconds: 10, showWelcome: true, welcomeText: 'مرحبًا بكم — امسح باركود المنتج لمعرفة السعر', showLogo: true, updatedAt: '', updatedBy: '' };
}

let settings: VisitorDisplaySettings = defaultVisitorSettings();

const clampSeconds = (value: unknown, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(60, Math.max(3, n)) : fallback;
};

function normalize(value: any): VisitorDisplaySettings {
  const base = defaultVisitorSettings();
  const source = value && typeof value === 'object' ? value : {};
  const slides: VisitorSlide[] = Array.isArray(source.slides)
    ? source.slides
        .filter((s: any) => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url))
        .slice(0, MAX_VISITOR_SLIDES)
        .map((s: any) => ({ id: String(s.id || `vs-${randomBytes(5).toString('hex')}`), url: String(s.url), path: String(s.path || ''), createdAt: String(s.createdAt || '') }))
    : [];
  return {
    slides,
    slideSeconds: clampSeconds(source.slideSeconds, base.slideSeconds),
    resultSeconds: clampSeconds(source.resultSeconds, base.resultSeconds),
    showWelcome: typeof source.showWelcome === 'boolean' ? source.showWelcome : base.showWelcome,
    welcomeText: typeof source.welcomeText === 'string' ? source.welcomeText.trim().slice(0, 120) : base.welcomeText,
    showLogo: typeof source.showLogo === 'boolean' ? source.showLogo : base.showLogo,
    updatedAt: String(source.updatedAt || ''),
    updatedBy: String(source.updatedBy || '')
  };
}

export function getVisitorSettings(): VisitorDisplaySettings {
  return JSON.parse(JSON.stringify(settings));
}

/** حفظ المدد والنص والشعار (الصور لها دوال منفصلة) */
export function saveVisitorSettings(input: unknown, by: string, now: Date = new Date()): VisitorDisplaySettings {
  if (!input || typeof input !== 'object') throw new VisitorDisplayError('INVALID_INPUT', 'بيانات الإعدادات غير صالحة');
  const source = input as any;
  for (const [field, label] of [['slideSeconds', 'مدة كل صورة'], ['resultSeconds', 'مدة ظهور المنتج']] as const) {
    if (source[field] === undefined) continue;
    const n = Number(source[field]);
    if (!Number.isFinite(n) || n < 3 || n > 60) throw new VisitorDisplayError('INVALID_INPUT', `«${label}» لازم تكون من 3 إلى 60 ثانية`);
  }
  if (source.welcomeText !== undefined && String(source.welcomeText).trim().length > 120) throw new VisitorDisplayError('INVALID_INPUT', 'نص الترحيب أطول من 120 حرفًا');
  settings = normalize({
    ...settings,
    ...(source.slideSeconds !== undefined ? { slideSeconds: source.slideSeconds } : {}),
    ...(source.resultSeconds !== undefined ? { resultSeconds: source.resultSeconds } : {}),
    ...(source.showWelcome !== undefined ? { showWelcome: Boolean(source.showWelcome) } : {}),
    ...(source.welcomeText !== undefined ? { welcomeText: String(source.welcomeText) } : {}),
    ...(source.showLogo !== undefined ? { showLogo: Boolean(source.showLogo) } : {}),
    updatedAt: now.toISOString(),
    updatedBy: String(by || '').slice(0, 80)
  });
  return getVisitorSettings();
}

export function addVisitorSlide(image: { url: string; path: string }, now: Date = new Date()): VisitorSlide {
  if (settings.slides.length >= MAX_VISITOR_SLIDES) throw new VisitorDisplayError('INVALID_INPUT', `الحد الأقصى ${MAX_VISITOR_SLIDES} صورة. احذف صورة قبل إضافة غيرها`);
  if (!/^https?:\/\//.test(String(image.url || ''))) throw new VisitorDisplayError('INVALID_INPUT', 'رابط الصورة غير صالح');
  const slide: VisitorSlide = { id: `vs-${randomBytes(5).toString('hex')}`, url: image.url, path: String(image.path || ''), createdAt: now.toISOString() };
  settings.slides.push(slide);
  return { ...slide };
}

/** يحذف الشريحة ويرجع مسارها في التخزين (لحذف الملف لو لم تعد مستخدمة) */
export function removeVisitorSlide(id: string): { path: string; stillUsed: boolean } {
  const slide = settings.slides.find(s => s.id === id);
  if (!slide) throw new VisitorDisplayError('NOT_FOUND', 'الصورة غير موجودة');
  settings.slides = settings.slides.filter(s => s.id !== id);
  return { path: slide.path, stillUsed: settings.slides.some(s => s.path && s.path === slide.path) };
}

export function reorderVisitorSlides(ids: unknown): VisitorSlide[] {
  if (!Array.isArray(ids)) throw new VisitorDisplayError('INVALID_INPUT', 'ترتيب الصور غير صالح');
  const current = new Map(settings.slides.map(s => [s.id, s]));
  const unique = Array.from(new Set(ids.map(String)));
  if (unique.length !== settings.slides.length || unique.some(id => !current.has(id))) throw new VisitorDisplayError('INVALID_INPUT', 'ترتيب الصور لا يطابق الصور الموجودة');
  settings.slides = unique.map(id => current.get(id)!);
  return getVisitorSettings().slides;
}

// ---------------------------------------------------------------------------
// البحث بالباركود
// ---------------------------------------------------------------------------

const ACTIVE_ITEM = (item: any) => item && !['inactive', 'موقوف', 'مؤرشف'].includes(String(item.status ?? ''));
const normalizeBarcode = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();

/** كل باركودات الصنف: الأساسي والفرعية وسجلات الباركود المفعّلة */
export function itemBarcodes(item: any): string[] {
  const list: unknown[] = [item?.barcode, ...(Array.isArray(item?.secondaryBarcodes) ? item.secondaryBarcodes : [])];
  if (Array.isArray(item?.barcodes)) for (const b of item.barcodes) if (b && b.active !== false) list.push(b.barcode);
  return Array.from(new Set(list.map(normalizeBarcode).filter(Boolean)));
}

/** السعر الذي يدفعه الزبون: لو الأسعار غير شاملة الضريبة تُضاف ضريبة الصنف */
export function customerPrice(item: any, taxInclusive: boolean): number {
  const base = Number(item?.salePrice) || 0;
  const rate = Number(item?.taxRate) || 0;
  const price = taxInclusive || rate <= 0 ? base : base * (1 + rate / 100);
  return Math.round(price * 100) / 100;
}

export function toVisitorProduct(item: any, taxInclusive: boolean): VisitorProduct {
  const printName = String(item?.printName || '').trim();
  return {
    name: printName || String(item?.name || ''),
    price: customerPrice(item, taxInclusive),
    unit: String(item?.unit || ''),
    imageUrl: /^(https?:\/\/|data:image\/)/i.test(String(item?.imageUrl || '')) ? String(item.imageUrl) : ''
  };
}

export function lookupVisitorProduct(barcode: unknown, context: { items: any[]; taxInclusive: boolean }): VisitorProduct | null {
  const wanted = normalizeBarcode(barcode);
  if (!wanted || wanted.length > 64) return null;
  const item = context.items.find(i => ACTIVE_ITEM(i) && itemBarcodes(i).includes(wanted));
  return item ? toVisitorProduct(item, context.taxInclusive) : null;
}

/** نسخة مضغوطة من الأسعار لتعمل الشاشة لو انقطع الاتصال: باركود ← منتج */
export function buildVisitorCatalog(context: { items: any[]; taxInclusive: boolean }): Record<string, VisitorProduct> {
  const catalog: Record<string, VisitorProduct> = {};
  for (const item of context.items) {
    if (!ACTIVE_ITEM(item)) continue;
    const product = toVisitorProduct(item, context.taxInclusive);
    // الصور المحفوظة كنص داخل البيانات لا تدخل النسخة المضغوطة (حجمها كبير)
    if (product.imageUrl.startsWith('data:')) product.imageUrl = '';
    for (const code of itemBarcodes(item)) if (!catalog[code]) catalog[code] = product;
  }
  return catalog;
}

// ---------------------------------------------------------------------------
// الحفظ وإعادة الضبط
// ---------------------------------------------------------------------------

export function getVisitorSettingsCollection(): CollectionDef {
  return {
    name: 'settings.visitorDisplay',
    kind: 'single',
    get: () => settings,
    set: value => {
      settings = normalize(value);
    }
  };
}

/** مع «إعادة ضبط المصنع»: ترجع الإعدادات للافتراضي (ويرجع مسارات الصور لحذفها من التخزين) */
export function resetVisitorSettings(): string[] {
  const paths = settings.slides.map(s => s.path).filter(Boolean);
  settings = defaultVisitorSettings();
  return paths;
}

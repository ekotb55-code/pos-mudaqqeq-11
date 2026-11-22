/**
 * ترقيم فواتير البيع ورقم طلب المنصة — POS مدقق
 * ---------------------------------------------------------------------------
 * رقم الفاتورة تلقائي ومتسلسل بشكل يختاره المالك:
 *   [بادئة][التاريخ][فاصل][العدد][لاحقة]   مثال الافتراضي: INV-20261120-0001
 * بداية العد تتصفّر كل يوم / أسبوع (يبدأ السبت) / شهر / سنة / أبدًا، بتوقيت القاهرة،
 * وزرار «تصفير العدد الآن» يرجّع العدد لرقم البداية.
 * رقم الفاتورة عمره ما يتكرر: لو الرقم المحسوب مستخدم قبل كده (مثلًا شكل بدون تاريخ بعد التصفير)
 * يتعدّاه البرنامج للرقم اللي بعده، لأن رقم الفاتورة هو مفتاح المرتجعات والتحصيل والسجلات.
 *
 * رقم طلب المنصة: خانة اختيارية في فاتورة المنصة لنفس الرقم المكتوب على المنصة،
 * والتكرار على نفس المنصة ممنوع أو مسموح حسب الإعداد.
 *
 * الإعدادات على النسخة كلها بصلاحية settings.invoice_numbering.
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import type { CollectionDef } from './persistence/statePersistence.ts';

export type DatePart = 'none' | 'year' | 'month' | 'day';
export type ResetPeriod = 'never' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface InvoiceNumberingSettings {
  /** نص قبل الرقم (اختياري) مثل INV- */
  prefix: string;
  /** التاريخ في الرقم: none بدون، year = 2026، month = 202611، day = 20261120 */
  datePart: DatePart;
  /** الفاصل بين التاريخ والعدد (لا يظهر لو مفيش تاريخ) */
  separator: '-' | '/' | '';
  /** عدد خانات العدد (أصفار على الشمال): 4 ← 0001 */
  digits: number;
  /** نص بعد الرقم (اختياري) */
  suffix: string;
  /** إمتى العد يرجع لرقم البداية */
  resetPeriod: ResetPeriod;
  /** رقم البداية بعد كل تصفير */
  startAt: number;
  /** رقم طلب المنصة: block = ممنوع يتكرر على نفس المنصة، allow = مسموح */
  platformOrderDuplicates: 'block' | 'allow';
  updatedAt: string;
  updatedBy: string;
}

export interface InvoiceCounterState {
  /** الفترة الحالية للعد (مثلًا 2026-11-20 في اليومي) */
  periodKey: string;
  /** آخر عدد اتستخدم في الفترة دي */
  last: number;
  resetAt: string;
  resetBy: string;
}

export interface ReservedInvoiceNumber {
  number: string;
  periodKey: string;
  count: number;
}

export class InvoiceNumberingError extends Error {
  code: 'INVALID_INPUT';
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceNumberingError';
    this.code = 'INVALID_INPUT';
  }
}

export const MAX_AFFIX_LENGTH = 12;
export const MAX_PLATFORM_ORDER_LENGTH = 60;
const MAX_START = 99999999;
const TIME_ZONE = 'Africa/Cairo';

export function defaultInvoiceNumberingSettings(): InvoiceNumberingSettings {
  return {
    prefix: 'INV-',
    datePart: 'day',
    separator: '-',
    digits: 4,
    suffix: '',
    resetPeriod: 'daily',
    startAt: 1,
    platformOrderDuplicates: 'block',
    updatedAt: '',
    updatedBy: ''
  };
}

function emptyState(): InvoiceCounterState {
  return { periodKey: '', last: 0, resetAt: '', resetBy: '' };
}

let settings: InvoiceNumberingSettings = defaultInvoiceNumberingSettings();
let state: InvoiceCounterState = emptyState();

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const AFFIX_RE = /^[\p{L}\p{N}\-_/.#]*$/u;

function cleanAffix(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text.length <= MAX_AFFIX_LENGTH && AFFIX_RE.test(text) ? text : fallback;
}

function normalize(value: any, base: InvoiceNumberingSettings = defaultInvoiceNumberingSettings()): InvoiceNumberingSettings {
  const source = value && typeof value === 'object' ? value : {};
  const digits = Number(source.digits);
  const startAt = Number(source.startAt);
  return {
    prefix: cleanAffix(source.prefix, base.prefix),
    datePart: oneOf(source.datePart, ['none', 'year', 'month', 'day'] as const, base.datePart),
    separator: oneOf(source.separator, ['-', '/', ''] as const, base.separator),
    digits: Number.isInteger(digits) && digits >= 1 && digits <= 8 ? digits : base.digits,
    suffix: cleanAffix(source.suffix, base.suffix),
    resetPeriod: oneOf(source.resetPeriod, ['never', 'daily', 'weekly', 'monthly', 'yearly'] as const, base.resetPeriod),
    startAt: Number.isInteger(startAt) && startAt >= 1 && startAt <= MAX_START ? startAt : base.startAt,
    platformOrderDuplicates: oneOf(source.platformOrderDuplicates, ['block', 'allow'] as const, base.platformOrderDuplicates),
    updatedAt: String(source.updatedAt ?? base.updatedAt ?? ''),
    updatedBy: String(source.updatedBy ?? base.updatedBy ?? '')
  };
}

function normalizeState(value: any): InvoiceCounterState {
  const source = value && typeof value === 'object' ? value : {};
  const last = Number(source.last);
  return {
    periodKey: String(source.periodKey ?? '').slice(0, 20),
    last: Number.isInteger(last) && last >= 0 ? last : 0,
    resetAt: String(source.resetAt ?? ''),
    resetBy: String(source.resetBy ?? '')
  };
}

// ---------------------------------------------------------------------------
// التاريخ والفترات (بتوقيت القاهرة)
// ---------------------------------------------------------------------------

function cairoParts(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

const pad = (n: number, len: number) => String(n).padStart(len, '0');

/** مفتاح فترة العد: يتغير المفتاح = العد يبدأ من جديد */
export function periodKeyFor(period: ResetPeriod, now: Date): string {
  const { y, m, d } = cairoParts(now);
  if (period === 'never') return 'all';
  if (period === 'yearly') return `${y}`;
  if (period === 'monthly') return `${y}-${pad(m, 2)}`;
  if (period === 'daily') return `${y}-${pad(m, 2)}-${pad(d, 2)}`;
  // أسبوعي: الأسبوع يبدأ السبت. المفتاح = تاريخ السبت
  const day = new Date(Date.UTC(y, m - 1, d));
  const sinceSaturday = (day.getUTCDay() + 1) % 7; // السبت = 0
  day.setUTCDate(day.getUTCDate() - sinceSaturday);
  return `W${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1, 2)}-${pad(day.getUTCDate(), 2)}`;
}

function dateText(part: DatePart, now: Date): string {
  if (part === 'none') return '';
  const { y, m, d } = cairoParts(now);
  if (part === 'year') return `${y}`;
  if (part === 'month') return `${y}${pad(m, 2)}`;
  return `${y}${pad(m, 2)}${pad(d, 2)}`;
}

/** شكل رقم الفاتورة لعدد معين */
export function formatInvoiceNumber(count: number, now: Date, current: InvoiceNumberingSettings = settings): string {
  const date = dateText(current.datePart, now);
  return `${current.prefix}${date}${date ? current.separator : ''}${pad(count, current.digits)}${current.suffix}`;
}

const DATE_RANK: Record<DatePart, number> = { none: 0, year: 1, month: 2, day: 3 };
const RESET_NEEDS: Record<ResetPeriod, number> = { never: 0, yearly: 1, monthly: 2, weekly: 3, daily: 3 };

/** هل التصفير ممكن يطلّع رقم اتستخدم قبل كده؟ (التاريخ في الرقم أقل من فترة التصفير) */
export function numberingMayRepeat(current: InvoiceNumberingSettings = settings): boolean {
  return DATE_RANK[current.datePart] < RESET_NEEDS[current.resetPeriod];
}

// ---------------------------------------------------------------------------
// حجز الرقم وتثبيته
// ---------------------------------------------------------------------------

/**
 * الرقم التالي بدون ما يتغير العد (يتثبت بـ commitInvoiceNumber بعد نجاح الحفظ،
 * عشان الفاتورة المرفوضة ما تعملش فجوة في التسلسل).
 * isUsed: هل الرقم موجود في فاتورة قبل كده.
 */
export function peekInvoiceNumber(now: Date, isUsed: (invoiceNumber: string) => boolean): ReservedInvoiceNumber {
  const periodKey = periodKeyFor(settings.resetPeriod, now);
  let count = (state.periodKey === periodKey ? state.last : settings.startAt - 1) + 1;
  let number = formatInvoiceNumber(count, now);
  let guard = 0;
  while (isUsed(number) && guard < 1000000) {
    count++;
    guard++;
    number = formatInvoiceNumber(count, now);
  }
  return { number, periodKey, count };
}

export function commitInvoiceNumber(reserved: ReservedInvoiceNumber): void {
  if (state.periodKey !== reserved.periodKey || reserved.count > state.last) {
    state = { ...state, periodKey: reserved.periodKey, last: reserved.count };
  }
}

/** زرار «تصفير العدد الآن»: الفاتورة الجاية تبدأ من رقم البداية (أو الرقم المكتوب) */
export function resetInvoiceCounter(input: { startAt?: unknown }, by: string, now: Date = new Date()): InvoiceCounterState {
  let startAt = settings.startAt;
  if (input && input.startAt !== undefined && input.startAt !== null && input.startAt !== '') {
    startAt = Number(input.startAt);
    if (!Number.isInteger(startAt) || startAt < 1 || startAt > MAX_START) throw new InvoiceNumberingError('رقم البداية لازم يكون رقم صحيح من 1 لحد 99999999');
  }
  state = { periodKey: periodKeyFor(settings.resetPeriod, now), last: startAt - 1, resetAt: now.toISOString(), resetBy: String(by || '').slice(0, 80) };
  return getInvoiceCounterState();
}

// ---------------------------------------------------------------------------
// الإعدادات
// ---------------------------------------------------------------------------

export function getInvoiceNumberingSettings(): InvoiceNumberingSettings {
  return { ...settings };
}

export function getInvoiceCounterState(): InvoiceCounterState {
  return { ...state };
}

export function saveInvoiceNumberingSettings(input: unknown, by: string, now: Date = new Date()): InvoiceNumberingSettings {
  if (!input || typeof input !== 'object') throw new InvoiceNumberingError('بيانات الإعدادات غير صالحة');
  const source = input as any;
  for (const [field, label] of [['prefix', 'النص قبل الرقم'], ['suffix', 'النص بعد الرقم']] as const) {
    if (source[field] === undefined) continue;
    const text = String(source[field] ?? '').trim();
    if (text.length > MAX_AFFIX_LENGTH) throw new InvoiceNumberingError(`«${label}» حتى ${MAX_AFFIX_LENGTH} حرفًا`);
    if (!AFFIX_RE.test(text)) throw new InvoiceNumberingError(`«${label}»: حروف وأرقام والرموز - _ / . # فقط، بدون مسافات`);
  }
  const check = (field: string, allowed: readonly unknown[], label: string) => {
    if (source[field] !== undefined && !allowed.includes(source[field])) throw new InvoiceNumberingError(`قيمة غير صحيحة في «${label}»`);
  };
  check('datePart', ['none', 'year', 'month', 'day'], 'التاريخ في الرقم');
  check('separator', ['-', '/', ''], 'الفاصل');
  check('resetPeriod', ['never', 'daily', 'weekly', 'monthly', 'yearly'], 'بداية العد من جديد');
  check('platformOrderDuplicates', ['block', 'allow'], 'تكرار رقم طلب المنصة');
  if (source.digits !== undefined && !(Number.isInteger(Number(source.digits)) && Number(source.digits) >= 1 && Number(source.digits) <= 8)) {
    throw new InvoiceNumberingError('عدد خانات العدد من 1 لحد 8');
  }
  if (source.startAt !== undefined && !(Number.isInteger(Number(source.startAt)) && Number(source.startAt) >= 1 && Number(source.startAt) <= MAX_START)) {
    throw new InvoiceNumberingError('رقم البداية لازم يكون رقم صحيح من 1 لحد 99999999');
  }
  const next = normalize({ ...source, digits: source.digits === undefined ? undefined : Number(source.digits), startAt: source.startAt === undefined ? undefined : Number(source.startAt) }, settings);
  next.updatedAt = now.toISOString();
  next.updatedBy = String(by || '').slice(0, 80);
  const periodChanged = next.resetPeriod !== settings.resetPeriod;
  settings = next;
  // تغيير فترة التصفير: العد يكمل من آخر رقم في الفترة الجديدة (والأرقام المستخدمة تتعدّى تلقائيًا)
  if (periodChanged) state = { ...state, periodKey: periodKeyFor(settings.resetPeriod, now) };
  return getInvoiceNumberingSettings();
}

/** للعرض في صفحة الإعدادات: الإعدادات + العد + شكل الفاتورة الجاية + تنبيه التكرار */
export function describeInvoiceNumbering(now: Date, isUsed: (invoiceNumber: string) => boolean) {
  const preview = peekInvoiceNumber(now, isUsed);
  return {
    settings: getInvoiceNumberingSettings(),
    counter: getInvoiceCounterState(),
    nextNumber: preview.number,
    mayRepeat: numberingMayRepeat(),
    mayRepeatNote: numberingMayRepeat()
      ? 'الرقم مفيهوش تاريخ يكفي فترة التصفير: بعد التصفير الأرقام اللي اتستخدمت قبل كده هتتعدّى تلقائيًا (البرنامج ما بيكررش رقم فاتورة). لو عايز العد يرجع فعلًا من الأول، حط التاريخ في الرقم.'
      : ''
  };
}

// ---------------------------------------------------------------------------
// رقم طلب المنصة
// ---------------------------------------------------------------------------

/** ينظّف الرقم المكتوب: يشيل المسافات الزيادة. الطول الأقصى يتفحص قبلها */
export function normalizePlatformOrderId(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** الفاتورة اللي عليها نفس رقم الطلب على نفس المنصة (غير الملغاة)، أو null */
export function findPlatformOrderDuplicate<T extends { invoiceNumber: string; platform?: string; platformId?: string; platformOrderId?: string; status?: string }>(
  invoices: readonly T[],
  target: { platformId?: string; platformName?: string; orderId: string; exceptInvoiceNumber?: string }
): T | null {
  const wanted = normalizePlatformOrderId(target.orderId).toLowerCase();
  if (!wanted) return null;
  for (const inv of invoices) {
    if (inv.invoiceNumber === target.exceptInvoiceNumber) continue;
    if (inv.status === 'ملغاة') continue;
    if (normalizePlatformOrderId(inv.platformOrderId).toLowerCase() !== wanted) continue;
    const samePlatform = (target.platformId && inv.platformId && inv.platformId === target.platformId) || (target.platformName && inv.platform === target.platformName);
    if (samePlatform) return inv;
  }
  return null;
}

// ---------------------------------------------------------------------------
// الحفظ وإعادة الضبط
// ---------------------------------------------------------------------------

export function getInvoiceNumberingCollection(): CollectionDef {
  return {
    name: 'settings.invoiceNumbering',
    kind: 'single',
    get: () => ({ settings, state }),
    set: value => {
      const source = value && typeof value === 'object' ? (value as any) : {};
      settings = normalize(source.settings);
      state = normalizeState(source.state);
    }
  };
}

/** مع «إعادة ضبط العمليات»: الفواتير اتمسحت، فالعد يبدأ من جديد والشكل يفضل */
export function resetInvoiceCounterState(): void {
  state = emptyState();
}

/** مع «إعادة ضبط المصنع» */
export function resetInvoiceNumbering(): void {
  settings = defaultInvoiceNumberingSettings();
  state = emptyState();
}

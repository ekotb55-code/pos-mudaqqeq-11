/**
 * إعدادات البيع وقواعد السعر — POS مدقق
 * ---------------------------------------------------------------------------
 * إعدادات على النسخة كلها يتحكم فيها المالك (ومن يُمنح الصلاحية settings.sales_rules):
 *   1) افتراضيات شاشة البيع: وضع البيع، المنصة، والعميل — إما قيمة توضع تلقائيًا،
 *      أو «لازم يختار بإيده» (الخانة تفتح فارغة والحفظ يُرفض حتى يختار).
 *   2) قواعد السعر: السماح أو المنع للبيع بسعر صفر، وللبيع بأقل من سعر الشراء.
 *      من معه صلاحية «تجاوز الحد الأدنى للسعر» فقط يتعدى المنع.
 *
 * القيم الافتراضية تساوي سلوك البرنامج قبل هذه الإعدادات (لا يتغير شيء حتى يغيّرها المالك).
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import type { CollectionDef } from './persistence/statePersistence.ts';

export interface SalesRules {
  /** وضع البيع عند فتح شاشة البيع: last = آخر وضع استخدمه المستخدم، direct = بيع مباشر، platform = بيع منصات */
  defaultSaleMode: 'last' | 'direct' | 'platform';
  /** المنصة في بيع المنصات: first = أول منصة نشطة، fixed = المنصة المحددة، manual = لازم يختار بإيده */
  platformSelection: 'first' | 'fixed' | 'manual';
  defaultPlatformId: string;
  /** العميل في البيع المباشر: none = بدون عميل (اختياري)، fixed = العميل المحدد، manual = لازم يختار بإيده */
  customerSelection: 'none' | 'fixed' | 'manual';
  defaultCustomerId: string;
  /** السماح ببيع صنف بسعر صفر */
  allowZeroPriceSale: boolean;
  /** السماح بالبيع بأقل من سعر الشراء */
  allowBelowCostSale: boolean;
  /** بيع المنصات دايمًا آجل على المنصة (لا نقدي ولا جزئي ولا آجل على عميل) — على الكل حتى المالك */
  platformAlwaysCredit: boolean;
  /** السماح بالبيع على منصة (مفتاح مستقل في إعدادات البيع) */
  allowPlatformSale: boolean;
  /** السماح بالبيع المباشر للعميل (مفتاح مستقل في إعدادات البيع) */
  allowDirectSale: boolean;
  /** تفعيل مبيعات ووظائف المنصات (false = إيقاف المنصات مع بقاء البيانات والفواتير التاريخية) */
  platformsEnabled: boolean;
  /** وضع البيع فقط (true = إبقاء البرنامج على البيع المباشر ووحداته الضرورية وإيقاف المنصات) */
  salesOnlyMode: boolean;
  updatedAt: string;
  updatedBy: string;
}

export class SalesRulesError extends Error {
  code: 'INVALID_INPUT';
  constructor(message: string) {
    super(message);
    this.name = 'SalesRulesError';
    this.code = 'INVALID_INPUT';
  }
}

export const DIRECT_SALE_PLATFORM_NAME = 'البيع المباشر';

export function defaultSalesRules(): SalesRules {
  return {
    defaultSaleMode: 'last',
    platformSelection: 'first',
    defaultPlatformId: '',
    customerSelection: 'none',
    defaultCustomerId: '',
    allowZeroPriceSale: true,
    allowBelowCostSale: true,
    platformAlwaysCredit: false,
    allowPlatformSale: true,
    allowDirectSale: true,
    platformsEnabled: true,
    salesOnlyMode: false,
    updatedAt: '',
    updatedBy: ''
  };
}

let rules: SalesRules = defaultSalesRules();

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const isActive = (record: any) => !['inactive', 'موقوف', 'موقوفة', 'معطل', 'معطلة'].includes(String(record?.status ?? ''));

/** يقرأ أي كائن محفوظ أو مُرسَل ويعيده بصيغة سليمة (القيم الناقصة تأخذ الافتراضي) */
function normalize(value: any, base: SalesRules = defaultSalesRules()): SalesRules {
  const source = value && typeof value === 'object' ? value : {};
  const salesOnlyMode = typeof source.salesOnlyMode === 'boolean' ? source.salesOnlyMode : Boolean(base.salesOnlyMode);
  const rawPlatformsEnabled = typeof source.platformsEnabled === 'boolean' ? source.platformsEnabled : (base.platformsEnabled ?? true);
  const platformsEnabled = salesOnlyMode ? false : rawPlatformsEnabled;
  return {
    defaultSaleMode: oneOf(source.defaultSaleMode, ['last', 'direct', 'platform'] as const, base.defaultSaleMode),
    platformSelection: oneOf(source.platformSelection, ['first', 'fixed', 'manual'] as const, base.platformSelection),
    defaultPlatformId: source.defaultPlatformId === undefined ? base.defaultPlatformId : String(source.defaultPlatformId || '').trim().slice(0, 80),
    customerSelection: oneOf(source.customerSelection, ['none', 'fixed', 'manual'] as const, base.customerSelection),
    defaultCustomerId: source.defaultCustomerId === undefined ? base.defaultCustomerId : String(source.defaultCustomerId || '').trim().slice(0, 80),
    allowZeroPriceSale: typeof source.allowZeroPriceSale === 'boolean' ? source.allowZeroPriceSale : base.allowZeroPriceSale,
    allowBelowCostSale: typeof source.allowBelowCostSale === 'boolean' ? source.allowBelowCostSale : base.allowBelowCostSale,
    platformAlwaysCredit: typeof source.platformAlwaysCredit === 'boolean' ? source.platformAlwaysCredit : base.platformAlwaysCredit,
    allowPlatformSale: typeof source.allowPlatformSale === 'boolean' ? source.allowPlatformSale : (base.allowPlatformSale ?? true),
    allowDirectSale: typeof source.allowDirectSale === 'boolean' ? source.allowDirectSale : (base.allowDirectSale ?? true),
    platformsEnabled,
    salesOnlyMode,
    updatedAt: String(source.updatedAt ?? base.updatedAt ?? ''),
    updatedBy: String(source.updatedBy ?? base.updatedBy ?? '')
  };
}

export function getSalesRules(): SalesRules {
  return { ...rules };
}

export function arePlatformsEnabled(): boolean {
  return rules.platformsEnabled !== false && !rules.salesOnlyMode;
}

export function isSalesOnlyMode(): boolean {
  return Boolean(rules.salesOnlyMode);
}

export function isPlatformSaleAllowed(current: SalesRules = rules): boolean {
  return current.platformsEnabled !== false && !current.salesOnlyMode && current.allowPlatformSale !== false;
}

export function isDirectSaleAllowed(current: SalesRules = rules): boolean {
  return current.allowDirectSale !== false;
}

/**
 * الإعدادات كما تحتاجها شاشة البيع: لو المنصة أو العميل المحددان حُذفا أو أُوقفا
 * يتحول الاختيار إلى «لازم يختار بإيده» حتى لا تُفتح الشاشة على قيمة غير صالحة.
 */
export function describeSalesRules(context: { platforms: any[]; customers: any[] }) {
  const current = getSalesRules();
  const effectivePlatformsEnabled = current.platformsEnabled !== false && !current.salesOnlyMode;
  const effectiveAllowPlatformSale = isPlatformSaleAllowed(current);
  const effectiveAllowDirectSale = isDirectSaleAllowed(current);
  const platform = current.platformSelection === 'fixed' ? context.platforms.find(p => String(p.id) === current.defaultPlatformId) : undefined;
  const customer = current.customerSelection === 'fixed' ? context.customers.find(c => String(c.id) === current.defaultCustomerId) : undefined;
  const defaultPlatformMissing = current.platformSelection === 'fixed' && (!platform || !isActive(platform) || String(platform.name) === DIRECT_SALE_PLATFORM_NAME);
  const defaultCustomerMissing = current.customerSelection === 'fixed' && (!customer || !isActive(customer));
  let effectiveSaleMode: 'last' | 'direct' | 'platform' = current.defaultSaleMode;
  if (!effectiveAllowPlatformSale && effectiveAllowDirectSale) {
    effectiveSaleMode = 'direct';
  } else if (effectiveAllowPlatformSale && !effectiveAllowDirectSale) {
    effectiveSaleMode = 'platform';
  } else if (!effectiveAllowPlatformSale && current.defaultSaleMode === 'platform') {
    effectiveSaleMode = 'direct';
  }
  return {
    ...current,
    platformsEnabled: effectivePlatformsEnabled,
    salesOnlyMode: Boolean(current.salesOnlyMode),
    allowPlatformSale: current.allowPlatformSale !== false,
    allowDirectSale: current.allowDirectSale !== false,
    effectiveAllowPlatformSale,
    effectiveAllowDirectSale,
    effectiveSaleMode,
    defaultPlatformName: platform ? String(platform.name || '') : '',
    defaultCustomerName: customer ? String(customer.name || '') : '',
    defaultPlatformMissing,
    defaultCustomerMissing,
    /** ما تطبقه شاشة البيع فعليًا */
    effectivePlatformSelection: defaultPlatformMissing ? ('manual' as const) : current.platformSelection,
    effectiveCustomerSelection: defaultCustomerMissing ? ('manual' as const) : current.customerSelection
  };
}

export function saveSalesRules(input: unknown, context: { platforms: any[]; customers: any[]; by: string; now?: Date }): SalesRules {
  if (!input || typeof input !== 'object') throw new SalesRulesError('بيانات الإعدادات غير صالحة');
  const source = input as any;
  const check = (field: string, allowed: readonly string[], label: string) => {
    if (source[field] !== undefined && !allowed.includes(source[field])) throw new SalesRulesError(`قيمة غير صحيحة في «${label}»`);
  };
  check('defaultSaleMode', ['last', 'direct', 'platform'], 'وضع البيع الافتراضي');
  check('platformSelection', ['first', 'fixed', 'manual'], 'المنصة الافتراضية');
  check('customerSelection', ['none', 'fixed', 'manual'], 'العميل الافتراضي');
  for (const [field, label] of [
    ['allowZeroPriceSale', 'السماح بالبيع بسعر صفر'],
    ['allowBelowCostSale', 'السماح بالبيع بأقل من سعر الشراء'],
    ['platformAlwaysCredit', 'بيع المنصات دايمًا آجل على المنصة'],
    ['allowPlatformSale', 'السماح بالبيع على منصة'],
    ['allowDirectSale', 'السماح بالبيع المباشر للعميل'],
    ['platformsEnabled', 'تفعيل مبيعات ووظائف المنصات'],
    ['salesOnlyMode', 'وضع البيع فقط']
  ] as const) {
    if (source[field] !== undefined && typeof source[field] !== 'boolean') throw new SalesRulesError(`قيمة غير صحيحة في «${label}»`);
  }

  const targetSalesOnly = typeof source.salesOnlyMode === 'boolean' ? source.salesOnlyMode : Boolean(rules.salesOnlyMode);
  if (targetSalesOnly && source.platformsEnabled === true) {
    throw new SalesRulesError('لا يمكن تفعيل مبيعات ووظائف المنصات أثناء تفعيل «وضع البيع فقط»؛ أوقف وضع البيع فقط أولًا.');
  }
  const targetRawPlatformsEnabled = typeof source.platformsEnabled === 'boolean' ? source.platformsEnabled : (rules.platformsEnabled ?? true);
  const targetPlatformsEnabled = targetSalesOnly ? false : targetRawPlatformsEnabled;
  const currentPlatformsActive = rules.platformsEnabled !== false && !rules.salesOnlyMode;
  if (
    !targetPlatformsEnabled &&
    source.allowPlatformSale === true &&
    (!currentPlatformsActive ||
      rules.allowPlatformSale === false ||
      (source.platformsEnabled === undefined && source.salesOnlyMode === undefined))
  ) {
    throw new SalesRulesError(
      targetSalesOnly
        ? 'لا يمكن تفعيل «السماح بالبيع على منصة» أثناء تفعيل «وضع البيع فقط».'
        : 'لا يمكن تفعيل «السماح بالبيع على منصة» أثناء إيقاف مبيعات ووظائف المنصات.'
    );
  }

  const next = normalize(source, rules);
  if (next.salesOnlyMode) {
    next.platformsEnabled = false;
  }

  if (next.platformSelection === 'fixed') {
    if (next.platformsEnabled) {
      const platform = context.platforms.find(p => String(p.id) === next.defaultPlatformId);
      if (!next.defaultPlatformId || !platform) throw new SalesRulesError('اختر المنصة الافتراضية من المنصات الموجودة');
      if (String(platform.name) === DIRECT_SALE_PLATFORM_NAME) throw new SalesRulesError('«البيع المباشر» ليس منصة: اختر منصة أخرى أو اجعل وضع البيع الافتراضي «بيع مباشر»');
      if (!isActive(platform)) throw new SalesRulesError(`المنصة «${platform.name}» موقوفة. اختر منصة نشطة`);
    }
  } else {
    next.defaultPlatformId = '';
  }
  if (next.customerSelection === 'fixed') {
    const customer = context.customers.find(c => String(c.id) === next.defaultCustomerId);
    if (!next.defaultCustomerId || !customer) throw new SalesRulesError('اختر العميل الافتراضي من العملاء الموجودين');
    if (!isActive(customer)) throw new SalesRulesError(`العميل «${customer.name}» موقوف. اختر عميلًا نشطًا`);
  } else {
    next.defaultCustomerId = '';
  }
  next.updatedAt = (context.now || new Date()).toISOString();
  next.updatedBy = String(context.by || '').slice(0, 80);
  rules = next;
  return getSalesRules();
}

// ---------------------------------------------------------------------------
// الفحص عند حفظ الفاتورة
// ---------------------------------------------------------------------------

export interface PriceRuleViolation {
  code: 'ZERO_PRICE' | 'BELOW_COST';
  /** رسالة الرفض للمستخدم */
  message: string;
  /** سبب المراجعة لفواتير الأوفلاين (تُقبل وتُعلَّم) */
  reviewReason: string;
}

const money = (n: number) => String(Math.round(n * 100) / 100);

/**
 * هل سعر بيع القطعة يخالف قواعد السعر؟ يرجع null لو السعر مسموح.
 * الاستثناء لمن معه صلاحية «تجاوز الحد الأدنى للسعر» يطبّقه المستدعي.
 */
export function priceRuleViolation(input: { unitPrice: unknown; purchasePrice: unknown; itemName: string }, current: SalesRules = rules): PriceRuleViolation | null {
  const unitPrice = Number(input.unitPrice);
  const purchasePrice = Number(input.purchasePrice) || 0;
  const name = String(input.itemName || '');
  if (!Number.isFinite(unitPrice)) return null;
  if (!current.allowZeroPriceSale && unitPrice <= 0) {
    return {
      code: 'ZERO_PRICE',
      message: `لا يمكن بيع الصنف "${name}" بسعر صفر: إعدادات البيع تمنع ذلك، ولا تملك صلاحية تجاوز الحد الأدنى للسعر`,
      reviewReason: 'بيع بسعر صفر'
    };
  }
  if (!current.allowBelowCostSale && purchasePrice > 0 && unitPrice < purchasePrice - 0.0001) {
    return {
      code: 'BELOW_COST',
      message: `سعر بيع الصنف "${name}" (${money(unitPrice)} ج.م) أقل من سعر الشراء: إعدادات البيع تمنع ذلك، ولا تملك صلاحية تجاوز الحد الأدنى للسعر`,
      reviewReason: 'بيع بأقل من سعر الشراء'
    };
  }
  return null;
}

/**
 * هل الفاتورة ينقصها اختيار إجباري (العميل في البيع المباشر عند «لازم يختار بإيده»)؟
 * يرجع رسالة الرفض، أو null لو لا شيء ناقص.
 */
export function partyRuleViolation(input: { isPlatformSale: boolean; customerId?: unknown; customerName?: unknown }, current: SalesRules = rules): string | null {
  if (input.isPlatformSale) return null;
  if (current.customerSelection !== 'manual') return null;
  const hasCustomer = Boolean(String(input.customerId ?? '').trim() || String(input.customerName ?? '').trim());
  return hasCustomer ? null : 'اختر العميل أولًا: إعدادات البيع تشترط اختيار عميل لكل فاتورة بيع مباشر';
}

/**
 * «بيع المنصات دايمًا آجل على المنصة»: هل طريقة دفع فاتورة المنصة مخالفة؟
 * يرجع رسالة الرفض، أو null لو مسموح. البيع المباشر لا يتأثر.
 * creditPartyType غير المرسل يُحسب كما يحسبه السيرفر: عميل لو في الفاتورة عميل، وإلا المنصة.
 */
export function platformPaymentViolation(
  input: { isPlatformSale: boolean; paymentType: unknown; creditPartyType?: unknown; customerId?: unknown; customerName?: unknown },
  current: SalesRules = rules
): string | null {
  if (!current.platformAlwaysCredit || !input.isPlatformSale) return null;
  if (String(input.paymentType || '') !== 'آجل') return 'بيع المنصات آجل فقط حسب إعدادات البيع: الفاتورة تتسجل آجل على حساب المنصة';
  const hasCustomer = Boolean(String(input.customerId ?? '').trim() || String(input.customerName ?? '').trim());
  const party = String(input.creditPartyType || '') || (hasCustomer ? 'customer' : 'platform');
  if (party !== 'platform') return 'بيع المنصات آجل على المنصة فقط حسب إعدادات البيع: لا يمكن تسجيله آجل على عميل';
  return null;
}

export interface SaleModeViolation {
  code: 'PLATFORMS_DISABLED' | 'PLATFORM_SALE_DISABLED' | 'DIRECT_SALE_DISABLED' | 'ALL_SALE_MODES_DISABLED';
  message: string;
}

/**
 * فحص السماح بوضع البيع (بيع على منصة / بيع مباشر للعميل) حسب إعدادات البيع الحالية.
 */
export function saleModeViolation(
  input: { isPlatformSale: boolean },
  current: SalesRules = rules
): SaleModeViolation | null {
  const platformAllowed = isPlatformSaleAllowed(current);
  const directAllowed = isDirectSaleAllowed(current);

  if (!platformAllowed && !directAllowed) {
    return {
      code: 'ALL_SALE_MODES_DISABLED',
      message: 'البيع على منصة والبيع المباشر للعميل معطلان حاليًا من إعدادات البيع؛ فعّل وضع بيع واحد على الأقل أولًا'
    };
  }
  if (input.isPlatformSale && !platformAllowed) {
    if (current.platformsEnabled === false || current.salesOnlyMode) {
      return {
        code: 'PLATFORMS_DISABLED',
        message: 'مبيعات ووظائف المنصات معطلة حاليًا من إعدادات النظام؛ لا يمكن تسجيل فواتير منصة'
      };
    }
    return {
      code: 'PLATFORM_SALE_DISABLED',
      message: 'البيع على منصة معطّل حاليًا من إعدادات البيع؛ لا يمكن تسجيل فاتورة منصة'
    };
  }
  if (!input.isPlatformSale && !directAllowed) {
    return {
      code: 'DIRECT_SALE_DISABLED',
      message: 'البيع المباشر للعميل معطّل حاليًا من إعدادات البيع؛ لا يمكن تسجيل فاتورة بيع مباشر'
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// الحفظ وإعادة الضبط
// ---------------------------------------------------------------------------

/** تُضاف إلى قائمة مجموعات الحفظ وقائمة النسخ الاحتياطي في server.ts */
export function getSalesRulesCollection(): CollectionDef {
  return {
    name: 'settings.salesRules',
    kind: 'single',
    get: () => rules,
    set: value => {
      rules = normalize(value);
    }
  };
}

/** مع «إعادة ضبط المصنع»: ترجع الإعدادات للافتراضي */
export function resetSalesRules(): void {
  rules = defaultSalesRules();
}

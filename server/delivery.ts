/**
 * نظام التوصيل — POS مدقق
 * ---------------------------------------------------------------------------
 * للبيع المباشر بس. الفاتورة بتتعمل عادي من شاشة البيع، ولو «توصيل» يتسجل معاها طلب توصيل:
 *   - العنوان والمنطقة من العميل، والرسوم حسب المنطقة (لو «حسب المنطقة» شغال) أو رسوم ثابتة.
 *   - «مدفوع مقدمًا»: الفاتورة بتتدفع عادي (الفلوس في الخزنة من الأول).
 *   - «الدفع عند الاستلام»: الفاتورة بتتسجل آجل على «التوصيل» (مش على عميل ولا منصة)، وما تدخلش الخزنة.
 *     لما الطلب يتسلم تبقى عهدة على الطيار أو مستحقة على شركة الشحن، وتدخل الخزنة بالتسوية بس.
 *   - المخزون بيتخصم وقت الفاتورة. لو الطلب «رجع المحل» أو «اتلغى» البضاعة بترجع بمرتجع رسمي.
 *
 * حالة الطلب: جديد ← خرج للتوصيل ← اتسلم، أو ما اتسلمش (بسبب) ← خرج تاني / رجع المحل / اتلغى.
 * الطلب الجديد ممكن يتلغي على طول. كل تغيير بيتسجل مين عمله وإمتى.
 *
 * الملف ده فيه البيانات والقواعد بس (من غير فلوس ولا مخزون)؛ الحركة على الخزنة والمرتجع
 * في server/deliveryService.ts علشان ما يحصلش استيراد دايري مع sheetsService.
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import { randomBytes } from 'node:crypto';
import type { CollectionDef } from './persistence/statePersistence.ts';

// ---------------------------------------------------------------------------
// الأنواع
// ---------------------------------------------------------------------------

export type DeliveryMode = 'drivers' | 'couriers' | 'both';
export type AssigneeType = 'driver' | 'courier';
export type PaymentMode = 'prepaid' | 'cod';
export type DeliveryStatus = 'جديد' | 'خرج للتوصيل' | 'اتسلم' | 'ما اتسلمش' | 'رجع المحل' | 'اتلغى';

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = ['جديد', 'خرج للتوصيل', 'اتسلم', 'ما اتسلمش', 'رجع المحل', 'اتلغى'];
/** حالات مقفولة: مفيش بعدها تغيير */
export const FINAL_STATUSES: readonly DeliveryStatus[] = ['اتسلم', 'رجع المحل', 'اتلغى'];

export interface DeliveryPrepSlipSettings {
  /** طباعة ورقة تجهيز طلب التوصيل شغالة؟ */
  enabled: boolean;
  /** رقم طلب التحضير */
  showPrepNumber: boolean;
  /** رقم الفاتورة (يظهر فقط لو الفاتورة صدرت فعلًا) */
  showInvoiceNumber: boolean;
  /** اسم العميل */
  showCustomerName: boolean;
  /** هاتف العميل */
  showCustomerPhone: boolean;
  /** أسماء الأصناف */
  showItemNames: boolean;
  /** كميات الأصناف */
  showItemQuantities: boolean;
}

export interface DeliverySettings {
  /** التوصيل شغال؟ لو مقفول شاشة البيع ما يظهرش فيها توصيل والفاتورة بتوصيل بتترفض */
  enabled: boolean;
  /** مين بيوصّل: طيارين بس / شركات شحن بس / الاتنين */
  mode: DeliveryMode;
  /** الرسوم حسب المنطقة (كل زون بسعرها) */
  zonePricing: boolean;
  /** الرسوم الثابتة لما «حسب المنطقة» مقفول */
  fixedFee: number;
  /** أقصى عهدة مع الطيار (0 = من غير حد): لو عدّاها يطلع تنبيه */
  maxDriverCustody: number;
  /** الطلب يبقى «متأخر» لو عدّى عليه أكتر من كام ساعة وهو مفتوح */
  lateAfterHours: number;
  /** إعدادات طباعة ورقة تجهيز طلب التوصيل */
  prepSlip: DeliveryPrepSlipSettings;
  updatedAt: string;
  updatedBy: string;
}

export interface DeliveryZone {
  id: string;
  name: string;
  /** السعر على العميل */
  customerFee: number;
  /** عمولة الطيار على الطلب في المنطقة دي */
  driverCommission: number;
  /** أقل قيمة طلب (قيمة الأصناف من غير رسوم التوصيل). 0 = من غير حد */
  minOrderValue: number;
  active: boolean;
  createdAt: string;
}

export interface DeliveryDriver {
  id: string;
  name: string;
  phone: string;
  /** المرتب الثابت في الشهر (اختياري، 0 = مفيش) */
  monthlySalary: number;
  /** العمولة الثابتة على كل طلب اتسلم (لما «حسب المنطقة» مقفول) */
  commissionPerOrder: number;
  active: boolean;
  /** حساب دخول الطيار (اختياري): مستخدم في البرنامج بصلاحية «طيار» */
  userId: string;
  createdAt: string;
}

export interface DeliveryCourier {
  id: string;
  name: string;
  /** رسوم الشركة على كل طلب اتسلم (بتتخصم وقت التسوية) */
  feePerOrder: number;
  active: boolean;
  createdAt: string;
}

export interface DeliveryStatusEntry {
  status: DeliveryStatus;
  at: string;
  byId: string;
  byName: string;
  note: string;
}

export interface DeliveryOrder {
  id: string;
  /** رقم الطلب الظاهر: DLV-000001 */
  number: string;
  invoiceNumber: string;
  createdAt: string;
  createdBy: string;
  customerId: string;
  customerName: string;
  phone: string;
  address: string;
  zoneId: string;
  zoneName: string;
  /** عمولة الطيار في المنطقة وقت الطلب (لو «حسب المنطقة» شغال) */
  zoneCommission: number;
  /** رسوم التوصيل على العميل */
  fee: number;
  /** الرسوم اتعدلت يدويًا على الفاتورة */
  feeManual: boolean;
  paymentMode: PaymentMode;
  /** قيمة الفاتورة كاملة (الأصناف + التوصيل) */
  invoiceTotal: number;
  /** المطلوب تحصيله من العميل عند الاستلام (0 لو مدفوع مقدمًا) */
  amountDue: number;
  assigneeType: AssigneeType | '';
  assigneeId: string;
  assigneeName: string;
  /** رقم البوليصة (شركات الشحن) */
  trackingNumber: string;
  status: DeliveryStatus;
  failReason: string;
  log: DeliveryStatusEntry[];
  outAt: string;
  deliveredAt: string;
  closedAt: string;
  /** عمولة الطيار على الطلب ده (بتتحدد لما يتسلم) */
  commission: number;
  /** رسوم شركة الشحن على الطلب ده (بتتحدد لما يتسلم) */
  courierFee: number;
  /** التسوية اللي دخّلت فلوس الطلب الخزنة */
  settlementId: string;
  /** صرف العمولة */
  payoutId: string;
  /** المرتجع الرسمي لما الطلب يرجع أو يتلغي */
  returnNumber: string;
  /** معرّف طلب تحضير التوصيل المرتبط (إن وجد) */
  preparationId?: string;
  /** رقم طلب تحضير التوصيل المرتبط (PRP-...) */
  preparationNumber?: string;
}

export type DeliveryPreparationStatus = 'قيد التحضير' | 'جاري الشحن' | 'خرج للتوصيل' | 'اتلغى';

export interface DeliveryPreparationLine {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface DeliveryPreparationOrder {
  id: string;
  number: string;
  status: DeliveryPreparationStatus;
  revision: number;
  idempotencyKey: string;
  createdAt: string;
  createdBy: string;
  createdById: string;
  updatedAt: string;
  updatedBy: string;
  updatedById: string;
  cancelledAt: string;
  cancelledBy: string;
  cancelledById: string;
  cancelReason: string;
  customerId: string;
  customerName: string;
  phone: string;
  address: string;
  zoneId: string;
  zoneName: string;
  zoneCommission: number;
  fee: number;
  feeManual: boolean;
  paymentMode: PaymentMode;
  assigneeType: AssigneeType | '';
  assigneeId: string;
  assigneeName: string;
  trackingNumber: string;
  notes: string;
  lines: DeliveryPreparationLine[];
  itemsSubtotal: number;
  estimatedTotal: number;
  invoiceNumber: string;
  deliveryOrderId: string;
  deliveryOrderNumber: string;
  dispatchedAt: string;
  dispatchedBy: string;
  dispatchedById: string;
  dispatchIdempotencyKey: string;
}

export interface DeliverySettlement {
  id: string;
  number: string;
  at: string;
  byId: string;
  byName: string;
  assigneeType: AssigneeType;
  assigneeId: string;
  assigneeName: string;
  orderIds: string[];
  invoiceNumbers: string[];
  /** مجموع المطلوب تحصيله من العملاء */
  collected: number;
  /** رسوم شركة الشحن المخصومة */
  courierFees: number;
  /** المفروض يتسلم = المحصل − رسوم الشركة */
  expected: number;
  /** اللي اتسلم فعلًا */
  received: number;
  /** العجز = المفروض − اللي اتسلم (سالب = زيادة) */
  shortage: number;
  cashboxId: string;
  cashboxName: string;
  note: string;
}

export interface DriverPayout {
  id: string;
  number: string;
  at: string;
  byId: string;
  byName: string;
  driverId: string;
  driverName: string;
  /** المرتب المصروف */
  salary: number;
  /** العمولة المصروفة (عمولة الطلبات المرتبطة) */
  commission: number;
  /** العجز اللي اتخصم من المستحق */
  shortageDeducted: number;
  /** المصروف فعلًا من الخزنة = المرتب + العمولة − العجز المخصوم */
  paid: number;
  orderIds: string[];
  cashboxId: string;
  cashboxName: string;
  note: string;
}

export interface DeliveryActor {
  userId?: string;
  name?: string;
  username?: string;
  phone?: string;
  role?: string;
  isOwner?: boolean;
  permissions?: string[];
}

export class DeliveryError extends Error {
  code: string;
  statusCode: number;
  constructor(message: string, code = 'INVALID_INPUT', statusCode = 400) {
    super(message);
    this.name = 'DeliveryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// الحالة
// ---------------------------------------------------------------------------

const MAX_NAME = 80;
const MAX_TEXT = 300;
const MAX_MONEY = 10_000_000;

export function defaultPrepSlipSettings(): DeliveryPrepSlipSettings {
  return {
    enabled: true,
    showPrepNumber: true,
    showInvoiceNumber: false,
    showCustomerName: true,
    showCustomerPhone: true,
    showItemNames: true,
    showItemQuantities: true
  };
}

export function defaultDeliverySettings(): DeliverySettings {
  return {
    enabled: false,
    mode: 'drivers',
    zonePricing: false,
    fixedFee: 0,
    maxDriverCustody: 0,
    lateAfterHours: 3,
    prepSlip: defaultPrepSlipSettings(),
    updatedAt: '',
    updatedBy: ''
  };
}

interface ConfigState {
  settings: DeliverySettings;
  zones: DeliveryZone[];
  drivers: DeliveryDriver[];
  couriers: DeliveryCourier[];
}
interface OperationsState {
  orders: DeliveryOrder[];
  settlements: DeliverySettlement[];
  payouts: DriverPayout[];
  /** آخر رقم طلب / تسوية / صرف / تحضير */
  counters: { order: number; settlement: number; payout: number; preparation: number };
  /** مفاتيح عدم التكرار للتسوية والصرف والتحضير: المفتاح ← رقم المستند */
  doneKeys: Record<string, string>;
}

let config: ConfigState = { settings: defaultDeliverySettings(), zones: [], drivers: [], couriers: [] };
let ops: OperationsState = emptyOps();
let preparations: DeliveryPreparationOrder[] = [];

function emptyOps(): OperationsState {
  return {
    orders: [],
    settlements: [],
    payouts: [],
    counters: { order: 0, settlement: 0, payout: 0, preparation: 0 },
    doneKeys: {}
  };
}

// ---------------------------------------------------------------------------
// أدوات
// ---------------------------------------------------------------------------

export const r2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

function text(v: unknown, max = MAX_TEXT): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function money(v: unknown, label: string, fallback = 0): number {
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) throw new DeliveryError(`${label}: لازم رقم من 0 أو أكتر`);
  return r2(n);
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function actorName(a?: DeliveryActor): string {
  return text(a?.name || a?.username || a?.phone || 'المسؤول', MAX_NAME);
}

function pad(n: number): string {
  return String(n).padStart(6, '0');
}

export function hasDeliveryPermission(actor: DeliveryActor | undefined, perm: string): boolean {
  if (!actor) return false;
  if (actor.role === 'designer' || actor.isOwner) return true;
  return Array.isArray(actor.permissions) && actor.permissions.includes(perm);
}

function normalizePrepSlipSettings(
  source: any,
  base: DeliveryPrepSlipSettings = defaultPrepSlipSettings()
): DeliveryPrepSlipSettings {
  const p = source && typeof source === 'object' ? source : {};
  return {
    enabled: bool(p.enabled, base.enabled),
    showPrepNumber: bool(p.showPrepNumber, base.showPrepNumber),
    showInvoiceNumber: bool(p.showInvoiceNumber, base.showInvoiceNumber),
    showCustomerName: bool(p.showCustomerName, base.showCustomerName),
    showCustomerPhone: bool(p.showCustomerPhone, base.showCustomerPhone),
    showItemNames: bool(p.showItemNames, base.showItemNames),
    showItemQuantities: bool(p.showItemQuantities, base.showItemQuantities)
  };
}

function normalizeSettings(source: any, base: DeliverySettings = defaultDeliverySettings()): DeliverySettings {
  const s = source && typeof source === 'object' ? source : {};
  const mode = ['drivers', 'couriers', 'both'].includes(s.mode) ? s.mode : base.mode;
  const late = Number(s.lateAfterHours);
  return {
    enabled: bool(s.enabled, base.enabled),
    mode,
    zonePricing: bool(s.zonePricing, base.zonePricing),
    fixedFee: Number.isFinite(Number(s.fixedFee)) && Number(s.fixedFee) >= 0 ? r2(Number(s.fixedFee)) : base.fixedFee,
    maxDriverCustody:
      Number.isFinite(Number(s.maxDriverCustody)) && Number(s.maxDriverCustody) >= 0 ? r2(Number(s.maxDriverCustody)) : base.maxDriverCustody,
    lateAfterHours: Number.isFinite(late) && late >= 1 && late <= 720 ? Math.round(late) : base.lateAfterHours,
    prepSlip: normalizePrepSlipSettings(s.prepSlip, base.prepSlip || defaultPrepSlipSettings()),
    updatedAt: String(s.updatedAt ?? base.updatedAt),
    updatedBy: String(s.updatedBy ?? base.updatedBy)
  };
}

// ---------------------------------------------------------------------------
// الإعدادات والمناطق والطيارين وشركات الشحن
// ---------------------------------------------------------------------------

export function getDeliverySettings(): DeliverySettings {
  return {
    ...config.settings,
    prepSlip: { ...(config.settings.prepSlip || defaultPrepSlipSettings()) }
  };
}

export function saveDeliverySettings(input: any, by: string, now: Date = new Date()): DeliverySettings {
  const src = input && typeof input === 'object' ? input : {};
  if (src.mode !== undefined && !['drivers', 'couriers', 'both'].includes(src.mode)) {
    throw new DeliveryError('مين بيوصّل: اختار «طيارين بس» أو «شركات شحن بس» أو «الاتنين»');
  }
  const fixedFee = money(src.fixedFee, 'رسوم التوصيل الثابتة', config.settings.fixedFee);
  const maxDriverCustody = money(src.maxDriverCustody, 'أقصى عهدة مع الطيار', config.settings.maxDriverCustody);
  if (src.lateAfterHours !== undefined) {
    const late = Number(src.lateAfterHours);
    if (!Number.isInteger(late) || late < 1 || late > 720) throw new DeliveryError('الطلب يبقى متأخر بعد: عدد ساعات من 1 لـ 720');
  }
  const nextPrepSlip =
    src.prepSlip && typeof src.prepSlip === 'object'
      ? normalizePrepSlipSettings(src.prepSlip, config.settings.prepSlip || defaultPrepSlipSettings())
      : config.settings.prepSlip || defaultPrepSlipSettings();
  config.settings = normalizeSettings(
    {
      ...config.settings,
      ...src,
      fixedFee,
      maxDriverCustody,
      prepSlip: nextPrepSlip,
      updatedAt: now.toISOString(),
      updatedBy: text(by, MAX_NAME)
    },
    config.settings
  );
  return getDeliverySettings();
}

export function listZones(): DeliveryZone[] {
  return config.zones.map(z => ({ ...z }));
}
export function listDrivers(): DeliveryDriver[] {
  return config.drivers.map(d => ({ ...d }));
}
export function listCouriers(): DeliveryCourier[] {
  return config.couriers.map(c => ({ ...c }));
}

function uniqueName<T extends { id: string; name: string }>(list: T[], name: string, id: string, label: string) {
  const key = name.toLowerCase();
  if (list.some(x => x.id !== id && x.name.toLowerCase() === key)) throw new DeliveryError(`${label} «${name}» موجود قبل كده`);
}

export function saveZone(input: any, now: Date = new Date()): DeliveryZone {
  const src = input && typeof input === 'object' ? input : {};
  const existing = src.id ? config.zones.find(z => z.id === src.id) : undefined;
  if (src.id && !existing) throw new DeliveryError('المنطقة مش موجودة', 'NOT_FOUND', 404);
  const name = text(src.name ?? existing?.name, MAX_NAME);
  if (!name) throw new DeliveryError('اكتب اسم المنطقة');
  uniqueName(config.zones, name, existing?.id || '', 'المنطقة');
  const zone: DeliveryZone = {
    id: existing?.id || newId('zone'),
    name,
    customerFee: money(src.customerFee, 'سعر التوصيل على العميل', existing?.customerFee ?? 0),
    driverCommission: money(src.driverCommission, 'عمولة الطيار', existing?.driverCommission ?? 0),
    minOrderValue: money(src.minOrderValue, 'أقل قيمة طلب', existing?.minOrderValue ?? 0),
    active: bool(src.active, existing?.active ?? true),
    createdAt: existing?.createdAt || now.toISOString()
  };
  if (existing) Object.assign(existing, zone);
  else config.zones.push(zone);
  return { ...zone };
}

export function saveDriver(input: any, userExists: (userId: string) => boolean, now: Date = new Date()): DeliveryDriver {
  const src = input && typeof input === 'object' ? input : {};
  const existing = src.id ? config.drivers.find(d => d.id === src.id) : undefined;
  if (src.id && !existing) throw new DeliveryError('الطيار مش موجود', 'NOT_FOUND', 404);
  const name = text(src.name ?? existing?.name, MAX_NAME);
  if (!name) throw new DeliveryError('اكتب اسم الطيار');
  uniqueName(config.drivers, name, existing?.id || '', 'الطيار');
  const phone = text(src.phone ?? existing?.phone, 30);
  const userId = text(src.userId ?? existing?.userId, 100);
  if (userId) {
    if (!userExists(userId)) throw new DeliveryError('حساب الدخول المختار مش موجود');
    if (config.drivers.some(d => d.id !== existing?.id && d.userId === userId)) {
      throw new DeliveryError('حساب الدخول ده مربوط بطيار تاني');
    }
  }
  const driver: DeliveryDriver = {
    id: existing?.id || newId('drv'),
    name,
    phone,
    monthlySalary: money(src.monthlySalary, 'المرتب الثابت', existing?.monthlySalary ?? 0),
    commissionPerOrder: money(src.commissionPerOrder, 'العمولة على الطلب', existing?.commissionPerOrder ?? 0),
    active: bool(src.active, existing?.active ?? true),
    userId,
    createdAt: existing?.createdAt || now.toISOString()
  };
  if (existing) Object.assign(existing, driver);
  else config.drivers.push(driver);
  return { ...driver };
}

export function saveCourier(input: any, now: Date = new Date()): DeliveryCourier {
  const src = input && typeof input === 'object' ? input : {};
  const existing = src.id ? config.couriers.find(c => c.id === src.id) : undefined;
  if (src.id && !existing) throw new DeliveryError('شركة الشحن مش موجودة', 'NOT_FOUND', 404);
  const name = text(src.name ?? existing?.name, MAX_NAME);
  if (!name) throw new DeliveryError('اكتب اسم شركة الشحن');
  uniqueName(config.couriers, name, existing?.id || '', 'شركة الشحن');
  const courier: DeliveryCourier = {
    id: existing?.id || newId('cour'),
    name,
    feePerOrder: money(src.feePerOrder, 'رسوم الشركة على الطلب', existing?.feePerOrder ?? 0),
    active: bool(src.active, existing?.active ?? true),
    createdAt: existing?.createdAt || now.toISOString()
  };
  if (existing) Object.assign(existing, courier);
  else config.couriers.push(courier);
  return { ...courier };
}

export function findDriverByUserId(userId: string | undefined): DeliveryDriver | undefined {
  if (!userId) return undefined;
  return config.drivers.find(d => d.userId === userId);
}

function modeAllows(type: AssigneeType): boolean {
  const mode = config.settings.mode;
  return mode === 'both' || (mode === 'drivers' ? type === 'driver' : type === 'courier');
}

function resolveAssignee(type: unknown, id: unknown): { type: AssigneeType; id: string; name: string } {
  const t = String(type || '');
  if (t !== 'driver' && t !== 'courier') throw new DeliveryError('اختار طيار أو شركة شحن');
  if (!modeAllows(t)) {
    throw new DeliveryError(t === 'driver' ? 'إعدادات التوصيل: التوصيل بشركات الشحن بس' : 'إعدادات التوصيل: التوصيل بالطيارين بس');
  }
  if (t === 'driver') {
    const d = config.drivers.find(x => x.id === id);
    if (!d) throw new DeliveryError('الطيار المختار مش موجود');
    if (!d.active) throw new DeliveryError(`الطيار «${d.name}» موقوف`);
    return { type: t, id: d.id, name: d.name };
  }
  const c = config.couriers.find(x => x.id === id);
  if (!c) throw new DeliveryError('شركة الشحن المختارة مش موجودة');
  if (!c.active) throw new DeliveryError(`شركة الشحن «${c.name}» موقوفة`);
  return { type: t, id: c.id, name: c.name };
}

// ---------------------------------------------------------------------------
// تجهيز طلب التوصيل مع الفاتورة
// ---------------------------------------------------------------------------

export interface DeliveryPlan {
  paymentMode: PaymentMode;
  fee: number;
  feeManual: boolean;
  zoneId: string;
  zoneName: string;
  zoneCommission: number;
  minOrderValue: number;
  customerId: string;
  customerName: string;
  phone: string;
  address: string;
  assignee: { type: AssigneeType; id: string; name: string } | null;
  trackingNumber: string;
  preparationId?: string;
  preparationNumber?: string;
}

export interface PrepareContext {
  isDirectSale: boolean;
  actor?: DeliveryActor;
  /** عميل الفاتورة (لو متسجل) علشان العنوان والمنطقة والموبايل */
  customer?: { id: string; name: string; phone?: string; address?: string; city?: string; zoneId?: string } | null;
  customerName?: string;
}

/** الرسوم المحسوبة (من غير تعديل يدوي) */
export function computeDeliveryFee(zoneId?: string): { fee: number; zone: DeliveryZone | null } {
  if (!config.settings.zonePricing) return { fee: config.settings.fixedFee, zone: null };
  const zone = config.zones.find(z => z.id === zoneId) || null;
  return { fee: zone ? zone.customerFee : 0, zone };
}

/**
 * التحقق من بيانات التوصيل قبل ما الفاتورة تلمس المخزون أو الخزنة. بيرمي DeliveryError.
 * input = invoicePayload.delivery: { paymentMode, address, zoneId, phone, fee, assigneeType, assigneeId, trackingNumber }
 */
export function prepareDeliveryPlan(input: any, ctx: PrepareContext): DeliveryPlan {
  const s = config.settings;
  if (!s.enabled) throw new DeliveryError('التوصيل مقفول من إعدادات التوصيل', 'DELIVERY_DISABLED');
  if (!ctx.isDirectSale) throw new DeliveryError('التوصيل للبيع المباشر بس', 'DELIVERY_DIRECT_ONLY');
  const src = input && typeof input === 'object' ? input : {};
  const paymentMode = src.paymentMode === 'cod' ? 'cod' : src.paymentMode === 'prepaid' ? 'prepaid' : '';
  if (!paymentMode) throw new DeliveryError('اختار «مدفوع مقدمًا» أو «الدفع عند الاستلام»');

  const cust = ctx.customer || null;
  const address = text(src.address ?? cust?.address ?? '', MAX_TEXT);
  if (!address) throw new DeliveryError('اكتب عنوان التوصيل');
  const phone = text(src.phone ?? cust?.phone ?? '', 30);

  let zone: DeliveryZone | null = null;
  if (s.zonePricing) {
    const zoneId = String(src.zoneId ?? cust?.zoneId ?? '');
    zone = config.zones.find(z => z.id === zoneId) || null;
    if (!zone) throw new DeliveryError('اختار منطقة التوصيل');
    if (!zone.active) throw new DeliveryError(`المنطقة «${zone.name}» موقوفة`);
  }
  const computed = zone ? zone.customerFee : s.fixedFee;
  let fee = computed;
  let feeManual = false;
  if (src.fee !== undefined && src.fee !== null && String(src.fee).trim() !== '') {
    const requested = money(src.fee, 'رسوم التوصيل');
    if (Math.abs(requested - computed) >= 0.01) {
      if (!src.preserveManualFee && !hasDeliveryPermission(ctx.actor, 'delivery.edit_fee')) {
        throw new DeliveryError('مش مسموحلك تعدّل رسوم التوصيل على الفاتورة', 'DELIVERY_FEE_FORBIDDEN', 403);
      }
      fee = requested;
      feeManual = true;
    }
  }

  let assignee: DeliveryPlan['assignee'] = null;
  if (src.assigneeType || src.assigneeId) assignee = resolveAssignee(src.assigneeType, src.assigneeId);

  const preparationId = text(src.preparationId, 100);
  const preparationNumber = text(src.preparationNumber, 60);

  return {
    paymentMode,
    fee,
    feeManual,
    zoneId: zone?.id || '',
    zoneName: zone?.name || '',
    zoneCommission: zone?.driverCommission || 0,
    minOrderValue: zone?.minOrderValue || 0,
    customerId: cust?.id || '',
    customerName: text(cust?.name || ctx.customerName || '', MAX_NAME),
    phone,
    address,
    assignee,
    trackingNumber: assignee?.type === 'courier' ? text(src.trackingNumber, 60) : '',
    ...(preparationId ? { preparationId } : {}),
    ...(preparationNumber ? { preparationNumber } : {})
  };
}

/** بعد حساب الفاتورة: أقل قيمة طلب للمنطقة (قيمة الأصناف من غير رسوم التوصيل) */
export function checkPlanTotals(plan: DeliveryPlan, itemsTotal: number): void {
  if (plan.minOrderValue > 0 && r2(itemsTotal) + 0.001 < plan.minOrderValue) {
    throw new DeliveryError(`أقل قيمة طلب لمنطقة «${plan.zoneName}» هي ${plan.minOrderValue} ج.م (الطلب ${r2(itemsTotal)} ج.م)`, 'DELIVERY_MIN_ORDER');
  }
}

/** بيتنادي بعد حفظ الفاتورة: يسجل طلب التوصيل */
export function createOrderForInvoice(
  plan: DeliveryPlan,
  invoice: { invoiceNumber: string; total: number; preparationId?: string; preparationNumber?: string },
  actor?: DeliveryActor,
  now: Date = new Date()
): DeliveryOrder {
  ops.counters.order += 1;
  const at = now.toISOString();
  const by = actorName(actor);
  const preparationId = text(invoice.preparationId || plan.preparationId, 100);
  const preparationNumber = text(invoice.preparationNumber || plan.preparationNumber, 60);
  const order: DeliveryOrder = {
    id: newId('dlv'),
    number: `DLV-${pad(ops.counters.order)}`,
    invoiceNumber: invoice.invoiceNumber,
    createdAt: at,
    createdBy: by,
    customerId: plan.customerId,
    customerName: plan.customerName,
    phone: plan.phone,
    address: plan.address,
    zoneId: plan.zoneId,
    zoneName: plan.zoneName,
    zoneCommission: plan.zoneCommission,
    fee: plan.fee,
    feeManual: plan.feeManual,
    paymentMode: plan.paymentMode,
    invoiceTotal: r2(invoice.total),
    amountDue: plan.paymentMode === 'cod' ? r2(invoice.total) : 0,
    assigneeType: plan.assignee?.type || '',
    assigneeId: plan.assignee?.id || '',
    assigneeName: plan.assignee?.name || '',
    trackingNumber: plan.trackingNumber,
    status: 'جديد',
    failReason: '',
    log: [{ status: 'جديد', at, byId: String(actor?.userId || ''), byName: by, note: plan.feeManual ? `رسوم التوصيل اتعدلت يدويًا: ${plan.fee} ج.م` : '' }],
    outAt: '',
    deliveredAt: '',
    closedAt: '',
    commission: 0,
    courierFee: 0,
    settlementId: '',
    payoutId: '',
    returnNumber: '',
    ...(preparationId ? { preparationId } : {}),
    ...(preparationNumber ? { preparationNumber } : {})
  };
  ops.orders.unshift(order);
  return { ...order };
}

/** ربط طلب التوصيل بطلب التحضير المرتبط به بشكل حتمي دون إنشاء سجل توصيل ثانٍ */
export function linkOrderToPreparation(
  orderIdOrInvoiceNumber: string,
  prep: { id: string; number: string }
): DeliveryOrder | undefined {
  const key = String(orderIdOrInvoiceNumber || '').trim();
  if (!key) return undefined;
  const o = ops.orders.find(x => x.id === key || x.number === key || x.invoiceNumber === key);
  if (!o) return undefined;
  o.preparationId = text(prep.id, 100);
  o.preparationNumber = text(prep.number, 60);
  return getOrder(o.id);
}

// ---------------------------------------------------------------------------
// الحفظ وإعادة الضبط
// ---------------------------------------------------------------------------

function normalizeConfig(v: any): ConfigState {
  const src = v && typeof v === 'object' ? v : {};
  return {
    settings: normalizeSettings(src.settings),
    zones: Array.isArray(src.zones) ? src.zones : [],
    drivers: Array.isArray(src.drivers) ? src.drivers : [],
    couriers: Array.isArray(src.couriers) ? src.couriers : []
  };
}
function normalizeOps(v: any): OperationsState {
  const src = v && typeof v === 'object' ? v : {};
  const c = src.counters && typeof src.counters === 'object' ? src.counters : {};
  return {
    orders: Array.isArray(src.orders) ? src.orders : [],
    settlements: Array.isArray(src.settlements) ? src.settlements : [],
    payouts: Array.isArray(src.payouts) ? src.payouts : [],
    counters: {
      order: Number(c.order) || 0,
      settlement: Number(c.settlement) || 0,
      payout: Number(c.payout) || 0,
      preparation: Number(c.preparation) || 0
    },
    doneKeys: src.doneKeys && typeof src.doneKeys === 'object' ? src.doneKeys : {}
  };
}

function normalizePreparationLine(raw: any): DeliveryPreparationLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const itemId = text(raw.itemId, 100);
  if (!itemId) return null;
  const quantity = Math.round((Number(raw.quantity) || 0) * 1000) / 1000;
  if (!(quantity > 0)) return null;
  const unitPrice = r2(Number(raw.unitPrice) || 0);
  const lineTotal = r2(Number(raw.lineTotal) ?? quantity * unitPrice);
  return {
    itemId,
    itemName: text(raw.itemName || itemId, MAX_NAME),
    unit: text(raw.unit || 'قطعة', 40),
    quantity,
    unitPrice,
    lineTotal
  };
}

function normalizePreparationOrder(raw: any): DeliveryPreparationOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id, 100);
  const number = text(raw.number, 60);
  if (!id || !number) return null;
  const lines = Array.isArray(raw.lines)
    ? (raw.lines.map(normalizePreparationLine).filter(Boolean) as DeliveryPreparationLine[])
    : [];
  const itemsSubtotal = r2(
    Number.isFinite(Number(raw.itemsSubtotal))
      ? Number(raw.itemsSubtotal)
      : lines.reduce((s, l) => s + l.lineTotal, 0)
  );
  const fee = r2(Number(raw.fee) || 0);
  const status: DeliveryPreparationStatus =
    raw.status === 'اتلغى'
      ? 'اتلغى'
      : raw.status === 'خرج للتوصيل'
        ? 'خرج للتوصيل'
        : raw.status === 'جاري الشحن'
          ? 'جاري الشحن'
          : 'قيد التحضير';
  const revision = Math.max(1, Math.floor(Number(raw.revision) || 1));
  return {
    id,
    number,
    status,
    revision,
    idempotencyKey: text(raw.idempotencyKey, 120),
    createdAt: String(raw.createdAt || ''),
    createdBy: text(raw.createdBy, MAX_NAME),
    createdById: text(raw.createdById, 100),
    updatedAt: String(raw.updatedAt || raw.createdAt || ''),
    updatedBy: text(raw.updatedBy || raw.createdBy, MAX_NAME),
    updatedById: text(raw.updatedById || raw.createdById, 100),
    cancelledAt: String(raw.cancelledAt || ''),
    cancelledBy: text(raw.cancelledBy, MAX_NAME),
    cancelledById: text(raw.cancelledById, 100),
    cancelReason: text(raw.cancelReason, MAX_TEXT),
    customerId: text(raw.customerId, 100),
    customerName: text(raw.customerName, MAX_NAME),
    phone: text(raw.phone, 30),
    address: text(raw.address, MAX_TEXT),
    zoneId: text(raw.zoneId, 100),
    zoneName: text(raw.zoneName, MAX_NAME),
    zoneCommission: r2(Number(raw.zoneCommission) || 0),
    fee,
    feeManual: Boolean(raw.feeManual),
    paymentMode: raw.paymentMode === 'prepaid' ? 'prepaid' : 'cod',
    assigneeType: raw.assigneeType === 'driver' || raw.assigneeType === 'courier' ? raw.assigneeType : '',
    assigneeId: text(raw.assigneeId, 100),
    assigneeName: text(raw.assigneeName, MAX_NAME),
    trackingNumber: text(raw.trackingNumber, 60),
    notes: text(raw.notes, MAX_TEXT),
    lines,
    itemsSubtotal,
    estimatedTotal: r2(itemsSubtotal + fee),
    invoiceNumber: text(raw.invoiceNumber, 80),
    deliveryOrderId: text(raw.deliveryOrderId, 100),
    deliveryOrderNumber: text(raw.deliveryOrderNumber, 60),
    dispatchedAt: String(raw.dispatchedAt || ''),
    dispatchedBy: text(raw.dispatchedBy, MAX_NAME),
    dispatchedById: text(raw.dispatchedById, 100),
    dispatchIdempotencyKey: text(raw.dispatchIdempotencyKey, 120)
  };
}

function normalizePreparations(v: any): DeliveryPreparationOrder[] {
  if (!Array.isArray(v)) return [];
  return v.map(normalizePreparationOrder).filter(Boolean) as DeliveryPreparationOrder[];
}

/** الإعدادات والمناطق والطيارين والشركات (بتفضل في إعادة ضبط العمليات) + الطلبات والتسويات وطلبات التحضير (بتتمسح) */
export function getDeliveryCollections(): CollectionDef[] {
  return [
    {
      name: 'delivery.config',
      kind: 'single',
      get: () => config,
      set: value => {
        config = normalizeConfig(value);
      }
    },
    {
      name: 'delivery.operations',
      kind: 'single',
      get: () => ops,
      set: value => {
        ops = normalizeOps(value);
      }
    },
    {
      name: 'delivery.preparations',
      kind: 'list',
      idOf: (doc: any) => doc?.id,
      get: () => preparations,
      set: value => {
        preparations = normalizePreparations(value);
      }
    }
  ];
}

/** مع «إعادة ضبط العمليات»: الطلبات والتسويات والصرف وطلبات التحضير تتمسح، والإعدادات والأسماء تفضل */
export function resetDeliveryOperations(): void {
  ops = emptyOps();
  preparations = [];
}

/** مع «إعادة ضبط المصنع» */
export function resetDelivery(): void {
  config = { settings: defaultDeliverySettings(), zones: [], drivers: [], couriers: [] };
  ops = emptyOps();
  preparations = [];
}

// ---------------------------------------------------------------------------
// طلبات تحضير التوصيل (المرحلة الثانية — كيان تحضير مستقل قبل الشحن والفاتورة)
// ---------------------------------------------------------------------------

export interface ResolvedPreparationLine {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

export interface ResolvedPreparationContext {
  customer?: { id: string; name: string; phone?: string; address?: string; city?: string; zoneId?: string } | null;
  lines?: ResolvedPreparationLine[];
}

function clonePreparationOrder(p: DeliveryPreparationOrder): DeliveryPreparationOrder {
  return {
    ...p,
    lines: p.lines.map(l => ({ ...l }))
  };
}

function nextPreparationNumber(): string {
  let maxSeen = Number(ops.counters.preparation) || 0;
  for (const p of preparations) {
    const m = /^PRP-(\d+)$/.exec(p.number);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxSeen) maxSeen = n;
    }
  }
  ops.counters.preparation = maxSeen + 1;
  return `PRP-${pad(ops.counters.preparation)}`;
}

export function preparationByKey(key: string): DeliveryPreparationOrder | undefined {
  const cleanKey = text(key, 120);
  if (!cleanKey) return undefined;
  const num = ops.doneKeys[`prep:${cleanKey}`];
  const found = preparations.find(p => p.idempotencyKey === cleanKey || (num && p.number === num));
  return found ? clonePreparationOrder(found) : undefined;
}

export function listPreparationOrders(
  filter: { status?: string; customerId?: string; zoneId?: string; from?: string; to?: string; open?: boolean } = {}
): DeliveryPreparationOrder[] {
  return preparations
    .filter(p => !filter.status || p.status === filter.status)
    .filter(p => !filter.customerId || p.customerId === filter.customerId)
    .filter(p => !filter.zoneId || p.zoneId === filter.zoneId)
    .filter(p => !filter.open || p.status === 'قيد التحضير')
    .filter(p => !filter.from || p.createdAt.slice(0, 10) >= filter.from)
    .filter(p => !filter.to || p.createdAt.slice(0, 10) <= filter.to)
    .map(clonePreparationOrder);
}

export function getPreparationOrder(idOrNumber: string): DeliveryPreparationOrder | undefined {
  const key = String(idOrNumber || '').trim();
  if (!key) return undefined;
  const found = preparations.find(p => p.id === key || p.number === key);
  return found ? clonePreparationOrder(found) : undefined;
}

function buildPreparationLines(resolvedLines: ResolvedPreparationLine[] | undefined): {
  lines: DeliveryPreparationLine[];
  itemsSubtotal: number;
} {
  if (!Array.isArray(resolvedLines) || resolvedLines.length === 0) {
    throw new DeliveryError('أضف صنفًا واحدًا على الأقل في طلب التحضير');
  }
  if (resolvedLines.length > 200) {
    throw new DeliveryError('عدد بنود طلب التحضير لا يتجاوز 200 بند');
  }
  const lines: DeliveryPreparationLine[] = resolvedLines.map((raw, idx) => {
    const itemId = text(raw?.itemId, 100);
    if (!itemId) throw new DeliveryError(`البند رقم ${idx + 1}: الصنف مطلوب`);
    const q = Number(raw?.quantity);
    if (!Number.isFinite(q) || q <= 0 || q > 1_000_000) {
      throw new DeliveryError(`البند رقم ${idx + 1}: الكمية لازم تكون رقم أكبر من صفر`);
    }
    const quantity = Math.round(q * 1000) / 1000;
    const unitPrice = money(raw?.unitPrice, `سعر الصنف في البند رقم ${idx + 1}`, 0);
    const lineTotal = r2(quantity * unitPrice);
    return {
      itemId,
      itemName: text(raw?.itemName || itemId, MAX_NAME),
      unit: text(raw?.unit || 'قطعة', 40),
      quantity,
      unitPrice,
      lineTotal
    };
  });
  const itemsSubtotal = r2(lines.reduce((s, l) => s + l.lineTotal, 0));
  return { lines, itemsSubtotal };
}

export function createPreparationOrder(
  input: any,
  resolved: ResolvedPreparationContext,
  actor?: DeliveryActor,
  now: Date = new Date()
): { order: DeliveryPreparationOrder; duplicate?: boolean } {
  const src = input && typeof input === 'object' ? input : {};
  const rawKey = typeof src.idempotencyKey === 'string' ? src.idempotencyKey.trim() : '';
  if (rawKey.length < 8 || rawKey.length > 120) {
    throw new DeliveryError('مفتاح العملية ناقص (idempotencyKey)');
  }
  const existing = preparationByKey(rawKey);
  if (existing) {
    return { order: existing, duplicate: true };
  }

  const plan = prepareDeliveryPlan(src, {
    isDirectSale: true,
    actor,
    customer: resolved.customer || null,
    customerName: src.customerName
  });
  if (!plan.customerName) {
    throw new DeliveryError('اكتب اسم العميل أو اختار عميل مسجل');
  }

  const { lines, itemsSubtotal } = buildPreparationLines(resolved.lines);
  checkPlanTotals(plan, itemsSubtotal);

  const at = now.toISOString();
  const by = actorName(actor);
  const byId = String(actor?.userId || '');
  const number = nextPreparationNumber();

  const order: DeliveryPreparationOrder = {
    id: newId('prp'),
    number,
    status: 'قيد التحضير',
    revision: 1,
    idempotencyKey: rawKey,
    createdAt: at,
    createdBy: by,
    createdById: byId,
    updatedAt: at,
    updatedBy: by,
    updatedById: byId,
    cancelledAt: '',
    cancelledBy: '',
    cancelledById: '',
    cancelReason: '',
    customerId: plan.customerId,
    customerName: plan.customerName,
    phone: plan.phone,
    address: plan.address,
    zoneId: plan.zoneId,
    zoneName: plan.zoneName,
    zoneCommission: plan.zoneCommission,
    fee: plan.fee,
    feeManual: plan.feeManual,
    paymentMode: plan.paymentMode,
    assigneeType: plan.assignee?.type || '',
    assigneeId: plan.assignee?.id || '',
    assigneeName: plan.assignee?.name || '',
    trackingNumber: plan.trackingNumber,
    notes: text(src.notes, MAX_TEXT),
    lines,
    itemsSubtotal,
    estimatedTotal: r2(itemsSubtotal + plan.fee),
    invoiceNumber: '',
    deliveryOrderId: '',
    deliveryOrderNumber: '',
    dispatchedAt: '',
    dispatchedBy: '',
    dispatchedById: '',
    dispatchIdempotencyKey: ''
  };

  ops.doneKeys[`prep:${rawKey}`] = order.number;
  preparations.unshift(order);
  return { order: clonePreparationOrder(order) };
}

export function updatePreparationOrder(
  idOrNumber: string,
  input: any,
  resolved: ResolvedPreparationContext,
  actor?: DeliveryActor,
  now: Date = new Date()
): DeliveryPreparationOrder {
  const key = String(idOrNumber || '').trim();
  const existing = preparations.find(p => p.id === key || p.number === key);
  if (!existing) throw new DeliveryError('طلب التحضير مش موجود', 'NOT_FOUND', 404);
  if (existing.status === 'خرج للتوصيل' || Boolean(existing.invoiceNumber)) {
    throw new DeliveryError('لا يمكن تعديل طلب التحضير بعد إرساله للشحن وإصدار الفاتورة', 'ALREADY_DISPATCHED', 409);
  }
  if (existing.status === 'جاري الشحن') {
    throw new DeliveryError('طلب التحضير جاري إرساله للشحن؛ أعد محاولة الشحن لاستكمال ربط الفاتورة ولا يمكن تعديله الآن', 'DISPATCH_IN_PROGRESS', 409);
  }
  if (existing.status !== 'قيد التحضير') {
    throw new DeliveryError('لا يمكن تعديل طلب تحضير ملغي أو غير قابل للتعديل', 'INVALID_STATUS', 409);
  }

  const src = input && typeof input === 'object' ? input : {};
  const expectedRevision = Number(src.revision ?? src.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new DeliveryError('رقم مراجعة طلب التحضير (revision) مطلوب للتعديل', 'REVISION_REQUIRED', 400);
  }
  if (expectedRevision !== existing.revision) {
    throw new DeliveryError(
      'تم تعديل طلب التحضير من مستخدم أو تبويب آخر؛ يرجى تحديث البيانات والمحاولة مرة أخرى',
      'REVISION_CONFLICT',
      409
    );
  }

  const clearAssignee =
    (src.assigneeType !== undefined && String(src.assigneeType).trim() === '') ||
    (src.assigneeId !== undefined && String(src.assigneeId).trim() === '');

  const mergedPlanInput = {
    paymentMode: src.paymentMode !== undefined ? src.paymentMode : existing.paymentMode,
    address: src.address !== undefined ? src.address : existing.address,
    phone: src.phone !== undefined ? src.phone : existing.phone,
    zoneId: src.zoneId !== undefined ? src.zoneId : existing.zoneId,
    fee: src.fee !== undefined ? src.fee : undefined,
    assigneeType: clearAssignee ? '' : src.assigneeType !== undefined ? src.assigneeType : existing.assigneeType,
    assigneeId: clearAssignee ? '' : src.assigneeId !== undefined ? src.assigneeId : existing.assigneeId,
    trackingNumber: src.trackingNumber !== undefined ? src.trackingNumber : existing.trackingNumber
  };

  const cust =
    resolved.customer !== undefined
      ? resolved.customer
      : existing.customerId
        ? {
            id: existing.customerId,
            name: existing.customerName,
            phone: existing.phone,
            address: existing.address,
            zoneId: existing.zoneId
          }
        : null;

  const plan = prepareDeliveryPlan(mergedPlanInput, {
    isDirectSale: true,
    actor,
    customer: cust,
    customerName: src.customerName !== undefined ? src.customerName : existing.customerName
  });
  if (!plan.customerName) {
    throw new DeliveryError('اكتب اسم العميل أو اختار عميل مسجل');
  }

  // إذا لم يُرسل حقل الرسوم في التعديل ولم تتغير المنطقة وكان الطلب يحمل رسومًا يدوية محفوظة سابقًا، نحتفظ بها
  if (
    src.fee === undefined &&
    existing.feeManual &&
    plan.zoneId === existing.zoneId
  ) {
    plan.fee = existing.fee;
    plan.feeManual = true;
  }

  const nextLinesResult =
    resolved.lines !== undefined
      ? buildPreparationLines(resolved.lines)
      : { lines: existing.lines.map(l => ({ ...l })), itemsSubtotal: existing.itemsSubtotal };

  checkPlanTotals(plan, nextLinesResult.itemsSubtotal);

  const at = now.toISOString();
  const by = actorName(actor);
  const byId = String(actor?.userId || '');

  existing.revision += 1;
  existing.updatedAt = at;
  existing.updatedBy = by;
  existing.updatedById = byId;
  existing.customerId = plan.customerId;
  existing.customerName = plan.customerName;
  existing.phone = plan.phone;
  existing.address = plan.address;
  existing.zoneId = plan.zoneId;
  existing.zoneName = plan.zoneName;
  existing.zoneCommission = plan.zoneCommission;
  existing.fee = plan.fee;
  existing.feeManual = plan.feeManual;
  existing.paymentMode = plan.paymentMode;
  existing.assigneeType = plan.assignee?.type || '';
  existing.assigneeId = plan.assignee?.id || '';
  existing.assigneeName = plan.assignee?.name || '';
  existing.trackingNumber = plan.trackingNumber;
  if (src.notes !== undefined) {
    existing.notes = text(src.notes, MAX_TEXT);
  }
  existing.lines = nextLinesResult.lines;
  existing.itemsSubtotal = nextLinesResult.itemsSubtotal;
  existing.estimatedTotal = r2(nextLinesResult.itemsSubtotal + plan.fee);

  return clonePreparationOrder(existing);
}

export function cancelPreparationOrder(
  idOrNumber: string,
  input: { reason?: unknown; revision?: unknown } = {},
  actor?: DeliveryActor,
  now: Date = new Date()
): DeliveryPreparationOrder {
  const key = String(idOrNumber || '').trim();
  const existing = preparations.find(p => p.id === key || p.number === key);
  if (!existing) throw new DeliveryError('طلب التحضير مش موجود', 'NOT_FOUND', 404);
  if (existing.status === 'اتلغى') {
    throw new DeliveryError('طلب التحضير ملغي بالفعل', 'ALREADY_CANCELLED', 409);
  }
  if (existing.status === 'خرج للتوصيل' || Boolean(existing.invoiceNumber)) {
    throw new DeliveryError('لا يمكن إلغاء طلب التحضير بعد إرساله للشحن وإصدار الفاتورة', 'ALREADY_DISPATCHED', 409);
  }
  if (existing.status === 'جاري الشحن') {
    throw new DeliveryError('طلب التحضير جاري إرساله للشحن؛ أعد محاولة الشحن لاستكمال ربط الفاتورة ولا يمكن إلغاؤه الآن', 'DISPATCH_IN_PROGRESS', 409);
  }
  if (existing.status !== 'قيد التحضير') {
    throw new DeliveryError('لا يمكن إلغاء طلب التحضير في حالته الحالية', 'INVALID_STATUS', 409);
  }

  if (input?.revision !== undefined && input?.revision !== null && String(input.revision).trim() !== '') {
    const expectedRevision = Number(input.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== existing.revision) {
      throw new DeliveryError(
        'تم تعديل طلب التحضير من مستخدم أو تبويب آخر؛ يرجى تحديث البيانات والمحاولة مرة أخرى',
        'REVISION_CONFLICT',
        409
      );
    }
  }

  const at = now.toISOString();
  const by = actorName(actor);
  const byId = String(actor?.userId || '');

  existing.status = 'اتلغى';
  existing.revision += 1;
  existing.cancelledAt = at;
  existing.cancelledBy = by;
  existing.cancelledById = byId;
  existing.cancelReason = text(input?.reason || '', MAX_TEXT);
  existing.updatedAt = at;
  existing.updatedBy = by;
  existing.updatedById = byId;

  return clonePreparationOrder(existing);
}

/** توليد مفتاح عدم تكرار حتمي مشتق من هوية طلب التحضير نفسه */
export function buildPreparationDispatchIdempotencyKey(prepId: string): string {
  const cleanId = text(prepId, 100);
  if (!cleanId) throw new DeliveryError('معرّف طلب التحضير غير صالح', 'INVALID_PREPARATION_ID', 400);
  return `delivery-prep-dispatch:${cleanId}`;
}

/**
 * بدء عملية شحن طلب التحضير:
 * - يتحقق من وجود الطلب وعدم إلغائه ومطابقة رقم المراجعة (revision).
 * - إذا كان الطلب قد شُحن بالفعل (`خرج للتوصيل` مع `invoiceNumber`)، يعيد `alreadyDispatched: true`.
 * - إذا كان `قيد التحضير` أو `جاري الشحن` (إعادة محاولة بعد انقطاع)، يثبت مفتاح الشحن الحتمي ويضع الحالة `جاري الشحن`.
 */
export function beginPreparationDispatch(
  idOrNumber: string,
  input: { revision?: unknown } = {}
): {
  order: DeliveryPreparationOrder;
  alreadyDispatched: boolean;
  dispatchIdempotencyKey: string;
} {
  const key = String(idOrNumber || '').trim();
  const existing = preparations.find(p => p.id === key || p.number === key);
  if (!existing) throw new DeliveryError('طلب التحضير مش موجود', 'NOT_FOUND', 404);
  if (existing.status === 'اتلغى') {
    throw new DeliveryError('لا يمكن إرسال طلب تحضير ملغي للشحن', 'INVALID_STATUS', 409);
  }

  const dispatchIdempotencyKey =
    existing.dispatchIdempotencyKey || buildPreparationDispatchIdempotencyKey(existing.id);

  const hasRevisionInput =
    input?.revision !== undefined && input?.revision !== null && String(input.revision).trim() !== '';

  if (existing.status === 'خرج للتوصيل' && existing.invoiceNumber) {
    if (hasRevisionInput) {
      const expectedRevision = Number(input.revision);
      // نسمح برقم المراجعة الحالي أو الرقم الذي أُرسل به طلب الشحن الأصلي (existing.revision - 1) لدعم إعادة المحاولة بنفس الطلب
      if (
        !Number.isInteger(expectedRevision) ||
        (expectedRevision !== existing.revision && expectedRevision !== existing.revision - 1)
      ) {
        throw new DeliveryError(
          'تم تعديل طلب التحضير من مستخدم أو تبويب آخر؛ يرجى تحديث البيانات والمحاولة مرة أخرى',
          'REVISION_CONFLICT',
          409
        );
      }
    }
    return {
      order: clonePreparationOrder(existing),
      alreadyDispatched: true,
      dispatchIdempotencyKey
    };
  }

  if (hasRevisionInput) {
    const expectedRevision = Number(input.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== existing.revision) {
      throw new DeliveryError(
        'تم تعديل طلب التحضير من مستخدم أو تبويب آخر؛ يرجى تحديث البيانات والمحاولة مرة أخرى',
        'REVISION_CONFLICT',
        409
      );
    }
  }

  existing.status = 'جاري الشحن';
  existing.dispatchIdempotencyKey = dispatchIdempotencyKey;

  return {
    order: clonePreparationOrder(existing),
    alreadyDispatched: false,
    dispatchIdempotencyKey
  };
}

/** التراجع عن حالة `جاري الشحن` إلى `قيد التحضير` عندما يفشل التحقق قبل إنشاء أي فاتورة */
export function revertPreparationDispatch(idOrNumber: string): DeliveryPreparationOrder | undefined {
  const key = String(idOrNumber || '').trim();
  const existing = preparations.find(p => p.id === key || p.number === key);
  if (!existing) return undefined;
  if (existing.status === 'جاري الشحن' && !existing.invoiceNumber) {
    existing.status = 'قيد التحضير';
    existing.dispatchIdempotencyKey = '';
  }
  return clonePreparationOrder(existing);
}

/** استكمال ربط طلب التحضير بالفاتورة الرسمية وسجل التوصيل وتحديث حالته إلى «خرج للتوصيل» */
export function completePreparationDispatch(
  idOrNumber: string,
  link: {
    invoiceNumber: string;
    deliveryOrderId: string;
    deliveryOrderNumber: string;
    dispatchIdempotencyKey: string;
    assigneeType: AssigneeType;
    assigneeId: string;
    assigneeName: string;
    trackingNumber?: string;
    fee?: number;
    feeManual?: boolean;
    zoneId?: string;
    zoneName?: string;
    zoneCommission?: number;
    notes?: string;
  },
  actor?: DeliveryActor,
  now: Date = new Date()
): DeliveryPreparationOrder {
  const key = String(idOrNumber || '').trim();
  const existing = preparations.find(p => p.id === key || p.number === key);
  if (!existing) throw new DeliveryError('طلب التحضير مش موجود', 'NOT_FOUND', 404);

  const invoiceNumber = text(link.invoiceNumber, 80);
  if (!invoiceNumber) {
    throw new DeliveryError('رقم الفاتورة مطلوب لربط طلب التحضير', 'INVOICE_NUMBER_REQUIRED', 400);
  }

  const wasAlreadyDispatched = existing.status === 'خرج للتوصيل' && existing.invoiceNumber === invoiceNumber;
  const at = now.toISOString();
  const by = actorName(actor);
  const byId = String(actor?.userId || '');

  existing.status = 'خرج للتوصيل';
  if (!wasAlreadyDispatched) {
    existing.revision += 1;
    existing.dispatchedAt = at;
    existing.dispatchedBy = by;
    existing.dispatchedById = byId;
    existing.updatedAt = at;
    existing.updatedBy = by;
    existing.updatedById = byId;
  }
  existing.invoiceNumber = invoiceNumber;
  existing.deliveryOrderId = text(link.deliveryOrderId, 100);
  existing.deliveryOrderNumber = text(link.deliveryOrderNumber, 60);
  existing.dispatchIdempotencyKey = text(
    link.dispatchIdempotencyKey || buildPreparationDispatchIdempotencyKey(existing.id),
    120
  );
  existing.assigneeType = link.assigneeType;
  existing.assigneeId = text(link.assigneeId, 100);
  existing.assigneeName = text(link.assigneeName, MAX_NAME);
  existing.trackingNumber =
    link.assigneeType === 'courier' ? text(link.trackingNumber ?? existing.trackingNumber, 60) : '';
  if (link.fee !== undefined) {
    existing.fee = r2(link.fee);
    if (link.feeManual !== undefined) existing.feeManual = Boolean(link.feeManual);
    existing.estimatedTotal = r2(existing.itemsSubtotal + existing.fee);
  }
  if (link.zoneId !== undefined) {
    existing.zoneId = text(link.zoneId, 100);
    existing.zoneName = text(link.zoneName, MAX_NAME);
    if (link.zoneCommission !== undefined) existing.zoneCommission = r2(link.zoneCommission);
  }
  if (link.notes !== undefined) {
    existing.notes = text(link.notes, MAX_TEXT);
  }

  ops.doneKeys[`prep-dispatch:${existing.id}`] = existing.invoiceNumber;
  return clonePreparationOrder(existing);
}

// ---------------------------------------------------------------------------
// الطلبات: التوزيع وتغيير الحالة
// ---------------------------------------------------------------------------

export function listOrders(filter: { status?: string; assigneeType?: string; assigneeId?: string; from?: string; to?: string; open?: boolean } = {}): DeliveryOrder[] {
  return ops.orders
    .filter(o => !filter.status || o.status === filter.status)
    .filter(o => !filter.assigneeType || o.assigneeType === filter.assigneeType)
    .filter(o => !filter.assigneeId || o.assigneeId === filter.assigneeId)
    .filter(o => !filter.open || !FINAL_STATUSES.includes(o.status))
    .filter(o => !filter.from || o.createdAt.slice(0, 10) >= filter.from)
    .filter(o => !filter.to || o.createdAt.slice(0, 10) <= filter.to)
    .map(o => ({ ...o, log: o.log.map(e => ({ ...e })) }));
}

export function getOrder(id: string): DeliveryOrder | undefined {
  const o = ops.orders.find(x => x.id === id || x.number === id || x.invoiceNumber === id);
  return o ? { ...o, log: o.log.map(e => ({ ...e })) } : undefined;
}

function orderRef(id: string): DeliveryOrder {
  const o = ops.orders.find(x => x.id === id || x.number === id);
  if (!o) throw new DeliveryError('طلب التوصيل مش موجود', 'NOT_FOUND', 404);
  return o;
}

/** طلب التوصيل المفتوح للفاتورة (علشان تعديل الفاتورة وإلغاؤها يتمنعوا) */
export function findOpenOrderForInvoice(invoiceNumber: string): DeliveryOrder | undefined {
  return ops.orders.find(o => o.invoiceNumber === invoiceNumber && !FINAL_STATUSES.includes(o.status));
}
export function findOrderForInvoice(invoiceNumber: string): DeliveryOrder | undefined {
  return ops.orders.find(o => o.invoiceNumber === invoiceNumber);
}

/** عهدة الطيار الحالية: فلوس طلبات «الدفع عند الاستلام» اللي اتسلمت ولسه ما اتسوتش */
export function driverCustody(driverId: string): number {
  return r2(
    ops.orders
      .filter(o => o.assigneeType === 'driver' && o.assigneeId === driverId && o.status === 'اتسلم' && o.paymentMode === 'cod' && !o.settlementId)
      .reduce((s, o) => s + o.amountDue, 0)
  );
}

function custodyWarning(driverId: string): string {
  const max = config.settings.maxDriverCustody;
  if (!max) return '';
  const c = driverCustody(driverId);
  if (c <= max) return '';
  const d = config.drivers.find(x => x.id === driverId);
  return `تنبيه: عهدة الطيار «${d?.name || ''}» ${c} ج.م وده أكتر من الحد (${max} ج.م). سوّي فلوسه.`;
}

/** توزيع الطلب على طيار أو شركة شحن (الطلب الجديد أو اللي ما اتسلمش) */
export function assignOrder(id: string, input: any, actor?: DeliveryActor, now: Date = new Date()): { order: DeliveryOrder; warning: string } {
  const o = orderRef(id);
  if (o.status !== 'جديد' && o.status !== 'ما اتسلمش') {
    throw new DeliveryError(`الطلب حالته «${o.status}»: التوزيع للطلب الجديد أو اللي ما اتسلمش بس`);
  }
  const a = resolveAssignee(input?.assigneeType, input?.assigneeId);
  const changed = o.assigneeType !== a.type || o.assigneeId !== a.id;
  o.assigneeType = a.type;
  o.assigneeId = a.id;
  o.assigneeName = a.name;
  o.trackingNumber = a.type === 'courier' ? text(input?.trackingNumber ?? o.trackingNumber, 60) : '';
  if (changed) {
    o.log.push({ status: o.status, at: now.toISOString(), byId: String(actor?.userId || ''), byName: actorName(actor), note: `اتوزع على ${a.type === 'driver' ? 'الطيار' : 'شركة الشحن'} «${a.name}»` });
  }
  return { order: getOrder(o.id)!, warning: a.type === 'driver' ? custodyWarning(a.id) : '' };
}

const ALLOWED: Record<DeliveryStatus, DeliveryStatus[]> = {
  'جديد': ['خرج للتوصيل', 'اتلغى'],
  'خرج للتوصيل': ['اتسلم', 'ما اتسلمش'],
  'ما اتسلمش': ['خرج للتوصيل', 'رجع المحل', 'اتلغى'],
  'اتسلم': [],
  'رجع المحل': [],
  'اتلغى': []
};
/** الحالات اللي الطيار يقدر يكتبها من موبايله */
export const DRIVER_STATUSES: readonly DeliveryStatus[] = ['خرج للتوصيل', 'اتسلم', 'ما اتسلمش'];

/** هل الانتقال مسموح؟ (بيرمي DeliveryError لو لأ) */
export function checkTransition(id: string, to: unknown, opts: { reason?: unknown; asDriverId?: string } = {}): DeliveryOrder {
  const o = orderRef(id);
  const target = String(to || '') as DeliveryStatus;
  if (!DELIVERY_STATUSES.includes(target)) throw new DeliveryError('حالة الطلب مش صحيحة');
  if (opts.asDriverId) {
    if (o.assigneeType !== 'driver' || o.assigneeId !== opts.asDriverId) throw new DeliveryError('الطلب ده مش بتاعك', 'FORBIDDEN', 403);
    if (!DRIVER_STATUSES.includes(target)) throw new DeliveryError('الطيار يكتب «خرجت» أو «اتسلم» أو «ما اتسلمش» بس', 'FORBIDDEN', 403);
  }
  if (!ALLOWED[o.status].includes(target)) throw new DeliveryError(`مينفعش الطلب يتحول من «${o.status}» لـ «${target}»`);
  if (target === 'خرج للتوصيل' && !o.assigneeId) throw new DeliveryError('وزّع الطلب على طيار أو شركة شحن الأول');
  if (target === 'ما اتسلمش' && !text(opts.reason)) throw new DeliveryError('اكتب سبب إن الطلب ما اتسلمش');
  return { ...o };
}

/**
 * تغيير الحالة (بعد checkTransition، وبعد المرتجع الرسمي لو «رجع المحل» أو «اتلغى»).
 * returnNumber للحالتين دول.
 */
export function applyTransition(
  id: string,
  to: DeliveryStatus,
  actor: DeliveryActor | undefined,
  opts: { reason?: unknown; note?: unknown; returnNumber?: string } = {},
  now: Date = new Date()
): { order: DeliveryOrder; warning: string } {
  const o = orderRef(id);
  const at = now.toISOString();
  const reason = text(opts.reason);
  o.status = to;
  if (to === 'خرج للتوصيل') {
    o.outAt = at;
    o.failReason = '';
  }
  if (to === 'ما اتسلمش') o.failReason = reason;
  if (to === 'اتسلم') {
    o.deliveredAt = at;
    o.closedAt = at;
    if (o.assigneeType === 'driver') {
      const d = config.drivers.find(x => x.id === o.assigneeId);
      o.commission = r2(config.settings.zonePricing && o.zoneId ? o.zoneCommission : d?.commissionPerOrder || 0);
    } else if (o.assigneeType === 'courier') {
      const c = config.couriers.find(x => x.id === o.assigneeId);
      o.courierFee = r2(c?.feePerOrder || 0);
    }
  }
  if (to === 'رجع المحل' || to === 'اتلغى') {
    o.closedAt = at;
    o.returnNumber = opts.returnNumber || '';
  }
  const noteParts = [reason, text(opts.note)].filter(Boolean);
  if (opts.returnNumber) noteParts.push(`مرتجع ${opts.returnNumber}`);
  o.log.push({ status: to, at, byId: String(actor?.userId || ''), byName: actorName(actor), note: noteParts.join(' — ') });
  const warning = to === 'اتسلم' && o.assigneeType === 'driver' && o.paymentMode === 'cod' ? custodyWarning(o.assigneeId) : '';
  return { order: getOrder(o.id)!, warning };
}

// ---------------------------------------------------------------------------
// التسوية (الفلوس اللي مع الطيار أو على شركة الشحن)
// ---------------------------------------------------------------------------

export interface SettlementPreview {
  assigneeType: AssigneeType;
  assigneeId: string;
  assigneeName: string;
  orders: DeliveryOrder[];
  collected: number;
  courierFees: number;
  expected: number;
}

/** محتاج تسوية؟ الطيار: طلبات الدفع عند الاستلام. شركة الشحن: كل اللي اتسلم (رسومها بتتخصم حتى لو مدفوع مقدمًا) */
function needsSettlement(o: DeliveryOrder): boolean {
  if (o.status !== 'اتسلم' || o.settlementId || !o.assigneeType) return false;
  return o.assigneeType === 'courier' || o.paymentMode === 'cod';
}

/** الطلبات اللي اتسلمت ولسه ما اتسوتش */
export function unsettledOrders(type: AssigneeType, assigneeId: string): DeliveryOrder[] {
  return listOrders().filter(o => o.assigneeType === type && o.assigneeId === assigneeId && needsSettlement(o));
}

export function previewSettlement(type: unknown, assigneeId: unknown, orderIds?: unknown): SettlementPreview {
  const t = String(type || '');
  if (t !== 'driver' && t !== 'courier') throw new DeliveryError('اختار طيار أو شركة شحن');
  const who = t === 'driver' ? config.drivers.find(d => d.id === assigneeId) : config.couriers.find(c => c.id === assigneeId);
  if (!who) throw new DeliveryError(t === 'driver' ? 'الطيار مش موجود' : 'شركة الشحن مش موجودة');
  const pending = unsettledOrders(t, who.id);
  let chosen = pending;
  if (Array.isArray(orderIds)) {
    const ids = orderIds.map(String);
    if (new Set(ids).size !== ids.length) throw new DeliveryError('في طلبات متكررة في التسوية');
    chosen = [];
    for (const id of ids) {
      const o = pending.find(x => x.id === id || x.number === id);
      if (!o) {
        const any = getOrder(id);
        if (!any) throw new DeliveryError(`الطلب ${id} مش موجود`);
        if (any.settlementId) throw new DeliveryError(`الطلب ${any.number} اتسوّى قبل كده`);
        throw new DeliveryError(`الطلب ${any.number} مش من طلبات ${who.name} اللي اتسلمت ومستنية تسوية`);
      }
      chosen.push(o);
    }
  }
  const collected = r2(chosen.reduce((s, o) => s + o.amountDue, 0));
  const courierFees = r2(chosen.reduce((s, o) => s + (t === 'courier' ? o.courierFee : 0), 0));
  return { assigneeType: t, assigneeId: who.id, assigneeName: who.name, orders: chosen, collected, courierFees, expected: r2(collected - courierFees) };
}

export function settlementByKey(key: string): DeliverySettlement | undefined {
  const num = ops.doneKeys[`settle:${key}`];
  return num ? ops.settlements.find(s => s.number === num) : undefined;
}
export function payoutByKey(key: string): DriverPayout | undefined {
  const num = ops.doneKeys[`payout:${key}`];
  return num ? ops.payouts.find(p => p.number === num) : undefined;
}

export function nextSettlementNumber(): string {
  return `STL-${pad(ops.counters.settlement + 1)}`;
}
export function nextPayoutNumber(): string {
  return `PAY-${pad(ops.counters.payout + 1)}`;
}

/** تسجيل التسوية (بعد ما الفلوس دخلت الخزنة) */
export function recordSettlement(
  preview: SettlementPreview,
  input: { received: number; cashboxId: string; cashboxName: string; note?: unknown; key: string },
  actor: DeliveryActor | undefined,
  now: Date = new Date()
): DeliverySettlement {
  ops.counters.settlement += 1;
  const st: DeliverySettlement = {
    id: newId('stl'),
    number: `STL-${pad(ops.counters.settlement)}`,
    at: now.toISOString(),
    byId: String(actor?.userId || ''),
    byName: actorName(actor),
    assigneeType: preview.assigneeType,
    assigneeId: preview.assigneeId,
    assigneeName: preview.assigneeName,
    orderIds: preview.orders.map(o => o.id),
    invoiceNumbers: preview.orders.map(o => o.invoiceNumber),
    collected: preview.collected,
    courierFees: preview.courierFees,
    expected: preview.expected,
    received: r2(input.received),
    shortage: r2(preview.expected - input.received),
    cashboxId: input.cashboxId,
    cashboxName: input.cashboxName,
    note: text(input.note)
  };
  for (const id of st.orderIds) {
    const o = ops.orders.find(x => x.id === id);
    if (o) o.settlementId = st.id;
  }
  ops.settlements.unshift(st);
  if (input.key) ops.doneKeys[`settle:${input.key}`] = st.number;
  return { ...st };
}

export function listSettlements(filter: { assigneeType?: string; assigneeId?: string; from?: string; to?: string } = {}): DeliverySettlement[] {
  return ops.settlements
    .filter(s => !filter.assigneeType || s.assigneeType === filter.assigneeType)
    .filter(s => !filter.assigneeId || s.assigneeId === filter.assigneeId)
    .filter(s => !filter.from || s.at.slice(0, 10) >= filter.from)
    .filter(s => !filter.to || s.at.slice(0, 10) <= filter.to)
    .map(s => ({ ...s }));
}

// ---------------------------------------------------------------------------
// مستحقات الطيار (المرتب + العمولة − العجز)
// ---------------------------------------------------------------------------

export interface DriverDues {
  driverId: string;
  driverName: string;
  monthlySalary: number;
  /** عمولة الطلبات اللي اتسلمت ولسه ما اتصرفتش */
  commissionUnpaid: number;
  unpaidOrderIds: string[];
  /** العجز اللي على الطيار من التسويات ولسه ما اتخصمش (سالب = زيادة ليه) */
  shortageOutstanding: number;
  /** العهدة الحالية (فلوس معاه لسه ما اتسوتش) */
  custody: number;
}

export function driverDues(driverId: string): DriverDues {
  const d = config.drivers.find(x => x.id === driverId);
  if (!d) throw new DeliveryError('الطيار مش موجود');
  const unpaid = ops.orders.filter(o => o.assigneeType === 'driver' && o.assigneeId === d.id && o.status === 'اتسلم' && !o.payoutId && o.commission > 0);
  const shortages = ops.settlements.filter(s => s.assigneeType === 'driver' && s.assigneeId === d.id).reduce((s, x) => s + x.shortage, 0);
  const deducted = ops.payouts.filter(p => p.driverId === d.id).reduce((s, p) => s + p.shortageDeducted, 0);
  return {
    driverId: d.id,
    driverName: d.name,
    monthlySalary: d.monthlySalary,
    commissionUnpaid: r2(unpaid.reduce((s, o) => s + o.commission, 0)),
    unpaidOrderIds: unpaid.map(o => o.id),
    shortageOutstanding: r2(shortages - deducted),
    custody: driverCustody(d.id)
  };
}

export interface PayoutPlan {
  driver: DeliveryDriver;
  salary: number;
  commission: number;
  orderIds: string[];
  shortageDeducted: number;
  paid: number;
}

export interface PayoutPreview {
  driverId: string;
  driverName: string;
  salary: number;
  payCommission: boolean;
  deductShortage: boolean;
  commission: number;
  orderIds: string[];
  gross: number;
  shortageOutstanding: number;
  shortageDeducted: number;
  paid: number;
  canPayout: boolean;
}

function computePayoutBreakdown(
  dues: DriverDues,
  input: any
): {
  salary: number;
  payCommission: boolean;
  deductShortage: boolean;
  commission: number;
  orderIds: string[];
  gross: number;
  shortageDeducted: number;
  paid: number;
} {
  const salary = money(input?.salary, 'المرتب', 0);
  const payCommission = bool(input?.payCommission, true);
  const commission = payCommission ? dues.commissionUnpaid : 0;
  const orderIds = payCommission ? [...dues.unpaidOrderIds] : [];
  const deductShortage = bool(input?.deductShortage, true);
  const gross = r2(salary + commission);
  const shortageDeducted =
    deductShortage && dues.shortageOutstanding > 0 ? r2(Math.min(dues.shortageOutstanding, gross)) : 0;
  const paid = r2(gross - shortageDeducted);
  return { salary, payCommission, deductShortage, commission, orderIds, gross, shortageDeducted, paid };
}

/** معاينة صرف مستحقات الطيار بدون أي تعديل على البيانات (read-only) */
export function previewPayout(
  driverId: unknown,
  input: any
): { preview: PayoutPreview; dues: DriverDues } {
  const d = config.drivers.find(x => x.id === driverId);
  if (!d) throw new DeliveryError('الطيار مش موجود');
  const dues = driverDues(d.id);
  const b = computePayoutBreakdown(dues, input);
  return {
    preview: {
      driverId: d.id,
      driverName: d.name,
      salary: b.salary,
      payCommission: b.payCommission,
      deductShortage: b.deductShortage,
      commission: b.commission,
      orderIds: b.orderIds,
      gross: b.gross,
      shortageOutstanding: dues.shortageOutstanding,
      shortageDeducted: b.shortageDeducted,
      paid: b.paid,
      canPayout: b.gross > 0
    },
    dues
  };
}

/** حساب صرف مستحقات الطيار: input = { salary, payCommission, deductShortage } */
export function planPayout(driverId: unknown, input: any): PayoutPlan {
  const d = config.drivers.find(x => x.id === driverId);
  if (!d) throw new DeliveryError('الطيار مش موجود');
  const dues = driverDues(d.id);
  const b = computePayoutBreakdown(dues, input);
  if (b.gross <= 0) throw new DeliveryError('مفيش مستحقات للصرف: اكتب المرتب أو اختار صرف العمولة');
  return {
    driver: { ...d },
    salary: b.salary,
    commission: b.commission,
    orderIds: b.orderIds,
    shortageDeducted: b.shortageDeducted,
    paid: b.paid
  };
}

export function recordPayout(
  plan: PayoutPlan,
  input: { cashboxId: string; cashboxName: string; note?: unknown; key: string },
  actor: DeliveryActor | undefined,
  now: Date = new Date()
): DriverPayout {
  ops.counters.payout += 1;
  const p: DriverPayout = {
    id: newId('pay'),
    number: `PAY-${pad(ops.counters.payout)}`,
    at: now.toISOString(),
    byId: String(actor?.userId || ''),
    byName: actorName(actor),
    driverId: plan.driver.id,
    driverName: plan.driver.name,
    salary: plan.salary,
    commission: plan.commission,
    shortageDeducted: plan.shortageDeducted,
    paid: plan.paid,
    orderIds: plan.orderIds,
    cashboxId: input.cashboxId,
    cashboxName: input.cashboxName,
    note: text(input.note)
  };
  for (const id of p.orderIds) {
    const o = ops.orders.find(x => x.id === id);
    if (o) o.payoutId = p.id;
  }
  ops.payouts.unshift(p);
  if (input.key) ops.doneKeys[`payout:${input.key}`] = p.number;
  return { ...p };
}

export function listPayouts(filter: { driverId?: string; from?: string; to?: string } = {}): DriverPayout[] {
  return ops.payouts
    .filter(p => !filter.driverId || p.driverId === filter.driverId)
    .filter(p => !filter.from || p.at.slice(0, 10) >= filter.from)
    .filter(p => !filter.to || p.at.slice(0, 10) <= filter.to)
    .map(p => ({ ...p }));
}

// ---------------------------------------------------------------------------
// التقارير
// ---------------------------------------------------------------------------

export interface DeliveryReports {
  from: string;
  to: string;
  openOrders: { total: number; late: number; lateAfterHours: number; byStatus: Record<string, number>; lateOrders: DeliveryOrder[] };
  custody: { type: AssigneeType; id: string; name: string; amount: number; orders: number; since: string }[];
  performance: { driverId: string; driverName: string; orders: number; delivered: number; failed: number; deliveredPercent: number; avgMinutes: number }[];
  fees: { total: number; byZone: { name: string; total: number; orders: number }[]; byAssignee: { name: string; total: number; orders: number }[] };
  settlements: { count: number; expected: number; received: number; shortage: number; list: DeliverySettlement[] };
  dues: (DriverDues & { paidInPeriod: number })[];
}

export function buildDeliveryReports(range: { from?: string; to?: string } = {}, now: Date = new Date()): DeliveryReports {
  const from = String(range.from || '');
  const to = String(range.to || '');
  const inRange = (iso: string) => (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);
  const lateMs = config.settings.lateAfterHours * 3600_000;

  const open = ops.orders.filter(o => !FINAL_STATUSES.includes(o.status));
  const byStatus: Record<string, number> = {};
  for (const o of open) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  const late = open.filter(o => now.getTime() - new Date(o.createdAt).getTime() > lateMs);

  const custody: DeliveryReports['custody'] = [];
  const pendingCash = ops.orders.filter(needsSettlement);
  const groups = new Map<string, DeliveryOrder[]>();
  for (const o of pendingCash) {
    const k = `${o.assigneeType}:${o.assigneeId}`;
    groups.set(k, [...(groups.get(k) || []), o]);
  }
  for (const [k, list] of groups) {
    const [type, id] = k.split(':') as [AssigneeType, string];
    const amount = list.reduce((s, o) => s + o.amountDue - (type === 'courier' ? o.courierFee : 0), 0);
    const since = list.map(o => o.deliveredAt).sort()[0] || '';
    custody.push({ type, id, name: list[0].assigneeName, amount: r2(amount), orders: list.length, since });
  }
  custody.sort((a, b) => b.amount - a.amount);

  const periodOrders = ops.orders.filter(o => inRange(o.createdAt));
  const performance = config.drivers.map(d => {
    const mine = periodOrders.filter(o => o.assigneeType === 'driver' && o.assigneeId === d.id);
    const delivered = mine.filter(o => o.status === 'اتسلم');
    const failed = mine.filter(o => o.log.some(e => e.status === 'ما اتسلمش'));
    const times = delivered.filter(o => o.outAt && o.deliveredAt).map(o => (new Date(o.deliveredAt).getTime() - new Date(o.outAt).getTime()) / 60000);
    return {
      driverId: d.id,
      driverName: d.name,
      orders: mine.length,
      delivered: delivered.length,
      failed: failed.length,
      deliveredPercent: mine.length ? Math.round((delivered.length / mine.length) * 100) : 0,
      avgMinutes: times.length ? Math.round(times.reduce((s, x) => s + x, 0) / times.length) : 0
    };
  });

  const feeOrders = periodOrders.filter(o => o.status === 'اتسلم');
  const sumBy = (key: (o: DeliveryOrder) => string) => {
    const m = new Map<string, { name: string; total: number; orders: number }>();
    for (const o of feeOrders) {
      const name = key(o);
      const cur = m.get(name) || { name, total: 0, orders: 0 };
      cur.total = r2(cur.total + o.fee);
      cur.orders += 1;
      m.set(name, cur);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };

  const periodSettlements = ops.settlements.filter(s => inRange(s.at));
  const dues = config.drivers.map(d => ({
    ...driverDues(d.id),
    paidInPeriod: r2(ops.payouts.filter(p => p.driverId === d.id && inRange(p.at)).reduce((s, p) => s + p.paid, 0))
  }));

  return {
    from,
    to,
    openOrders: { total: open.length, late: late.length, lateAfterHours: config.settings.lateAfterHours, byStatus, lateOrders: late.map(o => getOrder(o.id)!) },
    custody,
    performance,
    fees: {
      total: r2(feeOrders.reduce((s, o) => s + o.fee, 0)),
      byZone: sumBy(o => o.zoneName || 'من غير منطقة'),
      byAssignee: sumBy(o => o.assigneeName || '—')
    },
    settlements: {
      count: periodSettlements.length,
      expected: r2(periodSettlements.reduce((s, x) => s + x.expected, 0)),
      received: r2(periodSettlements.reduce((s, x) => s + x.received, 0)),
      shortage: r2(periodSettlements.reduce((s, x) => s + x.shortage, 0)),
      list: periodSettlements.map(s => ({ ...s }))
    },
    dues
  };
}

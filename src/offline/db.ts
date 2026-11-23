import {
  Item,
  ProductCategory,
  Platform,
  ItemPlatformCost,
  Customer,
  Cashbox,
  UserCashboxAssignment,
  Invoice,
  ReturnRecord,
  UserAccount,
  AuthSession,
  PermissionKey,
  CompanySettings,
  InvoicePrintSettings,
  DisplaySettings,
  TaxSettings,
  StockSettings,
  CollectCreditPayload,
  CollectCreditResult,
  PartyLedgerEntry,
  SalesRules
} from '../types';
import { api } from '../api/client';
import { hasPermission } from '../utils/permissions';
import { calculateInvoice } from '../shared/invoiceCalc';
import { assertOfflineWriteOwnership } from './offlineLock';

export const OFFLINE_PBKDF2_ITERATIONS = 200000;

export interface EncryptedUserRecord {
  id: string;
  encrypted: true;
  algorithm: 'AES-GCM';
  ivHex: string;
  ciphertextHex: string;
  updatedAt: string;
}

export const OFFLINE_DB_NAME = 'mudaqqeq_pos_offline_db';
export const OFFLINE_DB_VERSION = 1;

export const OFFLINE_STORES = {
  CATALOG: 'catalog',
  META: 'meta',
  USERS: 'users',
  OUTBOX: 'outbox',
  CREDIT: 'credit'
} as const;

export type OfflineStoreName = (typeof OFFLINE_STORES)[keyof typeof OFFLINE_STORES];

export type CatalogEntryKey =
  | 'items'
  | 'categories'
  | 'platforms'
  | 'costs'
  | 'customers'
  | 'cashboxes'
  | 'cashboxAssignments'
  | 'settings';

export interface CatalogSettingsRecord {
  companySettings?: CompanySettings;
  invoicePrintSettings?: InvoicePrintSettings;
  displaySettings?: DisplaySettings;
  taxSettings?: TaxSettings;
  stockSettings?: StockSettings;
  salesRules?: import('../types').SalesRules;
  storeName?: string;
  currency?: string;
  enableDeliveryFee?: boolean;
}

export interface CatalogRecord<T = any> {
  key: CatalogEntryKey;
  data: T;
  updatedAt: string;
}

export type MetaEntryKey =
  | 'deviceId'
  | 'deviceName'
  | 'deviceNameConfigured'
  | 'lastSyncAt'
  | 'storagePersisted'
  | 'storagePersistedAt'
  | 'syncedUserId'
  | 'syncedUserRole'
  | 'deviceUsersCryptoKey'
  | 'dataEpoch';

export interface MetaRecord<T = any> {
  key: MetaEntryKey | string;
  value: T;
  updatedAt: string;
}

export const DATA_EPOCH_STORAGE_KEY = 'mudaqqeq_data_epoch';
export const OUTBOX_CANCELLED_BEFORE_RESET_STATUS = 'ملغاة — سُجّلت قبل إعادة ضبط النظام' as const;
export const OUTBOX_REJECTED_REVIEW_STATUS = 'مرفوضة — تحتاج مراجعة' as const;

const SETTINGS_REJECTION_CODES = new Set([
  'PLATFORMS_DISABLED',
  'PLATFORM_SALE_DISABLED',
  'DIRECT_SALE_DISABLED',
  'ALL_SALE_MODES_DISABLED',
  'SALE_MODE_DISABLED',
  'ACTIVE_PLATFORM_REQUIRED'
]);

export type OutboxOperationStatus =
  | 'معلّقة'
  | 'pending'
  | 'syncing'
  | 'failed'
  | 'synced'
  | typeof OUTBOX_CANCELLED_BEFORE_RESET_STATUS
  | typeof OUTBOX_REJECTED_REVIEW_STATUS;

export interface OutboxOperation {
  id: string;
  idempotencyKey: string;
  type: string;
  operationType?: string;
  invoiceNumber?: string;
  needsReview?: boolean;
  payload: any;
  status: OutboxOperationStatus;
  retryCount: number;
  lastError?: string | null;
  deviceId: string;
  deviceName: string;
  userId?: string;
  userName?: string;
  createdByUserId?: string;
  createdByUserName?: string;
  deviceTime?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PartyBalanceSnapshot {
  partyType: 'customer' | 'platform';
  partyId: string;
  partyName: string;
  currentBalance: number;
  pendingInvoicesCount: number;
  updatedAt: string;
}

export interface CreditRecord<T = any> {
  key: 'pendingInvoices' | 'partyBalances' | 'invoices' | 'returns' | string;
  data: T;
  updatedAt: string;
}

export interface OfflineSnapshotData {
  items: Item[];
  categories: ProductCategory[];
  platforms: Platform[];
  costs: ItemPlatformCost[];
  customers: Customer[];
  cashboxes: Cashbox[];
  cashboxAssignments: UserCashboxAssignment[];
  settings: CatalogSettingsRecord | null;
  users: UserAccount[];
  pendingInvoices: Invoice[];
  partyBalances: PartyBalanceSnapshot[];
  invoices: Invoice[];
  returns: ReturnRecord[];
  lastSyncAt: string | null;
}

type OfflineDbListener = () => void;
const listeners = new Set<OfflineDbListener>();

export function subscribeOfflineDb(listener: OfflineDbListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyOfflineDbChange() {
  listeners.forEach(listener => {
    try {
      listener();
    } catch (_) {}
  });
}

let dbInstancePromise: Promise<IDBDatabase> | null = null;

/**
 * فتح قاعدة البيانات المحلية IndexedDB وإنشاء المخازن المطلوبة:
 * catalog, meta, users, outbox, credit
 */
export function openOfflineDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB غير مدعوم في هذا المتصفح'));
  }

  if (dbInstancePromise) {
    return dbInstancePromise;
  }

  dbInstancePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // 1. catalog: أصناف، تصنيفات، منصات، عملاء، خزن، إعدادات
      if (!db.objectStoreNames.contains(OFFLINE_STORES.CATALOG)) {
        db.createObjectStore(OFFLINE_STORES.CATALOG, { keyPath: 'key' });
      }

      // 2. meta: deviceId, deviceName, lastSyncAt, storagePersisted...
      if (!db.objectStoreNames.contains(OFFLINE_STORES.META)) {
        db.createObjectStore(OFFLINE_STORES.META, { keyPath: 'key' });
      }

      // 3. users: المستخدمون وبيانات المستخدم الحالي
      if (!db.objectStoreNames.contains(OFFLINE_STORES.USERS)) {
        db.createObjectStore(OFFLINE_STORES.USERS, { keyPath: 'id' });
      }

      // 4. outbox: العمليات المعلقة لإرسالها لاحقًا
      if (!db.objectStoreNames.contains(OFFLINE_STORES.OUTBOX)) {
        const outboxStore = db.createObjectStore(OFFLINE_STORES.OUTBOX, { keyPath: 'id' });
        outboxStore.createIndex('status', 'status', { unique: false });
        outboxStore.createIndex('createdAt', 'createdAt', { unique: false });
        outboxStore.createIndex('idempotencyKey', 'idempotencyKey', { unique: false });
      }

      // 5. credit: الفواتير المعلّقة وأرصدة الأطراف
      if (!db.objectStoreNames.contains(OFFLINE_STORES.CREDIT)) {
        db.createObjectStore(OFFLINE_STORES.CREDIT, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbInstancePromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbInstancePromise = null;
      reject(request.error || new Error('تعذر فتح قاعدة البيانات المحلية IndexedDB'));
    };

    request.onblocked = () => {
      dbInstancePromise = null;
    };
  });

  return dbInstancePromise;
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('فشلت معاملة IndexedDB'));
    tx.onabort = () => reject(tx.error || new Error('تم إلغاء معاملة IndexedDB'));
  });
}

/**
 * فتح معاملة كتابة لـ outbox مع durability: 'strict' إلزاميًا
 */
function openStrictOutboxWriteTx(db: IDBDatabase): IDBTransaction {
  try {
    return (db as any).transaction([OFFLINE_STORES.OUTBOX], 'readwrite', {
      durability: 'strict'
    });
  } catch (_) {
    return db.transaction([OFFLINE_STORES.OUTBOX], 'readwrite');
  }
}

// ============================================================================
// إدارة مخزن meta (المعرف الثابت للجهاز، اسم الجهاز، التخزين الدائم، وقت المزامنة)
// ============================================================================

export async function getMetaValue<T = any>(key: MetaEntryKey | string): Promise<T | null> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction([OFFLINE_STORES.META], 'readonly');
    const store = tx.objectStore(OFFLINE_STORES.META);
    const record = await reqToPromise<MetaRecord<T> | undefined>(store.get(key));
    return record !== undefined ? record.value : null;
  } catch (_) {
    return null;
  }
}

export async function setMetaValue<T = any>(key: MetaEntryKey | string, value: T): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction([OFFLINE_STORES.META], 'readwrite');
  const store = tx.objectStore(OFFLINE_STORES.META);
  const record: MetaRecord<T> = {
    key,
    value,
    updatedAt: new Date().toISOString()
  };
  store.put(record);
  await txDone(tx);
  notifyOfflineDbChange();
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const LOCAL_DEVICE_ID_KEY = 'mudaqqeq_device_id';
const LOCAL_DEVICE_NAME_KEY = 'mudaqqeq_device_name';

/**
 * توليد معرف جهاز ثابت deviceId (UUID) مرة واحدة فقط مع اسم جهاز يختاره المستخدم وحفظهما في meta
 */
export async function ensureDeviceIdentity(preferredDefaultName = 'نقطة بيع 1'): Promise<{
  deviceId: string;
  deviceName: string;
  deviceNameConfigured: boolean;
}> {
  let existingId = await getMetaValue<string>('deviceId');
  let existingName = await getMetaValue<string>('deviceName');
  let configured = Boolean(await getMetaValue<boolean>('deviceNameConfigured'));

  if (!existingId) {
    try {
      const fromStorage = localStorage.getItem(LOCAL_DEVICE_ID_KEY);
      if (fromStorage && fromStorage.trim()) {
        existingId = fromStorage.trim();
      }
    } catch (_) {}
  }

  if (!existingId) {
    existingId = generateUUID();
  }

  if (!existingName || !existingName.trim()) {
    try {
      const nameFromStorage = localStorage.getItem(LOCAL_DEVICE_NAME_KEY);
      if (nameFromStorage && nameFromStorage.trim()) {
        existingName = nameFromStorage.trim();
        configured = true;
      }
    } catch (_) {}
  }

  if (!existingName || !existingName.trim()) {
    existingName = preferredDefaultName;
  }

  try {
    localStorage.setItem(LOCAL_DEVICE_ID_KEY, existingId);
    localStorage.setItem(LOCAL_DEVICE_NAME_KEY, existingName);
  } catch (_) {}

  try {
    const db = await openOfflineDb();
    const tx = db.transaction([OFFLINE_STORES.META], 'readwrite');
    const store = tx.objectStore(OFFLINE_STORES.META);
    const now = new Date().toISOString();
    store.put({ key: 'deviceId', value: existingId, updatedAt: now });
    store.put({ key: 'deviceName', value: existingName, updatedAt: now });
    store.put({ key: 'deviceNameConfigured', value: configured, updatedAt: now });
    await txDone(tx);
    notifyOfflineDbChange();
  } catch (_) {}

  return {
    deviceId: existingId,
    deviceName: existingName,
    deviceNameConfigured: configured
  };
}

export async function saveDeviceName(newName: string): Promise<{ deviceId: string; deviceName: string }> {
  const cleaned = (newName || '').trim() || 'نقطة بيع 1';
  const identity = await ensureDeviceIdentity(cleaned);

  try {
    localStorage.setItem(LOCAL_DEVICE_NAME_KEY, cleaned);
  } catch (_) {}

  const db = await openOfflineDb();
  const tx = db.transaction([OFFLINE_STORES.META], 'readwrite');
  const store = tx.objectStore(OFFLINE_STORES.META);
  const now = new Date().toISOString();
  store.put({ key: 'deviceName', value: cleaned, updatedAt: now });
  store.put({ key: 'deviceNameConfigured', value: true, updatedAt: now });
  await txDone(tx);
  notifyOfflineDbChange();

  return {
    deviceId: identity.deviceId,
    deviceName: cleaned
  };
}

let persistRequestPromise: Promise<boolean> | null = null;

/**
 * طلب navigator.storage.persist() عند أول دخول وتسجيل النتيجة في meta
 */
export async function requestPersistentStorageOnFirstEntry(): Promise<boolean> {
  if (persistRequestPromise) {
    return persistRequestPromise;
  }

  persistRequestPromise = (async () => {
    if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
      try {
        await setMetaValue('storagePersisted', false);
        await setMetaValue('storagePersistedAt', new Date().toISOString());
      } catch (_) {}
      return false;
    }

    try {
      let granted = false;
      if (typeof navigator.storage.persisted === 'function') {
        granted = await navigator.storage.persisted();
      }
      if (!granted) {
        granted = await navigator.storage.persist();
      }
      const checkedAt = new Date().toISOString();
      await setMetaValue('storagePersisted', granted);
      await setMetaValue('storagePersistedAt', checkedAt);
      console.info(`[OfflineDB] navigator.storage.persist() result: ${granted ? 'granted' : 'denied'} (${checkedAt})`);
      return granted;
    } catch (err) {
      console.warn('[OfflineDB] Failed to request persistent storage:', err);
      try {
        await setMetaValue('storagePersisted', false);
        await setMetaValue('storagePersistedAt', new Date().toISOString());
      } catch (_) {}
      return false;
    }
  })();

  return persistRequestPromise;
}

// ============================================================================
// إدارة مخزن outbox بمعاملات durability: 'strict'
// ============================================================================

export const DELIVERY_PREP_OFFLINE_REJECT_MESSAGE =
  'لا يمكن إنشاء أو تعديل طلب تحضير التوصيل بدون اتصال بالإنترنت (العملية تتطلب اتصالاً مباشراً بالخادم ولا تُحفظ في طابور الأوفلاين)';

export function assertNotDeliveryPreparationOutboxOperation(input?: {
  type?: unknown;
  operationType?: unknown;
  payload?: unknown;
}): void {
  const t = String(input?.type ?? '').trim().toLowerCase();
  const opType = String(input?.operationType ?? '').trim().toLowerCase();
  const payload = input?.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : null;
  if (
    t.includes('deliveryprep') ||
    t.includes('delivery_prep') ||
    t.includes('delivery-prep') ||
    opType.includes('deliveryprep') ||
    opType.includes('delivery_prep') ||
    opType.includes('delivery-prep') ||
    Boolean(payload?.isDeliveryPreparation)
  ) {
    const err = new Error(DELIVERY_PREP_OFFLINE_REJECT_MESSAGE) as Error & { code?: string };
    err.code = 'DELIVERY_PREP_OFFLINE_FORBIDDEN';
    throw err;
  }
}

export async function enqueueOutboxOperation(
  input: Omit<OutboxOperation, 'id' | 'status' | 'retryCount' | 'deviceId' | 'deviceName' | 'createdAt' | 'updatedAt'> & {
    id?: string;
    status?: OutboxOperationStatus;
    retryCount?: number;
  }
): Promise<OutboxOperation> {
  assertNotDeliveryPreparationOutboxOperation(input);
  await assertOfflineWriteOwnership();
  const identity = await ensureDeviceIdentity();
  const now = new Date().toISOString();
  const op: OutboxOperation = {
    id: input.id || input.idempotencyKey || generateUUID(),
    idempotencyKey: input.idempotencyKey || input.id || generateUUID(),
    type: input.type,
    operationType: input.operationType || input.type,
    invoiceNumber: input.invoiceNumber,
    needsReview: input.needsReview,
    payload: input.payload,
    status: input.status || 'معلّقة',
    retryCount: input.retryCount ?? 0,
    lastError: input.lastError ?? null,
    deviceId: identity.deviceId,
    deviceName: identity.deviceName,
    userId: input.userId || input.createdByUserId,
    userName: input.userName || input.createdByUserName,
    createdByUserId: input.createdByUserId || input.userId,
    createdByUserName: input.createdByUserName || input.userName,
    deviceTime: input.deviceTime || now,
    createdAt: now,
    updatedAt: now
  };

  const db = await openOfflineDb();
  const tx = openStrictOutboxWriteTx(db);
  const store = tx.objectStore(OFFLINE_STORES.OUTBOX);
  store.put(op);
  await txDone(tx);
  await appendOperationToBackupDirectory(op);
  notifyOfflineDbChange();
  return op;
}

export async function updateOutboxOperation(
  id: string,
  patch: Partial<Omit<OutboxOperation, 'id'>>
): Promise<OutboxOperation | null> {
  await assertOfflineWriteOwnership();
  const db = await openOfflineDb();
  const tx = openStrictOutboxWriteTx(db);
  const store = tx.objectStore(OFFLINE_STORES.OUTBOX);
  const existing = await reqToPromise<OutboxOperation | undefined>(store.get(id));
  if (!existing) {
    await txDone(tx);
    return null;
  }
  const updated: OutboxOperation = {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: new Date().toISOString()
  };
  store.put(updated);
  await txDone(tx);
  notifyOfflineDbChange();
  return updated;
}

export async function removeOutboxOperation(id: string): Promise<void> {
  await assertOfflineWriteOwnership();
  const db = await openOfflineDb();
  const tx = openStrictOutboxWriteTx(db);
  const store = tx.objectStore(OFFLINE_STORES.OUTBOX);
  store.delete(id);
  await txDone(tx);
  notifyOfflineDbChange();
}

export async function getOutboxOperations(statusFilter?: OutboxOperationStatus): Promise<OutboxOperation[]> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction([OFFLINE_STORES.OUTBOX], 'readonly');
    const store = tx.objectStore(OFFLINE_STORES.OUTBOX);
    let results: OutboxOperation[];
    if (statusFilter) {
      const idx = store.index('status');
      results = await reqToPromise<OutboxOperation[]>(idx.getAll(statusFilter));
    } else {
      results = await reqToPromise<OutboxOperation[]>(store.getAll());
    }
    return (results || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch (_) {
    return [];
  }
}

export async function getOutboxPendingCount(): Promise<number> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction([OFFLINE_STORES.OUTBOX], 'readonly');
    const store = tx.objectStore(OFFLINE_STORES.OUTBOX);
    const all = await reqToPromise<OutboxOperation[]>(store.getAll());
    return (all || []).filter(
      op =>
        op.status === 'معلّقة' ||
        op.status === 'pending' ||
        op.status === 'syncing' ||
        op.status === 'failed'
    ).length;
  } catch (_) {
    return 0;
  }
}

export async function getPendingOfflineInvoices(currentUser: UserAccount | null): Promise<Invoice[]> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction([OFFLINE_STORES.OUTBOX], 'readonly');
    const store = tx.objectStore(OFFLINE_STORES.OUTBOX);
    const all = await reqToPromise<OutboxOperation[]>(store.getAll());
    const pendingOps = (all || [])
      .filter(
        op =>
          op.type === 'createInvoice' &&
          (op.status === 'معلّقة' || op.status === 'pending' || op.status === 'syncing' || op.status === 'failed') &&
          op.payload?.offlineInvoice
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const invoices: Invoice[] = pendingOps.map(op => ({
      ...(op.payload.offlineInvoice as Invoice),
      isOffline: true,
      offlinePending: true,
      needsReview: Boolean(op.needsReview ?? op.payload.offlineInvoice?.needsReview)
    }));

    return sanitizeInvoicesForUserPermissions(invoices, currentUser);
  } catch (_) {
    return [];
  }
}

// ============================================================================
// فلترة البيانات حسب صلاحيات المستخدم قبل الحفظ في IndexedDB
// ============================================================================

export function sanitizeItemsForUserPermissions(items: Item[], user: UserAccount | null): Item[] {
  if (!Array.isArray(items)) return [];
  const isOwnerOrDesigner = user?.role === 'designer' || Boolean(user?.isOwner);
  const canViewSale = isOwnerOrDesigner || hasPermission(user, 'prices.view_sale');
  const canViewPurchase = isOwnerOrDesigner || hasPermission(user, 'prices.view_purchase');
  const canViewPackaging = isOwnerOrDesigner || hasPermission(user, 'prices.view_packaging');

  return items.map(item => {
    const copy: any = {
      ...item,
      printName: item.printName ? String(item.printName).trim().slice(0, 120) : ''
    };
    if (!canViewPurchase) {
      delete copy.purchasePrice;
    }
    if (!canViewPackaging) {
      delete copy.packagingCost;
    }
    if (!canViewSale) {
      delete copy.salePrice;
      delete copy.minPrice;
    }
    return copy as Item;
  });
}

export function sanitizeCostsForUserPermissions(costs: ItemPlatformCost[], _user: UserAccount | null): ItemPlatformCost[] {
  if (!Array.isArray(costs)) return [];
  return costs.map(c => ({ ...c }));
}

export function sanitizeInvoicesForUserPermissions(invoices: Invoice[], user: UserAccount | null): Invoice[] {
  if (!Array.isArray(invoices)) return [];
  const isOwnerOrDesigner = user?.role === 'designer' || Boolean(user?.isOwner);
  const canViewPurchase = isOwnerOrDesigner || hasPermission(user, 'prices.view_purchase');
  const canViewPackaging = isOwnerOrDesigner || hasPermission(user, 'prices.view_packaging');
  const canViewProfit = isOwnerOrDesigner || hasPermission(user, 'reports.view_profit');

  return invoices.map(inv => {
    const copy: any = { ...inv };
    if (!canViewProfit) {
      delete copy.profit;
    }
    if (Array.isArray(inv.lines)) {
      copy.lines = inv.lines.map(line => {
        const lineCopy: any = { ...line };
        if (!canViewPurchase) delete lineCopy.purchasePriceAtSale;
        if (!canViewPackaging) delete lineCopy.packagingCostAtSale;
        if (!canViewProfit) delete lineCopy.unitProfit;
        return lineCopy;
      });
    }
    return copy as Invoice;
  });
}

function buildPartyBalancesSnapshot(
  customers: Customer[],
  platforms: Platform[],
  pendingInvoices: Invoice[],
  nowIso: string
): PartyBalanceSnapshot[] {
  const balances: PartyBalanceSnapshot[] = [];

  for (const c of customers || []) {
    const customerPending = pendingInvoices.filter(
      inv =>
        inv.customerId === c.id ||
        (inv.creditPartyType === 'customer' && inv.creditPartyId === c.id) ||
        (inv.customerName && inv.customerName.trim() === c.name.trim())
    );
    balances.push({
      partyType: 'customer',
      partyId: c.id,
      partyName: c.name,
      currentBalance: typeof c.currentBalance === 'number' ? c.currentBalance : Number(c.openingBalance || 0),
      pendingInvoicesCount: customerPending.length,
      updatedAt: nowIso
    });
  }

  for (const p of platforms || []) {
    const platformPending = pendingInvoices.filter(
      inv => inv.platformId === p.id || (inv.creditPartyType === 'platform' && inv.creditPartyId === p.id)
    );
    const pendingSum = platformPending.reduce((sum, inv) => {
      const rem =
        typeof inv.remainingAmount === 'number'
          ? inv.remainingAmount
          : typeof inv.creditDueAmount === 'number'
          ? inv.creditDueAmount
          : Number(inv.netAmount || 0);
      return sum + (rem > 0 ? rem : 0);
    }, 0);
    balances.push({
      partyType: 'platform',
      partyId: p.id,
      partyName: p.name,
      currentBalance: typeof p.currentBalance === 'number' ? p.currentBalance : pendingSum,
      pendingInvoicesCount: platformPending.length,
      updatedAt: nowIso
    });
  }

  return balances;
}

// ============================================================================
// تشفير المستخدمين بـ AES-GCM بمفتاح جهاز غير قابل للاستخراج (CryptoKey extractable=false)
// والتحقق من بصمة كلمة المرور أوفلاين بـ PBKDF2-SHA256 (200,000 دورة)
// ============================================================================

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = String(hex || '').trim();
  if (clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const strA = String(a || '').toLowerCase();
  const strB = String(b || '').toLowerCase();
  if (!strA || !strB || strA.length !== strB.length) return false;
  let diff = 0;
  for (let i = 0; i < strA.length; i++) {
    diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return diff === 0;
}

let deviceUsersCryptoKeyPromise: Promise<CryptoKey> | null = null;

/**
 * جلب أو إنشاء مفتاح تشفير المستخدمين على الجهاز (AES-GCM 256-bit، extractable: false)
 * محفوظ في مخزن meta داخل IndexedDB
 */
export async function getOrCreateDeviceUsersCryptoKey(): Promise<CryptoKey> {
  if (deviceUsersCryptoKeyPromise) {
    return deviceUsersCryptoKeyPromise;
  }

  deviceUsersCryptoKeyPromise = (async () => {
    try {
      const existingKey = await getMetaValue<CryptoKey>('deviceUsersCryptoKey');
      if (
        existingKey &&
        typeof existingKey === 'object' &&
        'type' in existingKey &&
        'algorithm' in existingKey
      ) {
        return existingKey;
      }

      const newKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // extractable = false إلزاميًا
        ['encrypt', 'decrypt']
      );

      await setMetaValue('deviceUsersCryptoKey', newKey);
      return newKey;
    } catch (err) {
      deviceUsersCryptoKeyPromise = null;
      throw err;
    }
  })();

  return deviceUsersCryptoKeyPromise;
}

export async function encryptUserAccountForStore(
  user: UserAccount,
  cryptoKey?: CryptoKey
): Promise<EncryptedUserRecord> {
  const key = cryptoKey || (await getOrCreateDeviceUsersCryptoKey());
  const cleanUser: UserAccount = { ...user };
  // كلمة السر نفسها لا تُخزَّن أبدًا
  delete (cleanUser as any).password;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(cleanUser));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return {
    id: cleanUser.id,
    encrypted: true,
    algorithm: 'AES-GCM',
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(new Uint8Array(cipherBuffer)),
    updatedAt: new Date().toISOString()
  };
}

export async function decryptUserAccountFromStore(
  record: EncryptedUserRecord | UserAccount | any,
  cryptoKey?: CryptoKey
): Promise<UserAccount | null> {
  if (!record || typeof record !== 'object') return null;

  if (record.encrypted === true && record.ivHex && record.ciphertextHex) {
    try {
      const key = cryptoKey || (await getOrCreateDeviceUsersCryptoKey());
      const iv = hexToBytes(record.ivHex);
      const ciphertext = hexToBytes(record.ciphertextHex);
      const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        ciphertext as BufferSource
      );
      const jsonStr = new TextDecoder().decode(plainBuffer);
      const parsed = JSON.parse(jsonStr) as UserAccount;
      delete (parsed as any).password;
      return parsed;
    } catch (err) {
      console.warn('[OfflineDB] Failed to decrypt user record:', err);
      return null;
    }
  }

  // توافق رجعي في حال وجود سجل غير مشفر قديم
  if (record.id && record.name) {
    const copy = { ...record } as UserAccount;
    delete (copy as any).password;
    return copy;
  }

  return null;
}

export async function getEncryptedUsersRawFromOfflineStore(): Promise<EncryptedUserRecord[]> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction([OFFLINE_STORES.USERS], 'readonly');
    const store = tx.objectStore(OFFLINE_STORES.USERS);
    const all = await reqToPromise<EncryptedUserRecord[]>(store.getAll());
    return all || [];
  } catch (_) {
    return [];
  }
}

export async function getDecryptedOfflineUsers(): Promise<UserAccount[]> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction([OFFLINE_STORES.USERS, OFFLINE_STORES.OUTBOX], 'readonly');
    const usersStore = tx.objectStore(OFFLINE_STORES.USERS);
    const outboxStore = tx.objectStore(OFFLINE_STORES.OUTBOX);

    const [rawRecords, allOutbox] = await Promise.all([
      reqToPromise<any[]>(usersStore.getAll()),
      reqToPromise<OutboxOperation[]>(outboxStore.getAll())
    ]);

    if (!rawRecords || rawRecords.length === 0) return [];

    const cryptoKey = await getOrCreateDeviceUsersCryptoKey();
    const decryptedList: UserAccount[] = [];
    for (const rec of rawRecords) {
      const dec = await decryptUserAccountFromStore(rec, cryptoKey);
      if (dec && dec.id) {
        decryptedList.push(dec);
      }
    }

    // تطبيق أي تعديلات صلاحيات معلقة في outbox بالترتيب الزمني
    const pendingPermOps = (allOutbox || [])
      .filter(
        op =>
          (op.type === 'updatePermissions' || op.operationType === 'updateUserPermissions') &&
          (op.status === 'معلّقة' || op.status === 'pending' || op.status === 'syncing' || op.status === 'failed')
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const op of pendingPermOps) {
      const targetId = op.payload?.targetUserId;
      const idx = decryptedList.findIndex(u => u.id === targetId);
      if (idx >= 0 && Array.isArray(op.payload?.permissions)) {
        decryptedList[idx] = {
          ...decryptedList[idx],
          permissions: op.payload.permissions,
          cashboxConfig:
            op.payload.cashboxConfig !== undefined
              ? op.payload.cashboxConfig
              : decryptedList[idx].cashboxConfig,
          permissionsUpdatedAt: op.payload.editedAt || op.deviceTime || op.createdAt,
          permissionsUpdatedByDevice: op.deviceId
        };
      }
    }

    return decryptedList;
  } catch (err) {
    console.warn('[OfflineDB] Failed to get decrypted offline users:', err);
    return [];
  }
}

/**
 * حساب بصمة التحقق أوفلاين في المتصفح باستخدام WebCrypto PBKDF2-SHA256 (200,000 دورة)
 */
export async function computeBrowserOfflineVerifier(
  password: string,
  offlineSalt: string,
  iterations: number = OFFLINE_PBKDF2_ITERATIONS
): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(password || '')),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const validIterations =
    Number.isFinite(Number(iterations)) && Number(iterations) >= 10000
      ? Number(iterations)
      : OFFLINE_PBKDF2_ITERATIONS;

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(String(offlineSalt || '')),
      iterations: validIterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

/**
 * تسجيل حدث دخول أو خروج أوفلاين في outbox بمعاملة durability: 'strict'
 * ليتم رفعه إلى سجل التدقيق عند المزامنة
 */
export async function recordOfflineAuthEventInOutbox(params: {
  action: 'OFFLINE_LOGIN' | 'OFFLINE_LOGOUT';
  user: UserAccount;
  notes?: string;
}): Promise<OutboxOperation> {
  await assertOfflineWriteOwnership();
  const nowIso = new Date().toISOString();
  const idemKey = generateUUID();
  return enqueueOutboxOperation({
    id: idemKey,
    idempotencyKey: idemKey,
    type: 'authAudit',
    operationType: params.action,
    userId: params.user.id,
    userName: params.user.name,
    createdByUserId: params.user.id,
    createdByUserName: params.user.name,
    deviceTime: nowIso,
    payload: {
      type: 'authAudit',
      operationType: params.action,
      auditAction: params.action,
      userId: params.user.id,
      userName: params.user.name,
      userRole: params.user.role,
      notes:
        params.notes ||
        (params.action === 'OFFLINE_LOGIN'
          ? 'تسجيل دخول بدون إنترنت'
          : 'تسجيل خروج بدون إنترنت')
    }
  });
}

/**
 * تسجيل الدخول بدون إنترنت:
 * - يفك تشفير المستخدمين من مخزن users.
 * - يتحقق من وجود بصمة offlineVerifier و offlineSalt؛ وإن لم توجد يعيد الرسالة المطلوبة نصًا:
 *   «سجّل الدخول مرة واحدة مع وجود الإنترنت أولًا»
 * - يحسب البصمة بـ WebCrypto PBKDF2-SHA256 ويقارنها بدون أي قفل بعد المحاولات الفاشلة.
 * - ينشئ جلسة تحمل offline: true بصلاحيات النسخة المحلية ويسجل حدث OFFLINE_LOGIN في outbox.
 */
export async function authenticateOfflineUser(
  usernameOrPhone: string,
  password: string
): Promise<{ success: true; session: AuthSession } | { success: false; error: string }> {
  try {
    await assertOfflineWriteOwnership();
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'العمل أوفلاين متاح في تبويب واحد فقط؛ أغلِق التبويب الآخر ثم أعد المحاولة.'
    };
  }

  const rawInput = String(usernameOrPhone || '').trim();
  const cleanUsername = rawInput.toLowerCase();

  if (!rawInput || !password) {
    return { success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' };
  }

  const users = await getDecryptedOfflineUsers();
  if (!users || users.length === 0) {
    return { success: false, error: 'سجّل الدخول مرة واحدة مع وجود الإنترنت أولًا' };
  }

  const matchedUser = users.find(
    u =>
      (u.username && u.username.trim().toLowerCase() === cleanUsername) ||
      (u.phone && u.phone.trim() === rawInput)
  );

  if (!matchedUser) {
    return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
  }

  if (!matchedUser.offlineVerifier || !matchedUser.offlineSalt) {
    if (matchedUser.status === 'inactive' || matchedUser.status === 'موقوف') {
      return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    }
    return { success: false, error: 'سجّل الدخول مرة واحدة مع وجود الإنترنت أولًا' };
  }

  const computedVerifier = await computeBrowserOfflineVerifier(
    password,
    matchedUser.offlineSalt,
    Number(matchedUser.offlineIterations) || OFFLINE_PBKDF2_ITERATIONS
  );

  if (!constantTimeEqualHex(computedVerifier, matchedUser.offlineVerifier)) {
    // لا قفل بعد المحاولات الفاشلة أوفلاين
    return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
  }

  if (matchedUser.status === 'inactive' || matchedUser.status === 'موقوف') {
    return { success: false, error: 'هذا الحساب موقوف، راجع مالك النظام' };
  }

  const sessionUser: UserAccount = { ...matchedUser };
  delete (sessionUser as any).password;

  const session: AuthSession = {
    token: `offline_${generateUUID()}`,
    user: sessionUser,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    offline: true
  };

  await recordOfflineAuthEventInOutbox({
    action: 'OFFLINE_LOGIN',
    user: sessionUser
  });

  return { success: true, session };
}

/**
 * تعديل صلاحيات مستخدم بدون إنترنت:
 * - مسموح فقط لمن يملك صلاحية تعديل الصلاحيات (designer / isOwner / permissions.manage).
 * - يُطبَّق على الجهاز فورًا في مخزن users المشفر.
 * - يُحفظ في outbox بوقت التعديل (editedAt) ليتم رفعه وحسم أي تعارض عند المزامنة.
 */
export async function updateOfflineUserPermissionsInDb(params: {
  targetUserId: string;
  permissions: PermissionKey[];
  cashboxConfig?: UserAccount['cashboxConfig'];
  actor: UserAccount;
  editedAt?: string;
}): Promise<{
  success: boolean;
  user: UserAccount;
  outboxOp: OutboxOperation;
}> {
  await assertOfflineWriteOwnership();
  const { targetUserId, permissions, cashboxConfig, actor } = params;
  const isOwnerOrDesigner = actor.role === 'designer' || Boolean(actor.isOwner);
  const canManagePermissions = isOwnerOrDesigner || hasPermission(actor, 'permissions.manage');

  if (!canManagePermissions) {
    throw new Error('غير مصرح لك بتعديل الصلاحيات');
  }

  const users = await getDecryptedOfflineUsers();
  const targetUser = users.find(u => u.id === targetUserId);
  if (!targetUser) {
    throw new Error('المستخدم المطلوب غير موجود في التخزين المحلي');
  }

  if ((targetUser.role === 'designer' || targetUser.isOwner) && !isOwnerOrDesigner) {
    throw new Error('لا يمكن تعديل صلاحيات مالك النظام');
  }

  // المدير المفوض لا يمنح صلاحية لا يملكها
  const sanitizedPermissions = isOwnerOrDesigner
    ? [...permissions]
    : permissions.filter(p => actor.permissions?.includes(p));

  const identity = await ensureDeviceIdentity();
  const editedAt = params.editedAt || new Date().toISOString();
  const baseUpdatedAt = targetUser.permissionsUpdatedAt || '';

  const updatedUser: UserAccount = {
    ...targetUser,
    permissions: sanitizedPermissions,
    cashboxConfig: cashboxConfig !== undefined ? cashboxConfig : targetUser.cashboxConfig,
    permissionsUpdatedAt: editedAt,
    permissionsUpdatedByDevice: identity.deviceId
  };

  // 1) تحديث المستخدم المشفر في مخزن users فورًا
  const cryptoKey = await getOrCreateDeviceUsersCryptoKey();
  const encryptedRecord = await encryptUserAccountForStore(updatedUser, cryptoKey);
  const db = await openOfflineDb();
  const userWriteTx = db.transaction([OFFLINE_STORES.USERS], 'readwrite');
  userWriteTx.objectStore(OFFLINE_STORES.USERS).put(encryptedRecord);
  await txDone(userWriteTx);

  // 2) حفظ العملية في outbox بوقت التعديل ومعاملة durability: 'strict'
  const idemKey = generateUUID();
  const outboxOp = await enqueueOutboxOperation({
    id: idemKey,
    idempotencyKey: idemKey,
    type: 'updatePermissions',
    operationType: 'updateUserPermissions',
    userId: actor.id,
    userName: actor.name,
    createdByUserId: actor.id,
    createdByUserName: actor.name,
    deviceTime: editedAt,
    payload: {
      type: 'updatePermissions',
      operationType: 'updateUserPermissions',
      targetUserId: updatedUser.id,
      targetUserName: updatedUser.name,
      permissions: updatedUser.permissions,
      cashboxConfig: updatedUser.cashboxConfig,
      editedAt,
      baseUpdatedAt
    }
  });

  notifyOfflineDbChange();
  return {
    success: true,
    user: updatedUser,
    outboxOp
  };
}

// ============================================================================
// حفظ وتحميل النسخة الكاملة من المخازن (catalog, credit, users, meta)
// ============================================================================

export async function saveOfflineSnapshot(params: {
  user: UserAccount;
  items?: Item[];
  categories?: ProductCategory[];
  platforms?: Platform[];
  costs?: ItemPlatformCost[];
  customers?: Customer[];
  cashboxes?: Cashbox[];
  cashboxAssignments?: UserCashboxAssignment[];
  settings?: CatalogSettingsRecord;
  users?: UserAccount[];
  invoices?: Invoice[];
  returns?: ReturnRecord[];
  syncedAt?: string;
}): Promise<string> {
  const db = await openOfflineDb();
  const nowIso = params.syncedAt || new Date().toISOString();

  const sanitizedItems = params.items ? sanitizeItemsForUserPermissions(params.items, params.user) : undefined;
  const sanitizedCosts = params.costs ? sanitizeCostsForUserPermissions(params.costs, params.user) : undefined;
  const sanitizedInvoices = params.invoices ? sanitizeInvoicesForUserPermissions(params.invoices, params.user) : undefined;

  const pendingInvoices = sanitizedInvoices
    ? sanitizedInvoices.filter(
        inv =>
          inv.status !== 'ملغاة' &&
          inv.status !== 'مرتجع' &&
          inv.creditStatus !== 'مسددة' &&
          (inv.status === 'معلّقة' ||
            inv.creditStatus === 'معلّقة' ||
            inv.paymentType === 'آجل' ||
            inv.paymentType === 'جزئي' ||
            (typeof inv.remainingAmount === 'number' && inv.remainingAmount > 0.009) ||
            (typeof inv.creditDueAmount === 'number' && inv.creditDueAmount > 0.009))
      )
    : undefined;

  // تجهيز وتشفير كل المستخدمين بـ AES-GCM قبل فتح معاملة IndexedDB
  const existingDecryptedUsers = await getDecryptedOfflineUsers();
  const existingUsersById = new Map<string, UserAccount>();
  for (const eu of existingDecryptedUsers) {
    if (eu && eu.id) {
      existingUsersById.set(eu.id, eu);
    }
  }

  const mergedUsersMap = new Map<string, UserAccount>();
  // إذا لم تُمرَّر قائمة كاملة من المستخدمين، نحتفظ بالمستخدمين المحليين الحاليين
  if (!Array.isArray(params.users) || params.users.length <= 1) {
    for (const [uid, eu] of existingUsersById.entries()) {
      mergedUsersMap.set(uid, eu);
    }
  }

  const incomingUsers: UserAccount[] = [];
  if (Array.isArray(params.users)) {
    for (const u of params.users) {
      if (u && u.id) incomingUsers.push(u);
    }
  }
  if (params.user && params.user.id) {
    const existingIdx = incomingUsers.findIndex(u => u.id === params.user.id);
    if (existingIdx >= 0) {
      incomingUsers[existingIdx] = {
        ...incomingUsers[existingIdx],
        ...params.user,
        offlineVerifier:
          params.user.offlineVerifier ?? incomingUsers[existingIdx].offlineVerifier,
        offlineSalt:
          params.user.offlineSalt ?? incomingUsers[existingIdx].offlineSalt,
        offlineIterations:
          params.user.offlineIterations ?? incomingUsers[existingIdx].offlineIterations
      };
    } else {
      incomingUsers.push(params.user);
    }
  }

  for (const u of incomingUsers) {
    const prev = existingUsersById.get(u.id);
    const mergedUser: UserAccount = {
      ...(prev || {}),
      ...u,
      offlineVerifier: u.offlineVerifier !== undefined ? u.offlineVerifier : prev?.offlineVerifier,
      offlineSalt: u.offlineSalt !== undefined ? u.offlineSalt : prev?.offlineSalt,
      offlineIterations:
        u.offlineIterations !== undefined ? u.offlineIterations : prev?.offlineIterations,
      permissionsUpdatedAt:
        u.permissionsUpdatedAt !== undefined ? u.permissionsUpdatedAt : prev?.permissionsUpdatedAt,
      permissionsUpdatedByDevice:
        u.permissionsUpdatedByDevice !== undefined
          ? u.permissionsUpdatedByDevice
          : prev?.permissionsUpdatedByDevice
    };
    delete (mergedUser as any).password;
    mergedUsersMap.set(u.id, mergedUser);
  }

  const cryptoKey = await getOrCreateDeviceUsersCryptoKey();
  const encryptedUserRecords: EncryptedUserRecord[] = await Promise.all(
    Array.from(mergedUsersMap.values()).map(u => encryptUserAccountForStore(u, cryptoKey))
  );

  const tx = db.transaction(
    [OFFLINE_STORES.CATALOG, OFFLINE_STORES.CREDIT, OFFLINE_STORES.USERS, OFFLINE_STORES.META],
    'readwrite'
  );

  const catalogStore = tx.objectStore(OFFLINE_STORES.CATALOG);
  const creditStore = tx.objectStore(OFFLINE_STORES.CREDIT);
  const usersStore = tx.objectStore(OFFLINE_STORES.USERS);
  const metaStore = tx.objectStore(OFFLINE_STORES.META);

  // التحقق من تغير المستخدم أو دوره لتجنب بقاء بيانات الكتالوج بصلاحيات مستخدم سابق
  const prevUserIdRec = await reqToPromise<MetaRecord<string> | undefined>(metaStore.get('syncedUserId'));
  const prevRoleRec = await reqToPromise<MetaRecord<string> | undefined>(metaStore.get('syncedUserRole'));
  if (
    (prevUserIdRec?.value && prevUserIdRec.value !== params.user.id) ||
    (prevRoleRec?.value && prevRoleRec.value !== params.user.role)
  ) {
    catalogStore.clear();
    creditStore.clear();
  }

  if (sanitizedItems !== undefined) {
    catalogStore.put({ key: 'items', data: sanitizedItems, updatedAt: nowIso } satisfies CatalogRecord);
  }
  if (params.categories !== undefined) {
    catalogStore.put({ key: 'categories', data: params.categories, updatedAt: nowIso } satisfies CatalogRecord);
  }
  if (params.platforms !== undefined) {
    catalogStore.put({ key: 'platforms', data: params.platforms, updatedAt: nowIso } satisfies CatalogRecord);
  }
  if (sanitizedCosts !== undefined) {
    catalogStore.put({ key: 'costs', data: sanitizedCosts, updatedAt: nowIso } satisfies CatalogRecord);
  }
  if (params.customers !== undefined) {
    catalogStore.put({ key: 'customers', data: params.customers, updatedAt: nowIso } satisfies CatalogRecord);
  }
  if (params.cashboxes !== undefined) {
    catalogStore.put({ key: 'cashboxes', data: params.cashboxes, updatedAt: nowIso } satisfies CatalogRecord);
  }
  if (params.cashboxAssignments !== undefined) {
    catalogStore.put({ key: 'cashboxAssignments', data: params.cashboxAssignments, updatedAt: nowIso } satisfies CatalogRecord);
  }
  if (params.settings !== undefined) {
    catalogStore.put({ key: 'settings', data: params.settings, updatedAt: nowIso } satisfies CatalogRecord);
  }

  const provMapRec = await reqToPromise<
    MetaRecord<Record<string, { provisionalInvoiceNumber: string; finalInvoiceNumber: string; needsReview?: boolean; reviewReasons?: string[] }>> | undefined
  >(metaStore.get('provisionalToFinalMap'));
  const provMap = provMapRec?.value || {};

  const enrichedInvoices = sanitizedInvoices
    ? sanitizedInvoices.map(inv => {
        if (inv.offlineProvisionalNo) return inv;
        const matchEntry = Object.values(provMap).find(m => m.finalInvoiceNumber === inv.invoiceNumber);
        if (matchEntry) {
          return {
            ...inv,
            offlineProvisionalNo: matchEntry.provisionalInvoiceNumber,
            tempInvoiceNumber: matchEntry.provisionalInvoiceNumber,
            needsReview: inv.needsReview ?? matchEntry.needsReview,
            reviewReasons: inv.reviewReasons && inv.reviewReasons.length > 0 ? inv.reviewReasons : matchEntry.reviewReasons
          };
        }
        return inv;
      })
    : undefined;

  if (enrichedInvoices !== undefined) {
    creditStore.put({ key: 'invoices', data: enrichedInvoices, updatedAt: nowIso } satisfies CreditRecord);
  }
  if (pendingInvoices !== undefined) {
    creditStore.put({ key: 'pendingInvoices', data: pendingInvoices, updatedAt: nowIso } satisfies CreditRecord);
  }
  if (params.returns !== undefined) {
    creditStore.put({ key: 'returns', data: params.returns, updatedAt: nowIso } satisfies CreditRecord);
  }

  if (params.customers !== undefined || params.platforms !== undefined || pendingInvoices !== undefined) {
    const existingCustomersRec =
      params.customers !== undefined
        ? { data: params.customers }
        : await reqToPromise<CatalogRecord<Customer[]> | undefined>(catalogStore.get('customers'));
    const existingPlatformsRec =
      params.platforms !== undefined
        ? { data: params.platforms }
        : await reqToPromise<CatalogRecord<Platform[]> | undefined>(catalogStore.get('platforms'));
    const existingPendingRec =
      pendingInvoices !== undefined
        ? { data: pendingInvoices }
        : await reqToPromise<CreditRecord<Invoice[]> | undefined>(creditStore.get('pendingInvoices'));

    const partyBalances = buildPartyBalancesSnapshot(
      existingCustomersRec?.data || [],
      existingPlatformsRec?.data || [],
      existingPendingRec?.data || [],
      nowIso
    );
    creditStore.put({ key: 'partyBalances', data: partyBalances, updatedAt: nowIso } satisfies CreditRecord);
  }

  // حفظ جميع المستخدمين مشفرين بـ AES-GCM في مخزن users
  usersStore.clear();
  for (const encRec of encryptedUserRecords) {
    usersStore.put(encRec);
  }

  metaStore.put({ key: 'lastSyncAt', value: nowIso, updatedAt: nowIso } satisfies MetaRecord);
  metaStore.put({ key: 'syncedUserId', value: params.user.id, updatedAt: nowIso } satisfies MetaRecord);
  metaStore.put({ key: 'syncedUserRole', value: params.user.role, updatedAt: nowIso } satisfies MetaRecord);

  await txDone(tx);
  notifyOfflineDbChange();
  return nowIso;
}

export async function updateOfflineCachedSalesRules(nextRules: SalesRules): Promise<void> {
  try {
    const db = await openOfflineDb();
    const nowIso = new Date().toISOString();
    const readTx = db.transaction([OFFLINE_STORES.CATALOG], 'readonly');
    const existingRec = await reqToPromise<CatalogRecord<CatalogSettingsRecord> | undefined>(
      readTx.objectStore(OFFLINE_STORES.CATALOG).get('settings')
    );
    const writeTx = db.transaction([OFFLINE_STORES.CATALOG], 'readwrite');
    writeTx.objectStore(OFFLINE_STORES.CATALOG).put({
      key: 'settings',
      data: {
        ...(existingRec?.data || {
          taxSettings: { taxInclusive: true, platformCommissionOn: 'before_tax' }
        }),
        salesRules: nextRules
      },
      updatedAt: nowIso
    } satisfies CatalogRecord<CatalogSettingsRecord>);
    await txDone(writeTx);
  } catch {
    // تجاهل أخطاء تحديث الكاش المحلي في البيئات التي لا تدعم IndexedDB
  }
}

/**
 * قراءة المخازن المحلية من IndexedDB عند فتح التطبيق أوفلاين
 */
export async function loadOfflineSnapshot(currentUser: UserAccount | null): Promise<OfflineSnapshotData | null> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction(
      [OFFLINE_STORES.CATALOG, OFFLINE_STORES.CREDIT, OFFLINE_STORES.USERS, OFFLINE_STORES.META],
      'readonly'
    );

    const catalogStore = tx.objectStore(OFFLINE_STORES.CATALOG);
    const creditStore = tx.objectStore(OFFLINE_STORES.CREDIT);
    const usersStore = tx.objectStore(OFFLINE_STORES.USERS);
    const metaStore = tx.objectStore(OFFLINE_STORES.META);

    const [
      itemsRec,
      categoriesRec,
      platformsRec,
      costsRec,
      customersRec,
      cashboxesRec,
      assignmentsRec,
      settingsRec,
      pendingInvoicesRec,
      partyBalancesRec,
      invoicesRec,
      returnsRec,
      allEncryptedUsers,
      lastSyncRec
    ] = await Promise.all([
      reqToPromise<CatalogRecord<Item[]> | undefined>(catalogStore.get('items')),
      reqToPromise<CatalogRecord<ProductCategory[]> | undefined>(catalogStore.get('categories')),
      reqToPromise<CatalogRecord<Platform[]> | undefined>(catalogStore.get('platforms')),
      reqToPromise<CatalogRecord<ItemPlatformCost[]> | undefined>(catalogStore.get('costs')),
      reqToPromise<CatalogRecord<Customer[]> | undefined>(catalogStore.get('customers')),
      reqToPromise<CatalogRecord<Cashbox[]> | undefined>(catalogStore.get('cashboxes')),
      reqToPromise<CatalogRecord<UserCashboxAssignment[]> | undefined>(catalogStore.get('cashboxAssignments')),
      reqToPromise<CatalogRecord<CatalogSettingsRecord> | undefined>(catalogStore.get('settings')),
      reqToPromise<CreditRecord<Invoice[]> | undefined>(creditStore.get('pendingInvoices')),
      reqToPromise<CreditRecord<PartyBalanceSnapshot[]> | undefined>(creditStore.get('partyBalances')),
      reqToPromise<CreditRecord<Invoice[]> | undefined>(creditStore.get('invoices')),
      reqToPromise<CreditRecord<ReturnRecord[]> | undefined>(creditStore.get('returns')),
      reqToPromise<any[]>(usersStore.getAll()),
      reqToPromise<MetaRecord<string> | undefined>(metaStore.get('lastSyncAt'))
    ]);

    const rawItems = itemsRec?.data || [];
    const rawInvoices = invoicesRec?.data || [];
    const rawPendingInvoices = pendingInvoicesRec?.data || [];

    // فك تشفير المستخدمين من مخزن users
    const decryptedUsers: UserAccount[] = [];
    if (Array.isArray(allEncryptedUsers) && allEncryptedUsers.length > 0) {
      const cryptoKey = await getOrCreateDeviceUsersCryptoKey();
      for (const rec of allEncryptedUsers) {
        const dec = await decryptUserAccountFromStore(rec, cryptoKey);
        if (dec && dec.id) {
          decryptedUsers.push(dec);
        }
      }
    }

    // دمج الفواتير والتحصيلات وتعديلات الصلاحيات المحلية المعلقة في outbox
    let pendingOutboxOps: OutboxOperation[] = [];
    let pendingCollectOps: OutboxOperation[] = [];
    let pendingPermOps: OutboxOperation[] = [];
    try {
      const outboxTx = db.transaction([OFFLINE_STORES.OUTBOX], 'readonly');
      const outboxStore = outboxTx.objectStore(OFFLINE_STORES.OUTBOX);
      const allOps = await reqToPromise<OutboxOperation[]>(outboxStore.getAll());
      pendingOutboxOps = (allOps || []).filter(
        op =>
          op.type === 'createInvoice' &&
          (op.status === 'معلّقة' || op.status === 'pending' || op.status === 'syncing' || op.status === 'failed') &&
          op.payload?.offlineInvoice
      );
      pendingCollectOps = (allOps || []).filter(
        op =>
          (op.type === 'collectCredit' || op.operationType === 'collectCreditInvoices') &&
          (op.status === 'معلّقة' || op.status === 'pending' || op.status === 'syncing' || op.status === 'failed')
      );
      pendingPermOps = (allOps || [])
        .filter(
          op =>
            (op.type === 'updatePermissions' || op.operationType === 'updateUserPermissions') &&
            (op.status === 'معلّقة' || op.status === 'pending' || op.status === 'syncing' || op.status === 'failed')
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch (_) {}

    for (const op of pendingPermOps) {
      const targetId = op.payload?.targetUserId;
      const uIdx = decryptedUsers.findIndex(u => u.id === targetId);
      if (uIdx >= 0 && Array.isArray(op.payload?.permissions)) {
        decryptedUsers[uIdx] = {
          ...decryptedUsers[uIdx],
          permissions: op.payload.permissions,
          cashboxConfig:
            op.payload.cashboxConfig !== undefined
              ? op.payload.cashboxConfig
              : decryptedUsers[uIdx].cashboxConfig,
          permissionsUpdatedAt: op.payload.editedAt || op.deviceTime || op.createdAt,
          permissionsUpdatedByDevice: op.deviceId
        };
      }
    }

    const collectedOfflineInvoiceNums = new Set<string>();
    for (const cop of pendingCollectOps) {
      const nums: string[] = Array.isArray(cop.payload?.invoiceNumbers) ? cop.payload.invoiceNumbers : [];
      for (const n of nums) {
        if (n) collectedOfflineInvoiceNums.add(String(n).trim());
      }
    }

    const mergedInvoices = [...rawInvoices];
    for (const op of pendingOutboxOps) {
      const offInv: Invoice = {
        ...op.payload.offlineInvoice,
        isOffline: true,
        offlinePending: true,
        offlineCollectionPending:
          Boolean(op.payload.offlineInvoice?.offlineCollectionPending) ||
          collectedOfflineInvoiceNums.has(op.payload.offlineInvoice?.invoiceNumber),
        needsReview: Boolean(op.needsReview ?? op.payload.offlineInvoice?.needsReview)
      };
      const existingIdx = mergedInvoices.findIndex(i => i.invoiceNumber === offInv.invoiceNumber);
      if (existingIdx >= 0) {
        mergedInvoices[existingIdx] = offInv;
      } else {
        mergedInvoices.unshift(offInv);
      }
    }

    const mergedPendingInvoices = rawPendingInvoices.map(inv => {
      if (inv.offlineCollectionPending || collectedOfflineInvoiceNums.has(inv.invoiceNumber)) {
        return {
          ...inv,
          offlineCollectionPending: true
        };
      }
      return inv;
    });

    for (const op of pendingOutboxOps) {
      const offInv: Invoice = op.payload.offlineInvoice;
      if (offInv && offInv.paymentType === 'آجل' && !mergedPendingInvoices.some(p => p.invoiceNumber === offInv.invoiceNumber)) {
        mergedPendingInvoices.unshift({
          ...offInv,
          isOffline: true,
          offlinePending: true,
          offlineCollectionPending:
            Boolean(offInv.offlineCollectionPending) ||
            collectedOfflineInvoiceNums.has(offInv.invoiceNumber)
        });
      }
    }

    const authoritativeUser =
      (currentUser && decryptedUsers.find(u => u.id === currentUser.id)) || currentUser;

    return {
      items: sanitizeItemsForUserPermissions(rawItems, authoritativeUser),
      categories: categoriesRec?.data || [],
      platforms: platformsRec?.data || [],
      costs: sanitizeCostsForUserPermissions(costsRec?.data || [], authoritativeUser),
      customers: customersRec?.data || [],
      cashboxes: cashboxesRec?.data || [],
      cashboxAssignments: assignmentsRec?.data || [],
      settings: settingsRec?.data || null,
      users: decryptedUsers,
      pendingInvoices: sanitizeInvoicesForUserPermissions(mergedPendingInvoices, authoritativeUser),
      partyBalances: partyBalancesRec?.data || [],
      invoices: sanitizeInvoicesForUserPermissions(mergedInvoices, authoritativeUser),
      returns: returnsRec?.data || [],
      lastSyncAt: lastSyncRec?.value || null
    };
  } catch (err) {
    console.warn('[OfflineDB] Failed to load offline snapshot:', err);
    return null;
  }
}

// ============================================================================
// إنشاء فاتورة بيع بدون إنترنت وحفظها في outbox بمعاملة durability: 'strict'
// وتحديث المخزون ورصيد الخزينة في النسخة المحلية فورًا
// ============================================================================

export async function createOfflineInvoiceInDb(params: {
  invoicePayload: any;
  user: UserAccount | null;
  fallbackItems?: Item[];
  fallbackPlatforms?: Platform[];
  fallbackCashboxes?: Cashbox[];
  fallbackCustomers?: Customer[];
  taxSettings?: TaxSettings;
  platformsEnabled?: boolean;
  salesRules?: SalesRules;
}): Promise<{
  invoice: Invoice;
  updatedItems: Item[];
  updatedCashboxes: Cashbox[];
  updatedPlatforms: Platform[];
  duplicate?: boolean;
}> {
  const {
    invoicePayload,
    user,
    fallbackItems = [],
    fallbackPlatforms = [],
    fallbackCashboxes = [],
    fallbackCustomers = [],
    taxSettings = { taxInclusive: true, platformCommissionOn: 'before_tax' },
    platformsEnabled = true,
    salesRules
  } = params;

  await assertOfflineWriteOwnership();

  const paymentType: 'نقدي' | 'آجل' | 'جزئي' = invoicePayload.paymentType || 'نقدي';
  const creditPartyType: 'customer' | 'platform' =
    invoicePayload.creditPartyType === 'platform' ? 'platform' : 'customer';

  // التحقق من العمليات المسموحة والممنوعة بدون إنترنت:
  // المسموح فقط: بيع نقدي مباشر، وفواتير المنصات (آجل على المنصة)
  if (paymentType === 'جزئي') {
    throw new Error('الدفع الجزئي غير متاح بدون إنترنت (متاح عند رجوع الاتصال)');
  }
  if (paymentType === 'آجل' && creditPartyType !== 'platform') {
    throw new Error('البيع الآجل للعميل غير متاح بدون إنترنت (متاح عند رجوع الاتصال)');
  }
  const requestedPlatformIdPre = String(invoicePayload.platformId || '').trim();
  const requestedPlatformNamePre = String(invoicePayload.platform || invoicePayload.platformName || 'البيع المباشر').trim();
  const isDirectTargetPre =
    (!requestedPlatformIdPre || requestedPlatformIdPre === 'direct') &&
    (!requestedPlatformNamePre || requestedPlatformNamePre === 'البيع المباشر');
  const isRequestedPlatformSale = !isDirectTargetPre;

  const preEffectivePlatformsEnabled =
    platformsEnabled !== false &&
    salesRules?.platformsEnabled !== false &&
    salesRules?.salesOnlyMode !== true;
  const preAllowPlatformSale = preEffectivePlatformsEnabled && salesRules?.allowPlatformSale !== false;
  const preAllowDirectSale = salesRules?.allowDirectSale !== false;

  if (!preAllowPlatformSale && !preAllowDirectSale) {
    throw new Error('البيع على منصة والبيع المباشر للعميل معطلان حاليًا من إعدادات البيع؛ فعّل وضع بيع واحد على الأقل أولًا');
  }
  if (isRequestedPlatformSale && !preAllowPlatformSale) {
    throw new Error(
      !preEffectivePlatformsEnabled
        ? 'مبيعات ووظائف المنصات معطلة حاليًا من إعدادات النظام'
        : 'البيع على منصة معطّل حاليًا من إعدادات البيع؛ لا يمكن تسجيل فاتورة منصة'
    );
  }
  if (!isRequestedPlatformSale && !preAllowDirectSale) {
    throw new Error('البيع المباشر للعميل معطّل حاليًا من إعدادات البيع؛ لا يمكن تسجيل فاتورة بيع مباشر');
  }

  const linesInput: any[] = Array.isArray(invoicePayload.lines) ? invoicePayload.lines : [];
  if (linesInput.length === 0) {
    throw new Error('لا يمكن حفظ فاتورة خالية من الأصناف');
  }

  // التحقق من سعة التخزين قبل إنشاء فاتورة أوفلاين: عند الامتلاء الفعلي يتوقف البيع برسالة واضحة
  const quotaStatus = await checkStorageQuotaStatus();
  if (quotaStatus.isFull) {
    throw new Error(
      'مساحة التخزين على الجهاز ممتلئة بالكامل. لا يمكن تسجيل مبيعات جديدة قبل الاتصال بالإنترنت ومزامنة العمليات المعلّقة'
    );
  }

  const identity = await ensureDeviceIdentity();
  const db = await openOfflineDb();

  // فحص مفتاح منع التكرار (idempotencyKey) في outbox أولاً
  const idemKey = String(invoicePayload.idempotencyKey || '').trim() || generateUUID();
  try {
    const checkTx = db.transaction([OFFLINE_STORES.OUTBOX], 'readonly');
    const checkStore = checkTx.objectStore(OFFLINE_STORES.OUTBOX);
    const existingById = await reqToPromise<OutboxOperation | undefined>(checkStore.get(idemKey));
    if (existingById && existingById.payload?.offlineInvoice) {
      const snapshot = await loadOfflineSnapshot(user);
      return {
        invoice: existingById.payload.offlineInvoice as Invoice,
        updatedItems: snapshot?.items || fallbackItems,
        updatedCashboxes: snapshot?.cashboxes || fallbackCashboxes,
        updatedPlatforms: snapshot?.platforms || fallbackPlatforms,
        duplicate: true
      };
    }
  } catch (_) {}

  // قراءة المخازن المحلية الحالية (catalog, credit, meta)
  const readTx = db.transaction(
    [OFFLINE_STORES.CATALOG, OFFLINE_STORES.CREDIT, OFFLINE_STORES.META],
    'readonly'
  );
  const catalogRead = readTx.objectStore(OFFLINE_STORES.CATALOG);
  const creditRead = readTx.objectStore(OFFLINE_STORES.CREDIT);
  const metaRead = readTx.objectStore(OFFLINE_STORES.META);

  const [
    itemsRec,
    platformsRec,
    cashboxesRec,
    customersRec,
    settingsRec,
    invoicesRec,
    pendingInvoicesRec,
    seqRec
  ] = await Promise.all([
    reqToPromise<CatalogRecord<Item[]> | undefined>(catalogRead.get('items')),
    reqToPromise<CatalogRecord<Platform[]> | undefined>(catalogRead.get('platforms')),
    reqToPromise<CatalogRecord<Cashbox[]> | undefined>(catalogRead.get('cashboxes')),
    reqToPromise<CatalogRecord<Customer[]> | undefined>(catalogRead.get('customers')),
    reqToPromise<CatalogRecord<CatalogSettingsRecord> | undefined>(catalogRead.get('settings')),
    reqToPromise<CreditRecord<Invoice[]> | undefined>(creditRead.get('invoices')),
    reqToPromise<CreditRecord<Invoice[]> | undefined>(creditRead.get('pendingInvoices')),
    reqToPromise<MetaRecord<number> | undefined>(metaRead.get('offlineInvoiceSeq'))
  ]);

  const localItems: Item[] =
    itemsRec?.data && itemsRec.data.length > 0
      ? itemsRec.data.map(it => ({ ...it }))
      : fallbackItems.map(it => ({ ...it }));
  const localPlatforms: Platform[] =
    platformsRec?.data && platformsRec.data.length > 0
      ? platformsRec.data.map(p => ({ ...p }))
      : fallbackPlatforms.map(p => ({ ...p }));
  const localCashboxes: Cashbox[] =
    cashboxesRec?.data && cashboxesRec.data.length > 0
      ? cashboxesRec.data.map(c => ({ ...c }))
      : fallbackCashboxes.map(c => ({ ...c }));
  const localCustomers: Customer[] =
    customersRec?.data && customersRec.data.length > 0
      ? customersRec.data.map(c => ({ ...c }))
      : fallbackCustomers.map(c => ({ ...c }));

  const effectiveTaxSettings: TaxSettings =
    settingsRec?.data?.taxSettings || taxSettings || { taxInclusive: true, platformCommissionOn: 'before_tax' };

  const platformIdInput = String(invoicePayload.platformId || '').trim();
  const platformName = String(invoicePayload.platform || invoicePayload.platformName || 'البيع المباشر').trim() || 'البيع المباشر';
  const cachedSalesRules = settingsRec?.data?.salesRules;
  const mergedOfflineRules: Partial<SalesRules> | undefined =
    cachedSalesRules || salesRules ? { ...(cachedSalesRules || {}), ...(salesRules || {}) } : undefined;
  const effectivePlatformsEnabled =
    platformsEnabled !== false &&
    mergedOfflineRules?.platformsEnabled !== false &&
    mergedOfflineRules?.salesOnlyMode !== true;
  const effectiveAllowPlatformSale =
    effectivePlatformsEnabled && mergedOfflineRules?.allowPlatformSale !== false;
  const effectiveAllowDirectSale = mergedOfflineRules?.allowDirectSale !== false;

  const matchedLocalPlatform = localPlatforms.find(
    p => (platformIdInput && p.id === platformIdInput) || (platformName && p.name === platformName)
  );
  const isDirectTarget = matchedLocalPlatform
    ? matchedLocalPlatform.name === 'البيع المباشر'
    : (!platformIdInput || platformIdInput === 'direct') &&
      (!platformName || platformName === 'البيع المباشر');
  const isPlatformSale = !isDirectTarget;

  if (!effectiveAllowPlatformSale && !effectiveAllowDirectSale) {
    throw new Error('البيع على منصة والبيع المباشر للعميل معطلان حاليًا من إعدادات البيع؛ فعّل وضع بيع واحد على الأقل أولًا');
  }
  if (isPlatformSale && !effectiveAllowPlatformSale) {
    throw new Error(
      !effectivePlatformsEnabled
        ? 'مبيعات ووظائف المنصات معطلة حاليًا من إعدادات النظام'
        : 'البيع على منصة معطّل حاليًا من إعدادات البيع؛ لا يمكن تسجيل فاتورة منصة'
    );
  }
  if (!isPlatformSale && !effectiveAllowDirectSale) {
    throw new Error('البيع المباشر للعميل معطّل حاليًا من إعدادات البيع؛ لا يمكن تسجيل فاتورة بيع مباشر');
  }

  const isLocalPlatformActive = (p?: Platform) =>
    Boolean(p) &&
    p!.id !== 'direct' &&
    p!.name !== 'البيع المباشر' &&
    !['inactive', 'موقوف', 'موقوفة', 'معطل', 'معطلة'].includes(String(p?.status ?? ''));

  if (isPlatformSale && !isLocalPlatformActive(matchedLocalPlatform)) {
    throw new Error('لا توجد منصة نشطة صالحة مختارة لإتمام البيع على منصة؛ يرجى اختيار منصة نشطة أو تفعيل منصة أولًا');
  }

  const selectedPlatform: Platform = matchedLocalPlatform || {
    id: platformIdInput || 'direct',
    name: platformName,
    discountPercentage: Number(invoicePayload.platformDiscountPercentage || 0),
    pickupFee: 0,
    pickupFeeMode: 'platform',
    enableBnpl: Boolean(invoicePayload.bnplEnabled),
    bnplPercentage: Number(invoicePayload.bnplPercentOverride || 0),
    notes: '',
    status: 'نشطة'
  };

  // تجميع الكميات المطلوبة لكل صنف وفحص الرصيد المحلي لتحديد needsReview
  const aggregatedQtyMap = new Map<string, number>();
  for (const line of linesInput) {
    const itId = String(line.itemId || '');
    const q = Math.max(0, Number(line.quantity || 1));
    aggregatedQtyMap.set(itId, (aggregatedQtyMap.get(itId) || 0) + q);
  }

  let needsReview = false;
  for (const [itId, requestedQty] of aggregatedQtyMap.entries()) {
    const foundItem = localItems.find(i => i.id === itId);
    if (!foundItem) {
      throw new Error(`الصنف غير موجود في التخزين المحلي: ${itId}`);
    }
    if (Number(foundItem.stockQuantity || 0) < requestedQty) {
      // البيع بالسالب مسموح دائمًا أوفلاين وتُعلَّم الفاتورة needsReview:true
      needsReview = true;
    }
  }

  // توليد رقم الفاتورة المؤقت بصيغة: OFF-[أول 4 حروف من معرّف الجهاز]-[التاريخ]-[تسلسل محلي]
  const now = new Date();
  const nowIso = now.toISOString();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const cleanDevicePrefix = identity.deviceId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 4)
    .toUpperCase()
    .padEnd(4, '0');
  const nextSeq = (Number(seqRec?.value) || 0) + 1;
  const seqFormatted = String(nextSeq).padStart(4, '0');
  const tempInvoiceNumber = `OFF-${cleanDevicePrefix}-${yyyymmdd}-${seqFormatted}`;

  const deliveryFee = Math.max(0, Math.round(Number(invoicePayload.deliveryFee || 0) * 100) / 100);
  const bnplPercentOverrideVal =
    invoicePayload.bnplPercentOverride !== undefined &&
    invoicePayload.bnplPercentOverride !== null &&
    invoicePayload.bnplPercentOverride !== ''
      ? Number(invoicePayload.bnplPercentOverride)
      : undefined;

  const platformDiscountPercent =
    invoicePayload.commissionPercentOverride !== undefined &&
    invoicePayload.commissionPercentOverride !== null &&
    invoicePayload.commissionPercentOverride !== ''
      ? Number(invoicePayload.commissionPercentOverride)
      : invoicePayload.platformDiscountPercentage !== undefined &&
        invoicePayload.platformDiscountPercentage !== null &&
        invoicePayload.platformDiscountPercentage !== ''
      ? Number(invoicePayload.platformDiscountPercentage)
      : Number(selectedPlatform.discountPercentage || 0);

  // الحساب بدالة src/shared/invoiceCalc.ts المشتركة
  const calcResult = calculateInvoice({
    invoiceNumber: tempInvoiceNumber,
    lines: linesInput.map((line: any) => {
      const foundItem = localItems.find(i => i.id === line.itemId)!;
      return {
        line,
        item: foundItem
      };
    }),
    platform: selectedPlatform,
    taxSettings: effectiveTaxSettings,
    deliveryFee,
    bnplEnabled: invoicePayload.bnplEnabled,
    bnplPercentOverrideVal,
    platformDiscountPercent
  });

  const selectedCashbox =
    paymentType === 'نقدي'
      ? localCashboxes.find(c => c.id === invoicePayload.cashboxId) || localCashboxes[0]
      : undefined;

  if (paymentType === 'نقدي' && !selectedCashbox && !invoicePayload.cashboxId) {
    throw new Error('يرجى اختيار خزينة التحصيل لحفظ الفاتورة النقدية');
  }

  const selectedCustomer = invoicePayload.customerId
    ? localCustomers.find(c => c.id === invoicePayload.customerId)
    : undefined;

  const netAmount = calcResult.netAmount;
  const paidAmount = paymentType === 'آجل' ? 0 : netAmount;
  const remainingAmount = paymentType === 'آجل' ? netAmount : 0;
  const creditDueAmount = paymentType === 'آجل' ? netAmount : 0;

  const isDesignerOrManager =
    user?.role === 'designer' || Boolean(user?.isOwner) || user?.role === 'manager';
  const canViewProfit = isDesignerOrManager || hasPermission(user, 'reports.view_profit');
  const canViewPurchase = isDesignerOrManager || hasPermission(user, 'prices.view_purchase');

  const offlineInvoice: Invoice = {
    invoiceNumber: tempInvoiceNumber,
    date: nowIso,
    platform: selectedPlatform.name,
    platformId: selectedPlatform.id,
    ...(invoicePayload.platformOrderId ? { platformOrderId: String(invoicePayload.platformOrderId).trim() } : {}),
    customerName: selectedCustomer ? selectedCustomer.name : invoicePayload.customerName || '',
    customerId: selectedCustomer ? selectedCustomer.id : invoicePayload.customerId || '',
    cashboxName:
      paymentType === 'آجل'
        ? undefined
        : selectedCashbox?.name || invoicePayload.cashboxName || 'الخزينة الرئيسية',
    cashboxId: paymentType === 'آجل' ? undefined : selectedCashbox?.id || invoicePayload.cashboxId,
    idempotencyKey: idemKey,
    cartId: invoicePayload.cartId ? String(invoicePayload.cartId) : undefined,
    paymentType,
    creditPartyType: paymentType === 'آجل' ? 'platform' : undefined,
    creditPartyId: paymentType === 'آجل' ? selectedPlatform.id : undefined,
    creditPartyName: paymentType === 'آجل' ? selectedPlatform.name : undefined,
    creditDueAmount: paymentType === 'آجل' ? creditDueAmount : undefined,
    creditStatus: paymentType === 'آجل' ? 'معلّقة' : undefined,
    paidAmount,
    remainingAmount,
    paymentMethod: paymentType === 'آجل' ? 'آجل' : 'نقدي',
    referenceNumber: invoicePayload.referenceNumber || '',
    totalBeforeDiscount: calcResult.totalBeforeDiscount,
    bnplTotalAmount: calcResult.totalBnpl,
    bnplEnabled:
      invoicePayload.bnplEnabled !== false &&
      (Boolean(invoicePayload.bnplEnabled) || calcResult.totalBnpl > 0 || Boolean(selectedPlatform.enableBnpl)),
    bnplPercentApplied: calcResult.bnplPercentApplied,
    commissionPercentApplied: calcResult.commissionPercentApplied,
    discountAmount: calcResult.totalDiscount,
    pickupFeeAmount: calcResult.totalPickupFee,
    deliveryFee: calcResult.deliveryFee,
    taxAmount: calcResult.totalTax,
    netAmount,
    profit: canViewProfit ? calcResult.totalProfit : undefined,
    status: paymentType === 'آجل' ? 'معلّقة' : 'تم البيع',
    notes: invoicePayload.notes || '',
    createdBy: user?.name || user?.username || invoicePayload.createdBy || 'كاشير',
    isOffline: true,
    offlinePending: true,
    offlineProvisionalNo: tempInvoiceNumber,
    tempInvoiceNumber,
    needsReview,
    reviewReasons: needsReview ? ['رصيد سالب'] : [],
    offlineDeviceId: identity.deviceId,
    deviceId: identity.deviceId,
    deviceName: identity.deviceName,
    deviceTime: nowIso,
    lines: calcResult.lines.map(cl => ({
      ...cl,
      purchasePriceAtSale: canViewPurchase ? cl.purchasePriceAtSale : undefined,
      packagingCostAtSale: canViewPurchase ? cl.packagingCostAtSale : undefined,
      unitProfit: canViewProfit ? cl.unitProfit : undefined
    }))
  };

  // 1) الحفظ أولاً في outbox بمعاملة durability: 'strict' (إلزامي قبل أي طباعة)
  const outboxRecord: OutboxOperation = {
    id: idemKey,
    idempotencyKey: idemKey,
    type: 'createInvoice',
    operationType: 'createInvoice',
    invoiceNumber: tempInvoiceNumber,
    needsReview,
    payload: {
      ...invoicePayload,
      idempotencyKey: idemKey,
      invoiceNumber: tempInvoiceNumber,
      offlineProvisionalNo: tempInvoiceNumber,
      tempInvoiceNumber,
      needsReview,
      reviewReasons: needsReview ? ['رصيد سالب'] : [],
      offlineDeviceId: identity.deviceId,
      deviceId: identity.deviceId,
      deviceName: identity.deviceName,
      deviceTime: nowIso,
      userId: user?.id,
      userName: user?.name || user?.username || 'كاشير',
      createdBy: user?.name || user?.username || invoicePayload.createdBy || 'كاشير',
      offlineInvoice
    },
    status: 'معلّقة',
    retryCount: 0,
    lastError: null,
    deviceId: identity.deviceId,
    deviceName: identity.deviceName,
    userId: user?.id,
    userName: user?.name || user?.username || 'كاشير',
    createdByUserId: user?.id,
    createdByUserName: user?.name || user?.username || 'كاشير',
    deviceTime: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  try {
    const strictOutboxTx = openStrictOutboxWriteTx(db);
    const outboxStore = strictOutboxTx.objectStore(OFFLINE_STORES.OUTBOX);
    outboxStore.put(outboxRecord);
    await txDone(strictOutboxTx);
  } catch (err: any) {
    if (
      err?.name === 'QuotaExceededError' ||
      String(err?.message || '').toLowerCase().includes('quota')
    ) {
      throw new Error(
        'مساحة التخزين على الجهاز ممتلئة بالكامل. لا يمكن تسجيل مبيعات جديدة قبل الاتصال بالإنترنت ومزامنة العمليات المعلّقة'
      );
    }
    throw err;
  }

  // 1b) إضافة سطر العملية إلى ملف النسخ الاحتياطي لليوم mudaqqeq-offline-YYYY-MM-DD.jsonl قبل الطباعة
  await appendOperationToBackupDirectory(outboxRecord);

  // 2) تحديث المخزون ورصيد الخزينة وسجل الفواتير في النسخة المحلية فورًا
  const updatedItems = localItems.map(it => {
    const deductQty = aggregatedQtyMap.get(it.id) || 0;
    if (deductQty > 0) {
      return {
        ...it,
        stockQuantity: Number(it.stockQuantity || 0) - deductQty
      };
    }
    return it;
  });

  const updatedCashboxes = localCashboxes.map(cb => {
    if (paymentType === 'نقدي' && selectedCashbox && cb.id === selectedCashbox.id) {
      return {
        ...cb,
        currentBalance: Math.round((Number(cb.currentBalance || 0) + netAmount) * 100) / 100
      };
    }
    return cb;
  });

  const updatedPlatforms = localPlatforms.map(pl => {
    if (paymentType === 'آجل' && creditPartyType === 'platform' && pl.id === selectedPlatform.id) {
      return {
        ...pl,
        currentBalance: Math.round((Number(pl.currentBalance || 0) + netAmount) * 100) / 100
      };
    }
    return pl;
  });

  const existingInvoices = invoicesRec?.data || [];
  const updatedInvoices = [
    offlineInvoice,
    ...existingInvoices.filter(i => i.invoiceNumber !== offlineInvoice.invoiceNumber)
  ];

  const existingPending = pendingInvoicesRec?.data || [];
  const updatedPendingInvoices =
    paymentType === 'آجل'
      ? [offlineInvoice, ...existingPending.filter(i => i.invoiceNumber !== offlineInvoice.invoiceNumber)]
      : existingPending;

  const updateStoresTx = db.transaction(
    [OFFLINE_STORES.CATALOG, OFFLINE_STORES.CREDIT, OFFLINE_STORES.META],
    'readwrite'
  );
  const catalogWrite = updateStoresTx.objectStore(OFFLINE_STORES.CATALOG);
  const creditWrite = updateStoresTx.objectStore(OFFLINE_STORES.CREDIT);
  const metaWrite = updateStoresTx.objectStore(OFFLINE_STORES.META);

  catalogWrite.put({ key: 'items', data: updatedItems, updatedAt: nowIso } satisfies CatalogRecord);
  catalogWrite.put({ key: 'cashboxes', data: updatedCashboxes, updatedAt: nowIso } satisfies CatalogRecord);
  catalogWrite.put({ key: 'platforms', data: updatedPlatforms, updatedAt: nowIso } satisfies CatalogRecord);
  creditWrite.put({ key: 'invoices', data: updatedInvoices, updatedAt: nowIso } satisfies CreditRecord);
  creditWrite.put({ key: 'pendingInvoices', data: updatedPendingInvoices, updatedAt: nowIso } satisfies CreditRecord);
  metaWrite.put({ key: 'offlineInvoiceSeq', value: nextSeq, updatedAt: nowIso } satisfies MetaRecord);

  await txDone(updateStoresTx);
  notifyOfflineDbChange();

  return {
    invoice: offlineInvoice,
    updatedItems,
    updatedCashboxes,
    updatedPlatforms
  };
}

// ============================================================================
// تحصيل الآجل من العملاء والمنصات بدون إنترنت وحفظ العملية في outbox
// وتحديث الفواتير («محصّلة، لم تُرفع بعد») ورصيد الخزينة والطرف محليًا
// ============================================================================

export async function createOfflineCreditCollectionInDb(params: {
  payload: CollectCreditPayload & {
    partyName?: string;
    cashboxName?: string;
    createdBy?: string;
  };
  user: UserAccount | null;
  fallbackCustomers?: Customer[];
  fallbackPlatforms?: Platform[];
  fallbackCashboxes?: Cashbox[];
  fallbackPendingInvoices?: Invoice[];
}): Promise<
  CollectCreditResult & {
    isOffline: boolean;
    updatedCashboxes: Cashbox[];
    updatedPendingInvoices: Invoice[];
    updatedCustomers: Customer[];
    updatedPlatforms: Platform[];
    updatedPartyBalances: PartyBalanceSnapshot[];
  }
> {
  const {
    payload,
    user,
    fallbackCustomers = [],
    fallbackPlatforms = [],
    fallbackCashboxes = [],
    fallbackPendingInvoices = []
  } = params;

  await assertOfflineWriteOwnership();

  const { partyType, partyId, cashboxId } = payload;
  if (partyType !== 'customer' && partyType !== 'platform') {
    throw new Error('يجب تحديد نوع الطرف (عميل أو منصة)');
  }
  if (!partyId) {
    throw new Error('يجب تحديد الطرف المراد التحصيل منه');
  }
  if (!cashboxId) {
    throw new Error('يرجى اختيار الخزينة لإيداع المبلغ المستلم');
  }

  const rawNums = Array.isArray(payload.invoiceNumbers) ? payload.invoiceNumbers : [];
  const uniqueNums = Array.from(new Set(rawNums.map(n => String(n || '').trim()).filter(Boolean)));
  if (uniqueNums.length === 0) {
    throw new Error('يجب اختيار فاتورة معلّقة واحدة على الأقل للتحصيل');
  }

  const rawReceived = Number(payload.receivedAmount);
  if (payload.receivedAmount === undefined || payload.receivedAmount === null || isNaN(rawReceived) || rawReceived < 0) {
    throw new Error('المبلغ المستلم يجب أن يكون رقماً صالحاً أكبر من أو يساوي صفر');
  }
  const receivedAmount = Math.round(rawReceived * 100) / 100;

  const identity = await ensureDeviceIdentity();
  const db = await openOfflineDb();
  const idemKey = String(payload.idempotencyKey || '').trim() || generateUUID();

  // فحص مفتاح منع التكرار في outbox
  try {
    const checkTx = db.transaction([OFFLINE_STORES.OUTBOX], 'readonly');
    const checkStore = checkTx.objectStore(OFFLINE_STORES.OUTBOX);
    const existingOp = await reqToPromise<OutboxOperation | undefined>(checkStore.get(idemKey));
    if (existingOp && existingOp.payload?.offlineResult) {
      const snap = await loadOfflineSnapshot(user);
      return {
        ...(existingOp.payload.offlineResult as CollectCreditResult),
        duplicate: true,
        isOffline: true,
        updatedCashboxes: snap?.cashboxes || fallbackCashboxes,
        updatedPendingInvoices: snap?.pendingInvoices || fallbackPendingInvoices,
        updatedCustomers: snap?.customers || fallbackCustomers,
        updatedPlatforms: snap?.platforms || fallbackPlatforms,
        updatedPartyBalances: snap?.partyBalances || []
      };
    }
  } catch (_) {}

  // قراءة المخازن المحلية الحالية
  const readTx = db.transaction(
    [OFFLINE_STORES.CATALOG, OFFLINE_STORES.CREDIT, OFFLINE_STORES.META],
    'readonly'
  );
  const catalogRead = readTx.objectStore(OFFLINE_STORES.CATALOG);
  const creditRead = readTx.objectStore(OFFLINE_STORES.CREDIT);
  const metaRead = readTx.objectStore(OFFLINE_STORES.META);

  const [
    customersRec,
    platformsRec,
    cashboxesRec,
    invoicesRec,
    pendingInvoicesRec,
    partyBalancesRec,
    seqRec
  ] = await Promise.all([
    reqToPromise<CatalogRecord<Customer[]> | undefined>(catalogRead.get('customers')),
    reqToPromise<CatalogRecord<Platform[]> | undefined>(catalogRead.get('platforms')),
    reqToPromise<CatalogRecord<Cashbox[]> | undefined>(catalogRead.get('cashboxes')),
    reqToPromise<CreditRecord<Invoice[]> | undefined>(creditRead.get('invoices')),
    reqToPromise<CreditRecord<Invoice[]> | undefined>(creditRead.get('pendingInvoices')),
    reqToPromise<CreditRecord<PartyBalanceSnapshot[]> | undefined>(creditRead.get('partyBalances')),
    reqToPromise<MetaRecord<number> | undefined>(metaRead.get('offlineCollectionSeq'))
  ]);

  const localCustomers: Customer[] =
    customersRec?.data && customersRec.data.length > 0
      ? customersRec.data.map(c => ({ ...c }))
      : fallbackCustomers.map(c => ({ ...c }));
  const localPlatforms: Platform[] =
    platformsRec?.data && platformsRec.data.length > 0
      ? platformsRec.data.map(p => ({ ...p }))
      : fallbackPlatforms.map(p => ({ ...p }));
  const localCashboxes: Cashbox[] =
    cashboxesRec?.data && cashboxesRec.data.length > 0
      ? cashboxesRec.data.map(cb => ({ ...cb }))
      : fallbackCashboxes.map(cb => ({ ...cb }));
  const localPendingInvoices: Invoice[] =
    pendingInvoicesRec?.data && pendingInvoicesRec.data.length > 0
      ? pendingInvoicesRec.data.map(inv => ({ ...inv }))
      : fallbackPendingInvoices.map(inv => ({ ...inv }));
  const localInvoices: Invoice[] =
    invoicesRec?.data && invoicesRec.data.length > 0
      ? invoicesRec.data.map(inv => ({ ...inv }))
      : [...localPendingInvoices];

  const partyName =
    partyType === 'customer'
      ? localCustomers.find(c => c.id === partyId)?.name || payload.partyName || 'عميل'
      : localPlatforms.find(p => p.id === partyId)?.name || payload.partyName || 'منصة';

  const selectedCashbox = localCashboxes.find(c => c.id === cashboxId);
  if (!selectedCashbox) {
    throw new Error('الخزينة المحددة غير موجودة في التخزين المحلي');
  }

  let calculatedTotalDue = 0;
  for (const invNum of uniqueNums) {
    const foundInv =
      localPendingInvoices.find(i => i.invoiceNumber === invNum) ||
      localInvoices.find(i => i.invoiceNumber === invNum) ||
      fallbackPendingInvoices.find(i => i.invoiceNumber === invNum);

    if (!foundInv) {
      throw new Error(`الفاتورة رقم ${invNum} غير موجودة في التخزين المحلي`);
    }
    if (foundInv.offlineCollectionPending) {
      throw new Error(`الفاتورة رقم ${invNum} محصّلة محليًا بالفعل وبانتظار الرفع`);
    }

    const invDue =
      foundInv.creditDueAmount !== undefined && foundInv.creditDueAmount !== null
        ? Number(foundInv.creditDueAmount)
        : foundInv.remainingAmount !== undefined && foundInv.remainingAmount !== null && Number(foundInv.remainingAmount) > 0
        ? Number(foundInv.remainingAmount)
        : partyType === 'customer'
        ? Number(foundInv.totalBeforeDiscount || 0) + Number(foundInv.deliveryFee || 0)
        : Number(foundInv.netAmount || 0);

    calculatedTotalDue += Math.round(invDue * 100) / 100;
  }

  const totalDue = Math.round(calculatedTotalDue * 100) / 100;
  const difference = Math.round((receivedAmount - totalDue) * 100) / 100;
  const hasDifference = Math.abs(difference) >= 0.01;

  if (hasDifference && payload.confirmDifference !== true) {
    const absDiff = Math.abs(difference);
    const msg =
      difference < 0
        ? `المبلغ أقل من المستحق بمقدار ${absDiff}، وسيُرحَّل الفرق على ${partyName}`
        : `المبلغ أعلى من المستحق بمقدار ${absDiff}، وسيُسجَّل كرصيد دائن لـ ${partyName}`;
    return {
      success: false,
      statusCode: 400,
      requiresConfirmation: true,
      totalDue,
      receivedAmount,
      difference,
      error: msg,
      isOffline: true,
      updatedCashboxes: localCashboxes,
      updatedPendingInvoices: localPendingInvoices,
      updatedCustomers: localCustomers,
      updatedPlatforms: localPlatforms,
      updatedPartyBalances: partyBalancesRec?.data || []
    };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const cleanDevicePrefix = identity.deviceId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 4)
    .toUpperCase()
    .padEnd(4, '0');
  const nextSeq = (Number(seqRec?.value) || 0) + 1;
  const seqFormatted = String(nextSeq).padStart(4, '0');
  const tempCollectionId = `OFF-COL-${cleanDevicePrefix}-${yyyymmdd}-${seqFormatted}`;

  const existingPartyBalSnap = (partyBalancesRec?.data || []).find(
    b => b.partyType === partyType && b.partyId === partyId
  );
  const currentPartyBalance =
    existingPartyBalSnap !== undefined
      ? Number(existingPartyBalSnap.currentBalance || 0)
      : partyType === 'customer'
      ? Number(localCustomers.find(c => c.id === partyId)?.currentBalance || 0)
      : Number(localPlatforms.find(p => p.id === partyId)?.currentBalance || totalDue);

  const newPartyBalance = Math.round((currentPartyBalance - receivedAmount) * 100) / 100;
  const actorName = user?.name || user?.username || payload.createdBy || 'محاسب';

  const createdEntries: PartyLedgerEntry[] = [
    {
      id: generateUUID(),
      date: nowIso,
      partyType,
      partyId,
      partyName,
      transactionType: 'تحصيل',
      documentNumber: tempCollectionId,
      debit: 0,
      credit: totalDue,
      balanceAfter: Math.round((currentPartyBalance - totalDue) * 100) / 100,
      statement: `تحصيل فواتير آجل مسجل بدون إنترنت (${uniqueNums.join('، ')}) - المستلم بالخزنة: ${receivedAmount} ج.م`,
      userName: actorName,
      notes: payload.notes || ''
    }
  ];

  if (hasDifference) {
    const isUnderpayment = difference < 0;
    const absDiff = Math.round(Math.abs(difference) * 100) / 100;
    createdEntries.push({
      id: generateUUID(),
      date: nowIso,
      partyType,
      partyId,
      partyName,
      transactionType: 'فرق تحصيل',
      documentNumber: tempCollectionId,
      debit: isUnderpayment ? absDiff : 0,
      credit: isUnderpayment ? 0 : absDiff,
      balanceAfter: newPartyBalance,
      statement: isUnderpayment
        ? `فرق تحصيل أقل من المستحق بمقدار ${absDiff} ج.م مرحّل على ${partyName}`
        : `فرق تحصيل أعلى من المستحق بمقدار ${absDiff} ج.م كرصيد دائن لـ ${partyName}`,
      userName: actorName,
      notes: payload.notes || ''
    });
  }

  const offlineResult: CollectCreditResult = {
    success: true,
    collectionId: tempCollectionId,
    totalDue,
    receivedAmount,
    difference,
    partyBalance: newPartyBalance,
    settledInvoices: uniqueNums,
    ledgerEntriesCreated: createdEntries
  };

  // 1) الحفظ في outbox بمعاملة durability: 'strict'
  const outboxRecord: OutboxOperation = {
    id: idemKey,
    idempotencyKey: idemKey,
    type: 'collectCredit',
    operationType: 'collectCreditInvoices',
    invoiceNumber: tempCollectionId,
    needsReview: false,
    payload: {
      type: 'collectCredit',
      operationType: 'collectCreditInvoices',
      partyType,
      partyId,
      partyName,
      invoiceNumbers: uniqueNums,
      receivedAmount,
      cashboxId,
      cashboxName: selectedCashbox.name,
      confirmDifference: true,
      notes: payload.notes || '',
      idempotencyKey: idemKey,
      collectionId: tempCollectionId,
      offlineDeviceId: identity.deviceId,
      deviceId: identity.deviceId,
      deviceName: identity.deviceName,
      deviceTime: nowIso,
      userId: user?.id,
      userName: actorName,
      createdBy: actorName,
      offlineResult
    },
    status: 'معلّقة',
    retryCount: 0,
    lastError: null,
    deviceId: identity.deviceId,
    deviceName: identity.deviceName,
    userId: user?.id,
    userName: actorName,
    createdByUserId: user?.id,
    createdByUserName: actorName,
    deviceTime: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  const strictOutboxTx = openStrictOutboxWriteTx(db);
  const outboxStore = strictOutboxTx.objectStore(OFFLINE_STORES.OUTBOX);
  outboxStore.put(outboxRecord);
  await txDone(strictOutboxTx);

  // 1b) إضافة سطر تحصيل الآجل لملف اليوم mudaqqeq-offline-YYYY-MM-DD.jsonl قبل الطباعة
  await appendOperationToBackupDirectory(outboxRecord);

  // 2) تحديث الفواتير محليًا لتُعلَّم «محصّلة، لم تُرفع بعد» وتحديث رصيد الخزينة والطرف
  const collectedSet = new Set(uniqueNums);
  const updatedPendingInvoices = localPendingInvoices.map(inv => {
    if (collectedSet.has(inv.invoiceNumber)) {
      return {
        ...inv,
        offlineCollectionPending: true
      };
    }
    return inv;
  });

  const updatedInvoices = localInvoices.map(inv => {
    if (collectedSet.has(inv.invoiceNumber)) {
      return {
        ...inv,
        offlineCollectionPending: true
      };
    }
    return inv;
  });

  const updatedCashboxes = localCashboxes.map(cb => {
    if (cb.id === cashboxId) {
      return {
        ...cb,
        currentBalance: Math.round((Number(cb.currentBalance || 0) + receivedAmount) * 100) / 100
      };
    }
    return cb;
  });

  const updatedCustomers = localCustomers.map(cust => {
    if (partyType === 'customer' && cust.id === partyId) {
      return {
        ...cust,
        currentBalance: newPartyBalance
      };
    }
    return cust;
  });

  const updatedPlatforms = localPlatforms.map(plt => {
    if (partyType === 'platform' && plt.id === partyId) {
      return {
        ...plt,
        currentBalance: newPartyBalance
      };
    }
    return plt;
  });

  const existingPartyBalances = partyBalancesRec?.data || [];
  let foundPartyBalanceSnap = false;
  const updatedPartyBalances: PartyBalanceSnapshot[] = existingPartyBalances.map(b => {
    if (b.partyType === partyType && b.partyId === partyId) {
      foundPartyBalanceSnap = true;
      return {
        ...b,
        currentBalance: newPartyBalance,
        pendingInvoicesCount: Math.max(0, (b.pendingInvoicesCount || 0) - uniqueNums.length),
        updatedAt: nowIso
      };
    }
    return b;
  });

  if (!foundPartyBalanceSnap) {
    updatedPartyBalances.push({
      partyType,
      partyId,
      partyName,
      currentBalance: newPartyBalance,
      pendingInvoicesCount: 0,
      updatedAt: nowIso
    });
  }

  const updateTx = db.transaction(
    [OFFLINE_STORES.CATALOG, OFFLINE_STORES.CREDIT, OFFLINE_STORES.META],
    'readwrite'
  );
  const catalogWrite = updateTx.objectStore(OFFLINE_STORES.CATALOG);
  const creditWrite = updateTx.objectStore(OFFLINE_STORES.CREDIT);
  const metaWrite = updateTx.objectStore(OFFLINE_STORES.META);

  catalogWrite.put({ key: 'cashboxes', data: updatedCashboxes, updatedAt: nowIso } satisfies CatalogRecord);
  catalogWrite.put({ key: 'customers', data: updatedCustomers, updatedAt: nowIso } satisfies CatalogRecord);
  catalogWrite.put({ key: 'platforms', data: updatedPlatforms, updatedAt: nowIso } satisfies CatalogRecord);
  creditWrite.put({ key: 'pendingInvoices', data: updatedPendingInvoices, updatedAt: nowIso } satisfies CreditRecord);
  creditWrite.put({ key: 'invoices', data: updatedInvoices, updatedAt: nowIso } satisfies CreditRecord);
  creditWrite.put({ key: 'partyBalances', data: updatedPartyBalances, updatedAt: nowIso } satisfies CreditRecord);
  metaWrite.put({ key: 'offlineCollectionSeq', value: nextSeq, updatedAt: nowIso } satisfies MetaRecord);

  await txDone(updateTx);
  notifyOfflineDbChange();

  return {
    ...offlineResult,
    isOffline: true,
    updatedCashboxes,
    updatedPendingInvoices,
    updatedCustomers,
    updatedPlatforms,
    updatedPartyBalances
  };
}

let activeSyncPromise: Promise<{ success: boolean; lastSyncAt: string | null }> | null = null;

/**
 * تنزيل نسخة كاملة من المخازن عند الدخول وكل 10 دقائق طالما الاتصال سليم،
 * مع حفظ lastSyncAt ومراعاة صلاحيات الأسعار قبل الحفظ.
 */
export async function syncFullStoresToOfflineDb(user: UserAccount): Promise<{
  success: boolean;
  lastSyncAt: string | null;
}> {
  if (!user) {
    return { success: false, lastSyncAt: null };
  }

  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = (async () => {
    try {
      const health = await api.getHealth();
      if (!health || !health.success) {
        return { success: false, lastSyncAt: await getMetaValue<string>('lastSyncAt') };
      }

      if (health.dataMode === 'sheets' && health.connectionHealth?.healthy === false) {
        return { success: false, lastSyncAt: await getMetaValue<string>('lastSyncAt') };
      }

      const syncRes = await api.syncAll();
      if (!syncRes || !syncRes.success || !syncRes.data || syncRes.stale) {
        return { success: false, lastSyncAt: await getMetaValue<string>('lastSyncAt') };
      }

      const data = syncRes.data;

      // جلب العملاء والخزن والتصنيفات والمستخدمين إن لم تكن مضمنة بالكامل في syncAll
      const canViewUsers =
        user.role === 'designer' || user.role === 'manager' || hasPermission(user, 'users.view');
      const canViewCategories =
        user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'categories.view');

      const [customersRes, cashboxesRes, assignmentsRes, categoriesRes, usersRes] = await Promise.all([
        Array.isArray(data.customers)
          ? Promise.resolve({ success: true, customers: data.customers as Customer[] })
          : api.getCustomers().catch(() => ({ success: false, customers: [] as Customer[] })),
        Array.isArray(data.cashboxes)
          ? Promise.resolve({ success: true, cashboxes: data.cashboxes as Cashbox[] })
          : api.getCashboxes().catch(() => ({ success: false, cashboxes: [] as Cashbox[] })),
        Array.isArray(data.cashboxAssignments)
          ? Promise.resolve({ success: true, assignments: data.cashboxAssignments as UserCashboxAssignment[] })
          : api.getCashboxAssignments().catch(() => ({ success: false, assignments: [] as UserCashboxAssignment[] })),
        Array.isArray(data.categories) && data.categories.length > 0
          ? Promise.resolve({ success: true, categories: data.categories as ProductCategory[] })
          : canViewCategories
          ? api.getCategories().catch(() => ({ success: false, categories: [] as ProductCategory[] }))
          : Promise.resolve({ success: true, categories: (data.categories || []) as ProductCategory[] }),
        Array.isArray(data.users) && data.users.length > 0
          ? Promise.resolve({ success: true, users: data.users as UserAccount[] })
          : canViewUsers
          ? api.getUsers().catch(() => ({ success: false, users: [] as UserAccount[] }))
          : Promise.resolve({ success: true, users: [user] })
      ]);

      const syncedAt = await saveOfflineSnapshot({
        user,
        items: Array.isArray(data.items) ? data.items : [],
        categories: categoriesRes.categories || data.categories || [],
        platforms: Array.isArray(data.platforms) ? data.platforms : [],
        costs: Array.isArray(data.costs) ? data.costs : [],
        customers: customersRes.customers || [],
        cashboxes: cashboxesRes.cashboxes || [],
        cashboxAssignments: assignmentsRes.assignments || [],
        settings: data.settings || undefined,
        users:
          Array.isArray(data.users) && data.users.length > 0
            ? data.users
            : usersRes.users && usersRes.users.length > 0
            ? usersRes.users
            : [user],
        invoices: Array.isArray(data.invoices) ? data.invoices : [],
        returns: Array.isArray(data.returns) ? data.returns : [],
        syncedAt: syncRes.lastSyncAt || new Date().toISOString()
      });

      return { success: true, lastSyncAt: syncedAt };
    } catch (err) {
      console.warn('[OfflineDB] Background store sync skipped:', err);
      return { success: false, lastSyncAt: await getMetaValue<string>('lastSyncAt') };
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}

// ============================================================================
// محرك مزامنة ورفع العمليات المحفوظة في outbox عند رجوع الاتصال
// ============================================================================

export interface SyncedOutboxInvoiceItem {
  idempotencyKey: string;
  provisionalInvoiceNumber: string;
  finalInvoiceNumber: string;
  invoice: Invoice;
  duplicate?: boolean;
}

export interface OutboxSyncResult {
  success: boolean;
  totalProcessed: number;
  syncedCount: number;
  failedCount: number;
  cancelledBeforeResetCount?: number;
  rejectedReviewCount?: number;
  remainingCount: number;
  syncedInvoices: SyncedOutboxInvoiceItem[];
  lastError: string | null;
  nextRetryDelayMs: number | null;
}

let activeOutboxSyncPromise: Promise<OutboxSyncResult> | null = null;
let outboxRetryTimerId: ReturnType<typeof setTimeout> | null = null;

export function getOutboxBackoffDelayMs(retryCount: number): number {
  const exp = Math.min(Math.max(0, retryCount - 1), 5);
  return Math.min(60000, 2000 * Math.pow(2, exp));
}

export function clearOutboxRetryTimer(): void {
  if (outboxRetryTimerId !== null) {
    clearTimeout(outboxRetryTimerId);
    outboxRetryTimerId = null;
  }
}

async function applyConfirmedInvoiceToLocalDb(params: {
  provisionalInvoiceNumber: string;
  finalInvoiceNumber: string;
  confirmedInvoice: Invoice;
}): Promise<void> {
  const { provisionalInvoiceNumber, finalInvoiceNumber, confirmedInvoice } = params;
  const db = await openOfflineDb();
  const nowIso = new Date().toISOString();

  const readTx = db.transaction([OFFLINE_STORES.CREDIT, OFFLINE_STORES.META], 'readonly');
  const creditRead = readTx.objectStore(OFFLINE_STORES.CREDIT);
  const metaRead = readTx.objectStore(OFFLINE_STORES.META);

  const [invoicesRec, pendingRec, mapRec] = await Promise.all([
    reqToPromise<CreditRecord<Invoice[]> | undefined>(creditRead.get('invoices')),
    reqToPromise<CreditRecord<Invoice[]> | undefined>(creditRead.get('pendingInvoices')),
    reqToPromise<
      MetaRecord<Record<string, { provisionalInvoiceNumber: string; finalInvoiceNumber: string; syncedAt: string; needsReview?: boolean; reviewReasons?: string[] }>> | undefined
    >(metaRead.get('provisionalToFinalMap'))
  ]);

  const enrichedInvoice: Invoice = {
    ...confirmedInvoice,
    invoiceNumber: finalInvoiceNumber,
    offlineProvisionalNo: provisionalInvoiceNumber || confirmedInvoice.offlineProvisionalNo,
    tempInvoiceNumber: provisionalInvoiceNumber || confirmedInvoice.tempInvoiceNumber,
    isOffline: true,
    offlinePending: false
  };

  const currentInvoices = invoicesRec?.data || [];
  let replaced = false;
  const updatedInvoices = currentInvoices.map(inv => {
    if (
      (provisionalInvoiceNumber && inv.invoiceNumber === provisionalInvoiceNumber) ||
      inv.invoiceNumber === finalInvoiceNumber ||
      (confirmedInvoice.idempotencyKey && inv.idempotencyKey === confirmedInvoice.idempotencyKey)
    ) {
      replaced = true;
      return enrichedInvoice;
    }
    return inv;
  });
  if (!replaced) {
    updatedInvoices.unshift(enrichedInvoice);
  }

  const currentPending = pendingRec?.data || [];
  const updatedPending = currentPending.map(inv => {
    if (
      (provisionalInvoiceNumber && inv.invoiceNumber === provisionalInvoiceNumber) ||
      inv.invoiceNumber === finalInvoiceNumber ||
      (confirmedInvoice.idempotencyKey && inv.idempotencyKey === confirmedInvoice.idempotencyKey)
    ) {
      return enrichedInvoice;
    }
    return inv;
  });

  const currentMap = { ...(mapRec?.value || {}) };
  if (provisionalInvoiceNumber) {
    currentMap[provisionalInvoiceNumber] = {
      provisionalInvoiceNumber,
      finalInvoiceNumber,
      syncedAt: nowIso,
      needsReview: enrichedInvoice.needsReview,
      reviewReasons: enrichedInvoice.reviewReasons
    };
  }

  const writeTx = db.transaction([OFFLINE_STORES.CREDIT, OFFLINE_STORES.META], 'readwrite');
  writeTx.objectStore(OFFLINE_STORES.CREDIT).put({
    key: 'invoices',
    data: updatedInvoices,
    updatedAt: nowIso
  } satisfies CreditRecord);
  writeTx.objectStore(OFFLINE_STORES.CREDIT).put({
    key: 'pendingInvoices',
    data: updatedPending,
    updatedAt: nowIso
  } satisfies CreditRecord);
  writeTx.objectStore(OFFLINE_STORES.META).put({
    key: 'provisionalToFinalMap',
    value: currentMap,
    updatedAt: nowIso
  } satisfies MetaRecord);

  await txDone(writeTx);
}

/**
 * محرك مزامنة صندوق الصادر (Outbox):
 * - يرسل العمليات بترتيب تسجيلها (createdAt تصاعديًا) واحدة واحدة إلى /api/offline/sync.
 * - لا يحذف العملية من الجهاز إلا بعد تأكيد الخادم (res.success === true).
 * - عند الفشل تبقى العملية في outbox بنفس مفتاح منع التكرار (idempotencyKey) ويُجدول إعادة إرسالها بفواصل متزايدة.
 * - بعد نجاح رفع كل عملية يحفظ الرقم النهائي بجانب الرقم المؤقت ويحدّث السجل المحلي.
 * - بعد انتهاء المزامنة ينزّل نسخة جديدة كاملة للتخزين المحلي.
 */
export async function syncOutboxOperations(options?: {
  user?: UserAccount | null;
  sender?: (payload: any) => Promise<{
    success: boolean;
    invoice?: Invoice;
    duplicate?: boolean;
    finalInvoiceNumber?: string;
    provisionalInvoiceNumber?: string;
    needsReview?: boolean;
    reviewReasons?: string[];
    error?: string;
    code?: string;
    statusCode?: number;
  }>;
  skipSnapshotRefresh?: boolean;
  disableAutoRetrySchedule?: boolean;
  onOperationSynced?: (item: SyncedOutboxInvoiceItem) => void;
}): Promise<OutboxSyncResult> {
  await assertOfflineWriteOwnership();

  if (activeOutboxSyncPromise) {
    return activeOutboxSyncPromise;
  }

  clearOutboxRetryTimer();

  activeOutboxSyncPromise = (async () => {
    const syncedInvoices: SyncedOutboxInvoiceItem[] = [];
    let totalProcessed = 0;
    let syncedCount = 0;
    let failedCount = 0;
    let cancelledBeforeResetCount = 0;
    let rejectedReviewCount = 0;
    let lastError: string | null = null;
    let maxRetryCountOnFailure = 0;

    try {
      const allOps = await getOutboxOperations();
      const pendingOps = allOps
        .filter(
          op =>
            op.status === 'معلّقة' ||
            op.status === 'pending' ||
            op.status === 'failed' ||
            op.status === 'syncing'
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      if (pendingOps.length === 0) {
        return {
          success: true,
          totalProcessed: 0,
          syncedCount: 0,
          failedCount: 0,
          cancelledBeforeResetCount: 0,
          rejectedReviewCount: 0,
          remainingCount: 0,
          syncedInvoices: [],
          lastError: null,
          nextRetryDelayMs: null
        };
      }

      const sendFn = options?.sender || (payload => api.syncOfflineOperation(payload));

      for (const op of pendingOps) {
        totalProcessed++;
        const idemKey = String(op.idempotencyKey || op.id).trim();
        const isCreditCollectionOp =
          op.type === 'collectCredit' ||
          op.operationType === 'collectCreditInvoices' ||
          op.payload?.type === 'collectCredit' ||
          op.payload?.operationType === 'collectCreditInvoices';

        const isAuthAuditOp =
          op.type === 'authAudit' ||
          op.operationType === 'OFFLINE_LOGIN' ||
          op.operationType === 'OFFLINE_LOGOUT' ||
          op.payload?.type === 'authAudit';

        const isUpdatePermissionsOp =
          op.type === 'updatePermissions' ||
          op.operationType === 'updateUserPermissions' ||
          op.payload?.type === 'updatePermissions' ||
          op.payload?.operationType === 'updateUserPermissions';

        const provisionalNo = String(
          op.invoiceNumber ||
          op.payload?.offlineProvisionalNo ||
          op.payload?.tempInvoiceNumber ||
          op.payload?.offlineInvoice?.invoiceNumber ||
          op.payload?.collectionId ||
          ''
        ).trim();

        const requestPayload = {
          ...(op.payload || {}),
          type: isCreditCollectionOp
            ? 'collectCredit'
            : isAuthAuditOp
            ? 'authAudit'
            : isUpdatePermissionsOp
            ? 'updatePermissions'
            : (op.type || 'createInvoice'),
          operationType: isCreditCollectionOp
            ? 'collectCreditInvoices'
            : isAuthAuditOp
            ? (op.operationType || op.payload?.auditAction || 'OFFLINE_LOGIN')
            : isUpdatePermissionsOp
            ? 'updateUserPermissions'
            : (op.operationType || 'createInvoice'),
          isOfflineSync: true,
          isOffline: true,
          idempotencyKey: idemKey,
          offlineProvisionalNo: provisionalNo,
          tempInvoiceNumber: provisionalNo,
          offlineDeviceId: op.deviceId || op.payload?.deviceId || '',
          deviceId: op.deviceId || op.payload?.deviceId || '',
          deviceName: op.deviceName || op.payload?.deviceName || '',
          deviceTime: op.deviceTime || op.payload?.deviceTime || op.createdAt,
          needsReview: Boolean(op.needsReview ?? op.payload?.needsReview),
          reviewReasons: Array.isArray(op.payload?.reviewReasons) ? op.payload.reviewReasons : []
        };

        try {
          const res: any = await sendFn(requestPayload);

          if (res && res.success && (isAuthAuditOp || isUpdatePermissionsOp)) {
            if (isUpdatePermissionsOp && res.user && res.user.id) {
              try {
                const cryptoKey = await getOrCreateDeviceUsersCryptoKey();
                const existingUsers = await getDecryptedOfflineUsers();
                const prevUser = existingUsers.find(u => u.id === res.user.id);
                const mergedUser: UserAccount = {
                  ...(prevUser || {}),
                  ...res.user,
                  offlineVerifier: res.user.offlineVerifier ?? prevUser?.offlineVerifier,
                  offlineSalt: res.user.offlineSalt ?? prevUser?.offlineSalt,
                  offlineIterations: res.user.offlineIterations ?? prevUser?.offlineIterations
                };
                const encRec = await encryptUserAccountForStore(mergedUser, cryptoKey);
                const db = await openOfflineDb();
                const writeTx = db.transaction([OFFLINE_STORES.USERS], 'readwrite');
                writeTx.objectStore(OFFLINE_STORES.USERS).put(encRec);
                await txDone(writeTx);
              } catch (_) {}
            }

            await removeOutboxOperation(op.id);
            syncedCount++;
          } else if (res && res.success && isCreditCollectionOp) {
            // تحديث الفواتير المحصلة في التخزين المحلي وإزالتها من المعلقة
            try {
              const db = await openOfflineDb();
              const nowIso = new Date().toISOString();
              const readTx = db.transaction([OFFLINE_STORES.CREDIT], 'readonly');
              const creditRead = readTx.objectStore(OFFLINE_STORES.CREDIT);
              const [invoicesRec, pendingRec] = await Promise.all([
                reqToPromise<CreditRecord<Invoice[]> | undefined>(creditRead.get('invoices')),
                reqToPromise<CreditRecord<Invoice[]> | undefined>(creditRead.get('pendingInvoices'))
              ]);

              const involvedNums = new Set<string>([
                ...(Array.isArray(op.payload?.invoiceNumbers) ? op.payload.invoiceNumbers : []),
                ...(Array.isArray(res.settledInvoices) ? res.settledInvoices : []),
                ...(Array.isArray(res.duplicateCollectionInvoices) ? res.duplicateCollectionInvoices : [])
              ]);
              const dupNums = new Set<string>(
                Array.isArray(res.duplicateCollectionInvoices) ? res.duplicateCollectionInvoices : []
              );

              const updatedInvoices = (invoicesRec?.data || []).map(inv => {
                if (involvedNums.has(inv.invoiceNumber) || (inv.offlineProvisionalNo && involvedNums.has(inv.offlineProvisionalNo))) {
                  const isDup = dupNums.has(inv.invoiceNumber);
                  const prevReasons = Array.isArray(inv.reviewReasons) ? inv.reviewReasons : [];
                  return {
                    ...inv,
                    status: 'مسددة' as const,
                    creditStatus: 'مسددة' as const,
                    remainingAmount: 0,
                    offlineCollectionPending: false,
                    needsReview: isDup ? true : inv.needsReview,
                    reviewReasons: isDup
                      ? Array.from(new Set([...prevReasons, 'تحصيل مكرر']))
                      : prevReasons
                  };
                }
                return inv;
              });

              const updatedPending = (pendingRec?.data || []).filter(
                inv => !involvedNums.has(inv.invoiceNumber) && !(inv.offlineProvisionalNo && involvedNums.has(inv.offlineProvisionalNo))
              );

              const writeTx = db.transaction([OFFLINE_STORES.CREDIT], 'readwrite');
              writeTx.objectStore(OFFLINE_STORES.CREDIT).put({
                key: 'invoices',
                data: updatedInvoices,
                updatedAt: nowIso
              } satisfies CreditRecord);
              writeTx.objectStore(OFFLINE_STORES.CREDIT).put({
                key: 'pendingInvoices',
                data: updatedPending,
                updatedAt: nowIso
              } satisfies CreditRecord);
              await txDone(writeTx);
            } catch (_) {}

            // حذف العملية من outbox فقط بعد تأكيد الخادم
            await removeOutboxOperation(op.id);
            syncedCount++;
          } else if (res && res.success && res.invoice) {
            const finalNo = String(res.finalInvoiceNumber || res.invoice.invoiceNumber || provisionalNo).trim();
            const confirmedInvoice: Invoice = {
              ...res.invoice,
              invoiceNumber: finalNo,
              offlineProvisionalNo: provisionalNo || res.invoice.offlineProvisionalNo,
              tempInvoiceNumber: provisionalNo || res.invoice.tempInvoiceNumber,
              isOffline: true,
              offlinePending: false,
              needsReview: Boolean(res.needsReview ?? res.invoice.needsReview),
              reviewReasons: res.reviewReasons || res.invoice.reviewReasons || []
            };

            // 1. حفظ الرقم النهائي بجانب الرقم المؤقت وتحديث السجل المحلي
            await applyConfirmedInvoiceToLocalDb({
              provisionalInvoiceNumber: provisionalNo,
              finalInvoiceNumber: finalNo,
              confirmedInvoice
            });

            // 2. حذف العملية من outbox فقط بعد تأكيد الخادم
            await removeOutboxOperation(op.id);

            const syncedItem: SyncedOutboxInvoiceItem = {
              idempotencyKey: idemKey,
              provisionalInvoiceNumber: provisionalNo,
              finalInvoiceNumber: finalNo,
              invoice: confirmedInvoice,
              duplicate: Boolean(res.duplicate)
            };
            syncedInvoices.push(syncedItem);
            syncedCount++;

            if (options?.onOperationSynced) {
              try {
                options.onOperationSynced(syncedItem);
              } catch (_) {}
            }
          } else if (res && !res.success && (res.code === 'BEFORE_RESET' || res.statusCode === 409)) {
            const reasonMsg =
              (res.error && String(res.error).trim()) ||
              'هذه العملية سُجّلت على الجهاز قبل إعادة ضبط النظام، ولن تُرفع.';
            await updateOutboxOperation(op.id, {
              status: OUTBOX_CANCELLED_BEFORE_RESET_STATUS,
              lastError: reasonMsg
            });
            cancelledBeforeResetCount++;
            // لا نوقف المزامنة عند عملية أقدم من إعادة الضبط؛ ننتقل للعمليات الأحدث
            continue;
          } else if (
            res &&
            !res.success &&
            (res.statusCode === 403 || SETTINGS_REJECTION_CODES.has(String(res.code || '').trim()))
          ) {
            const reasonMsg =
              (res.error && String(res.error).trim()) ||
              'تم رفض العملية من الخادم لتعارضها مع إعدادات البيع الحالية؛ محفوظة محليًا للمراجعة.';
            await updateOutboxOperation(op.id, {
              status: OUTBOX_REJECTED_REVIEW_STATUS,
              needsReview: true,
              lastError: reasonMsg
            });
            rejectedReviewCount++;
            if (!lastError) lastError = reasonMsg;
            continue;
          } else {
            const errMsg = (res && res.error) || 'تعذر رفع العملية إلى الخادم';
            failedCount++;
            lastError = errMsg;
            const nextRetry = (op.retryCount || 0) + 1;
            if (nextRetry > maxRetryCountOnFailure) {
              maxRetryCountOnFailure = nextRetry;
            }
            await updateOutboxOperation(op.id, {
              status: 'failed',
              lastError: errMsg,
              retryCount: nextRetry
            });
            // نتوقف عند أول فشل للحفاظ على الترتيب التسلسلي للعمليات
            break;
          }
        } catch (err: any) {
          if (err?.code === 'BEFORE_RESET' || err?.status === 409 || err?.statusCode === 409) {
            const reasonMsg =
              (err?.message && String(err.message).trim()) ||
              'هذه العملية سُجّلت على الجهاز قبل إعادة ضبط النظام، ولن تُرفع.';
            await updateOutboxOperation(op.id, {
              status: OUTBOX_CANCELLED_BEFORE_RESET_STATUS,
              lastError: reasonMsg
            });
            cancelledBeforeResetCount++;
            continue;
          }
          if (
            err?.status === 403 ||
            err?.statusCode === 403 ||
            SETTINGS_REJECTION_CODES.has(String(err?.code || '').trim())
          ) {
            const reasonMsg =
              (err?.message && String(err.message).trim()) ||
              'تم رفض العملية من الخادم لتعارضها مع إعدادات البيع الحالية؛ محفوظة محليًا للمراجعة.';
            await updateOutboxOperation(op.id, {
              status: OUTBOX_REJECTED_REVIEW_STATUS,
              needsReview: true,
              lastError: reasonMsg
            });
            rejectedReviewCount++;
            if (!lastError) lastError = reasonMsg;
            continue;
          }
          const errMsg = err?.message || 'انقطع الاتصال أثناء رفع العملية';
          failedCount++;
          lastError = errMsg;
          if (err?.status === 401) {
            // إذا انتهت صلاحية الجلسة عند رجوع الاتصال، تبقى العملية معلّقة بانتظار تسجيل الدخول الجديد
            await updateOutboxOperation(op.id, {
              status: 'معلّقة',
              lastError: errMsg
            });
            break;
          }
          const nextRetry = (op.retryCount || 0) + 1;
          if (nextRetry > maxRetryCountOnFailure) {
            maxRetryCountOnFailure = nextRetry;
          }
          await updateOutboxOperation(op.id, {
            status: 'failed',
            lastError: errMsg,
            retryCount: nextRetry
          });
          // نتوقف عند انقطاع الاتصال أثناء الرفع للحفاظ على ترتيب العمليات وإعادة المحاولة بنفس المفتاح
          break;
        }
      }

      const remainingCount = await getOutboxPendingCount();
      let nextRetryDelayMs: number | null = null;

      if (remainingCount > 0 && failedCount > 0) {
        nextRetryDelayMs = getOutboxBackoffDelayMs(maxRetryCountOnFailure || 1);
        if (!options?.disableAutoRetrySchedule && typeof window !== 'undefined') {
          clearOutboxRetryTimer();
          outboxRetryTimerId = setTimeout(() => {
            outboxRetryTimerId = null;
            if (typeof navigator === 'undefined' || navigator.onLine !== false) {
              syncOutboxOperations({
                user: options?.user,
                onOperationSynced: options?.onOperationSynced
              }).catch(() => {});
            }
          }, nextRetryDelayMs);
        }
      }

      // 3. بعد انتهاء المزامنة: تنزيل نسخة جديدة للتخزين المحلي
      if (syncedCount > 0 && remainingCount === 0 && options?.user && !options?.skipSnapshotRefresh) {
        await syncFullStoresToOfflineDb(options.user).catch(() => {});
      }

      notifyOfflineDbChange();

      return {
        success: failedCount === 0 && remainingCount === 0,
        totalProcessed,
        syncedCount,
        failedCount,
        cancelledBeforeResetCount,
        rejectedReviewCount,
        remainingCount,
        syncedInvoices,
        lastError,
        nextRetryDelayMs
      };
    } finally {
      activeOutboxSyncPromise = null;
    }
  })();

  return activeOutboxSyncPromise;
}

// ============================================================================
// المهمة 13: النسخة الاحتياطية التلقائية في مجلد (JSONL)، فحص سعة التخزين،
// تنبيه الساعة، حماية تسجيل الخروج ومسح البيانات، وأدوات شاشة «المزامنة»
// ============================================================================

export function getBackupJsonlFileName(dateInput?: Date | string): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const yyyy = validDate.getFullYear();
  const mm = String(validDate.getMonth() + 1).padStart(2, '0');
  const dd = String(validDate.getDate()).padStart(2, '0');
  return `mudaqqeq-offline-${yyyy}-${mm}-${dd}.jsonl`;
}

export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).showDirectoryPicker === 'function'
  );
}

export interface BackupDirectoryStatus {
  supported: boolean;
  configured: boolean;
  directoryName: string | null;
  permission: 'unconfigured' | 'granted' | 'prompt' | 'denied';
  needsActivationBanner: boolean;
  lastBackupFileName: string | null;
  lastBackupFileWriteAt: string | null;
}

/**
 * اختيار مجلد النسخ الاحتياطي (Chrome و Edge على الكمبيوتر) وحفظ مقبض المجلد في IndexedDB
 */
export async function selectBackupDirectory(
  customPicker?: () => Promise<any>
): Promise<BackupDirectoryStatus> {
  const pickerFn =
    customPicker ||
    (typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function'
      ? () => (window as any).showDirectoryPicker({ mode: 'readwrite' })
      : null);

  if (!pickerFn) {
    throw new Error('متصفحك الحالي لا يدعم اختيار مجلد النسخ الاحتياطي المباشر (متاح على Chrome و Edge للكمبيوتر)');
  }

  const dirHandle = await pickerFn();
  if (!dirHandle) {
    throw new Error('لم يتم اختيار مجلد النسخ الاحتياطي');
  }

  let perm: 'granted' | 'prompt' | 'denied' = 'granted';
  if (typeof dirHandle.queryPermission === 'function') {
    perm = (await dirHandle.queryPermission({ mode: 'readwrite' })) || 'granted';
    if (perm !== 'granted' && typeof dirHandle.requestPermission === 'function') {
      perm = (await dirHandle.requestPermission({ mode: 'readwrite' })) || 'prompt';
    }
  }

  const dirName = String(dirHandle.name || 'مجلد النسخ الاحتياطي');
  await setMetaValue('backupDirectoryHandle', dirHandle);
  await setMetaValue('backupDirectoryName', dirName);
  notifyOfflineDbChange();

  const lastFileName = await getMetaValue<string>('lastBackupFileName');
  const lastWriteAt = await getMetaValue<string>('lastBackupFileWriteAt');

  return {
    supported: true,
    configured: true,
    directoryName: dirName,
    permission: perm,
    needsActivationBanner: perm !== 'granted',
    lastBackupFileName: lastFileName || null,
    lastBackupFileWriteAt: lastWriteAt || null
  };
}

/**
 * فحص حالة إذن مجلد النسخ الاحتياطي المحفوظ في IndexedDB
 * (يكتشف سقوط الإذن بعد إعادة تشغيل المتصفح لإظهار شريط «فعّل النسخ الاحتياطي»)
 */
export async function getBackupDirectoryStatus(): Promise<BackupDirectoryStatus> {
  const supported = isFileSystemAccessSupported();
  try {
    const [dirHandle, savedName, lastFileName, lastWriteAt] = await Promise.all([
      getMetaValue<any>('backupDirectoryHandle'),
      getMetaValue<string>('backupDirectoryName'),
      getMetaValue<string>('lastBackupFileName'),
      getMetaValue<string>('lastBackupFileWriteAt')
    ]);

    if (!dirHandle) {
      return {
        supported,
        configured: false,
        directoryName: null,
        permission: 'unconfigured',
        needsActivationBanner: false,
        lastBackupFileName: lastFileName || null,
        lastBackupFileWriteAt: lastWriteAt || null
      };
    }

    let perm: 'granted' | 'prompt' | 'denied' = 'granted';
    if (typeof dirHandle.queryPermission === 'function') {
      try {
        perm = (await dirHandle.queryPermission({ mode: 'readwrite' })) || 'prompt';
      } catch (_) {
        perm = 'prompt';
      }
    }

    const directoryName = String(dirHandle.name || savedName || 'مجلد النسخ الاحتياطي');
    return {
      supported: true,
      configured: true,
      directoryName,
      permission: perm,
      needsActivationBanner: perm !== 'granted',
      lastBackupFileName: lastFileName || null,
      lastBackupFileWriteAt: lastWriteAt || null
    };
  } catch (_) {
    return {
      supported,
      configured: false,
      directoryName: null,
      permission: 'unconfigured',
      needsActivationBanner: false,
      lastBackupFileName: null,
      lastBackupFileWriteAt: null
    };
  }
}

/**
 * استعادة وتفعيل إذن الكتابة في مجلد النسخ الاحتياطي بضغطة واحدة بعد إعادة تشغيل المتصفح
 */
export async function activateBackupDirectoryPermission(): Promise<BackupDirectoryStatus> {
  const dirHandle = await getMetaValue<any>('backupDirectoryHandle');
  if (!dirHandle) {
    return getBackupDirectoryStatus();
  }

  let perm: 'granted' | 'prompt' | 'denied' = 'granted';
  if (typeof dirHandle.requestPermission === 'function') {
    perm = (await dirHandle.requestPermission({ mode: 'readwrite' })) || 'prompt';
  } else if (typeof dirHandle.queryPermission === 'function') {
    perm = (await dirHandle.queryPermission({ mode: 'readwrite' })) || 'granted';
  }

  // عند استعادة الإذن، نكتب أي عمليات معلّقة حالية في ملف اليوم لضمان عدم فوات أي سطر
  if (perm === 'granted') {
    try {
      const pendingOps = await getOutboxOperations();
      const activeOps = pendingOps.filter(
        op =>
          op.status === 'معلّقة' ||
          op.status === 'pending' ||
          op.status === 'syncing' ||
          op.status === 'failed'
      );
      for (const op of activeOps) {
        await appendOperationToBackupDirectory(op);
      }
    } catch (_) {}
  }

  notifyOfflineDbChange();
  return getBackupDirectoryStatus();
}

/**
 * إضافة سطر JSONL لعملية أوفلاين إلى ملف اليوم mudaqqeq-offline-YYYY-MM-DD.jsonl داخل مجلد النسخ الاحتياطي (قبل الطباعة)
 */
export async function appendOperationToBackupDirectory(
  op: OutboxOperation
): Promise<{ written: boolean; fileName: string | null }> {
  try {
    const dirHandle = await getMetaValue<any>('backupDirectoryHandle');
    if (!dirHandle || typeof dirHandle.getFileHandle !== 'function') {
      return { written: false, fileName: null };
    }

    if (typeof dirHandle.queryPermission === 'function') {
      const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        return { written: false, fileName: null };
      }
    }

    const fileName = getBackupJsonlFileName(op.deviceTime || op.createdAt);
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const lineContent = `${JSON.stringify(op)}\n`;

    let existingText = '';
    let existingSize = 0;
    if (typeof fileHandle.getFile === 'function') {
      try {
        const fileObj = await fileHandle.getFile();
        existingSize = Number(fileObj?.size || 0);
        if (typeof fileObj?.text === 'function') {
          existingText = await fileObj.text();
        }
      } catch (_) {}
    }

    // منع تكرار نفس السطر لنفس المفتاح في نفس ملف اليوم
    const opKey = String(op.idempotencyKey || op.id || '').trim();
    if (opKey && existingText && existingText.includes(`"${opKey}"`)) {
      return { written: true, fileName };
    }

    if (typeof fileHandle.createWritable === 'function') {
      const writable = await fileHandle.createWritable({ keepExistingData: true });
      if (typeof writable.seek === 'function' && existingSize > 0) {
        await writable.seek(existingSize);
        await writable.write(lineContent);
      } else if (existingText) {
        await writable.write(existingText + lineContent);
      } else {
        await writable.write(lineContent);
      }
      await writable.close();
    }

    const nowIso = new Date().toISOString();
    await setMetaValue('lastBackupFileName', fileName);
    await setMetaValue('lastBackupFileWriteAt', nowIso);

    return { written: true, fileName };
  } catch (err) {
    console.warn('[OfflineBackup] Could not append to backup directory:', err);
    return { written: false, fileName: null };
  }
}

// ============================================================================
// فحص سعة التخزين (navigator.storage.estimate): تحذير عند 80%، وإيقاف البيع عند الامتلاء الفعلي فقط
// ============================================================================

export interface StorageQuotaStatus {
  usage: number;
  quota: number;
  usageRatio: number;
  usagePercent: number;
  isWarning: boolean;
  isFull: boolean;
  warningMessage: string | null;
  fullErrorMessage: string | null;
}

let storageEstimateTestOverride: (() => Promise<{ usage?: number; quota?: number }>) | null = null;

export function setStorageEstimateOverrideForTest(
  fn: (() => Promise<{ usage?: number; quota?: number }>) | null
): void {
  storageEstimateTestOverride = fn;
}

export async function checkStorageQuotaStatus(): Promise<StorageQuotaStatus> {
  try {
    const estimator =
      storageEstimateTestOverride ||
      (typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.estimate === 'function'
        ? () => navigator.storage.estimate()
        : null);

    if (!estimator) {
      return {
        usage: 0,
        quota: 0,
        usageRatio: 0,
        usagePercent: 0,
        isWarning: false,
        isFull: false,
        warningMessage: null,
        fullErrorMessage: null
      };
    }

    const estimate = await estimator();
    const usage = Math.max(0, Number(estimate?.usage || 0));
    const quota = Math.max(0, Number(estimate?.quota || 0));
    const usageRatio = quota > 0 ? usage / quota : 0;
    const usagePercent = Math.round(usageRatio * 1000) / 10;

    // الامتلاء الفعلي (>= 99% أو لم يتبقَّ سوى أقل من 64 كيلوبايت)
    const isFull = quota > 0 && (usageRatio >= 0.99 || quota - usage < 64 * 1024);
    // التحذير عند وصول التخزين 80% فأكثر (دون إيقاف البيع)
    const isWarning = quota > 0 && usageRatio >= 0.8 && !isFull;

    return {
      usage,
      quota,
      usageRatio,
      usagePercent,
      isWarning,
      isFull,
      warningMessage: isWarning
        ? `تحذير: وصلت مساحة التخزين على الجهاز إلى ${usagePercent}%. يرجى الاتصال بالإنترنت ومزامنة العمليات في أقرب وقت.`
        : null,
      fullErrorMessage: isFull
        ? 'مساحة التخزين على الجهاز ممتلئة بالكامل. لا يمكن تسجيل مبيعات جديدة قبل الاتصال بالإنترنت ومزامنة العمليات المعلّقة'
        : null
    };
  } catch (_) {
    return {
      usage: 0,
      quota: 0,
      usageRatio: 0,
      usagePercent: 0,
      isWarning: false,
      isFull: false,
      warningMessage: null,
      fullErrorMessage: null
    };
  }
}

// ============================================================================
// تصدير واستيراد ملف النسخ الاحتياطي (.jsonl) وتنبيه الساعة وحماية الخروج/المسح
// ============================================================================

export function getOperationMonetaryAmount(op: OutboxOperation): number {
  if (!op) return 0;
  if (op.type === 'createInvoice' || op.operationType === 'createInvoice') {
    const val = Number(
      op.payload?.offlineInvoice?.netAmount ??
      op.payload?.netAmount ??
      op.payload?.totalBeforeDiscount ??
      0
    );
    return Math.round((isNaN(val) ? 0 : val) * 100) / 100;
  }
  if (
    op.type === 'collectCredit' ||
    op.operationType === 'collectCreditInvoices' ||
    op.payload?.type === 'collectCredit'
  ) {
    const val = Number(
      op.payload?.receivedAmount ??
      op.payload?.offlineResult?.receivedAmount ??
      0
    );
    return Math.round((isNaN(val) ? 0 : val) * 100) / 100;
  }
  return 0;
}

export async function getOutboxSummaryForSyncScreen(): Promise<{
  allOps: OutboxOperation[];
  pendingOps: OutboxOperation[];
  failedOps: OutboxOperation[];
  cancelledOps: OutboxOperation[];
  rejectedReviewOps: OutboxOperation[];
  pendingCount: number;
  pendingTotalAmount: number;
  failedCount: number;
  failedTotalAmount: number;
  cancelledCount: number;
  rejectedReviewCount: number;
}> {
  const allOps = await getOutboxOperations();
  const pendingOps = allOps.filter(
    op =>
      op.status === 'معلّقة' ||
      op.status === 'pending' ||
      op.status === 'syncing' ||
      op.status === 'failed'
  );
  const cancelledOps = allOps.filter(
    op => op.status === OUTBOX_CANCELLED_BEFORE_RESET_STATUS
  );
  const rejectedReviewOps = allOps.filter(
    op => op.status === OUTBOX_REJECTED_REVIEW_STATUS
  );
  const failedOps = allOps.filter(
    op =>
      op.status !== OUTBOX_CANCELLED_BEFORE_RESET_STATUS &&
      (op.status === 'failed' ||
        op.status === OUTBOX_REJECTED_REVIEW_STATUS ||
        Boolean(op.lastError && String(op.lastError).trim()))
  );

  const pendingTotalAmount =
    Math.round(pendingOps.reduce((sum, op) => sum + getOperationMonetaryAmount(op), 0) * 100) / 100;
  const failedTotalAmount =
    Math.round(failedOps.reduce((sum, op) => sum + getOperationMonetaryAmount(op), 0) * 100) / 100;

  return {
    allOps,
    pendingOps,
    failedOps,
    cancelledOps,
    rejectedReviewOps,
    pendingCount: pendingOps.length,
    pendingTotalAmount,
    failedCount: failedOps.length,
    failedTotalAmount,
    cancelledCount: cancelledOps.length,
    rejectedReviewCount: rejectedReviewOps.length
  };
}

/**
 * تجهيز محتوى ملف النسخ الاحتياطي بصيغة JSONL للعمليات المعلّقة على الجهاز
 */
export async function exportOutboxToJsonlString(
  customOps?: OutboxOperation[]
): Promise<{ jsonl: string; fileName: string; count: number }> {
  const ops =
    customOps ||
    (await getOutboxOperations()).filter(
      op =>
        op.status === 'معلّقة' ||
        op.status === 'pending' ||
        op.status === 'syncing' ||
        op.status === 'failed'
    );

  const sorted = [...ops].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lines = sorted.map(op => JSON.stringify(op));
  const jsonl = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  const fileName = getBackupJsonlFileName();

  return {
    jsonl,
    fileName,
    count: sorted.length
  };
}

/**
 * تنزيل ملف احتياطي .jsonl للعمليات المعلّقة (يُستخدم لزر «تصدير ملف» وللمتصفحات التي لا تدعم showDirectoryPicker كالموبايل مع كل تنبيه ساعة)
 */
export async function downloadPendingOutboxJsonlBackup(
  customOps?: OutboxOperation[]
): Promise<{ downloaded: boolean; fileName: string; count: number; jsonl: string }> {
  const { jsonl, fileName, count } = await exportOutboxToJsonlString(customOps);
  if (count === 0 || !jsonl) {
    return { downloaded: false, fileName, count: 0, jsonl: '' };
  }

  let downloaded = false;
  if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    try {
      const blob = new Blob([jsonl], { type: 'application/x-ndjson;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      downloaded = true;
    } catch (_) {
      downloaded = false;
    }
  }

  const nowIso = new Date().toISOString();
  await setMetaValue('lastBackupDownloadAt', nowIso).catch(() => {});
  await setMetaValue('lastBackupFileName', fileName).catch(() => {});

  return { downloaded, fileName, count, jsonl };
}

/**
 * فحص وتوليد تنبيه الساعة طالما توجد عمليات معلّقة:
 * «عندك X عملية لم تُرفع بعد. وصّل الإنترنت في أقرب وقت» (البيع لا يتوقف)
 * وفي المتصفحات التي لا تدعم showDirectoryPicker (الموبايل): ينزّل ملفًا احتياطيًا بالعمليات المعلّقة تلقائيًا مع كل تنبيه ساعة.
 */
export async function triggerHourlyPendingOperationsAlert(options?: {
  forceDownloadOnUnsupported?: boolean;
}): Promise<{
  shouldAlert: boolean;
  pendingCount: number;
  message: string | null;
  downloadedBackupFile: boolean;
  backupFileName: string | null;
  backupJsonl: string | null;
}> {
  const summary = await getOutboxSummaryForSyncScreen();
  if (summary.pendingCount <= 0) {
    return {
      shouldAlert: false,
      pendingCount: 0,
      message: null,
      downloadedBackupFile: false,
      backupFileName: null,
      backupJsonl: null
    };
  }

  const message = `عندك ${summary.pendingCount} عملية لم تُرفع بعد. وصّل الإنترنت في أقرب وقت`;
  const folderSupported = isFileSystemAccessSupported();
  let downloadedBackupFile = false;
  let backupFileName: string | null = null;
  let backupJsonl: string | null = null;

  if (!folderSupported || options?.forceDownloadOnUnsupported) {
    const dlRes = await downloadPendingOutboxJsonlBackup(summary.pendingOps);
    downloadedBackupFile = dlRes.count > 0;
    backupFileName = dlRes.fileName;
    backupJsonl = dlRes.jsonl;
  }

  await setMetaValue('lastHourlyPendingAlertAt', new Date().toISOString()).catch(() => {});

  return {
    shouldAlert: true,
    pendingCount: summary.pendingCount,
    message,
    downloadedBackupFile,
    backupFileName,
    backupJsonl
  };
}

/**
 * الحماية: منع تسجيل الخروج النهائي أو مسح بيانات التطبيق أثناء وجود عمليات معلّقة، مع شرح السبب.
 * (تبديل المستخدم أوفلاين يبقى مسموحًا).
 */
export async function canPerformFinalLogoutOrClearData(): Promise<{
  allowed: boolean;
  pendingCount: number;
  reason: string | null;
}> {
  const pendingCount = await getOutboxPendingCount();
  if (pendingCount > 0) {
    return {
      allowed: false,
      pendingCount,
      reason: `لا يمكن تسجيل الخروج النهائي أو مسح بيانات التطبيق لوجود ${pendingCount} عملية معلّقة لم تُرفع بعد. يرجى الاتصال بالإنترنت ومزامنة العمليات أولًا، أو استخدام «تبديل المستخدم أوفلاين».`
    };
  }
  return {
    allowed: true,
    pendingCount: 0,
    reason: null
  };
}

/**
 * مسح بيانات التطبيق المحلية بأمان (يرفض المسح إذا وُجدت عمليات معلّقة لم تُرفع بعد)
 */
export async function clearLocalApplicationDataSafely(): Promise<{
  success: boolean;
  message: string;
}> {
  const guard = await canPerformFinalLogoutOrClearData();
  if (!guard.allowed) {
    throw new Error(guard.reason!);
  }

  const db = await openOfflineDb();
  const tx = db.transaction(
    [OFFLINE_STORES.CATALOG, OFFLINE_STORES.CREDIT, OFFLINE_STORES.USERS],
    'readwrite'
  );
  tx.objectStore(OFFLINE_STORES.CATALOG).clear();
  tx.objectStore(OFFLINE_STORES.CREDIT).clear();
  tx.objectStore(OFFLINE_STORES.USERS).clear();
  await txDone(tx);
  notifyOfflineDbChange();

  return {
    success: true,
    message: 'تم مسح البيانات المحلية المخزنة بنجاح بعد التأكد من عدم وجود أي عمليات معلّقة'
  };
}

/**
 * استيراد ملف احتياطي (.jsonl): يقرأ السطور ويرفع عملياتها إلى الخادم بالترتيب مع منع التكرار بالمفتاح (idempotencyKey)
 */
export async function importJsonlBackupAndSync(
  jsonlContent: string,
  options?: {
    user?: UserAccount | null;
    sender?: (payload: any) => Promise<any>;
    skipSnapshotRefresh?: boolean;
  }
): Promise<{
  success: boolean;
  totalLines: number;
  validOperations: number;
  syncedCount: number;
  duplicateCount: number;
  failedCount: number;
  errors: string[];
}> {
  await assertOfflineWriteOwnership();

  const rawLines = String(jsonlContent || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return {
      success: false,
      totalLines: 0,
      validOperations: 0,
      syncedCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      errors: ['الملف المختار فارغ ولا يحتوي على أي عمليات']
    };
  }

  const parsedOps: OutboxOperation[] = [];
  const seenKeysInFile = new Set<string>();
  const errors: string[] = [];
  let duplicateInFileCount = 0;

  for (let i = 0; i < rawLines.length; i++) {
    try {
      const obj = JSON.parse(rawLines[i]);
      if (!obj || typeof obj !== 'object') {
        errors.push(`السطر ${i + 1}: تنسيق غير صالح`);
        continue;
      }
      const idemKey = String(
        obj.idempotencyKey || obj.id || obj.payload?.idempotencyKey || ''
      ).trim();
      if (!idemKey) {
        errors.push(`السطر ${i + 1}: يفتقر إلى مفتاح منع التكرار (idempotencyKey)`);
        continue;
      }
      if (seenKeysInFile.has(idemKey)) {
        duplicateInFileCount++;
        continue;
      }
      seenKeysInFile.add(idemKey);

      const normalizedOp: OutboxOperation = {
        id: idemKey,
        idempotencyKey: idemKey,
        type: obj.type || obj.operationType || obj.payload?.type || 'createInvoice',
        operationType: obj.operationType || obj.type || obj.payload?.operationType || 'createInvoice',
        invoiceNumber:
          obj.invoiceNumber ||
          obj.payload?.offlineProvisionalNo ||
          obj.payload?.invoiceNumber ||
          obj.payload?.collectionId,
        needsReview: Boolean(obj.needsReview ?? obj.payload?.needsReview),
        payload: obj.payload && typeof obj.payload === 'object' ? obj.payload : obj,
        status: 'معلّقة',
        retryCount: Number(obj.retryCount || 0),
        lastError: null,
        deviceId: String(obj.deviceId || obj.payload?.deviceId || obj.payload?.offlineDeviceId || ''),
        deviceName: String(obj.deviceName || obj.payload?.deviceName || ''),
        userId: obj.userId || obj.payload?.userId,
        userName: obj.userName || obj.payload?.userName || obj.payload?.createdBy,
        createdByUserId: obj.createdByUserId || obj.userId,
        createdByUserName: obj.createdByUserName || obj.userName,
        deviceTime: String(obj.deviceTime || obj.payload?.deviceTime || obj.createdAt || new Date().toISOString()),
        createdAt: String(obj.createdAt || obj.deviceTime || new Date().toISOString()),
        updatedAt: new Date().toISOString()
      };
      parsedOps.push(normalizedOp);
    } catch (_) {
      errors.push(`السطر ${i + 1}: تعذر قراءة JSON`);
    }
  }

  if (parsedOps.length === 0) {
    return {
      success: false,
      totalLines: rawLines.length,
      validOperations: 0,
      syncedCount: 0,
      duplicateCount: duplicateInFileCount,
      failedCount: errors.length,
      errors
    };
  }

  // ترتيب العمليات حسب وقت إنشائها
  parsedOps.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const sendFn = options?.sender || (payload => api.syncOfflineOperation(payload));
  let syncedCount = 0;
  let duplicateCount = duplicateInFileCount;
  let failedCount = 0;

  for (const op of parsedOps) {
    const idemKey = op.idempotencyKey;
    const isCreditCollectionOp =
      op.type === 'collectCredit' ||
      op.operationType === 'collectCreditInvoices' ||
      op.payload?.type === 'collectCredit' ||
      op.payload?.operationType === 'collectCreditInvoices';
    const isAuthAuditOp =
      op.type === 'authAudit' ||
      op.operationType === 'OFFLINE_LOGIN' ||
      op.operationType === 'OFFLINE_LOGOUT' ||
      op.payload?.type === 'authAudit';
    const isUpdatePermissionsOp =
      op.type === 'updatePermissions' ||
      op.operationType === 'updateUserPermissions' ||
      op.payload?.type === 'updatePermissions' ||
      op.payload?.operationType === 'updateUserPermissions';

    const provisionalNo = String(
      op.invoiceNumber ||
      op.payload?.offlineProvisionalNo ||
      op.payload?.tempInvoiceNumber ||
      op.payload?.offlineInvoice?.invoiceNumber ||
      op.payload?.collectionId ||
      ''
    ).trim();

    const requestPayload = {
      ...(op.payload || {}),
      type: isCreditCollectionOp
        ? 'collectCredit'
        : isAuthAuditOp
        ? 'authAudit'
        : isUpdatePermissionsOp
        ? 'updatePermissions'
        : (op.type || 'createInvoice'),
      operationType: isCreditCollectionOp
        ? 'collectCreditInvoices'
        : isAuthAuditOp
        ? (op.operationType || op.payload?.auditAction || 'OFFLINE_LOGIN')
        : isUpdatePermissionsOp
        ? 'updateUserPermissions'
        : (op.operationType || 'createInvoice'),
      isOfflineSync: true,
      isOffline: true,
      idempotencyKey: idemKey,
      offlineProvisionalNo: provisionalNo,
      tempInvoiceNumber: provisionalNo,
      offlineDeviceId: op.deviceId || op.payload?.deviceId || '',
      deviceId: op.deviceId || op.payload?.deviceId || '',
      deviceName: op.deviceName || op.payload?.deviceName || '',
      deviceTime: op.deviceTime || op.payload?.deviceTime || op.createdAt,
      needsReview: Boolean(op.needsReview ?? op.payload?.needsReview),
      reviewReasons: Array.isArray(op.payload?.reviewReasons) ? op.payload.reviewReasons : []
    };

    try {
      const res: any = await sendFn(requestPayload);
      if (res && res.success) {
        syncedCount++;
        if (res.duplicate) {
          duplicateCount++;
        }
        if (res.invoice) {
          const finalNo = String(res.finalInvoiceNumber || res.invoice.invoiceNumber || provisionalNo).trim();
          await applyConfirmedInvoiceToLocalDb({
            provisionalInvoiceNumber: provisionalNo,
            finalInvoiceNumber: finalNo,
            confirmedInvoice: {
              ...res.invoice,
              invoiceNumber: finalNo,
              offlineProvisionalNo: provisionalNo || res.invoice.offlineProvisionalNo,
              tempInvoiceNumber: provisionalNo || res.invoice.tempInvoiceNumber,
              isOffline: true,
              offlinePending: false
            }
          }).catch(() => {});
        }
        // إذا كانت العملية موجودة أيضًا في outbox المحلي، نحذفها بعد تأكيد الخادم
        await removeOutboxOperation(idemKey).catch(() => {});
      } else {
        failedCount++;
        const errMsg = (res && res.error) || 'فشل رفع العملية من الملف الاحتياطي';
        errors.push(`العملية (${provisionalNo || idemKey}): ${errMsg}`);
      }
    } catch (err: any) {
      failedCount++;
      errors.push(`العملية (${provisionalNo || idemKey}): ${err?.message || 'خطأ في الاتصال بالخادم'}`);
    }
  }

  if (syncedCount > 0 && options?.user && !options?.skipSnapshotRefresh) {
    await syncFullStoresToOfflineDb(options.user).catch(() => {});
  }

  notifyOfflineDbChange();

  return {
    success: failedCount === 0 && syncedCount > 0,
    totalLines: rawLines.length,
    validOperations: parsedOps.length,
    syncedCount,
    duplicateCount,
    failedCount,
    errors
  };
}

/**
 * تحديث الفاتورة محليًا في IndexedDB بعد اعتماد مراجعتها («تمت المراجعة»)
 */
export async function applyReviewedInvoiceToLocalDb(params: {
  invoiceNumber: string;
  reviewNote: string;
  reviewedBy?: string;
  reviewedAt?: string;
}): Promise<void> {
  const { invoiceNumber, reviewNote, reviewedBy = 'المدير', reviewedAt = new Date().toISOString() } = params;
  const db = await openOfflineDb();
  const readTx = db.transaction([OFFLINE_STORES.CREDIT, OFFLINE_STORES.META], 'readonly');
  const creditRead = readTx.objectStore(OFFLINE_STORES.CREDIT);
  const metaRead = readTx.objectStore(OFFLINE_STORES.META);

  const [invoicesRec, pendingRec, provMapRec] = await Promise.all([
    reqToPromise<CreditRecord<Invoice[]> | undefined>(creditRead.get('invoices')),
    reqToPromise<CreditRecord<Invoice[]> | undefined>(creditRead.get('pendingInvoices')),
    reqToPromise<MetaRecord<Record<string, any>> | undefined>(metaRead.get('provisionalToFinalMap'))
  ]);

  const nowIso = new Date().toISOString();
  const updateFn = (inv: Invoice): Invoice => {
    if (
      inv.invoiceNumber === invoiceNumber ||
      inv.offlineProvisionalNo === invoiceNumber ||
      inv.tempInvoiceNumber === invoiceNumber
    ) {
      return {
        ...inv,
        needsReview: false,
        reviewedAt,
        reviewedBy,
        reviewNote
      };
    }
    return inv;
  };

  const updatedInvoices = (invoicesRec?.data || []).map(updateFn);
  const updatedPending = (pendingRec?.data || []).map(updateFn);
  const provMap = { ...(provMapRec?.value || {}) };
  for (const k of Object.keys(provMap)) {
    const entry = provMap[k];
    if (entry && (entry.finalInvoiceNumber === invoiceNumber || entry.provisionalInvoiceNumber === invoiceNumber)) {
      provMap[k] = {
        ...entry,
        needsReview: false
      };
    }
  }

  const writeTx = db.transaction([OFFLINE_STORES.CREDIT, OFFLINE_STORES.META], 'readwrite');
  writeTx.objectStore(OFFLINE_STORES.CREDIT).put({
    key: 'invoices',
    data: updatedInvoices,
    updatedAt: nowIso
  } satisfies CreditRecord);
  writeTx.objectStore(OFFLINE_STORES.CREDIT).put({
    key: 'pendingInvoices',
    data: updatedPending,
    updatedAt: nowIso
  } satisfies CreditRecord);
  writeTx.objectStore(OFFLINE_STORES.META).put({
    key: 'provisionalToFinalMap',
    value: provMap,
    updatedAt: nowIso
  } satisfies MetaRecord);

  await txDone(writeTx);
  notifyOfflineDbChange();
}

// ============================================================================
// التعامل مع إعادة ضبط النظام وحقبة البيانات (dataEpoch) على الجهاز
// ============================================================================

export async function getStoredDataEpoch(): Promise<string> {
  try {
    const metaVal = await getMetaValue<string>('dataEpoch');
    if (typeof metaVal === 'string' && metaVal.trim()) {
      return metaVal.trim();
    }
  } catch (_) {}
  try {
    if (typeof localStorage !== 'undefined') {
      return (localStorage.getItem(DATA_EPOCH_STORAGE_KEY) || '').trim();
    }
  } catch (_) {}
  return '';
}

export async function saveStoredDataEpoch(epoch: string): Promise<void> {
  const normalized = (epoch || '').trim();
  try {
    if (typeof localStorage !== 'undefined') {
      if (normalized) {
        localStorage.setItem(DATA_EPOCH_STORAGE_KEY, normalized);
      } else {
        localStorage.removeItem(DATA_EPOCH_STORAGE_KEY);
      }
    }
  } catch (_) {}
  try {
    await setMetaValue('dataEpoch', normalized);
  } catch (_) {}
}

/**
 * تفريغ النسخة المحلية المخزنة في IndexedDB عند اكتشاف أو تنفيذ إعادة ضبط النظام
 * مع الإبقاء على هوية الجهاز وإعداد مجلد النسخ الاحتياطي وسجلات outbox.
 */
export async function clearOfflineSnapshotForReset(): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(
    [OFFLINE_STORES.CATALOG, OFFLINE_STORES.CREDIT, OFFLINE_STORES.USERS, OFFLINE_STORES.META],
    'readwrite'
  );
  tx.objectStore(OFFLINE_STORES.CATALOG).clear();
  tx.objectStore(OFFLINE_STORES.CREDIT).clear();
  tx.objectStore(OFFLINE_STORES.USERS).clear();
  const metaStore = tx.objectStore(OFFLINE_STORES.META);
  metaStore.delete('provisionalToFinalMap');
  metaStore.delete('lastSyncAt');
  metaStore.delete('syncedUserId');
  metaStore.delete('syncedUserRole');
  await txDone(tx);
  notifyOfflineDbChange();
}

/**
 * تعليم أي عمليات غير مرفوعة في outbox أقدم من وقت إعادة الضبط بالحالة النهائية
 * «ملغاة — سُجّلت قبل إعادة ضبط النظام» حتى لا يعاد رفعها وتبقى ظاهرة في شاشة المزامنة.
 */
export async function cancelOutboxOperationsBeforeEpoch(epochIso: string): Promise<number> {
  const epochMs = Date.parse(String(epochIso || '').trim());
  if (!Number.isFinite(epochMs)) return 0;

  await assertOfflineWriteOwnership();

  const db = await openOfflineDb();
  const tx = openStrictOutboxWriteTx(db);
  const store = tx.objectStore(OFFLINE_STORES.OUTBOX);
  const allOps = await reqToPromise<OutboxOperation[]>(store.getAll());
  const nowIso = new Date().toISOString();
  let cancelledCount = 0;

  for (const op of allOps || []) {
    const isPendingStatus =
      op.status === 'معلّقة' ||
      op.status === 'pending' ||
      op.status === 'syncing' ||
      op.status === 'failed';
    if (!isPendingStatus) continue;

    const opTimeRaw = op.deviceTime || op.payload?.deviceTime || op.createdAt;
    const opMs = Date.parse(String(opTimeRaw || ''));
    if (Number.isFinite(opMs) && opMs < epochMs) {
      store.put({
        ...op,
        status: OUTBOX_CANCELLED_BEFORE_RESET_STATUS,
        lastError: op.lastError || 'هذه العملية سُجّلت على الجهاز قبل إعادة ضبط النظام، ولن تُرفع.',
        updatedAt: nowIso
      } satisfies OutboxOperation);
      cancelledCount++;
    }
  }

  await txDone(tx);
  if (cancelledCount > 0) {
    notifyOfflineDbChange();
  }
  return cancelledCount;
}

/**
 * مقارنة dataEpoch القادم من الخادم بالمحفوظ على الجهاز:
 * عند تغيّره (مع كونه غير فارغ) يفرّغ النسخة المحلية ويعطّل العمليات الأقدم ثم يحفظ الحقبة الجديدة.
 */
export async function applyDataEpochTransition(
  newEpoch?: string | null,
  options?: { forceClearSnapshot?: boolean }
): Promise<{
  changed: boolean;
  clearedSnapshot: boolean;
  cancelledOutboxCount: number;
  previousEpoch: string;
  currentEpoch: string;
}> {
  const incoming = String(newEpoch || '').trim();
  const previousEpoch = await getStoredDataEpoch();

  if (!incoming) {
    return {
      changed: false,
      clearedSnapshot: false,
      cancelledOutboxCount: 0,
      previousEpoch,
      currentEpoch: previousEpoch
    };
  }

  if (previousEpoch === incoming && !options?.forceClearSnapshot) {
    return {
      changed: false,
      clearedSnapshot: false,
      cancelledOutboxCount: 0,
      previousEpoch,
      currentEpoch: incoming
    };
  }

  await assertOfflineWriteOwnership();
  const cancelledOutboxCount = await cancelOutboxOperationsBeforeEpoch(incoming);
  await clearOfflineSnapshotForReset();
  await saveStoredDataEpoch(incoming);

  return {
    changed: true,
    clearedSnapshot: true,
    cancelledOutboxCount,
    previousEpoch,
    currentEpoch: incoming
  };
}



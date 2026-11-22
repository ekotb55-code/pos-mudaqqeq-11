import * as XLSX from 'xlsx';
import zlib from 'zlib';
import {
  getSystemConfig,
  setConnectionStatus,
  isValidAppsScriptUrl,
  setTaxSettings,
  INITIAL_USER_PASSWORD,
  exportPersistedConfig,
  importPersistedConfig,
  type TaxSettings
} from './config.ts';
import { calculateInvoice } from '../src/shared/invoiceCalc.ts';
import { normalizeLatestItemFirst } from '../src/shared/latestItemFirst.ts';
import { priceRuleViolation, partyRuleViolation, platformPaymentViolation, saleModeViolation, arePlatformsEnabled, describeSalesRules, DIRECT_SALE_PLATFORM_NAME } from './salesRules.ts';
import { peekInvoiceNumber, commitInvoiceNumber, getInvoiceNumberingSettings, normalizePlatformOrderId, findPlatformOrderDuplicate, MAX_PLATFORM_ORDER_LENGTH } from './invoiceNumbering.ts';
import { prepareDeliveryPlan, checkPlanTotals, createOrderForInvoice, findOrderForInvoice, findOpenOrderForInvoice, DeliveryError, type DeliveryPlan } from './delivery.ts';
import {
  initialPlatforms,
  initialItems,
  initialItemBarcodes,
  initialItemPlatformCosts,
  initialInvoices,
  initialReturns,
  initialUsers,
  buildDefaultInitialUsers,
  initialInvoiceEditLogs,
  initialStockMovements,
  initialCashboxEntries,
  initialItemChangeLogs,
  initialSuppliers,
  initialSupplierGroups,
  initialPurchases,
  initialSupplierLedger,
  initialCustomers,
  initialCustomerGroups,
  initialCustomerLedger,
  initialCashboxes,
  initialCashboxTransactions,
  initialCashboxTransfers,
  initialUserCashboxAssignments,
  initialImportBatches,
  initialCategories,
  MAIN_WAREHOUSE_ID,
  initialWarehouses,
  defaultCompanySettings,
  defaultContactSettings,
  defaultInvoicePrintSettings,
  defaultDisplaySettings,
  hashPassword,
  generateSalt,
  OFFLINE_PBKDF2_ITERATIONS,
  computeOfflinePasswordVerifier,
  generateUUID,
  normalizeUsername,
  isValidUsernameFormat,
  validatePasswordRules,
  validateContactNumber,
  type StoredUser
} from './mockData.ts';
export { OFFLINE_PBKDF2_ITERATIONS, computeOfflinePasswordVerifier, MAIN_WAREHOUSE_ID, validatePasswordRules, validateContactNumber };
import {
  isValidAppTheme,
  isValidInactivityTimeoutMinutes,
  normalizeInactivityTimeoutMinutes
} from '../src/types/index.ts';
import type {
  Item,
  ProductCategory,
  ItemBarcode,
  Platform,
  ItemPlatformCost,
  Invoice,
  InvoiceLine,
  ReturnRecord,
  ReturnLine,
  UserAccount,
  UserRole,
  PermissionKey,
  CompanySettings,
  ContactSettings,
  InvoicePrintSettings,
  DisplaySettings,
  AuditLogEntry,
  InvoiceEditLogEntry,
  StockMovement,
  CashboxEntry,
  ItemChangeLogEntry,
  ImportBatch,
  Supplier,
  SupplierGroup,
  PurchaseInvoice,
  PurchaseLine,
  PurchaseReturn,
  PurchaseReturnLine,
  SupplierLedgerEntry,
  Customer,
  CustomerGroup,
  CustomerLedgerEntry,
  Cashbox,
  DashboardCashbox,
  CashboxTransaction,
  CashboxTransfer,
  UserCashboxAssignment,
  Warehouse,
  WarehouseStock,
  UserWarehouseConfig,
  ReconciliationItem,
  ItemMovementRecord,
  ItemMovementReport,
  StockAdjustmentRecord,
  StockAdjustmentsReport,
  StockSettings,
  BnplReport,
  BnplReportLine,
  BnplReportSummary,
  PlatformReport,
  PlatformReportSummary,
  PlatformReportTopItem,
  PlatformReportStagnantItem,
  PlatformReportDaySales,
  PartyLedgerEntry,
  CollectCreditPayload,
  CollectCreditResult,
  BulkEditOperationType,
  BulkEditExcelSummary,
  BulkEditCategoryImportSummary,
  BulkEditCategoryRowAction,
  WarehouseDispatchOrder,
  WarehouseTransferLine,
  WarehouseTransferInsufficientItem
} from '../src/types/index.ts';
import { ROLE_TEMPLATES, ALL_PERMISSIONS, PERMISSIONS } from '../src/utils/permissions.ts';
export { PERMISSIONS };
import { toCairoDateStr, isDateInRange, normalizeArabicText } from '../src/utils/dateUtils.ts';

// مستودع الذاكرة المؤقت عند عدم الربط مع Google Sheets
let memoryPlatforms: Platform[] = [...initialPlatforms];
let memoryCategories: ProductCategory[] = [...initialCategories];
let memoryItems: Item[] = [...initialItems];
let memoryItemBarcodes: ItemBarcode[] = [...initialItemBarcodes];
let memoryCosts: ItemPlatformCost[] = [...initialItemPlatformCosts];
let memoryInvoices: Invoice[] = [...initialInvoices];
let memoryReturns: ReturnRecord[] = [...initialReturns];
let memoryUsers: StoredUser[] = [...initialUsers];
let memoryCompanySettings: CompanySettings = { ...defaultCompanySettings };
let memoryInvoicePrintSettings: InvoicePrintSettings = {
  ...defaultInvoicePrintSettings,
  headerText: defaultInvoicePrintSettings.headerText === 'فاتورة مبيعات مدققة وموثقة على المنصة' ? '' : (defaultInvoicePrintSettings.headerText ?? '')
};
let memoryDisplaySettings: DisplaySettings = { ...defaultDisplaySettings };
let memoryStockSettings: StockSettings = {
  allowNegativeStockSale: false,
  allowNegativeWarehouseTransfer: false
};
let memoryAuditLogs: AuditLogEntry[] = [];
let memoryInvoiceEditLogs: InvoiceEditLogEntry[] = [...initialInvoiceEditLogs];
let memoryStockMovements: StockMovement[] = [...initialStockMovements];
let memoryCashboxEntries: CashboxEntry[] = [...initialCashboxEntries];
let memoryItemChangeLogs: ItemChangeLogEntry[] = [...initialItemChangeLogs];
let memoryImportBatches: ImportBatch[] = [...initialImportBatches];
let memorySuppliers: Supplier[] = [...initialSuppliers];
let memorySupplierGroups: SupplierGroup[] = [...initialSupplierGroups];
let memoryPurchases: PurchaseInvoice[] = [...initialPurchases];
let memoryPurchaseReturns: PurchaseReturn[] = [];
let memorySupplierLedger: SupplierLedgerEntry[] = [...initialSupplierLedger];
let memoryCustomers: Customer[] = [...initialCustomers];
let memoryCustomerGroups: CustomerGroup[] = [...initialCustomerGroups];
let memoryCustomerLedger: CustomerLedgerEntry[] = [...initialCustomerLedger];
let memoryPartyLedger: PartyLedgerEntry[] = initialCustomerLedger.map(l => ({
  id: l.id,
  date: l.date,
  partyType: 'customer' as const,
  partyId: l.customerId,
  partyName: l.customerName,
  transactionType: l.transactionType,
  documentNumber: l.documentNumber,
  debit: l.debit,
  credit: l.credit,
  balanceAfter: l.balanceAfter,
  statement: l.statement,
  userName: l.userName,
  notes: l.notes
}));
let memoryCashboxes: Cashbox[] = [...initialCashboxes];
let memoryCashboxTransactions: CashboxTransaction[] = [...initialCashboxTransactions];
let memoryCashboxTransfers: CashboxTransfer[] = [...initialCashboxTransfers];
let memoryUserCashboxAssignments: UserCashboxAssignment[] = [...initialUserCashboxAssignments];
let memoryWarehouses: Warehouse[] = initialWarehouses.map(w => ({ ...w }));
let memoryWarehouseStocks: WarehouseStock[] = [];
let memoryWarehouseTransfers: WarehouseDispatchOrder[] = [];
let warehouseDispatchSeq = 0;

export const WAREHOUSE_ALL_TOKEN = 'ALL';

let warehouseMigrationCompleted = false;
let warehouseMigrationReport = {
  completed: false,
  migratedAt: '',
  mainWarehouseId: MAIN_WAREHOUSE_ID,
  itemsMigratedCount: 0,
  preMigrationTotalStock: 0,
  postMigrationTotalStock: 0,
  verifiedExactMatch: false
};

export function normalizeWarehouseName(name: string): string {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isWarehouseActive(warehouse?: Warehouse | null): boolean {
  if (!warehouse) return false;
  return warehouse.status === 'active' || warehouse.status === 'نشط';
}

function ensureMainWarehouseExists(): Warehouse {
  let mainWh = memoryWarehouses.find(w => w.isDefault) || memoryWarehouses.find(w => w.id === MAIN_WAREHOUSE_ID);
  if (!mainWh) {
    mainWh = {
      id: MAIN_WAREHOUSE_ID,
      name: 'المخزن الرئيسي',
      status: 'نشط',
      notes: 'المخزن الافتراضي الرئيسي للنظام',
      isDefault: true,
      createdAt: new Date().toISOString()
    };
    memoryWarehouses.unshift(mainWh);
  } else {
    mainWh.isDefault = true;
  }
  return mainWh;
}

export function getDefaultWarehouse(): Warehouse {
  return ensureMainWarehouseExists();
}

/**
 * قراءة رصيد صنف في مخزن محدد فقط
 */
export function getItemWarehouseStock(itemId: string, warehouseId: string): number {
  const row = memoryWarehouseStocks.find(ws => ws.itemId === itemId && ws.warehouseId === warehouseId);
  return Math.round(Number(row?.quantity || 0) * 1000) / 1000;
}

/**
 * قراءة الحد الأدنى المخصص لصنف في مخزن محدد (أو null إن لم يُحدَّد لهذا المخزن)
 */
export function getRawItemWarehouseReorderLimit(itemId: string, warehouseId: string): number | null {
  const row = memoryWarehouseStocks.find(ws => ws.itemId === itemId && ws.warehouseId === warehouseId);
  if (row && row.reorderLimit !== undefined && row.reorderLimit !== null && Number.isFinite(Number(row.reorderLimit))) {
    return Math.round(Number(row.reorderLimit) * 100) / 100;
  }
  return null;
}

/**
 * قراءة الحد الأدنى الفعال لصنف في مخزن محدد (يستخدم الحد الخاص بالمخزن إن وُجد، وإلا حد الصنف العام)
 */
export function getItemWarehouseReorderLimit(itemId: string, warehouseId?: string): number {
  if (warehouseId && warehouseId.toUpperCase() !== WAREHOUSE_ALL_TOKEN) {
    const custom = getRawItemWarehouseReorderLimit(itemId, warehouseId);
    if (custom !== null) {
      return custom;
    }
  }
  const item = memoryItems.find(it => it.id === itemId);
  return item && item.reorderLimit !== undefined ? Math.round(Number(item.reorderLimit) * 100) / 100 : 5;
}

/**
 * ضبط الحد الأدنى للكمية لصنف في مخزن محدد (أو مسحه ليرجع للحد العام للصنف)
 */
export function setItemWarehouseReorderLimit(
  itemId: string,
  warehouseId: string,
  newLimit: number | null | undefined
): number | null {
  const now = new Date().toISOString();
  const normalized =
    newLimit !== null && newLimit !== undefined && Number.isFinite(Number(newLimit))
      ? Math.round(Number(newLimit) * 100) / 100
      : null;
  const existing = memoryWarehouseStocks.find(ws => ws.itemId === itemId && ws.warehouseId === warehouseId);
  if (existing) {
    existing.reorderLimit = normalized;
    existing.updatedAt = now;
  } else {
    memoryWarehouseStocks.push({
      itemId,
      warehouseId,
      quantity: 0,
      reorderLimit: normalized,
      updatedAt: now
    });
  }
  return normalized;
}

/**
 * الدالة الوحيدة المسؤولة عن حساب stockQuantity للصنف كـ مجموع أرصدته عبر كافة المخازن
 */
export function recomputeItemTotalStock(itemId: string): number {
  let sum = 0;
  for (const ws of memoryWarehouseStocks) {
    if (ws.itemId === itemId) {
      sum += Number(ws.quantity || 0);
    }
  }
  const rounded = Math.round(sum * 1000) / 1000;
  const item = memoryItems.find(it => it.id === itemId);
  if (item) {
    item.stockQuantity = rounded;
  }
  return rounded;
}

/**
 * ضبط رصيد صنف داخل مخزن محدد وإعادة احتساب الإجمالي
 */
export function setItemWarehouseBalance(itemId: string, warehouseId: string, newQuantity: number): number {
  const rounded = Math.round(Number(newQuantity || 0) * 1000) / 1000;
  const now = new Date().toISOString();
  const existing = memoryWarehouseStocks.find(ws => ws.itemId === itemId && ws.warehouseId === warehouseId);
  if (existing) {
    existing.quantity = rounded;
    existing.updatedAt = now;
  } else {
    memoryWarehouseStocks.push({
      itemId,
      warehouseId,
      quantity: rounded,
      updatedAt: now
    });
  }
  recomputeItemTotalStock(itemId);
  return rounded;
}

/**
 * تعديل رصيد صنف في مخزن محدد بمقدار (delta) موجباً أو سالباً وإعادة احتساب الإجمالي
 */
export function adjustItemWarehouseDelta(
  itemId: string,
  warehouseId: string,
  delta: number
): { balanceInWarehouse: number; totalStock: number } {
  const current = getItemWarehouseStock(itemId, warehouseId);
  const next = Math.round((current + Number(delta || 0)) * 1000) / 1000;
  const now = new Date().toISOString();
  const existing = memoryWarehouseStocks.find(ws => ws.itemId === itemId && ws.warehouseId === warehouseId);
  if (existing) {
    existing.quantity = next;
    existing.updatedAt = now;
  } else {
    memoryWarehouseStocks.push({
      itemId,
      warehouseId,
      quantity: next,
      updatedAt: now
    });
  }
  const totalStock = recomputeItemTotalStock(itemId);
  return { balanceInWarehouse: next, totalStock };
}

/**
 * الترحيل الموحد للكميات الحالية إلى «المخزن الرئيسي» مرة واحدة عند أول تشغيل مع التحقق من عدم تغير المجموع
 */
export function migrateItemStocksToMainWarehouseOnce() {
  if (warehouseMigrationCompleted) {
    return { ...warehouseMigrationReport };
  }

  const mainWh = ensureMainWarehouseExists();
  const prePerItem = new Map<string, number>();
  let preTotal = 0;

  for (const it of memoryItems) {
    const qty = Math.round(Number(it.stockQuantity || 0) * 1000) / 1000;
    prePerItem.set(it.id, qty);
    preTotal += qty;
  }
  preTotal = Math.round(preTotal * 1000) / 1000;

  const now = new Date().toISOString();
  for (const it of memoryItems) {
    const qty = prePerItem.get(it.id) || 0;
    const existing = memoryWarehouseStocks.find(ws => ws.itemId === it.id && ws.warehouseId === mainWh.id);
    if (!existing) {
      memoryWarehouseStocks.push({
        itemId: it.id,
        warehouseId: mainWh.id,
        quantity: qty,
        updatedAt: now
      });
    }
    recomputeItemTotalStock(it.id);
  }

  let postTotal = 0;
  for (const it of memoryItems) {
    const expected = prePerItem.get(it.id) || 0;
    if (Math.abs(Number(it.stockQuantity || 0) - expected) > 0.0001) {
      throw new Error(`فشل التحقق من ترحيل رصيد الصنف "${it.id}": المتوقع ${expected} والمحسوب ${it.stockQuantity}`);
    }
    postTotal += Number(it.stockQuantity || 0);
  }
  postTotal = Math.round(postTotal * 1000) / 1000;

  if (Math.abs(postTotal - preTotal) > 0.0001) {
    throw new Error(`فشل التحقق من مجموع المخزون بعد الترحيل: قبل ${preTotal} وبعد ${postTotal}`);
  }

  // استكمال warehouseId للبيانات التاريخية المبدئية إن لم تكن محددة
  for (const sm of memoryStockMovements) {
    if (!sm.warehouseId) {
      sm.warehouseId = mainWh.id;
      sm.warehouseName = mainWh.name;
    }
  }
  for (const inv of memoryInvoices) {
    if (!inv.warehouseId) {
      inv.warehouseId = mainWh.id;
      inv.warehouseName = mainWh.name;
    }
  }
  for (const ret of memoryReturns) {
    if (!ret.warehouseId) {
      ret.warehouseId = mainWh.id;
      ret.warehouseName = mainWh.name;
    }
  }
  for (const pur of memoryPurchases) {
    if (!pur.warehouseId) {
      pur.warehouseId = mainWh.id;
      pur.warehouseName = mainWh.name;
    }
  }

  warehouseMigrationCompleted = true;
  warehouseMigrationReport = {
    completed: true,
    migratedAt: now,
    mainWarehouseId: mainWh.id,
    itemsMigratedCount: memoryItems.length,
    preMigrationTotalStock: preTotal,
    postMigrationTotalStock: postTotal,
    verifiedExactMatch: true
  };

  return { ...warehouseMigrationReport };
}

export function getWarehouseMigrationStatus() {
  return { ...warehouseMigrationReport };
}

// تنفيذ الترحيل الأولي مرة واحدة عند بدء تشغيل الخادم في وضع الذاكرة
migrateItemStocksToMainWarehouseOnce();

function findUserForWarehouseSession(session?: {
  userId?: string;
  id?: string;
  phone?: string;
  username?: string;
  name?: string;
}): StoredUser | undefined {
  if (!session) return undefined;
  return memoryUsers.find(
    u =>
      (session.userId && u.id === session.userId) ||
      (session.id && u.id === session.id) ||
      (session.phone && u.phone === session.phone) ||
      (session.username && u.normalizedUsername === normalizeUsername(session.username))
  );
}

function isManagerOrDesignerWarehouseSession(session?: {
  role?: UserRole;
  isOwner?: boolean;
  userId?: string;
  id?: string;
  phone?: string;
  username?: string;
}): boolean {
  if (!session) return true;
  if (session.role === 'designer' || session.role === 'manager' || session.isOwner) return true;
  const liveUser = findUserForWarehouseSession(session);
  if (liveUser && (liveUser.role === 'designer' || liveUser.role === 'manager' || liveUser.isOwner)) {
    return true;
  }
  return false;
}

export function getAllowedWarehouseIdsForSession(session?: {
  role?: UserRole;
  isOwner?: boolean;
  userId?: string;
  id?: string;
  phone?: string;
  username?: string;
}): 'ALL' | string[] {
  if (isManagerOrDesignerWarehouseSession(session)) return WAREHOUSE_ALL_TOKEN;
  const liveUser = findUserForWarehouseSession(session);
  if (!liveUser) {
    return WAREHOUSE_ALL_TOKEN;
  }
  if (!liveUser.warehouseConfig) {
    return [getDefaultWarehouse().id];
  }
  return Array.isArray(liveUser.warehouseConfig.allowedWarehouseIds)
    ? liveUser.warehouseConfig.allowedWarehouseIds
    : [];
}

function resolveWarehouseForOperation(
  requestedWarehouseIdOrName: string | undefined,
  session?: {
    role?: UserRole;
    isOwner?: boolean;
    userId?: string;
    id?: string;
    phone?: string;
    username?: string;
  },
  options?: {
    fallbackWarehouseId?: string;
    requireActive?: boolean;
    enforceUserAccess?: boolean;
    allowFallbackWhenOmitted?: boolean;
  }
): { ok: boolean; warehouse?: Warehouse; statusCode?: number; error?: string } {
  const requireActive = options?.requireActive !== false;
  const enforceUserAccess = options?.enforceUserAccess !== false;
  const rawReq = String(requestedWarehouseIdOrName || '').trim();
  const allowed = getAllowedWarehouseIdsForSession(session);
  const liveUser = findUserForWarehouseSession(session);
  const defaultWh = getDefaultWarehouse();

  let chosen: Warehouse | undefined;

  if (rawReq && rawReq.toUpperCase() !== WAREHOUSE_ALL_TOKEN) {
    chosen = memoryWarehouses.find(
      w => w.id === rawReq || normalizeWarehouseName(w.name) === normalizeWarehouseName(rawReq)
    );
    if (!chosen) {
      return { ok: false, statusCode: 400, error: 'المخزن المحدد غير مسجل بالنظام' };
    }
    if (enforceUserAccess && allowed !== WAREHOUSE_ALL_TOKEN && !allowed.includes(chosen.id)) {
      return { ok: false, statusCode: 403, error: `غير مصرح: المخزن "${chosen.name}" غير مسموح لك` };
    }
    if (requireActive && !isWarehouseActive(chosen)) {
      return { ok: false, statusCode: 400, error: `المخزن "${chosen.name}" موقوف ولا يمكن إجراء حركات عليه` };
    }
    return { ok: true, warehouse: chosen };
  }

  // لم يتم إرسال warehouseId صريح: تطبيق قواعد الاختيار التلقائي والافتراضي
  if (enforceUserAccess && allowed !== WAREHOUSE_ALL_TOKEN) {
    if (allowed.length === 0) {
      if (options?.allowFallbackWhenOmitted) {
        return { ok: true, warehouse: defaultWh };
      }
      return { ok: false, statusCode: 403, error: 'غير مصرح: لم يتم تعيين أي مخزن مسموح لحسابك' };
    }
    if (allowed.length === 1) {
      chosen = memoryWarehouses.find(w => w.id === allowed[0]);
      if (!chosen) {
        return { ok: false, statusCode: 400, error: 'المخزن المعيّن لحسابك غير موجود بالنظام' };
      }
      if (requireActive && !isWarehouseActive(chosen)) {
        return { ok: false, statusCode: 400, error: `المخزن "${chosen.name}" موقوف ولا يمكن إجراء حركات عليه` };
      }
      return { ok: true, warehouse: chosen };
    }
    // أكثر من مخزن مسموح: التحقق من المخزن المرجعي أو الافتراضي للمستخدم
    const candidateIds = [
      options?.fallbackWarehouseId,
      liveUser?.warehouseConfig?.defaultWarehouseId
    ].filter((id): id is string => Boolean(id));

    for (const cId of candidateIds) {
      if (allowed.includes(cId)) {
        const candidate = memoryWarehouses.find(w => w.id === cId);
        if (candidate && (!requireActive || isWarehouseActive(candidate))) {
          return { ok: true, warehouse: candidate };
        }
      }
    }

    if (options?.allowFallbackWhenOmitted) {
      const firstActive = allowed
        .map(id => memoryWarehouses.find(w => w.id === id))
        .find(w => w && (!requireActive || isWarehouseActive(w)));
      return { ok: true, warehouse: firstActive || defaultWh };
    }

    return { ok: false, statusCode: 400, error: 'يرجى تحديد المخزن لإتمام العملية' };
  }

  // المدير / المطور / النظام: استخدام المرجع أو الافتراضي
  if (options?.fallbackWarehouseId) {
    const fb = memoryWarehouses.find(w => w.id === options.fallbackWarehouseId);
    if (fb && (!requireActive || isWarehouseActive(fb))) {
      return { ok: true, warehouse: fb };
    }
  }
  if (liveUser?.warehouseConfig?.defaultWarehouseId) {
    const userDef = memoryWarehouses.find(w => w.id === liveUser.warehouseConfig!.defaultWarehouseId);
    if (userDef && (!requireActive || isWarehouseActive(userDef))) {
      return { ok: true, warehouse: userDef };
    }
  }
  if (requireActive && !isWarehouseActive(defaultWh)) {
    const anyActive = memoryWarehouses.find(w => isWarehouseActive(w));
    if (!anyActive) {
      return { ok: false, statusCode: 400, error: 'لا يوجد أي مخزن نشط متاح بالنظام' };
    }
    return { ok: true, warehouse: anyActive };
  }
  return { ok: true, warehouse: defaultWh };
}

export async function getWarehouses(session?: {
  token?: string;
  role?: UserRole;
  isOwner?: boolean;
  userId?: string;
  id?: string;
  phone?: string;
  username?: string;
}): Promise<Warehouse[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getWarehouses', undefined, session?.token);
    if (res && res.success && Array.isArray(res.data)) {
      setSheetsCache('warehouses', res.data);
      return res.data;
    }
    const cached = getSheetsCache<Warehouse[]>('warehouses');
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب المخازن من Google Sheets');
  }

  const allowed = getAllowedWarehouseIdsForSession(session);
  const list =
    allowed === WAREHOUSE_ALL_TOKEN
      ? memoryWarehouses
      : memoryWarehouses.filter(w => allowed.includes(w.id));
  return list.map(w => ({ ...w }));
}

export function getWarehouseById(id: string): Warehouse | undefined {
  const found = memoryWarehouses.find(w => w.id === id);
  return found ? { ...found } : undefined;
}

export async function saveWarehouse(
  payload: Partial<Warehouse> & { name?: string },
  session?: { token?: string; role?: UserRole; isOwner?: boolean; userId?: string; id?: string; phone?: string; name?: string }
): Promise<{ success: boolean; statusCode?: number; warehouse?: Warehouse; error?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('saveWarehouse', payload, session?.token);
    if (res && res.success) {
      return {
        success: true,
        warehouse: res.warehouse || res.data
      };
    }
    return buildSheetsWriteFailure(res, 'تعذر حفظ المخزن في Google Sheets');
  }

  const id = payload.id ? String(payload.id).trim() : '';
  const existingIdx = id ? memoryWarehouses.findIndex(w => w.id === id) : -1;
  if (id && existingIdx === -1) {
    return { success: false, statusCode: 404, error: 'المخزن المطلوب تعديله غير موجود' };
  }
  const existing = existingIdx >= 0 ? memoryWarehouses[existingIdx] : undefined;

  const rawName = payload.name !== undefined ? String(payload.name) : (existing?.name || '');
  const cleanName = rawName.trim().replace(/\s+/g, ' ');
  const normName = normalizeWarehouseName(cleanName);
  if (!normName) {
    return { success: false, statusCode: 400, error: 'اسم المخزن مطلوب' };
  }

  const dup = memoryWarehouses.find(w => w.id !== id && normalizeWarehouseName(w.name) === normName);
  if (dup) {
    return { success: false, statusCode: 400, error: `يوجد مخزن مسجل بالفعل باسم "${cleanName}"` };
  }

  const rawStatus = payload.status !== undefined ? String(payload.status).trim() : (existing?.status || 'نشط');
  const nextStatus: 'نشط' | 'موقوف' = rawStatus === 'inactive' || rawStatus === 'موقوف' ? 'موقوف' : 'نشط';

  const nextIsDefault =
    payload.isDefault !== undefined ? Boolean(payload.isDefault) : Boolean(existing?.isDefault);

  if (existing?.isDefault && payload.isDefault === false) {
    return {
      success: false,
      statusCode: 400,
      error: 'يجب أن يظل هناك مخزن افتراضي واحد على الأقل، اختر مخزناً آخر كافتراضي أولاً'
    };
  }

  if (nextIsDefault && nextStatus === 'موقوف') {
    return {
      success: false,
      statusCode: 400,
      error: 'لا يمكن إيقاف المخزن الافتراضي الرئيسي قبل تعيين مخزن افتراضي آخر'
    };
  }

  const now = new Date().toISOString();
  if (nextIsDefault) {
    for (const w of memoryWarehouses) {
      if (w.id !== id) w.isDefault = false;
    }
  }

  const warehouseToSave: Warehouse = {
    id: existing ? existing.id : (id || `wh-${Date.now().toString(36)}-${Math.floor(100 + Math.random() * 900)}`),
    name: cleanName,
    status: nextStatus,
    notes: payload.notes !== undefined ? String(payload.notes).trim() : (existing?.notes || ''),
    isDefault: nextIsDefault,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  if (existingIdx >= 0) {
    memoryWarehouses[existingIdx] = warehouseToSave;
    // تحديث اسم المخزن في الحركات والمستندات المرتبطة عند تغيير الاسم
    if (existing && existing.name !== warehouseToSave.name) {
      for (const sm of memoryStockMovements) {
        if (sm.warehouseId === warehouseToSave.id) sm.warehouseName = warehouseToSave.name;
      }
      for (const inv of memoryInvoices) {
        if (inv.warehouseId === warehouseToSave.id) inv.warehouseName = warehouseToSave.name;
      }
      for (const tr of memoryWarehouseTransfers) {
        if (tr.fromWarehouseId === warehouseToSave.id) tr.fromWarehouseName = warehouseToSave.name;
        if (tr.toWarehouseId === warehouseToSave.id) tr.toWarehouseName = warehouseToSave.name;
      }
    }
    recordAuditLog(session || {}, 'WAREHOUSE_UPDATE', 'Warehouse', warehouseToSave.id, `تعديل بيانات المخزن: ${warehouseToSave.name} (${warehouseToSave.status})`);
  } else {
    memoryWarehouses.push(warehouseToSave);
    recordAuditLog(session || {}, 'WAREHOUSE_CREATE', 'Warehouse', warehouseToSave.id, `إنشاء مخزن جديد: ${warehouseToSave.name}`);
  }

  return { success: true, warehouse: { ...warehouseToSave } };
}

export async function deleteWarehouse(
  warehouseId: string,
  session?: { token?: string; role?: UserRole; isOwner?: boolean; userId?: string; id?: string; phone?: string; name?: string }
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('deleteWarehouse', { id: warehouseId, warehouseId }, session?.token);
    if (res && res.success) {
      return { success: true };
    }
    return buildSheetsWriteFailure(res, 'تعذر حذف المخزن من Google Sheets');
  }

  const idx = memoryWarehouses.findIndex(w => w.id === warehouseId);
  if (idx === -1) {
    return { success: false, statusCode: 404, error: 'المخزن غير موجود' };
  }
  const target = memoryWarehouses[idx];
  if (target.isDefault) {
    return { success: false, statusCode: 400, error: 'لا يمكن حذف المخزن الافتراضي الرئيسي، يمكن تعديله فقط' };
  }

  const hasNonZeroBalance = memoryWarehouseStocks.some(
    ws => ws.warehouseId === warehouseId && Math.abs(Number(ws.quantity || 0)) > 0.0001
  );
  if (hasNonZeroBalance) {
    return {
      success: false,
      statusCode: 400,
      error: `لا يمكن حذف المخزن "${target.name}" لوجود أرصدة أصناف بداخله، يمكنك إيقافه فقط`
    };
  }

  const hasMovements =
    memoryStockMovements.some(sm => sm.warehouseId === warehouseId) ||
    memoryInvoices.some(inv => inv.warehouseId === warehouseId) ||
    memoryPurchases.some(p => p.warehouseId === warehouseId) ||
    memoryReturns.some(r => r.warehouseId === warehouseId) ||
    memoryPurchaseReturns.some(pr => pr.warehouseId === warehouseId) ||
    memoryWarehouseTransfers.some(t => t.fromWarehouseId === warehouseId || t.toWarehouseId === warehouseId);

  if (hasMovements) {
    return {
      success: false,
      statusCode: 400,
      error: `لا يمكن حذف المخزن "${target.name}" لوجود حركات أو مستندات مسجلة عليه، يمكنك إيقافه فقط`
    };
  }

  memoryWarehouses.splice(idx, 1);
  memoryWarehouseStocks = memoryWarehouseStocks.filter(ws => ws.warehouseId !== warehouseId);

  for (const u of memoryUsers) {
    if (u.warehouseConfig) {
      u.warehouseConfig.allowedWarehouseIds = (u.warehouseConfig.allowedWarehouseIds || []).filter(id => id !== warehouseId);
      if (u.warehouseConfig.defaultWarehouseId === warehouseId) {
        u.warehouseConfig.defaultWarehouseId = u.warehouseConfig.allowedWarehouseIds[0] || undefined;
      }
    }
  }

  recordAuditLog(session || {}, 'WAREHOUSE_DELETE', 'Warehouse', warehouseId, `حذف المخزن: ${target.name}`);
  return { success: true };
}

export async function getItemWarehouses(
  itemId: string,
  session?: { token?: string; role?: UserRole; isOwner?: boolean; userId?: string; id?: string; phone?: string; username?: string }
): Promise<{
  success: boolean;
  statusCode?: number;
  itemId?: string;
  itemName?: string;
  totalStockQuantity?: number;
  warehouses?: Array<{
    warehouseId: string;
    warehouseName: string;
    status: string;
    isDefault: boolean;
    quantity: number;
  }>;
  error?: string;
}> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getItemWarehouses', { itemId }, session?.token);
    if (res && res.success) {
      return res;
    }
    return buildSheetsWriteFailure(res, 'تعذر جلب أرصدة المخازن للصنف من Google Sheets');
  }

  const item = memoryItems.find(it => it.id === itemId);
  if (!item) {
    return { success: false, statusCode: 404, error: 'الصنف غير موجود' };
  }
  const allowed = getAllowedWarehouseIdsForSession(session);
  const visibleWarehouses =
    allowed === WAREHOUSE_ALL_TOKEN
      ? memoryWarehouses
      : memoryWarehouses.filter(w => allowed.includes(w.id));

  return {
    success: true,
    itemId: item.id,
    itemName: item.name,
    totalStockQuantity: Number(item.stockQuantity || 0),
    warehouses: visibleWarehouses.map(w => ({
      warehouseId: w.id,
      warehouseName: w.name,
      status: w.status,
      isDefault: w.isDefault,
      quantity: getItemWarehouseStock(item.id, w.id),
      reorderLimit: getItemWarehouseReorderLimit(item.id, w.id),
      customReorderLimit: getRawItemWarehouseReorderLimit(item.id, w.id)
    }))
  };
}

export async function getUserWarehouses(
  userId: string,
  session?: { token?: string }
): Promise<{
  success: boolean;
  statusCode?: number;
  userId?: string;
  role?: UserRole;
  seesAllWarehouses?: boolean;
  warehouseConfig?: UserWarehouseConfig;
  warehouses?: Warehouse[];
  error?: string;
}> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getUserWarehouses', { userId }, session?.token);
    if (res && res.success) {
      return res;
    }
    return buildSheetsWriteFailure(res, 'تعذر جلب مخازن المستخدم من Google Sheets');
  }

  const user = memoryUsers.find(u => u.id === userId);
  if (!user) {
    return { success: false, statusCode: 404, error: 'المستخدم غير موجود' };
  }
  const seesAll = user.role === 'designer' || user.role === 'manager' || Boolean(user.isOwner);
  const allowedIds = seesAll
    ? memoryWarehouses.map(w => w.id)
    : (user.warehouseConfig?.allowedWarehouseIds || []);
  const defaultWhId = user.warehouseConfig?.defaultWarehouseId;

  return {
    success: true,
    userId: user.id,
    role: user.role,
    seesAllWarehouses: seesAll,
    warehouseConfig: {
      allowedWarehouseIds: allowedIds,
      defaultWarehouseId: defaultWhId
    },
    warehouses: memoryWarehouses.filter(w => allowedIds.includes(w.id)).map(w => ({ ...w }))
  };
}

export async function saveUserWarehouses(
  userId: string,
  config: Partial<UserWarehouseConfig>,
  session?: { token?: string; role?: UserRole; isOwner?: boolean; userId?: string; id?: string; phone?: string; name?: string; permissions?: PermissionKey[] }
): Promise<{ success: boolean; statusCode?: number; warehouseConfig?: UserWarehouseConfig; error?: string }> {
  const sysConfig = getSystemConfig();
  if (isSheetsDataMode(sysConfig)) {
    const res = await callAppsScript('saveUserWarehouses', { userId, warehouseConfig: config }, session?.token);
    if (res && res.success) {
      return {
        success: true,
        warehouseConfig: res.warehouseConfig
      };
    }
    return buildSheetsWriteFailure(res, 'تعذر حفظ مخازن المستخدم في Google Sheets');
  }

  const target = memoryUsers.find(u => u.id === userId);
  if (!target) {
    return { success: false, statusCode: 404, error: 'المستخدم غير موجود' };
  }

  if ((target.role === 'designer' || target.isOwner) && session?.role !== 'designer' && !session?.isOwner) {
    return { success: false, statusCode: 403, error: 'غير مصرح: لا يمكن تعديل إعدادات مالك ومصمم النظام إلا من قِبل مالك النظام' };
  }

  const rawAllowed = Array.isArray(config.allowedWarehouseIds) ? config.allowedWarehouseIds : [];
  const uniqueAllowed = Array.from(new Set(rawAllowed.map(id => String(id).trim()).filter(Boolean)));

  for (const wId of uniqueAllowed) {
    if (!memoryWarehouses.some(w => w.id === wId)) {
      return { success: false, statusCode: 400, error: `المخزن غير موجود بالنظام: ${wId}` };
    }
  }

  let defaultWarehouseId = config.defaultWarehouseId ? String(config.defaultWarehouseId).trim() : undefined;
  if (defaultWarehouseId) {
    const defWh = memoryWarehouses.find(w => w.id === defaultWarehouseId);
    if (!defWh) {
      return { success: false, statusCode: 400, error: 'المخزن الافتراضي المحدد غير موجود بالنظام' };
    }
    const isTargetAll = target.role === 'designer' || target.role === 'manager' || Boolean(target.isOwner);
    if (!isTargetAll && !uniqueAllowed.includes(defaultWarehouseId)) {
      return { success: false, statusCode: 400, error: 'المخزن الافتراضي يجب أن يكون ضمن قائمة المخازن المسموحة للمستخدم' };
    }
  } else if (uniqueAllowed.length === 1) {
    defaultWarehouseId = uniqueAllowed[0];
  }

  const nextConfig: UserWarehouseConfig = {
    allowedWarehouseIds: uniqueAllowed,
    ...(defaultWarehouseId ? { defaultWarehouseId } : {})
  };
  target.warehouseConfig = nextConfig;

  recordAuditLog(
    session || {},
    'USER_WAREHOUSE_ASSIGN',
    'User',
    target.id,
    `تحديث المخازن المسموحة للمستخدم (${target.username}): [${uniqueAllowed.join(', ')}] | الافتراضي: ${defaultWarehouseId || 'بدون'}`
  );

  return { success: true, warehouseConfig: { ...nextConfig } };
}

type WarehouseTransferSession = {
  token?: string;
  role?: UserRole;
  isOwner?: boolean;
  userId?: string;
  id?: string;
  phone?: string;
  username?: string;
  name?: string;
  permissions?: PermissionKey[];
};

function canSessionTransferWarehouses(session?: WarehouseTransferSession): boolean {
  if (!session) return false;
  if (session.role === 'designer' || Boolean(session.isOwner)) return true;
  const liveUser = findUserForWarehouseSession(session);
  if (liveUser && (liveUser.role === 'designer' || Boolean(liveUser.isOwner))) return true;
  const perms = Array.isArray(session.permissions) ? session.permissions : (liveUser?.permissions || []);
  return perms.includes('warehouses.transfer');
}

function canSessionViewWarehouseTransfers(session?: WarehouseTransferSession): boolean {
  if (!session) return false;
  if (session.role === 'designer' || Boolean(session.isOwner)) return true;
  const liveUser = findUserForWarehouseSession(session);
  if (liveUser && (liveUser.role === 'designer' || Boolean(liveUser.isOwner))) return true;
  const perms = Array.isArray(session.permissions) ? session.permissions : (liveUser?.permissions || []);
  return perms.includes('warehouses.transfer') || perms.includes('warehouses.view');
}

function canSessionViewPurchasePriceForTransfer(session?: WarehouseTransferSession): boolean {
  if (!session) return false;
  if (session.role === 'designer' || Boolean(session.isOwner)) return true;
  const liveUser = findUserForWarehouseSession(session);
  if (liveUser && (liveUser.role === 'designer' || Boolean(liveUser.isOwner))) return true;
  const perms = Array.isArray(session.permissions) ? session.permissions : (liveUser?.permissions || []);
  return perms.includes('prices.view_purchase');
}

function sanitizeWarehouseTransferOrder(
  order: WarehouseDispatchOrder,
  canViewPurchase: boolean
): WarehouseDispatchOrder {
  const lines: WarehouseTransferLine[] = (order.lines || []).map(l => {
    const lineCopy: WarehouseTransferLine = {
      itemId: l.itemId,
      itemName: l.itemName,
      barcode: l.barcode,
      sku: l.sku,
      notes: l.notes,
      unit: l.unit,
      quantity: l.quantity,
      fromStockBefore: l.fromStockBefore,
      fromStockAfter: l.fromStockAfter,
      toStockBefore: l.toStockBefore,
      toStockAfter: l.toStockAfter
    };
    if (canViewPurchase) {
      lineCopy.purchasePriceAtTransfer = l.purchasePriceAtTransfer;
      lineCopy.lineTotalPurchase = l.lineTotalPurchase;
    }
    return lineCopy;
  });

  const orderCopy: WarehouseDispatchOrder = {
    id: order.id,
    dispatchNumber: order.dispatchNumber,
    date: order.date,
    fromWarehouseId: order.fromWarehouseId,
    fromWarehouseName: order.fromWarehouseName,
    toWarehouseId: order.toWarehouseId,
    toWarehouseName: order.toWarehouseName,
    userId: order.userId,
    userName: order.userName,
    itemsCount: order.itemsCount,
    totalQuantity: order.totalQuantity,
    notes: order.notes,
    idempotencyKey: order.idempotencyKey,
    lines
  };
  if (canViewPurchase) {
    orderCopy.totalPurchaseValue = order.totalPurchaseValue;
  }
  return orderCopy;
}

export async function getWarehouseTransferContext(session?: WarehouseTransferSession): Promise<{
  success: boolean;
  statusCode?: number;
  sourceWarehouses?: Warehouse[];
  targetWarehouses?: Warehouse[];
  allWarehouses?: Warehouse[];
  stockSettings?: StockSettings;
  error?: string;
}> {
  if (!canSessionViewWarehouseTransfers(session)) {
    return { success: false, statusCode: 403, error: 'غير مصرح: تفتقر لصلاحية عرض أو تنفيذ التحويلات بين المخازن' };
  }
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getWarehouseTransferContext', undefined, session?.token);
    if (res && res.success) {
      return res;
    }
    return buildSheetsWriteFailure(res, 'تعذر جلب سياق التحويل بين المخازن من Google Sheets');
  }
  migrateItemStocksToMainWarehouseOnce();
  const allowed = getAllowedWarehouseIdsForSession(session);
  const activeWarehouses = memoryWarehouses.filter(isWarehouseActive).map(w => ({ ...w }));
  const sourceWarehouses =
    allowed === WAREHOUSE_ALL_TOKEN
      ? activeWarehouses
      : activeWarehouses.filter(w => allowed.includes(w.id));

  return {
    success: true,
    sourceWarehouses,
    targetWarehouses: activeWarehouses,
    allWarehouses: memoryWarehouses.map(w => ({ ...w })),
    stockSettings: getStockSettings()
  };
}

export async function getWarehouseTransferStocks(
  params: { fromWarehouseId: string; toWarehouseId?: string; itemIds?: string[] },
  session?: WarehouseTransferSession
): Promise<{
  success: boolean;
  statusCode?: number;
  stocks?: Record<string, { fromStock: number; toStock: number }>;
  error?: string;
}> {
  if (!canSessionViewWarehouseTransfers(session)) {
    return { success: false, statusCode: 403, error: 'غير مصرح: تفتقر لصلاحية التحويل بين المخازن' };
  }
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getWarehouseTransferStocks', params, session?.token);
    if (res && res.success) {
      return res;
    }
    return buildSheetsWriteFailure(res, 'تعذر جلب أرصدة المخازن للتحويل من Google Sheets');
  }
  migrateItemStocksToMainWarehouseOnce();
  const fromWarehouseId = String(params?.fromWarehouseId || '').trim();
  const toWarehouseId = String(params?.toWarehouseId || '').trim();
  if (!fromWarehouseId || !memoryWarehouses.some(w => w.id === fromWarehouseId)) {
    return { success: false, statusCode: 400, error: 'المخزن المحوِّل غير موجود' };
  }
  if (toWarehouseId && !memoryWarehouses.some(w => w.id === toWarehouseId)) {
    return { success: false, statusCode: 400, error: 'المخزن المحوَّل إليه غير موجود' };
  }
  const allowed = getAllowedWarehouseIdsForSession(session);
  if (allowed !== WAREHOUSE_ALL_TOKEN && !allowed.includes(fromWarehouseId)) {
    return { success: false, statusCode: 403, error: 'غير مصرح: المخزن المحوِّل غير مسموح لحسابك' };
  }

  const targetIds = Array.isArray(params?.itemIds) && params.itemIds.length > 0
    ? params.itemIds
    : memoryItems.map(it => it.id);

  const stocks: Record<string, { fromStock: number; toStock: number }> = {};
  for (const itemId of targetIds) {
    stocks[itemId] = {
      fromStock: getItemWarehouseStock(itemId, fromWarehouseId),
      toStock: toWarehouseId ? getItemWarehouseStock(itemId, toWarehouseId) : 0
    };
  }
  return { success: true, stocks };
}

export async function createWarehouseTransfer(
  payload: {
    fromWarehouseId: string;
    toWarehouseId: string;
    lines: Array<{ itemId: string; quantity: number }>;
    notes?: string;
    idempotencyKey?: string;
  },
  session?: WarehouseTransferSession
): Promise<{
  success: boolean;
  statusCode?: number;
  duplicate?: boolean;
  order?: WarehouseDispatchOrder;
  insufficientItems?: WarehouseTransferInsufficientItem[];
  error?: string;
}> {
  if (!canSessionTransferWarehouses(session)) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية التحويل بين المخازن (warehouses.transfer)'
    };
  }

  const idemKey = getValidatedIdempotencyKey(payload?.idempotencyKey);
  if (!idemKey) {
    return {
      success: false,
      statusCode: 400,
      error: 'مفتاح منع التكرار (idempotencyKey) مطلوب لإتمام عملية التحويل'
    };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('createWarehouseTransfer', { ...payload, idempotencyKey: idemKey }, session?.token);
    if (res && res.success) {
      return res;
    }
    if (res && Array.isArray(res.insufficientItems)) {
      return {
        success: false,
        statusCode: res.statusCode || 400,
        error: res.error || 'الكمية المطلوبة تتجاوز الرصيد المتاح',
        insufficientItems: res.insufficientItems
      };
    }
    return buildSheetsWriteFailure(res, 'تعذر تنفيذ أمر الصرف والتحويل في Google Sheets');
  }

  migrateItemStocksToMainWarehouseOnce();
  const canViewPurchase = canSessionViewPurchasePriceForTransfer(session);

  const existingOrder = memoryWarehouseTransfers.find(t => t.idempotencyKey === idemKey);
  if (existingOrder) {
    return {
      success: true,
      duplicate: true,
      order: sanitizeWarehouseTransferOrder(existingOrder, canViewPurchase)
    };
  }
  const cachedOrder = getIdempotencyCachedResult('warehouseTransfer', idemKey) as WarehouseDispatchOrder | null;
  if (cachedOrder) {
    return {
      success: true,
      duplicate: true,
      order: sanitizeWarehouseTransferOrder(cachedOrder, canViewPurchase)
    };
  }

  const fromWarehouseId = String(payload?.fromWarehouseId || '').trim();
  const toWarehouseId = String(payload?.toWarehouseId || '').trim();

  if (!fromWarehouseId || !toWarehouseId) {
    return {
      success: false,
      statusCode: 400,
      error: 'يرجى تحديد المخزن المحوِّل والمخزن المحوَّل إليه'
    };
  }

  if (fromWarehouseId === toWarehouseId) {
    return {
      success: false,
      statusCode: 400,
      error: 'لا يمكن التحويل من مخزن إلى نفس المخزن'
    };
  }

  const fromWh = memoryWarehouses.find(w => w.id === fromWarehouseId);
  const toWh = memoryWarehouses.find(w => w.id === toWarehouseId);
  if (!fromWh || !toWh) {
    return {
      success: false,
      statusCode: 400,
      error: 'أحد المخازن المحددة غير موجود بالنظام'
    };
  }

  if (!isWarehouseActive(fromWh)) {
    return {
      success: false,
      statusCode: 400,
      error: `المخزن "${fromWh.name}" موقوف ولا يمكن التحويل منه`
    };
  }

  if (!isWarehouseActive(toWh)) {
    return {
      success: false,
      statusCode: 400,
      error: `المخزن "${toWh.name}" موقوف ولا يمكن التحويل إليه`
    };
  }

  const allowed = getAllowedWarehouseIdsForSession(session);
  if (allowed !== WAREHOUSE_ALL_TOKEN && !allowed.includes(fromWh.id)) {
    return {
      success: false,
      statusCode: 403,
      error: `غير مصرح: المخزن "${fromWh.name}" غير مسموح لحسابك`
    };
  }

  const rawLines = Array.isArray(payload?.lines) ? payload.lines : [];
  if (rawLines.length === 0) {
    return {
      success: false,
      statusCode: 400,
      error: 'يرجى إضافة صنف واحد على الأقل لإتمام التحويل'
    };
  }

  const seenItemIds = new Set<string>();
  const validatedInputs: Array<{ item: Item; quantity: number }> = [];

  for (const rawLine of rawLines) {
    const itemId = String(rawLine?.itemId || '').trim();
    if (!itemId) {
      return {
        success: false,
        statusCode: 400,
        error: 'يوجد سطر بدون معرّف صنف صالح'
      };
    }
    if (seenItemIds.has(itemId)) {
      return {
        success: false,
        statusCode: 400,
        error: 'لا يمكن تكرار نفس الصنف داخل أمر الصرف الواحد'
      };
    }
    seenItemIds.add(itemId);

    const item = memoryItems.find(it => it.id === itemId);
    if (!item) {
      return {
        success: false,
        statusCode: 400,
        error: `الصنف غير موجود بالنظام (${itemId})`
      };
    }

    const numQty = Number(rawLine?.quantity);
    if (!Number.isFinite(numQty) || numQty <= 0) {
      return {
        success: false,
        statusCode: 400,
        error: `الكمية غير صالحة للصنف "${item.name}": يجب أن تكون أكبر من صفر`
      };
    }
    const quantity = Math.round(numQty * 1000) / 1000;
    if (quantity <= 0) {
      return {
        success: false,
        statusCode: 400,
        error: `الكمية غير صالحة للصنف "${item.name}": يجب أن تكون أكبر من صفر`
      };
    }

    validatedInputs.push({ item, quantity });
  }

  const allowNegative = Boolean(memoryStockSettings.allowNegativeWarehouseTransfer);
  if (!allowNegative) {
    const insufficientItems: WarehouseTransferInsufficientItem[] = [];
    for (const entry of validatedInputs) {
      const available = getItemWarehouseStock(entry.item.id, fromWh.id);
      if (entry.quantity > available) {
        insufficientItems.push({
          itemId: entry.item.id,
          itemName: entry.item.name,
          requested: entry.quantity,
          available
        });
      }
    }
    if (insufficientItems.length > 0) {
      const detailsList = insufficientItems
        .map(it => `${it.itemName} (المطلوب: ${it.requested}، المتاح: ${it.available})`)
        .join(' | ');
      return {
        success: false,
        statusCode: 400,
        error: `الكمية المطلوبة تتجاوز الرصيد المتاح في مخزن "${fromWh.name}": ${detailsList}`,
        insufficientItems
      };
    }
  }

  warehouseDispatchSeq += 1;
  while (
    memoryWarehouseTransfers.some(
      t => t.dispatchNumber === `DSP-${String(warehouseDispatchSeq).padStart(4, '0')}`
    )
  ) {
    warehouseDispatchSeq += 1;
  }
  const dispatchNumber = `DSP-${String(warehouseDispatchSeq).padStart(4, '0')}`;
  const now = new Date().toISOString();
  const liveUser = findUserForWarehouseSession(session);
  const actorName = session?.name || liveUser?.name || session?.phone || session?.username || 'المستخدم';
  const actorId = session?.userId || session?.id || liveUser?.id || '';
  const notes = payload?.notes ? String(payload.notes).trim() : '';

  const transferLines: WarehouseTransferLine[] = [];
  let totalQuantity = 0;
  let totalPurchaseValue = 0;

  for (const entry of validatedInputs) {
    const { item, quantity } = entry;
    const fromBefore = getItemWarehouseStock(item.id, fromWh.id);
    const toBefore = getItemWarehouseStock(item.id, toWh.id);

    const fromRes = adjustItemWarehouseDelta(item.id, fromWh.id, -quantity);
    const toRes = adjustItemWarehouseDelta(item.id, toWh.id, quantity);

    const purchasePriceAtTransfer = Math.round(Number(item.purchasePrice || 0) * 100) / 100;
    const lineTotalPurchase = Math.round(purchasePriceAtTransfer * quantity * 100) / 100;

    totalQuantity = Math.round((totalQuantity + quantity) * 1000) / 1000;
    totalPurchaseValue = Math.round((totalPurchaseValue + lineTotalPurchase) * 100) / 100;

    transferLines.push({
      itemId: item.id,
      itemName: item.name,
      barcode: item.barcode || '',
      sku: item.sku || '',
      notes: item.notes || '',
      unit: item.unit || 'قطعة',
      quantity,
      purchasePriceAtTransfer,
      lineTotalPurchase,
      fromStockBefore: fromBefore,
      fromStockAfter: fromRes.balanceInWarehouse,
      toStockBefore: toBefore,
      toStockAfter: toRes.balanceInWarehouse
    });

    const noteSuffix = notes ? ` — ${notes}` : '';

    memoryStockMovements.push({
      id: generateUUID(),
      date: now,
      itemId: item.id,
      itemName: item.name,
      sku: item.sku || '',
      barcode: item.barcode || '',
      movementType: 'تحويل_صادر',
      documentNumber: dispatchNumber,
      quantity,
      quantityBefore: fromBefore,
      quantityAfter: fromRes.balanceInWarehouse,
      balanceAfter: fromRes.balanceInWarehouse,
      unitPrice: purchasePriceAtTransfer,
      totalAmount: lineTotalPurchase,
      party: toWh.name,
      source: 'تحويل بين المخازن',
      reason: 'أمر صرف وتحويل مخزني',
      warehouseId: fromWh.id,
      warehouseName: fromWh.name,
      referenceNumber: dispatchNumber,
      userName: actorName,
      userId: actorId,
      notes: `تحويل صادر من "${fromWh.name}" إلى "${toWh.name}"${noteSuffix}`
    });

    memoryStockMovements.push({
      id: generateUUID(),
      date: now,
      itemId: item.id,
      itemName: item.name,
      sku: item.sku || '',
      barcode: item.barcode || '',
      movementType: 'تحويل_وارد',
      documentNumber: dispatchNumber,
      quantity,
      quantityBefore: toBefore,
      quantityAfter: toRes.balanceInWarehouse,
      balanceAfter: toRes.balanceInWarehouse,
      unitPrice: purchasePriceAtTransfer,
      totalAmount: lineTotalPurchase,
      party: fromWh.name,
      source: 'تحويل بين المخازن',
      reason: 'أمر صرف وتحويل مخزني',
      warehouseId: toWh.id,
      warehouseName: toWh.name,
      referenceNumber: dispatchNumber,
      userName: actorName,
      userId: actorId,
      notes: `تحويل وارد إلى "${toWh.name}" من "${fromWh.name}"${noteSuffix}`
    });
  }

  const order: WarehouseDispatchOrder = {
    id: generateUUID(),
    dispatchNumber,
    date: now,
    fromWarehouseId: fromWh.id,
    fromWarehouseName: fromWh.name,
    toWarehouseId: toWh.id,
    toWarehouseName: toWh.name,
    userId: actorId,
    userName: actorName,
    itemsCount: transferLines.length,
    totalQuantity,
    totalPurchaseValue,
    ...(notes ? { notes } : {}),
    idempotencyKey: idemKey,
    lines: transferLines
  };

  memoryWarehouseTransfers.unshift(order);
  setIdempotencyCachedResult('warehouseTransfer', idemKey, order);

  recordAuditLog(
    {
      id: actorId,
      name: actorName,
      role: session?.role,
      phone: session?.phone
    },
    'WAREHOUSE_TRANSFER',
    'WarehouseDispatchOrder',
    dispatchNumber,
    `إنشاء وتنفيذ أمر صرف رقم ${dispatchNumber} من مخزن "${fromWh.name}" إلى مخزن "${toWh.name}" (${transferLines.length} صنف، إجمالي الكمية: ${totalQuantity})`
  );

  return {
    success: true,
    duplicate: false,
    order: sanitizeWarehouseTransferOrder(order, canViewPurchase)
  };
}

export async function getWarehouseTransfers(
  filters?: {
    dispatchNumber?: string;
    q?: string;
    fromWarehouseId?: string;
    toWarehouseId?: string;
    from?: string | null;
    to?: string | null;
    page?: number;
    pageSize?: number;
  },
  session?: WarehouseTransferSession
): Promise<{
  success: boolean;
  statusCode?: number;
  orders?: WarehouseDispatchOrder[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  error?: string;
}> {
  if (!canSessionViewWarehouseTransfers(session)) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية عرض أوامر الصرف والتحويلات المخزنية'
    };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getWarehouseTransfers', filters, session?.token);
    if (res && res.success) {
      return res;
    }
    return buildSheetsWriteFailure(res, 'تعذر جلب أوامر الصرف من Google Sheets');
  }

  const canViewPurchase = canSessionViewPurchasePriceForTransfer(session);
  const allowed = getAllowedWarehouseIdsForSession(session);

  let list = [...memoryWarehouseTransfers];

  if (allowed !== WAREHOUSE_ALL_TOKEN) {
    list = list.filter(
      o => allowed.includes(o.fromWarehouseId) || allowed.includes(o.toWarehouseId)
    );
  }

  const dispatchQuery = String(filters?.dispatchNumber || filters?.q || '').trim();
  if (dispatchQuery) {
    const normQ = normalizeArabicText(dispatchQuery);
    list = list.filter(o => {
      const hay = normalizeArabicText(
        `${o.dispatchNumber} ${o.fromWarehouseName} ${o.toWarehouseName} ${o.userName} ${o.notes || ''}`
      );
      return hay.includes(normQ);
    });
  }

  const fromWhFilter = String(filters?.fromWarehouseId || '').trim();
  if (fromWhFilter && fromWhFilter !== 'ALL') {
    list = list.filter(o => o.fromWarehouseId === fromWhFilter);
  }

  const toWhFilter = String(filters?.toWarehouseId || '').trim();
  if (toWhFilter && toWhFilter !== 'ALL') {
    list = list.filter(o => o.toWarehouseId === toWhFilter);
  }

  const fromDate = filters?.from ? toCairoDateStr(filters.from) : null;
  const toDate = filters?.to ? toCairoDateStr(filters.to) : null;
  if (fromDate || toDate) {
    list = list.filter(o => isDateInRange(o.date, fromDate, toDate));
  }

  const pageSize = Math.min(100, Math.max(1, Number(filters?.pageSize) || 20));
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(filters?.page) || 1));
  const start = (page - 1) * pageSize;
  const paged = list.slice(start, start + pageSize);

  return {
    success: true,
    orders: paged.map(o => sanitizeWarehouseTransferOrder(o, canViewPurchase)),
    total,
    page,
    pageSize,
    totalPages
  };
}

export async function getWarehouseTransferById(
  idOrNumber: string,
  session?: WarehouseTransferSession
): Promise<{
  success: boolean;
  statusCode?: number;
  order?: WarehouseDispatchOrder;
  error?: string;
}> {
  if (!canSessionViewWarehouseTransfers(session)) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية عرض تفاصيل أمر الصرف'
    };
  }

  const key = String(idOrNumber || '').trim();
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getWarehouseTransferById', { id: key }, session?.token);
    if (res && res.success) {
      return res;
    }
    return buildSheetsWriteFailure(res, 'تعذر جلب تفاصيل أمر الصرف من Google Sheets');
  }

  const found = memoryWarehouseTransfers.find(
    o => o.id === key || o.dispatchNumber.toUpperCase() === key.toUpperCase()
  );
  if (!found) {
    return { success: false, statusCode: 404, error: 'أمر الصرف غير موجود' };
  }

  const allowed = getAllowedWarehouseIdsForSession(session);
  if (
    allowed !== WAREHOUSE_ALL_TOKEN &&
    !allowed.includes(found.fromWarehouseId) &&
    !allowed.includes(found.toWarehouseId)
  ) {
    return { success: false, statusCode: 403, error: 'غير مصرح لك بعرض أمر الصرف هذا' };
  }

  const canViewPurchase = canSessionViewPurchasePriceForTransfer(session);
  return {
    success: true,
    order: sanitizeWarehouseTransferOrder(found, canViewPurchase)
  };
}

/**
 * حساب رصيد الطرف (عميل أو منصة) من مجموع حركات السجل (مدين - دائن) وليس كرقم مخزن ثابت
 * الموجب = مدين على الطرف، السالب = رصيد دائن للطرف
 */
export function computePartyBalance(partyType: 'customer' | 'platform', partyId: string): number {
  if (partyType === 'customer') {
    const cust = memoryCustomers.find(c => c.id === partyId);
    const entries = memoryCustomerLedger.filter(l => l.customerId === partyId);
    const hasOpeningEntry = entries.some(l => l.transactionType === 'رصيد افتتاحي');
    const baseOpening = hasOpeningEntry ? 0 : (Number(cust?.openingBalance) || 0);
    const total = entries.reduce((sum, l) => sum + (Number(l.debit) || 0) - (Number(l.credit) || 0), baseOpening);
    const rounded = Math.round(total * 100) / 100;
    if (cust) cust.currentBalance = rounded;
    return rounded;
  } else {
    const plt = memoryPlatforms.find(p => p.id === partyId);
    const entries = memoryPartyLedger.filter(l => l.partyType === 'platform' && l.partyId === partyId);
    const total = entries.reduce((sum, l) => sum + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
    const rounded = Math.round(total * 100) / 100;
    if (plt) plt.currentBalance = rounded;
    return rounded;
  }
}

// ذاكرة التتبع لمنع تكرار العمليات المالية (Idempotency cache - 5 minutes speed layer)
const idempotencyCache = new Map<string, { timestamp: number; result: any }>();
const memoryCreditCollectionByKey = new Map<string, CollectCreditResult>();
const IDEMPOTENCY_MISSING_ERROR = 'مفتاح منع التكرار (idempotencyKey) مطلوب لإتمام العملية المالية';

function getValidatedIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getIdempotencyCachedResult(op: string, key: string): any | null {
  const cached = idempotencyCache.get(`${op}:${key}`);
  if (cached && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
    return cached.result;
  }
  return null;
}

function setIdempotencyCachedResult(op: string, key: string, result: any): void {
  idempotencyCache.set(`${op}:${key}`, { timestamp: Date.now(), result });
}

let userSuspendedHandler: ((userId: string) => void) | null = null;
export function setOnUserSuspended(handler: (userId: string) => void) {
  userSuspendedHandler = handler;
}

export function getStoredUserById(id: string): StoredUser | undefined {
  return memoryUsers.find(u => u.id === id);
}

/**
 * تسجيل حدث في سجل التدقيق المحلي
 */
const AUDIT_LOG_MAX_ENTRIES = 5000;

export function recordAuditLog(
  actor: { id?: string; name?: string; role?: string; phone?: string },
  action: string,
  targetType: string,
  targetId: string,
  details: string
) {
  const entry: AuditLogEntry = {
    id: generateUUID(),
    timestamp: new Date().toISOString(),
    actorId: actor.id || 'system',
    actorName: actor.name || actor.phone || 'النظام',
    actorRole: actor.role || 'system',
    action,
    targetType,
    targetId,
    details
  };
  memoryAuditLogs.unshift(entry);
  if (memoryAuditLogs.length > AUDIT_LOG_MAX_ENTRIES) {
    memoryAuditLogs = memoryAuditLogs.slice(0, AUDIT_LOG_MAX_ENTRIES);
  }
}

/**
 * دالة استدعاء Google Apps Script مع تمرير Session Token حصريًا ودون أي اعتماد على requesterRole
 */
async function callAppsScript(
  action: string,
  payload?: unknown,
  sessionToken?: string,
  customUrl?: string,
  timeoutMs: number = 20000
): Promise<{ success: boolean; data?: any; error?: string; message?: string; code?: string; isTimeout?: boolean; isTransportError?: boolean; hasOwner?: boolean; hasManager?: boolean; details?: string[]; expired?: boolean; token?: string; user?: any; invoice?: any; returnRecord?: any; item?: any; platform?: any; url?: string; userId?: string; category?: any; report?: any; movement?: any; [key: string]: any }> {
  const config = getSystemConfig();
  const scriptUrl = customUrl || config.appsScriptUrl;

  if (!scriptUrl || !isValidAppsScriptUrl(scriptUrl)) {
    const invalidErr = 'لم يتم ضبط رابط Google Apps Script أو أن الرابط غير صالح.';
    if (customUrl !== undefined || config.dataMode === 'sheets') {
      setConnectionStatus(false, invalidErr);
    }
    return {
      success: false,
      code: 'SHEETS_UNAVAILABLE',
      isTransportError: true,
      error: invalidErr
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        action,
        payload: payload ?? {},
        token: sessionToken || ''
      }),
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const statusErr = 'تعذر الاتصال بخدمة Google Apps Script';
      setConnectionStatus(false, statusErr);
      console.warn(`[AppsScript Notice - Action: ${action}]: استجابة غير متوقعة من Google Apps Script (رمز ${response.status})`);
      return {
        success: false,
        code: 'SHEETS_UNAVAILABLE',
        isTransportError: true,
        error: statusErr
      };
    }

    const data = await response.json();
    if (!data || typeof data !== 'object') {
      const badBodyErr = 'استجابة غير صالحة من Google Apps Script';
      setConnectionStatus(false, badBodyErr);
      return {
        success: false,
        code: 'SHEETS_UNAVAILABLE',
        isTransportError: true,
        error: badBodyErr
      };
    }

    setConnectionStatus(true);
    return data;
  } catch (error: any) {
    const errName = String(error?.name || '');
    const errMsg = String(error?.message || '');
    const isTimeout =
      errName === 'AbortError' ||
      errName === 'TimeoutError' ||
      errMsg.toLowerCase().includes('abort') ||
      errMsg.toLowerCase().includes('timeout') ||
      errMsg.toLowerCase().includes('timed out');

    if (isTimeout) {
      const timeoutErrorMsg = 'لم نتأكد من حفظ العملية. أعد المحاولة';
      setConnectionStatus(false, timeoutErrorMsg);
      console.warn(`[AppsScript Timeout - Action: ${action}]:`, error?.stack || errMsg || 'AbortError');
      return {
        success: false,
        code: 'UNKNOWN_RESULT',
        isTimeout: true,
        isTransportError: true,
        error: timeoutErrorMsg
      };
    }

    const safeNetErrorMsg = 'تعذر الاتصال بـ Google Apps Script';
    setConnectionStatus(false, safeNetErrorMsg);
    console.warn(`[AppsScript Notice - Action: ${action}]:`, error?.stack || errMsg || safeNetErrorMsg);
    return {
      success: false,
      code: 'SHEETS_UNAVAILABLE',
      isTransportError: true,
      error: safeNetErrorMsg
    };
  }
}

function isSheetsDataMode(config = getSystemConfig()): boolean {
  return config.dataMode === 'sheets';
}

function buildSheetsWriteFailure(
  res: any,
  fallbackError: string
): { success: false; error: string; code?: 'SHEETS_UNAVAILABLE' | 'UNKNOWN_RESULT' } {
  if (res?.isTimeout || res?.code === 'UNKNOWN_RESULT') {
    return {
      success: false,
      code: 'UNKNOWN_RESULT',
      error: 'لم نتأكد من حفظ العملية. أعد المحاولة'
    };
  }
  if (res?.isTransportError || res?.code === 'SHEETS_UNAVAILABLE' || !res?.error) {
    return {
      success: false,
      code: 'SHEETS_UNAVAILABLE',
      error: (res && typeof res.error === 'string' && res.error.trim()) ? res.error : fallbackError
    };
  }
  return {
    success: false,
    error: res.error,
    ...(res.code ? { code: res.code } : {})
  };
}

export class SheetsUnavailableError extends Error {
  code: 'SHEETS_UNAVAILABLE' | 'UNKNOWN_RESULT';
  statusCode: number;
  constructor(
    message: string,
    code: 'SHEETS_UNAVAILABLE' | 'UNKNOWN_RESULT' = 'SHEETS_UNAVAILABLE'
  ) {
    super(message);
    this.name = 'SheetsUnavailableError';
    this.code = code;
    this.statusCode = code === 'UNKNOWN_RESULT' ? 504 : 503;
  }
}

const sheetsReadCache = new Map<string, { data: any; lastSyncAt: string }>();

function setSheetsCache(key: string, data: any) {
  try {
    const cloned = data === undefined ? undefined : JSON.parse(JSON.stringify(data));
    sheetsReadCache.set(key, {
      data: cloned,
      lastSyncAt: new Date().toISOString()
    });
  } catch {
    sheetsReadCache.set(key, {
      data,
      lastSyncAt: new Date().toISOString()
    });
  }
}

function getSheetsCache<T = any>(key: string): { data: T; lastSyncAt: string } | null {
  const entry = sheetsReadCache.get(key);
  if (!entry) return null;
  try {
    return {
      data: entry.data === undefined ? undefined : JSON.parse(JSON.stringify(entry.data)),
      lastSyncAt: entry.lastSyncAt
    };
  } catch {
    return {
      data: entry.data,
      lastSyncAt: entry.lastSyncAt
    };
  }
}

export function clearSheetsReadCacheForTest() {
  sheetsReadCache.clear();
}

export function markArrayStale<T>(arr: T[], lastSyncAt: string): T[] {
  const copy = Array.isArray(arr) ? [...arr] : [];
  Object.defineProperty(copy, '__stale', { value: true, enumerable: false, configurable: true });
  Object.defineProperty(copy, '__lastSyncAt', { value: lastSyncAt, enumerable: false, configurable: true });
  return copy;
}

export function getStaleMeta(value: any): { stale: boolean; lastSyncAt?: string } {
  if (value && value.__stale) {
    return { stale: true, lastSyncAt: value.__lastSyncAt };
  }
  if (value && typeof value === 'object' && value.stale) {
    return { stale: true, lastSyncAt: value.lastSyncAt };
  }
  return { stale: false };
}

function buildSheetsReadFailureError(res: any, fallbackError: string): SheetsUnavailableError {
  const failure = buildSheetsWriteFailure(res, fallbackError);
  return new SheetsUnavailableError(
    failure.error,
    failure.code === 'UNKNOWN_RESULT' ? 'UNKNOWN_RESULT' : 'SHEETS_UNAVAILABLE'
  );
}

/**
 * تهيئة الحسابات الثلاثة الافتراضية (admin, manager, cashier) فقط إذا كان النظام فارغاً تماماً من المستخدمين.
 * إذا وُجد أي مستخدم في النظام فلا يُنشأ ولا يُعدَّل أي حساب.
 */
export function ensureDefaultUsersIfEmpty(): { created: boolean; count: number } {
  if (memoryUsers.length === 0) {
    memoryUsers = buildDefaultInitialUsers(INITIAL_USER_PASSWORD);
    return { created: true, count: memoryUsers.length };
  }
  return { created: false, count: memoryUsers.length };
}

/**
 * دوال مساعدة للاختبارات الآلية فقط لإعادة ضبط أو معاينة المستخدمين في الذاكرة
 */
export function resetMemoryUsersForTest(customUsers?: StoredUser[]) {
  if (customUsers !== undefined) {
    memoryUsers = customUsers.map(u => ({ ...u }));
  } else {
    memoryUsers = [];
  }
}

export function getRawMemoryUsersForTest(): StoredUser[] {
  return memoryUsers.map(u => ({ ...u }));
}

/**
 * فحص هل يوجد مالك/مصمم مسجل بالنظام
 */
export async function checkHasOwner(): Promise<boolean> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('checkSetup');
    if (res.success && typeof res.hasOwner === 'boolean') {
      return res.hasOwner;
    }
    throw buildSheetsReadFailureError(res, 'تعذر التحقق من إعداد المالك في Google Sheets');
  }
  ensureDefaultUsersIfEmpty();
  return memoryUsers.some(u => u.role === 'designer' || Boolean(u.isOwner));
}

/**
 * فحص هل يوجد أي مدير أو مالك مسجل بالنظام
 */
export async function checkHasManager(): Promise<boolean> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('checkSetup');
    if (res.success && typeof res.hasManager === 'boolean') {
      return res.hasManager;
    }
    throw buildSheetsReadFailureError(res, 'تعذر التحقق من إعداد المدير في Google Sheets');
  }
  ensureDefaultUsersIfEmpty();
  return memoryUsers.some(u => u.role === 'manager' || u.role === 'designer' || (u.role as any) === 'مدير');
}

/**
 * فحص الاتصال بالسكربت المباشر (Ping نظيف فقط)
 */
export async function testConnection(customUrl?: string) {
  const result = await callAppsScript('ping', undefined, undefined, customUrl);
  if (result.success) {
    setConnectionStatus(true);
  } else if (!result.isTransportError) {
    setConnectionStatus(false, result.error);
  }
  return result;
}

/**
 * تهيئة الأوراق setupSheets
 */
export async function setupSheets(sessionToken?: string, customUrl?: string) {
  if (memoryInvoicePrintSettings.headerText === 'فاتورة مبيعات مدققة وموثقة على المنصة') {
    memoryInvoicePrintSettings.headerText = '';
  }
  ensureDefaultUsersIfEmpty();
  const result = await callAppsScript('setupSheets', {}, sessionToken, customUrl);
  if (result.success) {
    setConnectionStatus(true);
  }
  return result;
}

/**
 * إنشاء أول مالك ومصمم للنظام في وضع الذاكرة المحلية (إذا لم يكن هناك أي مالك سابق)
 */
// إدارة محاولات الدخول الفاشلة والحماية من التخمين Brute-force protection
// بعد 5 محاولات فاشلة يتم قفل الحساب لمدة 15 دقيقة
interface FailedAttemptRecord {
  count: number;
  lockedUntil?: number;
}
const failedAttemptsMap = new Map<string, FailedAttemptRecord>();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 دقيقة

function checkRateLimit(normUser: string): { locked: boolean; remainingMinutes?: number } {
  const record = failedAttemptsMap.get(normUser);
  if (!record) return { locked: false };

  if (record.lockedUntil) {
    if (Date.now() < record.lockedUntil) {
      const remainingMinutes = Math.ceil((record.lockedUntil - Date.now()) / (60 * 1000));
      return { locked: true, remainingMinutes };
    }
    // انتهاء فترة القفل
    failedAttemptsMap.delete(normUser);
    return { locked: false };
  }

  return { locked: false };
}

function recordFailedAttempt(normUser: string): { lockedNow: boolean; remainingMinutes?: number } {
  const record = failedAttemptsMap.get(normUser) || { count: 0 };
  record.count += 1;

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    failedAttemptsMap.set(normUser, record);
    return { lockedNow: true, remainingMinutes: 15 };
  }

  failedAttemptsMap.set(normUser, record);
  return { lockedNow: false };
}

function clearFailedAttempts(normUser: string) {
  failedAttemptsMap.delete(normUser);
}

/**
 * إنشاء أول مالك ومصمم للنظام في وضع الذاكرة المحلية (إذا لم يكن هناك أي مالك سابق)
 */
export async function setupFirstDesignerLocal(
  username: string,
  name: string,
  password: string,
  phone?: string
) {
  if (isSheetsDataMode()) {
    return {
      success: false,
      code: 'SHEETS_UNAVAILABLE' as const,
      error: 'لا يمكن إنشاء حساب مالك محلي في وضع Google Sheets. يجب إتمام التهيئة عبر Google Apps Script.'
    };
  }

  const normUser = normalizeUsername(username);
  if (!isValidUsernameFormat(normUser)) {
    return {
      success: false,
      error: 'اسم المستخدم غير صالح. يقبل حروفاً عربية أو إنجليزية أو أرقاماً بين 2 و 40 خانة.'
    };
  }

  // فحص قواعد كلمة المرور الصارمة لمالك النظام (8 خانات + كبير وصغير ورقم ورمز)
  const pwdCheck = validatePasswordRules(password, 'designer');
  if (!pwdCheck.valid) {
    return { success: false, error: pwdCheck.error };
  }

  const hasOwner = await checkHasOwner();
  if (hasOwner) {
    return { success: false, error: 'يوجد مالك/مصمم مسجل بالفعل للنظام، ولا يمكن تكرار إجراء التهيئة الأولية.' };
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);
  const offlineVer = computeOfflinePasswordVerifier(password);
  const nowIso = new Date().toISOString();
  const newUser: StoredUser = {
    id: generateUUID(),
    username: username.trim(),
    normalizedUsername: normUser,
    phone: phone ? String(phone).trim() : undefined,
    name: name.trim() || 'مصمم ومالك النظام',
    role: 'designer',
    status: 'active',
    createdAt: nowIso,
    salt,
    passwordHash,
    permissions: ALL_PERMISSIONS.map(p => p.key),
    isOwner: true,
    offlineVerifier: offlineVer.offlineVerifier,
    offlineSalt: offlineVer.offlineSalt,
    offlineIterations: offlineVer.offlineIterations,
    permissionsUpdatedAt: nowIso,
    permissionsUpdatedByDevice: 'ONLINE'
  };

  memoryUsers.push(newUser);
  recordAuditLog(
    { id: newUser.id, name: newUser.name, role: 'designer', phone: newUser.phone },
    'BOOTSTRAP_OWNER',
    'User',
    newUser.id,
    `تم إنشاء أول مصمم للنظام كمالك وحيد في الذاكرة باسم مستخدم: ${newUser.username}`
  );

  return {
    success: true,
    userId: newUser.id,
    message: 'تم إنشاء أول حساب مصمم ومالك للنظام بنجاح'
  };
}

/**
 * تسجيل الدخول باسم المستخدم وكلمة المرور
 */
export async function loginUser(
  usernameOrPhone: string,
  password: string
): Promise<{ success: boolean; user?: UserAccount; token?: string; error?: string; code?: 'SHEETS_UNAVAILABLE' | 'UNKNOWN_RESULT' }> {
  const inputStr = String(usernameOrPhone || '').trim();
  const normUser = normalizeUsername(inputStr);

  if (!normUser || !password) {
    return { success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' };
  }

  // فحص الحماية من التخمين
  const rateLimit = checkRateLimit(normUser);
  if (rateLimit.locked) {
    return {
      success: false,
      error: `تم قفل الحساب مؤقتًا لتكرار المحاولات الخاطئة (5 محاولات). يرجى المحاولة بعد ${rateLimit.remainingMinutes} دقيقة.`
    };
  }

  const config = getSystemConfig();

  if (isSheetsDataMode(config)) {
    const offlineVer = computeOfflinePasswordVerifier(password);
    const res = await callAppsScript('login', {
      username: normUser,
      password,
      offlineVerifier: offlineVer.offlineVerifier,
      offlineSalt: offlineVer.offlineSalt,
      offlineIterations: offlineVer.offlineIterations
    });
    if (res.success && res.user) {
      clearFailedAttempts(normUser);
      return {
        success: true,
        user: {
          ...res.user,
          mustChangePassword: Boolean(res.user.mustChangePassword),
          offlineVerifier: res.user.offlineVerifier || offlineVer.offlineVerifier,
          offlineSalt: res.user.offlineSalt || offlineVer.offlineSalt,
          offlineIterations: res.user.offlineIterations || offlineVer.offlineIterations
        },
        token: res.token
      };
    }
    if (res.isTimeout || res.code === 'UNKNOWN_RESULT') {
      return {
        success: false,
        code: 'UNKNOWN_RESULT',
        error: res.error || 'لم نتأكد من حفظ العملية. أعد المحاولة'
      };
    }
    if (res.isTransportError || res.code === 'SHEETS_UNAVAILABLE' || !res.error) {
      return {
        success: false,
        code: 'SHEETS_UNAVAILABLE',
        error: res.error || 'تعذر الاتصال بقاعدة البيانات للتحقق من بيانات الدخول'
      };
    }
    recordFailedAttempt(normUser);
    return { success: false, error: res.error };
  }

  // ضمان وجود الحسابات الثلاثة الافتراضية إذا كان النظام فارغاً تماماً
  ensureDefaultUsersIfEmpty();

  // وضع الذاكرة المؤقت: مطابقة اسم المستخدم المطبع، أو الهاتف كبديل
  const user = memoryUsers.find(u =>
    (u.normalizedUsername && u.normalizedUsername === normUser) ||
    normalizeUsername(u.username) === normUser ||
    (u.phone && u.phone.trim() === inputStr)
  );

  if (!user) {
    recordFailedAttempt(normUser);
    return { success: false, error: 'اسم المستخدم غير مسجل في النظام' };
  }

  if (user.status !== 'active' && (user.status as any) !== 'نشط') {
    return { success: false, error: 'هذا الحساب موقوف، راجع مالك النظام' };
  }

  const computedHash = hashPassword(password, user.salt);
  if (computedHash !== user.passwordHash) {
    const failRes = recordFailedAttempt(normUser);
    if (failRes.lockedNow) {
      return {
        success: false,
        error: 'تم تجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات). تم إيقاف الحساب مؤقتًا لمدة 15 دقيقة.'
      };
    }
    const currentRecord = failedAttemptsMap.get(normUser);
    const triesLeft = MAX_FAILED_ATTEMPTS - (currentRecord?.count || 1);
    return {
      success: false,
      error: `كلمة المرور غير صحيحة. متبقي ${triesLeft} محاولة قبل قفل الحساب مؤقتًا.`
    };
  }

  // تسجيل دخول ناجح - تصفير عداد المحاولات الفاشلة وحساب بصمة التحقق بدون إنترنت PBKDF2-SHA256 (200,000 دورة)
  clearFailedAttempts(normUser);

  const offlineVer = computeOfflinePasswordVerifier(password);
  user.offlineVerifier = offlineVer.offlineVerifier;
  user.offlineSalt = offlineVer.offlineSalt;
  user.offlineIterations = offlineVer.offlineIterations;

  const permissions = user.permissions || (ROLE_TEMPLATES[user.role] || ROLE_TEMPLATES.employee);

  recordAuditLog(
    { id: user.id, name: user.name, role: user.role, phone: user.phone },
    'USER_LOGIN',
    'Session',
    user.id,
    `تسجيل دخول ناجح باسم المستخدم: ${user.username}`
  );

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      phone: user.phone,
      name: user.name,
      role: user.role,
      status: user.status,
      permissions: user.role === 'designer' ? ALL_PERMISSIONS.map(p => p.key) : permissions,
      isOwner: user.role === 'designer' || Boolean(user.isOwner),
      mustChangePassword: Boolean(user.mustChangePassword),
      createdAt: user.createdAt,
      cashboxConfig: user.cashboxConfig,
      warehouseConfig: user.warehouseConfig,
      offlineVerifier: user.offlineVerifier,
      offlineSalt: user.offlineSalt,
      offlineIterations: user.offlineIterations,
      permissionsUpdatedAt: user.permissionsUpdatedAt || user.createdAt,
      permissionsUpdatedByDevice: user.permissionsUpdatedByDevice
    }
  };
}

/**
 * تسجيل الخروج وإلغاء رمز الجلسة فعليًا في Google Apps Script عند العمل في وضع sheets
 */
export async function logoutUserSession(sessionToken?: string): Promise<{ success: boolean; message: string }> {
  const cleanToken = String(sessionToken || '').replace(/^Bearer\s+/i, '').trim();
  if (!cleanToken) {
    return { success: true, message: 'تم إنهاء الجلسة بنجاح' };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    await callAppsScript('logout', {}, cleanToken);
  }

  return { success: true, message: 'تم إنهاء الجلسة بنجاح' };
}

/**
 * مزامنة جميع البيانات مع فلترة الصلاحيات
 */
export async function syncAllData(session?: { token?: string; role: UserRole; permissions: PermissionKey[]; userId?: string; id?: string; phone?: string; username?: string; isOwner?: boolean }) {
  const config = getSystemConfig();
  const canViewPurchase = session?.role === 'designer' || session?.permissions?.includes('prices.view_purchase');
  const canViewPackaging = session?.role === 'designer' || session?.permissions?.includes('prices.view_packaging');
  const canViewProfit = session?.role === 'designer' || session?.permissions?.includes('reports.view_profit');
  const permBucket = `${Boolean(canViewPurchase)}:${Boolean(canViewPackaging)}:${Boolean(canViewProfit)}`;
  const syncCacheKey = `syncAll:${permBucket}`;

  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('syncAll', undefined, session?.token);
    if (res.success && res.data) {
      setConnectionStatus(true);
      if (Array.isArray(res.data.categories)) {
        memoryCategories = res.data.categories;
        setSheetsCache('categories', res.data.categories);
      }
      if (res.data.settings?.companySettings) {
        memoryCompanySettings = { ...defaultCompanySettings, ...memoryCompanySettings, ...res.data.settings.companySettings };
      }
      if (res.data.settings?.displaySettings) {
        memoryDisplaySettings = {
          ...defaultDisplaySettings,
          ...memoryDisplaySettings,
          ...res.data.settings.displaySettings,
          autoFillCashPaid: res.data.settings.displaySettings.autoFillCashPaid ?? memoryDisplaySettings.autoFillCashPaid ?? true,
          latestItemFirst: normalizeLatestItemFirst(
            res.data.settings.displaySettings.latestItemFirst,
            memoryDisplaySettings.latestItemFirst
          ),
          posShowCustomerAddress:
            res.data.settings.displaySettings.posShowCustomerAddress ??
            memoryDisplaySettings.posShowCustomerAddress ??
            true,
          posShowCustomerPhone:
            res.data.settings.displaySettings.posShowCustomerPhone ??
            memoryDisplaySettings.posShowCustomerPhone ??
            true,
          posShowCustomerBalance:
            res.data.settings.displaySettings.posShowCustomerBalance ??
            memoryDisplaySettings.posShowCustomerBalance ??
            true
        };
      }
      if (res.data.settings?.stockSettings) {
        memoryStockSettings = { ...memoryStockSettings, ...res.data.settings.stockSettings };
      }
      if (res.data.settings?.taxSettings) {
        setTaxSettings(res.data.settings.taxSettings);
      }
      if (res.data.settings?.invoicePrintSettings) {
        if (res.data.settings.invoicePrintSettings.headerText === 'فاتورة مبيعات مدققة وموثقة على المنصة') {
          res.data.settings.invoicePrintSettings.headerText = '';
        }
        const resolvedAutoFill =
          res.data.settings.invoicePrintSettings.autoFillCashPaid ??
          res.data.settings.displaySettings?.autoFillCashPaid ??
          memoryInvoicePrintSettings.autoFillCashPaid ??
          true;
        memoryInvoicePrintSettings = {
          ...defaultInvoicePrintSettings,
          ...memoryInvoicePrintSettings,
          ...res.data.settings.invoicePrintSettings,
          autoFillCashPaid: resolvedAutoFill,
          headerText: res.data.settings.invoicePrintSettings.headerText ?? '',
          footerText: res.data.settings.invoicePrintSettings.footerText ?? '',
          termsAndConditions: res.data.settings.invoicePrintSettings.termsAndConditions ?? '',
          showReceiptPreview: res.data.settings.invoicePrintSettings.showReceiptPreview ?? memoryInvoicePrintSettings.showReceiptPreview ?? false,
          printableWidthMm: res.data.settings.invoicePrintSettings.printableWidthMm ?? memoryInvoicePrintSettings.printableWidthMm ?? 72,
          showInvoiceNumber: res.data.settings.invoicePrintSettings.showInvoiceNumber ?? memoryInvoicePrintSettings.showInvoiceNumber ?? true,
          showDateTime: res.data.settings.invoicePrintSettings.showDateTime ?? memoryInvoicePrintSettings.showDateTime ?? true,
          showInvoiceStatus: res.data.settings.invoicePrintSettings.showInvoiceStatus ?? memoryInvoicePrintSettings.showInvoiceStatus ?? true
        };
        memoryDisplaySettings.autoFillCashPaid = resolvedAutoFill;
      }

      setSheetsCache(syncCacheKey, res.data);
      if (Array.isArray(res.data.items)) {
        setSheetsCache(`items:${Boolean(canViewPurchase)}:${Boolean(canViewPackaging)}`, res.data.items);
      }
      if (Array.isArray(res.data.platforms)) setSheetsCache('platforms', res.data.platforms);
      if (Array.isArray(res.data.costs)) setSheetsCache('costs', res.data.costs);
      if (Array.isArray(res.data.invoices)) {
        setSheetsCache(`invoices:all:${permBucket}`, res.data.invoices);
      }
      if (Array.isArray(res.data.returns)) setSheetsCache('returns:all', res.data.returns);
      if (Array.isArray(res.data.suppliers)) setSheetsCache('suppliers', res.data.suppliers);
      if (Array.isArray(res.data.supplierGroups)) setSheetsCache('supplierGroups', res.data.supplierGroups);
      if (Array.isArray(res.data.purchases)) setSheetsCache('purchases:all', res.data.purchases);
      if (Array.isArray(res.data.customers)) setSheetsCache('customers', res.data.customers);
      if (Array.isArray(res.data.customerGroups)) setSheetsCache('customerGroups', res.data.customerGroups);
      if (Array.isArray(res.data.cashboxes)) setSheetsCache('cashboxes', res.data.cashboxes);
      if (Array.isArray(res.data.cashboxAssignments)) setSheetsCache('cashboxAssignments', res.data.cashboxAssignments);
      if (Array.isArray(res.data.warehouses)) setSheetsCache('warehouses', res.data.warehouses);
      if (Array.isArray(res.data.warehouseStocks)) setSheetsCache('warehouseStocks', res.data.warehouseStocks);

      const syncEntry = getSheetsCache(syncCacheKey);
      return {
        success: true,
        source: 'google_sheets',
        stale: false,
        lastSyncAt: syncEntry?.lastSyncAt || new Date().toISOString(),
        hasOwner: res.hasOwner ?? true,
        hasManager: res.hasManager ?? true,
        data: res.data
      };
    }

    const cachedSync = getSheetsCache(syncCacheKey);
    if (cachedSync) {
      return {
        success: true,
        source: 'google_sheets_cache',
        stale: true,
        lastSyncAt: cachedSync.lastSyncAt,
        hasOwner: true,
        hasManager: true,
        data: cachedSync.data
      };
    }

    return buildSheetsWriteFailure(res, 'تعذر جلب البيانات من Google Sheets');
  }

  // وضع الذاكرة المحلية: ترحيل أي نص قديم وضمان القيم الافتراضية المدمجة
  if (memoryInvoicePrintSettings.headerText === 'فاتورة مبيعات مدققة وموثقة على المنصة') {
    memoryInvoicePrintSettings.headerText = '';
  }
  const mergedAutoFill = memoryDisplaySettings.autoFillCashPaid ?? memoryInvoicePrintSettings.autoFillCashPaid ?? true;
  memoryCompanySettings = { ...defaultCompanySettings, ...memoryCompanySettings };
  memoryInvoicePrintSettings = { ...defaultInvoicePrintSettings, ...memoryInvoicePrintSettings, autoFillCashPaid: mergedAutoFill };
  memoryDisplaySettings = {
    ...defaultDisplaySettings,
    ...memoryDisplaySettings,
    autoFillCashPaid: mergedAutoFill,
    latestItemFirst: normalizeLatestItemFirst(memoryDisplaySettings.latestItemFirst),
    posShowCustomerAddress: memoryDisplaySettings.posShowCustomerAddress ?? true,
    posShowCustomerPhone: memoryDisplaySettings.posShowCustomerPhone ?? true,
    posShowCustomerBalance: memoryDisplaySettings.posShowCustomerBalance ?? true
  };

  const activeWarehousesForSync = memoryWarehouses.filter(w => isWarehouseActive(w));
  const filteredItems = memoryItems.map(it => {
    const copy: any = { ...it };
    copy.warehouseStocks = activeWarehousesForSync.map(w => ({
      warehouseId: w.id,
      warehouseName: w.name,
      quantity: getItemWarehouseStock(it.id, w.id),
      reorderLimit: getItemWarehouseReorderLimit(it.id, w.id)
    }));
    if (!canViewPurchase) delete copy.purchasePrice;
    if (!canViewPackaging) delete copy.packagingCost;
    return copy;
  });

  const filteredInvoices = memoryInvoices.map(inv => {
    const copy: any = { ...inv };
    if (!canViewProfit) delete copy.profit;
    copy.lines = (inv.lines || []).map(l => {
      const lineCopy: any = { ...l };
      if (!canViewPurchase) delete lineCopy.purchasePriceAtSale;
      if (!canViewPackaging) delete lineCopy.packagingCostAtSale;
      if (!canViewProfit) delete lineCopy.unitProfit;
      return lineCopy;
    });
    return copy;
  });

  return {
    success: true,
    source: 'memory',
    hasOwner: memoryUsers.some(u => u.role === 'designer' || u.isOwner),
    hasManager: memoryUsers.length > 0,
    data: {
      settings: {
        companySettings: memoryCompanySettings,
        invoicePrintSettings: memoryInvoicePrintSettings,
        displaySettings: memoryDisplaySettings,
        stockSettings: memoryStockSettings,
        salesRules: describeSalesRules({ platforms: memoryPlatforms, customers: memoryCustomers }),
        taxSettings: config.taxSettings,
        storeName: memoryCompanySettings.storeName,
        currency: 'EGP'
      },
      items: filteredItems,
      categories: memoryCategories,
      barcodes: memoryItemBarcodes,
      platforms: memoryPlatforms,
      costs: memoryCosts,
      invoices: filteredInvoices,
      returns: memoryReturns,
      suppliers: memorySuppliers,
      supplierGroups: memorySupplierGroups,
      purchases: memoryPurchases,
      customers: memoryCustomers,
      customerGroups: memoryCustomerGroups,
      cashboxes: memoryCashboxes,
      cashboxAssignments: memoryUserCashboxAssignments,
      cashboxTransactions: memoryCashboxTransactions,
      cashboxTransfers: memoryCashboxTransfers,
      warehouses: memoryWarehouses,
      warehouseStocks: memoryWarehouseStocks,
      users: (ensureDefaultUsersIfEmpty(), memoryUsers.map(u => ({
        id: u.id,
        username: u.username,
        phone: u.phone,
        name: u.name,
        role: u.role,
        status: u.status,
        permissions: u.role === 'designer' ? ALL_PERMISSIONS.map(p => p.key) : (u.permissions || ROLE_TEMPLATES[u.role] || []),
        isOwner: u.role === 'designer' || Boolean(u.isOwner),
        mustChangePassword: Boolean(u.mustChangePassword),
        createdAt: u.createdAt,
        cashboxConfig: u.cashboxConfig,
        warehouseConfig: u.warehouseConfig,
        offlineVerifier: u.offlineVerifier,
        offlineSalt: u.offlineSalt,
        offlineIterations: u.offlineIterations,
        permissionsUpdatedAt: u.permissionsUpdatedAt || u.createdAt,
        permissionsUpdatedByDevice: u.permissionsUpdatedByDevice
      })))
    }
  };
}

/**
 * جلب الأصناف مع حجب أسعار الشراء والتغليف
 */
export async function getItems(session?: { token?: string; role: UserRole; permissions: PermissionKey[] }): Promise<Item[]> {
  const config = getSystemConfig();
  const canViewPurchase = session?.role === 'designer' || session?.permissions?.includes('prices.view_purchase');
  const canViewPackaging = session?.role === 'designer' || session?.permissions?.includes('prices.view_packaging');
  const cacheKey = `items:${Boolean(canViewPurchase)}:${Boolean(canViewPackaging)}`;

  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getItems', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      const cachedCats = getSheetsCache<ProductCategory[]>('categories')?.data || [];
      const catMap = new Map(cachedCats.map(c => [c.id, c.name]));
      const mapped = res.data.map((it: any) => ({
        ...it,
        categoryName: it.categoryName || (it.categoryId ? catMap.get(it.categoryId) : '') || ''
      }));
      setSheetsCache(cacheKey, mapped);
      return mapped;
    }
    const cached = getSheetsCache<Item[]>(cacheKey);
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب الأصناف من Google Sheets');
  }

  const catMap = new Map(memoryCategories.map(c => [c.id, c.name]));
  const activeWarehousesList = memoryWarehouses.filter(w => isWarehouseActive(w));

  return memoryItems.map(it => {
    const copy: any = { ...it };
    copy.categoryName = catMap.get(copy.categoryId || '') || '';
    copy.updatedAt = copy.updatedAt || copy.createdAt || '';
    copy.warehouseStocks = activeWarehousesList.map(w => ({
      warehouseId: w.id,
      warehouseName: w.name,
      quantity: getItemWarehouseStock(it.id, w.id),
      reorderLimit: getItemWarehouseReorderLimit(it.id, w.id)
    }));
    if (!canViewPurchase) delete copy.purchasePrice;
    if (!canViewPackaging) delete copy.packagingCost;
    return copy;
  });
}

export type AllowedItemSortColumn =
  | 'name'
  | 'printName'
  | 'barcode'
  | 'notes'
  | 'stockQuantity'
  | 'unit'
  | 'salePrice'
  | 'purchasePrice'
  | 'categoryName'
  | 'supplier'
  | 'purchaseDate'
  | 'expiryDate';

const ALLOWED_ITEM_SORT_COLUMNS = new Set<AllowedItemSortColumn>([
  'name',
  'printName',
  'barcode',
  'notes',
  'stockQuantity',
  'unit',
  'salePrice',
  'purchasePrice',
  'categoryName',
  'supplier',
  'purchaseDate',
  'expiryDate'
]);

const ITEM_SORT_COLUMN_ALIASES: Record<string, AllowedItemSortColumn> = {
  name: 'name',
  printName: 'printName',
  barcode: 'barcode',
  notes: 'notes',
  description: 'notes',
  stockQuantity: 'stockQuantity',
  quantity: 'stockQuantity',
  unit: 'unit',
  salePrice: 'salePrice',
  price: 'salePrice',
  purchasePrice: 'purchasePrice',
  categoryName: 'categoryName',
  category: 'categoryName',
  supplier: 'supplier',
  purchaseDate: 'purchaseDate',
  expiryDate: 'expiryDate'
};

export interface PaginatedItemsParams {
  page?: number;
  pageSize?: number; // ثابت دائماً على 30 من الخادم
  search?: string;
  barcodeOnly?: boolean | string;
  categoryId?: string;
  supplier?: string;
  stockStatus?: 'ALL' | 'AVAILABLE' | 'LOW' | 'OUT' | string;
  status?: 'ALL' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' | string;
  platformId?: string;
  warehouseId?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc' | string;
}

export interface PaginatedItemsTotals {
  itemsCount: number;
  totalPieces: number;
  totalSaleValue: number;
  totalPurchaseValue?: number;
}

export interface PaginatedItemsResult {
  success: boolean;
  statusCode?: number;
  items: Item[];
  page: number;
  pageSize: 30;
  total: number;
  totalPages: number;
  totals: PaginatedItemsTotals;
  warehouseId?: string;
  error?: string;
}

const ITEMS_PAGE_SIZE = 30 as const;

/**
 * جلب الأصناف بترقيم الصفحات (pageSize ثابت 30) مع البحث والفلترة وحساب إجماليات كل النتائج المفلترة
 * وحذف سعر الشراء وإجمالي الشراء تماماً لمن لا يملك صلاحية رؤية التكلفة
 * ودعم التصفية وحساب الكميات والإجماليات حسب warehouseId (أو الكل)
 */
export async function getItemsPaginated(
  params: PaginatedItemsParams = {},
  session?: { token?: string; role: UserRole; isOwner?: boolean; userId?: string; id?: string; phone?: string; username?: string; permissions: PermissionKey[] }
): Promise<PaginatedItemsResult> {
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const barcodeOnly =
    params.barcodeOnly === true ||
    String(params.barcodeOnly || '').toLowerCase() === 'true' ||
    String(params.barcodeOnly || '') === '1';

  const canViewPurchase = Boolean(
    session &&
      (session.role === 'designer' ||
        session.isOwner ||
        session.permissions?.includes('prices.view_purchase'))
  );
  const canViewPackaging = Boolean(
    session &&
      (session.role === 'designer' ||
        session.isOwner ||
        session.permissions?.includes('prices.view_packaging'))
  );

  const rawSortByKey = String(params.sortBy || '').trim();
  const mappedSortBy = ITEM_SORT_COLUMN_ALIASES[rawSortByKey];
  const rawSortDir = String(params.sortDir || '').trim().toLowerCase();
  const validSortDir: 'asc' | 'desc' | '' =
    rawSortDir === 'asc' || rawSortDir === 'desc' ? rawSortDir : '';
  const effectiveSortBy: AllowedItemSortColumn | '' =
    mappedSortBy &&
    ALLOWED_ITEM_SORT_COLUMNS.has(mappedSortBy) &&
    validSortDir !== '' &&
    (mappedSortBy !== 'purchasePrice' || canViewPurchase)
      ? mappedSortBy
      : '';
  const effectiveSortDir: 'asc' | 'desc' | '' = effectiveSortBy ? validSortDir : '';

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const reqParams = {
      page,
      pageSize: ITEMS_PAGE_SIZE,
      search: params.search || '',
      barcodeOnly,
      categoryId: params.categoryId || '',
      supplier: params.supplier || '',
      stockStatus: params.stockStatus || 'ALL',
      status: params.status || 'ALL',
      platformId: params.platformId || 'ALL',
      warehouseId: params.warehouseId || WAREHOUSE_ALL_TOKEN,
      sortBy: effectiveSortBy,
      sortDir: effectiveSortDir
    };
    const cacheKey = `itemsPaginated:${Boolean(canViewPurchase)}:${Boolean(canViewPackaging)}:${JSON.stringify(reqParams)}`;
    const res = await callAppsScript('getItemsPaginated', reqParams, session?.token);
    if (res && res.success) {
      const cachedCats = getSheetsCache<ProductCategory[]>('categories')?.data || [];
      const catMap = new Map(cachedCats.map(c => [c.id, c.name]));
      const rawItems = Array.isArray(res.items) ? res.items : (Array.isArray(res.data?.items) ? res.data.items : []);
      const sanitizedItems = rawItems.map((it: any) => {
        const copy: any = {
          ...it,
          categoryName: it.categoryName || (it.categoryId ? catMap.get(it.categoryId) : '') || ''
        };
        if (!canViewPurchase) delete copy.purchasePrice;
        if (!canViewPackaging) delete copy.packagingCost;
        return copy;
      });
      const rawTotals = res.totals || res.data?.totals || {
        itemsCount: sanitizedItems.length,
        totalPieces: 0,
        totalSaleValue: 0
      };
      const totals: PaginatedItemsTotals = {
        itemsCount: Number(rawTotals.itemsCount || 0),
        totalPieces: Number(rawTotals.totalPieces || 0),
        totalSaleValue: Number(rawTotals.totalSaleValue || 0)
      };
      if (canViewPurchase && rawTotals.totalPurchaseValue !== undefined) {
        totals.totalPurchaseValue = Number(rawTotals.totalPurchaseValue || 0);
      }
      const total = Number(res.total ?? res.data?.total ?? totals.itemsCount);
      const result: PaginatedItemsResult = {
        success: true,
        items: sanitizedItems,
        page: Number(res.page ?? res.data?.page ?? page),
        pageSize: ITEMS_PAGE_SIZE,
        total,
        totalPages: Number(res.totalPages ?? res.data?.totalPages ?? (total === 0 ? 0 : Math.ceil(total / ITEMS_PAGE_SIZE))),
        totals,
        warehouseId: res.warehouseId || res.data?.warehouseId || reqParams.warehouseId
      };
      setSheetsCache(cacheKey, result);
      return result;
    }

    const cached = getSheetsCache<PaginatedItemsResult>(cacheKey);
    if (cached) {
      return {
        ...cached.data,
        stale: true,
        lastSyncAt: cached.lastSyncAt
      } as PaginatedItemsResult & { stale?: boolean; lastSyncAt?: string };
    }

    const failure = buildSheetsWriteFailure(res, 'تعذر جلب الأصناف من Google Sheets');
    return {
      success: false,
      code: failure.code,
      error: failure.error,
      items: [],
      page,
      pageSize: ITEMS_PAGE_SIZE,
      total: 0,
      totalPages: 0,
      totals: {
        itemsCount: 0,
        totalPieces: 0,
        totalSaleValue: 0
      }
    } as PaginatedItemsResult & { code?: string };
  }

  // التحقق من المخزن المطلوب وصلاحية المستخدم عليه إن تم تحديد warehouseId بعينه
  const requestedWhRaw = String(params.warehouseId || '').trim();
  const isSpecificWarehouse = Boolean(requestedWhRaw && requestedWhRaw.toUpperCase() !== WAREHOUSE_ALL_TOKEN);
  let targetWarehouse: Warehouse | undefined = undefined;
  if (isSpecificWarehouse) {
    targetWarehouse = memoryWarehouses.find(
      w => w.id === requestedWhRaw || normalizeWarehouseName(w.name) === normalizeWarehouseName(requestedWhRaw)
    );
    if (!targetWarehouse) {
      return {
        success: false,
        statusCode: 400,
        error: 'المخزن المحدد غير مسجل بالنظام',
        items: [],
        page,
        pageSize: ITEMS_PAGE_SIZE,
        total: 0,
        totalPages: 0,
        totals: { itemsCount: 0, totalPieces: 0, totalSaleValue: 0 }
      };
    }
    const allowedWhIds = getAllowedWarehouseIdsForSession(session);
    if (allowedWhIds !== WAREHOUSE_ALL_TOKEN && !allowedWhIds.includes(targetWarehouse.id)) {
      return {
        success: false,
        statusCode: 403,
        error: `غير مصرح: المخزن "${targetWarehouse.name}" غير مسموح لك`,
        items: [],
        page,
        pageSize: ITEMS_PAGE_SIZE,
        total: 0,
        totalPages: 0,
        totals: { itemsCount: 0, totalPieces: 0, totalSaleValue: 0 }
      };
    }
  }

  const getQtyForItem = (it: Item): number =>
    targetWarehouse ? getItemWarehouseStock(it.id, targetWarehouse.id) : Number(it.stockQuantity || 0);

  const catMap = new Map(memoryCategories.map(c => [c.id, c.name]));
  const rawSearch = String(params.search || '').trim();
  const normSearchName = normalizeItemName(rawSearch);
  const normSearchBc = normalizeItemBarcode(rawSearch).toLowerCase();
  const categoryIdFilter = String(params.categoryId || '').trim();
  const supplierFilter = String(params.supplier || '').trim();
  const stockStatusFilter = String(params.stockStatus || 'ALL').trim().toUpperCase();
  const statusFilter = String(params.status || 'ALL').trim().toUpperCase();
  const platformIdFilter = String(params.platformId || 'ALL').trim();

  const filtered = memoryItems.filter(it => {
    // 1. فلتر الحالة
    if (statusFilter && statusFilter !== 'ALL') {
      const st = String(it.status || '').trim();
      if ((statusFilter === 'ACTIVE' || statusFilter === 'نشط') && st !== 'active' && st !== 'نشط') return false;
      if ((statusFilter === 'INACTIVE' || statusFilter === 'موقوف') && st !== 'inactive' && st !== 'موقوف') return false;
      if ((statusFilter === 'ARCHIVED' || statusFilter === 'مؤرشف') && st !== 'مؤرشف') return false;
    }

    // 2. فلتر التصنيف
    if (categoryIdFilter && categoryIdFilter !== 'ALL') {
      if (categoryIdFilter === 'UNCATEGORIZED') {
        if (it.categoryId && String(it.categoryId).trim() !== '') return false;
      } else if (String(it.categoryId || '').trim() !== categoryIdFilter) {
        return false;
      }
    }

    // 3. فلتر المورد
    if (supplierFilter && supplierFilter !== 'ALL') {
      if (supplierFilter === 'NONE') {
        if (it.supplier && it.supplier.trim() !== '') return false;
      } else if (normalizeItemName(it.supplier) !== normalizeItemName(supplierFilter)) {
        return false;
      }
    }

    // 4. فلتر المخزون (بحسب المخزن المحدد أو الإجمالي، مع استخدام الحد الأدنى الخاص بالمخزن إن وُجد)
    if (stockStatusFilter && stockStatusFilter !== 'ALL') {
      const qty = getQtyForItem(it);
      const reorderLimit = targetWarehouse
        ? getItemWarehouseReorderLimit(it.id, targetWarehouse.id)
        : (it.reorderLimit !== undefined ? Number(it.reorderLimit) : 5);
      if (stockStatusFilter === 'AVAILABLE' && !(qty > reorderLimit)) return false;
      if (stockStatusFilter === 'LOW' && !(qty > 0 && qty <= reorderLimit)) return false;
      if (stockStatusFilter === 'OUT' && !(qty <= 0)) return false;
    }

    // 5. فلتر المنصة
    if (platformIdFilter && platformIdFilter !== 'ALL') {
      if (platformIdFilter === 'UNRESTRICTED') {
        if (it.platformIds && it.platformIds.length > 0) return false;
      } else if (it.platformIds && it.platformIds.length > 0 && !it.platformIds.includes(platformIdFilter)) {
        return false;
      }
    }

    // 6. البحث بالاسم أو الكود أو الباركود
    if (rawSearch.length > 0) {
      const itemBarcodes: string[] = [];
      if (it.barcode) {
        const nb = normalizeItemBarcode(it.barcode).toLowerCase();
        if (nb) itemBarcodes.push(nb);
      }
      if (Array.isArray(it.secondaryBarcodes)) {
        for (const sb of it.secondaryBarcodes) {
          const nsb = normalizeItemBarcode(sb).toLowerCase();
          if (nsb) itemBarcodes.push(nsb);
        }
      }
      if (Array.isArray(it.barcodes)) {
        for (const b of it.barcodes) {
          const rawB = typeof b === 'string' ? b : b?.barcode;
          const nbb = normalizeItemBarcode(rawB).toLowerCase();
          if (nbb) itemBarcodes.push(nbb);
        }
      }

      if (barcodeOnly) {
        if (!normSearchBc) return false;
        return itemBarcodes.some(bc => bc === normSearchBc);
      }

      const matchesName = Boolean(normSearchName && normalizeItemName(it.name).includes(normSearchName));
      const matchesPrintName = Boolean(normSearchName && it.printName && normalizeItemName(it.printName).includes(normSearchName));
      const matchesSkuBc = Boolean(normSearchBc && it.sku && normalizeItemBarcode(it.sku).toLowerCase().includes(normSearchBc));
      const matchesSkuText = Boolean(normSearchName && it.sku && normalizeItemName(it.sku).includes(normSearchName));
      const matchesBc = Boolean(normSearchBc && itemBarcodes.some(bc => bc.includes(normSearchBc)));
      if (!matchesName && !matchesPrintName && !matchesSkuBc && !matchesSkuText && !matchesBc) {
        return false;
      }
    }

    return true;
  });

  // حساب إجماليات كل النتائج المفلترة بناءً على المخزن المحدد أو الكل
  let totalPieces = 0;
  let totalSaleValueRaw = 0;
  let totalPurchaseValueRaw = 0;

  for (const it of filtered) {
    const qty = getQtyForItem(it);
    const salePrice = Number(it.salePrice || 0);
    const purchasePrice = Number(it.purchasePrice || 0);
    totalPieces += qty;
    totalSaleValueRaw += qty * salePrice;
    if (canViewPurchase) {
      totalPurchaseValueRaw += qty * purchasePrice;
    }
  }
  totalPieces = Math.round(totalPieces * 1000) / 1000;

  // ترتيب كل الأصناف المفلترة في السيرفر قبل تقسيم الصفحات
  if (effectiveSortBy && effectiveSortDir) {
    const dirMultiplier = effectiveSortDir === 'desc' ? -1 : 1;

    const getSortMeta = (it: Item): { empty: boolean; type: 'text' | 'number' | 'date'; val: any } => {
      switch (effectiveSortBy) {
        case 'name': {
          const s = String(it.name ?? '').trim();
          if (!s || s === '—') return { empty: true, type: 'text', val: '' };
          return { empty: false, type: 'text', val: s };
        }
        case 'printName': {
          const s = String(it.printName ?? '').trim();
          if (!s || s === '—') return { empty: true, type: 'text', val: '' };
          return { empty: false, type: 'text', val: s };
        }
        case 'barcode': {
          const s = String(it.barcode ?? '').trim();
          if (!s || s === '—') return { empty: true, type: 'text', val: '' };
          return { empty: false, type: 'text', val: s };
        }
        case 'notes': {
          const s = String(it.notes ?? '').trim();
          if (!s || s === '—') return { empty: true, type: 'text', val: '' };
          return { empty: false, type: 'text', val: s };
        }
        case 'unit': {
          const s = String(it.unit ?? '').trim();
          if (!s || s === '—') return { empty: true, type: 'text', val: '' };
          return { empty: false, type: 'text', val: s };
        }
        case 'categoryName': {
          const rawCat = String(it.categoryName || (it.categoryId ? catMap.get(it.categoryId) : '') || '').trim();
          if (!rawCat || rawCat === '—' || rawCat === 'بدون تصنيف') {
            return { empty: true, type: 'text', val: '' };
          }
          return { empty: false, type: 'text', val: rawCat };
        }
        case 'supplier': {
          const s = String(it.supplier ?? '').trim();
          if (!s || s === '—') return { empty: true, type: 'text', val: '' };
          return { empty: false, type: 'text', val: s };
        }
        case 'stockQuantity': {
          const q = getQtyForItem(it);
          if (q === null || q === undefined || Number.isNaN(Number(q))) {
            return { empty: true, type: 'number', val: 0 };
          }
          return { empty: false, type: 'number', val: Number(q) };
        }
        case 'salePrice': {
          const raw = it.salePrice;
          if (raw === null || raw === undefined || (raw as any) === '' || Number.isNaN(Number(raw))) {
            return { empty: true, type: 'number', val: 0 };
          }
          return { empty: false, type: 'number', val: Number(raw) };
        }
        case 'purchasePrice': {
          const raw = it.purchasePrice;
          if (raw === null || raw === undefined || (raw as any) === '' || Number.isNaN(Number(raw))) {
            return { empty: true, type: 'number', val: 0 };
          }
          return { empty: false, type: 'number', val: Number(raw) };
        }
        case 'purchaseDate': {
          const s = String(it.purchaseDate ?? '').trim();
          if (!s || s === '—') return { empty: true, type: 'date', val: 0 };
          const ts = Date.parse(s);
          if (Number.isNaN(ts)) return { empty: true, type: 'date', val: 0 };
          return { empty: false, type: 'date', val: ts };
        }
        case 'expiryDate': {
          const s = String(it.expiryDate ?? '').trim();
          if (!s || s === '—') return { empty: true, type: 'date', val: 0 };
          const ts = Date.parse(s);
          if (Number.isNaN(ts)) return { empty: true, type: 'date', val: 0 };
          return { empty: false, type: 'date', val: ts };
        }
      }
    };

    filtered.sort((a, b) => {
      const ma = getSortMeta(a);
      const mb = getSortMeta(b);
      // القيم الفاضية تيجي في الآخر دايماً في الاتجاهين
      if (ma.empty && mb.empty) return 0;
      if (ma.empty) return 1;
      if (mb.empty) return -1;

      let cmp = 0;
      if (ma.type === 'number' || ma.type === 'date') {
        cmp = ma.val === mb.val ? 0 : ma.val < mb.val ? -1 : 1;
      } else {
        cmp = String(ma.val).localeCompare(String(mb.val), 'ar', { sensitivity: 'base' });
      }
      return cmp * dirMultiplier;
    });
  }

  const total = filtered.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / ITEMS_PAGE_SIZE);
  const startIdx = (page - 1) * ITEMS_PAGE_SIZE;
  const pageSlice = filtered.slice(startIdx, startIdx + ITEMS_PAGE_SIZE);

  const items: Item[] = pageSlice.map(it => {
    const copy: any = { ...it };
    copy.categoryName = catMap.get(copy.categoryId || '') || '';
    copy.updatedAt = copy.updatedAt || copy.createdAt || '';
    if (targetWarehouse) {
      copy.stockQuantity = getItemWarehouseStock(it.id, targetWarehouse.id);
      copy.totalStockQuantity = Number(it.stockQuantity || 0);
      copy.generalReorderLimit = it.reorderLimit !== undefined ? Number(it.reorderLimit) : 5;
      copy.reorderLimit = getItemWarehouseReorderLimit(it.id, targetWarehouse.id);
      copy.warehouseId = targetWarehouse.id;
      copy.warehouseName = targetWarehouse.name;
    }
    if (!canViewPurchase) delete copy.purchasePrice;
    if (!canViewPackaging) delete copy.packagingCost;
    return copy;
  });

  const totals: PaginatedItemsTotals = {
    itemsCount: total,
    totalPieces,
    totalSaleValue: Math.round(totalSaleValueRaw * 100) / 100
  };
  if (canViewPurchase) {
    totals.totalPurchaseValue = Math.round(totalPurchaseValueRaw * 100) / 100;
  }

  return {
    success: true,
    items,
    page,
    pageSize: ITEMS_PAGE_SIZE,
    total,
    totalPages,
    totals,
    warehouseId: targetWarehouse ? targetWarehouse.id : WAREHOUSE_ALL_TOKEN
  };
}

/**
 * تنسيق التاريخ بصيغة YYYY-MM-DD بتوقيت القاهرة (Africa/Cairo)
 */
export function getCairoDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/**
 * حقن تجميد الصف الأول (ySplit=1) داخل xl/worksheets/sheet1.xml مع دعم تلوين عناوين قالب إضافة الأصناف
 */
function patchXlsxFreezeTopRow(
  zipBuf: Buffer,
  options?: { styleAddItemsHeaders?: boolean }
): Buffer {
  try {
    let eocdOff = -1;
    for (let i = zipBuf.length - 22; i >= 0; i--) {
      if (zipBuf.readUInt32LE(i) === 0x06054b50) {
        eocdOff = i;
        break;
      }
    }
    if (eocdOff === -1) return zipBuf;

    const totalEntries = zipBuf.readUInt16LE(eocdOff + 10);
    const cdOffset = zipBuf.readUInt32LE(eocdOff + 16);

    interface ZipEntryRecord {
      name: string;
      cdHeader: Buffer;
      localHeader: Buffer;
      compData: Buffer;
      crc: number;
      compSize: number;
      uncompSize: number;
      method: number;
    }

    const entries: ZipEntryRecord[] = [];
    let pos = cdOffset;
    let didPatch = false;
    const styleAddItems = Boolean(options?.styleAddItemsHeaders);
    let mandatoryXfIdx = -1;
    let optionalXfIdx = -1;

    // أولاً نقرأ أسماء وبيانات الإدخالات لفحص xl/styles.xml قبل sheet1.xml
    for (let i = 0; i < totalEntries; i++) {
      const compMethod = zipBuf.readUInt16LE(pos + 10);
      const crc = zipBuf.readUInt32LE(pos + 16);
      const compSize = zipBuf.readUInt32LE(pos + 20);
      const uncompSize = zipBuf.readUInt32LE(pos + 24);
      const nameLen = zipBuf.readUInt16LE(pos + 28);
      const extraLen = zipBuf.readUInt16LE(pos + 30);
      const commentLen = zipBuf.readUInt16LE(pos + 32);
      const localOff = zipBuf.readUInt32LE(pos + 42);
      const name = zipBuf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');

      const lNameLen = zipBuf.readUInt16LE(localOff + 26);
      const lExtraLen = zipBuf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const compData = zipBuf.subarray(dataStart, dataStart + compSize);

      entries.push({
        name,
        cdHeader: Buffer.from(zipBuf.subarray(pos, pos + 46 + nameLen + extraLen + commentLen)),
        localHeader: Buffer.from(zipBuf.subarray(localOff, dataStart)),
        compData,
        crc,
        compSize,
        uncompSize,
        method: compMethod
      });

      pos += 46 + nameLen + extraLen + commentLen;
    }

    if (styleAddItems) {
      const stylesEntry = entries.find(e => e.name === 'xl/styles.xml');
      if (stylesEntry) {
        const sXml =
          stylesEntry.method === 8
            ? zlib.inflateRawSync(stylesEntry.compData).toString('utf8')
            : stylesEntry.compData.toString('utf8');

        const fontsMatch = sXml.match(/<fonts count="(\d+)">([\s\S]*?)<\/fonts>/);
        const fillsMatch = sXml.match(/<fills count="(\d+)">([\s\S]*?)<\/fills>/);
        const cellXfsMatch = sXml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);

        if (fontsMatch && fillsMatch && cellXfsMatch) {
          const oldFontCount = Number(fontsMatch[1]);
          const oldFillCount = Number(fillsMatch[1]);
          const oldXfCount = Number(cellXfsMatch[1]);

          const mandatoryFontIdx = oldFontCount;
          const optionalFontIdx = oldFontCount + 1;
          const mandatoryFillIdx = oldFillCount;
          const optionalFillIdx = oldFillCount + 1;
          mandatoryXfIdx = oldXfCount;
          optionalXfIdx = oldXfCount + 1;

          const extraFonts =
            '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
            '<font><b/><sz val="11"/><color rgb="FF1E293B"/><name val="Calibri"/><family val="2"/></font>';
          const extraFills =
            '<fill><patternFill patternType="solid"><fgColor rgb="FF168A4A"/><bgColor indexed="64"/></patternFill></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>';
          const extraXfs =
            `<xf numFmtId="0" fontId="${mandatoryFontIdx}" fillId="${mandatoryFillIdx}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
            `<xf numFmtId="0" fontId="${optionalFontIdx}" fillId="${optionalFillIdx}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`;

          const patchedStyles = sXml
            .replace(
              `<fonts count="${oldFontCount}">${fontsMatch[2]}</fonts>`,
              `<fonts count="${oldFontCount + 2}">${fontsMatch[2]}${extraFonts}</fonts>`
            )
            .replace(
              `<fills count="${oldFillCount}">${fillsMatch[2]}</fills>`,
              `<fills count="${oldFillCount + 2}">${fillsMatch[2]}${extraFills}</fills>`
            )
            .replace(
              `<cellXfs count="${oldXfCount}">${cellXfsMatch[2]}</cellXfs>`,
              `<cellXfs count="${oldXfCount + 2}">${cellXfsMatch[2]}${extraXfs}</cellXfs>`
            );

          if (patchedStyles !== sXml) {
            didPatch = true;
            const raw = Buffer.from(patchedStyles, 'utf8');
            stylesEntry.crc = zlib.crc32(raw) >>> 0;
            stylesEntry.uncompSize = raw.length;
            stylesEntry.compData = stylesEntry.method === 8 ? zlib.deflateRawSync(raw) : raw;
            stylesEntry.compSize = stylesEntry.compData.length;
          }
        }
      }
    }

    const sheet1Entry = entries.find(e => e.name === 'xl/worksheets/sheet1.xml');
    if (sheet1Entry) {
      const xml =
        sheet1Entry.method === 8
          ? zlib.inflateRawSync(sheet1Entry.compData).toString('utf8')
          : sheet1Entry.compData.toString('utf8');
      let patchedXml = xml.replace(
        /<sheetView([^>]*)\/>/,
        '<sheetView$1><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>'
      );

      if (styleAddItems && mandatoryXfIdx >= 0 && optionalXfIdx >= 0) {
        const mandatoryCols = ['A', 'E'];
        const optionalCols = ['B', 'C', 'D', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
        for (const colLetter of mandatoryCols) {
          const cellRef = `${colLetter}1`;
          patchedXml = patchedXml.replace(
            new RegExp(`<c r="${cellRef}"(?: s="\\d+")?([^>]*)>`),
            `<c r="${cellRef}" s="${mandatoryXfIdx}"$1>`
          );
        }
        for (const colLetter of optionalCols) {
          const cellRef = `${colLetter}1`;
          patchedXml = patchedXml.replace(
            new RegExp(`<c r="${cellRef}"(?: s="\\d+")?([^>]*)>`),
            `<c r="${cellRef}" s="${optionalXfIdx}"$1>`
          );
        }
      }

      if (patchedXml !== xml) {
        didPatch = true;
        const raw = Buffer.from(patchedXml, 'utf8');
        sheet1Entry.crc = zlib.crc32(raw) >>> 0;
        sheet1Entry.uncompSize = raw.length;
        sheet1Entry.compData = sheet1Entry.method === 8 ? zlib.deflateRawSync(raw) : raw;
        sheet1Entry.compSize = sheet1Entry.compData.length;
      }
    }

    if (!didPatch) return zipBuf;

    const outChunks: Buffer[] = [];
    const cdChunks: Buffer[] = [];
    let offset = 0;

    for (const e of entries) {
      e.localHeader.writeUInt16LE(e.method, 8);
      e.localHeader.writeUInt32LE(e.crc, 14);
      e.localHeader.writeUInt32LE(e.compSize, 18);
      e.localHeader.writeUInt32LE(e.uncompSize, 22);
      outChunks.push(e.localHeader, e.compData);

      e.cdHeader.writeUInt16LE(e.method, 10);
      e.cdHeader.writeUInt32LE(e.crc, 16);
      e.cdHeader.writeUInt32LE(e.compSize, 20);
      e.cdHeader.writeUInt32LE(e.uncompSize, 24);
      e.cdHeader.writeUInt32LE(offset, 42);
      cdChunks.push(e.cdHeader);

      offset += e.localHeader.length + e.compData.length;
    }

    const cdBuf = Buffer.concat(cdChunks);
    const eocd = Buffer.from(zipBuf.subarray(eocdOff, eocdOff + 22));
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return Buffer.concat([...outChunks, cdBuf, eocd]);
  } catch {
    return zipBuf;
  }
}

export interface ExportItemsExcelResult {
  success: boolean;
  buffer?: Buffer;
  fileName?: string;
  cairoDate?: string;
  totalItems?: number;
  includesPurchasePrice?: boolean;
  error?: string;
  statusCode?: number;
}

/**
 * تجهيز ملف Excel (.xlsx) حقيقي يحتوي على جميع أصناف المخزن بدون أي فلاتر
 * متوافق مع ItemImportModal في أسماء وترتيب الأعمدة، مع RTL وتثبيت الصف الأول
 * وحذف عمود سعر الشراء لمن لا يملك صلاحية التكلفة، وتسجيل في سجل التدقيق
 */
export async function exportAllItemsExcelBuffer(session?: {
  token?: string;
  id?: string;
  userId?: string;
  name?: string;
  phone?: string;
  role: UserRole;
  isOwner?: boolean;
  permissions: PermissionKey[];
}): Promise<ExportItemsExcelResult> {
  const canExport = Boolean(
    session &&
      (session.role === 'designer' ||
        session.isOwner ||
        session.permissions?.includes('products.export'))
  );
  if (!canExport) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لحق الوصول أو صلاحية [products.export]'
    };
  }

  const canViewPurchase = Boolean(
    session &&
      (session.role === 'designer' ||
        session.isOwner ||
        session.permissions?.includes('prices.view_purchase'))
  );
  const canViewPackaging = Boolean(
    session &&
      (session.role === 'designer' ||
        session.isOwner ||
        session.permissions?.includes('prices.view_packaging'))
  );

  let allItems: Item[] = [];
  let categoriesList: ProductCategory[] = [];
  let platformsList: Platform[] = [];
  let costsList: ItemPlatformCost[] = [];

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const firstPage: any = await getItemsPaginated({ page: 1 }, session);
    if (!firstPage.success) {
      return {
        success: false,
        statusCode: firstPage.code === 'UNKNOWN_RESULT' ? 504 : 503,
        error: firstPage.error || 'تعذر جلب الأصناف من Google Sheets لتجهيز ملف الإكسيل'
      };
    }
    allItems = [...firstPage.items];
    for (let p = 2; p <= firstPage.totalPages; p++) {
      const nextPage = await getItemsPaginated({ page: p }, session);
      if (nextPage.success && Array.isArray(nextPage.items)) {
        allItems.push(...nextPage.items);
      }
    }
    try {
      const cats = await getCategories(session);
      if (Array.isArray(cats)) categoriesList = cats;
    } catch {}
    try {
      const plats = await getPlatforms();
      if (Array.isArray(plats)) platformsList = plats;
    } catch {}
    try {
      const pCosts = await getItemPlatformCosts(session);
      if (Array.isArray(pCosts)) costsList = pCosts;
    } catch {}
  } else {
    categoriesList = memoryCategories;
    platformsList = memoryPlatforms;
    costsList = memoryCosts;
    allItems = memoryItems.map(it => ({ ...it }));
  }

  const catMap = new Map<string, ProductCategory>(categoriesList.map(c => [c.id, c]));
  const platformMap = new Map<string, Platform>(platformsList.map(p => [p.id, p]));

  // آخر تعديل لكل صنف من سجل تغييرات الأصناف أو حركات المخزون
  const lastModifiedMap = new Map<string, string>();
  const trackTimestamp = (itemId: string, ts?: string) => {
    if (!itemId || !ts) return;
    const prev = lastModifiedMap.get(itemId);
    if (!prev || new Date(ts).getTime() > new Date(prev).getTime()) {
      lastModifiedMap.set(itemId, ts);
    }
  };
  for (const l of memoryItemChangeLogs) trackTimestamp(l.itemId, l.timestamp);
  for (const m of memoryStockMovements) trackTimestamp(m.itemId, m.date);

  // تجميع خصم شحن المرتجع بالمنصات لكل صنف
  const itemCostsMap = new Map<string, string[]>();
  for (const c of costsList) {
    if (!c.itemId) continue;
    const pName = platformMap.get(c.platformId)?.name || c.platformId;
    const list = itemCostsMap.get(c.itemId) || [];
    list.push(`${pName}: ${Number(c.returnShippingDeduction || 0)}`);
    itemCostsMap.set(c.itemId, list);
  }

  // أسماء الأعمدة وترتيبها متوافقة أولاً مع ItemImportModal ثم باقي حقول كارت الصنف
  const headers: string[] = [
    'اسم الصنف',
    'اسم الطباعة',
    'كود SKU',
    'الباركود الأساسي',
    'باركودات فرعية (مفصولة بفواصل)',
    'المورد',
    'وحدة القياس',
    'سعر البيع',
    'الحد الأدنى لسعر البيع',
    ...(canViewPurchase ? ['سعر الشراء'] : []),
    ...(canViewPackaging ? ['تكلفة التغليف'] : []),
    'الكمية بالمخزن',
    'حد إعادة الطلب',
    'نسبة الضريبة %',
    'ملاحظات',
    // الحقول الإضافية في كارت الصنف
    'معرف الصنف (ID)',
    'التصنيف الرئيسي',
    'التصنيف الفرعي',
    'الحالة',
    'المنصات المتاحة',
    'تفعيل BNPL',
    'نسبة BNPL %',
    'رسوم الالتقاط',
    'خصم شحن المرتجع بالمنصات',
    'رابط الصورة',
    'تاريخ الإضافة',
    'آخر تعديل'
  ];

  const textColumnHeaders = new Set<string>([
    'اسم الصنف',
    'اسم الطباعة',
    'كود SKU',
    'الباركود الأساسي',
    'باركودات فرعية (مفصولة بفواصل)',
    'معرف الصنف (ID)'
  ]);

  const numericColumnHeaders = new Set<string>([
    'سعر البيع',
    'الحد الأدنى لسعر البيع',
    'سعر الشراء',
    'تكلفة التغليف',
    'الكمية بالمخزن',
    'حد إعادة الطلب',
    'نسبة الضريبة %',
    'نسبة BNPL %',
    'رسوم الالتقاط'
  ]);

  const aoa: (string | number)[][] = [headers];

  for (const it of allItems) {
    const cat = it.categoryId ? catMap.get(it.categoryId) : undefined;
    let mainCategory = '';
    let subCategory = '';
    if (cat) {
      if (cat.parentCategoryId) {
        const parentCat = catMap.get(cat.parentCategoryId);
        mainCategory = parentCat?.name || cat.parentName || '';
        subCategory = cat.name;
      } else {
        mainCategory = cat.name;
      }
    } else if (it.categoryName) {
      mainCategory = it.categoryName;
    }

    const platformsLabel =
      !it.platformIds || it.platformIds.length === 0
        ? 'الكل'
        : it.platformIds.map(pid => platformMap.get(pid)?.name || pid).join('، ');

    const rowObj: Record<string, string | number> = {
      'اسم الصنف': String(it.name || ''),
      'اسم الطباعة': String(it.printName || ''),
      'كود SKU': String(it.sku || ''),
      'الباركود الأساسي': String(it.barcode || ''),
      'باركودات فرعية (مفصولة بفواصل)': Array.isArray(it.secondaryBarcodes)
        ? it.secondaryBarcodes.join(', ')
        : '',
      'المورد': String(it.supplier || ''),
      'وحدة القياس': String(it.unit || 'قطعة'),
      'سعر البيع': Number(it.salePrice || 0),
      'الحد الأدنى لسعر البيع': it.minPrice !== undefined ? Number(it.minPrice) : 0,
      ...(canViewPurchase ? { 'سعر الشراء': Number(it.purchasePrice || 0) } : {}),
      ...(canViewPackaging ? { 'تكلفة التغليف': Number(it.packagingCost || 0) } : {}),
      'الكمية بالمخزن': Number(it.stockQuantity || 0),
      'حد إعادة الطلب': it.reorderLimit !== undefined ? Number(it.reorderLimit) : 5,
      'نسبة الضريبة %': Number(it.taxRate || 0),
      'ملاحظات': String(it.notes || ''),
      'معرف الصنف (ID)': String(it.id || ''),
      'التصنيف الرئيسي': mainCategory,
      'التصنيف الفرعي': subCategory,
      'الحالة': String(it.status || 'نشط'),
      'المنصات المتاحة': platformsLabel,
      'تفعيل BNPL': it.enableBnpl ? 'نعم' : 'لا',
      'نسبة BNPL %': Number(it.bnplPercentage || 0),
      'رسوم الالتقاط': it.pickupFee !== undefined ? Number(it.pickupFee) : 0,
      'خصم شحن المرتجع بالمنصات': (itemCostsMap.get(it.id) || []).join(' | '),
      'رابط الصورة': String(it.imageUrl || ''),
      'تاريخ الإضافة': String(it.createdAt || ''),
      'آخر تعديل': String(lastModifiedMap.get(it.id) || '')
    };

    aoa.push(headers.map(h => rowObj[h] ?? ''));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // إجبار أعمدة الباركود والكود على النص (@) وأعمدة الأرقام على الرقم (n)
  for (let r = 1; r < aoa.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const hName = headers[c];
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = ws[cellRef];
      if (!cell) continue;
      if (textColumnHeaders.has(hName)) {
        cell.t = 's';
        cell.v = String(cell.v ?? '');
        cell.z = '@';
      } else if (numericColumnHeaders.has(hName)) {
        cell.t = 'n';
        cell.v = Number(cell.v || 0);
      }
    }
  }

  const widthByHeader: Record<string, number> = {
    'اسم الصنف': 32,
    'اسم الطباعة': 28,
    'كود SKU': 18,
    'الباركود الأساسي': 20,
    'باركودات فرعية (مفصولة بفواصل)': 28,
    'المورد': 24,
    'وحدة القياس': 14,
    'سعر البيع': 14,
    'الحد الأدنى لسعر البيع': 20,
    'سعر الشراء': 14,
    'تكلفة التغليف': 14,
    'الكمية بالمخزن': 15,
    'حد إعادة الطلب': 15,
    'نسبة الضريبة %': 14,
    'ملاحظات': 32,
    'معرف الصنف (ID)': 22,
    'التصنيف الرئيسي': 20,
    'التصنيف الفرعي': 20,
    'الحالة': 12,
    'المنصات المتاحة': 24,
    'تفعيل BNPL': 14,
    'نسبة BNPL %': 14,
    'رسوم الالتقاط': 14,
    'خصم شحن المرتجع بالمنصات': 28,
    'رابط الصورة': 30,
    'تاريخ الإضافة': 22,
    'آخر تعديل': 22
  };
  ws['!cols'] = headers.map(h => ({ wch: widthByHeader[h] || 18 }));
  ws['!views'] = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'الأصناف');

  const rawBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const finalBuffer = patchXlsxFreezeTopRow(rawBuffer);

  const cairoDate = getCairoDateString();
  const fileName = `أصناف-المخزن-${cairoDate}.xlsx`;

  recordAuditLog(
    {
      id: session?.id || session?.userId || 'system',
      name: session?.name || session?.phone || 'مستخدم',
      role: session?.role || 'user',
      phone: session?.phone
    },
    'PRODUCTS_EXPORT',
    'Item',
    fileName,
    `تصدير ${allItems.length} صنف إلى ملف Excel (${fileName})`
  );

  return {
    success: true,
    buffer: finalBuffer,
    fileName,
    cairoDate,
    totalItems: allItems.length,
    includesPurchasePrice: canViewPurchase
  };
}

// ==================== التعديل الجماعي للأصناف بالإكسيل (وضع الذاكرة فقط) ==================== //

export const BULK_EDIT_EXCEL_MAX_ROWS = 5000;

export const VALID_BULK_EDIT_OPERATIONS: readonly BulkEditOperationType[] = [
  'sale_price',
  'purchase_price',
  'primary_barcode',
  'add_secondary_barcode',
  'stock_quantity',
  'reorder_limit',
  'name',
  'print_name',
  'barcode_sku',
  'notes',
  'category',
  'platforms',
  'bnpl',
  'pickup_fee',
  'min_price',
  'packaging_cost',
  'tax_rate',
  'supplier',
  'unit',
  'status',
  'image_url',
  'add_items',
  'add_categories',
  'delete_categories',
  'delete_items'
];

interface BulkEditOperationMeta {
  label: string;
  sheetName: string; // Excel limits sheet names to <= 31 chars
  fileSlug: string;
  headers: string[];
  colWidths: Array<{ wch: number }>;
  textCols: number[];
}

export const BULK_EDIT_OP_META: Record<BulkEditOperationType, BulkEditOperationMeta> = {
  sale_price: {
    label: 'تعديل سعر البيع',
    sheetName: 'تعديل سعر البيع',
    fileSlug: 'نموذج-تعديل-سعر-البيع',
    headers: ['اسم الصنف', 'سعر البيع', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 18 }, { wch: 24 }],
    textCols: [2]
  },
  purchase_price: {
    label: 'تعديل سعر الشراء',
    sheetName: 'تعديل سعر الشراء',
    fileSlug: 'نموذج-تعديل-سعر-الشراء',
    headers: ['اسم الصنف', 'سعر الشراء', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 18 }, { wch: 24 }],
    textCols: [2]
  },
  primary_barcode: {
    label: 'تعديل الباركود الرئيسي',
    sheetName: 'تعديل الباركود الرئيسي',
    fileSlug: 'نموذج-تعديل-الباركود-الرئيسي',
    headers: ['اسم الصنف', 'الباركود الجديد', 'الكود'],
    colWidths: [{ wch: 36 }, { wch: 24 }, { wch: 24 }],
    textCols: [1, 2]
  },
  add_secondary_barcode: {
    label: 'إضافة باركود فرعي',
    sheetName: 'إضافة باركود فرعي',
    fileSlug: 'نموذج-إضافة-باركود-فرعي',
    headers: ['اسم الصنف', 'الباركود المضاف', 'الكود'],
    colWidths: [{ wch: 36 }, { wch: 24 }, { wch: 24 }],
    textCols: [1, 2]
  },
  stock_quantity: {
    label: 'تعديل الكميات',
    sheetName: 'تعديل الكميات',
    fileSlug: 'نموذج-تعديل-الكميات',
    headers: ['اسم الصنف', 'الكمية', 'الكود'],
    colWidths: [{ wch: 36 }, { wch: 18 }, { wch: 24 }],
    textCols: [2]
  },
  name: {
    label: 'تعديل الاسم',
    sheetName: 'تعديل الاسم',
    fileSlug: 'نموذج-تعديل-الاسم',
    headers: ['الاسم الحالي', 'الاسم الجديد', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 36 }, { wch: 24 }],
    textCols: [2]
  },
  print_name: {
    label: 'تعديل اسم الطباعة',
    sheetName: 'تعديل اسم الطباعة',
    fileSlug: 'نموذج-تعديل-اسم-الطباعة',
    headers: ['اسم الصنف', 'اسم الطباعة', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 36 }, { wch: 24 }],
    textCols: [1, 2]
  },
  barcode_sku: {
    label: 'تعديل الباركود / الكود',
    sheetName: 'تعديل الباركود والكود',
    fileSlug: 'نموذج-تعديل-الباركود-والكود',
    headers: [
      'اسم الصنف',
      'الباركود الأساسي',
      'كود SKU',
      'باركودات فرعية (مفصولة بفواصل)',
      'الكود/الباركود'
    ],
    colWidths: [{ wch: 34 }, { wch: 22 }, { wch: 18 }, { wch: 32 }, { wch: 24 }],
    textCols: [1, 2, 3, 4]
  },
  notes: {
    label: 'تعديل الوصف',
    sheetName: 'تعديل الوصف',
    fileSlug: 'نموذج-تعديل-الوصف',
    headers: ['اسم الصنف', 'الوصف', 'الكود/الباركود'],
    colWidths: [{ wch: 34 }, { wch: 46 }, { wch: 24 }],
    textCols: [2]
  },
  category: {
    label: 'تعديل التصنيف',
    sheetName: 'تعديل التصنيف',
    fileSlug: 'نموذج-تعديل-التصنيف',
    headers: ['اسم الصنف', 'التصنيف', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 28 }, { wch: 24 }],
    textCols: [2]
  },
  platforms: {
    label: 'تعديل المنصات المرتبطة',
    sheetName: 'تعديل المنصات المرتبطة',
    fileSlug: 'نموذج-تعديل-المنصات',
    headers: ['اسم الصنف', 'المنصات المرتبطة', 'الكود/الباركود'],
    colWidths: [{ wch: 34 }, { wch: 38 }, { wch: 24 }],
    textCols: [2]
  },
  bnpl: {
    label: 'تعديل BNPL',
    sheetName: 'تعديل BNPL',
    fileSlug: 'نموذج-تعديل-BNPL',
    headers: ['اسم الصنف', 'تفعيل BNPL', 'نسبة BNPL %', 'الكود/الباركود'],
    colWidths: [{ wch: 34 }, { wch: 16 }, { wch: 16 }, { wch: 24 }],
    textCols: [3]
  },
  pickup_fee: {
    label: 'تعديل رسوم الالتقاط للقطعة',
    sheetName: 'تعديل رسوم الالتقاط',
    fileSlug: 'نموذج-تعديل-رسوم-الالتقاط',
    headers: ['اسم الصنف', 'رسوم الالتقاط', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 20 }, { wch: 24 }],
    textCols: [2]
  },
  min_price: {
    label: 'تعديل الحد الأدنى لسعر البيع',
    sheetName: 'تعديل الحد الأدنى للسعر',
    fileSlug: 'نموذج-تعديل-الحد-الأدنى-للسعر',
    headers: ['اسم الصنف', 'الحد الأدنى لسعر البيع', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 24 }, { wch: 24 }],
    textCols: [2]
  },
  packaging_cost: {
    label: 'تعديل تكلفة التغليف',
    sheetName: 'تعديل تكلفة التغليف',
    fileSlug: 'نموذج-تعديل-تكلفة-التغليف',
    headers: ['اسم الصنف', 'تكلفة التغليف', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 20 }, { wch: 24 }],
    textCols: [2]
  },
  tax_rate: {
    label: 'تعديل نسبة الضريبة %',
    sheetName: 'تعديل نسبة الضريبة',
    fileSlug: 'نموذج-تعديل-نسبة-الضريبة',
    headers: ['اسم الصنف', 'نسبة الضريبة %', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 20 }, { wch: 24 }],
    textCols: [2]
  },
  reorder_limit: {
    label: 'تعديل الحد الأدنى للكمية',
    sheetName: 'تعديل الحد الأدنى للكمية',
    fileSlug: 'نموذج-تعديل-الحد-الأدنى-للكمية',
    headers: ['اسم الصنف', 'الحد الأدنى', 'الكود'],
    colWidths: [{ wch: 36 }, { wch: 20 }, { wch: 24 }],
    textCols: [2]
  },
  supplier: {
    label: 'تعديل المورد',
    sheetName: 'تعديل المورد',
    fileSlug: 'نموذج-تعديل-المورد',
    headers: ['اسم الصنف', 'المورد', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 28 }, { wch: 24 }],
    textCols: [2]
  },
  unit: {
    label: 'تعديل الوحدة',
    sheetName: 'تعديل الوحدة',
    fileSlug: 'نموذج-تعديل-الوحدة',
    headers: ['اسم الصنف', 'الوحدة', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 20 }, { wch: 24 }],
    textCols: [2]
  },
  status: {
    label: 'تعديل الحالة',
    sheetName: 'تعديل الحالة',
    fileSlug: 'نموذج-تعديل-الحالة',
    headers: ['اسم الصنف', 'الحالة', 'الكود/الباركود'],
    colWidths: [{ wch: 36 }, { wch: 18 }, { wch: 24 }],
    textCols: [2]
  },
  image_url: {
    label: 'تعديل رابط الصورة',
    sheetName: 'تعديل رابط الصورة',
    fileSlug: 'نموذج-تعديل-رابط-الصورة',
    headers: ['اسم الصنف', 'رابط الصورة', 'الكود/الباركود'],
    colWidths: [{ wch: 34 }, { wch: 48 }, { wch: 24 }],
    textCols: [2]
  },
  add_items: {
    label: 'إضافة أصناف',
    sheetName: 'الأصناف',
    fileSlug: 'نموذج-إضافة-أصناف',
    headers: [
      'اسم الصنف',
      'اسم الطباعة',
      'الكمية',
      'التصنيف',
      'الباركود الرئيسي',
      'سعر البيع',
      'سعر الشراء',
      'وصف الصنف',
      'الوحدة',
      'الحد الأدنى للكمية',
      'المورد',
      'نسبة الضريبة',
      'الصورة'
    ],
    colWidths: [
      { wch: 32 },
      { wch: 28 },
      { wch: 14 },
      { wch: 24 },
      { wch: 22 },
      { wch: 14 },
      { wch: 14 },
      { wch: 34 },
      { wch: 14 },
      { wch: 18 },
      { wch: 24 },
      { wch: 14 },
      { wch: 26 }
    ],
    textCols: [4, 12]
  },
  add_categories: {
    label: 'إضافة تصنيفات بالإكسيل',
    sheetName: 'التصنيفات',
    fileSlug: 'نموذج-إضافة-تصنيفات',
    headers: ['التصنيف الرئيسي', 'التصنيف الفرعي'],
    colWidths: [{ wch: 32 }, { wch: 32 }],
    textCols: [0, 1]
  },
  delete_categories: {
    label: 'حذف التصنيفات بالإكسيل',
    sheetName: 'حذف التصنيفات',
    fileSlug: 'نموذج-حذف-التصنيفات',
    headers: ['اسم التصنيف'],
    colWidths: [{ wch: 42 }],
    textCols: [0]
  },
  delete_items: {
    label: 'حذف أصناف',
    sheetName: 'حذف أصناف',
    fileSlug: 'نموذج-حذف-أصناف',
    headers: ['اسم الصنف'],
    colWidths: [{ wch: 42 }],
    textCols: []
  }
};

export interface BulkEditSessionInfo {
  token?: string;
  id?: string;
  userId?: string;
  name?: string;
  phone?: string;
  role: UserRole;
  isOwner?: boolean;
  permissions: PermissionKey[];
}

export interface BulkEditParsedInputRow {
  rowNumber: number;
  name?: string;
  codeOrBarcode?: string;
  newPriceRaw?: unknown;
  values?: Record<string, unknown>;
}

function hasBulkEditExcelPermission(session?: BulkEditSessionInfo): boolean {
  return Boolean(
    session &&
      (session.role === 'designer' ||
        session.isOwner ||
        session.permissions?.includes('products.bulk_edit_excel'))
  );
}

function hasPurchasePricePermission(session?: BulkEditSessionInfo): boolean {
  return Boolean(
    session &&
      (session.role === 'designer' ||
        session.isOwner ||
        session.permissions?.includes('prices.view_purchase'))
  );
}

function hasPackagingCostPermission(session?: BulkEditSessionInfo): boolean {
  return Boolean(
    session &&
      (session.role === 'designer' ||
        session.isOwner ||
        session.permissions?.includes('prices.view_packaging'))
  );
}

function hasCreateItemsPermission(session?: BulkEditSessionInfo): boolean {
  return Boolean(
    session &&
      (session.role === 'designer' ||
        session.isOwner ||
        session.permissions?.includes('items.create'))
  );
}

function hasCategoriesManagePermission(session?: { role?: UserRole; isOwner?: boolean; permissions?: PermissionKey[] }): boolean {
  return Boolean(
    session &&
      (session.role === 'designer' ||
        (session.role as string) === 'owner' ||
        session.isOwner ||
        session.permissions?.includes('categories.manage') ||
        (session.permissions as any)?.includes('*'))
  );
}

function isCategoryActiveForImport(cat: ProductCategory): boolean {
  const st = String(cat.status || 'نشط').trim().toLowerCase();
  return st !== 'موقوف' && st !== 'inactive';
}

function resolveAddItemImportCategory(params: {
  rawCategoryInput: unknown;
  categories: ProductCategory[];
  canManageCategories: boolean;
}):
  | {
      ok: true;
      categoryId?: string;
      categoryName?: string;
      isNewRootCategory?: boolean;
      newRootCategoryName?: string;
      newRootNormName?: string;
    }
  | {
      ok: false;
      error: string;
    } {
  const rawCell = String(params.rawCategoryInput ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim();
  if (!rawCell) {
    return { ok: true, categoryId: undefined, categoryName: undefined, isNewRootCategory: false };
  }

  const activeCategories = params.categories.filter(isCategoryActiveForImport);
  const activeById = new Map(activeCategories.map(c => [c.id, c]));
  const eligibleCategories = activeCategories.filter(
    c => !c.parentCategoryId || activeById.has(c.parentCategoryId)
  );

  const exactMatches = eligibleCategories.filter(
    c => String(c.name ?? '').trim() === rawCell
  );
  const caseMatches = eligibleCategories.filter(
    c => String(c.name ?? '').trim().toLowerCase() === rawCell.toLowerCase()
  );
  const matchedCategories =
    caseMatches.length > 1
      ? caseMatches
      : exactMatches.length > 0
      ? exactMatches
      : caseMatches;

  if (matchedCategories.length > 1) {
    const allById = new Map(params.categories.map(c => [c.id, c]));
    const locations = matchedCategories
      .map(c => {
        if (!c.parentCategoryId) return `رئيسي «${c.name}»`;
        const parent = allById.get(c.parentCategoryId);
        return `فرعي «${c.name}» تحت «${parent ? parent.name : 'تصنيف رئيسي'}»`;
      })
      .join(' ، ');
    return {
      ok: false,
      error: `التصنيف غير محدد (ملتبس لوجود أكثر من تصنيف بنفس الاسم تحت آباء مختلفين: ${locations}): ${rawCell}`
    };
  }

  if (matchedCategories.length === 1) {
    const matched = matchedCategories[0];
    return {
      ok: true,
      categoryId: matched.id,
      categoryName: matched.name,
      isNewRootCategory: false
    };
  }

  const inactiveRootMatch = params.categories.find(
    c =>
      !c.parentCategoryId &&
      !isCategoryActiveForImport(c) &&
      String(c.name ?? '').trim().toLowerCase() === rawCell.toLowerCase()
  );
  if (inactiveRootMatch) {
    return {
      ok: false,
      error: `التصنيف "${rawCell}" موجود في النظام ولكنه موقوف/غير نشط ولا يمكن إنشاء نسخة مكررة منه`
    };
  }

  if (rawCell.length > 120) {
    return {
      ok: false,
      error: `اسم التصنيف الجديد طويل جداً (الحد الأقصى 120 حرفاً): ${rawCell}`
    };
  }

  if (!params.canManageCategories) {
    return {
      ok: false,
      error: `التصنيف "${rawCell}" غير موجود، ولا تملك صلاحية إنشاء تصنيفات جديدة [categories.manage]`
    };
  }

  return {
    ok: true,
    categoryId: undefined,
    categoryName: rawCell,
    isNewRootCategory: true,
    newRootCategoryName: rawCell,
    newRootNormName: rawCell.toLowerCase()
  };
}

function resolveSingleColumnImportCategory(params: {
  rawCategoryInput: string;
  rawLegacySubCategoryInput?: string;
  categories: ProductCategory[];
  canManageCategories: boolean;
}):
  | {
      ok: true;
      categoryId?: string;
      categoryName: string;
      isNewRootCategory: boolean;
      newRootCategoryName?: string;
      newRootNormName?: string;
    }
  | { ok: false; error: string } {
  const rawMain = String(params.rawCategoryInput ?? '').trim().replace(/\s+/g, ' ');
  const rawLegacySub = String(params.rawLegacySubCategoryInput ?? '').trim().replace(/\s+/g, ' ');

  if (!rawMain) {
    return { ok: false, error: 'خانة "التصنيف" الإلزامية فارغة' };
  }

  const activeCategories = params.categories.filter(isCategoryActiveForImport);
  const activeRoots = activeCategories.filter(c => !c.parentCategoryId);
  const activeRootsById = new Map(activeRoots.map(c => [c.id, c]));
  const activeSubs = activeCategories.filter(
    c => Boolean(c.parentCategoryId && activeRootsById.has(c.parentCategoryId))
  );

  // تحديد ما إذا كان الإدخال بصيغة «رئيسي / فرعي» أو جاء من ملف قديم فيه عمود «التصنيف الفرعي»
  let explicitRootRaw = '';
  let explicitSubRaw = '';
  if (rawLegacySub) {
    explicitRootRaw = rawMain;
    explicitSubRaw = rawLegacySub;
  } else if (rawMain.includes('/')) {
    const slashIdx = rawMain.indexOf('/');
    explicitRootRaw = rawMain.slice(0, slashIdx).trim().replace(/\s+/g, ' ');
    explicitSubRaw = rawMain.slice(slashIdx + 1).trim().replace(/\s+/g, ' ');
  }

  // (أ) لو النص بصيغة «رئيسي / فرعي» (أو ملف قديم فيه التصنيف الفرعي)
  if (explicitRootRaw && explicitSubRaw) {
    const normRoot = normalizeItemName(explicitRootRaw);
    const normSub = normalizeItemName(explicitSubRaw);
    const rootCat = activeRoots.find(c => normalizeItemName(c.name) === normRoot);
    if (!rootCat) {
      return {
        ok: false,
        error: `التصنيف الفرعي ${explicitSubRaw} غير موجود تحت ${explicitRootRaw}`
      };
    }
    const subCat = activeSubs.find(
      c => c.parentCategoryId === rootCat.id && normalizeItemName(c.name) === normSub
    );
    if (!subCat) {
      return {
        ok: false,
        error: `التصنيف الفرعي ${explicitSubRaw} غير موجود تحت ${rootCat.name}`
      };
    }
    return {
      ok: true,
      categoryId: subCat.id,
      categoryName: `${rootCat.name} / ${subCat.name}`,
      isNewRootCategory: false
    };
  }

  const singleName = explicitRootRaw || rawMain;
  const normSingle = normalizeItemName(singleName);
  if (!normSingle) {
    return { ok: false, error: 'خانة "التصنيف" الإلزامية فارغة' };
  }

  // (ب) لو الاسم يطابق تصنيف رئيسي <- الصنف يتحط في الرئيسي (ولو موجود كرئيسي وكفرعي، الرئيسي يكسب)
  const matchedRoot = activeRoots.find(c => normalizeItemName(c.name) === normSingle);
  if (matchedRoot) {
    return {
      ok: true,
      categoryId: matchedRoot.id,
      categoryName: matchedRoot.name,
      isNewRootCategory: false
    };
  }

  // (ج) و (د) فحص التصنيفات الفرعية النشطة
  const matchedSubs = activeSubs.filter(c => normalizeItemName(c.name) === normSingle);
  if (matchedSubs.length === 1) {
    const subCat = matchedSubs[0];
    const parentCat = activeRootsById.get(subCat.parentCategoryId!);
    return {
      ok: true,
      categoryId: subCat.id,
      categoryName: parentCat ? `${parentCat.name} / ${subCat.name}` : subCat.name,
      isNewRootCategory: false
    };
  }
  if (matchedSubs.length > 1) {
    return {
      ok: false,
      error: `التصنيف ${singleName} موجود تحت أكتر من تصنيف رئيسي. اكتبه بالشكل: الرئيسي / الفرعي`
    };
  }

  // (هـ) لو الاسم مش موجود خالص <- يتضاف تصنيف رئيسي جديد بالاسم ده (مع فحص صلاحية categories.manage)
  if (!params.canManageCategories) {
    return {
      ok: false,
      error: `التصنيف ${singleName} غير موجود، وليس لديك صلاحية إضافة تصنيفات`
    };
  }

  return {
    ok: true,
    categoryId: undefined,
    categoryName: singleName,
    isNewRootCategory: true,
    newRootCategoryName: singleName,
    newRootNormName: normSingle
  };
}

function hasDeleteItemsPermission(session?: BulkEditSessionInfo): boolean {
  return Boolean(
    session &&
      (session.role === 'designer' ||
        session.isOwner ||
        session.permissions?.includes('items.delete'))
  );
}

function validateBulkEditAccess(
  operationType: string | undefined,
  session?: BulkEditSessionInfo
): { ok: true; opType: BulkEditOperationType } | { ok: false; statusCode: number; error: string } {
  if (!hasBulkEditExcelPermission(session)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لحق الوصول أو صلاحية [products.bulk_edit_excel]'
    };
  }
  if (!operationType || !(VALID_BULK_EDIT_OPERATIONS as readonly string[]).includes(operationType)) {
    return {
      ok: false,
      statusCode: 400,
      error: 'نوع العملية غير صالح.'
    };
  }
  const opType = operationType as BulkEditOperationType;
  if (opType === 'purchase_price' && !hasPurchasePricePermission(session)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية عرض وتعديل سعر الشراء [prices.view_purchase]'
    };
  }
  if (opType === 'packaging_cost' && !hasPackagingCostPermission(session)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية عرض وتعديل تكلفة التغليف [prices.view_packaging]'
    };
  }
  if (opType === 'add_items' && !hasCreateItemsPermission(session)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية إضافة الأصناف [items.create]'
    };
  }
  if ((opType === 'add_categories' || opType === 'delete_categories') && !hasCategoriesManagePermission(session)) {
    return {
      ok: false,
      statusCode: 403,
      error:
        opType === 'delete_categories'
          ? 'غير مصرح: تفتقر لصلاحية إدارة وحذف التصنيفات [categories.manage]'
          : 'غير مصرح: تفتقر لصلاحية إدارة وإضافة التصنيفات [categories.manage]'
    };
  }
  if (opType === 'delete_items' && !hasDeleteItemsPermission(session)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية حذف الأصناف [items.delete]'
    };
  }
  return { ok: true, opType };
}

function normalizeBulkNumericString(raw: unknown): string {
  let s = String(raw ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.')
    .replace(/٬/g, '')
    .trim();

  if (s.includes('.')) {
    s = s.replace(/[,،]/g, '');
  } else {
    const commaMatches = s.match(/[,،]/g);
    if (commaMatches && commaMatches.length === 1) {
      s = s.replace(/[,،]/, '.');
    } else if (commaMatches && commaMatches.length > 1) {
      s = s.replace(/[,،]/g, '');
    }
  }
  return s;
}

export function isScientificNotationBarcode(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  const str = String(raw)
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.')
    .trim();
  if (!str) return false;
  return /^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(str);
}

function parseNonNegativeNumber(
  raw: unknown,
  fieldLabel: string,
  decimals = 2,
  maxValue?: number,
  allowNegative = false
): { valid: true; value: number } | { valid: false; reason: string } {
  if (raw === null || raw === undefined) {
    return { valid: false, reason: `${fieldLabel} مطلوب` };
  }
  if (typeof raw === 'boolean') {
    return { valid: false, reason: `قيمة ${fieldLabel} غير صالحة` };
  }

  let num: number;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { valid: false, reason: `قيمة ${fieldLabel} غير صالحة` };
    }
    num = raw;
  } else {
    const str = normalizeBulkNumericString(raw);
    if (!str) {
      return { valid: false, reason: `${fieldLabel} مطلوب` };
    }
    if (!/^-?\d+(\.\d+)?$/.test(str)) {
      return { valid: false, reason: `${fieldLabel} يجب أن يكون رقماً صالحاً` };
    }
    num = Number(str);
    if (!Number.isFinite(num)) {
      return { valid: false, reason: `قيمة ${fieldLabel} غير صالحة` };
    }
  }

  if (!allowNegative && num < 0) {
    return { valid: false, reason: `${fieldLabel} لا يمكن أن يكون سالباً` };
  }
  if (maxValue !== undefined && num > maxValue) {
    return { valid: false, reason: `${fieldLabel} يجب أن يكون بين 0 و ${maxValue}` };
  }

  const factor = Math.pow(10, decimals);
  return { valid: true, value: Math.round(num * factor) / factor };
}

function parseArabicBooleanCell(raw: unknown): { valid: true; value: boolean } | { valid: false; reason: string } {
  if (typeof raw === 'boolean') {
    return { valid: true, value: raw };
  }
  if (typeof raw === 'number') {
    if (raw === 1) return { valid: true, value: true };
    if (raw === 0) return { valid: true, value: false };
    return { valid: false, reason: 'قيمة تفعيل BNPL يجب أن تكون "نعم" أو "لا"' };
  }
  const str = String(raw ?? '').trim();
  if (!str) {
    return { valid: false, reason: 'قيمة تفعيل BNPL مطلوبة (نعم أو لا)' };
  }
  const norm = normalizeArabicText(str.toLowerCase());
  if (['نعم', 'مفعل', 'تفعيل', 'true', 'yes', 'y', '1', 'on'].includes(norm)) {
    return { valid: true, value: true };
  }
  if (['لا', 'غير مفعل', 'معطل', 'تعطيل', 'false', 'no', 'n', '0', 'off'].includes(norm)) {
    return { valid: true, value: false };
  }
  return { valid: false, reason: `قيمة تفعيل BNPL "${str}" غير صالحة (استخدم نعم أو لا)` };
}

function parseItemStatusCell(raw: unknown): { valid: true; value: 'نشط' | 'موقوف' | 'مؤرشف' } | { valid: false; reason: string } {
  const str = String(raw ?? '').trim();
  if (!str) {
    return { valid: false, reason: 'الحالة الجديدة مطلوبة (نشط / موقوف / مؤرشف)' };
  }
  const norm = normalizeArabicText(str.toLowerCase());
  if (['نشط', 'فعال', 'متاح', 'active'].includes(norm)) {
    return { valid: true, value: 'نشط' };
  }
  if (['موقوف', 'متوقف', 'معطل', 'غير نشط', 'inactive'].includes(norm)) {
    return { valid: true, value: 'موقوف' };
  }
  if (['مؤرشف', 'ارشيف', 'archived'].includes(norm)) {
    return { valid: true, value: 'مؤرشف' };
  }
  return { valid: false, reason: `الحالة "${str}" غير صالحة (القيم المسموحة: نشط، موقوف، مؤرشف)` };
}

function normalizeExistingItemStatus(status?: Item['status']): string {
  if (!status || status === 'active' || status === 'نشط') return 'نشط';
  if (status === 'inactive' || status === 'موقوف') return 'موقوف';
  if (status === 'مؤرشف') return 'مؤرشف';
  return String(status);
}

function isValidImageUrlCell(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  if (trimmed.startsWith('/')) return true;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) return true;
  return false;
}

function formatItemCategoryDisplay(item: Item): string {
  if (!item.categoryId) {
    return item.categoryName?.trim() || 'غير مصنف';
  }
  const cat = memoryCategories.find(c => c.id === item.categoryId);
  if (!cat) {
    return item.categoryName?.trim() || 'غير مصنف';
  }
  if (cat.parentCategoryId) {
    const parent = memoryCategories.find(p => p.id === cat.parentCategoryId);
    return parent ? `${parent.name} / ${cat.name}` : cat.name;
  }
  return cat.name;
}

function formatItemPlatformsDisplay(platformIds?: string[]): string {
  if (!Array.isArray(platformIds) || platformIds.length === 0) {
    return 'الكل';
  }
  const names = platformIds
    .map(pid => memoryPlatforms.find(p => p.id === pid)?.name || pid)
    .filter(Boolean);
  return names.length > 0 ? names.join('، ') : 'الكل';
}

function formatBarcodeSkuDisplay(barcode?: string, sku?: string, secondaryBarcodes?: string[]): string {
  const parts: string[] = [];
  if (barcode) parts.push(`باركود: ${barcode}`);
  if (sku) parts.push(`SKU: ${sku}`);
  if (secondaryBarcodes && secondaryBarcodes.length > 0) {
    parts.push(`فرعي: ${secondaryBarcodes.join('، ')}`);
  }
  return parts.length > 0 ? parts.join(' | ') : 'بدون أكواد';
}

function normalizeExcelHeaderLabel(raw: unknown): string {
  return normalizeArabicText(String(raw ?? '').trim().replace(/\s+/g, ' '));
}

function findColumnIndex(headerRow: string[], aliases: string[], excludeIndices: Set<number> = new Set()): number {
  const normAliases = aliases.map(normalizeExcelHeaderLabel);
  for (const alias of normAliases) {
    const idx = headerRow.findIndex((h, i) => !excludeIndices.has(i) && h === alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

function isCellEmpty(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  const cleaned = String(val)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00A0]/g, '')
    .trim();
  return cleaned === '';
}

function decodeCsvBufferForBulkEdit(buf: Buffer): string {
  const hasUtf8Bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const payload = hasUtf8Bom ? buf.subarray(3) : buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(payload);
  } catch {
    try {
      return new TextDecoder('windows-1256').decode(payload);
    } catch {
      return payload.toString('utf8');
    }
  }
}

function extractRowsFromBulkEditXlsxBuffer(
  xlsxBuffer: Buffer,
  operationType: BulkEditOperationType,
  fileName?: string
): { ok: true; rows: BulkEditParsedInputRow[]; headers: unknown[] } | { ok: false; statusCode: number; error: string } {
  const lowerName = String(fileName || '').trim().toLowerCase();
  const isCsvExt = lowerName.endsWith('.csv');

  let wb: XLSX.WorkBook;
  try {
    if (isCsvExt) {
      const csvText = decodeCsvBufferForBulkEdit(xlsxBuffer);
      wb = XLSX.read(csvText, { type: 'string', raw: true });
    } else {
      wb = XLSX.read(xlsxBuffer, { type: 'buffer', raw: true });
    }
  } catch {
    return {
      ok: false,
      statusCode: 400,
      error: 'تعذر قراءة ملف الإكسيل. تأكد من رفع ملف بصيغة ‎.xlsx‎ أو ‎.xls‎ أو ‎.csv‎ صالحة.'
    };
  }

  let sheetName: string | undefined;
  if (operationType === 'add_items' && Array.isArray(wb.SheetNames) && wb.SheetNames.length > 0) {
    const targetNorm = normalizeExcelHeaderLabel('الأصناف');
    sheetName =
      wb.SheetNames.find(sn => normalizeExcelHeaderLabel(sn) === targetNorm) ||
      wb.SheetNames[0];
  } else if (operationType === 'add_categories' && Array.isArray(wb.SheetNames) && wb.SheetNames.length > 0) {
    const targetNorm = normalizeExcelHeaderLabel('التصنيفات');
    sheetName =
      wb.SheetNames.find(sn => normalizeExcelHeaderLabel(sn) === targetNorm) ||
      wb.SheetNames[0];
  } else if (operationType === 'delete_categories' && Array.isArray(wb.SheetNames) && wb.SheetNames.length > 0) {
    const targetDelNorm = normalizeExcelHeaderLabel('حذف التصنيفات');
    const targetCatNorm = normalizeExcelHeaderLabel('التصنيفات');
    sheetName =
      wb.SheetNames.find(sn => normalizeExcelHeaderLabel(sn) === targetDelNorm) ||
      wb.SheetNames.find(sn => normalizeExcelHeaderLabel(sn) === targetCatNorm) ||
      wb.SheetNames[0];
  } else {
    sheetName = wb.SheetNames?.[0];
  }
  if (!sheetName || !wb.Sheets[sheetName]) {
    return {
      ok: false,
      statusCode: 400,
      error: 'ملف الإكسيل لا يحتوي على أي ورقة عمل.'
    };
  }

  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: true });
  if (!Array.isArray(aoa) || aoa.length === 0) {
    return {
      ok: false,
      statusCode: 400,
      error: 'ملف الإكسيل فارغ ولا يحتوي على بيانات.'
    };
  }

  const headerRow = (aoa[0] || []).map(h => normalizeExcelHeaderLabel(h));
  const usedCols = new Set<number>();

  // عمود الكود/الباركود المخصص للمطابقة (غير مستخدم في الإضافة أو الحذف بالاسم أو عمليات التصنيفات)
  let codeColIdx = -1;
  if (
    operationType !== 'add_items' &&
    operationType !== 'add_categories' &&
    operationType !== 'delete_categories' &&
    operationType !== 'delete_items'
  ) {
    const lookupCodeAliases =
      operationType === 'barcode_sku'
        ? ['الكود/الباركود', 'الكود / الباركود', 'الكود أو الباركود', 'الكود او الباركود', 'الكود الحالي/الباركود']
        : operationType === 'primary_barcode' || operationType === 'add_secondary_barcode'
        ? [
            'الكود',
            'كود الصنف',
            'كود SKU',
            'SKU',
            'الكود/الباركود',
            'الكود / الباركود',
            'الكود أو الباركود',
            'الكود او الباركود',
            'الكود الحالي/الباركود'
          ]
        : [
            'الكود/الباركود',
            'الكود / الباركود',
            'الكود أو الباركود',
            'الكود او الباركود',
            'الكود',
            'الباركود',
            'كود SKU',
            'الباركود الأساسي'
          ];
    codeColIdx = findColumnIndex(headerRow, lookupCodeAliases);
    if (codeColIdx >= 0) usedCols.add(codeColIdx);
  }

  // عمود اسم الصنف (غير مستخدم في عمليات التصنيفات)
  let nameColIdx = -1;
  if (operationType !== 'add_categories' && operationType !== 'delete_categories') {
    const nameAliases =
      operationType === 'name'
        ? ['الاسم الحالي', 'اسم الصنف الحالي', 'اسم الصنف', 'اسم المنتج', 'الاسم']
        : ['اسم الصنف', 'اسم المنتج', 'الاسم'];
    nameColIdx = findColumnIndex(headerRow, nameAliases, usedCols);
    if (nameColIdx >= 0) usedCols.add(nameColIdx);
  }

  if (operationType === 'delete_items') {
    if (nameColIdx === -1) {
      return {
        ok: false,
        statusCode: 400,
        error: 'لم يتم العثور على عمود "اسم الصنف" في الصف الأول من الملف. يرجى استخدام نموذج الإكسيل المعتمد.'
      };
    }
  } else if (
    operationType !== 'add_items' &&
    operationType !== 'add_categories' &&
    operationType !== 'delete_categories' &&
    nameColIdx === -1 &&
    codeColIdx === -1
  ) {
    const expectedNameCol = operationType === 'name' ? 'الاسم الحالي' : 'اسم الصنف';
    return {
      ok: false,
      statusCode: 400,
      error: `لم يتم العثور على عمود "${expectedNameCol}" في الصف الأول من الملف. يرجى استخدام نموذج الإكسيل المعتمد.`
    };
  }

  // تعيين أعمدة القيم حسب نوع العملية
  const fieldCols: Record<string, number> = {};
  const missingColumnError = (colLabel: string) => ({
    ok: false as const,
    statusCode: 400,
    error: `لم يتم العثور على عمود "${colLabel}" في الملف. تأكد من مطابقة نوع العملية المختار مع أعمدة الملف.`
  });

  switch (operationType) {
    case 'sale_price': {
      const idx = findColumnIndex(headerRow, ['سعر البيع', 'السعر'], usedCols);
      if (idx === -1) return missingColumnError('سعر البيع');
      fieldCols.primary = idx;
      break;
    }
    case 'purchase_price': {
      const idx = findColumnIndex(headerRow, ['سعر الشراء'], usedCols);
      if (idx === -1) return missingColumnError('سعر الشراء');
      fieldCols.primary = idx;
      break;
    }
    case 'primary_barcode': {
      const idx = findColumnIndex(
        headerRow,
        ['الباركود الجديد', 'الباركود الرئيسي', 'الباركود الأساسي', 'الباركود الرئيسي الجديد', 'الباركود'],
        usedCols
      );
      if (idx === -1) return missingColumnError('الباركود الجديد');
      fieldCols.barcode = idx;
      break;
    }
    case 'add_secondary_barcode': {
      const idx = findColumnIndex(
        headerRow,
        ['الباركود المضاف', 'الباركود الفرعي', 'باركود فرعي', 'الباركود الإضافي', 'الباركود الجديد', 'الباركود'],
        usedCols
      );
      if (idx === -1) return missingColumnError('الباركود المضاف');
      fieldCols.barcode = idx;
      break;
    }
    case 'stock_quantity': {
      const idx = findColumnIndex(
        headerRow,
        ['الكمية', 'الكمية الجديدة', 'الرصيد الجديد', 'الكمية بالمخزن', 'الرصيد'],
        usedCols
      );
      if (idx === -1) return missingColumnError('الكمية');
      fieldCols.quantity = idx;
      usedCols.add(idx);
      const reasonIdx = findColumnIndex(headerRow, ['سبب التسوية', 'السبب', 'ملاحظات'], usedCols);
      if (reasonIdx >= 0) fieldCols.reason = reasonIdx;
      break;
    }
    case 'name': {
      const idx = findColumnIndex(headerRow, ['الاسم الجديد', 'اسم الصنف الجديد'], usedCols);
      if (idx === -1) return missingColumnError('الاسم الجديد');
      fieldCols.newName = idx;
      break;
    }
    case 'print_name': {
      const idx = findColumnIndex(headerRow, ['اسم الطباعة', 'اسم الطباعة الجديد', 'الاسم المطبوع', 'اسم الفاتورة'], usedCols);
      if (idx === -1) return missingColumnError('اسم الطباعة');
      fieldCols.printName = idx;
      break;
    }
    case 'barcode_sku': {
      const bcIdx = findColumnIndex(headerRow, ['الباركود الأساسي', 'الباركود'], usedCols);
      if (bcIdx >= 0) {
        fieldCols.barcode = bcIdx;
        usedCols.add(bcIdx);
      }
      const skuIdx = findColumnIndex(headerRow, ['كود SKU', 'كود الصنف', 'الكود', 'SKU'], usedCols);
      if (skuIdx >= 0) {
        fieldCols.sku = skuIdx;
        usedCols.add(skuIdx);
      }
      const secIdx = findColumnIndex(
        headerRow,
        ['باركودات فرعية (مفصولة بفواصل)', 'باركودات فرعية', 'الباركودات الفرعية'],
        usedCols
      );
      if (secIdx >= 0) {
        fieldCols.secondaryBarcodes = secIdx;
        usedCols.add(secIdx);
      }
      if (bcIdx === -1 && skuIdx === -1 && secIdx === -1) {
        return missingColumnError('الباركود الأساسي أو كود SKU');
      }
      break;
    }
    case 'notes': {
      const idx = findColumnIndex(headerRow, ['الوصف', 'وصف الصنف', 'ملاحظات'], usedCols);
      if (idx === -1) return missingColumnError('الوصف');
      fieldCols.notes = idx;
      break;
    }
    case 'category': {
      const rootIdx = findColumnIndex(headerRow, ['التصنيف', 'التصنيف الرئيسي'], usedCols);
      if (rootIdx === -1) return missingColumnError('التصنيف');
      fieldCols.rootCategory = rootIdx;
      usedCols.add(rootIdx);
      const subIdx = findColumnIndex(headerRow, ['التصنيف الفرعي'], usedCols);
      if (subIdx >= 0) fieldCols.subCategory = subIdx;
      break;
    }
    case 'platforms': {
      const idx = findColumnIndex(headerRow, ['المنصات المرتبطة', 'المنصات', 'المنصة'], usedCols);
      if (idx === -1) return missingColumnError('المنصات المرتبطة');
      fieldCols.platforms = idx;
      break;
    }
    case 'bnpl': {
      const enableIdx = findColumnIndex(headerRow, ['تفعيل BNPL', 'تفعيل التقسيط', 'BNPL'], usedCols);
      if (enableIdx === -1) return missingColumnError('تفعيل BNPL');
      fieldCols.enableBnpl = enableIdx;
      usedCols.add(enableIdx);
      const pctIdx = findColumnIndex(
        headerRow,
        ['نسبة BNPL %', 'نسبة BNPL', 'نسبة التقسيط %', 'نسبة التقسيط'],
        usedCols
      );
      if (pctIdx === -1) return missingColumnError('نسبة BNPL %');
      fieldCols.bnplPercentage = pctIdx;
      break;
    }
    case 'pickup_fee': {
      const idx = findColumnIndex(headerRow, ['رسوم الالتقاط', 'رسوم الالتقاط للقطعة'], usedCols);
      if (idx === -1) return missingColumnError('رسوم الالتقاط');
      fieldCols.primary = idx;
      break;
    }
    case 'min_price': {
      const idx = findColumnIndex(headerRow, ['الحد الأدنى لسعر البيع', 'الحد الأدنى للسعر', 'الحد الأدنى'], usedCols);
      if (idx === -1) return missingColumnError('الحد الأدنى لسعر البيع');
      fieldCols.primary = idx;
      break;
    }
    case 'packaging_cost': {
      const idx = findColumnIndex(headerRow, ['تكلفة التغليف'], usedCols);
      if (idx === -1) return missingColumnError('تكلفة التغليف');
      fieldCols.primary = idx;
      break;
    }
    case 'tax_rate': {
      const idx = findColumnIndex(headerRow, ['نسبة الضريبة %', 'نسبة الضريبة', 'الضريبة'], usedCols);
      if (idx === -1) return missingColumnError('نسبة الضريبة %');
      fieldCols.primary = idx;
      break;
    }
    case 'reorder_limit': {
      const idx = findColumnIndex(
        headerRow,
        ['الحد الأدنى', 'الحد الأدنى للكمية', 'حد إعادة الطلب', 'الحد الأدنى للمخزون'],
        usedCols
      );
      if (idx === -1) return missingColumnError('الحد الأدنى');
      fieldCols.primary = idx;
      break;
    }
    case 'supplier': {
      const idx = findColumnIndex(headerRow, ['المورد', 'اسم المورد', 'المورد الافتراضي'], usedCols);
      if (idx === -1) return missingColumnError('المورد');
      fieldCols.supplier = idx;
      break;
    }
    case 'unit': {
      const idx = findColumnIndex(headerRow, ['الوحدة', 'وحدة القياس'], usedCols);
      if (idx === -1) return missingColumnError('الوحدة');
      fieldCols.unit = idx;
      break;
    }
    case 'status': {
      const idx = findColumnIndex(headerRow, ['الحالة', 'حالة الصنف'], usedCols);
      if (idx === -1) return missingColumnError('الحالة');
      fieldCols.status = idx;
      break;
    }
    case 'image_url': {
      const idx = findColumnIndex(headerRow, ['رابط الصورة', 'الصورة'], usedCols);
      if (idx === -1) return missingColumnError('رابط الصورة');
      fieldCols.imageUrl = idx;
      break;
    }
    case 'add_items': {
      const missingMandatoryCols: string[] = [];
      if (nameColIdx === -1) {
        missingMandatoryCols.push('اسم الصنف');
      }
      const mapMandatory = (key: string, label: string, aliases: string[]) => {
        const idx = findColumnIndex(headerRow, aliases, usedCols);
        if (idx === -1) {
          missingMandatoryCols.push(label);
        } else {
          fieldCols[key] = idx;
          usedCols.add(idx);
        }
      };
      mapMandatory('barcode', 'الباركود الرئيسي', ['الباركود الرئيسي', 'الباركود الأساسي', 'الباركود']);

      if (missingMandatoryCols.length > 0) {
        return {
          ok: false,
          statusCode: 400,
          error: `الملف ناقص عمود: ${missingMandatoryCols.join('، ')} — نزّل النموذج الجديد`
        };
      }

      const mapOptional = (key: string, aliases: string[]) => {
        const idx = findColumnIndex(headerRow, aliases, usedCols);
        if (idx >= 0) {
          fieldCols[key] = idx;
          usedCols.add(idx);
        }
        return idx;
      };
      mapOptional('printName', ['اسم الطباعة', 'الاسم المطبوع', 'اسم الفاتورة']);
      mapOptional('stockQuantity', [
        'الكمية',
        'الكمية الجديدة',
        'الكمية بالمخزن',
        'الكمية الافتتاحية',
        'الرصيد الافتتاحي',
        'الرصيد'
      ]);
      mapOptional('rootCategory', ['التصنيف', 'التصنيف الرئيسي']);
      mapOptional('salePrice', ['سعر البيع', 'السعر']);
      mapOptional('purchasePrice', ['سعر الشراء']);
      mapOptional('notes', ['وصف الصنف', 'الوصف', 'ملاحظات', 'الملاحظات']);
      mapOptional('unit', ['الوحدة', 'وحدة القياس']);
      mapOptional('reorderLimit', ['الحد الأدنى للكمية', 'حد إعادة الطلب', 'الحد الأدنى للمخزون', 'الحد الأدنى']);
      mapOptional('supplier', ['المورد', 'اسم المورد', 'المورد الافتراضي']);
      mapOptional('taxRate', ['نسبة الضريبة', 'نسبة الضريبة %', 'الضريبة']);
      mapOptional('sku', ['كود SKU', 'كود الصنف', 'الكود', 'SKU']);
      mapOptional('secondaryBarcodes', ['باركودات فرعية (مفصولة بفواصل)', 'باركودات فرعية', 'الباركودات الفرعية']);
      mapOptional('minPrice', ['الحد الأدنى لسعر البيع', 'الحد الأدنى للسعر']);
      mapOptional('packagingCost', ['تكلفة التغليف']);
      mapOptional('pickupFee', ['رسوم الالتقاط', 'رسوم الالتقاط للقطعة']);
      mapOptional('enableBnpl', ['تفعيل BNPL', 'تفعيل التقسيط', 'BNPL']);
      mapOptional('bnplPercentage', ['نسبة BNPL %', 'نسبة BNPL', 'نسبة التقسيط %', 'نسبة التقسيط']);
      mapOptional('platforms', ['المنصات المرتبطة', 'المنصات', 'المنصة']);
      mapOptional('status', ['الحالة', 'حالة الصنف']);
      // عمود «الصورة» في «إضافة أصناف» = اسم ملف صورة جوه الملف المضغوط أو صورة جوه الخانة (الشاشة بترفعها بعد الحفظ)، مش رابط
      mapOptional('imageUrl', ['رابط الصورة']);
      break;
    }
    case 'add_categories': {
      const mainIdx = findColumnIndex(headerRow, ['التصنيف الرئيسي'], usedCols);
      if (mainIdx === -1) {
        return {
          ok: false,
          statusCode: 400,
          error: 'الملف ناقص عمود: «التصنيف الرئيسي» — يرجى تحميل نموذج إضافة التصنيفات بالإكسيل.'
        };
      }
      fieldCols.mainCategory = mainIdx;
      usedCols.add(mainIdx);

      const subIdx = findColumnIndex(headerRow, ['التصنيف الفرعي'], usedCols);
      if (subIdx === -1) {
        return {
          ok: false,
          statusCode: 400,
          error: 'الملف ناقص عمود: «التصنيف الفرعي» — يرجى تحميل نموذج إضافة التصنيفات بالإكسيل.'
        };
      }
      fieldCols.subCategory = subIdx;
      usedCols.add(subIdx);
      break;
    }
    case 'delete_categories': {
      const catIdx = findColumnIndex(headerRow, ['اسم التصنيف'], usedCols);
      if (catIdx === -1) {
        return {
          ok: false,
          statusCode: 400,
          error: 'لم يتم العثور على عمود «اسم التصنيف» في الصف الأول من الملف — يرجى تحميل نموذج حذف التصنيفات بالإكسيل.'
        };
      }
      fieldCols.categoryName = catIdx;
      usedCols.add(catIdx);
      break;
    }
    case 'delete_items': {
      // عمود الاسم فقط
      break;
    }
  }

  const reasonHeaderNorm = normalizeExcelHeaderLabel('السبب');
  if (operationType === 'delete_categories') {
    const extraHeaderLabels: string[] = [];
    for (let c = 0; c < headerRow.length; c++) {
      if (usedCols.has(c)) continue;
      if (!headerRow[c] || headerRow[c] === reasonHeaderNorm) continue;
      extraHeaderLabels.push(String((aoa[0] || [])[c] ?? '').trim());
    }
    if (extraHeaderLabels.length > 0) {
      return {
        ok: false,
        statusCode: 400,
        error: `ورقة البيانات في قالب حذف التصنيفات تحتوي على عمود واحد فقط بعنوان «اسم التصنيف» (تم العثور على أعمدة إضافية: ${extraHeaderLabels.join('، ')}).`
      };
    }
  }

  const extraCategoryColIndices: number[] = [];
  if (operationType === 'add_categories' || operationType === 'delete_categories') {
    const maxCols = Math.max(headerRow.length, ...aoa.slice(0, Math.min(aoa.length, 50)).map(row => (Array.isArray(row) ? row.length : 0)));
    for (let c = 0; c < maxCols; c++) {
      if (usedCols.has(c)) continue;
      if (headerRow[c] && headerRow[c] === reasonHeaderNorm) continue;
      extraCategoryColIndices.push(c);
    }
  }

  const fieldEntries = Object.entries(fieldCols);
  const parsedRows: BulkEditParsedInputRow[] = [];

  for (let r = 1; r < aoa.length; r++) {
    const rowArr = aoa[r] || [];
    const nameVal = nameColIdx >= 0 ? rowArr[nameColIdx] : '';
    const codeVal = codeColIdx >= 0 ? rowArr[codeColIdx] : '';
    const nameStr = String(nameVal ?? '').trim();
    const codeStr = String(codeVal ?? '').trim();

    const values: Record<string, unknown> = {};
    let allFieldsEmpty = true;
    for (const [key, colIdx] of fieldEntries) {
      let v = rowArr[colIdx];
      // إذا كانت خلية الباركود في إكسيل بصيغة علمية رقمية، نحتفظ بالنص المنسق لكشف الصيغة العلمية ورفضها
      if (key === 'barcode' || key === 'secondaryBarcodes') {
        const cellObj = ws[XLSX.utils.encode_cell({ r, c: colIdx })];
        if (cellObj && cellObj.t === 'n') {
          if (
            (typeof cellObj.w === 'string' && /e[+-]?\d+/i.test(cellObj.w)) ||
            (typeof cellObj.z === 'string' && /e[+-]/i.test(cellObj.z))
          ) {
            v = cellObj.w || String(cellObj.v);
          }
        }
      }
      values[key] = v;
      if (!isCellEmpty(v)) {
        allFieldsEmpty = false;
      }
    }

    if (operationType === 'add_categories' || operationType === 'delete_categories') {
      const extraNonEmpty: string[] = [];
      for (const cIdx of extraCategoryColIndices) {
        const extraVal = rowArr[cIdx];
        if (!isCellEmpty(extraVal)) {
          extraNonEmpty.push(String(extraVal).trim());
        }
      }
      if (extraNonEmpty.length > 0) {
        values.extraLevelValue = extraNonEmpty.join(' | ');
        allFieldsEmpty = false;
      }
    }

    if (!nameStr && !codeStr && allFieldsEmpty) {
      continue;
    }

    parsedRows.push({
      rowNumber: r + 1,
      name:
        operationType === 'add_categories'
          ? String(values.mainCategory ?? '').trim()
          : operationType === 'delete_categories'
          ? String(values.categoryName ?? '').trim()
          : nameStr,
      codeOrBarcode: codeStr,
      newPriceRaw: values.primary,
      values
    });

    if (parsedRows.length > BULK_EDIT_EXCEL_MAX_ROWS) {
      return {
        ok: false,
        statusCode: 400,
        error: `تم تجاوز الحد الأقصى المسموح به (${BULK_EDIT_EXCEL_MAX_ROWS} صف كحد أقصى في الملف الواحد).`
      };
    }
  }

  if (parsedRows.length === 0) {
    return {
      ok: false,
      statusCode: 400,
      error:
        operationType === 'add_categories'
          ? 'الملف لا يحتوي على أي صفوف بيانات. يرجى تعبئة بيانات التصنيفات تحت صف العناوين.'
          : operationType === 'delete_categories'
          ? 'الملف لا يحتوي على أي صفوف بيانات. يرجى تعبئة أسماء التصنيفات المراد حذفها تحت صف العناوين.'
          : 'الملف لا يحتوي على أي صفوف بيانات. يرجى تعبئة بيانات الأصناف تحت صف العناوين.'
    };
  }

  return { ok: true, rows: parsedRows, headers: aoa[0] || [] };
}

type EvaluatedRowActionPayload =
  | { kind: 'number_field'; newValue: number }
  | { kind: 'stock_quantity'; newQuantity: number; reason?: string }
  | { kind: 'primary_barcode'; barcode: string }
  | { kind: 'add_secondary_barcode'; barcode: string }
  | { kind: 'name'; newName: string; normNewName: string }
  | { kind: 'print_name'; printName: string }
  | { kind: 'barcode_sku'; barcode: string; sku: string; secondaryBarcodes: string[] }
  | { kind: 'notes'; notes: string }
  | {
      kind: 'category';
      categoryId?: string;
      categoryName: string;
      isNewRootCategory?: boolean;
      newRootCategoryName?: string;
      newRootNormName?: string;
    }
  | { kind: 'platforms'; platformIds: string[] }
  | { kind: 'bnpl'; enableBnpl: boolean; bnplPercentage: number }
  | { kind: 'supplier'; supplier: string }
  | { kind: 'unit'; unit: string }
  | { kind: 'status'; status: 'نشط' | 'موقوف' | 'مؤرشف' }
  | { kind: 'image_url'; imageUrl: string }
  | {
      kind: 'add_item';
      itemData: {
        name: string;
        printName?: string;
        sku?: string;
        barcode?: string;
        secondaryBarcodes?: string[];
        notes: string;
        categoryId?: string;
        categoryName?: string;
        isNewRootCategory?: boolean;
        newRootCategoryName?: string;
        newRootNormName?: string;
        salePrice: number;
        minPrice?: number;
        purchasePrice: number;
        packagingCost: number;
        taxRate: number;
        pickupFee?: number;
        enableBnpl: boolean;
        bnplPercentage: number;
        stockQuantity: number;
        reorderLimit: number;
        platformIds: string[];
        supplier?: string;
        unit: string;
        status: 'نشط' | 'موقوف' | 'مؤرشف';
        imageUrl: string;
      };
    }
  | {
      kind: 'add_category';
      mainName: string;
      normMain: string;
      existingRootId?: string;
      subName?: string;
      normSub?: string;
    }
  | {
      kind: 'delete_category';
      categoryId: string;
      categoryName: string;
    }
  | { kind: 'delete_item' };

function flattenCategoriesList(treeOrFlat: ProductCategory[]): ProductCategory[] {
  const result: ProductCategory[] = [];
  const seen = new Set<string>();
  const visit = (list?: ProductCategory[]) => {
    if (!Array.isArray(list)) return;
    for (const cat of list) {
      if (!cat || !cat.id || seen.has(cat.id)) continue;
      seen.add(cat.id);
      result.push(cat);
      if (Array.isArray(cat.subcategories) && cat.subcategories.length > 0) {
        visit(cat.subcategories);
      }
    }
  };
  visit(treeOrFlat);
  return result;
}

function cleanCategoryImportCell(val: unknown): string {
  return String(val ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function evaluateAddCategoriesRows(
  inputRows: BulkEditParsedInputRow[],
  existingCategories: ProductCategory[]
) {
  const MAX_CATEGORY_NAME_LEN = 120;
  const isCategoryInactive = (c: ProductCategory): boolean => {
    const st = String(c.status || 'نشط').trim().toLowerCase();
    return st === 'معطل' || st === 'موقوف' || st === 'inactive';
  };

  const existingRoots = existingCategories.filter(c => !c.parentCategoryId);
  const existingSubs = existingCategories.filter(c => Boolean(c.parentCategoryId));

  const rootsByNorm = new Map<string, ProductCategory[]>();
  for (const r of existingRoots) {
    const k = normalizeItemName(r.name);
    if (!k) continue;
    const list = rootsByNorm.get(k) || [];
    list.push(r);
    rootsByNorm.set(k, list);
  }

  const subsByParentId = new Map<string, ProductCategory[]>();
  const subsByNorm = new Map<string, ProductCategory[]>();
  for (const s of existingSubs) {
    if (s.parentCategoryId) {
      const pList = subsByParentId.get(s.parentCategoryId) || [];
      pList.push(s);
      subsByParentId.set(s.parentCategoryId, pList);
    }
    const k = normalizeItemName(s.name);
    if (k) {
      const nList = subsByNorm.get(k) || [];
      nList.push(s);
      subsByNorm.set(k, nList);
    }
  }

  // فحص مسبق لاكتشاف السلاسل متعددة المستويات داخل نفس الملف (مثلاً صف: أ -> ب وصف آخر: ب -> ج)
  const fileMainRowsByNorm = new Map<string, number[]>();
  const fileSubRowsByNorm = new Map<string, number[]>();
  for (const rawRow of inputRows) {
    const values = rawRow.values || {};
    const mName = cleanCategoryImportCell(values.mainCategory ?? rawRow.name);
    const sName = cleanCategoryImportCell(values.subCategory);
    if (mName) {
      const nm = normalizeItemName(mName);
      if (nm) {
        const arr = fileMainRowsByNorm.get(nm) || [];
        arr.push(rawRow.rowNumber);
        fileMainRowsByNorm.set(nm, arr);
      }
    }
    if (sName) {
      const ns = normalizeItemName(sName);
      if (ns) {
        const arr = fileSubRowsByNorm.get(ns) || [];
        arr.push(rawRow.rowNumber);
        fileSubRowsByNorm.set(ns, arr);
      }
    }
  }

  const chainedLevelNorms = new Set<string>();
  for (const [normKey, mRows] of fileMainRowsByNorm.entries()) {
    const sRows = fileSubRowsByNorm.get(normKey);
    if (sRows && sRows.length > 0 && mRows.length > 0) {
      // اسم ورد كتصنيف رئيسي في صف وكفرعي في صف آخر (علاقة غير واضحة / محاولة أكثر من مستويين)
      const hasDistinctRows = mRows.some(mr => sRows.some(sr => sr !== mr));
      if (hasDistinctRows) {
        chainedLevelNorms.add(normKey);
      }
    }
  }

  const plannedNewRootsByNorm = new Map<string, { name: string; firstRowNumber: number }>();
  const reusedExistingRootIds = new Set<string>();
  const plannedRootSeenInAnyValidRow = new Map<string, number>();
  const plannedSubsByPair = new Map<string, number>();

  let newSubsCount = 0;
  let existingDuplicatesCount = 0;
  let intraFileDuplicatesCount = 0;

  const finalRows: Array<{
    rowNumber: number;
    itemId: string | undefined;
    itemName: string;
    inputName: string;
    codeOrBarcode: string | undefined;
    matchedBy: 'code_barcode' | 'name' | undefined;
    currentPrice: number | null;
    newPrice: number | null;
    currentValueDisplay: string;
    newValueDisplay: string;
    status: 'will_update' | 'unchanged' | 'error';
    reason: string | undefined;
    warning: string | undefined;
    rawValues: Record<string, any>;
    mainCategoryName?: string;
    subCategoryName?: string;
    categoryAction?: BulkEditCategoryRowAction;
    _actionPayload: EvaluatedRowActionPayload | undefined;
  }> = [];

  for (const rawRow of inputRows) {
    const values = rawRow.values || {};
    const mainName = cleanCategoryImportCell(values.mainCategory ?? rawRow.name);
    const subName = cleanCategoryImportCell(values.subCategory);
    const extraLevelValue = cleanCategoryImportCell(values.extraLevelValue);
    const normMain = normalizeItemName(mainName);
    const normSub = normalizeItemName(subName);

    const rawValues: Record<string, any> = {
      'التصنيف الرئيسي': mainName,
      'التصنيف الفرعي': subName
    };

    const pushRow = (opts: {
      status: 'will_update' | 'unchanged' | 'error';
      currentValueDisplay: string;
      newValueDisplay: string;
      reason?: string;
      categoryAction: BulkEditCategoryRowAction;
      actionPayload?: EvaluatedRowActionPayload;
      displayMainName?: string;
    }) => {
      const mDisp = opts.displayMainName || mainName;
      finalRows.push({
        rowNumber: rawRow.rowNumber,
        itemId: undefined,
        itemName: subName ? `${mDisp || 'بدون رئيسي'} / ${subName}` : mDisp || 'بدون اسم',
        inputName: mainName,
        codeOrBarcode: undefined,
        matchedBy: undefined,
        currentPrice: null,
        newPrice: null,
        currentValueDisplay: opts.currentValueDisplay,
        newValueDisplay: opts.newValueDisplay,
        status: opts.status,
        reason: opts.reason,
        warning: undefined,
        rawValues,
        mainCategoryName: mDisp,
        subCategoryName: subName,
        categoryAction: opts.categoryAction,
        _actionPayload: opts.status === 'will_update' ? opts.actionPayload : undefined
      });
    };

    // 1. التحقق من عدم وجود أعمدة إضافية (أكثر من مستويين)
    if (extraLevelValue) {
      pushRow({
        status: 'error',
        currentValueDisplay: 'غير صالح',
        newValueDisplay: '—',
        reason: 'القالب يدعم مستويين فقط (التصنيف الرئيسي والتصنيف الفرعي) — تم العثور على بيانات في عمود إضافي',
        categoryAction: 'error'
      });
      continue;
    }

    // 2. التحقق من خلو التصنيف الرئيسي أو وجود فرعي بلا رئيسي
    if (!mainName || !normMain) {
      pushRow({
        status: 'error',
        currentValueDisplay: 'غير صالح',
        newValueDisplay: '—',
        reason: subName
          ? `فرعي بلا رئيسي: لا يمكن إضافة التصنيف الفرعي "${subName}" بدون تحديد التصنيف الرئيسي`
          : 'التصنيف الرئيسي فارغ ومطلوب',
        categoryAction: 'error'
      });
      continue;
    }

    // 3. التحقق من طول الاسم
    if (mainName.length > MAX_CATEGORY_NAME_LEN) {
      pushRow({
        status: 'error',
        currentValueDisplay: 'غير صالح',
        newValueDisplay: '—',
        reason: `اسم التصنيف الرئيسي طويل جداً (الحد الأقصى ${MAX_CATEGORY_NAME_LEN} حرفاً)`,
        categoryAction: 'error'
      });
      continue;
    }
    if (subName.length > MAX_CATEGORY_NAME_LEN) {
      pushRow({
        status: 'error',
        currentValueDisplay: 'غير صالح',
        newValueDisplay: '—',
        reason: `اسم التصنيف الفرعي طويل جداً (الحد الأقصى ${MAX_CATEGORY_NAME_LEN} حرفاً)`,
        categoryAction: 'error'
      });
      continue;
    }

    // 4. منع تطابق اسم الفرعي مع اسم الرئيسي في نفس الصف
    // ملاحظة: محتوى كل خلية يُعامل كاسم حرفي بالكامل (بما فيه الرموز مثل / و > و - والأقواس و & و +)،
    // ويُحدد المستوى حصرياً عبر العمودين «التصنيف الرئيسي» و«التصنيف الفرعي».
    if (subName && normSub === normMain) {
      pushRow({
        status: 'error',
        currentValueDisplay: 'غير صالح',
        newValueDisplay: '—',
        reason: `علاقة غير واضحة: لا يمكن أن يكون اسم التصنيف الفرعي "${subName}" مطابقاً لاسم التصنيف الرئيسي`,
        categoryAction: 'error'
      });
      continue;
    }

    // 6. منع تسلسل أكثر من مستويين عبر صفوف الملف (اسم يظهر كرئيسي في صف وكفرعي في صف آخر)
    if (chainedLevelNorms.has(normMain)) {
      const mRows = fileMainRowsByNorm.get(normMain) || [];
      const sRows = fileSubRowsByNorm.get(normMain) || [];
      pushRow({
        status: 'error',
        currentValueDisplay: 'علاقة غير واضحة',
        newValueDisplay: '—',
        reason: `علاقة غير واضحة: "${mainName}" ورد كتصنيف رئيسي (صف ${mRows.join('، ')}) وكتصنيف فرعي (صف ${sRows.join('، ')}) — القالب يدعم مستويين فقط`,
        categoryAction: 'error'
      });
      continue;
    }
    if (subName && chainedLevelNorms.has(normSub)) {
      const mRows = fileMainRowsByNorm.get(normSub) || [];
      const sRows = fileSubRowsByNorm.get(normSub) || [];
      pushRow({
        status: 'error',
        currentValueDisplay: 'علاقة غير واضحة',
        newValueDisplay: '—',
        reason: `علاقة غير واضحة: "${subName}" ورد كتصنيف فرعي (صف ${sRows.join('، ')}) وكتصنيف رئيسي (صف ${mRows.join('، ')}) — القالب يدعم مستويين فقط`,
        categoryAction: 'error'
      });
      continue;
    }

    // 7. مطابقة التصنيف الرئيسي الموجود في النظام
    const rootMatches = rootsByNorm.get(normMain) || [];
    let matchedExistingRoot: ProductCategory | undefined;
    if (rootMatches.length > 1) {
      const exactMatches = rootMatches.filter(c => c.name.trim().toLowerCase() === mainName.toLowerCase());
      if (exactMatches.length === 1) {
        matchedExistingRoot = exactMatches[0];
      } else {
        pushRow({
          status: 'error',
          currentValueDisplay: 'علاقة غير واضحة',
          newValueDisplay: '—',
          reason: `علاقة غير واضحة: التصنيف الرئيسي "${mainName}" يطابق أكثر من تصنيف رئيسي موجود في النظام`,
          categoryAction: 'error'
        });
        continue;
      }
    } else if (rootMatches.length === 1) {
      matchedExistingRoot = rootMatches[0];
    } else {
      // إذا لم يوجد كرئيسي لكنه موجود كفرعي حالياً في النظام -> علاقة غير واضحة / محاولة مستوى ثالث
      const existingSubWithSameName = subsByNorm.get(normMain) || [];
      if (existingSubWithSameName.length > 0) {
        pushRow({
          status: 'error',
          currentValueDisplay: 'علاقة غير واضحة',
          newValueDisplay: '—',
          reason: `علاقة غير واضحة: "${mainName}" موجود حالياً كتصنيف فرعي في النظام ولا يمكن استخدامه كتصنيف رئيسي في هذا القالب (يُدعم مستويان فقط)`,
          categoryAction: 'error'
        });
        continue;
      }
    }

    // 8. تقييم الصف حسب وجود الرئيسي في النظام من عدمه
    if (matchedExistingRoot) {
      if (!subName) {
        // رئيسي فقط وموجود مسبقاً -> مكرر (بدون تغيير ولا تعديل صامت)
        existingDuplicatesCount += 1;
        pushRow({
          status: 'unchanged',
          currentValueDisplay: 'رئيسي موجود مسبقاً',
          newValueDisplay: `${matchedExistingRoot.name} (موجود)`,
          reason: `مكرر: التصنيف الرئيسي "${matchedExistingRoot.name}" موجود بالفعل في النظام ولن يُكرَّر أو يُعدَّل`,
          categoryAction: 'duplicate_existing',
          displayMainName: matchedExistingRoot.name
        });
        continue;
      }

      if (isCategoryInactive(matchedExistingRoot)) {
        pushRow({
          status: 'error',
          currentValueDisplay: 'رئيسي معطّل',
          newValueDisplay: '—',
          reason: `علاقة غير واضحة: التصنيف الرئيسي "${matchedExistingRoot.name}" موجود لكنه معطّل/موقوف ولا يمكن ربط فروع جديدة به دون تفعيله`,
          categoryAction: 'error',
          displayMainName: matchedExistingRoot.name
        });
        continue;
      }

      const existingChildren = subsByParentId.get(matchedExistingRoot.id) || [];
      const dupChild = existingChildren.find(
        c => normalizeItemName(c.name) === normSub || c.name.trim().toLowerCase() === subName.toLowerCase()
      );
      if (dupChild) {
        existingDuplicatesCount += 1;
        pushRow({
          status: 'unchanged',
          currentValueDisplay: 'فرعي موجود مسبقاً',
          newValueDisplay: `${matchedExistingRoot.name} ← ${dupChild.name} (موجود)`,
          reason: `مكرر: التصنيف الفرعي "${dupChild.name}" موجود بالفعل تحت "${matchedExistingRoot.name}" ولن يُكرَّر أو يُعدَّل`,
          categoryAction: 'duplicate_existing',
          displayMainName: matchedExistingRoot.name
        });
        continue;
      }

      const pairKey = JSON.stringify([normMain, normSub]);
      const prevPairRow = plannedSubsByPair.get(pairKey);
      if (prevPairRow !== undefined) {
        intraFileDuplicatesCount += 1;
        pushRow({
          status: 'error',
          currentValueDisplay: 'مكرر بالملف',
          newValueDisplay: '—',
          reason: `اسم مكرر داخل الملف: التصنيف الفرعي "${subName}" تحت "${matchedExistingRoot.name}" مكرر مع الصف ${prevPairRow}`,
          categoryAction: 'duplicate_in_file',
          displayMainName: matchedExistingRoot.name
        });
        continue;
      }

      reusedExistingRootIds.add(matchedExistingRoot.id);
      plannedSubsByPair.set(pairKey, rawRow.rowNumber);
      newSubsCount += 1;
      pushRow({
        status: 'will_update',
        currentValueDisplay: 'رئيسي موجود (يُعاد استخدامه)',
        newValueDisplay: `إضافة فرعي «${subName}» تحت «${matchedExistingRoot.name}»`,
        categoryAction: 'reused_root_new_sub',
        displayMainName: matchedExistingRoot.name,
        actionPayload: {
          kind: 'add_category',
          mainName: matchedExistingRoot.name,
          normMain,
          existingRootId: matchedExistingRoot.id,
          subName,
          normSub
        }
      });
      continue;
    }

    // التصنيف الرئيسي جديد غير موجود في النظام
    if (!subName) {
      const prevRootRow = plannedRootSeenInAnyValidRow.get(normMain);
      if (prevRootRow !== undefined) {
        intraFileDuplicatesCount += 1;
        pushRow({
          status: 'error',
          currentValueDisplay: 'مكرر بالملف',
          newValueDisplay: '—',
          reason: `اسم مكرر داخل الملف: التصنيف الرئيسي "${mainName}" ورد بالفعل في الصف ${prevRootRow}`,
          categoryAction: 'duplicate_in_file'
        });
        continue;
      }

      plannedNewRootsByNorm.set(normMain, { name: mainName, firstRowNumber: rawRow.rowNumber });
      plannedRootSeenInAnyValidRow.set(normMain, rawRow.rowNumber);
      pushRow({
        status: 'will_update',
        currentValueDisplay: 'رئيسي جديد',
        newValueDisplay: `إضافة تصنيف رئيسي «${mainName}»`,
        categoryAction: 'new_root',
        actionPayload: {
          kind: 'add_category',
          mainName,
          normMain
        }
      });
      continue;
    }

    // رئيسي جديد + فرعي جديد
    const pairKey = JSON.stringify([normMain, normSub]);
    const prevPairRow = plannedSubsByPair.get(pairKey);
    if (prevPairRow !== undefined) {
      intraFileDuplicatesCount += 1;
      pushRow({
        status: 'error',
        currentValueDisplay: 'مكرر بالملف',
        newValueDisplay: '—',
        reason: `اسم مكرر داخل الملف: التصنيف الفرعي "${subName}" تحت "${mainName}" مكرر مع الصف ${prevPairRow}`,
        categoryAction: 'duplicate_in_file'
      });
      continue;
    }

    const existingPlannedRoot = plannedNewRootsByNorm.get(normMain);
    let canonicalMainName = mainName;
    let actionKind: BulkEditCategoryRowAction = 'new_root_and_sub';
    let curDisplay = 'رئيسي جديد + فرعي جديد';

    if (!existingPlannedRoot) {
      plannedNewRootsByNorm.set(normMain, { name: mainName, firstRowNumber: rawRow.rowNumber });
      plannedRootSeenInAnyValidRow.set(normMain, rawRow.rowNumber);
    } else {
      canonicalMainName = existingPlannedRoot.name;
      actionKind = 'batch_root_new_sub';
      curDisplay = 'رئيسي من نفس الملف + فرعي جديد';
    }

    plannedSubsByPair.set(pairKey, rawRow.rowNumber);
    newSubsCount += 1;

    pushRow({
      status: 'will_update',
      currentValueDisplay: curDisplay,
      newValueDisplay:
        actionKind === 'new_root_and_sub'
          ? `إضافة رئيسي «${canonicalMainName}» + فرعي «${subName}»`
          : `ربط فرعي «${subName}» بالرئيسي «${canonicalMainName}»`,
      categoryAction: actionKind,
      displayMainName: canonicalMainName,
      actionPayload: {
        kind: 'add_category',
        mainName: canonicalMainName,
        normMain,
        subName,
        normSub
      }
    });
  }

  const willUpdateCount = finalRows.filter(r => r.status === 'will_update').length;
  const unchangedCount = finalRows.filter(r => r.status === 'unchanged').length;
  const errorCount = finalRows.filter(r => r.status === 'error').length;

  const categorySummary: BulkEditCategoryImportSummary = {
    newRootsCount: plannedNewRootsByNorm.size,
    reusedRootsCount: reusedExistingRootIds.size,
    newSubsCount,
    duplicatesCount: existingDuplicatesCount + intraFileDuplicatesCount,
    existingDuplicatesCount,
    intraFileDuplicatesCount,
    errorCount
  };

  const summary: BulkEditExcelSummary = {
    totalRows: finalRows.length,
    willUpdateCount,
    unchangedCount,
    errorCount,
    warningCount: 0,
    categorySummary
  };

  return {
    rows: finalRows,
    summary,
    newCategories: [] as Array<{ name: string; itemsCount: number }>,
    zeroSalePriceCount: 0,
    zeroSalePriceWarning: undefined as string | undefined
  };
}

function evaluateDeleteCategoriesRows(
  inputRows: BulkEditParsedInputRow[],
  existingCategories: ProductCategory[]
) {
  const categoryById = new Map<string, ProductCategory>();
  const childrenByParentId = new Map<string, ProductCategory[]>();
  const byLiteralLower = new Map<string, ProductCategory[]>();

  for (const cat of existingCategories) {
    if (!cat || !cat.id) continue;
    categoryById.set(cat.id, cat);
    if (cat.parentCategoryId) {
      const pList = childrenByParentId.get(cat.parentCategoryId) || [];
      pList.push(cat);
      childrenByParentId.set(cat.parentCategoryId, pList);
    }
    const litKey = cleanCategoryImportCell(cat.name).toLowerCase();
    if (litKey) {
      const nList = byLiteralLower.get(litKey) || [];
      nList.push(cat);
      byLiteralLower.set(litKey, nList);
    }
  }

  const describeCategoryLocation = (cat: ProductCategory): string => {
    if (!cat.parentCategoryId) {
      return `رئيسي «${cat.name}»`;
    }
    const parent = categoryById.get(cat.parentCategoryId);
    return `فرعي «${cat.name}» تحت «${parent ? parent.name : 'تصنيف رئيسي'}»`;
  };

  const getDirectLinkedItems = (cat: ProductCategory): Item[] => {
    const catLit = cleanCategoryImportCell(cat.name).toLowerCase();
    const parent = cat.parentCategoryId ? categoryById.get(cat.parentCategoryId) : undefined;
    const parentPlusSubLit = parent
      ? `${cleanCategoryImportCell(parent.name)} / ${cleanCategoryImportCell(cat.name)}`.toLowerCase()
      : null;

    return memoryItems.filter(it => {
      if (it.categoryId) {
        return it.categoryId === cat.id;
      }
      const itCatName = cleanCategoryImportCell(it.categoryName).toLowerCase();
      if (!itCatName) return false;
      if (itCatName === catLit) return true;
      if (parentPlusSubLit && itCatName === parentPlusSubLit) return true;
      return false;
    });
  };

  const getDescendantCategories = (rootId: string): ProductCategory[] => {
    const result: ProductCategory[] = [];
    const visited = new Set<string>([rootId]);
    const queue = [...(childrenByParentId.get(rootId) || [])];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr.id)) continue;
      visited.add(curr.id);
      result.push(curr);
      const grandChildren = childrenByParentId.get(curr.id) || [];
      for (const gc of grandChildren) {
        if (!visited.has(gc.id)) queue.push(gc);
      }
    }
    return result;
  };

  interface InternalDelCatRow {
    rowNumber: number;
    itemId: string | undefined;
    itemName: string;
    inputName: string;
    codeOrBarcode: string | undefined;
    matchedBy: 'code_barcode' | 'name' | undefined;
    currentPrice: number | null;
    newPrice: number | null;
    currentValueDisplay: string;
    newValueDisplay: string;
    status: 'will_update' | 'unchanged' | 'error';
    reason: string | undefined;
    warning: string | undefined;
    rawValues: Record<string, any>;
    matchedCat?: ProductCategory;
    _actionPayload: EvaluatedRowActionPayload | undefined;
  }

  const finalRows: InternalDelCatRow[] = [];
  const seenLiteralInFile = new Map<string, number>();
  const mentionedCatIdsInFile = new Set<string>();
  const candidateRowsByCatId = new Map<string, InternalDelCatRow>();

  for (const rawRow of inputRows) {
    const values = rawRow.values || {};
    const categoryName = cleanCategoryImportCell(values.categoryName ?? rawRow.name);
    const extraLevelValue = cleanCategoryImportCell(values.extraLevelValue);
    const rawValues: Record<string, any> = {
      'اسم التصنيف': categoryName
    };

    const pushRow = (opts: {
      status: 'will_update' | 'unchanged' | 'error';
      itemId?: string;
      itemName?: string;
      currentValueDisplay: string;
      newValueDisplay: string;
      reason?: string;
      matchedCat?: ProductCategory;
      actionPayload?: EvaluatedRowActionPayload;
    }): InternalDelCatRow => {
      const entry: InternalDelCatRow = {
        rowNumber: rawRow.rowNumber,
        itemId: opts.itemId,
        itemName: opts.itemName || categoryName || 'بدون اسم',
        inputName: categoryName,
        codeOrBarcode: undefined,
        matchedBy: opts.matchedCat ? 'name' : undefined,
        currentPrice: null,
        newPrice: null,
        currentValueDisplay: opts.currentValueDisplay,
        newValueDisplay: opts.newValueDisplay,
        status: opts.status,
        reason: opts.reason,
        warning: undefined,
        rawValues,
        matchedCat: opts.matchedCat,
        _actionPayload: opts.status === 'will_update' ? opts.actionPayload : undefined
      };
      finalRows.push(entry);
      return entry;
    };

    // 1. رفض وجود أعمدة بيانات إضافية (القالب عمود واحد فقط)
    if (extraLevelValue) {
      pushRow({
        status: 'error',
        currentValueDisplay: 'غير صالح',
        newValueDisplay: '—',
        reason: 'قالب حذف التصنيفات يحتوي على عمود واحد فقط بعنوان «اسم التصنيف» — تم العثور على بيانات في عمود إضافي'
      });
      continue;
    }

    // 2. التحقق من وجود اسم التصنيف
    if (!categoryName) {
      pushRow({
        status: 'error',
        currentValueDisplay: 'غير صالح',
        newValueDisplay: '—',
        reason: 'اسم التصنيف فارغ ومطلوب'
      });
      continue;
    }

    // 3. رفض الصفوف المكررة داخل الملف
    const litKey = categoryName.toLowerCase();
    const prevRowNumber = seenLiteralInFile.get(litKey);
    if (prevRowNumber !== undefined) {
      pushRow({
        status: 'error',
        currentValueDisplay: 'مكرر بالملف',
        newValueDisplay: '—',
        reason: `صف مكرر داخل الملف: اسم التصنيف "${categoryName}" ورد مسبقاً في الصف رقم (${prevRowNumber})`
      });
      continue;
    }
    seenLiteralInFile.set(litKey, rawRow.rowNumber);

    // 4. المطابقة الحرفية الكاملة لاسم التصنيف دون تقسيم عند / أو > أو أي علامة ترقيم
    const exactMatches = existingCategories.filter(
      c => cleanCategoryImportCell(c.name) === categoryName
    );
    const caseMatches = byLiteralLower.get(litKey) || [];
    // إذا كان الاسم موجوداً في أكثر من موضع بالهرمية (سواء بتطابق حرفي أو حالة أحرف)، نعتبره ملتبساً ونرفض الصف
    const matches = caseMatches.length > 1 ? caseMatches : (exactMatches.length > 0 ? exactMatches : caseMatches);

    if (matches.length === 0) {
      pushRow({
        status: 'error',
        currentValueDisplay: 'غير موجود',
        newValueDisplay: '—',
        reason: `التصنيف "${categoryName}" غير موجود في النظام`
      });
      continue;
    }

    if (matches.length > 1) {
      pushRow({
        status: 'error',
        currentValueDisplay: 'اسم ملتبس بالهرمية',
        newValueDisplay: '—',
        reason: `اسم التصنيف "${categoryName}" ملتبس ومكرر في أكثر من مكان بالهرمية (${matches.map(describeCategoryLocation).join(' ، ')}) — لا يمكن تحديد التصنيف المقصود للحذف`
      });
      continue;
    }

    const matchedCat = matches[0];
    mentionedCatIdsInFile.add(matchedCat.id);
    const parentCat = matchedCat.parentCategoryId ? categoryById.get(matchedCat.parentCategoryId) : undefined;
    const typeLabel = matchedCat.parentCategoryId
      ? `تصنيف فرعي (تحت: ${parentCat ? parentCat.name : 'تصنيف رئيسي'})`
      : 'تصنيف رئيسي';

    // 5. منع حذف تصنيف مرتبط مباشرة بأي صنف
    const directItems = getDirectLinkedItems(matchedCat);
    if (directItems.length > 0) {
      const sampleNames = directItems.slice(0, 3).map(i => i.name).join('، ');
      pushRow({
        status: 'error',
        itemId: matchedCat.id,
        itemName: matchedCat.name,
        currentValueDisplay: `${typeLabel} • مرتبط بـ ${directItems.length} صنف`,
        newValueDisplay: '—',
        matchedCat,
        reason: `لا يمكن حذف التصنيف "${matchedCat.name}" لارتباطه مباشرةً بـ (${directItems.length}) صنف (${sampleNames}${directItems.length > 3 ? '...' : ''})`
      });
      continue;
    }

    // 6. منع حذف تصنيف رئيسي له تصنيفات فرعية مرتبطة بأصناف
    const descendants = getDescendantCategories(matchedCat.id);
    if (descendants.length > 0) {
      const descendantsWithItems: Array<{ sub: ProductCategory; count: number; sample: string }> = [];
      let totalDescendantItems = 0;
      for (const desc of descendants) {
        const dItems = getDirectLinkedItems(desc);
        if (dItems.length > 0) {
          totalDescendantItems += dItems.length;
          descendantsWithItems.push({
            sub: desc,
            count: dItems.length,
            sample: dItems.slice(0, 2).map(i => i.name).join('، ')
          });
        }
      }
      if (totalDescendantItems > 0) {
        const subDetails = descendantsWithItems
          .slice(0, 3)
          .map(d => `«${d.sub.name}»: ${d.count} صنف`)
          .join('، ');
        pushRow({
          status: 'error',
          itemId: matchedCat.id,
          itemName: matchedCat.name,
          currentValueDisplay: `${typeLabel} • فروعه مرتبطة بـ ${totalDescendantItems} صنف`,
          newValueDisplay: '—',
          matchedCat,
          reason: `لا يمكن حذف التصنيف الرئيسي "${matchedCat.name}" لوجود (${totalDescendantItems}) صنف مرتبط بتصنيفاته الفرعية (${subDetails}${descendantsWithItems.length > 3 ? '...' : ''})`
        });
        continue;
      }
    }

    const rowEntry = pushRow({
      status: 'will_update',
      itemId: matchedCat.id,
      itemName: matchedCat.name,
      currentValueDisplay:
        descendants.length > 0
          ? `${typeLabel} (تحته ${descendants.length} فرعي مدرج للحذف أولاً)`
          : typeLabel,
      newValueDisplay:
        matchedCat.parentCategoryId
          ? `حذف التصنيف الفرعي «${matchedCat.name}»`
          : descendants.length > 0
          ? `حذف التصنيف الرئيسي «${matchedCat.name}» (بعد حذف فروعه)`
          : `حذف التصنيف الرئيسي «${matchedCat.name}»`,
      matchedCat,
      actionPayload: {
        kind: 'delete_category',
        categoryId: matchedCat.id,
        categoryName: matchedCat.name
      }
    });
    candidateRowsByCatId.set(matchedCat.id, rowEntry);
  }

  // 7. المرحلة الثانية: منع حذف تصنيف رئيسي وترك تصنيفات فرعية يتيمة تحته
  // لا يُسمح بحذف الرئيسي الذي تحته فروع إلا إذا كانت جميع فروعه مدرجة في نفس الملف وقابلة للحذف (ستُحذف الفروع أولاً ثم الرئيسي)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [catId, rowEntry] of Array.from(candidateRowsByCatId.entries())) {
      const matchedCat = rowEntry.matchedCat!;
      const descendants = getDescendantCategories(catId);
      if (descendants.length === 0) continue;

      const unlistedDescendants = descendants.filter(d => !mentionedCatIdsInFile.has(d.id));
      const rejectedDescendants = descendants.filter(
        d => mentionedCatIdsInFile.has(d.id) && !candidateRowsByCatId.has(d.id)
      );

      if (unlistedDescendants.length > 0) {
        const namesList = unlistedDescendants.slice(0, 3).map(c => c.name).join('، ');
        rowEntry.status = 'error';
        rowEntry.currentValueDisplay = `تصنيف رئيسي • تحته ${unlistedDescendants.length} فرعي غير مدرج بالملف`;
        rowEntry.newValueDisplay = '—';
        rowEntry.reason = `لا يمكن حذف التصنيف الرئيسي "${matchedCat.name}" لوجود (${unlistedDescendants.length}) تصنيف فرعي تحته غير مدرج في الملف (${namesList}${unlistedDescendants.length > 3 ? '...' : ''}) — لا يُسمح بترك تصنيفات فرعية يتيمة (أدرج جميع الفروع القابلة للحذف أو احذفها أولاً)`;
        rowEntry._actionPayload = undefined;
        candidateRowsByCatId.delete(catId);
        changed = true;
      } else if (rejectedDescendants.length > 0) {
        const namesList = rejectedDescendants.slice(0, 3).map(c => c.name).join('، ');
        rowEntry.status = 'error';
        rowEntry.currentValueDisplay = `تصنيف رئيسي • بعض فروعه بالملف مرفوضة`;
        rowEntry.newValueDisplay = '—';
        rowEntry.reason = `لا يمكن حذف التصنيف الرئيسي "${matchedCat.name}" لأن بعض تصنيفاته الفرعية المدرجة في الملف مرفوضة أو غير قابلة للحذف (${namesList}${rejectedDescendants.length > 3 ? '...' : ''})`;
        rowEntry._actionPayload = undefined;
        candidateRowsByCatId.delete(catId);
        changed = true;
      }
    }
  }

  const willUpdateCount = finalRows.filter(r => r.status === 'will_update').length;
  const unchangedCount = finalRows.filter(r => r.status === 'unchanged').length;
  const errorCount = finalRows.filter(r => r.status === 'error').length;

  const summary: BulkEditExcelSummary = {
    totalRows: finalRows.length,
    willUpdateCount,
    unchangedCount,
    errorCount,
    warningCount: 0
  };

  return {
    rows: finalRows.map(({ matchedCat, ...rest }) => rest),
    summary,
    newCategories: [] as Array<{ name: string; itemsCount: number }>,
    zeroSalePriceCount: 0,
    zeroSalePriceWarning: undefined as string | undefined
  };
}

function evaluateBulkEditRows(
  inputRows: BulkEditParsedInputRow[],
  operationType: BulkEditOperationType,
  session?: BulkEditSessionInfo,
  targetWarehouse?: Warehouse,
  categoriesOverride?: ProductCategory[]
) {
  if (operationType === 'add_categories') {
    return evaluateAddCategoriesRows(inputRows, categoriesOverride || memoryCategories);
  }
  if (operationType === 'delete_categories') {
    return evaluateDeleteCategoriesRows(inputRows, categoriesOverride || memoryCategories);
  }
  // فهرسة الأصناف الحالية بالاسم الموحد وبالكود/الباركود لسرعة المطابقة
  const byNormName = new Map<string, Item[]>();
  const byNormCode = new Map<string, Item[]>();

  for (const it of memoryItems) {
    const normName = normalizeItemName(it.name);
    if (normName) {
      const list = byNormName.get(normName) || [];
      list.push(it);
      byNormName.set(normName, list);
    }

    const itemCodes = new Set<string>();
    const addCode = (val?: string | null) => {
      const norm = normalizeItemBarcode(val).toLowerCase();
      if (norm) itemCodes.add(norm);
    };
    addCode(it.sku);
    addCode((it as any).code);
    addCode(it.barcode);
    addCode(it.id);
    if (Array.isArray(it.secondaryBarcodes)) {
      for (const sb of it.secondaryBarcodes) addCode(sb);
    }
    if (Array.isArray(it.barcodes)) {
      for (const b of it.barcodes) addCode(typeof b === 'string' ? b : b?.barcode);
    }

    for (const c of itemCodes) {
      const list = byNormCode.get(c) || [];
      list.push(it);
      byNormCode.set(c, list);
    }
  }

  interface InternalRowEval {
    rowNumber: number;
    inputName: string;
    codeOrBarcode: string;
    matchedItem?: Item;
    matchedBy?: 'code_barcode' | 'name';
    currentPrice: number | null;
    newPrice: number | null;
    currentValueDisplay: string;
    newValueDisplay: string;
    isUnchanged: boolean;
    actionPayload?: EvaluatedRowActionPayload;
    reasons: string[];
    warnings: string[];
    rawValues: Record<string, any>;
  }

  const evaluated: InternalRowEval[] = [];
  const itemIdToRowNumbers = new Map<string, number[]>();

  // خرائط اكتشاف التعارضات داخل الملف نفسه للأسماء والأكواد والباركودات
  const fileNewNamesMap = new Map<string, number[]>();
  const fileSkusMap = new Map<string, Array<{ rowNumber: number; itemId?: string }>>();
  const fileBarcodesMap = new Map<string, Array<{ rowNumber: number; itemId?: string }>>();
  const canManageCategories = hasCategoriesManagePermission(session);
  const pendingNewRootNamesByNorm = new Map<string, string>();

  for (const rawRow of inputRows) {
    const inputName = String(rawRow.name ?? '').trim();
    const codeOrBarcode = String(rawRow.codeOrBarcode ?? '').trim();
    const values = rawRow.values || {};
    const reasons: string[] = [];
    const warnings: string[] = [];

    const normCode = normalizeItemBarcode(codeOrBarcode).toLowerCase();
    const normName = normalizeItemName(inputName);

    let matchedItem: Item | undefined;
    let matchedBy: 'code_barcode' | 'name' | undefined;

    if (operationType !== 'add_items') {
      if (normCode && operationType !== 'delete_items') {
        const codeMatches = byNormCode.get(normCode) || [];
        if (codeMatches.length === 0) {
          reasons.push(`لم يتم العثور على صنف مطابق للكود/الباركود (${codeOrBarcode})`);
        } else if (codeMatches.length > 1) {
          reasons.push(`الكود/الباركود (${codeOrBarcode}) يطابق أكثر من صنف في النظام`);
        } else {
          matchedItem = codeMatches[0];
          matchedBy = 'code_barcode';
        }
      } else if (normName) {
        const nameMatches = byNormName.get(normName) || [];
        if (nameMatches.length === 0) {
          reasons.push(
            operationType === 'delete_items'
              ? `لم يتم العثور على صنف باسم "${inputName}"`
              : `لم يتم العثور على صنف باسم "${inputName}" في المخزن`
          );
        } else if (nameMatches.length > 1) {
          reasons.push(
            operationType === 'delete_items'
              ? `يوجد أكثر من صنف بنفس الاسم "${inputName}" في النظام`
              : `يوجد أكثر من صنف بنفس الاسم "${inputName}"؛ يرجى تحديد الكود/الباركود`
          );
        } else {
          matchedItem = nameMatches[0];
          matchedBy = 'name';
        }
      } else {
        reasons.push(
          operationType === 'name'
            ? 'الاسم الحالي أو الكود/الباركود مطلوب'
            : operationType === 'delete_items'
            ? 'اسم الصنف مطلوب'
            : 'اسم الصنف أو الكود/الباركود مطلوب'
        );
      }

      if (matchedItem) {
        const arr = itemIdToRowNumbers.get(matchedItem.id) || [];
        arr.push(rawRow.rowNumber);
        itemIdToRowNumbers.set(matchedItem.id, arr);
      }
    }

    let currentPrice: number | null = null;
    let newPrice: number | null = null;
    let currentValueDisplay = '—';
    let newValueDisplay = '—';
    let isUnchanged = false;
    let actionPayload: EvaluatedRowActionPayload | undefined;

    const getNumericPrimaryRaw = () =>
      values.primary !== undefined ? values.primary : rawRow.newPriceRaw;

    switch (operationType) {
      case 'sale_price':
      case 'purchase_price':
      case 'pickup_fee':
      case 'min_price':
      case 'packaging_cost':
      case 'tax_rate':
      case 'reorder_limit': {
        const meta = BULK_EDIT_OP_META[operationType];
        const fieldLabelMap: Record<string, string> = {
          sale_price: 'سعر البيع الجديد',
          purchase_price: 'سعر الشراء الجديد',
          pickup_fee: 'رسوم الالتقاط',
          min_price: 'الحد الأدنى لسعر البيع',
          packaging_cost: 'تكلفة التغليف',
          tax_rate: 'نسبة الضريبة %',
          reorder_limit: 'الحد الأدنى للكمية'
        };
        const maxVal = operationType === 'tax_rate' ? 100 : undefined;
        const parsed = parseNonNegativeNumber(getNumericPrimaryRaw(), fieldLabelMap[operationType] || meta.label, 2, maxVal);
        const unitSuffix = operationType === 'tax_rate' ? '%' : operationType === 'reorder_limit' ? '' : ' ج.م';

        if (matchedItem) {
          const whIdForReorder = targetWarehouse?.id || getDefaultWarehouse().id;
          const curValRaw =
            operationType === 'sale_price'
              ? matchedItem.salePrice || 0
              : operationType === 'purchase_price'
              ? matchedItem.purchasePrice || 0
              : operationType === 'pickup_fee'
              ? matchedItem.pickupFee || 0
              : operationType === 'min_price'
              ? matchedItem.minPrice || 0
              : operationType === 'packaging_cost'
              ? matchedItem.packagingCost || 0
              : operationType === 'tax_rate'
              ? matchedItem.taxRate || 0
              : getItemWarehouseReorderLimit(matchedItem.id, whIdForReorder);
          currentPrice = Math.round(Number(curValRaw) * 100) / 100;
          currentValueDisplay = `${currentPrice}${unitSuffix}`;
        }

        if (parsed.valid === false) {
          reasons.push(parsed.reason);
        } else {
          newPrice = parsed.value;
          newValueDisplay = `${newPrice}${unitSuffix}`;

          if (operationType === 'min_price' && matchedItem && newPrice > 0) {
            const saleP = Math.round(Number(matchedItem.salePrice || 0) * 100) / 100;
            if (newPrice > saleP) {
              reasons.push(
                `الحد الأدنى للسعر (${newPrice}) لا يجوز أن يتجاوز سعر البيع الحالي (${saleP})`
              );
            }
          }

          if (currentPrice !== null && newPrice === currentPrice) {
            isUnchanged = true;
          } else if (reasons.length === 0) {
            actionPayload = { kind: 'number_field', newValue: newPrice };
          }
        }
        break;
      }

      case 'stock_quantity': {
        const allowNegQty = Boolean(
          memoryStockSettings.allowNegativeStockSale || (memoryStockSettings as any).allowNegativeStock
        );
        const parsedQty = parseNonNegativeNumber(
          values.quantity !== undefined ? values.quantity : rawRow.newPriceRaw,
          'الكمية',
          3,
          undefined,
          allowNegQty
        );
        const reasonStr = String(values.reason ?? '').trim();

        if (matchedItem) {
          const whId = targetWarehouse?.id || getDefaultWarehouse().id;
          const oldQty = getItemWarehouseStock(matchedItem.id, whId);
          currentPrice = oldQty;
          currentValueDisplay = `${oldQty}`;
        }

        if (parsedQty.valid === false) {
          reasons.push(parsedQty.reason);
        } else {
          newPrice = parsedQty.value;
          if (currentPrice !== null) {
            const diff = Math.round((newPrice - currentPrice) * 1000) / 1000;
            const diffLabel = diff === 0 ? 'بدون فرق' : diff > 0 ? `+${diff}` : `${diff}`;
            newValueDisplay = `${newPrice} (${diffLabel})`;
            if (diff === 0) {
              isUnchanged = true;
            } else if (reasons.length === 0) {
              actionPayload = {
                kind: 'stock_quantity',
                newQuantity: newPrice,
                reason: reasonStr || undefined
              };
            }
          } else {
            newValueDisplay = `${newPrice}`;
          }
        }
        break;
      }

      case 'primary_barcode': {
        const rawBc = values.barcode !== undefined ? values.barcode : rawRow.newPriceRaw;
        if (matchedItem) {
          currentValueDisplay = matchedItem.barcode?.trim() || 'بدون باركود';
        }
        if (isCellEmpty(rawBc)) {
          reasons.push('الباركود الجديد مطلوب');
          break;
        }
        if (isScientificNotationBarcode(rawBc)) {
          newValueDisplay = String(rawBc).trim();
          reasons.push('نسّق عمود الباركود كنص في الإكسيل');
          break;
        }
        const nextBarcode = normalizeItemBarcode(String(rawBc));
        if (!nextBarcode) {
          reasons.push('الباركود الجديد مطلوب');
          break;
        }
        newValueDisplay = nextBarcode;

        const bcKey = nextBarcode.toLowerCase();
        const bcList = fileBarcodesMap.get(bcKey) || [];
        bcList.push({ rowNumber: rawRow.rowNumber, itemId: matchedItem?.id });
        fileBarcodesMap.set(bcKey, bcList);

        if (matchedItem) {
          const oldPrimary = normalizeItemBarcode(matchedItem.barcode || '');
          const oldSec = (matchedItem.secondaryBarcodes || []).map(s => normalizeItemBarcode(s)).filter(Boolean);
          if (
            oldPrimary.toLowerCase() === bcKey ||
            oldSec.some(s => s.toLowerCase() === bcKey)
          ) {
            isUnchanged = true;
          } else {
            const uniqueCheck = checkItemUniqueness({
              excludeId: matchedItem.id,
              barcode: nextBarcode
            });
            if (uniqueCheck.isDuplicate) {
              reasons.push(uniqueCheck.error || `الباركود [${nextBarcode}] مكرر مع صنف آخر`);
            } else if (reasons.length === 0) {
              actionPayload = {
                kind: 'primary_barcode',
                barcode: nextBarcode
              };
            }
          }
        }
        break;
      }

      case 'add_secondary_barcode': {
        const rawBc = values.barcode !== undefined ? values.barcode : rawRow.newPriceRaw;
        if (matchedItem) {
          const secList = (matchedItem.secondaryBarcodes || []).filter(Boolean);
          currentValueDisplay = secList.length > 0 ? secList.join('، ') : 'بدون باركود فرعي';
        }
        if (isCellEmpty(rawBc)) {
          reasons.push('الباركود المضاف مطلوب');
          break;
        }
        if (isScientificNotationBarcode(rawBc)) {
          newValueDisplay = String(rawBc).trim();
          reasons.push('نسّق عمود الباركود كنص في الإكسيل');
          break;
        }
        const addedBarcode = normalizeItemBarcode(String(rawBc));
        if (!addedBarcode) {
          reasons.push('الباركود المضاف مطلوب');
          break;
        }
        newValueDisplay = addedBarcode;

        const bcKey = addedBarcode.toLowerCase();
        const bcList = fileBarcodesMap.get(bcKey) || [];
        bcList.push({ rowNumber: rawRow.rowNumber, itemId: matchedItem?.id });
        fileBarcodesMap.set(bcKey, bcList);

        if (matchedItem) {
          const oldPrimary = normalizeItemBarcode(matchedItem.barcode || '');
          const oldSec = (matchedItem.secondaryBarcodes || []).map(s => normalizeItemBarcode(s)).filter(Boolean);
          if (
            oldPrimary.toLowerCase() === bcKey ||
            oldSec.some(s => s.toLowerCase() === bcKey)
          ) {
            isUnchanged = true;
          } else {
            const uniqueCheck = checkItemUniqueness({
              excludeId: matchedItem.id,
              secondaryBarcodes: [addedBarcode]
            });
            if (uniqueCheck.isDuplicate) {
              reasons.push(uniqueCheck.error || `الباركود [${addedBarcode}] مكرر مع صنف آخر`);
            } else if (reasons.length === 0) {
              actionPayload = {
                kind: 'add_secondary_barcode',
                barcode: addedBarcode
              };
            }
          }
        }
        break;
      }

      case 'name': {
        const rawNewName = String(values.newName ?? '').trim().replace(/\s+/g, ' ');
        const normNewName = normalizeItemName(rawNewName);

        if (matchedItem) {
          currentValueDisplay = matchedItem.name;
        }
        if (!normNewName) {
          reasons.push('الاسم الجديد مطلوب');
        } else {
          newValueDisplay = rawNewName;
          const fileRows = fileNewNamesMap.get(normNewName) || [];
          fileRows.push(rawRow.rowNumber);
          fileNewNamesMap.set(normNewName, fileRows);

          if (matchedItem) {
            if (normalizeItemName(matchedItem.name) === normNewName && matchedItem.name.trim() === rawNewName) {
              isUnchanged = true;
            } else {
              const uniqueCheck = checkItemUniqueness({
                excludeId: matchedItem.id,
                name: rawNewName
              });
              if (uniqueCheck.isDuplicate) {
                reasons.push(uniqueCheck.error || `الاسم الجديد "${rawNewName}" مستخدم لصنف آخر بالفعل`);
              } else if (reasons.length === 0) {
                actionPayload = { kind: 'name', newName: rawNewName, normNewName };
              }
            }
          }
        }
        break;
      }

      case 'print_name': {
        const rawPrintName = String(values.printName ?? '').trim().replace(/\s+/g, ' ');
        if (matchedItem) {
          currentValueDisplay = matchedItem.printName?.trim() || 'فارغ';
        }
        if (rawPrintName.length > 120) {
          reasons.push('اسم الطباعة لا يتجاوز 120 حرف');
        }
        newValueDisplay = rawPrintName || 'فارغ';
        if (matchedItem) {
          if ((matchedItem.printName || '').trim() === rawPrintName) {
            isUnchanged = true;
          } else if (reasons.length === 0) {
            actionPayload = { kind: 'print_name', printName: rawPrintName };
          }
        }
        break;
      }

      case 'barcode_sku': {
        const hasBc = !isCellEmpty(values.barcode);
        const hasSku = !isCellEmpty(values.sku);
        const hasSec = !isCellEmpty(values.secondaryBarcodes);

        if (matchedItem) {
          currentValueDisplay = formatBarcodeSkuDisplay(
            matchedItem.barcode,
            matchedItem.sku,
            matchedItem.secondaryBarcodes
          );
        }

        if (!hasBc && !hasSku && !hasSec) {
          reasons.push('يرجى إدخال قيمة واحدة على الأقل (الباركود الأساسي أو كود SKU أو باركودات فرعية)');
          break;
        }

        const nextBarcode = hasBc
          ? normalizeItemBarcode(String(values.barcode))
          : normalizeItemBarcode(matchedItem?.barcode || '');
        const nextSku = hasSku
          ? normalizeItemBarcode(String(values.sku))
          : normalizeItemBarcode(matchedItem?.sku || '');

        let nextSecondary: string[];
        if (hasSec) {
          nextSecondary = Array.from(
            new Set(
              String(values.secondaryBarcodes)
                .split(/[,،\n]+/)
                .map(s => normalizeItemBarcode(s))
                .filter(Boolean)
            )
          );
        } else {
          nextSecondary = (matchedItem?.secondaryBarcodes || [])
            .map(s => normalizeItemBarcode(s))
            .filter(s => s && s.toLowerCase() !== nextBarcode.toLowerCase());
        }

        newValueDisplay = formatBarcodeSkuDisplay(
          nextBarcode || undefined,
          nextSku || undefined,
          nextSecondary
        );

        // تسجيل في خرائط التكرار داخل الملف
        if (nextSku) {
          const k = nextSku.toLowerCase();
          const list = fileSkusMap.get(k) || [];
          list.push({ rowNumber: rawRow.rowNumber, itemId: matchedItem?.id });
          fileSkusMap.set(k, list);
        }
        const allRowBarcodes = [
          ...(nextBarcode ? [nextBarcode] : []),
          ...nextSecondary
        ];
        for (const bc of allRowBarcodes) {
          const k = bc.toLowerCase();
          const list = fileBarcodesMap.get(k) || [];
          list.push({ rowNumber: rawRow.rowNumber, itemId: matchedItem?.id });
          fileBarcodesMap.set(k, list);
        }

        if (matchedItem) {
          const oldBc = normalizeItemBarcode(matchedItem.barcode || '');
          const oldSku = normalizeItemBarcode(matchedItem.sku || '');
          const oldSec = (matchedItem.secondaryBarcodes || []).map(s => normalizeItemBarcode(s)).filter(Boolean);

          const sameBc = oldBc === nextBarcode;
          const sameSku = oldSku === nextSku;
          const sameSec =
            oldSec.length === nextSecondary.length &&
            oldSec.every((v, idx) => v === nextSecondary[idx]);

          if (sameBc && sameSku && sameSec) {
            isUnchanged = true;
          } else {
            const uniqueCheck = checkItemUniqueness({
              excludeId: matchedItem.id,
              barcode: nextBarcode,
              secondaryBarcodes: nextSecondary,
              sku: nextSku
            });
            if (uniqueCheck.isDuplicate) {
              reasons.push(uniqueCheck.error || 'الباركود أو كود SKU مكرر مع صنف آخر');
            } else if (reasons.length === 0) {
              actionPayload = {
                kind: 'barcode_sku',
                barcode: nextBarcode,
                sku: nextSku,
                secondaryBarcodes: nextSecondary
              };
            }
          }
        }
        break;
      }

      case 'notes': {
        const nextNotes = String(values.notes ?? '').trim();
        if (matchedItem) {
          currentValueDisplay = matchedItem.notes?.trim() || 'بدون وصف';
        }
        if (!nextNotes) {
          reasons.push('الوصف الجديد مطلوب');
        } else {
          newValueDisplay = nextNotes;
          if (matchedItem && (matchedItem.notes || '').trim() === nextNotes) {
            isUnchanged = true;
          } else if (reasons.length === 0) {
            actionPayload = { kind: 'notes', notes: nextNotes };
          }
        }
        break;
      }

      case 'category': {
        const rawCategoryVal = values.rootCategory ?? values.primary ?? rawRow.newPriceRaw ?? '';
        const rootName = String(rawCategoryVal).trim().replace(/\s+/g, ' ');
        const subName = String(values.subCategory ?? '').trim().replace(/\s+/g, ' ');
        if (matchedItem) {
          currentValueDisplay = formatItemCategoryDisplay(matchedItem);
        }

        if (!rootName) {
          reasons.push(`السطر ${rawRow.rowNumber}: خانة "التصنيف" الإلزامية فارغة`);
          break;
        }

        const catRes = resolveSingleColumnImportCategory({
          rawCategoryInput: rootName,
          rawLegacySubCategoryInput: subName,
          categories: memoryCategories,
          canManageCategories
        });

        if (catRes.ok === false) {
          reasons.push(catRes.error);
          newValueDisplay = subName ? `${rootName} / ${subName}` : rootName;
          break;
        }

        if (catRes.isNewRootCategory && catRes.newRootNormName && catRes.newRootCategoryName) {
          const firstWrittenName =
            pendingNewRootNamesByNorm.get(catRes.newRootNormName) || catRes.newRootCategoryName;
          if (!pendingNewRootNamesByNorm.has(catRes.newRootNormName)) {
            pendingNewRootNamesByNorm.set(catRes.newRootNormName, firstWrittenName);
          }
          newValueDisplay = `${firstWrittenName} (تصنيف جديد)`;
          if (reasons.length === 0) {
            actionPayload = {
              kind: 'category',
              categoryId: undefined,
              categoryName: firstWrittenName,
              isNewRootCategory: true,
              newRootCategoryName: firstWrittenName,
              newRootNormName: catRes.newRootNormName
            };
          }
        } else {
          newValueDisplay = catRes.categoryName;
          if (matchedItem && matchedItem.categoryId === catRes.categoryId) {
            isUnchanged = true;
          } else if (reasons.length === 0) {
            actionPayload = {
              kind: 'category',
              categoryId: catRes.categoryId,
              categoryName: catRes.categoryName,
              isNewRootCategory: false
            };
          }
        }
        break;
      }

      case 'platforms': {
        const rawPlts = String(values.platforms ?? '').trim();
        if (matchedItem) {
          currentValueDisplay = formatItemPlatformsDisplay(matchedItem.platformIds);
        }

        if (!rawPlts) {
          reasons.push('يرجى إدخال أسماء المنصات المرتبطة أو كتابة "الكل"');
          break;
        }

        const normWhole = normalizeArabicText(rawPlts.toLowerCase());
        let newPlatformIds: string[] = [];

        if (['الكل', 'كل المنصات', 'all'].includes(normWhole)) {
          newPlatformIds = [];
          newValueDisplay = 'الكل';
        } else {
          const tokens = rawPlts
            .split(/[,،\n]+/)
            .map(t => t.trim().replace(/\s+/g, ' '))
            .filter(Boolean);

          if (tokens.length === 0) {
            reasons.push('يرجى إدخال أسماء المنصات المرتبطة أو كتابة "الكل"');
            break;
          }

          const matchedIds: string[] = [];
          const missingNames: string[] = [];
          for (const token of tokens) {
            const normToken = normalizeArabicText(token);
            const plt = memoryPlatforms.find(
              p => normalizeArabicText(p.name.trim().replace(/\s+/g, ' ')) === normToken
            );
            if (!plt) {
              missingNames.push(token);
            } else if (!matchedIds.includes(plt.id)) {
              matchedIds.push(plt.id);
            }
          }

          if (missingNames.length > 0) {
            reasons.push(`المنصات التالية غير موجودة في النظام: ${missingNames.join('، ')}`);
            newValueDisplay = rawPlts;
            break;
          }

          newPlatformIds = matchedIds;
          newValueDisplay = formatItemPlatformsDisplay(newPlatformIds);
        }

        if (matchedItem) {
          const oldSorted = [...(matchedItem.platformIds || [])].sort().join(',');
          const newSorted = [...newPlatformIds].sort().join(',');
          if (oldSorted === newSorted) {
            isUnchanged = true;
          } else if (reasons.length === 0) {
            actionPayload = { kind: 'platforms', platformIds: newPlatformIds };
          }
        }
        break;
      }

      case 'bnpl': {
        if (matchedItem) {
          const curEn = Boolean(matchedItem.enableBnpl);
          const curPct = Math.round(Number(matchedItem.bnplPercentage || 0) * 100) / 100;
          currentValueDisplay = `${curEn ? 'نعم' : 'لا'} (${curPct}%)`;
        }

        const parsedEnable = parseArabicBooleanCell(values.enableBnpl);
        if (parsedEnable.valid === false) {
          reasons.push(parsedEnable.reason);
        }

        const pctEmpty = isCellEmpty(values.bnplPercentage);
        let parsedPctValue = 0;

        if (pctEmpty) {
          if (parsedEnable.valid && parsedEnable.value) {
            reasons.push('نسبة BNPL % مطلوبة عند التفعيل (بين 0 و 100)');
          }
        } else {
          const parsedPct = parseNonNegativeNumber(values.bnplPercentage, 'نسبة BNPL %', 2, 100);
          if (parsedPct.valid === false) {
            reasons.push(parsedPct.reason);
          } else {
            parsedPctValue = parsedPct.value;
          }
        }

        if (parsedEnable.valid) {
          newValueDisplay = `${parsedEnable.value ? 'نعم' : 'لا'} (${parsedPctValue}%)`;
          if (reasons.length === 0 && matchedItem) {
            const oldEn = Boolean(matchedItem.enableBnpl);
            const oldPct = Math.round(Number(matchedItem.bnplPercentage || 0) * 100) / 100;
            if (oldEn === parsedEnable.value && oldPct === parsedPctValue) {
              isUnchanged = true;
            } else {
              actionPayload = {
                kind: 'bnpl',
                enableBnpl: parsedEnable.value,
                bnplPercentage: parsedPctValue
              };
            }
          }
        }
        break;
      }

      case 'supplier': {
        const nextSupplier = String(values.supplier ?? '').trim().replace(/\s+/g, ' ');
        if (matchedItem) {
          currentValueDisplay = matchedItem.supplier?.trim() || 'بدون مورد';
        }
        if (!nextSupplier) {
          reasons.push('اسم المورد مطلوب');
        } else {
          newValueDisplay = nextSupplier;
          if (matchedItem && (matchedItem.supplier || '').trim() === nextSupplier) {
            isUnchanged = true;
          } else if (reasons.length === 0) {
            actionPayload = { kind: 'supplier', supplier: nextSupplier };
          }
        }
        break;
      }

      case 'unit': {
        const rawUnitVal = values.unit ?? values.primary ?? rawRow.newPriceRaw ?? '';
        const nextUnit = String(rawUnitVal).trim().replace(/\s+/g, ' ');
        if (matchedItem) {
          currentValueDisplay = matchedItem.unit?.trim() || 'قطعة';
        }
        if (!nextUnit) {
          reasons.push(`السطر ${rawRow.rowNumber}: خانة "الوحدة" الإلزامية فارغة`);
        } else {
          newValueDisplay = nextUnit;
          if (matchedItem && (matchedItem.unit?.trim() || 'قطعة') === nextUnit) {
            isUnchanged = true;
          } else if (reasons.length === 0) {
            actionPayload = { kind: 'unit', unit: nextUnit };
          }
        }
        break;
      }

      case 'status': {
        if (matchedItem) {
          currentValueDisplay = normalizeExistingItemStatus(matchedItem.status);
        }
        const parsedStatus = parseItemStatusCell(values.status);
        if (parsedStatus.valid === false) {
          reasons.push(parsedStatus.reason);
        } else {
          newValueDisplay = parsedStatus.value;
          if (matchedItem && normalizeExistingItemStatus(matchedItem.status) === parsedStatus.value) {
            isUnchanged = true;
          } else if (reasons.length === 0) {
            actionPayload = { kind: 'status', status: parsedStatus.value };
          }
        }
        break;
      }

      case 'image_url': {
        const nextUrl = String(values.imageUrl ?? '').trim();
        if (matchedItem) {
          currentValueDisplay = matchedItem.imageUrl?.trim() || 'بدون صورة';
        }
        if (!isValidImageUrlCell(nextUrl)) {
          reasons.push('رابط الصورة غير صالح (يجب أن يبدأ بـ http:// أو https:// أو / أو data:image/)');
        } else {
          newValueDisplay = nextUrl;
          if (matchedItem && (matchedItem.imageUrl || '').trim() === nextUrl) {
            isUnchanged = true;
          } else if (reasons.length === 0) {
            actionPayload = { kind: 'image_url', imageUrl: nextUrl };
          }
        }
        break;
      }

      case 'add_items': {
        const cleanName = inputName.replace(/\s+/g, ' ');
        const cleanNormName = normalizeItemName(cleanName);
        currentValueDisplay = 'صنف جديد';

        // 1) اسم الصنف (إلزامي)
        if (!cleanNormName) {
          reasons.push(`السطر ${rawRow.rowNumber}: خانة "اسم الصنف" الإلزامية فارغة`);
        } else {
          const nameList = fileNewNamesMap.get(cleanNormName) || [];
          nameList.push(rawRow.rowNumber);
          fileNewNamesMap.set(cleanNormName, nameList);
        }

        // 2) اسم الطباعة (اختياري، الافتراضي نص فارغ، حتى 120 حرف، ولا يدخل في منع التكرار)
        const printNameVal = String(values.printName ?? '').trim().replace(/\s+/g, ' ');
        if (printNameVal.length > 120) {
          reasons.push(`السطر ${rawRow.rowNumber}: خانة "اسم الطباعة" لا تتجاوز 120 حرف`);
        }

        // وصف الصنف (اختياري، يُحفظ في حقل notes / عمود ملاحظات، الافتراضي نص فارغ)
        const notesVal = String(values.notes ?? '').trim();

        // 3) الكمية (اختيارية، الافتراضي 0، رقم غير سالب)
        let stockQtyVal = 0;
        if (!isCellEmpty(values.stockQuantity)) {
          const qtyParsed = parseNonNegativeNumber(values.stockQuantity, 'الكمية', 3);
          if (qtyParsed.valid === false) {
            reasons.push(`السطر ${rawRow.rowNumber}: ${qtyParsed.reason}`);
          } else {
            stockQtyVal = qtyParsed.value;
          }
        }

        // 4) الباركود الرئيسي (إلزامي، نص، الأرقام العربية تتحول لإنجليزية، الصيغة العلمية ترفض)
        let cleanBarcode = '';
        if (isCellEmpty(values.barcode)) {
          reasons.push(`السطر ${rawRow.rowNumber}: خانة "الباركود الرئيسي" الإلزامية فارغة`);
        } else if (isScientificNotationBarcode(values.barcode)) {
          reasons.push(`السطر ${rawRow.rowNumber}: نسّق عمود الباركود كنص في الإكسيل`);
        } else {
          cleanBarcode = normalizeItemBarcode(String(values.barcode ?? ''));
          if (!cleanBarcode) {
            reasons.push(`السطر ${rawRow.rowNumber}: خانة "الباركود الرئيسي" الإلزامية فارغة`);
          }
        }

        const cleanSku = normalizeItemBarcode(String(values.sku ?? ''));
        const cleanSecondary = !isCellEmpty(values.secondaryBarcodes)
          ? Array.from(
              new Set(
                String(values.secondaryBarcodes)
                  .split(/[,،\n]+/)
                  .map(s => normalizeItemBarcode(s))
                  .filter(Boolean)
              )
            )
          : [];

        if (cleanSku) {
          const k = cleanSku.toLowerCase();
          const list = fileSkusMap.get(k) || [];
          list.push({ rowNumber: rawRow.rowNumber });
          fileSkusMap.set(k, list);
        }
        for (const bc of [...(cleanBarcode ? [cleanBarcode] : []), ...cleanSecondary]) {
          const k = bc.toLowerCase();
          const list = fileBarcodesMap.get(k) || [];
          list.push({ rowNumber: rawRow.rowNumber });
          fileBarcodesMap.set(k, list);
        }

        if (cleanNormName || cleanBarcode || cleanSku || cleanSecondary.length > 0) {
          const uniq = checkItemUniqueness({
            name: cleanName || undefined,
            barcode: cleanBarcode || undefined,
            secondaryBarcodes: cleanSecondary.length > 0 ? cleanSecondary : undefined,
            sku: cleanSku || undefined
          });
          if (uniq.isDuplicate) {
            for (const c of uniq.conflicts) {
              reasons.push(c.message);
            }
          }
        }

        // 5) سعر البيع (اختياري، الافتراضي 0، رقم غير سالب ويقرب لخانتين)
        let salePriceVal = 0;
        let saleValid = true;
        if (!isCellEmpty(values.salePrice)) {
          const saleParsed = parseNonNegativeNumber(values.salePrice, 'سعر البيع', 2);
          if (saleParsed.valid === false) {
            reasons.push(`السطر ${rawRow.rowNumber}: ${saleParsed.reason}`);
            saleValid = false;
          } else {
            salePriceVal = saleParsed.value;
          }
        }

        // 6) سعر الشراء (اختياري، الافتراضي 0، رقم غير سالب ويقرب لخانتين؛ يُقبل من الملف لمن يملك صلاحية التكلفة فقط)
        let purchasePriceVal = 0;
        let purchaseFileVal = 0;
        let purchaseValid = true;
        if (!isCellEmpty(values.purchasePrice)) {
          const purParsed = parseNonNegativeNumber(values.purchasePrice, 'سعر الشراء', 2);
          if (purParsed.valid === false) {
            reasons.push(`السطر ${rawRow.rowNumber}: ${purParsed.reason}`);
            purchaseValid = false;
          } else {
            purchaseFileVal = purParsed.value;
            purchasePriceVal = hasPurchasePricePermission(session) ? purParsed.value : 0;
          }
        }

        // لو سعر البيع أقل من سعر الشراء: الصف يُقبل مع تحذير كهرماني في المعاينة (فقط لمن يملك صلاحية التكلفة)
        if (hasPurchasePricePermission(session) && saleValid && purchaseValid && salePriceVal < purchaseFileVal) {
          warnings.push(`تحذير: سعر البيع (${salePriceVal}) أقل من سعر الشراء (${purchaseFileVal})`);
        }

        // 7) التصنيف من العمود الواحد (اختياري؛ إذا كان فارغاً يُحفظ الصنف بدون تصنيف)
        // تُعامل قيمة الخلية كاسم تصنيف كامل حرفي (شاملاً التصنيفات الرئيسية والفرعية وأي رموز مثل / أو > أو الأقواس) دون تقسيم
        // وإذا لم يوجد تصنيف مطابق، يُجهَّز كتصنيف رئيسي جديد بالاسم المكتوب حرفياً دون استنتاج تصنيف أب من الرموز
        const rawCategoryCell = String(values.rootCategory ?? '')
          .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
          .trim();
        let categoryIdVal: string | undefined;
        let categoryNameVal: string | undefined;
        let isNewRootCategoryVal = false;
        let newRootCategoryNameVal: string | undefined;
        let newRootNormNameVal: string | undefined;

        if (rawCategoryCell) {
          const catRes = resolveAddItemImportCategory({
            rawCategoryInput: rawCategoryCell,
            categories: categoriesOverride || memoryCategories,
            canManageCategories
          });

          if (catRes.ok === false) {
            reasons.push(
              catRes.error.includes('السطر')
                ? catRes.error
                : `السطر ${rawRow.rowNumber}: ${catRes.error}`
            );
          } else {
            categoryIdVal = catRes.categoryId;
            categoryNameVal = catRes.categoryName;
            if (catRes.isNewRootCategory && catRes.newRootNormName && catRes.newRootCategoryName) {
              isNewRootCategoryVal = true;
              newRootNormNameVal = catRes.newRootNormName;
              newRootCategoryNameVal = catRes.newRootCategoryName;
            }
          }
        }

        // الأعمدة الاختيارية (تأخذ القيم الافتراضية: 0 للأرقام، نص فارغ للنصوص، والوحدة/الحالة الافتراضية للنظام)
        const unitVal = String(values.unit ?? '').trim().replace(/\s+/g, ' ') || 'قطعة';

        let reorderLimitVal = 0;
        if (!isCellEmpty(values.reorderLimit)) {
          const rlParsed = parseNonNegativeNumber(values.reorderLimit, 'الحد الأدنى للكمية', 2);
          if (rlParsed.valid === false) reasons.push(`السطر ${rawRow.rowNumber}: ${rlParsed.reason}`);
          else reorderLimitVal = rlParsed.value;
        }

        const supplierVal = String(values.supplier ?? '').trim().replace(/\s+/g, ' ');

        let taxRateVal = 0;
        if (!isCellEmpty(values.taxRate)) {
          const cleanedTaxRaw =
            typeof values.taxRate === 'string' ? values.taxRate.replace(/[%٪]/g, '').trim() : values.taxRate;
          const taxParsed = parseNonNegativeNumber(cleanedTaxRaw, 'نسبة الضريبة', 2, 100);
          if (taxParsed.valid === false) reasons.push(`السطر ${rawRow.rowNumber}: ${taxParsed.reason}`);
          else taxRateVal = taxParsed.value;
        }

        let minPriceVal = 0;
        if (!isCellEmpty(values.minPrice)) {
          const minParsed = parseNonNegativeNumber(values.minPrice, 'الحد الأدنى لسعر البيع', 2);
          if (minParsed.valid === false) {
            reasons.push(`السطر ${rawRow.rowNumber}: ${minParsed.reason}`);
          } else if (minParsed.value > 0 && saleValid && minParsed.value > salePriceVal) {
            reasons.push(`السطر ${rawRow.rowNumber}: الحد الأدنى للسعر (${minParsed.value}) لا يجوز أن يتجاوز سعر البيع (${salePriceVal})`);
          } else {
            minPriceVal = minParsed.value;
          }
        }

        let packagingCostVal = 0;
        if (!isCellEmpty(values.packagingCost)) {
          const pkgParsed = parseNonNegativeNumber(values.packagingCost, 'تكلفة التغليف', 2);
          if (pkgParsed.valid === false) {
            reasons.push(`السطر ${rawRow.rowNumber}: ${pkgParsed.reason}`);
          } else if (hasPackagingCostPermission(session)) {
            packagingCostVal = pkgParsed.value;
          }
        }

        let pickupFeeVal: number | undefined;
        if (!isCellEmpty(values.pickupFee)) {
          const pkParsed = parseNonNegativeNumber(values.pickupFee, 'رسوم الالتقاط', 2);
          if (pkParsed.valid === false) reasons.push(`السطر ${rawRow.rowNumber}: ${pkParsed.reason}`);
          else if (pkParsed.value > 0) pickupFeeVal = pkParsed.value;
        }

        let enableBnplVal = false;
        if (!isCellEmpty(values.enableBnpl)) {
          const enParsed = parseArabicBooleanCell(values.enableBnpl);
          if (enParsed.valid === false) reasons.push(`السطر ${rawRow.rowNumber}: ${enParsed.reason}`);
          else enableBnplVal = enParsed.value;
        }

        let bnplPctVal = 0;
        if (!isCellEmpty(values.bnplPercentage)) {
          const pctParsed = parseNonNegativeNumber(values.bnplPercentage, 'نسبة BNPL %', 2, 100);
          if (pctParsed.valid === false) reasons.push(`السطر ${rawRow.rowNumber}: ${pctParsed.reason}`);
          else bnplPctVal = pctParsed.value;
        }

        let platformIdsVal: string[] = [];
        if (!isCellEmpty(values.platforms)) {
          const rawPlts = String(values.platforms).trim();
          const normWhole = normalizeArabicText(rawPlts.toLowerCase());
          if (!['الكل', 'كل المنصات', 'all'].includes(normWhole)) {
            const tokens = rawPlts
              .split(/[,،\n]+/)
              .map(t => t.trim().replace(/\s+/g, ' '))
              .filter(Boolean);
            const missingNames: string[] = [];
            for (const token of tokens) {
              const normToken = normalizeArabicText(token);
              const plt = memoryPlatforms.find(
                p => normalizeArabicText(p.name.trim().replace(/\s+/g, ' ')) === normToken
              );
              if (!plt) missingNames.push(token);
              else if (!platformIdsVal.includes(plt.id)) platformIdsVal.push(plt.id);
            }
            if (missingNames.length > 0) {
              reasons.push(`السطر ${rawRow.rowNumber}: المنصات التالية غير موجودة في النظام: ${missingNames.join('، ')}`);
            }
          }
        }

        let statusVal: 'نشط' | 'موقوف' | 'مؤرشف' = 'نشط';
        if (!isCellEmpty(values.status)) {
          const stParsed = parseItemStatusCell(values.status);
          if (stParsed.valid === false) reasons.push(`السطر ${rawRow.rowNumber}: ${stParsed.reason}`);
          else statusVal = stParsed.value;
        }

        let imageUrlVal = '';
        if (!isCellEmpty(values.imageUrl)) {
          const rawUrl = String(values.imageUrl).trim();
          if (!isValidImageUrlCell(rawUrl)) {
            reasons.push(`السطر ${rawRow.rowNumber}: رابط الصورة غير صالح (يجب أن يبدأ بـ http:// أو https:// أو / أو data:image/)`);
          } else {
            imageUrlVal = rawUrl;
          }
        }

        newPrice = salePriceVal;
        if (isNewRootCategoryVal && newRootCategoryNameVal) {
          currentValueDisplay = `صنف جديد • تصنيف جديد: ${newRootCategoryNameVal}`;
        }
        const purchaseDisplayPart = hasPurchasePricePermission(session) ? ` | الشراء: ${purchasePriceVal} ج.م` : '';
        const categoryDisplayPart = categoryNameVal
          ? ` | التصنيف: ${categoryNameVal}${isNewRootCategoryVal ? ' (تصنيف جديد سيُنشأ)' : ''}`
          : '';
        newValueDisplay = `البيع: ${salePriceVal} ج.م${purchaseDisplayPart} | الكمية: ${stockQtyVal} | الباركود: ${cleanBarcode || '—'}${categoryDisplayPart}`;

        if (reasons.length === 0) {
          if (isNewRootCategoryVal && newRootNormNameVal && newRootCategoryNameVal) {
            const canonicalRootName =
              pendingNewRootNamesByNorm.get(newRootNormNameVal) || newRootCategoryNameVal;
            pendingNewRootNamesByNorm.set(newRootNormNameVal, canonicalRootName);
            newRootCategoryNameVal = canonicalRootName;
            categoryNameVal = canonicalRootName;
            currentValueDisplay = `صنف جديد • تصنيف جديد: ${canonicalRootName}`;
            newValueDisplay = `البيع: ${salePriceVal} ج.م${purchaseDisplayPart} | الكمية: ${stockQtyVal} | الباركود: ${cleanBarcode || '—'} | التصنيف: ${canonicalRootName} (تصنيف جديد سيُنشأ)`;
          }
          actionPayload = {
            kind: 'add_item',
            itemData: {
              name: cleanName,
              printName: printNameVal,
              sku: cleanSku || undefined,
              barcode: cleanBarcode || undefined,
              secondaryBarcodes: cleanSecondary.length > 0 ? cleanSecondary : undefined,
              notes: notesVal,
              categoryId: categoryIdVal,
              categoryName: isNewRootCategoryVal ? newRootCategoryNameVal : categoryNameVal,
              isNewRootCategory: isNewRootCategoryVal,
              newRootCategoryName: newRootCategoryNameVal,
              newRootNormName: newRootNormNameVal,
              salePrice: salePriceVal,
              minPrice: minPriceVal,
              purchasePrice: purchasePriceVal,
              packagingCost: packagingCostVal,
              taxRate: taxRateVal,
              pickupFee: pickupFeeVal,
              enableBnpl: enableBnplVal,
              bnplPercentage: bnplPctVal,
              stockQuantity: stockQtyVal,
              reorderLimit: reorderLimitVal,
              platformIds: platformIdsVal,
              supplier: supplierVal,
              unit: unitVal,
              status: statusVal,
              imageUrl: imageUrlVal
            }
          };
        }
        break;
      }

      case 'delete_items': {
        if (matchedItem) {
          const itemWhRows = memoryWarehouseStocks.filter(ws => ws.itemId === matchedItem.id);
          const totalStock = Math.round(Number(recomputeItemTotalStock(matchedItem.id)) * 1000) / 1000;
          const nonZeroWhStocks = itemWhRows.filter(ws => Math.round(Number(ws.quantity || 0) * 1000) / 1000 !== 0);

          currentValueDisplay = `الرصيد: ${totalStock} | السعر: ${matchedItem.salePrice} ج.م`;
          newValueDisplay = 'سيُحذف نهائيًا';

          const txReasons: string[] = [];
          if (totalStock !== 0) {
            txReasons.push(`وجود رصيد ${totalStock}`);
          } else if (nonZeroWhStocks.length > 0) {
            const whDetails = nonZeroWhStocks
              .map(ws => {
                const whName = memoryWarehouses.find(w => w.id === ws.warehouseId)?.name || ws.warehouseId;
                return `${whName}: ${Math.round(Number(ws.quantity || 0) * 1000) / 1000}`;
              })
              .join('، ');
            txReasons.push(`وجود رصيد غير مصفر في المخازن (${whDetails})`);
          }
          if (memoryInvoices.some(inv => (inv.lines || []).some(l => l.itemId === matchedItem.id))) {
            txReasons.push('وجود فواتير بيع');
          }
          if (memoryPurchases.some(p => (p.lines || []).some(l => l.itemId === matchedItem.id))) {
            txReasons.push('وجود فواتير شراء');
          }
          if (memoryReturns.some(ret => (ret.lines || []).some(l => l.itemId === matchedItem.id))) {
            txReasons.push('وجود مرتجعات بيع');
          }
          if (memoryPurchaseReturns.some(pr => (pr.lines || []).some(l => l.itemId === matchedItem.id))) {
            txReasons.push('وجود مرتجعات شراء');
          }

          if (txReasons.length > 0) {
            reasons.push(`لا يمكن حذف "${matchedItem.name}" ل${txReasons.join(' و')}`);
          } else if (reasons.length === 0) {
            actionPayload = { kind: 'delete_item' };
          }
        } else {
          newValueDisplay = 'سيُحذف نهائيًا';
        }
        break;
      }
    }

    const rawValues: Record<string, any> = {};
    if (operationType === 'add_items') {
      rawValues['اسم الصنف'] = inputName;
      rawValues['اسم الطباعة'] = values.printName ?? '';
      rawValues['الكمية'] = values.stockQuantity ?? '';
      rawValues['التصنيف'] = values.rootCategory ?? '';
      rawValues['الباركود الرئيسي'] = values.barcode ?? '';
      rawValues['سعر البيع'] = values.salePrice ?? '';
      rawValues['سعر الشراء'] = values.purchasePrice ?? '';
      rawValues['وصف الصنف'] = values.notes ?? '';
      rawValues['الوحدة'] = values.unit ?? '';
      rawValues['الحد الأدنى للكمية'] = values.reorderLimit ?? '';
      rawValues['المورد'] = values.supplier ?? '';
      rawValues['نسبة الضريبة'] = values.taxRate ?? '';
    } else {
      const meta = BULK_EDIT_OP_META[operationType];
      if (meta && meta.headers.length > 0) {
        rawValues[meta.headers[0]] = inputName;
        if (operationType === 'primary_barcode') {
          rawValues['الباركود الجديد'] = values.barcode ?? rawRow.newPriceRaw ?? '';
          rawValues['الكود'] = codeOrBarcode;
        } else if (operationType === 'add_secondary_barcode') {
          rawValues['الباركود المضاف'] = values.barcode ?? rawRow.newPriceRaw ?? '';
          rawValues['الكود'] = codeOrBarcode;
        } else if (operationType === 'stock_quantity') {
          rawValues['الكمية'] = values.quantity ?? rawRow.newPriceRaw ?? '';
          rawValues['الكود'] = codeOrBarcode;
        } else if (operationType === 'reorder_limit') {
          rawValues['الحد الأدنى'] = values.primary ?? rawRow.newPriceRaw ?? '';
          rawValues['الكود'] = codeOrBarcode;
        } else if (operationType === 'category') {
          const catRaw = values.rootCategory ?? values.primary ?? rawRow.newPriceRaw ?? '';
          const subRaw = values.subCategory ?? '';
          rawValues['التصنيف'] =
            catRaw && subRaw
              ? `${String(catRaw).trim()} / ${String(subRaw).trim()}`
              : catRaw ?? '';
          rawValues['الكود/الباركود'] = codeOrBarcode;
        } else {
          if (meta.headers[1]) {
            rawValues[meta.headers[1]] =
              values.primary ??
              values.newName ??
              values.printName ??
              values.barcode ??
              values.notes ??
              values.rootCategory ??
              values.platforms ??
              values.enableBnpl ??
              values.supplier ??
              values.unit ??
              values.status ??
              values.imageUrl ??
              rawRow.newPriceRaw ??
              '';
          }
          if (meta.headers.includes('الكود/الباركود')) {
            rawValues['الكود/الباركود'] = codeOrBarcode;
          }
        }
      }
    }

    evaluated.push({
      rowNumber: rawRow.rowNumber,
      inputName,
      codeOrBarcode,
      matchedItem,
      matchedBy,
      currentPrice,
      newPrice,
      currentValueDisplay,
      newValueDisplay,
      isUnchanged,
      actionPayload,
      reasons,
      warnings,
      rawValues
    });
  }

  // رفض جميع صفوف الصنف إذا تكرر نفس الصنف داخل الملف (باستثناء نوع إضافة باركود فرعي حيث يُسمح بأكثر من صف لنفس الصنف)
  const duplicateItemIds = new Set<string>();
  if (operationType !== 'add_secondary_barcode') {
    for (const [itemId, rowNums] of itemIdToRowNumbers.entries()) {
      if (rowNums.length > 1) {
        duplicateItemIds.add(itemId);
      }
    }
  }

  // خريطة الصف -> أسباب تكرار داخل الملف في الأسماء الجديدة / الأكواد / الباركودات
  const intraFileConflictReasons = new Map<number, string[]>();
  const addIntraConflict = (rowNumber: number, msg: string) => {
    const arr = intraFileConflictReasons.get(rowNumber) || [];
    if (!arr.includes(msg)) arr.push(msg);
    intraFileConflictReasons.set(rowNumber, arr);
  };

  if (operationType === 'name' || operationType === 'add_items') {
    for (const [, rowNums] of fileNewNamesMap.entries()) {
      if (rowNums.length > 1) {
        for (const rNum of rowNums) {
          addIntraConflict(
            rNum,
            `اسم الصنف مكرر داخل الملف (الصفوف: ${rowNums.join('، ')})`
          );
        }
      }
    }
  }

  if (
    operationType === 'barcode_sku' ||
    operationType === 'primary_barcode' ||
    operationType === 'add_secondary_barcode' ||
    operationType === 'add_items'
  ) {
    for (const [skuKey, entries] of fileSkusMap.entries()) {
      const uniqueItems = new Set(entries.map(e => e.itemId || `row-${e.rowNumber}`));
      if (uniqueItems.size > 1) {
        const rNums = entries.map(e => e.rowNumber);
        for (const e of entries) {
          addIntraConflict(
            e.rowNumber,
            `كود SKU [${skuKey}] مكرر لأكثر من صنف داخل الملف (الصفوف: ${rNums.join('، ')})`
          );
        }
      }
    }
    for (const [bcKey, entries] of fileBarcodesMap.entries()) {
      const uniqueItems = new Set(entries.map(e => e.itemId || `row-${e.rowNumber}`));
      const isDuplicateInFile =
        operationType === 'primary_barcode' || operationType === 'add_secondary_barcode'
          ? entries.length > 1
          : uniqueItems.size > 1;
      if (isDuplicateInFile) {
        const rNums = entries.map(e => e.rowNumber);
        for (const e of entries) {
          addIntraConflict(
            e.rowNumber,
            `الباركود [${bcKey}] مكرر داخل الملف (الصفوف: ${rNums.join('، ')})`
          );
        }
      }
    }
  }

  const finalRows = evaluated.map(ev => {
    const reasons = [...ev.reasons];
    if (ev.matchedItem && duplicateItemIds.has(ev.matchedItem.id)) {
      const dupRows = itemIdToRowNumbers.get(ev.matchedItem.id) || [];
      reasons.unshift(
        `الصنف مكرر داخل الملف (الصفوف: ${dupRows.join('، ')}) — تم رفض جميع صفوف هذا الصنف`
      );
    }
    const intra = intraFileConflictReasons.get(ev.rowNumber);
    if (intra && intra.length > 0) {
      reasons.push(...intra);
    }

    let status: 'will_update' | 'unchanged' | 'error';
    if (reasons.length > 0 || (operationType !== 'add_items' && !ev.matchedItem)) {
      status = 'error';
    } else if (ev.isUnchanged || !ev.actionPayload) {
      status = 'unchanged';
    } else {
      status = 'will_update';
    }

    return {
      rowNumber: ev.rowNumber,
      itemId: ev.matchedItem?.id,
      itemName: ev.matchedItem?.name || ev.inputName || 'بدون اسم',
      inputName: ev.inputName,
      codeOrBarcode: ev.codeOrBarcode || undefined,
      matchedBy: ev.matchedBy,
      currentPrice: ev.currentPrice,
      newPrice: ev.newPrice,
      currentValueDisplay: ev.currentValueDisplay,
      newValueDisplay: ev.newValueDisplay,
      status,
      reason: reasons.length > 0 ? reasons.join(' • ') : undefined,
      warning: status === 'will_update' && ev.warnings.length > 0 ? ev.warnings.join(' • ') : undefined,
      rawValues: ev.rawValues,
      _actionPayload: status === 'will_update' ? ev.actionPayload : undefined
    };
  });

  // تجميع التصنيفات الجديدة المزمع إضافتها وحساب عدد الأصناف ذات سعر البيع = 0 (من الصفوف الصالحة فقط)
  const newCategoryCountsByNorm = new Map<string, { name: string; itemsCount: number }>();
  let zeroSalePriceCount = 0;
  if (operationType === 'add_items') {
    for (const row of finalRows) {
      if (row.status !== 'will_update' || row._actionPayload?.kind !== 'add_item') continue;
      const d = row._actionPayload.itemData;
      if (Number(d.salePrice || 0) === 0) {
        zeroSalePriceCount += 1;
      }
      if (d.isNewRootCategory && d.newRootNormName && d.newRootCategoryName) {
        const prev = newCategoryCountsByNorm.get(d.newRootNormName);
        if (prev) {
          prev.itemsCount += 1;
        } else {
          newCategoryCountsByNorm.set(d.newRootNormName, {
            name: d.newRootCategoryName,
            itemsCount: 1
          });
        }
      }
    }
  } else if (operationType === 'category') {
    for (const row of finalRows) {
      if (row.status !== 'will_update' || row._actionPayload?.kind !== 'category') continue;
      const act = row._actionPayload;
      if (act.isNewRootCategory && act.newRootNormName && act.newRootCategoryName) {
        const prev = newCategoryCountsByNorm.get(act.newRootNormName);
        if (prev) {
          prev.itemsCount += 1;
        } else {
          newCategoryCountsByNorm.set(act.newRootNormName, {
            name: act.newRootCategoryName,
            itemsCount: 1
          });
        }
      }
    }
  }
  const newCategories = Array.from(newCategoryCountsByNorm.values());
  const zeroSalePriceWarning =
    operationType === 'add_items' && zeroSalePriceCount > 0
      ? `تم استيراد ${zeroSalePriceCount} صنفًا بسعر بيع صفر — راجع أسعارها`
      : undefined;

  const summary: BulkEditExcelSummary = {
    totalRows: finalRows.length,
    willUpdateCount: finalRows.filter(r => r.status === 'will_update').length,
    unchangedCount: finalRows.filter(r => r.status === 'unchanged').length,
    errorCount: finalRows.filter(r => r.status === 'error').length,
    warningCount: finalRows.filter(r => r.status === 'will_update' && Boolean(r.warning)).length,
    ...(operationType === 'add_items'
      ? {
          zeroSalePriceCount,
          ...(zeroSalePriceWarning ? { zeroSalePriceWarning } : {})
        }
      : {}),
    ...(newCategories.length > 0 ? { newCategories } : {})
  };

  return { rows: finalRows, summary, newCategories, zeroSalePriceCount, zeroSalePriceWarning };
}

/**
 * تنزيل نموذج الإكسيل للتعديل الجماعي للأصناف
 */
export async function generateBulkPriceEditTemplateBuffer(
  operationType: string | undefined,
  session?: BulkEditSessionInfo
): Promise<{
  success: boolean;
  statusCode?: number;
  buffer?: Buffer;
  fileName?: string;
  cairoDate?: string;
  error?: string;
}> {
  const access = validateBulkEditAccess(operationType, session);
  if (access.ok === false) {
    return { success: false, statusCode: access.statusCode, error: access.error };
  }

  const meta = BULK_EDIT_OP_META[access.opType];
  const aoa: any[][] = [meta.headers];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // ضبط أعمدة الأكواد والباركودات كنص لمنع فقدان الأصفار البادئة أو التحول لصيغة علمية
  for (let r = 1; r <= 200; r++) {
    for (const cIdx of meta.textCols) {
      const ref = XLSX.utils.encode_cell({ r, c: cIdx });
      const existingVal = ws[ref]?.v !== undefined ? String(ws[ref].v) : '';
      ws[ref] = { t: 's', v: existingVal, z: '@' };
    }
  }
  const lastSheetRow =
    access.opType === 'add_items' ||
    access.opType === 'add_categories' ||
    access.opType === 'delete_categories'
      ? 0
      : 200;
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: lastSheetRow, c: meta.headers.length - 1 }
  });
  ws['!cols'] = meta.colWidths;
  ws['!views'] = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, meta.sheetName);

  if (access.opType === 'add_items') {
    const sampleCategoryName =
      memoryCategories.find(c => !c.parentCategoryId && isCategoryActiveForImport(c))?.name ||
      'إلكترونيات';
    const guideAoa: any[][] = [
      meta.headers,
      [
        'شاحن سريع 65 واط تايب سي - أسود [S65-BLK]',
        'شاحن سريع 65 واط تايب سي',
        10,
        sampleCategoryName,
        '6221234567890',
        450,
        300,
        'شاحن أصلي يدعم الشحن السريع PD مع كابل تايب سي',
        'قطعة',
        5,
        'شركة النيل للإلكترونيات',
        14,
        '6221234567890.jpg'
      ],
      [
        'كابل تايب سي 1 متر أبيض [C1M-WHT]',
        '',
        '',
        '',
        '6229876543210',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        ''
      ],
      [],
      ['الأعمدة الأساسية (الإلزامية) — عمودان فقط يجب وجودهما وتعبئتهما في كل سطر:'],
      ['1. اسم الصنف: الاسم الداخلي للصنف في النظام (إلزامي، لا يتكرر).'],
      ['2. الباركود الرئيسي: باركود الصنف الأساسي (إلزامي، يفضّل تنسيق العمود كنص، لا يتكرر، ويقبل الأرقام العربية والإنجليزية).'],
      [],
      ['الأعمدة الاختيارية — يمكن ترك خلاياها فارغة أو حذف العمود بالكامل من الملف (أي خانة فارغة تأخذ صفراً للأرقام وفراغاً للنصوص):'],
      ['1. اسم الطباعة: الاسم المختصر النظيف الذي يظهر للعميل في الفاتورة المطبوعة (حتى 120 حرفاً، والافتراضي عند الترك: نص فارغ).'],
      ['2. الكمية: الرصيد الافتتاحي بالمخزن المحدد (رقم 0 أو أكثر، والافتراضي عند الترك: 0).'],
      ['3. التصنيف: اسم التصنيف الكامل المطابق لتصنيف موجود (رئيسي أو فرعي) كما هو، شاملاً أي رموز مثل / أو > أو الأقواس (الافتراضي عند الترك: صنف بدون تصنيف).'],
      ['4. سعر البيع: سعر بيع الصنف للجمهور (رقم 0 أو أكثر، والافتراضي عند الترك: 0 مع تنبيه غير مانع لمراجعة الأسعار).'],
      ['5. سعر الشراء: تكلفة شراء الصنف (رقم 0 أو أكثر، والافتراضي عند الترك: 0).'],
      ['6. وصف الصنف: ملاحظات ووصف تفصيلي للصنف (الافتراضي عند الترك: نص فارغ).'],
      ['7. الوحدة: وحدة القياس (الافتراضي عند الترك: قطعة).'],
      ['8. الحد الأدنى للكمية: حد إعادة الطلب والتنبيه (الافتراضي عند الترك: 0).'],
      ['9. المورد: اسم المورد الافتراضي للصنف (الافتراضي عند الترك: نص فارغ).'],
      ['10. نسبة الضريبة: نسبة الضريبة المئوية من 0 إلى 100 (الافتراضي عند الترك: 0).'],
      ['11. الصورة: اسم ملف صورة الصنف جوه الملف المضغوط (zip) زي 6221234567890.jpg، أو حط الصورة نفسها جوه الخانة. لو سبتها فاضية بياخد الصورة اللي اسمها نفس الباركود الرئيسي. الروابط (http) مش مقبولة.'],
      [],
      ['قواعد القيم الافتراضية والأرقام:'],
      ['• أي خانة اختيارية فارغة (أو عمودها غير موجود أصلاً) تأخذ تلقائياً: 0 للحقول الرقمية، ونصاً فارغاً للحقول النصية، وبدون تصنيف للتصنيف الفارغ.'],
      ['• الأرقام المكتوبة بالأرقام العربية (مثل ١٠ أو ١٢٫٥ أو ١٢,٥) تُقبل وتُحوَّل تلقائياً إلى أرقام عادية في كل الخانات الرقمية وفي الباركود.'],
      ['• القيمة المكتوبة غير الصالحة (نص داخل خانة رقمية مثل «عشرة» أو «10 جنيه»، أو رقم سالب) تُرفض برسالة خطأ على الصف ولا تتحول إلى صفر بصمت.'],
      [],
      ['شرح تحديد عمود التصنيف الواحد:'],
      ['• ترك خانة التصنيف فارغة: يُضاف الصنف بدون تصنيف.'],
      ['• تُعامل قيمة خلية «التصنيف» كاسم كامل حرفي وتُطابق مع أسماء التصنيفات الموجودة (الرئيسية والفرعية) دون تقسيم عند / أو > أو أي علامة ترقيم.'],
      ['• إذا وُجد تصنيف واحد مطابق بالضبط: يُستخدم معرّفه الحالي لربط الصنف به.'],
      ['• إذا وُجد أكثر من تصنيف بنفس الاسم تحت آباء مختلفين: يُرفض الصف باعتباره ملتبساً دون تخمين أو إنشاء نسخة إضافية.'],
      ['• إذا لم يوجد أي تصنيف مطابق: يُنشأ تصنيف رئيسي جديد تلقائياً بالاسم المكتوب كما هو عند تأكيد الاستيراد (مرة واحدة فقط حتى لو تكرر في عدة صفوف) وتُربط كل الأصناف الصحيحة به.']
    ];
    const guideWs = XLSX.utils.aoa_to_sheet(guideAoa);
    for (const rIdx of [1, 2]) {
      const ref = XLSX.utils.encode_cell({ r: rIdx, c: 4 });
      if (guideWs[ref]) {
        guideWs[ref] = { t: 's', v: String(guideWs[ref].v ?? ''), z: '@' };
      }
    }
    guideWs['!cols'] = meta.colWidths;
    guideWs['!views'] = [{ rightToLeft: true }];
    XLSX.utils.book_append_sheet(wb, guideWs, 'مثال وتعليمات');
  } else if (access.opType === 'add_categories') {
    const guideAoa: any[][] = [
      meta.headers,
      ['المشروبات', ''],
      ['إلكترونيات', 'شواحن'],
      ['إلكترونيات', 'كابلات'],
      ['إلكترونيات', 'سماعات'],
      [],
      ['تعليمات استخدام نموذج إضافة التصنيفات بالإكسيل:'],
      ['1. العمود الأول «التصنيف الرئيسي» إلزامي في كل صف، والعمود الثاني «التصنيف الفرعي» اختياري.'],
      ['2. إذا كان عمود «التصنيف الفرعي» فارغاً (مثل صف «المشروبات»)، يُضاف التصنيف الرئيسي فقط.'],
      ['3. يمكن تكرار اسم التصنيف الرئيسي في عدة صفوف (مثل «إلكترونيات») لإضافة أكثر من تصنيف فرعي تحته، وسيتم إنشاء الرئيسي مرة واحدة فقط وربط جميع الفروع به.'],
      ['4. إذا كان التصنيف الرئيسي موجوداً بالفعل في النظام، يتم إعادة استخدامه تلقائياً دون إنشاء نسخة مكررة.'],
      ['5. إذا كان التصنيف الفرعي موجوداً مسبقاً تحت نفس الرئيسي، يتم تجاوزه كمكرر ولا تُعدَّل بياناته بصمت.'],
      ['6. هذا القالب يدعم مستويين فقط عبر العمودين («التصنيف الرئيسي» و«التصنيف الفرعي») ولا يُسمح بأعمدة مستويات إضافية؛ وتُعامل الرموز داخل اسم التصنيف مثل (/ أو > أو - أو الأقواس أو & أو +) كجزء حرفي من الاسم.'],
      ['7. لا تقوم هذه العملية بحذف أو إعادة تسمية أي تصنيفات حالية ولا تغيّر ربط الأصناف الحالية.'],
      [`8. الحد الأقصى المسموح به هو ${BULK_EDIT_EXCEL_MAX_ROWS} صف في الملف الواحد.`]
    ];
    const guideWs = XLSX.utils.aoa_to_sheet(guideAoa);
    guideWs['!cols'] = [{ wch: 46 }, { wch: 36 }];
    guideWs['!views'] = [{ rightToLeft: true }];
    XLSX.utils.book_append_sheet(wb, guideWs, 'مثال وتعليمات');
  } else if (access.opType === 'delete_categories') {
    const guideAoa: any[][] = [
      meta.headers,
      ['شواحن'],
      ['كابلات'],
      ['إلكترونيات'],
      [],
      ['تعليمات استخدام نموذج حذف التصنيفات بالإكسيل:'],
      ['1. تحتوي ورقة البيانات «حذف التصنيفات» على عمود واحد فقط بعنوان «اسم التصنيف».'],
      ['2. يُطابق اسم التصنيف الكامل حرفياً مع التصنيفات الموجودة في النظام دون تقسيم الاسم عند (/ أو > أو - أو الأقواس أو أي علامة ترقيم).'],
      ['3. إذا كان الاسم مكرراً في أكثر من مكان بالهرمية (مثل فرعي بنفس الاسم تحت رئيسيين مختلفين)، يُعتبر ملتبساً ويُرفض الصف دون تخمين.'],
      ['4. لا يُسمح بحذف تصنيف مرتبط بأي صنف مباشرة، ولا تصنيف رئيسي له تصنيفات فرعية مرتبطة بأصناف.'],
      ['5. لا يُحذف تصنيف رئيسي تحته تصنيفات فرعية إلا إذا كانت جميع فروعه مدرجة في نفس الملف وقابلة للحذف (حيث يحذف النظام الفروع أولاً ثم الرئيسي حتى لا تبقى فروع يتيمة).'],
      ['6. الصفوف المكررة داخل الملف تُرفض ولا تُنفَّذ بشكل مكرر.'],
      [`7. الحد الأقصى المسموح به هو ${BULK_EDIT_EXCEL_MAX_ROWS} صف في الملف الواحد.`]
    ];
    const guideWs = XLSX.utils.aoa_to_sheet(guideAoa);
    guideWs['!cols'] = [{ wch: 64 }];
    guideWs['!views'] = [{ rightToLeft: true }];
    XLSX.utils.book_append_sheet(wb, guideWs, 'مثال وتعليمات');
  }

  const rawBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const finalBuffer = patchXlsxFreezeTopRow(rawBuffer, {
    styleAddItemsHeaders: access.opType === 'add_items'
  });
  const cairoDate = getCairoDateString();
  const fileName = `${meta.fileSlug}-${cairoDate}.xlsx`;

  return {
    success: true,
    statusCode: 200,
    buffer: finalBuffer,
    fileName,
    cairoDate
  };
}

function decodeBase64XlsxPayload(fileBase64?: string): Buffer | null {
  if (!fileBase64 || typeof fileBase64 !== 'string') return null;
  const cleaned = fileBase64.replace(/^data:[^;]+;base64,/i, '').trim();
  if (!cleaned) return null;
  return Buffer.from(cleaned, 'base64');
}

type PrepareBulkEditInputResult =
  | { success: false; statusCode: number; error: string }
  | { success: true; opType: BulkEditOperationType; fileName: string; inputRows: BulkEditParsedInputRow[]; headers?: unknown[] };

async function prepareBulkEditInputRows(
  payload: {
    operationType?: string;
    fileName?: string;
    fileBase64?: string;
    xlsxBuffer?: Buffer;
    rows?: BulkEditParsedInputRow[];
    headers?: unknown[];
  },
  session?: BulkEditSessionInfo
): Promise<PrepareBulkEditInputResult> {
  const access = validateBulkEditAccess(payload?.operationType, session);
  if (access.ok === false) {
    return { success: false, statusCode: access.statusCode, error: access.error };
  }

  let inputRows: BulkEditParsedInputRow[] | null = null;
  let extractedHeaders: unknown[] | undefined = Array.isArray(payload.headers) ? payload.headers : undefined;
  if (payload.xlsxBuffer || payload.fileBase64) {
    const buf = payload.xlsxBuffer || decodeBase64XlsxPayload(payload.fileBase64);
    if (!buf || buf.length === 0) {
      return { success: false, statusCode: 400, error: 'الملف المرفوع فارغ أو غير صالح.' };
    }
    const parsed = extractRowsFromBulkEditXlsxBuffer(buf, access.opType, payload.fileName);
    if (parsed.ok === false) {
      return { success: false, statusCode: parsed.statusCode, error: parsed.error };
    }
    inputRows = parsed.rows;
    extractedHeaders = parsed.headers;
  } else if (Array.isArray(payload.rows)) {
    if (access.opType === 'add_items' && Array.isArray((payload as any).headers)) {
      const hRow = ((payload as any).headers as unknown[]).map(normalizeExcelHeaderLabel);
      const uCols = new Set<number>();
      const missingMandatory: string[] = [];
      const checkCol = (label: string, aliases: string[]) => {
        const idx = findColumnIndex(hRow, aliases, uCols);
        if (idx === -1) missingMandatory.push(label);
        else uCols.add(idx);
      };
      checkCol('اسم الصنف', ['اسم الصنف', 'اسم المنتج', 'الاسم']);
      checkCol('الباركود الرئيسي', ['الباركود الرئيسي', 'الباركود الأساسي', 'الباركود']);
      if (missingMandatory.length > 0) {
        return {
          success: false,
          statusCode: 400,
          error: `الملف ناقص عمود: ${missingMandatory.join('، ')} — نزّل النموذج الجديد`
        };
      }
    }
    if (payload.rows.length === 0) {
      return { success: false, statusCode: 400, error: 'الملف لا يحتوي على أي صفوف بيانات.' };
    }
    if (payload.rows.length > BULK_EDIT_EXCEL_MAX_ROWS) {
      return {
        success: false,
        statusCode: 400,
        error: `تم تجاوز الحد الأقصى المسموح به (${BULK_EDIT_EXCEL_MAX_ROWS} صف كحد أقصى في الملف الواحد).`
      };
    }
    inputRows = payload.rows;
  } else {
    return { success: false, statusCode: 400, error: 'يرجى رفع ملف إكسيل للمعاينة.' };
  }

  return {
    success: true,
    opType: access.opType,
    fileName: payload.fileName || '',
    inputRows,
    headers: extractedHeaders
  };
}

async function runBulkEditEvaluation(
  payload: {
    operationType?: string;
    fileName?: string;
    fileBase64?: string;
    xlsxBuffer?: Buffer;
    rows?: BulkEditParsedInputRow[];
    warehouseId?: string;
  },
  session?: BulkEditSessionInfo
) {
  const prepared = await prepareBulkEditInputRows(payload, session);
  if (prepared.success === false) {
    return {
      success: false as const,
      statusCode: prepared.statusCode,
      error: prepared.error
    };
  }

  const opType = prepared.opType;
  let targetWarehouse: Warehouse | undefined = undefined;
  if (opType === 'stock_quantity' || opType === 'reorder_limit' || opType === 'add_items') {
    const whRes = resolveWarehouseForOperation((payload as any).warehouseId, session as any, {
      requireActive: true,
      enforceUserAccess: true,
      allowFallbackWhenOmitted: true
    });
    if (!whRes.ok) {
      return {
        success: false as const,
        statusCode: whRes.statusCode,
        error: whRes.error
      };
    }
    targetWarehouse = whRes.warehouse;
  }

  let categoriesOverride: ProductCategory[] | undefined;
  if (opType === 'add_categories' && isSheetsDataMode(getSystemConfig())) {
    try {
      const sheetCats = await getCategories(session);
      categoriesOverride = flattenCategoriesList(sheetCats);
    } catch (err: any) {
      return {
        success: false as const,
        statusCode: 503,
        error: err?.message || 'تعذر جلب التصنيفات الحالية للتحقق من الملف'
      };
    }
  }

  const evaluated = evaluateBulkEditRows(
    prepared.inputRows,
    prepared.opType,
    session,
    targetWarehouse,
    categoriesOverride
  );
  return {
    success: true as const,
    statusCode: 200,
    operationType: prepared.opType,
    fileName: prepared.fileName,
    targetWarehouse,
    summary: evaluated.summary,
    newCategories: evaluated.newCategories,
    ...(prepared.opType === 'add_items'
      ? {
          zeroSalePriceCount: evaluated.zeroSalePriceCount,
          ...(evaluated.zeroSalePriceWarning
            ? {
                zeroSalePriceWarning: evaluated.zeroSalePriceWarning,
                warnings: [evaluated.zeroSalePriceWarning]
              }
            : {})
        }
      : {}),
    rows: evaluated.rows
  };
}

/**
 * معاينة ملف إكسيل قبل تنفيذ التعديل الجماعي للأصناف
 */
export async function previewBulkPriceEditExcel(
  payload: {
    operationType?: string;
    fileName?: string;
    fileBase64?: string;
    xlsxBuffer?: Buffer;
    rows?: BulkEditParsedInputRow[];
    warehouseId?: string;
  },
  session?: BulkEditSessionInfo
) {
  const config = getSystemConfig();
  if (
    isSheetsDataMode(config) &&
    payload?.operationType !== 'add_categories' &&
    payload?.operationType !== 'delete_categories' &&
    payload?.operationType !== 'add_items'
  ) {
    const prepared = await prepareBulkEditInputRows(payload, session);
    if (prepared.success === false) {
      return prepared;
    }
    const gasRes = await callAppsScript(
      'bulkEditExcel',
      {
        operationType: prepared.opType,
        fileName: prepared.fileName,
        headers: prepared.headers,
        rows: prepared.inputRows,
        warehouseId: (payload as any)?.warehouseId,
        dryRun: true
      },
      session?.token,
      undefined,
      90000
    );
    if (gasRes && gasRes.success) {
      return gasRes;
    }
    const failure = buildSheetsWriteFailure(gasRes, 'تعذر معاينة ملف التعديل في Google Sheets');
    return {
      ...failure,
      statusCode: gasRes?.isTimeout ? 504 : (gasRes?.isTransportError ? 503 : (gasRes?.statusCode || 400))
    };
  }

  const evaluated = await runBulkEditEvaluation(payload, session);
  if (evaluated.success === false) {
    return evaluated;
  }
  return {
    success: true,
    statusCode: 200,
    operationType: evaluated.operationType,
    fileName: evaluated.fileName,
    warehouseId: evaluated.targetWarehouse?.id,
    warehouseName: evaluated.targetWarehouse?.name,
    summary: evaluated.summary,
    ...(evaluated.newCategories && evaluated.newCategories.length > 0
      ? { newCategories: evaluated.newCategories }
      : {}),
    rows: evaluated.rows.map(({ _actionPayload, ...publicRow }) => publicRow)
  };
}

interface BulkEditUndoSnapshotEntry {
  itemId: string;
  itemName: string;
  previousItem: Item;
  previousBarcodes: ItemBarcode[];
  previousWarehouseId?: string;
  previousWarehouseQty?: number;
  previousWarehouseReorderLimit?: number | null;
}

interface BulkEditUndoRecord {
  batchId: string;
  operationType: BulkEditOperationType;
  operationLabel: string;
  fileName: string;
  warehouseId?: string;
  warehouseName?: string;
  executedAt: string;
  executedBy: string;
  executedById: string;
  snapshots: BulkEditUndoSnapshotEntry[];
  createdCategoryIds?: string[];
}

let lastBulkEditUndoRecord: BulkEditUndoRecord | null = null;

/**
 * تنفيذ التعديل / الإضافة / الحذف الجماعي للأصناف بالإكسيل (دون المساس بالفواتير السابقة)
 */
export async function executeBulkPriceEditExcel(
  payload: {
    operationType?: string;
    fileName?: string;
    fileBase64?: string;
    xlsxBuffer?: Buffer;
    rows?: BulkEditParsedInputRow[];
    warehouseId?: string;
  },
  session?: BulkEditSessionInfo
) {
  const config = getSystemConfig();
  if (
    isSheetsDataMode(config) &&
    payload?.operationType !== 'add_categories' &&
    payload?.operationType !== 'delete_categories' &&
    payload?.operationType !== 'add_items'
  ) {
    const prepared = await prepareBulkEditInputRows(payload, session);
    if (prepared.success === false) {
      return {
        success: false,
        statusCode: prepared.statusCode || 400,
        updatedCount: 0,
        unchangedCount: 0,
        errorCount: 0,
        error: prepared.error || 'فشل التحقق من ملف التعديل'
      };
    }

    const SHEETS_CHUNK_SIZE = 500;
    if (prepared.inputRows.length > SHEETS_CHUNK_SIZE) {
      const previewGas = await callAppsScript(
        'bulkEditExcel',
        {
          operationType: prepared.opType,
          fileName: prepared.fileName,
          headers: prepared.headers,
          rows: prepared.inputRows,
          warehouseId: (payload as any)?.warehouseId,
          dryRun: true
        },
        session?.token,
        undefined,
        90000
      );

      if (!previewGas || !previewGas.success) {
        const failure = buildSheetsWriteFailure(previewGas, 'تعذر التحقق من ملف التعديل في Google Sheets');
        return {
          ...failure,
          statusCode: previewGas?.isTimeout ? 504 : (previewGas?.isTransportError ? 503 : (previewGas?.statusCode || 400)),
          updatedCount: 0,
          unchangedCount: Number(previewGas?.summary?.unchangedCount || 0),
          errorCount: Number(previewGas?.summary?.errorCount || 0)
        };
      }

      const evaluatedPreviewRows: any[] = Array.isArray(previewGas.rows) ? previewGas.rows : [];
      const previewRowByNumber = new Map<number, any>();
      for (const pr of evaluatedPreviewRows) {
        previewRowByNumber.set(Number(pr.rowNumber), pr);
      }

      const validInputRows = prepared.inputRows.filter(
        r => previewRowByNumber.get(r.rowNumber)?.status === 'will_update'
      );

      if (validInputRows.length === 0) {
        const errCount = Number(previewGas.summary?.errorCount || 0);
        return {
          success: false,
          statusCode: 400,
          operationType: prepared.opType,
          fileName: prepared.fileName,
          warehouseId: previewGas.warehouseId,
          warehouseName: previewGas.warehouseName,
          updatedCount: 0,
          unchangedCount: Number(previewGas.summary?.unchangedCount || 0),
          errorCount: errCount,
          warningCount: Number(previewGas.summary?.warningCount || 0),
          summary: previewGas.summary,
          rows: evaluatedPreviewRows,
          error:
            errCount > 0
              ? 'لم يتم تنفيذ أي صف لأن جميع الصفوف تحتوي على أخطاء أو بدون تغيير.'
              : 'لا توجد تغييرات فعلية لتنفيذها.'
        };
      }

      const batchPrefix = prepared.opType === 'add_items' ? 'BULK-ADD' : prepared.opType === 'delete_items' ? 'BULK-DEL' : 'BULK-EDIT';
      const sharedBatchId = `${batchPrefix}-${Date.now().toString().slice(-6)}`;
      const totalChunks = Math.ceil(validInputRows.length / SHEETS_CHUNK_SIZE);
      let cumulativeUpdated = 0;
      const mergedExecutedByRowNum = new Map<number, any>();
      const chunkNewCatsByNorm = new Map<string, { id?: string; name: string; itemsCount: number }>();
      let lastChunkRes: any = null;

      for (let i = 0; i < totalChunks; i++) {
        const chunk = validInputRows.slice(i * SHEETS_CHUNK_SIZE, (i + 1) * SHEETS_CHUNK_SIZE);
        const isLastChunk = i === totalChunks - 1;
        const chunkRes = await callAppsScript(
          'bulkEditExcel',
          {
            operationType: prepared.opType,
            fileName: prepared.fileName,
            headers: prepared.headers,
            rows: chunk,
            warehouseId: (payload as any)?.warehouseId,
            dryRun: false,
            batchId: sharedBatchId,
            skipAuditLog: !isLastChunk,
            ...(isLastChunk
              ? {
                  auditSummary: {
                    updatedCount: cumulativeUpdated + chunk.length,
                    unchangedCount: Number(previewGas.summary?.unchangedCount || 0),
                    errorCount: Number(previewGas.summary?.errorCount || 0)
                  }
                }
              : {})
          },
          session?.token,
          undefined,
          90000
        );

        if (!chunkRes || !chunkRes.success) {
          const failure = buildSheetsWriteFailure(chunkRes, `تعذر تنفيذ الدفعة (${i + 1}/${totalChunks}) في Google Sheets`);
          return {
            ...failure,
            statusCode: chunkRes?.isTimeout ? 504 : (chunkRes?.isTransportError ? 503 : (chunkRes?.statusCode || 400)),
            updatedCount: cumulativeUpdated,
            unchangedCount: Number(previewGas.summary?.unchangedCount || 0),
            errorCount: Number(previewGas.summary?.errorCount || 0)
          };
        }

        cumulativeUpdated += Number(chunkRes.updatedCount || 0);
        lastChunkRes = chunkRes;
        if (Array.isArray(chunkRes.newCategories)) {
          for (const nc of chunkRes.newCategories) {
            if (!nc || !nc.name) continue;
            const nk = normalizeItemName(nc.name);
            const prevNc = chunkNewCatsByNorm.get(nk);
            if (prevNc) {
              prevNc.itemsCount += Number(nc.itemsCount || 0);
            } else {
              chunkNewCatsByNorm.set(nk, {
                id: nc.id,
                name: nc.name,
                itemsCount: Number(nc.itemsCount || 0)
              });
            }
          }
        }
        if (Array.isArray(chunkRes.rows)) {
          for (const cr of chunkRes.rows) {
            mergedExecutedByRowNum.set(Number(cr.rowNumber), cr);
          }
        }
      }

      const mergedNewCategories = Array.from(chunkNewCatsByNorm.values());
      const mergedRows = evaluatedPreviewRows.map(pr => mergedExecutedByRowNum.get(Number(pr.rowNumber)) || pr);
      return {
        ...lastChunkRes,
        success: true,
        statusCode: 200,
        batchId: sharedBatchId,
        updatedCount: cumulativeUpdated,
        unchangedCount: Number(previewGas.summary?.unchangedCount || 0),
        errorCount: Number(previewGas.summary?.errorCount || 0),
        warningCount: Number(previewGas.summary?.warningCount || 0),
        ...(mergedNewCategories.length > 0 ? { newCategories: mergedNewCategories } : {}),
        summary: {
          totalRows: mergedRows.length,
          willUpdateCount: cumulativeUpdated,
          unchangedCount: Number(previewGas.summary?.unchangedCount || 0),
          errorCount: Number(previewGas.summary?.errorCount || 0),
          warningCount: Number(previewGas.summary?.warningCount || 0),
          ...(mergedNewCategories.length > 0 ? { newCategories: mergedNewCategories } : {})
        },
        rows: mergedRows,
        message: `تم ${prepared.opType === 'add_items' ? 'إضافة' : prepared.opType === 'delete_items' ? 'حذف' : 'تعديل'} ${cumulativeUpdated} صنف بنجاح (${BULK_EDIT_OP_META[prepared.opType].label}${previewGas.warehouseName ? ` — ${previewGas.warehouseName}` : ''})`
      };
    }

    const gasRes = await callAppsScript(
      'bulkEditExcel',
      {
        operationType: prepared.opType,
        fileName: prepared.fileName,
        headers: prepared.headers,
        rows: prepared.inputRows,
        warehouseId: (payload as any)?.warehouseId,
        dryRun: false
      },
      session?.token,
      undefined,
      90000
    );
    if (gasRes && gasRes.success) {
      return gasRes;
    }
    const failure = buildSheetsWriteFailure(gasRes, 'تعذر تنفيذ التعديل في Google Sheets');
    return {
      ...failure,
      statusCode: gasRes?.isTimeout ? 504 : (gasRes?.isTransportError ? 503 : (gasRes?.statusCode || 400)),
      updatedCount: 0,
      unchangedCount: Number(gasRes?.unchangedCount || 0),
      errorCount: Number(gasRes?.errorCount || 0),
      ...(gasRes?.rows ? { rows: gasRes.rows } : {}),
      ...(gasRes?.summary ? { summary: gasRes.summary } : {})
    };
  }

  const preview = await runBulkEditEvaluation(payload, session);
  if (preview.success === false) {
    return {
      success: false,
      statusCode: preview.statusCode || 400,
      updatedCount: 0,
      unchangedCount: 0,
      errorCount: 0,
      error: preview.error || 'فشل التحقق من ملف التعديل'
    };
  }

  const publicRows = preview.rows.map(({ _actionPayload, ...publicRow }) => publicRow);

  if (preview.summary.willUpdateCount === 0) {
    return {
      success: false,
      statusCode: 400,
      operationType: preview.operationType,
      fileName: preview.fileName,
      warehouseId: preview.targetWarehouse?.id,
      warehouseName: preview.targetWarehouse?.name,
      updatedCount: 0,
      unchangedCount: preview.summary.unchangedCount,
      errorCount: preview.summary.errorCount,
      warningCount: preview.summary.warningCount || 0,
      summary: preview.summary,
      rows: publicRows,
      error:
        preview.summary.errorCount > 0
          ? 'لم يتم تنفيذ أي صف لأن جميع الصفوف تحتوي على أخطاء أو بدون تغيير.'
          : 'لا توجد تغييرات فعلية لتنفيذها.'
    };
  }

  const opType = preview.operationType;
  const opMeta = BULK_EDIT_OP_META[opType];
  const now = new Date().toISOString();
  const batchSuffix = Date.now().toString().slice(-6);
  const batchPrefix =
    opType === 'add_items'
      ? 'BULK-ADD'
      : opType === 'add_categories'
      ? 'BULK-CAT'
      : opType === 'delete_categories'
      ? 'BULK-CAT-DEL'
      : opType === 'delete_items'
      ? 'BULK-DEL'
      : 'BULK-EDIT';
  const batchId = `${batchPrefix}-${batchSuffix}`;
  const userName = session?.name || session?.phone || 'مستخدم النظام';
  const userId = session?.userId || session?.id || '';
  const displayFileName = preview.fileName || 'غير مسمى';

  let lockAcquired = false;
  if (opType === 'stock_quantity' || opType === 'add_items') {
    lockAcquired = await acquireStockLock(6000);
    if (!lockAcquired) {
      return {
        success: false,
        statusCode: 409,
        updatedCount: 0,
        unchangedCount: preview.summary.unchangedCount,
        errorCount: preview.summary.errorCount,
        error: 'النظام مشغول بتحديث حركة مخزنية أخرى حالياً، يرجى المحاولة بعد لحظات.'
      };
    }
  }

  let updatedCount = 0;
  const undoSnapshots: BulkEditUndoSnapshotEntry[] = [];
  const snappedItemIds = new Set<string>();
  const createdNewCategoriesMap = new Map<string, { id: string; name: string; itemsCount: number }>();
  const deletedItemNames: string[] = [];

  try {
    if (opType === 'add_items') {
      const addTargetWh = preview.targetWarehouse || getDefaultWarehouse();
      const createdCatsByNorm = new Map<string, ProductCategory>();
      const failedCatsByNorm = new Map<string, string>();
      const canManageCatsNow = hasCategoriesManagePermission(session);
      let failedAddItemsRowsCount = 0;

      for (const row of preview.rows) {
        if (row.status !== 'will_update' || row._actionPayload?.kind !== 'add_item') continue;
        const d = row._actionPayload.itemData;
        const pubRow = publicRows.find(pr => pr.rowNumber === row.rowNumber);

        let resolvedCategoryId = d.categoryId;
        let resolvedCategoryName = d.categoryName;
        let needsNewRootCreation = Boolean(
          d.isNewRootCategory && d.newRootNormName && d.newRootCategoryName
        );
        let targetNewRootName = d.newRootCategoryName;
        let targetNewRootNorm = d.newRootNormName;

        // إعادة التحقق في السيرفر عند الحفظ إذا كان الصف مرتبطاً بتصنيف موجود وقت المعاينة
        if (resolvedCategoryId && !needsNewRootCreation) {
          const activeCats = memoryCategories.filter(isCategoryActiveForImport);
          const activeById = new Map(activeCats.map(c => [c.id, c]));
          const verifiedCat = activeCats.find(
            c =>
              c.id === resolvedCategoryId &&
              (!c.parentCategoryId || activeById.has(c.parentCategoryId))
          );
          if (verifiedCat) {
            resolvedCategoryId = verifiedCat.id;
            resolvedCategoryName = verifiedCat.name;
          } else {
            const reCheck = resolveAddItemImportCategory({
              rawCategoryInput: d.categoryName,
              categories: memoryCategories,
              canManageCategories: canManageCatsNow
            });
            if (reCheck.ok === false) {
              if (pubRow) {
                pubRow.status = 'error';
                pubRow.reason = reCheck.error;
              }
              failedAddItemsRowsCount += 1;
              continue;
            }
            if (
              reCheck.isNewRootCategory &&
              reCheck.newRootNormName &&
              reCheck.newRootCategoryName
            ) {
              needsNewRootCreation = true;
              targetNewRootName = reCheck.newRootCategoryName;
              targetNewRootNorm = reCheck.newRootNormName;
              resolvedCategoryId = undefined;
            } else {
              resolvedCategoryId = reCheck.categoryId;
              resolvedCategoryName = reCheck.categoryName;
            }
          }
        }

        // إنشاء التصنيف الرئيسي الجديد مرة واحدة فقط عند تأكيد الاستيراد وبعد التحقق من الصلاحية
        if (needsNewRootCreation && targetNewRootNorm && targetNewRootName) {
          if (!canManageCatsNow) {
            const permErr = `التصنيف "${targetNewRootName}" غير موجود، ولا تملك صلاحية إنشاء تصنيفات جديدة [categories.manage]`;
            if (pubRow) {
              pubRow.status = 'error';
              pubRow.reason = permErr;
            }
            failedAddItemsRowsCount += 1;
            continue;
          }

          if (failedCatsByNorm.has(targetNewRootNorm)) {
            const prevErr = failedCatsByNorm.get(targetNewRootNorm)!;
            if (pubRow) {
              pubRow.status = 'error';
              pubRow.reason = prevErr;
            }
            failedAddItemsRowsCount += 1;
            continue;
          }

          let createdCat = createdCatsByNorm.get(targetNewRootNorm);
          if (!createdCat) {
            const liveCatRes = resolveAddItemImportCategory({
              rawCategoryInput: targetNewRootName,
              categories: memoryCategories,
              canManageCategories: canManageCatsNow
            });
            if (liveCatRes.ok === false) {
              failedCatsByNorm.set(targetNewRootNorm, liveCatRes.error);
              if (pubRow) {
                pubRow.status = 'error';
                pubRow.reason = liveCatRes.error;
              }
              failedAddItemsRowsCount += 1;
              continue;
            }

            if (!liveCatRes.isNewRootCategory && liveCatRes.categoryId) {
              createdCat = memoryCategories.find(c => c.id === liveCatRes.categoryId);
            }

            if (!createdCat) {
              const saveCatRes = await saveCategory(
                {
                  name: targetNewRootName,
                  parentCategoryId: null,
                  status: 'نشط',
                  showInPOS: true
                },
                session
              );
              if (!saveCatRes.success || !saveCatRes.category) {
                const errMsg =
                  saveCatRes.error || `تعذر إنشاء التصنيف الجديد "${targetNewRootName}"`;
                failedCatsByNorm.set(targetNewRootNorm, errMsg);
                if (pubRow) {
                  pubRow.status = 'error';
                  pubRow.reason = errMsg;
                }
                failedAddItemsRowsCount += 1;
                continue;
              }
              createdCat = saveCatRes.category;
            }

            createdCatsByNorm.set(targetNewRootNorm, createdCat);
          }

          resolvedCategoryId = createdCat.id;
          resolvedCategoryName = createdCat.name;

          const stat = createdNewCategoriesMap.get(targetNewRootNorm);
          if (stat) {
            stat.itemsCount += 1;
          } else {
            createdNewCategoriesMap.set(targetNewRootNorm, {
              id: createdCat.id,
              name: createdCat.name,
              itemsCount: 1
            });
          }
        }

        // رفض حفظ الصنف بلا تصنيف إذا كان الصف يحتوي على اسم تصنيف وتعذر تحديده أو إنشاؤه
        const hadCategoryInput = Boolean(
          String(d.categoryName ?? d.newRootCategoryName ?? '').trim()
        );
        if (hadCategoryInput && !resolvedCategoryId) {
          if (pubRow) {
            pubRow.status = 'error';
            pubRow.reason = `تعذر تحديد أو إنشاء التصنيف "${d.categoryName || d.newRootCategoryName}" — لم يتم حفظ الصنف بدون تصنيف`;
          }
          failedAddItemsRowsCount += 1;
          continue;
        }

        const newId = generateUUID();
        const newItem: Item = {
          id: newId,
          name: d.name,
          printName: d.printName || '',
          categoryId: resolvedCategoryId,
          categoryName: resolvedCategoryName,
          imageUrl: d.imageUrl,
          barcode: d.barcode,
          secondaryBarcodes: d.secondaryBarcodes,
          sku: d.sku,
          supplier: d.supplier,
          unit: d.unit,
          taxRate: d.taxRate,
          salePrice: d.salePrice,
          minPrice: d.minPrice,
          purchasePrice: d.purchasePrice,
          packagingCost: d.packagingCost,
          stockQuantity: 0,
          reorderLimit: d.reorderLimit,
          generalReorderLimit: d.reorderLimit,
          notes: d.notes,
          createdAt: now,
          status: d.status,
          enableBnpl: d.enableBnpl,
          bnplPercentage: d.bnplPercentage,
          pickupFee: d.pickupFee,
          platformIds: d.platformIds
        };

        memoryItems.unshift(newItem);
        const computedQty = setItemWarehouseBalance(newId, addTargetWh.id, d.stockQuantity);
        if (d.reorderLimit !== undefined) {
          setItemWarehouseReorderLimit(newId, addTargetWh.id, d.reorderLimit);
        }

        if (d.barcode) {
          memoryItemBarcodes.push({
            itemId: newId,
            barcode: d.barcode,
            type: 'primary',
            label: 'الباركود الأساسي',
            active: true,
            createdAt: now
          });
        }
        if (Array.isArray(d.secondaryBarcodes)) {
          for (const sec of d.secondaryBarcodes) {
            memoryItemBarcodes.push({
              itemId: newId,
              barcode: sec,
              type: 'secondary',
              label: 'باركود فرعي',
              active: true,
              createdAt: now
            });
          }
        }

        memoryStockMovements.push({
          id: generateUUID(),
          date: now,
          itemId: newId,
          itemName: newItem.name,
          sku: newItem.sku || '',
          barcode: newItem.barcode || '',
          warehouseId: addTargetWh.id,
          warehouseName: addTargetWh.name,
          documentNumber: `INIT-XLS-${batchSuffix}-${updatedCount + 1}`,
          movementType: 'رصيد افتتاحي بالإكسيل',
          quantity: computedQty,
          quantityBefore: 0,
          quantityAfter: computedQty,
          balanceAfter: computedQty,
          unitPrice: newItem.purchasePrice || newItem.salePrice || 0,
          totalAmount: computedQty * (newItem.purchasePrice || newItem.salePrice || 0),
          reason: 'رصيد افتتاحي بالإكسيل',
          source: 'إضافة بالإكسيل',
          referenceNumber: batchId,
          userName,
          userId,
          notes: `رصيد افتتاحي بالإكسيل بمخزن "${addTargetWh.name}" (${computedQty}) عند إضافة الصنف (${displayFileName})`
        });

        row.itemId = newId;
        if (pubRow) pubRow.itemId = newId;
        updatedCount++;
      }

      // الإضافة غير قابلة للتراجع، وتُصفّر سجل آخر عملية
      lastBulkEditUndoRecord = null;

      if (updatedCount === 0 && failedAddItemsRowsCount > 0) {
        const finalErrorCount = publicRows.filter(r => r.status === 'error').length;
        const finalUnchangedCount = publicRows.filter(r => r.status === 'unchanged').length;
        return {
          success: false,
          statusCode: 400,
          operationType: opType,
          fileName: preview.fileName,
          warehouseId: preview.targetWarehouse?.id,
          warehouseName: preview.targetWarehouse?.name,
          batchId,
          updatedCount: 0,
          unchangedCount: finalUnchangedCount,
          errorCount: finalErrorCount,
          warningCount: 0,
          summary: {
            ...preview.summary,
            willUpdateCount: 0,
            unchangedCount: finalUnchangedCount,
            errorCount: finalErrorCount,
            newCategories: []
          },
          rows: publicRows,
          undoAvailable: false,
          error: 'تعذر إضافة الأصناف بسبب فشل التحقق أو إنشاء التصنيفات — راجع تفاصيل الصفوف أدناه.'
        };
      }
    } else if (opType === 'add_categories') {
      // تنفيذ آمن صفاً بصف عبر المسار المعتمد saveCategory مع كشف أي حفظ جزئي وعدم إخفاء أي فشل
      const createdRootsByNorm = new Map<string, ProductCategory>();
      const failedRootsByNorm = new Map<string, string>();
      const reusedRootIdsExecuted = new Set<string>();
      let createdRootsCount = 0;
      let createdSubsCount = 0;
      let failedRowsCount = 0;

      for (const row of preview.rows) {
        if (row.status !== 'will_update' || row._actionPayload?.kind !== 'add_category') continue;
        const act = row._actionPayload;
        const pubRow = publicRows.find(pr => pr.rowNumber === row.rowNumber);

        let parentId: string | null = null;
        if (act.existingRootId) {
          parentId = act.existingRootId;
          reusedRootIdsExecuted.add(act.existingRootId);
        } else if (createdRootsByNorm.has(act.normMain)) {
          parentId = createdRootsByNorm.get(act.normMain)!.id;
        } else if (failedRootsByNorm.has(act.normMain)) {
          const prevErr = failedRootsByNorm.get(act.normMain)!;
          if (pubRow) {
            pubRow.status = 'error';
            pubRow.reason = `تعذر إنشاء التصنيف الرئيسي "${act.mainName}": ${prevErr}`;
          }
          failedRowsCount += 1;
          continue;
        } else {
          const rootSaveRes = await saveCategory(
            {
              name: act.mainName,
              parentCategoryId: null,
              status: 'نشط',
              showInPOS: true
            },
            session
          );
          if (!rootSaveRes.success || !rootSaveRes.category) {
            const errMsg = rootSaveRes.error || 'تعذر حفظ التصنيف الرئيسي';
            failedRootsByNorm.set(act.normMain, errMsg);
            if (pubRow) {
              pubRow.status = 'error';
              pubRow.reason = errMsg;
            }
            failedRowsCount += 1;
            continue;
          }
          createdRootsByNorm.set(act.normMain, rootSaveRes.category);
          createdRootsCount += 1;
          parentId = rootSaveRes.category.id;
        }

        if (act.subName) {
          const subSaveRes = await saveCategory(
            {
              name: act.subName,
              parentCategoryId: parentId,
              status: 'نشط',
              showInPOS: true
            },
            session
          );
          if (!subSaveRes.success || !subSaveRes.category) {
            if (pubRow) {
              pubRow.status = 'error';
              pubRow.reason = subSaveRes.error || 'تعذر حفظ التصنيف الفرعي';
            }
            failedRowsCount += 1;
            continue;
          }
          createdSubsCount += 1;
          if (pubRow) {
            pubRow.itemId = subSaveRes.category.id;
          }
          updatedCount += 1;
        } else {
          if (pubRow) {
            pubRow.itemId = parentId || undefined;
          }
          updatedCount += 1;
        }
      }

      lastBulkEditUndoRecord = null;

      const finalUnchangedCount = publicRows.filter(r => r.status === 'unchanged').length;
      const finalErrorCount = publicRows.filter(r => r.status === 'error').length;
      const prevCatSummary = preview.summary.categorySummary;
      const finalCategorySummary: BulkEditCategoryImportSummary = {
        newRootsCount: prevCatSummary?.newRootsCount ?? createdRootsCount,
        reusedRootsCount: reusedRootIdsExecuted.size,
        newSubsCount: prevCatSummary?.newSubsCount ?? createdSubsCount,
        duplicatesCount: prevCatSummary?.duplicatesCount ?? finalUnchangedCount,
        existingDuplicatesCount: prevCatSummary?.existingDuplicatesCount ?? finalUnchangedCount,
        intraFileDuplicatesCount: prevCatSummary?.intraFileDuplicatesCount ?? 0,
        errorCount: finalErrorCount,
        createdRootsCount,
        createdSubsCount,
        failedRowsCount
      };
      const finalCatExecSummary = {
        ...preview.summary,
        willUpdateCount: updatedCount,
        unchangedCount: finalUnchangedCount,
        errorCount: finalErrorCount,
        categorySummary: finalCategorySummary
      };
      const partialSuccess = updatedCount > 0 && failedRowsCount > 0;

      recordAuditLog(
        {
          id: session?.id || session?.userId || 'system',
          name: userName,
          role: session?.role || 'user',
          phone: session?.phone
        },
        'CATEGORIES_BULK_ADD_EXCEL',
        'ProductCategory',
        batchId,
        `إضافة تصنيفات بالإكسيل — المستخدم: ${userName} | رؤوس جديدة: ${createdRootsCount} | رؤوس أُعيد استخدامها: ${reusedRootIdsExecuted.size} | فروع جديدة: ${createdSubsCount} | مكررات: ${finalCategorySummary.duplicatesCount} | أخطاء: ${finalErrorCount}${partialSuccess ? ` (حفظ جزئي — فشل ${failedRowsCount} صف)` : ''} | الملف: ${displayFileName}`
      );

      if (updatedCount === 0 && failedRowsCount > 0) {
        return {
          success: false,
          partialSuccess: false,
          statusCode: 400,
          operationType: opType,
          fileName: preview.fileName,
          batchId,
          updatedCount: 0,
          unchangedCount: finalUnchangedCount,
          errorCount: finalErrorCount,
          warningCount: 0,
          summary: finalCatExecSummary,
          rows: publicRows,
          undoAvailable: false,
          error: 'تعذر حفظ أي صف من التصنيفات — راجع تفاصيل الأخطاء في الجدول أدناه.'
        };
      }

      return {
        success: true,
        partialSuccess,
        statusCode: 200,
        operationType: opType,
        fileName: preview.fileName,
        batchId,
        updatedCount,
        unchangedCount: finalUnchangedCount,
        errorCount: finalErrorCount,
        warningCount: 0,
        summary: finalCatExecSummary,
        rows: publicRows,
        undoAvailable: false,
        message: partialSuccess
          ? `تم حفظ جزء من الملف (${createdRootsCount} رئيسي جديد و${createdSubsCount} فرعي جديد) وتعذر حفظ ${failedRowsCount} صف — راجع تفاصيل الصفوف أدناه.`
          : `تمت إضافة ${createdRootsCount} تصنيف رئيسي جديد و${createdSubsCount} تصنيف فرعي بنجاح.`
      };
    } else if (opType === 'delete_categories') {
      // ترتيب الصفوف القابلة للحذف بحيث تُحذف التصنيفات الفرعية (الأعمق في الهرمية) أولاً ثم التصنيفات الرئيسية
      const getCategoryDepth = (catId: string): number => {
        let depth = 0;
        let curr = memoryCategories.find(c => c.id === catId);
        const seen = new Set<string>();
        while (curr && curr.parentCategoryId && !seen.has(curr.id)) {
          seen.add(curr.id);
          depth += 1;
          curr = memoryCategories.find(c => c.id === curr!.parentCategoryId);
        }
        return depth;
      };

      const getLiveDirectLinkedItems = (cat: ProductCategory): Item[] => {
        const catLit = cleanCategoryImportCell(cat.name).toLowerCase();
        const parent = cat.parentCategoryId
          ? memoryCategories.find(p => p.id === cat.parentCategoryId)
          : undefined;
        const parentPlusSubLit = parent
          ? `${cleanCategoryImportCell(parent.name)} / ${cleanCategoryImportCell(cat.name)}`.toLowerCase()
          : null;

        return memoryItems.filter(it => {
          if (it.categoryId) {
            return it.categoryId === cat.id;
          }
          const itCatName = cleanCategoryImportCell(it.categoryName).toLowerCase();
          if (!itCatName) return false;
          if (itCatName === catLit) return true;
          if (parentPlusSubLit && itCatName === parentPlusSubLit) return true;
          return false;
        });
      };

      const rowsToExecute = preview.rows
        .filter(
          row =>
            row.status === 'will_update' &&
            row._actionPayload?.kind === 'delete_category' &&
            Boolean(row._actionPayload.categoryId)
        )
        .map(row => ({
          row,
          catId: (row._actionPayload as { kind: 'delete_category'; categoryId: string; categoryName: string }).categoryId,
          depth: getCategoryDepth(
            (row._actionPayload as { kind: 'delete_category'; categoryId: string; categoryName: string }).categoryId
          )
        }))
        .sort((a, b) => {
          if (b.depth !== a.depth) return b.depth - a.depth;
          return a.row.rowNumber - b.row.rowNumber;
        });

      const deletedCategoryNames: string[] = [];
      let failedRowsCount = 0;

      for (const { row, catId } of rowsToExecute) {
        const pubRow = publicRows.find(pr => pr.rowNumber === row.rowNumber);
        const targetCat = memoryCategories.find(c => c.id === catId);
        if (!targetCat) {
          if (pubRow) {
            pubRow.status = 'error';
            pubRow.newValueDisplay = '—';
            pubRow.reason = 'التصنيف لم يعد موجوداً في النظام لحظة التنفيذ';
          }
          failedRowsCount += 1;
          continue;
        }

        // إعادة التحقق لحظة التنفيذ من عدم وجود تصنيفات فرعية باقية تحت هذا التصنيف
        const remainingChildren = memoryCategories.filter(c => c.parentCategoryId === targetCat.id);
        if (remainingChildren.length > 0) {
          if (pubRow) {
            pubRow.status = 'error';
            pubRow.newValueDisplay = '—';
            pubRow.reason = `لا يمكن حذف التصنيف "${targetCat.name}" لوجود (${remainingChildren.length}) تصنيف فرعي مرتبط به لحظة التنفيذ (${remainingChildren.slice(0, 3).map(c => c.name).join('، ')}${remainingChildren.length > 3 ? '...' : ''})`;
          }
          failedRowsCount += 1;
          continue;
        }

        // إعادة التحقق لحظة التنفيذ من عدم ارتباط التصنيف بأي صنف
        const liveLinkedItems = getLiveDirectLinkedItems(targetCat);
        if (liveLinkedItems.length > 0) {
          if (pubRow) {
            pubRow.status = 'error';
            pubRow.newValueDisplay = '—';
            pubRow.reason = `لا يمكن حذف التصنيف "${targetCat.name}" لارتباطه بـ (${liveLinkedItems.length}) صنف لحظة التنفيذ (${liveLinkedItems.slice(0, 3).map(i => i.name).join('، ')}${liveLinkedItems.length > 3 ? '...' : ''})`;
          }
          failedRowsCount += 1;
          continue;
        }

        const delRes = await deleteCategory(targetCat.id, session);
        if (!delRes.success) {
          if (pubRow) {
            pubRow.status = 'error';
            pubRow.newValueDisplay = '—';
            pubRow.reason = delRes.error || 'تعذر حذف التصنيف';
          }
          failedRowsCount += 1;
          continue;
        }

        deletedCategoryNames.push(targetCat.name);
        updatedCount += 1;
      }

      lastBulkEditUndoRecord = null;

      const finalUnchangedCount = publicRows.filter(r => r.status === 'unchanged').length;
      const finalErrorCount = publicRows.filter(r => r.status === 'error').length;
      const finalDelCatSummary: BulkEditExcelSummary = {
        ...preview.summary,
        willUpdateCount: updatedCount,
        unchangedCount: finalUnchangedCount,
        errorCount: finalErrorCount
      };
      const partialSuccess = updatedCount > 0 && failedRowsCount > 0;

      recordAuditLog(
        {
          id: session?.id || session?.userId || 'system',
          name: userName,
          role: session?.role || 'user',
          phone: session?.phone
        },
        'CATEGORIES_BULK_DELETE_EXCEL',
        'ProductCategory',
        batchId,
        `حذف تصنيفات بالإكسيل — المستخدم: ${userName} | المحذوف: ${updatedCount} تصنيف${deletedCategoryNames.length > 0 ? ` (${deletedCategoryNames.join('، ')})` : ''} | المرفوض: ${finalErrorCount}${partialSuccess ? ` (تنفيذ جزئي — فشل ${failedRowsCount} صف)` : ''} | الملف: ${displayFileName}`
      );

      if (updatedCount === 0 && failedRowsCount > 0) {
        return {
          success: false,
          partialSuccess: false,
          statusCode: 400,
          operationType: opType,
          fileName: preview.fileName,
          batchId,
          updatedCount: 0,
          unchangedCount: finalUnchangedCount,
          errorCount: finalErrorCount,
          warningCount: 0,
          summary: finalDelCatSummary,
          rows: publicRows,
          undoAvailable: false,
          error: 'تعذر حذف أي تصنيف بعد إعادة التحقق لحظة التنفيذ — راجع أسباب الرفض في الجدول أدناه.'
        };
      }

      return {
        success: true,
        partialSuccess,
        statusCode: 200,
        operationType: opType,
        fileName: preview.fileName,
        batchId,
        updatedCount,
        unchangedCount: finalUnchangedCount,
        errorCount: finalErrorCount,
        warningCount: 0,
        summary: finalDelCatSummary,
        rows: publicRows,
        undoAvailable: false,
        message: partialSuccess
          ? `تم حذف ${updatedCount} تصنيف بنجاح وتعذر حذف ${failedRowsCount} تصنيف بعد إعادة التحقق — راجع تفاصيل الصفوف أدناه.`
          : `تم حذف ${updatedCount} تصنيف بنجاح.`
      };
    } else if (opType === 'delete_items') {
      for (const row of preview.rows) {
        if (row.status !== 'will_update' || !row.itemId || row._actionPayload?.kind !== 'delete_item') continue;
        const idx = memoryItems.findIndex(it => it.id === row.itemId);
        if (idx === -1) continue;
        const targetItem = memoryItems[idx];

        const totalStock = Math.round(Number(recomputeItemTotalStock(targetItem.id)) * 1000) / 1000;
        const hasNonZeroWhStock = memoryWarehouseStocks.some(
          ws => ws.itemId === targetItem.id && Math.round(Number(ws.quantity || 0) * 1000) / 1000 !== 0
        );
        const hasTx =
          memoryInvoices.some(inv => (inv.lines || []).some(l => l.itemId === targetItem.id)) ||
          memoryReturns.some(ret => (ret.lines || []).some(l => l.itemId === targetItem.id)) ||
          memoryPurchases.some(p => (p.lines || []).some(l => l.itemId === targetItem.id)) ||
          memoryPurchaseReturns.some(pr => (pr.lines || []).some(l => l.itemId === targetItem.id));
        if (totalStock !== 0 || hasNonZeroWhStock || hasTx) continue;

        memoryItems.splice(idx, 1);
        memoryItemBarcodes = memoryItemBarcodes.filter(b => b.itemId !== targetItem.id);
        memoryCosts = memoryCosts.filter(c => c.itemId !== targetItem.id);
        memoryWarehouseStocks = memoryWarehouseStocks.filter(ws => ws.itemId !== targetItem.id);
        memoryStockMovements = memoryStockMovements.filter(sm => sm.itemId !== targetItem.id);
        memoryItemChangeLogs = memoryItemChangeLogs.filter(cl => cl.itemId !== targetItem.id);
        deletedItemNames.push(targetItem.name);
        updatedCount++;
      }

      // الحذف غير قابل للتراجع، ويُصفّر سجل آخر عملية
      lastBulkEditUndoRecord = null;
    } else {
      const bulkTargetWh = preview.targetWarehouse || getDefaultWarehouse();
      const createdCatsByNorm = new Map<string, ProductCategory>();
      const newlyCreatedCategoryIds: string[] = [];
      for (const row of preview.rows) {
        if (row.status !== 'will_update' || !row.itemId || !row._actionPayload) continue;
        const targetItem = memoryItems.find(it => it.id === row.itemId);
        if (!targetItem) continue;

        let prevSnapshot: BulkEditUndoSnapshotEntry | null = null;
        if (!snappedItemIds.has(targetItem.id)) {
          prevSnapshot = {
            itemId: targetItem.id,
            itemName: targetItem.name,
            previousItem: JSON.parse(JSON.stringify(targetItem)),
            previousBarcodes: memoryItemBarcodes
              .filter(b => b.itemId === targetItem.id)
              .map(b => ({ ...b })),
            previousWarehouseId:
              opType === 'stock_quantity' || opType === 'reorder_limit' ? bulkTargetWh.id : undefined,
            previousWarehouseQty:
              opType === 'stock_quantity' ? getItemWarehouseStock(targetItem.id, bulkTargetWh.id) : undefined,
            previousWarehouseReorderLimit:
              opType === 'reorder_limit'
                ? getRawItemWarehouseReorderLimit(targetItem.id, bulkTargetWh.id)
                : undefined
          };
        }

        const act = row._actionPayload;
        const reasonTag = `تعديل جماعي بالإكسيل (${preview.fileName || batchId})`;
        let rowApplied = false;

        switch (opType) {
          case 'sale_price':
          case 'purchase_price':
          case 'pickup_fee':
          case 'min_price':
          case 'packaging_cost':
          case 'tax_rate':
          case 'reorder_limit': {
            if (act.kind !== 'number_field') break;
            const oldDisplay = row.currentValueDisplay || '';
            const newDisplay = row.newValueDisplay || '';
            const oldNumeric = row.currentPrice !== null && row.currentPrice !== undefined ? row.currentPrice : oldDisplay;
            if (opType === 'sale_price') targetItem.salePrice = act.newValue;
            else if (opType === 'purchase_price') targetItem.purchasePrice = act.newValue;
            else if (opType === 'pickup_fee') targetItem.pickupFee = act.newValue > 0 ? act.newValue : undefined;
            else if (opType === 'min_price') targetItem.minPrice = act.newValue > 0 ? act.newValue : undefined;
            else if (opType === 'packaging_cost') targetItem.packagingCost = act.newValue;
            else if (opType === 'tax_rate') targetItem.taxRate = act.newValue;
            else if (opType === 'reorder_limit') {
              setItemWarehouseReorderLimit(targetItem.id, bulkTargetWh.id, act.newValue);
            }

            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName:
                opType === 'reorder_limit'
                  ? `الحد الأدنى للكمية (${bulkTargetWh.name})`
                  : opMeta.label.replace(/^تعديل\s+/, ''),
              oldValue: oldNumeric,
              newValue: act.newValue ?? newDisplay,
              userName,
              timestamp: now,
              reason: opType === 'reorder_limit' ? `${reasonTag} — ${bulkTargetWh.name}` : reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'primary_barcode': {
            if (act.kind !== 'primary_barcode') break;
            const oldBarcode = targetItem.barcode || 'بدون باركود';
            targetItem.barcode = act.barcode;

            // استبدال الباركود الرئيسي مع الحفاظ على الباركودات الفرعية
            memoryItemBarcodes = memoryItemBarcodes.filter(
              b => !(b.itemId === targetItem.id && b.type === 'primary')
            );
            memoryItemBarcodes.unshift({
              itemId: targetItem.id,
              barcode: act.barcode,
              type: 'primary',
              label: 'الباركود الأساسي',
              active: true,
              createdAt: now
            });

            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'الباركود الرئيسي',
              oldValue: oldBarcode,
              newValue: act.barcode,
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'add_secondary_barcode': {
            if (act.kind !== 'add_secondary_barcode') break;
            const currentSec = Array.isArray(targetItem.secondaryBarcodes)
              ? [...targetItem.secondaryBarcodes]
              : [];
            const oldSecDisplay = currentSec.length > 0 ? currentSec.join('، ') : 'بدون باركود فرعي';
            if (!currentSec.some(s => normalizeItemBarcode(s).toLowerCase() === act.barcode.toLowerCase())) {
              currentSec.push(act.barcode);
            }
            targetItem.secondaryBarcodes = currentSec;

            if (
              !memoryItemBarcodes.some(
                b =>
                  b.itemId === targetItem.id &&
                  normalizeItemBarcode(b.barcode).toLowerCase() === act.barcode.toLowerCase()
              )
            ) {
              memoryItemBarcodes.push({
                itemId: targetItem.id,
                barcode: act.barcode,
                type: 'secondary',
                label: 'باركود فرعي',
                active: true,
                createdAt: now
              });
            }

            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'إضافة باركود فرعي',
              oldValue: oldSecDisplay,
              newValue: currentSec.join('، '),
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'stock_quantity': {
            if (act.kind !== 'stock_quantity') break;
            const oldQty = getItemWarehouseStock(targetItem.id, bulkTargetWh.id);
            const newQty = act.newQuantity;
            const diff = Math.round((newQty - oldQty) * 1000) / 1000;
            if (diff === 0) break;

            const docNumber = `XLS-${batchSuffix}-${updatedCount + 1}`;
            const movementId = generateUUID();
            const adjReason = act.reason || 'تسوية مخزون بالإكسيل';

            setItemWarehouseBalance(targetItem.id, bulkTargetWh.id, newQty);

            const movement: StockMovement = {
              id: movementId,
              date: now,
              itemId: targetItem.id,
              itemName: targetItem.name,
              sku: targetItem.sku || '',
              barcode: targetItem.barcode || '',
              warehouseId: bulkTargetWh.id,
              warehouseName: bulkTargetWh.name,
              documentNumber: docNumber,
              movementType: 'تسوية مخزون بالإكسيل',
              quantity: Math.abs(diff),
              quantityBefore: oldQty,
              quantityAfter: newQty,
              balanceAfter: newQty,
              unitPrice: targetItem.salePrice || 0,
              totalAmount: Math.abs(diff) * (targetItem.salePrice || 0),
              reason: adjReason,
              source: 'تعديل بالإكسيل',
              referenceNumber: batchId,
              userName,
              userId,
              notes: `${diff > 0 ? 'زيادة' : 'خصم'} تسوية مخزون بالإكسيل بمخزن "${bulkTargetWh.name}" (${diff > 0 ? '+' + diff : diff}) من ${oldQty} إلى ${newQty}. الملف: ${displayFileName}${act.reason ? ` • السبب: ${act.reason}` : ''}`
            };
            memoryStockMovements.push(movement);

            memoryItemChangeLogs.push({
              id: movementId,
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'الكمية بالمخزن',
              oldValue: oldQty,
              newValue: newQty,
              userName,
              timestamp: now,
              reason: `${reasonTag} — ${bulkTargetWh.name} — ${adjReason}`
            });
            rowApplied = true;
            break;
          }

          case 'name': {
            if (act.kind !== 'name') break;
            const oldName = targetItem.name;
            targetItem.name = act.newName;
            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'اسم الصنف',
              oldValue: oldName,
              newValue: act.newName,
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'print_name': {
            if (act.kind !== 'print_name') break;
            const oldPrintName = targetItem.printName || 'فارغ';
            targetItem.printName = act.printName;
            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'اسم الطباعة',
              oldValue: oldPrintName,
              newValue: act.printName || 'فارغ',
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'barcode_sku': {
            if (act.kind !== 'barcode_sku') break;
            const oldSummary = formatBarcodeSkuDisplay(
              targetItem.barcode,
              targetItem.sku,
              targetItem.secondaryBarcodes
            );
            targetItem.barcode = act.barcode || undefined;
            targetItem.sku = act.sku || undefined;
            targetItem.secondaryBarcodes = act.secondaryBarcodes.length > 0 ? act.secondaryBarcodes : undefined;

            memoryItemBarcodes = memoryItemBarcodes.filter(b => b.itemId !== targetItem.id);
            if (act.barcode) {
              memoryItemBarcodes.push({
                itemId: targetItem.id,
                barcode: act.barcode,
                type: 'primary',
                label: 'الباركود الأساسي',
                active: true,
                createdAt: now
              });
            }
            for (const sec of act.secondaryBarcodes) {
              memoryItemBarcodes.push({
                itemId: targetItem.id,
                barcode: sec,
                type: 'secondary',
                label: 'باركود فرعي',
                active: true,
                createdAt: now
              });
            }

            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'الباركود / الكود',
              oldValue: oldSummary,
              newValue: formatBarcodeSkuDisplay(
                targetItem.barcode,
                targetItem.sku,
                targetItem.secondaryBarcodes
              ),
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'notes': {
            if (act.kind !== 'notes') break;
            const oldNotes = targetItem.notes || '';
            targetItem.notes = act.notes;
            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'الوصف',
              oldValue: oldNotes || 'فارغ',
              newValue: act.notes,
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'category': {
            if (act.kind !== 'category') break;
            const oldCat = formatItemCategoryDisplay(targetItem);
            let resolvedCategoryId = act.categoryId;
            let resolvedCategoryName = act.categoryName;

            if (act.isNewRootCategory && act.newRootNormName && act.newRootCategoryName) {
              let createdCat =
                createdCatsByNorm.get(act.newRootNormName) ||
                memoryCategories.find(
                  c =>
                    !c.parentCategoryId &&
                    isCategoryActiveForImport(c) &&
                    normalizeItemName(c.name) === act.newRootNormName
                );

              if (!createdCat) {
                const maxOrder = memoryCategories.reduce(
                  (acc, c) => Math.max(acc, Number(c.displayOrder || 0)),
                  0
                );
                createdCat = {
                  id: generateUUID(),
                  name: act.newRootCategoryName,
                  parentCategoryId: null,
                  status: 'نشط',
                  showInPOS: true,
                  displayOrder: maxOrder + 1,
                  createdAt: now,
                  updatedAt: now
                };
                memoryCategories.push(createdCat);
                createdCatsByNorm.set(act.newRootNormName, createdCat);
                newlyCreatedCategoryIds.push(createdCat.id);
                recordAuditLog(
                  {
                    id: session?.id || session?.userId || 'system',
                    name: userName,
                    role: session?.role || 'user',
                    phone: session?.phone
                  },
                  'CATEGORY_CREATE',
                  'ProductCategory',
                  createdCat.id,
                  `إنشاء تصنيف رئيسي جديد تلقائياً أثناء تعديل التصنيف بالإكسيل: ${createdCat.name} (${displayFileName})`
                );
              } else {
                createdCatsByNorm.set(act.newRootNormName, createdCat);
              }

              resolvedCategoryId = createdCat.id;
              resolvedCategoryName = createdCat.name;

              const stat = createdNewCategoriesMap.get(act.newRootNormName);
              if (stat) {
                stat.itemsCount += 1;
              } else {
                createdNewCategoriesMap.set(act.newRootNormName, {
                  id: createdCat.id,
                  name: createdCat.name,
                  itemsCount: 1
                });
              }
            }

            targetItem.categoryId = resolvedCategoryId;
            targetItem.categoryName = resolvedCategoryName;
            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'التصنيف',
              oldValue: oldCat,
              newValue: resolvedCategoryName,
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'platforms': {
            if (act.kind !== 'platforms') break;
            const oldPlts = formatItemPlatformsDisplay(targetItem.platformIds);
            targetItem.platformIds = act.platformIds;
            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'المنصات المرتبطة',
              oldValue: oldPlts,
              newValue: formatItemPlatformsDisplay(act.platformIds),
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'bnpl': {
            if (act.kind !== 'bnpl') break;
            const oldDisplay = `${targetItem.enableBnpl ? 'نعم' : 'لا'} (${Number(targetItem.bnplPercentage || 0)}%)`;
            targetItem.enableBnpl = act.enableBnpl;
            targetItem.bnplPercentage = act.bnplPercentage;
            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'BNPL',
              oldValue: oldDisplay,
              newValue: `${act.enableBnpl ? 'نعم' : 'لا'} (${act.bnplPercentage}%)`,
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'supplier': {
            if (act.kind !== 'supplier') break;
            const oldSup = targetItem.supplier || 'فارغ';
            targetItem.supplier = act.supplier;
            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'المورد',
              oldValue: oldSup,
              newValue: act.supplier,
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'unit': {
            if (act.kind !== 'unit') break;
            const oldUnit = targetItem.unit || 'قطعة';
            targetItem.unit = act.unit;
            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'الوحدة',
              oldValue: oldUnit,
              newValue: act.unit,
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'status': {
            if (act.kind !== 'status') break;
            const oldStatus = normalizeExistingItemStatus(targetItem.status);
            targetItem.status = act.status;
            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'الحالة',
              oldValue: oldStatus,
              newValue: act.status,
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }

          case 'image_url': {
            if (act.kind !== 'image_url') break;
            const oldUrl = targetItem.imageUrl || 'فارغ';
            targetItem.imageUrl = act.imageUrl;
            memoryItemChangeLogs.push({
              id: generateUUID(),
              itemId: targetItem.id,
              itemName: targetItem.name,
              fieldName: 'رابط الصورة',
              oldValue: oldUrl,
              newValue: act.imageUrl,
              userName,
              timestamp: now,
              reason: reasonTag
            });
            rowApplied = true;
            break;
          }
        }

        if (rowApplied) {
          if (prevSnapshot && !snappedItemIds.has(targetItem.id)) {
            undoSnapshots.push(prevSnapshot);
            snappedItemIds.add(targetItem.id);
          }
          updatedCount++;
        }
      }

      if (undoSnapshots.length > 0) {
        lastBulkEditUndoRecord = {
          batchId,
          operationType: opType,
          operationLabel: opMeta.label,
          fileName: displayFileName,
          warehouseId: preview.targetWarehouse?.id,
          warehouseName: preview.targetWarehouse?.name,
          executedAt: now,
          executedBy: userName,
          executedById: userId,
          snapshots: undoSnapshots,
          ...(newlyCreatedCategoryIds.length > 0 ? { createdCategoryIds: newlyCreatedCategoryIds } : {})
        };
      }
    }
  } finally {
    if (lockAcquired) {
      releaseStockLock();
    }
  }

  const auditAction =
    opType === 'add_items'
      ? 'PRODUCTS_BULK_ADD_EXCEL'
      : opType === 'delete_items'
      ? 'PRODUCTS_BULK_DELETE_EXCEL'
      : 'PRODUCTS_BULK_EDIT_EXCEL';

  const actionVerb =
    opType === 'add_items' ? 'إضافة' : opType === 'delete_items' ? 'حذف' : 'تعديل';

  const warehouseAuditPart = preview.targetWarehouse
    ? ` | المخزن: ${preview.targetWarehouse.name}`
    : '';

  const deletedNamesAuditPart =
    opType === 'delete_items' && deletedItemNames.length > 0
      ? ` | الأصناف المحذوفة: ${deletedItemNames.join('، ')}`
      : '';

  recordAuditLog(
    {
      id: session?.id || session?.userId || 'system',
      name: userName,
      role: session?.role || 'user',
      phone: session?.phone
    },
    auditAction,
    'Item',
    batchId,
    `عملية بالإكسيل — المستخدم: ${userName} | النوع: ${opMeta.label}${warehouseAuditPart} | العدد المنفذ: ${updatedCount} صنف | بدون تغيير: ${preview.summary.unchangedCount} | مرفوض: ${preview.summary.errorCount}${deletedNamesAuditPart} | الملف: ${displayFileName}`
  );

  const createdNewCategories = Array.from(createdNewCategoriesMap.values());
  const finalErrorCount = publicRows.filter(r => r.status === 'error').length;
  const finalUnchangedCount = publicRows.filter(r => r.status === 'unchanged').length;
  const zeroSalePriceCount =
    opType === 'add_items'
      ? publicRows.filter(
          r => r.status === 'will_update' && Boolean(r.itemId) && Number(r.newPrice ?? 0) === 0
        ).length
      : 0;
  const zeroSalePriceWarning =
    opType === 'add_items' && zeroSalePriceCount > 0
      ? `تم استيراد ${zeroSalePriceCount} صنفًا بسعر بيع صفر — راجع أسعارها`
      : undefined;
  const finalSummary = {
    ...preview.summary,
    willUpdateCount: updatedCount,
    unchangedCount: finalUnchangedCount,
    errorCount: finalErrorCount,
    ...(opType === 'add_items'
      ? {
          zeroSalePriceCount,
          ...(zeroSalePriceWarning ? { zeroSalePriceWarning } : {})
        }
      : {}),
    newCategories: createdNewCategories.length > 0 ? createdNewCategories : undefined
  };

  return {
    success: true,
    partialSuccess: updatedCount > 0 && finalErrorCount > preview.summary.errorCount,
    statusCode: 200,
    operationType: opType,
    fileName: preview.fileName,
    warehouseId: preview.targetWarehouse?.id,
    warehouseName: preview.targetWarehouse?.name,
    batchId,
    updatedCount,
    unchangedCount: finalUnchangedCount,
    errorCount: finalErrorCount,
    warningCount: preview.summary.warningCount || 0,
    ...(opType === 'add_items'
      ? {
          zeroSalePriceCount,
          ...(zeroSalePriceWarning
            ? {
                zeroSalePriceWarning,
                warnings: [zeroSalePriceWarning]
              }
            : {})
        }
      : {}),
    ...(createdNewCategories.length > 0 ? { newCategories: createdNewCategories } : {}),
    summary: finalSummary,
    rows: publicRows,
    undoAvailable: Boolean(lastBulkEditUndoRecord),
    message: `تم ${actionVerb} ${updatedCount} صنف بنجاح (${opMeta.label}${preview.targetWarehouse ? ` — ${preview.targetWarehouse.name}` : ''})${createdNewCategories.length > 0 ? ` • تم إنشاء ${createdNewCategories.length} تصنيف جديد` : ''}${zeroSalePriceWarning ? ` • ${zeroSalePriceWarning}` : ''}`
  };
}

/**
 * استعلام عن حالة آخر عملية تعديل بالإكسيل قابلة للتراجع
 */
export async function getBulkEditUndoStatus(session?: BulkEditSessionInfo) {
  if (!hasBulkEditExcelPermission(session)) {
    return {
      success: false,
      statusCode: 403,
      available: false,
      error: 'غير مصرح: تفتقر لصلاحية [products.bulk_edit_excel]'
    };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getBulkEditUndoStatus', {}, session?.token);
    if (res && res.success) {
      setSheetsCache('bulkEditUndoStatus', res);
      return res;
    }
    const cached = getSheetsCache<any>('bulkEditUndoStatus');
    if (cached) {
      return {
        ...cached.data,
        stale: true,
        lastSyncAt: cached.lastSyncAt
      };
    }
    const failure = buildSheetsWriteFailure(res, 'تعذر التحقق من حالة التراجع في Google Sheets');
    return {
      ...failure,
      available: false,
      statusCode: res?.isTimeout ? 504 : (res?.isTransportError ? 503 : (res?.statusCode || 400))
    };
  }

  if (!lastBulkEditUndoRecord) {
    return {
      success: true,
      statusCode: 200,
      available: false
    };
  }
  return {
    success: true,
    statusCode: 200,
    available: true,
    batchId: lastBulkEditUndoRecord.batchId,
    operationType: lastBulkEditUndoRecord.operationType,
    operationLabel: lastBulkEditUndoRecord.operationLabel,
    fileName: lastBulkEditUndoRecord.fileName,
    warehouseId: lastBulkEditUndoRecord.warehouseId,
    warehouseName: lastBulkEditUndoRecord.warehouseName,
    affectedCount: lastBulkEditUndoRecord.snapshots.length,
    executedAt: lastBulkEditUndoRecord.executedAt,
    executedBy: lastBulkEditUndoRecord.executedBy
  };
}

/**
 * التراجع عن آخر عملية تعديل بالإكسيل (للتعديلات فقط، لآخر عملية فقط)
 */
export async function undoLastBulkEditExcel(session?: BulkEditSessionInfo) {
  if (!hasBulkEditExcelPermission(session)) {
    return {
      success: false,
      statusCode: 403,
      restoredCount: 0,
      error: 'غير مصرح: تفتقر لصلاحية التعديل بالإكسيل [products.bulk_edit_excel]'
    };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('undoLastBulkEditExcel', {}, session?.token);
    if (res && res.success) {
      return res;
    }
    const failure = buildSheetsWriteFailure(res, 'تعذر التراجع عن العملية في Google Sheets');
    return {
      ...failure,
      restoredCount: 0,
      statusCode: res?.isTimeout ? 504 : (res?.isTransportError ? 503 : (res?.statusCode || 400))
    };
  }

  const record = lastBulkEditUndoRecord;
  if (!record) {
    return {
      success: false,
      statusCode: 400,
      restoredCount: 0,
      error: 'لا توجد عملية تعديل بالإكسيل قابلة للتراجع حالياً (التراجع متاح لآخر عملية تعديل فقط وغير متاح للإضافة أو الحذف).'
    };
  }

  if (record.operationType === 'purchase_price' && !hasPurchasePricePermission(session)) {
    return {
      success: false,
      statusCode: 403,
      restoredCount: 0,
      error: 'غير مصرح: تفتقر لصلاحية سعر الشراء [prices.view_purchase] للتراجع عن هذه العملية'
    };
  }
  if (record.operationType === 'packaging_cost' && !hasPackagingCostPermission(session)) {
    return {
      success: false,
      statusCode: 403,
      restoredCount: 0,
      error: 'غير مصرح: تفتقر لصلاحية تكلفة التغليف [prices.view_packaging] للتراجع عن هذه العملية'
    };
  }

  let lockAcquired = false;
  if (record.operationType === 'stock_quantity') {
    lockAcquired = await acquireStockLock(6000);
    if (!lockAcquired) {
      return {
        success: false,
        statusCode: 409,
        restoredCount: 0,
        error: 'النظام مشغول بتحديث حركة مخزنية أخرى حالياً، يرجى المحاولة بعد لحظات.'
      };
    }
  }

  const now = new Date().toISOString();
  const undoBatchId = `UNDO-${record.batchId}`;
  const userName = session?.name || session?.phone || 'مستخدم النظام';
  const userId = session?.userId || session?.id || '';
  let restoredCount = 0;

  try {
    for (const snap of record.snapshots) {
      const idx = memoryItems.findIndex(it => it.id === snap.itemId);
      if (idx === -1) continue;

      const currentItem = memoryItems[idx];
      const restoredItem: Item = JSON.parse(JSON.stringify(snap.previousItem));

      if (record.operationType === 'stock_quantity') {
        const whId = snap.previousWarehouseId || record.warehouseId || getDefaultWarehouse().id;
        const whObj = getWarehouseById(whId) || getDefaultWarehouse();
        const curQty = getItemWarehouseStock(currentItem.id, whObj.id);
        const prevQty = snap.previousWarehouseQty !== undefined
          ? snap.previousWarehouseQty
          : Number(restoredItem.stockQuantity || 0);
        const diff = Math.round((prevQty - curQty) * 1000) / 1000;
        memoryItems[idx] = restoredItem;
        setItemWarehouseBalance(restoredItem.id, whObj.id, prevQty);

        if (diff !== 0) {
          memoryStockMovements.push({
            id: generateUUID(),
            date: now,
            itemId: restoredItem.id,
            itemName: restoredItem.name,
            sku: restoredItem.sku || '',
            barcode: restoredItem.barcode || '',
            warehouseId: whObj.id,
            warehouseName: whObj.name,
            documentNumber: `UNDO-XLS-${restoredCount + 1}`,
            movementType: 'تسوية مخزون بالإكسيل',
            quantity: Math.abs(diff),
            quantityBefore: curQty,
            quantityAfter: prevQty,
            balanceAfter: prevQty,
            unitPrice: restoredItem.salePrice || 0,
            totalAmount: Math.abs(diff) * (restoredItem.salePrice || 0),
            reason: `تراجع عن آخر عملية تعديل بالإكسيل (${record.batchId})`,
            source: 'تراجع عن تعديل بالإكسيل',
            referenceNumber: undoBatchId,
            userName,
            userId,
            notes: `تراجع عن تسوية مخزون بالإكسيل بمخزن "${whObj.name}" من ${curQty} إلى ${prevQty} (الفرق: ${diff > 0 ? '+' + diff : diff}) للملف: ${record.fileName}`
          });
        }
      } else if (record.operationType === 'reorder_limit') {
        const whId = snap.previousWarehouseId || record.warehouseId || getDefaultWarehouse().id;
        memoryItems[idx] = restoredItem;
        recomputeItemTotalStock(restoredItem.id);
        setItemWarehouseReorderLimit(restoredItem.id, whId, snap.previousWarehouseReorderLimit ?? null);
      } else {
        memoryItems[idx] = restoredItem;
        recomputeItemTotalStock(restoredItem.id);
        memoryItemBarcodes = memoryItemBarcodes.filter(b => b.itemId !== snap.itemId);
        for (const bc of snap.previousBarcodes) {
          memoryItemBarcodes.push({ ...bc });
        }
      }

      memoryItemChangeLogs.push({
        id: generateUUID(),
        itemId: restoredItem.id,
        itemName: restoredItem.name,
        fieldName: `تراجع (${record.operationLabel})`,
        oldValue: 'القيمة المعدلة',
        newValue: 'القيمة الأصلية المستعادة',
        userName,
        timestamp: now,
        reason: `تراجع عن آخر عملية تعديل بالإكسيل (${record.batchId} - ${record.fileName})`
      });

      restoredCount++;
    }

    if (Array.isArray(record.createdCategoryIds) && record.createdCategoryIds.length > 0) {
      for (const createdCatId of record.createdCategoryIds) {
        const stillUsed = memoryItems.some(it => it.categoryId === createdCatId);
        const hasChildren = memoryCategories.some(c => c.parentCategoryId === createdCatId);
        if (!stillUsed && !hasChildren) {
          memoryCategories = memoryCategories.filter(c => c.id !== createdCatId);
        }
      }
    }

    lastBulkEditUndoRecord = null;
  } finally {
    if (lockAcquired) {
      releaseStockLock();
    }
  }

  recordAuditLog(
    {
      id: session?.id || session?.userId || 'system',
      name: userName,
      role: session?.role || 'user',
      phone: session?.phone
    },
    'PRODUCTS_BULK_UNDO_EXCEL',
    'Item',
    undoBatchId,
    `تراجع عن آخر عملية بالإكسيل — المستخدم: ${userName} | النوع: ${record.operationLabel}${record.warehouseName ? ` | المخزن: ${record.warehouseName}` : ''} | العدد المستعاد: ${restoredCount} صنف | الملف: ${record.fileName}`
  );

  return {
    success: true,
    statusCode: 200,
    batchId: record.batchId,
    operationType: record.operationType,
    operationLabel: record.operationLabel,
    fileName: record.fileName,
    warehouseId: record.warehouseId,
    warehouseName: record.warehouseName,
    restoredCount,
    message: `تم التراجع عن آخر عملية (${record.operationLabel}) واستعادة القيم السابقة لعدد ${restoredCount} صنف`
  };
}

/**
 * تصدير ملف إكسيل بالصفوف المرفوضة وسبب رفض كل صف بعد المعاينة أو التنفيذ
 */
export async function generateBulkEditErrorsExcelBuffer(
  payload: {
    operationType?: string;
    fileName?: string;
    rows?: Array<{
      rowNumber: number;
      itemName?: string;
      inputName?: string;
      codeOrBarcode?: string;
      currentValueDisplay?: string;
      newValueDisplay?: string;
      currentPrice?: number | null;
      newPrice?: number | null;
      status?: string;
      reason?: string;
      rawValues?: Record<string, any>;
    }>;
  },
  session?: BulkEditSessionInfo
): Promise<{
  success: boolean;
  statusCode?: number;
  buffer?: Buffer;
  fileName?: string;
  errorCount?: number;
  error?: string;
}> {
  if (!hasBulkEditExcelPermission(session)) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية التعديل بالإكسيل [products.bulk_edit_excel]'
    };
  }
  if (
    (payload?.operationType === 'add_categories' || payload?.operationType === 'delete_categories') &&
    !hasCategoriesManagePermission(session)
  ) {
    return {
      success: false,
      statusCode: 403,
      error:
        payload?.operationType === 'delete_categories'
          ? 'غير مصرح: تفتقر لصلاحية إدارة وحذف التصنيفات [categories.manage]'
          : 'غير مصرح: تفتقر لصلاحية إدارة وإضافة التصنيفات [categories.manage]'
    };
  }

  const allRows = Array.isArray(payload?.rows) ? payload.rows : [];
  const errorRows = allRows.filter(r => r && (r.status === 'error' || (!r.status && r.reason)));
  if (errorRows.length === 0) {
    return {
      success: false,
      statusCode: 400,
      error: 'لا توجد صفوف مرفوضة لتصديرها.'
    };
  }

  const opMeta =
    payload?.operationType && (VALID_BULK_EDIT_OPERATIONS as readonly string[]).includes(payload.operationType)
      ? BULK_EDIT_OP_META[payload.operationType as BulkEditOperationType]
      : null;

  let headers: string[];
  let aoa: any[][];
  let colWidths: Array<{ wch: number }>;

  if (opMeta) {
    // نفس أعمدة النموذج + عمود السبب، حتى يُصحَّح الملف ويُرفع مرة أخرى مباشرة
    headers = [...opMeta.headers, 'السبب'];
    aoa = [headers];
    for (const r of errorRows) {
      const rowCells = opMeta.headers.map((h, idx) => {
        if (r.rawValues && h in r.rawValues) {
          return r.rawValues[h] ?? '';
        }
        if (idx === 0) return r.inputName || r.itemName || '';
        if (h === 'الكود' || h === 'الكود/الباركود') return r.codeOrBarcode || '';
        if (idx === 1) {
          return r.newValueDisplay !== undefined && r.newValueDisplay !== '—'
            ? r.newValueDisplay
            : r.newPrice ?? '';
        }
        return '';
      });
      rowCells.push(r.reason || 'صف غير صالح');
      aoa.push(rowCells);
    }
    colWidths = [...opMeta.colWidths, { wch: 52 }];
  } else {
    headers = [
      'رقم الصف',
      'اسم الصنف',
      'الكود/الباركود',
      'القيمة الحالية',
      'القيمة المدخلة',
      'السبب'
    ];
    aoa = [headers];
    for (const r of errorRows) {
      aoa.push([
        r.rowNumber ?? '',
        r.inputName || r.itemName || '',
        r.codeOrBarcode || '',
        r.currentValueDisplay || (r.currentPrice !== null && r.currentPrice !== undefined ? String(r.currentPrice) : '—'),
        r.newValueDisplay || (r.newPrice !== null && r.newPrice !== undefined ? String(r.newPrice) : '—'),
        r.reason || 'صف غير صالح'
      ]);
    }
    colWidths = [
      { wch: 12 },
      { wch: 32 },
      { wch: 22 },
      { wch: 22 },
      { wch: 26 },
      { wch: 52 }
    ];
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (opMeta && opMeta.textCols.length > 0) {
    for (let r = 1; r < aoa.length; r++) {
      for (const cIdx of opMeta.textCols) {
        const ref = XLSX.utils.encode_cell({ r, c: cIdx });
        const existingVal = ws[ref]?.v !== undefined ? String(ws[ref].v) : '';
        ws[ref] = { t: 's', v: existingVal, z: '@' };
      }
    }
  }
  ws['!cols'] = colWidths;
  ws['!views'] = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'الصفوف المرفوضة');

  const rawBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const finalBuffer = patchXlsxFreezeTopRow(rawBuffer);
  const cairoDate = getCairoDateString();
  const fileName = opMeta
    ? `أخطاء-${opMeta.fileSlug.replace(/^نموذج-/, '')}-${cairoDate}.xlsx`
    : `أخطاء-التعديل-بالإكسيل-${cairoDate}.xlsx`;

  return {
    success: true,
    statusCode: 200,
    buffer: finalBuffer,
    fileName,
    errorCount: errorRows.length
  };
}

/**
 * دالة توحيد اسم الصنف:
 * - إزالة التشكيل والمد (التطويل)
 * - توحيد الألف (أ/إ/آ/ٱ -> ا)، التاء المربوطة (ة -> ه)، الألف المقصورة (ى -> ي)
 * - تجاهل حالة الحروف الإنجليزية (lowercase)
 * - إزالة المسافات من الأطراف ودمج المسافات المكررة
 */
export function normalizeItemName(rawName?: string | null): string {
  if (!rawName) return '';
  return String(rawName)
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * دالة توحيد الباركود أو الكود:
 * - تحويل الأرقام العربية (٠-٩) والفارسية (۰-۹) إلى أرقام إنجليزية (0-9)
 * - إزالة جميع المسافات
 */
export function normalizeItemBarcode(rawBarcode?: string | null): string {
  if (!rawBarcode) return '';
  return String(rawBarcode)
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\s+/g, '');
}

function getItemDisplayCode(it: Item): string {
  return (it.sku && it.sku.trim()) || (it.barcode && it.barcode.trim()) || it.id;
}

function formatConflictItemInfo(it: Item): string {
  const parts: string[] = [];
  if (it.sku && it.sku.trim()) parts.push(it.sku.trim());
  if (it.barcode && it.barcode.trim() && it.barcode.trim() !== it.sku?.trim()) parts.push(it.barcode.trim());
  if (parts.length === 0 && it.id) parts.push(it.id);
  return `"${it.name}" (الكود: ${parts.join(' / ')})`;
}

export interface ItemUniquenessCheckParams {
  id?: string;
  excludeId?: string;
  itemId?: string;
  name?: string;
  barcode?: string;
  secondaryBarcodes?: string[];
  barcodes?: (string | { barcode: string })[];
  sku?: string;
  code?: string;
}

export interface ItemUniquenessConflict {
  field: 'name' | 'barcode' | 'sku';
  value: string;
  normalizedValue: string;
  conflictingItem?: {
    id: string;
    name: string;
    code: string;
    sku?: string;
    barcode?: string;
  };
  message: string;
}

export interface ItemUniquenessCheckResult {
  success: boolean;
  isDuplicate: boolean;
  field?: 'name' | 'barcode' | 'sku';
  conflictingItem?: {
    id: string;
    name: string;
    code: string;
    sku?: string;
    barcode?: string;
  };
  conflicts: ItemUniquenessConflict[];
  error?: string;
  message?: string;
}

/**
 * فحص عدم تكرار اسم الصنف أو الباركود أو الكود (SKU) في الذاكرة
 */
export function checkItemUniqueness(params: ItemUniquenessCheckParams): ItemUniquenessCheckResult {
  const targetExcludeId = String(params.excludeId || params.itemId || params.id || '').trim();
  const conflicts: ItemUniquenessConflict[] = [];
  const sourceItems: Item[] = isSheetsDataMode(getSystemConfig())
    ? (getSheetsCache<Item[]>('items:designer')?.data || getSheetsCache<Item[]>('items:standard')?.data || [])
    : memoryItems;

  // 1. فحص تكرار الاسم بعد التوحيد
  if (params.name !== undefined && params.name !== null) {
    const normName = normalizeItemName(params.name);
    if (normName.length > 0) {
      const conflict = sourceItems.find(other => {
        if (targetExcludeId && other.id === targetExcludeId) return false;
        return normalizeItemName(other.name) === normName;
      });
      if (conflict) {
        conflicts.push({
          field: 'name',
          value: String(params.name).trim(),
          normalizedValue: normName,
          conflictingItem: {
            id: conflict.id,
            name: conflict.name,
            code: getItemDisplayCode(conflict),
            sku: conflict.sku,
            barcode: conflict.barcode
          },
          message: `اسم الصنف "${String(params.name).trim()}" مكرر مع صنف آخر: ${formatConflictItemInfo(conflict)}`
        });
      }
    }
  }

  // 2. فحص تكرار الكود (SKU / code)
  const rawSku = params.sku !== undefined ? params.sku : params.code;
  if (rawSku !== undefined && rawSku !== null) {
    const normSku = normalizeItemBarcode(rawSku);
    if (normSku.length > 0) {
      const normSkuKey = normSku.toLowerCase();
      const conflict = sourceItems.find(other => {
        if (targetExcludeId && other.id === targetExcludeId) return false;
        if (other.sku && normalizeItemBarcode(other.sku).toLowerCase() === normSkuKey) return true;
        if ((other as any).code && normalizeItemBarcode((other as any).code).toLowerCase() === normSkuKey) return true;
        if (other.id && normalizeItemBarcode(other.id).toLowerCase() === normSkuKey) return true;
        return false;
      });
      if (conflict) {
        conflicts.push({
          field: 'sku',
          value: String(rawSku).trim(),
          normalizedValue: normSku,
          conflictingItem: {
            id: conflict.id,
            name: conflict.name,
            code: getItemDisplayCode(conflict),
            sku: conflict.sku,
            barcode: conflict.barcode
          },
          message: `كود الصنف [${normSku}] مسجل بالفعل لصنف آخر: ${formatConflictItemInfo(conflict)}`
        });
      }
    }
  }

  // 3. فحص تكرار الباركود (الأساسي والفرعي)
  const rawBarcodesList: string[] = [];
  if (params.barcode !== undefined && params.barcode !== null && String(params.barcode).trim() !== '') {
    rawBarcodesList.push(String(params.barcode));
  }
  if (Array.isArray(params.secondaryBarcodes)) {
    for (const sb of params.secondaryBarcodes) {
      if (sb !== undefined && sb !== null && String(sb).trim() !== '') {
        rawBarcodesList.push(String(sb));
      }
    }
  }
  if (params.barcode === undefined && params.secondaryBarcodes === undefined && Array.isArray(params.barcodes)) {
    for (const bEntry of params.barcodes) {
      const val = typeof bEntry === 'string' ? bEntry : bEntry?.barcode;
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        rawBarcodesList.push(String(val));
      }
    }
  }

  const seenNormalizedBarcodes = new Set<string>();
  for (const rawBc of rawBarcodesList) {
    const normBc = normalizeItemBarcode(rawBc);
    if (!normBc) continue;
    const normBcKey = normBc.toLowerCase();

    if (seenNormalizedBarcodes.has(normBcKey)) {
      conflicts.push({
        field: 'barcode',
        value: rawBc,
        normalizedValue: normBc,
        message: `الباركود [${normBc}] مكرر أكثر من مرة داخل نفس الصنف`
      });
      continue;
    }
    seenNormalizedBarcodes.add(normBcKey);

    const conflict = sourceItems.find(other => {
      if (targetExcludeId && other.id === targetExcludeId) return false;
      if (other.barcode && normalizeItemBarcode(other.barcode).toLowerCase() === normBcKey) return true;
      if (Array.isArray(other.secondaryBarcodes) && other.secondaryBarcodes.some(sb => normalizeItemBarcode(sb).toLowerCase() === normBcKey)) return true;
      if (Array.isArray(other.barcodes) && other.barcodes.some(b => normalizeItemBarcode(b.barcode).toLowerCase() === normBcKey)) return true;
      return false;
    });

    if (conflict) {
      conflicts.push({
        field: 'barcode',
        value: rawBc,
        normalizedValue: normBc,
        conflictingItem: {
          id: conflict.id,
          name: conflict.name,
          code: getItemDisplayCode(conflict),
          sku: conflict.sku,
          barcode: conflict.barcode
        },
        message: `الباركود [${normBc}] مسجل بالفعل لصنف آخر: ${formatConflictItemInfo(conflict)}`
      });
    }
  }

  const firstConflict = conflicts[0];
  return {
    success: true,
    isDuplicate: conflicts.length > 0,
    field: firstConflict?.field,
    conflictingItem: firstConflict?.conflictingItem,
    conflicts,
    error: firstConflict?.message,
    message: firstConflict ? firstConflict.message : 'البيانات متاحة وغير مكررة'
  };
}

/**
 * حفظ أو تعديل صنف
 */
export async function saveItem(item: Partial<Item> & { name: string }, session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string }): Promise<{ success: boolean; item?: Item; error?: string; code?: string }> {
  // التحقق من القيم الرقمية (منع القيم السالبة):
  if (Number(item.salePrice || 0) < 0) {
    return { success: false, error: 'سعر البيع لا يمكن أن يكون سالباً' };
  }
  if (item.purchasePrice !== undefined && Number(item.purchasePrice) < 0) {
    return { success: false, error: 'سعر الشراء لا يمكن أن يكون سالباً' };
  }
  if (item.packagingCost !== undefined && Number(item.packagingCost) < 0) {
    return { success: false, error: 'تكلفة التغليف لا يمكن أن تكون سالبة' };
  }
  if (item.taxRate !== undefined && (Number(item.taxRate) < 0 || Number(item.taxRate) > 100)) {
    return { success: false, error: 'نسبة الضريبة يجب أن تكون بين 0% و 100%' };
  }
  if (item.stockQuantity !== undefined && Number(item.stockQuantity) < 0) {
    return { success: false, error: 'الكمية بالمخزن لا يمكن أن تكون سالبة' };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    if (item.name !== undefined && !normalizeItemName(String(item.name))) {
      return { success: false, error: 'اسم الصنف مطلوب' };
    }
    if (!item.id && !normalizeItemName(String(item.name || ''))) {
      return { success: false, error: 'اسم الصنف مطلوب' };
    }
    const rawPrimary = item.barcode !== undefined ? String(item.barcode || '') : '';
    const primaryBarcode = normalizeItemBarcode(rawPrimary);
    const rawSec = Array.isArray(item.secondaryBarcodes) ? item.secondaryBarcodes : [];
    const secondaryBarcodes = rawSec
      .map(b => normalizeItemBarcode(String(b)))
      .filter(b => b.length > 0 && b.toLowerCase() !== primaryBarcode.toLowerCase());
    const rawSku = item.sku !== undefined
      ? String(item.sku || '')
      : ((item as any).code !== undefined ? String((item as any).code || '') : '');
    const normalizedSku = normalizeItemBarcode(rawSku) || undefined;

    const res = await callAppsScript('saveItem', {
      ...item,
      printName: item.printName !== undefined ? String(item.printName || '').trim().replace(/\s+/g, ' ').slice(0, 120) : undefined,
      barcode: primaryBarcode,
      secondaryBarcodes,
      sku: normalizedSku,
      reorderLimit: item.reorderLimit !== undefined ? Number(item.reorderLimit) : undefined,
      supplier: item.supplier ? String(item.supplier).trim() : '',
      taxRate: Number(item.taxRate || 0),
      pickupFee: item.pickupFee !== undefined && Number(item.pickupFee) > 0 ? Number(item.pickupFee) : undefined,
      enableBnpl: Boolean(item.enableBnpl),
      bnplPercentage: Number(item.bnplPercentage || 0),
      platformIds: Array.isArray(item.platformIds) ? item.platformIds : []
    }, session?.token);
    if (res.success && res.item) {
      return { success: true, item: res.item };
    }
    return buildSheetsWriteFailure(res, 'تعذر حفظ الصنف في Google Sheets');
  }

  const id = item.id || generateUUID();
  const existingIdx = memoryItems.findIndex(i => i.id === id);
  const existingItem = existingIdx >= 0 ? memoryItems[existingIdx] : null;

  const candidateName = item.name !== undefined ? String(item.name) : (existingItem?.name || '');
  if (!normalizeItemName(candidateName)) {
    return { success: false, error: 'اسم الصنف مطلوب' };
  }

  const rawPrimaryBarcode = item.barcode !== undefined ? String(item.barcode || '') : (existingItem?.barcode || '');
  const rawSecondaryList = item.secondaryBarcodes !== undefined
    ? (item.secondaryBarcodes || [])
    : (existingItem?.secondaryBarcodes || []);
  const rawSku = item.sku !== undefined
    ? String(item.sku || '')
    : ((item as any).code !== undefined ? String((item as any).code || '') : (existingItem?.sku || ''));

  // التحقق الموحد من عدم تكرار الاسم أو الباركود أو الكود
  const uniquenessCheck = checkItemUniqueness({
    excludeId: id,
    name: candidateName,
    barcode: rawPrimaryBarcode,
    secondaryBarcodes: rawSecondaryList,
    sku: rawSku
  });
  if (uniquenessCheck.isDuplicate) {
    return { success: false, error: uniquenessCheck.error };
  }

  // استخراج الباركود الأساسي والباركودات الفرعية والكود بعد التوحيد
  const primaryBarcode = normalizeItemBarcode(rawPrimaryBarcode);
  const secondaryBarcodes = rawSecondaryList
    .map(b => normalizeItemBarcode(String(b)))
    .filter(b => b.length > 0 && b.toLowerCase() !== primaryBarcode.toLowerCase());
  const normalizedSku = normalizeItemBarcode(rawSku) || undefined;

  const now = new Date().toISOString();
  const canViewPurchase = session?.role === 'designer' || session?.permissions?.includes('prices.view_purchase');
  const canViewPackaging = session?.role === 'designer' || session?.permissions?.includes('prices.view_packaging');

  const purchasePrice = canViewPurchase ? Number(item.purchasePrice || 0) : (existingItem?.purchasePrice || 0);
  const packagingCost = canViewPackaging ? Number(item.packagingCost || 0) : (existingItem?.packagingCost || 0);

  const explicitWhId = (item as any).warehouseId ? String((item as any).warehouseId).trim() : undefined;
  const whRes = resolveWarehouseForOperation(explicitWhId, session as any, {
    fallbackWarehouseId: getDefaultWarehouse().id,
    requireActive: Boolean(explicitWhId),
    enforceUserAccess: Boolean(explicitWhId),
    allowFallbackWhenOmitted: !explicitWhId
  });
  if (!whRes.ok) {
    return { success: false, error: whRes.error };
  }
  const targetWh = whRes.warehouse;

  const itemToSave: Item = {
    id,
    name: candidateName.trim().replace(/\s+/g, ' '),
    printName: item.printName !== undefined
      ? String(item.printName || '').trim().replace(/\s+/g, ' ').slice(0, 120)
      : (existingItem?.printName || ''),
    categoryId: item.categoryId !== undefined ? (item.categoryId ? String(item.categoryId).trim() : undefined) : existingItem?.categoryId,
    imageUrl: item.imageUrl !== undefined ? item.imageUrl : (existingItem?.imageUrl || ''),
    barcode: primaryBarcode || undefined,
    secondaryBarcodes: secondaryBarcodes.length > 0 ? secondaryBarcodes : undefined,
    sku: normalizedSku,
    supplier: item.supplier !== undefined ? (item.supplier ? String(item.supplier).trim() : '') : existingItem?.supplier,
    unit: item.unit !== undefined ? (item.unit ? String(item.unit).trim() : undefined) : existingItem?.unit,
    taxRate: Number(item.taxRate ?? existingItem?.taxRate ?? 0),
    salePrice: Number(item.salePrice ?? existingItem?.salePrice ?? 0),
    minPrice: item.minPrice !== undefined ? Number(item.minPrice) : existingItem?.minPrice,
    purchasePrice,
    packagingCost,
    stockQuantity: existingItem ? Number(existingItem.stockQuantity || 0) : 0,
    reorderLimit: item.reorderLimit !== undefined ? Number(item.reorderLimit) : existingItem?.reorderLimit,
    notes: item.notes !== undefined ? item.notes : (existingItem?.notes || ''),
    createdAt: item.createdAt || existingItem?.createdAt || now,
    updatedAt: now,
    purchaseDate: item.purchaseDate !== undefined ? item.purchaseDate : existingItem?.purchaseDate,
    expiryDate: item.expiryDate !== undefined ? item.expiryDate : existingItem?.expiryDate,
    status: item.status || existingItem?.status || 'نشط',
    enableBnpl: item.enableBnpl !== undefined ? Boolean(item.enableBnpl) : (existingItem?.enableBnpl ?? false),
    bnplPercentage: item.bnplPercentage !== undefined ? Number(item.bnplPercentage) : (existingItem?.bnplPercentage ?? 0),
    pickupFee: item.pickupFee !== undefined
      ? (item.pickupFee !== null && (item as any).pickupFee !== '' && Number(item.pickupFee) > 0 ? Number(item.pickupFee) : undefined)
      : existingItem?.pickupFee,
    platformIds: Array.isArray(item.platformIds) ? item.platformIds : (existingItem?.platformIds || [])
  };

  const userName = (session as any)?.name || (session as any)?.phone || 'المستخدم';

  if (existingIdx >= 0 && existingItem) {
    memoryItems[existingIdx] = itemToSave;

    // 1. فحص تغير الكمية وتسجيل حركة مخزون تلقائيًا على المخزن المستهدف
    if (item.stockQuantity !== undefined) {
      if (explicitWhId) {
        const oldWhQty = getItemWarehouseStock(id, targetWh.id);
        const newWhQty = Math.round(Number(item.stockQuantity) * 1000) / 1000;
        if (oldWhQty !== newWhQty) {
          setItemWarehouseBalance(id, targetWh.id, newWhQty);
          const diff = Math.round((newWhQty - oldWhQty) * 1000) / 1000;
          const sm: StockMovement = {
            id: generateUUID(),
            date: now,
            itemId: id,
            itemName: itemToSave.name,
            warehouseId: targetWh.id,
            warehouseName: targetWh.name,
            documentNumber: `ADJ-${Date.now().toString().slice(-6)}`,
            movementType: 'تسوية جرد',
            quantity: Math.abs(diff),
            quantityBefore: oldWhQty,
            quantityAfter: newWhQty,
            balanceAfter: newWhQty,
            notes: (item as any).editReason || (diff > 0 ? `زيادة رصيد بمخزن "${targetWh.name}" (+${diff})` : `خصم رصيد بمخزن "${targetWh.name}" (${diff})`),
            userName
          };
          memoryStockMovements.push(sm);

          memoryItemChangeLogs.push({
            id: generateUUID(),
            itemId: id,
            itemName: itemToSave.name,
            fieldName: 'الكمية بالمخزن',
            oldValue: oldWhQty,
            newValue: newWhQty,
            userName,
            timestamp: now,
            reason: (item as any).editReason || `تعديل كمية المخزون (${targetWh.name})`
          });
        }
      } else {
        const oldTotal = Number(existingItem.stockQuantity || 0);
        const requestedTotal = Math.round(Number(item.stockQuantity) * 1000) / 1000;
        const diff = Math.round((requestedTotal - oldTotal) * 1000) / 1000;
        if (diff !== 0) {
          const oldWhQty = getItemWarehouseStock(id, targetWh.id);
          const adj = adjustItemWarehouseDelta(id, targetWh.id, diff);
          const sm: StockMovement = {
            id: generateUUID(),
            date: now,
            itemId: id,
            itemName: itemToSave.name,
            warehouseId: targetWh.id,
            warehouseName: targetWh.name,
            documentNumber: `ADJ-${Date.now().toString().slice(-6)}`,
            movementType: 'تسوية جرد',
            quantity: Math.abs(diff),
            quantityBefore: oldWhQty,
            quantityAfter: adj.balanceInWarehouse,
            balanceAfter: adj.balanceInWarehouse,
            notes: (item as any).editReason || (diff > 0 ? `زيادة رصيد بمخزن "${targetWh.name}" (+${diff})` : `خصم رصيد بمخزن "${targetWh.name}" (${diff})`),
            userName
          };
          memoryStockMovements.push(sm);

          memoryItemChangeLogs.push({
            id: generateUUID(),
            itemId: id,
            itemName: itemToSave.name,
            fieldName: 'الكمية بالمخزن',
            oldValue: oldTotal,
            newValue: adj.totalStock,
            userName,
            timestamp: now,
            reason: (item as any).editReason || 'تعديل كمية المخزون'
          });
        }
      }
    }
    recomputeItemTotalStock(id);

    // 2. تسجيل تغير السعر
    if (Number(existingItem.salePrice || 0) !== Number(itemToSave.salePrice || 0)) {
      memoryItemChangeLogs.push({
        id: generateUUID(),
        itemId: id,
        itemName: itemToSave.name,
        fieldName: 'سعر البيع',
        oldValue: existingItem.salePrice,
        newValue: itemToSave.salePrice,
        userName,
        timestamp: now,
        reason: (item as any).editReason || 'تعديل سعر البيع'
      });
    }

    // 3. تسجيل تغير سعر الشراء إن وجد وتغير
    if (canViewPurchase && existingItem.purchasePrice !== undefined && itemToSave.purchasePrice !== undefined && Number(existingItem.purchasePrice) !== Number(itemToSave.purchasePrice)) {
      memoryItemChangeLogs.push({
        id: generateUUID(),
        itemId: id,
        itemName: itemToSave.name,
        fieldName: 'سعر الشراء',
        oldValue: existingItem.purchasePrice,
        newValue: itemToSave.purchasePrice,
        userName,
        timestamp: now,
        reason: (item as any).editReason || 'تعديل سعر الشراء'
      });
    }

    // 4. تسجيل تغير الباركود أو المورد
    if ((existingItem.barcode || '') !== (itemToSave.barcode || '')) {
      memoryItemChangeLogs.push({
        id: generateUUID(),
        itemId: id,
        itemName: itemToSave.name,
        fieldName: 'الباركود الأساسي',
        oldValue: existingItem.barcode || 'فارغ',
        newValue: itemToSave.barcode || 'فارغ',
        userName,
        timestamp: now,
        reason: (item as any).editReason || 'تعديل الباركود'
      });
    }
    if ((existingItem.supplier || '') !== (itemToSave.supplier || '')) {
      memoryItemChangeLogs.push({
        id: generateUUID(),
        itemId: id,
        itemName: itemToSave.name,
        fieldName: 'المورد',
        oldValue: existingItem.supplier || 'فارغ',
        newValue: itemToSave.supplier || 'فارغ',
        userName,
        timestamp: now,
        reason: (item as any).editReason || 'تعديل المورد'
      });
    }
    if ((existingItem.printName || '') !== (itemToSave.printName || '')) {
      memoryItemChangeLogs.push({
        id: generateUUID(),
        itemId: id,
        itemName: itemToSave.name,
        fieldName: 'اسم الطباعة',
        oldValue: existingItem.printName || 'فارغ',
        newValue: itemToSave.printName || 'فارغ',
        userName,
        timestamp: now,
        reason: (item as any).editReason || 'تعديل اسم الطباعة'
      });
    }

    recordAuditLog(session || {}, 'ITEM_EDIT', 'Item', id, `تعديل صنف: ${item.name}`);
  } else {
    memoryItems.unshift(itemToSave);
    const initialQty = Math.max(0, Number(item.stockQuantity ?? 0));
    setItemWarehouseBalance(id, targetWh.id, initialQty);
    recordAuditLog(session || {}, 'ITEM_CREATE', 'Item', id, `إضافة صنف: ${item.name}`);

    // إضافة حركة مخزون افتتاحية إذا كان الصنف الجديد برصيد مبدئي
    if (initialQty > 0) {
      memoryStockMovements.push({
        id: generateUUID(),
        date: now,
        itemId: id,
        itemName: itemToSave.name,
        warehouseId: targetWh.id,
        warehouseName: targetWh.name,
        documentNumber: `INIT-${Date.now().toString().slice(-6)}`,
        movementType: 'استيراد رصيد افتتاحي',
        quantity: initialQty,
        quantityBefore: 0,
        quantityAfter: initialQty,
        balanceAfter: initialQty,
        notes: `رصيد افتتاحي بمخزن "${targetWh.name}" عند إضافة الصنف`,
        userName
      });
    }
  }

  // تحديث سجلات الباركودات في ورقة ItemBarcodes
  memoryItemBarcodes = memoryItemBarcodes.filter(b => b.itemId !== id);
  if (primaryBarcode) {
    memoryItemBarcodes.push({
      itemId: id,
      barcode: primaryBarcode,
      type: 'primary',
      label: 'الباركود الأساسي',
      active: true,
      createdAt: now
    });
  }
  for (const sec of secondaryBarcodes) {
    memoryItemBarcodes.push({
      itemId: id,
      barcode: sec,
      type: 'secondary',
      label: 'باركود فرعي',
      active: true,
      createdAt: now
    });
  }

  return { success: true, item: itemToSave };
}

export interface InlineUpdateItemPayload {
  name?: string;
  printName?: string;
  notes?: string;
  purchasePrice?: number;
  salePrice?: number;
  barcode?: string;
  categoryId?: string | null;
  unit?: string;
  lastUpdated?: string;
}

/**
 * تعديل مباشر لحقول محددة من الصنف داخل جدول الأصناف
 * يطبق نفس قواعد بطاقة الصنف + منع الكتابة فوق تعديل آخر + تسجيل التدقيق بالقديم والجديد
 */
export async function inlineUpdateItem(
  id: string,
  payload: InlineUpdateItemPayload,
  session?: {
    token?: string;
    id?: string;
    userId?: string;
    name?: string;
    phone?: string;
    role: UserRole;
    isOwner?: boolean;
    permissions: PermissionKey[];
  }
): Promise<{
  success: boolean;
  item?: Item;
  error?: string;
  code?: string;
  statusCode?: number;
}> {
  const cleanId = String(id || '').trim();
  if (!cleanId) {
    return { success: false, statusCode: 400, error: 'معرف الصنف مطلوب' };
  }

  const isPrivileged = Boolean(session && (session.role === 'designer' || session.isOwner));
  const hasInlineEditPerm = Boolean(isPrivileged || session?.permissions?.includes('products.inline_edit'));
  if (!hasInlineEditPerm) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية التعديل المباشر من جدول الأصناف [products.inline_edit]'
    };
  }

  const canViewPurchase = Boolean(isPrivileged || session?.permissions?.includes('prices.view_purchase'));
  const canViewPackaging = Boolean(isPrivileged || session?.permissions?.includes('prices.view_packaging'));
  const canOverrideMinPrice = Boolean(isPrivileged || session?.permissions?.includes('prices.override_min_price'));

  // سعر الشراء يظهر ويُعدّل لمن يملك صلاحية رؤية التكلفة فقط (ويتحقق الخادم من ذلك أيضًا)
  if (payload.purchasePrice !== undefined && !canViewPurchase) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح لك بعرض أو تعديل سعر الشراء'
    };
  }

  if (payload.salePrice !== undefined) {
    const numSale = Number(payload.salePrice);
    if (!Number.isFinite(numSale) || numSale < 0) {
      return { success: false, statusCode: 400, error: 'سعر البيع لا يمكن أن يكون سالباً' };
    }
  }

  if (payload.purchasePrice !== undefined) {
    const numPurchase = Number(payload.purchasePrice);
    if (!Number.isFinite(numPurchase) || numPurchase < 0) {
      return { success: false, statusCode: 400, error: 'سعر الشراء لا يمكن أن يكون سالباً' };
    }
  }

  if (payload.name !== undefined && !normalizeItemName(String(payload.name))) {
    return { success: false, statusCode: 400, error: 'اسم الصنف مطلوب' };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript(
      'inlineUpdateItem',
      {
        id: cleanId,
        ...payload
      },
      session?.token
    );
    if (res?.success && res.item) {
      const catMap = new Map((getSheetsCache<ProductCategory[]>('categories')?.data || []).map(c => [c.id, c.name]));
      const copy: any = {
        ...res.item,
        categoryName: res.item.categoryName || (res.item.categoryId ? catMap.get(res.item.categoryId) : '') || '',
        updatedAt: res.item.updatedAt || res.item.createdAt || new Date().toISOString()
      };
      if (!canViewPurchase) delete copy.purchasePrice;
      if (!canViewPackaging) delete copy.packagingCost;
      return { success: true, item: copy };
    }
    if (res?.code === 'CONFLICT' || res?.statusCode === 409) {
      return {
        success: false,
        statusCode: 409,
        code: 'CONFLICT',
        error: res.error || 'الصنف عُدّل من مستخدم آخر، حدّث الصفحة'
      };
    }
    const failure = buildSheetsWriteFailure(res, 'تعذر حفظ التعديل المباشر للصنف في Google Sheets');
    return {
      ...failure,
      statusCode: res?.statusCode || 400
    };
  }

  const existingIdx = memoryItems.findIndex(i => i.id === cleanId);
  if (existingIdx < 0) {
    return { success: false, statusCode: 404, error: 'الصنف غير موجود' };
  }
  const existingItem = memoryItems[existingIdx];

  // منع الكتابة فوق تعديل آخر: يُرسل وقت آخر تعديل للصنف مع الطلب؛ لو تغيّر على الخادم يُرفض التعديل
  const currentLastUpdated = String(existingItem.updatedAt || existingItem.createdAt || '').trim();
  if (
    payload.lastUpdated !== undefined &&
    currentLastUpdated &&
    String(payload.lastUpdated).trim() !== currentLastUpdated
  ) {
    return {
      success: false,
      statusCode: 409,
      code: 'CONFLICT',
      error: 'الصنف عُدّل من مستخدم آخر، حدّث الصفحة'
    };
  }

  // التحقق من الحد الأدنى لسعر البيع
  const nextSalePrice =
    payload.salePrice !== undefined
      ? Math.round(Number(payload.salePrice) * 100) / 100
      : Number(existingItem.salePrice || 0);
  const minPrice = Number(existingItem.minPrice || 0);
  if (payload.salePrice !== undefined && minPrice > 0 && nextSalePrice < minPrice && !canOverrideMinPrice) {
    return {
      success: false,
      statusCode: 403,
      error: `سعر البيع (${nextSalePrice}) أقل من الحد الأدنى المسموح به للصنف (${minPrice}) ولا تملك صلاحية التجاوز`
    };
  }

  const nextName =
    payload.name !== undefined
      ? String(payload.name).trim().replace(/\s+/g, ' ')
      : existingItem.name;
  const rawNextBarcode =
    payload.barcode !== undefined
      ? String(payload.barcode || '')
      : (existingItem.barcode || '');
  const nextBarcode = normalizeItemBarcode(rawNextBarcode);

  // منع تكرار الاسم ومنع تكرار الباركود
  const uniquenessCheck = checkItemUniqueness({
    excludeId: cleanId,
    name: nextName,
    barcode: nextBarcode,
    secondaryBarcodes: existingItem.secondaryBarcodes || [],
    sku: existingItem.sku || ''
  });
  if (uniquenessCheck.isDuplicate) {
    return {
      success: false,
      statusCode: 400,
      error: uniquenessCheck.error
    };
  }

  const nextPrintName =
    payload.printName !== undefined
      ? String(payload.printName || '').trim().replace(/\s+/g, ' ').slice(0, 120)
      : (existingItem.printName || '');
  const nextNotes =
    payload.notes !== undefined ? String(payload.notes) : (existingItem.notes || '');
  const nextPurchasePrice =
    payload.purchasePrice !== undefined && canViewPurchase
      ? Math.round(Number(payload.purchasePrice) * 100) / 100
      : Number(existingItem.purchasePrice || 0);
  const nextCategoryId =
    payload.categoryId !== undefined
      ? (payload.categoryId ? String(payload.categoryId).trim() : undefined)
      : existingItem.categoryId;
  const nextUnit =
    payload.unit !== undefined
      ? (String(payload.unit).trim() || undefined)
      : existingItem.unit;

  const catMap = new Map(memoryCategories.map(c => [c.id, c.name]));
  const changes: Array<{ label: string; oldVal: string | number; newVal: string | number }> = [];

  if (existingItem.name !== nextName) {
    changes.push({ label: 'اسم الصنف', oldVal: existingItem.name, newVal: nextName });
  }
  if ((existingItem.printName || '') !== nextPrintName) {
    changes.push({ label: 'اسم الطباعة', oldVal: existingItem.printName || 'فارغ', newVal: nextPrintName || 'فارغ' });
  }
  if ((existingItem.notes || '') !== nextNotes) {
    changes.push({ label: 'الوصف', oldVal: existingItem.notes || 'فارغ', newVal: nextNotes || 'فارغ' });
  }
  if (
    payload.purchasePrice !== undefined &&
    canViewPurchase &&
    Number(existingItem.purchasePrice || 0) !== nextPurchasePrice
  ) {
    changes.push({
      label: 'سعر الشراء',
      oldVal: Number(existingItem.purchasePrice || 0),
      newVal: nextPurchasePrice
    });
  }
  if (
    payload.salePrice !== undefined &&
    Number(existingItem.salePrice || 0) !== nextSalePrice
  ) {
    changes.push({
      label: 'سعر البيع',
      oldVal: Number(existingItem.salePrice || 0),
      newVal: nextSalePrice
    });
  }
  if ((existingItem.barcode || '') !== (nextBarcode || '')) {
    changes.push({
      label: 'الباركود الرئيسي',
      oldVal: existingItem.barcode || 'فارغ',
      newVal: nextBarcode || 'فارغ'
    });
  }
  if ((existingItem.categoryId || '') !== (nextCategoryId || '')) {
    const oldCatName = existingItem.categoryId ? (catMap.get(existingItem.categoryId) || existingItem.categoryId) : 'بدون تصنيف';
    const newCatName = nextCategoryId ? (catMap.get(nextCategoryId) || nextCategoryId) : 'بدون تصنيف';
    changes.push({
      label: 'التصنيف',
      oldVal: oldCatName,
      newVal: newCatName
    });
  }
  if ((existingItem.unit || '') !== (nextUnit || '')) {
    changes.push({
      label: 'الوحدة',
      oldVal: existingItem.unit || 'فارغ',
      newVal: nextUnit || 'فارغ'
    });
  }

  let now = new Date().toISOString();
  if (changes.length > 0 && now === currentLastUpdated) {
    now = new Date(Date.now() + 1).toISOString();
  }
  const updatedItem: Item = {
    ...existingItem,
    name: nextName,
    printName: nextPrintName,
    notes: nextNotes,
    purchasePrice: nextPurchasePrice,
    salePrice: nextSalePrice,
    barcode: nextBarcode || undefined,
    categoryId: nextCategoryId,
    categoryName: nextCategoryId ? (catMap.get(nextCategoryId) || '') : '',
    unit: nextUnit,
    updatedAt: changes.length > 0 ? now : (existingItem.updatedAt || existingItem.createdAt || now)
  };

  if (changes.length > 0) {
    memoryItems[existingIdx] = updatedItem;

    // تحديث جدول الباركودات عند تغير الباركود الأساسي
    if ((existingItem.barcode || '') !== (nextBarcode || '')) {
      memoryItemBarcodes = memoryItemBarcodes.filter(
        b => !(b.itemId === cleanId && b.type === 'primary')
      );
      if (nextBarcode) {
        memoryItemBarcodes.push({
          itemId: cleanId,
          barcode: nextBarcode,
          type: 'primary',
          label: 'الباركود الأساسي',
          active: true,
          createdAt: now
        });
      }
    }

    const userName = session?.name || session?.phone || 'المستخدم';
    for (const ch of changes) {
      memoryItemChangeLogs.push({
        id: generateUUID(),
        itemId: cleanId,
        itemName: updatedItem.name,
        fieldName: ch.label,
        oldValue: ch.oldVal,
        newValue: ch.newVal,
        userName,
        timestamp: now,
        reason: 'تعديل مباشر من جدول الأصناف'
      });
    }

    const detailsText = changes
      .map(c => `${c.label}: من [${c.oldVal}] إلى [${c.newVal}]`)
      .join(' ، ');
    recordAuditLog(
      {
        id: session?.userId || session?.id,
        name: session?.name,
        role: session?.role,
        phone: session?.phone
      },
      'ITEM_INLINE_EDIT',
      'Item',
      cleanId,
      `تعديل مباشر للصنف (${updatedItem.name}) — ${detailsText}`
    );
  }

  const sanitizedCopy: any = { ...updatedItem };
  if (!canViewPurchase) delete sanitizedCopy.purchasePrice;
  if (!canViewPackaging) delete sanitizedCopy.packagingCost;

  return {
    success: true,
    item: sanitizedCopy
  };
}

/**
 * حذف صنف مع التحقق الصارم من عدم وجود معاملات سابقة
 */
export async function deleteItem(id: string, session?: { token?: string; role: UserRole; permissions: PermissionKey[] }): Promise<{ success: boolean; hasTransactions?: boolean; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('deleteItem', { id }, session?.token);
    if (res.success) return { success: true };
    return {
      ...buildSheetsWriteFailure(res, 'تعذر حذف الصنف من Google Sheets'),
      ...(res.hasTransactions !== undefined ? { hasTransactions: res.hasTransactions } : {})
    };
  }

  // 1. فحص وجود رصيد مخزني أكبر من صفر
  const targetItem = memoryItems.find(i => i.id === id);
  if (targetItem && Number(targetItem.stockQuantity || 0) > 0) {
    return {
      success: false,
      hasTransactions: true,
      error: `لا يمكن حذف هذا الصنف لأن كميته بالمخزن (${targetItem.stockQuantity}) أكبر من صفر. يجب تصفية أو تسوية رصيد المخزن أولاً، أو أرشفة الصنف بدلاً من حذفه للحفاظ على دقة الجرد.`
    };
  }

  // 2. فحص الارتباط بالمعاملات السابقة (فواتير بيع، مرتجعات، مشتريات، مرتجعات شراء، حركات مخزون)
  const usedInInvoices = memoryInvoices.some(inv => (inv.lines || []).some(l => l.itemId === id));
  const usedInReturns = memoryReturns.some(ret => (ret.lines || []).some(l => l.itemId === id));
  const usedInPurchases = memoryPurchases.some(p => (p.lines || []).some(l => l.itemId === id));
  const usedInPurchaseReturns = memoryPurchaseReturns.some(pr => (pr.lines || []).some(l => l.itemId === id));
  const usedInMovements = memoryStockMovements.some(
    sm =>
      sm.itemId === id &&
      sm.movementType !== 'استيراد رصيد افتتاحي' &&
      sm.movementType !== 'رصيد افتتاحي بالإكسيل'
  );

  if (usedInInvoices || usedInReturns || usedInPurchases || usedInPurchaseReturns || usedInMovements) {
    const reasons: string[] = [];
    if (usedInInvoices) reasons.push('فواتير بيع مسجلة');
    if (usedInReturns) reasons.push('سجلات مرتجعات مبيعات');
    if (usedInPurchases) reasons.push('فواتير شراء مسجلة');
    if (usedInPurchaseReturns) reasons.push('سجلات مرتجعات شراء');
    if (usedInMovements) reasons.push('حركات مخزون سابقة');

    return {
      success: false,
      hasTransactions: true,
      error: `لا يمكن حذف هذا الصنف لوجود معاملات سابقة مرتبطة به (${reasons.join('، ')}). يمكنك أرشفة الصنف بدلاً من حذفه لإيقاف ظهوره في المبيعات مع حماية التقارير والقيود المحاسبية التاريخية.`
    };
  }

  const existingIdx = memoryItems.findIndex(i => i.id === id);
  if (existingIdx >= 0) {
    const deletedName = memoryItems[existingIdx].name;
    memoryItems.splice(existingIdx, 1);
    memoryItemBarcodes = memoryItemBarcodes.filter(b => b.itemId !== id);
    memoryCosts = memoryCosts.filter(c => c.itemId !== id);
    memoryWarehouseStocks = memoryWarehouseStocks.filter(ws => ws.itemId !== id);
    recordAuditLog(session || {}, 'ITEM_DELETE', 'Item', id, `حذف صنف: ${deletedName}`);
    return { success: true };
  }
  return { success: false, error: 'الصنف غير موجود' };
}

export interface DuplicateCleanupItemSummary {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  createdAt?: string;
  stockQuantity: number;
  salePrice: number;
  status?: string;
  hasTransactions: boolean;
  transactionReasons: string[];
}

export interface DuplicateCleanupGroupPreview {
  groupKey: string;
  matchReasons: ('name' | 'barcode')[];
  matchLabel: string;
  keptItems: DuplicateCleanupItemSummary[];
  deleteItems: DuplicateCleanupItemSummary[];
  notDeletedItems: Array<DuplicateCleanupItemSummary & { skipReason: string }>;
}

export interface DuplicateCleanupPreviewResult {
  success: boolean;
  totalItems: number;
  duplicateGroupsCount: number;
  totalDeleteCount: number;
  totalKeptCount: number;
  totalNotDeletedCount: number;
  groups: DuplicateCleanupGroupPreview[];
  error?: string;
}

export interface DuplicateCleanupExecuteResult {
  success: boolean;
  duplicateGroupsBefore: number;
  duplicateGroupsAfter: number;
  deletedCount: number;
  keptCount: number;
  notDeletedCount: number;
  deletedItems: Array<{ id: string; name: string; sku?: string; barcode?: string }>;
  keptItems: Array<{ id: string; name: string; sku?: string; barcode?: string }>;
  notDeletedItems: Array<{ id: string; name: string; sku?: string; barcode?: string; reason: string }>;
  deletedCostsCount: number;
  deletedBarcodesCount: number;
  message: string;
  error?: string;
}

function isDesignerSession(session?: { role?: UserRole; isOwner?: boolean }): boolean {
  return Boolean(session && (session.role === 'designer' || session.isOwner));
}

function getItemTransactionReasonsInMemory(id: string): string[] {
  const reasons: string[] = [];
  if (memoryInvoices.some(inv => (inv.lines || []).some(l => l.itemId === id))) {
    reasons.push('فواتير بيع مسجلة');
  }
  if (memoryReturns.some(ret => (ret.lines || []).some(l => l.itemId === id))) {
    reasons.push('مرتجعات مبيعات مسجلة');
  }
  if (memoryPurchases.some(p => (p.lines || []).some(l => l.itemId === id))) {
    reasons.push('فواتير شراء مسجلة');
  }
  if (memoryPurchaseReturns.some(pr => (pr.lines || []).some(l => l.itemId === id))) {
    reasons.push('مرتجعات شراء مسجلة');
  }
  if (
    memoryStockMovements.some(
      sm =>
        sm.itemId === id &&
        sm.movementType !== 'استيراد رصيد افتتاحي' &&
        sm.movementType !== 'رصيد افتتاحي بالإكسيل'
    )
  ) {
    reasons.push('حركات مخزون سابقة');
  }
  return reasons;
}

function parseItemCreatedAtMs(createdAt?: string): number {
  if (!createdAt) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(createdAt);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function getAllNormalizedBarcodesForItem(item: Item): string[] {
  const set = new Set<string>();
  const addBc = (raw?: string | null) => {
    const norm = normalizeItemBarcode(raw).toLowerCase();
    if (norm) set.add(norm);
  };
  addBc(item.barcode);
  if (Array.isArray(item.secondaryBarcodes)) {
    for (const sb of item.secondaryBarcodes) addBc(sb);
  }
  if (Array.isArray(item.barcodes)) {
    for (const b of item.barcodes) addBc(typeof b === 'string' ? b : b?.barcode);
  }
  return Array.from(set);
}

function analyzeDuplicateItemsInMemory(): DuplicateCleanupPreviewResult {
  const n = memoryItems.length;
  if (n < 2) {
    return {
      success: true,
      totalItems: n,
      duplicateGroupsCount: 0,
      totalDeleteCount: 0,
      totalKeptCount: 0,
      totalNotDeletedCount: 0,
      groups: []
    };
  }

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const nameToFirstIdx = new Map<string, number>();
  const barcodeToFirstIdx = new Map<string, number>();
  const nameMatchedRoots = new Set<string>();
  const barcodeMatchedRoots = new Set<string>();

  for (let i = 0; i < n; i++) {
    const it = memoryItems[i];
    const normName = normalizeItemName(it.name);
    if (normName) {
      const first = nameToFirstIdx.get(normName);
      if (first !== undefined) {
        union(first, i);
        nameMatchedRoots.add(normName);
      } else {
        nameToFirstIdx.set(normName, i);
      }
    }

    const barcodes = getAllNormalizedBarcodesForItem(it);
    for (const bc of barcodes) {
      const first = barcodeToFirstIdx.get(bc);
      if (first !== undefined) {
        union(first, i);
        barcodeMatchedRoots.add(bc);
      } else {
        barcodeToFirstIdx.set(bc, i);
      }
    }
  }

  const componentMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = componentMap.get(root);
    if (list) list.push(i);
    else componentMap.set(root, [i]);
  }

  const groups: DuplicateCleanupGroupPreview[] = [];
  let totalDeleteCount = 0;
  let totalKeptCount = 0;
  let totalNotDeletedCount = 0;

  for (const indices of componentMap.values()) {
    if (indices.length < 2) continue;

    // ترتيب المجموعة من الأقدم إضافةً إلى الأحدث
    const sortedIndices = [...indices].sort((idxA, idxB) => {
      const timeA = parseItemCreatedAtMs(memoryItems[idxA].createdAt);
      const timeB = parseItemCreatedAtMs(memoryItems[idxB].createdAt);
      if (timeA !== timeB) return timeA - timeB;
      // في الذاكرة saveItem يضيف الأحدث في البداية (unshift)، لذا المؤشر الأكبر أقدم
      return idxB - idxA;
    });

    const summaries: DuplicateCleanupItemSummary[] = sortedIndices.map(idx => {
      const it = memoryItems[idx];
      const reasons = getItemTransactionReasonsInMemory(it.id);
      return {
        id: it.id,
        name: it.name,
        sku: it.sku,
        barcode: it.barcode,
        createdAt: it.createdAt,
        stockQuantity: Number(it.stockQuantity || 0),
        salePrice: Number(it.salePrice || 0),
        status: it.status,
        hasTransactions: reasons.length > 0,
        transactionReasons: reasons
      };
    });

    // تحديد أسباب التطابق داخل المجموعة
    const matchReasonsSet = new Set<'name' | 'barcode'>();
    const matchedNameLabels = new Set<string>();
    const matchedBarcodeLabels = new Set<string>();

    const groupNameCounts = new Map<string, number>();
    const groupBcCounts = new Map<string, number>();
    for (const idx of sortedIndices) {
      const it = memoryItems[idx];
      const nn = normalizeItemName(it.name);
      if (nn) groupNameCounts.set(nn, (groupNameCounts.get(nn) || 0) + 1);
      for (const bc of getAllNormalizedBarcodesForItem(it)) {
        groupBcCounts.set(bc, (groupBcCounts.get(bc) || 0) + 1);
      }
    }
    for (const idx of sortedIndices) {
      const it = memoryItems[idx];
      const nn = normalizeItemName(it.name);
      if (nn && (groupNameCounts.get(nn) || 0) > 1) {
        matchReasonsSet.add('name');
        matchedNameLabels.add(it.name);
      }
      for (const bc of getAllNormalizedBarcodesForItem(it)) {
        if ((groupBcCounts.get(bc) || 0) > 1) {
          matchReasonsSet.add('barcode');
          matchedBarcodeLabels.add(bc);
        }
      }
    }

    const protectedItems = summaries.filter(s => s.hasTransactions);
    const cleanItems = summaries.filter(s => !s.hasTransactions);

    let keptItems: DuplicateCleanupItemSummary[] = [];
    let deleteItems: DuplicateCleanupItemSummary[] = [];
    let notDeletedItems: Array<DuplicateCleanupItemSummary & { skipReason: string }> = [];

    if (protectedItems.length === 0) {
      // لا توجد حركات على أي صنف: يبقى الأقدم إضافةً ويُحذف الباقي
      keptItems = [cleanItems[0]];
      deleteItems = cleanItems.slice(1);
    } else if (cleanItems.length === 0) {
      // كل المجموعة عليها حركات: تُترك بالكامل وتظهر في «لم يُحذف» مع السبب
      keptItems = [];
      deleteItems = [];
      notDeletedItems = protectedItems.map(p => ({
        ...p,
        skipReason: `مرتبط بحركات سابقة لا تسمح بالحذف (${p.transactionReasons.join('، ')})`
      }));
    } else {
      // يوجد صنف أو أكثر عليه حركات وأصناف أخرى خالية: يبقى المحمي ويُحذف الخالي بدلًا منه
      keptItems = [protectedItems[0]];
      deleteItems = cleanItems;
      if (protectedItems.length > 1) {
        notDeletedItems = protectedItems.slice(1).map(p => ({
          ...p,
          skipReason: `مرتبط بحركات سابقة لا تسمح بالحذف (${p.transactionReasons.join('، ')})`
        }));
      }
    }

    const labelParts: string[] = [];
    if (matchedNameLabels.size > 0) {
      labelParts.push(`الاسم: ${Array.from(matchedNameLabels)[0]}`);
    }
    if (matchedBarcodeLabels.size > 0) {
      labelParts.push(`الباركود: ${Array.from(matchedBarcodeLabels).join('، ')}`);
    }

    groups.push({
      groupKey: sortedIndices.map(i => memoryItems[i].id).join('|'),
      matchReasons: Array.from(matchReasonsSet),
      matchLabel: labelParts.join(' | ') || summaries[0].name,
      keptItems,
      deleteItems,
      notDeletedItems
    });

    totalDeleteCount += deleteItems.length;
    totalKeptCount += keptItems.length;
    totalNotDeletedCount += notDeletedItems.length;
  }

  return {
    success: true,
    totalItems: n,
    duplicateGroupsCount: groups.length,
    totalDeleteCount,
    totalKeptCount,
    totalNotDeletedCount,
    groups
  };
}

/**
 * معاينة الأصناف المكررة قبل الحذف — مخصصة للمطور/مصمم النظام فقط
 */
export async function previewDuplicateItems(
  session?: { token?: string; role?: UserRole; isOwner?: boolean; name?: string; phone?: string }
): Promise<DuplicateCleanupPreviewResult> {
  if (!isDesignerSession(session)) {
    return {
      success: false,
      totalItems: 0,
      duplicateGroupsCount: 0,
      totalDeleteCount: 0,
      totalKeptCount: 0,
      totalNotDeletedCount: 0,
      groups: [],
      error: 'غير مصرح: هذه العملية مخصصة لمطور/مصمم النظام (designer) فقط'
    };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('previewDuplicateItems', {}, session?.token);
    if (res && res.success) {
      return res as DuplicateCleanupPreviewResult;
    }
    const failure = buildSheetsWriteFailure(res, 'فشل جلب معاينة الأصناف المكررة من Google Sheets');
    return {
      success: false,
      totalItems: 0,
      duplicateGroupsCount: 0,
      totalDeleteCount: 0,
      totalKeptCount: 0,
      totalNotDeletedCount: 0,
      groups: [],
      ...(failure.code ? { code: failure.code } : {}),
      error: failure.error
    };
  }

  return analyzeDuplicateItemsInMemory();
}

/**
 * تنفيذ حذف الأصناف المكررة وبياناتها التابعة (أسعار المنصات والباركودات) دون جمع الكميات — مخصصة للمطور/designer فقط
 */
export async function cleanupDuplicateItems(
  session?: { token?: string; id?: string; userId?: string; role?: UserRole; isOwner?: boolean; name?: string; phone?: string }
): Promise<DuplicateCleanupExecuteResult> {
  if (!isDesignerSession(session)) {
    return {
      success: false,
      duplicateGroupsBefore: 0,
      duplicateGroupsAfter: 0,
      deletedCount: 0,
      keptCount: 0,
      notDeletedCount: 0,
      deletedItems: [],
      keptItems: [],
      notDeletedItems: [],
      deletedCostsCount: 0,
      deletedBarcodesCount: 0,
      message: '',
      error: 'غير مصرح: هذه العملية مخصصة لمطور/مصمم النظام (designer) فقط'
    };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('cleanupDuplicateItems', {}, session?.token);
    if (res && res.success) {
      return res as DuplicateCleanupExecuteResult;
    }
    const failure = buildSheetsWriteFailure(res, 'فشل تنفيذ حذف الأصناف المكررة عبر Google Sheets');
    return {
      success: false,
      duplicateGroupsBefore: 0,
      duplicateGroupsAfter: 0,
      deletedCount: 0,
      keptCount: 0,
      notDeletedCount: 0,
      deletedItems: [],
      keptItems: [],
      notDeletedItems: [],
      deletedCostsCount: 0,
      deletedBarcodesCount: 0,
      message: '',
      ...(failure.code ? { code: failure.code } : {}),
      error: failure.error
    };
  }

  const beforePreview = analyzeDuplicateItemsInMemory();
  const deleteIds = new Set<string>();
  const deletedItems: Array<{ id: string; name: string; sku?: string; barcode?: string }> = [];
  const keptItems: Array<{ id: string; name: string; sku?: string; barcode?: string }> = [];
  const notDeletedItems: Array<{ id: string; name: string; sku?: string; barcode?: string; reason: string }> = [];

  for (const grp of beforePreview.groups) {
    for (const k of grp.keptItems) {
      keptItems.push({ id: k.id, name: k.name, sku: k.sku, barcode: k.barcode });
    }
    for (const d of grp.deleteItems) {
      deleteIds.add(d.id);
      deletedItems.push({ id: d.id, name: d.name, sku: d.sku, barcode: d.barcode });
    }
    for (const nd of grp.notDeletedItems) {
      notDeletedItems.push({
        id: nd.id,
        name: nd.name,
        sku: nd.sku,
        barcode: nd.barcode,
        reason: nd.skipReason
      });
    }
  }

  let deletedCostsCount = 0;
  let deletedBarcodesCount = 0;

  if (deleteIds.size > 0) {
    // حذف الأصناف المكررة فقط دون إضافة كمياتها على الصنف المتبقي
    memoryItems = memoryItems.filter(it => !deleteIds.has(it.id));

    const prevBarcodesLen = memoryItemBarcodes.length;
    memoryItemBarcodes = memoryItemBarcodes.filter(b => !deleteIds.has(b.itemId));
    deletedBarcodesCount = prevBarcodesLen - memoryItemBarcodes.length;

    const prevCostsLen = memoryCosts.length;
    memoryCosts = memoryCosts.filter(c => !deleteIds.has(c.itemId));
    deletedCostsCount = prevCostsLen - memoryCosts.length;

    memoryItemChangeLogs = memoryItemChangeLogs.filter(l => !deleteIds.has(l.itemId));
    memoryWarehouseStocks = memoryWarehouseStocks.filter(ws => !deleteIds.has(ws.itemId));
    memoryStockMovements = memoryStockMovements.filter(
      sm =>
        !(
          deleteIds.has(sm.itemId) &&
          (sm.movementType === 'استيراد رصيد افتتاحي' || sm.movementType === 'رصيد افتتاحي بالإكسيل')
        )
    );
  }

  const afterPreview = analyzeDuplicateItemsInMemory();
  const deletedNamesSummary = deletedItems.map(d => d.name).join('، ');
  const auditDetails = `تنظيف الأصناف المكررة: حذف ${deletedItems.length} صنف (${deletedNamesSummary || 'لا يوجد'})، الإبقاء على ${keptItems.length}، لم يُحذف ${notDeletedItems.length}، حذف ${deletedCostsCount} ربط/سعر منصة`;

  recordAuditLog(
    { id: session?.id || session?.userId, name: session?.name, role: session?.role, phone: session?.phone },
    'ITEMS_DUPLICATES_CLEANUP',
    'Item',
    'BATCH',
    auditDetails
  );

  return {
    success: true,
    duplicateGroupsBefore: beforePreview.duplicateGroupsCount,
    duplicateGroupsAfter: afterPreview.duplicateGroupsCount,
    deletedCount: deletedItems.length,
    keptCount: keptItems.length,
    notDeletedCount: notDeletedItems.length,
    deletedItems,
    keptItems,
    notDeletedItems,
    deletedCostsCount,
    deletedBarcodesCount,
    message:
      deletedItems.length > 0
        ? `تم حذف ${deletedItems.length} صنف مكرر بنجاح (${deletedNamesSummary})`
        : 'لم يتم حذف أي صنف مكرر'
  };
}

/**
 * دالة مساعدة للاختبارات فقط: حقن صنف مكرر في الذاكرة لاختبار تنظيف التكرارات التاريخية
 */
export function _unsafeSeedDuplicateItemForTest(item: Item): Item {
  memoryItems.unshift(item);
  if (item.barcode) {
    memoryItemBarcodes.push({
      itemId: item.id,
      barcode: item.barcode,
      type: 'primary',
      label: 'الباركود الأساسي',
      active: true,
      createdAt: item.createdAt || new Date().toISOString()
    });
  }
  if (Array.isArray(item.secondaryBarcodes)) {
    for (const sb of item.secondaryBarcodes) {
      memoryItemBarcodes.push({
        itemId: item.id,
        barcode: sb,
        type: 'secondary',
        label: 'باركود فرعي',
        active: true,
        createdAt: item.createdAt || new Date().toISOString()
      });
    }
  }
  return item;
}

export function _getItemCleanupDiagnosticsForTest() {
  return {
    items: memoryItems,
    costs: memoryCosts,
    barcodes: memoryItemBarcodes,
    auditLogs: memoryAuditLogs
  };
}

/**
 * أرشفة صنف (إيقاف ظهوره مع الحفاظ عليه)
 */
export async function archiveItem(id: string, session?: { token?: string; role?: UserRole; permissions?: PermissionKey[]; name?: string; phone?: string }): Promise<{ success: boolean; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('archiveItem', { id }, session?.token);
    if (res.success) return { success: true };
    return buildSheetsWriteFailure(res, 'تعذر أرشفة الصنف في Google Sheets');
  }

  const existingIdx = memoryItems.findIndex(i => i.id === id);
  if (existingIdx >= 0) {
    memoryItems[existingIdx].status = 'مؤرشف';
    recordAuditLog(session || {}, 'ITEM_ARCHIVE', 'Item', id, `أرشفة صنف: ${memoryItems[existingIdx].name}`);
    return { success: true };
  }
  return { success: false, error: 'الصنف غير موجود' };
}

/**
 * جلب سجل الحركات والتعديلات لصنف محدد
 */
export async function getItemLogs(itemId: string, session?: { token?: string }): Promise<{ success: boolean; changeLogs: ItemChangeLogEntry[]; stockMovements: StockMovement[]; error?: string; code?: string; stale?: boolean; lastSyncAt?: string }> {
  const config = getSystemConfig();
  const cacheKey = `itemLogs:${itemId}`;
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getItemLogs', { itemId }, session?.token);
    if (res.success && res.data) {
      const result = {
        success: true,
        changeLogs: res.data.changeLogs || [],
        stockMovements: res.data.stockMovements || []
      };
      setSheetsCache(cacheKey, result);
      return result;
    }
    const cached = getSheetsCache<{ success: boolean; changeLogs: ItemChangeLogEntry[]; stockMovements: StockMovement[] }>(cacheKey);
    if (cached) {
      return {
        ...cached.data,
        stale: true,
        lastSyncAt: cached.lastSyncAt
      };
    }
    return {
      ...buildSheetsWriteFailure(res, 'تعذر جلب سجل الصنف من Google Sheets'),
      changeLogs: [],
      stockMovements: []
    };
  }

  const changeLogs = memoryItemChangeLogs
    .filter(l => l.itemId === itemId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const stockMovements = memoryStockMovements
    .filter(m => m.itemId === itemId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return { success: true, changeLogs, stockMovements };
}

/**
 * استيراد دفعة أصناف من ملف Excel أو CSV
 */
export async function importItemsBatch(
  payload: { items: any[]; updateExisting: boolean; fileName: string; warehouseId?: string },
  session?: { token?: string; role?: UserRole; permissions: PermissionKey[]; name?: string; phone?: string; id?: string; userId?: string; isOwner?: boolean }
): Promise<{
  success: boolean;
  batchId: string;
  totalCount: number;
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
  errors: string[];
  zeroSalePriceCount?: number;
  zeroSalePriceWarning?: string;
  warnings?: string[];
  newCategories?: Array<{ id?: string; name: string; itemsCount: number }>;
  error?: string;
  code?: string;
}> {
  const { items, updateExisting, fileName } = payload;
  if (!Array.isArray(items) || items.length === 0) {
    return {
      success: false,
      batchId: '',
      totalCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      errorCount: 1,
      errors: ['الملف فارغ أو لا يحتوي على صفوف بيانات صالحة'],
      error: 'الملف فارغ أو لا يحتوي على صفوف بيانات صالحة'
    };
  }

  const batchId = `BATCH-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userName = session?.name || session?.phone || 'مستخدم الاستيراد';
  const errors: string[] = [];

  let insertedCount = 0;
  let updatedCount = 0;

  // التحقق من الصلاحيات
  const canViewPurchase = session?.role === 'designer' || session?.permissions?.includes('prices.view_purchase');
  const canManageCategories = hasCategoriesManagePermission(session);

  // استدعاء Google Apps Script إن كان مفعلاً
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('importItemsBatch', {
      batchId,
      items,
      updateExisting,
      fileName,
      warehouseId: payload.warehouseId,
      userName
    }, session?.token);

    if (res.success && res.data) {
      return {
        success: true,
        batchId: res.data.batchId || batchId,
        totalCount: items.length,
        insertedCount: res.data.insertedCount || 0,
        updatedCount: res.data.updatedCount || 0,
        errorCount: res.data.errors ? res.data.errors.length : 0,
        errors: res.data.errors || [],
        ...(Array.isArray(res.data.newCategories) && res.data.newCategories.length > 0
          ? { newCategories: res.data.newCategories }
          : {})
      };
    }

    const failure = buildSheetsWriteFailure(res, 'تعذر استيراد دفعة الأصناف في Google Sheets');
    return {
      ...failure,
      batchId,
      totalCount: items.length,
      insertedCount: 0,
      updatedCount: 0,
      errorCount: 0,
      errors: []
    };
  }

  // المعالجة المحلية في الذاكرة
  const batchExplicitWhId = (payload as any)?.warehouseId ? String((payload as any).warehouseId).trim() : undefined;
  const batchWhRes = resolveWarehouseForOperation(batchExplicitWhId, session as any, {
    fallbackWarehouseId: getDefaultWarehouse().id,
    requireActive: Boolean(batchExplicitWhId),
    enforceUserAccess: Boolean(batchExplicitWhId),
    allowFallbackWhenOmitted: !batchExplicitWhId
  });
  if (!batchWhRes.ok) {
    return {
      success: false,
      batchId,
      totalCount: items.length,
      insertedCount: 0,
      updatedCount: 0,
      errorCount: items.length,
      errors: [batchWhRes.error],
      error: batchWhRes.error
    };
  }
  const batchTargetWh = batchWhRes.warehouse;

  const lockAcquired = await acquireStockLock(6000);
  if (!lockAcquired) {
    return {
      success: false,
      batchId,
      totalCount: items.length,
      insertedCount: 0,
      updatedCount: 0,
      errorCount: items.length,
      errors: ['النظام مشغول بعملية استيراد أو حركة مخزنية أخرى، يرجى المحاولة بعد لحظات.'],
      error: 'النظام مشغول بعملية استيراد أو حركة مخزنية أخرى، يرجى المحاولة بعد لحظات.'
    };
  }

  const createdCatsByNorm = new Map<string, ProductCategory>();
  const createdNewCategoriesMap = new Map<string, { id: string; name: string; itemsCount: number }>();
  let zeroSalePriceCount = 0;

  try {
    for (let idx = 0; idx < items.length; idx++) {
      const raw = items[idx];
      const rowNum = idx + 2; // اعتبار السطر 1 هو العناوين

      const name = String(raw.name ?? raw['اسم الصنف'] ?? '').trim().replace(/\s+/g, ' ');
      if (!normalizeItemName(name)) {
        errors.push(`السطر ${rowNum}: خانة "اسم الصنف" الإلزامية فارغة`);
        continue;
      }

      const rawBarcodeVal =
        raw.barcode !== undefined && raw.barcode !== null
          ? raw.barcode
          : raw['الباركود الرئيسي'] !== undefined && raw['الباركود الرئيسي'] !== null
          ? raw['الباركود الرئيسي']
          : '';
      if (isCellEmpty(rawBarcodeVal)) {
        errors.push(`السطر ${rowNum}: خانة "الباركود الرئيسي" الإلزامية فارغة`);
        continue;
      }
      if (isScientificNotationBarcode(rawBarcodeVal)) {
        errors.push(`السطر ${rowNum} (${name}): نسّق عمود الباركود كنص في الإكسيل`);
        continue;
      }
      const barcode = normalizeItemBarcode(String(rawBarcodeVal)) || undefined;
      if (!barcode) {
        errors.push(`السطر ${rowNum}: خانة "الباركود الرئيسي" الإلزامية فارغة`);
        continue;
      }

      const rawPn = raw.printName ?? raw['اسم الطباعة'] ?? '';
      const cleanPn = String(rawPn ?? '').trim().replace(/\s+/g, ' ');
      if (cleanPn.length > 120) {
        errors.push(`السطر ${rowNum} (${name}): اسم الطباعة لا يتجاوز 120 حرفاً`);
        continue;
      }
      const printName = cleanPn;

      const rawSale = raw.salePrice ?? raw['سعر البيع'];
      let salePrice = 0;
      if (!isCellEmpty(rawSale)) {
        const parsedSale = parseNonNegativeNumber(rawSale, 'سعر البيع', 2);
        if (parsedSale.valid === false) {
          errors.push(`السطر ${rowNum} (${name}): ${parsedSale.reason}`);
          continue;
        }
        salePrice = parsedSale.value;
      }

      const rawMinPrice = raw.minPrice ?? raw['الحد الأدنى لسعر البيع'] ?? raw['الحد الأدنى للسعر'];
      let minPrice = 0;
      if (!isCellEmpty(rawMinPrice)) {
        const parsedMin = parseNonNegativeNumber(rawMinPrice, 'الحد الأدنى لسعر البيع', 2);
        if (parsedMin.valid === false) {
          errors.push(`السطر ${rowNum} (${name}): ${parsedMin.reason}`);
          continue;
        }
        if (parsedMin.value > 0 && parsedMin.value > salePrice) {
          errors.push(`السطر ${rowNum} (${name}): الحد الأدنى لسعر البيع (${parsedMin.value}) أكبر من سعر البيع (${salePrice})`);
          continue;
        }
        minPrice = parsedMin.value;
      }

      const rawMainCat = String(
        raw.category ?? raw.rootCategory ?? raw.categoryName ?? raw['التصنيف'] ?? ''
      ).trim();

      let resolvedCategoryId: string | undefined = raw.categoryId ? String(raw.categoryId).trim() : undefined;
      let resolvedCategoryName: string | undefined = raw.categoryName ? String(raw.categoryName).trim() : undefined;
      let pendingNewCatInfo: { normName: string; exactName: string } | null = null;

      if (!resolvedCategoryId && rawMainCat) {
        const catRes = resolveAddItemImportCategory({
          rawCategoryInput: rawMainCat,
          categories: memoryCategories,
          canManageCategories: hasCategoriesManagePermission(session)
        });
        if (catRes.ok === false) {
          errors.push(`السطر ${rowNum} (${name}): ${catRes.error}`);
          continue;
        }
        if (catRes.isNewRootCategory && catRes.newRootCategoryName && catRes.newRootNormName) {
          pendingNewCatInfo = {
            normName: catRes.newRootNormName,
            exactName: catRes.newRootCategoryName
          };
          resolvedCategoryName = catRes.newRootCategoryName;
        } else {
          resolvedCategoryId = catRes.categoryId;
          resolvedCategoryName = catRes.categoryName;
        }
      }

      const rawPurchase = raw.purchasePrice ?? raw['سعر الشراء'];
      let purchasePrice = 0;
      if (!isCellEmpty(rawPurchase)) {
        const parsedPur = parseNonNegativeNumber(rawPurchase, 'سعر الشراء', 2);
        if (parsedPur.valid === false) {
          errors.push(`السطر ${rowNum} (${name}): ${parsedPur.reason}`);
          continue;
        }
        purchasePrice = canViewPurchase ? parsedPur.value : 0;
      }

      const rawPkg = raw.packagingCost ?? raw['تكلفة التغليف'];
      let packagingCost = 0;
      if (!isCellEmpty(rawPkg)) {
        const parsedPkg = parseNonNegativeNumber(rawPkg, 'تكلفة التغليف', 2);
        if (parsedPkg.valid === false) {
          errors.push(`السطر ${rowNum} (${name}): ${parsedPkg.reason}`);
          continue;
        }
        packagingCost = canViewPurchase ? parsedPkg.value : 0;
      }

      const rawQty = raw.stockQuantity ?? raw['الكمية'];
      let stockQuantity = 0;
      if (!isCellEmpty(rawQty)) {
        const parsedQty = parseNonNegativeNumber(rawQty, 'الكمية', 3);
        if (parsedQty.valid === false) {
          errors.push(`السطر ${rowNum} (${name}): ${parsedQty.reason}`);
          continue;
        }
        stockQuantity = parsedQty.value;
      }

      const rawReorder = raw.reorderLimit ?? raw['الحد الأدنى للكمية'] ?? raw['الحد الأدنى'];
      let reorderLimit = 0;
      if (!isCellEmpty(rawReorder)) {
        const parsedRl = parseNonNegativeNumber(rawReorder, 'الحد الأدنى للكمية', 2);
        if (parsedRl.valid === false) {
          errors.push(`السطر ${rowNum} (${name}): ${parsedRl.reason}`);
          continue;
        }
        reorderLimit = parsedRl.value;
      }

      const rawTax = raw.taxRate ?? raw['نسبة الضريبة'];
      let taxRate = 0;
      if (!isCellEmpty(rawTax)) {
        const cleanedTax = typeof rawTax === 'string' ? rawTax.replace(/[%٪]/g, '').trim() : rawTax;
        const parsedTax = parseNonNegativeNumber(cleanedTax, 'نسبة الضريبة', 2, 100);
        if (parsedTax.valid === false) {
          errors.push(`السطر ${rowNum} (${name}): ${parsedTax.reason}`);
          continue;
        }
        taxRate = parsedTax.value;
      }

      const rawSecBarcodes = Array.isArray(raw.secondaryBarcodes)
        ? raw.secondaryBarcodes
        : (typeof raw.secondaryBarcodes === 'string' && raw.secondaryBarcodes.trim() ? raw.secondaryBarcodes.split(/[,،]+/) : []);
      const secondaryBarcodes = rawSecBarcodes.map((b: any) => normalizeItemBarcode(String(b))).filter(Boolean);
      const rawSkuVal = raw.sku !== undefined ? raw.sku : raw.code;
      const sku = rawSkuVal !== undefined && rawSkuVal !== null ? (normalizeItemBarcode(String(rawSkuVal)) || undefined) : undefined;
      const supplier = String(raw.supplier ?? raw['المورد'] ?? '').trim();
      const unit = String(raw.unit ?? raw['الوحدة'] ?? '').trim() || 'قطعة';
      const notes = String(raw.notes ?? raw['وصف الصنف'] ?? raw['الملاحظات'] ?? '').trim();

      // التحقق من المطابقة: بواسطة المعرف أو SKU أولاً ثم الباركود ثم الاسم الموحد
      let matchIdx = -1;
      if (raw.id) {
        matchIdx = memoryItems.findIndex(i => i.id === String(raw.id).trim());
      }
      if (matchIdx === -1 && sku) {
        matchIdx = memoryItems.findIndex(i => i.sku && normalizeItemBarcode(i.sku).toLowerCase() === sku.toLowerCase());
      }
      if (matchIdx === -1 && barcode) {
        const normBcKey = barcode.toLowerCase();
        matchIdx = memoryItems.findIndex(i => {
          if (i.barcode && normalizeItemBarcode(i.barcode).toLowerCase() === normBcKey) return true;
          if (i.secondaryBarcodes && i.secondaryBarcodes.some(sb => normalizeItemBarcode(sb).toLowerCase() === normBcKey)) return true;
          return false;
        });
      }
      if (matchIdx === -1 && updateExisting) {
        const normRowName = normalizeItemName(name);
        matchIdx = memoryItems.findIndex(i => normalizeItemName(i.name) === normRowName);
      }

      const materializePendingCategory = (): void => {
        if (!pendingNewCatInfo) {
          if (resolvedCategoryId) {
            for (const stat of createdNewCategoriesMap.values()) {
              if (stat.id === resolvedCategoryId) {
                stat.itemsCount += 1;
                break;
              }
            }
          }
          return;
        }
        let createdCat =
          createdCatsByNorm.get(pendingNewCatInfo.normName) ||
          memoryCategories.find(
            c =>
              !c.parentCategoryId &&
              isCategoryActiveForImport(c) &&
              String(c.name ?? '').trim().toLowerCase() === pendingNewCatInfo!.normName
          );
        if (!createdCat) {
          const maxOrder = memoryCategories.reduce(
            (acc, c) => Math.max(acc, Number(c.displayOrder || 0)),
            0
          );
          createdCat = {
            id: generateUUID(),
            name: pendingNewCatInfo.exactName,
            parentCategoryId: null,
            status: 'نشط',
            showInPOS: true,
            displayOrder: maxOrder + 1,
            createdAt: now,
            updatedAt: now
          };
          memoryCategories.push(createdCat);
          createdCatsByNorm.set(pendingNewCatInfo.normName, createdCat);
          recordAuditLog(
            session || {},
            'CATEGORY_CREATE',
            'ProductCategory',
            createdCat.id,
            `إنشاء تصنيف رئيسي جديد تلقائياً أثناء الاستيراد: ${createdCat.name} (${fileName || ''})`
          );
        } else {
          createdCatsByNorm.set(pendingNewCatInfo.normName, createdCat);
        }
        resolvedCategoryId = createdCat.id;
        resolvedCategoryName = createdCat.name;
        const stat = createdNewCategoriesMap.get(pendingNewCatInfo.normName);
        if (stat) {
          stat.itemsCount += 1;
        } else {
          createdNewCategoriesMap.set(pendingNewCatInfo.normName, {
            id: createdCat.id,
            name: createdCat.name,
            itemsCount: 1
          });
        }
      };

      if (matchIdx >= 0 && updateExisting) {
        const target = memoryItems[matchIdx];
        const nextBarcode = barcode !== undefined ? barcode : target.barcode;
        const nextSecondary = rawSecBarcodes.length > 0 ? secondaryBarcodes : (target.secondaryBarcodes || []);
        const nextSku = sku !== undefined ? sku : target.sku;

        // فحص عدم تعارض التعديل مع أي صنف آخر (باستثناء الصنف نفسه)
        const uniqueness = checkItemUniqueness({
          excludeId: target.id,
          name,
          barcode: nextBarcode,
          secondaryBarcodes: nextSecondary,
          sku: nextSku
        });
        if (uniqueness.isDuplicate) {
          errors.push(`السطر ${rowNum} (${name}): ${uniqueness.error}`);
          continue;
        }

        materializePendingCategory();

        // تحديث الصنف المطابق
        const oldQty = batchExplicitWhId ? getItemWarehouseStock(target.id, batchTargetWh.id) : target.stockQuantity;
        target.name = name.replace(/\s+/g, ' ').trim();
        if (printName !== undefined) target.printName = printName;
        if (barcode !== undefined) target.barcode = barcode;
        if (rawSecBarcodes.length > 0) target.secondaryBarcodes = secondaryBarcodes.length > 0 ? secondaryBarcodes : undefined;
        if (sku !== undefined) target.sku = sku;
        if (resolvedCategoryId !== undefined) target.categoryId = resolvedCategoryId;
        if (resolvedCategoryName !== undefined) target.categoryName = resolvedCategoryName;
        target.salePrice = salePrice;
        if (minPrice !== undefined) target.minPrice = minPrice;
        if (canViewPurchase && (raw.purchasePrice !== undefined || raw['سعر الشراء'] !== undefined)) target.purchasePrice = purchasePrice;
        if (canViewPurchase && raw.packagingCost !== undefined) target.packagingCost = packagingCost;
        if (supplier) target.supplier = supplier;
        if (unit) target.unit = unit;
        if (notes) target.notes = notes;
        target.reorderLimit = reorderLimit;
        target.taxRate = taxRate;

        const newWhQty = setItemWarehouseBalance(target.id, batchTargetWh.id, stockQuantity);

        if (oldQty !== newWhQty) {
          memoryStockMovements.push({
            id: generateUUID(),
            date: now,
            itemId: target.id,
            itemName: target.name,
            warehouseId: batchTargetWh.id,
            warehouseName: batchTargetWh.name,
            documentNumber: batchId,
            movementType: 'تسوية جرد',
            quantity: Math.abs(newWhQty - oldQty),
            quantityBefore: oldQty,
            quantityAfter: newWhQty,
            balanceAfter: newWhQty,
            notes: `تحديث بمخزن "${batchTargetWh.name}" عبر دفعة الاستيراد ${batchId} (${fileName})`,
            userName
          });
        }

        updatedCount++;
      } else {
        // فحص عدم تكرار الصنف الجديد مع أي صنف موجود (بالاسم أو الباركود أو الكود)
        const uniqueness = checkItemUniqueness({
          name,
          barcode,
          secondaryBarcodes,
          sku
        });
        if (uniqueness.isDuplicate) {
          errors.push(`السطر ${rowNum} (${name}): ${uniqueness.error}`);
          continue;
        }

        materializePendingCategory();

        // صنف جديد تمامًا
        const newItemId = generateUUID();
        const newItem: Item = {
          id: newItemId,
          name: name.replace(/\s+/g, ' ').trim(),
          printName: printName || '',
          sku,
          barcode,
          secondaryBarcodes: secondaryBarcodes.length > 0 ? secondaryBarcodes : undefined,
          categoryId: resolvedCategoryId,
          categoryName: resolvedCategoryName,
          supplier,
          unit,
          salePrice,
          minPrice,
          purchasePrice,
          packagingCost,
          stockQuantity: 0,
          reorderLimit,
          taxRate,
          notes,
          imageUrl: raw.imageUrl || '',
          createdAt: now,
          status: 'نشط'
        };

        memoryItems.unshift(newItem);
        const computedStock = setItemWarehouseBalance(newItemId, batchTargetWh.id, stockQuantity);

        if (barcode) {
          memoryItemBarcodes.push({
            itemId: newItemId,
            barcode,
            type: 'primary',
            label: 'الباركود الأساسي',
            active: true,
            createdAt: now
          });
        }
        for (const sec of secondaryBarcodes) {
          memoryItemBarcodes.push({
            itemId: newItemId,
            barcode: sec,
            type: 'secondary',
            label: 'باركود فرعي',
            active: true,
            createdAt: now
          });
        }

        if (computedStock > 0) {
          memoryStockMovements.push({
            id: generateUUID(),
            date: now,
            itemId: newItemId,
            itemName: newItem.name,
            warehouseId: batchTargetWh.id,
            warehouseName: batchTargetWh.name,
            documentNumber: batchId,
            movementType: 'استيراد رصيد افتتاحي',
            quantity: computedStock,
            quantityBefore: 0,
            quantityAfter: computedStock,
            balanceAfter: computedStock,
            notes: `رصيد افتتاحي بمخزن "${batchTargetWh.name}" عبر استيراد ملف ${fileName}`,
            userName
          });
        }

        if (Number(salePrice || 0) === 0) {
          zeroSalePriceCount++;
        }
        insertedCount++;
      }
    }
  } finally {
    releaseStockLock();
  }

  const newCategories = Array.from(createdNewCategoriesMap.values());
  const zeroSalePriceWarning =
    zeroSalePriceCount > 0
      ? `تم استيراد ${zeroSalePriceCount} صنفًا بسعر بيع صفر — راجع أسعارها`
      : undefined;

  // تسجيل دفعة الاستيراد في ImportBatches
  const batchEntry: ImportBatch = {
    id: batchId,
    timestamp: now,
    dataType: 'Items',
    sourceName: fileName || 'ملف استيراد أصناف',
    totalRows: items.length,
    successRows: insertedCount + updatedCount,
    failedRows: errors.length,
    userName,
    notes: `تم استيراد ${insertedCount} صنف جديد وتحديث ${updatedCount} صنف${newCategories.length > 0 ? ` | تصنيفات جديدة: ${newCategories.map(c => `${c.name} (${c.itemsCount})`).join('، ')}` : ''}`,
    errorLog: errors.length > 0 ? errors.slice(0, 30).join('\n') : undefined
  };
  memoryImportBatches.unshift(batchEntry);

  recordAuditLog(
    session || {},
    'ITEMS_IMPORT_BATCH',
    'ImportBatch',
    batchId,
    `استيراد أصناف: ${insertedCount} جديد، ${updatedCount} محدث، ${errors.length} أخطاء من ملف (${fileName})`
  );

  return {
    success: insertedCount + updatedCount > 0,
    batchId,
    totalCount: items.length,
    insertedCount,
    updatedCount,
    errorCount: errors.length,
    errors,
    zeroSalePriceCount,
    ...(zeroSalePriceWarning ? { zeroSalePriceWarning, warnings: [zeroSalePriceWarning] } : {}),
    ...(newCategories.length > 0 ? { newCategories } : {})
  };
}

/**
 * جلب المنصات
 */
export async function getPlatforms(session?: { token?: string }): Promise<Platform[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getPlatforms', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache('platforms', res.data);
      return res.data;
    }
    const cached = getSheetsCache<Platform[]>('platforms');
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب المنصات من Google Sheets');
  }
  return memoryPlatforms.map(p => ({
    ...p,
    currentBalance: computePartyBalance('platform', p.id)
  }));
}

/**
 * حفظ منصة
 */
export async function savePlatform(plt: Partial<Platform> & { name: string }, session?: { token?: string; role: UserRole; permissions: PermissionKey[] }): Promise<{ success: boolean; platform?: Platform; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('savePlatform', plt, session?.token);
    if (res.success && res.platform) return { success: true, platform: res.platform };
    return buildSheetsWriteFailure(res, 'تعذر حفظ المنصة في Google Sheets');
  }

  const id = plt.id || generateUUID();
  const existingIdx = memoryPlatforms.findIndex(p => p.id === id);
  const savedPlt: Platform = {
    id,
    name: plt.name,
    discountPercentage: Number(plt.discountPercentage || 0),
    pickupFee: Math.max(0, Number(plt.pickupFee || 0)),
    pickupFeeMode: plt.pickupFeeMode === 'product'
      ? 'product'
      : (plt.pickupFeeMode === 'platform'
          ? 'platform'
          : (existingIdx >= 0 ? (memoryPlatforms[existingIdx].pickupFeeMode || 'platform') : 'platform')),
    notes: plt.notes || '',
    status: plt.status || 'نشطة',
    enableBnpl: plt.enableBnpl !== undefined ? Boolean(plt.enableBnpl) : (existingIdx >= 0 ? memoryPlatforms[existingIdx].enableBnpl : false),
    bnplPercentage: plt.bnplPercentage !== undefined ? Number(plt.bnplPercentage) : (existingIdx >= 0 ? memoryPlatforms[existingIdx].bnplPercentage : 0)
  };

  if (existingIdx >= 0) {
    memoryPlatforms[existingIdx] = savedPlt;
    recordAuditLog(session || {}, 'PLATFORM_EDIT', 'Platform', id, `تعديل منصة: ${plt.name}`);
  } else {
    memoryPlatforms.push(savedPlt);
    recordAuditLog(session || {}, 'PLATFORM_CREATE', 'Platform', id, `إضافة منصة: ${plt.name}`);
  }

  return { success: true, platform: savedPlt };
}

/**
 * جلب تكاليف شحن المنصات
 */
export async function getItemPlatformCosts(session?: { token?: string }): Promise<ItemPlatformCost[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getItemPlatformCosts', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache('costs', res.data);
      return res.data;
    }
    const cached = getSheetsCache<ItemPlatformCost[]>('costs');
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب تكاليف المنصات من Google Sheets');
  }
  return memoryCosts;
}

/**
 * حفظ تكلفة شحن المنصة
 */
export async function saveItemPlatformCost(costObj: ItemPlatformCost, session?: { token?: string; role: UserRole; permissions: PermissionKey[] }): Promise<{ success: boolean; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('saveItemPlatformCost', costObj, session?.token);
    if (res.success) return { success: true };
    return buildSheetsWriteFailure(res, 'تعذر حفظ تكلفة المنصة في Google Sheets');
  }

  const idx = memoryCosts.findIndex(c => c.itemId === costObj.itemId && c.platformId === costObj.platformId);
  if (idx >= 0) {
    memoryCosts[idx] = costObj;
  } else {
    memoryCosts.push(costObj);
  }
  recordAuditLog(session || {}, 'PLATFORM_COST_EDIT', 'ItemPlatformCost', `${costObj.itemId}_${costObj.platformId}`, 'تعديل تكاليف شحن المنصة');
  return { success: true };
}

/**
 * إنشاء فاتورة وفق معادلات القسم 9
 */
export async function createInvoice(
  invoicePayload: any,
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; userId?: string; name?: string; userSuspended?: boolean }
): Promise<{
  success: boolean;
  duplicate?: boolean;
  statusCode?: number;
  invoice?: Invoice;
  finalInvoiceNumber?: string;
  provisionalInvoiceNumber?: string;
  needsReview?: boolean;
  reviewReasons?: string[];
  error?: string;
  code?: string;
}> {
  // 1. إلزام وجود مفتاح Idempotency قبل لمس أي بيانات
  const idemKey = getValidatedIdempotencyKey(invoicePayload?.idempotencyKey);
  if (!idemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR };
  }

  const rawProvNo = String(
    invoicePayload?.offlineProvisionalNo ||
    invoicePayload?.tempInvoiceNumber ||
    (String(invoicePayload?.invoiceNumber || '').startsWith('OFF-') ? invoicePayload.invoiceNumber : '')
  ).trim();
  const isOfflineMode = Boolean(
    invoicePayload?.isOfflineSync ||
    invoicePayload?.isOffline ||
    rawProvNo
  );

  // فحص تلف البيانات الأساسي لعمليات المزامنة الأوفلاين (يرفض فقط إذا كانت البيانات تالفة)
  if (isOfflineMode) {
    const rawLines = invoicePayload?.lines;
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      return { success: false, statusCode: 400, error: 'بيانات الفاتورة تالفة: لا توجد أصناف صالحة في الفاتورة' };
    }
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i];
      if (!l || typeof l !== 'object' || !String(l.itemId || '').trim()) {
        return { success: false, statusCode: 400, error: `بيانات الفاتورة تالفة: معرّف الصنف مفقود في السطر رقم ${i + 1}` };
      }
      const q = Number(l.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        return { success: false, statusCode: 400, error: `بيانات الفاتورة تالفة: الكمية في السطر رقم ${i + 1} يجب أن تكون رقماً أكبر من صفر` };
      }
      const rawPrice = l.baseUnitPrice !== undefined ? Number(l.baseUnitPrice) : (l.salePriceAtSale !== undefined ? Number(l.salePriceAtSale) : 0);
      if (!Number.isFinite(rawPrice) || rawPrice < 0) {
        return { success: false, statusCode: 400, error: `بيانات الفاتورة تالفة: سعر الوحدة في السطر رقم ${i + 1} غير صالح` };
      }
    }
    if (
      invoicePayload.paymentType !== undefined &&
      invoicePayload.paymentType !== 'نقدي' &&
      invoicePayload.paymentType !== 'آجل' &&
      invoicePayload.paymentType !== 'جزئي'
    ) {
      return { success: false, statusCode: 400, error: 'بيانات الفاتورة تالفة: نوع السداد غير صالح' };
    }
  }

  const cached = getIdempotencyCachedResult('createInvoice', idemKey);
  if (cached) {
    return {
      success: true,
      duplicate: true,
      invoice: cached,
      finalInvoiceNumber: cached.invoiceNumber,
      provisionalInvoiceNumber: cached.offlineProvisionalNo || rawProvNo || undefined,
      needsReview: Boolean(cached.needsReview),
      reviewReasons: cached.reviewReasons || []
    };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    if (invoicePayload?.delivery && !isOfflineMode) {
      return { success: false, statusCode: 400, code: 'DELIVERY_UNAVAILABLE', error: 'التوصيل شغال مع قاعدة البيانات بس' };
    }
    const actionName = isOfflineMode ? 'syncOfflineOperation' : 'createInvoice';
    const res = await callAppsScript(
      actionName,
      {
        ...invoicePayload,
        idempotencyKey: idemKey,
        ...(isOfflineMode ? { isOfflineSync: true, offlineProvisionalNo: rawProvNo || undefined } : {})
      },
      session?.token
    );
    if (res.success && res.invoice) {
      setIdempotencyCachedResult('createInvoice', idemKey, res.invoice);
      return {
        success: true,
        invoice: res.invoice,
        finalInvoiceNumber: res.finalInvoiceNumber || res.invoice.invoiceNumber,
        provisionalInvoiceNumber: res.provisionalInvoiceNumber || res.invoice.offlineProvisionalNo || rawProvNo || undefined,
        needsReview: Boolean(res.needsReview ?? res.invoice.needsReview),
        reviewReasons: res.reviewReasons || res.invoice.reviewReasons || [],
        ...(res.duplicate ? { duplicate: true } : {})
      };
    }
    return buildSheetsWriteFailure(res, 'تعذر حفظ الفاتورة في Google Sheets');
  }

  const existingInv = memoryInvoices.find(inv => inv.idempotencyKey === idemKey);
  if (existingInv) {
    setIdempotencyCachedResult('createInvoice', idemKey, existingInv);
    return {
      success: true,
      duplicate: true,
      invoice: existingInv,
      finalInvoiceNumber: existingInv.invoiceNumber,
      provisionalInvoiceNumber: existingInv.offlineProvisionalNo || rawProvNo || undefined,
      needsReview: Boolean(existingInv.needsReview),
      reviewReasons: existingInv.reviewReasons || []
    };
  }

  const reviewReasonsList: string[] = [];
  const addReviewReason = (reason: string) => {
    if (reason && !reviewReasonsList.includes(reason)) {
      reviewReasonsList.push(reason);
    }
  };
  if (Array.isArray(invoicePayload.reviewReasons)) {
    for (const r of invoicePayload.reviewReasons) {
      const cleanR = String(r || '').trim();
      if (cleanR) addReviewReason(cleanR);
    }
  }

  // الحساب المحلي الصارم وفق القسم 5 و 9
  const rawPlatformId = String(invoicePayload.platformId || '').trim();
  const rawPlatformName = String(invoicePayload.platform || invoicePayload.platformName || '').trim();
  const matchedPlatform =
    rawPlatformId || rawPlatformName
      ? memoryPlatforms.find(
          p =>
            (rawPlatformId && p.id === rawPlatformId) ||
            (rawPlatformName && p.name === rawPlatformName)
        )
      : undefined;

  const isDirectByTarget = matchedPlatform
    ? matchedPlatform.name === DIRECT_SALE_PLATFORM_NAME
    : (!rawPlatformId || rawPlatformId === 'direct') &&
      (!rawPlatformName || rawPlatformName === DIRECT_SALE_PLATFORM_NAME);

  const isPlatformInvoice = !isDirectByTarget;

  // التحقق من تفعيل وضع البيع المطلوب (بيع على منصة / بيع مباشر) قبل أي خصم مخزون أو ترقيم أو حركة خزنة
  // ويسري أيضًا عند مزامنة الفواتير الأوفلاين على ضوء الإعدادات الحالية للخادم
  const modeViolation = saleModeViolation({ isPlatformSale: isPlatformInvoice });
  if (modeViolation) {
    return {
      success: false,
      statusCode: 403,
      code: modeViolation.code,
      error: modeViolation.message
    };
  }

  const isPlatformRecordActive = (p: Platform) =>
    !['inactive', 'موقوف', 'موقوفة', 'معطل', 'معطلة'].includes(String(p?.status ?? ''));

  if (isPlatformInvoice && !isOfflineMode) {
    if (
      !matchedPlatform ||
      matchedPlatform.name === DIRECT_SALE_PLATFORM_NAME ||
      !isPlatformRecordActive(matchedPlatform)
    ) {
      return {
        success: false,
        statusCode: 400,
        code: 'ACTIVE_PLATFORM_REQUIRED',
        error: 'لا توجد منصة نشطة صالحة مختارة لإتمام البيع على منصة؛ يرجى اختيار منصة نشطة أو تفعيل منصة أولًا'
      };
    }
  }

  const platform: Platform = matchedPlatform || {
    id: rawPlatformId || 'direct',
    name: rawPlatformName || DIRECT_SALE_PLATFORM_NAME,
    discountPercentage: Number(invoicePayload.platformDiscountPercentage || 0),
    pickupFee: 0,
    notes: isPlatformInvoice ? 'منصة' : 'بيع مباشر',
    status: 'نشطة',
    enableBnpl: Boolean(invoicePayload.bnplEnabled),
    bnplPercentage: Number(invoicePayload.bnplPercentOverride || 0)
  };

  const isDesigner = session?.role === 'designer';
  const canOverrideMin = isDesigner || isOfflineMode || session?.permissions?.includes('prices.override_min_price');

  // إعدادات البيع: العميل «لازم يختار بإيده» في البيع المباشر. فواتير الأوفلاين تُقبل وتُعلَّم للمراجعة
  const partyRuleError = partyRuleViolation({
    isPlatformSale: isPlatformInvoice,
    customerId: invoicePayload.customerId,
    customerName: invoicePayload.customerName
  });
  if (partyRuleError) {
    if (!isOfflineMode) return { success: false, code: 'CUSTOMER_REQUIRED', error: partyRuleError };
    addReviewReason('بيع مباشر بدون اختيار عميل');
  }
  // رقم طلب المنصة (اختياري، لفواتير المنصات فقط): التكرار على نفس المنصة ممنوع أو مسموح حسب إعدادات الترقيم
  const platformOrderId = isPlatformInvoice ? normalizePlatformOrderId(invoicePayload.platformOrderId) : '';
  if (platformOrderId.length > MAX_PLATFORM_ORDER_LENGTH) {
    return { success: false, statusCode: 400, error: `رقم طلب المنصة طويل: حتى ${MAX_PLATFORM_ORDER_LENGTH} حرفًا` };
  }
  if (platformOrderId && getInvoiceNumberingSettings().platformOrderDuplicates === 'block') {
    const duplicate = findPlatformOrderDuplicate(memoryInvoices, { platformId: platform.id, platformName: platform.name, orderId: platformOrderId });
    if (duplicate) {
      if (!isOfflineMode) {
        return { success: false, code: 'PLATFORM_ORDER_DUPLICATE', error: `رقم طلب المنصة «${platformOrderId}» متسجل قبل كده على ${platform.name} في الفاتورة ${duplicate.invoiceNumber}` };
      }
      addReviewReason('رقم طلب المنصة مكرر');
    }
  }
  // قواعد السعر (سعر صفر / أقل من سعر الشراء): يتعداها فقط من معه صلاحية تجاوز الحد الأدنى للسعر
  const canBypassPriceRules = isDesigner || Boolean(session?.permissions?.includes('prices.override_min_price'));
  const canEditPosRates = isDesigner || isOfflineMode || Boolean(session?.permissions?.includes('pos.edit_rates'));

  const hasBnplPercentOverride = invoicePayload.bnplPercentOverride !== undefined && invoicePayload.bnplPercentOverride !== null && invoicePayload.bnplPercentOverride !== '';
  const hasCommissionPercentOverride = invoicePayload.commissionPercentOverride !== undefined && invoicePayload.commissionPercentOverride !== null && invoicePayload.commissionPercentOverride !== '';
  const hasLegacyDiscountOverride = invoicePayload.platformDiscountPercentage !== undefined && invoicePayload.platformDiscountPercentage !== null && invoicePayload.platformDiscountPercentage !== '' && Number(invoicePayload.platformDiscountPercentage) !== Number(platform.discountPercentage || 0);

  if ((hasBnplPercentOverride || hasCommissionPercentOverride || hasLegacyDiscountOverride) && !canEditPosRates) {
    return { success: false, error: 'غير مصرح: لا تملك صلاحية تعديل نسبة BNPL أو نسبة خصم المنصة في نقطة البيع' };
  }

  let bnplPercentOverrideVal: number | undefined = undefined;
  if (hasBnplPercentOverride) {
    const parsedBnpl = Number(invoicePayload.bnplPercentOverride);
    if (isNaN(parsedBnpl) || parsedBnpl < 0 || parsedBnpl > 100) {
      return { success: false, statusCode: 400, error: 'نسبة BNPL يجب أن تكون قيمة رقمية بين 0 و 100' };
    }
    bnplPercentOverrideVal = parsedBnpl;
  }

  let commissionPercentOverrideVal: number | undefined = undefined;
  if (hasCommissionPercentOverride) {
    const parsedComm = Number(invoicePayload.commissionPercentOverride);
    if (isNaN(parsedComm) || parsedComm < 0 || parsedComm > 100) {
      return { success: false, statusCode: 400, error: 'نسبة خصم المنصة يجب أن تكون قيمة رقمية بين 0 و 100' };
    }
    commissionPercentOverrideVal = parsedComm;
  }

  const platformDiscountPercent = commissionPercentOverrideVal !== undefined
    ? commissionPercentOverrideVal
    : (invoicePayload.platformDiscountPercentage !== undefined && invoicePayload.platformDiscountPercentage !== null && invoicePayload.platformDiscountPercentage !== ''
        ? Number(invoicePayload.platformDiscountPercentage)
        : Number(platform.discountPercentage || 0));

  if (isNaN(platformDiscountPercent) || platformDiscountPercent < 0 || platformDiscountPercent > 100) {
    return { success: false, statusCode: 400, error: 'نسبة خصم المنصة يجب أن تكون قيمة رقمية بين 0 و 100' };
  }

  const isBnplDisabled = invoicePayload.bnplEnabled === false;

  const taxSettings = config.taxSettings || {
    taxInclusive: true,
    platformCommissionOn: 'before_tax'
  };

  // التحقق من رسوم التوصيل Snapshot
  let deliveryFee = 0;
  if (invoicePayload.deliveryFee !== undefined && invoicePayload.deliveryFee !== null && invoicePayload.deliveryFee !== '') {
    const rawDelivery = Number(invoicePayload.deliveryFee);
    if (isNaN(rawDelivery) || rawDelivery < 0) {
      return { success: false, statusCode: 400, error: 'رسوم التوصيل يجب أن تكون قيمة رقمية موجبة (أكبر من أو تساوي صفر)' };
    }
    deliveryFee = Math.round(rawDelivery * 100) / 100;
  }

  // التوصيل (للبيع المباشر بس): الرسوم من المنطقة أو الرسوم الثابتة (أو يدوي بصلاحية)،
  // و«الدفع عند الاستلام» بيتسجل آجل على التوصيل وما يدخلش الخزنة غير بالتسوية
  let deliveryPlan: DeliveryPlan | null = null;
  if (invoicePayload.delivery) {
    try {
      const deliveryCustomer = (invoicePayload.customerId || invoicePayload.customerName)
        ? memoryCustomers.find(c => c.id === invoicePayload.customerId || (invoicePayload.customerName && c.name === invoicePayload.customerName))
        : undefined;
      deliveryPlan = prepareDeliveryPlan(invoicePayload.delivery, {
        isDirectSale: platform.name === DIRECT_SALE_PLATFORM_NAME,
        actor: session as any,
        customer: deliveryCustomer || null,
        customerName: invoicePayload.customerName
      });
      deliveryFee = deliveryPlan.fee;
    } catch (err: any) {
      if (!(err instanceof DeliveryError)) throw err;
      if (!isOfflineMode) return { success: false, statusCode: err.statusCode, code: err.code, error: err.message };
      addReviewReason(`طلب التوصيل ما اتسجلش: ${err.message}`);
      deliveryPlan = null;
    }
  }
  if (!deliveryPlan && invoicePayload.creditPartyType === 'delivery') {
    return { success: false, statusCode: 400, error: 'الآجل على التوصيل للطلبات اللي «الدفع عند الاستلام» بس' };
  }

  const lines = invoicePayload.lines || [];
  if (!Array.isArray(lines) || lines.length === 0) {
    return { success: false, statusCode: 400, error: 'لا يمكن حفظ فاتورة خالية من الأصناف' };
  }

  const now = new Date();
  const deviceTimeStr = isOfflineMode
    ? String(invoicePayload.deviceTime || invoicePayload.createdAt || invoicePayload.date || '').trim()
    : '';

  if (isOfflineMode) {
    // 1. فحص حالة المستخدم (المستخدم موقوف)
    const callerUser = memoryUsers.find(
      u =>
        (session?.userId && u.id === session.userId) ||
        (session?.phone && u.phone === session.phone) ||
        (invoicePayload.userId && u.id === invoicePayload.userId) ||
        (invoicePayload.createdBy && (u.name === invoicePayload.createdBy || u.phone === invoicePayload.createdBy))
    );
    if (
      session?.userSuspended ||
      (callerUser && (callerUser.status === 'inactive' || (callerUser.status as any) === 'موقوف'))
    ) {
      addReviewReason('المستخدم موقوف');
    }

    // 2. فحص فرق توقيت الجهاز عن وقت استلام الخادم (> 10 دقائق)
    if (deviceTimeStr) {
      const parsedDeviceTime = new Date(deviceTimeStr);
      if (!isNaN(parsedDeviceTime.getTime())) {
        const diffMinutes = Math.abs(now.getTime() - parsedDeviceTime.getTime()) / (1000 * 60);
        if (diffMinutes > 10) {
          addReviewReason('فرق في وقت الجهاز أكثر من 10 دقائق');
        }
      }
    }
  }

  // تحديد المخزن الفعلي للعملية وتطبيق قواعد الصلاحيات والحالة
  const warehouseSessionContext = {
    role: session?.role,
    isOwner: (session as any)?.isOwner,
    userId: session?.userId || invoicePayload.userId,
    phone: session?.phone,
    username: (session as any)?.username,
    name: session?.name
  };
  const requestedWhInput = invoicePayload.warehouseId || invoicePayload.warehouseName;
  const whRes = resolveWarehouseForOperation(requestedWhInput, warehouseSessionContext, {
    fallbackWarehouseId: getDefaultWarehouse().id,
    requireActive: true,
    enforceUserAccess: true,
    allowFallbackWhenOmitted: isOfflineMode
  });
  let resolvedWarehouse: Warehouse;
  if (!whRes.ok) {
    if (!isOfflineMode) {
      return { success: false, statusCode: whRes.statusCode, error: whRes.error };
    }
    addReviewReason(whRes.error);
    const offlineFallbackWh =
      (requestedWhInput
        ? memoryWarehouses.find(
            w => w.id === String(requestedWhInput).trim() || normalizeWarehouseName(w.name) === normalizeWarehouseName(String(requestedWhInput))
          )
        : undefined) || getDefaultWarehouse();
    resolvedWarehouse = offlineFallbackWh;
  } else {
    resolvedWarehouse = whRes.warehouse;
  }

  // تجميع الكميات المطلوبة لكل صنف لفحص التوفر الشامل قبل أي خصم
  const aggregatedQtyMap = new Map<string, number>();
  for (const line of lines) {
    const itId = line.itemId;
    const q = Number(line.quantity || 1);
    aggregatedQtyMap.set(itId, (aggregatedQtyMap.get(itId) || 0) + q);
  }

  // فحص توفر الأصناف في المخزن المحدد مسبقاً (حسب رصيد هذا المخزن فقط)
  for (const [itId, totalRequested] of aggregatedQtyMap.entries()) {
    const item = memoryItems.find(i => i.id === itId);
    if (!item) {
      if (isOfflineMode) {
        addReviewReason('الصنف موقوف أو محذوف');
        addReviewReason('رصيد سالب');
        continue;
      }
      return { success: false, statusCode: 400, error: `الصنف غير موجود بالمخزن: ${itId}` };
    }
    const availableInWarehouse = getItemWarehouseStock(item.id, resolvedWarehouse.id);
    if (isOfflineMode) {
      if (item.status === 'inactive' || item.status === 'موقوف' || item.status === 'مؤرشف') {
        addReviewReason('الصنف موقوف أو محذوف');
      }
      if (availableInWarehouse < totalRequested || availableInWarehouse - totalRequested < 0) {
        addReviewReason('رصيد سالب');
      }
    } else {
      // فحص إتاحة الصنف على المنصة المحددة
      if (item.platformIds && item.platformIds.length > 0 && !item.platformIds.includes(platform.id)) {
        return {
          success: false,
          statusCode: 400,
          error: `الصنف "${item.name}" غير متاح للبيع على منصة "${platform.name}"`
        };
      }
      if (!memoryStockSettings.allowNegativeStockSale && availableInWarehouse < totalRequested) {
        return {
          success: false,
          statusCode: 400,
          error: `الكمية غير متوفرة للصنف "${item.name}" في مخزن "${resolvedWarehouse.name}". المتاح: ${availableInWarehouse}`
        };
      }
    }
  }

  if (isOfflineMode && invoicePayload.needsReview && reviewReasonsList.length === 0) {
    addReviewReason('رصيد سالب');
  }

  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rawIncomingNo = String(invoicePayload.invoiceNumber || '').trim();
  // رقم الفاتورة التلقائي المتسلسل (إعدادات الترقيم). يتثبت في العد بعد نجاح الحفظ فقط
  const reservedInvoiceNo =
    !rawIncomingNo || rawIncomingNo.startsWith('OFF-')
      ? peekInvoiceNumber(now, no => memoryInvoices.some(inv => inv.invoiceNumber === no))
      : null;
  const invoiceNumber = reservedInvoiceNo ? reservedInvoiceNo.number : rawIncomingNo;
  const offlineProvisionalNo =
    rawProvNo || (rawIncomingNo.startsWith('OFF-') ? rawIncomingNo : '');

  for (const line of lines) {
    const item = memoryItems.find(i => i.id === line.itemId);
    if (!item) continue;
    const salePriceForUnit =
      line.baseUnitPrice !== undefined
        ? Number(line.baseUnitPrice)
        : line.salePriceAtSale !== undefined
        ? Number(line.salePriceAtSale)
        : item.salePrice;

    if (isOfflineMode) {
      if (Math.abs(salePriceForUnit - Number(item.salePrice || 0)) > 0.009) {
        addReviewReason('سعر الصنف تغيّر بعد البيع');
      }
    } else {
      if (!canOverrideMin && item.minPrice && salePriceForUnit < item.minPrice) {
        return { success: false, error: `سعر البيع للصنف "${item.name}" أقل من الحد الأدنى (${item.minPrice} ج.م)` };
      }
    }
    if (!canBypassPriceRules) {
      const priceRule = priceRuleViolation({ unitPrice: salePriceForUnit, purchasePrice: item.purchasePrice, itemName: item.name });
      if (priceRule) {
        if (!isOfflineMode) return { success: false, code: priceRule.code, error: priceRule.message };
        addReviewReason(priceRule.reviewReason);
      }
    }
  }

  const calcResult = calculateInvoice({
    invoiceNumber,
    lines: lines.map((line: any) => {
      const existingItem = memoryItems.find(i => i.id === line.itemId);
      const fallbackSalePrice =
        line.baseUnitPrice !== undefined
          ? Number(line.baseUnitPrice)
          : line.salePriceAtSale !== undefined
          ? Number(line.salePriceAtSale)
          : 0;
      const itemForCalc: Item = existingItem || {
        id: String(line.itemId),
        name: String(line.itemNameAtSale || line.name || line.itemId),
        imageUrl: '',
        barcode: String(line.barcodeAtSale || ''),
        salePrice: fallbackSalePrice,
        purchasePrice: Number(line.purchasePriceAtSale || 0),
        packagingCost: Number(line.packagingCostAtSale || 0),
        stockQuantity: 0,
        taxRate: Number(line.taxRateAtSale || 0),
        notes: '',
        createdAt: now.toISOString(),
        status: 'موقوف'
      };
      return {
        line: isOfflineMode
          ? {
              ...line,
              salePriceAtSale: fallbackSalePrice,
              baseUnitPrice: fallbackSalePrice
            }
          : line,
        item: itemForCalc
      };
    }),
    platform,
    taxSettings,
    deliveryFee,
    bnplEnabled: invoicePayload.bnplEnabled,
    bnplPercentOverrideVal,
    platformDiscountPercent,
    preferLineBnplPercent: isOfflineMode
  });

  const calculatedLines: InvoiceLine[] = calcResult.lines;
  const totalBeforeDiscount = calcResult.totalBeforeDiscount;
  const totalBnpl = calcResult.totalBnpl;
  const totalDiscount = calcResult.totalDiscount;
  const totalPickupFee = calcResult.totalPickupFee;
  const totalTax = calcResult.totalTax;
  const grossInvoiceTotal = calcResult.grossInvoiceTotal;
  const netAmount = calcResult.netAmount;
  const totalProfit = calcResult.totalProfit;
  const bnplPercentApplied = calcResult.bnplPercentApplied;
  const commissionPercentApplied = calcResult.commissionPercentApplied;

  if (deliveryPlan) {
    try {
      checkPlanTotals(deliveryPlan, totalBeforeDiscount);
    } catch (err: any) {
      if (!(err instanceof DeliveryError)) throw err;
      if (!isOfflineMode) return { success: false, statusCode: err.statusCode, code: err.code, error: err.message };
      addReviewReason(`طلب توصيل: ${err.message}`);
    }
    if (deliveryPlan.paymentMode === 'cod') {
      invoicePayload.paymentType = 'آجل';
      invoicePayload.creditPartyType = 'delivery';
    }
  }

  // تحديد نوع السداد ومبالغ التحصيل
  const paymentType: 'نقدي' | 'آجل' | 'جزئي' = invoicePayload.paymentType || (
    invoicePayload.customerId && invoicePayload.paidAmount !== undefined && Number(invoicePayload.paidAmount) < netAmount
      ? (Number(invoicePayload.paidAmount) === 0 ? 'آجل' : 'جزئي')
      : 'نقدي'
  );

  // إعدادات البيع: «بيع المنصات دايمًا آجل على المنصة». فواتير الأوفلاين تُقبل وتُعلَّم للمراجعة
  const platformCreditRuleError = platformPaymentViolation({
    isPlatformSale: platform.name !== DIRECT_SALE_PLATFORM_NAME,
    paymentType,
    creditPartyType: invoicePayload.creditPartyType,
    customerId: invoicePayload.customerId,
    customerName: invoicePayload.customerName
  });
  if (platformCreditRuleError) {
    if (!isOfflineMode) return { success: false, code: 'PLATFORM_CREDIT_ONLY', error: platformCreditRuleError };
    addReviewReason('بيع منصة بغير الآجل على المنصة');
  }

  // البحث عن العميل أو المنصة الصريحة
  const customer = (invoicePayload.customerId || invoicePayload.customerName)
    ? memoryCustomers.find(c => c.id === invoicePayload.customerId || (invoicePayload.customerName && c.name === invoicePayload.customerName))
    : undefined;
  const explicitPlatform = (invoicePayload.platformId || invoicePayload.platformName || invoicePayload.platform)
    ? (memoryPlatforms.find(p => p.id === invoicePayload.platformId || p.name === invoicePayload.platformName || p.name === invoicePayload.platform) ||
       (isOfflineMode ? platform : undefined))
    : undefined;

  let creditPartyType: 'customer' | 'platform' | 'delivery' | undefined = undefined;
  let creditPartyId: string | undefined = undefined;
  let creditPartyName: string | undefined = undefined;
  let creditDueAmount: number | undefined = undefined;

  if (paymentType === 'آجل' && deliveryPlan?.paymentMode === 'cod') {
    // الدفع عند الاستلام: المستحق = المطلوب من العميل، ويتسوّى من شاشة التوصيل
    creditPartyType = 'delivery';
    creditPartyId = 'delivery';
    creditPartyName = 'الدفع عند الاستلام (توصيل)';
    creditDueAmount = netAmount;
  } else if (paymentType === 'آجل') {
    if (invoicePayload.creditPartyType === 'customer') {
      if (!customer) {
        return { success: false, error: 'الفاتورة الآجلة على عميل تتطلب اختيار عميل مسجل صالح' };
      }
      creditPartyType = 'customer';
    } else if (invoicePayload.creditPartyType === 'platform') {
      if (!explicitPlatform) {
        return { success: false, error: 'الفاتورة الآجلة على منصة تتطلب اختيار منصة مسجلة صالحة' };
      }
      creditPartyType = 'platform';
    } else if (invoicePayload.customerId || invoicePayload.customerName) {
      if (!customer) {
        return { success: false, error: 'العميل المحدد للفاتورة الآجلة غير مسجل' };
      }
      creditPartyType = 'customer';
    } else if (invoicePayload.platformId || explicitPlatform) {
      if (!explicitPlatform) {
        return { success: false, error: 'المنصة المحددة للفاتورة الآجلة غير مسجلة' };
      }
      creditPartyType = 'platform';
    } else {
      return { success: false, error: 'الفاتورة الآجلة تشترط اختيار طرف (عميل أو منصة)' };
    }

    if (creditPartyType === 'customer') {
      creditPartyId = customer!.id;
      creditPartyName = customer!.name;
      // مبلغ الاستحقاق للعميل = إجمالي الفاتورة
      creditDueAmount = grossInvoiceTotal;
    } else {
      creditPartyId = explicitPlatform!.id;
      creditPartyName = explicitPlatform!.name;
      // مبلغ الاستحقاق للمنصة = الصافي
      creditDueAmount = netAmount;
    }
  } else if (paymentType === 'جزئي') {
    if (!customer) {
      return { success: false, error: 'الفواتير الآجلة والجزئية تتطلب تحديد عميل مسجل لترحيل المديونية على حسابه' };
    }
  }

  let paidAmount = 0;
  let remainingAmount = 0;

  if (paymentType === 'نقدي') {
    const canEditCashPaid =
      isOfflineMode ||
      !session ||
      session.role === 'designer' ||
      Boolean((session as any).isOwner) ||
      (Array.isArray(session.permissions) && session.permissions.includes('invoices.edit_cash_paid'));

    if (
      invoicePayload.paidAmount !== undefined &&
      invoicePayload.paidAmount !== null &&
      String(invoicePayload.paidAmount).trim() !== ''
    ) {
      const requestedCashPaid = Math.round(Number(invoicePayload.paidAmount) * 100) / 100;
      if (isNaN(requestedCashPaid) || requestedCashPaid < 0) {
        return { success: false, error: 'قيمة المدفوع النقدي غير صالحة' };
      }
      if (Math.abs(requestedCashPaid - netAmount) > 0.01 && !canEditCashPaid) {
        return {
          success: false,
          error: 'غير مصرح: لا تملك صلاحية تعديل المدفوع النقدي (invoices.edit_cash_paid)، يجب أن يساوي المدفوع إجمالي الفاتورة المطلوب'
        };
      }
      paidAmount = requestedCashPaid;
    } else {
      paidAmount = netAmount;
    }
    remainingAmount = 0;
  } else if (paymentType === 'آجل') {
    paidAmount = 0;
    remainingAmount = creditDueAmount!;
  } else {
    paidAmount = Math.max(0, Math.min(Number(invoicePayload.paidAmount || 0), netAmount));
    remainingAmount = Math.max(0, netAmount - paidAmount);
  }

  // التحقق من الخزينة عند وجود تحصيل نقدي فعلي (نقدي أو جزئي فقط - الآجل لا يسجل أي حركة خزينة)
  let selectedCashbox: Cashbox | undefined = undefined;
  if (paymentType !== 'آجل' && paidAmount > 0) {
    let hasRestrictedCashboxes = false;
    if (!isOfflineMode && session?.role !== 'designer') {
      const callerUser = memoryUsers.find(u => u.phone === session?.phone || u.id === (session as any)?.userId);
      if (callerUser?.cashboxConfig?.allowedSaleCashboxIds && callerUser.cashboxConfig.allowedSaleCashboxIds.length > 0) {
        hasRestrictedCashboxes = true;
        const reqCbId = invoicePayload.cashboxId || callerUser.cashboxConfig.defaultSaleCashboxId;
        if (!reqCbId || !callerUser.cashboxConfig.allowedSaleCashboxIds.includes(reqCbId)) {
          return { success: false, error: 'غير مصرح: الخزينة المحددة غير مخصصة لك لعمليات البيع' };
        }
        invoicePayload.cashboxId = reqCbId;
      }
    }

    selectedCashbox = memoryCashboxes.find(c => c.id === invoicePayload.cashboxId || c.name === invoicePayload.cashboxName) ||
      ((!invoicePayload.cashboxId && !invoicePayload.cashboxName && !hasRestrictedCashboxes) || isOfflineMode ? memoryCashboxes[0] : undefined);
    if (!selectedCashbox) {
      return { success: false, error: 'يرجى تحديد خزينة صالحة ومصرح بها لتحصيل المبلغ النقدي' };
    }
  }

  // خصم كميات المخزن المحدد فقط وإعادة حساب stockQuantity للصنف مع تسجيل الحركة
  for (const line of lines) {
    const item = memoryItems.find(i => i.id === line.itemId);
    const qty = Number(line.quantity || 1);
    if (item) {
      const beforeQty = getItemWarehouseStock(item.id, resolvedWarehouse.id);
      const adj = adjustItemWarehouseDelta(item.id, resolvedWarehouse.id, -qty);

      memoryStockMovements.push({
        id: generateUUID(),
        date: now.toISOString(),
        itemId: item.id,
        itemName: item.name,
        warehouseId: resolvedWarehouse.id,
        warehouseName: resolvedWarehouse.name,
        documentNumber: invoiceNumber,
        movementType: 'بيع',
        quantity: -qty,
        quantityBefore: beforeQty,
        quantityAfter: adj.balanceInWarehouse,
        balanceAfter: adj.balanceInWarehouse,
        notes: isOfflineMode && offlineProvisionalNo
          ? `فاتورة بيع أوفلاين ${invoiceNumber} (مؤقت: ${offlineProvisionalNo}) - مخزن ${resolvedWarehouse.name}`
          : `فاتورة بيع ${invoiceNumber} - مخزن ${resolvedWarehouse.name}`,
        userName: invoicePayload.createdBy || 'كاشير'
      });
    } else if (isOfflineMode) {
      memoryStockMovements.push({
        id: generateUUID(),
        date: now.toISOString(),
        itemId: String(line.itemId),
        itemName: String(line.itemNameAtSale || line.name || line.itemId),
        warehouseId: resolvedWarehouse.id,
        warehouseName: resolvedWarehouse.name,
        documentNumber: invoiceNumber,
        movementType: 'بيع',
        quantity: -qty,
        balanceAfter: -qty,
        notes: `فاتورة بيع أوفلاين لصنف محذوف ${invoiceNumber} (مؤقت: ${offlineProvisionalNo}) - مخزن ${resolvedWarehouse.name}`,
        userName: invoicePayload.createdBy || 'كاشير'
      });
    }
  }

  if (paymentType !== 'آجل' && paidAmount > 0 && selectedCashbox) {
    selectedCashbox.currentBalance += paidAmount;

    // تسجيل حركة الخزينة الرسمية
    memoryCashboxTransactions.push({
      id: generateUUID(),
      date: now.toISOString(),
      cashboxId: selectedCashbox.id,
      cashboxName: selectedCashbox.name,
      type: 'إيراد مبيعات',
      documentNumber: invoiceNumber,
      amount: paidAmount,
      balanceAfter: selectedCashbox.currentBalance,
      party: customer ? customer.name : platform.name,
      statement: paymentType === 'جزئي'
        ? `تحصيل دفعة نقدية مسددة من فاتورة بيع ${invoiceNumber} (إجمالي: ${netAmount} ج.م، مسدد: ${paidAmount} ج.م)`
        : `إيراد مبيعات فاتورة نقداً ${invoiceNumber}`,
      userName: session?.phone || invoicePayload.createdBy || 'كاشير'
    });

    // تسجيل حركة خزينة في دفتر النقدية
    memoryCashboxEntries.push({
      id: generateUUID(),
      date: now.toISOString(),
      documentNumber: invoiceNumber,
      entryType: 'إيراد بيع',
      cashboxName: selectedCashbox.name,
      amount: paidAmount,
      platform: platform.name,
      notes: `تحصيل فاتورة ${invoiceNumber}`,
      userName: invoicePayload.createdBy || 'كاشير'
    });
  }

  // ترحيل سجل حساب الطرف (عميل أو منصة). الدفع عند الاستلام مالوش كشف حساب: بيتتابع في التوصيل
  if (creditPartyType === 'delivery') {
    // لا شيء
  } else if (paymentType === 'آجل' && creditPartyType && creditPartyId && creditPartyName && creditDueAmount !== undefined) {
    const entryId = generateUUID();
    const isoNow = now.toISOString();
    const userActor = session?.phone || invoicePayload.createdBy || 'كاشير';
    const statementText = creditPartyType === 'customer'
      ? `فاتورة آجل رقم ${invoiceNumber} (إجمالي الفاتورة: ${creditDueAmount} ج.م)`
      : `فاتورة آجل رقم ${invoiceNumber} (صافي المنصة: ${creditDueAmount} ج.م)`;

    if (creditPartyType === 'customer') {
      memoryCustomerLedger.push({
        id: entryId,
        date: isoNow,
        customerId: creditPartyId,
        customerName: creditPartyName,
        transactionType: 'فاتورة آجل',
        documentNumber: invoiceNumber,
        debit: creditDueAmount,
        credit: 0,
        balanceAfter: 0,
        statement: statementText,
        userName: userActor,
        notes: invoicePayload.notes
      });
    }

    const partyEntry: PartyLedgerEntry = {
      id: entryId,
      date: isoNow,
      partyType: creditPartyType,
      partyId: creditPartyId,
      partyName: creditPartyName,
      transactionType: 'فاتورة آجل',
      documentNumber: invoiceNumber,
      debit: creditDueAmount,
      credit: 0,
      balanceAfter: 0,
      statement: statementText,
      userName: userActor,
      notes: invoicePayload.notes
    };
    memoryPartyLedger.push(partyEntry);

    const newPartyBal = computePartyBalance(creditPartyType, creditPartyId);
    partyEntry.balanceAfter = newPartyBal;
    if (creditPartyType === 'customer') {
      const lastCustEntry = memoryCustomerLedger[memoryCustomerLedger.length - 1];
      if (lastCustEntry && lastCustEntry.id === entryId) {
        lastCustEntry.balanceAfter = newPartyBal;
      }
    }
  } else if (customer) {
    if (paymentType === 'نقدي') {
      const id1 = generateUUID();
      const id2 = generateUUID();
      const isoNow = now.toISOString();
      const userActor = session?.phone || invoicePayload.createdBy || 'كاشير';
      const curBal = computePartyBalance('customer', customer.id);

      memoryCustomerLedger.push({
        id: id1,
        date: isoNow,
        customerId: customer.id,
        customerName: customer.name,
        transactionType: 'فاتورة بيع',
        documentNumber: invoiceNumber,
        debit: netAmount,
        credit: 0,
        balanceAfter: curBal + netAmount,
        statement: `فاتورة بيع رقم ${invoiceNumber} (سداد نقدي كامل)`,
        userName: userActor,
        notes: invoicePayload.notes
      });
      memoryPartyLedger.push({
        id: id1,
        date: isoNow,
        partyType: 'customer',
        partyId: customer.id,
        partyName: customer.name,
        transactionType: 'فاتورة بيع',
        documentNumber: invoiceNumber,
        debit: netAmount,
        credit: 0,
        balanceAfter: curBal + netAmount,
        statement: `فاتورة بيع رقم ${invoiceNumber} (سداد نقدي كامل)`,
        userName: userActor,
        notes: invoicePayload.notes
      });

      memoryCustomerLedger.push({
        id: id2,
        date: isoNow,
        customerId: customer.id,
        customerName: customer.name,
        transactionType: 'سداد فاتورة بيع',
        documentNumber: invoiceNumber,
        debit: 0,
        credit: paidAmount,
        balanceAfter: curBal,
        statement: `سداد فوري لفاتورة ${invoiceNumber} في ${selectedCashbox?.name || 'الخزينة'}`,
        userName: userActor,
        notes: invoicePayload.notes
      });
      memoryPartyLedger.push({
        id: id2,
        date: isoNow,
        partyType: 'customer',
        partyId: customer.id,
        partyName: customer.name,
        transactionType: 'سداد فاتورة بيع',
        documentNumber: invoiceNumber,
        debit: 0,
        credit: paidAmount,
        balanceAfter: curBal,
        statement: `سداد فوري لفاتورة ${invoiceNumber} في ${selectedCashbox?.name || 'الخزينة'}`,
        userName: userActor,
        notes: invoicePayload.notes
      });
      computePartyBalance('customer', customer.id);
    } else if (paymentType === 'جزئي') {
      const id1 = generateUUID();
      const id2 = generateUUID();
      const isoNow = now.toISOString();
      const userActor = session?.phone || invoicePayload.createdBy || 'كاشير';
      const curBal = computePartyBalance('customer', customer.id);

      memoryCustomerLedger.push({
        id: id1,
        date: isoNow,
        customerId: customer.id,
        customerName: customer.name,
        transactionType: 'فاتورة بيع',
        documentNumber: invoiceNumber,
        debit: netAmount,
        credit: 0,
        balanceAfter: curBal + netAmount,
        statement: `فاتورة بيع رقم ${invoiceNumber} (إجمالي: ${netAmount} ج.م)`,
        userName: userActor,
        notes: invoicePayload.notes
      });
      memoryPartyLedger.push({
        id: id1,
        date: isoNow,
        partyType: 'customer',
        partyId: customer.id,
        partyName: customer.name,
        transactionType: 'فاتورة بيع',
        documentNumber: invoiceNumber,
        debit: netAmount,
        credit: 0,
        balanceAfter: curBal + netAmount,
        statement: `فاتورة بيع رقم ${invoiceNumber} (إجمالي: ${netAmount} ج.م)`,
        userName: userActor,
        notes: invoicePayload.notes
      });

      memoryCustomerLedger.push({
        id: id2,
        date: isoNow,
        customerId: customer.id,
        customerName: customer.name,
        transactionType: 'سداد فاتورة بيع',
        documentNumber: invoiceNumber,
        debit: 0,
        credit: paidAmount,
        balanceAfter: curBal + remainingAmount,
        statement: `سداد دفعة نقدية مسددة لفاتورة ${invoiceNumber} في ${selectedCashbox?.name || 'الخزينة'}`,
        userName: userActor,
        notes: invoicePayload.notes
      });
      memoryPartyLedger.push({
        id: id2,
        date: isoNow,
        partyType: 'customer',
        partyId: customer.id,
        partyName: customer.name,
        transactionType: 'سداد فاتورة بيع',
        documentNumber: invoiceNumber,
        debit: 0,
        credit: paidAmount,
        balanceAfter: curBal + remainingAmount,
        statement: `سداد دفعة نقدية مسددة لفاتورة ${invoiceNumber} في ${selectedCashbox?.name || 'الخزينة'}`,
        userName: userActor,
        notes: invoicePayload.notes
      });
      computePartyBalance('customer', customer.id);
    }
  }

  const canViewProfit = isDesigner || session?.permissions?.includes('reports.view_profit');
  const canViewPurchase = isDesigner || session?.permissions?.includes('prices.view_purchase');

  const invoiceStatus = paymentType === 'آجل' ? 'معلّقة' : 'تم البيع';
  const creditStatus = paymentType === 'آجل' ? 'معلّقة' : undefined;
  const needsReviewFlag = isOfflineMode ? reviewReasonsList.length > 0 : Boolean(invoicePayload.needsReview);
  const offlineDeviceId = isOfflineMode ? String(invoicePayload.offlineDeviceId || invoicePayload.deviceId || '').trim() : undefined;
  const receivedAtIso = now.toISOString();

  const newInvoice: Invoice = {
    ...(typeof (invoicePayload as any).cartId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test((invoicePayload as any).cartId) ? { cartId: (invoicePayload as any).cartId } : {}),
    invoiceNumber,
    date: receivedAtIso,
    receivedAt: isOfflineMode ? receivedAtIso : undefined,
    platform: platform.name,
    platformId: platform.id,
    customerName: customer ? customer.name : (invoicePayload.customerName || ''),
    customerId: customer ? customer.id : (invoicePayload.customerId || ''),
    cashboxName: selectedCashbox ? selectedCashbox.name : (paymentType === 'آجل' ? undefined : (invoicePayload.cashboxName || undefined)),
    cashboxId: selectedCashbox ? selectedCashbox.id : (paymentType === 'آجل' ? undefined : invoicePayload.cashboxId),
    warehouseId: resolvedWarehouse.id,
    warehouseName: resolvedWarehouse.name,
    idempotencyKey: idemKey,
    paymentType,
    creditPartyType,
    creditPartyId,
    creditPartyName,
    creditDueAmount,
    creditStatus,
    paidAmount,
    remainingAmount,
    paymentMethod: paymentType === 'آجل' ? 'آجل' : (invoicePayload.paymentMethod || (paymentType === 'نقدي' ? 'نقدي' : 'جزئي')),
    referenceNumber: invoicePayload.referenceNumber || '',
    totalBeforeDiscount,
    bnplTotalAmount: totalBnpl,
    bnplEnabled: !isBnplDisabled && (Boolean(invoicePayload.bnplEnabled) || totalBnpl > 0 || Boolean(platform.enableBnpl)),
    bnplPercentApplied,
    commissionPercentApplied,
    discountAmount: totalDiscount,
    pickupFeeAmount: totalPickupFee,
    deliveryFee,
    taxAmount: totalTax,
    netAmount,
    profit: canViewProfit ? totalProfit : undefined,
    status: invoiceStatus,
    notes: invoicePayload.notes || '',
    ...(platformOrderId ? { platformOrderId } : {}),
    createdBy: session?.name || session?.phone || invoicePayload.createdBy || 'كاشير',
    ...(isOfflineMode
      ? {
          isOffline: true,
          offlinePending: false,
          offlineDeviceId: offlineDeviceId || undefined,
          deviceId: offlineDeviceId || undefined,
          offlineProvisionalNo: offlineProvisionalNo || undefined,
          tempInvoiceNumber: offlineProvisionalNo || undefined,
          deviceTime: deviceTimeStr || receivedAtIso,
          needsReview: needsReviewFlag,
          reviewReasons: reviewReasonsList
        }
      : {}),
    lines: calculatedLines.map(cl => ({
      ...cl,
      purchasePriceAtSale: canViewPurchase ? cl.purchasePriceAtSale : undefined,
      packagingCostAtSale: canViewPurchase ? cl.packagingCostAtSale : undefined,
      unitProfit: canViewProfit ? cl.unitProfit : undefined
    }))
  };

  // طلب التوصيل بيتسجل مع الفاتورة
  if (deliveryPlan) {
    const deliveryOrder = createOrderForInvoice(deliveryPlan, { invoiceNumber, total: netAmount }, session as any, now);
    newInvoice.deliveryOrderId = deliveryOrder.id;
  }

  const newInvoiceWithKey: Invoice = {
    ...newInvoice,
    idempotencyKey: idemKey
  };
  if (reservedInvoiceNo) commitInvoiceNumber(reservedInvoiceNo);
  memoryInvoices.unshift(newInvoiceWithKey);
  setIdempotencyCachedResult('createInvoice', idemKey, newInvoiceWithKey);

  if (isOfflineMode) {
    recordAuditLog(
      session || {},
      'OFFLINE_INVOICE_SYNC',
      'Invoice',
      invoiceNumber,
      `رفع فاتورة أوفلاين (مؤقت: ${offlineProvisionalNo || '—'} -> نهائي: ${invoiceNumber}) | جهاز: ${offlineDeviceId || '—'} | وقت الجهاز: ${deviceTimeStr || '—'} | وقت الاستلام: ${receivedAtIso} | الصافي: ${netAmount} EGP${
        needsReviewFlag ? ` | تحتاج مراجعة: ${reviewReasonsList.join('، ')}` : ''
      }`
    );
  } else {
    recordAuditLog(
      session || {},
      'INVOICE_CREATE',
      'Invoice',
      invoiceNumber,
      `إنشاء فاتورة بيع (${paymentType}) بقيمة صافية: ${netAmount} EGP (مسدد: ${paidAmount} EGP, متبقي: ${remainingAmount} EGP)`
    );
  }

  return {
    success: true,
    invoice: newInvoice,
    finalInvoiceNumber: invoiceNumber,
    provisionalInvoiceNumber: offlineProvisionalNo || undefined,
    needsReview: needsReviewFlag,
    reviewReasons: reviewReasonsList
  };
}

/**
 * استقبال ومزامنة عملية محفوظة أوفلاين من صندوق الصادر (Outbox) عند رجوع الاتصال
 */
export async function syncOfflineOperation(
  operationPayload: any,
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; userId?: string; name?: string; userSuspended?: boolean }
): Promise<{
  success: boolean;
  duplicate?: boolean;
  statusCode?: number;
  invoice?: Invoice;
  collectionId?: string;
  totalDue?: number;
  receivedAmount?: number;
  difference?: number;
  partyBalance?: number;
  settledInvoices?: string[];
  duplicateCollectionInvoices?: string[];
  ledgerEntriesCreated?: PartyLedgerEntry[];
  finalInvoiceNumber?: string;
  provisionalInvoiceNumber?: string;
  needsReview?: boolean;
  reviewReasons?: string[];
  error?: string;
  code?: string;
}> {
  if (!operationPayload || typeof operationPayload !== 'object') {
    return { success: false, statusCode: 400, error: 'بيانات العملية الأوفلاين تالفة أو فارغة' };
  }

  const innerPayload =
    operationPayload.payload && typeof operationPayload.payload === 'object'
      ? operationPayload.payload
      : operationPayload;

  const opType = String(
    operationPayload.type ||
    operationPayload.operationType ||
    innerPayload.type ||
    innerPayload.operationType ||
    (Array.isArray(innerPayload.invoiceNumbers) ? 'collectCredit' : 'createInvoice')
  ).trim();

  if (opType === 'authAudit' || opType === 'OFFLINE_LOGIN' || opType === 'OFFLINE_LOGOUT') {
    const idemKey = getValidatedIdempotencyKey(operationPayload.idempotencyKey || innerPayload.idempotencyKey || operationPayload.id);
    if (idemKey) {
      const cached = getIdempotencyCachedResult('authAudit', idemKey);
      if (cached) {
        return { ...cached, duplicate: true };
      }
    }

    const config = getSystemConfig();
    if (isSheetsDataMode(config)) {
      const res = await callAppsScript('syncOfflineOperation', operationPayload, session?.token);
      if (res.success) {
        if (idemKey) setIdempotencyCachedResult('authAudit', idemKey, res);
        return res as any;
      }
      return buildSheetsWriteFailure(res, 'تعذر رفع حدث الجلسة الأوفلاين إلى Google Sheets');
    }

    const rawAuditAction = String(
      innerPayload.auditAction ||
      (opType === 'OFFLINE_LOGOUT' || innerPayload.operationType === 'OFFLINE_LOGOUT' ? 'OFFLINE_LOGOUT' : 'OFFLINE_LOGIN')
    ).trim();
    const auditAction = rawAuditAction === 'OFFLINE_LOGOUT' ? 'OFFLINE_LOGOUT' : 'OFFLINE_LOGIN';
    const actorId = String(innerPayload.userId || operationPayload.userId || session?.userId || 'offline-user');
    const actorName = String(innerPayload.userName || innerPayload.username || operationPayload.userName || session?.name || 'مستخدم');
    const actorRole = String(innerPayload.userRole || session?.role || 'employee');
    const devId = String(operationPayload.deviceId || operationPayload.offlineDeviceId || innerPayload.deviceId || '');
    const devName = String(operationPayload.deviceName || innerPayload.deviceName || devId || 'جهاز محلي');
    const devTime = String(operationPayload.deviceTime || innerPayload.deviceTime || operationPayload.createdAt || new Date().toISOString());

    recordAuditLog(
      { id: actorId, name: actorName, role: actorRole },
      auditAction,
      'Session',
      actorId,
      `${auditAction === 'OFFLINE_LOGIN' ? 'تسجيل دخول بدون إنترنت' : 'تسجيل خروج بدون إنترنت'} للمستخدم (${actorName}) على الجهاز (${devName}${devId ? ` - ${devId}` : ''}) بوقت الجهاز (${devTime})`
    );

    const authResult = {
      success: true,
      auditAction
    };
    if (idemKey) {
      setIdempotencyCachedResult('authAudit', idemKey, authResult);
    }
    return authResult as any;
  }

  if (opType === 'updatePermissions' || opType === 'updateUserPermissions') {
    const idemKey = getValidatedIdempotencyKey(operationPayload.idempotencyKey || innerPayload.idempotencyKey || operationPayload.id);
    if (idemKey) {
      const cached = getIdempotencyCachedResult('updatePermissions', idemKey);
      if (cached) {
        return { ...cached, duplicate: true };
      }
    }

    const canManagePerms =
      session?.role === 'designer' ||
      Boolean(session?.permissions?.includes('permissions.manage'));
    if (!canManagePerms) {
      return {
        success: false,
        statusCode: 403,
        error: 'غير مصرح: لا تملك صلاحية تعديل الصلاحيات'
      };
    }

    const config = getSystemConfig();
    if (isSheetsDataMode(config)) {
      const res = await callAppsScript('syncOfflineOperation', operationPayload, session?.token);
      if (res.success) {
        if (idemKey) setIdempotencyCachedResult('updatePermissions', idemKey, res);
        return res as any;
      }
      return buildSheetsWriteFailure(res, 'تعذر مزامنة تعديل الصلاحيات في Google Sheets');
    }

    const targetUserId = String(innerPayload.targetUserId || innerPayload.userId || '').trim();
    const target = memoryUsers.find(u => u.id === targetUserId);
    if (!target) {
      return { success: false, statusCode: 404, error: 'المستخدم المستهدف غير موجود' };
    }

    if ((target.role === 'designer' || target.isOwner) && session?.role !== 'designer') {
      return { success: false, statusCode: 403, error: 'غير مصرح: لا يمكن تعديل صلاحيات مالك النظام.' };
    }

    const rawNewPerms: PermissionKey[] = Array.isArray(innerPayload.permissions) ? innerPayload.permissions : [];
    const filteredPerms: PermissionKey[] =
      session?.role === 'designer'
        ? rawNewPerms
        : rawNewPerms.filter(p => session?.permissions?.includes(p));

    const incomingEditedAt = String(
      innerPayload.editedAt ||
      innerPayload.updatedAt ||
      operationPayload.deviceTime ||
      operationPayload.createdAt ||
      new Date().toISOString()
    ).trim();
    const baseUpdatedAt = String(innerPayload.baseUpdatedAt || '').trim();
    const incomingDeviceId = String(
      operationPayload.deviceId ||
      operationPayload.offlineDeviceId ||
      innerPayload.deviceId ||
      innerPayload.offlineDeviceId ||
      'OFFLINE_DEVICE'
    ).trim();
    const incomingDeviceName = String(
      operationPayload.deviceName ||
      innerPayload.deviceName ||
      incomingDeviceId
    ).trim();

    const currentUpdatedAt = String(target.permissionsUpdatedAt || '').trim();
    const currentDevice = String(target.permissionsUpdatedByDevice || '').trim();

    // التحقق من وجود تعديل آخر لنفس المستخدم من جهاز ثانٍ
    const conflictDetected = Boolean(
      currentUpdatedAt &&
      currentDevice &&
      currentDevice !== incomingDeviceId &&
      (!baseUpdatedAt || currentUpdatedAt !== baseUpdatedAt)
    );

    const incomingMs = Date.parse(incomingEditedAt) || 0;
    const currentMs = Date.parse(currentUpdatedAt) || 0;
    const incomingWins = !currentUpdatedAt || incomingMs >= currentMs;

    if (incomingWins) {
      target.permissions = target.role === 'designer' ? ALL_PERMISSIONS.map(p => p.key) : filteredPerms;
      if (innerPayload.cashboxConfig !== undefined && session?.role === 'designer') {
        target.cashboxConfig = innerPayload.cashboxConfig;
      }
      target.permissionsUpdatedAt = incomingEditedAt;
      target.permissionsUpdatedByDevice = incomingDeviceId;
    }

    if (conflictDetected) {
      recordAuditLog(
        session || {},
        'PERMISSIONS_SYNC_CONFLICT',
        'UserPermissions',
        target.id,
        `تعارض تعديل صلاحيات للمالك على المستخدم (${target.name || target.username}): وُجد تعديل من الجهاز (${incomingDeviceName} / ${incomingDeviceId}) بوقت (${incomingEditedAt}) مع تعديل آخر من الجهاز (${currentDevice}) بوقت (${currentUpdatedAt}). تم تطبيق التعديل الأحدث زمنيًا (${incomingWins ? incomingEditedAt : currentUpdatedAt}).`
      );
    }

    recordAuditLog(
      session || {},
      'PERMISSIONS_UPDATE',
      'UserPermissions',
      target.id,
      `مزامنة تعديل صلاحيات بدون إنترنت للمستخدم (${target.name || target.username}) من الجهاز (${incomingDeviceName}) — ${incomingWins ? `تم اعتماد التعديل (${target.permissions.length} صلاحية)` : 'تم الإبقاء على التعديل الأحدث زمنيًا'}`
    );

    const permSyncRes = {
      success: true,
      conflictDetected,
      appliedIncoming: incomingWins,
      winningTimestamp: incomingWins ? incomingEditedAt : currentUpdatedAt,
      permissions: target.permissions,
      needsReview: conflictDetected,
      reviewReasons: conflictDetected ? ['تعارض تعديل صلاحيات من جهازين'] : []
    };
    if (idemKey) {
      setIdempotencyCachedResult('updatePermissions', idemKey, permSyncRes);
    }
    return permSyncRes as any;
  }

  if (opType === 'collectCredit' || opType === 'collectCreditInvoices') {
    if (innerPayload.partyType === 'platform' && !arePlatformsEnabled()) {
      return {
        success: false,
        statusCode: 403,
        code: 'PLATFORMS_DISABLED',
        error: 'مبيعات ووظائف المنصات معطلة حاليًا من إعدادات النظام'
      };
    }
    const normalizedCollectPayload: CollectCreditPayload = {
      ...innerPayload,
      partyType: innerPayload.partyType,
      partyId: innerPayload.partyId,
      invoiceNumbers: Array.isArray(innerPayload.invoiceNumbers) ? innerPayload.invoiceNumbers : [],
      receivedAmount: Number(innerPayload.receivedAmount ?? 0),
      cashboxId: String(innerPayload.cashboxId || ''),
      confirmDifference: true,
      notes: innerPayload.notes,
      idempotencyKey: operationPayload.idempotencyKey || innerPayload.idempotencyKey,
      isOfflineSync: true,
      isOffline: true,
      deviceId: operationPayload.deviceId || operationPayload.offlineDeviceId || innerPayload.deviceId || innerPayload.offlineDeviceId || '',
      offlineDeviceId: operationPayload.deviceId || operationPayload.offlineDeviceId || innerPayload.deviceId || innerPayload.offlineDeviceId || '',
      deviceName: operationPayload.deviceName || innerPayload.deviceName || '',
      deviceTime: operationPayload.deviceTime || operationPayload.createdAt || innerPayload.deviceTime || ''
    };
    return collectCreditInvoices(normalizedCollectPayload, session);
  }

  const provisionalNo = String(
    operationPayload.offlineProvisionalNo ||
    operationPayload.tempInvoiceNumber ||
    innerPayload.offlineProvisionalNo ||
    innerPayload.tempInvoiceNumber ||
    innerPayload.invoiceNumber ||
    ''
  ).trim();

  const normalizedInvoicePayload = {
    ...innerPayload,
    ...(typeof (innerPayload.cartId ?? operationPayload.cartId) === 'string' ? { cartId: innerPayload.cartId ?? operationPayload.cartId } : {}),
    isOfflineSync: true,
    isOffline: true,
    idempotencyKey: operationPayload.idempotencyKey || innerPayload.idempotencyKey,
    offlineDeviceId: operationPayload.deviceId || operationPayload.offlineDeviceId || innerPayload.offlineDeviceId || innerPayload.deviceId || '',
    offlineProvisionalNo: provisionalNo,
    deviceTime: operationPayload.deviceTime || operationPayload.createdAt || innerPayload.deviceTime || innerPayload.date || '',
    needsReview: Boolean(operationPayload.needsReview || innerPayload.needsReview),
    reviewReasons: Array.isArray(operationPayload.reviewReasons)
      ? operationPayload.reviewReasons
      : Array.isArray(innerPayload.reviewReasons)
      ? innerPayload.reviewReasons
      : []
  };

  return createInvoice(normalizedInvoicePayload, session);
}

/**
 * اعتماد مراجعة فاتورة أو عملية أوفلاين (زر «تمت المراجعة» مع ملاحظة في شاشة المزامنة)
 */
export async function markOfflineInvoiceReviewed(
  payload: { invoiceNumber: string; reviewNote?: string; note?: string },
  session?: {
    token?: string;
    role: UserRole;
    isOwner?: boolean;
    permissions: PermissionKey[];
    phone?: string;
    userId?: string;
    name?: string;
  }
): Promise<{
  success: boolean;
  statusCode?: number;
  invoice?: Invoice;
  message?: string;
  error?: string;
}> {
  const canManageOffline =
    session?.role === 'designer' ||
    Boolean(session?.isOwner) ||
    Boolean(session?.permissions?.includes('offline.manage'));

  if (!canManageOffline) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية إدارة المزامنة [offline.manage]'
    };
  }

  const invNum = String(payload?.invoiceNumber || '').trim();
  const reviewNote = String(payload?.reviewNote ?? payload?.note ?? '').trim();
  if (!invNum) {
    return {
      success: false,
      statusCode: 400,
      error: 'رقم الفاتورة مطلوب لاعتماد المراجعة'
    };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript(
      'markOfflineInvoiceReviewed',
      {
        invoiceNumber: invNum,
        reviewNote,
        reviewedBy: session?.name || session?.phone || 'المدير'
      },
      session?.token
    );
    if (res && res.success) {
      return res as any;
    }
    return buildSheetsWriteFailure(res, 'تعذر اعتماد مراجعة الفاتورة في Google Sheets');
  }

  const foundInv = memoryInvoices.find(
    i =>
      i.invoiceNumber === invNum ||
      i.offlineProvisionalNo === invNum ||
      i.tempInvoiceNumber === invNum
  );

  if (!foundInv) {
    return {
      success: false,
      statusCode: 404,
      error: 'الفاتورة المحددة غير موجودة'
    };
  }

  const nowIso = new Date().toISOString();
  const reviewerName = session?.name || session?.phone || 'المدير';

  foundInv.needsReview = false;
  foundInv.reviewedAt = nowIso;
  foundInv.reviewedBy = reviewerName;
  foundInv.reviewNote = reviewNote;

  // تحديث أي قيد مرتبط في دفتر الأطراف يحمل نفس رقم الفاتورة أو المستند
  for (const entry of memoryPartyLedger) {
    if (
      entry.documentNumber === foundInv.invoiceNumber ||
      entry.documentNumber === invNum ||
      (entry.statement && entry.statement.includes(foundInv.invoiceNumber))
    ) {
      entry.needsReview = false;
    }
  }

  recordAuditLog(
    {
      id: session?.userId || 'system',
      name: reviewerName,
      role: session?.role || 'manager',
      phone: session?.phone
    },
    'OFFLINE_INVOICE_REVIEWED',
    'Invoice',
    foundInv.invoiceNumber,
    `تمت مراجعة فاتورة الأوفلاين رقم (${foundInv.invoiceNumber})${
      foundInv.offlineProvisionalNo ? ` [المؤقت: ${foundInv.offlineProvisionalNo}]` : ''
    }${reviewNote ? ` — ملاحظة المراجعة: ${reviewNote}` : ''}`
  );

  return {
    success: true,
    statusCode: 200,
    invoice: { ...foundInv },
    message: 'تم اعتماد مراجعة الفاتورة بنجاح'
  };
}

/**
 * تعديل فاتورة بعد الحفظ مع فحص الصلاحيات المحببة وحماية المرتجعات وتسوية المخزن والخزينة
 */
export async function updateInvoice(
  invoiceNumber: string,
  payload: any,
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string }
): Promise<{ success: boolean; invoice?: Invoice; error?: string; code?: string; statusCode?: number }> {
  const isDesigner = session?.role === 'designer';
  const perms = session?.permissions || [];
  const canEditBase = isDesigner || perms.includes('invoices.edit_after_save');

  if (!canEditBase) {
    return { success: false, error: 'غير مصرح: لا تملك صلاحية تعديل الفواتير بعد الحفظ' };
  }

  const editReason = String(payload.editReason || payload.reason || '').trim();
  if (!editReason) {
    return { success: false, error: 'سبب التعديل إلزامي ومطلوب لتوثيق سجل التدقيق المحاسبي' };
  }

  if (findOrderForInvoice(invoiceNumber)) {
    return { success: false, code: 'DELIVERY_INVOICE', error: 'دي فاتورة توصيل: مينفعش تتعدل. لو الطلب ما اتسلمش رجّعه أو الغيه من شاشة التوصيل' };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('editInvoice', {
      invoiceNumber,
      editReason,
      ...payload
    }, session?.token);
    if (res.success && res.invoice) {
      return { success: true, invoice: res.invoice };
    }
    return buildSheetsWriteFailure(res, 'تعذر تعديل الفاتورة في Google Sheets');
  }

  const existingIdx = memoryInvoices.findIndex(inv => inv.invoiceNumber === invoiceNumber);
  if (existingIdx === -1) {
    return { success: false, error: `الفاتورة ${invoiceNumber} غير موجودة` };
  }
  const oldInvoice = memoryInvoices[existingIdx];

  // 1. فحص حماية المرتجعات: منع حذف أو إنقاص أي صنف مرتجع
  const invoiceReturns = memoryReturns.filter(r => r.invoiceNumber === invoiceNumber);
  const returnedQuantitiesByItem: Record<string, number> = {};
  for (const ret of invoiceReturns) {
    for (const rl of ret.lines || []) {
      returnedQuantitiesByItem[rl.itemId] = (returnedQuantitiesByItem[rl.itemId] || 0) + rl.returnedQuantity;
    }
  }

  const newLines = payload.lines || [];
  if (newLines.length === 0) {
    return { success: false, error: 'لا يمكن حذف كافة بنود الفاتورة' };
  }

  for (const [itemId, returnedQty] of Object.entries(returnedQuantitiesByItem)) {
    const matchingNewLine = newLines.find((l: any) => l.itemId === itemId);
    if (!matchingNewLine) {
      const it = memoryItems.find(i => i.id === itemId);
      return {
        success: false,
        error: `لا يمكن حذف الصنف "${it?.name || itemId}" من الفاتورة لوجود مرتجع مسجل له (${returnedQty} قطعة)`
      };
    }
    if (Number(matchingNewLine.quantity) < returnedQty) {
      const it = memoryItems.find(i => i.id === itemId);
      return {
        success: false,
        error: `لا يمكن تقليل كمية الصنف "${it?.name || itemId}" إلى أقل من الكمية المرتجعة المسجلة (${returnedQty} قطعة)`
      };
    }
  }

  // 2. فحص الصلاحيات التفصيلية (Granular Permissions)
  const targetPlatformName = payload.platform || payload.platformName || oldInvoice.platform;
  if (targetPlatformName !== oldInvoice.platform) {
    if (targetPlatformName !== DIRECT_SALE_PLATFORM_NAME && !arePlatformsEnabled()) {
      return { success: false, code: 'PLATFORMS_DISABLED', statusCode: 403, error: 'مبيعات ووظائف المنصات معطلة حاليًا؛ لا يمكن تحويل الفاتورة إلى منصة' };
    }
    if (!isDesigner && !perms.includes('invoices.edit_platform_after_save')) {
      return { success: false, error: 'غير مصرح: لا تملك صلاحية تغيير المنصة في الفواتير المحفوظة' };
    }
  }

  const oldItemIds = (oldInvoice.lines || []).map(l => l.itemId).sort();
  const newItemIds = newLines.map((l: any) => l.itemId).sort();
  const itemsChanged = oldItemIds.length !== newItemIds.length || oldItemIds.some((id, idx) => id !== newItemIds[idx]);
  if (itemsChanged && !isDesigner && !perms.includes('invoices.edit_items_after_save')) {
    return { success: false, error: 'غير مصرح: لا تملك صلاحية إضافة أو حذف أصناف من الفاتورة المحفوظة' };
  }

  const canEditPrice = isDesigner || perms.includes('invoices.edit_price_after_save');
  const canEditTax = isDesigner || perms.includes('invoices.edit_tax_after_save');
  const canEditQty = isDesigner || perms.includes('invoices.edit_quantity_after_save');
  const canOverrideMin = isDesigner || perms.includes('prices.override_min_price');

  for (const line of newLines) {
    const oldLine = (oldInvoice.lines || []).find(l => l.itemId === line.itemId);
    const item = memoryItems.find(i => i.id === line.itemId);

    if (oldLine) {
      if (oldLine.salePriceAtSale !== line.salePriceAtSale && !canEditPrice) {
        return { success: false, error: `غير مصرح: لا تملك صلاحية تعديل سعر البيع للصنف "${item?.name || line.itemId}"` };
      }
      if (oldLine.quantity !== line.quantity && !canEditQty) {
        return { success: false, error: `غير مصرح: لا تملك صلاحية تعديل كمية الصنف "${item?.name || line.itemId}"` };
      }
      if (oldLine.taxRateAtSale !== line.taxRateAtSale && !canEditTax) {
        return { success: false, error: `غير مصرح: لا تملك صلاحية تعديل نسبة الضريبة للصنف "${item?.name || line.itemId}"` };
      }
    }

    if (!canOverrideMin && item?.minPrice && Number(line.salePriceAtSale) < item.minPrice) {
      return {
        success: false,
        error: `سعر البيع للصنف "${item.name}" (${line.salePriceAtSale} ج.م) أقل من الحد الأدنى (${item.minPrice} ج.م) بدون صلاحية تجاوز الحد الأدنى`
      };
    }
    // قواعد السعر تُفحص للسطر الجديد أو الذي تغيّر سعره فقط (الفواتير القديمة لا تتعطل)
    if (!canOverrideMin && item && (!oldLine || Number(oldLine.salePriceAtSale) !== Number(line.salePriceAtSale))) {
      const priceRule = priceRuleViolation({ unitPrice: line.salePriceAtSale, purchasePrice: item.purchasePrice, itemName: item.name });
      if (priceRule) return { success: false, error: priceRule.message };
    }
  }

  // 3. إعادة حساب الفاتورة
  const platform: Platform = memoryPlatforms.find(p => p.name === targetPlatformName || p.id === payload.platformId) || {
    id: 'direct',
    name: targetPlatformName,
    discountPercentage: 0,
    pickupFee: 0,
    notes: '',
    status: 'نشطة',
    enableBnpl: false,
    bnplPercentage: 0
  };

  const canEditPosRates = isDesigner || perms.includes('pos.edit_rates');
  const hasBnplPercentOverride = payload.bnplPercentOverride !== undefined && payload.bnplPercentOverride !== null && payload.bnplPercentOverride !== '';
  const hasCommissionPercentOverride = payload.commissionPercentOverride !== undefined && payload.commissionPercentOverride !== null && payload.commissionPercentOverride !== '';
  const hasLegacyDiscountOverride = payload.platformDiscountPercentage !== undefined && payload.platformDiscountPercentage !== null && payload.platformDiscountPercentage !== '' && Number(payload.platformDiscountPercentage) !== Number(platform.discountPercentage || 0);

  if ((hasBnplPercentOverride || hasCommissionPercentOverride || hasLegacyDiscountOverride) && !canEditPosRates) {
    return { success: false, error: 'غير مصرح: لا تملك صلاحية تعديل نسبة BNPL أو نسبة خصم المنصة في نقطة البيع' };
  }

  let bnplPercentOverrideVal: number | undefined = undefined;
  if (hasBnplPercentOverride) {
    const parsedBnpl = Number(payload.bnplPercentOverride);
    if (isNaN(parsedBnpl) || parsedBnpl < 0 || parsedBnpl > 100) {
      return { success: false, error: 'نسبة BNPL يجب أن تكون قيمة رقمية بين 0 و 100' };
    }
    bnplPercentOverrideVal = parsedBnpl;
  }

  let commissionPercentOverrideVal: number | undefined = undefined;
  if (hasCommissionPercentOverride) {
    const parsedComm = Number(payload.commissionPercentOverride);
    if (isNaN(parsedComm) || parsedComm < 0 || parsedComm > 100) {
      return { success: false, error: 'نسبة خصم المنصة يجب أن تكون قيمة رقمية بين 0 و 100' };
    }
    commissionPercentOverrideVal = parsedComm;
  }

  const platformDiscountPercent = commissionPercentOverrideVal !== undefined
    ? commissionPercentOverrideVal
    : (payload.platformDiscountPercentage !== undefined && payload.platformDiscountPercentage !== null && payload.platformDiscountPercentage !== ''
        ? Number(payload.platformDiscountPercentage)
        : (oldInvoice.commissionPercentApplied !== undefined && targetPlatformName === oldInvoice.platform
            ? Number(oldInvoice.commissionPercentApplied)
            : Number(platform.discountPercentage || 0)));

  if (isNaN(platformDiscountPercent) || platformDiscountPercent < 0 || platformDiscountPercent > 100) {
    return { success: false, error: 'نسبة خصم المنصة يجب أن تكون قيمة رقمية بين 0 و 100' };
  }

  const isBnplDisabled = payload.bnplEnabled === false;

  const taxSettings = config.taxSettings || {
    taxInclusive: true,
    platformCommissionOn: 'before_tax'
  };

  let deliveryFee = oldInvoice.deliveryFee || 0;
  if (payload.deliveryFee !== undefined && payload.deliveryFee !== null && payload.deliveryFee !== '') {
    const rawDelivery = Number(payload.deliveryFee);
    if (isNaN(rawDelivery) || rawDelivery < 0) {
      return { success: false, error: 'رسوم التوصيل يجب أن تكون قيمة رقمية موجبة (أكبر من أو تساوي صفر)' };
    }
    deliveryFee = Math.round(rawDelivery * 100) / 100;
  }

  // 3. تحديد المخزن والتحقق المسبق من التوفر قبل أي تعديل على المخزون
  const oldWhId = oldInvoice.warehouseId || getDefaultWarehouse().id;
  const oldWh = getWarehouseById(oldWhId) || getDefaultWarehouse();
  const targetWhRes = resolveWarehouseForOperation(
    payload.warehouseId || oldWh.id,
    session as any,
    {
      fallbackWarehouseId: oldWh.id,
      requireActive: true,
      enforceUserAccess: true
    }
  );
  if (!targetWhRes.ok) {
    return { success: false, error: targetWhRes.error };
  }
  const targetWh = targetWhRes.warehouse;

  const oldQtyByItem = new Map<string, number>();
  for (const oldLine of oldInvoice.lines || []) {
    oldQtyByItem.set(oldLine.itemId, (oldQtyByItem.get(oldLine.itemId) || 0) + Number(oldLine.quantity || 0));
  }
  const newQtyByItem = new Map<string, number>();
  for (const line of newLines) {
    newQtyByItem.set(line.itemId, (newQtyByItem.get(line.itemId) || 0) + Number(line.quantity || 1));
  }

  for (const [itId, reqQty] of newQtyByItem.entries()) {
    const item = memoryItems.find(i => i.id === itId);
    if (!item) {
      return { success: false, error: `الصنف غير موجود: ${itId}` };
    }
    if (item.platformIds && item.platformIds.length > 0 && !item.platformIds.includes(platform.id)) {
      return {
        success: false,
        error: `الصنف "${item.name}" غير متاح للبيع على منصة "${platform.name}"`
      };
    }
    const effectiveAvail =
      getItemWarehouseStock(item.id, targetWh.id) +
      (oldWh.id === targetWh.id ? (oldQtyByItem.get(item.id) || 0) : 0);
    if (!memoryStockSettings.allowNegativeStockSale && effectiveAvail < reqQty) {
      return {
        success: false,
        error: `الكمية غير متوفرة للصنف "${item.name}" في مخزن "${targetWh.name}". المتاح بعد التعديل: ${effectiveAvail}`
      };
    }
  }

  // إرجاع المخزون القديم للفاتورة إلى مخزنه الأصلي
  for (const oldLine of oldInvoice.lines || []) {
    const it = memoryItems.find(i => i.id === oldLine.itemId);
    if (it) {
      const beforeQty = getItemWarehouseStock(it.id, oldWh.id);
      const adj = adjustItemWarehouseDelta(it.id, oldWh.id, oldLine.quantity);
      memoryStockMovements.push({
        id: generateUUID(),
        date: new Date().toISOString(),
        itemId: it.id,
        itemName: it.name,
        warehouseId: oldWh.id,
        warehouseName: oldWh.name,
        documentNumber: invoiceNumber,
        movementType: 'تعديل فاتورة - استرجاع',
        quantity: oldLine.quantity,
        quantityBefore: beforeQty,
        quantityAfter: adj.balanceInWarehouse,
        balanceAfter: adj.balanceInWarehouse,
        notes: `عكس مخزون سابق لتعديل الفاتورة ${invoiceNumber} بمخزن "${oldWh.name}"`,
        userName: session?.name || session?.phone || 'مستخدم النظام'
      });
    }
  }

  // خصم المخزون الجديد من المخزن المحدد
  for (const line of newLines) {
    const item = memoryItems.find(i => i.id === line.itemId);
    if (!item) continue;
    const qty = Number(line.quantity || 1);
    const beforeQty = getItemWarehouseStock(item.id, targetWh.id);
    const adj = adjustItemWarehouseDelta(item.id, targetWh.id, -qty);

    memoryStockMovements.push({
      id: generateUUID(),
      date: new Date().toISOString(),
      itemId: item.id,
      itemName: item.name,
      warehouseId: targetWh.id,
      warehouseName: targetWh.name,
      documentNumber: invoiceNumber,
      movementType: 'تعديل فاتورة - بيع',
      quantity: -qty,
      quantityBefore: beforeQty,
      quantityAfter: adj.balanceInWarehouse,
      balanceAfter: adj.balanceInWarehouse,
      notes: `خصم مخزون جديد بعد تعديل الفاتورة ${invoiceNumber} بمخزن "${targetWh.name}"`,
      userName: session?.name || session?.phone || 'مستخدم النظام'
    });
  }

  const updateCalcResult = calculateInvoice({
    invoiceNumber,
    lines: newLines.map((line: any) => ({
      line,
      item: memoryItems.find(i => i.id === line.itemId)!
    })),
    platform,
    taxSettings,
    deliveryFee,
    bnplEnabled: payload.bnplEnabled,
    bnplPercentOverrideVal,
    platformDiscountPercent,
    preferLineBnplPercent: true
  });

  const calculatedLines: InvoiceLine[] = updateCalcResult.lines;
  const totalBeforeDiscount = updateCalcResult.totalBeforeDiscount;
  const totalBnpl = updateCalcResult.totalBnpl;
  const totalDiscount = updateCalcResult.totalDiscount;
  const totalPickupFee = updateCalcResult.totalPickupFee;
  const totalTax = updateCalcResult.totalTax;
  const netAmount = updateCalcResult.netAmount;
  const totalProfit = updateCalcResult.totalProfit;
  const bnplPercentApplied = updateCalcResult.bnplPercentApplied;
  const commissionPercentApplied = updateCalcResult.commissionPercentApplied;

  // 4. تسوية الخزينة
  const cashboxDiff = netAmount - oldInvoice.netAmount;
  if (Math.abs(cashboxDiff) > 0.001) {
    memoryCashboxEntries.push({
      id: generateUUID(),
      date: new Date().toISOString(),
      documentNumber: invoiceNumber,
      entryType: cashboxDiff > 0 ? 'تعديل فاتورة - قيد جديد' : 'تعديل فاتورة - قيد عكسي',
      cashboxName: oldInvoice.cashboxName || 'الخزينة الرئيسية',
      amount: cashboxDiff,
      platform: platform.name,
      notes: `تسوية فرق تعديل فاتورة ${invoiceNumber}: ${cashboxDiff > 0 ? '+' : ''}${cashboxDiff.toFixed(2)} ج.م (السبب: ${editReason})`,
      userName: session?.name || session?.phone || 'مستخدم النظام'
    });
  }

  const now = new Date().toISOString();
  const editorName = session?.name || session?.phone || 'مستخدم النظام';

  // 5. توثيق سجل تعديل الفاتورة
  const editLogEntry: InvoiceEditLogEntry = {
    id: generateUUID(),
    invoiceNumber,
    editedAt: now,
    userId: session?.phone || 'system',
    userName: editorName,
    editReason,
    beforeSnapshot: oldInvoice,
    afterSnapshot: {
      ...oldInvoice,
      platform: platform.name,
      totalBeforeDiscount,
      bnplTotalAmount: totalBnpl,
      discountAmount: totalDiscount,
      pickupFeeAmount: totalPickupFee,
      deliveryFee,
      taxAmount: totalTax,
      netAmount,
      profit: totalProfit,
      notes: payload.notes !== undefined ? payload.notes : oldInvoice.notes,
      lines: calculatedLines
    },
    changesSummary: `تعديل الفاتورة بواسطة ${editorName}. السبب: ${editReason}. صافي قديم: ${oldInvoice.netAmount} -> صافي جديد: ${netAmount}`
  };
  memoryInvoiceEditLogs.unshift(editLogEntry);

  const canViewProfit = isDesigner || perms.includes('reports.view_profit');
  const canViewPurchase = isDesigner || perms.includes('prices.view_purchase');

  const updatedInvoice: Invoice = {
    ...oldInvoice,
    platform: platform.name,
    warehouseId: targetWh.id,
    warehouseName: targetWh.name,
    totalBeforeDiscount,
    bnplTotalAmount: totalBnpl,
    bnplEnabled: !isBnplDisabled && (Boolean(payload.bnplEnabled) || totalBnpl > 0 || Boolean(platform.enableBnpl)),
    bnplPercentApplied,
    commissionPercentApplied,
    discountAmount: totalDiscount,
    pickupFeeAmount: totalPickupFee,
    deliveryFee,
    taxAmount: totalTax,
    netAmount,
    profit: canViewProfit ? totalProfit : undefined,
    notes: payload.notes !== undefined ? payload.notes : oldInvoice.notes,
    status: oldInvoice.status || 'تم البيع',
    lines: calculatedLines.map(cl => ({
      ...cl,
      purchasePriceAtSale: canViewPurchase ? cl.purchasePriceAtSale : undefined,
      packagingCostAtSale: canViewPurchase ? cl.packagingCostAtSale : undefined,
      unitProfit: canViewProfit ? cl.unitProfit : undefined
    }))
  };

  memoryInvoices[existingIdx] = updatedInvoice;
  recordAuditLog(session || {}, 'INVOICE_EDIT', 'Invoice', invoiceNumber, `تعديل فاتورة ${invoiceNumber}. السبب: ${editReason}`);

  return { success: true, invoice: updatedInvoice };
}

// ===================== صور الأصناف بالجملة (استيراد الأصناف بالصور / تعديل الصور بالإكسيل) =====================

/** هل الرابط مستخدم كصورة في أي مكان في البيانات؟ (الأصناف، شعار الشركة، صورة رأس الفاتورة) */
export function isImageUrlReferenced(url: string, except?: { itemId?: string }): boolean {
  const target = String(url || '').trim();
  if (!target) return false;
  if (memoryItems.some(it => it.id !== except?.itemId && String(it.imageUrl || '').trim() === target)) return true;
  if (String((memoryCompanySettings as any)?.logoUrl || '').trim() === target) return true;
  if (String((memoryInvoicePrintSettings as any)?.headerImageUrl || '').trim() === target) return true;
  return false;
}

/**
 * يحدد الصنف من «الباركود الرئيسي» أولًا، ثم من «اسم الصنف» (الأسماء لا تتكرر).
 * الاسم يُقبل فقط لو مطابق لصنف واحد.
 */
export function findItemForImageKey(rawKey: unknown): { item?: Item; error?: string } {
  const key = String(rawKey ?? '').trim();
  if (!key) return { error: 'الصنف فاضي' };
  const barcode = normalizeItemBarcode(key);
  if (barcode) {
    const byBarcode = memoryItems.filter(it => normalizeItemBarcode(it.barcode) === barcode);
    if (byBarcode.length === 1) return { item: byBarcode[0] };
    if (byBarcode.length > 1) return { error: `الباركود «${key}» لأكتر من صنف` };
  }
  const nameKey = normalizeArabicText(key).replace(/\s+/g, ' ').trim().toLowerCase();
  const byName = memoryItems.filter(it => normalizeArabicText(String(it.name || '')).replace(/\s+/g, ' ').trim().toLowerCase() === nameKey);
  if (byName.length === 1) return { item: byName[0] };
  if (byName.length > 1) return { error: `الاسم «${key}» لأكتر من صنف` };
  return { error: `مفيش صنف بالباركود أو الاسم «${key}»` };
}

export interface ItemImageEntryResult {
  key: string;
  status: 'updated' | 'skipped' | 'error';
  itemId?: string;
  itemName?: string;
  error?: string;
  /** الرابط القديم اللي اتشال (علشان السيرفر يمسح ملفه لو مش مستخدم في مكان تاني) */
  oldUrl?: string;
}

/**
 * يربط صور مرفوعة بالفعل (روابط من تخزين الصور بتاعنا) بالأصناف.
 * replace = false: الصنف اللي ليه صورة يفضل بصورته. replace = true: الصورة الجديدة تحل مكان القديمة.
 * isOurUrl: يتأكد إن الرابط من تخزين الصور بتاعنا (ممنوع روابط مواقع تانية).
 */
export function setItemImages(
  entries: unknown,
  options: { replace: boolean; isOurUrl: (url: string) => boolean },
  session?: { name?: string; phone?: string }
): { success: boolean; error?: string; statusCode?: number; results?: ItemImageEntryResult[]; updated?: number; skipped?: number; failed?: number } {
  if (!Array.isArray(entries) || entries.length === 0) return { success: false, statusCode: 400, error: 'مفيش صور للحفظ' };
  if (entries.length > 100) return { success: false, statusCode: 400, error: 'أقصى عدد في الطلب الواحد 100 صورة' };
  const userName = session?.name || session?.phone || 'مستخدم';
  const now = new Date().toISOString();
  const results: ItemImageEntryResult[] = [];
  for (const raw of entries as any[]) {
    const key = String(raw?.key ?? '').trim();
    const url = String(raw?.url ?? '').trim();
    if (!url || !options.isOurUrl(url)) {
      results.push({ key, status: 'error', error: 'الصورة لازم تكون مرفوعة على سيرفر البرنامج' });
      continue;
    }
    const found = findItemForImageKey(key);
    if (!found.item) {
      results.push({ key, status: 'error', error: found.error });
      continue;
    }
    const item = found.item;
    const oldUrl = String(item.imageUrl || '').trim();
    if (oldUrl === url) {
      results.push({ key, status: 'skipped', itemId: item.id, itemName: item.name });
      continue;
    }
    if (oldUrl && !options.replace) {
      results.push({ key, status: 'skipped', itemId: item.id, itemName: item.name });
      continue;
    }
    item.imageUrl = url;
    (item as any).updatedAt = now;
    memoryItemChangeLogs.push({
      id: generateUUID(),
      itemId: item.id,
      itemName: item.name,
      fieldName: 'صورة الصنف',
      oldValue: oldUrl || 'فارغ',
      newValue: url,
      userName,
      timestamp: now,
      reason: 'استيراد الصور'
    });
    results.push({ key, status: 'updated', itemId: item.id, itemName: item.name, ...(oldUrl ? { oldUrl } : {}) });
  }
  return {
    success: true,
    results,
    updated: results.filter(r => r.status === 'updated').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    failed: results.filter(r => r.status === 'error').length
  };
}

/** هل رقم الفاتورة مستخدم في فاتورة بيع محفوظة؟ (لمعاينة رقم الفاتورة الجاية في إعدادات الترقيم) */
export function isInvoiceNumberUsed(invoiceNumber: string): boolean {
  return memoryInvoices.some(inv => inv.invoiceNumber === invoiceNumber);
}

/**
 * تعديل «رقم طلب المنصة» لفاتورة منصة محفوظة (تصحيح رقم اتكتب غلط أو إضافته بعد الحفظ).
 * بصلاحية تعديل الفواتير بعد الحفظ، والسبب إلزامي، والتكرار حسب إعدادات الترقيم.
 */
export function setInvoicePlatformOrderId(
  invoiceNumber: string,
  payload: any,
  session?: { role: UserRole; permissions: PermissionKey[]; name?: string; phone?: string }
): { success: boolean; invoice?: Invoice; error?: string; code?: string; statusCode?: number } {
  const isDesigner = session?.role === 'designer';
  if (!isDesigner && !(session?.permissions || []).includes('invoices.edit_after_save')) {
    return { success: false, statusCode: 403, error: 'غير مصرح: لا تملك صلاحية تعديل الفواتير بعد الحفظ' };
  }
  const reason = String(payload?.reason || payload?.editReason || '').trim();
  if (!reason) return { success: false, statusCode: 400, error: 'سبب التعديل إلزامي' };
  const idx = memoryInvoices.findIndex(inv => inv.invoiceNumber === invoiceNumber);
  if (idx === -1) return { success: false, statusCode: 404, error: `الفاتورة ${invoiceNumber} غير موجودة` };
  const invoice = memoryInvoices[idx];
  if (invoice.status === 'ملغاة') return { success: false, statusCode: 400, error: 'الفاتورة ملغاة' };
  if (invoice.platform === DIRECT_SALE_PLATFORM_NAME) return { success: false, statusCode: 400, error: 'رقم طلب المنصة لفواتير المنصات فقط' };
  const orderId = normalizePlatformOrderId(payload?.platformOrderId);
  if (orderId.length > MAX_PLATFORM_ORDER_LENGTH) return { success: false, statusCode: 400, error: `رقم طلب المنصة طويل: حتى ${MAX_PLATFORM_ORDER_LENGTH} حرفًا` };
  if (orderId && getInvoiceNumberingSettings().platformOrderDuplicates === 'block') {
    const duplicate = findPlatformOrderDuplicate(memoryInvoices, { platformId: invoice.platformId, platformName: invoice.platform, orderId, exceptInvoiceNumber: invoiceNumber });
    if (duplicate) {
      return { success: false, statusCode: 409, code: 'PLATFORM_ORDER_DUPLICATE', error: `رقم طلب المنصة «${orderId}» متسجل قبل كده على ${invoice.platform} في الفاتورة ${duplicate.invoiceNumber}` };
    }
  }
  const before = String((invoice as any).platformOrderId || '');
  const updated: Invoice = { ...invoice };
  if (orderId) (updated as any).platformOrderId = orderId;
  else delete (updated as any).platformOrderId;
  memoryInvoices[idx] = updated;
  recordAuditLog(session || {}, 'INVOICE_PLATFORM_ORDER_EDIT', 'Invoice', invoiceNumber, `رقم طلب المنصة للفاتورة ${invoiceNumber}: «${before || 'فاضي'}» ← «${orderId || 'فاضي'}». السبب: ${reason}`);
  return { success: true, invoice: updated };
}

/**
 * جلب سجلات تعديل الفواتير
 */
export async function getInvoiceEditLogs(invoiceNumber?: string): Promise<InvoiceEditLogEntry[]> {
  if (isSheetsDataMode()) {
    return [];
  }
  if (invoiceNumber) {
    return memoryInvoiceEditLogs.filter(l => l.invoiceNumber === invoiceNumber);
  }
  return memoryInvoiceEditLogs;
}

/**
 * حفظ إعدادات الضريبة والعمولات
 */
export async function saveTaxSettings(
  settings: Partial<TaxSettings>,
  session?: { token?: string; role: UserRole; permissions: PermissionKey[] }
): Promise<{ success: boolean; taxSettings?: TaxSettings; error?: string; code?: string; statusCode?: number }> {
  const config = getSystemConfig();
  const candidate: TaxSettings = {
    taxInclusive: settings.taxInclusive !== undefined ? Boolean(settings.taxInclusive) : config.taxSettings.taxInclusive,
    platformCommissionOn:
      settings.platformCommissionOn === 'before_tax' || settings.platformCommissionOn === 'after_tax'
        ? settings.platformCommissionOn
        : config.taxSettings.platformCommissionOn
  };

  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('saveSettings', { taxSettings: candidate }, session?.token);
    if (!res?.success) {
      const failure = buildSheetsWriteFailure(res, 'تعذر حفظ إعدادات الضريبة في Google Sheets');
      return {
        ...failure,
        statusCode: res?.isTimeout ? 504 : (res?.isTransportError ? 503 : (res?.statusCode || 400))
      };
    }
  }

  const updated = setTaxSettings(candidate);
  recordAuditLog(session || {}, 'SETTINGS_TAX_UPDATE', 'Settings', 'taxSettings', `تحديث إعدادات الضريبة: شاملة=${updated.taxInclusive}, احتساب العمولة=${updated.platformCommissionOn}`);
  return { success: true, taxSettings: updated };
}

/**
 * جلب الفواتير مع حجب الأرباح عن غير المخوّل
 */
export async function getInvoices(
  session?: { token?: string; role: UserRole; permissions: PermissionKey[] },
  filters?: { from?: string | null; to?: string | null }
): Promise<Invoice[]> {
  const config = getSystemConfig();
  const canViewProfit = session?.role === 'designer' || session?.permissions?.includes('reports.view_profit');
  const canViewPurchase = session?.role === 'designer' || session?.permissions?.includes('prices.view_purchase');
  const canViewPackaging = session?.role === 'designer' || session?.permissions?.includes('prices.view_packaging');
  const permBucket = `${Boolean(canViewPurchase)}:${Boolean(canViewPackaging)}:${Boolean(canViewProfit)}`;
  const rangeKey = filters?.from || filters?.to ? `${filters?.from || ''}_${filters?.to || ''}` : 'all';
  const cacheKey = `invoices:${rangeKey}:${permBucket}`;

  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getInvoices', { from: filters?.from, to: filters?.to }, session?.token);
    if (res.success && res.data && Array.isArray(res.data.invoices)) {
      setSheetsCache(cacheKey, res.data.invoices);
      return res.data.invoices;
    }
    const cachedExact = getSheetsCache<Invoice[]>(cacheKey);
    if (cachedExact) {
      return markArrayStale(cachedExact.data, cachedExact.lastSyncAt);
    }
    if (rangeKey !== 'all') {
      const cachedAll = getSheetsCache<Invoice[]>(`invoices:all:${permBucket}`);
      if (cachedAll) {
        const filtered = cachedAll.data.filter(inv => isDateInRange(inv.date, filters?.from || null, filters?.to || null));
        return markArrayStale(filtered, cachedAll.lastSyncAt);
      }
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب الفواتير من Google Sheets');
  }

  let list = memoryInvoices;
  if (filters?.from || filters?.to) {
    list = list.filter(inv => isDateInRange(inv.date, filters.from, filters.to));
  }

  return list.map(inv => ({
    ...inv,
    profit: canViewProfit ? inv.profit : undefined,
    lines: (inv.lines || []).map(l => ({
      ...l,
      purchasePriceAtSale: canViewPurchase ? l.purchasePriceAtSale : undefined,
      packagingCostAtSale: canViewPurchase ? l.packagingCostAtSale : undefined,
      unitProfit: canViewProfit ? l.unitProfit : undefined
    }))
  }));
}

/**
 * تسجيل مرتجع
 */
export async function createReturn(
  returnPayload: any,
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string },
  /** من التوصيل بس: «رجع المحل» أو «اتلغى». noCustomerEffect = الدفع عند الاستلام (العميل ما اتقيدش عليه حاجة) */
  internal?: { fromDelivery: true; noCustomerEffect: boolean }
): Promise<{ success: boolean; duplicate?: boolean; statusCode?: number; returnRecord?: ReturnRecord; error?: string; code?: string }> {
  const idemKey = getValidatedIdempotencyKey(returnPayload?.idempotencyKey);
  if (!idemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR };
  }

  const cached = getIdempotencyCachedResult('createReturn', idemKey);
  if (cached) {
    return { success: true, duplicate: true, returnRecord: cached };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('createReturn', { ...returnPayload, idempotencyKey: idemKey }, session?.token);
    const resolvedReturn: ReturnRecord | undefined = res.returnRecord || (res.success && res.returnNumber ? {
      returnNumber: res.returnNumber,
      invoiceNumber: returnPayload.invoiceNumber,
      date: new Date().toISOString(),
      returnedItemsSummary: '',
      totalReturnShippingDeduction: 0,
      returnReason: returnPayload.returnReason || 'مرتجع مبيعات',
      notes: returnPayload.notes || '',
      createdBy: session?.name || session?.phone || returnPayload.createdBy || 'المسؤول',
      idempotencyKey: idemKey,
      lines: returnPayload.lines || []
    } : undefined);
    if (res.success && resolvedReturn) {
      setIdempotencyCachedResult('createReturn', idemKey, resolvedReturn);
      return { success: true, returnRecord: resolvedReturn, ...(res.duplicate ? { duplicate: true } : {}) };
    }
    return buildSheetsWriteFailure(res, 'تعذر حفظ المرتجع في Google Sheets');
  }

  const existingRet = memoryReturns.find(r => r.idempotencyKey === idemKey);
  if (existingRet) {
    setIdempotencyCachedResult('createReturn', idemKey, existingRet);
    return { success: true, duplicate: true, returnRecord: existingRet };
  }

  const invoiceNumber = returnPayload.invoiceNumber;
  if (!invoiceNumber) {
    return { success: false, error: 'رقم الفاتورة الأصلية مطلوب لتسجيل المرتجع' };
  }

  const inv = memoryInvoices.find(i => i.invoiceNumber === invoiceNumber);
  if (!inv) {
    return { success: false, error: `الفاتورة الأصلية ${invoiceNumber} غير موجودة بالنظام` };
  }

  if (inv.status === 'ملغاة') {
    return { success: false, error: 'لا يمكن عمل مرتجع لفاتورة ملغاة' };
  }

  if (!internal?.fromDelivery) {
    const deliveryOrder = findOrderForInvoice(invoiceNumber);
    if (deliveryOrder && (findOpenOrderForInvoice(invoiceNumber) || (deliveryOrder.status === 'اتسلم' && deliveryOrder.paymentMode === 'cod' && !deliveryOrder.settlementId))) {
      return {
        success: false,
        code: 'DELIVERY_INVOICE',
        error: deliveryOrder.status === 'اتسلم'
          ? 'دي فاتورة توصيل لسه فلوسها ما اتسوتش: سوّي الطلب من شاشة التوصيل الأول'
          : 'دي فاتورة توصيل لسه مفتوحة: لو ما اتسلمتش رجّعها من شاشة التوصيل («رجع المحل»)'
      };
    }
  }

  const lines = returnPayload.lines || [];
  if (lines.length === 0) {
    return { success: false, error: 'يجب اختيار صنف واحد على الأقل للمرتجع' };
  }

  // تحديد مخزن المرتجع (من الطلب أو مخزن الفاتورة الأصلية)
  const explicitReturnWh = returnPayload.warehouseId ? String(returnPayload.warehouseId).trim() : undefined;
  const fallbackReturnWhId = inv.warehouseId || getDefaultWarehouse().id;
  const returnWhRes = resolveWarehouseForOperation(explicitReturnWh || inv.warehouseId, session as any, {
    fallbackWarehouseId: fallbackReturnWhId,
    requireActive: Boolean(explicitReturnWh),
    enforceUserAccess: true,
    allowFallbackWhenOmitted: !explicitReturnWh
  });
  if (!returnWhRes.ok) {
    return { success: false, statusCode: returnWhRes.statusCode, error: returnWhRes.error };
  }
  const returnTargetWh = returnWhRes.warehouse;

  // 1. حساب المرتجعات السابقة على هذه الفاتورة لمنع إرجاع أكثر من المباع
  const existingReturns = memoryReturns.filter(r => r.invoiceNumber === invoiceNumber);
  const previouslyReturnedMap: Record<string, number> = {};
  for (const prevRet of existingReturns) {
    for (const prevLine of (prevRet.lines || [])) {
      previouslyReturnedMap[prevLine.itemId] = (previouslyReturnedMap[prevLine.itemId] || 0) + Number(prevLine.returnedQuantity || 0);
    }
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const returnNumber = returnPayload.returnNumber || `RET-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

  let totalDeduction = 0;
  let totalNetReturnValue = 0;
  const itemsSummary: string[] = [];
  const calculatedReturnLines: ReturnLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const qty = Number(line.returnedQuantity || 1);
    if (qty <= 0) continue;

    const originalSoldLine = (inv.lines || []).find(l => l.itemId === line.itemId);
    const soldQty = originalSoldLine ? originalSoldLine.quantity : 0;
    const prevReturned = previouslyReturnedMap[line.itemId] || 0;
    const maxReturnable = Math.max(0, soldQty - prevReturned);

    if (qty > maxReturnable) {
      const itName = line.itemName || originalSoldLine?.itemNameAtSale || line.itemId;
      return {
        success: false,
        error: `الكمية المرتجعة للصنف "${itName}" (${qty}) تتجاوز الكمية المتبقية المتاحة للإرجاع (${maxReturnable}) بعد احتساب المرتجعات السابقة`
      };
    }

    const deduction = Number(line.returnShippingDeductionPerUnit || 0);
    const lineDeduction = qty * deduction;
    totalDeduction += lineDeduction;

    // حساب القيمة الصافية للسطر المرتجع
    const unitNetAtSale = originalSoldLine ? originalSoldLine.unitNet : 0;
    const lineNetVal = Math.max(0, (unitNetAtSale * qty) - lineDeduction);
    totalNetReturnValue += lineNetVal;

    const condition = line.itemCondition === 'تالف' ? 'تالف' : 'يرجع المخزن';
    const item = memoryItems.find(it => it.id === line.itemId);

    if (item && condition === 'يرجع المخزن') {
      const beforeQty = getItemWarehouseStock(item.id, returnTargetWh.id);
      const adj = adjustItemWarehouseDelta(item.id, returnTargetWh.id, qty);
      // تسجيل حركة استعادة مخزن رسمية على المخزن المحدد
      memoryStockMovements.push({
        id: generateUUID(),
        date: now.toISOString(),
        itemId: item.id,
        itemName: item.name,
        warehouseId: returnTargetWh.id,
        warehouseName: returnTargetWh.name,
        movementType: 'مرتجع',
        documentNumber: returnNumber,
        quantity: qty,
        quantityBefore: beforeQty,
        quantityAfter: adj.balanceInWarehouse,
        balanceAfter: adj.balanceInWarehouse,
        notes: `مرتجع مبيعات فاتورة ${invoiceNumber} بمخزن "${returnTargetWh.name}" (صنف سليم)`,
        userName: session?.name || session?.phone || returnPayload.createdBy || 'المسؤول'
      });
    }

    itemsSummary.push(`${line.itemName || item?.name || 'صنف'} (${qty}) [${condition}]`);

    calculatedReturnLines.push({
      returnNumber,
      invoiceNumber,
      invoiceLineIndex: i + 1,
      itemId: line.itemId,
      returnedQuantity: qty,
      returnShippingDeductionPerUnit: deduction,
      totalLineReturnShippingDeduction: lineDeduction,
      itemCondition: condition
    });
  }

  if (calculatedReturnLines.length === 0) {
    return { success: false, error: 'يرجى تحديد كميات موجبة للأصناف المرتجعة' };
  }

  // 2. المعالجة المالية للمرتجع
  const refundStatus: 'قيد على الحساب' | 'استرداد نقدي' = returnPayload.refundStatus || (returnPayload.cashboxId ? 'استرداد نقدي' : 'قيد على الحساب');
  const customer = memoryCustomers.find(c => c.id === inv.customerId || c.name === inv.customerName);
  let selectedCashbox: Cashbox | undefined = undefined;

  if (refundStatus === 'استرداد نقدي') {
    if (session?.role !== 'designer') {
      const callerUser = memoryUsers.find(u => u.phone === session?.phone || u.id === (session as any)?.userId);
      if (callerUser?.cashboxConfig?.allowedReturnCashboxIds && callerUser.cashboxConfig.allowedReturnCashboxIds.length > 0) {
        const reqCbId = returnPayload.cashboxId || (inv.cashboxId) || callerUser.cashboxConfig.defaultReturnCashboxId;
        if (!reqCbId || !callerUser.cashboxConfig.allowedReturnCashboxIds.includes(reqCbId)) {
          return { success: false, error: 'غير مصرح: الخزينة المحددة غير مخصصة لك لعمليات المرتجعات' };
        }
        returnPayload.cashboxId = reqCbId;
      }
    }
    const cashboxId = returnPayload.cashboxId || (inv.cashboxId);
    selectedCashbox = memoryCashboxes.find(c => c.id === cashboxId || c.name === returnPayload.cashboxName);
    if (!selectedCashbox) {
      return { success: false, error: 'يرجى تحديد الخزينة التي تم صرف مبلغ المرتجع النقدي منها' };
    }
    const refundAmount = Number(returnPayload.refundedAmount !== undefined ? returnPayload.refundedAmount : totalNetReturnValue);
    if (selectedCashbox.currentBalance < refundAmount) {
      return {
        success: false,
        error: `رصيد الخزينة "${selectedCashbox.name}" (${selectedCashbox.currentBalance} ج.م) لا يكفي لصرف المرتجع النقدي (${refundAmount} ج.م)`
      };
    }

    selectedCashbox.currentBalance -= refundAmount;
    memoryCashboxTransactions.push({
      id: generateUUID(),
      date: now.toISOString(),
      cashboxId: selectedCashbox.id,
      cashboxName: selectedCashbox.name,
      type: 'مرتجع مبيعات',
      documentNumber: returnNumber,
      amount: -refundAmount,
      balanceAfter: selectedCashbox.currentBalance,
      party: customer ? customer.name : inv.platform,
      statement: `صرف نقدي لمرتجع مبيعات ${returnNumber} للفاتورة ${invoiceNumber}`,
      userName: session?.name || session?.phone || returnPayload.createdBy || 'المسؤول'
    });

    memoryCashboxEntries.push({
      id: generateUUID(),
      date: now.toISOString(),
      documentNumber: returnNumber,
      entryType: 'مرتجع',
      cashboxName: selectedCashbox.name,
      amount: -refundAmount,
      platform: inv.platform,
      notes: `صرف مرتجع ${returnNumber}`,
      userName: returnPayload.createdBy || 'المسؤول'
    });

    if (customer) {
      // إثبات المرتجع واسترداده نقدياً في كشف الحساب
      memoryCustomerLedger.push({
        id: generateUUID(),
        date: now.toISOString(),
        customerId: customer.id,
        customerName: customer.name,
        transactionType: 'مرتجع بيع',
        documentNumber: returnNumber,
        debit: 0,
        credit: refundAmount,
        balanceAfter: customer.currentBalance - refundAmount,
        statement: `مرتجع مبيعات ${returnNumber} للفاتورة ${invoiceNumber}`,
        userName: session?.name || session?.phone || returnPayload.createdBy || 'المسؤول',
        notes: returnPayload.notes
      });
      memoryCustomerLedger.push({
        id: generateUUID(),
        date: now.toISOString(),
        customerId: customer.id,
        customerName: customer.name,
        transactionType: 'سند صرف',
        documentNumber: returnNumber,
        debit: refundAmount,
        credit: 0,
        balanceAfter: customer.currentBalance,
        statement: `صرف نقدي فوري لقيمة مرتجع ${returnNumber} من ${selectedCashbox.name}`,
        userName: session?.name || session?.phone || returnPayload.createdBy || 'المسؤول',
        notes: returnPayload.notes
      });
    }
  } else {
    // قيد على الحساب / تخفيض مديونية العميل (الدفع عند الاستلام: العميل ما اتقيدش عليه حاجة)
    if (customer && !internal?.noCustomerEffect) {
      customer.currentBalance = Math.max(0, customer.currentBalance - totalNetReturnValue);
      memoryCustomerLedger.push({
        id: generateUUID(),
        date: now.toISOString(),
        customerId: customer.id,
        customerName: customer.name,
        transactionType: 'مرتجع بيع',
        documentNumber: returnNumber,
        debit: 0,
        credit: totalNetReturnValue,
        balanceAfter: customer.currentBalance,
        statement: `تخفيض مديونية لمرتجع مبيعات رقم ${returnNumber} للفاتورة ${invoiceNumber}`,
        userName: session?.name || session?.phone || returnPayload.createdBy || 'المسؤول',
        notes: returnPayload.notes
      });
    }
  }

  // 3. تحديث حالة الفاتورة
  // حساب إجمالي الكميات المرتجعة التراكمية بعد هذا المرتجع
  const totalSoldInInvoice = (inv.lines || []).reduce((s, l) => s + l.quantity, 0);
  let totalReturnedInInvoice = 0;
  for (const prevRet of existingReturns) {
    for (const pl of (prevRet.lines || [])) {
      totalReturnedInInvoice += Number(pl.returnedQuantity || 0);
    }
  }
  for (const curLine of calculatedReturnLines) {
    totalReturnedInInvoice += curLine.returnedQuantity;
  }

  inv.status = totalReturnedInInvoice >= totalSoldInInvoice ? 'مرتجع' : 'مرتجع جزئي';

  const newReturn: ReturnRecord = {
    returnNumber,
    invoiceNumber,
    date: now.toISOString(),
    warehouseId: returnTargetWh.id,
    warehouseName: returnTargetWh.name,
    returnedItemsSummary: itemsSummary.join('، '),
    totalReturnShippingDeduction: totalDeduction,
    refundStatus,
    cashboxId: selectedCashbox?.id,
    cashboxName: selectedCashbox?.name,
    refundedAmount: refundStatus === 'استرداد نقدي' ? (returnPayload.refundedAmount || totalNetReturnValue) : undefined,
    idempotencyKey: returnPayload.idempotencyKey,
    returnReason: returnPayload.returnReason || 'مرتجع مبيعات',
    notes: returnPayload.notes || '',
    createdBy: session?.name || session?.phone || returnPayload.createdBy || 'المسؤول',
    lines: calculatedReturnLines
  };

  newReturn.idempotencyKey = idemKey;
  memoryReturns.unshift(newReturn);
  setIdempotencyCachedResult('createReturn', idemKey, newReturn);

  recordAuditLog(
    session || {},
    'RETURN_CREATE',
    'Return',
    returnNumber,
    `تسجيل مرتجع مبيعات ${returnNumber} للفاتورة ${invoiceNumber} (قيمة صافية: ${totalNetReturnValue} EGP, تسوية: ${refundStatus})`
  );

  return { success: true, returnRecord: newReturn };
}

/**
 * جلب المرتجعات
 */
export async function getReturns(
  session?: { token?: string },
  filters?: { from?: string | null; to?: string | null }
): Promise<ReturnRecord[]> {
  const config = getSystemConfig();
  const rangeKey = filters?.from || filters?.to ? `${filters?.from || ''}_${filters?.to || ''}` : 'all';
  const cacheKey = `returns:${rangeKey}`;
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getReturns', { from: filters?.from, to: filters?.to }, session?.token);
    if (res.success && res.data && Array.isArray(res.data.returns)) {
      setSheetsCache(cacheKey, res.data.returns);
      return res.data.returns;
    }
    const cachedExact = getSheetsCache<ReturnRecord[]>(cacheKey);
    if (cachedExact) {
      return markArrayStale(cachedExact.data, cachedExact.lastSyncAt);
    }
    if (rangeKey !== 'all') {
      const cachedAll = getSheetsCache<ReturnRecord[]>('returns:all');
      if (cachedAll) {
        return markArrayStale(
          cachedAll.data.filter(ret => isDateInRange(ret.date, filters?.from || null, filters?.to || null)),
          cachedAll.lastSyncAt
        );
      }
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب المرتجعات من Google Sheets');
  }
  if (filters?.from || filters?.to) {
    return memoryReturns.filter(ret => isDateInRange(ret.date, filters.from, filters.to));
  }
  return memoryReturns;
}

/**
 * جلب المستخدمين (مع حجب كلمات المرور)
 */
export async function getUsers(session?: { token?: string }): Promise<UserAccount[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getUsers', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache('users', res.data);
      return res.data;
    }
    const cached = getSheetsCache<UserAccount[]>('users');
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب قائمة المستخدمين من Google Sheets');
  }

  ensureDefaultUsersIfEmpty();

  return memoryUsers.map(u => ({
    id: u.id,
    username: u.username,
    phone: u.phone,
    name: u.name,
    role: u.role,
    status: u.status,
    permissions: u.role === 'designer' ? ALL_PERMISSIONS.map(p => p.key) : (u.permissions || ROLE_TEMPLATES[u.role] || []),
    isOwner: u.role === 'designer' || Boolean(u.isOwner),
    mustChangePassword: Boolean(u.mustChangePassword),
    createdAt: u.createdAt,
    cashboxConfig: u.cashboxConfig,
    warehouseConfig: u.warehouseConfig,
    offlineVerifier: u.offlineVerifier,
    offlineSalt: u.offlineSalt,
    offlineIterations: u.offlineIterations,
    permissionsUpdatedAt: u.permissionsUpdatedAt || u.createdAt,
    permissionsUpdatedByDevice: u.permissionsUpdatedByDevice
  }));
}

/**
 * استكمال إعداد الحساب عند أول دخول (عندما يكون mustChangePassword = true):
 * - تعديل الاسم الظاهر واسم المستخدم (مع التحقق من عدم التكرار)
 * - تعيين كلمة سر جديدة (حرفان أو رقمان على الأقل، ولا تساوي كلمة السر المؤقتة)
 * - تحويل mustChangePassword إلى false
 */
export async function completeInitialAccountSetup(
  userId: string,
  payload: { name: string; username: string; newPassword: string },
  session?: { token?: string; role?: UserRole; phone?: string; username?: string; name?: string }
): Promise<{ success: boolean; user?: UserAccount; error?: string; code?: string }> {
  const cleanName = String(payload.name || '').trim();
  const rawUsername = String(payload.username || '').trim();
  const normUser = normalizeUsername(rawUsername);
  const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : String(payload.newPassword ?? '');

  if (!cleanName || cleanName.length < 2) {
    return { success: false, error: 'الاسم الظاهر مطلوب ويجب أن يتكون من حرفين على الأقل' };
  }
  if (!rawUsername) {
    return { success: false, error: 'اسم المستخدم مطلوب' };
  }
  if (!isValidUsernameFormat(normUser)) {
    return {
      success: false,
      error: 'اسم المستخدم غير صالح. يقبل حروفاً عربية أو إنجليزية أو أرقاماً بين 2 و 40 خانة.'
    };
  }

  const pwdCheck = validatePasswordRules(newPassword);
  if (!pwdCheck.valid) {
    return { success: false, error: pwdCheck.error };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const offlineVer = computeOfflinePasswordVerifier(newPassword);
    const res = await callAppsScript(
      'completeInitialAccountSetup',
      {
        userId,
        name: cleanName,
        username: rawUsername,
        newPassword,
        ...offlineVer
      },
      session?.token
    );
    if (res.success && res.user) {
      return {
        success: true,
        user: {
          ...res.user,
          mustChangePassword: false,
          ...offlineVer
        }
      };
    }
    return buildSheetsWriteFailure(res, 'تعذر استكمال إعداد الحساب في Google Sheets');
  }

  const userIdx = memoryUsers.findIndex(u => u.id === userId);
  if (userIdx === -1) {
    return { success: false, error: 'المستخدم غير موجود' };
  }

  const currentUser = memoryUsers[userIdx];

  // التأكد أن كلمة السر الجديدة لا تطابق كلمة السر المؤقتة الحالية للحساب
  const sameAsCurrentHash = hashPassword(newPassword, currentUser.salt) === currentUser.passwordHash;
  if (sameAsCurrentHash && currentUser.mustChangePassword) {
    return { success: false, error: 'لا يمكن استخدام كلمة السر المؤقتة الحالية؛ يرجى اختيار كلمة سر جديدة' };
  }

  // التحقق من عدم تكرار اسم المستخدم مع مستخدم آخر
  const duplicate = memoryUsers.find(
    u => u.id !== userId && (u.normalizedUsername === normUser || normalizeUsername(u.username) === normUser)
  );
  if (duplicate) {
    return { success: false, error: `اسم المستخدم "${rawUsername}" مستخدم بالفعل لحساب آخر` };
  }

  const newSalt = generateSalt();
  const newPasswordHash = hashPassword(newPassword, newSalt);
  const offlineVer = computeOfflinePasswordVerifier(newPassword);

  currentUser.name = cleanName;
  currentUser.username = rawUsername;
  currentUser.normalizedUsername = normUser;
  currentUser.salt = newSalt;
  currentUser.passwordHash = newPasswordHash;
  currentUser.mustChangePassword = false;
  currentUser.offlineVerifier = offlineVer.offlineVerifier;
  currentUser.offlineSalt = offlineVer.offlineSalt;
  currentUser.offlineIterations = offlineVer.offlineIterations;

  // تحديث اسم المستخدم في جدول تخصيص الخزائن إن وجد
  for (const a of memoryUserCashboxAssignments) {
    if (a.userId === userId) {
      a.userName = cleanName;
    }
  }

  recordAuditLog(
    { id: currentUser.id, name: currentUser.name, role: currentUser.role, phone: currentUser.phone },
    'USER_INITIAL_SETUP',
    'User',
    currentUser.id,
    `استكمال إعداد الحساب عند أول دخول وتغيير كلمة السر المؤقتة للمستخدم: ${currentUser.username}`
  );

  const permissions =
    currentUser.role === 'designer'
      ? ALL_PERMISSIONS.map(p => p.key)
      : (currentUser.permissions || ROLE_TEMPLATES[currentUser.role] || []);

  return {
    success: true,
    user: {
      id: currentUser.id,
      username: currentUser.username,
      phone: currentUser.phone,
      name: currentUser.name,
      role: currentUser.role,
      status: currentUser.status,
      permissions,
      isOwner: currentUser.role === 'designer' || Boolean(currentUser.isOwner),
      mustChangePassword: false,
      createdAt: currentUser.createdAt,
      cashboxConfig: currentUser.cashboxConfig,
      warehouseConfig: currentUser.warehouseConfig,
      offlineVerifier: currentUser.offlineVerifier,
      offlineSalt: currentUser.offlineSalt,
      offlineIterations: currentUser.offlineIterations,
      permissionsUpdatedAt: currentUser.permissionsUpdatedAt || currentUser.createdAt,
      permissionsUpdatedByDevice: currentUser.permissionsUpdatedByDevice
    }
  };
}

/**
 * تغيير كلمة السر الشخصية للمستخدم المسجل دخوله حالياً
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  session?: { token?: string; role?: UserRole; phone?: string; username?: string; name?: string }
): Promise<{ success: boolean; error?: string; code?: string }> {
  const pwdCheck = validatePasswordRules(newPassword);
  if (!pwdCheck.valid) {
    return { success: false, error: pwdCheck.error };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const offlineVer = computeOfflinePasswordVerifier(newPassword);
    const res = await callAppsScript(
      'changeOwnPassword',
      {
        userId,
        currentPassword,
        newPassword,
        ...offlineVer
      },
      session?.token
    );
    if (res.success) {
      return { success: true };
    }
    return buildSheetsWriteFailure(res, 'تعذر تغيير كلمة السر في Google Sheets');
  }

  const user = memoryUsers.find(u => u.id === userId);
  if (!user) {
    return { success: false, error: 'المستخدم غير موجود' };
  }

  if (currentPassword) {
    const currentHash = hashPassword(currentPassword, user.salt);
    if (currentHash !== user.passwordHash) {
      return { success: false, error: 'كلمة السر الحالية غير صحيحة' };
    }
  }

  const newSalt = generateSalt();
  user.salt = newSalt;
  user.passwordHash = hashPassword(newPassword, newSalt);
  user.mustChangePassword = false;
  const offlineVer = computeOfflinePasswordVerifier(newPassword);
  user.offlineVerifier = offlineVer.offlineVerifier;
  user.offlineSalt = offlineVer.offlineSalt;
  user.offlineIterations = offlineVer.offlineIterations;

  recordAuditLog(
    { id: user.id, name: user.name, role: user.role, phone: user.phone },
    'USER_CHANGE_OWN_PASSWORD',
    'User',
    user.id,
    `تغيير كلمة السر الشخصية للمستخدم: ${user.username}`
  );

  return { success: true };
}

/**
 * حذف مستخدم مع منع حذف آخر حساب بدور مالك النظام (designer)
 */
export async function deleteUser(
  userId: string,
  session?: { token?: string; role?: UserRole; permissions?: PermissionKey[]; userId?: string; id?: string; phone?: string; name?: string }
): Promise<{ success: boolean; statusCode?: number; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('deleteUser', { userId, id: userId }, session?.token);
    if (res.success) {
      userSuspendedHandler?.(userId);
      return { success: true };
    }
    return buildSheetsWriteFailure(res, 'تعذر حذف المستخدم من Google Sheets');
  }

  const idx = memoryUsers.findIndex(u => u.id === userId);
  if (idx === -1) {
    return { success: false, statusCode: 404, error: 'المستخدم غير موجود' };
  }

  const target = memoryUsers[idx];
  if (target.role === 'designer' || target.isOwner) {
    const otherActiveDesigners = memoryUsers.filter(
      u =>
        u.id !== target.id &&
        (u.role === 'designer' || Boolean(u.isOwner)) &&
        (u.status === 'active' || (u.status as any) === 'نشط')
    );
    if (otherActiveDesigners.length === 0) {
      return {
        success: false,
        statusCode: 400,
        error: 'غير مسموح: لا يمكن حذف آخر حساب نشط بدور مالك النظام'
      };
    }
  }

  memoryUsers.splice(idx, 1);
  memoryUserCashboxAssignments = memoryUserCashboxAssignments.filter(a => a.userId !== userId);
  userSuspendedHandler?.(userId);

  recordAuditLog(
    session || {},
    'USER_DELETE',
    'User',
    userId,
    `حذف حساب المستخدم: ${target.username} (${target.name})`
  );

  return { success: true };
}

/**
 * حفظ مستخدم جديد أو تعديله مع التحقق من اسم المستخدم وقواعد كلمات المرور
 * وتعيين الخزائن ديناميكيًا وحماية آخر مصمم نشط
 */
export async function saveUser(
  user: Partial<UserAccount> & { username?: string; phone?: string; password?: string },
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string }
): Promise<{ success: boolean; user?: UserAccount; error?: string; code?: string }> {
  const config = getSystemConfig();

  // فحص الصلاحيات: المصمم وحده يدير تعيينات الخزائن
  if (user.cashboxConfig && session?.role !== 'designer') {
    return { success: false, error: 'غير مصرح: المصمم وحده يدير تعيينات الخزائن وصلاحيات المستخدمين.' };
  }

  const canManageUserWarehouses =
    !session ||
    session.role === 'designer' ||
    session.role === 'manager' ||
    Boolean(session.permissions?.includes('permissions.manage')) ||
    Boolean(session.permissions?.includes('warehouses.manage'));
  if (user.warehouseConfig && !canManageUserWarehouses) {
    return { success: false, error: 'غير مصرح: لا تملك صلاحية تعيين المخازن للمستخدمين.' };
  }

  const rawUsername = user.username || user.phone || '';
  const normUser = normalizeUsername(rawUsername);

  if (!rawUsername) {
    return {
      success: false,
      error: 'اسم المستخدم مطلوب'
    };
  }

  if (!isValidUsernameFormat(normUser)) {
    return {
      success: false,
      error: 'اسم المستخدم غير صالح. يقبل حروفاً عربية أو إنجليزية أو أرقاماً بين 2 و 40 خانة.'
    };
  }

  if (isSheetsDataMode(config)) {
    let offlineVerForSheets: { offlineVerifier: string; offlineSalt: string; offlineIterations: number } | undefined;
    if (user.password) {
      const pwdCheck = validatePasswordRules(user.password, user.role || 'employee');
      if (!pwdCheck.valid) {
        return { success: false, error: pwdCheck.error };
      }
      offlineVerForSheets = computeOfflinePasswordVerifier(user.password);
    } else if (!user.id) {
      return { success: false, error: 'كلمة المرور مطلوبة لإنشاء حساب جديد' };
    }

    const res = await callAppsScript(
      'saveUser',
      {
        ...user,
        ...(offlineVerForSheets ? offlineVerForSheets : {})
      },
      session?.token
    );
    if (res.success) {
      if (user.status === 'موقوف' || user.status === 'inactive') {
        if (user.id) userSuspendedHandler?.(user.id);
      }
      return {
        success: true,
        user: res.user
          ? {
              ...res.user,
              ...(offlineVerForSheets ? offlineVerForSheets : {})
            }
          : res.user
      };
    }
    return buildSheetsWriteFailure(res, 'فشل حفظ التعديلات في Google Sheets');
  }

  // فحص تكرار اسم المستخدم (وضع الذاكرة فقط)
  const duplicateIdx = memoryUsers.findIndex(u =>
    u.id !== user.id && (u.normalizedUsername === normUser || normalizeUsername(u.username) === normUser)
  );
  if (duplicateIdx >= 0) {
    return {
      success: false,
      error: `اسم المستخدم "${user.username}" محجوز بالفعل لمستخدم آخر`
    };
  }

  const existingIdx = memoryUsers.findIndex(u =>
    (user.id && u.id === user.id) ||
    u.normalizedUsername === normUser ||
    normalizeUsername(u.username) === normUser
  );

  const requestedRole = user.role || (existingIdx >= 0 ? memoryUsers[existingIdx].role : 'employee');
  const requestedStatus = user.status || (existingIdx >= 0 ? memoryUsers[existingIdx].status : 'active');

  // حماية آخر مالك ومصمم نشط من الإيقاف أو تحويل دوره
  if (existingIdx >= 0) {
    const target = memoryUsers[existingIdx];
    if (target.role === 'designer' || target.isOwner) {
      const isAttemptingDeactivation = requestedStatus === 'موقوف' || requestedStatus === 'inactive';
      const isAttemptingRoleDowngrade = requestedRole !== 'designer';

      if (isAttemptingDeactivation || isAttemptingRoleDowngrade) {
        const activeDesigners = memoryUsers.filter(u =>
          u.id !== target.id &&
          (u.role === 'designer' || u.isOwner) &&
          (u.status === 'active' || (u.status as any) === 'نشط')
        );
        if (activeDesigners.length === 0) {
          return {
            success: false,
            error: 'غير مسموح: لا يمكن إيقاف أو تعديل دور مصمم ومالك النظام الأخير، يجب أن يظل هناك مصمم نشط واحد على الأقل.'
          };
        }
      }

      // السماح بتعديل الاسم الظاهر واسم المستخدم لأي حساب بصلاحية إدارة المستخدمين الحالية،
      // مع منع غير المالك من إيقاف حساب المالك أو تغيير دوره
      if (session && session.role !== 'designer' && (isAttemptingDeactivation || isAttemptingRoleDowngrade)) {
        return { success: false, error: 'غير مصرح: لا يمكن إيقاف حساب مالك النظام أو تغيير دوره إلا من قِبل مالك نظام آخر.' };
      }
    } else if (requestedRole === 'designer' && session && session.role !== 'designer') {
      return { success: false, error: 'غير مصرح: لا يمكن منح دور مصمم ومالك النظام إلا من قِبل مالك النظام الحالي.' };
    }
  } else if (requestedRole === 'designer' && session && session.role !== 'designer') {
    return { success: false, error: 'غير مصرح: لا يمكن منح دور مصمم ومالك النظام إلا من قِبل مالك النظام الحالي.' };
  }

  // التحقق من قواعد كلمة المرور إذا تم تقديم كلمة مرور جديدة
  let passwordWasReset = false;
  if (user.password) {
    const pwdCheck = validatePasswordRules(user.password, requestedRole);
    if (!pwdCheck.valid) {
      return { success: false, error: pwdCheck.error };
    }
    passwordWasReset = true;
  } else if (existingIdx === -1) {
    return { success: false, error: 'كلمة المرور مطلوبة لإنشاء حساب جديد' };
  }

  let userPerms = user.permissions;
  if (!Array.isArray(userPerms)) {
    userPerms = ROLE_TEMPLATES[requestedRole] || ROLE_TEMPLATES.employee;
  }

  if (session?.role !== 'designer') {
    userPerms = userPerms.filter(p => session?.permissions?.includes(p));
  }

  const salt = user.password
    ? generateSalt()
    : (existingIdx >= 0 ? memoryUsers[existingIdx].salt : generateSalt());
  const passwordHash = user.password
    ? hashPassword(user.password, salt)
    : (existingIdx >= 0 ? memoryUsers[existingIdx].passwordHash : hashPassword(INITIAL_USER_PASSWORD, salt));

  const offlineVer = user.password
    ? computeOfflinePasswordVerifier(user.password)
    : existingIdx >= 0 && memoryUsers[existingIdx].offlineVerifier && memoryUsers[existingIdx].offlineSalt
    ? {
        offlineVerifier: memoryUsers[existingIdx].offlineVerifier!,
        offlineSalt: memoryUsers[existingIdx].offlineSalt!,
        offlineIterations: memoryUsers[existingIdx].offlineIterations || OFFLINE_PBKDF2_ITERATIONS
      }
    : undefined;

  const id = user.id || (existingIdx >= 0 ? memoryUsers[existingIdx].id : generateUUID());
  const finalCashboxConfig = user.cashboxConfig !== undefined
    ? user.cashboxConfig
    : (existingIdx >= 0 ? memoryUsers[existingIdx].cashboxConfig : undefined);

  let finalWarehouseConfig = existingIdx >= 0 ? memoryUsers[existingIdx].warehouseConfig : undefined;
  if (user.warehouseConfig !== undefined) {
    const rawAllowed = Array.isArray(user.warehouseConfig.allowedWarehouseIds)
      ? user.warehouseConfig.allowedWarehouseIds.map(w => String(w).trim()).filter(Boolean)
      : [];
    const uniqueAllowed = Array.from(new Set(rawAllowed));
    for (const wId of uniqueAllowed) {
      if (!memoryWarehouses.some(w => w.id === wId)) {
        return { success: false, error: `المخزن غير موجود بالنظام: ${wId}` };
      }
    }
    let defWhId = user.warehouseConfig.defaultWarehouseId
      ? String(user.warehouseConfig.defaultWarehouseId).trim()
      : undefined;
    if (defWhId) {
      if (!memoryWarehouses.some(w => w.id === defWhId)) {
        return { success: false, error: 'المخزن الافتراضي المحدد غير موجود بالنظام' };
      }
      const isManagerRole = requestedRole === 'designer' || requestedRole === 'manager';
      if (!isManagerRole && !uniqueAllowed.includes(defWhId)) {
        return { success: false, error: 'المخزن الافتراضي يجب أن يكون ضمن قائمة المخازن المسموحة للمستخدم' };
      }
    } else if (uniqueAllowed.length === 1) {
      defWhId = uniqueAllowed[0];
    }
    finalWarehouseConfig = {
      allowedWarehouseIds: uniqueAllowed,
      defaultWarehouseId: defWhId
    };
  } else if (existingIdx === -1 && !finalWarehouseConfig) {
    const defId = getDefaultWarehouse().id;
    finalWarehouseConfig = {
      allowedWarehouseIds: [defId],
      defaultWarehouseId: defId
    };
  }

  const nowIso = new Date().toISOString();

  // عند إعادة تعيين كلمة سر مستخدم من المدير، يصبح mustChangePassword=true له تلقائياً
  const nextMustChangePassword =
    passwordWasReset && existingIdx >= 0
      ? true
      : user.mustChangePassword !== undefined
      ? Boolean(user.mustChangePassword)
      : existingIdx >= 0
      ? Boolean(memoryUsers[existingIdx].mustChangePassword)
      : false;

  const savedUser: StoredUser = {
    id,
    username: rawUsername.trim(),
    normalizedUsername: normUser,
    phone: user.phone ? String(user.phone).trim() : (existingIdx >= 0 ? memoryUsers[existingIdx].phone : undefined),
    name: user.name ? String(user.name).trim() : (existingIdx >= 0 ? memoryUsers[existingIdx].name : 'مستخدم'),
    role: requestedRole,
    status: requestedStatus,
    createdAt: existingIdx >= 0 ? memoryUsers[existingIdx].createdAt : nowIso,
    salt,
    passwordHash,
    permissions: requestedRole === 'designer' ? ALL_PERMISSIONS.map(p => p.key) : userPerms,
    isOwner: requestedRole === 'designer',
    mustChangePassword: nextMustChangePassword,
    cashboxConfig: finalCashboxConfig,
    warehouseConfig: finalWarehouseConfig,
    offlineVerifier: offlineVer?.offlineVerifier,
    offlineSalt: offlineVer?.offlineSalt,
    offlineIterations: offlineVer?.offlineIterations,
    permissionsUpdatedAt:
      user.permissions !== undefined || existingIdx === -1
        ? nowIso
        : (memoryUsers[existingIdx].permissionsUpdatedAt || memoryUsers[existingIdx].createdAt),
    permissionsUpdatedByDevice:
      user.permissions !== undefined || existingIdx === -1
        ? ((user as any).deviceId || 'ONLINE')
        : memoryUsers[existingIdx].permissionsUpdatedByDevice
  };

  if (existingIdx >= 0) {
    memoryUsers[existingIdx] = savedUser;
    recordAuditLog(session || {}, 'USER_UPDATE', 'User', id, `تعديل مستخدم: ${rawUsername}`);
  } else {
    memoryUsers.push(savedUser);
    recordAuditLog(session || {}, 'USER_CREATE', 'User', id, `إنشاء مستخدم: ${rawUsername}`);
  }

  // تحديث جدول تخصيص الخزائن memoryUserCashboxAssignments
  if (finalCashboxConfig) {
    memoryUserCashboxAssignments = memoryUserCashboxAssignments.filter(a => a.userId !== id);
    const cfg = finalCashboxConfig;
    const allAssignedIds = Array.from(new Set([
      ...(cfg.allowedSaleCashboxIds || []),
      ...(cfg.allowedReturnCashboxIds || []),
      ...(cfg.allowedReceiptCashboxIds || []),
      ...(cfg.allowedPaymentCashboxIds || []),
      ...(cfg.allowedTransferCashboxIds || [])
    ]));

    for (const cId of allAssignedIds) {
      const targetCb = memoryCashboxes.find(c => c.id === cId);
      const ops: ('sale' | 'return' | 'receipt' | 'payment' | 'transfer')[] = [];
      if (cfg.allowedSaleCashboxIds?.includes(cId)) ops.push('sale');
      if (cfg.allowedReturnCashboxIds?.includes(cId)) ops.push('return');
      if (cfg.allowedReceiptCashboxIds?.includes(cId)) ops.push('receipt');
      if (cfg.allowedPaymentCashboxIds?.includes(cId)) ops.push('payment');
      if (cfg.allowedTransferCashboxIds?.includes(cId)) ops.push('transfer');

      const isDefaultSale = cId === cfg.defaultSaleCashboxId;
      const isDefaultReturn = cId === cfg.defaultReturnCashboxId;

      memoryUserCashboxAssignments.push({
        id: generateUUID(),
        userId: id,
        userName: savedUser.name,
        cashboxId: cId,
        cashboxName: targetCb?.name || '',
        permissionType: 'إيداع وسحب',
        operations: ops,
        isDefaultSale,
        isDefaultReturn,
        isDefault: isDefaultSale || isDefaultReturn,
        status: (requestedStatus === 'موقوف' || requestedStatus === 'inactive') ? 'inactive' : 'active',
        assignedAt: new Date().toISOString()
      });
    }

    recordAuditLog(session || {}, 'USER_CASHBOX_ASSIGN', 'User', id, `تحديث تعيينات الخزائن للمستخدم: ${rawUsername}`);
  }

  // عند إيقاف المستخدم: إلغاء جلساته النشطة فوراً
  if (requestedStatus === 'موقوف' || requestedStatus === 'inactive') {
    userSuspendedHandler?.(id);
    recordAuditLog(session || {}, 'USER_STATUS_CHANGE', 'User', id, `إيقاف حساب المستخدم (${rawUsername}) وإلغاء جلساته النشطة`);
  }

  if (passwordWasReset) {
    recordAuditLog(session || {}, 'USER_PASSWORD_RESET', 'User', id, `إعادة تعيين كلمة المرور للمستخدم (${rawUsername})`);
  }

  return {
    success: true,
    user: {
      id: savedUser.id,
      username: savedUser.username,
      phone: savedUser.phone,
      name: savedUser.name,
      role: savedUser.role,
      status: savedUser.status,
      permissions: savedUser.permissions,
      isOwner: savedUser.isOwner,
      mustChangePassword: Boolean(savedUser.mustChangePassword),
      createdAt: savedUser.createdAt,
      cashboxConfig: savedUser.cashboxConfig,
      warehouseConfig: savedUser.warehouseConfig,
      offlineVerifier: savedUser.offlineVerifier,
      offlineSalt: savedUser.offlineSalt,
      offlineIterations: savedUser.offlineIterations,
      permissionsUpdatedAt: savedUser.permissionsUpdatedAt,
      permissionsUpdatedByDevice: savedUser.permissionsUpdatedByDevice
    }
  };
}

/**
 * تحديث صلاحيات مستخدم
 */
export async function updateUserPermissions(
  userId: string,
  newPermissions: PermissionKey[],
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; deviceId?: string }
): Promise<{ success: boolean; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('updateUserPermissions', { userId, permissions: newPermissions }, session?.token);
    if (res.success) return { success: true };
    return buildSheetsWriteFailure(res, 'تعذر تحديث صلاحيات المستخدم في Google Sheets');
  }

  const target = memoryUsers.find(u => u.id === userId);
  if (!target) {
    return { success: false, error: 'المستخدم غير موجود' };
  }

  if (target.role === 'designer' && session?.role !== 'designer') {
    return { success: false, error: 'غير مصرح: لا يمكن تعديل صلاحيات مالك النظام.' };
  }

  let filteredPerms = newPermissions;
  if (session?.role !== 'designer') {
    filteredPerms = newPermissions.filter(p => session?.permissions?.includes(p));
  }

  target.permissions = target.role === 'designer' ? ALL_PERMISSIONS.map(p => p.key) : filteredPerms;
  target.permissionsUpdatedAt = new Date().toISOString();
  target.permissionsUpdatedByDevice = session?.deviceId || 'ONLINE';
  recordAuditLog(session || {}, 'PERMISSIONS_UPDATE', 'UserPermissions', userId, `تحديث صلاحيات المستخدم (${target.phone || target.username}) إلى ${target.permissions.length} صلاحية`);
  return { success: true };
}

/**
 * قراءة إعدادات التواصل الأربعة فقط (بدون تسجيل دخول)
 */
export async function getPublicContactSettings(): Promise<ContactSettings> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getPublicContactSettings');
    if (res && res.success && res.contactSettings) {
      const cs = res.contactSettings;
      memoryCompanySettings = {
        ...memoryCompanySettings,
        supportWhatsapp: String(cs.supportWhatsapp ?? ''),
        supportPhone: String(cs.supportPhone ?? ''),
        salesWhatsapp: String(cs.salesWhatsapp ?? ''),
        salesPhone: String(cs.salesPhone ?? '')
      };
    }
  }
  return {
    supportWhatsapp: String(memoryCompanySettings.supportWhatsapp ?? defaultContactSettings.supportWhatsapp ?? ''),
    supportPhone: String(memoryCompanySettings.supportPhone ?? defaultContactSettings.supportPhone ?? ''),
    salesWhatsapp: String(memoryCompanySettings.salesWhatsapp ?? defaultContactSettings.salesWhatsapp ?? ''),
    salesPhone: String(memoryCompanySettings.salesPhone ?? defaultContactSettings.salesPhone ?? '')
  };
}

/**
 * حفظ إعدادات التواصل الأربعة مع التحقق الصارم من صيغة الأرقام
 */
export async function saveContactSettings(
  contactInput: Partial<ContactSettings>,
  session?: { token?: string; role: UserRole; permissions: PermissionKey[] }
): Promise<{ success: boolean; statusCode?: number; contactSettings?: ContactSettings; error?: string }> {
  const fields: Array<{ key: keyof ContactSettings; label: string }> = [
    { key: 'supportWhatsapp', label: 'رقم واتساب الدعم الفني' },
    { key: 'supportPhone', label: 'رقم هاتف الدعم الفني' },
    { key: 'salesWhatsapp', label: 'رقم واتساب المبيعات' },
    { key: 'salesPhone', label: 'رقم هاتف المبيعات' }
  ];

  const cleaned: Partial<ContactSettings> = {};
  for (const { key, label } of fields) {
    if (contactInput[key] !== undefined) {
      const check = validateContactNumber(contactInput[key]);
      if (!check.valid) {
        return {
          success: false,
          statusCode: 400,
          error: `${label} غير صالح: يجب أن يحتوي على أرقام فقط مع علامة + اختيارية في البداية`
        };
      }
      cleaned[key] = check.cleaned;
    }
  }

  const saveRes = await saveCompanySettings(cleaned, session);
  if (!saveRes.success) {
    return {
      success: false,
      statusCode: (saveRes as any).statusCode || 400,
      error: (saveRes as any).error || 'تعذر حفظ بيانات التواصل'
    };
  }

  return {
    success: true,
    contactSettings: {
      supportWhatsapp: String(memoryCompanySettings.supportWhatsapp ?? ''),
      supportPhone: String(memoryCompanySettings.supportPhone ?? ''),
      salesWhatsapp: String(memoryCompanySettings.salesWhatsapp ?? ''),
      salesPhone: String(memoryCompanySettings.salesPhone ?? '')
    }
  };
}

/**
 * قراءة إعدادات هوية ومظهر الشركة
 */
export function getCompanySettings(): CompanySettings {
  const merged = { ...defaultCompanySettings, ...memoryCompanySettings };
  merged.inactivityTimeoutMinutes = normalizeInactivityTimeoutMinutes(merged.inactivityTimeoutMinutes);
  return merged;
}

/**
 * حفظ إعدادات هوية ومظهر الشركة
 */
export async function saveCompanySettings(settings: Partial<CompanySettings>, session?: { token?: string; role: UserRole; permissions: PermissionKey[] }) {
  if (settings.appTheme !== undefined && (settings.appTheme as string) !== '' && !isValidAppTheme(settings.appTheme)) {
    return {
      success: false,
      statusCode: 400,
      error: `قيمة الثيم المختار غير صالحة (${String(settings.appTheme)})`
    };
  }

  if (settings.inactivityTimeoutMinutes !== undefined && !isValidInactivityTimeoutMinutes(settings.inactivityTimeoutMinutes)) {
    return {
      success: false,
      statusCode: 400,
      error: 'قيمة مهلة تسجيل الخروج بعد عدم النشاط غير صالحة. القيم المسموحة: 15 أو 30 دقيقة، أو 1، 2، 4، 8، 12، 24 ساعة.'
    };
  }

  const contactFields: Array<{ key: keyof ContactSettings; label: string }> = [
    { key: 'supportWhatsapp', label: 'رقم واتساب الدعم الفني' },
    { key: 'supportPhone', label: 'رقم هاتف الدعم الفني' },
    { key: 'salesWhatsapp', label: 'رقم واتساب المبيعات' },
    { key: 'salesPhone', label: 'رقم هاتف المبيعات' }
  ];

  const sanitizedContact: Partial<ContactSettings> = {};
  for (const { key, label } of contactFields) {
    if (settings[key] !== undefined) {
      const check = validateContactNumber(settings[key]);
      if (!check.valid) {
        return {
          success: false,
          statusCode: 400,
          error: `${label} غير صالح: يجب أن يحتوي على أرقام فقط مع علامة + اختيارية في البداية`
        };
      }
      sanitizedContact[key] = check.cleaned;
    }
  }

  const prevTimeout = normalizeInactivityTimeoutMinutes(memoryCompanySettings.inactivityTimeoutMinutes);
  const nextTimeout = settings.inactivityTimeoutMinutes !== undefined
    ? normalizeInactivityTimeoutMinutes(settings.inactivityTimeoutMinutes)
    : prevTimeout;

  const config = getSystemConfig();
  const nextSettings: CompanySettings = {
    ...defaultCompanySettings,
    ...memoryCompanySettings,
    ...settings,
    ...sanitizedContact,
    inactivityTimeoutMinutes: nextTimeout
  };

  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('saveSettings', { companySettings: nextSettings, storeName: nextSettings.storeName }, session?.token);
    if (!res?.success) {
      const failure = buildSheetsWriteFailure(res, 'تعذر حفظ إعدادات الشركة في Google Sheets');
      return {
        ...failure,
        statusCode: res?.isTimeout ? 504 : (res?.isTransportError ? 503 : (res?.statusCode || 400))
      };
    }
  }

  memoryCompanySettings = nextSettings;
  importPersistedConfig({ inactivityTimeoutMinutes: nextTimeout });
  const timeoutChangedNote = prevTimeout !== nextTimeout
    ? ` (تعديل مهلة عدم النشاط من ${prevTimeout} إلى ${nextTimeout} دقيقة)`
    : '';
  recordAuditLog(session || {}, 'SETTINGS_COMPANY', 'Settings', 'Company', `تحديث هوية ومظهر الشركة${timeoutChangedNote}`);
  return { success: true, settings: memoryCompanySettings };
}

/**
 * قراءة إعدادات الفاتورة والطباعة بعد ترحيل النص القديم
 */
export function getInvoicePrintSettings(): InvoicePrintSettings {
  if (memoryInvoicePrintSettings.headerText === 'فاتورة مبيعات مدققة وموثقة على المنصة') {
    memoryInvoicePrintSettings.headerText = '';
  }
  const autoFill = memoryInvoicePrintSettings.autoFillCashPaid ?? memoryDisplaySettings.autoFillCashPaid ?? true;
  return {
    ...defaultInvoicePrintSettings,
    ...memoryInvoicePrintSettings,
    autoFillCashPaid: autoFill
  };
}

/**
 * حفظ إعدادات الفاتورة والطباعة
 */
export async function saveInvoicePrintSettings(settings: Partial<InvoicePrintSettings>, session?: { token?: string; role: UserRole; permissions: PermissionKey[] }) {
  const config = getSystemConfig();
  const cleanHeader = settings.headerText === 'فاتورة مبيعات مدققة وموثقة على المنصة'
    ? ''
    : (settings.headerText ?? memoryInvoicePrintSettings.headerText ?? '');

  const nextAutoFill =
    settings.autoFillCashPaid !== undefined
      ? Boolean(settings.autoFillCashPaid)
      : (memoryInvoicePrintSettings.autoFillCashPaid ?? memoryDisplaySettings.autoFillCashPaid ?? true);

  const nextPrintSettings: InvoicePrintSettings = {
    ...defaultInvoicePrintSettings,
    ...memoryInvoicePrintSettings,
    ...settings,
    printedItemLabel:
      settings.printedItemLabel === 'printName'
        ? 'printName'
        : settings.printedItemLabel === 'name'
        ? 'name'
        : (memoryInvoicePrintSettings.printedItemLabel || 'name'),
    autoFillCashPaid: nextAutoFill,
    headerText: cleanHeader,
    footerText: settings.footerText ?? memoryInvoicePrintSettings.footerText ?? '',
    termsAndConditions: settings.termsAndConditions ?? memoryInvoicePrintSettings.termsAndConditions ?? '',
    returnPolicyText: settings.returnPolicyText ?? memoryInvoicePrintSettings.returnPolicyText ?? '',
    showReceiptPreview: settings.showReceiptPreview ?? memoryInvoicePrintSettings.showReceiptPreview ?? false,
    printableWidthMm: settings.printableWidthMm ?? memoryInvoicePrintSettings.printableWidthMm ?? 72,
    showInvoiceNumber: settings.showInvoiceNumber ?? memoryInvoicePrintSettings.showInvoiceNumber ?? true,
    showDateTime: settings.showDateTime ?? memoryInvoicePrintSettings.showDateTime ?? true,
    showInvoiceStatus: settings.showInvoiceStatus ?? memoryInvoicePrintSettings.showInvoiceStatus ?? true
  };
  const nextDisplaySettings: DisplaySettings = {
    ...defaultDisplaySettings,
    ...memoryDisplaySettings,
    autoFillCashPaid: nextAutoFill
  };

  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('saveSettings', { invoicePrintSettings: nextPrintSettings, displaySettings: nextDisplaySettings }, session?.token);
    if (!res?.success) {
      const failure = buildSheetsWriteFailure(res, 'تعذر حفظ إعدادات الفاتورة في Google Sheets');
      return {
        ...failure,
        statusCode: res?.isTimeout ? 504 : (res?.isTransportError ? 503 : (res?.statusCode || 400))
      };
    }
  }

  memoryInvoicePrintSettings = nextPrintSettings;
  memoryDisplaySettings = nextDisplaySettings;

  recordAuditLog(session || {}, 'SETTINGS_PRINT', 'Settings', 'InvoicePrint', 'تحديث إعدادات طباعة الفاتورة');
  return { success: true, settings: memoryInvoicePrintSettings };
}

function normalizePosVisibleCategoryIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const id = String(entry ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeBarcodeScanMode(raw: unknown): 'increment' | 'edit_quantity' {
  return raw === 'edit_quantity' ? 'edit_quantity' : 'increment';
}

/**
 * قراءة إعدادات عرض الأصناف وشاشة المبيعات
 */
export function getDisplaySettings(): DisplaySettings {
  const autoFill = memoryDisplaySettings.autoFillCashPaid ?? memoryInvoicePrintSettings.autoFillCashPaid ?? true;
  return {
    ...defaultDisplaySettings,
    ...memoryDisplaySettings,
    autoFillCashPaid: autoFill,
    posVisibleCategoryIds: normalizePosVisibleCategoryIds(memoryDisplaySettings.posVisibleCategoryIds),
    barcodeScanMode: normalizeBarcodeScanMode(memoryDisplaySettings.barcodeScanMode),
    latestItemFirst: normalizeLatestItemFirst(memoryDisplaySettings.latestItemFirst),
    posShowCustomerAddress: memoryDisplaySettings.posShowCustomerAddress ?? true,
    posShowCustomerPhone: memoryDisplaySettings.posShowCustomerPhone ?? true,
    posShowCustomerBalance: memoryDisplaySettings.posShowCustomerBalance ?? true
  };
}

/**
 * حفظ إعدادات عرض الأصناف وشاشة المبيعات
 */
export async function saveDisplaySettings(settings: Partial<DisplaySettings>, session?: { token?: string; role: UserRole; permissions: PermissionKey[] }) {
  const config = getSystemConfig();
  const nextAutoFill =
    settings.autoFillCashPaid !== undefined
      ? Boolean(settings.autoFillCashPaid)
      : (memoryDisplaySettings.autoFillCashPaid ?? memoryInvoicePrintSettings.autoFillCashPaid ?? true);
  const nextPosVisibleCategoryIds =
    settings.posVisibleCategoryIds !== undefined
      ? normalizePosVisibleCategoryIds(settings.posVisibleCategoryIds)
      : normalizePosVisibleCategoryIds(memoryDisplaySettings.posVisibleCategoryIds);
  const nextBarcodeScanMode =
    settings.barcodeScanMode !== undefined
      ? normalizeBarcodeScanMode(settings.barcodeScanMode)
      : normalizeBarcodeScanMode(memoryDisplaySettings.barcodeScanMode);
  const nextLatestItemFirst =
    settings.latestItemFirst !== undefined
      ? normalizeLatestItemFirst(settings.latestItemFirst, memoryDisplaySettings.latestItemFirst)
      : normalizeLatestItemFirst(memoryDisplaySettings.latestItemFirst);
  const nextPosShowCustomerAddress =
    settings.posShowCustomerAddress !== undefined
      ? Boolean(settings.posShowCustomerAddress)
      : (memoryDisplaySettings.posShowCustomerAddress ?? true);
  const nextPosShowCustomerPhone =
    settings.posShowCustomerPhone !== undefined
      ? Boolean(settings.posShowCustomerPhone)
      : (memoryDisplaySettings.posShowCustomerPhone ?? true);
  const nextPosShowCustomerBalance =
    settings.posShowCustomerBalance !== undefined
      ? Boolean(settings.posShowCustomerBalance)
      : (memoryDisplaySettings.posShowCustomerBalance ?? true);

  const nextDisplaySettings: DisplaySettings = {
    ...defaultDisplaySettings,
    ...memoryDisplaySettings,
    ...settings,
    autoFillCashPaid: nextAutoFill,
    posVisibleCategoryIds: nextPosVisibleCategoryIds,
    barcodeScanMode: nextBarcodeScanMode,
    latestItemFirst: nextLatestItemFirst,
    posShowCustomerAddress: nextPosShowCustomerAddress,
    posShowCustomerPhone: nextPosShowCustomerPhone,
    posShowCustomerBalance: nextPosShowCustomerBalance
  };
  const nextPrintSettings: InvoicePrintSettings = {
    ...defaultInvoicePrintSettings,
    ...memoryInvoicePrintSettings,
    autoFillCashPaid: nextAutoFill
  };

  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('saveSettings', { displaySettings: nextDisplaySettings, invoicePrintSettings: nextPrintSettings }, session?.token);
    if (!res?.success) {
      const failure = buildSheetsWriteFailure(res, 'تعذر حفظ إعدادات العرض في Google Sheets');
      return {
        ...failure,
        statusCode: res?.isTimeout ? 504 : (res?.isTransportError ? 503 : (res?.statusCode || 400))
      };
    }
  }

  memoryDisplaySettings = nextDisplaySettings;
  memoryInvoicePrintSettings = nextPrintSettings;

  recordAuditLog(session || {}, 'SETTINGS_DISPLAY', 'Settings', 'Display', 'تحديث إعدادات عرض الأصناف');
  return { success: true, settings: memoryDisplaySettings };
}

/**
 * قراءة إعدادات المخزون الحالية
 */
export function getStockSettings(): StockSettings {
  return {
    allowNegativeStockSale: Boolean(memoryStockSettings.allowNegativeStockSale),
    allowNegativeWarehouseTransfer: Boolean(memoryStockSettings.allowNegativeWarehouseTransfer)
  };
}

/**
 * حفظ وتعديل إعدادات سياسة المخزون (البيع بالسالب والتحويل بالسالب)
 */
export async function saveStockSettings(
  settings: Partial<StockSettings>,
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; actorId?: string; actorName?: string; id?: string; name?: string; phone?: string }
) {
  const config = getSystemConfig();
  const oldNegativeSale = Boolean(memoryStockSettings.allowNegativeStockSale);
  const oldNegativeTransfer = Boolean(memoryStockSettings.allowNegativeWarehouseTransfer);

  const nextNegativeSale =
    settings.allowNegativeStockSale !== undefined
      ? Boolean(settings.allowNegativeStockSale)
      : oldNegativeSale;

  const nextNegativeTransfer =
    settings.allowNegativeWarehouseTransfer !== undefined
      ? Boolean(settings.allowNegativeWarehouseTransfer)
      : oldNegativeTransfer;

  const candidateStockSettings: StockSettings = {
    allowNegativeStockSale: nextNegativeSale,
    allowNegativeWarehouseTransfer: nextNegativeTransfer
  };

  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('saveSettings', { stockSettings: candidateStockSettings }, session?.token);
    if (!res?.success) {
      const failure = buildSheetsWriteFailure(res, 'تعذر حفظ سياسة المخزون في Google Sheets');
      return {
        ...failure,
        statusCode: res?.isTimeout ? 504 : (res?.isTransportError ? 503 : (res?.statusCode || 400))
      };
    }
  }

  memoryStockSettings = candidateStockSettings;

  const actorName = session?.actorName || (session as any)?.name || (session as any)?.phone || 'المستخدم';
  const actorObj = {
    id: session?.actorId || (session as any)?.id,
    name: actorName,
    role: session?.role,
    phone: (session as any)?.phone
  };

  if (settings.allowNegativeStockSale !== undefined || oldNegativeSale !== nextNegativeSale) {
    recordAuditLog(
      actorObj,
      'SETTINGS_STOCK_POLICY',
      'Settings',
      'StockPolicy',
      `تعديل سياسة البيع بالسالب: القيمة السابقة (${oldNegativeSale ? 'مفعل' : 'معطل'}) والقيمة الجديدة (${nextNegativeSale ? 'مفعل' : 'معطل'}) بواسطة ${actorName}`
    );
  }

  if (settings.allowNegativeWarehouseTransfer !== undefined || oldNegativeTransfer !== nextNegativeTransfer) {
    recordAuditLog(
      actorObj,
      'SETTINGS_WAREHOUSE_TRANSFER_POLICY',
      'Settings',
      'WarehouseTransferPolicy',
      `تعديل سياسة السماح بالتحويل بالسالب بين المخازن: القيمة السابقة (${oldNegativeTransfer ? 'مفعل' : 'معطل'}) والقيمة الجديدة (${nextNegativeTransfer ? 'مفعل' : 'معطل'}) بواسطة ${actorName}`
    );
  }

  return { success: true, settings: getStockSettings() };
}

/**
 * جلب سجل التدقيق
 */
export async function getAuditLogs(
  session?: { token?: string },
  filters?: { from?: string | null; to?: string | null; userId?: string | null; action?: string | null; q?: string | null }
): Promise<AuditLogEntry[]> {
  const config = getSystemConfig();
  const cacheKey = `auditLogs:${JSON.stringify(filters || {})}`;
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getAuditLogs', filters || {}, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache(cacheKey, res.data);
      return res.data;
    }
    const cached = getSheetsCache<AuditLogEntry[]>(cacheKey);
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب سجل التدقيق من Google Sheets');
  }

  let logs = memoryAuditLogs;

  if (filters?.from || filters?.to) {
    logs = logs.filter(log => isDateInRange(log.timestamp, filters.from, filters.to));
  }

  if (filters?.userId && filters.userId !== 'ALL') {
    logs = logs.filter(log => log.actorId === filters.userId || log.actorName === filters.userId);
  }

  if (filters?.action && filters.action !== 'ALL') {
    logs = logs.filter(log => log.action === filters.action);
  }

  if (filters?.q && filters.q.trim()) {
    const normQ = normalizeArabicText(filters.q);
    logs = logs.filter(log => {
      const rowText = normalizeArabicText(
        `${log.actorName || ''} ${log.actorRole || ''} ${log.action || ''} ${log.targetType || ''} ${log.targetId || ''} ${log.details || ''}`
      );
      return rowText.includes(normQ);
    });
  }

  return logs;
}

/**
 * رفع صورة
 */
export async function uploadImage(payload: { imageBase64: string; fileName?: string; mimeType?: string }, sessionToken?: string) {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('uploadImage', payload, sessionToken);
    if (res && res.success) return res;
    return buildSheetsWriteFailure(res, 'تعذر رفع الصورة إلى Google Drive');
  }
  return {
    success: true,
    url: payload.imageBase64,
    message: 'تم حفظ الصورة محلياً بنجاح (سيتم رفعها لـ Google Drive فور اتصال السكربت)'
  };
}

// ===================== 16. الموردين والمشتريات (Suppliers & Purchases) ===================== //

/**
 * جلب قائمة الموردين
 */
export async function getSuppliers(session?: { token?: string }): Promise<Supplier[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getSuppliers', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache('suppliers', res.data);
      return res.data;
    }
    const cached = getSheetsCache<Supplier[]>('suppliers');
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب الموردين من Google Sheets');
  }
  return memorySuppliers;
}

/**
 * حفظ أو تعديل مورد
 */
export async function saveSupplier(
  supplier: Partial<Supplier> & { name: string },
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string }
): Promise<{ success: boolean; supplier?: Supplier; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res: any = await callAppsScript('saveSupplier', supplier, session?.token);
    if (res.success && res.supplier) {
      return { success: true, supplier: res.supplier };
    }
    return buildSheetsWriteFailure(res, 'تعذر حفظ المورد في Google Sheets');
  }

  const isEdit = Boolean(supplier.id);
  let saved: Supplier;

  if (isEdit) {
    const idx = memorySuppliers.findIndex(s => s.id === supplier.id);
    if (idx === -1) return { success: false, error: 'المورد غير موجود' };
    saved = {
      ...memorySuppliers[idx],
      ...supplier,
      name: supplier.name.trim()
    };
    memorySuppliers[idx] = saved;
    recordAuditLog(session || {}, 'SUPPLIER_EDIT', 'Supplier', saved.id, `تعديل بيانات المورد: ${saved.name}`);
  } else {
    const newId = supplier.id || `sup-${Date.now().toString(36)}`;
    const opening = Number(supplier.openingBalance || 0);
    saved = {
      id: newId,
      name: supplier.name.trim(),
      code: supplier.code || `SUP-${Math.floor(100 + Math.random() * 900)}`,
      groupId: supplier.groupId || '',
      phone: supplier.phone || '',
      phoneSecondary: supplier.phoneSecondary || '',
      email: supplier.email || '',
      address: supplier.address || '',
      taxNumber: supplier.taxNumber || '',
      commercialRecord: supplier.commercialRecord || '',
      openingBalance: opening,
      currentBalance: opening,
      status: supplier.status || 'active',
      notes: supplier.notes || '',
      createdAt: new Date().toISOString()
    };
    memorySuppliers.unshift(saved);

    // تسجيل الرصيد الافتتاحي كحركة دفترية تاريخية لا تحذف
    if (opening !== 0) {
      memorySupplierLedger.push({
        id: generateUUID(),
        date: new Date().toISOString(),
        supplierId: saved.id,
        supplierName: saved.name,
        transactionType: 'رصيد افتتاحي',
        documentNumber: `OPN-${saved.code || saved.id}`,
        debit: opening < 0 ? Math.abs(opening) : 0,
        credit: opening > 0 ? opening : 0,
        balanceAfter: opening,
        statement: 'تسجيل رصيد افتتاحي للمورد',
        userName: session?.name || session?.phone || 'المسؤول'
      });
    }

    recordAuditLog(session || {}, 'SUPPLIER_CREATE', 'Supplier', saved.id, `إضافة مورد جديد: ${saved.name}`);
  }

  return { success: true, supplier: saved };
}

/**
 * جلب مجموعات الموردين
 */
export async function getSupplierGroups(session?: { token?: string }): Promise<SupplierGroup[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getSupplierGroups', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache('supplierGroups', res.data);
      return res.data;
    }
    const cached = getSheetsCache<SupplierGroup[]>('supplierGroups');
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب مجموعات الموردين من Google Sheets');
  }
  return memorySupplierGroups;
}

/**
 * حفظ مجموعة موردين
 */
export async function saveSupplierGroup(group: Partial<SupplierGroup> & { name: string }, session?: { token?: string }): Promise<{ success: boolean; group?: SupplierGroup; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res: any = await callAppsScript('saveSupplierGroup', group, session?.token);
    if (res.success && res.group) return { success: true, group: res.group };
    return buildSheetsWriteFailure(res, 'تعذر حفظ مجموعة الموردين في Google Sheets');
  }

  const newGroup: SupplierGroup = {
    id: group.id || `grp-sup-${Date.now().toString(36)}`,
    name: group.name.trim(),
    description: group.description || '',
    createdAt: new Date().toISOString()
  };
  const idx = memorySupplierGroups.findIndex(g => g.id === newGroup.id);
  if (idx >= 0) {
    memorySupplierGroups[idx] = newGroup;
  } else {
    memorySupplierGroups.push(newGroup);
  }
  return { success: true, group: newGroup };
}

/**
 * جلب كشف حساب مورد تفصيلي
 */
export async function getSupplierLedger(
  supplierId: string,
  session?: { token?: string },
  filters?: { from?: string | null; to?: string | null }
): Promise<{ success: boolean; ledger: SupplierLedgerEntry[]; supplier?: Supplier; openingBalanceForPeriod?: number; error?: string; code?: string; stale?: boolean; lastSyncAt?: string }> {
  const config = getSystemConfig();
  const cacheKey = `supplierLedger:${supplierId}:${filters?.from || ''}:${filters?.to || ''}`;
  if (isSheetsDataMode(config)) {
    const res: any = await callAppsScript('getSupplierLedger', { supplierId, from: filters?.from, to: filters?.to }, session?.token);
    if (res.success && Array.isArray(res.ledger)) {
      setSheetsCache(cacheKey, res);
      return res;
    }
    const cached = getSheetsCache<any>(cacheKey);
    if (cached) {
      return {
        ...cached.data,
        stale: true,
        lastSyncAt: cached.lastSyncAt
      };
    }
    return {
      ...buildSheetsWriteFailure(res, 'تعذر جلب كشف حساب المورد من Google Sheets'),
      ledger: []
    };
  }

  const sup = memorySuppliers.find(s => s.id === supplierId);
  const allLedger = memorySupplierLedger
    .filter(l => l.supplierId === supplierId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const fromDate = filters?.from || null;
  const toDate = filters?.to || null;

  const hasOpeningEntry = allLedger.some(l => l.transactionType === 'رصيد افتتاحي');
  const baseOpening = hasOpeningEntry ? 0 : (Number(sup?.openingBalance) || 0);

  if (!fromDate && !toDate) {
    let runningAll = baseOpening;
    const fullLedger = allLedger.map(l => {
      runningAll += (Number(l.credit) || 0) - (Number(l.debit) || 0);
      return { ...l, balanceAfter: runningAll };
    });
    return {
      success: true,
      ledger: fullLedger,
      supplier: sup,
      openingBalanceForPeriod: Number(sup?.openingBalance) || 0
    };
  }

  let openingBalanceForPeriod = baseOpening;
  if (fromDate) {
    for (const l of allLedger) {
      const entryDateStr = toCairoDateStr(l.date);
      if (entryDateStr && entryDateStr < fromDate) {
        openingBalanceForPeriod += (Number(l.credit) || 0) - (Number(l.debit) || 0);
      }
    }
  }

  let runningPeriod = openingBalanceForPeriod;
  const inPeriod = allLedger
    .filter(l => isDateInRange(l.date, fromDate, toDate))
    .map(l => {
      runningPeriod += (Number(l.credit) || 0) - (Number(l.debit) || 0);
      return { ...l, balanceAfter: runningPeriod };
    });

  return {
    success: true,
    ledger: inPeriod,
    supplier: sup,
    openingBalanceForPeriod
  };
}

/**
 * إنشاء سند صرف أو قبض لمورد
 */
export async function createSupplierVoucher(
  payload: {
    supplierId: string;
    type: 'سند صرف' | 'سند قبض';
    amount: number;
    cashboxId: string;
    statement?: string;
    notes?: string;
    idempotencyKey?: string;
  },
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string }
): Promise<{ success: boolean; duplicate?: boolean; statusCode?: number; voucherId?: string; error?: string; code?: string }> {
  const idemKey = getValidatedIdempotencyKey(payload?.idempotencyKey);
  if (!idemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR };
  }

  const cached = getIdempotencyCachedResult('createSupplierVoucher', idemKey);
  if (cached) {
    return { success: true, duplicate: true, voucherId: cached.voucherId };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('createSupplierVoucher', { ...payload, idempotencyKey: idemKey }, session?.token);
    if (res.success) {
      setIdempotencyCachedResult('createSupplierVoucher', idemKey, { voucherId: res.voucherId });
      return { ...res, ...(res.duplicate ? { duplicate: true } : {}) };
    }
    return buildSheetsWriteFailure(res, 'تعذر حفظ سند المورد في Google Sheets');
  }

  const existingVoucher = memorySupplierLedger.find((e: any) => e.idempotencyKey === idemKey);
  if (existingVoucher) {
    setIdempotencyCachedResult('createSupplierVoucher', idemKey, { voucherId: existingVoucher.documentNumber });
    return { success: true, duplicate: true, voucherId: existingVoucher.documentNumber };
  }

  const supplier = memorySuppliers.find(s => s.id === payload.supplierId);
  if (!supplier) return { success: false, error: 'المورد غير موجود' };

  if (session?.role !== 'designer') {
    const callerUser = memoryUsers.find(u => u.phone === session?.phone || u.id === (session as any)?.userId);
    if (callerUser?.cashboxConfig) {
      const allowedIds = payload.type === 'سند قبض'
        ? callerUser.cashboxConfig.allowedReceiptCashboxIds
        : callerUser.cashboxConfig.allowedPaymentCashboxIds;
      if (allowedIds && allowedIds.length > 0 && !allowedIds.includes(payload.cashboxId)) {
        return { success: false, error: `غير مصرح: الخزينة المحددة غير مخصصة لك لسندات ${payload.type === 'سند قبض' ? 'القبض' : 'الصرف'}` };
      }
    }
  }

  const cashbox = memoryCashboxes.find(c => c.id === payload.cashboxId);
  if (!cashbox) return { success: false, error: 'الخزينة المحددة غير موجودة' };

  const amount = Number(payload.amount);
  if (isNaN(amount) || amount <= 0) return { success: false, error: 'المبلغ غير صالح' };

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = payload.type === 'سند صرف' ? 'PV' : 'RV';
  const docNumber = `${prefix}-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

  // في سند الصرف: ندفع للمورد -> رصيد المورد يقل (مدين لنا) -> الخزينة تنقص
  // في سند القبض: نسترد من المورد -> رصيد المورد يزيد (دائن علينا) -> الخزينة تزيد
  if (payload.type === 'سند صرف') {
    supplier.currentBalance -= amount;
    cashbox.currentBalance -= amount;
  } else {
    supplier.currentBalance += amount;
    cashbox.currentBalance += amount;
  }

  // 1. قيد دفتر أستاذ المورد
  const supLedgerEntry: any = {
    id: generateUUID(),
    date: now.toISOString(),
    supplierId: supplier.id,
    supplierName: supplier.name,
    transactionType: payload.type,
    documentNumber: docNumber,
    debit: payload.type === 'سند صرف' ? amount : 0,
    credit: payload.type === 'سند قبض' ? amount : 0,
    balanceAfter: supplier.currentBalance,
    statement: payload.statement || (payload.type === 'سند صرف' ? `سداد دفعة للمورد من ${cashbox.name}` : `استرداد نقدي من المورد إلى ${cashbox.name}`),
    userName: session?.name || session?.phone || 'المسؤول',
    notes: payload.notes || '',
    idempotencyKey: idemKey
  };
  memorySupplierLedger.push(supLedgerEntry);

  // 2. قيد حركة الخزينة
  memoryCashboxTransactions.push({
    id: generateUUID(),
    date: now.toISOString(),
    cashboxId: cashbox.id,
    cashboxName: cashbox.name,
    type: payload.type === 'سند صرف' ? 'سند صرف مورد' : 'إيداع',
    documentNumber: docNumber,
    amount: payload.type === 'سند صرف' ? -amount : amount,
    balanceAfter: cashbox.currentBalance,
    party: supplier.name,
    statement: `${payload.type} - ${supplier.name}`,
    userName: session?.name || session?.phone || 'المسؤول',
    notes: payload.notes
  });

  recordAuditLog(
    session || {},
    payload.type === 'سند صرف' ? 'SUPPLIER_PAYMENT' : 'SUPPLIER_RECEIPT',
    'Supplier',
    supplier.id,
    `تسجيل ${payload.type} رقم ${docNumber} بمبلغ ${amount} ج.م للمورد ${supplier.name}`
  );

  setIdempotencyCachedResult('createSupplierVoucher', idemKey, { voucherId: docNumber });
  return { success: true, voucherId: docNumber };
}

/**
 * جلب فواتير المشتريات
 */
export async function getPurchases(
  session?: { token?: string; role: UserRole; permissions: PermissionKey[] },
  filters?: { from?: string | null; to?: string | null }
): Promise<PurchaseInvoice[]> {
  const config = getSystemConfig();
  const rangeKey = filters?.from || filters?.to ? `${filters?.from || ''}_${filters?.to || ''}` : 'all';
  const cacheKey = `purchases:${rangeKey}`;
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getPurchases', { from: filters?.from, to: filters?.to }, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache(cacheKey, res.data);
      return res.data;
    }
    const cachedExact = getSheetsCache<PurchaseInvoice[]>(cacheKey);
    if (cachedExact) {
      return markArrayStale(cachedExact.data, cachedExact.lastSyncAt);
    }
    if (rangeKey !== 'all') {
      const cachedAll = getSheetsCache<PurchaseInvoice[]>('purchases:all');
      if (cachedAll) {
        return markArrayStale(
          cachedAll.data.filter(p => isDateInRange(p.date, filters?.from || null, filters?.to || null)),
          cachedAll.lastSyncAt
        );
      }
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب فواتير المشتريات من Google Sheets');
  }
  if (filters?.from || filters?.to) {
    return memoryPurchases.filter(p => isDateInRange(p.date, filters.from, filters.to));
  }
  return memoryPurchases;
}

/**
 * إنشاء فاتورة شراء واعتماد المخزون وحساب المورد والخزينة
 */
export async function createPurchase(
  payload: any,
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string }
): Promise<{ success: boolean; duplicate?: boolean; statusCode?: number; invoice?: PurchaseInvoice; error?: string; code?: string }> {
  const idemKey = getValidatedIdempotencyKey(payload?.idempotencyKey);
  if (!idemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR };
  }

  const cached = getIdempotencyCachedResult('createPurchase', idemKey);
  if (cached) {
    return { success: true, duplicate: true, invoice: cached };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('createPurchase', { ...payload, idempotencyKey: idemKey }, session?.token);
    if (res.success && res.invoice) {
      setIdempotencyCachedResult('createPurchase', idemKey, res.invoice);
      return { success: true, invoice: res.invoice, ...(res.duplicate ? { duplicate: true } : {}) };
    }
    return buildSheetsWriteFailure(res, 'تعذر حفظ فاتورة الشراء في Google Sheets');
  }

  const existingPur = memoryPurchases.find(p => p.idempotencyKey === idemKey);
  if (existingPur) {
    setIdempotencyCachedResult('createPurchase', idemKey, existingPur);
    return { success: true, duplicate: true, invoice: existingPur };
  }

  const supplier = memorySuppliers.find(s => s.id === payload.supplierId);
  if (!supplier) return { success: false, error: 'المورد المحدد غير مسجل' };

  const lines: any[] = payload.lines || [];
  if (lines.length === 0) return { success: false, error: 'يجب إضافة أصناف لفاتورة الشراء' };

  const whRes = resolveWarehouseForOperation(
    payload.warehouseId || payload.warehouseName,
    session as any,
    {
      fallbackWarehouseId: getDefaultWarehouse().id,
      requireActive: true,
      enforceUserAccess: true
    }
  );
  if (!whRes.ok) {
    return { success: false, statusCode: whRes.statusCode, error: whRes.error };
  }
  const purchaseTargetWh = whRes.warehouse;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const invoiceNumber = payload.invoiceNumber || `PUR-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

  let subtotal = 0;
  let taxTotal = 0;
  let discountTotal = Number(payload.discountAmount || 0);
  let shippingTotal = Number(payload.shippingFee || 0);

  const purchaseLines: PurchaseLine[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const qty = Number(line.quantity || 1);
    const unitCost = Number(line.unitCost || 0);
    const taxRate = Number(line.taxRate || 0);
    const taxAmount = (unitCost * qty) * (taxRate / 100);
    const lineDiscount = Number(line.discountAmount || 0);
    const totalLine = (unitCost * qty) + taxAmount - lineDiscount;

    subtotal += unitCost * qty;
    taxTotal += taxAmount;

    // زيادة رصيد المخزن المحدد فقط وإعادة حساب إجمالي الصنف
    const item = memoryItems.find(it => it.id === line.itemId);
    if (item) {
      const beforeQty = getItemWarehouseStock(item.id, purchaseTargetWh.id);
      const adj = adjustItemWarehouseDelta(item.id, purchaseTargetWh.id, qty);
      // تحديث سعر الشراء الأخير للصنف إذا كان جديدًا
      if (unitCost > 0) item.purchasePrice = unitCost;

      // تسجيل حركة مخزنية رسمية StockMovement
      memoryStockMovements.push({
        id: generateUUID(),
        date: now.toISOString(),
        itemId: item.id,
        itemName: item.name,
        warehouseId: purchaseTargetWh.id,
        warehouseName: purchaseTargetWh.name,
        movementType: 'شراء',
        documentNumber: invoiceNumber,
        quantity: qty,
        quantityBefore: beforeQty,
        quantityAfter: adj.balanceInWarehouse,
        balanceAfter: adj.balanceInWarehouse,
        notes: `فاتورة شراء من المورد: ${supplier.name} - مخزن ${purchaseTargetWh.name}`,
        userName: session?.name || session?.phone || 'المسؤول'
      });
    }

    purchaseLines.push({
      invoiceNumber,
      lineIndex: idx + 1,
      itemId: line.itemId,
      sku: line.sku || '',
      itemName: line.itemName || item?.name || 'صنف مشتريات',
      quantity: qty,
      receivedQuantity: qty,
      unitCost,
      packagingCost: line.packagingCost || 0,
      taxRate,
      taxAmount,
      discountAmount: lineDiscount,
      totalLine,
      barcode: line.barcode || item?.barcode || '',
      notes: line.notes || ''
    });
  }

  const netTotal = subtotal + taxTotal - discountTotal + shippingTotal;

  // تحديد نوع السداد
  let paymentType: 'نقدي' | 'آجل' | 'جزئي' = payload.paymentType;
  if (!paymentType) {
    const pAmt = Number(payload.paidAmount || 0);
    if (pAmt <= 0) paymentType = 'آجل';
    else if (pAmt >= netTotal) paymentType = 'نقدي';
    else paymentType = 'جزئي';
  }

  let paidAmount = 0;
  let remainingAmount = 0;

  if (paymentType === 'نقدي') {
    paidAmount = netTotal;
    remainingAmount = 0;
  } else if (paymentType === 'آجل') {
    paidAmount = 0;
    remainingAmount = netTotal;
  } else {
    paidAmount = Math.max(0, Math.min(Number(payload.paidAmount || 0), netTotal));
    remainingAmount = Math.max(0, netTotal - paidAmount);
  }

  // التحقق من الخزينة عند وجود دفع نقدي
  let selectedCashbox: Cashbox | undefined = undefined;
  if (paidAmount > 0) {
    if (!payload.cashboxId) {
      return { success: false, error: 'يرجى تحديد الخزينة التي تم سداد المبلغ النقدي منها' };
    }
    selectedCashbox = memoryCashboxes.find(c => c.id === payload.cashboxId);
    if (!selectedCashbox) {
      return { success: false, error: 'الخزينة المحددة غير مسجلة بالنظام' };
    }
    if (selectedCashbox.currentBalance < paidAmount) {
      return {
        success: false,
        error: `رصيد الخزينة "${selectedCashbox.name}" (${selectedCashbox.currentBalance} ج.م) لا يكفي لسداد مشتريات بقيمة (${paidAmount} ج.م)`
      };
    }
    selectedCashbox.currentBalance -= paidAmount;

    // تسجيل خروج النقدية من الخزينة
    memoryCashboxTransactions.push({
      id: generateUUID(),
      date: now.toISOString(),
      cashboxId: selectedCashbox.id,
      cashboxName: selectedCashbox.name,
      type: 'سداد مشتريات',
      documentNumber: invoiceNumber,
      amount: -paidAmount,
      balanceAfter: selectedCashbox.currentBalance,
      party: supplier.name,
      statement: paymentType === 'جزئي'
        ? `سداد دفعة مسددة لفاتورة شراء ${invoiceNumber} (إجمالي: ${netTotal} ج.م، مسدد: ${paidAmount} ج.م)`
        : `سداد قيمة فاتورة شراء ${invoiceNumber} نقداً بالكامل`,
      userName: session?.name || session?.phone || 'المسؤول'
    });
  }

  // ترحيل حساب المورد
  // 1) قيد استحقاق الفاتورة في دفتر أستاذ المورد
  supplier.currentBalance += remainingAmount;

  memorySupplierLedger.push({
    id: generateUUID(),
    date: now.toISOString(),
    supplierId: supplier.id,
    supplierName: supplier.name,
    transactionType: 'فاتورة شراء',
    documentNumber: invoiceNumber,
    debit: 0,
    credit: netTotal,
    balanceAfter: (supplier.currentBalance - remainingAmount) + netTotal,
    statement: `فاتورة شراء رقم ${invoiceNumber} (إجمالي: ${netTotal} ج.م)`,
    userName: session?.name || session?.phone || 'المسؤول',
    notes: payload.notes
  });

  // 2) إذا تم دفع جزء أو كل المبلغ من الخزينة، إثبات قيد السداد في كشف حساب المورد
  if (paidAmount > 0) {
    memorySupplierLedger.push({
      id: generateUUID(),
      date: now.toISOString(),
      supplierId: supplier.id,
      supplierName: supplier.name,
      transactionType: 'سداد فاتورة شراء',
      documentNumber: invoiceNumber,
      debit: paidAmount,
      credit: 0,
      balanceAfter: supplier.currentBalance,
      statement: `سداد نقدية من ${selectedCashbox?.name || 'الخزينة'} لفاتورة شراء رقم ${invoiceNumber}`,
      userName: session?.name || session?.phone || 'المسؤول',
      notes: payload.notes
    });
  }

  const purchaseInvoice: PurchaseInvoice = {
    invoiceNumber,
    supplierInvoiceNumber: payload.supplierInvoiceNumber || '',
    date: now.toISOString(),
    supplierId: supplier.id,
    supplierName: supplier.name,
    subtotal,
    taxAmount: taxTotal,
    discountAmount: discountTotal,
    shippingFee: shippingTotal,
    netTotal,
    paidAmount,
    remainingAmount,
    paymentStatus: remainingAmount === 0 ? 'مدفوع بالكامل' : (paidAmount > 0 ? 'مدفوع جزئياً' : 'آجل'),
    paymentMethod: payload.paymentMethod || (paymentType === 'نقدي' ? 'نقدي' : paymentType === 'آجل' ? 'آجل' : 'جزئي'),
    paymentType,
    cashboxId: selectedCashbox?.id,
    cashboxName: selectedCashbox?.name,
    warehouseId: purchaseTargetWh.id,
    warehouseName: purchaseTargetWh.name,
    receivingStatus: 'مستلم بالكامل',
    createdBy: session?.name || session?.phone || 'المسؤول',
    notes: payload.notes || '',
    createdAt: now.toISOString(),
    idempotencyKey: idemKey,
    lines: purchaseLines
  };

  memoryPurchases.unshift(purchaseInvoice);
  setIdempotencyCachedResult('createPurchase', idemKey, purchaseInvoice);

  recordAuditLog(
    session || {},
    'PURCHASE_CREATE',
    'Purchase',
    invoiceNumber,
    `إنشاء فاتورة شراء رقم ${invoiceNumber} من المورد ${supplier.name} بقيمة صافية: ${netTotal} ج.م (مسدد: ${paidAmount} ج.م)`
  );

  return { success: true, invoice: purchaseInvoice };
}

/**
 * جلب مرتجعات المشتريات
 */
export async function getPurchaseReturns(
  session?: { token?: string },
  filters?: { from?: string | null; to?: string | null }
): Promise<PurchaseReturn[]> {
  const config = getSystemConfig();
  const rangeKey = filters?.from || filters?.to ? `${filters?.from || ''}_${filters?.to || ''}` : 'all';
  const cacheKey = `purchaseReturns:${rangeKey}`;
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getPurchaseReturns', { from: filters?.from, to: filters?.to }, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache(cacheKey, res.data);
      return res.data;
    }
    const cachedExact = getSheetsCache<PurchaseReturn[]>(cacheKey);
    if (cachedExact) {
      return markArrayStale(cachedExact.data, cachedExact.lastSyncAt);
    }
    if (rangeKey !== 'all') {
      const cachedAll = getSheetsCache<PurchaseReturn[]>('purchaseReturns:all');
      if (cachedAll) {
        return markArrayStale(
          cachedAll.data.filter(pr => isDateInRange(pr.date, filters?.from || null, filters?.to || null)),
          cachedAll.lastSyncAt
        );
      }
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب مرتجعات المشتريات من Google Sheets');
  }
  if (filters?.from || filters?.to) {
    return memoryPurchaseReturns.filter(pr => isDateInRange(pr.date, filters.from, filters.to));
  }
  return memoryPurchaseReturns;
}

/**
 * تسجيل مرتجع مشتريات
 */
export async function createPurchaseReturn(
  payload: any,
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string }
): Promise<{ success: boolean; duplicate?: boolean; statusCode?: number; returnRecord?: PurchaseReturn; error?: string; code?: string }> {
  const idemKey = getValidatedIdempotencyKey(payload?.idempotencyKey);
  if (!idemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR };
  }

  const cached = getIdempotencyCachedResult('createPurchaseReturn', idemKey);
  if (cached) {
    return { success: true, duplicate: true, returnRecord: cached };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('createPurchaseReturn', { ...payload, idempotencyKey: idemKey }, session?.token);
    if (res.success && res.returnRecord) {
      setIdempotencyCachedResult('createPurchaseReturn', idemKey, res.returnRecord);
      return { success: true, returnRecord: res.returnRecord, ...(res.duplicate ? { duplicate: true } : {}) };
    }
    return buildSheetsWriteFailure(res, 'تعذر حفظ مرتجع الشراء في Google Sheets');
  }

  const existingPRet = memoryPurchaseReturns.find(pr => pr.idempotencyKey === idemKey);
  if (existingPRet) {
    setIdempotencyCachedResult('createPurchaseReturn', idemKey, existingPRet);
    return { success: true, duplicate: true, returnRecord: existingPRet };
  }

  const supplier = memorySuppliers.find(s => s.id === payload.supplierId);
  if (!supplier) return { success: false, error: 'المورد غير موجود بالنظام' };

  const lines: any[] = payload.lines || [];
  if (lines.length === 0) return { success: false, error: 'يجب اختيار بنود صالحة لمرتجع الشراء' };

  // إذا تم الربط بفاتورة شراء أصلية: التحقق الصارم من الكميات المتاحة للإرجاع
  const purchaseInvoiceNumber = payload.purchaseInvoiceNumber;
  let originalPurchase: PurchaseInvoice | undefined = undefined;

  if (purchaseInvoiceNumber) {
    originalPurchase = memoryPurchases.find(p => p.invoiceNumber === purchaseInvoiceNumber);
    if (!originalPurchase) {
      return { success: false, error: `فاتورة الشراء الأصلية ${purchaseInvoiceNumber} غير موجودة` };
    }
    if (originalPurchase.receivingStatus === 'ملغاة') {
      return { success: false, error: 'لا يمكن عمل مرتجع لفاتورة شراء ملغاة' };
    }

    // حساب المرتجعات السابقة على هذه الفاتورة
    const prevPurchaseReturns = memoryPurchaseReturns.filter(pr => pr.purchaseInvoiceNumber === purchaseInvoiceNumber);
    const previouslyReturnedMap: Record<string, number> = {};
    for (const pr of prevPurchaseReturns) {
      for (const prLine of (pr.lines || [])) {
        previouslyReturnedMap[prLine.itemId] = (previouslyReturnedMap[prLine.itemId] || 0) + Number(prLine.quantity || 0);
      }
    }

    // التحقق من كل بند
    for (const ln of lines) {
      const origLine = (originalPurchase.lines || []).find(l => l.itemId === ln.itemId);
      const purchasedQty = origLine ? origLine.quantity : 0;
      const alreadyReturned = previouslyReturnedMap[ln.itemId] || 0;
      const maxAllowed = Math.max(0, purchasedQty - alreadyReturned);
      const returnQty = Number(ln.quantity || 1);

      if (returnQty > maxAllowed) {
        return {
          success: false,
          error: `الكمية المرتجعة للصنف "${ln.itemName || ln.itemId}" (${returnQty}) تتجاوز الكمية المتبقية القابلة للإرجاع (${maxAllowed}) من فاتورة الشراء ${purchaseInvoiceNumber}`
        };
      }
    }
  }

  const pReturnWhRes = resolveWarehouseForOperation(
    payload.warehouseId || originalPurchase?.warehouseId,
    session as any,
    {
      fallbackWarehouseId: originalPurchase?.warehouseId || getDefaultWarehouse().id,
      requireActive: Boolean(payload.warehouseId),
      enforceUserAccess: true,
      allowFallbackWhenOmitted: !payload.warehouseId
    }
  );
  if (!pReturnWhRes.ok) {
    return { success: false, statusCode: pReturnWhRes.statusCode, error: pReturnWhRes.error };
  }
  const pReturnTargetWh = pReturnWhRes.warehouse;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const returnNumber = payload.returnNumber || `PRET-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

  let totalAmount = 0;
  let taxAmount = 0;
  const returnLines: PurchaseReturnLine[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const ln = lines[idx];
    const qty = Number(ln.quantity || 1);
    if (qty <= 0) continue;

    const unitCost = Number(ln.unitCost || ln.unitPrice || 0);
    const lineTax = Number(ln.taxAmount || 0);
    const lineTotal = (unitCost * qty) + lineTax;

    totalAmount += unitCost * qty;
    taxAmount += lineTax;

    // إنقاص رصيد المخزن المحدد فقط وتسجيل حركة خروج StockMovement
    const item = memoryItems.find(it => it.id === ln.itemId);
    if (item) {
      const beforeQty = getItemWarehouseStock(item.id, pReturnTargetWh.id);
      const nextWhQty = setItemWarehouseBalance(item.id, pReturnTargetWh.id, Math.max(0, beforeQty - qty));
      memoryStockMovements.push({
        id: generateUUID(),
        date: now.toISOString(),
        itemId: item.id,
        itemName: item.name,
        warehouseId: pReturnTargetWh.id,
        warehouseName: pReturnTargetWh.name,
        movementType: 'مرتجع شراء',
        documentNumber: returnNumber,
        quantity: -qty,
        quantityBefore: beforeQty,
        quantityAfter: nextWhQty,
        balanceAfter: nextWhQty,
        notes: `مرتجع مشتريات للمورد: ${supplier.name} - مخزن ${pReturnTargetWh.name} ${purchaseInvoiceNumber ? `(فاتورة: ${purchaseInvoiceNumber})` : ''}`,
        userName: session?.name || session?.phone || 'المسؤول'
      });
    }

    returnLines.push({
      returnNumber,
      lineIndex: idx + 1,
      itemId: ln.itemId,
      itemName: ln.itemName || item?.name || 'صنف',
      quantity: qty,
      unitCost,
      taxAmount: lineTax,
      totalLine: lineTotal,
      condition: ln.condition || 'سليم'
    });
  }

  if (returnLines.length === 0) {
    return { success: false, error: 'يرجى تحديد كميات صالحة لمرتجع الشراء' };
  }

  const netTotal = totalAmount + taxAmount;
  const refundStatus: 'استرداد نقدي' | 'قيد على الحساب' = payload.refundStatus || (payload.cashboxId ? 'استرداد نقدي' : 'قيد على الحساب');
  let selectedCashbox: Cashbox | undefined = undefined;

  if (refundStatus === 'استرداد نقدي') {
    if (!payload.cashboxId) {
      return { success: false, error: 'يرجى تحديد الخزينة التي تم استلام المبلغ النقدي المردود فيها' };
    }
    selectedCashbox = memoryCashboxes.find(c => c.id === payload.cashboxId);
    if (!selectedCashbox) {
      return { success: false, error: 'الخزينة المحددة غير مسجلة' };
    }

    // دخول المبلغ المسترد للخزينة
    selectedCashbox.currentBalance += netTotal;
    memoryCashboxTransactions.push({
      id: generateUUID(),
      date: now.toISOString(),
      cashboxId: selectedCashbox.id,
      cashboxName: selectedCashbox.name,
      type: 'استرداد مرتجع مشتريات',
      documentNumber: returnNumber,
      amount: netTotal,
      balanceAfter: selectedCashbox.currentBalance,
      party: supplier.name,
      statement: `استرداد نقدي لمرتجع مشتريات ${returnNumber} إلى ${selectedCashbox.name}`,
      userName: session?.name || session?.phone || 'المسؤول'
    });

    // إثبات المرتجع واستلام النقدية في دفتر أستاذ المورد
    memorySupplierLedger.push({
      id: generateUUID(),
      date: now.toISOString(),
      supplierId: supplier.id,
      supplierName: supplier.name,
      transactionType: 'مرتجع شراء',
      documentNumber: returnNumber,
      debit: netTotal,
      credit: 0,
      balanceAfter: supplier.currentBalance - netTotal,
      statement: `مرتجع مشتريات رقم ${returnNumber}`,
      userName: session?.name || session?.phone || 'المسؤول',
      notes: payload.notes
    });

    memorySupplierLedger.push({
      id: generateUUID(),
      date: now.toISOString(),
      supplierId: supplier.id,
      supplierName: supplier.name,
      transactionType: 'استرداد مرتجع شراء',
      documentNumber: returnNumber,
      debit: 0,
      credit: netTotal,
      balanceAfter: supplier.currentBalance,
      statement: `استلام نقدي مسترد لمرتجع ${returnNumber} في ${selectedCashbox.name}`,
      userName: session?.name || session?.phone || 'المسؤول',
      notes: payload.notes
    });
  } else {
    // قيد على الحساب وتخفيض مديونية المورد
    supplier.currentBalance = Math.max(0, supplier.currentBalance - netTotal);

    memorySupplierLedger.push({
      id: generateUUID(),
      date: now.toISOString(),
      supplierId: supplier.id,
      supplierName: supplier.name,
      transactionType: 'مرتجع شراء',
      documentNumber: returnNumber,
      debit: netTotal,
      credit: 0,
      balanceAfter: supplier.currentBalance,
      statement: `مرتجع مشتريات وقيد على الحساب رقم ${returnNumber}`,
      userName: session?.name || session?.phone || 'المسؤول',
      notes: payload.notes
    });
  }

  const pReturn: PurchaseReturn = {
    returnNumber,
    purchaseInvoiceNumber: purchaseInvoiceNumber || '',
    date: now.toISOString(),
    warehouseId: pReturnTargetWh.id,
    warehouseName: pReturnTargetWh.name,
    supplierId: supplier.id,
    supplierName: supplier.name,
    totalAmount,
    taxAmount,
    netTotal,
    refundStatus,
    cashboxId: selectedCashbox?.id,
    cashboxName: selectedCashbox?.name,
    refundedAmount: refundStatus === 'استرداد نقدي' ? netTotal : undefined,
    reason: payload.reason || 'إرجاع بضاعة للمورد',
    createdBy: session?.name || session?.phone || 'المسؤول',
    notes: payload.notes || '',
    idempotencyKey: idemKey,
    lines: returnLines
  };

  memoryPurchaseReturns.unshift(pReturn);
  setIdempotencyCachedResult('createPurchaseReturn', idemKey, pReturn);

  recordAuditLog(
    session || {},
    'PURCHASE_RETURN',
    'PurchaseReturn',
    returnNumber,
    `تسجيل مرتجع شراء ${returnNumber} للمورد ${supplier.name} بقيمة: ${netTotal} ج.م (طريقة الرد: ${refundStatus})`
  );

  return { success: true, returnRecord: pReturn };
}

// ===================== 17. العملاء (Customers) ===================== //

/**
 * جلب قائمة العملاء
 */
export async function getCustomers(session?: { token?: string }): Promise<Customer[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getCustomers', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache('customers', res.data);
      return res.data;
    }
    const cached = getSheetsCache<Customer[]>('customers');
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب العملاء من Google Sheets');
  }
  return memoryCustomers.map(c => ({
    ...c,
    currentBalance: computePartyBalance('customer', c.id)
  }));
}

/**
 * حفظ أو تعديل عميل
 */
export async function saveCustomer(
  customer: Partial<Customer> & { name: string },
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string }
): Promise<{ success: boolean; customer?: Customer; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res: any = await callAppsScript('saveCustomer', customer, session?.token);
    if (res.success && res.customer) return { success: true, customer: res.customer };
    return buildSheetsWriteFailure(res, 'تعذر حفظ العميل في Google Sheets');
  }

  const isEdit = Boolean(customer.id);
  let saved: Customer;

  if (isEdit) {
    const idx = memoryCustomers.findIndex(c => c.id === customer.id);
    if (idx === -1) return { success: false, error: 'العميل غير موجود' };
    saved = {
      ...memoryCustomers[idx],
      ...customer,
      name: customer.name.trim()
    };
    memoryCustomers[idx] = saved;
    recordAuditLog(session || {}, 'CUSTOMER_EDIT', 'Customer', saved.id, `تعديل بيانات العميل: ${saved.name}`);
  } else {
    const newId = customer.id || `cust-${Date.now().toString(36)}`;
    const opening = Number(customer.openingBalance || 0);
    saved = {
      id: newId,
      name: customer.name.trim(),
      code: customer.code || `CUST-${Math.floor(100 + Math.random() * 900)}`,
      groupId: customer.groupId || '',
      phone: customer.phone || '',
      phoneSecondary: customer.phoneSecondary || '',
      email: customer.email || '',
      city: customer.city || '',
      address: customer.address || '',
      zoneId: customer.zoneId || '',
      taxNumber: customer.taxNumber || '',
      creditLimit: Number(customer.creditLimit || 0),
      openingBalance: opening,
      currentBalance: opening,
      status: customer.status || 'active',
      notes: customer.notes || '',
      createdAt: new Date().toISOString()
    };
    memoryCustomers.unshift(saved);

    // تسجيل الرصيد الافتتاحي في دفتر الأستاذ
    if (opening !== 0) {
      memoryCustomerLedger.push({
        id: generateUUID(),
        date: new Date().toISOString(),
        customerId: saved.id,
        customerName: saved.name,
        transactionType: 'رصيد افتتاحي',
        documentNumber: `OPN-${saved.code || saved.id}`,
        debit: opening > 0 ? opening : 0,
        credit: opening < 0 ? Math.abs(opening) : 0,
        balanceAfter: opening,
        statement: 'تسجيل رصيد افتتاحي للعميل',
        userName: session?.name || session?.phone || 'المسؤول'
      });
    }

    recordAuditLog(session || {}, 'CUSTOMER_CREATE', 'Customer', saved.id, `إضافة عميل جديد: ${saved.name}`);
  }

  return { success: true, customer: saved };
}

/**
 * جلب مجموعات العملاء
 */
export async function getCustomerGroups(session?: { token?: string }): Promise<CustomerGroup[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getCustomerGroups', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache('customerGroups', res.data);
      return res.data;
    }
    const cached = getSheetsCache<CustomerGroup[]>('customerGroups');
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب مجموعات العملاء من Google Sheets');
  }
  return memoryCustomerGroups;
}

/**
 * حفظ مجموعة عملاء
 */
export async function saveCustomerGroup(group: Partial<CustomerGroup> & { name: string }, session?: { token?: string }): Promise<{ success: boolean; group?: CustomerGroup; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res: any = await callAppsScript('saveCustomerGroup', group, session?.token);
    if (res.success && res.group) return { success: true, group: res.group };
    return buildSheetsWriteFailure(res, 'تعذر حفظ مجموعة العملاء في Google Sheets');
  }

  const newGroup: CustomerGroup = {
    id: group.id || `cgrp-${Date.now().toString(36)}`,
    name: group.name.trim(),
    discountPercent: Number(group.discountPercent || 0),
    description: group.description || '',
    createdAt: new Date().toISOString()
  };
  const idx = memoryCustomerGroups.findIndex(g => g.id === newGroup.id);
  if (idx >= 0) {
    memoryCustomerGroups[idx] = newGroup;
  } else {
    memoryCustomerGroups.push(newGroup);
  }
  return { success: true, group: newGroup };
}

/**
 * جلب كشف حساب العميل
 */
export async function getCustomerLedger(
  customerId: string,
  session?: { token?: string },
  filters?: { from?: string | null; to?: string | null }
): Promise<{ success: boolean; ledger: CustomerLedgerEntry[]; customer?: Customer; openingBalanceForPeriod?: number; error?: string; code?: string; stale?: boolean; lastSyncAt?: string }> {
  const config = getSystemConfig();
  const cacheKey = `customerLedger:${customerId}:${filters?.from || ''}:${filters?.to || ''}`;
  if (isSheetsDataMode(config)) {
    const res: any = await callAppsScript('getCustomerLedger', { customerId, from: filters?.from, to: filters?.to }, session?.token);
    if (res.success && Array.isArray(res.ledger)) {
      setSheetsCache(cacheKey, res);
      return res;
    }
    const cached = getSheetsCache<any>(cacheKey);
    if (cached) {
      return {
        ...cached.data,
        stale: true,
        lastSyncAt: cached.lastSyncAt
      };
    }
    return {
      ...buildSheetsWriteFailure(res, 'تعذر جلب كشف حساب العميل من Google Sheets'),
      ledger: []
    };
  }

  const cust = memoryCustomers.find(c => c.id === customerId);
  const allLedger = memoryCustomerLedger
    .filter(l => l.customerId === customerId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const fromDate = filters?.from || null;
  const toDate = filters?.to || null;

  const hasOpeningEntry = allLedger.some(l => l.transactionType === 'رصيد افتتاحي');
  const baseOpening = hasOpeningEntry ? 0 : (Number(cust?.openingBalance) || 0);

  if (!fromDate && !toDate) {
    let runningAll = baseOpening;
    const fullLedger = allLedger.map(l => {
      runningAll += (Number(l.debit) || 0) - (Number(l.credit) || 0);
      return { ...l, balanceAfter: runningAll };
    });
    return {
      success: true,
      ledger: fullLedger,
      customer: cust,
      openingBalanceForPeriod: Number(cust?.openingBalance) || 0
    };
  }

  let openingBalanceForPeriod = baseOpening;
  if (fromDate) {
    for (const l of allLedger) {
      const entryDateStr = toCairoDateStr(l.date);
      if (entryDateStr && entryDateStr < fromDate) {
        openingBalanceForPeriod += (Number(l.debit) || 0) - (Number(l.credit) || 0);
      }
    }
  }

  let runningPeriod = openingBalanceForPeriod;
  const inPeriod = allLedger
    .filter(l => isDateInRange(l.date, fromDate, toDate))
    .map(l => {
      runningPeriod += (Number(l.debit) || 0) - (Number(l.credit) || 0);
      return { ...l, balanceAfter: runningPeriod };
    });

  return {
    success: true,
    ledger: inPeriod,
    customer: cust,
    openingBalanceForPeriod
  };
}

/**
 * سند قبض أو صرف لعميل
 */
export async function createCustomerVoucher(
  payload: {
    customerId: string;
    type: 'سند قبض' | 'سند صرف';
    amount: number;
    cashboxId: string;
    statement?: string;
    notes?: string;
    idempotencyKey?: string;
  },
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string }
): Promise<{ success: boolean; duplicate?: boolean; statusCode?: number; voucherId?: string; error?: string; code?: string }> {
  const idemKey = getValidatedIdempotencyKey(payload?.idempotencyKey);
  if (!idemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR };
  }

  const cached = getIdempotencyCachedResult('createCustomerVoucher', idemKey);
  if (cached) {
    return { success: true, duplicate: true, voucherId: cached.voucherId };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('createCustomerVoucher', { ...payload, idempotencyKey: idemKey }, session?.token);
    if (res.success) {
      setIdempotencyCachedResult('createCustomerVoucher', idemKey, { voucherId: res.voucherId });
      return { ...res, ...(res.duplicate ? { duplicate: true } : {}) };
    }
    return buildSheetsWriteFailure(res, 'تعذر حفظ سند العميل في Google Sheets');
  }

  const existingVoucher = memoryCustomerLedger.find((e: any) => e.idempotencyKey === idemKey);
  if (existingVoucher) {
    setIdempotencyCachedResult('createCustomerVoucher', idemKey, { voucherId: existingVoucher.documentNumber });
    return { success: true, duplicate: true, voucherId: existingVoucher.documentNumber };
  }

  const customer = memoryCustomers.find(c => c.id === payload.customerId);
  if (!customer) return { success: false, error: 'العميل غير مسجل' };

  if (session?.role !== 'designer') {
    const callerUser = memoryUsers.find(u => u.phone === session?.phone || u.id === (session as any)?.userId);
    if (callerUser?.cashboxConfig) {
      const allowedIds = payload.type === 'سند قبض'
        ? callerUser.cashboxConfig.allowedReceiptCashboxIds
        : callerUser.cashboxConfig.allowedPaymentCashboxIds;
      if (allowedIds && allowedIds.length > 0 && !allowedIds.includes(payload.cashboxId)) {
        return { success: false, error: `غير مصرح: الخزينة المحددة غير مخصصة لك لسندات ${payload.type === 'سند قبض' ? 'القبض' : 'الصرف'}` };
      }
    }
  }

  const cashbox = memoryCashboxes.find(c => c.id === payload.cashboxId);
  if (!cashbox) return { success: false, error: 'الخزينة غير مسجلة' };

  const amount = Number(payload.amount);
  if (isNaN(amount) || amount <= 0) return { success: false, error: 'المبلغ غير صالح' };

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = payload.type === 'سند قبض' ? 'RV' : 'PV';
  const docNumber = `${prefix}-CUST-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

  // سند قبض من عميل: العميل يسدد مديونيته -> رصيده يقل (دائن له) -> الخزينة تزيد
  // سند صرف لعميل: رد أموال للعميل -> رصيد العميل يزيد -> الخزينة تنقص
  if (payload.type === 'سند قبض') {
    customer.currentBalance -= amount;
    cashbox.currentBalance += amount;
  } else {
    customer.currentBalance += amount;
    cashbox.currentBalance -= amount;
  }

  // 1. دفتر أستاذ العميل
  const custLedgerEntry: any = {
    id: generateUUID(),
    date: now.toISOString(),
    customerId: customer.id,
    customerName: customer.name,
    transactionType: payload.type,
    documentNumber: docNumber,
    debit: payload.type === 'سند صرف' ? amount : 0,
    credit: payload.type === 'سند قبض' ? amount : 0,
    balanceAfter: customer.currentBalance,
    statement: payload.statement || (payload.type === 'سند قبض' ? `تحصيل دفعة من العميل إلى ${cashbox.name}` : `صرف مستحقات للعميل من ${cashbox.name}`),
    userName: session?.name || session?.phone || 'المسؤول',
    notes: payload.notes || '',
    idempotencyKey: idemKey
  };
  memoryCustomerLedger.push(custLedgerEntry);

  // 2. حركة الخزينة
  memoryCashboxTransactions.push({
    id: generateUUID(),
    date: now.toISOString(),
    cashboxId: cashbox.id,
    cashboxName: cashbox.name,
    type: payload.type === 'سند قبض' ? 'سند قبض عميل' : 'سحب',
    documentNumber: docNumber,
    amount: payload.type === 'سند قبض' ? amount : -amount,
    balanceAfter: cashbox.currentBalance,
    party: customer.name,
    statement: `${payload.type} - ${customer.name}`,
    userName: session?.name || session?.phone || 'المسؤول',
    notes: payload.notes
  });

  recordAuditLog(
    session || {},
    payload.type === 'سند قبض' ? 'CUSTOMER_RECEIPT' : 'CUSTOMER_PAYMENT',
    'Customer',
    customer.id,
    `تسجيل ${payload.type} رقم ${docNumber} بمبلغ ${amount} ج.م للعميل ${customer.name}`
  );

  setIdempotencyCachedResult('createCustomerVoucher', idemKey, { voucherId: docNumber });
  return { success: true, voucherId: docNumber };
}

// ===================== 18. الخزائن والتحويلات المالية (Cashboxes & Transfers) ===================== //

/**
 * جلب خزن لوحة التحكم المخصصة للمستخدم الحالي وفق الصلاحيات والتعيينات
 */
export async function getDashboardCashboxes(session: {
  userId: string;
  role: UserRole;
  isOwner?: boolean;
  token?: string;
}): Promise<DashboardCashbox[]> {
  const config = getSystemConfig();
  const cacheKey = `dashboardCashboxes:${session.userId}:${session.role}`;
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getDashboardCashboxes', {}, session.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache(cacheKey, res.data);
      return res.data;
    }
    const cached = getSheetsCache<DashboardCashbox[]>(cacheKey);
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'فشل جلب بيانات الخزن من Google Sheets');
  }

  const isDesigner = session.role === 'designer' || Boolean(session.isOwner);

  if (isDesigner) {
    return memoryCashboxes.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type || 'نقدية محلية',
      currency: c.currency || 'EGP',
      currentBalance: Number(c.currentBalance || 0),
      status: c.status,
      permissionType: 'إدارة كاملة'
    }));
  }

  // مستخدم عادي معه الصلاحية: الخزن المعينة له والنشطة فقط
  const userAssignments = memoryUserCashboxAssignments.filter(a => {
    const isUserMatch = a.userId === session.userId;
    const isAssignActive = a.status === 'active' || (a.status as any) === 'نشطة' || !a.status;
    return isUserMatch && isAssignActive;
  });

  const assignedMap = new Map<string, string>();
  userAssignments.forEach(a => {
    assignedMap.set(a.cashboxId, a.permissionType || 'إيداع وسحب');
  });

  const result: DashboardCashbox[] = [];
  for (const c of memoryCashboxes) {
    const isInactive = c.status === 'inactive' || (c.status as any) === 'موقوفة';
    if (isInactive) continue;

    const permType = assignedMap.get(c.id);
    if (permType) {
      result.push({
        id: c.id,
        name: c.name,
        type: c.type || 'نقدية محلية',
        currency: c.currency || 'EGP',
        currentBalance: Number(c.currentBalance || 0),
        status: c.status,
        permissionType: permType
      });
    }
  }

  return result;
}

/**
 * جلب قائمة الخزائن
 */
export async function getCashboxes(session?: { token?: string }): Promise<Cashbox[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getCashboxes', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache('cashboxes', res.data);
      return res.data;
    }
    const cached = getSheetsCache<Cashbox[]>('cashboxes');
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب قائمة الخزن من Google Sheets');
  }
  return memoryCashboxes;
}

/**
 * حفظ أو إضافة خزينة
 */
export async function saveCashbox(cashbox: Partial<Cashbox> & { name: string }, session?: { token?: string }): Promise<{ success: boolean; cashbox?: Cashbox; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res: any = await callAppsScript('saveCashbox', cashbox, session?.token);
    if (res.success && res.cashbox) return { success: true, cashbox: res.cashbox };
    return buildSheetsWriteFailure(res, 'تعذر حفظ الخزينة في Google Sheets');
  }

  const isEdit = Boolean(cashbox.id);
  let saved: Cashbox;

  if (isEdit) {
    const idx = memoryCashboxes.findIndex(c => c.id === cashbox.id);
    if (idx === -1) return { success: false, error: 'الخزينة غير مسجلة' };
    saved = {
      ...memoryCashboxes[idx],
      ...cashbox,
      name: cashbox.name.trim()
    };
    memoryCashboxes[idx] = saved;
  } else {
    const opening = Number(cashbox.openingBalance || 0);
    saved = {
      id: cashbox.id || `cb-${Date.now().toString(36)}`,
      name: cashbox.name.trim(),
      type: cashbox.type || 'نقدية محلية',
      currency: cashbox.currency || 'EGP',
      openingBalance: opening,
      currentBalance: opening,
      status: cashbox.status || 'active',
      notes: cashbox.notes || '',
      createdAt: new Date().toISOString()
    };
    memoryCashboxes.push(saved);

    if (opening !== 0) {
      memoryCashboxTransactions.push({
        id: generateUUID(),
        date: new Date().toISOString(),
        cashboxId: saved.id,
        cashboxName: saved.name,
        type: 'إيداع',
        documentNumber: `OPN-${saved.id}`,
        amount: opening,
        balanceAfter: opening,
        statement: 'رصيد افتتاحي للخزينة',
        userName: 'المسؤول'
      });
    }
  }

  return { success: true, cashbox: saved };
}

/**
 * جلب حركات خزينة محددة
 */
export async function getCashboxTransactions(
  cashboxId: string,
  session?: { token?: string; userId?: string; role?: UserRole; isOwner?: boolean; phone?: string },
  filters?: { from?: string | null; to?: string | null }
): Promise<{ success: boolean; transactions: CashboxTransaction[]; transfers?: CashboxTransfer[]; cashbox?: Cashbox; error?: string; code?: string; stale?: boolean; lastSyncAt?: string }> {
  const config = getSystemConfig();
  const cacheKey = `cashboxTx:${cashboxId}:${filters?.from || ''}:${filters?.to || ''}:${session?.userId || ''}:${session?.role || ''}`;
  if (isSheetsDataMode(config)) {
    const res: any = await callAppsScript('getCashboxTransactions', { cashboxId, from: filters?.from, to: filters?.to }, session?.token);
    if (res.success && Array.isArray(res.transactions)) {
      setSheetsCache(cacheKey, res);
      return res;
    }
    const cached = getSheetsCache<any>(cacheKey);
    if (cached) {
      return {
        ...cached.data,
        stale: true,
        lastSyncAt: cached.lastSyncAt
      };
    }
    return {
      ...buildSheetsWriteFailure(res, 'تعذر جلب حركات الخزينة من Google Sheets'),
      transactions: []
    };
  }

  const isDesigner = !session || session.role === 'designer' || Boolean(session.isOwner);
  let allowedIds: Set<string> | null = null;
  if (!isDesigner && session) {
    allowedIds = new Set<string>();
    const callerUser = memoryUsers.find(u => (session.userId && u.id === session.userId) || (session.phone && u.phone === session.phone));
    if (callerUser?.cashboxConfig) {
      const cfg = callerUser.cashboxConfig;
      [
        ...(cfg.allowedSaleCashboxIds || []),
        ...(cfg.allowedReturnCashboxIds || []),
        ...(cfg.allowedReceiptCashboxIds || []),
        ...(cfg.allowedPaymentCashboxIds || []),
        ...(cfg.allowedTransferCashboxIds || [])
      ].forEach(id => allowedIds!.add(id));
    }
    memoryUserCashboxAssignments.forEach(a => {
      const isUserMatch = (session.userId && a.userId === session.userId) || (callerUser && a.userId === callerUser.id);
      const isAssignActive = a.status === 'active' || (a.status as any) === 'نشطة' || !a.status;
      if (isUserMatch && isAssignActive) {
        allowedIds!.add(a.cashboxId);
      }
    });
  }

  const filterAll = !cashboxId || cashboxId === 'ALL';
  const cb = filterAll ? undefined : memoryCashboxes.find(c => c.id === cashboxId);

  let transactions = memoryCashboxTransactions.filter(t => {
    if (allowedIds && !allowedIds.has(t.cashboxId)) return false;
    if (!filterAll && t.cashboxId !== cashboxId) return false;
    return true;
  });

  if (filters?.from || filters?.to) {
    transactions = transactions.filter(t => isDateInRange(t.date, filters.from || null, filters.to || null));
  }

  transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  let transfers = memoryCashboxTransfers.filter(tr => {
    if (allowedIds && !allowedIds.has(tr.fromCashboxId) && !allowedIds.has(tr.toCashboxId)) return false;
    if (!filterAll && tr.fromCashboxId !== cashboxId && tr.toCashboxId !== cashboxId) return false;
    return true;
  });

  if (filters?.from || filters?.to) {
    transfers = transfers.filter(tr => isDateInRange(tr.date, filters.from || null, filters.to || null));
  }

  transfers.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return { success: true, transactions, transfers, cashbox: cb };
}

/**
 * تحويل أموال بين خزنتين (حركتان مترابطتان: خصم من المصدر + إضافة للوجهة)
 */
export async function createCashboxTransfer(
  payload: {
    fromCashboxId: string;
    toCashboxId: string;
    amount: number;
    fee?: number;
    notes?: string;
    idempotencyKey?: string;
  },
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string }
): Promise<{ success: boolean; duplicate?: boolean; statusCode?: number; transfer?: CashboxTransfer; error?: string; code?: string }> {
  const idemKey = getValidatedIdempotencyKey(payload?.idempotencyKey);
  if (!idemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR };
  }

  const cached = getIdempotencyCachedResult('createCashboxTransfer', idemKey);
  if (cached) {
    return { success: true, duplicate: true, transfer: cached };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('createCashboxTransfer', { ...payload, idempotencyKey: idemKey }, session?.token);
    if (res.success) {
      if (res.transfer) {
        setIdempotencyCachedResult('createCashboxTransfer', idemKey, res.transfer);
      }
      return { ...res, ...(res.duplicate ? { duplicate: true } : {}) };
    }
    return buildSheetsWriteFailure(res, 'تعذر تنفيذ التحويل بين الخزائن في Google Sheets');
  }

  const existingTransfer = memoryCashboxTransfers.find((t: any) => t.idempotencyKey === idemKey);
  if (existingTransfer) {
    setIdempotencyCachedResult('createCashboxTransfer', idemKey, existingTransfer);
    return { success: true, duplicate: true, transfer: existingTransfer };
  }

  if (payload.fromCashboxId === payload.toCashboxId) {
    return { success: false, error: 'لا يمكن التحويل لنفس الخزينة' };
  }

  if (session?.role !== 'designer') {
    const callerUser = memoryUsers.find(u => u.phone === session?.phone || u.id === (session as any)?.userId);
    if (callerUser?.cashboxConfig?.allowedTransferCashboxIds && callerUser.cashboxConfig.allowedTransferCashboxIds.length > 0) {
      if (!callerUser.cashboxConfig.allowedTransferCashboxIds.includes(payload.fromCashboxId)) {
        return { success: false, error: 'غير مصرح: غير مسموح لك بالتحويل من هذه الخزينة' };
      }
    }
  }

  const fromBox = memoryCashboxes.find(c => c.id === payload.fromCashboxId);
  const toBox = memoryCashboxes.find(c => c.id === payload.toCashboxId);
  if (!fromBox || !toBox) return { success: false, error: 'إحدى الخزائن غير موجودة' };

  const amount = Number(payload.amount);
  const fee = Number(payload.fee || 0);
  if (isNaN(amount) || amount <= 0) return { success: false, error: 'مبلغ التحويل غير صالح' };

  const totalDeduction = amount + fee;
  if (fromBox.currentBalance < totalDeduction) {
    return { success: false, error: `الرصيد المتاح في ${fromBox.name} (${fromBox.currentBalance} ج.م) غير كافٍ للتحويل مع الرسوم (${totalDeduction} ج.م)` };
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const transferNumber = `TRF-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

  // تحديث أرصدة الطرفين
  fromBox.currentBalance -= totalDeduction;
  toBox.currentBalance += amount;

  const userName = session?.name || session?.phone || 'المسؤول';

  // 1. حركة خصم من المصدر
  memoryCashboxTransactions.push({
    id: generateUUID(),
    date: now.toISOString(),
    cashboxId: fromBox.id,
    cashboxName: fromBox.name,
    type: 'تحويل بين الخزائن',
    documentNumber: transferNumber,
    amount: -totalDeduction,
    balanceAfter: fromBox.currentBalance,
    party: toBox.name,
    statement: `تحويل صادر إلى ${toBox.name} (رسوم: ${fee} ج.م)`,
    userName,
    notes: payload.notes
  });

  // 2. حركة إضافة للوجهة
  memoryCashboxTransactions.push({
    id: generateUUID(),
    date: now.toISOString(),
    cashboxId: toBox.id,
    cashboxName: toBox.name,
    type: 'تحويل بين الخزائن',
    documentNumber: transferNumber,
    amount,
    balanceAfter: toBox.currentBalance,
    party: fromBox.name,
    statement: `تحويل وارد من ${fromBox.name}`,
    userName,
    notes: payload.notes
  });

  const transferRecord: CashboxTransfer & { idempotencyKey?: string } = {
    transferNumber,
    date: now.toISOString(),
    fromCashboxId: fromBox.id,
    fromCashboxName: fromBox.name,
    toCashboxId: toBox.id,
    toCashboxName: toBox.name,
    amount,
    fee,
    netReceived: amount,
    transferredBy: userName,
    receivedBy: userName,
    status: 'مكتمل',
    notes: payload.notes || '',
    idempotencyKey: idemKey
  };

  memoryCashboxTransfers.unshift(transferRecord);
  setIdempotencyCachedResult('createCashboxTransfer', idemKey, transferRecord);
  recordAuditLog(session || {}, 'CASHBOX_TRANSFER', 'CashboxTransfer', transferNumber, `تحويل مبلغ ${amount} ج.م من ${fromBox.name} إلى ${toBox.name}`);

  return { success: true, transfer: transferRecord };
}

/**
 * جلب تخصيصات الخزائن للمستخدمين
 */
export async function getUserCashboxAssignments(session?: { token?: string }): Promise<UserCashboxAssignment[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getUserCashboxAssignments', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache('cashboxAssignments', res.data);
      return res.data;
    }
    const cached = getSheetsCache<UserCashboxAssignment[]>('cashboxAssignments');
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب تخصيصات الخزائن من Google Sheets');
  }
  return memoryUserCashboxAssignments;
}

/**
 * حفظ تخصيص خزينة لمستخدم
 */
export async function saveUserCashboxAssignment(
  payload: Partial<UserCashboxAssignment> & { userId: string; cashboxId: string },
  session?: { token?: string }
): Promise<{ success: boolean; assignment?: UserCashboxAssignment; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res: any = await callAppsScript('saveUserCashboxAssignment', payload, session?.token);
    if (res.success && res.assignment) return { success: true, assignment: res.assignment };
    return buildSheetsWriteFailure(res, 'تعذر حفظ تخصيص الخزينة في Google Sheets');
  }

  const user = memoryUsers.find(u => u.id === payload.userId);
  const cashbox = memoryCashboxes.find(c => c.id === payload.cashboxId);
  if (!user || !cashbox) return { success: false, error: 'المستخدم أو الخزينة غير موجودة' };

  // إذا تم تحديدها كافتراضية، نزيل الافتراضية عن باقي خزائن هذا المستخدم
  if (payload.isDefault) {
    memoryUserCashboxAssignments.forEach(a => {
      if (a.userId === payload.userId) a.isDefault = false;
    });
  }

  const existingIdx = memoryUserCashboxAssignments.findIndex(a => a.userId === payload.userId && a.cashboxId === payload.cashboxId);
  let saved: UserCashboxAssignment;

  if (existingIdx >= 0) {
    saved = {
      ...memoryUserCashboxAssignments[existingIdx],
      permissionType: payload.permissionType || memoryUserCashboxAssignments[existingIdx].permissionType,
      isDefault: Boolean(payload.isDefault),
      status: payload.status || 'active'
    };
    memoryUserCashboxAssignments[existingIdx] = saved;
  } else {
    saved = {
      id: generateUUID(),
      userId: user.id,
      userName: user.name,
      cashboxId: cashbox.id,
      cashboxName: cashbox.name,
      permissionType: payload.permissionType || 'إيداع وسحب',
      isDefault: Boolean(payload.isDefault),
      status: 'active'
    };
    memoryUserCashboxAssignments.push(saved);
  }

  return { success: true, assignment: saved };
}

/**
 * جلب سجل دفعات الاستيراد
 */
export async function getImportBatches(session?: { token?: string }): Promise<ImportBatch[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getImportBatches', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      setSheetsCache('importBatches', res.data);
      return res.data;
    }
    const cached = getSheetsCache<ImportBatch[]>('importBatches');
    if (cached) {
      return markArrayStale(cached.data, cached.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب سجل دفعات الاستيراد من Google Sheets');
  }
  return memoryImportBatches;
}

/**
 * إلغاء فاتورة بيع معتمدة عبر قيد عكسي
 */
export async function cancelInvoice(
  invoiceNumber: string,
  reason: string,
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string }
): Promise<{ success: boolean; invoice?: Invoice; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('cancelInvoice', { invoiceNumber, reason }, session?.token);
    if (res.success) return res;
    return buildSheetsWriteFailure(res, 'تعذر إلغاء الفاتورة في Google Sheets');
  }

  const invoice = memoryInvoices.find(inv => inv.invoiceNumber === invoiceNumber);
  if (!invoice) return { success: false, error: 'فاتورة البيع غير موجودة' };
  if (invoice.status === 'ملغاة') return { success: false, error: 'الفاتورة ملغاة بالفعل' };
  if (findOrderForInvoice(invoiceNumber)) {
    return { success: false, code: 'DELIVERY_INVOICE', error: 'دي فاتورة توصيل: الإلغاء من شاشة التوصيل («اتلغى») علشان البضاعة ترجع بمرتجع رسمي' };
  }

  // التحقق من وجود مرتجعات سابقة لهذه الفاتورة
  const existingReturns = memoryReturns.filter(r => r.invoiceNumber === invoiceNumber);
  if (existingReturns.length > 0) {
    return { success: false, error: 'لا يمكن إلغاء فاتورة تم عمل مرتجع جزئي أو كلي لها. يرجى مراجعة المرتجعات أولاً' };
  }

  const now = new Date();
  const userName = session?.name || session?.phone || 'المسؤول';

  // 1. إعادة الكميات للمخزون (قيد عكسي لحركة البيع على نفس مخزن الفاتورة)
  const cancelInvWhId = invoice.warehouseId || getDefaultWarehouse().id;
  const cancelInvWh = getWarehouseById(cancelInvWhId) || getDefaultWarehouse();
  for (const line of invoice.lines || []) {
    const prod = memoryItems.find(p => p.id === line.itemId);
    if (prod) {
      const beforeQty = getItemWarehouseStock(prod.id, cancelInvWh.id);
      const adj = adjustItemWarehouseDelta(prod.id, cancelInvWh.id, line.quantity);
      memoryStockMovements.push({
        id: generateUUID(),
        date: now.toISOString(),
        itemId: prod.id,
        itemName: prod.name,
        warehouseId: cancelInvWh.id,
        warehouseName: cancelInvWh.name,
        movementType: 'إلغاء فاتورة بيع',
        documentNumber: invoice.invoiceNumber,
        quantity: line.quantity,
        quantityBefore: beforeQty,
        quantityAfter: adj.balanceInWarehouse,
        balanceAfter: adj.balanceInWarehouse,
        notes: `إلغاء فاتورة مبيعات (مخزن ${cancelInvWh.name}) - قيد عكسي: ${reason || 'إلغاء معتمد'}`,
        userName
      });
    }
  }

  // 2. قيد عكسي للخزينة إذا كان قد تم تحصيل أي مبلغ نقدي
  const paid = Number(invoice.paidAmount || (invoice.paymentType === 'نقدي' ? invoice.netAmount : 0));
  if (paid > 0 && invoice.cashboxId) {
    const cashbox = memoryCashboxes.find(c => c.id === invoice.cashboxId);
    if (cashbox) {
      cashbox.currentBalance -= paid;
      memoryCashboxTransactions.push({
        id: generateUUID(),
        date: now.toISOString(),
        cashboxId: cashbox.id,
        cashboxName: cashbox.name,
        type: 'قيد عكسي إلغاء مبيعات',
        documentNumber: invoice.invoiceNumber,
        amount: -paid,
        balanceAfter: cashbox.currentBalance,
        party: invoice.customerName || invoice.platformName || 'عميل نقدي',
        statement: `قيد عكسي لإلغاء فاتورة مبيعات رقم ${invoice.invoiceNumber} - ${reason || ''}`,
        userName,
        notes: reason || ''
      });
    }
  }

  // 3. قيد عكسي للعميل إذا كان العميل مسجلاً وكانت الفاتورة آجلة أو جزئية
  if (invoice.customerId) {
    const customer = memoryCustomers.find(c => c.id === invoice.customerId);
    if (customer) {
      const remaining = Number(invoice.remainingAmount ?? (invoice.paymentType === 'آجل' ? invoice.netAmount : 0));
      if (remaining > 0) {
        customer.currentBalance -= remaining;
        memoryCustomerLedger.push({
          id: generateUUID(),
          date: now.toISOString(),
          customerId: customer.id,
          customerName: customer.name,
          transactionType: 'إلغاء فاتورة بيع',
          documentNumber: invoice.invoiceNumber,
          debit: 0,
          credit: remaining,
          balanceAfter: customer.currentBalance,
          statement: `قيد عكسي لإلغاء مديونية فاتورة بيع رقم ${invoice.invoiceNumber} - ${reason || ''}`,
          userName,
          notes: reason || ''
        });
      }
    }
  }

  invoice.status = 'ملغاة';
  recordAuditLog(session || {}, 'CANCEL_INVOICE', 'Invoice', invoice.invoiceNumber, `إلغاء فاتورة بيع بقيمة ${invoice.netAmount} ج.م. السبب: ${reason || 'غير محدد'}`);

  return { success: true, invoice };
}

/**
 * إلغاء فاتورة شراء معتمدة عبر قيد عكسي
 */
export async function cancelPurchase(
  invoiceNumber: string,
  reason: string,
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string }
): Promise<{ success: boolean; purchase?: PurchaseInvoice; error?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('cancelPurchase', { invoiceNumber, reason }, session?.token);
    if (res.success) return res;
    return buildSheetsWriteFailure(res, 'تعذر إلغاء فاتورة الشراء في Google Sheets');
  }

  const purchase = memoryPurchases.find(p => p.invoiceNumber === invoiceNumber);
  if (!purchase) return { success: false, error: 'فاتورة الشراء غير موجودة' };
  if (purchase.receivingStatus === 'ملغاة') return { success: false, error: 'فاتورة الشراء ملغاة بالفعل' };

  // التحقق من وجود مرتجعات شراء سابقة
  const existingReturns = memoryPurchaseReturns.filter(r => r.purchaseInvoiceNumber === invoiceNumber);
  if (existingReturns.length > 0) {
    return { success: false, error: 'لا يمكن إلغاء فاتورة شراء تم عمل مرتجع عليها مسبقاً' };
  }

  const now = new Date();
  const userName = session?.name || session?.phone || 'المسؤول';

  // 1. خفض المخزون بالكميات المشتراة (قيد عكسي للشراء على نفس مخزن الشراء)
  const cancelPurWhId = purchase.warehouseId || getDefaultWarehouse().id;
  const cancelPurWh = getWarehouseById(cancelPurWhId) || getDefaultWarehouse();
  for (const line of purchase.lines) {
    const prod = memoryItems.find(p => p.id === line.itemId);
    if (prod) {
      const beforeQty = getItemWarehouseStock(prod.id, cancelPurWh.id);
      const nextQty = setItemWarehouseBalance(prod.id, cancelPurWh.id, Math.max(0, beforeQty - line.quantity));
      memoryStockMovements.push({
        id: generateUUID(),
        date: now.toISOString(),
        itemId: prod.id,
        itemName: prod.name,
        warehouseId: cancelPurWh.id,
        warehouseName: cancelPurWh.name,
        movementType: 'إلغاء فاتورة شراء',
        documentNumber: purchase.invoiceNumber,
        quantity: -line.quantity,
        quantityBefore: beforeQty,
        quantityAfter: nextQty,
        balanceAfter: nextQty,
        notes: `إلغاء فاتورة شراء (مخزن ${cancelPurWh.name}) - قيد عكسي للمخزون: ${reason || 'إلغاء معتمد'}`,
        userName
      });
    }
  }

  // 2. قيد عكسي للخزينة إذا كان قد تم دفع مبلغ من الخزينة (استرداد المبلغ للخزينة)
  const paid = Number(purchase.paidAmount || (purchase.paymentType === 'نقدي' ? purchase.netTotal : 0));
  if (paid > 0 && purchase.cashboxId) {
    const cashbox = memoryCashboxes.find(c => c.id === purchase.cashboxId);
    if (cashbox) {
      cashbox.currentBalance += paid;
      memoryCashboxTransactions.push({
        id: generateUUID(),
        date: now.toISOString(),
        cashboxId: cashbox.id,
        cashboxName: cashbox.name,
        type: 'قيد عكسي إلغاء مشتريات',
        documentNumber: purchase.invoiceNumber,
        amount: paid,
        balanceAfter: cashbox.currentBalance,
        party: purchase.supplierName || 'مورد',
        statement: `قيد عكسي لاسترداد مبلغ مدفوع لفاتورة شراء ملغاة رقم ${purchase.invoiceNumber}`,
        userName,
        notes: reason || ''
      });
    }
  }

  // 3. قيد عكسي لحساب المورد إذا كان مسجلاً وعليه التزامات آجلة
  if (purchase.supplierId) {
    const supplier = memorySuppliers.find(s => s.id === purchase.supplierId);
    if (supplier) {
      const remaining = Number(purchase.remainingAmount ?? (purchase.paymentType === 'آجل' ? purchase.netTotal : 0));
      if (remaining > 0) {
        supplier.currentBalance -= remaining;
        memorySupplierLedger.push({
          id: generateUUID(),
          date: now.toISOString(),
          supplierId: supplier.id,
          supplierName: supplier.name,
          transactionType: 'إلغاء فاتورة شراء',
          documentNumber: purchase.invoiceNumber,
          debit: remaining,
          credit: 0,
          balanceAfter: supplier.currentBalance,
          statement: `قيد عكسي لإلغاء مديونية مستحقة لمورد عن فاتورة ملغاة رقم ${purchase.invoiceNumber}`,
          userName,
          notes: reason || ''
        });
      }
    }
  }

  purchase.receivingStatus = 'ملغاة';
  purchase.cancelledAt = now.toISOString();
  purchase.cancelledBy = userName;
  purchase.cancellationReason = reason || 'إلغاء معتمد';

  recordAuditLog(session || {}, 'CANCEL_PURCHASE', 'Purchase', purchase.invoiceNumber, `إلغاء فاتورة شراء بقيمة ${purchase.netTotal} ج.م. السبب: ${reason || 'غير محدد'}`);

  return { success: true, purchase };
}

/**
 * تقرير المطابقة المحاسبية وترحيل العمليات
 */
export async function getReconciliationReport(
  session?: { token?: string },
  filters?: { from?: string | null; to?: string | null }
): Promise<{
  totalAudited: number;
  unpostedCount: number;
  discrepantCashboxAmount: number;
  discrepantLedgerAmount: number;
  items: ReconciliationItem[];
}> {
  const config = getSystemConfig();
  const fromDate = filters?.from || null;
  const toDate = filters?.to || null;
  const cacheKey = `reconciliation:${fromDate || ''}:${toDate || ''}`;

  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getReconciliationReport', { from: fromDate, to: toDate }, session?.token);
    if (res.success && res.data) {
      setSheetsCache(cacheKey, res.data);
      return res.data;
    }
    const cached = getSheetsCache<any>(cacheKey);
    if (cached) {
      return {
        ...cached.data,
        stale: true,
        lastSyncAt: cached.lastSyncAt
      };
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب تقرير المطابقة المحاسبية من Google Sheets');
  }

  const items: ReconciliationItem[] = [];
  let discrepantCashbox = 0;
  let discrepantLedger = 0;

  const filteredInvoices = (fromDate || toDate)
    ? memoryInvoices.filter(inv => isDateInRange(inv.date, fromDate, toDate))
    : memoryInvoices;
  const filteredPurchases = (fromDate || toDate)
    ? memoryPurchases.filter(pur => isDateInRange(pur.date, fromDate, toDate))
    : memoryPurchases;
  const filteredReturns = (fromDate || toDate)
    ? memoryReturns.filter(ret => isDateInRange(ret.date, fromDate, toDate))
    : memoryReturns;
  const filteredPurchaseReturns = (fromDate || toDate)
    ? memoryPurchaseReturns.filter(pret => isDateInRange(pret.date, fromDate, toDate))
    : memoryPurchaseReturns;

  // 1. تدقيق فواتير المبيعات
  for (const inv of filteredInvoices) {
    if (inv.status === 'ملغاة') continue;

    const paid = Number(inv.paidAmount ?? (inv.paymentType === 'نقدي' ? inv.netAmount : 0));
    const remaining = Number(inv.remainingAmount ?? (inv.paymentType === 'آجل' ? inv.netAmount : 0));

    const hasCashbox = paid > 0
      ? memoryCashboxTransactions.some(c => c.documentNumber === inv.invoiceNumber)
      : true;

    const needsLedger = Boolean(inv.customerId && (remaining > 0 || inv.paymentType === 'آجل'));
    const hasLedger = needsLedger
      ? memoryCustomerLedger.some(l => l.documentNumber === inv.invoiceNumber)
      : true;

    const hasStock = inv.lines && inv.lines.length > 0
      ? memoryStockMovements.some(m => m.documentNumber === inv.invoiceNumber)
      : true;

    const isUnposted = !hasCashbox || !hasLedger || !hasStock;

    if (isUnposted) {
      if (!hasCashbox && paid > 0) discrepantCashbox += paid;
      if (!hasLedger && remaining > 0) discrepantLedger += remaining;

      const reasons: string[] = [];
      if (!hasCashbox) reasons.push('حركة الخزينة غير مسجلة للمبلغ المقبوض');
      if (!hasLedger) reasons.push('قيد مديونية العميل غير مسجل بالدفتر');
      if (!hasStock) reasons.push('حركة خصم المخزون غير موثقة');

      items.push({
        id: inv.invoiceNumber,
        documentType: 'فاتورة بيع',
        documentNumber: inv.invoiceNumber,
        date: inv.date,
        partyName: inv.customerName || inv.platformName || 'عميل نقدي',
        totalAmount: inv.netAmount,
        paymentType: inv.paymentType || (paid >= inv.netAmount ? 'نقدي' : 'آجل'),
        status: 'غير مرحل',
        details: reasons.join(' | '),
        missingCashbox: !hasCashbox,
        missingLedger: !hasLedger,
        missingStock: !hasStock,
        isHistorical: true
      });
    }
  }

  // 2. تدقيق فواتير المشتريات
  for (const pur of filteredPurchases) {
    if (pur.receivingStatus === 'ملغاة') continue;

    const paid = Number(pur.paidAmount || (pur.paymentType === 'نقدي' ? pur.netTotal : 0));
    const hasCashbox = paid > 0
      ? memoryCashboxTransactions.some(c => c.documentNumber === pur.invoiceNumber)
      : true;

    const hasLedger = pur.supplierId
      ? memorySupplierLedger.some(l => l.documentNumber === pur.invoiceNumber)
      : true;

    const hasStock = pur.lines && pur.lines.length > 0
      ? memoryStockMovements.some(m => m.documentNumber === pur.invoiceNumber)
      : true;

    const isUnposted = !hasCashbox || !hasLedger || !hasStock;

    if (isUnposted) {
      if (!hasCashbox && paid > 0) discrepantCashbox += paid;
      if (!hasLedger && pur.remainingAmount > 0) discrepantLedger += pur.remainingAmount;

      const reasons: string[] = [];
      if (!hasCashbox) reasons.push('حركة صرف الخزينة غير مسجلة للمبلغ المدفوع');
      if (!hasLedger) reasons.push('قيد استحقاق المورد غير مسجل بالدفتر');
      if (!hasStock) reasons.push('حركة إضافة المخزون غير موثقة');

      items.push({
        id: pur.invoiceNumber,
        documentType: 'فاتورة شراء',
        documentNumber: pur.invoiceNumber,
        date: pur.date,
        partyName: pur.supplierName || 'مورد',
        totalAmount: pur.netTotal,
        paymentType: pur.paymentType || (paid >= pur.netTotal ? 'نقدي' : 'آجل'),
        status: 'غير مرحل',
        details: reasons.join(' | '),
        missingCashbox: !hasCashbox,
        missingLedger: !hasLedger,
        missingStock: !hasStock,
        isHistorical: true
      });
    }
  }

  // 3. تدقيق مرتجعات المبيعات
  for (const ret of filteredReturns) {
    const isCashRefund = ret.refundStatus === 'استرداد نقدي';
    const hasCashbox = isCashRefund
      ? memoryCashboxTransactions.some(c => c.documentNumber === ret.returnNumber)
      : true;

    const isAccountRefund = ret.refundStatus === 'قيد على الحساب';
    const inv = memoryInvoices.find(i => i.invoiceNumber === ret.invoiceNumber);
    const hasLedger = (isAccountRefund && inv?.customerId)
      ? memoryCustomerLedger.some(c => c.documentNumber === ret.returnNumber)
      : true;

    const hasRestockLines = ret.lines && ret.lines.some(l => l.itemCondition === 'يرجع المخزن');
    const hasStock = hasRestockLines
      ? memoryStockMovements.some(m => m.documentNumber === ret.returnNumber)
      : true;

    if (!hasCashbox || !hasLedger || !hasStock) {
      const reasons: string[] = [];
      if (!hasCashbox) reasons.push('حركة صرف رد القيمة من الخزينة غير مسجلة');
      if (!hasLedger) reasons.push('قيد تخفيض مديونية العميل غير مسجل');
      if (!hasStock) reasons.push('حركة إعادة الأصناف السليمة للمخزون غير موثقة');

      items.push({
        id: ret.returnNumber,
        documentType: 'مرتجع بيع',
        documentNumber: ret.returnNumber,
        date: ret.date,
        partyName: inv?.customerName || 'عميل',
        totalAmount: ret.refundedAmount || 0,
        paymentType: ret.refundStatus,
        status: 'غير مرحل',
        details: reasons.join(' | '),
        missingCashbox: !hasCashbox,
        missingLedger: !hasLedger,
        missingStock: !hasStock,
        isHistorical: true
      });
    }
  }

  // 4. تدقيق مرتجعات المشتريات
  for (const pret of filteredPurchaseReturns) {
    const isCashRefund = pret.refundStatus === 'استرداد نقدي';
    const hasCashbox = isCashRefund
      ? memoryCashboxTransactions.some(c => c.documentNumber === pret.returnNumber)
      : true;

    const hasLedger = memorySupplierLedger.some(l => l.documentNumber === pret.returnNumber);
    const hasStock = memoryStockMovements.some(m => m.documentNumber === pret.returnNumber);

    if (!hasCashbox || !hasLedger || !hasStock) {
      const reasons: string[] = [];
      if (!hasCashbox) reasons.push('حركة إيداع رد القيمة من المورد غير مسجلة بالخزينة');
      if (!hasLedger) reasons.push('قيد تخفيض مديونية المورد غير مسجل');
      if (!hasStock) reasons.push('حركة إخراج البضاعة المرتجعة من المخزون غير موثقة');

      items.push({
        id: pret.returnNumber,
        documentType: 'مرتجع شراء',
        documentNumber: pret.returnNumber,
        date: pret.date,
        partyName: pret.supplierName,
        totalAmount: pret.netTotal,
        paymentType: pret.refundStatus,
        status: 'غير مرحل',
        details: reasons.join(' | '),
        missingCashbox: !hasCashbox,
        missingLedger: !hasLedger,
        missingStock: !hasStock,
        isHistorical: true
      });
    }
  }

  const totalAudited = filteredInvoices.length + filteredPurchases.length + filteredReturns.length + filteredPurchaseReturns.length;

  return {
    totalAudited,
    unpostedCount: items.length,
    discrepantCashboxAmount: discrepantCashbox,
    discrepantLedgerAmount: discrepantLedger,
    items
  };
}

/**
 * ترحيل يدوي معتمد لعملية تاريخية غير مرحلة (بناءً على طلب ومراجعة المستخدم)
 */
export async function postReconciliationItem(
  payload: { documentNumber: string; documentType: string; cashboxId?: string },
  session?: { token?: string; role: UserRole; permissions: PermissionKey[]; phone?: string; name?: string }
): Promise<{ success: boolean; error?: string; message?: string; code?: string }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('postReconciliationItem', payload, session?.token);
    if (res.success) return res;
    return buildSheetsWriteFailure(res, 'تعذر ترحيل التسوية في Google Sheets');
  }

  const { documentNumber, documentType, cashboxId } = payload;
  const now = new Date();
  const userName = session?.name || session?.phone || 'المسؤول المحاسبي';

  if (documentType === 'فاتورة بيع') {
    const inv = memoryInvoices.find(i => i.invoiceNumber === documentNumber);
    if (!inv) return { success: false, error: 'فاتورة البيع غير موجودة' };

    const paid = Number(inv.paidAmount || (inv.paymentType === 'نقدي' ? inv.netAmount : 0));
    if (paid > 0 && !memoryCashboxTransactions.some(c => c.documentNumber === inv.invoiceNumber)) {
      const targetCashbox = (cashboxId ? memoryCashboxes.find(c => c.id === cashboxId) : null) ||
        (inv.cashboxId ? memoryCashboxes.find(c => c.id === inv.cashboxId) : null) ||
        memoryCashboxes[0];

      if (targetCashbox) {
        targetCashbox.currentBalance += paid;
        memoryCashboxTransactions.push({
          id: generateUUID(),
          date: inv.date || now.toISOString(),
          cashboxId: targetCashbox.id,
          cashboxName: targetCashbox.name,
          type: 'إيراد مبيعات',
          documentNumber: inv.invoiceNumber,
          amount: paid,
          balanceAfter: targetCashbox.currentBalance,
          party: inv.customerName || inv.platformName || 'عميل',
          statement: `ترحيل معتمد لعملية سابقة: فاتورة مبيعات رقم ${inv.invoiceNumber}`,
          userName,
          notes: 'تم الترحيل عبر تقرير المطابقة المحاسبية'
        });
      }
    }

    if (inv.customerId && !memoryCustomerLedger.some(l => l.documentNumber === inv.invoiceNumber)) {
      const customer = memoryCustomers.find(c => c.id === inv.customerId);
      if (customer) {
        const remaining = Number(inv.remainingAmount ?? (inv.paymentType === 'آجل' ? inv.netAmount : 0));
        customer.currentBalance += remaining;
        memoryCustomerLedger.push({
          id: generateUUID(),
          date: inv.date || now.toISOString(),
          customerId: customer.id,
          customerName: customer.name,
          transactionType: 'فاتورة بيع',
          documentNumber: inv.invoiceNumber,
          debit: inv.netAmount,
          credit: paid,
          balanceAfter: customer.currentBalance,
          statement: `ترحيل معتمد لعملية سابقة: فاتورة مبيعات رقم ${inv.invoiceNumber}`,
          userName,
          notes: 'تم الترحيل عبر تقرير المطابقة المحاسبية'
        });
      }
    }

    if (inv.lines && !memoryStockMovements.some(m => m.documentNumber === inv.invoiceNumber)) {
      const recInvWhId = inv.warehouseId || getDefaultWarehouse().id;
      const recInvWh = getWarehouseById(recInvWhId) || getDefaultWarehouse();
      for (const line of inv.lines) {
        const prod = memoryItems.find(p => p.id === line.itemId);
        if (prod) {
          const beforeQty = getItemWarehouseStock(prod.id, recInvWh.id);
          const nextQty = setItemWarehouseBalance(prod.id, recInvWh.id, Math.max(0, beforeQty - line.quantity));
          memoryStockMovements.push({
            id: generateUUID(),
            date: inv.date || now.toISOString(),
            itemId: prod.id,
            itemName: prod.name,
            warehouseId: recInvWh.id,
            warehouseName: recInvWh.name,
            movementType: 'بيع',
            documentNumber: inv.invoiceNumber,
            quantity: -line.quantity,
            quantityBefore: beforeQty,
            quantityAfter: nextQty,
            balanceAfter: nextQty,
            notes: `ترحيل حركة مخزون معتمدة لفاتورة مبيعات سابقة (${recInvWh.name})`,
            userName
          });
        }
      }
    }

    recordAuditLog(session || {}, 'POST_RECONCILIATION', 'Invoice', inv.invoiceNumber, 'ترحيل يدوي معتمد من تقرير المطابقة المحاسبية');
    return { success: true, message: `تم ترحيل فاتورة البيع ${inv.invoiceNumber} بنجاح إلى الدفاتر والخزينة والمخزون` };
  }

  if (documentType === 'فاتورة شراء') {
    const pur = memoryPurchases.find(p => p.invoiceNumber === documentNumber);
    if (!pur) return { success: false, error: 'فاتورة الشراء غير موجودة' };

    const paid = Number(pur.paidAmount || (pur.paymentType === 'نقدي' ? pur.netTotal : 0));
    if (paid > 0 && !memoryCashboxTransactions.some(c => c.documentNumber === pur.invoiceNumber)) {
      const targetCashbox = (cashboxId ? memoryCashboxes.find(c => c.id === cashboxId) : null) ||
        (pur.cashboxId ? memoryCashboxes.find(c => c.id === pur.cashboxId) : null) ||
        memoryCashboxes[0];

      if (targetCashbox) {
        targetCashbox.currentBalance -= paid;
        memoryCashboxTransactions.push({
          id: generateUUID(),
          date: pur.date || now.toISOString(),
          cashboxId: targetCashbox.id,
          cashboxName: targetCashbox.name,
          type: 'سداد مشتريات',
          documentNumber: pur.invoiceNumber,
          amount: -paid,
          balanceAfter: targetCashbox.currentBalance,
          party: pur.supplierName || 'مورد',
          statement: `ترحيل معتمد لعملية سابقة: سداد فاتورة شراء رقم ${pur.invoiceNumber}`,
          userName,
          notes: 'تم الترحيل عبر تقرير المطابقة المحاسبية'
        });
      }
    }

    if (pur.supplierId && !memorySupplierLedger.some(l => l.documentNumber === pur.invoiceNumber)) {
      const supplier = memorySuppliers.find(s => s.id === pur.supplierId);
      if (supplier) {
        const remaining = Number(pur.remainingAmount ?? (pur.paymentType === 'آجل' ? pur.netTotal : 0));
        supplier.currentBalance += remaining;
        memorySupplierLedger.push({
          id: generateUUID(),
          date: pur.date || now.toISOString(),
          supplierId: supplier.id,
          supplierName: supplier.name,
          transactionType: 'فاتورة شراء',
          documentNumber: pur.invoiceNumber,
          debit: paid,
          credit: pur.netTotal,
          balanceAfter: supplier.currentBalance,
          statement: `ترحيل معتمد لعملية سابقة: فاتورة شراء رقم ${pur.invoiceNumber}`,
          userName,
          notes: 'تم الترحيل عبر تقرير المطابقة المحاسبية'
        });
      }
    }

    if (pur.lines && !memoryStockMovements.some(m => m.documentNumber === pur.invoiceNumber)) {
      const recPurWhId = pur.warehouseId || getDefaultWarehouse().id;
      const recPurWh = getWarehouseById(recPurWhId) || getDefaultWarehouse();
      for (const line of pur.lines) {
        const prod = memoryItems.find(p => p.id === line.itemId);
        if (prod) {
          const beforeQty = getItemWarehouseStock(prod.id, recPurWh.id);
          const adj = adjustItemWarehouseDelta(prod.id, recPurWh.id, line.quantity);
          memoryStockMovements.push({
            id: generateUUID(),
            date: pur.date || now.toISOString(),
            itemId: prod.id,
            itemName: prod.name,
            warehouseId: recPurWh.id,
            warehouseName: recPurWh.name,
            movementType: 'شراء',
            documentNumber: pur.invoiceNumber,
            quantity: line.quantity,
            quantityBefore: beforeQty,
            quantityAfter: adj.balanceInWarehouse,
            balanceAfter: adj.balanceInWarehouse,
            notes: `ترحيل حركة مخزون معتمدة لفاتورة شراء سابقة (${recPurWh.name})`,
            userName
          });
        }
      }
    }

    recordAuditLog(session || {}, 'POST_RECONCILIATION', 'Purchase', pur.invoiceNumber, 'ترحيل يدوي معتمد من تقرير المطابقة المحاسبية');
    return { success: true, message: `تم ترحيل فاتورة الشراء ${pur.invoiceNumber} بنجاح إلى الدفاتر والخزينة والمخزون` };
  }

  return { success: false, error: 'نوع المستند غير مدعوم للترحيل اليدوي' };
}

/* ============================================================================
 * إدارة التصنيفات (Product Categories) وقاعدة البيانات الشجرية
 * ============================================================================ */

/**
 * بناء شجرة التصنيفات وحساب عدد الأصناف والمستوى وعلاقات الأب والابن
 */
export function buildCategoryTree(categories: ProductCategory[], items: Item[]): ProductCategory[] {
  const catMap = new Map<string, ProductCategory>();
  for (const c of categories) {
    catMap.set(c.id, {
      ...c,
      itemCount: 0,
      subcategories: []
    });
  }

  // حساب عدد الأصناف المباشرة لكل تصنيف
  for (const item of items) {
    if (item.categoryId && catMap.has(item.categoryId)) {
      const cat = catMap.get(item.categoryId)!;
      cat.itemCount = (cat.itemCount || 0) + 1;
    }
  }

  // بناء الهيكل الهرمي وحساب المستويات
  const rootCategories: ProductCategory[] = [];

  for (const cat of catMap.values()) {
    if (cat.parentCategoryId && catMap.has(cat.parentCategoryId)) {
      const parent = catMap.get(cat.parentCategoryId)!;
      cat.parentName = parent.name;
      parent.subcategories = parent.subcategories || [];
      parent.subcategories.push(cat);
    } else {
      cat.parentCategoryId = null;
      cat.parentName = undefined;
      rootCategories.push(cat);
    }
  }

  // دالة لحساب المستوى وتجميع عدد الأصناف من الفروع
  function enrichLevelAndCount(node: ProductCategory, currentLevel: number): number {
    node.level = currentLevel;
    let totalItems = node.itemCount || 0;
    if (node.subcategories && node.subcategories.length > 0) {
      node.subcategories.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
      for (const sub of node.subcategories) {
        totalItems += enrichLevelAndCount(sub, currentLevel + 1);
      }
    }
    node.itemCount = totalItems;
    return totalItems;
  }

  rootCategories.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  for (const root of rootCategories) {
    enrichLevelAndCount(root, 0);
  }

  // إرجاع قائمة مسطحة مرتبة شجرياً
  const result: ProductCategory[] = [];
  function flatten(node: ProductCategory) {
    result.push(node);
    if (node.subcategories && node.subcategories.length > 0) {
      for (const sub of node.subcategories) {
        flatten(sub);
      }
    }
  }
  for (const root of rootCategories) {
    flatten(root);
  }

  return result;
}

/**
 * جلب قائمة التصنيفات
 */
export async function getCategories(session?: { token?: string; role?: UserRole; permissions?: PermissionKey[] }): Promise<ProductCategory[]> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getCategories', undefined, session?.token);
    if (res.success && Array.isArray(res.data)) {
      const canViewPurchase = session?.role === 'designer' || session?.permissions?.includes('prices.view_purchase');
      const canViewPackaging = session?.role === 'designer' || session?.permissions?.includes('prices.view_packaging');
      const cachedItems = getSheetsCache<Item[]>(`items:${Boolean(canViewPurchase)}:${Boolean(canViewPackaging)}`)?.data
        || getSheetsCache<Item[]>('items:true:true')?.data
        || getSheetsCache<Item[]>('items:false:false')?.data
        || [];
      const tree = buildCategoryTree(res.data, cachedItems);
      setSheetsCache('categories', res.data);
      setSheetsCache('categoriesTree', tree);
      return tree;
    }
    const cachedTree = getSheetsCache<ProductCategory[]>('categoriesTree');
    if (cachedTree) {
      return markArrayStale(cachedTree.data, cachedTree.lastSyncAt);
    }
    const cachedRaw = getSheetsCache<ProductCategory[]>('categories');
    if (cachedRaw) {
      return markArrayStale(buildCategoryTree(cachedRaw.data, []), cachedRaw.lastSyncAt);
    }
    throw buildSheetsReadFailureError(res, 'تعذر جلب التصنيفات من Google Sheets');
  }

  return buildCategoryTree(memoryCategories, memoryItems);
}

/**
 * حفظ أو تعديل تصنيف منتجات
 */
export async function saveCategory(
  category: Partial<ProductCategory> & { name: string },
  session?: { token?: string; role?: UserRole; permissions?: PermissionKey[]; name?: string; phone?: string; userId?: string }
): Promise<{ success: boolean; category?: ProductCategory; error?: string; code?: string }> {
  const name = (category.name || '').trim();
  if (!name) {
    return { success: false, error: 'اسم التصنيف مطلوب ولا يمكن أن يكون فارغاً' };
  }

  const id = category.id || generateUUID();
  const parentCategoryId = category.parentCategoryId ? String(category.parentCategoryId).trim() : null;

  // 1. منع ربط التصنيف بنفسه
  if (category.id && parentCategoryId === category.id) {
    return { success: false, error: 'لا يمكن ربط التصنيف بنفسه كتصنيف أب' };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('saveCategory', { ...category, id, name, parentCategoryId }, session?.token);
    if (res.success && res.category) {
      return { success: true, category: res.category };
    }
    return buildSheetsWriteFailure(res, 'تعذر حفظ التصنيف في Google Sheets');
  }

  // 2. التحقق من العلاقات الدائرية (منع اختيار أحد الأبناء كأب)
  if (category.id && parentCategoryId) {
    let curr: string | null = parentCategoryId;
    const visited = new Set<string>();
    while (curr) {
      if (curr === category.id) {
        return { success: false, error: 'لا يمكن تعيين تصنيف فرعي ليكون تصنيفاً أباً (منع العلاقات الدائرية)' };
      }
      if (visited.has(curr)) break;
      visited.add(curr);
      const parentNode = memoryCategories.find(c => c.id === curr);
      curr = parentNode?.parentCategoryId || null;
    }
  }

  // 3. التحقق من عدم تكرار الاسم في نفس المستوى (نفس التصنيف الأب)
  const duplicate = memoryCategories.find(c =>
    c.id !== id &&
    (c.parentCategoryId || null) === parentCategoryId &&
    c.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    return { success: false, error: `يوجد تصنيف آخر بنفس الاسم "${name}" ضمن هذا المستوى` };
  }

  const now = new Date().toISOString();
  const existingIdx = memoryCategories.findIndex(c => c.id === id);
  const showInPOS = category.showInPOS !== undefined ? Boolean(category.showInPOS) : true;
  const status = category.status || 'نشط';

  // حساب ترتيب العرض التلقائي داخل نفس المستوى إذا لم يُحدد
  let displayOrder = Number(category.displayOrder || 0);
  if (!category.displayOrder && existingIdx < 0) {
    const siblings = memoryCategories.filter(c => (c.parentCategoryId || null) === parentCategoryId);
    const maxOrder = siblings.reduce((max, s) => Math.max(max, s.displayOrder || 0), 0);
    displayOrder = maxOrder + 1;
  }

  const categoryToSave: ProductCategory = {
    id,
    name,
    parentCategoryId,
    status,
    showInPOS,
    displayOrder,
    createdAt: category.createdAt || (existingIdx >= 0 ? memoryCategories[existingIdx].createdAt : now),
    updatedAt: now
  };

  // 4. تسلسل الإخفاء عن نقطة البيع: عند إخفاء تصنيف، إخفاء كل فروعه التابعة تلقائيًا
  function cascadeHideSubcategories(parentId: string) {
    for (const c of memoryCategories) {
      if (c.parentCategoryId === parentId) {
        c.showInPOS = false;
        c.updatedAt = now;
        cascadeHideSubcategories(c.id);
      }
    }
  }

  if (existingIdx >= 0) {
    memoryCategories[existingIdx] = categoryToSave;
    if (!showInPOS) {
      cascadeHideSubcategories(id);
    }
    recordAuditLog(session || {}, 'CATEGORY_UPDATE', 'ProductCategory', id, `تعديل تصنيف: ${name}`);
  } else {
    memoryCategories.push(categoryToSave);
    recordAuditLog(session || {}, 'CATEGORY_CREATE', 'ProductCategory', id, `إنشاء تصنيف جديد: ${name}`);
  }

  return { success: true, category: categoryToSave };
}

/**
 * حذف تصنيف مع التحقق الصارم من عدم ارتباطه بأصناف أو فروع
 */
export async function deleteCategory(
  id: string,
  session?: { token?: string; role?: UserRole; permissions?: PermissionKey[]; name?: string; phone?: string }
): Promise<{ success: boolean; error?: string; code?: string; hasChildren?: boolean; hasItems?: boolean }> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('deleteCategory', { id }, session?.token);
    if (res.success) return { success: true };
    return {
      ...buildSheetsWriteFailure(res, 'تعذر حذف التصنيف من Google Sheets'),
      ...(res.hasChildren !== undefined ? { hasChildren: res.hasChildren } : {}),
      ...(res.hasItems !== undefined ? { hasItems: res.hasItems } : {})
    };
  }

  // فحص وجود فروع تحت هذا التصنيف
  const childCategories = memoryCategories.filter(c => c.parentCategoryId === id);
  if (childCategories.length > 0) {
    return {
      success: false,
      hasChildren: true,
      error: `لا يمكن حذف هذا التصنيف لأنه يحتوي على (${childCategories.length}) تصنيفات فرعية تحته (${childCategories.map(c => c.name).slice(0, 3).join('، ')}...). يرجى نقل أو حذف التصنيفات الفرعية أولاً.`
    };
  }

  // فحص وجود أصناف مرتبطة بالتصنيف
  const linkedItems = memoryItems.filter(i => i.categoryId === id);
  if (linkedItems.length > 0) {
    return {
      success: false,
      hasItems: true,
      error: `لا يمكن حذف هذا التصنيف لوجود (${linkedItems.length}) أصناف مرتبطة به حالياً (${linkedItems.map(i => i.name).slice(0, 3).join('، ')}...). يمكنك نقل الأصناف لتصنيف آخر أو أرشفة التصنيف بدلاً من حذفه.`
    };
  }

  const existingIdx = memoryCategories.findIndex(c => c.id === id);
  if (existingIdx >= 0) {
    const deletedName = memoryCategories[existingIdx].name;
    memoryCategories.splice(existingIdx, 1);
    recordAuditLog(session || {}, 'CATEGORY_DELETE', 'ProductCategory', id, `حذف تصنيف: ${deletedName}`);
    return { success: true };
  }

  return { success: false, error: 'التصنيف غير موجود' };
}

/**
 * ترحيل آمن وتكراري لربط الأصناف القديمة بمعرفات التصنيفات (Category IDs)
 */
export async function migrateItemCategories(session?: {
  token?: string;
  role?: UserRole;
  permissions?: PermissionKey[];
  name?: string;
  phone?: string;
}): Promise<{
  success: boolean;
  totalItems: number;
  alreadyLinked: number;
  migrated: number;
  ambiguous: number;
  unmatched: number;
  needsReview: number;
  details?: any[];
  message?: string;
  error?: string;
  code?: string;
}> {
  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('migrateItemCategories', undefined, session?.token);
    if (res.success) {
      return res as any;
    }
    const failure = buildSheetsWriteFailure(res, 'فشل تشغيل الترحيل في Google Sheets');
    return {
      ...failure,
      totalItems: 0,
      alreadyLinked: 0,
      migrated: 0,
      ambiguous: 0,
      unmatched: 0,
      needsReview: 0
    };
  }

  // وضع الذاكرة المحلية (In-Memory Migration)
  const catById = new Map<string, ProductCategory>();
  const catByName = new Map<string, ProductCategory[]>();

  for (const cat of memoryCategories) {
    catById.set(cat.id, cat);
    const norm = cat.name.trim().toLowerCase();
    const existing = catByName.get(norm) || [];
    existing.push(cat);
    catByName.set(norm, existing);
  }

  let alreadyLinked = 0;
  let migrated = 0;
  let ambiguous = 0;
  let unmatched = 0;
  const details: any[] = [];

  for (const item of memoryItems) {
    const currentCatId = item.categoryId ? String(item.categoryId).trim() : '';
    if (currentCatId && catById.has(currentCatId)) {
      alreadyLinked++;
      continue;
    }

    // فحص إذا كان هناك اسم تصنيف كنص مسجل سابقاً
    const textToMatch = currentCatId || (item as any).categoryName || (item as any).category;
    if (!textToMatch) {
      continue;
    }

    const normText = String(textToMatch).trim().toLowerCase();
    const matches = catByName.get(normText) || [];

    if (matches.length === 1) {
      item.categoryId = matches[0].id;
      item.categoryName = matches[0].name;
      migrated++;
      details.push({
        itemId: item.id,
        itemName: item.name,
        oldValue: textToMatch,
        assignedCategoryId: matches[0].id,
        assignedCategoryName: matches[0].name,
        status: 'migrated'
      });
    } else if (matches.length > 1) {
      ambiguous++;
      details.push({
        itemId: item.id,
        itemName: item.name,
        oldValue: textToMatch,
        reason: `يوجد أكثر من تصنيف بنفس الاسم (${matches.length})، لا يمكن التخمين الآلي منعاً لخلط الفروع`,
        candidateCategoryIds: matches.map(m => m.id),
        status: 'ambiguous_needs_review'
      });
    } else {
      unmatched++;
      details.push({
        itemId: item.id,
        itemName: item.name,
        oldValue: textToMatch,
        reason: 'لم يتم العثور على تصنيف يطابق هذا الاسم',
        status: 'unmatched'
      });
    }
  }

  recordAuditLog(
    session || {},
    'MIGRATE_CATEGORIES',
    'Items',
    'all',
    `ترحيل تصنيفات الأصناف: ربط ${migrated} صنف، التباس ${ambiguous} صنف`
  );

  return {
    success: true,
    totalItems: memoryItems.length,
    alreadyLinked,
    migrated,
    ambiguous,
    unmatched,
    needsReview: ambiguous + unmatched,
    details,
    message: `تم ترحيل ${migrated} صنف بنجاح. السجلات التي تحتاج مراجعة يدوية: ${ambiguous + unmatched}`
  };
}

/* ============================================================================
 * التعديل المباشر لكميات الأصناف (Direct Stock Adjustments) مع قفل التزامن
 * ============================================================================ */

let isStockAdjustingLock = false;

async function acquireStockLock(timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (isStockAdjustingLock) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise(r => setTimeout(r, 50));
  }
  isStockAdjustingLock = true;
  return true;
}

function releaseStockLock() {
  isStockAdjustingLock = false;
}

/**
 * تعديل كمية صنف مباشرة مع سبب إجباري وتوثيق دقيق وحركة مخزون فريدة
 */
export async function adjustItemStock(
  itemId: string,
  payload: { newQuantity: number; reason: string; source?: string; warehouseId?: string },
  session?: { token?: string; role?: UserRole; permissions?: PermissionKey[]; name?: string; phone?: string; userId?: string }
): Promise<{ success: boolean; statusCode?: number; item?: Item; movement?: StockMovement; error?: string; code?: string }> {
  const reason = (payload.reason || '').trim();
  if (!reason) {
    return { success: false, statusCode: 400, error: 'سبب تعديل الكمية إجباري ومطلوب لتوثيق حركة تسوية المخزون' };
  }

  const newQty = Number(payload.newQuantity);
  if (isNaN(newQty) || newQty < 0) {
    return { success: false, statusCode: 400, error: 'الكمية الجديدة يجب أن تكون رقماً موجباً أو صفراً' };
  }

  const lockAcquired = await acquireStockLock(6000);
  if (!lockAcquired) {
    return { success: false, statusCode: 409, error: 'النظام مشغول بتحديث حركة مخزنية أخرى حالياً، يرجى المحاولة بعد لحظات' };
  }

  try {
    const config = getSystemConfig();
    if (isSheetsDataMode(config)) {
      const res = await callAppsScript(
        'adjustItemStock',
        { itemId, newQuantity: newQty, reason, source: payload.source, warehouseId: payload.warehouseId },
        session?.token
      );
      if (res.success && res.item) {
        return { success: true, item: res.item, movement: res.movement };
      }
      return buildSheetsWriteFailure(res, 'تعذر تنفيذ تسوية المخزون في Google Sheets');
    }

    const item = memoryItems.find(i => i.id === itemId);
    if (!item) {
      return { success: false, statusCode: 404, error: 'الصنف المطلوب غير موجود' };
    }

    const whRes = resolveWarehouseForOperation(payload.warehouseId, session as any, {
      fallbackWarehouseId: getDefaultWarehouse().id,
      requireActive: true,
      enforceUserAccess: true
    });
    if (!whRes.ok) {
      return { success: false, statusCode: whRes.statusCode, error: whRes.error };
    }
    const targetWh = whRes.warehouse;

    const oldQty = getItemWarehouseStock(item.id, targetWh.id);
    const diff = Math.round((newQty - oldQty) * 1000) / 1000;
    const now = new Date().toISOString();
    const docNumber = `ADJ-${Date.now().toString().slice(-6)}`;
    const movementId = generateUUID();
    const userName = (session as any)?.name || (session as any)?.phone || 'المستخدم';
    const userId = (session as any)?.userId || (session as any)?.id || '';

    // تحديث رصيد المخزن المحدد فقط وإعادة احتساب الإجمالي للصنف
    const updatedWhQty = setItemWarehouseBalance(item.id, targetWh.id, newQty);

    // توثيق حركة المخزون
    const movement: StockMovement = {
      id: movementId,
      date: now,
      itemId: item.id,
      itemName: item.name,
      sku: item.sku || '',
      barcode: item.barcode || '',
      warehouseId: targetWh.id,
      warehouseName: targetWh.name,
      documentNumber: docNumber,
      movementType: 'تعديل كمية مباشر',
      quantity: Math.abs(diff),
      quantityBefore: oldQty,
      quantityAfter: updatedWhQty,
      balanceAfter: updatedWhQty,
      unitPrice: item.salePrice || 0,
      totalAmount: Math.abs(diff) * (item.salePrice || 0),
      reason,
      source: payload.source || 'تعديل مباشر من شاشة المخزون',
      referenceNumber: docNumber,
      userName,
      userId,
      notes: `${diff > 0 ? 'زيادة' : 'خصم'} مباشر بمخزن "${targetWh.name}" بمقدار (${diff > 0 ? '+' + diff : diff}). السبب: ${reason}`
    };

    memoryStockMovements.push(movement);

    // تسجيل التعديل في سجل تغيرات الصنف
    memoryItemChangeLogs.push({
      id: movementId,
      itemId: item.id,
      itemName: item.name,
      fieldName: 'الكمية بالمخزن',
      oldValue: oldQty,
      newValue: updatedWhQty,
      userName,
      timestamp: now,
      reason: `${targetWh.name}: ${reason}`
    });

    // تسجيل سجل التدقيق بنفس المعرف
    recordAuditLog(
      session || {},
      'STOCK_DIRECT_ADJUST',
      'Item',
      item.id,
      `تعديل كمية مباشر للصنف "${item.name}" بمخزن "${targetWh.name}": من ${oldQty} إلى ${updatedWhQty} (الفرق: ${diff > 0 ? '+' + diff : diff}). السبب: ${reason} [مرجع: ${docNumber}]`
    );

    return { success: true, item, movement };
  } finally {
    releaseStockLock();
  }
}

/* ============================================================================
 * تقارير حركة الصنف وتعديلات الكميات
 * ============================================================================ */

/**
 * تقرير حركة صنف تفصيلي خلال فترة زمنية
 */
export async function getItemMovementReport(
  params: { itemId: string; startDate?: string; endDate?: string; warehouseId?: string },
  session?: { token?: string; role?: UserRole; permissions?: PermissionKey[] }
): Promise<{ success: boolean; report?: ItemMovementReport; error?: string }> {
  if (!params.itemId) {
    return { success: false, error: 'معرّف الصنف مطلوب لعرض تقرير الحركة' };
  }

  const config = getSystemConfig();
  const cacheKey = `itemMovementReport:${JSON.stringify(params)}`;
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getItemMovementReport', params, session?.token);
    if (res.success && res.report) {
      setSheetsCache(cacheKey, res.report);
      return { success: true, report: res.report };
    }
    const cached = getSheetsCache<ItemMovementReport>(cacheKey);
    if (cached && !res.error) {
      return { success: true, report: cached.data, stale: true, lastSyncAt: cached.lastSyncAt } as any;
    }
    if (cached && (res.isTransportError || res.isTimeout || res.code === 'SHEETS_UNAVAILABLE' || res.code === 'UNKNOWN_RESULT')) {
      return { success: true, report: cached.data, stale: true, lastSyncAt: cached.lastSyncAt } as any;
    }
    return buildSheetsWriteFailure(res, 'تعذر جلب تقرير حركة الصنف من Google Sheets');
  }

  const item = memoryItems.find(i => i.id === params.itemId);
  if (!item) {
    return { success: false, error: 'الصنف المطلوب غير موجود' };
  }

  const canViewPurchase = session?.role === 'designer' || session?.permissions?.includes('prices.view_purchase');
  const filterWhId = params.warehouseId && params.warehouseId.toUpperCase() !== WAREHOUSE_ALL_TOKEN ? params.warehouseId : undefined;

  // جلب كل حركات الصنف وترتيبها زمنياً تصاعدياً (مع دعم الفلترة بالمخزن)
  const allItemMovements = memoryStockMovements
    .filter(m => m.itemId === params.itemId && (!filterWhId || m.warehouseId === filterWhId))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const startDateStr = params.startDate ? toCairoDateStr(params.startDate) : null;
  const endDateStr = params.endDate ? toCairoDateStr(params.endDate) : null;

  let initialBalance = 0;
  const inPeriodRecords: ItemMovementRecord[] = [];
  let totalInward = 0;
  let totalOutward = 0;

  let runningBalance = 0;

  for (const m of allItemMovements) {
    const mDateStr = toCairoDateStr(m.date);

    // حساب الوارد والصادر لهذه الحركة
    let inwardQty = 0;
    let outwardQty = 0;

    switch (m.movementType) {
      case 'شراء':
      case 'استيراد رصيد افتتاحي':
      case 'رصيد افتتاحي بالإكسيل':
      case 'إلغاء فاتورة بيع':
      case 'تحويل_وارد':
        inwardQty = m.quantity;
        break;
      case 'بيع':
      case 'مرتجع شراء':
      case 'إلغاء فاتورة شراء':
      case 'تحويل_صادر':
        outwardQty = m.quantity;
        break;
      case 'مرتجع':
        // مرتجع البيع لا يزيد المخزن إلا إذا كانت حالته 'يرجع المخزن'
        if (!m.condition || m.condition === 'يرجع المخزن') {
          inwardQty = m.quantity;
        }
        break;
      case 'تعديل كمية مباشر':
      case 'تسوية جرد':
      case 'تسوية مخزون بالإكسيل':
        if (m.quantityAfter !== undefined && m.quantityBefore !== undefined) {
          if (m.quantityAfter >= m.quantityBefore) {
            inwardQty = m.quantityAfter - m.quantityBefore;
          } else {
            outwardQty = m.quantityBefore - m.quantityAfter;
          }
        } else {
          // افتراض زيادة إن لم تتوفر قبل وبعد
          inwardQty = m.quantity;
        }
        break;
      default:
        inwardQty = m.quantity;
    }

    // فحص إن كانت الحركة قبل تاريخ البداية
    if (startDateStr && mDateStr < startDateStr) {
      runningBalance += (inwardQty - outwardQty);
      initialBalance = runningBalance;
    } else if (!endDateStr || mDateStr <= endDateStr) {
      // الحركة تقع ضمن الفترة
      runningBalance += (inwardQty - outwardQty);
      totalInward += inwardQty;
      totalOutward += outwardQty;

      // تحديد طرف المعاملة إن وجد
      let party = m.party;
      if (!party) {
        if (m.movementType === 'بيع') {
          const inv = memoryInvoices.find(iv => iv.invoiceNumber === m.documentNumber);
          party = inv ? `${inv.platformName || ''} - ${inv.customerName || ''}`.trim() : undefined;
        } else if (m.movementType === 'شراء') {
          const pur = memoryPurchases.find(p => p.invoiceNumber === m.documentNumber);
          party = pur?.supplierName;
        }
      }

      inPeriodRecords.push({
        id: m.id,
        date: m.date,
        movementType: m.movementType,
        documentNumber: m.documentNumber,
        inwardQty,
        outwardQty,
        runningBalance,
        unitPrice: canViewPurchase ? (m.unitPrice ?? item.purchasePrice ?? item.salePrice) : item.salePrice,
        totalAmount: (inwardQty > 0 ? inwardQty : outwardQty) * (canViewPurchase ? (m.unitPrice ?? item.purchasePrice ?? item.salePrice ?? 0) : (item.salePrice || 0)),
        party,
        userName: m.userName,
        reason: m.reason || m.notes,
        condition: m.condition
      });
    }
  }

  // إذا لم تكن هناك حركات سابقة، فرصيد البداية هو الرصيد المحسوب
  const finalBalance = runningBalance;

  const report: ItemMovementReport = {
    itemId: item.id,
    itemName: item.name,
    sku: item.sku,
    barcode: item.barcode,
    categoryName: memoryCategories.find(c => c.id === item.categoryId)?.name,
    currentStock: filterWhId ? getItemWarehouseStock(item.id, filterWhId) : item.stockQuantity,
    startDate: params.startDate,
    endDate: params.endDate,
    initialBalance,
    totalInward,
    totalOutward,
    finalBalance,
    movements: inPeriodRecords
  };

  return { success: true, report };
}

/**
 * تقرير تعديلات كميات الأصناف المباشرة
 */
export async function getStockAdjustmentsReport(
  params?: { itemId?: string; startDate?: string; endDate?: string; warehouseId?: string },
  session?: { token?: string; role?: UserRole; permissions?: PermissionKey[] }
): Promise<{ success: boolean; report?: StockAdjustmentsReport; error?: string }> {
  const config = getSystemConfig();
  const cacheKey = `stockAdjustmentsReport:${JSON.stringify(params || {})}`;
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getStockAdjustmentsReport', params || {}, session?.token);
    if (res.success && res.report) {
      setSheetsCache(cacheKey, res.report);
      return { success: true, report: res.report };
    }
    const cached = getSheetsCache<StockAdjustmentsReport>(cacheKey);
    if (cached && (!res.error || res.isTransportError || res.isTimeout || res.code === 'SHEETS_UNAVAILABLE' || res.code === 'UNKNOWN_RESULT')) {
      return { success: true, report: cached.data, stale: true, lastSyncAt: cached.lastSyncAt } as any;
    }
    return buildSheetsWriteFailure(res, 'تعذر جلب تقرير تسويات المخزون من Google Sheets');
  }

  const startDateStr = params?.startDate ? toCairoDateStr(params.startDate) : null;
  const endDateStr = params?.endDate ? toCairoDateStr(params.endDate) : null;
  const filterWhId = params?.warehouseId && params.warehouseId.toUpperCase() !== WAREHOUSE_ALL_TOKEN ? params.warehouseId : undefined;

  const adjustments = memoryStockMovements.filter(m => {
    if (
      m.movementType !== 'تعديل كمية مباشر' &&
      m.movementType !== 'تسوية جرد' &&
      m.movementType !== 'تسوية مخزون بالإكسيل'
    ) return false;
    if (params?.itemId && m.itemId !== params.itemId) return false;
    if (filterWhId && m.warehouseId !== filterWhId) return false;
    const mDateStr = toCairoDateStr(m.date);
    if (startDateStr && mDateStr < startDateStr) return false;
    if (endDateStr && mDateStr > endDateStr) return false;
    return true;
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  let totalIncreases = 0;
  let totalDecreases = 0;

  const records: StockAdjustmentRecord[] = adjustments.map(m => {
    const before = m.quantityBefore !== undefined ? m.quantityBefore : 0;
    const after = m.quantityAfter !== undefined ? m.quantityAfter : (m.balanceAfter || 0);
    const diff = after - before;

    if (diff > 0) totalIncreases += diff;
    else totalDecreases += Math.abs(diff);

    return {
      id: m.id,
      date: m.date,
      itemId: m.itemId,
      itemName: m.itemName,
      sku: m.sku,
      barcode: m.barcode,
      warehouseId: m.warehouseId,
      warehouseName: m.warehouseName,
      movementType: m.movementType,
      quantityBefore: before,
      difference: diff,
      quantityAfter: after,
      reason: m.reason || m.notes || 'تعديل مباشر',
      userName: m.userName || 'المستخدم',
      userId: m.userId,
      source: m.source || 'شاشة الأصناف',
      referenceNumber: m.referenceNumber || m.documentNumber
    };
  });

  const report: StockAdjustmentsReport = {
    records,
    totalIncreases,
    totalDecreases,
    netAdjustment: totalIncreases - totalDecreases,
    totalAdjustmentsCount: records.length,
    startDate: params?.startDate,
    endDate: params?.endDate,
    itemId: params?.itemId
  };

  return { success: true, report };
}

/**
 * تقرير تقسيط المنصات (BNPL)
 * حساب مبيعات وأقساط المنصات وفروقات الأسعار والعمولات واستقطاعات BNPL في مرور واحد
 */
export async function getBnplReport(
  params?: {
    from?: string;
    to?: string;
    platformId?: string;
    productQuery?: string;
    groupBy?: 'item' | 'platform' | 'invoice';
  },
  session?: { token?: string; role?: UserRole; permissions?: PermissionKey[] }
): Promise<{ success: boolean; report?: BnplReport; error?: string }> {
  const config = getSystemConfig();
  const cacheKey = `bnplReport:${JSON.stringify(params || {})}`;
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getBnplReport', params || {}, session?.token);
    if (res.success && res.report) {
      setSheetsCache(cacheKey, res.report);
      return { success: true, report: res.report };
    }
    const cached = getSheetsCache<BnplReport>(cacheKey);
    if (cached && (!res.error || res.isTransportError || res.isTimeout || res.code === 'SHEETS_UNAVAILABLE' || res.code === 'UNKNOWN_RESULT')) {
      return { success: true, report: cached.data, stale: true, lastSyncAt: cached.lastSyncAt } as any;
    }
    return buildSheetsWriteFailure(res, 'تعذر جلب تقرير التقسيط من Google Sheets');
  }

  const fromDate = params?.from ? toCairoDateStr(params.from) : null;
  const toDate = params?.to ? toCairoDateStr(params.to) : null;
  const targetPlatformId = params?.platformId && params.platformId !== 'ALL' ? params.platformId : null;
  const normalizedQuery = params?.productQuery ? normalizeArabicText(params.productQuery) : null;
  const groupBy = params?.groupBy || 'item';

  // 1. خريطة المرتجعات واستردادات الخزينة لكل فاتورة
  const returnsByInvoice = new Map<string, ReturnRecord[]>();
  const cashboxRefundsByInvoice = new Map<string, number>();

  for (const ret of memoryReturns) {
    if (!ret.invoiceNumber) continue;
    const list = returnsByInvoice.get(ret.invoiceNumber) || [];
    list.push(ret);
    returnsByInvoice.set(ret.invoiceNumber, list);

    if (ret.refundStatus === 'استرداد نقدي' && ret.refundedAmount) {
      cashboxRefundsByInvoice.set(
        ret.invoiceNumber,
        (cashboxRefundsByInvoice.get(ret.invoiceNumber) || 0) + (Number(ret.refundedAmount) || 0)
      );
    }
  }

  const itemsMap = new Map<string, Item>();
  for (const it of memoryItems) {
    itemsMap.set(it.id, it);
  }

  const matchedInvoiceNumbers = new Set<string>();
  const matchedInvoicesMap = new Map<string, Invoice>();
  let totalPieces = 0;
  let totalCustomerPaid = 0;
  let totalPriceIncrease = 0;
  let totalBnplAmount = 0;
  let totalBaseAmount = 0;
  let totalCommission = 0;
  let totalLinesNet = 0;

  interface ProcessedLine {
    date: string;
    invoiceNumber: string;
    platformId: string;
    platformName: string;
    itemId: string;
    itemName: string;
    itemBarcode?: string;
    quantity: number;
    baseUnitPrice: number;
    bnplPercent: number;
    customerUnitPrice: number;
    priceIncrease: number;
    bnplAmount: number;
    commission: number;
    net: number;
  }

  const processedLines: ProcessedLine[] = [];

  // مرور واحد على الفواتير
  for (const inv of memoryInvoices) {
    // استبعاد الفواتير الملغاة
    if (inv.status === 'ملغاة') continue;

    // فلتر المنصة
    if (targetPlatformId && inv.platformId !== targetPlatformId) continue;

    // فلتر التاريخ (بتوقيت Cairo)
    if (fromDate || toDate) {
      if (!isDateInRange(inv.date, fromDate, toDate)) continue;
    }

    // تجهيز كميات المرتجع لهذه الفاتورة
    const invReturns = returnsByInvoice.get(inv.invoiceNumber) || [];
    const returnedQtyByItem: Record<string, number> = {};
    for (const r of invReturns) {
      for (const rl of r.lines || []) {
        returnedQtyByItem[rl.itemId] = (returnedQtyByItem[rl.itemId] || 0) + (Number(rl.returnedQuantity) || 0);
      }
    }

    let invoiceHasBnplLine = false;

    // معالجة سطور الفاتورة
    for (const line of inv.lines || []) {
      const bnplPercent = Number(line.bnplPercent) || 0;
      if (bnplPercent <= 0) continue;

      // خصم المرتجع من الكمية
      let returnedSoFar = returnedQtyByItem[line.itemId] || 0;
      let deductQty = 0;
      if (returnedSoFar > 0) {
        deductQty = Math.min(line.quantity, returnedSoFar);
        returnedQtyByItem[line.itemId] -= deductQty;
      }
      const netQuantity = line.quantity - deductQty;
      if (netQuantity <= 0) continue;

      // فلتر الصنف (اسم، كود، باركود) مع توحيد الحروف
      if (normalizedQuery) {
        const nameNorm = normalizeArabicText(line.itemNameAtSale);
        const idNorm = normalizeArabicText(line.itemId);
        const barcodeNorm = line.barcodeAtSale ? normalizeArabicText(line.barcodeAtSale) : '';
        const master = itemsMap.get(line.itemId);
        const masterBarcode = master?.barcode ? normalizeArabicText(master.barcode) : '';
        const masterName = master?.name ? normalizeArabicText(master.name) : '';

        const matched =
          nameNorm.includes(normalizedQuery) ||
          idNorm.includes(normalizedQuery) ||
          barcodeNorm.includes(normalizedQuery) ||
          masterBarcode.includes(normalizedQuery) ||
          masterName.includes(normalizedQuery);

        if (!matched) continue;
      }

      invoiceHasBnplLine = true;

      // الحسابات المالية الدقيقة
      const baseUnitPrice = Number(line.baseUnitPrice != null ? line.baseUnitPrice : line.salePriceAtSale) || 0;
      const customerUnitPrice = Number(
        line.customerUnitPrice != null
          ? line.customerUnitPrice
          : Math.round(baseUnitPrice * (1 + bnplPercent / 100) * 100) / 100
      );
      const bnplUnitAmount = Number(
        line.bnplUnitAmount != null ? line.bnplUnitAmount : Math.round((customerUnitPrice - baseUnitPrice) * 100) / 100
      );
      // مبلغ BNPL المستقطع للوحدة: bnplDeductionUnit أو bnplUnitAmount للفواتير القديمة
      const bnplDeductionUnit = Number(
        line.bnplDeductionUnit !== undefined && line.bnplDeductionUnit !== null
          ? line.bnplDeductionUnit
          : bnplUnitAmount
      );

      const lineCustomerPaid = Math.round(customerUnitPrice * netQuantity * 100) / 100;
      const linePriceIncrease = Math.round(bnplUnitAmount * netQuantity * 100) / 100;
      const lineBnplTotal = Math.round(bnplDeductionUnit * netQuantity * 100) / 100;
      const lineBaseTotal = Math.round(baseUnitPrice * netQuantity * 100) / 100;

      // العمولة تُقرأ من السطر المحفوظ ولا يُعاد حسابها
      const unitCommission = line.unitDiscountValue !== undefined && line.unitDiscountValue !== null
        ? Number(line.unitDiscountValue)
        : (baseUnitPrice * ((Number(line.platformDiscountPercentAtSale) || 0) / 100));
      const lineCommission = Math.round(unitCommission * netQuantity * 100) / 100;
      const lineNet = Math.round((lineCustomerPaid - lineBnplTotal - lineCommission) * 100) / 100;

      totalPieces += netQuantity;
      totalCustomerPaid += lineCustomerPaid;
      totalPriceIncrease += linePriceIncrease;
      totalBnplAmount += lineBnplTotal;
      totalBaseAmount += lineBaseTotal;
      totalCommission += lineCommission;
      totalLinesNet += lineNet;

      processedLines.push({
        date: toCairoDateStr(inv.date),
        invoiceNumber: inv.invoiceNumber,
        platformId: inv.platformId || 'ALL',
        platformName: inv.platformName || inv.platform || '',
        itemId: line.itemId,
        itemName: line.itemNameAtSale,
        itemBarcode: line.barcodeAtSale,
        quantity: netQuantity,
        baseUnitPrice,
        bnplPercent,
        customerUnitPrice,
        priceIncrease: linePriceIncrease,
        bnplAmount: lineBnplTotal,
        commission: lineCommission,
        net: lineNet
      });
    }

    if (invoiceHasBnplLine) {
      matchedInvoiceNumbers.add(inv.invoiceNumber);
      matchedInvoicesMap.set(inv.invoiceNumber, inv);
    }
  }

  // صافي الفواتير التي دخلت الخزنة فعلياً
  let totalInvoicesNetInCashbox = 0;
  for (const invNumber of matchedInvoiceNumbers) {
    const inv = matchedInvoicesMap.get(invNumber)!;
    const refunds = cashboxRefundsByInvoice.get(invNumber) || 0;
    const actualNet = Math.max(0, (Number(inv.netAmount) || 0) - refunds);
    totalInvoicesNetInCashbox += actualNet;
  }

  // التجميع حسب الاختيار
  let rows: BnplReportLine[] = [];

  if (groupBy === 'item') {
    const grouped = new Map<string, {
      itemId: string;
      itemName: string;
      itemBarcode?: string;
      platformNames: Set<string>;
      invoiceNumbers: Set<string>;
      quantity: number;
      totalBase: number;
      totalCustomerPaid: number;
      totalPriceIncrease: number;
      totalBnpl: number;
      commission: number;
      net: number;
    }>();

    for (const l of processedLines) {
      let g = grouped.get(l.itemId);
      if (!g) {
        g = {
          itemId: l.itemId,
          itemName: l.itemName,
          itemBarcode: l.itemBarcode,
          platformNames: new Set<string>(),
          invoiceNumbers: new Set<string>(),
          quantity: 0,
          totalBase: 0,
          totalCustomerPaid: 0,
          totalPriceIncrease: 0,
          totalBnpl: 0,
          commission: 0,
          net: 0
        };
        grouped.set(l.itemId, g);
      }
      g.platformNames.add(l.platformName);
      g.invoiceNumbers.add(l.invoiceNumber);
      g.quantity += l.quantity;
      g.totalBase += l.baseUnitPrice * l.quantity;
      g.totalCustomerPaid += l.customerUnitPrice * l.quantity;
      g.totalPriceIncrease += l.priceIncrease;
      g.totalBnpl += l.bnplAmount;
      g.commission += l.commission;
      g.net += l.net;
    }

    rows = Array.from(grouped.values()).map(g => {
      const avgBase = g.quantity > 0 ? Math.round((g.totalBase / g.quantity) * 100) / 100 : 0;
      const avgCustomer = g.quantity > 0 ? Math.round((g.totalCustomerPaid / g.quantity) * 100) / 100 : 0;
      const avgBnplPercent = g.totalBase > 0 ? Math.round((g.totalPriceIncrease / g.totalBase) * 10000) / 100 : 0;
      const pltName = g.platformNames.size === 1 ? Array.from(g.platformNames)[0] : 'متعدد';

      return {
        id: `item-${g.itemId}`,
        date: '-',
        invoiceNumber: `${g.invoiceNumbers.size} فواتير`,
        platformId: 'ALL',
        platformName: pltName,
        itemId: g.itemId,
        itemName: g.itemName,
        itemBarcode: g.itemBarcode,
        quantity: g.quantity,
        baseUnitPrice: avgBase,
        bnplPercent: avgBnplPercent,
        customerUnitPrice: avgCustomer,
        priceIncrease: Math.round(g.totalPriceIncrease * 100) / 100,
        bnplAmount: Math.round(g.totalBnpl * 100) / 100,
        commission: Math.round(g.commission * 100) / 100,
        net: Math.round(g.net * 100) / 100
      };
    });
  } else if (groupBy === 'platform') {
    const grouped = new Map<string, {
      platformId: string;
      platformName: string;
      itemNames: Set<string>;
      invoiceNumbers: Set<string>;
      quantity: number;
      totalBase: number;
      totalCustomerPaid: number;
      totalPriceIncrease: number;
      totalBnpl: number;
      commission: number;
      net: number;
    }>();

    for (const l of processedLines) {
      let g = grouped.get(l.platformId);
      if (!g) {
        g = {
          platformId: l.platformId,
          platformName: l.platformName,
          itemNames: new Set<string>(),
          invoiceNumbers: new Set<string>(),
          quantity: 0,
          totalBase: 0,
          totalCustomerPaid: 0,
          totalPriceIncrease: 0,
          totalBnpl: 0,
          commission: 0,
          net: 0
        };
        grouped.set(l.platformId, g);
      }
      g.itemNames.add(l.itemName);
      g.invoiceNumbers.add(l.invoiceNumber);
      g.quantity += l.quantity;
      g.totalBase += l.baseUnitPrice * l.quantity;
      g.totalCustomerPaid += l.customerUnitPrice * l.quantity;
      g.totalPriceIncrease += l.priceIncrease;
      g.totalBnpl += l.bnplAmount;
      g.commission += l.commission;
      g.net += l.net;
    }

    rows = Array.from(grouped.values()).map(g => {
      const avgBase = g.quantity > 0 ? Math.round((g.totalBase / g.quantity) * 100) / 100 : 0;
      const avgCustomer = g.quantity > 0 ? Math.round((g.totalCustomerPaid / g.quantity) * 100) / 100 : 0;
      const avgBnplPercent = g.totalBase > 0 ? Math.round((g.totalPriceIncrease / g.totalBase) * 10000) / 100 : 0;

      return {
        id: `plt-${g.platformId}`,
        date: '-',
        invoiceNumber: `${g.invoiceNumbers.size} فواتير`,
        platformId: g.platformId,
        platformName: g.platformName,
        itemId: '-',
        itemName: `${g.itemNames.size} أصناف`,
        quantity: g.quantity,
        baseUnitPrice: avgBase,
        bnplPercent: avgBnplPercent,
        customerUnitPrice: avgCustomer,
        priceIncrease: Math.round(g.totalPriceIncrease * 100) / 100,
        bnplAmount: Math.round(g.totalBnpl * 100) / 100,
        commission: Math.round(g.commission * 100) / 100,
        net: Math.round(g.net * 100) / 100
      };
    });
  } else {
    // groupBy === 'invoice'
    const grouped = new Map<string, {
      invoiceNumber: string;
      date: string;
      platformId: string;
      platformName: string;
      itemNames: string[];
      quantity: number;
      totalBase: number;
      totalCustomerPaid: number;
      totalPriceIncrease: number;
      totalBnpl: number;
      commission: number;
      net: number;
    }>();

    for (const l of processedLines) {
      let g = grouped.get(l.invoiceNumber);
      if (!g) {
        g = {
          invoiceNumber: l.invoiceNumber,
          date: l.date,
          platformId: l.platformId,
          platformName: l.platformName,
          itemNames: [],
          quantity: 0,
          totalBase: 0,
          totalCustomerPaid: 0,
          totalPriceIncrease: 0,
          totalBnpl: 0,
          commission: 0,
          net: 0
        };
        grouped.set(l.invoiceNumber, g);
      }
      if (!g.itemNames.includes(l.itemName)) {
        g.itemNames.push(l.itemName);
      }
      g.quantity += l.quantity;
      g.totalBase += l.baseUnitPrice * l.quantity;
      g.totalCustomerPaid += l.customerUnitPrice * l.quantity;
      g.totalPriceIncrease += l.priceIncrease;
      g.totalBnpl += l.bnplAmount;
      g.commission += l.commission;
      g.net += l.net;
    }

    rows = Array.from(grouped.values()).map(g => {
      const avgBase = g.quantity > 0 ? Math.round((g.totalBase / g.quantity) * 100) / 100 : 0;
      const avgCustomer = g.quantity > 0 ? Math.round((g.totalCustomerPaid / g.quantity) * 100) / 100 : 0;
      const avgBnplPercent = g.totalBase > 0 ? Math.round((g.totalPriceIncrease / g.totalBase) * 10000) / 100 : 0;
      const itemDisplay = g.itemNames.length === 1
        ? g.itemNames[0]
        : `${g.itemNames[0]} (+${g.itemNames.length - 1} أصناف)`;

      return {
        id: `inv-${g.invoiceNumber}`,
        date: g.date,
        invoiceNumber: g.invoiceNumber,
        platformId: g.platformId,
        platformName: g.platformName,
        itemId: '-',
        itemName: itemDisplay,
        quantity: g.quantity,
        baseUnitPrice: avgBase,
        bnplPercent: avgBnplPercent,
        customerUnitPrice: avgCustomer,
        priceIncrease: Math.round(g.totalPriceIncrease * 100) / 100,
        bnplAmount: Math.round(g.totalBnpl * 100) / 100,
        commission: Math.round(g.commission * 100) / 100,
        net: Math.round(g.net * 100) / 100
      };
    });
  }

  const summary: BnplReportSummary = {
    invoicesCount: matchedInvoiceNumbers.size,
    piecesCount: totalPieces,
    totalCustomerPaid: Math.round(totalCustomerPaid * 100) / 100,
    totalPriceIncrease: Math.round(totalPriceIncrease * 100) / 100,
    totalBnplAmount: Math.round(totalBnplAmount * 100) / 100,
    totalBaseAmount: Math.round(totalBaseAmount * 100) / 100,
    totalCommission: Math.round(totalCommission * 100) / 100,
    totalLinesNet: Math.round(totalLinesNet * 100) / 100,
    totalInvoicesNetInCashbox: Math.round(totalInvoicesNetInCashbox * 100) / 100
  };

  return {
    success: true,
    report: {
      summary,
      rows,
      groupBy
    }
  };
}

/**
 * تقرير المنصة المالي والتشغيلي
 */
export async function getPlatformReport(
  params: {
    platformId: string;
    from?: string | null;
    to?: string | null;
    stagnantDays?: number;
  },
  session?: { token?: string; role?: UserRole; permissions?: PermissionKey[] }
): Promise<{ success: boolean; report?: PlatformReport; error?: string }> {
  if (!params.platformId) {
    return { success: false, error: 'يجب تحديد المنصة لعرض التقرير' };
  }

  const config = getSystemConfig();
  const cacheKey = `platformReport:${JSON.stringify(params)}`;
  if (isSheetsDataMode(config)) {
    const res = await callAppsScript('getPlatformReport', params, session?.token);
    if (res.success && res.report) {
      setSheetsCache(cacheKey, res.report);
      return { success: true, report: res.report };
    }
    const cached = getSheetsCache<PlatformReport>(cacheKey);
    if (cached && (!res.error || res.isTransportError || res.isTimeout || res.code === 'SHEETS_UNAVAILABLE' || res.code === 'UNKNOWN_RESULT')) {
      return { success: true, report: cached.data, stale: true, lastSyncAt: cached.lastSyncAt } as any;
    }
    return buildSheetsWriteFailure(res, 'تعذر جلب تقرير المنصة من Google Sheets');
  }

  const platform = memoryPlatforms.find(p => p.id === params.platformId);
  if (!platform) {
    return { success: false, error: 'المنصة المحددة غير موجودة' };
  }

  const fromDate = params.from ? toCairoDateStr(params.from) : null;
  const toDate = params.to ? toCairoDateStr(params.to) : null;
  const stagnantDaysThreshold = Math.max(1, Number(params.stagnantDays) || 30);

  // خريطة الأصناف
  const itemsMap = new Map<string, Item>();
  for (const it of memoryItems) {
    itemsMap.set(it.id, it);
  }

  // خريطة المرتجعات لكل فاتورة
  const returnsByInvoice = new Map<string, ReturnRecord[]>();
  for (const ret of memoryReturns) {
    if (!ret.invoiceNumber) continue;
    const list = returnsByInvoice.get(ret.invoiceNumber) || [];
    list.push(ret);
    returnsByInvoice.set(ret.invoiceNumber, list);
  }

  // 1. الرصيد الآجل المعلق على المنصة (مجموع remainingAmount لجميع فواتير المنصة النشطة غير المسددة بالكامل)
  let pendingDeferredBalance = 0;
  // تاريخ آخر عملية بيع لكل صنف على هذه المنصة (عبر كامل التاريخ)
  const lastSaleDateByItemOnPlatform = new Map<string, string>();

  for (const inv of memoryInvoices) {
    if (inv.platformId !== platform.id || inv.status === 'ملغاة') continue;

    if (Number(inv.remainingAmount || 0) > 0) {
      pendingDeferredBalance += Number(inv.remainingAmount || 0);
    }

    // تتبع آخر بيع للأصناف على المنصة
    for (const l of inv.lines || []) {
      const prevDate = lastSaleDateByItemOnPlatform.get(l.itemId);
      if (!prevDate || new Date(inv.date).getTime() > new Date(prevDate).getTime()) {
        lastSaleDateByItemOnPlatform.set(l.itemId, inv.date);
      }
    }
  }

  // 2. معالجة الفواتير ضمن نطاق التاريخ للتقرير
  let invoicesCount = 0;
  let totalGrossSales = 0;
  let totalPriceIncrease = 0;
  let totalBnplAmount = 0;
  let totalBaseSales = 0;
  let totalCommission = 0;
  let totalPickupFees = 0;
  let totalDeliveryFees = 0;
  let totalNet = 0;
  let totalCost = 0;

  // تجميعات الأصناف الأكثر مبيعاً
  const itemStatsMap = new Map<string, {
    itemId: string;
    itemName: string;
    barcode?: string;
    quantity: number;
    revenue: number;
    profit: number;
  }>();

  // مبيعات يومية
  const dailySalesMap = new Map<string, {
    date: string;
    invoicesCount: number;
    grossSales: number;
    netSales: number;
  }>();

  for (const inv of memoryInvoices) {
    if (inv.platformId !== platform.id || inv.status === 'ملغاة') continue;

    // فلتر التاريخ بتوقيت Cairo
    if (fromDate || toDate) {
      if (!isDateInRange(inv.date, fromDate, toDate)) continue;
    }

    invoicesCount++;

    // إعداد المرتجعات لهذه الفاتورة
    const invReturns = returnsByInvoice.get(inv.invoiceNumber) || [];
    const returnedQtyByItem: Record<string, number> = {};
    for (const r of invReturns) {
      for (const rl of r.lines || []) {
        returnedQtyByItem[rl.itemId] = (returnedQtyByItem[rl.itemId] || 0) + (Number(rl.returnedQuantity) || 0);
      }
    }

    let invGross = 0;
    let invPriceIncrease = 0;
    let invBnpl = 0;
    let invBase = 0;
    let invCost = 0;
    let invCommission = 0;
    let invPickup = 0;

    for (const line of inv.lines || []) {
      const returnedSoFar = returnedQtyByItem[line.itemId] || 0;
      let deductQty = 0;
      if (returnedSoFar > 0) {
        deductQty = Math.min(line.quantity, returnedSoFar);
        returnedQtyByItem[line.itemId] -= deductQty;
      }
      const netQty = line.quantity - deductQty;
      if (netQty <= 0) continue;

      const baseUnitPrice = line.baseUnitPrice !== undefined ? Number(line.baseUnitPrice) : Number(line.salePriceAtSale || 0);
      const customerUnitPrice = line.customerUnitPrice !== undefined ? Number(line.customerUnitPrice) : Number(line.salePriceAtSale || 0);
      const bnplUnitAmount = line.bnplUnitAmount !== undefined ? Number(line.bnplUnitAmount) : Math.max(0, customerUnitPrice - baseUnitPrice);
      const bnplDeductionUnit = line.bnplDeductionUnit !== undefined && line.bnplDeductionUnit !== null
        ? Number(line.bnplDeductionUnit)
        : bnplUnitAmount;

      const lineBase = baseUnitPrice * netQty;
      const lineGross = customerUnitPrice * netQty;
      const linePriceIncrease = bnplUnitAmount * netQty;
      const lineBnpl = bnplDeductionUnit * netQty;

      const itemObj = itemsMap.get(line.itemId);
      const unitPurchase = Number(line.purchasePriceAtSale ?? itemObj?.purchasePrice ?? 0);
      const unitPackaging = Number(line.packagingCostAtSale ?? itemObj?.packagingCost ?? 0);
      const unitCost = unitPurchase + unitPackaging;
      const lineCost = unitCost * netQty;

      // العمولة تُقرأ من السطر المحفوظ ولا يُعاد حسابها
      const unitComm = line.unitDiscountValue !== undefined && line.unitDiscountValue !== null
        ? Number(line.unitDiscountValue)
        : (baseUnitPrice * (Number(line.platformDiscountPercentAtSale ?? platform.discountPercentage ?? 0) / 100));
      const lineCommission = unitComm * netQty;

      const unitPickup = line.unitPickupFee !== undefined ? Number(line.unitPickupFee) : Number(platform.pickupFee || 0);
      const linePickup = unitPickup * netQty;

      invGross += lineGross;
      invPriceIncrease += linePriceIncrease;
      invBnpl += lineBnpl;
      invBase += lineBase;
      invCost += lineCost;
      invCommission += lineCommission;
      invPickup += linePickup;

      // تجميع أداء الصنف
      let stat = itemStatsMap.get(line.itemId);
      if (!stat) {
        stat = {
          itemId: line.itemId,
          itemName: line.itemNameAtSale || itemObj?.name || line.itemId,
          barcode: itemObj?.barcode,
          quantity: 0,
          revenue: 0,
          profit: 0
        };
        itemStatsMap.set(line.itemId, stat);
      }
      stat.quantity += netQty;
      stat.revenue += lineGross;
      stat.profit += (lineGross - lineBnpl - lineCost - lineCommission - linePickup);
    }

    const deliveryFee = Number(inv.deliveryFee || 0);
    const pickupFee = invPickup > 0 || invReturns.length > 0 ? invPickup : Number(inv.pickupFeeAmount || 0);
    const commission = invCommission > 0 || invReturns.length > 0 ? invCommission : Number(inv.discountAmount || 0);

    totalGrossSales += invGross + deliveryFee;
    totalPriceIncrease += invPriceIncrease;
    totalBnplAmount += invBnpl;
    totalBaseSales += invBase;
    totalCommission += commission;
    totalPickupFees += pickupFee;
    totalDeliveryFees += deliveryFee;
    totalCost += invCost;

    // صافي الفاتورة = المبيعات بسعر العميل + رسوم التوصيل - استقطاع BNPL - العمولات - رسوم الالتقاط
    const invNet = Math.max(0, invGross - invBnpl + deliveryFee - commission - pickupFee);
    totalNet += invNet;

    // مبيعات يومية
    const dayStr = toCairoDateStr(inv.date);
    let dayStat = dailySalesMap.get(dayStr);
    if (!dayStat) {
      dayStat = {
        date: dayStr,
        invoicesCount: 0,
        grossSales: 0,
        netSales: 0
      };
      dailySalesMap.set(dayStr, dayStat);
    }
    dayStat.invoicesCount += 1;
    dayStat.grossSales += invGross + deliveryFee;
    dayStat.netSales += invNet;
  }

  // الربح التقديري = صافي المبيعات بعد استقطاع BNPL والعمولات والالتقاط - تكلفة البضاعة المباعة
  const estimatedProfit = Math.round((totalGrossSales - totalBnplAmount - totalCost - totalCommission - totalPickupFees) * 100) / 100;
  const profitMargin = totalBaseSales > 0 ? Math.round((estimatedProfit / totalBaseSales) * 10000) / 100 : 0;
  const averageInvoiceValue = invoicesCount > 0 ? Math.round((totalGrossSales / invoicesCount) * 100) / 100 : 0;

  // أعلى 10 أصناف بالكمية وبالإيراد
  const allItemStats = Array.from(itemStatsMap.values());
  const topByQuantity = [...allItemStats]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)
    .map(i => ({
      ...i,
      revenue: Math.round(i.revenue * 100) / 100,
      profit: Math.round(i.profit * 100) / 100
    }));

  const topByRevenue = [...allItemStats]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map(i => ({
      ...i,
      revenue: Math.round(i.revenue * 100) / 100,
      profit: Math.round(i.profit * 100) / 100
    }));

  // 3. الأصناف الراكدة: المتاحة لهذه المنصة ومخزونها > 0 ولم تُبع عليها خلال آخر N يوم
  const nowMs = Date.now();
  const stagnantItems: PlatformReportStagnantItem[] = [];

  for (const item of memoryItems) {
    if (Number(item.stockQuantity || 0) <= 0) continue;

    // فحص ما إذا كان الصنف متاحاً لهذه المنصة
    const isAvailableOnPlatform = !item.platformIds || item.platformIds.length === 0 || item.platformIds.includes(platform.id);
    if (!isAvailableOnPlatform) continue;

    const lastSale = lastSaleDateByItemOnPlatform.get(item.id) || null;
    let daysSince: number | null = null;
    if (lastSale) {
      daysSince = Math.floor((nowMs - new Date(lastSale).getTime()) / (1000 * 60 * 60 * 24));
    }

    if (lastSale === null || (daysSince !== null && daysSince >= stagnantDaysThreshold)) {
      stagnantItems.push({
        itemId: item.id,
        itemName: item.name,
        barcode: item.barcode,
        stockQuantity: item.stockQuantity,
        salePrice: item.salePrice,
        lastSaleDate: lastSale,
        daysSinceLastSale: daysSince
      });
    }
  }

  // ترتيب الأصناف الراكدة: التي لم تبع قط أولاً، ثم الأكثر ركوداً
  stagnantItems.sort((a, b) => {
    if (a.daysSinceLastSale === null && b.daysSinceLastSale !== null) return -1;
    if (a.daysSinceLastSale !== null && b.daysSinceLastSale === null) return 1;
    if (a.daysSinceLastSale !== null && b.daysSinceLastSale !== null) {
      return b.daysSinceLastSale - a.daysSinceLastSale;
    }
    return b.stockQuantity - a.stockQuantity;
  });

  // المبيعات اليومية مرتبة تصاعدياً حسب التاريخ
  const dailySales = Array.from(dailySalesMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const summary: PlatformReportSummary = {
    platformId: platform.id,
    platformName: platform.name,
    invoicesCount,
    totalGrossSales: Math.round(totalGrossSales * 100) / 100,
    totalPriceIncrease: Math.round(totalPriceIncrease * 100) / 100,
    totalBnplAmount: Math.round(totalBnplAmount * 100) / 100,
    totalBaseSales: Math.round(totalBaseSales * 100) / 100,
    totalCommission: Math.round(totalCommission * 100) / 100,
    totalPickupFees: Math.round(totalPickupFees * 100) / 100,
    totalDeliveryFees: Math.round(totalDeliveryFees * 100) / 100,
    totalNet: Math.round(totalNet * 100) / 100,
    estimatedProfit,
    profitMargin,
    averageInvoiceValue,
    pendingDeferredBalance: Math.round(pendingDeferredBalance * 100) / 100
  };

  return {
    success: true,
    report: {
      summary,
      topByQuantity,
      topByRevenue,
      stagnantItems,
      stagnantDays: stagnantDaysThreshold,
      dailySales,
      dateRange: { from: fromDate, to: toDate }
    }
  };
}

/**
 * حساب مبلغ الاستحقاق الرسمي للفاتورة الآجلة حسب نوع الطرف:
 * للعميل = إجمالي الفاتورة (totalBeforeDiscount + deliveryFee)
 * للمنصة = الصافي (netAmount)
 */
export function calculateInvoiceCreditDueAmount(inv: Invoice, partyType: 'customer' | 'platform'): number {
  if (partyType === 'customer') {
    const gross = (Number(inv.totalBeforeDiscount) || 0) + (Number(inv.deliveryFee) || 0);
    return Math.round(gross * 100) / 100;
  }
  return Math.round((Number(inv.netAmount) || 0) * 100) / 100;
}

/**
 * التحقق مما إذا كانت الفاتورة تخص الطرف المحدد
 */
export function doesInvoiceBelongToParty(inv: Invoice, partyType: 'customer' | 'platform', partyId: string): boolean {
  const invPartyType: 'customer' | 'platform' | 'delivery' = inv.creditPartyType
    ? inv.creditPartyType
    : (inv.customerId ? 'customer' : 'platform');

  if (invPartyType !== partyType) return false;

  if (partyType === 'customer') {
    const targetCustId = inv.creditPartyId || inv.customerId;
    return targetCustId === partyId;
  } else {
    const targetPltId = inv.creditPartyId || inv.platformId;
    return targetPltId === partyId;
  }
}

/**
 * جلب سجل حساب الطرف (عميل أو منصة) بحركاته + الفواتير الآجلة المعلّقة
 */
export async function getPartyLedger(
  params: {
    partyType: 'customer' | 'platform';
    partyId: string;
    from?: string | null;
    to?: string | null;
  },
  session?: { token?: string; role?: UserRole; permissions?: PermissionKey[] }
): Promise<{
  success: boolean;
  partyType?: 'customer' | 'platform';
  partyId?: string;
  partyName?: string;
  ledger: PartyLedgerEntry[];
  pendingInvoices: Invoice[];
  currentBalance: number;
  openingBalanceForPeriod: number;
  error?: string;
}> {
  const config = getSystemConfig();
  const cacheKey = `partyLedger:${JSON.stringify(params)}`;
  if (isSheetsDataMode(config)) {
    const res: any = await callAppsScript('getPartyLedger', params, session?.token);
    if (res.success) {
      setSheetsCache(cacheKey, res);
      return res;
    }
    const cached = getSheetsCache<any>(cacheKey);
    if (cached && (!res.error || res.isTransportError || res.isTimeout || res.code === 'SHEETS_UNAVAILABLE' || res.code === 'UNKNOWN_RESULT')) {
      return {
        ...cached.data,
        stale: true,
        lastSyncAt: cached.lastSyncAt
      };
    }
    return {
      ...buildSheetsWriteFailure(res, 'تعذر جلب كشف حساب الطرف من Google Sheets'),
      ledger: [],
      pendingInvoices: [],
      currentBalance: 0,
      openingBalanceForPeriod: 0
    };
  }

  const { partyType, partyId } = params;
  if (partyType !== 'customer' && partyType !== 'platform') {
    return { success: false, ledger: [], pendingInvoices: [], currentBalance: 0, openingBalanceForPeriod: 0, error: 'نوع الطرف غير صالح' };
  }

  let partyName = '';
  let baseOpening = 0;

  if (partyType === 'customer') {
    const cust = memoryCustomers.find(c => c.id === partyId);
    if (!cust) {
      return { success: false, ledger: [], pendingInvoices: [], currentBalance: 0, openingBalanceForPeriod: 0, error: 'العميل المحدد غير موجود' };
    }
    partyName = cust.name;
    const custEntries = memoryCustomerLedger.filter(l => l.customerId === partyId);
    const hasOpening = custEntries.some(l => l.transactionType === 'رصيد افتتاحي');
    baseOpening = hasOpening ? 0 : (Number(cust.openingBalance) || 0);
  } else {
    const plt = memoryPlatforms.find(p => p.id === partyId);
    if (!plt) {
      return { success: false, ledger: [], pendingInvoices: [], currentBalance: 0, openingBalanceForPeriod: 0, error: 'المنصة المحددة غير موجودة' };
    }
    partyName = plt.name;
    baseOpening = 0;
  }

  // استخراج جميع حركات الطرف مرتبة زمنياً
  let allMovements: PartyLedgerEntry[] = [];
  if (partyType === 'customer') {
    allMovements = memoryCustomerLedger
      .filter(l => l.customerId === partyId)
      .map(l => {
        const matchingPartyEntry = memoryPartyLedger.find(
          p => p.partyType === 'customer' && p.partyId === partyId && (p.id === l.id || p.documentNumber === l.documentNumber)
        );
        return {
          id: l.id,
          date: l.date,
          partyType: 'customer' as const,
          partyId: l.customerId,
          partyName: l.customerName || partyName,
          transactionType: l.transactionType,
          documentNumber: l.documentNumber,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          balanceAfter: Number(l.balanceAfter) || 0,
          statement: l.statement,
          userName: l.userName,
          notes: l.notes,
          needsReview: (l as any).needsReview ?? matchingPartyEntry?.needsReview,
          reviewReasons: (l as any).reviewReasons ?? matchingPartyEntry?.reviewReasons
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  } else {
    allMovements = memoryPartyLedger
      .filter(l => l.partyType === 'platform' && l.partyId === partyId)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  // إعادة حساب الرصيد التراكمي من مجموع الحركات
  let runningTotal = baseOpening;
  const normalizedAll = allMovements.map(m => {
    runningTotal = Math.round((runningTotal + (Number(m.debit) || 0) - (Number(m.credit) || 0)) * 100) / 100;
    return { ...m, balanceAfter: runningTotal };
  });

  const currentBalance = computePartyBalance(partyType, partyId);

  const fromDate = params.from ? toCairoDateStr(params.from) : null;
  const toDate = params.to ? toCairoDateStr(params.to) : null;

  let openingBalanceForPeriod = baseOpening;
  if (fromDate) {
    for (const m of normalizedAll) {
      const dStr = toCairoDateStr(m.date);
      if (dStr && dStr < fromDate) {
        openingBalanceForPeriod = Math.round((openingBalanceForPeriod + (Number(m.debit) || 0) - (Number(m.credit) || 0)) * 100) / 100;
      }
    }
  }

  const filteredLedger = (!fromDate && !toDate)
    ? normalizedAll
    : normalizedAll.filter(m => isDateInRange(m.date, fromDate, toDate));

  // استخراج الفواتير الآجلة المعلّقة التي تخص هذا الطرف
  const pendingInvoices = memoryInvoices
    .filter(inv => {
      if (inv.status === 'ملغاة' || inv.status === 'مسددة' || inv.creditStatus === 'مسددة') return false;
      if (inv.paymentType !== 'آجل') return false;
      const isPending = inv.status === 'معلّقة' || inv.creditStatus === 'معلّقة' || (Number(inv.remainingAmount || 0) > 0);
      if (!isPending) return false;
      if (!doesInvoiceBelongToParty(inv, partyType, partyId)) return false;
      if (fromDate || toDate) {
        if (!isDateInRange(inv.date, fromDate, toDate)) return false;
      }
      return true;
    })
    .map(inv => {
      const due = calculateInvoiceCreditDueAmount(inv, partyType);
      return {
        ...inv,
        creditPartyType: partyType,
        creditPartyId: partyId,
        creditPartyName: partyName,
        creditDueAmount: due,
        remainingAmount: due,
        status: 'معلّقة' as const,
        creditStatus: 'معلّقة' as const
      };
    });

  return {
    success: true,
    partyType,
    partyId,
    partyName,
    ledger: filteredLedger,
    pendingInvoices,
    currentBalance,
    openingBalanceForPeriod
  };
}

/**
 * تحصيل الفواتير الآجلة لعميل أو منصة مع التحقق الأمني الصارم وتسجيل فروق التحصيل
 */
export async function collectCreditInvoices(
  payload: CollectCreditPayload,
  session?: { token?: string; role?: UserRole; permissions?: PermissionKey[]; phone?: string; name?: string; userId?: string }
): Promise<CollectCreditResult & { duplicate?: boolean; code?: string }> {
  // 1. إلزام مفتاح Idempotency قبل لمس أي بيانات
  const idemKey = getValidatedIdempotencyKey(payload?.idempotencyKey);
  if (!idemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR };
  }

  const cached = getIdempotencyCachedResult('collectCreditInvoices', idemKey);
  if (cached) {
    return { ...cached, duplicate: true };
  }

  const config = getSystemConfig();
  if (isSheetsDataMode(config)) {
    const res: any = await callAppsScript('collectCreditInvoices', { ...payload, idempotencyKey: idemKey }, session?.token);
    if (res.success) {
      setIdempotencyCachedResult('collectCreditInvoices', idemKey, res);
      return { ...res, ...(res.duplicate ? { duplicate: true } : {}) };
    }
    const failure = buildSheetsWriteFailure(res, 'فشل تحصيل الفواتير الآجلة في Google Sheets');
    return {
      success: false,
      statusCode: res.isTimeout ? 504 : (res.isTransportError ? 503 : (res.statusCode || 400)),
      requiresConfirmation: res.requiresConfirmation,
      totalDue: res.totalDue,
      receivedAmount: res.receivedAmount,
      difference: res.difference,
      ...(failure.code ? { code: failure.code } : {}),
      error: failure.error
    };
  }

  const persistedMemoryCollection = memoryCreditCollectionByKey.get(idemKey);
  if (persistedMemoryCollection) {
    setIdempotencyCachedResult('collectCreditInvoices', idemKey, persistedMemoryCollection);
    return { ...persistedMemoryCollection, duplicate: true };
  }

  const { partyType, partyId, invoiceNumbers } = payload;

  if (partyType !== 'customer' && partyType !== 'platform') {
    return { success: false, statusCode: 400, error: 'يجب تحديد نوع الطرف (عميل أو منصة)' };
  }

  if (!partyId) {
    return { success: false, statusCode: 400, error: 'يجب تحديد الطرف المراد التحصيل منه' };
  }

  let partyName = '';
  if (partyType === 'customer') {
    const cust = memoryCustomers.find(c => c.id === partyId);
    if (!cust) {
      return { success: false, statusCode: 400, error: 'العميل المحدد غير مسجل بالنظام' };
    }
    partyName = cust.name;
  } else {
    const plt = memoryPlatforms.find(p => p.id === partyId);
    if (!plt) {
      return { success: false, statusCode: 400, error: 'المنصة المحددة غير مسجلة بالنظام' };
    }
    partyName = plt.name;
  }

  if (!Array.isArray(invoiceNumbers) || invoiceNumbers.length === 0) {
    return { success: false, statusCode: 400, error: 'يجب اختيار فاتورة معلّقة واحدة على الأقل للتحصيل' };
  }

  // منع تكرار نفس رقم الفاتورة داخل نفس الطلب
  const uniqueNums = new Set(invoiceNumbers.map(n => String(n).trim()).filter(Boolean));
  if (uniqueNums.size !== invoiceNumbers.length) {
    return { success: false, statusCode: 400, error: 'توجد أرقام فواتير مكررة في طلب التحصيل' };
  }

  const isOfflineMode = Boolean(payload.isOfflineSync || payload.isOffline);

  // 2. التحقق من الفواتير وإعادة حساب المستحق على الخادم (عدم الوثوق بما ترسله الواجهة)
  const targetInvoices: { inv: Invoice; dueAmount: number }[] = [];
  const duplicateInvoices: { inv: Invoice; dueAmount: number }[] = [];
  let calculatedTotalDue = 0;
  let pendingTotalDue = 0;

  for (const invNum of uniqueNums) {
    const inv = memoryInvoices.find(
      i => i.invoiceNumber === invNum || (i.offlineProvisionalNo && i.offlineProvisionalNo === invNum)
    );
    if (!inv) {
      return { success: false, statusCode: 400, error: `الفاتورة رقم ${invNum} غير موجودة` };
    }

    // التحقق أن الفاتورة تخص الطرف المختار
    if (!doesInvoiceBelongToParty(inv, partyType, partyId)) {
      return {
        success: false,
        statusCode: 400,
        error: `الفاتورة رقم ${inv.invoiceNumber} لا تخص ${partyType === 'customer' ? 'العميل' : 'المنصة'} "${partyName}"`
      };
    }

    if (inv.status === 'ملغاة') {
      return {
        success: false,
        statusCode: 400,
        error: `الفاتورة رقم ${inv.invoiceNumber} ملغاة ولا يمكن تحصيلها`
      };
    }

    if (inv.paymentType !== 'آجل') {
      return {
        success: false,
        statusCode: 400,
        error: `الفاتورة رقم ${inv.invoiceNumber} ليست فاتورة آجلة معلّقة`
      };
    }

    const invDue = calculateInvoiceCreditDueAmount(inv, partyType);
    calculatedTotalDue += invDue;

    // فحص ما إذا كانت الفاتورة مسددة بالفعل
    if (inv.status === 'مسددة' || inv.creditStatus === 'مسددة') {
      if (!isOfflineMode) {
        return {
          success: false,
          statusCode: 400,
          error: `الفاتورة رقم ${inv.invoiceNumber} مسددة بالفعل ولا يمكن تحصيلها مرة أخرى`
        };
      }
      duplicateInvoices.push({ inv, dueAmount: invDue });
      continue;
    }

    const isPendingCredit =
      inv.paymentType === 'آجل' &&
      (inv.status === 'معلّقة' || inv.creditStatus === 'معلّقة' || Number(inv.remainingAmount || 0) > 0);

    if (!isPendingCredit) {
      return {
        success: false,
        statusCode: 400,
        error: `الفاتورة رقم ${inv.invoiceNumber} ليست فاتورة آجلة معلّقة`
      };
    }

    pendingTotalDue += invDue;
    targetInvoices.push({ inv, dueAmount: invDue });
  }

  const hasDuplicateCollection = duplicateInvoices.length > 0;
  const totalDue = Math.round(calculatedTotalDue * 100) / 100;
  pendingTotalDue = Math.round(pendingTotalDue * 100) / 100;

  const rawReceived = Number(payload.receivedAmount);
  if (payload.receivedAmount === undefined || payload.receivedAmount === null || isNaN(rawReceived) || rawReceived < 0) {
    return { success: false, statusCode: 400, error: 'المبلغ المستلم يجب أن يكون رقماً صالحاً أكبر من أو يساوي صفر' };
  }
  const receivedAmount = Math.round(rawReceived * 100) / 100;

  // 3. حساب الفرق والتحقق من confirmDifference
  const difference = Math.round((receivedAmount - totalDue) * 100) / 100;
  const hasDifference = Math.abs(difference) >= 0.01;

  if (!hasDuplicateCollection && !isOfflineMode && hasDifference && payload.confirmDifference !== true) {
    const absDiff = Math.abs(difference);
    const msg = difference < 0
      ? `المبلغ أقل من المستحق بمقدار ${absDiff}، وسيُرحَّل الفرق على ${partyName}`
      : `المبلغ أعلى من المستحق بمقدار ${absDiff}، وسيُسجَّل كرصيد دائن لـ ${partyName}`;
    return {
      success: false,
      statusCode: 400,
      requiresConfirmation: true,
      totalDue,
      receivedAmount,
      difference,
      error: msg
    };
  }

  // 4. التحقق من الخزنة
  if (!payload.cashboxId) {
    return { success: false, statusCode: 400, error: 'يرجى اختيار الخزينة لإيداع المبلغ المستلم' };
  }

  if (!isOfflineMode && session?.role && session.role !== 'designer') {
    const callerUser = memoryUsers.find(u => u.phone === session.phone || u.id === session.userId);
    if (callerUser?.cashboxConfig) {
      const allowedIds = callerUser.cashboxConfig.allowedReceiptCashboxIds || callerUser.cashboxConfig.allowedSaleCashboxIds;
      if (allowedIds && allowedIds.length > 0 && !allowedIds.includes(payload.cashboxId)) {
        return { success: false, statusCode: 400, error: 'غير مصرح: الخزينة المحددة غير مخصصة لك لعمليات التحصيل' };
      }
    }
  }

  const cashbox =
    memoryCashboxes.find(c => c.id === payload.cashboxId) ||
    (isOfflineMode ? memoryCashboxes[0] : undefined);
  if (!cashbox) {
    return { success: false, statusCode: 400, error: 'الخزينة المحددة غير موجودة بالنظام' };
  }

  // 5. تحديث حالة الفواتير المعلقة إلى «مسددة»، وتعليم الفواتير المكررة بـ needsReview وسبب «تحصيل مكرر»
  const now = new Date();
  const isoNow = now.toISOString();
  const dateStr = isoNow.slice(0, 10).replace(/-/g, '');
  const collectionDocNumber = `COL-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;
  const userActor = session?.name || session?.phone || 'المسؤول';
  const settledInvoiceNumbers: string[] = [];
  const duplicateInvoiceNumbers: string[] = [];

  for (const item of targetInvoices) {
    item.inv.status = 'مسددة';
    item.inv.creditStatus = 'مسددة';
    item.inv.paidAmount = item.dueAmount;
    item.inv.remainingAmount = 0;
    item.inv.offlineCollectionPending = false;
    settledInvoiceNumbers.push(item.inv.invoiceNumber);
  }

  for (const dupItem of duplicateInvoices) {
    dupItem.inv.needsReview = true;
    const prevReasons = Array.isArray(dupItem.inv.reviewReasons) ? dupItem.inv.reviewReasons : [];
    if (!prevReasons.includes('تحصيل مكرر')) {
      dupItem.inv.reviewReasons = [...prevReasons, 'تحصيل مكرر'];
    }
    dupItem.inv.offlineCollectionPending = false;
    duplicateInvoiceNumbers.push(dupItem.inv.invoiceNumber);
  }

  const allInvolvedInvoiceNumbers = [...settledInvoiceNumbers, ...duplicateInvoiceNumbers];

  // 6. إيداع المبلغ المستلم فقط في الخزنة
  if (receivedAmount > 0) {
    cashbox.currentBalance = Math.round((cashbox.currentBalance + receivedAmount) * 100) / 100;

    memoryCashboxTransactions.push({
      id: generateUUID(),
      date: isoNow,
      cashboxId: cashbox.id,
      cashboxName: cashbox.name,
      type: 'تحصيل آجل',
      documentNumber: collectionDocNumber,
      amount: receivedAmount,
      balanceAfter: cashbox.currentBalance,
      party: partyName,
      statement: `تحصيل آجل من ${partyName} للفواتير: ${allInvolvedInvoiceNumbers.join('، ')}${
        hasDuplicateCollection ? ' (يحتاج مراجعة: تحصيل مكرر)' : ''
      }`,
      userName: userActor,
      notes: payload.notes || ''
    });

    memoryCashboxEntries.push({
      id: generateUUID(),
      date: isoNow,
      documentNumber: collectionDocNumber,
      entryType: 'تحصيل آجل',
      cashboxName: cashbox.name,
      amount: receivedAmount,
      platform: partyType === 'platform' ? partyName : 'تحصيل عملاء',
      notes: `تحصيل فواتير آجل (${allInvolvedInvoiceNumbers.join('، ')})${
        hasDuplicateCollection ? ' - تحصيل مكرر' : ''
      }`,
      userName: userActor
    });
  }

  // 7. تسجيل حركات سجل الطرف
  const createdEntries: PartyLedgerEntry[] = [];
  const balBefore = computePartyBalance(partyType, partyId);

  if (!hasDuplicateCollection) {
    const balAfterCollection = Math.round((balBefore - totalDue) * 100) / 100;

    const collectionEntryId = generateUUID();
    const collectionStatement = `تحصيل فواتير آجل (${settledInvoiceNumbers.join('، ')}) - المستلم بالخزنة: ${receivedAmount} ج.م`;

    const collectionPartyEntry: PartyLedgerEntry = {
      id: collectionEntryId,
      date: isoNow,
      partyType,
      partyId,
      partyName,
      transactionType: 'تحصيل',
      documentNumber: collectionDocNumber,
      debit: 0,
      credit: totalDue,
      balanceAfter: balAfterCollection,
      statement: collectionStatement,
      userName: userActor,
      notes: payload.notes || ''
    };
    memoryPartyLedger.push(collectionPartyEntry);
    createdEntries.push(collectionPartyEntry);

    if (partyType === 'customer') {
      memoryCustomerLedger.push({
        id: collectionEntryId,
        date: isoNow,
        customerId: partyId,
        customerName: partyName,
        transactionType: 'تحصيل',
        documentNumber: collectionDocNumber,
        debit: 0,
        credit: totalDue,
        balanceAfter: balAfterCollection,
        statement: collectionStatement,
        userName: userActor,
        notes: payload.notes || ''
      });
    }

    if (hasDifference) {
      const diffEntryId = generateUUID();
      const isUnderpayment = difference < 0;
      const absDiff = Math.round(Math.abs(difference) * 100) / 100;
      const diffDebit = isUnderpayment ? absDiff : 0;
      const diffCredit = isUnderpayment ? 0 : absDiff;
      const balAfterDiff = Math.round((balAfterCollection + diffDebit - diffCredit) * 100) / 100;
      const diffStatement = isUnderpayment
        ? `فرق تحصيل أقل من المستحق بمقدار ${absDiff} ج.م مرحّل على ${partyName} (للفواتير: ${settledInvoiceNumbers.join('، ')})`
        : `فرق تحصيل أعلى من المستحق بمقدار ${absDiff} ج.م كرصيد دائن لـ ${partyName} (للفواتير: ${settledInvoiceNumbers.join('، ')})`;

      const diffPartyEntry: PartyLedgerEntry = {
        id: diffEntryId,
        date: isoNow,
        partyType,
        partyId,
        partyName,
        transactionType: 'فرق تحصيل',
        documentNumber: collectionDocNumber,
        debit: diffDebit,
        credit: diffCredit,
        balanceAfter: balAfterDiff,
        statement: diffStatement,
        userName: userActor,
        notes: payload.notes || ''
      };
      memoryPartyLedger.push(diffPartyEntry);
      createdEntries.push(diffPartyEntry);

      if (partyType === 'customer') {
        memoryCustomerLedger.push({
          id: diffEntryId,
          date: isoNow,
          customerId: partyId,
          customerName: partyName,
          transactionType: 'فرق تحصيل',
          documentNumber: collectionDocNumber,
          debit: diffDebit,
          credit: diffCredit,
          balanceAfter: balAfterDiff,
          statement: diffStatement,
          userName: userActor,
          notes: payload.notes || ''
        });
      }
    }
  } else {
    // حالة وجود فاتورة أو أكثر حُصّلت من جهاز آخر:
    let runningBalance = balBefore;

    // أ) إذا كان ضمن الدفعة فواتير ما زالت معلقة، نحصّلها أولاً
    if (settledInvoiceNumbers.length > 0 && pendingTotalDue > 0) {
      runningBalance = Math.round((runningBalance - pendingTotalDue) * 100) / 100;
      const pendingEntryId = generateUUID();
      const pendingStmt = `تحصيل فواتير آجل (${settledInvoiceNumbers.join('، ')}) - المستحق: ${pendingTotalDue} ج.م`;

      const pendingPartyEntry: PartyLedgerEntry = {
        id: pendingEntryId,
        date: isoNow,
        partyType,
        partyId,
        partyName,
        transactionType: 'تحصيل',
        documentNumber: collectionDocNumber,
        debit: 0,
        credit: pendingTotalDue,
        balanceAfter: runningBalance,
        statement: pendingStmt,
        userName: userActor,
        notes: payload.notes || ''
      };
      memoryPartyLedger.push(pendingPartyEntry);
      createdEntries.push(pendingPartyEntry);

      if (partyType === 'customer') {
        memoryCustomerLedger.push({
          id: pendingEntryId,
          date: isoNow,
          customerId: partyId,
          customerName: partyName,
          transactionType: 'تحصيل',
          documentNumber: collectionDocNumber,
          debit: 0,
          credit: pendingTotalDue,
          balanceAfter: runningBalance,
          statement: pendingStmt,
          userName: userActor,
          notes: payload.notes || ''
        });
      }
    }

    // ب) تسجيل المبلغ المتبقي كرصيد دائن للطرف مع needsReview وسبب «تحصيل مكرر»
    const dupCreditAmount = Math.max(0, Math.round((receivedAmount - pendingTotalDue) * 100) / 100);
    runningBalance = Math.round((runningBalance - dupCreditAmount) * 100) / 100;
    const dupEntryId = generateUUID();
    const dupStatement = `رصيد دائن لـ ${partyName} نتيجة تحصيل مكرر للفواتير (${duplicateInvoiceNumbers.join('، ')}) - يحتاج مراجعة: تحصيل مكرر`;

    const dupPartyEntry: PartyLedgerEntry = {
      id: dupEntryId,
      date: isoNow,
      partyType,
      partyId,
      partyName,
      transactionType: 'تحصيل مكرر',
      documentNumber: collectionDocNumber,
      debit: 0,
      credit: dupCreditAmount,
      balanceAfter: runningBalance,
      statement: dupStatement,
      userName: userActor,
      notes: (payload.notes ? `${payload.notes} | ` : '') + 'تحصيل مكرر',
      needsReview: true,
      reviewReasons: ['تحصيل مكرر']
    };
    memoryPartyLedger.push(dupPartyEntry);
    createdEntries.push(dupPartyEntry);

    if (partyType === 'customer') {
      memoryCustomerLedger.push({
        id: dupEntryId,
        date: isoNow,
        customerId: partyId,
        customerName: partyName,
        transactionType: 'تحصيل مكرر',
        documentNumber: collectionDocNumber,
        debit: 0,
        credit: dupCreditAmount,
        balanceAfter: runningBalance,
        statement: dupStatement,
        userName: userActor,
        notes: (payload.notes ? `${payload.notes} | ` : '') + 'تحصيل مكرر'
      });
    }
  }

  const finalPartyBalance = computePartyBalance(partyType, partyId);

  // 8. التوثيق في سجل التدقيق Audit Log
  recordAuditLog(
    session || {},
    isOfflineMode ? 'OFFLINE_CREDIT_COLLECTION_SYNC' : 'CREDIT_COLLECTION',
    partyType === 'customer' ? 'Customer' : 'Platform',
    partyId,
    `تحصيل آجل (${collectionDocNumber}) للطرف "${partyName}" للفواتير [${allInvolvedInvoiceNumbers.join(', ')}] - المستحق: ${totalDue} ج.م، المستلم: ${receivedAmount} ج.م، الفرق: ${difference} ج.م، الرصيد بعد الحركة: ${finalPartyBalance} ج.م${
      hasDuplicateCollection ? ` | تحصيل مكرر يحتاج مراجعة (${duplicateInvoiceNumbers.join(', ')})` : ''
    }`
  );

  const result: CollectCreditResult = {
    success: true,
    collectionId: collectionDocNumber,
    totalDue,
    receivedAmount,
    difference,
    partyBalance: finalPartyBalance,
    settledInvoices: settledInvoiceNumbers,
    duplicateCollectionInvoices: duplicateInvoiceNumbers,
    needsReview: hasDuplicateCollection,
    reviewReasons: hasDuplicateCollection ? ['تحصيل مكرر'] : [],
    ledgerEntriesCreated: createdEntries
  };

  memoryCreditCollectionByKey.set(idemKey, result);
  setIdempotencyCachedResult('collectCreditInvoices', idemKey, result);

  return result;
}

// ===========================================================================
// سجل الحفظ الدائم (Supabase): كل حالة الذاكرة التي يجب أن تبقى بعد إعادة التشغيل
// أي متغير memory جديد يُضاف للملف يجب تسجيله هنا (يوجد اختبار آلي يتحقق من ذلك).
// ===========================================================================
import type { CollectionDef } from './persistence/statePersistence.ts';

export function getPersistenceCollections(): CollectionDef[] {
  const byId = (d: any) => d?.id ?? d?.invoiceNumber ?? d?.returnNumber ?? d?.purchaseNumber;
  const list = (name: string, get: () => any[], set: (v: any[]) => void, idOf: (d: any) => any = byId, appendOnly = false): CollectionDef =>
    ({ name, kind: 'list', get, set, idOf, appendOnly });
  const single = (name: string, get: () => any, set: (v: any) => void): CollectionDef =>
    ({ name, kind: 'single', get, set });

  return [
    list('platforms', () => memoryPlatforms, v => { memoryPlatforms = v; }),
    list('categories', () => memoryCategories, v => { memoryCategories = v; }),
    list('items', () => memoryItems, v => { memoryItems = v; }),
    list('itemBarcodes', () => memoryItemBarcodes, v => { memoryItemBarcodes = v; }, d => d?.id || `${d?.itemId}|${d?.barcode}`),
    list('itemPlatformCosts', () => memoryCosts, v => { memoryCosts = v; }, d => `${d?.itemId}|${d?.platformId}`),
    list('invoices', () => memoryInvoices, v => { memoryInvoices = v; }),
    list('returns', () => memoryReturns, v => { memoryReturns = v; }),
    list('users', () => memoryUsers, v => { memoryUsers = v; }),
    list('auditLogs', () => memoryAuditLogs, v => { memoryAuditLogs = v; }),
    list('invoiceEditLogs', () => memoryInvoiceEditLogs, v => { memoryInvoiceEditLogs = v; }),
    list('stockMovements', () => memoryStockMovements, v => { memoryStockMovements = v; }),
    list('cashboxEntries', () => memoryCashboxEntries, v => { memoryCashboxEntries = v; }),
    list('itemChangeLogs', () => memoryItemChangeLogs, v => { memoryItemChangeLogs = v; }),
    list('importBatches', () => memoryImportBatches, v => { memoryImportBatches = v; }),
    list('suppliers', () => memorySuppliers, v => { memorySuppliers = v; }),
    list('supplierGroups', () => memorySupplierGroups, v => { memorySupplierGroups = v; }),
    list('purchases', () => memoryPurchases, v => { memoryPurchases = v; }),
    list('purchaseReturns', () => memoryPurchaseReturns, v => { memoryPurchaseReturns = v; }),
    list('supplierLedger', () => memorySupplierLedger, v => { memorySupplierLedger = v; }),
    list('customers', () => memoryCustomers, v => { memoryCustomers = v; }),
    list('customerGroups', () => memoryCustomerGroups, v => { memoryCustomerGroups = v; }),
    list('customerLedger', () => memoryCustomerLedger, v => { memoryCustomerLedger = v; }),
    list('partyLedger', () => memoryPartyLedger, v => { memoryPartyLedger = v; }),
    list('cashboxes', () => memoryCashboxes, v => { memoryCashboxes = v; }),
    list('cashboxTransactions', () => memoryCashboxTransactions, v => { memoryCashboxTransactions = v; }),
    list('cashboxTransfers', () => memoryCashboxTransfers, v => { memoryCashboxTransfers = v; }),
    list('userCashboxAssignments', () => memoryUserCashboxAssignments, v => { memoryUserCashboxAssignments = v; }),
    list('warehouses', () => memoryWarehouses, v => { memoryWarehouses = v; }),
    list('warehouseStocks', () => memoryWarehouseStocks, v => { memoryWarehouseStocks = v; }, d => `${d?.itemId}|${d?.warehouseId}`),
    list('warehouseTransfers', () => memoryWarehouseTransfers, v => { memoryWarehouseTransfers = v; }),
    list(
      'creditCollectionsByKey',
      () => Array.from(memoryCreditCollectionByKey, ([key, result]) => ({ key, result })),
      v => { memoryCreditCollectionByKey.clear(); for (const e of v) memoryCreditCollectionByKey.set(e.key, e.result); },
      d => d?.key
    ),
    list(
      'idempotencyCache',
      () => Array.from(idempotencyCache, ([key, entry]) => ({ key, ...entry })).filter(e => Date.now() - e.timestamp < 5 * 60 * 1000),
      v => { idempotencyCache.clear(); for (const e of v) idempotencyCache.set(e.key, { timestamp: e.timestamp, result: e.result }); },
      d => d?.key
    ),
    single('settings.company', () => memoryCompanySettings, v => { memoryCompanySettings = v; }),
    single('settings.invoicePrint', () => memoryInvoicePrintSettings, v => { memoryInvoicePrintSettings = v; }),
    single('settings.display', () => memoryDisplaySettings, v => { memoryDisplaySettings = v; }),
    single('settings.stock', () => memoryStockSettings, v => { memoryStockSettings = v; }),
    single(
      'state.warehouse',
      () => ({ warehouseDispatchSeq, warehouseMigrationCompleted, warehouseMigrationReport }),
      v => {
        warehouseDispatchSeq = Number(v?.warehouseDispatchSeq) || 0;
        warehouseMigrationCompleted = Boolean(v?.warehouseMigrationCompleted);
        if (v?.warehouseMigrationReport) warehouseMigrationReport = v.warehouseMigrationReport;
      }
    ),
    single('state.bulkEditUndo', () => lastBulkEditUndoRecord, v => { lastBulkEditUndoRecord = v ?? null; }),
    single('state.config', () => exportPersistedConfig(), v => importPersistedConfig(v))
  ];
}

/**
 * الحالة الابتدائية النظيفة لقاعدة بيانات جديدة: بدون أي بيانات تجريبية.
 * تبقى فقط: الحسابات الثلاثة الافتراضية + المخزن الرئيسي + خزينة رئيسية برصيد صفر.
 */
export function applyCleanInitialState(): void {
  for (const def of getPersistenceCollections()) {
    if (def.kind === 'list') def.set([]);
  }
  memoryUsers = buildDefaultInitialUsers(INITIAL_USER_PASSWORD);
  memoryWarehouses = initialWarehouses.map(w => ({ ...w }));
  const now = new Date().toISOString();
  memoryCashboxes = [{
    ...initialCashboxes[0],
    name: 'الخزينة الرئيسية',
    openingBalance: 0,
    currentBalance: 0,
    notes: '',
    createdAt: now
  }];
  memoryUserCashboxAssignments = memoryUsers.map((u, i) => ({
    id: `ucba-init-${i + 1}`,
    userId: u.id,
    userName: u.name,
    cashboxId: memoryCashboxes[0].id,
    cashboxName: memoryCashboxes[0].name,
    permissionType: u.role === 'employee' ? 'إيداع وسحب' : 'إدارة كاملة',
    isDefault: true,
    status: 'active'
  })) as UserCashboxAssignment[];
  memoryCompanySettings = { ...defaultCompanySettings, phone: '', email: '', address: '', taxNumber: '', commercialRecord: '' };
  memoryInvoicePrintSettings = {
    ...defaultInvoicePrintSettings,
    headerText: defaultInvoicePrintSettings.headerText === 'فاتورة مبيعات مدققة وموثقة على المنصة' ? '' : (defaultInvoicePrintSettings.headerText ?? '')
  };
  memoryDisplaySettings = { ...defaultDisplaySettings };
  memoryStockSettings = { allowNegativeStockSale: false, allowNegativeWarehouseTransfer: false };
  setTaxSettings({ taxInclusive: true, platformCommissionOn: 'before_tax' });
  warehouseDispatchSeq = 0;
  warehouseMigrationCompleted = false;
  lastBulkEditUndoRecord = null;
}

/**
 * التحقق من كلمة سر مستخدم (لتأكيد العمليات الحساسة مثل استرجاع نسخة احتياطية)
 */
export function verifyUserPasswordById(userId: string, password: string): boolean {
  if (!userId || !password) return false;
  const user = memoryUsers.find(u => u.id === userId);
  if (!user || !user.salt || !user.passwordHash) return false;
  return hashPassword(password, user.salt) === user.passwordHash;
}

/**
 * للربط مع سجل شاشة البيع: يرجع الفاتورة المحفوظة التي خرجت من فاتورة مفتوحة معيّنة (cartId)
 */
export function findInvoiceSaleByCartId(cartId: string): { invoiceNumber: string; lines: { itemId: string; quantity: number }[] } | null {
  if (!cartId) return null;
  const invoice = memoryInvoices.find(inv => (inv as any).cartId === cartId);
  if (!invoice) return null;
  return {
    invoiceNumber: invoice.invoiceNumber,
    lines: (invoice.lines || []).map(line => ({ itemId: line.itemId, quantity: Number(line.quantity) || 0 }))
  };
}

// ---------------------------------------------------------------------------
// التوصيل: الفلوس والفواتير (بتستخدمها server/deliveryService.ts بس)
// ---------------------------------------------------------------------------

export function getInvoiceForDelivery(invoiceNumber: string): Invoice | undefined {
  const inv = memoryInvoices.find(i => i.invoiceNumber === invoiceNumber);
  return inv ? { ...inv, lines: (inv.lines || []).map(l => ({ ...l })) } : undefined;
}

/** الكميات اللي لسه ممكن ترجع من الفاتورة (بعد المرتجعات السابقة) */
export function remainingReturnLines(invoiceNumber: string): { itemId: string; itemName: string; returnedQuantity: number }[] {
  const inv = memoryInvoices.find(i => i.invoiceNumber === invoiceNumber);
  if (!inv) return [];
  const prev: Record<string, number> = {};
  for (const r of memoryReturns.filter(x => x.invoiceNumber === invoiceNumber)) {
    for (const l of r.lines || []) prev[l.itemId] = (prev[l.itemId] || 0) + Number(l.returnedQuantity || 0);
  }
  const left: Record<string, { itemId: string; itemName: string; returnedQuantity: number }> = {};
  for (const l of inv.lines || []) {
    const cur = left[l.itemId] || { itemId: l.itemId, itemName: l.itemNameAtSale || l.itemId, returnedQuantity: 0 };
    cur.returnedQuantity += Number(l.quantity || 0);
    left[l.itemId] = cur;
  }
  return Object.values(left)
    .map(l => ({ ...l, returnedQuantity: Math.round((l.returnedQuantity - (prev[l.itemId] || 0)) * 1000) / 1000 }))
    .filter(l => l.returnedQuantity > 0);
}

/** خزنة للتوصيل: لازم موجودة، ولو المستخدم محدد له خزن للتحصيل لازم تكون منهم */
export function resolveDeliveryCashbox(
  cashboxId: unknown,
  session: { role?: string; phone?: string; userId?: string } | undefined,
  purpose: 'receipt' | 'payment'
): { ok: boolean; cashbox?: { id: string; name: string; currentBalance: number }; error?: string } {
  const id = String(cashboxId || '');
  if (!id) return { ok: false, error: purpose === 'receipt' ? 'اختار الخزنة اللي الفلوس هتدخلها' : 'اختار الخزنة اللي هيتصرف منها' };
  const cashbox = memoryCashboxes.find(c => c.id === id);
  if (!cashbox) return { ok: false, error: 'الخزنة المختارة مش موجودة' };
  if (session?.role !== 'designer') {
    const caller = memoryUsers.find(u => u.phone === session?.phone || u.id === session?.userId);
    const allowed = caller?.cashboxConfig?.allowedReceiptCashboxIds || caller?.cashboxConfig?.allowedSaleCashboxIds;
    if (purpose === 'receipt' && allowed && allowed.length > 0 && !allowed.includes(id)) {
      return { ok: false, error: 'الخزنة المختارة مش مخصصة لك للتحصيل' };
    }
  }
  return { ok: true, cashbox: { id: cashbox.id, name: cashbox.name, currentBalance: cashbox.currentBalance } };
}

/** حركة على الخزنة من التوصيل: موجب = دخول (تسوية)، سالب = صرف (مستحقات طيار أو رسوم شركة) */
export function postDeliveryCashboxMovement(input: {
  cashboxId: string;
  amount: number;
  type: 'تحصيل توصيل' | 'مستحقات طيار' | 'رسوم شركة شحن';
  documentNumber: string;
  party: string;
  statement: string;
  userName: string;
}): { ok: boolean; balanceAfter?: number; error?: string } {
  const cashbox = memoryCashboxes.find(c => c.id === input.cashboxId);
  if (!cashbox) return { ok: false, error: 'الخزنة المختارة مش موجودة' };
  const amount = Math.round(Number(input.amount || 0) * 100) / 100;
  if (amount === 0) return { ok: true, balanceAfter: cashbox.currentBalance };
  if (amount < 0 && cashbox.currentBalance + amount < -0.001) {
    return { ok: false, error: `رصيد الخزنة «${cashbox.name}» (${cashbox.currentBalance} ج.م) مش كفاية لصرف ${Math.abs(amount)} ج.م` };
  }
  cashbox.currentBalance = Math.round((cashbox.currentBalance + amount) * 100) / 100;
  const now = new Date().toISOString();
  memoryCashboxTransactions.push({
    id: generateUUID(),
    date: now,
    cashboxId: cashbox.id,
    cashboxName: cashbox.name,
    type: input.type,
    documentNumber: input.documentNumber,
    amount,
    balanceAfter: cashbox.currentBalance,
    party: input.party,
    statement: input.statement,
    userName: input.userName
  });
  return { ok: true, balanceAfter: cashbox.currentBalance };
}

/** فواتير «الدفع عند الاستلام» اللي اتسوت: تبقى مسددة */
export function markDeliveryInvoicesPaid(invoiceNumbers: string[]): void {
  for (const num of invoiceNumbers) {
    const inv = memoryInvoices.find(i => i.invoiceNumber === num);
    if (!inv || inv.creditPartyType !== 'delivery') continue;
    inv.status = 'مسددة';
    inv.creditStatus = 'مسددة';
    inv.paidAmount = Number(inv.creditDueAmount ?? inv.netAmount) || 0;
    inv.remainingAmount = 0;
  }
}

/** بعد مرتجع طلب «الدفع عند الاستلام»: مفيش فلوس مستحقة على حد */
export function closeDeliveryInvoiceAfterReturn(invoiceNumber: string): void {
  const inv = memoryInvoices.find(i => i.invoiceNumber === invoiceNumber);
  if (!inv || inv.creditPartyType !== 'delivery') return;
  inv.creditStatus = 'مسددة';
  inv.paidAmount = 0;
  inv.remainingAmount = 0;
}



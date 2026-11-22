/**
 * إعادة الضبط — POS مدقق
 * ---------------------------------------------------------------------------
 * نوعان:
 *   1) إعادة ضبط العمليات: تمسح كل الحركة (فواتير، مشتريات، مرتجعات، مخزون، خزائن،
 *      كشوف حساب) وتصفّر الكميات والأرصدة، وتُبقي الأسماء (أصناف، عملاء، موردون،
 *      منصات، مخازن، خزائن) والمستخدمين والإعدادات وسجل التدقيق.
 *   2) إعادة ضبط المصنع: تمسح كل شيء وترجع الإعدادات للافتراضي، ويبقى فقط حساب
 *      مالك النظام وحساب من نفّذ العملية.
 * الدالتان تغيّران الذاكرة فقط؛ الحفظ في قاعدة البيانات يتم بعدها عبر طبقة الحفظ
 * كعملية واحدة ذرّية (الكل أو لا شيء).
 *
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import type { CollectionDef } from './persistence/statePersistence.ts';

/** مجموعات «العمليات»: تُمسح بالكامل في إعادة ضبط العمليات */
export const OPERATION_COLLECTIONS: readonly string[] = [
  'invoices',
  'returns',
  'purchases',
  'purchaseReturns',
  'stockMovements',
  'warehouseStocks',
  'warehouseTransfers',
  'cashboxEntries',
  'cashboxTransactions',
  'cashboxTransfers',
  'customerLedger',
  'supplierLedger',
  'partyLedger',
  'invoiceEditLogs',
  'itemChangeLogs',
  'importBatches',
  'creditCollectionsByKey',
  'idempotencyCache'
];

/** مجموعات «الأسماء»: تبقى سجلاتها، وتُصفَّر فيها هذه الحقول الرقمية فقط */
export const MASTER_ZERO_FIELDS: Readonly<Record<string, readonly string[]>> = {
  items: ['stockQuantity', 'totalStockQuantity'],
  customers: ['openingBalance', 'currentBalance'],
  suppliers: ['openingBalance', 'currentBalance'],
  platforms: ['currentBalance'],
  cashboxes: ['openingBalance', 'currentBalance']
};

/** مجموعات تبقى كما هي في إعادة ضبط العمليات */
export const KEPT_COLLECTIONS: readonly string[] = [
  'categories',
  'itemBarcodes',
  'itemPlatformCosts',
  'customerGroups',
  'supplierGroups',
  'warehouses',
  'users',
  'userCashboxAssignments',
  'auditLogs',
  'settings.company',
  'settings.invoicePrint',
  'settings.display',
  'settings.stock',
  'state.config'
];

/** كائنات مفردة لها معالجة خاصة في إعادة ضبط العمليات */
export const SPECIAL_SINGLES: readonly string[] = ['state.warehouse', 'state.bulkEditUndo'];

export interface ResetResult {
  cleared: Record<string, number>;
  zeroed: Record<string, number>;
  totalCleared: number;
}

export interface FactoryResetResult {
  totalCleared: number;
  keptUsers: { id: string; name: string }[];
}

/**
 * أسماء المجموعات المسجلة التي لم تُصنَّف في خطة إعادة الضبط.
 * يجب أن تكون القائمة فارغة دائمًا: أي مجموعة جديدة تُضاف للنظام يجب تصنيفها هنا
 * (عمليات تُمسح / أسماء تُصفَّر / تبقى) حتى لا تُنسى عند إعادة الضبط.
 */
export function findUnclassifiedCollections(collections: CollectionDef[], extraKnown: readonly string[] = []): string[] {
  const known = new Set<string>([
    ...OPERATION_COLLECTIONS,
    ...Object.keys(MASTER_ZERO_FIELDS),
    ...KEPT_COLLECTIONS,
    ...SPECIAL_SINGLES,
    ...extraKnown
  ]);
  return collections.map(def => def.name).filter(name => !known.has(name));
}

function countOf(def: CollectionDef): number {
  const value = def.get();
  return Array.isArray(value) ? value.length : 0;
}

/** إعادة ضبط العمليات: تمسح الحركة وتصفّر الكميات والأرصدة وتُبقي الأسماء */
export function resetOperations(collections: CollectionDef[]): ResetResult {
  const cleared: Record<string, number> = {};
  const zeroed: Record<string, number> = {};
  let totalCleared = 0;
  const operations = new Set(OPERATION_COLLECTIONS);

  for (const def of collections) {
    if (operations.has(def.name)) {
      if (def.kind !== 'list') continue;
      const count = countOf(def);
      def.set([]);
      cleared[def.name] = count;
      totalCleared += count;
      continue;
    }

    const zeroFields = MASTER_ZERO_FIELDS[def.name];
    if (zeroFields && def.kind === 'list') {
      const list: any[] = Array.isArray(def.get()) ? def.get() : [];
      for (const doc of list) {
        if (!doc || typeof doc !== 'object') continue;
        for (const field of zeroFields) {
          if (field in doc) doc[field] = 0;
        }
        // أرصدة المخازن المضمّنة داخل الصنف (إن وُجدت)
        if (def.name === 'items' && Array.isArray(doc.warehouseStocks)) {
          for (const stock of doc.warehouseStocks) {
            if (stock && typeof stock === 'object' && 'quantity' in stock) stock.quantity = 0;
          }
        }
      }
      zeroed[def.name] = list.length;
      continue;
    }

    if (def.name === 'state.warehouse' && def.kind === 'single') {
      // عدّاد أذون التحويل يبدأ من جديد، وحالة ترحيل المخزون تبقى كما هي
      def.set({ ...(def.get() || {}), warehouseDispatchSeq: 0 });
    } else if (def.name === 'state.bulkEditUndo' && def.kind === 'single') {
      def.set(null);
    }
  }

  return { cleared, zeroed, totalCleared };
}

/**
 * إعادة ضبط المصنع: كل شيء يُمسح والإعدادات ترجع للافتراضي.
 * - applyCleanInitialState: دالة النظام التي تبني الحالة الابتدائية النظيفة.
 * - keepUser: تحدد الحسابات التي تبقى (مالك النظام + من نفّذ العملية).
 */
export function factoryReset(
  collections: CollectionDef[],
  options: { applyCleanInitialState: () => void; keepUser: (user: any) => boolean }
): FactoryResetResult {
  const byName = new Map(collections.map(def => [def.name, def]));
  const usersDef = byName.get('users');
  if (!usersDef) throw new Error('مجموعة المستخدمين غير مسجلة');

  let totalCleared = 0;
  for (const def of collections) totalCleared += countOf(def);

  const usersBefore: any[] = Array.isArray(usersDef.get()) ? usersDef.get() : [];
  const kept = usersBefore.filter(user => user && options.keepUser(user)).map(user => {
    const copy = JSON.parse(JSON.stringify(user));
    // أي ربط بمخازن أو خزائن قديمة لم يعد صالحًا
    delete copy.cashboxConfig;
    delete copy.warehouseConfig;
    return copy;
  });
  if (kept.length === 0) throw new Error('لا يمكن إعادة ضبط المصنع بدون بقاء حساب واحد على الأقل');

  options.applyCleanInitialState();
  usersDef.set(kept);

  const cashboxes: any[] = (byName.get('cashboxes')?.get() as any[]) || [];
  const assignmentsDef = byName.get('userCashboxAssignments');
  if (assignmentsDef) {
    const main = cashboxes[0];
    assignmentsDef.set(
      main
        ? kept.map((user, index) => ({
            id: `ucba-reset-${index + 1}`,
            userId: user.id,
            userName: user.name,
            cashboxId: main.id,
            cashboxName: main.name,
            permissionType: 'إدارة كاملة',
            isDefault: true,
            status: 'active'
          }))
        : []
    );
  }

  totalCleared -= kept.length;
  return { totalCleared: Math.max(0, totalCleared), keptUsers: kept.map(user => ({ id: String(user.id), name: String(user.name || user.username || '') })) };
}

// ---------------------------------------------------------------------------
// بيانات متابعة إعادة الضبط — تُسجَّل ضمن سجل الحفظ
// ---------------------------------------------------------------------------

export interface ResetMeta {
  /** وقت آخر إعادة ضبط: أي عملية أوفلاين أُنشئت قبله تُرفض عند المزامنة */
  lastResetAt: string;
  lastResetType: '' | 'operations' | 'factory';
  lastResetBy: string;
}

let resetMeta: ResetMeta = { lastResetAt: '', lastResetType: '', lastResetBy: '' };

export function getResetMeta(): ResetMeta {
  return { ...resetMeta };
}

export function noteReset(type: 'operations' | 'factory', by: string, at: Date = new Date()) {
  resetMeta = { lastResetAt: at.toISOString(), lastResetType: type, lastResetBy: String(by || '') };
}

/** هل هذه العملية (بوقت إنشائها على الجهاز) أقدم من آخر إعادة ضبط؟ */
export function isBeforeLastReset(createdAt: unknown): boolean {
  if (!resetMeta.lastResetAt) return false;
  const created = typeof createdAt === 'number' ? createdAt : Date.parse(String(createdAt ?? ''));
  if (!Number.isFinite(created)) return false;
  return created < Date.parse(resetMeta.lastResetAt);
}

/** تُضاف إلى قائمة مجموعات الحفظ في server.ts حتى تبقى بعد إعادة التشغيل */
export function getResetMetaCollection(): CollectionDef {
  return {
    name: 'state.resetMeta',
    kind: 'single',
    get: () => resetMeta,
    set: value => {
      const type = value?.lastResetType;
      resetMeta = {
        lastResetAt: String(value?.lastResetAt || ''),
        lastResetType: type === 'operations' || type === 'factory' ? type : '',
        lastResetBy: String(value?.lastResetBy || '')
      };
    }
  };
}

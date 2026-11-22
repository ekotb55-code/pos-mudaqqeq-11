/**
 * سجل شاشة البيع على الجهاز — POS مدقق
 * ---------------------------------------------------------------------------
 * كل تغيير في الفاتورة المفتوحة (ضرب صنف، حذف، تقليل كمية، تفريغ) يُكتب فورًا
 * على الجهاز برقم مسلسل، ثم يُرفع للسيرفر في الخلفية:
 *   - الإنترنت موجود: خلال ثانية تقريبًا.
 *   - الإنترنت مقطوع: يبقى على الجهاز ويُرفع تلقائيًا عند رجوع الاتصال.
 * شاشة البيع لا تنتظر السيرفر أبدًا.
 *
 * الاستخدام من شاشة البيع:
 *   journal.syncCart(lines, meta)   ← عند كل تغيير في أصناف الفاتورة
 *   journal.currentCartId()         ← يُرسل مع طلب حفظ الفاتورة في الحقل cartId
 *   journal.cartSaved()             ← بعد نجاح حفظ الفاتورة (أونلاين أو في صندوق الأوفلاين)
 *   journal.closeCart('logout')     ← عند تسجيل الخروج والفاتورة فيها أصناف
 */

export interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CartLineInput {
  itemId: string;
  name?: string;
  barcode?: string;
  unitPrice?: number;
  quantity: number;
}

export interface CartMeta {
  warehouseId?: string;
  warehouseName?: string;
  platform?: string;
}

export interface JournalEvent {
  eventId?: string;
  seq: number;
  at: string;
  cartId: string;
  type: 'qty' | 'clear' | 'close';
  itemId?: string;
  itemName?: string;
  barcode?: string;
  unitPrice?: number;
  qty?: number;
  reason?: 'page_close' | 'logout' | 'crash' | 'other';
  warehouseId?: string;
  warehouseName?: string;
  platform?: string;
}

export type CartJournalStorageAlertType =
  | 'ok'
  | 'quota_reached'
  | 'write_failed'
  | 'legacy_pending_preserved';

export interface CartJournalStorageStatus {
  type: CartJournalStorageAlertType;
  message: string | null;
  tabPendingCount: number;
  totalPendingCount: number;
  legacyPreservedCount: number;
  maxTabPending: number;
  maxTotalPending: number;
}

export interface CartJournalClientOptions {
  storage: JournalStorage;
  /** يرسل الدفعة للسيرفر ويرجع آخر رقم مسلسل استلمه السيرفر. يرمي خطأ عند الفشل */
  send: (payload: { deviceId: string; events: JournalEvent[] }, options: { keepalive: boolean }) => Promise<{ lastSeq: number }>;
  now?: () => number;
  randomId?: () => string;
  flushDelayMs?: number;
  retryMs?: number;
  /** false في الاختبارات: بدون مؤقتات ولا مستمعي أحداث المتصفح */
  autoTimers?: boolean;
  /** معرّف التبويب الحالي لعزل طابور الأحداث و deviceId و cartId لكل تبويب */
  ownerTabId?: string;
  /** سقف الأحداث المعلقة للتبويب الواحد (افتراضيًا 5000) */
  maxTabPending?: number;
  /** السقف الإجمالي للأحداث المعلقة عبر جميع التبويبات (افتراضيًا 20000) */
  maxTotalPending?: number;
}

interface CartSnapshot {
  cartId: string;
  ownerTabId?: string;
  streamDeviceId?: string;
  items: Record<string, number>;
  lastAt: number;
  heartbeat: number;
  closed: boolean;
}

const KEY_DEVICE = 'mq_cj_device';
const KEY_SEQ = 'mq_cj_seq';
const KEY_PENDING = 'mq_cj_pending';
const KEY_TAB_BUFFER_INDEX = 'mq_cj_tab_buffers';
const KEY_TAB_BUFFER_PREFIX = 'mq_cj_tab_buf_';
const KEY_TAB_SEQ_PREFIX = 'mq_cj_tab_seq_';
const KEY_CARTS = 'mq_cj_carts';
const KEY_CART_PREFIX = 'mq_cj_cart_';
const LEGACY_MIGRATION_LOCK = 'mudaqqeq_cart_journal_legacy_migrate_v1';

export const DEFAULT_MAX_TAB_PENDING = 5000;
export const DEFAULT_MAX_TOTAL_PENDING = 20000;
const BATCH_SIZE = 200;
const HEARTBEAT_MS = 5000;
const ORPHAN_AFTER_MS = 30000;

function hasCrossTabWebLocks(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.locks) &&
    typeof navigator.locks.request === 'function'
  );
}

function eventIdentityKey(ev: Partial<JournalEvent> | null | undefined): string {
  if (!ev || typeof ev !== 'object') return '';
  const id = typeof ev.eventId === 'string' ? ev.eventId.trim() : '';
  if (id) return `id:${id}`;
  return `legacy:${ev.cartId || ''}:${ev.type || ''}:${ev.at || ''}:${ev.itemId || ''}:${ev.qty ?? ''}:${ev.seq ?? 0}`;
}

function defaultRandomId(): string {
  const cryptoObj: any = (globalThis as any).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return String(cryptoObj.randomUUID()).replace(/-/g, '').slice(0, 24);
  }
  let out = '';
  while (out.length < 24) out += Math.random().toString(36).slice(2);
  return out.slice(0, 24);
}

/**
 * اشتقاق معرّف تدفق/جهاز (deviceId) مستقل ومستقر لكل تبويب متوافق مع شرط السيرفر:
 * /^[A-Za-z0-9_-]{6,64}$/
 */
function buildStreamDeviceId(baseDeviceId: string, ownerTabId?: string): string {
  const cleanBase = String(baseDeviceId || 'dev-default')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 32) || 'dev-default';
  if (!ownerTabId) {
    return cleanBase.length >= 6 ? cleanBase : `dev-${cleanBase.padEnd(6, '0')}`;
  }
  const cleanTab = String(ownerTabId)
    .replace(/^tab_/, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 24);
  if (!cleanTab) {
    return cleanBase.length >= 6 ? cleanBase : `dev-${cleanBase.padEnd(6, '0')}`;
  }
  const combined = `${cleanBase}-t-${cleanTab}`.slice(0, 64);
  return combined.length >= 6 ? combined : `dev-${combined.padEnd(6, '0')}`;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export class CartJournalClient {
  private storage: JournalStorage;
  private send: CartJournalClientOptions['send'];
  private now: () => number;
  private randomId: () => string;
  private flushDelayMs: number;
  private retryMs: number;
  private autoTimers: boolean;
  private ownerTabId?: string;
  private maxTabPending: number;
  private maxTotalPending: number;
  private baseDeviceId: string;
  private deviceId: string;
  private cartId: string;
  private items = new Map<string, { qty: number; name: string; barcode: string; unitPrice: number }>();
  private meta: CartMeta = {};
  private metaSent = false;
  private cartClosed = false;
  private sendingPromise: Promise<boolean> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private storageAlertType: CartJournalStorageAlertType = 'ok';
  private storageAlertMessage: string | null = null;
  private statusListeners = new Set<(status: CartJournalStorageStatus) => void>();
  private onOnline = () => {
    this.flush().catch(() => undefined);
  };
  private onPageHide = () => {
    this.handlePageHide();
  };

  constructor(options: CartJournalClientOptions) {
    this.storage = options.storage;
    this.send = options.send;
    this.now = options.now || (() => Date.now());
    this.randomId = options.randomId || defaultRandomId;
    this.flushDelayMs = options.flushDelayMs ?? 1000;
    this.retryMs = options.retryMs ?? 15000;
    this.autoTimers = options.autoTimers ?? true;
    this.ownerTabId = options.ownerTabId ? String(options.ownerTabId).trim() : undefined;
    this.maxTabPending = options.maxTabPending ?? DEFAULT_MAX_TAB_PENDING;
    this.maxTotalPending = options.maxTotalPending ?? DEFAULT_MAX_TOTAL_PENDING;

    let baseDeviceId = this.read<string>(KEY_DEVICE, '');
    if (!baseDeviceId) {
      baseDeviceId = `dev-${this.randomId()}`;
      this.write(KEY_DEVICE, baseDeviceId);
    }
    this.baseDeviceId = baseDeviceId;
    this.deviceId = buildStreamDeviceId(this.baseDeviceId, this.ownerTabId);
    this.cartId = this.newCartId();
  }

  // ---- التخزين وحالة التنبيهات (معزولة لكل تبويب ولا تحذف أحداثًا قديمة بصمت) -----

  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(key);
      return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  }

  private setStorageAlert(type: CartJournalStorageAlertType, message: string | null) {
    if (this.storageAlertType === type && this.storageAlertMessage === message) {
      return;
    }
    this.storageAlertType = type;
    this.storageAlertMessage = message;
    this.notifyStatusListeners();
  }

  private notifyStatusListeners() {
    if (this.statusListeners.size === 0) return;
    const status = this.getStorageStatus();
    this.statusListeners.forEach((cb) => {
      try {
        cb(status);
      } catch (_) {}
    });
  }

  subscribeStorageStatus(listener: (status: CartJournalStorageStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getStorageStatus(): CartJournalStorageStatus {
    const tabQueue = this.read<JournalEvent[]>(this.getQueueStorageKey(), []);
    const legacy = this.ownerTabId ? this.read<JournalEvent[]>(KEY_PENDING, []) : [];
    const total = this.pendingCount();

    let effectiveType = this.storageAlertType;
    let effectiveMsg = this.storageAlertMessage;

    if (effectiveType === 'ok' && this.ownerTabId && Array.isArray(legacy) && legacy.length > 0 && !hasCrossTabWebLocks()) {
      effectiveType = 'legacy_pending_preserved';
      effectiveMsg = `يوجد ${legacy.length} حدث محفوظ من جلسة سابقة في التخزين المحلي المشترك؛ تم الاحتفاظ بها بأمان دون مسح ويمكن رفعها تلقائيًا أو يدويًا.`;
    }

    return {
      type: effectiveType,
      message: effectiveMsg,
      tabPendingCount: Array.isArray(tabQueue) ? tabQueue.length : 0,
      totalPendingCount: total,
      legacyPreservedCount: Array.isArray(legacy) ? legacy.length : 0,
      maxTabPending: this.maxTabPending,
      maxTotalPending: this.maxTotalPending
    };
  }

  private write(key: string, value: unknown): boolean {
    try {
      this.storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      this.setStorageAlert(
        'write_failed',
        'تعذر حفظ أحداث سجل مراقبة السلة بسبب امتلاء مساحة التخزين في المتصفح. تم الاحتفاظ بالأحداث السابقة، ويظل إتمام البيع الأونلاين متاحًا بشكل طبيعي.'
      );
      return false;
    }
  }

  private remove(key: string) {
    try {
      this.storage.removeItem(key);
    } catch {
      /* تجاهل */
    }
  }

  private getQueueStorageKey(): string {
    return this.ownerTabId ? `${KEY_TAB_BUFFER_PREFIX}${this.ownerTabId}` : KEY_PENDING;
  }

  private getSeqStorageKey(): string {
    return this.ownerTabId ? `${KEY_TAB_SEQ_PREFIX}${this.ownerTabId}` : KEY_SEQ;
  }

  private newCartId(): string {
    const cleanTab = (this.ownerTabId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6);
    return cleanTab ? `c-${cleanTab}-${this.randomId().slice(0, 18)}` : `c-${this.randomId()}`;
  }

  private registerTabBuffer(tabId: string) {
    const list = this.read<string[]>(KEY_TAB_BUFFER_INDEX, []);
    if (!list.includes(tabId)) {
      this.write(KEY_TAB_BUFFER_INDEX, [...list, tabId]);
    }
  }

  private unregisterTabBufferIfEmpty(tabId: string) {
    const bufKey = `${KEY_TAB_BUFFER_PREFIX}${tabId}`;
    const events = this.read<JournalEvent[]>(bufKey, []);
    if (Array.isArray(events) && events.length > 0) return;
    this.remove(bufKey);
    const list = this.read<string[]>(KEY_TAB_BUFFER_INDEX, []);
    if (list.includes(tabId)) {
      const next = list.filter((id) => id !== tabId);
      if (next.length === 0) {
        this.remove(KEY_TAB_BUFFER_INDEX);
      } else {
        this.write(KEY_TAB_BUFFER_INDEX, next);
      }
    }
  }

  /**
   * تطبيع أحداث طابور التبويب الحالي فقط مع الحفاظ الصارم على eventId و seq لكل حدث عبر أي إعادة محاولة.
   */
  private normalizeOwnTabQueue(): JournalEvent[] {
    const queueKey = this.getQueueStorageKey();
    const seqKey = this.getSeqStorageKey();
    const rawQueue = this.read<JournalEvent[]>(queueKey, []);
    if (!Array.isArray(rawQueue) || rawQueue.length === 0) {
      if (this.ownerTabId) {
        this.unregisterTabBufferIfEmpty(this.ownerTabId);
      }
      return [];
    }

    const highestSeq = Number(this.read<number>(seqKey, 0)) || 0;
    const seenIdentities = new Set<string>();
    const seenSeqs = new Set<number>();
    let maxSeenSeq = highestSeq;
    let mutated = false;
    const normalized: JournalEvent[] = [];

    for (const rawEv of rawQueue) {
      if (!rawEv || typeof rawEv !== 'object') {
        mutated = true;
        continue;
      }
      const ensuredId =
        typeof rawEv.eventId === 'string' && rawEv.eventId.trim()
          ? rawEv.eventId.trim()
          : `ev-${this.randomId()}`;
      let seq = Number(rawEv.seq) || 0;
      if (seq <= 0 || seenSeqs.has(seq)) {
        maxSeenSeq += 1;
        seq = maxSeenSeq;
        mutated = true;
      } else if (seq > maxSeenSeq) {
        maxSeenSeq = seq;
      }

      const ev: JournalEvent =
        ensuredId === rawEv.eventId && seq === rawEv.seq
          ? rawEv
          : { ...rawEv, eventId: ensuredId, seq };
      if (ensuredId !== rawEv.eventId) mutated = true;

      const idKey = eventIdentityKey(ev);
      if (idKey && seenIdentities.has(idKey)) {
        mutated = true;
        continue;
      }
      if (idKey) seenIdentities.add(idKey);
      seenSeqs.add(seq);
      normalized.push(ev);
    }

    normalized.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));

    if (maxSeenSeq > highestSeq) {
      this.write(seqKey, maxSeenSeq);
    }
    if (mutated) {
      this.write(queueKey, normalized);
    }
    return normalized;
  }

  /**
   * ترحيل/رفع الأحداث القديمة المعلقة في KEY_PENDING (من قبل تحديث فصل التبويبات):
   * - يُرسل تحت معرّف الجهاز الأساسي (baseDeviceId) مع الحفاظ على eventId و seq.
   * - في المتصفح متعدد التبويبات: يستخدم Web Locks لمنع تبويبين من رفع KEY_PENDING القديم في اللحظة نفسها.
   * - إذا لم يتوفر Web Locks في المتصفح (ووجد ownerTabId): يترك KEY_PENDING محفوظًا كما هو دون مسح صامت،
   *   ويتيح رفعه يدويًا عبر flushLegacyPendingQueue().
   */
  private async flushLegacySharedPendingIfSafe(options: { keepalive?: boolean; forceWithoutLock?: boolean }): Promise<boolean> {
    if (!this.ownerTabId) {
      // عندما لا يوجد ownerTabId يكون KEY_PENDING هو طابور هذا العميل نفسه ويُعالج في flushOwnTabQueue
      return true;
    }

    const legacyPending = this.read<JournalEvent[]>(KEY_PENDING, []);
    if (!Array.isArray(legacyPending) || legacyPending.length === 0) {
      return true;
    }

    const doFlushLegacy = async (): Promise<boolean> => {
      for (;;) {
        const rawList = this.read<JournalEvent[]>(KEY_PENDING, []);
        if (!Array.isArray(rawList) || rawList.length === 0) {
          if (this.storageAlertType === 'legacy_pending_preserved') {
            this.setStorageAlert('ok', null);
          }
          return true;
        }

        let legacySeq = Number(this.read<number>(KEY_SEQ, 0)) || 0;
        let mutated = false;
        const seenIds = new Set<string>();
        const seenSeqs = new Set<number>();
        const normalized: JournalEvent[] = [];

        for (const rawEv of rawList) {
          if (!rawEv || typeof rawEv !== 'object') {
            mutated = true;
            continue;
          }
          const ensuredId =
            typeof rawEv.eventId === 'string' && rawEv.eventId.trim()
              ? rawEv.eventId.trim()
              : `ev-${this.randomId()}`;
          let s = Number(rawEv.seq) || 0;
          if (s <= 0 || seenSeqs.has(s)) {
            legacySeq += 1;
            s = legacySeq;
            mutated = true;
          } else if (s > legacySeq) {
            legacySeq = s;
          }
          const ev: JournalEvent =
            ensuredId === rawEv.eventId && s === rawEv.seq
              ? rawEv
              : { ...rawEv, eventId: ensuredId, seq: s };
          if (ensuredId !== rawEv.eventId) mutated = true;
          const idKey = eventIdentityKey(ev);
          if (idKey && seenIds.has(idKey)) {
            mutated = true;
            continue;
          }
          if (idKey) seenIds.add(idKey);
          seenSeqs.add(s);
          normalized.push(ev);
        }

        normalized.sort((a, b) => a.seq - b.seq);
        if (mutated) {
          this.write(KEY_SEQ, legacySeq);
          this.write(KEY_PENDING, normalized);
        }

        if (normalized.length === 0) {
          this.remove(KEY_PENDING);
          return true;
        }

        const batch = normalized.slice(0, BATCH_SIZE);
        const result = await this.send(
          { deviceId: this.baseDeviceId, events: batch },
          { keepalive: Boolean(options.keepalive) }
        );
        const lastSeq = Number(result?.lastSeq);
        if (!Number.isFinite(lastSeq)) throw new Error('رد غير صالح من السيرفر');
        const confirmedUpTo = lastSeq < batch[0].seq ? batch[batch.length - 1].seq : lastSeq;
        const latestLegacy = this.read<JournalEvent[]>(KEY_PENDING, []);
        const confirmedBatchIdentities = new Set(
          batch
            .filter((ev) => ev.seq <= confirmedUpTo)
            .map((ev) => eventIdentityKey(ev))
            .filter(Boolean)
        );
        const remaining = latestLegacy.filter(
          (ev) => !confirmedBatchIdentities.has(eventIdentityKey(ev))
        );
        if (remaining.length === 0) {
          this.remove(KEY_PENDING);
        } else {
          this.write(KEY_PENDING, remaining);
        }
        if (lastSeq > (Number(this.read<number>(KEY_SEQ, 0)) || 0)) {
          this.write(KEY_SEQ, lastSeq);
        }
      }
    };

    if (hasCrossTabWebLocks()) {
      return navigator.locks.request(
        LEGACY_MIGRATION_LOCK,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) return true;
          return doFlushLegacy();
        }
      );
    }

    if (options.forceWithoutLock || typeof window === 'undefined') {
      return doFlushLegacy();
    }

    // في متصفح بدون Web Locks: لا نمسح KEY_PENDING المشترك ولا نرفعه تلقائيًا بالتوازي؛ نحتفظ به ونعرض مسار استعادته
    this.notifyStatusListeners();
    return true;
  }

  /**
   * استعادة/رفع الأحداث القديمة المحفوظة في KEY_PENDING يدويًا بأمان عندما يطلب المستخدم ذلك.
   */
  async flushLegacyPendingQueue(): Promise<boolean> {
    return this.flushLegacySharedPendingIfSafe({ keepalive: false, forceWithoutLock: true });
  }

  /**
   * تحديث معرّف التبويب المالك (عند اكتشاف Duplicate Tab) مع تدوير deviceId الخاص بالتدفق و cartId
   * حتى لا يتشارك تبويبان منسوخان نفس سلة الفاتورة أو نفس عداد التسلسل.
   */
  setOwnerTabId(nextTabId: string) {
    const cleanNext = String(nextTabId || '').trim();
    if (!cleanNext || cleanNext === this.ownerTabId) return;
    this.ownerTabId = cleanNext;
    this.deviceId = buildStreamDeviceId(this.baseDeviceId, this.ownerTabId);
    const prevCartId = this.cartId;
    const prevItems = new Map(this.items);
    this.cartId = this.newCartId();
    this.metaSent = false;
    this.cartClosed = false;
    // لا نحذف snapshot القديمة لأنها قد تخص التبويب الأصلي المنسوخ منه
    const index = this.read<string[]>(KEY_CARTS, []);
    if (prevCartId && index.includes(prevCartId)) {
      const snap = this.read<CartSnapshot | null>(KEY_CART_PREFIX + prevCartId, null);
      if (snap && snap.ownerTabId === this.ownerTabId) {
        this.dropSnapshot(prevCartId);
      }
    }
    this.items = prevItems;
    const hasItems = Array.from(this.items.values()).some((entry) => entry.qty > 0);
    if (hasItems) {
      this.saveSnapshot();
      for (const [itemId, entry] of this.items) {
        if (entry.qty > 0) {
          this.push({
            cartId: this.cartId,
            type: 'qty',
            itemId,
            itemName: entry.name,
            barcode: entry.barcode,
            unitPrice: entry.unitPrice,
            qty: entry.qty,
            warehouseId: this.meta.warehouseId,
            warehouseName: this.meta.warehouseName,
            platform: this.meta.platform
          });
        }
      }
      this.metaSent = true;
    }
    this.notifyStatusListeners();
  }

  private push(event: Omit<JournalEvent, 'seq' | 'at'> & { at?: number }) {
    const { at, ...rest } = event;
    const atIso = new Date(at ?? this.now()).toISOString();
    const eventId =
      typeof rest.eventId === 'string' && rest.eventId.trim()
        ? rest.eventId.trim()
        : `ev-${this.randomId()}`;

    const queueKey = this.getQueueStorageKey();
    const seqKey = this.getSeqStorageKey();
    const currentQueue = this.read<JournalEvent[]>(queueKey, []);
    const totalPending = this.pendingCount();

    // سياسة السقف الواضحة: عند بلوغ حد التبويب أو الحد الإجمالي نرفض إضافة أحداث جديدة دون حذف الأحداث القديمة بصمت، وننبه المستخدم
    if (currentQueue.length >= this.maxTabPending || totalPending >= this.maxTotalPending) {
      this.setStorageAlert(
        'quota_reached',
        `بلغ طابور سجل مراقبة السلة الحد الأقصى المسموح (${this.maxTabPending} حدث للتبويب / ${this.maxTotalPending} إجماليًا). تم الاحتفاظ بجميع الأحداث السابقة دون حذف، وسيُستأنف التسجيل تلقائيًا بعد اتصال السيرفر ورفع الأحداث. البيع الأونلاين يعمل بشكل طبيعي.`
      );
      this.scheduleFlush();
      return;
    }

    const currentSeq = Number(this.read<number>(seqKey, 0)) || 0;
    const maxQueueSeq = currentQueue.reduce(
      (m, e) => (e && typeof e.seq === 'number' && e.seq > m ? e.seq : m),
      0
    );
    const seq = Math.max(currentSeq, maxQueueSeq) + 1;
    const full: JournalEvent = { ...rest, eventId, seq, at: atIso };

    const nextQueue = [...currentQueue, full];
    const wroteQueue = this.write(queueKey, nextQueue);
    if (!wroteQueue) {
      // فشل الكتابة بسبب امتلاء التخزين: لا نحدث عداد التسلسل ونبقي الأحداث السابقة كما هي
      return;
    }
    this.write(seqKey, seq);
    if (this.ownerTabId) {
      this.registerTabBuffer(this.ownerTabId);
    }
    if (this.storageAlertType === 'write_failed' || this.storageAlertType === 'quota_reached') {
      this.setStorageAlert('ok', null);
    } else {
      this.notifyStatusListeners();
    }
    this.scheduleFlush();
  }

  private saveSnapshot() {
    const key = KEY_CART_PREFIX + this.cartId;
    const index = this.read<string[]>(KEY_CARTS, []);
    const hasItems = Array.from(this.items.values()).some(entry => entry.qty > 0);
    if (!hasItems) {
      this.remove(key);
      if (index.includes(this.cartId)) this.write(KEY_CARTS, index.filter(id => id !== this.cartId));
      return;
    }
    const items: Record<string, number> = {};
    for (const [itemId, entry] of this.items) if (entry.qty > 0) items[itemId] = entry.qty;
    const snapshot: CartSnapshot = {
      cartId: this.cartId,
      ownerTabId: this.ownerTabId,
      streamDeviceId: this.deviceId,
      items,
      lastAt: this.now(),
      heartbeat: this.now(),
      closed: this.cartClosed
    };
    this.write(key, snapshot);
    const refreshedIndex = this.read<string[]>(KEY_CARTS, []);
    if (!refreshedIndex.includes(this.cartId)) {
      this.write(KEY_CARTS, [...refreshedIndex, this.cartId]);
    }
  }

  private dropSnapshot(cartId: string) {
    this.remove(KEY_CART_PREFIX + cartId);
    const index = this.read<string[]>(KEY_CARTS, []);
    if (index.includes(cartId)) this.write(KEY_CARTS, index.filter(id => id !== cartId));
  }

  private rotateCart() {
    this.dropSnapshot(this.cartId);
    this.cartId = this.newCartId();
    this.items = new Map();
    this.metaSent = false;
    this.cartClosed = false;
  }

  // ---- واجهة شاشة البيع ------------------------------------------------------

  getDeviceId(): string {
    return this.deviceId;
  }

  getBaseDeviceId(): string {
    return this.baseDeviceId;
  }

  /** رقم الفاتورة المفتوحة الحالية — يُرسل مع طلب حفظ الفاتورة في الحقل cartId */
  currentCartId(): string {
    return this.cartId;
  }

  /** عدد الأحداث المعلقة الخاصة بهذا التبويب فقط */
  tabPendingCount(): number {
    const evs = this.read<JournalEvent[]>(this.getQueueStorageKey(), []);
    return Array.isArray(evs) ? evs.length : 0;
  }

  /** إجمالي الأحداث المعلقة في هذا التبويب وأي مخازن تبويبات أخرى أو طابور قديم */
  pendingCount(): number {
    const pending = this.read<JournalEvent[]>(KEY_PENDING, []);
    const seen = new Set<string>(pending.map((ev) => eventIdentityKey(ev)).filter(Boolean));
    let total = pending.length;
    const tabIds = new Set<string>(this.read<string[]>(KEY_TAB_BUFFER_INDEX, []));
    if (this.ownerTabId) tabIds.add(this.ownerTabId);
    for (const tId of tabIds) {
      if (!tId) continue;
      const tabEvs = this.read<JournalEvent[]>(`${KEY_TAB_BUFFER_PREFIX}${tId}`, []);
      for (const ev of tabEvs) {
        const key = eventIdentityKey(ev);
        if (!key || !seen.has(key)) {
          if (key) seen.add(key);
          total += 1;
        }
      }
    }
    return total;
  }

  /** تُستدعى عند كل تغيير في أصناف الفاتورة المفتوحة. تقارن بالحالة السابقة وتسجل الفرق فقط */
  syncCart(lines: CartLineInput[], meta: CartMeta = {}) {
    const next = new Map<string, { qty: number; name: string; barcode: string; unitPrice: number }>();
    for (const line of Array.isArray(lines) ? lines : []) {
      const itemId = String(line?.itemId ?? '').trim();
      const quantity = Number(line?.quantity);
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0) continue;
      const existing = next.get(itemId);
      next.set(itemId, {
        qty: round3((existing?.qty || 0) + quantity),
        name: String(line.name ?? existing?.name ?? ''),
        barcode: String(line.barcode ?? existing?.barcode ?? ''),
        unitPrice: Number.isFinite(Number(line.unitPrice)) ? Number(line.unitPrice) : existing?.unitPrice || 0
      });
    }
    this.meta = { ...this.meta, ...meta };

    const activeBefore = Array.from(this.items.entries()).filter(([, entry]) => entry.qty > 0);
    const metaPart = () => {
      if (this.metaSent) return {};
      this.metaSent = true;
      return { warehouseId: this.meta.warehouseId, warehouseName: this.meta.warehouseName, platform: this.meta.platform };
    };

    let changed = false;
    if (next.size === 0 && activeBefore.length >= 2) {
      this.push({ cartId: this.cartId, type: 'clear', ...metaPart() });
      for (const [, entry] of activeBefore) entry.qty = 0;
      changed = true;
    } else {
      const ids = new Set<string>([...this.items.keys(), ...next.keys()]);
      for (const itemId of ids) {
        const before = this.items.get(itemId);
        const after = next.get(itemId);
        const beforeQty = before?.qty || 0;
        const afterQty = after?.qty || 0;
        if (beforeQty === afterQty) continue;
        const info = after || before!;
        this.push({
          cartId: this.cartId,
          type: 'qty',
          itemId,
          itemName: info.name,
          barcode: info.barcode,
          unitPrice: info.unitPrice,
          qty: afterQty,
          ...metaPart()
        });
        this.items.set(itemId, { ...info, qty: afterQty });
        changed = true;
      }
    }
    if (changed) {
      this.cartClosed = false;
      this.saveSnapshot();
    }
  }

  /** بعد نجاح حفظ الفاتورة: تبدأ فاتورة جديدة برقم جديد بدون تسجيل أي حذف */
  cartSaved(): string {
    const saved = this.cartId;
    this.rotateCart();
    return saved;
  }

  /** إغلاق الفاتورة المفتوحة بدون بيع (تسجيل خروج مثلًا) */
  closeCart(reason: 'logout' | 'page_close' | 'other' = 'other') {
    const hasItems = Array.from(this.items.values()).some(entry => entry.qty > 0);
    if (hasItems && !this.cartClosed) this.push({ cartId: this.cartId, type: 'close', reason });
    this.rotateCart();
    this.flush().catch(() => undefined);
  }

  /** عند إغلاق أو تحديث الصفحة: يسجل الحدث على الجهاز ويحاول إرساله قبل أن تُغلق الصفحة */
  handlePageHide() {
    const hasItems = Array.from(this.items.values()).some(entry => entry.qty > 0);
    if (hasItems && !this.cartClosed) {
      this.push({ cartId: this.cartId, type: 'close', reason: 'page_close' });
      this.cartClosed = true;
      this.saveSnapshot();
    }
    this.flush({ keepalive: true }).catch(() => undefined);
  }

  // ---- الرفع للسيرفر (طابور مستقل لكل تبويب + منع استدعاءات الرفع المتزامنة داخل التبويب) ----

  private scheduleFlush() {
    if (!this.autoTimers || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => undefined);
    }, this.flushDelayMs);
  }

  /** يرفع الأحداث المعلقة الخاصة بهذا التبويب بشكل متسلسل داخل التبويب نفسه. يرجع true لو لم يبقَ شيء معلق في طابور التبويب */
  async flush(options: { keepalive?: boolean } = {}): Promise<boolean> {
    while (this.sendingPromise) {
      try {
        await this.sendingPromise;
      } catch {
        /* فشل الرفع السابق: نحاول من جديد */
      }
    }
    const run = this.runFlush(options);
    this.sendingPromise = run;
    try {
      return await run;
    } finally {
      if (this.sendingPromise === run) this.sendingPromise = null;
    }
  }

  private async runFlush(options: { keepalive?: boolean }): Promise<boolean> {
    const queueKey = this.getQueueStorageKey();
    const seqKey = this.getSeqStorageKey();

    for (;;) {
      const ordered = this.normalizeOwnTabQueue();
      if (ordered.length === 0) break;
      const batch = ordered.slice(0, BATCH_SIZE);
      const result = await this.send(
        { deviceId: this.deviceId, events: batch },
        { keepalive: Boolean(options.keepalive) }
      );
      const lastSeq = Number(result?.lastSeq);
      if (!Number.isFinite(lastSeq)) throw new Error('رد غير صالح من السيرفر');
      // السيرفر لم يقبل أي حدث من الدفعة (بيانات غير صالحة): نسقط الدفعة المرسلة فقط
      const confirmedUpTo = lastSeq < batch[0].seq ? batch[batch.length - 1].seq : lastSeq;
      // إعادة قراءة مخزن هذا التبويب فقط لحظة الحذف حتى لا تضيع أحداث جديدة أضيفت أثناء الإرسال
      const latestQueue = this.read<JournalEvent[]>(queueKey, []);
      const confirmedBatchIdentities = new Set(
        batch
          .filter((ev) => ev.seq <= confirmedUpTo)
          .map((ev) => eventIdentityKey(ev))
          .filter(Boolean)
      );
      const remaining = latestQueue.filter(
        (event) => !confirmedBatchIdentities.has(eventIdentityKey(event))
      );
      if (remaining.length === 0 && this.ownerTabId) {
        this.remove(queueKey);
        this.unregisterTabBufferIfEmpty(this.ownerTabId);
      } else {
        this.write(queueKey, remaining);
      }
      // لو عدّاد هذا التبويب أقل من عدّاد السيرفر نكمل العدّ من رقم السيرفر
      if (lastSeq > (Number(this.read<number>(seqKey, 0)) || 0)) {
        this.write(seqKey, lastSeq);
      }
    }

    if (this.storageAlertType === 'quota_reached') {
      this.setStorageAlert('ok', null);
    } else {
      this.notifyStatusListeners();
    }

    await this.flushLegacySharedPendingIfSafe(options);
    return this.tabPendingCount() === 0;
  }

  // ---- التشغيل -------------------------------------------------------------------

  /** فواتير تُركت مفتوحة من جلسة سابقة انتهت فجأة (الجهاز قفل أو المتصفح أُغلق بالقوة) */
  recoverOrphans() {
    const index = this.read<string[]>(KEY_CARTS, []);
    const keep: string[] = [];
    for (const cartId of index) {
      if (cartId === this.cartId) {
        keep.push(cartId);
        continue;
      }
      const snapshot = this.read<CartSnapshot | null>(KEY_CART_PREFIX + cartId, null);
      if (!snapshot) continue;
      if (this.now() - (snapshot.heartbeat || 0) < ORPHAN_AFTER_MS) {
        keep.push(cartId); // تبويب آخر ما زال يعمل على هذه الفاتورة
        continue;
      }
      if (!snapshot.closed && Object.keys(snapshot.items || {}).length > 0) {
        this.push({ cartId, type: 'close', reason: 'crash', at: snapshot.lastAt || this.now() });
      }
      this.remove(KEY_CART_PREFIX + cartId);
    }
    const latestIndex = this.read<string[]>(KEY_CARTS, []);
    for (const cartId of latestIndex) {
      if (!index.includes(cartId) && !keep.includes(cartId)) {
        keep.push(cartId);
      }
    }
    this.write(KEY_CARTS, keep);
  }

  start() {
    this.recoverOrphans();
    if (!this.autoTimers) return;
    const target: any = typeof window !== 'undefined' ? window : null;
    if (target && typeof target.addEventListener === 'function') {
      target.addEventListener('online', this.onOnline);
      target.addEventListener('pagehide', this.onPageHide);
    }
    this.heartbeatTimer = setInterval(() => {
      const hasItems = Array.from(this.items.values()).some(entry => entry.qty > 0);
      if (!hasItems) return;
      const key = KEY_CART_PREFIX + this.cartId;
      const snapshot = this.read<CartSnapshot | null>(key, null);
      if (snapshot) this.write(key, { ...snapshot, heartbeat: this.now() });
    }, HEARTBEAT_MS);
    this.retryTimer = setInterval(() => {
      if (this.pendingCount() > 0) this.flush().catch(() => undefined);
    }, this.retryMs);
    this.flush().catch(() => undefined);
  }

  stop() {
    const target: any = typeof window !== 'undefined' ? window : null;
    if (target && typeof target.removeEventListener === 'function') {
      target.removeEventListener('online', this.onOnline);
      target.removeEventListener('pagehide', this.onPageHide);
    }
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.flushTimer = null;
    this.heartbeatTimer = null;
    this.retryTimer = null;
  }
}

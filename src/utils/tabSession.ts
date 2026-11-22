/**
 * إدارة هوية التبويب، مزامنة النشاط البشري، حماية تبديل المستخدم، وبث تحديثات المخزون أونلاين بين التبويبات
 * بدون بث أو تخزين رمز الدخول (pos_token) عبر BroadcastChannel.
 */

export const TAB_SYNC_CHANNEL_NAME = 'mudaqqeq_tab_sync_v1';
export const TAB_ID_STORAGE_KEY = 'mudaqqeq_tab_id_v1';
export const LAST_HUMAN_ACTIVITY_STORAGE_KEY = 'mudaqqeq_last_human_activity_v1';
export const SESSION_META_STORAGE_KEY = 'mudaqqeq_auth_session_meta_v1';
export const LEGACY_DRAFT_CLAIM_PREFIX = 'mudaqqeq_legacy_draft_claim_v1_';

export interface BoundSessionIdentity {
  userId: string;
  sessionTag: string;
}

export interface SharedHumanActivityRecord {
  userId: string;
  sessionTag: string;
  at: number;
}

export type TabSyncMessage =
  | { type: 'TAB_HELLO'; tabId: string; instanceId: string; sentAt: number }
  | { type: 'TAB_CLAIMED'; tabId: string; ownerInstanceId: string; sentAt: number }
  | { type: 'USER_ACTIVITY'; userId: string; sessionTag: string; at: number }
  | { type: 'AUTH_LOGOUT'; reason?: string; userId?: string; sessionTag?: string; at: number }
  | { type: 'AUTH_EXPIRED'; message?: string; userId?: string; sessionTag?: string; at: number }
  | { type: 'AUTH_SESSION_CHANGED'; userId: string; sessionTag: string; at: number }
  | {
      type: 'POS_STOCK_UPDATED';
      sourceTabId: string;
      warehouseId?: string;
      itemIds?: string[];
      invoiceNumber?: string;
      at: number;
    }
  | { type: 'OFFLINE_LOCK_RELEASED'; sourceTabId: string; at: number };

const instanceId = (() => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) {}
  return `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
})();

function generateFreshTabId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `tab_${crypto.randomUUID()}`;
    }
  } catch (_) {}
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

let cachedTabId: string | null = null;
let sharedChannel: BroadcastChannel | null = null;
let channelInitialized = false;
let tabHandshakeStartedAt = 0;
let tabIdentityWasPreExistingInSession = false;
const tabIdListeners = new Set<(newTabId: string, prevTabId: string) => void>();
const messageListeners = new Set<(msg: TabSyncMessage) => void>();

export function computeSessionTag(token: string | null | undefined, userId?: string | null): string {
  const raw = `${String(userId || '').trim()}:${String(token || '').trim()}`;
  if (!raw || raw === ':') return '';
  // FNV-1a 64-bit split digest -> non-reversible session tag (never exposes raw token)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + ((i + 1) & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `st_${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}`;
}

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!sharedChannel) {
    try {
      sharedChannel = new BroadcastChannel(TAB_SYNC_CHANNEL_NAME);
    } catch (_) {
      sharedChannel = null;
    }
  }
  return sharedChannel;
}

export function postTabSyncMessage(msg: TabSyncMessage): void {
  const ch = getBroadcastChannel();
  if (!ch) return;
  try {
    ch.postMessage(msg);
  } catch (_) {}
}

export function subscribeTabSyncMessages(listener: (msg: TabSyncMessage) => void): () => void {
  ensureTabSessionInitialized();
  messageListeners.add(listener);
  return () => {
    messageListeners.delete(listener);
  };
}

export function subscribeTabIdChange(
  listener: (newTabId: string, prevTabId: string) => void
): () => void {
  ensureTabSessionInitialized();
  tabIdListeners.add(listener);
  return () => {
    tabIdListeners.delete(listener);
  };
}

export type TabIdentityResolutionMode =
  | 'web-locks'
  | 'indexeddb-lease'
  | 'fresh-session'
  | 'ambiguous-blocked';

export interface TabIdentitySettlement {
  tabId: string;
  isAmbiguous: boolean;
  mode: TabIdentityResolutionMode;
  reason?: string;
}

export const TAB_LEASE_META_PREFIX = 'tab_identity_lease:';
export const TAB_LEASE_HEARTBEAT_MS = 2500;
export const TAB_LEASE_STALE_MS = 8000;
const TAB_LEASE_DB_NAME = 'mudaqqeq_pos_offline_db';
const TAB_LEASE_DB_VERSION = 1;
const TAB_LEASE_STORE_NAME = 'meta';

export interface TabLeaseRecord {
  tabId: string;
  instanceId: string;
  claimedAt: number;
  heartbeatAt: number;
}

let heldTabIdentityLockForId: string | null = null;
let releaseHeldTabIdentityLockFn: (() => void) | null = null;
let tabIdentityLockAcquirePromise: Promise<string> | null = null;
let tabIdentitySettlementState: TabIdentitySettlement | null = null;
let idbLeaseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heldIdbLeaseTabId: string | null = null;

export interface TabIdentityAdapterForTests {
  hasWebLocks?: () => boolean;
  tryAcquireIdbLease?: (tabId: string, instId: string, now: number) => Promise<'acquired' | 'occupied' | 'unavailable'>;
  releaseIdbLease?: (tabId: string, instId: string) => Promise<void>;
}

let testAdapter: TabIdentityAdapterForTests | null = null;

export function __setTabIdentityAdapterForTests(adapter: TabIdentityAdapterForTests | null): void {
  testAdapter = adapter;
  tabIdentitySettlementState = null;
  tabIdentityLockAcquirePromise = null;
  releaseHeldTabIdentityLock();
  stopIdbLeaseHeartbeat();
}

export function __resetTabSessionForTests(options?: { preExistingTabId?: string | null }): void {
  releaseHeldTabIdentityLock();
  stopIdbLeaseHeartbeat();
  tabIdentitySettlementState = null;
  tabIdentityLockAcquirePromise = null;
  channelInitialized = false;
  if (options && 'preExistingTabId' in options) {
    cachedTabId = options.preExistingTabId || null;
    tabIdentityWasPreExistingInSession = Boolean(options.preExistingTabId);
  } else {
    cachedTabId = null;
    tabIdentityWasPreExistingInSession = false;
  }
}

interface HeldLegacyDraftClaim {
  tabId: string;
  release: () => void;
}

const heldLegacyDraftClaims = new Map<string, HeldLegacyDraftClaim>();
const pendingLegacyDraftClaims = new Map<string, Promise<boolean>>();
let legacyClaimPageHideBound = false;

function hasAtomicWebLocks(): boolean {
  if (testAdapter?.hasWebLocks) {
    return testAdapter.hasWebLocks();
  }
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.locks !== 'undefined' &&
    typeof navigator.locks.request === 'function'
  );
}

function openTabLeaseDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const req = indexedDB.open(TAB_LEASE_DB_NAME, TAB_LEASE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('catalog')) {
          db.createObjectStore('catalog', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(TAB_LEASE_STORE_NAME)) {
          db.createObjectStore(TAB_LEASE_STORE_NAME, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('users')) {
          db.createObjectStore('users', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('outbox')) {
          const outboxStore = db.createObjectStore('outbox', { keyPath: 'id' });
          outboxStore.createIndex('status', 'status', { unique: false });
          outboxStore.createIndex('createdAt', 'createdAt', { unique: false });
          outboxStore.createIndex('idempotencyKey', 'idempotencyKey', { unique: false });
        }
        if (!db.objectStoreNames.contains('credit')) {
          db.createObjectStore('credit', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          try {
            db.close();
          } catch (_) {}
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * معاملة IndexedDB ذرية واحدة (readwrite) على مخزن meta لمطالبة أو تجديد هوية التبويب.
 * في IndexedDB، المعاملات المتزامنة على نفس المخزن بوضع readwrite تُسلسَل تلقائيًا بواسطة محرك المتصفح،
 * مما يمنع تبويبين من قراءة وكتابة عقد الهوية في اللحظة نفسها.
 */
async function tryAcquireOrRenewIdbTabLease(
  candidateTabId: string,
  ownerInstanceId: string,
  nowMs = Date.now()
): Promise<'acquired' | 'occupied' | 'unavailable'> {
  if (testAdapter?.tryAcquireIdbLease) {
    return testAdapter.tryAcquireIdbLease(candidateTabId, ownerInstanceId, nowMs);
  }
  if (typeof indexedDB === 'undefined') {
    return 'unavailable';
  }
  let db: IDBDatabase | null = null;
  try {
    db = await openTabLeaseDb();
    return await new Promise<'acquired' | 'occupied' | 'unavailable'>((resolve) => {
      let decision: 'acquired' | 'occupied' = 'occupied';
      try {
        const tx = db!.transaction([TAB_LEASE_STORE_NAME], 'readwrite');
        const store = tx.objectStore(TAB_LEASE_STORE_NAME);
        const key = `${TAB_LEASE_META_PREFIX}${candidateTabId}`;
        const getReq = store.get(key);

        getReq.onsuccess = () => {
          const existing = getReq.result as { key: string; value?: TabLeaseRecord } | undefined;
          const lease = existing?.value;
          const isAliveOther =
            lease &&
            typeof lease === 'object' &&
            lease.instanceId &&
            lease.instanceId !== ownerInstanceId &&
            typeof lease.heartbeatAt === 'number' &&
            nowMs - lease.heartbeatAt < TAB_LEASE_STALE_MS;

          if (isAliveOther) {
            decision = 'occupied';
            return;
          }

          decision = 'acquired';
          const nextLease: TabLeaseRecord = {
            tabId: candidateTabId,
            instanceId: ownerInstanceId,
            claimedAt: lease?.instanceId === ownerInstanceId ? lease.claimedAt : nowMs,
            heartbeatAt: nowMs
          };
          store.put({
            key,
            value: nextLease,
            updatedAt: new Date(nowMs).toISOString()
          });
        };

        getReq.onerror = () => {
          decision = 'occupied';
        };

        tx.oncomplete = () => resolve(decision);
        tx.onerror = () => resolve('unavailable');
        tx.onabort = () => resolve('unavailable');
      } catch {
        resolve('unavailable');
      }
    });
  } catch {
    return 'unavailable';
  } finally {
    if (db) {
      try {
        db.close();
      } catch (_) {}
    }
  }
}

async function releaseIdbTabLease(tabIdToRelease: string, ownerInstanceId: string): Promise<void> {
  if (testAdapter?.releaseIdbLease) {
    await testAdapter.releaseIdbLease(tabIdToRelease, ownerInstanceId);
    return;
  }
  if (!tabIdToRelease || typeof indexedDB === 'undefined') return;
  let db: IDBDatabase | null = null;
  try {
    db = await openTabLeaseDb();
    await new Promise<void>((resolve) => {
      try {
        const tx = db!.transaction([TAB_LEASE_STORE_NAME], 'readwrite');
        const store = tx.objectStore(TAB_LEASE_STORE_NAME);
        const key = `${TAB_LEASE_META_PREFIX}${tabIdToRelease}`;
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          const existing = getReq.result as { key: string; value?: TabLeaseRecord } | undefined;
          if (existing?.value?.instanceId === ownerInstanceId) {
            store.delete(key);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // ignore cleanup errors on pagehide
  } finally {
    if (db) {
      try {
        db.close();
      } catch (_) {}
    }
  }
}

function stopIdbLeaseHeartbeat(): void {
  if (idbLeaseHeartbeatTimer) {
    clearInterval(idbLeaseHeartbeatTimer);
    idbLeaseHeartbeatTimer = null;
  }
  if (heldIdbLeaseTabId) {
    const toRelease = heldIdbLeaseTabId;
    heldIdbLeaseTabId = null;
    void releaseIdbTabLease(toRelease, instanceId);
  }
}

function startIdbLeaseHeartbeat(activeTabId: string): void {
  if (heldIdbLeaseTabId && heldIdbLeaseTabId !== activeTabId) {
    void releaseIdbTabLease(heldIdbLeaseTabId, instanceId);
  }
  heldIdbLeaseTabId = activeTabId;
  if (idbLeaseHeartbeatTimer) {
    clearInterval(idbLeaseHeartbeatTimer);
    idbLeaseHeartbeatTimer = null;
  }
  if (typeof window === 'undefined') return;
  idbLeaseHeartbeatTimer = setInterval(() => {
    if (!heldIdbLeaseTabId) return;
    void tryAcquireOrRenewIdbTabLease(heldIdbLeaseTabId, instanceId, Date.now());
  }, TAB_LEASE_HEARTBEAT_MS);
}

function releaseHeldTabIdentityLock(): void {
  if (releaseHeldTabIdentityLockFn) {
    const rel = releaseHeldTabIdentityLockFn;
    releaseHeldTabIdentityLockFn = null;
    heldTabIdentityLockForId = null;
    try {
      rel();
    } catch (_) {}
  }
}

function rotateTabIdOnDuplicate(): string {
  const prev = cachedTabId || '';
  releaseHeldTabIdentityLock();
  stopIdbLeaseHeartbeat();
  const next = generateFreshTabId();
  cachedTabId = next;
  tabIdentityWasPreExistingInSession = false;
  tabIdentitySettlementState = null;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(TAB_ID_STORAGE_KEY, next);
    }
  } catch (_) {}
  postTabSyncMessage({
    type: 'TAB_HELLO',
    tabId: next,
    instanceId,
    sentAt: Date.now()
  });
  tabIdListeners.forEach((cb) => {
    try {
      cb(next, prev);
    } catch (_) {}
  });
  return next;
}

async function ensureExclusiveTabIdentityLock(): Promise<string> {
  const currentId = getOrInitTabId();

  // المسار 1 (الأساسي): Web Locks API
  if (hasAtomicWebLocks()) {
    if (heldTabIdentityLockForId === currentId && releaseHeldTabIdentityLockFn) {
      tabIdentitySettlementState = {
        tabId: currentId,
        isAmbiguous: false,
        mode: 'web-locks'
      };
      return currentId;
    }
    if (tabIdentityLockAcquirePromise) {
      return tabIdentityLockAcquirePromise;
    }

    tabIdentityLockAcquirePromise = (async () => {
      try {
        let candidate = getOrInitTabId();
        for (let attempt = 0; attempt < 4; attempt++) {
          if (heldTabIdentityLockForId === candidate && releaseHeldTabIdentityLockFn) {
            tabIdentitySettlementState = {
              tabId: candidate,
              isAmbiguous: false,
              mode: 'web-locks'
            };
            return candidate;
          }
          let releaseFn: (() => void) | null = null;
          const holdPromise = new Promise<void>((resolve) => {
            releaseFn = resolve;
          });

          const acquired = await new Promise<boolean>((resolve) => {
            let settled = false;
            try {
              navigator.locks
                .request(
                  `mudaqqeq_tab_identity_lock_${candidate}`,
                  { mode: 'exclusive', ifAvailable: true },
                  async (lock) => {
                    if (!lock) {
                      if (!settled) {
                        settled = true;
                        resolve(false);
                      }
                      return;
                    }
                    heldTabIdentityLockForId = candidate;
                    releaseHeldTabIdentityLockFn = releaseFn;
                    if (!settled) {
                      settled = true;
                      resolve(true);
                    }
                    await holdPromise;
                  }
                )
                .catch(() => {
                  if (!settled) {
                    settled = true;
                    resolve(false);
                  }
                });
            } catch {
              if (!settled) {
                settled = true;
                resolve(false);
              }
            }
          });

          if (acquired) {
            tabIdentitySettlementState = {
              tabId: candidate,
              isAmbiguous: false,
              mode: 'web-locks'
            };
            return candidate;
          }
          if (releaseFn) {
            try {
              (releaseFn as () => void)();
            } catch (_) {}
          }
          // القفل ممسوك من التبويب الأصلي الحي (Duplicate Tab): ندوّر المعرّف فوراً بشكل حتمي
          candidate = rotateTabIdOnDuplicate();
        }
        const finalId = getOrInitTabId();
        tabIdentitySettlementState = {
          tabId: finalId,
          isAmbiguous: false,
          mode: 'web-locks'
        };
        return finalId;
      } finally {
        tabIdentityLockAcquirePromise = null;
      }
    })();

    return tabIdentityLockAcquirePromise;
  }

  // المسار 2 (الاحتياطي الآمن عند غياب Web Locks): معاملة IndexedDB ذرية على مخزن meta
  if (heldIdbLeaseTabId === currentId && tabIdentitySettlementState && !tabIdentitySettlementState.isAmbiguous) {
    return currentId;
  }
  if (tabIdentityLockAcquirePromise) {
    return tabIdentityLockAcquirePromise;
  }

  tabIdentityLockAcquirePromise = (async () => {
    try {
      let candidate = getOrInitTabId();
      for (let attempt = 0; attempt < 4; attempt++) {
        const leaseResult = await tryAcquireOrRenewIdbTabLease(candidate, instanceId, Date.now());
        if (leaseResult === 'acquired') {
          startIdbLeaseHeartbeat(candidate);
          tabIdentitySettlementState = {
            tabId: candidate,
            isAmbiguous: false,
            mode: 'indexeddb-lease'
          };
          return candidate;
        }
        if (leaseResult === 'occupied') {
          // التبويب الأصلي حي ويمتلك عقد IndexedDB: ندوّر tabId فوراً لمنع مشاركة المسودة أو idempotencyKey
          candidate = rotateTabIdOnDuplicate();
          continue;
        }
        // leaseResult === 'unavailable': لا يتوفر Web Locks ولا IndexedDB
        break;
      }

      const fallbackId = getOrInitTabId();
      if (!tabIdentityWasPreExistingInSession) {
        // تبويب جديد تمامًا ولّد UUID جديدًا في هذه الجلسة ولم ينسخ sessionStorage
        tabIdentitySettlementState = {
          tabId: fallbackId,
          isAmbiguous: false,
          mode: 'fresh-session'
        };
        return fallbackId;
      }

      // هوية منسوخة/موجودة مسبقًا في sessionStorage ولا تتوفر أي آلية ذرية (لا Web Locks ولا IndexedDB)
      tabIdentitySettlementState = {
        tabId: fallbackId,
        isAmbiguous: true,
        mode: 'ambiguous-blocked',
        reason:
          'تعذر التحقق من استقلال هوية هذا التبويب لأن المتصفح لا يدعم Web Locks ولا قاعدة البيانات المحلية IndexedDB. لمنع تضارب الفواتير أو تكرار المسودات مع تبويب آخر، تم إيقاف شاشة البيع في هذا التبويب. يمكنك فتح شاشة البيع في تبويب جديد مستقل أو تفعيل التخزين المحلي في المتصفح.'
      };
      return fallbackId;
    } finally {
      tabIdentityLockAcquirePromise = null;
    }
  })();

  return tabIdentityLockAcquirePromise;
}

function ensureTabSessionInitialized(): void {
  if (channelInitialized || typeof window === 'undefined') return;
  channelInitialized = true;
  tabHandshakeStartedAt = Date.now();

  if (!cachedTabId) {
    try {
      const existing = window.sessionStorage?.getItem(TAB_ID_STORAGE_KEY)?.trim();
      if (existing) {
        cachedTabId = existing;
        tabIdentityWasPreExistingInSession = true;
      } else {
        cachedTabId = generateFreshTabId();
        tabIdentityWasPreExistingInSession = false;
        window.sessionStorage?.setItem(TAB_ID_STORAGE_KEY, cachedTabId);
      }
    } catch (_) {
      cachedTabId = generateFreshTabId();
      tabIdentityWasPreExistingInSession = false;
    }
  }

  try {
    window.addEventListener('pagehide', () => {
      releaseHeldTabIdentityLock();
      stopIdbLeaseHeartbeat();
      for (const [uKey, held] of Array.from(heldLegacyDraftClaims.entries())) {
        clearLegacyDraftClaim(uKey, held.tabId);
      }
    });
  } catch (_) {}

  const ch = getBroadcastChannel();
  if (ch) {
    ch.onmessage = (event: MessageEvent<TabSyncMessage>) => {
      const msg = event?.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'TAB_HELLO') {
        if (msg.instanceId !== instanceId && msg.tabId && msg.tabId === cachedTabId) {
          postTabSyncMessage({
            type: 'TAB_CLAIMED',
            tabId: cachedTabId,
            ownerInstanceId: instanceId,
            sentAt: Date.now()
          });
        }
        return;
      }

      if (msg.type === 'TAB_CLAIMED') {
        if (msg.ownerInstanceId !== instanceId && msg.tabId && msg.tabId === cachedTabId) {
          rotateTabIdOnDuplicate();
          void ensureExclusiveTabIdentityLock();
        }
        return;
      }

      messageListeners.forEach((cb) => {
        try {
          cb(msg);
        } catch (_) {}
      });
    };

    postTabSyncMessage({
      type: 'TAB_HELLO',
      tabId: cachedTabId,
      instanceId,
      sentAt: Date.now()
    });
  }

  void ensureExclusiveTabIdentityLock();
}

export function getOrInitTabId(): string {
  if (typeof window === 'undefined') {
    if (!cachedTabId) cachedTabId = generateFreshTabId();
    return cachedTabId;
  }
  ensureTabSessionInitialized();
  if (!cachedTabId) {
    cachedTabId = generateFreshTabId();
  }
  return cachedTabId;
}

/**
 * حسم هوية التبويب بشكل ذري:
 * 1. Web Locks API (mudaqqeq_tab_identity_lock_<tabId>) حيث يدعمها المتصفح.
 * 2. معاملة IndexedDB ذرية (readwrite على مخزن meta) كمسار احتياطي آمن لا يعتمد على قفل زائف في localStorage.
 * 3. إذا تعذر حسم هوية موجودة مسبقاً في sessionStorage لغياب الآليتين معاً، تُعلّم الهوية بأنها ملتبسة (isAmbiguous = true).
 */
export async function waitForTabIdentitySettled(): Promise<string> {
  const current = getOrInitTabId();
  if (typeof window === 'undefined') {
    tabIdentitySettlementState = {
      tabId: current,
      isAmbiguous: false,
      mode: 'fresh-session'
    };
    return current;
  }
  void tabHandshakeStartedAt;
  void tabIdentityWasPreExistingInSession;
  return ensureExclusiveTabIdentityLock();
}

export function getTabIdentitySettlement(): TabIdentitySettlement {
  const current = getOrInitTabId();
  if (tabIdentitySettlementState && tabIdentitySettlementState.tabId === current) {
    return tabIdentitySettlementState;
  }
  return {
    tabId: current,
    isAmbiguous: false,
    mode: hasAtomicWebLocks() ? 'web-locks' : 'fresh-session'
  };
}

export function isTabIdentityAmbiguous(): boolean {
  return Boolean(tabIdentitySettlementState?.isAmbiguous);
}

/**
 * تدوير يدوي لهوية التبويب إلى هوية جديدة تماماً (تُستخدم عندما يطلب المستخدم بدء جلسة تبويب جديدة
 * في متصفح قديم تعذر فيه التحقق من الهوية المنسوخة).
 */
export async function forceFreshTabIdentity(): Promise<string> {
  const next = rotateTabIdOnDuplicate();
  tabIdentitySettlementState = {
    tabId: next,
    isAmbiguous: false,
    mode: 'fresh-session'
  };
  await ensureExclusiveTabIdentityLock();
  return getOrInitTabId();
}

export function getTabInstanceId(): string {
  return instanceId;
}

export function readSharedHumanActivity(
  identity?: BoundSessionIdentity | null
): number {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 0;
    const raw = window.localStorage.getItem(LAST_HUMAN_ACTIVITY_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as Partial<SharedHumanActivityRecord>;
    if (!parsed || typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return 0;
    if (identity?.sessionTag && parsed.sessionTag && parsed.sessionTag !== identity.sessionTag) {
      return 0;
    }
    if (identity?.userId && parsed.userId && parsed.userId !== identity.userId) {
      return 0;
    }
    return parsed.at;
  } catch {
    return 0;
  }
}

export function writeSharedHumanActivity(
  at: number,
  identity?: BoundSessionIdentity | null
): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const record: SharedHumanActivityRecord = {
      userId: identity?.userId || '',
      sessionTag: identity?.sessionTag || '',
      at
    };
    window.localStorage.setItem(LAST_HUMAN_ACTIVITY_STORAGE_KEY, JSON.stringify(record));
  } catch (_) {}
}

export function writeSessionMeta(identity: BoundSessionIdentity | null): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!identity || !identity.userId || !identity.sessionTag) {
      window.localStorage.removeItem(SESSION_META_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(SESSION_META_STORAGE_KEY, JSON.stringify(identity));
  } catch (_) {}
}

export function readSessionMeta(): BoundSessionIdentity | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(SESSION_META_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BoundSessionIdentity>;
    if (!parsed?.userId || !parsed?.sessionTag) return null;
    return {
      userId: String(parsed.userId),
      sessionTag: String(parsed.sessionTag)
    };
  } catch {
    return null;
  }
}

export function clearSharedHumanActivity(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LAST_HUMAN_ACTIVITY_STORAGE_KEY);
    }
  } catch (_) {}
}

function bindLegacyClaimPageHide(): void {
  if (legacyClaimPageHideBound || typeof window === 'undefined') return;
  legacyClaimPageHideBound = true;
  try {
    window.addEventListener('pagehide', () => {
      for (const [uKey, held] of Array.from(heldLegacyDraftClaims.entries())) {
        clearLegacyDraftClaim(uKey, held.tabId);
      }
    });
  } catch (_) {}
}

/**
 * مطالبة ذرية حصرية بعرض وترحيل المسودة القديمة المشتركة (بدون tabId) عبر Web Locks API.
 * - لا تعتمد على القراءة بعد الكتابة في localStorage كقفل ذري.
 * - عند غياب Web Locks، يتوقف الترحيل التلقائي بأمان (Fail-Closed -> false) وتبقى المسودة القديمة محفوظة.
 * - يبقى القفل ممسوكاً طوال عرض نافذة الاستعادة، ويتحرر تلقائياً وفوراً عند إغلاق التبويب دون أن يعلق 12 ساعة.
 */
export async function tryClaimLegacyPosDraftPrompt(
  userKey: string,
  tabId: string
): Promise<boolean> {
  if (typeof window === 'undefined' || !window.localStorage || !userKey || !tabId) {
    return false;
  }
  if (!hasAtomicWebLocks()) {
    return false;
  }

  bindLegacyClaimPageHide();

  const existingHeld = heldLegacyDraftClaims.get(userKey);
  if (existingHeld) {
    return existingHeld.tabId === tabId;
  }

  const inflight = pendingLegacyDraftClaims.get(userKey);
  if (inflight) {
    await inflight;
    return heldLegacyDraftClaims.get(userKey)?.tabId === tabId;
  }

  const claimKey = `${LEGACY_DRAFT_CLAIM_PREFIX}${userKey}`;
  const lockName = `mudaqqeq_legacy_draft_lock_${userKey}`;

  const acquirePromise = new Promise<boolean>((resolve) => {
    let settled = false;
    let releaseFn: (() => void) | null = null;
    const holdPromise = new Promise<void>((r) => {
      releaseFn = r;
    });

    try {
      navigator.locks
        .request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
          if (!lock) {
            if (!settled) {
              settled = true;
              resolve(false);
            }
            return;
          }

          heldLegacyDraftClaims.set(userKey, {
            tabId,
            release: () => {
              if (releaseFn) {
                const fn = releaseFn;
                releaseFn = null;
                fn();
              }
            }
          });

          try {
            window.localStorage.setItem(
              claimKey,
              JSON.stringify({ tabId, instanceId, claimedAt: Date.now() })
            );
          } catch (_) {}

          if (!settled) {
            settled = true;
            resolve(true);
          }

          await holdPromise;
        })
        .catch(() => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        });
    } catch {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }
  }).finally(() => {
    pendingLegacyDraftClaims.delete(userKey);
  });

  pendingLegacyDraftClaims.set(userKey, acquirePromise);
  return acquirePromise;
}

export function clearLegacyDraftClaim(userKey: string, expectedOwnerTabId?: string): void {
  const held = heldLegacyDraftClaims.get(userKey);
  if (held) {
    if (expectedOwnerTabId && held.tabId !== expectedOwnerTabId) {
      return;
    }
    heldLegacyDraftClaims.delete(userKey);
    try {
      held.release();
    } catch (_) {}
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const claimKey = `${LEGACY_DRAFT_CLAIM_PREFIX}${userKey}`;
      if (expectedOwnerTabId) {
        const existingRaw = window.localStorage.getItem(claimKey);
        if (existingRaw) {
          const parsed = JSON.parse(existingRaw) as { tabId?: string };
          if (parsed?.tabId && parsed.tabId !== expectedOwnerTabId) {
            return;
          }
        }
      }
      window.localStorage.removeItem(claimKey);
    }
  } catch (_) {}
}

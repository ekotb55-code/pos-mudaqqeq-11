/**
 * قفل ذري حصري للعمل أوفلاين (تبويب واحد فقط يمتلك حق الكتابة والمزامنة أوفلاين)
 * يعتمد على Web Locks API (navigator.locks) ولا يكتفي بـ localStorage وحده.
 * في بيئة المتصفح: إذا لم تتوافر navigator.locks أو كان القفل مملوكًا لتبويب آخر،
 * يُمنع الحفظ والمزامنة أوفلاين بأمان (Fail-Closed).
 */
import { useState, useEffect, useCallback } from 'react';
import { getOrInitTabId, postTabSyncMessage, subscribeTabSyncMessages } from '../utils/tabSession';

export const OFFLINE_PRIMARY_LOCK_NAME = 'mudaqqeq_offline_primary_tab_lock';

export type OfflineLockStatus =
  | 'acquired'
  | 'held_by_other'
  | 'unsupported'
  | 'acquiring'
  | 'non_browser';

export interface OfflineLockSnapshot {
  status: OfflineLockStatus;
  hasOwnership: boolean;
  tabId: string;
  reason?: string;
}

export interface OfflineLockAdapter {
  isBrowserRuntime: () => boolean;
  hasWebLocks: () => boolean;
  requestExclusiveLockIfAvailable: (
    name: string,
    onAcquired: () => Promise<void>
  ) => Promise<boolean>;
}

const defaultAdapter: OfflineLockAdapter = {
  isBrowserRuntime: () => typeof window !== 'undefined',
  hasWebLocks: () =>
    typeof navigator !== 'undefined' &&
    typeof navigator.locks !== 'undefined' &&
    typeof navigator.locks.request === 'function',
  requestExclusiveLockIfAvailable: (name, onAcquired) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      try {
        navigator.locks
          .request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
            if (!lock) {
              if (!settled) {
                settled = true;
                resolve(false);
              }
              return;
            }
            if (!settled) {
              settled = true;
              resolve(true);
            }
            await onAcquired();
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
    })
};

let activeAdapter: OfflineLockAdapter = defaultAdapter;
let lockStatus: OfflineLockStatus =
  typeof window === 'undefined' ? 'non_browser' : 'acquiring';
let releaseHeldLockFn: (() => void) | null = null;
let acquireInFlightPromise: Promise<OfflineLockSnapshot> | null = null;
let unloadBound = false;
const lockSubscribers = new Set<(snap: OfflineLockSnapshot) => void>();

export const OFFLINE_LOCK_BLOCKED_REASON =
  'العمل أوفلاين متاح في تبويب واحد فقط؛ يوجد تبويب آخر نشط يمتلك صلاحية البيع والمزامنة أوفلاين حاليًا. أغلِق التبويب الآخر ثم أعد المحاولة من هنا دون فقدان بيانات السلة.';

export const OFFLINE_LOCK_UNSUPPORTED_REASON =
  'المتصفح أو السياق الحالي لا يدعم أقفال التبويبات الذرية (Web Locks API) المطلوبة لحماية المخزون وصندوق الأوفلاين، لذلك تم إيقاف الكتابة والمزامنة أوفلاين في هذا التبويب بأمان.';

function getSnapshot(): OfflineLockSnapshot {
  const tabId = getOrInitTabId();
  if (!activeAdapter.isBrowserRuntime()) {
    return { status: 'non_browser', hasOwnership: true, tabId };
  }
  if (lockStatus === 'acquired') {
    return { status: 'acquired', hasOwnership: true, tabId };
  }
  if (lockStatus === 'unsupported') {
    return {
      status: 'unsupported',
      hasOwnership: false,
      tabId,
      reason: OFFLINE_LOCK_UNSUPPORTED_REASON
    };
  }
  if (lockStatus === 'held_by_other') {
    return {
      status: 'held_by_other',
      hasOwnership: false,
      tabId,
      reason: OFFLINE_LOCK_BLOCKED_REASON
    };
  }
  return {
    status: lockStatus,
    hasOwnership: false,
    tabId,
    reason: OFFLINE_LOCK_BLOCKED_REASON
  };
}

function notifySubscribers() {
  const snap = getSnapshot();
  lockSubscribers.forEach((cb) => {
    try {
      cb(snap);
    } catch (_) {}
  });
}

function bindUnloadCleanup() {
  if (unloadBound || typeof window === 'undefined') return;
  unloadBound = true;
  window.addEventListener('pagehide', () => {
    releaseOfflineLock();
  });
  subscribeTabSyncMessages((msg) => {
    if (msg.type === 'OFFLINE_LOCK_RELEASED' && lockStatus !== 'acquired') {
      acquireOfflineLock().catch(() => {});
    }
  });
}

export function getOfflineLockSnapshot(): OfflineLockSnapshot {
  return getSnapshot();
}

export function hasOfflineLockOwnership(): boolean {
  if (!activeAdapter.isBrowserRuntime()) {
    return true;
  }
  return lockStatus === 'acquired';
}

export function releaseOfflineLock(): void {
  if (releaseHeldLockFn) {
    const fn = releaseHeldLockFn;
    releaseHeldLockFn = null;
    try {
      fn();
    } catch (_) {}
    if (activeAdapter.isBrowserRuntime()) {
      lockStatus = 'held_by_other';
      postTabSyncMessage({
        type: 'OFFLINE_LOCK_RELEASED',
        sourceTabId: getOrInitTabId(),
        at: Date.now()
      });
      notifySubscribers();
    }
  }
}

export async function acquireOfflineLock(): Promise<OfflineLockSnapshot> {
  if (!activeAdapter.isBrowserRuntime()) {
    lockStatus = 'non_browser';
    return getSnapshot();
  }

  bindUnloadCleanup();

  if (lockStatus === 'acquired' && releaseHeldLockFn) {
    return getSnapshot();
  }

  if (!activeAdapter.hasWebLocks()) {
    lockStatus = 'unsupported';
    notifySubscribers();
    return getSnapshot();
  }

  if (acquireInFlightPromise) {
    return acquireInFlightPromise;
  }

  lockStatus = 'acquiring';
  acquireInFlightPromise = (async () => {
    try {
      let releaseFn: (() => void) | null = null;
      const holdPromise = new Promise<void>((resolve) => {
        releaseFn = resolve;
      });

      const acquired = await activeAdapter.requestExclusiveLockIfAvailable(
        OFFLINE_PRIMARY_LOCK_NAME,
        async () => {
          releaseHeldLockFn = releaseFn;
          await holdPromise;
        }
      );

      if (acquired) {
        lockStatus = 'acquired';
      } else {
        if (releaseFn) {
          releaseFn();
        }
        lockStatus = 'held_by_other';
      }
      notifySubscribers();
      return getSnapshot();
    } finally {
      acquireInFlightPromise = null;
    }
  })();

  return acquireInFlightPromise;
}

/**
 * التحقق الذري الإلزامي قبل أي عملية كتابة في قاعدة الأوفلاين أو مزامنة صندوق الصادر.
 * يُعيد المحاولة لاكتساب القفل إذا لم يكن قد اختُبر بعد؛ وإذا كان مملوكًا لتبويب آخر أو غير مدعوم يرمي خطأ عربيًا واضحًا.
 */
export async function assertOfflineWriteOwnership(): Promise<void> {
  if (!activeAdapter.isBrowserRuntime()) {
    return;
  }
  if (lockStatus === 'acquired' && releaseHeldLockFn) {
    return;
  }
  const snap = await acquireOfflineLock();
  if (!snap.hasOwnership) {
    throw new Error(snap.reason || OFFLINE_LOCK_BLOCKED_REASON);
  }
}

export function subscribeOfflineLock(
  listener: (snap: OfflineLockSnapshot) => void
): () => void {
  lockSubscribers.add(listener);
  return () => {
    lockSubscribers.delete(listener);
  };
}

export function useOfflineLock(): OfflineLockSnapshot & {
  retryAcquireLock: () => Promise<OfflineLockSnapshot>;
} {
  const [snap, setSnap] = useState<OfflineLockSnapshot>(() => getSnapshot());

  useEffect(() => {
    const unsub = subscribeOfflineLock((next) => {
      setSnap(next);
    });
    void acquireOfflineLock().then(setSnap);
    return unsub;
  }, []);

  const retryAcquireLock = useCallback(async () => {
    const next = await acquireOfflineLock();
    setSnap(next);
    return next;
  }, []);

  return {
    ...snap,
    retryAcquireLock
  };
}

/** للاستخدام في الاختبارات الآلية فقط لمحاكاة بيئة متصفح مع أو بدون Web Locks */
export function __setOfflineLockAdapterForTests(adapter: OfflineLockAdapter | null): void {
  releaseOfflineLock();
  activeAdapter = adapter || defaultAdapter;
  lockStatus = activeAdapter.isBrowserRuntime() ? 'acquiring' : 'non_browser';
  acquireInFlightPromise = null;
}

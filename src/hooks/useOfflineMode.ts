import { useState, useEffect, useCallback } from 'react';
import {
  subscribeOfflineDb,
  getOutboxPendingCount,
  getMetaValue,
  ensureDeviceIdentity,
  saveDeviceName,
  syncOutboxOperations,
  OutboxSyncResult,
  SyncedOutboxInvoiceItem
} from '../offline/db';
import { subscribeApiStatus } from '../api/client';
import { hasOfflineLockOwnership, assertOfflineWriteOwnership } from '../offline/offlineLock';
import { UserAccount } from '../types';

export interface OfflineModeState {
  status: 'online' | 'offline';
  online: boolean;
  offline: boolean;
  isOnline: boolean;
  isOffline: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  deviceId: string;
  deviceName: string;
  deviceNameConfigured: boolean;
  storagePersisted: boolean | null;
  isCheckingHealth: boolean;
  isSyncingOutbox: boolean;
  lastOutboxError: string | null;
  checkHealth: () => Promise<boolean>;
  syncNow: () => Promise<OutboxSyncResult>;
  setDeviceName: (newName: string) => Promise<void>;
}

const HEALTH_CHECK_TIMEOUT_MS = 6000;
const HEALTH_POLL_INTERVAL_MS = 20000;

interface SharedOfflineState {
  isOnline: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  deviceId: string;
  deviceName: string;
  deviceNameConfigured: boolean;
  storagePersisted: boolean | null;
  isCheckingHealth: boolean;
  isSyncingOutbox: boolean;
  lastOutboxError: string | null;
}

let sharedState: SharedOfflineState = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pendingCount: 0,
  lastSyncAt: null,
  deviceId: '',
  deviceName: 'نقطة بيع 1',
  deviceNameConfigured: false,
  storagePersisted: null,
  isCheckingHealth: false,
  isSyncingOutbox: false,
  lastOutboxError: null
};

const stateSubscribers = new Set<(state: SharedOfflineState) => void>();
const outboxSyncedSubscribers = new Set<(result: OutboxSyncResult) => void>();

export function subscribeOutboxSynced(listener: (result: OutboxSyncResult) => void): () => void {
  outboxSyncedSubscribers.add(listener);
  return () => {
    outboxSyncedSubscribers.delete(listener);
  };
}

function getCurrentStoredUser(): UserAccount | null {
  try {
    const saved = localStorage.getItem('pos_user');
    const token = localStorage.getItem('pos_token');
    if (saved && token) {
      return JSON.parse(saved) as UserAccount;
    }
  } catch (_) {}
  return null;
}

function updateSharedState(patch: Partial<SharedOfflineState>) {
  const prevOnline = sharedState.isOnline;
  sharedState = { ...sharedState, ...patch };
  stateSubscribers.forEach(sub => {
    try {
      sub(sharedState);
    } catch (_) {}
  });

  // عند رجوع الاتصال من أوفلاين إلى أونلاين ووجود عمليات معلقة، يعمل محرك المزامنة تلقائيًا فقط في التبويب المالك لقفل الأوفلاين
  if (
    !prevOnline &&
    sharedState.isOnline &&
    sharedState.pendingCount > 0 &&
    !sharedState.isSyncingOutbox &&
    hasOfflineLockOwnership()
  ) {
    triggerOutboxSyncNow().catch(() => {});
  }
}

let activeHealthCheckPromise: Promise<boolean> | null = null;

export async function triggerOutboxSyncNow(options?: {
  onOperationSynced?: (item: SyncedOutboxInvoiceItem) => void;
}): Promise<OutboxSyncResult> {
  const user = getCurrentStoredUser();
  try {
    await assertOfflineWriteOwnership();
  } catch (lockErr: any) {
    const msg = lockErr?.message || 'المزامنة متاحة في تبويب واحد فقط';
    updateSharedState({ isSyncingOutbox: false, lastOutboxError: msg });
    return {
      success: false,
      totalProcessed: 0,
      syncedCount: 0,
      failedCount: 1,
      remainingCount: sharedState.pendingCount,
      syncedInvoices: [],
      lastError: msg,
      nextRetryDelayMs: null
    };
  }
  updateSharedState({ isSyncingOutbox: true, lastOutboxError: null });
  try {
    const res = await syncOutboxOperations({
      user,
      onOperationSynced: options?.onOperationSynced
    });
    await refreshOfflineDbMetrics();
    updateSharedState({
      isSyncingOutbox: false,
      lastOutboxError: res.lastError || null
    });
    if (res.syncedCount > 0) {
      outboxSyncedSubscribers.forEach(sub => {
        try {
          sub(res);
        } catch (_) {}
      });
    }
    return res;
  } catch (err: any) {
    const msg = err?.message || 'فشل رفع العمليات المعلّقة';
    updateSharedState({ isSyncingOutbox: false, lastOutboxError: msg });
    return {
      success: false,
      totalProcessed: 0,
      syncedCount: 0,
      failedCount: 1,
      remainingCount: sharedState.pendingCount,
      syncedInvoices: [],
      lastError: msg,
      nextRetryDelayMs: null
    };
  }
}

/**
 * فحص الاتصال الفعلي عبر /api/health وليس navigator.onLine وحده
 */
export async function probeApiHealth(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    updateSharedState({ isOnline: false, isCheckingHealth: false });
    return false;
  }

  if (activeHealthCheckPromise) {
    return activeHealthCheckPromise;
  }

  updateSharedState({ isCheckingHealth: true });

  activeHealthCheckPromise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    try {
      const res = await fetch('/api/health', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });

      if (!res.ok) {
        updateSharedState({ isOnline: false, isCheckingHealth: false });
        return false;
      }

      const data = await res.json().catch(() => null);
      if (!data || data.success !== true) {
        updateSharedState({ isOnline: false, isCheckingHealth: false });
        return false;
      }

      // في وضع Google Sheets إذا كان الاتصال بقاعدة البيانات مقطوعًا نعتبر الاتصال غير متاح للعمليات الحية
      const sheetsBroken =
        data.dataMode === 'sheets' && data.connectionHealth && data.connectionHealth.healthy === false;
      const healthyOnline = !sheetsBroken;

      updateSharedState({ isOnline: healthyOnline, isCheckingHealth: false });
      if (
        healthyOnline &&
        sharedState.pendingCount > 0 &&
        !sharedState.isSyncingOutbox &&
        hasOfflineLockOwnership()
      ) {
        triggerOutboxSyncNow().catch(() => {});
      }
      return healthyOnline;
    } catch (_) {
      updateSharedState({ isOnline: false, isCheckingHealth: false });
      return false;
    } finally {
      window.clearTimeout(timer);
      activeHealthCheckPromise = null;
    }
  })();

  return activeHealthCheckPromise;
}

async function refreshOfflineDbMetrics() {
  try {
    const [pendingCount, lastSyncAt, identity, storagePersisted] = await Promise.all([
      getOutboxPendingCount(),
      getMetaValue<string>('lastSyncAt'),
      ensureDeviceIdentity(),
      getMetaValue<boolean>('storagePersisted')
    ]);

    updateSharedState({
      pendingCount,
      lastSyncAt: lastSyncAt || null,
      deviceId: identity.deviceId,
      deviceName: identity.deviceName,
      deviceNameConfigured: identity.deviceNameConfigured,
      storagePersisted: storagePersisted !== null ? Boolean(storagePersisted) : null
    });
  } catch (_) {}
}

let listenersInitialized = false;

function initGlobalOfflineListeners() {
  if (listenersInitialized || typeof window === 'undefined') return;
  listenersInitialized = true;

  // تحميل القيم الأولية من IndexedDB وفحص /api/health فورًا
  refreshOfflineDbMetrics().then(() => {
    probeApiHealth();
  });

  window.addEventListener('online', () => {
    probeApiHealth();
  });

  window.addEventListener('offline', () => {
    updateSharedState({ isOnline: false });
  });

  subscribeOfflineDb(() => {
    refreshOfflineDbMetrics();
  });

  subscribeApiStatus(event => {
    if (event.type === 'SHEETS_ERROR') {
      probeApiHealth();
    } else if (event.type === 'LIVE_DATA') {
      updateSharedState({ isOnline: true });
    }
  });

  window.setInterval(() => {
    probeApiHealth();
  }, HEALTH_POLL_INTERVAL_MS);
}

/**
 * خطاف موحّد useOfflineMode يرجع حالة online / offline من فحص /api/health
 * مع عدد العمليات المعلّقة في outbox وبيانات الجهاز وآخر مزامنة ومحرك المزامنة.
 */
export function useOfflineMode(): OfflineModeState {
  const [state, setState] = useState<SharedOfflineState>(() => {
    initGlobalOfflineListeners();
    return sharedState;
  });

  useEffect(() => {
    initGlobalOfflineListeners();
    const listener = (next: SharedOfflineState) => setState(next);
    stateSubscribers.add(listener);
    // تحديث فوري عند تركيب المكون
    setState(sharedState);
    return () => {
      stateSubscribers.delete(listener);
    };
  }, []);

  const checkHealth = useCallback(async () => {
    return probeApiHealth();
  }, []);

  const syncNow = useCallback(async () => {
    return triggerOutboxSyncNow();
  }, []);

  const handleSetDeviceName = useCallback(async (newName: string) => {
    const updated = await saveDeviceName(newName);
    updateSharedState({
      deviceId: updated.deviceId,
      deviceName: updated.deviceName,
      deviceNameConfigured: true
    });
  }, []);

  return {
    status: state.isOnline ? 'online' : 'offline',
    online: state.isOnline,
    offline: !state.isOnline,
    isOnline: state.isOnline,
    isOffline: !state.isOnline,
    pendingCount: state.pendingCount,
    lastSyncAt: state.lastSyncAt,
    deviceId: state.deviceId,
    deviceName: state.deviceName,
    deviceNameConfigured: state.deviceNameConfigured,
    storagePersisted: state.storagePersisted,
    isCheckingHealth: state.isCheckingHealth,
    isSyncingOutbox: state.isSyncingOutbox,
    lastOutboxError: state.lastOutboxError,
    checkHealth,
    syncNow,
    setDeviceName: handleSetDeviceName
  };
}

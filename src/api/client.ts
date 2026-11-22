import {
  Item,
  Platform,
  ItemPlatformCost,
  Invoice,
  ReturnRecord,
  SystemConfig,
  DataMode,
  ConnectionHealth,
  ReportsData,
  UserAccount,
  AuthSession,
  PermissionKey,
  PermissionDefinition,
  CompanySettings,
  ContactSettings,
  InvoicePrintSettings,
  DisplaySettings,
  TaxSettings,
  StockSettings,
  AuditLogEntry,
  ItemChangeLogEntry,
  StockMovement,
  ImportBatch,
  Supplier,
  SupplierGroup,
  PurchaseInvoice,
  PurchaseReturn,
  SupplierLedgerEntry,
  Customer,
  CustomerGroup,
  CustomerLedgerEntry,
  Cashbox,
  DashboardCashbox,
  CashboxTransaction,
  CashboxTransfer,
  UserCashboxAssignment,
  ReconciliationItem,
  ProductCategory,
  ItemMovementReport,
  StockAdjustmentsReport,
  BnplReport,
  PlatformReport,
  PartyLedgerEntry,
  CollectCreditPayload,
  CollectCreditResult,
  BulkEditOperationType,
  BulkEditPriceOperationType,
  BulkEditExcelPreviewRow,
  BulkEditExcelPreviewResult,
  BulkEditExcelExecuteResult,
  BulkEditUndoStatus,
  BulkEditUndoResult,
  Warehouse,
  WarehouseItemBreakdown,
  UserWarehouseConfig,
  UserWarehousesResponse,
  WarehouseDispatchOrder,
  WarehouseTransferInsufficientItem,
  UnsoldCartItemsReport,
  BankLinkTemplate,
  BankLinkTemplateDirection,
  BankLinkMessageReading,
  BankLinkOverviewResponse,
  ManualBalanceRequest,
  ManualBalanceAlert,
  ManualBalanceEntry,
  ManualBalanceRequestsResponse,
  ManualBalanceOverviewResponse,
  VisitorSlide,
  VisitorDisplaySettings,
  VisitorProduct,
  ImagesStorageStatus,
  ImagesMigrationResult,
  DeliveryMode,
  DeliveryPrepSlipSettings,
  DeliveryZone,
  DeliveryDriver,
  DeliveryCourier,
  DeliverySettingsResponse,
  DeliverySettingsSaveResponse,
  DeliveryMasterSaveResponse,
  DeliveryConfigResponse,
  DeliveryOrdersListParams,
  DeliveryOrdersListResponse,
  DeliveryAssignOrderPayload,
  DeliveryAssignOrderResponse,
  DeliveryChangeOrderStatusPayload,
  DeliveryChangeOrderStatusResponse,
  DeliveryAssigneeType,
  DeliverySettlementPreviewResponse,
  DeliverySettlePayload,
  DeliverySettleResponse,
  DeliverySettlementsListParams,
  DeliverySettlementsListResponse,
  DeliveryDriverDuesResponse,
  DeliveryPayoutPreviewParams,
  DeliveryPayoutPreviewResponse,
  DeliveryPayoutPayload,
  DeliveryPayoutResponse,
  DeliveryMyOrdersResponse,
  DeliveryDriverUpdateStatusPayload,
  DeliveryDriverUpdateStatusResponse,
  DeliveryReportsParams,
  DeliveryReportsResponse,
  ActiveUserSessionInfo,
  InactivityTimeoutMinutes
} from '../types';
import type { LabelSettings } from '../utils/labelPrint';
import {
  BoundSessionIdentity,
  LAST_HUMAN_ACTIVITY_STORAGE_KEY,
  computeSessionTag,
  postTabSyncMessage,
  readSharedHumanActivity,
  subscribeTabSyncMessages,
  writeSharedHumanActivity
} from '../utils/tabSession';

function toCairoDateBoundaryIso(dateStr: string, bound: 'start' | 'end'): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  try {
    const probe = new Date(`${dateStr}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      timeZoneName: 'shortOffset',
      year: 'numeric'
    }).formatToParts(probe);
    const tzVal = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+2';
    const match = tzVal.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    const sign = match?.[1] || '+';
    const hh = String(match?.[2] || '2').padStart(2, '0');
    const mm = String(match?.[3] || '0').padStart(2, '0');
    const offset = `${sign}${hh}:${mm}`;
    return bound === 'start'
      ? new Date(`${dateStr}T00:00:00.000${offset}`).toISOString()
      : new Date(`${dateStr}T23:59:59.999${offset}`).toISOString();
  } catch {
    return bound === 'start' ? `${dateStr}T00:00:00.000Z` : `${dateStr}T23:59:59.999Z`;
  }
}

export interface DatabaseSetupCheckItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface DatabaseCheckResult {
  connected: boolean;
  initialized: boolean;
  latencyMs: number;
  message: string;
  items: DatabaseSetupCheckItem[];
}

export interface DatabasePublicStatusResponse {
  success: boolean;
  configured: boolean;
  ready: boolean;
  needsSetup: boolean;
  check?: DatabaseCheckResult | null;
  sqlEditorUrl?: string;
}

export interface BackupMetaInfo {
  lastBackupAt: string;
  lastBackupBy: string;
  lastRestoreAt: string;
  lastRestoreBy: string;
  lastRestoreFromBackupAt: string;
}

export interface BackupSummaryInfo {
  format: string;
  version: number;
  createdAt: string;
  tenant: string;
  createdBy: string;
  storeName: string;
  totalRecords: number;
  counts: Record<string, number>;
}

export interface SystemResetMetaInfo {
  lastResetAt: string;
  lastResetType: '' | 'operations' | 'factory';
  lastResetBy: string;
}

export interface SystemResetStatusResponse {
  success: boolean;
  reset: SystemResetMetaInfo;
  canResetOperations: boolean;
  canFactoryReset: boolean;
  phrases: {
    operations: string;
    factory: string;
  };
  unclassifiedCollections?: string[];
}

export interface SystemResetResult {
  success: boolean;
  cleared?: Record<string, number>;
  totalCleared?: number;
  keptUsers?: Array<{ id: string; username: string; name: string; role: string }>;
  error?: string;
}

export interface DatabaseStatusResponse {
  success: boolean;
  persistenceMode: 'supabase' | 'none';
  tenant: string;
  target: { host: string; projectRef: string; sqlEditorUrl: string };
  status: {
    enabled: boolean;
    ready?: boolean;
    tenant?: string;
    generation?: number;
    documents?: number;
    lastLoadAt?: string | null;
    lastPersistAt?: string | null;
    lastError?: string | null;
    lastErrorAt?: string | null;
  };
  backup: BackupMetaInfo;
  requiredEnvNames: string[];
}

export type ApiStatusEvent =
  | { type: 'SHEETS_ERROR'; code: 'SHEETS_UNAVAILABLE' | 'UNKNOWN_RESULT'; message: string }
  | { type: 'STALE_DATA'; lastSyncAt?: string }
  | { type: 'LIVE_DATA' }
  | { type: 'BALANCE_REQUIRED'; accountId?: string; message: string }
  | { type: 'MANUAL_BALANCE_UPDATED' };

type ApiStatusListener = (event: ApiStatusEvent) => void;
const apiStatusListeners = new Set<ApiStatusListener>();

export function subscribeApiStatus(listener: ApiStatusListener): () => void {
  apiStatusListeners.add(listener);
  return () => {
    apiStatusListeners.delete(listener);
  };
}

function emitApiStatus(event: ApiStatusEvent) {
  apiStatusListeners.forEach(listener => {
    try {
      listener(event);
    } catch (_) {}
  });
}

export function notifyManualBalanceUpdated(): void {
  emitApiStatus({ type: 'MANUAL_BALANCE_UPDATED' });
}

let sessionExpiredHandler: ((message?: string) => void) | null = null;
let sessionMismatchHandler: ((message: string) => void) | null = null;
let boundSessionIdentity: BoundSessionIdentity | null = null;

export function setOnSessionExpired(handler: (message?: string) => void) {
  sessionExpiredHandler = handler;
}

export function setOnSessionMismatch(handler: ((message: string) => void) | null) {
  sessionMismatchHandler = handler;
}

export function setBoundSessionIdentity(identity: BoundSessionIdentity | null): void {
  boundSessionIdentity = identity && identity.userId && identity.sessionTag ? identity : null;
}

export function getBoundSessionIdentity(): BoundSessionIdentity | null {
  return boundSessionIdentity;
}

let lastDomUserInteractionAt = Date.now();
let lastForegroundApiActivitySentAt = 0;
let lastSharedActivityPersistAt = 0;

export function getLastUserInteractionAt(): number {
  const sharedAt = readSharedHumanActivity(boundSessionIdentity);
  return sharedAt > lastDomUserInteractionAt ? sharedAt : lastDomUserInteractionAt;
}

export function getLastLocalDomInteractionAt(): number {
  return lastDomUserInteractionAt;
}

export function getLastForegroundApiActivitySentAt(): number {
  return lastForegroundApiActivitySentAt;
}

function broadcastHumanInteraction(at: number): void {
  if (!boundSessionIdentity) return;
  if (at - lastSharedActivityPersistAt < 1000) return;
  lastSharedActivityPersistAt = at;
  writeSharedHumanActivity(at, boundSessionIdentity);
  postTabSyncMessage({
    type: 'USER_ACTIVITY',
    userId: boundSessionIdentity.userId,
    sessionTag: boundSessionIdentity.sessionTag,
    at
  });
}

export function recordUserInteraction(): void {
  const now = Date.now();
  lastDomUserInteractionAt = now;
  broadcastHumanInteraction(now);
}

/**
 * التحقق قبل أي طلب مصادَق عليه من تطابق هوية الجلسة المخزنة مع الجلسة المربوطة بالتبويب
 * حتى لا يرسل تبويب قديم طلبًا برمز مستخدم آخر بعد تبديل الحساب أو الخروج في تبويب آخر.
 */
export function assertBoundSessionMatches(): void {
  if (!boundSessionIdentity) return;
  if (typeof localStorage === 'undefined') return;
  const currentToken = localStorage.getItem('pos_token');
  const rawUser = localStorage.getItem('pos_user');
  let currentUserId = '';
  if (rawUser) {
    try {
      const parsed = JSON.parse(rawUser);
      currentUserId = String(parsed?.id || '');
    } catch (_) {}
  }

  if (!currentToken || !currentUserId) {
    const msg = 'انتهت الجلسة في تبويب آخر؛ يرجى تسجيل الدخول مجددًا.';
    if (sessionMismatchHandler) {
      sessionMismatchHandler(msg);
    } else if (sessionExpiredHandler) {
      sessionExpiredHandler(msg);
    }
    const err = new Error(msg);
    (err as any).status = 401;
    (err as any).code = 'SESSION_MISMATCH';
    throw err;
  }

  const currentTag = computeSessionTag(currentToken, currentUserId);
  if (
    currentUserId !== boundSessionIdentity.userId ||
    currentTag !== boundSessionIdentity.sessionTag
  ) {
    const msg = 'تم تبديل الحساب أو الجلسة في تبويب آخر؛ لحماية البيانات تم إيقاف الطلب من هذا التبويب. أعد تحميل الصفحة للمتابعة بالجلسة الحالية.';
    if (sessionMismatchHandler) {
      sessionMismatchHandler(msg);
    } else if (sessionExpiredHandler) {
      sessionExpiredHandler(msg);
    }
    const err = new Error(msg);
    (err as any).status = 401;
    (err as any).code = 'SESSION_MISMATCH';
    throw err;
  }
}

if (typeof window !== 'undefined') {
  const onDomInteraction = () => {
    const now = Date.now();
    lastDomUserInteractionAt = now;
    broadcastHumanInteraction(now);
  };
  window.addEventListener('pointerdown', onDomInteraction, { passive: true });
  window.addEventListener('keydown', onDomInteraction, { passive: true });
  window.addEventListener('touchstart', onDomInteraction, { passive: true });
  window.addEventListener('wheel', onDomInteraction, { passive: true });
  window.addEventListener('click', onDomInteraction, { passive: true });

  window.addEventListener('storage', (e) => {
    if (e.key === LAST_HUMAN_ACTIVITY_STORAGE_KEY && e.newValue) {
      readSharedHumanActivity(boundSessionIdentity);
    }
  });

  subscribeTabSyncMessages((msg) => {
    if (msg.type === 'USER_ACTIVITY' && boundSessionIdentity) {
      if (
        msg.userId === boundSessionIdentity.userId &&
        msg.sessionTag === boundSessionIdentity.sessionTag &&
        msg.at > lastSharedActivityPersistAt
      ) {
        lastSharedActivityPersistAt = msg.at;
      }
    }
  });
}

function getClientDeviceInfo(): { deviceName: string; deviceId: string } {
  let deviceName = '';
  let deviceId = '';
  try {
    deviceName = (localStorage.getItem('mudaqqeq_device_name_v1') || '').trim();
    deviceId = (localStorage.getItem('mudaqqeq_device_id_v1') || '').trim();
  } catch (_) {}

  if (!deviceName && typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    let browser = 'متصفح';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
    else if (/Chrome\//i.test(ua)) browser = 'Chrome';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';
    else if (/Safari\//i.test(ua)) browser = 'Safari';

    let os = '';
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/Mac OS X|Macintosh/i.test(ua)) os = 'Mac';
    else if (/Linux/i.test(ua)) os = 'Linux';
    deviceName = os ? `${browser} على ${os}` : browser;
  }

  return { deviceName: deviceName || 'متصفح ويب', deviceId };
}

function getAuthToken(): string | null {
  return localStorage.getItem('pos_token');
}

export function setAuthToken(token: string | null) {
  if (token) {
    localStorage.setItem('pos_token', token);
  } else {
    localStorage.removeItem('pos_token');
  }
}

const REQUEST_TIMEOUT_MS = 25000;

async function runWithTimeout<T>(
  externalSignal: AbortSignal | null | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fn(controller.signal);
  } catch (err: any) {
    if (timedOut || (err?.name === 'AbortError' && !externalSignal?.aborted)) {
      const timeoutErr = new Error('انتهت مهلة الاتصال');
      (timeoutErr as any).code = 'TIMEOUT';
      (timeoutErr as any).isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

async function request<T>(endpoint: string, options: RequestInit & { background?: boolean } = {}): Promise<T> {
  const isUnboundAuthOrHealthEndpoint =
    endpoint.startsWith('/api/auth/login') ||
    endpoint.startsWith('/api/auth/logout') ||
    endpoint.startsWith('/api/auth/setup-status') ||
    endpoint.startsWith('/api/auth/setup-designer-local') ||
    endpoint.startsWith('/api/health') ||
    endpoint.startsWith('/api/database/public-status');

  if (!isUnboundAuthOrHealthEndpoint) {
    assertBoundSessionMatches();
  }

  const token = getAuthToken();
  const { background, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(fetchOptions.headers as Record<string, string> || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const { deviceName, deviceId } = getClientDeviceInfo();
  if (deviceName && !headers['X-Device-Name']) {
    headers['X-Device-Name'] = encodeURIComponent(deviceName);
  }
  if (deviceId && !headers['X-Device-Id']) {
    headers['X-Device-Id'] = encodeURIComponent(deviceId);
  }

  const isBackgroundRequest =
    Boolean(background) ||
    headers['X-Background-Poll'] === '1' ||
    endpoint.startsWith('/api/health');

  if (isBackgroundRequest) {
    headers['X-Background-Poll'] = '1';
    headers['X-User-Activity'] = '0';
  } else {
    const now = Date.now();
    const isRecentLocalInteraction = now - lastDomUserInteractionAt < 60_000;
    const isMutation = Boolean(
      fetchOptions.method &&
      fetchOptions.method !== 'GET' &&
      fetchOptions.method !== 'HEAD' &&
      endpoint !== '/api/auth/activity'
    );
    if (isRecentLocalInteraction || isMutation || endpoint === '/api/auth/activity') {
      headers['X-User-Activity'] = '1';
      lastForegroundApiActivitySentAt = now;
    }
  }

  if (fetchOptions.body && typeof fetchOptions.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return runWithTimeout<T>(fetchOptions.signal, async (signal) => {
    const res = await fetch(endpoint, {
      ...fetchOptions,
      headers,
      signal
    });

  if (res.status === 401) {
    let errJson: any = null;
    try { errJson = await res.json(); } catch (_) {}
    const errMessage = errJson?.error || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا';
    const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!isBrowserOffline && !endpoint.startsWith('/api/auth/login') && sessionExpiredHandler) {
      sessionExpiredHandler(errMessage);
    }
    const err = new Error(errMessage);
    (err as any).status = 401;
    (err as any).code = errJson?.code;
    throw err;
  }

  if (!res.ok) {
    let errMessage = 'حدث خطأ في استجابة الخادم';
    let errCode: string | undefined;
    let errAccountId: string | undefined;
    try {
      const errorData = await res.json();
      if (errorData?.error) errMessage = errorData.error;
      if (errorData?.code) errCode = errorData.code;
      if (errorData?.accountId) errAccountId = String(errorData.accountId);
    } catch (_) {}
    if (res.status === 423 && errCode === 'BALANCE_REQUIRED') {
      emitApiStatus({
        type: 'BALANCE_REQUIRED',
        accountId: errAccountId,
        message: errMessage
      });
      const err = new Error(errMessage);
      (err as any).status = 423;
      (err as any).code = 'BALANCE_REQUIRED';
      (err as any).accountId = errAccountId;
      throw err;
    }
    if (errCode === 'SHEETS_UNAVAILABLE' || errCode === 'UNKNOWN_RESULT' || res.status === 503 || res.status === 504) {
      emitApiStatus({
        type: 'SHEETS_ERROR',
        code: errCode === 'UNKNOWN_RESULT' || res.status === 504 ? 'UNKNOWN_RESULT' : 'SHEETS_UNAVAILABLE',
        message: errMessage
      });
    }
    const err = new Error(errMessage);
    (err as any).status = res.status;
    (err as any).code = errCode;
    throw err;
  }

  const data: any = await res.json();
  if (data && (data.code === 'SHEETS_UNAVAILABLE' || data.code === 'UNKNOWN_RESULT')) {
    emitApiStatus({
      type: 'SHEETS_ERROR',
      code: data.code,
      message: data.error || 'تعذر الاتصال بقاعدة البيانات'
    });
  } else if (data && data.stale) {
    emitApiStatus({
      type: 'STALE_DATA',
      lastSyncAt: data.lastSyncAt
    });
  } else if (
    data &&
    data.success === true &&
    !endpoint.startsWith('/api/health') &&
    !endpoint.startsWith('/api/config') &&
    !endpoint.startsWith('/api/permissions')
  ) {
    emitApiStatus({ type: 'LIVE_DATA' });
  }

    return data as T;
  });
}

/** نتيجة ربط الصور بالأصناف (/api/items/images/set) */
export interface ItemImagesSetResponse {
  success: boolean;
  error?: string;
  results: { key: string; status: 'updated' | 'skipped' | 'error'; itemId?: string; itemName?: string; error?: string }[];
  updated: number;
  skipped: number;
  failed: number;
}

export const api = {
  // Config, Health & Sheets Setup
  async getHealth(): Promise<{
    success: boolean;
    status: 'ok' | 'degraded';
    dataMode: DataMode;
    persistenceMode?: 'supabase' | 'none';
    persistence?: {
      enabled: boolean;
      ready?: boolean;
      tenant?: string;
      generation?: number;
      documents?: number;
      lastLoadAt?: string | null;
      lastPersistAt?: string | null;
      lastError?: string | null;
      lastErrorAt?: string | null;
    };
    isGoogleSheetsConnected: boolean;
    connectionHealth: ConnectionHealth;
    timestamp: string;
  }> {
    return request('/api/health', { background: true });
  },

  async getConfig(): Promise<SystemConfig & { persistenceMode?: 'supabase' | 'none' }> {
    return request<SystemConfig & { persistenceMode?: 'supabase' | 'none' }>('/api/config');
  },

  async updateConfig(appsScriptUrl: string): Promise<{ success: boolean; config: SystemConfig }> {
    return request('/api/config', {
      method: 'POST',
      body: JSON.stringify({ appsScriptUrl })
    });
  },

  async testConnection(appsScriptUrl?: string): Promise<{
    success: boolean;
    message?: string;
    error?: string;
    dataMode?: DataMode;
    connectionHealth?: ConnectionHealth;
  }> {
    return request('/api/sheets/test-connection', {
      method: 'POST',
      body: JSON.stringify({ appsScriptUrl })
    });
  },

  async setupSheets(appsScriptUrl?: string): Promise<{ success: boolean; message?: string; error?: string; details?: string[] }> {
    return request('/api/sheets/setup', {
      method: 'POST',
      body: JSON.stringify({ appsScriptUrl })
    });
  },

  // Database & Backup APIs
  async getDatabasePublicStatus(): Promise<DatabasePublicStatusResponse> {
    return request<DatabasePublicStatusResponse>('/api/database/public-status');
  },

  async getDatabaseSetupSql(): Promise<string> {
    assertBoundSessionMatches();
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return runWithTimeout(undefined, async (signal) => {
      const res = await fetch('/api/database/setup-sql', {
        method: 'GET',
        headers,
        signal
      });
      if (!res.ok) {
        let errMessage = 'تعذر قراءة كود التهيئة';
        try {
          const errData = await res.json();
          if (errData?.error) errMessage = errData.error;
        } catch (_) {}
        throw new Error(errMessage);
      }
      return await res.text();
    });
  },

  async getDatabaseStatus(): Promise<DatabaseStatusResponse> {
    return request<DatabaseStatusResponse>('/api/database/status');
  },

  async checkDatabase(): Promise<{
    success: boolean;
    configured: boolean;
    check?: DatabaseCheckResult | null;
    message?: string;
  }> {
    return request('/api/database/check', {
      method: 'POST',
      body: JSON.stringify({})
    });
  },

  async getBackupStatus(): Promise<{
    success: boolean;
    backup: BackupMetaInfo;
    tenant: string;
    persistenceMode: 'supabase' | 'none';
  }> {
    return request('/api/backup/status');
  },

  async exportBackup(): Promise<{ blob: Blob; fileName: string }> {
    assertBoundSessionMatches();
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return runWithTimeout(undefined, async (signal) => {
      const res = await fetch('/api/backup/export', {
        method: 'GET',
        headers,
        signal
      });
      if (res.status === 401) {
        let errJson: any = null;
        try { errJson = await res.json(); } catch (_) {}
        if (sessionExpiredHandler) sessionExpiredHandler();
        throw new Error(errJson?.error || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا');
      }
      if (!res.ok) {
        let errMessage = 'تعذر إنشاء النسخة الاحتياطية';
        try {
          const errData = await res.json();
          if (errData?.error) errMessage = errData.error;
        } catch (_) {}
        throw new Error(errMessage);
      }
      const headerName = res.headers.get('X-Backup-File-Name') || res.headers.get('x-backup-file-name');
      let fileName = headerName || '';
      if (!fileName) {
        const disposition = res.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        fileName = match?.[1] || `mudaqqeq-backup-${Date.now()}.json.gz`;
      }
      const blob = await res.blob();
      return { blob, fileName };
    });
  },

  async inspectBackup(fileBase64: string): Promise<{
    success: boolean;
    summary: BackupSummaryInfo;
    currentTenant: string;
    tenantMismatch: boolean;
  }> {
    return request('/api/backup/inspect', {
      method: 'POST',
      body: JSON.stringify({ fileBase64 })
    });
  },

  async restoreBackup(payload: {
    fileBase64: string;
    password: string;
    confirmText: string;
  }): Promise<{
    success: boolean;
    summary: BackupSummaryInfo;
    restored: Record<string, number>;
    totalRecords: number;
    ignored: string[];
    missing: string[];
  }> {
    return request('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // System Reset APIs
  async getResetStatus(): Promise<SystemResetStatusResponse> {
    return request<SystemResetStatusResponse>('/api/system/reset-status');
  },

  async resetOperations(payload: {
    password: string;
    confirmText: string;
  }): Promise<SystemResetResult> {
    return request<SystemResetResult>('/api/system/reset-operations', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async factoryReset(payload: {
    password: string;
    confirmText: string;
  }): Promise<SystemResetResult> {
    return request<SystemResetResult>('/api/system/factory-reset', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // Auth & Session
  async checkSetupStatus(): Promise<{ success: boolean; hasManager: boolean; hasOwner?: boolean }> {
    return request('/api/auth/setup-status');
  },

  async login(username: string, password: string): Promise<AuthSession> {
    const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (isBrowserOffline) {
      const { authenticateOfflineUser } = await import('../offline/db');
      const offlineAuth = await authenticateOfflineUser(username, password);
      if (!offlineAuth.success) {
        throw new Error((offlineAuth as any).error || 'فشل تسجيل الدخول بدون إنترنت');
      }
      if (offlineAuth.session.token) {
        setAuthToken(offlineAuth.session.token);
      }
      return offlineAuth.session;
    }

    try {
      const res = await request<AuthSession>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      if (res.token) {
        setAuthToken(res.token);
      }
      return res;
    } catch (err: any) {
      const isHttpAuthFailure =
        err?.status === 400 || err?.status === 401 || err?.status === 403 || err?.status === 429;
      if (isHttpAuthFailure) {
        throw err;
      }
      // في حال انقطاع الشبكة أو تعذر الاتصال بالخادم، نلجأ للتحقق أوفلاين من مخزن users المشفر
      const { authenticateOfflineUser } = await import('../offline/db');
      const offlineAuth = await authenticateOfflineUser(username, password);
      if (!offlineAuth.success) {
        throw new Error((offlineAuth as any).error || 'فشل تسجيل الدخول بدون إنترنت');
      }
      if (offlineAuth.session.token) {
        setAuthToken(offlineAuth.session.token);
      }
      return offlineAuth.session;
    }
  },

  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      setAuthToken(null);
    }
  },

  async getMe(options?: { background?: boolean }): Promise<{
    success: boolean;
    user: UserAccount;
    sessionId?: string;
    lastActivityAt?: string;
    inactivityTimeoutMinutes?: InactivityTimeoutMinutes;
    expiresAt: number;
  }> {
    return request('/api/auth/me', { background: options?.background });
  },

  async pingActivity(): Promise<{
    success: boolean;
    lastActivityAt: string;
    inactivityTimeoutMinutes: InactivityTimeoutMinutes;
  }> {
    return request('/api/auth/activity', {
      method: 'POST',
      body: JSON.stringify(getClientDeviceInfo())
    });
  },

  async completeInitialAccountSetup(payload: {
    name: string;
    username: string;
    newPassword: string;
  }): Promise<{ success: boolean; user?: UserAccount; error?: string }> {
    return request('/api/auth/complete-initial-setup', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async changeOwnPassword(payload: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ success: boolean; message?: string; error?: string }> {
    return request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async getPublicContactSettings(): Promise<ContactSettings> {
    return request<ContactSettings>('/api/public/contact-settings');
  },

  // Sync Data
  async syncAll(): Promise<{ success: boolean; source: string; hasManager: boolean; data: any; stale?: boolean; lastSyncAt?: string }> {
    return request('/api/sync');
  },

  // Items
  async getItems(options?: { background?: boolean }): Promise<{ success: boolean; items: Item[] }> {
    return request('/api/items', { background: options?.background });
  },

  async getItemsPaginated(params: {
    page?: number;
    search?: string;
    barcodeOnly?: boolean;
    categoryId?: string;
    supplier?: string;
    stockStatus?: string;
    status?: string;
    platformId?: string;
    warehouseId?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc' | string;
  } = {}): Promise<{
    success: boolean;
    items: Item[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    warehouseId?: string;
    totals: {
      itemsCount: number;
      totalPieces: number;
      totalSaleValue: number;
      totalPurchaseValue?: number;
    };
    error?: string;
  }> {
    const qs = new URLSearchParams();
    if (params.page !== undefined) qs.set('page', String(params.page));
    if (params.search && params.search.trim()) qs.set('search', params.search.trim());
    if (params.barcodeOnly) qs.set('barcodeOnly', 'true');
    if (params.categoryId && params.categoryId !== 'ALL') qs.set('categoryId', params.categoryId);
    if (params.supplier && params.supplier !== 'ALL') qs.set('supplier', params.supplier);
    if (params.stockStatus && params.stockStatus !== 'ALL') qs.set('stockStatus', params.stockStatus);
    if (params.status && params.status !== 'ALL') qs.set('status', params.status);
    if (params.platformId && params.platformId !== 'ALL') qs.set('platformId', params.platformId);
    if (params.warehouseId && params.warehouseId.trim()) qs.set('warehouseId', params.warehouseId.trim());
    if (params.sortBy && params.sortBy.trim()) qs.set('sortBy', params.sortBy.trim());
    if (params.sortDir && params.sortDir.trim()) qs.set('sortDir', params.sortDir.trim());
    const queryString = qs.toString();
    return request(`/api/items/paginated${queryString ? `?${queryString}` : ''}`);
  },

  // Warehouses
  async getWarehouses(): Promise<{ success: boolean; warehouses: Warehouse[]; migration?: any; error?: string }> {
    return request('/api/warehouses');
  },

  async saveWarehouse(
    warehouse: Partial<Warehouse> & { name: string }
  ): Promise<{ success: boolean; warehouse?: Warehouse; error?: string }> {
    if (warehouse.id) {
      return request(`/api/warehouses/${encodeURIComponent(warehouse.id)}`, {
        method: 'PUT',
        body: JSON.stringify(warehouse)
      });
    }
    return request('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify(warehouse)
    });
  },

  async deleteWarehouse(id: string): Promise<{ success: boolean; error?: string }> {
    return request(`/api/warehouses/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  async getItemWarehouses(itemId: string): Promise<{
    success: boolean;
    itemId?: string;
    itemName?: string;
    totalStockQuantity?: number;
    warehouses?: WarehouseItemBreakdown[];
    error?: string;
  }> {
    return request(`/api/items/${encodeURIComponent(itemId)}/warehouses`);
  },

  async getUserWarehouses(userId: string): Promise<UserWarehousesResponse> {
    return request(`/api/users/${encodeURIComponent(userId)}/warehouses`);
  },

  async saveUserWarehouses(
    userId: string,
    config: Partial<UserWarehouseConfig>
  ): Promise<{ success: boolean; warehouseConfig?: UserWarehouseConfig; error?: string }> {
    return request(`/api/users/${encodeURIComponent(userId)}/warehouses`, {
      method: 'PUT',
      body: JSON.stringify(config)
    });
  },

  // Warehouse Transfers & Dispatch Orders
  async getWarehouseTransferContext(): Promise<{
    success: boolean;
    sourceWarehouses?: Warehouse[];
    targetWarehouses?: Warehouse[];
    allWarehouses?: Warehouse[];
    stockSettings?: StockSettings;
    error?: string;
  }> {
    return request('/api/warehouse-transfers/context');
  },

  async getWarehouseTransferStocks(params: {
    fromWarehouseId: string;
    toWarehouseId?: string;
    itemIds?: string[];
  }): Promise<{
    success: boolean;
    stocks?: Record<string, { fromStock: number; toStock: number }>;
    error?: string;
  }> {
    const qs = new URLSearchParams();
    qs.set('fromWarehouseId', params.fromWarehouseId);
    if (params.toWarehouseId) qs.set('toWarehouseId', params.toWarehouseId);
    if (params.itemIds && params.itemIds.length > 0) qs.set('itemIds', params.itemIds.join(','));
    return request(`/api/warehouse-transfers/stocks?${qs.toString()}`);
  },

  async createWarehouseTransfer(payload: {
    fromWarehouseId: string;
    toWarehouseId: string;
    lines: Array<{ itemId: string; quantity: number }>;
    notes?: string;
    idempotencyKey: string;
  }): Promise<{
    success: boolean;
    duplicate?: boolean;
    order?: WarehouseDispatchOrder;
    insufficientItems?: WarehouseTransferInsufficientItem[];
    error?: string;
  }> {
    return request('/api/warehouse-transfers', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async getWarehouseTransfers(filters?: {
    dispatchNumber?: string;
    q?: string;
    fromWarehouseId?: string;
    toWarehouseId?: string;
    from?: string | null;
    to?: string | null;
    page?: number;
    pageSize?: number;
  }): Promise<{
    success: boolean;
    orders?: WarehouseDispatchOrder[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
    error?: string;
  }> {
    const qs = new URLSearchParams();
    if (filters?.dispatchNumber) qs.set('dispatchNumber', filters.dispatchNumber);
    if (filters?.q) qs.set('q', filters.q);
    if (filters?.fromWarehouseId && filters.fromWarehouseId !== 'ALL') qs.set('fromWarehouseId', filters.fromWarehouseId);
    if (filters?.toWarehouseId && filters.toWarehouseId !== 'ALL') qs.set('toWarehouseId', filters.toWarehouseId);
    if (filters?.from) qs.set('from', filters.from);
    if (filters?.to) qs.set('to', filters.to);
    if (filters?.page) qs.set('page', String(filters.page));
    if (filters?.pageSize) qs.set('pageSize', String(filters.pageSize));
    const queryStr = qs.toString();
    return request(`/api/warehouse-transfers${queryStr ? `?${queryStr}` : ''}`);
  },

  async getWarehouseTransferById(idOrNumber: string): Promise<{
    success: boolean;
    order?: WarehouseDispatchOrder;
    error?: string;
  }> {
    return request(`/api/warehouse-transfers/${encodeURIComponent(idOrNumber)}`);
  },

  async exportItemsExcel(): Promise<{ blob: Blob; fileName: string }> {
    assertBoundSessionMatches();
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return runWithTimeout(undefined, async (signal) => {
      const res = await fetch('/api/items/export-excel', {
        method: 'GET',
        headers,
        signal
      });

      if (res.status === 401) {
        let errJson: any = null;
        try { errJson = await res.json(); } catch (_) {}
        if (errJson?.expired && sessionExpiredHandler) {
          sessionExpiredHandler();
        }
        throw new Error(errJson?.error || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا');
      }

      if (!res.ok) {
        let errMessage = 'فشل تصدير ملف الإكسيل من الخادم';
        try {
          const errorData = await res.json();
          if (errorData?.error) errMessage = errorData.error;
        } catch (_) {}
        throw new Error(errMessage);
      }

      const blob = await res.blob();
      const cairoToday = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
      let fileName = `أصناف-المخزن-${cairoToday}.xlsx`;

      const customHeader = res.headers.get('X-Export-Filename');
      if (customHeader) {
        try {
          fileName = decodeURIComponent(customHeader);
        } catch {
          fileName = customHeader;
        }
      } else {
        const disposition = res.headers.get('Content-Disposition') || '';
        const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match?.[1]) {
          try {
            fileName = decodeURIComponent(utf8Match[1]);
          } catch {}
        }
      }

      return { blob, fileName };
    });
  },

  async downloadBulkEditExcelTemplate(operationType: BulkEditPriceOperationType): Promise<{ blob: Blob; fileName: string }> {
    assertBoundSessionMatches();
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const qs = new URLSearchParams({ operationType });
    return runWithTimeout(undefined, async (signal) => {
      const res = await fetch(`/api/items/bulk-edit-excel/template?${qs.toString()}`, {
        method: 'GET',
        headers,
        signal
      });

      if (res.status === 401) {
        let errJson: any = null;
        try { errJson = await res.json(); } catch (_) {}
        if (errJson?.expired && sessionExpiredHandler) {
          sessionExpiredHandler();
        }
        throw new Error(errJson?.error || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا');
      }

      if (!res.ok) {
        let errMessage = 'فشل تحميل نموذج الإكسيل من الخادم';
        try {
          const errorData = await res.json();
          if (errorData?.error) errMessage = errorData.error;
        } catch (_) {}
        throw new Error(errMessage);
      }

      const blob = await res.blob();
      let fileName =
        operationType === 'sale_price'
          ? 'نموذج-تعديل-سعر-البيع.xlsx'
          : operationType === 'add_categories'
          ? 'نموذج-إضافة-تصنيفات.xlsx'
          : 'نموذج-تعديل-سعر-الشراء.xlsx';

      const customHeader = res.headers.get('X-Export-Filename');
      if (customHeader) {
        try {
          fileName = decodeURIComponent(customHeader);
        } catch {
          fileName = customHeader;
        }
      } else {
        const disposition = res.headers.get('Content-Disposition') || '';
        const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match?.[1]) {
          try {
            fileName = decodeURIComponent(utf8Match[1]);
          } catch {}
        }
      }

      return { blob, fileName };
    });
  },

  async previewBulkEditExcel(payload: {
    operationType: BulkEditOperationType;
    fileName: string;
    fileBase64: string;
    warehouseId?: string;
  }): Promise<BulkEditExcelPreviewResult> {
    return request('/api/items/bulk-edit-excel/preview', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async executeBulkEditExcel(payload: {
    operationType: BulkEditOperationType;
    fileName: string;
    fileBase64: string;
    warehouseId?: string;
  }): Promise<BulkEditExcelExecuteResult> {
    return request('/api/items/bulk-edit-excel/execute', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async getBulkEditUndoStatus(): Promise<BulkEditUndoStatus> {
    return request('/api/items/bulk-edit-excel/undo-status');
  },

  async undoLastBulkEditExcel(): Promise<BulkEditUndoResult> {
    return request('/api/items/bulk-edit-excel/undo', {
      method: 'POST',
      body: JSON.stringify({})
    });
  },

  async downloadBulkEditErrorsFile(payload: {
    operationType: BulkEditOperationType;
    fileName?: string;
    rows: BulkEditExcelPreviewRow[];
  }): Promise<{ blob: Blob; fileName: string }> {
    assertBoundSessionMatches();
    const token = getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return runWithTimeout(undefined, async (signal) => {
      const res = await fetch('/api/items/bulk-edit-excel/errors-file', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal
      });

      if (res.status === 401) {
        let errJson: any = null;
        try { errJson = await res.json(); } catch (_) {}
        if (errJson?.expired && sessionExpiredHandler) {
          sessionExpiredHandler();
        }
        throw new Error(errJson?.error || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا');
      }

      if (!res.ok) {
        let errMessage = 'فشل تحميل ملف الأخطاء من الخادم';
        try {
          const errorData = await res.json();
          if (errorData?.error) errMessage = errorData.error;
        } catch (_) {}
        throw new Error(errMessage);
      }

      const blob = await res.blob();
      let fileName = 'أخطاء-التعديل-بالإكسيل.xlsx';

      const customHeader = res.headers.get('X-Export-Filename');
      if (customHeader) {
        try {
          fileName = decodeURIComponent(customHeader);
        } catch {
          fileName = customHeader;
        }
      } else {
        const disposition = res.headers.get('Content-Disposition') || '';
        const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match?.[1]) {
          try {
            fileName = decodeURIComponent(utf8Match[1]);
          } catch {}
        }
      }

      return { blob, fileName };
    });
  },

  async checkItemUnique(params: {
    excludeId?: string;
    name?: string;
    barcode?: string;
    secondaryBarcodes?: string[];
    sku?: string;
    code?: string;
  }): Promise<{
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
    conflicts?: Array<{
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
    }>;
    error?: string;
    message?: string;
  }> {
    return request('/api/items/check-unique', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  async previewDuplicateItems(): Promise<{
    success: boolean;
    totalItems: number;
    duplicateGroupsCount: number;
    totalDeleteCount: number;
    totalKeptCount: number;
    totalNotDeletedCount: number;
    groups: Array<{
      groupKey: string;
      matchReasons: ('name' | 'barcode')[];
      matchLabel: string;
      keptItems: Array<{
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
      }>;
      deleteItems: Array<{
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
      }>;
      notDeletedItems: Array<{
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
        skipReason: string;
      }>;
    }>;
    error?: string;
  }> {
    return request('/api/items/duplicates/preview');
  },

  async cleanupDuplicateItems(): Promise<{
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
  }> {
    return request('/api/items/duplicates/cleanup', {
      method: 'POST'
    });
  },

  async saveItem(item: Partial<Item> & { name: string }): Promise<{ success: boolean; item: Item; error?: string }> {
    const res = await request<{ success: boolean; item: Item; error?: string }>('/api/items', {
      method: 'POST',
      body: JSON.stringify(item)
    });
    if (!res.success && res.error) {
      throw new Error(res.error);
    }
    return res;
  },

  async inlineUpdateItem(
    id: string,
    payload: {
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
  ): Promise<{ success: boolean; item: Item; error?: string; code?: string }> {
    const res = await request<{ success: boolean; item: Item; error?: string; code?: string }>(
      `/api/items/${encodeURIComponent(id)}/inline`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload)
      }
    );
    if (!res.success && res.error) {
      const err = new Error(res.error);
      (err as any).code = res.code;
      throw err;
    }
    return res;
  },

  async deleteItem(id: string): Promise<{ success: boolean; message?: string; hasTransactions?: boolean; error?: string }> {
    return request(`/api/items/${id}`, {
      method: 'DELETE'
    });
  },

  async adjustItemStock(itemId: string, payload: { newQuantity: number; reason: string; source?: string; warehouseId?: string }): Promise<{ success: boolean; item?: Item; movement?: StockMovement; error?: string }> {
    return request(`/api/items/${itemId}/adjust-stock`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // Categories
  async getCategories(): Promise<{ success: boolean; categories: ProductCategory[] }> {
    return request('/api/categories');
  },

  async saveCategory(category: Partial<ProductCategory> & { name: string }): Promise<{ success: boolean; category: ProductCategory; error?: string }> {
    return request('/api/categories', {
      method: 'POST',
      body: JSON.stringify(category)
    });
  },

  async deleteCategory(id: string): Promise<{ success: boolean; error?: string; hasChildren?: boolean; hasItems?: boolean }> {
    return request(`/api/categories/${id}`, {
      method: 'DELETE'
    });
  },

  async migrateItemCategories(): Promise<{
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
  }> {
    return request('/api/categories/migrate', {
      method: 'POST'
    });
  },

  async archiveItem(id: string): Promise<{ success: boolean; message?: string }> {
    return request(`/api/items/archive/${id}`, {
      method: 'POST'
    });
  },

  async getItemLogs(id: string): Promise<{ success: boolean; changeLogs: ItemChangeLogEntry[]; stockMovements: StockMovement[] }> {
    return request(`/api/items/${id}/logs`);
  },

  async importItemsBatch(payload: { items: any[]; updateExisting: boolean; fileName: string }): Promise<{
    success: boolean;
    batchId: string;
    totalCount: number;
    insertedCount: number;
    updatedCount: number;
    errorCount: number;
    errors: string[];
    error?: string;
  }> {
    return request('/api/items/import-batch', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async uploadImage(data: {
    imageBase64: string;
    fileName?: string;
    mimeType?: string;
    folder?: 'items' | 'print' | 'company' | 'visitor' | 'misc';
  }): Promise<{
    success: boolean;
    url: string;
    message?: string;
    storage?: 'supabase' | 'apps-script' | 'inline';
  }> {
    return request('/api/upload-image', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // صور الأصناف بالجملة: هل تخزين الصور مفعّل؟
  async getItemImagesConfig(): Promise<{ success: boolean; storageEnabled: boolean; maxImageBytes: number }> {
    return request('/api/items/images/config');
  },

  // ربط صور اترفعت بالأصناف (الصنف بالباركود الرئيسي أو الاسم) — حتى 100 في المرة
  async setItemImages(entries: { key: string; url: string }[], replace: boolean): Promise<ItemImagesSetResponse> {
    return request('/api/items/images/set', {
      method: 'POST',
      body: JSON.stringify({ entries, replace })
    });
  },

  async getImagesStatus(): Promise<ImagesStorageStatus> {
    return request<ImagesStorageStatus>('/api/system/images/status');
  },

  async migrateImages(): Promise<ImagesMigrationResult> {
    return request<ImagesMigrationResult>('/api/system/images/migrate', {
      method: 'POST',
      body: JSON.stringify({})
    });
  },

  async getVisitorConfig(): Promise<{
    success: boolean;
    settings: VisitorDisplaySettings;
    company: { name: string; logoUrl: string };
    error?: string;
  }> {
    return request('/api/visitor/config');
  },

  async visitorLookup(
    barcode: string,
    signal?: AbortSignal
  ): Promise<{
    success: boolean;
    found: boolean;
    product: VisitorProduct | null;
    error?: string;
  }> {
    return request(`/api/visitor/lookup?barcode=${encodeURIComponent(barcode)}`, {
      signal
    });
  },

  async getVisitorCatalog(): Promise<{
    success: boolean;
    catalog: Record<string, VisitorProduct>;
    generatedAt: string;
    error?: string;
  }> {
    return request('/api/visitor/catalog');
  },

  async saveVisitorSettings(payload: {
    slideSeconds?: number;
    resultSeconds?: number;
    showWelcome?: boolean;
    welcomeText?: string;
    showLogo?: boolean;
  }): Promise<{
    success: boolean;
    settings: VisitorDisplaySettings;
    error?: string;
  }> {
    return request('/api/visitor/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async addVisitorSlide(imageBase64: string): Promise<{
    success: boolean;
    slide: VisitorSlide;
    settings: VisitorDisplaySettings;
    error?: string;
  }> {
    return request('/api/visitor/slides', {
      method: 'POST',
      body: JSON.stringify({ imageBase64 })
    });
  },

  async deleteVisitorSlide(id: string): Promise<{
    success: boolean;
    settings: VisitorDisplaySettings;
    error?: string;
  }> {
    return request(`/api/visitor/slides/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  async orderVisitorSlides(ids: string[]): Promise<{
    success: boolean;
    settings: VisitorDisplaySettings;
    error?: string;
  }> {
    return request('/api/visitor/slides/order', {
      method: 'POST',
      body: JSON.stringify({ ids })
    });
  },

  async getLabelSettings(): Promise<{
    success: boolean;
    settings: LabelSettings;
    error?: string;
  }> {
    return request('/api/labels/settings');
  },

  async saveLabelSettings(payload: Partial<LabelSettings>): Promise<{
    success: boolean;
    settings: LabelSettings;
    error?: string;
    code?: string;
  }> {
    return request('/api/labels/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async addItemBarcode(
    itemId: string,
    barcode: string
  ): Promise<{
    success: boolean;
    item: Item;
    alreadyRegistered?: boolean;
    error?: string;
  }> {
    return request(`/api/items/${encodeURIComponent(itemId)}/barcodes`, {
      method: 'POST',
      body: JSON.stringify({ barcode })
    });
  },

  // Platforms
  async getPlatforms(): Promise<{ success: boolean; platforms: Platform[] }> {
    return request('/api/platforms');
  },

  async savePlatform(platform: Partial<Platform> & { name: string }): Promise<{ success: boolean; platform: Platform; error?: string }> {
    return request('/api/platforms', {
      method: 'POST',
      body: JSON.stringify(platform)
    });
  },

  // ItemPlatformCosts
  async getItemPlatformCosts(): Promise<{ success: boolean; costs: ItemPlatformCost[] }> {
    return request('/api/item-platform-costs');
  },

  async saveItemPlatformCost(costObj: ItemPlatformCost): Promise<{ success: boolean; error?: string }> {
    return request('/api/item-platform-costs', {
      method: 'POST',
      body: JSON.stringify(costObj)
    });
  },

  // Invoices
  async getInvoices(filters?: { from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null }): Promise<{ success: boolean; invoices: Invoice[] }> {
    const params = new URLSearchParams();
    const from = filters?.from || filters?.startDate;
    const to = filters?.to || filters?.endDate;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/invoices${qs}`);
  },

  async createInvoice(invoice: any): Promise<{ success: boolean; invoice: Invoice; duplicate?: boolean; message?: string; error?: string; code?: string }> {
    return request('/api/invoices', {
      method: 'POST',
      body: JSON.stringify(invoice)
    });
  },

  async syncOfflineOperation(operation: any): Promise<{
    success: boolean;
    invoice?: Invoice;
    duplicate?: boolean;
    finalInvoiceNumber?: string;
    provisionalInvoiceNumber?: string;
    needsReview?: boolean;
    reviewReasons?: string[];
    message?: string;
    error?: string;
    code?: string;
    statusCode?: number;
  }> {
    try {
      return await request('/api/offline/sync', {
        method: 'POST',
        body: JSON.stringify(operation)
      });
    } catch (err: any) {
      if (err?.status === 409 || err?.code === 'BEFORE_RESET') {
        return {
          success: false,
          code: err?.code || 'BEFORE_RESET',
          statusCode: 409,
          error: err?.message || 'هذه العملية سُجّلت على الجهاز قبل إعادة ضبط النظام، ولن تُرفع.'
        };
      }
      throw err;
    }
  },

  async markOfflineInvoiceReviewed(payload: {
    invoiceNumber: string;
    reviewNote: string;
  }): Promise<{
    success: boolean;
    invoice?: Invoice;
    message?: string;
    error?: string;
  }> {
    return request('/api/offline/review', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async updateInvoice(invoiceNumber: string, payload: any): Promise<{ success: boolean; invoice: Invoice; message?: string }> {
    return request(`/api/invoices/${encodeURIComponent(invoiceNumber)}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  // Returns
  async getReturns(filters?: { from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null }): Promise<{ success: boolean; returns: ReturnRecord[] }> {
    const params = new URLSearchParams();
    const from = filters?.from || filters?.startDate;
    const to = filters?.to || filters?.endDate;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/returns${qs}`);
  },

  async createReturn(returnData: any): Promise<{ success: boolean; returnRecord: ReturnRecord; duplicate?: boolean; error?: string; code?: string }> {
    return request('/api/returns', {
      method: 'POST',
      body: JSON.stringify(returnData)
    });
  },

  // Reports
  async getReports(filters?: { from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null }): Promise<{ success: boolean } & ReportsData> {
    const params = new URLSearchParams();
    const from = filters?.from || filters?.startDate;
    const to = filters?.to || filters?.endDate;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/reports${qs}`);
  },

  // Users
  async getUsers(): Promise<{ success: boolean; users: UserAccount[] }> {
    return request('/api/users');
  },

  async saveUser(user: Partial<UserAccount> & { username?: string; phone?: string; password?: string }): Promise<{ success: boolean; user: UserAccount; error?: string }> {
    return request('/api/users', {
      method: 'POST',
      body: JSON.stringify(user)
    });
  },

  async deleteUser(userId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return request(`/api/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE'
    });
  },

  async getUserSessions(): Promise<{
    success: boolean;
    sessions: ActiveUserSessionInfo[];
    inactivityTimeoutMinutes?: InactivityTimeoutMinutes;
    error?: string;
  }> {
    return request('/api/users/sessions');
  },

  async terminateUserSession(userId: string, sessionId: string): Promise<{
    success: boolean;
    terminatedCount?: number;
    terminatedCurrentSession?: boolean;
    message?: string;
    error?: string;
  }> {
    return request(`/api/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE'
    });
  },

  async terminateAllUserSessions(userId: string): Promise<{
    success: boolean;
    terminatedCount?: number;
    terminatedCurrentSession?: boolean;
    message?: string;
    error?: string;
  }> {
    return request(`/api/users/${encodeURIComponent(userId)}/sessions`, {
      method: 'DELETE'
    });
  },

  // Permissions
  async getPermissions(): Promise<{ success: boolean; permissions: PermissionDefinition[]; templates: Record<string, PermissionKey[]> }> {
    return request('/api/permissions');
  },

  async updateUserPermissions(userId: string, permissions: PermissionKey[]): Promise<{ success: boolean; message?: string; error?: string }> {
    return request(`/api/users/${userId}/permissions`, {
      method: 'POST',
      body: JSON.stringify({ permissions })
    });
  },

  // Settings
  async saveCompanySettings(settings: Partial<CompanySettings>): Promise<{ success: boolean; settings: CompanySettings; error?: string }> {
    return request('/api/settings/company', {
      method: 'POST',
      body: JSON.stringify(settings)
    });
  },

  async saveContactSettings(settings: Partial<ContactSettings>): Promise<{ success: boolean; settings?: ContactSettings; error?: string }> {
    return request('/api/settings/contact', {
      method: 'POST',
      body: JSON.stringify(settings)
    });
  },

  async saveDeliveryFeeSetting(enableDeliveryFee: boolean): Promise<{ success: boolean; settings: CompanySettings }> {
    return request('/api/settings/delivery-fee', {
      method: 'POST',
      body: JSON.stringify({ enableDeliveryFee })
    });
  },

  async saveInvoicePrintSettings(settings: Partial<InvoicePrintSettings>): Promise<{ success: boolean; settings: InvoicePrintSettings }> {
    return request('/api/settings/invoice-print', {
      method: 'POST',
      body: JSON.stringify(settings)
    });
  },

  async saveDisplaySettings(settings: Partial<DisplaySettings>): Promise<{ success: boolean; settings: DisplaySettings }> {
    return request('/api/settings/display', {
      method: 'POST',
      body: JSON.stringify(settings)
    });
  },

  async saveTaxSettings(settings: Partial<TaxSettings>): Promise<{ success: boolean; taxSettings: TaxSettings }> {
    return request('/api/settings/tax', {
      method: 'POST',
      body: JSON.stringify(settings)
    });
  },

  async saveStockSettings(settings: Partial<StockSettings>): Promise<{ success: boolean; settings: StockSettings }> {
    return request('/api/settings/stock', {
      method: 'POST',
      body: JSON.stringify(settings)
    });
  },

  async getSalesRules(): Promise<{ success: boolean; rules: import('../types').SalesRules; error?: string }> {
    return request('/api/settings/sales-rules');
  },

  async saveSalesRules(rules: Partial<import('../types').SalesRules>): Promise<{ success: boolean; rules: import('../types').SalesRules; error?: string; code?: string }> {
    return request('/api/settings/sales-rules', {
      method: 'POST',
      body: JSON.stringify(rules)
    });
  },

  async getInvoiceNumbering(): Promise<
    { success: boolean; error?: string; code?: string } & import('../types').InvoiceNumberingView
  > {
    return request('/api/settings/invoice-numbering');
  },

  async saveInvoiceNumbering(
    input: Partial<import('../types').InvoiceNumberingSettings>
  ): Promise<{ success: boolean; error?: string; code?: string } & import('../types').InvoiceNumberingView> {
    return request('/api/settings/invoice-numbering', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },

  async resetInvoiceCounter(
    startAt?: number
  ): Promise<{ success: boolean; error?: string; code?: string } & import('../types').InvoiceNumberingView> {
    return request('/api/settings/invoice-numbering/reset-counter', {
      method: 'POST',
      body: JSON.stringify({ startAt })
    });
  },

  async setInvoicePlatformOrder(
    invoiceNumber: string,
    platformOrderId: string,
    reason: string
  ): Promise<{ success: boolean; invoice: import('../types').Invoice; error?: string; code?: string }> {
    return request(`/api/invoices/${encodeURIComponent(invoiceNumber)}/platform-order`, {
      method: 'PUT',
      body: JSON.stringify({ platformOrderId, reason })
    });
  },

  // Audit Logs
  async getAuditLogs(filters?: {
    from?: string | null;
    to?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    userId?: string | null;
    action?: string | null;
    q?: string | null;
  }): Promise<{ success: boolean; logs: AuditLogEntry[] }> {
    const params = new URLSearchParams();
    const from = filters?.from || filters?.startDate;
    const to = filters?.to || filters?.endDate;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (filters?.userId && filters.userId !== 'ALL') params.set('userId', filters.userId);
    if (filters?.action && filters.action !== 'ALL') params.set('action', filters.action);
    if (filters?.q && filters.q.trim()) params.set('q', filters.q.trim());
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/audit-logs${qs}`);
  },

  // First Designer Local Bootstrap Fallback
  async setupDesignerLocal(data: { username: string; name: string; password: string; phone?: string }): Promise<AuthSession> {
    const res = await request<AuthSession>('/api/auth/setup-designer-local', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    if (res.token) {
      setAuthToken(res.token);
    }
    return res;
  },

  // Suppliers & Purchases
  async getSuppliers(): Promise<{ success: boolean; suppliers: Supplier[] }> {
    return request('/api/suppliers');
  },

  async saveSupplier(supplier: Partial<Supplier> & { name: string }): Promise<{ success: boolean; supplier: Supplier }> {
    return request('/api/suppliers', {
      method: 'POST',
      body: JSON.stringify(supplier)
    });
  },

  async getSupplierGroups(): Promise<{ success: boolean; groups: SupplierGroup[] }> {
    return request('/api/supplier-groups');
  },

  async saveSupplierGroup(group: Partial<SupplierGroup> & { name: string }): Promise<{ success: boolean; group: SupplierGroup; error?: string }> {
    return request('/api/supplier-groups', {
      method: 'POST',
      body: JSON.stringify(group)
    });
  },

  async getSupplierLedger(
    supplierIdOrParams: string | { supplierId: string; from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null },
    fromOrFilters?: string | { from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null } | null,
    to?: string | null
  ): Promise<{ success: boolean; ledger: SupplierLedgerEntry[]; supplier?: Supplier; openingBalanceForPeriod?: number; closingBalanceForPeriod?: number }> {
    const params = new URLSearchParams();
    let supplierId: string;
    let fromVal: string | null | undefined;
    let toVal: string | null | undefined;
    if (typeof supplierIdOrParams !== 'string') {
      supplierId = supplierIdOrParams.supplierId;
      fromVal = supplierIdOrParams.from || supplierIdOrParams.startDate;
      toVal = supplierIdOrParams.to || supplierIdOrParams.endDate;
    } else {
      supplierId = supplierIdOrParams;
      if (typeof fromOrFilters === 'object' && fromOrFilters !== null) {
        fromVal = fromOrFilters.from || fromOrFilters.startDate;
        toVal = fromOrFilters.to || fromOrFilters.endDate;
      } else {
        fromVal = typeof fromOrFilters === 'string' ? fromOrFilters : undefined;
        toVal = to;
      }
    }
    if (fromVal) params.set('from', fromVal);
    if (toVal) params.set('to', toVal);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/suppliers/${supplierId}/ledger${qs}`);
  },

  async createSupplierVoucher(payload: {
    supplierId: string;
    voucherType?: 'سند صرف' | 'سند قبض' | string;
    type?: 'سند صرف' | 'سند قبض' | string;
    amount: number;
    cashboxId: string;
    statement?: string;
    notes?: string;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; voucherId?: string; duplicate?: boolean; error?: string; code?: string }> {
    const mapped = {
      ...payload,
      type: (payload.type || (payload.voucherType === 'صرف' ? 'سند صرف' : payload.voucherType === 'قبض' ? 'سند قبض' : payload.voucherType)) as any
    };
    return request('/api/suppliers/voucher', {
      method: 'POST',
      body: JSON.stringify(mapped)
    });
  },

  async getPurchases(filters?: { from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null }): Promise<{ success: boolean; purchases: PurchaseInvoice[] }> {
    const params = new URLSearchParams();
    const from = filters?.from || filters?.startDate;
    const to = filters?.to || filters?.endDate;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/purchases${qs}`);
  },

  async createPurchase(payload: any): Promise<{ success: boolean; invoice?: PurchaseInvoice; duplicate?: boolean; error?: string; code?: string }> {
    return request('/api/purchases', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async getPurchaseReturns(filters?: { from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null }): Promise<{ success: boolean; returns: PurchaseReturn[] }> {
    const params = new URLSearchParams();
    const from = filters?.from || filters?.startDate;
    const to = filters?.to || filters?.endDate;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/purchase-returns${qs}`);
  },

  async createPurchaseReturn(payload: any): Promise<{ success: boolean; returnRecord?: PurchaseReturn; duplicate?: boolean; error?: string; code?: string }> {
    return request('/api/purchases/return', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // Customers
  async getCustomers(): Promise<{ success: boolean; customers: Customer[] }> {
    return request('/api/customers');
  },

  async saveCustomer(customer: Partial<Customer> & { name: string }): Promise<{ success: boolean; customer?: Customer; error?: string }> {
    return request('/api/customers', {
      method: 'POST',
      body: JSON.stringify(customer)
    });
  },

  async getCustomerGroups(): Promise<{ success: boolean; groups: CustomerGroup[] }> {
    return request('/api/customer-groups');
  },

  async saveCustomerGroup(group: Partial<CustomerGroup> & { name: string }): Promise<{ success: boolean; group: CustomerGroup; error?: string }> {
    return request('/api/customer-groups', {
      method: 'POST',
      body: JSON.stringify(group)
    });
  },

  async getCustomerLedger(
    customerId: string,
    fromOrFilters?: string | { from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null } | null,
    to?: string | null
  ): Promise<{ success: boolean; ledger: CustomerLedgerEntry[]; customer?: Customer; openingBalanceForPeriod?: number }> {
    const params = new URLSearchParams();
    let fromVal: string | null | undefined;
    let toVal: string | null | undefined;
    if (typeof fromOrFilters === 'object' && fromOrFilters !== null) {
      fromVal = fromOrFilters.from || fromOrFilters.startDate;
      toVal = fromOrFilters.to || fromOrFilters.endDate;
    } else {
      fromVal = typeof fromOrFilters === 'string' ? fromOrFilters : undefined;
      toVal = to;
    }
    if (fromVal) params.set('from', fromVal);
    if (toVal) params.set('to', toVal);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/customers/${customerId}/ledger${qs}`);
  },

  async createCustomerVoucher(payload: {
    customerId: string;
    voucherType?: 'سند قبض' | 'سند صرف' | string;
    type?: 'سند قبض' | 'سند صرف' | string;
    amount: number;
    cashboxId: string;
    statement?: string;
    notes?: string;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; voucherId?: string; duplicate?: boolean; error?: string; code?: string }> {
    const mapped = {
      ...payload,
      type: (payload.type || (payload.voucherType === 'قبض' ? 'سند قبض' : payload.voucherType === 'صرف' ? 'سند صرف' : payload.voucherType)) as any
    };
    return request('/api/customers/voucher', {
      method: 'POST',
      body: JSON.stringify(mapped)
    });
  },

  // Dashboard Cashboxes
  async getDashboardCashboxes(): Promise<{ success: boolean; cashboxes: DashboardCashbox[]; error?: string }> {
    return request('/api/dashboard/cashboxes');
  },

  // Cashboxes
  async getCashboxes(): Promise<{ success: boolean; cashboxes: Cashbox[] }> {
    return request('/api/cashboxes');
  },

  async saveCashbox(cashbox: Partial<Cashbox> & { name: string }): Promise<{ success: boolean; cashbox?: Cashbox; error?: string }> {
    return request('/api/cashboxes', {
      method: 'POST',
      body: JSON.stringify(cashbox)
    });
  },

  async getCashboxTransactions(
    cashboxId?: string,
    fromOrFilters?: string | { from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null } | null,
    to?: string | null
  ): Promise<{ success: boolean; transactions: CashboxTransaction[]; transfers?: CashboxTransfer[]; cashbox?: Cashbox }> {
    const targetId = cashboxId || 'ALL';
    const params = new URLSearchParams();
    let fromVal: string | null | undefined;
    let toVal: string | null | undefined;
    if (typeof fromOrFilters === 'object' && fromOrFilters !== null) {
      fromVal = fromOrFilters.from || fromOrFilters.startDate;
      toVal = fromOrFilters.to || fromOrFilters.endDate;
    } else {
      fromVal = typeof fromOrFilters === 'string' ? fromOrFilters : undefined;
      toVal = to;
    }
    if (fromVal) params.set('from', fromVal);
    if (toVal) params.set('to', toVal);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/cashboxes/${encodeURIComponent(targetId)}/transactions${qs}`);
  },

  async createCashboxTransfer(payload: {
    fromCashboxId: string;
    toCashboxId: string;
    amount: number;
    fee?: number;
    notes?: string;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; transfer?: CashboxTransfer; duplicate?: boolean; error?: string; code?: string }> {
    return request('/api/cashboxes/transfer', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async getCashboxAssignments(): Promise<{ success: boolean; assignments: UserCashboxAssignment[] }> {
    return request('/api/cashbox-assignments');
  },

  async getUserCashboxAssignments(): Promise<{ success: boolean; assignments: UserCashboxAssignment[] }> {
    return request('/api/cashbox-assignments');
  },

  async saveCashboxAssignment(assignment: Partial<UserCashboxAssignment> & { userId: string; cashboxId: string }): Promise<{ success: boolean; assignment: UserCashboxAssignment; error?: string }> {
    return request('/api/cashbox-assignments', {
      method: 'POST',
      body: JSON.stringify(assignment)
    });
  },

  async saveUserCashboxAssignment(assignment: Partial<UserCashboxAssignment> & { userId: string; cashboxId: string }): Promise<{ success: boolean; assignment: UserCashboxAssignment; error?: string }> {
    return request('/api/cashbox-assignments', {
      method: 'POST',
      body: JSON.stringify(assignment)
    });
  },

  async getImportBatches(): Promise<{ success: boolean; batches: ImportBatch[] }> {
    return request('/api/import-batches');
  },

  async cancelInvoice(invoiceNumber: string, reason: string): Promise<{ success: boolean; invoice?: Invoice; error?: string }> {
    return request(`/api/invoices/${encodeURIComponent(invoiceNumber)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  async cancelPurchase(invoiceNumber: string, reason: string): Promise<{ success: boolean; purchase?: PurchaseInvoice; error?: string }> {
    return request(`/api/purchases/${encodeURIComponent(invoiceNumber)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  async getReconciliationReport(filters?: { from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null }): Promise<{
    success: boolean;
    report: {
      totalAudited: number;
      unpostedCount: number;
      discrepantCashboxAmount: number;
      discrepantLedgerAmount: number;
      items: ReconciliationItem[];
    };
  }> {
    const params = new URLSearchParams();
    const from = filters?.from || filters?.startDate;
    const to = filters?.to || filters?.endDate;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/reconciliation${qs}`);
  },

  async postReconciliationItem(payload: {
    documentNumber: string;
    documentType: string;
    cashboxId?: string;
    warehouseId?: string;
  }): Promise<{ success: boolean; message?: string; error?: string }> {
    return request('/api/reconciliation/post-item', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // Reports: Item Movement & Stock Adjustments
  async getItemMovementReport(params: { itemId: string; warehouseId?: string | null; from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null }): Promise<{ success: boolean; report: ItemMovementReport; error?: string }> {
    const qs = new URLSearchParams();
    qs.set('itemId', params.itemId);
    const from = params.from || params.startDate;
    const to = params.to || params.endDate;
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (params.warehouseId && params.warehouseId !== 'ALL') qs.set('warehouseId', params.warehouseId);
    return request(`/api/reports/item-movement?${qs.toString()}`);
  },

  async getStockAdjustmentsReport(params?: { itemId?: string; warehouseId?: string | null; from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null }): Promise<{ success: boolean; report: StockAdjustmentsReport; error?: string }> {
    const qs = new URLSearchParams();
    if (params?.itemId) qs.set('itemId', params.itemId);
    const from = params?.from || params?.startDate;
    const to = params?.to || params?.endDate;
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (params?.warehouseId && params.warehouseId !== 'ALL') qs.set('warehouseId', params.warehouseId);
    const queryStr = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/api/reports/stock-adjustments${queryStr}`);
  },

  async getBnplReport(params?: {
    from?: string | null;
    to?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    platformId?: string | null;
    productQuery?: string | null;
    groupBy?: 'item' | 'platform' | 'invoice';
  }): Promise<{ success: boolean; report: BnplReport; error?: string }> {
    const qs = new URLSearchParams();
    const from = params?.from || params?.startDate;
    const to = params?.to || params?.endDate;
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (params?.platformId && params.platformId !== 'ALL') qs.set('platformId', params.platformId);
    if (params?.productQuery) qs.set('productQuery', params.productQuery);
    if (params?.groupBy) qs.set('groupBy', params.groupBy);
    const queryStr = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/api/reports/bnpl${queryStr}`);
  },

  async getPlatformReport(params: {
    platformId: string;
    from?: string | null;
    to?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    stagnantDays?: number;
  }): Promise<{ success: boolean; report: PlatformReport; error?: string }> {
    const qs = new URLSearchParams();
    qs.set('platformId', params.platformId);
    const from = params.from || params.startDate;
    const to = params.to || params.endDate;
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (params.stagnantDays) qs.set('stagnantDays', String(params.stagnantDays));
    const queryStr = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/api/reports/platform${queryStr}`);
  },

  // Party Ledger & Credit Collection
  async getPartyLedger(params: {
    partyType: 'customer' | 'platform';
    partyId: string;
    from?: string | null;
    to?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  }): Promise<{
    success: boolean;
    partyType: 'customer' | 'platform';
    partyId: string;
    party?: Customer | Platform;
    ledger: PartyLedgerEntry[];
    pendingInvoices: Invoice[];
    currentBalance: number;
    openingBalanceForPeriod: number;
    error?: string;
  }> {
    const qs = new URLSearchParams();
    qs.set('partyType', params.partyType);
    qs.set('partyId', params.partyId);
    const from = params.from || params.startDate;
    const to = params.to || params.endDate;
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return request(`/api/ledger/party?${qs.toString()}`);
  },

  async collectCreditInvoices(payload: CollectCreditPayload): Promise<CollectCreditResult> {
    assertBoundSessionMatches();
    const token = getAuthToken();
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return runWithTimeout(undefined, async (signal) => {
      const res = await fetch('/api/invoices/collect-credit', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal
      });
      if (res.status === 401) {
        let errJson: any = null;
        try { errJson = await res.json(); } catch (_) {}
        if (errJson?.expired && sessionExpiredHandler) {
          sessionExpiredHandler();
        }
        throw new Error(errJson?.error || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا');
      }
      const data: any = await res.json().catch(() => ({}));
      if (data?.code === 'SHEETS_UNAVAILABLE' || data?.code === 'UNKNOWN_RESULT' || res.status === 503 || res.status === 504) {
        emitApiStatus({
          type: 'SHEETS_ERROR',
          code: data?.code === 'UNKNOWN_RESULT' || res.status === 504 ? 'UNKNOWN_RESULT' : 'SHEETS_UNAVAILABLE',
          message: data?.error || 'تعذر الاتصال بقاعدة البيانات'
        });
      } else if (data?.success) {
        emitApiStatus({ type: 'LIVE_DATA' });
      }
      return data as CollectCreditResult;
    });
  },

  // Cart Journal (Background Unsold POS Items)
  async sendCartJournalEvents(
    payload: { deviceId: string; events: unknown[] },
    keepalive: boolean
  ): Promise<{ lastSeq: number }> {
    assertBoundSessionMatches();
    const token = getAuthToken();
    if (!token) {
      throw new Error('لا توجد جلسة نشطة');
    }
    const isOfflineSession =
      (typeof localStorage !== 'undefined' && localStorage.getItem('pos_session_offline') === 'true') ||
      token.startsWith('offline_');
    if (isOfflineSession) {
      throw new Error('الجلسة الحالية أوفلاين');
    }

    const res = await fetch('/api/cart-journal/events', {
      method: 'POST',
      keepalive: Boolean(keepalive),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data: any = await res.json().catch(() => null);
    if (!data || !data.success || !Number.isFinite(Number(data.lastSeq))) {
      throw new Error(data?.error || 'استجابة غير صالحة من الخادم');
    }
    return { lastSeq: Number(data.lastSeq) };
  },

  async getUnsoldCartItemsReport(filters: {
    from?: string;
    to?: string;
    userId?: string;
    status?: string;
    event?: string;
  } = {}): Promise<UnsoldCartItemsReport> {
    const qs = new URLSearchParams();
    if (filters.from) {
      qs.set('from', toCairoDateBoundaryIso(filters.from, 'start'));
    }
    if (filters.to) {
      qs.set('to', toCairoDateBoundaryIso(filters.to, 'end'));
    }
    if (filters.userId && filters.userId !== 'ALL') {
      qs.set('userId', filters.userId);
    }
    if (filters.status && filters.status !== 'ALL') {
      qs.set('status', filters.status);
    }
    if (filters.event && filters.event !== 'ALL') {
      qs.set('event', filters.event);
    }
    const queryStr = qs.toString() ? `?${qs.toString()}` : '';
    const res = await request<{ success: boolean; report: UnsoldCartItemsReport; error?: string }>(
      `/api/reports/unsold-cart-items${queryStr}`
    );
    if (!res.success || !res.report) {
      throw new Error(res.error || 'تعذر تحميل تقرير أصناف شاشة البيع غير المباعة');
    }
    return res.report;
  },

  // Bank-Linked Cashboxes & SMS Templates
  async getBankLinkOverview(): Promise<BankLinkOverviewResponse> {
    return request<BankLinkOverviewResponse>('/api/bank-link/overview');
  },

  async saveBankLinkAccount(payload: {
    id?: string;
    name: string;
    cashboxId: string;
    senders: string[];
    accountSuffix?: string;
    matchWindowMinutes?: number;
    enabled?: boolean;
  }): Promise<{ success: boolean; account: any; error?: string }> {
    return request('/api/bank-link/accounts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async setBankLinkAccountEnabled(
    id: string,
    enabled: boolean
  ): Promise<{ success: boolean; account: any; error?: string }> {
    return request(`/api/bank-link/accounts/${encodeURIComponent(id)}/enabled`, {
      method: 'POST',
      body: JSON.stringify({ enabled })
    });
  },

  async deleteBankLinkAccount(id: string): Promise<{ success: boolean; error?: string }> {
    return request(`/api/bank-link/accounts/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  async regenerateBankLinkIntakeKey(): Promise<{ success: boolean; intakeKey: string; error?: string }> {
    return request('/api/bank-link/intake-key/regenerate', {
      method: 'POST',
      body: JSON.stringify({})
    });
  },

  async saveBankLinkTemplate(payload: {
    id?: string;
    name: string;
    sender: string;
    pattern: string;
    direction: BankLinkTemplateDirection;
    enabled: boolean;
  }): Promise<{ success: boolean; template: BankLinkTemplate; error?: string }> {
    return request('/api/bank-link/templates', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async deleteBankLinkTemplate(id: string): Promise<{ success: boolean; error?: string }> {
    return request(`/api/bank-link/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  async suggestBankLinkTemplate(payload: {
    text: string;
  }): Promise<{
    success: boolean;
    pattern: string;
    direction: BankLinkTemplateDirection;
    reading: BankLinkMessageReading;
    error?: string;
  }> {
    const res = await request<any>('/api/bank-link/templates/suggest', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const src = res?.suggestion ?? res;
    return {
      success: Boolean(res?.success),
      pattern: String(src?.pattern || ''),
      direction: (src?.direction || 'auto') as BankLinkTemplateDirection,
      reading: src?.reading
    };
  },

  async testBankLinkTemplate(payload: {
    text: string;
    sender: string;
  }): Promise<{ success: boolean; reading: BankLinkMessageReading; error?: string }> {
    return request('/api/bank-link/templates/test', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async exportBankLinkTemplates(): Promise<{
    success: boolean;
    templates: BankLinkTemplate[];
    error?: string;
  }> {
    return request('/api/bank-link/templates/export');
  },

  async importBankLinkTemplates(payload: {
    templates: unknown[];
  }): Promise<{
    success: boolean;
    added: number;
    templates: BankLinkTemplate[];
    error?: string;
  }> {
    return request('/api/bank-link/templates/import', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async getBankLinkMessage(id: string): Promise<{
    success: boolean;
    message: { sender: string; text: string; at: string };
    error?: string;
  }> {
    return request(`/api/bank-link/messages/${encodeURIComponent(id)}`);
  },

  // Manual Balance Tracking (Privacy Mode — without reading SMS)
  async getManualBalanceRequests(options?: { background?: boolean }): Promise<ManualBalanceRequestsResponse> {
    return request<ManualBalanceRequestsResponse>('/api/bank-link/balance-requests', { background: options?.background });
  },

  async submitManualBalance(
    accountId: string,
    payload: { balance: string | number }
  ): Promise<{
    success: boolean;
    entry: ManualBalanceEntry;
    requests: ManualBalanceRequest[];
    error?: string;
  }> {
    return request(`/api/bank-link/balance-requests/${encodeURIComponent(accountId)}/submit`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async postponeManualBalance(accountId: string): Promise<{
    success: boolean;
    request: ManualBalanceRequest;
    requests: ManualBalanceRequest[];
    error?: string;
  }> {
    return request(`/api/bank-link/balance-requests/${encodeURIComponent(accountId)}/postpone`, {
      method: 'POST',
      body: JSON.stringify({})
    });
  },

  async getManualBalanceOverview(): Promise<ManualBalanceOverviewResponse> {
    return request<ManualBalanceOverviewResponse>('/api/bank-link/manual/overview');
  },

  async saveManualBalanceAccount(payload: {
    id?: string;
    name: string;
    cashboxId: string;
    responsibleUserIds: string[];
    scheduleType: 'daily' | 'weekdays';
    time: string;
    weekdays: number[];
    mandatory: boolean;
    enabled?: boolean;
  }): Promise<{ success: boolean; account: any; error?: string }> {
    return request('/api/bank-link/manual/accounts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async setManualBalanceAccountEnabled(
    id: string,
    enabled: boolean
  ): Promise<{ success: boolean; account: any; error?: string }> {
    return request(`/api/bank-link/manual/accounts/${encodeURIComponent(id)}/enabled`, {
      method: 'POST',
      body: JSON.stringify({ enabled })
    });
  },

  async deleteManualBalanceAccount(id: string): Promise<{ success: boolean; error?: string }> {
    return request(`/api/bank-link/manual/accounts/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  async markManualBalanceEntryReviewed(id: string): Promise<{
    success: boolean;
    entry: ManualBalanceEntry;
    alerts: ManualBalanceAlert[];
    error?: string;
  }> {
    return request(`/api/bank-link/manual/entries/${encodeURIComponent(id)}/reviewed`, {
      method: 'POST',
      body: JSON.stringify({})
    });
  },

  // Delivery Settings & Master Data
  async getDeliverySettings(): Promise<DeliverySettingsResponse> {
    return request<DeliverySettingsResponse>('/api/delivery/settings');
  },

  async saveDeliverySettings(payload: {
    enabled?: boolean;
    mode?: DeliveryMode;
    zonePricing?: boolean;
    fixedFee?: number;
    maxDriverCustody?: number;
    lateAfterHours?: number;
    prepSlip?: Partial<DeliveryPrepSlipSettings>;
  }): Promise<DeliverySettingsSaveResponse> {
    return request<DeliverySettingsSaveResponse>('/api/delivery/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async saveDeliveryZone(payload: {
    id?: string;
    name: string;
    customerFee?: number;
    driverCommission?: number;
    minOrderValue?: number;
    active?: boolean;
  }): Promise<DeliveryMasterSaveResponse<DeliveryZone>> {
    return request<DeliveryMasterSaveResponse<DeliveryZone>>('/api/delivery/zones', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async saveDeliveryDriver(payload: {
    id?: string;
    name: string;
    phone?: string;
    monthlySalary?: number;
    commissionPerOrder?: number;
    userId?: string;
    active?: boolean;
  }): Promise<DeliveryMasterSaveResponse<DeliveryDriver>> {
    return request<DeliveryMasterSaveResponse<DeliveryDriver>>('/api/delivery/drivers', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async saveDeliveryCourier(payload: {
    id?: string;
    name: string;
    feePerOrder?: number;
    active?: boolean;
  }): Promise<DeliveryMasterSaveResponse<DeliveryCourier>> {
    return request<DeliveryMasterSaveResponse<DeliveryCourier>>('/api/delivery/couriers', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // Delivery Config & Orders
  async getDeliveryConfig(): Promise<DeliveryConfigResponse> {
    return request<DeliveryConfigResponse>('/api/delivery/config');
  },

  async getDeliveryOrders(params: DeliveryOrdersListParams = {}): Promise<DeliveryOrdersListResponse> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.assigneeType) query.set('assigneeType', params.assigneeType);
    if (params.assigneeId) query.set('assigneeId', params.assigneeId);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.open) query.set('open', '1');
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request<DeliveryOrdersListResponse>(`/api/delivery/orders${qs}`);
  },

  async assignDeliveryOrder(
    orderId: string,
    payload: DeliveryAssignOrderPayload
  ): Promise<DeliveryAssignOrderResponse> {
    return request<DeliveryAssignOrderResponse>(
      `/api/delivery/orders/${encodeURIComponent(orderId)}/assign`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  },

  async changeDeliveryOrderStatus(
    orderId: string,
    payload: DeliveryChangeOrderStatusPayload
  ): Promise<DeliveryChangeOrderStatusResponse> {
    return request<DeliveryChangeOrderStatusResponse>(
      `/api/delivery/orders/${encodeURIComponent(orderId)}/status`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  },

  // Delivery Settlements & Driver Payouts
  async getDeliverySettlementPreview(
    assigneeType: DeliveryAssigneeType,
    assigneeId: string
  ): Promise<DeliverySettlementPreviewResponse> {
    const query = new URLSearchParams({
      assigneeType,
      assigneeId
    });
    return request<DeliverySettlementPreviewResponse>(
      `/api/delivery/settlement-preview?${query.toString()}`
    );
  },

  async settleDelivery(payload: DeliverySettlePayload): Promise<DeliverySettleResponse> {
    assertBoundSessionMatches();
    const token = getAuthToken();
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return runWithTimeout(undefined, async (signal) => {
      const res = await fetch('/api/delivery/settle', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal
      });
      if (res.status === 401) {
        let errJson: any = null;
        try { errJson = await res.json(); } catch (_) {}
        const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (!isBrowserOffline && sessionExpiredHandler) {
          sessionExpiredHandler();
        }
        const err = new Error(errJson?.error || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا');
        (err as any).status = 401;
        (err as any).code = errJson?.code;
        throw err;
      }
      const data: any = await res.json().catch(() => ({}));
      if (res.status === 423 && data?.code === 'BALANCE_REQUIRED') {
        emitApiStatus({
          type: 'BALANCE_REQUIRED',
          accountId: data?.accountId ? String(data.accountId) : undefined,
          message: data?.error || 'مطلوب إدخال رصيد الحساب البنكي'
        });
        const err = new Error(data?.error || 'مطلوب إدخال رصيد الحساب البنكي');
        (err as any).status = 423;
        (err as any).code = 'BALANCE_REQUIRED';
        throw err;
      }
      if (data?.requiresConfirmation === true) {
        return data as DeliverySettleResponse;
      }
      if (!res.ok) {
        if (data?.code === 'SHEETS_UNAVAILABLE' || data?.code === 'UNKNOWN_RESULT' || res.status === 503 || res.status === 504) {
          emitApiStatus({
            type: 'SHEETS_ERROR',
            code: data?.code === 'UNKNOWN_RESULT' || res.status === 504 ? 'UNKNOWN_RESULT' : 'SHEETS_UNAVAILABLE',
            message: data?.error || 'تعذر الاتصال بقاعدة البيانات'
          });
        }
        const err = new Error(data?.error || 'تعذر تسجيل التسوية');
        (err as any).status = res.status;
        (err as any).code = data?.code;
        throw err;
      }
      emitApiStatus({ type: 'LIVE_DATA' });
      return data as DeliverySettleResponse;
    });
  },

  async getDeliverySettlements(
    params: DeliverySettlementsListParams = {}
  ): Promise<DeliverySettlementsListResponse> {
    const query = new URLSearchParams();
    if (params.assigneeType) query.set('assigneeType', params.assigneeType);
    if (params.assigneeId) query.set('assigneeId', params.assigneeId);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request<DeliverySettlementsListResponse>(`/api/delivery/settlements${qs}`);
  },

  async getDeliveryDriverDues(driverId: string): Promise<DeliveryDriverDuesResponse> {
    return request<DeliveryDriverDuesResponse>(
      `/api/delivery/drivers/${encodeURIComponent(driverId)}/dues`
    );
  },

  async getDeliveryPayoutPreview(
    params: DeliveryPayoutPreviewParams
  ): Promise<DeliveryPayoutPreviewResponse> {
    const query = new URLSearchParams({
      driverId: params.driverId,
      salary: String(params.salary),
      payCommission: String(params.payCommission),
      deductShortage: String(params.deductShortage)
    });
    return request<DeliveryPayoutPreviewResponse>(
      `/api/delivery/payout-preview?${query.toString()}`
    );
  },

  async createDeliveryDriverPayout(
    payload: DeliveryPayoutPayload
  ): Promise<DeliveryPayoutResponse> {
    assertBoundSessionMatches();
    const token = getAuthToken();
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return runWithTimeout(undefined, async (signal) => {
      const res = await fetch('/api/delivery/payouts', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal
      });
      if (res.status === 401) {
        let errJson: any = null;
        try { errJson = await res.json(); } catch (_) {}
        const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (!isBrowserOffline && sessionExpiredHandler) {
          sessionExpiredHandler();
        }
        const err = new Error(errJson?.error || 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا');
        (err as any).status = 401;
        (err as any).code = errJson?.code;
        throw err;
      }
      const data: any = await res.json().catch(() => ({}));
      if (res.status === 423 && data?.code === 'BALANCE_REQUIRED') {
        emitApiStatus({
          type: 'BALANCE_REQUIRED',
          accountId: data?.accountId ? String(data.accountId) : undefined,
          message: data?.error || 'مطلوب إدخال رصيد الحساب البنكي'
        });
        const err = new Error(data?.error || 'مطلوب إدخال رصيد الحساب البنكي');
        (err as any).status = 423;
        (err as any).code = 'BALANCE_REQUIRED';
        throw err;
      }
      if (data?.requiresConfirmation === true) {
        return data as DeliveryPayoutResponse;
      }
      if (!res.ok) {
        if (data?.code === 'SHEETS_UNAVAILABLE' || data?.code === 'UNKNOWN_RESULT' || res.status === 503 || res.status === 504) {
          emitApiStatus({
            type: 'SHEETS_ERROR',
            code: data?.code === 'UNKNOWN_RESULT' || res.status === 504 ? 'UNKNOWN_RESULT' : 'SHEETS_UNAVAILABLE',
            message: data?.error || 'تعذر الاتصال بقاعدة البيانات'
          });
        }
        const err = new Error(data?.error || 'تعذر صرف مستحقات الطيار');
        (err as any).status = res.status;
        (err as any).code = data?.code;
        throw err;
      }
      emitApiStatus({ type: 'LIVE_DATA' });
      return data as DeliveryPayoutResponse;
    });
  },

  // Driver "My Orders" (session-scoped on server; never sends driverId/userId)
  async getDeliveryMyOrders(): Promise<DeliveryMyOrdersResponse> {
    return request<DeliveryMyOrdersResponse>('/api/delivery/my-orders');
  },

  async updateDeliveryMyOrderStatus(
    orderId: string,
    payload: DeliveryDriverUpdateStatusPayload
  ): Promise<DeliveryDriverUpdateStatusResponse> {
    return request<DeliveryDriverUpdateStatusResponse>(
      `/api/delivery/my-orders/${encodeURIComponent(orderId)}/status`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  },

  // Delivery Reports
  async getDeliveryReports(
    params: DeliveryReportsParams = {}
  ): Promise<DeliveryReportsResponse> {
    const query = new URLSearchParams();
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return request<DeliveryReportsResponse>(`/api/delivery/reports${qs}`);
  }
};





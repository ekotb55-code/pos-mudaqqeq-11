/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  Smartphone,
  WifiOff,
  FolderOpen,
  HardDrive,
  Bell,
  Users,
  LogOut,
  X
} from 'lucide-react';
import {
  PageType,
  Item,
  Platform,
  ItemPlatformCost,
  Invoice,
  ReturnRecord,
  SystemConfig,
  ReportsData,
  UserAccount,
  UserRole,
  AuthSession,
  ProductCategory,
  AppTheme,
  MotionMode,
  Customer,
  isValidAppTheme,
  ManualBalanceRequest,
  ManualBalanceAlert,
  ManualBalanceEntry,
  SalesRules,
  normalizeInactivityTimeoutMinutes
} from './types';
import { normalizeLatestItemFirst } from './shared/latestItemFirst';
import {
  api,
  setAuthToken,
  setOnSessionExpired,
  setOnSessionMismatch,
  setBoundSessionIdentity,
  getBoundSessionIdentity,
  subscribeApiStatus,
  getLastUserInteractionAt,
  getLastLocalDomInteractionAt,
  getLastForegroundApiActivitySentAt,
  recordUserInteraction
} from './api/client';
import {
  requestPersistentStorageOnFirstEntry,
  ensureDeviceIdentity,
  loadOfflineSnapshot,
  saveOfflineSnapshot,
  updateOfflineCachedSalesRules,
  syncFullStoresToOfflineDb,
  createOfflineInvoiceInDb,
  getPendingOfflineInvoices,
  getOutboxPendingCount,
  syncOutboxOperations,
  getMetaValue,
  recordOfflineAuthEventInOutbox,
  getDecryptedOfflineUsers,
  getBackupDirectoryStatus,
  activateBackupDirectoryPermission,
  checkStorageQuotaStatus,
  triggerHourlyPendingOperationsAlert,
  canPerformFinalLogoutOrClearData,
  applyDataEpochTransition,
  BackupDirectoryStatus,
  StorageQuotaStatus,
  subscribeOfflineDb
} from './offline/db';
import { acquireOfflineLock, releaseOfflineLock, hasOfflineLockOwnership } from './offline/offlineLock';
import { useOfflineMode, subscribeOutboxSynced } from './hooks/useOfflineMode';
import { getCartJournal } from './offline/cartJournalInstance';
import {
  SESSION_META_STORAGE_KEY,
  clearSharedHumanActivity,
  computeSessionTag,
  getOrInitTabId,
  postTabSyncMessage,
  subscribeTabSyncMessages,
  writeSessionMeta
} from './utils/tabSession';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { PrintReceiptModal } from './components/PrintReceiptModal';
import { ReceiptPrintArea } from './components/ReceiptPrintArea';
import { AboutModal } from './components/AboutModal';
import { InitialAccountSetupModal } from './components/InitialAccountSetupModal';
import { ManualBalanceModal, BANK_LINK_FOCUS_ALERTS_STORAGE_KEY } from './components/ManualBalancePrompt';
import { printReceipt } from './utils/printReceipt';
import { PrintCompanyProvider } from './components/ui';
import { KeyboardShortcutsProvider } from './context/KeyboardShortcutsContext';

// Pages
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductFormPage } from './pages/ProductFormPage';
import { POSPage } from './pages/POSPage';
import { PlatformsPage } from './pages/PlatformsPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { ReturnsPage } from './pages/ReturnsPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { CustomersPage } from './pages/CustomersPage';
import { CashboxesPage } from './pages/CashboxesPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PermissionsPage } from './pages/PermissionsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { BulkEditExcelPage } from './pages/BulkEditExcelPage';
import { SyncPage } from './pages/SyncPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { WarehouseTransferPage } from './pages/WarehouseTransferPage';
import { WarehouseExcelTransferPage } from './pages/WarehouseExcelTransferPage';
import { WarehouseDispatchOrdersPage } from './pages/WarehouseDispatchOrdersPage';
import { VisitorDisplayPage } from './pages/VisitorDisplayPage';
import { LabelPrintPage } from './pages/LabelPrintPage';
import { DeliverySettingsPage } from './pages/DeliverySettingsPage';
import { DeliveryOrdersPage } from './pages/DeliveryOrdersPage';
import { DeliverySettlementsPage } from './pages/DeliverySettlementsPage';
import { DeliveryMyOrdersPage } from './pages/DeliveryMyOrdersPage';
import { DeliveryReportsPage } from './pages/DeliveryReportsPage';
import CreditCollectionView from './components/CreditCollectionView';
import { hasPermission, isSystemOwner } from './utils/permissions';
import {
  normalizeNavigationTarget,
  resolvePathToTarget,
  findSubItemForTarget,
  canUserCreateItem,
  canUserEditItem,
  getHrefForTarget,
  getHrefForItemRoute,
  isPlainLeftClick,
  isVisitorScreenOnlyUser,
  isPageAllowedByFeatureModes,
  getDefaultHomeTarget,
  type FeatureModeFlags,
  type HrefBuildOptions
} from './config/navigation';
import {
  readUiPrefs,
  applyUiPrefs,
  UI_PREFS_EVENT,
  UI_PREFS_STORAGE_KEY,
  UiPrefs
} from './utils/uiScale';

const OFFLINE_SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 دقائق
const HOURLY_PENDING_ALERT_INTERVAL_MS = 60 * 60 * 1000; // كل ساعة
const SALES_RULES_CACHE_KEY = 'mudaqqeq_sales_rules_cache_v1';

function getCurrentBrowserUrl(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
}

function readUrlSearchParam(rawUrl: string, key: string): string {
  try {
    const parsed = new URL(rawUrl || '/', 'http://local');
    return parsed.searchParams.get(key) || '';
  } catch {
    return '';
  }
}

function readCachedSalesRules(): SalesRules | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(SALES_RULES_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const salesOnlyMode = Boolean(parsed.salesOnlyMode);
    const platformsEnabled = salesOnlyMode ? false : parsed.platformsEnabled !== false;
    return { ...parsed, salesOnlyMode, platformsEnabled };
  } catch {
    return undefined;
  }
}

function persistCachedSalesRules(rules?: SalesRules | null) {
  if (typeof window === 'undefined' || !rules) return;
  try {
    const salesOnlyMode = Boolean(rules.salesOnlyMode);
    const platformsEnabled = salesOnlyMode ? false : rules.platformsEnabled !== false;
    localStorage.setItem(
      SALES_RULES_CACHE_KEY,
      JSON.stringify({ ...rules, salesOnlyMode, platformsEnabled })
    );
  } catch {
    // ignore storage errors
  }
}

function haveUserPermissionsOrIdentityChanged(prev: UserAccount, next: UserAccount): boolean {
  if (
    prev.id !== next.id ||
    prev.role !== next.role ||
    Boolean(prev.isOwner) !== Boolean(next.isOwner) ||
    Boolean(prev.mustChangePassword) !== Boolean(next.mustChangePassword) ||
    prev.status !== next.status ||
    prev.name !== next.name ||
    prev.username !== next.username
  ) {
    return true;
  }
  const prevPerms = Array.isArray(prev.permissions) ? [...prev.permissions].sort().join('|') : '';
  const nextPerms = Array.isArray(next.permissions) ? [...next.permissions].sort().join('|') : '';
  if (prevPerms !== nextPerms) return true;
  if (JSON.stringify(prev.cashboxConfig || null) !== JSON.stringify(next.cashboxConfig || null)) {
    return true;
  }
  return false;
}

export default function App() {
  const {
    isOnline,
    isOffline,
    deviceId,
    deviceName,
    deviceNameConfigured,
    setDeviceName
  } = useOfflineMode();

  // Current user state (persisted in localStorage) + ربط هوية جلسة هذا التبويب لمنع استخدام رمز مستخدم آخر
  const [user, setUser] = useState<UserAccount | null>(() => {
    const saved = localStorage.getItem('pos_user');
    const token = localStorage.getItem('pos_token');
    if (saved && token) {
      try {
        const parsedUser = JSON.parse(saved) as UserAccount;
        const tag = computeSessionTag(token, parsedUser?.id);
        if (parsedUser?.id && tag) {
          const identity = { userId: parsedUser.id, sessionTag: tag };
          setBoundSessionIdentity(identity);
          writeSessionMeta(identity);
        }
        return parsedUser;
      } catch (_) {}
    }
    return null;
  });

  // يمنع عرض أي صفحة أو بيانات محمية اعتمادًا على صلاحيات localStorage المخبأة قبل التحقق من الخادم (أو مخزن users المشفر أوفلاين)
  const [isAuthPermissionsVerified, setIsAuthPermissionsVerified] = useState<boolean>(() => !user);

  const tabId = useMemo(() => getOrInitTabId(), []);

  // Language state: Arabic by default, persisted in localStorage
  const [lang, setLang] = useState<'en' | 'ar'>(() => {
    try {
      const saved = localStorage.getItem('mudaqqeq_lang');
      if (saved === 'ar' || saved === 'en') return saved;
    } catch (_) {}
    return 'ar';
  });

  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  // Visual Identity Theme: Light Sky is default for new users, persisted in localStorage
  const [appTheme, setAppTheme] = useState<AppTheme>(() => {
    try {
      const saved = localStorage.getItem('mudaqqeq_theme');
      if (isValidAppTheme(saved)) {
        return saved;
      }
    } catch (_) {}
    return 'light-sky';
  });

  // Motion & Animation setting: 'on' or 'off', defaults to respecting prefers-reduced-motion
  const [motionMode, setMotionMode] = useState<MotionMode>(() => {
    try {
      const saved = localStorage.getItem('mudaqqeq_motion');
      if (saved === 'on' || saved === 'off') {
        return saved as MotionMode;
      }
    } catch (_) {}
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 'off';
    }
    return 'on';
  });

  // Synchronize theme to document element and localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', appTheme);
    try {
      localStorage.setItem('mudaqqeq_theme', appTheme);
    } catch (_) {}
  }, [appTheme]);

  // Synchronize motion setting to document element and localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-motion', motionMode);
    try {
      localStorage.setItem('mudaqqeq_motion', motionMode);
    } catch (_) {}
  }, [motionMode]);

  const [bootCachedRules] = useState<SalesRules | undefined>(() => readCachedSalesRules());
  const bootFeatureFlags: FeatureModeFlags = {
    salesOnlyMode: Boolean(bootCachedRules?.salesOnlyMode),
    platformsEnabled: !bootCachedRules?.salesOnlyMode && bootCachedRules?.platformsEnabled !== false
  };

  const [currentPage, setCurrentPage] = useState<PageType>(() => {
    if (typeof window === 'undefined') return bootFeatureFlags.salesOnlyMode ? 'pos' : 'dashboard';
    return resolvePathToTarget(getCurrentBrowserUrl(), user, bootFeatureFlags).page;
  });
  const [currentTab, setCurrentTab] = useState<string | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    return resolvePathToTarget(getCurrentBrowserUrl(), user, bootFeatureFlags).tab;
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => currentPage === 'pos' || currentPage === 'settings'
  );

  // مسار صفحة الصنف المستقلة (/items/new أو /items/:id)
  const [itemRoute, setItemRoute] = useState<
    { mode: 'new' } | { mode: 'edit'; itemId: string } | null
  >(() => {
    if (typeof window === 'undefined') return null;
    return resolvePathToTarget(getCurrentBrowserUrl(), user, bootFeatureFlags).itemRoute ?? null;
  });
  const [isItemFormDirty, setIsItemFormDirty] = useState(false);
  const [isSettingsDirty, setIsSettingsDirty] = useState(false);
  const settingsRevertRef = useRef<(() => void) | null>(null);
  const [pendingNavConfirm, setPendingNavConfirm] = useState<{
    open: boolean;
    source?: 'item' | 'settings';
    onConfirm: () => void;
  } | null>(null);

  useEffect(() => {
    if (!isSettingsDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isSettingsDirty]);

  // في صفحتي POS وإعدادات البرنامج: تُعرض القائمة الجانبية بالحالة المدمجة ذات الأيقونات فقط (64px)، وعند الخروج لصفحة أخرى تعود لطبيعتها
  useEffect(() => {
    if (currentPage === 'pos' || currentPage === 'settings') {
      setIsSidebarCollapsed(true);
    } else {
      setIsSidebarCollapsed(false);
    }
  }, [currentPage]);

  // إعدادات حجم وشكل الواجهة لكل جهاز (محليًا في localStorage)
  const [uiPrefs, setUiPrefs] = useState<UiPrefs>(() => readUiPrefs());

  useEffect(() => {
    const handlePrefsUpdate = (e: Event) => {
      const custom = e as CustomEvent<UiPrefs>;
      setUiPrefs(custom.detail ? custom.detail : readUiPrefs());
    };
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key === UI_PREFS_STORAGE_KEY) {
        setUiPrefs(readUiPrefs());
      }
    };
    window.addEventListener(UI_PREFS_EVENT, handlePrefsUpdate);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(UI_PREFS_EVENT, handlePrefsUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const OFFLINE_FORBIDDEN_PAGES: PageType[] = [
    'returns',
    'purchases',
    'cashboxes',
    'bulk_edit_excel',
    'categories',
    'platforms',
    'settings',
    'delivery_settings',
    'delivery_orders',
    'delivery_settlements',
    'delivery_my_orders',
    'delivery_reports'
  ];

  // System Config
  const [config, setConfig] = useState<SystemConfig>({
    appsScriptUrl: '',
    port: 3000,
    isGoogleSheetsConnected: false,
    storeName: 'POS مدقق للمنصات الإلكترونية',
    currency: 'EGP',
    hasOwner: false,
    hasManager: true,
    enableDeliveryFee: false,
    stockSettings: {
      allowNegativeStockSale: false,
      allowNegativeWarehouseTransfer: false
    },
    salesRules: bootCachedRules
  });

  const featureFlags = useMemo<FeatureModeFlags>(() => {
    const sr = config.salesRules;
    const salesOnlyMode = Boolean(sr?.salesOnlyMode);
    const platformsEnabled = !salesOnlyMode && sr?.platformsEnabled !== false;
    return { salesOnlyMode, platformsEnabled };
  }, [config.salesRules]);

  const executeNavigate = useCallback(
    (page: PageType, tab?: string, navOptions?: Pick<HrefBuildOptions, 'searchParams' | 'hash'>) => {
      const normalized = normalizeNavigationTarget(page, tab, user, featureFlags);
      const targetUrl = getHrefForTarget(page, tab, {
        searchParams: navOptions?.searchParams,
        hash: navOptions?.hash,
        user,
        flags: featureFlags
      });
      setIsItemFormDirty(false);
      setIsSettingsDirty(false);
      setItemRoute(null);
      setEditingItem(null);
      setCurrentPage(normalized.page);
      setCurrentTab(normalized.tab);
      setIsMobileMenuOpen(false);
      if (navOptions?.searchParams) {
        if ('search' in navOptions.searchParams) {
          setDeliveryOrdersInitialSearch(String(navOptions.searchParams.search || ''));
        }
        if ('supplierId' in navOptions.searchParams) {
          setPurchasesInitialSupplierId(String(navOptions.searchParams.supplierId || ''));
        }
        if ('customerId' in navOptions.searchParams) {
          setCustomersInitialCustomerId(String(navOptions.searchParams.customerId || ''));
        }
        if ('cashboxId' in navOptions.searchParams) {
          setCashboxesInitialCashboxId(String(navOptions.searchParams.cashboxId || ''));
        }
        if ('platformId' in navOptions.searchParams) {
          setPlatformsInitialPlatformId(String(navOptions.searchParams.platformId || ''));
        }
        if ('category' in navOptions.searchParams) {
          setItemsInitialCategoryId(String(navOptions.searchParams.category || ''));
        }
        if ('operationType' in navOptions.searchParams) {
          setBulkEditOperationTypeParam(String(navOptions.searchParams.operationType || ''));
        }
      } else {
        setPurchasesInitialSupplierId('');
        setCustomersInitialCustomerId('');
        setCashboxesInitialCashboxId('');
        setPlatformsInitialPlatformId('');
        setItemsInitialCategoryId('');
        setBulkEditOperationTypeParam(
          page === 'bulk_edit_excel' && (tab === 'add_items' || tab === 'add_categories') ? tab : ''
        );
      }
      try {
        const currentFullPath = getCurrentBrowserUrl();
        if (currentFullPath !== targetUrl) {
          window.history.pushState({}, '', targetUrl);
        }
      } catch (_) {}
    },
    [user, featureFlags]
  );

  const handleNavigate = (
    page: PageType,
    tab?: string,
    navOptions?: Pick<HrefBuildOptions, 'searchParams' | 'hash'>
  ) => {
    if (isOffline && OFFLINE_FORBIDDEN_PAGES.includes(page)) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToastInvoiceMessage('متاح عند رجوع الاتصال');
      toastTimerRef.current = setTimeout(() => {
        setToastInvoiceMessage(null);
      }, 3000);
      return;
    }
    if (currentPage === 'items' && itemRoute && isItemFormDirty) {
      setPendingNavConfirm({
        open: true,
        source: 'item',
        onConfirm: () => {
          setPendingNavConfirm(null);
          executeNavigate(page, tab, navOptions);
        }
      });
      return;
    }
    if (currentPage === 'settings' && isSettingsDirty) {
      const normalizedTarget = normalizeNavigationTarget(page, tab, user, featureFlags);
      const isSameSettingsTab =
        normalizedTarget.page === 'settings' &&
        (!normalizedTarget.tab || normalizedTarget.tab === currentTab);
      if (!isSameSettingsTab) {
        setPendingNavConfirm({
          open: true,
          source: 'settings',
          onConfirm: () => {
            settingsRevertRef.current?.();
            setIsSettingsDirty(false);
            setPendingNavConfirm(null);
            executeNavigate(page, tab, navOptions);
          }
        });
        return;
      }
    }
    executeNavigate(page, tab, navOptions);
  };

  useEffect(() => {
    const shared = {
      showItemImages: config.displaySettings?.showItemImages,
      posLayout: config.displaySettings?.posLayout
    };
    if (!user || user.mustChangePassword) {
      applyUiPrefs(uiPrefs, false, document.documentElement, shared);
      return;
    }
    applyUiPrefs(uiPrefs, currentPage === 'pos', document.documentElement, shared);
  }, [uiPrefs, currentPage, config.displaySettings?.showItemImages, config.displaySettings?.posLayout, user]);

  useEffect(() => {
    const fontName = (config.companySettings?.fontFamily || 'Tajawal').trim();
    const fontStack =
      fontName === 'Cairo'
        ? "'Cairo', 'Tajawal', -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif"
        : fontName === 'sans-serif'
        ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        : "'Tajawal', 'Cairo', -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif";
    document.documentElement.style.setProperty('--app-font-family', fontStack);
  }, [config.companySettings?.fontFamily]);

  // Data State
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [costs, setCosts] = useState<ItemPlatformCost[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [reports, setReports] = useState<ReportsData | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);
  const [staleInfo, setStaleInfo] = useState<{ stale: boolean; lastSyncAt: string | null }>({
    stale: false,
    lastSyncAt: null
  });
  const [isRetryingConnection, setIsRetryingConnection] = useState(false);

  // Modals & Navigation triggers
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [invoiceToPrint, setInvoiceToPrint] = useState<Invoice | null>(null);
  const [isReprint, setIsReprint] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoicePrintExtra, setInvoicePrintExtra] = useState<{ changeGiven?: number; customerBalanceAfter?: number }>({});
  const [preselectedInvoiceForReturn, setPreselectedInvoiceForReturn] = useState<Invoice | null>(null);
  const [deliveryOrdersInitialSearch, setDeliveryOrdersInitialSearch] = useState<string>(() =>
    readUrlSearchParam(getCurrentBrowserUrl(), 'search')
  );
  const [purchasesInitialSupplierId, setPurchasesInitialSupplierId] = useState<string>(() =>
    readUrlSearchParam(getCurrentBrowserUrl(), 'supplierId')
  );
  const [customersInitialCustomerId, setCustomersInitialCustomerId] = useState<string>(() =>
    readUrlSearchParam(getCurrentBrowserUrl(), 'customerId')
  );
  const [cashboxesInitialCashboxId, setCashboxesInitialCashboxId] = useState<string>(() =>
    readUrlSearchParam(getCurrentBrowserUrl(), 'cashboxId')
  );
  const [platformsInitialPlatformId, setPlatformsInitialPlatformId] = useState<string>(() =>
    readUrlSearchParam(getCurrentBrowserUrl(), 'platformId')
  );
  const [itemsInitialCategoryId, setItemsInitialCategoryId] = useState<string>(() =>
    readUrlSearchParam(getCurrentBrowserUrl(), 'category')
  );
  const [bulkEditOperationTypeParam, setBulkEditOperationTypeParam] = useState<string>(() =>
    readUrlSearchParam(getCurrentBrowserUrl(), 'operationType')
  );
  const [initialItemToSell, setInitialItemToSell] = useState<Item | null>(null);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

  const [toastInvoiceMessage, setToastInvoiceMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<any>(null);

  // طلبات الرصيد اليدوي وتنبيهات الفروق (تُفحص عند الدخول وكل 60 ثانية وعند الرجوع للنافذة وعند رد 423)
  const [manualBalanceRequests, setManualBalanceRequests] = useState<ManualBalanceRequest[]>([]);
  const [manualBalanceAlerts, setManualBalanceAlerts] = useState<ManualBalanceAlert[]>([]);
  const [dismissedManualDueKeys, setDismissedManualDueKeys] = useState<Record<string, string>>({});
  const [forcedManualRequestId, setForcedManualRequestId] = useState<string | null>(null);
  // بعد تسجيل الرصيد يختفي الطلب من القائمة؛ نحتفظ به هنا مع نتيجته حتى تبقى شاشة النتيجة ظاهرة إلى أن يضغط المستخدم «تم»
  const [manualBalanceResultHold, setManualBalanceResultHold] = useState<{ request: ManualBalanceRequest; entry: ManualBalanceEntry } | null>(null);
  const [balanceRequiredBanner, setBalanceRequiredBanner] = useState<string | null>(null);

  const showInvoiceToast = (invoiceNumber: string, deliveryOrderId?: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastInvoiceMessage(
      deliveryOrderId
        ? `تم حفظ الفاتورة ${invoiceNumber} • طلب التوصيل ${deliveryOrderId}`
        : `تم حفظ الفاتورة ${invoiceNumber}`
    );
    toastTimerRef.current = setTimeout(() => {
      setToastInvoiceMessage(null);
    }, deliveryOrderId ? 5000 : 3000);
  };

  const [showDeviceNamePrompt, setShowDeviceNamePrompt] = useState(false);
  const [devicePromptDraft, setDevicePromptDraft] = useState('');

  // حالة النسخ الاحتياطي وتنبيهات التخزين والتنبيه الساعي وحماية تسجيل الخروج النهائي
  const [backupDirStatus, setBackupDirStatus] = useState<BackupDirectoryStatus | null>(null);
  const [storageQuotaStatus, setStorageQuotaStatus] = useState<StorageQuotaStatus | null>(null);
  const [hourlyAlertBanner, setHourlyAlertBanner] = useState<{
    message: string;
    pendingCount: number;
    downloadedFallbackFile: boolean;
  } | null>(null);
  const [logoutGuardModal, setLogoutGuardModal] = useState<{
    open: boolean;
    pendingCount: number;
    reason: string;
  } | null>(null);

  const refreshBackupAndStorageStatus = useCallback(async () => {
    try {
      const [dirStat, quotaStat, pendingCnt] = await Promise.all([
        getBackupDirectoryStatus(),
        checkStorageQuotaStatus(),
        getOutboxPendingCount().catch(() => 0)
      ]);
      setBackupDirStatus(dirStat);
      setStorageQuotaStatus(quotaStat);
      if (pendingCnt === 0) {
        setHourlyAlertBanner(null);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    refreshBackupAndStorageStatus();
    return subscribeOfflineDb(() => {
      refreshBackupAndStorageStatus();
    });
  }, [refreshBackupAndStorageStatus]);

  // تنبيه كل ساعة طالما توجد عمليات معلّقة: «عندك X عملية لم تُرفع بعد. وصّل الإنترنت في أقرب وقت» (البيع لا يتوقف)
  // وفي المتصفحات التي لا تدعم showDirectoryPicker يتم تنزيل ملف احتياطي بالعمليات المعلّقة مع كل تنبيه ساعة
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await triggerHourlyPendingOperationsAlert();
        if (res.shouldAlert && res.message) {
          setHourlyAlertBanner({
            message: res.message,
            pendingCount: res.pendingCount,
            downloadedFallbackFile: res.downloadedBackupFile
          });
        } else {
          setHourlyAlertBanner(null);
        }
      } catch (_) {}
    }, HOURLY_PENDING_ALERT_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [user]);

  const handleOneClickActivateBackup = async () => {
    const res = await activateBackupDirectoryPermission();
    await refreshBackupAndStorageStatus();
    if (res.permission === 'granted') {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToastInvoiceMessage(`تم تفعيل النسخ الاحتياطي للمجلد (${res.directoryName})`);
      toastTimerRef.current = setTimeout(() => {
        setToastInvoiceMessage(null);
      }, 3000);
    }
  };

  // طلب التخزين الدائم navigator.storage.persist() وتهيئة معرف الجهاز الثابت عند أول دخول
  useEffect(() => {
    requestPersistentStorageOnFirstEntry().catch(() => {});
    ensureDeviceIdentity()
      .then(identity => {
        setDevicePromptDraft(identity.deviceName || 'نقطة بيع 1');
        if (user && !identity.deviceNameConfigured) {
          setShowDeviceNamePrompt(true);
        }
      })
      .catch(() => {});
  }, [user]);

  // استرجاع البيانات المخزنة محليًا من IndexedDB لدعم الفتح أوفلاين فورًا مع التحقق من الصلاحيات المشفرة
  const hydrateFromOfflineDb = useCallback(async (activeUser: UserAccount) => {
    const snapshot = await loadOfflineSnapshot(activeUser);
    if (!snapshot) {
      setIsAuthPermissionsVerified(true);
      return false;
    }

    let effectiveUser = activeUser;
    if (snapshot.users.length > 0) {
      setUsers(snapshot.users);
      const offlineAuthoritativeUser = snapshot.users.find(u => u.id === activeUser.id);
      if (offlineAuthoritativeUser) {
        if (
          offlineAuthoritativeUser.status === 'inactive' ||
          offlineAuthoritativeUser.status === 'موقوف'
        ) {
          const bound = getBoundSessionIdentity();
          setBoundSessionIdentity(null);
          setUser(null);
          setIsAuthPermissionsVerified(true);
          localStorage.removeItem('pos_user');
          localStorage.removeItem('pos_token');
          localStorage.removeItem('pos_session_offline');
          localStorage.removeItem('pos_session_expires_at');
          writeSessionMeta(null);
          clearSharedHumanActivity();
          releaseOfflineLock();
          if (bound) {
            postTabSyncMessage({
              type: 'AUTH_EXPIRED',
              userId: bound.userId,
              sessionTag: bound.sessionTag,
              at: Date.now()
            });
          }
          setSessionExpiredNotice(true);
          return false;
        }
        const mergedOfflineUser: UserAccount = {
          ...activeUser,
          ...offlineAuthoritativeUser
        };
        delete (mergedOfflineUser as any).password;
        effectiveUser = mergedOfflineUser;
        if (haveUserPermissionsOrIdentityChanged(activeUser, mergedOfflineUser)) {
          setUser(mergedOfflineUser);
          localStorage.setItem('pos_user', JSON.stringify(mergedOfflineUser));
        }
      }
    }

    if (snapshot.items.length > 0) setItems(snapshot.items);
    if (snapshot.categories.length > 0) setCategories(snapshot.categories);
    if (snapshot.platforms.length > 0) setPlatforms(snapshot.platforms);
    if (snapshot.costs.length > 0) setCosts(snapshot.costs);
    if (snapshot.customers.length > 0) setCustomers(snapshot.customers);
    if (snapshot.invoices.length > 0) setInvoices(snapshot.invoices);
    if (snapshot.returns.length > 0) setReturns(snapshot.returns);

    let effectiveSalesRules = config.salesRules;
    if (snapshot.settings) {
      const s = snapshot.settings;
      if (s.salesRules) {
        effectiveSalesRules = { ...config.salesRules, ...s.salesRules };
        persistCachedSalesRules(s.salesRules);
      }
      setConfig(prev => ({
        ...prev,
        companySettings: s.companySettings ? { ...prev.companySettings, ...s.companySettings } : prev.companySettings,
        invoicePrintSettings: s.invoicePrintSettings
          ? { ...prev.invoicePrintSettings, ...s.invoicePrintSettings }
          : prev.invoicePrintSettings,
        displaySettings: s.displaySettings
          ? {
              ...prev.displaySettings,
              ...s.displaySettings,
              latestItemFirst: normalizeLatestItemFirst(
                s.displaySettings.latestItemFirst,
                prev.displaySettings?.latestItemFirst
              )
            }
          : prev.displaySettings,
        taxSettings: s.taxSettings ? { ...prev.taxSettings, ...s.taxSettings } : prev.taxSettings,
        stockSettings: s.stockSettings ? { ...prev.stockSettings, ...s.stockSettings } : prev.stockSettings,
        salesRules: s.salesRules ? { ...prev.salesRules, ...s.salesRules } : prev.salesRules,
        storeName: s.storeName ?? prev.storeName,
        currency: s.currency ?? prev.currency,
        enableDeliveryFee: s.enableDeliveryFee ?? s.companySettings?.enableDeliveryFee ?? prev.enableDeliveryFee
      }));
      if (isValidAppTheme(s.companySettings?.appTheme)) {
        setAppTheme(s.companySettings.appTheme);
      }
    }

    const salesOnlyOffline = Boolean(effectiveSalesRules?.salesOnlyMode);
    const offlineFlags: FeatureModeFlags = {
      salesOnlyMode: salesOnlyOffline,
      platformsEnabled: !salesOnlyOffline && effectiveSalesRules?.platformsEnabled !== false
    };
    const resolvedOfflineRoute = resolvePathToTarget(
      getCurrentBrowserUrl(),
      effectiveUser,
      offlineFlags
    );
    if (resolvedOfflineRoute.redirected) {
      try {
        window.history.replaceState({}, '', resolvedOfflineRoute.path);
      } catch (_) {}
    }
    setCurrentPage(resolvedOfflineRoute.page);
    setCurrentTab(resolvedOfflineRoute.tab);
    setItemRoute(resolvedOfflineRoute.itemRoute ?? null);

    if (snapshot.lastSyncAt) {
      setStaleInfo({
        stale: true,
        lastSyncAt: snapshot.lastSyncAt
      });
    }
    setIsAuthPermissionsVerified(true);
    return true;
  }, [config.salesRules]);

  // Handle session expiry & cross-tab user-switch mismatch from API interceptor (لا يوقف البيع أثناء انقطاع الإنترنت)
  useEffect(() => {
    setOnSessionExpired((msg?: string) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return;
      }
      const bound = getBoundSessionIdentity();
      const curToken = localStorage.getItem('pos_token');
      let curUserId = '';
      try {
        const raw = localStorage.getItem('pos_user');
        if (raw) curUserId = String(JSON.parse(raw)?.id || '');
      } catch (_) {}
      const curTag = curToken && curUserId ? computeSessionTag(curToken, curUserId) : '';
      const isSameStoredSession =
        !bound || !curToken || (curUserId === bound.userId && curTag === bound.sessionTag);

      setBoundSessionIdentity(null);
      setUser(null);
      if (isSameStoredSession) {
        localStorage.removeItem('pos_user');
        localStorage.removeItem('pos_token');
        localStorage.removeItem('pos_session_offline');
        localStorage.removeItem('pos_session_expires_at');
        writeSessionMeta(null);
        clearSharedHumanActivity();
        releaseOfflineLock();
        if (bound) {
          postTabSyncMessage({
            type: 'AUTH_EXPIRED',
            message: msg,
            userId: bound.userId,
            sessionTag: bound.sessionTag,
            at: Date.now()
          });
        }
      }
      setSessionExpiredMessage(msg || null);
      setSessionExpiredNotice(true);
    });

    setOnSessionMismatch((msg: string) => {
      // عدم حذف pos_token من localStorage هنا حتى لا نمسح جلسة المستخدم الأحدث في التبويب الآخر
      setBoundSessionIdentity(null);
      setUser(null);
      releaseOfflineLock();
      setSessionExpiredMessage(msg);
      setSessionExpiredNotice(true);
    });

    return () => {
      setOnSessionMismatch(null);
    };
  }, []);

  // مزامنة تسجيل الخروج وانتهاء الجلسة وتبديل المستخدم وتحديث المخزون أونلاين بين التبويبات
  useEffect(() => {
    const unsubMessages = subscribeTabSyncMessages((msg) => {
      if (msg.type === 'AUTH_LOGOUT') {
        const bound = getBoundSessionIdentity();
        if (!bound || !msg.sessionTag || msg.sessionTag === bound.sessionTag) {
          setBoundSessionIdentity(null);
          setUser(null);
          releaseOfflineLock();
          setSessionExpiredMessage('تم تسجيل الخروج من تبويب آخر؛ يرجى تسجيل الدخول مجددًا.');
          setSessionExpiredNotice(true);
        }
      } else if (msg.type === 'AUTH_EXPIRED') {
        const bound = getBoundSessionIdentity();
        if (!bound || !msg.sessionTag || msg.sessionTag === bound.sessionTag) {
          setBoundSessionIdentity(null);
          setUser(null);
          releaseOfflineLock();
          setSessionExpiredMessage(msg.message || 'انتهت صلاحية الجلسة في تبويب آخر؛ يرجى تسجيل الدخول مجددًا.');
          setSessionExpiredNotice(true);
        }
      } else if (msg.type === 'AUTH_SESSION_CHANGED') {
        const bound = getBoundSessionIdentity();
        if (bound && (msg.userId !== bound.userId || msg.sessionTag !== bound.sessionTag)) {
          setBoundSessionIdentity(null);
          setUser(null);
          releaseOfflineLock();
          setSessionExpiredMessage(
            'تم تبديل المستخدم أو بدء جلسة جديدة في تبويب آخر؛ يرجى إعادة تحميل الصفحة أو تسجيل الدخول للمتابعة.'
          );
          setSessionExpiredNotice(true);
        }
      } else if (msg.type === 'POS_STOCK_UPDATED') {
        if (msg.sourceTabId !== tabId && isOnline && !isOffline && getBoundSessionIdentity()) {
          api
            .getItems({ background: true })
            .then((r) => {
              if (r?.items) setItems(r.items);
            })
            .catch(() => {});
        }
      }
    });

    const handleStorageSessionSync = (e: StorageEvent) => {
      if (e.key !== 'pos_token' && e.key !== 'pos_user' && e.key !== SESSION_META_STORAGE_KEY && e.key !== null) {
        return;
      }
      const bound = getBoundSessionIdentity();
      if (!bound) return;

      const curToken = localStorage.getItem('pos_token');
      const rawUser = localStorage.getItem('pos_user');
      let curUserId = '';
      let parsedStoredUser: UserAccount | null = null;
      if (rawUser) {
        try {
          parsedStoredUser = JSON.parse(rawUser) as UserAccount;
          curUserId = String(parsedStoredUser?.id || '');
        } catch (_) {}
      }

      if (!curToken || !curUserId) {
        setBoundSessionIdentity(null);
        setUser(null);
        releaseOfflineLock();
        setSessionExpiredMessage('تم تسجيل الخروج من تبويب آخر؛ يرجى تسجيل الدخول مجددًا.');
        setSessionExpiredNotice(true);
        return;
      }

      const curTag = computeSessionTag(curToken, curUserId);
      if (curUserId !== bound.userId || curTag !== bound.sessionTag) {
        setBoundSessionIdentity(null);
        setUser(null);
        releaseOfflineLock();
        setSessionExpiredMessage(
          'تم تبديل الحساب في تبويب آخر؛ تم إيقاف هذا التبويب لحماية الجلسة. أعد تحميل الصفحة أو سجّل الدخول للمتابعة.'
        );
        setSessionExpiredNotice(true);
        return;
      }

      if (parsedStoredUser && parsedStoredUser.id === bound.userId) {
        setUser(prev => {
          if (!prev || prev.id !== parsedStoredUser!.id) return prev;
          return haveUserPermissionsOrIdentityChanged(prev, parsedStoredUser!) ? parsedStoredUser : prev;
        });
      }
    };

    window.addEventListener('storage', handleStorageSessionSync);
    return () => {
      unsubMessages();
      window.removeEventListener('storage', handleStorageSessionSync);
    };
  }, [tabId, isOnline, isOffline]);

  // عند رجوع الاتصال بعد جلسة أوفلاين أو انتهاء رمز الجلسة أثناء العمل أوفلاين: يُطلب تسجيل دخول جديد ثم تُرفع العمليات المعلّقة
  useEffect(() => {
    if (!isOnline || !user) return;
    const isOfflineTok =
      Boolean(user && (localStorage.getItem('pos_session_offline') === 'true' || localStorage.getItem('pos_token')?.startsWith('offline_')));
    const expAt = Number(localStorage.getItem('pos_session_expires_at') || 0);
    const isTokenExpired = expAt > 0 && Date.now() >= expAt;

    if (isOfflineTok || isTokenExpired) {
      const bound = getBoundSessionIdentity();
      setBoundSessionIdentity(null);
      setUser(null);
      localStorage.removeItem('pos_user');
      localStorage.removeItem('pos_token');
      localStorage.removeItem('pos_session_offline');
      localStorage.removeItem('pos_session_expires_at');
      writeSessionMeta(null);
      clearSharedHumanActivity();
      releaseOfflineLock();
      if (bound) {
        postTabSyncMessage({
          type: 'AUTH_EXPIRED',
          userId: bound.userId,
          sessionTag: bound.sessionTag,
          at: Date.now()
        });
      }
      setSessionExpiredMessage(null);
      setSessionExpiredNotice(true);
    }
  }, [isOnline, user]);

  // مزامنة حالة الحساب وفحص صلاحية الجلسة ومهلة عدم النشاط
  const inactivityTimeoutMinutes = normalizeInactivityTimeoutMinutes(
    config.companySettings?.inactivityTimeoutMinutes ?? config.inactivityTimeoutMinutes
  );

  useEffect(() => {
    if (!user) return;
    recordUserInteraction();
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const timeoutMs = inactivityTimeoutMinutes * 60 * 1000;
    const isOfflineTok =
      localStorage.getItem('pos_session_offline') === 'true' ||
      Boolean(localStorage.getItem('pos_token')?.startsWith('offline_'));

    const syncMeStatus = () => {
      if (!isOnline || isOfflineTok) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      api.getMe({ background: true })
        .then((res) => {
          if (res?.success && res.user) {
            if (res.user.status === 'inactive' || res.user.status === 'موقوف') {
              const bound = getBoundSessionIdentity();
              setBoundSessionIdentity(null);
              setUser(null);
              setIsAuthPermissionsVerified(true);
              localStorage.removeItem('pos_user');
              localStorage.removeItem('pos_token');
              localStorage.removeItem('pos_session_offline');
              localStorage.removeItem('pos_session_expires_at');
              writeSessionMeta(null);
              clearSharedHumanActivity();
              releaseOfflineLock();
              if (bound) {
                postTabSyncMessage({
                  type: 'AUTH_EXPIRED',
                  userId: bound.userId,
                  sessionTag: bound.sessionTag,
                  at: Date.now()
                });
              }
              setSessionExpiredNotice(true);
              return;
            }
            const nextMustChange = Boolean(res.user.mustChangePassword);
            const updated: UserAccount = { ...user, ...res.user, mustChangePassword: nextMustChange };
            delete (updated as any).password;
            if (haveUserPermissionsOrIdentityChanged(user, updated)) {
              setUser(updated);
              localStorage.setItem('pos_user', JSON.stringify(updated));
            }
          }
          if (res?.inactivityTimeoutMinutes) {
            const serverTimeout = normalizeInactivityTimeoutMinutes(res.inactivityTimeoutMinutes);
            setConfig(prev => {
              const cur = prev.companySettings?.inactivityTimeoutMinutes ?? prev.inactivityTimeoutMinutes;
              if (cur === serverTimeout) return prev;
              return {
                ...prev,
                inactivityTimeoutMinutes: serverTimeout,
                companySettings: prev.companySettings
                  ? { ...prev.companySettings, inactivityTimeoutMinutes: serverTimeout }
                  : prev.companySettings
              };
            });
          }
        })
        .catch(() => {});
    };

    syncMeStatus();

    let lastSessionPollAt = Date.now();
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const idleMs = now - getLastUserInteractionAt();

      // 1) التحقق من تجاوز مهلة عدم النشاط الفعلية للمستخدم (مزامنة بين تبويبات نفس الجلسة)
      if (idleMs >= timeoutMs) {
        const bound = getBoundSessionIdentity();
        if (isOnline && !isOfflineTok) {
          api.logout().catch(() => {});
        } else {
          setAuthToken(null);
        }
        setBoundSessionIdentity(null);
        setUser(null);
        localStorage.removeItem('pos_user');
        localStorage.removeItem('pos_token');
        localStorage.removeItem('pos_session_offline');
        localStorage.removeItem('pos_session_expires_at');
        writeSessionMeta(null);
        clearSharedHumanActivity();
        releaseOfflineLock();
        if (bound) {
          postTabSyncMessage({
            type: 'AUTH_EXPIRED',
            message: 'انتهت الجلسة بسبب عدم النشاط، يرجى تسجيل الدخول مجددًا',
            userId: bound.userId,
            sessionTag: bound.sessionTag,
            at: Date.now()
          });
        }
        setSessionExpiredMessage('انتهت الجلسة بسبب عدم النشاط، يرجى تسجيل الدخول مجددًا');
        setSessionExpiredNotice(true);
        return;
      }

      if (!isOnline || isOfflineTok || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        return;
      }

      // 2) إرسال نبضة نشاط للخادم فقط من التبويب الذي يتفاعل معه المستخدم فعليًا ولم يرسل طلبًا أماميًا منذ 90 ثانية
      const localIdleMs = now - getLastLocalDomInteractionAt();
      if (localIdleMs < 60_000 && now - getLastForegroundApiActivitySentAt() >= 90_000) {
        api.pingActivity().catch(() => {});
      }

      // 3) فحص دوري خفيف لصلاحية الجلسة في الخلفية (لا يُحتسب كنشاط مستخدم) لاكتشاف إنهاء الجلسة من الإدارة
      if (now - lastSessionPollAt >= 30_000) {
        lastSessionPollAt = now;
        syncMeStatus();
      }
    }, 10_000);

    const handleWindowFocus = () => {
      const now = Date.now();
      if (now - getLastUserInteractionAt() >= timeoutMs) {
        const bound = getBoundSessionIdentity();
        if (isOnline && !isOfflineTok) {
          api.logout().catch(() => {});
        } else {
          setAuthToken(null);
        }
        setBoundSessionIdentity(null);
        setUser(null);
        localStorage.removeItem('pos_user');
        localStorage.removeItem('pos_token');
        localStorage.removeItem('pos_session_offline');
        localStorage.removeItem('pos_session_expires_at');
        writeSessionMeta(null);
        clearSharedHumanActivity();
        releaseOfflineLock();
        if (bound) {
          postTabSyncMessage({
            type: 'AUTH_EXPIRED',
            message: 'انتهت الجلسة بسبب عدم النشاط، يرجى تسجيل الدخول مجددًا',
            userId: bound.userId,
            sessionTag: bound.sessionTag,
            at: Date.now()
          });
        }
        setSessionExpiredMessage('انتهت الجلسة بسبب عدم النشاط، يرجى تسجيل الدخول مجددًا');
        setSessionExpiredNotice(true);
        return;
      }
      syncMeStatus();
    };

    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [user, isOnline, inactivityTimeoutMinutes]);

  // Fetch initial config & data
  const loadData = useCallback(async () => {
    if (user?.mustChangePassword) {
      setIsAuthPermissionsVerified(true);
      setIsSyncing(false);
      return;
    }
    setIsSyncing(true);

    const isOfflineNow =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    const isOfflineSessionToken =
      localStorage.getItem('pos_session_offline') === 'true' ||
      Boolean(localStorage.getItem('pos_token')?.startsWith('offline_'));

    // إذا كان المتصفح أوفلاين عند الفتح أو الجلسة محلية أوفلاين، نقرأ النسخة المحلية فورًا من IndexedDB ونتحقق من الصلاحيات المشفرة
    if (user && (isOfflineNow || isOfflineSessionToken)) {
      await hydrateFromOfflineDb(user);
      if (isOfflineNow) {
        setIsSyncing(false);
        return;
      }
    }

    try {
      const [configData, meRes] = await Promise.all([
        api.getConfig(),
        user && !isOfflineSessionToken
          ? api.getMe({ background: true }).catch(() => null)
          : Promise.resolve(null)
      ]);
      if (configData.salesRules) {
        persistCachedSalesRules(configData.salesRules);
      }
      setConfig(prev => ({
        ...prev,
        ...configData,
        persistenceMode: configData.persistenceMode ?? prev.persistenceMode,
        companySettings: { ...prev.companySettings, ...(configData.companySettings || {}) } as any,
        invoicePrintSettings: {
          ...prev.invoicePrintSettings,
          ...(configData.invoicePrintSettings || {}),
          autoFillCashPaid: configData.invoicePrintSettings?.autoFillCashPaid ?? configData.displaySettings?.autoFillCashPaid ?? prev.invoicePrintSettings?.autoFillCashPaid ?? true
        } as any,
        displaySettings: {
          ...prev.displaySettings,
          ...(configData.displaySettings || {}),
          autoFillCashPaid: configData.displaySettings?.autoFillCashPaid ?? configData.invoicePrintSettings?.autoFillCashPaid ?? prev.displaySettings?.autoFillCashPaid ?? true,
          latestItemFirst: normalizeLatestItemFirst(
            configData.displaySettings?.latestItemFirst,
            prev.displaySettings?.latestItemFirst
          ),
          posShowCustomerAddress: configData.displaySettings?.posShowCustomerAddress ?? prev.displaySettings?.posShowCustomerAddress ?? true,
          posShowCustomerPhone: configData.displaySettings?.posShowCustomerPhone ?? prev.displaySettings?.posShowCustomerPhone ?? true,
          posShowCustomerBalance: configData.displaySettings?.posShowCustomerBalance ?? prev.displaySettings?.posShowCustomerBalance ?? true
        } as any,
        taxSettings: { ...prev.taxSettings, ...(configData.taxSettings || {}) } as any,
        stockSettings: { ...prev.stockSettings, ...(configData.stockSettings || {}) } as any,
        salesRules: configData.salesRules ?? prev.salesRules
      }));

      if (isValidAppTheme(configData.companySettings?.appTheme)) {
        setAppTheme(configData.companySettings!.appTheme);
      }

      // التحقق الفوري من حالة المستخدم وصلاحياته من الخادم قبل عرض أو تحميل أي بيانات محمية
      let effectiveUser: UserAccount | null = user;
      if (user && meRes?.success && meRes.user) {
        if (meRes.user.status === 'inactive' || meRes.user.status === 'موقوف') {
          const bound = getBoundSessionIdentity();
          setBoundSessionIdentity(null);
          setUser(null);
          setIsAuthPermissionsVerified(true);
          localStorage.removeItem('pos_user');
          localStorage.removeItem('pos_token');
          localStorage.removeItem('pos_session_offline');
          localStorage.removeItem('pos_session_expires_at');
          writeSessionMeta(null);
          clearSharedHumanActivity();
          releaseOfflineLock();
          if (bound) {
            postTabSyncMessage({
              type: 'AUTH_EXPIRED',
              userId: bound.userId,
              sessionTag: bound.sessionTag,
              at: Date.now()
            });
          }
          setSessionExpiredNotice(true);
          return;
        }
        const verifiedUser: UserAccount = {
          ...user,
          ...meRes.user,
          mustChangePassword: Boolean(meRes.user.mustChangePassword)
        };
        delete (verifiedUser as any).password;
        effectiveUser = verifiedUser;
        localStorage.setItem('pos_user', JSON.stringify(verifiedUser));
        if (haveUserPermissionsOrIdentityChanged(user, verifiedUser)) {
          setUser(verifiedUser);
        }
      }

      if (effectiveUser) {
        const effectiveRules = configData.salesRules ?? config.salesRules;
        const verifiedSalesOnly = Boolean(effectiveRules?.salesOnlyMode);
        const verifiedFlags: FeatureModeFlags = {
          salesOnlyMode: verifiedSalesOnly,
          platformsEnabled: !verifiedSalesOnly && effectiveRules?.platformsEnabled !== false
        };
        const resolvedRoute = resolvePathToTarget(
          getCurrentBrowserUrl(),
          effectiveUser,
          verifiedFlags
        );
        if (resolvedRoute.redirected) {
          try {
            window.history.replaceState({}, '', resolvedRoute.path);
          } catch (_) {}
        }
        setCurrentPage(resolvedRoute.page);
        setCurrentTab(resolvedRoute.tab);
        setItemRoute(resolvedRoute.itemRoute ?? null);
        setIsAuthPermissionsVerified(true);
      } else {
        setIsAuthPermissionsVerified(true);
      }

      if (configData.dataEpoch && hasOfflineLockOwnership()) {
        const epochRes = await applyDataEpochTransition(configData.dataEpoch).catch(() => null);
        if (epochRes?.changed) {
          setItems([]);
          setCategories([]);
          setPlatforms([]);
          setCosts([]);
          setInvoices([]);
          setReturns([]);
          setCustomers([]);
          setReports(null);
        }
      }

      // Only load protected data if user is logged in
      if (effectiveUser) {
        // رفع أي عمليات معلقة في outbox بالترتيب قبل جلب النسخة المحدثة من الخادم
        const isSheetsHealthyForSync =
          configData.dataMode !== 'sheets' || configData.connectionHealth?.healthy !== false;
        if (isSheetsHealthyForSync && hasOfflineLockOwnership()) {
          const pendingCnt = await getOutboxPendingCount().catch(() => 0);
          if (pendingCnt > 0) {
            await syncOutboxOperations({ user: effectiveUser, skipSnapshotRefresh: true }).catch(() => {});
          }
        }

        const isSalesOnlyFromConfig = Boolean(configData.salesRules?.salesOnlyMode);
        const [syncData, reportsData] = await Promise.all([
          api.syncAll().catch(() => ({ success: false, data: null, hasManager: true, stale: false, lastSyncAt: undefined })),
          !isSalesOnlyFromConfig ? api.getReports().catch(() => null) : Promise.resolve(null)
        ]);

        if (syncData && (syncData as any).stale) {
          setStaleInfo({
            stale: true,
            lastSyncAt: (syncData as any).lastSyncAt || null
          });
        } else if (syncData && syncData.success) {
          setStaleInfo({ stale: false, lastSyncAt: null });
        } else if (!syncData || !syncData.success || !syncData.data) {
          // في حال تعذر الوصول للخادم (أوفلاين)، نستعيد البيانات من IndexedDB
          await hydrateFromOfflineDb(effectiveUser);
        }

        if (syncData && syncData.data) {
          if (syncData.data.items) setItems(syncData.data.items);
          if (syncData.data.categories) setCategories(syncData.data.categories);
          if (syncData.data.platforms) setPlatforms(syncData.data.platforms);
          if (syncData.data.costs) setCosts(syncData.data.costs);
          if (syncData.data.invoices) {
            const [pendingOffline, provMap] = await Promise.all([
              getPendingOfflineInvoices(effectiveUser).catch(() => [] as Invoice[]),
              getMetaValue<Record<string, { provisionalInvoiceNumber: string; finalInvoiceNumber: string; needsReview?: boolean; reviewReasons?: string[] }>>('provisionalToFinalMap').catch(() => null)
            ]);
            const mapObj: Record<
              string,
              { provisionalInvoiceNumber: string; finalInvoiceNumber: string; needsReview?: boolean; reviewReasons?: string[] }
            > = provMap || {};
            const mapEntries = Object.values(mapObj);
            const serverInvoices: Invoice[] = (syncData.data.invoices as Invoice[]).map(inv => {
              if (inv.offlineProvisionalNo) return inv;
              const matchEntry = mapEntries.find(m => m.finalInvoiceNumber === inv.invoiceNumber);
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
            });
            const mergedInvoices = [
              ...pendingOffline.filter(
                p =>
                  !serverInvoices.some(
                    s =>
                      s.invoiceNumber === p.invoiceNumber ||
                      s.offlineProvisionalNo === p.invoiceNumber ||
                      (p.idempotencyKey && s.idempotencyKey === p.idempotencyKey)
                  )
              ),
              ...serverInvoices
            ];
            setInvoices(mergedInvoices);
          }
          if (syncData.data.returns) setReturns(syncData.data.returns);
          if (syncData.data.settings) {
            const rawInv = syncData.data.settings.invoicePrintSettings;
            const rawDisp = syncData.data.settings.displaySettings;
            const cleanInv = rawInv
              ? {
                  ...rawInv,
                  headerText: rawInv.headerText === 'فاتورة مبيعات مدققة وموثقة على المنصة' ? '' : (rawInv.headerText ?? ''),
                  footerText: rawInv.footerText ?? '',
                  termsAndConditions: rawInv.termsAndConditions ?? '',
                  returnPolicyText: rawInv.returnPolicyText ?? ''
                }
              : undefined;

            setConfig(prev => {
              const resolvedAutoFill =
                rawDisp?.autoFillCashPaid ??
                cleanInv?.autoFillCashPaid ??
                prev.displaySettings?.autoFillCashPaid ??
                prev.invoicePrintSettings?.autoFillCashPaid ??
                true;
              return {
                ...prev,
                companySettings: syncData.data.settings.companySettings
                  ? { ...prev.companySettings, ...syncData.data.settings.companySettings }
                  : prev.companySettings,
                invoicePrintSettings: cleanInv
                  ? { ...prev.invoicePrintSettings, ...cleanInv, autoFillCashPaid: resolvedAutoFill }
                  : prev.invoicePrintSettings,
                displaySettings: rawDisp
                  ? {
                      ...prev.displaySettings,
                      ...rawDisp,
                      autoFillCashPaid: resolvedAutoFill,
                      latestItemFirst: normalizeLatestItemFirst(
                        rawDisp.latestItemFirst,
                        prev.displaySettings?.latestItemFirst
                      ),
                      posShowCustomerAddress: rawDisp.posShowCustomerAddress ?? prev.displaySettings?.posShowCustomerAddress ?? true,
                      posShowCustomerPhone: rawDisp.posShowCustomerPhone ?? prev.displaySettings?.posShowCustomerPhone ?? true,
                      posShowCustomerBalance: rawDisp.posShowCustomerBalance ?? prev.displaySettings?.posShowCustomerBalance ?? true
                    }
                  : prev.displaySettings,
                taxSettings: syncData.data.settings.taxSettings
                  ? { ...prev.taxSettings, ...syncData.data.settings.taxSettings }
                  : prev.taxSettings,
                stockSettings: syncData.data.settings.stockSettings
                  ? { ...prev.stockSettings, ...syncData.data.settings.stockSettings }
                  : prev.stockSettings,
                salesRules: syncData.data.settings.salesRules
                  ? { ...prev.salesRules, ...syncData.data.settings.salesRules }
                  : prev.salesRules,
                storeName: syncData.data.settings.storeName ?? prev.storeName,
                currency: syncData.data.settings.currency ?? prev.currency,
                enableDeliveryFee: syncData.data.settings.companySettings?.enableDeliveryFee ?? prev.enableDeliveryFee
              };
            });

            if (syncData.data.settings.salesRules) {
              persistCachedSalesRules(syncData.data.settings.salesRules);
            }

            if (isValidAppTheme(syncData.data.settings.companySettings?.appTheme)) {
              setAppTheme(syncData.data.settings.companySettings.appTheme);
            }
          }
        }

        if (reportsData && reportsData.summary) {
          setReports(reportsData);
        }

        const canViewUsers =
          effectiveUser.role === 'designer' ||
          effectiveUser.role === 'manager' ||
          hasPermission(effectiveUser, 'users.view');
        const canViewCategories =
          effectiveUser.role === 'designer' ||
          Boolean(effectiveUser.isOwner) ||
          hasPermission(effectiveUser, 'categories.view');

        const [usersRes, categoriesRes, customersRes, cashboxesRes, assignmentsRes] = await Promise.all([
          canViewUsers
            ? api.getUsers().catch(() => ({ success: false, users: [] as UserAccount[] }))
            : Promise.resolve({ success: false, users: [] as UserAccount[] }),
          canViewCategories
            ? api.getCategories().catch(() => ({ success: false, categories: [] as ProductCategory[] }))
            : Promise.resolve({ success: false, categories: [] as ProductCategory[] }),
          api.getCustomers().catch(() => ({ success: false, customers: [] as Customer[] })),
          api.getCashboxes().catch(() => ({ success: false, cashboxes: [] })),
          api.getCashboxAssignments().catch(() => ({ success: false, assignments: [] }))
        ]);

        const resolvedUsersList: UserAccount[] =
          Array.isArray(syncData?.data?.users) && syncData.data.users.length > 0
            ? syncData.data.users
            : usersRes.success && usersRes.users.length > 0
            ? usersRes.users
            : [effectiveUser];

        if (resolvedUsersList.length > 0) {
          setUsers(resolvedUsersList);
          const refreshedCurrentUser = resolvedUsersList.find(u => u.id === effectiveUser!.id);
          if (refreshedCurrentUser) {
            if (refreshedCurrentUser.status === 'inactive' || refreshedCurrentUser.status === 'موقوف') {
              // مستخدم أُوقف يُحدَّث على الجهاز عند أول اتصال ويُنهى دخوله
              if (hasOfflineLockOwnership()) {
                await saveOfflineSnapshot({
                  user: refreshedCurrentUser,
                  users: resolvedUsersList
                }).catch(() => {});
              }
              const bound = getBoundSessionIdentity();
              setBoundSessionIdentity(null);
              setUser(null);
              setIsAuthPermissionsVerified(true);
              localStorage.removeItem('pos_user');
              localStorage.removeItem('pos_token');
              localStorage.removeItem('pos_session_offline');
              localStorage.removeItem('pos_session_expires_at');
              writeSessionMeta(null);
              clearSharedHumanActivity();
              releaseOfflineLock();
              if (bound) {
                postTabSyncMessage({
                  type: 'AUTH_EXPIRED',
                  userId: bound.userId,
                  sessionTag: bound.sessionTag,
                  at: Date.now()
                });
              }
              setSessionExpiredNotice(true);
              return;
            }
            const updatedSessionUser: UserAccount = {
              ...effectiveUser,
              ...refreshedCurrentUser
            };
            delete (updatedSessionUser as any).password;
            effectiveUser = updatedSessionUser;
            localStorage.setItem('pos_user', JSON.stringify(updatedSessionUser));
            if (haveUserPermissionsOrIdentityChanged(user!, updatedSessionUser)) {
              setUser(updatedSessionUser);
            }
          }
        }
        if (categoriesRes.success && categoriesRes.categories) {
          setCategories(categoriesRes.categories);
        }
        if (customersRes.success && customersRes.customers) {
          setCustomers(customersRes.customers);
        }

        // حفظ النسخة الكاملة في IndexedDB عند الدخول طالما الاتصال سليم والبيانات حية وهذا التبويب يملك قفل الأوفلاين
        const isSheetsBrokenNow =
          configData.dataMode === 'sheets' && configData.connectionHealth?.healthy === false;
        if (
          hasOfflineLockOwnership() &&
          syncData &&
          syncData.success &&
          syncData.data &&
          !(syncData as any).stale &&
          !isSheetsBrokenNow
        ) {
          saveOfflineSnapshot({
            user: effectiveUser,
            items: syncData.data.items || [],
            categories:
              categoriesRes.success && categoriesRes.categories.length > 0
                ? categoriesRes.categories
                : syncData.data.categories || [],
            platforms: syncData.data.platforms || [],
            costs: syncData.data.costs || [],
            customers:
              customersRes.success && customersRes.customers.length > 0
                ? customersRes.customers
                : syncData.data.customers || [],
            cashboxes:
              cashboxesRes.success && cashboxesRes.cashboxes.length > 0
                ? cashboxesRes.cashboxes
                : syncData.data.cashboxes || [],
            cashboxAssignments:
              assignmentsRes.success && assignmentsRes.assignments.length > 0
                ? assignmentsRes.assignments
                : syncData.data.cashboxAssignments || [],
            settings: syncData.data.settings || undefined,
            users: resolvedUsersList,
            invoices: syncData.data.invoices || [],
            returns: syncData.data.returns || [],
            syncedAt: (syncData as any).lastSyncAt || new Date().toISOString()
          }).catch(err => {
            console.warn('[OfflineDB] Failed to save initial snapshot:', err);
          });
        }
      }

      // تحديث صحة الاتصال الفعلية بعد اكتمال القراءات
      api.getHealth()
        .then(health => {
          setConfig(prev => ({
            ...prev,
            dataMode: health.dataMode,
            isGoogleSheetsConnected: health.isGoogleSheetsConnected,
            connectionHealth: health.connectionHealth,
            persistenceMode:
              prev.persistenceMode ??
              health.persistenceMode ??
              (health.persistence?.enabled ? 'supabase' : undefined)
          }));
        })
        .catch(() => {});
    } catch (err) {
      console.error('Failed to load initial data:', err);
      if (user) {
        await hydrateFromOfflineDb(user);
      } else {
        setIsAuthPermissionsVerified(true);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [user, hydrateFromOfflineDb, config.salesRules]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // عند اكتمال رفع العمليات المعلقة في الخلفية: تحديث أرقام الفواتير النهائية بجانب المؤقتة وتحديث البيانات
  useEffect(() => {
    return subscribeOutboxSynced(result => {
      if (result.syncedInvoices.length > 0) {
        setInvoices(prev => {
          const next = [...prev];
          for (const synced of result.syncedInvoices) {
            const idx = next.findIndex(
              inv =>
                inv.invoiceNumber === synced.provisionalInvoiceNumber ||
                inv.invoiceNumber === synced.finalInvoiceNumber ||
                (synced.idempotencyKey && inv.idempotencyKey === synced.idempotencyKey)
            );
            const updatedInv: Invoice = {
              ...synced.invoice,
              invoiceNumber: synced.finalInvoiceNumber,
              offlineProvisionalNo: synced.provisionalInvoiceNumber || synced.invoice.offlineProvisionalNo,
              tempInvoiceNumber: synced.provisionalInvoiceNumber || synced.invoice.tempInvoiceNumber,
              isOffline: true,
              offlinePending: false
            };
            if (idx >= 0) {
              next[idx] = updatedInv;
            } else {
              next.unshift(updatedInv);
            }
          }
          return next;
        });
        loadData().catch(() => {});
      }
    });
  }, [loadData]);

  // تنزيل نسخة كاملة من المخازن كل 10 دقائق طالما الاتصال سليم
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      const isHealthy =
        isOnline && (config.dataMode !== 'sheets' || config.connectionHealth?.healthy !== false);
      if (isHealthy) {
        syncFullStoresToOfflineDb(user).catch(() => {});
      }
    }, OFFLINE_SYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [user, isOnline, config.dataMode, config.connectionHealth?.healthy]);

  // تشغيل سجل شاشة البيع ومحاولة رفع الأحداث المعلّقة عند الفتح أو رجوع الإنترنت
  useEffect(() => {
    if (!user || isOffline || !isOnline) return;
    try {
      getCartJournal().flush().catch(() => {});
    } catch (_) {}
  }, [user, isOffline, isOnline]);

  // الاستماع لأحداث حالة الاتصال والبيانات المؤقتة من API client
  useEffect(() => {
    return subscribeApiStatus((event) => {
      if (event.type === 'SHEETS_ERROR') {
        setConfig(prev => {
          if (prev.dataMode !== 'sheets') return prev;
          return {
            ...prev,
            connectionHealth: {
              healthy: false,
              lastError: event.message,
              lastErrorAt: new Date().toISOString(),
              consecutiveFailures: (prev.connectionHealth?.consecutiveFailures || 0) + 1,
              lastSuccessAt: prev.connectionHealth?.lastSuccessAt || null
            }
          };
        });
        api.getHealth()
          .then(health => {
            setConfig(prev => ({
              ...prev,
              dataMode: health.dataMode,
              isGoogleSheetsConnected: health.isGoogleSheetsConnected,
              connectionHealth: health.connectionHealth,
              persistenceMode:
                prev.persistenceMode ??
                health.persistenceMode ??
                (health.persistence?.enabled ? 'supabase' : undefined)
            }));
          })
          .catch(() => {});
      } else if (event.type === 'STALE_DATA') {
        setStaleInfo({
          stale: true,
          lastSyncAt: event.lastSyncAt || null
        });
      } else if (event.type === 'LIVE_DATA') {
        setStaleInfo(prev => (prev.stale ? { stale: false, lastSyncAt: null } : prev));
        setConfig(prev => {
          if (prev.dataMode === 'sheets' && prev.connectionHealth?.healthy === false) {
            return {
              ...prev,
              connectionHealth: {
                ...prev.connectionHealth,
                healthy: true,
                lastError: null,
                consecutiveFailures: 0,
                lastSuccessAt: new Date().toISOString()
              }
            };
          }
          return prev;
        });
      } else if (event.type === 'BALANCE_REQUIRED') {
        if (event.message) {
          setBalanceRequiredBanner(event.message);
        }
        if (event.accountId) {
          setDismissedManualDueKeys((prev) => {
            if (!prev[event.accountId!]) return prev;
            const next = { ...prev };
            delete next[event.accountId!];
            return next;
          });
        }
        api.getManualBalanceRequests()
          .then((res) => {
            if (res?.success) {
              setManualBalanceRequests(Array.isArray(res.requests) ? res.requests : []);
              setManualBalanceAlerts(Array.isArray(res.alerts) ? res.alerts : []);
            }
          })
          .catch(() => {});
      } else if (event.type === 'MANUAL_BALANCE_UPDATED') {
        api.getManualBalanceRequests()
          .then((res) => {
            if (res?.success) {
              setManualBalanceRequests(Array.isArray(res.requests) ? res.requests : []);
              setManualBalanceAlerts(Array.isArray(res.alerts) ? res.alerts : []);
            }
          })
          .catch(() => {});
      }
    });
  }, []);

  const fetchManualBalanceRequests = useCallback(async () => {
    if (!user || user.mustChangePassword || isOffline) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      const res = await api.getManualBalanceRequests({ background: true });
      if (res?.success) {
        setManualBalanceRequests(Array.isArray(res.requests) ? res.requests : []);
        setManualBalanceAlerts(Array.isArray(res.alerts) ? res.alerts : []);
      }
    } catch {
      // عند انقطاع الاتصال أو فشل الطلب لا نعرض أي رسالة خطأ
    }
  }, [user, isOffline]);

  useEffect(() => {
    if (!user || user.mustChangePassword) {
      setManualBalanceRequests([]);
      setManualBalanceAlerts([]);
      setDismissedManualDueKeys({});
      setForcedManualRequestId(null);
      setManualBalanceResultHold(null);
      setBalanceRequiredBanner(null);
      return;
    }

    fetchManualBalanceRequests();
    const intervalId = window.setInterval(() => {
      fetchManualBalanceRequests();
    }, 60_000);

    const handleFocus = () => {
      fetchManualBalanceRequests();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchManualBalanceRequests();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user, fetchManualBalanceRequests]);

  // فحص دوري لصحة الاتصال في وضع sheets كل 30 ثانية
  useEffect(() => {
    if (config.dataMode !== 'sheets') return;
    const timer = window.setInterval(() => {
      api.getHealth()
        .then(health => {
          setConfig(prev => ({
            ...prev,
            dataMode: health.dataMode,
            isGoogleSheetsConnected: health.isGoogleSheetsConnected,
            connectionHealth: health.connectionHealth,
            persistenceMode:
              prev.persistenceMode ??
              health.persistenceMode ??
              (health.persistence?.enabled ? 'supabase' : undefined)
          }));
        })
        .catch(() => {});
    }, 30000);
    return () => window.clearInterval(timer);
  }, [config.dataMode]);

  const handleRetrySheetsConnection = async () => {
    setIsRetryingConnection(true);
    try {
      const testRes = await api.testConnection(config.appsScriptUrl);
      if (testRes.connectionHealth) {
        setConfig(prev => ({
          ...prev,
          dataMode: testRes.dataMode ?? prev.dataMode,
          connectionHealth: testRes.connectionHealth,
          persistenceMode: prev.persistenceMode
        }));
      }
      await loadData();
    } catch (_) {
      try {
        const health = await api.getHealth();
        setConfig(prev => ({
          ...prev,
          dataMode: health.dataMode,
          isGoogleSheetsConnected: health.isGoogleSheetsConnected,
          connectionHealth: health.connectionHealth,
          persistenceMode:
            prev.persistenceMode ??
            health.persistenceMode ??
            (health.persistence?.enabled ? 'supabase' : undefined)
        }));
      } catch (_) {}
    } finally {
      setIsRetryingConnection(false);
    }
  };

  // Auth Handlers
  const handleLoginSuccess = (session: AuthSession) => {
    const activeToken = session.token || localStorage.getItem('pos_token') || '';
    const sessionTag = computeSessionTag(activeToken, session.user.id);
    const identity = sessionTag ? { userId: session.user.id, sessionTag } : null;
    setBoundSessionIdentity(identity);
    writeSessionMeta(identity);

    setUser(session.user);
    setIsAuthPermissionsVerified(true);
    localStorage.setItem('pos_user', JSON.stringify(session.user));
    localStorage.setItem('pos_session_offline', session.offline ? 'true' : 'false');
    if (session.expiresAt) {
      localStorage.setItem('pos_session_expires_at', String(session.expiresAt));
    }
    recordUserInteraction();
    setSessionExpiredNotice(false);
    setSessionExpiredMessage(null);

    if (identity) {
      postTabSyncMessage({
        type: 'AUTH_SESSION_CHANGED',
        userId: identity.userId,
        sessionTag: identity.sessionTag,
        at: Date.now()
      });
    }

    const currentFullUrl = getCurrentBrowserUrl();
    const currentPathOnly = typeof window !== 'undefined' ? window.location.pathname : '/';
    const resolvedCurrent = resolvePathToTarget(currentFullUrl, session.user, featureFlags);
    const homeTarget = getDefaultHomeTarget(featureFlags);
    const normalizedHome = normalizeNavigationTarget(homeTarget.page, undefined, session.user, featureFlags);
    const useDeepUrl =
      currentPathOnly !== '/' &&
      currentPathOnly !== '/login' &&
      (!resolvedCurrent.redirected || Boolean(resolvedCurrent.itemRoute));
    const nextPage = useDeepUrl ? resolvedCurrent.page : normalizedHome.page;
    const nextTab = useDeepUrl ? resolvedCurrent.tab : normalizedHome.tab;
    const nextUrl = useDeepUrl ? resolvedCurrent.path : normalizedHome.path;
    const nextItemRoute = useDeepUrl ? resolvedCurrent.itemRoute ?? null : null;

    setCurrentPage(nextPage);
    setCurrentTab(nextTab);
    setItemRoute(nextItemRoute);
    try {
      if (getCurrentBrowserUrl() !== nextUrl) {
        window.history.replaceState({}, '', nextUrl);
      }
    } catch (_) {}

    if (!session.offline && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      acquireOfflineLock()
        .then((snap) => {
          if (snap.hasOwnership) {
            return syncOutboxOperations({ user: session.user });
          }
          return undefined;
        })
        .catch(() => {});
    }
    try {
      const journal = getCartJournal();
      if (!session.offline) {
        journal.flush().catch(() => {});
      }
    } catch (_) {}
  };

  // تبديل المستخدم أوفلاين (يُبقي كل العمليات المعلّقة والبيانات المحلية محفوظة بأمان)
  const handleSwitchOfflineUser = async () => {
    try {
      getCartJournal().closeCart('logout');
    } catch (_) {}
    if (user) {
      try {
        await recordOfflineAuthEventInOutbox({
          action: 'OFFLINE_LOGOUT',
          user
        });
      } catch (_) {}
    }
    const bound = getBoundSessionIdentity();
    setBoundSessionIdentity(null);
    setLogoutGuardModal(null);
    setUser(null);
    localStorage.removeItem('pos_user');
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_session_offline');
    localStorage.removeItem('pos_session_expires_at');
    writeSessionMeta(null);
    clearSharedHumanActivity();
    releaseOfflineLock();
    if (bound) {
      postTabSyncMessage({
        type: 'AUTH_LOGOUT',
        userId: bound.userId,
        sessionTag: bound.sessionTag,
        at: Date.now()
      });
    }
  };

  const handleLogout = async () => {
    // منع تسجيل الخروج النهائي طالما توجد عمليات معلّقة مع توضيح السبب بالعربية، مع إبقاء تبديل المستخدم أوفلاين مسموحًا
    const guard = await canPerformFinalLogoutOrClearData().catch(() => ({
      allowed: true,
      pendingCount: 0,
      reason: undefined
    }));
    if (!guard.allowed && guard.pendingCount > 0) {
      setLogoutGuardModal({
        open: true,
        pendingCount: guard.pendingCount,
        reason:
          guard.reason ||
          `لا يمكن تسجيل الخروج النهائي أو مسح بيانات التطبيق حالياً لوجود ${guard.pendingCount} عملية معلّقة لم تُرفع بعد. يمكنك تبديل المستخدم أوفلاين بأمان دون فقدان أي بيانات.`
      });
      return;
    }

    try {
      getCartJournal().closeCart('logout');
    } catch (_) {}

    const isOfflineSessionNow =
      isOffline ||
      (typeof navigator !== 'undefined' && navigator.onLine === false) ||
      localStorage.getItem('pos_session_offline') === 'true' ||
      Boolean(localStorage.getItem('pos_token')?.startsWith('offline_'));

    if (isOfflineSessionNow && user) {
      try {
        await recordOfflineAuthEventInOutbox({
          action: 'OFFLINE_LOGOUT',
          user
        });
      } catch (_) {}
    } else {
      try {
        await api.logout();
      } catch (_) {
        if (user) {
          await recordOfflineAuthEventInOutbox({
            action: 'OFFLINE_LOGOUT',
            user
          }).catch(() => {});
        }
      }
    }
    const bound = getBoundSessionIdentity();
    setBoundSessionIdentity(null);
    setUser(null);
    localStorage.removeItem('pos_user');
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_session_offline');
    localStorage.removeItem('pos_session_expires_at');
    writeSessionMeta(null);
    clearSharedHumanActivity();
    releaseOfflineLock();
    if (bound) {
      postTabSyncMessage({
        type: 'AUTH_LOGOUT',
        userId: bound.userId,
        sessionTag: bound.sessionTag,
        at: Date.now()
      });
    }
  };

  const handleForceLogoutAfterReset = useCallback(() => {
    const bound = getBoundSessionIdentity();
    setBoundSessionIdentity(null);
    setAuthToken(null);
    setUser(null);
    setItems([]);
    setCategories([]);
    setPlatforms([]);
    setCosts([]);
    setInvoices([]);
    setReturns([]);
    setCustomers([]);
    setReports(null);
    localStorage.removeItem('pos_user');
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_session_offline');
    localStorage.removeItem('pos_session_expires_at');
    writeSessionMeta(null);
    clearSharedHumanActivity();
    releaseOfflineLock();
    if (bound) {
      postTabSyncMessage({
        type: 'AUTH_LOGOUT',
        userId: bound.userId,
        sessionTag: bound.sessionTag,
        at: Date.now()
      });
    }
    setSessionExpiredNotice(false);
  }, []);

  // Item Operations & Standalone Item Page Routing (/items/new & /items/:id)
  const handleNavigateItemRoute = useCallback((path: string, it?: Item) => {
    if (!isPageAllowedByFeatureModes('items', 'ALL', featureFlags)) {
      executeNavigate(getDefaultHomeTarget(featureFlags).page);
      return;
    }
    const isNewRoute = path === '/items/new' || path.startsWith('/items/new?');
    const isEditRoute = !isNewRoute && path.startsWith('/items/') && path.length > '/items/'.length;
    if (isNewRoute && !canUserCreateItem(user, featureFlags)) {
      executeNavigate('items', 'ALL');
      return;
    }
    if (isEditRoute && !canUserEditItem(user, featureFlags)) {
      executeNavigate('items', 'ALL');
      return;
    }
    if (isOffline) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToastInvoiceMessage('متاح عند رجوع الاتصال');
      toastTimerRef.current = setTimeout(() => {
        setToastInvoiceMessage(null);
      }, 3000);
      return;
    }
    try {
      if (getCurrentBrowserUrl() !== path) {
        window.history.pushState({}, '', path);
      }
    } catch (_) {}
    setIsItemFormDirty(false);
    setCurrentPage('items');
    if (isNewRoute) {
      setEditingItem(null);
      setItemRoute({ mode: 'new' });
    } else if (isEditRoute) {
      const targetId = decodeURIComponent(path.slice('/items/'.length).split(/[?#]/)[0]);
      const matched = it || items.find(p => p.id === targetId) || null;
      setEditingItem(matched);
      setItemRoute({ mode: 'edit', itemId: targetId });
    } else {
      setEditingItem(null);
      setItemRoute(null);
    }
  }, [isOffline, items, user, featureFlags, executeNavigate]);

  const handleOpenProductModal = useCallback((it?: Item) => {
    handleNavigateItemRoute(getHrefForItemRoute(it?.id ? 'edit' : 'new', it?.id), it);
  }, [handleNavigateItemRoute]);

  const handleBackToItemsList = useCallback(() => {
    if (!isPageAllowedByFeatureModes('items', 'ALL', featureFlags)) {
      executeNavigate(getDefaultHomeTarget(featureFlags).page);
      return;
    }
    setIsItemFormDirty(false);
    setItemRoute(null);
    setEditingItem(null);
    setCurrentPage('items');
    try {
      if (getCurrentBrowserUrl() !== '/items') {
        window.history.pushState({}, '', '/items');
      }
    } catch (_) {}
  }, [featureFlags, executeNavigate]);

  useEffect(() => {
    const syncFromPath = () => {
      if (typeof window === 'undefined') return;
      const fullUrl = getCurrentBrowserUrl();
      const resolved = resolvePathToTarget(fullUrl, user, featureFlags);
      if (resolved.redirected) {
        try {
          window.history.replaceState({}, '', resolved.path);
        } catch (_) {}
      }
      setCurrentPage(resolved.page);
      setCurrentTab(resolved.tab);
      setDeliveryOrdersInitialSearch(readUrlSearchParam(resolved.path, 'search'));
      setPurchasesInitialSupplierId(readUrlSearchParam(resolved.path, 'supplierId'));
      setCustomersInitialCustomerId(readUrlSearchParam(resolved.path, 'customerId'));
      setCashboxesInitialCashboxId(readUrlSearchParam(resolved.path, 'cashboxId'));
      setPlatformsInitialPlatformId(readUrlSearchParam(resolved.path, 'platformId'));
      setItemsInitialCategoryId(readUrlSearchParam(resolved.path, 'category'));
      setBulkEditOperationTypeParam(readUrlSearchParam(resolved.path, 'operationType'));

      if (resolved.itemRoute?.mode === 'new') {
        setEditingItem(null);
        setItemRoute({ mode: 'new' });
      } else if (resolved.itemRoute?.mode === 'edit') {
        const editItemId = resolved.itemRoute.itemId;
        const matched = items.find(p => p.id === editItemId) || null;
        setEditingItem(matched);
        setItemRoute({ mode: 'edit', itemId: editItemId });
      } else {
        setEditingItem(null);
        setItemRoute(null);
      }
    };
    syncFromPath();
    window.addEventListener('popstate', syncFromPath);
    return () => window.removeEventListener('popstate', syncFromPath);
  }, [items, user, featureFlags]);

  const handleSaveItem = async (
    itemData: Partial<Item> & { name: string },
    platformCosts?: ItemPlatformCost[]
  ): Promise<Item> => {
    if (isOffline) {
      throw new Error('متاح عند رجوع الاتصال');
    }
    const res = await api.saveItem(itemData);
    if (res.success && res.item) {
      setItems(prev => {
        const idx = prev.findIndex(p => p.id === res.item.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = res.item;
          return updated;
        }
        return [res.item, ...prev];
      });

      // حفظ تكاليف شحن المنصات المرتبطة بالصنف (فقط عند تفعيل المنصات)
      if (featureFlags.platformsEnabled && platformCosts && platformCosts.length > 0) {
        for (const pc of platformCosts) {
          const costToSave: ItemPlatformCost = {
            ...pc,
            itemId: res.item.id
          };
          try {
            await api.saveItemPlatformCost(costToSave);
            setCosts(prev => {
              const cIdx = prev.findIndex(c => c.itemId === costToSave.itemId && c.platformId === costToSave.platformId);
              if (cIdx >= 0) {
                const updated = [...prev];
                updated[cIdx] = costToSave;
                return updated;
              }
              return [...prev, costToSave];
            });
          } catch (_) {}
        }
      }

      setEditingItem(res.item);
      if (!featureFlags.salesOnlyMode) {
        api.getReports().then(r => setReports(r)).catch(() => {});
      }
      return res.item;
    } else {
      throw new Error((res as any)?.error || 'فشل حفظ الصنف');
    }
  };

  const handleDeleteItem = async (id: string) => {
    const res = await api.deleteItem(id);
    if (res.success) {
      setItems(prev => prev.filter(p => p.id !== id));
      if (!featureFlags.salesOnlyMode) {
        api.getReports().then(r => setReports(r)).catch(() => {});
      }
    }
    return res;
  };

  const handleArchiveItem = async (id: string) => {
    const res = await api.archiveItem(id);
    if (res.success) {
      setItems(prev => prev.map(p => p.id === id ? { ...p, status: 'مؤرشف' } : p));
      if (!featureFlags.salesOnlyMode) {
        api.getReports().then(r => setReports(r)).catch(() => {});
      }
    }
    return res;
  };

  // Quick Sell from Products page
  const handleQuickSell = (item: Item) => {
    setInitialItemToSell(item);
    executeNavigate('pos');
  };

  // Platform Operations
  const handleSavePlatform = async (platformData: Partial<Platform> & { name: string }) => {
    const res = await api.savePlatform(platformData);
    if (res.success && res.platform) {
      setPlatforms(prev => {
        const idx = prev.findIndex(p => p.id === res.platform.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = res.platform;
          return updated;
        }
        return [...prev, res.platform];
      });
    } else {
      throw new Error((res as any)?.error || 'فشل حفظ بيانات المنصة');
    }
  };

  const handleSaveCost = async (costObj: ItemPlatformCost) => {
    const res = await api.saveItemPlatformCost(costObj);
    if (res.success) {
      setCosts(prev => {
        const idx = prev.findIndex(c => c.itemId === costObj.itemId && c.platformId === costObj.platformId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = costObj;
          return updated;
        }
        return [...prev, costObj];
      });
    } else {
      throw new Error((res as any)?.error || 'فشل حفظ تكاليف الشحن');
    }
  };

  // Invoice Operations
  const handleCreateInvoice = async (invoicePayload: any): Promise<Invoice> => {
    if (isOffline) {
      const offlineRes = await createOfflineInvoiceInDb({
        invoicePayload,
        user,
        fallbackItems: items,
        fallbackPlatforms: platforms,
        fallbackCustomers: customers,
        taxSettings: config.taxSettings,
        platformsEnabled: featureFlags.platformsEnabled,
        salesRules: config.salesRules
      });

      setInvoices(prev =>
        prev.some(i => i.invoiceNumber === offlineRes.invoice.invoiceNumber)
          ? prev
          : [offlineRes.invoice, ...prev]
      );
      setItems(offlineRes.updatedItems);
      return offlineRes.invoice;
    }

    const res = await api.createInvoice({
      ...invoicePayload,
      createdBy: user?.name || 'كاشير'
    });

    if (res.success && res.invoice) {
      const alreadyExists = Boolean((res as any).duplicate) || invoices.some(i => i.invoiceNumber === res.invoice.invoiceNumber);
      if (!alreadyExists) {
        // Add invoice to state
        setInvoices(prev => (prev.some(i => i.invoiceNumber === res.invoice.invoiceNumber) ? prev : [res.invoice, ...prev]));

        // Deduct stock in state (supports negative stock when policy is enabled)
        setItems(prev => prev.map(p => {
          const matchingLine = (res.invoice.lines || []).find(l => l.itemId === p.id);
          if (matchingLine) {
            return {
              ...p,
              stockQuantity: p.stockQuantity - matchingLine.quantity
            };
          }
          return p;
        }));
      }

      // بث تحديث المخزون لبقية تبويبات POS المفتوحة أونلاين دون المساس بسلالها
      postTabSyncMessage({
        type: 'POS_STOCK_UPDATED',
        sourceTabId: tabId,
        warehouseId: invoicePayload?.warehouseId,
        itemIds: (res.invoice.lines || []).map((l: any) => l.itemId),
        invoiceNumber: res.invoice.invoiceNumber,
        at: Date.now()
      });

      // Update reports
      if (!featureFlags.salesOnlyMode) {
        api.getReports().then(r => setReports(r)).catch(() => {});
      }

      return res.invoice;
    }
    const err: any = new Error(res.error || res.message || 'فشل تسجيل الفاتورة');
    err.code = (res as any)?.code;
    throw err;
  };

  const handleInvoiceCreated = (
    createdInvoice: Invoice,
    extra?: { changeGiven?: number; customerBalanceAfter?: number; shouldPrint?: boolean }
  ) => {
    // «حفظ بدون طباعة» (F3) لا يطبع ولا يفتح معاينة الطباعة إطلاقًا
    if (extra?.shouldPrint === false) {
      showInvoiceToast(createdInvoice.invoiceNumber, createdInvoice.deliveryOrderId);
      setTimeout(() => {
        const barcodeInput = document.getElementById('pos-barcode-input');
        barcodeInput?.focus();
      }, 50);
      return;
    }

    // «حفظ مع الطباعة» (F2) يحفظ ثم يطبع دائمًا بغض النظر عن إعداد معاينة الطباعة
    const showPreview =
      extra?.shouldPrint === true ? false : Boolean(config.invoicePrintSettings?.showReceiptPreview);
    if (showPreview) {
      setIsReprint(false);
      setInvoicePrintExtra(extra || {});
      setInvoiceToPrint(createdInvoice);
    } else {
      showInvoiceToast(createdInvoice.invoiceNumber, createdInvoice.deliveryOrderId);
      printReceipt(createdInvoice, {
        companySettings: config.companySettings,
        invoicePrintSettings: config.invoicePrintSettings,
        storeName: config.companySettings?.storeName || config.storeName,
        isReprint: false,
        customers,
        items,
        changeGiven: extra?.changeGiven,
        customerBalanceAfter: extra?.customerBalanceAfter,
        onAfterPrint: () => {
          setTimeout(() => {
            const barcodeInput = document.getElementById('pos-barcode-input');
            barcodeInput?.focus();
          }, 50);
        }
      });
    }
  };

  const handlePrintInvoice = (inv: Invoice, reprint = true, forceModal = false) => {
    const showPreview = Boolean(config.invoicePrintSettings?.showReceiptPreview);
    if (forceModal || showPreview) {
      setIsReprint(reprint);
      if (reprint) setInvoicePrintExtra({});
      setInvoiceToPrint(inv);
    } else {
      printReceipt(inv, {
        companySettings: config.companySettings,
        invoicePrintSettings: config.invoicePrintSettings,
        storeName: config.companySettings?.storeName || config.storeName,
        isReprint: reprint,
        customers,
        items,
        onAfterPrint: () => {
          setTimeout(() => {
            const barcodeInput = document.getElementById('pos-barcode-input');
            barcodeInput?.focus();
          }, 50);
        }
      });
    }
  };

  const handleUpdateInvoice = async (invoiceNumber: string, payload: any): Promise<void> => {
    if (isOffline) {
      throw new Error('متاح عند رجوع الاتصال');
    }
    const res = await api.updateInvoice(invoiceNumber, payload);
    if (res.success && res.invoice) {
      setInvoices(prev => prev.map(inv => inv.invoiceNumber === invoiceNumber ? res.invoice : inv));
      // Reload inventory & reports to reflect stock and ledger changes
      api.getItems().then(r => r.items && setItems(r.items)).catch(() => {});
      if (!featureFlags.salesOnlyMode) {
        api.getReports().then(r => setReports(r)).catch(() => {});
      }
      return;
    }
    throw new Error(res.message || 'فشل تعديل الفاتورة');
  };

  // Returns Operations
  const handleInitiateReturn = (inv: Invoice) => {
    if (isOffline) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToastInvoiceMessage('متاح عند رجوع الاتصال');
      toastTimerRef.current = setTimeout(() => {
        setToastInvoiceMessage(null);
      }, 3000);
      return;
    }
    setPreselectedInvoiceForReturn(inv);
    executeNavigate('returns');
  };

  const handleCreateReturn = async (returnPayload: any) => {
    if (isOffline) {
      throw new Error('متاح عند رجوع الاتصال');
    }
    const res = await api.createReturn({
      ...returnPayload,
      createdBy: user?.name || 'المسؤول'
    });

    if (res.success && res.returnRecord) {
      const alreadyExists = Boolean((res as any).duplicate) || returns.some(r => r.returnNumber === res.returnRecord.returnNumber);
      if (!alreadyExists) {
        setReturns(prev => (prev.some(r => r.returnNumber === res.returnRecord.returnNumber) ? prev : [res.returnRecord, ...prev]));

        // Restock inventory for restocked items
        setItems(prev => prev.map(p => {
          const matchingLine = (res.returnRecord.lines || []).find(
            l => l.itemId === p.id && l.itemCondition === 'يرجع المخزن'
          );
          if (matchingLine) {
            return {
              ...p,
              stockQuantity: p.stockQuantity + matchingLine.returnedQuantity
            };
          }
          return p;
        }));

        // Update invoice status
        if (res.returnRecord.invoiceNumber) {
          setInvoices(prev => prev.map(i => 
            i.invoiceNumber === res.returnRecord.invoiceNumber ? { ...i, status: 'مرتجع' } : i
          ));
        }
      }

      if (!featureFlags.salesOnlyMode) {
        api.getReports().then(r => setReports(r)).catch(() => {});
      }
    } else {
      const err: any = new Error((res as any)?.error || 'فشل تسجيل المرتجع');
      err.code = (res as any)?.code;
      throw err;
    }
  };

  // Settings & Sheets Handlers
  const handleUpdateAppsScriptUrl = async (url: string) => {
    const res = await api.updateConfig(url);
    if (res.success) {
      setConfig(prev => ({
        ...prev,
        ...res.config,
        persistenceMode: res.config.persistenceMode ?? prev.persistenceMode
      }));
    }
  };

  const handleTestConnection = async (url?: string) => {
    const res = await api.testConnection(url);
    if (res.success) {
      const conf = await api.getConfig();
      setConfig(prev => ({
        ...prev,
        ...conf,
        persistenceMode: conf.persistenceMode ?? prev.persistenceMode
      }));
    }
    return res;
  };

  const handleSetupSheets = async (url?: string) => {
    const res = await api.setupSheets(url);
    if (res.success) {
      const conf = await api.getConfig();
      setConfig(prev => ({
        ...prev,
        ...conf,
        persistenceMode: conf.persistenceMode ?? prev.persistenceMode
      }));
    }
    return res;
  };

  const handleSaveUser = async (userData: any) => {
    const res = await api.saveUser(userData);
    if (res.success && res.user) {
      setUsers(prev => {
        const idx = prev.findIndex(u => u.id === res.user.id || u.phone === res.user.phone);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = res.user;
          return updated;
        }
        return [...prev, res.user];
      });
      if (user && user.id === res.user.id) {
        setUser(res.user);
        localStorage.setItem('pos_user', JSON.stringify(res.user));
      }
    }
    return res;
  };

  const showSheetsDisconnectedBanner =
    !isOffline &&
    config.dataMode === 'sheets' &&
    (config.connectionHealth?.healthy === false || config.setupCheckError === true);

  const offlineModeBanner = isOffline ? (
    <div
      role="status"
      dir="rtl"
      className="no-print fixed top-0 inset-x-0 z-[100] bg-amber-500 text-amber-950 border-b border-amber-600 shadow-lg px-4 py-2.5 flex flex-wrap items-center justify-center gap-2.5 text-xs sm:text-sm font-extrabold"
    >
      <WifiOff className="w-4 h-4 shrink-0 text-amber-950" />
      <span>تعمل الآن بدون إنترنت. العمليات تُحفظ على هذا الجهاز وتُرفع عند رجوع الاتصال</span>
    </div>
  ) : null;

  const formattedStaleTime = staleInfo.lastSyncAt
    ? (() => {
        const d = new Date(staleInfo.lastSyncAt);
        if (isNaN(d.getTime())) return staleInfo.lastSyncAt;
        return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
          timeZone: 'Africa/Cairo',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          day: 'numeric',
          month: 'short'
        }).format(d);
      })()
    : '';

  const sheetsDisconnectedBanner = showSheetsDisconnectedBanner ? (
    <div
      role="alert"
      dir="rtl"
      className="no-print fixed top-0 inset-x-0 z-[100] bg-rose-700 text-white border-b border-rose-800 shadow-lg px-4 py-2.5 flex flex-wrap items-center justify-center gap-3 text-xs sm:text-sm font-bold"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-200" />
        <span>الاتصال بقاعدة البيانات متوقف. العمليات لن تُحفظ حتى يعود الاتصال</span>
      </div>
      <button
        type="button"
        onClick={handleRetrySheetsConnection}
        disabled={isRetryingConnection}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white text-rose-800 hover:bg-rose-50 font-extrabold text-xs shadow-xs transition active:scale-95 disabled:opacity-60 cursor-pointer"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isRetryingConnection ? 'animate-spin' : ''}`} />
        <span>إعادة المحاولة</span>
      </button>
    </div>
  ) : null;

  const hasFixedTopBanner = isOffline || showSheetsDisconnectedBanner;

  // If not logged in, show login page
  if (!user) {
    return (
      <div className={hasFixedTopBanner ? 'pt-14 sm:pt-11' : ''}>
        {offlineModeBanner}
        {sheetsDisconnectedBanner}
        <LoginPage
          onLoginSuccess={handleLoginSuccess}
          hasManager={config.hasManager}
          sessionExpiredMsg={
            sessionExpiredNotice
              ? (sessionExpiredMessage || (lang === 'ar' ? 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا' : 'Session expired. Please sign in again'))
              : null
          }
          currentLang={lang}
          onLanguageChange={setLang}
        />
      </div>
    );
  }

  // منع عرض أي صفحة أو بيانات محمية مؤقتًا اعتمادًا على صلاحيات localStorage قبل التحقق من الجلسة والصلاحيات
  if (!isAuthPermissionsVerified) {
    return (
      <div
        dir="rtl"
        className={`min-h-[calc(100vh/var(--app-zoom,1))] w-full flex flex-col items-center justify-center bg-[var(--app-bg)] text-[var(--text-primary)] p-6 text-center gap-3 ${
          hasFixedTopBanner ? 'pt-14 sm:pt-11' : ''
        }`}
      >
        {offlineModeBanner}
        {sheetsDisconnectedBanner}
        <RefreshCw className="w-7 h-7 animate-spin text-[#1668B2]" />
        <p className="text-sm font-extrabold text-[var(--text-primary)]">
          جارٍ التحقق من الجلسة والصلاحيات...
        </p>
      </div>
    );
  }

  // عند أول دخول أو بعد إعادة تعيين كلمة السر: منع الوصول لأي شاشة قبل إتمام إعداد الحساب
  if (user.mustChangePassword) {
    return (
      <InitialAccountSetupModal
        user={user}
        onCompleted={(updatedUser) => {
          const cleanUser: UserAccount = { ...updatedUser, mustChangePassword: false };
          setUser(cleanUser);
          localStorage.setItem('pos_user', JSON.stringify(cleanUser));
          const homeTarget = getDefaultHomeTarget(featureFlags);
          const normalized = normalizeNavigationTarget(homeTarget.page, undefined, cleanUser, featureFlags);
          setCurrentPage(normalized.page);
          setCurrentTab(normalized.tab);
          try {
            if (getCurrentBrowserUrl() !== normalized.path) {
              window.history.replaceState({}, '', normalized.path);
            }
          } catch (_) {}
        }}
        onLogout={handleLogout}
      />
    );
  }

  const role: UserRole = user.role || 'employee';
  const lowStockCount = items.filter(p => p.status !== 'inactive' && p.status !== 'موقوف' && p.stockQuantity <= 5).length;

  const isScreenOnlyUser = isVisitorScreenOnlyUser(user);
  const canViewVisitorScreen =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'visitor.display') ||
    hasPermission(user, 'settings.visitor_display');

  // شاشة الزوار (/visitor): شاشة كاملة بدون الهيدر ولا القائمة الجانبية ولا الشريط السفلي
  if (currentPage === 'visitor' || isScreenOnlyUser) {
    if (!canViewVisitorScreen) {
      const homeHref = getHrefForTarget(getDefaultHomeTarget(featureFlags).page, undefined, {
        user,
        flags: featureFlags
      });
      return (
        <div
          dir="rtl"
          className="min-h-[calc(100vh/var(--app-zoom,1))] w-full flex flex-col items-center justify-center bg-[var(--app-bg)] p-6 text-center gap-4"
        >
          <p className="text-base font-extrabold text-[#D9524F]">
            غير مصرح لك بفتح شاشة الزوار
          </p>
          <a
            href={homeHref}
            onClick={(e) => {
              if (!isPlainLeftClick(e)) return;
              e.preventDefault();
              handleNavigate(getDefaultHomeTarget(featureFlags).page);
            }}
            className="min-h-[44px] px-5 rounded-lg bg-[#1668B2] text-white text-xs font-bold inline-flex items-center justify-center cursor-pointer"
          >
            الرجوع للرئيسية
          </a>
        </div>
      );
    }

    return (
      <VisitorDisplayPage
        user={user}
        isScreenOnlyAccount={isScreenOnlyUser}
        onExit={() => handleNavigate(getDefaultHomeTarget(featureFlags).page)}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <KeyboardShortcutsProvider
      rawSettings={config.displaySettings?.keyboardShortcuts ?? config.companySettings?.keyboardShortcuts}
      user={user}
      currentPage={currentPage}
      featureFlags={featureFlags}
      onNavigate={handleNavigate}
    >
      <PrintCompanyProvider
        storeName={config.companySettings?.storeName || config.storeName}
        logoUrl={config.companySettings?.logoUrl}
      >
        <div
          className={`app-shell min-h-[calc(100vh/var(--app-zoom,1))] bg-[var(--app-bg)] text-[var(--text-primary)] flex flex-col font-sans transition-colors duration-150 ${
            hasFixedTopBanner ? 'pt-14 sm:pt-11' : ''
          }`}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
        >
          {offlineModeBanner}
          {sheetsDisconnectedBanner}

        {/* Top Navbar */}
        <Navbar
          config={config}
          user={user}
          currentPage={currentPage}
          salesOnlyMode={Boolean(featureFlags.salesOnlyMode)}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
          onSync={loadData}
          isSyncing={isSyncing}
          manualBalanceRequests={manualBalanceRequests}
          manualBalanceAlerts={manualBalanceAlerts}
          dismissedManualDueKeys={dismissedManualDueKeys}
          onOpenManualBalanceRequest={(req) => {
            setForcedManualRequestId(req.accountId);
          }}
          onOpenManualBalanceAlerts={() => {
            try {
              sessionStorage.setItem(BANK_LINK_FOCUS_ALERTS_STORAGE_KEY, '1');
            } catch (_) {}
            handleNavigate('settings', 'bank_link');
          }}
        />

        {balanceRequiredBanner && (
          <div
            role="alert"
            dir="rtl"
            className="no-print bg-rose-50 border-b border-rose-300 text-rose-900 px-4 py-2 text-xs font-extrabold flex flex-wrap items-center justify-center gap-3"
          >
            <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" />
            <span>{balanceRequiredBanner}</span>
            <button
              type="button"
              onClick={() => setBalanceRequiredBanner(null)}
              className="text-rose-800 hover:text-rose-950 underline text-xs cursor-pointer"
            >
              إخفاء
            </button>
          </div>
        )}

        {/* شريط تفعيل النسخ الاحتياطي بضغطة واحدة إذا سقط الإذن بعد إعادة تشغيل المتصفح */}
        {backupDirStatus?.needsActivationBanner && (
          <div
            role="region"
            aria-label="تفعيل النسخ الاحتياطي"
            dir="rtl"
            className="no-print bg-amber-100 border-b border-amber-300 text-amber-950 px-4 py-2 text-xs font-extrabold flex flex-wrap items-center justify-center gap-3"
          >
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-amber-800 shrink-0" />
              <span>
                إذن مجلد النسخ الاحتياطي ({backupDirStatus.directoryName}) يحتاج للتفعيل بعد إعادة تشغيل المتصفح لحفظ العمليات تلقائيًا قبل الطباعة.
              </span>
            </div>
            <button
              type="button"
              onClick={handleOneClickActivateBackup}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs shadow-xs transition cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>فعّل النسخ الاحتياطي</span>
            </button>
          </div>
        )}

        {/* تنبيه امتلاء التخزين (تحذير عند 80%، وإيقاف البيع عند الامتلاء الفعلي 100%) */}
        {storageQuotaStatus && (storageQuotaStatus.isWarning || storageQuotaStatus.isFull) && (
          <div
            role="alert"
            dir="rtl"
            className={`no-print px-4 py-2 text-xs font-extrabold border-b flex flex-wrap items-center justify-center gap-2 ${
              storageQuotaStatus.isFull
                ? 'bg-rose-700 text-white border-rose-800'
                : 'bg-amber-50 text-amber-950 border-amber-300'
            }`}
          >
            <HardDrive className="w-4 h-4 shrink-0" />
            <span>{storageQuotaStatus.fullErrorMessage || storageQuotaStatus.warningMessage}</span>
          </div>
        )}

        {/* تنبيه كل ساعة طالما توجد عمليات معلّقة (البيع لا يتوقف) */}
        {hourlyAlertBanner && (
          <div
            role="status"
            dir="rtl"
            className="no-print bg-amber-50 border-b border-amber-300 text-amber-950 px-4 py-2 text-xs font-extrabold flex flex-wrap items-center justify-center gap-3"
          >
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-700 shrink-0" />
              <span>{hourlyAlertBanner.message}</span>
              {hourlyAlertBanner.downloadedFallbackFile && (
                <span className="px-2 py-0.5 rounded bg-amber-200/80 text-amber-950 text-[11px]">
                  تم تنزيل ملف احتياطي بالعمليات المعلّقة تلقائيًا
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setHourlyAlertBanner(null)}
              className="text-amber-800 hover:text-amber-950 underline text-xs cursor-pointer"
            >
              إخفاء
            </button>
          </div>
        )}

        {staleInfo.stale && (
          <div
            role="status"
            dir="rtl"
            className="no-print bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-1.5 text-xs font-bold flex items-center justify-center gap-2"
          >
            <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>
              يتم عرض آخر نسخة محفوظة من قاعدة البيانات مؤقتًا
              {formattedStaleTime ? ` • آخر تحديث: ${formattedStaleTime}` : ' • آخر تحديث: غير معروف'}
            </span>
          </div>
        )}

      {/* Main Body with Sidebar */}
      <div className={`flex-1 flex w-full transition-all duration-150 ${
        currentPage === 'pos' ? 'max-w-none px-2 py-2' : 'max-w-none'
      }`}>
        
        {/* Desktop Sidebar & Mobile Drawer */}
        <Sidebar
          currentPage={currentPage}
          currentTab={currentTab}
          onNavigate={handleNavigate}
          user={user}
          lowStockCount={lowStockCount}
          lang={lang}
          isMobileOpen={isMobileMenuOpen}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapsed={() => setIsSidebarCollapsed(prev => !prev)}
          isOffline={isOffline}
          featureFlags={featureFlags}
        />

        {/* Page Content Container: بدون أي قيود ارتفاع أو overflow في صفحة POS */}
        <main className={`flex-1 max-w-full ${
          currentPage === 'pos' ? 'p-0' : 'p-4 sm:p-6 lg:p-8 overflow-x-clip'
        }`}>
          {currentPage === 'dashboard' && isPageAllowedByFeatureModes('dashboard', currentTab, featureFlags) && (
            <DashboardPage
              reports={reports}
              items={items}
              platforms={platforms}
              invoices={invoices}
              config={config}
              userRole={role}
              user={user}
              appTheme={appTheme}
              platformsEnabled={featureFlags.platformsEnabled}
              onNavigate={handleNavigate}
              onOpenProductModal={handleOpenProductModal}
              onOpenInvoiceDetails={(inv) => {
                setIsReprint(true);
                setInvoicePrintExtra({});
                setInvoiceToPrint(inv);
              }}
            />
          )}

          {currentPage === 'pos' && (
            <POSPage
              items={items}
              categories={categories}
              platforms={platforms}
              costs={costs}
              user={user}
              userRole={role}
              taxSettings={config.taxSettings}
              companySettings={config.companySettings}
              enableDeliveryFee={config.enableDeliveryFee ?? config.companySettings?.enableDeliveryFee ?? false}
              storeName={config.companySettings?.storeName || config.storeName}
              customers={customers}
              invoicePrintSettings={config.invoicePrintSettings}
              displaySettings={config.displaySettings}
              platformsEnabled={featureFlags.platformsEnabled}
              salesRulesFromConfig={config.salesRules}
              onUpdateDisplaySettings={async (patch) => {
                const nextDisplay = {
                  showItemImages: true,
                  showStockQuantity: true,
                  showStockStatusBadge: true,
                  showSalePrice: true,
                  visibleColumns: ['image', 'name', 'salePrice', 'stock', 'actions'],
                  posLayout: 'grid' as const,
                  enableQuickBarcodeScan: true,
                  confirmInvoiceBeforeSave: true,
                  posShowCustomerAddress: true,
                  posShowCustomerPhone: true,
                  posShowCustomerBalance: true,
                  ...(config.displaySettings || {}),
                  ...patch
                };
                setConfig(prev => ({
                  ...prev,
                  displaySettings: nextDisplay
                }));
                try {
                  await api.saveDisplaySettings(nextDisplay);
                } catch (_) {}
              }}
              allowNegativeStockSale={config.stockSettings?.allowNegativeStockSale}
              initialItemToAdd={initialItemToSell}
              onClearInitialItem={() => setInitialItemToSell(null)}
              onCreateInvoice={handleCreateInvoice}
              onInvoiceCreated={handleInvoiceCreated}
              invoices={invoices}
              onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
              onNavigateMain={(page, tab) => handleNavigate(page, tab)}
              onPrintInvoice={(inv, reprint = true, autoPrint?: boolean) => {
                const forceModal = autoPrint === false;
                handlePrintInvoice(inv, reprint, forceModal);
              }}
            />
          )}

          {currentPage === 'items' && Boolean(findSubItemForTarget('items', currentTab, user, featureFlags)) && (
            itemRoute &&
            ((itemRoute.mode === 'new' && canUserCreateItem(user, featureFlags)) ||
              (itemRoute.mode === 'edit' && canUserEditItem(user, featureFlags))) ? (
              <ProductFormPage
                mode={itemRoute.mode}
                itemId={itemRoute.mode === 'edit' ? itemRoute.itemId : undefined}
                item={itemRoute.mode === 'edit' ? editingItem : null}
                platforms={platforms}
                costs={costs}
                userRole={role}
                user={user}
                existingItems={items}
                categories={categories}
                taxInclusiveSetting={config.taxSettings?.taxInclusive ?? true}
                platformsEnabled={featureFlags.platformsEnabled}
                onSave={handleSaveItem}
                onBackToList={handleBackToItemsList}
                onNavigateItemRoute={handleNavigateItemRoute}
                onDirtyChange={setIsItemFormDirty}
              />
            ) : (
              <ProductsPage
                items={items}
                categories={categories}
                platforms={platforms}
                costs={costs}
                userRole={role}
                user={user}
                displaySettings={config.displaySettings}
                currentTab={currentTab}
                initialCategoryId={itemsInitialCategoryId}
                onNavigateItemRoute={handleNavigateItemRoute}
                onDeleteItem={handleDeleteItem}
                onArchiveItem={handleArchiveItem}
                onRefreshItems={loadData}
                onQuickSell={handleQuickSell}
                onOpenBulkImport={() =>
                  handleNavigate('bulk_edit_excel', 'add_items', {
                    searchParams: { operationType: 'add_items' }
                  })
                }
              />
            )
          )}

          {currentPage === 'bulk_edit_excel' && isPageAllowedByFeatureModes('bulk_edit_excel', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'products.bulk_edit_excel')) ? (
              <BulkEditExcelPage
                user={user}
                onRefreshItems={loadData}
                initialOperationType={
                  currentTab === 'add_items' || bulkEditOperationTypeParam === 'add_items'
                    ? 'add_items'
                    : currentTab === 'add_categories' || bulkEditOperationTypeParam === 'add_categories'
                    ? 'add_categories'
                    : undefined
                }
              />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200">
                غير مصرح لك بعرض صفحة التعديل بالإكسيل
              </div>
            )
          )}

          {currentPage === 'label_print' && isPageAllowedByFeatureModes('label_print', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'items.print_labels')) ? (
              <LabelPrintPage
                items={items}
                user={user}
                config={config}
                onItemUpdated={(updatedItem) => {
                  setItems((prev) =>
                    prev.map((it) => (it.id === updatedItem.id ? { ...it, ...updatedItem } : it))
                  );
                }}
                onRefreshItems={loadData}
              />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200">
                غير مصرح لك بعرض شاشة طباعة التكت
              </div>
            )
          )}

          {currentPage === 'delivery_settings' && isPageAllowedByFeatureModes('delivery_settings', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'delivery.settings')) ? (
              <DeliverySettingsPage user={user} />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200 font-bold">
                غير مصرح لك بعرض إعدادات التوصيل
              </div>
            )
          )}

          {currentPage === 'delivery_orders' && isPageAllowedByFeatureModes('delivery_orders', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'delivery.view')) ? (
              <DeliveryOrdersPage
                user={user}
                onReturnCreated={loadData}
                initialSearch={deliveryOrdersInitialSearch}
                onClearInitialSearch={() => setDeliveryOrdersInitialSearch('')}
              />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200 font-bold">
                غير مصرح لك بعرض طلبات التوصيل
              </div>
            )
          )}

          {currentPage === 'delivery_settlements' && isPageAllowedByFeatureModes('delivery_settlements', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'delivery.settle')) ? (
              <DeliverySettlementsPage
                user={user}
                onFinancialChange={loadData}
              />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200 font-bold">
                غير مصرح لك بعرض التسويات ومستحقات الطيارين
              </div>
            )
          )}

          {currentPage === 'delivery_my_orders' && isPageAllowedByFeatureModes('delivery_my_orders', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'delivery.driver')) ? (
              <DeliveryMyOrdersPage user={user} />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200 font-bold">
                غير مصرح لك بعرض شاشة طلبات الطيار
              </div>
            )
          )}

          {currentPage === 'delivery_reports' && isPageAllowedByFeatureModes('delivery_reports', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'delivery.reports')) ? (
              <DeliveryReportsPage user={user} />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200 font-bold">
                غير مصرح لك بعرض تقارير التوصيل
              </div>
            )
          )}

          {currentPage === 'categories' && isPageAllowedByFeatureModes('categories', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'categories.view')) ? (
              <CategoriesPage
                categories={categories}
                items={items}
                userRole={role}
                user={user}
                onRefreshCategories={async () => {
                  const res = await api.getCategories();
                  if (res.success && res.categories) {
                    setCategories(res.categories);
                  }
                }}
                onNavigateToItemsWithCategory={(catId) => {
                  handleNavigate('items', 'ALL', {
                    searchParams: catId ? { category: catId } : undefined
                  });
                }}
              />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200">
                غير مصرح لك بعرض شاشة إدارة التصنيفات
              </div>
            )
          )}

          {currentPage === 'warehouses' && isPageAllowedByFeatureModes('warehouses', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'warehouses.view') || hasPermission(user, 'warehouses.manage')) ? (
              <WarehousesPage
                user={user}
                onRefreshData={loadData}
              />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200 font-bold">
                غير مصرح لك بعرض شاشة المخازن
              </div>
            )
          )}

          {currentPage === 'warehouse_transfers' && isPageAllowedByFeatureModes('warehouse_transfers', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'warehouses.transfer')) ? (
              <WarehouseTransferPage
                user={user}
                items={items}
                allowNegativeWarehouseTransfer={Boolean(config.stockSettings?.allowNegativeWarehouseTransfer)}
                barcodeScanMode={config.displaySettings?.barcodeScanMode}
                latestItemFirst={normalizeLatestItemFirst(config.displaySettings?.latestItemFirst).warehouseTransfer}
                onRefreshData={loadData}
                onNavigateToDispatchOrders={() => handleNavigate('warehouse_dispatch_orders')}
              />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200 font-bold">
                غير مصرح لك بالتحويل بين المخازن
              </div>
            )
          )}

          {currentPage === 'warehouse_excel_transfer' && isPageAllowedByFeatureModes('warehouse_excel_transfer', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'warehouses.transfer')) ? (
              <WarehouseExcelTransferPage
                user={user}
                items={items}
                allowNegativeWarehouseTransfer={Boolean(config.stockSettings?.allowNegativeWarehouseTransfer)}
                onRefreshData={loadData}
                onNavigateToDispatchOrders={() => handleNavigate('warehouse_dispatch_orders')}
              />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200 font-bold">
                غير مصرح لك بالنقل بالإكسيل بين المخازن
              </div>
            )
          )}

          {currentPage === 'warehouse_dispatch_orders' && isPageAllowedByFeatureModes('warehouse_dispatch_orders', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'warehouses.view') || hasPermission(user, 'warehouses.transfer')) ? (
              <WarehouseDispatchOrdersPage
                user={user}
                companySettings={config.companySettings}
                onNavigateToNewTransfer={() => handleNavigate('warehouse_transfers')}
              />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200 font-bold">
                غير مصرح لك بعرض أوامر الصرف
              </div>
            )
          )}

          {currentPage === 'purchases' && Boolean(findSubItemForTarget('purchases', currentTab, user, featureFlags)) && (
            <PurchasesPage
              items={items}
              user={user}
              userRole={role}
              barcodeScanMode={config.displaySettings?.barcodeScanMode}
              purchaseLatestItemFirst={normalizeLatestItemFirst(config.displaySettings?.latestItemFirst).purchases}
              purchaseReturnLatestItemFirst={normalizeLatestItemFirst(config.displaySettings?.latestItemFirst).purchaseReturn}
              onRefreshItems={loadData}
              initialTab={currentTab as any}
              initialSupplierId={purchasesInitialSupplierId}
              onNavigate={handleNavigate}
            />
          )}

          {currentPage === 'customers' && Boolean(findSubItemForTarget('customers', currentTab, user, featureFlags)) && (
            <CustomersPage
              user={user}
              userRole={role}
              initialTab={currentTab as any}
              initialCustomerId={customersInitialCustomerId}
              onNavigate={handleNavigate}
            />
          )}

          {currentPage === 'cashboxes' && Boolean(findSubItemForTarget('cashboxes', currentTab, user, featureFlags)) && (
            <CashboxesPage
              user={user}
              userRole={role}
              users={users}
              initialTab={currentTab as any}
              initialCashboxId={cashboxesInitialCashboxId}
              onNavigate={handleNavigate}
            />
          )}

          {currentPage === 'platforms' && Boolean(findSubItemForTarget('platforms', currentTab, user, featureFlags)) && (
            <PlatformsPage
              platforms={platforms}
              items={items}
              costs={costs}
              user={user}
              userRole={role}
              onSavePlatform={handleSavePlatform}
              onSaveCost={handleSaveCost}
              initialTab={currentTab as any}
              initialPlatformId={platformsInitialPlatformId}
              onNavigate={handleNavigate}
            />
          )}

          {currentPage === 'invoices' && Boolean(findSubItemForTarget('invoices', currentTab, user, featureFlags)) && (
            <InvoicesPage
              invoices={invoices}
              platforms={platforms}
              userRole={role}
              user={user}
              items={items}
              costs={costs}
              returns={returns}
              taxSettings={config.taxSettings}
              editInvoiceLatestItemFirst={normalizeLatestItemFirst(config.displaySettings?.latestItemFirst).editInvoice}
              onPrintInvoice={(inv, isReprint = true, forceModal = false) => {
                handlePrintInvoice(inv, isReprint, forceModal);
              }}
              onInitiateReturn={handleInitiateReturn}
              onUpdateInvoice={handleUpdateInvoice}
              onNavigateToDeliveryOrders={(searchTerm) => {
                setDeliveryOrdersInitialSearch(searchTerm || '');
                handleNavigate('delivery_orders', undefined, {
                  searchParams: searchTerm ? { search: searchTerm } : undefined
                });
              }}
              onNavigateToDeliverySettlements={() => handleNavigate('delivery_settlements')}
            />
          )}

          {currentPage === 'credit_collection' && Boolean(findSubItemForTarget('credit_collection', currentTab, user, featureFlags)) && (
            <CreditCollectionView
              user={user}
              customers={customers}
              platforms={platforms}
              platformsEnabled={featureFlags.platformsEnabled}
              onCollectionSuccess={loadData}
            />
          )}

          {currentPage === 'returns' && Boolean(findSubItemForTarget('returns', currentTab, user, featureFlags)) && (
            <ReturnsPage
              returns={returns}
              invoices={invoices}
              items={items}
              user={user}
              barcodeScanMode={config.displaySettings?.barcodeScanMode}
              latestItemFirst={normalizeLatestItemFirst(config.displaySettings?.latestItemFirst).salesReturn}
              onCreateReturn={handleCreateReturn}
              preselectedInvoice={preselectedInvoiceForReturn}
              onClearPreselectedInvoice={() => setPreselectedInvoiceForReturn(null)}
            />
          )}

          {currentPage === 'reports' && Boolean(findSubItemForTarget('reports', currentTab, user, featureFlags)) && (
            <ReportsPage
              reports={reports}
              items={items}
              platforms={platforms}
              invoices={invoices}
              returns={returns}
              users={users}
              user={user}
              userRole={role}
              initialTab={currentTab as any}
              platformsEnabled={featureFlags.platformsEnabled}
            />
          )}

          {currentPage === 'permissions' && isPageAllowedByFeatureModes('permissions', currentTab, featureFlags) && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'permissions.view') || hasPermission(user, 'permissions.manage')) ? (
              <PermissionsPage
                currentUser={user}
                users={users}
                onUserPermissionsUpdated={(updatedUser) => {
                  setUsers(prev => prev.map(u => (u.id === updatedUser.id ? updatedUser : u)));
                  if (user && user.id === updatedUser.id) {
                    setUser(updatedUser);
                    localStorage.setItem('pos_user', JSON.stringify(updatedUser));
                  }
                }}
                onRefreshUsers={async () => {
                  if (isOffline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
                    const localUsers = await getDecryptedOfflineUsers();
                    if (localUsers.length > 0) setUsers(localUsers);
                    return;
                  }
                  const res = await api.getUsers();
                  if (res.success && res.users) {
                    setUsers(res.users);
                    saveOfflineSnapshot({ user, users: res.users }).catch(() => {});
                  }
                }}
              />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200">
                غير مصرح لك بعرض مصفوفة الصلاحيات
              </div>
            )
          )}

          {currentPage === 'audit' && isPageAllowedByFeatureModes('audit', currentTab, featureFlags) && (
            (user.role === 'designer' || hasPermission(user, 'audit.view')) ? (
              <AuditLogsPage users={users} />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200">
                غير مصرح لك بعرض سجل التدقيق
              </div>
            )
          )}

          {currentPage === 'settings' && (
            <SettingsPage
              config={config}
              items={items}
              categories={categories}
              users={users}
              currentUser={user}
              onSaveUser={handleSaveUser}
              onSyncAll={loadData}
              onLogout={handleLogout}
              onForceLogoutAfterReset={handleForceLogoutAfterReset}
              initialTab={currentTab as any}
              appTheme={appTheme}
              onChangeTheme={setAppTheme}
              motionMode={motionMode}
              onChangeMotion={setMotionMode}
              onDirtyChange={setIsSettingsDirty}
              onRegisterRevert={(fn) => {
                settingsRevertRef.current = fn;
              }}
              onSalesRulesUpdated={(nextRules) => {
                persistCachedSalesRules(nextRules);
                updateOfflineCachedSalesRules(nextRules).catch(() => {});
                setConfig((prev) => ({
                  ...prev,
                  salesRules: nextRules
                }));
              }}
              onUpdateKeyboardShortcuts={(nextShortcuts) => {
                setConfig((prev) => ({
                  ...prev,
                  displaySettings: {
                    showItemImages: true,
                    showStockQuantity: true,
                    showStockStatusBadge: true,
                    showSalePrice: true,
                    visibleColumns: ['name', 'price', 'stock'],
                    posLayout: 'grid',
                    enableQuickBarcodeScan: true,
                    confirmInvoiceBeforeSave: false,
                    posShowCustomerAddress: true,
                    posShowCustomerPhone: true,
                    posShowCustomerBalance: true,
                    ...(prev.displaySettings || {}),
                    keyboardShortcuts: nextShortcuts
                  },
                  companySettings: prev.companySettings
                    ? {
                        ...prev.companySettings,
                        keyboardShortcuts: nextShortcuts
                      }
                    : prev.companySettings
                }));
              }}
            />
          )}

          {currentPage === 'sync' && (
            (user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'offline.manage')) ? (
              <SyncPage
                user={user}
                invoices={invoices}
                initialTab={currentTab as any}
                onNavigate={handleNavigate}
                onRefreshData={loadData}
                onInvoiceReviewed={(updatedInvoice) => {
                  setInvoices(prev =>
                    prev.map(inv =>
                      inv.invoiceNumber === updatedInvoice.invoiceNumber ? updatedInvoice : inv
                    )
                  );
                }}
              />
            ) : (
              <div className="p-8 text-center text-rose-600 bg-rose-50 rounded-2xl border border-rose-200">
                غير مصرح لك بعرض شاشة المزامنة والعمل بدون إنترنت
              </div>
            )
          )}
        </main>

      </div>

      {/* Mobile Bottom Navigation Bar (48px+ touch targets) */}
      <MobileBottomNav
        currentPage={currentPage}
        currentTab={currentTab}
        onNavigate={handleNavigate}
        user={user}
        lowStockCount={lowStockCount}
        onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
        appTheme={appTheme}
        featureFlags={featureFlags}
      />

      {/* Modals */}
      {pendingNavConfirm?.open && (
        <div
          role="dialog"
          aria-modal="true"
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          dir="rtl"
        >
          {pendingNavConfirm.source === 'settings' ? (
            <div className="w-full max-w-md rounded-2xl bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border-color)] shadow-2xl p-6 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-base font-extrabold text-[var(--text-primary)]">
                    يوجد تغييرات غير محفوظة. تخرج بدون حفظ؟
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    ستعود المعاينات الفورية والتعديلات غير المحفوظة إلى آخر وضع محفوظ عند الخروج.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingNavConfirm(null)}
                  className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-extrabold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition cursor-pointer"
                >
                  البقاء
                </button>
                <button
                  type="button"
                  onClick={pendingNavConfirm.onConfirm}
                  className="min-h-[44px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold transition cursor-pointer"
                >
                  خروج بدون حفظ
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-2xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    تأكيد الخروج دون حفظ التعديلات
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    لديك تعديلات غير محفوظة في صفحة الصنف الحالية
                  </p>
                </div>
              </div>

              <p className="text-xs font-bold text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                هل أنت متأكد من رغبتك في تجاهل التعديلات غير المحفوظة ومغادرة صفحة الصنف؟
              </p>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingNavConfirm(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-extrabold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  البقاء في الصفحة
                </button>
                <button
                  type="button"
                  onClick={pendingNavConfirm.onConfirm}
                  className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
                >
                  تجاهل التعديلات والخروج
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {invoiceToPrint && (
        <PrintReceiptModal
          invoice={invoiceToPrint}
          companySettings={config.companySettings}
          invoicePrintSettings={config.invoicePrintSettings}
          storeName={config.companySettings?.storeName || config.storeName}
          isReprint={isReprint}
          customers={customers}
          items={items}
          changeGiven={invoicePrintExtra.changeGiven}
          customerBalanceAfter={invoicePrintExtra.customerBalanceAfter}
          onClose={() => {
            setInvoiceToPrint(null);
            setInvoicePrintExtra({});
          }}
        />
      )}


      {showDeviceNamePrompt && !deviceNameConfigured && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          dir="rtl"
        >
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-700 shrink-0">
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">تسمية هذا الجهاز للتخزين المحلي</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  اختر اسمًا مميزًا لهذا الجهاز ليُربط بمعرفه الثابت في سجلات النظام والعمل أوفلاين
                </p>
              </div>
            </div>

            <form
              onSubmit={async e => {
                e.preventDefault();
                await setDeviceName(devicePromptDraft.trim() || deviceName || 'نقطة بيع 1');
                setShowDeviceNamePrompt(false);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  اسم الجهاز
                </label>
                <input
                  type="text"
                  value={devicePromptDraft}
                  onChange={e => setDevicePromptDraft(e.target.value)}
                  placeholder="مثال: كاشير الفرع الرئيسي"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  autoFocus
                />
                {deviceId && (
                  <p className="text-[11px] text-slate-400 mt-1.5 font-mono">
                    معرف الجهاز الثابت (UUID): {deviceId}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    await setDeviceName(deviceName || 'نقطة بيع 1');
                    setShowDeviceNamePrompt(false);
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold transition cursor-pointer"
                >
                  اعتماد الاسم الافتراضي
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
                >
                  حفظ اسم الجهاز
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* نافذة حماية تسجيل الخروج النهائي عند وجود عمليات معلّقة */}
      {logoutGuardModal?.open && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          dir="rtl"
        >
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    تنبيه حماية العمليات المعلّقة ({logoutGuardModal.pendingCount})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    حماية البيانات المحلية قبل الرفع إلى السحابة
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLogoutGuardModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-950 leading-relaxed">
              {logoutGuardModal.reason}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setLogoutGuardModal(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold transition cursor-pointer"
              >
                البقاء في الحساب
              </button>

              {(user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'offline.manage')) && (
                <a
                  href={getHrefForTarget('sync', 'pending', { user, flags: featureFlags })}
                  onClick={(e) => {
                    if (!isPlainLeftClick(e)) {
                      setLogoutGuardModal(null);
                      return;
                    }
                    e.preventDefault();
                    setLogoutGuardModal(null);
                    handleNavigate('sync', 'pending');
                  }}
                  className="px-4 py-2.5 rounded-xl bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-200 text-xs font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>شاشة المزامنة</span>
                </a>
              )}

              <button
                type="button"
                onClick={handleSwitchOfflineUser}
                className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Users className="w-3.5 h-3.5" />
                <span>تبديل المستخدم أوفلاين</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3-second floating toast on invoice creation */}
      {toastInvoiceMessage && (
        <div
          role="status"
          aria-live="polite"
          className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-slate-900/95 text-white shadow-2xl border border-slate-700 text-sm font-bold backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200 pointer-events-none"
        >
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{toastInvoiceMessage}</span>
        </div>
      )}

      {/* نافذة طلب الرصيد اليدوي العامة (تعمل فوق كل الصفحات بما فيها شاشة البيع) */}
      {(() => {
        if (!user || user.mustChangePassword) return null;
        const forcedReq = forcedManualRequestId
          ? manualBalanceRequests.find((r) => r.accountId === forcedManualRequestId) || null
          : null;
        const mandatoryDue = manualBalanceRequests.find(
          (r) => r.state === 'due' && r.mandatory
        ) || null;
        const nonMandatoryDue = manualBalanceRequests.find(
          (r) =>
            r.state === 'due' &&
            !r.mandatory &&
            dismissedManualDueKeys[r.accountId] !== r.dueAt
        ) || null;
        const activeManualRequest = manualBalanceResultHold?.request || forcedReq || mandatoryDue || nonMandatoryDue;
        if (!activeManualRequest) return null;
        return (
          <ManualBalanceModal
            request={activeManualRequest}
            initialResult={manualBalanceResultHold?.entry || null}
            allowPostpone={activeManualRequest.state === 'due'}
            onSubmitted={(entry, nextRequests) => {
              setManualBalanceResultHold({ request: activeManualRequest, entry });
              setBalanceRequiredBanner(null);
              if (Array.isArray(nextRequests)) {
                setManualBalanceRequests(nextRequests);
              }
              loadData().catch(() => {});
            }}
            onPostponed={(_req, nextRequests) => {
              setBalanceRequiredBanner(null);
              setForcedManualRequestId(null);
              if (Array.isArray(nextRequests)) {
                setManualBalanceRequests(nextRequests);
              } else {
                fetchManualBalanceRequests();
              }
            }}
            onLater={() => {
              setDismissedManualDueKeys((prev) => ({
                ...prev,
                [activeManualRequest.accountId]: activeManualRequest.dueAt
              }));
              setForcedManualRequestId(null);
            }}
            onCloseDone={() => {
              setManualBalanceResultHold(null);
              setForcedManualRequestId(null);
              fetchManualBalanceRequests();
            }}
          />
        );
      })()}

        </div>
      </PrintCompanyProvider>
    </KeyboardShortcutsProvider>
  );
}


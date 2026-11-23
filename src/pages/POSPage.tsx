import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Item, Platform, ItemPlatformCost, Invoice, UserRole, TaxSettings, Customer, Cashbox, ProductCategory, InvoicePrintSettings, CompanySettings, DisplaySettings, SalesRules, DefaultSelectionMode, DefaultCustomerSelectionMode, DeliveryConfigResponse, DeliveryPaymentMode, DeliveryAssigneeType, CreateInvoiceDeliveryPayload } from '../types';
import { api } from '../api/client';
import { FormulaVerifierModal } from '../components/FormulaVerifierModal';
import { CameraBarcodeScannerModal } from '../components/CameraBarcodeScannerModal';
import { PosInvoicePanel, PosSaleMode } from '../components/pos/PosInvoicePanel';
import { PosProductGrid } from '../components/pos/PosProductGrid';
import { PosVisibleCategoriesPicker } from '../components/pos/PosVisibleCategoriesPicker';
import { printReceipt } from '../utils/printReceipt';
import { generateIdempotencyKey } from '../utils/idempotency';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { DateRange, getDateRangeForPreset, isDateInRange, normalizeArabicText } from '../utils/dateUtils';
import { calculateInvoiceLine, calculateInvoice } from '../shared/invoiceCalc';
import { normalizeLatestItemFirst } from '../shared/latestItemFirst';
import { useOfflineMode } from '../hooks/useOfflineMode';
import { useUserWarehouses, fetchAllWarehouseStockMap } from '../hooks/useUserWarehouses';
import { loadOfflineSnapshot } from '../offline/db';
import { getCartJournal } from '../offline/cartJournalInstance';
import type { CartJournalStorageStatus } from '../offline/cartJournal';
import { useOfflineLock, hasOfflineLockOwnership } from '../offline/offlineLock';
import {
  getOrInitTabId,
  waitForTabIdentitySettled,
  getTabIdentitySettlement,
  forceFreshTabIdentity,
  subscribeTabIdChange,
  subscribeTabSyncMessages,
  tryClaimLegacyPosDraftPrompt,
  clearLegacyDraftClaim
} from '../utils/tabSession';
import { getHrefForTarget, isPlainLeftClick } from '../config/navigation';
import {
  ShoppingCart,
  Search,
  Plus,
  Minus,
  Trash2,
  Receipt,
  CheckCircle,
  AlertCircle,
  Image as ImageIcon,
  Truck,
  Calculator,
  Percent,
  TrendingUp,
  Tag,
  ShieldAlert,
  Camera,
  Barcode,
  ScanLine,
  Check,
  Edit3,
  Package,
  PackageCheck,
  FolderTree,
  Folder,
  ArrowRight,
  CornerDownLeft,
  X,
  Layers,
  Eye,
  Printer,
  History,
  Maximize2,
  Minimize2,
  Menu,
  Sliders,
  RotateCcw
} from 'lucide-react';
import { UserAccount, PageType } from '../types';
import { hasPermission } from '../utils/permissions';
import { printDeliveryPrepSlip } from '../utils/printDeliveryPrepSlip';
import { buildPrepSlipData, prepErrorText } from '../utils/deliveryPrep';
import {
  readUiPrefs,
  writeUiPrefs,
  resetUiPrefs,
  applyUiPrefs,
  DEFAULT_UI_PREFS,
  UI_SCALE_OPTIONS,
  formatScale,
  POS_PANEL_WIDTH_LABELS,
  POS_SIZE_LABELS,
  UI_PREFS_EVENT,
  UI_PREFS_STORAGE_KEY,
  UiPrefs,
  PosPanelWidth,
  PosSize
} from '../utils/uiScale';

export const POS_SALES_RULES_CACHE_KEY = 'mudaqqeq_sales_rules_cache_v1';

export const DEFAULT_POS_SALES_RULES: SalesRules = {
  defaultSaleMode: 'last',
  platformSelection: 'first',
  defaultPlatformId: '',
  customerSelection: 'none',
  defaultCustomerId: '',
  // نفس افتراضي السيرفر: لا يتغير شيء حتى يغيّر المالك الإعدادات
  allowZeroPriceSale: true,
  allowBelowCostSale: true,
  platformAlwaysCredit: false,
  allowPlatformSale: true,
  allowDirectSale: true,
  updatedAt: '',
  updatedBy: '',
  effectivePlatformSelection: 'first',
  effectiveCustomerSelection: 'none',
  defaultPlatformMissing: false,
  defaultCustomerMissing: false,
};

function readCachedSalesRules(): SalesRules {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { ...DEFAULT_POS_SALES_RULES };
    const raw = window.localStorage.getItem(POS_SALES_RULES_CACHE_KEY);
    if (!raw) return { ...DEFAULT_POS_SALES_RULES };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_POS_SALES_RULES };
    return {
      ...DEFAULT_POS_SALES_RULES,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_POS_SALES_RULES };
  }
}

function writeCachedSalesRules(rules: SalesRules): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(POS_SALES_RULES_CACHE_KEY, JSON.stringify(rules));
  } catch {
    // ignore storage errors
  }
}

interface CartItem {
  item: Item;
  quantity: number;
  salePriceAtSale: number;
  baseUnitPrice: number;
  customerUnitPrice: number;
  bnplPercent: number;
  bnplUnitAmount: number;
  bnplDeductionUnit: number;
  barcodeAtSale?: string;
  taxRateAtSale: number;
  unitTaxAmount: number;
  unitBasePrice: number;
  unitPickupFee: number;
  platformDiscountPercent: number;
  unitDiscountValue: number;
  unitNetAfterDiscount: number;
  unitNet: number;
  unitProfit?: number;
  customPriceEdited?: boolean;
  customTaxEdited?: boolean;
}

interface PosInvoiceDraft {
  version: 1;
  savedAt: string;
  saleMode?: PosSaleMode;
  selectedWarehouseId?: string;
  selectedPlatformId: string;
  selectedCustomerId: string;
  selectedCashboxId: string;
  paymentType: 'نقدي' | 'آجل' | 'جزئي';
  creditPartyType: 'customer' | 'platform';
  deliveryFee: number | '';
  notes: string;
  platformOrderId?: string;
  paidAmountInput: string;
  isManualCashOverride: boolean;
  posBnplEnabled: boolean;
  posBnplPercentInput: number | '';
  isBnplPercentOverridden: boolean;
  posCommissionPercentInput: number | '';
  isCommissionPercentOverridden: boolean;
  idempotencyKey: string;
  cart: CartItem[];
  isDeliveryEnabled?: boolean;
  deliveryPaymentMode?: DeliveryPaymentMode;
  deliveryZoneId?: string;
  deliveryAddress?: string;
  deliveryPhone?: string;
  deliveryOrderFeeInput?: number | '';
  deliveryFeeManual?: boolean;
  deliveryAssigneeType?: '' | DeliveryAssigneeType;
  deliveryAssigneeId?: string;
  deliveryTrackingNumber?: string;
}

function getPosUserKey(user?: UserAccount | null): string {
  return String(user?.id || user?.username || user?.phone || 'anonymous').trim() || 'anonymous';
}

function getPosDraftStorageKey(user?: UserAccount | null, tabId?: string): string {
  const userKey = getPosUserKey(user);
  return tabId ? `pos_open_invoice_draft_${userKey}__tab_${tabId}` : `pos_open_invoice_draft_${userKey}`;
}

function getLegacyPosDraftStorageKey(user?: UserAccount | null): string {
  return `pos_open_invoice_draft_${getPosUserKey(user)}`;
}

function getPosSaleModeStorageKey(user?: UserAccount | null): string {
  return `pos_last_sale_mode_${getPosUserKey(user)}`;
}

function getPosDenomStorageKey(user?: UserAccount | null): string {
  return `pos_denominations_expanded_${getPosUserKey(user)}`;
}

function readLastPosSaleMode(storageKey: string): PosSaleMode {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'platform';
    const raw = window.localStorage.getItem(storageKey);
    return raw === 'customer' ? 'customer' : 'platform';
  } catch {
    return 'platform';
  }
}

function writeLastPosSaleMode(storageKey: string, mode: PosSaleMode): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(storageKey, mode);
  } catch {
    // ignore storage errors
  }
}

function readPosDraft(storageKey: string): PosInvoiceDraft | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cart)) {
      return null;
    }
    return parsed as PosInvoiceDraft;
  } catch {
    return null;
  }
}

function writePosDraft(storageKey: string, draft: PosInvoiceDraft): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {
    // ignore storage quota / privacy mode errors
  }
}

function clearPosDraft(storageKey: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(storageKey);
  } catch {
    // ignore storage access errors
  }
}

function formatDraftSavedTime(isoString?: string): string {
  try {
    if (!isoString) return 'وقت غير محدد';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'وقت غير محدد';
    const now = new Date();
    const isSameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (isSameDay) {
      return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleString('ar-EG', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'وقت غير محدد';
  }
}

interface POSPageProps {
  items: Item[];
  categories?: ProductCategory[];
  platforms: Platform[];
  costs: ItemPlatformCost[];
  user?: UserAccount | null;
  userRole: UserRole;
  taxSettings?: TaxSettings;
  companySettings?: CompanySettings;
  enableDeliveryFee?: boolean;
  storeName?: string;
  customers?: Customer[];
  invoicePrintSettings?: InvoicePrintSettings;
  displaySettings?: DisplaySettings;
  onUpdateDisplaySettings?: (patch: Partial<DisplaySettings>) => Promise<void> | void;
  allowNegativeStockSale?: boolean;
  initialItemToAdd?: Item | null;
  onClearInitialItem?: () => void;
  onCreateInvoice: (invoicePayload: any) => Promise<Invoice>;
  onInvoiceCreated: (
    invoice: Invoice,
    extra?: { changeGiven?: number; customerBalanceAfter?: number; shouldPrint?: boolean }
  ) => void;
  invoices?: Invoice[];
  onPrintInvoice?: (invoice: Invoice, isReprint?: boolean, autoPrint?: boolean) => void;
  onOpenMobileMenu?: () => void;
  onNavigateMain?: (page: PageType, tab?: string) => void;
  platformsEnabled?: boolean;
  salesRulesFromConfig?: SalesRules;
}

export const POSPage: React.FC<POSPageProps> = ({
  items,
  categories = [],
  platforms,
  costs,
  user = null,
  userRole,
  taxSettings = { taxInclusive: true, platformCommissionOn: 'before_tax' },
  companySettings,
  enableDeliveryFee = false,
  storeName = 'مدقق للنظم',
  customers: propCustomers = [],
  invoicePrintSettings,
  displaySettings,
  onUpdateDisplaySettings,
  allowNegativeStockSale = false,
  initialItemToAdd,
  onClearInitialItem,
  onCreateInvoice,
  onInvoiceCreated,
  invoices = [],
  onPrintInvoice,
  onOpenMobileMenu,
  onNavigateMain,
  platformsEnabled = true,
  salesRulesFromConfig
}) => {
  const { isOffline, lastSyncAt: offlineLastSyncAt } = useOfflineMode();
  const [localItemsFallback, setLocalItemsFallback] = useState<Item[]>([]);
  const [localPlatformsFallback, setLocalPlatformsFallback] = useState<Platform[]>([]);
  const [localCategoriesFallback, setLocalCategoriesFallback] = useState<ProductCategory[]>([]);
  const [localLastSyncAt, setLocalLastSyncAt] = useState<string | null>(null);

  const effectiveItems = items.length > 0 ? items : localItemsFallback;
  const effectivePlatforms = platforms.length > 0 ? platforms : localPlatformsFallback;
  const effectiveCategories = categories.length > 0 ? categories : localCategoriesFallback;
  const effectiveAllowNegativeStock = isOffline || allowNegativeStockSale;

  const canManageUiScale = userRole === 'designer' || Boolean(user?.isOwner) || hasPermission(user, 'settings.ui_scale');
  const canCustomizeDisplay = userRole === 'designer' || Boolean(user?.isOwner) || hasPermission(user, 'settings.display_customization');
  const [posUiPrefs, setPosUiPrefs] = useState<UiPrefs>(() => readUiPrefs());
  const [draftSharedDisplay, setDraftSharedDisplay] = useState<{
    showItemImages: boolean;
    posLayout: 'grid' | 'compact' | 'list';
    posVisibleCategoryIds: string[];
  }>(() => ({
    showItemImages: displaySettings?.showItemImages !== false,
    posLayout: displaySettings?.posLayout === 'list' ? 'list' : 'grid',
    posVisibleCategoryIds: Array.isArray(displaySettings?.posVisibleCategoryIds)
      ? displaySettings.posVisibleCategoryIds
      : []
  }));
  const [isUiAppearanceOpen, setIsUiAppearanceOpen] = useState<boolean>(false);
  const uiAppearanceMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isUiAppearanceOpen) {
      setDraftSharedDisplay({
        showItemImages: displaySettings?.showItemImages !== false,
        posLayout: displaySettings?.posLayout === 'list' ? 'list' : 'grid',
        posVisibleCategoryIds: Array.isArray(displaySettings?.posVisibleCategoryIds)
          ? displaySettings.posVisibleCategoryIds
          : []
      });
    }
  }, [displaySettings?.showItemImages, displaySettings?.posLayout, displaySettings?.posVisibleCategoryIds, isUiAppearanceOpen]);

  useEffect(() => {
    const handlePrefsUpdate = (e: Event) => {
      const custom = e as CustomEvent<UiPrefs>;
      setPosUiPrefs(custom.detail ? custom.detail : readUiPrefs());
    };
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key === UI_PREFS_STORAGE_KEY) {
        setPosUiPrefs(readUiPrefs());
      }
    };
    window.addEventListener(UI_PREFS_EVENT, handlePrefsUpdate);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(UI_PREFS_EVENT, handlePrefsUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const handleCancelPosUiPrefs = () => {
    const saved = readUiPrefs();
    const savedShared = {
      showItemImages: displaySettings?.showItemImages !== false,
      posLayout: (displaySettings?.posLayout === 'list' ? 'list' : 'grid') as 'grid' | 'list',
      posVisibleCategoryIds: Array.isArray(displaySettings?.posVisibleCategoryIds)
        ? displaySettings.posVisibleCategoryIds
        : []
    };
    setPosUiPrefs(saved);
    setDraftSharedDisplay(savedShared);
    applyUiPrefs(saved, true, document.documentElement, savedShared);
    setIsUiAppearanceOpen(false);
  };

  useEffect(() => {
    if (!isUiAppearanceOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (uiAppearanceMenuRef.current && target && !uiAppearanceMenuRef.current.contains(target)) {
        const saved = readUiPrefs();
        const savedShared = {
          showItemImages: displaySettings?.showItemImages !== false,
          posLayout: (displaySettings?.posLayout === 'list' ? 'list' : 'grid') as 'grid' | 'list',
          posVisibleCategoryIds: Array.isArray(displaySettings?.posVisibleCategoryIds)
            ? displaySettings.posVisibleCategoryIds
            : []
        };
        setPosUiPrefs(saved);
        setDraftSharedDisplay(savedShared);
        applyUiPrefs(saved, true, document.documentElement, savedShared);
        setIsUiAppearanceOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isUiAppearanceOpen, displaySettings?.showItemImages, displaySettings?.posLayout, displaySettings?.posVisibleCategoryIds]);

  const updatePosUiPref = (patch: Partial<UiPrefs>) => {
    const next = { ...posUiPrefs, ...patch };
    setPosUiPrefs(next);
    applyUiPrefs(next, true, document.documentElement, draftSharedDisplay);
  };

  const updateDraftSharedDisplay = (
    patch: Partial<{ showItemImages: boolean; posLayout: 'grid' | 'compact' | 'list'; posVisibleCategoryIds: string[] }>
  ) => {
    const next = { ...draftSharedDisplay, ...patch };
    setDraftSharedDisplay(next);
    applyUiPrefs(posUiPrefs, true, document.documentElement, next);
  };

  const handleResetPosUiPrefs = () => {
    const current = readUiPrefs();
    const next: UiPrefs = {
      ...DEFAULT_UI_PREFS,
      appScale: current.appScale
    };
    setPosUiPrefs(next);
    applyUiPrefs(next, true, document.documentElement, draftSharedDisplay);
  };

  const handleSavePosUiPrefs = async () => {
    const saved = writeUiPrefs({
      ...posUiPrefs
    });
    setPosUiPrefs(saved);
    applyUiPrefs(saved, true, document.documentElement, draftSharedDisplay);
    if (canCustomizeDisplay && onUpdateDisplaySettings) {
      const origShowImages = displaySettings?.showItemImages !== false;
      const origLayout = displaySettings?.posLayout === 'list' ? 'list' : 'grid';
      const origCatIds = Array.isArray(displaySettings?.posVisibleCategoryIds)
        ? displaySettings.posVisibleCategoryIds
        : [];
      const nextCatIds = Array.isArray(draftSharedDisplay.posVisibleCategoryIds)
        ? draftSharedDisplay.posVisibleCategoryIds
        : [];
      const catsChanged =
        origCatIds.length !== nextCatIds.length ||
        origCatIds.some((id) => !nextCatIds.includes(id));
      if (
        draftSharedDisplay.showItemImages !== origShowImages ||
        draftSharedDisplay.posLayout !== origLayout ||
        catsChanged
      ) {
        await onUpdateDisplaySettings({
          showItemImages: draftSharedDisplay.showItemImages,
          posLayout: draftSharedDisplay.posLayout === 'list' ? 'list' : 'grid',
          posVisibleCategoryIds: nextCatIds
        });
      }
    }
    setIsUiAppearanceOpen(false);
  };

  // المخازن المسموحة والمخزن المختار في نقطة البيع
  const {
    activeAllowedWarehouses,
    defaultWarehouseId
  } = useUserWarehouses(user);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [warehouseStockMap, setWarehouseStockMap] = useState<Record<string, number> | null>(null);
  const [isLoadingWarehouseStock, setIsLoadingWarehouseStock] = useState<boolean>(false);
  const [pendingWarehouseSwitch, setPendingWarehouseSwitch] = useState<{
    targetWarehouseId: string;
    targetWarehouseName: string;
  } | null>(null);
  const validateStockAfterSwitchRef = useRef<boolean>(false);

  useEffect(() => {
    if (activeAllowedWarehouses.length === 0) return;
    if (!selectedWarehouseId || !activeAllowedWarehouses.some(w => w.id === selectedWarehouseId)) {
      setSelectedWarehouseId(defaultWarehouseId || activeAllowedWarehouses[0].id);
    }
  }, [activeAllowedWarehouses, defaultWarehouseId, selectedWarehouseId]);

  const selectedWarehouse = useMemo(() => {
    return (
      activeAllowedWarehouses.find(w => w.id === selectedWarehouseId) ||
      activeAllowedWarehouses[0] ||
      null
    );
  }, [activeAllowedWarehouses, selectedWarehouseId]);

  const loadWarehouseStock = React.useCallback(async (whId: string) => {
    if (!whId || isOffline) {
      setWarehouseStockMap(null);
      return;
    }
    setIsLoadingWarehouseStock(true);
    try {
      const map = await fetchAllWarehouseStockMap(whId);
      setWarehouseStockMap(map);
    } catch {
      // في حال تعذر الجلب نحتفظ بالبيانات المتاحة دون تعطيل الشاشة
    } finally {
      setIsLoadingWarehouseStock(false);
    }
  }, [isOffline]);

  useEffect(() => {
    if (!selectedWarehouseId || isOffline) {
      if (isOffline) setWarehouseStockMap(null);
      return;
    }
    void loadWarehouseStock(selectedWarehouseId);
  }, [selectedWarehouseId, isOffline, loadWarehouseStock]);

  const warehouseAwareItems = useMemo(() => {
    if (!warehouseStockMap) return effectiveItems;
    return effectiveItems.map(it =>
      warehouseStockMap[it.id] !== undefined
        ? { ...it, stockQuantity: warehouseStockMap[it.id] }
        : it
    );
  }, [effectiveItems, warehouseStockMap]);

  // مزامنة الكميات المتاحة لأسطر السلة عند تغيير المخزن أو تحديث الأرصدة
  useEffect(() => {
    if (!warehouseStockMap) return;
    setCart(prev => {
      let changed = false;
      const next = prev.map(line => {
        const latestQty = warehouseStockMap[line.item.id];
        if (latestQty !== undefined && line.item.stockQuantity !== latestQty) {
          changed = true;
          return { ...line, item: { ...line.item, stockQuantity: latestQty } };
        }
        return line;
      });
      if (validateStockAfterSwitchRef.current) {
        validateStockAfterSwitchRef.current = false;
        if (!effectiveAllowNegativeStock) {
          const insufficient = next.filter(c => c.quantity > c.item.stockQuantity);
          if (insufficient.length > 0) {
            const first = insufficient[0];
            setErrorMsg(
              insufficient.length === 1
                ? `الكمية المطلوبة من "${first.item.name}" (${first.quantity}) تتجاوز المتاح في المخزن المختار (${first.item.stockQuantity})`
                : `توجد ${insufficient.length} أصناف في الفاتورة تتجاوز الكمية المتاحة في المخزن المختار (منها: "${first.item.name}" المتاح: ${first.item.stockQuantity})`
            );
          } else {
            setErrorMsg(null);
          }
        }
      }
      return changed ? next : prev;
    });
  }, [warehouseStockMap, effectiveAllowNegativeStock]);

  const isDesigner = user?.role === 'designer' || Boolean(user?.isOwner);
  const isManager = isDesigner || userRole === 'manager' || userRole === 'designer';
  const canEditPriceBeforeSave = !isOffline && (isDesigner || hasPermission(user, 'invoices.edit_price_before_save'));
  const canEditTaxBeforeSave = !isOffline && (isDesigner || hasPermission(user, 'invoices.edit_tax_before_save'));
  const canEditPosRates = !isOffline && (isDesigner || hasPermission(user, 'pos.edit_rates'));
  const canEditCashPaid = isDesigner || hasPermission(user, 'invoices.edit_cash_paid');
  const canOverrideMinPrice = isDesigner || hasPermission(user, 'prices.override_min_price');
  const canViewProfit = isDesigner || hasPermission(user, 'reports.view_profit');
  const canViewCosts = isDesigner || hasPermission(user, 'reports.view_costs');
  const canViewInvoices = isDesigner || hasPermission(user, 'invoices.view');
  const canPrintInvoices = isDesigner || hasPermission(user, 'invoices.print');
  const canCreateCustomer = !isOffline && (isDesigner || hasPermission(user, 'customers.create'));
  const canViewCustomerBalance = isDesigner || hasPermission(user, 'customers.view');
  const showCustomerAddress = displaySettings?.posShowCustomerAddress ?? true;
  const showCustomerPhone = displaySettings?.posShowCustomerPhone ?? true;
  const showCustomerBalance = displaySettings?.posShowCustomerBalance ?? true;
  const autoFillCashPaid = displaySettings?.autoFillCashPaid ?? invoicePrintSettings?.autoFillCashPaid ?? true;

  const isDeliveryFeeEnabled = Boolean(enableDeliveryFee || companySettings?.enableDeliveryFee);
  const [deliveryFee, setDeliveryFee] = useState<number | ''>(0);
  const [isManualCashOverride, setIsManualCashOverride] = useState<boolean>(false);

  // تبويبات الموبايل (< 768px): الأصناف | الفاتورة | السجل، مع حفظ موضع التمرير لكل تبويب دون unmount
  const [activeMobileTab, setActiveMobileTab] = useState<'products' | 'invoice' | 'history'>('products');
  const mobileTabScrollRef = useRef<Record<'products' | 'invoice' | 'history', number>>({
    products: 0,
    invoice: 0,
    history: 0
  });
  const [addedItemToast, setAddedItemToast] = useState<string | null>(null);
  const addedItemToastTimerRef = useRef<any>(null);

  const showAddedItemToast = (itemName: string) => {
    if (addedItemToastTimerRef.current) {
      clearTimeout(addedItemToastTimerRef.current);
    }
    setAddedItemToast(`تمت إضافة ${itemName}`);
    addedItemToastTimerRef.current = setTimeout(() => {
      setAddedItemToast(null);
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (addedItemToastTimerRef.current) {
        clearTimeout(addedItemToastTimerRef.current);
      }
    };
  }, []);

  const handleMobileTabSwitch = (nextTab: 'products' | 'invoice' | 'history') => {
    if (nextTab === activeMobileTab) return;
    if (typeof window !== 'undefined') {
      mobileTabScrollRef.current[activeMobileTab] = window.scrollY;
    }
    setActiveMobileTab(nextTab);
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        window.scrollTo({
          top: mobileTabScrollRef.current[nextTab] || 0,
          behavior: 'auto'
        });
      });
    }
  };

  // إعدادات البيع وقواعد السعر (تُقرأ من الكاش المحلي فورًا وتُحدّث من السيرفر عند الاتصال)
  const [salesRules, setSalesRules] = useState<SalesRules>(() => ({
    ...readCachedSalesRules(),
    ...(salesRulesFromConfig || {})
  }));
  const [platformFieldError, setPlatformFieldError] = useState<boolean>(false);
  const [customerFieldError, setCustomerFieldError] = useState<boolean>(false);
  const [priceViolatingItemIds, setPriceViolatingItemIds] = useState<Set<string>>(() => new Set());
  const initialDefaultsAppliedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!salesRulesFromConfig) return;
    setSalesRules(prev => ({ ...prev, ...salesRulesFromConfig }));
  }, [salesRulesFromConfig]);

  const effectivePlatformsEnabled =
    platformsEnabled !== false &&
    !salesRules.salesOnlyMode &&
    salesRules.platformsEnabled !== false;
  const effectiveAllowPlatformSale =
    effectivePlatformsEnabled && salesRules.allowPlatformSale !== false;
  const effectiveAllowDirectSale = salesRules.allowDirectSale !== false;

  // 1. اختيار منصة نشطة (المنصات الموقوفة محجوبة عن شاشة البيع)
  const activePlatforms = useMemo(() => {
    return effectivePlatforms.filter(p => p.status !== 'inactive' && p.status !== 'موقوفة');
  }, [effectivePlatforms]);

  const effectivePlatformSelection: DefaultSelectionMode = useMemo(() => {
    if (salesRules.effectivePlatformSelection === 'manual' || salesRules.platformSelection === 'manual') {
      return 'manual';
    }
    if (salesRules.platformSelection === 'fixed') {
      const exists = Boolean(
        salesRules.defaultPlatformId && activePlatforms.some(p => p.id === salesRules.defaultPlatformId)
      );
      return exists ? 'fixed' : 'manual';
    }
    return 'first';
  }, [salesRules, activePlatforms]);

  const resolveDefaultPlatformId = React.useCallback(
    (rules: SalesRules, plats: Platform[]): string => {
      if (rules.effectivePlatformSelection === 'manual' || rules.platformSelection === 'manual') {
        return '';
      }
      if (rules.platformSelection === 'fixed') {
        return rules.defaultPlatformId && plats.some(p => p.id === rules.defaultPlatformId)
          ? rules.defaultPlatformId
          : '';
      }
      return plats[0]?.id || '';
    },
    []
  );

  const [selectedPlatformId, setSelectedPlatformId] = useState<string>(() =>
    resolveDefaultPlatformId(readCachedSalesRules(), activePlatforms)
  );

  useEffect(() => {
    if (effectivePlatformSelection === 'manual') return;
    if (!selectedPlatformId && activePlatforms.length > 0) {
      const defId = resolveDefaultPlatformId(salesRules, activePlatforms);
      if (defId) setSelectedPlatformId(defId);
    }
  }, [activePlatforms, selectedPlatformId, effectivePlatformSelection, salesRules, resolveDefaultPlatformId]);

  const selectedPlatform = useMemo(() => {
    if (!selectedPlatformId) {
      return effectivePlatformSelection === 'first' ? activePlatforms[0] : undefined;
    }
    return activePlatforms.find(p => p.id === selectedPlatformId);
  }, [activePlatforms, selectedPlatformId, effectivePlatformSelection]);

  const saleModeStorageKey = useMemo(() => getPosSaleModeStorageKey(user), [user?.id, user?.username, user?.phone]);
  const denominationsStorageKey = useMemo(() => getPosDenomStorageKey(user), [user?.id, user?.username, user?.phone]);

  const resolveDefaultSaleMode = React.useCallback(
    (
      rules: SalesRules,
      storageKey: string,
      allowPlatform = effectiveAllowPlatformSale,
      allowDirect = effectiveAllowDirectSale
    ): PosSaleMode => {
      const ruleAllowsPlatform =
        allowPlatform &&
        !rules.salesOnlyMode &&
        rules.platformsEnabled !== false &&
        rules.allowPlatformSale !== false;
      const ruleAllowsDirect = allowDirect && rules.allowDirectSale !== false;
      if (!ruleAllowsPlatform && ruleAllowsDirect) return 'customer';
      if (ruleAllowsPlatform && !ruleAllowsDirect) return 'platform';
      if (!ruleAllowsPlatform && !ruleAllowsDirect) {
        return rules.defaultSaleMode === 'direct' ? 'customer' : 'platform';
      }
      if (rules.defaultSaleMode === 'direct') return 'customer';
      if (rules.defaultSaleMode === 'platform') return 'platform';
      return readLastPosSaleMode(storageKey);
    },
    [effectiveAllowPlatformSale, effectiveAllowDirectSale]
  );

  const [saleMode, setSaleMode] = useState<PosSaleMode>(() => {
    const initRules: SalesRules = { ...readCachedSalesRules(), ...(salesRulesFromConfig || {}) };
    const initAllowPlat =
      platformsEnabled !== false &&
      !initRules.salesOnlyMode &&
      initRules.platformsEnabled !== false &&
      initRules.allowPlatformSale !== false;
    const initAllowDirect = initRules.allowDirectSale !== false;
    return resolveDefaultSaleMode(
      initRules,
      getPosSaleModeStorageKey(user),
      initAllowPlat,
      initAllowDirect
    );
  });
  const [pendingModeSwitch, setPendingModeSwitch] = useState<{
    targetMode: PosSaleMode;
    incompatibleItems: Item[];
  } | null>(null);

  const effectivePlatform = useMemo(
    () => (saleMode === 'platform' ? selectedPlatform : undefined),
    [saleMode, selectedPlatform]
  );

  const saleModeBlockedReason = useMemo(() => {
    if (!effectiveAllowPlatformSale && !effectiveAllowDirectSale) {
      return 'البيع على منصة والبيع المباشر للعميل معطلان حاليًا من إعدادات البيع؛ فعّل وضع بيع واحد على الأقل من الإعدادات لإتمام الحفظ.';
    }
    if (saleMode === 'platform' && !effectiveAllowPlatformSale) {
      return !effectivePlatformsEnabled
        ? 'مبيعات ووظائف المنصات معطلة حاليًا من إعدادات النظام؛ لا يمكن حفظ هذه الفاتورة كبيع منصة. يمكنك تحويلها إلى بيع مباشر للعميل أو إلغاؤها.'
        : 'البيع على منصة معطّل حاليًا من إعدادات البيع؛ لا يمكن حفظ هذه الفاتورة كبيع منصة. يمكنك تحويلها إلى بيع مباشر للعميل أو إلغاؤها.';
    }
    if (saleMode === 'customer' && !effectiveAllowDirectSale) {
      return 'البيع المباشر للعميل معطّل حاليًا من إعدادات البيع؛ لا يمكن حفظ هذه الفاتورة كبيع مباشر. يمكنك تحويلها إلى بيع على منصة أو إلغاؤها.';
    }
    if (saleMode === 'platform' && effectiveAllowPlatformSale && activePlatforms.length === 0) {
      return !effectiveAllowDirectSale
        ? 'البيع المباشر معطّل والبيع مقتصر على المنصات حاليًا، ولا توجد أي منصة نشطة متاحة؛ يرجى إضافة أو تفعيل منصة أولًا (لن يتم التحويل تلقائيًا للبيع المباشر).'
        : 'لا توجد أي منصة نشطة متاحة للبيع على منصة حاليًا؛ يرجى تفعيل منصة أو التبديل إلى البيع المباشر للعميل.';
    }
    return null;
  }, [
    effectiveAllowPlatformSale,
    effectiveAllowDirectSale,
    effectivePlatformsEnabled,
    saleMode,
    activePlatforms.length
  ]);

  // مفاتيح تحكم BNPL ونسب الفاتورة المؤقتة (تأخذ القيم الافتراضية من المنصة المختارة)
  const [posBnplEnabled, setPosBnplEnabled] = useState<boolean>(() => Boolean(selectedPlatform?.enableBnpl));
  const [posBnplPercentInput, setPosBnplPercentInput] = useState<number | ''>(() => Number(selectedPlatform?.bnplPercentage || 0));
  const [isBnplPercentOverridden, setIsBnplPercentOverridden] = useState<boolean>(false);
  const [posCommissionPercentInput, setPosCommissionPercentInput] = useState<number | ''>(() => Number(selectedPlatform?.discountPercentage || 0));
  const [isCommissionPercentOverridden, setIsCommissionPercentOverridden] = useState<boolean>(false);

  // مزامنة مفاتيح ونسب الفاتورة مع إعدادات المنصة المختارة عند تبديل المنصة
  useEffect(() => {
    if (!selectedPlatform) return;
    if (skipPlatformSyncForIdRef.current && skipPlatformSyncForIdRef.current === selectedPlatform.id) {
      skipPlatformSyncForIdRef.current = null;
      return;
    }
    setPosBnplEnabled(Boolean(selectedPlatform.enableBnpl));
    setPosBnplPercentInput(Number(selectedPlatform.bnplPercentage || 0));
    setIsBnplPercentOverridden(false);
    setPosCommissionPercentInput(Number(selectedPlatform.discountPercentage || 0));
    setIsCommissionPercentOverridden(false);
  }, [selectedPlatform?.id, selectedPlatform?.enableBnpl, selectedPlatform?.bnplPercentage, selectedPlatform?.discountPercentage]);

  // الخزائن والعملاء
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [customers, setCustomers] = useState<Customer[]>(propCustomers || []);
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>('');

  const effectiveCustomerSelection: DefaultCustomerSelectionMode = useMemo(() => {
    if (salesRules.effectiveCustomerSelection === 'manual' || salesRules.customerSelection === 'manual') {
      return 'manual';
    }
    if (salesRules.customerSelection === 'fixed') {
      const exists = Boolean(
        salesRules.defaultCustomerId &&
          customers.some(
            c =>
              c.id === salesRules.defaultCustomerId &&
              (c as any).status !== 'موقوف' &&
              (c as any).status !== 'inactive'
          )
      );
      return exists ? 'fixed' : 'manual';
    }
    return 'none';
  }, [salesRules, customers]);

  const resolveDefaultCustomerId = React.useCallback(
    (rules: SalesRules, custList: Customer[]): string => {
      if (
        rules.effectiveCustomerSelection === 'manual' ||
        rules.customerSelection === 'manual' ||
        rules.customerSelection === 'none'
      ) {
        return '';
      }
      if (rules.customerSelection === 'fixed') {
        const exists = Boolean(
          rules.defaultCustomerId &&
            custList.some(
              c =>
                c.id === rules.defaultCustomerId &&
                (c as any).status !== 'موقوف' &&
                (c as any).status !== 'inactive'
            )
        );
        return exists ? rules.defaultCustomerId : '';
      }
      return '';
    },
    []
  );

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(() =>
    resolveDefaultCustomerId(readCachedSalesRules(), propCustomers || [])
  );
  const [paymentType, setPaymentType] = useState<'نقدي' | 'آجل' | 'جزئي'>('نقدي');
  const [creditPartyType, setCreditPartyType] = useState<'customer' | 'platform'>('customer');
  const [paidAmountInput, setPaidAmountInput] = useState<string>('0.00');
  const [platformOrderId, setPlatformOrderId] = useState<string>('');
  const [platformOrderError, setPlatformOrderError] = useState<boolean>(false);

  // إعدادات وحالة التوصيل (للبيع المباشر فقط وعند تفعيل التوصيل من إعدادات التوصيل)
  const [deliveryConfig, setDeliveryConfig] = useState<DeliveryConfigResponse | null>(null);
  const [isDeliveryEnabled, setIsDeliveryEnabled] = useState<boolean>(false);
  const [deliveryPaymentMode, setDeliveryPaymentMode] = useState<DeliveryPaymentMode>('prepaid');
  const [deliveryZoneId, setDeliveryZoneId] = useState<string>('');
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [deliveryPhone, setDeliveryPhone] = useState<string>('');
  const [deliveryOrderFeeInput, setDeliveryOrderFeeInput] = useState<number | ''>(0);
  const [deliveryFeeManual, setDeliveryFeeManual] = useState<boolean>(false);
  const [deliveryZoneWarning, setDeliveryZoneWarning] = useState<string | null>(null);
  const [deliveryAssigneeType, setDeliveryAssigneeType] = useState<'' | DeliveryAssigneeType>('');
  const [deliveryAssigneeId, setDeliveryAssigneeId] = useState<string>('');
  const [deliveryTrackingNumber, setDeliveryTrackingNumber] = useState<string>('');
  const [deliveryAddressError, setDeliveryAddressError] = useState<boolean>(false);
  const [deliveryZoneError, setDeliveryZoneError] = useState<boolean>(false);

  const isDeliveryFeatureEnabled = !isOffline && Boolean(deliveryConfig?.settings?.enabled);
  const isDeliveryOrderActive = saleMode === 'customer' && isDeliveryFeatureEnabled && isDeliveryEnabled;
  const isCodDelivery = isDeliveryOrderActive && deliveryPaymentMode === 'cod';
  const canEditDeliveryFee =
    !isOffline &&
    Boolean(deliveryConfig?.canEditFee) &&
    (isDesigner || hasPermission(user, 'delivery.edit_fee'));

  const selectedDeliveryZone = useMemo(() => {
    if (!deliveryConfig?.zones || !deliveryZoneId) return null;
    return deliveryConfig.zones.find(z => z.id === deliveryZoneId) || null;
  }, [deliveryConfig?.zones, deliveryZoneId]);

  const computedDeliveryFee = useMemo(() => {
    if (!deliveryConfig?.settings?.enabled) return 0;
    if (deliveryConfig.settings.zonePricing) {
      return selectedDeliveryZone ? Math.max(0, Number(selectedDeliveryZone.customerFee || 0)) : 0;
    }
    return Math.max(0, Number(deliveryConfig.settings.fixedFee || 0));
  }, [deliveryConfig, selectedDeliveryZone]);

  const effectiveDeliveryOrderFee = useMemo(() => {
    if (!isDeliveryOrderActive) return 0;
    if (canEditDeliveryFee && deliveryFeeManual) {
      if (deliveryOrderFeeInput === '') return 0;
      const n = Number(deliveryOrderFeeInput);
      return isNaN(n) || n < 0 ? 0 : Math.round(n * 100) / 100;
    }
    return Math.round(computedDeliveryFee * 100) / 100;
  }, [isDeliveryOrderActive, canEditDeliveryFee, deliveryFeeManual, deliveryOrderFeeInput, computedDeliveryFee]);

  // مزامنة خانة رسوم التوصيل مع الرسوم المحسوبة من السيرفر ما لم يعدّلها مستخدم يملك الصلاحية
  useEffect(() => {
    if (!canEditDeliveryFee || !deliveryFeeManual) {
      setDeliveryOrderFeeInput(Math.round(computedDeliveryFee * 100) / 100);
    }
  }, [computedDeliveryFee, canEditDeliveryFee, deliveryFeeManual]);

  // عند انقطاع الاتصال أو إيقاف التوصيل من الإعدادات: إغلاق خيار التوصيل للفاتورة المفتوحة
  useEffect(() => {
    if (isOffline && isDeliveryEnabled) {
      setIsDeliveryEnabled(false);
    }
  }, [isOffline, isDeliveryEnabled]);

  const syncDeliveryFromCustomer = React.useCallback(
    (cust: Customer | null, cfg: DeliveryConfigResponse | null) => {
      setDeliveryAddress(cust?.address || '');
      setDeliveryPhone(cust?.phone || '');
      setDeliveryAddressError(false);
      setDeliveryZoneError(false);
      setDeliveryFeeManual(false);

      if (!cfg?.settings?.zonePricing) {
        setDeliveryZoneId('');
        setDeliveryZoneWarning(null);
        return;
      }

      if (cust?.zoneId) {
        const activeZone = (cfg.zones || []).find(z => z.id === cust.zoneId);
        if (activeZone) {
          setDeliveryZoneId(activeZone.id);
          setDeliveryZoneWarning(null);
        } else {
          setDeliveryZoneId('');
          setDeliveryZoneWarning('منطقة التوصيل المسجلة للعميل غير نشطة أو غير متاحة حاليًا — يرجى اختيار منطقة نشطة');
        }
      } else if (cust) {
        setDeliveryZoneId('');
        setDeliveryZoneWarning('لا توجد منطقة توصيل مسجلة لهذا العميل — اختر المنطقة لحساب الرسوم');
      } else {
        setDeliveryZoneId('');
        setDeliveryZoneWarning(null);
      }
    },
    []
  );

  const resetDeliveryOrderState = React.useCallback(() => {
    setIsDeliveryEnabled(false);
    setDeliveryPaymentMode('prepaid');
    setDeliveryZoneId('');
    setDeliveryAddress('');
    setDeliveryPhone('');
    setDeliveryOrderFeeInput(0);
    setDeliveryFeeManual(false);
    setDeliveryZoneWarning(null);
    setDeliveryAssigneeType('');
    setDeliveryAssigneeId('');
    setDeliveryTrackingNumber('');
    setDeliveryAddressError(false);
    setDeliveryZoneError(false);
  }, []);

  const handleToggleDeliveryEnabled = (nextEnabled: boolean) => {
    setErrorMsg(null);
    setDeliveryAddressError(false);
    setDeliveryZoneError(false);
    if (!nextEnabled) {
      resetDeliveryOrderState();
      setDeliveryFee(0);
      return;
    }
    if (saleMode !== 'customer' || !isDeliveryFeatureEnabled) return;
    setIsDeliveryEnabled(true);
    const currentCust = selectedCustomerId ? customers.find(c => c.id === selectedCustomerId) || null : null;
    if (currentCust) {
      syncDeliveryFromCustomer(currentCust, deliveryConfig);
    } else {
      setDeliveryZoneWarning(null);
      setDeliveryFeeManual(false);
    }
  };

  useEffect(() => {
    if (!deliveryConfig) return;
    if (!deliveryConfig.settings?.enabled) {
      if (isDeliveryEnabled) {
        resetDeliveryOrderState();
        setDeliveryFee(0);
      }
      return;
    }
    if (!isDeliveryEnabled) return;

    if (
      deliveryConfig.settings.zonePricing &&
      deliveryZoneId &&
      !(deliveryConfig.zones || []).some(z => z.id === deliveryZoneId)
    ) {
      setDeliveryZoneId('');
      setDeliveryFeeManual(false);
    }
    if (deliveryAssigneeType === 'driver') {
      const driverAllowed = deliveryConfig.settings.mode !== 'couriers';
      const driverExists = (deliveryConfig.drivers || []).some(d => d.id === deliveryAssigneeId);
      if (!driverAllowed || (deliveryAssigneeId && !driverExists)) {
        setDeliveryAssigneeType('');
        setDeliveryAssigneeId('');
      }
    } else if (deliveryAssigneeType === 'courier') {
      const courierAllowed = deliveryConfig.settings.mode !== 'drivers';
      const courierExists = (deliveryConfig.couriers || []).some(c => c.id === deliveryAssigneeId);
      if (!courierAllowed || (deliveryAssigneeId && !courierExists)) {
        setDeliveryAssigneeType('');
        setDeliveryAssigneeId('');
        setDeliveryTrackingNumber('');
      }
    }
  }, [deliveryConfig, isDeliveryEnabled, deliveryZoneId, deliveryAssigneeType, deliveryAssigneeId, resetDeliveryOrderState]);

  useEffect(() => {
    if (saleMode === 'platform' && salesRules.platformAlwaysCredit) {
      setPaymentType('آجل');
      setCreditPartyType('platform');
      setIsManualCashOverride(false);
      setPaidAmountInput('0.00');
    }
  }, [saleMode, salesRules.platformAlwaysCredit]);

  const handleCustomerCreated = (newCust: Customer) => {
    setCustomers(prev => [...prev, newCust]);
    setSelectedCustomerId(newCust.id);
    setCustomerFieldError(false);
    setErrorMsg(null);
    if (isDeliveryEnabled && saleMode === 'customer') {
      syncDeliveryFromCustomer(newCust, deliveryConfig);
    }
  };

  const handleClearCart = () => {
    const nextMode = resolveDefaultSaleMode(
      salesRules,
      saleModeStorageKey,
      effectiveAllowPlatformSale,
      effectiveAllowDirectSale
    );
    setSaleMode(nextMode);
    setCart([]);
    setDeliveryFee(0);
    setNotes('');
    setPlatformOrderId('');
    setPlatformOrderError(false);
    resetDeliveryOrderState();
    setIsManualCashOverride(false);
    setPaidAmountInput('0.00');
    if (nextMode === 'platform' && salesRules.platformAlwaysCredit) {
      setPaymentType('آجل');
      setCreditPartyType('platform');
    } else {
      setPaymentType('نقدي');
      setCreditPartyType(nextMode === 'platform' ? 'platform' : 'customer');
    }
    const nextPlatId = resolveDefaultPlatformId(salesRules, activePlatforms);
    const nextCustId = resolveDefaultCustomerId(salesRules, customers);
    setSelectedPlatformId(nextPlatId);
    setSelectedCustomerId(nextCustId);
    const nextPlat = nextPlatId ? activePlatforms.find(p => p.id === nextPlatId) : undefined;
    setPosBnplEnabled(Boolean(nextPlat?.enableBnpl));
    setPosBnplPercentInput(Number(nextPlat?.bnplPercentage || 0));
    setIsBnplPercentOverridden(false);
    setPosCommissionPercentInput(Number(nextPlat?.discountPercentage || 0));
    setIsCommissionPercentOverridden(false);
    setPlatformFieldError(false);
    setCustomerFieldError(false);
    setPriceViolatingItemIds(new Set());
    setErrorMsg(null);
    setIsUnknownResultError(false);
    idempotencyKeyRef.current = generateIdempotencyKey();
    clearPosDraft(draftStorageKey);
  };

  const [pendingPlatformSwitch, setPendingPlatformSwitch] = useState<{
    targetPlatformId: string;
    targetPlatformName: string;
    incompatibleItems: Item[];
  } | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUnknownResultError, setIsUnknownResultError] = useState(false);
  const [isFormulaModalOpen, setIsFormulaModalOpen] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());
  const skipPlatformSyncForIdRef = useRef<string | null>(null);

  const [tabId, setTabId] = useState<string>(() => getOrInitTabId());
  const [ambiguousTabBlockReason, setAmbiguousTabBlockReason] = useState<string | null>(null);
  const [unmigratedLegacyDraft, setUnmigratedLegacyDraft] = useState<PosInvoiceDraft | null>(null);
  const [cartJournalStatus, setCartJournalStatus] = useState<CartJournalStorageStatus>(() => {
    try {
      return getCartJournal().getStorageStatus();
    } catch {
      return {
        type: 'ok',
        message: null,
        tabPendingCount: 0,
        totalPendingCount: 0,
        legacyPreservedCount: 0,
        maxTabPending: 5000,
        maxTotalPending: 20000
      };
    }
  });

  useEffect(
    () =>
      subscribeTabIdChange((nextTabId) => {
        // عند تدوير معرف التبويب (Duplicate Tab)، نولّد مفتاح idempotencyKey جديدًا فورًا حتى لا يشارك التبويب الأصلي
        idempotencyKeyRef.current = generateIdempotencyKey();
        setTabId(nextTabId);
      }),
    []
  );

  useEffect(() => {
    try {
      const journal = getCartJournal();
      setCartJournalStatus(journal.getStorageStatus());
      return journal.subscribeStorageStatus((status) => {
        setCartJournalStatus(status);
      });
    } catch {
      return undefined;
    }
  }, [tabId]);

  const {
    hasOwnership: hasOfflineLock,
    reason: offlineLockReason,
    retryAcquireLock: recheckOfflineLock
  } = useOfflineLock();

  const userKey = useMemo(() => getPosUserKey(user), [user?.id, user?.username, user?.phone]);
  const draftStorageKey = useMemo(() => getPosDraftStorageKey(user, tabId), [user, tabId]);
  const legacyDraftStorageKey = useMemo(() => getLegacyPosDraftStorageKey(user), [user]);
  const [pendingDraftPrompt, setPendingDraftPrompt] = useState<PosInvoiceDraft | null>(null);
  const [isDraftReady, setIsDraftReady] = useState<boolean>(false);
  const pendingDraftSourceRef = useRef<'tab' | 'legacy' | null>(null);
  const lastDraftUserKeyRef = useRef<string>(userKey);

  // تحديث رصيد المخزن المختار عند إتمام فاتورة من تبويب آخر أونلاين دون المساس ببيانات الفاتورة المفتوحة
  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;
  const isOfflineRef = useRef(isOffline);
  isOfflineRef.current = isOffline;
  const selectedWarehouseIdRef = useRef(selectedWarehouseId);
  selectedWarehouseIdRef.current = selectedWarehouseId;
  const loadWarehouseStockRef = useRef(loadWarehouseStock);
  loadWarehouseStockRef.current = loadWarehouseStock;

  useEffect(() => {
    return subscribeTabSyncMessages((msg) => {
      if (msg.type !== 'POS_STOCK_UPDATED') return;
      if (msg.sourceTabId && msg.sourceTabId === tabIdRef.current) return;
      if (isOfflineRef.current) return;
      const currentWhId = selectedWarehouseIdRef.current;
      if (!currentWhId) return;
      if (msg.warehouseId && msg.warehouseId !== currentWhId) return;
      void loadWarehouseStockRef.current(currentWhId);
    });
  }, []);

  // الأصناف المتاحة للوضع الحالي (في وضع المنصة تُفلتر حسب المنصة المختارة، وفي وضع العميل تظهر كل أصناف المخزن)
  const platformFilteredItems = useMemo(() => {
    if (saleMode !== 'platform' || !selectedPlatform) return warehouseAwareItems;
    return warehouseAwareItems.filter(it => !it.platformIds || it.platformIds.length === 0 || it.platformIds.includes(selectedPlatform.id));
  }, [warehouseAwareItems, saleMode, selectedPlatform]);

  const applySaleModeSwitch = (targetMode: PosSaleMode, incompatibleIds?: Set<string>) => {
    if (incompatibleIds && incompatibleIds.size > 0) {
      setCart(prev => prev.filter(c => !incompatibleIds.has(c.item.id)));
    }
    setSaleMode(targetMode);
    writeLastPosSaleMode(saleModeStorageKey, targetMode);
    setDeliveryFee(0);
    if (targetMode !== 'platform') {
      setPlatformOrderId('');
      setPlatformOrderError(false);
    }
    if (targetMode !== 'customer') {
      resetDeliveryOrderState();
    }
    if (targetMode === 'platform' && salesRules.platformAlwaysCredit) {
      setPaymentType('آجل');
      setCreditPartyType('platform');
    } else {
      setPaymentType('نقدي');
      setCreditPartyType(targetMode === 'platform' ? 'platform' : 'customer');
    }
    setIsManualCashOverride(false);
    setPlatformFieldError(false);
    setCustomerFieldError(false);
    setErrorMsg(null);
  };

  const handleSaleModeChange = (targetMode: PosSaleMode) => {
    if (targetMode === 'platform' && !effectiveAllowPlatformSale) return;
    if (targetMode === 'customer' && !effectiveAllowDirectSale) return;
    if (targetMode === saleMode) return;
    const incompatible =
      targetMode === 'platform' && selectedPlatform
        ? cart.filter(
            c => c.item.platformIds && c.item.platformIds.length > 0 && !c.item.platformIds.includes(selectedPlatform.id)
          )
        : [];
    if (cart.length > 0) {
      setPendingModeSwitch({
        targetMode,
        incompatibleItems: incompatible.map(c => c.item)
      });
      return;
    }
    applySaleModeSwitch(targetMode);
  };

  const handleConfirmModeSwitch = () => {
    if (!pendingModeSwitch) return;
    const incompatibleIds =
      pendingModeSwitch.incompatibleItems.length > 0
        ? new Set(pendingModeSwitch.incompatibleItems.map(i => i.id))
        : undefined;
    applySaleModeSwitch(pendingModeSwitch.targetMode, incompatibleIds);
    setPendingModeSwitch(null);
  };

  const handleWarehouseChange = (newWarehouseId: string) => {
    if (!newWarehouseId || newWarehouseId === selectedWarehouseId) return;
    const targetWh = activeAllowedWarehouses.find(w => w.id === newWarehouseId);
    if (cart.length > 0) {
      setPendingWarehouseSwitch({
        targetWarehouseId: newWarehouseId,
        targetWarehouseName: targetWh?.name || ''
      });
      return;
    }
    setErrorMsg(null);
    setSelectedWarehouseId(newWarehouseId);
  };

  const handleConfirmWarehouseSwitch = () => {
    if (!pendingWarehouseSwitch) return;
    validateStockAfterSwitchRef.current = true;
    setErrorMsg(null);
    setSelectedWarehouseId(pendingWarehouseSwitch.targetWarehouseId);
    setPendingWarehouseSwitch(null);
  };

  // عند تغيير المنصة وفي السلة أصناف غير متاحة للمنصة الجديدة: عرض تنبيه بأسماء الأصناف وطلب تأكيد الحذف
  const handlePlatformChange = (newPlatformId: string) => {
    setPlatformFieldError(false);
    setErrorMsg(null);
    if (newPlatformId === selectedPlatformId) return;
    if (!newPlatformId) {
      setSelectedPlatformId('');
      return;
    }
    const targetPlatform = activePlatforms.find(p => p.id === newPlatformId);
    const incompatible = cart.filter(
      c => c.item.platformIds && c.item.platformIds.length > 0 && !c.item.platformIds.includes(newPlatformId)
    );
    if (incompatible.length > 0) {
      setPendingPlatformSwitch({
        targetPlatformId: newPlatformId,
        targetPlatformName: targetPlatform?.name || '',
        incompatibleItems: incompatible.map(c => c.item)
      });
      return;
    }
    setSelectedPlatformId(newPlatformId);
  };

  const handleConfirmPlatformSwitch = () => {
    if (!pendingPlatformSwitch) return;
    const { targetPlatformId, incompatibleItems } = pendingPlatformSwitch;
    const incompatibleIds = new Set(incompatibleItems.map(i => i.id));
    setCart(prev => prev.filter(c => !incompatibleIds.has(c.item.id)));
    setSelectedPlatformId(targetPlatformId);
    setPlatformFieldError(false);
    setPendingPlatformSwitch(null);
  };

  // فلاتر وبحث سجل المبيعات في أسفل شاشة POS
  const [historyDateRange, setHistoryDateRange] = useState<DateRange>(() =>
    getDateRangeForPreset('TODAY')
  );
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState<number>(20);
  const salesHistoryRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  useEffect(() => {
    setVisibleCount(20);
  }, [historyDateRange.from, historyDateRange.to, historySearchQuery]);

  useEffect(() => {
    if (propCustomers && propCustomers.length > 0) {
      setCustomers(propCustomers);
    }
  }, [propCustomers]);

  const canViewAllInvoices = isDesigner || hasPermission(user, 'invoices.view');
  const canViewPosInvoices = hasPermission(user, 'invoices.view_in_pos');
  const canViewHistorySection = canViewAllInvoices || canViewPosInvoices;
  const canPrintHistoryInvoice = isDesigner || hasPermission(user, 'invoices.print') || canViewPosInvoices;

  const userAccessibleInvoices = useMemo(() => {
    if (!invoices) return [];
    if (canViewAllInvoices) return invoices;
    if (!canViewPosInvoices) return [];

    const myName = (user?.name || '').trim().toLowerCase();
    const myUsername = (user?.username || '').trim().toLowerCase();
    const myPhone = (user?.phone || '').trim();
    const myId = user?.id;

    return invoices.filter(inv => {
      const creator = (inv.createdBy || '').trim().toLowerCase();
      const invUserId = (inv as any).userId;
      return (
        (myName && creator === myName) ||
        (myUsername && creator === myUsername) ||
        (myPhone && creator === myPhone) ||
        (myId && invUserId === myId)
      );
    });
  }, [invoices, canViewAllInvoices, canViewPosInvoices, user]);

  const filteredHistoryInvoices = useMemo(() => {
    if (!canViewHistorySection) return [];
    const normQuery = normalizeArabicText(historySearchQuery);

    return userAccessibleInvoices
      .filter(inv => {
        if (!isDateInRange(inv.date, historyDateRange.from, historyDateRange.to)) return false;
        if (!normQuery) return true;

        const custFromList = customers.find(c => c.id === inv.customerId)?.name || '';
        const haystack = normalizeArabicText(
          `${inv.invoiceNumber || ''} ${inv.platformOrderId || ''} ${inv.offlineProvisionalNo || ''} ${inv.tempInvoiceNumber || ''} ${(inv as any).customerName || ''} ${custFromList} ${inv.notes || ''} ${inv.platform || ''} ${inv.createdBy || ''}`
        );
        return haystack.includes(normQuery);
      })
      .sort((a, b) => {
        const timeA = a.date ? new Date(a.date).getTime() : 0;
        const timeB = b.date ? new Date(b.date).getTime() : 0;
        return timeB - timeA;
      });
  }, [userAccessibleInvoices, canViewHistorySection, historyDateRange.from, historyDateRange.to, historySearchQuery, customers]);

  const displayedHistoryInvoices = useMemo(() => {
    return filteredHistoryInvoices.slice(0, visibleCount);
  }, [filteredHistoryInvoices, visibleCount]);

  const handleReprintHistoryInvoice = async (inv: Invoice) => {
    await printReceipt(inv, {
      companySettings,
      invoicePrintSettings,
      storeName,
      isReprint: true,
      customers,
      items: warehouseAwareItems,
      onAfterPrint: () => {
        setTimeout(() => {
          const barcodeInput = document.getElementById('pos-barcode-input');
          barcodeInput?.focus();
        }, 50);
      }
    });
  };

  // تصفية الخزائن المسموحة للبيع بحسب تعيينات المصمم
  const allowedSaleCashboxes = useMemo(() => {
    const active = cashboxes.filter(c => c.status !== 'inactive' && (c.status as any) !== 'موقوفة');
    if (isDesigner) return active;
    const allowedIds = user?.cashboxConfig?.allowedSaleCashboxIds;
    if (allowedIds && allowedIds.length > 0) {
      return active.filter(c => allowedIds.includes(c.id));
    }
    return active;
  }, [cashboxes, isDesigner, user?.cashboxConfig?.allowedSaleCashboxIds]);

  // اختيار الخزينة الوحيدة تلقائياً عند وجود خزينة واحدة فقط مسموحة
  useEffect(() => {
    if (allowedSaleCashboxes.length === 1) {
      if (selectedCashboxId !== allowedSaleCashboxes[0].id) {
        setSelectedCashboxId(allowedSaleCashboxes[0].id);
      }
    } else if (
      allowedSaleCashboxes.length > 1 &&
      selectedCashboxId &&
      !allowedSaleCashboxes.some(c => c.id === selectedCashboxId)
    ) {
      setSelectedCashboxId('');
    }
  }, [allowedSaleCashboxes, selectedCashboxId]);

  // ===================== تصفح التصنيفات في نقطة البيع ===================== //
  // 1. تحديد التصنيفات الصالحة للظهور في نقطة البيع (نشطة، ومفعل لها showInPOS، وجميع أسلافها نشطة ومفعلة)
  const validPOSCategoryIds = useMemo(() => {
    const validSet = new Set<string>();
    const catMap = new Map<string, ProductCategory>();
    effectiveCategories.forEach(c => catMap.set(c.id, c));

    function isValid(cat: ProductCategory): boolean {
      const isActive = cat.status === 'active' || cat.status === 'نشط';
      const isVisibleInPOS = cat.showInPOS !== false;
      if (!isActive || !isVisibleInPOS) return false;

      if (cat.parentCategoryId) {
        const parent = catMap.get(cat.parentCategoryId);
        if (!parent || !isValid(parent)) return false;
      }
      return true;
    }

    effectiveCategories.forEach(c => {
      if (isValid(c)) {
        validSet.add(c.id);
      }
    });

    return validSet;
  }, [effectiveCategories]);

  // التصنيفات الصالحة لـ POS
  const posCategories = useMemo(() => {
    return effectiveCategories.filter(c => validPOSCategoryIds.has(c.id));
  }, [effectiveCategories, validPOSCategoryIds]);

  // خريطة التصنيفات للوصول السريع
  const categoryMap = useMemo(() => {
    const map = new Map<string, ProductCategory>();
    effectiveCategories.forEach(c => map.set(c.id, c));
    return map;
  }, [effectiveCategories]);

  // التصنيفات الرئيسية الصالحة فقط (مرتبة بحسب displayOrder)
  const rootPOSCategories = useMemo(() => {
    return posCategories
      .filter(c => !c.parentCategoryId)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  }, [posCategories]);

  // دالة استخراج جميع المعرفات التابعة لشجرة تصنيف محدد
  const getCategoryBranchIds = useMemo(() => {
    return (catId: string): Set<string> => {
      const result = new Set<string>();
      const stack = [catId];
      while (stack.length > 0) {
        const current = stack.pop()!;
        result.add(current);
        posCategories.forEach(c => {
          if (c.parentCategoryId === current && !result.has(c.id)) {
            stack.push(c.id);
          }
        });
      }
      return result;
    };
  }, [posCategories]);

  // تصفية الأصناف المسموحة في POS (استبعاد الأصناف التابعة لتصنيف موقوف أو مخفي أو غير المتاحة للمنصة المختارة)
  const posAvailableItems = useMemo(() => {
    return platformFilteredItems.filter(it => {
      if (it.status === 'inactive' || it.status === 'موقوف' || it.status === 'مؤرشف') {
        return false;
      }
      if (it.categoryId) {
        return validPOSCategoryIds.has(it.categoryId);
      }
      return true;
    });
  }, [platformFilteredItems, validPOSCategoryIds]);

  // إحصائيات أعداد الأصناف لكل تصنيف
  const categoryStats = useMemo(() => {
    const directCounts: Record<string, number> = {};
    const branchCounts: Record<string, number> = {};

    posCategories.forEach(c => {
      directCounts[c.id] = 0;
      branchCounts[c.id] = 0;
    });

    posAvailableItems.forEach(it => {
      if (it.categoryId && directCounts[it.categoryId] !== undefined) {
        directCounts[it.categoryId]++;
      }
    });

    posCategories.forEach(c => {
      const branchIds = getCategoryBranchIds(c.id);
      branchCounts[c.id] = posAvailableItems.filter(it => it.categoryId && branchIds.has(it.categoryId)).length;
    });

    const uncategorizedCount = posAvailableItems.filter(it => !it.categoryId).length;

    return { directCounts, branchCounts, uncategorizedCount };
  }, [posCategories, posAvailableItems, getCategoryBranchIds]);

  // حالة التصفح بالتصنيفات
  // 'ALL' = كل الأصناف، 'UNCATEGORIZED' = غير مصنفة، أو معرف تصنيف محدد
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  // هل نعرض الأصناف المباشرة فقط لهذا التصنيف أم كل الشجرة
  const [showDirectOnly, setShowDirectOnly] = useState<boolean>(false);

  // الكائن الحالي للتصنيف المختار
  const currentCategory = useMemo(() => {
    if (selectedCategoryId === 'ALL' || selectedCategoryId === 'UNCATEGORIZED') return null;
    return posCategories.find(c => c.id === selectedCategoryId) || null;
  }, [posCategories, selectedCategoryId]);

  // فروع التصنيف الحالي المباشرة (الصالحة لـ POS، مرتبة)
  const currentSubCategories = useMemo(() => {
    if (!currentCategory) return [];
    return posCategories
      .filter(c => c.parentCategoryId === currentCategory.id)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  }, [posCategories, currentCategory]);

  // مسار التتبع الشجري (Breadcrumb items)
  const breadcrumbTrail = useMemo(() => {
    if (selectedCategoryId === 'ALL') {
      return [{ id: 'ALL', name: 'كل التصنيفات' }];
    }
    if (selectedCategoryId === 'UNCATEGORIZED') {
      return [
        { id: 'ALL', name: 'كل التصنيفات' },
        { id: 'UNCATEGORIZED', name: 'أصناف غير مصنفة' }
      ];
    }
    const trail: { id: string; name: string }[] = [];
    let curr: ProductCategory | undefined = currentCategory || undefined;
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      trail.unshift({ id: curr.id, name: curr.name });
      if (curr.parentCategoryId) {
        curr = posCategories.find(c => c.id === curr!.parentCategoryId);
      } else {
        break;
      }
    }
    return [{ id: 'ALL', name: 'كل التصنيفات' }, ...trail];
  }, [selectedCategoryId, currentCategory, posCategories]);

  // زر الرجوع للمستوى السابق
  const handleGoBackLevel = () => {
    if (selectedCategoryId === 'ALL') return;
    if (selectedCategoryId === 'UNCATEGORIZED') {
      setSelectedCategoryId('ALL');
      setShowDirectOnly(false);
      return;
    }
    if (currentCategory?.parentCategoryId) {
      setSelectedCategoryId(currentCategory.parentCategoryId);
      setShowDirectOnly(false);
    } else {
      setSelectedCategoryId('ALL');
      setShowDirectOnly(false);
    }
  };

  // اختيار تصنيف مع إعادة ضبط فلترة المباشر
  const handleSelectCategory = (catId: string) => {
    setSelectedCategoryId(catId);
    setShowDirectOnly(false);
  };

  // عند عدم وجود فاتورة أو مسودة مفتوحة: مواءمة وضع البيع مع الأوضاع المسموحة حاليًا فقط
  useEffect(() => {
    if (cart.length > 0 || pendingDraftPrompt) return;
    if (!effectiveAllowPlatformSale && effectiveAllowDirectSale && saleMode !== 'customer') {
      setSaleMode('customer');
      if (creditPartyType === 'platform') {
        setCreditPartyType('customer');
      }
      if (platformOrderId) {
        setPlatformOrderId('');
        setPlatformOrderError(false);
      }
      setPendingModeSwitch(null);
      setPendingPlatformSwitch(null);
      return;
    }
    if (effectiveAllowPlatformSale && !effectiveAllowDirectSale && saleMode !== 'platform') {
      setSaleMode('platform');
      if (salesRules.platformAlwaysCredit) {
        setPaymentType('آجل');
        setCreditPartyType('platform');
      } else {
        setCreditPartyType('platform');
      }
      setPendingModeSwitch(null);
      setPendingPlatformSwitch(null);
    }
  }, [
    cart.length,
    pendingDraftPrompt,
    effectiveAllowPlatformSale,
    effectiveAllowDirectSale,
    saleMode,
    creditPartyType,
    platformOrderId,
    salesRules.platformAlwaysCredit
  ]);

  // عند انقطاع الاتصال: ضبط نوع الدفع تلقائيًا للمسموح فقط
  useEffect(() => {
    if (!isOffline) return;
    if (paymentType === 'جزئي') {
      setPaymentType('نقدي');
    } else if (paymentType === 'آجل' && saleMode === 'customer') {
      setPaymentType('نقدي');
    } else if (paymentType === 'آجل' && creditPartyType === 'customer') {
      if (effectivePlatformsEnabled) {
        setCreditPartyType('platform');
      } else {
        setPaymentType('نقدي');
      }
    }
  }, [isOffline, paymentType, creditPartyType, saleMode, effectivePlatformsEnabled]);

  const pendingDraftPromptRef = useRef<PosInvoiceDraft | null>(pendingDraftPrompt);
  pendingDraftPromptRef.current = pendingDraftPrompt;
  const activePlatformsRef = useRef<Platform[]>(activePlatforms);
  activePlatformsRef.current = activePlatforms;
  const platformsEnabledRef = useRef<boolean | undefined>(platformsEnabled);
  platformsEnabledRef.current = platformsEnabled;

  useEffect(() => {
    const applyDefaultCashbox = (cbs: Cashbox[], assignments?: any[]) => {
      const active = cbs.filter((c: any) => c.status !== 'inactive' && c.status !== 'موقوفة');
      const defaultId = user?.cashboxConfig?.defaultSaleCashboxId;
      const allowedIds = user?.cashboxConfig?.allowedSaleCashboxIds;

      if (defaultId && active.some((c: any) => c.id === defaultId) && (!allowedIds || allowedIds.length === 0 || allowedIds.includes(defaultId))) {
        setSelectedCashboxId(prev => prev || defaultId);
      } else if (allowedIds && allowedIds.length > 0) {
        const firstAllowed = active.find((c: any) => allowedIds.includes(c.id));
        if (firstAllowed) setSelectedCashboxId(prev => prev || firstAllowed.id);
      } else if (assignments && user) {
        const myAssignment = assignments.find((a: any) => a.userId === user.id && a.isDefault);
        if (myAssignment) {
          setSelectedCashboxId(prev => prev || myAssignment.cashboxId);
          return;
        }
      } else if (active.length > 0) {
        setSelectedCashboxId(prev => prev || active[0].id);
      }
    };

    const loadFromLocalDb = async () => {
      const snap = await loadOfflineSnapshot(user || null);
      if (!snap) return;
      if (snap.items.length > 0) setLocalItemsFallback(snap.items);
      if (snap.platforms.length > 0) setLocalPlatformsFallback(snap.platforms);
      if (snap.categories.length > 0) setLocalCategoriesFallback(snap.categories);
      if (snap.lastSyncAt) setLocalLastSyncAt(snap.lastSyncAt);
      if (snap.cashboxes.length > 0) {
        setCashboxes(snap.cashboxes);
        applyDefaultCashbox(snap.cashboxes, snap.cashboxAssignments);
      }
      if (snap.customers.length > 0) {
        setCustomers(snap.customers);
      }
    };

    if (isOffline) {
      loadFromLocalDb();
      return;
    }

    let isCancelled = false;
    Promise.all([
      api.getCashboxes().catch(() => ({ success: false, cashboxes: [] })),
      api.getCustomers().catch(() => ({ success: false, customers: [] })),
      api.getUserCashboxAssignments().catch(() => ({ success: false, assignments: [] })),
      api.getSalesRules().catch(() => ({ success: false, rules: undefined })),
      api.getDeliveryConfig().catch(() => null)
    ]).then(([cbRes, custRes, asRes, rulesRes, delivCfg]) => {
      if (isCancelled) return;
      if (cbRes.success && cbRes.cashboxes && cbRes.cashboxes.length > 0) {
        setCashboxes(cbRes.cashboxes);
        applyDefaultCashbox(cbRes.cashboxes, asRes.assignments);
      } else {
        loadFromLocalDb();
      }
      const nextCusts = custRes.success && custRes.customers && custRes.customers.length > 0
        ? custRes.customers
        : customers;
      if (custRes.success && custRes.customers && custRes.customers.length > 0) {
        setCustomers(custRes.customers);
      }
      if (delivCfg && delivCfg.success) {
        setDeliveryConfig(delivCfg);
      } else {
        setDeliveryConfig(null);
      }
      if (rulesRes.success && rulesRes.rules) {
        setSalesRules(rulesRes.rules);
        writeCachedSalesRules(rulesRes.rules);
        if (cartRef.current.length === 0 && !pendingDraftPromptRef.current) {
          const nextMode = resolveDefaultSaleMode(
            rulesRes.rules,
            saleModeStorageKey,
            platformsEnabledRef.current !== false &&
              !rulesRes.rules.salesOnlyMode &&
              rulesRes.rules.platformsEnabled !== false &&
              rulesRes.rules.allowPlatformSale !== false,
            rulesRes.rules.allowDirectSale !== false
          );
          setSaleMode(nextMode);
          setSelectedPlatformId(resolveDefaultPlatformId(rulesRes.rules, activePlatformsRef.current));
          setSelectedCustomerId(resolveDefaultCustomerId(rulesRes.rules, nextCusts));
        }
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [user, isOffline]);

  // تطبيق الافتراضيات عند جاهزية الشاشة بدون مسودة مفتوحة
  useEffect(() => {
    if (!isDraftReady || pendingDraftPrompt || cart.length > 0) return;
    if (initialDefaultsAppliedRef.current) return;
    initialDefaultsAppliedRef.current = true;
    setSaleMode(
      resolveDefaultSaleMode(
        salesRules,
        saleModeStorageKey,
        effectiveAllowPlatformSale,
        effectiveAllowDirectSale
      )
    );
    setSelectedPlatformId(resolveDefaultPlatformId(salesRules, activePlatforms));
    setSelectedCustomerId(resolveDefaultCustomerId(salesRules, customers));
  }, [
    isDraftReady,
    pendingDraftPrompt,
    cart.length,
    salesRules,
    saleModeStorageKey,
    activePlatforms,
    customers,
    resolveDefaultSaleMode,
    resolveDefaultPlatformId,
    resolveDefaultCustomerId
  ]);

  // فحص المسودة المحفوظة لهذا التبويب (مع ترحيل آمن للمسودة القديمة المشتركة في تبويب واحد فقط بعد استقرار مصافحة التبويب)
  useEffect(() => {
    const userChanged = lastDraftUserKeyRef.current !== userKey;
    lastDraftUserKeyRef.current = userKey;

    if (!userChanged && cartRef.current.length > 0) {
      // عند تدوير tabId لتبويب نشط يحتوي أصنافاً بالفعل، نُبقي الحالة جاهزة لكتابتها في المفتاح الجديد دون المساس بمسودة التبويب الأصلي
      setPendingDraftPrompt(null);
      setIsDraftReady(true);
      return;
    }

    let cancelled = false;
    setIsDraftReady(false);

    void waitForTabIdentitySettled().then(async (settledTabId) => {
      if (cancelled) return;
      if (settledTabId !== tabId) {
        idempotencyKeyRef.current = generateIdempotencyKey();
        setTabId(settledTabId);
        return;
      }

      const settlement = getTabIdentitySettlement();
      if (settlement.isAmbiguous) {
        setAmbiguousTabBlockReason(
          settlement.reason ||
            'تعذر التحقق من استقلال هوية هذا التبويب في هذا المتصفح. لمنع تضارب الفواتير مع تبويب آخر تم إيقاف شاشة البيع في هذا التبويب.'
        );
        pendingDraftSourceRef.current = null;
        setPendingDraftPrompt(null);
        setIsDraftReady(false);
        return;
      }

      setAmbiguousTabBlockReason(null);

      const savedTab = readPosDraft(draftStorageKey);
      if (savedTab && Array.isArray(savedTab.cart) && savedTab.cart.length > 0) {
        pendingDraftSourceRef.current = 'tab';
        setPendingDraftPrompt(savedTab);
        return;
      }

      if (savedTab) {
        clearPosDraft(draftStorageKey);
      }

      const savedLegacy = readPosDraft(legacyDraftStorageKey);
      if (savedLegacy && Array.isArray(savedLegacy.cart) && savedLegacy.cart.length > 0) {
        const claimed = await tryClaimLegacyPosDraftPrompt(userKey, settledTabId);
        if (cancelled || settledTabId !== tabId) {
          if (claimed) {
            clearLegacyDraftClaim(userKey, settledTabId);
          }
          return;
        }
        // إعادة فحص وجود المسودة القديمة بعد اكتساب القفل للتأكد أن تبويباً آخر لم يرحّلها للتو
        const verifiedLegacyAfterLock = readPosDraft(legacyDraftStorageKey);
        if (claimed && verifiedLegacyAfterLock && Array.isArray(verifiedLegacyAfterLock.cart) && verifiedLegacyAfterLock.cart.length > 0) {
          setUnmigratedLegacyDraft(null);
          pendingDraftSourceRef.current = 'legacy';
          setPendingDraftPrompt(verifiedLegacyAfterLock);
        } else {
          if (claimed) {
            clearLegacyDraftClaim(userKey, settledTabId);
          }
          // إذا لم يتوفر Web Locks، نترك المسودة القديمة محفوظة ونعرض خيار استعادتها الآمنة دون نقل تلقائي غير آمن
          if (!claimed && verifiedLegacyAfterLock && Array.isArray(verifiedLegacyAfterLock.cart) && verifiedLegacyAfterLock.cart.length > 0 && typeof navigator !== 'undefined' && !navigator.locks) {
            setUnmigratedLegacyDraft(verifiedLegacyAfterLock);
          } else {
            setUnmigratedLegacyDraft(null);
          }
          pendingDraftSourceRef.current = null;
          setPendingDraftPrompt(null);
          setIsDraftReady(true);
        }
        return;
      }

      if (savedLegacy) {
        clearPosDraft(legacyDraftStorageKey);
      }
      setUnmigratedLegacyDraft(null);
      pendingDraftSourceRef.current = null;
      setPendingDraftPrompt(null);
      setIsDraftReady(true);
    });

    return () => {
      cancelled = true;
      if (pendingDraftSourceRef.current === 'legacy') {
        clearLegacyDraftClaim(userKey, tabId);
      }
    };
  }, [draftStorageKey, legacyDraftStorageKey, userKey, tabId]);

  const handleOpenManualLegacyDraftPrompt = () => {
    const latestLegacy = readPosDraft(legacyDraftStorageKey);
    if (!latestLegacy || !Array.isArray(latestLegacy.cart) || latestLegacy.cart.length === 0) {
      setUnmigratedLegacyDraft(null);
      return;
    }
    setUnmigratedLegacyDraft(null);
    pendingDraftSourceRef.current = 'legacy';
    setPendingDraftPrompt(latestLegacy);
  };

  const handleRestoreDraft = () => {
    if (!pendingDraftPrompt) return;
    const isLegacyDraft = pendingDraftSourceRef.current === 'legacy';
    try {
      const draft = pendingDraftPrompt;
      const restoredCart = (Array.isArray(draft.cart) ? draft.cart : [])
        .filter((line) => line && line.item && line.item.id && Number(line.quantity) > 0)
        .map((line) => {
          const latestItem = warehouseAwareItems.find(it => it.id === line.item.id) || line.item;
          return {
            ...line,
            item: latestItem,
            quantity: Number(line.quantity) || 1
          };
        });

      const restoredMode: PosSaleMode = draft.saleMode === 'customer' ? 'customer' : 'platform';
      const nextIdempotencyKey = draft.idempotencyKey || generateIdempotencyKey();

      if (isLegacyDraft) {
        // حفظ المسودة المرحّلة في مفتاح التبويب الجديد والتحقق الصارم من نجاح الحفظ قبل حذف المفتاح القديم أو استعادة الحالة
        const migratedDraft: PosInvoiceDraft = {
          ...draft,
          savedAt: new Date().toISOString(),
          idempotencyKey: nextIdempotencyKey,
          cart: restoredCart
        };
        writePosDraft(draftStorageKey, migratedDraft);
        const verifiedSaved = readPosDraft(draftStorageKey);
        const isSavedValid =
          Boolean(verifiedSaved) &&
          verifiedSaved?.idempotencyKey === nextIdempotencyKey &&
          Array.isArray(verifiedSaved?.cart) &&
          verifiedSaved!.cart.length === restoredCart.length &&
          restoredCart.length > 0;
        if (!isSavedValid) {
          clearLegacyDraftClaim(userKey, tabId);
          pendingDraftSourceRef.current = null;
          setPendingDraftPrompt(null);
          setIsDraftReady(true);
          setErrorMsg('تعذر ترحيل المسودة القديمة إلى هذا التبويب بسبب امتلاء التخزين؛ تم الإبقاء على المسودة القديمة محفوظة بأمان.');
          return;
        }
        clearPosDraft(legacyDraftStorageKey);
        clearLegacyDraftClaim(userKey, tabId);
      }

      setSaleMode(restoredMode);
      if (
        (restoredMode === 'platform' && effectiveAllowPlatformSale) ||
        (restoredMode === 'customer' && effectiveAllowDirectSale)
      ) {
        writeLastPosSaleMode(saleModeStorageKey, restoredMode);
      }

      if (
        draft.selectedWarehouseId &&
        activeAllowedWarehouses.some(w => w.id === draft.selectedWarehouseId)
      ) {
        setSelectedWarehouseId(draft.selectedWarehouseId);
      }

      const targetPlatformId =
        draft.selectedPlatformId && activePlatforms.some(p => p.id === draft.selectedPlatformId)
          ? draft.selectedPlatformId
          : (selectedPlatform?.id || '');

      if (targetPlatformId && targetPlatformId !== selectedPlatform?.id) {
        skipPlatformSyncForIdRef.current = targetPlatformId;
        setSelectedPlatformId(targetPlatformId);
      }

      setCart(restoredCart);
      setSelectedCustomerId(draft.selectedCustomerId || '');
      if (draft.selectedCashboxId) {
        setSelectedCashboxId(draft.selectedCashboxId);
      }
      const restoredWasPartial = restoredMode === 'customer' && draft.paymentType === 'جزئي';
      if (restoredMode === 'platform' && salesRules.platformAlwaysCredit) {
        setPaymentType('آجل');
        setCreditPartyType('platform');
      } else {
        setPaymentType(
          draft.paymentType === 'آجل'
            ? 'آجل'
            : (restoredMode === 'platform' && draft.paymentType === 'جزئي')
            ? 'جزئي'
            : 'نقدي'
        );
        setCreditPartyType(
          restoredMode === 'platform'
            ? 'platform'
            : draft.creditPartyType === 'platform'
            ? 'platform'
            : 'customer'
        );
      }
      setDeliveryFee(restoredMode === 'platform' ? (draft.deliveryFee ?? 0) : 0);
      setNotes(draft.notes || '');
      setPlatformOrderId(restoredMode === 'platform' ? (draft.platformOrderId || '') : '');
      setPlatformOrderError(false);
      if (restoredMode === 'customer' && draft.isDeliveryEnabled) {
        setIsDeliveryEnabled(true);
        setDeliveryPaymentMode(draft.deliveryPaymentMode === 'cod' ? 'cod' : 'prepaid');
        setDeliveryZoneId(draft.deliveryZoneId || '');
        setDeliveryAddress(draft.deliveryAddress || '');
        setDeliveryPhone(draft.deliveryPhone || '');
        setDeliveryOrderFeeInput(draft.deliveryOrderFeeInput ?? 0);
        setDeliveryFeeManual(Boolean(draft.deliveryFeeManual));
        setDeliveryAssigneeType(
          draft.deliveryAssigneeType === 'driver' || draft.deliveryAssigneeType === 'courier'
            ? draft.deliveryAssigneeType
            : ''
        );
        setDeliveryAssigneeId(draft.deliveryAssigneeId || '');
        setDeliveryTrackingNumber(draft.deliveryTrackingNumber || '');
        setDeliveryZoneWarning(null);
        setDeliveryAddressError(false);
        setDeliveryZoneError(false);
      } else {
        resetDeliveryOrderState();
      }
      setIsManualCashOverride(restoredWasPartial || Boolean(draft.isManualCashOverride));
      setPaidAmountInput(draft.paidAmountInput ?? '0.00');
      setPosBnplEnabled(Boolean(draft.posBnplEnabled));
      setPosBnplPercentInput(draft.posBnplPercentInput ?? 0);
      setIsBnplPercentOverridden(Boolean(draft.isBnplPercentOverridden));
      setPosCommissionPercentInput(draft.posCommissionPercentInput ?? 0);
      setIsCommissionPercentOverridden(Boolean(draft.isCommissionPercentOverridden));
      idempotencyKeyRef.current = nextIdempotencyKey;
      setErrorMsg(null);
      setIsUnknownResultError(false);

      pendingDraftSourceRef.current = null;
      setPendingDraftPrompt(null);
      setIsDraftReady(true);
    } catch {
      if (isLegacyDraft) {
        clearLegacyDraftClaim(userKey, tabId);
      } else {
        clearPosDraft(draftStorageKey);
      }
      pendingDraftSourceRef.current = null;
      setPendingDraftPrompt(null);
      setIsDraftReady(true);
    }
  };

  const handleDiscardDraft = () => {
    if (pendingDraftSourceRef.current === 'legacy') {
      clearPosDraft(legacyDraftStorageKey);
      clearLegacyDraftClaim(userKey, tabId);
    } else {
      clearPosDraft(draftStorageKey);
    }
    pendingDraftSourceRef.current = null;
    idempotencyKeyRef.current = generateIdempotencyKey();
    setPendingDraftPrompt(null);
    setIsDraftReady(true);
  };

  // تحذير إغلاق التبويب عند وجود أصناف في الفاتورة المفتوحة
  useEffect(() => {
    if (cart.length === 0) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [cart.length]);

  // تشغيل نغمة صوتية سريعة عند المسح الناجح
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    } catch (_) {}
  };

  // دالة حساب سطر الصنف باستخدام المعادلة المشتركة src/shared/invoiceCalc.ts
  const calculateLineFinancials = (
    item: Item,
    platform: Platform | undefined,
    customPrice?: number,
    customTaxRate?: number
  ) => {
    const rawComm = platform
      ? (isCommissionPercentOverridden && posCommissionPercentInput !== ''
          ? Number(posCommissionPercentInput)
          : Number(platform.discountPercentage || 0))
      : 0;
    const discPercent = Math.min(100, Math.max(0, isNaN(rawComm) ? 0 : rawComm));

    const parsedBnplOverride = platform && isBnplPercentOverridden && posBnplPercentInput !== ''
      ? Math.min(100, Math.max(0, Number(posBnplPercentInput) || 0))
      : undefined;

    const barcodeAtSale = item.barcode || (item.secondaryBarcodes && item.secondaryBarcodes[0]) || '';

    const lineCalc = calculateInvoiceLine({
      item,
      line: {
        itemId: item.id,
        quantity: 1,
        salePriceAtSale: customPrice !== undefined ? customPrice : item.salePrice,
        taxRateAtSale: customTaxRate !== undefined ? customTaxRate : (item.taxRate || 0),
        barcodeAtSale
      },
      platform,
      taxSettings,
      bnplEnabled: platform ? posBnplEnabled : false,
      bnplPercentOverrideVal: parsedBnplOverride,
      platformDiscountPercent: discPercent
    });

    return {
      pickupFee: lineCalc.unitPickupFee,
      discPercent: lineCalc.platformDiscountPercentAtSale,
      effectiveSalePrice: lineCalc.baseUnitPrice,
      baseUnitPrice: lineCalc.baseUnitPrice,
      customerUnitPrice: lineCalc.customerUnitPrice,
      bnplPercent: lineCalc.bnplPercent,
      bnplUnitAmount: lineCalc.bnplUnitAmount,
      bnplDeductionUnit: lineCalc.bnplDeductionUnit,
      effectiveTaxRate: lineCalc.taxRateAtSale,
      unitBase: lineCalc.basePriceForUnit,
      unitTax: lineCalc.unitTaxAmount,
      unitDiscount: lineCalc.unitDiscountValue,
      unitNetDisc: lineCalc.unitNet,
      unitNet: lineCalc.unitNet,
      unitProfit: canViewProfit ? lineCalc.unitProfit : undefined,
      barcodeAtSale: lineCalc.barcodeAtSale
    };
  };

  // تعديل سعر بيع الصنف الأساسي داخل شاشة البيع لهذه الفاتورة فقط قبل الحفظ
  const handleUpdateLinePrice = (itemId: string, newPrice: number) => {
    if (!canEditPriceBeforeSave) return;
    const it = items.find(i => i.id === itemId);
    if (!canOverrideMinPrice && it?.minPrice && newPrice < it.minPrice) {
      setErrorMsg(`سعر البيع لا يمكن أن يقل عن الحد الأدنى (${it.minPrice} ج.م) بدون صلاحية تجاوز الحد الأدنى`);
      return;
    }
    setCart(prev => prev.map(c => {
      if (c.item.id !== itemId) return c;
      const calc = calculateLineFinancials(c.item, effectivePlatform, newPrice, c.taxRateAtSale);
      return {
        ...c,
        salePriceAtSale: newPrice,
        baseUnitPrice: newPrice,
        customerUnitPrice: calc.customerUnitPrice,
        bnplPercent: calc.bnplPercent,
        bnplUnitAmount: calc.bnplUnitAmount,
        bnplDeductionUnit: calc.bnplDeductionUnit,
        unitBasePrice: calc.unitBase,
        unitTaxAmount: calc.unitTax,
        unitDiscountValue: calc.unitDiscount,
        unitNetAfterDiscount: calc.unitNetDisc,
        unitNet: calc.unitNet,
        unitProfit: calc.unitProfit,
        customPriceEdited: true
      };
    }));
    setPriceViolatingItemIds(prev => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    setErrorMsg(null);
  };

  // تعديل نسبة ضريبة الصنف داخل شاشة البيع لهذه الفاتورة فقط قبل الحفظ
  const handleUpdateLineTax = (itemId: string, newTaxRate: number) => {
    if (!canEditTaxBeforeSave) return;
    setCart(prev => prev.map(c => {
      if (c.item.id !== itemId) return c;
      const calc = calculateLineFinancials(c.item, effectivePlatform, c.baseUnitPrice, newTaxRate);
      return {
        ...c,
        taxRateAtSale: newTaxRate,
        customerUnitPrice: calc.customerUnitPrice,
        bnplPercent: calc.bnplPercent,
        bnplUnitAmount: calc.bnplUnitAmount,
        bnplDeductionUnit: calc.bnplDeductionUnit,
        unitBasePrice: calc.unitBase,
        unitTaxAmount: calc.unitTax,
        unitDiscountValue: calc.unitDiscount,
        unitNetAfterDiscount: calc.unitNetDisc,
        unitNet: calc.unitNet,
        unitProfit: calc.unitProfit,
        customTaxEdited: true
      };
    }));
    setErrorMsg(null);
  };

  // تحديث خصم المنصة ونسب BNPL والضرائب عند تبديل المنصة أو وضع البيع أو الإعدادات (مع حماية المسودات المفتوحة في وضع معطّل)
  useEffect(() => {
    if (
      (saleMode === 'platform' && !effectiveAllowPlatformSale) ||
      (saleMode === 'customer' && !effectiveAllowDirectSale)
    ) {
      return;
    }
    setCart(prev => {
      if (prev.length === 0) return prev;
      return prev.map(c => {
        const customP = c.customPriceEdited ? c.baseUnitPrice : undefined;
        const customT = c.customTaxEdited ? c.taxRateAtSale : undefined;
        const calc = calculateLineFinancials(c.item, effectivePlatform, customP, customT);

        return {
          ...c,
          salePriceAtSale: calc.baseUnitPrice,
          baseUnitPrice: calc.baseUnitPrice,
          customerUnitPrice: calc.customerUnitPrice,
          bnplPercent: calc.bnplPercent,
          bnplUnitAmount: calc.bnplUnitAmount,
          bnplDeductionUnit: calc.bnplDeductionUnit,
          unitBasePrice: calc.unitBase,
          taxRateAtSale: calc.effectiveTaxRate,
          unitTaxAmount: calc.unitTax,
          barcodeAtSale: calc.barcodeAtSale,
          platformDiscountPercent: calc.discPercent,
          unitPickupFee: calc.pickupFee,
          unitDiscountValue: calc.unitDiscount,
          unitNetAfterDiscount: calc.unitNetDisc,
          unitNet: calc.unitNet,
          unitProfit: calc.unitProfit
        };
      });
    });
  }, [
    saleMode,
    effectiveAllowPlatformSale,
    effectiveAllowDirectSale,
    selectedPlatformId,
    effectivePlatform,
    costs,
    canViewProfit,
    taxSettings,
    posBnplEnabled,
    posBnplPercentInput,
    isBnplPercentOverridden,
    posCommissionPercentInput,
    isCommissionPercentOverridden
  ]);

  // صنف محول من صفحة الأصناف (بيع سريع)
  useEffect(() => {
    if (initialItemToAdd) {
      addToCart(initialItemToAdd);
      if (onClearInitialItem) onClearInitialItem();
    }
  }, [initialItemToAdd]);

  const [selectedCartItemId, setSelectedCartItemId] = useState<string | null>(null);
  const [focusCartQtyToken, setFocusCartQtyToken] = useState<number>(0);

  const posActiveScreenRef = useRef<HTMLDivElement | null>(null);
  const cartRef = useRef<CartItem[]>(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  const commitCart = React.useCallback(
    (updater: CartItem[] | ((prev: CartItem[]) => CartItem[])) => {
      setCart((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        cartRef.current = next;
        return next;
      });
    },
    []
  );

  const isLatestItemFirst = normalizeLatestItemFirst(displaySettings?.latestItemFirst).pos;

  const addToCart = (
    item: Item,
    explicitBarcode?: string,
    _options?: { fromBarcodeScan?: boolean }
  ) => {
    setErrorMsg(null);
    if (effectivePlatform && item.platformIds && item.platformIds.length > 0 && !item.platformIds.includes(effectivePlatform.id)) {
      const msg = `هذا الصنف غير متاح على منصة ${effectivePlatform.name}`;
      setErrorMsg(msg);
      setScanFeedback({
        type: 'error',
        message: msg
      });
      return;
    }

    if (!effectiveAllowNegativeStock && item.stockQuantity <= 0) {
      setErrorMsg(`الكمية لا تكفي. المتاح: ${item.stockQuantity}`);
      return;
    }

    const calc = calculateLineFinancials(item, effectivePlatform);
    const currentCart = cartRef.current;
    const existing = currentCart.find(c => c.item.id === item.id);

    if (existing) {
      if (!effectiveAllowNegativeStock && existing.quantity + 1 > item.stockQuantity) {
        const clamped = Math.max(0, item.stockQuantity);
        commitCart((prev) => {
          const target = prev.find(c => c.item.id === item.id);
          if (!target) return prev;
          if (clamped <= 0) return prev.filter(c => c.item.id !== item.id);
          const qtyIncreased = clamped > target.quantity;
          const updatedLine: CartItem = {
            ...target,
            quantity: clamped,
            barcodeAtSale: explicitBarcode || target.barcodeAtSale
          };
          if (isLatestItemFirst && qtyIncreased) {
            return [updatedLine, ...prev.filter(c => c.item.id !== item.id)];
          }
          return prev.map(c => (c.item.id === item.id ? updatedLine : c));
        });
        setErrorMsg(`الكمية لا تكفي. المتاح: ${item.stockQuantity}`);
        return;
      }

      commitCart((prev) => {
        const target = prev.find(c => c.item.id === item.id);
        if (!target) return prev;
        const updatedLine: CartItem = {
          ...target,
          quantity: target.quantity + 1,
          barcodeAtSale: explicitBarcode || target.barcodeAtSale
        };
        return isLatestItemFirst
          ? [updatedLine, ...prev.filter(c => c.item.id !== item.id)]
          : prev.map(c => (c.item.id === item.id ? updatedLine : c));
      });
      showAddedItemToast(item.name);
    } else {
      const newLine: CartItem = {
        item,
        quantity: 1,
        salePriceAtSale: calc.baseUnitPrice,
        baseUnitPrice: calc.baseUnitPrice,
        customerUnitPrice: calc.customerUnitPrice,
        bnplPercent: calc.bnplPercent,
        bnplUnitAmount: calc.bnplUnitAmount,
        bnplDeductionUnit: calc.bnplDeductionUnit,
        barcodeAtSale: explicitBarcode || calc.barcodeAtSale,
        taxRateAtSale: calc.effectiveTaxRate,
        unitTaxAmount: calc.unitTax,
        unitBasePrice: calc.unitBase,
        unitPickupFee: calc.pickupFee,
        platformDiscountPercent: calc.discPercent,
        unitDiscountValue: calc.unitDiscount,
        unitNetAfterDiscount: calc.unitNetDisc,
        unitNet: calc.unitNet,
        unitProfit: calc.unitProfit
      };

      if (isLatestItemFirst) {
        commitCart((prev) => [newLine, ...prev.filter(c => c.item.id !== item.id)]);
      } else {
        commitCart((prev) => [...prev, newLine]);
      }
      showAddedItemToast(item.name);
    }
  };

  // البحث عن الصنف بالباركود وإضافته أو تحديثه ووضعه في أول صف من السلة
  const handleBarcodeScanned = (scannedCode: string) => {
    const cleanCode = scannedCode.trim();
    if (!cleanCode) return;

    setErrorMsg(null);
    setScanFeedback(null);

    const lowerCode = cleanCode.toLowerCase();
    // البحث في الباركود الأساسي والباركودات الفرعية
    const foundItem = warehouseAwareItems.find(it => {
      if (it.barcode && it.barcode.trim().toLowerCase() === lowerCode) return true;
      if (it.secondaryBarcodes && it.secondaryBarcodes.some(b => b.trim().toLowerCase() === lowerCode)) return true;
      if (it.barcodes && it.barcodes.some(b => b.barcode.trim().toLowerCase() === lowerCode)) return true;
      return false;
    });

    if (foundItem) {
      if (effectivePlatform && foundItem.platformIds && foundItem.platformIds.length > 0 && !foundItem.platformIds.includes(effectivePlatform.id)) {
        const msg = `هذا الصنف غير متاح على منصة ${effectivePlatform.name}`;
        setErrorMsg(msg);
        setScanFeedback({
          type: 'error',
          message: msg
        });
        setBarcodeInput('');
        return;
      }

      const currentCart = cartRef.current;
      const existingInCart = currentCart.find(c => c.item.id === foundItem.id);
      const scanMode =
        displaySettings?.barcodeScanMode === 'edit_quantity' ? 'edit_quantity' : 'increment';

      // في وضع «مسح الصنف ثم تعديل الكمية»: إذا كان الصنف موجودًا في السلة، نحدده لتعديل الكمية يدويًا دون زيادة تلقائية، وننقله لأول السلة فقط إذا كان مفتاح ترتيب آخر صنف أولًا مفعّلًا لنقطة البيع
      if (existingInCart && scanMode === 'edit_quantity') {
        playBeep();
        commitCart((prev) => {
          const target = prev.find(c => c.item.id === foundItem.id);
          if (!target) return prev;
          const updatedTarget: CartItem = {
            ...target,
            barcodeAtSale: cleanCode || target.barcodeAtSale
          };
          return isLatestItemFirst
            ? [updatedTarget, ...prev.filter(c => c.item.id !== foundItem.id)]
            : prev.map(c => (c.item.id === foundItem.id ? updatedTarget : c));
        });
        setSelectedCartItemId(foundItem.id);
        if (!isCameraModalOpen) {
          setFocusCartQtyToken(prev => prev + 1);
        }
        setScanFeedback({
          type: 'success',
          message: `تم تحديد سطر الصنف "${foundItem.name}" (الكمية الحالية: ${existingInCart.quantity}) — يمكنك تعديل الكمية يدويًا`
        });
        setBarcodeInput('');
        setTimeout(() => setScanFeedback(null), 3000);
        return;
      }

      if (!effectiveAllowNegativeStock && foundItem.stockQuantity <= 0) {
        setErrorMsg(`الكمية لا تكفي. المتاح: ${foundItem.stockQuantity}`);
        setScanFeedback({
          type: 'error',
          message: `الكمية لا تكفي. المتاح: ${foundItem.stockQuantity}`
        });
        setBarcodeInput('');
        return;
      }

      if (!effectiveAllowNegativeStock && existingInCart && existingInCart.quantity + 1 > foundItem.stockQuantity) {
        const clamped = Math.max(0, foundItem.stockQuantity);
        commitCart((prev) => {
          const target = prev.find(c => c.item.id === foundItem.id);
          if (!target) return prev;
          if (clamped <= 0) return prev.filter(c => c.item.id !== foundItem.id);
          const qtyIncreased = clamped > target.quantity;
          const updatedTarget: CartItem = {
            ...target,
            quantity: clamped,
            barcodeAtSale: cleanCode || target.barcodeAtSale
          };
          if (isLatestItemFirst && qtyIncreased) {
            return [updatedTarget, ...prev.filter(c => c.item.id !== foundItem.id)];
          }
          return prev.map(c => (c.item.id === foundItem.id ? updatedTarget : c));
        });
        setSelectedCartItemId(clamped > 0 ? foundItem.id : null);
        setErrorMsg(`الكمية لا تكفي. المتاح: ${foundItem.stockQuantity}`);
        setScanFeedback({
          type: 'error',
          message: `الكمية لا تكفي. المتاح: ${foundItem.stockQuantity}`
        });
        setBarcodeInput('');
        return;
      }

      playBeep();
      addToCart(foundItem, cleanCode, { fromBarcodeScan: true });
      setSelectedCartItemId(foundItem.id);
      setScanFeedback({
        type: 'success',
        message: `تمت إضافة: "${foundItem.name}" (كود: ${cleanCode})`
      });
      setBarcodeInput('');
      // إخفاء رسالة النجاح بعد 3 ثوانٍ
      setTimeout(() => setScanFeedback(null), 3000);
    } else {
      setScanFeedback({
        type: 'error',
        message: `لم يُعثر على صنف بالباركود [${cleanCode}]. يمكنك البحث يدويًا باسم الصنف.`
      });
      setSearchQuery(cleanCode);
    }
  };

  const handleBarcodeScannedRef = useRef(handleBarcodeScanned);
  handleBarcodeScannedRef.current = handleBarcodeScanned;

  // مراجع أحدث قيم الحقول لاسترجاعها بدقة إذا بدأ المسح السريع أثناء تركيز أي حقل إدخال في نقطة البيع
  const latestPosFieldsRef = useRef({
    errorMsg,
    selectedCartItemId,
    notes,
    searchQuery,
    paidAmountInput,
    isManualCashOverride,
    platformOrderId,
    deliveryFee,
    deliveryAddress,
    deliveryPhone,
    deliveryOrderFeeInput,
    deliveryFeeManual,
    deliveryTrackingNumber,
    posBnplPercentInput,
    isBnplPercentOverridden,
    posCommissionPercentInput,
    isCommissionPercentOverridden,
    selectedWarehouseId,
    selectedPlatformId,
    selectedCustomerId,
    selectedCashboxId,
    deliveryZoneId,
    deliveryAssigneeType,
    deliveryAssigneeId
  });
  latestPosFieldsRef.current = {
    errorMsg,
    selectedCartItemId,
    notes,
    searchQuery,
    paidAmountInput,
    isManualCashOverride,
    platformOrderId,
    deliveryFee,
    deliveryAddress,
    deliveryPhone,
    deliveryOrderFeeInput,
    deliveryFeeManual,
    deliveryTrackingNumber,
    posBnplPercentInput,
    isBnplPercentOverridden,
    posCommissionPercentInput,
    isCommissionPercentOverridden,
    selectedWarehouseId,
    selectedPlatformId,
    selectedCustomerId,
    selectedCashboxId,
    deliveryZoneId,
    deliveryAssigneeType,
    deliveryAssigneeId
  };

  // التقاط مسح قارئ الباركود (USB / Bluetooth) من أي موضع داخل شاشة نقطة البيع النشطة دون تلويث حقول الإدخال أو حذف الكتابة اليدوية السريعة
  useEffect(() => {
    const SCANNER_MAX_INTER_KEY_MS = 35;
    const SCANNER_ENTER_MAX_DELAY_MS = 85;
    const SCANNER_LOCK_CHAR_THRESHOLD = 3;
    const MIN_BARCODE_LENGTH = 3;

    interface PreBurstSnapshot {
      element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      domValue: string;
      selectionStart: number | null;
      selectionEnd: number | null;
      cartSnapshot: CartItem[];
      fieldsSnapshot: typeof latestPosFieldsRef.current;
    }

    let burstChars: string[] = [];
    let firstKeyTime = 0;
    let lastKeyTime = 0;
    let isBurstLocked = false;
    let preBurstSnapshot: PreBurstSnapshot | null = null;
    let abortLockTimer: ReturnType<typeof setTimeout> | null = null;

    const clearAbortLockTimer = () => {
      if (abortLockTimer !== null) {
        clearTimeout(abortLockTimer);
        abortLockTimer = null;
      }
    };

    const resetBurstState = () => {
      clearAbortLockTimer();
      burstChars = [];
      firstKeyTime = 0;
      lastKeyTime = 0;
      isBurstLocked = false;
      preBurstSnapshot = null;
    };

    const setReactElementValue = (
      el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
      nextValue: string,
      caretPos?: number | null
    ) => {
      try {
        const currentVal = el.value;
        const tracker = (el as any)._valueTracker;
        if (tracker) {
          tracker.setValue(currentVal === nextValue ? `${nextValue}__rollback__` : currentVal);
        }
        const proto =
          el instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : el instanceof HTMLSelectElement
            ? window.HTMLSelectElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, nextValue);
        } else {
          el.value = nextValue;
        }
        if (
          typeof caretPos === 'number' &&
          (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        ) {
          try {
            el.setSelectionRange(caretPos, caretPos);
          } catch {
            // بعض أنواع input مثل number لا تدعم setSelectionRange
          }
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        if (el instanceof HTMLSelectElement) {
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch {
        // ignore DOM rollback errors
      }
    };

    const restorePreBurstSnapshot = () => {
      if (!preBurstSnapshot) return;
      const snap = preBurstSnapshot;

      commitCart(snap.cartSnapshot);
      const f = snap.fieldsSnapshot;
      setErrorMsg(f.errorMsg);
      setSelectedCartItemId(f.selectedCartItemId);
      setNotes(f.notes);
      setSearchQuery(f.searchQuery);
      setPaidAmountInput(f.paidAmountInput);
      setIsManualCashOverride(f.isManualCashOverride);
      setPlatformOrderId(f.platformOrderId);
      setDeliveryFee(f.deliveryFee);
      setDeliveryAddress(f.deliveryAddress);
      setDeliveryPhone(f.deliveryPhone);
      setDeliveryOrderFeeInput(f.deliveryOrderFeeInput);
      setDeliveryFeeManual(f.deliveryFeeManual);
      setDeliveryTrackingNumber(f.deliveryTrackingNumber);
      setPosBnplPercentInput(f.posBnplPercentInput);
      setIsBnplPercentOverridden(f.isBnplPercentOverridden);
      setPosCommissionPercentInput(f.posCommissionPercentInput);
      setIsCommissionPercentOverridden(f.isCommissionPercentOverridden);

      if (snap.element) {
        setReactElementValue(snap.element, snap.domValue, snap.selectionStart);
      }
    };

    // إذا تم قفل التتابع بعد 3+ مفاتيح سريعة جدًا (<= 35ms) لكن لم ينتهِ بـ Enter كمسح باركود، نعيد الأحرف المكتوبة للحقل حتى لا يُفقد أي حرف من كتابة المستخدم
    const replayAbortedLockedBurstToInput = () => {
      if (!isBurstLocked || !preBurstSnapshot || burstChars.length === 0) return;
      const snap = preBurstSnapshot;
      const el = snap.element;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const typedSeq = burstChars.join('');
        const base = snap.domValue || '';
        const start =
          typeof snap.selectionStart === 'number'
            ? Math.max(0, Math.min(base.length, snap.selectionStart))
            : base.length;
        const end =
          typeof snap.selectionEnd === 'number'
            ? Math.max(start, Math.min(base.length, snap.selectionEnd))
            : start;
        const reconstructed = `${base.slice(0, start)}${typedSeq}${base.slice(end)}`;
        setReactElementValue(el, reconstructed, start + typedSeq.length);
      }
    };

    const scheduleAbortLockReplay = () => {
      clearAbortLockTimer();
      abortLockTimer = setTimeout(() => {
        if (isBurstLocked) {
          replayAbortedLockedBurstToInput();
          resetBurstState();
        }
      }, SCANNER_ENTER_MAX_DELAY_MS + 10);
    };

    const captureElementSelection = (
      el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
    ): { start: number | null; end: number | null } => {
      if (!el || el instanceof HTMLSelectElement) {
        return { start: null, end: null };
      }
      try {
        return {
          start: typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length,
          end: typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length
        };
      } catch {
        return { start: el.value.length, end: el.value.length };
      }
    };

    const isPosScreenActiveAndModalFree = (): boolean => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return false;
      if (document.visibilityState === 'hidden') return false;
      if (
        isCameraModalOpen ||
        isFormulaModalOpen ||
        Boolean(pendingWarehouseSwitch) ||
        Boolean(pendingPlatformSwitch) ||
        Boolean(pendingModeSwitch) ||
        Boolean(pendingDraftPrompt) ||
        isUiAppearanceOpen ||
        isSubmittingRef.current
      ) {
        return false;
      }
      if (
        document.querySelector(
          '[role="dialog"], [aria-modal="true"], [data-shortcut-modal="true"]'
        )
      ) {
        return false;
      }
      const container = posActiveScreenRef.current;
      if (!container || container.offsetParent === null) {
        return false;
      }
      return true;
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e as any).__posBarcodeHandled) return;

      if (!isPosScreenActiveAndModalFree()) {
        resetBurstState();
        return;
      }

      const target = (e.target as HTMLElement | null) || (document.activeElement as HTMLElement | null);

      // إذا كان التركيز داخل حقل الباركود نفسه، يترك الحقل ليعالج الإدخال و Enter مباشرة دون ازدواجية
      if (
        target &&
        (target.id === 'pos-barcode-input' ||
          target.getAttribute('data-pos-barcode-input') === 'true')
      ) {
        resetBurstState();
        return;
      }

      if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) {
        if (isBurstLocked) {
          replayAbortedLockedBurstToInput();
        }
        resetBurstState();
        return;
      }

      // قارئات الباركود قد ترسل Shift قبل الحروف الكبيرة أو الرموز؛ نتجاهلها دون تصفير التتابع
      if (e.key === 'Shift' || e.key === 'CapsLock' || e.key === 'NumLock') {
        return;
      }

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

      if (e.key === 'Enter') {
        const dtSinceLastChar = lastKeyTime > 0 ? now - lastKeyTime : Infinity;
        const totalDuration = firstKeyTime > 0 ? lastKeyTime - firstKeyTime : Infinity;
        const avgInterval =
          burstChars.length > 1 ? totalDuration / (burstChars.length - 1) : Infinity;

        if (
          burstChars.length >= MIN_BARCODE_LENGTH &&
          dtSinceLastChar <= SCANNER_ENTER_MAX_DELAY_MS &&
          (isBurstLocked || avgInterval <= SCANNER_MAX_INTER_KEY_MS)
        ) {
          clearAbortLockTimer();
          (e as any).__posBarcodeHandled = true;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          restorePreBurstSnapshot();
          const scannedCode = burstChars.join('').trim();
          resetBurstState();

          if (scannedCode) {
            handleBarcodeScannedRef.current(scannedCode);
          }
          return;
        }

        if (isBurstLocked) {
          replayAbortedLockedBurstToInput();
        }
        resetBurstState();
        return;
      }

      // أي مفتاح غير طباعي (مثل F2، F3، F4، Esc، الأسهم، Backspace، Tab) يُترك يعمل طبيعيًا ويصفّر المخزن المؤقت
      if (e.key.length !== 1) {
        if (isBurstLocked) {
          replayAbortedLockedBurstToInput();
        }
        resetBurstState();
        return;
      }

      const dt = lastKeyTime > 0 ? now - lastKeyTime : Infinity;

      if (dt > SCANNER_MAX_INTER_KEY_MS) {
        if (isBurstLocked) {
          replayAbortedLockedBurstToInput();
        }
        clearAbortLockTimer();

        const editableTarget =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
            ? target
            : null;
        const sel = captureElementSelection(editableTarget);

        preBurstSnapshot = {
          element: editableTarget,
          domValue: editableTarget ? editableTarget.value : '',
          selectionStart: sel.start,
          selectionEnd: sel.end,
          cartSnapshot: cartRef.current.map(line => ({ ...line })),
          fieldsSnapshot: { ...latestPosFieldsRef.current }
        };
        burstChars = [e.key];
        firstKeyTime = now;
        lastKeyTime = now;
        isBurstLocked = false;
        return;
      }

      // تتابع سريع (الفاصل الزمني <= 35ms)
      burstChars.push(e.key);
      lastKeyTime = now;

      // عند المفتاح الثاني فقط (burstChars.length === 2)، نسمح بالمرور الطبيعي حتى لا تتأثر الكتابة اليدوية السريعة بإصبعين
      // ويبدأ قفل التتابع واستعادة اللقطة فقط عند وصول 3 مفاتيح متتالية بسرعة القارئ الآلي (<= 35ms لكل فاصل)
      if (burstChars.length < SCANNER_LOCK_CHAR_THRESHOLD) {
        return;
      }

      if (!isBurstLocked) {
        isBurstLocked = true;
        restorePreBurstSnapshot();
      }
      scheduleAbortLockReplay();

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      clearAbortLockTimer();
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, [
    isCameraModalOpen,
    isFormulaModalOpen,
    pendingWarehouseSwitch,
    pendingPlatformSwitch,
    pendingModeSwitch,
    pendingDraftPrompt,
    isUiAppearanceOpen,
    commitCart
  ]);

  const handleManualBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (barcodeInput.trim()) {
      handleBarcodeScanned(barcodeInput.trim());
    }
  };

  const updateQuantity = (itemId: string, qty: number) => {
    setErrorMsg(null);
    if (qty <= 0) {
      removeFromCart(itemId);
      return;
    }
    const cItem = cartRef.current.find(c => c.item.id === itemId);
    if (!cItem) return;

    if (!effectiveAllowNegativeStock && qty > cItem.item.stockQuantity) {
      const clamped = Math.max(0, cItem.item.stockQuantity);
      if (clamped <= 0) {
        removeFromCart(itemId);
      } else {
        commitCart(prev => prev.map(c => c.item.id === itemId ? { ...c, quantity: clamped } : c));
      }
      setErrorMsg(`الكمية لا تكفي. المتاح: ${cItem.item.stockQuantity}`);
      return;
    }
    commitCart(prev => prev.map(c => c.item.id === itemId ? { ...c, quantity: qty } : c));
  };

  const removeFromCart = (itemId: string) => {
    commitCart(prev => prev.filter(c => c.item.id !== itemId));
    setSelectedCartItemId(prev => (prev === itemId ? null : prev));
    setPriceViolatingItemIds(prev => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  };

  // مجاميع الفاتورة والضرائب باستخدام الدالة المشتركة calculateInvoice من src/shared/invoiceCalc.ts
  // في البيع المباشر تُحسب رسوم التوصيل فقط عند تفعيل طلب التوصيل لمنع أي رسوم خفية أو مزدوجة من الإعداد القديم
  const deliveryFeeNumber =
    saleMode === 'customer'
      ? (isDeliveryOrderActive ? effectiveDeliveryOrderFee : 0)
      : (isDeliveryFeeEnabled ? (Number(deliveryFee) || 0) : 0);
  const invoiceSummaryCalc = useMemo(() => {
    const isPlatformMode = saleMode === 'platform';
    const rawComm = isPlatformMode
      ? (isCommissionPercentOverridden && posCommissionPercentInput !== ''
          ? Number(posCommissionPercentInput)
          : Number(selectedPlatform?.discountPercentage || 0))
      : 0;
    const discPercent = Math.min(100, Math.max(0, isNaN(rawComm) ? 0 : rawComm));

    const parsedBnplOverride = isPlatformMode && isBnplPercentOverridden && posBnplPercentInput !== ''
      ? Math.min(100, Math.max(0, Number(posBnplPercentInput) || 0))
      : undefined;

    return calculateInvoice({
      invoiceNumber: '',
      lines: cart.map(c => ({
        item: c.item,
        line: {
          itemId: c.item.id,
          quantity: c.quantity,
          salePriceAtSale: c.baseUnitPrice,
          taxRateAtSale: c.taxRateAtSale,
          unitPickupFee: isPlatformMode ? c.unitPickupFee : 0,
          barcodeAtSale: c.barcodeAtSale
        }
      })),
      platform: effectivePlatform,
      taxSettings,
      deliveryFee: deliveryFeeNumber,
      bnplEnabled: isPlatformMode ? posBnplEnabled : false,
      bnplPercentOverrideVal: parsedBnplOverride,
      platformDiscountPercent: discPercent
    });
  }, [
    saleMode,
    cart,
    selectedPlatform,
    effectivePlatform,
    taxSettings,
    deliveryFeeNumber,
    posBnplEnabled,
    isBnplPercentOverridden,
    posBnplPercentInput,
    isCommissionPercentOverridden,
    posCommissionPercentInput
  ]);

  const totalBeforeDiscount = invoiceSummaryCalc.totalBeforeDiscount;
  const totalBnpl = invoiceSummaryCalc.totalBnpl;
  const totalDiscount = invoiceSummaryCalc.totalDiscount;
  const totalPickup = invoiceSummaryCalc.totalPickupFee;
  const totalTax = invoiceSummaryCalc.totalTax;
  const netBeforeDelivery = invoiceSummaryCalc.netBeforeDelivery;
  const netAmount = invoiceSummaryCalc.netAmount;
  const totalProfit: number | undefined = isManager && canViewProfit ? invoiceSummaryCalc.totalProfit : undefined;

  const normalizedCashPaidInput = useMemo(() => {
    if (!canEditCashPaid) return netAmount;
    const parsed = parseFloat(paidAmountInput);
    if (!isNaN(parsed) && parsed >= 0) {
      return Math.round(parsed * 100) / 100;
    }
    if (isManualCashOverride) return 0;
    return autoFillCashPaid ? netAmount : 0;
  }, [canEditCashPaid, paidAmountInput, netAmount, isManualCashOverride, autoFillCashPaid]);

  const isDirectPartialPayment =
    saleMode === 'customer' &&
    !isOffline &&
    !isCodDelivery &&
    paymentType === 'نقدي' &&
    canEditCashPaid &&
    netAmount > 0 &&
    normalizedCashPaidInput > 0 &&
    normalizedCashPaidInput < netAmount - 0.005;

  // حساب المقبوض والمتبقي بناءً على طريقة التحصيل المختارة والمبلغ المدفوع
  const effectivePaidAmount = useMemo(() => {
    if (isCodDelivery) return 0;
    if (paymentType === 'آجل') return 0;
    if (isDirectPartialPayment || paymentType === 'جزئي') {
      return Math.max(0, Math.min(normalizedCashPaidInput, netAmount));
    }
    return normalizedCashPaidInput;
  }, [isCodDelivery, paymentType, isDirectPartialPayment, normalizedCashPaidInput, netAmount]);

  const effectiveRemainingAmount = useMemo(() => {
    if (isCodDelivery) {
      return netAmount;
    }
    if (paymentType === 'آجل') {
      return creditPartyType === 'customer'
        ? Math.round((totalBeforeDiscount + deliveryFeeNumber) * 100) / 100
        : netAmount;
    }
    if (isDirectPartialPayment || paymentType === 'جزئي') {
      return Math.max(0, Math.round((netAmount - effectivePaidAmount) * 100) / 100);
    }
    return 0;
  }, [
    isCodDelivery,
    paymentType,
    creditPartyType,
    totalBeforeDiscount,
    deliveryFeeNumber,
    netAmount,
    isDirectPartialPayment,
    effectivePaidAmount
  ]);

  // تعبئة المدفوع النقدي تلقائيًا بالمطلوب وتحديثه ديناميكيًا مع تغييرات السلة
  useEffect(() => {
    if (paymentType === 'آجل') {
      setPaidAmountInput('0.00');
      return;
    }
    if (paymentType === 'نقدي') {
      // بدون صلاحية invoices.edit_cash_paid: يساوي الإجمالي دائمًا وللقراءة فقط
      if (!canEditCashPaid) {
        setPaidAmountInput(netAmount.toFixed(2));
        return;
      }
      // مع الصلاحية: عند التشغيل يمتلئ بالمطلوب ويتحدث تلقائيًا ما لم يعدّله المستخدم يدويًا، وعند الإيقاف يبدأ من 0.00
      if (!isManualCashOverride) {
        if (autoFillCashPaid) {
          setPaidAmountInput(netAmount.toFixed(2));
        } else {
          setPaidAmountInput('0.00');
        }
      }
    }
  }, [autoFillCashPaid, canEditCashPaid, paymentType, netAmount, isManualCashOverride]);

  // 2. البحث عن الأصناف المتاحة وتصفيتها بالتصنيف
  const catalogItems = useMemo(() => {
    let itemsInCat = posAvailableItems;

    if (selectedCategoryId === 'UNCATEGORIZED') {
      itemsInCat = posAvailableItems.filter(it => !it.categoryId);
    } else if (selectedCategoryId !== 'ALL' && currentCategory) {
      if (showDirectOnly) {
        itemsInCat = posAvailableItems.filter(it => it.categoryId === currentCategory.id);
      } else {
        const branchIds = getCategoryBranchIds(currentCategory.id);
        itemsInCat = posAvailableItems.filter(it => it.categoryId && branchIds.has(it.categoryId));
      }
    }

    const q = searchQuery.trim().toLowerCase();
    const normQ = normalizeArabicText(searchQuery);
    if (!q && !normQ) {
      return itemsInCat;
    }

    return itemsInCat.filter(it => {
      const nameMatch = it.name.toLowerCase().includes(q) || (normQ && normalizeArabicText(it.name).includes(normQ));
      const printNameMatch = Boolean(
        it.printName &&
          (it.printName.toLowerCase().includes(q) ||
            (normQ && normalizeArabicText(it.printName).includes(normQ)))
      );
      const notesMatch = it.notes && it.notes.toLowerCase().includes(q);
      const supplierMatch = it.supplier && it.supplier.toLowerCase().includes(q);
      const barcodeMatch = it.barcode && it.barcode.toLowerCase().includes(q);
      const secBarcodeMatch = it.secondaryBarcodes && it.secondaryBarcodes.some(b => b.toLowerCase().includes(q));
      return nameMatch || printNameMatch || notesMatch || supplierMatch || barcodeMatch || secBarcodeMatch;
    });
  }, [posAvailableItems, selectedCategoryId, currentCategory, showDirectOnly, getCategoryBranchIds, searchQuery]);

  // حفظ تلقائي لمسودة الفاتورة المفتوحة في localStorage لكل مستخدم مع كل تغيير
  useEffect(() => {
    if (!isDraftReady || pendingDraftPrompt) return;
    if (cart.length === 0) {
      clearPosDraft(draftStorageKey);
      return;
    }
    writePosDraft(draftStorageKey, {
      version: 1,
      savedAt: new Date().toISOString(),
      saleMode,
      selectedWarehouseId: selectedWarehouseId || undefined,
      selectedPlatformId: selectedPlatform?.id || selectedPlatformId,
      selectedCustomerId,
      selectedCashboxId,
      paymentType,
      creditPartyType,
      deliveryFee,
      notes,
      platformOrderId,
      paidAmountInput,
      isManualCashOverride,
      posBnplEnabled,
      posBnplPercentInput,
      isBnplPercentOverridden,
      posCommissionPercentInput,
      isCommissionPercentOverridden,
      idempotencyKey: idempotencyKeyRef.current,
      cart,
      ...(saleMode === 'customer' && isDeliveryEnabled
        ? {
            isDeliveryEnabled: true,
            deliveryPaymentMode,
            deliveryZoneId,
            deliveryAddress,
            deliveryPhone,
            deliveryOrderFeeInput,
            deliveryFeeManual,
            deliveryAssigneeType,
            deliveryAssigneeId,
            deliveryTrackingNumber
          }
        : {})
    });
  }, [
    isDraftReady,
    pendingDraftPrompt,
    draftStorageKey,
    saleMode,
    cart,
    selectedWarehouseId,
    selectedPlatform?.id,
    selectedPlatformId,
    selectedCustomerId,
    selectedCashboxId,
    paymentType,
    creditPartyType,
    deliveryFee,
    notes,
    platformOrderId,
    paidAmountInput,
    isManualCashOverride,
    posBnplEnabled,
    posBnplPercentInput,
    isBnplPercentOverridden,
    posCommissionPercentInput,
    isCommissionPercentOverridden,
    isDeliveryEnabled,
    deliveryPaymentMode,
    deliveryZoneId,
    deliveryAddress,
    deliveryPhone,
    deliveryOrderFeeInput,
    deliveryFeeManual,
    deliveryAssigneeType,
    deliveryAssigneeId,
    deliveryTrackingNumber
  ]);

  // تسجيل تغييرات الفاتورة المفتوحة في سجل الأصناف غير المباعة (في الخلفية بصمت)
  useEffect(() => {
    if (!isDraftReady || pendingDraftPrompt) return;
    try {
      getCartJournal().syncCart(
        cart.map(c => ({
          itemId: c.item.id,
          name: c.item.name,
          barcode: c.barcodeAtSale || c.item.barcode || '',
          unitPrice: c.baseUnitPrice !== undefined ? c.baseUnitPrice : c.salePriceAtSale,
          quantity: c.quantity
        })),
        {
          warehouseId: selectedWarehouseId || undefined,
          warehouseName: selectedWarehouse?.name || undefined,
          platform: saleMode === 'platform' ? (selectedPlatform?.name || 'البيع المباشر') : 'البيع المباشر'
        }
      );
    } catch {
      // يعمل في الخلفية بصمت ولا يؤثر على شاشة البيع
    }
  }, [
    isDraftReady,
    pendingDraftPrompt,
    cart,
    selectedWarehouseId,
    selectedWarehouse?.name,
    saleMode,
    selectedPlatform?.name
  ]);

  // التحقق من تجاوز أي سطر للمخزون المتاح عند حظر البيع بالسالب (البيع بالسالب مسموح دائماً أوفلاين)
  const hasStockExceeded = !effectiveAllowNegativeStock && cart.some(c => c.quantity > c.item.stockQuantity);

  // حفظ الفاتورة (printMode: 'print' لحفظ وطباعة، و 'no_print' لحفظ فقط بدون طباعة)
  const handleCheckout = async (printMode: 'print' | 'no_print' = 'print') => {
    if (isSubmitting || isSubmittingRef.current) return;

    if (isOffline && !hasOfflineLockOwnership()) {
      const snap = await recheckOfflineLock();
      if (!snap.hasOwnership) {
        setErrorMsg(
          snap.reason ||
            offlineLockReason ||
            'الوضع الأوفلاين نشط في تبويب آخر على هذا المتصفح. البيع أوفلاين متاح في تبويب واحد فقط.'
        );
        return;
      }
    }

    setPlatformFieldError(false);
    setCustomerFieldError(false);
    setPlatformOrderError(false);
    setDeliveryAddressError(false);
    setDeliveryZoneError(false);
    setPriceViolatingItemIds(new Set());

    if (cart.length === 0) {
      setErrorMsg('سلة البيع فارغة، يرجى إضافة أصناف أولاً');
      return;
    }

    if (!effectiveAllowPlatformSale && !effectiveAllowDirectSale) {
      setErrorMsg('البيع على منصة والبيع المباشر للعميل معطلان حاليًا من إعدادات البيع؛ فعّل وضع بيع واحد على الأقل أولًا');
      return;
    }

    if (saleMode === 'platform' && !effectiveAllowPlatformSale) {
      setErrorMsg(
        !effectivePlatformsEnabled
          ? 'مبيعات ووظائف المنصات معطلة حاليًا من إعدادات النظام؛ لا يمكن حفظ فاتورة منصة'
          : 'البيع على منصة معطّل حاليًا من إعدادات البيع؛ لا يمكن حفظ فاتورة منصة'
      );
      return;
    }

    if (saleMode === 'customer' && !effectiveAllowDirectSale) {
      setErrorMsg('البيع المباشر للعميل معطّل حاليًا من إعدادات البيع؛ لا يمكن حفظ فاتورة بيع مباشر');
      return;
    }

    const isPlatformSale = saleMode === 'platform';
    const effectiveCreditPartyType: 'customer' | 'platform' = isPlatformSale ? 'platform' : 'customer';

    if (isPlatformSale && activePlatforms.length === 0) {
      setPlatformFieldError(true);
      setErrorMsg('لا توجد أي منصة نشطة متاحة لإتمام البيع على منصة؛ يرجى إضافة أو تفعيل منصة أولًا');
      return;
    }

    if (!isPlatformSale && isDeliveryEnabled && isOffline) {
      setErrorMsg('إنشاء فاتورة توصيل متاح عند رجوع الاتصال فقط');
      return;
    }

    const activeDeliveryOrder = !isPlatformSale && isDeliveryOrderActive;
    const activeCodDelivery = activeDeliveryOrder && deliveryPaymentMode === 'cod';

    if (
      isPlatformSale &&
      salesRules.platformAlwaysCredit &&
      (paymentType !== 'آجل' || creditPartyType !== 'platform')
    ) {
      setPaymentType('آجل');
      setCreditPartyType('platform');
      setErrorMsg('بيع المنصات آجل فقط حسب إعدادات البيع');
      return;
    }

    // 1. فحص إلزامية اختيار المنصة أو العميل قبل الإرسال
    if (isPlatformSale && !selectedPlatform?.id) {
      setPlatformFieldError(true);
      setErrorMsg('اختر المنصة أولًا');
      return;
    }
    if (!isPlatformSale && effectiveCustomerSelection === 'manual' && !selectedCustomerId) {
      setCustomerFieldError(true);
      setErrorMsg('اختر العميل أولًا');
      return;
    }

    // 1.5 فحص بيانات التوصيل الإلزامية قبل الإرسال (مع بقاء السيرفر المرجع النهائي)
    if (activeDeliveryOrder) {
      if (deliveryConfig?.settings.zonePricing && !selectedDeliveryZone) {
        setDeliveryZoneError(true);
        setErrorMsg('اختار منطقة التوصيل');
        return;
      }
      if (!deliveryAddress.trim()) {
        setDeliveryAddressError(true);
        setErrorMsg('اكتب عنوان التوصيل');
        return;
      }
      if (
        deliveryConfig?.settings.zonePricing &&
        selectedDeliveryZone &&
        selectedDeliveryZone.minOrderValue > 0 &&
        totalBeforeDiscount + 0.001 < selectedDeliveryZone.minOrderValue
      ) {
        setErrorMsg(
          `أقل قيمة طلب لمنطقة «${selectedDeliveryZone.name}» هي ${selectedDeliveryZone.minOrderValue} ج.م (الطلب ${totalBeforeDiscount.toFixed(2)} ج.م)`
        );
        return;
      }
      if (deliveryAssigneeType && !deliveryAssigneeId) {
        setErrorMsg(
          deliveryAssigneeType === 'driver'
            ? 'اختر الطيار أو اترك التعيين بدون تحديد'
            : 'اختر شركة الشحن أو اترك التعيين بدون تحديد'
        );
        return;
      }
    }

    // 2. فحص قواعد السعر (السعر صفر / أقل من الشراء) لمن لا يملك صلاحية prices.override_min_price
    if (!canOverrideMinPrice) {
      for (const c of cart) {
        const unitDiscount = isPlatformSale ? (Number(c.unitDiscountValue) || 0) : 0;
        const rawBase = Number(c.baseUnitPrice ?? c.salePriceAtSale) || 0;
        const unitPriceAfterDiscount = Math.round(Math.max(0, rawBase - unitDiscount) * 100) / 100;

        if (unitPriceAfterDiscount <= 0 && !salesRules.allowZeroPriceSale) {
          setPriceViolatingItemIds(new Set([c.item.id]));
          setErrorMsg(`سعر الصنف «${c.item.name}» صفر — إعدادات البيع تمنع ذلك`);
          return;
        }

        if (
          (canViewCosts || canViewProfit) &&
          Number(c.item.purchasePrice) > 0 &&
          unitPriceAfterDiscount < Number(c.item.purchasePrice) &&
          !salesRules.allowBelowCostSale
        ) {
          setPriceViolatingItemIds(new Set([c.item.id]));
          setErrorMsg(
            `سعر البيع للصنف «${c.item.name}» (${unitPriceAfterDiscount.toFixed(2)} ج.م) أقل من سعر الشراء (${Number(c.item.purchasePrice).toFixed(2)} ج.م)`
          );
          return;
        }
      }
    }

    // أمر تجهيز التوصيل: مع تفعيل «توصيل» الحفظ بيعمل أمر تجهيز مش فاتورة.
    // الفاتورة وخصم المخزون وتسجيل الفلوس بيحصلوا عند الشحن من صفحة «أوامر التجهيز».
    if (activeDeliveryOrder) {
      if (!selectedCustomerId) {
        setCustomerFieldError(true);
        setErrorMsg('اختر العميل أولًا لعمل أمر تجهيز التوصيل');
        return;
      }
      // السيرفر بيسجل أمر التجهيز بسعر الصنف المسجل، فالسعر المعدّل في السلة ما يتنقلش من غير ما المستخدم يعرف
      const editedPriceLine = cart.find(
        c => Math.abs((Number(c.baseUnitPrice) || 0) - (Number(c.item.salePrice) || 0)) > 0.005
      );
      if (editedPriceLine) {
        setPriceViolatingItemIds(new Set([editedPriceLine.item.id]));
        setErrorMsg(
          `أمر التجهيز بيتسجل بسعر الصنف المسجل. رجّع سعر «${editedPriceLine.item.name}» لسعره الأصلي أو عدّل سعر الصنف نفسه`
        );
        return;
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setErrorMsg(null);
      setIsUnknownResultError(false);
      try {
        const prepRes = await api.createDeliveryPreparationOrder({
          idempotencyKey: idempotencyKeyRef.current,
          customerId: selectedCustomerId,
          paymentMode: deliveryPaymentMode,
          address: deliveryAddress.trim(),
          ...(deliveryPhone.trim() ? { phone: deliveryPhone.trim() } : {}),
          ...(deliveryConfig?.settings.zonePricing && selectedDeliveryZone
            ? { zoneId: selectedDeliveryZone.id }
            : {}),
          ...(canEditDeliveryFee && deliveryFeeManual ? { fee: effectiveDeliveryOrderFee } : {}),
          ...(deliveryAssigneeType && deliveryAssigneeId
            ? {
                assigneeType: deliveryAssigneeType,
                assigneeId: deliveryAssigneeId,
                ...(deliveryAssigneeType === 'courier' && deliveryTrackingNumber.trim()
                  ? { trackingNumber: deliveryTrackingNumber.trim() }
                  : {})
              }
            : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          lines: cart.map(c => ({ itemId: c.item.id, quantity: c.quantity }))
        });
        const prepOrder = prepRes.order;
        const prepSlipSettings = deliveryConfig?.settings?.prepSlip;

        try {
          getCartJournal().cartSaved();
        } catch {
          // تجاهل أي خطأ في السجل حتى لا يتعطل الحفظ
        }
        clearPosDraft(draftStorageKey);
        idempotencyKeyRef.current = generateIdempotencyKey();

        setCart([]);
        setDeliveryFee(0);
        setNotes('');
        resetDeliveryOrderState();
        setIsManualCashOverride(false);
        setPaidAmountInput('0.00');
        setPaymentType('نقدي');
        setCreditPartyType('customer');
        setSelectedCustomerId(resolveDefaultCustomerId(salesRules, customers));
        setCustomerFieldError(false);
        setPriceViolatingItemIds(new Set());
        setActiveMobileTab('invoice');
        mobileTabScrollRef.current.invoice = 0;

        if (addedItemToastTimerRef.current) {
          clearTimeout(addedItemToastTimerRef.current);
        }
        setAddedItemToast(`تم حفظ أمر التجهيز ${prepOrder.number}`);
        addedItemToastTimerRef.current = setTimeout(() => {
          setAddedItemToast(null);
        }, 4000);

        // بون التجهيز: يتطبع مع «حفظ وطباعة» بس، ولو مفعّل من إعدادات التوصيل
        if (printMode !== 'no_print' && prepSlipSettings?.enabled) {
          void printDeliveryPrepSlip(buildPrepSlipData(prepOrder), {
            settings: prepSlipSettings,
            paperSize: invoicePrintSettings?.paperSize,
            printableWidthMm: invoicePrintSettings?.printableWidthMm
          }).catch(() => {
            setErrorMsg(`اتحفظ أمر التجهيز ${prepOrder.number} لكن تعذرت طباعة البون. اطبعه من صفحة «أوامر التجهيز»`);
          });
        }

        setTimeout(() => {
          const barcodeInput = document.getElementById('pos-barcode-input');
          barcodeInput?.focus();
        }, 100);
      } catch (err: any) {
        setErrorMsg(prepErrorText(err, 'تعذر حفظ أمر تجهيز التوصيل، يرجى مراجعة الاتصال والمحاولة مرة أخرى'));
        setIsUnknownResultError(err?.code === 'UNKNOWN_RESULT');
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
      return;
    }

    const resolvedDirectOrFallbackPaymentType: 'نقدي' | 'آجل' | 'جزئي' = activeCodDelivery
      ? 'آجل'
      : !isPlatformSale && isDirectPartialPayment
      ? 'جزئي'
      : paymentType;

    if (isOffline) {
      if (paymentType === 'جزئي' || (!isPlatformSale && paymentType === 'نقدي' && netAmount > 0 && normalizedCashPaidInput < netAmount - 0.005)) {
        setErrorMsg('الدفع الجزئي غير متاح بدون إنترنت (متاح عند رجوع الاتصال)');
        return;
      }
      if (paymentType === 'آجل' && !isPlatformSale) {
        setErrorMsg('آجل العميل غير متاح بدون إنترنت (متاح عند رجوع الاتصال)');
        return;
      }
    }

    if (!effectiveAllowNegativeStock) {
      for (const c of cart) {
        if (c.quantity > c.item.stockQuantity) {
          setErrorMsg(`الكمية لا تكفي. المتاح: ${c.item.stockQuantity} من "${c.item.name}"`);
          return;
        }
      }
    }

    if (!activeCodDelivery) {
      if (resolvedDirectOrFallbackPaymentType === 'آجل') {
        if (!isPlatformSale && !selectedCustomerId) {
          setCustomerFieldError(true);
          setErrorMsg('يجب اختيار العميل لإصدار فاتورة آجلة على عميل');
          return;
        }
        if (isPlatformSale && !selectedPlatform?.id) {
          setPlatformFieldError(true);
          setErrorMsg('يجب اختيار المنصة لإصدار فاتورة آجلة على منصة');
          return;
        }
      } else if (resolvedDirectOrFallbackPaymentType === 'جزئي' && (isPlatformSale || !selectedCustomerId)) {
        if (!isPlatformSale && !selectedCustomerId) {
          setCustomerFieldError(true);
        }
        setErrorMsg(
          isPlatformSale
            ? 'البيع الجزئي متاح في وضع بيع لعميل فقط'
            : 'يجب اختيار العميل لتسجيل المديونية المستحقة على حسابه عند دفع جزء من الفاتورة'
        );
        return;
      } else if (!isPlatformSale && resolvedDirectOrFallbackPaymentType === 'نقدي' && netAmount > 0 && normalizedCashPaidInput <= 0) {
        setErrorMsg('أدخل المبلغ المدفوع نقدًا أو اختر «آجل» لتسجيل الفاتورة على حساب العميل');
        return;
      }

      if ((resolvedDirectOrFallbackPaymentType === 'نقدي' || (resolvedDirectOrFallbackPaymentType === 'جزئي' && effectivePaidAmount > 0)) && !selectedCashboxId) {
        setErrorMsg('يجب اختيار خزينة التحصيل لإيداع المبلغ المقبوض نقدًا');
        return;
      }
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMsg(null);
    setIsUnknownResultError(false);

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const idempotencyKey = idempotencyKeyRef.current;

    try {
      const appliedCommPercent = isPlatformSale
        ? (isCommissionPercentOverridden && posCommissionPercentInput !== ''
            ? Number(posCommissionPercentInput)
            : Number(selectedPlatform?.discountPercentage || 0))
        : 0;

      const deliveryPayload: CreateInvoiceDeliveryPayload | undefined = activeDeliveryOrder
        ? {
            paymentMode: deliveryPaymentMode,
            address: deliveryAddress.trim(),
            ...(deliveryPhone.trim() ? { phone: deliveryPhone.trim() } : {}),
            ...(deliveryConfig?.settings.zonePricing && selectedDeliveryZone
              ? { zoneId: selectedDeliveryZone.id }
              : {}),
            ...(canEditDeliveryFee && deliveryFeeManual ? { fee: effectiveDeliveryOrderFee } : {}),
            ...(deliveryAssigneeType && deliveryAssigneeId
              ? {
                  assigneeType: deliveryAssigneeType,
                  assigneeId: deliveryAssigneeId,
                  ...(deliveryAssigneeType === 'courier' && deliveryTrackingNumber.trim()
                    ? { trackingNumber: deliveryTrackingNumber.trim() }
                    : {})
                }
              : {})
          }
        : undefined;

      const resolvedPaymentType: 'نقدي' | 'آجل' | 'جزئي' = resolvedDirectOrFallbackPaymentType;
      const resolvedCreditPartyType: 'customer' | 'platform' | 'delivery' | undefined = activeCodDelivery
        ? 'delivery'
        : resolvedPaymentType === 'آجل'
        ? effectiveCreditPartyType
        : undefined;

      const invoicePayload = {
        requestId,
        idempotencyKey,
        cartId: getCartJournal().currentCartId(),
        warehouseId: selectedWarehouseId || undefined,
        warehouseName: selectedWarehouse?.name || undefined,
        platformId: isPlatformSale ? selectedPlatform?.id : undefined,
        platformName: isPlatformSale ? (selectedPlatform?.name || 'البيع المباشر') : 'البيع المباشر',
        platformOrderId: isPlatformSale ? platformOrderId.trim() : undefined,
        platformDiscountPercentage: appliedCommPercent,
        bnplEnabled: isPlatformSale ? posBnplEnabled : false,
        bnplPercentOverride: isPlatformSale && isBnplPercentOverridden && posBnplPercentInput !== '' ? Number(posBnplPercentInput) : undefined,
        commissionPercentOverride: isPlatformSale && isCommissionPercentOverridden && posCommissionPercentInput !== '' ? Number(posCommissionPercentInput) : undefined,
        paymentType: resolvedPaymentType,
        creditPartyType: resolvedCreditPartyType,
        creditPartyId: activeCodDelivery
          ? undefined
          : resolvedPaymentType === 'آجل'
          ? (isPlatformSale ? selectedPlatform?.id : selectedCustomerId)
          : undefined,
        creditDueAmount: activeCodDelivery
          ? netAmount
          : resolvedPaymentType === 'آجل'
          ? effectiveRemainingAmount
          : undefined,
        paidAmount: activeCodDelivery ? 0 : effectivePaidAmount,
        remainingAmount: activeCodDelivery ? netAmount : effectiveRemainingAmount,
        paymentStatus: activeCodDelivery
          ? 'آجل'
          : resolvedPaymentType === 'آجل'
          ? 'آجل'
          : (effectiveRemainingAmount === 0 ? 'مدفوع بالكامل' : (effectivePaidAmount > 0 ? 'مدفوع جزئياً' : 'آجل')),
        cashboxId: activeCodDelivery
          ? undefined
          : (resolvedPaymentType === 'نقدي' || (resolvedPaymentType === 'جزئي' && effectivePaidAmount > 0))
          ? (selectedCashboxId || undefined)
          : undefined,
        customerId: isPlatformSale ? undefined : (selectedCustomerId || undefined),
        totalBeforeDiscount,
        bnplTotalAmount: isPlatformSale ? totalBnpl : 0,
        discountAmount: isPlatformSale ? totalDiscount : 0,
        pickupFeeAmount: isPlatformSale ? totalPickup : 0,
        deliveryFee: activeDeliveryOrder
          ? Math.round(effectiveDeliveryOrderFee * 100) / 100
          : isPlatformSale && isDeliveryFeeEnabled
          ? (Math.round(deliveryFeeNumber * 100) / 100)
          : 0,
        ...(deliveryPayload ? { delivery: deliveryPayload } : {}),
        taxAmount: totalTax,
        netAmount,
        notes: notes.trim(),
        lines: cart.map(c => ({
          itemId: c.item.id,
          itemNameAtSale: c.item.name,
          barcodeAtSale: c.barcodeAtSale || c.item.barcode || '',
          quantity: c.quantity,
          salePriceAtSale: c.baseUnitPrice,
          baseUnitPrice: c.baseUnitPrice,
          customerUnitPrice: c.customerUnitPrice,
          bnplPercent: isPlatformSale ? c.bnplPercent : 0,
          bnplUnitAmount: isPlatformSale ? c.bnplUnitAmount : 0,
          totalBnplAmount: isPlatformSale ? c.bnplUnitAmount * c.quantity : 0,
          bnplDeductionUnit: isPlatformSale ? c.bnplDeductionUnit : 0,
          totalBnplDeduction: isPlatformSale ? c.bnplDeductionUnit * c.quantity : 0,
          purchasePriceAtSale: canViewProfit ? c.item.purchasePrice : undefined,
          packagingCostAtSale: canViewProfit ? c.item.packagingCost : undefined,
          taxRateAtSale: c.taxRateAtSale,
          unitTaxAmount: c.unitTaxAmount,
          platformDiscountPercentAtSale: isPlatformSale ? c.platformDiscountPercent : 0,
          unitDiscountValue: isPlatformSale ? c.unitDiscountValue : 0,
          unitPickupFee: isPlatformSale ? c.unitPickupFee : 0,
          totalPickupFee: isPlatformSale ? c.unitPickupFee * c.quantity : 0,
          unitNet: c.unitNet,
          unitProfit: c.unitProfit
        }))
      };

      const created = await onCreateInvoice(invoicePayload);
      try {
        getCartJournal().cartSaved();
      } catch {
        // تجاهل أي خطأ في السجل حتى لا يتعطل الحفظ
      }
      clearPosDraft(draftStorageKey);
      idempotencyKeyRef.current = generateIdempotencyKey();

      // تحديث المخزون والخزينة المحلية في حالة POS فوراً (خاصة عند البيع بدون إنترنت)
      if (isOffline) {
        setLocalItemsFallback(prev =>
          prev.map(p => {
            const matchingLine = (created.lines || []).find(l => l.itemId === p.id);
            if (matchingLine) {
              return {
                ...p,
                stockQuantity: p.stockQuantity - matchingLine.quantity
              };
            }
            return p;
          })
        );
        if (paymentType === 'نقدي' && selectedCashboxId) {
          setCashboxes(prev =>
            prev.map(cb =>
              cb.id === selectedCashboxId
                ? { ...cb, currentBalance: Math.round(((cb.currentBalance || 0) + created.netAmount) * 100) / 100 }
                : cb
            )
          );
        }
      } else if (selectedWarehouseId) {
        void loadWarehouseStock(selectedWarehouseId);
      }

      // حساب الباقي للعميل من القيمة المكتوبة بخانة المدفوع قبل مسحها (في COD لا يوجد تحصيل نقدي فوري ولا ترحيل على رصيد العميل)
      const parsedCash = parseFloat(paidAmountInput);
      const changeGiven =
        !activeCodDelivery && !isNaN(parsedCash) && parsedCash > netAmount
          ? (parsedCash - netAmount)
          : undefined;
      const currentCustomer = isPlatformSale ? undefined : customers.find(c => c.id === selectedCustomerId);
      let customerBalanceAfter: number | undefined = undefined;
      if (currentCustomer) {
        customerBalanceAfter = activeCodDelivery
          ? (currentCustomer.currentBalance || 0)
          : (currentCustomer.currentBalance || 0) + (effectiveRemainingAmount || 0);
      }

      const nextDefaultPlatformId = resolveDefaultPlatformId(salesRules, activePlatforms);
      const nextDefaultCustomerId = resolveDefaultCustomerId(salesRules, customers);
      const nextDefaultPlatform = nextDefaultPlatformId
        ? activePlatforms.find(p => p.id === nextDefaultPlatformId)
        : undefined;

      setCart([]);
      setDeliveryFee(0);
      setNotes('');
      setPlatformOrderId('');
      setPlatformOrderError(false);
      resetDeliveryOrderState();
      setIsManualCashOverride(false);
      setPaidAmountInput('0.00');
      if (isPlatformSale && salesRules.platformAlwaysCredit) {
        setPaymentType('آجل');
        setCreditPartyType('platform');
      } else {
        setPaymentType('نقدي');
        setCreditPartyType(isPlatformSale ? 'platform' : 'customer');
      }
      setSelectedPlatformId(nextDefaultPlatformId);
      setSelectedCustomerId(nextDefaultCustomerId);
      setPosBnplEnabled(Boolean(nextDefaultPlatform?.enableBnpl));
      setPosBnplPercentInput(Number(nextDefaultPlatform?.bnplPercentage || 0));
      setIsBnplPercentOverridden(false);
      setPosCommissionPercentInput(Number(nextDefaultPlatform?.discountPercentage || 0));
      setIsCommissionPercentOverridden(false);
      setPlatformFieldError(false);
      setCustomerFieldError(false);
      setPriceViolatingItemIds(new Set());
      // بعد حفظ الفاتورة: تفريغها والبقاء في تبويب «الفاتورة» على الموبايل
      setActiveMobileTab('invoice');
      mobileTabScrollRef.current.invoice = 0;
      onInvoiceCreated(created, {
        changeGiven,
        customerBalanceAfter,
        shouldPrint: printMode !== 'no_print'
      });

      // إعادة الـ focus لخانة الباركود فوراً
      setTimeout(() => {
        const barcodeInput = document.getElementById('pos-barcode-input');
        barcodeInput?.focus();
      }, 100);
    } catch (err: any) {
      if (err?.code === 'PLATFORM_ORDER_DUPLICATE') {
        setPlatformOrderError(true);
      }
      setErrorMsg(err.message || 'فشل حفظ الفاتورة، يرجى مراجعة الاتصال والكميات');
      setIsUnknownResultError(err?.code === 'UNKNOWN_RESULT');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const totalCartPieces = useMemo(() => {
    return cart.reduce((sum, c) => sum + c.quantity, 0);
  }, [cart]);

  if (ambiguousTabBlockReason) {
    return (
      <div className="flex flex-col items-center justify-center w-full py-12 px-4" dir="rtl">
        <div
          role="alert"
          data-testid="pos-ambiguous-tab-blocked"
          className="max-w-xl w-full bg-white rounded-3xl border-2 border-rose-300 shadow-lg p-6 text-right space-y-4"
        >
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-extrabold text-rose-950">
                تم إيقاف شاشة البيع في هذا التبويب لمنع تضارب الهوية
              </h2>
              <p className="text-xs font-bold text-slate-700 leading-relaxed">
                {ambiguousTabBlockReason}
              </p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-xs font-bold text-amber-950 leading-relaxed">
            جميع المسودات المحفوظة في المتصفح باقية كما هي ولم يتم حذف أي منها. يمكنك بدء جلسة بيع مستقلة بهوية جديدة في هذا التبويب أو الانتقال إلى أي صفحة أخرى في البرنامج.
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {onNavigateMain && (
              <a
                href={getHrefForTarget('dashboard')}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return;
                  e.preventDefault();
                  onNavigateMain('dashboard');
                }}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                الانتقال للوحة التحكم
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                void forceFreshTabIdentity().then((freshId) => {
                  idempotencyKeyRef.current = generateIdempotencyKey();
                  setAmbiguousTabBlockReason(null);
                  setTabId(freshId);
                });
              }}
              className="px-5 py-2.5 rounded-xl bg-[#1668B2] hover:bg-[#125594] text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
            >
              بدء جلسة بيع بهوية مستقلة جديدة
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col w-full max-w-full overflow-x-clip ${
        activeMobileTab === 'products' ? 'pb-36' : 'pb-24'
      } md:pb-0`}
      dir="rtl"
    >
      
      {/* 1. شاشة البيع: صفحة متكاملة بدون أي scroll داخلي والصفحة كلها تعمل scroll مع بعض */}
      <div
        ref={posActiveScreenRef}
        className={`${activeMobileTab === 'history' ? 'hidden md:flex' : 'flex'} flex-col w-full mb-2 md:mb-6`}
      >
        {unmigratedLegacyDraft && !pendingDraftPrompt && (
          <div
            role="status"
            data-testid="pos-preserved-legacy-draft-banner"
            className="mb-3 p-3 rounded-2xl bg-cyan-50 border border-cyan-300 flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <div className="flex items-center gap-2 font-bold text-cyan-950">
              <Receipt className="w-4 h-4 text-cyan-700 shrink-0" />
              <span>
                توجد مسودة فاتورة قديمة محفوظة ({unmigratedLegacyDraft.cart.length} صنف). لم يتم نقلها تلقائيًا لأن المتصفح لا يدعم Web Locks. لاستعادتها بأمان، تأكد من عدم فتح شاشة البيع في تبويب آخر ثم اضغط «مراجعة واستعادة المسودة».
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleOpenManualLegacyDraftPrompt}
                className="px-3 py-1.5 rounded-xl bg-cyan-700 hover:bg-cyan-800 text-white font-extrabold text-[11px] cursor-pointer transition"
              >
                مراجعة واستعادة المسودة
              </button>
              <button
                type="button"
                onClick={() => setUnmigratedLegacyDraft(null)}
                className="px-2.5 py-1.5 rounded-xl border border-cyan-300 hover:bg-cyan-100 text-cyan-900 font-bold text-[11px] cursor-pointer transition"
              >
                إخفاء الآن
              </button>
            </div>
          </div>
        )}

        {cartJournalStatus.type !== 'ok' && cartJournalStatus.message && (
          <div
            role="status"
            data-testid="pos-cart-journal-status-banner"
            className="mb-3 p-3 rounded-2xl bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <div className="flex items-center gap-2 font-bold text-amber-950">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>{cartJournalStatus.message}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {cartJournalStatus.type === 'legacy_pending_preserved' ? (
                <button
                  type="button"
                  onClick={() => {
                    void getCartJournal().flushLegacyPendingQueue().catch(() => undefined);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-[11px] cursor-pointer transition"
                >
                  رفع الأحداث المحفوظة الآن
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void getCartJournal().flush().catch(() => undefined);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-[11px] cursor-pointer transition"
                >
                  إعادة محاولة رفع السجل
                </button>
              )}
            </div>
          </div>
        )}
        
        {/* شريط الأدوات العلوي */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-700">شاشة البيع ونقاط البيع المباشرة</span>
            {(isOffline || offlineLastSyncAt || localLastSyncAt) && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-900">
                <span>
                  آخر تحديث:{' '}
                  {(() => {
                    const syncIso = offlineLastSyncAt || localLastSyncAt;
                    if (!syncIso) return 'غير متوفر';
                    const d = new Date(syncIso);
                    if (isNaN(d.getTime())) return syncIso;
                    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
                  })()}
                </span>
              </span>
            )}
          </div>

          {/* أزرار شكل الشاشة وملء الشاشة والسجل */}
          <div className="flex items-center gap-2">
            {/* زر شكل الشاشة لمن يملك صلاحية settings.ui_scale */}
            {canManageUiScale && (
              <div ref={uiAppearanceMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (isUiAppearanceOpen) {
                      handleCancelPosUiPrefs();
                    } else {
                      setPosUiPrefs(readUiPrefs());
                      setDraftSharedDisplay({
                        showItemImages: displaySettings?.showItemImages !== false,
                        posLayout: displaySettings?.posLayout === 'list' ? 'list' : 'grid',
                        posVisibleCategoryIds: Array.isArray(displaySettings?.posVisibleCategoryIds)
                          ? displaySettings.posVisibleCategoryIds
                          : []
                      });
                      setIsUiAppearanceOpen(true);
                    }
                  }}
                  aria-expanded={isUiAppearanceOpen}
                  data-testid="pos-ui-appearance-btn"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] md:min-h-0 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-bold text-slate-700 transition cursor-pointer shadow-2xs shrink-0"
                  title="شكل الشاشة"
                >
                  <Sliders className="w-3.5 h-3.5 text-slate-800" />
                  <span>شكل الشاشة</span>
                </button>

                {isUiAppearanceOpen && (
                  <div
                    dir="rtl"
                    data-testid="pos-ui-appearance-popover"
                    className="absolute left-0 mt-1.5 z-50 w-72 sm:w-80 max-w-[calc(92vw/var(--app-zoom,1))] max-h-[82vh] overflow-y-auto custom-scrollbar rounded-2xl bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border-color)] shadow-xl p-3.5 space-y-3 text-xs"
                  >
                    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
                      <span className="font-extrabold text-[var(--text-primary)]">شكل الشاشة (لهذا الجهاز)</span>
                      <button
                        type="button"
                        onClick={handleCancelPosUiPrefs}
                        className="p-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                        aria-label="إغلاق"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* حجم نقطة البيع */}
                    <div className="space-y-1">
                      <div className="font-bold text-[11px] text-[var(--text-secondary)]">حجم نقطة البيع</div>
                      <div className="flex flex-wrap items-center gap-1">
                        {UI_SCALE_OPTIONS.map((sc) => (
                          <button
                            key={sc}
                            type="button"
                            onClick={() => updatePosUiPref({ posScale: sc })}
                            className={`px-2 py-1 rounded-lg font-mono font-bold text-[11px] border transition cursor-pointer ${
                              posUiPrefs.posScale === sc
                                ? 'bg-[#1668B2] border-[#1668B2] text-white'
                                : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                            }`}
                          >
                            {formatScale(sc)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* عرض لوحة الفاتورة */}
                    <div className="space-y-1">
                      <div className="font-bold text-[11px] text-[var(--text-secondary)]">عرض لوحة الفاتورة</div>
                      <div className="grid grid-cols-3 gap-1">
                        {(['narrow', 'medium', 'wide'] as PosPanelWidth[]).map((wKey) => (
                          <button
                            key={wKey}
                            type="button"
                            onClick={() => updatePosUiPref({ posPanelWidth: wKey })}
                            className={`py-1.5 rounded-lg font-bold text-[11px] border transition cursor-pointer ${
                              posUiPrefs.posPanelWidth === wKey
                                ? 'bg-[#1668B2] border-[#1668B2] text-white'
                                : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                            }`}
                          >
                            {POS_PANEL_WIDTH_LABELS[wKey]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* حجم الكروت */}
                    <div className="space-y-1">
                      <div className="font-bold text-[11px] text-[var(--text-secondary)]">حجم كروت الأصناف</div>
                      <div className="grid grid-cols-3 gap-1">
                        {(['small', 'medium', 'large'] as PosSize[]).map((sz) => (
                          <button
                            key={sz}
                            type="button"
                            onClick={() => updatePosUiPref({ posCardSize: sz })}
                            className={`py-1.5 rounded-lg font-bold text-[11px] border transition cursor-pointer ${
                              posUiPrefs.posCardSize === sz
                                ? 'bg-[#1668B2] border-[#1668B2] text-white'
                                : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                            }`}
                          >
                            {POS_SIZE_LABELS[sz]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* حجم التصنيفات */}
                    <div className="space-y-1">
                      <div className="font-bold text-[11px] text-[var(--text-secondary)]">حجم التصنيفات</div>
                      <div className="grid grid-cols-3 gap-1">
                        {(['small', 'medium', 'large'] as PosSize[]).map((sz) => (
                          <button
                            key={sz}
                            type="button"
                            onClick={() => updatePosUiPref({ posCategorySize: sz })}
                            className={`py-1.5 rounded-lg font-bold text-[11px] border transition cursor-pointer ${
                              posUiPrefs.posCategorySize === sz
                                ? 'bg-[#1668B2] border-[#1668B2] text-white'
                                : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                            }`}
                          >
                            {POS_SIZE_LABELS[sz]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* بدون إطارات */}
                    <div className="space-y-2 pt-1 border-t border-[var(--border-subtle)]">
                      <label className="flex items-center justify-between gap-2 cursor-pointer">
                        <span className="font-bold text-[var(--text-primary)]">بدون إطارات (الصفحة قطعة واحدة)</span>
                        <input
                          type="checkbox"
                          checked={posUiPrefs.posFrameless}
                          onChange={(e) => updatePosUiPref({ posFrameless: e.target.checked })}
                          className="w-4 h-4 accent-[#1668B2] cursor-pointer"
                        />
                      </label>
                    </div>

                    {/* على النسخة كلها: يظهر لمن معه settings.display_customization */}
                    {canCustomizeDisplay && (
                      <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                        <div className="font-extrabold text-[11px] text-[var(--text-secondary)]">على النسخة كلها</div>
                        <label className="flex items-center justify-between gap-2 cursor-pointer">
                          <span className="font-bold text-[var(--text-primary)]">إظهار صور الأصناف</span>
                          <input
                            type="checkbox"
                            checked={draftSharedDisplay.showItemImages}
                            onChange={(e) => updateDraftSharedDisplay({ showItemImages: e.target.checked })}
                            className="w-4 h-4 accent-[#1668B2] cursor-pointer"
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-1">
                          {(['grid', 'list'] as const).map((mode) => {
                            const isSelected = (draftSharedDisplay.posLayout === 'list' ? 'list' : 'grid') === mode;
                            return (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => updateDraftSharedDisplay({ posLayout: mode })}
                                className={`py-1.5 rounded-lg font-bold text-[11px] border transition cursor-pointer ${
                                  isSelected
                                    ? 'bg-[#1668B2] border-[#1668B2] text-white'
                                    : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                                }`}
                              >
                                {mode === 'grid' ? 'كروت' : 'قائمة'}
                              </button>
                            );
                          })}
                        </div>
                        <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
                          <div className="font-bold text-[11px] text-[var(--text-secondary)]">
                            التصنيفات الظاهرة في نقطة البيع
                          </div>
                          <PosVisibleCategoriesPicker
                            categories={effectiveCategories}
                            selectedCategoryIds={draftSharedDisplay.posVisibleCategoryIds}
                            onChange={(nextIds) =>
                              updateDraftSharedDisplay({ posVisibleCategoryIds: nextIds })
                            }
                            compact
                          />
                        </div>
                      </div>
                    )}

                    {/* أزرار الرجوع للافتراضي وإلغاء وحفظ */}
                    <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        onClick={handleResetPosUiPrefs}
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[11px] font-bold text-[var(--text-primary)] cursor-pointer transition"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>الرجوع للافتراضي</span>
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleCancelPosUiPrefs}
                          className="px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[11px] font-bold text-[var(--text-secondary)] cursor-pointer transition"
                        >
                          إلغاء
                        </button>
                        <button
                          type="button"
                          onClick={handleSavePosUiPrefs}
                          className="px-3 py-1.5 rounded-lg bg-[#168A4A] hover:bg-[#12703C] text-white text-[11px] font-bold cursor-pointer transition"
                        >
                          حفظ
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* زر ملء الشاشة */}
            <button
              type="button"
              onClick={handleToggleFullscreen}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] md:min-h-0 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-bold text-slate-700 transition cursor-pointer shadow-2xs shrink-0"
              title={isFullscreen ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5 text-slate-800" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5 text-slate-800" />
              )}
              <span className="hidden sm:inline">
                {isFullscreen ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'}
              </span>
            </button>

            {/* زر الفواتير المسجلة للكمبيوتر والأجهزة اللوحية (على الموبايل يوجد تبويب السجل أسفل الشاشة) */}
            {canViewHistorySection && (
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.innerWidth < 768) {
                    handleMobileTabSwitch('history');
                  } else {
                    salesHistoryRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }
                }}
                className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-bold text-slate-700 transition cursor-pointer shadow-2xs shrink-0"
                title="الانتقال إلى سجل المبيعات"
              >
                <History className="w-3.5 h-3.5 text-[#337AB7]" />
                <span>الفواتير المسجلة ({filteredHistoryInvoices.length})</span>
              </button>
            )}
          </div>
        </div>

        {/* التخطيط:
            - الكمبيوتر (من 1024px وأكبر): صف واحد flex-nowrap مع align-items: stretch و gap: 12px
              منطقة الأصناف lg:flex-1 و min-width: 0، ولوحة الفاتورة بعرض var(--pos-panel-w)
            - الموبايل (أقل من 768px): تبويبات مع الاحتفاظ بحالة وموضع تمرير كل تبويب في الـ DOM بدون unmount
        */}
        <div
          className="flex flex-col lg:flex-row lg:!flex-nowrap items-stretch gap-3 w-full"
          style={{ display: 'flex', gap: '12px' }}
        >
          {/* تبويب 1 على الموبايل / العمود الأيمن على الكمبيوتر: منطقة التصنيفات والأصناف */}
          <div
            className={`${
              activeMobileTab === 'products' ? 'flex' : 'hidden'
            } md:!flex w-full lg:w-auto flex-col min-w-0 lg:flex-1`}
          >
            <PosProductGrid
              items={platformFilteredItems}
              posCategories={posCategories}
              selectedCategoryIds={
                isUiAppearanceOpen
                  ? draftSharedDisplay.posVisibleCategoryIds
                  : (displaySettings?.posVisibleCategoryIds ?? [])
              }
              allowNegativeStockSale={effectiveAllowNegativeStock}
              onAddToCart={addToCart}
              posLayout={isUiAppearanceOpen ? draftSharedDisplay.posLayout : (displaySettings?.posLayout || 'grid')}
              canCustomizeDisplay={canCustomizeDisplay}
              previewUiPrefs={isUiAppearanceOpen ? posUiPrefs : undefined}
              onOpenCategorySettings={
                canCustomizeDisplay
                  ? () => onNavigateMain?.('settings', 'sales')
                  : undefined
              }
              onChangePosLayout={(nextLayout) => {
                setDraftSharedDisplay(prev => ({ ...prev, posLayout: nextLayout }));
                applyUiPrefs(posUiPrefs, true, document.documentElement, {
                  showItemImages: displaySettings?.showItemImages !== false,
                  posLayout: nextLayout
                });
                onUpdateDisplaySettings?.({ posLayout: nextLayout });
              }}
            />
          </div>

          {/* تبويب 2 على الموبايل / العمود الأيسر على الكمبيوتر: لوحة الفاتورة بالكامل */}
          <div
            className={`${
              activeMobileTab === 'invoice' ? 'flex' : 'hidden'
            } md:!flex w-full min-w-0 lg:w-[var(--pos-panel-w)] lg:flex-none flex-col shrink-0`}
          >
            <PosInvoicePanel
              platformsEnabled={effectivePlatformsEnabled}
              allowPlatformSale={effectiveAllowPlatformSale}
              allowDirectSale={effectiveAllowDirectSale}
              saleMode={saleMode}
              saleModeBlockedReason={saleModeBlockedReason}
              onSaleModeChange={handleSaleModeChange}
              denominationsStorageKey={denominationsStorageKey}
              cart={cart}
              items={platformFilteredItems}
              allowNegativeStockSale={effectiveAllowNegativeStock}
              isOffline={isOffline}
              offlineWriteBlocked={isOffline && !hasOfflineLock}
              offlineLockMessage={offlineLockReason}
              onRetryOfflineLock={() => {
                void recheckOfflineLock();
              }}
              warehouses={activeAllowedWarehouses}
              selectedWarehouseId={selectedWarehouseId}
              onSelectWarehouse={handleWarehouseChange}
              isLoadingWarehouseStock={isLoadingWarehouseStock}
              onAddToCart={addToCart}
              onUpdateQuantity={updateQuantity}
              onRemoveFromCart={removeFromCart}
              onUpdateLinePrice={handleUpdateLinePrice}
              canEditPriceBeforeSave={canEditPriceBeforeSave}
              canOverrideMinPrice={canOverrideMinPrice}
              activePlatforms={activePlatforms}
              selectedPlatformId={selectedPlatformId}
              onSelectPlatform={handlePlatformChange}
              selectedPlatform={selectedPlatform}
              bnplEnabled={posBnplEnabled}
              onBnplEnabledChange={setPosBnplEnabled}
              bnplPercentInput={posBnplPercentInput}
              onBnplPercentChange={(val) => {
                setPosBnplPercentInput(val);
                setIsBnplPercentOverridden(true);
              }}
              commissionPercentInput={posCommissionPercentInput}
              onCommissionPercentChange={(val) => {
                setPosCommissionPercentInput(val);
                setIsCommissionPercentOverridden(true);
              }}
              canEditPosRates={canEditPosRates}
              customers={customers}
              selectedCustomerId={selectedCustomerId}
              onSelectCustomer={(id) => {
                setSelectedCustomerId(id);
                if (saleMode === 'platform') {
                  setCreditPartyType('platform');
                }
                setCustomerFieldError(false);
                setErrorMsg(null);
                if (saleMode === 'customer' && isDeliveryEnabled) {
                  const chosen = id ? customers.find(c => c.id === id) || null : null;
                  syncDeliveryFromCustomer(chosen, deliveryConfig);
                }
              }}
              canCreateCustomer={canCreateCustomer}
              onCustomerCreated={handleCustomerCreated}
              showCustomerAddress={showCustomerAddress}
              showCustomerPhone={showCustomerPhone}
              showCustomerBalance={showCustomerBalance}
              canViewCustomerBalance={canViewCustomerBalance}
              platformSelectionMode={effectivePlatformSelection}
              customerSelectionMode={effectiveCustomerSelection}
              platformFieldError={platformFieldError}
              customerFieldError={customerFieldError}
              priceViolatingItemIds={priceViolatingItemIds}
              platformOrderId={platformOrderId}
              onPlatformOrderIdChange={(val) => {
                setPlatformOrderId(val);
                setPlatformOrderError(false);
                setErrorMsg(null);
              }}
              platformOrderError={platformOrderError}
              platformAlwaysCredit={Boolean(salesRules.platformAlwaysCredit)}
              deliveryConfig={deliveryConfig}
              isDeliveryEnabled={isDeliveryEnabled}
              onDeliveryEnabledChange={handleToggleDeliveryEnabled}
              deliveryPaymentMode={deliveryPaymentMode}
              onDeliveryPaymentModeChange={(mode) => {
                setDeliveryPaymentMode(mode);
                setErrorMsg(null);
              }}
              deliveryZoneId={deliveryZoneId}
              onDeliveryZoneIdChange={(zoneId) => {
                setDeliveryZoneId(zoneId);
                setDeliveryZoneError(false);
                setDeliveryZoneWarning(null);
                setDeliveryFeeManual(false);
                setErrorMsg(null);
              }}
              deliveryAddress={deliveryAddress}
              onDeliveryAddressChange={(addr) => {
                setDeliveryAddress(addr);
                setDeliveryAddressError(false);
                setErrorMsg(null);
              }}
              deliveryPhone={deliveryPhone}
              onDeliveryPhoneChange={setDeliveryPhone}
              deliveryOrderFeeInput={deliveryOrderFeeInput}
              onDeliveryOrderFeeChange={(val) => {
                if (!canEditDeliveryFee) return;
                setDeliveryOrderFeeInput(val);
                setDeliveryFeeManual(true);
                setErrorMsg(null);
              }}
              deliveryFeeManual={deliveryFeeManual}
              onResetDeliveryFeeToComputed={() => {
                setDeliveryFeeManual(false);
                setDeliveryOrderFeeInput(Math.round(computedDeliveryFee * 100) / 100);
              }}
              computedDeliveryFee={computedDeliveryFee}
              effectiveDeliveryOrderFee={effectiveDeliveryOrderFee}
              canEditDeliveryFee={canEditDeliveryFee}
              deliveryZoneWarning={deliveryZoneWarning}
              deliveryAssigneeType={deliveryAssigneeType}
              onDeliveryAssigneeTypeChange={(t) => {
                setDeliveryAssigneeType(t);
                setErrorMsg(null);
              }}
              deliveryAssigneeId={deliveryAssigneeId}
              onDeliveryAssigneeIdChange={(id) => {
                setDeliveryAssigneeId(id);
                setErrorMsg(null);
              }}
              deliveryTrackingNumber={deliveryTrackingNumber}
              onDeliveryTrackingNumberChange={setDeliveryTrackingNumber}
              deliveryAddressError={deliveryAddressError}
              deliveryZoneError={deliveryZoneError}
              barcodeInput={barcodeInput}
              onBarcodeInput={setBarcodeInput}
              onBarcodeSubmit={handleBarcodeScanned}
              onOpenScanner={() => setIsCameraModalOpen(true)}
              scanFeedback={scanFeedback}
              onClearScanFeedback={() => setScanFeedback(null)}
              selectedCartItemId={selectedCartItemId}
              focusCartQtyToken={focusCartQtyToken}
              notes={notes}
              onNotesChange={setNotes}
              totalBeforeDiscount={totalBeforeDiscount}
              totalBnpl={totalBnpl}
              totalDiscount={totalDiscount}
              totalPickup={totalPickup}
              enableDeliveryFee={isDeliveryFeeEnabled}
              deliveryFee={deliveryFee}
              onDeliveryFeeChange={setDeliveryFee}
              totalTax={totalTax}
              netAmount={netAmount}
              totalProfit={totalProfit}
              canViewProfit={canViewProfit}
              taxSettings={taxSettings}
              paymentType={paymentType}
              onPaymentTypeChange={(t) => {
                if (isOffline && t === 'جزئي') return;
                if (saleMode === 'platform' && salesRules.platformAlwaysCredit && t !== 'آجل') {
                  setPaymentType('آجل');
                  setCreditPartyType('platform');
                  return;
                }
                setPaymentType(t);
                if (t === 'آجل') {
                  setIsManualCashOverride(false);
                  setPaidAmountInput('0.00');
                  if (effectiveAllowPlatformSale && (saleMode === 'platform' || isOffline)) {
                    setCreditPartyType('platform');
                  } else if (effectiveAllowPlatformSale && !selectedCustomerId && selectedPlatformId) {
                    setCreditPartyType('platform');
                  } else {
                    setCreditPartyType('customer');
                  }
                } else if (t === 'جزئي') {
                  setIsManualCashOverride(false);
                  setPaidAmountInput('0.00');
                } else if (t === 'نقدي') {
                  setIsManualCashOverride(false);
                  setPaidAmountInput(!canEditCashPaid || autoFillCashPaid ? netAmount.toFixed(2) : '0.00');
                }
              }}
              creditPartyType={creditPartyType}
              onCreditPartyTypeChange={(pt) => {
                if (!effectiveAllowPlatformSale && pt === 'platform') return;
                if ((isOffline || (saleMode === 'platform' && salesRules.platformAlwaysCredit)) && pt === 'customer') return;
                setCreditPartyType(pt);
              }}
              paidAmountInput={paidAmountInput}
              onPaidAmountChange={setPaidAmountInput}
              autoFillCashPaid={autoFillCashPaid}
              canEditCashPaid={canEditCashPaid}
              isManualCashOverride={isManualCashOverride}
              onSetManualCashOverride={setIsManualCashOverride}
              allowedSaleCashboxes={allowedSaleCashboxes}
              selectedCashboxId={selectedCashboxId}
              onSelectCashbox={setSelectedCashboxId}
              onCheckout={handleCheckout}
              onClearCart={handleClearCart}
              isSubmitting={isSubmitting}
              hasStockExceeded={hasStockExceeded}
              errorMsg={errorMsg}
              isUnknownResultError={isUnknownResultError}
              onRetryCheckout={handleCheckout}
              onOpenFormulaModal={() => setIsFormulaModalOpen(true)}
            />
          </div>
        </div>
      </div>

      {/* 2. قسم سجل المبيعات (تبويب «السجل» على الموبايل < 768px وتحت شاشة البيع على الكمبيوتر) */}
      {canViewHistorySection && (
        <section
          ref={salesHistoryRef}
          id="sales-history-section"
          className={`${
            activeMobileTab === 'history' ? 'block' : 'hidden'
          } md:block w-full mt-1 md:mt-4 bg-white rounded-2xl border border-slate-300 shadow-sm p-3 sm:p-6 text-right`}
        >
          {/* رأس قسم السجل والتحكم */}
          <div className="space-y-3 pb-4 border-b border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold">
                  <History className="w-5 h-5 text-[#337AB7]" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base sm:text-lg text-slate-900">سجل المبيعات</h3>
                  <p className="text-[11px] text-slate-500">
                    الفواتير المحفوظة ({filteredHistoryInvoices.length} فاتورة) مع إمكانية إعادة الطباعة مباشرة
                  </p>
                </div>
              </div>

              {/* خانة بحث برقم الفاتورة أو العميل */}
              <div className="relative w-full sm:w-auto sm:min-w-[240px]">
                <input
                  type="text"
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  placeholder="ابحث برقم الفاتورة أو العميل..."
                  className="w-full pl-8 pr-9 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#337AB7]"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
                {historySearchQuery && (
                  <button
                    type="button"
                    onClick={() => setHistorySearchQuery('')}
                    className="absolute left-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <DateRangeFilter
              value={historyDateRange}
              onChange={setHistoryDateRange}
              storageKey="pos_sales_log"
              defaultPreset="TODAY"
            />
          </div>

          {/* جدول سجل المبيعات للكمبيوتر والشاشات من 640px وأكبر */}
          <div className="hidden sm:block mt-4 overflow-x-auto rounded-xl border border-slate-300 shadow-2xs">
            <table className="w-full text-right border-collapse text-xs">
              <thead style={{ backgroundColor: '#337AB7' }} className="text-white font-bold">
                <tr>
                  <th className="py-2.5 px-3 text-right">الصنف</th>
                  <th className="py-2.5 px-2 text-center">الكمية</th>
                  <th className="py-2.5 px-2 text-center">السعر</th>
                  <th className="py-2.5 px-2 text-center">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {displayedHistoryInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-slate-400 font-bold text-xs">
                      لا توجد فواتير مسجلة في هذه الفترة
                    </td>
                  </tr>
                ) : (
                  displayedHistoryInvoices.map((inv) => {
                    const isCancelled = inv.status === 'ملغاة' || (inv as any).status === 'cancelled';
                    const isOfflinePending = Boolean(
                      inv.offlinePending || String(inv.invoiceNumber || '').startsWith('OFF-')
                    );
                    const provisionalNo = inv.offlineProvisionalNo || inv.tempInvoiceNumber;
                    const lines = inv.lines || (inv as any).items || [];
                    const formattedTime = inv.date
                      ? new Date(inv.date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                      : '—';
                    const customerName = inv.customerName || (customers.find(c => c.id === inv.customerId)?.name) || 'الجمهور';
                    const totalBefore = (inv.totalBeforeDiscount ?? (inv as any).totalAmount ?? 0);
                    const net = (inv.netAmount ?? 0);
                    const paid = (inv.paidAmount ?? (inv.paymentType === 'آجل' ? 0 : net) ?? 0);
                    const statusText = isCancelled ? 'ملغاة' : (inv.status || 'تم البيع');

                    return (
                      <React.Fragment key={inv.invoiceNumber}>
                        {/* سطر عنوان الفاتورة */}
                        <tr
                          style={{ backgroundColor: isCancelled ? '#FEE2E2' : isOfflinePending ? '#FEF3C7' : '#E3F2DA' }}
                          className={`border-t-2 border-b ${
                            isCancelled
                              ? 'border-rose-300 text-rose-950'
                              : isOfflinePending
                              ? 'border-amber-300 text-slate-900'
                              : 'border-emerald-300 text-slate-900'
                          }`}
                        >
                          <td colSpan={4} className="py-2.5 px-3 text-xs">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center flex-wrap gap-x-2 gap-y-1 font-medium leading-relaxed">
                                <span>رقم الفاتورة : <strong className="font-mono font-bold">{inv.invoiceNumber}</strong></span>
                                {provisionalNo && provisionalNo !== inv.invoiceNumber && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-900 border border-cyan-300 text-[10px] font-mono font-bold">
                                    مؤقت: {provisionalNo}
                                  </span>
                                )}
                                {isOfflinePending && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-extrabold">
                                    لم تُرفع بعد
                                  </span>
                                )}
                                {inv.needsReview && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold">
                                    تحتاج مراجعة{inv.reviewReasons && inv.reviewReasons.length > 0 ? `: ${inv.reviewReasons.join('، ')}` : ''}
                                  </span>
                                )}
                                <span className="text-slate-400">|</span>
                                <span>المنصة : <strong>{inv.platform || 'البيع المباشر'}</strong></span>
                                {inv.warehouseName && (
                                  <>
                                    <span className="text-slate-400">|</span>
                                    <span>المخزن : <strong>{inv.warehouseName}</strong></span>
                                  </>
                                )}
                                <span className="text-slate-400">|</span>
                                <span>العميل : <strong>{customerName}</strong></span>
                                <span className="text-slate-400">|</span>
                                <span>الإجمالي : <strong className="font-mono">{totalBefore.toFixed(2)}</strong></span>
                                <span className="text-slate-400">|</span>
                                <span>الصافي : <strong className="font-mono">{net.toFixed(2)}</strong></span>
                                <span className="text-slate-400">|</span>
                                <span>المدفوع : <strong className="font-mono">{paid.toFixed(2)}</strong></span>
                                <span className="text-slate-400">|</span>
                                <span>الحالة : <strong className={isCancelled ? 'text-rose-700' : 'text-emerald-800'}>{statusText}</strong></span>
                                <span className="text-slate-400">|</span>
                                <span>بواسطة : <strong>{inv.createdBy || 'كاشير'}</strong></span>
                                <span className="text-slate-400">|</span>
                                <span className="font-mono">{formattedTime}</span>
                              </div>

                              {canPrintHistoryInvoice && (
                                <button
                                  type="button"
                                  onClick={() => handleReprintHistoryInvoice(inv)}
                                  className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-[#337AB7] hover:bg-[#286090] text-white text-xs font-bold transition cursor-pointer shadow-2xs shrink-0 active:scale-95"
                                  title="إعادة طباعة نسخة مكررة"
                                >
                                  <span>🖨 طباعة فاتورة</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* سطور أصناف الفاتورة */}
                        {lines.map((line: any, idx: number) => {
                          const name = line.itemNameAtSale || line.productName || line.name || 'صنف';
                          const qty = Number(line.quantity) || 1;
                          const price = Number(line.salePriceAtSale ?? line.unitPrice ?? 0);
                          const total = qty * price;
                          const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F2F8FC';

                          return (
                            <tr
                              key={`${inv.invoiceNumber}-line-${idx}`}
                              style={{ backgroundColor: rowBg }}
                              className="border-b border-slate-200 text-xs text-slate-800 hover:brightness-98 transition"
                            >
                              <td className="py-2 px-3 font-semibold text-right">{name}</td>
                              <td className="py-2 px-2 text-center font-mono">{qty.toFixed(2)}</td>
                              <td className="py-2 px-2 text-center font-mono">{price.toFixed(2)}</td>
                              <td className="py-2 px-2 text-center font-mono font-bold text-slate-900">{total.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* كروت سجل المبيعات على الموبايل */}
          <div className="sm:hidden space-y-3 mt-4">
            {displayedHistoryInvoices.length === 0 ? (
              <div className="py-8 text-center text-slate-400 font-bold text-xs">
                لا توجد فواتير مسجلة في هذه الفترة
              </div>
            ) : (
              displayedHistoryInvoices.map((inv) => {
                const isCancelled = inv.status === 'ملغاة' || (inv as any).status === 'cancelled';
                const isOfflinePending = Boolean(
                  inv.offlinePending || String(inv.invoiceNumber || '').startsWith('OFF-')
                );
                const provisionalNo = inv.offlineProvisionalNo || inv.tempInvoiceNumber;
                const lines = inv.lines || (inv as any).items || [];
                const formattedTime = inv.date
                  ? new Date(inv.date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                  : '—';
                const customerName = inv.customerName || (customers.find(c => c.id === inv.customerId)?.name) || 'الجمهور';
                const totalBefore = (inv.totalBeforeDiscount ?? (inv as any).totalAmount ?? 0);
                const net = (inv.netAmount ?? 0);
                const paid = (inv.paidAmount ?? (inv.paymentType === 'آجل' ? 0 : net) ?? 0);
                const statusText = isCancelled ? 'ملغاة' : (inv.status || 'تم البيع');

                return (
                  <div
                    key={inv.invoiceNumber}
                    className="rounded-xl border border-slate-300 overflow-hidden shadow-2xs bg-white text-right"
                  >
                    {/* سطر العنوان فوق */}
                    <div
                      style={{ backgroundColor: isCancelled ? '#FEE2E2' : isOfflinePending ? '#FEF3C7' : '#E3F2DA' }}
                      className={`p-3 text-xs border-b ${
                        isCancelled
                          ? 'border-rose-300 text-rose-950'
                          : isOfflinePending
                          ? 'border-amber-300 text-slate-900'
                          : 'border-emerald-300 text-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center flex-wrap gap-1.5">
                          <span className="font-mono font-black text-sm">#{inv.invoiceNumber}</span>
                          {provisionalNo && provisionalNo !== inv.invoiceNumber && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-900 border border-cyan-300 text-[10px] font-mono font-bold">
                              مؤقت: {provisionalNo}
                            </span>
                          )}
                          {isOfflinePending && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-extrabold">
                              لم تُرفع بعد
                            </span>
                          )}
                          {inv.needsReview && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold">
                              تحتاج مراجعة{inv.reviewReasons && inv.reviewReasons.length > 0 ? `: ${inv.reviewReasons.join('، ')}` : ''}
                            </span>
                          )}
                        </div>
                        {canPrintHistoryInvoice && (
                          <button
                            type="button"
                            onClick={() => handleReprintHistoryInvoice(inv)}
                            className="inline-flex items-center gap-1 min-h-[44px] px-3 py-1.5 rounded-lg bg-[#337AB7] hover:bg-[#286090] text-white text-xs font-bold transition cursor-pointer shadow-2xs active:scale-95"
                          >
                            <span>🖨 طباعة فاتورة</span>
                          </button>
                        )}
                      </div>

                      <div className="text-[11px] space-y-1 leading-relaxed font-medium">
                        <div>المنصة : <strong>{inv.platform || 'البيع المباشر'}</strong>{inv.warehouseName ? <> | المخزن : <strong>{inv.warehouseName}</strong></> : null} | العميل : <strong>{customerName}</strong></div>
                        <div>الإجمالي : <strong className="font-mono">{totalBefore.toFixed(2)}</strong> | الصافي : <strong className="font-mono">{net.toFixed(2)}</strong> | المدفوع : <strong className="font-mono">{paid.toFixed(2)}</strong></div>
                        <div>الحالة : <strong className={isCancelled ? 'text-rose-700' : 'text-emerald-800'}>{statusText}</strong> | بواسطة : <strong>{inv.createdBy || 'كاشير'}</strong> | <span className="font-mono">{formattedTime}</span></div>
                      </div>
                    </div>

                    {/* أصناف الفاتورة تحته */}
                    <table className="w-full text-xs">
                      <thead style={{ backgroundColor: '#337AB7' }} className="text-white font-bold">
                        <tr>
                          <th className="py-1.5 px-2 text-right">الصنف</th>
                          <th className="py-1.5 px-1 text-center">الكمية</th>
                          <th className="py-1.5 px-1 text-center">السعر</th>
                          <th className="py-1.5 px-1 text-center">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line: any, idx: number) => {
                          const name = line.itemNameAtSale || line.productName || line.name || 'صنف';
                          const qty = Number(line.quantity) || 1;
                          const price = Number(line.salePriceAtSale ?? line.unitPrice ?? 0);
                          const total = qty * price;
                          const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F2F8FC';

                          return (
                            <tr
                              key={idx}
                              style={{ backgroundColor: rowBg }}
                              className="border-b border-slate-100 text-[11px]"
                            >
                              <td className="py-1.5 px-2 font-semibold text-right">{name}</td>
                              <td className="py-1.5 px-1 text-center font-mono">{qty.toFixed(2)}</td>
                              <td className="py-1.5 px-1 text-center font-mono">{price.toFixed(2)}</td>
                              <td className="py-1.5 px-1 text-center font-mono font-bold">{total.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })
            )}
          </div>

          {/* زر عرض المزيد إن وُجد أكثر من 20 فاتورة */}
          {filteredHistoryInvoices.length > visibleCount && (
            <div className="flex justify-center pt-5">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + 20)}
                className="px-6 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-bold text-slate-800 transition cursor-pointer shadow-2xs active:scale-95"
              >
                عرض المزيد ({filteredHistoryInvoices.length - visibleCount} متبقية)
              </button>
            </div>
          )}
        </section>
      )}

      {/* مودال فاحص ومعاير المعادلات الإلزامية */}
      {isFormulaModalOpen && (
        <FormulaVerifierModal onClose={() => setIsFormulaModalOpen(false)} />
      )}

      {/* مودال مسح الباركود بكاميرا الهاتف المباشرة */}
      {isCameraModalOpen && (
        <CameraBarcodeScannerModal
          items={items}
          isOpen={isCameraModalOpen}
          onClose={() => setIsCameraModalOpen(false)}
          onBarcodeDetected={(code) => handleBarcodeScanned(code)}
          onManualSearchRequest={(term) => {
            setIsCameraModalOpen(false);
            setSearchQuery(term);
          }}
        />
      )}

      {/* مودال تأكيد تغيير المخزن عند وجود أصناف في السلة */}
      {pendingWarehouseSwitch && (
        <div
          role="dialog"
          aria-modal="true"
          data-shortcut-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          dir="rtl"
        >
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-amber-950">
                  تأكيد تغيير المخزن
                </h3>
                <p className="text-xs text-amber-800 mt-0.5">
                  يوجد {cart.length} صنف حالياً في الفاتورة المفتوحة
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs font-bold text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                هل أنت متأكد من تغيير المخزن إلى &laquo;{pendingWarehouseSwitch.targetWarehouseName}&raquo;؟ سيتم تحديث الأرصدة المعروضة والتحقق من توافر كميات أصناف الفاتورة في المخزن الجديد.
              </p>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingWarehouseSwitch(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleConfirmWarehouseSwitch}
                  className="px-4 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
                >
                  تأكيد تغيير المخزن
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* مودال تأكيد حذف الأصناف غير المتاحة عند تغيير المنصة */}
      {pendingPlatformSwitch && (
        <div
          role="dialog"
          aria-modal="true"
          data-shortcut-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          dir="rtl"
        >
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-amber-950">
                  تنبيه: أصناف غير متاحة على المنصة الجديدة
                </h3>
                <p className="text-xs text-amber-800 mt-0.5">
                  الأصناف التالية في السلة غير متاحة للبيع على منصة «{pendingPlatformSwitch.targetPlatformName}»:
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <ul className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-1.5 max-h-48 overflow-y-auto">
                {pendingPlatformSwitch.incompatibleItems.map((it) => (
                  <li key={it.id} className="text-xs font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                    <span>{it.name}</span>
                  </li>
                ))}
              </ul>

              <p className="text-xs text-slate-600 leading-relaxed">
                هل تريد تأكيد حذف هذه الأصناف من السلة والانتقال إلى منصة <strong>{pendingPlatformSwitch.targetPlatformName}</strong>؟
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingPlatformSwitch(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPlatformSwitch}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
                >
                  تأكيد حذف الأصناف وتغيير المنصة
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* مودال تأكيد تبديل وضع البيع (بيع على منصة <-> بيع لعميل) عند وجود أصناف في السلة */}
      {pendingModeSwitch && (
        <div
          role="dialog"
          aria-modal="true"
          data-shortcut-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          dir="rtl"
        >
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-amber-950">
                  تأكيد تبديل وضع البيع
                </h3>
                <p className="text-xs text-amber-800 mt-0.5">
                  يوجد {cart.length} صنف حاليًا في الفاتورة المفتوحة
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs font-bold text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                الانتقال إلى وضع &laquo;{pendingModeSwitch.targetMode === 'platform' ? 'بيع على منصة' : 'بيع لعميل'}&raquo; سيعيد احتساب الأسعار والعمولات وصافي الفاتورة تلقائيًا. هل تريد المتابعة؟
              </p>

              {pendingModeSwitch.incompatibleItems.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-extrabold text-rose-700">
                    ملاحظة: الأصناف التالية غير متاحة على المنصة المحددة وسيتم حذفها من السلة:
                  </p>
                  <ul className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-1 max-h-36 overflow-y-auto">
                    {pendingModeSwitch.incompatibleItems.map((it) => (
                      <li key={it.id} className="text-xs font-bold text-slate-800 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                        <span>{it.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingModeSwitch(null)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleConfirmModeSwitch}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-[#1678C2] hover:bg-[#1366a6] text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
                >
                  تأكيد التبديل
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* إشعار إضافة الصنف (يختفي خلال ثانيتين بدون انتقال تلقائي) */}
      {addedItemToast && (
        <div
          role="status"
          aria-live="polite"
          className="no-print fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900/95 text-white shadow-xl border border-slate-700 text-xs font-bold backdrop-blur-xs pointer-events-none max-w-[calc(92vw/var(--app-zoom,1))] text-center"
          dir="rtl"
        >
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate">{addedItemToast}</span>
        </div>
      )}

      {/* في تبويب «الأصناف» على الموبايل (< 768px): شريط مصغّر ثابت فوق التبويبات فيه عدد القطع والإجمالي وزر «عرض الفاتورة» */}
      {activeMobileTab === 'products' && (
        <div
          className="no-print md:hidden fixed bottom-[58px] left-0 right-0 z-30 bg-slate-900/95 text-white border-t border-slate-700 px-3 py-2 shadow-lg flex items-center justify-between gap-2 backdrop-blur-xs"
          dir="rtl"
        >
          <div className="flex items-center gap-3 min-w-0 text-xs">
            <div className="shrink-0">
              <span className="text-slate-300 font-semibold ml-1">القطع:</span>
              <span className="font-mono font-extrabold text-amber-400 text-sm">{totalCartPieces}</span>
            </div>
            <span className="text-slate-600">|</span>
            <div className="truncate">
              <span className="text-slate-300 font-semibold ml-1">الإجمالي:</span>
              <span className="font-mono font-extrabold text-emerald-400 text-sm">
                {totalBeforeDiscount.toFixed(2)} ج.م
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleMobileTabSwitch('invoice')}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-[#4CAF7A] hover:bg-[#439e6b] active:scale-95 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer shrink-0"
          >
            <Receipt className="w-4 h-4 shrink-0" />
            <span>عرض الفاتورة</span>
          </button>
        </div>
      )}

      {/* شريط التبويبات الثابت أسفل الشاشة على الموبايل فقط (< 768px، بارتفاع 58px على الأقل ويراعي safe area) بدل MobileBottomNav */}
      <nav
        className="no-print md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#164E72] border-t border-sky-800/60 shadow-xl px-1.5 py-1 flex items-center justify-around min-h-[58px] safe-area-pb"
        dir="rtl"
        aria-label="تبويبات نقطة البيع للموبايل"
      >
        <button
          type="button"
          onClick={() => handleMobileTabSwitch('products')}
          className={`flex flex-col items-center justify-center flex-1 min-h-[46px] px-1 rounded-xl transition-colors cursor-pointer ${
            activeMobileTab === 'products'
              ? 'text-[#42BDE5] font-extrabold bg-white/10'
              : 'text-sky-100/80 hover:text-white font-semibold'
          }`}
        >
          <Package className="w-5 h-5" />
          <span className="text-[11px] mt-0.5">الأصناف</span>
        </button>

        <button
          type="button"
          onClick={() => handleMobileTabSwitch('invoice')}
          className={`flex flex-col items-center justify-center flex-1 min-h-[46px] px-1 rounded-xl transition-colors cursor-pointer ${
            activeMobileTab === 'invoice'
              ? 'text-[#42BDE5] font-extrabold bg-white/10'
              : 'text-sky-100/80 hover:text-white font-semibold'
          }`}
        >
          <div className="relative">
            <Receipt className="w-5 h-5" />
            {totalCartPieces > 0 && (
              <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 bg-emerald-500 text-white rounded-full text-[9px] font-mono font-bold flex items-center justify-center">
                {totalCartPieces}
              </span>
            )}
          </div>
          <span className="text-[11px] mt-0.5">الفاتورة</span>
        </button>

        <button
          type="button"
          onClick={() => handleMobileTabSwitch('history')}
          className={`flex flex-col items-center justify-center flex-1 min-h-[46px] px-1 rounded-xl transition-colors cursor-pointer ${
            activeMobileTab === 'history'
              ? 'text-[#42BDE5] font-extrabold bg-white/10'
              : 'text-sky-100/80 hover:text-white font-semibold'
          }`}
        >
          <History className="w-5 h-5" />
          <span className="text-[11px] mt-0.5">السجل</span>
        </button>

        {onOpenMobileMenu ? (
          <button
            type="button"
            onClick={onOpenMobileMenu}
            className="flex flex-col items-center justify-center flex-1 min-h-[46px] px-1 rounded-xl text-sky-100/80 hover:text-white font-semibold transition-colors cursor-pointer"
            aria-label="العودة للقائمة الرئيسية"
          >
            <Menu className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">القائمة الرئيسية</span>
          </button>
        ) : (
          <a
            href={getHrefForTarget('dashboard')}
            onClick={(e) => {
              if (!isPlainLeftClick(e)) return;
              if (onNavigateMain) {
                e.preventDefault();
                onNavigateMain('dashboard');
              }
            }}
            className="flex flex-col items-center justify-center flex-1 min-h-[46px] px-1 rounded-xl text-sky-100/80 hover:text-white font-semibold transition-colors cursor-pointer"
            aria-label="العودة للقائمة الرئيسية"
          >
            <Menu className="w-5 h-5" />
            <span className="text-[11px] mt-0.5">القائمة الرئيسية</span>
          </a>
        )}
      </nav>

      {/* مودال استكمال أو تجاهل مسودة الفاتورة غير المحفوظة */}
      {pendingDraftPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          data-shortcut-modal="true"
          className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          dir="rtl"
        >
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 bg-cyan-50 border-b border-cyan-200 flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-cyan-100 text-cyan-800 flex items-center justify-center shrink-0">
                <Receipt className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-cyan-950">
                  استكمال فاتورة غير محفوظة
                </h3>
                <p className="text-xs font-bold text-cyan-900 mt-0.5 leading-relaxed">
                  توجد فاتورة لم تُحفظ من {formatDraftSavedTime(pendingDraftPrompt.savedAt)}. استكمالها أم تجاهلها؟
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {((pendingDraftPrompt.saleMode === 'customer' && !effectiveAllowDirectSale) ||
                (pendingDraftPrompt.saleMode !== 'customer' && !effectiveAllowPlatformSale)) && (
                <div
                  role="alert"
                  className="p-3 rounded-xl border border-rose-300 bg-rose-50 text-xs font-bold text-rose-800 leading-relaxed"
                >
                  تنبيه: هذه المسودة محفوظة على وضع «
                  {pendingDraftPrompt.saleMode === 'customer' ? 'بيع مباشر للعميل' : 'بيع على منصة'}
                  »، وهو معطّل حاليًا من إعدادات البيع. عند استكمالها ستبقى بياناتها محفوظة للمراجعة أو التحويل دون حذف تلقائي.
                </div>
              )}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-xs space-y-1.5 text-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold">عدد الأصناف:</span>
                  <span className="font-mono font-extrabold text-slate-900">
                    {pendingDraftPrompt.cart.length} صنف ({pendingDraftPrompt.cart.reduce((s, c) => s + (Number(c.quantity) || 0), 0)} قطعة)
                  </span>
                </div>
                {pendingDraftPrompt.notes && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 font-semibold shrink-0">الملاحظات:</span>
                    <span className="font-bold text-slate-800 truncate">{pendingDraftPrompt.notes}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleDiscardDraft}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  تجاهلها
                </button>
                <button
                  type="button"
                  onClick={handleRestoreDraft}
                  className="px-5 py-2.5 rounded-xl bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
                >
                  استكمالها
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

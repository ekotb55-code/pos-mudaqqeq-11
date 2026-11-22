import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Item,
  Platform,
  TaxSettings,
  Customer,
  Cashbox,
  Warehouse,
  DeliveryConfigResponse,
  DeliveryPaymentMode,
  DeliveryAssigneeType
} from '../../types';
import { api } from '../../api/client';
import {
  Camera,
  Barcode,
  Search,
  Plus,
  X,
  Check,
  PackageCheck,
  Truck,
  Percent,
  TrendingUp,
  AlertCircle,
  Calculator,
  Lock,
  RefreshCw,
  Warehouse as WarehouseIcon,
  ChevronDown,
  ChevronUp,
  Store,
  User as UserIcon,
  Banknote,
  Printer
} from 'lucide-react';
import {
  useRegisterShortcuts,
  useModalShortcuts,
  ShortcutBadge
} from '../../context/KeyboardShortcutsContext';

export type PosSaleMode = 'platform' | 'customer';

export interface PosCartLine {
  item: Item;
  quantity: number;
  salePriceAtSale: number;
  baseUnitPrice?: number;
  customerUnitPrice?: number;
  bnplPercent?: number;
  bnplUnitAmount?: number;
  bnplDeductionUnit?: number;
  totalBnplDeduction?: number;
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

export interface PosInvoicePanelProps {
  // Selling mode
  platformsEnabled?: boolean;
  allowPlatformSale?: boolean;
  allowDirectSale?: boolean;
  saleMode?: PosSaleMode;
  saleModeBlockedReason?: string | null;
  onSaleModeChange?: (mode: PosSaleMode) => void;
  denominationsStorageKey?: string;

  // Cart & Items
  cart: PosCartLine[];
  items: Item[];
  allowNegativeStockSale?: boolean;
  onAddToCart: (item: Item, explicitBarcode?: string) => void;
  onUpdateQuantity: (itemId: string, qty: number) => void;
  onRemoveFromCart: (itemId: string) => void;
  onUpdateLinePrice: (itemId: string, newPrice: number) => void;
  canEditPriceBeforeSave: boolean;
  canOverrideMinPrice: boolean;

  // Warehouse
  warehouses?: Warehouse[];
  selectedWarehouseId?: string;
  onSelectWarehouse?: (warehouseId: string) => void;
  isLoadingWarehouseStock?: boolean;

  // Platform
  activePlatforms: Platform[];
  selectedPlatformId: string;
  onSelectPlatform: (platformId: string) => void;
  selectedPlatform?: Platform;

  // BNPL & Platform Rate Controls (per-invoice)
  bnplEnabled?: boolean;
  onBnplEnabledChange?: (enabled: boolean) => void;
  bnplPercentInput?: number | '';
  onBnplPercentChange?: (val: number | '') => void;
  commissionPercentInput?: number | '';
  onCommissionPercentChange?: (val: number | '') => void;
  canEditPosRates?: boolean;

  // Customer
  customers: Customer[];
  selectedCustomerId: string;
  onSelectCustomer: (customerId: string) => void;
  canCreateCustomer: boolean;
  onCustomerCreated: (customer: Customer) => void;
  showCustomerAddress?: boolean;
  showCustomerPhone?: boolean;
  showCustomerBalance?: boolean;
  canViewCustomerBalance?: boolean;

  // Barcode & Scanner
  barcodeInput: string;
  onBarcodeInput: (val: string) => void;
  onBarcodeSubmit: (code: string) => void;
  onOpenScanner: () => void;
  scanFeedback?: { type: 'success' | 'error'; message: string } | null;
  onClearScanFeedback?: () => void;
  selectedCartItemId?: string | null;
  focusCartQtyToken?: number;

  // Notes
  notes: string;
  onNotesChange: (notes: string) => void;

  // Financial Totals (computed by POSPage)
  totalBeforeDiscount: number;
  totalBnpl?: number;
  totalDiscount: number;
  totalPickup: number;
  enableDeliveryFee?: boolean;
  deliveryFee: number | '';
  onDeliveryFeeChange: (val: number | '') => void;
  totalTax: number;
  netAmount: number;
  totalProfit?: number;
  canViewProfit: boolean;
  taxSettings?: TaxSettings;

  // Payment & Cashbox
  paymentType: 'نقدي' | 'آجل' | 'جزئي';
  onPaymentTypeChange: (type: 'نقدي' | 'آجل' | 'جزئي') => void;
  creditPartyType?: 'customer' | 'platform';
  onCreditPartyTypeChange?: (partyType: 'customer' | 'platform') => void;
  paidAmountInput: string;
  onPaidAmountChange: (val: string) => void;
  autoFillCashPaid?: boolean;
  canEditCashPaid?: boolean;
  isManualCashOverride?: boolean;
  onSetManualCashOverride?: (val: boolean) => void;
  allowedSaleCashboxes: Cashbox[];
  selectedCashboxId: string;
  onSelectCashbox: (cashboxId: string) => void;

  // Action Buttons
  onCheckout: (printMode?: 'print' | 'no_print') => void;
  onClearCart: () => void;
  isSubmitting: boolean;
  hasStockExceeded: boolean;
  errorMsg?: string | null;
  isUnknownResultError?: boolean;
  onRetryCheckout?: () => void;

  // Optional Formula Verifier
  onOpenFormulaModal?: () => void;
  isOffline?: boolean;
  offlineWriteBlocked?: boolean;
  offlineLockMessage?: string | null;
  onRetryOfflineLock?: () => void;

  // Sales rules & validation UI state
  platformSelectionMode?: 'first' | 'fixed' | 'manual';
  customerSelectionMode?: 'none' | 'fixed' | 'manual';
  platformFieldError?: boolean;
  customerFieldError?: boolean;
  priceViolatingItemIds?: ReadonlySet<string>;
  platformOrderId?: string;
  onPlatformOrderIdChange?: (val: string) => void;
  platformOrderError?: boolean;
  platformAlwaysCredit?: boolean;

  // Direct Sale Delivery (shown only when saleMode === 'customer' && deliveryConfig?.settings.enabled)
  deliveryConfig?: DeliveryConfigResponse | null;
  isDeliveryEnabled?: boolean;
  onDeliveryEnabledChange?: (enabled: boolean) => void;
  deliveryPaymentMode?: DeliveryPaymentMode;
  onDeliveryPaymentModeChange?: (mode: DeliveryPaymentMode) => void;
  deliveryZoneId?: string;
  onDeliveryZoneIdChange?: (zoneId: string) => void;
  deliveryAddress?: string;
  onDeliveryAddressChange?: (address: string) => void;
  deliveryPhone?: string;
  onDeliveryPhoneChange?: (phone: string) => void;
  deliveryOrderFeeInput?: number | '';
  onDeliveryOrderFeeChange?: (val: number | '') => void;
  deliveryFeeManual?: boolean;
  onResetDeliveryFeeToComputed?: () => void;
  computedDeliveryFee?: number;
  effectiveDeliveryOrderFee?: number;
  canEditDeliveryFee?: boolean;
  deliveryZoneWarning?: string | null;
  deliveryAssigneeType?: '' | DeliveryAssigneeType;
  onDeliveryAssigneeTypeChange?: (type: '' | DeliveryAssigneeType) => void;
  deliveryAssigneeId?: string;
  onDeliveryAssigneeIdChange?: (id: string) => void;
  deliveryTrackingNumber?: string;
  onDeliveryTrackingNumberChange?: (tracking: string) => void;
  deliveryAddressError?: boolean;
  deliveryZoneError?: boolean;
}

function readBooleanPref(storageKey: string, defaultVal: boolean): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return defaultVal;
    const raw = window.localStorage.getItem(storageKey);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return defaultVal;
  } catch {
    return defaultVal;
  }
}

function writeBooleanPref(storageKey: string, val: boolean): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(storageKey, val ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

export const PosInvoicePanel: React.FC<PosInvoicePanelProps> = ({
  platformsEnabled = true,
  allowPlatformSale = true,
  allowDirectSale = true,
  saleMode: rawSaleMode = 'platform',
  saleModeBlockedReason = null,
  onSaleModeChange,
  denominationsStorageKey = 'pos_denominations_expanded_default',

  cart,
  items,
  allowNegativeStockSale = false,
  onAddToCart,
  onUpdateQuantity,
  onRemoveFromCart,
  onUpdateLinePrice,
  canEditPriceBeforeSave,
  canOverrideMinPrice,

  warehouses = [],
  selectedWarehouseId = '',
  onSelectWarehouse,
  isLoadingWarehouseStock = false,

  activePlatforms,
  selectedPlatformId,
  onSelectPlatform,
  selectedPlatform,
  bnplEnabled = false,
  onBnplEnabledChange,
  bnplPercentInput = 0,
  onBnplPercentChange,
  commissionPercentInput = 0,
  onCommissionPercentChange,
  canEditPosRates = false,

  customers,
  selectedCustomerId,
  onSelectCustomer,
  canCreateCustomer,
  onCustomerCreated,
  showCustomerAddress = true,
  showCustomerPhone = true,
  showCustomerBalance = true,
  canViewCustomerBalance = false,

  barcodeInput,
  onBarcodeInput,
  onBarcodeSubmit,
  onOpenScanner,
  scanFeedback,
  onClearScanFeedback,
  selectedCartItemId = null,
  focusCartQtyToken = 0,

  notes,
  onNotesChange,

  totalBeforeDiscount,
  totalBnpl = 0,
  totalDiscount,
  totalPickup,
  enableDeliveryFee = false,
  deliveryFee = 0,
  onDeliveryFeeChange,
  totalTax,
  netAmount,
  totalProfit,
  canViewProfit,
  taxSettings = { taxInclusive: true, platformCommissionOn: 'before_tax' },

  paymentType,
  onPaymentTypeChange,
  creditPartyType = 'customer',
  onCreditPartyTypeChange,
  paidAmountInput,
  onPaidAmountChange,
  autoFillCashPaid = false,
  canEditCashPaid = false,
  isManualCashOverride = false,
  onSetManualCashOverride,
  allowedSaleCashboxes,
  selectedCashboxId,
  onSelectCashbox,

  onCheckout,
  onClearCart,
  isSubmitting,
  hasStockExceeded,
  errorMsg,
  isUnknownResultError = false,
  onRetryCheckout,
  onOpenFormulaModal,
  isOffline = false,
  offlineWriteBlocked = false,
  offlineLockMessage = null,
  onRetryOfflineLock,

  platformSelectionMode = 'first',
  customerSelectionMode = 'none',
  platformFieldError = false,
  customerFieldError = false,
  priceViolatingItemIds,
  platformOrderId = '',
  onPlatformOrderIdChange,
  platformOrderError = false,
  platformAlwaysCredit = false,

  deliveryConfig = null,
  isDeliveryEnabled = false,
  onDeliveryEnabledChange,
  deliveryPaymentMode = 'prepaid',
  onDeliveryPaymentModeChange,
  deliveryZoneId = '',
  onDeliveryZoneIdChange,
  deliveryAddress = '',
  onDeliveryAddressChange,
  deliveryPhone = '',
  onDeliveryPhoneChange,
  deliveryOrderFeeInput = 0,
  onDeliveryOrderFeeChange,
  deliveryFeeManual = false,
  onResetDeliveryFeeToComputed,
  computedDeliveryFee = 0,
  effectiveDeliveryOrderFee = 0,
  canEditDeliveryFee = false,
  deliveryZoneWarning = null,
  deliveryAssigneeType = '',
  onDeliveryAssigneeTypeChange,
  deliveryAssigneeId = '',
  onDeliveryAssigneeIdChange,
  deliveryTrackingNumber = '',
  onDeliveryTrackingNumberChange,
  deliveryAddressError = false,
  deliveryZoneError = false
}) => {
  // Today's date formatted as YYYY/MM/DD
  const todayFormatted = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
  }, []);

  // Collapsible sections: Additional details & Currency denominations (both collapsed by default)
  const [isExtraDetailsOpen, setIsExtraDetailsOpen] = useState<boolean>(false);
  const [isDenomsOpen, setIsDenomsOpen] = useState<boolean>(() =>
    readBooleanPref(denominationsStorageKey, false)
  );
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState<boolean>(false);

  useEffect(() => {
    setIsDenomsOpen(readBooleanPref(denominationsStorageKey, false));
  }, [denominationsStorageKey]);

  // عند تحديد سطر موجود بالمسح في وضع «مسح الصنف ثم تعديل الكمية»: تمرير السطر للواجهة وتحديد خانة الكمية
  useEffect(() => {
    if (!selectedCartItemId || !focusCartQtyToken) return;
    const timer = setTimeout(() => {
      const rowEl = document.querySelector(
        `[data-pos-cart-row-id="${CSS.escape(selectedCartItemId)}"]`
      ) as HTMLElement | null;
      rowEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      const qtyInput = document.querySelector(
        `[data-pos-qty-input-id="${CSS.escape(selectedCartItemId)}"]`
      ) as HTMLInputElement | null;
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }, 30);
    return () => clearTimeout(timer);
  }, [selectedCartItemId, focusCartQtyToken]);

  const handleToggleDenoms = () => {
    setIsDenomsOpen(prev => {
      const next = !prev;
      writeBooleanPref(denominationsStorageKey, next);
      return next;
    });
  };

  // Quick Customer Modal state
  const [isQuickCustomerOpen, setIsQuickCustomerOpen] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [customerModalError, setCustomerModalError] = useState<string | null>(null);

  // Selected customer object
  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  const trimmedCustomerAddress = selectedCustomer?.address?.trim() || '';
  const trimmedCustomerPhone = selectedCustomer?.phone?.trim() || '';
  const hasCustomerBalanceValue =
    selectedCustomer !== null &&
    selectedCustomer.currentBalance !== undefined &&
    selectedCustomer.currentBalance !== null &&
    !Number.isNaN(Number(selectedCustomer.currentBalance));
  const shouldShowCustomerAddress = Boolean(selectedCustomer && showCustomerAddress && trimmedCustomerAddress);
  const shouldShowCustomerPhone = Boolean(selectedCustomer && showCustomerPhone && trimmedCustomerPhone);
  const shouldShowCustomerBalance = Boolean(
    selectedCustomer && showCustomerBalance && canViewCustomerBalance && hasCustomerBalanceValue
  );

  // Autocomplete Item Name Search state
  const [itemNameSearch, setItemSearchTerm] = useState('');
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Suggestions filtered by name, printName, sku, barcode, secondary barcodes, supplier
  const itemSuggestions = useMemo(() => {
    const term = itemNameSearch.trim().toLowerCase();
    if (!term) return [];
    return items
      .filter(it => {
        if (it.status === 'inactive' || it.status === 'موقوف' || it.status === 'مؤرشف') return false;
        const nameMatch = it.name?.toLowerCase().includes(term);
        const printNameMatch = it.printName && it.printName.toLowerCase().includes(term);
        const skuMatch = it.sku?.toLowerCase().includes(term);
        const barcodeMatch = it.barcode && it.barcode.toLowerCase().includes(term);
        const secBarcodeMatch = it.secondaryBarcodes && it.secondaryBarcodes.some(b => b.toLowerCase().includes(term));
        const detailedBarcodeMatch = it.barcodes && it.barcodes.some(b => b.barcode.toLowerCase().includes(term));
        const supplierMatch = it.supplier && it.supplier.toLowerCase().includes(term);
        return Boolean(nameMatch || printNameMatch || skuMatch || barcodeMatch || secBarcodeMatch || detailedBarcodeMatch || supplierMatch);
      })
      .slice(0, 10);
  }, [items, itemNameSearch]);

  const handleSelectSuggestion = (item: Item) => {
    onAddToCart(item);
    setItemSearchTerm('');
    setIsSuggestionsOpen(false);
  };

  const handleItemSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (itemSuggestions.length > 0) {
        handleSelectSuggestion(itemSuggestions[0]);
      }
    } else if (e.key === 'Escape') {
      setIsSuggestionsOpen(false);
    }
  };

  // Quick customer submit
  const handleSaveQuickCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingCustomer) return;
    if (!newCustName.trim()) {
      setCustomerModalError('يرجى إدخال اسم العميل');
      return;
    }
    setIsSavingCustomer(true);
    setCustomerModalError(null);
    try {
      const res = await api.saveCustomer({
        name: newCustName.trim(),
        phone: newCustPhone.trim() || undefined,
        address: newCustAddress.trim() || undefined
      });
      if (res.success && res.customer) {
        onCustomerCreated(res.customer);
        setIsQuickCustomerOpen(false);
        setNewCustName('');
        setNewCustPhone('');
        setNewCustAddress('');
      } else {
        setCustomerModalError(res.error || 'فشل حفظ العميل الجديد');
      }
    } catch (err: any) {
      setCustomerModalError(err.message || 'حدث خطأ أثناء حفظ العميل');
    } finally {
      setIsSavingCustomer(false);
    }
  };

  // Total quantity of pieces in cart
  const totalPiecesCount = useMemo(() => {
    return cart.reduce((sum, c) => sum + c.quantity, 0);
  }, [cart]);

  const effectiveAllowPlatformSale = platformsEnabled !== false && allowPlatformSale !== false;
  const effectiveAllowDirectSale = allowDirectSale !== false;
  const bothModesAllowed = effectiveAllowPlatformSale && effectiveAllowDirectSale;
  const saleMode: PosSaleMode = rawSaleMode;
  const isCurrentDraftModeDisallowed =
    (saleMode === 'platform' && !effectiveAllowPlatformSale) ||
    (saleMode === 'customer' && !effectiveAllowDirectSale);
  const isMissingRequiredPlatformForPlatformOnly =
    saleMode === 'platform' &&
    effectiveAllowPlatformSale &&
    !effectiveAllowDirectSale &&
    activePlatforms.length === 0;
  const isCheckoutBlockedByMode =
    (!effectiveAllowPlatformSale && !effectiveAllowDirectSale) ||
    isCurrentDraftModeDisallowed ||
    isMissingRequiredPlatformForPlatformOnly;

  // Direct-sale delivery derived state
  const isDeliveryFeatureAvailable = saleMode === 'customer' && Boolean(deliveryConfig?.settings.enabled);
  const isDeliveryOrderActive = isDeliveryFeatureAvailable && !isOffline && Boolean(isDeliveryEnabled);
  const isCodDelivery = isDeliveryOrderActive && deliveryPaymentMode === 'cod';
  const selectedDeliveryZone = useMemo(() => {
    if (!deliveryConfig?.zones || !deliveryZoneId) return null;
    return deliveryConfig.zones.find(z => z.id === deliveryZoneId) || null;
  }, [deliveryConfig?.zones, deliveryZoneId]);
  const isDeliveryBelowMinOrder = Boolean(
    isDeliveryOrderActive &&
      deliveryConfig?.settings.zonePricing &&
      selectedDeliveryZone &&
      selectedDeliveryZone.minOrderValue > 0 &&
      cart.length > 0 &&
      totalBeforeDiscount + 0.001 < selectedDeliveryZone.minOrderValue
  );
  const deliveryMode = deliveryConfig?.settings.mode || 'drivers';
  const availableDrivers = deliveryConfig?.drivers || [];
  const availableCouriers = deliveryConfig?.couriers || [];
  const hasAnyDeliveryAssigneeOptions =
    (deliveryMode === 'drivers' && availableDrivers.length > 0) ||
    (deliveryMode === 'couriers' && availableCouriers.length > 0) ||
    (deliveryMode === 'both' && (availableDrivers.length > 0 || availableCouriers.length > 0));

  // Numeric paid amount & derived partial-cash state (for direct sale without showing a separate "جزئي" button)
  const parsedPaidNum = parseFloat(paidAmountInput);
  const numericPaid =
    !isNaN(parsedPaidNum) && parsedPaidNum >= 0
      ? Math.round(parsedPaidNum * 100) / 100
      : 0;
  const changeToCustomer = Math.round((numericPaid - netAmount) * 100) / 100;
  const isPartialCashPayment =
    saleMode === 'customer' &&
    !isOffline &&
    !isCodDelivery &&
    paymentType === 'نقدي' &&
    canEditCashPaid &&
    netAmount > 0 &&
    numericPaid > 0 &&
    numericPaid < netAmount - 0.005;
  const isUnderpaidOfflineDirect =
    saleMode === 'customer' &&
    isOffline &&
    paymentType === 'نقدي' &&
    netAmount > 0 &&
    numericPaid < netAmount - 0.005;

  const activeDeliveryFeeAmount =
    saleMode === 'customer'
      ? (isDeliveryOrderActive ? Number(effectiveDeliveryOrderFee || 0) : 0)
      : (enableDeliveryFee ? Number(deliveryFee || 0) : 0);
  const grossInvoiceTotal = Math.round((totalBeforeDiscount + activeDeliveryFeeAmount) * 100) / 100;
  const effectiveCreditParty: 'customer' | 'platform' =
    saleMode === 'platform' ? 'platform' : (saleMode === 'customer' ? 'customer' : creditPartyType);
  const creditDueAmount = isCodDelivery
    ? netAmount
    : paymentType === 'آجل'
    ? (effectiveCreditParty === 'customer' ? grossInvoiceTotal : netAmount)
    : isPartialCashPayment || paymentType === 'جزئي'
    ? Math.max(0, Math.round((netAmount - numericPaid) * 100) / 100)
    : 0;
  const remainingCredit = creditDueAmount;

  const isCashPaidReadOnly = isCodDelivery || paymentType === 'آجل' || (paymentType === 'نقدي' && !canEditCashPaid);
  const showCashPaidInput = !isCodDelivery && (paymentType === 'نقدي' || paymentType === 'جزئي');
  const showCashboxSelector = !isCodDelivery && paymentType !== 'آجل' && allowedSaleCashboxes.length > 1;
  const showCashboxMissingWarning = !isCodDelivery && paymentType !== 'آجل' && allowedSaleCashboxes.length === 0;
  const showDenominations = !isCodDelivery && paymentType === 'نقدي' && canEditCashPaid;

  const resolvedCommissionPct =
    commissionPercentInput !== undefined && commissionPercentInput !== ''
      ? Number(commissionPercentInput)
      : (selectedPlatform?.discountPercentage || 0);

  const isCheckoutDisabled =
    isSubmitting ||
    cart.length === 0 ||
    hasStockExceeded ||
    isCheckoutBlockedByMode ||
    Boolean(isOffline && offlineWriteBlocked);
  const isCancelDisabled = isSubmitting || cart.length === 0;

  // تسجيل اختصارات نقطة البيع مع المدير المركزي
  useRegisterShortcuts({
    'pos.save_and_print': {
      disabled: isCheckoutDisabled,
      handler: () => {
        if (isCheckoutDisabled) return;
        onCheckout('print');
      }
    },
    'pos.save_only': {
      disabled: isCheckoutDisabled,
      handler: () => {
        if (isCheckoutDisabled) return;
        onCheckout('no_print');
      }
    },
    'pos.cancel_invoice': {
      disabled: isCancelDisabled,
      handler: () => {
        if (isCancelDisabled) return;
        setIsCancelConfirmOpen(true);
      }
    },
    'pos.focus_barcode': {
      handler: () => {
        const el = document.getElementById('pos-barcode-input') as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select();
        }
      }
    },
    'pos.focus_search': {
      handler: () => {
        const el = document.getElementById('pos-item-search-input') as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select();
        }
      }
    },
    'pos.focus_paid': {
      disabled: !showCashPaidInput || isCashPaidReadOnly,
      handler: () => {
        if (!showCashPaidInput || isCashPaidReadOnly) return;
        const el = document.getElementById('pos-paid-amount-input') as HTMLInputElement | null;
        if (el && !el.readOnly && !el.disabled) {
          el.focus();
          el.select();
        }
      }
    }
  });

  // تسجيل النوافذ المنبثقة الداخلية في نقطة البيع مع المدير المركزي (تفعّل فقط Esc و Ctrl+S وتوقف اختصارات نقطة البيع والتنقل)
  useModalShortcuts({
    isOpen: isCancelConfirmOpen,
    onClose: () => setIsCancelConfirmOpen(false)
  });

  useModalShortcuts({
    isOpen: isQuickCustomerOpen,
    onClose: () => !isSavingCustomer && setIsQuickCustomerOpen(false),
    closeDisabled: isSavingCustomer,
    saveDisabled: isSavingCustomer
  });

  return (
    <div
      className="pos-surface pos-invoice-surface bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4 text-right"
      dir="rtl"
      data-sale-mode={saleMode}
    >
      {/* 1. الشريط العلوي: زر التبديل بين وضع البيع + عداد القطع والإجمالي + اختيار المخزن (إن زاد عن مخزن واحد) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* زر تبديل وضع البيع (يظهر التبديل فقط عند تفعيل الوضعين معًا) */}
          {bothModesAllowed ? (
            <div
              role="group"
              aria-label="وضع البيع"
              className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200 pos-mode-toggle-track"
            >
              <button
                type="button"
                onClick={() => onSaleModeChange?.('platform')}
                aria-pressed={saleMode === 'platform'}
                className={`min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer ${
                  saleMode === 'platform'
                    ? 'bg-[#1678C2] text-white shadow-2xs'
                    : 'text-slate-700 hover:text-slate-900 pos-mode-toggle-inactive'
                }`}
              >
                <Store className="w-4 h-4 shrink-0" />
                <span>بيع على منصة</span>
              </button>
              <button
                type="button"
                onClick={() => onSaleModeChange?.('customer')}
                aria-pressed={saleMode === 'customer'}
                className={`min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-extrabold inline-flex items-center gap-1.5 transition cursor-pointer ${
                  saleMode === 'customer'
                    ? 'bg-[#1678C2] text-white shadow-2xs'
                    : 'text-slate-700 hover:text-slate-900 pos-mode-toggle-inactive'
                }`}
              >
                <UserIcon className="w-4 h-4 shrink-0" />
                <span>بيع لعميل</span>
              </button>
            </div>
          ) : isCurrentDraftModeDisallowed && cart.length > 0 ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-50 border border-rose-300 text-xs font-extrabold text-rose-800">
              <Lock className="w-4 h-4 shrink-0 text-rose-600" />
              <span>
                {saleMode === 'platform'
                  ? 'مسودة: بيع على منصة (معطّل)'
                  : 'مسودة: بيع مباشر لعميل (معطّل)'}
              </span>
            </div>
          ) : !effectiveAllowPlatformSale && !effectiveAllowDirectSale ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-50 border border-rose-300 text-xs font-extrabold text-rose-800">
              <Lock className="w-4 h-4 shrink-0 text-rose-600" />
              <span>أوضاع البيع معطلة</span>
            </div>
          ) : effectiveAllowPlatformSale && !effectiveAllowDirectSale ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-xs font-extrabold text-slate-800">
              <Store className="w-4 h-4 shrink-0 text-[#1678C2]" />
              <span>بيع على منصة فقط</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-xs font-extrabold text-slate-800">
              <UserIcon className="w-4 h-4 shrink-0 text-[#1678C2]" />
              <span>بيع مباشر لعميل</span>
            </div>
          )}

          {/* عدد القطع والإجمالي مباشرة على نفس السطح */}
          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="text-slate-500 font-bold ml-1">عدد القطع:</span>
              <span className="font-mono font-black text-base text-slate-900 tabular-nums">
                {totalPiecesCount}
              </span>
            </div>
            <div dir="ltr">
              <span className="font-mono font-black text-base text-slate-900 tabular-nums">
                {totalBeforeDiscount.toFixed(2)} ج.م
              </span>
              <span className="text-slate-500 font-bold mr-1">:الإجمالي</span>
            </div>
          </div>
        </div>

        {/* المخزن: يظهر فقط إذا كان للمستخدم أكثر من مخزن مسموح */}
        {warehouses.length > 1 && (
          <div className="space-y-1" data-testid="pos-warehouse-selector">
            <label className="text-xs font-bold text-slate-800 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <WarehouseIcon className="w-3.5 h-3.5 text-sky-700" />
                <span>المخزن:</span>
              </span>
              {isLoadingWarehouseStock && (
                <span className="text-[11px] font-bold text-sky-700">جاري تحديث الكميات...</span>
              )}
            </label>
            <select
              value={selectedWarehouseId}
              onChange={(e) => onSelectWarehouse?.(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {warehouses.map(wh => (
                <option key={wh.id} value={wh.id}>
                  {wh.name}{wh.isDefault ? ' (الرئيسي)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* تنبيه تعطيل وضع البيع أو عدم توافر منصة نشطة أو مسودة في وضع معطّل */}
      {saleModeBlockedReason && (
        <div
          role="alert"
          data-testid="pos-sale-mode-blocked-banner"
          className="p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-xs font-bold flex flex-col gap-2"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{saleModeBlockedReason}</span>
          </div>
          {isCurrentDraftModeDisallowed &&
            cart.length > 0 &&
            ((saleMode === 'platform' && effectiveAllowDirectSale) ||
              (saleMode === 'customer' && effectiveAllowPlatformSale)) && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onSaleModeChange?.(saleMode === 'platform' ? 'customer' : 'platform')
                  }
                  className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#1678C2] hover:bg-[#1366a6] text-white text-xs font-extrabold cursor-pointer transition"
                >
                  {saleMode === 'platform'
                    ? 'تحويل المسودة إلى بيع مباشر'
                    : 'تحويل المسودة إلى بيع على منصة'}
                </button>
              </div>
            )}
        </div>
      )}

      {/* تنبيه قفل الوضع الأوفلاين على تبويب واحد */}
      {isOffline && offlineWriteBlocked && (
        <div
          role="alert"
          data-testid="pos-offline-lock-banner"
          className="p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-xs font-bold flex flex-col gap-2"
        >
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              {offlineLockMessage ||
                'الوضع الأوفلاين نشط في تبويب آخر على هذا المتصفح. البيع أوفلاين متاح في تبويب واحد فقط.'}
            </span>
          </div>
          {onRetryOfflineLock && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRetryOfflineLock}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#1678C2] hover:bg-[#1366a6] text-white text-xs font-extrabold cursor-pointer transition"
              >
                إعادة فحص القفل
              </button>
            </div>
          )}
        </div>
      )}

      {/* رسالة الخطأ إن وجدت */}
      {errorMsg && (
        <div className="p-3 rounded-xl border border-rose-300 text-rose-700 text-xs font-bold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          {isUnknownResultError && onRetryCheckout && (
            <button
              type="button"
              onClick={onRetryCheckout}
              disabled={isSubmitting}
              className="min-h-[44px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-extrabold shrink-0 cursor-pointer transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
              <span>إعادة المحاولة</span>
            </button>
          )}
        </div>
      )}

      {/* 2. المنصة (في وضع «بيع على منصة») أو العميل (في وضع «بيع لعميل») */}
      {saleMode === 'platform' ? (
        <div className="pt-4 border-t border-slate-200 space-y-3" data-testid="pos-platform-section">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-800">المنصة:</label>
              {onOpenFormulaModal && (
                <button
                  type="button"
                  onClick={onOpenFormulaModal}
                  className="min-h-[44px] px-1 inline-flex items-center gap-1 text-[11px] text-cyan-800 hover:text-cyan-950 font-bold hover:underline cursor-pointer"
                  title="التحقق من صحة ومطابقة معادلات القسم 9"
                >
                  <Calculator className="w-3.5 h-3.5 text-cyan-700" />
                  <span>فاحص المعادلات (القسم 9)</span>
                </button>
              )}
            </div>
            <select
              value={selectedPlatformId}
              onChange={(e) => onSelectPlatform(e.target.value)}
              aria-invalid={platformFieldError}
              className={`w-full min-h-[44px] px-3 py-2 text-xs font-bold rounded-lg border bg-white text-slate-900 focus:outline-none focus:ring-2 ${
                platformFieldError
                  ? 'border-rose-500 ring-2 ring-rose-300 focus:ring-rose-500'
                  : 'border-slate-300 focus:ring-blue-500'
              }`}
            >
              {activePlatforms.length === 0 ? (
                <option value="">لا توجد منصة نشطة متاحة</option>
              ) : (
                (platformSelectionMode === 'manual' || !selectedPlatformId) && (
                  <option value="">اختر المنصة</option>
                )
              )}
              {activePlatforms.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} (عمولة {p.discountPercentage}%) {p.pickupFee ? `[التقاط: ${p.pickupFee} ج.م]` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="pos-platform-order-id" className="text-xs font-bold text-slate-800 block">
              رقم طلب المنصة (اختياري)
            </label>
            <input
              id="pos-platform-order-id"
              type="text"
              maxLength={64}
              value={platformOrderId}
              onChange={(e) => onPlatformOrderIdChange?.(e.target.value)}
              placeholder="نفس الرقم المكتوب على المنصة"
              aria-invalid={platformOrderError}
              className={`w-full min-h-[44px] px-3 py-2 text-xs font-mono rounded-lg border bg-white text-slate-900 focus:outline-none focus:ring-2 ${
                platformOrderError
                  ? 'border-rose-500 ring-2 ring-rose-300 focus:ring-rose-500'
                  : 'border-slate-300 focus:ring-blue-500'
              }`}
            />
          </div>

          {/* تفاصيل المنصة: مفتاح BNPL ونسبته، نسبة خصم المنصة، ورسوم الالتقاط */}
          <div className="grid grid-cols-3 gap-2 items-end">
            {/* مفتاح تشغيل/إيقاف BNPL */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-800 block">BNPL</label>
              <button
                type="button"
                role="switch"
                aria-checked={bnplEnabled}
                onClick={() => onBnplEnabledChange?.(!bnplEnabled)}
                className={`w-full min-h-[44px] px-2.5 rounded-lg border text-xs font-bold flex items-center justify-between transition cursor-pointer ${
                  bnplEnabled
                    ? 'bg-purple-600 border-purple-700 text-white'
                    : 'bg-slate-100 border-slate-300 text-slate-800'
                }`}
              >
                <span>{bnplEnabled ? 'مفعّل' : 'مغلق'}</span>
                <span
                  className={`w-4 h-4 rounded-full bg-white shadow-2xs transition-transform ${
                    bnplEnabled ? '-translate-x-0.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* حقل نسبة BNPL % */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-800 flex items-center justify-between gap-1">
                <span>نسبة BNPL %</span>
                {!canEditPosRates && (
                  <span title="للقراءة فقط (يتطلب صلاحية تعديل النسب)" className="inline-flex">
                    <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                  </span>
                )}
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                readOnly={!canEditPosRates}
                value={bnplPercentInput}
                onChange={(e) => {
                  if (!canEditPosRates) return;
                  const val = e.target.value;
                  if (val === '') {
                    onBnplPercentChange?.('');
                    return;
                  }
                  const num = Number(val);
                  if (!isNaN(num)) {
                    onBnplPercentChange?.(Math.min(100, Math.max(0, num)));
                  }
                }}
                className={`w-full min-h-[44px] px-2 text-xs font-mono font-bold text-center rounded-lg border focus:outline-none tabular-nums ${
                  canEditPosRates
                    ? 'bg-white border-slate-300 text-slate-900 focus:ring-2 focus:ring-purple-500'
                    : 'bg-slate-100 border-slate-300 text-slate-600 cursor-not-allowed select-text'
                }`}
              />
            </div>

            {/* حقل نسبة خصم المنصة % */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-800 flex items-center justify-between gap-1">
                <span>نسبة خصم المنصة %</span>
                {!canEditPosRates && (
                  <span title="للقراءة فقط (يتطلب صلاحية تعديل النسب)" className="inline-flex">
                    <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                  </span>
                )}
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                readOnly={!canEditPosRates}
                value={commissionPercentInput}
                onChange={(e) => {
                  if (!canEditPosRates) return;
                  const val = e.target.value;
                  if (val === '') {
                    onCommissionPercentChange?.('');
                    return;
                  }
                  const num = Number(val);
                  if (!isNaN(num)) {
                    onCommissionPercentChange?.(Math.min(100, Math.max(0, num)));
                  }
                }}
                className={`w-full min-h-[44px] px-2 text-xs font-mono font-bold text-center rounded-lg border focus:outline-none tabular-nums ${
                  canEditPosRates
                    ? 'bg-white border-slate-300 text-slate-900 focus:ring-2 focus:ring-blue-500'
                    : 'bg-slate-100 border-slate-300 text-slate-600 cursor-not-allowed select-text'
                }`}
              />
            </div>
          </div>

          {/* رسوم الالتقاط */}
          <div className="flex items-center justify-between text-xs text-slate-600 pt-0.5">
            <span className="font-semibold">رسوم الالتقاط على المنصة:</span>
            <span className="font-mono font-bold text-slate-900 tabular-nums">
              {selectedPlatform?.pickupFeeMode === 'product'
                ? 'حسب الصنف'
                : `${Number(selectedPlatform?.pickupFee || 0).toFixed(2)} ج.م / قطعة`}
            </span>
          </div>
        </div>
      ) : (
        <div className="pt-4 border-t border-slate-200 space-y-2.5" data-testid="pos-customer-section">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-800 block">العميل:</label>
            <div className="flex items-center gap-2">
              <select
                value={selectedCustomerId}
                onChange={(e) => onSelectCustomer(e.target.value)}
                aria-invalid={customerFieldError}
                className={`flex-1 min-h-[44px] px-3 py-2 text-xs font-bold rounded-lg border bg-white text-slate-900 focus:outline-none focus:ring-2 ${
                  customerFieldError
                    ? 'border-rose-500 ring-2 ring-rose-300 focus:ring-rose-500'
                    : 'border-slate-300 focus:ring-blue-500'
                }`}
              >
                <option value="">
                  {customerSelectionMode === 'manual' ? 'اختر العميل' : 'الجمهور'}
                </option>
                {customers.map(c => {
                  const optPhone = showCustomerPhone && c.phone?.trim() ? ` (${c.phone.trim()})` : '';
                  const hasOptBalance =
                    showCustomerBalance &&
                    canViewCustomerBalance &&
                    c.currentBalance !== undefined &&
                    c.currentBalance !== null &&
                    !Number.isNaN(Number(c.currentBalance));
                  const optBalance = hasOptBalance
                    ? ` - رصيد: ${Number(c.currentBalance).toFixed(2)} ج.م`
                    : '';
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name}{optPhone}{optBalance}
                    </option>
                  );
                })}
              </select>

              {canCreateCustomer && (
                <button
                  type="button"
                  disabled={isOffline}
                  onClick={() => {
                    if (isOffline) return;
                    setIsQuickCustomerOpen(true);
                  }}
                  className={`min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center shrink-0 shadow-2xs transition ${
                    isOffline
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-70'
                      : 'bg-cyan-700 hover:bg-cyan-800 text-white active:scale-95 cursor-pointer'
                  }`}
                  title={isOffline ? 'متاح عند رجوع الاتصال' : 'إضافة عميل سريع'}
                  aria-label="إضافة عميل سريع"
                >
                  <Plus className="w-5 h-5" />
                </button>
              )}
            </div>
            {isOffline && canCreateCustomer && (
              <div className="text-[11px] font-bold text-amber-700">
                إضافة عميل جديد: متاح عند رجوع الاتصال
              </div>
            )}
          </div>

          {/* تفاصيل العميل المختار: تظهر فقط عند اختيار عميل فعلي، وتُخفى الحقول المعطّلة أو الفارغة أو غير المصرح بها تمامًا من DOM */}
          {selectedCustomer && (
            <div className="text-xs space-y-1.5 text-slate-700 pt-1" data-testid="pos-customer-details">
              <div className="flex items-start justify-between gap-2" data-testid="pos-customer-name-row">
                <span className="text-slate-500 font-semibold shrink-0">الاسم:</span>
                <span className="font-bold text-slate-900 text-left break-words min-w-0">
                  {selectedCustomer.name}
                </span>
              </div>
              {shouldShowCustomerAddress && (
                <div className="flex items-start justify-between gap-2" data-testid="pos-customer-address-row">
                  <span className="text-slate-500 font-semibold shrink-0">العنوان:</span>
                  <span className="font-medium text-slate-900 text-left break-words min-w-0">
                    {trimmedCustomerAddress}
                  </span>
                </div>
              )}
              {shouldShowCustomerPhone && (
                <div className="flex items-start justify-between gap-2" data-testid="pos-customer-phone-row">
                  <span className="text-slate-500 font-semibold shrink-0">الموبايل:</span>
                  <span dir="ltr" className="font-mono text-slate-900 tabular-nums text-left break-all min-w-0">
                    {trimmedCustomerPhone}
                  </span>
                </div>
              )}
              {shouldShowCustomerBalance && (
                <div className="flex items-start justify-between gap-2" data-testid="pos-customer-balance-row">
                  <span className="text-slate-500 font-semibold shrink-0">رصيد العميل:</span>
                  <span dir="ltr" className="font-mono font-bold text-slate-900 tabular-nums shrink-0">
                    {Number(selectedCustomer.currentBalance).toFixed(2)} ج.م
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. الباركود وبحث الصنف */}
      <div className="pt-4 border-t border-slate-200 space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label
              htmlFor="pos-barcode-input"
              className="text-xs font-bold text-slate-800 flex items-center gap-1.5"
            >
              <span>الباركود:</span>
              <ShortcutBadge actionId="pos.focus_barcode" />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                id="pos-barcode-input"
                data-pos-barcode-input="true"
                type="text"
                value={barcodeInput}
                onChange={(e) => onBarcodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.nativeEvent as any).__posBarcodeHandled) return;
                  if (e.key === 'Enter') {
                    (e.nativeEvent as any).__posBarcodeHandled = true;
                    e.preventDefault();
                    e.stopPropagation();
                    const code = e.currentTarget.value.trim() || barcodeInput.trim();
                    if (code) {
                      onBarcodeInput('');
                      onBarcodeSubmit(code);
                    }
                  }
                }}
                placeholder="امسح الباركود واضغط Enter..."
                className="w-full min-h-[44px] pl-3 pr-9 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Barcode className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <button
              type="button"
              onClick={onOpenScanner}
              className="min-w-[44px] min-h-[44px] rounded-lg bg-slate-800 hover:bg-slate-900 text-white flex items-center justify-center shrink-0 cursor-pointer transition shadow-2xs"
              title="مسح بالكاميرا"
              aria-label="مسح الباركود بالكاميرا"
            >
              <Camera className="w-4 h-4 text-cyan-200" />
            </button>
          </div>

          {scanFeedback && (
            <div
              className={`px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-1.5 border ${
                scanFeedback.type === 'success'
                  ? 'border-emerald-300 text-emerald-800 font-bold'
                  : 'border-rose-300 text-rose-700 font-semibold'
              }`}
            >
              <span>{scanFeedback.message}</span>
              {onClearScanFeedback && (
                <button
                  type="button"
                  onClick={onClearScanFeedback}
                  className="min-w-[32px] min-h-[32px] flex items-center justify-center text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                  aria-label="إغلاق التنبيه"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>

        {/* البحث بالاسم */}
        <div className="space-y-1 relative" ref={searchContainerRef}>
          <label
            htmlFor="pos-item-search-input"
            className="text-xs font-bold text-slate-800 flex items-center gap-1.5"
          >
            <span>الصنف:</span>
            <ShortcutBadge actionId="pos.focus_search" />
          </label>
          <div className="relative">
            <input
              id="pos-item-search-input"
              type="text"
              value={itemNameSearch}
              onChange={(e) => {
                const val = e.target.value;
                setItemSearchTerm(val);
                setIsSuggestionsOpen(val.trim().length > 0);
              }}
              onFocus={() => {
                if (itemNameSearch.trim().length > 0) {
                  setIsSuggestionsOpen(true);
                }
              }}
              onKeyDown={(e) => {
                if ((e.nativeEvent as any).__posBarcodeHandled) return;
                handleItemSearchKeyDown(e);
              }}
              placeholder="ابحث بالاسم، الكود / SKU، الباركود، أو المورد (Enter للإضافة)..."
              className="w-full min-h-[44px] pl-3 pr-9 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {isSuggestionsOpen && itemSuggestions.length > 0 && (
            <div className="absolute z-30 right-0 left-0 top-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100">
              {itemSuggestions.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectSuggestion(item)}
                  className={`w-full min-h-[44px] p-2.5 text-xs flex items-center justify-between gap-2 text-right hover:bg-slate-100 cursor-pointer transition ${
                    idx === 0 ? 'font-bold' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-900 font-bold truncate">{item.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono flex flex-wrap items-center gap-1.5">
                      <span>المتاح: {item.stockQuantity}</span>
                      {(item.sku || item.barcode) && (
                        <span>| كود: {item.sku || item.barcode}</span>
                      )}
                      {item.supplier && (
                        <span className="font-sans text-slate-400">| مورد: {item.supplier}</span>
                      )}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-cyan-800 shrink-0 tabular-nums">
                    {item.salePrice.toFixed(2)} ج.م
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 4. جدول بنود الفاتورة */}
      <div className="pt-4 border-t border-slate-200">
        <div className="rounded-lg border border-[#E2E8F0] overflow-hidden">
          <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col className="w-auto" />
              <col className="w-[54px] sm:w-[64px]" />
              <col className="w-[70px] sm:w-[90px]" />
              <col className="w-[74px] sm:w-[96px]" />
              <col className="w-[46px] sm:w-[50px]" />
            </colgroup>
            <thead className="bg-[#4CAF7A] text-white">
              <tr>
                <th className="py-2 px-2 text-right text-xs font-bold border-l border-[#3d8c5f]">
                  الصنف
                </th>
                <th className="py-2 px-1 text-center text-xs font-bold border-l border-[#3d8c5f]">
                  الكمية
                </th>
                <th className="py-2 px-1 text-center text-xs font-bold border-l border-[#3d8c5f]">
                  السعر
                </th>
                <th className="py-2 px-1 text-center text-xs font-bold border-l border-[#3d8c5f]">
                  الإجمالي
                </th>
                <th className="py-2 px-1 text-center text-xs font-bold">
                  حذف
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {cart.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                    السلة فارغة. أضف أصنافًا بالاسم أو الباركود.
                  </td>
                </tr>
              ) : (
                cart.map((c) => {
                  const isStockShortage = !isOffline && !allowNegativeStockSale && c.quantity > c.item.stockQuantity;
                  const isOfflineNeedsReview = isOffline && c.quantity > c.item.stockQuantity;
                  const isPriceViolating = Boolean(priceViolatingItemIds?.has(c.item.id));
                  const lineTotal = (c.customerUnitPrice || c.salePriceAtSale) * c.quantity;

                  const isSelectedLine = selectedCartItemId === c.item.id;

                  return (
                    <tr
                      key={c.item.id}
                      data-pos-cart-row-id={c.item.id}
                      data-selected-line={isSelectedLine ? 'true' : undefined}
                      data-price-violation={isPriceViolating ? 'true' : undefined}
                      className={`transition ${
                        isSelectedLine
                          ? 'bg-sky-50/90 ring-2 ring-inset ring-[#1668B2]'
                          : isPriceViolating || isStockShortage
                          ? 'bg-rose-50/70'
                          : isOfflineNeedsReview
                          ? 'bg-amber-50/70'
                          : 'hover:bg-slate-50/60'
                      }`}
                    >
                      <td className="py-2 px-2 text-right border-l border-[#E2E8F0] align-middle">
                        <div
                          className="text-[13px] font-bold text-slate-900 leading-snug text-right"
                          style={{ wordBreak: 'normal', overflowWrap: 'anywhere' }}
                          title={c.item.name}
                        >
                          {c.item.name}
                        </div>
                        {isPriceViolating && (
                          <span className="text-[10px] text-rose-700 font-bold block mt-0.5">
                            سعر مخالف لقواعد البيع
                          </span>
                        )}
                        {isStockShortage && (
                          <span className="text-[10px] text-rose-700 font-bold block mt-0.5">
                            تجاوز ({c.item.stockQuantity})
                          </span>
                        )}
                        {isOfflineNeedsReview && (
                          <span className="text-[10px] text-amber-800 font-bold block mt-0.5">
                            يُعلّم للمراجعة (المتاح محليًا: {c.item.stockQuantity})
                          </span>
                        )}
                      </td>

                      <td className="py-1.5 px-1 text-center border-l border-[#E2E8F0] align-middle" dir="ltr">
                        <input
                          type="number"
                          min="1"
                          data-pos-qty-input-id={c.item.id}
                          value={c.quantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val >= 1) {
                              onUpdateQuantity(c.item.id, val);
                            }
                          }}
                          onKeyDown={(e) => {
                            if ((e.nativeEvent as any).__posBarcodeHandled) return;
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              document.getElementById('pos-barcode-input')?.focus();
                            }
                          }}
                          className="w-full min-h-[38px] box-border px-1 text-center font-mono font-bold text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </td>

                      <td className="py-1.5 px-1 text-center border-l border-[#E2E8F0] align-middle" dir="ltr">
                        {canEditPriceBeforeSave && !isOffline ? (
                          <input
                            type="number"
                            step="any"
                            data-pos-price-input-id={c.item.id}
                            min={canOverrideMinPrice ? 0 : (c.item.minPrice || 0)}
                            value={c.baseUnitPrice !== undefined ? c.baseUnitPrice : c.salePriceAtSale}
                            onChange={(e) => {
                              const p = parseFloat(e.target.value);
                              if (!isNaN(p)) {
                                onUpdateLinePrice(c.item.id, p);
                              }
                            }}
                            className={`w-full min-h-[38px] box-border px-1 text-center font-mono font-bold text-xs border rounded bg-white text-slate-900 focus:outline-none focus:ring-1 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                              isPriceViolating
                                ? 'border-rose-500 ring-1 ring-rose-300 focus:ring-rose-500'
                                : 'border-slate-300 focus:ring-blue-500'
                            }`}
                            title={c.item.minPrice ? `الحد الأدنى: ${c.item.minPrice}` : ''}
                          />
                        ) : (
                          <span
                            className={`font-mono font-bold text-xs tabular-nums block text-center ${
                              isPriceViolating ? 'text-rose-700' : 'text-slate-800'
                            }`}
                            title={isOffline && canEditPriceBeforeSave ? 'متاح عند رجوع الاتصال' : undefined}
                          >
                            {Number(c.baseUnitPrice !== undefined ? c.baseUnitPrice : c.salePriceAtSale).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        )}
                        {saleMode === 'platform' && Boolean(c.bnplPercent && c.bnplPercent > 0) && (
                          <div className="mt-1 flex flex-col items-center gap-0.5" dir="rtl">
                            <span className="inline-flex items-center px-1 py-0.2 rounded text-[9px] font-extrabold text-purple-700">
                              BNPL +{c.bnplPercent}%
                            </span>
                            <span className="text-[9px] text-slate-500 font-bold font-mono tabular-nums">
                              ({Number(c.customerUnitPrice || c.salePriceAtSale).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                            </span>
                          </div>
                        )}
                      </td>

                      <td className="py-2 px-1 text-center border-l border-[#E2E8F0] align-middle" dir="ltr">
                        <span className="font-mono font-extrabold text-red-700 text-xs tabular-nums block text-center">
                          {Number(lineTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>

                      <td className="py-1 px-0.5 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => onRemoveFromCart(c.item.id)}
                          className="w-full min-h-[44px] flex items-center justify-center text-blue-600 hover:text-blue-800 font-bold text-xs cursor-pointer hover:underline transition"
                        >
                          حذف
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. قسم «تفاصيل إضافية» قابل للطي (مطوي افتراضياً): التاريخ + ملاحظات */}
      <div className="pt-4 border-t border-slate-200">
        <button
          type="button"
          onClick={() => setIsExtraDetailsOpen(prev => !prev)}
          aria-expanded={isExtraDetailsOpen}
          className="w-full min-h-[44px] flex items-center justify-between gap-2 text-xs font-bold text-slate-800 hover:text-slate-950 cursor-pointer transition"
        >
          <span>تفاصيل إضافية</span>
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-500">
            {!isExtraDetailsOpen && (
              <>
                <span className="font-mono tabular-nums">{todayFormatted}</span>
                {notes.trim() && <span>• توجد ملاحظات</span>}
              </>
            )}
            {isExtraDetailsOpen ? (
              <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
            )}
          </span>
        </button>

        {isExtraDetailsOpen && (
          <div className="pt-3 space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-800 block">التاريخ:</label>
              <input
                type="text"
                readOnly
                value={todayFormatted}
                className="w-full min-h-[44px] px-3 py-2 text-xs font-mono font-bold text-center bg-slate-100 border border-slate-300 rounded-lg text-slate-700 cursor-not-allowed select-text tabular-nums"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-800 block">
                ملاحظات:
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder={saleMode === 'platform' ? 'مثال: تفاصيل الشحنة...' : 'مثال: تفاصيل التوصيل أو ملاحظة...'}
                className="w-full min-h-[44px] px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* 6. الملخص المالي (بدون صندوق ملون، أرقام محاذاة يمين/يسار، سطور > 0 فقط ورقم واحد أبرز في الأسفل) */}
      <div className="pt-4 border-t border-slate-200 space-y-2 text-xs text-slate-700" data-testid="pos-summary-section">
        {/* المجموع */}
        <div className="flex justify-between items-center gap-2">
          <span className="font-semibold text-slate-800">المجموع:</span>
          <span className="font-mono font-bold text-slate-900 tabular-nums" dir="ltr">
            {totalBeforeDiscount.toFixed(2)} ج.م
          </span>
        </div>

        {/* سطور المنصة: تظهر فقط في وضع «بيع على منصة» وفقط لو قيمتها > 0 */}
        {saleMode === 'platform' && Number(totalBnpl || 0) > 0 && (
          <div className="flex justify-between items-center gap-2 text-purple-700 font-semibold">
            <span>تقسيط المنصة (BNPL):</span>
            <span className="font-mono font-bold tabular-nums" dir="ltr">
              - {Number(totalBnpl).toFixed(2)} ج.م
            </span>
          </div>
        )}

        {saleMode === 'platform' && totalDiscount > 0 && (
          <div className="flex justify-between items-center gap-2 text-rose-600 font-semibold">
            <span>خصم المنصة ({resolvedCommissionPct}%):</span>
            <span className="font-mono font-bold tabular-nums" dir="ltr">
              - {totalDiscount.toFixed(2)} ج.م
            </span>
          </div>
        )}

        {saleMode === 'platform' && totalPickup > 0 && (() => {
          const firstFee = cart.length > 0 ? cart[0].unitPickupFee : (selectedPlatform?.pickupFee || 0);
          const allSamePickupFee = cart.every(c => c.unitPickupFee === firstFee);
          return (
            <div className="flex justify-between items-center gap-2 text-amber-800 font-semibold">
              <span className="flex items-center gap-1">
                <PackageCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  {allSamePickupFee
                    ? `رسوم الالتقاط (${firstFee} ج.م × ${totalPiecesCount} قطعة):`
                    : 'رسوم الالتقاط (حسب الصنف):'}
                </span>
              </span>
              <span className="font-mono font-bold tabular-nums" dir="ltr">
                - {totalPickup.toFixed(2)} ج.م
              </span>
            </div>
          );
        })()}

        {/* رسوم التوصيل: في البيع المباشر تظهر فقط عند تفعيل التوصيل لمنع أي رسوم خفية أو مزدوجة من الإعداد القديم؛ وفي بيع المنصات تبقى كما هي */}
        {saleMode === 'customer' ? (
          isDeliveryOrderActive ? (
            <div className="flex justify-between items-center gap-2 text-blue-700 font-semibold">
              <span className="flex items-center gap-1">
                <Truck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>
                  رسوم التوصيل{deliveryFeeManual && canEditDeliveryFee ? ' (معدّلة)' : ''}:
                </span>
              </span>
              <span className="font-mono font-bold tabular-nums" dir="ltr">
                + {Number(effectiveDeliveryOrderFee || 0).toFixed(2)} ج.م
              </span>
            </div>
          ) : null
        ) : enableDeliveryFee ? (
          <div className="flex justify-between items-center gap-2 py-0.5">
            <label className="font-semibold text-slate-800 flex items-center gap-1">
              <Truck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>رسوم التوصيل:</span>
            </label>
            <div className="flex items-center gap-1.5" dir="ltr">
              <span className="font-bold text-slate-600">ج.م</span>
              <input
                type="number"
                min="0"
                step="any"
                value={deliveryFee}
                onChange={(e) => onDeliveryFeeChange(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                placeholder="0"
                className="w-24 min-h-[38px] px-2.5 py-1 text-xs rounded-lg border border-slate-300 font-mono font-bold text-center bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums"
              />
            </div>
          </div>
        ) : Number(deliveryFee || 0) > 0 ? (
          <div className="flex justify-between items-center gap-2 text-blue-700 font-semibold">
            <span className="flex items-center gap-1">
              <Truck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>رسوم التوصيل:</span>
            </span>
            <span className="font-mono font-bold tabular-nums" dir="ltr">
              + {Number(deliveryFee).toFixed(2)} ج.م
            </span>
          </div>
        ) : null}

        {/* ضريبة القيمة المضافة: تظهر فقط لو > 0 */}
        {totalTax > 0 && (
          <div className="flex justify-between items-center gap-2 text-cyan-900 font-semibold">
            <span className="flex items-center gap-1">
              <Percent className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
              <span>ضريبة القيمة المضافة (VAT {taxSettings.taxInclusive ? 'شاملة' : 'منفصلة'}):</span>
            </span>
            <span className="font-mono font-bold tabular-nums" dir="ltr">
              {totalTax.toFixed(2)} ج.م
            </span>
          </div>
        )}

        {/* صافي الربح التقديري */}
        {canViewProfit && totalProfit !== undefined && cart.length > 0 && (
          <div className="flex justify-between items-center gap-2 text-emerald-700 font-bold">
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>صافي الربح التقديري:</span>
            </span>
            <span className="font-mono font-extrabold tabular-nums" dir="ltr">
              {totalProfit.toFixed(2)} ج.م
            </span>
          </div>
        )}

        {/* الرقم الأبرز الوحيد في أسفل الملخص */}
        <div className="pt-2.5 mt-1 border-t border-slate-200 flex justify-between items-center gap-2 text-slate-900">
          <span className="font-extrabold text-sm sm:text-base">
            {saleMode === 'platform' ? 'صافي الاستلام من المنصة:' : 'المطلوب:'}
          </span>
          <span className="font-mono text-lg sm:text-xl font-black text-cyan-900 tabular-nums" dir="ltr">
            {netAmount.toFixed(2)} ج.م
          </span>
        </div>
      </div>

      {/* 7. التحصيل والتوصيل: في البيع على منصة يبقى السلوك الحالي كما هو؛ وفي البيع المباشر تظهر الاختيارات الواضحة (نقدي، آجل، توصيل) مع فصل التوصيل داخلياً عن طريقة التحصيل */}
      {saleMode === 'platform' ? (
        <div className="pt-4 border-t border-slate-200 space-y-3 text-xs">
          <div className="flex flex-wrap items-end gap-2.5">
            {/* طريقة الدفع على المنصة */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 block">طريقة الدفع:</label>
              <div className="inline-flex items-center p-0.5 rounded-lg border border-slate-300 bg-slate-100 pos-mode-toggle-track">
                {!platformAlwaysCredit && (
                  <button
                    type="button"
                    onClick={() => onPaymentTypeChange('نقدي')}
                    className={`min-h-[44px] px-3 rounded-md text-xs font-bold transition cursor-pointer ${
                      paymentType === 'نقدي'
                        ? 'bg-[#1678C2] text-white shadow-2xs'
                        : 'text-slate-700 hover:text-slate-900 pos-mode-toggle-inactive'
                    }`}
                  >
                    نقدي
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onPaymentTypeChange('آجل');
                    onCreditPartyTypeChange?.('platform');
                  }}
                  className={`min-h-[44px] px-3 rounded-md text-xs font-bold transition cursor-pointer ${
                    paymentType === 'آجل'
                      ? 'bg-[#1678C2] text-white shadow-2xs'
                      : 'text-slate-700 hover:text-slate-900 pos-mode-toggle-inactive'
                  }`}
                >
                  {isOffline || platformAlwaysCredit ? 'آجل (منصة)' : 'آجل'}
                </button>
              </div>
            </div>

            {showCashPaidInput && (
              <div className="space-y-1 flex-1 min-w-[140px]">
                <label
                  htmlFor="pos-paid-amount-input"
                  className="text-[11px] font-bold text-slate-700 flex items-center gap-1"
                >
                  <span>مدفوع نقدي:</span>
                  <ShortcutBadge actionId="pos.focus_paid" />
                  {paymentType === 'نقدي' && !canEditCashPaid && (
                    <span
                      title="التعديل يتطلب صلاحية تعديل المدفوع النقدي (invoices.edit_cash_paid)"
                      className="inline-flex cursor-help"
                    >
                      <Lock className="w-3 h-3 text-slate-400" />
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="pos-paid-amount-input"
                    type="number"
                    step="any"
                    min="0"
                    readOnly={isCashPaidReadOnly}
                    value={paidAmountInput}
                    onChange={(e) => {
                      if (isCashPaidReadOnly) return;
                      if (paymentType === 'نقدي') {
                        onSetManualCashOverride?.(true);
                      }
                      onPaidAmountChange(e.target.value);
                    }}
                    placeholder="0.00"
                    className={`w-full min-w-[96px] min-h-[44px] px-2.5 py-1.5 rounded-lg font-mono font-bold text-sm focus:outline-none transition tabular-nums ${
                      isCashPaidReadOnly
                        ? 'bg-slate-100 text-slate-700 cursor-not-allowed border border-slate-300 select-text'
                        : 'bg-white text-slate-900 border-2 border-red-500 focus:ring-2 focus:ring-red-400'
                    }`}
                  />
                  {paymentType === 'نقدي' && canEditCashPaid && (isManualCashOverride || !autoFillCashPaid) && (
                    <button
                      type="button"
                      onClick={() => {
                        onSetManualCashOverride?.(!autoFillCashPaid);
                        onPaidAmountChange(netAmount.toFixed(2));
                      }}
                      className="min-h-[44px] px-2.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 text-[11px] font-bold transition cursor-pointer shrink-0"
                      title="إعادة التعبئة التلقائية بالمبلغ المطلوب واستئناف التحديث"
                    >
                      = المطلوب
                    </button>
                  )}
                </div>
              </div>
            )}

            {showCashboxSelector && (
              <div className="space-y-1 flex-1 min-w-[160px]" data-testid="pos-cashbox-selector">
                <label className="text-[11px] font-bold text-slate-700 block">الخزنة:</label>
                <select
                  value={selectedCashboxId}
                  onChange={(e) => onSelectCashbox(e.target.value)}
                  className="w-full min-h-[44px] px-2.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- اختر الخزينة --</option>
                  {allowedSaleCashboxes.map(cb => (
                    <option key={cb.id} value={cb.id}>
                      {cb.name} ({cb.currentBalance} {cb.currency})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {showCashboxMissingWarning && (
            <div className="px-3 py-2 rounded-lg border border-rose-300 text-rose-700 text-xs font-bold">
              لا توجد خزينة نشطة مخصصة لك
            </div>
          )}

          {(changeToCustomer > 0 || (remainingCredit > 0 && paymentType === 'آجل') || paymentType === 'آجل') && (
            <div className="space-y-1">
              {changeToCustomer > 0 && paymentType === 'نقدي' && (
                <div className="flex items-center justify-between text-emerald-700 font-extrabold">
                  <span>الباقي للعميل:</span>
                  <span className="font-mono tabular-nums" dir="ltr">{changeToCustomer.toFixed(2)} ج.م</span>
                </div>
              )}

              {remainingCredit > 0 && paymentType === 'آجل' && (
                <div className="flex items-center justify-between text-amber-800 font-extrabold">
                  <span>الاستحقاق الآجل:</span>
                  <span className="font-mono tabular-nums" dir="ltr">{remainingCredit.toFixed(2)} ج.م</span>
                </div>
              )}

              {paymentType === 'آجل' && selectedPlatform && (
                <p className="text-[11px] text-amber-800 font-semibold">
                  تسجّل الفاتورة معلّقة على منصة «{selectedPlatform.name}» بمبلغ الصافي ({netAmount.toFixed(2)} ج.م) بدون حركة خزنة.
                </p>
              )}
            </div>
          )}

          {showDenominations && (
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleToggleDenoms}
                aria-expanded={isDenomsOpen}
                data-testid="pos-denominations-toggle"
                className="w-full min-h-[44px] flex items-center justify-between gap-2 text-xs font-bold text-slate-700 hover:text-slate-900 cursor-pointer transition"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Banknote className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>فئات العملة</span>
                </span>
                {isDenomsOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                )}
              </button>

              {isDenomsOpen && (
                <div className="pt-2 grid grid-cols-4 sm:grid-cols-8 gap-1.5" data-testid="pos-denominations-row">
                  {[1, 5, 10, 20, 50, 100, 200].map(denom => (
                    <button
                      key={denom}
                      type="button"
                      onClick={() => {
                        let current = parseFloat(paidAmountInput) || 0;
                        if (autoFillCashPaid && paymentType === 'نقدي' && !isManualCashOverride) {
                          current = 0;
                        }
                        if (paymentType === 'نقدي') {
                          onSetManualCashOverride?.(true);
                        }
                        onPaidAmountChange(String(current + denom));
                      }}
                      className="min-h-[44px] py-2 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-mono font-bold text-xs transition cursor-pointer shadow-2xs text-center tabular-nums"
                    >
                      +{denom}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      if (paymentType === 'نقدي') {
                        onSetManualCashOverride?.(true);
                      }
                      onPaidAmountChange('0.00');
                    }}
                    className="min-h-[44px] py-2 rounded-lg bg-slate-700 hover:bg-slate-800 active:bg-slate-900 text-white font-bold text-xs transition cursor-pointer shadow-2xs text-center"
                    title="تصفير المدفوع"
                  >
                    تصفير
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="pt-4 border-t border-slate-200 space-y-3 text-xs">
          {/* الصف العلوي في البيع المباشر: اختيارات التحصيل (نقدي، آجل) وبجوارها خيار التوصيل */}
          <div className="flex flex-wrap items-end justify-between gap-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 block">طريقة التحصيل:</label>
              <div
                role="group"
                aria-label="طريقة التحصيل"
                className="inline-flex items-center p-0.5 rounded-lg border border-slate-300 bg-slate-100 pos-mode-toggle-track"
              >
                <button
                  type="button"
                  disabled={isCodDelivery}
                  title={isCodDelivery ? 'في الدفع عند الاستلام يتم التحصيل عبر التوصيل عند التسوية' : undefined}
                  onClick={() => {
                    if (isCodDelivery) return;
                    onPaymentTypeChange('نقدي');
                  }}
                  className={`min-h-[44px] px-3.5 rounded-md text-xs font-bold transition ${
                    isCodDelivery
                      ? 'text-slate-400 cursor-not-allowed opacity-60'
                      : paymentType === 'نقدي'
                      ? 'bg-[#1678C2] text-white shadow-2xs cursor-pointer'
                      : 'text-slate-700 hover:text-slate-900 cursor-pointer pos-mode-toggle-inactive'
                  }`}
                >
                  نقدي
                </button>

                <button
                  type="button"
                  disabled={isCodDelivery || isOffline}
                  title={
                    isCodDelivery
                      ? 'في الدفع عند الاستلام يتم التحصيل عبر التوصيل عند التسوية'
                      : isOffline
                      ? 'متاح عند رجوع الاتصال'
                      : undefined
                  }
                  onClick={() => {
                    if (isCodDelivery || isOffline) return;
                    onPaymentTypeChange('آجل');
                    onCreditPartyTypeChange?.('customer');
                  }}
                  className={`min-h-[44px] px-3.5 rounded-md text-xs font-bold transition ${
                    isCodDelivery || isOffline
                      ? 'text-slate-400 cursor-not-allowed opacity-60'
                      : paymentType === 'آجل'
                      ? 'bg-[#1678C2] text-white shadow-2xs cursor-pointer'
                      : 'text-slate-700 hover:text-slate-900 cursor-pointer pos-mode-toggle-inactive'
                  }`}
                >
                  آجل
                </button>
              </div>
            </div>

            {isDeliveryFeatureAvailable && (
              <div className="space-y-1" data-testid="pos-delivery-toggle-group">
                <label className="text-[11px] font-bold text-slate-700 block">توصيل:</label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isDeliveryOrderActive}
                  aria-label="تفعيل التوصيل لهذه الفاتورة"
                  data-testid="pos-delivery-toggle-btn"
                  disabled={isOffline}
                  onClick={() => {
                    if (isOffline) return;
                    onDeliveryEnabledChange?.(!isDeliveryEnabled);
                  }}
                  className={`min-h-[44px] px-3 rounded-lg border text-xs font-extrabold inline-flex items-center gap-2 transition ${
                    isOffline
                      ? 'bg-slate-100 border-slate-300 text-slate-400 cursor-not-allowed opacity-70'
                      : isDeliveryOrderActive
                      ? 'bg-[#1678C2] border-[#1678C2] text-white cursor-pointer shadow-2xs'
                      : 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200 cursor-pointer'
                  }`}
                >
                  <Truck className="w-4 h-4 shrink-0" />
                  <span>{isDeliveryOrderActive ? 'توصيل: مفعّل' : 'توصيل'}</span>
                  <span
                    className={`w-4 h-4 rounded-full bg-white shadow-2xs transition-transform ${
                      isDeliveryOrderActive ? '-translate-x-0.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            )}
          </div>

          {isDeliveryFeatureAvailable && isOffline && (
            <div className="text-[11px] font-bold text-amber-700">
              التوصيل متاح عند رجوع الاتصال فقط
            </div>
          )}

          {/* حقول طلب التوصيل: تظهر فقط عند تفعيل التوصيل */}
          {isDeliveryOrderActive && (
            <div
              className="pt-3 border-t border-slate-200 space-y-3 text-xs"
              data-testid="pos-delivery-section"
            >
              {/* طريقة التحصيل بالتوصيل */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-800 block">
                  طريقة التحصيل بالتوصيل:
                </label>
                <div
                  role="group"
                  aria-label="طريقة التحصيل بالتوصيل"
                  className="grid grid-cols-2 gap-1.5 p-0.5 rounded-lg border border-slate-300 bg-slate-100 pos-mode-toggle-track"
                >
                  <button
                    type="button"
                    aria-pressed={deliveryPaymentMode === 'prepaid'}
                    onClick={() => onDeliveryPaymentModeChange?.('prepaid')}
                    className={`min-h-[44px] px-2.5 rounded-md text-xs font-bold transition cursor-pointer ${
                      deliveryPaymentMode === 'prepaid'
                        ? 'bg-[#1678C2] text-white shadow-2xs'
                        : 'text-slate-700 hover:text-slate-900 pos-mode-toggle-inactive'
                    }`}
                  >
                    مدفوع مقدمًا
                  </button>
                  <button
                    type="button"
                    aria-pressed={deliveryPaymentMode === 'cod'}
                    onClick={() => onDeliveryPaymentModeChange?.('cod')}
                    className={`min-h-[44px] px-2.5 rounded-md text-xs font-bold transition cursor-pointer ${
                      deliveryPaymentMode === 'cod'
                        ? 'bg-[#1678C2] text-white shadow-2xs'
                        : 'text-slate-700 hover:text-slate-900 pos-mode-toggle-inactive'
                    }`}
                  >
                    الدفع عند الاستلام
                  </button>
                </div>
              </div>

              {/* منطقة التوصيل (تظهر فقط عند تفعيل التسعير بالمناطق) */}
              {deliveryConfig?.settings.zonePricing && (
                <div className="space-y-1">
                  <label htmlFor="pos-delivery-zone" className="text-[11px] font-bold text-slate-800 block">
                    منطقة التوصيل *:
                  </label>
                  <select
                    id="pos-delivery-zone"
                    value={deliveryZoneId}
                    onChange={(e) => onDeliveryZoneIdChange?.(e.target.value)}
                    aria-invalid={deliveryZoneError}
                    className={`w-full min-h-[44px] px-3 py-2 text-xs font-bold rounded-lg border bg-white text-slate-900 focus:outline-none focus:ring-2 ${
                      deliveryZoneError
                        ? 'border-rose-500 ring-2 ring-rose-300 focus:ring-rose-500'
                        : 'border-slate-300 focus:ring-blue-500'
                    }`}
                  >
                    <option value="">-- اختر منطقة التوصيل --</option>
                    {(deliveryConfig?.zones || []).map(z => (
                      <option key={z.id} value={z.id}>
                        {z.name} — {Number(z.customerFee || 0).toFixed(2)} ج.م
                        {z.minOrderValue > 0 ? ` (حد أدنى ${Number(z.minOrderValue).toFixed(2)} ج.م)` : ''}
                      </option>
                    ))}
                  </select>

                  {deliveryZoneWarning && (
                    <p className="text-[11px] font-bold text-amber-800">
                      {deliveryZoneWarning}
                    </p>
                  )}

                  {selectedDeliveryZone && selectedDeliveryZone.minOrderValue > 0 && (
                    <p
                      className={`text-[11px] font-bold ${
                        isDeliveryBelowMinOrder ? 'text-rose-700' : 'text-slate-600'
                      }`}
                    >
                      {isDeliveryBelowMinOrder
                        ? `أقل قيمة طلب لمنطقة «${selectedDeliveryZone.name}» هي ${selectedDeliveryZone.minOrderValue.toFixed(2)} ج.م (قيمة الأصناف الحالية ${totalBeforeDiscount.toFixed(2)} ج.م)`
                        : `الحد الأدنى للطلب في هذه المنطقة: ${selectedDeliveryZone.minOrderValue.toFixed(2)} ج.م`}
                    </p>
                  )}
                </div>
              )}

              {/* عنوان التوصيل وموبايل التوصيل ورسوم التوصيل */}
              <div className="space-y-2">
                <div className="space-y-1">
                  <label htmlFor="pos-delivery-address" className="text-[11px] font-bold text-slate-800 block">
                    عنوان التوصيل *:
                  </label>
                  <input
                    id="pos-delivery-address"
                    type="text"
                    value={deliveryAddress}
                    onChange={(e) => onDeliveryAddressChange?.(e.target.value)}
                    placeholder="اكتب عنوان التوصيل بالتفصيل..."
                    aria-invalid={deliveryAddressError}
                    className={`w-full min-h-[44px] px-3 py-2 text-xs rounded-lg border bg-white text-slate-900 focus:outline-none focus:ring-2 ${
                      deliveryAddressError
                        ? 'border-rose-500 ring-2 ring-rose-300 focus:ring-rose-500'
                        : 'border-slate-300 focus:ring-blue-500'
                    }`}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="pos-delivery-phone" className="text-[11px] font-bold text-slate-800 block">
                      موبايل التوصيل:
                    </label>
                    <input
                      id="pos-delivery-phone"
                      type="text"
                      maxLength={30}
                      dir="ltr"
                      value={deliveryPhone}
                      onChange={(e) => onDeliveryPhoneChange?.(e.target.value)}
                      placeholder="رقم للتواصل عند التوصيل"
                      className="w-full min-h-[44px] px-3 py-2 text-xs font-mono text-right rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="pos-delivery-fee-input"
                      className="text-[11px] font-bold text-slate-800 flex items-center justify-between gap-1"
                    >
                      <span>رسوم التوصيل (ج.م):</span>
                      {!canEditDeliveryFee && (
                        <span
                          title="تعديل رسوم التوصيل يتطلب صلاحية تعديل رسوم التوصيل (delivery.edit_fee)"
                          className="inline-flex cursor-help"
                        >
                          <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                        </span>
                      )}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        id="pos-delivery-fee-input"
                        type="number"
                        min="0"
                        step="any"
                        readOnly={!canEditDeliveryFee}
                        value={canEditDeliveryFee ? deliveryOrderFeeInput : Number(computedDeliveryFee || 0).toFixed(2)}
                        onChange={(e) => {
                          if (!canEditDeliveryFee) return;
                          const val = e.target.value;
                          if (val === '') {
                            onDeliveryOrderFeeChange?.('');
                            return;
                          }
                          const num = Number(val);
                          if (!isNaN(num) && num >= 0) {
                            onDeliveryOrderFeeChange?.(num);
                          }
                        }}
                        className={`w-full min-h-[44px] px-2.5 py-2 text-xs font-mono font-bold text-center rounded-lg border tabular-nums focus:outline-none ${
                          canEditDeliveryFee
                            ? 'bg-white border-slate-300 text-slate-900 focus:ring-2 focus:ring-blue-500'
                            : 'bg-slate-100 border-slate-300 text-slate-700 cursor-not-allowed select-text'
                        }`}
                      />
                      {canEditDeliveryFee && deliveryFeeManual && (
                        <button
                          type="button"
                          onClick={() => onResetDeliveryFeeToComputed?.()}
                          className="min-h-[44px] px-2.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 text-[11px] font-bold transition cursor-pointer shrink-0"
                          title={`إرجاع للرسوم المحسوبة (${Number(computedDeliveryFee || 0).toFixed(2)} ج.م)`}
                        >
                          الافتراضي
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* اختيار مسؤول التوصيل (طيار / شركة شحن) حسب settings.mode والقوائم النشطة */}
              {hasAnyDeliveryAssigneeOptions ? (
                <div className="space-y-2 pt-1 border-t border-slate-100">
                  {deliveryMode === 'both' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label htmlFor="pos-delivery-assignee-type" className="text-[11px] font-bold text-slate-800 block">
                          مسؤول التوصيل (اختياري):
                        </label>
                        <select
                          id="pos-delivery-assignee-type"
                          value={deliveryAssigneeType}
                          onChange={(e) => {
                            const nextType = e.target.value as '' | DeliveryAssigneeType;
                            onDeliveryAssigneeTypeChange?.(nextType);
                            onDeliveryAssigneeIdChange?.('');
                            if (nextType !== 'courier') onDeliveryTrackingNumberChange?.('');
                          }}
                          className="w-full min-h-[44px] px-2.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">بدون تعيين (يُعيَّن لاحقًا)</option>
                          {availableDrivers.length > 0 && <option value="driver">طيار داخلي</option>}
                          {availableCouriers.length > 0 && <option value="courier">شركة شحن</option>}
                        </select>
                      </div>

                      {deliveryAssigneeType && (
                        <div className="space-y-1">
                          <label htmlFor="pos-delivery-assignee-id" className="text-[11px] font-bold text-slate-800 block">
                            {deliveryAssigneeType === 'driver' ? 'الطيار:' : 'شركة الشحن:'}
                          </label>
                          <select
                            id="pos-delivery-assignee-id"
                            value={deliveryAssigneeId}
                            onChange={(e) => onDeliveryAssigneeIdChange?.(e.target.value)}
                            className="w-full min-h-[44px] px-2.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">
                              {deliveryAssigneeType === 'driver' ? '-- اختر الطيار --' : '-- اختر شركة الشحن --'}
                            </option>
                            {(deliveryAssigneeType === 'driver' ? availableDrivers : availableCouriers).map(opt => (
                              <option key={opt.id} value={opt.id}>
                                {opt.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  ) : deliveryMode === 'drivers' ? (
                    <div className="space-y-1">
                      <label htmlFor="pos-delivery-driver-only" className="text-[11px] font-bold text-slate-800 block">
                        الطيار (اختياري):
                      </label>
                      <select
                        id="pos-delivery-driver-only"
                        value={deliveryAssigneeType === 'driver' ? deliveryAssigneeId : ''}
                        onChange={(e) => {
                          const id = e.target.value;
                          onDeliveryAssigneeTypeChange?.(id ? 'driver' : '');
                          onDeliveryAssigneeIdChange?.(id);
                        }}
                        className="w-full min-h-[44px] px-2.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">بدون تعيين (يُعيَّن لاحقًا)</option>
                        {availableDrivers.map(d => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label htmlFor="pos-delivery-courier-only" className="text-[11px] font-bold text-slate-800 block">
                        شركة الشحن (اختياري):
                      </label>
                      <select
                        id="pos-delivery-courier-only"
                        value={deliveryAssigneeType === 'courier' ? deliveryAssigneeId : ''}
                        onChange={(e) => {
                          const id = e.target.value;
                          onDeliveryAssigneeTypeChange?.(id ? 'courier' : '');
                          onDeliveryAssigneeIdChange?.(id);
                          if (!id) onDeliveryTrackingNumberChange?.('');
                        }}
                        className="w-full min-h-[44px] px-2.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">بدون تعيين (يُعيَّن لاحقًا)</option>
                        {availableCouriers.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {deliveryAssigneeType === 'courier' && deliveryAssigneeId && (
                    <div className="space-y-1">
                      <label htmlFor="pos-delivery-tracking" className="text-[11px] font-bold text-slate-800 block">
                        رقم البوليصة / التتبع (اختياري):
                      </label>
                      <input
                        id="pos-delivery-tracking"
                        type="text"
                        maxLength={60}
                        dir="ltr"
                        value={deliveryTrackingNumber}
                        onChange={(e) => onDeliveryTrackingNumberChange?.(e.target.value)}
                        placeholder="رقم البوليصة أو التتبع"
                        className="w-full min-h-[44px] px-3 py-2 text-xs font-mono text-right rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 font-semibold pt-1 border-t border-slate-100">
                  لا يوجد طيارون أو شركات شحن نشطة حاليًا — يمكن حفظ الطلب وتعيين المسؤول لاحقًا من شاشة التوصيل.
                </p>
              )}
            </div>
          )}

          {/* تحصيل الفاتورة في البيع المباشر */}
          {isCodDelivery ? (
            <div
              className="pt-3 border-t border-slate-200 space-y-2 text-xs"
              data-testid="pos-cod-payment-summary"
            >
              <div className="flex items-center justify-between gap-2 text-amber-900 font-extrabold">
                <span className="inline-flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>المبلغ المطلوب تحصيله عند الاستلام:</span>
                </span>
                <span className="font-mono text-base tabular-nums" dir="ltr">
                  {netAmount.toFixed(2)} ج.م
                </span>
              </div>
              <p className="text-[11px] font-semibold text-slate-600 leading-relaxed">
                الدفع عند الاستلام: لا يتم تسجيل تحصيل نقدي في الخزينة أو مديونية على حساب العميل وقت الفاتورة — يُسجّل المبلغ آجلًا على التوصيل ويُورَّد للخزينة عند التسوية.
              </p>
            </div>
          ) : (
            <div className="pt-2 border-t border-slate-100 space-y-3">
              {(showCashPaidInput || showCashboxSelector) && (
                <div className="flex flex-wrap items-end gap-2.5">
                  {showCashPaidInput && (
                    <div className="space-y-1 flex-1 min-w-[140px]">
                      <label
                        htmlFor="pos-paid-amount-input"
                        className="text-[11px] font-bold text-slate-700 flex items-center gap-1"
                      >
                        <span>مدفوع نقدي:</span>
                        <ShortcutBadge actionId="pos.focus_paid" />
                        {paymentType === 'نقدي' && !canEditCashPaid && (
                          <span
                            title="التعديل يتطلب صلاحية تعديل المدفوع النقدي (invoices.edit_cash_paid)"
                            className="inline-flex cursor-help"
                          >
                            <Lock className="w-3 h-3 text-slate-400" />
                          </span>
                        )}
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="pos-paid-amount-input"
                          type="number"
                          step="any"
                          min="0"
                          readOnly={isCashPaidReadOnly}
                          value={paidAmountInput}
                          onChange={(e) => {
                            if (isCashPaidReadOnly) return;
                            if (paymentType === 'نقدي') {
                              onSetManualCashOverride?.(true);
                            }
                            onPaidAmountChange(e.target.value);
                          }}
                          placeholder="0.00"
                          className={`w-full min-w-[96px] min-h-[44px] px-2.5 py-1.5 rounded-lg font-mono font-bold text-sm focus:outline-none transition tabular-nums ${
                            isCashPaidReadOnly
                              ? 'bg-slate-100 text-slate-700 cursor-not-allowed border border-slate-300 select-text'
                              : 'bg-white text-slate-900 border-2 border-red-500 focus:ring-2 focus:ring-red-400'
                          }`}
                        />
                        {paymentType === 'نقدي' && canEditCashPaid && (isManualCashOverride || !autoFillCashPaid) && (
                          <button
                            type="button"
                            onClick={() => {
                              onSetManualCashOverride?.(!autoFillCashPaid);
                              onPaidAmountChange(netAmount.toFixed(2));
                            }}
                            className="min-h-[44px] px-2.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 text-[11px] font-bold transition cursor-pointer shrink-0"
                            title="إعادة التعبئة التلقائية بالمبلغ المطلوب واستئناف التحديث"
                          >
                            = المطلوب
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {showCashboxSelector && (
                    <div className="space-y-1 flex-1 min-w-[160px]" data-testid="pos-cashbox-selector">
                      <label className="text-[11px] font-bold text-slate-700 block">الخزنة:</label>
                      <select
                        value={selectedCashboxId}
                        onChange={(e) => onSelectCashbox(e.target.value)}
                        className="w-full min-h-[44px] px-2.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- اختر الخزينة --</option>
                        {allowedSaleCashboxes.map(cb => (
                          <option key={cb.id} value={cb.id}>
                            {cb.name} ({cb.currentBalance} {cb.currency})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {showCashboxMissingWarning && (
                <div className="px-3 py-2 rounded-lg border border-rose-300 text-rose-700 text-xs font-bold">
                  لا توجد خزينة نشطة مخصصة لك
                </div>
              )}

              {(changeToCustomer > 0.005 ||
                isPartialCashPayment ||
                isUnderpaidOfflineDirect ||
                paymentType === 'آجل' ||
                isOffline) && (
                <div className="space-y-1">
                  {changeToCustomer > 0.005 && paymentType === 'نقدي' && (
                    <div className="flex items-center justify-between text-emerald-700 font-extrabold">
                      <span>الباقي للعميل:</span>
                      <span className="font-mono tabular-nums" dir="ltr">{changeToCustomer.toFixed(2)} ج.م</span>
                    </div>
                  )}

                  {isPartialCashPayment && (
                    <>
                      <div className="flex items-center justify-between text-amber-800 font-extrabold">
                        <span>المتبقي آجل على العميل:</span>
                        <span className="font-mono tabular-nums" dir="ltr">{remainingCredit.toFixed(2)} ج.م</span>
                      </div>
                      {!selectedCustomerId && (
                        <p className="text-[11px] text-rose-700 font-bold">
                          * يتطلب دفع جزء من الفاتورة اختيار عميل لترحيل المديونية المتبقية على حسابه
                        </p>
                      )}
                    </>
                  )}

                  {isUnderpaidOfflineDirect && (
                    <p className="text-[11px] text-rose-700 font-bold">
                      * الدفع بأقل من الإجمالي غير متاح بدون إنترنت (متاح عند رجوع الاتصال)
                    </p>
                  )}

                  {paymentType === 'آجل' && (
                    <>
                      {remainingCredit > 0 && (
                        <div className="flex items-center justify-between text-amber-800 font-extrabold">
                          <span>الاستحقاق الآجل:</span>
                          <span className="font-mono tabular-nums" dir="ltr">{remainingCredit.toFixed(2)} ج.م</span>
                        </div>
                      )}
                      {!selectedCustomerId && !isOffline && (
                        <p className="text-[11px] text-rose-700 font-bold">
                          * يشترط اختيار عميل من قائمة العملاء لإصدار فاتورة آجلة
                        </p>
                      )}
                    </>
                  )}

                  {isOffline && (
                    <p className="text-[11px] text-slate-500 font-semibold">
                      * البيع الآجل أو الدفع الجزئي للعملاء متاح عند رجوع الاتصال
                    </p>
                  )}
                </div>
              )}

              {showDenominations && (
                <div className="pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleToggleDenoms}
                    aria-expanded={isDenomsOpen}
                    data-testid="pos-denominations-toggle"
                    className="w-full min-h-[44px] flex items-center justify-between gap-2 text-xs font-bold text-slate-700 hover:text-slate-900 cursor-pointer transition"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Banknote className="w-4 h-4 text-blue-600 shrink-0" />
                      <span>فئات العملة</span>
                    </span>
                    {isDenomsOpen ? (
                      <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                    )}
                  </button>

                  {isDenomsOpen && (
                    <div className="pt-2 grid grid-cols-4 sm:grid-cols-8 gap-1.5" data-testid="pos-denominations-row">
                      {[1, 5, 10, 20, 50, 100, 200].map(denom => (
                        <button
                          key={denom}
                          type="button"
                          onClick={() => {
                            let current = parseFloat(paidAmountInput) || 0;
                            if (autoFillCashPaid && paymentType === 'نقدي' && !isManualCashOverride) {
                              current = 0;
                            }
                            if (paymentType === 'نقدي') {
                              onSetManualCashOverride?.(true);
                            }
                            onPaidAmountChange(String(current + denom));
                          }}
                          className="min-h-[44px] py-2 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-mono font-bold text-xs transition cursor-pointer shadow-2xs text-center tabular-nums"
                        >
                          +{denom}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          if (paymentType === 'نقدي') {
                            onSetManualCashOverride?.(true);
                          }
                          onPaidAmountChange('0.00');
                        }}
                        className="min-h-[44px] py-2 rounded-lg bg-slate-700 hover:bg-slate-800 active:bg-slate-900 text-white font-bold text-xs transition cursor-pointer shadow-2xs text-center"
                        title="تصفير المدفوع"
                      >
                        تصفير
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* 8. أزرار الحفظ (حفظ وطباعة، حفظ فقط) والإلغاء مثبتة في أسفل اللوحة دائماً */}
      <div className="sticky bottom-[58px] md:bottom-0 z-20 bg-white border-t border-slate-200 pt-3 pb-3 -mx-4 px-4 sm:-mx-5 sm:px-5 -mb-4 sm:-mb-5 rounded-b-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-[1.35fr_1.15fr_0.9fr] gap-2">
          <button
            type="button"
            data-testid="pos-save-and-print-btn"
            onClick={() => onCheckout('print')}
            disabled={isCheckoutDisabled}
            className="min-h-[52px] h-[52px] px-2.5 rounded-xl bg-[#4CAF7A] hover:bg-[#439e6b] disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-sm sm:text-[15px] flex items-center justify-center gap-1.5 shadow-sm transition active:scale-98 cursor-pointer"
          >
            <Printer className="w-4 h-4 shrink-0" />
            <span>{isSubmitting ? 'جاري الحفظ...' : 'حفظ وطباعة'}</span>
            <ShortcutBadge actionId="pos.save_and_print" />
          </button>

          <button
            type="button"
            data-testid="pos-save-only-btn"
            onClick={() => onCheckout('no_print')}
            disabled={isCheckoutDisabled}
            className="min-h-[52px] h-[52px] px-2.5 rounded-xl bg-[#1678C2] hover:bg-[#1366a6] disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-sm sm:text-[15px] flex items-center justify-center gap-1.5 shadow-sm transition active:scale-98 cursor-pointer"
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>{isSubmitting ? 'جاري الحفظ...' : 'حفظ فقط'}</span>
            <ShortcutBadge actionId="pos.save_only" />
          </button>

          <button
            type="button"
            data-testid="pos-cancel-invoice-btn"
            onClick={() => {
              if (cart.length === 0) return;
              setIsCancelConfirmOpen(true);
            }}
            disabled={isCancelDisabled}
            className="min-h-[52px] h-[52px] px-2.5 rounded-xl border-2 border-red-600 text-red-600 bg-transparent hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed font-extrabold text-sm sm:text-[15px] flex items-center justify-center gap-1.5 transition active:scale-98 cursor-pointer pos-cancel-outline-btn"
          >
            <X className="w-4 h-4 shrink-0" />
            <span>إلغاء</span>
            <ShortcutBadge actionId="pos.cancel_invoice" />
          </button>
        </div>
      </div>

      {/* مودال تأكيد إلغاء الفاتورة */}
      {isCancelConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-shortcut-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          dir="rtl"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 border border-slate-200 shadow-xl space-y-4 text-right">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h4 className="font-extrabold text-sm text-slate-900">تأكيد إلغاء الفاتورة</h4>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={() => setIsCancelConfirmOpen(false)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>
            <p className="text-xs font-bold text-slate-700 leading-relaxed">
              هل تريد بالتأكيد إلغاء الفاتورة الحالية وتفريغ السلة؟
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCancelConfirmOpen(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer transition"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCancelConfirmOpen(false);
                  onClearCart();
                }}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold cursor-pointer transition"
              >
                نعم، إلغاء الفاتورة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Customer Modal */}
      {isQuickCustomerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-shortcut-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 border border-slate-200 shadow-xl space-y-4 animate-scaleIn text-right">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h4 className="font-extrabold text-sm text-slate-900">إضافة عميل سريع</h4>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={() => setIsQuickCustomerOpen(false)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-slate-600 text-xs cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            {customerModalError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                {customerModalError}
              </div>
            )}

            <form onSubmit={handleSaveQuickCustomer} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">اسم العميل *:</label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="اسم العميل الكامل..."
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">الموبايل:</label>
                <input
                  type="text"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  placeholder="رقم الهاتف..."
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">العنوان:</label>
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  placeholder="العنوان أو المدينة..."
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isSavingCustomer}
                  className="flex-1 min-h-[44px] py-2.5 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white font-bold transition disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-1.5"
                >
                  <span>{isSavingCustomer ? 'جاري الحفظ...' : 'حفظ واختيار العميل'}</span>
                  <ShortcutBadge actionId="general.save_form" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsQuickCustomerOpen(false)}
                  className="min-h-[44px] px-3 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

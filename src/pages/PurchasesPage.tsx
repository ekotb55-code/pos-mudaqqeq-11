import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Supplier,
  SupplierGroup,
  SupplierLedgerEntry,
  Purchase,
  PurchaseLine,
  PurchaseReturn,
  Cashbox,
  Item,
  PageType,
  UserAccount,
  UserRole,
  BarcodeScanQuantityMode
} from '../types';
import { api } from '../api/client';
import { hasPermission } from '../utils/permissions';
import { generateIdempotencyKey } from '../utils/idempotency';
import {
  Plus,
  Download,
  Search,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Printer,
  Ban,
  RefreshCw,
} from 'lucide-react';
import { PurchaseTerminalView } from '../components/PurchaseTerminalView';
import { PurchaseReturnTerminalView } from '../components/PurchaseReturnTerminalView';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { DateRange, getDateRangeForPreset, isDateInRange, normalizeArabicText } from '../utils/dateUtils';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  ModalShell,
  ReportSummaryTable,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
} from '../components/ui';
import { ShortcutBadge } from '../context/KeyboardShortcutsContext';
import { getHrefForTarget, isPlainLeftClick } from '../config/navigation';

interface PurchasesPageProps {
  items: Item[];
  user: UserAccount | null;
  userRole: UserRole;
  barcodeScanMode?: BarcodeScanQuantityMode;
  purchaseLatestItemFirst?: boolean;
  purchaseReturnLatestItemFirst?: boolean;
  onRefreshItems?: () => void;
  initialTab?: TabType;
  initialSupplierId?: string;
  onNavigate?: (
    page: PageType,
    tab?: string,
    options?: { searchParams?: Record<string, string | undefined>; replace?: boolean }
  ) => void;
}

type TabType =
  | 'PURCHASES'
  | 'TODAY'
  | 'SUPPLIERS'
  | 'GROUPS'
  | 'BALANCES'
  | 'STATEMENT'
  | 'RETURN'
  | 'PAYMENT_VOUCHER'
  | 'RECEIPT_VOUCHER';

export const PurchasesPage: React.FC<PurchasesPageProps> = ({
  items,
  user,
  userRole,
  barcodeScanMode,
  purchaseLatestItemFirst = false,
  purchaseReturnLatestItemFirst = false,
  onRefreshItems,
  initialTab,
  initialSupplierId,
  onNavigate,
}) => {
  const isDesigner = user?.role === 'designer' || Boolean(user?.isOwner);
  const isManager = isDesigner || userRole === 'manager';
  const canCreatePurchases = isDesigner || isManager || hasPermission(user, 'purchases.create');

  const [activeTab, setActiveTab] = useState<TabType>(initialTab || 'PURCHASES');

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // البيانات
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierGroups, setSupplierGroups] = useState<SupplierGroup[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [selectedSupplierForLedger, setSelectedSupplierForLedger] = useState<string>(() => initialSupplierId || '');

  useEffect(() => {
    if (initialSupplierId) {
      setSelectedSupplierForLedger(initialSupplierId);
    }
  }, [initialSupplierId]);
  const [supplierLedger, setSupplierLedger] = useState<SupplierLedgerEntry[]>([]);
  const [ledgerOpeningBalanceForPeriod, setLedgerOpeningBalanceForPeriod] = useState<number>(0);
  const [ledgerClosingBalanceForPeriod, setLedgerClosingBalanceForPeriod] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSubmittingVoucher, setIsSubmittingVoucher] = useState(false);
  const [voucherError, setVoucherError] = useState<{ message: string; isUnknownResult: boolean } | null>(null);
  const voucherIdemKeyRef = useRef<string>(generateIdempotencyKey());
  const voucherFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    voucherIdemKeyRef.current = generateIdempotencyKey();
    setVoucherError(null);
  }, [activeTab]);

  // فلاتر البحث والتاريخ لكل تبويب (الافتراضي THIS_MONTH)
  const [searchQuery, setSearchQuery] = useState('');
  const [purchasesDateRange, setPurchasesDateRange] = useState<DateRange>(() => getDateRangeForPreset('THIS_MONTH'));
  const [returnsDateRange, setReturnsDateRange] = useState<DateRange>(() => getDateRangeForPreset('THIS_MONTH'));
  const [ledgerDateRange, setLedgerDateRange] = useState<DateRange>(() => getDateRangeForPreset('THIS_MONTH'));
  const [vouchersDateRange, setVouchersDateRange] = useState<DateRange>(() => getDateRangeForPreset('THIS_MONTH'));

  // نماذج ومودات العرض
  const [viewMode, setViewMode] = useState<'list' | 'new_purchase' | 'new_return'>('list');
  const [isNewPurchaseModalOpen, setIsNewPurchaseModalOpen] = useState(false);
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isVoucherModalOpen, setIsVoucherModalOpen] = useState<'PAYMENT' | 'RECEIPT' | null>(null);
  const [selectedPurchaseForDetails, setSelectedPurchaseForDetails] = useState<Purchase | null>(null);
  const [purchaseToCancel, setPurchaseToCancel] = useState<Purchase | null>(null);
  const [purchaseCancelReason, setPurchaseCancelReason] = useState('');
  const [isCancellingPurchase, setIsCancellingPurchase] = useState(false);
  const [purchaseCancelError, setPurchaseCancelError] = useState<string | null>(null);

  const handleConfirmCancelPurchase = async () => {
    if (!purchaseToCancel) return;
    setIsCancellingPurchase(true);
    setPurchaseCancelError(null);
    try {
      const res = await api.cancelPurchase(purchaseToCancel.invoiceNumber, purchaseCancelReason);
      if (res.success) {
        setPurchaseToCancel(null);
        await loadInitialData();
      } else {
        setPurchaseCancelError(res.error || 'فشل إلغاء فاتورة الشراء');
      }
    } catch (err: any) {
      setPurchaseCancelError(err.message || 'حدث خطأ أثناء إلغاء فاتورة الشراء');
    } finally {
      setIsCancellingPurchase(false);
    }
  };

  // جلب البيانات الأولية
  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const [supRes, grpRes, purRes, retRes, cbRes] = await Promise.all([
        api.getSuppliers().catch(() => ({ success: false, suppliers: [] })),
        api.getSupplierGroups().catch(() => ({ success: false, groups: [] })),
        api.getPurchases().catch(() => ({ success: false, purchases: [] })),
        api.getPurchaseReturns().catch(() => ({ success: false, returns: [] })),
        api.getCashboxes().catch(() => ({ success: false, cashboxes: [] }))
      ]);

      if (supRes.success) setSuppliers(supRes.suppliers);
      if (grpRes.success) setSupplierGroups(grpRes.groups);
      if (purRes.success) setPurchases(purRes.purchases);
      if (retRes.success) setPurchaseReturns(retRes.returns);
      if (cbRes.success) setCashboxes(cbRes.cashboxes);

      if (supRes.suppliers.length > 0 && !selectedSupplierForLedger && !initialSupplierId) {
        setSelectedSupplierForLedger(supRes.suppliers[0].id);
      }
    } catch (err: any) {
      console.error('فشل تحميل بيانات المشتريات:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // جلب كشف حساب المورد عند تغيير المورد أو الفترة أو التبويب
  useEffect(() => {
    if (selectedSupplierForLedger && (activeTab === 'STATEMENT' || activeTab === 'SUPPLIERS' || activeTab === 'PAYMENT_VOUCHER' || activeTab === 'RECEIPT_VOUCHER')) {
      const range = (activeTab === 'PAYMENT_VOUCHER' || activeTab === 'RECEIPT_VOUCHER') ? vouchersDateRange : ledgerDateRange;
      api.getSupplierLedger({
        supplierId: selectedSupplierForLedger,
        from: range.from,
        to: range.to
      })
        .then(res => {
          if (res.success) {
            setSupplierLedger(res.ledger || []);
            setLedgerOpeningBalanceForPeriod(res.openingBalanceForPeriod ?? 0);
            setLedgerClosingBalanceForPeriod(res.closingBalanceForPeriod ?? 0);
          }
        })
        .catch(() => {});
    }
  }, [selectedSupplierForLedger, ledgerDateRange.from, ledgerDateRange.to, vouchersDateRange.from, vouchersDateRange.to, activeTab]);

  const showNotification = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // مشتريات اليوم
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayPurchases = useMemo(() => {
    return purchases.filter(p => isDateInRange(p.date, todayStr, todayStr));
  }, [purchases, todayStr]);

  // تصفية فواتير الشراء بالتاريخ والبحث
  const filteredPurchases = useMemo(() => {
    const normQ = normalizeArabicText(searchQuery);
    return purchases.filter(p => {
      if (!isDateInRange(p.date, purchasesDateRange.from, purchasesDateRange.to)) {
        return false;
      }
      if (!normQ) return true;
      const haystack = normalizeArabicText(
        `${p.invoiceNumber || ''} ${p.supplierName || ''} ${p.notes || ''} ${p.supplierInvoiceNumber || ''}`
      );
      return haystack.includes(normQ);
    });
  }, [purchases, searchQuery, purchasesDateRange.from, purchasesDateRange.to]);

  // تصفية مرتجعات الشراء بالتاريخ والبحث
  const filteredPurchaseReturns = useMemo(() => {
    const normQ = normalizeArabicText(searchQuery);
    return purchaseReturns.filter(r => {
      if (!isDateInRange(r.date, returnsDateRange.from, returnsDateRange.to)) {
        return false;
      }
      if (!normQ) return true;
      const haystack = normalizeArabicText(
        `${r.returnNumber || ''} ${r.purchaseInvoiceNumber || ''} ${r.supplierName || ''} ${r.reason || ''}`
      );
      return haystack.includes(normQ);
    });
  }, [purchaseReturns, searchQuery, returnsDateRange.from, returnsDateRange.to]);

  // إحصائيات سريعة على الفترة المفلترة
  const totalPurchasesAmount = filteredPurchases.reduce((sum, p) => sum + (p.netAmount ?? p.netTotal ?? 0), 0);
  const totalPaidAmount = filteredPurchases.reduce((sum, p) => sum + p.paidAmount, 0);
  const totalRemainingDebt = filteredPurchases.reduce((sum, p) => sum + p.remainingAmount, 0);
  const todayTotalAmount = todayPurchases.reduce((sum, p) => sum + (p.netAmount ?? p.netTotal ?? 0), 0);
  // مجموع المديونية الخاصة بالموردين كلهم
  const totalSuppliersDebt = suppliers.reduce((sum, s) => sum + (Number(s.currentBalance) || 0), 0);

  // حساب سطور كشف حساب المورد مع رصيد أول المدة والرصيد التراكمي
  const isLedgerFilteredByDate = Boolean(ledgerDateRange.from || ledgerDateRange.to);
  const computedSupplierLedgerRows = useMemo(() => {
    let running = isLedgerFilteredByDate ? ledgerOpeningBalanceForPeriod : 0;
    return supplierLedger.map((entry) => {
      if (isLedgerFilteredByDate) {
        running = Number((running + (Number(entry.credit) || 0) - (Number(entry.debit) || 0)).toFixed(2));
        return { ...entry, computedBalanceAfter: running };
      }
      running = Number(entry.balanceAfter ?? running);
      return { ...entry, computedBalanceAfter: running };
    });
  }, [supplierLedger, isLedgerFilteredByDate, ledgerOpeningBalanceForPeriod]);

  const finalSupplierClosingBalance = useMemo(() => {
    if (computedSupplierLedgerRows.length > 0) {
      return computedSupplierLedgerRows[computedSupplierLedgerRows.length - 1].computedBalanceAfter;
    }
    return isLedgerFilteredByDate ? ledgerOpeningBalanceForPeriod : ledgerClosingBalanceForPeriod;
  }, [computedSupplierLedgerRows, isLedgerFilteredByDate, ledgerOpeningBalanceForPeriod, ledgerClosingBalanceForPeriod]);

  // تصفية الموردين
  const filteredSuppliers = useMemo(() => {
    const normQ = normalizeArabicText(searchQuery);
    return suppliers.filter(s => {
      if (!normQ) return true;
      const haystack = normalizeArabicText(`${s.name || ''} ${s.phone || ''} ${s.code || ''} ${s.taxNumber || ''}`);
      return haystack.includes(normQ);
    });
  }, [suppliers, searchQuery]);

  // تصدير فواتير الشراء المفلترة
  const handleExportPurchases = () => {
    const list = activeTab === 'TODAY' ? todayPurchases : filteredPurchases;
    if (list.length === 0) return;
    const rows = list.map(p => ({
      'رقم الفاتورة': p.invoiceNumber,
      'التاريخ': p.date.slice(0, 10),
      'المورد': p.supplierName,
      'عدد الأصناف': p.lines.length,
      'الإجمالي': p.netAmount ?? p.netTotal ?? 0,
      'المسدد': p.paidAmount,
      'المتبقي': p.remainingAmount,
      'طريقة الدفع': p.paymentType || p.paymentMethod || 'نقدي',
      'الخزينة': p.cashboxName || '-',
      'المستخدم': p.userName || p.createdBy
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'فواتير_الشراء');
    XLSX.writeFile(wb, `فواتير_الشراء_${purchasesDateRange.from || todayStr}.xlsx`);
    showNotification('success', 'تم تصدير فواتير الشراء للفترة المحددة');
  };

  // تصدير مرتجعات الشراء المفلترة
  const handleExportPurchaseReturns = () => {
    if (filteredPurchaseReturns.length === 0) return;
    const rows = filteredPurchaseReturns.map(r => ({
      'رقم المرتجع': r.returnNumber,
      'التاريخ': r.date.slice(0, 10),
      'فاتورة الشراء': r.purchaseInvoiceNumber || '-',
      'المورد': r.supplierName,
      'إجمالي المرتجع': r.totalAmount,
      'المسترد نقداً': r.refundedAmount ?? r.totalAmount,
      'الخزينة': r.cashboxName || '-',
      'السبب': r.reason || '-',
      'المستخدم': r.userName || r.createdBy
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'مرتجعات_الشراء');
    XLSX.writeFile(wb, `مرتجعات_الشراء_${returnsDateRange.from || todayStr}.xlsx`);
    showNotification('success', 'تم تصدير مرتجعات الشراء للفترة المحددة');
  };

  // تصدير كشف مديونية الموردين
  const handleExportBalances = () => {
    if (suppliers.length === 0) return;
    const rows = suppliers.map(s => ({
      'كود المورد': s.code || '',
      'اسم المورد': s.name,
      'رقم الهاتف': s.phone || '',
      'الرقم الضريبي': s.taxNumber || '',
      'الرصيد الافتتاحي': s.openingBalance,
      'الرصيد الحالي المستحق': s.currentBalance,
      'الحالة': s.status
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'مديونية_الموردين');
    XLSX.writeFile(wb, `مديونية_الموردين_${todayStr}.xlsx`);
    showNotification('success', 'تم تصدير كشف مديونية الموردين بنجاح');
  };

  // تصدير كشف حساب المورد المحدد
  const handleExportLedger = () => {
    const currentSup = suppliers.find(s => s.id === selectedSupplierForLedger);
    const rows: any[] = [];
    if (isLedgerFilteredByDate) {
      rows.push({
        'التاريخ': ledgerDateRange.from || '-',
        'نوع المعاملة': `رصيد أول المدة (قبل ${ledgerDateRange.from || 'البداية'})`,
        'رقم المستند': '-',
        'البيان': 'رصيد افتتاحي للفترة المختارة',
        'مدين (لنا)': 0,
        'دائن (له)': 0,
        'الرصيد التراكمي': ledgerOpeningBalanceForPeriod
      });
    }
    computedSupplierLedgerRows.forEach(l => {
      rows.push({
        'التاريخ': l.date.slice(0, 10),
        'نوع المعاملة': l.transactionType,
        'رقم المستند': l.documentNumber,
        'البيان': l.statement || l.notes || '',
        'مدين (لنا)': l.debit,
        'دائن (له)': l.credit,
        'الرصيد التراكمي': l.computedBalanceAfter
      });
    });
    rows.push({
      'التاريخ': ledgerDateRange.to || todayStr,
      'نوع المعاملة': 'رصيد آخر المدة',
      'رقم المستند': '-',
      'البيان': 'الرصيد الختامي بنهاية الفترة',
      'مدين (لنا)': computedSupplierLedgerRows.reduce((s, r) => s + (r.debit || 0), 0),
      'دائن (له)': computedSupplierLedgerRows.reduce((s, r) => s + (r.credit || 0), 0),
      'الرصيد التراكمي': finalSupplierClosingBalance
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'كشف_الحساب');
    XLSX.writeFile(wb, `كشف_حساب_${currentSup?.name || 'مورد'}_${todayStr}.xlsx`);
    showNotification('success', 'تم تصدير كشف الحساب بنجاح');
  };

  if (viewMode === 'new_purchase') {
    return (
      <>
        <PurchaseTerminalView
          items={items}
          suppliers={suppliers}
          cashboxes={cashboxes}
          user={user}
          barcodeScanMode={barcodeScanMode}
          latestItemFirst={purchaseLatestItemFirst}
          onBack={() => setViewMode('list')}
          onSuccess={() => {
            setViewMode('list');
            loadInitialData();
            if (onRefreshItems) onRefreshItems();
            showNotification('success', 'تم حفظ فاتورة الشراء وزيادة أرصدة الأصناف وتحديث حساب المورد');
          }}
          onOpenSupplierModal={() => {
            setEditingSupplier(null);
            setIsSupplierModalOpen(true);
          }}
        />
        {isSupplierModalOpen && (
          <SupplierModal
            supplier={editingSupplier}
            groups={supplierGroups}
            onClose={() => setIsSupplierModalOpen(false)}
            onSuccess={() => {
              setIsSupplierModalOpen(false);
              loadInitialData();
              showNotification('success', 'تم حفظ بيانات المورد بنجاح');
            }}
          />
        )}
      </>
    );
  }

  if (viewMode === 'new_return') {
    return (
      <PurchaseReturnTerminalView
        purchases={purchases}
        purchaseReturns={purchaseReturns}
        suppliers={suppliers}
        cashboxes={cashboxes}
        items={items}
        user={user}
        barcodeScanMode={barcodeScanMode}
        latestItemFirst={purchaseReturnLatestItemFirst}
        onBack={() => setViewMode('list')}
        onSuccess={() => {
          setViewMode('list');
          loadInitialData();
          if (onRefreshItems) onRefreshItems();
          showNotification('success', 'تم تسجيل مرتجع المشتريات وخصم الكميات من المخزن وتحديث الحسابات');
        }}
      />
    );
  }

  const supplierVoucherRows = useMemo(
    () => supplierLedger.filter(l => l.transactionType.includes('سند')),
    [supplierLedger]
  );

  const purchaseHeaderMeta: Record<TabType, { title: string; subtitle: string }> = {
    PURCHASES: {
      title: 'فواتير الشراء',
      subtitle: 'عرض ومراجعة فواتير الشراء وتوريد المخزون',
    },
    TODAY: {
      title: `مشتريات اليوم (${todayPurchases.length})`,
      subtitle: 'فواتير الشراء المسجلة خلال اليوم الحالي',
    },
    SUPPLIERS: {
      title: `الموردين (${suppliers.length})`,
      subtitle: 'دليل الموردين وبيانات الاتصال والأرصدة الحالية',
    },
    GROUPS: {
      title: `مجموعات الموردين (${supplierGroups.length})`,
      subtitle: 'تصنيفات ومجموعات الموردين',
    },
    BALANCES: {
      title: 'كشف مديونية الموردين',
      subtitle: 'ملخص الأرصدة الافتتاحية والمستحقة لجميع الموردين',
    },
    STATEMENT: {
      title: 'كشف حساب المورد',
      subtitle: 'حركات الفواتير والمرتجعات وسندات الصرف والقبض للمورد',
    },
    RETURN: {
      title: `مرتجع المشتريات (${purchaseReturns.length})`,
      subtitle: 'تسجيل ومراجعة مرتجعات المشتريات للموردين',
    },
    PAYMENT_VOUCHER: {
      title: 'سند صرف لمورد',
      subtitle: 'تسجيل ومتابعة سندات الصرف النقدي للموردين',
    },
    RECEIPT_VOUCHER: {
      title: 'سند قبض من مورد',
      subtitle: 'تسجيل ومتابعة سندات القبض النقدي من الموردين',
    },
  };

  const currentHeaderMeta = purchaseHeaderMeta[activeTab] || purchaseHeaderMeta.PURCHASES;

  return (
    <PageSurface
      dir="rtl"
      title={currentHeaderMeta.title}
      subtitle={currentHeaderMeta.subtitle}
      actions={
        <>
          {(activeTab === 'PURCHASES' || activeTab === 'TODAY') && (
            <button
              type="button"
              data-shortcut-add="true"
              onClick={() => setViewMode('new_purchase')}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>فاتورة شراء جديدة</span>
              <ShortcutBadge actionId="general.add_new" className="bg-white/20 text-white border-white/30" />
            </button>
          )}

          {(activeTab === 'SUPPLIERS' || activeTab === 'BALANCES') && (
            <button
              type="button"
              data-shortcut-add="true"
              onClick={() => {
                setEditingSupplier(null);
                setIsSupplierModalOpen(true);
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مورد</span>
              <ShortcutBadge actionId="general.add_new" />
            </button>
          )}
        </>
      }
    >
      {/* Status Alert */}
      {statusMessage && (
        <div
          className={`no-print p-3 rounded-lg border text-xs font-bold flex items-center gap-2 ${
            statusMessage.type === 'success'
              ? 'border-emerald-300 text-emerald-800 bg-emerald-50/40'
              : 'border-rose-300 ui-stock-out bg-rose-50/40'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Compact single-line summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border-subtle)]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]">
          <span>
            إجمالي المشتريات:{' '}
            <strong className="font-mono ui-money-purchase">{totalPurchasesAmount.toLocaleString()} ج.م</strong>
            {' '}({purchases.length} فواتير)
          </span>
          <span>·</span>
          <span>
            الموردون: <strong className="font-mono text-[var(--text-primary)]">{suppliers.length}</strong>
          </span>
          <span>·</span>
          <span>
            مديونية الموردين:{' '}
            <strong className="font-mono ui-stock-low">{totalSuppliersDebt.toLocaleString()} ج.م</strong>
          </span>
          {isLoading && <span className="text-[11px]">جاري التحديث...</span>}
        </div>
      </div>

      {/* TAB 1 & 2: PURCHASES LIST */}
      {(activeTab === 'PURCHASES' || activeTab === 'TODAY') && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            {activeTab === 'PURCHASES' && (
              <DateRangeFilter
                inline
                value={purchasesDateRange}
                onChange={setPurchasesDateRange}
                storageKey="purchases_list"
                defaultPreset="THIS_MONTH"
              />
            )}

            <div className="no-print flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  بحث في الفواتير
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="رقم الفاتورة، اسم المورد، أو الملاحظات..."
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} pr-9 text-xs`}
                  />
                  <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportPurchases}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>تصدير Excel</span>
              </button>

              <button
                type="button"
                data-shortcut-print="true"
                onClick={() => window.print()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة</span>
                <ShortcutBadge actionId="general.print_page" />
              </button>

              <button
                type="button"
                onClick={() => setViewMode('new_purchase')}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>فاتورة جديدة</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]">
            <span>
              إجمالي مشتريات الفترة:{' '}
              <strong className="font-mono text-[var(--text-primary)]">
                {(activeTab === 'TODAY' ? todayTotalAmount : totalPurchasesAmount).toLocaleString()} ج.م
              </strong>
            </span>
            <span>·</span>
            <span>
              المسدد خلال الفترة:{' '}
              <strong className="font-mono ui-money-sale">{totalPaidAmount.toLocaleString()} ج.م</strong>
            </span>
            <span>·</span>
            <span>
              المتبقي كدين للفترة:{' '}
              <strong className="font-mono ui-stock-low">{totalRemainingDebt.toLocaleString()} ج.م</strong>
            </span>
          </div>

          <CompactTable ariaLabel="جدول فواتير الشراء">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_NUM_CLASS}>رقم الفاتورة</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>المورد</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الأصناف</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الإجمالي</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>المسدد</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>المتبقي</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الدفع</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>الخزينة</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>المستخدم</th>
                <th className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {(activeTab === 'TODAY' ? todayPurchases : filteredPurchases).length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد فواتير شراء مسجلة تطابق البحث
                  </td>
                </tr>
              ) : (
                (activeTab === 'TODAY' ? todayPurchases : filteredPurchases).map(p => (
                  <tr key={p.invoiceNumber}>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-link`}>{p.invoiceNumber}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {p.date.slice(0, 10)}
                    </td>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{p.supplierName}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>{p.lines.length}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>
                      {(p.netAmount ?? p.netTotal ?? 0).toLocaleString()} ج.م
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-sale`}>
                      {p.paidAmount.toLocaleString()} ج.م
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-stock-low`}>
                      {p.remainingAmount > 0 ? `${p.remainingAmount.toLocaleString()} ج.م` : '—'}
                    </td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>
                      <span
                        className={`font-bold ${
                          (p.paymentType || p.paymentMethod) === 'نقدي'
                            ? 'ui-money-sale'
                            : (p.paymentType || p.paymentMethod) === 'آجل'
                            ? 'ui-stock-low'
                            : 'ui-link'
                        }`}
                      >
                        {p.paymentType || p.paymentMethod || 'نقدي'}
                      </span>
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{p.cashboxName || '—'}</td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{p.userName || p.createdBy}</td>
                    <td className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedPurchaseForDetails(p)}
                          className="min-h-[44px] px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs transition cursor-pointer"
                        >
                          التفاصيل
                        </button>
                        {canCreatePurchases && p.receivingStatus !== 'ملغاة' && (
                          <button
                            type="button"
                            onClick={() => {
                              setPurchaseToCancel(p);
                              setPurchaseCancelReason('');
                              setPurchaseCancelError(null);
                            }}
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-out text-xs font-bold transition cursor-pointer"
                            title="إلغاء فاتورة الشراء بقيد عكسي معتمد"
                            aria-label="إلغاء فاتورة الشراء"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* TAB 3: SUPPLIERS */}
      {activeTab === 'SUPPLIERS' && (
        <div className="space-y-4">
          <div className="no-print flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">بحث في الموردين</label>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="اسم المورد، الهاتف، الكود، أو الضريبي..."
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} pr-9 text-xs`}
                />
                <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setEditingSupplier(null);
                setIsSupplierModalOpen(true);
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مورد جديد</span>
            </button>
          </div>

          <CompactTable ariaLabel="دليل الموردين">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_TEXT_CLASS}>الاسم</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الكود</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>المجموعة</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الهاتف</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>العنوان</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد المستحق</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الحالة</th>
                <th className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا يوجد موردون مطابقون للبحث
                  </td>
                </tr>
              ) : (
                filteredSuppliers.map(s => {
                  const grp = supplierGroups.find(g => g.id === s.groupId);
                  return (
                    <tr key={s.id}>
                      <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{s.name}</td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                        {s.code || '—'}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{grp?.name || '—'}</td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{s.phone || '—'}</td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{s.address || '—'}</td>
                      <td
                        className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ${
                          s.currentBalance > 0 ? 'ui-stock-low' : 'text-[var(--text-primary)]'
                        }`}
                      >
                        {s.currentBalance.toLocaleString()} ج.م
                      </td>
                      <td className={COMPACT_TABLE_NUM_CLASS}>{s.status}</td>
                      <td className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>
                        <div className="inline-flex items-center gap-1.5">
                          <a
                            href={getHrefForTarget('purchases', 'STATEMENT', {
                              searchParams: { supplierId: s.id }
                            })}
                            onClick={(e) => {
                              if (!isPlainLeftClick(e)) return;
                              e.preventDefault();
                              setSelectedSupplierForLedger(s.id);
                              if (onNavigate) {
                                onNavigate('purchases', 'STATEMENT', {
                                  searchParams: { supplierId: s.id }
                                });
                              } else {
                                setActiveTab('STATEMENT');
                              }
                            }}
                            className="min-h-[44px] inline-flex items-center px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-link text-xs font-bold cursor-pointer"
                          >
                            كشف الحساب
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSupplier(s);
                              setIsSupplierModalOpen(true);
                            }}
                            className="min-h-[44px] px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer"
                          >
                            تعديل
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* TAB 4: SUPPLIER GROUPS */}
      {activeTab === 'GROUPS' && (
        <div className="space-y-4">
          <SectionHeading
            title={`مجموعات وتصنيفات الموردين (${supplierGroups.length})`}
            actions={
              <button
                type="button"
                data-shortcut-add="true"
                onClick={() => setIsGroupModalOpen(true)}
                className="no-print min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة مجموعة جديدة</span>
                <ShortcutBadge actionId="general.add_new" className="bg-white/20 text-white border-white/30" />
              </button>
            }
          />

          <CompactTable ariaLabel="جدول مجموعات الموردين">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_TEXT_CLASS}>اسم المجموعة</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>عدد الموردين</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>الوصف</th>
              </tr>
            </thead>
            <tbody>
              {supplierGroups.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد مجموعات مسجلة
                  </td>
                </tr>
              ) : (
                supplierGroups.map(g => {
                  const count = suppliers.filter(s => s.groupId === g.id).length;
                  return (
                    <tr key={g.id}>
                      <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{g.name}</td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>{count} مورد</td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{g.description || '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* TAB 5: SUPPLIER BALANCES STATEMENT */}
      {activeTab === 'BALANCES' && (
        <div className="space-y-4">
          <SectionHeading
            title="كشف مديونية الموردين الإجمالي"
            actions={
              <button
                type="button"
                onClick={handleExportBalances}
                className="no-print min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>تصدير Excel</span>
              </button>
            }
          />

          <CompactTable ariaLabel="جدول مديونية الموردين">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_TEXT_CLASS}>اسم المورد</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الهاتف</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد الافتتاحي</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد المستحق الحالي</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الحالة</th>
                <th className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>كشف الحساب</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد بيانات موردين
                  </td>
                </tr>
              ) : (
                suppliers.map(s => (
                  <tr key={s.id}>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{s.name}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {s.phone || '—'}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {s.openingBalance.toLocaleString()} ج.م
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-stock-low`}>
                      {s.currentBalance.toLocaleString()} ج.م
                    </td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>{s.status}</td>
                    <td className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>
                      <a
                        href={getHrefForTarget('purchases', 'STATEMENT', {
                          searchParams: { supplierId: s.id }
                        })}
                        onClick={(e) => {
                          if (!isPlainLeftClick(e)) return;
                          e.preventDefault();
                          setSelectedSupplierForLedger(s.id);
                          if (onNavigate) {
                            onNavigate('purchases', 'STATEMENT', {
                              searchParams: { supplierId: s.id }
                            });
                          } else {
                            setActiveTab('STATEMENT');
                          }
                        }}
                        className="min-h-[44px] inline-flex items-center px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-link text-xs font-bold cursor-pointer"
                      >
                        عرض الحساب
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {suppliers.length > 0 && (
              <tfoot>
                <tr className="font-bold border-t border-[var(--border-color)]">
                  <td colSpan={3} className="py-2.5 px-3 text-xs">
                    إجمالي مديونية الموردين ({suppliers.length})
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} py-2.5 px-3 font-mono ui-stock-low`}>
                    {totalSuppliersDebt.toLocaleString()} ج.م
                  </td>
                  <td />
                  <td className="no-print" />
                </tr>
              </tfoot>
            )}
          </CompactTable>
        </div>
      )}

      {/* TAB 6: DETAILED SUPPLIER STATEMENT */}
      {activeTab === 'STATEMENT' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 pb-3 border-b border-[var(--border-subtle)]">
            <div className="no-print">
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">اختر المورد</label>
              <select
                value={selectedSupplierForLedger}
                onChange={(e) => setSelectedSupplierForLedger(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-bold`}
              >
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} (رصيد: {s.currentBalance} ج.م)
                  </option>
                ))}
              </select>
            </div>

            <DateRangeFilter
              inline
              value={ledgerDateRange}
              onChange={setLedgerDateRange}
              storageKey="supplier_ledger"
              defaultPreset="THIS_MONTH"
            />

            <div className="no-print inline-flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportLedger}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>تصدير Excel</span>
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الكشف</span>
              </button>
            </div>

            {(() => {
              const currentSup = suppliers.find(s => s.id === selectedSupplierForLedger);
              return currentSup ? (
                <div className="print-only print-filter-summary">
                  المورد: {currentSup.name} {currentSup.phone ? `(${currentSup.phone})` : ''} • الرصيد المستحق: {currentSup.currentBalance.toLocaleString()} ج.م
                </div>
              ) : null;
            })()}
          </div>

          <CompactTable ariaLabel="كشف حساب المورد">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>نوع المعاملة</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>رقم المستند</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>البيان والتفاصيل</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>مدين (لنا)</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>دائن (له)</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد التراكمي</th>
              </tr>
            </thead>
            <tbody>
              {isLedgerFilteredByDate && (
                <tr className="font-bold">
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{ledgerDateRange.from || '—'}</td>
                  <td className={COMPACT_TABLE_TEXT_CLASS} colSpan={3}>
                    رصيد أول المدة (قبل {ledgerDateRange.from || 'بداية الفترة'})
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-center`}>—</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-center`}>—</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>
                    {ledgerOpeningBalanceForPeriod.toLocaleString()} ج.م
                  </td>
                </tr>
              )}

              {computedSupplierLedgerRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد حركات مسجلة للمورد المحدد في الفترة المختارة
                  </td>
                </tr>
              ) : (
                computedSupplierLedgerRows.map(l => (
                  <tr key={l.id}>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {l.date.slice(0, 10)}
                    </td>
                    <td
                      className={`${COMPACT_TABLE_TEXT_CLASS} font-semibold ${
                        l.transactionType.includes('شراء')
                          ? 'ui-stock-low'
                          : l.transactionType.includes('صرف')
                          ? 'ui-money-sale'
                          : 'ui-link'
                      }`}
                    >
                      {l.transactionType}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-link font-bold`}>{l.documentNumber}</td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{l.statement || l.notes || '—'}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-money-sale`}>
                      {l.debit > 0 ? `${l.debit.toLocaleString()} ج.م` : '—'}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-stock-low`}>
                      {l.credit > 0 ? `${l.credit.toLocaleString()} ج.م` : '—'}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono`}>
                      {l.computedBalanceAfter.toLocaleString()} ج.م
                    </td>
                  </tr>
                ))
              )}

              {(isLedgerFilteredByDate || computedSupplierLedgerRows.length > 0) && (
                <tr className="font-bold border-t border-[var(--border-color)]">
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{ledgerDateRange.to || todayStr}</td>
                  <td className={COMPACT_TABLE_TEXT_CLASS} colSpan={3}>
                    رصيد آخر المدة
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-money-sale`}>
                    {computedSupplierLedgerRows.reduce((s, r) => s + (r.debit || 0), 0).toLocaleString()} ج.م
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-stock-low`}>
                    {computedSupplierLedgerRows.reduce((s, r) => s + (r.credit || 0), 0).toLocaleString()} ج.م
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-money-purchase`}>
                    {finalSupplierClosingBalance.toLocaleString()} ج.م
                  </td>
                </tr>
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* TAB 7: PURCHASE RETURNS */}
      {activeTab === 'RETURN' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <DateRangeFilter
              inline
              value={returnsDateRange}
              onChange={setReturnsDateRange}
              storageKey="purchase_returns"
              defaultPreset="THIS_MONTH"
            />

            <div className="no-print flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  بحث في المرتجعات
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="رقم المرتجع، الفاتورة، أو المورد..."
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} pr-9 text-xs`}
                  />
                  <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportPurchaseReturns}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>تصدير Excel</span>
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('new_return')}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>إنشاء مرتجع مشتريات</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]">
            <span>
              عدد المرتجعات: <strong className="font-mono text-[var(--text-primary)]">{filteredPurchaseReturns.length}</strong>
            </span>
            <span>·</span>
            <span>
              إجمالي مرتجعات الفترة:{' '}
              <strong className="font-mono ui-stock-out">
                {filteredPurchaseReturns.reduce((s, r) => s + (r.totalAmount || 0), 0).toLocaleString()} ج.م
              </strong>
            </span>
          </div>

          <CompactTable ariaLabel="سجل مرتجعات المشتريات">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_NUM_CLASS}>رقم المرتجع</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>فاتورة الشراء الأصلية</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>المورد</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>إجمالي المرتجع</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>المسترد نقداً</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>الخزينة</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>السبب</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>المستخدم</th>
              </tr>
            </thead>
            <tbody>
              {filteredPurchaseReturns.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد مرتجعات مشتريات مسجلة في الفترة المختارة
                  </td>
                </tr>
              ) : (
                filteredPurchaseReturns.map(r => (
                  <tr key={r.returnNumber}>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-link`}>{r.returnNumber}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {r.date.slice(0, 10)}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{r.purchaseInvoiceNumber || '—'}</td>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{r.supplierName}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-stock-out`}>
                      {r.totalAmount.toLocaleString()} ج.م
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-money-sale`}>
                      {(r.refundedAmount ?? r.totalAmount).toLocaleString()} ج.م
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{r.cashboxName || '—'}</td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{r.reason || '—'}</td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{r.userName || r.createdBy}</td>
                  </tr>
                ))
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* TAB 8 & 9: VOUCHERS (سند صرف أو قبض) */}
      {(activeTab === 'PAYMENT_VOUCHER' || activeTab === 'RECEIPT_VOUCHER') && (
        <div className="space-y-5">
          <SectionHeading
            title={
              activeTab === 'PAYMENT_VOUCHER'
                ? 'سند صرف وسداد دفعة لمورد'
                : 'سند قبض واسترداد نقدي من مورد'
            }
          />

          {voucherError && (
            <div className="p-3 rounded-lg border border-rose-300 ui-stock-out bg-rose-50/40 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{voucherError.message}</span>
              </div>
              {voucherError.isUnknownResult && (
                <button
                  type="button"
                  onClick={() => voucherFormRef.current?.requestSubmit()}
                  disabled={isSubmittingVoucher}
                  className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSubmittingVoucher ? 'animate-spin' : ''}`} />
                  <span>إعادة المحاولة</span>
                </button>
              )}
            </div>
          )}

          <form
            ref={voucherFormRef}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.target as any;
              const supplierId = form.supplierId.value;
              const cashboxId = form.cashboxId.value;
              const amount = Number(form.amount.value);
              const notes = form.notes.value;

              setIsSubmittingVoucher(true);
              setVoucherError(null);
              try {
                const res = await api.createSupplierVoucher({
                  supplierId,
                  cashboxId,
                  voucherType: activeTab === 'PAYMENT_VOUCHER' ? 'صرف' : 'قبض',
                  amount,
                  notes,
                  idempotencyKey: voucherIdemKeyRef.current
                });

                if (res.success) {
                  voucherIdemKeyRef.current = generateIdempotencyKey();
                  showNotification('success', 'تم تسجيل السند وتحديث رصيد المورد والخزينة بنجاح');
                  form.reset();
                  loadInitialData();
                } else {
                  const msg = res.error || 'فشل حفظ السند';
                  setVoucherError({ message: msg, isUnknownResult: res.code === 'UNKNOWN_RESULT' });
                  showNotification('error', msg);
                }
              } catch (err: any) {
                const msg = err.message || 'خطأ أثناء الاتصال';
                setVoucherError({ message: msg, isUnknownResult: err?.code === 'UNKNOWN_RESULT' });
                showNotification('error', msg);
              } finally {
                setIsSubmittingVoucher(false);
              }
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">المورد المستهدف *</label>
              <select
                name="supplierId"
                required
                value={selectedSupplierForLedger}
                onChange={(e) => setSelectedSupplierForLedger(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
              >
                <option value="">-- اختر المورد --</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} (رصيده المستحق: {s.currentBalance} ج.م)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الخزينة النقدية *</label>
              <select
                name="cashboxId"
                required
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs`}
              >
                <option value="">-- اختر الخزينة --</option>
                {cashboxes.map(cb => (
                  <option key={cb.id} value={cb.id}>
                    {cb.name} (رصيدها: {cb.currentBalance} ج.م)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">المبلغ (ج.م) *</label>
              <input
                type="number"
                name="amount"
                min="0.5"
                step="0.5"
                required
                placeholder="0.00"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs font-bold font-mono`}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">البيان وملاحظات السند</label>
              <input
                type="text"
                name="notes"
                placeholder="بيان السند (سداد دفعة تحت الحساب...)"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmittingVoucher}
              className={`min-h-[44px] px-5 rounded-lg text-white font-bold text-xs transition cursor-pointer disabled:opacity-50 ${
                activeTab === 'PAYMENT_VOUCHER' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {isSubmittingVoucher
                ? 'جاري تسجيل السند...'
                : activeTab === 'PAYMENT_VOUCHER'
                ? 'تأكيد وصرف السند للمورد'
                : 'تأكيد وإيداع سند القبض'}
            </button>
          </form>

          <SectionHeading withTopDivider title={`سجل سندات المورد خلال الفترة (${supplierVoucherRows.length})`} />

          <DateRangeFilter
            inline
            value={vouchersDateRange}
            onChange={setVouchersDateRange}
            storageKey="supplier_vouchers"
            defaultPreset="THIS_MONTH"
          />

          <CompactTable ariaLabel="سجل سندات المورد">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>المستند</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>النوع</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>المبلغ</th>
                <th className={COMPACT_TABLE_TEXT_CLASS}>البيان</th>
              </tr>
            </thead>
            <tbody>
              {supplierVoucherRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد سندات مسجلة في هذه الفترة
                  </td>
                </tr>
              ) : (
                supplierVoucherRows.map(v => (
                  <tr key={v.id}>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {v.date.slice(0, 10)}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-link`}>{v.documentNumber}</td>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{v.transactionType}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>
                      {(v.debit || v.credit || 0).toLocaleString()} ج.م
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{v.statement || v.notes || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* MODAL: فاتورة شراء جديدة */}
      {isNewPurchaseModalOpen && (
        <NewPurchaseModal
          items={items}
          suppliers={suppliers}
          cashboxes={cashboxes}
          onClose={() => setIsNewPurchaseModalOpen(false)}
          onSuccess={() => {
            setIsNewPurchaseModalOpen(false);
            loadInitialData();
            if (onRefreshItems) onRefreshItems();
            showNotification('success', 'تم حفظ فاتورة الشراء وزيادة أرصدة الأصناف وتحديث حساب المورد');
          }}
        />
      )}

      {/* MODAL: إضافة / تعديل مورد */}
      {isSupplierModalOpen && (
        <SupplierModal
          supplier={editingSupplier}
          groups={supplierGroups}
          onClose={() => setIsSupplierModalOpen(false)}
          onSuccess={() => {
            setIsSupplierModalOpen(false);
            loadInitialData();
            showNotification('success', 'تم حفظ بيانات المورد بنجاح');
          }}
        />
      )}

      {/* MODAL: إضافة مجموعة موردين */}
      {isGroupModalOpen && (
        <SupplierGroupModal
          onClose={() => setIsGroupModalOpen(false)}
          onSuccess={() => {
            setIsGroupModalOpen(false);
            loadInitialData();
            showNotification('success', 'تم حفظ مجموعة الموردين بنجاح');
          }}
        />
      )}

      {/* MODAL: إنشاء مرتجع مشتريات */}
      {isReturnModalOpen && (
        <NewPurchaseReturnModal
          purchases={purchases}
          purchaseReturns={purchaseReturns}
          suppliers={suppliers}
          cashboxes={cashboxes}
          items={items}
          onClose={() => setIsReturnModalOpen(false)}
          onSuccess={() => {
            setIsReturnModalOpen(false);
            loadInitialData();
            if (onRefreshItems) onRefreshItems();
            showNotification('success', 'تم تسجيل مرتجع المشتريات وخصم الكميات من المخزن وتحديث الحسابات');
          }}
        />
      )}

      {/* MODAL: تفاصيل فاتورة الشراء */}
      {selectedPurchaseForDetails && (
        <PurchaseDetailsModal
          purchase={selectedPurchaseForDetails}
          onClose={() => setSelectedPurchaseForDetails(null)}
        />
      )}

      {/* MODAL: إلغاء فاتورة شراء بقيد عكسي */}
      {purchaseToCancel && (
        <ModalShell
          title="إلغاء فاتورة شراء معتمدة عبر قيد عكسي"
          subtitle={`فاتورة رقم: ${purchaseToCancel.invoiceNumber}`}
          onClose={() => setPurchaseToCancel(null)}
          closeDisabled={isCancellingPurchase}
          footer={
            <>
              <button
                type="button"
                onClick={() => setPurchaseToCancel(null)}
                disabled={isCancellingPurchase}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelPurchase}
                disabled={isCancellingPurchase || !purchaseCancelReason.trim()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>{isCancellingPurchase ? 'جاري تسجيل القيود العكسية...' : 'تأكيد الإلغاء والقيد العكسي'}</span>
              </button>
            </>
          }
        >
          <div className="border-r-2 border-rose-600 pr-3 text-xs text-[var(--text-secondary)] space-y-1">
            <p className="font-bold ui-stock-out">تنبيه محاسبي ومخزني:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>سيتم خصم كميات البضاعة المشتراة من المخزون تلقائيًا بقيد عكسي.</li>
              <li>سيتم استرداد أي مبالغ تم سدادها من الخزينة لحساب الخزينة الأصلية.</li>
              <li>سيتم تخفيض مستحقات المورد في كشف الحساب إذا كانت الفاتورة آجلة أو جزئية.</li>
              <li>لا يتم حذف السجل بل توثيقه كـ "ملغاة" بقيد عكسي في سجل التدقيق.</li>
            </ul>
          </div>

          {purchaseCancelError && (
            <div className="flex items-center gap-2 text-xs font-bold ui-stock-out">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{purchaseCancelError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
              سبب الإلغاء (إلزامي للتوثيق المحاسبي) *
            </label>
            <input
              type="text"
              value={purchaseCancelReason}
              onChange={(e) => setPurchaseCancelReason(e.target.value)}
              placeholder="مثال: إلغاء طلب الشراء، رفض الشحنة، تسجيل بالخطأ..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
            />
          </div>
        </ModalShell>
      )}
    </PageSurface>
  );
};

/* =========================================================================
   مكونات المودال المساعدة لشاشة المشتريات
   ========================================================================= */

// مودال فاتورة الشراء الجديدة
interface NewPurchaseModalProps {
  items: Item[];
  suppliers: Supplier[];
  cashboxes: Cashbox[];
  onClose: () => void;
  onSuccess: () => void;
}

const NewPurchaseModal: React.FC<NewPurchaseModalProps> = ({
  items,
  suppliers,
  cashboxes,
  onClose,
  onSuccess
}) => {
  const [supplierId, setSupplierId] = useState('');
  const [paymentType, setPaymentType] = useState<'نقدي' | 'آجل' | 'جزئي'>('نقدي');
  const [cashboxId, setCashboxId] = useState(cashboxes[0]?.id || '');
  const [paidAmount, setPaidAmount] = useState<number | ''>(0);
  const [notes, setNotes] = useState('');

  // خطوط الفاتورة
  const [lines, setLines] = useState<Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>>([]);

  const [selectedItemId, setSelectedItemId] = useState('');
  const [tempQty, setTempQty] = useState<number>(1);
  const [tempPrice, setTempPrice] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnknownResultError, setIsUnknownResultError] = useState(false);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

  // تحديث السعر الافتراضي عند اختيار الصنف
  useEffect(() => {
    if (selectedItemId) {
      const it = items.find(i => i.id === selectedItemId);
      if (it) {
        setTempPrice(it.purchasePrice || 0);
      }
    }
  }, [selectedItemId, items]);

  const handleAddLine = () => {
    if (!selectedItemId) return;
    const it = items.find(i => i.id === selectedItemId);
    if (!it) return;

    if (tempQty <= 0 || tempPrice < 0) {
      setError('يرجى تحديد كمية موجبة وسعر شراء صالح');
      return;
    }

    const existingIndex = lines.findIndex(l => l.itemId === selectedItemId);
    if (existingIndex >= 0) {
      const updated = [...lines];
      updated[existingIndex].quantity += tempQty;
      updated[existingIndex].unitPrice = tempPrice;
      updated[existingIndex].total = updated[existingIndex].quantity * tempPrice;
      setLines(updated);
    } else {
      setLines([
        ...lines,
        {
          itemId: it.id,
          itemName: it.name,
          quantity: tempQty,
          unitPrice: tempPrice,
          total: tempQty * tempPrice
        }
      ]);
    }

    setSelectedItemId('');
    setTempQty(1);
    setTempPrice(0);
    setError(null);
  };

  const handleRemoveLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx));
  };

  const totalAmount = lines.reduce((sum, l) => sum + l.total, 0);

  useEffect(() => {
    if (paymentType === 'نقدي') {
      setPaidAmount(totalAmount);
    } else if (paymentType === 'آجل') {
      setPaidAmount(0);
    }
  }, [paymentType, totalAmount]);

  const submitPurchase = async () => {
    if (!supplierId) {
      setError('يرجى اختيار المورد');
      return;
    }
    if (lines.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل لفاتورة الشراء');
      return;
    }

    const numPaid = Number(paidAmount || 0);
    if (numPaid > totalAmount) {
      setError('المبلغ المسدد لا يمكن أن يتجاوز إجمالي الفاتورة');
      return;
    }

    if (numPaid > 0 && !cashboxId) {
      setError('يرجى تحديد الخزينة التي تم سحب المبلغ المسدد منها');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setIsUnknownResultError(false);

    try {
      const res = await api.createPurchase({
        supplierId,
        paymentType,
        cashboxId: numPaid > 0 ? cashboxId : undefined,
        paidAmount: numPaid,
        notes,
        idempotencyKey: idempotencyKeyRef.current,
        lines: lines.map(l => ({
          itemId: l.itemId,
          itemName: l.itemName,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          totalPrice: l.total
        }))
      });

      if (res.success) {
        idempotencyKeyRef.current = generateIdempotencyKey();
        onSuccess();
      } else {
        setError(res.error || 'فشل حفظ فاتورة الشراء');
        setIsUnknownResultError(res.code === 'UNKNOWN_RESULT');
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ الفاتورة');
      setIsUnknownResultError(err?.code === 'UNKNOWN_RESULT');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitPurchase();
  };

  return (
    <ModalShell
      title="إنشاء فاتورة شراء جديدة"
      subtitle="تحديث فوري لأرصدة المخزون، وتوثيق مديونية أو سداد المورد"
      onClose={onClose}
      closeDisabled={isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2.5 rounded-lg border border-rose-300 ui-stock-out bg-rose-50/40 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            {isUnknownResultError && (
              <button
                type="button"
                onClick={submitPurchase}
                disabled={isSubmitting}
                className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
                <span>إعادة المحاولة</span>
              </button>
            )}
          </div>
        )}

        {/* Supplier & Payment Options */}
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">المورد *</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              required
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
            >
              <option value="">-- اختر المورد --</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">طريقة الدفع *</label>
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as any)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold`}
            >
              <option value="نقدي">نقدي بالكامل</option>
              <option value="آجل">آجل بالكامل (على الحساب)</option>
              <option value="جزئي">سداد جزئي</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الخزينة المخصصة للسداد</label>
            <select
              value={cashboxId}
              onChange={(e) => setCashboxId(e.target.value)}
              disabled={paymentType === 'آجل'}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs disabled:opacity-50`}
            >
              {cashboxes.map(cb => (
                <option key={cb.id} value={cb.id}>{cb.name} (رصيدها: {cb.currentBalance} ج.م)</option>
              ))}
            </select>
          </div>
        </div>

        {/* Add Line Input Row */}
        <SectionHeading title="إضافة صنف للفاتورة" withTopDivider />
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">الصنف</label>
            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
            >
              <option value="">-- اختر صنفاً من الكتالوج --</option>
              {items.map(it => (
                <option key={it.id} value={it.id}>{it.name} (رصيد حالي: {it.stockQuantity})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">الكمية</label>
            <input
              type="number"
              min="1"
              value={tempQty}
              onChange={(e) => setTempQty(Math.max(1, Number(e.target.value)))}
              placeholder="الكمية"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs text-center font-bold font-mono`}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">سعر الوحدة</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={tempPrice}
              onChange={(e) => setTempPrice(Math.max(0, Number(e.target.value)))}
              placeholder="سعر الوحدة"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs text-center font-bold font-mono`}
            />
          </div>

          <button
            type="button"
            onClick={handleAddLine}
            className="min-h-[44px] px-4 rounded-lg bg-[#1668B2] hover:bg-[#125592] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            إضافة
          </button>
        </div>

        {/* Lines Table */}
        <CompactTable ariaLabel="أصناف فاتورة الشراء">
          <thead>
            <tr>
              <th className={COMPACT_TABLE_TEXT_CLASS}>الصنف</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>الكمية</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>سعر الشراء</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>الإجمالي</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>حذف</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-xs text-[var(--text-secondary)]">
                  لم يتم إضافة أصناف بعد
                </td>
              </tr>
            ) : (
              lines.map((l, idx) => (
                <tr key={idx}>
                  <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{l.itemName}</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>{l.quantity}</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{l.unitPrice} ج.م</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-money-purchase`}>{l.total} ج.م</td>
                  <td className={COMPACT_TABLE_NUM_CLASS}>
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(idx)}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center ui-stock-out hover:bg-[var(--surface-subtle)] rounded-lg cursor-pointer"
                      aria-label="حذف"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </CompactTable>

        {/* Financial Summary */}
        <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-[var(--border-subtle)] text-xs">
          <div>
            <span className="text-[var(--text-secondary)] font-bold">إجمالي الفاتورة: </span>
            <strong className="font-mono font-extrabold text-[var(--text-primary)]">{totalAmount.toLocaleString()} ج.م</strong>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">المبلغ المسدد</label>
            <input
              type="number"
              min="0"
              max={totalAmount}
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value === '' ? '' : Number(e.target.value))}
              disabled={paymentType === 'آجل'}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs font-bold font-mono ui-money-sale disabled:opacity-50`}
            />
          </div>

          <div>
            <span className="text-[var(--text-secondary)] font-bold">المتبقي كدين: </span>
            <strong className="font-mono font-bold ui-stock-low">
              {Math.max(0, totalAmount - Number(paidAmount || 0)).toLocaleString()} ج.م
            </strong>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">ملاحظات الفاتورة</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="رقم إذن الاستلام أو بوليصة الشحن أو شروط السداد..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
          />
        </div>

        <div className="pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={isSubmitting || lines.length === 0}
            className="min-h-[44px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? 'جاري الحفظ...' : 'تأكيد وحفظ فاتورة الشراء'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

// مودال إضافة / تعديل مورد
interface SupplierModalProps {
  supplier: Supplier | null;
  groups: SupplierGroup[];
  onClose: () => void;
  onSuccess: () => void;
}

const SupplierModal: React.FC<SupplierModalProps> = ({
  supplier,
  groups,
  onClose,
  onSuccess
}) => {
  const [name, setName] = useState(supplier?.name || '');
  const [code, setCode] = useState(supplier?.code || '');
  const [groupId, setGroupId] = useState(supplier?.groupId || '');
  const [phone, setPhone] = useState(supplier?.phone || '');
  const [email, setEmail] = useState(supplier?.email || '');
  const [address, setAddress] = useState(supplier?.address || '');
  const [taxNumber, setTaxNumber] = useState(supplier?.taxNumber || '');
  const [commercialRecord, setCommercialRecord] = useState(supplier?.commercialRecord || '');
  const [openingBalance, setOpeningBalance] = useState<number>(supplier?.openingBalance || 0);
  const [notes, setNotes] = useState(supplier?.notes || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('يرجى إدخال اسم المورد');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await api.saveSupplier({
        id: supplier?.id,
        name: name.trim(),
        code: code.trim() || undefined,
        groupId: groupId || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        taxNumber: taxNumber.trim() || undefined,
        commercialRecord: commercialRecord.trim() || undefined,
        openingBalance: Number(openingBalance || 0),
        notes: notes.trim() || undefined
      });

      if (res.success) {
        onSuccess();
      } else {
        setError((res as any).error || 'فشل حفظ المورد');
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ المورد');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={supplier ? `تعديل المورد: ${supplier.name}` : 'إضافة مورد جديد'}
      onClose={onClose}
      closeDisabled={isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="p-2.5 rounded-lg border border-rose-300 ui-stock-out bg-rose-50/40 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">اسم المورد أو الشركة *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: شركة التوريدات الهندسية"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">كود المورد</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="SUP-001"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">مجموعة الموردين</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs`}
            >
              <option value="">بدون مجموعة</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">رقم الهاتف</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01xxxxxxxxx"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الرصيد الافتتاحي (دائن)</label>
            <input
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(Number(e.target.value))}
              placeholder="0.00"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs font-bold font-mono`}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الرقم الضريبي</label>
            <input
              type="text"
              value={taxNumber}
              onChange={(e) => setTaxNumber(e.target.value)}
              placeholder="xxx-xxx-xxx"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">السجل التجاري</label>
            <input
              type="text"
              value={commercialRecord}
              onChange={(e) => setCommercialRecord(e.target.value)}
              placeholder="سجل رقم..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs`}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">البريد الإلكتروني</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="supplier@example.com"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs`}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">العنوان</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="المدينة، المنطقة، الشارع..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">ملاحظات</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="بيانات الاتصال الإضافية، مسؤول المبيعات..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
          />
        </div>

        <div className="pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-[44px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? 'جاري الحفظ...' : 'حفظ المورد'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

// مودال إضافة مجموعة موردين
interface SupplierGroupModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const SupplierGroupModal: React.FC<SupplierGroupModalProps> = ({ onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await api.saveSupplierGroup({ name: name.trim(), description });
      if (res.success) {
        onSuccess();
      } else {
        setError(res.error || 'تعذر حفظ مجموعة الموردين');
      }
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء الاتصال بالخادم');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="مجموعة موردين جديدة"
      onClose={onClose}
      closeDisabled={isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="p-2.5 rounded-lg border border-rose-300 ui-stock-out bg-rose-50/40 text-xs font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">اسم المجموعة *</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: موردي الأجهزة الكهربائية"
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الوصف</label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="وصف اختياري للمجموعة..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
          />
        </div>
        <div className="pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-[44px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? 'جاري الحفظ...' : 'حفظ المجموعة'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

// مودال إنشاء مرتجع مشتريات
interface NewPurchaseReturnModalProps {
  purchases: Purchase[];
  purchaseReturns: PurchaseReturn[];
  suppliers: Supplier[];
  cashboxes: Cashbox[];
  items: Item[];
  onClose: () => void;
  onSuccess: () => void;
}

const NewPurchaseReturnModal: React.FC<NewPurchaseReturnModalProps> = ({
  purchases,
  purchaseReturns,
  suppliers,
  cashboxes,
  items,
  onClose,
  onSuccess
}) => {
  const [supplierId, setSupplierId] = useState('');
  const [purchaseInvoiceNumber, setPurchaseInvoiceNumber] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [refundedAmount, setRefundedAmount] = useState<number | ''>(0);
  const [reason, setReason] = useState('');

  // خطوط المرتجع
  const [lines, setLines] = useState<Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>>([]);

  const [selectedItemId, setSelectedItemId] = useState('');
  const [tempQty, setTempQty] = useState<number>(1);
  const [tempPrice, setTempPrice] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnknownResultError, setIsUnknownResultError] = useState(false);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

  // تحديث المورد عند اختيار فاتورة شراء
  useEffect(() => {
    if (purchaseInvoiceNumber) {
      const pur = purchases.find(p => p.invoiceNumber === purchaseInvoiceNumber);
      if (pur) {
        setSupplierId(pur.supplierId);
      }
    }
  }, [purchaseInvoiceNumber, purchases]);

  const handleAddLine = () => {
    if (!selectedItemId) return;
    const it = items.find(i => i.id === selectedItemId);
    if (!it) return;

    if (tempQty <= 0) {
      setError('يرجى تحديد كمية موجبة');
      return;
    }

    if (tempQty > it.stockQuantity) {
      setError(`الكمية المرتجعة (${tempQty}) تتجاوز رصيد المخزن الحالي (${it.stockQuantity})`);
      return;
    }

    // التحقق من سقف الكمية القابلة للإرجاع من فاتورة الشراء الأصلية
    if (purchaseInvoiceNumber) {
      const pur = purchases.find(p => p.invoiceNumber === purchaseInvoiceNumber);
      if (pur && pur.lines) {
        const purLine = pur.lines.find(l => l.itemId === selectedItemId);
        if (!purLine) {
          setError('هذا الصنف غير موجود في بنود فاتورة الشراء المحددة');
          return;
        }
        const prevReturns = purchaseReturns.filter(r => r.purchaseInvoiceNumber === purchaseInvoiceNumber);
        const prevQty = prevReturns.reduce((sum, r) => {
          const matching = r.lines?.find(x => x.itemId === selectedItemId);
          return sum + (matching ? matching.quantity : 0);
        }, 0);
        const alreadyInLines = lines.filter(l => l.itemId === selectedItemId).reduce((s, l) => s + l.quantity, 0);
        const remainingReturnable = Math.max(0, purLine.quantity - prevQty - alreadyInLines);

        if (tempQty > remainingReturnable) {
          setError(`الكمية المرتجعة (${tempQty}) تتجاوز الكمية المتبقية القابلة للإرجاع من الفاتورة (${remainingReturnable}) بعد احتساب المرتجعات السابقة`);
          return;
        }
      }
    }

    setLines([
      ...lines,
      {
        itemId: it.id,
        itemName: it.name,
        quantity: tempQty,
        unitPrice: tempPrice,
        total: tempQty * tempPrice
      }
    ]);

    setSelectedItemId('');
    setTempQty(1);
    setTempPrice(0);
    setError(null);
  };

  const totalAmount = lines.reduce((sum, l) => sum + l.total, 0);

  const submitPurchaseReturn = async () => {
    if (!supplierId) {
      setError('يرجى اختيار المورد');
      return;
    }
    if (lines.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل للمرتجع');
      return;
    }

    const numRefunded = Number(refundedAmount || 0);
    if (numRefunded > 0 && !cashboxId) {
      setError('يرجى تحديد الخزينة التي تم إيداع المبلغ المسترد فيها');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setIsUnknownResultError(false);

    try {
      const res = await api.createPurchaseReturn({
        supplierId,
        purchaseInvoiceNumber: purchaseInvoiceNumber || undefined,
        cashboxId: numRefunded > 0 ? cashboxId : undefined,
        refundedAmount: numRefunded,
        reason,
        idempotencyKey: idempotencyKeyRef.current,
        lines: lines.map(l => ({
          itemId: l.itemId,
          itemName: l.itemName,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          totalPrice: l.total
        }))
      });

      if (res.success) {
        idempotencyKeyRef.current = generateIdempotencyKey();
        onSuccess();
      } else {
        setError(res.error || 'فشل حفظ مرتجع المشتريات');
        setIsUnknownResultError(res.code === 'UNKNOWN_RESULT');
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ المرتجع');
      setIsUnknownResultError(err?.code === 'UNKNOWN_RESULT');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitPurchaseReturn();
  };

  return (
    <ModalShell
      title="إنشاء مرتجع مشتريات"
      subtitle="خصم الكميات من المخزن وإلغاء أو استرداد قيمتها للمورد"
      onClose={onClose}
      closeDisabled={isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2.5 rounded-lg border border-rose-300 ui-stock-out bg-rose-50/40 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            {isUnknownResultError && (
              <button
                type="button"
                onClick={submitPurchaseReturn}
                disabled={isSubmitting}
                className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
                <span>إعادة المحاولة</span>
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">المورد *</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              required
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
            >
              <option value="">-- اختر المورد --</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">فاتورة الشراء الأصلية (اختياري)</label>
            <select
              value={purchaseInvoiceNumber}
              onChange={(e) => setPurchaseInvoiceNumber(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-mono`}
            >
              <option value="">مرتجع عام بدون فاتورة</option>
              {purchases.map(p => (
                <option key={p.invoiceNumber} value={p.invoiceNumber}>{p.invoiceNumber} - {p.supplierName}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Add Lines */}
        <SectionHeading title="إضافة صنف مرتجع" withTopDivider />
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">الصنف</label>
            <select
              value={selectedItemId}
              onChange={(e) => {
                setSelectedItemId(e.target.value);
                const it = items.find(i => i.id === e.target.value);
                if (it) setTempPrice(it.purchasePrice || 0);
              }}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
            >
              <option value="">-- اختر صنفاً مرتجعاً --</option>
              {items.map(it => (
                <option key={it.id} value={it.id}>{it.name} (متوفر بالمخزن: {it.stockQuantity})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">الكمية</label>
            <input
              type="number"
              min="1"
              value={tempQty}
              onChange={(e) => setTempQty(Math.max(1, Number(e.target.value)))}
              placeholder="الكمية"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs text-center font-bold font-mono`}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">السعر</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={tempPrice}
              onChange={(e) => setTempPrice(Math.max(0, Number(e.target.value)))}
              placeholder="السعر"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs text-center font-bold font-mono`}
            />
          </div>

          <button
            type="button"
            onClick={handleAddLine}
            className="min-h-[44px] px-4 rounded-lg bg-[#1668B2] hover:bg-[#125592] text-white text-xs font-bold cursor-pointer"
          >
            إضافة
          </button>
        </div>

        {/* Lines Table */}
        <CompactTable ariaLabel="أصناف مرتجع المشتريات">
          <thead>
            <tr>
              <th className={COMPACT_TABLE_TEXT_CLASS}>الصنف</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>الكمية</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>السعر</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>الإجمالي</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>حذف</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-xs text-[var(--text-secondary)]">
                  لم يتم اختيار أصناف بعد
                </td>
              </tr>
            ) : (
              lines.map((l, i) => (
                <tr key={i}>
                  <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{l.itemName}</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>{l.quantity}</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{l.unitPrice} ج.م</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-stock-out`}>{l.total} ج.م</td>
                  <td className={COMPACT_TABLE_NUM_CLASS}>
                    <button
                      type="button"
                      onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center ui-stock-out hover:bg-[var(--surface-subtle)] rounded-lg cursor-pointer"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </CompactTable>

        <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-[var(--border-subtle)] text-xs">
          <div>
            <span className="text-[var(--text-secondary)] font-bold">إجمالي المرتجع: </span>
            <strong className="font-mono font-extrabold ui-stock-out">{totalAmount.toLocaleString()} ج.م</strong>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">المسترد نقداً</label>
            <input
              type="number"
              min="0"
              max={totalAmount}
              value={refundedAmount}
              onChange={(e) => setRefundedAmount(e.target.value === '' ? '' : Number(e.target.value))}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs font-bold font-mono ui-money-sale`}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الخزينة</label>
            <select
              value={cashboxId}
              onChange={(e) => setCashboxId(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs`}
            >
              <option value="">-- الخزينة --</option>
              {cashboxes.map(cb => (
                <option key={cb.id} value={cb.id}>{cb.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">سبب الإرجاع</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="تالف، غير مطابق للمواصفات، انتهاء صلاحية..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
          />
        </div>

        <div className="pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={isSubmitting || lines.length === 0}
            className="min-h-[44px] px-5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? 'جاري الحفظ...' : 'تأكيد المرتجع'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

// مودال تفاصيل فاتورة شراء
interface PurchaseDetailsModalProps {
  purchase: Purchase;
  onClose: () => void;
}

const PurchaseDetailsModal: React.FC<PurchaseDetailsModalProps> = ({ purchase, onClose }) => {
  return (
    <ModalShell
      title={`فاتورة شراء: ${purchase.invoiceNumber}`}
      subtitle={`${purchase.supplierName} • ${purchase.date.slice(0, 10)}`}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] px-5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer"
        >
          إغلاق
        </button>
      }
    >
      <ReportSummaryTable
        ariaLabel="ملخص فاتورة الشراء"
        rows={[
          { label: 'الإجمالي', value: `${(purchase.netAmount ?? purchase.netTotal ?? 0).toLocaleString()} ج.م`, emphasize: true },
          { label: 'المسدد', value: `${purchase.paidAmount.toLocaleString()} ج.م`, tone: 'sale' },
          { label: 'المتبقي', value: `${purchase.remainingAmount.toLocaleString()} ج.م`, tone: 'purchase' },
        ]}
      />

      <SectionHeading title="الأصناف المشتراة" withTopDivider />
      <CompactTable ariaLabel="بنود فاتورة الشراء">
        <thead>
          <tr>
            <th className={COMPACT_TABLE_TEXT_CLASS}>الصنف</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>الكمية</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>سعر الوحدة</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {purchase.lines.map((l: any, i: number) => (
            <tr key={i}>
              <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{l.itemName}</td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>{l.quantity}</td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{l.unitPrice ?? l.unitCost} ج.م</td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-money-purchase`}>
                {l.totalPrice ?? l.totalLine} ج.م
              </td>
            </tr>
          ))}
        </tbody>
      </CompactTable>

      {purchase.notes && (
        <p className="text-xs text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">ملاحظات:</strong> {purchase.notes}
        </p>
      )}
    </ModalShell>
  );
};

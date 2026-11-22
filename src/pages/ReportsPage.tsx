import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  ReportsData,
  Item,
  Platform,
  Invoice,
  ReturnRecord,
  UserAccount,
  UserRole,
  Purchase,
  Supplier,
  Customer,
  Cashbox,
  CashboxTransaction,
  ReconciliationItem,
  ItemMovementReport,
  StockAdjustmentsReport
} from '../types';
import { api } from '../api/client';
import { hasPermission } from '../utils/permissions';
import { useUserWarehouses } from '../hooks/useUserWarehouses';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { DateRange, getDateRangeForPreset, isDateInRange, normalizeArabicText } from '../utils/dateUtils';
import {
  Printer,
  Download,
  AlertTriangle,
  Search,
  CheckCircle2,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import { BnplReportView } from '../components/reports/BnplReportView';
import { UnsoldCartItemsReportView } from '../components/reports/UnsoldCartItemsReportView';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ReportSummaryTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
  type ReportSummaryRow
} from '../components/ui';
import { ShortcutBadge } from '../context/KeyboardShortcutsContext';

interface ReportsPageProps {
  reports: ReportsData | null;
  items: Item[];
  platforms: Platform[];
  invoices: Invoice[];
  returns: ReturnRecord[];
  user?: UserAccount | null;
  userRole: UserRole;
  users?: UserAccount[];
  initialTab?: ReportTab;
  platformsEnabled?: boolean;
}

type ReportTab =
  | 'FINANCIAL'
  | 'SALES_PURCHASES'
  | 'CASH_FLOW'
  | 'BALANCES'
  | 'LOW_STOCK'
  | 'RECONCILIATION'
  | 'ITEM_MOVEMENT'
  | 'STOCK_ADJUSTMENTS'
  | 'BNPL'
  | 'UNSOLD_CART_ITEMS';

export const ReportsPage: React.FC<ReportsPageProps> = ({
  items,
  platforms,
  invoices,
  returns,
  user = null,
  userRole,
  users = [],
  initialTab,
  platformsEnabled = true
}) => {
  const isDesigner = user?.role === 'designer' || userRole === 'designer' || Boolean(user?.isOwner);
  const canViewProfit =
    isDesigner ||
    (user ? hasPermission(user, 'reports.view_profit') : userRole === 'manager');
  const canViewItemMovement =
    isDesigner ||
    (user ? hasPermission(user, 'reports.item_movement.view') : true);
  const canViewStockAdjustments =
    isDesigner ||
    (user ? hasPermission(user, 'reports.stock_adjustments.view') : userRole === 'manager');
  const canViewBnpl =
    platformsEnabled &&
    (isDesigner || (user ? hasPermission(user, 'reports.bnpl_view') : userRole === 'manager'));
  const canViewUnsoldCartItems =
    isDesigner ||
    (user ? hasPermission(user, 'reports.unsold_cart_items.view') : userRole === 'manager');

  const [activeTab, setActiveTab] = useState<ReportTab>(() =>
    !platformsEnabled && initialTab === 'BNPL' ? 'FINANCIAL' : initialTab || 'FINANCIAL'
  );

  useEffect(() => {
    if (initialTab) {
      setActiveTab(!platformsEnabled && initialTab === 'BNPL' ? 'FINANCIAL' : initialTab);
    } else if (!platformsEnabled && activeTab === 'BNPL') {
      setActiveTab('FINANCIAL');
    }
  }, [initialTab, platformsEnabled, activeTab]);

  // فلتر الفترة الموحد لكل التقارير (الافتراضي THIS_MONTH)
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRangeForPreset('THIS_MONTH'));

  // بيانات إضافية من الخادم للتقارير الشاملة
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [cashTransactions, setCashTransactions] = useState<CashboxTransaction[]>([]);

  const {
    warehouses: allWarehouses,
    activeAllowedWarehouses,
    defaultWarehouseId,
    seesAllWarehouses
  } = useUserWarehouses(user);
  const canChooseAllWarehouses = seesAllWarehouses || activeAllowedWarehouses.length > 1;
  const reportWarehouseOptions = useMemo(
    () => (seesAllWarehouses ? allWarehouses : activeAllowedWarehouses),
    [seesAllWarehouses, allWarehouses, activeAllowedWarehouses]
  );

  // حالة حركة الصنف
  const [itemSearchQuery, setItemSearchQuery] = useState<string>('');
  const [selectedMovementItemId, setSelectedMovementItemId] = useState<string>(() => items[0]?.id || '');
  const [movementWarehouseId, setMovementWarehouseId] = useState<string>('');
  const [itemMovementReport, setItemMovementReport] = useState<ItemMovementReport | null>(null);
  const [isLoadingItemMovement, setIsLoadingItemMovement] = useState<boolean>(false);

  // حالة تسويات المخزون
  const [selectedAdjustmentItemId, setSelectedAdjustmentItemId] = useState<string>('ALL');
  const [adjustmentWarehouseId, setAdjustmentWarehouseId] = useState<string>('');
  const [stockAdjustmentsReport, setStockAdjustmentsReport] = useState<StockAdjustmentsReport | null>(null);
  const [isLoadingStockAdjustments, setIsLoadingStockAdjustments] = useState<boolean>(false);

  useEffect(() => {
    if (!selectedMovementItemId && items.length > 0) {
      setSelectedMovementItemId(items[0].id);
    }
  }, [items, selectedMovementItemId]);

  // ضبط المخزن الافتراضي ومنع خيار «كل المخازن» لمن يملك مخزناً واحداً فقط
  useEffect(() => {
    if (!defaultWarehouseId && activeAllowedWarehouses.length === 0) return;
    const fallbackId = defaultWarehouseId || activeAllowedWarehouses[0]?.id || '';
    if (!movementWarehouseId) {
      if (fallbackId) setMovementWarehouseId(fallbackId);
    } else if (!canChooseAllWarehouses && movementWarehouseId === 'ALL') {
      if (fallbackId) setMovementWarehouseId(fallbackId);
    }
    if (!adjustmentWarehouseId) {
      if (fallbackId) setAdjustmentWarehouseId(fallbackId);
    } else if (!canChooseAllWarehouses && adjustmentWarehouseId === 'ALL') {
      if (fallbackId) setAdjustmentWarehouseId(fallbackId);
    }
  }, [defaultWarehouseId, activeAllowedWarehouses, canChooseAllWarehouses, movementWarehouseId, adjustmentWarehouseId]);

  // حالة تقرير المطابقة والترحيل
  const [reconciliationData, setReconciliationData] = useState<{
    totalAudited: number;
    unpostedCount: number;
    discrepantCashboxAmount: number;
    discrepantLedgerAmount: number;
    items: ReconciliationItem[];
  } | null>(null);
  const [isLoadingReconciliation, setIsLoadingReconciliation] = useState(false);
  const [reconciliationFeedback, setReconciliationFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [postingItemId, setPostingItemId] = useState<string | null>(null);

  const periodLabel = useMemo(() => {
    if (dateRange.from && dateRange.to) {
      return `من ${dateRange.from} إلى ${dateRange.to}`;
    }
    if (dateRange.from) return `من ${dateRange.from}`;
    if (dateRange.to) return `حتى ${dateRange.to}`;
    return 'كل الفترات';
  }, [dateRange.from, dateRange.to]);

  const loadReconciliation = async () => {
    setIsLoadingReconciliation(true);
    setReconciliationFeedback(null);
    try {
      const res = await api.getReconciliationReport({
        from: dateRange.from,
        to: dateRange.to
      });
      if (res.success && res.report) {
        setReconciliationData(res.report);
      }
    } catch (err: any) {
      console.error('Failed to load reconciliation report:', err);
    } finally {
      setIsLoadingReconciliation(false);
    }
  };

  const handlePostItem = async (item: ReconciliationItem) => {
    setPostingItemId(item.id);
    setReconciliationFeedback(null);
    try {
      const res = await api.postReconciliationItem({
        documentNumber: item.documentNumber,
        documentType: item.documentType,
        cashboxId: cashboxes[0]?.id,
        warehouseId: item.warehouseId || defaultWarehouseId || undefined
      });
      if (res.success) {
        setReconciliationFeedback({ type: 'success', message: res.message || 'تم ترحيل العملية بنجاح' });
        await loadReconciliation();
      } else {
        setReconciliationFeedback({ type: 'error', message: res.error || 'فشل الترحيل' });
      }
    } catch (err: any) {
      setReconciliationFeedback({ type: 'error', message: err.message || 'حدث خطأ أثناء الترحيل' });
    } finally {
      setPostingItemId(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'RECONCILIATION') {
      loadReconciliation();
    }
  }, [activeTab, dateRange.from, dateRange.to]);

  // جلب المشتريات وحركات الخزينة مع فلتر الفترة
  useEffect(() => {
    Promise.all([
      api.getPurchases({ from: dateRange.from, to: dateRange.to }).catch(() => ({ success: false, purchases: [] })),
      api.getSuppliers().catch(() => ({ success: false, suppliers: [] })),
      api.getCustomers().catch(() => ({ success: false, customers: [] })),
      api.getCashboxes().catch(() => ({ success: false, cashboxes: [] })),
      api
        .getCashboxTransactions('ALL', { from: dateRange.from, to: dateRange.to })
        .catch(() => ({ success: false, transactions: [] }))
    ]).then(([purRes, supRes, custRes, cbRes, txRes]) => {
      if (purRes.success) setPurchases(purRes.purchases || []);
      if (supRes.success) setSuppliers(supRes.suppliers || []);
      if (custRes.success) setCustomers(custRes.customers || []);
      if (cbRes.success) setCashboxes(cbRes.cashboxes || []);
      if (txRes.success) setCashTransactions(txRes.transactions || []);
    });
  }, [dateRange.from, dateRange.to]);

  // جلب تقرير حركة الصنف عند تفعيله أو تغيير الصنف أو المخزن أو الفترة
  useEffect(() => {
    if (activeTab === 'ITEM_MOVEMENT' && selectedMovementItemId && canViewItemMovement) {
      setIsLoadingItemMovement(true);
      const effectiveWh = movementWarehouseId || defaultWarehouseId || undefined;
      api
        .getItemMovementReport({
          itemId: selectedMovementItemId,
          warehouseId: effectiveWh && effectiveWh !== 'ALL' ? effectiveWh : undefined,
          from: dateRange.from,
          to: dateRange.to
        })
        .then(res => {
          if (res.success && res.report) {
            setItemMovementReport(res.report);
          }
        })
        .catch(() => {})
        .finally(() => setIsLoadingItemMovement(false));
    }
  }, [activeTab, selectedMovementItemId, movementWarehouseId, defaultWarehouseId, dateRange.from, dateRange.to, canViewItemMovement]);

  // جلب تقرير تسويات المخزون عند تفعيله أو تغيير الصنف أو المخزن أو الفترة
  useEffect(() => {
    if (activeTab === 'STOCK_ADJUSTMENTS' && canViewStockAdjustments) {
      setIsLoadingStockAdjustments(true);
      const effectiveWh = adjustmentWarehouseId || defaultWarehouseId || undefined;
      api
        .getStockAdjustmentsReport({
          itemId: selectedAdjustmentItemId !== 'ALL' ? selectedAdjustmentItemId : undefined,
          warehouseId: effectiveWh && effectiveWh !== 'ALL' ? effectiveWh : undefined,
          from: dateRange.from,
          to: dateRange.to
        })
        .then(res => {
          if (res.success && res.report) {
            setStockAdjustmentsReport(res.report);
          }
        })
        .catch(() => {})
        .finally(() => setIsLoadingStockAdjustments(false));
    }
  }, [activeTab, selectedAdjustmentItemId, adjustmentWarehouseId, defaultWarehouseId, dateRange.from, dateRange.to, canViewStockAdjustments]);

  // فلاتر التاريخ للمبيعات والمشتريات والمرتجعات والتدفق النقدي
  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      if ((inv.status as string) === 'ملغاة') return false;
      return isDateInRange(inv.date, dateRange.from, dateRange.to);
    });
  }, [invoices, dateRange.from, dateRange.to]);

  const filteredPurchases = useMemo(() => {
    return purchases.filter(p => {
      if (p.receivingStatus === 'ملغاة') return false;
      return isDateInRange(p.date, dateRange.from, dateRange.to);
    });
  }, [purchases, dateRange.from, dateRange.to]);

  const filteredReturns = useMemo(() => {
    return returns.filter(r => isDateInRange(r.date, dateRange.from, dateRange.to));
  }, [returns, dateRange.from, dateRange.to]);

  const filteredCashTransactions = useMemo(() => {
    return cashTransactions.filter(t => isDateInRange(t.date, dateRange.from, dateRange.to));
  }, [cashTransactions, dateRange.from, dateRange.to]);

  // إحصائيات التدفق النقدي للفترة المختارة
  const periodCashFlowSummary = useMemo(() => {
    let totalInward = 0;
    let totalOutward = 0;
    for (const t of filteredCashTransactions) {
      const amt = Number(t.amount) || 0;
      if (amt > 0) totalInward += amt;
      else if (amt < 0) totalOutward += Math.abs(amt);
    }
    return {
      totalInward: Number(totalInward.toFixed(2)),
      totalOutward: Number(totalOutward.toFixed(2)),
      netFlow: Number((totalInward - totalOutward).toFixed(2))
    };
  }, [filteredCashTransactions]);

  // الحسابات المالية على الفترة المختارة فقط
  const totalSalesBeforeDiscount = filteredInvoices.reduce((sum, i) => sum + (i.totalBeforeDiscount || i.netAmount || 0), 0);
  const totalSalesRevenue = filteredInvoices.reduce((sum, i) => sum + i.netAmount, 0);
  const totalSalesTax = filteredInvoices.reduce((sum, i) => sum + (i.taxAmount || 0), 0);
  const totalPurchasesAmount = filteredPurchases.reduce((sum, p) => sum + (p.netAmount ?? p.netTotal ?? p.totalAmount ?? 0), 0);

  let totalGoodsCost: number | undefined = undefined;
  let netRealizedProfit: number | undefined = undefined;

  if (canViewProfit) {
    let costSum = 0;
    let profitSum = 0;
    for (const inv of filteredInvoices) {
      profitSum += (inv.profit || 0);
      for (const line of (inv.lines || [])) {
        costSum += ((line.purchasePriceAtSale || 0) + (line.packagingCostAtSale || 0)) * (line.quantity || 1);
      }
    }
    totalGoodsCost = costSum;
    netRealizedProfit = profitSum;
  }

  // مديونيات العملاء والموردين
  const totalSupplierDebts = suppliers.reduce((sum, s) => sum + s.currentBalance, 0);
  const totalCustomerReceivables = customers.reduce((sum, c) => sum + (c.currentBalance > 0 ? c.currentBalance : 0), 0);

  // النواقص
  const lowStockItems = useMemo(() => {
    return items.filter(it => it.status !== 'مؤرشف' && it.stockQuantity <= (it.reorderLimit || 5));
  }, [items]);

  // قائمة الأصناف المفلترة بالبحث في حركة الصنف
  const searchableItems = useMemo(() => {
    const normQ = normalizeArabicText(itemSearchQuery);
    if (!normQ) return items;
    return items.filter(it => {
      const haystack = normalizeArabicText(`${it.name || ''} ${it.sku || ''} ${it.barcode || ''}`);
      return haystack.includes(normQ);
    });
  }, [items, itemSearchQuery]);

  // تصدير التقارير بترميز UTF-8 مع BOM
  const exportToExcelOrCsv = (dataRows: any[], sheetName: string, fileName: string, format: 'xlsx' | 'csv' = 'xlsx') => {
    if (dataRows.length === 0) {
      setExportError('لا توجد بيانات متاحة للتصدير');
      return;
    }
    setExportError(null);

    const ws = XLSX.utils.json_to_sheet(dataRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const periodSuffix = dateRange.from && dateRange.to ? `${dateRange.from}_إلى_${dateRange.to}` : 'كل_الفترات';

    if (format === 'xlsx') {
      XLSX.writeFile(wb, `${fileName}_${periodSuffix}.xlsx`);
    } else {
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}_${periodSuffix}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // تقرير BNPL مستقل بسطح واحد خاص به
  if (activeTab === 'BNPL') {
    if (!platformsEnabled) {
      return (
        <PageSurface dir="rtl" title="تقسيط المنصات (BNPL)">
          <p className="text-xs font-semibold text-[var(--text-secondary)]">
            تم إيقاف مبيعات ووظائف المنصات من إعدادات النظام.
          </p>
        </PageSurface>
      );
    }
    if (!canViewBnpl) {
      return (
        <PageSurface dir="rtl" title="تقسيط المنصات (BNPL)">
          <p className="text-xs font-semibold text-[var(--text-secondary)]">
            عذراً، لا تملك صلاحية عرض تقارير تقسيط المنصات (BNPL).
          </p>
        </PageSurface>
      );
    }
    return (
      <BnplReportView
        user={user || null}
        userRole={userRole}
        platforms={platforms}
        initialDateRange={dateRange}
      />
    );
  }

  // تقرير أصناف لم تُبع من شاشة البيع بسطح واحد خاص به
  if (activeTab === 'UNSOLD_CART_ITEMS') {
    if (!canViewUnsoldCartItems) {
      return (
        <PageSurface dir="rtl" title="أصناف لم تُبع من شاشة البيع">
          <p className="text-xs font-semibold text-[var(--text-secondary)]">
            عذراً، لا تملك صلاحية عرض تقرير أصناف لم تُبع من شاشة البيع.
          </p>
        </PageSurface>
      );
    }
    return (
      <UnsoldCartItemsReportView
        user={user || null}
        userRole={userRole}
        users={users}
      />
    );
  }

  const reportHeaderMeta: Record<Exclude<ReportTab, 'BNPL' | 'UNSOLD_CART_ITEMS'>, { title: string; subtitle: string }> = {
    FINANCIAL: {
      title: 'الملخص المالي والربحية',
      subtitle: canViewProfit
        ? `صافي المبيعات، الضريبة، تكلفة البضاعة، والأرباح المحققة (${periodLabel})`
        : `حركة المبيعات وتدفق الطلبات مع حجب تكاليف الشراء وهوامش الربح (${periodLabel})`
    },
    SALES_PURCHASES: {
      title: 'تقرير المبيعات والمشتريات',
      subtitle: `مقارنة حجم التوريدات والمبيعات والتحصيل — الفترة: ${periodLabel}`
    },
    CASH_FLOW: {
      title: 'حركة الخزائن والتدفق النقدي',
      subtitle: `إجمالي الحركات النقدية الداخلة والخارجة وأرصدة الخزائن — الفترة: ${periodLabel}`
    },
    BALANCES: {
      title: 'مديونية الموردين والعملاء',
      subtitle: 'الأرصدة المستحقة للموردين والمستحقات القائمة على العملاء'
    },
    LOW_STOCK: {
      title: `نواقص المخزون (${lowStockItems.length})`,
      subtitle: 'الأصناف التي بلغت حد إعادة الطلب أو نفدت وتحتاج إلى أوامر شراء'
    },
    ITEM_MOVEMENT: {
      title: 'حركة الصنف التفصيلية',
      subtitle: `رصيد أول المدة، الوارد والمنصرف، ورصيد آخر المدة للصنف المختار — الفترة: ${periodLabel}`
    },
    STOCK_ADJUSTMENTS: {
      title: 'تسويات المخزون',
      subtitle: `عمليات الجرد والتسوية اليدوية والزيادة والعجز — الفترة: ${periodLabel}`
    },
    RECONCILIATION: {
      title: 'تقرير المطابقة وترحيل القيود',
      subtitle: `النظام لا يقوم بأي تعديل تلقائي للسجلات التاريخية — مراجعة واعتماد الترحيل اليدوي (${periodLabel})`
    }
  };

  const currentMeta = reportHeaderMeta[activeTab];
  const usesDateRange = activeTab !== 'BALANCES' && activeTab !== 'LOW_STOCK';

  // زر التصدير الخاص بالتقرير المعروض داخل صف الفلاتر
  const renderExportButton = () => {
    if (activeTab === 'FINANCIAL') {
      return (
        <button
          type="button"
          onClick={() => {
            if (!platformsEnabled) {
              const rows = financialSummaryRows.map(r => ({
                'البند': r.label,
                'القيمة': r.value,
                'ملاحظات': r.note || '',
                'الفترة': periodLabel
              }));
              exportToExcelOrCsv(rows, 'الملخص_المالي', 'الملخص_المالي');
              return;
            }
            const rows = platforms.map(p => {
              const invs = filteredInvoices.filter(i => i.platformId === p.id || i.platform === p.name);
              const rev = invs.reduce((s, i) => s + i.netAmount, 0);
              const base: Record<string, any> = {
                'المنصة': p.name,
                'نسبة العمولة': `${p.discountPercentage}%`,
                'عدد الفواتير': invs.length,
                'صافي المبيعات': rev,
                'الفترة': periodLabel
              };
              if (canViewProfit) {
                base['الأرباح المحققة'] = invs.reduce((s, i) => s + (i.profit || 0), 0);
              }
              return base;
            });
            exportToExcelOrCsv(rows, 'مبيعات_المنصات', 'مبيعات_المنصات');
          }}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>تصدير Excel</span>
        </button>
      );
    }

    if (activeTab === 'SALES_PURCHASES') {
      return (
        <button
          type="button"
          onClick={() => {
            const rows = filteredInvoices.map(i => ({
              'النوع': 'بيع',
              'رقم الفاتورة': i.invoiceNumber,
              'التاريخ': i.date.slice(0, 10),
              'الطرف': i.platformName || i.platform || 'مباشر',
              'المبلغ الصافي': i.netAmount,
              'الضريبة': i.taxAmount || 0,
              'الفترة': periodLabel
            })).concat(
              filteredPurchases.map(p => ({
                'النوع': 'شراء',
                'رقم الفاتورة': p.invoiceNumber,
                'التاريخ': p.date.slice(0, 10),
                'الطرف': p.supplierName,
                'المبلغ الصافي': p.netAmount ?? p.netTotal ?? p.totalAmount ?? 0,
                'الضريبة': 0,
                'الفترة': periodLabel
              }))
            );
            exportToExcelOrCsv(rows, 'مبيعات_ومشتريات', 'تقرير_مبيعات_ومشتريات');
          }}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>تصدير Excel</span>
        </button>
      );
    }

    if (activeTab === 'CASH_FLOW') {
      return (
        <button
          type="button"
          onClick={() => {
            const rows = filteredCashTransactions.map(t => ({
              'التاريخ': t.date.slice(0, 10),
              'الخزينة': t.cashboxName,
              'نوع الحركة': t.type || t.transactionType || '',
              'المبلغ': t.amount,
              'الرصيد بعدها': t.balanceAfter,
              'المستند': t.documentNumber || '',
              'المستخدم': t.userName,
              'البيان': t.statement || t.notes || '',
              'الفترة': periodLabel
            }));
            exportToExcelOrCsv(rows, 'التدفق_النقدي', 'تدفق_نقدية');
          }}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>تصدير Excel</span>
        </button>
      );
    }

    if (activeTab === 'LOW_STOCK') {
      return (
        <button
          type="button"
          onClick={() => {
            const rows = lowStockItems.map(it => ({
              'الصنف': it.name,
              'كود SKU': it.sku || '',
              'الباركود': it.barcode || '',
              'المورد': it.supplier || '',
              'الرصيد الحالي': it.stockQuantity,
              'حد إعادة الطلب': it.reorderLimit || 5,
              'الوحدة': it.unit || 'قطعة'
            }));
            exportToExcelOrCsv(rows, 'نواقص_المخزون', 'تقرير_النواقص');
          }}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>تصدير Excel</span>
        </button>
      );
    }

    if (activeTab === 'ITEM_MOVEMENT' && canViewItemMovement) {
      return (
        <button
          type="button"
          disabled={!itemMovementReport}
          onClick={() => {
            if (!itemMovementReport) return;
            const rows: any[] = [
              {
                'التاريخ': dateRange.from || 'بداية المدة',
                'نوع الحركة': 'رصيد أول المدة',
                'رقم المستند': '-',
                'المخزن': '-',
                'الوارد (+)': 0,
                'الصادر (-)': 0,
                'الرصيد التراكمي': itemMovementReport.initialBalance,
                'المستخدم': '-',
                'البيان': `رصيد أول المدة (${periodLabel})`
              },
              ...itemMovementReport.movements.map(m => ({
                'التاريخ': m.date.slice(0, 10),
                'نوع الحركة': m.movementType,
                'رقم المستند': m.documentNumber,
                'المخزن': m.warehouseName || '-',
                'الوارد (+)': m.inwardQty,
                'الصادر (-)': m.outwardQty,
                'الرصيد التراكمي': m.runningBalance,
                'المستخدم': m.userName,
                'البيان': m.notes || ''
              })),
              {
                'التاريخ': dateRange.to || 'نهاية المدة',
                'نوع الحركة': 'رصيد آخر المدة',
                'رقم المستند': '-',
                'المخزن': '-',
                'الوارد (+)': itemMovementReport.totalInward,
                'الصادر (-)': itemMovementReport.totalOutward,
                'الرصيد التراكمي': itemMovementReport.finalBalance,
                'المستخدم': '-',
                'البيان': `رصيد آخر المدة (${periodLabel})`
              }
            ];
            exportToExcelOrCsv(rows, 'حركة_الصنف', `حركة_صنف_${itemMovementReport.item.name}`);
          }}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>تصدير Excel</span>
        </button>
      );
    }

    if (activeTab === 'STOCK_ADJUSTMENTS' && canViewStockAdjustments) {
      return (
        <button
          type="button"
          disabled={!stockAdjustmentsReport}
          onClick={() => {
            const list = stockAdjustmentsReport?.adjustments || stockAdjustmentsReport?.records || [];
            const rows = list.map(a => ({
              'التاريخ': a.date.slice(0, 10),
              'الصنف': a.itemName,
              'المخزن': a.warehouseName || '-',
              'كود الصنف': a.itemCode || a.sku || a.barcode || a.itemId,
              'نوع التسوية': a.movementType || a.source || 'تسوية جرد',
              'الفرق': a.quantityChange ?? a.adjustmentAmount ?? a.difference ?? 0,
              'الرصيد قبل': a.previousBalance ?? a.quantityBefore ?? 0,
              'الرصيد بعد': a.newBalance ?? a.quantityAfter ?? 0,
              'السبب / البيان': a.reason,
              'المستخدم': a.userName,
              'الفترة': periodLabel
            }));
            exportToExcelOrCsv(rows, 'تسويات_المخزون', 'تقرير_تسويات_المخزون');
          }}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>تصدير Excel</span>
        </button>
      );
    }

    return null;
  };

  // صفوف ملخصات المؤشرات لكل تقرير (جدول عمودين: البند | القيمة)
  const financialSummaryRows: ReportSummaryRow[] = [
    {
      label: 'إجمالي المبيعات وصافي التحصيل',
      value: `${totalSalesRevenue.toLocaleString()} ج.م`,
      note: `قبل الخصم: ${totalSalesBeforeDiscount.toLocaleString()} ج.م (${filteredInvoices.length} فاتورة • ${filteredReturns.length} مرتجع)`,
      valueClassName: 'ui-money-sale'
    },
    {
      label: 'ضريبة القيمة المضافة (VAT)',
      value: `${totalSalesTax.toLocaleString()} ج.م`,
      note: 'مستحقة للدولة منفصلة عن الأرباح',
      valueClassName: 'ui-link'
    },
    ...(canViewProfit
      ? [
          {
            label: 'تكلفة البضاعة والتجهيز',
            value: `${(totalGoodsCost || 0).toLocaleString()} ج.م`,
            note: 'شراء + تغليف للوحدات المباعة',
            valueClassName: 'ui-stock-out'
          },
          {
            label: 'صافي الأرباح المحققة',
            value: `${(netRealizedProfit || 0).toLocaleString()} ج.م`,
            note: `هامش الربح: ${totalSalesRevenue > 0 ? (((netRealizedProfit || 0) / totalSalesRevenue) * 100).toFixed(1) : 0}%`,
            valueClassName: 'ui-money-purchase'
          }
        ]
      : [
          {
            label: 'بيانات التكاليف وهوامش الأرباح',
            value: 'محجوبة وفق صلاحيات الحساب (RBAC)'
          }
        ])
  ];

  const platformRowsStats = platforms.map(plt => {
    const pltInvoices = filteredInvoices.filter(i => i.platformId === plt.id || i.platform === plt.name);
    const pltRevenue = pltInvoices.reduce((s, i) => s + i.netAmount, 0);
    const pltProfit = pltInvoices.reduce((s, i) => s + (i.profit || 0), 0);
    return {
      plt,
      count: pltInvoices.length,
      revenue: pltRevenue,
      profit: pltProfit
    };
  });
  const totalPlatformOps = platformRowsStats.reduce((s, r) => s + r.count, 0);
  const totalPlatformRev = platformRowsStats.reduce((s, r) => s + r.revenue, 0);
  const totalPlatformProfit = platformRowsStats.reduce((s, r) => s + r.profit, 0);

  const salesPurchasesSummaryRows: ReportSummaryRow[] = [
    {
      label: 'إجمالي فواتير البيع',
      value: `${totalSalesRevenue.toLocaleString()} ج.م`,
      note: `${filteredInvoices.length} فاتورة بيع في الفترة`,
      valueClassName: 'ui-money-sale'
    },
    {
      label: 'إجمالي فواتير الشراء',
      value: `${totalPurchasesAmount.toLocaleString()} ج.م`,
      note: `${filteredPurchases.length} فاتورة شراء في الفترة`,
      valueClassName: 'ui-stock-low'
    },
    {
      label: 'صافي الفرق (المبيعات − المشتريات)',
      value: `${(totalSalesRevenue - totalPurchasesAmount).toLocaleString()} ج.م`
    }
  ];

  const cashFlowSummaryRows: ReportSummaryRow[] = [
    {
      label: 'إجمالي الوارد النقدي (الفترة)',
      value: `+${periodCashFlowSummary.totalInward.toLocaleString()} ج.م`,
      valueClassName: 'ui-money-purchase'
    },
    {
      label: 'إجمالي الصادر النقدي (الفترة)',
      value: `-${periodCashFlowSummary.totalOutward.toLocaleString()} ج.م`,
      valueClassName: 'ui-stock-out'
    },
    {
      label: 'صافي التدفق النقدي (الفترة)',
      value: `${periodCashFlowSummary.netFlow >= 0 ? `+${periodCashFlowSummary.netFlow.toLocaleString()}` : periodCashFlowSummary.netFlow.toLocaleString()} ج.م`,
      valueClassName: periodCashFlowSummary.netFlow >= 0 ? 'ui-money-sale' : 'ui-stock-out'
    }
  ];
  const totalCashboxBalances = cashboxes.reduce((s, cb) => s + (Number(cb.currentBalance) || 0), 0);

  const balancesSummaryRows: ReportSummaryRow[] = [
    {
      label: 'مديونية الموردين المستحقة',
      value: `${totalSupplierDebts.toLocaleString()} ج.م`,
      note: `${suppliers.filter(s => s.currentBalance > 0).length} مورد برصيد دائن`,
      valueClassName: 'ui-stock-low'
    },
    {
      label: 'مستحقات على العملاء',
      value: `${totalCustomerReceivables.toLocaleString()} ج.م`,
      note: `${customers.filter(c => c.currentBalance > 0).length} عميل برصيد مدين`,
      valueClassName: 'ui-stock-out'
    }
  ];
  const debtorSuppliers = suppliers.filter(s => s.currentBalance > 0);
  const debtorCustomers = customers.filter(c => c.currentBalance > 0);

  const zeroStockCount = lowStockItems.filter(it => it.stockQuantity <= 0).length;
  const lowStockSummaryRows: ReportSummaryRow[] = [
    {
      label: 'إجمالي الأصناف الناقصة',
      value: `${lowStockItems.length} صنف`
    },
    {
      label: 'أصناف نفدت تماماً (رصيد <= 0)',
      value: `${zeroStockCount} صنف`,
      valueClassName: 'ui-stock-out'
    },
    {
      label: 'أصناف تحت حد إعادة الطلب',
      value: `${lowStockItems.length - zeroStockCount} صنف`,
      valueClassName: 'ui-stock-low'
    }
  ];
  const lowStockTotalRemaining = lowStockItems.reduce((s, it) => s + (Number(it.stockQuantity) || 0), 0);

  const movementSummaryRows: ReportSummaryRow[] = itemMovementReport
    ? [
        {
          label: 'رصيد أول المدة',
          value: `${itemMovementReport.initialBalance} ${itemMovementReport.item?.unit || 'قطعة'}`,
          valueClassName: 'ui-stock-low'
        },
        {
          label: 'إجمالي الوارد (+)',
          value: `+${itemMovementReport.totalInward ?? itemMovementReport.totalIn ?? 0} ${itemMovementReport.item?.unit || 'قطعة'}`,
          valueClassName: 'ui-money-purchase'
        },
        {
          label: 'إجمالي الصادر (-)',
          value: `-${itemMovementReport.totalOutward ?? itemMovementReport.totalOut ?? 0} ${itemMovementReport.item?.unit || 'قطعة'}`,
          valueClassName: 'ui-stock-out'
        },
        {
          label: 'رصيد آخر المدة',
          value: `${itemMovementReport.finalBalance} ${itemMovementReport.item?.unit || 'قطعة'}`,
          valueClassName: 'ui-money-sale'
        }
      ]
    : [];

  const adjustmentsList = stockAdjustmentsReport?.adjustments || stockAdjustmentsReport?.records || [];
  const netAdjustmentsValue =
    stockAdjustmentsReport?.netAdjustment ?? stockAdjustmentsReport?.netChange ?? 0;
  const adjustmentsSummaryRows: ReportSummaryRow[] = stockAdjustmentsReport
    ? [
        {
          label: 'إجمالي الزيادات الجردية (+)',
          value: `+${stockAdjustmentsReport.totalIncreases}`,
          valueClassName: 'ui-money-purchase'
        },
        {
          label: 'إجمالي العجز والاستبعاد (-)',
          value: `-${stockAdjustmentsReport.totalDecreases}`,
          valueClassName: 'ui-stock-out'
        },
        {
          label: 'صافي التسويات (الفترة)',
          value: netAdjustmentsValue >= 0 ? `+${netAdjustmentsValue}` : `${netAdjustmentsValue}`
        }
      ]
    : [];

  const reconciliationSummaryRows: ReportSummaryRow[] = [
    {
      label: 'إجمالي المستندات المفحوصة',
      value: `${reconciliationData?.totalAudited ?? '...'}`
    },
    {
      label: 'العمليات غير المرحلة',
      value: `${reconciliationData?.unpostedCount ?? 0}`,
      valueClassName: 'ui-stock-low'
    },
    {
      label: 'فروق الخزائن غير المرحلة',
      value: `${(reconciliationData?.discrepantCashboxAmount || 0).toFixed(2)} ج.م`,
      valueClassName: 'ui-money-sale'
    },
    {
      label: 'فروق الدفاتر المعلقة',
      value: `${(reconciliationData?.discrepantLedgerAmount || 0).toFixed(2)} ج.م`
    }
  ];
  const reconciliationTotalAmount = (reconciliationData?.items || []).reduce(
    (s, it) => s + (Number(it.totalAmount) || 0),
    0
  );

  return (
    <PageSurface dir="rtl" title={currentMeta.title} subtitle={currentMeta.subtitle}>
      {/* صف الفلاتر المضغوط + أزرار التصدير والطباعة */}
      <div className="flex flex-wrap items-end gap-3 pb-4 border-b border-[var(--border-subtle)]">
        {usesDateRange && (
          <DateRangeFilter
            inline
            value={dateRange}
            onChange={setDateRange}
            storageKey="reports"
            defaultPreset="THIS_MONTH"
          />
        )}

        {activeTab === 'ITEM_MOVEMENT' && canViewItemMovement && (
          <div className="no-print flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="item-movement-search"
                className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
              >
                بحث عن صنف
              </label>
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 pointer-events-none" />
                <input
                  id="item-movement-search"
                  type="text"
                  value={itemSearchQuery}
                  onChange={(e) => setItemSearchQuery(e.target.value)}
                  placeholder="الاسم أو الباركود أو الكود..."
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} pr-9 text-xs`}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="item-movement-select"
                className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
              >
                الصنف
              </label>
              <select
                id="item-movement-select"
                value={selectedMovementItemId}
                onChange={(e) => setSelectedMovementItemId(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-semibold`}
              >
                {searchableItems.map(it => (
                  <option key={it.id} value={it.id}>
                    {it.name} ({it.sku || it.barcode || it.id}) — الرصيد: {it.stockQuantity}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="item-movement-warehouse"
                className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
              >
                المخزن
              </label>
              {canChooseAllWarehouses ? (
                <select
                  id="item-movement-warehouse"
                  value={movementWarehouseId || defaultWarehouseId || 'ALL'}
                  onChange={(e) => setMovementWarehouseId(e.target.value)}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
                >
                  <option value="ALL">كل المخازن</option>
                  {reportWarehouseOptions.map(wh => (
                    <option key={wh.id} value={wh.id}>
                      {wh.name}{wh.status !== 'نشط' ? ` (${wh.status})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} flex items-center text-xs font-bold`}>
                  {reportWarehouseOptions[0]?.name || 'المخزن الرئيسي'}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'STOCK_ADJUSTMENTS' && canViewStockAdjustments && (
          <div className="no-print flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="stock-adj-warehouse"
                className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
              >
                المخزن
              </label>
              {canChooseAllWarehouses ? (
                <select
                  id="stock-adj-warehouse"
                  value={adjustmentWarehouseId || defaultWarehouseId || 'ALL'}
                  onChange={(e) => setAdjustmentWarehouseId(e.target.value)}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
                  aria-label="فلتر المخزن"
                >
                  <option value="ALL">كل المخازن</option>
                  {reportWarehouseOptions.map(wh => (
                    <option key={wh.id} value={wh.id}>
                      {wh.name}{wh.status !== 'نشط' ? ` (${wh.status})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} flex items-center text-xs font-bold`}>
                  {reportWarehouseOptions[0]?.name || 'المخزن الرئيسي'}
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="stock-adj-item"
                className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
              >
                الصنف
              </label>
              <select
                id="stock-adj-item"
                value={selectedAdjustmentItemId}
                onChange={(e) => setSelectedAdjustmentItemId(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-semibold`}
              >
                <option value="ALL">جميع الأصناف</option>
                {items.map(it => (
                  <option key={it.id} value={it.id}>{it.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {activeTab === 'RECONCILIATION' && (
          <button
            type="button"
            onClick={loadReconciliation}
            disabled={isLoadingReconciliation}
            className="no-print min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingReconciliation ? 'animate-spin' : ''}`} />
            <span>إعادة فحص العمليات</span>
          </button>
        )}

        <div className="no-print inline-flex items-center gap-2">
          {renderExportButton()}

          <button
            type="button"
            data-shortcut-print="true"
            onClick={handlePrint}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-semibold transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة</span>
            <ShortcutBadge actionId="general.print_page" />
          </button>
        </div>

        {(activeTab === 'ITEM_MOVEMENT' || activeTab === 'STOCK_ADJUSTMENTS') && (
          <div className="print-only print-filter-summary">
            {activeTab === 'ITEM_MOVEMENT'
              ? `الصنف: ${items.find(i => i.id === selectedMovementItemId)?.name || '-'} • المخزن: ${
                  (movementWarehouseId || defaultWarehouseId || 'ALL') === 'ALL'
                    ? 'كل المخازن'
                    : reportWarehouseOptions.find(w => w.id === (movementWarehouseId || defaultWarehouseId))?.name || 'المخزن'
                }`
              : `المخزن: ${
                  (adjustmentWarehouseId || defaultWarehouseId || 'ALL') === 'ALL'
                    ? 'كل المخازن'
                    : reportWarehouseOptions.find(w => w.id === (adjustmentWarehouseId || defaultWarehouseId))?.name || 'المخزن'
                } • الصنف: ${
                  selectedAdjustmentItemId === 'ALL'
                    ? 'جميع الأصناف'
                    : items.find(i => i.id === selectedAdjustmentItemId)?.name || selectedAdjustmentItemId
                }`}
          </div>
        )}
      </div>

      {exportError && (
        <div role="alert" className="no-print text-xs font-bold ui-stock-low flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{exportError}</span>
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="min-h-[44px] px-2 text-xs underline cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* 1) الملخص المالي والربحية */}
      {activeTab === 'FINANCIAL' && (
        <>
          <SectionHeading
            title={`المؤشرات المالية (${periodLabel})`}
            actions={
              <span className="text-xs text-[var(--text-secondary)]">
                الفواتير المشمولة: {filteredInvoices.length} فاتورة بيع • {filteredReturns.length} مرتجع
              </span>
            }
          />
          <ReportSummaryTable rows={financialSummaryRows} ariaLabel="ملخص المؤشرات المالية والربحية" />

          {platformsEnabled && (
            <>
              <SectionHeading title={`توزيع المبيعات حسب المنصة (${periodLabel})`} />
              <CompactTable ariaLabel="توزيع المبيعات حسب المنصة">
                <thead>
                  <tr>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المنصة</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>نسبة الخصم</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>عدد العمليات</th>
                    <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>صافي المبيعات</th>
                    {canViewProfit && (
                      <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>الأرباح المحققة</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {platformRowsStats.map(({ plt, count, revenue, profit }) => (
                    <tr key={plt.id}>
                      <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {plt.name}
                      </td>
                      <td className={`text-center font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                        {plt.discountPercentage}%
                      </td>
                      <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                        {count}
                      </td>
                      <td className={`text-left font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                        {revenue.toLocaleString()} ج.م
                      </td>
                      {canViewProfit && (
                        <td className={`text-left font-bold ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                          {profit.toLocaleString()} ج.م
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="text-right font-bold" colSpan={2}>
                      الإجمالي ({platforms.length} منصة)
                    </td>
                    <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                      {totalPlatformOps}
                    </td>
                    <td className={`text-left font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                      {totalPlatformRev.toLocaleString()} ج.م
                    </td>
                    {canViewProfit && (
                      <td className={`text-left font-bold ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                        {totalPlatformProfit.toLocaleString()} ج.م
                      </td>
                    )}
                  </tr>
                </tfoot>
              </CompactTable>
            </>
          )}
        </>
      )}

      {/* 2) تقرير المبيعات والمشتريات */}
      {activeTab === 'SALES_PURCHASES' && (
        <>
          <SectionHeading title={`ملخص المبيعات والمشتريات (${periodLabel})`} />
          <ReportSummaryTable rows={salesPurchasesSummaryRows} ariaLabel="ملخص المبيعات والمشتريات" />

          <SectionHeading
            title={`فواتير البيع (${filteredInvoices.length})`}
            actions={
              filteredInvoices.length > 30 ? (
                <span className="text-xs text-[var(--text-secondary)]">
                  يُعرض أحدث 30 فاتورة، والتصدير يشمل الكل
                </span>
              ) : undefined
            }
          />
          <CompactTable ariaLabel="جدول فواتير البيع">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم الفاتورة</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>التاريخ</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>{platformsEnabled ? 'المنصة / الطرف' : 'الطرف'}</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>المبلغ الصافي</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-[var(--text-secondary)] py-6">
                    لا توجد فواتير بيع في هذه الفترة
                  </td>
                </tr>
              ) : (
                filteredInvoices.slice(0, 30).map(inv => (
                  <tr key={inv.invoiceNumber}>
                    <td className={`font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>{inv.invoiceNumber}</td>
                    <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {inv.date.slice(0, 10)}
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>
                      {platformsEnabled
                        ? inv.platformName || inv.platform || 'مباشر'
                        : inv.customerName || inv.platformName || inv.platform || 'مباشر'}
                    </td>
                    <td className={`text-left font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                      {inv.netAmount.toLocaleString()} ج.م
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-right font-bold" colSpan={3}>
                  إجمالي فواتير البيع ({filteredInvoices.length})
                </td>
                <td className={`text-left font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                  {totalSalesRevenue.toLocaleString()} ج.م
                </td>
              </tr>
            </tfoot>
          </CompactTable>

          <SectionHeading
            title={`فواتير الشراء (${filteredPurchases.length})`}
            actions={
              filteredPurchases.length > 30 ? (
                <span className="text-xs text-[var(--text-secondary)]">
                  يُعرض أحدث 30 فاتورة، والتصدير يشمل الكل
                </span>
              ) : undefined
            }
          />
          <CompactTable ariaLabel="جدول فواتير الشراء">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم الفاتورة</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>التاريخ</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المورد</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>المبلغ الصافي</th>
              </tr>
            </thead>
            <tbody>
              {filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-[var(--text-secondary)] py-6">
                    لا توجد فواتير شراء في هذه الفترة
                  </td>
                </tr>
              ) : (
                filteredPurchases.slice(0, 30).map(pur => {
                  const purNet = pur.netAmount ?? pur.netTotal ?? pur.totalAmount ?? 0;
                  return (
                    <tr key={pur.invoiceNumber}>
                      <td className={`font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>{pur.invoiceNumber}</td>
                      <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {pur.date.slice(0, 10)}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{pur.supplierName}</td>
                      <td className={`text-left font-bold ui-stock-low ${COMPACT_TABLE_NUM_CLASS}`}>
                        {purNet.toLocaleString()} ج.م
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-right font-bold" colSpan={3}>
                  إجمالي فواتير الشراء ({filteredPurchases.length})
                </td>
                <td className={`text-left font-bold ui-stock-low ${COMPACT_TABLE_NUM_CLASS}`}>
                  {totalPurchasesAmount.toLocaleString()} ج.م
                </td>
              </tr>
            </tfoot>
          </CompactTable>
        </>
      )}

      {/* 3) حركة الخزائن والتدفق النقدي */}
      {activeTab === 'CASH_FLOW' && (
        <>
          <SectionHeading title={`ملخص التدفق النقدي (${periodLabel})`} />
          <ReportSummaryTable rows={cashFlowSummaryRows} ariaLabel="ملخص التدفق النقدي" />

          <SectionHeading title={`أرصدة الخزائن (${cashboxes.length})`} />
          <CompactTable ariaLabel="جدول أرصدة الخزائن">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>اسم الخزينة</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الحالة</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>الرصيد المتوفر</th>
              </tr>
            </thead>
            <tbody>
              {cashboxes.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center text-[var(--text-secondary)] py-6">
                    لا توجد خزائن مسجلة
                  </td>
                </tr>
              ) : (
                cashboxes.map(cb => (
                  <tr key={cb.id}>
                    <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                      {cb.name}
                    </td>
                    <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>{cb.status}</td>
                    <td className={`text-left font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                      {cb.currentBalance.toLocaleString()} {cb.currency}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-right font-bold" colSpan={2}>
                  إجمالي أرصدة الخزائن ({cashboxes.length})
                </td>
                <td className={`text-left font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                  {totalCashboxBalances.toLocaleString()} ج.م
                </td>
              </tr>
            </tfoot>
          </CompactTable>
        </>
      )}

      {/* 4) مديونية الموردين والعملاء */}
      {activeTab === 'BALANCES' && (
        <>
          <SectionHeading title="ملخص المديونيات والمستحقات" />
          <ReportSummaryTable rows={balancesSummaryRows} ariaLabel="ملخص مديونية الموردين والعملاء" />

          <SectionHeading title={`مديونية الموردين المستحقة (${debtorSuppliers.length})`} />
          <CompactTable ariaLabel="جدول مديونية الموردين">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المورد</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الهاتف</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>الرصيد المستحق</th>
              </tr>
            </thead>
            <tbody>
              {debtorSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center text-[var(--text-secondary)] py-6">
                    لا توجد مستحقات حالية للموردين
                  </td>
                </tr>
              ) : (
                debtorSuppliers.map(s => (
                  <tr key={s.id}>
                    <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                      {s.name}
                    </td>
                    <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {s.phone || '—'}
                    </td>
                    <td className={`text-left font-bold ui-stock-low ${COMPACT_TABLE_NUM_CLASS}`}>
                      {s.currentBalance.toLocaleString()} ج.م
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-right font-bold" colSpan={2}>
                  الإجمالي ({debtorSuppliers.length} مورد)
                </td>
                <td className={`text-left font-bold ui-stock-low ${COMPACT_TABLE_NUM_CLASS}`}>
                  {totalSupplierDebts.toLocaleString()} ج.م
                </td>
              </tr>
            </tfoot>
          </CompactTable>

          <SectionHeading title={`مستحقات على العملاء (${debtorCustomers.length})`} />
          <CompactTable ariaLabel="جدول مستحقات العملاء">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>العميل</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الهاتف</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>الرصيد المستحق</th>
              </tr>
            </thead>
            <tbody>
              {debtorCustomers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center text-[var(--text-secondary)] py-6">
                    لا توجد مستحقات معلقة على العملاء
                  </td>
                </tr>
              ) : (
                debtorCustomers.map(c => (
                  <tr key={c.id}>
                    <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                      {c.name}
                    </td>
                    <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {c.phone || '—'}
                    </td>
                    <td className={`text-left font-bold ui-stock-out ${COMPACT_TABLE_NUM_CLASS}`}>
                      {c.currentBalance.toLocaleString()} ج.م
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-right font-bold" colSpan={2}>
                  الإجمالي ({debtorCustomers.length} عميل)
                </td>
                <td className={`text-left font-bold ui-stock-out ${COMPACT_TABLE_NUM_CLASS}`}>
                  {totalCustomerReceivables.toLocaleString()} ج.م
                </td>
              </tr>
            </tfoot>
          </CompactTable>
        </>
      )}

      {/* 5) نواقص المخزون */}
      {activeTab === 'LOW_STOCK' && (
        <>
          <SectionHeading title="ملخص النواقص" />
          <ReportSummaryTable rows={lowStockSummaryRows} ariaLabel="ملخص نواقص المخزون" />

          <SectionHeading title={`الأصناف التي بلغت حد إعادة الطلب (${lowStockItems.length})`} />
          <CompactTable ariaLabel="جدول نواقص المخزون">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>اسم الصنف</th>
                <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>SKU / الباركود</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المورد المعتمد</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الرصيد المتبقي</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>حد إعادة الطلب</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الموقف</th>
              </tr>
            </thead>
            <tbody>
              {lowStockItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center font-bold ui-money-purchase py-8">
                    المخزون سليم بالكامل، ولا توجد أصناف وصلت إلى حد إعادة الطلب
                  </td>
                </tr>
              ) : (
                lowStockItems.map(it => {
                  const isZero = it.stockQuantity <= 0;
                  return (
                    <tr key={it.id}>
                      <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {it.name}
                      </td>
                      <td className={`font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {it.sku || it.barcode || '-'}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{it.supplier || '-'}</td>
                      <td className={`text-center font-bold ${isZero ? 'ui-stock-out' : 'ui-stock-low'} ${COMPACT_TABLE_NUM_CLASS}`}>
                        {it.stockQuantity} {it.unit || 'قطعة'}
                      </td>
                      <td className={`text-center text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {it.reorderLimit || 5}
                      </td>
                      <td className={`text-center font-bold ${isZero ? 'ui-stock-out' : 'ui-stock-low'} ${COMPACT_TABLE_NUM_CLASS}`}>
                        {isZero ? 'نفد تماماً' : 'منخفض'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-right font-bold" colSpan={3}>
                  الإجمالي ({lowStockItems.length} صنف)
                </td>
                <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                  {lowStockTotalRemaining}
                </td>
                <td className="text-center" colSpan={2}>
                  نفد: {zeroStockCount} • منخفض: {lowStockItems.length - zeroStockCount}
                </td>
              </tr>
            </tfoot>
          </CompactTable>
        </>
      )}

      {/* 6) حركة الصنف */}
      {activeTab === 'ITEM_MOVEMENT' && (
        !canViewItemMovement ? (
          <p className="text-xs font-semibold text-[var(--text-secondary)]">
            عذراً، لا تملك صلاحية عرض تقرير حركة الصنف.
          </p>
        ) : isLoadingItemMovement ? (
          <div className="py-10 flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
            <RefreshCw className="w-4 h-4 animate-spin ui-link" />
            <span>جاري تحميل تقرير حركة الصنف...</span>
          </div>
        ) : itemMovementReport ? (
          <>
            <SectionHeading
              title={`ملخص حركة الصنف (${periodLabel})`}
              actions={
                itemMovementReport.item?.name ? (
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {itemMovementReport.item.name}
                  </span>
                ) : undefined
              }
            />
            <ReportSummaryTable rows={movementSummaryRows} ariaLabel="ملخص أرصدة حركة الصنف" />

            <SectionHeading title={`سجل حركات الصنف (${itemMovementReport.movements.length})`} />
            <CompactTable ariaLabel="جدول حركة الصنف">
              <thead>
                <tr>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>التاريخ</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>نوع الحركة</th>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم المستند</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المخزن</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>وارد (+)</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>صادر (-)</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الرصيد بعد الحركة</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المستخدم</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>البيان</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={`text-center font-mono ${COMPACT_TABLE_NUM_CLASS}`}>{dateRange.from || '—'}</td>
                  <td className={`font-bold ui-stock-low ${COMPACT_TABLE_TEXT_CLASS}`} colSpan={3}>
                    رصيد أول المدة {dateRange.from ? `(قبل ${dateRange.from})` : ''}
                  </td>
                  <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>—</td>
                  <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>—</td>
                  <td className={`text-center font-bold ui-stock-low ${COMPACT_TABLE_NUM_CLASS}`}>
                    {itemMovementReport.initialBalance} {itemMovementReport.item?.unit || 'قطعة'}
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS} colSpan={2}>—</td>
                </tr>

                {itemMovementReport.movements.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-[var(--text-secondary)] py-8">
                      لا توجد حركات مسجلة لهذا الصنف خلال الفترة المختارة
                    </td>
                  </tr>
                ) : (
                  itemMovementReport.movements.map(m => {
                    const inQty = m.inwardQty ?? m.quantityIn ?? 0;
                    const outQty = m.outwardQty ?? m.quantityOut ?? 0;
                    const runBal = m.runningBalance ?? m.balanceAfter ?? 0;
                    return (
                      <tr key={m.id}>
                        <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                          {m.date.slice(0, 10)}
                        </td>
                        <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                          {m.movementType}
                        </td>
                        <td className={`font-mono font-bold ui-link ${COMPACT_TABLE_NUM_CLASS}`}>
                          {m.documentNumber}
                        </td>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>{m.warehouseName || '-'}</td>
                        <td className={`text-center font-bold ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                          {inQty > 0 ? `+${inQty}` : '-'}
                        </td>
                        <td className={`text-center font-bold ui-stock-out ${COMPACT_TABLE_NUM_CLASS}`}>
                          {outQty > 0 ? `-${outQty}` : '-'}
                        </td>
                        <td className={`text-center font-bold text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                          {runBal}
                        </td>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>{m.userName}</td>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>{m.notes || m.reason || '-'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td className={`text-center font-mono ${COMPACT_TABLE_NUM_CLASS}`}>{dateRange.to || '—'}</td>
                  <td className="text-right font-bold" colSpan={3}>
                    رصيد آخر المدة
                  </td>
                  <td className={`text-center font-bold ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                    +{itemMovementReport.totalInward ?? itemMovementReport.totalIn ?? 0}
                  </td>
                  <td className={`text-center font-bold ui-stock-out ${COMPACT_TABLE_NUM_CLASS}`}>
                    -{itemMovementReport.totalOutward ?? itemMovementReport.totalOut ?? 0}
                  </td>
                  <td className={`text-center font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                    {itemMovementReport.finalBalance} {itemMovementReport.item?.unit || 'قطعة'}
                  </td>
                  <td className="text-right" colSpan={2}>{periodLabel}</td>
                </tr>
              </tfoot>
            </CompactTable>
          </>
        ) : null
      )}

      {/* 7) تسويات المخزون */}
      {activeTab === 'STOCK_ADJUSTMENTS' && (
        !canViewStockAdjustments ? (
          <p className="text-xs font-semibold text-[var(--text-secondary)]">
            عذراً، لا تملك صلاحية عرض تقرير تسويات المخزون.
          </p>
        ) : isLoadingStockAdjustments ? (
          <div className="py-10 flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
            <RefreshCw className="w-4 h-4 animate-spin ui-link" />
            <span>جاري تحميل تقرير تسويات المخزون...</span>
          </div>
        ) : stockAdjustmentsReport ? (
          <>
            <SectionHeading title={`ملخص تسويات المخزون (${periodLabel})`} />
            <ReportSummaryTable rows={adjustmentsSummaryRows} ariaLabel="ملخص تسويات المخزون" />

            <SectionHeading title={`تفاصيل التسويات (${adjustmentsList.length})`} />
            <CompactTable ariaLabel="جدول تسويات المخزون">
              <thead>
                <tr>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>التاريخ</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصنف</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المخزن</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>نوع التسوية</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>مقدار التعديل</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الرصيد قبل</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الرصيد بعد</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>السبب / البيان</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المستخدم</th>
                </tr>
              </thead>
              <tbody>
                {adjustmentsList.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-[var(--text-secondary)] py-8">
                      لا توجد تسويات مخزون مسجلة في الفترة المختارة
                    </td>
                  </tr>
                ) : (
                  adjustmentsList.map(adj => {
                    const qtyChg = adj.quantityChange ?? adj.adjustmentAmount ?? adj.difference ?? 0;
                    const prevBal = adj.previousBalance ?? adj.quantityBefore ?? 0;
                    const newBal = adj.newBalance ?? adj.quantityAfter ?? 0;
                    return (
                      <tr key={adj.id}>
                        <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                          {adj.date.slice(0, 10)}
                        </td>
                        <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                          {adj.itemName}
                        </td>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>{adj.warehouseName || '-'}</td>
                        <td className={`font-semibold ${COMPACT_TABLE_TEXT_CLASS}`}>
                          {adj.movementType || adj.source || 'تسوية جرد'}
                        </td>
                        <td className={`text-center font-bold ${qtyChg >= 0 ? 'ui-money-purchase' : 'ui-stock-out'} ${COMPACT_TABLE_NUM_CLASS}`}>
                          {qtyChg >= 0 ? `+${qtyChg}` : qtyChg}
                        </td>
                        <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>{prevBal}</td>
                        <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>{newBal}</td>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>{adj.reason || '-'}</td>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>{adj.userName}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td className="text-right font-bold" colSpan={4}>
                    الإجمالي ({adjustmentsList.length} تسوية)
                  </td>
                  <td className={`text-center font-bold ${netAdjustmentsValue >= 0 ? 'ui-money-purchase' : 'ui-stock-out'} ${COMPACT_TABLE_NUM_CLASS}`}>
                    {netAdjustmentsValue >= 0 ? `+${netAdjustmentsValue}` : netAdjustmentsValue}
                  </td>
                  <td colSpan={4} className="text-right">
                    زيادة: +{stockAdjustmentsReport.totalIncreases} • عجز: -{stockAdjustmentsReport.totalDecreases}
                  </td>
                </tr>
              </tfoot>
            </CompactTable>
          </>
        ) : null
      )}

      {/* 8) تقرير المطابقة المحاسبية وترحيل القيود */}
      {activeTab === 'RECONCILIATION' && (
        <>
          {reconciliationFeedback && (
            <div
              role="alert"
              className={`text-xs font-bold flex items-center gap-2 ${
                reconciliationFeedback.type === 'success' ? 'ui-money-purchase' : 'ui-stock-out'
              }`}
            >
              {reconciliationFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{reconciliationFeedback.message}</span>
            </div>
          )}

          <SectionHeading title={`ملخص المطابقة المحاسبية (${periodLabel})`} />
          <ReportSummaryTable rows={reconciliationSummaryRows} ariaLabel="ملخص المطابقة المحاسبية" />

          <SectionHeading
            title={`العمليات التاريخية غير المرحلة (${reconciliationData?.items?.length || 0})`}
            actions={
              <span className="text-xs text-[var(--text-secondary)]">
                اعتماد الترحيل اليدوي وفق القيود المحاسبية الصحيحة
              </span>
            }
          />

          {isLoadingReconciliation ? (
            <div className="py-10 flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
              <RefreshCw className="w-4 h-4 animate-spin ui-link" />
              <span>جاري تدقيق وفحص قيود الفواتير والمخزون والخزائن...</span>
            </div>
          ) : !reconciliationData || reconciliationData.items.length === 0 ? (
            <p className="py-6 text-xs font-bold ui-money-purchase flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>جميع العمليات في الفترة المحددة مرحلة ومطابقة محاسبيًا بالكامل.</span>
            </p>
          ) : (
            <CompactTable ariaLabel="جدول العمليات غير المرحلة">
              <thead>
                <tr>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>نوع المستند</th>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>المرجع والتاريخ</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>{platformsEnabled ? 'الطرف / المنصة' : 'الطرف'}</th>
                  <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>المبلغ الإجمالي</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>طريقة السداد</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الخزينة</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الدفتر</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>المخزون</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>تفاصيل عدم الترحيل</th>
                  <th className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {reconciliationData.items.map(item => (
                  <tr key={item.id}>
                    <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {item.documentType}
                    </td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>
                      <div className="font-mono font-bold text-[var(--text-primary)]">{item.documentNumber}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{item.date?.slice(0, 10)}</div>
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{item.partyName}</td>
                    <td className={`text-left font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                      {item.totalAmount.toFixed(2)} ج.م
                    </td>
                    <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                      {item.paymentType || 'نقدي'}
                    </td>
                    <td className={`text-center font-bold ${item.missingCashbox ? 'ui-stock-out' : 'ui-money-purchase'} ${COMPACT_TABLE_NUM_CLASS}`}>
                      {item.missingCashbox ? 'غير مسجل' : 'مطابق'}
                    </td>
                    <td className={`text-center font-bold ${item.missingLedger ? 'ui-stock-low' : 'ui-money-purchase'} ${COMPACT_TABLE_NUM_CLASS}`}>
                      {item.missingLedger ? 'غير مسجل' : 'مطابق'}
                    </td>
                    <td className={`text-center font-bold ${item.missingStock ? 'ui-stock-low' : 'ui-money-purchase'} ${COMPACT_TABLE_NUM_CLASS}`}>
                      {item.missingStock ? 'غير موثق' : 'مطابق'}
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{item.details}</td>
                    <td className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                      <button
                        type="button"
                        onClick={() => handlePostItem(item)}
                        disabled={postingItemId === item.id}
                        className="min-h-[44px] px-3 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white font-bold text-xs whitespace-nowrap transition disabled:opacity-50 cursor-pointer"
                      >
                        {postingItemId === item.id ? 'جاري الترحيل...' : 'ترحيل معتمد'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="text-right font-bold" colSpan={3}>
                    الإجمالي ({reconciliationData.items.length} عملية)
                  </td>
                  <td className={`text-left font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                    {reconciliationTotalAmount.toFixed(2)} ج.م
                  </td>
                  <td colSpan={5} />
                  <td className="no-print" />
                </tr>
              </tfoot>
            </CompactTable>
          )}
        </>
      )}
    </PageSurface>
  );
};

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  Invoice,
  Platform,
  Item,
  ItemPlatformCost,
  ReturnRecord,
  UserAccount,
  UserRole,
  TaxSettings,
  DeliveryOrder,
  DeliveryOrderStatus
} from '../types';
import { hasPermission } from '../utils/permissions';
import { EditInvoiceModal } from '../components/EditInvoiceModal';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { DateRange, getDateRangeForPreset, isDateInRange, normalizeArabicText } from '../utils/dateUtils';
import {
  Receipt,
  Search,
  Printer,
  RotateCcw,
  Eye,
  FileEdit,
  Ban,
  AlertCircle,
  Download,
  Truck,
  ArrowLeft
} from 'lucide-react';
import { api } from '../api/client';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ModalShell,
  ReportSummaryTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
} from '../components/ui';
import { ShortcutBadge } from '../context/KeyboardShortcutsContext';
import { getHrefForTarget, isPlainLeftClick } from '../config/navigation';

const FINAL_DELIVERY_STATUSES: readonly DeliveryOrderStatus[] = ['اتسلم', 'رجع المحل', 'اتلغى'];

const DELIVERY_EDIT_BLOCK_REASON =
  'لا يمكن تعديل فاتورة التوصيل من شاشة الفواتير. إذا لم يُسلَّم الطلب أرجعه («رجع المحل») أو ألغِه («اتلغى») من شاشة إدارة التوصيل.';

const DELIVERY_CANCEL_BLOCK_REASON =
  'لا يمكن إلغاء فاتورة التوصيل من شاشة الفواتير. ألغِ الطلب من شاشة إدارة التوصيل بحالة «اتلغى» لتسجيل مرتجع رسمي وإرجاع المخزون تلقائيًا.';

function deliveryStatusTextClass(status: DeliveryOrderStatus): string {
  switch (status) {
    case 'جديد':
      return 'text-sky-700 dark:text-sky-300';
    case 'خرج للتوصيل':
      return 'text-amber-700 dark:text-amber-300';
    case 'اتسلم':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'ما اتسلمش':
      return 'text-orange-700 dark:text-orange-300';
    case 'رجع المحل':
    case 'اتلغى':
      return 'text-rose-700 dark:text-rose-300';
    default:
      return 'text-[var(--text-primary)]';
  }
}

function formatDeliveryAssignee(order: DeliveryOrder): string {
  if (!order.assigneeName) return 'غير موزع بعد';
  if (order.assigneeType === 'driver') return `طيار — ${order.assigneeName}`;
  if (order.assigneeType === 'courier') return `شركة شحن — ${order.assigneeName}`;
  return order.assigneeName;
}

interface InvoicesPageProps {
  invoices: Invoice[];
  platforms?: Platform[];
  items?: Item[];
  costs?: ItemPlatformCost[];
  returns?: ReturnRecord[];
  user: UserAccount | null;
  userRole: UserRole;
  taxSettings?: TaxSettings;
  editInvoiceLatestItemFirst?: boolean;
  onPrintInvoice: (invoice: Invoice, isReprint?: boolean, forceModal?: boolean) => void;
  onInitiateReturn: (invoice: Invoice) => void;
  onUpdateInvoice?: (invoiceNumber: string, payload: any) => Promise<void>;
  onNavigateToDeliveryOrders?: (searchTerm?: string) => void;
  onNavigateToDeliverySettlements?: () => void;
}

export const InvoicesPage: React.FC<InvoicesPageProps> = ({
  invoices,
  platforms = [],
  items = [],
  costs = [],
  returns = [],
  user,
  userRole,
  taxSettings,
  editInvoiceLatestItemFirst = false,
  onPrintInvoice,
  onInitiateReturn,
  onUpdateInvoice,
  onNavigateToDeliveryOrders,
  onNavigateToDeliverySettlements
}) => {
  const isManager = userRole === 'manager' || userRole === 'designer' || user?.isOwner;
  const canViewProfit = isManager || hasPermission(user, 'reports.view_profit');
  const canEditAfterSave = user?.role === 'designer' || Boolean(user?.isOwner) || hasPermission(user, 'invoices.edit_after_save');
  const canCancel = user?.role === 'designer' || Boolean(user?.isOwner) || hasPermission(user, 'invoices.cancel');
  const canViewDelivery = user?.role === 'designer' || Boolean(user?.isOwner) || hasPermission(user, 'delivery.view');
  const canSettleDelivery = user?.role === 'designer' || Boolean(user?.isOwner) || hasPermission(user, 'delivery.settle');

  const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([]);
  const [deliveryOrdersLoading, setDeliveryOrdersLoading] = useState<boolean>(false);
  const [deliveryOrdersError, setDeliveryOrdersError] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewDelivery) {
      setDeliveryOrders([]);
      setDeliveryOrdersLoading(false);
      setDeliveryOrdersError(null);
      return;
    }

    let cancelled = false;
    setDeliveryOrdersLoading(true);
    setDeliveryOrdersError(null);

    api
      .getDeliveryOrders()
      .then((res) => {
        if (cancelled) return;
        if (res.success && Array.isArray(res.orders)) {
          setDeliveryOrders(res.orders);
        } else {
          setDeliveryOrdersError(res.error || 'تعذر تحميل بيانات طلبات التوصيل');
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setDeliveryOrdersError(err?.message || 'تعذر تحميل بيانات طلبات التوصيل');
      })
      .finally(() => {
        if (!cancelled) setDeliveryOrdersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canViewDelivery, invoices]);

  const deliveryOrdersIndex = useMemo(() => {
    const byId = new Map<string, DeliveryOrder>();
    const byInvoiceNumber = new Map<string, DeliveryOrder>();
    for (const order of deliveryOrders) {
      if (order.id) byId.set(order.id, order);
      if (order.invoiceNumber) byInvoiceNumber.set(order.invoiceNumber, order);
    }
    return { byId, byInvoiceNumber };
  }, [deliveryOrders]);

  const getLinkedDeliveryOrder = useCallback(
    (inv: Invoice): DeliveryOrder | null => {
      if (inv.deliveryOrderId) {
        const byId = deliveryOrdersIndex.byId.get(inv.deliveryOrderId);
        if (byId) return byId;
      }
      return deliveryOrdersIndex.byInvoiceNumber.get(inv.invoiceNumber) || null;
    },
    [deliveryOrdersIndex]
  );

  const isDeliveryInvoice = useCallback(
    (inv: Invoice): boolean =>
      Boolean(inv.deliveryOrderId || inv.creditPartyType === 'delivery' || getLinkedDeliveryOrder(inv)),
    [getLinkedDeliveryOrder]
  );

  const getManualReturnEligibility = useCallback(
    (inv: Invoice): { allowed: boolean; reason: string } => {
      if (!isDeliveryInvoice(inv)) {
        return { allowed: true, reason: '' };
      }

      if (inv.status === 'مرتجع' || inv.status === 'ملغاة') {
        return { allowed: false, reason: 'الفاتورة مغلقة بالفعل.' };
      }

      if (deliveryOrdersLoading) {
        return { allowed: false, reason: 'جاري التحقق من حالة طلب التوصيل وتسويته...' };
      }

      if (!canViewDelivery) {
        return {
          allowed: false,
          reason:
            'تعذر التحقق من حالة طلب التوصيل وتسويته لعدم توفر صلاحية عرض التوصيل. راجع شاشة إدارة التوصيل.'
        };
      }

      const order = getLinkedDeliveryOrder(inv);
      if (deliveryOrdersError || !order) {
        return {
          allowed: false,
          reason: 'تعذر جلب حالة طلب التوصيل أو تسويته من السيرفر. راجع شاشة إدارة التوصيل أولًا.'
        };
      }

      if (!FINAL_DELIVERY_STATUSES.includes(order.status)) {
        return {
          allowed: false,
          reason: `طلب التوصيل ما زال مفتوحًا (${order.status}). إذا لم يُسلَّم الطلب أرجعه من شاشة إدارة التوصيل بحالة «رجع المحل» أو ألغِه بحالة «اتلغى».`
        };
      }

      if (order.status === 'رجع المحل' || order.status === 'اتلغى' || Boolean(order.returnNumber)) {
        return {
          allowed: false,
          reason: `تم إغلاق طلب التوصيل بحالة «${order.status}»${order.returnNumber ? ` بمرتجع رسمي رقم ${order.returnNumber}` : ''}.`
        };
      }

      if (order.status === 'اتسلم' && order.paymentMode === 'cod' && !order.settlementId) {
        return {
          allowed: false,
          reason:
            'طلب التوصيل تم تسليمه (الدفع عند الاستلام) ولم تُسوَّ مستحقاته بعد. سوِّ الطلب من شاشة تسويات التوصيل أولًا قبل تسجيل مرتجع يدوي.'
        };
      }

      if (order.status === 'اتسلم' && (order.paymentMode === 'prepaid' || Boolean(order.settlementId))) {
        return { allowed: true, reason: '' };
      }

      return {
        allowed: false,
        reason: 'لا يمكن تسجيل مرتجع يدوي لهذه الفاتورة حاليًا؛ راجع شاشة إدارة التوصيل.'
      };
    },
    [canViewDelivery, deliveryOrdersError, deliveryOrdersLoading, getLinkedDeliveryOrder, isDeliveryInvoice]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [platformFilter, setPlatformFilter] = useState<string>('ALL');
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRangeForPreset('THIS_MONTH'));
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [invoiceToEdit, setInvoiceToEdit] = useState<Invoice | null>(null);
  const [invoiceToCancel, setInvoiceToCancel] = useState<Invoice | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [platformOrderOverrides, setPlatformOrderOverrides] = useState<Record<string, string>>({});
  const [platformOrderEditInvoice, setPlatformOrderEditInvoice] = useState<Invoice | null>(null);
  const [platformOrderEditValue, setPlatformOrderEditValue] = useState<string>('');
  const [platformOrderEditReason, setPlatformOrderEditReason] = useState<string>('');
  const [isSavingPlatformOrder, setIsSavingPlatformOrder] = useState<boolean>(false);
  const [platformOrderEditError, setPlatformOrderEditError] = useState<string | null>(null);

  const effectiveInvoices = useMemo(() => {
    if (Object.keys(platformOrderOverrides).length === 0) return invoices;
    return invoices.map(inv =>
      Object.prototype.hasOwnProperty.call(platformOrderOverrides, inv.invoiceNumber)
        ? { ...inv, platformOrderId: platformOrderOverrides[inv.invoiceNumber] }
        : inv
    );
  }, [invoices, platformOrderOverrides]);

  const handleOpenPlatformOrderEdit = (inv: Invoice) => {
    setPlatformOrderEditInvoice(inv);
    setPlatformOrderEditValue(inv.platformOrderId || '');
    setPlatformOrderEditReason('');
    setPlatformOrderEditError(null);
  };

  const handleConfirmPlatformOrderEdit = async () => {
    if (!platformOrderEditInvoice) return;
    if (!platformOrderEditReason.trim()) {
      setPlatformOrderEditError('سبب التعديل مطلوب');
      return;
    }
    setIsSavingPlatformOrder(true);
    setPlatformOrderEditError(null);
    try {
      const res = await api.setInvoicePlatformOrder(
        platformOrderEditInvoice.invoiceNumber,
        platformOrderEditValue.trim(),
        platformOrderEditReason.trim()
      );
      if (res.success && res.invoice) {
        const updatedVal = res.invoice.platformOrderId || '';
        setPlatformOrderOverrides(prev => ({
          ...prev,
          [platformOrderEditInvoice.invoiceNumber]: updatedVal
        }));
        platformOrderEditInvoice.platformOrderId = updatedVal;
        setSelectedInvoice(prev =>
          prev && prev.invoiceNumber === platformOrderEditInvoice.invoiceNumber
            ? { ...prev, platformOrderId: updatedVal }
            : prev
        );
        setPlatformOrderEditInvoice(null);
      } else {
        setPlatformOrderEditError((res as any).error || 'تعذر حفظ رقم طلب المنصة');
      }
    } catch (err: any) {
      setPlatformOrderEditError(err.message || 'تعذر حفظ رقم طلب المنصة');
    } finally {
      setIsSavingPlatformOrder(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!invoiceToCancel) return;
    setIsCancelling(true);
    setCancelError(null);
    try {
      const res = await api.cancelInvoice(invoiceToCancel.invoiceNumber, cancellationReason);
      if (res.success) {
        setInvoiceToCancel(null);
        invoiceToCancel.status = 'ملغاة';
      } else {
        setCancelError(res.error || 'فشل إلغاء الفاتورة');
      }
    } catch (err: any) {
      setCancelError(err.message || 'حدث خطأ أثناء إلغاء الفاتورة');
    } finally {
      setIsCancelling(false);
    }
  };

  // تصفية الفواتير بالبحث والمنصة والتاريخ (بتوقيت القاهرة) والحالة
  const filteredInvoices = useMemo(() => {
    const normQ = normalizeArabicText(searchQuery);

    return effectiveInvoices.filter(inv => {
      if (!isDateInRange(inv.date, dateRange.from, dateRange.to)) {
        return false;
      }

      const matchesStatus = statusFilter === 'ALL' || inv.status === statusFilter;
      if (!matchesStatus) return false;

      const matchesPlatform =
        platformFilter === 'ALL' ||
        (inv.platform && inv.platform.toLowerCase().includes(platformFilter.toLowerCase()));
      if (!matchesPlatform) return false;

      if (!normQ) return true;
      const linkedOrder = getLinkedDeliveryOrder(inv);
      const haystack = normalizeArabicText(
        `${inv.invoiceNumber || ''} ${inv.platformOrderId || ''} ${inv.offlineProvisionalNo || ''} ${inv.tempInvoiceNumber || ''} ${inv.platform || ''} ${inv.notes || ''} ${inv.createdBy || ''} ${inv.customerName || ''} ${linkedOrder?.number || ''} ${linkedOrder?.trackingNumber || ''} ${linkedOrder?.assigneeName || ''} ${linkedOrder?.zoneName || ''} ${linkedOrder?.returnNumber || ''} ${linkedOrder?.status || ''}`
      );
      return haystack.includes(normQ);
    });
  }, [effectiveInvoices, searchQuery, statusFilter, platformFilter, dateRange.from, dateRange.to, getLinkedDeliveryOrder]);

  const periodLabel = useMemo(() => {
    if (dateRange.from && dateRange.to) return `من ${dateRange.from} إلى ${dateRange.to}`;
    if (dateRange.from) return `من ${dateRange.from}`;
    if (dateRange.to) return `حتى ${dateRange.to}`;
    return 'كل الفترات';
  }, [dateRange.from, dateRange.to]);

  // إجماليات الفترة المفلترة (مع استبعاد الفواتير الملغاة من المجاميع المالية)
  const periodTotals = useMemo(() => {
    const active = filteredInvoices.filter(inv => inv.status !== 'ملغاة');
    const totalBefore = active.reduce((s, i) => s + (i.totalBeforeDiscount || 0), 0);
    const totalNet = active.reduce((s, i) => s + (i.netAmount || 0), 0);
    const totalDeductions = active.reduce(
      (s, i) => s + (i.discountAmount || 0) + (i.pickupFeeAmount || 0),
      0
    );
    const totalProfit = active.reduce((s, i) => s + (i.profit || 0), 0);
    return {
      count: filteredInvoices.length,
      activeCount: active.length,
      totalBefore,
      totalNet,
      totalDeductions,
      totalProfit
    };
  }, [filteredInvoices]);

  const handleExportPeriodInvoices = () => {
    if (filteredInvoices.length === 0) return;
    const rows = filteredInvoices.map(inv => {
      const linkedOrder = getLinkedDeliveryOrder(inv);
      const base: Record<string, any> = {
        'رقم الفاتورة': inv.invoiceNumber,
        'رقم طلب المنصة': inv.platformOrderId || '-',
        'رقم طلب التوصيل': linkedOrder?.number || (inv.deliveryOrderId ? 'توصيل' : '-'),
        'حالة التوصيل': linkedOrder?.status || '-',
        'التاريخ': inv.date.slice(0, 10),
        'المنصة': inv.platform,
        'المخزن': inv.warehouseName || '-',
        'العميل': inv.customerName || 'نقدي',
        'الحالة': inv.status,
        'الإجمالي قبل الخصم': inv.totalBeforeDiscount,
        'الخصم': inv.discountAmount,
        'رسوم التوصيل': inv.deliveryFee || 0,
        'رسوم الالتقاط': inv.pickupFeeAmount || 0,
        'الصافي': inv.netAmount,
        'المستخدم': inv.createdBy,
        'الفترة': periodLabel
      };
      if (canViewProfit && inv.profit !== undefined) {
        base['صافي الربح'] = inv.profit;
      }
      return base;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'سجل_الفواتير');
    const suffix = dateRange.from && dateRange.to ? `${dateRange.from}_${dateRange.to}` : 'كل_الفترات';
    XLSX.writeFile(wb, `سجل_الفواتير_${suffix}.xlsx`);
  };

  const selectedInvoiceTotalsRows = useMemo(() => {
    if (!selectedInvoice) return [];
    const bnplVal =
      selectedInvoice.bnplTotalAmount ??
      selectedInvoice.lines?.reduce((s, l) => s + ((l.bnplUnitAmount || 0) * (l.quantity || 1)), 0) ??
      0;
    const rows: Array<{ label: string; value: string; tone?: 'default' | 'sale' | 'purchase' | 'accent'; emphasize?: boolean }> = [
      {
        label: 'الإجمالي قبل الخصم',
        value: `${(selectedInvoice.totalBeforeDiscount || 0).toFixed(2)} ج.م`,
      },
    ];
    if (bnplVal > 0) {
      rows.push({
        label: 'تقسيط المنصة (BNPL)',
        value: `- ${bnplVal.toFixed(2)} ج.م`,
        tone: 'purchase',
      });
    }
    rows.push({
      label: 'إجمالي الخصم المطبق',
      value: `- ${(selectedInvoice.discountAmount || 0).toFixed(2)} ج.م`,
      tone: 'purchase',
    });
    if (selectedInvoice.deliveryFee && selectedInvoice.deliveryFee > 0) {
      rows.push({
        label: 'رسوم التوصيل',
        value: `+ ${selectedInvoice.deliveryFee.toFixed(2)} ج.م`,
      });
    }
    if (selectedInvoice.pickupFeeAmount && selectedInvoice.pickupFeeAmount > 0) {
      rows.push({
        label: 'إجمالي رسوم الالتقاط المستقطعة',
        value: `- ${selectedInvoice.pickupFeeAmount.toFixed(2)} ج.م`,
        tone: 'purchase',
      });
    }
    if (selectedInvoice.taxAmount && selectedInvoice.taxAmount > 0) {
      rows.push({
        label: 'ضريبة القيمة المضافة (VAT)',
        value: `${selectedInvoice.taxAmount.toFixed(2)} ج.م`,
      });
    }
    rows.push({
      label: 'صافي الفاتورة / المطلوب',
      value: `${(selectedInvoice.netAmount || 0).toFixed(2)} ج.م`,
      tone: 'accent',
      emphasize: true,
    });
    if (isManager && selectedInvoice.profit !== undefined) {
      rows.push({
        label: 'صافي ربح الفاتورة (للمدير فقط)',
        value: `+${selectedInvoice.profit.toFixed(2)} ج.م`,
        tone: 'sale',
        emphasize: true,
      });
    }
    return rows;
  }, [selectedInvoice, isManager]);

  const selectedDeliveryOrder = useMemo(
    () => (selectedInvoice ? getLinkedDeliveryOrder(selectedInvoice) : null),
    [selectedInvoice, getLinkedDeliveryOrder]
  );

  const selectedIsDelivery = useMemo(
    () => (selectedInvoice ? isDeliveryInvoice(selectedInvoice) : false),
    [selectedInvoice, isDeliveryInvoice]
  );

  const selectedReturnEligibility = useMemo(
    () => (selectedInvoice ? getManualReturnEligibility(selectedInvoice) : { allowed: false, reason: '' }),
    [selectedInvoice, getManualReturnEligibility]
  );

  const selectedIsOfflinePending = Boolean(
    selectedInvoice &&
      (selectedInvoice.offlinePending || String(selectedInvoice.invoiceNumber || '').startsWith('OFF-'))
  );

  const selectedDeliveryDetailRows = useMemo(() => {
    if (!selectedInvoice || !selectedIsDelivery) return [];
    const order = selectedDeliveryOrder;
    const rows: Array<{ label: string; value: string; tone?: 'default' | 'sale' | 'purchase' | 'accent'; emphasize?: boolean }> = [];

    if (order) {
      rows.push({
        label: 'رقم طلب التوصيل',
        value: order.number || '—',
        emphasize: true
      });
      rows.push({
        label: 'حالة الطلب',
        value: order.failReason ? `${order.status} (${order.failReason})` : order.status,
        tone: order.status === 'اتسلم' ? 'sale' : order.status === 'رجع المحل' || order.status === 'اتلغى' ? 'purchase' : 'accent',
        emphasize: true
      });
      rows.push({
        label: 'طريقة الدفع',
        value: order.paymentMode === 'cod' ? 'الدفع عند الاستلام' : 'مدفوع مقدمًا'
      });
      if (order.paymentMode === 'cod') {
        rows.push({
          label: 'حالة تسوية التحصيل',
          value: order.settlementId ? 'تمت التسوية' : 'لم تُسوَّ بعد',
          tone: order.settlementId ? 'sale' : 'purchase'
        });
      }
      rows.push({
        label: 'منطقة التوصيل',
        value: order.zoneName || '—'
      });
      rows.push({
        label: 'رسوم التوصيل',
        value: `${Number(order.fee ?? selectedInvoice.deliveryFee ?? 0).toFixed(2)} ج.م`
      });
      rows.push({
        label: 'المسؤول عن التوصيل',
        value: formatDeliveryAssignee(order)
      });
      if (order.trackingNumber) {
        rows.push({
          label: 'رقم التتبع',
          value: order.trackingNumber
        });
      }
      if (order.returnNumber) {
        rows.push({
          label: 'رقم المرتجع الرسمي',
          value: order.returnNumber,
          tone: 'purchase',
          emphasize: true
        });
      }
    } else {
      if (selectedInvoice.deliveryOrderId) {
        rows.push({
          label: 'مرجع طلب التوصيل',
          value: selectedInvoice.deliveryOrderId
        });
      }
      rows.push({
        label: 'رسوم التوصيل',
        value: `${Number(selectedInvoice.deliveryFee || 0).toFixed(2)} ج.م`
      });
      if (selectedInvoice.creditPartyType === 'delivery') {
        rows.push({
          label: 'طريقة الدفع',
          value: 'الدفع عند الاستلام'
        });
      }
    }

    return rows;
  }, [selectedInvoice, selectedIsDelivery, selectedDeliveryOrder]);

  return (
    <PageSurface
      dir="rtl"
      title="سجل الفواتير"
      subtitle="لقطات أسعار البيع والتكاليف المسجلة وقت البيع (Invoices & InvoiceLines)"
      actions={
        <>
          <button
            type="button"
            onClick={handleExportPeriodInvoices}
            disabled={filteredInvoices.length === 0}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>تصدير Excel</span>
          </button>
          <button
            type="button"
            data-shortcut-print="true"
            onClick={() => window.print()}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
          >
            <Printer className="w-4 h-4 text-[#1668B2]" />
            <span>طباعة الكشف</span>
            <ShortcutBadge actionId="general.print_page" />
          </button>
        </>
      }
    >
      {/* سطر إحصائيات مختصر */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]">
        <span>
          الفترة: <strong className="text-[var(--text-primary)]">{periodLabel}</strong>
        </span>
        <span>·</span>
        <span>
          المعروض: <strong className="font-mono tabular-nums text-[var(--text-primary)]">{filteredInvoices.length}</strong> من {invoices.length} فاتورة
        </span>
        <span>·</span>
        <span>
          صافي المبيعات (السارية):{' '}
          <strong className="font-mono tabular-nums ui-money-sale">
            {periodTotals.totalNet.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م
          </strong>
        </span>
        <span>·</span>
        <span>
          الخصومات والشحن:{' '}
          <strong className="font-mono tabular-nums ui-money-purchase">
            {periodTotals.totalDeductions.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م
          </strong>
        </span>
        {canViewProfit && (
          <>
            <span>·</span>
            <span>
              صافي الربح:{' '}
              <strong className="font-mono tabular-nums ui-money-sale">
                +{periodTotals.totalProfit.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م
              </strong>
            </span>
          </>
        )}
      </div>

      {/* صف الفلاتر المضغوط */}
      <div className="flex flex-wrap items-end gap-3 pb-4 border-b border-[var(--border-subtle)]">
        <DateRangeFilter
          inline
          value={dateRange}
          onChange={setDateRange}
          storageKey="invoices_page"
          defaultPreset="THIS_MONTH"
        />

        <div className="no-print">
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            بحث
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="رقم الفاتورة، العميل، الكاشير..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} pl-3 pr-9 text-xs`}
            />
            <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
          </div>
        </div>

        <div className="no-print">
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            المنصة
          </label>
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
          >
            <option value="ALL">جميع المنصات</option>
            {platforms.map(p => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="no-print">
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            الحالة
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
          >
            <option value="ALL">جميع الحالات</option>
            <option value="تم البيع">تم البيع</option>
            <option value="معلّقة">معلّقة (آجل)</option>
            <option value="مسددة">مسددة (آجل)</option>
            <option value="مرتجع جزئي">مرتجع جزئي</option>
            <option value="مرتجع">مرتجع</option>
            <option value="ملغاة">ملغاة</option>
          </select>
        </div>

        {(platformFilter !== 'ALL' || statusFilter !== 'ALL' || searchQuery.trim() !== '') && (
          <div className="print-only print-filter-summary">
            الفلاتر: {platformFilter === 'ALL' ? 'كل المنصات' : `المنصة: ${platformFilter}`} •{' '}
            {statusFilter === 'ALL' ? 'كل الحالات' : `الحالة: ${statusFilter}`}
            {searchQuery.trim() ? ` • بحث: ${searchQuery.trim()}` : ''}
          </div>
        )}
      </div>

      {/* جدول الفواتير */}
      <SectionHeading title={`جدول الفواتير (${filteredInvoices.length})`} />

      {filteredInvoices.length === 0 ? (
        <div className="py-10 text-sm text-[var(--text-secondary)] flex items-center gap-2">
          <Receipt className="w-5 h-5" />
          <span>لم يتم العثور على فواتير تطابق شروط البحث والفلترة</span>
        </div>
      ) : (
        <CompactTable ariaLabel="سجل الفواتير">
          <thead>
            <tr>
              <th className={COMPACT_TABLE_NUM_CLASS}>رقم الفاتورة</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
              <th className={COMPACT_TABLE_TEXT_CLASS}>المنصة / الدفع</th>
              <th className={COMPACT_TABLE_TEXT_CLASS}>العميل / المخزن</th>
              <th className={COMPACT_TABLE_TEXT_CLASS}>الأصناف</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>قبل الخصم</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>الخصم / الالتقاط</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>الصافي</th>
              {canViewProfit && <th className={COMPACT_TABLE_NUM_CLASS}>الربح</th>}
              <th className={COMPACT_TABLE_NUM_CLASS}>الحالة</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>المستخدم</th>
              <th className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filteredInvoices.map((inv) => {
              const dateStr = new Date(inv.date).toLocaleString('ar-EG', {
                dateStyle: 'short',
                timeStyle: 'short'
              });
              const isOfflinePending = Boolean(
                inv.offlinePending || String(inv.invoiceNumber || '').startsWith('OFF-')
              );
              const provisionalNo = inv.offlineProvisionalNo || inv.tempInvoiceNumber;
              const deductions = (inv.discountAmount || 0) + (inv.pickupFeeAmount || 0);
              const isCancelled = inv.status === 'ملغاة';
              const deliveryOrder = getLinkedDeliveryOrder(inv);
              const isDelivery = isDeliveryInvoice(inv);
              const returnEligibility = getManualReturnEligibility(inv);

              return (
                <tr key={inv.invoiceNumber}>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>
                    <div>{inv.invoiceNumber}</div>
                    {isDelivery && (
                      <div className="text-[11px] font-sans font-semibold flex flex-wrap items-center gap-1 text-sky-700 dark:text-sky-300">
                        <Truck className="w-3.5 h-3.5 shrink-0" />
                        <span>توصيل</span>
                        {deliveryOrder?.number && (
                          <>
                            <span>·</span>
                            <span className="font-mono">{deliveryOrder.number}</span>
                          </>
                        )}
                        {deliveryOrder?.status && (
                          <>
                            <span>·</span>
                            <span className={deliveryStatusTextClass(deliveryOrder.status)}>
                              {deliveryOrder.status}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                    {deliveryOrder?.returnNumber && (
                      <div className="text-[11px] font-sans text-[var(--text-secondary)]">
                        مرتجع رسمي:{' '}
                        <span className="font-mono font-bold text-[var(--text-primary)]">
                          {deliveryOrder.returnNumber}
                        </span>
                      </div>
                    )}
                    {inv.platform && inv.platform !== 'البيع المباشر' && inv.platformOrderId && (
                      <div className="text-[11px] font-sans text-[var(--text-secondary)]">
                        رقم طلب المنصة: <span className="font-mono font-bold text-[var(--text-primary)]">{inv.platformOrderId}</span>
                      </div>
                    )}
                    {provisionalNo && provisionalNo !== inv.invoiceNumber && (
                      <div className="text-[11px] text-[var(--text-secondary)]">مؤقت: {provisionalNo}</div>
                    )}
                    {isOfflinePending && (
                      <div className="text-[11px] font-sans ui-stock-low">لم تُرفع بعد</div>
                    )}
                    {inv.needsReview && (
                      <div className="text-[11px] font-sans ui-stock-out">
                        تحتاج مراجعة{inv.reviewReasons && inv.reviewReasons.length > 0 ? `: ${inv.reviewReasons.join('، ')}` : ''}
                      </div>
                    )}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-xs text-[var(--text-secondary)]`}>
                    {dateStr}
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    <div className="font-semibold text-[var(--text-primary)]">{inv.platform}</div>
                    {inv.paymentType === 'آجل' && (
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {inv.creditPartyType === 'delivery'
                          ? 'الدفع عند الاستلام (توصيل)'
                          : `آجل (${
                              inv.creditPartyType === 'platform'
                                ? `منصة: ${inv.creditPartyName || inv.platform}`
                                : `عميل: ${inv.creditPartyName || inv.customerName || '—'}`
                            })`}
                      </div>
                    )}
                    {isDelivery && deliveryOrder && (
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {deliveryOrder.paymentMode === 'cod'
                          ? `عند الاستلام · ${deliveryOrder.settlementId ? 'تمت التسوية' : 'غير مسوّى'}`
                          : 'مدفوع مقدمًا'}
                        {deliveryOrder.zoneName ? ` · ${deliveryOrder.zoneName}` : ''}
                        {(deliveryOrder.fee ?? inv.deliveryFee ?? 0) > 0
                          ? ` · رسوم ${Number(deliveryOrder.fee ?? inv.deliveryFee ?? 0).toFixed(2)} ج.م`
                          : ''}
                      </div>
                    )}
                    {isDelivery && !deliveryOrder && inv.deliveryFee !== undefined && inv.deliveryFee > 0 && (
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        رسوم التوصيل: {inv.deliveryFee.toFixed(2)} ج.م
                      </div>
                    )}
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    <div>{inv.customerName || 'نقدي'}</div>
                    {inv.warehouseName && (
                      <div className="text-[11px] text-[var(--text-secondary)]">{inv.warehouseName}</div>
                    )}
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    <div className="text-xs">
                      {inv.lines?.map(l => `${l.itemNameAtSale} (${l.quantity})`).join('، ') || '—'}
                    </div>
                    {inv.notes && (
                      <div className="text-[11px] text-[var(--text-secondary)]">ملاحظات: {inv.notes}</div>
                    )}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>
                    {(inv.totalBeforeDiscount || 0).toFixed(2)} ج.م
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-money-purchase`}>
                    {deductions.toFixed(2)} ج.م
                    {inv.pickupFeeAmount !== undefined && inv.pickupFeeAmount > 0 && (
                      <div className="text-[11px] text-[var(--text-secondary)]">التقاط: {inv.pickupFeeAmount.toFixed(2)}</div>
                    )}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ${isCancelled ? 'text-[var(--text-secondary)] line-through' : 'ui-money-sale'}`}>
                    {inv.netAmount.toFixed(2)} ج.م
                  </td>
                  {canViewProfit && (
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-semibold ui-money-sale`}>
                      {inv.profit !== undefined ? `+${inv.profit.toFixed(2)} ج.م` : '—'}
                    </td>
                  )}
                  <td className={COMPACT_TABLE_NUM_CLASS}>
                    <span
                      className={`text-xs font-bold ${
                        inv.status === 'تم البيع' || inv.status === 'مسددة'
                          ? 'ui-stock-in'
                          : inv.status === 'معلّقة' || inv.status === 'مرتجع جزئي'
                          ? 'ui-stock-low'
                          : 'ui-stock-out'
                      }`}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-xs text-[var(--text-secondary)]`}>
                    {inv.createdBy}
                  </td>
                  <td className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(inv)}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] transition cursor-pointer"
                        title="عرض تفاصيل لقطة الفاتورة"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onPrintInvoice(inv, true, false)}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] transition cursor-pointer"
                        title="إعادة طباعة الإيصال"
                      >
                        <Printer className="w-4 h-4" />
                      </button>

                      {canEditAfterSave && !isOfflinePending && (
                        isDelivery ? (
                          <button
                            type="button"
                            disabled
                            aria-disabled="true"
                            className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] text-xs font-bold opacity-50 cursor-not-allowed"
                            title={DELIVERY_EDIT_BLOCK_REASON}
                          >
                            <FileEdit className="w-3.5 h-3.5" />
                            <span>تعديل</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setInvoiceToEdit(inv)}
                            className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg bg-[#1668B2] hover:bg-[#125592] text-white text-xs font-bold transition cursor-pointer"
                            title="تعديل الفاتورة بصلاحيات مفصلة"
                          >
                            <FileEdit className="w-3.5 h-3.5" />
                            <span>تعديل</span>
                          </button>
                        )
                      )}

                      {inv.status !== 'مرتجع' && inv.status !== 'ملغاة' && !isOfflinePending && (
                        returnEligibility.allowed ? (
                          <button
                            type="button"
                            onClick={() => onInitiateReturn(inv)}
                            className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-low text-xs font-bold transition cursor-pointer"
                            title="تسجيل مرتجع لهذه الفاتورة"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>مرتجع</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            aria-disabled="true"
                            className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] text-xs font-bold opacity-50 cursor-not-allowed"
                            title={returnEligibility.reason}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>مرتجع</span>
                          </button>
                        )
                      )}

                      {canCancel && inv.status !== 'ملغاة' && !isOfflinePending && (
                        isDelivery ? (
                          <button
                            type="button"
                            disabled
                            aria-disabled="true"
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] opacity-50 cursor-not-allowed"
                            title={DELIVERY_CANCEL_BLOCK_REASON}
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setInvoiceToCancel(inv);
                              setCancellationReason('');
                              setCancelError(null);
                            }}
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-out transition cursor-pointer"
                            title="إلغاء الفاتورة بقيد عكسي معتمد"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="font-bold">
                إجمالي الفواتير السارية ({periodTotals.activeCount} من {periodTotals.count})
              </td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>
                {periodTotals.totalBefore.toFixed(2)} ج.م
              </td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-purchase`}>
                {periodTotals.totalDeductions.toFixed(2)} ج.م
              </td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-sale`}>
                {periodTotals.totalNet.toFixed(2)} ج.م
              </td>
              {canViewProfit && (
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-sale`}>
                  +{periodTotals.totalProfit.toFixed(2)} ج.م
                </td>
              )}
              <td colSpan={2} />
              <td className="no-print" />
            </tr>
          </tfoot>
        </CompactTable>
      )}

      {/* Snapshot Details Modal */}
      {selectedInvoice && (
        <ModalShell
          title={`تفاصيل لقطة الفاتورة ${selectedInvoice.invoiceNumber}`}
          subtitle={`${selectedInvoice.platform} · ${selectedInvoice.status} · ${new Date(selectedInvoice.date).toLocaleString('ar-EG')}`}
          onClose={() => setSelectedInvoice(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  onPrintInvoice(selectedInvoice, true, true);
                  setSelectedInvoice(null);
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs transition cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>معاينة الإيصال</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onPrintInvoice(selectedInvoice, true, false);
                  setSelectedInvoice(null);
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125592] text-white font-bold text-xs transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>إعادة طباعة الإيصال</span>
              </button>
              {canEditAfterSave && !selectedIsOfflinePending && !selectedIsDelivery && (
                <button
                  type="button"
                  onClick={() => {
                    setInvoiceToEdit(selectedInvoice);
                    setSelectedInvoice(null);
                  }}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition cursor-pointer"
                >
                  <FileEdit className="w-4 h-4" />
                  <span>تعديل الفاتورة</span>
                </button>
              )}
              {selectedIsDelivery &&
                selectedInvoice.status !== 'مرتجع' &&
                selectedInvoice.status !== 'ملغاة' &&
                !selectedIsOfflinePending &&
                selectedReturnEligibility.allowed && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = selectedInvoice;
                      setSelectedInvoice(null);
                      onInitiateReturn(target);
                    }}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-low font-bold text-xs transition cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>تسجيل مرتجع يدوي</span>
                  </button>
                )}
              {canEditAfterSave &&
                selectedInvoice.platform &&
                selectedInvoice.platform !== 'البيع المباشر' &&
                selectedInvoice.status !== 'ملغاة' && (
                  <button
                    type="button"
                    onClick={() => handleOpenPlatformOrderEdit(selectedInvoice)}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs transition cursor-pointer"
                  >
                    <FileEdit className="w-4 h-4 text-[#1668B2]" />
                    <span>تعديل رقم طلب المنصة</span>
                  </button>
                )}
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text-primary)] transition cursor-pointer"
              >
                إغلاق
              </button>
            </>
          }
        >
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-[var(--text-secondary)]">
            {selectedInvoice.warehouseName && (
              <span>المخزن: <strong className="text-[var(--text-primary)]">{selectedInvoice.warehouseName}</strong></span>
            )}
            {selectedInvoice.platform && selectedInvoice.platform !== 'البيع المباشر' && (
              <span>
                رقم طلب المنصة:{' '}
                <strong className="font-mono text-[var(--text-primary)]">
                  {selectedInvoice.platformOrderId || '—'}
                </strong>
              </span>
            )}
            <span>نوع الدفع: <strong className="text-[var(--text-primary)]">{selectedInvoice.paymentType || 'نقدي'}</strong></span>
            <span>المستخدم المنفذ: <strong className="text-[var(--text-primary)]">{selectedInvoice.createdBy}</strong></span>
            {selectedInvoice.paymentType === 'آجل' && (
              <>
                <span>
                  طرف الآجل:{' '}
                  <strong className="text-[var(--text-primary)]">
                    {selectedInvoice.creditPartyType === 'delivery'
                      ? 'التوصيل (الدفع عند الاستلام)'
                      : selectedInvoice.creditPartyType === 'platform'
                      ? `منصة (${selectedInvoice.creditPartyName || selectedInvoice.platform})`
                      : `عميل (${selectedInvoice.creditPartyName || selectedInvoice.customerName || '—'})`}
                  </strong>
                </span>
                <span>
                  مبلغ الاستحقاق الآجل:{' '}
                  <strong className="font-mono ui-stock-low">
                    {(
                      selectedInvoice.creditDueAmount ??
                      (selectedInvoice.creditPartyType === 'platform'
                        ? selectedInvoice.netAmount
                        : (selectedInvoice.totalBeforeDiscount || 0) + (selectedInvoice.deliveryFee || 0))
                    )?.toFixed(2)}{' '}
                    ج.م
                  </strong>
                </span>
              </>
            )}
            {(selectedInvoice.offlineProvisionalNo || selectedInvoice.tempInvoiceNumber) && (
              <span>
                الرقم المؤقت:{' '}
                <strong className="font-mono text-[var(--text-primary)]">
                  {selectedInvoice.offlineProvisionalNo || selectedInvoice.tempInvoiceNumber}
                </strong>
              </span>
            )}
            {selectedInvoice.deviceTime && (
              <span>وقت الجهاز: <span>{new Date(selectedInvoice.deviceTime).toLocaleString('ar-EG')}</span></span>
            )}
            {selectedInvoice.needsReview && (
              <span className="ui-stock-out font-bold">
                أسباب المراجعة: {selectedInvoice.reviewReasons && selectedInvoice.reviewReasons.length > 0 ? selectedInvoice.reviewReasons.join('، ') : 'تحتاج مراجعة'}
              </span>
            )}
          </div>

          {selectedIsDelivery && (
            <>
              <SectionHeading title="بيانات التوصيل وضوابط الفاتورة" withTopDivider />

              {deliveryOrdersLoading && !selectedDeliveryOrder ? (
                <div className="text-xs text-[var(--text-secondary)]">
                  جاري تحميل بيانات طلب التوصيل...
                </div>
              ) : (
                <>
                  {selectedDeliveryDetailRows.length > 0 && (
                    <ReportSummaryTable rows={selectedDeliveryDetailRows} />
                  )}

                  {!selectedDeliveryOrder && (
                    <div className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 ui-stock-low" />
                      <span>
                        {!canViewDelivery
                          ? 'لا تتوفر لديك صلاحية عرض طلبات التوصيل لعرض حالة الطلب أو حالة التسوية.'
                          : deliveryOrdersError || 'تعذر العثور على تفاصيل طلب التوصيل المرتبط بهذه الفاتورة.'}
                      </span>
                    </div>
                  )}
                </>
              )}

              <div className="border-r-2 border-[#1668B2] pr-3 text-xs text-[var(--text-secondary)] space-y-1.5">
                <p className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-[#1668B2] shrink-0" />
                  <span>ضوابط فاتورة التوصيل</span>
                </p>
                <p>
                  <strong className="text-[var(--text-primary)]">التعديل والإلغاء:</strong>{' '}
                  لا يمكن تعديل أو إلغاء فاتورة التوصيل من شاشة الفواتير. لتغيير حالة الطلب أو إرجاعه («رجع المحل») أو إلغائه («اتلغى») بمرتجع رسمي، استخدم شاشة إدارة التوصيل.
                </p>
                {selectedInvoice.status !== 'مرتجع' && selectedInvoice.status !== 'ملغاة' && !selectedIsOfflinePending && (
                  <p>
                    <strong className="text-[var(--text-primary)]">المرتجع اليدوي:</strong>{' '}
                    {selectedReturnEligibility.allowed ? (
                      <span className="ui-stock-in font-semibold">
                        متاح الآن لأن الطلب تم تسليمه
                        {selectedDeliveryOrder?.paymentMode === 'cod' ? ' وتمت تسوية مستحقاته.' : ' وهو مدفوع مقدمًا.'}
                      </span>
                    ) : (
                      <span className="ui-stock-low font-semibold">
                        غير متاح حاليًا — {selectedReturnEligibility.reason}
                      </span>
                    )}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {canViewDelivery && onNavigateToDeliveryOrders ? (
                    <a
                      href={getHrefForTarget('delivery_orders', undefined, {
                        searchParams: { search: selectedDeliveryOrder?.number || selectedInvoice.invoiceNumber }
                      })}
                      onClick={(e) => {
                        if (!isPlainLeftClick(e)) return;
                        e.preventDefault();
                        const targetSearch = selectedDeliveryOrder?.number || selectedInvoice.invoiceNumber;
                        setSelectedInvoice(null);
                        onNavigateToDeliveryOrders(targetSearch);
                      }}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125592] text-white text-xs font-bold transition cursor-pointer"
                    >
                      <Truck className="w-4 h-4" />
                      <span>فتح الطلب في شاشة إدارة التوصيل</span>
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </a>
                  ) : (
                    <span className="text-[var(--text-secondary)]">
                      لإدارة الطلب أو تغيير حالته أو إلغائه، يرجى المتابعة من شاشة «إدارة التوصيل» عبر مستخدم يملك الصلاحية.
                    </span>
                  )}

                  {selectedDeliveryOrder?.status === 'اتسلم' &&
                    selectedDeliveryOrder.paymentMode === 'cod' &&
                    !selectedDeliveryOrder.settlementId &&
                    canSettleDelivery &&
                    onNavigateToDeliverySettlements && (
                      <a
                        href={getHrefForTarget('delivery_settlements')}
                        onClick={(e) => {
                          if (!isPlainLeftClick(e)) return;
                          e.preventDefault();
                          setSelectedInvoice(null);
                          onNavigateToDeliverySettlements();
                        }}
                        className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
                      >
                        <span>الانتقال إلى تسويات التوصيل</span>
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </a>
                    )}
                </div>
              </div>
            </>
          )}

          <SectionHeading title={`الأصناف (${selectedInvoice.lines?.length || 0})`} withTopDivider />

          <CompactTable ariaLabel="تفاصيل بنود الفاتورة">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_TEXT_CLASS}>الصنف وقت البيع</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الكمية</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>سعر البيع</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>قيمة الخصم</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الصافي</th>
                {isManager && <th className={COMPACT_TABLE_NUM_CLASS}>ربح الوحدة</th>}
              </tr>
            </thead>
            <tbody>
              {selectedInvoice.lines?.map((line, idx) => (
                <tr key={idx}>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    <div className="font-semibold">{line.itemNameAtSale}</div>
                    {Boolean(line.bnplPercent && line.bnplPercent > 0) && (
                      <div className="text-[11px] ui-link">
                        BNPL +{line.bnplPercent}% (سعر العميل: {line.customerUnitPrice?.toFixed(2)} ج.م)
                      </div>
                    )}
                    {line.barcodeAtSale && (
                      <div className="text-[11px] text-[var(--text-secondary)] font-mono">كود: {line.barcodeAtSale}</div>
                    )}
                    {line.unitTaxAmount && line.unitTaxAmount > 0 ? (
                      <div className="text-[11px] text-[var(--text-secondary)] font-mono">
                        ضريبة: {line.unitTaxAmount.toFixed(2)} ج.م ({line.taxRateAtSale || 0}%)
                      </div>
                    ) : null}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>{line.quantity}</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>
                    {(line.baseUnitPrice !== undefined ? line.baseUnitPrice : line.salePriceAtSale)?.toFixed(2)} ج.م
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-money-purchase`}>
                    - {line.unitDiscountValue?.toFixed(2)} ج.م
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>
                    {line.unitNet?.toFixed(2)} ج.م
                  </td>
                  {isManager && (
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-sale`}>
                      {line.unitProfit !== undefined ? `+${line.unitProfit.toFixed(2)} ج.م` : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </CompactTable>

          <SectionHeading title="الملخص المالي" withTopDivider />
          <ReportSummaryTable rows={selectedInvoiceTotalsRows} />
        </ModalShell>
      )}

      {/* نافذة تعديل الفاتورة بصلاحيات مفصلة */}
      {invoiceToEdit && onUpdateInvoice && (
        <EditInvoiceModal
          invoice={invoiceToEdit}
          items={items}
          platforms={platforms}
          costs={costs}
          returns={returns}
          user={user}
          taxSettings={taxSettings}
          latestItemFirst={editInvoiceLatestItemFirst}
          onClose={() => setInvoiceToEdit(null)}
          onSave={async (payload) => {
            await onUpdateInvoice(invoiceToEdit.invoiceNumber, payload);
            setInvoiceToEdit(null);
          }}
        />
      )}

      {/* مودال إلغاء الفاتورة بقيد عكسي */}
      {invoiceToCancel && (
        <ModalShell
          title="إلغاء فاتورة بيع معتمدة عبر قيد عكسي"
          subtitle={`فاتورة رقم: ${invoiceToCancel.invoiceNumber}`}
          onClose={() => setInvoiceToCancel(null)}
          closeDisabled={isCancelling}
          footer={
            <>
              <button
                type="button"
                onClick={() => setInvoiceToCancel(null)}
                disabled={isCancelling}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={isCancelling || !cancellationReason.trim()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>{isCancelling ? 'جاري تسجيل القيود العكسية...' : 'تأكيد الإلغاء والقيد العكسي'}</span>
              </button>
            </>
          }
        >
          <div className="border-r-2 border-rose-600 pr-3 text-xs text-[var(--text-secondary)] space-y-1">
            <p className="font-bold ui-stock-out">تنبيه محاسبي ومخزني:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>سيتم إعادة كميات الأصناف المباعة إلى المخزون تلقائيًا بحركة إلغاء.</li>
              <li>سيتم قيد قيد عكسي في الخزينة لخصم أي مبالغ تم تحصيلها نقدًا.</li>
              <li>سيتم تخفيض مديونية العميل في كشف الحساب إذا كانت الفاتورة آجلة أو جزئية.</li>
              <li>لا يتم حذف السجل بل توثيقه كـ "ملغاة" بقيد عكسي في سجل التدقيق.</li>
            </ul>
          </div>

          {cancelError && (
            <div className="flex items-center gap-2 text-xs font-bold ui-stock-out">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{cancelError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
              سبب الإلغاء (إلزامي للتوثيق المحاسبي) *
            </label>
            <input
              type="text"
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              placeholder="مثال: خطأ في إدخال الأصناف، طلب العميل إلغاء الطلب قبل الاستلام..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
            />
          </div>
        </ModalShell>
      )}

      {/* نافذة تعديل رقم طلب المنصة بعد الحفظ */}
      {platformOrderEditInvoice && (
        <ModalShell
          title="تعديل رقم طلب المنصة"
          subtitle={`فاتورة رقم: ${platformOrderEditInvoice.invoiceNumber} · ${platformOrderEditInvoice.platform}`}
          onClose={() => setPlatformOrderEditInvoice(null)}
          closeDisabled={isSavingPlatformOrder}
          footer={
            <>
              <button
                type="button"
                onClick={() => setPlatformOrderEditInvoice(null)}
                disabled={isSavingPlatformOrder}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmPlatformOrderEdit}
                disabled={isSavingPlatformOrder || !platformOrderEditReason.trim()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125592] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <FileEdit className="w-3.5 h-3.5" />
                <span>{isSavingPlatformOrder ? 'جاري الحفظ...' : 'حفظ التعديل'}</span>
              </button>
            </>
          }
        >
          {platformOrderEditError && (
            <div className="flex items-center gap-2 text-xs font-bold ui-stock-out">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{platformOrderEditError}</span>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
                رقم طلب المنصة (اتركه فارغًا للمسح)
              </label>
              <input
                type="text"
                maxLength={64}
                value={platformOrderEditValue}
                onChange={(e) => {
                  setPlatformOrderEditValue(e.target.value);
                  setPlatformOrderEditError(null);
                }}
                placeholder="نفس الرقم المكتوب على المنصة"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs font-mono`}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
                سبب التعديل *
              </label>
              <input
                type="text"
                value={platformOrderEditReason}
                onChange={(e) => {
                  setPlatformOrderEditReason(e.target.value);
                  setPlatformOrderEditError(null);
                }}
                placeholder="اكتب سبب تعديل رقم طلب المنصة..."
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
              />
            </div>
          </div>
        </ModalShell>
      )}
    </PageSurface>
  );
};


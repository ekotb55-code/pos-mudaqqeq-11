import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  Search,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  X,
  Loader2,
  UserCheck,
  ArrowLeftRight,
  History,
  Truck,
  Bike,
  Clock
} from 'lucide-react';
import { api } from '../api/client';
import {
  UserAccount,
  Cashbox,
  DashboardCashbox,
  DeliveryAssigneeType,
  DeliveryOrderStatus,
  DeliveryOrder,
  DeliveryConfigResponse,
  DeliveryOrdersListParams,
  DeliveryChangeOrderStatusPayload
} from '../types';
import { hasPermission } from '../utils/permissions';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ModalShell,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS
} from '../components/ui';

interface DeliveryOrdersPageProps {
  user: UserAccount;
  onReturnCreated?: () => void;
  initialSearch?: string;
  onClearInitialSearch?: () => void;
}

const ALL_STATUSES: readonly DeliveryOrderStatus[] = [
  'جديد',
  'خرج للتوصيل',
  'ما اتسلمش',
  'اتسلم',
  'رجع المحل',
  'اتلغى'
];

const FINAL_STATUSES: readonly DeliveryOrderStatus[] = ['اتسلم', 'رجع المحل', 'اتلغى'];

/**
 * انتقالات الحالة المسموح بها مطابقة حرفيًا لجدول ALLOWED في server/delivery.ts
 */
const ALLOWED_TRANSITIONS: Record<DeliveryOrderStatus, DeliveryOrderStatus[]> = {
  'جديد': ['خرج للتوصيل', 'اتلغى'],
  'خرج للتوصيل': ['اتسلم', 'ما اتسلمش'],
  'ما اتسلمش': ['خرج للتوصيل', 'رجع المحل', 'اتلغى'],
  'اتسلم': [],
  'رجع المحل': [],
  'اتلغى': []
};

function canAssignOrder(order: DeliveryOrder): boolean {
  return order.status === 'جديد' || order.status === 'ما اتسلمش';
}

function isFinalStatus(status: DeliveryOrderStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

function isReturnTransition(status: DeliveryOrderStatus | ''): boolean {
  return status === 'رجع المحل' || status === 'اتلغى';
}

function formatMoney(value: number): string {
  const num = Number(value) || 0;
  return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      timeZone: 'Africa/Cairo',
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(dt);
  } catch {
    return dt.toLocaleString('ar-EG');
  }
}

function isOrderLate(order: DeliveryOrder, lateAfterHours: number): boolean {
  if (isFinalStatus(order.status)) return false;
  const hours = Number(lateAfterHours) || 0;
  if (hours <= 0 || !order.createdAt) return false;
  const createdMs = new Date(order.createdAt).getTime();
  if (Number.isNaN(createdMs)) return false;
  return Date.now() - createdMs > hours * 3600_000;
}

function statusTextClass(status: DeliveryOrderStatus): string {
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

interface CashboxOption {
  id: string;
  name: string;
  currentBalance: number;
}

export const DeliveryOrdersPage: React.FC<DeliveryOrdersPageProps> = ({
  user,
  onReturnCreated,
  initialSearch,
  onClearInitialSearch
}) => {
  const canView =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'delivery.view');
  const canManage =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'delivery.manage');

  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [lateAfterHours, setLateAfterHours] = useState<number>(3);
  const [deliveryConfig, setDeliveryConfig] = useState<DeliveryConfigResponse | null>(null);
  const [cashboxes, setCashboxes] = useState<CashboxOption[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
    warning?: string;
  } | null>(null);

  // فلاتر البحث والحالة والمسؤول
  const [searchTerm, setSearchTerm] = useState<string>(initialSearch || '');
  const [statusFilter, setStatusFilter] = useState<string>('ALL'); // 'ALL' | 'OPEN' | DeliveryOrderStatus
  const [assigneeFilter, setAssigneeFilter] = useState<string>('ALL'); // 'ALL' | 'UNASSIGNED' | 'driver:<id>' | 'courier:<id>'

  useEffect(() => {
    if (initialSearch && initialSearch.trim()) {
      setSearchTerm(initialSearch.trim());
      setStatusFilter('ALL');
      setAssigneeFilter('ALL');
      onClearInitialSearch?.();
    }
  }, [initialSearch, onClearInitialSearch]);

  // نافذة السجل والتفاصيل (متاحة لقراءة delivery.view)
  const [detailOrder, setDetailOrder] = useState<DeliveryOrder | null>(null);

  // نافذة التوزيع (متاحة لـ delivery.manage فقط)
  const [assignModalOrder, setAssignModalOrder] = useState<DeliveryOrder | null>(null);
  const [assignType, setAssignType] = useState<DeliveryAssigneeType>('driver');
  const [assignAssigneeId, setAssignAssigneeId] = useState<string>('');
  const [assignTrackingNumber, setAssignTrackingNumber] = useState<string>('');
  const [assignError, setAssignError] = useState<string | null>(null);
  const [isSubmittingAssign, setIsSubmittingAssign] = useState<boolean>(false);

  // نافذة تغيير الحالة (متاحة لـ delivery.manage فقط)
  const [statusModalOrder, setStatusModalOrder] = useState<DeliveryOrder | null>(null);
  const [targetStatus, setTargetStatus] = useState<DeliveryOrderStatus | ''>('');
  const [statusReason, setStatusReason] = useState<string>('');
  const [statusNote, setStatusNote] = useState<string>('');
  const [refundMode, setRefundMode] = useState<'cash' | 'credit'>('cash');
  const [refundCashboxId, setRefundCashboxId] = useState<string>('');
  const [refundDeliveryFee, setRefundDeliveryFee] = useState<boolean>(false);
  const [confirmReturnChecked, setConfirmReturnChecked] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isSubmittingStatus, setIsSubmittingStatus] = useState<boolean>(false);

  const buildOrderQueryParams = useCallback((): DeliveryOrdersListParams => {
    const params: DeliveryOrdersListParams = {};
    if (statusFilter === 'OPEN') {
      params.open = true;
    } else if (statusFilter !== 'ALL') {
      params.status = statusFilter as DeliveryOrderStatus;
    }
    if (assigneeFilter.startsWith('driver:')) {
      params.assigneeType = 'driver';
      params.assigneeId = assigneeFilter.slice('driver:'.length);
    } else if (assigneeFilter.startsWith('courier:')) {
      params.assigneeType = 'courier';
      params.assigneeId = assigneeFilter.slice('courier:'.length);
    }
    return params;
  }, [statusFilter, assigneeFilter]);

  const loadOrdersAndConfig = useCallback(async () => {
    if (!canView) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = buildOrderQueryParams();
      const [ordersRes, configRes] = await Promise.all([
        api.getDeliveryOrders(params),
        api.getDeliveryConfig().catch(() => null)
      ]);
      if (!ordersRes || !ordersRes.success) {
        throw new Error(ordersRes?.error || 'تعذر تحميل طلبات التوصيل');
      }
      setOrders(Array.isArray(ordersRes.orders) ? ordersRes.orders : []);
      setLateAfterHours(Number(ordersRes.lateAfterHours) || 3);
      if (configRes && configRes.success) {
        setDeliveryConfig(configRes);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'تعذر الاتصال بالسيرفر لتحميل طلبات التوصيل');
    } finally {
      setIsLoading(false);
    }
  }, [canView, buildOrderQueryParams]);

  // تحميل الخزائن عند امتلاك delivery.manage فقط لاستخدامها في استرداد الطلبات المدفوعة مقدمًا عند الإرجاع أو الإلغاء
  useEffect(() => {
    if (!canView || !canManage) return;
    let active = true;
    const loadCashboxes = async () => {
      try {
        const res = await api.getCashboxes();
        if (active && res.success && Array.isArray(res.cashboxes)) {
          const valid = (res.cashboxes as Cashbox[])
            .filter((c) => c.status !== 'inactive' && c.status !== 'موقوفة')
            .map((c) => ({
              id: c.id,
              name: c.name,
              currentBalance: Number(c.currentBalance) || 0
            }));
          setCashboxes(valid);
          return;
        }
      } catch {
        // fallback below if user lacks cashbox.view
      }
      try {
        const dashRes = await api.getDashboardCashboxes();
        if (active && dashRes.success && Array.isArray(dashRes.cashboxes)) {
          const valid = (dashRes.cashboxes as DashboardCashbox[])
            .filter((c) => c.status !== 'inactive' && c.status !== 'موقوفة')
            .map((c) => ({
              id: c.id,
              name: c.name,
              currentBalance: Number(c.currentBalance) || 0
            }));
          setCashboxes(valid);
        }
      } catch {
        if (active) setCashboxes([]);
      }
    };
    loadCashboxes();
    return () => {
      active = false;
    };
  }, [canView, canManage]);

  useEffect(() => {
    loadOrdersAndConfig();
  }, [loadOrdersAndConfig]);

  // قوائم المسؤولين المتاحة في الفلتر (النشطون من إعدادات التوصيل + أي مسؤول ظاهر في الطلبات المحمّلة)
  const filterAssigneeOptions = useMemo(() => {
    const driversMap = new Map<string, string>();
    const couriersMap = new Map<string, string>();

    for (const d of deliveryConfig?.drivers || []) {
      driversMap.set(d.id, d.name);
    }
    for (const c of deliveryConfig?.couriers || []) {
      couriersMap.set(c.id, c.name);
    }
    for (const o of orders) {
      if (o.assigneeType === 'driver' && o.assigneeId && !driversMap.has(o.assigneeId)) {
        driversMap.set(o.assigneeId, o.assigneeName || o.assigneeId);
      } else if (o.assigneeType === 'courier' && o.assigneeId && !couriersMap.has(o.assigneeId)) {
        couriersMap.set(o.assigneeId, o.assigneeName || o.assigneeId);
      }
    }

    return {
      drivers: Array.from(driversMap.entries()).map(([id, name]) => ({ id, name })),
      couriers: Array.from(couriersMap.entries()).map(([id, name]) => ({ id, name }))
    };
  }, [deliveryConfig, orders]);

  const filteredOrders = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orders.filter((order) => {
      if (assigneeFilter === 'UNASSIGNED' && order.assigneeId) {
        return false;
      }
      if (!q) return true;
      const haystacks = [
        order.number,
        order.invoiceNumber,
        order.customerName,
        order.phone,
        order.address,
        order.zoneName,
        order.assigneeName,
        order.trackingNumber,
        order.returnNumber
      ];
      return haystacks.some((val) => String(val || '').toLowerCase().includes(q));
    });
  }, [orders, searchTerm, assigneeFilter]);

  const hasActiveFilters =
    searchTerm.trim() !== '' || statusFilter !== 'ALL' || assigneeFilter !== 'ALL';

  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('ALL');
    setAssigneeFilter('ALL');
  };

  // خيارات التوزيع النشطة وفق وضع التوصيل الفعلي من /api/delivery/config
  const deliveryMode = deliveryConfig?.settings?.mode || 'drivers';
  const allowDrivers = deliveryMode === 'drivers' || deliveryMode === 'both';
  const allowCouriers = deliveryMode === 'couriers' || deliveryMode === 'both';
  const activeDrivers = useMemo(
    () => (allowDrivers ? deliveryConfig?.drivers || [] : []),
    [allowDrivers, deliveryConfig]
  );
  const activeCouriers = useMemo(
    () => (allowCouriers ? deliveryConfig?.couriers || [] : []),
    [allowCouriers, deliveryConfig]
  );

  // فتح نافذة التوزيع
  const openAssignModal = (order: DeliveryOrder) => {
    if (!canManage || !canAssignOrder(order)) return;
    setAssignError(null);

    let initialType: DeliveryAssigneeType = 'driver';
    if (allowDrivers && !allowCouriers) {
      initialType = 'driver';
    } else if (allowCouriers && !allowDrivers) {
      initialType = 'courier';
    } else if (order.assigneeType === 'courier' && allowCouriers) {
      initialType = 'courier';
    } else if (order.assigneeType === 'driver' && allowDrivers) {
      initialType = 'driver';
    } else if (activeDrivers.length === 0 && activeCouriers.length > 0 && allowCouriers) {
      initialType = 'courier';
    }

    const initialList = initialType === 'driver' ? activeDrivers : activeCouriers;
    const preselectedId =
      order.assigneeType === initialType && initialList.some((x) => x.id === order.assigneeId)
        ? order.assigneeId
        : initialList[0]?.id || '';

    setAssignType(initialType);
    setAssignAssigneeId(preselectedId);
    setAssignTrackingNumber(initialType === 'courier' ? order.trackingNumber || '' : '');
    setAssignModalOrder(order);
  };

  const handleAssignTypeChange = (nextType: DeliveryAssigneeType) => {
    if (nextType === 'driver' && !allowDrivers) return;
    if (nextType === 'courier' && !allowCouriers) return;
    setAssignType(nextType);
    setAssignError(null);
    const list = nextType === 'driver' ? activeDrivers : activeCouriers;
    if (assignModalOrder && assignModalOrder.assigneeType === nextType && list.some((x) => x.id === assignModalOrder.assigneeId)) {
      setAssignAssigneeId(assignModalOrder.assigneeId);
    } else {
      setAssignAssigneeId(list[0]?.id || '');
    }
    if (nextType === 'driver') {
      setAssignTrackingNumber('');
    } else if (assignModalOrder) {
      setAssignTrackingNumber(assignModalOrder.trackingNumber || '');
    }
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignModalOrder || !canManage || isSubmittingAssign) return;

    if (assignType === 'driver' && !allowDrivers) {
      setAssignError('وضع التوصيل الحالي لا يسمح بالتوزيع على الطيارين');
      return;
    }
    if (assignType === 'courier' && !allowCouriers) {
      setAssignError('وضع التوصيل الحالي لا يسمح بالتوزيع على شركات الشحن');
      return;
    }
    if (!assignAssigneeId) {
      setAssignError(assignType === 'driver' ? 'اختر طيارًا نشطًا أولًا' : 'اختر شركة شحن نشطة أولًا');
      return;
    }

    const tracking = assignType === 'courier' ? assignTrackingNumber.trim() : '';
    if (tracking.length > 60) {
      setAssignError('رقم التتبع يجب ألا يتجاوز 60 حرفًا');
      return;
    }

    setIsSubmittingAssign(true);
    setAssignError(null);
    try {
      const res = await api.assignDeliveryOrder(assignModalOrder.id, {
        assigneeType: assignType,
        assigneeId: assignAssigneeId,
        ...(assignType === 'courier' ? { trackingNumber: tracking } : {})
      });
      if (!res.success || !res.order) {
        throw new Error(res.error || 'تعذر توزيع الطلب');
      }
      setOrders((prev) => prev.map((o) => (o.id === res.order.id ? res.order : o)));
      if (detailOrder?.id === res.order.id) {
        setDetailOrder(res.order);
      }
      setAssignModalOrder(null);
      setFeedback({
        type: res.warning ? 'warning' : 'success',
        message: `تم توزيع الطلب ${res.order.number} على ${res.order.assigneeType === 'driver' ? 'الطيار' : 'شركة الشحن'} «${res.order.assigneeName}».`,
        warning: res.warning || undefined
      });
      // إعادة تحميل للتأكد من تطابق الفلاتر النشطة (مثل فلتر غير موزّع أو فلتر مسؤول معين)
      loadOrdersAndConfig();
    } catch (err: any) {
      setAssignError(err?.message || 'تعذر توزيع الطلب');
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  // فتح نافذة تغيير الحالة
  const openStatusModal = (order: DeliveryOrder) => {
    if (!canManage) return;
    const allowed = ALLOWED_TRANSITIONS[order.status] || [];
    if (allowed.length === 0) return;

    setStatusError(null);
    setStatusReason('');
    setStatusNote('');
    setConfirmReturnChecked(false);
    setRefundDeliveryFee(false);

    // اختيار أول حالة متاحة فعليًا (تجنب «خرج للتوصيل» تلقائيًا إن كان الطلب غير موزّع)
    const firstValid =
      allowed.find((s) => !(s === 'خرج للتوصيل' && !order.assigneeId)) || allowed[0];
    setTargetStatus(firstValid);

    // تهيئة خيارات الاسترداد للطلبات المدفوعة مقدمًا
    const defaultCbId =
      user?.cashboxConfig?.defaultReturnCashboxId &&
      cashboxes.some((c) => c.id === user.cashboxConfig?.defaultReturnCashboxId)
        ? user.cashboxConfig.defaultReturnCashboxId
        : cashboxes[0]?.id || '';
    if (defaultCbId) {
      setRefundMode('cash');
      setRefundCashboxId(defaultCbId);
    } else if (order.customerId) {
      setRefundMode('credit');
      setRefundCashboxId('');
    } else {
      setRefundMode('cash');
      setRefundCashboxId('');
    }

    setStatusModalOrder(order);
  };

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalOrder || !canManage || isSubmittingStatus) return;

    const allowed = ALLOWED_TRANSITIONS[statusModalOrder.status] || [];
    if (!targetStatus || !allowed.includes(targetStatus)) {
      setStatusError('الحالة المختارة غير مسموح بها لهذا الطلب');
      return;
    }

    if (targetStatus === 'خرج للتوصيل' && !statusModalOrder.assigneeId) {
      setStatusError('وزّع الطلب على طيار أو شركة شحن أولًا قبل تحويله إلى «خرج للتوصيل»');
      return;
    }

    if (targetStatus === 'ما اتسلمش' && !statusReason.trim()) {
      setStatusError('اكتب سبب عدم تسليم الطلب');
      return;
    }

    const triggersReturn = isReturnTransition(targetStatus);
    if (triggersReturn && !confirmReturnChecked) {
      setStatusError('يرجى تأكيد الإقرار بإنشاء المرتجع الرسمي قبل المتابعة');
      return;
    }

    const payload: DeliveryChangeOrderStatusPayload = {
      status: targetStatus
    };

    if (statusReason.trim()) {
      payload.reason = statusReason.trim();
    }
    if (statusNote.trim()) {
      payload.note = statusNote.trim();
    }

    if (triggersReturn && statusModalOrder.paymentMode === 'prepaid') {
      if (refundMode === 'credit' && statusModalOrder.customerId) {
        payload.refund = 'credit';
      } else {
        if (!refundCashboxId) {
          setStatusError('الطلب مدفوع مقدمًا: اختر الخزنة التي سيتم الاسترداد منها');
          return;
        }
        payload.refund = 'cash';
        payload.refundCashboxId = refundCashboxId;
        payload.refundDeliveryFee = refundDeliveryFee;
      }
    }

    setIsSubmittingStatus(true);
    setStatusError(null);
    try {
      const res = await api.changeDeliveryOrderStatus(statusModalOrder.id, payload);
      if (!res.success || !res.order) {
        throw new Error(res.error || 'تعذر تغيير حالة الطلب');
      }
      setOrders((prev) => prev.map((o) => (o.id === res.order.id ? res.order : o)));
      if (detailOrder?.id === res.order.id) {
        setDetailOrder(res.order);
      }
      setStatusModalOrder(null);
      const returnSuffix = res.returnNumber
        ? ` وتم إنشاء المرتجع الرسمي رقم ${res.returnNumber}`
        : '';
      setFeedback({
        type: res.warning ? 'warning' : 'success',
        message: `تم تغيير حالة الطلب ${res.order.number} إلى «${res.order.status}»${returnSuffix}.`,
        warning: res.warning || undefined
      });
      if (res.returnNumber && onReturnCreated) {
        onReturnCreated();
      }
      loadOrdersAndConfig();
    } catch (err: any) {
      setStatusError(err?.message || 'تعذر تغيير حالة الطلب');
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  if (!canView) {
    return (
      <PageSurface title="إدارة طلبات التوصيل">
        <div
          role="alert"
          className="py-6 text-sm font-semibold text-rose-700 dark:text-rose-300"
        >
          غير مصرح لك بعرض طلبات التوصيل.
        </div>
      </PageSurface>
    );
  }

  return (
    <PageSurface
      title="إدارة طلبات التوصيل"
      subtitle="متابعة الطلبات، التوزيع على الطيارين وشركات الشحن، وتحديث الحالات وسجل التغييرات"
      actions={
        <button
          type="button"
          onClick={() => {
            setFeedback(null);
            loadOrdersAndConfig();
          }}
          disabled={isLoading}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] text-sm font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>تحديث</span>
        </button>
      }
    >
      {/* تنبيه حالة تفعيل التوصيل إن كان مقفولًا في الإعدادات */}
      {deliveryConfig && !deliveryConfig.settings.enabled && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 border-r-4 border-amber-600 pr-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-200"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            نظام التوصيل معطّل حاليًا في إعدادات التوصيل. يمكنك متابعة الطلبات القائمة أدناه.
          </span>
        </div>
      )}

      {/* رسائل النجاح / التنبيه / الخطأ */}
      {feedback && (
        <div
          role="status"
          className={`mb-4 flex items-start justify-between gap-3 border-r-4 pr-3 py-2 text-sm ${
            feedback.type === 'error'
              ? 'border-rose-600 text-rose-700 dark:text-rose-300'
              : feedback.type === 'warning'
              ? 'border-amber-600 text-amber-800 dark:text-amber-200'
              : 'border-emerald-600 text-emerald-800 dark:text-emerald-300'
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold">
              {feedback.type === 'error' || feedback.type === 'warning' ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
            {feedback.warning && (
              <div className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                {feedback.warning}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="إغلاق الإشعار"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* شريط البحث والفلاتر في صف واحد مضغوط أعلى الصفحة (بدون بطاقة تغليف) */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-[var(--text-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث برقم الطلب، الفاتورة، العميل، الهاتف..."
            aria-label="بحث في طلبات التوصيل"
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} pr-9 min-h-[44px]`}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="تصفية حسب الحالة"
          className={`${FORM_CONTROL_BASE_CLASS} min-h-[44px] w-auto min-w-[165px]`}
        >
          <option value="ALL">كل الحالات</option>
          <option value="OPEN">الطلبات المفتوحة فقط</option>
          {ALL_STATUSES.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>

        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          aria-label="تصفية حسب المسؤول عن التوصيل"
          className={`${FORM_CONTROL_BASE_CLASS} min-h-[44px] w-auto min-w-[190px]`}
        >
          <option value="ALL">كل المسؤولين</option>
          <option value="UNASSIGNED">غير موزّع</option>
          {filterAssigneeOptions.drivers.length > 0 && (
            <optgroup label="الطيارون">
              {filterAssigneeOptions.drivers.map((d) => (
                <option key={`driver:${d.id}`} value={`driver:${d.id}`}>
                  طيار: {d.name}
                </option>
              ))}
            </optgroup>
          )}
          {filterAssigneeOptions.couriers.length > 0 && (
            <optgroup label="شركات الشحن">
              {filterAssigneeOptions.couriers.map((c) => (
                <option key={`courier:${c.id}`} value={`courier:${c.id}`}>
                  شركة: {c.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            <span>مسح الفلاتر</span>
          </button>
        )}
      </div>

      <SectionHeading
        title="قائمة طلبات التوصيل"
        withTopDivider
        actions={
          <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
            {isLoading ? 'جاري التحميل...' : `العدد المعروض: ${filteredOrders.length}`}
          </span>
        }
      />

      {/* حالات التحميل / الخطأ / الفراغ / الجدول */}
      {isLoading ? (
        <div className="py-10 flex items-center gap-3 text-sm font-semibold text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>جاري تحميل طلبات التوصيل...</span>
        </div>
      ) : loadError ? (
        <div role="alert" className="py-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={loadOrdersAndConfig}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="py-8 text-sm text-[var(--text-secondary)]">
          {hasActiveFilters
            ? 'لا توجد طلبات توصيل مطابقة لمعايير البحث أو التصفية الحالية.'
            : 'لا توجد طلبات توصيل مسجلة حتى الآن.'}
        </div>
      ) : (
        <CompactTable>
          <thead>
            <tr>
              <th>رقم الطلب / الفاتورة</th>
              <th>العميل والتواصل</th>
              <th>المنطقة</th>
              <th>الرسوم</th>
              <th>الإجمالي</th>
              <th>طريقة الدفع</th>
              <th>المسؤول عن التوصيل</th>
              <th>الحالة</th>
              <th>تاريخ الإنشاء</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order) => {
              const late = isOrderLate(order, lateAfterHours);
              const allowedNext = ALLOWED_TRANSITIONS[order.status] || [];
              const showAssignBtn = canManage && canAssignOrder(order);
              const showStatusBtn = canManage && allowedNext.length > 0;

              return (
                <tr key={order.id}>
                  {/* رقم الطلب والفاتورة */}
                  <td className={COMPACT_TABLE_NUM_CLASS}>
                    <div className="font-bold text-[var(--text-primary)]" dir="ltr">
                      {order.number}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]" dir="ltr">
                      {order.invoiceNumber}
                    </div>
                    {order.returnNumber && (
                      <div className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                        مرتجع: {order.returnNumber}
                      </div>
                    )}
                  </td>

                  {/* العميل ووسيلة التواصل والعنوان */}
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    <div className="font-semibold text-[var(--text-primary)]">
                      {order.customerName || 'عميل نقدي'}
                    </div>
                    {order.phone && (
                      <div className="text-xs text-[var(--text-secondary)] tabular-nums" dir="ltr">
                        {order.phone}
                      </div>
                    )}
                    {order.address && (
                      <div className="text-xs text-[var(--text-muted)] mt-0.5">
                        {order.address}
                      </div>
                    )}
                  </td>

                  {/* المنطقة */}
                  <td className="whitespace-nowrap text-[var(--text-primary)]">
                    {order.zoneName || '—'}
                  </td>

                  {/* رسوم التوصيل */}
                  <td className={COMPACT_TABLE_NUM_CLASS}>
                    <div className="font-semibold text-[var(--text-primary)]">
                      {formatMoney(order.fee)}
                    </div>
                    {order.feeManual && (
                      <div className="text-[11px] text-[var(--text-muted)]">معدّلة يدويًا</div>
                    )}
                  </td>

                  {/* الإجمالي والمستحق للتحصيل */}
                  <td className={COMPACT_TABLE_NUM_CLASS}>
                    <div className="font-bold text-[var(--text-primary)]">
                      {formatMoney(order.invoiceTotal)}
                    </div>
                    {order.paymentMode === 'cod' && (
                      <div className="text-xs text-amber-700 dark:text-amber-300">
                        تحصيل: {formatMoney(order.amountDue)}
                      </div>
                    )}
                  </td>

                  {/* طريقة الدفع */}
                  <td className="whitespace-nowrap text-[var(--text-primary)] font-medium">
                    {order.paymentMode === 'cod' ? 'الدفع عند الاستلام' : 'مدفوع مقدمًا'}
                  </td>

                  {/* المسؤول عن التوصيل */}
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    {order.assigneeName ? (
                      <div>
                        <div className="font-semibold text-[var(--text-primary)]">
                          {order.assigneeName}
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {order.assigneeType === 'driver' ? 'طيار' : 'شركة شحن'}
                        </div>
                        {order.trackingNumber && (
                          <div className="text-xs text-[var(--text-secondary)] tabular-nums">
                            تتبع: {order.trackingNumber}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-[var(--text-muted)]">غير موزّع</span>
                    )}
                  </td>

                  {/* الحالة */}
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    <div className={`font-bold whitespace-nowrap ${statusTextClass(order.status)}`}>
                      {order.status}
                    </div>
                    {late && (
                      <div className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-300 whitespace-nowrap mt-0.5">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>متأخر (+{lateAfterHours} س)</span>
                      </div>
                    )}
                    {order.status === 'ما اتسلمش' && order.failReason && (
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                        السبب: {order.failReason}
                      </div>
                    )}
                  </td>

                  {/* تاريخ الإنشاء */}
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`}>
                    {formatDateTime(order.createdAt)}
                  </td>

                  {/* الإجراءات */}
                  <td className="whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDetailOrder(order)}
                        className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] text-xs font-semibold transition-colors"
                      >
                        <History className="w-3.5 h-3.5" />
                        <span>السجل</span>
                      </button>

                      {showAssignBtn && (
                        <button
                          type="button"
                          onClick={() => openAssignModal(order)}
                          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold transition-colors"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>{order.assigneeId ? 'إعادة توزيع' : 'توزيع'}</span>
                        </button>
                      )}

                      {showStatusBtn && (
                        <button
                          type="button"
                          onClick={() => openStatusModal(order)}
                          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5" />
                          <span>تغيير الحالة</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </CompactTable>
      )}

      {/* نافذة تفاصيل الطلب وسجل تغييرات الحالة (قراءة لـ delivery.view) */}
      {detailOrder && (
        <ModalShell
          onClose={() => setDetailOrder(null)}
          title={`تفاصيل الطلب ${detailOrder.number}`}
          subtitle={`فاتورة ${detailOrder.invoiceNumber}`}
          className="w-full max-w-2xl"
          footer={
            <button
              type="button"
              onClick={() => setDetailOrder(null)}
              className="min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              إغلاق
            </button>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
              <div>
                <span className="text-[var(--text-muted)]">العميل: </span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {detailOrder.customerName || 'عميل نقدي'}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">الهاتف: </span>
                <span className="font-semibold text-[var(--text-primary)] tabular-nums" dir="ltr">
                  {detailOrder.phone || '—'}
                </span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-[var(--text-muted)]">العنوان: </span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {detailOrder.address || '—'}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">المنطقة: </span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {detailOrder.zoneName || '—'}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">طريقة الدفع: </span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {detailOrder.paymentMode === 'cod' ? 'الدفع عند الاستلام' : 'مدفوع مقدمًا'}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">رسوم التوصيل: </span>
                <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                  {formatMoney(detailOrder.fee)}
                  {detailOrder.feeManual ? ' (معدّلة يدويًا)' : ''}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">إجمالي الفاتورة: </span>
                <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                  {formatMoney(detailOrder.invoiceTotal)}
                </span>
              </div>
              {detailOrder.paymentMode === 'cod' && (
                <div>
                  <span className="text-[var(--text-muted)]">المطلوب تحصيله عند الاستلام: </span>
                  <span className="font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                    {formatMoney(detailOrder.amountDue)}
                  </span>
                </div>
              )}
              <div>
                <span className="text-[var(--text-muted)]">المسؤول عن التوصيل: </span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {detailOrder.assigneeName
                    ? `${detailOrder.assigneeType === 'driver' ? 'طيار' : 'شركة شحن'}: ${detailOrder.assigneeName}`
                    : 'غير موزّع'}
                </span>
              </div>
              {detailOrder.trackingNumber && (
                <div>
                  <span className="text-[var(--text-muted)]">رقم التتبع / البوليصة: </span>
                  <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                    {detailOrder.trackingNumber}
                  </span>
                </div>
              )}
              <div>
                <span className="text-[var(--text-muted)]">الحالة الحالية: </span>
                <span className={`font-bold ${statusTextClass(detailOrder.status)}`}>
                  {detailOrder.status}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">تاريخ الإنشاء: </span>
                <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                  {formatDateTime(detailOrder.createdAt)}
                </span>
              </div>
              {detailOrder.outAt && (
                <div>
                  <span className="text-[var(--text-muted)]">وقت الخروج للتوصيل: </span>
                  <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                    {formatDateTime(detailOrder.outAt)}
                  </span>
                </div>
              )}
              {detailOrder.deliveredAt && (
                <div>
                  <span className="text-[var(--text-muted)]">وقت التسليم: </span>
                  <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                    {formatDateTime(detailOrder.deliveredAt)}
                  </span>
                </div>
              )}
              {detailOrder.closedAt && !detailOrder.deliveredAt && (
                <div>
                  <span className="text-[var(--text-muted)]">وقت الإغلاق: </span>
                  <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                    {formatDateTime(detailOrder.closedAt)}
                  </span>
                </div>
              )}
              {detailOrder.failReason && (
                <div className="sm:col-span-2">
                  <span className="text-[var(--text-muted)]">سبب عدم التسليم: </span>
                  <span className="font-semibold text-orange-700 dark:text-orange-300">
                    {detailOrder.failReason}
                  </span>
                </div>
              )}
              {detailOrder.returnNumber && (
                <div className="sm:col-span-2">
                  <span className="text-[var(--text-muted)]">رقم المرتجع الرسمي: </span>
                  <span className="font-bold text-rose-700 dark:text-rose-300 tabular-nums">
                    {detailOrder.returnNumber}
                  </span>
                </div>
              )}
            </div>

            <SectionHeading title="سجل تغييرات الحالة" />

            {Array.isArray(detailOrder.log) && detailOrder.log.length > 0 ? (
              <CompactTable>
                <thead>
                  <tr>
                    <th>الحالة</th>
                    <th>بواسطة</th>
                    <th>الوقت</th>
                    <th>الملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {detailOrder.log.map((entry, idx) => (
                    <tr key={`${entry.at}-${idx}`}>
                      <td className={`whitespace-nowrap font-bold ${statusTextClass(entry.status)}`}>
                        {entry.status}
                      </td>
                      <td className="whitespace-nowrap text-[var(--text-primary)]">
                        {entry.byName || '—'}
                      </td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`}>
                        {formatDateTime(entry.at)}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>
                        {entry.note || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </CompactTable>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">
                لا توجد إدخالات مسجلة في سجل تغييرات الحالة لهذا الطلب.
              </p>
            )}
          </div>
        </ModalShell>
      )}

      {/* نافذة توزيع الطلب (delivery.manage فقط) */}
      {assignModalOrder && (
        <ModalShell
          onClose={() => {
            if (!isSubmittingAssign) setAssignModalOrder(null);
          }}
          closeDisabled={isSubmittingAssign}
          title={`${assignModalOrder.assigneeId ? 'إعادة توزيع' : 'توزيع'} الطلب ${assignModalOrder.number}`}
          subtitle={`فاتورة ${assignModalOrder.invoiceNumber} — ${assignModalOrder.customerName || 'عميل نقدي'}`}
          className="w-full max-w-lg"
          footer={
            <>
              <button
                type="button"
                disabled={isSubmittingAssign}
                onClick={() => setAssignModalOrder(null)}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="submit"
                form="delivery-assign-form"
                disabled={
                  isSubmittingAssign ||
                  !assignAssigneeId ||
                  (assignType === 'driver' && !allowDrivers) ||
                  (assignType === 'courier' && !allowCouriers)
                }
                className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {isSubmittingAssign && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>تأكيد التوزيع</span>
              </button>
            </>
          }
        >
          <form id="delivery-assign-form" onSubmit={handleAssignSubmit} className="space-y-4">
            {assignError && (
              <div
                role="alert"
                className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{assignError}</span>
              </div>
            )}

            {/* نوع المسؤول — يظهر فقط الخيارات الموافقة لوضع التوصيل في الإعدادات */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-[var(--text-primary)]">
                نوع المسؤول عن التوصيل
              </label>
              <div className="flex flex-wrap gap-2">
                {allowDrivers && (
                  <button
                    type="button"
                    onClick={() => handleAssignTypeChange('driver')}
                    disabled={isSubmittingAssign}
                    className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                      assignType === 'driver'
                        ? 'border-sky-700 bg-sky-700 text-white'
                        : 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    <Bike className="w-4 h-4" />
                    <span>طيار</span>
                  </button>
                )}
                {allowCouriers && (
                  <button
                    type="button"
                    onClick={() => handleAssignTypeChange('courier')}
                    disabled={isSubmittingAssign}
                    className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                      assignType === 'courier'
                        ? 'border-sky-700 bg-sky-700 text-white'
                        : 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    <Truck className="w-4 h-4" />
                    <span>شركة شحن</span>
                  </button>
                )}
              </div>
            </div>

            {/* اختيار الطيار النشط أو شركة الشحن النشطة */}
            {assignType === 'driver' ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="assign-driver-select"
                  className="block text-sm font-semibold text-[var(--text-primary)]"
                >
                  الطيار (النشطون فقط)
                </label>
                {activeDrivers.length === 0 ? (
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                    لا يوجد طيارون نشطون حاليًا في إعدادات التوصيل.
                  </p>
                ) : (
                  <select
                    id="assign-driver-select"
                    value={assignAssigneeId}
                    onChange={(e) => setAssignAssigneeId(e.target.value)}
                    disabled={isSubmittingAssign}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} min-h-[44px]`}
                  >
                    {activeDrivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.phone ? ` — ${d.phone}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label
                    htmlFor="assign-courier-select"
                    className="block text-sm font-semibold text-[var(--text-primary)]"
                  >
                    شركة الشحن (النشطة فقط)
                  </label>
                  {activeCouriers.length === 0 ? (
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                      لا توجد شركات شحن نشطة حاليًا في إعدادات التوصيل.
                    </p>
                  ) : (
                    <select
                      id="assign-courier-select"
                      value={assignAssigneeId}
                      onChange={(e) => setAssignAssigneeId(e.target.value)}
                      disabled={isSubmittingAssign}
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} min-h-[44px]`}
                    >
                      {activeCouriers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="assign-tracking-number"
                    className="block text-sm font-semibold text-[var(--text-primary)]"
                  >
                    رقم التتبع / البوليصة (اختياري)
                  </label>
                  <input
                    id="assign-tracking-number"
                    type="text"
                    maxLength={60}
                    value={assignTrackingNumber}
                    onChange={(e) => setAssignTrackingNumber(e.target.value)}
                    disabled={isSubmittingAssign}
                    placeholder="مثال: AWB-102938"
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px]`}
                  />
                </div>
              </>
            )}
          </form>
        </ModalShell>
      )}

      {/* نافذة تغيير حالة الطلب (delivery.manage فقط) */}
      {statusModalOrder && (
        <ModalShell
          onClose={() => {
            if (!isSubmittingStatus) setStatusModalOrder(null);
          }}
          closeDisabled={isSubmittingStatus}
          title={`تغيير حالة الطلب ${statusModalOrder.number}`}
          subtitle={`الحالة الحالية: ${statusModalOrder.status} — فاتورة ${statusModalOrder.invoiceNumber}`}
          className="w-full max-w-lg"
          footer={
            <>
              <button
                type="button"
                disabled={isSubmittingStatus}
                onClick={() => setStatusModalOrder(null)}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="submit"
                form="delivery-status-form"
                disabled={
                  isSubmittingStatus ||
                  !targetStatus ||
                  (targetStatus === 'خرج للتوصيل' && !statusModalOrder.assigneeId) ||
                  (isReturnTransition(targetStatus) && !confirmReturnChecked)
                }
                className={`inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-lg text-white text-sm font-semibold transition-colors disabled:opacity-50 ${
                  isReturnTransition(targetStatus)
                    ? 'bg-rose-700 hover:bg-rose-800'
                    : 'bg-emerald-700 hover:bg-emerald-800'
                }`}
              >
                {isSubmittingStatus && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {isReturnTransition(targetStatus)
                    ? `تأكيد التحويل إلى «${targetStatus}»`
                    : 'حفظ الحالة الجديدة'}
                </span>
              </button>
            </>
          }
        >
          <form id="delivery-status-form" onSubmit={handleStatusSubmit} className="space-y-4">
            {statusError && (
              <div
                role="alert"
                className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{statusError}</span>
              </div>
            )}

            {/* اختيار الحالة الجديدة من الانتقالات المسموحة في السيرفر فقط */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-[var(--text-primary)]">
                الحالة الجديدة المسموح بها
              </label>
              <div className="flex flex-wrap gap-2">
                {(ALLOWED_TRANSITIONS[statusModalOrder.status] || []).map((st) => {
                  const blockedOut = st === 'خرج للتوصيل' && !statusModalOrder.assigneeId;
                  const selected = targetStatus === st;
                  const destructive = isReturnTransition(st);
                  return (
                    <button
                      key={st}
                      type="button"
                      disabled={isSubmittingStatus || blockedOut}
                      onClick={() => {
                        setTargetStatus(st);
                        setConfirmReturnChecked(false);
                        setStatusError(null);
                      }}
                      className={`min-h-[44px] px-4 py-2 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-45 ${
                        selected
                          ? destructive
                            ? 'border-rose-700 bg-rose-700 text-white'
                            : 'border-emerald-700 bg-emerald-700 text-white'
                          : 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      {st}
                    </button>
                  );
                })}
              </div>
              {(ALLOWED_TRANSITIONS[statusModalOrder.status] || []).includes('خرج للتوصيل') &&
                !statusModalOrder.assigneeId && (
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                    خيار «خرج للتوصيل» متاح بعد توزيع الطلب على طيار أو شركة شحن أولًا.
                  </p>
                )}
            </div>

            {/* سبب عدم التسليم (إلزامي لـ «ما اتسلمش»، واختياري لـ «رجع المحل» و«اتلغى») */}
            {(targetStatus === 'ما اتسلمش' || isReturnTransition(targetStatus)) && (
              <div className="space-y-1.5">
                <label
                  htmlFor="status-reason-input"
                  className="block text-sm font-semibold text-[var(--text-primary)]"
                >
                  {targetStatus === 'ما اتسلمش'
                    ? 'سبب عدم التسليم (مطلوب)'
                    : 'السبب (اختياري — يُسجل في ملاحظة المرتجع والسجل)'}
                </label>
                <input
                  id="status-reason-input"
                  type="text"
                  maxLength={200}
                  required={targetStatus === 'ما اتسلمش'}
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  disabled={isSubmittingStatus}
                  placeholder={
                    targetStatus === 'ما اتسلمش'
                      ? 'مثال: العميل لا يرد / العنوان غير مكتمل'
                      : 'مثال: إلغاء بناءً على طلب العميل'
                  }
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} min-h-[44px]`}
                />
              </div>
            )}

            {/* ملاحظة اختيارية للسجل */}
            <div className="space-y-1.5">
              <label
                htmlFor="status-note-input"
                className="block text-sm font-semibold text-[var(--text-primary)]"
              >
                ملاحظة إضافية للسجل (اختياري)
              </label>
              <input
                id="status-note-input"
                type="text"
                maxLength={300}
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                disabled={isSubmittingStatus}
                placeholder="ملاحظة تظهر في سجل تغييرات الحالة"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} min-h-[44px]`}
              />
            </div>

            {/* خيارات استرداد الطلب المدفوع مقدمًا عند «رجع المحل» أو «اتلغى» */}
            {isReturnTransition(targetStatus) && statusModalOrder.paymentMode === 'prepaid' && (
              <div className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  استرداد قيمة الطلب المدفوع مقدمًا
                </div>

                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-[var(--text-primary)] cursor-pointer">
                    <input
                      type="radio"
                      name="prepaid-refund-mode"
                      checked={refundMode === 'cash'}
                      onChange={() => setRefundMode('cash')}
                      disabled={isSubmittingStatus}
                      className="w-4 h-4 accent-sky-700"
                    />
                    <span>استرداد نقدي من خزنة</span>
                  </label>

                  {statusModalOrder.customerId && (
                    <label className="inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-[var(--text-primary)] cursor-pointer">
                      <input
                        type="radio"
                        name="prepaid-refund-mode"
                        checked={refundMode === 'credit'}
                        onChange={() => setRefundMode('credit')}
                        disabled={isSubmittingStatus}
                        className="w-4 h-4 accent-sky-700"
                      />
                      <span>قيد على حساب العميل</span>
                    </label>
                  )}
                </div>

                {refundMode === 'cash' && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="refund-cashbox-select"
                        className="block text-sm font-semibold text-[var(--text-primary)]"
                      >
                        الخزنة التي سيُصرف منها الاسترداد
                      </label>
                      {cashboxes.length === 0 ? (
                        <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                          تعذر تحميل قائمة الخزائن (تأكد من وجود خزنة نشطة وصلاحية عرض الخزائن).
                        </p>
                      ) : (
                        <select
                          id="refund-cashbox-select"
                          value={refundCashboxId}
                          onChange={(e) => setRefundCashboxId(e.target.value)}
                          disabled={isSubmittingStatus}
                          className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} min-h-[44px]`}
                        >
                          <option value="">اختر الخزنة...</option>
                          {cashboxes.map((cb) => (
                            <option key={cb.id} value={cb.id}>
                              {cb.name} (الرصيد: {formatMoney(cb.currentBalance)})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {statusModalOrder.fee > 0 && (
                      <label className="inline-flex items-center gap-2.5 min-h-[44px] text-sm text-[var(--text-primary)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={refundDeliveryFee}
                          onChange={(e) => setRefundDeliveryFee(e.target.checked)}
                          disabled={isSubmittingStatus}
                          className="w-4 h-4 accent-sky-700"
                        />
                        <span>
                          استرداد رسوم التوصيل ({formatMoney(statusModalOrder.fee)}) مع قيمة الأصناف
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* تأكيد صريح قبل «رجع المحل» أو «اتلغى» */}
            {isReturnTransition(targetStatus) && (
              <div
                role="alert"
                className="space-y-2.5 border-r-4 border-rose-600 pr-3 py-2 text-sm text-[var(--text-primary)]"
              >
                <div className="flex items-start gap-2 font-bold text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    تنبيه مهم: تحويل الطلب إلى «{targetStatus}» سيؤدي إلى قيام السيرفر بإنشاء مرتجع
                    مبيعات رسمي تلقائيًا وإرجاع الأصناف إلى المخزون عند انطباق القاعدة، وهي حالة
                    نهائية لا يمكن التراجع عنها.
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)]">
                  {statusModalOrder.paymentMode === 'cod'
                    ? 'لأن الطلب «الدفع عند الاستلام»، سيغلق المرتجع الرسمي الفاتورة دون التأثير على الخزنة أو حساب العميل.'
                    : 'لأن الطلب «مدفوع مقدمًا»، سيُنفّذ السيرفر الاسترداد وفق الخيار المحدد أعلاه (أو يقيده على الحساب إذا كانت الفاتورة الأصلية آجلة).'}
                </p>
                <label className="inline-flex items-center gap-2.5 min-h-[44px] text-sm font-semibold text-[var(--text-primary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmReturnChecked}
                    onChange={(e) => setConfirmReturnChecked(e.target.checked)}
                    disabled={isSubmittingStatus}
                    className="w-4 h-4 accent-rose-700"
                  />
                  <span>أؤكد تنفيذ هذا الإجراء وإنشاء المرتجع الرسمي عند انطباق القاعدة</span>
                </label>
              </div>
            )}
          </form>
        </ModalShell>
      )}
    </PageSurface>
  );
};

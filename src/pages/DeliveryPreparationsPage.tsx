import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  Printer,
  RefreshCw,
  Truck,
  X,
  XCircle
} from 'lucide-react';
import { api } from '../api/client';
import {
  Cashbox,
  DeliveryConfigResponse,
  DeliveryPreparationOrder,
  DeliveryPreparationStatus,
  UserAccount,
  Warehouse
} from '../types';
import { hasPermission } from '../utils/permissions';
import {
  PageSurface,
  CompactTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS
} from '../components/ui';
import { PrepCancelModal } from '../components/delivery/PrepCancelModal';
import { PrepDispatchModal } from '../components/delivery/PrepDispatchModal';
import { PrepEditModal } from '../components/delivery/PrepEditModal';
import { printDeliveryPrepSlip } from '../utils/printDeliveryPrepSlip';
import {
  buildPrepSlipData,
  formatPrepDateTime,
  formatPrepMoney,
  prepAssigneeLabel,
  prepCanDispatch,
  prepCanEdit,
  prepErrorText,
  prepPaymentLabel,
  prepStatusTextClass
} from '../utils/deliveryPrep';

interface DeliveryPreparationsPageProps {
  user: UserAccount;
  /** بعد الشحن بتطلع فاتورة والمخزون والخزنة بيتغيروا، فالصفحة بتبلّغ البرنامج يحدّث بياناته. */
  onDataChanged?: () => void;
}

type StatusFilter = 'open' | 'all' | DeliveryPreparationStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'المفتوحة (لسه ما اتشحنتش)' },
  { value: 'all', label: 'كل الأوامر' },
  { value: 'قيد التحضير', label: 'قيد التحضير' },
  { value: 'جاري الشحن', label: 'جاري الشحن' },
  { value: 'خرج للتوصيل', label: 'خرج للتوصيل' },
  { value: 'اتلغى', label: 'اتلغى' }
];

const ACTION_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50';

export const DeliveryPreparationsPage: React.FC<DeliveryPreparationsPageProps> = ({ user, onDataChanged }) => {
  const isPrivileged = user.role === 'designer' || Boolean(user.isOwner);
  const canManage = isPrivileged || hasPermission(user, 'delivery.manage');
  const canCreateInvoice = isPrivileged || hasPermission(user, 'invoices.create');
  const canView = canManage || isPrivileged || hasPermission(user, 'delivery.view');
  // نفس شروط السيرفر: التعديل والإلغاء بأي صلاحية من الاتنين، والشحن محتاج الاتنين مع بعض.
  const canEditOrCancel = canManage || canCreateInvoice;
  const canDispatch = canManage && canCreateInvoice;

  const [orders, setOrders] = useState<DeliveryPreparationOrder[]>([]);
  const [config, setConfig] = useState<DeliveryConfigResponse | null>(null);
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [search, setSearch] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [dispatchOrder, setDispatchOrder] = useState<DeliveryPreparationOrder | null>(null);
  const [editOrder, setEditOrder] = useState<DeliveryPreparationOrder | null>(null);
  const [cancelOrder, setCancelOrder] = useState<DeliveryPreparationOrder | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const prepSlipEnabled = Boolean(config?.settings?.prepSlip?.enabled);

  const loadOrders = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await api.getDeliveryPreparationOrders(
        statusFilter === 'open' ? { open: true } : statusFilter === 'all' ? {} : { status: statusFilter }
      );
      setOrders(res.orders || []);
    } catch (err) {
      setLoadError(prepErrorText(err, 'تعذر تحميل أوامر التجهيز'));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (!canView) return;
    void loadOrders();
  }, [canView, loadOrders]);

  useEffect(() => {
    if (!canView) return;
    api.getDeliveryConfig().then(setConfig).catch(() => setConfig(null));
    api.getCashboxes().then((r) => setCashboxes(r.cashboxes || [])).catch(() => setCashboxes([]));
    api.getWarehouses().then((r) => setWarehouses(r.warehouses || [])).catch(() => setWarehouses([]));
  }, [canView]);

  const visibleOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((o) =>
      [o.number, o.customerName, o.phone, o.invoiceNumber || '', o.address]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [orders, search]);

  const handlePrint = async (order: DeliveryPreparationOrder) => {
    if (printingId) return;
    if (!prepSlipEnabled) {
      setFeedback({ type: 'error', message: 'بون التجهيز موقوف من إعدادات التوصيل' });
      return;
    }
    setPrintingId(order.id);
    try {
      await printDeliveryPrepSlip(buildPrepSlipData(order), {
        settings: config?.settings?.prepSlip,
        onAfterPrint: () => setPrintingId(null)
      });
    } catch (err) {
      setFeedback({ type: 'error', message: prepErrorText(err, 'تعذر طباعة بون التجهيز') });
    } finally {
      setPrintingId(null);
    }
  };

  if (!canView) {
    return (
      <PageSurface title="أوامر التجهيز">
        <div role="alert" className="py-6 text-sm font-semibold text-rose-700 dark:text-rose-300">
          غير مصرح لك بعرض أوامر التجهيز.
        </div>
      </PageSurface>
    );
  }

  return (
    <PageSurface
      title="أوامر التجهيز"
      subtitle="طلبات التوصيل اللي لسه بتتجهز. الفاتورة بتطلع والمخزون بينقص عند الشحن."
      actions={
        <button
          type="button"
          onClick={() => {
            setFeedback(null);
            void loadOrders();
          }}
          disabled={isLoading}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] text-sm font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>تحديث</span>
        </button>
      }
    >
      {feedback && (
        <div
          role="status"
          className={`mb-4 flex items-start justify-between gap-3 border-r-4 pr-3 py-2 text-sm font-semibold ${
            feedback.type === 'error'
              ? 'border-rose-600 text-rose-700 dark:text-rose-300'
              : 'border-emerald-600 text-emerald-800 dark:text-emerald-300'
          }`}
        >
          <div className="flex items-start gap-2">
            {feedback.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span>{feedback.message}</span>
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

      <div className="flex flex-wrap items-center gap-2 pb-4">
        <select
          aria-label="فلتر حالة أمر التجهيز"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px]`}
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label="بحث في أوامر التجهيز"
          placeholder="بحث برقم الأمر أو اسم العميل أو التليفون"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} min-h-[44px]`}
        />
        <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
          {visibleOrders.length} أمر
        </span>
      </div>

      {isLoading ? (
        <div className="py-10 flex items-center gap-3 text-sm font-semibold text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>جاري تحميل أوامر التجهيز...</span>
        </div>
      ) : loadError ? (
        <div role="alert" className="py-6 space-y-3">
          <div className="flex items-start gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadOrders()}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      ) : visibleOrders.length === 0 ? (
        <p className="py-6 text-sm text-[var(--text-secondary)]">
          مفيش أوامر تجهيز هنا. أمر التجهيز بيتعمل من شاشة البيع لما تختار «توصيل» وتحفظ.
        </p>
      ) : (
        <CompactTable>
          <thead>
            <tr>
              <th>رقم الأمر</th>
              <th>العميل والتليفون</th>
              <th>الأصناف والكميات</th>
              <th>المنطقة والعنوان</th>
              <th>الدفع والإجمالي</th>
              <th>المسؤول</th>
              <th>الحالة</th>
              <th>التاريخ</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.map((order) => (
              <tr key={order.id} data-testid="prep-order-row">
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`} dir="ltr">
                  {order.number}
                </td>
                <td className={COMPACT_TABLE_TEXT_CLASS}>
                  <div className="font-semibold text-[var(--text-primary)]">{order.customerName || 'عميل نقدي'}</div>
                  {order.phone && (
                    <div className="text-xs text-[var(--text-secondary)] tabular-nums" dir="ltr">
                      {order.phone}
                    </div>
                  )}
                </td>
                <td className={COMPACT_TABLE_TEXT_CLASS}>
                  {order.lines.map((line) => (
                    <div key={line.itemId} className="text-[var(--text-primary)]">
                      <span className="font-bold tabular-nums">{line.quantity}</span> × {line.itemName}
                    </div>
                  ))}
                </td>
                <td className={COMPACT_TABLE_TEXT_CLASS}>
                  {order.zoneName && <div className="font-semibold text-[var(--text-primary)]">{order.zoneName}</div>}
                  <div className="text-xs text-[var(--text-secondary)]">{order.address || '—'}</div>
                </td>
                <td className="whitespace-nowrap">
                  <div className="text-[var(--text-primary)]">{prepPaymentLabel(order.paymentMode)}</div>
                  <div className="text-xs font-semibold text-[var(--text-secondary)] tabular-nums">
                    {formatPrepMoney(order.estimatedTotal)}
                  </div>
                </td>
                <td className="whitespace-nowrap text-[var(--text-primary)]">{prepAssigneeLabel(order)}</td>
                <td className={COMPACT_TABLE_TEXT_CLASS}>
                  <div className={`font-bold whitespace-nowrap ${prepStatusTextClass(order.status)}`}>{order.status}</div>
                  {order.invoiceNumber && (
                    <div className="text-xs text-[var(--text-secondary)] tabular-nums" dir="ltr">
                      {order.invoiceNumber}
                    </div>
                  )}
                  {order.status === 'اتلغى' && order.cancelReason && (
                    <div className="text-xs text-[var(--text-secondary)]">السبب: {order.cancelReason}</div>
                  )}
                </td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`}>
                  {formatPrepDateTime(order.createdAt)}
                </td>
                <td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {canDispatch && prepCanDispatch(order) && (
                      <button
                        type="button"
                        onClick={() => setDispatchOrder(order)}
                        className={`${ACTION_BUTTON_CLASS} bg-emerald-700 hover:bg-emerald-800 text-white`}
                      >
                        <Truck className="w-4 h-4" />
                        <span>{order.status === 'جاري الشحن' ? 'استكمال الشحن' : 'شحن'}</span>
                      </button>
                    )}
                    {canEditOrCancel && prepCanEdit(order) && (
                      <button
                        type="button"
                        onClick={() => setEditOrder(order)}
                        className={`${ACTION_BUTTON_CLASS} bg-sky-700 hover:bg-sky-800 text-white`}
                      >
                        <Pencil className="w-4 h-4" />
                        <span>تعديل</span>
                      </button>
                    )}
                    {prepSlipEnabled && order.status !== 'اتلغى' && (
                      <button
                        type="button"
                        disabled={printingId === order.id}
                        onClick={() => void handlePrint(order)}
                        className={`${ACTION_BUTTON_CLASS} border border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]`}
                      >
                        {printingId === order.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Printer className="w-4 h-4" />
                        )}
                        <span>طباعة البون</span>
                      </button>
                    )}
                    {canEditOrCancel && prepCanEdit(order) && (
                      <button
                        type="button"
                        onClick={() => setCancelOrder(order)}
                        className={`${ACTION_BUTTON_CLASS} border border-rose-600 text-rose-700 dark:text-rose-300 hover:bg-[var(--surface-hover)]`}
                      >
                        <XCircle className="w-4 h-4" />
                        <span>إلغاء</span>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </CompactTable>
      )}

      {dispatchOrder && (
        <PrepDispatchModal
          order={dispatchOrder}
          config={config}
          cashboxes={cashboxes}
          warehouses={warehouses}
          onClose={() => setDispatchOrder(null)}
          onDispatched={(result) => {
            setDispatchOrder(null);
            setFeedback({
              type: 'success',
              message: `اتشحن أمر التجهيز ${result.order.number} وطلعت الفاتورة ${result.invoice.invoiceNumber}`
            });
            void loadOrders();
            onDataChanged?.();
          }}
        />
      )}

      {editOrder && (
        <PrepEditModal
          order={editOrder}
          config={config}
          onClose={() => setEditOrder(null)}
          onSaved={(saved) => {
            setEditOrder(null);
            setFeedback({ type: 'success', message: `اتحفظ تعديل أمر التجهيز ${saved.number}` });
            void loadOrders();
          }}
        />
      )}

      {cancelOrder && (
        <PrepCancelModal
          order={cancelOrder}
          onClose={() => setCancelOrder(null)}
          onCancelled={(cancelled) => {
            setCancelOrder(null);
            setFeedback({ type: 'success', message: `اتلغى أمر التجهيز ${cancelled.number}` });
            void loadOrders();
          }}
        />
      )}
    </PageSurface>
  );
};

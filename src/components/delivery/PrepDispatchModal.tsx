import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Truck } from 'lucide-react';
import { api } from '../../api/client';
import {
  Cashbox,
  DeliveryAssigneeType,
  DeliveryConfigResponse,
  DeliveryPreparationOrder,
  DispatchDeliveryPreparationResponse,
  Warehouse
} from '../../types';
import { ModalShell, INPUT_WIDTH_CLASSES, FORM_CONTROL_BASE_CLASS } from '../ui';
import { formatPrepMoney, prepErrorText, prepPaymentLabel } from '../../utils/deliveryPrep';

export interface PrepDispatchModalProps {
  order: DeliveryPreparationOrder;
  config: DeliveryConfigResponse | null;
  cashboxes: Cashbox[];
  warehouses: Warehouse[];
  onClose: () => void;
  onDispatched: (result: DispatchDeliveryPreparationResponse) => void;
}

function isActiveStatus(status: string): boolean {
  return status === 'active' || status === 'نشطة' || status === 'نشط';
}

/**
 * نافذة «شحن أمر التجهيز»: هنا بتطلع فاتورة البيع، والمخزون بينقص، والفلوس بتتسجل.
 * السيرفر هو المرجع: بيتأكد من الكميات والخزنة والمسؤول، وأي رفض بيرجع برسالة عربية.
 */
export const PrepDispatchModal: React.FC<PrepDispatchModalProps> = ({
  order,
  config,
  cashboxes,
  warehouses,
  onClose,
  onDispatched
}) => {
  const mode = config?.settings?.mode || 'both';
  const driversAllowed = mode !== 'couriers';
  const couriersAllowed = mode !== 'drivers';
  const drivers = config?.drivers || [];
  const couriers = config?.couriers || [];

  const initialType: '' | DeliveryAssigneeType =
    order.assigneeType === 'driver' && driversAllowed
      ? 'driver'
      : order.assigneeType === 'courier' && couriersAllowed
      ? 'courier'
      : driversAllowed && !couriersAllowed
      ? 'driver'
      : couriersAllowed && !driversAllowed
      ? 'courier'
      : '';

  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => isActiveStatus(String(w.status))),
    [warehouses]
  );
  const activeCashboxes = useMemo(
    () => cashboxes.filter((c) => isActiveStatus(String(c.status))),
    [cashboxes]
  );

  const [assigneeType, setAssigneeType] = useState<'' | DeliveryAssigneeType>(initialType);
  const [assigneeId, setAssigneeId] = useState<string>(
    initialType && initialType === order.assigneeType ? order.assigneeId : ''
  );
  const [trackingNumber, setTrackingNumber] = useState<string>(order.trackingNumber || '');
  const [warehouseId, setWarehouseId] = useState<string>(
    () => (activeWarehouses.find((w) => w.isDefault) || activeWarehouses[0])?.id || ''
  );
  const [cashboxId, setCashboxId] = useState<string>(
    () => (activeCashboxes.length === 1 ? activeCashboxes[0].id : '')
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const isPrepaid = order.paymentMode !== 'cod';
  const isResume = order.status === 'جاري الشحن';
  const assigneeOptions = assigneeType === 'driver' ? drivers : assigneeType === 'courier' ? couriers : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!assigneeType || !assigneeId) {
      setError('اختار الطيار أو شركة الشحن اللي هتوصّل الطلب');
      return;
    }
    if (isPrepaid && !cashboxId) {
      setError('اختار الخزنة اللي هتستلم فلوس الطلب');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await api.dispatchDeliveryPreparationOrder(order.id, {
        revision: order.revision,
        assigneeType,
        assigneeId,
        ...(assigneeType === 'courier' ? { trackingNumber: trackingNumber.trim() } : {}),
        ...(warehouseId ? { warehouseId } : {}),
        ...(isPrepaid && cashboxId ? { cashboxId } : {})
      });
      onDispatched(result);
    } catch (err) {
      setError(prepErrorText(err, 'تعذر شحن أمر التجهيز وإصدار الفاتورة'));
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      closeDisabled={isSubmitting}
      title={`شحن أمر التجهيز ${order.number}`}
      subtitle={order.customerName || 'عميل نقدي'}
      className="w-full max-w-lg"
      footer={
        <>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
          >
            رجوع
          </button>
          <button
            type="submit"
            form="prep-dispatch-form"
            disabled={isSubmitting}
            data-testid="prep-dispatch-submit"
            className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            <span>{isResume ? 'استكمال الشحن' : 'شحن وإصدار الفاتورة'}</span>
          </button>
        </>
      }
    >
      <form id="prep-dispatch-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="border-r-4 border-amber-600 pr-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
          {isResume
            ? 'الأمر ده اتبعت للشحن قبل كده وما كملش. الضغط هنا بيكمّل الربط من غير ما يكرر الفاتورة.'
            : 'بالضغط على «شحن وإصدار الفاتورة» هتطلع فاتورة البيع، والكميات هتتخصم من المخزون، والطلب هيخرج للتوصيل. الخطوة دي ما بترجعش.'}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div>
            <span className="text-[var(--text-muted)]">طريقة الدفع: </span>
            <span className="font-semibold text-[var(--text-primary)]">{prepPaymentLabel(order.paymentMode)}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">الإجمالي التقديري: </span>
            <span className="font-bold text-[var(--text-primary)] tabular-nums">
              {formatPrepMoney(order.estimatedTotal)}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="prep-dispatch-assignee-type" className="block text-sm font-semibold text-[var(--text-primary)]">
            مين هيوصّل (مطلوب)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="prep-dispatch-assignee-type"
              value={assigneeType}
              disabled={isSubmitting}
              onChange={(e) => {
                setAssigneeType(e.target.value as '' | DeliveryAssigneeType);
                setAssigneeId('');
                setError(null);
              }}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} min-h-[44px]`}
            >
              <option value="">اختار النوع</option>
              {driversAllowed && <option value="driver">طيار</option>}
              {couriersAllowed && <option value="courier">شركة شحن</option>}
            </select>
            <select
              aria-label="اسم الطيار أو شركة الشحن"
              value={assigneeId}
              disabled={isSubmitting || !assigneeType}
              onChange={(e) => {
                setAssigneeId(e.target.value);
                setError(null);
              }}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px]`}
            >
              <option value="">{assigneeType === 'courier' ? 'اختار شركة الشحن' : 'اختار الطيار'}</option>
              {assigneeOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {assigneeType === 'courier' && (
          <div className="space-y-1.5">
            <label htmlFor="prep-dispatch-tracking" className="block text-sm font-semibold text-[var(--text-primary)]">
              رقم البوليصة (اختياري)
            </label>
            <input
              id="prep-dispatch-tracking"
              type="text"
              dir="ltr"
              maxLength={60}
              value={trackingNumber}
              disabled={isSubmitting}
              onChange={(e) => setTrackingNumber(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px]`}
            />
          </div>
        )}

        {activeWarehouses.length > 1 && (
          <div className="space-y-1.5">
            <label htmlFor="prep-dispatch-warehouse" className="block text-sm font-semibold text-[var(--text-primary)]">
              المخزن اللي هتتخصم منه الكميات
            </label>
            <select
              id="prep-dispatch-warehouse"
              value={warehouseId}
              disabled={isSubmitting}
              onChange={(e) => setWarehouseId(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px]`}
            >
              {activeWarehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {isPrepaid && (
          <div className="space-y-1.5">
            <label htmlFor="prep-dispatch-cashbox" className="block text-sm font-semibold text-[var(--text-primary)]">
              الخزنة اللي هتستلم الفلوس (مطلوب)
            </label>
            <select
              id="prep-dispatch-cashbox"
              value={cashboxId}
              disabled={isSubmitting}
              onChange={(e) => {
                setCashboxId(e.target.value);
                setError(null);
              }}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px]`}
            >
              <option value="">اختار الخزنة</option>
              {activeCashboxes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </form>
    </ModalShell>
  );
};

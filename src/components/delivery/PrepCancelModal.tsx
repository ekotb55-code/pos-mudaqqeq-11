import React, { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import { DeliveryPreparationOrder } from '../../types';
import { ModalShell, INPUT_WIDTH_CLASSES, FORM_CONTROL_BASE_CLASS } from '../ui';
import { prepErrorText } from '../../utils/deliveryPrep';

export interface PrepCancelModalProps {
  order: DeliveryPreparationOrder;
  onClose: () => void;
  onCancelled: (order: DeliveryPreparationOrder) => void;
}

/** نافذة «إلغاء أمر التجهيز»: متاحة قبل الشحن بس، والسبب مطلوب. الإلغاء ما بيأثرش على المخزون ولا الخزنة. */
export const PrepCancelModal: React.FC<PrepCancelModalProps> = ({ order, onClose, onCancelled }) => {
  const [reason, setReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCancelling) return;
    if (!reason.trim()) {
      setError('اكتب سبب الإلغاء');
      return;
    }
    setIsCancelling(true);
    setError(null);
    try {
      const res = await api.cancelDeliveryPreparationOrder(order.id, {
        reason: reason.trim(),
        revision: order.revision
      });
      onCancelled(res.order);
    } catch (err) {
      setError(prepErrorText(err, 'تعذر إلغاء أمر التجهيز'));
      setIsCancelling(false);
    }
  };

  return (
    <ModalShell
      onClose={() => {
        if (!isCancelling) onClose();
      }}
      closeDisabled={isCancelling}
      title={`إلغاء أمر التجهيز ${order.number}`}
      subtitle={order.customerName || 'عميل نقدي'}
      className="w-full max-w-md"
      footer={
        <>
          <button
            type="button"
            disabled={isCancelling}
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
          >
            رجوع
          </button>
          <button
            type="submit"
            form="prep-cancel-form"
            disabled={isCancelling}
            data-testid="prep-cancel-submit"
            className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isCancelling && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>تأكيد الإلغاء</span>
          </button>
        </>
      }
    >
      <form id="prep-cancel-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <p className="text-sm text-[var(--text-secondary)]">
          الأمر لسه ما طلعلوش فاتورة، فالإلغاء ما بيأثرش على المخزون ولا الخزنة.
        </p>
        <div className="space-y-1.5">
          <label htmlFor="prep-cancel-reason" className="block text-sm font-semibold text-[var(--text-primary)]">
            سبب الإلغاء (مطلوب)
          </label>
          <input
            id="prep-cancel-reason"
            type="text"
            maxLength={200}
            value={reason}
            disabled={isCancelling}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} min-h-[44px]`}
          />
        </div>
      </form>
    </ModalShell>
  );
};

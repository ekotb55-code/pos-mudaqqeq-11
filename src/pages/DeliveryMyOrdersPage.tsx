import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Phone,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  X,
  Loader2,
  Truck,
  Check,
  XCircle
} from 'lucide-react';
import { api } from '../api/client';
import {
  UserAccount,
  DeliveryDriver,
  DeliveryOrder,
  DeliveryOrderStatus,
  DeliveryDriverAllowedStatus
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

interface DeliveryMyOrdersPageProps {
  user: UserAccount;
}

/**
 * انتقالات الحالة المسموح بها لحساب الطيار فقط مطابقة لـ ALLOWED و DRIVER_STATUSES في server/delivery.ts
 */
const DRIVER_ALLOWED_TRANSITIONS: Record<DeliveryOrderStatus, DeliveryDriverAllowedStatus[]> = {
  'جديد': ['خرج للتوصيل'],
  'خرج للتوصيل': ['اتسلم', 'ما اتسلمش'],
  'ما اتسلمش': ['خرج للتوصيل'],
  'اتسلم': [],
  'رجع المحل': [],
  'اتلغى': []
};

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

export const DeliveryMyOrdersPage: React.FC<DeliveryMyOrdersPageProps> = ({ user }) => {
  const canUseDriverScreen =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'delivery.driver');

  const [driver, setDriver] = useState<DeliveryDriver | null>(null);
  const [openOrders, setOpenOrders] = useState<DeliveryOrder[]>([]);
  const [recentOrders, setRecentOrders] = useState<DeliveryOrder[]>([]);
  const [custody, setCustody] = useState<number>(0);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
    warning?: string;
  } | null>(null);

  // منع تكرار الإرسال لزر «خرج للتوصيل» المباشر
  const [submittingOrderId, setSubmittingOrderId] = useState<string | null>(null);

  // نافذة تأكيد «اتسلم» أو «ما اتسلمش» (سبب إلزامي لـ «ما اتسلمش»)
  const [actionModal, setActionModal] = useState<{
    order: DeliveryOrder;
    targetStatus: 'اتسلم' | 'ما اتسلمش';
  } | null>(null);
  const [failReason, setFailReason] = useState<string>('');
  const [statusNote, setStatusNote] = useState<string>('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmittingModal, setIsSubmittingModal] = useState<boolean>(false);

  const loadMyOrders = useCallback(async () => {
    if (!canUseDriverScreen) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await api.getDeliveryMyOrders();
      if (!res || !res.success) {
        throw new Error(res?.error || 'تعذر تحميل طلباتك');
      }
      setDriver(res.driver || null);
      setOpenOrders(Array.isArray(res.open) ? res.open : []);
      setRecentOrders(Array.isArray(res.recent) ? res.recent : []);
      setCustody(Number(res.custody) || 0);
    } catch (err: any) {
      setLoadError(err?.message || 'تعذر تحميل طلباتك');
      setOpenOrders([]);
      setRecentOrders([]);
    } finally {
      setIsLoading(false);
    }
  }, [canUseDriverScreen]);

  useEffect(() => {
    loadMyOrders();
  }, [loadMyOrders]);

  // تنفيذ «خرج للتوصيل» مباشرة مع منع تكرار الإرسال
  const handleMarkOutForDelivery = async (order: DeliveryOrder) => {
    if (!canUseDriverScreen || submittingOrderId || isSubmittingModal) return;
    const allowed = DRIVER_ALLOWED_TRANSITIONS[order.status] || [];
    if (!allowed.includes('خرج للتوصيل')) return;

    setSubmittingOrderId(order.id);
    setFeedback(null);
    try {
      const res = await api.updateDeliveryMyOrderStatus(order.id, {
        status: 'خرج للتوصيل'
      });
      if (!res || !res.success || !res.order) {
        throw new Error(res?.error || 'تعذر تحديث حالة الطلب');
      }
      setFeedback({
        type: 'success',
        message: `تم تحديث حالة الطلب ${res.order.number} إلى «خرج للتوصيل».`
      });
      await loadMyOrders();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'تعذر تحديث حالة الطلب'
      });
    } finally {
      setSubmittingOrderId(null);
    }
  };

  const openStatusActionModal = (
    order: DeliveryOrder,
    targetStatus: 'اتسلم' | 'ما اتسلمش'
  ) => {
    if (!canUseDriverScreen || submittingOrderId || isSubmittingModal) return;
    const allowed = DRIVER_ALLOWED_TRANSITIONS[order.status] || [];
    if (!allowed.includes(targetStatus)) return;
    setFailReason('');
    setStatusNote('');
    setModalError(null);
    setActionModal({ order, targetStatus });
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionModal || !canUseDriverScreen || isSubmittingModal) return;

    const { order, targetStatus } = actionModal;
    const allowed = DRIVER_ALLOWED_TRANSITIONS[order.status] || [];
    if (!allowed.includes(targetStatus)) {
      setModalError('هذا الإجراء غير مسموح به لحالة الطلب الحالية.');
      return;
    }

    if (targetStatus === 'ما اتسلمش' && !failReason.trim()) {
      setModalError('اكتب سبب عدم تسليم الطلب.');
      return;
    }

    setIsSubmittingModal(true);
    setModalError(null);
    try {
      const res = await api.updateDeliveryMyOrderStatus(order.id, {
        status: targetStatus,
        ...(targetStatus === 'ما اتسلمش' ? { reason: failReason.trim() } : {}),
        ...(statusNote.trim() ? { note: statusNote.trim() } : {})
      });
      if (!res || !res.success || !res.order) {
        throw new Error(res?.error || 'تعذر تحديث حالة الطلب');
      }
      setActionModal(null);
      setFeedback({
        type: res.warning ? 'warning' : 'success',
        message: `تم تحديث حالة الطلب ${res.order.number} إلى «${res.order.status}».`,
        warning: res.warning || undefined
      });
      await loadMyOrders();
    } catch (err: any) {
      setModalError(err?.message || 'تعذر تحديث حالة الطلب');
    } finally {
      setIsSubmittingModal(false);
    }
  };

  if (!canUseDriverScreen) {
    return (
      <PageSurface title="طلباتي">
        <div
          role="alert"
          className="py-6 text-sm font-semibold text-rose-700 dark:text-rose-300"
        >
          غير مصرح لك بعرض شاشة طلبات الطيار (تتطلب صلاحية delivery.driver).
        </div>
      </PageSurface>
    );
  }

  return (
    <PageSurface
      title="طلباتي"
      subtitle={
        driver
          ? `الطيار: ${driver.name} — العهدة الحالية غير المسوّاة: ${formatMoney(custody)}`
          : 'طلبات التوصيل المسندة إلى حسابك'
      }
      actions={
        <button
          type="button"
          onClick={() => {
            setFeedback(null);
            loadMyOrders();
          }}
          disabled={isLoading}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] text-sm font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>تحديث</span>
        </button>
      }
    >
      {/* رسائل النجاح والتنبيه والخطأ */}
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
            <div className="flex items-start gap-2 font-semibold">
              {feedback.type === 'error' || feedback.type === 'warning' ? (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
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

      {/* حالة التحميل أو الخطأ العام */}
      {isLoading ? (
        <div className="py-10 flex items-center gap-3 text-sm font-semibold text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>جاري تحميل طلباتك...</span>
        </div>
      ) : loadError ? (
        <div role="alert" className="py-6 space-y-3">
          <div className="flex items-start gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={loadMyOrders}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      ) : (
        <>
          {/* 1) الطلبات المفتوحة — تصميم مهيأ للاستخدام على الهاتف بأهداف لمس >= 44px */}
          <SectionHeading
            title="الطلبات المفتوحة"
            actions={
              <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
                {openOrders.length} طلب
              </span>
            }
          />

          {openOrders.length === 0 ? (
            <p className="py-6 text-sm text-[var(--text-secondary)]">
              لا توجد طلبات توصيل مفتوحة مسندة إليك حاليًا.
            </p>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {openOrders.map((order) => {
                const allowed = DRIVER_ALLOWED_TRANSITIONS[order.status] || [];
                const isBusy = submittingOrderId === order.id;
                const disableActions = Boolean(submittingOrderId) || isSubmittingModal;

                return (
                  <article key={order.id} className="py-4 space-y-3">
                    {/* سطر رقم الطلب والحالة */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className="text-base font-bold text-[var(--text-primary)] tabular-nums"
                          dir="ltr"
                        >
                          {order.number}
                        </span>
                        <span className={`text-sm font-bold ${statusTextClass(order.status)}`}>
                          {order.status}
                        </span>
                      </div>
                      <span className="text-xs text-[var(--text-muted)] tabular-nums">
                        {formatDateTime(order.createdAt)}
                      </span>
                    </div>

                    {/* بيانات العميل والعنوان والدفع */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div>
                        <span className="text-[var(--text-muted)]">العميل: </span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {order.customerName || 'عميل نقدي'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[var(--text-muted)]">الهاتف: </span>
                        {order.phone ? (
                          <a
                            href={`tel:${order.phone}`}
                            className="inline-flex items-center gap-1.5 min-h-[44px] px-2 -my-2 font-semibold text-sky-700 dark:text-sky-300 underline tabular-nums"
                            dir="ltr"
                          >
                            <Phone className="w-4 h-4 shrink-0" />
                            <span>{order.phone}</span>
                          </a>
                        ) : (
                          <span className="text-[var(--text-secondary)]">—</span>
                        )}
                      </div>

                      <div className="sm:col-span-2 flex items-start gap-1.5">
                        <MapPin className="w-4 h-4 mt-0.5 text-[var(--text-muted)] shrink-0" />
                        <div>
                          {order.zoneName && (
                            <span className="font-semibold text-[var(--text-primary)]">
                              {order.zoneName} —{' '}
                            </span>
                          )}
                          <span className="text-[var(--text-primary)]">
                            {order.address || '—'}
                          </span>
                        </div>
                      </div>

                      <div>
                        <span className="text-[var(--text-muted)]">طريقة الدفع: </span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {order.paymentMode === 'cod' ? 'الدفع عند الاستلام' : 'مدفوع مقدمًا'}
                        </span>
                      </div>

                      {order.paymentMode === 'cod' && (
                        <div>
                          <span className="text-[var(--text-muted)]">المطلوب تحصيله: </span>
                          <span className="font-bold text-amber-700 dark:text-amber-300 tabular-nums">
                            {formatMoney(order.amountDue)}
                          </span>
                        </div>
                      )}

                      <div>
                        <span className="text-[var(--text-muted)]">المسؤول: </span>
                        <span className="font-medium text-[var(--text-primary)]">
                          {order.assigneeName
                            ? `${order.assigneeType === 'courier' ? 'شركة شحن' : 'طيار'}: ${order.assigneeName}`
                            : '—'}
                        </span>
                      </div>

                      {order.failReason && (
                        <div className="sm:col-span-2">
                          <span className="text-[var(--text-muted)]">سبب عدم التسليم السابق: </span>
                          <span className="font-semibold text-orange-700 dark:text-orange-300">
                            {order.failReason}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* إجراءات الطيار المسموحة فقط */}
                    {allowed.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {allowed.includes('خرج للتوصيل') && (
                          <button
                            type="button"
                            disabled={disableActions}
                            onClick={() => handleMarkOutForDelivery(order)}
                            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition-colors disabled:opacity-50 w-full sm:w-auto"
                          >
                            {isBusy ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Truck className="w-4 h-4" />
                            )}
                            <span>
                              {order.status === 'ما اتسلمش'
                                ? 'إعادة الخروج للتوصيل'
                                : 'خرج للتوصيل'}
                            </span>
                          </button>
                        )}

                        {allowed.includes('اتسلم') && (
                          <button
                            type="button"
                            disabled={disableActions}
                            onClick={() => openStatusActionModal(order, 'اتسلم')}
                            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-50 w-full sm:w-auto"
                          >
                            <Check className="w-4 h-4" />
                            <span>تم التسليم (اتسلم)</span>
                          </button>
                        )}

                        {allowed.includes('ما اتسلمش') && (
                          <button
                            type="button"
                            disabled={disableActions}
                            onClick={() => openStatusActionModal(order, 'ما اتسلمش')}
                            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border border-orange-600 text-orange-700 dark:text-orange-300 hover:bg-[var(--surface-hover)] text-sm font-semibold transition-colors disabled:opacity-50 w-full sm:w-auto"
                          >
                            <XCircle className="w-4 h-4" />
                            <span>ما اتسلمش</span>
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {/* 2) آخر الطلبات المغلقة (حتى 30 طلبًا يعيدها السيرفر) */}
          <SectionHeading
            title="آخر الطلبات المغلقة"
            withTopDivider
            actions={
              <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
                {recentOrders.length} طلب
              </span>
            }
          />

          {recentOrders.length === 0 ? (
            <p className="py-4 text-sm text-[var(--text-secondary)]">
              لا توجد طلبات مغلقة سابقة.
            </p>
          ) : (
            <CompactTable>
              <thead>
                <tr>
                  <th>رقم الطلب</th>
                  <th>العميل والهاتف</th>
                  <th>المنطقة والعنوان</th>
                  <th>طريقة الدفع / التحصيل</th>
                  <th>المسؤول</th>
                  <th>الحالة</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td
                      className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`}
                      dir="ltr"
                    >
                      {order.number}
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>
                      <div className="font-semibold text-[var(--text-primary)]">
                        {order.customerName || 'عميل نقدي'}
                      </div>
                      {order.phone && (
                        <div
                          className="text-xs text-[var(--text-secondary)] tabular-nums"
                          dir="ltr"
                        >
                          {order.phone}
                        </div>
                      )}
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>
                      {order.zoneName && (
                        <div className="font-semibold text-[var(--text-primary)]">
                          {order.zoneName}
                        </div>
                      )}
                      <div className="text-xs text-[var(--text-secondary)]">
                        {order.address || '—'}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="text-[var(--text-primary)]">
                        {order.paymentMode === 'cod' ? 'الدفع عند الاستلام' : 'مدفوع مقدمًا'}
                      </div>
                      {order.paymentMode === 'cod' && (
                        <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                          {formatMoney(order.amountDue)}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-[var(--text-primary)]">
                      {order.assigneeName
                        ? `${order.assigneeType === 'courier' ? 'شركة شحن' : 'طيار'}: ${order.assigneeName}`
                        : '—'}
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>
                      <div className={`font-bold whitespace-nowrap ${statusTextClass(order.status)}`}>
                        {order.status}
                      </div>
                      {order.failReason && (
                        <div className="text-xs text-[var(--text-secondary)]">
                          السبب: {order.failReason}
                        </div>
                      )}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`}>
                      {formatDateTime(order.closedAt || order.deliveredAt || order.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </CompactTable>
          )}
        </>
      )}

      {/* نافذة تأكيد «اتسلم» أو «ما اتسلمش» */}
      {actionModal && (
        <ModalShell
          onClose={() => {
            if (!isSubmittingModal) setActionModal(null);
          }}
          closeDisabled={isSubmittingModal}
          title={
            actionModal.targetStatus === 'اتسلم'
              ? `تأكيد تسليم الطلب ${actionModal.order.number}`
              : `تسجيل عدم تسليم الطلب ${actionModal.order.number}`
          }
          subtitle={actionModal.order.customerName || 'عميل نقدي'}
          className="w-full max-w-md"
          footer={
            <>
              <button
                type="button"
                disabled={isSubmittingModal}
                onClick={() => setActionModal(null)}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="submit"
                form="driver-status-action-form"
                disabled={isSubmittingModal}
                className={`inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-lg text-white text-sm font-semibold transition-colors disabled:opacity-50 ${
                  actionModal.targetStatus === 'اتسلم'
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-orange-700 hover:bg-orange-800'
                }`}
              >
                {isSubmittingModal && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {actionModal.targetStatus === 'اتسلم'
                    ? 'تأكيد التسليم'
                    : 'حفظ «ما اتسلمش»'}
                </span>
              </button>
            </>
          }
        >
          <form id="driver-status-action-form" onSubmit={handleModalSubmit} className="space-y-4">
            {modalError && (
              <div
                role="alert"
                className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {actionModal.targetStatus === 'اتسلم' && actionModal.order.paymentMode === 'cod' && (
              <div className="border-r-4 border-amber-600 pr-3 py-2 text-sm text-amber-800 dark:text-amber-200 font-semibold">
                الدفع عند الاستلام: تأكد من تحصيل مبلغ{' '}
                <span className="tabular-nums font-bold">
                  {formatMoney(actionModal.order.amountDue)}
                </span>{' '}
                من العميل قبل تأكيد التسليم.
              </div>
            )}

            {actionModal.targetStatus === 'ما اتسلمش' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="driver-fail-reason"
                  className="block text-sm font-semibold text-[var(--text-primary)]"
                >
                  سبب عدم التسليم (مطلوب)
                </label>
                <input
                  id="driver-fail-reason"
                  type="text"
                  required
                  maxLength={200}
                  value={failReason}
                  onChange={(e) => {
                    setFailReason(e.target.value);
                    setModalError(null);
                  }}
                  disabled={isSubmittingModal}
                  placeholder="مثال: العميل لا يرد / الهاتف مغلق / العنوان غير واضح"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} min-h-[44px]`}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="driver-status-note"
                className="block text-sm font-semibold text-[var(--text-primary)]"
              >
                ملاحظة (اختياري)
              </label>
              <input
                id="driver-status-note"
                type="text"
                maxLength={250}
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                disabled={isSubmittingModal}
                placeholder="ملاحظة إضافية إن وجدت"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} min-h-[44px]`}
              />
            </div>
          </form>
        </ModalShell>
      )}
    </PageSurface>
  );
};

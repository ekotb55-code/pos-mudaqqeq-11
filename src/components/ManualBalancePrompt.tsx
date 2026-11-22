import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Lock, X } from 'lucide-react';
import { api, notifyManualBalanceUpdated } from '../api/client';
import type { ManualBalanceEntry, ManualBalanceRequest } from '../types';

export const BANK_LINK_FOCUS_ALERTS_STORAGE_KEY = 'pos_bank_link_focus_alerts';
export const BANK_LINK_SELECTED_MANUAL_STORAGE_KEY = 'pos_bank_link_selected_manual';

const ARABIC_INDIC_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٫': '.',
  '٬': '',
};

/**
 * يحوّل الأرقام العربية والفارسية والفاصلة العشرية العربية إلى أرقام إنجليزية صالحة قبل الإرسال للسيرفر
 */
export function normalizeArabicDigits(raw: string): string {
  const mapped = String(raw || '')
    .trim()
    .replace(/[٠-٩۰-۹٫٬]/g, (ch) => ARABIC_INDIC_MAP[ch] ?? ch)
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  return mapped;
}

/**
 * يعرض التاريخ والوقت بتوقيت الجهاز المحلي (بدون فرض منطقة زمنية ثابتة)
 */
export function formatDeviceDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

/**
 * يعرض الوقت فقط بتوقيت الجهاز المحلي
 */
export function formatDeviceTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toLocaleTimeString();
  }
}

export function formatManualMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return '—';
  }
  return `${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ج.م`;
}

export function formatSignedManualDiff(diff: number): string {
  const abs = Math.abs(Number(diff) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return diff >= 0 ? `+${abs} ج.م` : `-${abs} ج.م`;
}

export interface ManualBalanceModalProps {
  request: ManualBalanceRequest;
  allowPostpone?: boolean;
  voluntaryMode?: boolean;
  initialResult?: ManualBalanceEntry | null;
  onSubmitted?: (entry: ManualBalanceEntry, nextRequests?: ManualBalanceRequest[]) => void;
  onPostponed?: (request: ManualBalanceRequest, nextRequests?: ManualBalanceRequest[]) => void;
  onLater?: () => void;
  onCloseDone: () => void;
}

/**
 * نافذة إدخال الرصيد الحالي للحساب (المتابَعة اليدوية بدون قراءة رسائل):
 * - لا تعرض رصيد الخزنة في النظام قبل الإدخال أبدًا
 * - في الوضع الإجباري لا تُغلق بالضغط خارجها أو بمفتاح Esc ولا يوجد زر إغلاق
 */
export const ManualBalanceModal: React.FC<ManualBalanceModalProps> = ({
  request,
  allowPostpone = true,
  voluntaryMode = false,
  initialResult = null,
  onSubmitted,
  onPostponed,
  onLater,
  onCloseDone,
}) => {
  const [balanceInput, setBalanceInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPostponing, setIsPostponing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ManualBalanceEntry | null>(initialResult);

  // إعادة التهيئة عند الانتقال من طلب إلى آخر فقط.
  // في الإدخال الاختياري وقت الطلب يتغير مع كل إعادة رسم للصفحة، فلا يدخل في المفتاح حتى لا تُمسح النتيجة أو الرقم المكتوب.
  const requestKey = `${request.accountId}|${voluntaryMode ? 'voluntary' : request.dueAt}`;
  useEffect(() => {
    setBalanceInput('');
    setErrorMessage(null);
    setResult(initialResult);
  }, [requestKey]);
  useEffect(() => {
    if (initialResult) setResult(initialResult);
  }, [initialResult]);

  const isMandatory = Boolean(request.mandatory && !voluntaryMode);
  const canDismiss = !isMandatory || Boolean(result);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!canDismiss) {
          e.preventDefault();
          e.stopPropagation();
        } else if (result) {
          e.preventDefault();
          onCloseDone();
        } else {
          e.preventDefault();
          if (onLater) onLater();
          else onCloseDone();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [canDismiss, result, onLater, onCloseDone]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);
    const normalized = normalizeArabicDigits(balanceInput);
    if (!normalized) {
      setErrorMessage('اكتب الرصيد الحالي رقمًا صحيحًا');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await api.submitManualBalance(request.accountId, { balance: normalized });
      if (!res.success || !res.entry) {
        setErrorMessage(res.error || 'تعذر تسجيل الرصيد');
        return;
      }
      setResult(res.entry);
      notifyManualBalanceUpdated();
      if (onSubmitted) {
        onSubmitted(res.entry, res.requests);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر تسجيل الرصيد');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePostpone = async () => {
    setErrorMessage(null);
    setIsPostponing(true);
    try {
      const res = await api.postponeManualBalance(request.accountId);
      if (!res.success || !res.request) {
        setErrorMessage(res.error || 'تعذر تأجيل طلب الرصيد');
        return;
      }
      notifyManualBalanceUpdated();
      if (onPostponed) {
        onPostponed(res.request, res.requests);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'تعذر تأجيل طلب الرصيد');
    } finally {
      setIsPostponing(false);
    }
  };

  const busy = isSubmitting || isPostponing;

  return (
    <div
      data-testid="manual-balance-modal"
      data-mandatory={isMandatory ? 'true' : 'false'}
      className="no-print fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-slate-900/65 overflow-y-auto"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-balance-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && canDismiss) {
          if (result) onCloseDone();
          else if (onLater) onLater();
          else onCloseDone();
        }
      }}
    >
      <div className="w-full max-w-md flex flex-col rounded-2xl bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border-color)] overflow-hidden">
        {/* رأس النافذة */}
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3
              id="manual-balance-modal-title"
              className="text-base font-bold text-[var(--text-primary)] leading-snug"
            >
              رصيد {request.accountName} الحالي
            </h3>
            <p className="text-xs font-semibold text-[var(--text-secondary)]">
              الخزنة: {request.cashboxName}
            </p>
          </div>
          {canDismiss && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (result) onCloseDone();
                else if (onLater) onLater();
                else onCloseDone();
              }}
              aria-label="إغلاق"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition cursor-pointer disabled:opacity-40 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* جسم النافذة */}
        {result ? (
          <div data-testid="manual-balance-result" className="p-5 space-y-4">
            {result.kind === 'baseline' ? (
              <div className="flex items-start gap-2.5 text-sm font-bold text-emerald-700 dark:text-emerald-400 leading-relaxed">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                <span>تم ضبط رصيد الخزنة على {formatManualMoney(result.enteredBalance)}</span>
              </div>
            ) : result.difference === 0 ? (
              <div className="flex items-start gap-2.5 text-sm font-bold text-emerald-700 dark:text-emerald-400 leading-relaxed">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                <span>الرصيد مطابق لرصيد النظام</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-start gap-2.5 text-sm font-bold text-[var(--text-primary)] leading-relaxed">
                  <AlertTriangle
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      result.difference > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  />
                  <span>
                    يوجد فرق{' '}
                    <strong
                      data-testid="manual-balance-result-diff"
                      className={`font-mono tabular-nums ${
                        result.difference > 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {formatSignedManualDiff(result.difference)}
                    </strong>{' '}
                    بين الرصيد الذي كتبته ورصيد النظام ({formatManualMoney(result.bookBalanceBefore)}). تم تسجيل الفرق على الخزنة للمراجعة وسيصل تنبيه للمالك
                  </span>
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-end">
              <button
                type="button"
                data-testid="manual-balance-done-btn"
                onClick={onCloseDone}
                className="min-h-[44px] px-6 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition cursor-pointer"
              >
                تم
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <p className="text-xs font-semibold text-[var(--text-primary)] leading-relaxed">
              اكتب الرصيد الموجود في الحساب الآن كما يظهر عندك في البنك أو المحفظة
            </p>

            {request.kind === 'baseline' && !voluntaryMode && (
              <p className="text-xs font-semibold text-sky-700 dark:text-sky-400 leading-relaxed">
                أول إدخال: سيبدأ رصيد الخزنة في النظام من الرقم الذي تكتبه
              </p>
            )}

            {isMandatory && (
              <div className="p-3 rounded-lg border border-rose-300/80 dark:border-rose-700/60 text-xs font-bold text-rose-800 dark:text-rose-300 space-y-1.5">
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>إدخال الرصيد إجباري لهذه الخزنة. لن تستطيع تنفيذ أي عملية قبل كتابته</span>
                </div>
                {allowPostpone && !request.canPostpone && (
                  <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 ps-6">
                    تم استخدام التأجيل لهذا الموعد
                  </p>
                )}
              </div>
            )}

            {errorMessage && (
              <div
                role="alert"
                className="p-3 rounded-lg border border-rose-300 bg-rose-50/50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 text-xs font-bold"
              >
                {errorMessage}
              </div>
            )}

            <div>
              <label
                htmlFor="manual-balance-input"
                className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5"
              >
                الرصيد الحالي (ج.م)
              </label>
              <input
                id="manual-balance-input"
                data-testid="manual-balance-input"
                type="text"
                inputMode="decimal"
                dir="ltr"
                autoFocus
                autoComplete="off"
                value={balanceInput}
                onChange={(e) => setBalanceInput(e.target.value)}
                placeholder="0.00"
                className="w-full min-h-[56px] px-4 rounded-xl border border-[var(--border-color)] bg-[var(--surface)] text-[var(--text-primary)] text-2xl font-mono font-bold tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>

            <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-end gap-2">
              {!isMandatory && (
                <button
                  type="button"
                  data-testid="manual-balance-later-btn"
                  disabled={busy}
                  onClick={() => {
                    if (onLater) onLater();
                    else onCloseDone();
                  }}
                  className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs transition cursor-pointer disabled:opacity-50"
                >
                  {voluntaryMode ? 'إلغاء' : 'لاحقًا'}
                </button>
              )}

              {allowPostpone && request.canPostpone && (
                <button
                  type="button"
                  data-testid="manual-balance-postpone-btn"
                  disabled={busy}
                  onClick={handlePostpone}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-amber-400/80 hover:bg-amber-50/50 dark:hover:bg-amber-950/30 text-amber-800 dark:text-amber-300 font-bold text-xs transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>{isPostponing ? 'جاري التأجيل...' : 'تأجيل ساعة'}</span>
                </button>
              )}

              <button
                type="submit"
                data-testid="manual-balance-submit-btn"
                disabled={busy}
                className="min-h-[44px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {isSubmitting ? 'جاري التسجيل...' : 'تسجيل الرصيد'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

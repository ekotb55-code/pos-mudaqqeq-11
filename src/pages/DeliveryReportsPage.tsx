import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  Loader2,
  RotateCcw,
  Clock,
  Filter
} from 'lucide-react';
import { api } from '../api/client';
import {
  UserAccount,
  DeliveryReportsResponse,
  DeliveryOrderStatus
} from '../types';
import { hasPermission } from '../utils/permissions';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS
} from '../components/ui';

interface DeliveryReportsPageProps {
  user: UserAccount;
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

function formatShortageLabel(shortage: number): { text: string; className: string } {
  const val = Number(shortage) || 0;
  if (Math.abs(val) < 0.005) {
    return { text: 'مطابق (0.00 ج.م)', className: 'text-emerald-700 dark:text-emerald-300' };
  }
  if (val > 0) {
    return {
      text: `عجز ${formatMoney(val)}`,
      className: 'text-rose-700 dark:text-rose-300 font-bold'
    };
  }
  return {
    text: `زيادة ${formatMoney(Math.abs(val))}`,
    className: 'text-sky-700 dark:text-sky-300 font-bold'
  };
}

function statusTextClass(status: DeliveryOrderStatus | string): string {
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

export const DeliveryReportsPage: React.FC<DeliveryReportsPageProps> = ({ user }) => {
  const canViewReports =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'delivery.reports');

  const [fromInput, setFromInput] = useState<string>('');
  const [toInput, setToInput] = useState<string>('');
  const [appliedRange, setAppliedRange] = useState<{ from: string; to: string }>({
    from: '',
    to: ''
  });
  const [rangeError, setRangeError] = useState<string | null>(null);

  const [report, setReport] = useState<DeliveryReportsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadReports = useCallback(
    async (range: { from: string; to: string }) => {
      if (!canViewReports) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setLoadError(null);
      try {
        const res = await api.getDeliveryReports({
          from: range.from || undefined,
          to: range.to || undefined
        });
        if (!res || !res.success) {
          throw new Error(res?.error || 'تعذر تحميل تقارير التوصيل');
        }
        setReport(res);
      } catch (err: any) {
        setLoadError(err?.message || 'تعذر تحميل تقارير التوصيل');
      } finally {
        setIsLoading(false);
      }
    },
    [canViewReports]
  );

  useEffect(() => {
    loadReports(appliedRange);
  }, [appliedRange, loadReports]);

  const handleApplyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setRangeError(null);
    if (fromInput && toInput && fromInput > toInput) {
      setRangeError('تاريخ البداية يجب أن يكون قبل أو مساويًا لتاريخ النهاية.');
      return;
    }
    setAppliedRange({ from: fromInput, to: toInput });
  };

  const handleResetFilter = () => {
    setRangeError(null);
    setFromInput('');
    setToInput('');
    setAppliedRange({ from: '', to: '' });
  };

  const hasRangeFilter = Boolean(appliedRange.from || appliedRange.to || fromInput || toInput);

  if (!canViewReports) {
    return (
      <PageSurface title="تقارير التوصيل">
        <div
          role="alert"
          className="py-6 text-sm font-semibold text-rose-700 dark:text-rose-300"
        >
          غير مصرح لك بعرض تقارير التوصيل (تتطلب صلاحية delivery.reports).
        </div>
      </PageSurface>
    );
  }

  const openByStatusEntries = report ? Object.entries(report.openOrders.byStatus || {}) : [];
  const settlementDiff = report ? formatShortageLabel(report.settlements.shortage) : null;

  return (
    <PageSurface
      title="تقارير التوصيل"
      subtitle="متابعة الطلبات المفتوحة والمتأخرة، العهدة، أداء الطيارين، رسوم التوصيل، التسويات، ومستحقات الطيارين"
      actions={
        <button
          type="button"
          onClick={() => loadReports(appliedRange)}
          disabled={isLoading}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] text-sm font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>تحديث</span>
        </button>
      }
    >
      {/* شريط الفلتر الزمني المدعوم من السيرفر (from / to) في صف واحد مضغوط */}
      <form onSubmit={handleApplyFilter} className="flex flex-wrap items-end gap-2.5">
        <div className="space-y-1">
          <label
            htmlFor="delivery-report-from"
            className="block text-xs font-semibold text-[var(--text-secondary)]"
          >
            من تاريخ
          </label>
          <input
            id="delivery-report-from"
            type="date"
            value={fromInput}
            onChange={(e) => {
              setFromInput(e.target.value);
              setRangeError(null);
            }}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} min-h-[44px] tabular-nums`}
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor="delivery-report-to"
            className="block text-xs font-semibold text-[var(--text-secondary)]"
          >
            إلى تاريخ
          </label>
          <input
            id="delivery-report-to"
            type="date"
            value={toInput}
            onChange={(e) => {
              setToInput(e.target.value);
              setRangeError(null);
            }}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} min-h-[44px] tabular-nums`}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
        >
          <Filter className="w-4 h-4" />
          <span>تطبيق الفترة</span>
        </button>

        {hasRangeFilter && (
          <button
            type="button"
            onClick={handleResetFilter}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" />
            <span>مسح الفترة</span>
          </button>
        )}
      </form>

      {rangeError && (
        <div
          role="alert"
          className="mt-2 flex items-center gap-2 border-r-4 border-rose-600 pr-3 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{rangeError}</span>
        </div>
      )}

      {report && (report.from || report.to) && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          الفترة المطبّقة من السيرفر:{' '}
          <span className="font-semibold text-[var(--text-primary)] tabular-nums">
            {report.from || 'البداية'} — {report.to || 'الآن'}
          </span>{' '}
          (تنطبق على أداء الطيارين ورسوم التوصيل والتسويات والمصروف خلال الفترة، بينما الطلبات المفتوحة والعهدة تمثّل الوضع الحالي).
        </p>
      )}

      {isLoading ? (
        <div className="py-10 flex items-center gap-3 text-sm font-semibold text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>جاري تحميل تقارير التوصيل من السيرفر...</span>
        </div>
      ) : loadError ? (
        <div role="alert" className="py-6 space-y-3">
          <div className="flex items-start gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => loadReports(appliedRange)}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      ) : report ? (
        <>
          {/* ============================================================ */}
          {/* 1) الطلبات المفتوحة والمتأخرة                                 */}
          {/* ============================================================ */}
          <SectionHeading title="الطلبات المفتوحة والمتأخرة" withTopDivider />

          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 py-2 border-b border-[var(--border-subtle)] text-sm">
            <div>
              <span className="text-[var(--text-muted)]">إجمالي الطلبات المفتوحة: </span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {report.openOrders.total}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">
                الطلبات المتأخرة (أكثر من {report.openOrders.lateAfterHours} ساعة):{' '}
              </span>
              <span
                className={`font-bold tabular-nums ${
                  report.openOrders.late > 0
                    ? 'text-rose-700 dark:text-rose-300'
                    : 'text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {report.openOrders.late}
              </span>
            </div>
            {openByStatusEntries.map(([st, count]) => (
              <div key={st}>
                <span className="text-[var(--text-muted)]">{st}: </span>
                <span className={`font-bold tabular-nums ${statusTextClass(st)}`}>
                  {count}
                </span>
              </div>
            ))}
          </div>

          {report.openOrders.lateOrders.length === 0 ? (
            <p className="py-3 text-sm text-[var(--text-secondary)]">
              لا توجد طلبات مفتوحة متأخرة حاليًا.
            </p>
          ) : (
            <div className="space-y-2 pt-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-700 dark:text-rose-300">
                <Clock className="w-4 h-4 shrink-0" />
                <span>قائمة الطلبات المتأخرة</span>
              </div>
              <CompactTable>
                <thead>
                  <tr>
                    <th>رقم الطلب / الفاتورة</th>
                    <th>العميل والتواصل</th>
                    <th>المنطقة</th>
                    <th>المسؤول</th>
                    <th>الحالة</th>
                    <th>الإجمالي</th>
                    <th>تاريخ الإنشاء</th>
                  </tr>
                </thead>
                <tbody>
                  {report.openOrders.lateOrders.map((order) => (
                    <tr key={order.id}>
                      <td className={COMPACT_TABLE_NUM_CLASS}>
                        <div className="font-bold text-[var(--text-primary)]" dir="ltr">
                          {order.number}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)]" dir="ltr">
                          {order.invoiceNumber}
                        </div>
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
                      <td className="whitespace-nowrap text-[var(--text-primary)]">
                        {order.zoneName || '—'}
                      </td>
                      <td className="whitespace-nowrap text-[var(--text-primary)]">
                        {order.assigneeName
                          ? `${order.assigneeType === 'courier' ? 'شركة شحن' : 'طيار'}: ${order.assigneeName}`
                          : 'غير موزّع'}
                      </td>
                      <td className={`whitespace-nowrap font-bold ${statusTextClass(order.status)}`}>
                        {order.status}
                      </td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-semibold text-[var(--text-primary)]`}>
                        {formatMoney(order.invoiceTotal)}
                      </td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`}>
                        {formatDateTime(order.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </CompactTable>
            </div>
          )}

          {/* ============================================================ */}
          {/* 2) العهدة والمبالغ غير المسوّاة                              */}
          {/* ============================================================ */}
          <SectionHeading title="العهدة والمبالغ غير المسوّاة" withTopDivider />

          {report.custody.length === 0 ? (
            <p className="py-3 text-sm text-[var(--text-secondary)]">
              لا توجد مبالغ عهدة أو طلبات مُسلّمة تنتظر التسوية حاليًا.
            </p>
          ) : (
            <CompactTable>
              <thead>
                <tr>
                  <th>الجهة</th>
                  <th>النوع</th>
                  <th>عدد الطلبات</th>
                  <th>المبلغ غير المسوّى</th>
                  <th>أقدم تسليم منذ</th>
                </tr>
              </thead>
              <tbody>
                {report.custody.map((row) => (
                  <tr key={`${row.type}:${row.id}`}>
                    <td className="whitespace-nowrap font-semibold text-[var(--text-primary)]">
                      {row.name}
                    </td>
                    <td className="whitespace-nowrap text-[var(--text-secondary)]">
                      {row.type === 'driver' ? 'طيار' : 'شركة شحن'}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-semibold text-[var(--text-primary)]`}>
                      {row.orders}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-amber-700 dark:text-amber-300`}>
                      {formatMoney(row.amount)}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`}>
                      {formatDateTime(row.since)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </CompactTable>
          )}

          {/* ============================================================ */}
          {/* 3) أداء الطيارين                                              */}
          {/* ============================================================ */}
          <SectionHeading title="أداء الطيارين" withTopDivider />

          {report.performance.length === 0 ? (
            <p className="py-3 text-sm text-[var(--text-secondary)]">
              لا يوجد طيارون مسجلون لعرض بيانات الأداء.
            </p>
          ) : (
            <CompactTable>
              <thead>
                <tr>
                  <th>الطيار</th>
                  <th>إجمالي الطلبات</th>
                  <th>المُسلّم</th>
                  <th>مرات عدم التسليم</th>
                  <th>نسبة التسليم</th>
                  <th>متوسط وقت التوصيل</th>
                </tr>
              </thead>
              <tbody>
                {report.performance.map((row) => (
                  <tr key={row.driverId}>
                    <td className="whitespace-nowrap font-semibold text-[var(--text-primary)]">
                      {row.driverName}
                    </td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>{row.orders}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-semibold text-emerald-700 dark:text-emerald-300`}>
                      {row.delivered}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} text-orange-700 dark:text-orange-300`}>
                      {row.failed}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`}>
                      {row.deliveredPercent}%
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`}>
                      {row.avgMinutes > 0 ? `${row.avgMinutes} دقيقة` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </CompactTable>
          )}

          {/* ============================================================ */}
          {/* 4) رسوم التوصيل (الإجمالي / حسب المنطقة / حسب المسؤول)       */}
          {/* ============================================================ */}
          <SectionHeading
            title="رسوم التوصيل (للطلبات المُسلّمة)"
            withTopDivider
            actions={
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                الإجمالي: {formatMoney(report.fees.total)}
              </span>
            }
          />

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-[var(--text-secondary)]">
                توزيع الرسوم حسب المنطقة
              </div>
              {report.fees.byZone.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  لا توجد طلبات مُسلّمة في هذه الفترة لعرض الرسوم حسب المنطقة.
                </p>
              ) : (
                <CompactTable>
                  <thead>
                    <tr>
                      <th>المنطقة</th>
                      <th>عدد الطلبات</th>
                      <th>إجمالي الرسوم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.fees.byZone.map((row) => (
                      <tr key={row.name}>
                        <td className="whitespace-nowrap font-semibold text-[var(--text-primary)]">
                          {row.name}
                        </td>
                        <td className={COMPACT_TABLE_NUM_CLASS}>{row.orders}</td>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`}>
                          {formatMoney(row.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </CompactTable>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-bold text-[var(--text-secondary)]">
                توزيع الرسوم حسب المسؤول (طيار / شركة شحن)
              </div>
              {report.fees.byAssignee.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  لا توجد طلبات مُسلّمة في هذه الفترة لعرض الرسوم حسب المسؤول.
                </p>
              ) : (
                <CompactTable>
                  <thead>
                    <tr>
                      <th>المسؤول عن التوصيل</th>
                      <th>عدد الطلبات</th>
                      <th>إجمالي الرسوم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.fees.byAssignee.map((row) => (
                      <tr key={row.name}>
                        <td className="whitespace-nowrap font-semibold text-[var(--text-primary)]">
                          {row.name}
                        </td>
                        <td className={COMPACT_TABLE_NUM_CLASS}>{row.orders}</td>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`}>
                          {formatMoney(row.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </CompactTable>
              )}
            </div>
          </div>

          {/* ============================================================ */}
          {/* 5) ملخص وسجل التسويات في الفترة                              */}
          {/* ============================================================ */}
          <SectionHeading title="التسويات في الفترة" withTopDivider />

          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 py-2 border-b border-[var(--border-subtle)] text-sm">
            <div>
              <span className="text-[var(--text-muted)]">عدد التسويات: </span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {report.settlements.count}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">المتوقع: </span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {formatMoney(report.settlements.expected)}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">المستلم: </span>
              <span className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                {formatMoney(report.settlements.received)}
              </span>
            </div>
            {settlementDiff && (
              <div>
                <span className="text-[var(--text-muted)]">صافي الفرق: </span>
                <span className={`tabular-nums ${settlementDiff.className}`}>
                  {settlementDiff.text}
                </span>
              </div>
            )}
          </div>

          {report.settlements.list.length === 0 ? (
            <p className="py-3 text-sm text-[var(--text-secondary)]">
              لا توجد تسويات مسجلة خلال هذه الفترة.
            </p>
          ) : (
            <CompactTable>
              <thead>
                <tr>
                  <th>رقم التسوية</th>
                  <th>التاريخ</th>
                  <th>الجهة</th>
                  <th>عدد الطلبات</th>
                  <th>المتوقع</th>
                  <th>المستلم</th>
                  <th>العجز / الزيادة</th>
                  <th>الخزنة</th>
                </tr>
              </thead>
              <tbody>
                {report.settlements.list.map((st) => {
                  const diff = formatShortageLabel(st.shortage);
                  return (
                    <tr key={st.id}>
                      <td
                        className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`}
                        dir="ltr"
                      >
                        {st.number}
                      </td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`}>
                        {formatDateTime(st.at)}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="font-semibold text-[var(--text-primary)]">
                          {st.assigneeName}
                        </span>{' '}
                        <span className="text-xs text-[var(--text-muted)]">
                          ({st.assigneeType === 'driver' ? 'طيار' : 'شركة شحن'})
                        </span>
                      </td>
                      <td className={COMPACT_TABLE_NUM_CLASS}>{st.orderIds.length}</td>
                      <td className={COMPACT_TABLE_NUM_CLASS}>{formatMoney(st.expected)}</td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`}>
                        {formatMoney(st.received)}
                      </td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} ${diff.className}`}>
                        {diff.text}
                      </td>
                      <td className="whitespace-nowrap text-[var(--text-primary)]">
                        {st.cashboxName || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </CompactTable>
          )}

          {/* ============================================================ */}
          {/* 6) ملخص مستحقات الطيارين                                      */}
          {/* ============================================================ */}
          <SectionHeading title="مستحقات الطيارين" withTopDivider />

          {report.dues.length === 0 ? (
            <p className="py-3 text-sm text-[var(--text-secondary)]">
              لا يوجد طيارون مسجلون لعرض ملخص المستحقات.
            </p>
          ) : (
            <CompactTable>
              <thead>
                <tr>
                  <th>الطيار</th>
                  <th>المرتب الشهري</th>
                  <th>عمولات غير مصروفة</th>
                  <th>العجز القائم</th>
                  <th>العهدة الحالية</th>
                  <th>المصروف خلال الفترة</th>
                </tr>
              </thead>
              <tbody>
                {report.dues.map((row) => (
                  <tr key={row.driverId}>
                    <td className="whitespace-nowrap font-semibold text-[var(--text-primary)]">
                      {row.driverName}
                    </td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>{formatMoney(row.monthlySalary)}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-semibold text-emerald-700 dark:text-emerald-300`}>
                      {formatMoney(row.commissionUnpaid)}
                    </td>
                    <td
                      className={`${COMPACT_TABLE_NUM_CLASS} font-semibold ${
                        row.shortageOutstanding > 0
                          ? 'text-rose-700 dark:text-rose-300'
                          : row.shortageOutstanding < 0
                          ? 'text-sky-700 dark:text-sky-300'
                          : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {row.shortageOutstanding < 0
                        ? `زيادة ${formatMoney(Math.abs(row.shortageOutstanding))}`
                        : formatMoney(row.shortageOutstanding)}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} text-amber-700 dark:text-amber-300`}>
                      {formatMoney(row.custody)}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`}>
                      {formatMoney(row.paidInPeriod)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </CompactTable>
          )}
        </>
      ) : null}
    </PageSurface>
  );
};

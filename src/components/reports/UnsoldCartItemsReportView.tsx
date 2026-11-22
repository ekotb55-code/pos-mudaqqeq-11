import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  PackageX,
  ShieldAlert,
  Loader2,
  RefreshCw,
  WifiOff
} from 'lucide-react';
import {
  UserAccount,
  UnsoldCartItemsReport,
  UnsoldCartReportEvent,
  UnsoldCartReportStatus
} from '../../types';
import { api } from '../../api/client';
import { hasPermission } from '../../utils/permissions';
import { DateRange, formatMoney, getDateRangeForPreset } from '../../utils/dateUtils';
import { DateRangeFilter } from '../DateRangeFilter';
import { useOfflineMode } from '../../hooks/useOfflineMode';
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
} from '../ui';

interface UnsoldCartItemsReportViewProps {
  user: UserAccount | null;
  userRole?: string;
  users?: UserAccount[];
}

const STATUS_OPTIONS: Array<{ value: 'ALL' | UnsoldCartReportStatus; label: string }> = [
  { value: 'ALL', label: 'الكل' },
  { value: 'open', label: 'مفتوحة الآن' },
  { value: 'abandoned', label: 'متروكة بدون بيع' },
  { value: 'sold', label: 'بيعت الفاتورة' }
];

const EVENT_OPTIONS: Array<{ value: 'ALL' | UnsoldCartReportEvent; label: string }> = [
  { value: 'ALL', label: 'الكل' },
  { value: 'remove', label: 'حذف صنف' },
  { value: 'reduce', label: 'تقليل الكمية' },
  { value: 'clear', label: 'تفريغ الفاتورة' },
  { value: 'page_close', label: 'إغلاق أو تحديث الصفحة' },
  { value: 'logout', label: 'تسجيل خروج' },
  { value: 'crash', label: 'إغلاق مفاجئ' }
];

function formatCairoDateTime(iso: string): string {
  if (!iso) return '-';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(parsed);
  } catch {
    return iso;
  }
}

export const UnsoldCartItemsReportView: React.FC<UnsoldCartItemsReportViewProps> = ({
  user,
  userRole,
  users = []
}) => {
  const isDesigner =
    user?.role === 'designer' || userRole === 'designer' || Boolean(user?.isOwner);
  const canViewReport =
    isDesigner ||
    (user ? hasPermission(user, 'reports.unsold_cart_items.view') : userRole === 'manager');

  const { isOffline } = useOfflineMode();

  // الفلاتر (الفترة الافتراضية: اليوم)
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRangeForPreset('TODAY'));
  const [selectedUserId, setSelectedUserId] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | UnsoldCartReportStatus>('ALL');
  const [selectedEvent, setSelectedEvent] = useState<'ALL' | UnsoldCartReportEvent>('ALL');

  // حالة البيانات
  const [report, setReport] = useState<UnsoldCartItemsReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requiresInternet, setRequiresInternet] = useState<boolean>(false);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!canViewReport) return;
      if (isOffline) {
        setRequiresInternet(true);
        setErrorMessage(null);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      setRequiresInternet(false);
      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setErrorMessage(null);

      try {
        const data = await api.getUnsoldCartItemsReport({
          from: dateRange.from || undefined,
          to: dateRange.to || undefined,
          userId: selectedUserId !== 'ALL' ? selectedUserId : undefined,
          status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
          event: selectedEvent !== 'ALL' ? selectedEvent : undefined
        });
        setReport(data);
      } catch (err: any) {
        const msg = String(err?.message || '');
        const isOfflineError =
          isOffline ||
          (typeof navigator !== 'undefined' && navigator.onLine === false) ||
          /failed to fetch|network|offline|انقطاع|إنترنت/i.test(msg);
        if (isOfflineError) {
          setRequiresInternet(true);
          setErrorMessage(null);
        } else {
          setErrorMessage(msg || 'حدث خطأ أثناء تحميل التقرير');
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [canViewReport, isOffline, dateRange.from, dateRange.to, selectedUserId, selectedStatus, selectedEvent]
  );

  useEffect(() => {
    void loadReport(false);
  }, [loadReport]);

  // تحديث تلقائي كل 30 ثانية أثناء الاتصال
  useEffect(() => {
    if (!canViewReport || isOffline) return;
    const timer = window.setInterval(() => {
      void loadReport(true);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [canViewReport, isOffline, loadReport]);

  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) {
      if (u.id) {
        map.set(u.id, u.name || u.username || u.id);
      }
    }
    for (const u of report?.summary?.byUser || []) {
      if (u.userId && !map.has(u.userId)) {
        map.set(u.userId, u.userName || u.userId);
      }
    }
    for (const r of report?.rows || []) {
      if (r.userId && !map.has(r.userId)) {
        map.set(r.userId, r.userName || r.userId);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [users, report]);

  if (!canViewReport) {
    return (
      <PageSurface dir="rtl" title="أصناف لم تُبع من شاشة البيع">
        <div className="py-10 flex items-center gap-2 ui-stock-out text-sm font-bold">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>
            غير مصرح بعرض تقرير أصناف لم تُبع من شاشة البيع — يتطلب صلاحية reports.unsold_cart_items.view.
          </span>
        </div>
      </PageSurface>
    );
  }

  const rows = report?.rows || [];
  const summary = report?.summary;
  const byUser = summary?.byUser || [];
  const alerts = report?.alerts || [];

  const summaryRows: ReportSummaryRow[] = [
    {
      label: 'عدد السطور',
      value: summary ? summary.rows : 0
    },
    {
      label: 'إجمالي الكمية',
      value: summary ? summary.quantity : 0
    },
    {
      label: 'إجمالي القيمة',
      value: `${formatMoney(summary?.value)} ج.م`,
      valueClassName: 'ui-money-sale'
    },
    {
      label: 'عدد الفواتير المفتوحة الآن',
      value: summary ? summary.openCarts : 0,
      valueClassName: 'ui-link'
    }
  ];

  return (
    <PageSurface
      dir="rtl"
      title="أصناف لم تُبع من شاشة البيع"
      subtitle="متابعة الأصناف المحذوفة أو المخفّضة أو الفواتير المفتوحة والمتروكة في شاشة البيع"
    >
      {/* شريط الفلاتر المضغوط أعلى الصفحة */}
      <div className="flex flex-wrap items-end gap-3 pb-4 border-b border-[var(--border-subtle)]">
        <DateRangeFilter
          inline
          value={dateRange}
          onChange={setDateRange}
          defaultPreset="TODAY"
          showPresets={true}
        />

        <div className="no-print">
          <label
            htmlFor="unsold-cart-user-filter"
            className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
          >
            المستخدم
          </label>
          <select
            id="unsold-cart-user-filter"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
          >
            <option value="ALL">جميع المستخدمين</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div className="no-print">
          <label
            htmlFor="unsold-cart-status-filter"
            className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
          >
            الحالة
          </label>
          <select
            id="unsold-cart-status-filter"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as 'ALL' | UnsoldCartReportStatus)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} text-xs font-semibold`}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="no-print">
          <label
            htmlFor="unsold-cart-event-filter"
            className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
          >
            الحدث
          </label>
          <select
            id="unsold-cart-event-filter"
            value={selectedEvent}
            onChange={(e) => setSelectedEvent(e.target.value as 'ALL' | UnsoldCartReportEvent)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
          >
            {EVENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="no-print inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadReport(false)}
            disabled={isLoading || isRefreshing}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading || isRefreshing ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* حالة عدم توفر الاتصال */}
      {(isOffline || requiresInternet) && (
        <div role="status" className="py-6 flex items-center gap-2 text-sm font-bold ui-stock-out">
          <WifiOff className="w-5 h-5 shrink-0" />
          <span>التقرير يحتاج اتصالًا بالإنترنت</span>
        </div>
      )}

      {/* رسالة الخطأ */}
      {errorMessage && !isOffline && !requiresInternet && (
        <div role="alert" className="no-print text-xs font-bold ui-stock-out flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {!isOffline && !requiresInternet && (
        <>
          {/* ملخص المؤشرات الرقمية */}
          <section className="space-y-4">
            <SectionHeading
              title="ملخص المؤشرات الرقمية"
              actions={
                <span className="text-xs text-[var(--text-secondary)]">
                  عدد السطور المعروضة:{' '}
                  <strong className="text-[var(--text-primary)] tabular-nums">{rows.length}</strong>
                </span>
              }
            />
            <ReportSummaryTable rows={summaryRows} ariaLabel="ملخص تقرير أصناف لم تُبع من شاشة البيع" />
          </section>

          {/* الجدول الرئيسي */}
          <section className="space-y-4">
            <SectionHeading title="تفاصيل الأصناف والأحداث" withTopDivider />

            {isLoading ? (
              <div className="py-10 flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                <Loader2 className="w-4 h-4 ui-link animate-spin" />
                <span>جاري تحميل سجل شاشة البيع...</span>
              </div>
            ) : rows.length === 0 ? (
              <div className="py-8 text-xs text-[var(--text-secondary)] flex items-center gap-2">
                <PackageX className="w-4 h-4 shrink-0" />
                <span>لا توجد أصناف غير مباعة في هذه الفترة</span>
              </div>
            ) : (
              <CompactTable ariaLabel="جدول أصناف لم تُبع من شاشة البيع">
                <thead>
                  <tr>
                    <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>الوقت</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المستخدم</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصنف</th>
                    <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>الباركود</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الكمية</th>
                    <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>السعر</th>
                    <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>القيمة</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الحدث</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الحالة</th>
                    <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم الفاتورة</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المخزن</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المنصة</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={`${row.cartId}-${row.itemId}-${row.event}-${row.at}-${idx}`}>
                      <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        <div>{formatCairoDateTime(row.at)}</div>
                        {row.receivedLate && (
                          <div className="text-[11px] ui-link font-semibold whitespace-normal">
                            وصل متأخرًا (أوفلاين)
                          </div>
                        )}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{row.userName || '-'}</td>
                      <td className={`${COMPACT_TABLE_TEXT_CLASS} font-semibold`}>{row.itemName || '-'}</td>
                      <td className={`font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {row.barcode || '-'}
                      </td>
                      <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                        {row.quantity}
                      </td>
                      <td className={`text-left font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatMoney(row.unitPrice)}
                      </td>
                      <td className={`text-left font-mono font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatMoney(row.value)}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{row.eventLabel || '-'}</td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{row.cartStatusLabel || '-'}</td>
                      <td className={`font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                        {row.invoiceNumber || '-'}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{row.warehouseName || '-'}</td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{row.platform || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </CompactTable>
            )}
          </section>

          {/* ملخص حسب المستخدم */}
          <section className="space-y-4">
            <SectionHeading title="ملخص حسب المستخدم" withTopDivider />

            {byUser.length === 0 ? (
              <div className="py-4 text-xs text-[var(--text-secondary)]">
                لا توجد أصناف غير مباعة في هذه الفترة
              </div>
            ) : (
              <CompactTable ariaLabel="ملخص الأصناف غير المباعة حسب المستخدم">
                <thead>
                  <tr>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المستخدم</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>عدد السطور</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الكمية</th>
                    <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>القيمة</th>
                  </tr>
                </thead>
                <tbody>
                  {byUser.map((u) => (
                    <tr key={u.userId || u.userName}>
                      <td className={`${COMPACT_TABLE_TEXT_CLASS} font-semibold`}>{u.userName || '-'}</td>
                      <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>{u.rows}</td>
                      <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>{u.quantity}</td>
                      <td className={`text-left font-mono font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatMoney(u.value)} ج.م
                      </td>
                    </tr>
                  ))}
                </tbody>
              </CompactTable>
            )}
          </section>

          {/* قسم تنبيهات الأجهزة — يظهر فقط عند وجود تنبيهات */}
          {alerts.length > 0 && (
            <section className="space-y-4">
              <SectionHeading title="تنبيهات الأجهزة" withTopDivider />
              <CompactTable ariaLabel="تنبيهات أجهزة شاشة البيع">
                <thead>
                  <tr>
                    <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>الوقت</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>النوع</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المستخدم</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>التفاصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert) => (
                    <tr key={alert.id}>
                      <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatCairoDateTime(alert.at)}
                      </td>
                      <td className={`${COMPACT_TABLE_TEXT_CLASS} font-semibold ui-stock-out`}>
                        {alert.typeLabel}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{alert.userName || '-'}</td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{alert.detail || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </CompactTable>
            </section>
          )}
        </>
      )}
    </PageSurface>
  );
};

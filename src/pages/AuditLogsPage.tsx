import React, { useState, useEffect, useMemo } from 'react';
import { AuditLogEntry, UserAccount } from '../types';
import { api } from '../api/client';
import { DateRangeFilter } from '../components/DateRangeFilter';
import {
  DateRange,
  getDateRangeForPreset,
  isDateInRange,
  normalizeArabicText,
} from '../utils/dateUtils';
import {
  Search,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  Printer,
} from 'lucide-react';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ReportSummaryTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
  type ReportSummaryRow,
} from '../components/ui';

interface AuditLogsPageProps {
  users?: UserAccount[];
}

export const ACTION_LABELS: Record<string, string> = {
  ITEM_CREATE: 'إضافة صنف',
  ITEM_UPDATE: 'تعديل صنف',
  ITEM_EDIT: 'تعديل صنف',
  ITEM_STATUS_CHANGE: 'تغيير حالة صنف',
  ITEM_DELETE: 'حذف صنف',
  PRODUCTS_EXPORT: 'تصدير الأصناف إكسيل',
  PRODUCTS_BULK_EDIT_EXCEL: 'تعديل أسعار الأصناف بالإكسيل',
  INVOICE_CREATE: 'إنشاء فاتورة',
  INVOICE_EDIT: 'تعديل فاتورة',
  INVOICE_CANCEL: 'إلغاء فاتورة',
  RETURN_CREATE: 'تسجيل مرتجع',
  PURCHASE_CREATE: 'إنشاء فاتورة شراء',
  PURCHASE_CANCEL: 'إلغاء فاتورة شراء',
  PURCHASE_RETURN_CREATE: 'تسجيل مرتجع مشتريات',
  SUPPLIER_VOUCHER_CREATE: 'تسجيل سند مورد',
  CUSTOMER_VOUCHER_CREATE: 'تسجيل سند عميل',
  CASHBOX_TRANSFER: 'تحويل بين الخزائن',
  WAREHOUSE_TRANSFER: 'تحويل بين المخازن (أمر صرف)',
  USER_CREATE: 'إضافة مستخدم',
  USER_UPDATE: 'تعديل مستخدم',
  USER_STATUS: 'تغيير حالة مستخدم',
  PERMISSIONS_UPDATE: 'تغيير صلاحيات',
  SETTINGS_PRINT: 'إعدادات الطباعة',
  SETTINGS_COMPANY: 'إعدادات الشركة',
  SETTINGS_DISPLAY: 'إعدادات العرض',
  SETTINGS_SYSTEM: 'إعدادات النظام',
  SETTINGS_STOCK_POLICY: 'تعديل سياسة البيع بالسالب',
  SETTINGS_WAREHOUSE_TRANSFER_POLICY: 'تعديل سياسة التحويل بالسالب بين المخازن',
  STOCK_ADJUST: 'تسوية مخزون',
  RECONCILIATION_POST: 'ترحيل قيد مطابقة',
  LOGIN_SUCCESS: 'تسجيل دخول',
  LOGIN_FAILED: 'محاولة دخول فاشلة',
};

export function getActionLabel(action: string): string {
  if (!action) return '';
  return ACTION_LABELS[action] || action;
}

const PAGE_SIZE = 50;

export const AuditLogsPage: React.FC<AuditLogsPageProps> = ({ users: propUsers }) => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [usersList, setUsersList] = useState<UserAccount[]>(propUsers || []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [dateRange, setDateRange] = useState<DateRange>(() =>
    getDateRangeForPreset('LAST_7_DAYS')
  );
  const [selectedUserId, setSelectedUserId] = useState<string>('ALL');
  const [selectedAction, setSelectedAction] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);

  // Sync users from props or fetch if not provided
  useEffect(() => {
    if (propUsers && propUsers.length > 0) {
      setUsersList(propUsers);
    } else {
      api
        .getUsers()
        .then((res) => {
          if (res.success && res.users) {
            setUsersList(res.users);
          }
        })
        .catch(() => {});
    }
  }, [propUsers]);

  // Debounce search query (400ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset pagination when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [dateRange.from, dateRange.to, selectedUserId, selectedAction, debouncedQuery]);

  const fetchLogs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getAuditLogs({
        from: dateRange.from,
        to: dateRange.to,
        userId: selectedUserId !== 'ALL' ? selectedUserId : undefined,
        action: selectedAction !== 'ALL' ? selectedAction : undefined,
        q: debouncedQuery.trim() || undefined,
      });
      if (res.success && res.logs) {
        setLogs(res.logs);
      }
    } catch (err: any) {
      setError(err.message || 'فشل جلب سجلات التدقيق');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [dateRange.from, dateRange.to, selectedUserId, selectedAction, debouncedQuery]);

  // Collect all available action keys
  const actionOptions = useMemo(() => {
    const keys = new Set<string>(Object.keys(ACTION_LABELS));
    for (const log of logs) {
      if (log.action) keys.add(log.action);
    }
    return Array.from(keys);
  }, [logs]);

  // Collect all users
  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of usersList) {
      if (u.id) map.set(u.id, u.name || u.username);
    }
    for (const l of logs) {
      if (l.actorId && !map.has(l.actorId)) {
        map.set(l.actorId, l.actorName || l.actorId);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [usersList, logs]);

  // Client-side filtering
  const filteredLogs = useMemo(() => {
    const normQ = normalizeArabicText(searchQuery);
    return logs.filter((l) => {
      if (!isDateInRange(l.timestamp, dateRange.from, dateRange.to)) {
        return false;
      }
      if (selectedUserId !== 'ALL') {
        const selectedUserObj = usersList.find((u) => u.id === selectedUserId);
        const matchesId = l.actorId === selectedUserId;
        const matchesName =
          selectedUserObj &&
          (l.actorName === selectedUserObj.name ||
            l.actorName === selectedUserObj.username);
        if (!matchesId && !matchesName) return false;
      }
      if (selectedAction !== 'ALL' && l.action !== selectedAction) {
        return false;
      }
      if (normQ) {
        const haystack = normalizeArabicText(
          `${l.details || ''} ${l.targetId || ''} ${l.targetType || ''} ${l.actorName || ''} ${l.action || ''} ${getActionLabel(l.action)}`
        );
        if (!haystack.includes(normQ)) return false;
      }
      return true;
    });
  }, [logs, dateRange.from, dateRange.to, selectedUserId, selectedAction, searchQuery, usersList]);

  const displayedLogs = useMemo(
    () => filteredLogs.slice(0, visibleCount),
    [filteredLogs, visibleCount]
  );

  const periodLabel = useMemo(() => {
    if (dateRange.from && dateRange.to) {
      return `من ${dateRange.from} إلى ${dateRange.to}`;
    }
    if (dateRange.from) return `من ${dateRange.from}`;
    if (dateRange.to) return `حتى ${dateRange.to}`;
    return 'كل الفترات';
  }, [dateRange.from, dateRange.to]);

  const summaryRows: ReportSummaryRow[] = [
    {
      label: 'إجمالي السجلات المطابقة',
      value: `${filteredLogs.length} نشاط`,
    },
    {
      label: 'المعروض حالياً',
      value: `${displayedLogs.length} نشاط`,
    },
  ];

  return (
    <PageSurface
      dir="rtl"
      title="سجل التدقيق والمتابعة"
      subtitle={`توثيق زمني غير قابل للتعديل لكافة العمليات الحساسة وتغيير الصلاحيات والجلسات (${periodLabel})`}
    >
      {/* صف الفلاتر المضغوط مع الطباعة والتحديث */}
      <div className="flex flex-wrap items-end gap-3 pb-4 border-b border-[var(--border-subtle)]">
        <DateRangeFilter
          inline
          value={dateRange}
          onChange={setDateRange}
          storageKey="audit_logs"
          defaultPreset="LAST_7_DAYS"
        />

        <div className="no-print flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="audit-user-filter"
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              المستخدم
            </label>
            <select
              id="audit-user-filter"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
            >
              <option value="ALL">الكل (جميع المستخدمين)</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="audit-action-filter"
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              نوع الإجراء
            </label>
            <select
              id="audit-action-filter"
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
            >
              <option value="ALL">الكل (جميع الإجراءات)</option>
              {actionOptions.map((actKey) => (
                <option key={actKey} value={actKey}>
                  {getActionLabel(actKey)} {ACTION_LABELS[actKey] ? `(${actKey})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="audit-search-input"
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              بحث في الوصف والمرجع
            </label>
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 pointer-events-none" />
              <input
                id="audit-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="الوصف أو رقم المرجع..."
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} pr-9 text-xs`}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-semibold transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة</span>
          </button>

          <button
            type="button"
            onClick={fetchLogs}
            disabled={isLoading}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>تحديث السجل</span>
          </button>
        </div>

        {(selectedUserId !== 'ALL' || selectedAction !== 'ALL' || searchQuery.trim() !== '') && (
          <div className="print-only print-filter-summary">
            المستخدم:{' '}
            {selectedUserId === 'ALL'
              ? 'الكل'
              : userOptions.find((u) => u.id === selectedUserId)?.name || selectedUserId}{' '}
            • الإجراء: {selectedAction === 'ALL' ? 'الكل' : getActionLabel(selectedAction)}
            {searchQuery.trim() ? ` • البحث: ${searchQuery.trim()}` : ''}
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="no-print text-xs font-bold ui-stock-out flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <SectionHeading title={`ملخص السجل (${periodLabel})`} />
      <ReportSummaryTable rows={summaryRows} ariaLabel="ملخص سجلات التدقيق" />

      <SectionHeading title="سجل العمليات الزمني" />
      <CompactTable ariaLabel="جدول سجل التدقيق والمتابعة">
        <thead>
          <tr>
            <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>التاريخ والوقت</th>
            <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الفاعل (المستخدم)</th>
            <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الدور</th>
            <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>نوع الإجراء</th>
            <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>الهدف / المرجع</th>
            <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>تفاصيل التغيير</th>
          </tr>
        </thead>
        <tbody>
          {displayedLogs.map((log) => {
            const formattedDate = new Date(log.timestamp).toLocaleString('ar-EG', {
              dateStyle: 'short',
              timeStyle: 'medium',
            });
            const arabicAction = getActionLabel(log.action);
            const roleClass =
              log.actorRole === 'designer'
                ? 'ui-stock-low'
                : log.actorRole === 'manager'
                ? 'ui-link'
                : 'text-[var(--text-secondary)]';

            return (
              <tr key={log.id}>
                <td className={`font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                  {formattedDate}
                </td>
                <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                  {log.actorName}
                </td>
                <td className={`text-center font-bold ${roleClass} ${COMPACT_TABLE_NUM_CLASS}`}>
                  {log.actorRole}
                </td>
                <td className={COMPACT_TABLE_TEXT_CLASS}>
                  <div className="font-bold ui-link">{arabicAction}</div>
                  {arabicAction !== log.action && (
                    <div className="text-[11px] font-mono text-[var(--text-secondary)]">
                      {log.action}
                    </div>
                  )}
                </td>
                <td className={`font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                  {log.targetType} {log.targetId ? `(${log.targetId})` : ''}
                </td>
                <td className={COMPACT_TABLE_TEXT_CLASS}>{log.details}</td>
              </tr>
            );
          })}

          {displayedLogs.length === 0 && !isLoading && (
            <tr>
              <td colSpan={6} className="text-center text-[var(--text-secondary)] py-8">
                لا توجد سجلات تدقيق مطابقة للفترة أو الفلاتر المحددة
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="text-right font-bold" colSpan={6}>
              المعروض حاليًا: {displayedLogs.length} من أصل {filteredLogs.length} نشاط
            </td>
          </tr>
        </tfoot>
      </CompactTable>

      {visibleCount < filteredLogs.length && (
        <div className="no-print">
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer"
          >
            <ChevronDown className="w-4 h-4" />
            <span>عرض المزيد ({Math.min(PAGE_SIZE, filteredLogs.length - visibleCount)})</span>
          </button>
        </div>
      )}
    </PageSurface>
  );
};

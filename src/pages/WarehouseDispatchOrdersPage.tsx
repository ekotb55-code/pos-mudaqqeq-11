import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  ClipboardList,
  Search,
  RefreshCw,
  Eye,
  Printer,
  X,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Loader2,
  ArrowLeftRight
} from 'lucide-react';
import { api } from '../api/client';
import {
  CompanySettings,
  UserAccount,
  Warehouse,
  WarehouseDispatchOrder
} from '../types';
import { hasPermission } from '../utils/permissions';
import {
  DatePresetKey,
  formatMoney,
  getDateRangeForPreset
} from '../utils/dateUtils';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ModalShell,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
} from '../components/ui';
import { getHrefForTarget, isPlainLeftClick } from '../config/navigation';

interface WarehouseDispatchOrdersPageProps {
  user: UserAccount;
  companySettings?: CompanySettings;
  onNavigateToNewTransfer?: () => void;
}

const PAGE_SIZE = 20;

function formatCairoDateTime(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const datePart = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);
    const timePart = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(d);
    return `${datePart} ${timePart}`;
  } catch {
    return iso;
  }
}

export const WarehouseDispatchOrdersPage: React.FC<WarehouseDispatchOrdersPageProps> = ({
  user,
  companySettings,
  onNavigateToNewTransfer
}) => {
  const canViewPurchase =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'prices.view_purchase');

  const canCreateTransfer =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'warehouses.transfer');

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [orders, setOrders] = useState<WarehouseDispatchOrder[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters
  const [dispatchNumberFilter, setDispatchNumberFilter] = useState<string>('');
  const [fromWarehouseFilter, setFromWarehouseFilter] = useState<string>('ALL');
  const [toWarehouseFilter, setToWarehouseFilter] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // Details & Print
  const [selectedOrder, setSelectedOrder] = useState<WarehouseDispatchOrder | null>(null);
  const [printOrder, setPrintOrder] = useState<WarehouseDispatchOrder | null>(null);
  const [printRootEl, setPrintRootEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let el = document.getElementById('print-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'print-root';
      document.body.appendChild(el);
    }
    setPrintRootEl(el);
  }, []);

  useEffect(() => {
    api.getWarehouseTransferContext()
      .then(res => {
        if (res.success && Array.isArray(res.allWarehouses)) {
          setWarehouses(res.allWarehouses);
        }
      })
      .catch(() => {});
  }, []);

  const fetchOrders = useCallback(
    async (targetPage: number) => {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const res = await api.getWarehouseTransfers({
          dispatchNumber: dispatchNumberFilter.trim() || undefined,
          fromWarehouseId: fromWarehouseFilter !== 'ALL' ? fromWarehouseFilter : undefined,
          toWarehouseId: toWarehouseFilter !== 'ALL' ? toWarehouseFilter : undefined,
          from: fromDate || null,
          to: toDate || null,
          page: targetPage,
          pageSize: PAGE_SIZE
        });
        if (!res.success) {
          setErrorMsg(res.error || 'تعذر جلب أوامر الصرف');
          setOrders([]);
          return;
        }
        setOrders(res.orders || []);
        setTotal(Number(res.total || 0));
        setPage(Number(res.page || targetPage));
        setTotalPages(Math.max(1, Number(res.totalPages || 1)));
      } catch (err: any) {
        setErrorMsg(err.message || 'حدث خطأ أثناء تحميل أوامر الصرف');
      } finally {
        setIsLoading(false);
      }
    },
    [dispatchNumberFilter, fromWarehouseFilter, toWarehouseFilter, fromDate, toDate]
  );

  useEffect(() => {
    void fetchOrders(page);
  }, [fetchOrders, page]);

  const handleApplyPreset = (preset: DatePresetKey) => {
    const range = getDateRangeForPreset(preset);
    setFromDate(range.from || '');
    setToDate(range.to || '');
    setPage(1);
  };

  const handleResetFilters = () => {
    setDispatchNumberFilter('');
    setFromWarehouseFilter('ALL');
    setToWarehouseFilter('ALL');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const handlePrintOrder = (order: WarehouseDispatchOrder) => {
    setPrintOrder(order);
    document.body.classList.add('printing-receipt');
    setTimeout(() => {
      try {
        window.print();
      } catch (_) {
        document.body.classList.remove('printing-receipt');
        setPrintOrder(null);
      } finally {
        setTimeout(() => {
          document.body.classList.remove('printing-receipt');
        }, 300);
      }
    }, 80);
  };

  useEffect(() => {
    const handleAfterPrint = () => {
      document.body.classList.remove('printing-receipt');
      setPrintOrder(null);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      document.body.classList.remove('printing-receipt');
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  const dateInvalid = useMemo(() => {
    return Boolean(fromDate && toDate && fromDate > toDate);
  }, [fromDate, toDate]);

  return (
    <PageSurface
      dir="rtl"
      title="عرض أوامر الصرف"
      subtitle="متابعة وفحص وطباعة أوامر الصرف والتحويلات المنفذة بين المخازن (بتوقيت القاهرة)"
      actions={
        <>
          <button
            type="button"
            onClick={() => void fetchOrders(page)}
            disabled={isLoading}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>

          {canCreateTransfer && onNavigateToNewTransfer && (
            <a
              href={getHrefForTarget('warehouse_transfers')}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return;
                e.preventDefault();
                onNavigateToNewTransfer();
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer whitespace-nowrap"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>تحويل جديد بين المخازن</span>
            </a>
          )}
        </>
      }
    >
      {/* صف فلاتر مضغوط يبدأ من بداية السطر */}
      <div className="space-y-3 pb-4 border-b border-[var(--border-subtle)]">
        <div className="no-print flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="filter-dispatch-number"
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              رقم الصرف / بحث
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="filter-dispatch-number"
                type="text"
                value={dispatchNumberFilter}
                onChange={e => {
                  setDispatchNumberFilter(e.target.value);
                  setPage(1);
                }}
                placeholder="مثال: DSP-0001"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} pr-9 text-xs font-bold`}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="filter-from-warehouse"
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              من مخزن
            </label>
            <select
              id="filter-from-warehouse"
              value={fromWarehouseFilter}
              onChange={e => {
                setFromWarehouseFilter(e.target.value);
                setPage(1);
              }}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
            >
              <option value="ALL">كل المخازن</option>
              {warehouses.map(wh => (
                <option key={wh.id} value={wh.id}>
                  {wh.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="filter-to-warehouse"
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              إلى مخزن
            </label>
            <select
              id="filter-to-warehouse"
              value={toWarehouseFilter}
              onChange={e => {
                setToWarehouseFilter(e.target.value);
                setPage(1);
              }}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
            >
              <option value="ALL">كل المخازن</option>
              {warehouses.map(wh => (
                <option key={wh.id} value={wh.id}>
                  {wh.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="filter-from-date"
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              من تاريخ
            </label>
            <input
              id="filter-from-date"
              type="date"
              dir="ltr"
              value={fromDate}
              onChange={e => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} text-xs font-mono`}
            />
          </div>

          <div>
            <label
              htmlFor="filter-to-date"
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              إلى تاريخ
            </label>
            <input
              id="filter-to-date"
              type="date"
              dir="ltr"
              value={toDate}
              onChange={e => {
                setToDate(e.target.value);
                setPage(1);
              }}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} text-xs font-mono`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleApplyPreset('TODAY')}
              className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
            >
              اليوم
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('LAST_7_DAYS')}
              className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
            >
              7 أيام
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('THIS_MONTH')}
              className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
            >
              هذا الشهر
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('ALL')}
              className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
            >
              الكل
            </button>
            {(dispatchNumberFilter ||
              fromWarehouseFilter !== 'ALL' ||
              toWarehouseFilter !== 'ALL' ||
              fromDate ||
              toDate) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-out text-xs font-bold cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>مسح</span>
              </button>
            )}
          </div>
        </div>

        <div className="text-xs font-semibold text-[var(--text-secondary)]">
          إجمالي النتائج:{' '}
          <strong className="font-mono tabular-nums text-[var(--text-primary)]">{total}</strong>
        </div>

        <div className="print-only print-filter-summary">
          {[
            dispatchNumberFilter ? `رقم الصرف: ${dispatchNumberFilter}` : null,
            fromWarehouseFilter !== 'ALL'
              ? `من مخزن: ${warehouses.find(w => w.id === fromWarehouseFilter)?.name || fromWarehouseFilter}`
              : null,
            toWarehouseFilter !== 'ALL'
              ? `إلى مخزن: ${warehouses.find(w => w.id === toWarehouseFilter)?.name || toWarehouseFilter}`
              : null,
            fromDate || toDate ? `الفترة: ${fromDate || 'البداية'} إلى ${toDate || 'الآن'}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'جميع أوامر الصرف'}
        </div>

        {dateInvalid && (
          <div className="no-print text-xs font-bold ui-stock-low">
            تنبيه: «من تاريخ» أحدث من «إلى تاريخ».
          </div>
        )}
      </div>

      <SectionHeading title={`سجل أوامر الصرف (${total})`} />

      {isLoading ? (
        <div className="py-12 text-center space-y-2 text-[var(--text-secondary)]">
          <Loader2 className="w-7 h-7 mx-auto animate-spin text-[var(--accent)]" />
          <p className="text-xs font-bold">جاري تحميل أوامر الصرف...</p>
        </div>
      ) : errorMsg ? (
        <div className="no-print py-8 text-center space-y-3">
          <AlertTriangle className="w-7 h-7 ui-stock-out mx-auto" />
          <p className="text-xs font-bold ui-stock-out">{errorMsg}</p>
          <button
            type="button"
            onClick={() => void fetchOrders(page)}
            className="min-h-[44px] px-4 rounded-lg bg-[#1668B2] text-white text-xs font-bold cursor-pointer"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="py-12 text-center space-y-3 text-[var(--text-secondary)]">
          <ClipboardList className="w-9 h-9 mx-auto opacity-50" />
          <p className="text-sm font-bold text-[var(--text-primary)]">لا توجد أوامر صرف مطابقة</p>
          {canCreateTransfer && onNavigateToNewTransfer && (
            <a
              href={getHrefForTarget('warehouse_transfers')}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return;
                e.preventDefault();
                onNavigateToNewTransfer();
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] text-white text-xs font-bold cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>إجراء تحويل جديد</span>
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <CompactTable ariaLabel="جدول أوامر الصرف">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم الصرف</th>
                <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>التاريخ</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>من مخزن</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>إلى مخزن</th>
                {canViewPurchase && (
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>إجمالي سعر الشراء</th>
                )}
                <th className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => (
                <tr key={order.id}>
                  <td className={`font-mono font-bold ui-link ${COMPACT_TABLE_NUM_CLASS}`}>
                    {order.dispatchNumber}
                  </td>
                  <td className={`font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                    {formatCairoDateTime(order.date)}
                  </td>
                  <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                    {order.fromWarehouseName}
                  </td>
                  <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                    {order.toWarehouseName}
                  </td>
                  {canViewPurchase && (
                    <td className={`text-center font-mono font-bold text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {formatMoney(order.totalPurchaseValue || 0)} ج.م
                    </td>
                  )}
                  <td className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedOrder(order)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs transition cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>التفاصيل</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </CompactTable>

          {totalPages > 1 && (
            <div className="no-print pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-[var(--text-secondary)] font-mono tabular-nums">
                صفحة {page} من {totalPages} ({total} أمر صرف)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>السابق</span>
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Details Modal */}
      {selectedOrder && (
        <ModalShell
          title={`تفاصيل أمر الصرف ${selectedOrder.dispatchNumber}`}
          subtitle={`${formatCairoDateTime(selectedOrder.date)} · بواسطة: ${selectedOrder.userName}`}
          onClose={() => setSelectedOrder(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
              >
                إغلاق
              </button>
              <button
                type="button"
                onClick={() => handlePrintOrder(selectedOrder)}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة</span>
              </button>
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]">
            <span>
              من مخزن: <strong className="text-[var(--text-primary)]">{selectedOrder.fromWarehouseName}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              إلى مخزن: <strong className="text-[var(--text-primary)]">{selectedOrder.toWarehouseName}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              الأصناف / الكمية:{' '}
              <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                {selectedOrder.itemsCount} صنف · {selectedOrder.totalQuantity} قطعة
              </strong>
            </span>
            {canViewPurchase && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  إجمالي الشراء:{' '}
                  <strong className="font-mono tabular-nums ui-money-purchase">
                    {formatMoney(selectedOrder.totalPurchaseValue || 0)} ج.م
                  </strong>
                </span>
              </>
            )}
          </div>

          {selectedOrder.notes && (
            <p className="text-xs text-[var(--text-secondary)] border-t border-[var(--border-subtle)] pt-2">
              <strong className="text-[var(--text-primary)]">ملاحظات: </strong>
              {selectedOrder.notes}
            </p>
          )}

          <CompactTable ariaLabel="أصناف أمر الصرف">
            <thead>
              <tr>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>#</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصنف</th>
                <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>الباركود</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الوصف</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الكمية</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الوحدة</th>
                {canViewPurchase && (
                  <>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>سعر الشراء</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الإجمالي</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {(selectedOrder.lines || []).map((line, idx) => (
                <tr key={`${line.itemId}-${idx}`}>
                  <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                    {idx + 1}
                  </td>
                  <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                    {line.itemName}
                  </td>
                  <td className={`font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                    {line.barcode || line.sku || '—'}
                  </td>
                  <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                    {line.notes || '—'}
                  </td>
                  <td className={`text-center font-mono font-bold text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                    {line.quantity}
                  </td>
                  <td className={`text-center text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                    {line.unit || 'قطعة'}
                  </td>
                  {canViewPurchase && (
                    <>
                      <td className={`text-center font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatMoney(line.purchasePriceAtTransfer || 0)}
                      </td>
                      <td className={`text-center font-mono font-bold ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatMoney(line.lineTotalPurchase || 0)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </CompactTable>
        </ModalShell>
      )}

      {/* Printable Dispatch Order Voucher Portal (#print-root) */}
      {printOrder &&
        printRootEl &&
        createPortal(
          <div className="receipt-print-area p-6 text-black bg-white" dir="rtl">
            <div className="border-b-2 border-black pb-3 mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-extrabold">
                  {companySettings?.storeName || 'نظام إدارة المخازن ونقاط البيع'}
                </h2>
                <p className="text-sm font-bold mt-1">أمر صرف وتحويل مخزني</p>
              </div>
              <div className="text-left text-xs space-y-1 font-mono tabular-nums">
                <div>رقم الصرف: {printOrder.dispatchNumber}</div>
                <div>التاريخ: {formatCairoDateTime(printOrder.date)}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 border border-black p-3 mb-4 text-xs">
              <div>
                <strong>من مخزن: </strong>
                {printOrder.fromWarehouseName}
              </div>
              <div>
                <strong>إلى مخزن: </strong>
                {printOrder.toWarehouseName}
              </div>
              <div>
                <strong>المسؤول: </strong>
                {printOrder.userName}
              </div>
            </div>

            {printOrder.notes && (
              <div className="border border-black p-2.5 mb-4 text-xs">
                <strong>ملاحظات: </strong>
                {printOrder.notes}
              </div>
            )}

            <table className="receipt-table w-full text-xs mb-4">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الصنف</th>
                  <th>الباركود</th>
                  <th>الوصف</th>
                  <th>الكمية</th>
                  <th>الوحدة</th>
                  {canViewPurchase && (
                    <>
                      <th>سعر الشراء</th>
                      <th>الإجمالي</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {(printOrder.lines || []).map((line, i) => (
                  <tr key={`${line.itemId}-${i}`}>
                    <td>{i + 1}</td>
                    <td>{line.itemName}</td>
                    <td className="font-mono">{line.barcode || line.sku || '—'}</td>
                    <td>{line.notes || '—'}</td>
                    <td className="font-mono">{line.quantity}</td>
                    <td>{line.unit || 'قطعة'}</td>
                    {canViewPurchase && (
                      <>
                        <td className="font-mono">{formatMoney(line.purchasePriceAtTransfer || 0)}</td>
                        <td className="font-mono">{formatMoney(line.lineTotalPurchase || 0)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center justify-between border-t border-black pt-3 text-xs font-bold">
              <span>عدد الأصناف: {printOrder.itemsCount} · إجمالي الكمية: {printOrder.totalQuantity}</span>
              {canViewPurchase && (
                <span>إجمالي سعر الشراء: {formatMoney(printOrder.totalPurchaseValue || 0)} ج.م</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-8 mt-10 text-xs text-center">
              <div className="border-t border-black pt-2">توقيع أمين المخزن المحوِّل</div>
              <div className="border-t border-black pt-2">توقيع المستلم بالمخزن المحوَّل إليه</div>
            </div>
          </div>,
          printRootEl
        )}
    </PageSurface>
  );
};

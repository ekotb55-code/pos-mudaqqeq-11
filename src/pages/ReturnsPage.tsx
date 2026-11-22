import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { ReturnRecord, Invoice, Item, Cashbox, UserAccount, BarcodeScanQuantityMode } from '../types';
import { api } from '../api/client';
import { generateIdempotencyKey } from '../utils/idempotency';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { DateRange, getDateRangeForPreset, isDateInRange, normalizeArabicText } from '../utils/dateUtils';
import {
  RotateCcw,
  Search,
  Plus,
  AlertCircle,
  Save,
  Download,
  Printer,
  RefreshCw
} from 'lucide-react';
import { SalesReturnTerminalView } from '../components/SalesReturnTerminalView';
import { useUserWarehouses } from '../hooks/useUserWarehouses';
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
import { ShortcutBadge } from '../context/KeyboardShortcutsContext';

interface ReturnsPageProps {
  returns: ReturnRecord[];
  invoices: Invoice[];
  items: Item[];
  user?: UserAccount | null;
  barcodeScanMode?: BarcodeScanQuantityMode;
  latestItemFirst?: boolean;
  onCreateReturn: (returnData: any) => Promise<void>;
  preselectedInvoice?: Invoice | null;
  onClearPreselectedInvoice?: () => void;
}

export const ReturnsPage: React.FC<ReturnsPageProps> = ({
  returns,
  invoices,
  items,
  user = null,
  barcodeScanMode,
  latestItemFirst = false,
  onCreateReturn,
  preselectedInvoice,
  onClearPreselectedInvoice
}) => {
  const isDesigner = user?.role === 'designer' || Boolean(user?.isOwner);
  const {
    activeAllowedWarehouses,
    defaultWarehouseId,
    canChooseWarehouse
  } = useUserWarehouses(user);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRangeForPreset('THIS_MONTH'));
  const [isCreateMode, setIsCreateMode] = useState<boolean>(Boolean(preselectedInvoice));
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [selectedInvoiceNumber, setSelectedInvoiceNumber] = useState(preselectedInvoice?.invoiceNumber || '');
  const [returnLinesState, setReturnLinesState] = useState<Array<{
    invoiceLineIndex: number;
    itemId: string;
    itemName: string;
    originalQuantity: number;
    previouslyReturned: number;
    maxQuantity: number;
    returnedQuantity: number;
    returnShippingDeductionPerUnit: number;
    itemCondition: 'يرجع المخزن' | 'تالف';
  }>>([]);
  const [returnReason, setReturnReason] = useState('استرجاع عميل منصة');
  const [refundStatus, setRefundStatus] = useState<'قيد على الحساب' | 'استرداد نقدي'>('قيد على الحساب');
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUnknownResultError, setIsUnknownResultError] = useState(false);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

  useEffect(() => {
    if (activeAllowedWarehouses.length === 0) return;
    if (!selectedWarehouseId || !activeAllowedWarehouses.some(w => w.id === selectedWarehouseId)) {
      setSelectedWarehouseId(defaultWarehouseId || activeAllowedWarehouses[0].id);
    }
  }, [activeAllowedWarehouses, defaultWarehouseId, selectedWarehouseId]);

  // تصفية الخزائن المسموحة للمرتجعات بحسب تعيينات المصمم
  const allowedReturnCashboxes = useMemo(() => {
    const active = cashboxes.filter(c => c.status !== 'inactive' && (c.status as any) !== 'موقوفة');
    if (isDesigner) return active;
    const allowedIds = user?.cashboxConfig?.allowedReturnCashboxIds;
    if (allowedIds && allowedIds.length > 0) {
      return active.filter(c => allowedIds.includes(c.id));
    }
    return active;
  }, [cashboxes, isDesigner, user?.cashboxConfig?.allowedReturnCashboxIds]);

  useEffect(() => {
    api.getCashboxes().then(res => {
      if (res.success && res.cashboxes) {
        setCashboxes(res.cashboxes);
        const active = res.cashboxes.filter((c: any) => c.status !== 'inactive' && c.status !== 'موقوفة');
        const defaultId = user?.cashboxConfig?.defaultReturnCashboxId;
        const allowedIds = user?.cashboxConfig?.allowedReturnCashboxIds;

        if (defaultId && active.some((c: any) => c.id === defaultId) && (!allowedIds || allowedIds.length === 0 || allowedIds.includes(defaultId))) {
          setSelectedCashboxId(defaultId);
        } else if (allowedIds && allowedIds.length > 0) {
          const firstAllowed = active.find((c: any) => allowedIds.includes(c.id));
          if (firstAllowed) setSelectedCashboxId(firstAllowed.id);
        } else if (active.length > 0) {
          setSelectedCashboxId(active[0].id);
        }
      }
    }).catch(() => {});
  }, [user]);

  // تحديث أسطر الفاتورة عند اختيار الفاتورة مع احتساب الكميات المرتجعة سابقاً بدقة
  const handleSelectInvoice = (invNum: string) => {
    setSelectedInvoiceNumber(invNum);
    setErrorMsg(null);
    setIsUnknownResultError(false);
    idempotencyKeyRef.current = generateIdempotencyKey();
    const inv = invoices.find(i => i.invoiceNumber === invNum);
    if (inv && inv.lines) {
      const prevReturns = returns.filter(r => r.invoiceNumber === invNum);
      setReturnLinesState(
        inv.lines.map((line, idx) => {
          const previouslyReturned = prevReturns.reduce((sum, r) => {
            const match = r.lines?.find(l => l.itemId === line.itemId || l.invoiceLineIndex === idx + 1);
            return sum + (match ? match.returnedQuantity : 0);
          }, 0);
          const remainingReturnable = Math.max(0, line.quantity - previouslyReturned);

          return {
            invoiceLineIndex: idx + 1,
            itemId: line.itemId,
            itemName: line.itemNameAtSale,
            originalQuantity: line.quantity,
            previouslyReturned,
            maxQuantity: remainingReturnable,
            returnedQuantity: 0,
            returnShippingDeductionPerUnit: 25,
            itemCondition: 'يرجع المخزن'
          };
        })
      );

      if (inv.warehouseId && activeAllowedWarehouses.some(w => w.id === inv.warehouseId)) {
        setSelectedWarehouseId(inv.warehouseId);
      }

      if (inv.paymentType === 'نقدي' || (inv.paidAmount && inv.paidAmount > 0)) {
        setRefundStatus('استرداد نقدي');
        if (inv.cashboxId) setSelectedCashboxId(inv.cashboxId);
      } else {
        setRefundStatus('قيد على الحساب');
      }
    } else {
      setReturnLinesState([]);
    }
  };

  useEffect(() => {
    if (preselectedInvoice) {
      setIsCreateMode(true);
      handleSelectInvoice(preselectedInvoice.invoiceNumber);
    }
  }, [preselectedInvoice]);

  const updateLineQty = (index: number, qty: number) => {
    setReturnLinesState(prev => prev.map((l, i) => {
      if (i === index) {
        const valid = Math.max(0, Math.min(qty, l.maxQuantity));
        return { ...l, returnedQuantity: valid };
      }
      return l;
    }));
  };

  const updateLineCondition = (index: number, cond: 'يرجع المخزن' | 'تالف') => {
    setReturnLinesState(prev => prev.map((l, i) => i === index ? { ...l, itemCondition: cond } : l));
  };

  const updateLineDeduction = (index: number, ded: number) => {
    setReturnLinesState(prev => prev.map((l, i) => i === index ? { ...l, returnShippingDeductionPerUnit: Math.max(0, ded) } : l));
  };

  const activeLines = returnLinesState.filter(l => l.returnedQuantity > 0);
  const totalReturnCount = activeLines.reduce((s, l) => s + l.returnedQuantity, 0);
  const totalDeduction = activeLines.reduce((s, l) => s + (l.returnedQuantity * l.returnShippingDeductionPerUnit), 0);

  const submitReturn = async () => {
    if (totalReturnCount === 0) {
      setErrorMsg('يرجى تحديد كمية صنف واحد على الأقل للمرتجع');
      return;
    }

    const inv = invoices.find(i => i.invoiceNumber === selectedInvoiceNumber);
    if (!inv) {
      setErrorMsg('يرجى اختيار فاتورة صالحة');
      return;
    }

    if (refundStatus === 'استرداد نقدي' && !selectedCashboxId) {
      setErrorMsg('يجب اختيار خزينة الصرف لرد المبلغ نقدًا للمرتجع');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setIsUnknownResultError(false);

    try {
      const isPartial = totalReturnCount < inv.lines.reduce((s, l) => s + l.quantity, 0);

      await onCreateReturn({
        invoiceNumber: selectedInvoiceNumber,
        warehouseId: selectedWarehouseId || undefined,
        returnReason,
        refundStatus,
        cashboxId: refundStatus === 'استرداد نقدي' ? selectedCashboxId : undefined,
        idempotencyKey: idempotencyKeyRef.current,
        notes: notes.trim(),
        isPartial,
        lines: activeLines
      });

      idempotencyKeyRef.current = generateIdempotencyKey();
      setIsModalOpen(false);
      setReturnLinesState([]);
      setSelectedInvoiceNumber('');
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء حفظ المرتجع');
      setIsUnknownResultError(err?.code === 'UNKNOWN_RESULT');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitReturn();
  };

  const filteredReturns = useMemo(() => {
    const normQ = normalizeArabicText(searchQuery);
    return returns.filter(ret => {
      if (!isDateInRange(ret.date, dateRange.from, dateRange.to)) {
        return false;
      }
      if (!normQ) return true;
      const haystack = normalizeArabicText(
        `${ret.returnNumber || ''} ${ret.invoiceNumber || ''} ${ret.returnReason || ''} ${ret.returnedItemsSummary || ''} ${ret.createdBy || ''}`
      );
      return haystack.includes(normQ);
    });
  }, [returns, searchQuery, dateRange.from, dateRange.to]);

  const periodLabel = useMemo(() => {
    if (dateRange.from && dateRange.to) return `من ${dateRange.from} إلى ${dateRange.to}`;
    if (dateRange.from) return `من ${dateRange.from}`;
    if (dateRange.to) return `حتى ${dateRange.to}`;
    return 'كل الفترات';
  }, [dateRange.from, dateRange.to]);

  const periodStats = useMemo(() => {
    const count = filteredReturns.length;
    const totalReturnedUnits = filteredReturns.reduce(
      (sum, r) => sum + (r.lines || []).reduce((ls, l) => ls + (l.returnedQuantity || 0), 0),
      0
    );
    const totalDeductionSum = filteredReturns.reduce(
      (sum, r) => sum + (r.totalReturnShippingDeduction || 0),
      0
    );
    return { count, totalReturnedUnits, totalDeductionSum };
  }, [filteredReturns]);

  const handleExportReturns = () => {
    if (filteredReturns.length === 0) return;
    const rows = filteredReturns.map(ret => ({
      'رقم المرتجع': ret.returnNumber,
      'رقم الفاتورة': ret.invoiceNumber,
      'التاريخ': ret.date.slice(0, 10),
      'الأصناف المرتجعة': ret.returnedItemsSummary,
      'سبب الرجوع': ret.returnReason,
      'إجمالي خصم الشحن': ret.totalReturnShippingDeduction,
      'حالة التسوية': ret.refundStatus || 'قيد على الحساب',
      'المستخدم': ret.createdBy,
      'الفترة': periodLabel
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'سجل_المرتجعات');
    const suffix = dateRange.from && dateRange.to ? `${dateRange.from}_${dateRange.to}` : 'كل_الفترات';
    XLSX.writeFile(wb, `سجل_المرتجعات_${suffix}.xlsx`);
  };

  if (isCreateMode) {
    return (
      <SalesReturnTerminalView
        returns={returns}
        invoices={invoices}
        items={items}
        cashboxes={cashboxes}
        user={user}
        barcodeScanMode={barcodeScanMode}
        latestItemFirst={latestItemFirst}
        preselectedInvoice={preselectedInvoice}
        onBack={() => {
          setIsCreateMode(false);
          if (onClearPreselectedInvoice) onClearPreselectedInvoice();
        }}
        onSubmitReturn={async (returnData) => {
          await onCreateReturn(returnData);
          setIsCreateMode(false);
          if (onClearPreselectedInvoice) onClearPreselectedInvoice();
        }}
      />
    );
  }

  return (
    <PageSurface
      dir="rtl"
      title="المرتجعات وإعادة المخزون"
      subtitle="تسجيل المرتجعات الجزئية والكلية واستعادة المخزون السليم فوراً (Returns & ReturnLines)"
      actions={
        <>
          <button
            type="button"
            onClick={handleExportReturns}
            disabled={filteredReturns.length === 0}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>تصدير Excel</span>
          </button>
          <button
            type="button"
            data-shortcut-print="true"
            onClick={() => window.print()}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
          >
            <Printer className="w-4 h-4 text-[#1668B2]" />
            <span>طباعة الكشف</span>
            <ShortcutBadge actionId="general.print_page" />
          </button>
          <button
            type="button"
            data-shortcut-add="true"
            onClick={() => setIsCreateMode(true)}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>تسجيل مرتجع جديد</span>
            <ShortcutBadge actionId="general.add_new" className="!text-white/90 !border-white/35 !bg-white/10" />
          </button>
        </>
      }
    >
      {/* سطر إحصائيات الفترة */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]">
        <span>الفترة: <strong className="text-[var(--text-primary)]">{periodLabel}</strong></span>
        <span>·</span>
        <span>عدد المرتجعات: <strong className="font-mono tabular-nums text-[var(--text-primary)]">{periodStats.count}</strong></span>
        <span>·</span>
        <span>إجمالي القطع المرتجعة: <strong className="font-mono tabular-nums ui-stock-low">{periodStats.totalReturnedUnits} قطعة</strong></span>
        <span>·</span>
        <span>إجمالي خصم شحن المرتجع: <strong className="font-mono tabular-nums ui-money-purchase">{periodStats.totalDeductionSum.toLocaleString('ar-EG')} ج.م</strong></span>
      </div>

      {/* صف الفلاتر المضغوط */}
      <div className="flex flex-wrap items-end gap-3 pb-4 border-b border-[var(--border-subtle)]">
        <DateRangeFilter
          inline
          value={dateRange}
          onChange={setDateRange}
          storageKey="returns_page"
          defaultPreset="THIS_MONTH"
        />

        <div className="no-print">
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            بحث
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="رقم المرتجع، الفاتورة، السبب..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} pl-3 pr-9 text-xs`}
            />
            <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
          </div>
        </div>

        {searchQuery.trim() && (
          <div className="print-only print-filter-summary">
            بحث: {searchQuery.trim()}
          </div>
        )}
      </div>

      <SectionHeading title={`سجل المرتجعات (${filteredReturns.length})`} />

      {filteredReturns.length === 0 ? (
        <div className="py-10 text-sm text-[var(--text-secondary)] flex items-center gap-2">
          <RotateCcw className="w-5 h-5" />
          <span>لا توجد سجلات مرتجعات مسجلة في الفترة المختارة</span>
        </div>
      ) : (
        <CompactTable ariaLabel="سجل المرتجعات">
          <thead>
            <tr>
              <th className={COMPACT_TABLE_NUM_CLASS}>رقم المرتجع</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>الفاتورة</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
              <th className={COMPACT_TABLE_TEXT_CLASS}>أسطر المرتجع</th>
              <th className={COMPACT_TABLE_TEXT_CLASS}>السبب</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>التسوية</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>خصم الشحن</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>بواسطة</th>
            </tr>
          </thead>
          <tbody>
            {filteredReturns.map((ret) => {
              const totalQty = (ret.lines || []).reduce((s, l) => s + (l.returnedQuantity || 0), 0);
              return (
                <tr key={ret.returnNumber}>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>
                    {ret.returnNumber}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-link`}>
                    {ret.invoiceNumber}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-xs text-[var(--text-secondary)]`}>
                    {new Date(ret.date).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    <div className="space-y-0.5 text-xs">
                      {ret.lines?.map((line, idx) => (
                        <div key={idx} className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">سطر #{line.invoiceLineIndex}</span>
                          <span className="font-mono text-[var(--text-secondary)]">({line.returnedQuantity} قطع)</span>
                          <span className={line.itemCondition === 'يرجع المخزن' ? 'ui-stock-in font-bold' : 'ui-stock-out font-bold'}>
                            [{line.itemCondition}]
                          </span>
                          <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                            شحن: {line.totalLineReturnShippingDeduction} ج.م
                          </span>
                        </div>
                      ))}
                      {(!ret.lines || ret.lines.length === 0) && (
                        <span>{ret.returnedItemsSummary || '—'}</span>
                      )}
                    </div>
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>{ret.returnReason}</td>
                  <td className={COMPACT_TABLE_NUM_CLASS}>
                    {ret.refundStatus || 'قيد على الحساب'}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-purchase`}>
                    {ret.totalReturnShippingDeduction.toLocaleString('ar-EG')} ج.م ({totalQty})
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-xs text-[var(--text-secondary)]`}>
                    {ret.createdBy}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="font-bold">
                إجمالي الفترة ({periodStats.count} مرتجع · {periodStats.totalReturnedUnits} قطعة)
              </td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-purchase`}>
                {periodStats.totalDeductionSum.toLocaleString('ar-EG')} ج.م
              </td>
              <td />
            </tr>
          </tfoot>
        </CompactTable>
      )}

      {/* Partial / Full Return Modal */}
      {isModalOpen && (
        <ModalShell
          title="تسجيل مرتجع جزئي أو كلي للفاتورة"
          subtitle="ورقة Returns و ReturnLines"
          onClose={() => setIsModalOpen(false)}
          closeDisabled={isSubmitting}
          footer={
            <>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                disabled={isSubmitting}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                form="quick-return-modal-form"
                disabled={isSubmitting || totalReturnCount === 0}
                className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-xs font-bold text-white transition cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{isSubmitting ? 'جاري التسجيل...' : 'تأكيد المرتجع وتحديث المخزون'}</span>
              </button>
            </>
          }
        >
          <form id="quick-return-modal-form" onSubmit={handleSubmit} className="space-y-4">
            {errorMsg && (
              <div className="flex items-center justify-between gap-2 text-xs font-bold ui-stock-out">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
                {isUnknownResultError && (
                  <button
                    type="button"
                    onClick={submitReturn}
                    disabled={isSubmitting}
                    className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
                    <span>إعادة المحاولة</span>
                  </button>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
                اختر الفاتورة المراد عمل استرجاع لها *
              </label>
              <select
                value={selectedInvoiceNumber}
                onChange={(e) => handleSelectInvoice(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-mono`}
              >
                <option value="">-- اضغط لاختيار الفاتورة --</option>
                {invoices.filter(i => i.status !== 'مرتجع').map(inv => (
                  <option key={inv.invoiceNumber} value={inv.invoiceNumber}>
                    {inv.invoiceNumber} | {inv.platform} ({inv.netAmount} ج.م)
                  </option>
                ))}
              </select>
            </div>

            {selectedInvoiceNumber && returnLinesState.length > 0 && (
              <>
                <SectionHeading title="أسطر الفاتورة والكميات وحالة الصنف" withTopDivider />
                <CompactTable ariaLabel="أسطر المرتجع">
                  <thead>
                    <tr>
                      <th className={COMPACT_TABLE_TEXT_CLASS}>الصنف</th>
                      <th className={COMPACT_TABLE_NUM_CLASS}>المباع / المتاح</th>
                      <th className={COMPACT_TABLE_NUM_CLASS}>كمية المرتجع</th>
                      <th className={COMPACT_TABLE_NUM_CLASS}>حالة الصنف</th>
                      <th className={COMPACT_TABLE_NUM_CLASS}>خصم الشحن</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnLinesState.map((line, idx) => (
                      <tr key={idx}>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>
                          <span className="font-bold">{line.itemName}</span>
                        </td>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-xs`}>
                          {line.originalQuantity} / <strong className={line.maxQuantity > 0 ? 'ui-stock-in' : 'ui-stock-out'}>{line.maxQuantity}</strong>
                          {line.previouslyReturned > 0 && <span className="text-[11px] text-[var(--text-secondary)]"> (مرتجع: {line.previouslyReturned})</span>}
                        </td>
                        <td className={COMPACT_TABLE_NUM_CLASS}>
                          {line.maxQuantity === 0 ? (
                            <span className="text-xs text-[var(--text-secondary)]">مكتمل</span>
                          ) : (
                            <input
                              type="number"
                              min="0"
                              max={line.maxQuantity}
                              value={line.returnedQuantity}
                              onChange={(e) => updateLineQty(idx, parseInt(e.target.value) || 0)}
                              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono font-bold text-xs`}
                            />
                          )}
                        </td>
                        <td className={COMPACT_TABLE_NUM_CLASS}>
                          <select
                            value={line.itemCondition}
                            disabled={line.returnedQuantity === 0}
                            onChange={(e) => updateLineCondition(idx, e.target.value as any)}
                            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs disabled:opacity-50`}
                          >
                            <option value="يرجع المخزن">يرجع المخزن (سليم)</option>
                            <option value="تالف">تالف</option>
                          </select>
                        </td>
                        <td className={COMPACT_TABLE_NUM_CLASS}>
                          <input
                            type="number"
                            min="0"
                            disabled={line.returnedQuantity === 0}
                            value={line.returnShippingDeductionPerUnit}
                            onChange={(e) => updateLineDeduction(idx, parseFloat(e.target.value) || 0)}
                            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono text-xs disabled:opacity-50`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </CompactTable>
              </>
            )}

            <SectionHeading title="التسوية والبيانات" withTopDivider />

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
                  تسوية قيمة المرتجع المحاسبية
                </label>
                <div className="inline-flex border border-[var(--border-color)] rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setRefundStatus('قيد على الحساب')}
                    className={`min-h-[44px] px-3 text-xs font-bold transition cursor-pointer ${
                      refundStatus === 'قيد على الحساب'
                        ? 'bg-amber-600 text-white'
                        : 'text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                    }`}
                  >
                    تخفيض مديونية العميل
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefundStatus('استرداد نقدي')}
                    className={`min-h-[44px] px-3 text-xs font-bold transition cursor-pointer ${
                      refundStatus === 'استرداد نقدي'
                        ? 'bg-[#1668B2] text-white'
                        : 'text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                    }`}
                  >
                    استرداد نقدي فوري
                  </button>
                </div>
              </div>

              {refundStatus === 'استرداد نقدي' && (
                <div>
                  <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
                    الخزينة المنصرف منها *
                  </label>
                  {allowedReturnCashboxes.length === 0 ? (
                    <span className="text-xs font-bold ui-stock-out">لا توجد خزينة مرتجعات نشطة معينة لك</span>
                  ) : (
                    <select
                      value={selectedCashboxId}
                      onChange={(e) => setSelectedCashboxId(e.target.value)}
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-bold`}
                    >
                      <option value="">-- اختر خزينة الصرف --</option>
                      {allowedReturnCashboxes.map(cb => {
                        const isDefault = user?.cashboxConfig?.defaultReturnCashboxId === cb.id;
                        return (
                          <option key={cb.id} value={cb.id}>
                            {cb.name} {isDefault ? '(افتراضية)' : ''} (رصيدها: {cb.currentBalance} {cb.currency})
                          </option>
                        );
                      })}
                    </select>
                  )}
                </div>
              )}

              {activeAllowedWarehouses.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
                    المخزن المستلم للمرتجع
                  </label>
                  {canChooseWarehouse ? (
                    <select
                      value={selectedWarehouseId}
                      onChange={(e) => setSelectedWarehouseId(e.target.value)}
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold`}
                    >
                      {activeAllowedWarehouses.map(wh => (
                        <option key={wh.id} value={wh.id}>
                          {wh.name}{wh.isDefault ? ' (افتراضي)' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold flex items-center`}>
                      {activeAllowedWarehouses[0]?.name || 'المخزن الرئيسي'}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">سبب الرجوع</label>
                <select
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs`}
                >
                  <option value="استرجاع عميل منصة">استرجاع عميل منصة (سليم)</option>
                  <option value="عيب صناعة أو تلف">عيب صناعة أو تلف</option>
                  <option value="تلف أثناء شحن المنصة">تلف أثناء شحن المنصة</option>
                  <option value="عدم استلام العميل للشحنة (RTO)">عدم استلام العميل للشحنة (RTO)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">ملاحظات المرتجع</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="رقم بوليصة شحن المرتجع أو تعليق"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
                />
              </div>
            </div>

            {totalReturnCount > 0 && (
              <div className="text-xs font-bold text-[var(--text-primary)]">
                إجمالي خصم المنصة من الشحن:{' '}
                <span className="font-mono ui-money-purchase">{totalDeduction.toLocaleString('ar-EG')} ج.م</span>
              </div>
            )}
          </form>
        </ModalShell>
      )}
    </PageSurface>
  );
};

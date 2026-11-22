import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  ReturnRecord,
  Invoice,
  Item,
  Cashbox,
  UserAccount,
  BarcodeScanQuantityMode
} from '../types';
import { CameraBarcodeScannerModal } from './CameraBarcodeScannerModal';
import { generateIdempotencyKey } from '../utils/idempotency';
import { useUserWarehouses } from '../hooks/useUserWarehouses';
import {
  ArrowRight,
  Camera,
  Barcode,
  Search,
  Plus,
  Minus,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
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
} from './ui';

function playBeep() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1760, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (_) {}
}

export interface ReturnLineState {
  invoiceLineIndex: number;
  itemId: string;
  itemName: string;
  barcode?: string;
  originalQuantity: number;
  previouslyReturned: number;
  maxQuantity: number;
  returnedQuantity: number;
  returnShippingDeductionPerUnit: number;
  itemCondition: 'يرجع المخزن' | 'تالف';
}

interface SalesReturnTerminalViewProps {
  returns: ReturnRecord[];
  invoices: Invoice[];
  items: Item[];
  cashboxes: Cashbox[];
  user?: UserAccount | null;
  barcodeScanMode?: BarcodeScanQuantityMode;
  latestItemFirst?: boolean;
  preselectedInvoice?: Invoice | null;
  onBack: () => void;
  onSubmitReturn: (returnData: any) => Promise<void>;
}

export const SalesReturnTerminalView: React.FC<SalesReturnTerminalViewProps> = ({
  returns,
  invoices,
  items,
  cashboxes,
  user = null,
  barcodeScanMode,
  latestItemFirst = false,
  preselectedInvoice,
  onBack,
  onSubmitReturn
}) => {
  const isDesigner = user?.role === 'designer' || Boolean(user?.isOwner);
  const {
    activeAllowedWarehouses,
    defaultWarehouseId,
    canChooseWarehouse
  } = useUserWarehouses(user);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');

  const [selectedInvoiceNumber, setSelectedInvoiceNumber] = useState<string>(preselectedInvoice?.invoiceNumber || '');
  const [returnLinesState, setReturnLinesState] = useState<ReturnLineState[]>([]);
  const [returnReason, setReturnReason] = useState<string>('استرجاع عميل منصة');
  const [refundStatus, setRefundStatus] = useState<'قيد على الحساب' | 'استرداد نقدي'>('قيد على الحساب');
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>('');
  const [notes, setNotes] = useState('');

  // Barcode & Search
  const [barcodeInput, setBarcodeInput] = useState('');
  const [invoiceSearchQuery, setInvoiceSearchQuery] = useState('');
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(null);
  const [focusQtyToken, setFocusQtyToken] = useState<number>(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUnknownResultError, setIsUnknownResultError] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

  useEffect(() => {
    if (selectedLineIndex === null || !focusQtyToken) return;
    const timer = setTimeout(() => {
      const rowEl = document.querySelector(
        `[data-sales-return-row-idx="${selectedLineIndex}"]`
      ) as HTMLElement | null;
      rowEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      const qtyInput = document.querySelector(
        `[data-sales-return-qty-input-idx="${selectedLineIndex}"]`
      ) as HTMLInputElement | null;
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }, 30);
    return () => clearTimeout(timer);
  }, [selectedLineIndex, focusQtyToken]);

  // ضبط المخزن الافتراضي للمستخدم
  useEffect(() => {
    if (activeAllowedWarehouses.length === 0) return;
    if (!selectedWarehouseId || !activeAllowedWarehouses.some(w => w.id === selectedWarehouseId)) {
      setSelectedWarehouseId(defaultWarehouseId || activeAllowedWarehouses[0].id);
    }
  }, [activeAllowedWarehouses, defaultWarehouseId, selectedWarehouseId]);

  const selectedWarehouse = useMemo(() => {
    return (
      activeAllowedWarehouses.find(w => w.id === selectedWarehouseId) ||
      activeAllowedWarehouses[0] ||
      null
    );
  }, [activeAllowedWarehouses, selectedWarehouseId]);

  // Filter allowed cashboxes
  const allowedCashboxes = useMemo(() => {
    const active = cashboxes.filter(c => c.status !== 'inactive' && (c.status as any) !== 'موقوفة');
    if (isDesigner) return active;
    const allowedIds = user?.cashboxConfig?.allowedReturnCashboxIds;
    if (allowedIds && allowedIds.length > 0) {
      return active.filter(c => allowedIds.includes(c.id));
    }
    return active;
  }, [cashboxes, isDesigner, user?.cashboxConfig?.allowedReturnCashboxIds]);

  // Set default cashbox
  useEffect(() => {
    if (allowedCashboxes.length > 0 && !selectedCashboxId) {
      const defaultId = user?.cashboxConfig?.defaultReturnCashboxId;
      if (defaultId && allowedCashboxes.some(c => c.id === defaultId)) {
        setSelectedCashboxId(defaultId);
      } else {
        setSelectedCashboxId(allowedCashboxes[0].id);
      }
    }
  }, [allowedCashboxes, selectedCashboxId, user?.cashboxConfig?.defaultReturnCashboxId]);

  // Build invoice lines whenever invoice is selected
  const handleSelectInvoice = (invNum: string) => {
    setSelectedInvoiceNumber(invNum);
    setSelectedLineIndex(null);
    setErrorMsg(null);
    setIsUnknownResultError(false);
    idempotencyKeyRef.current = generateIdempotencyKey();
    const inv = invoices.find(i => i.invoiceNumber === invNum);
    if (inv && inv.lines) {
      const prevReturns = returns.filter(r => r.invoiceNumber === invNum);
      const newLines: ReturnLineState[] = inv.lines.map((line, idx) => {
        const previouslyReturned = prevReturns.reduce((sum, r) => {
          const match = r.lines?.find(l => l.itemId === line.itemId || l.invoiceLineIndex === idx + 1);
          return sum + (match ? match.returnedQuantity : 0);
        }, 0);
        const remainingReturnable = Math.max(0, line.quantity - previouslyReturned);

        const matchedCatalogItem = items.find(it => it.id === line.itemId);
        const lineBarcode = line.barcodeAtSale || matchedCatalogItem?.barcode || '';

        return {
          invoiceLineIndex: idx + 1,
          itemId: line.itemId,
          itemName: line.itemNameAtSale,
          barcode: lineBarcode,
          originalQuantity: line.quantity,
          previouslyReturned,
          maxQuantity: remainingReturnable,
          returnedQuantity: 0,
          returnShippingDeductionPerUnit: 25,
          itemCondition: 'يرجع المخزن'
        };
      });

      setReturnLinesState(newLines);

      if (inv.warehouseId && activeAllowedWarehouses.some(w => w.id === inv.warehouseId)) {
        setSelectedWarehouseId(inv.warehouseId);
      }
      if (inv.paymentType === 'نقدي' || (inv.paidAmount && inv.paidAmount > 0)) {
        setRefundStatus('استرداد نقدي');
        if (inv.cashboxId && allowedCashboxes.some(c => c.id === inv.cashboxId)) {
          setSelectedCashboxId(inv.cashboxId);
        }
      } else {
        setRefundStatus('قيد على الحساب');
      }
    } else {
      setReturnLinesState([]);
    }
  };

  useEffect(() => {
    if (preselectedInvoice) {
      handleSelectInvoice(preselectedInvoice.invoiceNumber);
    }
  }, [preselectedInvoice]);

  const selectedInvoice = useMemo(() => {
    return invoices.find(i => i.invoiceNumber === selectedInvoiceNumber);
  }, [invoices, selectedInvoiceNumber]);

  const filteredInvoices = useMemo(() => {
    const q = invoiceSearchQuery.trim().toLowerCase();
    const activeInvs = invoices.filter(i => i.status !== 'مرتجع');
    if (!q) return activeInvs.slice(0, 15);

    return activeInvs.filter(i => {
      const matchNum = i.invoiceNumber.toLowerCase().includes(q);
      const matchCustomer = i.customerName?.toLowerCase().includes(q);
      const matchPlatform = i.platform?.toLowerCase().includes(q);
      const matchRef = i.referenceNumber?.toLowerCase().includes(q);
      return matchNum || matchCustomer || matchPlatform || matchRef;
    }).slice(0, 25);
  }, [invoices, invoiceSearchQuery]);

  const handleBarcodeScanned = (scannedCode: string) => {
    const clean = scannedCode.trim().toLowerCase();
    if (!clean) return;

    setErrorMsg(null);
    setScanFeedback(null);

    const directInvoice = invoices.find(i => i.invoiceNumber.toLowerCase() === clean);
    if (directInvoice) {
      playBeep();
      handleSelectInvoice(directInvoice.invoiceNumber);
      setScanFeedback({
        type: 'success',
        message: `تم العثور على الفاتورة رقم: ${directInvoice.invoiceNumber}`
      });
      setBarcodeInput('');
      setTimeout(() => setScanFeedback(null), 3000);
      return;
    }

    if (selectedInvoiceNumber && returnLinesState.length > 0) {
      const lineIdx = returnLinesState.findIndex(l => {
        if (l.barcode && l.barcode.toLowerCase() === clean) return true;
        const catalogItem = items.find(it => it.id === l.itemId);
        if (catalogItem) {
          if (catalogItem.barcode && catalogItem.barcode.toLowerCase() === clean) return true;
          if (catalogItem.secondaryBarcodes?.some(b => b.toLowerCase() === clean)) return true;
          if (catalogItem.barcodes?.some(b => b.barcode.toLowerCase() === clean)) return true;
          if (catalogItem.sku && catalogItem.sku.toLowerCase() === clean) return true;
        }
        return false;
      });

      if (lineIdx >= 0) {
        const line = returnLinesState[lineIdx];
        const scanMode: BarcodeScanQuantityMode =
          barcodeScanMode === 'edit_quantity' ? 'edit_quantity' : 'increment';

        // في وضع «مسح الصنف ثم تعديل الكمية»: إذا كان الصنف قد أُضيف للمرتجع بالفعل (كميته > 0)، نحدد سطره لتعديل الكمية يدويًا دون زيادة تلقائية، وننقله لأول الجدول فقط إذا كان ترتيب آخر صنف أولًا مفعّلًا لمرتجع المبيعات
        if (line.returnedQuantity > 0 && scanMode === 'edit_quantity') {
          playBeep();
          if (latestItemFirst && lineIdx > 0) {
            setReturnLinesState(prev => {
              const target = prev[lineIdx];
              if (!target) return prev;
              return [target, ...prev.filter((_, i) => i !== lineIdx)];
            });
            setSelectedLineIndex(0);
          } else {
            setSelectedLineIndex(lineIdx);
          }
          if (!isCameraModalOpen) {
            setFocusQtyToken(prev => prev + 1);
          }
          setScanFeedback({
            type: 'success',
            message: `تم تحديد سطر الصنف "${line.itemName}" (الكمية المرتجعة: ${line.returnedQuantity}) — يمكنك تعديل الكمية يدويًا`
          });
          setBarcodeInput('');
          setTimeout(() => setScanFeedback(null), 3000);
          return;
        }

        if (line.returnedQuantity < line.maxQuantity) {
          playBeep();
          const nextQty = line.returnedQuantity + 1;
          setReturnLinesState(prev => {
            const target = prev[lineIdx];
            if (!target) return prev;
            const updatedLine = { ...target, returnedQuantity: nextQty };
            if (latestItemFirst) {
              return [updatedLine, ...prev.filter((_, i) => i !== lineIdx)];
            }
            return prev.map((l, i) => (i === lineIdx ? updatedLine : l));
          });
          setSelectedLineIndex(latestItemFirst ? 0 : lineIdx);
          setScanFeedback({
            type: 'success',
            message: `تم زيادة كمية المرتجع للصنف: "${line.itemName}" (أصبح: ${nextQty})`
          });
        } else {
          setSelectedLineIndex(lineIdx);
          setScanFeedback({
            type: 'error',
            message: `الصنف "${line.itemName}" وصل للحد الأقصى القابل للإرجاع من هذه الفاتورة (${line.maxQuantity})`
          });
        }
        setBarcodeInput('');
        setTimeout(() => setScanFeedback(null), 3000);
        return;
      }
    }

    const matchedInvoice = invoices.find(inv => {
      if (inv.status === 'مرتجع') return false;
      return inv.lines?.some(l => {
        if (l.barcodeAtSale && l.barcodeAtSale.toLowerCase() === clean) return true;
        const cat = items.find(it => it.id === l.itemId);
        return cat?.barcode?.toLowerCase() === clean || cat?.secondaryBarcodes?.some(b => b.toLowerCase() === clean);
      });
    });

    if (matchedInvoice) {
      playBeep();
      handleSelectInvoice(matchedInvoice.invoiceNumber);
      setScanFeedback({
        type: 'success',
        message: `تم العثور على الفاتورة (${matchedInvoice.invoiceNumber}) التي تحتوي على هذا الصنف!`
      });
      setBarcodeInput('');
      setTimeout(() => setScanFeedback(null), 4000);
      return;
    }

    setScanFeedback({
      type: 'error',
      message: `لم يُعثر على فاتورة أو صنف بالباركود [${clean}]. يرجى البحث برقم الفاتورة أو اسم العميل.`
    });
    setInvoiceSearchQuery(clean);
  };

  const handleManualBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (code) {
      setBarcodeInput('');
      handleBarcodeScanned(code);
    }
  };

  const updateLineQty = (index: number, qty: number) => {
    setReturnLinesState(prev => prev.map((l, i) => {
      if (i === index) {
        const valid = Math.max(0, Math.min(qty, l.maxQuantity));
        return { ...l, returnedQuantity: valid };
      }
      return l;
    }));
  };

  const setAllLinesMax = () => {
    setReturnLinesState(prev => prev.map(l => ({ ...l, returnedQuantity: l.maxQuantity })));
  };

  const resetAllLines = () => {
    setReturnLinesState(prev => prev.map(l => ({ ...l, returnedQuantity: 0 })));
    setErrorMsg(null);
    setIsUnknownResultError(false);
    idempotencyKeyRef.current = generateIdempotencyKey();
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
    if (!selectedInvoiceNumber) {
      setErrorMsg('يرجى اختيار الفاتورة المراد عمل استرجاع لها أولاً');
      return;
    }
    if (totalReturnCount === 0) {
      setErrorMsg('يرجى تحديد كمية صنف واحد على الأقل للمرتجع');
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
      const inv = invoices.find(i => i.invoiceNumber === selectedInvoiceNumber);
      const isPartial = inv ? totalReturnCount < inv.lines.reduce((s, l) => s + l.quantity, 0) : true;

      await onSubmitReturn({
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
      onBack();
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

  return (
    <PageSurface
      dir="rtl"
      title="تسجيل مرتجع بيع (Sales Return Terminal)"
      subtitle="البحث عن الفاتورة أو الصنف بالباركود وتوثيق المرتجع الجزئي أو الكلي واستعادة المخزون"
      actions={
        <>
          {selectedInvoice && (
            <>
              <button
                type="button"
                onClick={setAllLinesMax}
                className="min-h-[44px] px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-low text-xs font-bold transition cursor-pointer"
              >
                إرجاع كامل الفاتورة
              </button>
              <button
                type="button"
                onClick={resetAllLines}
                className="min-h-[44px] px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text-primary)] transition cursor-pointer"
              >
                تصفير الكميات
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] transition cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة لسجل المرتجعات</span>
          </button>
        </>
      }
    >
      {/* 1. تحديد الفاتورة ومسح الباركود */}
      <SectionHeading title="1. تحديد الفاتورة المبيعة ومسح الباركود" />

      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={() => setIsCameraModalOpen(true)}
          className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition cursor-pointer"
          title="فتح كاميرا الهاتف لمسح باركود الفاتورة أو الصنف"
        >
          <Camera className="w-4 h-4" />
          <span>مسح بالكاميرا</span>
        </button>

        <form onSubmit={handleManualBarcodeSubmit} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
              باركود الفاتورة أو الصنف
            </label>
            <div className="relative">
              <input
                ref={barcodeInputRef}
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="امسح الباركود أو أدخل الكود..."
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} pl-3 pr-9 text-xs font-mono`}
              />
              <Barcode className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
            </div>
          </div>
          <button
            type="submit"
            disabled={!barcodeInput.trim()}
            className="min-h-[44px] px-4 rounded-lg bg-[#1668B2] hover:bg-[#125592] disabled:opacity-40 text-white font-bold text-xs transition cursor-pointer"
          >
            بحث / إضافة
          </button>
        </form>

        <div>
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            البحث في الفواتير
          </label>
          <div className="relative">
            <input
              type="text"
              value={invoiceSearchQuery}
              onChange={(e) => setInvoiceSearchQuery(e.target.value)}
              placeholder="رقم الفاتورة أو العميل..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} pl-3 pr-9 text-xs font-mono`}
            />
            <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            اختيار الفاتورة *
          </label>
          <select
            value={selectedInvoiceNumber}
            onChange={(e) => handleSelectInvoice(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-mono font-bold`}
          >
            <option value="">-- اضغط لاختيار الفاتورة --</option>
            {filteredInvoices.map(inv => (
              <option key={inv.invoiceNumber} value={inv.invoiceNumber}>
                {inv.invoiceNumber} | {inv.customerName || inv.platform} ({inv.netAmount.toLocaleString()} ج.م)
              </option>
            ))}
          </select>
        </div>
      </div>

      {scanFeedback && (
        <div
          className={`flex items-center justify-between gap-2 text-xs font-bold ${
            scanFeedback.type === 'success' ? 'ui-stock-in' : 'ui-stock-out'
          }`}
        >
          <div className="flex items-center gap-1.5">
            {scanFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{scanFeedback.message}</span>
          </div>
          <button type="button" onClick={() => setScanFeedback(null)} className="text-xs underline cursor-pointer">
            إخفاء
          </button>
        </div>
      )}

      {selectedInvoice && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
          <span>الفاتورة: <strong className="font-mono text-[var(--text-primary)]">{selectedInvoice.invoiceNumber}</strong></span>
          <span>·</span>
          <span>المنصة: <strong className="text-[var(--text-primary)]">{selectedInvoice.platform}</strong></span>
          <span>·</span>
          <span>العميل: <strong className="text-[var(--text-primary)]">{selectedInvoice.customerName || selectedInvoice.platform || 'نقدي'}</strong></span>
          <span>·</span>
          <span>الإجمالي: <strong className="font-mono text-[var(--text-primary)]">{selectedInvoice.netAmount.toLocaleString()} ج.م</strong></span>
          <span>·</span>
          <span>الدفع: <strong className="text-[var(--text-primary)]">{selectedInvoice.paymentType || 'نقدي'}</strong></span>
        </div>
      )}

      {/* 2. بنود الفاتورة */}
      <SectionHeading
        title={`2. بنود الفاتورة وتحديد كميات المرتجع (${returnLinesState.length})`}
        actions={
          <span className="text-xs font-bold font-mono ui-stock-low">
            المحدد للإرجاع: {totalReturnCount} قطعة
          </span>
        }
        withTopDivider
      />

      {!selectedInvoiceNumber ? (
        <p className="text-xs text-[var(--text-secondary)]">
          يرجى اختيار الفاتورة بالأعلى أو مسح باركود الفاتورة/الصنف بالكاميرا لتحميل بنودها.
        </p>
      ) : returnLinesState.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">لا توجد بنود قابلة للإرجاع في هذه الفاتورة.</p>
      ) : (
        <CompactTable ariaLabel="بنود المرتجع">
          <thead>
            <tr>
              <th className={COMPACT_TABLE_NUM_CLASS}>#</th>
              <th className={COMPACT_TABLE_TEXT_CLASS}>الصنف المباع</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>المباع</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>المتاح للإرجاع</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>كمية المرتجع</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>حالة الصنف المرتجع</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>خصم شحن للقطعة</th>
            </tr>
          </thead>
          <tbody>
            {returnLinesState.map((line, idx) => {
              const isSelectedLine = selectedLineIndex === idx;
              return (
              <tr
                key={`${line.invoiceLineIndex}-${line.itemId}`}
                data-sales-return-row-idx={idx}
                data-selected-line={isSelectedLine ? 'true' : undefined}
                className={isSelectedLine ? 'bg-sky-50/80 ring-2 ring-inset ring-[#1668B2]' : undefined}
              >
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                  #{line.invoiceLineIndex}
                </td>
                <td className={COMPACT_TABLE_TEXT_CLASS}>
                  <div className="font-bold">{line.itemName}</div>
                  {line.barcode && (
                    <div className="text-[11px] text-[var(--text-secondary)] font-mono">باركود: {line.barcode}</div>
                  )}
                </td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>{line.originalQuantity}</td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>
                  {line.maxQuantity > 0 ? (
                    <span className="font-bold ui-stock-in">{line.maxQuantity} قطعة</span>
                  ) : (
                    <span className="text-[var(--text-secondary)]">مكتمل الإرجاع</span>
                  )}
                  {line.previouslyReturned > 0 && (
                    <div className="text-[11px] text-[var(--text-secondary)]">أُرجع سابقاً: {line.previouslyReturned}</div>
                  )}
                </td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  {line.maxQuantity === 0 ? (
                    <span className="text-xs text-[var(--text-secondary)]">—</span>
                  ) : (
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateLineQty(idx, line.returnedQuantity - 1)}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                        aria-label="إنقاص الكمية"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        max={line.maxQuantity}
                        data-sales-return-qty-input-idx={idx}
                        value={line.returnedQuantity}
                        onChange={(e) => updateLineQty(idx, parseInt(e.target.value) || 0)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            barcodeInputRef.current?.focus();
                          }
                        }}
                        className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono font-bold text-xs`}
                      />
                      <button
                        type="button"
                        onClick={() => updateLineQty(idx, line.returnedQuantity + 1)}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                        aria-label="زيادة الكمية"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <select
                    value={line.itemCondition}
                    onChange={(e) => updateLineCondition(idx, e.target.value as any)}
                    disabled={line.returnedQuantity === 0}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold disabled:opacity-40`}
                  >
                    <option value="يرجع المخزن">يرجع المخزن (سليم)</option>
                    <option value="تالف">تالف (استبعاد من المخزون)</option>
                  </select>
                </td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <input
                    type="number"
                    min="0"
                    value={line.returnShippingDeductionPerUnit}
                    onChange={(e) => updateLineDeduction(idx, parseFloat(e.target.value) || 0)}
                    disabled={line.returnedQuantity === 0}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono text-xs disabled:opacity-40`}
                  />
                </td>
              </tr>
              );
            })}
          </tbody>
        </CompactTable>
      )}

      {/* 3. التسوية المالية ورد المستحقات */}
      <SectionHeading title="3. التسوية المالية ورد المستحقات" withTopDivider />

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

      <ReportSummaryTable
        rows={[
          { label: 'إجمالي قطع المرتجع', value: `${totalReturnCount} قطعة` },
          { label: 'إجمالي خصم شحن المرتجع', value: `${totalDeduction.toLocaleString()} ج.م`, tone: 'purchase' },
        ]}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
            طريقة رد القيمة للعميل *
          </label>
          <select
            value={refundStatus}
            onChange={(e) => setRefundStatus(e.target.value as any)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-bold`}
          >
            <option value="قيد على الحساب">قيد على الحساب (تسوية رصيد العميل / المنصة)</option>
            <option value="استرداد نقدي">استرداد نقدي (صرف من الخزينة)</option>
          </select>
        </div>

        {refundStatus === 'استرداد نقدي' && (
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
              خزينة صرف المرتجع *
            </label>
            <select
              value={selectedCashboxId}
              onChange={(e) => setSelectedCashboxId(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-medium`}
            >
              <option value="">-- اختر الخزينة --</option>
              {allowedCashboxes.map(cb => (
                <option key={cb.id} value={cb.id}>
                  {cb.name} (رصيدها: {cb.currentBalance.toLocaleString()} ج.م)
                </option>
              ))}
            </select>
          </div>
        )}

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
              {selectedWarehouse?.name || 'المخزن الرئيسي'}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
            سبب الاسترجاع *
          </label>
          <select
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
          >
            <option value="استرجاع عميل منصة">استرجاع عميل منصة (رفض استلام / إرجاع شحن)</option>
            <option value="عيب صناعة أو تلف">عيب صناعة أو تلف بالمنتج</option>
            <option value="طلب غير مطابق للمواصفات">طلب غير مطابق للمواصفات أو المقاس</option>
            <option value="إلغاء الطلب من العميل">إلغاء الطلب من العميل</option>
            <option value="أخرى">سبب آخر (سجل بالملاحظات)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
            ملاحظات المرتجع
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="رقم بوليصة شحن المرتجع، تفاصيل الفحص..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || totalReturnCount === 0 || !selectedInvoiceNumber}
          className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-bold text-xs transition cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{isSubmitting ? 'جاري تسجيل المرتجع واستعادة المخزون...' : `تأكيد وحفظ مرتجع البيع (${totalReturnCount} قطعة)`}</span>
        </button>

        <button
          type="button"
          onClick={onBack}
          disabled={isSubmitting}
          className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs transition cursor-pointer"
        >
          إلغاء والعودة
        </button>
      </div>

      <CameraBarcodeScannerModal
        isOpen={isCameraModalOpen}
        items={items}
        onClose={() => setIsCameraModalOpen(false)}
        onBarcodeDetected={(code) => {
          handleBarcodeScanned(code);
        }}
        onManualSearchRequest={(term) => {
          setInvoiceSearchQuery(term);
        }}
      />
    </PageSurface>
  );
};

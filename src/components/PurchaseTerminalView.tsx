import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Item,
  Supplier,
  Cashbox,
  UserAccount,
  BarcodeScanQuantityMode,
} from '../types';
import { api } from '../api/client';
import { useUserWarehouses, fetchAllWarehouseStockMap } from '../hooks/useUserWarehouses';
import { CameraBarcodeScannerModal } from './CameraBarcodeScannerModal';
import { generateIdempotencyKey } from '../utils/idempotency';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  ReportSummaryTable,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
} from './ui';
import {
  ArrowRight,
  Camera,
  Barcode,
  Search,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';

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

export interface PurchaseLineItem {
  itemId: string;
  itemName: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  currentStock: number;
}

interface PurchaseTerminalViewProps {
  items: Item[];
  suppliers: Supplier[];
  cashboxes: Cashbox[];
  user?: UserAccount | null;
  barcodeScanMode?: BarcodeScanQuantityMode;
  latestItemFirst?: boolean;
  onBack: () => void;
  onSuccess: () => void;
  onOpenSupplierModal?: () => void;
}

export const PurchaseTerminalView: React.FC<PurchaseTerminalViewProps> = ({
  items,
  suppliers,
  cashboxes,
  user = null,
  barcodeScanMode,
  latestItemFirst = false,
  onBack,
  onSuccess,
  onOpenSupplierModal,
}) => {
  const {
    activeAllowedWarehouses,
    defaultWarehouseId,
    canChooseWarehouse,
  } = useUserWarehouses(user);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [warehouseStockMap, setWarehouseStockMap] = useState<Record<string, number> | null>(null);

  const [supplierId, setSupplierId] = useState<string>(suppliers[0]?.id || '');
  const [paymentType, setPaymentType] = useState<'نقدي' | 'آجل' | 'جزئي'>('نقدي');
  const [cashboxId, setCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [paidAmount, setPaidAmount] = useState<number | ''>(0);
  const [notes, setNotes] = useState('');

  // Cart / Lines
  const [lines, setLines] = useState<PurchaseLineItem[]>([]);

  // Search & Barcode
  const [barcodeInput, setBarcodeInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [focusQtyToken, setFocusQtyToken] = useState<number>(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnknownResultError, setIsUnknownResultError] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

  useEffect(() => {
    if (!selectedItemId || !focusQtyToken) return;
    const timer = setTimeout(() => {
      const rowEl = document.querySelector(
        `[data-purchase-row-id="${CSS.escape(selectedItemId)}"]`
      ) as HTMLElement | null;
      rowEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      const qtyInput = document.querySelector(
        `[data-purchase-qty-input-id="${CSS.escape(selectedItemId)}"]`
      ) as HTMLInputElement | null;
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }, 30);
    return () => clearTimeout(timer);
  }, [selectedItemId, focusQtyToken]);

  // ضبط المخزن الافتراضي للمستخدم
  useEffect(() => {
    if (activeAllowedWarehouses.length === 0) return;
    if (!selectedWarehouseId || !activeAllowedWarehouses.some((w) => w.id === selectedWarehouseId)) {
      setSelectedWarehouseId(defaultWarehouseId || activeAllowedWarehouses[0].id);
    }
  }, [activeAllowedWarehouses, defaultWarehouseId, selectedWarehouseId]);

  const selectedWarehouse = useMemo(() => {
    return (
      activeAllowedWarehouses.find((w) => w.id === selectedWarehouseId) ||
      activeAllowedWarehouses[0] ||
      null
    );
  }, [activeAllowedWarehouses, selectedWarehouseId]);

  // جلب أرصدة المخزن المختار لعرض الكمية الفعلية في المخزن المستلم
  useEffect(() => {
    let active = true;
    if (!selectedWarehouseId) {
      setWarehouseStockMap(null);
      return;
    }
    fetchAllWarehouseStockMap(selectedWarehouseId)
      .then((map) => {
        if (active) setWarehouseStockMap(map);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedWarehouseId]);

  const warehouseAwareItems = useMemo(() => {
    if (!warehouseStockMap) return items;
    return items.map((it) =>
      warehouseStockMap[it.id] !== undefined
        ? { ...it, stockQuantity: warehouseStockMap[it.id] }
        : it
    );
  }, [items, warehouseStockMap]);

  useEffect(() => {
    if (!warehouseStockMap) return;
    setLines((prev) =>
      prev.map((l) =>
        warehouseStockMap[l.itemId] !== undefined
          ? { ...l, currentStock: warehouseStockMap[l.itemId] }
          : l
      )
    );
  }, [warehouseStockMap]);

  // Focus barcode input on mount
  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  // Selected supplier details
  const selectedSupplier = useMemo(() => {
    return suppliers.find((s) => s.id === supplierId);
  }, [suppliers, supplierId]);

  // Selected cashbox details
  const selectedCashbox = useMemo(() => {
    return cashboxes.find((c) => c.id === cashboxId);
  }, [cashboxes, cashboxId]);

  // Filtered catalog items based on search query
  const filteredCatalogItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return warehouseAwareItems.slice(0, 12);
    }
    return warehouseAwareItems
      .filter((it) => {
        const matchName = it.name?.toLowerCase().includes(q);
        const matchBarcode = it.barcode?.toLowerCase().includes(q);
        const matchSecBarcode = it.secondaryBarcodes?.some((b) => b.toLowerCase().includes(q));
        const matchSku = it.sku?.toLowerCase().includes(q);
        return matchName || matchBarcode || matchSecBarcode || matchSku;
      })
      .slice(0, 24);
  }, [warehouseAwareItems, searchQuery]);

  // Total invoice calculation
  const totalAmount = useMemo(() => {
    return lines.reduce((sum, l) => sum + l.total, 0);
  }, [lines]);

  const totalQuantity = useMemo(() => {
    return lines.reduce((sum, l) => sum + l.quantity, 0);
  }, [lines]);

  // Auto-set paid amount when payment type changes
  useEffect(() => {
    if (paymentType === 'نقدي') {
      setPaidAmount(totalAmount);
    } else if (paymentType === 'آجل') {
      setPaidAmount(0);
    }
  }, [paymentType, totalAmount]);

  // Add or increment item in lines
  const handleAddItemToInvoice = (item: Item, explicitBarcode?: string) => {
    playBeep();
    setLines((prev) => {
      const existingIndex = prev.findIndex((l) => l.itemId === item.id);
      const defaultPrice = item.purchasePrice || 0;
      if (existingIndex >= 0) {
        const cur = prev[existingIndex];
        const newQty = cur.quantity + 1;
        const updatedLine: PurchaseLineItem = {
          ...cur,
          quantity: newQty,
          total: newQty * cur.unitPrice,
          barcode: explicitBarcode || cur.barcode,
        };
        if (latestItemFirst) {
          return [updatedLine, ...prev.filter((_, i) => i !== existingIndex)];
        }
        const updated = [...prev];
        updated[existingIndex] = updatedLine;
        return updated;
      } else {
        const newLine: PurchaseLineItem = {
          itemId: item.id,
          itemName: item.name,
          barcode: explicitBarcode || item.barcode || '',
          quantity: 1,
          unitPrice: defaultPrice,
          total: defaultPrice,
          currentStock: item.stockQuantity || 0,
        };
        return latestItemFirst ? [newLine, ...prev] : [...prev, newLine];
      }
    });

    setScanFeedback({
      type: 'success',
      message: `تمت إضافة الصنف: "${item.name}"`,
    });
    setTimeout(() => setScanFeedback(null), 3000);
  };

  // Barcode scanned from camera or handheld reader
  const handleBarcodeScanned = (scannedCode: string) => {
    const clean = scannedCode.trim().toLowerCase();
    if (!clean) return;

    setError(null);
    setScanFeedback(null);

    const found = warehouseAwareItems.find((it) => {
      if (it.barcode && it.barcode.trim().toLowerCase() === clean) return true;
      if (it.secondaryBarcodes && it.secondaryBarcodes.some((b) => b.trim().toLowerCase() === clean)) return true;
      if (it.barcodes && it.barcodes.some((b) => b.barcode.trim().toLowerCase() === clean)) return true;
      if (it.sku && it.sku.trim().toLowerCase() === clean) return true;
      return false;
    });

    if (found) {
      const existingLine = lines.find((l) => l.itemId === found.id);
      const scanMode: BarcodeScanQuantityMode =
        barcodeScanMode === 'edit_quantity' ? 'edit_quantity' : 'increment';

      if (existingLine && scanMode === 'edit_quantity') {
        playBeep();
        if (latestItemFirst) {
          setLines((prev) => {
            const idx = prev.findIndex((l) => l.itemId === found.id);
            if (idx <= 0) return prev;
            const target = prev[idx];
            return [target, ...prev.filter((_, i) => i !== idx)];
          });
        }
        setSelectedItemId(found.id);
        if (!isCameraModalOpen) {
          setFocusQtyToken((prev) => prev + 1);
        }
        setScanFeedback({
          type: 'success',
          message: `تم تحديد سطر الصنف "${found.name}" (الكمية الحالية: ${existingLine.quantity}) — يمكنك تعديل الكمية يدويًا`,
        });
        setBarcodeInput('');
        setTimeout(() => setScanFeedback(null), 3000);
        return;
      }

      handleAddItemToInvoice(found, clean);
      setSelectedItemId(found.id);
      setBarcodeInput('');
    } else {
      setScanFeedback({
        type: 'error',
        message: `لم يُعثر على صنف بالباركود [${clean}]. يمكنك البحث باسم الصنف وإضافته.`,
      });
      setSearchQuery(clean);
    }
  };

  const handleManualBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (code) {
      setBarcodeInput('');
      handleBarcodeScanned(code);
    }
  };

  const handleUpdateQuantity = (itemId: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveLine(itemId);
      return;
    }
    setLines((prev) =>
      prev.map((l) => {
        if (l.itemId === itemId) {
          return {
            ...l,
            quantity: newQty,
            total: newQty * l.unitPrice,
          };
        }
        return l;
      })
    );
  };

  const handleUpdateUnitPrice = (itemId: string, newPrice: number) => {
    const validPrice = Math.max(0, newPrice);
    setLines((prev) =>
      prev.map((l) => {
        if (l.itemId === itemId) {
          return {
            ...l,
            unitPrice: validPrice,
            total: l.quantity * validPrice,
          };
        }
        return l;
      })
    );
  };

  const handleRemoveLine = (itemId: string) => {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
    setSelectedItemId((prev) => (prev === itemId ? null : prev));
  };

  const handleClearAll = () => {
    if (lines.length === 0) return;
    setLines([]);
    setError(null);
    setIsUnknownResultError(false);
    idempotencyKeyRef.current = generateIdempotencyKey();
  };

  const submitPurchase = async () => {
    if (!supplierId) {
      setError('يرجى تحديد المورد لإصدار الفاتورة باسمه');
      return;
    }
    if (lines.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل لفاتورة الشراء');
      return;
    }

    const numPaid = Number(paidAmount || 0);
    if (numPaid > totalAmount) {
      setError('المبلغ المسدد لا يمكن أن يتجاوز إجمالي الفاتورة');
      return;
    }

    if (numPaid > 0 && !cashboxId) {
      setError('يرجى اختيار الخزينة المخصصة لصرف المبلغ المسدد');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setIsUnknownResultError(false);

    try {
      const res = await api.createPurchase({
        supplierId,
        warehouseId: selectedWarehouseId || undefined,
        paymentType,
        cashboxId: numPaid > 0 ? cashboxId : undefined,
        paidAmount: numPaid,
        notes: notes.trim(),
        idempotencyKey: idempotencyKeyRef.current,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          itemName: l.itemName,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          unitCost: l.unitPrice,
          barcode: l.barcode || '',
          totalPrice: l.total,
        })),
      });

      if (res.success) {
        idempotencyKeyRef.current = generateIdempotencyKey();
        onSuccess();
      } else {
        setError(res.error || 'فشل حفظ فاتورة الشراء');
        setIsUnknownResultError(res.code === 'UNKNOWN_RESULT');
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ فاتورة الشراء');
      setIsUnknownResultError(err?.code === 'UNKNOWN_RESULT');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitPurchase();
  };

  const remainingDebt = Math.max(0, totalAmount - Number(paidAmount || 0));

  return (
    <PageSurface
      title="إنشاء فاتورة شراء"
      subtitle="إدخال الأصناف بالباركود أو الاسم، وتحديث أرصدة المخزون وحساب المورد فورياً"
      actions={
        <>
          {lines.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-rose-300 ui-stock-out hover:bg-rose-50/40 text-xs font-bold transition cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>إفراغ الأصناف ({lines.length})</span>
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة للمشتريات</span>
          </button>
        </>
      }
    >
      {/* 1. بيانات المورد وطريقة المحاسبة */}
      <SectionHeading
        title="1. بيانات المورد وطريقة المحاسبة"
        actions={
          onOpenSupplierModal ? (
            <button
              type="button"
              onClick={onOpenSupplierModal}
              className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-link text-xs font-bold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مورد جديد</span>
            </button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-start gap-3">
        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">المخزن المستلم</label>
          {canChooseWarehouse ? (
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold`}
            >
              {activeAllowedWarehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.name}
                  {wh.isDefault ? ' (افتراضي)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} flex items-center text-xs font-bold`}>
              {selectedWarehouse?.name || 'المخزن الرئيسي'}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">المورد *</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-bold`}
          >
            <option value="">-- اختر المورد --</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.currentBalance ? `(مديونية: ${s.currentBalance} ج.م)` : ''}
              </option>
            ))}
          </select>
          {selectedSupplier && (
            <p className="mt-1 text-[11px] font-semibold text-[var(--text-secondary)]">
              الرصيد الحالي:{' '}
              <span className={`font-mono font-bold ${selectedSupplier.currentBalance > 0 ? 'ui-stock-low' : ''}`}>
                {selectedSupplier.currentBalance.toLocaleString()} ج.م
              </span>
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">طريقة السداد *</label>
          <select
            value={paymentType}
            onChange={(e) => setPaymentType(e.target.value as any)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold`}
          >
            <option value="نقدي">نقدي بالكامل (سداد فوري)</option>
            <option value="آجل">آجل بالكامل (على الحساب)</option>
            <option value="جزئي">سداد جزئي والباقي دين</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">خزينة الصرف</label>
          <select
            value={cashboxId}
            onChange={(e) => setCashboxId(e.target.value)}
            disabled={paymentType === 'آجل'}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs disabled:opacity-50`}
          >
            {cashboxes.map((cb) => (
              <option key={cb.id} value={cb.id}>
                {cb.name} ({cb.currentBalance.toLocaleString()} ج.م)
              </option>
            ))}
          </select>
          {selectedCashbox && paymentType !== 'آجل' && (
            <p className="mt-1 text-[11px] font-semibold text-[var(--text-secondary)]">
              المتاح:{' '}
              <span className="font-mono font-bold ui-money-purchase">
                {selectedCashbox.currentBalance.toLocaleString()} ج.م
              </span>
            </p>
          )}
        </div>
      </div>

      {/* 2. إدخال الأصناف وبنود الفاتورة */}
      <SectionHeading
        withTopDivider
        title={`2. إدخال الأصناف (${lines.length} أصناف · إجمالي الكمية: ${totalQuantity})`}
      />

      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={() => setIsCameraModalOpen(true)}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white font-bold text-xs transition cursor-pointer"
        >
          <Camera className="w-4 h-4" />
          <span>مسح بالكاميرا</span>
        </button>

        <form onSubmit={handleManualBarcodeSubmit} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
              الباركود (Enter للإضافة)
            </label>
            <div className="relative">
              <input
                ref={barcodeInputRef}
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="امسح أو أدخل الكود..."
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} pr-9 text-xs font-mono`}
              />
              <Barcode className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
            </div>
          </div>
          <button
            type="submit"
            disabled={!barcodeInput.trim()}
            className="min-h-[44px] px-4 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white font-bold text-xs transition cursor-pointer disabled:opacity-40"
          >
            إضافة
          </button>
        </form>

        <div>
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">بحث في الكتالوج</label>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="اسم الصنف، الكود، أو الباركود..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} pr-9 text-xs`}
            />
            <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
          </div>
        </div>
      </div>

      {scanFeedback && (
        <div
          className={`p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
            scanFeedback.type === 'success'
              ? 'border-emerald-300 text-emerald-800 bg-emerald-50/40 font-bold'
              : 'border-rose-300 ui-stock-out bg-rose-50/40'
          }`}
        >
          <div className="flex items-center gap-1.5">
            {scanFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{scanFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setScanFeedback(null)}
            className="min-h-[44px] px-2 text-xs text-[var(--text-secondary)] cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Quick Catalog Picker */}
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-[var(--text-secondary)]">
          {searchQuery ? `نتائج البحث (${filteredCatalogItems.length})` : 'أصناف الكتالوج (اضغط للإضافة):'}
        </div>
        {filteredCatalogItems.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)] py-2">لم يُعثر على أصناف مطابقة لكلمة البحث</p>
        ) : (
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto py-1">
            {filteredCatalogItems.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => handleAddItemToInvoice(it)}
                className="min-h-[44px] px-3 py-1.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-right transition cursor-pointer flex items-center gap-2 text-xs"
              >
                <span className="font-bold text-[var(--text-primary)]">{it.name}</span>
                <span className="font-mono ui-money-sale font-bold">{it.purchasePrice || 0} ج.م</span>
                <span className="font-mono text-[11px] text-[var(--text-secondary)]">(مخزون: {it.stockQuantity})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Purchase Lines Table */}
      <CompactTable ariaLabel="بنود فاتورة الشراء">
        <thead>
          <tr>
            <th className={COMPACT_TABLE_NUM_CLASS}>#</th>
            <th>الصنف والباركود</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>المخزون الحالي</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>الكمية</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>سعر الشراء (ج.م)</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>الإجمالي</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>حذف</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-8 text-center text-xs text-[var(--text-secondary)]">
                لم يتم إضافة أصناف لفاتورة الشراء بعد — امسح الباركود أو اختر من الكتالوج أعلاه
              </td>
            </tr>
          ) : (
            lines.map((line, idx) => {
              const isSelectedLine = selectedItemId === line.itemId;
              return (
              <tr
                key={line.itemId}
                data-purchase-row-id={line.itemId}
                data-selected-line={isSelectedLine ? 'true' : undefined}
                className={isSelectedLine ? 'bg-sky-50/80 ring-2 ring-inset ring-[#1668B2]' : undefined}
              >
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>{idx + 1}</td>
                <td className={COMPACT_TABLE_TEXT_CLASS}>
                  <div className="font-bold">{line.itemName}</div>
                  {line.barcode && (
                    <div className="text-[11px] text-[var(--text-secondary)] font-mono">كود: {line.barcode}</div>
                  )}
                </td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                  {line.currentStock}
                </td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleUpdateQuantity(line.itemId, line.quantity - 1)}
                      aria-label="إنقاص الكمية"
                      className="min-h-[44px] min-w-[44px] rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] flex items-center justify-center cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      data-purchase-qty-input-id={line.itemId}
                      value={line.quantity}
                      onChange={(e) => handleUpdateQuantity(line.itemId, Math.max(1, parseInt(e.target.value) || 1))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          barcodeInputRef.current?.focus();
                        }
                      }}
                      className={`${FORM_CONTROL_BASE_CLASS} w-20 text-center font-bold font-mono text-xs`}
                    />
                    <button
                      type="button"
                      onClick={() => handleUpdateQuantity(line.itemId, line.quantity + 1)}
                      aria-label="زيادة الكمية"
                      className="min-h-[44px] min-w-[44px] rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] flex items-center justify-center cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => handleUpdateUnitPrice(line.itemId, parseFloat(e.target.value) || 0)}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-bold font-mono text-xs`}
                  />
                </td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-money-sale`}>
                  {line.total.toLocaleString()} ج.م
                </td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <button
                    type="button"
                    onClick={() => handleRemoveLine(line.itemId)}
                    aria-label="حذف من الفاتورة"
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg ui-stock-out hover:bg-rose-50/40 transition cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
              );
            })
          )}
        </tbody>
        {lines.length > 0 && (
          <tfoot>
            <tr className="font-bold border-t border-[var(--border-color)]">
              <td colSpan={3} className="py-2.5 px-3 text-xs">
                الإجمالي ({lines.length} أصناف)
              </td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} py-2.5 px-3 font-mono`}>{totalQuantity}</td>
              <td />
              <td className={`${COMPACT_TABLE_NUM_CLASS} py-2.5 px-3 font-mono ui-money-sale`}>
                {totalAmount.toLocaleString()} ج.م
              </td>
              <td />
            </tr>
          </tfoot>
        )}
      </CompactTable>

      {/* 3. ملخص وحساب الفاتورة */}
      <SectionHeading withTopDivider title="3. ملخص وحساب الفاتورة" />

      {error && (
        <div className="p-3 rounded-lg border border-rose-300 ui-stock-out bg-rose-50/40 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          {isUnknownResultError && (
            <button
              type="button"
              onClick={submitPurchase}
              disabled={isSubmitting}
              className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
              <span>إعادة المحاولة</span>
            </button>
          )}
        </div>
      )}

      <ReportSummaryTable
        ariaLabel="ملخص حساب فاتورة الشراء"
        rows={[
          { label: 'عدد الأصناف والقطع', value: `${lines.length} صنف (${totalQuantity} قطعة)` },
          {
            label: 'إجمالي فاتورة الشراء',
            value: `${totalAmount.toLocaleString()} ج.م`,
            valueClassName: 'ui-money-sale',
          },
          {
            label: 'المتبقي كمديونية للمورد',
            value: `${remainingDebt.toLocaleString()} ج.م`,
            valueClassName: remainingDebt > 0 ? 'ui-stock-low' : undefined,
          },
        ]}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
            المبلغ المسدد نقداً / من الخزينة (ج.م)
          </label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="0"
              max={totalAmount}
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value) || 0))}
              disabled={paymentType === 'آجل'}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-sm font-bold font-mono ui-money-purchase disabled:opacity-50`}
            />
            {paymentType === 'جزئي' && (
              <button
                type="button"
                onClick={() => setPaidAmount(totalAmount)}
                className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
                title="سداد كامل المبلغ"
              >
                الكل
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
            ملاحظات أو رقم بوليصة الشحن / الفاتورة الورقية
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="رقم إذن الاستلام، بوليصة الشحن، أو ملاحظات..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
          />
        </div>

        <button
          type="button"
          onClick={handleSubmitPurchase}
          disabled={isSubmitting || lines.length === 0 || !supplierId}
          className="min-h-[44px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs transition cursor-pointer inline-flex items-center gap-1.5"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{isSubmitting ? 'جاري حفظ الفاتورة...' : 'تأكيد وحفظ فاتورة الشراء'}</span>
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

      {/* Camera Barcode Scanner Modal */}
      <CameraBarcodeScannerModal
        isOpen={isCameraModalOpen}
        items={warehouseAwareItems}
        onClose={() => setIsCameraModalOpen(false)}
        onBarcodeDetected={(code) => {
          handleBarcodeScanned(code);
        }}
        onManualSearchRequest={(term) => {
          setSearchQuery(term);
        }}
      />
    </PageSurface>
  );
};

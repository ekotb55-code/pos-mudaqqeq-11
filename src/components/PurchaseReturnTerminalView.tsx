import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Item,
  Supplier,
  Purchase,
  PurchaseReturn,
  Cashbox,
  UserAccount,
  BarcodeScanQuantityMode
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

export interface PurchaseReturnLineItem {
  itemId: string;
  itemName: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  currentStock: number;
  maxReturnable?: number;
}

interface PurchaseReturnTerminalViewProps {
  purchases: Purchase[];
  purchaseReturns: PurchaseReturn[];
  suppliers: Supplier[];
  cashboxes: Cashbox[];
  items: Item[];
  user?: UserAccount | null;
  barcodeScanMode?: BarcodeScanQuantityMode;
  latestItemFirst?: boolean;
  onBack: () => void;
  onSuccess: () => void;
}

export const PurchaseReturnTerminalView: React.FC<PurchaseReturnTerminalViewProps> = ({
  purchases,
  purchaseReturns,
  suppliers,
  cashboxes,
  items,
  user = null,
  barcodeScanMode,
  latestItemFirst = false,
  onBack,
  onSuccess
}) => {
  const {
    activeAllowedWarehouses,
    defaultWarehouseId,
    canChooseWarehouse
  } = useUserWarehouses(user);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [warehouseStockMap, setWarehouseStockMap] = useState<Record<string, number> | null>(null);

  const [supplierId, setSupplierId] = useState<string>(suppliers[0]?.id || '');
  const [purchaseInvoiceNumber, setPurchaseInvoiceNumber] = useState<string>('');
  const [refundMethod, setRefundMethod] = useState<'خصم_مديونية' | 'استرداد_نقدي'>('خصم_مديونية');
  const [cashboxId, setCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [refundedAmount, setRefundedAmount] = useState<number | ''>(0);
  const [reason, setReason] = useState<string>('مرتجع بضاعة زائدة / تلف');

  // Return Lines
  const [lines, setLines] = useState<PurchaseReturnLineItem[]>([]);

  // Barcode & Search
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
        `[data-purchase-return-row-id="${CSS.escape(selectedItemId)}"]`
      ) as HTMLElement | null;
      rowEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      const qtyInput = document.querySelector(
        `[data-purchase-return-qty-input-id="${CSS.escape(selectedItemId)}"]`
      ) as HTMLInputElement | null;
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }, 30);
    return () => clearTimeout(timer);
  }, [selectedItemId, focusQtyToken]);

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

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

  // جلب أرصدة المخزن المختار للتحقق من الكميات المتاحة للإرجاع من نفس المخزن
  useEffect(() => {
    let active = true;
    if (!selectedWarehouseId) {
      setWarehouseStockMap(null);
      return;
    }
    fetchAllWarehouseStockMap(selectedWarehouseId)
      .then(map => {
        if (active) setWarehouseStockMap(map);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedWarehouseId]);

  const warehouseAwareItems = useMemo(() => {
    if (!warehouseStockMap) return items;
    return items.map(it =>
      warehouseStockMap[it.id] !== undefined
        ? { ...it, stockQuantity: warehouseStockMap[it.id] }
        : it
    );
  }, [items, warehouseStockMap]);

  // تحديث المتاح في بنود المرتجع عند تبديل المخزن والتحقق من الكفاية
  useEffect(() => {
    if (!warehouseStockMap) return;
    setLines(prev => {
      if (prev.length === 0) return prev;
      let insufficientItem: { name: string; available: number } | null = null;
      const next = prev.map(line => {
        const latestStock = warehouseStockMap[line.itemId];
        if (latestStock === undefined) return line;
        const maxRet =
          line.maxReturnable !== undefined
            ? Math.min(line.maxReturnable, latestStock)
            : latestStock;
        if (line.quantity > latestStock && !insufficientItem) {
          insufficientItem = { name: line.itemName, available: latestStock };
        }
        return {
          ...line,
          currentStock: latestStock,
          maxReturnable: maxRet
        };
      });
      if (insufficientItem) {
        const info = insufficientItem as { name: string; available: number };
        setError(`الكمية المتاحة من "${info.name}" في المخزن المختار هي (${info.available}) فقط`);
      }
      return next;
    });
  }, [warehouseStockMap]);

  // Update supplier (and warehouse if no lines added yet) when choosing a purchase invoice
  useEffect(() => {
    if (purchaseInvoiceNumber) {
      const pur = purchases.find(p => p.invoiceNumber === purchaseInvoiceNumber);
      if (pur) {
        setSupplierId(pur.supplierId);
        if (pur.warehouseId && activeAllowedWarehouses.some(w => w.id === pur.warehouseId)) {
          setSelectedWarehouseId(pur.warehouseId);
        }
      }
    }
  }, [purchaseInvoiceNumber, purchases, activeAllowedWarehouses]);

  // Past purchases for selected supplier
  const supplierInvoices = useMemo(() => {
    if (!supplierId) return purchases;
    return purchases.filter(p => p.supplierId === supplierId && p.receivingStatus !== 'ملغاة');
  }, [purchases, supplierId]);

  // Selected supplier object
  const selectedSupplier = useMemo(() => {
    return suppliers.find(s => s.id === supplierId);
  }, [suppliers, supplierId]);

  // Filtered catalog items
  const filteredCatalogItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    // If an invoice is selected, prioritize items from that invoice
    if (purchaseInvoiceNumber) {
      const pur = purchases.find(p => p.invoiceNumber === purchaseInvoiceNumber);
      if (pur && pur.lines) {
        const purItemIds = pur.lines.map(l => l.itemId);
        const invItems = warehouseAwareItems.filter(it => purItemIds.includes(it.id));
        if (!q) return invItems;
        return invItems.filter(it => {
          return it.name?.toLowerCase().includes(q) ||
            it.barcode?.toLowerCase().includes(q) ||
            it.sku?.toLowerCase().includes(q);
        });
      }
    }

    if (!q) return warehouseAwareItems.slice(0, 12);
    return warehouseAwareItems.filter(it => {
      const matchName = it.name?.toLowerCase().includes(q);
      const matchBarcode = it.barcode?.toLowerCase().includes(q);
      const matchSec = it.secondaryBarcodes?.some(b => b.toLowerCase().includes(q));
      const matchSku = it.sku?.toLowerCase().includes(q);
      return matchName || matchBarcode || matchSec || matchSku;
    }).slice(0, 24);
  }, [warehouseAwareItems, searchQuery, purchaseInvoiceNumber, purchases]);

  const totalAmount = useMemo(() => {
    return lines.reduce((sum, l) => sum + l.total, 0);
  }, [lines]);

  const totalQuantity = useMemo(() => {
    return lines.reduce((sum, l) => sum + l.quantity, 0);
  }, [lines]);

  // Auto-set refunded amount
  useEffect(() => {
    if (refundMethod === 'استرداد_نقدي') {
      setRefundedAmount(totalAmount);
    } else {
      setRefundedAmount(0);
    }
  }, [refundMethod, totalAmount]);

  // Add item to return lines
  const handleAddItemToReturn = (item: Item, explicitBarcode?: string) => {
    if (item.stockQuantity <= 0) {
      setError(`الصنف "${item.name}" رصيده بالمخزن 0 حالياً، لا يمكن عمل مرتجع منه`);
      return;
    }

    // Check max returnable if linked to invoice
    let maxReturnable = item.stockQuantity;
    let defaultPrice = item.purchasePrice || 0;

    if (purchaseInvoiceNumber) {
      const pur = purchases.find(p => p.invoiceNumber === purchaseInvoiceNumber);
      if (pur && pur.lines) {
        const purLine = pur.lines.find(l => l.itemId === item.id);
        if (!purLine) {
          setError(`الصنف "${item.name}" غير موجود في بنود فاتورة الشراء المحددة (${purchaseInvoiceNumber})`);
          return;
        }
        defaultPrice = purLine.unitCost ?? (purLine as any).unitPrice ?? 0;
        const prevReturns = purchaseReturns.filter(r => r.purchaseInvoiceNumber === purchaseInvoiceNumber);
        const prevQty = prevReturns.reduce((sum, r) => {
          const matching = r.lines?.find(x => x.itemId === item.id);
          return sum + (matching ? matching.quantity : 0);
        }, 0);
        const remainingReturnable = Math.max(0, purLine.quantity - prevQty);
        maxReturnable = Math.min(item.stockQuantity, remainingReturnable);

        if (maxReturnable <= 0) {
          setError(`تم إرجاع كامل كمية الصنف "${item.name}" من هذه الفاتورة سابقاً`);
          return;
        }
      }
    }

    const existingLine = lines.find(l => l.itemId === item.id);
    if (existingLine && existingLine.quantity >= maxReturnable) {
      setError(`الصنف "${item.name}" وصل للحد الأقصى القابل للإرجاع (${maxReturnable})`);
      setScanFeedback({
        type: 'error',
        message: `الصنف "${item.name}" وصل للحد الأقصى القابل للإرجاع (${maxReturnable})`
      });
      setTimeout(() => setScanFeedback(null), 3000);
      return;
    }

    playBeep();
    setLines(prev => {
      const existingIndex = prev.findIndex(l => l.itemId === item.id);
      if (existingIndex >= 0) {
        const cur = prev[existingIndex];
        const newQty = Math.min(cur.quantity + 1, maxReturnable);
        const updatedLine: PurchaseReturnLineItem = {
          ...cur,
          quantity: newQty,
          total: newQty * cur.unitPrice,
          barcode: explicitBarcode || cur.barcode
        };
        if (latestItemFirst) {
          return [updatedLine, ...prev.filter((_, i) => i !== existingIndex)];
        }
        const updated = [...prev];
        updated[existingIndex] = updatedLine;
        return updated;
      } else {
        const newLine: PurchaseReturnLineItem = {
          itemId: item.id,
          itemName: item.name,
          barcode: explicitBarcode || item.barcode || '',
          quantity: 1,
          unitPrice: defaultPrice,
          total: defaultPrice,
          currentStock: item.stockQuantity,
          maxReturnable
        };
        return latestItemFirst ? [newLine, ...prev] : [...prev, newLine];
      }
    });

    setScanFeedback({
      type: 'success',
      message: `تمت إضافة: "${item.name}" للمرتجع`
    });
    setTimeout(() => setScanFeedback(null), 3000);
  };

  const handleBarcodeScanned = (scannedCode: string) => {
    const clean = scannedCode.trim().toLowerCase();
    if (!clean) return;

    setError(null);
    setScanFeedback(null);

    const found = warehouseAwareItems.find(it => {
      if (it.barcode && it.barcode.trim().toLowerCase() === clean) return true;
      if (it.secondaryBarcodes && it.secondaryBarcodes.some(b => b.trim().toLowerCase() === clean)) return true;
      if (it.barcodes && it.barcodes.some(b => b.barcode.trim().toLowerCase() === clean)) return true;
      if (it.sku && it.sku.trim().toLowerCase() === clean) return true;
      return false;
    });

    if (found) {
      const existingLine = lines.find(l => l.itemId === found.id);
      const scanMode: BarcodeScanQuantityMode =
        barcodeScanMode === 'edit_quantity' ? 'edit_quantity' : 'increment';

      if (existingLine && scanMode === 'edit_quantity') {
        playBeep();
        if (latestItemFirst) {
          setLines(prev => {
            const idx = prev.findIndex(l => l.itemId === found.id);
            if (idx <= 0) return prev;
            const target = prev[idx];
            return [target, ...prev.filter((_, i) => i !== idx)];
          });
        }
        setSelectedItemId(found.id);
        if (!isCameraModalOpen) {
          setFocusQtyToken(prev => prev + 1);
        }
        setScanFeedback({
          type: 'success',
          message: `تم تحديد سطر الصنف "${found.name}" (الكمية الحالية: ${existingLine.quantity}) — يمكنك تعديل الكمية يدويًا`
        });
        setBarcodeInput('');
        setTimeout(() => setScanFeedback(null), 3000);
        return;
      }

      handleAddItemToReturn(found, clean);
      setSelectedItemId(found.id);
      setBarcodeInput('');
    } else {
      setScanFeedback({
        type: 'error',
        message: `لم يُعثر على صنف بالباركود [${clean}]. يمكنك البحث بالاسم.`
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
    setLines(prev => prev.map(l => {
      if (l.itemId === itemId) {
        const maxLimit = l.maxReturnable !== undefined ? l.maxReturnable : l.currentStock;
        const validQty = Math.min(newQty, maxLimit);
        return {
          ...l,
          quantity: validQty,
          total: validQty * l.unitPrice
        };
      }
      return l;
    }));
  };

  const handleUpdateUnitPrice = (itemId: string, newPrice: number) => {
    const valid = Math.max(0, newPrice);
    setLines(prev => prev.map(l => {
      if (l.itemId === itemId) {
        return {
          ...l,
          unitPrice: valid,
          total: l.quantity * valid
        };
      }
      return l;
    }));
  };

  const handleRemoveLine = (itemId: string) => {
    setLines(prev => prev.filter(l => l.itemId !== itemId));
    setSelectedItemId(prev => (prev === itemId ? null : prev));
  };

  const submitReturn = async () => {
    if (!supplierId) {
      setError('يرجى اختيار المورد');
      return;
    }
    if (lines.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل لمرتجع الشراء');
      return;
    }

    for (const l of lines) {
      if (l.quantity > l.currentStock) {
        setError(`الكمية المطلوب إرجاعها من "${l.itemName}" (${l.quantity}) تتجاوز الرصيد المتاح في المخزن المختار (${l.currentStock})`);
        return;
      }
    }

    const numRefunded = Number(refundedAmount || 0);
    if (refundMethod === 'استرداد_نقدي' && numRefunded > 0 && !cashboxId) {
      setError('يرجى تحديد الخزينة التي سيتم إيداع المبلغ المسترد فيها');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setIsUnknownResultError(false);

    try {
      const res = await api.createPurchaseReturn({
        supplierId,
        warehouseId: selectedWarehouseId || undefined,
        purchaseInvoiceNumber: purchaseInvoiceNumber || undefined,
        cashboxId: refundMethod === 'استرداد_نقدي' && numRefunded > 0 ? cashboxId : undefined,
        refundedAmount: refundMethod === 'استرداد_نقدي' ? numRefunded : 0,
        reason: reason.trim(),
        idempotencyKey: idempotencyKeyRef.current,
        lines: lines.map(l => ({
          itemId: l.itemId,
          itemName: l.itemName,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          unitCost: l.unitPrice,
          totalPrice: l.total
        }))
      });

      if (res.success) {
        idempotencyKeyRef.current = generateIdempotencyKey();
        onSuccess();
      } else {
        setError(res.error || 'فشل حفظ مرتجع الشراء');
        setIsUnknownResultError(res.code === 'UNKNOWN_RESULT');
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ مرتجع الشراء');
      setIsUnknownResultError(err?.code === 'UNKNOWN_RESULT');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitReturn();
  };

  return (
    <PageSurface
      dir="rtl"
      title="تسجيل مرتجع مشتريات"
      subtitle="إرجاع الأصناف للمورد بالباركود، وخفض رصيد المخزن تلقائياً واسترداد القيمة نقداً أو كقيد دائن"
      actions={
        <>
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة للمشتريات</span>
          </button>
          {lines.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setLines([]);
                setError(null);
                setIsUnknownResultError(false);
                idempotencyKeyRef.current = generateIdempotencyKey();
              }}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-out text-xs font-bold transition cursor-pointer"
            >
              إفراغ المرتجع ({lines.length})
            </button>
          )}
        </>
      }
    >
      {/* 1. بيانات المورد وفاتورة الشراء المرتبطة */}
      <SectionHeading title="1. بيانات المورد وفاتورة الشراء المرتبطة" />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            المخزن المرتجع منه
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
            <div className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} flex items-center text-xs font-bold text-[var(--text-primary)]`}>
              {selectedWarehouse?.name || 'المخزن الرئيسي'}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            المورد *
          </label>
          <select
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setPurchaseInvoiceNumber('');
            }}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-bold`}
          >
            <option value="">-- اختر المورد --</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} {s.currentBalance ? `(مديونية: ${s.currentBalance} ج.م)` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            فاتورة الشراء الأصلية (اختياري)
          </label>
          <select
            value={purchaseInvoiceNumber}
            onChange={(e) => setPurchaseInvoiceNumber(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-medium`}
          >
            <option value="">-- مرتجع عام (بدون ربط بفاتورة) --</option>
            {supplierInvoices.map(p => (
              <option key={p.invoiceNumber} value={p.invoiceNumber}>
                {p.invoiceNumber} ({(p.netAmount || 0).toLocaleString()} ج.م) - {new Date(p.date).toLocaleDateString('ar-EG')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            طريقة التسوية المالية *
          </label>
          <select
            value={refundMethod}
            onChange={(e) => setRefundMethod(e.target.value as any)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold`}
          >
            <option value="خصم_مديونية">خصم من مديونية المورد (قيد على الحساب)</option>
            <option value="استرداد_نقدي">استرداد نقدي فوري بالخزينة</option>
          </select>
        </div>

        {refundMethod === 'استرداد_نقدي' && (
          <>
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                خزينة الإيداع
              </label>
              <select
                value={cashboxId}
                onChange={(e) => setCashboxId(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-medium`}
              >
                {cashboxes.map(cb => (
                  <option key={cb.id} value={cb.id}>
                    {cb.name} (رصيدها: {cb.currentBalance.toLocaleString()} ج.م)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                المبلغ المسترد نقداً
              </label>
              <input
                type="number"
                min="0"
                max={totalAmount}
                value={refundedAmount}
                onChange={(e) => setRefundedAmount(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs font-bold font-mono ui-money-sale`}
              />
            </div>
          </>
        )}
      </div>

      {selectedSupplier && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
          <span>
            مديونية المورد:{' '}
            <strong className="font-mono ui-money-purchase">
              {selectedSupplier.currentBalance.toLocaleString()} ج.م
            </strong>
          </span>
          <span>·</span>
          <span>
            {purchaseInvoiceNumber
              ? 'تم تحديد الفاتورة: سيتم حصر المرتجع في بنودها فقط'
              : 'مرتجع عام: يمكن إرجاع أي صنف متاح في المخزن المختار'}
          </span>
        </div>
      )}

      {/* 2. اختيار الأصناف المرتجعة */}
      <SectionHeading title="2. اختيار الأصناف المرتجعة (باركود / كاميرا / بحث)" withTopDivider />

      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={() => setIsCameraModalOpen(true)}
          className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition cursor-pointer"
        >
          <Camera className="w-4 h-4" />
          <span>مسح بالكاميرا</span>
        </button>

        <form onSubmit={handleManualBarcodeSubmit} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
              باركود أو كود الصنف
            </label>
            <div className="relative">
              <input
                ref={barcodeInputRef}
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="امسح الباركود أو اكتب الكود..."
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
            إضافة
          </button>
        </form>

        <div>
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            البحث بالاسم أو الباركود
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم أو الباركود..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} pl-3 pr-9 text-xs`}
            />
            <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
          </div>
        </div>
      </div>

      {scanFeedback && (
        <div
          className={`flex items-center justify-between gap-2 text-xs font-bold ${
            scanFeedback.type === 'success' ? 'ui-stock-in' : 'ui-stock-out'
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
            className="text-xs underline cursor-pointer"
          >
            إخفاء
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-[var(--text-secondary)]">
          {purchaseInvoiceNumber ? 'أصناف فاتورة الشراء المحددة (اضغط للإرجاع):' : 'أصناف الكتالوج (اضغط للإرجاع):'}
        </div>

        {filteredCatalogItems.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">لم يُعثر على أصناف متوفرة للمرتجع</p>
        ) : (
          <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto py-1">
            {filteredCatalogItems.map(it => (
              <button
                key={it.id}
                type="button"
                onClick={() => handleAddItemToReturn(it)}
                className="min-h-[44px] px-3 py-1.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-right transition cursor-pointer flex items-center gap-3"
              >
                <div className="min-w-0 max-w-[200px]">
                  <div className="text-xs font-bold text-[var(--text-primary)] truncate">{it.name}</div>
                  <div className="text-[11px] text-[var(--text-secondary)] font-mono truncate">
                    {it.barcode || 'بدون باركود'}
                  </div>
                </div>
                <div className="text-left shrink-0">
                  <div className="text-xs font-bold font-mono ui-money-purchase">{it.purchasePrice || 0} ج.م</div>
                  <div className="text-[11px] text-[var(--text-secondary)] font-mono">متاح: {it.stockQuantity}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3. الأصناف المراد إرجاعها */}
      <SectionHeading
        title={`3. الأصناف المراد إرجاعها (${lines.length})`}
        actions={
          <span className="text-xs font-bold font-mono ui-stock-low">
            إجمالي القطع: {totalQuantity}
          </span>
        }
        withTopDivider
      />

      {lines.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">
          لم يتم اختيار أصناف للمرتجع بعد. امسح الباركود أو اختر الصنف من القائمة أعلاه.
        </p>
      ) : (
        <CompactTable ariaLabel="جدول الأصناف المرتجعة للمورد">
          <thead>
            <tr>
              <th className={COMPACT_TABLE_NUM_CLASS}>#</th>
              <th className={COMPACT_TABLE_TEXT_CLASS}>الصنف والباركود</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>كمية المرتجع</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>سعر الوحدة المرتجع</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>الإجمالي</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>حذف</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const isSelectedLine = selectedItemId === line.itemId;
              return (
              <tr
                key={line.itemId}
                data-purchase-return-row-id={line.itemId}
                data-selected-line={isSelectedLine ? 'true' : undefined}
                className={isSelectedLine ? 'bg-sky-50/80 ring-2 ring-inset ring-[#1668B2]' : undefined}
              >
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                  {idx + 1}
                </td>
                <td className={COMPACT_TABLE_TEXT_CLASS}>
                  <div className="font-bold text-[var(--text-primary)]">{line.itemName}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-[var(--text-secondary)] font-mono">
                    {line.barcode && <span>كود: {line.barcode}</span>}
                    <span>متاح بالمخزن: {line.currentStock}</span>
                    {line.maxReturnable !== undefined && (
                      <span className="ui-stock-low font-bold">حد أقصى: {line.maxReturnable}</span>
                    )}
                  </div>
                </td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleUpdateQuantity(line.itemId, line.quantity - 1)}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                      aria-label="إنقاص الكمية"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      max={line.maxReturnable || line.currentStock}
                      data-purchase-return-qty-input-id={line.itemId}
                      value={line.quantity}
                      onChange={(e) => handleUpdateQuantity(line.itemId, Math.max(1, parseInt(e.target.value) || 1))}
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
                      onClick={() => handleUpdateQuantity(line.itemId, line.quantity + 1)}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                      aria-label="زيادة الكمية"
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
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono font-bold text-xs`}
                  />
                </td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-money-purchase`}>
                  {line.total.toLocaleString()} ج.م
                </td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <button
                    type="button"
                    onClick={() => handleRemoveLine(line.itemId)}
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg ui-stock-out hover:bg-[var(--surface-subtle)] transition cursor-pointer"
                    aria-label="حذف الصنف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </CompactTable>
      )}

      {/* 4. ملخص مرتجع المشتريات والتأكيد */}
      <SectionHeading title="4. ملخص مرتجع المشتريات والتأكيد" withTopDivider />

      {error && (
        <div className="flex items-center justify-between gap-2 text-xs font-bold ui-stock-out">
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
          {isUnknownResultError && (
            <button
              type="button"
              onClick={submitReturn}
              disabled={isSubmitting}
              className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
              <span>إعادة المحاولة</span>
            </button>
          )}
        </div>
      )}

      <ReportSummaryTable
        ariaLabel="ملخص مرتجع المشتريات"
        rows={[
          { label: 'أصناف المرتجع', value: `${lines.length} صنف (${totalQuantity} قطعة)` },
          { label: 'إجمالي قيمة المرتجع', value: `${totalAmount.toLocaleString()} ج.م`, tone: 'purchase', emphasize: true },
          {
            label: 'أثر المرتجع على الحساب',
            value:
              refundMethod === 'استرداد_نقدي'
                ? `إيداع نقدي (${Number(refundedAmount || 0).toLocaleString()} ج.م)`
                : `خصم ${totalAmount.toLocaleString()} ج.م من المديونية`,
          },
        ]}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
            سبب الإرجاع أو ملاحظات الفحص *
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثال: عيب مصنعي / شحنة زائدة / انتهاء الصلاحية..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
          />
        </div>

        <button
          type="button"
          onClick={handleSubmitReturn}
          disabled={isSubmitting || lines.length === 0 || !supplierId}
          className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs transition cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{isSubmitting ? 'جاري تسجيل المرتجع وخصم المخزون...' : 'تأكيد وحفظ مرتجع الشراء'}</span>
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

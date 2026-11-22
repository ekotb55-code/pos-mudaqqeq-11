import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ArrowLeftRight,
  Barcode,
  Camera,
  Search,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Loader2,
  Plus,
  RefreshCw,
  ClipboardList,
  X
} from 'lucide-react';
import { api } from '../api/client';
import {
  Item,
  UserAccount,
  Warehouse,
  WarehouseDispatchOrder,
  BarcodeScanQuantityMode
} from '../types';
import { hasPermission } from '../utils/permissions';
import { normalizeArabicText, formatMoney } from '../utils/dateUtils';
import { generateIdempotencyKey } from '../utils/idempotency';
import { CameraBarcodeScannerModal } from '../components/CameraBarcodeScannerModal';
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

interface WarehouseTransferPageProps {
  user: UserAccount;
  items: Item[];
  allowNegativeWarehouseTransfer?: boolean;
  barcodeScanMode?: BarcodeScanQuantityMode;
  latestItemFirst?: boolean;
  onRefreshData?: () => void | Promise<void>;
  onNavigateToDispatchOrders?: () => void;
}

interface TransferDraftLine {
  itemId: string;
  itemName: string;
  barcode: string;
  sku: string;
  notes: string;
  unit: string;
  purchasePrice: number;
  fromStock: number;
  toStock: number;
  quantity: number;
}

function normalizeCode(val?: string | null): string {
  return String(val || '').trim().toLowerCase();
}

function isItemActive(item: Item): boolean {
  const st = String(item.status || '').trim();
  return st !== 'inactive' && st !== 'موقوف' && st !== 'مؤرشف';
}

function itemMatchesBarcode(item: Item, query: string): boolean {
  const q = normalizeCode(query);
  if (!q) return false;
  if (normalizeCode(item.barcode) === q) return true;
  if (normalizeCode(item.sku) === q) return true;
  if (Array.isArray(item.secondaryBarcodes)) {
    if (item.secondaryBarcodes.some(code => normalizeCode(code) === q)) return true;
  }
  if (Array.isArray(item.barcodes)) {
    if (item.barcodes.some(b => normalizeCode(b.barcode) === q)) return true;
  }
  return false;
}

export const WarehouseTransferPage: React.FC<WarehouseTransferPageProps> = ({
  user,
  items: propItems,
  allowNegativeWarehouseTransfer: propAllowNegative = false,
  barcodeScanMode,
  latestItemFirst = false,
  onRefreshData,
  onNavigateToDispatchOrders
}) => {
  const canViewPurchase =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'prices.view_purchase');

  const [sourceWarehouses, setSourceWarehouses] = useState<Warehouse[]>([]);
  const [targetWarehouses, setTargetWarehouses] = useState<Warehouse[]>([]);
  const [catalogItems, setCatalogItems] = useState<Item[]>(propItems || []);
  const [allowNegativeTransfer, setAllowNegativeTransfer] = useState<boolean>(
    Boolean(propAllowNegative)
  );
  const [isLoadingContext, setIsLoadingContext] = useState<boolean>(true);
  const [contextError, setContextError] = useState<string | null>(null);

  const [fromWarehouseId, setFromWarehouseId] = useState<string>('');
  const [toWarehouseId, setToWarehouseId] = useState<string>('');
  const [isPairConfirmed, setIsPairConfirmed] = useState<boolean>(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [transferNotes, setTransferNotes] = useState<string>('');

  // Warehouse change confirmation when lines exist
  const [pendingWarehouseChange, setPendingWarehouseChange] = useState<{
    field: 'from' | 'to';
    nextWarehouseId: string;
    nextWarehouseName: string;
  } | null>(null);

  // Stock map for selected warehouses
  const [stocksMap, setStocksMap] = useState<Record<string, { fromStock: number; toStock: number }>>({});
  const [isRefreshingStocks, setIsRefreshingStocks] = useState<boolean>(false);

  // Lines & item entry
  const [lines, setLines] = useState<TransferDraftLine[]>([]);
  const [barcodeInput, setBarcodeInput] = useState<string>('');
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState<boolean>(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [focusQtyToken, setFocusQtyToken] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);

  // Submit & confirmation
  const [isConfirmSaveOpen, setIsConfirmSaveOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<WarehouseDispatchOrder | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const searchWrapperRef = useRef<HTMLDivElement | null>(null);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

  useEffect(() => {
    if (!selectedItemId || !focusQtyToken) return;
    const timer = setTimeout(() => {
      const rowEl = document.querySelector(
        `[data-transfer-row-id="${CSS.escape(selectedItemId)}"]`
      ) as HTMLElement | null;
      rowEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      const qtyInput = document.querySelector(
        `[data-transfer-qty-input-id="${CSS.escape(selectedItemId)}"]`
      ) as HTMLInputElement | null;
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }, 30);
    return () => clearTimeout(timer);
  }, [selectedItemId, focusQtyToken]);

  useEffect(() => {
    setAllowNegativeTransfer(Boolean(propAllowNegative));
  }, [propAllowNegative]);

  useEffect(() => {
    if (Array.isArray(propItems) && propItems.length > 0) {
      setCatalogItems(propItems);
    }
  }, [propItems]);

  const loadContext = useCallback(async () => {
    setIsLoadingContext(true);
    setContextError(null);
    try {
      const ctxRes = await api.getWarehouseTransferContext();
      if (!ctxRes.success) {
        setContextError(ctxRes.error || 'تعذر تحميل بيانات المخازن للتحويل');
        return;
      }
      const srcList = ctxRes.sourceWarehouses || [];
      const tgtList = ctxRes.targetWarehouses || [];
      setSourceWarehouses(srcList);
      setTargetWarehouses(tgtList);
      if (ctxRes.stockSettings) {
        setAllowNegativeTransfer(Boolean(ctxRes.stockSettings.allowNegativeWarehouseTransfer));
      }

      if (srcList.length > 0 && !fromWarehouseId) {
        const defaultSrc = srcList.find(w => w.isDefault) || srcList[0];
        setFromWarehouseId(defaultSrc.id);
        const firstOther = tgtList.find(w => w.id !== defaultSrc.id);
        if (firstOther && !toWarehouseId) {
          setToWarehouseId(firstOther.id);
        }
      }

      if (!propItems || propItems.length === 0) {
        try {
          const itemsRes = await api.getItems();
          if (itemsRes.success && Array.isArray(itemsRes.items)) {
            setCatalogItems(itemsRes.items);
          }
        } catch {
          // ignore if items prop arrives separately
        }
      }
    } catch (err: any) {
      setContextError(err.message || 'تعذر تحميل بيانات المخازن');
    } finally {
      setIsLoadingContext(false);
    }
  }, [fromWarehouseId, toWarehouseId, propItems]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    const handleClickOutside = (ev: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(ev.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchAndSyncStocks = useCallback(
    async (fId: string, tId: string) => {
      if (!fId || !tId || fId === tId) return;
      setIsRefreshingStocks(true);
      try {
        const res = await api.getWarehouseTransferStocks({
          fromWarehouseId: fId,
          toWarehouseId: tId
        });
        if (res.success && res.stocks) {
          const nextMap = res.stocks;
          setStocksMap(nextMap);
          setLines(prev =>
            prev.map(line => {
              const pair = nextMap[line.itemId];
              return pair
                ? { ...line, fromStock: pair.fromStock, toStock: pair.toStock }
                : line;
            })
          );
        }
      } catch (err: any) {
        setPairError(err.message || 'تعذر جلب أرصدة المخازن');
      } finally {
        setIsRefreshingStocks(false);
      }
    },
    []
  );

  const fromWarehouse = useMemo(
    () => sourceWarehouses.find(w => w.id === fromWarehouseId),
    [sourceWarehouses, fromWarehouseId]
  );

  const toWarehouse = useMemo(
    () => targetWarehouses.find(w => w.id === toWarehouseId),
    [targetWarehouses, toWarehouseId]
  );

  const handleConfirmPair = async () => {
    setPairError(null);
    if (!fromWarehouseId || !toWarehouseId) {
      setPairError('يرجى اختيار المخزن المحوِّل والمخزن المحوَّل إليه');
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setPairError('لا يمكن التحويل من مخزن إلى نفس المخزن');
      return;
    }
    setIsPairConfirmed(true);
    setCreatedOrder(null);
    await fetchAndSyncStocks(fromWarehouseId, toWarehouseId);
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 60);
  };

  const applyWarehouseSwitch = async (field: 'from' | 'to', nextId: string) => {
    const nextFrom = field === 'from' ? nextId : fromWarehouseId;
    const nextTo = field === 'to' ? nextId : toWarehouseId;
    if (field === 'from') {
      setFromWarehouseId(nextId);
    } else {
      setToWarehouseId(nextId);
    }
    setPairError(null);
    setSubmitError(null);

    if (!nextFrom || !nextTo || nextFrom === nextTo) {
      if (nextFrom && nextTo && nextFrom === nextTo) {
        setPairError('لا يمكن التحويل من مخزن إلى نفس المخزن، اختر مخزناً مختلفاً');
      }
      return;
    }

    if (isPairConfirmed) {
      await fetchAndSyncStocks(nextFrom, nextTo);
    }
  };

  const handleWarehouseSelectChange = (field: 'from' | 'to', nextId: string) => {
    if (!nextId) return;
    const otherId = field === 'from' ? toWarehouseId : fromWarehouseId;
    if (nextId === otherId) {
      setPairError('لا يمكن اختيار نفس المخزن كمحوِّل ومحوَّل إليه');
      return;
    }

    const whList = field === 'from' ? sourceWarehouses : targetWarehouses;
    const targetWh = whList.find(w => w.id === nextId);

    if (lines.length > 0 && isPairConfirmed) {
      setPendingWarehouseChange({
        field,
        nextWarehouseId: nextId,
        nextWarehouseName: targetWh?.name || ''
      });
      return;
    }

    void applyWarehouseSwitch(field, nextId);
  };

  const handleConfirmPendingWarehouseChange = async () => {
    if (!pendingWarehouseChange) return;
    const { field, nextWarehouseId } = pendingWarehouseChange;
    setPendingWarehouseChange(null);
    await applyWarehouseSwitch(field, nextWarehouseId);
  };

  const addOrIncrementItem = useCallback(
    (item: Item) => {
      setSubmitError(null);
      setBarcodeError(null);
      setCreatedOrder(null);

      const pair = stocksMap[item.id] || { fromStock: 0, toStock: 0 };

      setLines(prev => {
        const existingIdx = prev.findIndex(l => l.itemId === item.id);
        if (existingIdx >= 0) {
          const cur = prev[existingIdx];
          const updatedLine: TransferDraftLine = {
            ...cur,
            quantity: Math.round((Number(cur.quantity || 0) + 1) * 1000) / 1000
          };
          if (latestItemFirst) {
            return [updatedLine, ...prev.filter((_, idx) => idx !== existingIdx)];
          }
          return prev.map((l, idx) => (idx === existingIdx ? updatedLine : l));
        }
        const newLine: TransferDraftLine = {
          itemId: item.id,
          itemName: item.name,
          barcode: item.barcode || '',
          sku: item.sku || '',
          notes: item.notes || '',
          unit: item.unit || 'قطعة',
          purchasePrice: Number(item.purchasePrice || 0),
          fromStock: pair.fromStock,
          toStock: pair.toStock,
          quantity: 1
        };
        return latestItemFirst ? [newLine, ...prev] : [...prev, newLine];
      });
    },
    [stocksMap, latestItemFirst]
  );

  const handleBarcodeScanned = (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed) return;

    setSubmitError(null);
    setBarcodeError(null);
    setScanFeedback(null);

    const matched = catalogItems.find(
      it => isItemActive(it) && itemMatchesBarcode(it, trimmed)
    );
    if (!matched) {
      const msg = `لم يتم العثور على صنف نشط بالباركود أو الكود "${trimmed}"`;
      setBarcodeError(msg);
      setScanFeedback({ type: 'error', message: msg });
      return;
    }

    const existingLine = lines.find(l => l.itemId === matched.id);
    const scanMode: BarcodeScanQuantityMode =
      barcodeScanMode === 'edit_quantity' ? 'edit_quantity' : 'increment';

    if (existingLine && scanMode === 'edit_quantity') {
      if (latestItemFirst) {
        setLines(prev => {
          const idx = prev.findIndex(l => l.itemId === matched.id);
          if (idx <= 0) return prev;
          const target = prev[idx];
          return [target, ...prev.filter((_, i) => i !== idx)];
        });
      }
      setSelectedItemId(matched.id);
      if (!isCameraModalOpen) {
        setFocusQtyToken(prev => prev + 1);
      }
      setBarcodeInput('');
      setBarcodeError(null);
      setScanFeedback({
        type: 'success',
        message: `تم تحديد سطر الصنف "${matched.name}" (الكمية الحالية: ${existingLine.quantity}) — يمكنك تعديل الكمية يدويًا`
      });
      setTimeout(() => setScanFeedback(null), 3000);
      return;
    }

    addOrIncrementItem(matched);
    setSelectedItemId(matched.id);
    setBarcodeInput('');
    setBarcodeError(null);
    setScanFeedback({
      type: 'success',
      message: `تمت إضافة الصنف: "${matched.name}"`
    });
    setTimeout(() => setScanFeedback(null), 3000);
  };

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const trimmed = (e.currentTarget.value || barcodeInput).trim();
    if (!trimmed) return;
    setBarcodeInput('');
    handleBarcodeScanned(trimmed);
  };

  const activeCatalogItems = useMemo(
    () => catalogItems.filter(isItemActive),
    [catalogItems]
  );

  const filteredSearchItems = useMemo(() => {
    const active = catalogItems.filter(isItemActive);
    const q = normalizeArabicText(searchQuery);
    if (!q) return active.slice(0, 40);
    return active
      .filter(it => {
        const haystack = normalizeArabicText(
          `${it.name} ${it.sku || ''} ${it.barcode || ''} ${(it.secondaryBarcodes || []).join(' ')} ${it.notes || ''}`
        );
        return haystack.includes(q);
      })
      .slice(0, 40);
  }, [catalogItems, searchQuery]);

  const handleUpdateLineQuantity = (itemId: string, rawVal: string) => {
    setSubmitError(null);
    if (rawVal === '') {
      setLines(prev => prev.map(l => (l.itemId === itemId ? { ...l, quantity: 0 } : l)));
      return;
    }
    const parsed = Number(rawVal);
    if (!Number.isFinite(parsed)) return;
    setLines(prev =>
      prev.map(l =>
        l.itemId === itemId
          ? { ...l, quantity: Math.max(0, Math.round(parsed * 1000) / 1000) }
          : l
      )
    );
  };

  const handleUseAvailableStock = (itemId: string) => {
    setLines(prev =>
      prev.map(l => {
        if (l.itemId !== itemId) return l;
        const available = Math.max(0, l.fromStock);
        return { ...l, quantity: available };
      })
    );
  };

  const handleRemoveLine = (itemId: string) => {
    setLines(prev => prev.filter(l => l.itemId !== itemId));
    setSelectedItemId(prev => (prev === itemId ? null : prev));
    setSubmitError(null);
  };

  const rowEvaluations = useMemo(() => {
    return lines.map(line => {
      const qty = Number(line.quantity);
      const isNonPositive = !Number.isFinite(qty) || qty <= 0;
      const isInsufficient = !allowNegativeTransfer && qty > line.fromStock;
      const isInvalid = isNonPositive || isInsufficient;
      return {
        itemId: line.itemId,
        isNonPositive,
        isInsufficient,
        isInvalid
      };
    });
  }, [lines, allowNegativeTransfer]);

  const hasAnyInvalidRow = useMemo(
    () => rowEvaluations.some(r => r.isInvalid),
    [rowEvaluations]
  );

  const summary = useMemo(() => {
    const itemsCount = lines.length;
    const totalQuantity = Math.round(
      lines.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0) * 1000
    ) / 1000;
    const totalPurchaseValue = Math.round(
      lines.reduce((acc, l) => acc + (Number(l.quantity) || 0) * (Number(l.purchasePrice) || 0), 0) * 100
    ) / 100;
    return { itemsCount, totalQuantity, totalPurchaseValue };
  }, [lines]);

  const handleOpenSaveConfirm = () => {
    setSubmitError(null);
    if (!isPairConfirmed || !fromWarehouseId || !toWarehouseId) {
      setSubmitError('يرجى تأكيد المخزن المحوِّل والمخزن المحوَّل إليه أولاً');
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setSubmitError('لا يمكن التحويل من مخزن إلى نفس المخزن');
      return;
    }
    if (lines.length === 0 || hasAnyInvalidRow) {
      setSubmitError('يرجى التأكد من صحة جميع الكميات قبل حفظ عملية التحويل');
      return;
    }
    setIsConfirmSaveOpen(true);
  };

  const handleExecuteTransfer = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.createWarehouseTransfer({
        fromWarehouseId,
        toWarehouseId,
        lines: lines.map(l => ({
          itemId: l.itemId,
          quantity: Number(l.quantity)
        })),
        notes: transferNotes.trim() || undefined,
        idempotencyKey: idempotencyKeyRef.current
      });

      if (!res.success || !res.order) {
        setSubmitError(res.error || 'تعذر تنفيذ عملية التحويل بين المخازن');
        setIsConfirmSaveOpen(false);
        await fetchAndSyncStocks(fromWarehouseId, toWarehouseId);
        return;
      }

      setCreatedOrder(res.order);
      setIsConfirmSaveOpen(false);
      setLines([]);
      setTransferNotes('');
      idempotencyKeyRef.current = generateIdempotencyKey();
      await fetchAndSyncStocks(fromWarehouseId, toWarehouseId);
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (err: any) {
      setSubmitError(err.message || 'حدث خطأ أثناء تنفيذ التحويل');
      setIsConfirmSaveOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartNewTransfer = () => {
    setCreatedOrder(null);
    setLines([]);
    setTransferNotes('');
    setSubmitError(null);
    setBarcodeError(null);
    idempotencyKeyRef.current = generateIdempotencyKey();
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 60);
  };

  return (
    <PageSurface
      dir="rtl"
      title="تحويل بين المخازن"
      subtitle={`إصدار أمر صرف فوري لنقل الأصناف · ${
        allowNegativeTransfer ? 'السماح بالتحويل بالسالب مفعل' : 'مقيد بالرصيد المتاح في المحوِّل'
      }`}
      actions={
        onNavigateToDispatchOrders ? (
          <a
            href={getHrefForTarget('warehouse_dispatch_orders')}
            onClick={(e) => {
              if (!isPlainLeftClick(e)) return;
              e.preventDefault();
              onNavigateToDispatchOrders();
            }}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition whitespace-nowrap cursor-pointer"
          >
            <ClipboardList className="w-4 h-4" />
            <span>عرض أوامر الصرف</span>
          </a>
        ) : undefined
      }
    >
      {isLoadingContext ? (
        <div className="py-12 text-center space-y-2 text-[var(--text-secondary)]">
          <Loader2 className="w-7 h-7 mx-auto animate-spin text-[var(--accent)]" />
          <p className="text-xs font-bold">جاري تجهيز شاشة التحويل بين المخازن...</p>
        </div>
      ) : contextError ? (
        <div className="py-8 text-center space-y-3">
          <AlertTriangle className="w-7 h-7 mx-auto ui-stock-out" />
          <p className="text-xs font-bold ui-stock-out">{contextError}</p>
          <button
            type="button"
            onClick={() => void loadContext()}
            className="min-h-[44px] px-4 rounded-lg bg-[#1668B2] text-white text-xs font-bold cursor-pointer"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <>
          {createdOrder && (
            <div className="px-4 py-3 rounded-lg border border-[var(--stock-in-fg)] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2 text-xs">
                <CheckCircle2 className="w-4 h-4 ui-stock-in shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold ui-stock-in">
                    تم حفظ وتنفيذ أمر الصرف رقم{' '}
                    <span className="font-mono tabular-nums">{createdOrder.dispatchNumber}</span> بنجاح
                  </p>
                  <p className="text-[var(--text-secondary)] mt-0.5">
                    من: {createdOrder.fromWarehouseName} / إلى: {createdOrder.toWarehouseName} · عدد الأصناف: {createdOrder.itemsCount} · إجمالي الكمية: {createdOrder.totalQuantity}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleStartNewTransfer}
                  className="min-h-[44px] px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition whitespace-nowrap cursor-pointer"
                >
                  تحويل جديد
                </button>
                {onNavigateToDispatchOrders && (
                  <a
                    href={getHrefForTarget('warehouse_dispatch_orders')}
                    onClick={(e) => {
                      if (!isPlainLeftClick(e)) return;
                      e.preventDefault();
                      onNavigateToDispatchOrders();
                    }}
                    className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition whitespace-nowrap cursor-pointer"
                  >
                    عرض أوامر الصرف
                  </a>
                )}
              </div>
            </div>
          )}

          {/* 1. تحديد المخازن */}
          <SectionHeading
            title="1. تحديد المخازن"
            actions={
              isPairConfirmed && fromWarehouse && toWarehouse ? (
                <span className="text-xs font-bold ui-stock-in">
                  المسار المؤكد: {fromWarehouse.name} ← {toWarehouse.name}
                </span>
              ) : undefined
            }
          />

          {sourceWarehouses.length === 0 || targetWarehouses.length < 2 ? (
            <div className="px-4 py-3 rounded-lg border border-[var(--stock-low-fg)] ui-stock-low text-xs font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                يتطلب التحويل وجود مخزنين نشطين على الأقل (ومخزن محوِّل مسموح لك). يرجى مراجعة إدارة المخازن أو صلاحيات المستخدم.
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="transfer-from-warehouse"
                  className="block text-xs font-bold text-[var(--text-secondary)] mb-1"
                >
                  من مخزن (المحوِّل)
                </label>
                <select
                  id="transfer-from-warehouse"
                  value={fromWarehouseId}
                  onChange={e => handleWarehouseSelectChange('from', e.target.value)}
                  disabled={isSubmitting}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold`}
                >
                  <option value="">اختر المخزن المحوِّل...</option>
                  {sourceWarehouses.map(wh => (
                    <option key={wh.id} value={wh.id} disabled={wh.id === toWarehouseId}>
                      {wh.name}
                      {wh.id === toWarehouseId ? ' (محدد كمحوَّل إليه)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="transfer-to-warehouse"
                  className="block text-xs font-bold text-[var(--text-secondary)] mb-1"
                >
                  إلى مخزن (المحوَّل إليه)
                </label>
                <select
                  id="transfer-to-warehouse"
                  value={toWarehouseId}
                  onChange={e => handleWarehouseSelectChange('to', e.target.value)}
                  disabled={isSubmitting}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold`}
                >
                  <option value="">اختر المخزن المحوَّل إليه...</option>
                  {targetWarehouses.map(wh => (
                    <option key={wh.id} value={wh.id} disabled={wh.id === fromWarehouseId}>
                      {wh.name}
                      {wh.id === fromWarehouseId ? ' (محدد كمحوِّل)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => void handleConfirmPair()}
                disabled={!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId || isRefreshingStocks}
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {isRefreshingStocks ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>{isPairConfirmed ? 'تحديث الأرصدة' : 'تأكيد'}</span>
              </button>
            </div>
          )}

          {pairError && (
            <div className="text-xs font-bold ui-stock-out flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{pairError}</span>
            </div>
          )}

          {/* 2. إدخال وجدول الأصناف */}
          <SectionHeading title="2. الأصناف والكميات المنقولة" withTopDivider />

          {!isPairConfirmed ? (
            <div className="py-8 text-center space-y-2 text-[var(--text-secondary)]">
              <Lock className="w-6 h-6 mx-auto opacity-50" />
              <p className="text-xs font-bold">اختر المخزن المحوِّل والمحوَّل إليه واضغط «تأكيد» لفتح جدول الأصناف</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* إدخال بالباركود، مسح بالكاميرا، اختيار وضع الإضافة، وبحث الأصناف */}
              <div className="flex flex-wrap items-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCameraModalOpen(true)}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold transition cursor-pointer shrink-0"
                  title="مسح الباركود بالكاميرا"
                >
                  <Camera className="w-4 h-4" />
                  <span>مسح بالكاميرا</span>
                </button>

                <div>
                  <label
                    htmlFor="transfer-barcode-input"
                    className="block text-xs font-bold text-[var(--text-secondary)] mb-1"
                  >
                    إدخال بالباركود / الكود (Enter)
                  </label>
                  <div className="relative">
                    <Barcode className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="transfer-barcode-input"
                      ref={barcodeInputRef}
                      type="text"
                      value={barcodeInput}
                      onChange={e => {
                        setBarcodeInput(e.target.value);
                        if (barcodeError) setBarcodeError(null);
                      }}
                      onKeyDown={handleBarcodeKeyDown}
                      placeholder="امسح الباركود واضغط Enter..."
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} pr-9 font-mono text-xs font-bold`}
                    />
                  </div>
                </div>

                <div className="relative" ref={searchWrapperRef}>
                  <label
                    htmlFor="transfer-product-search"
                    className="block text-xs font-bold text-[var(--text-secondary)] mb-1"
                  >
                    بحث وإضافة صنف
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="transfer-product-search"
                      type="text"
                      value={searchQuery}
                      onFocus={() => setIsSearchOpen(true)}
                      onChange={e => {
                        setSearchQuery(e.target.value);
                        setIsSearchOpen(true);
                      }}
                      placeholder="ابحث باسم الصنف أو الباركود..."
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} pr-9 pl-9 text-xs font-bold`}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="min-h-[44px] min-w-[36px] inline-flex items-center justify-center absolute left-1 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                        aria-label="مسح البحث"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {isSearchOpen && (
                    <div className="absolute z-30 right-0 mt-1 w-full min-w-[320px] max-w-[calc(90vw/var(--app-zoom,1))] bg-[var(--surface)] border border-[var(--border-color)] rounded-xl shadow-lg max-h-72 overflow-y-auto divide-y divide-[var(--border-subtle)]">
                      {filteredSearchItems.length === 0 ? (
                        <div className="p-4 text-center text-xs text-[var(--text-secondary)] font-medium">
                          لا توجد أصناف مطابقة لبحثك
                        </div>
                      ) : (
                        filteredSearchItems.map(item => {
                          const pair = stocksMap[item.id] || { fromStock: 0, toStock: 0 };
                          const inTable = lines.find(l => l.itemId === item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                addOrIncrementItem(item);
                                setIsSearchOpen(false);
                              }}
                              className="min-h-[44px] w-full text-right px-3.5 py-2 hover:bg-[var(--surface-subtle)] transition flex items-center justify-between gap-3 cursor-pointer"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                                    {item.name}
                                  </span>
                                  {inTable && (
                                    <span className="text-[11px] font-bold ui-link font-mono tabular-nums shrink-0">
                                      (بالجدول: {inTable.quantity})
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-[var(--text-secondary)] flex flex-wrap items-center gap-2 mt-0.5">
                                  <span className="font-mono">{item.barcode || item.sku || 'بدون باركود'}</span>
                                  {item.unit && <span>· {item.unit}</span>}
                                  {canViewPurchase && (
                                    <span className="font-mono tabular-nums">
                                      · شراء: {formatMoney(item.purchasePrice || 0)}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-3 shrink-0 text-[11px]">
                                <div className="text-center">
                                  <span className="text-[var(--text-secondary)] block text-[10px]">المحوِّل</span>
                                  <span
                                    className={`font-mono font-bold tabular-nums ${
                                      pair.fromStock <= 0 ? 'ui-stock-out' : 'text-[var(--text-primary)]'
                                    }`}
                                  >
                                    {pair.fromStock}
                                  </span>
                                </div>
                                <div className="text-center">
                                  <span className="text-[var(--text-secondary)] block text-[10px]">المحوَّل إليه</span>
                                  <span className="font-mono font-bold tabular-nums ui-link">
                                    {pair.toStock}
                                  </span>
                                </div>
                                <Plus className="w-4 h-4 ui-link shrink-0" />
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>

              {barcodeError && (
                <p className="text-xs font-bold ui-stock-out">{barcodeError}</p>
              )}

              {scanFeedback && !barcodeError && (
                <div
                  className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
                    scanFeedback.type === 'success'
                      ? 'border-emerald-300 text-emerald-800 bg-emerald-50/40'
                      : 'border-rose-300 ui-stock-out bg-rose-50/40'
                  }`}
                >
                  <span>{scanFeedback.message}</span>
                  <button
                    type="button"
                    onClick={() => setScanFeedback(null)}
                    className="text-xs text-[var(--text-secondary)] cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              )}

              {submitError && (
                <div className="px-3 py-2 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              {lines.length === 0 ? (
                <div className="py-8 text-center space-y-1 text-[var(--text-secondary)]">
                  <p className="text-xs font-bold text-[var(--text-primary)]">لم تتم إضافة أي أصناف بعد</p>
                  <p className="text-xs">امسح الباركود في الأعلى واضغط Enter، أو اختر صنفاً من قائمة البحث</p>
                </div>
              ) : (
                <CompactTable ariaLabel="جدول أصناف التحويل">
                  <thead>
                    <tr>
                      <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>#</th>
                      <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصنف</th>
                      <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>الباركود</th>
                      <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الوصف</th>
                      {canViewPurchase && (
                        <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>سعر الشراء</th>
                      )}
                      <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>رصيد المحوِّل</th>
                      <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>رصيد المحوَّل إليه</th>
                      <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الكمية المنقولة</th>
                      <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الوحدة</th>
                      <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>حذف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => {
                      const evalRow = rowEvaluations[index];
                      const isRed = evalRow?.isInvalid;
                      const isSelectedLine = selectedItemId === line.itemId;
                      return (
                        <tr
                          key={line.itemId}
                          data-transfer-row-id={line.itemId}
                          data-selected-line={isSelectedLine ? 'true' : undefined}
                          className={isSelectedLine ? 'bg-sky-50/80 ring-2 ring-inset ring-[#1668B2]' : undefined}
                        >
                          <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                            {index + 1}
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
                          {canViewPurchase && (
                            <td className={`text-center font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                              {formatMoney(line.purchasePrice)}
                            </td>
                          )}
                          <td
                            className={`text-center font-mono font-bold ${COMPACT_TABLE_NUM_CLASS} ${
                              evalRow?.isInsufficient ? 'ui-stock-out' : 'text-[var(--text-primary)]'
                            }`}
                          >
                            {line.fromStock}
                          </td>
                          <td className={`text-center font-mono font-bold ui-link ${COMPACT_TABLE_NUM_CLASS}`}>
                            {line.toStock}
                          </td>
                          <td className={COMPACT_TABLE_NUM_CLASS}>
                            <div className="flex flex-col items-center gap-1">
                              <input
                                type="number"
                                min="0.001"
                                step="any"
                                dir="ltr"
                                data-transfer-qty-input-id={line.itemId}
                                value={line.quantity === 0 ? '' : line.quantity}
                                onChange={e => handleUpdateLineQuantity(line.itemId, e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    barcodeInputRef.current?.focus();
                                  }
                                }}
                                aria-label={`الكمية المنقولة للصنف ${line.itemName}`}
                                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono font-bold ${
                                  isRed ? 'border-rose-500 ui-stock-out' : ''
                                }`}
                              />
                              {evalRow?.isNonPositive && (
                                <span className="text-[11px] font-bold ui-stock-out">أكبر من صفر</span>
                              )}
                              {!evalRow?.isNonPositive && evalRow?.isInsufficient && (
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-[11px] font-bold ui-stock-out">
                                    المتاح {line.fromStock} فقط
                                  </span>
                                  {line.fromStock > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => handleUseAvailableStock(line.itemId)}
                                      className="min-h-[36px] px-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold cursor-pointer"
                                    >
                                      استخدم المتاح
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className={`text-center text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                            {line.unit || 'قطعة'}
                          </td>
                          <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(line.itemId)}
                              title="حذف السطر"
                              aria-label={`حذف ${line.itemName}`}
                              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg ui-stock-out hover:bg-[var(--surface-subtle)] cursor-pointer"
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

              {/* الملاحظات والملخص والحفظ */}
              <div className="pt-4 border-t border-[var(--border-subtle)] flex flex-wrap items-end justify-between gap-4">
                <div>
                  <label
                    htmlFor="transfer-notes"
                    className="block text-xs font-bold text-[var(--text-secondary)] mb-1"
                  >
                    ملاحظات على أمر الصرف (اختياري)
                  </label>
                  <input
                    id="transfer-notes"
                    type="text"
                    value={transferNotes}
                    onChange={e => setTransferNotes(e.target.value)}
                    placeholder="مثال: تزويد فرع المعادي برصيد الأسبوع..."
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-[var(--text-secondary)]">
                    <span>
                      الأصناف:{' '}
                      <strong className="font-mono tabular-nums text-[var(--text-primary)]">{summary.itemsCount}</strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      إجمالي الكمية:{' '}
                      <strong className="font-mono tabular-nums text-[var(--text-primary)]">{summary.totalQuantity}</strong>
                    </span>
                    {canViewPurchase && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          إجمالي الشراء:{' '}
                          <strong className="font-mono tabular-nums ui-money-purchase">
                            {formatMoney(summary.totalPurchaseValue)} ج.م
                          </strong>
                        </span>
                      </>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenSaveConfirm}
                    disabled={
                      lines.length === 0 ||
                      hasAnyInvalidRow ||
                      isSubmitting ||
                      isRefreshingStocks
                    }
                    className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    <span>حفظ عملية التحويل</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal: Confirm Warehouse Change With Existing Lines */}
      {pendingWarehouseChange && (
        <ModalShell
          title="تأكيد تغيير المخزن"
          subtitle={`توجد ${lines.length} أصناف مضافة في الجدول الحالي`}
          onClose={() => setPendingWarehouseChange(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setPendingWarehouseChange(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmPendingWarehouseChange()}
                className="min-h-[44px] px-5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold cursor-pointer"
              >
                نعم، تغيير وإعادة الحساب
              </button>
            </>
          }
        >
          <p className="text-xs text-[var(--text-primary)] leading-relaxed max-w-md">
            هل أنت متأكد من تغيير{' '}
            {pendingWarehouseChange.field === 'from' ? 'المخزن المحوِّل' : 'المخزن المحوَّل إليه'}{' '}
            إلى «{pendingWarehouseChange.nextWarehouseName}»؟ سيتم الاحتفاظ بالأصناف المضافة وإعادة احتساب الكميات المتاحة تلقائياً.
          </p>
        </ModalShell>
      )}

      {/* Modal: Confirm Saving Transfer */}
      {isConfirmSaveOpen && (
        <ModalShell
          title="تأكيد حفظ عملية التحويل"
          subtitle="مراجعة بيانات أمر الصرف قبل التنفيذ الفوري"
          onClose={() => setIsConfirmSaveOpen(false)}
          closeDisabled={isSubmitting}
          footer={
            <>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsConfirmSaveOpen(false)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] cursor-pointer disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleExecuteTransfer()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{isSubmitting ? 'جاري التنفيذ...' : 'تأكيد وحفظ التحويل'}</span>
              </button>
            </>
          }
        >
          <div className="space-y-3 max-w-md">
            <CompactTable ariaLabel="ملخص أمر التحويل">
              <tbody>
                <tr>
                  <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>من مخزن</td>
                  <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>{fromWarehouse?.name}</td>
                </tr>
                <tr>
                  <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>إلى مخزن</td>
                  <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>{toWarehouse?.name}</td>
                </tr>
                <tr>
                  <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>عدد الأصناف</td>
                  <td className={`font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>{summary.itemsCount} صنف</td>
                </tr>
                <tr>
                  <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>إجمالي الكمية المنقولة</td>
                  <td className={`font-mono font-bold ui-link ${COMPACT_TABLE_NUM_CLASS}`}>{summary.totalQuantity}</td>
                </tr>
                {canViewPurchase && (
                  <tr>
                    <td className={`text-[var(--text-secondary)] font-bold ${COMPACT_TABLE_TEXT_CLASS}`}>إجمالي سعر الشراء</td>
                    <td className={`font-mono font-bold ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                      {formatMoney(summary.totalPurchaseValue)} ج.م
                    </td>
                  </tr>
                )}
              </tbody>
            </CompactTable>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              عند التأكيد سيتم خصم الكميات فوراً من مخزن «{fromWarehouse?.name}» وإضافتها إلى مخزن «{toWarehouse?.name}» وإصدار أمر صرف متسلسل.
            </p>
          </div>
        </ModalShell>
      )}

      {/* Camera Barcode Scanner Modal */}
      <CameraBarcodeScannerModal
        isOpen={isCameraModalOpen}
        items={activeCatalogItems}
        onClose={() => setIsCameraModalOpen(false)}
        onBarcodeDetected={code => {
          handleBarcodeScanned(code);
        }}
        onManualSearchRequest={term => {
          setSearchQuery(term);
          setIsSearchOpen(true);
        }}
      />
    </PageSurface>
  );
};

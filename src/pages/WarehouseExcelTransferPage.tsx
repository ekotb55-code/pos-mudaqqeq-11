import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  Loader2,
  Lock,
  RefreshCw,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { api } from '../api/client';
import {
  Item,
  UserAccount,
  Warehouse,
  WarehouseDispatchOrder
} from '../types';
import { formatMoney } from '../utils/dateUtils';
import { generateIdempotencyKey } from '../utils/idempotency';
import { hasPermission } from '../utils/permissions';
import {
  WarehouseExcelEvaluatedRow,
  WarehouseExcelParsedRow,
  WAREHOUSE_EXCEL_MAX_ROWS,
  downloadWarehouseTransferErrorsFile,
  downloadWarehouseTransferTemplate,
  evaluateWarehouseExcelRows,
  parseWarehouseTransferExcelBuffer
} from '../utils/warehouseExcelTransfer';
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

interface WarehouseExcelTransferPageProps {
  user: UserAccount;
  items: Item[];
  allowNegativeWarehouseTransfer?: boolean;
  onRefreshData?: () => void | Promise<void>;
  onNavigateToDispatchOrders?: () => void;
}

type PreviewStatusFilter = 'ALL' | 'READY' | 'ERRORS';

export const WarehouseExcelTransferPage: React.FC<WarehouseExcelTransferPageProps> = ({
  user,
  items: propItems,
  allowNegativeWarehouseTransfer: propAllowNegative = false,
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

  const [stocksMap, setStocksMap] = useState<Record<string, { fromStock: number; toStock: number }>>({});
  const [isRefreshingStocks, setIsRefreshingStocks] = useState<boolean>(false);

  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [parsedRows, setParsedRows] = useState<WarehouseExcelParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<PreviewStatusFilter>('ALL');

  const [isConfirmExecuteOpen, setIsConfirmExecuteOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<WarehouseDispatchOrder | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

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
          // ignore if items prop arrives from parent
        }
      }
    } catch (err: any) {
      setContextError(err?.message || 'تعذر تحميل بيانات المخازن');
    } finally {
      setIsLoadingContext(false);
    }
  }, [fromWarehouseId, toWarehouseId, propItems]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const fetchStocks = useCallback(async (fId: string, tId: string) => {
    if (!fId || !tId || fId === tId) return;
    setIsRefreshingStocks(true);
    try {
      const res = await api.getWarehouseTransferStocks({
        fromWarehouseId: fId,
        toWarehouseId: tId
      });
      if (res.success && res.stocks) {
        setStocksMap(res.stocks);
      }
    } catch (err: any) {
      setPairError(err?.message || 'تعذر جلب أرصدة المخازن');
    } finally {
      setIsRefreshingStocks(false);
    }
  }, []);

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
    await fetchStocks(fromWarehouseId, toWarehouseId);
  };

  const handleWarehouseSelectChange = async (field: 'from' | 'to', nextId: string) => {
    if (!nextId) return;
    const nextFrom = field === 'from' ? nextId : fromWarehouseId;
    const nextTo = field === 'to' ? nextId : toWarehouseId;

    if (nextFrom === nextTo) {
      setPairError('لا يمكن اختيار نفس المخزن كمحوِّل ومحوَّل إليه');
      return;
    }

    setPairError(null);
    setSubmitError(null);
    if (field === 'from') {
      setFromWarehouseId(nextId);
    } else {
      setToWarehouseId(nextId);
    }

    if (isPairConfirmed && nextFrom && nextTo && nextFrom !== nextTo) {
      await fetchStocks(nextFrom, nextTo);
    }
  };

  const processUploadedFile = async (file: File) => {
    setParseError(null);
    setSubmitError(null);
    setCreatedOrder(null);
    setStatusFilter('ALL');
    setIsReadingFile(true);

    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseWarehouseTransferExcelBuffer(buffer, file.name);
      if (parsed.ok === false) {
        setParseError(parsed.error);
        setSelectedFileName(file.name);
        setParsedRows([]);
        return;
      }

      setSelectedFileName(file.name);
      setParsedRows(parsed.rows);

      if (fromWarehouseId && toWarehouseId && fromWarehouseId !== toWarehouseId) {
        await fetchStocks(fromWarehouseId, toWarehouseId);
      }
    } catch (err: any) {
      setParseError(err?.message || 'حدث خطأ أثناء قراءة الملف المرفوع');
      setParsedRows([]);
    } finally {
      setIsReadingFile(false);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processUploadedFile(file);
  };

  const handleDropFile = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!isPairConfirmed || isReadingFile || isSubmitting) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processUploadedFile(file);
  };

  const handleClearFile = () => {
    setSelectedFileName('');
    setParsedRows([]);
    setParseError(null);
    setSubmitError(null);
    setStatusFilter('ALL');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const evaluation = useMemo(() => {
    return evaluateWarehouseExcelRows({
      parsedRows,
      catalogItems,
      stocksMap,
      allowNegativeWarehouseTransfer: allowNegativeTransfer
    });
  }, [parsedRows, catalogItems, stocksMap, allowNegativeTransfer]);

  const evaluatedRows = evaluation.rows;
  const summary = evaluation.summary;

  const filteredRows = useMemo(() => {
    if (statusFilter === 'READY') {
      return evaluatedRows.filter(r => r.status === 'ready');
    }
    if (statusFilter === 'ERRORS') {
      return evaluatedRows.filter(r => r.status !== 'ready');
    }
    return evaluatedRows;
  }, [evaluatedRows, statusFilter]);

  const errorRows = useMemo(
    () => evaluatedRows.filter(r => r.status !== 'ready'),
    [evaluatedRows]
  );

  const handleRemovePreviewRow = (rowNumber: number) => {
    setParsedRows(prev => prev.filter(r => r.rowNumber !== rowNumber));
    setSubmitError(null);
  };

  const handleUseAvailableStock = (row: WarehouseExcelEvaluatedRow) => {
    const available = Math.max(0, row.availableFromStock);
    if (available <= 0) return;
    setParsedRows(prev =>
      prev.map(r =>
        r.rowNumber === row.rowNumber
          ? {
              ...r,
              rawQuantity: String(available),
              parsedQuantity: available
            }
          : r
      )
    );
    setSubmitError(null);
  };

  const handleOpenExecuteConfirm = () => {
    setSubmitError(null);
    if (!isPairConfirmed || !fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId) {
      setSubmitError('يرجى تحديد وتأكيد المخزن المحوِّل والمخزن المحوَّل إليه أولًا');
      return;
    }
    if (!summary.canExecute) {
      setSubmitError('لا يمكن تنفيذ النقل طالما توجد صفوف بها أخطاء أو بدون صفوف جاهزة');
      return;
    }
    setIsConfirmExecuteOpen(true);
  };

  const handleExecuteTransfer = async () => {
    if (isSubmitting || !summary.canExecute) return;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const readyLines = evaluatedRows
        .filter(r => r.status === 'ready' && r.itemId && r.requestedQuantity && r.requestedQuantity > 0)
        .map(r => ({
          itemId: r.itemId!,
          quantity: r.requestedQuantity!
        }));

      const notePrefix = selectedFileName ? `نقل بالإكسيل (${selectedFileName})` : 'نقل بالإكسيل';
      const finalNotes = transferNotes.trim()
        ? `${notePrefix} - ${transferNotes.trim()}`
        : notePrefix;

      const res = await api.createWarehouseTransfer({
        fromWarehouseId,
        toWarehouseId,
        lines: readyLines,
        notes: finalNotes,
        idempotencyKey: idempotencyKeyRef.current
      });

      if (!res.success || !res.order) {
        setSubmitError(res.error || 'تعذر تنفيذ عملية النقل بين المخازن');
        setIsConfirmExecuteOpen(false);
        await fetchStocks(fromWarehouseId, toWarehouseId);
        return;
      }

      setCreatedOrder(res.order);
      setIsConfirmExecuteOpen(false);
      setParsedRows([]);
      setSelectedFileName('');
      setTransferNotes('');
      setStatusFilter('ALL');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      idempotencyKeyRef.current = generateIdempotencyKey();
      await fetchStocks(fromWarehouseId, toWarehouseId);
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'حدث خطأ أثناء تنفيذ النقل');
      setIsConfirmExecuteOpen(false);
      await fetchStocks(fromWarehouseId, toWarehouseId);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartNewExcelTransfer = () => {
    setCreatedOrder(null);
    handleClearFile();
    setTransferNotes('');
    idempotencyKeyRef.current = generateIdempotencyKey();
  };

  return (
    <PageSurface
      dir="rtl"
      title="نقل بالإكسيل بين المخازن"
      subtitle={`رفع ملف إكسيل أو CSV للمعاينة وتنفيذ أمر صرف واحد (حتى ${WAREHOUSE_EXCEL_MAX_ROWS} صف) · ${
        allowNegativeTransfer ? 'السماح بالتحويل بالسالب مفعل' : 'مقيد بالرصيد المتاح'
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
          <p className="text-xs font-bold">جاري تجهيز شاشة النقل بالإكسيل بين المخازن...</p>
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
                    تم تنفيذ النقل وإصدار أمر الصرف رقم{' '}
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
                  onClick={handleStartNewExcelTransfer}
                  className="min-h-[44px] px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition whitespace-nowrap cursor-pointer"
                >
                  نقل جديد بالإكسيل
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
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={downloadWarehouseTransferTemplate}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-link text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-4 h-4" />
                  <span>تحميل نموذج الإكسيل</span>
                </button>
                {isPairConfirmed && fromWarehouse && toWarehouse && (
                  <span className="text-xs font-bold ui-stock-in">
                    المسار المؤكد: {fromWarehouse.name} ← {toWarehouse.name}
                  </span>
                )}
              </div>
            }
          />

          {sourceWarehouses.length === 0 || targetWarehouses.length < 2 ? (
            <div className="px-4 py-3 rounded-lg border border-[var(--stock-low-fg)] ui-stock-low text-xs font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                يتطلب النقل وجود مخزنين نشطين على الأقل (ومخزن محوِّل مسموح لك). يرجى مراجعة إدارة المخازن أو صلاحيات المستخدم.
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="excel-transfer-from-warehouse"
                  className="block text-xs font-bold text-[var(--text-secondary)] mb-1"
                >
                  من مخزن (المحوِّل)
                </label>
                <select
                  id="excel-transfer-from-warehouse"
                  value={fromWarehouseId}
                  onChange={e => void handleWarehouseSelectChange('from', e.target.value)}
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
                  htmlFor="excel-transfer-to-warehouse"
                  className="block text-xs font-bold text-[var(--text-secondary)] mb-1"
                >
                  إلى مخزن (المحوَّل إليه)
                </label>
                <select
                  id="excel-transfer-to-warehouse"
                  value={toWarehouseId}
                  onChange={e => void handleWarehouseSelectChange('to', e.target.value)}
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
                ) : isPairConfirmed ? (
                  <RefreshCw className="w-4 h-4" />
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

          {/* 2. رفع ملف الإكسيل */}
          <SectionHeading
            title="2. رفع ملف الإكسيل أو CSV"
            withTopDivider
            actions={
              <span className="text-xs text-[var(--text-secondary)]">
                الأعمدة: اسم الصنف · الكمية · الباركود (اختياري)
              </span>
            }
          />

          {!isPairConfirmed ? (
            <div className="py-8 text-center space-y-2 text-[var(--text-secondary)]">
              <Lock className="w-6 h-6 mx-auto opacity-50" />
              <p className="text-xs font-bold">
                اختر المخزن المحوِّل والمحوَّل إليه واضغط «تأكيد» لرفع ملف الإكسيل ومعاينة الأرصدة
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={e => void handleFileInputChange(e)}
                className="hidden"
              />

              <div
                onDragOver={e => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={e => void handleDropFile(e)}
                className={`border border-dashed rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 transition-colors ${
                  isDragOver
                    ? 'border-[var(--accent)] bg-[var(--surface-subtle)]'
                    : 'border-[var(--border-color)]'
                }`}
              >
                <div className="space-y-0.5 text-xs">
                  <p className="font-bold text-[var(--text-primary)]">
                    {selectedFileName
                      ? `الملف المحدد: ${selectedFileName}`
                      : 'اسحب ملف الإكسيل هنا أو اضغط لاختيار الملف من جهازك'}
                  </p>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    الصيغ المدعومة: ‎.xlsx‎ و ‎.xls‎ و ‎.csv‎ (حتى {WAREHOUSE_EXCEL_MAX_ROWS} صف)
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isReadingFile || isSubmitting}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer disabled:opacity-60 whitespace-nowrap"
                  >
                    {isReadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    <span>{selectedFileName ? 'اختيار ملف آخر' : 'رفع ملف إكسيل / CSV'}</span>
                  </button>

                  {selectedFileName && (
                    <button
                      type="button"
                      onClick={handleClearFile}
                      disabled={isReadingFile || isSubmitting}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-out text-xs font-bold transition cursor-pointer whitespace-nowrap"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>مسح الملف</span>
                    </button>
                  )}
                </div>
              </div>

              {parseError && (
                <div className="px-3 py-2 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}
            </div>
          )}

          {/* 3. المعاينة والتحقق */}
          {isPairConfirmed && evaluatedRows.length > 0 && (
            <div className="space-y-4">
              <SectionHeading title={`3. معاينة الصفوف (${summary.totalRows})`} withTopDivider />

              {/* سطر نصي واحد للملخص */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]">
                <span>
                  إجمالي الصفوف:{' '}
                  <strong className="font-mono tabular-nums text-[var(--text-primary)]">{summary.totalRows}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  جاهزة:{' '}
                  <strong className="font-mono tabular-nums ui-stock-in">{summary.readyCount}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  أخطاء:{' '}
                  <strong className={`font-mono tabular-nums ${summary.errorCount > 0 ? 'ui-stock-out' : 'text-[var(--text-primary)]'}`}>
                    {summary.errorCount}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  إجمالي الكمية الجاهزة:{' '}
                  <strong className="font-mono tabular-nums ui-link">{summary.totalRequestedQuantity}</strong>
                </span>
              </div>

              {summary.errorCount > 0 && (
                <div className="px-4 py-3 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        لا يمكن تنفيذ النقل طالما توجد {summary.errorCount} صفوف بها أخطاء. احذف الصفوف المرفوضة أو اضغط «استخدم المتاح».
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadWarehouseTransferErrorsFile(errorRows)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>تحميل ملف الأخطاء ({errorRows.length})</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold pr-6">
                    {summary.notFoundCount > 0 && <span>غير موجود: {summary.notFoundCount}</span>}
                    {summary.duplicateCount > 0 && <span>مكرر بالملف: {summary.duplicateCount}</span>}
                    {summary.insufficientCount > 0 && <span>الكمية لا تكفي: {summary.insufficientCount}</span>}
                    {summary.invalidQuantityCount > 0 && <span>كمية غير صالحة: {summary.invalidQuantityCount}</span>}
                  </div>
                </div>
              )}

              {/* شريط فلاتر الحالة المضغوط */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStatusFilter('ALL')}
                  className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    statusFilter === 'ALL'
                      ? 'bg-[#1668B2] text-white'
                      : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  الكل ({summary.totalRows})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('READY')}
                  className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    statusFilter === 'READY'
                      ? 'bg-[#1668B2] text-white'
                      : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  جاهز ({summary.readyCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('ERRORS')}
                  className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    statusFilter === 'ERRORS'
                      ? 'bg-[#1668B2] text-white'
                      : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  أخطاء ({summary.errorCount})
                </button>
              </div>

              {submitError && (
                <div className="px-3 py-2 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <CompactTable ariaLabel="جدول معاينة ملف الإكسيل">
                <thead>
                  <tr>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الصف</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصنف</th>
                    <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>الباركود</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>المتاح</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>المطلوب</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الحالة</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>التفاصيل / السبب</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>حذف</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-[var(--text-secondary)] font-bold">
                        لا توجد صفوف مطابقة للتصفية الحالية
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map(row => {
                      const isInsufficient = row.status === 'insufficient_stock';
                      const isReady = row.status === 'ready';
                      const isError = !isReady;
                      return (
                        <tr key={row.rowKey}>
                          <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                            {row.rowNumber}
                          </td>
                          <td className={COMPACT_TABLE_TEXT_CLASS}>
                            <div className="font-bold text-[var(--text-primary)]">{row.itemName}</div>
                            {row.inputName && row.inputName !== row.itemName && (
                              <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                                بالملف: {row.inputName}
                              </div>
                            )}
                          </td>
                          <td className={`font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                            {row.barcode || row.inputBarcode || '—'}
                          </td>
                          <td
                            className={`text-center font-mono font-bold ${COMPACT_TABLE_NUM_CLASS} ${
                              isInsufficient ? 'ui-stock-out' : 'text-[var(--text-primary)]'
                            }`}
                          >
                            {row.itemId ? row.availableFromStock : '—'}
                          </td>
                          <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                            <div className="flex flex-col items-center gap-1">
                              <span
                                className={`font-mono font-bold ${
                                  row.status === 'invalid_quantity' || isInsufficient
                                    ? 'ui-stock-out'
                                    : 'text-[var(--text-primary)]'
                                }`}
                              >
                                {row.requestedQuantity !== null
                                  ? row.requestedQuantity
                                  : row.rawQuantity || '—'}
                              </span>

                              {row.canUseAvailableStock && (
                                <button
                                  type="button"
                                  onClick={() => handleUseAvailableStock(row)}
                                  className="min-h-[36px] px-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
                                >
                                  استخدم المتاح ({row.availableFromStock})
                                </button>
                              )}
                            </div>
                          </td>
                          <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                            <span className={isReady ? 'ui-stock-in' : 'ui-stock-out'}>
                              {row.statusLabel}
                            </span>
                          </td>
                          <td
                            className={`text-xs ${COMPACT_TABLE_TEXT_CLASS} ${
                              isError ? 'ui-stock-out font-bold' : 'text-[var(--text-secondary)]'
                            }`}
                          >
                            {row.reason}
                          </td>
                          <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                            <button
                              type="button"
                              onClick={() => handleRemovePreviewRow(row.rowNumber)}
                              title="حذف الصف من المعاينة"
                              aria-label={`حذف الصف ${row.rowNumber}`}
                              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg ui-stock-out hover:bg-[var(--surface-subtle)] cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </CompactTable>

              {/* الملاحظات والحفظ */}
              <div className="pt-4 border-t border-[var(--border-subtle)] flex flex-wrap items-end justify-between gap-4">
                <div>
                  <label
                    htmlFor="excel-transfer-notes"
                    className="block text-xs font-bold text-[var(--text-secondary)] mb-1"
                  >
                    ملاحظات على أمر الصرف (اختياري)
                  </label>
                  <input
                    id="excel-transfer-notes"
                    type="text"
                    value={transferNotes}
                    onChange={e => setTransferNotes(e.target.value)}
                    placeholder="مثال: تغذية فرع الإسكندرية من جرد الملف..."
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-[var(--text-secondary)]">
                    <span>
                      جاهزة:{' '}
                      <strong className="font-mono tabular-nums text-[var(--text-primary)]">{summary.readyCount}</strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      إجمالي الكمية:{' '}
                      <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                        {summary.totalRequestedQuantity}
                      </strong>
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
                    onClick={handleOpenExecuteConfirm}
                    disabled={!summary.canExecute || isSubmitting || isRefreshingStocks}
                    className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    <span>تنفيذ النقل</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Confirmation Modal */}
      {isConfirmExecuteOpen && (
        <ModalShell
          title="تأكيد تنفيذ النقل بالإكسيل"
          subtitle="سيتم إنشاء أمر صرف واحد لكافة الصفوف الجاهزة"
          onClose={() => setIsConfirmExecuteOpen(false)}
          closeDisabled={isSubmitting}
          footer={
            <>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsConfirmExecuteOpen(false)}
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
                <span>{isSubmitting ? 'جاري التنفيذ...' : 'تأكيد وتنفيذ النقل'}</span>
              </button>
            </>
          }
        >
          <div className="space-y-3 max-w-md">
            <CompactTable ariaLabel="ملخص النقل بالإكسيل">
              <tbody>
                <tr>
                  <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>من مخزن</td>
                  <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>{fromWarehouse?.name}</td>
                </tr>
                <tr>
                  <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>إلى مخزن</td>
                  <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>{toWarehouse?.name}</td>
                </tr>
                {selectedFileName && (
                  <tr>
                    <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>الملف</td>
                    <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>{selectedFileName}</td>
                  </tr>
                )}
                <tr>
                  <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>عدد الأصناف</td>
                  <td className={`font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>{summary.readyCount} صنف</td>
                </tr>
                <tr>
                  <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>إجمالي الكمية المنقولة</td>
                  <td className={`font-mono font-bold ui-link ${COMPACT_TABLE_NUM_CLASS}`}>{summary.totalRequestedQuantity}</td>
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
              عند التأكيد سيتم خصم الكميات فوراً من مخزن «{fromWarehouse?.name}» وإضافتها إلى مخزن «{toWarehouse?.name}» عبر أمر صرف واحد.
            </p>
          </div>
        </ModalShell>
      )}
    </PageSurface>
  );
};

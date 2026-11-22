import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Plus,
  Search,
  Download,
  Upload,
  Edit3,
  Trash2,
  Archive,
  ShoppingCart,
  RefreshCw,
  Check,
  X,
  AlertTriangle,
  CopyCheck,
  ArrowUpDown,
  ChevronRight,
  ChevronLeft,
  Loader2,
  QrCode,
  FileSpreadsheet,
  Images
} from 'lucide-react';
import {
  Item,
  ProductCategory,
  Platform,
  ItemPlatformCost,
  UserRole,
  UserAccount,
  DisplaySettings
} from '../types';
import { api } from '../api/client';
import { hasPermission } from '../utils/permissions';
import { useUserWarehouses } from '../hooks/useUserWarehouses';
import { ItemsImageExportDialog } from '../components/ItemsImageExportDialog';
import { useRegisterShortcuts, ShortcutBadge } from '../context/KeyboardShortcutsContext';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ModalShell,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS
} from '../components/ui';
import { getHrefForTarget, getHrefForItemRoute, isPlainLeftClick } from '../config/navigation';

export interface ProductsPageProps {
  items: Item[];
  categories?: ProductCategory[];
  platforms?: Platform[];
  costs?: ItemPlatformCost[];
  userRole: UserRole;
  user?: UserAccount | null;
  displaySettings?: Partial<DisplaySettings>;
  currentTab?: string;
  initialCategoryId?: string;
  onNavigateItemRoute: (path: string, item?: Item) => void;
  onDeleteItem: (id: string) => Promise<{ success: boolean; message?: string; hasTransactions?: boolean; error?: string }>;
  onArchiveItem?: (id: string) => Promise<{ success: boolean; message?: string }>;
  onRefreshItems?: () => Promise<void> | void;
  onQuickSell?: (item: Item) => void;
  onOpenBulkImport?: () => void;
}

const PAGE_SIZE = 30;

function formatMoney(value?: number): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getStockState(item: Item): 'OUT' | 'LOW' | 'OK' {
  const qty = Number(item.stockQuantity ?? 0);
  const limit = Number(item.reorderLimit ?? 5);
  if (qty <= 0) return 'OUT';
  if (qty <= limit) return 'LOW';
  return 'OK';
}

export const ProductsPage: React.FC<ProductsPageProps> = ({
  items: initialItems = [],
  categories = [],
  platforms = [],
  userRole,
  user,
  displaySettings,
  currentTab,
  initialCategoryId,
  onNavigateItemRoute,
  onDeleteItem,
  onArchiveItem,
  onRefreshItems,
  onQuickSell,
  onOpenBulkImport
}) => {
  const isOwnerOrDesigner = userRole === 'designer' || Boolean(user?.isOwner);
  const canCreate = isOwnerOrDesigner || hasPermission(user, 'items.create');
  const canEdit = isOwnerOrDesigner || hasPermission(user, 'items.edit');
  const canDelete = isOwnerOrDesigner || hasPermission(user, 'items.delete');
  const canInlineEditPerm = isOwnerOrDesigner || hasPermission(user, 'products.inline_edit');
  const canInlineEdit = canInlineEditPerm && (displaySettings?.enableInlineEdit ?? true);
  const canViewPurchase = isOwnerOrDesigner || hasPermission(user, 'prices.view_purchase');
  const canViewSale = isOwnerOrDesigner || hasPermission(user, 'prices.view_sale');
  const canViewStock = isOwnerOrDesigner || hasPermission(user, 'stock.view');
  const canExport = isOwnerOrDesigner || hasPermission(user, 'products.export');
  const canBulkImport = isOwnerOrDesigner || hasPermission(user, 'items.import_export') || hasPermission(user, 'products.bulk_edit_excel');
  const canQuickSell = isOwnerOrDesigner || hasPermission(user, 'invoices.create');

  const { activeAllowedWarehouses, defaultWarehouseId, seesAllWarehouses } = useUserWarehouses(user);

  // Filters & query state
  const [search, setSearch] = useState('');
  const [barcodeOnly, setBarcodeOnly] = useState(false);
  const [categoryId, setCategoryId] = useState(() => initialCategoryId || 'ALL');
  const [supplierFilter, setSupplierFilter] = useState('ALL');
  const [stockStatus, setStockStatus] = useState<string>(() => {
    if (currentTab === 'LOW' || currentTab === 'LOW_STOCK') return 'LOW';
    if (currentTab === 'OUT' || currentTab === 'OUT_OF_STOCK') return 'OUT';
    return 'ALL';
  });
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    currentTab === 'ARCHIVED' ? 'مؤرشف' : 'ALL'
  );
  const [platformFilter, setPlatformFilter] = useState<string>('ALL');
  const [warehouseId, setWarehouseId] = useState<string>(() => (seesAllWarehouses ? 'ALL' : defaultWarehouseId || ''));
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);

  useEffect(() => {
    if (initialCategoryId !== undefined) {
      setCategoryId(initialCategoryId || 'ALL');
      setPage(1);
    }
  }, [initialCategoryId]);

  // Server paginated data
  const [pagedItems, setPagedItems] = useState<Item[]>(initialItems.slice(0, PAGE_SIZE));
  const [totalItems, setTotalItems] = useState<number>(initialItems.length);
  const [totalPages, setTotalPages] = useState<number>(Math.max(1, Math.ceil(initialItems.length / PAGE_SIZE)));
  const [totals, setTotals] = useState<{
    itemsCount: number;
    totalPieces: number;
    totalSaleValue: number;
    totalPurchaseValue?: number;
  }>(() => ({
    itemsCount: initialItems.length,
    totalPieces: initialItems.reduce((sum, it) => sum + Number(it.stockQuantity || 0), 0),
    totalSaleValue: initialItems.reduce((sum, it) => sum + Number(it.stockQuantity || 0) * Number(it.salePrice || 0), 0),
    totalPurchaseValue: initialItems.reduce((sum, it) => sum + Number(it.stockQuantity || 0) * Number(it.purchasePrice || 0), 0)
  }));
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImageExportOpen, setIsImageExportOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Inline edit state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState<{
    name: string;
    barcode: string;
    salePrice: string;
    purchasePrice: string;
    notes: string;
    categoryId: string;
    lastUpdated?: string;
  }>({
    name: '',
    barcode: '',
    salePrice: '',
    purchasePrice: '',
    notes: '',
    categoryId: ''
  });
  const [isSavingInline, setIsSavingInline] = useState(false);

  // Delete / Archive modal
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Duplicate cleanup modal
  const [isDupModalOpen, setIsDupModalOpen] = useState(false);
  const [dupPreview, setDupPreview] = useState<any>(null);
  const [isLoadingDup, setIsLoadingDup] = useState(false);
  const [isCleaningDup, setIsCleaningDup] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (currentTab === 'LOW' || currentTab === 'LOW_STOCK') {
      setStockStatus('LOW');
      setStatusFilter('ALL');
      setPage(1);
    } else if (currentTab === 'OUT' || currentTab === 'OUT_OF_STOCK') {
      setStockStatus('OUT');
      setStatusFilter('ALL');
      setPage(1);
    } else if (currentTab === 'ARCHIVED') {
      setStockStatus('ALL');
      setStatusFilter('مؤرشف');
      setPage(1);
    } else if (currentTab === 'ALL') {
      setStockStatus('ALL');
      setStatusFilter('ALL');
      setPage(1);
    }
  }, [currentTab]);

  useEffect(() => {
    if (!warehouseId && !seesAllWarehouses && defaultWarehouseId) {
      setWarehouseId(defaultWarehouseId);
    }
  }, [warehouseId, seesAllWarehouses, defaultWarehouseId]);

  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of initialItems) {
      if (it.supplier && it.supplier.trim()) {
        set.add(it.supplier.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [initialItems]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      map.set(c.id, c.name);
    }
    return map;
  }, [categories]);

  const loadPaginated = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getItemsPaginated({
        page,
        search: search.trim() || undefined,
        barcodeOnly,
        categoryId: categoryId !== 'ALL' ? categoryId : undefined,
        supplier: supplierFilter !== 'ALL' ? supplierFilter : undefined,
        stockStatus: stockStatus !== 'ALL' ? stockStatus : undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        platformId: platformFilter !== 'ALL' ? platformFilter : undefined,
        warehouseId: warehouseId || undefined,
        sortBy,
        sortDir
      });
      if (res.success && Array.isArray(res.items)) {
        let filtered = res.items;
        if (dateFrom) {
          filtered = filtered.filter(it => (it.createdAt || '').slice(0, 10) >= dateFrom);
        }
        if (dateTo) {
          filtered = filtered.filter(it => (it.createdAt || '').slice(0, 10) <= dateTo);
        }
        setPagedItems(filtered);
        setTotalItems(res.total);
        setTotalPages(Math.max(1, res.totalPages || 1));
        if (res.totals) {
          setTotals(res.totals);
        }
      }
    } catch {
      // Fallback to local filtering when offline
      const q = search.trim().toLowerCase();
      const filtered = initialItems.filter(it => {
        if (categoryId !== 'ALL' && it.categoryId !== categoryId) return false;
        if (supplierFilter !== 'ALL' && it.supplier !== supplierFilter) return false;
        if (stockStatus !== 'ALL' && getStockState(it) !== stockStatus) return false;
        if (statusFilter !== 'ALL') {
          const itemSt = String(it.status || 'ACTIVE').trim();
          const normalizedItemSt =
            itemSt === 'نشط' ? 'ACTIVE' : itemSt === 'موقوف' ? 'INACTIVE' : itemSt === 'مؤرشف' ? 'ARCHIVED' : itemSt;
          const normalizedFilterSt =
            statusFilter === 'نشط'
              ? 'ACTIVE'
              : statusFilter === 'موقوف'
              ? 'INACTIVE'
              : statusFilter === 'مؤرشف'
              ? 'ARCHIVED'
              : statusFilter;
          if (normalizedItemSt !== normalizedFilterSt) return false;
        }
        if (dateFrom && (it.createdAt || '').slice(0, 10) < dateFrom) return false;
        if (dateTo && (it.createdAt || '').slice(0, 10) > dateTo) return false;
        if (q) {
          const bc = (it.barcode || '').toLowerCase();
          if (barcodeOnly) return bc === q || (it.secondaryBarcodes || []).some(s => s.toLowerCase() === q);
          return (
            it.name.toLowerCase().includes(q) ||
            bc.includes(q) ||
            (it.sku || '').toLowerCase().includes(q) ||
            (it.notes || '').toLowerCase().includes(q)
          );
        }
        return true;
      });
      const startIdx = (page - 1) * PAGE_SIZE;
      setPagedItems(filtered.slice(startIdx, startIdx + PAGE_SIZE));
      setTotalItems(filtered.length);
      setTotalPages(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
      setTotals({
        itemsCount: filtered.length,
        totalPieces: filtered.reduce((s, x) => s + Number(x.stockQuantity || 0), 0),
        totalSaleValue: filtered.reduce((s, x) => s + Number(x.stockQuantity || 0) * Number(x.salePrice || 0), 0),
        totalPurchaseValue: filtered.reduce((s, x) => s + Number(x.stockQuantity || 0) * Number(x.purchasePrice || 0), 0)
      });
    } finally {
      setIsLoading(false);
    }
  }, [
    page,
    search,
    barcodeOnly,
    categoryId,
    supplierFilter,
    stockStatus,
    statusFilter,
    platformFilter,
    warehouseId,
    dateFrom,
    dateTo,
    sortBy,
    sortDir,
    initialItems
  ]);

  useEffect(() => {
    void loadPaginated();
  }, [loadPaginated]);

  useRegisterShortcuts(
    {
      'general.add_new': {
        handler: () => {
          if (canCreate) onNavigateItemRoute('/items/new');
        },
        disabled: !canCreate
      },
      'general.focus_search': () => {
        searchInputRef.current?.focus();
      }
    },
    true
  );

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  const startInlineEdit = (item: Item) => {
    setEditingItemId(item.id);
    setInlineDraft({
      name: item.name || '',
      barcode: item.barcode || '',
      salePrice: String(item.salePrice ?? 0),
      purchasePrice: String(item.purchasePrice ?? 0),
      notes: item.notes || '',
      categoryId: item.categoryId || '',
      lastUpdated: item.updatedAt
    });
  };

  const cancelInlineEdit = () => {
    setEditingItemId(null);
  };

  const saveInlineEdit = async (item: Item) => {
    if (!inlineDraft.name.trim()) {
      setFeedback({ type: 'error', message: 'اسم الصنف مطلوب' });
      return;
    }
    setIsSavingInline(true);
    setFeedback(null);
    try {
      const payload: Parameters<typeof api.inlineUpdateItem>[1] = {
        name: inlineDraft.name.trim(),
        barcode: inlineDraft.barcode.trim(),
        salePrice: Number(inlineDraft.salePrice || 0),
        notes: inlineDraft.notes,
        categoryId: inlineDraft.categoryId || null,
        lastUpdated: inlineDraft.lastUpdated
      };
      if (canViewPurchase) {
        payload.purchasePrice = Number(inlineDraft.purchasePrice || 0);
      }
      const res = await api.inlineUpdateItem(item.id, payload);
      if (res.success && res.item) {
        setPagedItems(prev => prev.map(p => (p.id === item.id ? res.item : p)));
        setEditingItemId(null);
        setFeedback({ type: 'success', message: `تم تحديث الصنف "${res.item.name}"` });
        await onRefreshItems?.();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'فشل حفظ التعديل السريع' });
    } finally {
      setIsSavingInline(false);
    }
  };

  /** «تصدير الأصناف بالصور» من هنا = الأصناف اللي ظاهرة بالفلاتر الحالية بس (كل الصفحات) */
  const loadVisibleItemsForExport = async (): Promise<Item[]> => {
    const query = {
      search: search.trim() || undefined,
      barcodeOnly,
      categoryId: categoryId !== 'ALL' ? categoryId : undefined,
      supplier: supplierFilter !== 'ALL' ? supplierFilter : undefined,
      stockStatus: stockStatus !== 'ALL' ? stockStatus : undefined,
      status: statusFilter !== 'ALL' ? statusFilter : undefined,
      platformId: platformFilter !== 'ALL' ? platformFilter : undefined,
      warehouseId: warehouseId || undefined,
      sortBy,
      sortDir
    };
    const collected: Item[] = [];
    let pageNo = 1;
    let pagesCount = 1;
    do {
      const res = await api.getItemsPaginated({ ...query, page: pageNo });
      if (!res.success || !Array.isArray(res.items)) throw new Error('تعذر تحميل الأصناف الظاهرة');
      collected.push(...res.items);
      pagesCount = Math.max(1, res.totalPages || 1);
      pageNo++;
    } while (pageNo <= pagesCount);
    return collected.filter(it => {
      const created = (it.createdAt || '').slice(0, 10);
      if (dateFrom && created < dateFrom) return false;
      if (dateTo && created > dateTo) return false;
      return true;
    });
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    setFeedback(null);
    try {
      const { blob, fileName } = await api.exportItemsExcel();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setFeedback({ type: 'success', message: 'تم تصدير ملف الأصناف بنجاح' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'فشل تصدير ملف الإكسيل' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setFeedback(null);
    try {
      const res = await onDeleteItem(deleteTarget.id);
      if (res.success) {
        setDeleteTarget(null);
        setFeedback({ type: 'success', message: res.message || 'تم حذف الصنف بنجاح' });
        await loadPaginated();
      } else {
        setFeedback({ type: 'error', message: res.error || 'تعذر حذف الصنف' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'حدث خطأ أثناء الحذف' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchive = async (item: Item) => {
    if (!onArchiveItem) return;
    try {
      const res = await onArchiveItem(item.id);
      if (res.success) {
        setFeedback({ type: 'success', message: res.message || 'تمت أرشفة الصنف بنجاح' });
        await loadPaginated();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر أرشفة الصنف' });
    }
  };

  const openDuplicateModal = async () => {
    setIsDupModalOpen(true);
    setIsLoadingDup(true);
    try {
      const res = await api.previewDuplicateItems();
      setDupPreview(res);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر فحص التكرارات' });
      setIsDupModalOpen(false);
    } finally {
      setIsLoadingDup(false);
    }
  };

  const runDuplicateCleanup = async () => {
    setIsCleaningDup(true);
    try {
      const res = await api.cleanupDuplicateItems();
      setFeedback({
        type: 'success',
        message: res.message || `تم تنظيف التكرارات بنجاح (حذف ${res.deletedCount || 0} صنف مكرر)`
      });
      setIsDupModalOpen(false);
      await onRefreshItems?.();
      await loadPaginated();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تنظيف التكرارات' });
    } finally {
      setIsCleaningDup(false);
    }
  };

  const showImages = displaySettings?.showItemImages ?? true;
  const showSaleCol = (displaySettings?.showSalePrice ?? true) && canViewSale;
  const showStockCol = (displaySettings?.showStockQuantity ?? true) && canViewStock;

  return (
    <PageSurface
      title="الأصناف والمخزون"
      subtitle={`إجمالي الأصناف: ${totals.itemsCount} صنف | إجمالي القطع: ${totals.totalPieces}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <a
              href={getHrefForItemRoute('new')}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return;
                e.preventDefault();
                onNavigateItemRoute('/items/new');
              }}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-[#157347] hover:bg-[#115e3a] text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة صنف</span>
              <ShortcutBadge actionId="general.add_new" />
            </a>
          )}
          {canBulkImport && onOpenBulkImport && (
            <a
              href={getHrefForTarget('bulk_edit_excel', 'add_items', {
                searchParams: { operationType: 'add_items' }
              })}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return;
                e.preventDefault();
                onOpenBulkImport();
              }}
              className="min-h-[44px] px-3.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>استيراد / إضافة إكسيل</span>
            </a>
          )}
          {canExport && (
            <button
              type="button"
              disabled={isExporting}
              onClick={handleExportExcel}
              className="min-h-[44px] px-3.5 py-2 rounded-lg bg-[#1668B2] hover:bg-[#125694] text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>تصدير إكسيل</span>
            </button>
          )}
          {canExport && (
            <button
              type="button"
              onClick={() => setIsImageExportOpen(true)}
              className="min-h-[44px] px-3.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Images className="w-4 h-4" />
              <span>تصدير الأصناف بالصور</span>
            </button>
          )}
          {isOwnerOrDesigner && (
            <button
              type="button"
              onClick={openDuplicateModal}
              className="min-h-[44px] px-3.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <CopyCheck className="w-4 h-4" />
              <span>فحص التكرارات</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadPaginated()}
            className="min-h-[44px] px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
            title="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      }
    >
      {feedback && (
        <div
          className={`mt-4 px-4 py-3 rounded-lg border text-sm font-medium flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'border-[#157347]/30 text-[#15694B]'
              : 'border-[#B42318]/30 text-[#B42318]'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="min-h-[44px] px-2 text-xs font-semibold cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <SectionHeading title="البحث والفلترة" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="ابحث بالاسم أو الباركود أو الكود..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} pr-9`}
          />
        </div>

        <label className="min-h-[44px] inline-flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer px-2">
          <input
            type="checkbox"
            checked={barcodeOnly}
            onChange={e => {
              setBarcodeOnly(e.target.checked);
              setPage(1);
            }}
            className="w-4 h-4"
          />
          <QrCode className="w-4 h-4 text-[var(--text-secondary)]" />
          <span>باركود مطابق</span>
        </label>

        <select
          aria-label="التصنيف"
          value={categoryId}
          onChange={e => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
          className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code}`}
        >
          <option value="ALL">كل التصنيفات</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {supplierOptions.length > 0 && (
          <select
            aria-label="المورد"
            value={supplierFilter}
            onChange={e => {
              setSupplierFilter(e.target.value);
              setPage(1);
            }}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code}`}
          >
            <option value="ALL">كل الموردين</option>
            {supplierOptions.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label="حالة المخزون"
          value={stockStatus}
          onChange={e => {
            setStockStatus(e.target.value);
            setPage(1);
          }}
          className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date}`}
        >
          <option value="ALL">كل الأرصدة</option>
          <option value="LOW">رصيد منخفض</option>
          <option value="OUT">نفد المخزون</option>
        </select>

        <select
          aria-label="حالة الصنف"
          value={statusFilter}
          onChange={e => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date}`}
        >
          <option value="ALL">كل الحالات</option>
          <option value="نشط">نشط</option>
          <option value="موقوف">موقوف</option>
          <option value="مؤرشف">مؤرشف</option>
        </select>

        {platforms.length > 0 && (
          <select
            aria-label="المنصة"
            value={platformFilter}
            onChange={e => {
              setPlatformFilter(e.target.value);
              setPage(1);
            }}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date}`}
          >
            <option value="ALL">كل المنصات</option>
            {platforms.map(pl => (
              <option key={pl.id} value={pl.id}>
                {pl.name}
              </option>
            ))}
          </select>
        )}

        {activeAllowedWarehouses.length > 0 && (
          <select
            aria-label="المخزن"
            value={warehouseId}
            onChange={e => {
              setWarehouseId(e.target.value);
              setPage(1);
            }}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code}`}
          >
            {seesAllWarehouses && <option value="ALL">كل المخازن</option>}
            {activeAllowedWarehouses.map(wh => (
              <option key={wh.id} value={wh.id}>
                {wh.name}
              </option>
            ))}
          </select>
        )}

        <input
          type="date"
          aria-label="من تاريخ"
          value={dateFrom}
          onChange={e => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date}`}
        />

        <input
          type="date"
          aria-label="إلى تاريخ"
          value={dateTo}
          onChange={e => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date}`}
        />
      </div>

      <SectionHeading
        title="قائمة الأصناف"
        withTopDivider
        actions={
          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold tabular-nums">
            <span className="text-[var(--text-primary)]">
              الأصناف: {totals.itemsCount}
            </span>
            {canViewStock && (
              <span className="text-[var(--text-primary)]">
                القطع: {totals.totalPieces}
              </span>
            )}
            {canViewSale && (
              <span className="text-[#155E9A] dark:text-[#7DD3FC]">
                قيمة البيع: {formatMoney(totals.totalSaleValue)}
              </span>
            )}
            {canViewPurchase && totals.totalPurchaseValue !== undefined && (
              <span className="text-[#15694B] dark:text-[#6EE7B7]">
                قيمة التكلفة: {formatMoney(totals.totalPurchaseValue)}
              </span>
            )}
          </div>
        }
      />

      <CompactTable ariaLabel="جدول الأصناف">
        <thead>
          <tr>
            {showImages && <th>الصورة</th>}
            <th>
              <button
                type="button"
                onClick={() => handleSort('name')}
                className="min-h-[44px] inline-flex items-center gap-1 font-semibold cursor-pointer"
              >
                <span>الصنف</span>
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
            </th>
            <th>الباركود / الكود</th>
            <th>التصنيف</th>
            <th>
              <button
                type="button"
                onClick={() => handleSort('supplier')}
                className="min-h-[44px] inline-flex items-center gap-1 font-semibold cursor-pointer"
              >
                <span>المورد</span>
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
            </th>
            {showSaleCol && (
              <th>
                <button
                  type="button"
                  onClick={() => handleSort('salePrice')}
                  className="min-h-[44px] inline-flex items-center gap-1 font-semibold cursor-pointer"
                >
                  <span>سعر البيع</span>
                  <ArrowUpDown className="w-3.5 h-3.5" />
                </button>
              </th>
            )}
            {canViewPurchase && (
              <th>
                <button
                  type="button"
                  onClick={() => handleSort('purchasePrice')}
                  className="min-h-[44px] inline-flex items-center gap-1 font-semibold cursor-pointer"
                >
                  <span>سعر الشراء</span>
                  <ArrowUpDown className="w-3.5 h-3.5" />
                </button>
              </th>
            )}
            {showStockCol && (
              <th>
                <button
                  type="button"
                  onClick={() => handleSort('stockQuantity')}
                  className="min-h-[44px] inline-flex items-center gap-1 font-semibold cursor-pointer"
                >
                  <span>الرصيد</span>
                  <ArrowUpDown className="w-3.5 h-3.5" />
                </button>
              </th>
            )}
            <th>ملاحظات</th>
            <th>الحالة</th>
            <th>الإجراءات</th>
          </tr>
        </thead>
        <tbody>
          {pagedItems.length === 0 ? (
            <tr>
              <td colSpan={11} className="py-8 text-center text-sm text-[var(--text-secondary)]">
                {isLoading ? 'جاري تحميل الأصناف...' : 'لا توجد أصناف مطابقة للبحث'}
              </td>
            </tr>
          ) : (
            pagedItems.map(item => {
              const isEditing = editingItemId === item.id;
              const stockState = getStockState(item);
              const catLabel = item.categoryName || (item.categoryId ? categoryMap.get(item.categoryId) : '') || '—';

              return (
                <tr key={item.id}>
                  {showImages && (
                    <td>
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-10 h-10 object-cover rounded border border-[var(--border-subtle)]"
                        />
                      ) : (
                        <span className="text-xs text-[var(--text-secondary)]">—</span>
                      )}
                    </td>
                  )}

                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    {isEditing ? (
                      <input
                        type="text"
                        value={inlineDraft.name}
                        onChange={e => setInlineDraft(d => ({ ...d, name: e.target.value }))}
                        className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} max-w-[300px]`}
                      />
                    ) : (
                      <a
                        href={getHrefForItemRoute('edit', item.id)}
                        onClick={(e) => {
                          if (!isPlainLeftClick(e)) return;
                          e.preventDefault();
                          onNavigateItemRoute(`/items/${encodeURIComponent(item.id)}`, item);
                        }}
                        className="min-h-[44px] inline-flex items-center text-right font-semibold text-[#155E9A] dark:text-[#7DD3FC] hover:underline cursor-pointer"
                      >
                        {item.name}
                      </a>
                    )}
                  </td>

                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-xs`}>
                    {isEditing ? (
                      <input
                        type="text"
                        value={inlineDraft.barcode}
                        onChange={e => setInlineDraft(d => ({ ...d, barcode: e.target.value }))}
                        className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} max-w-[200px]`}
                      />
                    ) : (
                      <span>{item.barcode || item.sku || '—'}</span>
                    )}
                  </td>

                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    {isEditing ? (
                      <select
                        value={inlineDraft.categoryId}
                        onChange={e => setInlineDraft(d => ({ ...d, categoryId: e.target.value }))}
                        className={`${FORM_CONTROL_BASE_CLASS} max-w-[200px]`}
                      >
                        <option value="">بدون تصنيف</option>
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{catLabel}</span>
                    )}
                  </td>

                  <td className={COMPACT_TABLE_TEXT_CLASS}>{item.supplier || '—'}</td>

                  {showSaleCol && (
                    <td className={COMPACT_TABLE_NUM_CLASS}>
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={inlineDraft.salePrice}
                          onChange={e => setInlineDraft(d => ({ ...d, salePrice: e.target.value }))}
                          className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number}`}
                        />
                      ) : (
                        <span className="font-semibold text-[#155E9A] dark:text-[#7DD3FC]">
                          {formatMoney(item.salePrice)}
                        </span>
                      )}
                    </td>
                  )}

                  {canViewPurchase && (
                    <td className={COMPACT_TABLE_NUM_CLASS}>
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={inlineDraft.purchasePrice}
                          onChange={e => setInlineDraft(d => ({ ...d, purchasePrice: e.target.value }))}
                          className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number}`}
                        />
                      ) : (
                        <span className="font-semibold text-[#15694B] dark:text-[#6EE7B7]">
                          {formatMoney(item.purchasePrice)}
                        </span>
                      )}
                    </td>
                  )}

                  {showStockCol && (
                    <td className={COMPACT_TABLE_NUM_CLASS}>
                      <span
                        className={`font-semibold ${
                          stockState === 'OUT'
                            ? 'text-[#B42318] dark:text-[#FCA5A5]'
                            : stockState === 'LOW'
                            ? 'text-[#9A4A00] dark:text-[#FCD34D]'
                            : 'text-[var(--text-primary)]'
                        }`}
                      >
                        {item.stockQuantity ?? 0} {item.unit || ''}
                      </span>
                    </td>
                  )}

                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    {isEditing ? (
                      <input
                        type="text"
                        value={inlineDraft.notes}
                        onChange={e => setInlineDraft(d => ({ ...d, notes: e.target.value }))}
                        className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} max-w-[300px]`}
                      />
                    ) : (
                      <span className="text-xs text-[var(--text-secondary)]">{item.notes || '—'}</span>
                    )}
                  </td>

                  <td className={COMPACT_TABLE_NUM_CLASS}>
                    <span className="text-xs font-medium text-[var(--text-secondary)]">
                      {item.status || 'نشط'}
                    </span>
                  </td>

                  <td className={COMPACT_TABLE_NUM_CLASS}>
                    <div className="inline-flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            disabled={isSavingInline}
                            onClick={() => void saveInlineEdit(item)}
                            className="min-h-[44px] px-2.5 rounded bg-[#157347] text-white inline-flex items-center gap-1 text-xs font-semibold cursor-pointer"
                            title="حفظ"
                          >
                            {isSavingInline ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            <span>حفظ</span>
                          </button>
                          <button
                            type="button"
                            onClick={cancelInlineEdit}
                            className="min-h-[44px] px-2.5 rounded border border-[var(--border-color)] text-[var(--text-primary)] inline-flex items-center text-xs font-semibold cursor-pointer"
                            title="إلغاء"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          {canQuickSell && onQuickSell && (
                            <button
                              type="button"
                              onClick={() => onQuickSell(item)}
                              className="min-h-[44px] px-2.5 rounded text-[#155E9A] dark:text-[#7DD3FC] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-1 text-xs font-semibold cursor-pointer"
                              title="بيع سريع"
                            >
                              <ShoppingCart className="w-4 h-4" />
                            </button>
                          )}
                          {canInlineEdit && (
                            <button
                              type="button"
                              onClick={() => startInlineEdit(item)}
                              className="min-h-[44px] px-2.5 rounded text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-1 text-xs font-semibold cursor-pointer"
                              title="تعديل سريع"
                            >
                              <FileSpreadsheet className="w-4 h-4" />
                            </button>
                          )}
                          {canEdit && (
                            <a
                              href={getHrefForItemRoute('edit', item.id)}
                              onClick={(e) => {
                                if (!isPlainLeftClick(e)) return;
                                e.preventDefault();
                                onNavigateItemRoute(`/items/${encodeURIComponent(item.id)}`, item);
                              }}
                              className="min-h-[44px] px-2.5 rounded text-[#1668B2] dark:text-[#7DD3FC] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-1 text-xs font-semibold cursor-pointer"
                              title="تعديل الصنف"
                            >
                              <Edit3 className="w-4 h-4" />
                            </a>
                          )}
                          {canEdit && onArchiveItem && item.status !== 'مؤرشف' && (
                            <button
                              type="button"
                              onClick={() => void handleArchive(item)}
                              className="min-h-[44px] px-2.5 rounded text-[#9A4A00] dark:text-[#FCD34D] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-1 text-xs font-semibold cursor-pointer"
                              title="أرشفة"
                            >
                              <Archive className="w-4 h-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(item)}
                              className="min-h-[44px] px-2.5 rounded text-[#B42318] dark:text-[#FCA5A5] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-1 text-xs font-semibold cursor-pointer"
                              title="حذف"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </CompactTable>

      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1 || isLoading}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] bg-[var(--surface)] text-[var(--text-primary)] disabled:opacity-50 inline-flex items-center gap-1 cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
            <span>السابق</span>
          </button>
          <span className="tabular-nums font-medium text-[var(--text-primary)]">
            صفحة {page} من {totalPages} ({totalItems} صنف)
          </span>
          <button
            type="button"
            disabled={page >= totalPages || isLoading}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] bg-[var(--surface)] text-[var(--text-primary)] disabled:opacity-50 inline-flex items-center gap-1 cursor-pointer"
          >
            <span>التالي</span>
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <ModalShell
          onClose={() => !isDeleting && setDeleteTarget(null)}
          closeDisabled={isDeleting}
          title="تأكيد حذف الصنف"
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-primary)]">
              هل أنت متأكد من حذف الصنف <strong>{deleteTarget.name}</strong>؟
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-[#B42318] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>تأكيد الحذف</span>
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Duplicate items cleanup modal */}
      {isDupModalOpen && (
        <ModalShell
          onClose={() => !isCleaningDup && setIsDupModalOpen(false)}
          closeDisabled={isCleaningDup}
          title="فحص وتنظيف الأصناف المكررة"
        >
          {isLoadingDup ? (
            <div className="py-6 flex items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>جاري فحص الأصناف المكررة...</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                <AlertTriangle className="w-5 h-5 text-[#9A4A00] shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    المجموعات المكررة المكتشفة: {dupPreview?.groups?.length ?? 0}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">
                    سيتم دمج السجلات المكررة والحفاظ على السجلات المرتبطة بالفواتير والمخزون.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isCleaningDup}
                  onClick={() => setIsDupModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
                >
                  إغلاق
                </button>
                {(dupPreview?.groups?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    disabled={isCleaningDup}
                    onClick={() => void runDuplicateCleanup()}
                    className="min-h-[44px] px-4 py-2 rounded-lg bg-[#1668B2] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
                  >
                    {isCleaningDup && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>تنظيف التكرارات</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </ModalShell>
      )}

      {isImageExportOpen && (
        <ItemsImageExportDialog
          scopeLabel="الأصناف الظاهرة بالفلاتر الحالية"
          loadItems={loadVisibleItemsForExport}
          canViewPurchase={canViewPurchase}
          onClose={() => setIsImageExportOpen(false)}
        />
      )}
    </PageSurface>
  );
};

export default ProductsPage;

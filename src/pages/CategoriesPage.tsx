import React, { useState, useMemo } from 'react';
import { ProductCategory, Item, UserRole, UserAccount } from '../types';
import { api } from '../api/client';
import { hasPermission } from '../utils/permissions';
import { PrintHeader } from '../components/ui';
import { ShortcutBadge } from '../context/KeyboardShortcutsContext';
import { getHrefForTarget, isPlainLeftClick } from '../config/navigation';
import {
  Layers,
  Plus,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Package,
  ArrowUp,
  ArrowDown,
  Search,
  FolderTree,
  CornerDownLeft,
  X,
  Loader2,
  Info
} from 'lucide-react';

interface CategoriesPageProps {
  categories: ProductCategory[];
  items?: Item[];
  userRole: UserRole;
  user: UserAccount | null;
  onRefreshCategories: () => Promise<void>;
  onNavigateToItemsWithCategory?: (categoryId: string) => void;
}

export const CategoriesPage: React.FC<CategoriesPageProps> = ({
  categories,
  items = [],
  userRole,
  user,
  onRefreshCategories,
  onNavigateToItemsWithCategory
}) => {
  const canManage = userRole === 'designer' || Boolean(user?.isOwner) || hasPermission(user, 'categories.manage');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPos, setFilterPos] = useState<'ALL' | 'VISIBLE' | 'HIDDEN'>('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Tree collapse state
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});

  // Modals state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [modalParentId, setModalParentId] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formParentId, setFormParentId] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState<'نشط' | 'معطل'>('نشط');
  const [formShowInPOS, setFormShowInPOS] = useState(true);
  const [formDisplayOrder, setFormDisplayOrder] = useState<number>(1);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete Protection Modal
  const [deleteTarget, setDeleteTarget] = useState<ProductCategory | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [busyCategoryId, setBusyCategoryId] = useState<string | null>(null);

  // Compute counts
  const totalCategories = categories.length;
  const rootCategoriesCount = categories.filter(c => !c.parentCategoryId).length;
  const subCategoriesCount = categories.filter(c => !!c.parentCategoryId).length;
  const posVisibleCount = categories.filter(c => c.showInPOS).length;

  const toggleCollapse = (id: string) => {
    setCollapsedMap(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Build tree structure
  const categoryTree = useMemo(() => {
    const map = new Map<string, ProductCategory & { children: ProductCategory[]; directItemCount: number }>();

    categories.forEach(c => {
      const directItems = items.filter(i => i.categoryId === c.id).length;
      map.set(c.id, {
        ...c,
        children: [],
        directItemCount: directItems
      });
    });

    const roots: (ProductCategory & { children: ProductCategory[]; directItemCount: number })[] = [];

    categories.forEach(c => {
      const node = map.get(c.id)!;
      if (c.parentCategoryId && map.has(c.parentCategoryId)) {
        map.get(c.parentCategoryId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    roots.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    map.forEach(node => {
      node.children.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    });

    return roots;
  }, [categories, items]);

  // Find all descendants of a category (to prevent circular parent selection in modal)
  const getDescendantIds = (catId: string): Set<string> => {
    const descendants = new Set<string>();
    const stack = [catId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      categories.forEach(c => {
        if (c.parentCategoryId === current && !descendants.has(c.id)) {
          descendants.add(c.id);
          stack.push(c.id);
        }
      });
    }
    return descendants;
  };

  // Open Create Modal
  const handleOpenCreate = (parentId: string | null = null) => {
    if (!canManage) return;
    setEditingCategory(null);
    setFormName('');
    setFormParentId(parentId);
    setFormStatus('نشط');
    setFormShowInPOS(true);

    // Compute default displayOrder within the parent level
    const siblings = categories.filter(c => (c.parentCategoryId || null) === (parentId || null));
    const maxOrder = siblings.reduce((m, s) => Math.max(m, s.displayOrder || 0), 0);
    setFormDisplayOrder(maxOrder + 1);

    setFormError(null);
    setIsEditModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (cat: ProductCategory) => {
    if (!canManage) return;
    setEditingCategory(cat);
    setFormName(cat.name);
    setFormParentId(cat.parentCategoryId || null);
    setFormStatus(cat.status === 'معطل' || cat.status === 'inactive' || cat.status === 'موقوف' ? 'معطل' : 'نشط');
    setFormShowInPOS(cat.showInPOS !== false);
    setFormDisplayOrder(cat.displayOrder || 1);
    setFormError(null);
    setIsEditModalOpen(true);
  };

  // Save / Update Category
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      setFormError('غير مصرح لك بإدارة التصنيفات');
      return;
    }
    if (!formName.trim()) {
      setFormError('يرجى إدخال اسم التصنيف');
      return;
    }

    // منع الدورات والعلاقات الدائرية في شجرة التصنيفات
    if (editingCategory && formParentId) {
      if (formParentId === editingCategory.id) {
        setFormError('لا يمكن ربط التصنيف بنفسه كتصنيف أب');
        return;
      }
      const descendants = getDescendantIds(editingCategory.id);
      if (descendants.has(formParentId)) {
        setFormError('لا يمكن اختيار تصنيف فرعي تابع لهذا التصنيف ليكون تصنيفاً أباً (منع العلاقات الدائرية)');
        return;
      }
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const payload: Partial<ProductCategory> & { name: string } = {
        name: formName.trim(),
        parentCategoryId: formParentId || null,
        status: formStatus,
        showInPOS: formShowInPOS,
        displayOrder: Number(formDisplayOrder || 1)
      };

      if (editingCategory) {
        payload.id = editingCategory.id;
        payload.createdAt = editingCategory.createdAt;
      }

      const res = await api.saveCategory(payload);
      if (!res.success) {
        throw new Error(res.error || 'فشل حفظ التصنيف');
      }

      await onRefreshCategories();
      setIsEditModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || 'حدث خطأ غير متوقع');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Quick Reorder
  const handleMoveOrder = async (cat: ProductCategory, direction: 'UP' | 'DOWN') => {
    if (!canManage || busyCategoryId) return;
    const siblings = categories
      .filter(c => (c.parentCategoryId || null) === (cat.parentCategoryId || null))
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

    const currentIndex = siblings.findIndex(s => s.id === cat.id);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'UP' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;

    const targetCat = siblings[targetIndex];
    const tempOrder = cat.displayOrder || 0;
    const newOrder = targetCat.displayOrder || 0;

    setBusyCategoryId(cat.id);
    try {
      await api.saveCategory({ ...cat, displayOrder: newOrder });
      await api.saveCategory({ ...targetCat, displayOrder: tempOrder === newOrder ? tempOrder + 1 : tempOrder });
      await onRefreshCategories();
    } catch (err: any) {
      console.error('Failed to reorder categories:', err);
    } finally {
      setBusyCategoryId(null);
    }
  };

  // Handle Toggle POS Visibility
  const handleTogglePOS = async (cat: ProductCategory) => {
    if (!canManage || busyCategoryId) return;
    setBusyCategoryId(cat.id);
    try {
      await api.saveCategory({
        ...cat,
        showInPOS: !cat.showInPOS
      });
      await onRefreshCategories();
    } catch (err: any) {
      setPageError(err.message || 'فشل تحديث الظهور بنقطة البيع');
    } finally {
      setBusyCategoryId(null);
    }
  };

  // Open Delete Modal & Check for blocking conditions
  const handleOpenDelete = (cat: ProductCategory) => {
    if (!canManage) return;
    setDeleteTarget(cat);
    setDeleteError(null);
  };

  // Confirm Delete
  const handleConfirmDelete = async () => {
    if (!canManage || !deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await api.deleteCategory(deleteTarget.id);
      if (!res.success) {
        setDeleteError(res.error || 'تعذر حذف التصنيف');
        return;
      }

      await onRefreshCategories();
      setDeleteTarget(null);
    } catch (err: any) {
      setDeleteError(err.message || 'حدث خطأ أثناء محاولة الحذف');
    } finally {
      setIsDeleting(false);
    }
  };

  // Archive / Deactivate instead of Delete
  const handleDeactivateInstead = async () => {
    if (!canManage || !deleteTarget) return;
    setIsDeleting(true);
    try {
      await api.saveCategory({
        ...deleteTarget,
        status: 'معطل',
        showInPOS: false
      });
      await onRefreshCategories();
      setDeleteTarget(null);
    } catch (err: any) {
      setDeleteError(err.message || 'فشل إيقاف تفعيل التصنيف');
    } finally {
      setIsDeleting(false);
    }
  };

  // Render individual category tree node
  const renderTreeNode = (
    node: ProductCategory & { children: ProductCategory[]; directItemCount: number },
    depth = 0
  ) => {
    const isCollapsed = Boolean(collapsedMap[node.id]);
    const hasChildren = node.children && node.children.length > 0;
    const isDirectMatch = searchQuery.trim()
      ? node.name.toLowerCase().includes(searchQuery.toLowerCase())
      : true;

    // Filter conditions
    if (filterPos === 'VISIBLE' && !node.showInPOS) return null;
    if (filterPos === 'HIDDEN' && node.showInPOS) return null;
    if (filterStatus === 'ACTIVE' && node.status !== 'نشط') return null;
    if (filterStatus === 'INACTIVE' && node.status === 'نشط') return null;

    return (
      <div key={node.id} className="group">
        <div
          className={`flex items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl transition border ${
            depth === 0
              ? 'bg-white border-slate-200/80 hover:border-slate-300 shadow-xs'
              : 'bg-slate-50/70 border-slate-200/60 hover:bg-white hover:border-slate-300'
          } ${!isDirectMatch && searchQuery.trim() ? 'opacity-50' : ''}`}
          style={{ marginRight: `${depth * 28}px` }}
        >
          {/* Right info */}
          <div className="flex items-center gap-3 min-w-0">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCollapse(node.id)}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition shrink-0 cursor-pointer"
                title={isCollapsed ? 'عرض الفروع' : 'طي الفروع'}
              >
                {isCollapsed ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4 rotate-90" />
                )}
              </button>
            ) : (
              <div className="w-7 h-7 flex items-center justify-center text-slate-300 shrink-0">
                <div className="w-2 h-2 rounded-full bg-slate-300" />
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold text-sm sm:text-base text-slate-900 truncate">
                  {node.name}
                </span>

                {depth === 0 ? (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200/60">
                    تصنيف رئيسي
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600">
                    فرعي (مستوى {depth})
                  </span>
                )}

                {node.status === 'نشط' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>نشط</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/60">
                    <XCircle className="w-3 h-3" />
                    <span>معطل</span>
                  </span>
                )}

                {node.showInPOS ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200/60">
                    <Eye className="w-3 h-3" />
                    <span>ظاهر بنقطة البيع</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                    <EyeOff className="w-3 h-3" />
                    <span>مخفي عن الكاشير</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                {onNavigateToItemsWithCategory ? (
                  <a
                    href={getHrefForTarget('items', undefined, {
                      searchParams: { category: node.id }
                    })}
                    onClick={(e) => {
                      if (!isPlainLeftClick(e)) return;
                      e.preventDefault();
                      onNavigateToItemsWithCategory(node.id);
                    }}
                    className="flex items-center gap-1 font-mono hover:text-[#1678C2] hover:underline transition"
                    title={`عرض أصناف ${node.name}`}
                  >
                    <Package className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      الأصناف المباشرة: <strong>{node.directItemCount}</strong>
                      {hasChildren && ` (إجمالي الشجرة: ${node.itemCount || node.directItemCount})`}
                    </span>
                  </a>
                ) : (
                  <span className="flex items-center gap-1 font-mono">
                    <Package className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      الأصناف المباشرة: <strong>{node.directItemCount}</strong>
                      {hasChildren && ` (إجمالي الشجرة: ${node.itemCount || node.directItemCount})`}
                    </span>
                  </span>
                )}
                <span>•</span>
                <span>ترتيب العرض: <strong>{node.displayOrder || 1}</strong></span>
              </div>
            </div>
          </div>

          {/* Left Action Buttons */}
          <div className="no-print flex items-center gap-1.5 shrink-0">
            {canManage && (
              <>
                {/* Reorder Buttons */}
                <div className="hidden sm:flex items-center bg-slate-100 rounded-xl p-0.5 border border-slate-200">
                  <button
                    type="button"
                    disabled={busyCategoryId === node.id}
                    onClick={() => handleMoveOrder(node, 'UP')}
                    className="p-1 rounded-lg text-slate-600 hover:bg-white hover:text-slate-900 transition cursor-pointer disabled:opacity-40"
                    title="تحريك لأعلى"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busyCategoryId === node.id}
                    onClick={() => handleMoveOrder(node, 'DOWN')}
                    className="p-1 rounded-lg text-slate-600 hover:bg-white hover:text-slate-900 transition cursor-pointer disabled:opacity-40"
                    title="تحريك لأسفل"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Toggle Show in POS */}
                <button
                  type="button"
                  disabled={busyCategoryId === node.id}
                  onClick={() => handleTogglePOS(node)}
                  className={`p-2 rounded-xl text-xs font-semibold transition border cursor-pointer disabled:opacity-50 ${
                    node.showInPOS
                      ? 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100'
                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                  }`}
                  title={node.showInPOS ? 'إخفاء عن نقطة البيع' : 'إظهار في نقطة البيع'}
                >
                  {node.showInPOS ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>

                {/* Add Subcategory */}
                <button
                  type="button"
                  onClick={() => handleOpenCreate(node.id)}
                  className="px-2.5 py-1.5 rounded-xl bg-cyan-50 hover:bg-cyan-100 text-cyan-800 text-xs font-bold transition flex items-center gap-1 border border-cyan-200 cursor-pointer"
                  title="إضافة تصنيف فرعي تحت هذا التصنيف"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">فرع</span>
                </button>

                {/* Edit */}
                <button
                  type="button"
                  onClick={() => handleOpenEdit(node)}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                  title="تعديل التصنيف"
                >
                  <Edit2 className="w-4 h-4" />
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => handleOpenDelete(node)}
                  className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 transition cursor-pointer"
                  title="حذف التصنيف"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Render Children */}
        {!isCollapsed && hasChildren && (
          <div className="mt-2 space-y-2 border-r-2 border-slate-200/80 pr-2">
            {node.children.map(child => renderTreeNode(child as any, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PrintHeader title="إدارة التصنيفات الشجرية" />

      {/* Top Banner & Header */}
      <div className="no-print bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-700 text-white flex items-center justify-center shadow-md shadow-cyan-900/10">
              <FolderTree className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                إدارة التصنيفات الشجرية
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                تنظيم دليل المنتجات في هيكل هرمي متعدد المستويات والتحكم بالظهور في نقطة البيع
              </p>
            </div>
          </div>
        </div>

        {canManage && (
          <button
            type="button"
            data-shortcut-add="true"
            onClick={() => handleOpenCreate(null)}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-cyan-700 hover:bg-cyan-800 text-white font-bold text-sm shadow-md shadow-cyan-900/15 transition cursor-pointer shrink-0"
          >
            <Plus className="w-5 h-5" />
            <span>إضافة تصنيف جديد</span>
            <ShortcutBadge actionId="general.add_new" className="bg-white/20 text-white border-white/30" />
          </button>
        )}
      </div>

      {pageError && (
        <div className="no-print p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between gap-2 animate-in fade-in">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{pageError}</span>
          </div>
          <button onClick={() => setPageError(null)} className="text-rose-500 hover:text-rose-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
            <span>إجمالي التصنيفات</span>
            <Layers className="w-4 h-4 text-cyan-600" />
          </div>
          <p className="text-2xl font-black text-slate-900">{totalCategories}</p>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
            <span>تصنيفات رئيسية (Level 0)</span>
            <FolderTree className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-black text-slate-900">{rootCategoriesCount}</p>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
            <span>تصنيفات فرعية تابعة</span>
            <CornerDownLeft className="w-4 h-4 text-purple-600" />
          </div>
          <p className="text-2xl font-black text-slate-900">{subCategoriesCount}</p>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
            <span>متاحة في كاشير POS</span>
            <Eye className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-emerald-700">{posVisibleCount}</p>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="no-print bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row items-center gap-3 justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث باسم التصنيف..."
            className="w-full pr-9 pl-4 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-slate-50 focus:bg-white"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <select
            value={filterPos}
            onChange={(e) => setFilterPos(e.target.value as any)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-slate-50 text-slate-700 font-bold focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <option value="ALL">جميع أوضاع POS</option>
            <option value="VISIBLE">الظاهرة فقط في POS</option>
            <option value="HIDDEN">المخفية عن POS</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-slate-50 text-slate-700 font-bold focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <option value="ALL">جميع الحالات</option>
            <option value="ACTIVE">النشطة فقط</option>
            <option value="INACTIVE">المعطلة فقط</option>
          </select>
        </div>
      </div>

      {/* Tree Content Area */}
      <div className="space-y-3">
        {categoryTree.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-slate-200">
            <FolderTree className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-700">لا توجد تصنيفات مسجلة حتى الآن</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              أنشئ أول تصنيف رئيسي للبدء في تصنيف الأصناف وتنظيم نقطة البيع
            </p>
            {canManage && (
              <button
                type="button"
                onClick={() => handleOpenCreate(null)}
                className="mt-4 px-4 py-2 rounded-xl bg-cyan-700 text-white text-xs font-bold hover:bg-cyan-800 transition"
              >
                + إنشاء تصنيف رئيسي
              </button>
            )}
          </div>
        ) : (
          categoryTree.map(rootNode => renderTreeNode(rootNode as any, 0))
        )}
      </div>

      {/* Modal: Add / Edit Category */}
      {isEditModalOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto" dir="rtl">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
            <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 border border-cyan-100 flex items-center justify-center text-cyan-700">
                  <FolderTree className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    {editingCategory ? `تعديل تصنيف: ${editingCategory.name}` : 'إضافة تصنيف جديد'}
                  </h3>
                  <p className="text-xs text-slate-500">تحديد الاسم والمستوى وعلاقة التبعية والظهور</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 sm:p-6 space-y-4">
              {formError && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                  اسم التصنيف <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="مثال: شواحن وبطاريات متنقلة"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 font-bold"
                />
              </div>

              {/* Parent Category Selector */}
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                  التصنيف الأب (التبعية الهرمية)
                </label>
                <select
                  value={formParentId || ''}
                  onChange={(e) => setFormParentId(e.target.value ? e.target.value : null)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  <option value="">─ تصنيف رئيسي (مستوى 0 / بدون أب) ─</option>
                  {categories
                    .filter(c => {
                      if (!editingCategory) return true;
                      if (c.id === editingCategory.id) return false;
                      // منع اختيار أي من الفروع التابعة له لتفادي العلاقات الدائرية
                      const descendants = getDescendantIds(editingCategory.id);
                      if (descendants.has(c.id)) return false;
                      return true;
                    })
                    .map(c => {
                      const prefix = c.level && c.level > 0 ? ' '.repeat(c.level * 3) + '└─ ' : '';
                      return (
                        <option key={c.id} value={c.id}>
                          {prefix}{c.name}
                        </option>
                      );
                    })}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  اختر تصنيفاً أعلى لإنشاء فرع، أو اتركه رئيساً ليكون تصنيفاً مستقلاً في القمة
                </p>
              </div>

              {/* Display Order & Status Row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    ترتيب العرض
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={formDisplayOrder}
                    onChange={(e) => setFormDisplayOrder(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">الترتيب داخل نفس المستوى</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    الحالة
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="نشط">نشط (فعّال)</option>
                    <option value="معطل">معطل (موقوف)</option>
                  </select>
                </div>
              </div>

              {/* Show In POS Checkbox */}
              <div className="p-4 rounded-2xl bg-cyan-50/50 border border-cyan-100 flex items-start gap-3">
                <input
                  type="checkbox"
                  id="showInPOS"
                  checked={formShowInPOS}
                  onChange={(e) => setFormShowInPOS(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-cyan-600 rounded border-slate-300 focus:ring-cyan-500 cursor-pointer"
                />
                <label htmlFor="showInPOS" className="text-xs text-slate-700 cursor-pointer">
                  <span className="font-extrabold text-slate-900 block mb-0.5">
                    الظهور في شاشة نقطة البيع (POS)
                  </span>
                  <span className="text-[11px] text-slate-500 leading-relaxed block">
                    ملاحظة هامة: في حال إخفاء تصنيف رئيسي، سيتم تلقائياً إخفاء جميع التصنيفات الفرعية التابعة له عن شاشة الكاشير لضمان التناسق.
                  </span>
                </label>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-cyan-900/15 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>جاري الحفظ...</span>
                    </>
                  ) : (
                    <span>{editingCategory ? 'تحديث التصنيف' : 'إنشاء التصنيف'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Warning / Prevention */}
      {deleteTarget && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs" dir="rtl">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-7 h-7" />
              </div>

              <h3 className="text-lg font-black text-slate-900 mb-2">
                حذف التصنيف: {deleteTarget.name}
              </h3>

              {deleteError ? (
                <div className="text-right p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed mb-5">
                  <p className="font-extrabold mb-1">تعذر إتمام الحذف للأسباب التالية:</p>
                  <p>{deleteError}</p>
                </div>
              ) : (
                <p className="text-xs text-slate-600 leading-relaxed mb-5">
                  سيتم التحقق من عدم وجود أصناف مرتبطة أو تصنيفات فرعية تحت هذا التصنيف قبل الحذف النهائي.
                </p>
              )}

              <div className="flex flex-col gap-2">
                {deleteError ? (
                  <>
                    <button
                      type="button"
                      onClick={handleDeactivateInstead}
                      disabled={isDeleting}
                      className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs transition cursor-pointer shadow-md shadow-amber-900/10"
                    >
                      {isDeleting ? 'جاري التعطيل...' : 'إيقاف تفعيل التصنيف وإخفاؤه بدلاً من الحذف (موصى به)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(null)}
                      className="w-full py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 transition cursor-pointer"
                    >
                      إغلاق
                    </button>
                  </>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(null)}
                      className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 transition cursor-pointer"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmDelete}
                      disabled={isDeleting}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isDeleting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>جاري التحقق...</span>
                        </>
                      ) : (
                        <span>تأكيد الحذف</span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

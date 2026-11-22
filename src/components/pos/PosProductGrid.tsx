import React, { useState, useMemo, useEffect } from 'react';
import { Item, ProductCategory } from '../../types';
import {
  Package,
  Layers,
  Image as ImageIcon,
  LayoutGrid,
  List,
  FolderTree,
  Plus,
  Barcode,
  Settings
} from 'lucide-react';
import {
  readUiPrefs,
  UI_PREFS_EVENT,
  UI_PREFS_STORAGE_KEY,
  UiPrefs
} from '../../utils/uiScale';
import { getHrefForTarget, isPlainLeftClick } from '../../config/navigation';

export interface PosProductGridProps {
  items: Item[];
  posCategories?: ProductCategory[];
  selectedCategoryIds?: string[];
  allowNegativeStockSale?: boolean;
  onAddToCart: (item: Item) => void;
  posLayout?: 'grid' | 'compact' | 'list';
  canCustomizeDisplay?: boolean;
  onChangePosLayout?: (nextLayout: 'grid' | 'list') => void;
  onOpenCategorySettings?: () => void;
  previewUiPrefs?: UiPrefs;
}

// دالة مساعدة لاستخراج parentId بأمان سواء كان parentCategoryId أو parentId
function getParentId(cat?: ProductCategory | null): string | undefined {
  if (!cat) return undefined;
  const pId = cat.parentCategoryId || (cat as any).parentId;
  if (!pId || pId === '' || pId === 'null' || pId === 'undefined') return undefined;
  return String(pId);
}

export const PosProductGrid: React.FC<PosProductGridProps> = ({
  items,
  posCategories = [],
  selectedCategoryIds = [],
  allowNegativeStockSale = false,
  onAddToCart,
  posLayout = 'grid',
  canCustomizeDisplay = false,
  onChangePosLayout,
  onOpenCategorySettings,
  previewUiPrefs
}) => {
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [savedUiPrefs, setSavedUiPrefs] = useState<UiPrefs>(() => readUiPrefs());

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const custom = e as CustomEvent<UiPrefs>;
      setSavedUiPrefs(custom.detail ? custom.detail : readUiPrefs());
    };
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key === UI_PREFS_STORAGE_KEY) {
        setSavedUiPrefs(readUiPrefs());
      }
    };
    window.addEventListener(UI_PREFS_EVENT, handleUpdate);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(UI_PREFS_EVENT, handleUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const uiPrefs = previewUiPrefs || savedUiPrefs;
  const viewMode: 'cards' | 'list' = posLayout === 'list' ? 'list' : 'cards';
  const handleSetViewMode = (nextView: 'cards' | 'list') => {
    if (!canCustomizeDisplay) return;
    onChangePosLayout?.(nextView === 'list' ? 'list' : 'grid');
  };

  // 1. خريطة سريعة للتصنيفات الصالحة في نقطة البيع
  const categoryMap = useMemo(() => {
    const map = new Map<string, ProductCategory>();
    posCategories.forEach(c => map.set(c.id, c));
    return map;
  }, [posCategories]);

  // 2. مجموعة معرفات التصنيفات (الرئيسية والفرعية) المحددة للعرض في نقطة البيع من الإعدادات
  const configuredCategoryIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const rawId of selectedCategoryIds || []) {
      const id = String(rawId || '').trim();
      if (id && categoryMap.has(id)) {
        set.add(id);
      }
    }
    return set;
  }, [selectedCategoryIds, categoryMap]);

  // 3. التصنيفات الرئيسية المختارة للعرض فقط (بدون زر «الكل»)
  const visibleRootCategories = useMemo(() => {
    return posCategories
      .filter(c => !getParentId(c) && configuredCategoryIdSet.has(c.id))
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  }, [posCategories, configuredCategoryIdSet]);

  // مزامنة التصنيف الرئيسي النشط مع التصنيفات الرئيسية المختارة
  useEffect(() => {
    if (visibleRootCategories.length === 0) {
      if (selectedRootId !== null) setSelectedRootId(null);
      if (selectedSubId !== null) setSelectedSubId(null);
      return;
    }
    if (!selectedRootId || !visibleRootCategories.some(c => c.id === selectedRootId)) {
      setSelectedRootId(visibleRootCategories[0].id);
      setSelectedSubId(null);
    }
  }, [visibleRootCategories, selectedRootId, selectedSubId]);

  const effectiveSelectedRootId = useMemo(() => {
    if (visibleRootCategories.length === 0) return null;
    if (selectedRootId && visibleRootCategories.some(c => c.id === selectedRootId)) {
      return selectedRootId;
    }
    return visibleRootCategories[0].id;
  }, [visibleRootCategories, selectedRootId]);

  const activeRootCategory = useMemo(() => {
    if (!effectiveSelectedRootId) return null;
    return categoryMap.get(effectiveSelectedRootId) || null;
  }, [effectiveSelectedRootId, categoryMap]);

  // 4. جميع الفروع التابعة للتصنيف الرئيسي النشط في النظام، والفروع المختارة للعرض فقط تحته
  const allSubsOfActiveRoot = useMemo(() => {
    if (!activeRootCategory) return [];
    return posCategories
      .filter(c => getParentId(c) === activeRootCategory.id)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  }, [posCategories, activeRootCategory]);

  // تحت كل تصنيف رئيسي تُعرض التصنيفات الفرعية المختارة التابعة له فقط (دون عرض جميع الفروع تلقائياً كبديل)
  const visibleSubsOfActiveRoot = useMemo(() => {
    return allSubsOfActiveRoot.filter(c => configuredCategoryIdSet.has(c.id));
  }, [allSubsOfActiveRoot, configuredCategoryIdSet]);

  // مزامنة التصنيف الفرعي المختار (لا توجد حالة مخفية تعني «كل التصنيفات الفرعية»)
  useEffect(() => {
    if (
      selectedSubId !== null &&
      !visibleSubsOfActiveRoot.some(c => c.id === selectedSubId)
    ) {
      setSelectedSubId(null);
    }
  }, [visibleSubsOfActiveRoot, selectedSubId]);

  const effectiveSelectedSubId = useMemo(() => {
    if (!activeRootCategory || visibleSubsOfActiveRoot.length === 0) return null;
    if (selectedSubId && visibleSubsOfActiveRoot.some(c => c.id === selectedSubId)) {
      return selectedSubId;
    }
    return null;
  }, [activeRootCategory, visibleSubsOfActiveRoot, selectedSubId]);

  const activeSubCategory = useMemo(() => {
    if (!effectiveSelectedSubId) return null;
    return categoryMap.get(effectiveSelectedSubId) || null;
  }, [effectiveSelectedSubId, categoryMap]);

  // 5. الأصناف المتاحة والنشطة للـ POS
  const activeItems = useMemo(() => {
    return items.filter(
      it => it.status !== 'inactive' && it.status !== 'موقوف' && it.status !== 'مؤرشف'
    );
  }, [items]);

  // 6. إحصائيات عدد الأصناف المباشرة لكل تصنيف، وإجمالي الأصناف ضمن الفروع المختارة فقط للتصنيف الرئيسي
  const directCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of posCategories) {
      counts[c.id] = 0;
    }
    for (const it of activeItems) {
      if (it.categoryId && counts[it.categoryId] !== undefined) {
        counts[it.categoryId] += 1;
      }
    }
    return counts;
  }, [activeItems, posCategories]);

  const rootBadgeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const root of visibleRootCategories) {
      const allSubs = posCategories.filter(c => getParentId(c) === root.id);
      if (allSubs.length > 0) {
        const selectedSubs = allSubs.filter(c => configuredCategoryIdSet.has(c.id));
        counts[root.id] = selectedSubs.reduce(
          (sum, sub) => sum + (directCategoryCounts[sub.id] || 0),
          0
        );
      } else {
        counts[root.id] = directCategoryCounts[root.id] || 0;
      }
    }
    return counts;
  }, [visibleRootCategories, posCategories, configuredCategoryIdSet, directCategoryCounts]);

  // هل التصنيف الرئيسي الحالي يتطلب اختيار تصنيف فرعي؟
  const activeRootHasSubCategoriesInSystem = allSubsOfActiveRoot.length > 0;

  // 7. تصفية الأصناف:
  // - إذا كان للتصنيف الرئيسي فروع، لا تُعرض أي أصناف إلا بعد اختيار تصنيف فرعي محدد (لا توجد حالة مخفية لـ «كل التصنيفات الفرعية»).
  // - إذا كان التصنيف الرئيسي مستقلاً بلا أي تصنيفات فرعية في النظام، تُعرض أصنافه المباشرة فقط.
  const filteredItems = useMemo(() => {
    if (!activeRootCategory) {
      return [];
    }
    if (activeRootHasSubCategoriesInSystem) {
      if (!effectiveSelectedSubId) {
        return [];
      }
      return activeItems.filter(it => it.categoryId === effectiveSelectedSubId);
    }
    return activeItems.filter(it => it.categoryId === activeRootCategory.id);
  }, [
    activeItems,
    activeRootCategory,
    activeRootHasSubCategoriesInSystem,
    effectiveSelectedSubId
  ]);

  const catIconSizeClass =
    uiPrefs.posCategorySize === 'small'
      ? 'w-3 h-3'
      : uiPrefs.posCategorySize === 'large'
      ? 'w-4 h-4'
      : 'w-3.5 h-3.5';

  const cardPaddingClass =
    uiPrefs.posCardSize === 'small'
      ? 'p-[6px]'
      : uiPrefs.posCardSize === 'large'
      ? 'p-[10px]'
      : 'p-2';

  const cardNameBoxClass =
    uiPrefs.posCardSize === 'small'
      ? 'p-1.5 mb-1.5'
      : uiPrefs.posCardSize === 'large'
      ? 'p-2.5 mb-2'
      : 'p-2 mb-2';

  const cardNameTextClass =
    uiPrefs.posCardSize === 'small'
      ? 'text-[12px]'
      : uiPrefs.posCardSize === 'large'
      ? 'text-[15px]'
      : 'text-[14px]';

  const cardPriceTextClass =
    uiPrefs.posCardSize === 'small'
      ? 'text-[12.5px]'
      : uiPrefs.posCardSize === 'large'
      ? 'text-[15.5px]'
      : 'text-[14px]';

  return (
    <div className="pos-surface pos-products-surface flex-1 flex flex-col h-full bg-white rounded-2xl border border-slate-200 shadow-xs">
      
      {/* 1. الصف الأول: التصنيفات الرئيسية المختارة للعرض فقط (بدون زر «الكل») */}
      {visibleRootCategories.length > 0 && (
        <div className="pos-categories-bar p-2 border-b border-slate-200 bg-slate-50/60 shrink-0">
          <div className="flex overflow-x-auto md:overflow-visible flex-nowrap md:flex-wrap items-center gap-2 pb-1 md:pb-0 custom-scrollbar">
            {visibleRootCategories.map(cat => {
              const isSelected = activeRootCategory?.id === cat.id;
              const count = rootBadgeCounts[cat.id] || 0;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setSelectedRootId(cat.id);
                    if (cat.id !== activeRootCategory?.id) {
                      setSelectedSubId(null);
                    }
                  }}
                  style={{ fontSize: 'var(--pos-cat-font)' }}
                  className={`min-h-[var(--pos-cat-h)] h-[var(--pos-cat-h)] shrink-0 px-3 py-1 rounded-xl font-bold transition cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-center leading-tight shadow-2xs ${
                    isSelected
                      ? 'bg-cyan-600 text-white shadow-xs'
                      : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  <span>{cat.name}</span>
                  {count > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono shrink-0 ${
                        isSelected ? 'bg-cyan-700 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. الصف الثاني: التصنيفات الفرعية المختارة التابعة للتصنيف الرئيسي الحالي فقط (بدون زر «الكل») */}
      {activeRootCategory && visibleSubsOfActiveRoot.length > 0 && (
        <div className="pos-categories-bar p-2 border-b border-slate-200 bg-cyan-50/40 shrink-0">
          <div className="text-[12px] font-bold text-cyan-900 flex items-center gap-1.5 mb-1.5">
            <FolderTree className={`${catIconSizeClass} text-cyan-700 shrink-0`} />
            <span>فروع {activeRootCategory.name}:</span>
          </div>

          <div className="flex overflow-x-auto md:overflow-visible flex-nowrap md:flex-wrap items-center gap-2 pb-1 md:pb-0 custom-scrollbar">
            {visibleSubsOfActiveRoot.map(sub => {
              const isSelected = effectiveSelectedSubId === sub.id;
              const count = directCategoryCounts[sub.id] || 0;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setSelectedSubId(sub.id)}
                  style={{ fontSize: 'var(--pos-cat-font)' }}
                  className={`min-h-[var(--pos-cat-h)] h-[var(--pos-cat-h)] shrink-0 px-3 py-1 rounded-xl transition cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-center leading-tight shadow-2xs ${
                    isSelected
                      ? 'bg-cyan-50 border-2 border-cyan-600 text-cyan-900 font-bold shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{sub.name}</span>
                  {count > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono shrink-0 ${
                        isSelected
                          ? 'bg-cyan-600 text-white'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. عنوان المسار الحالي + أزرار تبديل العرض (كروت/قائمة) */}
      <div className="pos-categories-bar px-3 py-1.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between gap-2 text-xs text-slate-600 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5">
          {visibleRootCategories.length === 0 ? (
            <span className="font-bold text-slate-600 shrink-0">لم يتم تحديد تصنيفات للعرض</span>
          ) : !activeRootCategory ? (
            <span className="font-bold text-slate-600 shrink-0">اختر تصنيفًا لعرض الأصناف</span>
          ) : activeRootHasSubCategoriesInSystem ? (
            <>
              <span className="font-semibold text-slate-700 shrink-0">{activeRootCategory.name}</span>
              <span className="text-slate-400 shrink-0">›</span>
              {activeSubCategory ? (
                <span className="font-bold text-slate-900 shrink-0">{activeSubCategory.name}</span>
              ) : visibleSubsOfActiveRoot.length === 0 ? (
                <span className="font-semibold text-amber-700 shrink-0">
                  لم يتم تحديد تصنيفات فرعية للعرض
                </span>
              ) : (
                <span className="font-semibold text-cyan-800 shrink-0">
                  اختر تصنيفًا فرعيًا
                </span>
              )}
            </>
          ) : (
            <span className="font-bold text-slate-900 shrink-0">{activeRootCategory.name}</span>
          )}
        </div>

        {/* أزرار نمط العرض: كروت أو قائمة على الطرف الشمال */}
        {canCustomizeDisplay && (
          <div className="flex items-center bg-slate-200/80 p-0.5 rounded-xl shrink-0 mr-auto">
            <button
              type="button"
              onClick={() => handleSetViewMode('cards')}
              title="عرض كروت"
              aria-label="عرض كروت"
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                viewMode === 'cards'
                  ? 'bg-white text-cyan-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode('list')}
              title="عرض قائمة"
              aria-label="عرض قائمة"
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white text-cyan-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 4. مساحة عرض كروت الأصناف أو حالة التوجيه لاختيار تصنيف فرعي */}
      <div className="flex-1 p-2.5 sm:p-3">
        {visibleRootCategories.length === 0 ? (
          <div className="min-h-[240px] flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <Layers className="w-12 h-12 text-slate-300 mb-2.5 stroke-[1.5]" />
            <h4 className="text-sm font-bold text-slate-700 mb-1">
              لم يتم تحديد تصنيفات لنقطة البيع
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mb-3.5 leading-relaxed">
              لا توجد تصنيفات مختارة للعرض في شاشة البيع حالياً. يرجى تحديد التصنيفات الرئيسية والفرعية المطلوب إظهارها من إعدادات عرض شاشة البيع.
            </p>
            {canCustomizeDisplay && onOpenCategorySettings && (
              <a
                href={getHrefForTarget('settings', 'sales')}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return;
                  e.preventDefault();
                  onOpenCategorySettings();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-200 text-xs font-bold cursor-pointer transition"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>تحديد التصنيفات من الإعدادات</span>
              </a>
            )}
          </div>
        ) : activeRootCategory && activeRootHasSubCategoriesInSystem && visibleSubsOfActiveRoot.length === 0 ? (
          <div className="min-h-[240px] flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <FolderTree className="w-12 h-12 text-slate-300 mb-2.5 stroke-[1.5]" />
            <h4 className="text-sm font-bold text-slate-700 mb-1">
              لم يتم تحديد تصنيفات فرعية تحت «{activeRootCategory.name}»
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mb-3.5 leading-relaxed">
              لا توجد تصنيفات فرعية مختارة للعرض تحت هذا التصنيف الرئيسي. يرجى تحديد التصنيفات الفرعية المطلوب إظهارها من إعدادات عرض شاشة البيع أو من قائمة «شكل الشاشة».
            </p>
            {canCustomizeDisplay && onOpenCategorySettings && (
              <a
                href={getHrefForTarget('settings', 'sales')}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return;
                  e.preventDefault();
                  onOpenCategorySettings();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-200 text-xs font-bold cursor-pointer transition"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>تحديد التصنيفات الفرعية من الإعدادات</span>
              </a>
            )}
          </div>
        ) : activeRootCategory && activeRootHasSubCategoriesInSystem && !effectiveSelectedSubId ? (
          <div className="min-h-[220px] flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <FolderTree className="w-11 h-11 text-cyan-600/60 mb-2.5 stroke-[1.5]" />
            <h4 className="text-sm font-bold text-slate-700 mb-1">
              اختر تصنيفًا فرعيًا لعرض الأصناف
            </h4>
            <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
              يرجى اختيار أحد التصنيفات الفرعية التابعة لـ «{activeRootCategory.name}» من الشريط أعلاه لعرض الأصناف التابعة له.
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="min-h-[220px] flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <Package className="w-12 h-12 text-slate-300 mb-2 stroke-[1.5]" />
            <h4 className="text-sm font-bold text-slate-700 mb-1">لا توجد أصناف</h4>
            <p className="text-xs text-slate-500 max-w-xs">
              لا توجد أصناف في هذا التصنيف حالياً.
            </p>
          </div>
        ) : viewMode === 'cards' ? (
          /* عرض شبكي للبطاقات: يستعمل --pos-card-w كعرض الكارت و --pos-card-img-h لارتفاع الصورة */
          <div className="grid grid-cols-2 sm:[grid-template-columns:repeat(auto-fill,var(--pos-card-w))] justify-start gap-2 items-stretch w-full">
            {filteredItems.map(item => {
              const isOutOfStock = item.stockQuantity <= 0;
              const isLowStock = !isOutOfStock && item.stockQuantity <= 5;
              const isDisabled = isOutOfStock && !allowNegativeStockSale;

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (!isDisabled) onAddToCart(item);
                  }}
                  className={`pos-product-card group relative flex flex-col justify-between h-full rounded-xl border ${cardPaddingClass} transition text-center ${
                    isDisabled
                      ? 'bg-slate-50/70 border-slate-200 opacity-60 cursor-not-allowed'
                      : 'bg-white border-slate-200 hover:border-cyan-400 hover:shadow-md cursor-pointer active:scale-[0.98]'
                  }`}
                >
                  <div className="flex flex-col flex-1">
                    {/* الصورة: ارتفاع من --pos-card-img-h، وتختفي عند [data-pos-images="off"] */}
                    <div className="pos-card-image relative w-full h-[var(--pos-card-img-h)] rounded-lg bg-white overflow-hidden mb-2 flex items-center justify-center p-1 border border-slate-100 shrink-0">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          loading="lazy"
                          className="w-full h-full object-contain bg-white group-hover:scale-105 transition duration-300"
                          onError={e => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 bg-white">
                          <ImageIcon className="w-8 h-8 stroke-1 text-slate-300" />
                        </div>
                      )}

                      {/* شارة المخزون داخل الصورة */}
                      <span
                        className={`absolute top-1.5 right-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow-2xs ${
                          isOutOfStock
                            ? 'bg-rose-500 text-white'
                            : isLowStock
                            ? 'bg-amber-500 text-white'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {isOutOfStock ? 'نفد (0)' : `متاح: ${item.stockQuantity}`}
                      </span>
                    </div>

                    {/* شارة المخزون البديلة عند إخفاء الصور */}
                    <div className="pos-card-stock-no-img hidden items-center justify-end mb-1">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                          isOutOfStock
                            ? 'bg-rose-500 text-white'
                            : isLowStock
                            ? 'bg-amber-500 text-white'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {isOutOfStock ? 'نفد (0)' : `متاح: ${item.stockQuantity}`}
                      </span>
                    </div>

                    {/* اسم الصنف كامل */}
                    <div className={`w-full h-auto bg-slate-50 border border-slate-100 rounded-lg ${cardNameBoxClass} flex items-center justify-center text-center flex-1`}>
                      <h4
                        className={`${cardNameTextClass} font-bold text-slate-900 leading-[1.35] text-center whitespace-normal break-words w-full`}
                        title={item.name}
                      >
                        {item.name}
                      </h4>
                    </div>
                  </div>

                  {/* السعر تحت الاسم */}
                  <div className="pt-1.5 border-t border-slate-100 flex items-center justify-center text-center shrink-0">
                    <span className={`font-extrabold ${cardPriceTextClass} text-cyan-700 font-mono`}>
                      {(item.salePrice || 0).toFixed(2)}
                      <span className="text-[11px] font-sans font-normal text-slate-500 mr-1">ج.م</span>
                      {item.unit && <span className="text-[11px] text-slate-400 font-normal"> / {item.unit}</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* عرض قائمة سطور مضغوطة: الاسم، الباركود، السعر، المتاح، وزر الإضافة */
          <div className="space-y-1.5">
            {filteredItems.map(item => {
              const isOutOfStock = item.stockQuantity <= 0;
              const isLowStock = !isOutOfStock && item.stockQuantity <= 5;
              const isDisabled = isOutOfStock && !allowNegativeStockSale;

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (!isDisabled) onAddToCart(item);
                  }}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border transition ${
                    isDisabled
                      ? 'bg-slate-50/70 border-slate-200 opacity-60 cursor-not-allowed'
                      : 'bg-white border-slate-200 hover:border-cyan-400 hover:bg-cyan-50/20 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="pos-card-image w-10 h-10 rounded-lg bg-white border border-slate-100 shrink-0 overflow-hidden flex items-center justify-center p-0.5">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-full h-full object-contain bg-white"
                          onError={e => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <Package className="w-4 h-4 text-slate-300" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-[13.5px] font-bold text-slate-900 leading-[1.35] whitespace-normal break-words text-right">
                        {item.name}
                      </h4>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                        {item.barcode && (
                          <span className="inline-flex items-center gap-1 font-mono text-slate-600">
                            <Barcode className="w-3 h-3 text-slate-400" />
                            <span>{item.barcode}</span>
                          </span>
                        )}
                        {item.categoryName && (
                          <span className="text-slate-400">• {item.categoryName}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isOutOfStock
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : isLowStock
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {isOutOfStock ? 'نفد (0)' : `متاح: ${item.stockQuantity}`}
                    </span>

                    <span className="font-extrabold text-[13.5px] text-cyan-800 font-mono min-w-[72px] text-left">
                      {(item.salePrice || 0).toFixed(2)} ج.م
                    </span>

                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isDisabled) onAddToCart(item);
                      }}
                      className="min-h-[34px] px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-300 text-white text-xs font-bold inline-flex items-center gap-1 transition cursor-pointer shrink-0"
                      title="إضافة للفاتورة"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>إضافة</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* الشريط السفلي: إحصائية الأصناف */}
      <div className="pos-categories-bar px-3 py-1.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
        <span>عرض {filteredItems.length} صنف</span>
        {allowNegativeStockSale && (
          <span className="text-amber-600 font-medium">البيع بالسالب مفعّل</span>
        )}
      </div>

    </div>
  );
};

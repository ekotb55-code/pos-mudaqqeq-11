import React, { useMemo, useState } from 'react';
import { ProductCategory } from '../../types';
import { FolderTree, Search, CheckSquare, Square, AlertCircle } from 'lucide-react';

interface PosVisibleCategoriesPickerProps {
  categories: ProductCategory[];
  selectedCategoryIds: string[];
  onChange: (nextIds: string[]) => void;
  compact?: boolean;
}

function getParentId(cat?: ProductCategory | null): string | undefined {
  if (!cat) return undefined;
  const pId = cat.parentCategoryId || (cat as any).parentId;
  if (!pId || pId === '' || pId === 'null' || pId === 'undefined') return undefined;
  return String(pId);
}

/**
 * استخراج التصنيفات النشطة والصالحة للظهور في نقطة البيع (نشطة ومفعّلة showInPOS وجميع أسلافها كذلك)
 */
export function filterEligiblePosCategories(categories: ProductCategory[]): ProductCategory[] {
  const catMap = new Map<string, ProductCategory>();
  for (const c of categories) {
    if (c && c.id) catMap.set(c.id, c);
  }

  const isEligible = (cat: ProductCategory, visited = new Set<string>()): boolean => {
    if (visited.has(cat.id)) return false;
    visited.add(cat.id);
    const isActive = cat.status === 'active' || cat.status === 'نشط';
    const isVisibleInPOS = cat.showInPOS !== false;
    if (!isActive || !isVisibleInPOS) return false;
    const pId = getParentId(cat);
    if (pId) {
      const parent = catMap.get(pId);
      if (!parent || !isEligible(parent, visited)) return false;
    }
    return true;
  };

  return categories.filter((c) => c && c.id && isEligible(c));
}

export const PosVisibleCategoriesPicker: React.FC<PosVisibleCategoriesPickerProps> = ({
  categories,
  selectedCategoryIds,
  onChange,
  compact = false
}) => {
  const [search, setSearch] = useState('');

  const eligibleCategories = useMemo(
    () => filterEligiblePosCategories(categories),
    [categories]
  );

  const eligibleById = useMemo(() => {
    const map = new Map<string, ProductCategory>();
    for (const c of eligibleCategories) {
      map.set(c.id, c);
    }
    return map;
  }, [eligibleCategories]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, ProductCategory[]>();
    for (const c of eligibleCategories) {
      const pId = getParentId(c);
      if (pId) {
        const list = map.get(pId) || [];
        list.push(c);
        map.set(pId, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    }
    return map;
  }, [eligibleCategories]);

  const rootCategories = useMemo(
    () =>
      eligibleCategories
        .filter((c) => !getParentId(c))
        .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)),
    [eligibleCategories]
  );

  const subCategories = useMemo(
    () => eligibleCategories.filter((c) => Boolean(getParentId(c))),
    [eligibleCategories]
  );

  const selectedSet = useMemo(
    () =>
      new Set(
        (selectedCategoryIds || [])
          .map((id) => String(id || '').trim())
          .filter((id) => id && eligibleById.has(id))
      ),
    [selectedCategoryIds, eligibleById]
  );

  const selectedRootsCount = useMemo(
    () => rootCategories.filter((r) => selectedSet.has(r.id)).length,
    [rootCategories, selectedSet]
  );

  const selectedSubsCount = useMemo(
    () => subCategories.filter((s) => selectedSet.has(s.id)).length,
    [subCategories, selectedSet]
  );

  const getDescendantIds = (rootId: string): Set<string> => {
    const result = new Set<string>();
    const stack = [...(childrenByParent.get(rootId) || [])];
    while (stack.length > 0) {
      const curr = stack.pop()!;
      if (result.has(curr.id)) continue;
      result.add(curr.id);
      const kids = childrenByParent.get(curr.id);
      if (kids && kids.length > 0) {
        stack.push(...kids);
      }
    }
    return result;
  };

  const getAncestorIds = (cat: ProductCategory): string[] => {
    const ancestors: string[] = [];
    let pId = getParentId(cat);
    const visited = new Set<string>();
    while (pId && !visited.has(pId)) {
      visited.add(pId);
      ancestors.push(pId);
      const parent = eligibleById.get(pId);
      pId = getParentId(parent);
    }
    return ancestors;
  };

  /**
   * تبديل اختيار تصنيف رئيسي:
   * - عند تفعيله: يُضاف معرّف التصنيف الرئيسي فقط (دون فرض تحديد كل الفروع تلقائياً ودون حذف الفروع المحددة).
   * - عند إلغائه: يُزال معرّف التصنيف الرئيسي وأي فروع تابعة له حتى لا تبقى فروع يتيمة بلا تصنيف رئيسي.
   */
  const handleToggleRootCategory = (root: ProductCategory) => {
    const next = new Set(selectedSet);
    if (next.has(root.id)) {
      next.delete(root.id);
      const descendants = getDescendantIds(root.id);
      for (const dId of descendants) {
        next.delete(dId);
      }
    } else {
      next.add(root.id);
    }
    onChange(Array.from(next));
  };

  /**
   * تبديل اختيار تصنيف فرعي:
   * - يُحفظ معرّف التصنيف الفرعي نفسه ضمن posVisibleCategoryIds.
   * - عند اختيار تصنيف فرعي، يتم التأكد من اختيار التصنيف الرئيسي الأب له ليظهر تحته في شاشة البيع.
   */
  const handleToggleSubCategory = (sub: ProductCategory) => {
    const next = new Set(selectedSet);
    if (next.has(sub.id)) {
      next.delete(sub.id);
    } else {
      next.add(sub.id);
      for (const ancId of getAncestorIds(sub)) {
        next.add(ancId);
      }
    }
    onChange(Array.from(next));
  };

  /**
   * تحديد أو إلغاء تحديد جميع الفروع التابعة لتصنيف رئيسي معيّن
   */
  const handleToggleAllSubsForRoot = (root: ProductCategory, subs: ProductCategory[]) => {
    if (subs.length === 0) return;
    const next = new Set(selectedSet);
    const allSubsSelected = subs.every((s) => next.has(s.id));
    if (allSubsSelected) {
      for (const s of subs) {
        next.delete(s.id);
      }
    } else {
      next.add(root.id);
      for (const s of subs) {
        next.add(s.id);
      }
    }
    onChange(Array.from(next));
  };

  const handleSelectAllCategories = () => {
    onChange(eligibleCategories.map((c) => c.id));
  };

  const handleClearAll = () => {
    onChange([]);
  };

  const normalizedQuery = search.trim().toLowerCase();

  const filteredTree = useMemo(() => {
    if (!normalizedQuery) {
      return rootCategories.map((root) => ({
        root,
        subs: childrenByParent.get(root.id) || []
      }));
    }
    const out: Array<{ root: ProductCategory; subs: ProductCategory[] }> = [];
    for (const root of rootCategories) {
      const allSubs = childrenByParent.get(root.id) || [];
      const rootMatches = root.name.toLowerCase().includes(normalizedQuery);
      const matchingSubs = allSubs.filter((s) =>
        s.name.toLowerCase().includes(normalizedQuery)
      );
      if (rootMatches || matchingSubs.length > 0) {
        out.push({
          root,
          subs: rootMatches ? allSubs : matchingSubs
        });
      }
    }
    return out;
  }, [rootCategories, childrenByParent, normalizedQuery]);

  if (eligibleCategories.length === 0) {
    return (
      <div className="p-3 rounded-xl border border-[var(--border-color)] bg-[var(--surface-subtle)] text-xs text-[var(--text-secondary)]">
        لا توجد تصنيفات نشطة متاحة للاختيار حالياً. أضف تصنيفات من شاشة التصنيفات أولاً.
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-2.5">
      {/* شريط الملخص والإجراءات السريعة */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-[var(--text-primary)]">
          المحدد للعرض:{' '}
          <span className="font-mono text-[#1668B2]">{selectedRootsCount}</span>
          <span className="font-normal text-[var(--text-secondary)]">
            {' '}
            رئيسي (من {rootCategories.length})
          </span>
          {subCategories.length > 0 && (
            <>
              <span className="text-[var(--text-secondary)] mx-1">•</span>
              <span className="font-mono text-[#1668B2]">{selectedSubsCount}</span>
              <span className="font-normal text-[var(--text-secondary)]">
                {' '}
                فرعي (من {subCategories.length})
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleSelectAllCategories}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[11px] font-bold text-[var(--text-primary)] cursor-pointer transition"
          >
            <CheckSquare className="w-3.5 h-3.5 text-[#1668B2]" />
            <span>تحديد الكل</span>
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={selectedSet.size === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[11px] font-bold text-[var(--text-secondary)] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed transition"
          >
            <Square className="w-3.5 h-3.5" />
            <span>مسح الكل</span>
          </button>
        </div>
      </div>

      {selectedRootsCount === 0 && (
        <div
          role="status"
          className="flex items-start gap-2 p-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-[11px] font-semibold text-amber-800 dark:text-amber-200"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <span>
            لم يتم تحديد أي تصنيف رئيسي — ستظهر شاشة نقطة البيع بحالة فارغة تطلب تحديد التصنيفات ولن تعرض كل الأصناف تلقائياً.
          </span>
        </div>
      )}

      {/* بحث عند وجود عدد كبير من التصنيفات */}
      {eligibleCategories.length > 6 && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم التصنيف الرئيسي أو الفرعي..."
            className="w-full pr-8 pl-3 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--surface)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#1668B2]"
          />
        </div>
      )}

      {/* قائمة التصنيفات الهرمية (رئيسي + فرعي مستقل) */}
      <div
        className={`rounded-xl border border-[var(--border-color)] bg-[var(--surface)] divide-y divide-[var(--border-subtle)] overflow-y-auto custom-scrollbar ${
          compact ? 'max-h-48' : 'max-h-80'
        }`}
      >
        {filteredTree.length === 0 ? (
          <div className="p-4 text-center text-xs text-[var(--text-secondary)]">
            لا توجد تصنيفات مطابقة للبحث
          </div>
        ) : (
          filteredTree.map(({ root, subs }) => {
            const isRootSelected = selectedSet.has(root.id);
            const allRootSubs = childrenByParent.get(root.id) || [];
            const selectedRootSubsCount = allRootSubs.filter((s) => selectedSet.has(s.id)).length;
            const allVisibleSubsSelected = subs.length > 0 && subs.every((s) => selectedSet.has(s.id));

            return (
              <div key={root.id} className="p-2 space-y-1">
                <div className="flex items-center justify-between gap-2 px-1.5 py-1 rounded-lg hover:bg-[var(--surface-subtle)]">
                  <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isRootSelected}
                      onChange={() => handleToggleRootCategory(root)}
                      className="w-4 h-4 accent-[#1668B2] cursor-pointer shrink-0"
                    />
                    <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                      {root.name}
                    </span>
                  </label>

                  {allRootSubs.length > 0 && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                          isRootSelected && selectedRootSubsCount === 0
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                            : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        محدد {selectedRootSubsCount} من {allRootSubs.length} فرع
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleAllSubsForRoot(root, subs)}
                        className="px-2 py-0.5 rounded-md border border-[var(--border-color)] hover:bg-[var(--surface)] text-[10px] font-bold text-[#1668B2] cursor-pointer transition"
                      >
                        {allVisibleSubsSelected ? 'إلغاء الفروع' : 'تحديد الفروع'}
                      </button>
                    </div>
                  )}
                </div>

                {subs.length > 0 && (
                  <div className="pr-6 space-y-0.5">
                    {subs.map((sub) => {
                      const isSubSelected = selectedSet.has(sub.id);
                      return (
                        <label
                          key={sub.id}
                          className="flex items-center justify-between gap-2 px-1.5 py-1 rounded-lg hover:bg-[var(--surface-subtle)] cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={isSubSelected}
                              onChange={() => handleToggleSubCategory(sub)}
                              className="w-3.5 h-3.5 accent-[#1668B2] cursor-pointer shrink-0"
                            />
                            <FolderTree className="w-3 h-3 text-[var(--text-secondary)] shrink-0" />
                            <span className="text-xs text-[var(--text-primary)] truncate">
                              {sub.name}
                            </span>
                          </div>
                          {isSubSelected && (
                            <span className="text-[10px] font-bold text-[#1668B2] shrink-0">
                              محدد للعرض
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

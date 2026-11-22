import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import { UserAccount, Warehouse } from '../types';

const CACHE_PREFIX = 'mudaqqeq_user_warehouses_v1_';

function isWarehouseActive(w: Warehouse): boolean {
  const st = String(w.status || '').trim();
  return st !== 'inactive' && st !== 'موقوف';
}

function readCachedUserWarehouses(userId: string): {
  warehouses: Warehouse[];
  defaultWarehouseId?: string;
  seesAllWarehouses: boolean;
} | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.warehouses)) {
      return {
        warehouses: parsed.warehouses,
        defaultWarehouseId: parsed.defaultWarehouseId,
        seesAllWarehouses: Boolean(parsed.seesAllWarehouses)
      };
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function writeCachedUserWarehouses(
  userId: string,
  payload: {
    warehouses: Warehouse[];
    defaultWarehouseId?: string;
    seesAllWarehouses: boolean;
  }
): void {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${userId}`, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

export interface UseUserWarehousesResult {
  warehouses: Warehouse[];
  activeAllowedWarehouses: Warehouse[];
  defaultWarehouseId: string;
  canChooseWarehouse: boolean;
  seesAllWarehouses: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

/**
 * هوك مشترك لجلب المخازن المسموحة والمخزن الافتراضي للمستخدم الحالي.
 * يعمل للمدير والمصمم والموظف عبر `/api/users/:id/warehouses` مع تخزين محلي للعمل كاحتياط.
 */
export function useUserWarehouses(user?: UserAccount | null): UseUserWarehousesResult {
  const isPrivilegedAll =
    user?.role === 'designer' || user?.role === 'manager' || Boolean(user?.isOwner);

  const [warehouses, setWarehouses] = useState<Warehouse[]>(() => {
    if (!user?.id) return [];
    return readCachedUserWarehouses(user.id)?.warehouses || [];
  });
  const [explicitDefaultId, setExplicitDefaultId] = useState<string | undefined>(() => {
    if (!user?.id) return user?.warehouseConfig?.defaultWarehouseId;
    return (
      readCachedUserWarehouses(user.id)?.defaultWarehouseId ||
      user?.warehouseConfig?.defaultWarehouseId
    );
  });
  const [seesAllWarehouses, setSeesAllWarehouses] = useState<boolean>(() => {
    if (!user?.id) return isPrivilegedAll;
    const cached = readCachedUserWarehouses(user.id);
    return cached ? cached.seesAllWarehouses : isPrivilegedAll;
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setWarehouses([]);
      setExplicitDefaultId(undefined);
      setSeesAllWarehouses(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.getUserWarehouses(user.id);
      if (res.success && Array.isArray(res.warehouses)) {
        const nextSeesAll = Boolean(res.seesAllWarehouses) || isPrivilegedAll;
        const nextDefault =
          res.warehouseConfig?.defaultWarehouseId ||
          user.warehouseConfig?.defaultWarehouseId;
        setWarehouses(res.warehouses);
        setExplicitDefaultId(nextDefault);
        setSeesAllWarehouses(nextSeesAll);
        writeCachedUserWarehouses(user.id, {
          warehouses: res.warehouses,
          defaultWarehouseId: nextDefault,
          seesAllWarehouses: nextSeesAll
        });
        return;
      }
    } catch {
      // fallback below if user has warehouses.view
    } finally {
      setIsLoading(false);
    }

    try {
      const whRes = await api.getWarehouses();
      if (whRes.success && Array.isArray(whRes.warehouses)) {
        const allowedIds = user.warehouseConfig?.allowedWarehouseIds;
        const filtered = isPrivilegedAll
          ? whRes.warehouses
          : allowedIds && allowedIds.length > 0
          ? whRes.warehouses.filter(w => allowedIds.includes(w.id))
          : whRes.warehouses;
        const nextDefault = user.warehouseConfig?.defaultWarehouseId;
        setWarehouses(filtered);
        setExplicitDefaultId(nextDefault);
        setSeesAllWarehouses(isPrivilegedAll);
        writeCachedUserWarehouses(user.id, {
          warehouses: filtered,
          defaultWarehouseId: nextDefault,
          seesAllWarehouses: isPrivilegedAll
        });
      }
    } catch {
      // retain cached fallback if offline
    }
  }, [user?.id, user?.role, user?.isOwner, user?.warehouseConfig?.defaultWarehouseId, isPrivilegedAll]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeAllowedWarehouses = useMemo(() => {
    return warehouses.filter(isWarehouseActive);
  }, [warehouses]);

  const defaultWarehouseId = useMemo(() => {
    const pool = activeAllowedWarehouses.length > 0 ? activeAllowedWarehouses : warehouses;
    if (explicitDefaultId && pool.some(w => w.id === explicitDefaultId)) {
      return explicitDefaultId;
    }
    const systemDefault = pool.find(w => w.isDefault);
    if (systemDefault) return systemDefault.id;
    return pool[0]?.id || '';
  }, [activeAllowedWarehouses, warehouses, explicitDefaultId]);

  const canChooseWarehouse = activeAllowedWarehouses.length > 1;

  return {
    warehouses,
    activeAllowedWarehouses,
    defaultWarehouseId,
    canChooseWarehouse,
    seesAllWarehouses,
    isLoading,
    refresh
  };
}

/**
 * يجلب خريطة أرصدة كل الأصناف داخل مخزن محدد عبر نقطة `/api/items/paginated?warehouseId=...`
 * لاستخدامها في عرض الأرصدة الفورية على كروت الأصناف والتحقق قبل الحفظ بدون تعديل الخادم.
 */
export async function fetchAllWarehouseStockMap(
  warehouseId: string
): Promise<Record<string, number>> {
  if (!warehouseId || warehouseId === 'ALL') return {};
  const stockMap: Record<string, number> = {};

  const firstPage = await api.getItemsPaginated({ warehouseId, page: 1 });
  if (!firstPage?.success) {
    throw new Error(firstPage?.error || 'تعذر جلب أرصدة المخزن');
  }
  for (const it of firstPage.items || []) {
    stockMap[it.id] = Number(it.stockQuantity || 0);
  }

  const totalPages = Number(firstPage.totalPages || 1);
  if (totalPages > 1) {
    const remainingPages: number[] = [];
    for (let p = 2; p <= totalPages; p++) {
      remainingPages.push(p);
    }
    const BATCH_SIZE = 5;
    for (let i = 0; i < remainingPages.length; i += BATCH_SIZE) {
      const batch = remainingPages.slice(i, i + BATCH_SIZE);
      const responses = await Promise.all(
        batch.map(p => api.getItemsPaginated({ warehouseId, page: p }))
      );
      for (const res of responses) {
        if (res?.success && Array.isArray(res.items)) {
          for (const it of res.items) {
            stockMap[it.id] = Number(it.stockQuantity || 0);
          }
        }
      }
    }
  }

  return stockMap;
}

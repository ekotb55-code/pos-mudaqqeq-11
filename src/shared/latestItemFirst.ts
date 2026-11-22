import type { LatestItemFirstScreenKey, LatestItemFirstSettings } from '../types';

export const DEFAULT_LATEST_ITEM_FIRST: LatestItemFirstSettings = {
  pos: true,
  purchases: false,
  salesReturn: false,
  purchaseReturn: false,
  warehouseTransfer: false,
  editInvoice: false
};

export interface LatestItemFirstScreenMeta {
  key: LatestItemFirstScreenKey;
  label: string;
  description: string;
}

export const LATEST_ITEM_FIRST_SCREENS: LatestItemFirstScreenMeta[] = [
  {
    key: 'pos',
    label: 'نقطة البيع',
    description: 'عند التفعيل يظهر آخر صنف مُضاف أو ممسوح بالباركود أو الكاميرا في أول جدول السلة.'
  },
  {
    key: 'purchases',
    label: 'فاتورة المشتريات',
    description: 'عند التفعيل يظهر آخر صنف مُضاف أو ممسوح في أول جدول بنود فاتورة المشتريات.'
  },
  {
    key: 'salesReturn',
    label: 'مرتجع المبيعات',
    description: 'عند التفعيل يتحرك السطر الممسوح في مرتجع المبيعات إلى أول الجدول.'
  },
  {
    key: 'purchaseReturn',
    label: 'مرتجع المشتريات',
    description: 'عند التفعيل يظهر آخر صنف مُضاف أو ممسوح في أول جدول بنود مرتجع المشتريات.'
  },
  {
    key: 'warehouseTransfer',
    label: 'التحويل بين المخازن',
    description: 'عند التفعيل يظهر آخر صنف مُضاف أو ممسوح في أول جدول بنود التحويل بين المخازن.'
  },
  {
    key: 'editInvoice',
    label: 'تعديل الفاتورة المحفوظة',
    description: 'عند التفعيل يظهر الصنف المضاف حديثًا أو المحدّث عبر الإضافة في أول جدول بنود الفاتورة قيد التعديل.'
  }
];

export function normalizeLatestItemFirst(
  raw: unknown,
  fallback: Partial<LatestItemFirstSettings> = DEFAULT_LATEST_ITEM_FIRST
): LatestItemFirstSettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const resolveFlag = (key: LatestItemFirstScreenKey): boolean => {
    if (typeof src[key] === 'boolean') return src[key] as boolean;
    if (typeof fallback[key] === 'boolean') return fallback[key] as boolean;
    return DEFAULT_LATEST_ITEM_FIRST[key];
  };

  return {
    pos: resolveFlag('pos'),
    purchases: resolveFlag('purchases'),
    salesReturn: resolveFlag('salesReturn'),
    purchaseReturn: resolveFlag('purchaseReturn'),
    warehouseTransfer: resolveFlag('warehouseTransfer'),
    editInvoice: resolveFlag('editInvoice')
  };
}

export function areLatestItemFirstEqual(
  a?: Partial<LatestItemFirstSettings> | null,
  b?: Partial<LatestItemFirstSettings> | null
): boolean {
  const normA = normalizeLatestItemFirst(a);
  const normB = normalizeLatestItemFirst(b);
  return (
    normA.pos === normB.pos &&
    normA.purchases === normB.purchases &&
    normA.salesReturn === normB.salesReturn &&
    normA.purchaseReturn === normB.purchaseReturn &&
    normA.warehouseTransfer === normB.warehouseTransfer &&
    normA.editInvoice === normB.editInvoice
  );
}

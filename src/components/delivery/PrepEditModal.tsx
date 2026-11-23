import React, { useState } from 'react';
import { AlertTriangle, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import {
  DeliveryConfigResponse,
  DeliveryPaymentMode,
  DeliveryPreparationOrder,
  Item
} from '../../types';
import {
  ModalShell,
  CompactTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS
} from '../ui';
import { formatPrepMoney, prepErrorText } from '../../utils/deliveryPrep';

export interface PrepEditModalProps {
  order: DeliveryPreparationOrder;
  config: DeliveryConfigResponse | null;
  onClose: () => void;
  onSaved: (order: DeliveryPreparationOrder) => void;
}

interface EditLine {
  itemId: string;
  itemName: string;
  unit: string;
  unitPrice: number;
  quantity: string;
}

/**
 * نافذة «تعديل أمر التجهيز»: بيانات التوصيل والأصناف والكميات.
 * الأسعار بييجي بيها السيرفر من كارت الصنف، والشاشة بتبعت الصنف والكمية بس.
 */
export const PrepEditModal: React.FC<PrepEditModalProps> = ({ order, config, onClose, onSaved }) => {
  const zonePricing = Boolean(config?.settings?.zonePricing);
  const zones = config?.zones || [];

  const [customerName, setCustomerName] = useState<string>(order.customerName || '');
  const [phone, setPhone] = useState<string>(order.phone || '');
  const [address, setAddress] = useState<string>(order.address || '');
  const [zoneId, setZoneId] = useState<string>(order.zoneId || '');
  const [paymentMode, setPaymentMode] = useState<DeliveryPaymentMode>(order.paymentMode);
  const [notes, setNotes] = useState<string>(order.notes || '');
  const [lines, setLines] = useState<EditLine[]>(() =>
    (order.lines || []).map((l) => ({
      itemId: l.itemId,
      itemName: l.itemName,
      unit: l.unit,
      unitPrice: l.unitPrice,
      quantity: String(l.quantity)
    }))
  );

  const [search, setSearch] = useState<string>('');
  const [results, setResults] = useState<Item[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const itemsTotal = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * l.unitPrice, 0);

  const handleSearch = async () => {
    const term = search.trim();
    if (!term || isSearching) return;
    setIsSearching(true);
    setSearchNote(null);
    try {
      const res = await api.getItemsPaginated({ search: term, page: 1 });
      const found = (res.items || []).filter((it) => it.status !== 'موقوف').slice(0, 8);
      setResults(found);
      if (found.length === 0) setSearchNote('مفيش صنف بالاسم أو الباركود ده');
    } catch (err) {
      setResults([]);
      setSearchNote(prepErrorText(err, 'تعذر البحث عن الأصناف'));
    } finally {
      setIsSearching(false);
    }
  };

  const addItem = (item: Item) => {
    setError(null);
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.itemId === item.id);
      if (idx >= 0) {
        return prev.map((l, i) =>
          i === idx ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l
        );
      }
      return [
        ...prev,
        {
          itemId: item.id,
          itemName: item.name,
          unit: item.unit || 'قطعة',
          unitPrice: Number(item.salePrice) || 0,
          quantity: '1'
        }
      ];
    });
    setResults([]);
    setSearch('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!customerName.trim()) {
      setError('اكتب اسم العميل');
      return;
    }
    if (!address.trim()) {
      setError('اكتب عنوان التوصيل');
      return;
    }
    if (zonePricing && !zoneId) {
      setError('اختار منطقة التوصيل');
      return;
    }
    if (lines.length === 0) {
      setError('أمر التجهيز لازم يكون فيه صنف واحد على الأقل');
      return;
    }
    for (const l of lines) {
      const q = Number(l.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        setError(`اكتب كمية أكبر من صفر للصنف «${l.itemName}»`);
        return;
      }
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await api.updateDeliveryPreparationOrder(order.id, {
        revision: order.revision,
        ...(order.customerId ? {} : { customerName: customerName.trim() }),
        phone: phone.trim(),
        address: address.trim(),
        ...(zonePricing ? { zoneId } : {}),
        paymentMode,
        notes: notes.trim(),
        lines: lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) }))
      });
      onSaved(res.order);
    } catch (err) {
      setError(prepErrorText(err, 'تعذر حفظ تعديل أمر التجهيز'));
      setIsSaving(false);
    }
  };

  return (
    <ModalShell
      onClose={() => {
        if (!isSaving) onClose();
      }}
      closeDisabled={isSaving}
      title={`تعديل أمر التجهيز ${order.number}`}
      subtitle="التعديل متاح قبل الشحن بس"
      className="w-full max-w-3xl"
      footer={
        <>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
          >
            رجوع
          </button>
          <button
            type="submit"
            form="prep-edit-form"
            disabled={isSaving}
            data-testid="prep-edit-submit"
            className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>حفظ التعديل</span>
          </button>
        </>
      }
    >
      <form id="prep-edit-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="space-y-1.5">
            <label htmlFor="prep-edit-customer" className="block text-sm font-semibold text-[var(--text-primary)]">
              اسم العميل
            </label>
            <input
              id="prep-edit-customer"
              type="text"
              maxLength={120}
              value={customerName}
              disabled={isSaving || Boolean(order.customerId)}
              onChange={(e) => setCustomerName(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} min-h-[44px]`}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="prep-edit-phone" className="block text-sm font-semibold text-[var(--text-primary)]">
              رقم التليفون
            </label>
            <input
              id="prep-edit-phone"
              type="tel"
              dir="ltr"
              maxLength={30}
              value={phone}
              disabled={isSaving}
              onChange={(e) => setPhone(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px]`}
            />
          </div>
          {zonePricing && (
            <div className="space-y-1.5">
              <label htmlFor="prep-edit-zone" className="block text-sm font-semibold text-[var(--text-primary)]">
                منطقة التوصيل
              </label>
              <select
                id="prep-edit-zone"
                value={zoneId}
                disabled={isSaving}
                onChange={(e) => setZoneId(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px]`}
              >
                <option value="">اختار المنطقة</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="prep-edit-payment" className="block text-sm font-semibold text-[var(--text-primary)]">
              طريقة الدفع
            </label>
            <select
              id="prep-edit-payment"
              value={paymentMode}
              disabled={isSaving}
              onChange={(e) => setPaymentMode(e.target.value as DeliveryPaymentMode)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px]`}
            >
              <option value="prepaid">مدفوع مقدمًا</option>
              <option value="cod">الدفع عند الاستلام</option>
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="prep-edit-address" className="block text-sm font-semibold text-[var(--text-primary)]">
            عنوان التوصيل
          </label>
          <input
            id="prep-edit-address"
            type="text"
            maxLength={250}
            value={address}
            disabled={isSaving}
            onChange={(e) => setAddress(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} min-h-[44px]`}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="prep-edit-notes" className="block text-sm font-semibold text-[var(--text-primary)]">
            ملاحظات (اختياري)
          </label>
          <input
            id="prep-edit-notes"
            type="text"
            maxLength={250}
            value={notes}
            disabled={isSaving}
            onChange={(e) => setNotes(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} min-h-[44px]`}
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold text-[var(--text-primary)]">الأصناف</div>
          <CompactTable>
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th>الإجمالي</th>
                <th>حذف</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.itemId}>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>{line.itemName}</td>
                  <td>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      aria-label={`كمية ${line.itemName}`}
                      value={line.quantity}
                      disabled={isSaving}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l) => (l.itemId === line.itemId ? { ...l, quantity: e.target.value } : l))
                        )
                      }
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} min-h-[44px]`}
                    />
                  </td>
                  <td className={COMPACT_TABLE_NUM_CLASS}>{formatPrepMoney(line.unitPrice)}</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-semibold`}>
                    {formatPrepMoney((Number(line.quantity) || 0) * line.unitPrice)}
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={isSaving}
                      aria-label={`حذف ${line.itemName}`}
                      onClick={() => setLines((prev) => prev.filter((l) => l.itemId !== line.itemId))}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-rose-700 dark:text-rose-300 hover:bg-[var(--surface-hover)] disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </CompactTable>
          <div className="text-sm text-[var(--text-secondary)]">
            إجمالي الأصناف:{' '}
            <span className="font-bold text-[var(--text-primary)] tabular-nums">{formatPrepMoney(itemsTotal)}</span>
            {' '}(رسوم التوصيل والسعر النهائي بيحسبهم السيرفر عند الحفظ)
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="prep-edit-search" className="block text-sm font-semibold text-[var(--text-primary)]">
            إضافة صنف
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="prep-edit-search"
              type="text"
              value={search}
              disabled={isSaving}
              placeholder="اسم الصنف أو الباركود"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSearch();
                }
              }}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} min-h-[44px]`}
            />
            <button
              type="button"
              disabled={isSaving || isSearching || !search.trim()}
              onClick={() => void handleSearch()}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span>بحث</span>
            </button>
          </div>
          {searchNote && <p className="text-sm text-[var(--text-secondary)]">{searchNote}</p>}
          {results.length > 0 && (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {results.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                  <span className="text-sm text-[var(--text-primary)]">
                    {item.name}{' '}
                    <span className="text-[var(--text-muted)] tabular-nums">
                      — {formatPrepMoney(Number(item.salePrice) || 0)}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => addItem(item)}
                    className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                    <span>إضافة</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
    </ModalShell>
  );
};

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Warehouse as WarehouseIcon,
  Plus,
  Edit3,
  Trash2,
  Power,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  X,
  Star,
  Loader2,
} from 'lucide-react';
import { api } from '../api/client';
import { UserAccount, Warehouse } from '../types';
import { hasPermission } from '../utils/permissions';
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
import { ShortcutBadge } from '../context/KeyboardShortcutsContext';

interface WarehousesPageProps {
  user: UserAccount;
  onRefreshData?: () => void | Promise<void>;
}

interface WarehouseStats {
  itemsCount: number;
  totalQuantity: number;
}

function isWhInactive(w: Warehouse): boolean {
  const st = String(w.status || '').trim();
  return st === 'inactive' || st === 'موقوف';
}

export const WarehousesPage: React.FC<WarehousesPageProps> = ({ user, onRefreshData }) => {
  const isPrivileged = user.role === 'designer' || user.role === 'manager' || Boolean(user.isOwner);
  const canManage = isPrivileged || hasPermission(user, 'warehouses.manage');

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [statsByWarehouse, setStatsByWarehouse] = useState<Record<string, WarehouseStats>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshingStats, setIsRefreshingStats] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Add / Edit modal state
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [formStatus, setFormStatus] = useState<'نشط' | 'موقوف'>('نشط');
  const [formNotes, setFormNotes] = useState<string>('');
  const [formIsDefault, setFormIsDefault] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<Warehouse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Status toggle loading id
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadWarehouseStats = useCallback(async (list: Warehouse[]) => {
    if (list.length === 0) {
      setStatsByWarehouse({});
      return;
    }
    setIsRefreshingStats(true);
    try {
      const entries = await Promise.all(
        list.map(async (wh) => {
          try {
            const [allRes, outRes] = await Promise.all([
              api.getItemsPaginated({ warehouseId: wh.id, page: 1 }),
              api.getItemsPaginated({ warehouseId: wh.id, stockStatus: 'OUT', page: 1 })
            ]);
            const totalCatalog = Number(allRes?.total || 0);
            const outCount = Number(outRes?.total || 0);
            const itemsCount = Math.max(0, totalCatalog - outCount);
            const totalQuantity = Number(allRes?.totals?.totalPieces || 0);
            return [wh.id, { itemsCount, totalQuantity }] as const;
          } catch {
            return [wh.id, { itemsCount: 0, totalQuantity: 0 }] as const;
          }
        })
      );
      const nextMap: Record<string, WarehouseStats> = {};
      for (const [id, st] of entries) {
        nextMap[id] = st;
      }
      setStatsByWarehouse(nextMap);
    } finally {
      setIsRefreshingStats(false);
    }
  }, []);

  const fetchWarehouses = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getWarehouses();
      if (res.success && Array.isArray(res.warehouses)) {
        setWarehouses(res.warehouses);
        await loadWarehouseStats(res.warehouses);
      } else {
        setErrorMsg(res.error || 'تعذر جلب قائمة المخازن');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'تعذر الاتصال بالخادم لجلب المخازن');
    } finally {
      setIsLoading(false);
    }
  }, [loadWarehouseStats]);

  useEffect(() => {
    void fetchWarehouses();
  }, [fetchWarehouses]);

  const summary = useMemo(() => {
    const totalCount = warehouses.length;
    const activeCount = warehouses.filter(w => !isWhInactive(w)).length;
    const totalPieces = Object.values(statsByWarehouse).reduce(
      (sum, st) => sum + Number(st.totalQuantity || 0),
      0
    );
    return { totalCount, activeCount, totalPieces };
  }, [warehouses, statsByWarehouse]);

  const openCreateModal = () => {
    setEditingWarehouse(null);
    setFormName('');
    setFormStatus('نشط');
    setFormNotes('');
    setFormIsDefault(false);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditModal = (wh: Warehouse) => {
    setEditingWarehouse(wh);
    setFormName(wh.name || '');
    setFormStatus(isWhInactive(wh) ? 'موقوف' : 'نشط');
    setFormNotes(wh.notes || '');
    setFormIsDefault(Boolean(wh.isDefault));
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = formName.trim();
    if (!trimmedName) {
      setFormError('يرجى إدخال اسم المخزن');
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      const res = await api.saveWarehouse({
        id: editingWarehouse?.id,
        name: trimmedName,
        status: formStatus,
        notes: formNotes.trim(),
        isDefault: formIsDefault
      });
      if (!res.success) {
        setFormError(res.error || 'تعذر حفظ بيانات المخزن');
        return;
      }
      setIsFormOpen(false);
      setFeedback({
        type: 'success',
        message: editingWarehouse
          ? `تم تحديث بيانات المخزن "${trimmedName}" بنجاح`
          : `تمت إضافة المخزن "${trimmedName}" بنجاح`
      });
      await fetchWarehouses();
      if (onRefreshData) await onRefreshData();
    } catch (err: any) {
      setFormError(err.message || 'تعذر حفظ بيانات المخزن');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (wh: Warehouse) => {
    if (!canManage || togglingId) return;
    const nextStatus: 'نشط' | 'موقوف' = isWhInactive(wh) ? 'نشط' : 'موقوف';
    setTogglingId(wh.id);
    setFeedback(null);
    try {
      const res = await api.saveWarehouse({
        id: wh.id,
        name: wh.name,
        status: nextStatus,
        notes: wh.notes,
        isDefault: wh.isDefault
      });
      if (!res.success) {
        setFeedback({ type: 'error', message: res.error || 'تعذر تغيير حالة المخزن' });
        return;
      }
      setFeedback({
        type: 'success',
        message:
          nextStatus === 'موقوف'
            ? `تم إيقاف المخزن "${wh.name}" بنجاح`
            : `تم تفعيل المخزن "${wh.name}" بنجاح`
      });
      await fetchWarehouses();
      if (onRefreshData) await onRefreshData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'تعذر تغيير حالة المخزن' });
    } finally {
      setTogglingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await api.deleteWarehouse(deleteTarget.id);
      if (!res.success) {
        setDeleteError(res.error || 'تعذر حذف المخزن');
        return;
      }
      const deletedName = deleteTarget.name;
      setDeleteTarget(null);
      setFeedback({ type: 'success', message: `تم حذف المخزن "${deletedName}" نهائياً` });
      await fetchWarehouses();
      if (onRefreshData) await onRefreshData();
    } catch (err: any) {
      setDeleteError(err.message || 'تعذر حذف المخزن');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeactivateFromDeleteModal = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await api.saveWarehouse({
        id: deleteTarget.id,
        name: deleteTarget.name,
        status: 'موقوف',
        notes: deleteTarget.notes,
        isDefault: deleteTarget.isDefault
      });
      if (!res.success) {
        setDeleteError(res.error || 'تعذر إيقاف المخزن');
        return;
      }
      const whName = deleteTarget.name;
      setDeleteTarget(null);
      setFeedback({
        type: 'success',
        message: `تم إيقاف المخزن "${whName}" بدلاً من الحذف للحفاظ على سجلاته وأرصدته`
      });
      await fetchWarehouses();
      if (onRefreshData) await onRefreshData();
    } catch (err: any) {
      setDeleteError(err.message || 'تعذر إيقاف المخزن');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <PageSurface
      dir="rtl"
      title="إدارة المخازن"
      subtitle="عرض أرصدة المخازن وإضافة أو تعديل أو إيقاف المخازن المرتبطة بالنظام"
      actions={
        <>
          <button
            type="button"
            onClick={() => void fetchWarehouses()}
            disabled={isLoading || isRefreshingStats}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading || isRefreshingStats ? 'animate-spin' : ''}`} />
            <span>تحديث الأرصدة</span>
          </button>

          {canManage && (
            <button
              type="button"
              data-shortcut-add="true"
              onClick={openCreateModal}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مخزن</span>
              <ShortcutBadge actionId="general.add_new" className="bg-white/20 text-white border-white/30" />
            </button>
          )}
        </>
      }
    >
      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`no-print px-4 py-2.5 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'border-[var(--stock-in-fg)] ui-stock-in'
              : 'border-[var(--stock-out-fg)] ui-stock-out'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="إغلاق التنبيه"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* سطر نصي واحد للإحصائيات (القاعدة 6) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]">
        <span>
          إجمالي المخازن:{' '}
          <strong className="font-mono tabular-nums text-[var(--text-primary)]">{summary.totalCount}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          المخازن النشطة:{' '}
          <strong className="font-mono tabular-nums ui-stock-in">{summary.activeCount}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          إجمالي الكميات بكل المخازن:{' '}
          <strong className="font-mono tabular-nums ui-money-sale">
            {summary.totalPieces.toLocaleString('en-US')}
          </strong>
        </span>
      </div>

      <SectionHeading title={`قائمة المخازن (${warehouses.length})`} />

      {isLoading ? (
        <div className="py-12 text-center text-[var(--text-secondary)] space-y-2">
          <Loader2 className="w-7 h-7 mx-auto animate-spin text-[var(--accent)]" />
          <p className="text-xs font-bold">جاري تحميل المخازن وأرصدتها...</p>
        </div>
      ) : errorMsg ? (
        <div className="no-print py-8 text-center space-y-3">
          <AlertTriangle className="w-7 h-7 ui-stock-out mx-auto" />
          <p className="text-xs font-bold ui-stock-out">{errorMsg}</p>
          <button
            type="button"
            onClick={() => void fetchWarehouses()}
            className="min-h-[44px] px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold cursor-pointer"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : warehouses.length === 0 ? (
        <div className="py-12 text-center space-y-3 text-[var(--text-secondary)]">
          <WarehouseIcon className="w-9 h-9 mx-auto opacity-50" />
          <p className="text-sm font-bold text-[var(--text-primary)]">لا توجد مخازن مسجلة حتى الآن</p>
          {canManage && (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مخزن</span>
            </button>
          )}
        </div>
      ) : (
        <CompactTable ariaLabel="جدول المخازن">
          <thead>
            <tr>
              <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>م</th>
              <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المخزن</th>
              <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الحالة</th>
              <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>عدد الأصناف</th>
              <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>إجمالي الكمية</th>
              <th className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {warehouses.map((wh, index) => {
              const inactive = isWhInactive(wh);
              const stats = statsByWarehouse[wh.id] || { itemsCount: 0, totalQuantity: 0 };
              return (
                <tr key={wh.id} className={inactive ? 'opacity-70' : ''}>
                  <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                    {index + 1}
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    <div className="font-bold text-[var(--text-primary)] flex flex-wrap items-center gap-1.5">
                      <span>{wh.name}</span>
                      {wh.isDefault && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold ui-stock-low">
                          <Star className="w-3.5 h-3.5 shrink-0" />
                          <span>افتراضي</span>
                        </span>
                      )}
                    </div>
                    {wh.notes && (
                      <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{wh.notes}</p>
                    )}
                  </td>
                  <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                    <span className={inactive ? 'ui-stock-out' : 'ui-stock-in'}>
                      {inactive ? 'موقوف' : 'نشط'}
                    </span>
                  </td>
                  <td className={`text-center font-mono font-bold text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                    {isRefreshingStats && !statsByWarehouse[wh.id] ? '...' : stats.itemsCount.toLocaleString('en-US')}
                  </td>
                  <td className={`text-center font-mono font-extrabold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                    {isRefreshingStats && !statsByWarehouse[wh.id] ? '...' : stats.totalQuantity.toLocaleString('en-US')}
                  </td>
                  <td className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => openEditModal(wh)}
                        className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>تعديل</span>
                      </button>

                      <button
                        type="button"
                        disabled={!canManage || wh.isDefault || togglingId === wh.id}
                        onClick={() => void handleToggleStatus(wh)}
                        title={
                          wh.isDefault
                            ? 'لا يمكن إيقاف المخزن الافتراضي الرئيسي'
                            : inactive
                            ? 'تفعيل المخزن'
                            : 'إيقاف المخزن'
                        }
                        className={`min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          inactive ? 'ui-stock-in' : 'ui-stock-low'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{inactive ? 'تفعيل' : 'إيقاف'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={!canManage || wh.isDefault}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(wh);
                        }}
                        title={wh.isDefault ? 'لا يمكن حذف المخزن الافتراضي الرئيسي' : 'حذف المخزن'}
                        className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-out text-xs font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>حذف</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </CompactTable>
      )}

      {/* Add / Edit Warehouse Modal */}
      {isFormOpen && (
        <ModalShell
          title={editingWarehouse ? 'تعديل بيانات المخزن' : 'إضافة مخزن جديد'}
          subtitle={
            editingWarehouse
              ? `تحديث إعدادات "${editingWarehouse.name}"`
              : 'إنشاء مخزن مستقل للأرصدة والحركات'
          }
          onClose={() => setIsFormOpen(false)}
          closeDisabled={isSaving}
        >
          <form onSubmit={handleSaveForm} className="space-y-4">
            {formError && (
              <div className="px-3 py-2 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                  اسم المخزن <span className="ui-stock-out">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="مثال: مخزن التجمع..."
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} font-bold`}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">الحالة</label>
                <select
                  value={formStatus}
                  onChange={e => setFormStatus(e.target.value as 'نشط' | 'موقوف')}
                  disabled={Boolean(editingWarehouse?.isDefault)}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} font-bold disabled:opacity-60`}
                >
                  <option value="نشط">نشط (متاح للبيع والتحويل والحركات)</option>
                  <option value="موقوف">موقوف (محجوب عن العمليات الجديدة)</option>
                </select>
              </div>
            </div>

            {editingWarehouse?.isDefault && (
              <p className="text-[11px] ui-stock-low font-bold">
                المخزن الافتراضي الرئيسي يظل نشطاً دائماً ما لم يتم تعيين مخزن افتراضي آخر.
              </p>
            )}

            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">ملاحظات (اختياري)</label>
              <textarea
                rows={2}
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                placeholder="العنوان، اسم المسؤول، أو ملاحظات التشغيل..."
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs resize-none`}
              />
            </div>

            <label className="min-h-[44px] flex items-center gap-2.5 pt-2 border-t border-[var(--border-subtle)] cursor-pointer">
              <input
                type="checkbox"
                checked={formIsDefault}
                disabled={Boolean(editingWarehouse?.isDefault)}
                onChange={e => setFormIsDefault(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-xs font-bold text-[var(--text-primary)]">
                تعيين كمخزن افتراضي للنظام (يُستخدم افتراضياً للمستخدمين الجدد)
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                disabled={isSaving}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{editingWarehouse ? 'حفظ التعديلات' : 'حفظ المخزن'}</span>
                {!isSaving && (
                  <ShortcutBadge actionId="general.save_form" className="bg-white/20 text-white border-white/30" />
                )}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <ModalShell
          title="تأكيد حذف المخزن"
          subtitle={deleteTarget.name}
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
          closeDisabled={isDeleting}
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition cursor-pointer"
              >
                إلغاء
              </button>

              {!deleteTarget.isDefault && !isWhInactive(deleteTarget) && (
                <button
                  type="button"
                  onClick={() => void handleDeactivateFromDeleteModal()}
                  disabled={isDeleting}
                  className="min-h-[44px] px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                >
                  إيقاف المخزن بدلاً من الحذف
                </button>
              )}

              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>تأكيد الحذف</span>
              </button>
            </>
          }
        >
          {(() => {
            const targetStats = statsByWarehouse[deleteTarget.id];
            const hasLocalStock =
              targetStats && (targetStats.itemsCount > 0 || Math.abs(targetStats.totalQuantity) > 0);
            return (
              <div className="space-y-3 max-w-md">
                <p className="text-xs font-bold text-[var(--text-primary)] leading-relaxed">
                  هل أنت متأكد من رغبتك في حذف المخزن &laquo;{deleteTarget.name}&raquo;؟ لا يمكن التراجع عن الحذف بعد تنفيذه.
                </p>

                {hasLocalStock && !deleteError && (
                  <div className="px-3 py-2.5 rounded-lg border border-[var(--stock-low-fg)] ui-stock-low text-xs font-bold leading-relaxed flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      تنبيه: هذا المخزن يحتوي حالياً على {targetStats.itemsCount} صنف بإجمالي كمية {targetStats.totalQuantity}. لن يسمح النظام بحذف مخزن به رصيد أو حركات مسجلة، ويمكنك إيقافه بدلاً من الحذف.
                    </span>
                  </div>
                )}

                {deleteError && (
                  <div className="px-3 py-2.5 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold leading-relaxed flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{deleteError}</span>
                  </div>
                )}
              </div>
            );
          })()}
        </ModalShell>
      )}
    </PageSurface>
  );
};

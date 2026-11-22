import React, { useState, useEffect } from 'react';
import {
  UserAccount,
  UserRole,
  PermissionKey,
  Cashbox,
  UserCashboxConfig,
  Warehouse,
  UserWarehouseConfig,
} from '../types';
import { api } from '../api/client';
import { ALL_PERMISSIONS, ROLE_TEMPLATES } from '../utils/permissions';
import {
  CheckCircle2,
  AlertTriangle,
  X,
  Eye,
  EyeOff,
  ArrowRight,
} from 'lucide-react';
import {
  ModalShell,
  SectionHeading,
  CompactTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
} from './ui';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  userToEdit: UserAccount | null;
  currentUser: UserAccount;
  activeCashboxes: Cashbox[];
  onSave: (userData: any) => Promise<{ success: boolean; user?: UserAccount; error?: string }>;
}

export const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  userToEdit,
  currentUser,
  activeCashboxes,
  onSave,
}) => {
  const isDesigner = currentUser.role === 'designer';
  const canManageUserWarehouses =
    currentUser.role === 'designer' ||
    currentUser.role === 'manager' ||
    Boolean(currentUser.isOwner) ||
    (currentUser.permissions || []).includes('permissions.manage') ||
    (currentUser.permissions || []).includes('warehouses.manage');
  const isEditing = Boolean(userToEdit);

  const [activeTab, setActiveTab] = useState<'info' | 'cashboxes' | 'warehouses' | 'permissions'>('info');

  // Fields
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('employee');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Cashbox Configuration
  const [allowedSaleCashboxIds, setAllowedSaleCashboxIds] = useState<string[]>([]);
  const [defaultSaleCashboxId, setDefaultSaleCashboxId] = useState<string>('');
  const [allowedReturnCashboxIds, setAllowedReturnCashboxIds] = useState<string[]>([]);
  const [defaultReturnCashboxId, setDefaultReturnCashboxId] = useState<string>('');
  const [allowedReceiptCashboxIds, setAllowedReceiptCashboxIds] = useState<string[]>([]);
  const [allowedPaymentCashboxIds, setAllowedPaymentCashboxIds] = useState<string[]>([]);
  const [allowedTransferCashboxIds, setAllowedTransferCashboxIds] = useState<string[]>([]);

  // Warehouse Configuration
  const [allWarehouses, setAllWarehouses] = useState<Warehouse[]>([]);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false);
  const [allowedWarehouseIds, setAllowedWarehouseIds] = useState<string[]>([]);
  const [defaultWarehouseId, setDefaultWarehouseId] = useState<string>('');

  // Permissions
  const [permissions, setPermissions] = useState<PermissionKey[]>([]);

  // State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    setActiveTab('info');
    setPassword('');
    setShowPassword(false);

    if (userToEdit) {
      setName(userToEdit.name || '');
      setUsername(userToEdit.username || '');
      setPhone(userToEdit.phone || '');
      setRole(userToEdit.role || 'employee');
      setStatus(userToEdit.status === 'active' || userToEdit.status === 'نشط' ? 'active' : 'inactive');
      setPermissions(userToEdit.permissions || ROLE_TEMPLATES[userToEdit.role] || []);

      const cfg = userToEdit.cashboxConfig;
      if (cfg) {
        setAllowedSaleCashboxIds(cfg.allowedSaleCashboxIds || []);
        setDefaultSaleCashboxId(cfg.defaultSaleCashboxId || '');
        setAllowedReturnCashboxIds(cfg.allowedReturnCashboxIds || []);
        setDefaultReturnCashboxId(cfg.defaultReturnCashboxId || '');
        setAllowedReceiptCashboxIds(cfg.allowedReceiptCashboxIds || []);
        setAllowedPaymentCashboxIds(cfg.allowedPaymentCashboxIds || []);
        setAllowedTransferCashboxIds(cfg.allowedTransferCashboxIds || []);
      } else {
        if (userToEdit.role === 'designer') {
          const allIds = activeCashboxes.map((c) => c.id);
          setAllowedSaleCashboxIds(allIds);
          setDefaultSaleCashboxId(allIds[0] || '');
          setAllowedReturnCashboxIds(allIds);
          setDefaultReturnCashboxId(allIds[0] || '');
          setAllowedReceiptCashboxIds(allIds);
          setAllowedPaymentCashboxIds(allIds);
          setAllowedTransferCashboxIds(allIds);
        } else {
          const firstId = activeCashboxes[0]?.id || '';
          setAllowedSaleCashboxIds(firstId ? [firstId] : []);
          setDefaultSaleCashboxId(firstId);
          setAllowedReturnCashboxIds(firstId ? [firstId] : []);
          setDefaultReturnCashboxId(firstId);
          setAllowedReceiptCashboxIds(firstId ? [firstId] : []);
          setAllowedPaymentCashboxIds([]);
          setAllowedTransferCashboxIds([]);
        }
      }
    } else {
      setName('');
      setUsername('');
      setPhone('');
      setRole('employee');
      setStatus('active');
      setPermissions(ROLE_TEMPLATES.employee);

      const firstId = activeCashboxes[0]?.id || '';
      setAllowedSaleCashboxIds(firstId ? [firstId] : []);
      setDefaultSaleCashboxId(firstId);
      setAllowedReturnCashboxIds(firstId ? [firstId] : []);
      setDefaultReturnCashboxId(firstId);
      setAllowedReceiptCashboxIds(firstId ? [firstId] : []);
      setAllowedPaymentCashboxIds([]);
      setAllowedTransferCashboxIds([]);
    }

    let cancelled = false;
    setIsLoadingWarehouses(true);
    Promise.all([
      api.getWarehouses().catch(() => ({ success: false, warehouses: [] as Warehouse[] })),
      userToEdit ? api.getUserWarehouses(userToEdit.id).catch(() => null) : Promise.resolve(null),
    ])
      .then(([whRes, userWhRes]) => {
        if (cancelled) return;
        const list = whRes.success && Array.isArray(whRes.warehouses) ? whRes.warehouses : [];
        setAllWarehouses(list);
        const sysDefault = list.find((w) => w.isDefault) || list[0];

        if (userToEdit) {
          const cfg = userWhRes?.warehouseConfig || userToEdit.warehouseConfig;
          const allowed = Array.isArray(cfg?.allowedWarehouseIds) ? cfg!.allowedWarehouseIds : [];
          const defId = cfg?.defaultWarehouseId || allowed[0] || sysDefault?.id || '';
          setAllowedWarehouseIds(
            allowed.length > 0
              ? allowed
              : userToEdit.role === 'designer' || userToEdit.role === 'manager'
              ? list.map((w) => w.id)
              : sysDefault
              ? [sysDefault.id]
              : []
          );
          setDefaultWarehouseId(defId);
        } else {
          setAllowedWarehouseIds(sysDefault ? [sysDefault.id] : []);
          setDefaultWarehouseId(sysDefault?.id || '');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingWarehouses(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, userToEdit, activeCashboxes]);

  if (!isOpen) return null;

  const toggleId = (list: string[], id: string) => {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  };

  const handleSelectAllCashboxes = () => {
    const allIds = activeCashboxes.map((c) => c.id);
    setAllowedSaleCashboxIds(allIds);
    setAllowedReturnCashboxIds(allIds);
    setAllowedReceiptCashboxIds(allIds);
    setAllowedPaymentCashboxIds(allIds);
    setAllowedTransferCashboxIds(allIds);
    if (!defaultSaleCashboxId && allIds.length > 0) setDefaultSaleCashboxId(allIds[0]);
    if (!defaultReturnCashboxId && allIds.length > 0) setDefaultReturnCashboxId(allIds[0]);
  };

  const handleClearAllCashboxes = () => {
    setAllowedSaleCashboxIds([]);
    setDefaultSaleCashboxId('');
    setAllowedReturnCashboxIds([]);
    setDefaultReturnCashboxId('');
    setAllowedReceiptCashboxIds([]);
    setAllowedPaymentCashboxIds([]);
    setAllowedTransferCashboxIds([]);
  };

  const handleSetRolePreset = (r: UserRole) => {
    setRole(r);
    setPermissions(ROLE_TEMPLATES[r] || []);
    if (r === 'designer' || r === 'manager') {
      handleSelectAllCashboxes();
    }
  };

  const handleTogglePermission = (key: PermissionKey) => {
    if (role === 'designer') return;
    setPermissions((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanUsername = username.trim();
    const cleanName = name.trim();

    if (!cleanUsername) {
      setErrorMsg('اسم المستخدم مطلوب');
      setActiveTab('info');
      return;
    }

    if (!cleanName) {
      setErrorMsg('الاسم الكامل مطلوب');
      setActiveTab('info');
      return;
    }

    if (!isEditing && !password.trim()) {
      setErrorMsg('كلمة المرور مطلوبة لإنشاء مستخدم جديد');
      setActiveTab('info');
      return;
    }

    if (password.trim() && password.trim().length < 2) {
      setErrorMsg('كلمة السر يجب أن تتكون من حرفين أو رقمين على الأقل');
      setActiveTab('info');
      return;
    }

    const cashboxConfig: UserCashboxConfig = {
      allowedSaleCashboxIds,
      defaultSaleCashboxId: allowedSaleCashboxIds.includes(defaultSaleCashboxId)
        ? defaultSaleCashboxId
        : allowedSaleCashboxIds[0] || undefined,
      allowedReturnCashboxIds,
      defaultReturnCashboxId: allowedReturnCashboxIds.includes(defaultReturnCashboxId)
        ? defaultReturnCashboxId
        : allowedReturnCashboxIds[0] || undefined,
      allowedReceiptCashboxIds,
      allowedPaymentCashboxIds,
      allowedTransferCashboxIds,
    };

    const isTargetAllWarehouses = role === 'designer' || role === 'manager';
    const effectiveAllowedWhIds = isTargetAllWarehouses
      ? allWarehouses.map((w) => w.id)
      : allowedWarehouseIds;
    const effectiveDefaultWhId =
      defaultWarehouseId && (isTargetAllWarehouses || effectiveAllowedWhIds.includes(defaultWarehouseId))
        ? defaultWarehouseId
        : effectiveAllowedWhIds[0] || undefined;

    const warehouseConfig: UserWarehouseConfig = {
      allowedWarehouseIds: effectiveAllowedWhIds,
      ...(effectiveDefaultWhId ? { defaultWarehouseId: effectiveDefaultWhId } : {}),
    };

    const payload: any = {
      id: userToEdit?.id,
      username: cleanUsername,
      name: cleanName,
      phone: phone.trim() || undefined,
      role,
      status: status === 'active' ? 'نشط' : 'موقوف',
      permissions: role === 'designer' ? ALL_PERMISSIONS.map((p) => p.key) : permissions,
      ...(isDesigner ? { cashboxConfig } : {}),
      ...(canManageUserWarehouses && allWarehouses.length > 0 ? { warehouseConfig } : {}),
    };

    if (password.trim()) {
      payload.password = password.trim();
    }

    setIsSubmitting(true);
    try {
      const res = await onSave(payload);
      if (res && res.success) {
        const savedUserId = res.user?.id || userToEdit?.id;
        if (savedUserId && canManageUserWarehouses && allWarehouses.length > 0) {
          await api.saveUserWarehouses(savedUserId, warehouseConfig).catch(() => {});
        }
        setSuccessMsg(
          isEditing
            ? `تم تحديث بيانات المستخدم (${cleanUsername}) وتعيينات الخزائن والمخازن بنجاح`
            : `تم إنشاء حساب المستخدم (${cleanUsername}) وتعيين خزائنه ومخازنه بنجاح`
        );
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setErrorMsg(res?.error || 'فشل حفظ المستخدم، يرجى التحقق من السيرفر أو قاعدة البيانات');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ غير متوقع أثناء الحفظ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalAssignedCashboxes =
    allowedSaleCashboxIds.length +
    allowedReturnCashboxIds.length +
    allowedReceiptCashboxIds.length +
    allowedPaymentCashboxIds.length;

  return (
    <ModalShell
      dir="rtl"
      title={isEditing ? `تعديل المستخدم: ${userToEdit?.name || ''}` : 'إنشاء مستخدم جديد وتعيين الخزائن'}
      subtitle={
        isEditing
          ? 'تعديل البيانات، تغيير الحالة، إعادة تعيين كلمة المرور وتعيين الخزائن والمخازن'
          : 'تعيين الصلاحيات والخزائن والمخازن المسموحة قبل الحفظ'
      }
      onClose={onClose}
      closeDisabled={isSubmitting}
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            إلغاء
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'info' && (
              <button
                type="button"
                onClick={() => setActiveTab('cashboxes')}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
              >
                <span>التالي: تعيين الخزائن</span>
                <ArrowRight className="w-3.5 h-3.5 rotate-180" />
              </button>
            )}

            <button
              type="submit"
              form="user-modal-form"
              disabled={isSubmitting}
              className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-[#168A4A] hover:bg-[#12703C] text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isEditing ? 'حفظ التعديلات وتعيين الخزائن' : 'حفظ وإنشاء المستخدم'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      {/* Feedback Banners */}
      {errorMsg && (
        <div role="alert" className="flex items-center justify-between gap-2 py-2 border-b border-[var(--border-subtle)] text-xs font-bold ui-stock-out">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            aria-label="إغلاق"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {successMsg && (
        <div role="status" className="flex items-center gap-2 py-2 border-b border-[var(--border-subtle)] text-xs font-bold ui-money-purchase">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Tabs Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('info')}
          className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === 'info'
              ? 'bg-[#1668B2] text-white'
              : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
          }`}
        >
          بيانات الحساب
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('cashboxes')}
          className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === 'cashboxes'
              ? 'bg-[#1668B2] text-white'
              : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
          }`}
        >
          تعيين الخزائن ({totalAssignedCashboxes})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('warehouses')}
          className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === 'warehouses'
              ? 'bg-[#1668B2] text-white'
              : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
          }`}
        >
          المخازن ({role === 'designer' || role === 'manager' ? 'الكل' : allowedWarehouseIds.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('permissions')}
          className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === 'permissions'
              ? 'bg-[#1668B2] text-white'
              : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
          }`}
        >
          الصلاحيات ({role === 'designer' ? 'الكل' : permissions.length})
        </button>
      </div>

      <form id="user-modal-form" onSubmit={handleSubmit} className="space-y-5">
        {/* TAB 1: General Info */}
        {activeTab === 'info' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                  الاسم الكامل الظاهر *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: أحمد محمد (كاشير الفرع)"
                  required
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                  اسم المستخدم (لتسجيل الدخول) *
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="مثال: ahmed_pos"
                  required
                  dir="ltr"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono text-left`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                  رقم الهاتف للتواصل (اختياري)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01012345678"
                  dir="ltr"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono text-left`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                  الدور الوظيفي *
                </label>
                <select
                  value={role}
                  onChange={(e) => handleSetRolePreset(e.target.value as UserRole)}
                  disabled={!isDesigner && userToEdit?.role === 'designer'}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-bold cursor-pointer`}
                >
                  <option value="employee">موظف / كاشير (صلاحيات مبيعات محددة وخزائن مخصصة)</option>
                  <option value="manager">مدير فرع / محاسب (إشراف وتقارير وقيود)</option>
                  {isDesigner && <option value="designer">مصمم ومالك النظام (تحكم شامل غير مقيد)</option>}
                </select>
              </div>
            </div>

            <SectionHeading title="حالة الحساب" withTopDivider />
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-xs">
                <span className={`font-bold ${status === 'active' ? 'ui-money-purchase' : 'ui-stock-out'}`}>
                  {status === 'active' ? 'نشط ويعمل' : 'موقوف عن العمل'}
                </span>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  {status === 'active'
                    ? 'المستخدم يمكنه تسجيل الدخول وتنفيذ العمليات المصرح بها وفق خزائنه.'
                    : 'إيقاف الحساب يمنع تسجيل الدخول ويلغي أي جلسات نشطة فورًا.'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStatus('active')}
                  className={`min-h-[44px] px-4 rounded-lg text-xs font-bold transition cursor-pointer ${
                    status === 'active'
                      ? 'bg-[#168A4A] text-white'
                      : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  تنشيط
                </button>
                <button
                  type="button"
                  onClick={() => setStatus('inactive')}
                  className={`min-h-[44px] px-4 rounded-lg text-xs font-bold transition cursor-pointer ${
                    status === 'inactive'
                      ? 'bg-[#D9524F] text-white'
                      : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  إيقاف الحساب
                </button>
              </div>
            </div>

            <SectionHeading
              title={isEditing ? 'إعادة تعيين كلمة المرور (اختياري)' : 'كلمة المرور المشفرة *'}
              withTopDivider
            />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isEditing ? 'أدخل كلمة سر جديدة لإعادة التعيين...' : 'حرفان أو رقمان على الأقل'}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                {isEditing
                  ? 'اترك الحقل فارغاً للإبقاء على كلمة المرور الحالية. عند إعادة التعيين سيُطلب من المستخدم تغييرها عند دخوله التالي.'
                  : 'حرفان أو رقمان على الأقل (تُقبل الأرقام فقط بدون تعقيد).'}
              </p>
            </div>
          </div>
        )}

        {/* TAB 2: Dynamic Cashboxes per Operation */}
        {activeTab === 'cashboxes' && (
          <div className="space-y-4">
            <SectionHeading
              title="تخصيص الخزائن بحسب نوع العملية المحاسبية"
              actions={
                isDesigner ? (
                  <>
                    <button
                      type="button"
                      onClick={handleSelectAllCashboxes}
                      className="min-h-[44px] px-3 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer"
                    >
                      تحديد الكل لكل العمليات
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAllCashboxes}
                      className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
                    >
                      إلغاء التحديد
                    </button>
                  </>
                ) : undefined
              }
            />
            <p className="text-xs text-[var(--text-secondary)]">
              يتحقق الخادم من صلاحية الخزينة لكل عملية بيع أو مرتجع أو سند. يُمنع تنفيذ أي معاملة على خزنة غير مصرح بها.
            </p>

            {activeCashboxes.length === 0 ? (
              <div className="py-6 text-xs text-[var(--text-secondary)]">
                لا توجد خزائن نشطة في النظام حاليًا. يرجى إضافة خزائن أولاً من صفحة الخزائن.
              </div>
            ) : (
              <CompactTable ariaLabel="جدول تعيين الخزائن المسموحة والافتراضية للمستخدم">
                <thead>
                  <tr>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الخزينة</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>البيع</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>افتراضية للبيع</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>المرتجع</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>افتراضية للمرتجع</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>سند قبض</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>سند صرف</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>تحويل</th>
                  </tr>
                </thead>
                <tbody>
                  {activeCashboxes.map((cb) => {
                    const saleAllowed = allowedSaleCashboxIds.includes(cb.id);
                    const saleDefault = defaultSaleCashboxId === cb.id;
                    const returnAllowed = allowedReturnCashboxIds.includes(cb.id);
                    const returnDefault = defaultReturnCashboxId === cb.id;
                    const receiptAllowed = allowedReceiptCashboxIds.includes(cb.id);
                    const paymentAllowed = allowedPaymentCashboxIds.includes(cb.id);
                    const transferAllowed = allowedTransferCashboxIds.includes(cb.id);

                    return (
                      <tr key={cb.id}>
                        <td className={`font-bold ${COMPACT_TABLE_TEXT_CLASS}`}>{cb.name}</td>

                        <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                          <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={saleAllowed}
                              onChange={() => {
                                const next = toggleId(allowedSaleCashboxIds, cb.id);
                                setAllowedSaleCashboxIds(next);
                                if (!next.includes(defaultSaleCashboxId)) {
                                  setDefaultSaleCashboxId(next[0] || '');
                                }
                              }}
                              aria-label={`السماح بالبيع في ${cb.name}`}
                              className="w-4 h-4 accent-[#168A4A] cursor-pointer"
                            />
                          </label>
                        </td>

                        <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                          {saleAllowed ? (
                            <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer">
                              <input
                                type="radio"
                                name="defaultSaleCashbox"
                                checked={saleDefault}
                                onChange={() => setDefaultSaleCashboxId(cb.id)}
                                aria-label={`افتراضية للبيع ${cb.name}`}
                                className="w-4 h-4 accent-[#168A4A] cursor-pointer"
                              />
                            </label>
                          ) : (
                            <span className="text-[var(--text-secondary)]">—</span>
                          )}
                        </td>

                        <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                          <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={returnAllowed}
                              onChange={() => {
                                const next = toggleId(allowedReturnCashboxIds, cb.id);
                                setAllowedReturnCashboxIds(next);
                                if (!next.includes(defaultReturnCashboxId)) {
                                  setDefaultReturnCashboxId(next[0] || '');
                                }
                              }}
                              aria-label={`السماح بالمرتجع في ${cb.name}`}
                              className="w-4 h-4 accent-[#D97706] cursor-pointer"
                            />
                          </label>
                        </td>

                        <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                          {returnAllowed ? (
                            <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer">
                              <input
                                type="radio"
                                name="defaultReturnCashbox"
                                checked={returnDefault}
                                onChange={() => setDefaultReturnCashboxId(cb.id)}
                                aria-label={`افتراضية للمرتجع ${cb.name}`}
                                className="w-4 h-4 accent-[#D97706] cursor-pointer"
                              />
                            </label>
                          ) : (
                            <span className="text-[var(--text-secondary)]">—</span>
                          )}
                        </td>

                        <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                          <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={receiptAllowed}
                              onChange={() =>
                                setAllowedReceiptCashboxIds(toggleId(allowedReceiptCashboxIds, cb.id))
                              }
                              aria-label={`سند قبض ${cb.name}`}
                              className="w-4 h-4 accent-[#1668B2] cursor-pointer"
                            />
                          </label>
                        </td>

                        <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                          <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={paymentAllowed}
                              onChange={() =>
                                setAllowedPaymentCashboxIds(toggleId(allowedPaymentCashboxIds, cb.id))
                              }
                              aria-label={`سند صرف ${cb.name}`}
                              className="w-4 h-4 accent-[#1668B2] cursor-pointer"
                            />
                          </label>
                        </td>

                        <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                          <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={transferAllowed}
                              onChange={() =>
                                setAllowedTransferCashboxIds(toggleId(allowedTransferCashboxIds, cb.id))
                              }
                              aria-label={`تحويل ${cb.name}`}
                              className="w-4 h-4 accent-[#1668B2] cursor-pointer"
                            />
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </CompactTable>
            )}
          </div>
        )}

        {/* TAB 3: Allowed & Default Warehouses */}
        {activeTab === 'warehouses' && (
          <div className="space-y-4">
            <SectionHeading
              title="تعيين المخازن للمستخدم"
              actions={
                role === 'employee' && canManageUserWarehouses && allWarehouses.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const allIds = allWarehouses.map((w) => w.id);
                        setAllowedWarehouseIds(allIds);
                        if (!defaultWarehouseId && allIds.length > 0) {
                          setDefaultWarehouseId(allIds[0]);
                        }
                      }}
                      className="min-h-[44px] px-3 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold cursor-pointer"
                    >
                      تحديد الكل
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAllowedWarehouseIds([]);
                        setDefaultWarehouseId('');
                      }}
                      className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer"
                    >
                      إلغاء الكل
                    </button>
                  </>
                ) : undefined
              }
            />
            <p className="text-xs text-[var(--text-secondary)]">
              {role === 'designer' || role === 'manager'
                ? 'المدير ومالك النظام لهما صلاحية تلقائية على جميع المخازن، ويمكنك هنا تحديد المخزن الافتراضي لكل منهما.'
                : `حدد المخازن المسموح للموظف العمل عليها (${allowedWarehouseIds.length} مخزن محدد حالياً)، ثم اختر المخزن الافتراضي.`}
            </p>

            {isLoadingWarehouses ? (
              <div className="py-6 text-xs text-[var(--text-secondary)]">جاري تحميل قائمة المخازن...</div>
            ) : allWarehouses.length === 0 ? (
              <div className="py-6 text-xs text-[var(--text-secondary)]">
                لا توجد مخازن متاحة في النظام حالياً.
              </div>
            ) : (
              <>
                <CompactTable ariaLabel="جدول المخازن المسموحة للمستخدم">
                  <thead>
                    <tr>
                      <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المخزن</th>
                      <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الحالة</th>
                      <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>مسموح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allWarehouses.map((wh) => {
                      const isAllRole = role === 'designer' || role === 'manager';
                      const checked = isAllRole || allowedWarehouseIds.includes(wh.id);
                      const isInactive = wh.status === 'inactive' || wh.status === 'موقوف';

                      return (
                        <tr key={wh.id}>
                          <td className={COMPACT_TABLE_TEXT_CLASS}>
                            <span className="font-bold text-[var(--text-primary)]">{wh.name}</span>
                            {wh.isDefault && (
                              <span className="mr-1.5 text-[11px] font-bold ui-stock-low">
                                (المخزن الرئيسي)
                              </span>
                            )}
                          </td>
                          <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                            <span className={isInactive ? 'ui-stock-out' : 'ui-money-purchase'}>
                              {isInactive ? 'موقوف' : 'نشط'}
                            </span>
                          </td>
                          <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                            <label
                              className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center ${
                                isAllRole || !canManageUserWarehouses
                                  ? 'opacity-60 cursor-default'
                                  : 'cursor-pointer'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isAllRole || !canManageUserWarehouses}
                                onChange={() => {
                                  const next = toggleId(allowedWarehouseIds, wh.id);
                                  setAllowedWarehouseIds(next);
                                  if (!next.includes(defaultWarehouseId)) {
                                    setDefaultWarehouseId(next[0] || '');
                                  }
                                }}
                                aria-label={`السماح بمخزن ${wh.name}`}
                                className="w-4 h-4 accent-[#1668B2]"
                              />
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </CompactTable>

                <SectionHeading title="المخزن الافتراضي" withTopDivider />
                <div className="space-y-1.5">
                  <select
                    value={defaultWarehouseId}
                    disabled={!canManageUserWarehouses}
                    onChange={(e) => setDefaultWarehouseId(e.target.value)}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-bold`}
                  >
                    <option value="">-- بدون تحديد (يستخدم المخزن الرئيسي للنظام) --</option>
                    {(role === 'designer' || role === 'manager'
                      ? allWarehouses
                      : allWarehouses.filter((w) => allowedWarehouseIds.includes(w.id))
                    ).map((wh) => (
                      <option key={wh.id} value={wh.id}>
                        {wh.name} {wh.isDefault ? '(الرئيسي)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    سيتم اختيار هذا المخزن تلقائياً عند فتح نقطة البيع، جدول الأصناف، المشتريات، والمرتجعات.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 4: Permissions Customization */}
        {activeTab === 'permissions' && (
          <div className="space-y-4">
            <SectionHeading
              title="قوالب الصلاحيات وتخصيصها"
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => setPermissions(ROLE_TEMPLATES.employee)}
                    className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
                  >
                    قالب موظف ({ROLE_TEMPLATES.employee.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPermissions(ROLE_TEMPLATES.manager)}
                    className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
                  >
                    قالب مدير ({ROLE_TEMPLATES.manager.length})
                  </button>
                  {isDesigner && (
                    <button
                      type="button"
                      onClick={() => setPermissions(ALL_PERMISSIONS.map((p) => p.key))}
                      className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold ui-stock-low cursor-pointer"
                    >
                      كامل الصلاحيات ({ALL_PERMISSIONS.length})
                    </button>
                  )}
                </>
              }
            />

            {role === 'designer' ? (
              <div className="py-4 text-xs font-bold ui-stock-low">
                حساب مصمم ومالك النظام يمتلك كافة صلاحيات النظام بصورة كاملة ولا تخضع للتقييد.
              </div>
            ) : (
              <CompactTable ariaLabel="جدول تخصيص صلاحيات المستخدم">
                <thead>
                  <tr>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصلاحية</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>تفعيل</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(new Set(ALL_PERMISSIONS.map((p) => p.category))).map((cat) => {
                    const catPerms = ALL_PERMISSIONS.filter((p) => p.category === cat);
                    const allSelected = catPerms.every((p) => permissions.includes(p.key));

                    return (
                      <React.Fragment key={cat}>
                        <tr className="bg-[var(--surface-subtle)]">
                          <td colSpan={2} className="font-bold text-[var(--text-primary)] py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span>{cat}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const catKeys = catPerms.map((p) => p.key);
                                  if (allSelected) {
                                    setPermissions((prev) => prev.filter((k) => !catKeys.includes(k)));
                                  } else {
                                    setPermissions((prev) => Array.from(new Set([...prev, ...catKeys])));
                                  }
                                }}
                                className="min-h-[44px] px-2 text-xs font-bold ui-link hover:underline cursor-pointer"
                              >
                                {allSelected ? 'إلغاء تحديد القسم' : 'تحديد كل القسم'}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {catPerms.map((p) => {
                          const checked = permissions.includes(p.key);
                          return (
                            <tr key={p.key}>
                              <td className={COMPACT_TABLE_TEXT_CLASS}>
                                <div className="font-bold text-[var(--text-primary)]">{p.label}</div>
                              </td>
                              <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                                <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => handleTogglePermission(p.key)}
                                    aria-label={p.label}
                                    className="w-4 h-4 accent-[#1668B2] cursor-pointer"
                                  />
                                </label>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </CompactTable>
            )}
          </div>
        )}
      </form>
    </ModalShell>
  );
};

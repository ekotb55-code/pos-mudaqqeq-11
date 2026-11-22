import React, { useState, useEffect, useMemo } from 'react';
import { UserAccount, PermissionKey } from '../types';
import { api } from '../api/client';
import { ALL_PERMISSIONS, ROLE_TEMPLATES, hasPermission } from '../utils/permissions';
import { useOfflineMode } from '../hooks/useOfflineMode';
import { updateOfflineUserPermissionsInDb } from '../offline/db';
import {
  Save,
  CheckCircle2,
  AlertTriangle,
  Search,
  Check,
  X,
} from 'lucide-react';
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

interface PermissionsPageProps {
  currentUser: UserAccount;
  users: UserAccount[];
  onRefreshUsers: () => Promise<void>;
  onUserPermissionsUpdated?: (updatedUser: UserAccount) => void;
}

const ROLE_LABELS_AR: Record<'designer' | 'manager' | 'employee', string> = {
  designer: 'مصمم / مالك',
  manager: 'مدير',
  employee: 'موظف',
};

export const PermissionsPage: React.FC<PermissionsPageProps> = ({
  currentUser,
  users,
  onRefreshUsers,
  onUserPermissionsUpdated,
}) => {
  const { isOffline } = useOfflineMode();
  const [selectedUser, setSelectedUser] = useState<UserAccount | null>(users[0] || null);
  const [userPermissions, setUserPermissions] = useState<PermissionKey[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Group permissions by category
  const categories = useMemo(
    () => Array.from(new Set(ALL_PERMISSIONS.map((p) => p.category))),
    []
  );

  useEffect(() => {
    if (selectedUser) {
      if (selectedUser.role === 'designer') {
        setUserPermissions(ALL_PERMISSIONS.map((p) => p.key));
      } else {
        setUserPermissions(selectedUser.permissions || ROLE_TEMPLATES[selectedUser.role] || []);
      }
    }
  }, [selectedUser]);

  // Update selectedUser if users list changes
  useEffect(() => {
    if (users.length > 0 && !selectedUser) {
      setSelectedUser(users[0]);
    } else if (selectedUser) {
      const updated = users.find((u) => u.id === selectedUser.id);
      if (updated) setSelectedUser(updated);
    }
  }, [users, selectedUser]);

  const isCurrentDesigner = currentUser.role === 'designer' || Boolean(currentUser.isOwner);
  const isTargetDesigner = selectedUser?.role === 'designer' || Boolean(selectedUser?.isOwner);
  const canEditTarget =
    isCurrentDesigner || (!isTargetDesigner && hasPermission(currentUser, 'permissions.manage'));

  const handleTogglePermission = (permKey: PermissionKey) => {
    if (!canEditTarget || isTargetDesigner) return;

    // Delegated manager cannot grant a permission they don't have
    if (!isCurrentDesigner && !currentUser.permissions?.includes(permKey)) {
      setFeedback({
        type: 'error',
        message: 'غير مصرح: لا يمكنك منح صلاحية لا تمتلكها شخصياً',
      });
      return;
    }

    setUserPermissions((prev) =>
      prev.includes(permKey) ? prev.filter((k) => k !== permKey) : [...prev, permKey]
    );
  };

  const handleApplyTemplate = (roleType: 'designer' | 'manager' | 'employee') => {
    if (!canEditTarget || isTargetDesigner) return;

    if (roleType === 'designer' && !isCurrentDesigner) {
      setFeedback({
        type: 'error',
        message: 'غير مصرح: لا يمكن تطبيق قالب مالك النظام إلا من قِبل مالك النظام',
      });
      return;
    }

    let templatePerms = ROLE_TEMPLATES[roleType] || [];
    if (!isCurrentDesigner) {
      templatePerms = templatePerms.filter((p) => currentUser.permissions?.includes(p));
    }

    setUserPermissions(templatePerms);
    setFeedback({
      type: 'success',
      message: `تم تطبيق قالب (${roleType === 'designer' ? 'المالك' : roleType === 'manager' ? 'المدير' : 'الموظف'}) بنجاح، تذكر الضغط على حفظ التغييرات`,
    });
  };

  const handleToggleCategory = (category: string) => {
    if (!canEditTarget || isTargetDesigner) return;
    const catPerms = ALL_PERMISSIONS.filter((p) => p.category === category).map((p) => p.key);
    const allSelected = catPerms.every((k) => userPermissions.includes(k));

    if (allSelected) {
      setUserPermissions((prev) => prev.filter((k) => !catPerms.includes(k)));
    } else {
      const toAdd = isCurrentDesigner
        ? catPerms
        : catPerms.filter((p) => currentUser.permissions?.includes(p));
      setUserPermissions((prev) => Array.from(new Set([...prev, ...toAdd])));
    }
  };

  const handleConfirmSave = async () => {
    if (!selectedUser) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      if (isOffline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        const offlineRes = await updateOfflineUserPermissionsInDb({
          targetUserId: selectedUser.id,
          permissions: userPermissions,
          actor: currentUser,
        });
        if (onUserPermissionsUpdated) {
          onUserPermissionsUpdated(offlineRes.user);
        }
        await onRefreshUsers();
        setFeedback({
          type: 'success',
          message: `تم تطبيق صلاحيات المستخدم (${selectedUser.name}) على هذا الجهاز وحفظها في صندوق الصادر للمزامنة عند رجوع الاتصال`,
        });
        setShowConfirmModal(false);
        return;
      }

      await api.updateUserPermissions(selectedUser.id, userPermissions);
      await onRefreshUsers();
      setFeedback({
        type: 'success',
        message: `تم حفظ وتحديث صلاحيات المستخدم (${selectedUser.name}) بنجاح!`,
      });
      setShowConfirmModal(false);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'حدث خطأ أثناء حفظ الصلاحيات',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const filteredUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (u.username && u.username.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (u.phone && u.phone.includes(searchQuery)) ||
          u.role.includes(searchQuery)
      ),
    [users, searchQuery]
  );

  const designerRoleSet = useMemo(() => new Set(ROLE_TEMPLATES.designer), []);
  const managerRoleSet = useMemo(() => new Set(ROLE_TEMPLATES.manager), []);
  const employeeRoleSet = useMemo(() => new Set(ROLE_TEMPLATES.employee), []);

  return (
    <PageSurface
      dir="rtl"
      title="إدارة مصفوفة الصلاحيات (RBAC)"
      subtitle="نظام الصلاحيات التفصيلي • الأصل هو المنع ما لم تُمنح الصلاحية صراحةً"
      actions={
        selectedUser ? (
          <button
            type="button"
            onClick={() => setShowConfirmModal(true)}
            disabled={isSaving || isTargetDesigner || !canEditTarget}
            className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white font-bold text-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'جاري الحفظ...' : 'حفظ الصلاحيات'}</span>
          </button>
        ) : undefined
      }
    >
      {/* صف البحث واختيار المستخدم والقوالب الجاهزة */}
      <div className="flex flex-wrap items-end gap-3 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <label
            htmlFor="permissions-user-search"
            className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
          >
            بحث عن مستخدم
          </label>
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 pointer-events-none" />
            <input
              id="permissions-user-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="الاسم أو اسم المستخدم أو الهاتف..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} pr-9 text-xs`}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="permissions-user-select"
            className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
          >
            المستخدم المحدد
          </label>
          <select
            id="permissions-user-select"
            value={selectedUser?.id || ''}
            onChange={(e) => {
              const found = users.find((u) => u.id === e.target.value) || null;
              setSelectedUser(found);
              setFeedback(null);
            }}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-semibold`}
          >
            {filteredUsers.length === 0 ? (
              <option value="">لا يوجد مستخدمون مطابقون</option>
            ) : (
              filteredUsers.map((u) => {
                const isOwner = u.role === 'designer' || Boolean(u.isOwner);
                return (
                  <option key={u.id} value={u.id}>
                    {u.name} (@{u.username || u.phone}) — {ROLE_LABELS_AR[u.role]}
                    {isOwner ? ' • مالك النظام' : ''}
                  </option>
                );
              })
            )}
          </select>
        </div>

        {selectedUser && !isTargetDesigner && canEditTarget && (
          <>
            <button
              type="button"
              onClick={() => handleApplyTemplate('employee')}
              className="min-h-[44px] inline-flex items-center px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-semibold transition cursor-pointer"
            >
              تطبيق قالب كاشير
            </button>
            <button
              type="button"
              onClick={() => handleApplyTemplate('manager')}
              className="min-h-[44px] inline-flex items-center px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-semibold transition cursor-pointer"
            >
              تطبيق قالب مدير
            </button>
          </>
        )}

        {selectedUser && (
          <div className="min-h-[44px] inline-flex items-center text-xs text-[var(--text-secondary)]">
            <span>
              الدور:{' '}
              <strong className="text-[var(--text-primary)]">
                {ROLE_LABELS_AR[selectedUser.role]}
              </strong>{' '}
              • المفعّل:{' '}
              <strong className="text-[var(--text-primary)] tabular-nums">
                {userPermissions.length} / {ALL_PERMISSIONS.length}
              </strong>
            </span>
          </div>
        )}
      </div>

      {feedback && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 py-2 border-b border-[var(--border-subtle)] text-xs font-bold ${
            feedback.type === 'success' ? 'ui-money-purchase' : 'ui-stock-out'
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
            aria-label="إغلاق الرسالة"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {selectedUser && isTargetDesigner && (
        <div className="text-xs leading-relaxed ui-stock-low py-2 border-b border-[var(--border-subtle)]">
          <strong>حساب مالك ومصمم النظام محمي:</strong> يمتلك مالك النظام صلاحية كاملة وغير قابلة للسحب على كافة وظائف التطبيق وإعدادات الهوية والطباعة والأسعار، ولا يمكن تعديل صلاحياته أو تخفيضها.
        </div>
      )}

      <SectionHeading title="مصفوفة الصلاحيات والأدوار" />

      <CompactTable ariaLabel="جدول مصفوفة الصلاحيات حسب الأدوار والمستخدم">
        <thead>
          <tr>
            <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصلاحية</th>
            <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>المالك</th>
            <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>المدير</th>
            <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الموظف</th>
            <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
              {selectedUser ? `تخصيص: ${selectedUser.name}` : 'المستخدم المحدد'}
            </th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => {
            const catPerms = ALL_PERMISSIONS.filter((p) => p.category === cat);
            const selectedCount = catPerms.filter((p) => userPermissions.includes(p.key)).length;
            const allCatSelected = selectedCount === catPerms.length;

            return (
              <React.Fragment key={cat}>
                {/* صف عنوان المجموعة الفاصل */}
                <tr className="bg-[var(--surface-subtle)]">
                  <td colSpan={5} className="font-semibold text-[var(--text-primary)] py-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-bold">{cat}</span>
                        <span className="text-xs text-[var(--text-secondary)] font-mono tabular-nums">
                          ({selectedCount} / {catPerms.length})
                        </span>
                      </div>

                      {selectedUser && !isTargetDesigner && canEditTarget && (
                        <button
                          type="button"
                          onClick={() => handleToggleCategory(cat)}
                          className="min-h-[44px] inline-flex items-center px-3 rounded-lg text-xs font-semibold ui-link hover:underline cursor-pointer"
                        >
                          {allCatSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {/* صفوف الصلاحيات داخل المجموعة */}
                {catPerms.map((perm) => {
                  const isChecked = userPermissions.includes(perm.key);
                  const isDisabled =
                    !selectedUser ||
                    isTargetDesigner ||
                    !canEditTarget ||
                    (!isCurrentDesigner && !currentUser.permissions?.includes(perm.key));

                  const inDesigner = designerRoleSet.has(perm.key);
                  const inManager = managerRoleSet.has(perm.key);
                  const inEmployee = employeeRoleSet.has(perm.key);

                  return (
                    <tr key={perm.key}>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>
                        <div className="font-bold text-[var(--text-primary)]">
                          {perm.label}{' '}
                          <code className="text-[11px] font-mono font-normal text-[var(--text-secondary)]">
                            ({perm.key})
                          </code>
                          {perm.designerOnly && (
                            <span className="mr-1.5 text-[11px] font-bold ui-stock-low">
                              • خاص بالمالك
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-0.5">
                          {perm.description}
                        </div>
                      </td>

                      <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                        {inDesigner ? (
                          <Check className="w-4 h-4 mx-auto ui-money-purchase" aria-label="متاح للمالك" />
                        ) : (
                          <span className="text-[var(--text-secondary)]">—</span>
                        )}
                      </td>

                      <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                        {inManager ? (
                          <Check className="w-4 h-4 mx-auto ui-money-purchase" aria-label="متاح للمدير" />
                        ) : (
                          <span className="text-[var(--text-secondary)]">—</span>
                        )}
                      </td>

                      <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                        {inEmployee ? (
                          <Check className="w-4 h-4 mx-auto ui-money-purchase" aria-label="متاح للموظف" />
                        ) : (
                          <span className="text-[var(--text-secondary)]">—</span>
                        )}
                      </td>

                      <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                        <label
                          className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center ${
                            isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isDisabled}
                            onChange={() => handleTogglePermission(perm.key)}
                            aria-label={`${perm.label} للمستخدم ${selectedUser?.name || ''}`}
                            className="w-4 h-4 accent-[#1668B2] cursor-pointer disabled:cursor-not-allowed"
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
        <tfoot>
          <tr>
            <td colSpan={5} className="text-right font-bold">
              {selectedUser
                ? `إجمالي الصلاحيات المفعلة للمستخدم ${selectedUser.name}: ${userPermissions.length} من أصل ${ALL_PERMISSIONS.length}`
                : `إجمالي الصلاحيات المتاحة بالنظام: ${ALL_PERMISSIONS.length}`}
            </td>
          </tr>
        </tfoot>
      </CompactTable>

      {showConfirmModal && selectedUser && (
        <ModalShell
          title="تأكيد حفظ مصفوفة الصلاحيات"
          onClose={() => !isSaving && setShowConfirmModal(false)}
          closeDisabled={isSaving}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isSaving}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition cursor-pointer disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmSave}
                disabled={isSaving}
                className="min-h-[44px] px-5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isSaving ? 'جاري الحفظ...' : 'تأكيد الحفظ'}
              </button>
            </>
          }
        >
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed max-w-md">
            هل أنت متأكد من حفظ التعديلات على صلاحيات المستخدم{' '}
            <strong className="text-[var(--text-primary)]">{selectedUser.name}</strong>؟
            <br />
            سيتم تفعيل{' '}
            <strong className="text-[var(--text-primary)]">{userPermissions.length}</strong>{' '}
            صلاحية من أصل {ALL_PERMISSIONS.length}، وسيتم تسجيل هذا التغيير في سجل التدقيق.
          </p>
        </ModalShell>
      )}
    </PageSurface>
  );
};

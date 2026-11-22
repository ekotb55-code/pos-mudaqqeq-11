import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Download,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  api,
  setAuthToken,
  SystemResetStatusResponse,
} from '../../api/client';
import { applyDataEpochTransition } from '../../offline/db';
import {
  SectionHeading,
  ModalShell,
  FORM_CONTROL_BASE_CLASS,
} from '../ui';

export type ResetKind = 'operations' | 'factory';
export type ResetModalStep = 1 | 2 | 3 | 4;

export interface SystemResetSectionProps {
  canResetOperations: boolean;
  canFactoryReset: boolean;
  canManageBackup: boolean;
  onDownloadBackup: () => Promise<boolean>;
  onResetComplete?: () => void;
  formatDateTimeCairo: (iso?: string | null) => string;
  initialResetStatus?: SystemResetStatusResponse | null;
  initialModalKind?: ResetKind | null;
  initialModalStep?: ResetModalStep;
}

export const RESET_OPERATIONS_DETAILS = {
  title: 'إعادة ضبط العمليات',
  buttonLabel: 'إعادة ضبط العمليات',
  defaultPhrase: 'مسح العمليات',
  wiped: [
    'كل فواتير البيع والمشتريات والمرتجعات وسطورها',
    'كل حركات المخزون والخزائن والتحويلات وأوامر الصرف',
    'كشوف حساب العملاء والموردين والمنصات والتقسيط والتحصيل',
    'تصفير كميات الأصناف وأرصدة العملاء والموردين والمنصات والخزائن',
  ],
  kept: [
    'أسماء وبيانات الأصناف وأسعارها وباركوداتها وتصنيفاتها',
    'أسماء العملاء والموردين والمنصات والمخازن والخزائن (بأرصدة صفر)',
    'جميع حسابات المستخدمين وصلاحياتهم',
    'إعدادات النظام والشركة والطباعة وسجل التدقيق',
  ],
};

export const FACTORY_RESET_DETAILS = {
  title: 'إعادة ضبط المصنع',
  buttonLabel: 'إعادة ضبط المصنع',
  defaultPhrase: 'مسح كل شيء',
  wiped: [
    'كل الأصناف والفواتير والمشتريات والمرتجعات وحركات المخزون',
    'كل العملاء والموردين والمنصات والمخازن والخزائن الإضافية',
    'كل حركات الخزائن وكشوف الحساب وسجل التدقيق القديم',
    'كل حسابات المستخدمين الأخرى (عدا المالك ومنفّذ العملية)',
    'إرجاع إعدادات النظام والشركة والطباعة إلى الوضع الافتراضي',
  ],
  kept: [
    'حساب مالك النظام فقط وحساب من نفّذ العملية',
    'مخزن رئيسي وخزينة رئيسية فارغان',
    'سطر عملية إعادة الضبط فقط في سجل التدقيق',
  ],
};

export const SystemResetSection: React.FC<SystemResetSectionProps> = ({
  canResetOperations,
  canFactoryReset,
  canManageBackup,
  onDownloadBackup,
  onResetComplete,
  formatDateTimeCairo,
  initialResetStatus = null,
  initialModalKind = null,
  initialModalStep = 1,
}) => {
  const [resetStatus, setResetStatus] = useState<SystemResetStatusResponse | null>(initialResetStatus);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(!initialResetStatus);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [modalKind, setModalKind] = useState<ResetKind | null>(initialModalKind);
  const [modalStep, setModalStep] = useState<ResetModalStep>(initialModalStep);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);
  const [preResetBackupDone, setPreResetBackupDone] = useState(false);
  const [backupStepError, setBackupStepError] = useState<string | null>(null);
  const [understoodNoBackup, setUnderstoodNoBackup] = useState(false);

  const [passwordInput, setPasswordInput] = useState('');
  const [confirmTextInput, setConfirmTextInput] = useState('');
  const [isExecutingReset, setIsExecutingReset] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  const loadResetStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    setStatusError(null);
    try {
      const res = await api.getResetStatus();
      setResetStatus(res);
    } catch (err: any) {
      setStatusError(err?.message || 'تعذر قراءة حالة إعادة الضبط من الخادم');
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (initialResetStatus) return;
    if (canResetOperations || canFactoryReset) {
      void loadResetStatus();
    }
  }, [canResetOperations, canFactoryReset, initialResetStatus, loadResetStatus]);

  if (!canResetOperations && !canFactoryReset) {
    return null;
  }

  const openModal = (kind: ResetKind) => {
    setModalKind(kind);
    setModalStep(1);
    setIsDownloadingBackup(false);
    setPreResetBackupDone(false);
    setBackupStepError(null);
    setUnderstoodNoBackup(false);
    setPasswordInput('');
    setConfirmTextInput('');
    setIsExecutingReset(false);
    setExecuteError(null);
  };

  const closeModal = () => {
    if (isDownloadingBackup || isExecutingReset || modalStep === 4) return;
    setModalKind(null);
  };

  const triggerBackupDownloadStep = async () => {
    setBackupStepError(null);
    setIsDownloadingBackup(true);
    try {
      const ok = await onDownloadBackup();
      if (!ok) {
        setBackupStepError('تعذر تنزيل النسخة الاحتياطية — تم إيقاف المتابعة حفاظًا على بياناتك.');
        return;
      }
      setPreResetBackupDone(true);
      setModalStep(3);
    } catch (err: any) {
      setBackupStepError(
        err?.message || 'تعذر تنزيل النسخة الاحتياطية — تم إيقاف المتابعة حفاظًا على بياناتك.'
      );
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  const handleProceedFromStep1 = async () => {
    setModalStep(2);
    if (canManageBackup) {
      await triggerBackupDownloadStep();
    }
  };

  const handleFinishSessionLogout = () => {
    setAuthToken(null);
    try {
      localStorage.removeItem('pos_user');
      localStorage.removeItem('pos_token');
      localStorage.removeItem('pos_session_offline');
      localStorage.removeItem('pos_session_expires_at');
    } catch (_) {}
    if (onResetComplete) {
      onResetComplete();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const activeDetails =
    modalKind === 'factory' ? FACTORY_RESET_DETAILS : RESET_OPERATIONS_DETAILS;

  const requiredPhrase =
    modalKind === 'factory'
      ? resetStatus?.phrases?.factory || FACTORY_RESET_DETAILS.defaultPhrase
      : resetStatus?.phrases?.operations || RESET_OPERATIONS_DETAILS.defaultPhrase;

  const isConfirmPhraseMatched = confirmTextInput.trim() === requiredPhrase;

  const handleExecuteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalKind || !passwordInput || !isConfirmPhraseMatched || isExecutingReset) return;

    setExecuteError(null);
    setIsExecutingReset(true);
    try {
      const res =
        modalKind === 'factory'
          ? await api.factoryReset({
              password: passwordInput,
              confirmText: confirmTextInput.trim(),
            })
          : await api.resetOperations({
              password: passwordInput,
              confirmText: confirmTextInput.trim(),
            });

      if (!res?.success) {
        setExecuteError(res?.error || 'تعذر تنفيذ عملية إعادة الضبط');
        return;
      }

      const confEpoch = await api
        .getConfig()
        .then((c) => c?.dataEpoch)
        .catch(() => '');
      const epochToApply = (confEpoch && String(confEpoch).trim()) || new Date().toISOString();
      await applyDataEpochTransition(epochToApply, { forceClearSnapshot: true }).catch(() => {});

      setModalStep(4);
      window.setTimeout(() => {
        handleFinishSessionLogout();
      }, 1500);
    } catch (err: any) {
      setExecuteError(err?.message || 'تعذر تنفيذ عملية إعادة الضبط');
    } finally {
      setIsExecutingReset(false);
    }
  };

  const lastResetInfo = resetStatus?.reset;
  const lastResetTypeLabel =
    lastResetInfo?.lastResetType === 'factory'
      ? 'إعادة ضبط المصنع'
      : lastResetInfo?.lastResetType === 'operations'
      ? 'إعادة ضبط العمليات'
      : '—';

  return (
    <div id="settings-reset-section" className="space-y-6 scroll-mt-4">
      <SectionHeading
        title="إعادة الضبط"
        actions={
          isLoadingStatus ? (
            <span className="text-[11px] text-[var(--text-secondary)]">جاري التحميل...</span>
          ) : undefined
        }
      />

      {statusError && (
        <div
          role="alert"
          className="py-2 text-rose-700 dark:text-rose-400 text-xs font-bold flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{statusError}</span>
        </div>
      )}

      {/* معلومات آخر إعادة ضبط */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-3 border-b border-[var(--border-subtle)] text-xs">
        <div>
          <div className="text-[11px] text-[var(--text-secondary)]">آخر إعادة ضبط للنظام</div>
          <div className="font-bold text-[var(--text-primary)] mt-1 tabular-nums">
            {lastResetInfo?.lastResetAt
              ? `${formatDateTimeCairo(lastResetInfo.lastResetAt)}${
                  lastResetInfo.lastResetBy ? ` — بواسطة: ${lastResetInfo.lastResetBy}` : ''
                }`
              : 'لم يتم تنفيذ أي إعادة ضبط للنظام من قبل'}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--text-secondary)]">نوع آخر إعادة ضبط</div>
          <div className="font-bold text-[var(--text-primary)] mt-1">{lastResetTypeLabel}</div>
        </div>
      </div>

      {/* قسمي إعادة الضبط حسب الصلاحيات بدون صناديق أو قوالب */}
      <div className="divide-y divide-[var(--border-subtle)]">
        {canResetOperations && (
          <div
            data-testid="reset-operations-card"
            className="py-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-amber-700 dark:text-amber-400">
                  {RESET_OPERATIONS_DETAILS.title}
                </h3>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  تصفير الحركة والأرصدة مع الإبقاء على التعريفات الأساسية والحسابات
                </p>
              </div>

              <button
                type="button"
                onClick={() => openModal('operations')}
                className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white font-bold text-xs transition cursor-pointer shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{RESET_OPERATIONS_DETAILS.buttonLabel}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs leading-relaxed">
              <div>
                <div className="font-extrabold text-rose-700 dark:text-rose-400 mb-1">يُمسح:</div>
                <ul className="list-disc list-inside space-y-1 text-[var(--text-secondary)]">
                  {RESET_OPERATIONS_DETAILS.wiped.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-extrabold text-emerald-700 dark:text-emerald-400 mb-1">يبقى:</div>
                <ul className="list-disc list-inside space-y-1 text-[var(--text-secondary)]">
                  {RESET_OPERATIONS_DETAILS.kept.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {canFactoryReset && (
          <div
            data-testid="factory-reset-card"
            className="py-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-rose-700 dark:text-rose-400">
                  {FACTORY_RESET_DETAILS.title}
                </h3>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  مسح شامل للنظام واستعادة الإعدادات الافتراضية
                </p>
              </div>

              <button
                type="button"
                onClick={() => openModal('factory')}
                className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition cursor-pointer shrink-0"
              >
                <Trash2 className="w-4 h-4" />
                <span>{FACTORY_RESET_DETAILS.buttonLabel}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs leading-relaxed">
              <div>
                <div className="font-extrabold text-rose-700 dark:text-rose-400 mb-1">يُمسح:</div>
                <ul className="list-disc list-inside space-y-1 text-[var(--text-secondary)]">
                  {FACTORY_RESET_DETAILS.wiped.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-extrabold text-emerald-700 dark:text-emerald-400 mb-1">يبقى:</div>
                <ul className="list-disc list-inside space-y-1 text-[var(--text-secondary)]">
                  {FACTORY_RESET_DETAILS.kept.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* نافذة التأكيد متعددة الخطوات */}
      {modalKind && (
        <ModalShell
          title={activeDetails.title}
          subtitle={`الخطوة ${modalStep} من 4`}
          onClose={closeModal}
          closeDisabled={isDownloadingBackup || isExecutingReset || modalStep === 4}
          className="max-w-2xl"
          footer={
            modalStep === 1 ? (
              <>
                <button
                  type="button"
                  onClick={closeModal}
                  className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={() => void handleProceedFromStep1()}
                  className={`min-h-[44px] px-5 rounded-lg text-white text-xs font-bold cursor-pointer ${
                    modalKind === 'factory'
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-[#D97706] hover:bg-[#B45309]'
                  }`}
                >
                  متابعة
                </button>
              </>
            ) : modalStep === 2 ? (
              <>
                <button
                  type="button"
                  disabled={isDownloadingBackup}
                  onClick={closeModal}
                  className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  إلغاء
                </button>
                {canManageBackup ? (
                  <button
                    type="button"
                    disabled={isDownloadingBackup}
                    onClick={() => void triggerBackupDownloadStep()}
                    className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-[#168A4A] hover:bg-[#12703C] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {isDownloadingBackup ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    <span>
                      {isDownloadingBackup
                        ? 'جاري تنزيل النسخة الاحتياطية...'
                        : 'إعادة محاولة تنزيل النسخة الاحتياطية'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!understoodNoBackup}
                    onClick={() => setModalStep(3)}
                    className={`min-h-[44px] px-5 rounded-lg text-white text-xs font-bold cursor-pointer disabled:opacity-50 ${
                      modalKind === 'factory'
                        ? 'bg-rose-600 hover:bg-rose-700'
                        : 'bg-[#D97706] hover:bg-[#B45309]'
                    }`}
                  >
                    متابعة
                  </button>
                )}
              </>
            ) : modalStep === 4 ? (
              <button
                type="button"
                onClick={handleFinishSessionLogout}
                className="min-h-[44px] px-5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold cursor-pointer"
              >
                تسجيل الدخول من جديد
              </button>
            ) : undefined
          }
        >
          {/* الخطوة 1: مراجعة ما يُمسح وما يبقى + التحذير */}
          {modalStep === 1 && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 leading-relaxed">
                <div className="p-3 rounded-xl border border-rose-200 bg-[var(--surface-subtle)]">
                  <div className="font-extrabold text-rose-700 dark:text-rose-400 mb-1.5">
                    يُمسح:
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-[var(--text-secondary)]">
                    {activeDetails.wiped.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="p-3 rounded-xl border border-emerald-200 bg-[var(--surface-subtle)]">
                  <div className="font-extrabold text-emerald-700 dark:text-emerald-400 mb-1.5">
                    يبقى:
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-[var(--text-secondary)]">
                    {activeDetails.kept.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div
                role="alert"
                className="p-3.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 text-xs font-bold flex items-start gap-2.5 leading-relaxed"
              >
                <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                <span>لا يمكن التراجع عن هذه العملية. كل المستخدمين سيسجلون الدخول من جديد.</span>
              </div>
            </div>
          )}

          {/* الخطوة 2: تنزيل النسخة الاحتياطية أولًا أو تحذير غياب صلاحية النسخ */}
          {modalStep === 2 && (
            <div className="space-y-4 text-xs">
              {canManageBackup ? (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-lg border border-[var(--border-color)] bg-[var(--surface-subtle)] font-bold text-[var(--text-primary)] flex items-center gap-2.5">
                    {isDownloadingBackup ? (
                      <RefreshCw className="w-4 h-4 animate-spin text-[#1668B2] shrink-0" />
                    ) : (
                      <Download className="w-4 h-4 text-[#168A4A] shrink-0" />
                    )}
                    <span>
                      {isDownloadingBackup
                        ? 'جاري تنزيل نسخة احتياطية كاملة من الوضع الحالي أولًا قبل المتابعة...'
                        : 'تنزيل نسخة احتياطية كاملة مطلوب قبل تنفيذ إعادة الضبط.'}
                    </span>
                  </div>
                  {backupStepError && (
                    <div
                      role="alert"
                      className="p-3.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 font-bold flex items-start gap-2"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{backupStepError}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div
                    role="alert"
                    className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 font-bold flex items-start gap-2.5 leading-relaxed"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <span>لا تملك صلاحية النسخ الاحتياطي، لن تُحفظ نسخة قبل المسح</span>
                  </div>

                  <label className="min-h-[44px] inline-flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--surface-subtle)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={understoodNoBackup}
                      onChange={(e) => setUnderstoodNoBackup(e.target.checked)}
                      className="w-4 h-4 accent-[#D97706] cursor-pointer"
                    />
                    <span className="font-bold text-[var(--text-primary)]">أفهم ذلك</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* الخطوة 3: كلمة السر + عبارة التأكيد */}
          {modalStep === 3 && (
            <form onSubmit={handleExecuteReset} className="space-y-4 text-xs">
              {preResetBackupDone && (
                <div
                  role="status"
                  className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>تم تنزيل النسخة الاحتياطية بنجاح. أكمل التأكيد لتنفيذ العملية.</span>
                </div>
              )}

              <div className="p-3 rounded-lg border border-[var(--border-color)] bg-[var(--surface-subtle)]">
                <span className="text-[var(--text-secondary)]">عبارة التأكيد المطلوبة: </span>
                <strong className="font-extrabold text-rose-700 dark:text-rose-400">
                  «{requiredPhrase}»
                </strong>
              </div>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="reset-current-password"
                    className="block font-bold text-[var(--text-primary)] mb-1"
                  >
                    كلمة سر المستخدم الحالي
                  </label>
                  <input
                    id="reset-current-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="أدخل كلمة سر حسابك للتأكيد"
                    className={`${FORM_CONTROL_BASE_CLASS} w-full text-xs`}
                  />
                </div>

                <div>
                  <label
                    htmlFor="reset-confirm-phrase"
                    className="block font-bold text-[var(--text-primary)] mb-1"
                  >
                    اكتب عبارة «{requiredPhrase}» للتأكيد
                  </label>
                  <input
                    id="reset-confirm-phrase"
                    type="text"
                    required
                    value={confirmTextInput}
                    onChange={(e) => setConfirmTextInput(e.target.value)}
                    placeholder={requiredPhrase}
                    className={`${FORM_CONTROL_BASE_CLASS} w-full text-xs font-bold`}
                  />
                </div>
              </div>

              {executeError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 font-bold flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{executeError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  disabled={isExecutingReset}
                  onClick={closeModal}
                  className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isExecutingReset || !passwordInput || !isConfirmPhraseMatched}
                  className={`min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg text-white font-bold text-xs transition cursor-pointer disabled:opacity-50 ${
                    modalKind === 'factory'
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-[#D97706] hover:bg-[#B45309]'
                  }`}
                >
                  {isExecutingReset ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : modalKind === 'factory' ? (
                    <Trash2 className="w-4 h-4" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  <span>
                    {isExecutingReset
                      ? 'جاري تنفيذ إعادة الضبط...'
                      : `تأكيد ${activeDetails.title}`}
                  </span>
                </button>
              </div>
            </form>
          )}

          {/* الخطوة 4: نتيجة النجاح والخروج لشاشة الدخول */}
          {modalStep === 4 && (
            <div
              role="status"
              className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold flex items-center gap-2.5 text-xs"
            >
              <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>تمت إعادة الضبط. سجّل الدخول من جديد</span>
            </div>
          )}
        </ModalShell>
      )}
    </div>
  );
};

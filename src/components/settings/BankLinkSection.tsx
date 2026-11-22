import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Battery,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  Play,
  Plus,
  Power,
  RefreshCw,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
  Edit3,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Calendar,
  Clock,
  Lock,
  Wallet,
} from 'lucide-react';
import { api, notifyManualBalanceUpdated, subscribeApiStatus } from '../../api/client';
import type {
  BankLinkAccountOverview,
  BankLinkMessageReading,
  BankLinkOverviewResponse,
  BankLinkTemplate,
  BankLinkTemplateDirection,
  Cashbox,
  ManualBalanceAccountOverview,
  ManualBalanceOverviewResponse,
  ManualBalanceRequest,
  ManualBalanceUserOption,
  UserAccount,
} from '../../types';
import {
  CompactTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  FORM_CONTROL_BASE_CLASS,
  INPUT_WIDTH_CLASSES,
  ModalShell,
  SectionHeading,
} from '../ui';
import {
  BANK_LINK_FOCUS_ALERTS_STORAGE_KEY,
  BANK_LINK_SELECTED_MANUAL_STORAGE_KEY,
  ManualBalanceModal,
  formatDeviceDateTime,
  formatDeviceTime,
  formatSignedManualDiff,
} from '../ManualBalancePrompt';

export const BANK_LINK_SELECTED_ACCOUNT_STORAGE_KEY = 'pos_bank_link_selected_account';

export const MANUAL_WEEKDAY_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'الأحد' },
  { value: 1, label: 'الاثنين' },
  { value: 2, label: 'الثلاثاء' },
  { value: 3, label: 'الأربعاء' },
  { value: 4, label: 'الخميس' },
  { value: 5, label: 'الجمعة' },
  { value: 6, label: 'السبت' },
];

const MANUAL_ENTRY_KIND_LABELS: Record<'baseline' | 'scheduled' | 'voluntary', string> = {
  baseline: 'أول إدخال',
  scheduled: 'في الموعد',
  voluntary: 'إدخال اختياري',
};

export function formatManualSchedule(
  acc: Pick<ManualBalanceAccountOverview, 'scheduleType' | 'time' | 'weekdays'>
): string {
  if (acc.scheduleType === 'weekdays' && acc.weekdays.length > 0) {
    const names = acc.weekdays
      .map((d) => MANUAL_WEEKDAY_OPTIONS.find((w) => w.value === d)?.label)
      .filter(Boolean);
    if (names.length > 0) {
      return `${names.join(' و')} ${acc.time}`;
    }
  }
  return `كل يوم ${acc.time}`;
}

export const TEMPLATE_SLOT_BUTTONS: readonly { token: string; label: string }[] = [
  { token: '{المبلغ}', label: '{المبلغ}' },
  { token: '{الرصيد}', label: '{الرصيد}' },
  { token: '{الحساب}', label: '{الحساب}' },
  { token: '{الاسم}', label: '{الاسم}' },
  { token: '{المرجع}', label: '{المرجع}' },
  { token: '{الرسوم}', label: '{الرسوم}' },
  { token: '{تجاهل}', label: '{تجاهل}' },
];

const DIRECTION_LABELS: Record<BankLinkTemplateDirection, string> = {
  in: 'داخل',
  out: 'خارج',
  auto: 'تلقائي',
  ignore: 'تُتجاهل',
};

const ENTRY_DIRECTION_LABELS: Record<'in' | 'out' | 'unknown', string> = {
  in: 'داخل',
  out: 'خارج',
  unknown: 'غير محدد',
};

export interface BankLinkSectionProps {
  cashboxes: Cashbox[];
  users?: UserAccount[];
  formatDateTimeCairo: (iso?: string | null) => string;
  canManageTemplatesFallback?: boolean;
  onRefreshCashboxes?: () => void | Promise<void>;
  initialOverview?: BankLinkOverviewResponse | null;
  initialManualOverview?: ManualBalanceOverviewResponse | null;
  initialSelectedAccountId?: string | null;
  initialSelectedManualAccountId?: string | null;
  initialDetailTab?: 'entries' | 'pending' | 'gaps' | 'unknown' | 'all';
  initialShowAccountForm?: boolean;
  initialAccountMethod?: 'sms' | 'manual';
  initialManualScheduleType?: 'daily' | 'weekdays';
  initialShowTemplateEditor?: boolean;
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return '—';
  }
  return `${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ج.م`;
}

function getOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

export const BankLinkSection: React.FC<BankLinkSectionProps> = ({
  cashboxes,
  users = [],
  formatDateTimeCairo,
  canManageTemplatesFallback = false,
  onRefreshCashboxes,
  initialOverview = null,
  initialManualOverview = null,
  initialSelectedAccountId = null,
  initialSelectedManualAccountId = null,
  initialDetailTab = 'entries',
  initialShowAccountForm = false,
  initialAccountMethod = 'sms',
  initialManualScheduleType = 'daily',
  initialShowTemplateEditor = false,
}) => {
  const [overview, setOverview] = useState<BankLinkOverviewResponse | null>(initialOverview);
  const [manualOverview, setManualOverview] = useState<ManualBalanceOverviewResponse | null>(
    initialManualOverview
  );
  const [isLoading, setIsLoading] = useState<boolean>(!initialOverview && !initialManualOverview);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Selected account details
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(() => {
    if (initialSelectedAccountId) return initialSelectedAccountId;
    if (typeof sessionStorage !== 'undefined') {
      const saved = sessionStorage.getItem(BANK_LINK_SELECTED_ACCOUNT_STORAGE_KEY);
      if (saved) {
        sessionStorage.removeItem(BANK_LINK_SELECTED_ACCOUNT_STORAGE_KEY);
        return saved;
      }
    }
    return initialOverview?.accounts?.[0]?.id || null;
  });
  const [detailTab, setDetailTab] = useState<'entries' | 'pending' | 'gaps' | 'unknown' | 'all'>(
    initialDetailTab
  );

  // Phone setup box state
  const [showIntakeKey, setShowIntakeKey] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [confirmRegenKey, setConfirmRegenKey] = useState(false);
  const [isRegeneratingKey, setIsRegeneratingKey] = useState(false);

  // Account confirm dialogs
  const [confirmDisableAccount, setConfirmDisableAccount] = useState<BankLinkAccountOverview | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState<BankLinkAccountOverview | null>(null);
  const [togglingAccountId, setTogglingAccountId] = useState<string | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

  // Account add/edit modal state
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(initialShowAccountForm);
  const [accountMethod, setAccountMethod] = useState<'sms' | 'manual'>(initialAccountMethod);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingManualAccountId, setEditingManualAccountId] = useState<string | null>(null);
  const [accName, setAccName] = useState('');
  const [accCashboxId, setAccCashboxId] = useState('');
  const [accSenders, setAccSenders] = useState<string[]>([]);
  const [accSenderDraft, setAccSenderDraft] = useState('');
  const [accSuffix, setAccSuffix] = useState('');
  const [accMatchWindow, setAccMatchWindow] = useState('30');
  const [accEnabled, setAccEnabled] = useState(true);
  const [accFormError, setAccFormError] = useState<string | null>(null);
  const [isSavingAccount, setIsSavingAccount] = useState(false);

  // Manual balance form & card state
  const [manName, setManName] = useState('');
  const [manCashboxId, setManCashboxId] = useState('');
  const [manResponsibleIds, setManResponsibleIds] = useState<string[]>([]);
  const [manScheduleType, setManScheduleType] = useState<'daily' | 'weekdays'>(initialManualScheduleType);
  const [manTime, setManTime] = useState('22:00');
  const [manWeekdays, setManWeekdays] = useState<number[]>([]);
  const [manMandatory, setManMandatory] = useState(true);
  const [manEnabled, setManEnabled] = useState(true);
  const [expandedManualLogId, setExpandedManualLogId] = useState<string | null>(() => {
    if (initialSelectedManualAccountId) return initialSelectedManualAccountId;
    if (typeof sessionStorage !== 'undefined') {
      const saved = sessionStorage.getItem(BANK_LINK_SELECTED_MANUAL_STORAGE_KEY);
      if (saved) {
        sessionStorage.removeItem(BANK_LINK_SELECTED_MANUAL_STORAGE_KEY);
        return saved;
      }
    }
    return null;
  });
  const [confirmDisableManualAccount, setConfirmDisableManualAccount] = useState<ManualBalanceAccountOverview | null>(null);
  const [confirmDeleteManualAccount, setConfirmDeleteManualAccount] = useState<ManualBalanceAccountOverview | null>(null);
  const [togglingManualId, setTogglingManualId] = useState<string | null>(null);
  const [deletingManualId, setDeletingManualId] = useState<string | null>(null);
  const [reviewingAlertId, setReviewingAlertId] = useState<string | null>(null);
  const [instantBalanceAccount, setInstantBalanceAccount] = useState<ManualBalanceAccountOverview | null>(null);

  // Templates section state
  const [isTemplateEditorOpen, setIsTemplateEditorOpen] = useState(initialShowTemplateEditor);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [tplName, setTplName] = useState('');
  const [tplSender, setTplSender] = useState('*');
  const [tplPattern, setTplPattern] = useState('');
  const [tplDirection, setTplDirection] = useState<BankLinkTemplateDirection>('auto');
  const [tplEnabled, setTplEnabled] = useState(true);
  const [tplSampleText, setTplSampleText] = useState('');
  const [tplError, setTplError] = useState<string | null>(null);
  const [isSuggestingTpl, setIsSuggestingTpl] = useState(false);
  const [isSavingTpl, setIsSavingTpl] = useState(false);
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<BankLinkTemplate | null>(null);
  const [isDeletingTpl, setIsDeletingTpl] = useState(false);
  const [loadingUnknownMsgId, setLoadingUnknownMsgId] = useState<string | null>(null);

  // Template test sandbox
  const [testText, setTestText] = useState('');
  const [testSender, setTestSender] = useState('');
  const [testResult, setTestResult] = useState<BankLinkMessageReading | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [isTestingTpl, setIsTestingTpl] = useState(false);

  // Import/export templates
  const [isExportingTpls, setIsExportingTpls] = useState(false);
  const [isImportingTpls, setIsImportingTpls] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const patternTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const notify = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
  };

  const loadOverview = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setLoadError(null);
    try {
      const [smsRes, manualRes] = await Promise.all([
        api.getBankLinkOverview().catch((err: any) => ({ success: false, error: err?.message } as any)),
        api.getManualBalanceOverview().catch(() => null),
      ]);
      if (!smsRes?.success) {
        setLoadError(smsRes?.error || 'تعذر تحميل بيانات الخزن المربوطة بالبنك');
      } else {
        setOverview(smsRes);
        setSelectedAccountId((prev) => {
          if (prev && smsRes.accounts.some((a: BankLinkAccountOverview) => a.id === prev)) return prev;
          return smsRes.accounts[0]?.id || null;
        });
      }
      if (manualRes?.success) {
        setManualOverview(manualRes);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'تعذر تحميل بيانات الخزن المربوطة بالبنك');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!initialOverview && !initialManualOverview) {
      loadOverview();
    }
    if (typeof sessionStorage !== 'undefined') {
      const focusAlerts = sessionStorage.getItem(BANK_LINK_FOCUS_ALERTS_STORAGE_KEY);
      if (focusAlerts) {
        sessionStorage.removeItem(BANK_LINK_FOCUS_ALERTS_STORAGE_KEY);
        requestAnimationFrame(() => {
          document.getElementById('bank-link-manual-alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    }
  }, []);

  useEffect(() => {
    return subscribeApiStatus((event) => {
      if (event.type === 'MANUAL_BALANCE_UPDATED') {
        loadOverview(true);
      }
    });
  }, []);

  const accounts = overview?.accounts || [];
  const unknownSenders = overview?.unknownSenders || [];
  const devices = overview?.devices || [];
  const templates = overview?.templates || [];
  const manualAccounts = manualOverview?.accounts || [];
  const manualAlerts = manualOverview?.alerts || [];
  const manualUsers: ManualBalanceUserOption[] = useMemo(() => {
    if (manualOverview?.users && manualOverview.users.length > 0) {
      return manualOverview.users;
    }
    return users.map((u) => ({
      id: String(u.id),
      name: String(u.name || u.username || ''),
      username: String(u.username || ''),
      role: String(u.role || ''),
    }));
  }, [manualOverview?.users, users]);
  const canManageTemplates = overview ? Boolean(overview.canManageTemplates) : canManageTemplatesFallback;

  const hasEnabledAccount = accounts.some((a) => a.enabled);
  const hasOnlineDevice = devices.some((d) => d.online);
  const showOfflinePhoneWarning = hasEnabledAccount && !hasOnlineDevice;

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );

  const origin = getOrigin();
  const fullIntakeUrl = `${origin}${overview?.intakePath || '/api/bank-link/intake'}`;
  const fullHeartbeatUrl = `${origin}${overview?.heartbeatPath || '/api/bank-link/heartbeat'}`;
  const intakeKey = overview?.intakeKey || '';

  const handleCopy = async (field: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((cur) => (cur === field ? null : cur)), 2000);
    } catch {
      notify('error', 'تعذر النسخ إلى الحافظة، انسخ النص يدويًا');
    }
  };

  // Account form helpers
  const openCreateAccountModal = () => {
    setAccountMethod('sms');
    setEditingAccountId(null);
    setEditingManualAccountId(null);
    const linkedIds = new Set([
      ...accounts.map((a) => a.cashboxId),
      ...manualAccounts.map((a) => a.cashboxId),
    ]);
    const firstAvailable = cashboxes.find((c) => !linkedIds.has(c.id));
    setAccName('');
    setAccCashboxId(firstAvailable?.id || '');
    setAccSenders([]);
    setAccSenderDraft('');
    setAccSuffix('');
    setAccMatchWindow('30');
    setAccEnabled(true);
    setManName('');
    setManCashboxId(firstAvailable?.id || '');
    setManResponsibleIds([]);
    setManScheduleType('daily');
    setManTime('22:00');
    setManWeekdays([]);
    setManMandatory(true);
    setManEnabled(true);
    setAccFormError(null);
    setIsAccountModalOpen(true);
  };

  const openEditAccountModal = (acc: BankLinkAccountOverview) => {
    setAccountMethod('sms');
    setEditingManualAccountId(null);
    setEditingAccountId(acc.id);
    setAccName(acc.name);
    setAccCashboxId(acc.cashboxId);
    setAccSenders([...acc.senders]);
    setAccSenderDraft('');
    setAccSuffix(acc.accountSuffix || '');
    setAccMatchWindow(String(acc.matchWindowMinutes || 30));
    setAccEnabled(acc.enabled);
    setAccFormError(null);
    setIsAccountModalOpen(true);
  };

  const openEditManualAccountModal = (acc: ManualBalanceAccountOverview) => {
    setAccountMethod('manual');
    setEditingAccountId(null);
    setEditingManualAccountId(acc.id);
    setManName(acc.name);
    setManCashboxId(acc.cashboxId);
    setManResponsibleIds([...acc.responsibleUserIds]);
    setManScheduleType(acc.scheduleType);
    setManTime(acc.time || '22:00');
    setManWeekdays([...acc.weekdays]);
    setManMandatory(acc.mandatory);
    setManEnabled(acc.enabled);
    setAccFormError(null);
    setIsAccountModalOpen(true);
  };

  const toggleManualResponsible = (userId: string) => {
    setManResponsibleIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const toggleManualWeekday = (day: number) => {
    setManWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  };

  const addSenderChip = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return;
    setAccSenders((prev) => (prev.some((s) => s.toLowerCase() === cleaned.toLowerCase()) ? prev : [...prev, cleaned]));
    setAccSenderDraft('');
  };

  const removeSenderChip = (sender: string) => {
    setAccSenders((prev) => prev.filter((s) => s !== sender));
  };

  const handleSaveAccount = async () => {
    setAccFormError(null);
    setIsSavingAccount(true);
    try {
      if (accountMethod === 'manual') {
        const res = await api.saveManualBalanceAccount({
          ...(editingManualAccountId ? { id: editingManualAccountId } : {}),
          name: manName.trim(),
          cashboxId: manCashboxId,
          responsibleUserIds: manResponsibleIds,
          scheduleType: manScheduleType,
          time: manTime.trim(),
          weekdays: manScheduleType === 'weekdays' ? manWeekdays : [],
          mandatory: manMandatory,
          enabled: manEnabled,
        });
        if (!res.success) {
          setAccFormError(res.error || 'تعذر حفظ المتابعة اليدوية');
          return;
        }
        setIsAccountModalOpen(false);
        notify(
          'success',
          editingManualAccountId
            ? 'تم تحديث بيانات المتابعة اليدوية'
            : 'تم حفظ المتابعة اليدوية — سيُطلب أول رصيد من المسؤول فورًا'
        );
        notifyManualBalanceUpdated();
        await loadOverview(true);
        return;
      }

      const pendingDraft = accSenderDraft.trim();
      const finalSenders = pendingDraft && !accSenders.some((s) => s.toLowerCase() === pendingDraft.toLowerCase())
        ? [...accSenders, pendingDraft]
        : accSenders;
      const res = await api.saveBankLinkAccount({
        ...(editingAccountId ? { id: editingAccountId } : {}),
        name: accName.trim(),
        cashboxId: accCashboxId,
        senders: finalSenders,
        accountSuffix: accSuffix.trim(),
        matchWindowMinutes: Number(accMatchWindow) || 30,
        enabled: accEnabled,
      });
      if (!res.success) {
        setAccFormError(res.error || 'تعذر حفظ الحساب المربوط');
        return;
      }
      setIsAccountModalOpen(false);
      if (res.account?.id) setSelectedAccountId(res.account.id);
      notify('success', editingAccountId ? 'تم تحديث بيانات الحساب المربوط' : 'تم ربط الخزنة برسائل البنك بنجاح');
      await loadOverview(true);
    } catch (err: any) {
      setAccFormError(err?.message || 'تعذر حفظ الحساب');
    } finally {
      setIsSavingAccount(false);
    }
  };

  const executeToggleManualEnabled = async (acc: ManualBalanceAccountOverview, nextEnabled: boolean) => {
    setTogglingManualId(acc.id);
    try {
      const res = await api.setManualBalanceAccountEnabled(acc.id, nextEnabled);
      if (!res.success) {
        notify('error', res.error || 'تعذر تغيير حالة المتابعة');
        return;
      }
      notify(
        'success',
        nextEnabled
          ? `تم تفعيل المتابعة اليدوية لحساب «${acc.name}»`
          : `تم إيقاف المتابعة اليدوية لحساب «${acc.name}»`
      );
      setConfirmDisableManualAccount(null);
      notifyManualBalanceUpdated();
      await loadOverview(true);
    } catch (err: any) {
      notify('error', err?.message || 'تعذر تغيير حالة المتابعة');
    } finally {
      setTogglingManualId(null);
    }
  };

  const handleToggleManualClick = (acc: ManualBalanceAccountOverview) => {
    if (acc.enabled) {
      setConfirmDisableManualAccount(acc);
    } else {
      executeToggleManualEnabled(acc, true);
    }
  };

  const handleConfirmDeleteManualAccount = async () => {
    if (!confirmDeleteManualAccount) return;
    setDeletingManualId(confirmDeleteManualAccount.id);
    try {
      const res = await api.deleteManualBalanceAccount(confirmDeleteManualAccount.id);
      if (!res.success) {
        notify('error', res.error || 'تعذر حذف المتابعة');
        return;
      }
      const deletedId = confirmDeleteManualAccount.id;
      setConfirmDeleteManualAccount(null);
      if (expandedManualLogId === deletedId) setExpandedManualLogId(null);
      notify('success', 'تم حذف المتابعة مع بقاء جميع حركات الخزنة المسجلة');
      notifyManualBalanceUpdated();
      await loadOverview(true);
    } catch (err: any) {
      notify('error', err?.message || 'تعذر حذف المتابعة');
    } finally {
      setDeletingManualId(null);
    }
  };

  const handleMarkAlertReviewed = async (entryId: string) => {
    setReviewingAlertId(entryId);
    try {
      const res = await api.markManualBalanceEntryReviewed(entryId);
      if (!res.success) {
        notify('error', res.error || 'تعذر تسجيل المراجعة');
        return;
      }
      notify('success', 'تم تسجيل مراجعة الفرق وإخفاء التنبيه');
      notifyManualBalanceUpdated();
      await loadOverview(true);
    } catch (err: any) {
      notify('error', err?.message || 'تعذر تسجيل المراجعة');
    } finally {
      setReviewingAlertId(null);
    }
  };

  const executeToggleEnabled = async (acc: BankLinkAccountOverview, nextEnabled: boolean) => {
    setTogglingAccountId(acc.id);
    try {
      const res = await api.setBankLinkAccountEnabled(acc.id, nextEnabled);
      if (!res.success) {
        notify('error', res.error || 'تعذر تغيير حالة الحساب');
        return;
      }
      notify('success', nextEnabled ? `تم تفعيل استقبال الرسائل لحساب «${acc.name}»` : `تم إيقاف استقبال الرسائل لحساب «${acc.name}»`);
      setConfirmDisableAccount(null);
      await loadOverview(true);
    } catch (err: any) {
      notify('error', err?.message || 'تعذر تغيير حالة الحساب');
    } finally {
      setTogglingAccountId(null);
    }
  };

  const handleToggleAccountClick = (acc: BankLinkAccountOverview) => {
    if (acc.enabled) {
      setConfirmDisableAccount(acc);
    } else {
      executeToggleEnabled(acc, true);
    }
  };

  const handleConfirmDeleteAccount = async () => {
    if (!confirmDeleteAccount) return;
    setDeletingAccountId(confirmDeleteAccount.id);
    try {
      const res = await api.deleteBankLinkAccount(confirmDeleteAccount.id);
      if (!res.success) {
        notify('error', res.error || 'تعذر حذف الربط');
        return;
      }
      const deletedId = confirmDeleteAccount.id;
      setConfirmDeleteAccount(null);
      if (selectedAccountId === deletedId) setSelectedAccountId(null);
      notify('success', 'تم حذف الربط مع بقاء جميع حركات الخزنة المسجلة');
      await loadOverview(true);
    } catch (err: any) {
      notify('error', err?.message || 'تعذر حذف الربط');
    } finally {
      setDeletingAccountId(null);
    }
  };

  const handleRegenerateKey = async () => {
    setIsRegeneratingKey(true);
    try {
      const res = await api.regenerateBankLinkIntakeKey();
      if (!res.success) {
        notify('error', res.error || 'تعذر توليد مفتاح جديد');
        return;
      }
      setConfirmRegenKey(false);
      setShowIntakeKey(true);
      notify('success', 'تم توليد مفتاح استقبال جديد — حدّث الإعداد على هاتف الاستقبال');
      await loadOverview(true);
    } catch (err: any) {
      notify('error', err?.message || 'تعذر توليد مفتاح جديد');
    } finally {
      setIsRegeneratingKey(false);
    }
  };

  // Template helpers
  const openNewTemplateEditor = (prefill?: {
    name?: string;
    sender?: string;
    sampleText?: string;
    pattern?: string;
    direction?: BankLinkTemplateDirection;
  }) => {
    setEditingTemplateId(null);
    setTplName(prefill?.name || '');
    setTplSender(prefill?.sender || '*');
    setTplSampleText(prefill?.sampleText || '');
    setTplPattern(prefill?.pattern || '');
    setTplDirection(prefill?.direction || 'auto');
    setTplEnabled(true);
    setTplError(null);
    setTestText(prefill?.sampleText || '');
    setTestSender(prefill?.sender && prefill.sender !== '*' ? prefill.sender : '');
    setTestResult(null);
    setTestError(null);
    setIsTemplateEditorOpen(true);
  };

  const openEditTemplateEditor = (tpl: BankLinkTemplate) => {
    setEditingTemplateId(tpl.id);
    setTplName(tpl.name);
    setTplSender(tpl.sender || '*');
    setTplPattern(tpl.pattern);
    setTplDirection(tpl.direction);
    setTplEnabled(tpl.enabled);
    setTplSampleText('');
    setTplError(null);
    setTestSender(tpl.sender && tpl.sender !== '*' ? tpl.sender : '');
    setTestResult(null);
    setTestError(null);
    setIsTemplateEditorOpen(true);
  };

  const handleSuggestTemplate = async (sampleOverride?: string) => {
    const textToUse = (sampleOverride ?? tplSampleText).trim();
    if (!textToUse) {
      setTplError('الصق نص رسالة حقيقية أولًا ليتم اقتراح القالب');
      return;
    }
    setTplError(null);
    setIsSuggestingTpl(true);
    try {
      const res = await api.suggestBankLinkTemplate({ text: textToUse });
      if (!res.success) {
        setTplError(res.error || 'تعذر اقتراح قالب من النص');
        return;
      }
      setTplPattern(res.pattern || '');
      if (res.direction) setTplDirection(res.direction);
      if (!testText.trim()) setTestText(textToUse);
    } catch (err: any) {
      setTplError(err?.message || 'تعذر اقتراح قالب من النص');
    } finally {
      setIsSuggestingTpl(false);
    }
  };

  const handleDefineTemplateFromUnknown = async (messageId: string, accountName: string) => {
    setLoadingUnknownMsgId(messageId);
    try {
      const msgRes = await api.getBankLinkMessage(messageId);
      if (!msgRes.success || !msgRes.message) {
        notify('error', msgRes.error || 'تعذر جلب نص الرسالة');
        return;
      }
      const { sender, text } = msgRes.message;
      let suggestedPattern = text;
      let suggestedDirection: BankLinkTemplateDirection = 'auto';
      try {
        const sugRes = await api.suggestBankLinkTemplate({ text });
        if (sugRes.success && sugRes.pattern) {
          suggestedPattern = sugRes.pattern;
          suggestedDirection = sugRes.direction || 'auto';
        }
      } catch {
        // نبقي النص الأصلي داخل محرر القالب ليتاح تعديله يدويًا
      }
      openNewTemplateEditor({
        name: `قالب ${accountName}`,
        sender: sender || '*',
        sampleText: text,
        pattern: suggestedPattern,
        direction: suggestedDirection,
      });
    } catch (err: any) {
      notify('error', err?.message || 'تعذر فتح محرر القالب لهذه الرسالة');
    } finally {
      setLoadingUnknownMsgId(null);
    }
  };

  const insertSlotAtCursor = (slotToken: string) => {
    const el = patternTextareaRef.current;
    if (!el) {
      setTplPattern((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${slotToken}`);
      return;
    }
    const start = el.selectionStart ?? tplPattern.length;
    const end = el.selectionEnd ?? tplPattern.length;
    const nextValue = `${tplPattern.slice(0, start)}${slotToken}${tplPattern.slice(end)}`;
    setTplPattern(nextValue);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + slotToken.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const handleTestTemplate = async () => {
    setTestError(null);
    setTestResult(null);
    if (!testText.trim()) {
      setTestError('اكتب أو الصق نص رسالة لتجربتها');
      return;
    }
    setIsTestingTpl(true);
    try {
      const res = await api.testBankLinkTemplate({
        text: testText.trim(),
        sender: testSender.trim() || (tplSender !== '*' ? tplSender : ''),
      });
      if (!res.success || !res.reading) {
        setTestError(res.error || 'تعذر تجربة قراءة الرسالة');
        return;
      }
      setTestResult(res.reading);
    } catch (err: any) {
      setTestError(err?.message || 'تعذر تجربة قراءة الرسالة');
    } finally {
      setIsTestingTpl(false);
    }
  };

  const handleSaveTemplate = async () => {
    setTplError(null);
    setIsSavingTpl(true);
    try {
      const res = await api.saveBankLinkTemplate({
        ...(editingTemplateId ? { id: editingTemplateId } : {}),
        name: tplName.trim(),
        sender: tplSender.trim() || '*',
        pattern: tplPattern.trim(),
        direction: tplDirection,
        enabled: tplEnabled,
      });
      if (!res.success) {
        setTplError(res.error || 'تعذر حفظ القالب');
        return;
      }
      notify('success', editingTemplateId ? 'تم تحديث القالب وإعادة مطابقة الرسائل' : 'تم حفظ القالب الجديد وإعادة مطابقة الرسائل');
      setIsTemplateEditorOpen(false);
      await loadOverview(true);
    } catch (err: any) {
      setTplError(err?.message || 'تعذر حفظ القالب');
    } finally {
      setIsSavingTpl(false);
    }
  };

  const handleConfirmDeleteTemplate = async () => {
    if (!confirmDeleteTemplate) return;
    setIsDeletingTpl(true);
    try {
      const res = await api.deleteBankLinkTemplate(confirmDeleteTemplate.id);
      if (!res.success) {
        notify('error', res.error || 'تعذر حذف القالب');
        return;
      }
      setConfirmDeleteTemplate(null);
      notify('success', 'تم حذف القالب بنجاح');
      await loadOverview(true);
    } catch (err: any) {
      notify('error', err?.message || 'تعذر حذف القالب');
    } finally {
      setIsDeletingTpl(false);
    }
  };

  const handleExportTemplates = async () => {
    setIsExportingTpls(true);
    try {
      const res = await api.exportBankLinkTemplates();
      if (!res.success) {
        notify('error', res.error || 'تعذر تصدير القوالب');
        return;
      }
      const blob = new Blob([JSON.stringify(res.templates || [], null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bank-link-templates-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify('success', `تم تصدير ${(res.templates || []).length} قالبًا`);
    } catch (err: any) {
      notify('error', err?.message || 'تعذر تصدير القوالب');
    } finally {
      setIsExportingTpls(false);
    }
  };

  const handleImportTemplatesFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIsImportingTpls(true);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.templates) ? parsed.templates : null;
      if (!list) {
        notify('error', 'ملف القوالب غير صالح — يجب أن يحتوي مصفوفة قوالب بصيغة JSON');
        return;
      }
      const res = await api.importBankLinkTemplates({ templates: list });
      if (!res.success) {
        notify('error', res.error || 'تعذر استيراد القوالب');
        return;
      }
      notify('success', `تم استيراد القوالب بنجاح — أُضيف ${res.added} قالب جديد`);
      await loadOverview(true);
    } catch (err: any) {
      notify('error', err?.message || 'تعذر قراءة ملف القوالب');
    } finally {
      setIsImportingTpls(false);
    }
  };

  const renderEntryStateText = (state: BankLinkAccountOverview['entries'][number]['state'], label: string) => {
    if (state === 'matched') {
      return <span className="font-bold text-emerald-700 dark:text-emerald-400">{label}</span>;
    }
    if (state === 'unclassified') {
      return <span className="font-bold text-amber-700 dark:text-amber-400">{label}</span>;
    }
    if (state === 'needs_review') {
      return <span className="font-bold text-rose-700 dark:text-rose-400">{label}</span>;
    }
    return <span className="font-semibold text-[var(--text-secondary)]">{label}</span>;
  };

  return (
    <div id="settings-bank-link-section" className="space-y-6">
      {/* إشعار عام للعمليات */}
      {feedback && (
        <div
          className={`py-2 border-b border-[var(--border-subtle)] text-xs font-bold flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-rose-700 dark:text-rose-400'
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
            aria-label="إغلاق الإشعار"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-black/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loadError && (
        <div className="py-2 border-b border-[var(--border-subtle)] text-rose-700 dark:text-rose-400 text-xs font-bold flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => loadOverview()}
            className="min-h-[44px] px-3 rounded-lg border border-rose-300 hover:bg-rose-50/40 text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* قسم فروق تحتاج مراجعة (أعلى الصفحة للمالك عند وجود فروق من الإدخال اليدوي) */}
      {manualAlerts.length > 0 && (
        <section
          id="bank-link-manual-alerts"
          data-testid="manual-balance-alerts-section"
          className="space-y-3"
        >
          <SectionHeading title={`فروق تحتاج مراجعة (${manualAlerts.length})`} />
          <p className="text-xs text-[var(--text-secondary)]">
            الفرق مسجل بالفعل كحركة على الخزنة. زر تمت المراجعة يخفي التنبيه فقط
          </p>
          <CompactTable ariaLabel="جدول فروق الرصيد التي تحتاج مراجعة">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_NUM_CLASS}>الوقت</th>
                <th>الحساب</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد المُدخل</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>رصيد النظام قبله</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الفرق</th>
                <th>من كتبه</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {manualAlerts.map((alert) => (
                <tr key={alert.id}>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                    {formatDeviceDateTime(alert.at)}
                  </td>
                  <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{alert.accountName}</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>
                    {formatMoney(alert.enteredBalance)}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                    {formatMoney(alert.bookBalanceBefore)}
                  </td>
                  <td
                    className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ${
                      alert.difference >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    <span>{formatSignedManualDiff(alert.difference)}</span>
                    <span className="ms-1.5 font-sans text-[11px] font-semibold">
                      ({alert.difference >= 0 ? 'زيادة غير مسجلة' : 'نقص غير مسجل'})
                    </span>
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>{alert.userName}</td>
                  <td className={COMPACT_TABLE_NUM_CLASS}>
                    <button
                      type="button"
                      data-testid={`manual-alert-review-btn-${alert.id}`}
                      disabled={reviewingAlertId === alert.id}
                      onClick={() => handleMarkAlertReviewed(alert.id)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{reviewingAlertId === alert.id ? 'جاري التسجيل...' : 'تمت المراجعة'}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </CompactTable>
        </section>
      )}

      {/* أ) شريط حالة الهاتف أعلى الصفحة */}
      <section data-testid="bank-link-phone-status" className="space-y-3">
        <SectionHeading
          title="حالة هاتف استقبال الرسائل"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => loadOverview()}
                disabled={isLoading}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs transition cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span>تحديث</span>
              </button>
              <button
                type="button"
                data-testid="bank-link-add-account-btn"
                onClick={openCreateAccountModal}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>ربط خزنة بحساب بنكي</span>
              </button>
            </div>
          }
        />

        {showOfflinePhoneWarning && (
          <div
            data-testid="bank-link-phone-offline-warning"
            role="alert"
            className="py-2 text-rose-700 dark:text-rose-400 text-xs font-bold flex items-center gap-2"
          >
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>هاتف استقبال الرسائل غير متصل — التحويلات لن تُسجَّل تلقائيًا حتى يعود</span>
          </div>
        )}

        {devices.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">
            لم يتصل أي هاتف استقبال رسائل بعد. استخدم بيانات «تجهيز هاتف استقبال الرسائل» أسفل الصفحة لربط التطبيق على الهاتف.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
            {devices.map((dev) => (
              <div
                key={dev.id}
                className="py-2.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs"
              >
                <div className="flex items-center gap-2 font-bold text-[var(--text-primary)]">
                  <Smartphone className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                  <span className="font-mono">{dev.id}</span>
                  <span aria-hidden="true" className="text-[var(--text-secondary)]">·</span>
                  {dev.online ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold">
                      <Wifi className="w-3.5 h-3.5" />
                      <span>متصل</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 font-bold">
                      <WifiOff className="w-3.5 h-3.5" />
                      <span>غير متصل</span>
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--text-secondary)]">
                  <span>
                    آخر ظهور:{' '}
                    <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                      {formatDateTimeCairo(dev.lastSeenAt)}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Battery className="w-3.5 h-3.5" />
                    <span>البطارية:</span>
                    <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                      {dev.battery !== null && dev.battery !== undefined ? `${dev.battery}%` : '—'}
                    </strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ب) الحسابات المربوطة (رسائل الهاتف + الرصيد اليدوي) */}
      <section data-testid="bank-link-accounts-list" className="space-y-4">
        <SectionHeading title={`الحسابات المربوطة (${accounts.length + manualAccounts.length})`} />

        {isLoading && !overview && !manualOverview ? (
          <p className="text-xs text-[var(--text-secondary)] py-4">جاري تحميل الحسابات المربوطة...</p>
        ) : accounts.length === 0 && manualAccounts.length === 0 ? (
          <div className="py-6 border-y border-[var(--border-subtle)] space-y-2">
            <p className="text-xs font-bold text-[var(--text-primary)]">لا توجد خزن مربوطة بحساب بنكي أو محفظة حتى الآن.</p>
            <p className="text-xs text-[var(--text-secondary)]">
              اربط أي خزنة بحساب بنكي أو محفظة إلكترونية أو إنستا باي عبر رسائل الهاتف تلقائيًا أو بوضع إدخال الرصيد يدويًا بدون قراءة رسائل.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-color)] border-y border-[var(--border-color)]">
            {accounts.map((acc) => {
              const gapsSum = acc.gaps.reduce((sum, g) => sum + Number(g.amount || 0), 0);
              const isSelected = selectedAccountId === acc.id;
              return (
                <article
                  key={acc.id}
                  data-testid={`bank-link-account-card-${acc.id}`}
                  className="py-5 space-y-4"
                >
                  {/* السطر العلوي: اسم الحساب والبيانات الأساسية + زر التفعيل الكبير */}
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <h3 className="text-base font-bold text-[var(--text-primary)]">{acc.name}</h3>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                        <span>
                          الخزنة:{' '}
                          <strong className={acc.cashboxMissing ? 'text-rose-700 dark:text-rose-400' : 'text-[var(--text-primary)]'}>
                            {acc.cashboxMissing ? 'خزنة محذوفة / غير موجودة' : acc.cashboxName}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          المرسلون:{' '}
                          <strong className="font-mono text-[var(--text-primary)]">{acc.senders.join('، ')}</strong>
                        </span>
                        {acc.accountSuffix && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              آخر أرقام الحساب:{' '}
                              <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                                ****{acc.accountSuffix}
                              </strong>
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>
                          آخر رسالة:{' '}
                          <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                            {acc.lastMessageAt ? formatDateTimeCairo(acc.lastMessageAt) : 'لم تصل رسائل بعد'}
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* زر كبير واضح مفعّل / موقوف */}
                    <button
                      type="button"
                      data-testid="bank-link-toggle-enabled"
                      disabled={togglingAccountId === acc.id}
                      onClick={() => handleToggleAccountClick(acc)}
                      className={`min-h-[44px] px-5 rounded-lg font-bold text-sm inline-flex items-center gap-2 transition cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                        acc.enabled
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <Power className="w-4 h-4 shrink-0" />
                      <span>{acc.enabled ? 'مفعّل' : 'موقوف'}</span>
                    </button>
                  </div>

                  {/* ثلاثة أرقام بارزة + السطر التوضيحي */}
                  <div
                    data-testid="bank-link-three-metrics"
                    className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-3 border-y border-[var(--border-subtle)]"
                  >
                    <div>
                      <div className="text-xs text-[var(--text-secondary)]">رصيد البنك (من آخر رسالة)</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-[var(--text-primary)] mt-0.5">
                        {formatMoney(acc.bankBalance)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text-secondary)]">معلّق لم تصل رسالته</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400 mt-0.5">
                        {formatMoney(acc.pendingTotal)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text-secondary)]">رصيد الخزنة في النظام</div>
                      <div className="text-lg font-bold font-mono tabular-nums ui-money-sale mt-0.5">
                        {formatMoney(acc.bookBalance)}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)]">
                    رصيد الخزنة = رصيد البنك + المعلّق
                  </p>

                  {/* تحذير الفروق غير المفسَّرة إن وُجدت */}
                  {acc.gaps.length > 0 && (
                    <div
                      data-testid="bank-link-gap-warning"
                      className="py-1.5 text-amber-700 dark:text-amber-400 text-xs font-bold flex flex-wrap items-center gap-2"
                    >
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        يوجد فرق غير مفسَّر (رسالة بنك ناقصة) — العدد:{' '}
                        <span className="font-mono tabular-nums">{acc.gaps.length}</span> · الإجمالي:{' '}
                        <span className="font-mono tabular-nums">{formatMoney(gapsSum)}</span>
                      </span>
                    </div>
                  )}

                  {/* أزرار البطاقة */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid={`bank-link-details-btn-${acc.id}`}
                      onClick={() => {
                        setSelectedAccountId(isSelected ? null : acc.id);
                      }}
                      className={`min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                        isSelected
                          ? 'bg-sky-600 hover:bg-sky-700 text-white'
                          : 'border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)]'
                      }`}
                    >
                      {isSelected ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      <span>التفاصيل</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditAccountModal(acc)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer whitespace-nowrap"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmDeleteAccount(acc)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-rose-300 dark:border-rose-800 hover:bg-rose-50/40 dark:hover:bg-rose-950/30 text-rose-700 dark:text-rose-400 text-xs font-bold transition cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف الربط</span>
                    </button>
                  </div>
                </article>
              );
            })}

            {manualAccounts.map((acc) => {
              const isLogExpanded = expandedManualLogId === acc.id;
              return (
                <article
                  key={acc.id}
                  data-testid={`manual-balance-account-card-${acc.id}`}
                  className="py-5 space-y-4"
                >
                  {/* السطر العلوي: اسم الحساب وشارة رصيد يدوي + زر التفعيل الكبير */}
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-[var(--text-primary)]">{acc.name}</h3>
                        <span
                          data-testid="manual-balance-card-badge"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-sky-400/60 bg-sky-50/50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300 text-[11px] font-bold"
                        >
                          <Wallet className="w-3 h-3" />
                          <span>رصيد يدوي</span>
                        </span>
                        {acc.mandatory && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-[11px] font-bold">
                            <Lock className="w-3 h-3" />
                            <span>إجباري</span>
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                        <span>
                          الخزنة:{' '}
                          <strong className={acc.cashboxMissing ? 'text-rose-700 dark:text-rose-400' : 'text-[var(--text-primary)]'}>
                            {acc.cashboxMissing ? 'خزنة محذوفة / غير موجودة' : acc.cashboxName}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          المسؤولون:{' '}
                          {acc.responsibles.length === 0 ? (
                            <strong className="text-rose-700 dark:text-rose-400">غير محدد</strong>
                          ) : (
                            acc.responsibles.map((resp, idx) => (
                              <React.Fragment key={`${resp.id}-${idx}`}>
                                {idx > 0 && '، '}
                                <strong
                                  className={
                                    resp.missing
                                      ? 'text-rose-700 dark:text-rose-400'
                                      : 'text-[var(--text-primary)]'
                                  }
                                >
                                  {resp.missing ? 'مستخدم محذوف' : resp.name}
                                </strong>
                              </React.Fragment>
                            ))
                          )}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 shrink-0" />
                          <span>الموعد:</span>
                          <strong className="text-[var(--text-primary)]">{formatManualSchedule(acc)}</strong>
                        </span>
                      </div>
                    </div>

                    {/* زر كبير واضح مفعّل / موقوف */}
                    <button
                      type="button"
                      data-testid="manual-balance-toggle-enabled"
                      disabled={togglingManualId === acc.id}
                      onClick={() => handleToggleManualClick(acc)}
                      className={`min-h-[44px] px-5 rounded-lg font-bold text-sm inline-flex items-center gap-2 transition cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                        acc.enabled
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <Power className="w-4 h-4 shrink-0" />
                      <span>{acc.enabled ? 'مفعّل' : 'موقوف'}</span>
                    </button>
                  </div>

                  {/* ثلاثة أرقام بارزة للمتابعة اليدوية */}
                  <div
                    data-testid="manual-balance-three-metrics"
                    className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-3 border-y border-[var(--border-subtle)]"
                  >
                    <div>
                      <div className="text-xs text-[var(--text-secondary)]">آخر رصيد كتبه المسؤول</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-[var(--text-primary)] mt-0.5">
                        {acc.lastBalance !== null ? formatMoney(acc.lastBalance) : 'لم يُدخل بعد'}
                      </div>
                      {acc.lastEntryAt && (
                        <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                          <span className="font-mono tabular-nums">{formatDeviceDateTime(acc.lastEntryAt)}</span>
                          {acc.entries[0]?.userName ? ` · ${acc.entries[0].userName}` : ''}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text-secondary)]">حركات النظام بعده</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-sky-700 dark:text-sky-400 mt-0.5">
                        {acc.sinceLastTotal !== null ? formatSignedManualDiff(acc.sinceLastTotal) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text-secondary)]">رصيد الخزنة في النظام</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
                        {formatMoney(acc.bookBalance)}
                      </div>
                    </div>
                  </div>

                  {/* سطر الموعد القادم وحالة الطلب والفروق غير المراجعة */}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[var(--text-secondary)]">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>الموعد القادم:</span>
                        <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                          {acc.nextDueAt ? formatDeviceDateTime(acc.nextDueAt) : '—'}
                        </strong>
                      </span>

                      {acc.request?.state === 'due' && (
                        <span className="inline-flex items-center gap-1 font-bold text-rose-700 dark:text-rose-400">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>مطلوب الآن</span>
                        </span>
                      )}

                      {acc.request?.state === 'postponed' && (
                        <span className="inline-flex items-center gap-1 font-bold text-amber-700 dark:text-amber-400">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>مؤجل حتى {formatDeviceTime(acc.request.postponedUntil)}</span>
                        </span>
                      )}
                    </div>

                    {acc.unreviewedCount > 0 && (
                      <div className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-bold">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{acc.unreviewedCount} فرق لم يُراجَع</span>
                      </div>
                    )}
                  </div>

                  {/* أزرار البطاقة */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      data-testid={`manual-balance-enter-now-${acc.id}`}
                      disabled={!acc.enabled || acc.cashboxMissing}
                      onClick={() => setInstantBalanceAccount(acc)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      <span>إدخال الرصيد الآن</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditManualAccountModal(acc)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer whitespace-nowrap"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmDeleteManualAccount(acc)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-rose-300 dark:border-rose-800 hover:bg-rose-50/40 dark:hover:bg-rose-950/30 text-rose-700 dark:text-rose-400 text-xs font-bold transition cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف المتابعة</span>
                    </button>

                    <button
                      type="button"
                      data-testid={`manual-balance-log-toggle-${acc.id}`}
                      onClick={() => setExpandedManualLogId(isLogExpanded ? null : acc.id)}
                      className={`min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                        isLogExpanded
                          ? 'bg-sky-600 text-white'
                          : 'border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)]'
                      }`}
                    >
                      {isLogExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      <span>السجل ({acc.entries.length})</span>
                    </button>
                  </div>

                  {/* سجل الإدخالات الموسّع */}
                  {isLogExpanded && (
                    <div
                      data-testid={`manual-balance-log-table-${acc.id}`}
                      className="pt-3 border-t border-[var(--border-subtle)] space-y-2"
                    >
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">
                        سجل إدخالات الرصيد — {acc.name}
                      </h4>
                      <CompactTable ariaLabel={`سجل إدخالات الرصيد لحساب ${acc.name}`}>
                        <thead>
                          <tr>
                            <th className={COMPACT_TABLE_NUM_CLASS}>الوقت</th>
                            <th>المسؤول</th>
                            <th>النوع</th>
                            <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد المُدخل</th>
                            <th className={COMPACT_TABLE_NUM_CLASS}>رصيد النظام قبله</th>
                            <th className={COMPACT_TABLE_NUM_CLASS}>الفرق</th>
                            <th>الحالة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {acc.entries.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="text-center py-5 text-xs text-[var(--text-secondary)]">
                                لم تُسجَّل أي إدخالات رصيد لهذا الحساب بعد.
                              </td>
                            </tr>
                          ) : (
                            acc.entries.map((entry) => {
                              const hasDiff = entry.kind !== 'baseline' && Math.abs(Number(entry.difference || 0)) >= 0.005;
                              return (
                                <tr key={entry.id}>
                                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                                    {formatDeviceDateTime(entry.at)}
                                  </td>
                                  <td className={COMPACT_TABLE_TEXT_CLASS}>{entry.userName}</td>
                                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                                    {MANUAL_ENTRY_KIND_LABELS[entry.kind] || entry.kind}
                                  </td>
                                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>
                                    {formatMoney(entry.enteredBalance)}
                                  </td>
                                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                                    {formatMoney(entry.bookBalanceBefore)}
                                  </td>
                                  <td
                                    className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ${
                                      !hasDiff
                                        ? 'text-[var(--text-secondary)]'
                                        : entry.difference >= 0
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-rose-700 dark:text-rose-400'
                                    }`}
                                  >
                                    {entry.kind === 'baseline'
                                      ? '—'
                                      : hasDiff
                                      ? formatSignedManualDiff(entry.difference)
                                      : '0.00 ج.م'}
                                  </td>
                                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                                    {entry.kind === 'baseline' ? (
                                      <span className="font-semibold text-sky-700 dark:text-sky-400">رصيد البداية</span>
                                    ) : !hasDiff ? (
                                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">متطابق</span>
                                    ) : entry.reviewedAt ? (
                                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">تمت المراجعة</span>
                                    ) : (
                                      <span className="font-bold text-amber-700 dark:text-amber-400">يحتاج مراجعة</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </CompactTable>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ج) تفاصيل الحساب المختار */}
      {selectedAccount && (
        <section data-testid="bank-link-account-details" className="space-y-4">
          <SectionHeading
            title={`تفاصيل الحساب: ${selectedAccount.name}`}
            actions={
              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="أقسام تفاصيل الحساب">
                {(
                  [
                    { id: 'entries', label: `حركات البنك (${selectedAccount.entries.length})` },
                    { id: 'pending', label: `في انتظار رسالة البنك (${selectedAccount.pending.length})` },
                    { id: 'gaps', label: `فروق غير مفسَّرة (${selectedAccount.gaps.length})` },
                    { id: 'unknown', label: `رسائل تحتاج تعريف (${selectedAccount.unknownMessages.length})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={detailTab === tab.id || detailTab === 'all'}
                    onClick={() => setDetailTab(tab.id)}
                    className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                      detailTab === tab.id
                        ? 'bg-sky-600 text-white'
                        : 'border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            }
          />

          {/* 1) حركات البنك */}
          {(detailTab === 'entries' || detailTab === 'all') && (
            <div data-testid="bank-link-detail-entries" className="space-y-2">
              <h4 className="text-xs font-bold text-[var(--text-primary)]">حركات البنك</h4>
              <CompactTable ariaLabel="جدول حركات البنك">
                <thead>
                  <tr>
                    <th className={COMPACT_TABLE_NUM_CLASS}>الوقت</th>
                    <th className={COMPACT_TABLE_NUM_CLASS}>الاتجاه</th>
                    <th className={COMPACT_TABLE_NUM_CLASS}>المبلغ</th>
                    <th className={COMPACT_TABLE_NUM_CLASS}>الرسوم</th>
                    <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد بعدها</th>
                    <th>الطرف الآخر</th>
                    <th>الحالة والمراجعة</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedAccount.entries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-5 text-xs text-[var(--text-secondary)]">
                        لا توجد حركات مسجلة من رسائل البنك بعد.
                      </td>
                    </tr>
                  ) : (
                    selectedAccount.entries.map((entry) => (
                      <tr key={entry.messageId}>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono tabular-nums text-[var(--text-secondary)]`}>
                          {formatDateTimeCairo(entry.at)}
                        </td>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold`}>
                          <span
                            className={
                              entry.direction === 'in'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : entry.direction === 'out'
                                ? 'text-rose-700 dark:text-rose-400'
                                : 'text-[var(--text-secondary)]'
                            }
                          >
                            {ENTRY_DIRECTION_LABELS[entry.direction]}
                          </span>
                        </td>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono tabular-nums font-bold`}>
                          {formatMoney(entry.amount)}
                        </td>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono tabular-nums text-[var(--text-secondary)]`}>
                          {entry.fee > 0 ? formatMoney(entry.fee) : '—'}
                        </td>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono tabular-nums`}>
                          {formatMoney(entry.balanceAfter)}
                        </td>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>
                          {entry.counterparty || '—'}
                        </td>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              {renderEntryStateText(entry.state, entry.stateLabel)}
                              {entry.verifiedBy === 'balance' && (
                                <>
                                  <span aria-hidden="true" className="text-[var(--text-secondary)]">·</span>
                                  <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                    مؤكدة بالرصيد
                                  </span>
                                </>
                              )}
                            </div>
                            {Array.isArray(entry.corrections) && entry.corrections.length > 0 && (
                              <ul className="text-[11px] text-amber-800 dark:text-amber-300 space-y-0.5">
                                {entry.corrections.map((c, idx) => (
                                  <li key={idx}>تصحيح تلقائي: {c}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </CompactTable>
            </div>
          )}

          {/* 2) في انتظار رسالة البنك */}
          {(detailTab === 'pending' || detailTab === 'all') && (
            <div data-testid="bank-link-detail-pending" className="space-y-2">
              <h4 className="text-xs font-bold text-[var(--text-primary)]">في انتظار رسالة البنك</h4>
              <CompactTable ariaLabel="جدول حركات في انتظار رسالة البنك">
                <thead>
                  <tr>
                    <th className={COMPACT_TABLE_NUM_CLASS}>الوقت</th>
                    <th className={COMPACT_TABLE_NUM_CLASS}>المبلغ</th>
                    <th>البيان</th>
                    <th className={COMPACT_TABLE_NUM_CLASS}>المستند</th>
                    <th>المستخدم</th>
                    <th className={COMPACT_TABLE_NUM_CLASS}>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedAccount.pending.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-5 text-xs text-[var(--text-secondary)]">
                        لا توجد حركات معلّقة في انتظار رسالة البنك.
                      </td>
                    </tr>
                  ) : (
                    selectedAccount.pending.map((item) => (
                      <tr key={item.id}>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono tabular-nums text-[var(--text-secondary)]`}>
                          {formatDateTimeCairo(item.date)}
                        </td>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono tabular-nums font-bold`}>
                          {formatMoney(item.amount)}
                        </td>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>{item.statement || '—'}</td>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono tabular-nums`}>
                          {item.documentNumber || '—'}
                        </td>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>{item.userName || '—'}</td>
                        <td className={COMPACT_TABLE_NUM_CLASS}>
                          {item.overdue ? (
                            <span className="font-bold text-rose-700 dark:text-rose-400">لم يصل التحويل</span>
                          ) : (
                            <span className="text-[var(--text-secondary)] font-semibold">قيد الانتظار</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </CompactTable>
            </div>
          )}

          {/* 3) فروق غير مفسَّرة */}
          {(detailTab === 'gaps' || detailTab === 'all') && (
            <div data-testid="bank-link-detail-gaps" className="space-y-2">
              <h4 className="text-xs font-bold text-[var(--text-primary)]">فروق غير مفسَّرة</h4>
              <CompactTable ariaLabel="جدول الفروق غير المفسرة">
                <thead>
                  <tr>
                    <th className={COMPACT_TABLE_NUM_CLASS}>الوقت</th>
                    <th className={COMPACT_TABLE_NUM_CLASS}>المبلغ</th>
                    <th>التوضيح</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedAccount.gaps.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center py-5 text-xs text-[var(--text-secondary)]">
                        لا توجد فروق غير مفسَّرة — سجل الرسائل متسق تمامًا مع الرصيد.
                      </td>
                    </tr>
                  ) : (
                    selectedAccount.gaps.map((gap, idx) => (
                      <tr key={`${gap.beforeMessageId}-${idx}`}>
                        <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono tabular-nums text-[var(--text-secondary)]`}>
                          {formatDateTimeCairo(gap.at)}
                        </td>
                        <td
                          className={`${COMPACT_TABLE_NUM_CLASS} font-mono tabular-nums font-bold ${
                            gap.amount >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {gap.amount > 0 ? '+' : ''}
                          {formatMoney(gap.amount)}
                        </td>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>
                          {gap.amount >= 0 ? 'دخل غير مسجل (رسالة بنك ناقصة)' : 'خرج غير مسجل (رسالة بنك ناقصة)'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </CompactTable>
            </div>
          )}

          {/* 4) رسائل تحتاج تعريف */}
          {(detailTab === 'unknown' || detailTab === 'all') && (
            <div data-testid="bank-link-detail-unknown" className="space-y-2">
              <h4 className="text-xs font-bold text-[var(--text-primary)]">رسائل تحتاج تعريف</h4>
              <CompactTable ariaLabel="جدول الرسائل التي تحتاج تعريف">
                <thead>
                  <tr>
                    <th>سبب عدم الفهم</th>
                    {canManageTemplates && <th className={COMPACT_TABLE_NUM_CLASS}>إجراء</th>}
                  </tr>
                </thead>
                <tbody>
                  {selectedAccount.unknownMessages.length === 0 ? (
                    <tr>
                      <td colSpan={canManageTemplates ? 2 : 1} className="text-center py-5 text-xs text-[var(--text-secondary)]">
                        لا توجد رسائل غير مفهومة لهذا الحساب.
                      </td>
                    </tr>
                  ) : (
                    selectedAccount.unknownMessages.map((msg) => (
                      <tr key={msg.messageId}>
                        <td className={COMPACT_TABLE_TEXT_CLASS}>{msg.note || 'لم يتم التعرف على تفاصيل الحركة تلقائيًا'}</td>
                        {canManageTemplates && (
                          <td className={COMPACT_TABLE_NUM_CLASS}>
                            <button
                              type="button"
                              disabled={loadingUnknownMsgId === msg.messageId}
                              onClick={() => handleDefineTemplateFromUnknown(msg.messageId, selectedAccount.name)}
                              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                            >
                              <FileCode2 className="w-3.5 h-3.5" />
                              <span>{loadingUnknownMsgId === msg.messageId ? 'جاري التحميل...' : 'عرّف قالبًا'}</span>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </CompactTable>
            </div>
          )}
        </section>
      )}

      {/* هـ) صندوق تجهيز هاتف استقبال الرسائل */}
      <section data-testid="bank-link-phone-setup" className="space-y-4">
        <SectionHeading title="تجهيز هاتف استقبال الرسائل" />

        <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)] text-xs">
          {/* رابط الاستقبال */}
          <div className="py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <div className="font-bold text-[var(--text-primary)]">رابط استقبال الرسائل</div>
              <div className="font-mono text-[var(--text-secondary)] break-all" dir="ltr">
                {fullIntakeUrl}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopy('intakeUrl', fullIntakeUrl)}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs cursor-pointer whitespace-nowrap"
            >
              {copiedField === 'intakeUrl' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedField === 'intakeUrl' ? 'تم النسخ' : 'نسخ'}</span>
            </button>
          </div>

          {/* رابط النبضة */}
          <div className="py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <div className="font-bold text-[var(--text-primary)]">رابط نبضة حالة الهاتف</div>
              <div className="font-mono text-[var(--text-secondary)] break-all" dir="ltr">
                {fullHeartbeatUrl}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopy('heartbeatUrl', fullHeartbeatUrl)}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs cursor-pointer whitespace-nowrap"
            >
              {copiedField === 'heartbeatUrl' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedField === 'heartbeatUrl' ? 'تم النسخ' : 'نسخ'}</span>
            </button>
          </div>

          {/* مفتاح الاستقبال (مخفي افتراضيًا) */}
          <div className="py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <div className="font-bold text-[var(--text-primary)]">مفتاح الاستقبال</div>
              <div
                data-testid="bank-link-intake-key-value"
                className="font-mono text-[var(--text-primary)] break-all"
                dir="ltr"
              >
                {showIntakeKey ? intakeKey || '—' : '••••••••••••••••••••••••'}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowIntakeKey((prev) => !prev)}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs cursor-pointer whitespace-nowrap"
              >
                {showIntakeKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showIntakeKey ? 'إخفاء' : 'إظهار'}</span>
              </button>

              <button
                type="button"
                disabled={!intakeKey}
                onClick={() => handleCopy('intakeKey', intakeKey)}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {copiedField === 'intakeKey' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'intakeKey' ? 'تم النسخ' : 'نسخ'}</span>
              </button>

              <button
                type="button"
                onClick={() => setConfirmRegenKey(true)}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-amber-400/70 hover:bg-amber-50/40 dark:hover:bg-amber-950/30 text-amber-800 dark:text-amber-300 font-bold text-xs cursor-pointer whitespace-nowrap"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>توليد مفتاح جديد</span>
              </button>
            </div>
          </div>
        </div>

        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          الهاتف يرسل لكل رسالة: <span className="font-mono font-bold text-[var(--text-primary)]">sender</span> (اسم المرسل)،{' '}
          <span className="font-mono font-bold text-[var(--text-primary)]">text</span> (نص الرسالة)،{' '}
          <span className="font-mono font-bold text-[var(--text-primary)]">at</span> (وقت الرسالة)، والمفتاح في الترويسة{' '}
          <span className="font-mono font-bold text-[var(--text-primary)]">x-intake-key</span> أو في الرابط{' '}
          <span className="font-mono font-bold text-[var(--text-primary)]">?key=</span>. الرسائل من مرسلين غير مربوطين لا يُحفظ نصها.
        </p>
      </section>

      {/* الخطوة 3: قسم قوالب الرسائل (يظهر فقط لمن معه settings.bank_templates) */}
      {canManageTemplates && (
        <section data-testid="bank-link-templates-section" className="space-y-4">
          <SectionHeading
            title={`قوالب الرسائل (${templates.length})`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openNewTemplateEditor()}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>قالب جديد</span>
                </button>

                <button
                  type="button"
                  disabled={isExportingTpls}
                  onClick={handleExportTemplates}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تصدير القوالب</span>
                </button>

                <button
                  type="button"
                  disabled={isImportingTpls}
                  onClick={() => importFileInputRef.current?.click()}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>استيراد قوالب</span>
                </button>
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportTemplatesFile}
                  className="hidden"
                />
              </div>
            }
          />

          {/* أ) جدول القوالب */}
          <CompactTable ariaLabel="جدول قوالب الرسائل">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>المرسل</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>النوع</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>مفعّل</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-5 text-xs text-[var(--text-secondary)]">
                    لا توجد قوالب مخصصة بعد — يعتمد النظام على القراءة التلقائية حتى تضيف قالبًا.
                  </td>
                </tr>
              ) : (
                templates.map((tpl) => (
                  <tr key={tpl.id}>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{tpl.name}</td>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-mono`}>
                      {tpl.sender === '*' ? '* (كل المرسلين)' : tpl.sender}
                    </td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>{DIRECTION_LABELS[tpl.direction] || tpl.direction}</td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>
                      <span className={tpl.enabled ? 'text-emerald-700 dark:text-emerald-400 font-bold' : 'text-[var(--text-secondary)]'}>
                        {tpl.enabled ? 'مفعّل' : 'موقوف'}
                      </span>
                    </td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditTemplateEditor(tpl)}
                          className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer whitespace-nowrap"
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteTemplate(tpl)}
                          className="min-h-[44px] px-3 rounded-lg border border-rose-300 dark:border-rose-800 hover:bg-rose-50/40 dark:hover:bg-rose-950/30 text-rose-700 dark:text-rose-400 text-xs font-bold cursor-pointer whitespace-nowrap"
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </CompactTable>

          {/* ب) محرر القالب */}
          {isTemplateEditorOpen && (
            <div
              data-testid="bank-link-template-editor"
              className="pt-4 border-t border-[var(--border-color)] space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-[var(--text-primary)]">
                  {editingTemplateId ? 'تعديل قالب رسالة' : 'محرر قالب رسالة جديد'}
                </h4>
                <button
                  type="button"
                  onClick={() => setIsTemplateEditorOpen(false)}
                  className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
                >
                  إغلاق المحرر
                </button>
              </div>

              {tplError && (
                <div className="p-3 rounded-lg border border-rose-300 bg-rose-50/40 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 text-xs font-bold">
                  {tplError}
                </div>
              )}

              {/* لصق رسالة حقيقية + اقترح قالبًا */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[var(--text-primary)]">
                  الصق رسالة حقيقية
                </label>
                <div className="flex flex-wrap items-start gap-2">
                  <textarea
                    rows={3}
                    dir="auto"
                    value={tplSampleText}
                    onChange={(e) => setTplSampleText(e.target.value)}
                    placeholder="مثال: تم إيداع مبلغ 500.00 ج.م في حسابك رقم ****1234 بتاريخ 19/11/2026 الرصيد المتاح 2,500.00 ج.م"
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs py-2.5`}
                  />
                  <button
                    type="button"
                    disabled={isSuggestingTpl}
                    onClick={() => handleSuggestTemplate()}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isSuggestingTpl ? 'جاري الاقتراح...' : 'اقترح قالبًا'}</span>
                  </button>
                </div>
              </div>

              {/* بيانات القالب الأساسية */}
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">اسم القالب</label>
                  <input
                    type="text"
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    placeholder="مثال: إيداع البنك الأهلي"
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
                    المرسل (* لكل المرسلين)
                  </label>
                  <input
                    type="text"
                    dir="auto"
                    value={tplSender}
                    onChange={(e) => setTplSender(e.target.value)}
                    placeholder="*"
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">النوع</label>
                  <select
                    value={tplDirection}
                    onChange={(e) => setTplDirection(e.target.value as BankLinkTemplateDirection)}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} text-xs font-bold`}
                  >
                    <option value="auto">تلقائي</option>
                    <option value="in">داخل</option>
                    <option value="out">خارج</option>
                    <option value="ignore">تُتجاهل</option>
                  </select>
                </div>

                <label className="min-h-[44px] inline-flex items-center gap-2 text-xs font-bold text-[var(--text-primary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tplEnabled}
                    onChange={(e) => setTplEnabled(e.target.checked)}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <span>مفعّل</span>
                </label>
              </div>

              {/* أزرار الخانات السبع + نص القالب */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[var(--text-primary)]">نص القالب</label>
                <div
                  data-testid="bank-link-template-slots"
                  className="flex flex-wrap items-center gap-1.5"
                >
                  {TEMPLATE_SLOT_BUTTONS.map((slot) => (
                    <button
                      key={slot.token}
                      type="button"
                      onClick={() => insertSlotAtCursor(slot.token)}
                      className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-mono font-bold text-xs transition cursor-pointer whitespace-nowrap"
                    >
                      {slot.label}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={patternTextareaRef}
                  rows={4}
                  dir="auto"
                  value={tplPattern}
                  onChange={(e) => setTplPattern(e.target.value)}
                  placeholder="مثال: تم إيداع مبلغ {المبلغ} ج.م في حسابك رقم ****{الحساب} {تجاهل} الرصيد المتاح {الرصيد} ج.م"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs font-mono py-2.5`}
                />
                <p className="text-xs text-[var(--text-secondary)]">
                  الخانتان الأساسيتان: {'{المبلغ}'} و{'{الرصيد}'}. استخدم {'{تجاهل}'} لأي جزء متغير غير مهم مثل التاريخ
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isSavingTpl}
                  onClick={handleSaveTemplate}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>{isSavingTpl ? 'جاري الحفظ...' : editingTemplateId ? 'حفظ التعديلات' : 'حفظ القالب'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsTemplateEditorOpen(false)}
                  className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs transition cursor-pointer"
                >
                  إلغاء
                </button>
              </div>

              {/* صندوق تجربة القراءة */}
              <div data-testid="bank-link-template-test" className="pt-4 border-t border-[var(--border-subtle)] space-y-3">
                <h5 className="text-xs font-bold text-[var(--text-primary)]">تجربة قراءة رسالة بالقوالب الحالية</h5>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">نص الرسالة للتجربة</label>
                    <textarea
                      rows={2}
                      dir="auto"
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      placeholder="الصق نص رسالة هنا لتجربة قراءتها..."
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs py-2`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">المرسل</label>
                    <input
                      type="text"
                      dir="auto"
                      value={testSender}
                      onChange={(e) => setTestSender(e.target.value)}
                      placeholder="مثال: NBE"
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={isTestingTpl}
                    onClick={handleTestTemplate}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs transition cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{isTestingTpl ? 'جاري التجربة...' : 'تجربة'}</span>
                  </button>
                </div>

                {testError && (
                  <div className="text-xs font-bold text-rose-700 dark:text-rose-400">{testError}</div>
                )}

                {testResult && (
                  <div className="py-3 border-y border-[var(--border-subtle)] text-xs space-y-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-semibold">
                      <span>
                        مصدر القراءة:{' '}
                        <strong className="text-sky-700 dark:text-sky-400">
                          {testResult.readBy === 'template' ? 'قُرئت بالقالب' : 'قُرئت تلقائيًا'}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        النتيجة:{' '}
                        <strong className="text-[var(--text-primary)]">
                          {testResult.kind === 'transaction'
                            ? 'حركة مالية'
                            : testResult.kind === 'ignored'
                            ? 'رسالة تُتجاهل'
                            : 'غير مفهومة'}
                        </strong>
                      </span>
                    </div>

                    {testResult.kind === 'transaction' ? (
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[var(--text-secondary)]">
                        <span>
                          الاتجاه:{' '}
                          <strong className="text-[var(--text-primary)]">
                            {ENTRY_DIRECTION_LABELS[testResult.direction]}
                          </strong>
                        </span>
                        <span>
                          المبلغ:{' '}
                          <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                            {formatMoney(testResult.amount)}
                          </strong>
                        </span>
                        <span>
                          الرصيد:{' '}
                          <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                            {formatMoney(testResult.balance)}
                          </strong>
                        </span>
                        {testResult.fee !== undefined && testResult.fee > 0 && (
                          <span>
                            الرسوم:{' '}
                            <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                              {formatMoney(testResult.fee)}
                            </strong>
                          </span>
                        )}
                        <span>
                          آخر أرقام الحساب:{' '}
                          <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                            {testResult.accountSuffix || '—'}
                          </strong>
                        </span>
                        <span>
                          الطرف الآخر:{' '}
                          <strong className="text-[var(--text-primary)]">
                            {testResult.counterparty || '—'}
                          </strong>
                        </span>
                      </div>
                    ) : (
                      <div className="text-[var(--text-secondary)]">{testResult.note || '—'}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* د) نموذج إضافة / تعديل حساب مربوط (رسائل الهاتف أو إدخال الرصيد يدويًا) */}
      {isAccountModalOpen && (
        <ModalShell
          title={
            editingAccountId
              ? 'تعديل حساب مربوط برسائل البنك'
              : editingManualAccountId
              ? 'تعديل متابعة إدخال الرصيد يدويًا'
              : 'ربط خزنة بحساب بنكي / محفظة'
          }
          subtitle={
            accountMethod === 'manual'
              ? 'حدّد الخزنة والمسؤول عن إدخال الرصيد والموعد — بدون قراءة أي رسائل من الهاتف.'
              : 'حدّد الخزنة والمرسلين الذين تصل منهم رسائل هذا الحساب.'
          }
          onClose={() => !isSavingAccount && setIsAccountModalOpen(false)}
          onSave={handleSaveAccount}
          saveDisabled={isSavingAccount}
          closeDisabled={isSavingAccount}
          footer={
            <>
              <button
                type="button"
                disabled={isSavingAccount}
                onClick={() => setIsAccountModalOpen(false)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSavingAccount}
                onClick={handleSaveAccount}
                className="min-h-[44px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
              >
                {isSavingAccount
                  ? 'جاري الحفظ...'
                  : editingAccountId || editingManualAccountId
                  ? 'حفظ التعديلات'
                  : accountMethod === 'manual'
                  ? 'حفظ المتابعة'
                  : 'حفظ الربط'}
              </button>
            </>
          }
        >
          <div data-testid="bank-link-account-form" className="space-y-4">
            {accFormError && (
              <div className="p-3 rounded-lg border border-rose-300 bg-rose-50/40 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 text-xs font-bold">
                {accFormError}
              </div>
            )}

            {/* اختيار طريقة المتابعة عند الإضافة فقط */}
            {!editingAccountId && !editingManualAccountId && (
              <div data-testid="bank-link-method-selector" className="space-y-2 pb-3 border-b border-[var(--border-subtle)]">
                <label className="block text-xs font-bold text-[var(--text-primary)]">طريقة المتابعة</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    data-testid="bank-link-method-sms"
                    onClick={() => {
                      setAccountMethod('sms');
                      setAccFormError(null);
                    }}
                    className={`min-h-[44px] p-3 rounded-lg border text-right transition cursor-pointer ${
                      accountMethod === 'sms'
                        ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/30 text-[var(--text-primary)]'
                        : 'border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-secondary)]'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)]">
                      <Smartphone className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>رسائل الهاتف (تلقائي)</span>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                      قراءة رسائل البنك والمحفظة تلقائيًا من هاتف الاستقبال ومطابقتها مع الخزنة.
                    </p>
                  </button>

                  <button
                    type="button"
                    data-testid="bank-link-method-manual"
                    onClick={() => {
                      setAccountMethod('manual');
                      setAccFormError(null);
                    }}
                    className={`min-h-[44px] p-3 rounded-lg border text-right transition cursor-pointer ${
                      accountMethod === 'manual'
                        ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/30 text-[var(--text-primary)]'
                        : 'border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-secondary)]'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)]">
                      <Wallet className="w-4 h-4 text-sky-600 shrink-0" />
                      <span>إدخال الرصيد يدويًا (بدون قراءة رسائل)</span>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                      يطلب البرنامج من المسؤول كتابة رصيد الحساب في موعد محدد ويُسجّل أي فرق تلقائيًا.
                    </p>
                  </button>
                </div>
              </div>
            )}

            {accountMethod === 'manual' ? (
              <div data-testid="manual-balance-account-form" className="space-y-4">
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  بديل الخصوصية لمن لا يريد قراءة رسائل الهاتف: يطلب النظام من المسؤول إدخال رصيد الحساب الحالي في الموعد المحدد، ويُسجّل أي فرق فورًا كحركة على الخزنة.
                </p>

                <div>
                  <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">اسم الحساب</label>
                  <input
                    type="text"
                    value={manName}
                    onChange={(e) => setManName(e.target.value)}
                    placeholder="مثال: حساب البنك الأهلي أو محفظة إنستا باي"
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الخزنة في النظام</label>
                  <select
                    value={manCashboxId}
                    onChange={(e) => setManCashboxId(e.target.value)}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-bold`}
                  >
                    <option value="">اختر خزنة...</option>
                    {cashboxes.map((cb) => {
                      const linkedSms = accounts.find((a) => a.cashboxId === cb.id);
                      const linkedManualOther = manualAccounts.find(
                        (a) => a.cashboxId === cb.id && a.id !== editingManualAccountId
                      );
                      const isDisabled = Boolean(linkedSms || linkedManualOther);
                      const reason = linkedSms
                        ? ` (مربوطة برسائل البنك في «${linkedSms.name}»)`
                        : linkedManualOther
                        ? ` (متابَعة برصيد يدوي في «${linkedManualOther.name}»)`
                        : '';
                      return (
                        <option key={cb.id} value={cb.id} disabled={isDisabled}>
                          {cb.name}
                          {reason}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* المسؤولون عن إدخال الرصيد */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[var(--text-primary)]">
                    المسؤولون عن إدخال الرصيد
                  </label>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    سيظهر طلب إدخال الرصيد لهؤلاء المستخدمين فقط، ولن يظهر للكاشير.
                  </p>
                  {manualUsers.length === 0 ? (
                    <p className="text-xs text-rose-700 dark:text-rose-400">لا يوجد مستخدمون نشطون للاختيار منهم.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {manualUsers.map((u) => {
                        const checked = manResponsibleIds.includes(u.id);
                        return (
                          <label
                            key={u.id}
                            className={`min-h-[44px] inline-flex items-center gap-2 px-3.5 rounded-lg border text-xs font-bold cursor-pointer transition ${
                              checked
                                ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/30 text-[var(--text-primary)]'
                                : 'border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-secondary)]'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleManualResponsible(u.id)}
                              className="w-4 h-4 accent-emerald-600"
                            />
                            <span>{u.name}</span>
                            {u.username && (
                              <span className="font-mono text-[11px] text-[var(--text-secondary)]">({u.username})</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* الموعد */}
                <div className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
                  <label className="block text-xs font-bold text-[var(--text-primary)]">موعد طلب الرصيد</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setManScheduleType('daily')}
                      className={`min-h-[44px] px-4 rounded-lg text-xs font-bold transition cursor-pointer ${
                        manScheduleType === 'daily'
                          ? 'bg-sky-600 text-white'
                          : 'border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)]'
                      }`}
                    >
                      كل يوم
                    </button>
                    <button
                      type="button"
                      onClick={() => setManScheduleType('weekdays')}
                      className={`min-h-[44px] px-4 rounded-lg text-xs font-bold transition cursor-pointer ${
                        manScheduleType === 'weekdays'
                          ? 'bg-sky-600 text-white'
                          : 'border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)]'
                      }`}
                    >
                      أيام معينة في الأسبوع
                    </button>
                  </div>

                  {manScheduleType === 'weekdays' && (
                    <div data-testid="manual-balance-weekdays" className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-[var(--text-secondary)]">اختر أيام الأسبوع:</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {MANUAL_WEEKDAY_OPTIONS.map((day) => {
                          const selected = manWeekdays.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              data-testid={`manual-weekday-${day.value}`}
                              aria-pressed={selected}
                              onClick={() => toggleManualWeekday(day.value)}
                              className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                                selected
                                  ? 'bg-emerald-600 text-white'
                                  : 'border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)]'
                              }`}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
                      الوقت (نظام 24 ساعة)
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="time"
                        value={manTime}
                        onChange={(e) => setManTime(e.target.value)}
                        className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} text-xs font-mono tabular-nums`}
                      />
                      <span className="text-xs font-semibold text-[var(--text-secondary)]">بتوقيت القاهرة</span>
                    </div>
                  </div>
                </div>

                {/* خيار إجباري */}
                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
                  <label
                    data-testid="manual-balance-mandatory-toggle"
                    className="min-h-[44px] inline-flex items-center gap-2.5 text-xs font-bold text-[var(--text-primary)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={manMandatory}
                      onChange={(e) => setManMandatory(e.target.checked)}
                      className="w-4 h-4 accent-emerald-600"
                    />
                    <span>إجباري (إيقاف الشاشة حتى يُدخل المسؤول الرصيد أو يؤجله ساعة)</span>
                  </label>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    عند إلغاء «إجباري» يمكن للمسؤول اختيار «لاحقًا» وإدخال الرصيد في أي وقت لاحقًا من الشريط العلوي.
                  </p>
                </div>

                {/* ملاحظة ثابتة أسفل النموذج */}
                <div className="p-3 rounded-lg border border-sky-400/50 bg-sky-50/40 dark:bg-sky-950/20 text-xs text-[var(--text-primary)] font-semibold">
                  بعد الحفظ سيُطلب من المسؤول أول رصيد فورًا ليبدأ رصيد الخزنة منه
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">اسم الحساب المربوط</label>
                  <input
                    type="text"
                    value={accName}
                    onChange={(e) => setAccName(e.target.value)}
                    placeholder="مثال: حساب البنك الأهلي الرئيسي أو فودافون كاش"
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الخزنة في النظام</label>
                  <select
                    value={accCashboxId}
                    onChange={(e) => setAccCashboxId(e.target.value)}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-bold`}
                  >
                    <option value="">اختر خزنة...</option>
                    {cashboxes.map((cb) => {
                      const linkedOther = accounts.find((a) => a.cashboxId === cb.id && a.id !== editingAccountId);
                      const linkedManual = manualAccounts.find((a) => a.cashboxId === cb.id);
                      const isDisabled = Boolean(linkedOther || linkedManual);
                      const reason = linkedOther
                        ? ` (مربوطة بحساب «${linkedOther.name}»)`
                        : linkedManual
                        ? ` (متابَعة برصيد يدوي في «${linkedManual.name}»)`
                        : '';
                      return (
                        <option key={cb.id} value={cb.id} disabled={isDisabled}>
                          {cb.name}
                          {reason}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* المرسلون (شرائح متعددة) */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[var(--text-primary)]">
                    المرسلون (اسم البنك في الرسائل أو اسم حزمة التطبيق)
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      dir="auto"
                      value={accSenderDraft}
                      onChange={(e) => setAccSenderDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSenderChip(accSenderDraft);
                        }
                      }}
                      placeholder="مثال: NBE أو VF-Cash أو InstaPay"
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => addSenderChip(accSenderDraft)}
                      className="min-h-[44px] inline-flex items-center gap-1 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>إضافة مرسل</span>
                    </button>
                  </div>

                  {accSenders.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {accSenders.map((sender) => (
                        <button
                          key={sender}
                          type="button"
                          onClick={() => removeSenderChip(sender)}
                          title="اضغط لإزالة المرسل"
                          className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border border-[var(--border-color)] hover:border-rose-400 text-xs font-mono font-bold text-[var(--text-primary)] cursor-pointer"
                        >
                          <span>{sender}</span>
                          <X className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* مرسلون وصلت منهم رسائل ولم يُربطوا */}
                  {unknownSenders.length > 0 && (
                    <div className="pt-2 space-y-1.5">
                      <div className="text-[11px] font-bold text-[var(--text-secondary)]">
                        مرسلون وصلت منهم رسائل ولم يُربطوا (اضغط للإضافة):
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {unknownSenders.map((u) => (
                          <button
                            key={u.sender}
                            type="button"
                            onClick={() => addSenderChip(u.sender)}
                            className="min-h-[44px] inline-flex items-center gap-2 px-3 rounded-lg border border-sky-400/60 hover:bg-sky-50/40 dark:hover:bg-sky-950/30 text-xs text-[var(--text-primary)] cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 text-sky-600" />
                            <span className="font-mono font-bold">{u.sender}</span>
                            <span className="text-[11px] text-[var(--text-secondary)]">
                              ({u.count} · {formatDateTimeCairo(u.lastAt)})
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-start gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
                      آخر أرقام الحساب (اختياري)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={8}
                      value={accSuffix}
                      onChange={(e) => setAccSuffix(e.target.value.replace(/\D/g, ''))}
                      placeholder="مثال: 1234"
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono tabular-nums`}
                    />
                    <p className="text-[11px] text-[var(--text-secondary)] mt-1 max-w-[260px]">
                      مطلوب لو نفس البنك يرسل لأكثر من حساب عندك
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
                      مهلة المطابقة بالدقائق
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={accMatchWindow}
                      onChange={(e) => setAccMatchWindow(e.target.value)}
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs font-mono tabular-nums`}
                    />
                    <p className="text-[11px] text-[var(--text-secondary)] mt-1 max-w-[280px]">
                      أقصى فرق زمني بين تسجيل الحركة في النظام ووصول رسالة البنك لتُعتبرا حركة واحدة
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </ModalShell>
      )}

      {/* تأكيد إيقاف الحساب */}
      {confirmDisableAccount && (
        <ModalShell
          title="تأكيد إيقاف استقبال الرسائل"
          onClose={() => setConfirmDisableAccount(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmDisableAccount(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={togglingAccountId === confirmDisableAccount.id}
                onClick={() => executeToggleEnabled(confirmDisableAccount, false)}
                className="min-h-[44px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                تأكيد الإيقاف
              </button>
            </>
          }
        >
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">
            هل تريد إيقاف استقبال رسائل الحساب «<strong>{confirmDisableAccount.name}</strong>»؟
            لن تُسجَّل أي تحويلات تلقائيًا من رسائل البنك لهذا الحساب حتى تعيد تفعيله.
          </p>
        </ModalShell>
      )}

      {/* تأكيد حذف الربط */}
      {confirmDeleteAccount && (
        <ModalShell
          title="تأكيد حذف الربط"
          onClose={() => setConfirmDeleteAccount(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmDeleteAccount(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={deletingAccountId === confirmDeleteAccount.id}
                onClick={handleConfirmDeleteAccount}
                className="min-h-[44px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {deletingAccountId === confirmDeleteAccount.id ? 'جاري الحذف...' : 'حذف الربط'}
              </button>
            </>
          }
        >
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">
            سيُحذف الربط فقط، وحركات الخزنة المسجلة تبقى.
          </p>
        </ModalShell>
      )}

      {/* تأكيد توليد مفتاح جديد */}
      {confirmRegenKey && (
        <ModalShell
          title="تأكيد توليد مفتاح استقبال جديد"
          onClose={() => setConfirmRegenKey(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmRegenKey(false)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isRegeneratingKey}
                onClick={handleRegenerateKey}
                className="min-h-[44px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isRegeneratingKey ? 'جاري التوليد...' : 'توليد مفتاح جديد'}
              </button>
            </>
          }
        >
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">
            المفتاح الحالي سيتوقف وسيحتاج الهاتف المفتاح الجديد.
          </p>
        </ModalShell>
      )}

      {/* تأكيد حذف قالب */}
      {confirmDeleteTemplate && (
        <ModalShell
          title="تأكيد حذف القالب"
          onClose={() => setConfirmDeleteTemplate(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmDeleteTemplate(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isDeletingTpl}
                onClick={handleConfirmDeleteTemplate}
                className="min-h-[44px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isDeletingTpl ? 'جاري الحذف...' : 'تأكيد الحذف'}
              </button>
            </>
          }
        >
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">
            هل تريد حذف القالب «<strong>{confirmDeleteTemplate.name}</strong>»؟ سيتم إعادة مطابقة الرسائل حسب القراءة التلقائية والقوالب المتبقية.
          </p>
        </ModalShell>
      )}

      {/* تأكيد إيقاف المتابعة اليدوية */}
      {confirmDisableManualAccount && (
        <ModalShell
          title="تأكيد إيقاف المتابعة اليدوية"
          onClose={() => setConfirmDisableManualAccount(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmDisableManualAccount(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={togglingManualId === confirmDisableManualAccount.id}
                onClick={() => executeToggleManualEnabled(confirmDisableManualAccount, false)}
                className="min-h-[44px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                تأكيد الإيقاف
              </button>
            </>
          }
        >
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">
            هل تريد إيقاف متابعة إدخال الرصيد يدويًا لحساب «<strong>{confirmDisableManualAccount.name}</strong>»؟
            لن يُطلب إدخال الرصيد من المسؤول حتى تعيد التفعيل.
          </p>
        </ModalShell>
      )}

      {/* تأكيد حذف المتابعة اليدوية */}
      {confirmDeleteManualAccount && (
        <ModalShell
          title="تأكيد حذف المتابعة"
          onClose={() => setConfirmDeleteManualAccount(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmDeleteManualAccount(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={deletingManualId === confirmDeleteManualAccount.id}
                onClick={handleConfirmDeleteManualAccount}
                className="min-h-[44px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {deletingManualId === confirmDeleteManualAccount.id ? 'جاري الحذف...' : 'حذف المتابعة'}
              </button>
            </>
          }
        >
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">
            ستُحذف المتابعة فقط، وحركات الخزنة المسجلة تبقى.
          </p>
        </ModalShell>
      )}

      {/* نافذة إدخال الرصيد الآن (اختياريًا من بطاقة الحساب بدون زر تأجيل) */}
      {instantBalanceAccount && (
        <ManualBalanceModal
          request={
            instantBalanceAccount.request
              ? {
                  ...instantBalanceAccount.request,
                  mandatory: false,
                  canPostpone: false,
                  blocking: false,
                }
              : {
                  accountId: instantBalanceAccount.id,
                  accountName: instantBalanceAccount.name,
                  cashboxName: instantBalanceAccount.cashboxName,
                  kind: instantBalanceAccount.lastEntryAt ? 'scheduled' : 'baseline',
                  mandatory: false,
                  state: 'due',
                  dueAt: new Date().toISOString(),
                  postponedUntil: '',
                  canPostpone: false,
                  blocking: false,
                }
          }
          allowPostpone={false}
          voluntaryMode={true}
          onSubmitted={async () => {
            if (onRefreshCashboxes) {
              await onRefreshCashboxes();
            }
            await loadOverview(true);
          }}
          onCloseDone={() => setInstantBalanceAccount(null)}
        />
      )}
    </div>
  );
};

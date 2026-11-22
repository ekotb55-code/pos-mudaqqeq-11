import React, { useState, useEffect, useRef } from 'react';
import {
  ManualBalanceAlert,
  ManualBalanceRequest,
  PageType,
  SystemConfig,
  UserAccount
} from '../types';
import { PWAInstallButton } from './PWAInstallButton';
import {
  RefreshCw,
  ShieldCheck,
  User,
  LogOut,
  WifiOff,
  Settings,
  Crown,
  Info,
  Smartphone,
  Check,
  Calendar,
  AlertTriangle,
  Clock,
  KeyRound,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { useOfflineMode } from '../hooks/useOfflineMode';
import { hasPermission } from '../utils/permissions';
import { useRegisterShortcuts } from '../context/KeyboardShortcutsContext';
import { formatDeviceTime } from './ManualBalancePrompt';
import { api } from '../api/client';
import { getHrefForTarget, isPlainLeftClick } from '../config/navigation';
import { ModalShell, FORM_CONTROL_BASE_CLASS, INPUT_WIDTH_CLASSES } from './ui';

interface NavbarProps {
  config: SystemConfig;
  user: UserAccount | null;
  currentPage: PageType;
  onNavigate: (page: PageType, tab?: string) => void;
  onLogout: () => void;
  onSync: () => void;
  isSyncing: boolean;
  onOpenAbout?: () => void;
  manualBalanceRequests?: ManualBalanceRequest[];
  manualBalanceAlerts?: ManualBalanceAlert[];
  dismissedManualDueKeys?: Record<string, string>;
  onOpenManualBalanceRequest?: (request: ManualBalanceRequest) => void;
  onOpenManualBalanceAlerts?: () => void;
  salesOnlyMode?: boolean;
}

function getFirstName(fullName?: string): string {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'مستخدمنا';
  if (parts.length > 1 && /^(م\.|د\.|أ\.|ا\.)$/.test(parts[0])) {
    return parts[1];
  }
  return parts[0];
}

function getUserRoleLabel(role?: UserAccount['role']): string {
  if (role === 'designer') return 'مصمم ومالك النظام';
  if (role === 'manager') return 'مدير (كامل الصلاحيات والتكاليف)';
  return 'موظف (مبيعات ونقاط بيع)';
}

function getCairoGreetingAndDate(now: Date, fullName?: string): { greeting: string; dateText: string } {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric',
    hour12: false
  }).format(now);
  const hour = (parseInt(hourStr, 10) || 0) % 24;
  const greetingPrefix = hour >= 5 && hour < 12 ? 'صباح الخير' : 'مساء الخير';
  const greeting = `${greetingPrefix} يا ${getFirstName(fullName)}`;
  const dateText = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    timeZone: 'Africa/Cairo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
    .format(now)
    .replace(/،/g, '');

  return { greeting, dateText };
}

export const Navbar: React.FC<NavbarProps> = ({
  config,
  user,
  currentPage,
  onNavigate,
  onLogout,
  onSync,
  isSyncing,
  onOpenAbout,
  manualBalanceRequests = [],
  manualBalanceAlerts = [],
  dismissedManualDueKeys = {},
  onOpenManualBalanceRequest,
  onOpenManualBalanceAlerts,
  salesOnlyMode = false
}) => {
  const {
    isOnline,
    pendingCount,
    lastSyncAt,
    deviceId,
    deviceName,
    storagePersisted,
    isSyncingOutbox,
    lastOutboxError,
    syncNow,
    setDeviceName
  } = useOfflineMode();

  const [now, setNow] = useState<Date>(() => new Date());
  const [devicePopoverOpen, setDevicePopoverOpen] = useState(false);
  const [userTooltipOpen, setUserTooltipOpen] = useState(false);
  const [deviceNameDraft, setDeviceNameDraft] = useState(deviceName);
  const [deviceSavedNotice, setDeviceSavedNotice] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [currentPwdInput, setCurrentPwdInput] = useState('');
  const [newPwdInput, setNewPwdInput] = useState('');
  const [confirmPwdInput, setConfirmPwdInput] = useState('');
  const [showOwnPwd, setShowOwnPwd] = useState(false);
  const [isSavingOwnPwd, setIsSavingOwnPwd] = useState(false);
  const [ownPwdFeedback, setOwnPwdFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleOpenChangeOwnPassword = () => {
    setUserTooltipOpen(false);
    setCurrentPwdInput('');
    setNewPwdInput('');
    setConfirmPwdInput('');
    setShowOwnPwd(false);
    setOwnPwdFeedback(null);
    setIsChangePasswordOpen(true);
  };

  const handleSubmitOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setOwnPwdFeedback(null);

    const cur = currentPwdInput.trim();
    const nxt = newPwdInput.trim();
    const cfm = confirmPwdInput.trim();

    if (!cur) {
      setOwnPwdFeedback({ type: 'error', message: 'كلمة السر الحالية مطلوبة' });
      return;
    }
    if (nxt.length < 2) {
      setOwnPwdFeedback({ type: 'error', message: 'كلمة السر الجديدة يجب أن تتكون من حرفين أو رقمين على الأقل' });
      return;
    }
    if (nxt !== cfm) {
      setOwnPwdFeedback({ type: 'error', message: 'كلمة السر الجديدة وتأكيدها غير متطابقين' });
      return;
    }

    setIsSavingOwnPwd(true);
    try {
      const res = await api.changeOwnPassword({
        currentPassword: cur,
        newPassword: nxt
      });
      if (res.success) {
        setOwnPwdFeedback({
          type: 'success',
          message: res.message || 'تم تغيير كلمة السر بنجاح!'
        });
        setCurrentPwdInput('');
        setNewPwdInput('');
        setConfirmPwdInput('');
        window.setTimeout(() => {
          setIsChangePasswordOpen(false);
        }, 1200);
      } else {
        setOwnPwdFeedback({
          type: 'error',
          message: res.error || 'تعذر تغيير كلمة السر'
        });
      }
    } catch (err: any) {
      setOwnPwdFeedback({
        type: 'error',
        message: err?.message || 'تعذر تغيير كلمة السر'
      });
    } finally {
      setIsSavingOwnPwd(false);
    }
  };

  const devicePopoverRef = useRef<HTMLDivElement | null>(null);
  const userPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDeviceNameDraft(deviceName);
  }, [deviceName]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!devicePopoverOpen && !userTooltipOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (devicePopoverRef.current && !devicePopoverRef.current.contains(target)) {
        setDevicePopoverOpen(false);
      }
      if (userPopoverRef.current && !userPopoverRef.current.contains(target)) {
        setUserTooltipOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [devicePopoverOpen, userTooltipOpen]);

  useRegisterShortcuts(
    {
      'general.close_or_back': () => {
        setDevicePopoverOpen(false);
        setUserTooltipOpen(false);
      }
    },
    Boolean(devicePopoverOpen || userTooltipOpen)
  );

  const handleSaveDeviceNameInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceNameDraft.trim()) return;
    await setDeviceName(deviceNameDraft.trim());
    setDeviceSavedNotice(true);
    window.setTimeout(() => setDeviceSavedNotice(false), 2000);
  };

  const formattedLastSync = lastSyncAt
    ? (() => {
        const d = new Date(lastSyncAt);
        if (isNaN(d.getTime())) return lastSyncAt;
        return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
          timeZone: 'Africa/Cairo',
          hour: '2-digit',
          minute: '2-digit',
          day: 'numeric',
          month: 'short'
        }).format(d);
      })()
    : 'لم تتم المزامنة بعد';

  const { greeting, dateText } = getCairoGreetingAndDate(now, user?.name);
  const roleLabel = getUserRoleLabel(user?.role);
  const userTooltipText = `${user?.name ? `${user.name} • ` : ''}${roleLabel} • ${dateText}`;

  const isSupabaseMode = config.persistenceMode === 'supabase';
  const canOpenDatabaseSettings =
    user?.role === 'designer' ||
    Boolean(user?.isOwner) ||
    hasPermission(user, 'settings.system_integration');

  const statusLabelShort = isSupabaseMode ? 'متصل' : 'وضع المعاينة';

  const statusTooltipFull = isSupabaseMode
    ? 'قاعدة البيانات متصلة — كل العمليات محفوظة'
    : 'وضع المعاينة — البيانات لا تُحفظ';

  return (
    <header className="mudaqqeq-navbar no-print relative z-30 bg-transparent border-0 shadow-none">
      <div className="aurora-nav-container max-w-none px-2.5 sm:px-6 lg:px-8">
        <div className="aurora-nav-row flex items-center justify-between gap-[6px]">

          {/* Start Side: Compact Desktop Brand Chip (Non-Aurora) */}
          <div className="aurora-hide hidden md:flex items-center gap-[6px] shrink-0">
            <a
              href={getHrefForTarget(currentPage === 'pos' ? 'pos' : (salesOnlyMode ? 'pos' : 'dashboard'), undefined, {
                user,
                flags: { salesOnlyMode }
              })}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return;
                e.preventDefault();
                if (currentPage === 'pos') {
                  window.location.reload();
                } else {
                  onNavigate(salesOnlyMode ? 'pos' : 'dashboard');
                }
              }}
              className="aurora-hide hidden md:inline-flex navbar-glass-chip gap-2 cursor-pointer group shrink-0 no-underline"
              title={
                currentPage === 'pos'
                  ? 'تحديث صفحة نقطة البيع'
                  : salesOnlyMode
                  ? 'الانتقال إلى نقطة البيع'
                  : 'الانتقال إلى لوحة التحكم'
              }
              aria-label={
                currentPage === 'pos'
                  ? 'تحديث صفحة نقطة البيع'
                  : salesOnlyMode
                  ? 'الانتقال إلى نقطة البيع'
                  : 'الانتقال إلى لوحة التحكم'
              }
            >
              <span className="w-[20px] h-[20px] rounded-[6px] bg-white p-0.5 border border-slate-200/80 flex items-center justify-center overflow-hidden shrink-0">
                <img
                  src={config.companySettings?.logoUrl || '/brand/app-logo.png'}
                  alt="شعار مدقق للنظم"
                  className="w-full h-full object-contain"
                />
              </span>
              <span className="truncate group-hover:opacity-85 transition-opacity">
                مدقق للنظم
              </span>
              <span className="navbar-chip-muted text-[11px] font-semibold leading-none shrink-0">
                · {config.currency || 'EGP'}
              </span>
            </a>
          </div>

          {/* End Side: Phone-Status-Bar Compact Cluster (Status, Device, Sync, Actions, Merged User Chip) */}
          <div className="aurora-nav-center flex items-center gap-[6px] shrink-0 ms-auto min-w-0">

            {/* Connection / Preview Mode Chip */}
            <div className="relative shrink-0">
              {canOpenDatabaseSettings ? (
                <a
                  href={getHrefForTarget('settings', 'integration', { user, flags: { salesOnlyMode } })}
                  onClick={(e) => {
                    if (!isPlainLeftClick(e)) return;
                    e.preventDefault();
                    onNavigate('settings', 'integration');
                  }}
                  className={`navbar-glass-chip navbar-glass-chip--mobile-icon gap-1.5 cursor-pointer active:scale-95 no-underline ${
                    isSupabaseMode
                      ? 'navbar-glass-chip--emerald'
                      : 'navbar-glass-chip--amber'
                  }`}
                  title={statusTooltipFull}
                  aria-label={statusTooltipFull}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isSupabaseMode
                        ? 'bg-emerald-500 animate-pulse'
                        : 'bg-amber-500 animate-pulse'
                    }`}
                  />
                  <span className="hidden sm:inline">{statusLabelShort}</span>
                </a>
              ) : (
                <div
                  className={`navbar-glass-chip navbar-glass-chip--mobile-icon gap-1.5 cursor-default ${
                    isSupabaseMode
                      ? 'navbar-glass-chip--emerald'
                      : 'navbar-glass-chip--amber'
                  }`}
                  title={statusTooltipFull}
                  aria-label={statusTooltipFull}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isSupabaseMode
                        ? 'bg-emerald-500 animate-pulse'
                        : 'bg-amber-500 animate-pulse'
                    }`}
                  />
                  <span className="hidden sm:inline">{statusLabelShort}</span>
                </div>
              )}
            </div>

            {/* Browser Offline Chip */}
            {!isOnline && (
              <div
                className="navbar-glass-chip navbar-glass-chip--rose navbar-glass-chip--mobile-icon gap-1.5 shrink-0"
                title="دون اتصال بالإنترنت"
                aria-label="دون اتصال بالإنترنت"
              >
                <WifiOff className="w-[15px] h-[15px] shrink-0" />
                <span className="hidden sm:inline">دون اتصال</span>
              </div>
            )}

            {/* Pending Outbox Operations Chip */}
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={async () => {
                  if (!isOnline || isSyncing || isSyncingOutbox) return;
                  await syncNow();
                  onSync();
                }}
                disabled={!isOnline || isSyncing || isSyncingOutbox}
                className="navbar-glass-chip navbar-glass-chip--amber gap-1.5 cursor-pointer disabled:opacity-75 shrink-0"
                title={`توجد ${pendingCount} عملية معلّقة في صندوق الصادر المحلي${isOnline ? ' • اضغط للمزامنة' : ''}`}
                aria-label={`توجد ${pendingCount} عملية معلّقة`}
              >
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                <span className="hidden sm:inline tabular-nums">معلّق: {pendingCount}</span>
                <span className="sm:hidden tabular-nums">{pendingCount}</span>
              </button>
            )}

            {/* شارات طلبات الرصيد اليدوي للمسؤول فقط (مؤجَّل أو غير إجباري أُغلق بـ لاحقًا) */}
            {manualBalanceRequests.map((req) => {
              if (req.state === 'postponed') {
                const label = `رصيد ${req.accountName} مؤجل حتى ${formatDeviceTime(req.postponedUntil)}`;
                return (
                  <button
                    key={`postponed-${req.accountId}`}
                    type="button"
                    data-testid={`navbar-manual-postponed-${req.accountId}`}
                    onClick={() => onOpenManualBalanceRequest?.(req)}
                    className="navbar-glass-chip navbar-glass-chip--amber gap-1.5 cursor-pointer shrink-0"
                    title={label}
                    aria-label={label}
                  >
                    <Clock className="w-[14px] h-[14px] shrink-0" />
                    <span className="whitespace-nowrap max-w-[220px] truncate">{label}</span>
                  </button>
                );
              }
              if (
                req.state === 'due' &&
                !req.mandatory &&
                dismissedManualDueKeys[req.accountId] === req.dueAt
              ) {
                const label = `مطلوب رصيد ${req.accountName}`;
                return (
                  <button
                    key={`due-${req.accountId}`}
                    type="button"
                    data-testid={`navbar-manual-due-${req.accountId}`}
                    onClick={() => onOpenManualBalanceRequest?.(req)}
                    className="navbar-glass-chip navbar-glass-chip--amber gap-1.5 cursor-pointer shrink-0"
                    title={label}
                    aria-label={label}
                  >
                    <Clock className="w-[14px] h-[14px] shrink-0" />
                    <span className="whitespace-nowrap max-w-[200px] truncate">{label}</span>
                  </button>
                );
              }
              return null;
            })}

            {/* شارة تنبيه المالك بفروق الرصيد اليدوي التي تحتاج مراجعة */}
            {manualBalanceAlerts.length > 0 && (
              <button
                type="button"
                data-testid="navbar-manual-alerts-badge"
                onClick={() => onOpenManualBalanceAlerts?.()}
                className="navbar-glass-chip navbar-glass-chip--rose gap-1.5 cursor-pointer shrink-0"
                title={`${manualBalanceAlerts.length} فرق رصيد يحتاج مراجعة`}
                aria-label={`${manualBalanceAlerts.length} فرق رصيد يحتاج مراجعة`}
              >
                <AlertTriangle className="w-[14px] h-[14px] shrink-0" />
                <span className="whitespace-nowrap tabular-nums">
                  {manualBalanceAlerts.length} فرق رصيد يحتاج مراجعة
                </span>
              </button>
            )}

            {/* POS Device Chip */}
            <div ref={devicePopoverRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setUserTooltipOpen(false);
                  setDevicePopoverOpen(prev => !prev);
                }}
                className="navbar-glass-chip gap-1.5 cursor-pointer active:scale-95"
                title={`الجهاز: ${deviceName || 'نقطة بيع 1'} • آخر نسخة محلية: ${formattedLastSync}`}
                aria-label={`الجهاز: ${deviceName || 'نقطة بيع 1'}`}
              >
                <Smartphone className="w-[15px] h-[15px] shrink-0" />
                <span className="max-w-[78px] sm:max-w-[120px] truncate">{deviceName || 'نقطة بيع 1'}</span>
              </button>

              {devicePopoverOpen && (
                <div
                  className="absolute top-9 end-0 w-72 rounded-2xl bg-white text-slate-800 border border-slate-200 shadow-2xl p-3.5 space-y-3 z-50 text-start"
                  dir="rtl"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-xs font-extrabold text-slate-900">الجهاز والتخزين المحلي (Offline)</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isOnline ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {isOnline ? 'متصل (/api/health)' : 'أوفلاين'}
                    </span>
                  </div>

                  <form onSubmit={handleSaveDeviceNameInline} className="space-y-1.5">
                    <label className="block text-[11px] font-bold text-slate-600">
                      اسم الجهاز (يظهر في السجلات والعمليات)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={deviceNameDraft}
                        onChange={e => setDeviceNameDraft(e.target.value)}
                        placeholder="مثال: كاشير الفرع 1"
                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                      <button
                        type="submit"
                        className="px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold transition cursor-pointer shrink-0 flex items-center gap-1"
                      >
                        {deviceSavedNotice ? <Check className="w-[15px] h-[15px]" /> : null}
                        <span>{deviceSavedNotice ? 'حُفظ' : 'حفظ'}</span>
                      </button>
                    </div>
                  </form>

                  <div className="bg-slate-50 rounded-xl p-2.5 space-y-1.5 text-[11px] border border-slate-200/80">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 font-semibold">معرف الجهاز (UUID):</span>
                      <span className="font-mono text-[10px] text-slate-700 truncate max-w-[140px]" title={deviceId}>
                        {deviceId ? `${deviceId.slice(0, 8)}...${deviceId.slice(-4)}` : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 font-semibold">العمليات المعلّقة:</span>
                      <span className="font-bold text-slate-800 tabular-nums">{pendingCount}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 font-semibold">آخر نسخة محلية:</span>
                      <span className="font-bold text-slate-800">{formattedLastSync}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 font-semibold">التخزين الدائم:</span>
                      <span className="font-bold text-slate-700">
                        {storagePersisted === null ? 'قيد الفحص' : storagePersisted ? 'مفعّل (Persisted)' : 'قياسي'}
                      </span>
                    </div>
                    {lastOutboxError && (
                      <div className="pt-1 text-[10px] font-bold text-rose-700 border-t border-rose-100">
                        آخر خطأ رفع: {lastOutboxError}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      await syncNow();
                      onSync();
                    }}
                    disabled={!isOnline || isSyncing || isSyncingOutbox}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-extrabold transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-[15px] h-[15px] ${isSyncing || isSyncingOutbox ? 'animate-spin' : ''}`} />
                    <span>{isSyncingOutbox ? 'جارٍ رفع العمليات المعلّقة...' : 'مزامنة الآن'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Sync Button (30×30 square) */}
            <button
              type="button"
              onClick={onSync}
              disabled={isSyncing}
              className="navbar-glass-chip navbar-glass-chip--icon cursor-pointer active:scale-95 disabled:opacity-60 shrink-0"
              title="مزامنة وتحديث البيانات الآن"
              aria-label="مزامنة وتحديث البيانات الآن"
            >
              <RefreshCw className={`w-[15px] h-[15px] ${isSyncing ? 'animate-spin' : ''}`} />
            </button>

            {/* Optional About App Button */}
            {onOpenAbout && (
              <button
                type="button"
                onClick={onOpenAbout}
                className="navbar-glass-chip navbar-glass-chip--mobile-icon gap-1.5 cursor-pointer active:scale-95 shrink-0"
                title="عن التطبيق"
                aria-label="عن التطبيق"
              >
                <Info className="w-[15px] h-[15px] shrink-0" />
                <span className="hidden sm:inline">عن التطبيق</span>
              </button>
            )}

            {/* PWA Install */}
            <PWAInstallButton />

            {/* Merged User Chip: Role Icon (20×20) + Greeting (single line) + Logout */}
            {user && (
              <div ref={userPopoverRef} className="relative shrink-0">
                <div
                  className="navbar-glass-chip aurora-user-card gap-[6px]"
                  data-testid="navbar-user-chip"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDevicePopoverOpen(false);
                      setUserTooltipOpen(prev => !prev);
                    }}
                    className="navbar-user-info-btn relative flex items-center gap-1.5 h-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] rounded-[6px]"
                    title={userTooltipText}
                    aria-label={userTooltipText}
                    aria-expanded={userTooltipOpen}
                  >
                    <span className="aurora-user-avatar w-[20px] h-[20px] rounded-[6px] bg-[var(--nav-blue)] text-white flex items-center justify-center shrink-0">
                      {user.role === 'designer' ? (
                        <Crown className="w-[13px] h-[13px] text-white" />
                      ) : user.role === 'manager' ? (
                        <ShieldCheck className="w-[13px] h-[13px] text-white" />
                      ) : (
                        <User className="w-[13px] h-[13px] text-white" />
                      )}
                    </span>
                    <span className="hidden sm:inline truncate max-w-[165px]">
                      {greeting}
                    </span>
                  </button>

                  <span className="w-px h-3.5 bg-current opacity-20 shrink-0" aria-hidden="true" />

                  <button
                    type="button"
                    onClick={onLogout}
                    className="navbar-user-logout-btn relative z-10 flex items-center justify-center w-[20px] h-[20px] rounded-[6px] hover:text-[var(--danger)] hover:bg-rose-500/15 transition-colors cursor-pointer shrink-0"
                    title="تسجيل الخروج"
                    aria-label="تسجيل الخروج"
                  >
                    <LogOut className="w-[15px] h-[15px]" />
                  </button>
                </div>

                {/* Popover on Click / Mobile Tap: Shows Role + Full Date + Change Password */}
                {userTooltipOpen && (
                  <div
                    role="dialog"
                    aria-label="حساب المستخدم"
                    dir="rtl"
                    className="absolute top-9 end-0 w-64 rounded-2xl bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border-color)] shadow-2xl p-3 space-y-2 z-50 text-start"
                  >
                    <div className="flex items-center gap-2">
                      <span className="aurora-user-avatar w-[24px] h-[24px] rounded-[7px] bg-[var(--nav-blue)] text-white flex items-center justify-center shrink-0">
                        {user.role === 'designer' ? (
                          <Crown className="w-[14px] h-[14px] text-white" />
                        ) : user.role === 'manager' ? (
                          <ShieldCheck className="w-[14px] h-[14px] text-white" />
                        ) : (
                          <User className="w-[14px] h-[14px] text-white" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold truncate">{greeting}</div>
                        <div className="text-[11px] font-semibold text-[var(--text-secondary)] truncate">
                          {roleLabel}
                        </div>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                      <Calendar className="w-[14px] h-[14px] shrink-0" />
                      <span>{dateText}</span>
                    </div>
                    <div className="pt-2 border-t border-[var(--border-subtle)]">
                      <button
                        type="button"
                        onClick={handleOpenChangeOwnPassword}
                        className="w-full min-h-[38px] inline-flex items-center gap-2 px-2 rounded-lg hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] transition cursor-pointer"
                      >
                        <KeyRound className="w-[15px] h-[15px] shrink-0" />
                        <span>تغيير كلمة السر</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>

        </div>
      </div>

      {user && isChangePasswordOpen && (
        <ModalShell
          title="تغيير كلمة السر"
          subtitle={`تحديث كلمة السر لحسابك الحالي (${user.name})`}
          onClose={() => !isSavingOwnPwd && setIsChangePasswordOpen(false)}
          closeDisabled={isSavingOwnPwd}
          footer={
            <>
              <button
                type="button"
                disabled={isSavingOwnPwd}
                onClick={() => setIsChangePasswordOpen(false)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                form="navbar-change-own-password-form"
                disabled={isSavingOwnPwd}
                className="min-h-[44px] px-5 rounded-lg bg-[#168A4A] hover:bg-[#12703C] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {isSavingOwnPwd ? 'جاري التحديث...' : 'تحديث كلمة السر'}
              </button>
            </>
          }
        >
          {ownPwdFeedback && (
            <div
              role="status"
              className={`text-xs font-bold flex items-center gap-2 mb-3 ${
                ownPwdFeedback.type === 'success' ? 'ui-money-purchase' : 'ui-stock-out'
              }`}
            >
              {ownPwdFeedback.type === 'success' ? (
                <CheckCircle className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{ownPwdFeedback.message}</span>
            </div>
          )}

          <form id="navbar-change-own-password-form" onSubmit={handleSubmitOwnPassword} className="space-y-3.5">
            <div>
              <label
                htmlFor="navbar-own-pwd-current"
                className="block text-xs font-bold text-[var(--text-secondary)] mb-1"
              >
                كلمة السر الحالية *
              </label>
              <input
                id="navbar-own-pwd-current"
                type={showOwnPwd ? 'text' : 'password'}
                required
                value={currentPwdInput}
                onChange={(e) => setCurrentPwdInput(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
              />
            </div>

            <div>
              <label
                htmlFor="navbar-own-pwd-new"
                className="block text-xs font-bold text-[var(--text-secondary)] mb-1"
              >
                كلمة السر الجديدة *
              </label>
              <input
                id="navbar-own-pwd-new"
                type={showOwnPwd ? 'text' : 'password'}
                required
                value={newPwdInput}
                onChange={(e) => setNewPwdInput(e.target.value)}
                placeholder="حرفان أو رقمان على الأقل"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
              />
            </div>

            <div>
              <label
                htmlFor="navbar-own-pwd-confirm"
                className="block text-xs font-bold text-[var(--text-secondary)] mb-1"
              >
                تأكيد كلمة السر الجديدة *
              </label>
              <input
                id="navbar-own-pwd-confirm"
                type={showOwnPwd ? 'text' : 'password'}
                required
                value={confirmPwdInput}
                onChange={(e) => setConfirmPwdInput(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
              />
            </div>

            <label className="min-h-[44px] inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={showOwnPwd}
                onChange={(e) => setShowOwnPwd(e.target.checked)}
                className="w-4 h-4 accent-[#1668B2]"
              />
              <span>إظهار كلمات السر</span>
            </label>
          </form>
        </ModalShell>
      )}
    </header>
  );
};

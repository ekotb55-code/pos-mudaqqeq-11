import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Invoice, PageType, UserAccount } from '../types';
import { api } from '../api/client';
import {
  OutboxOperation,
  getOutboxSummaryForSyncScreen,
  getOperationMonetaryAmount,
  downloadPendingOutboxJsonlBackup,
  importJsonlBackupAndSync,
  applyReviewedInvoiceToLocalDb,
  getBackupDirectoryStatus,
  selectBackupDirectory,
  activateBackupDirectoryPermission,
  BackupDirectoryStatus,
  subscribeOfflineDb,
  OUTBOX_CANCELLED_BEFORE_RESET_STATUS,
  OUTBOX_REJECTED_REVIEW_STATUS,
} from '../offline/db';
import { useOfflineMode } from '../hooks/useOfflineMode';
import { useOfflineLock } from '../offline/offlineLock';
import { hasPermission } from '../utils/permissions';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ReportSummaryTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
  type ReportSummaryRow,
} from '../components/ui';

type SyncTab = 'pending' | 'failed' | 'needs_review';

interface SyncPageProps {
  user: UserAccount;
  invoices: Invoice[];
  onRefreshData: () => Promise<void>;
  onInvoiceReviewed?: (updatedInvoice: Invoice) => void;
  initialTab?: SyncTab;
  onNavigate?: (page: PageType, tab?: string) => void;
}

export const SyncPage: React.FC<SyncPageProps> = ({
  user,
  invoices,
  onRefreshData,
  onInvoiceReviewed,
  initialTab,
  onNavigate,
}) => {
  const { isOffline, isSyncingOutbox, syncNow, deviceId, deviceName } = useOfflineMode();
  const {
    hasOwnership: hasOfflineLock,
    reason: offlineLockReason,
    retryAcquireLock: recheckOfflineLock,
  } = useOfflineLock();

  const canManageOffline =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'offline.manage');

  const [activeTab, setActiveTab] = useState<SyncTab>(initialTab || 'pending');
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [pendingOps, setPendingOps] = useState<OutboxOperation[]>([]);
  const [failedOps, setFailedOps] = useState<OutboxOperation[]>([]);
  const [cancelledOps, setCancelledOps] = useState<OutboxOperation[]>([]);
  const [rejectedReviewOps, setRejectedReviewOps] = useState<OutboxOperation[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingTotalAmount, setPendingTotalAmount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [cancelledCount, setCancelledCount] = useState(0);
  const [rejectedReviewCount, setRejectedReviewCount] = useState(0);

  const [backupDirStatus, setBackupDirStatus] = useState<BackupDirectoryStatus | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // حالة مراجعة الفواتير (زر «تمت المراجعة» مع ملاحظة)
  const [reviewingInvoiceNo, setReviewingInvoiceNo] = useState<string | null>(null);
  const [reviewNotesMap, setReviewNotesMap] = useState<Record<string, string>>({});
  const [submittingReviewNo, setSubmittingReviewNo] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadLocalOutboxState = useCallback(async () => {
    const [summary, dirStatus] = await Promise.all([
      getOutboxSummaryForSyncScreen(),
      getBackupDirectoryStatus(),
    ]);
    setPendingOps(summary.pendingOps);
    setFailedOps(summary.failedOps);
    setCancelledOps(summary.cancelledOps);
    setRejectedReviewOps(summary.rejectedReviewOps || []);
    setPendingCount(summary.pendingCount);
    setPendingTotalAmount(summary.pendingTotalAmount);
    setFailedCount(summary.failedCount);
    setCancelledCount(summary.cancelledCount);
    setRejectedReviewCount(summary.rejectedReviewCount || 0);
    setBackupDirStatus(dirStatus);
  }, []);

  useEffect(() => {
    loadLocalOutboxState();
    return subscribeOfflineDb(() => {
      loadLocalOutboxState();
    });
  }, [loadLocalOutboxState]);

  if (!canManageOffline) {
    return (
      <PageSurface dir="rtl" title="شاشة المزامنة والنسخ الاحتياطي">
        <div className="py-6 text-sm font-bold ui-stock-out">
          غير مصرح لك بعرض شاشة المزامنة وإدارة العمليات بدون إنترنت (تتطلب صلاحية إدارة المزامنة).
        </div>
      </PageSurface>
    );
  }

  // الفواتير التي تحتاج مراجعة من كل الأجهزة
  const needsReviewInvoices = invoices.filter((inv) => Boolean(inv.needsReview));

  const formatDateTimeAr = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  };

  const getOperationTypeLabelAr = (op: OutboxOperation): string => {
    const t = op.type || op.operationType;
    if (t === 'createInvoice') return 'فاتورة بيع';
    if (t === 'collectCredit' || t === 'collectCreditInvoices') return 'تحصيل آجل';
    if (t === 'updatePermissions' || t === 'updateUserPermissions') return 'تعديل صلاحيات';
    if (t === 'authAudit' || t === 'OFFLINE_LOGIN') return 'تسجيل دخول أوفلاين';
    if (t === 'OFFLINE_LOGOUT') return 'تسجيل خروج أوفلاين';
    return 'عملية محلية';
  };

  const handleSyncNow = async () => {
    setStatusBanner(null);
    if (isOffline) {
      setStatusBanner({
        type: 'error',
        text: 'الجهاز غير متصل بالإنترنت حاليًا. صِل الإنترنت أولًا لرفع العمليات المعلّقة.',
      });
      return;
    }
    if (!hasOfflineLock) {
      setStatusBanner({
        type: 'error',
        text:
          offlineLockReason ||
          'القاعدة المحلية مقفولة حاليًا لتبويب آخر على هذا المتصفح. أغلق التبويب الآخر أو أعد فحص القفل قبل المزامنة.',
      });
      return;
    }
    try {
      const res = await syncNow();
      await loadLocalOutboxState();
      await onRefreshData();
      const rejectedCnt = res.rejectedReviewCount || 0;
      if (res.failedCount === 0 && rejectedCnt === 0) {
        setStatusBanner({
          type: 'success',
          text:
            res.syncedCount > 0
              ? `تمت مزامنة ورفع ${res.syncedCount} عملية بنجاح.`
              : 'جميع العمليات متزامنة ولا توجد عمليات معلّقة.',
        });
      } else if (res.failedCount === 0 && rejectedCnt > 0) {
        setStatusBanner({
          type: 'error',
          text: `تم رفع ${res.syncedCount} عملية، ورُفضت ${rejectedCnt} عملية لتعارضها مع إعدادات البيع الحالية (محفوظة محليًا للمراجعة ولن تُحذف أو تُعاد محاولتها تلقائيًا): ${
            res.lastError || 'يرجى مراجعة تبويب تحتاج مراجعة'
          }`,
        });
        if (onNavigate && activeTab !== 'needs_review') {
          onNavigate('sync', 'needs_review');
        }
      } else {
        setStatusBanner({
          type: 'error',
          text: `تم رفع ${res.syncedCount} عملية، وتعذر رفع ${res.failedCount} عملية${
            rejectedCnt > 0 ? ` ورُفضت ${rejectedCnt} عملية محفوظة للمراجعة` : ''
          }: ${res.lastError || 'يرجى مراجعة العمليات الفاشلة'}`,
        });
        if (onNavigate && activeTab !== 'failed') {
          onNavigate('sync', 'failed');
        }
      }
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err?.message || 'حدث خطأ أثناء المزامنة',
      });
    }
  };

  const handleExportJsonlFile = async () => {
    setIsExporting(true);
    setStatusBanner(null);
    try {
      const res = await downloadPendingOutboxJsonlBackup();
      if (res.count === 0) {
        setStatusBanner({
          type: 'info',
          text: 'لا توجد عمليات معلّقة حاليًا لتصديرها في ملف احتياطي.',
        });
      } else {
        setStatusBanner({
          type: 'success',
          text: `تم تصدير ${res.count} عملية في الملف الاحتياطي (${res.fileName}) بنجاح.`,
        });
      }
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err?.message || 'تعذر تصدير ملف النسخة الاحتياطية',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (isOffline) {
      setStatusBanner({
        type: 'error',
        text: 'يرجى الاتصال بالإنترنت أولًا لاستيراد الملف الاحتياطي ورفع عملياته إلى الخادم.',
      });
      return;
    }

    if (!hasOfflineLock) {
      setStatusBanner({
        type: 'error',
        text:
          offlineLockReason ||
          'القاعدة المحلية مقفولة حاليًا لتبويب آخر على هذا المتصفح. أغلق التبويب الآخر أو أعد فحص القفل قبل استيراد الملف.',
      });
      return;
    }

    setIsImporting(true);
    setStatusBanner(null);
    try {
      const content = await file.text();
      const result = await importJsonlBackupAndSync(content, { user });
      await loadLocalOutboxState();
      await onRefreshData();

      if (result.validOperations === 0) {
        setStatusBanner({
          type: 'error',
          text: result.errors[0] || 'لم يتم العثور على عمليات صالحة داخل الملف المختار.',
        });
      } else if (result.failedCount === 0) {
        setStatusBanner({
          type: 'success',
          text: `تم استيراد الملف بنجاح: رُفعت ${result.syncedCount} عملية (منها ${result.duplicateCount} عملية مكررة تم تجاوزها تلقائيًا بمفتاح منع التكرار).`,
        });
      } else {
        setStatusBanner({
          type: 'error',
          text: `تم رفع ${result.syncedCount} عملية، وفشلت ${result.failedCount} عملية. ${
            result.errors[0] || ''
          }`,
        });
      }
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err?.message || 'تعذر قراءة أو استيراد ملف النسخة الاحتياطية',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleSelectFolder = async () => {
    setStatusBanner(null);
    try {
      const status = await selectBackupDirectory();
      setBackupDirStatus(status);
      setStatusBanner({
        type: 'success',
        text: `تم ربط مجلد النسخ الاحتياطي التلقائي (${status.directoryName}) بنجاح.`,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setStatusBanner({
        type: 'error',
        text: err?.message || 'تعذر اختيار مجلد النسخ الاحتياطي',
      });
    }
  };

  const handleActivateFolderPermission = async () => {
    setStatusBanner(null);
    try {
      const status = await activateBackupDirectoryPermission();
      setBackupDirStatus(status);
      if (status.permission === 'granted') {
        setStatusBanner({
          type: 'success',
          text: `تم تفعيل النسخ الاحتياطي التلقائي للمجلد (${status.directoryName}) بنجاح.`,
        });
      } else {
        setStatusBanner({
          type: 'error',
          text: 'لم يتم منح إذن الكتابة للمجلد. يرجى الضغط على «فعّل النسخ الاحتياطي» والموافقة.',
        });
      }
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err?.message || 'تعذر تفعيل إذن مجلد النسخ الاحتياطي',
      });
    }
  };

  const handleMarkReviewed = async (inv: Invoice) => {
    if (isOffline) {
      setStatusBanner({
        type: 'error',
        text: 'اعتماد المراجعة يتطلب اتصالًا بالإنترنت لتحديث حالة الفاتورة على الخادم لكل الأجهزة.',
      });
      return;
    }

    const note = (reviewNotesMap[inv.invoiceNumber] || '').trim();
    setSubmittingReviewNo(inv.invoiceNumber);
    setStatusBanner(null);

    try {
      const res = await api.markOfflineInvoiceReviewed({
        invoiceNumber: inv.invoiceNumber,
        reviewNote: note,
      });

      if (res.success) {
        await applyReviewedInvoiceToLocalDb({
          invoiceNumber: inv.invoiceNumber,
          reviewNote: note,
          reviewedBy: user.name || user.username,
        });
        if (res.invoice && onInvoiceReviewed) {
          onInvoiceReviewed(res.invoice);
        }
        setReviewingInvoiceNo(null);
        await onRefreshData();
        setStatusBanner({
          type: 'success',
          text: `تم اعتماد مراجعة الفاتورة (${inv.invoiceNumber}) بنجاح.`,
        });
      } else {
        setStatusBanner({
          type: 'error',
          text: res.error || 'تعذر اعتماد مراجعة الفاتورة',
        });
      }
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        text: err?.message || 'حدث خطأ أثناء اعتماد المراجعة',
      });
    } finally {
      setSubmittingReviewNo(null);
    }
  };

  const summaryRows: ReportSummaryRow[] = [
    {
      label: 'العمليات المعلّقة على هذا الجهاز',
      value: `${pendingCount} عملية (${pendingTotalAmount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ج.م)`,
      tone: 'accent',
    },
    {
      label: 'عمليات تعذر رفعها (فشلت)',
      value: `${failedCount} عملية`,
      note: 'تُعاد محاولة رفعها بنفس المفتاح',
      valueClassName: failedCount > 0 ? 'ui-stock-out' : 'text-[var(--text-primary)]',
    },
    {
      label: 'فواتير تحتاج مراجعة (كل الأجهزة)',
      value: `${needsReviewInvoices.length} فاتورة`,
      note: 'رصيد سالب أو تحصيل مكرر أو تعارض',
      valueClassName: needsReviewInvoices.length > 0 ? 'ui-stock-low' : 'text-[var(--text-primary)]',
    },
    ...(rejectedReviewCount > 0
      ? [
          {
            label: 'عمليات محلية مرفوضة عند المزامنة',
            value: `${rejectedReviewCount} عملية`,
            note: 'محفوظة محليًا للمراجعة ولا تُحذف أو تُعاد محاولتها تلقائيًا',
            valueClassName: 'ui-stock-out',
          } satisfies ReportSummaryRow,
        ]
      : []),
    ...(cancelledCount > 0
      ? [
          {
            label: 'عمليات ملغاة (قبل إعادة ضبط النظام)',
            value: `${cancelledCount} عملية`,
            note: 'لن تُرفع تلقائيًا وتحفظ للمراجعة',
            valueClassName: 'text-[var(--text-secondary)]',
          } satisfies ReportSummaryRow,
        ]
      : []),
  ];

  const deviceMetaLine = `اسم الجهاز: ${deviceName || 'نقطة بيع 1'}${
    deviceId ? ` • معرّف الجهاز: ${deviceId.slice(0, 8).toUpperCase()}` : ''
  }`;

  const totalNeedsReviewCount = needsReviewInvoices.length + rejectedReviewCount;

  const syncHeaderMeta: Record<SyncTab, { title: string; subtitle: string }> = {
    pending: {
      title: `المزامنة — العمليات المعلّقة (${pendingCount})`,
      subtitle: `متابعة العمليات المحفوظة محليًا بانتظار الرفع والنسخ الاحتياطي (.jsonl) • ${deviceMetaLine}`,
    },
    failed: {
      title: `المزامنة — العمليات الفاشلة (${failedCount})`,
      subtitle: `مراجعة العمليات التي تعذر رفعها وأسباب الفشل لإعادة المحاولة • ${deviceMetaLine}`,
    },
    needs_review: {
      title: `المزامنة — فواتير تحتاج مراجعة (${totalNeedsReviewCount})`,
      subtitle: `مراجعة فواتير الأوفلاين ذات الرصيد السالب أو التعارض أو المرفوضة عند المزامنة • ${deviceMetaLine}`,
    },
  };

  return (
    <PageSurface
      dir="rtl"
      title={syncHeaderMeta[activeTab].title}
      subtitle={syncHeaderMeta[activeTab].subtitle}
      actions={
        <>
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={isSyncingOutbox || isOffline || !hasOfflineLock}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncingOutbox ? 'animate-spin' : ''}`} />
            <span>مزامنة الآن</span>
          </button>

          <button
            type="button"
            onClick={handleExportJsonlFile}
            disabled={isExporting}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-lg bg-[#168A4A] hover:bg-[#12703C] text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تصدير ملف</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting || !hasOfflineLock}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition disabled:opacity-50 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>{isImporting ? 'جاري الاستيراد...' : 'استيراد ملف احتياطي'}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jsonl,.json,.txt"
            onChange={handleImportFileSelect}
            className="hidden"
          />
        </>
      }
    >
      {/* تنبيه ملكية القفل المحلي للمزامنة من تبويب واحد */}
      {!hasOfflineLock && (
        <div
          role="alert"
          data-testid="sync-offline-lock-banner"
          className="mb-3 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs font-bold flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              {offlineLockReason ||
                'القاعدة المحلية نشطة في تبويب آخر على هذا المتصفح؛ المزامنة واستيراد الملفات متاحان في التبويب المالك للقفل فقط.'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              void recheckOfflineLock();
            }}
            className="min-h-[38px] px-3 py-1 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold cursor-pointer"
          >
            إعادة فحص القفل
          </button>
        </div>
      )}
      {/* حالة مجلد النسخ الاحتياطي التلقائي */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border-subtle)] text-xs">
        <div className="leading-relaxed">
          {backupDirStatus?.configured && backupDirStatus.permission === 'granted' ? (
            <span className="font-bold ui-money-purchase">
              النسخ الاحتياطي التلقائي مفعّل في المجلد: {backupDirStatus.directoryName}
              {backupDirStatus.lastBackupFileName
                ? ` (ملف اليوم: ${backupDirStatus.lastBackupFileName})`
                : ''}
            </span>
          ) : backupDirStatus?.configured && backupDirStatus.needsActivationBanner ? (
            <span className="font-bold ui-stock-low">
              مجلد النسخ الاحتياطي ({backupDirStatus.directoryName}) يحتاج إعادة تفعيل الإذن بعد تشغيل المتصفح
            </span>
          ) : backupDirStatus?.supported ? (
            <span className="text-[var(--text-secondary)]">
              لم يتم تحديد مجلد النسخ الاحتياطي التلقائي بعد على هذا الكمبيوتر
            </span>
          ) : (
            <span className="text-[var(--text-secondary)]">
              هذا المتصفح يقوم بتنزيل ملف احتياطي تلقائي (.jsonl) بالعمليات المعلّقة مع كل تنبيه ساعة
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {backupDirStatus?.needsActivationBanner && (
            <button
              type="button"
              onClick={handleActivateFolderPermission}
              className="min-h-[44px] px-3.5 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-bold transition cursor-pointer"
            >
              فعّل النسخ الاحتياطي
            </button>
          )}
          {backupDirStatus?.supported && (
            <button
              type="button"
              onClick={handleSelectFolder}
              className="min-h-[44px] px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
            >
              اختيار مجلد النسخ الاحتياطي
            </button>
          )}
        </div>
      </div>

      {/* رسائل التنبيه والنتيجة */}
      {statusBanner && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 py-2 border-b border-[var(--border-subtle)] text-xs font-bold ${
            statusBanner.type === 'success'
              ? 'ui-money-purchase'
              : statusBanner.type === 'error'
              ? 'ui-stock-out'
              : 'ui-link'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : statusBanner.type === 'error' ? (
              <XCircle className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="min-h-[44px] px-2 text-xs underline opacity-80 hover:opacity-100 cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* ملخص حالة المزامنة في جدول مضغوط */}
      <SectionHeading title="ملخص حالة المزامنة" />
      <ReportSummaryTable rows={summaryRows} ariaLabel="ملخص حالة المزامنة" />

      {/* التبويب الأول: معلّقة */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-[var(--text-secondary)]">
              العمليات المعلّقة على هذا الجهاز:{' '}
              <strong className="text-[var(--text-primary)] tabular-nums">{pendingCount} عملية</strong>
              {' • '}
              إجمالي القيمة:{' '}
              <strong className="ui-money-sale">
                {pendingTotalAmount.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                ج.م
              </strong>
            </div>

            {pendingCount > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncNow}
                  disabled={isSyncingOutbox || isOffline || pendingCount === 0 || !hasOfflineLock}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingOutbox ? 'animate-spin' : ''}`} />
                  <span>مزامنة الآن</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportJsonlFile}
                  disabled={isExporting || pendingCount === 0}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#168A4A] hover:bg-[#12703C] text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تصدير ملف</span>
                </button>
              </div>
            )}
          </div>

          {pendingOps.length === 0 ? (
            <div className="py-8 text-xs text-[var(--text-secondary)]">
              لا توجد أي عمليات معلّقة على هذا الجهاز — جميع العمليات المسجلة متزامنة مع الخادم بنجاح.
            </div>
          ) : (
            <CompactTable ariaLabel="جدول العمليات المعلّقة">
              <thead>
                <tr>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>العملية</th>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم المستند المؤقت</th>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>وقت الجهاز</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المستخدم</th>
                  <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>القيمة المالية</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {pendingOps.map((op) => {
                  const amount = getOperationMonetaryAmount(op);
                  const docNo =
                    op.invoiceNumber ||
                    op.payload?.offlineProvisionalNo ||
                    op.payload?.collectionId ||
                    op.id.slice(0, 8);
                  return (
                    <tr key={op.id}>
                      <td className={`font-bold ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {getOperationTypeLabelAr(op)}
                      </td>
                      <td className={`font-mono font-bold ui-link ${COMPACT_TABLE_NUM_CLASS}`}>
                        {docNo}
                      </td>
                      <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatDateTimeAr(op.deviceTime || op.createdAt)}
                      </td>
                      <td className={`font-semibold ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {op.userName || op.createdByUserName || 'كاشير'}
                      </td>
                      <td className={`text-left font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                        {amount > 0
                          ? `${amount.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })} ج.م`
                          : '—'}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>
                        {op.status === 'failed' ? (
                          <span className="font-bold ui-stock-out">
                            تعذر الرفع (محاولة {op.retryCount || 1})
                          </span>
                        ) : (
                          <span className="font-bold ui-stock-low">معلّقة بانتظار الرفع</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </CompactTable>
          )}
        </div>
      )}

      {/* التبويب الثاني: فشلت */}
      {activeTab === 'failed' && (
        <div>
          {failedOps.length === 0 ? (
            <div className="py-8 text-xs text-[var(--text-secondary)]">
              لا توجد أي عمليات فاشلة على هذا الجهاز — لم تُسجل أي أخطاء أثناء رفع العمليات.
            </div>
          ) : (
            <CompactTable ariaLabel="جدول العمليات الفاشلة">
              <thead>
                <tr>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>العملية</th>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم المستند</th>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>وقت التسجيل</th>
                  <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>القيمة</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>عدد المحاولات</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>سبب الفشل</th>
                </tr>
              </thead>
              <tbody>
                {failedOps.map((op) => {
                  const amount = getOperationMonetaryAmount(op);
                  const docNo =
                    op.invoiceNumber ||
                    op.payload?.offlineProvisionalNo ||
                    op.payload?.collectionId ||
                    op.id.slice(0, 8);
                  return (
                    <tr key={op.id}>
                      <td className={`font-bold ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {getOperationTypeLabelAr(op)}
                      </td>
                      <td className={`font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>{docNo}</td>
                      <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatDateTimeAr(op.deviceTime || op.createdAt)}
                      </td>
                      <td className={`text-left font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                        {amount > 0
                          ? `${amount.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })} ج.م`
                          : '—'}
                      </td>
                      <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                        {op.status === OUTBOX_REJECTED_REVIEW_STATUS ? 'موقوفة للمراجعة' : op.retryCount || 1}
                      </td>
                      <td className={`font-semibold ui-stock-out ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {op.status === OUTBOX_REJECTED_REVIEW_STATUS && (
                          <span className="block text-[11px] font-bold mb-0.5">
                            {OUTBOX_REJECTED_REVIEW_STATUS}
                          </span>
                        )}
                        {op.lastError || 'تعذر الاتصال بالخادم أثناء الرفع'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </CompactTable>
          )}
        </div>
      )}

      {/* التبويب الثالث: تحتاج مراجعة */}
      {activeTab === 'needs_review' && (
        <div className="space-y-6">
          {rejectedReviewOps.length > 0 && (
            <div className="space-y-3">
              <SectionHeading
                title={`عمليات محلية مرفوضة عند المزامنة — محفوظة للمراجعة (${rejectedReviewOps.length})`}
              />
              <p className="text-xs text-[var(--text-secondary)]">
                رُفضت هذه العمليات من الخادم عند المزامنة بسبب تحديث إعدادات البيع أو المنصات، وتم حفظها محليًا للمراجعة ولن تُحذف أو تُعاد محاولتها تلقائيًا.
              </p>
              <CompactTable ariaLabel="جدول العمليات المحلية المرفوضة عند المزامنة">
                <thead>
                  <tr>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>العملية</th>
                    <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم المستند المؤقت</th>
                    <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>وقت الجهاز</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المستخدم</th>
                    <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>القيمة</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الحالة</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>سبب الرفض</th>
                  </tr>
                </thead>
                <tbody>
                  {rejectedReviewOps.map((op) => {
                    const amount = getOperationMonetaryAmount(op);
                    const docNo =
                      op.invoiceNumber ||
                      op.payload?.offlineProvisionalNo ||
                      op.payload?.collectionId ||
                      op.id.slice(0, 8);
                    return (
                      <tr key={op.id}>
                        <td className={`font-bold ${COMPACT_TABLE_TEXT_CLASS}`}>
                          {getOperationTypeLabelAr(op)}
                        </td>
                        <td className={`font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>{docNo}</td>
                        <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                          {formatDateTimeAr(op.deviceTime || op.createdAt)}
                        </td>
                        <td className={`font-semibold ${COMPACT_TABLE_TEXT_CLASS}`}>
                          {op.userName || op.createdByUserName || 'كاشير'}
                        </td>
                        <td className={`text-left font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                          {amount > 0
                            ? `${amount.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })} ج.م`
                            : '—'}
                        </td>
                        <td className={`font-bold ui-stock-out ${COMPACT_TABLE_TEXT_CLASS}`}>
                          {OUTBOX_REJECTED_REVIEW_STATUS}
                        </td>
                        <td className={`font-semibold ui-stock-out ${COMPACT_TABLE_TEXT_CLASS}`}>
                          {op.lastError || 'رُفضت لتعارضها مع إعدادات البيع الحالية'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </CompactTable>
            </div>
          )}

          {needsReviewInvoices.length === 0 && rejectedReviewOps.length === 0 ? (
            <div className="py-8 text-xs text-[var(--text-secondary)]">
              لا توجد فواتير أو عمليات تحتاج إلى مراجعة من أي جهاز — جميع الفواتير المرفوعة تمت مطابقتها ومراجعتها.
            </div>
          ) : needsReviewInvoices.length > 0 ? (
            <CompactTable ariaLabel="جدول الفواتير التي تحتاج مراجعة">
              <thead>
                <tr>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم الفاتورة</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الجهاز</th>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>التاريخ</th>
                  <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>الصافي</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>السبب</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>إجراء المراجعة</th>
                </tr>
              </thead>
              <tbody>
                {needsReviewInvoices.map((inv) => {
                  const reasons =
                    Array.isArray(inv.reviewReasons) && inv.reviewReasons.length > 0
                      ? inv.reviewReasons.join('، ')
                      : 'رصيد سالب / عملية أوفلاين تحتاج مراجعة';
                  const devLabel =
                    inv.deviceName || inv.offlineDeviceId || inv.deviceId || 'جهاز نقطة بيع';
                  const isEditingNote = reviewingInvoiceNo === inv.invoiceNumber;
                  const isSubmitting = submittingReviewNo === inv.invoiceNumber;

                  return (
                    <tr key={inv.invoiceNumber}>
                      <td className={COMPACT_TABLE_NUM_CLASS}>
                        <div className="font-mono font-bold text-[var(--text-primary)]">
                          {inv.invoiceNumber}
                        </div>
                        {inv.offlineProvisionalNo &&
                          inv.offlineProvisionalNo !== inv.invoiceNumber && (
                            <div className="text-[11px] font-mono text-[var(--text-secondary)] mt-0.5">
                              المؤقت: {inv.offlineProvisionalNo}
                            </div>
                          )}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>
                        <div className="font-bold">{devLabel}</div>
                        {inv.createdBy && (
                          <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                            بواسطة: {inv.createdBy}
                          </div>
                        )}
                      </td>
                      <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatDateTimeAr(inv.deviceTime || inv.date)}
                      </td>
                      <td className={`text-left font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                        {Number(inv.netAmount || 0).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        ج.م
                      </td>
                      <td className={`font-semibold ui-stock-low ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {reasons}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>
                        {!isEditingNote ? (
                          <button
                            type="button"
                            onClick={() => setReviewingInvoiceNo(inv.invoiceNumber)}
                            disabled={Boolean(inv.offlinePending)}
                            title={
                              inv.offlinePending
                                ? 'يجب مزامنة الفاتورة مع الخادم أولًا قبل اعتماد المراجعة النهائية'
                                : 'اعتماد مراجعة الفاتورة مع إضافة ملاحظة'
                            }
                            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#168A4A] hover:bg-[#12703C] text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>تمت المراجعة</span>
                          </button>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={reviewNotesMap[inv.invoiceNumber] || ''}
                              onChange={(e) =>
                                setReviewNotesMap((prev) => ({
                                  ...prev,
                                  [inv.invoiceNumber]: e.target.value,
                                }))
                              }
                              placeholder="ملاحظة المراجعة (مثال: تمت مطابقة الرصيد)..."
                              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs`}
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => handleMarkReviewed(inv)}
                              disabled={isSubmitting}
                              className="min-h-[44px] px-3 rounded-lg bg-[#168A4A] hover:bg-[#12703C] text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                            >
                              {isSubmitting ? 'جاري الحفظ...' : 'تأكيد'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setReviewingInvoiceNo(null)}
                              disabled={isSubmitting}
                              className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
                            >
                              إلغاء
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </CompactTable>
          ) : null}
        </div>
      )}

      {/* العمليات الملغاة بسبب إعادة ضبط النظام (تبقى ظاهرة للمشرف ولا يُعاد رفعها) */}
      {(activeTab === 'pending' || activeTab === 'failed') && cancelledOps.length > 0 && (
        <div className="space-y-3 pt-4">
          <SectionHeading title={`عمليات ملغاة — سُجّلت قبل إعادة ضبط النظام (${cancelledOps.length})`} />
          <CompactTable ariaLabel="جدول العمليات الملغاة قبل إعادة ضبط النظام">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>العملية</th>
                <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم المستند المؤقت</th>
                <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>وقت الجهاز</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المستخدم</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>القيمة المالية</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الحالة</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>السبب</th>
              </tr>
            </thead>
            <tbody>
              {cancelledOps.map((op) => {
                const amount = getOperationMonetaryAmount(op);
                const docNo =
                  op.invoiceNumber ||
                  op.payload?.offlineProvisionalNo ||
                  op.payload?.collectionId ||
                  op.id.slice(0, 8);
                return (
                  <tr key={op.id}>
                    <td className={`font-bold ${COMPACT_TABLE_TEXT_CLASS}`}>
                      {getOperationTypeLabelAr(op)}
                    </td>
                    <td className={`font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>{docNo}</td>
                    <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {formatDateTimeAr(op.deviceTime || op.createdAt)}
                    </td>
                    <td className={`font-semibold ${COMPACT_TABLE_TEXT_CLASS}`}>
                      {op.userName || op.createdByUserName || 'كاشير'}
                    </td>
                    <td className={`text-left font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                      {amount > 0
                        ? `${amount.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })} ج.م`
                        : '—'}
                    </td>
                    <td className={`font-bold text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                      {op.status || OUTBOX_CANCELLED_BEFORE_RESET_STATUS}
                    </td>
                    <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                      {op.lastError || 'سُجّلت على الجهاز قبل إعادة ضبط النظام، ولن تُرفع.'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </CompactTable>
        </div>
      )}
    </PageSurface>
  );
};

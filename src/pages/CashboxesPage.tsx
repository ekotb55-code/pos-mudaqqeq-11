import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Cashbox,
  CashboxTransaction,
  CashboxTransfer,
  PageType,
  UserCashboxAssignment,
  UserAccount,
  UserRole,
} from '../types';
import { hasPermission } from '../utils/permissions';
import { api, subscribeApiStatus } from '../api/client';
import { generateIdempotencyKey } from '../utils/idempotency';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { DateRange, getDateRangeForPreset, isDateInRange, normalizeArabicText } from '../utils/dateUtils';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  ModalShell,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
} from '../components/ui';
import {
  ArrowRightLeft,
  Plus,
  Search,
  Download,
  Printer,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { ShortcutBadge } from '../context/KeyboardShortcutsContext';
import { BANK_LINK_SELECTED_ACCOUNT_STORAGE_KEY } from '../components/settings/BankLinkSection';
import { BANK_LINK_SELECTED_MANUAL_STORAGE_KEY } from '../components/ManualBalancePrompt';
import { getHrefForTarget, isPlainLeftClick } from '../config/navigation';

interface BankLinkedCashboxBadge {
  id: string;
  cashboxId: string;
  name: string;
  enabled: boolean;
}

interface CashboxesPageProps {
  user: UserAccount | null;
  userRole: UserRole;
  users?: UserAccount[];
  initialTab?: TabType;
  initialCashboxId?: string;
  onNavigate?: (
    page: PageType,
    tab?: string,
    options?: { searchParams?: Record<string, string | undefined>; replace?: boolean }
  ) => void;
  initialCashboxes?: Cashbox[];
  initialBankLinkedAccounts?: BankLinkedCashboxBadge[];
  initialManualBalanceAccounts?: BankLinkedCashboxBadge[];
}

type TabType = 'CASHBOXES' | 'TRANSACTIONS' | 'TRANSFER' | 'ASSIGNMENTS';

export const CashboxesPage: React.FC<CashboxesPageProps> = ({
  user,
  userRole,
  users = [],
  initialTab,
  initialCashboxId,
  onNavigate,
  initialCashboxes,
  initialBankLinkedAccounts,
  initialManualBalanceAccounts,
}) => {
  const isDesigner = user?.role === 'designer' || Boolean(user?.isOwner);
  const isManager = isDesigner || userRole === 'manager';
  const canTransfer = isDesigner || hasPermission(user, 'cashbox.transfer');
  const canManageBankLink = isDesigner || hasPermission(user, 'settings.bank_link');

  const [activeTab, setActiveTab] = useState<TabType>(initialTab || 'CASHBOXES');

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const [cashboxes, setCashboxes] = useState<Cashbox[]>(initialCashboxes || []);
  const [bankLinkedAccounts, setBankLinkedAccounts] = useState<BankLinkedCashboxBadge[]>(
    initialBankLinkedAccounts || []
  );
  const [manualBalanceAccounts, setManualBalanceAccounts] = useState<BankLinkedCashboxBadge[]>(
    initialManualBalanceAccounts || []
  );
  const [transactions, setTransactions] = useState<CashboxTransaction[]>([]);
  const [transfers, setTransfers] = useState<CashboxTransfer[]>([]);
  const [assignments, setAssignments] = useState<UserCashboxAssignment[]>([]);
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>(() => initialCashboxId || 'ALL');

  useEffect(() => {
    if (initialCashboxId !== undefined) {
      setSelectedCashboxId(initialCashboxId || 'ALL');
    }
  }, [initialCashboxId]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);
  const [transferError, setTransferError] = useState<{ message: string; isUnknownResult: boolean } | null>(null);
  const transferIdemKeyRef = useRef<string>(generateIdempotencyKey());
  const transferFormRef = useRef<HTMLFormElement>(null);

  // فلاتر البحث والتاريخ (الافتراضي THIS_MONTH)
  const [searchQuery, setSearchQuery] = useState('');
  const [txDateRange, setTxDateRange] = useState<DateRange>(() => getDateRangeForPreset('THIS_MONTH'));
  const [transfersDateRange, setTransfersDateRange] = useState<DateRange>(() => getDateRangeForPreset('THIS_MONTH'));

  // نوافذ
  const [isCashboxModalOpen, setIsCashboxModalOpen] = useState(false);
  const [editingCashbox, setEditingCashbox] = useState<Cashbox | null>(null);
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const range = activeTab === 'TRANSFER' ? transfersDateRange : txDateRange;
      const [cbRes, txRes, asRes, bankRes, manualRes] = await Promise.all([
        api.getCashboxes().catch(() => ({ success: false, cashboxes: [] })),
        api
          .getCashboxTransactions(selectedCashboxId || 'ALL', {
            from: range.from,
            to: range.to,
          })
          .catch(() => ({ success: false, transactions: [], transfers: [] })),
        api.getUserCashboxAssignments().catch(() => ({ success: false, assignments: [] })),
        canManageBankLink
          ? api.getBankLinkOverview().catch(() => null)
          : Promise.resolve(null),
        canManageBankLink
          ? api.getManualBalanceOverview().catch(() => null)
          : Promise.resolve(null),
      ]);

      if (cbRes.success) setCashboxes(cbRes.cashboxes);
      if (txRes.success) {
        setTransactions(txRes.transactions || []);
        if (txRes.transfers) setTransfers(txRes.transfers);
      }
      if (asRes.success) setAssignments(asRes.assignments);
      if (bankRes?.success && Array.isArray(bankRes.accounts)) {
        setBankLinkedAccounts(
          bankRes.accounts.map((a) => ({
            id: a.id,
            cashboxId: a.cashboxId,
            name: a.name,
            enabled: a.enabled,
          }))
        );
      }
      if (manualRes?.success && Array.isArray(manualRes.accounts)) {
        setManualBalanceAccounts(
          manualRes.accounts.map((a) => ({
            id: a.id,
            cashboxId: a.cashboxId,
            name: a.name,
            enabled: a.enabled,
          }))
        );
      }
    } catch (err: any) {
      console.error('فشل جلب بيانات الخزائن:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedCashboxId, txDateRange.from, txDateRange.to, transfersDateRange.from, transfersDateRange.to, activeTab]);

  useEffect(() => {
    return subscribeApiStatus((event) => {
      if (event.type === 'MANUAL_BALANCE_UPDATED') {
        loadData();
      }
    });
  }, []);

  const showNotification = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // إحصائيات
  const totalBalance = cashboxes.reduce((sum, cb) => sum + cb.currentBalance, 0);

  const filteredTransactions = useMemo(() => {
    const normQ = normalizeArabicText(searchQuery);
    return transactions.filter((t) => {
      if (!isDateInRange(t.date, txDateRange.from, txDateRange.to)) {
        return false;
      }
      if (selectedCashboxId !== 'ALL' && t.cashboxId !== selectedCashboxId) {
        return false;
      }
      if (!normQ) return true;
      const typeStr = t.type || t.transactionType || '';
      const haystack = normalizeArabicText(
        `${typeStr} ${t.cashboxName || ''} ${t.documentNumber || ''} ${t.notes || ''} ${t.statement || ''} ${t.userName || ''}`
      );
      return haystack.includes(normQ);
    });
  }, [transactions, searchQuery, txDateRange.from, txDateRange.to, selectedCashboxId]);

  const filteredTransfers = useMemo(() => {
    return transfers.filter((tr) => isDateInRange(tr.date, transfersDateRange.from, transfersDateRange.to));
  }, [transfers, transfersDateRange.from, transfersDateRange.to]);

  // إجماليات الفترة فوق جدول الحركات: إجمالي الوارد، إجمالي الصادر، صافي الفترة
  const periodCashStats = useMemo(() => {
    let totalInward = 0;
    let totalOutward = 0;
    for (const t of filteredTransactions) {
      const amt = Number(t.amount) || 0;
      if (amt > 0) {
        totalInward += amt;
      } else if (amt < 0) {
        totalOutward += Math.abs(amt);
      }
    }
    return {
      totalInward: Number(totalInward.toFixed(2)),
      totalOutward: Number(totalOutward.toFixed(2)),
      netPeriod: Number((totalInward - totalOutward).toFixed(2)),
    };
  }, [filteredTransactions]);

  const totalTransfersAmount = useMemo(
    () => filteredTransfers.reduce((s, tr) => s + (tr.amount || 0), 0),
    [filteredTransfers]
  );

  const handleExportTransactions = () => {
    if (filteredTransactions.length === 0) return;
    const rows = filteredTransactions.map((t) => ({
      'التاريخ': t.date,
      'الخزينة': t.cashboxName,
      'نوع الحركة': t.type || t.transactionType || '',
      'المبلغ': t.amount,
      'الرصيد بعدها': t.balanceAfter,
      'رقم المستند': t.documentNumber || '',
      'المستخدم': t.userName,
      'البيان': t.statement || t.notes || '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'حركات_الخزينة');
    XLSX.writeFile(wb, `حركات_الخزينة_${txDateRange.from || new Date().toISOString().slice(0, 10)}.xlsx`);
    showNotification('success', 'تم تصدير سجل الحركات بنجاح');
  };

  const cashboxHeaderMeta: Record<TabType, { title: string; subtitle: string }> = {
    CASHBOXES: {
      title: 'الخزائن والحسابات',
      subtitle: 'صناديق الكاشير والحسابات البنكية والأرصدة الحالية لكل خزينة',
    },
    TRANSACTIONS: {
      title: 'سجل الحركات النقدية',
      subtitle: 'متابعة الوارد والصادر والرصيد التراكمي لحركات الخزائن',
    },
    TRANSFER: {
      title: 'تحويل بين الخزائن',
      subtitle: 'تنفيذ ومراجعة التحويلات النقدية الداخلية بين الخزائن والحسابات',
    },
    ASSIGNMENTS: {
      title: 'تعيينات المستخدمين على الخزائن',
      subtitle: 'ربط المستخدمين بالخزائن المسموح لهم بالتعامل عليها',
    },
  };

  return (
    <PageSurface
      title={cashboxHeaderMeta[activeTab].title}
      subtitle={cashboxHeaderMeta[activeTab].subtitle}
      actions={
        (isManager || canTransfer) ? (
          <>
            {canTransfer && activeTab !== 'TRANSFER' && (
              <a
                href={getHrefForTarget('cashboxes', 'TRANSFER')}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return;
                  e.preventDefault();
                  if (onNavigate) onNavigate('cashboxes', 'TRANSFER');
                  else setActiveTab('TRANSFER');
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] font-bold text-xs transition cursor-pointer"
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>تحويل بين الخزائن</span>
              </a>
            )}

            {isManager && activeTab === 'CASHBOXES' && (
              <button
                type="button"
                data-shortcut-add="true"
                onClick={() => {
                  setEditingCashbox(null);
                  setIsCashboxModalOpen(true);
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة خزينة / حساب</span>
                <ShortcutBadge actionId="general.add_new" className="!text-white/90 !border-white/35 !bg-white/10" />
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {statusMessage && (
        <div
          className={`no-print p-3 rounded-lg border text-xs font-bold flex items-center gap-2 ${
            statusMessage.type === 'success'
              ? 'border-emerald-300 text-emerald-800 bg-emerald-50/40'
              : 'border-rose-300 ui-stock-out bg-rose-50/40'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Compact single-line summary */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-3 border-b border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-secondary)]">
        <span>
          إجمالي السيولة:{' '}
          <strong className="font-mono ui-money-sale">{totalBalance.toLocaleString()} ج.م</strong>
        </span>
        <span>·</span>
        <span>
          الخزائن النشطة: <strong className="font-mono text-[var(--text-primary)]">{cashboxes.length}</strong>
        </span>
        <span>·</span>
        <span>
          الحركات: <strong className="font-mono text-[var(--text-primary)]">{filteredTransactions.length}</strong>
        </span>
        <span>·</span>
        <span>
          تعيينات الكاشير: <strong className="font-mono text-[var(--text-primary)]">{assignments.length}</strong>
        </span>
        {isLoading && <span className="text-[11px]">جاري التحديث...</span>}
      </div>

      {/* TAB 1: CASHBOXES */}
      {activeTab === 'CASHBOXES' && (
        <div className="space-y-4">
          <SectionHeading title={`الخزائن والحسابات (${cashboxes.length})`} />
          <CompactTable ariaLabel="جدول الخزائن والحسابات">
            <thead>
              <tr>
                <th>الخزينة / الحساب</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>العملة</th>
                <th>المسؤول</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد الافتتاحي</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد الفعلي الحالي</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الحالة</th>
                <th className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {cashboxes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد خزائن مسجلة
                  </td>
                </tr>
              ) : (
                cashboxes.map((cb) => {
                  const linkedBank = bankLinkedAccounts.find((a) => a.cashboxId === cb.id);
                  const linkedManual = manualBalanceAccounts.find((a) => a.cashboxId === cb.id);
                  return (
                  <tr key={cb.id}>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>
                      <div>{cb.name}</div>
                      {linkedBank && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold">
                          <span
                            className={
                              linkedBank.enabled
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }
                          >
                            {linkedBank.enabled ? 'مربوطة برسائل البنك' : 'الربط موقوف'}
                          </span>
                          {canManageBankLink && (
                            <>
                              <span aria-hidden="true" className="text-[var(--text-secondary)]">·</span>
                              <a
                                href={getHrefForTarget('settings', 'bank_link')}
                                onClick={(e) => {
                                  if (typeof sessionStorage !== 'undefined') {
                                    sessionStorage.setItem(BANK_LINK_SELECTED_ACCOUNT_STORAGE_KEY, linkedBank.id);
                                  }
                                  if (!isPlainLeftClick(e)) return;
                                  e.preventDefault();
                                  if (onNavigate) onNavigate('settings', 'bank_link');
                                }}
                                className="ui-link underline underline-offset-2 font-bold cursor-pointer"
                              >
                                تفاصيل الربط
                              </a>
                            </>
                          )}
                        </div>
                      )}
                      {linkedManual && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold">
                          <span
                            className={
                              linkedManual.enabled
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }
                          >
                            {linkedManual.enabled ? 'متابعة برصيد يدوي' : 'المتابعة موقوفة'}
                          </span>
                          {canManageBankLink && (
                            <>
                              <span aria-hidden="true" className="text-[var(--text-secondary)]">·</span>
                              <a
                                href={getHrefForTarget('settings', 'bank_link')}
                                onClick={(e) => {
                                  if (typeof sessionStorage !== 'undefined') {
                                    sessionStorage.setItem(BANK_LINK_SELECTED_MANUAL_STORAGE_KEY, linkedManual.id);
                                  }
                                  if (!isPlainLeftClick(e)) return;
                                  e.preventDefault();
                                  if (onNavigate) onNavigate('settings', 'bank_link');
                                }}
                                className="ui-link underline underline-offset-2 font-bold cursor-pointer"
                              >
                                تفاصيل المتابعة
                              </a>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>{cb.currency}</td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{cb.responsibleUserName || 'غير محدد'}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {cb.openingBalance.toLocaleString()} {cb.currency}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-sale`}>
                      {cb.currentBalance.toLocaleString()} {cb.currency}
                    </td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>{cb.status}</td>
                    <td className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>
                      <div className="inline-flex items-center gap-1.5">
                        <a
                          href={getHrefForTarget('cashboxes', 'TRANSACTIONS', {
                            searchParams: { cashboxId: cb.id }
                          })}
                          onClick={(e) => {
                            if (!isPlainLeftClick(e)) return;
                            e.preventDefault();
                            setSelectedCashboxId(cb.id);
                            if (onNavigate) {
                              onNavigate('cashboxes', 'TRANSACTIONS', {
                                searchParams: { cashboxId: cb.id }
                              });
                            } else {
                              setActiveTab('TRANSACTIONS');
                            }
                          }}
                          className="min-h-[44px] inline-flex items-center px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-link text-xs font-bold cursor-pointer"
                        >
                          الحركات
                        </a>
                        {isManager && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCashbox(cb);
                              setIsCashboxModalOpen(true);
                            }}
                            className="min-h-[44px] px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer"
                          >
                            تعديل
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
            {cashboxes.length > 0 && (
              <tfoot>
                <tr className="font-bold border-t border-[var(--border-color)]">
                  <td colSpan={4} className="py-2.5 px-3 text-xs">
                    الإجمالي الكلي للخزائن ({cashboxes.length})
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} py-2.5 px-3 font-mono ui-money-sale`}>
                    {totalBalance.toLocaleString()} ج.م
                  </td>
                  <td />
                  <td className="no-print" />
                </tr>
              </tfoot>
            )}
          </CompactTable>
        </div>
      )}

      {/* TAB 2: TRANSACTIONS */}
      {activeTab === 'TRANSACTIONS' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 pb-3 border-b border-[var(--border-subtle)]">
            <DateRangeFilter
              inline
              value={txDateRange}
              onChange={setTxDateRange}
              storageKey="cashbox_transactions"
              defaultPreset="THIS_MONTH"
            />

            <div className="no-print flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">الخزينة</label>
                <select
                  value={selectedCashboxId}
                  onChange={(e) => setSelectedCashboxId(e.target.value)}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold`}
                >
                  <option value="ALL">كل الخزن (المسموحة)</option>
                  {cashboxes.map((cb) => (
                    <option key={cb.id} value={cb.id}>
                      {cb.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">بحث</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="نوع الحركة، المستند، البيان..."
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} pr-9 text-xs`}
                  />
                  <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportTransactions}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold transition cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>تصدير Excel</span>
              </button>

              <button
                type="button"
                data-shortcut-print="true"
                onClick={() => window.print()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة</span>
                <ShortcutBadge actionId="general.print_page" />
              </button>
            </div>

            <div className="print-only print-filter-summary">
              الخزينة: {selectedCashboxId === 'ALL' ? 'كل الخزن' : cashboxes.find(cb => cb.id === selectedCashboxId)?.name || selectedCashboxId}
              {searchQuery.trim() ? ` • البحث: ${searchQuery.trim()}` : ''}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]">
            <span>
              إجمالي الوارد (الفترة):{' '}
              <strong className="font-mono ui-money-purchase">+{periodCashStats.totalInward.toLocaleString()} ج.م</strong>
            </span>
            <span>·</span>
            <span>
              إجمالي الصادر (الفترة):{' '}
              <strong className="font-mono ui-stock-out">-{periodCashStats.totalOutward.toLocaleString()} ج.م</strong>
            </span>
            <span>·</span>
            <span>
              صافي الفترة:{' '}
              <strong className={`font-mono ${periodCashStats.netPeriod >= 0 ? 'ui-money-sale' : 'ui-stock-out'}`}>
                {periodCashStats.netPeriod >= 0
                  ? `+${periodCashStats.netPeriod.toLocaleString()}`
                  : periodCashStats.netPeriod.toLocaleString()}{' '}
                ج.م
              </strong>
            </span>
          </div>

          <CompactTable ariaLabel="سجل الحركات النقدية">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
                <th>الخزينة</th>
                <th>نوع الحركة</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>المبلغ</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد بعدها</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>رقم المستند</th>
                <th>المستخدم</th>
                <th>البيان</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد حركات نقدية مسجلة في الفترة المختارة
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((t) => {
                  const isPositive = t.amount > 0;
                  return (
                    <tr key={t.id}>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                        {t.date.slice(0, 10)}
                      </td>
                      <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{t.cashboxName}</td>
                      <td className={`${COMPACT_TABLE_TEXT_CLASS} font-semibold ${isPositive ? 'ui-money-purchase' : 'ui-stock-out'}`}>
                        {t.type || t.transactionType}
                      </td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ${isPositive ? 'ui-money-purchase' : 'ui-stock-out'}`}>
                        {isPositive ? `+${t.amount.toLocaleString()}` : t.amount.toLocaleString()} ج.م
                      </td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono`}>
                        {t.balanceAfter.toLocaleString()} ج.م
                      </td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-link font-bold`}>
                        {t.documentNumber || '-'}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{t.userName}</td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{t.statement || t.notes || '-'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredTransactions.length > 0 && (
              <tfoot>
                <tr className="font-bold border-t border-[var(--border-color)]">
                  <td colSpan={3} className="py-2.5 px-3 text-xs">
                    صافي الحركات المعروضة ({filteredTransactions.length})
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} py-2.5 px-3 font-mono ${periodCashStats.netPeriod >= 0 ? 'ui-money-purchase' : 'ui-stock-out'}`}>
                    {periodCashStats.netPeriod >= 0
                      ? `+${periodCashStats.netPeriod.toLocaleString()}`
                      : periodCashStats.netPeriod.toLocaleString()}{' '}
                    ج.م
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            )}
          </CompactTable>
        </div>
      )}

      {/* TAB 3: TRANSFER */}
      {activeTab === 'TRANSFER' && (
        <div className="space-y-5">
          <SectionHeading title="تحويل رصيد نقدي بين الخزائن" />

          {transferError && (
            <div className="p-3 rounded-lg border border-rose-300 ui-stock-out bg-rose-50/40 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{transferError.message}</span>
              </div>
              {transferError.isUnknownResult && (
                <button
                  type="button"
                  onClick={() => transferFormRef.current?.requestSubmit()}
                  disabled={isSubmittingTransfer}
                  className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSubmittingTransfer ? 'animate-spin' : ''}`} />
                  <span>إعادة المحاولة</span>
                </button>
              )}
            </div>
          )}

          <form
            ref={transferFormRef}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.target as any;
              const fromCashboxId = form.fromCashboxId.value;
              const toCashboxId = form.toCashboxId.value;
              const amount = Number(form.amount.value);
              const fee = Number(form.fee.value || 0);
              const notes = form.notes.value;

              if (fromCashboxId === toCashboxId) {
                showNotification('error', 'لا يمكن التحويل لنفس الخزينة');
                setTransferError({ message: 'لا يمكن التحويل لنفس الخزينة', isUnknownResult: false });
                return;
              }

              setIsSubmittingTransfer(true);
              setTransferError(null);
              try {
                const res = await api.createCashboxTransfer({
                  fromCashboxId,
                  toCashboxId,
                  amount,
                  fee,
                  notes,
                  idempotencyKey: transferIdemKeyRef.current,
                });

                if (res.success) {
                  transferIdemKeyRef.current = generateIdempotencyKey();
                  showNotification('success', 'تم التحويل بنجاح وتحديث أرصدة الخزائن');
                  form.reset();
                  loadData();
                } else {
                  const msg = res.error || 'فشل تنفيذ التحويل';
                  setTransferError({ message: msg, isUnknownResult: res.code === 'UNKNOWN_RESULT' });
                  showNotification('error', msg);
                }
              } catch (err: any) {
                const msg = err.message || 'خطأ أثناء الاتصال';
                setTransferError({ message: msg, isUnknownResult: err?.code === 'UNKNOWN_RESULT' });
                showNotification('error', msg);
              } finally {
                setIsSubmittingTransfer(false);
              }
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">من خزينة *</label>
              <select
                name="fromCashboxId"
                required
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
              >
                <option value="">-- اختر الخزينة المرسلة --</option>
                {cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>
                    {cb.name} (رصيدها: {cb.currentBalance} ج.م)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">إلى خزينة *</label>
              <select
                name="toCashboxId"
                required
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
              >
                <option value="">-- اختر الخزينة المستقبلة --</option>
                {cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>
                    {cb.name} (رصيدها: {cb.currentBalance} ج.م)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">المبلغ (ج.م) *</label>
              <input
                type="number"
                name="amount"
                min="0.5"
                step="0.5"
                required
                placeholder="0.00"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs font-bold font-mono`}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">عمولة التحويل</label>
              <input
                type="number"
                name="fee"
                min="0"
                step="0.5"
                placeholder="0.00"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs font-mono`}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">البيان والملاحظات</label>
              <input
                type="text"
                name="notes"
                placeholder="سبب التحويل أو رقم إذن الصرف..."
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmittingTransfer}
              className="min-h-[44px] px-5 rounded-lg bg-cyan-700 hover:bg-cyan-800 disabled:opacity-50 text-white font-bold text-xs transition cursor-pointer"
            >
              {isSubmittingTransfer ? 'جاري التنفيذ...' : 'تأكيد وتنفيذ التحويل'}
            </button>
          </form>

          <SectionHeading
            withTopDivider
            title={`سجل التحويلات الداخلية بين الخزائن (${filteredTransfers.length}) · الإجمالي: ${totalTransfersAmount.toLocaleString()} ج.م`}
          />

          <DateRangeFilter
            inline
            value={transfersDateRange}
            onChange={setTransfersDateRange}
            storageKey="cashbox_transfers"
            defaultPreset="THIS_MONTH"
          />

          <CompactTable ariaLabel="سجل التحويلات بين الخزائن">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
                <th>من خزينة</th>
                <th>إلى خزينة</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>المبلغ المحول</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>العمولة</th>
                <th>المستخدم</th>
                <th>البيان</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransfers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد تحويلات مسجلة في الفترة المختارة
                  </td>
                </tr>
              ) : (
                filteredTransfers.map((tr) => (
                  <tr key={tr.id}>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {tr.date.slice(0, 10)}
                    </td>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold ui-stock-out`}>{tr.fromCashboxName}</td>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold ui-money-purchase`}>{tr.toCashboxName}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono`}>{tr.amount.toLocaleString()} ج.م</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {(tr.transferFee ?? tr.fee ?? 0) > 0
                        ? `${(tr.transferFee ?? tr.fee ?? 0).toLocaleString()} ج.م`
                        : '-'}
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{tr.userName || tr.createdBy || '-'}</td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{tr.statement || tr.notes || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredTransfers.length > 0 && (
              <tfoot>
                <tr className="font-bold border-t border-[var(--border-color)]">
                  <td colSpan={3} className="py-2.5 px-3 text-xs">
                    الإجمالي ({filteredTransfers.length})
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} py-2.5 px-3 font-mono ui-money-sale`}>
                    {totalTransfersAmount.toLocaleString()} ج.م
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </CompactTable>
        </div>
      )}

      {/* TAB 4: ASSIGNMENTS */}
      {activeTab === 'ASSIGNMENTS' && (
        <div className="space-y-4">
          <SectionHeading
            title={`تعيينات الخزائن للمستخدمين (${assignments.length})`}
            actions={
              isManager ? (
                <button
                  type="button"
                  onClick={() => setIsAssignmentModalOpen(true)}
                  className="no-print min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>تعيين جديد</span>
                </button>
              ) : undefined
            }
          />

          <CompactTable ariaLabel="جدول تعيينات الخزائن للمستخدمين">
            <thead>
              <tr>
                <th>المستخدم</th>
                <th>الخزينة المخصصة</th>
                <th>نوع الصلاحية</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>افتراضية</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد تعيينات مسجلة
                  </td>
                </tr>
              ) : (
                assignments.map((a) => (
                  <tr key={a.id}>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{a.userName}</td>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-semibold`}>{a.cashboxName}</td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{a.permissionType}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold ${a.isDefault ? 'ui-money-purchase' : 'text-[var(--text-secondary)]'}`}>
                      {a.isDefault ? 'نعم (افتراضية)' : 'لا'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* MODAL: ADD / EDIT CASHBOX */}
      {isCashboxModalOpen && (
        <CashboxModal
          cashbox={editingCashbox}
          onClose={() => setIsCashboxModalOpen(false)}
          onSuccess={() => {
            setIsCashboxModalOpen(false);
            loadData();
            showNotification('success', 'تم حفظ الخزينة بنجاح');
          }}
        />
      )}

      {/* MODAL: ADD ASSIGNMENT */}
      {isAssignmentModalOpen && (
        <AssignmentModal
          cashboxes={cashboxes}
          users={users}
          onClose={() => setIsAssignmentModalOpen(false)}
          onSuccess={() => {
            setIsAssignmentModalOpen(false);
            loadData();
            showNotification('success', 'تم حفظ تعيين الخزينة بنجاح');
          }}
        />
      )}
    </PageSurface>
  );
};

// مودال خزينة جديدة
interface CashboxModalProps {
  cashbox: Cashbox | null;
  onClose: () => void;
  onSuccess: () => void;
}

const CashboxModal: React.FC<CashboxModalProps> = ({ cashbox, onClose, onSuccess }) => {
  const [name, setName] = useState(cashbox?.name || '');
  const [currency, setCurrency] = useState(cashbox?.currency || 'EGP');
  const [openingBalance, setOpeningBalance] = useState<number>(cashbox?.openingBalance || 0);
  const [responsibleUserName, setResponsibleUserName] = useState(cashbox?.responsibleUserName || '');
  const [notes, setNotes] = useState(cashbox?.notes || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await api.saveCashbox({
        id: cashbox?.id,
        name: name.trim(),
        currency,
        openingBalance: Number(openingBalance || 0),
        responsibleUserName: responsibleUserName.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (res.success) {
        onSuccess();
      } else {
        setError(res.error || 'تعذر حفظ بيانات الخزينة');
      }
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء الاتصال بالخادم');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={cashbox ? `تعديل خزينة: ${cashbox.name}` : 'إضافة خزينة أو حساب بنكي جديد'}
      onClose={onClose}
      closeDisabled={isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="p-2.5 rounded-lg border border-rose-300 ui-stock-out bg-rose-50/40 text-xs font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">اسم الخزينة / الحساب *</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: خزينة نقطة بيع 1، حساب بنك مصر..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">العملة</label>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs font-bold`}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الرصيد الافتتاحي</label>
            <input
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(Number(e.target.value))}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs font-bold font-mono`}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">اسم المسؤول</label>
          <input
            type="text"
            value={responsibleUserName}
            onChange={(e) => setResponsibleUserName(e.target.value)}
            placeholder="اسم الكاشير أو المسؤول..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">ملاحظات</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات الحساب..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
          />
        </div>

        <div className="pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-[44px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? 'جاري الحفظ...' : 'حفظ الخزينة'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

// مودال تعيين خزينة لمستخدم
interface AssignmentModalProps {
  cashboxes: Cashbox[];
  users: UserAccount[];
  onClose: () => void;
  onSuccess: () => void;
}

const AssignmentModal: React.FC<AssignmentModalProps> = ({
  cashboxes,
  users,
  onClose,
  onSuccess,
}) => {
  const [userId, setUserId] = useState(users[0]?.id || '');
  const [cashboxId, setCashboxId] = useState(cashboxes[0]?.id || '');
  const [permissionType, setPermissionType] = useState<'إيداع فقط' | 'سحب فقط' | 'إيداع وسحب' | 'إدارة كاملة'>('إيداع وسحب');
  const [isDefault, setIsDefault] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !cashboxId) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await api.saveUserCashboxAssignment({
        userId,
        cashboxId,
        permissionType,
        isDefault,
      });
      if (res.success) {
        onSuccess();
      } else {
        setError(res.error || 'تعذر حفظ تعيين الخزينة');
      }
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء الاتصال بالخادم');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="تعيين خزينة لمستخدم"
      onClose={onClose}
      closeDisabled={isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="p-2.5 rounded-lg border border-rose-300 ui-stock-out bg-rose-50/40 text-xs font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">المستخدم *</label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
          >
            <option value="">-- اختر المستخدم --</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.username})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الخزينة المخصصة *</label>
          <select
            value={cashboxId}
            onChange={(e) => setCashboxId(e.target.value)}
            required
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
          >
            <option value="">-- اختر الخزينة --</option>
            {cashboxes.map((cb) => (
              <option key={cb.id} value={cb.id}>
                {cb.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">نوع الصلاحية على الخزينة</label>
          <select
            value={permissionType}
            onChange={(e) => setPermissionType(e.target.value as any)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs`}
          >
            <option value="إيداع وسحب">إيداع وسحب (مبيعات ومرتجعات)</option>
            <option value="إيداع فقط">إيداع فقط (مبيعات فقط)</option>
            <option value="سحب فقط">سحب فقط</option>
            <option value="إدارة كاملة">إدارة كاملة</option>
          </select>
        </div>

        <label className="min-h-[44px] flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="w-4 h-4 rounded text-cyan-700"
          />
          <span className="text-xs font-bold text-[var(--text-primary)]">
            تعيين كخزينة افتراضية لهذا المستخدم في POS
          </span>
        </label>

        <div className="pt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-[44px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? 'جاري الحفظ...' : 'حفظ التعيين'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

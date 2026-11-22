import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Customer,
  CustomerGroup,
  CustomerLedgerEntry,
  Cashbox,
  PageType,
  UserAccount,
  UserRole,
  DeliveryConfigZoneOption,
} from '../types';
import { api } from '../api/client';
import { generateIdempotencyKey } from '../utils/idempotency';
import { DateRangeFilter } from '../components/DateRangeFilter';
import CreditCollectionView from '../components/CreditCollectionView';
import { DateRange, getDateRangeForPreset, normalizeArabicText } from '../utils/dateUtils';
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
import { useRegisterShortcuts, ShortcutBadge } from '../context/KeyboardShortcutsContext';
import {
  Plus,
  Download,
  Printer,
  Search,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { getHrefForTarget, isPlainLeftClick } from '../config/navigation';

interface CustomersPageProps {
  user: UserAccount | null;
  userRole: UserRole;
  initialTab?: TabType;
  initialCustomerId?: string;
  onNavigate?: (
    page: PageType,
    tab?: string,
    options?: { searchParams?: Record<string, string | undefined>; replace?: boolean }
  ) => void;
}

type TabType =
  | 'CUSTOMERS'
  | 'GROUPS'
  | 'BALANCES'
  | 'STATEMENT'
  | 'CREDIT_COLLECTION'
  | 'RECEIPT_VOUCHER'
  | 'PAYMENT_VOUCHER';

export const CustomersPage: React.FC<CustomersPageProps> = ({
  user,
  userRole,
  initialTab,
  initialCustomerId,
  onNavigate,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab || 'CUSTOMERS');

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerGroups, setCustomerGroups] = useState<CustomerGroup[]>([]);
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [selectedCustomerIdForLedger, setSelectedCustomerIdForLedger] = useState<string>(() => initialCustomerId || '');

  useEffect(() => {
    if (initialCustomerId) {
      setSelectedCustomerIdForLedger(initialCustomerId);
    }
  }, [initialCustomerId]);
  const [customerLedger, setCustomerLedger] = useState<CustomerLedgerEntry[]>([]);
  const [ledgerOpeningBalanceForPeriod, setLedgerOpeningBalanceForPeriod] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSubmittingVoucher, setIsSubmittingVoucher] = useState(false);
  const [voucherError, setVoucherError] = useState<{ message: string; isUnknownResult: boolean } | null>(null);
  const voucherIdemKeyRef = useRef<string>(generateIdempotencyKey());
  const voucherFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    voucherIdemKeyRef.current = generateIdempotencyKey();
    setVoucherError(null);
  }, [activeTab]);

  // فلاتر البحث والتاريخ (الافتراضي THIS_MONTH)
  const [searchQuery, setSearchQuery] = useState('');
  const [ledgerDateRange, setLedgerDateRange] = useState<DateRange>(() => getDateRangeForPreset('THIS_MONTH'));
  const [vouchersDateRange, setVouchersDateRange] = useState<DateRange>(() => getDateRangeForPreset('THIS_MONTH'));

  // نماذج المودال
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [custRes, grpRes, cbRes] = await Promise.all([
        api.getCustomers().catch(() => ({ success: false, customers: [] })),
        api.getCustomerGroups().catch(() => ({ success: false, groups: [] })),
        api.getCashboxes().catch(() => ({ success: false, cashboxes: [] })),
      ]);

      if (custRes.success) setCustomers(custRes.customers);
      if (grpRes.success) setCustomerGroups(grpRes.groups);
      if (cbRes.success) setCashboxes(cbRes.cashboxes);

      if (custRes.customers.length > 0 && !selectedCustomerIdForLedger && !initialCustomerId) {
        setSelectedCustomerIdForLedger(custRes.customers[0].id);
      }
    } catch (err: any) {
      console.error('فشل تحميل بيانات العملاء:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // جلب كشف حساب العميل عند تغيير العميل أو الفترة أو التبويب
  useEffect(() => {
    if (
      selectedCustomerIdForLedger &&
      (activeTab === 'STATEMENT' ||
        activeTab === 'CUSTOMERS' ||
        activeTab === 'RECEIPT_VOUCHER' ||
        activeTab === 'PAYMENT_VOUCHER')
    ) {
      const range =
        activeTab === 'RECEIPT_VOUCHER' || activeTab === 'PAYMENT_VOUCHER'
          ? vouchersDateRange
          : ledgerDateRange;
      api
        .getCustomerLedger(selectedCustomerIdForLedger, {
          from: range.from,
          to: range.to,
        })
        .then((res) => {
          if (res.success) {
            setCustomerLedger(res.ledger || []);
            setLedgerOpeningBalanceForPeriod(res.openingBalanceForPeriod ?? 0);
          }
        })
        .catch(() => {});
    }
  }, [
    selectedCustomerIdForLedger,
    ledgerDateRange.from,
    ledgerDateRange.to,
    vouchersDateRange.from,
    vouchersDateRange.to,
    activeTab,
  ]);

  const showNotification = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  // إحصائيات
  const totalDebts = customers.reduce((sum, c) => sum + (c.currentBalance > 0 ? c.currentBalance : 0), 0);
  const totalCredits = customers.reduce((sum, c) => sum + (c.currentBalance < 0 ? Math.abs(c.currentBalance) : 0), 0);

  // حساب سطور كشف حساب العميل مع رصيد أول المدة والرصيد التراكمي
  const isLedgerFilteredByDate = Boolean(ledgerDateRange.from || ledgerDateRange.to);
  const computedCustomerLedgerRows = useMemo(() => {
    let running = isLedgerFilteredByDate ? ledgerOpeningBalanceForPeriod : 0;
    return customerLedger.map((entry) => {
      if (isLedgerFilteredByDate) {
        running = Number((running + (Number(entry.debit) || 0) - (Number(entry.credit) || 0)).toFixed(2));
        return { ...entry, computedBalanceAfter: running };
      }
      running = Number(entry.balanceAfter ?? running);
      return { ...entry, computedBalanceAfter: running };
    });
  }, [customerLedger, isLedgerFilteredByDate, ledgerOpeningBalanceForPeriod]);

  const finalCustomerClosingBalance = useMemo(() => {
    if (computedCustomerLedgerRows.length > 0) {
      return computedCustomerLedgerRows[computedCustomerLedgerRows.length - 1].computedBalanceAfter;
    }
    const curCust = customers.find((c) => c.id === selectedCustomerIdForLedger);
    return isLedgerFilteredByDate ? ledgerOpeningBalanceForPeriod : curCust?.currentBalance ?? 0;
  }, [computedCustomerLedgerRows, isLedgerFilteredByDate, ledgerOpeningBalanceForPeriod, customers, selectedCustomerIdForLedger]);

  const filteredCustomers = useMemo(() => {
    const normQ = normalizeArabicText(searchQuery);
    return customers.filter((c) => {
      if (!normQ) return true;
      const haystack = normalizeArabicText(`${c.name || ''} ${c.phone || ''} ${c.code || ''} ${c.taxNumber || ''}`);
      return haystack.includes(normQ);
    });
  }, [customers, searchQuery]);

  const customerVoucherRows = useMemo(
    () => customerLedger.filter((l) => l.transactionType.includes('سند')),
    [customerLedger]
  );

  const handleExportBalances = () => {
    if (customers.length === 0) return;
    const rows = customers.map((c) => ({
      'كود العميل': c.code || '',
      'اسم العميل': c.name,
      'رقم الهاتف': c.phone || '',
      'الرقم الضريبي': c.taxNumber || '',
      'الرصيد الافتتاحي': c.openingBalance,
      'الرصيد الحالي': c.currentBalance,
      'الحالة': c.status,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'مديونية_العملاء');
    XLSX.writeFile(wb, `مديونية_العملاء_${todayStr}.xlsx`);
    showNotification('success', 'تم تصدير كشف مديونية العملاء بنجاح');
  };

  const handleExportLedger = () => {
    const curCust = customers.find((c) => c.id === selectedCustomerIdForLedger);
    const rows: any[] = [];
    if (isLedgerFilteredByDate) {
      rows.push({
        'التاريخ': ledgerDateRange.from || '-',
        'نوع المعاملة': `رصيد أول المدة (قبل ${ledgerDateRange.from || 'بداية الفترة'})`,
        'رقم المستند': '-',
        'البيان': 'رصيد افتتاحي للفترة المختارة',
        'مدين (عليه)': 0,
        'دائن (له)': 0,
        'الرصيد التراكمي': ledgerOpeningBalanceForPeriod,
      });
    }
    computedCustomerLedgerRows.forEach((l) => {
      rows.push({
        'التاريخ': l.date.slice(0, 10),
        'نوع المعاملة': l.transactionType,
        'رقم المستند': l.documentNumber,
        'البيان': l.statement || l.notes || '',
        'مدين (عليه)': l.debit,
        'دائن (له)': l.credit,
        'الرصيد التراكمي': l.computedBalanceAfter,
      });
    });
    rows.push({
      'التاريخ': ledgerDateRange.to || todayStr,
      'نوع المعاملة': 'رصيد آخر المدة',
      'رقم المستند': '-',
      'البيان': 'الرصيد الختامي بنهاية الفترة',
      'مدين (عليه)': computedCustomerLedgerRows.reduce((s, r) => s + (r.debit || 0), 0),
      'دائن (له)': computedCustomerLedgerRows.reduce((s, r) => s + (r.credit || 0), 0),
      'الرصيد التراكمي': finalCustomerClosingBalance,
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'كشف_الحساب');
    XLSX.writeFile(wb, `كشف_حساب_عميل_${curCust?.name || ''}_${todayStr}.xlsx`);
    showNotification('success', 'تم تصدير كشف الحساب بنجاح');
  };

  const customerHeaderMeta: Record<TabType, { title: string; subtitle: string }> = {
    CUSTOMERS: {
      title: 'دليل العملاء',
      subtitle: 'إدارة بيانات العملاء وأرصدتهم الحالية والوصول السريع لحساباتهم',
    },
    GROUPS: {
      title: 'مجموعات العملاء',
      subtitle: 'تصنيف العملاء وتنظيم الشرائح والمجموعات',
    },
    BALANCES: {
      title: 'كشف مديونية العملاء',
      subtitle: 'أرصدة العملاء المدينة والدائنة والموقف المالي الإجمالي',
    },
    STATEMENT: {
      title: 'كشف حساب العميل',
      subtitle: 'حركة الفواتير والسندات والرصيد التراكمي للعميل المختار',
    },
    CREDIT_COLLECTION: {
      title: 'تحصيل الآجل للعملاء',
      subtitle: 'متابعة وتحصيل الفواتير والذمم الآجلة المستحقة على العملاء',
    },
    RECEIPT_VOUCHER: {
      title: 'سند قبض من عميل',
      subtitle: 'تسجيل ومراجعة سندات التحصيل والقبض النقدي من العملاء',
    },
    PAYMENT_VOUCHER: {
      title: 'سند صرف لعميل',
      subtitle: 'تسجيل ومراجعة سندات الصرف ورد المستحقات للعملاء',
    },
  };

  useRegisterShortcuts({
    'general.add_new': () => {
      if (activeTab === 'CUSTOMERS') {
        setEditingCustomer(null);
        setIsCustomerModalOpen(true);
      } else if (activeTab === 'GROUPS') {
        setIsGroupModalOpen(true);
      }
    },
    'general.save_form': () => {
      if (
        (activeTab === 'RECEIPT_VOUCHER' || activeTab === 'PAYMENT_VOUCHER') &&
        !isSubmittingVoucher &&
        voucherFormRef.current
      ) {
        voucherFormRef.current.requestSubmit();
      }
    }
  });

  return (
    <PageSurface
      title={customerHeaderMeta[activeTab].title}
      subtitle={customerHeaderMeta[activeTab].subtitle}
      actions={
        activeTab === 'CUSTOMERS' ? (
          <button
            type="button"
            data-shortcut-add="true"
            onClick={() => {
              setEditingCustomer(null);
              setIsCustomerModalOpen(true);
            }}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة عميل جديد</span>
            <ShortcutBadge actionId="general.add_new" className="bg-white/20 text-white border-white/30" />
          </button>
        ) : undefined
      }
    >
      {statusMessage && (
        <div
          className={`p-3 rounded-lg border text-xs font-bold flex items-center gap-2 ${
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
          إجمالي العملاء: <strong className="font-mono text-[var(--text-primary)]">{customers.length}</strong>
        </span>
        <span>·</span>
        <span>
          المجموعات: <strong className="font-mono text-[var(--text-primary)]">{customerGroups.length}</strong>
        </span>
        <span>·</span>
        <span>
          مديونيات على العملاء:{' '}
          <strong className="font-mono ui-stock-out">{totalDebts.toLocaleString()} ج.م</strong>
        </span>
        <span>·</span>
        <span>
          أرصدة دائنة:{' '}
          <strong className="font-mono ui-money-purchase">{totalCredits.toLocaleString()} ج.م</strong>
        </span>
        {isLoading && <span className="text-[11px]">جاري التحديث...</span>}
      </div>

      {/* TAB 1: CUSTOMERS LIST */}
      {activeTab === 'CUSTOMERS' && (
        <div className="space-y-4">
          <div className="no-print flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">بحث في العملاء</label>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="الاسم، الهاتف، الكود، أو الضريبي..."
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} pr-9 text-xs`}
                />
                <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 top-3 pointer-events-none" />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setEditingCustomer(null);
                setIsCustomerModalOpen(true);
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>عميل جديد</span>
            </button>
          </div>

          <CompactTable ariaLabel="دليل العملاء">
            <thead>
              <tr>
                <th>الاسم</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الكود</th>
                <th>المجموعة</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الهاتف</th>
                <th>العنوان</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد الحالي</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الحالة</th>
                <th className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا يوجد عملاء مطابقون للبحث
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => {
                  const grp = customerGroups.find((g) => g.id === c.groupId);
                  return (
                    <tr key={c.id}>
                      <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{c.name}</td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                        {c.code || '-'}
                      </td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{grp?.name || '-'}</td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{c.phone || '-'}</td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{c.address || '-'}</td>
                      <td
                        className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ${
                          c.currentBalance > 0
                            ? 'ui-stock-out'
                            : c.currentBalance < 0
                            ? 'ui-money-purchase'
                            : ''
                        }`}
                      >
                        {c.currentBalance > 0
                          ? `مدين بـ ${c.currentBalance.toLocaleString()}`
                          : c.currentBalance < 0
                          ? `دائن بـ ${Math.abs(c.currentBalance).toLocaleString()}`
                          : '0'}{' '}
                        ج.م
                      </td>
                      <td className={COMPACT_TABLE_NUM_CLASS}>{c.status}</td>
                      <td className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>
                        <div className="inline-flex items-center gap-1.5">
                          <a
                            href={getHrefForTarget('customers', 'CREDIT_COLLECTION', {
                              searchParams: { customerId: c.id }
                            })}
                            onClick={(e) => {
                              if (!isPlainLeftClick(e)) return;
                              e.preventDefault();
                              setSelectedCustomerIdForLedger(c.id);
                              if (onNavigate) {
                                onNavigate('customers', 'CREDIT_COLLECTION', {
                                  searchParams: { customerId: c.id }
                                });
                              } else {
                                setActiveTab('CREDIT_COLLECTION');
                              }
                            }}
                            className="min-h-[44px] inline-flex items-center px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-low text-xs font-bold cursor-pointer"
                          >
                            تحصيل الآجل
                          </a>
                          <a
                            href={getHrefForTarget('customers', 'STATEMENT', {
                              searchParams: { customerId: c.id }
                            })}
                            onClick={(e) => {
                              if (!isPlainLeftClick(e)) return;
                              e.preventDefault();
                              setSelectedCustomerIdForLedger(c.id);
                              if (onNavigate) {
                                onNavigate('customers', 'STATEMENT', {
                                  searchParams: { customerId: c.id }
                                });
                              } else {
                                setActiveTab('STATEMENT');
                              }
                            }}
                            className="min-h-[44px] inline-flex items-center px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-link text-xs font-bold cursor-pointer"
                          >
                            كشف الحساب
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCustomer(c);
                              setIsCustomerModalOpen(true);
                            }}
                            className="min-h-[44px] px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer"
                          >
                            تعديل
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* TAB 2: CUSTOMER GROUPS */}
      {activeTab === 'GROUPS' && (
        <div className="space-y-4">
          <SectionHeading
            title={`مجموعات وتصنيفات العملاء (${customerGroups.length})`}
            actions={
              <button
                type="button"
                data-shortcut-add="true"
                onClick={() => setIsGroupModalOpen(true)}
                className="no-print min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة مجموعة جديدة</span>
                <ShortcutBadge actionId="general.add_new" className="bg-white/20 text-white border-white/30" />
              </button>
            }
          />

          <CompactTable ariaLabel="جدول مجموعات العملاء">
            <thead>
              <tr>
                <th>اسم المجموعة</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>عدد العملاء</th>
                <th>الوصف</th>
              </tr>
            </thead>
            <tbody>
              {customerGroups.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد مجموعات مسجلة
                  </td>
                </tr>
              ) : (
                customerGroups.map((g) => {
                  const count = customers.filter((c) => c.groupId === g.id).length;
                  return (
                    <tr key={g.id}>
                      <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{g.name}</td>
                      <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>{count} عميل</td>
                      <td className={COMPACT_TABLE_TEXT_CLASS}>{g.description || '-'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* TAB 3: BALANCES */}
      {activeTab === 'BALANCES' && (
        <div className="space-y-4">
          <SectionHeading
            title="كشف مديونية العملاء الإجمالي"
            actions={
              <button
                type="button"
                onClick={handleExportBalances}
                className="no-print min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>تصدير Excel</span>
              </button>
            }
          />

          <CompactTable ariaLabel="جدول أرصدة العملاء">
            <thead>
              <tr>
                <th>اسم العميل</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الهاتف</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد الافتتاحي</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد الحالي</th>
                <th>الموقف المالي</th>
                <th className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد بيانات عملاء
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.id}>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{c.name}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {c.phone || '-'}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {c.openingBalance.toLocaleString()} ج.م
                    </td>
                    <td
                      className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ${
                        c.currentBalance > 0
                          ? 'ui-stock-out'
                          : c.currentBalance < 0
                          ? 'ui-money-purchase'
                          : ''
                      }`}
                    >
                      {c.currentBalance.toLocaleString()} ج.م
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>
                      <span
                        className={`font-semibold ${
                          c.currentBalance > 0
                            ? 'ui-stock-out'
                            : c.currentBalance < 0
                            ? 'ui-money-purchase'
                            : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        {c.currentBalance > 0
                          ? 'مدين (مستحق عليه)'
                          : c.currentBalance < 0
                          ? 'دائن (له رصيد)'
                          : 'متزن'}
                      </span>
                    </td>
                    <td className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>
                      <div className="inline-flex items-center gap-1.5">
                        <a
                          href={getHrefForTarget('customers', 'CREDIT_COLLECTION', {
                            searchParams: { customerId: c.id }
                          })}
                          onClick={(e) => {
                            if (!isPlainLeftClick(e)) return;
                            e.preventDefault();
                            setSelectedCustomerIdForLedger(c.id);
                            if (onNavigate) {
                              onNavigate('customers', 'CREDIT_COLLECTION', {
                                searchParams: { customerId: c.id }
                              });
                            } else {
                              setActiveTab('CREDIT_COLLECTION');
                            }
                          }}
                          className="min-h-[44px] inline-flex items-center px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-low text-xs font-bold cursor-pointer"
                        >
                          تحصيل الآجل
                        </a>
                        <a
                          href={getHrefForTarget('customers', 'STATEMENT', {
                            searchParams: { customerId: c.id }
                          })}
                          onClick={(e) => {
                            if (!isPlainLeftClick(e)) return;
                            e.preventDefault();
                            setSelectedCustomerIdForLedger(c.id);
                            if (onNavigate) {
                              onNavigate('customers', 'STATEMENT', {
                                searchParams: { customerId: c.id }
                              });
                            } else {
                              setActiveTab('STATEMENT');
                            }
                          }}
                          className="min-h-[44px] inline-flex items-center px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-link text-xs font-bold cursor-pointer"
                        >
                          عرض الحساب
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {customers.length > 0 && (
              <tfoot>
                <tr className="font-bold border-t border-[var(--border-color)]">
                  <td colSpan={3} className="py-2.5 px-3 text-xs">
                    صافي أرصدة العملاء ({customers.length})
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} py-2.5 px-3 font-mono ui-money-sale`}>
                    {customers.reduce((s, c) => s + (c.currentBalance || 0), 0).toLocaleString()} ج.م
                  </td>
                  <td />
                  <td className="no-print" />
                </tr>
              </tfoot>
            )}
          </CompactTable>
        </div>
      )}

      {/* TAB 4: STATEMENT */}
      {activeTab === 'STATEMENT' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 pb-3 border-b border-[var(--border-subtle)]">
            <div className="no-print">
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">اختر العميل</label>
              <select
                value={selectedCustomerIdForLedger}
                onChange={(e) => setSelectedCustomerIdForLedger(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-bold`}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (رصيد: {c.currentBalance} ج.م)
                  </option>
                ))}
              </select>
            </div>

            <DateRangeFilter
              inline
              value={ledgerDateRange}
              onChange={setLedgerDateRange}
              storageKey="customer_ledger"
              defaultPreset="THIS_MONTH"
            />

            <div className="no-print inline-flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportLedger}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-bold cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>تصدير Excel</span>
              </button>

              <button
                type="button"
                data-shortcut-print="true"
                onClick={() => window.print()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الكشف</span>
                <ShortcutBadge actionId="general.print_page" />
              </button>
            </div>

            {(() => {
              const currentCus = customers.find((c) => c.id === selectedCustomerIdForLedger);
              return currentCus ? (
                <div className="print-only print-filter-summary">
                  العميل: {currentCus.name} {currentCus.phone ? `(${currentCus.phone})` : ''} • الرصيد الحالي: {currentCus.currentBalance.toLocaleString()} ج.م
                </div>
              ) : null;
            })()}
          </div>

          <CompactTable ariaLabel="كشف حساب العميل">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
                <th>نوع المعاملة</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>رقم المستند</th>
                <th>البيان</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>مدين (عليه)</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>دائن (له)</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد التراكمي</th>
              </tr>
            </thead>
            <tbody>
              {isLedgerFilteredByDate && (
                <tr className="font-bold">
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{ledgerDateRange.from || '—'}</td>
                  <td className={COMPACT_TABLE_TEXT_CLASS} colSpan={3}>
                    رصيد أول المدة (قبل {ledgerDateRange.from || 'بداية الفترة'})
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-center`}>—</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-center`}>—</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>
                    {ledgerOpeningBalanceForPeriod.toLocaleString()} ج.م
                  </td>
                </tr>
              )}

              {computedCustomerLedgerRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد حركات مسجلة لهذا العميل في الفترة المختارة
                  </td>
                </tr>
              ) : (
                computedCustomerLedgerRows.map((l) => (
                  <tr key={l.id}>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {l.date.slice(0, 10)}
                    </td>
                    <td
                      className={`${COMPACT_TABLE_TEXT_CLASS} font-semibold ${
                        l.transactionType.includes('بيع')
                          ? 'ui-stock-out'
                          : l.transactionType.includes('قبض')
                          ? 'ui-money-purchase'
                          : 'ui-link'
                      }`}
                    >
                      {l.transactionType}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-link font-bold`}>{l.documentNumber}</td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{l.statement || l.notes || '-'}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-stock-out`}>
                      {l.debit > 0 ? `${l.debit.toLocaleString()} ج.م` : '-'}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono ui-money-purchase`}>
                      {l.credit > 0 ? `${l.credit.toLocaleString()} ج.م` : '-'}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold font-mono`}>
                      {l.computedBalanceAfter.toLocaleString()} ج.م
                    </td>
                  </tr>
                ))
              )}

              {(isLedgerFilteredByDate || computedCustomerLedgerRows.length > 0) && (
                <tr className="font-bold border-t border-[var(--border-color)]">
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{ledgerDateRange.to || todayStr}</td>
                  <td className={COMPACT_TABLE_TEXT_CLASS} colSpan={3}>
                    رصيد آخر المدة
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-stock-out`}>
                    {computedCustomerLedgerRows.reduce((s, r) => s + (r.debit || 0), 0).toLocaleString()} ج.م
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-money-purchase`}>
                    {computedCustomerLedgerRows.reduce((s, r) => s + (r.credit || 0), 0).toLocaleString()} ج.م
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono ui-money-sale`}>
                    {finalCustomerClosingBalance.toLocaleString()} ج.م
                  </td>
                </tr>
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* TAB 5 & 6: VOUCHERS */}
      {(activeTab === 'RECEIPT_VOUCHER' || activeTab === 'PAYMENT_VOUCHER') && (
        <div className="space-y-5">
          <SectionHeading
            title={
              activeTab === 'RECEIPT_VOUCHER'
                ? 'سند قبض نقدية من عميل'
                : 'سند صرف ورد نقدية لعميل'
            }
          />

          {voucherError && (
            <div className="p-3 rounded-lg border border-rose-300 ui-stock-out bg-rose-50/40 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{voucherError.message}</span>
              </div>
              {voucherError.isUnknownResult && (
                <button
                  type="button"
                  onClick={() => voucherFormRef.current?.requestSubmit()}
                  disabled={isSubmittingVoucher}
                  className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSubmittingVoucher ? 'animate-spin' : ''}`} />
                  <span>إعادة المحاولة</span>
                </button>
              )}
            </div>
          )}

          <form
            ref={voucherFormRef}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.target as any;
              const customerId = form.customerId.value;
              const cashboxId = form.cashboxId.value;
              const amount = Number(form.amount.value);
              const notes = form.notes.value;

              setIsSubmittingVoucher(true);
              setVoucherError(null);
              try {
                const res = await api.createCustomerVoucher({
                  customerId,
                  cashboxId,
                  voucherType: activeTab === 'RECEIPT_VOUCHER' ? 'قبض' : 'صرف',
                  amount,
                  notes,
                  idempotencyKey: voucherIdemKeyRef.current,
                });

                if (res.success) {
                  voucherIdemKeyRef.current = generateIdempotencyKey();
                  showNotification('success', 'تم حفظ السند وتحديث حساب العميل ورصيد الخزينة بنجاح');
                  form.reset();
                  loadData();
                } else {
                  const msg = res.error || 'فشل حفظ السند';
                  setVoucherError({ message: msg, isUnknownResult: res.code === 'UNKNOWN_RESULT' });
                  showNotification('error', msg);
                }
              } catch (err: any) {
                const msg = err.message || 'خطأ أثناء الاتصال';
                setVoucherError({ message: msg, isUnknownResult: err?.code === 'UNKNOWN_RESULT' });
                showNotification('error', msg);
              } finally {
                setIsSubmittingVoucher(false);
              }
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">العميل المستهدف *</label>
              <select
                name="customerId"
                required
                value={selectedCustomerIdForLedger}
                onChange={(e) => setSelectedCustomerIdForLedger(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
              >
                <option value="">-- اختر العميل --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (رصيده: {c.currentBalance} ج.م)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الخزينة النقدية *</label>
              <select
                name="cashboxId"
                required
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs`}
              >
                <option value="">-- اختر الخزينة --</option>
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
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">البيان والملاحظات</label>
              <input
                type="text"
                name="notes"
                placeholder="بيان السند (سداد دفعة، إيداع مقدم...)"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
              />
            </div>

            <button
              type="submit"
              data-shortcut-save="true"
              disabled={isSubmittingVoucher}
              className={`min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg text-white font-bold text-xs transition cursor-pointer disabled:opacity-50 ${
                activeTab === 'RECEIPT_VOUCHER'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-rose-600 hover:bg-rose-700'
              }`}
            >
              <span>
                {isSubmittingVoucher
                  ? 'جاري تسجيل السند...'
                  : activeTab === 'RECEIPT_VOUCHER'
                  ? 'تأكيد وإيداع سند القبض'
                  : 'تأكيد وصرف السند للعميل'}
              </span>
              {!isSubmittingVoucher && (
                <ShortcutBadge actionId="general.save_form" className="bg-white/20 text-white border-white/30" />
              )}
            </button>
          </form>

          <SectionHeading withTopDivider title={`سجل سندات العميل خلال الفترة (${customerVoucherRows.length})`} />

          <DateRangeFilter
            inline
            value={vouchersDateRange}
            onChange={setVouchersDateRange}
            storageKey="customer_vouchers"
            defaultPreset="THIS_MONTH"
          />

          <CompactTable ariaLabel="سجل سندات العميل">
            <thead>
              <tr>
                <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>المستند</th>
                <th>النوع</th>
                <th className={COMPACT_TABLE_NUM_CLASS}>المبلغ</th>
                <th>البيان</th>
              </tr>
            </thead>
            <tbody>
              {customerVoucherRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-6 text-xs text-[var(--text-secondary)]">
                    لا توجد سندات مسجلة في هذه الفترة
                  </td>
                </tr>
              ) : (
                customerVoucherRows.map((v) => (
                  <tr key={v.id}>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                      {v.date.slice(0, 10)}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-link`}>{v.documentNumber}</td>
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>{v.transactionType}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>
                      {(v.debit || v.credit || 0).toLocaleString()} ج.م
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>{v.statement || v.notes || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* TAB: CREDIT COLLECTION */}
      {activeTab === 'CREDIT_COLLECTION' && (
        <CreditCollectionView
          embedded
          user={user}
          initialPartyType="customer"
          initialPartyId={selectedCustomerIdForLedger}
          customers={customers}
          onCollectionSuccess={loadData}
        />
      )}

      {/* MODAL: CUSTOMER */}
      {isCustomerModalOpen && (
        <CustomerModal
          customer={editingCustomer}
          groups={customerGroups}
          onClose={() => setIsCustomerModalOpen(false)}
          onSuccess={() => {
            setIsCustomerModalOpen(false);
            loadData();
            showNotification('success', 'تم حفظ بيانات العميل بنجاح');
          }}
        />
      )}

      {/* MODAL: GROUP */}
      {isGroupModalOpen && (
        <CustomerGroupModal
          onClose={() => setIsGroupModalOpen(false)}
          onSuccess={() => {
            setIsGroupModalOpen(false);
            loadData();
            showNotification('success', 'تم حفظ مجموعة العملاء بنجاح');
          }}
        />
      )}
    </PageSurface>
  );
};

// مودال إضافة / تعديل عميل
interface CustomerModalProps {
  customer: Customer | null;
  groups: CustomerGroup[];
  onClose: () => void;
  onSuccess: () => void;
}

const CustomerModal: React.FC<CustomerModalProps> = ({
  customer,
  groups,
  onClose,
  onSuccess,
}) => {
  const initialZoneId = customer?.zoneId || '';
  const [name, setName] = useState(customer?.name || '');
  const [code, setCode] = useState(customer?.code || '');
  const [groupId, setGroupId] = useState(customer?.groupId || '');
  const [phone, setPhone] = useState(customer?.phone || '');
  const [email, setEmail] = useState(customer?.email || '');
  const [address, setAddress] = useState(customer?.address || '');
  const [zoneId, setZoneId] = useState<string>(initialZoneId);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryConfigZoneOption[]>([]);
  const [zonesLoading, setZonesLoading] = useState<boolean>(true);
  const [zonesError, setZonesError] = useState<string | null>(null);
  const [taxNumber, setTaxNumber] = useState(customer?.taxNumber || '');
  const [commercialRecord, setCommercialRecord] = useState(customer?.commercialRecord || '');
  const [openingBalance, setOpeningBalance] = useState<number>(customer?.openingBalance || 0);
  const [notes, setNotes] = useState(customer?.notes || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setZonesLoading(true);
    setZonesError(null);
    api
      .getDeliveryConfig()
      .then((res) => {
        if (!active) return;
        if (res && res.success) {
          setDeliveryZones(Array.isArray(res.zones) ? res.zones : []);
        } else {
          setDeliveryZones([]);
          setZonesError(res?.error || 'تعذر تحميل قائمة مناطق التوصيل');
        }
      })
      .catch((err: any) => {
        if (!active) return;
        setDeliveryZones([]);
        setZonesError(err?.message || 'تعذر تحميل قائمة مناطق التوصيل');
      })
      .finally(() => {
        if (active) setZonesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const hasUnlistedInitialZone =
    Boolean(initialZoneId) &&
    !zonesLoading &&
    !deliveryZones.some((z) => z.id === initialZoneId);
  const isCurrentZoneInactive = hasUnlistedInitialZone && !zonesError;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('يرجى إدخال اسم العميل');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await api.saveCustomer({
        id: customer?.id,
        name: name.trim(),
        code: code.trim() || undefined,
        groupId: groupId || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        zoneId: zoneId || '',
        taxNumber: taxNumber.trim() || undefined,
        commercialRecord: commercialRecord.trim() || undefined,
        openingBalance: Number(openingBalance || 0),
        notes: notes.trim() || undefined,
      });

      if (res.success) {
        onSuccess();
      } else {
        setError(res.error || 'فشل حفظ العميل');
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء حفظ العميل');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={customer ? `تعديل العميل: ${customer.name}` : 'إضافة عميل جديد'}
      onClose={onClose}
      closeDisabled={isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="p-2.5 rounded-lg border border-rose-300 ui-stock-out bg-rose-50/40 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">اسم العميل أو المؤسسة *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: مؤسسة الأمل للتجارة"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">كود العميل</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="CUST-001"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">مجموعة العملاء</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs`}
            >
              <option value="">بدون مجموعة</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">رقم الهاتف</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01xxxxxxxxx"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الرصيد الافتتاحي</label>
            <input
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(Number(e.target.value))}
              placeholder="0.00"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-xs font-bold font-mono`}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الرقم الضريبي</label>
            <input
              type="text"
              value={taxNumber}
              onChange={(e) => setTaxNumber(e.target.value)}
              placeholder="xxx-xxx-xxx"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-mono`}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">السجل التجاري</label>
            <input
              type="text"
              value={commercialRecord}
              onChange={(e) => setCommercialRecord(e.target.value)}
              placeholder="رقم السجل..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs`}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">العنوان</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="عنوان العميل أو مقر التسليم..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} min-h-[44px] text-xs`}
            />
          </div>
          <div className="max-w-full">
            <label
              htmlFor="customer-delivery-zone"
              className="block text-xs font-bold text-[var(--text-primary)] mb-1"
            >
              منطقة التوصيل
            </label>
            <select
              id="customer-delivery-zone"
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px] text-xs`}
            >
              <option value="">بدون منطقة</option>
              {zonesLoading && initialZoneId && (
                <option value={initialZoneId}>المنطقة الحالية (جاري التحميل...)</option>
              )}
              {hasUnlistedInitialZone && zonesError && (
                <option value={initialZoneId}>المنطقة الحالية المحفوظة</option>
              )}
              {isCurrentZoneInactive && (
                <option value={initialZoneId}>منطقة حالية (غير نشطة)</option>
              )}
              {deliveryZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
            {zonesLoading && (
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                جاري تحميل مناطق التوصيل...
              </p>
            )}
            {zonesError && (
              <p
                role="alert"
                className="mt-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200 max-w-[260px]"
              >
                {zonesError}. يمكنك إكمال حفظ العميل بشكل طبيعي
                {initialZoneId ? ' مع الاحتفاظ بمنطقته الحالية.' : '.'}
              </p>
            )}
            {isCurrentZoneInactive && zoneId === initialZoneId && (
              <p className="mt-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200 max-w-[260px]">
                منطقة التوصيل الحالية لهذا العميل غير نشطة؛ سيتم الاحتفاظ بها ما لم تختر منطقة أخرى أو «بدون منطقة».
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">ملاحظات</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات الحساب، شروط الدفع، جهة الاتصال..."
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
            className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition disabled:opacity-50 cursor-pointer"
          >
            <span>{isSubmitting ? 'جاري الحفظ...' : 'حفظ العميل'}</span>
            {!isSubmitting && (
              <ShortcutBadge actionId="general.save_form" className="bg-white/20 text-white border-white/30" />
            )}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

// مودال مجموعة عملاء
interface CustomerGroupModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const CustomerGroupModal: React.FC<CustomerGroupModalProps> = ({ onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await api.saveCustomerGroup({ name: name.trim(), description });
      if (res.success) {
        onSuccess();
      } else {
        setError(res.error || 'تعذر حفظ مجموعة العملاء');
      }
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء الاتصال بالخادم');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="مجموعة عملاء جديدة"
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
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">اسم المجموعة *</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: تجار الجملة"
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs`}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الوصف</label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="شروط المجموعة أو نسبة الخصم..."
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
            {isSubmitting ? 'جاري الحفظ...' : 'حفظ المجموعة'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

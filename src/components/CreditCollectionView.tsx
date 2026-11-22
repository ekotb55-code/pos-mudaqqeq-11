import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Wallet,
  Users,
  Layers,
  CheckSquare,
  Square,
  AlertTriangle,
  CheckCircle2,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Printer,
  WifiOff,
  Clock,
  Search
} from 'lucide-react';
import {
  UserAccount,
  Customer,
  Platform,
  Invoice,
  PartyLedgerEntry,
  Cashbox
} from '../types';
import { api } from '../api/client';
import { hasPermission } from '../utils/permissions';
import { generateIdempotencyKey } from '../utils/idempotency';
import { DateRangeFilter } from './DateRangeFilter';
import { DateRange, getDateRangeForPreset, isDateInRange, normalizeArabicText } from '../utils/dateUtils';
import { useOfflineMode } from '../hooks/useOfflineMode';
import {
  loadOfflineSnapshot,
  createOfflineCreditCollectionInDb,
  subscribeOfflineDb
} from '../offline/db';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ModalShell,
  ReportSummaryTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
} from './ui';

interface CreditCollectionViewProps {
  user: UserAccount | null;
  initialPartyType?: 'customer' | 'platform';
  initialPartyId?: string;
  customers?: Customer[];
  platforms?: Platform[];
  onCollectionSuccess?: () => void;
  embedded?: boolean;
  platformsEnabled?: boolean;
}

export default function CreditCollectionView({
  user,
  initialPartyType = 'customer',
  initialPartyId = '',
  customers: propCustomers,
  platforms: propPlatforms,
  onCollectionSuccess,
  embedded = false,
  platformsEnabled = true
}: CreditCollectionViewProps) {
  const [partyType, setPartyType] = useState<'customer' | 'platform'>(() =>
    !platformsEnabled ? 'customer' : initialPartyType
  );
  const [selectedPartyId, setSelectedPartyId] = useState<string>(initialPartyId);

  const [customers, setCustomers] = useState<Customer[]>(propCustomers || []);
  const [platforms, setPlatforms] = useState<Platform[]>(propPlatforms || []);
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);

  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRangeForPreset('ALL'));

  const [pendingInvoices, setPendingInvoices] = useState<Invoice[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<PartyLedgerEntry[]>([]);
  const [partyBalance, setPartyBalance] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);

  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [receivedAmountInput, setReceivedAmountInput] = useState<string>('');
  const [selectedCashboxId, setSelectedCashboxId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [invoiceSearchQuery, setInvoiceSearchQuery] = useState<string>('');

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUnknownResultError, setIsUnknownResultError] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());
  const lastConfirmDiffRef = useRef<boolean>(false);

  const { isOffline, lastSyncAt: hookLastSyncAt } = useOfflineMode();
  const [localLastSyncAt, setLocalLastSyncAt] = useState<string | null>(null);
  const [offlineLedgerByParty, setOfflineLedgerByParty] = useState<Record<string, PartyLedgerEntry[]>>({});

  const [collectionReceipt, setCollectionReceipt] = useState<{
    collectionId: string;
    date: string;
    partyType: 'customer' | 'platform';
    partyName: string;
    invoiceNumbers: string[];
    totalDue: number;
    receivedAmount: number;
    difference: number;
    partyBalanceAfter: number;
    cashboxName: string;
    notes?: string;
    isOffline: boolean;
  } | null>(null);

  useEffect(() => {
    idempotencyKeyRef.current = generateIdempotencyKey();
    setIsUnknownResultError(false);
  }, [partyType, selectedPartyId]);

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    type: 'under' | 'over';
    diff: number;
    partyName: string;
    totalDue: number;
    receivedAmount: number;
  } | null>(null);

  const canCollect = user?.role === 'designer' || hasPermission(user, 'invoices.collect_credit');

  const formattedLastSyncTime = useMemo(() => {
    const raw = localLastSyncAt || hookLastSyncAt;
    if (!raw) return 'غير متوفر';
    try {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return raw;
      return d.toLocaleString('ar-EG', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return raw;
    }
  }, [localLastSyncAt, hookLastSyncAt]);

  // Sync initial props when changed externally & enforce platformsEnabled lock
  useEffect(() => {
    if (!platformsEnabled) {
      setPartyType('customer');
    } else if (initialPartyType) {
      setPartyType(initialPartyType);
    }
    if (initialPartyId) {
      setSelectedPartyId(initialPartyId);
    }
  }, [platformsEnabled, initialPartyType, initialPartyId]);

  const loadFromOfflineStore = useCallback(
    async (targetPartyType: 'customer' | 'platform', targetPartyId: string) => {
      const snap = await loadOfflineSnapshot(user);
      if (!snap) return false;
      if (snap.lastSyncAt) {
        setLocalLastSyncAt(snap.lastSyncAt);
      }

      const custList = snap.customers && snap.customers.length > 0 ? snap.customers : propCustomers || [];
      const pltList = snap.platforms && snap.platforms.length > 0 ? snap.platforms : propPlatforms || [];
      const cbList = snap.cashboxes || [];
      setCustomers(custList);
      setPlatforms(pltList);
      const activeCbs = cbList.filter(cb => cb.status !== 'inactive' && cb.status !== 'موقوفة');
      setCashboxes(activeCbs);
      setSelectedCashboxId(prev => prev || activeCbs[0]?.id || '');

      const resolvedPartyId =
        targetPartyId ||
        (targetPartyType === 'customer' ? custList[0]?.id || '' : pltList[0]?.id || '');

      if (!targetPartyId && resolvedPartyId) {
        setSelectedPartyId(resolvedPartyId);
      }

      if (!resolvedPartyId) {
        setPendingInvoices([]);
        setLedgerEntries([]);
        setPartyBalance(0);
        return true;
      }

      const targetCustomer = custList.find(c => c.id === resolvedPartyId);
      const targetPlatform = pltList.find(p => p.id === resolvedPartyId);
      const targetName =
        targetPartyType === 'customer' ? targetCustomer?.name || '' : targetPlatform?.name || '';

      const allPending = snap.pendingInvoices || [];
      const partyPending = allPending.filter(inv => {
        if (dateRange.from || dateRange.to) {
          if (!isDateInRange(inv.date, dateRange.from, dateRange.to)) return false;
        }
        if (targetPartyType === 'customer') {
          return (
            inv.customerId === resolvedPartyId ||
            (inv.creditPartyType === 'customer' && inv.creditPartyId === resolvedPartyId) ||
            (Boolean(targetName) &&
              (inv.customerName?.trim() === targetName.trim() ||
                inv.creditPartyName?.trim() === targetName.trim()))
          );
        }
        return (
          inv.platformId === resolvedPartyId ||
          (inv.creditPartyType === 'platform' && inv.creditPartyId === resolvedPartyId) ||
          (Boolean(targetName) &&
            (inv.platform?.trim().toLowerCase() === targetName.trim().toLowerCase() ||
              inv.creditPartyName?.trim().toLowerCase() === targetName.trim().toLowerCase()))
        );
      });

      const snapBalanceEntry = (snap.partyBalances || []).find(
        b => b.partyType === targetPartyType && b.partyId === resolvedPartyId
      );
      const uncollectedPendingDue = partyPending
        .filter(inv => !inv.offlineCollectionPending)
        .reduce((sum, inv) => {
          const due =
            typeof inv.creditDueAmount === 'number'
              ? inv.creditDueAmount
              : targetPartyType === 'platform'
              ? Number(inv.netAmount || 0)
              : Number(inv.totalBeforeDiscount || 0) + Number(inv.deliveryFee || 0);
          return sum + due;
        }, 0);

      const resolvedBalance =
        snapBalanceEntry !== undefined
          ? Number(snapBalanceEntry.currentBalance || 0)
          : targetPartyType === 'customer' && targetCustomer?.currentBalance !== undefined
          ? Number(targetCustomer.currentBalance)
          : targetPartyType === 'platform' && targetPlatform?.currentBalance !== undefined
          ? Number(targetPlatform.currentBalance)
          : Math.round(uncollectedPendingDue * 100) / 100;

      setPendingInvoices(partyPending);
      setPartyBalance(resolvedBalance);
      const partyKey = `${targetPartyType}:${resolvedPartyId}`;
      setLedgerEntries(offlineLedgerByParty[partyKey] || []);

      const selectableNums = new Set(
        partyPending.filter(inv => !inv.offlineCollectionPending).map(inv => inv.invoiceNumber)
      );
      setSelectedInvoiceIds(prev => prev.filter(num => selectableNums.has(num)));
      return true;
    },
    [user, propCustomers, propPlatforms, dateRange.from, dateRange.to, offlineLedgerByParty]
  );

  const loadPartiesAndCashboxes = useCallback(async () => {
    if (isOffline) {
      await loadFromOfflineStore(partyType, selectedPartyId);
      return;
    }
    try {
      const [custRes, pltRes, cbRes] = await Promise.all([
        api.getCustomers().catch(() => ({ success: false, customers: [] as Customer[] })),
        platformsEnabled
          ? api.getPlatforms().catch(() => ({ success: false, platforms: [] as Platform[] }))
          : Promise.resolve({ success: true, platforms: [] as Platform[] }),
        api.getCashboxes().catch(() => ({ success: false, cashboxes: [] as Cashbox[] }))
      ]);
      const custList = custRes.customers || [];
      const pltList = pltRes.platforms || [];
      const cbList = cbRes.cashboxes || [];
      if (custList.length === 0 && pltList.length === 0 && cbList.length === 0) {
        const loaded = await loadFromOfflineStore(partyType, selectedPartyId);
        if (loaded) return;
      }
      setCustomers(custList);
      setPlatforms(pltList);
      const activeCbs = cbList.filter(cb => cb.status !== 'inactive' && cb.status !== 'موقوفة');
      setCashboxes(activeCbs);
      setSelectedCashboxId(prev => prev || activeCbs[0]?.id || '');

      setSelectedPartyId(prev => {
        if (prev) return prev;
        if (partyType === 'customer' && custList.length > 0) return custList[0].id;
        if (partyType === 'platform' && pltList.length > 0) return pltList[0].id;
        return '';
      });
    } catch (err) {
      console.error('Failed to load parties or cashboxes', err);
      await loadFromOfflineStore(partyType, selectedPartyId);
    }
  }, [isOffline, platformsEnabled, partyType, selectedPartyId, loadFromOfflineStore]);

  useEffect(() => {
    loadPartiesAndCashboxes();
  }, [loadPartiesAndCashboxes]);

  useEffect(() => {
    if (partyType === 'customer') {
      if (customers.length > 0 && !customers.some(c => c.id === selectedPartyId)) {
        setSelectedPartyId(customers[0]?.id || '');
      }
    } else {
      if (platforms.length > 0 && !platforms.some(p => p.id === selectedPartyId)) {
        setSelectedPartyId(platforms[0]?.id || '');
      }
    }
    setSelectedInvoiceIds([]);
    setReceivedAmountInput('');
    setErrorMsg(null);
    setSuccessMsg(null);
  }, [partyType, customers, platforms]);

  const loadPartyLedgerAndInvoices = useCallback(async () => {
    if (!selectedPartyId) {
      setPendingInvoices([]);
      setLedgerEntries([]);
      setPartyBalance(0);
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    if (isOffline) {
      try {
        await loadFromOfflineStore(partyType, selectedPartyId);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const res = await api.getPartyLedger({
        partyType,
        partyId: selectedPartyId,
        from: dateRange.from || undefined,
        to: dateRange.to || undefined
      });
      if (!res.success) {
        const fallbackOk = await loadFromOfflineStore(partyType, selectedPartyId);
        if (!fallbackOk) {
          setErrorMsg(res.error || 'فشل تحميل بيانات حساب الطرف');
        }
        return;
      }
      setPendingInvoices(res.pendingInvoices || []);
      setLedgerEntries(res.ledger || []);
      setPartyBalance(Number(res.currentBalance || 0));
      const validPendingNums = new Set(
        (res.pendingInvoices || [])
          .filter(inv => !inv.offlineCollectionPending)
          .map(inv => inv.invoiceNumber)
      );
      setSelectedInvoiceIds(prev => prev.filter(num => validPendingNums.has(num)));
    } catch (err: any) {
      const fallbackOk = await loadFromOfflineStore(partyType, selectedPartyId);
      if (!fallbackOk) {
        setErrorMsg(err.message || 'فشل تحميل بيانات حساب الطرف');
      }
    } finally {
      setLoading(false);
    }
  }, [isOffline, partyType, selectedPartyId, dateRange.from, dateRange.to, loadFromOfflineStore]);

  useEffect(() => {
    loadPartyLedgerAndInvoices();
  }, [loadPartyLedgerAndInvoices]);

  useEffect(() => {
    return subscribeOfflineDb(() => {
      if (isOffline) {
        loadFromOfflineStore(partyType, selectedPartyId);
      }
    });
  }, [isOffline, partyType, selectedPartyId, loadFromOfflineStore]);

  const selectedPartyName = useMemo(() => {
    if (partyType === 'customer') {
      return customers.find(c => c.id === selectedPartyId)?.name || '';
    }
    return platforms.find(p => p.id === selectedPartyId)?.name || '';
  }, [partyType, selectedPartyId, customers, platforms]);

  const getInvoiceDueAmount = (inv: Invoice): number => {
    if (typeof inv.creditDueAmount === 'number' && !isNaN(inv.creditDueAmount)) {
      return Number(inv.creditDueAmount);
    }
    if (partyType === 'platform' || inv.creditPartyType === 'platform') {
      return Number(inv.netAmount || 0);
    }
    return Number(inv.totalBeforeDiscount || 0) + Number(inv.deliveryFee || 0);
  };

  const totalSelectedDue = useMemo(() => {
    return Number(
      pendingInvoices
        .filter(inv => selectedInvoiceIds.includes(inv.invoiceNumber))
        .reduce((sum, inv) => sum + getInvoiceDueAmount(inv), 0)
        .toFixed(2)
    );
  }, [pendingInvoices, selectedInvoiceIds, partyType]);

  const filteredPendingInvoices = useMemo(() => {
    const normQ = normalizeArabicText(invoiceSearchQuery);
    if (!normQ) return pendingInvoices;
    return pendingInvoices.filter(inv => {
      const haystack = normalizeArabicText(
        `${inv.invoiceNumber || ''} ${inv.platformOrderId || ''} ${inv.offlineProvisionalNo || ''} ${inv.tempInvoiceNumber || ''} ${inv.customerName || ''} ${inv.notes || ''}`
      );
      return haystack.includes(normQ);
    });
  }, [pendingInvoices, invoiceSearchQuery]);

  const selectablePendingInvoices = useMemo(
    () => filteredPendingInvoices.filter(inv => !inv.offlineCollectionPending),
    [filteredPendingInvoices]
  );

  const totalPendingDueAll = useMemo(
    () => selectablePendingInvoices.reduce((s, inv) => s + getInvoiceDueAmount(inv), 0),
    [selectablePendingInvoices]
  );

  const toggleSelectInvoice = (invoiceNumber: string) => {
    const targetInv = pendingInvoices.find(i => i.invoiceNumber === invoiceNumber);
    if (targetInv?.offlineCollectionPending) return;
    setErrorMsg(null);
    setIsUnknownResultError(false);
    setSuccessMsg(null);
    setSelectedInvoiceIds(prev => {
      const next = prev.includes(invoiceNumber)
        ? prev.filter(id => id !== invoiceNumber)
        : [...prev, invoiceNumber];
      if (next.length === 0 && prev.length > 0) {
        idempotencyKeyRef.current = generateIdempotencyKey();
      }
      const nextDue = Number(
        pendingInvoices
          .filter(inv => !inv.offlineCollectionPending && next.includes(inv.invoiceNumber))
          .reduce((sum, inv) => sum + getInvoiceDueAmount(inv), 0)
          .toFixed(2)
      );
      setReceivedAmountInput(next.length > 0 ? String(nextDue) : '');
      return next;
    });
  };

  const toggleSelectAll = () => {
    setErrorMsg(null);
    setIsUnknownResultError(false);
    setSuccessMsg(null);
    if (
      selectedInvoiceIds.length === selectablePendingInvoices.length &&
      selectablePendingInvoices.length > 0
    ) {
      setSelectedInvoiceIds([]);
      setReceivedAmountInput('');
      idempotencyKeyRef.current = generateIdempotencyKey();
    } else {
      const allNums = selectablePendingInvoices.map(inv => inv.invoiceNumber);
      setSelectedInvoiceIds(allNums);
      const allDue = Number(
        selectablePendingInvoices.reduce((sum, inv) => sum + getInvoiceDueAmount(inv), 0).toFixed(2)
      );
      setReceivedAmountInput(allNums.length > 0 ? String(allDue) : '');
    }
  };

  const executeCollection = async (confirmDifference: boolean) => {
    if (!platformsEnabled && partyType === 'platform') {
      setErrorMsg('وظائف ومبيعات المنصات معطّلة حاليًا من إعدادات النظام');
      return;
    }
    if (!selectedPartyId) return;
    const receivedAmount = Number(receivedAmountInput);
    if (isNaN(receivedAmount) || receivedAmount < 0) {
      setErrorMsg('يرجى إدخال مبلغ مستلم صحيح');
      return;
    }
    if (!selectedCashboxId) {
      setErrorMsg('يرجى اختيار الخزنة');
      return;
    }

    lastConfirmDiffRef.current = confirmDifference;
    setSubmitting(true);
    setErrorMsg(null);
    setIsUnknownResultError(false);
    setSuccessMsg(null);

    const selectedCashboxName =
      cashboxes.find(cb => cb.id === selectedCashboxId)?.name || 'الخزينة';

    try {
      if (isOffline) {
        const offlineRes = await createOfflineCreditCollectionInDb({
          payload: {
            partyType,
            partyId: selectedPartyId,
            partyName: selectedPartyName,
            invoiceNumbers: selectedInvoiceIds,
            receivedAmount,
            cashboxId: selectedCashboxId,
            cashboxName: selectedCashboxName,
            confirmDifference,
            notes: notes.trim() || undefined,
            idempotencyKey: idempotencyKeyRef.current,
            createdBy: user?.name || user?.username || 'محاسب'
          },
          user,
          fallbackCustomers: customers,
          fallbackPlatforms: platforms,
          fallbackCashboxes: cashboxes,
          fallbackPendingInvoices: pendingInvoices
        });

        if (!offlineRes.success) {
          if (offlineRes.requiresConfirmation) {
            const diffVal = Number(offlineRes.difference || (receivedAmount - totalSelectedDue));
            setConfirmModal({
              open: true,
              type: diffVal < 0 ? 'under' : 'over',
              diff: Math.abs(diffVal),
              partyName: selectedPartyName,
              totalDue: Number(offlineRes.totalDue ?? totalSelectedDue),
              receivedAmount: Number(offlineRes.receivedAmount ?? receivedAmount)
            });
          } else {
            setErrorMsg(offlineRes.error || 'حدث خطأ أثناء حفظ التحصيل بدون إنترنت');
          }
          return;
        }

        const collectedInvoicesList = [...selectedInvoiceIds];
        const savedNotes = notes.trim() || undefined;
        idempotencyKeyRef.current = generateIdempotencyKey();
        setConfirmModal(null);

        setCashboxes(
          offlineRes.updatedCashboxes.filter(cb => cb.status !== 'inactive' && cb.status !== 'موقوفة')
        );
        setCustomers(offlineRes.updatedCustomers);
        setPlatforms(offlineRes.updatedPlatforms);
        setPartyBalance(Number(offlineRes.partyBalance ?? partyBalance));
        setPendingInvoices(prev =>
          prev.map(inv =>
            collectedInvoicesList.includes(inv.invoiceNumber)
              ? { ...inv, offlineCollectionPending: true }
              : inv
          )
        );

        const partyKey = `${partyType}:${selectedPartyId}`;
        if (offlineRes.ledgerEntriesCreated && offlineRes.ledgerEntriesCreated.length > 0) {
          setOfflineLedgerByParty(prev => ({
            ...prev,
            [partyKey]: [...(offlineRes.ledgerEntriesCreated || []), ...(prev[partyKey] || [])]
          }));
          setLedgerEntries(prev => [...(offlineRes.ledgerEntriesCreated || []), ...prev]);
        }

        setSelectedInvoiceIds([]);
        setReceivedAmountInput('');
        setNotes('');
        setSuccessMsg(
          `تم تسجيل التحصيل بدون إنترنت (${collectedInvoicesList.length} فاتورة — محصّلة، لم تُرفع بعد). المبلغ المستلم بالخزنة: ${Number(
            offlineRes.receivedAmount ?? receivedAmount
          ).toFixed(2)} ج.م`
        );

        setCollectionReceipt({
          collectionId: offlineRes.collectionId || 'OFF-COL',
          date: new Date().toISOString(),
          partyType,
          partyName: selectedPartyName,
          invoiceNumbers: collectedInvoicesList,
          totalDue: Number(offlineRes.totalDue ?? totalSelectedDue),
          receivedAmount: Number(offlineRes.receivedAmount ?? receivedAmount),
          difference: Number(offlineRes.difference ?? (receivedAmount - totalSelectedDue)),
          partyBalanceAfter: Number(offlineRes.partyBalance ?? (partyBalance - receivedAmount)),
          cashboxName: selectedCashboxName,
          notes: savedNotes,
          isOffline: true
        });
        return;
      }

      const res = await api.collectCreditInvoices({
        partyType,
        partyId: selectedPartyId,
        invoiceNumbers: selectedInvoiceIds,
        receivedAmount,
        cashboxId: selectedCashboxId,
        confirmDifference,
        notes: notes.trim() || undefined,
        idempotencyKey: idempotencyKeyRef.current
      });

      if (!res.success) {
        if (res.requiresConfirmation) {
          const diffVal = Number(res.difference || (receivedAmount - totalSelectedDue));
          setConfirmModal({
            open: true,
            type: diffVal < 0 ? 'under' : 'over',
            diff: Math.abs(diffVal),
            partyName: selectedPartyName,
            totalDue: Number(res.totalDue ?? totalSelectedDue),
            receivedAmount: Number(res.receivedAmount ?? receivedAmount)
          });
        } else {
          setErrorMsg(res.error || 'حدث خطأ أثناء تنفيذ التحصيل');
          setIsUnknownResultError(res.code === 'UNKNOWN_RESULT');
        }
        return;
      }

      const collectedInvoicesList = res.settledInvoices || [...selectedInvoiceIds];
      const savedNotes = notes.trim() || undefined;
      idempotencyKeyRef.current = generateIdempotencyKey();
      setConfirmModal(null);
      const count = collectedInvoicesList.length;
      setSelectedInvoiceIds([]);
      setReceivedAmountInput('');
      setNotes('');
      setSuccessMsg(
        `تم تحصيل ${count} فاتورة بنجاح. المبلغ المستلم بالخزنة: ${Number(res.receivedAmount ?? receivedAmount).toFixed(2)} ج.م`
      );

      setCollectionReceipt({
        collectionId: res.collectionId || 'COL',
        date: new Date().toISOString(),
        partyType,
        partyName: selectedPartyName,
        invoiceNumbers: collectedInvoicesList,
        totalDue: Number(res.totalDue ?? totalSelectedDue),
        receivedAmount: Number(res.receivedAmount ?? receivedAmount),
        difference: Number(res.difference ?? (receivedAmount - totalSelectedDue)),
        partyBalanceAfter: Number(res.partyBalance ?? (partyBalance - receivedAmount)),
        cashboxName: selectedCashboxName,
        notes: savedNotes,
        isOffline: false
      });

      await Promise.all([loadPartyLedgerAndInvoices(), loadPartiesAndCashboxes()]);
      if (onCollectionSuccess) {
        onCollectionSuccess();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء تنفيذ التحصيل');
      setIsUnknownResultError(err?.code === 'UNKNOWN_RESULT');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveClick = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!canCollect) {
      setErrorMsg('ليس لديك صلاحية تحصيل الفواتير الآجلة');
      return;
    }
    if (!selectedPartyId) {
      setErrorMsg('يرجى اختيار الطرف أولاً');
      return;
    }
    if (selectedInvoiceIds.length === 0) {
      setErrorMsg('يرجى تحديد فاتورة معلّقة واحدة على الأقل للتحصيل');
      return;
    }
    if (receivedAmountInput.trim() === '' || isNaN(Number(receivedAmountInput)) || Number(receivedAmountInput) < 0) {
      setErrorMsg('يرجى إدخال المبلغ المستلم بشكل صحيح');
      return;
    }
    if (!selectedCashboxId) {
      setErrorMsg('يرجى اختيار الخزنة');
      return;
    }

    const receivedAmount = Number(Number(receivedAmountInput).toFixed(2));
    const diff = Number((receivedAmount - totalSelectedDue).toFixed(2));

    if (Math.abs(diff) < 0.01) {
      executeCollection(false);
    } else if (diff < 0) {
      setConfirmModal({
        open: true,
        type: 'under',
        diff: Math.abs(diff),
        partyName: selectedPartyName,
        totalDue: totalSelectedDue,
        receivedAmount
      });
    } else {
      setConfirmModal({
        open: true,
        type: 'over',
        diff: Math.abs(diff),
        partyName: selectedPartyName,
        totalDue: totalSelectedDue,
        receivedAmount
      });
    }
  };

  const totalLedgerDebit = useMemo(
    () => ledgerEntries.reduce((sum, e) => sum + Number(e.debit || 0), 0),
    [ledgerEntries]
  );
  const totalLedgerCredit = useMemo(
    () => ledgerEntries.reduce((sum, e) => sum + Number(e.credit || 0), 0),
    [ledgerEntries]
  );

  const innerContent = (
    <>
      {isOffline && (
        <div className="no-print border-r-2 border-amber-500 pr-3 text-xs font-bold ui-stock-low flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>الأرصدة قد تكون غير محدثة (وضع عدم الاتصال)</span>
          </span>
          <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
            <Clock className="w-3.5 h-3.5" />
            <span>آخر تحديث: {formattedLastSyncTime}</span>
          </span>
        </div>
      )}

      {/* صف الاختيار والتصفية */}
      <div className="flex flex-wrap items-end gap-3 pb-4 border-b border-[var(--border-subtle)]">
        {platformsEnabled && (
        <div className="no-print">
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            نوع الطرف
          </label>
          <div className="inline-flex border border-[var(--border-color)] rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setPartyType('customer')}
              className={`min-h-[44px] inline-flex items-center gap-1.5 px-3 text-xs font-bold transition cursor-pointer ${
                partyType === 'customer'
                  ? 'bg-[#1668B2] text-white'
                  : 'text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>عميل</span>
            </button>
            <button
              type="button"
              onClick={() => setPartyType('platform')}
              className={`min-h-[44px] inline-flex items-center gap-1.5 px-3 text-xs font-bold transition cursor-pointer ${
                partyType === 'platform'
                  ? 'bg-[#1668B2] text-white'
                  : 'text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>منصة</span>
            </button>
          </div>
        </div>
        )}

        <div className="no-print">
          <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            {partyType === 'customer' ? 'العميل' : 'المنصة'}
          </label>
          <select
            value={selectedPartyId}
            onChange={e => setSelectedPartyId(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-bold`}
          >
            <option value="">
              {partyType === 'customer' ? '-- اختر العميل --' : '-- اختر المنصة --'}
            </option>
            {partyType === 'customer'
              ? customers.map(c => {
                  const bal = Number(c.currentBalance || 0);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name} ({bal > 0 ? `عليه: ${bal.toFixed(2)}` : bal < 0 ? `له: ${Math.abs(bal).toFixed(2)}` : 'متزن'})
                    </option>
                  );
                })
              : platforms.map(p => {
                  const bal = Number(p.currentBalance || 0);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} ({bal > 0 ? `عليها: ${bal.toFixed(2)}` : bal < 0 ? `لها: ${Math.abs(bal).toFixed(2)}` : 'متزن'})
                    </option>
                  );
                })}
          </select>
        </div>

        <DateRangeFilter
          inline
          value={dateRange}
          onChange={setDateRange}
          defaultPreset="ALL"
        />

        <button
          type="button"
          onClick={loadPartyLedgerAndInvoices}
          className="no-print min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] transition cursor-pointer"
          title="تحديث البيانات"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>

        {selectedPartyId && (
          <div className="print-only print-filter-summary">
            {partyType === 'customer' ? 'العميل' : 'المنصة'}: {selectedPartyName}
          </div>
        )}
      </div>

      {/* سطر الأرصدة المختصر */}
      {selectedPartyId && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]">
          <span>
            الرصيد الحالي لـ (<strong className="text-[var(--text-primary)]">{selectedPartyName}</strong>):{' '}
            <strong
              className={`font-mono tabular-nums ${
                partyBalance > 0 ? 'ui-money-purchase' : partyBalance < 0 ? 'ui-money-sale' : 'text-[var(--text-primary)]'
              }`}
            >
              {partyBalance > 0 ? `+${partyBalance.toFixed(2)}` : partyBalance.toFixed(2)} ج.م
            </strong>{' '}
            ({partyBalance > 0 ? 'مدين' : partyBalance < 0 ? 'دائن' : 'متزن'})
          </span>
          <span>·</span>
          <span>
            الفواتير المعلّقة: <strong className="font-mono tabular-nums ui-stock-low">{selectablePendingInvoices.length}</strong> ({totalPendingDueAll.toFixed(2)} ج.م)
          </span>
          <span>·</span>
          <span>
            المحدد للتحصيل ({selectedInvoiceIds.length}): <strong className="font-mono tabular-nums ui-link">{totalSelectedDue.toFixed(2)} ج.م</strong>
          </span>
        </div>
      )}

      {errorMsg && (
        <div className="no-print flex items-center justify-between gap-2 text-xs font-bold ui-stock-out">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          {isUnknownResultError && (
            <button
              type="button"
              onClick={() => executeCollection(lastConfirmDiffRef.current)}
              disabled={submitting}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${submitting ? 'animate-spin' : ''}`} />
              <span>إعادة المحاولة</span>
            </button>
          )}
        </div>
      )}

      {successMsg && (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 text-xs font-bold ui-stock-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          {collectionReceipt && (
            <button
              type="button"
              onClick={() => setCollectionReceipt(prev => (prev ? { ...prev } : null))}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shrink-0 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>إيصال التحصيل</span>
            </button>
          )}
        </div>
      )}

      {/* الفواتير الآجلة المعلّقة */}
      <SectionHeading
        title={`الفواتير الآجلة المعلّقة (${filteredPendingInvoices.length})`}
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <div className="relative">
              <input
                type="text"
                value={invoiceSearchQuery}
                onChange={e => setInvoiceSearchQuery(e.target.value)}
                placeholder={platformsEnabled ? 'بحث برقم الفاتورة أو رقم طلب المنصة...' : 'بحث برقم الفاتورة أو اسم العميل...'}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} pl-3 pr-9 text-xs`}
              />
              <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute right-3 top-3.5 pointer-events-none" />
            </div>
            {selectablePendingInvoices.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectAll}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold ui-link cursor-pointer"
              >
                {selectedInvoiceIds.length === selectablePendingInvoices.length ? (
                  <>
                    <CheckSquare className="w-4 h-4" />
                    <span>إلغاء تحديد الكل</span>
                  </>
                ) : (
                  <>
                    <Square className="w-4 h-4" />
                    <span>تحديد الكل</span>
                  </>
                )}
              </button>
            )}
          </div>
        }
      />

      <CompactTable ariaLabel="الفواتير الآجلة المعلّقة">
        <thead>
          <tr>
            <th className={`no-print ${COMPACT_TABLE_NUM_CLASS}`}>تحديد</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>رقم الفاتورة</th>
            {platformsEnabled && <th className={COMPACT_TABLE_NUM_CLASS}>رقم طلب المنصة</th>}
            <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>إجمالي الفاتورة</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>الصافي</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>مبلغ الاستحقاق</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {filteredPendingInvoices.map(inv => {
            const isCollectedOffline = Boolean(inv.offlineCollectionPending);
            const isChecked = !isCollectedOffline && selectedInvoiceIds.includes(inv.invoiceNumber);
            const due = getInvoiceDueAmount(inv);
            const gross = Number(inv.totalBeforeDiscount || 0) + Number(inv.deliveryFee || 0);
            return (
              <tr
                key={inv.invoiceNumber}
                onClick={() => !isCollectedOffline && toggleSelectInvoice(inv.invoiceNumber)}
                className={isCollectedOffline ? 'opacity-70' : 'cursor-pointer'}
              >
                <td className={`no-print ${COMPACT_TABLE_NUM_CLASS}`} onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    disabled={isCollectedOffline}
                    checked={isChecked}
                    onChange={() => !isCollectedOffline && toggleSelectInvoice(inv.invoiceNumber)}
                    className="w-4 h-4 cursor-pointer disabled:opacity-40"
                  />
                </td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-link`}>
                  <div>#{inv.invoiceNumber}</div>
                  {platformsEnabled && inv.platformOrderId && (
                    <div className="text-[11px] font-sans text-[var(--text-secondary)]">
                      رقم طلب المنصة: <span className="font-mono font-bold text-[var(--text-primary)]">{inv.platformOrderId}</span>
                    </div>
                  )}
                </td>
                {platformsEnabled && (
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-xs text-[var(--text-primary)]`}>
                    {inv.platformOrderId || '—'}
                  </td>
                )}
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-xs text-[var(--text-secondary)]`}>{inv.date}</td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{gross.toFixed(2)} ج.م</td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono`}>{Number(inv.netAmount || 0).toFixed(2)} ج.م</td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-stock-low`}>{due.toFixed(2)} ج.م</td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  {isCollectedOffline ? (
                    <span className="text-xs font-bold ui-stock-in">محصّلة، لم تُرفع بعد</span>
                  ) : (
                    <span className="text-xs font-bold ui-stock-low">{inv.creditStatus || inv.status || 'معلّقة'}</span>
                  )}
                </td>
              </tr>
            );
          })}
          {filteredPendingInvoices.length === 0 && (
            <tr>
              <td colSpan={platformsEnabled ? 8 : 7} className="text-center text-[var(--text-secondary)]">
                لا توجد فواتير آجلة معلّقة لهذا الطرف
              </td>
            </tr>
          )}
        </tbody>
      </CompactTable>

      {/* سند تحصيل الآجل */}
      <div className="no-print space-y-3">
        <SectionHeading title="سند تحصيل الآجل" withTopDivider />

        <form onSubmit={handleSaveClick} className="flex flex-wrap items-end gap-3">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-bold text-[var(--text-primary)]">المبلغ المستلم فعليًا *</label>
              {selectedInvoiceIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setReceivedAmountInput(String(totalSelectedDue))}
                  className="text-xs font-bold ui-link hover:underline cursor-pointer"
                >
                  مطابقة ({totalSelectedDue.toFixed(2)})
                </button>
              )}
            </div>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              disabled={!canCollect || selectedInvoiceIds.length === 0}
              value={receivedAmountInput}
              onChange={e => setReceivedAmountInput(e.target.value)}
              placeholder="0.00"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono font-bold text-xs disabled:opacity-50`}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">الخزنة المستلمة *</label>
            <select
              required
              disabled={!canCollect}
              value={selectedCashboxId}
              onChange={e => setSelectedCashboxId(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold disabled:opacity-50`}
            >
              <option value="">-- اختر الخزنة --</option>
              {cashboxes.map(cb => (
                <option key={cb.id} value={cb.id}>
                  {cb.name} ({cb.currentBalance} {cb.currency})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">ملاحظات السند</label>
            <input
              type="text"
              disabled={!canCollect}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="رقم مرجع التحويل، اسم المندوب..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs disabled:opacity-50`}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !canCollect || selectedInvoiceIds.length === 0}
            className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-xs transition cursor-pointer"
          >
            <Wallet className="w-4 h-4" />
            <span>{submitting ? 'جاري الحفظ...' : `تحصيل الفواتير المحددة (${selectedInvoiceIds.length})`}</span>
          </button>
        </form>

        {selectedInvoiceIds.length > 0 && receivedAmountInput !== '' && !isNaN(Number(receivedAmountInput)) && (
          <div className="text-xs font-bold">
            {Math.abs(Number(receivedAmountInput) - totalSelectedDue) < 0.01 ? (
              <span className="ui-stock-in">✓ مطابق لإجمالي المستحق ({totalSelectedDue.toFixed(2)} ج.م)</span>
            ) : Number(receivedAmountInput) < totalSelectedDue ? (
              <span className="ui-stock-low">
                أقل من المستحق بمقدار {(totalSelectedDue - Number(receivedAmountInput)).toFixed(2)} ج.م (سيُرحَّل على الطرف)
              </span>
            ) : (
              <span className="ui-link">
                أعلى من المستحق بمقدار {(Number(receivedAmountInput) - totalSelectedDue).toFixed(2)} ج.م (سيُسجَّل دائنًا للطرف)
              </span>
            )}
          </div>
        )}
      </div>

      {/* سجل حساب الطرف */}
      <SectionHeading
        title={`سجل حساب الطرف بالحركات — ${selectedPartyName || '—'}`}
        actions={
          <span
            className={`text-xs font-mono font-bold ${
              partyBalance > 0 ? 'ui-money-purchase' : partyBalance < 0 ? 'ui-money-sale' : 'text-[var(--text-primary)]'
            }`}
          >
            الرصيد: {partyBalance > 0 ? `+${partyBalance.toFixed(2)}` : partyBalance.toFixed(2)} ج.م
          </span>
        }
        withTopDivider
      />

      <CompactTable ariaLabel="سجل حساب الطرف">
        <thead>
          <tr>
            <th className={COMPACT_TABLE_NUM_CLASS}>التاريخ</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>نوع الحركة</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>رقم المستند</th>
            <th className={COMPACT_TABLE_TEXT_CLASS}>البيان</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>مدين (+)</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>دائن (-)</th>
            <th className={COMPACT_TABLE_NUM_CLASS}>الرصيد التراكمي</th>
          </tr>
        </thead>
        <tbody>
          {ledgerEntries.map(entry => {
            const debit = Number(entry.debit || 0);
            const credit = Number(entry.credit || 0);
            const running = Number(entry.balanceAfter || 0);
            return (
              <tr key={entry.id}>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-xs text-[var(--text-secondary)]`}>{entry.date}</td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-bold ${
                      entry.transactionType === 'فاتورة آجل' || entry.transactionType === 'فاتورة مبيعات'
                        ? 'ui-money-purchase'
                        : entry.transactionType === 'تحصيل' || entry.transactionType === 'دفعة نقدية'
                        ? 'ui-money-sale'
                        : 'ui-stock-low'
                    }`}
                  >
                    {debit > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
                    {entry.transactionType}
                  </span>
                </td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-xs text-[var(--text-secondary)]`}>
                  {entry.documentNumber}
                </td>
                <td className={COMPACT_TABLE_TEXT_CLASS}>{entry.statement}</td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-purchase`}>
                  {debit > 0 ? `${debit.toFixed(2)} ج.م` : '—'}
                </td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-sale`}>
                  {credit > 0 ? `${credit.toFixed(2)} ج.م` : '—'}
                </td>
                <td
                  className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ${
                    running > 0 ? 'ui-money-purchase' : running < 0 ? 'ui-money-sale' : 'text-[var(--text-primary)]'
                  }`}
                >
                  {running > 0 ? `+${running.toFixed(2)}` : running.toFixed(2)} ج.م
                </td>
              </tr>
            );
          })}
          {ledgerEntries.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-[var(--text-secondary)]">
                لا توجد حركات مسجلة لهذا الطرف
              </td>
            </tr>
          )}
        </tbody>
        {ledgerEntries.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={4} className="font-bold">
                إجمالي الحركات والرصيد النهائي
              </td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-purchase`}>
                {totalLedgerDebit.toFixed(2)} ج.م
              </td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-sale`}>
                {totalLedgerCredit.toFixed(2)} ج.م
              </td>
              <td
                className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ${
                  partyBalance > 0 ? 'ui-money-purchase' : partyBalance < 0 ? 'ui-money-sale' : 'text-[var(--text-primary)]'
                }`}
              >
                {partyBalance > 0 ? `+${partyBalance.toFixed(2)}` : partyBalance.toFixed(2)} ج.م
              </td>
            </tr>
          </tfoot>
        )}
      </CompactTable>

      {/* Confirmation Modal for Difference */}
      {confirmModal?.open && (
        <ModalShell
          title="تأكيد فرق التحصيل"
          subtitle="المبلغ المدخل يختلف عن إجمالي المستحق للفواتير المحددة"
          onClose={() => setConfirmModal(null)}
          closeDisabled={submitting}
          footer={
            <>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmModal(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => executeCollection(true)}
                className="min-h-[44px] px-5 rounded-lg bg-[#1668B2] hover:bg-[#125592] text-white text-xs font-bold cursor-pointer"
              >
                {submitting ? 'جاري التأكيد...' : 'موافق'}
              </button>
            </>
          }
        >
          <p className="text-xs font-bold text-[var(--text-primary)]">
            {confirmModal.type === 'under'
              ? `المبلغ أقل من المستحق بمقدار ${confirmModal.diff.toFixed(2)}، وسيُرحَّل الفرق على ${confirmModal.partyName}`
              : `المبلغ أعلى من المستحق بمقدار ${confirmModal.diff.toFixed(2)}، وسيُسجَّل كرصيد دائن لـ ${confirmModal.partyName}`}
          </p>

          <ReportSummaryTable
            rows={[
              { label: 'إجمالي المستحق للفواتير المحددة', value: `${confirmModal.totalDue.toFixed(2)} ج.م` },
              { label: 'المبلغ المستلم (يدخل الخزنة فقط)', value: `${confirmModal.receivedAmount.toFixed(2)} ج.م`, tone: 'sale' },
              {
                label: 'حركة فرق التحصيل',
                value: `${confirmModal.diff.toFixed(2)} ج.م (${confirmModal.type === 'under' ? 'مدين على الطرف' : 'دائن للطرف'})`,
                tone: 'accent',
              },
            ]}
          />
        </ModalShell>
      )}

      {/* Collection Receipt Modal */}
      {collectionReceipt && (
        <ModalShell
          printable
          title="إيصال تحصيل آجل"
          subtitle={`سند رقم ${collectionReceipt.collectionId}`}
          onClose={() => setCollectionReceipt(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة إيصال التحصيل</span>
              </button>
              <button
                type="button"
                onClick={() => setCollectionReceipt(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
              >
                إغلاق
              </button>
            </>
          }
        >
          <div id="credit-collection-receipt-printable" className="space-y-4">
            {collectionReceipt.isOffline && (
              <div className="flex items-center gap-2 text-xs font-bold ui-stock-low">
                <WifiOff className="w-4 h-4 shrink-0" />
                <span>مسجل بدون إنترنت</span>
              </div>
            )}

            <ReportSummaryTable
              rows={[
                { label: 'رقم سند التحصيل', value: collectionReceipt.collectionId },
                { label: 'التاريخ والوقت', value: new Date(collectionReceipt.date).toLocaleString('ar-EG') },
                { label: collectionReceipt.partyType === 'customer' ? 'العميل' : 'المنصة', value: collectionReceipt.partyName },
                { label: 'الخزنة المستلمة', value: collectionReceipt.cashboxName },
                { label: 'الفواتير المحصّلة', value: collectionReceipt.invoiceNumbers.join('، ') },
                { label: 'إجمالي المستحق', value: `${collectionReceipt.totalDue.toFixed(2)} ج.م` },
                { label: 'المبلغ المستلم فعليًا', value: `${collectionReceipt.receivedAmount.toFixed(2)} ج.م`, tone: 'sale', emphasize: true },
                ...(Math.abs(collectionReceipt.difference) >= 0.01
                  ? [
                      {
                        label: 'فرق التحصيل',
                        value: `${Math.abs(collectionReceipt.difference).toFixed(2)} ج.م (${collectionReceipt.difference < 0 ? 'مُرحّل على الطرف' : 'رصيد دائن للطرف'})`,
                        tone: 'accent' as const,
                      },
                    ]
                  : []),
                { label: 'رصيد الطرف بعد الحركة', value: `${collectionReceipt.partyBalanceAfter.toFixed(2)} ج.م`, emphasize: true },
              ]}
            />

            {collectionReceipt.notes && (
              <div className="text-xs text-[var(--text-secondary)]">
                <strong>ملاحظات: </strong>
                <span>{collectionReceipt.notes}</span>
              </div>
            )}
          </div>
        </ModalShell>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="space-y-5" dir="rtl">
        {innerContent}
      </div>
    );
  }

  return (
    <PageSurface
      dir="rtl"
      title="تحصيل الفواتير الآجلة وسجل حساب الطرف"
      subtitle={
        platformsEnabled
          ? 'اختر الطرف (عميل أو منصة) لعرض الفواتير المعلّقة، تسوية المستحقات، ومراجعة حركات الحساب'
          : 'اختر العميل لعرض الفواتير المعلّقة، تسوية المستحقات، ومراجعة حركات الحساب'
      }
    >
      {innerContent}
    </PageSurface>
  );
}

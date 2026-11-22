import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  X,
  Loader2,
  Bike,
  Truck,
  Wallet,
  Banknote
} from 'lucide-react';
import { api } from '../api/client';
import {
  UserAccount,
  Cashbox,
  DeliveryAssigneeType,
  DeliveryConfigResponse,
  DeliverySettlement,
  DeliverySettlementPreviewResponse,
  DeliverySettleResponse,
  DeliveryDriverDues,
  DeliveryDriverPayout,
  DeliveryPayoutPreview
} from '../types';
import { hasPermission } from '../utils/permissions';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ModalShell,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS
} from '../components/ui';

interface DeliverySettlementsPageProps {
  user: UserAccount;
  onFinancialChange?: () => void;
}

const MAX_MONEY = 10_000_000;

function formatMoney(value: number): string {
  const num = Number(value) || 0;
  return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      timeZone: 'Africa/Cairo',
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(dt);
  } catch {
    return dt.toLocaleString('ar-EG');
  }
}

function makeIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatShortageLabel(shortage: number): { text: string; className: string } {
  const val = Number(shortage) || 0;
  if (Math.abs(val) < 0.005) {
    return { text: 'مطابق (0.00 ج.م)', className: 'text-emerald-700 dark:text-emerald-300' };
  }
  if (val > 0) {
    return {
      text: `عجز ${formatMoney(val)}`,
      className: 'text-rose-700 dark:text-rose-300 font-bold'
    };
  }
  return {
    text: `زيادة ${formatMoney(Math.abs(val))}`,
    className: 'text-sky-700 dark:text-sky-300 font-bold'
  };
}

export const DeliverySettlementsPage: React.FC<DeliverySettlementsPageProps> = ({
  user,
  onFinancialChange
}) => {
  const isDesigner = user.role === 'designer';
  const canSettle =
    isDesigner ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'delivery.settle');
  const canViewCashboxes =
    isDesigner ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'cashbox.view');

  // بيانات التهيئة والخزائن وسجل التسويات
  const [deliveryConfig, setDeliveryConfig] = useState<DeliveryConfigResponse | null>(null);
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [cashboxesLoading, setCashboxesLoading] = useState<boolean>(true);
  const [cashboxesError, setCashboxesError] = useState<string | null>(null);

  const [settlements, setSettlements] = useState<DeliverySettlement[]>([]);
  const [settlementsLoading, setSettlementsLoading] = useState<boolean>(true);
  const [settlementsError, setSettlementsError] = useState<string | null>(null);
  const [historyFilterType, setHistoryFilterType] = useState<'ALL' | DeliveryAssigneeType>('ALL');

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // ================== قسم التسويات ==================
  const [settleType, setSettleType] = useState<DeliveryAssigneeType>('driver');
  const [settleAssigneeId, setSettleAssigneeId] = useState<string>('');
  const [preview, setPreview] = useState<DeliverySettlementPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [receivedAmountInput, setReceivedAmountInput] = useState<string>('');
  const [settleCashboxId, setSettleCashboxId] = useState<string>('');
  const [settleNote, setSettleNote] = useState<string>('');
  const [settleFormError, setSettleFormError] = useState<string | null>(null);

  // نافذة تأكيد التسوية (تشمل تأكيد الفرق من السيرفر عند requiresConfirmation)
  const [settleConfirmOpen, setSettleConfirmOpen] = useState<boolean>(false);
  const [settleIdemKey, setSettleIdemKey] = useState<string>('');
  const [settleDiffPrompt, setSettleDiffPrompt] = useState<DeliverySettleResponse | null>(null);
  const [settleConfirmError, setSettleConfirmError] = useState<string | null>(null);
  const [isSubmittingSettle, setIsSubmittingSettle] = useState<boolean>(false);

  // ================== قسم مستحقات الطيارين ==================
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [driverDues, setDriverDues] = useState<DeliveryDriverDues | null>(null);
  const [driverPayouts, setDriverPayouts] = useState<DeliveryDriverPayout[]>([]);
  const [duesLoading, setDuesLoading] = useState<boolean>(false);
  const [duesError, setDuesError] = useState<string | null>(null);

  const [payoutSalaryInput, setPayoutSalaryInput] = useState<string>('0');
  const [payoutPayCommission, setPayoutPayCommission] = useState<boolean>(true);
  const [payoutDeductShortage, setPayoutDeductShortage] = useState<boolean>(true);
  const [payoutCashboxId, setPayoutCashboxId] = useState<string>('');
  const [payoutNote, setPayoutNote] = useState<string>('');
  const [payoutFormError, setPayoutFormError] = useState<string | null>(null);

  // معاينة الصرف من السيرفر قبل التأكيد (read-only)
  const [payoutPreview, setPayoutPreview] = useState<DeliveryPayoutPreview | null>(null);
  const [payoutPreviewLoading, setPayoutPreviewLoading] = useState<boolean>(false);
  const [payoutPreviewError, setPayoutPreviewError] = useState<string | null>(null);
  const [isPreparingPayoutConfirm, setIsPreparingPayoutConfirm] = useState<boolean>(false);

  // نافذة تأكيد صرف المستحقات
  const [payoutConfirmOpen, setPayoutConfirmOpen] = useState<boolean>(false);
  const [payoutIdemKey, setPayoutIdemKey] = useState<string>('');
  const [payoutPreviewChangedNotice, setPayoutPreviewChangedNotice] = useState<{
    previousPaid: number;
    message: string;
  } | null>(null);
  const [payoutConfirmError, setPayoutConfirmError] = useState<string | null>(null);
  const [isSubmittingPayout, setIsSubmittingPayout] = useState<boolean>(false);

  // قوائم الطيارين وشركات الشحن (النشطون من /api/delivery/config + من ظهروا في سجل التسويات)
  const driverOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; phone?: string }>();
    for (const d of deliveryConfig?.drivers || []) {
      map.set(d.id, { id: d.id, name: d.name, phone: d.phone });
    }
    for (const s of settlements) {
      if (s.assigneeType === 'driver' && s.assigneeId && !map.has(s.assigneeId)) {
        map.set(s.assigneeId, { id: s.assigneeId, name: s.assigneeName });
      }
    }
    return Array.from(map.values());
  }, [deliveryConfig, settlements]);

  const courierOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const c of deliveryConfig?.couriers || []) {
      map.set(c.id, { id: c.id, name: c.name });
    }
    for (const s of settlements) {
      if (s.assigneeType === 'courier' && s.assigneeId && !map.has(s.assigneeId)) {
        map.set(s.assigneeId, { id: s.assigneeId, name: s.assigneeName });
      }
    }
    return Array.from(map.values());
  }, [deliveryConfig, settlements]);

  // الخزائن النشطة والمسموح بها وفق صلاحيات المستخدم وإعدادات خزائنه
  const activeCashboxes = useMemo(
    () => cashboxes.filter((c) => c.status !== 'inactive' && c.status !== 'موقوفة'),
    [cashboxes]
  );

  // للتحصيل في التسوية (received >= 0) يطبّق السيرفر في resolveDeliveryCashbox تقييد allowedReceiptCashboxIds || allowedSaleCashboxIds
  const parsedReceivedAmount = useMemo(() => {
    const trimmed = receivedAmountInput.trim();
    if (trimmed === '') return NaN;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : NaN;
  }, [receivedAmountInput]);

  const allowedSettleCashboxes = useMemo(() => {
    if (isDesigner) return activeCashboxes;
    const isReceipt = Number.isNaN(parsedReceivedAmount) || parsedReceivedAmount >= 0;
    const allowedIds =
      user.cashboxConfig?.allowedReceiptCashboxIds &&
      user.cashboxConfig.allowedReceiptCashboxIds.length > 0
        ? user.cashboxConfig.allowedReceiptCashboxIds
        : user.cashboxConfig?.allowedSaleCashboxIds &&
          user.cashboxConfig.allowedSaleCashboxIds.length > 0
        ? user.cashboxConfig.allowedSaleCashboxIds
        : null;
    if (isReceipt && allowedIds) {
      return activeCashboxes.filter((c) => allowedIds.includes(c.id));
    }
    return activeCashboxes;
  }, [activeCashboxes, isDesigner, parsedReceivedAmount, user.cashboxConfig]);

  const settleCashboxBlockReason = useMemo(() => {
    if (!canViewCashboxes) {
      return 'لا تملك صلاحية عرض الخزائن (cashbox.view) اللازمة لاختيار خزنة التسوية. لا يمكن تنفيذ التسوية بدون خزنة مسموح بها.';
    }
    if (cashboxesLoading) return null;
    if (cashboxesError) {
      return `تعذر تحميل الخزائن: ${cashboxesError}. لا يمكن تنفيذ التسوية بدون خزنة مسموح بها.`;
    }
    if (allowedSettleCashboxes.length === 0) {
      return 'لا توجد خزنة نشطة ومسموح لك باستخدامها للتسوية. لا يمكن تنفيذ التسوية بدون خزنة مسموح بها.';
    }
    return null;
  }, [canViewCashboxes, cashboxesLoading, cashboxesError, allowedSettleCashboxes.length]);

  const payoutCashboxBlockReason = useMemo(() => {
    if (!canViewCashboxes) {
      return 'لا تملك صلاحية عرض الخزائن (cashbox.view) اللازمة لاختيار خزنة الصرف. لا يمكن صرف مستحقات الطيار بدون خزنة مسموح بها.';
    }
    if (cashboxesLoading) return null;
    if (cashboxesError) {
      return `تعذر تحميل الخزائن: ${cashboxesError}. لا يمكن صرف المستحقات بدون خزنة مسموح بها.`;
    }
    if (activeCashboxes.length === 0) {
      return 'لا توجد خزنة نشطة متاحة للصرف. لا يمكن صرف مستحقات الطيار بدون خزنة مسموح بها.';
    }
    return null;
  }, [canViewCashboxes, cashboxesLoading, cashboxesError, activeCashboxes.length]);

  // تحميل الخزائن من مسار المشروع المعتمد فقط (GET /api/cashboxes) مع احترام الصلاحية
  const loadCashboxes = useCallback(async () => {
    if (!canSettle) return;
    if (!canViewCashboxes) {
      setCashboxes([]);
      setCashboxesError(null);
      setCashboxesLoading(false);
      return;
    }
    setCashboxesLoading(true);
    setCashboxesError(null);
    try {
      const res = await api.getCashboxes();
      if (!res || !res.success || !Array.isArray(res.cashboxes)) {
        throw new Error('تعذر تحميل قائمة الخزائن من السيرفر');
      }
      setCashboxes(res.cashboxes);
    } catch (err: any) {
      setCashboxes([]);
      setCashboxesError(err?.message || 'تعذر تحميل قائمة الخزائن');
    } finally {
      setCashboxesLoading(false);
    }
  }, [canSettle, canViewCashboxes]);

  const loadConfig = useCallback(async () => {
    if (!canSettle) return;
    try {
      const res = await api.getDeliveryConfig();
      if (res && res.success) {
        setDeliveryConfig(res);
      }
    } catch {
      // keep existing config if request fails
    }
  }, [canSettle]);

  const loadSettlementsHistory = useCallback(async () => {
    if (!canSettle) {
      setSettlementsLoading(false);
      return;
    }
    setSettlementsLoading(true);
    setSettlementsError(null);
    try {
      const res = await api.getDeliverySettlements(
        historyFilterType === 'ALL' ? {} : { assigneeType: historyFilterType }
      );
      if (!res || !res.success) {
        throw new Error(res?.error || 'تعذر تحميل سجل التسويات');
      }
      setSettlements(Array.isArray(res.settlements) ? res.settlements : []);
    } catch (err: any) {
      setSettlementsError(err?.message || 'تعذر تحميل سجل التسويات');
    } finally {
      setSettlementsLoading(false);
    }
  }, [canSettle, historyFilterType]);

  const loadSettlementPreview = useCallback(
    async (type: DeliveryAssigneeType, id: string) => {
      if (!canSettle || !id) {
        setPreview(null);
        setPreviewError(null);
        setReceivedAmountInput('');
        return;
      }
      setPreviewLoading(true);
      setPreviewError(null);
      setSettleFormError(null);
      try {
        const res = await api.getDeliverySettlementPreview(type, id);
        if (!res || !res.success) {
          throw new Error(res?.error || 'تعذر تحميل معاينة التسوية');
        }
        setPreview(res);
        setReceivedAmountInput(res.orders.length > 0 ? String(res.expected) : '');
      } catch (err: any) {
        setPreview(null);
        setPreviewError(err?.message || 'تعذر تحميل معاينة التسوية');
        setReceivedAmountInput('');
      } finally {
        setPreviewLoading(false);
      }
    },
    [canSettle]
  );

  const loadDriverDues = useCallback(
    async (driverId: string) => {
      if (!canSettle || !driverId) {
        setDriverDues(null);
        setDriverPayouts([]);
        setDuesError(null);
        return;
      }
      setDuesLoading(true);
      setDuesError(null);
      setPayoutFormError(null);
      try {
        const res = await api.getDeliveryDriverDues(driverId);
        if (!res || !res.success || !res.dues) {
          throw new Error(res?.error || 'تعذر تحميل مستحقات الطيار');
        }
        setDriverDues(res.dues);
        setDriverPayouts(Array.isArray(res.payouts) ? res.payouts : []);
        setPayoutSalaryInput(String(res.dues.monthlySalary ?? 0));
        setPayoutPayCommission(res.dues.commissionUnpaid > 0);
        setPayoutDeductShortage(res.dues.shortageOutstanding > 0);
      } catch (err: any) {
        setDriverDues(null);
        setDriverPayouts([]);
        setDuesError(err?.message || 'تعذر تحميل مستحقات الطيار');
      } finally {
        setDuesLoading(false);
      }
    },
    [canSettle]
  );

  // التحميل الأولي
  useEffect(() => {
    if (!canSettle) return;
    loadConfig();
    loadCashboxes();
  }, [canSettle, loadConfig, loadCashboxes]);

  useEffect(() => {
    loadSettlementsHistory();
  }, [loadSettlementsHistory]);

  // ضبط الخزنة الافتراضية تلقائيًا عند توفر الخزائن المسموح بها
  useEffect(() => {
    if (allowedSettleCashboxes.length === 0) {
      setSettleCashboxId('');
      return;
    }
    setSettleCashboxId((prev) =>
      prev && allowedSettleCashboxes.some((c) => c.id === prev)
        ? prev
        : allowedSettleCashboxes[0].id
    );
  }, [allowedSettleCashboxes]);

  useEffect(() => {
    if (activeCashboxes.length === 0) {
      setPayoutCashboxId('');
      return;
    }
    setPayoutCashboxId((prev) =>
      prev && activeCashboxes.some((c) => c.id === prev) ? prev : activeCashboxes[0].id
    );
  }, [activeCashboxes]);

  // مواءمة نوع الجهة المختارة مع القوائم المتاحة أول مرة
  useEffect(() => {
    if (!deliveryConfig) return;
    if (deliveryConfig.settings.mode === 'couriers' && settleType === 'driver' && driverOptions.length === 0) {
      setSettleType('courier');
    } else if (deliveryConfig.settings.mode === 'drivers' && settleType === 'courier' && courierOptions.length === 0) {
      setSettleType('driver');
    }
  }, [deliveryConfig, settleType, driverOptions.length, courierOptions.length]);

  // جلب المعاينة عند تغيير الجهة المختارة
  useEffect(() => {
    if (settleAssigneeId) {
      loadSettlementPreview(settleType, settleAssigneeId);
    } else {
      setPreview(null);
      setPreviewError(null);
      setReceivedAmountInput('');
    }
  }, [settleType, settleAssigneeId, loadSettlementPreview]);

  // جلب مستحقات الطيار عند اختيار طيار
  useEffect(() => {
    setPayoutPreview(null);
    setPayoutPreviewError(null);
    setPayoutPreviewChangedNotice(null);
    if (selectedDriverId) {
      loadDriverDues(selectedDriverId);
    } else {
      setDriverDues(null);
      setDriverPayouts([]);
      setDuesError(null);
    }
  }, [selectedDriverId, loadDriverDues]);

  // معاينة صرف مستحقات الطيار من السيرفر مباشرة دون أي تكرار للمعادلة في الواجهة
  useEffect(() => {
    if (payoutConfirmOpen) {
      return;
    }
    if (!canSettle || !selectedDriverId || !driverDues || driverDues.driverId !== selectedDriverId) {
      setPayoutPreview(null);
      setPayoutPreviewLoading(false);
      setPayoutPreviewError(null);
      return;
    }

    const trimmedSalary = payoutSalaryInput.trim();
    const salaryNum = trimmedSalary === '' ? 0 : Number(trimmedSalary);
    if (!Number.isFinite(salaryNum) || salaryNum < 0 || salaryNum > MAX_MONEY) {
      setPayoutPreview(null);
      setPayoutPreviewLoading(false);
      setPayoutPreviewError(`أدخل قيمة مرتب صالحة من 0 إلى ${MAX_MONEY.toLocaleString('en-US')} لحساب المعاينة.`);
      return;
    }

    let cancelled = false;
    setPayoutPreviewLoading(true);
    setPayoutPreviewError(null);

    const timer = window.setTimeout(() => {
      api
        .getDeliveryPayoutPreview({
          driverId: selectedDriverId,
          salary: salaryNum,
          payCommission: payoutPayCommission,
          deductShortage: payoutDeductShortage
        })
        .then((res) => {
          if (cancelled) return;
          if (!res || !res.success || !res.preview) {
            throw new Error(res?.error || 'تعذر حساب معاينة صرف المستحقات');
          }
          setPayoutPreview(res.preview);
          if (res.dues) {
            setDriverDues(res.dues);
          }
        })
        .catch((err: any) => {
          if (cancelled) return;
          setPayoutPreview(null);
          setPayoutPreviewError(err?.message || 'تعذر حساب معاينة صرف المستحقات');
        })
        .finally(() => {
          if (!cancelled) setPayoutPreviewLoading(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    canSettle,
    payoutConfirmOpen,
    selectedDriverId,
    driverDues?.driverId,
    driverDues?.commissionUnpaid,
    driverDues?.shortageOutstanding,
    payoutSalaryInput,
    payoutPayCommission,
    payoutDeductShortage
  ]);

  const handleRefreshAll = () => {
    setFeedback(null);
    loadConfig();
    loadCashboxes();
    loadSettlementsHistory();
    if (settleAssigneeId) {
      loadSettlementPreview(settleType, settleAssigneeId);
    }
    if (selectedDriverId) {
      loadDriverDues(selectedDriverId);
    }
  };

  // فتح نافذة تأكيد التسوية
  const handleOpenSettleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setSettleFormError(null);

    if (settleCashboxBlockReason) {
      setSettleFormError(settleCashboxBlockReason);
      return;
    }
    if (!preview || preview.orders.length === 0) {
      setSettleFormError('لا توجد طلبات مستحقة للتسوية لهذه الجهة.');
      return;
    }
    if (receivedAmountInput.trim() === '' || !Number.isFinite(parsedReceivedAmount)) {
      setSettleFormError('أدخل المبلغ المستلم الفعلي بشكل رقمي صحيح.');
      return;
    }
    if (preview.assigneeType === 'driver' && parsedReceivedAmount < 0) {
      setSettleFormError('المبلغ المستلم من الطيار يجب أن يكون 0 فأكثر.');
      return;
    }
    if (!settleCashboxId || !allowedSettleCashboxes.some((c) => c.id === settleCashboxId)) {
      setSettleFormError('اختر خزنة مسموح بها لإتمام التسوية.');
      return;
    }

    setSettleIdemKey(makeIdempotencyKey('stl'));
    setSettleDiffPrompt(null);
    setSettleConfirmError(null);
    setSettleConfirmOpen(true);
  };

  // تنفيذ POST /api/delivery/settle (أول مرة confirmDifference=false، وعند وجود فرق يعيد السيرفر requiresConfirmation ليؤكده المستخدم)
  const handleSubmitSettle = async (confirmDifference: boolean) => {
    if (!preview || isSubmittingSettle) return;
    if (settleCashboxBlockReason || !settleCashboxId) {
      setSettleConfirmError(settleCashboxBlockReason || 'يجب اختيار خزنة مسموح بها قبل التنفيذ.');
      return;
    }

    setIsSubmittingSettle(true);
    setSettleConfirmError(null);
    try {
      const res = await api.settleDelivery({
        assigneeType: preview.assigneeType,
        assigneeId: preview.assigneeId,
        orderIds: preview.orders.map((o) => o.id),
        receivedAmount: parsedReceivedAmount,
        cashboxId: settleCashboxId,
        confirmDifference,
        note: settleNote.trim() || undefined,
        idempotencyKey: settleIdemKey
      });

      if (res.requiresConfirmation) {
        setSettleDiffPrompt(res);
        return;
      }

      if (!res.success || !res.settlement) {
        throw new Error(res.error || 'تعذر تسجيل التسوية');
      }

      const st = res.settlement;
      setSettleConfirmOpen(false);
      setSettleDiffPrompt(null);
      setSettleNote('');
      setFeedback({
        type: 'success',
        message: `تم تسجيل التسوية ${st.number} مع «${st.assigneeName}»: المتوقع ${formatMoney(st.expected)}، المستلم ${formatMoney(st.received)}${Math.abs(st.shortage) >= 0.005 ? ` (${formatShortageLabel(st.shortage).text})` : ''} — الخزنة: ${st.cashboxName}.`
      });

      // تحديث فوري من السيرفر لكل البيانات المرتبطة
      await Promise.all([
        loadSettlementPreview(preview.assigneeType, preview.assigneeId),
        loadSettlementsHistory(),
        loadCashboxes(),
        selectedDriverId ? loadDriverDues(selectedDriverId) : Promise.resolve()
      ]);
      if (onFinancialChange) {
        onFinancialChange();
      }
    } catch (err: any) {
      setSettleConfirmError(err?.message || 'تعذر تسجيل التسوية');
    } finally {
      setIsSubmittingSettle(false);
    }
  };

  // فتح نافذة تأكيد صرف مستحقات الطيار بعد جلب أحدث معاينة موثوقة من السيرفر
  const handleOpenPayoutConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayoutFormError(null);

    if (payoutCashboxBlockReason) {
      setPayoutFormError(payoutCashboxBlockReason);
      return;
    }
    if (!driverDues) {
      setPayoutFormError('اختر طيارًا أولًا لعرض مستحقاته.');
      return;
    }
    const trimmedSalary = payoutSalaryInput.trim();
    const salaryNum = trimmedSalary === '' ? 0 : Number(trimmedSalary);
    if (!Number.isFinite(salaryNum) || salaryNum < 0 || salaryNum > MAX_MONEY) {
      setPayoutFormError(`أدخل قيمة مرتب صالحة من 0 إلى ${MAX_MONEY.toLocaleString('en-US')}.`);
      return;
    }
    if (!payoutCashboxId || !activeCashboxes.some((c) => c.id === payoutCashboxId)) {
      setPayoutFormError('اختر خزنة مسموح بها لصرف المستحقات.');
      return;
    }

    setIsPreparingPayoutConfirm(true);
    try {
      const res = await api.getDeliveryPayoutPreview({
        driverId: driverDues.driverId,
        salary: salaryNum,
        payCommission: payoutPayCommission,
        deductShortage: payoutDeductShortage
      });
      if (!res || !res.success || !res.preview) {
        throw new Error(res?.error || 'تعذر تحميل معاينة صرف المستحقات من السيرفر');
      }
      setPayoutPreview(res.preview);
      if (res.dues) {
        setDriverDues(res.dues);
      }
      if (!res.preview.canPayout) {
        setPayoutFormError('لا توجد مستحقات للصرف: أدخل المرتب أو فعّل صرف العمولات المستحقة.');
        return;
      }

      setPayoutIdemKey(makeIdempotencyKey('pay'));
      setPayoutPreviewChangedNotice(null);
      setPayoutConfirmError(null);
      setPayoutConfirmOpen(true);
    } catch (err: any) {
      setPayoutFormError(err?.message || 'تعذر تحميل معاينة صرف المستحقات من السيرفر');
    } finally {
      setIsPreparingPayoutConfirm(false);
    }
  };

  // تنفيذ POST /api/delivery/payouts مع التحقق من تطابق المعاينة على السيرفر
  const handleSubmitPayout = async () => {
    if (!driverDues || !payoutPreview || isSubmittingPayout) return;
    if (payoutCashboxBlockReason || !payoutCashboxId) {
      setPayoutConfirmError(payoutCashboxBlockReason || 'يجب اختيار خزنة مسموح بها قبل الصرف.');
      return;
    }
    if (!payoutPreview.canPayout) {
      setPayoutConfirmError('لا توجد مستحقات صالحة للصرف وفق المعاينة الحالية.');
      return;
    }

    setIsSubmittingPayout(true);
    setPayoutConfirmError(null);
    try {
      const res = await api.createDeliveryDriverPayout({
        driverId: payoutPreview.driverId,
        salary: payoutPreview.salary,
        payCommission: payoutPreview.payCommission,
        deductShortage: payoutPreview.deductShortage,
        cashboxId: payoutCashboxId,
        note: payoutNote.trim() || undefined,
        idempotencyKey: payoutIdemKey,
        expectedPreview: {
          salary: payoutPreview.salary,
          commission: payoutPreview.commission,
          shortageDeducted: payoutPreview.shortageDeducted,
          paid: payoutPreview.paid,
          orderIds: payoutPreview.orderIds
        }
      });

      if (res.requiresConfirmation && res.preview) {
        const previousPaid = payoutPreview.paid;
        setPayoutPreview(res.preview);
        if (res.dues) {
          setDriverDues(res.dues);
        }
        setPayoutPreviewChangedNotice({
          previousPaid,
          message:
            res.message ||
            res.error ||
            'تغيّرت مستحقات الطيار أو صافي المبلغ منذ المعاينة. راجع المعاينة المحدثة وأكّد الصرف من جديد.'
        });
        setPayoutIdemKey(makeIdempotencyKey('pay'));
        return;
      }

      if (!res.success || !res.payout) {
        throw new Error(res.error || 'تعذر صرف مستحقات الطيار');
      }

      const p = res.payout;
      setPayoutConfirmOpen(false);
      setPayoutPreviewChangedNotice(null);
      setPayoutNote('');
      setFeedback({
        type: 'success',
        message: `تم تسجيل صرف المستحقات ${p.number} للطيار «${p.driverName}»: مرتب ${formatMoney(p.salary)} + عمولة ${formatMoney(p.commission)}${p.shortageDeducted > 0 ? ` − عجز مخصوم ${formatMoney(p.shortageDeducted)}` : ''} = صافي مصروف ${formatMoney(p.paid)} من خزنة «${p.cashboxName}».`
      });

      await Promise.all([
        loadDriverDues(driverDues.driverId),
        loadCashboxes()
      ]);
      if (onFinancialChange) {
        onFinancialChange();
      }
    } catch (err: any) {
      setPayoutConfirmError(err?.message || 'تعذر صرف مستحقات الطيار');
    } finally {
      setIsSubmittingPayout(false);
    }
  };

  const selectedSettleCashbox = allowedSettleCashboxes.find((c) => c.id === settleCashboxId) || null;
  const selectedPayoutCashbox = activeCashboxes.find((c) => c.id === payoutCashboxId) || null;

  if (!canSettle) {
    return (
      <PageSurface title="التسويات ومستحقات الطيارين">
        <div
          role="alert"
          className="py-6 text-sm font-semibold text-rose-700 dark:text-rose-300"
        >
          غير مصرح لك بالوصول إلى التسويات ومستحقات الطيارين (تتطلب صلاحية delivery.settle).
        </div>
      </PageSurface>
    );
  }

  return (
    <PageSurface
      title="التسويات ومستحقات الطيارين"
      subtitle="معاينة وتسوية المبالغ المحصّلة مع الطيارين وشركات الشحن، ومراجعة وصرف مستحقات الطيارين"
      actions={
        <button
          type="button"
          onClick={handleRefreshAll}
          disabled={settlementsLoading || previewLoading || duesLoading || cashboxesLoading}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] text-sm font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`w-4 h-4 ${
              settlementsLoading || previewLoading || duesLoading ? 'animate-spin' : ''
            }`}
          />
          <span>تحديث</span>
        </button>
      }
    >
      {/* رسالة النجاح / الخطأ العامة */}
      {feedback && (
        <div
          role="status"
          className={`mb-4 flex items-start justify-between gap-3 border-r-4 pr-3 py-2 text-sm ${
            feedback.type === 'error'
              ? 'border-rose-600 text-rose-700 dark:text-rose-300'
              : 'border-emerald-600 text-emerald-800 dark:text-emerald-300'
          }`}
        >
          <div className="flex items-start gap-2 font-semibold">
            {feedback.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="إغلاق الإشعار"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* 1) قسم التسويات                                              */}
      {/* ============================================================ */}
      <SectionHeading title="تسوية المبالغ المحصّلة (الطيارون وشركات الشحن)" />

      {/* اختيار الجهة (طيار / شركة شحن) */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <span className="block text-xs font-semibold text-[var(--text-secondary)]">
            نوع الجهة
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setSettleType('driver');
                setSettleAssigneeId('');
              }}
              className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                settleType === 'driver'
                  ? 'border-sky-700 bg-sky-700 text-white'
                  : 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <Bike className="w-4 h-4" />
              <span>طيار</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSettleType('courier');
                setSettleAssigneeId('');
              }}
              className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                settleType === 'courier'
                  ? 'border-sky-700 bg-sky-700 text-white'
                  : 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <Truck className="w-4 h-4" />
              <span>شركة شحن</span>
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="settle-assignee-select"
            className="block text-xs font-semibold text-[var(--text-secondary)]"
          >
            {settleType === 'driver' ? 'اختر الطيار' : 'اختر شركة الشحن'}
          </label>
          <select
            id="settle-assignee-select"
            value={settleAssigneeId}
            onChange={(e) => setSettleAssigneeId(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} min-h-[44px]`}
          >
            <option value="">
              {settleType === 'driver' ? 'اختر طيارًا لمعاينة التسوية...' : 'اختر شركة شحن لمعاينة التسوية...'}
            </option>
            {settleType === 'driver'
              ? driverOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.phone ? ` — ${d.phone}` : ''}
                  </option>
                ))
              : courierOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
          </select>
        </div>
      </div>

      {/* حالة معاينة التسوية */}
      {!settleAssigneeId ? (
        <p className="text-sm text-[var(--text-secondary)] py-3">
          اختر طيارًا أو شركة شحن لعرض الطلبات التي تم تسليمها وتنتظر التسوية.
        </p>
      ) : previewLoading ? (
        <div className="py-6 flex items-center gap-2.5 text-sm font-semibold text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>جاري تحميل معاينة التسوية من السيرفر...</span>
        </div>
      ) : previewError ? (
        <div
          role="alert"
          className="py-3 flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{previewError}</span>
        </div>
      ) : preview && preview.orders.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] py-3">
          لا توجد طلبات مُسلّمة تنتظر التسوية حاليًا مع «{preview.assigneeName}».
        </p>
      ) : preview ? (
        <div className="space-y-4">
          {/* جدول الطلبات المشمولة في المعاينة */}
          <CompactTable>
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>رقم الفاتورة</th>
                <th>العميل</th>
                <th>طريقة الدفع</th>
                <th>المطلوب تحصيله</th>
                {preview.assigneeType === 'courier' && <th>رسوم شركة الشحن</th>}
                <th>تاريخ التسليم</th>
              </tr>
            </thead>
            <tbody>
              {preview.orders.map((order) => (
                <tr key={order.id}>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`} dir="ltr">
                    {order.number}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`} dir="ltr">
                    {order.invoiceNumber}
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    {order.customerName || 'عميل نقدي'}
                  </td>
                  <td className="whitespace-nowrap">
                    {order.paymentMode === 'cod' ? 'الدفع عند الاستلام' : 'مدفوع مقدمًا'}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-semibold text-[var(--text-primary)]`}>
                    {formatMoney(order.amountDue)}
                  </td>
                  {preview.assigneeType === 'courier' && (
                    <td className={`${COMPACT_TABLE_NUM_CLASS} text-rose-700 dark:text-rose-300`}>
                      {formatMoney(order.courierFee)}
                    </td>
                  )}
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`}>
                    {formatDateTime(order.deliveredAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </CompactTable>

          {/* ملخص قيم السيرفر مباشرة دون أي إعادة حساب في الواجهة */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 py-2 border-y border-[var(--border-subtle)] text-sm">
            <div>
              <span className="text-[var(--text-muted)]">الطلبات المشمولة: </span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {preview.orders.length}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">المطلوب تحصيله من العملاء: </span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {formatMoney(preview.collected)}
              </span>
            </div>
            {preview.assigneeType === 'courier' && (
              <div>
                <span className="text-[var(--text-muted)]">رسوم شركة الشحن: </span>
                <span className="font-bold text-rose-700 dark:text-rose-300 tabular-nums">
                  {formatMoney(preview.courierFees)}
                </span>
              </div>
            )}
            <div>
              <span className="text-[var(--text-muted)]">المتوقع تسليمه (حساب السيرفر): </span>
              <span className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                {formatMoney(preview.expected)}
              </span>
            </div>
          </div>

          {/* تنبيه تعطيل العملية عند عدم توفر خزنة مسموح بها */}
          {settleCashboxBlockReason && (
            <div
              role="alert"
              className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-2 text-sm font-semibold text-rose-700 dark:text-rose-300"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{settleCashboxBlockReason}</span>
            </div>
          )}

          {settleFormError && (
            <div
              role="alert"
              className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{settleFormError}</span>
            </div>
          )}

          {/* نموذج إدخال المبلغ المستلم والخزنة والملاحظة */}
          <form onSubmit={handleOpenSettleConfirm} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="settle-received-input"
                className="block text-xs font-semibold text-[var(--text-secondary)]"
              >
                المبلغ المستلم فعليًا (ج.م)
              </label>
              <input
                id="settle-received-input"
                type="number"
                step="0.01"
                min={preview.assigneeType === 'driver' ? '0' : undefined}
                value={receivedAmountInput}
                onChange={(e) => {
                  setReceivedAmountInput(e.target.value);
                  setSettleFormError(null);
                }}
                disabled={Boolean(settleCashboxBlockReason) || isSubmittingSettle}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} min-h-[44px] tabular-nums`}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="settle-cashbox-select"
                className="block text-xs font-semibold text-[var(--text-secondary)]"
              >
                الخزنة
              </label>
              <select
                id="settle-cashbox-select"
                value={settleCashboxId}
                onChange={(e) => {
                  setSettleCashboxId(e.target.value);
                  setSettleFormError(null);
                }}
                disabled={Boolean(settleCashboxBlockReason) || cashboxesLoading || isSubmittingSettle}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} min-h-[44px]`}
              >
                {allowedSettleCashboxes.length === 0 ? (
                  <option value="">
                    {cashboxesLoading ? 'جاري تحميل الخزائن...' : 'لا توجد خزنة متاحة'}
                  </option>
                ) : (
                  allowedSettleCashboxes.map((cb) => (
                    <option key={cb.id} value={cb.id}>
                      {cb.name} (الرصيد: {formatMoney(cb.currentBalance)})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="settle-note-input"
                className="block text-xs font-semibold text-[var(--text-secondary)]"
              >
                ملاحظة (اختياري)
              </label>
              <input
                id="settle-note-input"
                type="text"
                maxLength={250}
                value={settleNote}
                onChange={(e) => setSettleNote(e.target.value)}
                disabled={Boolean(settleCashboxBlockReason) || isSubmittingSettle}
                placeholder="ملاحظة على التسوية"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px]`}
              />
            </div>

            <button
              type="submit"
              disabled={
                Boolean(settleCashboxBlockReason) ||
                cashboxesLoading ||
                !settleCashboxId ||
                isSubmittingSettle
              }
              className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <Wallet className="w-4 h-4" />
              <span>تسجيل التسوية</span>
            </button>
          </form>

          {preview.assigneeType === 'courier' && preview.expected < 0 && (
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
              ملاحظة: المتوقع تسليمه بالسالب لأن رسوم شركة الشحن أكبر من المحصّل؛ إدخال مبلغ سالب يسجّل صرف رسوم شركة الشحن من الخزنة المختارة.
            </p>
          )}
        </div>
      ) : null}

      {/* ============================================================ */}
      {/* 2) سجل التسويات                                              */}
      {/* ============================================================ */}
      <SectionHeading
        title="سجل التسويات السابقة"
        withTopDivider
        actions={
          <select
            value={historyFilterType}
            onChange={(e) => setHistoryFilterType(e.target.value as 'ALL' | DeliveryAssigneeType)}
            aria-label="تصفية سجل التسويات حسب نوع الجهة"
            className={`${FORM_CONTROL_BASE_CLASS} min-h-[44px] w-auto min-w-[160px]`}
          >
            <option value="ALL">كل الجهات</option>
            <option value="driver">الطيارون فقط</option>
            <option value="courier">شركات الشحن فقط</option>
          </select>
        }
      />

      {settlementsLoading ? (
        <div className="py-6 flex items-center gap-2.5 text-sm font-semibold text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>جاري تحميل سجل التسويات...</span>
        </div>
      ) : settlementsError ? (
        <div
          role="alert"
          className="py-4 flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{settlementsError}</span>
        </div>
      ) : settlements.length === 0 ? (
        <p className="py-4 text-sm text-[var(--text-secondary)]">
          لا توجد تسويات مسجلة حتى الآن.
        </p>
      ) : (
        <CompactTable>
          <thead>
            <tr>
              <th>رقم التسوية</th>
              <th>التاريخ</th>
              <th>الجهة</th>
              <th>الطلبات / الفواتير</th>
              <th>المحصّل</th>
              <th>رسوم الشركة</th>
              <th>المتوقع</th>
              <th>المستلم</th>
              <th>العجز / الزيادة</th>
              <th>الخزنة</th>
              <th>بواسطة / الملاحظة</th>
            </tr>
          </thead>
          <tbody>
            {settlements.map((st) => {
              const diff = formatShortageLabel(st.shortage);
              return (
                <tr key={st.id}>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`} dir="ltr">
                    {st.number}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`}>
                    {formatDateTime(st.at)}
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="font-semibold text-[var(--text-primary)]">{st.assigneeName}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {st.assigneeType === 'driver' ? 'طيار' : 'شركة شحن'}
                    </div>
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    <div className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {st.orderIds.length} طلب
                    </div>
                    {st.invoiceNumbers.length > 0 && (
                      <div className="text-xs text-[var(--text-secondary)]" dir="ltr">
                        {st.invoiceNumbers.join(', ')}
                      </div>
                    )}
                  </td>
                  <td className={COMPACT_TABLE_NUM_CLASS}>{formatMoney(st.collected)}</td>
                  <td className={COMPACT_TABLE_NUM_CLASS}>{formatMoney(st.courierFees)}</td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-semibold text-[var(--text-primary)]`}>
                    {formatMoney(st.expected)}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`}>
                    {formatMoney(st.received)}
                  </td>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} ${diff.className}`}>
                    {diff.text}
                  </td>
                  <td className="whitespace-nowrap text-[var(--text-primary)]">
                    {st.cashboxName || '—'}
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    <div className="text-[var(--text-primary)]">{st.byName || '—'}</div>
                    {st.note && (
                      <div className="text-xs text-[var(--text-muted)]">{st.note}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </CompactTable>
      )}

      {/* ============================================================ */}
      {/* 3) قسم مستحقات الطيارين وصرفها                               */}
      {/* ============================================================ */}
      <SectionHeading title="مستحقات الطيارين وصرفها" withTopDivider />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label
            htmlFor="dues-driver-select"
            className="block text-xs font-semibold text-[var(--text-secondary)]"
          >
            اختر الطيار
          </label>
          <select
            id="dues-driver-select"
            value={selectedDriverId}
            onChange={(e) => setSelectedDriverId(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} min-h-[44px]`}
          >
            <option value="">اختر طيارًا لعرض مستحقاته وسجل الصرف...</option>
            {driverOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.phone ? ` — ${d.phone}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedDriverId ? (
        <p className="text-sm text-[var(--text-secondary)] py-3">
          اختر طيارًا لعرض مرتبه وعمولاته غير المصروفة والعجز القائم والعهدة الحالية وسجل عمليات الصرف.
        </p>
      ) : duesLoading ? (
        <div className="py-6 flex items-center gap-2.5 text-sm font-semibold text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>جاري تحميل مستحقات الطيار من السيرفر...</span>
        </div>
      ) : duesError ? (
        <div
          role="alert"
          className="py-3 flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{duesError}</span>
        </div>
      ) : driverDues ? (
        <div className="space-y-4">
          {/* عرض عناصر المستحقات التي يعيدها السيرفر مباشرة */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 py-2.5 border-y border-[var(--border-subtle)] text-sm">
            <div>
              <span className="text-[var(--text-muted)]">الطيار: </span>
              <span className="font-bold text-[var(--text-primary)]">{driverDues.driverName}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">المرتب الشهري المحدد: </span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {formatMoney(driverDues.monthlySalary)}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">
                العمولات غير المصروفة ({driverDues.unpaidOrderIds.length} طلب):{' '}
              </span>
              <span className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                {formatMoney(driverDues.commissionUnpaid)}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">العجز القائم: </span>
              <span
                className={`font-bold tabular-nums ${
                  driverDues.shortageOutstanding > 0
                    ? 'text-rose-700 dark:text-rose-300'
                    : driverDues.shortageOutstanding < 0
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                {driverDues.shortageOutstanding < 0
                  ? `زيادة للطيار ${formatMoney(Math.abs(driverDues.shortageOutstanding))}`
                  : formatMoney(driverDues.shortageOutstanding)}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">العهدة الحالية غير المسوّاة: </span>
              <span className="font-bold text-amber-700 dark:text-amber-300 tabular-nums">
                {formatMoney(driverDues.custody)}
              </span>
            </div>
          </div>

          {payoutCashboxBlockReason && (
            <div
              role="alert"
              className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-2 text-sm font-semibold text-rose-700 dark:text-rose-300"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{payoutCashboxBlockReason}</span>
            </div>
          )}

          {payoutFormError && (
            <div
              role="alert"
              className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{payoutFormError}</span>
            </div>
          )}

          {/* نموذج صرف مستحقات الطيار */}
          <form onSubmit={handleOpenPayoutConfirm} className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="payout-salary-input"
                  className="block text-xs font-semibold text-[var(--text-secondary)]"
                >
                  المرتب المراد صرفه (ج.م)
                </label>
                <input
                  id="payout-salary-input"
                  type="number"
                  step="0.01"
                  min="0"
                  max={MAX_MONEY}
                  value={payoutSalaryInput}
                  onChange={(e) => {
                    setPayoutSalaryInput(e.target.value);
                    setPayoutFormError(null);
                  }}
                  disabled={Boolean(payoutCashboxBlockReason) || isSubmittingPayout}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} min-h-[44px] tabular-nums`}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="payout-cashbox-select"
                  className="block text-xs font-semibold text-[var(--text-secondary)]"
                >
                  خزنة الصرف
                </label>
                <select
                  id="payout-cashbox-select"
                  value={payoutCashboxId}
                  onChange={(e) => {
                    setPayoutCashboxId(e.target.value);
                    setPayoutFormError(null);
                  }}
                  disabled={Boolean(payoutCashboxBlockReason) || cashboxesLoading || isSubmittingPayout}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} min-h-[44px]`}
                >
                  {activeCashboxes.length === 0 ? (
                    <option value="">
                      {cashboxesLoading ? 'جاري تحميل الخزائن...' : 'لا توجد خزنة متاحة'}
                    </option>
                  ) : (
                    activeCashboxes.map((cb) => (
                      <option key={cb.id} value={cb.id}>
                        {cb.name} (الرصيد: {formatMoney(cb.currentBalance)})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="payout-note-input"
                  className="block text-xs font-semibold text-[var(--text-secondary)]"
                >
                  ملاحظة (اختياري)
                </label>
                <input
                  id="payout-note-input"
                  type="text"
                  maxLength={250}
                  value={payoutNote}
                  onChange={(e) => setPayoutNote(e.target.value)}
                  disabled={Boolean(payoutCashboxBlockReason) || isSubmittingPayout}
                  placeholder="ملاحظة على عملية الصرف"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} min-h-[44px]`}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <label className="inline-flex items-center gap-2.5 min-h-[44px] text-sm font-semibold text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={payoutPayCommission}
                  onChange={(e) => {
                    setPayoutPayCommission(e.target.checked);
                    setPayoutFormError(null);
                  }}
                  disabled={Boolean(payoutCashboxBlockReason) || isSubmittingPayout}
                  className="w-4 h-4 accent-emerald-700"
                />
                <span>
                  صرف العمولات المستحقة ({formatMoney(driverDues.commissionUnpaid)})
                </span>
              </label>

              <label className="inline-flex items-center gap-2.5 min-h-[44px] text-sm font-semibold text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={payoutDeductShortage}
                  onChange={(e) => {
                    setPayoutDeductShortage(e.target.checked);
                    setPayoutFormError(null);
                  }}
                  disabled={
                    Boolean(payoutCashboxBlockReason) ||
                    isSubmittingPayout ||
                    driverDues.shortageOutstanding <= 0
                  }
                  className="w-4 h-4 accent-rose-700"
                />
                <span>
                  خصم العجز القائم ({formatMoney(Math.max(0, driverDues.shortageOutstanding))})
                </span>
              </label>

              <button
                type="submit"
                disabled={
                  Boolean(payoutCashboxBlockReason) ||
                  cashboxesLoading ||
                  !payoutCashboxId ||
                  isSubmittingPayout ||
                  isPreparingPayoutConfirm ||
                  (payoutPreview !== null && !payoutPreview.canPayout)
                }
                className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {isPreparingPayoutConfirm ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Banknote className="w-4 h-4" />
                )}
                <span>{isPreparingPayoutConfirm ? 'جاري تجهيز المعاينة...' : 'معاينة وتأكيد الصرف'}</span>
              </button>
            </div>

            {/* معاينة الصافي المتوقع من السيرفر قبل التأكيد */}
            <div className="py-2.5 border-y border-[var(--border-subtle)] text-sm">
              {payoutPreviewLoading && !payoutPreview ? (
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري حساب معاينة الصرف من السيرفر...</span>
                </div>
              ) : payoutPreviewError ? (
                <div className="flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{payoutPreviewError}</span>
                </div>
              ) : payoutPreview ? (
                <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
                  <div>
                    <span className="text-[var(--text-muted)]">المرتب المدخل: </span>
                    <span className="font-bold text-[var(--text-primary)] tabular-nums">
                      {formatMoney(payoutPreview.salary)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--text-muted)]">العمولة: </span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                      {formatMoney(payoutPreview.commission)}
                      {payoutPreview.orderIds.length > 0 ? ` (${payoutPreview.orderIds.length} طلب)` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--text-muted)]">العجز المخصوم: </span>
                    <span className="font-bold text-rose-700 dark:text-rose-300 tabular-nums">
                      {formatMoney(payoutPreview.shortageDeducted)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--text-muted)]">صافي المبلغ المتوقع (حساب السيرفر): </span>
                    <span className="font-bold text-sky-700 dark:text-sky-300 tabular-nums">
                      {formatMoney(payoutPreview.paid)}
                    </span>
                    {payoutPreviewLoading && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin inline-block mr-1.5 text-[var(--text-muted)]" />
                    )}
                  </div>
                  {payoutPreview.canPayout && payoutPreview.paid === 0 && payoutPreview.shortageDeducted > 0 && (
                    <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                      سيتم استيعاب إجمالي المستحقات في خصم العجز دون صرف نقدي من الخزنة.
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          </form>

          {/* سجل عمليات صرف مستحقات الطيار المختار */}
          <SectionHeading title={`سجل الصرف للطيار «${driverDues.driverName}»`} withTopDivider />

          {driverPayouts.length === 0 ? (
            <p className="py-3 text-sm text-[var(--text-secondary)]">
              لا توجد عمليات صرف مسجلة لهذا الطيار حتى الآن.
            </p>
          ) : (
            <CompactTable>
              <thead>
                <tr>
                  <th>رقم الصرف</th>
                  <th>التاريخ</th>
                  <th>المرتب</th>
                  <th>العمولة</th>
                  <th>العجز المخصوم</th>
                  <th>الصافي المصروف</th>
                  <th>الخزنة</th>
                  <th>بواسطة / الملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {driverPayouts.map((p) => (
                  <tr key={p.id}>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`} dir="ltr">
                      {p.number}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} text-[var(--text-secondary)]`}>
                      {formatDateTime(p.at)}
                    </td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>{formatMoney(p.salary)}</td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} text-emerald-700 dark:text-emerald-300`}>
                      {formatMoney(p.commission)}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} text-rose-700 dark:text-rose-300`}>
                      {formatMoney(p.shortageDeducted)}
                    </td>
                    <td className={`${COMPACT_TABLE_NUM_CLASS} font-bold text-[var(--text-primary)]`}>
                      {formatMoney(p.paid)}
                    </td>
                    <td className="whitespace-nowrap text-[var(--text-primary)]">
                      {p.cashboxName || '—'}
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>
                      <div className="text-[var(--text-primary)]">{p.byName || '—'}</div>
                      {p.note && (
                        <div className="text-xs text-[var(--text-muted)]">{p.note}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </CompactTable>
          )}
        </div>
      ) : null}

      {/* ============================================================ */}
      {/* نافذة تأكيد التسوية قبل POST /api/delivery/settle            */}
      {/* ============================================================ */}
      {settleConfirmOpen && preview && (
        <ModalShell
          onClose={() => {
            if (!isSubmittingSettle) {
              setSettleConfirmOpen(false);
              setSettleDiffPrompt(null);
            }
          }}
          closeDisabled={isSubmittingSettle}
          title={settleDiffPrompt ? 'تأكيد التسوية مع وجود فرق' : 'تأكيد تسجيل التسوية'}
          subtitle={`${preview.assigneeType === 'driver' ? 'طيار' : 'شركة شحن'}: ${preview.assigneeName}`}
          className="w-full max-w-lg"
          footer={
            <>
              <button
                type="button"
                disabled={isSubmittingSettle}
                onClick={() => {
                  setSettleConfirmOpen(false);
                  setSettleDiffPrompt(null);
                }}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
              >
                إلغاء
              </button>

              {settleDiffPrompt ? (
                <button
                  type="button"
                  disabled={isSubmittingSettle}
                  onClick={() => handleSubmitSettle(true)}
                  className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {isSubmittingSettle && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>تأكيد التسوية بالفرق</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isSubmittingSettle}
                  onClick={() => handleSubmitSettle(false)}
                  className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {isSubmittingSettle && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>تأكيد وتسجيل التسوية</span>
                </button>
              )}
            </>
          }
        >
          <div className="space-y-3 text-sm">
            {settleConfirmError && (
              <div
                role="alert"
                className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-1.5 font-semibold text-rose-700 dark:text-rose-300"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{settleConfirmError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <div>
                <span className="text-[var(--text-muted)]">الجهة: </span>
                <span className="font-bold text-[var(--text-primary)]">
                  {preview.assigneeName} ({preview.assigneeType === 'driver' ? 'طيار' : 'شركة شحن'})
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">عدد الطلبات المشمولة: </span>
                <span className="font-bold text-[var(--text-primary)] tabular-nums">
                  {preview.orders.length} طلب
                </span>
                <span className="text-xs text-[var(--text-secondary)] mr-2" dir="ltr">
                  ({preview.orders.map((o) => o.number).join(', ')})
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">المطلوب تحصيله من العملاء: </span>
                <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                  {formatMoney(preview.collected)}
                </span>
              </div>
              {preview.assigneeType === 'courier' && (
                <div>
                  <span className="text-[var(--text-muted)]">رسوم شركة الشحن: </span>
                  <span className="font-semibold text-rose-700 dark:text-rose-300 tabular-nums">
                    {formatMoney(preview.courierFees)}
                  </span>
                </div>
              )}
              <div>
                <span className="text-[var(--text-muted)]">المتوقع تسليمه (من السيرفر): </span>
                <span className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {formatMoney(settleDiffPrompt?.expected ?? preview.expected)}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">المبلغ المستلم فعليًا: </span>
                <span className="font-bold text-[var(--text-primary)] tabular-nums">
                  {formatMoney(settleDiffPrompt?.received ?? parsedReceivedAmount)}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">الخزنة المختارة: </span>
                <span className="font-bold text-[var(--text-primary)]">
                  {selectedSettleCashbox?.name || '—'}
                </span>
              </div>
              {settleNote.trim() && (
                <div>
                  <span className="text-[var(--text-muted)]">الملاحظة: </span>
                  <span className="text-[var(--text-primary)]">{settleNote.trim()}</span>
                </div>
              )}
            </div>

            {/* رسالة السيرفر الصريحة عند وجود عجز أو زيادة */}
            {settleDiffPrompt && (
              <div
                role="alert"
                className="space-y-1.5 border-r-4 border-amber-600 pr-3 py-2 text-amber-800 dark:text-amber-200"
              >
                <div className="flex items-start gap-2 font-bold">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{settleDiffPrompt.message || settleDiffPrompt.error}</span>
                </div>
                {typeof settleDiffPrompt.shortage === 'number' && (
                  <div className="text-xs font-bold tabular-nums">
                    قيمة الفرق المحسوبة من السيرفر:{' '}
                    {formatShortageLabel(settleDiffPrompt.shortage).text}
                  </div>
                )}
              </div>
            )}
          </div>
        </ModalShell>
      )}

      {/* ============================================================ */}
      {/* نافذة تأكيد صرف مستحقات الطيار قبل POST /api/delivery/payouts */}
      {/* ============================================================ */}
      {payoutConfirmOpen && driverDues && payoutPreview && (
        <ModalShell
          onClose={() => {
            if (!isSubmittingPayout) {
              setPayoutConfirmOpen(false);
              setPayoutPreviewChangedNotice(null);
            }
          }}
          closeDisabled={isSubmittingPayout}
          title={
            payoutPreviewChangedNotice
              ? 'تحديث معاينة الصرف — مطلوب تأكيد جديد'
              : 'تأكيد صرف مستحقات الطيار'
          }
          subtitle={`الطيار: ${payoutPreview.driverName}`}
          className="w-full max-w-lg"
          footer={
            <>
              <button
                type="button"
                disabled={isSubmittingPayout}
                onClick={() => {
                  setPayoutConfirmOpen(false);
                  setPayoutPreviewChangedNotice(null);
                }}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-[var(--border-strong)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSubmittingPayout || !payoutPreview.canPayout}
                onClick={handleSubmitPayout}
                className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {isSubmittingPayout && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {payoutPreviewChangedNotice ? 'تأكيد الصرف بالمعاينة المحدثة' : 'تأكيد الصرف'}
                </span>
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            {payoutPreviewChangedNotice && (
              <div
                role="alert"
                className="space-y-1 border-r-4 border-amber-600 pr-3 py-2 text-amber-800 dark:text-amber-200"
              >
                <div className="flex items-start gap-2 font-bold">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{payoutPreviewChangedNotice.message}</span>
                </div>
                <div className="text-xs font-semibold tabular-nums">
                  الصافي في المعاينة السابقة: {formatMoney(payoutPreviewChangedNotice.previousPaid)} ← الصافي المحدث الآن: {formatMoney(payoutPreview.paid)}
                </div>
                {!payoutPreview.canPayout && (
                  <div className="text-xs font-bold text-rose-700 dark:text-rose-300">
                    لا توجد مستحقات متبقية للصرف وفق المعاينة المحدثة.
                  </div>
                )}
              </div>
            )}

            {payoutConfirmError && (
              <div
                role="alert"
                className="flex items-start gap-2 border-r-4 border-rose-600 pr-3 py-1.5 font-semibold text-rose-700 dark:text-rose-300"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{payoutConfirmError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <div>
                <span className="text-[var(--text-muted)]">الطيار: </span>
                <span className="font-bold text-[var(--text-primary)]">{payoutPreview.driverName}</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">المرتب المدخل: </span>
                <span className="font-bold text-[var(--text-primary)] tabular-nums">
                  {formatMoney(payoutPreview.salary)}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">العمولة المشمولة: </span>
                <span className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {payoutPreview.payCommission
                    ? `${formatMoney(payoutPreview.commission)}${payoutPreview.orderIds.length > 0 ? ` (${payoutPreview.orderIds.length} طلب)` : ''}`
                    : `${formatMoney(0)} (لن تُصرف في هذه العملية)`}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">العجز المخصوم: </span>
                <span className="font-bold text-rose-700 dark:text-rose-300 tabular-nums">
                  {formatMoney(payoutPreview.shortageDeducted)}
                  {payoutPreview.shortageOutstanding > payoutPreview.shortageDeducted &&
                    payoutPreview.deductShortage && (
                      <span className="text-xs font-normal text-[var(--text-secondary)] mr-1.5">
                        (من أصل {formatMoney(payoutPreview.shortageOutstanding)} عجز قائم)
                      </span>
                    )}
                </span>
              </div>
              <div className="pt-1.5 border-t border-[var(--border-subtle)]">
                <span className="text-[var(--text-muted)]">صافي المبلغ المتوقع صرفه: </span>
                <span className="font-bold text-base text-sky-700 dark:text-sky-300 tabular-nums">
                  {formatMoney(payoutPreview.paid)}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">خزنة الصرف: </span>
                <span className="font-bold text-[var(--text-primary)]">
                  {selectedPayoutCashbox?.name || '—'}
                </span>
              </div>
              {payoutNote.trim() && (
                <div>
                  <span className="text-[var(--text-muted)]">الملاحظة: </span>
                  <span className="text-[var(--text-primary)]">{payoutNote.trim()}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-[var(--text-secondary)] border-r-4 border-sky-600 pr-3 py-1.5">
              {payoutPreview.paid === 0 && payoutPreview.canPayout
                ? 'صافي الصرف النقدي 0.00 ج.م لأن إجمالي المستحقات يُغطّي العجز المخصوم؛ لن تُسجَّل حركة سحب نقدي من الخزنة.'
                : 'عند التأكيد يعيد السيرفر التحقق من المستحقات والصافي؛ وإذا حدث أي تغيير منذ المعاينة لن يُنفَّذ الصرف وسيُطلب تأكيدك على المعاينة المحدثة.'}
            </p>
          </div>
        </ModalShell>
      )}
    </PageSurface>
  );
};

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  Plus,
  Edit3,
  Power,
  Save,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  X,
  Loader2,
  MapPin,
  Bike,
  Truck,
  Printer
} from 'lucide-react';
import { api } from '../api/client';
import {
  UserAccount,
  DeliveryMode,
  DeliverySettings,
  DeliveryPrepSlipSettings,
  DeliveryZone,
  DeliveryDriver,
  DeliveryCourier,
  DeliveryDriverUserOption
} from '../types';
import { hasPermission } from '../utils/permissions';
import {
  DeliveryPrepSlipData,
  DeliveryPrepSlipPrintArea,
  DEFAULT_DELIVERY_PREP_SLIP_SETTINGS,
  normalizeDeliveryPrepSlipSettings
} from '../components/DeliveryPrepSlipPrintArea';
import { printDeliveryPrepSlip } from '../utils/printDeliveryPrepSlip';
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

interface DeliverySettingsPageProps {
  user: UserAccount;
}

const MAX_MONEY = 10_000_000;
const MIN_LATE_HOURS = 1;
const MAX_LATE_HOURS = 720;

const MODE_OPTIONS: Array<{ value: DeliveryMode; label: string; hint: string }> = [
  { value: 'drivers', label: 'طيارون فقط', hint: 'التوزيع والتسوية على طياري المحل فقط' },
  { value: 'couriers', label: 'شركات شحن فقط', hint: 'التوزيع والتسوية عبر شركات الشحن فقط' },
  { value: 'both', label: 'الاثنان معًا', hint: 'إتاحة الطيارين وشركات الشحن في نفس الوقت' }
];

function formatMoney(value: number): string {
  const num = Number(value) || 0;
  return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
}

function formatUpdatedAt(iso: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
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

function parseNonNegativeMoney(
  raw: string,
  fieldLabel: string
): { ok: boolean; value: number; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: 0 };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) {
    return {
      ok: false,
      value: 0,
      error: `${fieldLabel}: يجب إدخال رقم صالح من 0 إلى ${MAX_MONEY.toLocaleString('en-US')}`
    };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

const DUMMY_PREP_SLIP_BASE_DATA: Omit<DeliveryPrepSlipData, 'invoiceNumber'> = {
  prepNumber: 'DLV-000125',
  customerName: 'أحمد محمد عبد الرحمن',
  customerPhone: '01012345678',
  items: [
    { id: 'demo-prep-1', name: 'وجبة عائلية مشكلة كبير', quantity: 2 },
    { id: 'demo-prep-2', name: 'ساندوتش كرسبي دجاج حار', quantity: 3 },
    { id: 'demo-prep-3', name: 'بطاطس محمرة حجم عائلي', quantity: 1 }
  ]
};

const PREP_SLIP_FIELD_TOGGLES: Array<{
  key: keyof Omit<DeliveryPrepSlipSettings, 'enabled'>;
  label: string;
  hint: string;
}> = [
  {
    key: 'showPrepNumber',
    label: 'رقم طلب التحضير',
    hint: 'إظهار الرقم المرجعي لطلب التحضير أعلى الورقة'
  },
  {
    key: 'showInvoiceNumber',
    label: 'رقم الفاتورة (إن صدرت)',
    hint: 'يظهر فقط إذا كانت الفاتورة قد صدرت فعلًا؛ ويُخفى تلقائيًا قبل إصدارها'
  },
  {
    key: 'showCustomerName',
    label: 'اسم العميل',
    hint: 'إظهار اسم العميل صاحب الطلب'
  },
  {
    key: 'showCustomerPhone',
    label: 'هاتف العميل',
    hint: 'إظهار رقم هاتف العميل للتواصل عند التجهيز'
  },
  {
    key: 'showItemNames',
    label: 'أسماء الأصناف',
    hint: 'إظهار عمود اسم الصنف في جدول التجهيز'
  },
  {
    key: 'showItemQuantities',
    label: 'كميات الأصناف',
    hint: 'إظهار عمود الكمية المطلوبة لكل صنف'
  }
];

interface SettingsFormState {
  enabled: boolean;
  mode: DeliveryMode;
  zonePricing: boolean;
  fixedFee: string;
  maxDriverCustody: string;
  lateAfterHours: string;
  prepSlip: DeliveryPrepSlipSettings;
}

function settingsToForm(s: DeliverySettings): SettingsFormState {
  return {
    enabled: Boolean(s.enabled),
    mode: s.mode || 'drivers',
    zonePricing: Boolean(s.zonePricing),
    fixedFee: String(s.fixedFee ?? 0),
    maxDriverCustody: String(s.maxDriverCustody ?? 0),
    lateAfterHours: String(s.lateAfterHours ?? 3),
    prepSlip: normalizeDeliveryPrepSlipSettings(s.prepSlip)
  };
}

export const DeliverySettingsPage: React.FC<DeliverySettingsPageProps> = ({ user }) => {
  const canAccess =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'delivery.settings');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [settings, setSettings] = useState<DeliverySettings | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>({
    enabled: false,
    mode: 'drivers',
    zonePricing: false,
    fixedFee: '0',
    maxDriverCustody: '0',
    lateAfterHours: '3',
    prepSlip: { ...DEFAULT_DELIVERY_PREP_SLIP_SETTINGS }
  });
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [previewInvoiceIssued, setPreviewInvoiceIssued] = useState<boolean>(false);
  const [previewPaperSize, setPreviewPaperSize] = useState<'80mm' | '58mm' | 'a4'>('80mm');
  const [isPrintingPreview, setIsPrintingPreview] = useState<boolean>(false);

  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [drivers, setDrivers] = useState<DeliveryDriver[]>([]);
  const [couriers, setCouriers] = useState<DeliveryCourier[]>([]);
  const [users, setUsers] = useState<DeliveryDriverUserOption[]>([]);

  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  // Zone modal state
  const [isZoneModalOpen, setIsZoneModalOpen] = useState<boolean>(false);
  const [editingZone, setEditingZone] = useState<DeliveryZone | null>(null);
  const [zoneName, setZoneName] = useState<string>('');
  const [zoneCustomerFee, setZoneCustomerFee] = useState<string>('0');
  const [zoneDriverCommission, setZoneDriverCommission] = useState<string>('0');
  const [zoneMinOrderValue, setZoneMinOrderValue] = useState<string>('0');
  const [zoneActive, setZoneActive] = useState<boolean>(true);
  const [zoneFormError, setZoneFormError] = useState<string | null>(null);
  const [isSavingZone, setIsSavingZone] = useState<boolean>(false);

  // Driver modal state
  const [isDriverModalOpen, setIsDriverModalOpen] = useState<boolean>(false);
  const [editingDriver, setEditingDriver] = useState<DeliveryDriver | null>(null);
  const [driverName, setDriverName] = useState<string>('');
  const [driverPhone, setDriverPhone] = useState<string>('');
  const [driverMonthlySalary, setDriverMonthlySalary] = useState<string>('0');
  const [driverCommissionPerOrder, setDriverCommissionPerOrder] = useState<string>('0');
  const [driverUserId, setDriverUserId] = useState<string>('');
  const [driverActive, setDriverActive] = useState<boolean>(true);
  const [driverFormError, setDriverFormError] = useState<string | null>(null);
  const [isSavingDriver, setIsSavingDriver] = useState<boolean>(false);

  // Courier modal state
  const [isCourierModalOpen, setIsCourierModalOpen] = useState<boolean>(false);
  const [editingCourier, setEditingCourier] = useState<DeliveryCourier | null>(null);
  const [courierName, setCourierName] = useState<string>('');
  const [courierFeePerOrder, setCourierFeePerOrder] = useState<string>('0');
  const [courierActive, setCourierActive] = useState<boolean>(true);
  const [courierFormError, setCourierFormError] = useState<string | null>(null);
  const [isSavingCourier, setIsSavingCourier] = useState<boolean>(false);

  const loadDeliverySettings = useCallback(async () => {
    if (!canAccess) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await api.getDeliverySettings();
      if (!res.success || !res.settings) {
        setLoadError(res.error || 'تعذر تحميل إعدادات التوصيل');
        return;
      }
      setSettings(res.settings);
      setSettingsForm(settingsToForm(res.settings));
      setZones(Array.isArray(res.zones) ? res.zones : []);
      setDrivers(Array.isArray(res.drivers) ? res.drivers : []);
      setCouriers(Array.isArray(res.couriers) ? res.couriers : []);
      setUsers(Array.isArray(res.users) ? res.users : []);
    } catch (err: any) {
      setLoadError(err?.message || 'تعذر الاتصال بالخادم لتحميل إعدادات التوصيل');
    } finally {
      setIsLoading(false);
    }
  }, [canAccess]);

  useEffect(() => {
    void loadDeliverySettings();
  }, [loadDeliverySettings]);

  const isSettingsDirty = useMemo(() => {
    if (!settings) return false;
    const base = settingsToForm(settings);
    return (
      settingsForm.enabled !== base.enabled ||
      settingsForm.mode !== base.mode ||
      settingsForm.zonePricing !== base.zonePricing ||
      settingsForm.fixedFee !== base.fixedFee ||
      settingsForm.maxDriverCustody !== base.maxDriverCustody ||
      settingsForm.lateAfterHours !== base.lateAfterHours ||
      settingsForm.prepSlip.enabled !== base.prepSlip.enabled ||
      settingsForm.prepSlip.showPrepNumber !== base.prepSlip.showPrepNumber ||
      settingsForm.prepSlip.showInvoiceNumber !== base.prepSlip.showInvoiceNumber ||
      settingsForm.prepSlip.showCustomerName !== base.prepSlip.showCustomerName ||
      settingsForm.prepSlip.showCustomerPhone !== base.prepSlip.showCustomerPhone ||
      settingsForm.prepSlip.showItemNames !== base.prepSlip.showItemNames ||
      settingsForm.prepSlip.showItemQuantities !== base.prepSlip.showItemQuantities
    );
  }, [settings, settingsForm]);

  const dummyPrepSlipData = useMemo<DeliveryPrepSlipData>(() => {
    return {
      ...DUMMY_PREP_SLIP_BASE_DATA,
      invoiceNumber: previewInvoiceIssued ? 'INV-004892' : ''
    };
  }, [previewInvoiceIssued]);

  const handlePrintPrepSlipPreview = async () => {
    if (!settingsForm.prepSlip.enabled || isPrintingPreview) return;
    setIsPrintingPreview(true);
    try {
      await printDeliveryPrepSlip(dummyPrepSlipData, {
        settings: settingsForm.prepSlip,
        paperSize: previewPaperSize,
        onAfterPrint: () => setIsPrintingPreview(false)
      });
    } catch (_) {
      setIsPrintingPreview(false);
    }
  };

  const usersById = useMemo(() => {
    const map = new Map<string, DeliveryDriverUserOption>();
    for (const u of users) {
      map.set(u.id, u);
    }
    return map;
  }, [users]);

  const sortedUsersForSelect = useMemo(() => {
    return [...users].sort((a, b) => {
      if (a.isDriver !== b.isDriver) return a.isDriver ? -1 : 1;
      return (a.name || a.username).localeCompare(b.name || b.username, 'ar');
    });
  }, [users]);

  const handleResetSettingsForm = () => {
    if (!settings) return;
    setSettingsForm(settingsToForm(settings));
    setSettingsError(null);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsError(null);
    setFeedback(null);

    const parsedFixed = parseNonNegativeMoney(settingsForm.fixedFee, 'الرسوم الثابتة');
    if (!parsedFixed.ok) {
      setSettingsError(parsedFixed.error);
      return;
    }
    const parsedCustody = parseNonNegativeMoney(settingsForm.maxDriverCustody, 'الحد الأقصى لعهدة الطيار');
    if (!parsedCustody.ok) {
      setSettingsError(parsedCustody.error);
      return;
    }

    const rawLate = settingsForm.lateAfterHours.trim();
    const parsedLate = Number(rawLate);
    if (!rawLate || !Number.isInteger(parsedLate) || parsedLate < MIN_LATE_HOURS || parsedLate > MAX_LATE_HOURS) {
      setSettingsError(`مدة اعتبار الطلب متأخرًا: يجب إدخال عدد ساعات صحيح من ${MIN_LATE_HOURS} إلى ${MAX_LATE_HOURS}`);
      return;
    }

    setIsSavingSettings(true);
    try {
      const res = await api.saveDeliverySettings({
        enabled: settingsForm.enabled,
        mode: settingsForm.mode,
        zonePricing: settingsForm.zonePricing,
        fixedFee: parsedFixed.value,
        maxDriverCustody: parsedCustody.value,
        lateAfterHours: parsedLate,
        prepSlip: settingsForm.prepSlip
      });
      if (!res.success || !res.settings) {
        setSettingsError(res.error || 'تعذر حفظ إعدادات التوصيل');
        return;
      }
      setSettings(res.settings);
      setSettingsForm(settingsToForm(res.settings));
      if (Array.isArray(res.zones)) setZones(res.zones);
      if (Array.isArray(res.drivers)) setDrivers(res.drivers);
      if (Array.isArray(res.couriers)) setCouriers(res.couriers);
      setFeedback({ type: 'success', message: 'تم حفظ إعدادات التوصيل بنجاح' });
    } catch (err: any) {
      setSettingsError(err?.message || 'تعذر حفظ إعدادات التوصيل');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ==================== المناطق ====================
  const openCreateZoneModal = () => {
    setEditingZone(null);
    setZoneName('');
    setZoneCustomerFee('0');
    setZoneDriverCommission('0');
    setZoneMinOrderValue('0');
    setZoneActive(true);
    setZoneFormError(null);
    setIsZoneModalOpen(true);
  };

  const openEditZoneModal = (zone: DeliveryZone) => {
    setEditingZone(zone);
    setZoneName(zone.name || '');
    setZoneCustomerFee(String(zone.customerFee ?? 0));
    setZoneDriverCommission(String(zone.driverCommission ?? 0));
    setZoneMinOrderValue(String(zone.minOrderValue ?? 0));
    setZoneActive(Boolean(zone.active));
    setZoneFormError(null);
    setIsZoneModalOpen(true);
  };

  const handleSaveZone = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setZoneFormError(null);

    const trimmedName = zoneName.trim();
    if (!trimmedName) {
      setZoneFormError('يرجى إدخال اسم المنطقة');
      return;
    }
    const fee = parseNonNegativeMoney(zoneCustomerFee, 'رسوم العميل');
    if (!fee.ok) {
      setZoneFormError(fee.error);
      return;
    }
    const commission = parseNonNegativeMoney(zoneDriverCommission, 'عمولة الطيار');
    if (!commission.ok) {
      setZoneFormError(commission.error);
      return;
    }
    const minOrder = parseNonNegativeMoney(zoneMinOrderValue, 'أقل قيمة طلب');
    if (!minOrder.ok) {
      setZoneFormError(minOrder.error);
      return;
    }

    setIsSavingZone(true);
    try {
      const res = await api.saveDeliveryZone({
        id: editingZone?.id,
        name: trimmedName,
        customerFee: fee.value,
        driverCommission: commission.value,
        minOrderValue: minOrder.value,
        active: zoneActive
      });
      if (!res.success) {
        setZoneFormError(res.error || 'تعذر حفظ بيانات المنطقة');
        return;
      }
      if (Array.isArray(res.zones)) setZones(res.zones);
      if (res.settings) {
        setSettings(res.settings);
      }
      setIsZoneModalOpen(false);
      setFeedback({
        type: 'success',
        message: editingZone
          ? `تم تحديث المنطقة «${trimmedName}» بنجاح`
          : `تمت إضافة المنطقة «${trimmedName}» بنجاح`
      });
    } catch (err: any) {
      setZoneFormError(err?.message || 'تعذر حفظ بيانات المنطقة');
    } finally {
      setIsSavingZone(false);
    }
  };

  const handleToggleZoneActive = async (zone: DeliveryZone) => {
    const key = `zone:${zone.id}`;
    if (togglingKey) return;
    setTogglingKey(key);
    setFeedback(null);
    const nextActive = !zone.active;
    try {
      const res = await api.saveDeliveryZone({
        id: zone.id,
        name: zone.name,
        customerFee: zone.customerFee,
        driverCommission: zone.driverCommission,
        minOrderValue: zone.minOrderValue,
        active: nextActive
      });
      if (!res.success) {
        setFeedback({ type: 'error', message: res.error || 'تعذر تغيير حالة المنطقة' });
        return;
      }
      if (Array.isArray(res.zones)) setZones(res.zones);
      setFeedback({
        type: 'success',
        message: nextActive
          ? `تم تفعيل المنطقة «${zone.name}» بنجاح`
          : `تم إيقاف المنطقة «${zone.name}» بنجاح`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تغيير حالة المنطقة' });
    } finally {
      setTogglingKey(null);
    }
  };

  // ==================== الطيارون ====================
  const openCreateDriverModal = () => {
    setEditingDriver(null);
    setDriverName('');
    setDriverPhone('');
    setDriverMonthlySalary('0');
    setDriverCommissionPerOrder('0');
    setDriverUserId('');
    setDriverActive(true);
    setDriverFormError(null);
    setIsDriverModalOpen(true);
  };

  const openEditDriverModal = (driver: DeliveryDriver) => {
    setEditingDriver(driver);
    setDriverName(driver.name || '');
    setDriverPhone(driver.phone || '');
    setDriverMonthlySalary(String(driver.monthlySalary ?? 0));
    setDriverCommissionPerOrder(String(driver.commissionPerOrder ?? 0));
    setDriverUserId(driver.userId || '');
    setDriverActive(Boolean(driver.active));
    setDriverFormError(null);
    setIsDriverModalOpen(true);
  };

  const handleSaveDriver = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setDriverFormError(null);

    const trimmedName = driverName.trim();
    if (!trimmedName) {
      setDriverFormError('يرجى إدخال اسم الطيار');
      return;
    }
    const salary = parseNonNegativeMoney(driverMonthlySalary, 'المرتب الشهري');
    if (!salary.ok) {
      setDriverFormError(salary.error);
      return;
    }
    const commission = parseNonNegativeMoney(driverCommissionPerOrder, 'العمولة لكل طلب');
    if (!commission.ok) {
      setDriverFormError(commission.error);
      return;
    }

    setIsSavingDriver(true);
    try {
      const res = await api.saveDeliveryDriver({
        id: editingDriver?.id,
        name: trimmedName,
        phone: driverPhone.trim(),
        monthlySalary: salary.value,
        commissionPerOrder: commission.value,
        userId: driverUserId.trim(),
        active: driverActive
      });
      if (!res.success) {
        setDriverFormError(res.error || 'تعذر حفظ بيانات الطيار');
        return;
      }
      if (Array.isArray(res.drivers)) setDrivers(res.drivers);
      setIsDriverModalOpen(false);
      setFeedback({
        type: 'success',
        message: editingDriver
          ? `تم تحديث بيانات الطيار «${trimmedName}» بنجاح`
          : `تمت إضافة الطيار «${trimmedName}» بنجاح`
      });
    } catch (err: any) {
      setDriverFormError(err?.message || 'تعذر حفظ بيانات الطيار');
    } finally {
      setIsSavingDriver(false);
    }
  };

  const handleToggleDriverActive = async (driver: DeliveryDriver) => {
    const key = `driver:${driver.id}`;
    if (togglingKey) return;
    setTogglingKey(key);
    setFeedback(null);
    const nextActive = !driver.active;
    try {
      const res = await api.saveDeliveryDriver({
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        monthlySalary: driver.monthlySalary,
        commissionPerOrder: driver.commissionPerOrder,
        userId: driver.userId,
        active: nextActive
      });
      if (!res.success) {
        setFeedback({ type: 'error', message: res.error || 'تعذر تغيير حالة الطيار' });
        return;
      }
      if (Array.isArray(res.drivers)) setDrivers(res.drivers);
      setFeedback({
        type: 'success',
        message: nextActive
          ? `تم تفعيل الطيار «${driver.name}» بنجاح`
          : `تم إيقاف الطيار «${driver.name}» بنجاح`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تغيير حالة الطيار' });
    } finally {
      setTogglingKey(null);
    }
  };

  // ==================== شركات الشحن ====================
  const openCreateCourierModal = () => {
    setEditingCourier(null);
    setCourierName('');
    setCourierFeePerOrder('0');
    setCourierActive(true);
    setCourierFormError(null);
    setIsCourierModalOpen(true);
  };

  const openEditCourierModal = (courier: DeliveryCourier) => {
    setEditingCourier(courier);
    setCourierName(courier.name || '');
    setCourierFeePerOrder(String(courier.feePerOrder ?? 0));
    setCourierActive(Boolean(courier.active));
    setCourierFormError(null);
    setIsCourierModalOpen(true);
  };

  const handleSaveCourier = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setCourierFormError(null);

    const trimmedName = courierName.trim();
    if (!trimmedName) {
      setCourierFormError('يرجى إدخال اسم شركة الشحن');
      return;
    }
    const fee = parseNonNegativeMoney(courierFeePerOrder, 'رسوم الشركة لكل طلب');
    if (!fee.ok) {
      setCourierFormError(fee.error);
      return;
    }

    setIsSavingCourier(true);
    try {
      const res = await api.saveDeliveryCourier({
        id: editingCourier?.id,
        name: trimmedName,
        feePerOrder: fee.value,
        active: courierActive
      });
      if (!res.success) {
        setCourierFormError(res.error || 'تعذر حفظ بيانات شركة الشحن');
        return;
      }
      if (Array.isArray(res.couriers)) setCouriers(res.couriers);
      setIsCourierModalOpen(false);
      setFeedback({
        type: 'success',
        message: editingCourier
          ? `تم تحديث شركة الشحن «${trimmedName}» بنجاح`
          : `تمت إضافة شركة الشحن «${trimmedName}» بنجاح`
      });
    } catch (err: any) {
      setCourierFormError(err?.message || 'تعذر حفظ بيانات شركة الشحن');
    } finally {
      setIsSavingCourier(false);
    }
  };

  const handleToggleCourierActive = async (courier: DeliveryCourier) => {
    const key = `courier:${courier.id}`;
    if (togglingKey) return;
    setTogglingKey(key);
    setFeedback(null);
    const nextActive = !courier.active;
    try {
      const res = await api.saveDeliveryCourier({
        id: courier.id,
        name: courier.name,
        feePerOrder: courier.feePerOrder,
        active: nextActive
      });
      if (!res.success) {
        setFeedback({ type: 'error', message: res.error || 'تعذر تغيير حالة شركة الشحن' });
        return;
      }
      if (Array.isArray(res.couriers)) setCouriers(res.couriers);
      setFeedback({
        type: 'success',
        message: nextActive
          ? `تم تفعيل شركة الشحن «${courier.name}» بنجاح`
          : `تم إيقاف شركة الشحن «${courier.name}» بنجاح`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'تعذر تغيير حالة شركة الشحن' });
    } finally {
      setTogglingKey(null);
    }
  };

  if (!canAccess) {
    return (
      <PageSurface dir="rtl" title="إعدادات التوصيل">
        <div className="py-8 text-center ui-stock-out font-bold text-sm">
          غير مصرح لك بعرض أو تعديل إعدادات التوصيل
        </div>
      </PageSurface>
    );
  }

  return (
    <PageSurface
      dir="rtl"
      title="إعدادات التوصيل"
      subtitle="تشغيل نظام التوصيل، ضبط طريقة التسعير والحدود، وإدارة المناطق والطيارين وشركات الشحن"
      actions={
        <button
          type="button"
          onClick={() => void loadDeliverySettings()}
          disabled={isLoading}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>تحديث</span>
        </button>
      }
    >
      {/* تنبيه النجاح / الخطأ العام */}
      {feedback && (
        <div
          role="status"
          className={`no-print px-4 py-2.5 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'border-[var(--stock-in-fg)] ui-stock-in'
              : 'border-[var(--stock-out-fg)] ui-stock-out'
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
            aria-label="إغلاق التنبيه"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-[var(--text-secondary)] space-y-2">
          <Loader2 className="w-7 h-7 mx-auto animate-spin text-[var(--accent)]" />
          <p className="text-xs font-bold">جاري تحميل إعدادات التوصيل...</p>
        </div>
      ) : loadError ? (
        <div className="no-print py-8 text-center space-y-3">
          <AlertTriangle className="w-7 h-7 ui-stock-out mx-auto" />
          <p className="text-xs font-bold ui-stock-out">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadDeliverySettings()}
            className="min-h-[44px] px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold cursor-pointer"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <>
          {/* ===================== أ) إعدادات التوصيل ===================== */}
          <SectionHeading title="إعدادات التوصيل" />

          <form onSubmit={handleSaveSettings} className="space-y-5">
            {settingsError && (
              <div
                role="alert"
                className="px-4 py-2.5 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{settingsError}</span>
              </div>
            )}

            {/* تشغيل أو إيقاف التوصيل */}
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                role="switch"
                aria-checked={settingsForm.enabled}
                onClick={() =>
                  setSettingsForm((prev) => ({ ...prev, enabled: !prev.enabled }))
                }
                className="min-h-[44px] inline-flex items-center gap-3 cursor-pointer text-right"
              >
                <span
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    settingsForm.enabled ? 'bg-emerald-600' : 'bg-slate-400'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      settingsForm.enabled ? '-translate-x-5' : '-translate-x-0.5'
                    }`}
                  />
                </span>
                <span className="text-sm font-bold text-[var(--text-primary)]">
                  نظام التوصيل:{' '}
                  <span className={settingsForm.enabled ? 'ui-stock-in' : 'ui-stock-out'}>
                    {settingsForm.enabled ? 'مفعّل' : 'موقوف'}
                  </span>
                </span>
              </button>
              <span className="text-xs text-[var(--text-secondary)]">
                عند الإيقاف لا يظهر خيار التوصيل في شاشة البيع وتُرفض الفواتير المرتبطة بالتوصيل.
              </span>
            </div>

            {/* طريقة التوصيل */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-[var(--text-primary)]">طريقة التوصيل</div>
              <div className="flex flex-wrap items-stretch gap-2" role="radiogroup" aria-label="طريقة التوصيل">
                {MODE_OPTIONS.map((opt) => {
                  const selected = settingsForm.mode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setSettingsForm((prev) => ({ ...prev, mode: opt.value }))}
                      className={`min-h-[44px] px-4 py-2 rounded-lg border text-right transition cursor-pointer ${
                        selected
                          ? 'border-[var(--primary)] text-[var(--primary-on-white,var(--primary))] font-bold'
                          : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                      }`}
                    >
                      <div className="text-xs font-bold">{opt.label}</div>
                      <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{opt.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* تفعيل التسعير حسب المنطقة أو الرسوم الثابتة */}
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                role="switch"
                aria-checked={settingsForm.zonePricing}
                onClick={() =>
                  setSettingsForm((prev) => ({ ...prev, zonePricing: !prev.zonePricing }))
                }
                className="min-h-[44px] inline-flex items-center gap-3 cursor-pointer text-right"
              >
                <span
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    settingsForm.zonePricing ? 'bg-[#1668B2]' : 'bg-slate-400'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      settingsForm.zonePricing ? '-translate-x-5' : '-translate-x-0.5'
                    }`}
                  />
                </span>
                <span className="text-sm font-bold text-[var(--text-primary)]">
                  التسعير حسب المنطقة:{' '}
                  <span className="text-[var(--text-secondary)]">
                    {settingsForm.zonePricing ? 'مفعّل (تُحسب الرسوم والعمولة من المنطقة)' : 'مغلق (تُطبق الرسوم الثابتة)'}
                  </span>
                </span>
              </button>
            </div>

            {/* الحقول الرقمية بقياسات DESIGN_RULES.md */}
            <div className="flex flex-wrap items-start gap-5">
              <div className="space-y-1.5">
                <label htmlFor="delivery-fixed-fee" className="block text-xs font-bold text-[var(--text-primary)]">
                  الرسوم الثابتة (ج.م)
                </label>
                <input
                  id="delivery-fixed-fee"
                  type="number"
                  min={0}
                  max={MAX_MONEY}
                  step="0.01"
                  dir="ltr"
                  value={settingsForm.fixedFee}
                  onChange={(e) => setSettingsForm((prev) => ({ ...prev, fixedFee: e.target.value }))}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono tabular-nums`}
                />
                <p className="text-[11px] text-[var(--text-secondary)] max-w-[200px]">
                  {settingsForm.zonePricing
                    ? 'تُستخدم عند إيقاف التسعير حسب المنطقة.'
                    : 'رسوم التوصيل المطبقة تلقائيًا على الطلبات.'}
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="delivery-max-custody" className="block text-xs font-bold text-[var(--text-primary)]">
                  الحد الأقصى لعهدة الطيار (ج.م)
                </label>
                <input
                  id="delivery-max-custody"
                  type="number"
                  min={0}
                  max={MAX_MONEY}
                  step="0.01"
                  dir="ltr"
                  value={settingsForm.maxDriverCustody}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, maxDriverCustody: e.target.value }))
                  }
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono tabular-nums`}
                />
                <p className="text-[11px] text-[var(--text-secondary)] max-w-[220px]">
                  0 = بدون حد. عند تجاوزها يظهر تنبيه عند التسليم.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="delivery-late-hours" className="block text-xs font-bold text-[var(--text-primary)]">
                  اعتبار الطلب متأخرًا بعد (ساعة)
                </label>
                <input
                  id="delivery-late-hours"
                  type="number"
                  min={MIN_LATE_HOURS}
                  max={MAX_LATE_HOURS}
                  step={1}
                  dir="ltr"
                  required
                  value={settingsForm.lateAfterHours}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, lateAfterHours: e.target.value }))
                  }
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono tabular-nums`}
                />
                <p className="text-[11px] text-[var(--text-secondary)] max-w-[220px]">
                  عدد ساعات صحيح بين {MIN_LATE_HOURS} و {MAX_LATE_HOURS} ساعة.
                </p>
              </div>
            </div>

            {/* ===================== طباعة ورقة تجهيز طلب التوصيل ===================== */}
            <div className="pt-4 border-t border-[var(--border-color)] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">
                    طباعة ورقة تجهيز طلب التوصيل
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    ورقة مرجعية لتجهيز الأصناف قبل الشحن وليست فاتورة بيع. لا تعرض الأسعار أو الإجماليات أو طريقة الدفع.
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={settingsForm.prepSlip.enabled}
                  aria-label="طباعة ورقة تجهيز طلب التوصيل"
                  data-prep-slip-switch="enabled"
                  onClick={() =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      prepSlip: { ...prev.prepSlip, enabled: !prev.prepSlip.enabled }
                    }))
                  }
                  className="min-h-[44px] inline-flex items-center gap-3 cursor-pointer text-right"
                >
                  <span
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      settingsForm.prepSlip.enabled ? 'bg-emerald-600' : 'bg-slate-400'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        settingsForm.prepSlip.enabled ? '-translate-x-5' : '-translate-x-0.5'
                      }`}
                    />
                  </span>
                  <span className="text-xs font-bold text-[var(--text-primary)]">
                    طباعة ورقة التجهيز:{' '}
                    <span className={settingsForm.prepSlip.enabled ? 'ui-stock-in' : 'ui-stock-out'}>
                      {settingsForm.prepSlip.enabled ? 'مفعّلة' : 'موقوفة'}
                    </span>
                  </span>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* الحقول القابلة للتشغيل والإيقاف */}
                <div className="lg:col-span-7 space-y-2.5">
                  <div className="text-xs font-bold text-[var(--text-primary)]">
                    الحقول الظاهرة في ورقة التجهيز
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {PREP_SLIP_FIELD_TOGGLES.map((field) => {
                      const checked = Boolean(settingsForm.prepSlip[field.key]);
                      return (
                        <label
                          key={field.key}
                          className={`min-h-[44px] p-2.5 rounded-lg border flex items-start gap-2.5 transition cursor-pointer ${
                            checked
                              ? 'border-[var(--primary)] bg-[var(--surface-subtle)]'
                              : 'border-[var(--border-color)] hover:bg-[var(--surface-subtle)]'
                          } ${!settingsForm.prepSlip.enabled ? 'opacity-60' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            data-prep-slip-field={field.key}
                            onChange={(e) =>
                              setSettingsForm((prev) => ({
                                ...prev,
                                prepSlip: {
                                  ...prev.prepSlip,
                                  [field.key]: e.target.checked
                                }
                              }))
                            }
                            className="mt-0.5 w-4 h-4 accent-[#1668B2] cursor-pointer shrink-0"
                          />
                          <span className="space-y-0.5">
                            <span className="block text-xs font-bold text-[var(--text-primary)]">
                              {field.label}
                            </span>
                            <span className="block text-[11px] text-[var(--text-secondary)] leading-relaxed">
                              {field.hint}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* المعاينة التجريبية ببيانات وهمية فقط */}
                <div className="lg:col-span-5 rounded-xl border border-[var(--border-color)] bg-[var(--surface-subtle)] p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-[var(--text-primary)]">
                        معاينة تجريبية (بيانات وهمية)
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        لا تنشئ طلبًا أو فاتورة حقيقية
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {(['80mm', '58mm', 'a4'] as const).map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => setPreviewPaperSize(sz)}
                          className={`min-h-[32px] px-2.5 rounded-md border text-[11px] font-bold cursor-pointer transition ${
                            previewPaperSize === sz
                              ? 'border-[#1668B2] bg-[#1668B2] text-white'
                              : 'border-[var(--border-color)] bg-[var(--surface-card)] text-[var(--text-primary)]'
                          }`}
                        >
                          {sz === 'a4' ? 'A4' : sz}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* مفتاح محاكاة صدور الفاتورة في المعاينة فقط */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--border-color)]">
                    <label className="min-h-[36px] inline-flex items-center gap-2 cursor-pointer text-xs text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        checked={previewInvoiceIssued}
                        data-prep-slip-preview-invoice-issued="true"
                        onChange={(e) => setPreviewInvoiceIssued(e.target.checked)}
                        className="w-4 h-4 accent-[#1668B2] cursor-pointer"
                      />
                      <span className="font-bold">محاكاة صدور الفاتورة في المعاينة</span>
                    </label>

                    <button
                      type="button"
                      disabled={!settingsForm.prepSlip.enabled || isPrintingPreview}
                      onClick={() => void handlePrintPrepSlipPreview()}
                      data-prep-slip-print-preview-btn="true"
                      className="min-h-[38px] inline-flex items-center gap-1.5 px-3 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>طباعة المعاينة</span>
                    </button>
                  </div>

                  {!settingsForm.prepSlip.enabled ? (
                    <div
                      data-prep-slip-disabled-notice="true"
                      className="p-3 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold text-center"
                    >
                      طباعة ورقة التجهيز موقوفة حاليًا — لن تُطبع الورقة حتى يتم تفعيل الإعداد.
                    </div>
                  ) : (
                    <div
                      className={`mx-auto bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden ${
                        previewPaperSize === '58mm'
                          ? 'max-w-[240px]'
                          : previewPaperSize === '80mm'
                          ? 'max-w-[320px]'
                          : 'max-w-full'
                      }`}
                    >
                      <DeliveryPrepSlipPrintArea
                        data={dummyPrepSlipData}
                        settings={settingsForm.prepSlip}
                        paperSize={previewPaperSize}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* أزرار حفظ الإعدادات + آخر تحديث */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={isSavingSettings || !isSettingsDirty}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingSettings ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>{isSavingSettings ? 'جاري الحفظ...' : 'حفظ إعدادات التوصيل'}</span>
              </button>

              <button
                type="button"
                disabled={isSavingSettings || !isSettingsDirty}
                onClick={handleResetSettingsForm}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" />
                <span>تراجع</span>
              </button>

              {settings?.updatedAt && (
                <span className="text-[11px] text-[var(--text-secondary)]">
                  آخر تحديث: {formatUpdatedAt(settings.updatedAt)}
                  {settings.updatedBy ? ` — بواسطة ${settings.updatedBy}` : ''}
                </span>
              )}
            </div>
          </form>

          {/* ===================== ب) المناطق ===================== */}
          <SectionHeading
            withTopDivider
            title={`المناطق (${zones.length})`}
            actions={
              <button
                type="button"
                onClick={openCreateZoneModal}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة منطقة</span>
              </button>
            }
          />

          {zones.length === 0 ? (
            <div className="py-6 flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
              <MapPin className="w-4 h-4 shrink-0 opacity-70" />
              <span>لا توجد مناطق توصيل مسجلة حتى الآن.</span>
            </div>
          ) : (
            <CompactTable ariaLabel="جدول مناطق التوصيل">
              <thead>
                <tr>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>م</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المنطقة</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>رسوم العميل</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>عمولة الطيار</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>أقل قيمة طلب</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الحالة</th>
                  <th className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone, idx) => {
                  const busy = togglingKey === `zone:${zone.id}`;
                  return (
                    <tr key={zone.id} className={!zone.active ? 'opacity-70' : ''}>
                      <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {idx + 1}
                      </td>
                      <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {zone.name}
                      </td>
                      <td className={`text-center font-mono font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatMoney(zone.customerFee)}
                      </td>
                      <td className={`text-center font-mono font-bold text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatMoney(zone.driverCommission)}
                      </td>
                      <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {Number(zone.minOrderValue) > 0 ? formatMoney(zone.minOrderValue) : 'بدون حد'}
                      </td>
                      <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                        <span className={zone.active ? 'ui-stock-in' : 'ui-stock-out'}>
                          {zone.active ? 'نشط' : 'موقوف'}
                        </span>
                      </td>
                      <td className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditZoneModal(zone)}
                            className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>تعديل</span>
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(togglingKey)}
                            onClick={() => void handleToggleZoneActive(zone)}
                            className={`min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold transition cursor-pointer disabled:opacity-40 ${
                              zone.active ? 'ui-stock-low' : 'ui-stock-in'
                            }`}
                          >
                            {busy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Power className="w-3.5 h-3.5" />
                            )}
                            <span>{zone.active ? 'إيقاف' : 'تفعيل'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </CompactTable>
          )}

          {/* ===================== ج) الطيارون ===================== */}
          <SectionHeading
            withTopDivider
            title={`الطيارون (${drivers.length})`}
            actions={
              <button
                type="button"
                onClick={openCreateDriverModal}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة طيار</span>
              </button>
            }
          />

          {drivers.length === 0 ? (
            <div className="py-6 flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
              <Bike className="w-4 h-4 shrink-0 opacity-70" />
              <span>لا يوجد طيارون مسجلون حتى الآن.</span>
            </div>
          ) : (
            <CompactTable ariaLabel="جدول الطيارين">
              <thead>
                <tr>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>م</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الاسم</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الهاتف</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>المرتب الشهري</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>العمولة / طلب</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>حساب الدخول</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الحالة</th>
                  <th className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((driver, idx) => {
                  const busy = togglingKey === `driver:${driver.id}`;
                  const linkedUser = driver.userId ? usersById.get(driver.userId) : undefined;
                  return (
                    <tr key={driver.id} className={!driver.active ? 'opacity-70' : ''}>
                      <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {idx + 1}
                      </td>
                      <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {driver.name}
                      </td>
                      <td className={`text-center font-mono text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`} dir="ltr">
                        {driver.phone || '—'}
                      </td>
                      <td className={`text-center font-mono font-bold text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatMoney(driver.monthlySalary)}
                      </td>
                      <td className={`text-center font-mono font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatMoney(driver.commissionPerOrder)}
                      </td>
                      <td className={`text-xs text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {linkedUser ? (
                          <div>
                            <span className="font-bold text-[var(--text-primary)]">{linkedUser.name}</span>
                            {linkedUser.username ? (
                              <span className="mr-1.5 font-mono text-[11px]" dir="ltr">
                                @{linkedUser.username}
                              </span>
                            ) : null}
                            {!linkedUser.isDriver && (
                              <span className="block text-[11px] ui-stock-low mt-0.5">
                                يحتاج صلاحية «طيار» لفتح طلباته
                              </span>
                            )}
                          </div>
                        ) : driver.userId ? (
                          <span className="ui-stock-low">حساب غير موجود</span>
                        ) : (
                          <span>غير مربوط</span>
                        )}
                      </td>
                      <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                        <span className={driver.active ? 'ui-stock-in' : 'ui-stock-out'}>
                          {driver.active ? 'نشط' : 'موقوف'}
                        </span>
                      </td>
                      <td className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditDriverModal(driver)}
                            className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>تعديل</span>
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(togglingKey)}
                            onClick={() => void handleToggleDriverActive(driver)}
                            className={`min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold transition cursor-pointer disabled:opacity-40 ${
                              driver.active ? 'ui-stock-low' : 'ui-stock-in'
                            }`}
                          >
                            {busy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Power className="w-3.5 h-3.5" />
                            )}
                            <span>{driver.active ? 'إيقاف' : 'تفعيل'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </CompactTable>
          )}

          {/* ===================== د) شركات الشحن ===================== */}
          <SectionHeading
            withTopDivider
            title={`شركات الشحن (${couriers.length})`}
            actions={
              <button
                type="button"
                onClick={openCreateCourierModal}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة شركة شحن</span>
              </button>
            }
          />

          {couriers.length === 0 ? (
            <div className="py-6 flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
              <Truck className="w-4 h-4 shrink-0 opacity-70" />
              <span>لا توجد شركات شحن مسجلة حتى الآن.</span>
            </div>
          ) : (
            <CompactTable ariaLabel="جدول شركات الشحن">
              <thead>
                <tr>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>م</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>اسم الشركة</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>رسوم الشركة / طلب</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الحالة</th>
                  <th className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {couriers.map((courier, idx) => {
                  const busy = togglingKey === `courier:${courier.id}`;
                  return (
                    <tr key={courier.id} className={!courier.active ? 'opacity-70' : ''}>
                      <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {idx + 1}
                      </td>
                      <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {courier.name}
                      </td>
                      <td className={`text-center font-mono font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                        {formatMoney(courier.feePerOrder)}
                      </td>
                      <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                        <span className={courier.active ? 'ui-stock-in' : 'ui-stock-out'}>
                          {courier.active ? 'نشط' : 'موقوف'}
                        </span>
                      </td>
                      <td className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditCourierModal(courier)}
                            className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>تعديل</span>
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(togglingKey)}
                            onClick={() => void handleToggleCourierActive(courier)}
                            className={`min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold transition cursor-pointer disabled:opacity-40 ${
                              courier.active ? 'ui-stock-low' : 'ui-stock-in'
                            }`}
                          >
                            {busy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Power className="w-3.5 h-3.5" />
                            )}
                            <span>{courier.active ? 'إيقاف' : 'تفعيل'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </CompactTable>
          )}
        </>
      )}

      {/* ===================== نافذة إضافة/تعديل منطقة ===================== */}
      {isZoneModalOpen && (
        <ModalShell
          title={editingZone ? `تعديل المنطقة: ${editingZone.name}` : 'إضافة منطقة توصيل جديدة'}
          onClose={() => !isSavingZone && setIsZoneModalOpen(false)}
          onSave={() => void handleSaveZone()}
          saveDisabled={isSavingZone}
          closeDisabled={isSavingZone}
          footer={
            <>
              <button
                type="button"
                disabled={isSavingZone}
                onClick={() => setIsZoneModalOpen(false)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSavingZone}
                onClick={() => void handleSaveZone()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isSavingZone ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{isSavingZone ? 'جاري الحفظ...' : 'حفظ'}</span>
              </button>
            </>
          }
        >
          <form onSubmit={handleSaveZone} className="space-y-4">
            {zoneFormError && (
              <div role="alert" className="px-3 py-2 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold">
                {zoneFormError}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="zone-name" className="block text-xs font-bold text-[var(--text-primary)]">
                اسم المنطقة <span className="ui-stock-out">*</span>
              </label>
              <input
                id="zone-name"
                type="text"
                maxLength={80}
                required
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                placeholder="مثال: المعادي"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name}`}
              />
            </div>

            <div className="flex flex-wrap items-start gap-4">
              <div className="space-y-1.5">
                <label htmlFor="zone-customer-fee" className="block text-xs font-bold text-[var(--text-primary)]">
                  رسوم العميل (ج.م)
                </label>
                <input
                  id="zone-customer-fee"
                  type="number"
                  min={0}
                  max={MAX_MONEY}
                  step="0.01"
                  dir="ltr"
                  value={zoneCustomerFee}
                  onChange={(e) => setZoneCustomerFee(e.target.value)}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono tabular-nums`}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="zone-driver-commission" className="block text-xs font-bold text-[var(--text-primary)]">
                  عمولة الطيار (ج.م)
                </label>
                <input
                  id="zone-driver-commission"
                  type="number"
                  min={0}
                  max={MAX_MONEY}
                  step="0.01"
                  dir="ltr"
                  value={zoneDriverCommission}
                  onChange={(e) => setZoneDriverCommission(e.target.value)}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono tabular-nums`}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="zone-min-order" className="block text-xs font-bold text-[var(--text-primary)]">
                  أقل قيمة طلب (ج.م)
                </label>
                <input
                  id="zone-min-order"
                  type="number"
                  min={0}
                  max={MAX_MONEY}
                  step="0.01"
                  dir="ltr"
                  value={zoneMinOrderValue}
                  onChange={(e) => setZoneMinOrderValue(e.target.value)}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono tabular-nums`}
                />
                <p className="text-[11px] text-[var(--text-secondary)]">0 = بدون حد أدنى</p>
              </div>
            </div>

            <label className="min-h-[44px] inline-flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={zoneActive}
                onChange={(e) => setZoneActive(e.target.checked)}
                className="w-5 h-5 accent-emerald-600 cursor-pointer"
              />
              <span className="text-xs font-bold text-[var(--text-primary)]">
                المنطقة نشطة ومتاحة للاختيار
              </span>
            </label>
          </form>
        </ModalShell>
      )}

      {/* ===================== نافذة إضافة/تعديل طيار ===================== */}
      {isDriverModalOpen && (
        <ModalShell
          title={editingDriver ? `تعديل بيانات الطيار: ${editingDriver.name}` : 'إضافة طيار جديد'}
          onClose={() => !isSavingDriver && setIsDriverModalOpen(false)}
          onSave={() => void handleSaveDriver()}
          saveDisabled={isSavingDriver}
          closeDisabled={isSavingDriver}
          footer={
            <>
              <button
                type="button"
                disabled={isSavingDriver}
                onClick={() => setIsDriverModalOpen(false)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSavingDriver}
                onClick={() => void handleSaveDriver()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isSavingDriver ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{isSavingDriver ? 'جاري الحفظ...' : 'حفظ'}</span>
              </button>
            </>
          }
        >
          <form onSubmit={handleSaveDriver} className="space-y-4">
            {driverFormError && (
              <div role="alert" className="px-3 py-2 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold">
                {driverFormError}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="driver-name" className="block text-xs font-bold text-[var(--text-primary)]">
                اسم الطيار <span className="ui-stock-out">*</span>
              </label>
              <input
                id="driver-name"
                type="text"
                maxLength={80}
                required
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="مثال: أحمد علي"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name}`}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="driver-phone" className="block text-xs font-bold text-[var(--text-primary)]">
                رقم الهاتف
              </label>
              <input
                id="driver-phone"
                type="tel"
                maxLength={30}
                dir="ltr"
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
                placeholder="01000000000"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} font-mono`}
              />
            </div>

            <div className="flex flex-wrap items-start gap-4">
              <div className="space-y-1.5">
                <label htmlFor="driver-salary" className="block text-xs font-bold text-[var(--text-primary)]">
                  المرتب الشهري (ج.م)
                </label>
                <input
                  id="driver-salary"
                  type="number"
                  min={0}
                  max={MAX_MONEY}
                  step="0.01"
                  dir="ltr"
                  value={driverMonthlySalary}
                  onChange={(e) => setDriverMonthlySalary(e.target.value)}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono tabular-nums`}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="driver-commission" className="block text-xs font-bold text-[var(--text-primary)]">
                  العمولة لكل طلب (ج.م)
                </label>
                <input
                  id="driver-commission"
                  type="number"
                  min={0}
                  max={MAX_MONEY}
                  step="0.01"
                  dir="ltr"
                  value={driverCommissionPerOrder}
                  onChange={(e) => setDriverCommissionPerOrder(e.target.value)}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono tabular-nums`}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="driver-user-id" className="block text-xs font-bold text-[var(--text-primary)]">
                ربط بحساب مستخدم (اختياري)
              </label>
              <select
                id="driver-user-id"
                value={driverUserId}
                onChange={(e) => setDriverUserId(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name}`}
              >
                <option value="">بدون ربط بحساب مستخدم</option>
                {sortedUsersForSelect.map((u) => {
                  const linkedOther = drivers.find(
                    (d) => d.userId === u.id && d.id !== editingDriver?.id
                  );
                  const roleTag = u.isDriver ? 'صلاحية طيار' : 'بدون صلاحية طيار';
                  const takenTag = linkedOther ? ` — مربوط بالطيار ${linkedOther.name}` : '';
                  return (
                    <option key={u.id} value={u.id} disabled={Boolean(linkedOther)}>
                      {u.name} (@{u.username}) — {roleTag}
                      {takenTag}
                    </option>
                  );
                })}
              </select>
              <p className="text-[11px] text-[var(--text-secondary)] max-w-[360px]">
                لفتح طلبات الطيار من حسابه يجب منحه صلاحية «طيار» من شاشة الصلاحيات. لا يمكن ربط نفس الحساب بأكثر من طيار.
              </p>
            </div>

            <label className="min-h-[44px] inline-flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={driverActive}
                onChange={(e) => setDriverActive(e.target.checked)}
                className="w-5 h-5 accent-emerald-600 cursor-pointer"
              />
              <span className="text-xs font-bold text-[var(--text-primary)]">
                الطيار نشط ومتاح للتوزيع
              </span>
            </label>
          </form>
        </ModalShell>
      )}

      {/* ===================== نافذة إضافة/تعديل شركة شحن ===================== */}
      {isCourierModalOpen && (
        <ModalShell
          title={editingCourier ? `تعديل شركة الشحن: ${editingCourier.name}` : 'إضافة شركة شحن جديدة'}
          onClose={() => !isSavingCourier && setIsCourierModalOpen(false)}
          onSave={() => void handleSaveCourier()}
          saveDisabled={isSavingCourier}
          closeDisabled={isSavingCourier}
          footer={
            <>
              <button
                type="button"
                disabled={isSavingCourier}
                onClick={() => setIsCourierModalOpen(false)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSavingCourier}
                onClick={() => void handleSaveCourier()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isSavingCourier ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{isSavingCourier ? 'جاري الحفظ...' : 'حفظ'}</span>
              </button>
            </>
          }
        >
          <form onSubmit={handleSaveCourier} className="space-y-4">
            {courierFormError && (
              <div role="alert" className="px-3 py-2 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold">
                {courierFormError}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="courier-name" className="block text-xs font-bold text-[var(--text-primary)]">
                اسم شركة الشحن <span className="ui-stock-out">*</span>
              </label>
              <input
                id="courier-name"
                type="text"
                maxLength={80}
                required
                value={courierName}
                onChange={(e) => setCourierName(e.target.value)}
                placeholder="مثال: بوسطة"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name}`}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="courier-fee" className="block text-xs font-bold text-[var(--text-primary)]">
                رسوم الشركة لكل طلب (ج.م)
              </label>
              <input
                id="courier-fee"
                type="number"
                min={0}
                max={MAX_MONEY}
                step="0.01"
                dir="ltr"
                value={courierFeePerOrder}
                onChange={(e) => setCourierFeePerOrder(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono tabular-nums`}
              />
              <p className="text-[11px] text-[var(--text-secondary)]">
                تُخصم تلقائيًا من صافي تحصيل شركة الشحن وقت التسوية.
              </p>
            </div>

            <label className="min-h-[44px] inline-flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={courierActive}
                onChange={(e) => setCourierActive(e.target.checked)}
                className="w-5 h-5 accent-emerald-600 cursor-pointer"
              />
              <span className="text-xs font-bold text-[var(--text-primary)]">
                الشركة نشطة ومتاحة للتوزيع
              </span>
            </label>
          </form>
        </ModalShell>
      )}
    </PageSurface>
  );
};

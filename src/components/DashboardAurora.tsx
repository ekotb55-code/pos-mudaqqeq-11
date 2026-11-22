import React, { useMemo } from 'react';
import {
  PageType,
  Item,
  Invoice,
  Platform,
  DashboardCashbox,
  UserRole,
  UserAccount,
  AppTheme
} from '../types';
import { hasPermission } from '../utils/permissions';
import { getNavGroupColors, getHrefForTarget, getHrefForItemRoute, isPlainLeftClick } from '../config/navigation';
import {
  formatMoney,
  getCairoToday,
  getDateRangeForPreset,
  toCairoDateStr
} from '../utils/dateUtils';
import {
  ShoppingCart,
  ShoppingBag,
  PlusCircle,
  TrendingUp,
  TrendingDown,
  Globe2,
  BarChart3,
  Users,
  Package,
  Receipt,
  Wallet,
  Landmark,
  Smartphone,
  ArrowLeftRight,
  AlertTriangle,
  RotateCw,
  ChevronLeft
} from 'lucide-react';

export interface SevenDayBarPoint {
  dateStr: string;
  dayLetter: string;
  dayName: string;
  total: number;
  count: number;
  isToday: boolean;
  heightPct: number;
}

export interface PlatformTodaySale {
  id: string;
  name: string;
  amount: number;
  ordersCount: number;
  widthPct: number;
}

export interface RecentInvoiceStatusBadge {
  label: string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
}

export interface QuickActionItem {
  id: 'credit_collection' | 'cashbox_transfer' | 'purchase_invoice' | 'today_report';
  label: string;
  page: PageType;
  tab?: string;
  groupId: string;
}

export interface DashboardAuroraMetrics {
  canViewProfit: boolean;
  canAddItem: boolean;
  canViewInvoices: boolean;
  completedInvoices: Invoice[];
  todayInvoicesCount: number;
  todaySales: number;
  todayAvgInvoice: number;
  todayPiecesSold: number;
  yesterdayHasData: boolean;
  yesterdayDeltaPct: number | null;
  last7Days: SevenDayBarPoint[];
  hasLast7DaysData: boolean;
  netReceiptTotal: number;
  grossProfit: number | undefined;
  pendingCreditCount: number;
  pendingCreditTotal: number;
  lowStockCount: number;
  totalItemsCount: number;
  totalInvoicesCount: number;
}

const ARABIC_WEEKDAY_LETTERS: Record<number, { letter: string; name: string }> = {
  0: { letter: 'ح', name: 'الأحد' },
  1: { letter: 'ن', name: 'الإثنين' },
  2: { letter: 'ث', name: 'الثلاثاء' },
  3: { letter: 'ر', name: 'الأربعاء' },
  4: { letter: 'خ', name: 'الخميس' },
  5: { letter: 'ج', name: 'الجمعة' },
  6: { letter: 'س', name: 'السبت' }
};

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getInvoiceSaleValue(inv: Invoice): number {
  return Number(inv.totalBeforeDiscount || inv.netAmount || 0);
}

function getInvoicePiecesCount(inv: Invoice): number {
  return (inv.lines || []).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
}

function getPendingCreditDueAmount(inv: Invoice): number {
  if (inv.remainingAmount != null && Number(inv.remainingAmount) > 0) {
    return Number(inv.remainingAmount);
  }
  if (inv.creditDueAmount != null) {
    return Number(inv.creditDueAmount);
  }
  if (inv.creditPartyType === 'platform') {
    return Number(inv.netAmount || 0);
  }
  return Number(inv.totalBeforeDiscount || 0) + Number(inv.deliveryFee || 0);
}

export function getAuroraCashboxGradient(index: number, appTheme?: AppTheme): string {
  const themeGradient =
    appTheme === 'aurora-sky'
      ? 'linear-gradient(135deg, #1E3A8A 0%, #0F2540 100%)'
      : 'linear-gradient(135deg, #6366F1 0%, #7C3AED 100%)';

  const palette = [
    'linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)', // برتقالي
    'linear-gradient(135deg, #10B981 0%, #0F766E 100%)', // أخضر
    themeGradient,                                         // لون الثيم
    'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)', // وردي
    'linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)'  // سماوي
  ];
  return palette[((index % palette.length) + palette.length) % palette.length];
}

export function computeTodayPlatformSales(
  invoices: Invoice[],
  platforms: Platform[],
  todayOverride?: string
): PlatformTodaySale[] {
  const todayStr = todayOverride || getCairoToday();
  const todayCompleted = invoices.filter(
    inv => inv.status === 'تم البيع' && toCairoDateStr(inv.date) === todayStr
  );

  if (todayCompleted.length === 0) return [];

  const totals = new Map<string, { id: string; name: string; amount: number; ordersCount: number }>();

  for (const inv of todayCompleted) {
    const invPlatformRaw = (inv.platform || inv.platformName || '').trim();
    const invPlatformLower = invPlatformRaw.toLowerCase();

    const matchedPlatform = platforms.find(
      plt =>
        (inv.platformId && inv.platformId === plt.id) ||
        invPlatformLower.includes(plt.name.toLowerCase()) ||
        invPlatformLower.includes(plt.id.toLowerCase())
    );

    const key = matchedPlatform ? matchedPlatform.id : invPlatformLower || 'other';
    const label = matchedPlatform ? matchedPlatform.name : invPlatformRaw || 'مباشر';

    const prev = totals.get(key) || { id: key, name: label, amount: 0, ordersCount: 0 };
    prev.amount += getInvoiceSaleValue(inv);
    prev.ordersCount += 1;
    totals.set(key, prev);
  }

  const sorted = Array.from(totals.values())
    .filter(entry => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const maxAmount = sorted[0]?.amount || 0;
  return sorted.map(entry => ({
    ...entry,
    widthPct: maxAmount > 0 ? Math.max(8, Math.round((entry.amount / maxAmount) * 100)) : 0
  }));
}

export function getRecentInvoicesList(invoices: Invoice[], limit = 5): Invoice[] {
  return [...invoices]
    .map((inv, idx) => ({ inv, idx, ts: new Date(inv.date).getTime() }))
    .sort((a, b) => {
      const aValid = !Number.isNaN(a.ts);
      const bValid = !Number.isNaN(b.ts);
      if (aValid && bValid && b.ts !== a.ts) return b.ts - a.ts;
      return a.idx - b.idx;
    })
    .slice(0, limit)
    .map(entry => entry.inv);
}

export function getInvoiceStatusBadge(inv: Invoice): RecentInvoiceStatusBadge {
  if (inv.status === 'ملغاة') {
    return { label: 'ملغاة', tone: 'rose' };
  }
  if (inv.status === 'مرتجع' || inv.status === 'مرتجع جزئي') {
    return { label: inv.status, tone: 'slate' };
  }
  const isSettled = inv.status === 'مسددة' || inv.creditStatus === 'مسددة';
  const isCredit =
    !isSettled &&
    (inv.paymentType === 'آجل' ||
      inv.status === 'معلّقة' ||
      inv.creditStatus === 'معلّقة' ||
      Number(inv.remainingAmount || 0) > 0);
  if (isCredit) {
    return { label: 'آجل', tone: 'amber' };
  }
  return { label: 'مدفوعة', tone: 'emerald' };
}

export function getQuickActionsForUser(
  user?: UserAccount | null,
  userRole?: UserRole
): QuickActionItem[] {
  const isOwnerOrDesigner =
    user?.role === 'designer' || Boolean(user?.isOwner) || userRole === 'designer';

  const items: QuickActionItem[] = [];

  if (isOwnerOrDesigner || hasPermission(user, 'invoices.collect_credit')) {
    items.push({
      id: 'credit_collection',
      label: 'تحصيل آجل',
      page: 'credit_collection',
      groupId: 'customers'
    });
  }

  if (isOwnerOrDesigner || hasPermission(user, 'cashbox.transfer')) {
    items.push({
      id: 'cashbox_transfer',
      label: 'تحويل بين الخزن',
      page: 'cashboxes',
      tab: 'TRANSFER',
      groupId: 'cashboxes'
    });
  }

  if (isOwnerOrDesigner || hasPermission(user, 'purchases.create')) {
    items.push({
      id: 'purchase_invoice',
      label: 'فاتورة شراء',
      page: 'purchases',
      tab: 'PURCHASES',
      groupId: 'purchases'
    });
  }

  if (isOwnerOrDesigner || hasPermission(user, 'reports.view_reports')) {
    items.push({
      id: 'today_report',
      label: 'تقرير اليوم',
      page: 'reports',
      tab: 'FINANCIAL',
      groupId: 'reports'
    });
  }

  return items;
}

export function computeDashboardAuroraMetrics(params: {
  invoices: Invoice[];
  items: Item[];
  userRole: UserRole;
  user?: UserAccount | null;
  todayOverride?: string;
}): DashboardAuroraMetrics {
  const { invoices, items, userRole, user, todayOverride } = params;

  const isManager = userRole === 'manager' || userRole === 'designer';
  const canViewProfit = user
    ? (user.role === 'designer' ||
        Boolean(user.isOwner) ||
        (Array.isArray(user.permissions) ? hasPermission(user, 'reports.view_profit') : isManager))
    : isManager;
  const canAddItem = isManager;
  const canViewInvoices = user
    ? user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'invoices.view')
    : true;

  // نفس منطق DashboardPage.tsx بالضبط لإجمالي صافي الاستلام والربح ونواقص المخزون
  const completedInvoices = invoices.filter(i => i.status === 'تم البيع');
  const netReceiptTotal = completedInvoices.reduce((s, i) => s + (i.netAmount || 0), 0);

  let grossProfit: number | undefined = undefined;
  if (canViewProfit) {
    let costSum = 0;
    for (const inv of completedInvoices) {
      for (const line of inv.lines || []) {
        costSum += ((line.purchasePriceAtSale || 0) + (line.packagingCostAtSale || 0)) * (line.quantity || 1);
      }
    }
    grossProfit = netReceiptTotal - costSum;
  }

  const lowStockItems = items.filter(p => p.status !== 'inactive' && p.stockQuantity <= 5);

  // تواريخ اليوم وأمس وآخر 7 أيام بتوقيت القاهرة Africa/Cairo
  const todayStr = todayOverride || getCairoToday();
  const [yStr, mStr, dStr] = todayStr.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);

  const yesterdayStr = todayOverride
    ? new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
    : (getDateRangeForPreset('YESTERDAY').from || '');

  const todayInvoices = completedInvoices.filter(inv => toCairoDateStr(inv.date) === todayStr);
  const todayInvoicesCount = todayInvoices.length;
  const todaySales = todayInvoices.reduce((s, inv) => s + getInvoiceSaleValue(inv), 0);
  const todayAvgInvoice = todayInvoicesCount > 0 ? todaySales / todayInvoicesCount : 0;
  const todayPiecesSold = todayInvoices.reduce((s, inv) => s + getInvoicePiecesCount(inv), 0);

  const yesterdayInvoices = yesterdayStr
    ? completedInvoices.filter(inv => toCairoDateStr(inv.date) === yesterdayStr)
    : [];
  const yesterdaySales = yesterdayInvoices.reduce((s, inv) => s + getInvoiceSaleValue(inv), 0);
  const yesterdayHasData = yesterdayInvoices.length > 0 && yesterdaySales > 0;
  const yesterdayDeltaPct = yesterdayHasData
    ? ((todaySales - yesterdaySales) / yesterdaySales) * 100
    : null;

  // تجميع مبيعات آخر 7 أيام من الفواتير المكتملة
  const dayMap = new Map<string, { total: number; count: number }>();
  for (const inv of completedInvoices) {
    const invDate = toCairoDateStr(inv.date);
    if (!invDate) continue;
    const prev = dayMap.get(invDate) || { total: 0, count: 0 };
    prev.total += getInvoiceSaleValue(inv);
    prev.count += 1;
    dayMap.set(invDate, prev);
  }

  const raw7Days: Omit<SevenDayBarPoint, 'heightPct'>[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const dt = new Date(Date.UTC(year, month - 1, day - offset));
    const dateStr = dt.toISOString().slice(0, 10);
    const weekday = ARABIC_WEEKDAY_LETTERS[dt.getUTCDay()] || { letter: 'ي', name: '' };
    const entry = dayMap.get(dateStr) || { total: 0, count: 0 };
    raw7Days.push({
      dateStr,
      dayLetter: weekday.letter,
      dayName: weekday.name,
      total: entry.total,
      count: entry.count,
      isToday: offset === 0
    });
  }

  const max7DayTotal = raw7Days.reduce((max, d) => (d.total > max ? d.total : max), 0);
  const hasLast7DaysData = raw7Days.some(d => d.total > 0 || d.count > 0);

  const last7Days: SevenDayBarPoint[] = raw7Days.map(d => ({
    ...d,
    heightPct:
      max7DayTotal > 0
        ? d.total > 0
          ? Math.max(14, Math.round((d.total / max7DayTotal) * 100))
          : 6
        : 0
  }));

  // حساب الآجل المعلّق من نفس بيانات الفواتير
  const pendingCreditInvoices = invoices.filter(inv => {
    if (inv.status === 'ملغاة' || inv.status === 'مسددة' || inv.creditStatus === 'مسددة') {
      return false;
    }
    return (
      inv.paymentType === 'آجل' ||
      inv.status === 'معلّقة' ||
      inv.creditStatus === 'معلّقة' ||
      Number(inv.remainingAmount || 0) > 0
    );
  });
  const pendingCreditTotal = pendingCreditInvoices.reduce(
    (sum, inv) => sum + getPendingCreditDueAmount(inv),
    0
  );

  return {
    canViewProfit,
    canAddItem,
    canViewInvoices,
    completedInvoices,
    todayInvoicesCount,
    todaySales,
    todayAvgInvoice,
    todayPiecesSold,
    yesterdayHasData,
    yesterdayDeltaPct,
    last7Days,
    hasLast7DaysData,
    netReceiptTotal,
    grossProfit,
    pendingCreditCount: pendingCreditInvoices.length,
    pendingCreditTotal,
    lowStockCount: lowStockItems.length,
    totalItemsCount: items.length,
    totalInvoicesCount: invoices.length
  };
}

interface DashboardAuroraProps {
  items: Item[];
  platforms: Platform[];
  invoices: Invoice[];
  userRole: UserRole;
  user?: UserAccount | null;
  appTheme?: AppTheme;
  canViewCashboxes: boolean;
  canViewCashboxPage: boolean;
  dashboardCashboxes: DashboardCashbox[];
  isLoadingCashboxes: boolean;
  cashboxError: string | null;
  totalsByCurrency: [string, number][];
  onRefreshCashboxes: () => void;
  onNavigate: (
    page: PageType,
    tab?: string,
    options?: { searchParams?: Record<string, string | undefined> }
  ) => void;
  onOpenProductModal: (item?: Item) => void;
  onOpenInvoiceDetails: (inv: Invoice) => void;
  platformsEnabled?: boolean;
}

interface SectionSquareIconProps {
  groupId: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

const SectionSquareIcon: React.FC<SectionSquareIconProps> = ({ groupId, icon: Icon }) => {
  const palette = getNavGroupColors(groupId);
  return (
    <span
      className="relative w-10 h-10 rounded-[12px] flex items-center justify-center overflow-hidden shrink-0"
      style={{
        background: `linear-gradient(135deg, ${palette.primary} 0%, ${palette.dark} 100%)`,
        boxShadow: `0 6px 14px ${hexToRgba(palette.primary, 0.28)}`
      }}
      aria-hidden="true"
    >
      <span
        className="pointer-events-none absolute w-10 h-10 rounded-full -top-5 -left-5"
        style={{ background: 'rgba(255, 255, 255, 0.22)' }}
      />
      <Icon className="w-[18px] h-[18px] text-white relative z-10" strokeWidth={2.1} />
    </span>
  );
};

function getCashboxIcon(type?: string) {
  const t = type || '';
  if (t.includes('بنك') || t.includes('بنكي')) return Landmark;
  if (t.includes('محفظة') || t.includes('إلكترونية')) return Smartphone;
  if (t.includes('وسيطة') || t.includes('وسيط')) return ArrowLeftRight;
  return Wallet;
}

const QUICK_ACTION_ICONS: Record<
  QuickActionItem['id'],
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  credit_collection: Users,
  cashbox_transfer: Wallet,
  purchase_invoice: ShoppingBag,
  today_report: BarChart3
};

export const DashboardAurora: React.FC<DashboardAuroraProps> = ({
  items,
  platforms,
  invoices,
  userRole,
  user,
  appTheme,
  canViewCashboxes,
  canViewCashboxPage,
  dashboardCashboxes,
  isLoadingCashboxes,
  cashboxError,
  totalsByCurrency,
  onRefreshCashboxes,
  onNavigate,
  onOpenProductModal,
  onOpenInvoiceDetails,
  platformsEnabled = true
}) => {
  const metrics = useMemo(
    () => computeDashboardAuroraMetrics({ invoices, items, userRole, user }),
    [invoices, items, userRole, user]
  );

  const platformSalesToday = useMemo(
    () => (platformsEnabled ? computeTodayPlatformSales(invoices, platforms) : []),
    [platformsEnabled, invoices, platforms]
  );

  const recentInvoices = useMemo(() => getRecentInvoicesList(invoices, 5), [invoices]);

  const quickActions = useMemo(
    () => getQuickActionsForUser(user, userRole),
    [user, userRole]
  );

  const deltaIsPositive = (metrics.yesterdayDeltaPct ?? 0) >= 0;
  const formattedDelta =
    metrics.yesterdayDeltaPct !== null
      ? `${deltaIsPositive ? '+' : '-'}${Math.abs(metrics.yesterdayDeltaPct).toFixed(1)}%`
      : null;

  const hasMoreThanThreeCashboxes = dashboardCashboxes.length > 3;

  return (
    <div className="space-y-4 sm:space-y-5" dir="rtl">
      {/* ========================================================
          الصف الأول: كارت مبيعات اليوم (~60%) + 4 كروت زجاجية (~40%)
         ======================================================== */}
      <section
        aria-label="ملخص اليوم والمؤشرات الرئيسية"
        className="grid grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 sm:gap-5 items-stretch"
      >
        {/* 1) الكارت الرئيسي الكبير: مبيعات اليوم (~60%) */}
        <div
          className="relative overflow-hidden rounded-[30px] p-6 sm:p-7 text-white min-h-[262px] min-w-0 flex flex-col justify-between"
          style={{
            background: 'var(--brand-gradient)',
            boxShadow: '0 20px 44px -14px rgba(67, 56, 202, 0.36)'
          }}
        >
          {/* دائرتان شفافتان للزينة */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -left-16 w-64 h-64 rounded-full bg-white/10"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 left-24 w-52 h-52 rounded-full bg-white/10 border border-white/15"
          />

          <div className="relative z-10 flex flex-col sm:flex-row sm:items-stretch justify-between gap-5 h-full">
            {/* العمود الأيمن: العنوان + الرقم الكبير + المقاييس + الأزرار */}
            <div className="flex flex-col justify-between gap-4 flex-1 min-w-0">
              <div>
                <div className="flex items-center flex-wrap gap-2.5">
                  <h1 className="text-sm sm:text-base font-bold text-white/95">
                    مبيعات اليوم
                  </h1>
                  {metrics.yesterdayHasData && formattedDelta && (
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold tabular-nums ${
                        deltaIsPositive
                          ? 'bg-[#DCFCE7] text-[#15803D]'
                          : 'bg-[#FEE2E2] text-[#B91C1C]'
                      }`}
                      dir="ltr"
                    >
                      {deltaIsPositive ? (
                        <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{formattedDelta}</span>
                    </span>
                  )}
                </div>

                {/* الرقم الكبير (38px على الموبايل، 46px-50px على الديسكتوب) بـ tabular-nums مع ج.م */}
                <div className="mt-2.5 flex items-baseline flex-wrap gap-2">
                  <span
                    className="text-[38px] md:text-[46px] xl:text-[50px] font-black leading-none tracking-tight text-white tabular-nums"
                    dir="ltr"
                  >
                    {formatMoney(metrics.todaySales)}
                  </span>
                  <span className="text-base sm:text-lg font-bold text-white/90">ج.م</span>
                </div>

                {/* ثلاث مقاييس صغيرة */}
                <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-[13px] text-white/90 font-semibold">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/75">عدد الفواتير:</span>
                    <span className="font-extrabold text-white tabular-nums">
                      {metrics.todayInvoicesCount}
                    </span>
                  </div>
                  <span aria-hidden="true" className="text-white/40">·</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/75">متوسط الفاتورة:</span>
                    <span className="font-extrabold text-white tabular-nums" dir="ltr">
                      {formatMoney(metrics.todayAvgInvoice)}
                    </span>
                    <span className="text-white/80 text-[11px]">ج.م</span>
                  </div>
                  <span aria-hidden="true" className="text-white/40">·</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/75">القطع المباعة:</span>
                    <span className="font-extrabold text-white tabular-nums">
                      {metrics.todayPiecesSold}
                    </span>
                  </div>
                </div>
              </div>

              {/* زرا الإجراءات بنفس الوجهات والصلاحيات الحالية */}
              <div className={`no-print ${metrics.canAddItem ? 'grid grid-cols-2 md:flex md:flex-wrap items-center gap-2.5 pt-1' : 'flex flex-wrap items-center gap-2.5 pt-1'}`}>
                <a
                  href={getHrefForTarget('pos')}
                  onClick={(e) => {
                    if (!isPlainLeftClick(e)) return;
                    e.preventDefault();
                    onNavigate('pos');
                  }}
                  className="inline-flex items-center justify-center gap-1.5 sm:gap-2 px-3 md:px-5 py-2.5 rounded-2xl bg-white hover:bg-white/95 font-extrabold text-[13px] md:text-sm shadow-md transition-all active:scale-95 cursor-pointer min-h-[44px] whitespace-nowrap shrink-0"
                  style={{ color: 'var(--primary-on-white, var(--primary))' }}
                >
                  <ShoppingCart className="w-[17px] h-[17px] sm:w-[18px] sm:h-[18px] shrink-0" />
                  <span>فاتورة بيع جديدة</span>
                </a>

                {metrics.canAddItem && (
                  <a
                    href={getHrefForItemRoute('new')}
                    onClick={(e) => {
                      if (!isPlainLeftClick(e)) return;
                      e.preventDefault();
                      onOpenProductModal();
                    }}
                    className="inline-flex items-center justify-center gap-1.5 sm:gap-2 px-3 md:px-4 py-2.5 rounded-2xl bg-white/15 hover:bg-white/25 text-white font-bold text-[13px] md:text-sm border border-white/60 transition cursor-pointer min-h-[44px] whitespace-nowrap shrink-0"
                  >
                    <PlusCircle className="w-[17px] h-[17px] sm:w-[18px] sm:h-[18px] shrink-0" />
                    <span>إضافة صنف</span>
                  </a>
                )}
              </div>
            </div>

            {/* مصغّر آخر 7 أيام على اليسار داخل الكارت — يختفي على الموبايل (< 768px) ويظهر فقط عند توفر فواتير */}
            {metrics.hasLast7DaysData && (
              <div className="hidden md:flex md:w-[196px] shrink-0 rounded-[20px] bg-white/14 border border-white/20 p-3.5 flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white/90">آخر 7 أيام</span>
                  <span className="text-[11px] font-semibold text-white/75 tabular-nums">
                    {metrics.last7Days.reduce((s, d) => s + d.count, 0)} فاتورة
                  </span>
                </div>

                <div className="mt-3 h-24 flex items-end justify-between gap-1.5" dir="ltr">
                  {metrics.last7Days.map(dayPoint => (
                    <div
                      key={dayPoint.dateStr}
                      className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full"
                      title={`${dayPoint.dayName} (${dayPoint.dateStr}): ${formatMoney(dayPoint.total)} ج.م`}
                    >
                      <div className="w-full flex-1 flex items-end justify-center">
                        <div
                          className={`w-full max-w-[16px] rounded-t-md transition-all ${
                            dayPoint.isToday
                              ? 'bg-white shadow-sm'
                              : 'bg-white/40'
                          }`}
                          style={{ height: `${dayPoint.heightPct}%` }}
                        />
                      </div>
                      <span
                        className={`text-[11px] leading-none ${
                          dayPoint.isToday ? 'font-extrabold text-white' : 'font-semibold text-white/75'
                        }`}
                      >
                        {dayPoint.dayLetter}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 2) 4 كروت زجاجية صغيرة في شبكة 2×2 (~40%) */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 h-full min-w-0">
          {/* كارت 1: صافي الاستلام */}
          <div className="bg-white rounded-[28px] p-4 sm:p-5 flex flex-col justify-between min-h-[124px] min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-[13px] font-bold text-[var(--text-secondary)] leading-snug">
                صافي الاستلام
              </span>
              <SectionSquareIcon groupId="platforms" icon={Globe2} />
            </div>
            <div className="mt-3">
              <div className="flex items-baseline flex-wrap gap-1">
                <span
                  className="text-lg sm:text-xl xl:text-[22px] font-black text-[#15803D] tracking-tight tabular-nums"
                  dir="ltr"
                >
                  {formatMoney(metrics.netReceiptTotal)}
                </span>
                <span className="text-xs font-bold text-[var(--text-secondary)]">ج.م</span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] font-medium mt-1 truncate">
                من {metrics.completedInvoices.length} فاتورة مكتملة
              </p>
            </div>
          </div>

          {/* كارت 2: الربح التقديري (للمخولين فقط) أو عدد الفواتير لغير المخول */}
          {metrics.canViewProfit ? (
            <div className="bg-white rounded-[28px] p-4 sm:p-5 flex flex-col justify-between min-h-[124px] min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-[13px] font-bold text-[var(--text-secondary)] leading-snug">
                  الربح التقديري
                </span>
                <SectionSquareIcon groupId="reports" icon={BarChart3} />
              </div>
              <div className="mt-3">
                <div className="flex items-baseline flex-wrap gap-1">
                  <span
                    className="text-lg sm:text-xl xl:text-[22px] font-black text-[#15803D] tracking-tight tabular-nums"
                    dir="ltr"
                  >
                    {formatMoney(metrics.grossProfit ?? 0)}
                  </span>
                  <span className="text-xs font-bold text-[var(--text-secondary)]">ج.م</span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] font-medium mt-1 truncate">
                  بعد خصم تكلفة الشراء والتغليف
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-[28px] p-4 sm:p-5 flex flex-col justify-between min-h-[124px] min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-[13px] font-bold text-[var(--text-secondary)] leading-snug">
                  عدد الفواتير
                </span>
                <SectionSquareIcon groupId="sales" icon={Receipt} />
              </div>
              <div className="mt-3">
                <div className="flex items-baseline flex-wrap gap-1">
                  <span className="text-lg sm:text-xl xl:text-[22px] font-black text-[var(--text-primary)] tracking-tight tabular-nums">
                    {metrics.completedInvoices.length}
                  </span>
                  <span className="text-xs font-bold text-[var(--text-secondary)]">فاتورة</span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] font-medium mt-1 truncate">
                  من إجمالي {metrics.totalInvoicesCount} فاتورة مسجلة
                </p>
              </div>
            </div>
          )}

          {/* كارت 3: آجل معلّق */}
          <div className="bg-white rounded-[28px] p-4 sm:p-5 flex flex-col justify-between min-h-[124px] min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-[13px] font-bold text-[var(--text-secondary)] leading-snug">
                آجل معلّق
              </span>
              <SectionSquareIcon groupId="customers" icon={Users} />
            </div>
            <div className="mt-3">
              <div className="flex items-baseline flex-wrap gap-1">
                <span
                  className="text-lg sm:text-xl xl:text-[22px] font-black text-[#B45309] tracking-tight tabular-nums"
                  dir="ltr"
                >
                  {formatMoney(metrics.pendingCreditTotal)}
                </span>
                <span className="text-xs font-bold text-[var(--text-secondary)]">ج.م</span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] font-medium mt-1 truncate">
                {metrics.pendingCreditCount} فاتورة غير مسددة
              </p>
            </div>
          </div>

          {/* كارت 4: تحتاج تموين */}
          <div className="bg-white rounded-[28px] p-4 sm:p-5 flex flex-col justify-between min-h-[124px] min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-[13px] font-bold text-[var(--text-secondary)] leading-snug">
                تحتاج تموين
              </span>
              <SectionSquareIcon groupId="items" icon={Package} />
            </div>
            <div className="mt-3">
              <div className="flex items-baseline flex-wrap gap-1">
                <span className="text-lg sm:text-xl xl:text-[22px] font-black text-[#B42318] tracking-tight tabular-nums">
                  {metrics.lowStockCount}
                </span>
                <span className="text-xs font-bold text-[var(--text-secondary)]">صنف</span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] font-medium mt-1 truncate">
                {metrics.lowStockCount > 0
                  ? `رصيد 5 قطع أو أقل (من ${metrics.totalItemsCount})`
                  : 'المخزون كافٍ للجميع'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================
          الصف الثاني: الخزن (~60%) + مبيعات المنصات اليوم (~40%)
         ======================================================== */}
      {(canViewCashboxes || platformsEnabled) && (
      <section
        aria-label={platformsEnabled ? 'أرصدة الخزن ومبيعات المنصات اليوم' : 'أرصدة الخزن'}
        className="grid grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 sm:gap-5 items-stretch"
      >
        {/* 1) كارت الخزن (~60%) — يظهر فقط لمن يملك dashboard.view_cashboxes */}
        {canViewCashboxes && (
          <div className={`bg-white rounded-[28px] p-5 sm:p-6 min-w-0 flex flex-col justify-between ${!platformsEnabled ? 'min-[1100px]:col-span-2' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-extrabold text-[var(--text-primary)]">الخزن</h2>
                <button
                  type="button"
                  onClick={onRefreshCashboxes}
                  disabled={isLoadingCashboxes}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-black/5 transition cursor-pointer disabled:opacity-50"
                  title="تحديث أرصدة الخزن"
                  aria-label="تحديث أرصدة الخزن"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isLoadingCashboxes ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {dashboardCashboxes.length > 0 && (
                <div className="flex items-baseline gap-1.5 text-xs sm:text-sm font-bold text-[var(--text-secondary)]">
                  <span>الإجمالي</span>
                  <span className="font-black text-base text-[var(--text-primary)] tabular-nums" dir="ltr">
                    {totalsByCurrency
                      .map(([cur, sum]) => `${formatMoney(sum)} ${cur === 'EGP' ? 'ج.م' : cur}`)
                      .join(' • ')}
                  </span>
                </div>
              )}
            </div>

            {cashboxError && (
              <div className="mb-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
                {cashboxError}
              </div>
            )}

            {dashboardCashboxes.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-8 px-4 rounded-2xl border border-dashed border-[var(--border-color)] text-center">
                <Wallet className="w-7 h-7 text-[var(--text-secondary)] opacity-60 mb-2" />
                <p className="text-sm font-bold text-[var(--text-primary)]">
                  لا توجد خزن معيّنة لحسابك حاليًا
                </p>
              </div>
            ) : (
              <div
                className={
                  hasMoreThanThreeCashboxes
                    ? 'flex gap-3 overflow-x-auto pb-2 custom-scrollbar snap-x snap-mandatory'
                    : 'flex md:grid md:grid-cols-3 gap-3 overflow-x-auto md:overflow-visible pb-2 md:pb-0 custom-scrollbar snap-x snap-mandatory'
                }
              >
                {dashboardCashboxes.map((cb, idx) => {
                  const IconComponent = getCashboxIcon(cb.type);
                  const isInactive = cb.status === 'inactive' || (cb.status as any) === 'موقوفة';
                  const gradient = getAuroraCashboxGradient(idx, appTheme);

                  const cardClasses = `relative overflow-hidden h-[150px] rounded-[22px] p-4 text-white flex flex-col justify-between text-start transition-transform snap-start ${
                    hasMoreThanThreeCashboxes
                      ? 'shrink-0 w-[215px]'
                      : 'shrink-0 w-[215px] md:w-auto md:shrink'
                  } ${
                    canViewCashboxPage
                      ? 'cursor-pointer hover:-translate-y-0.5 active:scale-[0.99]'
                      : 'cursor-default'
                  } ${isInactive ? 'opacity-80' : ''}`;

                  const cardInner = (
                    <>
                      {/* حلقة شفافة للزينة */}
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute -top-12 -left-10 w-36 h-36 rounded-full border-[18px] border-white/12"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute -bottom-16 -left-4 w-32 h-32 rounded-full bg-white/8"
                      />

                      <div className="relative z-10 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold text-white truncate" title={cb.name}>
                            {cb.name}
                          </div>
                          <div className="text-[11px] font-semibold text-white/80 truncate mt-0.5">
                            {cb.type || 'خزنة نقدية'}
                            {isInactive ? ' · موقوفة' : ''}
                          </div>
                        </div>
                        <span
                          aria-hidden="true"
                          className="w-9 h-9 rounded-[11px] bg-white/18 border border-white/25 flex items-center justify-center shrink-0"
                        >
                          <IconComponent className="w-[18px] h-[18px] text-white" />
                        </span>
                      </div>

                      <div className="relative z-10 flex items-baseline gap-1.5">
                        <span className="text-xl xl:text-[22px] font-black text-white tracking-tight tabular-nums" dir="ltr">
                          {formatMoney(cb.currentBalance || 0)}
                        </span>
                        <span className="text-xs font-bold text-white/85">
                          {cb.currency === 'EGP' ? 'ج.م' : cb.currency}
                        </span>
                      </div>
                    </>
                  );

                  if (canViewCashboxPage) {
                    return (
                      <a
                        key={cb.id}
                        href={getHrefForTarget('cashboxes', 'TRANSACTIONS', {
                          searchParams: { cashboxId: cb.id }
                        })}
                        onClick={(e) => {
                          if (!isPlainLeftClick(e)) return;
                          e.preventDefault();
                          onNavigate('cashboxes', 'TRANSACTIONS', {
                            searchParams: { cashboxId: cb.id }
                          });
                        }}
                        className={cardClasses}
                        style={{
                          background: gradient,
                          boxShadow: '0 14px 28px -10px rgba(15, 23, 42, 0.25)'
                        }}
                        title={`عرض حركات ${cb.name}`}
                      >
                        {cardInner}
                      </a>
                    );
                  }

                  return (
                    <div
                      key={cb.id}
                      className={cardClasses}
                      style={{
                        background: gradient,
                        boxShadow: '0 14px 28px -10px rgba(15, 23, 42, 0.25)'
                      }}
                      title={cb.name}
                    >
                      {cardInner}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 2) كارت مبيعات المنصات اليوم (~40%) */}
        {platformsEnabled && (
        <div
          className={`bg-white rounded-[28px] p-5 sm:p-6 min-w-0 flex flex-col justify-between ${
            !canViewCashboxes ? 'min-[1100px]:col-span-2' : ''
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="text-base font-extrabold text-[var(--text-primary)]">
              مبيعات المنصات اليوم
            </h2>
            {platformSalesToday.length > 0 && (
              <span className="text-xs font-bold text-[var(--text-secondary)] tabular-nums">
                {platformSalesToday.reduce((s, p) => s + p.ordersCount, 0)} طلب
              </span>
            )}
          </div>

          {platformSalesToday.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8 px-4 rounded-2xl border border-dashed border-[var(--border-color)] text-center">
              <Globe2 className="w-7 h-7 text-[var(--text-secondary)] opacity-60 mb-2" />
              <p className="text-sm font-bold text-[var(--text-primary)]">
                لا توجد مبيعات مسجلة على المنصات اليوم
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {platformSalesToday.map(plt => (
                <div key={plt.id} className="grid grid-cols-[minmax(76px,auto)_1fr_auto] items-center gap-3">
                  <span className="text-xs sm:text-[13px] font-bold text-[var(--text-primary)] truncate" title={plt.name}>
                    {plt.name}
                  </span>
                  <div className="w-full h-2.5 rounded-full bg-slate-200/70 overflow-hidden flex justify-start">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${plt.widthPct}%`,
                        background: 'var(--brand-gradient)'
                      }}
                    />
                  </div>
                  <span
                    className="text-xs sm:text-[13px] font-extrabold text-[var(--text-primary)] tabular-nums whitespace-nowrap"
                    dir="ltr"
                  >
                    {formatMoney(plt.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </section>
      )}

      {/* ========================================================
          الصف الثالث: آخر الفواتير (~60%) + إجراءات سريعة وتنبيه النواقص (~40%)
         ======================================================== */}
      <section
        aria-label="آخر الفواتير والإجراءات السريعة"
        className="grid grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 sm:gap-5 items-stretch"
      >
        {/* 3) كارت آخر الفواتير (~60%) — جدول بخلفية واضحة وأرقام متساوية العرض */}
        <div className="bg-white rounded-[28px] p-5 sm:p-6 min-w-0 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="text-base font-extrabold text-[var(--text-primary)]">آخر الفواتير</h2>
            {metrics.canViewInvoices && (
              <a
                href={getHrefForTarget('invoices')}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return;
                  e.preventDefault();
                  onNavigate('invoices');
                }}
                className="inline-flex items-center gap-1 text-xs font-extrabold cursor-pointer hover:underline min-h-[44px] px-2 -my-2 whitespace-nowrap shrink-0"
                style={{ color: 'var(--primary-on-white, var(--primary))' }}
              >
                <span>عرض السجل</span>
                <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
              </a>
            )}
          </div>

          {recentInvoices.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8 px-4 rounded-2xl border border-dashed border-[var(--border-color)] text-center">
              <Receipt className="w-7 h-7 text-[var(--text-secondary)] opacity-60 mb-2" />
              <p className="text-sm font-bold text-[var(--text-primary)]">
                لا توجد فواتير مسجلة حتى الآن
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-xs sm:text-[13px] border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-color)]">
                    <th className="py-2.5 px-3 text-start font-bold whitespace-nowrap first:rounded-tr-xl">رقم الفاتورة</th>
                    <th className="py-2.5 px-3 text-start font-bold whitespace-nowrap">{platformsEnabled ? 'المنصة' : 'العميل / المصدر'}</th>
                    <th className="py-2.5 px-3 text-end font-bold whitespace-nowrap">الإجمالي</th>
                    <th className="py-2.5 px-3 text-end font-bold whitespace-nowrap">الصافي</th>
                    <th className="py-2.5 px-3 text-center font-bold whitespace-nowrap last:rounded-tl-xl">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {recentInvoices.map(inv => {
                    const badge = getInvoiceStatusBadge(inv);
                    const badgeStyles =
                      badge.tone === 'emerald'
                        ? 'bg-[#DCFCE7] text-[#15803D]'
                        : badge.tone === 'amber'
                        ? 'bg-[#FEF3C7] text-[#B45309]'
                        : badge.tone === 'rose'
                        ? 'bg-[#FEE2E2] text-[#B91C1C]'
                        : 'bg-slate-100 text-slate-700';

                    const grossAmount = inv.totalBeforeDiscount ?? inv.netAmount ?? 0;

                    return (
                      <tr
                        key={inv.invoiceNumber}
                        onClick={() => onOpenInvoiceDetails(inv)}
                        className="hover:bg-slate-50/80 transition cursor-pointer"
                      >
                        <td className="py-3 px-2 font-bold text-[var(--text-primary)] tabular-nums whitespace-nowrap" dir="ltr">
                          <span className="block text-right">{inv.invoiceNumber}</span>
                        </td>
                        <td className="py-3 px-2 font-semibold text-[var(--text-secondary)] whitespace-nowrap max-w-[140px] truncate" title={inv.customerName || inv.platformName || inv.platform}>
                          {platformsEnabled
                            ? inv.platformName || inv.platform || '—'
                            : inv.customerName || inv.platformName || inv.platform || 'مباشر'}
                        </td>
                        <td className="py-3 px-2 font-bold text-[var(--text-primary)] tabular-nums text-end whitespace-nowrap" dir="ltr">
                          {formatMoney(grossAmount)}
                        </td>
                        <td className="py-3 px-2 font-extrabold text-[#15803D] tabular-nums text-end whitespace-nowrap" dir="ltr">
                          {formatMoney(inv.netAmount || 0)}
                        </td>
                        <td className="py-3 px-2 text-center whitespace-nowrap">
                          <span
                            className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${badgeStyles}`}
                          >
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 4) كارت إجراءات سريعة + شريط تنبيه نواقص المخزون (~40%) */}
        <div className="bg-white rounded-[28px] p-5 sm:p-6 min-w-0 flex flex-col justify-between gap-4">
          <div>
            <h2 className="text-base font-extrabold text-[var(--text-primary)] mb-4">
              إجراءات سريعة
            </h2>

            {quickActions.length === 0 ? (
              <div className="py-6 px-4 rounded-2xl border border-dashed border-[var(--border-color)] text-center">
                <p className="text-sm font-bold text-[var(--text-secondary)]">
                  لا توجد إجراءات سريعة متاحة لصلاحيات حسابك
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {quickActions.map(action => {
                  const IconComponent = QUICK_ACTION_ICONS[action.id];
                  return (
                    <a
                      key={action.id}
                      href={getHrefForTarget(action.page, action.tab)}
                      onClick={(e) => {
                        if (!isPlainLeftClick(e)) return;
                        e.preventDefault();
                        onNavigate(action.page, action.tab);
                      }}
                      className="flex items-center gap-3 p-3 rounded-2xl border border-[var(--border-color)] bg-slate-50/75 hover:bg-slate-100/90 transition text-start cursor-pointer min-h-[56px] min-w-0"
                    >
                      <SectionSquareIcon groupId={action.groupId} icon={IconComponent} />
                      <span className="text-xs sm:text-[13px] font-extrabold text-[var(--text-primary)] leading-snug truncate">
                        {action.label}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* شريط التنبيه الأحمر الحالي لنواقص المخزون — يظهر فقط عند وجود نواقص */}
          {metrics.lowStockCount > 0 && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="p-1.5 rounded-xl bg-rose-100 text-rose-600 shrink-0 mt-0.5">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-[13px] font-extrabold text-rose-900">
                    تنبيه: يوجد {metrics.lowStockCount} أصناف وصلت للحد الأدنى (5 قطع أو أقل)!
                  </h3>
                  <p className="text-[11px] text-rose-700 mt-0.5">
                    {platformsEnabled
                      ? 'يرجى إعادة تموين المنتجات لتجنب نفادها على المنصات.'
                      : 'يرجى إعادة تموين المنتجات لتجنب نفاد المخزون.'}
                  </p>
                </div>
              </div>
              <a
                href={getHrefForTarget('items', 'LOW_STOCK')}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return;
                  e.preventDefault();
                  onNavigate('items', 'LOW_STOCK');
                }}
                className="inline-flex items-center px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition cursor-pointer shrink-0 min-h-[44px] whitespace-nowrap"
              >
                معاينة الأصناف
              </a>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PageType, Platform, Item, Invoice, SystemConfig, ReportsData, UserRole, UserAccount, DashboardCashbox, AppTheme } from '../types';
import { api } from '../api/client';
import { hasPermission } from '../utils/permissions';
import { DashboardAurora } from '../components/DashboardAurora';
import { PrintHeader } from '../components/ui';
import { getHrefForTarget, getHrefForItemRoute, isPlainLeftClick } from '../config/navigation';
import {
  TrendingUp,
  ShoppingCart,
  Package,
  AlertTriangle,
  Receipt,
  PlusCircle,
  ArrowUpRight,
  ShieldCheck,
  ChevronLeft,
  Database,
  Shield,
  Wallet,
  Landmark,
  Smartphone,
  ArrowLeftRight,
  RotateCw
} from 'lucide-react';

interface DashboardPageProps {
  reports: ReportsData | null;
  items: Item[];
  platforms: Platform[];
  invoices: Invoice[];
  config: SystemConfig;
  userRole: UserRole;
  user?: UserAccount | null;
  appTheme?: AppTheme;
  onNavigate: (
    page: PageType,
    tab?: string,
    options?: { searchParams?: Record<string, string | undefined> }
  ) => void;
  onOpenProductModal: (item?: Item) => void;
  onOpenInvoiceDetails: (inv: Invoice) => void;
  platformsEnabled?: boolean;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  reports,
  items,
  platforms,
  invoices,
  config,
  userRole,
  user,
  appTheme,
  onNavigate,
  onOpenProductModal,
  onOpenInvoiceDetails,
  platformsEnabled = true
}) => {
  const isAuroraTheme = appTheme === 'aurora' || appTheme === 'aurora-sky';
  const isManager = userRole === 'manager' || userRole === 'designer';

  const completedInvoices = invoices.filter(i => i.status === 'تم البيع');
  const totalRevenue = completedInvoices.reduce((s, i) => s + (i.netAmount || 0), 0);

  let totalCost: number | undefined = undefined;
  let grossProfit: number | undefined = undefined;

  if (isManager) {
    let costSum = 0;
    for (const inv of completedInvoices) {
      for (const line of (inv.lines || [])) {
        costSum += ((line.purchasePriceAtSale || 0) + (line.packagingCostAtSale || 0)) * (line.quantity || 1);
      }
    }
    totalCost = costSum;
    grossProfit = totalRevenue - totalCost;
  }

  const lowStockItems = items.filter(p => p.status !== 'inactive' && p.stockQuantity <= 5);
  const recentInvoices = invoices.slice(0, 5);

  // التحقق من صلاحية عرض قسم الخزن في لوحة التحكم
  const canViewCashboxes =
    user?.role === 'designer' ||
    Boolean(user?.isOwner) ||
    hasPermission(user, 'dashboard.view_cashboxes');

  const canViewCashboxPage =
    user?.role === 'designer' ||
    Boolean(user?.isOwner) ||
    hasPermission(user, 'cashbox.view');

  const [dashboardCashboxes, setDashboardCashboxes] = useState<DashboardCashbox[]>([]);
  const [isLoadingCashboxes, setIsLoadingCashboxes] = useState(false);
  const [cashboxError, setCashboxError] = useState<string | null>(null);

  const loadDashboardCashboxes = useCallback(async () => {
    if (!canViewCashboxes) return;
    setIsLoadingCashboxes(true);
    setCashboxError(null);
    try {
      const res = await api.getDashboardCashboxes();
      if (res.success && Array.isArray(res.cashboxes)) {
        setDashboardCashboxes(res.cashboxes);
      } else if (res.error) {
        setCashboxError(res.error);
      }
    } catch (err: any) {
      setCashboxError(err.message || 'فشل جلب أرصدة الخزن');
    } finally {
      setIsLoadingCashboxes(false);
    }
  }, [canViewCashboxes]);

  useEffect(() => {
    loadDashboardCashboxes();
  }, [loadDashboardCashboxes, invoices]);

  // إجمالي الخزن المعروضة لكل عملة
  const totalsByCurrency = useMemo(() => {
    const map: Record<string, number> = {};
    dashboardCashboxes.forEach((c) => {
      const cur = c.currency || 'EGP';
      map[cur] = (map[cur] || 0) + (c.currentBalance || 0);
    });
    return Object.entries(map);
  }, [dashboardCashboxes]);

  const getCashboxIcon = (type?: string) => {
    const t = type || '';
    if (t.includes('بنك') || t.includes('بنكي')) return Landmark;
    if (t.includes('محفظة') || t.includes('إلكترونية')) return Smartphone;
    if (t.includes('وسيطة') || t.includes('وسيط')) return ArrowLeftRight;
    return Wallet;
  };

  const canManageBackup =
    user?.role === 'designer' ||
    Boolean(user?.isOwner) ||
    hasPermission(user, 'settings.backup');

  const [showBackupReminder, setShowBackupReminder] = useState(false);

  useEffect(() => {
    let active = true;
    if (config.persistenceMode !== 'supabase' || !canManageBackup) {
      setShowBackupReminder(false);
      return;
    }
    api.getBackupStatus()
      .then((res) => {
        if (!active || !res?.success) return;
        const lastAt = res.backup?.lastBackupAt;
        if (!lastAt) {
          setShowBackupReminder(true);
          return;
        }
        const ts = new Date(lastAt).getTime();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        setShowBackupReminder(Number.isNaN(ts) || Date.now() - ts > sevenDaysMs);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [config.persistenceMode, canManageBackup]);

  return (
    <div className="space-y-6 pb-12" dir="rtl">
      <PrintHeader title="لوحة التحكم والمبيعات" />
      {showBackupReminder && config.persistenceMode === 'supabase' && canManageBackup && (
        <div
          role="status"
          className="no-print p-3.5 sm:p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 text-xs sm:text-sm font-bold">
            <Database className="w-4 h-4 text-amber-700 shrink-0" />
            <span>مرّ أكثر من 7 أيام على آخر نسخة احتياطية</span>
          </div>
          <a
            href={getHrefForTarget('settings', 'backup')}
            onClick={(e) => {
              if (!isPlainLeftClick(e)) return;
              e.preventDefault();
              onNavigate('settings', 'backup');
            }}
            className="min-h-[40px] inline-flex items-center px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition self-start sm:self-auto cursor-pointer shrink-0"
          >
            الانتقال لقسم النسخ الاحتياطي
          </a>
        </div>
      )}
      {isAuroraTheme ? (
        <DashboardAurora
          items={items}
          platforms={platforms}
          invoices={invoices}
          userRole={userRole}
          user={user}
          appTheme={appTheme}
          canViewCashboxes={canViewCashboxes}
          canViewCashboxPage={canViewCashboxPage}
          dashboardCashboxes={dashboardCashboxes}
          isLoadingCashboxes={isLoadingCashboxes}
          cashboxError={cashboxError}
          totalsByCurrency={totalsByCurrency}
          onRefreshCashboxes={loadDashboardCashboxes}
          onNavigate={onNavigate}
          onOpenProductModal={onOpenProductModal}
          onOpenInvoiceDetails={onOpenInvoiceDetails}
          platformsEnabled={platformsEnabled}
        />
      ) : (
        <>
      {/* Top Welcome Bar */}
      <div className="bg-gradient-to-r from-[#164E72] via-[#1678C2] to-[#164E72] rounded-3xl p-6 sm:p-8 text-white shadow-lg shadow-sky-950/10 relative overflow-hidden border border-[#D9E8F3]/30">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-white/20 text-white text-xs font-bold border border-white/30 backdrop-blur-xs">
                {platformsEnabled ? 'منظومة نقاط البيع والمنصات' : 'منظومة نقاط البيع والمخزون'}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                isManager ? 'bg-[#E8A83E]/20 text-[#E8A83E] border border-[#E8A83E]/40' : 'bg-white/10 text-sky-100'
              }`}>
                {isManager ? 'صلاحيات المدير العام (كامل التكاليف والأرباح)' : 'صلاحيات موظف (حجب التكاليف والأرباح)'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold mt-2 tracking-tight text-white">
              لوحة التحكم والمبيعات
            </h1>
            <p className="text-sky-100/90 text-xs sm:text-sm mt-1 max-w-xl leading-relaxed">
              {platformsEnabled
                ? 'إدارة موحدة للمخزون، المبيعات الفورية، واحتساب نسب المنصات مع قاعدة البيانات.'
                : 'إدارة موحدة للمخزون، المبيعات الفورية، والفواتير مع قاعدة البيانات.'}
            </p>
          </div>

          <div className="no-print flex flex-wrap items-center gap-3">
            <a
              href={getHrefForTarget('pos')}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return;
                e.preventDefault();
                onNavigate('pos');
              }}
              className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white text-[#164E72] hover:bg-sky-50 font-extrabold text-sm shadow-md transition-all active:scale-95 cursor-pointer min-h-[48px]"
            >
              <ShoppingCart className="w-5 h-5 text-[#1678C2]" />
              <span>فاتورة بيع جديدة</span>
            </a>

            {isManager && (
              <a
                href={getHrefForItemRoute('new')}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return;
                  e.preventDefault();
                  onOpenProductModal();
                }}
                className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-[#164E72]/80 hover:bg-[#164E72] text-white font-bold text-sm border border-white/20 transition cursor-pointer min-h-[48px]"
              >
                <PlusCircle className="w-4 h-4 text-[#42BDE5]" />
                <span>إضافة صنف</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Critical Stock Alerts Banner */}
      {lowStockItems.length > 0 && (
        <div className="no-print p-4 sm:p-5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-rose-100 text-rose-600 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-rose-900">
                تنبيه: يوجد {lowStockItems.length} أصناف وصلت للحد الأدنى (5 قطع أو أقل)!
              </h3>
              <p className="text-xs text-rose-700 mt-0.5">
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
            className="inline-flex items-center px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition self-start sm:self-auto cursor-pointer shrink-0"
          >
            معاينة الأصناف
          </a>
        </div>
      )}

      {/* Key Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Revenue */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">إجمالي المبيعات</span>
            <div className="p-2.5 rounded-xl bg-cyan-50 text-cyan-700">
              <Receipt className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight font-mono">
              {totalRevenue.toLocaleString('ar-EG')} <span className="text-sm font-bold text-slate-500">ج.م</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-emerald-600 font-semibold">
              <ArrowUpRight className="w-4 h-4" />
              <span>مبيعات محققة عبر الفواتير</span>
            </div>
          </div>
        </div>

        {/* Profit Card - Manager Only */}
        {isManager ? (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">الربح الإجمالي (خاص بالمدير)</span>
              <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-extrabold text-emerald-700 tracking-tight font-mono">
                {(grossProfit || 0).toLocaleString('ar-EG')} <span className="text-sm font-bold text-slate-500">ج.م</span>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                بعد خصم تكلفة الشراء والتغليف
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">الطلبات المنفذة</span>
              <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-700">
                <ShoppingCart className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-extrabold text-slate-900 tracking-tight font-mono">
                {completedInvoices.length} <span className="text-sm font-bold text-slate-500">طلب</span>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                عمليات بيع ناجحة مسجلة
              </p>
            </div>
          </div>
        )}

        {/* Invoices Count */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">إجمالي الفواتير الصادرة</span>
            <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-700">
              <ShoppingCart className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight font-mono">
              {invoices.length} <span className="text-sm font-bold text-slate-500">فاتورة</span>
            </div>
            <p className="text-xs text-slate-500 mt-1.5">
              محدثة في ورقة Invoices
            </p>
          </div>
        </div>

        {/* Stock Items Count */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">الأصناف المسجلة (Items)</span>
            <div className="p-2.5 rounded-xl bg-teal-50 text-teal-700">
              <Package className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight font-mono">
              {items.length} <span className="text-sm font-bold text-slate-500">صنف</span>
            </div>
            <div className="flex items-center gap-1 text-xs mt-1.5">
              {lowStockItems.length > 0 ? (
                <span className="font-bold text-rose-600">{lowStockItems.length} بحاجة تموين</span>
              ) : (
                <span className="text-emerald-600 font-semibold">المخزون كافٍ</span>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* قسم أرصدة الخزن المخصصة (يظهر فقط لمن يملك الصلاحية) */}
      {canViewCashboxes && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-sky-50 text-[#1678C2] shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-extrabold text-slate-900">الخزن</h2>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-100">
                    أرصدة مخصصة
                  </span>
                </div>
                {dashboardCashboxes.length > 0 && (
                  <p className="text-xs font-semibold text-slate-500 mt-1">
                    إجمالي الخزن المعروضة:{' '}
                    <span className="font-extrabold text-slate-900 font-mono">
                      {totalsByCurrency
                        .map(
                          ([cur, sum]) =>
                            `${sum.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })} ${cur === 'EGP' ? 'ج.م' : cur}`
                        )
                        .join(' • ')}
                    </span>
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => loadDashboardCashboxes()}
              disabled={isLoadingCashboxes}
              className="no-print flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer self-start sm:self-auto disabled:opacity-50"
              title="تحديث أرصدة الخزن"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isLoadingCashboxes ? 'animate-spin text-[#1678C2]' : ''}`} />
              <span>تحديث</span>
            </button>
          </div>

          {cashboxError && (
            <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
              {cashboxError}
            </div>
          )}

          {dashboardCashboxes.length === 0 ? (
            <div className="p-8 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center mt-4">
              <Wallet className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-600">لا توجد خزن معيّنة لك</p>
              <p className="text-xs text-slate-400 mt-1">تواصل مع إدارة النظام لتعيين خزائن لحسابك</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-4">
              {dashboardCashboxes.map((cb) => {
                const IconComponent = getCashboxIcon(cb.type);
                const isNegative = (cb.currentBalance || 0) < 0;
                const isInactive = cb.status === 'inactive' || (cb.status as any) === 'موقوفة';

                const cardBody = (
                  <>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="p-2.5 rounded-xl bg-slate-100 text-slate-700 shrink-0">
                        <IconComponent className="w-5 h-5" />
                      </div>
                      {isInactive && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 shrink-0">
                          موقوفة
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <h3 className="font-bold text-xs sm:text-sm text-slate-800 truncate" title={cb.name}>
                        {cb.name}
                      </h3>

                      <div
                        className={`text-lg sm:text-2xl font-black font-mono tracking-tight mt-2 ${
                          isNegative ? 'text-rose-600' : 'text-slate-900'
                        }`}
                        dir="ltr"
                      >
                        {(cb.currentBalance || 0).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}{' '}
                        <span className="text-xs sm:text-sm font-bold text-slate-500">
                          {cb.currency === 'EGP' ? 'ج.م' : cb.currency}
                        </span>
                      </div>

                      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                        <span className="text-slate-500 font-semibold">{cb.permissionType || 'إيداع وسحب'}</span>
                        {canViewCashboxPage && (
                          <span className="text-[#1678C2] font-bold text-[10px]">عرض الحركات ›</span>
                        )}
                      </div>
                    </div>
                  </>
                );

                const cardClasses = `bg-white p-4 sm:p-5 rounded-2xl border transition relative flex flex-col justify-between ${
                  canViewCashboxPage
                    ? 'cursor-pointer hover:border-[#1678C2] hover:shadow-md active:scale-[0.99] border-slate-200/90'
                    : 'cursor-default border-slate-200/70'
                } ${isInactive ? 'bg-slate-50/70 opacity-80' : ''}`;

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
                      title={`عرض حركات ${cb.name}`}
                    >
                      {cardBody}
                    </a>
                  );
                }

                return (
                  <div
                    key={cb.id}
                    className={cardClasses}
                    title={cb.name}
                  >
                    {cardBody}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Platforms Performance Overview */}
      {platformsEnabled && (
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">أداء مبيعات المنصات</h2>
            <p className="text-xs text-slate-500 mt-0.5">تفصيل الإيرادات ونسب الخصم لكل منصة</p>
          </div>
          <a
            href={getHrefForTarget('platforms', 'platforms')}
            onClick={(e) => {
              if (!isPlainLeftClick(e)) return;
              e.preventDefault();
              onNavigate('platforms', 'platforms');
            }}
            className="no-print flex items-center gap-1 text-xs font-bold text-cyan-700 hover:text-cyan-800 cursor-pointer"
          >
            <span>إدارة المنصات</span>
            <ChevronLeft className="w-4 h-4" />
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
          {platforms.map(plt => {
            const pltInvoices = completedInvoices.filter(i => i.platform.toLowerCase().includes(plt.name.toLowerCase()) || i.platform.toLowerCase().includes(plt.id));
            const rev = pltInvoices.reduce((s, i) => s + i.netAmount, 0);

            return (
              <div
                key={plt.id}
                className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-slate-800">{plt.name}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                    خصم {plt.discountPercentage}%
                  </span>
                </div>
                <div className="text-xs text-slate-600 space-y-1">
                  <div className="flex justify-between">
                    <span>المبيعات:</span>
                    <span className="font-bold text-slate-900 font-mono">{rev.toLocaleString('ar-EG')} ج.م</span>
                  </div>
                  <div className="flex justify-between">
                    <span>الطلبات:</span>
                    <span className="font-semibold">{pltInvoices.length} طلب</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

        </>
      )}
    </div>
  );
};

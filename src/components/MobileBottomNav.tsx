import React, { useState } from 'react';
import { AppTheme, PageType, UserAccount } from '../types';
import { hasPermission } from '../utils/permissions';
import {
  NAV_GROUPS,
  getNavGroupColors,
  isGroupVisible,
  isSubItemVisible,
  isPageAllowedByFeatureModes,
  getHrefForTarget,
  isPlainLeftClick,
  type FeatureModeFlags
} from '../config/navigation';
import {
  LayoutDashboard,
  LayoutGrid,
  ShoppingCart,
  Package,
  Receipt,
  MoreHorizontal,
  BarChart3,
  ChevronDown,
  X
} from 'lucide-react';

interface MobileBottomNavProps {
  currentPage: PageType;
  currentTab?: string;
  onNavigate: (page: PageType, tab?: string) => void;
  user: UserAccount | null;
  lowStockCount: number;
  onOpenMobileMenu?: () => void;
  appTheme?: AppTheme;
  featureFlags?: FeatureModeFlags;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentPage,
  currentTab,
  onNavigate,
  user,
  lowStockCount,
  onOpenMobileMenu,
  appTheme,
  featureFlags
}) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const isAurora = appTheme === 'aurora' || appTheme === 'aurora-sky';

  // في شاشة نقطة البيع على الموبايل يظهر شريط تبويبات نقطة البيع بدلاً من MobileBottomNav لمنع تراكب الشريطين
  if (currentPage === 'pos') {
    return null;
  }

  const canViewDashboard =
    isPageAllowedByFeatureModes('dashboard', undefined, featureFlags) &&
    hasPermission(user, 'dashboard.view');
  const canCreateInvoice =
    isPageAllowedByFeatureModes('pos', undefined, featureFlags) &&
    hasPermission(user, 'invoices.create');
  const canViewItems =
    isPageAllowedByFeatureModes('items', 'ALL', featureFlags) &&
    hasPermission(user, 'items.view');
  const canViewInvoices =
    isPageAllowedByFeatureModes('invoices', undefined, featureFlags) &&
    hasPermission(user, 'invoices.view');
  const canViewReports =
    isPageAllowedByFeatureModes('reports', 'FINANCIAL', featureFlags) &&
    hasPermission(user, 'reports.view_reports');

  const mainTabs: Array<{ id: PageType; label: string; icon: React.ReactNode; isFab?: boolean; visible: boolean }> = [
    {
      id: 'dashboard',
      label: 'الرئيسية',
      icon: <LayoutDashboard className="w-5 h-5" />,
      visible: canViewDashboard
    },
    {
      id: 'items',
      label: 'الأصناف',
      icon: <Package className="w-5 h-5" />,
      visible: canViewItems
    },
    {
      id: 'pos',
      label: 'نقطة البيع',
      icon: <ShoppingCart className="w-6 h-6" />,
      isFab: true,
      visible: canCreateInvoice
    },
    {
      id: 'invoices',
      label: 'الفواتير',
      icon: <Receipt className="w-5 h-5" />,
      visible: canViewInvoices
    }
  ];

  const visibleGroups = NAV_GROUPS.filter((g) => isGroupVisible(g, user, featureFlags));

  const auroraTabs: Array<{
    id: PageType;
    label: string;
    groupId: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    isFab?: boolean;
    visible: boolean;
  }> = [
    {
      id: 'dashboard',
      label: 'الرئيسية',
      groupId: 'dashboard',
      icon: LayoutGrid,
      visible: canViewDashboard
    },
    {
      id: 'items',
      label: 'الأصناف',
      groupId: 'items',
      icon: Package,
      visible: canViewItems
    },
    {
      id: 'pos',
      label: 'نقطة البيع',
      groupId: 'sales',
      icon: ShoppingCart,
      isFab: true,
      visible: canCreateInvoice
    },
    {
      id: 'reports',
      label: 'التقارير',
      groupId: 'reports',
      icon: BarChart3,
      visible: canViewReports
    }
  ];

  return (
    <>
      {isAurora ? (
        <nav
          className="no-print aurora-mobile-bottom-nav md:hidden fixed z-40 rounded-[26px] h-[72px] px-2 flex items-center justify-around"
          style={{
            left: '14px',
            right: '14px',
            bottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
            backgroundColor: 'var(--glass-bg)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            backdropFilter: 'var(--glass-blur)',
            border: '1px solid var(--glass-border)',
            boxShadow: 'var(--glass-shadow)'
          }}
          dir="rtl"
          aria-label="شريط التنقل السفلي"
        >
          {auroraTabs
            .filter(t => t.visible)
            .map(tab => {
              const isActive = currentPage === tab.id;
              const TabIcon = tab.icon;
              const tabHref = getHrefForTarget(tab.id, undefined, { user, flags: featureFlags });

              if (tab.isFab) {
                return (
                  <a
                    key={tab.id}
                    href={tabHref}
                    onClick={(e) => {
                      if (!isPlainLeftClick(e)) return;
                      e.preventDefault();
                      setShowMoreMenu(false);
                      onNavigate(tab.id);
                    }}
                    className="relative -top-3.5 flex items-center justify-center shrink-0 cursor-pointer group px-1 no-underline"
                    aria-label="نقطة البيع"
                    title="نقطة البيع"
                  >
                    <div
                      className="w-[58px] h-[58px] rounded-[22px] flex items-center justify-center text-white border-[4px] border-white active:scale-95 transition-transform"
                      style={{
                        background: 'var(--brand-gradient)',
                        boxShadow:
                          appTheme === 'aurora-sky'
                            ? '0 12px 26px rgba(10, 95, 194, 0.34)'
                            : '0 12px 26px rgba(109, 40, 217, 0.34)'
                      }}
                    >
                      <TabIcon className="w-6 h-6 text-white" strokeWidth={2.2} />
                    </div>
                  </a>
                );
              }

              const palette = getNavGroupColors(tab.groupId);

              return (
                <a
                  key={tab.id}
                  href={tabHref}
                  onClick={(e) => {
                    if (!isPlainLeftClick(e)) return;
                    e.preventDefault();
                    setShowMoreMenu(false);
                    onNavigate(tab.id);
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className="flex flex-col items-center justify-center flex-1 min-h-[48px] px-1 transition-colors cursor-pointer no-underline"
                >
                  <div className="relative flex items-center justify-center">
                    {isActive ? (
                      <span
                        className="w-8 h-8 rounded-[11px] flex items-center justify-center text-white"
                        style={{
                          background: `linear-gradient(135deg, ${palette.primary} 0%, ${palette.dark} 100%)`,
                          boxShadow: `0 6px 14px ${hexToRgba(palette.primary, 0.30)}`
                        }}
                      >
                        <TabIcon className="w-[17px] h-[17px] text-white" strokeWidth={2.2} />
                      </span>
                    ) : (
                      <span className="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)]">
                        <TabIcon className="w-5 h-5" strokeWidth={1.9} />
                      </span>
                    )}

                    {tab.id === 'items' && lowStockCount > 0 && (
                      <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center border border-white">
                        {lowStockCount}
                      </span>
                    )}
                  </div>

                  <span
                    className={`text-[11px] mt-0.5 leading-tight ${
                      isActive ? 'font-extrabold' : 'font-semibold text-[var(--text-secondary)]'
                    }`}
                    style={isActive ? { color: 'var(--primary-on-white, var(--primary))' } : undefined}
                  >
                    {tab.label}
                  </span>
                </a>
              );
            })}

          <button
            type="button"
            onClick={() => {
              if (onOpenMobileMenu) {
                onOpenMobileMenu();
              } else {
                setShowMoreMenu(!showMoreMenu);
              }
            }}
            className="flex flex-col items-center justify-center flex-1 min-h-[48px] px-1 transition-colors cursor-pointer"
            aria-label="المزيد"
          >
            <span
              className={`w-8 h-8 flex items-center justify-center ${
                showMoreMenu ? 'text-[var(--primary-on-white)]' : 'text-[var(--text-secondary)]'
              }`}
            >
              <MoreHorizontal className="w-5 h-5" strokeWidth={2} />
            </span>
            <span
              className={`text-[11px] mt-0.5 leading-tight ${
                showMoreMenu ? 'font-extrabold' : 'font-semibold text-[var(--text-secondary)]'
              }`}
              style={showMoreMenu ? { color: 'var(--primary-on-white, var(--primary))' } : undefined}
            >
              المزيد
            </span>
          </button>
        </nav>
      ) : (
        <nav className="no-print md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#164E72] border-t border-sky-800/60 shadow-xl px-2 py-1.5 flex items-center justify-around h-16 safe-area-pb" dir="rtl">
          {mainTabs.filter(t => t.visible).map((tab) => {
            const isActive = currentPage === tab.id;
            const tabHref = getHrefForTarget(tab.id, undefined, { user, flags: featureFlags });

            if (tab.isFab) {
              return (
                <a
                  key={tab.id}
                  href={tabHref}
                  onClick={(e) => {
                    if (!isPlainLeftClick(e)) return;
                    e.preventDefault();
                    setShowMoreMenu(false);
                    onNavigate(tab.id);
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className="relative -top-4 flex flex-col items-center justify-center cursor-pointer group no-underline"
                >
                  <div className="w-14 h-14 rounded-full bg-[#1678C2] shadow-lg shadow-sky-900/50 flex items-center justify-center text-white active:scale-95 transition-transform border-2 border-white">
                    {tab.icon}
                  </div>
                  <span className="text-[11px] font-bold text-[#42BDE5] mt-0.5">بيع</span>
                </a>
              );
            }

            return (
              <a
                key={tab.id}
                href={tabHref}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return;
                  e.preventDefault();
                  setShowMoreMenu(false);
                  onNavigate(tab.id);
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center justify-center flex-1 min-h-[48px] px-1 transition-colors cursor-pointer no-underline ${
                  isActive ? 'text-[#42BDE5] font-bold' : 'text-sky-200/70 hover:text-white'
                }`}
              >
                <div className="relative">
                  {tab.icon}
                  {tab.id === 'items' && lowStockCount > 0 && (
                    <span className="absolute -top-1 -right-2 w-4 h-4 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center">
                      {lowStockCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] mt-1">{tab.label}</span>
              </a>
            );
          })}

          <button
            onClick={() => {
              if (onOpenMobileMenu) {
                onOpenMobileMenu();
              } else {
                setShowMoreMenu(!showMoreMenu);
              }
            }}
            className={`flex flex-col items-center justify-center flex-1 min-h-[48px] px-1 transition-colors cursor-pointer ${
              showMoreMenu ? 'text-[#42BDE5] font-bold' : 'text-sky-200/70 hover:text-white'
            }`}
            aria-label="القائمة الرئيسية"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] mt-1">القائمة</span>
          </button>
        </nav>
      )}

      {showMoreMenu && (
        <div className="no-print md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs" dir="rtl">
          <div className="bg-white rounded-t-3xl p-5 shadow-2xl text-slate-800 animate-in slide-in-from-bottom duration-200 max-h-[calc(85vh/var(--app-zoom,1))] overflow-y-auto">
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
              <h3 className="font-bold text-base text-slate-900">الأقسام والصفحات</h3>
              <button
                type="button"
                onClick={() => setShowMoreMenu(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 bg-slate-100 cursor-pointer"
                aria-label="إغلاق القائمة"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {visibleGroups.map((group) => {
                const subItems = group.subItems.filter((sub) => isSubItemVisible(sub, user, featureFlags));
                if (subItems.length === 0) return null;
                const GroupIcon = group.icon;
                const isMulti = subItems.length > 1;
                const isExpanded = expandedGroupId === group.id;

                return (
                  <div key={group.id} className="rounded-2xl border border-slate-200/80 overflow-hidden">
                    {isMulti ? (
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedGroupId((prev) => (prev === group.id ? null : group.id));
                        }}
                        className="w-full flex items-center justify-between gap-3 p-3.5 text-right hover:bg-slate-50 cursor-pointer min-h-[48px]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-2 rounded-xl bg-slate-100 text-slate-700">
                            <GroupIcon className="w-4 h-4" />
                          </div>
                          <span className="text-sm font-bold truncate">{group.labelAr}</span>
                        </div>
                        <ChevronDown
                          className={`w-4 h-4 text-slate-400 transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                    ) : (
                      <a
                        href={getHrefForTarget(subItems[0].page, subItems[0].tab, { user, flags: featureFlags })}
                        onClick={(e) => {
                          if (!isPlainLeftClick(e)) return;
                          e.preventDefault();
                          setShowMoreMenu(false);
                          onNavigate(subItems[0].page, subItems[0].tab);
                        }}
                        className="w-full flex items-center justify-between gap-3 p-3.5 text-right hover:bg-slate-50 cursor-pointer min-h-[48px] no-underline text-inherit"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-2 rounded-xl bg-slate-100 text-slate-700">
                            <GroupIcon className="w-4 h-4" />
                          </div>
                          <span className="text-sm font-bold truncate">{group.labelAr}</span>
                        </div>
                      </a>
                    )}

                    {isMulti && isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/70 p-2 space-y-1">
                        {subItems.map((sub) => {
                          const SubIcon = sub.icon;
                          const isActive =
                            currentPage === sub.page &&
                            (!sub.tab || sub.tab === currentTab || (sub.tab === 'ALL' && !currentTab));

                          return (
                            <a
                              key={sub.id}
                              href={getHrefForTarget(sub.page, sub.tab, { user, flags: featureFlags })}
                              target={sub.page === 'visitor' ? '_blank' : undefined}
                              rel={sub.page === 'visitor' ? 'noopener noreferrer' : undefined}
                              onClick={(e) => {
                                if (sub.page === 'visitor') {
                                  setShowMoreMenu(false);
                                  return;
                                }
                                if (!isPlainLeftClick(e)) return;
                                e.preventDefault();
                                setShowMoreMenu(false);
                                onNavigate(sub.page, sub.tab);
                              }}
                              aria-current={isActive ? 'page' : undefined}
                              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-right min-h-[44px] cursor-pointer no-underline ${
                                isActive
                                  ? 'bg-cyan-50 text-cyan-900 font-bold'
                                  : 'text-slate-700 hover:bg-white'
                              }`}
                            >
                              {SubIcon && <SubIcon className="w-3.5 h-3.5 shrink-0" />}
                              <span className="truncate">{sub.labelAr}</span>
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

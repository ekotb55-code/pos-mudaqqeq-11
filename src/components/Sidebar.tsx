import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { PageType, UserAccount } from '../types';
import {
  NAV_GROUPS,
  ALL_NAV_SUB_ITEMS,
  NavGroup,
  NavSubItem,
  getNavGroupColors,
  isGroupVisible,
  isSubItemVisible,
  findGroupForPage,
  getHrefForTarget,
  isPlainLeftClick,
  type FeatureModeFlags
} from '../config/navigation';
import { hasPermission } from '../utils/permissions';
import { toLayoutPx } from '../utils/uiScale';
import { getNavShortcutActionForTarget } from '../utils/keyboardShortcuts';
import { useKeyboardShortcuts, useRegisterShortcuts } from '../context/KeyboardShortcutsContext';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  X,
  Sparkles,
  Circle,
  Check
} from 'lucide-react';
import {
  MUDAQQEQ_BRAND_URL,
  MUDAQQEQ_LOGO_PATH,
  MUDAQQEQ_LOGO_ALT,
  MUDAQQEQ_LINK_ARIA_LABEL,
  MUDAQQEQ_BRAND_TITLE_AR,
  MUDAQQEQ_BRAND_SUBTITLE_EN,
  MUDAQQEQ_FALLBACK_LETTER
} from '../config/brand';

type BrandLogoVariant = 'desktop' | 'mobile' | 'collapsed';

const MudaqqeqBrandLogoBox: React.FC<{ variant?: BrandLogoVariant }> = ({
  variant = 'desktop'
}) => {
  const [imgError, setImgError] = useState(false);

  const pxSize = variant === 'collapsed' ? 44 : variant === 'mobile' ? 48 : 56;
  const sizeClasses =
    variant === 'collapsed'
      ? 'w-[44px] h-[44px]'
      : variant === 'mobile'
      ? 'w-[48px] h-[48px]'
      : 'w-[56px] h-[56px]';

  return (
    <div
      data-size={variant}
      className={`mudaqqeq-fixed-logo-box ${sizeClasses} rounded-[14px] p-[4px] flex items-center justify-center shrink-0 overflow-hidden`}
      style={{
        width: `${pxSize}px`,
        height: `${pxSize}px`,
        borderRadius: '14px',
        backgroundColor: '#FFFFFF',
        border: '1px solid #E2E8F0',
        padding: '4px',
        filter: 'none'
      }}
    >
      {!imgError ? (
        <img
          src={MUDAQQEQ_LOGO_PATH}
          alt={MUDAQQEQ_LOGO_ALT}
          onError={() => setImgError(true)}
          className="w-full h-full object-contain select-none"
          style={{ objectFit: 'contain', filter: 'none' }}
        />
      ) : (
        <span
          className="font-bold text-lg leading-none"
          style={{ color: '#0A5FC2', fontWeight: 700 }}
          aria-label={MUDAQQEQ_LOGO_ALT}
        >
          {MUDAQQEQ_FALLBACK_LETTER}
        </span>
      )}
    </div>
  );
};

const MudaqqeqBrandLink: React.FC<{
  showText?: boolean;
  variant?: BrandLogoVariant;
}> = ({ showText = true, variant = 'desktop' }) => (
  <a
    href={MUDAQQEQ_BRAND_URL}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={MUDAQQEQ_LINK_ARIA_LABEL}
    title={MUDAQQEQ_LINK_ARIA_LABEL}
    className={`inline-flex items-center ${
      showText ? 'gap-3.5 min-w-0 rounded-xl p-0.5 -m-0.5' : 'justify-center rounded-[14px]'
    } focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 transition-opacity hover:opacity-95 cursor-pointer`}
  >
    <MudaqqeqBrandLogoBox variant={variant} />
    {showText && (
      <div className="min-w-0 text-start">
        <div
          className="text-[22px] font-bold leading-tight text-[var(--sidebar-text)] truncate"
          style={{ fontSize: '22px', fontWeight: 700 }}
        >
          {MUDAQQEQ_BRAND_TITLE_AR}
        </div>
        <div
          className="text-[12.5px] font-semibold leading-tight text-[var(--sidebar-text-muted)] truncate mt-0.5"
          style={{ fontSize: '12.5px' }}
          dir="ltr"
        >
          {MUDAQQEQ_BRAND_SUBTITLE_EN}
        </div>
      </div>
    )}
  </a>
);

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const ICON_FILL_MODE_BY_GROUP: Record<string, string> = {
  dashboard: 'all',
  sales: 'none',
  delivery: 'first-path',
  items: 'first-path',
  warehouses: 'first-path',
  purchases: 'last-path',
  customers: 'circle-and-first-path',
  cashboxes: 'none',
  platforms: 'circle',
  reports: 'none',
  permissions: 'first-path',
  audit: 'first-path',
  settings: 'first-path'
};

const OFFLINE_DISABLED_PAGES = new Set<PageType>([
  'returns',
  'purchases',
  'cashboxes',
  'bulk_edit_excel',
  'categories',
  'platforms',
  'settings',
  'warehouses',
  'warehouse_transfers',
  'warehouse_excel_transfer',
  'warehouse_dispatch_orders',
  'delivery_settings',
  'delivery_orders',
  'delivery_settlements',
  'delivery_my_orders',
  'delivery_reports'
]);

interface SidebarProps {
  currentPage: PageType;
  currentTab?: string;
  onNavigate: (page: PageType, tab?: string) => void;
  user: UserAccount | null;
  lowStockCount: number;
  lang?: 'ar' | 'en';
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  isOffline?: boolean;
  featureFlags?: FeatureModeFlags;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  currentTab,
  onNavigate,
  user,
  lowStockCount,
  lang = 'ar',
  isMobileOpen = false,
  onCloseMobile,
  isCollapsed = false,
  onToggleCollapsed,
  isOffline = false,
  featureFlags
}) => {
  const isRtl = lang === 'ar';
  const { getShortcutKey: getShortcutDisplayKey } = useKeyboardShortcuts();

  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const flyoutScrollRef = useRef<HTMLDivElement>(null);
  const anchorPositionRef = useRef<{ id: string; top: number; context: 'mobile' | 'desktop' | 'flyout' } | null>(null);

  // حالة لوحة POS المنبثقة (Flyout) في صفحة البيع
  const [isPosFlyoutOpen, setIsPosFlyoutOpen] = useState(false);

  // إعادة تركيز مؤشر الكتابة لخانة الباركود في شاشة POS لضمان عمل ماسح الباركود USB دائماً
  const focusBarcodeInput = () => {
    if (currentPage !== 'pos') return;
    const input = document.getElementById('pos-barcode-input') as HTMLInputElement | null;
    if (input) {
      input.focus();
    }
  };

  // فتح اللوحة المنبثقة مع تحديد القسم المراد فتحه مسبقاً إن وجد
  const openFlyout = (groupId?: string) => {
    if (groupId) {
      setActiveGroupId(groupId);
    }
    setIsPosFlyoutOpen(true);
    // بقاء التركيز على خانة الباركود لقارئ الباركود USB
    setTimeout(focusBarcodeInput, 50);
  };

  // إغلاق اللوحة المنبثقة واسترجاع التركيز لخانة الباركود
  const closeFlyout = () => {
    setIsPosFlyoutOpen(false);
    setTimeout(focusBarcodeInput, 50);
  };

  // حالة المجموعة المفتوحة أو المنبثقة عند طي القائمة الجانبية
  const [collapsedPopover, setCollapsedPopover] = useState<{ groupId: string; top: number } | null>(null);
  const collapsedPopoverRef = useRef<HTMLDivElement>(null);

  // إغلاق اللوحة المنبثقة أو قائمة الطي تلقائياً عند تغيير الوضع
  useEffect(() => {
    if (currentPage !== 'pos') {
      setIsPosFlyoutOpen(false);
    } else {
      setCollapsedPopover(null);
    }
  }, [currentPage]);

  useEffect(() => {
    if (!isCollapsed) {
      setCollapsedPopover(null);
    }
  }, [isCollapsed]);

  useEffect(() => {
    if (!collapsedPopover) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (collapsedPopoverRef.current && target && !collapsedPopoverRef.current.contains(target)) {
        if (target.closest('[data-collapsed-group-btn]')) return;
        setCollapsedPopover(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [collapsedPopover]);

  useRegisterShortcuts(
    {
      'general.close_or_back': () => {
        if (collapsedPopover) {
          setCollapsedPopover(null);
          return;
        }
        if (isPosFlyoutOpen && currentPage === 'pos') {
          closeFlyout();
        }
      }
    },
    Boolean(collapsedPopover || (isPosFlyoutOpen && currentPage === 'pos'))
  );

  // حالة المجموعة المفتوحة حاليًا: قائمة واحدة فقط مفتوحة في نفس الوقت (صفحة POS مميزة بزرها العلوي فقط)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(() => {
    if (currentPage === 'pos') return null;
    const activeGroup = findGroupForPage(currentPage, currentTab);
    return activeGroup && activeGroup.subItems.length > 1 ? activeGroup.id : null;
  });

  // مزامنة القائمة المفتوحة عند تغيير الصفحة
  useEffect(() => {
    if (currentPage === 'pos') return;
    const activeGroup = findGroupForPage(currentPage, currentTab);
    if (activeGroup && activeGroup.subItems.length > 1) {
      setActiveGroupId(activeGroup.id);
    }
  }, [currentPage, currentTab]);

  // تثبيت موضع الزر في الشاشة بدقة ومنع أي قفز عند فتح أو إغلاق القوائم المنسدلة
  useLayoutEffect(() => {
    if (!anchorPositionRef.current) return;
    const { id, top: targetTop, context } = anchorPositionRef.current;
    anchorPositionRef.current = null;

    const container =
      context === 'mobile'
        ? mobileScrollRef.current
        : context === 'flyout'
        ? flyoutScrollRef.current
        : desktopScrollRef.current;
    if (!container) return;

    const btn = container.querySelector<HTMLElement>(`[data-group-id="${id}"]`);
    if (!btn) return;

    const currentTop = toLayoutPx(btn.getBoundingClientRect().top);
    const diff = currentTop - targetTop;

    if (Math.abs(diff) > 0.5) {
      container.scrollTop += diff;
    }
  }, [activeGroupId]);

  // تبديل فتح/إغلاق المجموعة: يغلق أي قائمة أخرى فورياً ويفتح القائمة المختارة لأسفل بثبات
  const handleToggleGroup = (
    groupId: string,
    e: React.MouseEvent<HTMLButtonElement>,
    context: 'mobile' | 'desktop' | 'flyout'
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    anchorPositionRef.current = { id: groupId, top: toLayoutPx(rect.top), context };
    setActiveGroupId((prev) => (prev === groupId ? null : groupId));
    if (context === 'flyout') {
      setTimeout(focusBarcodeInput, 50);
    }
  };

  // التحقق من كون العنصر الفرعي نشطًا حاليًا (عند فتح نقطة البيع لا يُعلَّم أي قسم آخر)
  const checkIsSubItemActive = (sub: NavSubItem): boolean => {
    if (currentPage === 'pos') return false;
    if (currentPage !== sub.page) return false;
    if (sub.tab) {
      if (sub.tab === 'ALL' && (!currentTab || currentTab === 'ALL')) return true;
      return currentTab === sub.tab;
    }
    if (!currentTab || currentTab === '' || currentTab === 'ALL') return true;
    const hasSpecificSiblingMatch = ALL_NAV_SUB_ITEMS.some(
      (s) => s.page === sub.page && s.tab === currentTab
    );
    return !hasSpecificSiblingMatch;
  };

  // التحقق من وجود أي عنصر فرعي نشط داخل المجموعة
  const checkIsGroupActive = (group: NavGroup): boolean => {
    if (currentPage === 'pos') return false;
    return group.subItems.some((sub) => checkIsSubItemActive(sub));
  };

  // صلاحية الوصول لشاشة نقطة البيع (نفس صلاحية الشاشة: invoices.create أو مالك/مصمم)
  const canAccessPos =
    user?.role === 'designer' ||
    Boolean(user?.isOwner) ||
    hasPermission(user, 'invoices.create');

  // ترشيح المجموعات المسموح بها فقط وفق نظام الصلاحيات وأوضاع التشغيل
  const visibleGroups = NAV_GROUPS.filter((group) => isGroupVisible(group, user, featureFlags));

  // محتوى قائمة المجموعات المنسدلة (تستخدم للديسكتوب، الموبايل، واللوحة المنبثقة)
  const renderNavContent = (isMobile = false, isFlyout = false) => {
    const scrollRef = isMobile
      ? mobileScrollRef
      : isFlyout
      ? flyoutScrollRef
      : desktopScrollRef;
    const contextType: 'mobile' | 'desktop' | 'flyout' = isMobile
      ? 'mobile'
      : isFlyout
      ? 'flyout'
      : 'desktop';

    return (
      <div className="flex flex-col h-full" dir={isRtl ? 'rtl' : 'ltr'}>
        {/* رأس القائمة الجانبية الثابت في كل الثيمات على الكمبيوتر */}
        {!isMobile && !isFlyout && (
          <div className="aurora-sidebar-brand items-center gap-3.5 px-4 pt-5 pb-4 min-h-[88px] border-b border-[var(--sidebar-border)] shrink-0">
            <MudaqqeqBrandLink showText={true} variant="desktop" />
          </div>
        )}

        {/* رأس القائمة في وضع الموبايل */}
        {isMobile && (
          <div className="flex items-center justify-between px-4 py-4 min-h-[78px] border-b border-[var(--sidebar-border)] bg-[var(--sidebar-header-bg)] shrink-0">
            <MudaqqeqBrandLink showText={true} variant="mobile" />
            <button
              type="button"
              onClick={onCloseMobile}
              className="p-1.5 rounded-lg text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] hover:bg-black/5 cursor-pointer"
              aria-label="إغلاق القائمة"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* رأس القائمة في وضع اللوحة المنبثقة Flyout لصفحة POS */}
        {isFlyout && (
          <div className="flex items-center justify-between px-4 py-4 min-h-[84px] border-b border-[var(--sidebar-border)] bg-[var(--sidebar-header-bg)] shrink-0">
            <MudaqqeqBrandLink showText={true} variant="desktop" />
            <button
              type="button"
              onClick={closeFlyout}
              className="p-1.5 rounded-lg text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] hover:bg-black/5 cursor-pointer transition"
              aria-label="إغلاق القائمة"
              title={isRtl ? 'إغلاق (Esc)' : 'Close (Esc)'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* زر بدء البيع السريع (نقطة بيع) مثبّت أعلى القائمة أسفل الشعار مباشرة وقبل لوحة التحكم */}
        {canAccessPos && (() => {
          const posShortcutKey = getShortcutDisplayKey('nav.pos');
          const posHref = getHrefForTarget('pos', undefined, { user, flags: featureFlags });
          return (
            <div className="px-2.5 py-[12px] shrink-0">
              <a
                href={posHref}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return;
                  e.preventDefault();
                  if (currentPage === 'pos') {
                    closeFlyout();
                    return;
                  }
                  if (isFlyout) {
                    closeFlyout();
                  }
                  onNavigate('pos');
                  if (isMobile && onCloseMobile) {
                    onCloseMobile();
                  }
                }}
                aria-current={currentPage === 'pos' ? 'page' : undefined}
                className={`group mudaqqeq-pos-cta w-full h-[52px] min-h-[52px] px-3 rounded-xl bg-gradient-to-r from-[var(--primary)] to-[var(--nav-blue)] hover:opacity-95 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 no-underline ${
                  currentPage === 'pos'
                    ? 'ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--sidebar-bg)]'
                    : ''
                }`}
              >
                <ShoppingCart className="w-4 h-4 shrink-0" />
                <span>{isRtl ? 'نقطة بيع' : 'POS'}</span>
                <Sparkles className="aurora-hide w-3.5 h-3.5 text-amber-300 shrink-0" />
                {posShortcutKey && (
                  <kbd
                    dir="ltr"
                    className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 inline-flex items-center px-1.5 py-0.5 rounded bg-white/20 text-white text-[10px] font-mono font-bold leading-none shrink-0"
                  >
                    {posShortcutKey}
                  </kbd>
                )}
              </a>
            </div>
          );
        })()}

        {/* منطقة المجموعات القابلة للتمرير */}
        <div
          ref={scrollRef}
          className={`flex-1 overflow-y-auto px-2.5 ${canAccessPos ? 'pt-0' : 'pt-3'} pb-3 space-y-1.5 custom-scrollbar`}
        >
          {visibleGroups.map((group) => {
            const visibleSubItems = group.subItems.filter((sub) => isSubItemVisible(sub, user, featureFlags));
            const isDropdown = group.subItems.length > 1 && visibleSubItems.length > 0;
            const isExpanded = isDropdown && activeGroupId === group.id;
            const isGroupActive = checkIsGroupActive(group);
            const GroupIcon = group.icon;
            const groupBadge = group.badge ? group.badge({ lowStockCount }) : null;
            const colors = getNavGroupColors(group.id);
            const shadowColor = hexToRgba(colors.primary, 0.33);
            const softShadowColor = hexToRgba(colors.primary, 0.16);
            const fillMode = ICON_FILL_MODE_BY_GROUP[group.id] || 'none';
            const rowStyle = {
              '--sec-primary': colors.primary,
              '--sec-dark': colors.dark,
              '--sec-light': colors.light,
              '--sec-shadow': shadowColor,
              '--sec-soft-shadow': softShadowColor
            } as React.CSSProperties;

            const isSingleDisabledOffline =
              isOffline &&
              visibleSubItems.length === 1 &&
              OFFLINE_DISABLED_PAGES.has(visibleSubItems[0].page);

            const groupShortcutAction =
              visibleSubItems.length > 0
                ? getNavShortcutActionForTarget(visibleSubItems[0].page, visibleSubItems[0].tab)
                : null;
            const groupShortcutKey = groupShortcutAction ? getShortcutDisplayKey(groupShortcutAction) : null;

            const singleGroupSub = !isDropdown && visibleSubItems.length === 1 ? visibleSubItems[0] : null;
            const singleGroupHref = singleGroupSub
              ? getHrefForTarget(singleGroupSub.page, singleGroupSub.tab, { user, flags: featureFlags })
              : null;

            const groupRowInner = (
              <>
                <div className="flex items-center gap-[14px] min-w-0">
                  {/* مربع الأيقونة 40×40px */}
                  <span className="mudaqqeq-icon-wrap relative w-[40px] h-[40px] shrink-0">
                    <span
                      className="mudaqqeq-icon-box relative w-[40px] h-[40px] rounded-[12px] flex items-center justify-center overflow-hidden"
                      data-active={isGroupActive ? 'true' : 'false'}
                    >
                      {/* لمعة دائرية بيضاء شفافة بحجم المربع مزاحة لأعلى اليسار ليظهر ربعها */}
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute w-[40px] h-[40px] rounded-full -top-[20px] -left-[20px]"
                        style={{ background: 'rgba(255, 255, 255, 0.20)' }}
                      />
                      <GroupIcon
                        className="mudaqqeq-nav-icon relative z-10"
                        data-fill={fillMode}
                      />
                    </span>

                    {/* علامة صح «مدقق» الصغيرة على القسم المفتوح */}
                    {isGroupActive && (
                      <span
                        aria-hidden="true"
                        className="mudaqqeq-check-badge absolute w-[19px] h-[19px] rounded-full bg-white flex items-center justify-center z-20"
                        style={{
                          bottom: '-4px',
                          insetInlineEnd: '-4px',
                          boxShadow: '0 2px 6px rgba(15, 23, 42, 0.18)'
                        }}
                      >
                        <Check
                          className="w-[11px] h-[11px]"
                          strokeWidth={3.6}
                          style={{ color: colors.primary }}
                        />
                      </span>
                    )}
                  </span>

                  <span className="mudaqqeq-nav-label truncate">
                    {isRtl ? group.labelAr : group.labelEn}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!isDropdown && groupShortcutKey && (
                    <kbd
                      dir="ltr"
                      className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 inline-flex items-center px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-600 text-[10px] font-mono font-bold leading-none shrink-0"
                    >
                      {groupShortcutKey}
                    </kbd>
                  )}
                  {isSingleDisabledOffline ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">
                      متاح عند رجوع الاتصال
                    </span>
                  ) : (
                    groupBadge && (
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${groupBadge.color}`}
                      >
                        {groupBadge.text}
                      </span>
                    )
                  )}
                  {isDropdown && (
                    <span className="transition-transform duration-200">
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${
                          isExpanded
                            ? 'rotate-0 text-[var(--primary)]'
                            : isRtl
                            ? 'rotate-90 text-[var(--sidebar-text-muted)]'
                            : '-rotate-90 text-[var(--sidebar-text-muted)]'
                        }`}
                      />
                    </span>
                  )}
                </div>
              </>
            );

            return (
              <div key={group.id} className="rounded-[14px]">
                {/* عنصر المجموعة الرئيسي: رابط حقيقي للمجموعات المباشرة وزر تبديل للقوائم المنسدلة */}
                {singleGroupSub && singleGroupHref ? (
                  <a
                    href={singleGroupHref}
                    aria-disabled={isSingleDisabledOffline ? 'true' : undefined}
                    aria-current={isGroupActive ? 'page' : undefined}
                    title={isSingleDisabledOffline ? 'متاح عند رجوع الاتصال' : undefined}
                    data-group-id={group.id}
                    data-active={isGroupActive ? 'true' : 'false'}
                    data-expanded="false"
                    data-dir={isRtl ? 'rtl' : 'ltr'}
                    style={rowStyle}
                    onClick={(e) => {
                      if (isSingleDisabledOffline) {
                        e.preventDefault();
                        onNavigate(singleGroupSub.page, singleGroupSub.tab);
                        return;
                      }
                      if (!isPlainLeftClick(e)) return;
                      e.preventDefault();
                      setActiveGroupId(null);
                      if (currentPage === 'pos' && singleGroupSub.page === 'pos') {
                        closeFlyout();
                        return;
                      }
                      if (isFlyout) {
                        closeFlyout();
                      }
                      onNavigate(singleGroupSub.page, singleGroupSub.tab);
                      if (isMobile && onCloseMobile) {
                        onCloseMobile();
                      }
                    }}
                    className={`group mudaqqeq-nav-row w-full flex items-center justify-between text-start no-underline ${
                      isSingleDisabledOffline ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    {groupRowInner}
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={isSingleDisabledOffline}
                    title={isSingleDisabledOffline ? 'متاح عند رجوع الاتصال' : undefined}
                    data-group-id={group.id}
                    data-active={isGroupActive ? 'true' : 'false'}
                    data-expanded={isExpanded ? 'true' : 'false'}
                    data-dir={isRtl ? 'rtl' : 'ltr'}
                    style={rowStyle}
                    onClick={(e) => {
                      if (isSingleDisabledOffline) return;
                      if (isDropdown) {
                        handleToggleGroup(group.id, e, contextType);
                      }
                    }}
                    className={`group mudaqqeq-nav-row w-full flex items-center justify-between text-start ${
                      isSingleDisabledOffline ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                    aria-expanded={isDropdown ? isExpanded : undefined}
                  >
                    {groupRowInner}
                  </button>
                )}

                {/* العناصر الفرعية داخل المجموعة المنسدلة */}
                {isDropdown && (
                  <div
                    className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
                      isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div
                        className={`mt-1 mb-2.5 space-y-1 ${
                          isRtl
                            ? 'pr-3 mr-3.5 border-r-2 border-[var(--sidebar-border)]'
                            : 'pl-3 ml-3.5 border-l-2 border-[var(--sidebar-border)]'
                        }`}
                      >
                        {visibleSubItems.map((sub) => {
                          const isSubActive = checkIsSubItemActive(sub);
                          const SubIcon = sub.icon;
                          const subBadge = sub.badge ? sub.badge({ lowStockCount }) : null;
                          const isSubDisabledOffline = isOffline && OFFLINE_DISABLED_PAGES.has(sub.page);
                          const subShortcutAction = getNavShortcutActionForTarget(sub.page, sub.tab);
                          const subShortcutKey = subShortcutAction ? getShortcutDisplayKey(subShortcutAction) : null;

                          if (sub.page === 'visitor') {
                            return (
                              <a
                                key={sub.id}
                                href="/visitor"
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`sidebar-sub-${sub.id}`}
                                onClick={() => {
                                  if (isFlyout) closeFlyout();
                                  if (isMobile && onCloseMobile) onCloseMobile();
                                }}
                                className="group w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150 text-start text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] cursor-pointer"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {SubIcon ? (
                                    <SubIcon className="w-3.5 h-3.5 shrink-0 text-[var(--sidebar-text-muted)]" />
                                  ) : (
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--sidebar-text-muted)]/40 shrink-0" />
                                  )}
                                  <span className="truncate">
                                    {isRtl ? sub.labelAr : sub.labelEn}
                                  </span>
                                </div>
                              </a>
                            );
                          }

                          const subHref = getHrefForTarget(sub.page, sub.tab, { user, flags: featureFlags });
                          return (
                            <a
                              key={sub.id}
                              href={subHref}
                              aria-disabled={isSubDisabledOffline ? 'true' : undefined}
                              aria-current={isSubActive ? 'page' : undefined}
                              title={isSubDisabledOffline ? 'متاح عند رجوع الاتصال' : undefined}
                              onClick={(e) => {
                                if (isSubDisabledOffline) {
                                  e.preventDefault();
                                  onNavigate(sub.page, sub.tab);
                                  return;
                                }
                                if (!isPlainLeftClick(e)) return;
                                e.preventDefault();
                                if (currentPage === 'pos' && sub.page === 'pos') {
                                  closeFlyout();
                                  return;
                                }
                                if (isFlyout) {
                                  closeFlyout();
                                }
                                onNavigate(sub.page, sub.tab);
                                if (isMobile && onCloseMobile) {
                                  onCloseMobile();
                                }
                              }}
                              className={`group w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150 text-start no-underline ${
                                isSubDisabledOffline
                                  ? 'text-slate-400 opacity-60 cursor-not-allowed'
                                  : isSubActive
                                  ? 'bg-[var(--sidebar-sub-active-bg)] text-[var(--sidebar-sub-active-text)] shadow-xs font-bold cursor-pointer'
                                  : 'text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] cursor-pointer'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isSubActive ? (
                                  <Circle className="w-2 h-2 fill-current shrink-0 text-[var(--primary)]" />
                                ) : SubIcon ? (
                                  <SubIcon className="w-3.5 h-3.5 shrink-0 text-[var(--sidebar-text-muted)]" />
                                ) : (
                                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--sidebar-text-muted)]/40 shrink-0" />
                                )}
                                <span className="truncate">
                                  {isRtl ? sub.labelAr : sub.labelEn}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {subShortcutKey && (
                                  <kbd
                                    dir="ltr"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 inline-flex items-center px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-600 text-[9.5px] font-mono font-bold leading-none shrink-0"
                                  >
                                    {subShortcutKey}
                                  </kbd>
                                )}
                                {isSubDisabledOffline ? (
                                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full shrink-0 bg-slate-200 text-slate-600">
                                    متاح عند رجوع الاتصال
                                  </span>
                                ) : (
                                  subBadge && (
                                    <span
                                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full shrink-0 ${subBadge.color}`}
                                    >
                                      {subBadge.text}
                                    </span>
                                  )
                                )}
                              </div>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // محتوى الشريط الجانبي الضيق (64px) في وضع الأيقونات فقط
  const renderCollapsedContent = () => (
    <div className="flex flex-col h-full items-center pt-3.5 pb-2.5 w-16" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* شعار مدقق الثابت مع الرابط في الوضع المطوي (الشعار فقط بدون النص 44×44px) */}
      <div className="mb-3 shrink-0">
        <MudaqqeqBrandLink showText={false} variant="collapsed" />
      </div>

      {/* زر توسيع القائمة: في صفحة POS يفتح اللوحة المنبثقة مباشرة */}
      <div className="mb-2.5 shrink-0">
        <button
          type="button"
          onClick={() => {
            if (currentPage === 'pos') {
              openFlyout();
            } else if (onToggleCollapsed) {
              onToggleCollapsed();
            }
          }}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] cursor-pointer transition shadow-2xs border border-[var(--sidebar-border)] bg-white/40"
          title={isRtl ? 'فتح القائمة الجانبية بالكامل' : 'Expand Sidebar'}
          aria-label="توسيع القائمة"
        >
          {isRtl ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </button>
      </div>

      {/* زر نقطة بيع السريع (أيقونة 44×44px فقط) مثبّت أعلى القائمة المطوية مباشرة قبل الأقسام */}
      {canAccessPos && (
        <div className="mb-2.5 shrink-0">
          <a
            href={getHrefForTarget('pos', undefined, { user, flags: featureFlags })}
            onClick={(e) => {
              if (!isPlainLeftClick(e)) return;
              e.preventDefault();
              if (currentPage === 'pos') {
                if (isPosFlyoutOpen) {
                  closeFlyout();
                } else {
                  focusBarcodeInput();
                }
                return;
              }
              onNavigate('pos');
            }}
            title={isRtl ? 'نقطة بيع' : 'POS'}
            aria-label={isRtl ? 'نقطة بيع' : 'POS'}
            aria-current={currentPage === 'pos' ? 'page' : undefined}
            className={`w-11 h-11 rounded-xl bg-gradient-to-r from-[var(--primary)] to-[var(--nav-blue)] hover:opacity-95 text-white flex items-center justify-center shadow-md transition-all cursor-pointer active:scale-95 no-underline ${
              currentPage === 'pos'
                ? 'ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--sidebar-bg)]'
                : ''
            }`}
          >
            <ShoppingCart className="w-5 h-5" />
          </a>
        </div>
      )}

      {/* قائمة الأيقونات فقط: في صفحة POS النقر يفتح اللوحة المنبثقة والقسم المطلوب مفتوح */}
      <div className="flex-1 overflow-y-auto w-full px-1 py-1.5 space-y-2.5 custom-scrollbar flex flex-col items-center">
        {visibleGroups.map((group) => {
          const visibleSubItems = group.subItems.filter((sub) => isSubItemVisible(sub, user, featureFlags));
          const isGroupActive = checkIsGroupActive(group);
          const GroupIcon = group.icon;
          const groupBadge = group.badge ? group.badge({ lowStockCount }) : null;
          const label = isRtl ? group.labelAr : group.labelEn;
          const colors = getNavGroupColors(group.id);
          const shadowColor = hexToRgba(colors.primary, 0.33);
          const softShadowColor = hexToRgba(colors.primary, 0.16);
          const fillMode = ICON_FILL_MODE_BY_GROUP[group.id] || 'none';
          const collapsedStyle = {
            '--sec-primary': colors.primary,
            '--sec-dark': colors.dark,
            '--sec-light': colors.light,
            '--sec-shadow': shadowColor,
            '--sec-soft-shadow': softShadowColor
          } as React.CSSProperties;

          const collapsedSingleDisabledOffline =
            isOffline &&
            visibleSubItems.length === 1 &&
            OFFLINE_DISABLED_PAGES.has(visibleSubItems[0].page);
          const isCollapsedPopoverOpen = collapsedPopover?.groupId === group.id;

          const collapsedSingleSub = visibleSubItems.length === 1 ? visibleSubItems[0] : null;
          const collapsedSingleHref = collapsedSingleSub
            ? getHrefForTarget(collapsedSingleSub.page, collapsedSingleSub.tab, { user, flags: featureFlags })
            : null;
          const collapsedIconInner = (
            <>
              <span className="mudaqqeq-icon-wrap relative w-[40px] h-[40px]">
                <span
                  className="mudaqqeq-icon-box relative w-[40px] h-[40px] rounded-[12px] flex items-center justify-center overflow-hidden"
                  data-active={isGroupActive ? 'true' : 'false'}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute w-[40px] h-[40px] rounded-full -top-[20px] -left-[20px]"
                    style={{ background: 'rgba(255, 255, 255, 0.20)' }}
                  />
                  <GroupIcon
                    className="mudaqqeq-nav-icon relative z-10"
                    data-fill={fillMode}
                  />
                </span>

                {isGroupActive && (
                  <span
                    aria-hidden="true"
                    className="mudaqqeq-check-badge absolute w-[19px] h-[19px] rounded-full bg-white flex items-center justify-center z-20"
                    style={{
                      bottom: '-4px',
                      insetInlineEnd: '-4px',
                      boxShadow: '0 2px 6px rgba(15, 23, 42, 0.18)'
                    }}
                  >
                    <Check
                      className="w-[11px] h-[11px]"
                      strokeWidth={3.6}
                      style={{ color: colors.primary }}
                    />
                  </span>
                )}
              </span>
              {groupBadge && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white z-30" />
              )}
            </>
          );

          return (
            <div key={group.id} className="relative flex justify-center w-full">
              {collapsedSingleSub && collapsedSingleHref ? (
                <a
                  href={collapsedSingleHref}
                  data-collapsed-group-btn={group.id}
                  aria-disabled={collapsedSingleDisabledOffline ? 'true' : undefined}
                  aria-current={isGroupActive ? 'page' : undefined}
                  data-active={isGroupActive ? 'true' : 'false'}
                  style={collapsedStyle}
                  onClick={(e) => {
                    if (collapsedSingleDisabledOffline) {
                      e.preventDefault();
                      onNavigate(collapsedSingleSub.page, collapsedSingleSub.tab);
                      return;
                    }
                    if (!isPlainLeftClick(e)) return;
                    e.preventDefault();
                    if (currentPage === 'pos') {
                      if (isPosFlyoutOpen && activeGroupId === group.id) {
                        closeFlyout();
                        return;
                      }
                      openFlyout(group.id);
                      return;
                    }
                    setCollapsedPopover(null);
                    onNavigate(collapsedSingleSub.page, collapsedSingleSub.tab);
                  }}
                  title={collapsedSingleDisabledOffline ? 'متاح عند رجوع الاتصال' : label}
                  aria-label={label}
                  className={`mudaqqeq-collapsed-btn relative rounded-[12px] flex items-center justify-center transition-all no-underline ${
                    collapsedSingleDisabledOffline ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  {collapsedIconInner}
                </a>
              ) : (
                <button
                  type="button"
                  data-collapsed-group-btn={group.id}
                  disabled={collapsedSingleDisabledOffline}
                  data-active={isGroupActive ? 'true' : 'false'}
                  aria-expanded={visibleSubItems.length > 1 ? isCollapsedPopoverOpen : undefined}
                  style={collapsedStyle}
                  onClick={(e) => {
                    if (collapsedSingleDisabledOffline) return;
                    if (currentPage === 'pos') {
                      if (isPosFlyoutOpen && activeGroupId === group.id) {
                        closeFlyout();
                        return;
                      }
                      openFlyout(group.id);
                      return;
                    }
                    if (visibleSubItems.length > 1) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clampedTop = Math.max(
                        12,
                        Math.min(toLayoutPx(rect.top), toLayoutPx(typeof window !== 'undefined' ? window.innerHeight : 720) - 300)
                      );
                      setCollapsedPopover((prev) =>
                        prev?.groupId === group.id ? null : { groupId: group.id, top: clampedTop }
                      );
                    }
                  }}
                  title={collapsedSingleDisabledOffline ? 'متاح عند رجوع الاتصال' : label}
                  aria-label={label}
                  className={`mudaqqeq-collapsed-btn relative rounded-[12px] flex items-center justify-center transition-all ${
                    collapsedSingleDisabledOffline ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  {collapsedIconInner}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const activeCollapsedGroup = collapsedPopover
    ? visibleGroups.find((g) => g.id === collapsedPopover.groupId)
    : undefined;
  const activeCollapsedSubItems = activeCollapsedGroup
    ? activeCollapsedGroup.subItems.filter((sub) => isSubItemVisible(sub, user, featureFlags))
    : [];

  return (
    <>
      <style>{`
        .mudaqqeq-nav-row {
          min-height: 54px;
          height: 54px;
          padding: 7px 10px;
          border-radius: 14px;
          background: transparent;
          transition: background-color 180ms ease-out, color 180ms ease-out;
        }
        .mudaqqeq-nav-label {
          font-size: 14.5px;
          font-weight: 500;
          color: #0F172A;
          line-height: 1.3;
          transition: color 180ms ease-out;
        }
        [data-theme="dark"] .mudaqqeq-nav-label,
        [data-theme="current"] .mudaqqeq-nav-label {
          color: var(--sidebar-text);
        }
        .mudaqqeq-nav-row[data-active="false"]:hover,
        .mudaqqeq-nav-row[data-active="false"]:focus-visible {
          background: #F4F6FA;
        }
        [data-theme="dark"] .mudaqqeq-nav-row[data-active="false"]:hover,
        [data-theme="dark"] .mudaqqeq-nav-row[data-active="false"]:focus-visible,
        [data-theme="current"] .mudaqqeq-nav-row[data-active="false"]:hover,
        [data-theme="current"] .mudaqqeq-nav-row[data-active="false"]:focus-visible {
          background: var(--sidebar-hover-bg);
        }
        .mudaqqeq-nav-row[data-active="false"]:hover .mudaqqeq-nav-label,
        .mudaqqeq-nav-row[data-active="false"]:focus-visible .mudaqqeq-nav-label {
          color: var(--sec-dark);
          font-weight: 600;
        }
        .mudaqqeq-nav-row[data-active="true"][data-dir="rtl"] {
          background: linear-gradient(to left, var(--sec-light) 0%, #FFFFFF 100%);
        }
        .mudaqqeq-nav-row[data-active="true"][data-dir="ltr"] {
          background: linear-gradient(to right, var(--sec-light) 0%, #FFFFFF 100%);
        }
        .mudaqqeq-nav-row[data-active="true"] .mudaqqeq-nav-label {
          color: var(--sec-dark);
          font-weight: 700;
        }
        .mudaqqeq-nav-row:focus-visible,
        .mudaqqeq-collapsed-btn:focus-visible {
          outline: 2px solid var(--sec-primary);
          outline-offset: 2px;
        }
        .mudaqqeq-icon-box {
          background: linear-gradient(140deg, var(--sec-primary) 10%, var(--sec-dark) 95%);
          box-shadow: 0 5px 12px var(--sec-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.38);
          transition: transform 180ms ease-out, box-shadow 180ms ease-out;
          transform-origin: center;
        }
        .mudaqqeq-icon-box[data-active="true"] {
          box-shadow: 0 0 0 3px #FFFFFF, 0 0 0 5px var(--sec-primary), 0 6px 14px var(--sec-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.38);
        }
        .mudaqqeq-nav-row:hover .mudaqqeq-icon-box,
        .mudaqqeq-nav-row:focus-visible .mudaqqeq-icon-box,
        .mudaqqeq-collapsed-btn:hover .mudaqqeq-icon-box,
        .mudaqqeq-collapsed-btn:focus-visible .mudaqqeq-icon-box {
          transform: rotate(-7deg) scale(1.06);
        }
        .mudaqqeq-nav-icon {
          width: 22px;
          height: 22px;
          color: #FFFFFF;
          stroke: #FFFFFF;
          stroke-width: 1.9;
        }
        .mudaqqeq-nav-icon[data-fill="all"] > * {
          fill: rgba(255, 255, 255, 0.32);
        }
        .mudaqqeq-nav-icon[data-fill="first-path"] > path:first-of-type {
          fill: rgba(255, 255, 255, 0.32);
        }
        .mudaqqeq-nav-icon[data-fill="last-path"] > path:last-of-type {
          fill: rgba(255, 255, 255, 0.32);
        }
        .mudaqqeq-nav-icon[data-fill="circle"] > circle {
          fill: rgba(255, 255, 255, 0.32);
        }
        .mudaqqeq-nav-icon[data-fill="circle-and-first-path"] > circle,
        .mudaqqeq-nav-icon[data-fill="circle-and-first-path"] > path:first-of-type {
          fill: rgba(255, 255, 255, 0.32);
        }
        @media (prefers-reduced-motion: reduce) {
          .mudaqqeq-icon-box {
            transition: none !important;
          }
          .mudaqqeq-nav-row:hover .mudaqqeq-icon-box,
          .mudaqqeq-nav-row:focus-visible .mudaqqeq-icon-box,
          .mudaqqeq-collapsed-btn:hover .mudaqqeq-icon-box,
          .mudaqqeq-collapsed-btn:focus-visible .mudaqqeq-icon-box {
            transform: none !important;
          }
        }
        [data-motion="off"] .mudaqqeq-icon-box {
          transition: none !important;
        }
        [data-motion="off"] .mudaqqeq-nav-row:hover .mudaqqeq-icon-box,
        [data-motion="off"] .mudaqqeq-nav-row:focus-visible .mudaqqeq-icon-box,
        [data-motion="off"] .mudaqqeq-collapsed-btn:hover .mudaqqeq-icon-box,
        [data-motion="off"] .mudaqqeq-collapsed-btn:focus-visible .mudaqqeq-icon-box {
          transform: none !important;
        }
      `}</style>
      {/* 1. الشريط الجانبي الثابت على الديسكتوب والتابلت (>= 768px): 64px في وضع الطي أو 288px */}
      <aside
        data-app-sidebar="true"
        className={`no-print hidden md:flex flex-col ${
          isCollapsed ? 'w-16 min-w-16' : 'w-72 min-w-72'
        } bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] border-inline-end border-[var(--sidebar-border)] shrink-0 min-h-[calc(100vh/var(--app-zoom,1)-2.5rem)] max-h-[calc(100vh/var(--app-zoom,1))] sticky top-0 z-20 shadow-md transition-all duration-200`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {isCollapsed ? renderCollapsedContent() : renderNavContent(false, false)}
      </aside>

      {/* قائمة فرعية عائمة في وضع الطي على الديسكتوب (غير شاشة POS) */}
      {isCollapsed && currentPage !== 'pos' && collapsedPopover && activeCollapsedGroup && activeCollapsedSubItems.length > 0 && (
        <div
          ref={collapsedPopoverRef}
          dir={isRtl ? 'rtl' : 'ltr'}
          style={{
            top: `${collapsedPopover.top}px`,
            ...(isRtl ? { right: '72px' } : { left: '72px' })
          }}
          className="no-print hidden md:flex fixed z-50 w-64 max-h-[calc(75vh/var(--app-zoom,1))] flex-col rounded-2xl bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] border border-[var(--sidebar-border)] shadow-2xl overflow-hidden"
        >
          <div className="px-3.5 py-2.5 border-b border-[var(--sidebar-border)] flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold truncate">
              {isRtl ? activeCollapsedGroup.labelAr : activeCollapsedGroup.labelEn}
            </span>
            <button
              type="button"
              onClick={() => setCollapsedPopover(null)}
              className="p-1 rounded-lg text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] cursor-pointer"
              aria-label="إغلاق القائمة الفرعية"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {activeCollapsedSubItems.map((sub) => {
              const isSubActive = checkIsSubItemActive(sub);
              const SubIcon = sub.icon;
              const subBadge = sub.badge ? sub.badge({ lowStockCount }) : null;
              const isSubDisabledOffline = isOffline && OFFLINE_DISABLED_PAGES.has(sub.page);

              if (sub.page === 'visitor') {
                return (
                  <a
                    key={sub.id}
                    href="/visitor"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setCollapsedPopover(null)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-start text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {SubIcon ? (
                        <SubIcon className="w-3.5 h-3.5 shrink-0 text-[var(--sidebar-text-muted)]" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--sidebar-text-muted)]/40 shrink-0" />
                      )}
                      <span className="truncate">{isRtl ? sub.labelAr : sub.labelEn}</span>
                    </div>
                  </a>
                );
              }

              return (
                <a
                  key={sub.id}
                  href={getHrefForTarget(sub.page, sub.tab, { user, flags: featureFlags })}
                  aria-disabled={isSubDisabledOffline ? 'true' : undefined}
                  aria-current={isSubActive ? 'page' : undefined}
                  title={isSubDisabledOffline ? 'متاح عند رجوع الاتصال' : undefined}
                  onClick={(e) => {
                    if (isSubDisabledOffline) {
                      e.preventDefault();
                      onNavigate(sub.page, sub.tab);
                      return;
                    }
                    if (!isPlainLeftClick(e)) return;
                    e.preventDefault();
                    setCollapsedPopover(null);
                    onNavigate(sub.page, sub.tab);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition text-start no-underline ${
                    isSubDisabledOffline
                      ? 'text-slate-400 opacity-60 cursor-not-allowed'
                      : isSubActive
                      ? 'bg-[var(--sidebar-sub-active-bg)] text-[var(--sidebar-sub-active-text)] font-bold cursor-pointer'
                      : 'text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isSubActive ? (
                      <Circle className="w-2 h-2 fill-current shrink-0 text-[var(--primary)]" />
                    ) : SubIcon ? (
                      <SubIcon className="w-3.5 h-3.5 shrink-0 text-[var(--sidebar-text-muted)]" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--sidebar-text-muted)]/40 shrink-0" />
                    )}
                    <span className="truncate">{isRtl ? sub.labelAr : sub.labelEn}</span>
                  </div>
                  {!isSubDisabledOffline && subBadge && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full shrink-0 ${subBadge.color}`}>
                      {subBadge.text}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. القائمة الجانبية المنزلقة المتجاوبة على الموبايل (< 768px) دون أي تغيير في سلوكها */}
      {isMobileOpen && (
        <div className="no-print md:hidden fixed inset-0 z-50 flex" dir={isRtl ? 'rtl' : 'ltr'}>
          {/* خلفية معتمة */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-fadeIn"
            onClick={onCloseMobile}
          />

          {/* الدرج المنزلق */}
          <div
            className={`relative z-10 w-80 max-w-[calc(85vw/var(--app-zoom,1))] h-full bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] shadow-2xl flex flex-col border-inline-end border-[var(--sidebar-border)] transform transition-transform duration-200 animate-in ${
              isRtl ? 'slide-in-from-right' : 'slide-in-from-left'
            }`}
          >
            {renderNavContent(true, false)}
          </div>
        </div>
      )}

      {/* 3. اللوحة المنبثقة (Flyout) الخاصة بصفحة POS على الديسكتوب والتابلت فوق شاشة البيع */}
      {currentPage === 'pos' && (
        <>
          {/* طبقة شفافة خفيفة (bg-black/20) فوق باقي الشاشة تغلق اللوحة وتمنع وصول أي نقرة لشاشة البيع */}
          <div
            className={`no-print hidden md:block fixed inset-0 bg-black/20 z-40 transition-opacity duration-150 ${
              isPosFlyoutOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeFlyout();
            }}
            aria-hidden={!isPosFlyoutOpen}
          />

          {/* اللوحة بعرض 280px وبارتفاع الشاشة ومن جهة اليمين مع انزلاق 150ms وظل خفيف */}
          <div
            className={`no-print hidden md:flex fixed top-0 bottom-0 ${
              isRtl ? 'right-0' : 'left-0'
            } z-50 w-[280px] h-[calc(100vh/var(--app-zoom,1))] bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] shadow-lg flex-col border-inline-end border-[var(--sidebar-border)] transition-transform duration-150 ease-in-out ${
              isPosFlyoutOpen
                ? 'translate-x-0 pointer-events-auto'
                : isRtl
                ? 'translate-x-full pointer-events-none'
                : '-translate-x-full pointer-events-none'
            }`}
            dir={isRtl ? 'rtl' : 'ltr'}
            aria-hidden={!isPosFlyoutOpen}
          >
            {renderNavContent(false, true)}
          </div>
        </>
      )}
    </>
  );
};

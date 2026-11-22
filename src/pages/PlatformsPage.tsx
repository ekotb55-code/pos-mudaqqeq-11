import React, { useState, useEffect } from 'react';
import { Platform, ItemPlatformCost, Item, PageType, UserRole, UserAccount } from '../types';
import { hasPermission } from '../utils/permissions';
import { PlatformReportView } from '../components/reports/PlatformReportView';
import CreditCollectionView from '../components/CreditCollectionView';
import {
  Plus,
  Edit2,
  Save,
  X,
  AlertCircle,
  Power,
  PowerOff,
  BarChart3,
  Wallet
} from 'lucide-react';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ModalShell,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
} from '../components/ui';
import { ShortcutBadge } from '../context/KeyboardShortcutsContext';
import { getHrefForTarget, isPlainLeftClick } from '../config/navigation';

type PlatformTab = 'platforms' | 'shippingCosts' | 'platformReport' | 'creditCollection';

interface PlatformsPageProps {
  platforms: Platform[];
  items: Item[];
  costs: ItemPlatformCost[];
  user?: UserAccount | null;
  userRole: UserRole;
  onSavePlatform: (plt: Partial<Platform> & { name: string }) => Promise<void>;
  onSaveCost: (cost: ItemPlatformCost) => Promise<void>;
  initialTab?: PlatformTab;
  initialPlatformId?: string;
  onNavigate?: (
    page: PageType,
    tab?: string,
    options?: { searchParams?: Record<string, string | undefined>; replace?: boolean }
  ) => void;
}

export const PlatformsPage: React.FC<PlatformsPageProps> = ({
  platforms,
  items,
  costs,
  user = null,
  userRole,
  onSavePlatform,
  onSaveCost,
  initialTab,
  initialPlatformId,
  onNavigate
}) => {
  const isManager = userRole === 'manager' || userRole === 'designer';
  const canViewPlatformReport = user
    ? hasPermission(user, 'reports.platform_view')
    : isManager;
  const canCollectCredit = user
    ? user.role === 'designer' || hasPermission(user, 'invoices.collect_credit') || hasPermission(user, 'invoices.view')
    : true;
  const [activeTab, setActiveTab] = useState<'platforms' | 'shippingCosts' | 'platformReport' | 'creditCollection'>(initialTab || 'platforms');
  const [selectedReportPlatformId, setSelectedReportPlatformId] = useState<string>(
    () => initialPlatformId || platforms[0]?.id || ''
  );

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (initialPlatformId) {
      setSelectedReportPlatformId(initialPlatformId);
    }
  }, [initialPlatformId]);

  // Platform Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<Platform | null>(null);
  const [name, setName] = useState('');
  const [discountPercentage, setDiscountPercentage] = useState<number | ''>(10);
  const [pickupFee, setPickupFee] = useState<number | ''>(0);
  const [pickupFeeMode, setPickupFeeMode] = useState<'platform' | 'product'>('platform');
  const [enableBnpl, setEnableBnpl] = useState<boolean>(false);
  const [bnplPercentage, setBnplPercentage] = useState<number | ''>(0);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'نشطة' | 'موقوفة' | 'active' | 'inactive'>('نشطة');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // ItemPlatformCost Edit state
  const [editingCost, setEditingCost] = useState<{
    itemId: string;
    platformId: string;
    returnShippingDeduction: number;
  } | null>(null);
  const [costErrorMsg, setCostErrorMsg] = useState<string | null>(null);
  const [isSavingCost, setIsSavingCost] = useState(false);
  const [togglingPlatformId, setTogglingPlatformId] = useState<string | null>(null);

  const openAddModal = () => {
    setEditingPlatform(null);
    setName('');
    setDiscountPercentage(10);
    setPickupFee(0);
    setPickupFeeMode('platform');
    setEnableBnpl(false);
    setBnplPercentage(0);
    setNotes('');
    setStatus('نشطة');
    setErrorMsg(null);
    setIsModalOpen(true);
  };

  const openEditModal = (plt: Platform) => {
    setEditingPlatform(plt);
    setName(plt.name);
    setDiscountPercentage(plt.discountPercentage);
    setPickupFee(plt.pickupFee ?? 0);
    setPickupFeeMode(plt.pickupFeeMode === 'product' ? 'product' : 'platform');
    setEnableBnpl(Boolean(plt.enableBnpl));
    setBnplPercentage(plt.bnplPercentage ?? 0);
    setNotes(plt.notes || '');
    setStatus(plt.status === 'موقوفة' || plt.status === 'inactive' ? 'موقوفة' : 'نشطة');
    setErrorMsg(null);
    setIsModalOpen(true);
  };

  const handleTogglePlatformStatus = async (plt: Platform) => {
    if (togglingPlatformId) return;
    const isCurrentlyActive = plt.status !== 'موقوفة' && plt.status !== 'inactive';
    const newStatus = isCurrentlyActive ? 'موقوفة' : 'نشطة';
    setTogglingPlatformId(plt.id);
    setPageError(null);
    try {
      await onSavePlatform({
        id: plt.id,
        name: plt.name,
        discountPercentage: plt.discountPercentage,
        pickupFee: plt.pickupFee,
        pickupFeeMode: plt.pickupFeeMode || 'platform',
        enableBnpl: plt.enableBnpl,
        bnplPercentage: plt.bnplPercentage,
        notes: plt.notes,
        status: newStatus
      });
    } catch (err: any) {
      setPageError(err.message || 'فشل تغيير حالة المنصة');
    } finally {
      setTogglingPlatformId(null);
    }
  };

  const handlePlatformSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!name.trim()) {
      setErrorMsg('يرجى إدخال اسم المنصة');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await onSavePlatform({
        id: editingPlatform?.id,
        name: name.trim(),
        discountPercentage: Number(discountPercentage) || 0,
        pickupFee: Number(pickupFee) >= 0 ? Number(pickupFee) : 0,
        pickupFeeMode,
        enableBnpl: Boolean(enableBnpl),
        bnplPercentage: Number(bnplPercentage) || 0,
        notes: notes.trim(),
        status
      });
      setIsModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء حفظ المنصة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCostSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCost || isSavingCost) return;
    setIsSavingCost(true);
    setCostErrorMsg(null);
    try {
      await onSaveCost(editingCost);
      setEditingCost(null);
    } catch (err: any) {
      setCostErrorMsg(err?.message || 'حدث خطأ أثناء حفظ تكلفة الشحن');
    } finally {
      setIsSavingCost(false);
    }
  };

  const activeCount = platforms.filter(p => p.status !== 'موقوفة' && p.status !== 'inactive').length;

  const platformHeaderMeta: Record<PlatformTab, { title: string; subtitle: string }> = {
    platforms: {
      title: 'المنصات',
      subtitle: 'إدارة المنصات الإلكترونية ونسب الخصم ورسوم الالتقاط والأرصدة الآجلة'
    },
    creditCollection: {
      title: 'تحصيل آجل المنصات',
      subtitle: 'متابعة وتحصيل المستحقات الآجلة على منصات البيع'
    },
    platformReport: {
      title: 'تقرير المنصة التفصيلي',
      subtitle: 'تحليل مبيعات وعمولات ومرتجعات وصافي كل منصة'
    },
    shippingCosts: {
      title: 'استقطاعات شحن المرتجع',
      subtitle: 'تكاليف شحن الأصناف المخصومة تلقائياً عند تسجيل مرتجع على المنصة'
    }
  };

  return (
    <PageSurface
      dir="rtl"
      title={platformHeaderMeta[activeTab].title}
      subtitle={platformHeaderMeta[activeTab].subtitle}
      actions={
        activeTab === 'platforms' && isManager ? (
          <button
            type="button"
            data-shortcut-add="true"
            onClick={openAddModal}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white font-bold text-xs transition cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة منصة أو عميل جديد</span>
            <ShortcutBadge actionId="general.add_new" className="bg-white/20 text-white border-white/30" />
          </button>
        ) : undefined
      }
    >
      {pageError && (
        <div className="no-print px-4 py-2.5 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{pageError}</span>
          </div>
          <button
            type="button"
            onClick={() => setPageError(null)}
            aria-label="إغلاق التنبيه"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {activeTab === 'platforms' ? (
        <div className="space-y-4">
          {/* سطر ملخص وإجراء رئيسي */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border-subtle)]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]">
              <span>
                إجمالي المنصات:{' '}
                <strong className="font-mono tabular-nums text-[var(--text-primary)]">{platforms.length}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                النشطة:{' '}
                <strong className="font-mono tabular-nums ui-stock-in">{activeCount}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>لا يتم حذف المنصات لحماية الفواتير التاريخية ويمكن إيقافها مؤقتاً</span>
            </div>

            {isManager && (
              <button
                type="button"
                onClick={openAddModal}
                className="no-print min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white font-bold text-xs transition cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة منصة أو عميل جديد</span>
              </button>
            )}
          </div>

          <SectionHeading title={`قائمة المنصات (${platforms.length})`} />

          <CompactTable ariaLabel="جدول المنصات">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المنصة</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الحالة</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>نسبة الخصم %</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>رسوم الالتقاط</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>طريقة الالتقاط</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>تقسيط BNPL</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>رصيد الآجل</th>
                {(isManager || canViewPlatformReport || canCollectCredit) && (
                  <th className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>الإجراءات</th>
                )}
              </tr>
            </thead>
            <tbody>
              {platforms.map(plt => {
                const isActive = plt.status !== 'موقوفة' && plt.status !== 'inactive';
                const balance = Number(plt.currentBalance || 0);
                return (
                  <tr key={plt.id} className={!isActive ? 'opacity-70' : ''}>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>
                      <div className="font-bold text-[var(--text-primary)]">{plt.name}</div>
                      {plt.notes && (
                        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{plt.notes}</p>
                      )}
                    </td>
                    <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                      <span className={isActive ? 'ui-stock-in' : 'ui-stock-out'}>
                        {isActive ? 'نشطة' : 'موقوفة'}
                      </span>
                    </td>
                    <td className={`text-center font-mono font-bold text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {plt.discountPercentage}%
                    </td>
                    <td className={`text-center font-mono font-bold ui-stock-low ${COMPACT_TABLE_NUM_CLASS}`}>
                      {plt.pickupFee !== undefined && plt.pickupFee > 0 ? `${plt.pickupFee} ج.م` : '0.00 ج.م'}
                    </td>
                    <td className={`text-center text-xs font-semibold text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {plt.pickupFeeMode === 'product' ? 'حسب الصنف' : 'على المنصة'}
                    </td>
                    <td className={`text-center font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                      {plt.enableBnpl ? (
                        <span className="ui-money-sale">+{plt.bnplPercentage || 0}%</span>
                      ) : (
                        <span className="text-[var(--text-secondary)]">—</span>
                      )}
                    </td>
                    <td className={`text-left font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                      <span
                        className={
                          balance > 0
                            ? 'ui-stock-out'
                            : balance < 0
                            ? 'ui-stock-in'
                            : 'text-[var(--text-secondary)]'
                        }
                      >
                        {balance > 0
                          ? `مدين ${balance.toFixed(2)}`
                          : balance < 0
                          ? `دائن ${Math.abs(balance).toFixed(2)}`
                          : '0.00'}
                      </span>
                    </td>
                    {(isManager || canViewPlatformReport || canCollectCredit) && (
                      <td className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                        <div className="inline-flex items-center gap-1.5">
                          {canCollectCredit && (
                            <a
                              href={getHrefForTarget('platforms', 'creditCollection', {
                                searchParams: { platformId: plt.id }
                              })}
                              onClick={(e) => {
                                if (!isPlainLeftClick(e)) return;
                                e.preventDefault();
                                setSelectedReportPlatformId(plt.id);
                                if (onNavigate) {
                                  onNavigate('platforms', 'creditCollection', {
                                    searchParams: { platformId: plt.id }
                                  });
                                } else {
                                  setActiveTab('creditCollection');
                                }
                              }}
                              className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-low text-xs font-bold transition cursor-pointer"
                            >
                              <Wallet className="w-3.5 h-3.5" />
                              <span>تحصيل</span>
                            </a>
                          )}
                          {canViewPlatformReport && (
                            <a
                              href={getHrefForTarget('platforms', 'platformReport', {
                                searchParams: { platformId: plt.id }
                              })}
                              onClick={(e) => {
                                if (!isPlainLeftClick(e)) return;
                                e.preventDefault();
                                setSelectedReportPlatformId(plt.id);
                                if (onNavigate) {
                                  onNavigate('platforms', 'platformReport', {
                                    searchParams: { platformId: plt.id }
                                  });
                                } else {
                                  setActiveTab('platformReport');
                                }
                              }}
                              className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-money-sale text-xs font-bold transition cursor-pointer"
                            >
                              <BarChart3 className="w-3.5 h-3.5" />
                              <span>التقرير</span>
                            </a>
                          )}
                          {isManager && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleTogglePlatformStatus(plt)}
                                disabled={togglingPlatformId === plt.id}
                                className={`min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold transition cursor-pointer disabled:opacity-50 ${
                                  isActive ? 'ui-stock-out' : 'ui-stock-in'
                                }`}
                              >
                                {isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                                <span>{togglingPlatformId === plt.id ? 'جارِ...' : isActive ? 'إيقاف' : 'تنشيط'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(plt)}
                                className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                <span>تعديل</span>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {platforms.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-[var(--text-secondary)]">
                    لا توجد منصات مسجلة
                  </td>
                </tr>
              )}
            </tbody>
          </CompactTable>
        </div>
      ) : activeTab === 'creditCollection' ? (
        <CreditCollectionView
          embedded
          user={user}
          initialPartyType="platform"
          initialPartyId={selectedReportPlatformId}
          platforms={platforms}
        />
      ) : activeTab === 'platformReport' && canViewPlatformReport ? (
        <PlatformReportView
          embedded
          platforms={platforms}
          initialPlatformId={selectedReportPlatformId}
          onSelectPlatformId={setSelectedReportPlatformId}
        />
      ) : (
        <div className="space-y-4">
          <SectionHeading
            title="جدول تكاليف شحن الأصناف واستقطاع المرتجع"
            actions={
              <span className="text-xs text-[var(--text-secondary)]">
                تُخصم قيمة شحن المرتجع تلقائياً عند تسجيل أي إرجاع للصنف على المنصة
              </span>
            }
          />

          <CompactTable ariaLabel="جدول استقطاعات شحن المرتجع">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصنف</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المنصة</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>خصم الشحن عند المرتجع</th>
                <th className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item =>
                platforms.map(plt => {
                  const cost = costs.find(c => c.itemId === item.id && c.platformId === plt.id);
                  const returnDed = cost?.returnShippingDeduction || 0;

                  return (
                    <tr key={`${item.id}-${plt.id}`}>
                      <td className={`font-bold text-[var(--text-primary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {item.name}
                      </td>
                      <td className={`font-semibold text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                        {plt.name}
                      </td>
                      <td className={`text-left font-mono font-bold ui-stock-out ${COMPACT_TABLE_NUM_CLASS}`}>
                        {returnDed} ج.م
                      </td>
                      <td className={`no-print text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setCostErrorMsg(null);
                            setEditingCost({
                              itemId: item.id,
                              platformId: plt.id,
                              returnShippingDeduction: returnDed
                            });
                          }}
                          className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold cursor-pointer"
                          title="تعديل التكلفة"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>تعديل</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* Platform Edit / Add Modal */}
      {isModalOpen && (
        <ModalShell
          title={editingPlatform ? 'تعديل بيانات المنصة' : 'إضافة منصة أو عميل جديد'}
          onClose={() => setIsModalOpen(false)}
          closeDisabled={isSubmitting}
        >
          <form onSubmit={handlePlatformSubmit} className="space-y-4">
            {errorMsg && (
              <div className="px-3 py-2 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                  اسم المنصة أو العميل <span className="ui-stock-out">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: نون إكسبريس..."
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} font-bold`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                  حالة المنصة
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
                >
                  <option value="نشطة">نشطة (تظهر في البيع)</option>
                  <option value="موقوفة">موقوفة (تاريخية فقط)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                  نسبة الخصم / العمولة (%) <span className="ui-stock-out">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  required
                  dir="ltr"
                  value={discountPercentage}
                  onChange={(e) => setDiscountPercentage(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="12.65"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono font-bold text-center`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                  رسوم الالتقاط (ج.م/قطعة)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  dir="ltr"
                  value={pickupFee}
                  onChange={(e) => setPickupFee(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="0.00"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono font-bold text-center`}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                  طريقة رسوم الالتقاط
                </label>
                <select
                  value={pickupFeeMode}
                  onChange={(e) => setPickupFeeMode(e.target.value === 'product' ? 'product' : 'platform')}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
                >
                  <option value="platform">ثابتة على مستوى المنصة</option>
                  <option value="product">حسب الصنف</option>
                </select>
              </div>
            </div>

            {/* تقسيط المنصات BNPL — بدون صندوق ملون */}
            <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-4">
              <label className="min-h-[44px] flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableBnpl}
                  onChange={(e) => setEnableBnpl(e.target.checked)}
                  className="w-4 h-4 rounded cursor-pointer"
                />
                <span className="text-xs font-bold text-[var(--text-primary)]">
                  تفعيل تقسيط المنصة (BNPL)
                </span>
              </label>

              {enableBnpl && (
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-[var(--text-secondary)]">
                    نسبة الزيادة الافتراضية (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    dir="ltr"
                    value={bnplPercentage}
                    onChange={(e) =>
                      setBnplPercentage(
                        e.target.value === '' ? '' : Math.min(100, Math.max(0, Number(e.target.value)))
                      )
                    }
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono font-bold text-center`}
                    placeholder="20"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                ملاحظات أو شروط خاصة
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات حول طريقة التسليم أو العمولات الإضافية..."
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs resize-none`}
              />
            </div>

            <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{isSubmitting ? 'جارِ الحفظ...' : 'حفظ بيانات المنصة'}</span>
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* ItemPlatformCost Modal */}
      {editingCost && (
        <ModalShell
          title="تعديل تكاليف شحن المنصة"
          onClose={() => setEditingCost(null)}
          closeDisabled={isSavingCost}
        >
          <form onSubmit={handleCostSave} className="space-y-4">
            {costErrorMsg && (
              <div className="px-3 py-2 rounded-lg border border-[var(--stock-out-fg)] ui-stock-out text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{costErrorMsg}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                قيمة خصم المنصة من الشحن عند المرتجع (ج.م)
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                dir="ltr"
                value={editingCost.returnShippingDeduction}
                onChange={(e) => setEditingCost({ ...editingCost, returnShippingDeduction: Number(e.target.value) || 0 })}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-mono font-bold text-center`}
              />
            </div>

            <div className="pt-3 border-t border-[var(--border-subtle)] flex justify-end gap-2">
              <button
                type="button"
                disabled={isSavingCost}
                onClick={() => setEditingCost(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] disabled:opacity-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSavingCost}
                className="min-h-[44px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {isSavingCost ? 'جارِ الحفظ...' : 'حفظ'}
              </button>
            </div>
          </form>
        </ModalShell>
      )}
    </PageSurface>
  );
};

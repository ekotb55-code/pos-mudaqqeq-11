import React, { useState, useEffect, useCallback } from 'react';
import {
  Percent,
  Search,
  Package,
  Building2,
  Receipt,
  ShieldAlert,
  Loader2,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  X
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Platform, UserAccount, BnplReport } from '../../types';
import { api } from '../../api/client';
import { hasPermission } from '../../utils/permissions';
import { DateRange, formatMoney, toCairoDateStr } from '../../utils/dateUtils';
import { DateRangeFilter } from '../DateRangeFilter';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ReportSummaryTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
  type ReportSummaryRow
} from '../ui';

interface BnplReportViewProps {
  user: UserAccount | null;
  userRole?: string;
  platforms: Platform[];
  initialDateRange?: DateRange;
}

export const BnplReportView: React.FC<BnplReportViewProps> = ({
  user,
  userRole,
  platforms,
  initialDateRange
}) => {
  const isDesigner = user?.role === 'designer' || userRole === 'designer' || Boolean(user?.isOwner);
  const canViewBnpl = isDesigner || (user ? hasPermission(user, 'reports.bnpl_view') : userRole === 'manager');

  // Filters state
  const [dateRange, setDateRange] = useState<DateRange>(() => initialDateRange || { from: null, to: null });
  const [selectedPlatformId, setSelectedPlatformId] = useState<string>('ALL');
  const [productQuery, setProductQuery] = useState<string>('');
  const [groupBy, setGroupBy] = useState<'item' | 'platform' | 'invoice'>('item');

  // Data state
  const [reportData, setReportData] = useState<BnplReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!canViewBnpl) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.getBnplReport({
        from: dateRange.from,
        to: dateRange.to,
        platformId: selectedPlatformId !== 'ALL' ? selectedPlatformId : undefined,
        productQuery: productQuery.trim() || undefined,
        groupBy
      });

      if (res.success && res.report) {
        setReportData(res.report);
      } else {
        setErrorMessage(res.error || 'تعذر تحميل تقرير BNPL');
      }
    } catch (err: any) {
      console.error('Failed to load BNPL report:', err);
      setErrorMessage(err.message || 'حدث خطأ أثناء تحميل التقرير');
    } finally {
      setIsLoading(false);
    }
  }, [canViewBnpl, dateRange.from, dateRange.to, selectedPlatformId, productQuery, groupBy]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const summary = reportData?.summary;
  const rows = reportData?.rows || [];

  // Export to Excel
  const handleExportExcel = () => {
    if (!rows.length) return;
    const exportRows = rows.map((r, idx) => ({
      '#': idx + 1,
      'التاريخ': r.date,
      'رقم الفاتورة': r.invoiceNumber,
      'المنصة': r.platformName,
      'الصنف': r.itemName,
      'الكمية': r.quantity,
      'السعر الأساسي': r.baseUnitPrice,
      'نسبة BNPL %': `${r.bnplPercent}%`,
      'سعر العميل': r.customerUnitPrice,
      'زيادة السعر': r.priceIncrease ?? 0,
      'مبلغ BNPL المستقطع': r.bnplAmount,
      'عمولة المنصة': r.commission,
      'الصافي': r.net
    }));

    if (summary) {
      exportRows.push({
        '#': 'الإجمالي' as any,
        'التاريخ': '-',
        'رقم الفاتورة': `${summary.invoicesCount} فواتير`,
        'المنصة': '-',
        'الصنف': '-',
        'الكمية': summary.piecesCount,
        'السعر الأساسي': summary.piecesCount > 0 ? Math.round((summary.totalBaseAmount / summary.piecesCount) * 100) / 100 : 0,
        'نسبة BNPL %': summary.totalBaseAmount > 0 ? `${(Math.round(((summary.totalPriceIncrease ?? summary.totalBnplAmount) / summary.totalBaseAmount) * 10000) / 100)}%` : '0%',
        'سعر العميل': summary.piecesCount > 0 ? Math.round((summary.totalCustomerPaid / summary.piecesCount) * 100) / 100 : 0,
        'زيادة السعر': summary.totalPriceIncrease ?? 0,
        'مبلغ BNPL المستقطع': summary.totalBnplAmount,
        'عمولة المنصة': summary.totalCommission,
        'الصافي': summary.totalLinesNet
      });
    }

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تقرير BNPL');
    const today = toCairoDateStr(new Date());
    XLSX.writeFile(wb, `تقرير_تقسيط_المنصات_BNPL_${today}.xlsx`);
  };

  if (!canViewBnpl) {
    return (
      <PageSurface dir="rtl" title="تقرير تقسيط المنصات (BNPL)">
        <div className="py-10 flex items-center gap-2 ui-stock-out text-sm font-bold">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>
            غير مصرح بعرض تقرير تقسيط المنصات (BNPL) — يتطلب صلاحية reports.bnpl_view.
          </span>
        </div>
      </PageSurface>
    );
  }

  const summaryRows: ReportSummaryRow[] = [
    {
      label: 'الفواتير والقطع',
      value: `${summary ? summary.invoicesCount : 0} فاتورة • ${summary ? summary.piecesCount : 0} قطعة`
    },
    {
      label: 'ما دفعه العميل (السعر المعروض للعميل)',
      value: `${formatMoney(summary?.totalCustomerPaid)} ج.م`
    },
    {
      label: 'زيادة السعر (فرق السعر المرفوع للعميل)',
      value: `+ ${formatMoney(summary?.totalPriceIncrease)} ج.م`,
      valueClassName: 'ui-link'
    },
    {
      label: 'مبلغ BNPL المستقطع (على سعر العميل)',
      value: `- ${formatMoney(summary?.totalBnplAmount)} ج.م`,
      valueClassName: 'ui-stock-out'
    },
    {
      label: 'السعر الأساسي (قيمة المبيعات الأصلية)',
      value: `${formatMoney(summary?.totalBaseAmount)} ج.م`
    },
    {
      label: 'عمولة المنصات (المحفوظة بالسطر)',
      value: `- ${formatMoney(summary?.totalCommission)} ج.م`,
      valueClassName: 'ui-stock-out'
    },
    {
      label: 'صافي الأسطر (سعر العميل − الاستقطاع − العمولة)',
      value: `${formatMoney(summary?.totalLinesNet)} ج.م`,
      valueClassName: 'ui-money-purchase'
    },
    {
      label: 'صافي الخزنة الفعلي (المسجل في الخزينة)',
      value: `${formatMoney(summary?.totalInvoicesNetInCashbox)} ج.م`,
      valueClassName: 'ui-money-purchase'
    }
  ];

  return (
    <PageSurface
      dir="rtl"
      title="تقرير تقسيط المنصات (BNPL)"
      subtitle="تحليل مبيعات الأقساط، زيادة السعر، مبلغ BNPL المستقطع، والعمولات المحفوظة بالسطور"
    >
      {/* صف الفلاتر المضغوط مع أزرار التصدير والطباعة */}
      <div className="flex flex-wrap items-end gap-3 pb-4 border-b border-[var(--border-subtle)]">
        <DateRangeFilter
          inline
          value={dateRange}
          onChange={(newRange) => setDateRange(newRange)}
          storageKey="bnpl_report_date"
          showPresets={true}
        />

        <div className="no-print">
          <label
            htmlFor="bnpl-platform-filter"
            className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
          >
            المنصة
          </label>
          <select
            id="bnpl-platform-filter"
            value={selectedPlatformId}
            onChange={(e) => setSelectedPlatformId(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
          >
            <option value="ALL">جميع المنصات</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.enableBnpl ? `(BNPL ${p.bnplPercentage || 0}%)` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="no-print">
          <label
            htmlFor="bnpl-product-search"
            className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
          >
            الصنف (الاسم / الكود / الباركود)
          </label>
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 pointer-events-none" />
            <input
              id="bnpl-product-search"
              type="text"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="ابحث بالاسم أو الباركود..."
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} pr-9 pl-8 text-xs`}
            />
            {productQuery && (
              <button
                type="button"
                onClick={() => setProductQuery('')}
                aria-label="مسح البحث"
                className="absolute left-2 min-w-[28px] min-h-[28px] inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="no-print">
          <span className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            تجميع حسب
          </span>
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setGroupBy('item')}
              className={`min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                groupBy === 'item'
                  ? 'bg-[#1668B2] border-[#1668B2] text-white'
                  : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>الصنف</span>
            </button>
            <button
              type="button"
              onClick={() => setGroupBy('platform')}
              className={`min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                groupBy === 'platform'
                  ? 'bg-[#1668B2] border-[#1668B2] text-white'
                  : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>المنصة</span>
            </button>
            <button
              type="button"
              onClick={() => setGroupBy('invoice')}
              className={`min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                groupBy === 'invoice'
                  ? 'bg-[#1668B2] border-[#1668B2] text-white'
                  : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>الفاتورة</span>
            </button>
          </div>
        </div>

        <div className="no-print inline-flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={!rows.length || isLoading}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>تصدير Excel</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            disabled={!rows.length || isLoading}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة</span>
          </button>

          <button
            type="button"
            onClick={loadReport}
            disabled={isLoading}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
        </div>

        <div className="print-only print-filter-summary">
          المنصة: {selectedPlatformId === 'ALL' ? 'جميع المنصات' : platforms.find(p => p.id === selectedPlatformId)?.name || selectedPlatformId} • تجميع حسب:{' '}
          {groupBy === 'item' ? 'الصنف' : groupBy === 'platform' ? 'المنصة' : 'الفاتورة'}
          {productQuery.trim() ? ` • البحث: ${productQuery.trim()}` : ''}
        </div>
      </div>

      {/* رسالة الخطأ */}
      {errorMessage && (
        <div role="alert" className="no-print text-xs font-bold ui-stock-out flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* جدول المؤشرات الرقمية المختصر من عمودين */}
      <section className="space-y-4">
        <SectionHeading
          title="ملخص المؤشرات الرقمية"
          actions={
            <span className="text-xs text-[var(--text-secondary)]">
              عدد السجلات المعروضة: <strong className="text-[var(--text-primary)] tabular-nums">{rows.length}</strong>
            </span>
          }
        />
        <ReportSummaryTable rows={summaryRows} ariaLabel="ملخص مؤشرات تقرير BNPL" />
      </section>

      {/* جدول بيانات التقرير */}
      <section className="space-y-4">
        <SectionHeading title="تفاصيل مبيعات التقسيط (BNPL)" withTopDivider />

        {isLoading ? (
          <div className="py-10 flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
            <Loader2 className="w-4 h-4 ui-link animate-spin" />
            <span>جاري تجميع واحتساب بيانات BNPL...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-xs text-[var(--text-secondary)] flex items-center gap-2">
            <Percent className="w-4 h-4" />
            <span>
              لا توجد مبيعات تقسيط (BNPL) مطابقة للفلاتر — تأكد من اختيار الفترة الصحيحة ووجود مبيعات مفعّل بها BNPL.
            </span>
          </div>
        ) : (
          <CompactTable ariaLabel="جدول تقرير تقسيط المنصات BNPL">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>التاريخ</th>
                <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم الفاتورة</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المنصة</th>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصنف</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الكمية</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>السعر الأساسي</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>نسبة BNPL</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>سعر العميل</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>زيادة السعر</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>مبلغ BNPL المستقطع</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>العمولة</th>
                <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>الصافي</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={`text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                    {row.date}
                  </td>
                  <td className={`font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                    {row.invoiceNumber}
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    {row.platformName}
                  </td>
                  <td className={COMPACT_TABLE_TEXT_CLASS}>
                    <div className="font-semibold">{row.itemName}</div>
                    {row.itemBarcode && (
                      <div className="text-[11px] text-[var(--text-secondary)] font-mono">
                        {row.itemBarcode}
                      </div>
                    )}
                  </td>
                  <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                    {row.quantity}
                  </td>
                  <td className={`text-left font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                    {formatMoney(row.baseUnitPrice)}
                  </td>
                  <td className={`text-center font-mono font-semibold ui-link ${COMPACT_TABLE_NUM_CLASS}`}>
                    +{row.bnplPercent}%
                  </td>
                  <td className={`text-left font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                    {formatMoney(row.customerUnitPrice)}
                  </td>
                  <td className={`text-left font-mono font-bold ui-link ${COMPACT_TABLE_NUM_CLASS}`}>
                    + {formatMoney(row.priceIncrease ?? 0)}
                  </td>
                  <td className={`text-left font-mono font-bold ui-stock-out ${COMPACT_TABLE_NUM_CLASS}`}>
                    - {formatMoney(row.bnplAmount)}
                  </td>
                  <td className={`text-left font-mono font-bold ui-stock-out ${COMPACT_TABLE_NUM_CLASS}`}>
                    - {formatMoney(row.commission)}
                  </td>
                  <td className={`text-left font-mono font-bold ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                    {formatMoney(row.net)}
                  </td>
                </tr>
              ))}
            </tbody>

            {/* صف الإجماليات */}
            {summary && (
              <tfoot>
                <tr className="border-t-2 border-[var(--border-color)] bg-[var(--surface-subtle)] font-bold">
                  <td className="py-2.5 px-3 text-xs">الإجمالي العام</td>
                  <td className={`py-2.5 px-3 font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                    {summary.invoicesCount} فواتير
                  </td>
                  <td className="py-2.5 px-3 text-[var(--text-secondary)]">-</td>
                  <td className={`py-2.5 px-3 ${COMPACT_TABLE_TEXT_CLASS}`}>
                    {rows.length} {groupBy === 'item' ? 'أصناف' : groupBy === 'platform' ? 'منصات' : 'فواتير'}
                  </td>
                  <td className={`py-2.5 px-3 text-center font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                    {summary.piecesCount}
                  </td>
                  <td className={`py-2.5 px-3 text-left font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                    {summary.piecesCount > 0 ? formatMoney(summary.totalBaseAmount / summary.piecesCount) : '0.00'}
                  </td>
                  <td className={`py-2.5 px-3 text-center font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                    {summary.totalBaseAmount > 0
                      ? `${(Math.round(((summary.totalPriceIncrease ?? summary.totalBnplAmount) / summary.totalBaseAmount) * 10000) / 100)}%`
                      : '0%'}
                  </td>
                  <td className={`py-2.5 px-3 text-left font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                    {summary.piecesCount > 0 ? formatMoney(summary.totalCustomerPaid / summary.piecesCount) : '0.00'}
                  </td>
                  <td className={`py-2.5 px-3 text-left font-mono ui-link ${COMPACT_TABLE_NUM_CLASS}`}>
                    + {formatMoney(summary.totalPriceIncrease ?? 0)}
                  </td>
                  <td className={`py-2.5 px-3 text-left font-mono ui-stock-out ${COMPACT_TABLE_NUM_CLASS}`}>
                    - {formatMoney(summary.totalBnplAmount)}
                  </td>
                  <td className={`py-2.5 px-3 text-left font-mono ui-stock-out ${COMPACT_TABLE_NUM_CLASS}`}>
                    - {formatMoney(summary.totalCommission)}
                  </td>
                  <td className={`py-2.5 px-3 text-left font-mono ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                    {formatMoney(summary.totalLinesNet)}
                  </td>
                </tr>
              </tfoot>
            )}
          </CompactTable>
        )}
      </section>
    </PageSurface>
  );
};


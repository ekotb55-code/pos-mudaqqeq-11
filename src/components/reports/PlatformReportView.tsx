import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Platform, PlatformReport } from '../../types';
import { api } from '../../api/client';
import { DateRangeFilter } from '../DateRangeFilter';
import { DateRange, getDateRangeForPreset, toCairoDateStr } from '../../utils/dateUtils';
import {
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Printer
} from 'lucide-react';
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

interface PlatformReportViewProps {
  platforms: Platform[];
  initialPlatformId?: string;
  onSelectPlatformId?: (id: string) => void;
  embedded?: boolean;
}

export const PlatformReportView: React.FC<PlatformReportViewProps> = ({
  platforms,
  initialPlatformId,
  onSelectPlatformId,
  embedded = false
}) => {
  const [selectedPlatformId, setSelectedPlatformId] = useState<string>(
    initialPlatformId || platforms[0]?.id || ''
  );
  const [dateRange, setDateRange] = useState<DateRange>(() =>
    getDateRangeForPreset('THIS_MONTH')
  );
  const [stagnantDays, setStagnantDays] = useState<number>(30);
  const [stagnantDaysInput, setStagnantDaysInput] = useState<string>('30');
  const [report, setReport] = useState<PlatformReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPlatformId && initialPlatformId !== selectedPlatformId) {
      setSelectedPlatformId(initialPlatformId);
    } else if (!selectedPlatformId && platforms.length > 0) {
      setSelectedPlatformId(platforms[0].id);
    }
  }, [initialPlatformId, platforms]);

  const fetchReport = async () => {
    if (!selectedPlatformId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPlatformReport({
        platformId: selectedPlatformId,
        from: dateRange.from,
        to: dateRange.to,
        stagnantDays
      });
      if (res.success && res.report) {
        setReport(res.report);
      } else {
        setError(res.error || 'تعذر تحميل تقرير المنصة');
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء تحميل تقرير المنصة');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [selectedPlatformId, dateRange.from, dateRange.to, stagnantDays]);

  const handlePlatformChange = (id: string) => {
    setSelectedPlatformId(id);
    if (onSelectPlatformId) onSelectPlatformId(id);
  };

  const handleApplyStagnantDays = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Math.max(1, parseInt(stagnantDaysInput, 10) || 30);
    setStagnantDaysInput(String(parsed));
    setStagnantDays(parsed);
  };

  const summary = report?.summary;
  const maxDailyGross = report?.dailySales?.length
    ? Math.max(...report.dailySales.map(d => d.grossSales), 1)
    : 1;

  const handleExportExcel = () => {
    if (!report || !summary) return;
    const wb = XLSX.utils.book_new();
    const summarySheetRows = [
      { 'البند': 'المنصة', 'القيمة': summary.platformName },
      { 'البند': 'عدد الفواتير الصافية', 'القيمة': summary.invoicesCount },
      { 'البند': 'متوسط الفاتورة', 'القيمة': Number(summary.averageInvoiceValue.toFixed(2)) },
      { 'البند': 'إجمالي المبيعات (سعر العميل)', 'القيمة': Number(summary.totalGrossSales.toFixed(2)) },
      { 'البند': 'المبيعات بالسعر الأساسي', 'القيمة': Number(summary.totalBaseSales.toFixed(2)) },
      { 'البند': 'زيادة السعر (BNPL)', 'القيمة': Number((summary.totalPriceIncrease ?? 0).toFixed(2)) },
      { 'البند': 'مبلغ BNPL المستقطع', 'القيمة': Number(summary.totalBnplAmount.toFixed(2)) },
      { 'البند': 'العمولة المحفوظة', 'القيمة': Number(summary.totalCommission.toFixed(2)) },
      { 'البند': 'رسوم الالتقاط', 'القيمة': Number(summary.totalPickupFees.toFixed(2)) },
      { 'البند': 'صافي المنصة المستحق', 'القيمة': Number(summary.totalNet.toFixed(2)) },
      { 'البند': 'الربح التقديري', 'القيمة': Number(summary.estimatedProfit.toFixed(2)) },
      { 'البند': 'هامش الربح %', 'القيمة': Number(summary.profitMargin.toFixed(2)) },
      { 'البند': 'رصيد الآجل المعلّق', 'القيمة': Number(summary.pendingDeferredBalance.toFixed(2)) }
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheetRows), 'ملخص_المنصة');

    if (report.topByQuantity.length > 0) {
      const qtyRows = report.topByQuantity.map((it, idx) => ({
        '#': idx + 1,
        'الصنف': it.itemName,
        'الكمية المباعة': it.quantity,
        'الإيراد': Number(it.revenue.toFixed(2)),
        'الربح التقديري': Number(it.profit.toFixed(2))
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(qtyRows), 'الأعلى_بالكمية');
    }

    if (report.stagnantItems.length > 0) {
      const stagRows = report.stagnantItems.map(st => ({
        'الصنف': st.itemName,
        'الباركود': st.barcode || '-',
        'المخزون المتاح': st.stockQuantity,
        'سعر البيع': Number(st.salePrice.toFixed(2)),
        'مدة الركود (يوم)': st.daysSinceLastSale ?? 'لم يُبع'
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stagRows), 'الأصناف_الراكدة');
    }

    const today = toCairoDateStr(new Date());
    XLSX.writeFile(wb, `تقرير_المنصة_${summary.platformName}_${today}.xlsx`);
  };

  const summaryRows: ReportSummaryRow[] = summary
    ? [
        {
          label: 'عدد الفواتير الصافية',
          value: summary.invoicesCount,
          note: `متوسط الفاتورة: ${summary.averageInvoiceValue.toFixed(2)} ج.م`
        },
        {
          label: 'إجمالي المبيعات (سعر العميل)',
          value: `${summary.totalGrossSales.toFixed(2)} ج.م`
        },
        {
          label: 'المبيعات بالسعر الأساسي (بعد خصم المرتجعات)',
          value: `${summary.totalBaseSales.toFixed(2)} ج.م`
        },
        {
          label: 'زيادة السعر (BNPL) — فرق السعر المرفوع للعميل',
          value: `+ ${(summary.totalPriceIncrease ?? 0).toFixed(2)} ج.م`,
          valueClassName: 'ui-link'
        },
        {
          label: 'مبلغ BNPL المستقطع للمنصة',
          value: `- ${summary.totalBnplAmount.toFixed(2)} ج.م`,
          valueClassName: 'ui-stock-out'
        },
        {
          label: `العمولة المحفوظة${summary.totalPickupFees > 0 ? ' (+ رسوم الالتقاط)' : ''}`,
          value: `${summary.totalCommission.toFixed(2)}${summary.totalPickupFees > 0 ? ` (+${summary.totalPickupFees.toFixed(2)})` : ''} ج.م`,
          valueClassName: 'ui-stock-out'
        },
        {
          label: 'صافي المنصة المستحق',
          value: `${summary.totalNet.toFixed(2)} ج.م`,
          valueClassName: 'ui-money-sale'
        },
        {
          label: 'الربح التقديري ونسبته',
          value: `${summary.estimatedProfit.toFixed(2)} ج.م (${summary.profitMargin.toFixed(2)}%)`,
          valueClassName: summary.estimatedProfit >= 0 ? 'ui-money-purchase' : 'ui-stock-out'
        },
        {
          label: 'رصيد الآجل المعلّق على المنصة',
          value: `${summary.pendingDeferredBalance.toFixed(2)} ج.م`,
          valueClassName: 'ui-stock-low'
        }
      ]
    : [];

  const topQtyTotalQty = report?.topByQuantity.reduce((s, x) => s + x.quantity, 0) ?? 0;
  const topQtyTotalRev = report?.topByQuantity.reduce((s, x) => s + x.revenue, 0) ?? 0;
  const topQtyTotalProfit = report?.topByQuantity.reduce((s, x) => s + x.profit, 0) ?? 0;

  const topRevTotalRev = report?.topByRevenue.reduce((s, x) => s + x.revenue, 0) ?? 0;
  const topRevTotalQty = report?.topByRevenue.reduce((s, x) => s + x.quantity, 0) ?? 0;
  const topRevTotalProfit = report?.topByRevenue.reduce((s, x) => s + x.profit, 0) ?? 0;

  const stagnantTotalStock = report?.stagnantItems.reduce((s, x) => s + x.stockQuantity, 0) ?? 0;

  const content = (
    <>
      {/* صف الفلاتر المضغوط مع أزرار التصدير والطباعة */}
      <div className="flex flex-wrap items-end gap-3 pb-4 border-b border-[var(--border-subtle)]">
        <div className="no-print">
          <label
            htmlFor="platform-report-select"
            className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
          >
            المنصة
          </label>
          <select
            id="platform-report-select"
            value={selectedPlatformId}
            onChange={(e) => handlePlatformChange(e.target.value)}
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-semibold`}
          >
            {platforms.map(plt => (
              <option key={plt.id} value={plt.id}>
                {plt.name} ({plt.discountPercentage}%)
              </option>
            ))}
          </select>
        </div>

        <DateRangeFilter
          inline
          value={dateRange}
          onChange={setDateRange}
          storageKey="platform_report_date_range"
          defaultPreset="THIS_MONTH"
        />

        <form onSubmit={handleApplyStagnantDays} className="no-print flex items-end gap-2">
          <div>
            <label
              htmlFor="platform-stagnant-days"
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              فترة الركود (يوم)
            </label>
            <input
              id="platform-stagnant-days"
              type="number"
              min="1"
              max="365"
              dir="ltr"
              value={stagnantDaysInput}
              onChange={(e) => setStagnantDaysInput(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono font-bold`}
            />
          </div>
          <button
            type="submit"
            className="min-h-[44px] px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
          >
            تطبيق
          </button>
        </form>

        <div className="no-print inline-flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={!summary || loading}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>تصدير Excel</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            disabled={!summary || loading}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة</span>
          </button>

          <button
            type="button"
            onClick={fetchReport}
            disabled={loading}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
        </div>

        <div className="print-only print-filter-summary">
          المنصة: {platforms.find(p => p.id === selectedPlatformId)?.name || summary?.platformName || '-'} • فترة الركود: {stagnantDaysInput || 30} يوم
        </div>
      </div>

      {error && (
        <div role="alert" className="no-print text-xs font-bold ui-stock-out flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !report ? (
        <div className="py-10 flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
          <RefreshCw className="w-4 h-4 animate-spin ui-link" />
          <span>جاري احتساب مؤشرات المنصة من الخادم...</span>
        </div>
      ) : summary ? (
        <>
          {/* جدول المؤشرات المالية الرئيسية من عمودين */}
          <section className="space-y-4">
            <SectionHeading title={`ملخص مؤشرات منصة «${summary.platformName}»`} />
            <ReportSummaryTable rows={summaryRows} ariaLabel="ملخص مؤشرات المنصة" />
          </section>

          {/* رسم بياني بسيط لمبيعات كل يوم بعرض أقصى 640px */}
          <section className="space-y-4">
            <SectionHeading
              title="مبيعات المنصة اليومية"
              withTopDivider
              actions={
                <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                  {report.dailySales.length} يوم نشط
                </span>
              }
            />

            {report.dailySales.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">
                لا توجد مبيعات مسجلة لهذه المنصة في الفترة المحددة.
              </p>
            ) : (
              <div className="max-w-[640px] w-full space-y-3">
                {report.dailySales.map((day) => {
                  const widthPct = Math.max(4, Math.round((day.grossSales / maxDailyGross) * 100));
                  return (
                    <div key={day.date} className="space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 tabular-nums">
                          <span className="font-mono font-bold text-[var(--text-primary)]">{day.date}</span>
                          <span className="text-[var(--text-secondary)]">• {day.invoicesCount} فاتورة</span>
                        </div>
                        <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
                          <span className="text-[var(--text-secondary)]">
                            الإجمالي: <strong className="text-[var(--text-primary)]">{day.grossSales.toFixed(2)}</strong>
                          </span>
                          <span className="ui-money-sale font-semibold">
                            الصافي: <strong>{day.netSales.toFixed(2)} ج.م</strong>
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-2.5 bg-[var(--surface-subtle)] rounded overflow-hidden">
                        <div
                          className="h-full bg-[#1668B2] transition-all duration-300"
                          style={{ width: `${widthPct}%` }}
                          title={`إجمالي اليوم: ${day.grossSales.toFixed(2)} ج.م | الصافي: ${day.netSales.toFixed(2)} ج.م`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* أعلى 10 أصناف مبيعاً بالكمية */}
          <section className="space-y-4">
            <SectionHeading
              title="أعلى 10 أصناف مبيعاً (بالكمية)"
              withTopDivider
              actions={
                <span className="text-xs text-[var(--text-secondary)]">صافي القطع المباعة</span>
              }
            />

            {report.topByQuantity.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">
                لا توجد بيانات مبيعات في هذه الفترة.
              </p>
            ) : (
              <CompactTable ariaLabel="أعلى 10 أصناف مبيعاً بالكمية">
                <thead>
                  <tr>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>#</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصنف</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الكمية المباعة</th>
                    <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>الإيراد</th>
                    <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>الربح التقديري</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topByQuantity.map((it, idx) => (
                    <tr key={it.itemId}>
                      <td className={`text-center text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {idx + 1}
                      </td>
                      <td className={`font-semibold ${COMPACT_TABLE_TEXT_CLASS}`}>{it.itemName}</td>
                      <td className={`text-center font-mono font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                        {it.quantity}
                      </td>
                      <td className={`text-left font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                        {it.revenue.toFixed(2)} ج.م
                      </td>
                      <td className={`text-left font-mono font-bold ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                        {it.profit.toFixed(2)} ج.م
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border-color)] bg-[var(--surface-subtle)] font-bold">
                    <td colSpan={2} className="py-2.5 px-3 text-xs">الإجمالي</td>
                    <td className={`py-2.5 px-3 text-center font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                      {topQtyTotalQty}
                    </td>
                    <td className={`py-2.5 px-3 text-left font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                      {topQtyTotalRev.toFixed(2)} ج.م
                    </td>
                    <td className={`py-2.5 px-3 text-left font-mono ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                      {topQtyTotalProfit.toFixed(2)} ج.م
                    </td>
                  </tr>
                </tfoot>
              </CompactTable>
            )}
          </section>

          {/* أعلى 10 أصناف مبيعاً بالإيراد */}
          <section className="space-y-4">
            <SectionHeading
              title="أعلى 10 أصناف مبيعاً (بالإيراد)"
              withTopDivider
              actions={
                <span className="text-xs text-[var(--text-secondary)]">إجمالي القيمة البيعية</span>
              }
            />

            {report.topByRevenue.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">
                لا توجد بيانات مبيعات في هذه الفترة.
              </p>
            ) : (
              <CompactTable ariaLabel="أعلى 10 أصناف مبيعاً بالإيراد">
                <thead>
                  <tr>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>#</th>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصنف</th>
                    <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>الإيراد</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الكمية</th>
                    <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>الربح التقديري</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topByRevenue.map((it, idx) => (
                    <tr key={it.itemId}>
                      <td className={`text-center text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {idx + 1}
                      </td>
                      <td className={`font-semibold ${COMPACT_TABLE_TEXT_CLASS}`}>{it.itemName}</td>
                      <td className={`text-left font-mono font-bold ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                        {it.revenue.toFixed(2)} ج.م
                      </td>
                      <td className={`text-center font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                        {it.quantity}
                      </td>
                      <td className={`text-left font-mono font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                        {it.profit.toFixed(2)} ج.م
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border-color)] bg-[var(--surface-subtle)] font-bold">
                    <td colSpan={2} className="py-2.5 px-3 text-xs">الإجمالي</td>
                    <td className={`py-2.5 px-3 text-left font-mono ui-money-purchase ${COMPACT_TABLE_NUM_CLASS}`}>
                      {topRevTotalRev.toFixed(2)} ج.م
                    </td>
                    <td className={`py-2.5 px-3 text-center font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                      {topRevTotalQty}
                    </td>
                    <td className={`py-2.5 px-3 text-left font-mono ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                      {topRevTotalProfit.toFixed(2)} ج.م
                    </td>
                  </tr>
                </tfoot>
              </CompactTable>
            )}
          </section>

          {/* الأصناف الراكدة على المنصة */}
          <section className="space-y-4">
            <SectionHeading
              title={`الأصناف الراكدة على منصة «${summary.platformName}» (آخر ${report.stagnantDays} يوم)`}
              withTopDivider
              actions={
                <span className="text-xs font-semibold ui-stock-low tabular-nums">
                  {report.stagnantItems.length} صنف راكد
                </span>
              }
            />

            {report.stagnantItems.length === 0 ? (
              <div className="py-4 text-xs font-semibold ui-money-purchase flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  ممتاز! جميع الأصناف المتاحة لهذه المنصة والتي لها رصيد مخزني شهدت مبيعات خلال آخر {report.stagnantDays} يوم.
                </span>
              </div>
            ) : (
              <CompactTable ariaLabel="الأصناف الراكدة على المنصة">
                <thead>
                  <tr>
                    <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الصنف</th>
                    <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>الباركود</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>المخزون المتاح</th>
                    <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>سعر البيع</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>آخر بيع على المنصة</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>مدة الركود</th>
                  </tr>
                </thead>
                <tbody>
                  {report.stagnantItems.map((st) => (
                    <tr key={st.itemId}>
                      <td className={`font-semibold ${COMPACT_TABLE_TEXT_CLASS}`}>{st.itemName}</td>
                      <td className={`font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {st.barcode || '—'}
                      </td>
                      <td className={`text-center font-mono font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                        {st.stockQuantity}
                      </td>
                      <td className={`text-left font-mono font-bold ui-money-sale ${COMPACT_TABLE_NUM_CLASS}`}>
                        {st.salePrice.toFixed(2)} ج.م
                      </td>
                      <td className={`text-center font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                        {st.lastSaleDate ? new Date(st.lastSaleDate).toLocaleDateString('ar-EG') : 'لم يُبع من قبل'}
                      </td>
                      <td className={`text-center font-semibold ui-stock-low ${COMPACT_TABLE_NUM_CLASS}`}>
                        {st.daysSinceLastSale === null ? 'لم يُبع أبداً' : `${st.daysSinceLastSale} يوم`}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border-color)] bg-[var(--surface-subtle)] font-bold">
                    <td colSpan={2} className="py-2.5 px-3 text-xs">
                      الإجمالي ({report.stagnantItems.length} صنف)
                    </td>
                    <td className={`py-2.5 px-3 text-center font-mono ${COMPACT_TABLE_NUM_CLASS}`}>
                      {stagnantTotalStock}
                    </td>
                    <td colSpan={3} className="py-2.5 px-3 text-xs text-[var(--text-secondary)]">-</td>
                  </tr>
                </tfoot>
              </CompactTable>
            )}
          </section>
        </>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="space-y-5" dir="rtl">{content}</div>;
  }

  return (
    <PageSurface
      dir="rtl"
      title="تقرير المنصة التفصيلي"
      subtitle="تحليل المبيعات، BNPL، العمولات، الربح التقديري، الأصناف الأكثر مبيعاً والراكدة، ورصيد الآجل المعلق"
    >
      {content}
    </PageSurface>
  );
};


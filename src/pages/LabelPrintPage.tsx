import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Item, SystemConfig, UserAccount } from '../types';
import { api } from '../api/client';
import { hasPermission } from '../utils/permissions';
import {
  LabelSettings,
  LabelLine,
  LabelItem,
  ParsedLabelSheet,
  defaultLabelSettings,
  normalizeLabelSettings,
  itemBarcodeList,
  defaultBarcodeFor,
  parseLabelSheet,
  buildLabelPrintHtml,
  encodeBarcode,
  MAX_COUNT_PER_LINE,
  MAX_LABELS_PER_PRINT
} from '../utils/labelPrint';
import { CameraBarcodeScannerModal } from '../components/CameraBarcodeScannerModal';
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
import {
  Printer,
  Eye,
  Upload,
  Download,
  Plus,
  Trash2,
  Barcode,
  Camera,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Search
} from 'lucide-react';

export interface LabelTableRow {
  rowId: string;
  itemId: string;
  searchQuery: string;
  barcode: string;
  customBarcodeMode: boolean;
  /** علامة «غيّره المستخدم» حتى لا يرجع للافتراضي إلا عند تغيير الصنف */
  userChangedBarcode: boolean;
  count: number;
  expiry: string;
}

interface LabelPrintPageProps {
  items: Item[];
  user: UserAccount;
  config: SystemConfig;
  onItemUpdated?: (updatedItem: Item) => void;
  onRefreshItems?: () => Promise<void>;
}

const AUTO_PRINT_STORAGE_KEY = 'mudaqqeq_label_auto_print_after_upload';

function makeEmptyRow(): LabelTableRow {
  return {
    rowId: `lbl-row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    itemId: '',
    searchQuery: '',
    barcode: '',
    customBarcodeMode: false,
    userChangedBarcode: false,
    count: 1,
    expiry: ''
  };
}

function isActiveItem(item: Item): boolean {
  const st = String(item.status ?? '');
  return !['inactive', 'موقوف', 'مؤرشف'].includes(st) && !(item as any).isArchived;
}

export function printHtmlInHiddenIframe(html: string): void {
  if (typeof document === 'undefined') return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.srcdoc = html;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      iframe.remove();
    } catch (_) {}
  };

  iframe.onload = () => {
    try {
      const win = iframe.contentWindow;
      if (win) {
        win.focus();
        win.onafterprint = cleanup;
        win.print();
      }
    } catch (_) {}
    window.setTimeout(cleanup, 2500);
  };

  document.body.appendChild(iframe);
}

export const LabelPrintPage: React.FC<LabelPrintPageProps> = ({
  items,
  user,
  config,
  onItemUpdated,
  onRefreshItems
}) => {
  const [settings, setSettings] = useState<LabelSettings>(() => defaultLabelSettings());
  const [rows, setRows] = useState<LabelTableRow[]>(() => [makeEmptyRow()]);
  const [openDropdownRowId, setOpenDropdownRowId] = useState<string | null>(null);

  // السطر السريع لضرب الباركود
  const [quickScanInput, setQuickScanInput] = useState('');
  const [quickScanError, setQuickScanError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  // الإكسيل
  const [autoPrintOnUpload, setAutoPrintOnUpload] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_PRINT_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [excelImportMode, setExcelImportMode] = useState<'append' | 'replace'>('append');
  const [excelPreview, setExcelPreview] = useState<{
    fileName: string;
    parsed: ParsedLabelSheet;
  } | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  // المعاينة والتحذيرات والطباعة
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
  const [denseWarningPendingJob, setDenseWarningPendingJob] = useState<{
    html: string;
    denseBarcodes: string[];
  } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageFeedback, setPageFeedback] = useState<string | null>(null);
  const [addingBarcodeRowId, setAddingBarcodeRowId] = useState<string | null>(null);

  const canEditItems =
    user.role === 'designer' || Boolean(user.isOwner) || hasPermission(user, 'items.edit');

  const activeItems = useMemo(() => items.filter(isActiveItem), [items]);
  const itemsById = useMemo(() => {
    const map = new Map<string, Item>();
    for (const it of items) map.set(it.id, it);
    return map;
  }, [items]);

  // هل عنصر تاريخ الصلاحية مفعّل في الإعدادات؟
  const showExpiryColumn = useMemo(
    () => Boolean(settings.elements.find((e) => e.key === 'expiry')?.show),
    [settings.elements]
  );

  // تحميل إعدادات طابعة الباركود
  useEffect(() => {
    api
      .getLabelSettings()
      .then((res) => {
        if (res?.settings) {
          setSettings(normalizeLabelSettings(res.settings));
        }
      })
      .catch(() => {});
  }, []);

  // مزامنة الباركود الافتراضي في كل سطر إذا لم يغيّره المستخدم بنفسه
  useEffect(() => {
    setRows((prev) =>
      prev.map((row) => {
        if (!row.itemId || row.userChangedBarcode) return row;
        const item = itemsById.get(row.itemId);
        if (!item) return row;
        const defCode = defaultBarcodeFor(item as unknown as LabelItem);
        if (defCode && row.barcode !== defCode) {
          return { ...row, barcode: defCode };
        }
        return row;
      })
    );
  }, [itemsById]);

  const handleToggleAutoPrint = (checked: boolean) => {
    setAutoPrintOnUpload(checked);
    try {
      localStorage.setItem(AUTO_PRINT_STORAGE_KEY, checked ? 'true' : 'false');
    } catch (_) {}
  };

  // تحديث سطر عند اختيار صنف
  const handleSelectItemForRow = (rowId: string, item: Item) => {
    const defBarcode = defaultBarcodeFor(item as unknown as LabelItem);
    setRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        // لو تغيّر الصنف في السطر يرجع الباركود للرئيسي للصنف الجديد، إلا لو المستخدم غيّر الباركود بنفسه في هذا السطر
        const nextBarcode = row.userChangedBarcode && row.barcode.trim() ? row.barcode : defBarcode;
        const knownCodes = itemBarcodeList(item as unknown as LabelItem);
        const isKnown = !nextBarcode || knownCodes.includes(nextBarcode);
        return {
          ...row,
          itemId: item.id,
          searchQuery: item.name,
          barcode: nextBarcode,
          customBarcodeMode: !isKnown || knownCodes.length === 0
        };
      })
    );
    setOpenDropdownRowId(null);
    setPageError(null);
  };

  // تغيير الباركود من المستخدم في السطر
  const handleChangeRowBarcode = (rowId: string, nextBarcode: string, isCustomMode?: boolean) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        return {
          ...row,
          barcode: nextBarcode,
          userChangedBarcode: true,
          customBarcodeMode: isCustomMode !== undefined ? isCustomMode : row.customBarcodeMode
        };
      })
    );
    setPageError(null);
  };

  const handleChangeRowCount = (rowId: string, rawVal: string) => {
    const parsed = Math.floor(Number(rawVal));
    const clamped = Number.isFinite(parsed)
      ? Math.max(1, Math.min(MAX_COUNT_PER_LINE, parsed))
      : 1;
    setRows((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, count: clamped } : row))
    );
  };

  const handleChangeRowExpiry = (rowId: string, nextExpiry: string) => {
    setRows((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, expiry: nextExpiry } : row))
    );
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, makeEmptyRow()]);
  };

  const handleDeleteRow = (rowId: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.rowId !== rowId);
      return next.length > 0 ? next : [makeEmptyRow()];
    });
  };

  const handleConfirmClearAll = () => {
    setRows([makeEmptyRow()]);
    setExcelPreview(null);
    setPageError(null);
    setPageFeedback(null);
    setIsConfirmClearOpen(false);
  };

  // السطر السريع فوق الجدول لضرب الباركود بالقارئ أو الكاميرا
  const handleQuickBarcodeScan = useCallback(
    (rawCode: string) => {
      const code = String(rawCode ?? '').trim().replace(/\s+/g, '');
      if (!code) return;
      setQuickScanError(null);
      setPageError(null);

      const matched = activeItems.find((it) =>
        itemBarcodeList(it as unknown as LabelItem).some(
          (b) => b.toLowerCase() === code.toLowerCase()
        )
      );

      if (!matched) {
        setQuickScanError('الصنف غير موجود');
        return;
      }

      const exactCode =
        itemBarcodeList(matched as unknown as LabelItem).find(
          (b) => b.toLowerCase() === code.toLowerCase()
        ) || code;

      setRows((prev) => {
        const existingIndex = prev.findIndex(
          (r) => r.itemId === matched.id && r.barcode.trim().toLowerCase() === exactCode.toLowerCase()
        );
        if (existingIndex >= 0) {
          const next = [...prev];
          const current = next[existingIndex];
          next[existingIndex] = {
            ...current,
            count: Math.min(MAX_COUNT_PER_LINE, (Number(current.count) || 1) + 1)
          };
          return next;
        }

        const newRow: LabelTableRow = {
          rowId: `lbl-row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          itemId: matched.id,
          searchQuery: matched.name,
          barcode: exactCode,
          customBarcodeMode: false,
          userChangedBarcode: exactCode !== defaultBarcodeFor(matched as unknown as LabelItem),
          count: 1,
          expiry: ''
        };

        // لو الجدول فيه سطر واحد فارغ استبدله
        if (prev.length === 1 && !prev[0].itemId && !prev[0].barcode.trim()) {
          return [newRow];
        }
        return [...prev, newRow];
      });

      setQuickScanInput('');
    },
    [activeItems]
  );

  // إضافة باركود فرعي للصنف
  const handleAddSecondaryBarcode = async (row: LabelTableRow, item: Item) => {
    const code = row.barcode.trim();
    if (!code || !canEditItems) return;
    setAddingBarcodeRowId(row.rowId);
    setPageError(null);
    setPageFeedback(null);
    try {
      const res = await api.addItemBarcode(item.id, code);
      if (res?.item) {
        onItemUpdated?.(res.item);
      }
      if (onRefreshItems) {
        await onRefreshItems();
      }
      setRows((prev) =>
        prev.map((r) =>
          r.rowId === row.rowId ? { ...r, customBarcodeMode: false } : r
        )
      );
      setPageFeedback(`تم إضافة الباركود ${code} كباركود فرعي للصنف «${item.name}»`);
    } catch (err: any) {
      setPageError(err?.message || 'تعذر إضافة الباركود الفرعي');
    } finally {
      setAddingBarcodeRowId(null);
    }
  };

  // تحميل نموذج الإكسيل
  const handleDownloadExcelTemplate = () => {
    const headers = ['الصنف', 'عدد التكت', 'الباركود', 'تاريخ الصلاحية'];
    const sample1Item = activeItems[0];
    const sample2Item = activeItems[1] || activeItems[0];
    const sampleRows = [
      [
        sample1Item ? sample1Item.name : 'شاحن سريع 65W',
        10,
        sample1Item ? defaultBarcodeFor(sample1Item as unknown as LabelItem) || '6221234567896' : '6221234567896',
        '31/12/2026'
      ],
      [
        sample2Item ? sample2Item.name : 'كابل تايب سي',
        5,
        '',
        ''
      ]
    ];

    const aoa = [headers, ...sampleRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // تنسيق عمود الباركود (C) وتاريخ الصلاحية (D) كنص (@) حتى لا يفسد الإكسيل الأرقام الطويلة
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:D3');
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (const C of [2, 3]) {
        const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[cellRef];
        if (cell) {
          cell.t = 's';
          cell.z = '@';
        }
      }
    }
    ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 22 }, { wch: 18 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'طباعة التكت');
    XLSX.writeFile(wb, 'نموذج_طباعة_التكت.xlsx');
  };

  // بناء سطور LabelLine الصالحة من الجدول
  const tableValidation = useMemo(() => {
    const nonEmptyRows = rows.filter((r) => r.itemId || r.barcode.trim());
    const validLines: LabelLine[] = [];
    const rowErrors = new Map<string, string>();
    let totalLabels = 0;

    for (const r of nonEmptyRows) {
      const item = r.itemId ? itemsById.get(r.itemId) : undefined;
      if (!item) {
        rowErrors.set(r.rowId, 'اختر الصنف أولًا');
        continue;
      }
      const code = r.barcode.trim().replace(/\s+/g, '');
      if (!code) {
        rowErrors.set(r.rowId, 'الباركود فارغ');
        continue;
      }
      try {
        encodeBarcode(code, settings.barcodeType);
      } catch (err: any) {
        rowErrors.set(r.rowId, err?.message || 'الباركود غير صالح للطباعة');
        continue;
      }
      const count = Math.floor(Number(r.count));
      if (!Number.isFinite(count) || count < 1 || count > MAX_COUNT_PER_LINE) {
        rowErrors.set(r.rowId, `عدد التكت لازم يكون من 1 إلى ${MAX_COUNT_PER_LINE}`);
        continue;
      }
      const knownCodes = itemBarcodeList(item as unknown as LabelItem);
      const unregisteredBarcode = !knownCodes.some(
        (b) => b.toLowerCase() === code.toLowerCase()
      );
      validLines.push({
        itemId: item.id,
        barcode: code,
        count,
        expiry: r.expiry.trim(),
        unregisteredBarcode
      });
      totalLabels += count;
    }

    return {
      nonEmptyRows,
      validLines,
      rowErrors,
      totalItems: validLines.length,
      totalLabels
    };
  }, [rows, itemsById, settings.barcodeType]);

  const printContext = useMemo(
    () => ({
      items: items as unknown as LabelItem[],
      companyName: config.companySettings?.storeName || config.storeName || '',
      logoUrl: config.companySettings?.logoUrl || '',
      taxInclusive: config.taxSettings?.taxInclusive ?? true
    }),
    [items, config.companySettings?.storeName, config.companySettings?.logoUrl, config.storeName, config.taxSettings?.taxInclusive]
  );

  // تحويل السطور المرفوعة من الإكسيل إلى صفوف في الجدول
  const applyParsedLinesToTable = useCallback(
    (parsedLines: LabelLine[], mode: 'append' | 'replace') => {
      const converted: LabelTableRow[] = parsedLines.map((line, idx) => {
        const item = itemsById.get(line.itemId);
        const defCode = item ? defaultBarcodeFor(item as unknown as LabelItem) : '';
        return {
          rowId: `lbl-xls-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          itemId: line.itemId,
          searchQuery: item?.name || '',
          barcode: line.barcode,
          customBarcodeMode: line.unregisteredBarcode,
          userChangedBarcode: line.barcode !== defCode,
          count: line.count,
          expiry: line.expiry
        };
      });

      if (converted.length === 0) return;

      setRows((prev) => {
        if (mode === 'replace' || (prev.length === 1 && !prev[0].itemId && !prev[0].barcode.trim())) {
          return converted;
        }
        return [...prev, ...converted];
      });
    },
    [itemsById]
  );

  // رفع ملف إكسيل
  const handleExcelFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setPageError(null);
    setPageFeedback(null);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = wb.SheetNames[0];
      if (!firstSheetName) {
        setPageError('ملف الإكسيل فارغ');
        return;
      }
      const sheet = wb.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false,
        defval: ''
      });

      const parsed = parseLabelSheet(rawRows, items as unknown as LabelItem[]);
      setExcelPreview({ fileName: file.name, parsed });

      if (parsed.lines.length > 0 && parsed.errors.length === 0) {
        applyParsedLinesToTable(parsed.lines, excelImportMode);

        // خيار «اطبع على طول بعد الرفع» لو الملف خالٍ من الأخطاء والتحذيرات
        if (autoPrintOnUpload && parsed.warnings.length === 0) {
          const targetLines =
            excelImportMode === 'replace'
              ? parsed.lines
              : [...tableValidation.validLines, ...parsed.lines];
          const job = buildLabelPrintHtml(targetLines, settings, printContext);
          if (job.denseBarcodes.length > 0) {
            setDenseWarningPendingJob({ html: job.html, denseBarcodes: job.denseBarcodes });
          } else {
            printHtmlInHiddenIframe(job.html);
          }
        }
      }
    } catch (err: any) {
      setPageError(err?.message || 'تعذر قراءة ملف الإكسيل');
    }
  };

  // تنفيذ الطباعة
  const handleTriggerPrint = useCallback(() => {
    setPageError(null);
    if (excelPreview && excelPreview.parsed.errors.length > 0) {
      setPageError('يوجد أخطاء في ملف الإكسيل المرفوع — لا يمكن الطباعة قبل تصحيحها أو مسح المعاينة');
      return;
    }
    if (tableValidation.rowErrors.size > 0) {
      const firstErr = Array.from(tableValidation.rowErrors.values())[0];
      setPageError(firstErr);
      return;
    }
    if (tableValidation.validLines.length === 0) {
      setPageError('أضف صنفًا واحدًا على الأقل للطباعة');
      return;
    }
    if (tableValidation.totalLabels > MAX_LABELS_PER_PRINT) {
      setPageError(
        `إجمالي التكت ${tableValidation.totalLabels} أكبر من الحد الأقصى ${MAX_LABELS_PER_PRINT} في المرة الواحدة`
      );
      return;
    }

    const job = buildLabelPrintHtml(tableValidation.validLines, settings, printContext);
    if (job.denseBarcodes.length > 0) {
      setDenseWarningPendingJob({ html: job.html, denseBarcodes: job.denseBarcodes });
      return;
    }
    printHtmlInHiddenIframe(job.html);
  }, [excelPreview, tableValidation, settings, printContext]);

  // اختصار F2 للطباعة لو متاح
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'F2') {
        ev.preventDefault();
        handleTriggerPrint();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTriggerPrint]);

  // معاينة أول 6 تكت بالمقاس الحقيقي
  const previewJob = useMemo(() => {
    if (tableValidation.validLines.length === 0) return null;
    const limitedLines: LabelLine[] = [];
    let countSoFar = 0;
    for (const line of tableValidation.validLines) {
      if (countSoFar >= 6) break;
      const take = Math.min(line.count, 6 - countSoFar);
      if (take > 0) {
        limitedLines.push({ ...line, count: take });
        countSoFar += take;
      }
    }
    return buildLabelPrintHtml(limitedLines, settings, printContext);
  }, [tableValidation.validLines, settings, printContext]);

  return (
    <PageSurface
      title="طباعة التكت"
      subtitle="طباعة ستيكر الباركود للأصناف بالجدول المباشر أو قارئ الباركود أو رفع ملف إكسيل"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadExcelTemplate}
            data-testid="label-download-template-btn"
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تحميل نموذج الإكسيل</span>
          </button>

          <label
            data-testid="label-upload-excel-btn"
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>رفع ملف إكسيل</span>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelFileUpload}
              data-testid="label-excel-file-input"
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={() => setIsPreviewOpen((v) => !v)}
            disabled={tableValidation.validLines.length === 0}
            data-testid="label-preview-btn"
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            <Eye className="w-4 h-4" />
            <span>معاينة</span>
          </button>

          <button
            type="button"
            onClick={handleTriggerPrint}
            disabled={
              tableValidation.validLines.length === 0 ||
              tableValidation.rowErrors.size > 0 ||
              Boolean(excelPreview && excelPreview.parsed.errors.length > 0)
            }
            data-testid="label-print-btn"
            className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة (F2)</span>
          </button>
        </div>
      }
    >
      {/* شريط خيارات الإكسيل والسطر السريع للباركود */}
      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[var(--border-subtle)]">
          {/* السطر السريع لضرب الباركود بالقارئ أو الكاميرا */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex items-center">
              <Barcode className="w-4 h-4 text-[var(--text-secondary)] absolute right-3 pointer-events-none" />
              <input
                type="text"
                value={quickScanInput}
                onChange={(e) => {
                  setQuickScanInput(e.target.value);
                  if (quickScanError) setQuickScanError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleQuickBarcodeScan(quickScanInput);
                  }
                }}
                placeholder="اضرب الباركود هنا لإضافة الصنف أو زيادة العدد..."
                aria-label="ضرب الباركود السريع"
                data-testid="label-quick-scan-input"
                className={`${FORM_CONTROL_BASE_CLASS} pr-9 pl-3 w-72 sm:w-80 text-xs font-bold`}
              />
            </div>

            <button
              type="button"
              onClick={() => handleQuickBarcodeScan(quickScanInput)}
              data-testid="label-quick-scan-submit"
              className="min-h-[44px] px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
            >
              إضافة بالباركود
            </button>

            <button
              type="button"
              onClick={() => setIsCameraOpen(true)}
              aria-label="مسح الباركود بالكاميرا"
              title="مسح الباركود بالكاميرا"
              data-testid="label-camera-scan-btn"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] cursor-pointer"
            >
              <Camera className="w-4 h-4" />
            </button>

            {quickScanError && (
              <span
                role="alert"
                data-testid="label-quick-scan-error"
                className="text-xs font-bold ui-stock-out flex items-center gap-1"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{quickScanError}</span>
              </span>
            )}
          </div>

          {/* خيارات رفع الإكسيل */}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-[var(--text-secondary)]">عند رفع الإكسيل:</span>
              <button
                type="button"
                onClick={() => setExcelImportMode('append')}
                data-testid="label-excel-mode-append"
                className={`min-h-[38px] px-2.5 rounded-lg font-bold border transition cursor-pointer ${
                  excelImportMode === 'append'
                    ? 'bg-[#1668B2] border-[#1668B2] text-white'
                    : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                }`}
              >
                إضافة للجدول
              </button>
              <button
                type="button"
                onClick={() => setExcelImportMode('replace')}
                data-testid="label-excel-mode-replace"
                className={`min-h-[38px] px-2.5 rounded-lg font-bold border transition cursor-pointer ${
                  excelImportMode === 'replace'
                    ? 'bg-[#1668B2] border-[#1668B2] text-white'
                    : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                }`}
              >
                استبدال الجدول
              </button>
            </div>

            <label className="min-h-[38px] inline-flex items-center gap-2 font-bold text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={autoPrintOnUpload}
                onChange={(e) => handleToggleAutoPrint(e.target.checked)}
                data-testid="label-auto-print-checkbox"
                className="w-4 h-4 accent-[#1668B2] cursor-pointer"
              />
              <span>اطبع على طول بعد الرفع</span>
            </label>
          </div>
        </div>

        {/* رسائل الخطأ أو التأكيد */}
        {pageError && (
          <div
            role="alert"
            data-testid="label-page-error"
            className="flex items-center gap-2 py-2 px-3 rounded-lg border border-rose-300 bg-rose-50/70 text-rose-800 text-xs font-bold"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{pageError}</span>
          </div>
        )}

        {pageFeedback && (
          <div
            role="status"
            data-testid="label-page-feedback"
            className="flex items-center gap-2 py-2 px-3 rounded-lg border border-emerald-300 bg-emerald-50/70 text-emerald-800 text-xs font-bold"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{pageFeedback}</span>
          </div>
        )}

        {/* معاينة نتائج رفع ملف الإكسيل (الأخطاء والتحذيرات والسطور السليمة) */}
        {excelPreview && (
          <div
            data-testid="label-excel-preview-panel"
            className="p-3.5 rounded-lg border border-[var(--border-color)] space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold text-[var(--text-primary)]">
                نتيجة قراءة الملف: «{excelPreview.fileName}» — السطور السليمة:{' '}
                <span className="font-mono">{excelPreview.parsed.lines.length}</span> (إجمالي التكت:{' '}
                <span className="font-mono">{excelPreview.parsed.totalLabels}</span>)
              </div>
              <div className="flex items-center gap-2">
                {excelPreview.parsed.lines.length > 0 && excelPreview.parsed.errors.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      applyParsedLinesToTable(excelPreview.parsed.lines, excelImportMode);
                      setExcelPreview(null);
                    }}
                    data-testid="label-excel-apply-valid-only-btn"
                    className="min-h-[38px] px-3 rounded-lg bg-[#1668B2] text-white text-xs font-bold cursor-pointer"
                  >
                    إدراج السطور السليمة فقط ({excelPreview.parsed.lines.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setExcelPreview(null)}
                  data-testid="label-excel-dismiss-preview-btn"
                  className="min-h-[38px] px-3 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                >
                  إخفاء التقرير
                </button>
              </div>
            </div>

            {excelPreview.parsed.errors.length > 0 && (
              <div
                role="alert"
                data-testid="label-excel-errors-list"
                className="space-y-1 text-xs text-rose-700 font-bold"
              >
                <div>
                  أخطاء في الملف ({excelPreview.parsed.errors.length}) — لا طباعة لو فيه أخطاء:
                </div>
                <ul className="list-disc pr-5 space-y-0.5">
                  {excelPreview.parsed.errors.map((err, idx) => (
                    <li key={idx}>
                      {err.row > 0 ? `سطر ${err.row}: ` : ''}
                      {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {excelPreview.parsed.warnings.length > 0 && (
              <div
                role="status"
                data-testid="label-excel-warnings-list"
                className="space-y-1 text-xs text-amber-700 font-bold"
              >
                <div>تحذيرات ({excelPreview.parsed.warnings.length}):</div>
                <ul className="list-disc pr-5 space-y-0.5">
                  {excelPreview.parsed.warnings.map((warn, idx) => (
                    <li key={idx}>
                      {warn.row > 0 ? `سطر ${warn.row}: ` : ''}
                      {warn.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* تحذير خطوط الباركود الرفيعة جدًا قبل الطباعة */}
        {denseWarningPendingJob && (
          <div
            role="alert"
            data-testid="label-dense-barcode-warning"
            className="p-3.5 rounded-lg border border-amber-300 bg-amber-50/80 text-amber-900 flex flex-wrap items-center justify-between gap-3 text-xs font-bold"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700" />
              <span>
                خطوط الباركود رفيعة جدًا على هذه الطابعة وقد لا تُقرأ — كبّر عرض الباركود من الإعدادات
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDenseWarningPendingJob(null)}
                className="min-h-[38px] px-3 rounded-lg border border-amber-400 hover:bg-amber-100 text-amber-900 font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  const html = denseWarningPendingJob.html;
                  setDenseWarningPendingJob(null);
                  printHtmlInHiddenIframe(html);
                }}
                data-testid="label-print-anyway-btn"
                className="min-h-[38px] px-3.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold cursor-pointer"
              >
                اطبع على أي حال
              </button>
            </div>
          </div>
        )}

        {/* معاينة أول 6 تكت بالمقاس الحقيقي */}
        {isPreviewOpen && previewJob && (
          <div
            data-testid="label-live-preview-box"
            className="space-y-2 pb-4 border-b border-[var(--border-subtle)]"
          >
            <SectionHeading
              title="معاينة التكت بالمقاس الحقيقي (أول 6 تكت)"
              actions={
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(false)}
                  className="text-xs font-bold ui-link cursor-pointer"
                >
                  إغلاق المعاينة
                </button>
              }
            />
            <div className="overflow-x-auto py-2">
              <iframe
                title="معاينة طباعة التكت"
                data-testid="label-preview-iframe"
                srcDoc={previewJob.html}
                className="bg-white border border-[var(--border-color)] rounded"
                style={{
                  width:
                    settings.paper === 'roll'
                      ? `${
                          settings.pageMargin.left +
                          settings.pageMargin.right +
                          settings.columns * settings.labelWidthMm +
                          (settings.columns - 1) * settings.gapXMm +
                          6
                        }mm`
                      : '215mm',
                  height:
                    settings.paper === 'roll'
                      ? `${
                          Math.min(6, Math.ceil(previewJob.totalLabels / settings.columns)) *
                            (settings.pageMargin.top +
                              settings.pageMargin.bottom +
                              settings.labelHeightMm) +
                          10
                        }mm`
                      : '120mm'
                }}
              />
            </div>
          </div>
        )}

        {/* الجدول (سطر لكل صنف) */}
        <CompactTable>
          <thead>
            <tr>
              <th className={`${COMPACT_TABLE_TEXT_CLASS} w-10`}>#</th>
              <th className={COMPACT_TABLE_TEXT_CLASS}>الصنف</th>
              <th className={COMPACT_TABLE_TEXT_CLASS}>الباركود</th>
              <th className={`${COMPACT_TABLE_NUM_CLASS} w-32`}>عدد التكت</th>
              {showExpiryColumn && (
                <th className={`${COMPACT_TABLE_TEXT_CLASS} w-44`}>تاريخ الصلاحية</th>
              )}
              <th className={`${COMPACT_TABLE_TEXT_CLASS} w-14`}>حذف</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const selectedItem = row.itemId ? itemsById.get(row.itemId) : undefined;
              const itemBarcodes = selectedItem
                ? itemBarcodeList(selectedItem as unknown as LabelItem)
                : [];
              const cleanCode = row.barcode.trim().replace(/\s+/g, '');
              const isUnregistered =
                Boolean(selectedItem && cleanCode) &&
                !itemBarcodes.some((b) => b.toLowerCase() === cleanCode.toLowerCase());

              const query = row.searchQuery.trim().toLowerCase();
              const filteredItems = activeItems
                .filter((it) => {
                  if (!query) return true;
                  if (it.name.toLowerCase().includes(query)) return true;
                  if (it.printName && it.printName.toLowerCase().includes(query)) return true;
                  return itemBarcodeList(it as unknown as LabelItem).some((b) =>
                    b.toLowerCase().includes(query)
                  );
                })
                .slice(0, 25);

              const rowErr = tableValidation.rowErrors.get(row.rowId);

              return (
                <tr key={row.rowId} data-testid={`label-table-row-${index}`}>
                  <td className={`${COMPACT_TABLE_NUM_CLASS} text-xs text-[var(--text-secondary)]`}>
                    {index + 1}
                  </td>

                  {/* عمود الصنف */}
                  <td className={`${COMPACT_TABLE_TEXT_CLASS} align-top`}>
                    <div className="relative">
                      <div className="relative flex items-center">
                        <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute right-2.5 pointer-events-none" />
                        <input
                          type="text"
                          value={row.searchQuery}
                          onFocus={() => setOpenDropdownRowId(row.rowId)}
                          onChange={(e) => {
                            const val = e.target.value;
                            setRows((prev) =>
                              prev.map((r) =>
                                r.rowId === row.rowId
                                  ? { ...r, searchQuery: val, itemId: val ? r.itemId : '' }
                                  : r
                              )
                            );
                            setOpenDropdownRowId(row.rowId);
                          }}
                          placeholder="ابحث بالاسم أو اسم الطباعة أو الباركود..."
                          aria-label={`الصنف في السطر ${index + 1}`}
                          data-testid={`label-row-item-input-${index}`}
                          className={`${FORM_CONTROL_BASE_CLASS} pr-8 pl-2 w-full min-w-[220px] text-xs font-bold`}
                        />
                      </div>

                      {openDropdownRowId === row.rowId && filteredItems.length > 0 && (
                        <div
                          data-testid={`label-row-item-dropdown-${index}`}
                          className="absolute z-30 right-0 left-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--surface)] shadow-lg divide-y divide-[var(--border-subtle)]"
                        >
                          {filteredItems.map((it) => {
                            const defCode = defaultBarcodeFor(it as unknown as LabelItem);
                            return (
                              <button
                                key={it.id}
                                type="button"
                                onMouseDown={(ev) => {
                                  ev.preventDefault();
                                  handleSelectItemForRow(row.rowId, it);
                                }}
                                data-testid={`label-item-option-${it.id}`}
                                className="w-full text-right px-3 py-2 hover:bg-[var(--surface-subtle)] flex items-center justify-between gap-2 text-xs cursor-pointer"
                              >
                                <div className="min-w-0">
                                  <div className="font-bold text-[var(--text-primary)] truncate">
                                    {it.name}
                                  </div>
                                  {it.printName && it.printName !== it.name && (
                                    <div className="text-[11px] text-[var(--text-secondary)] truncate">
                                      اسم الطباعة: {it.printName}
                                    </div>
                                  )}
                                </div>
                                <span className="font-mono text-[11px] text-[var(--text-secondary)] shrink-0">
                                  {defCode || 'بدون باركود'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* عمود الباركود + تحذير الباركود غير المسجل */}
                  <td className={`${COMPACT_TABLE_TEXT_CLASS} align-top`}>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {selectedItem && itemBarcodes.length > 0 && !row.customBarcodeMode ? (
                          <select
                            value={itemBarcodes.includes(row.barcode) ? row.barcode : '__custom__'}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '__custom__') {
                                handleChangeRowBarcode(row.rowId, row.barcode, true);
                              } else {
                                handleChangeRowBarcode(row.rowId, val, false);
                              }
                            }}
                            aria-label={`الباركود في السطر ${index + 1}`}
                            data-testid={`label-row-barcode-select-${index}`}
                            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} font-mono text-xs font-bold`}
                          >
                            {itemBarcodes.map((code, bIdx) => (
                              <option key={code} value={code}>
                                {code} {bIdx === 0 ? '(رئيسي)' : '(فرعي)'}
                              </option>
                            ))}
                            <option value="__custom__">باركود آخر…</option>
                          </select>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              dir="ltr"
                              value={row.barcode}
                              onChange={(e) =>
                                handleChangeRowBarcode(row.rowId, e.target.value, true)
                              }
                              placeholder="اكتب الباركود..."
                              aria-label={`كتابة الباركود في السطر ${index + 1}`}
                              data-testid={`label-row-barcode-input-${index}`}
                              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} font-mono text-xs font-bold`}
                            />
                            {selectedItem && itemBarcodes.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleChangeRowBarcode(
                                    row.rowId,
                                    defaultBarcodeFor(selectedItem as unknown as LabelItem),
                                    false
                                  )
                                }
                                className="min-h-[38px] px-2 rounded border border-[var(--border-color)] text-[11px] font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                              >
                                القائمة
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* تحذير الباركود غير المسجل */}
                      {selectedItem && isUnregistered && (
                        <div
                          role="alert"
                          data-testid={`label-unregistered-warning-${index}`}
                          className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-amber-700"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            الباركود ده مش متسجل على الصنف: لو اتضرب في البيع مش هيلاقيه
                          </span>
                          {canEditItems && (
                            <button
                              type="button"
                              disabled={addingBarcodeRowId === row.rowId}
                              onClick={() => void handleAddSecondaryBarcode(row, selectedItem)}
                              data-testid={`label-add-sub-barcode-btn-${index}`}
                              className="min-h-[32px] px-2.5 py-0.5 rounded bg-amber-700 hover:bg-amber-800 text-white text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                            >
                              {addingBarcodeRowId === row.rowId ? (
                                <RefreshCw className="w-3 h-3 animate-spin inline" />
                              ) : (
                                'ضيفه كباركود فرعي للصنف'
                              )}
                            </button>
                          )}
                        </div>
                      )}

                      {rowErr && (
                        <div className="text-[11px] font-bold ui-stock-out">{rowErr}</div>
                      )}
                    </div>
                  </td>

                  {/* عمود عدد التكت */}
                  <td className={`${COMPACT_TABLE_NUM_CLASS} align-top`}>
                    <input
                      type="number"
                      min={1}
                      max={MAX_COUNT_PER_LINE}
                      value={row.count}
                      onChange={(e) => handleChangeRowCount(row.rowId, e.target.value)}
                      aria-label={`عدد التكت في السطر ${index + 1}`}
                      data-testid={`label-row-count-input-${index}`}
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono text-xs font-bold`}
                    />
                  </td>

                  {/* عمود تاريخ الصلاحية (يظهر فقط لو مفعّل في الإعدادات) */}
                  {showExpiryColumn && (
                    <td className={`${COMPACT_TABLE_TEXT_CLASS} align-top`}>
                      <input
                        type="date"
                        value={row.expiry}
                        onChange={(e) => handleChangeRowExpiry(row.rowId, e.target.value)}
                        aria-label={`تاريخ الصلاحية في السطر ${index + 1}`}
                        data-testid={`label-row-expiry-input-${index}`}
                        className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} font-mono text-xs`}
                      />
                    </td>
                  )}

                  {/* حذف السطر */}
                  <td className={`${COMPACT_TABLE_TEXT_CLASS} align-top`}>
                    <button
                      type="button"
                      onClick={() => handleDeleteRow(row.rowId)}
                      aria-label={`حذف السطر ${index + 1}`}
                      data-testid={`label-row-delete-btn-${index}`}
                      className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-[var(--border-color)] ui-stock-out hover:bg-[var(--surface-subtle)] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </CompactTable>

        {/* شريط أسفل الجدول: إضافة سطر + مسح الكل + إجمالي عدد الأصناف وعدد التكت */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAddRow}
              data-testid="label-add-row-btn"
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة سطر</span>
            </button>

            <button
              type="button"
              onClick={() => setIsConfirmClearOpen(true)}
              disabled={rows.length === 1 && !rows[0].itemId && !rows[0].barcode.trim()}
              data-testid="label-clear-all-btn"
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold ui-stock-out cursor-pointer disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
              <span>مسح الكل</span>
            </button>
          </div>

          <div
            data-testid="label-totals-summary"
            className="flex flex-wrap items-center gap-4 text-xs font-extrabold text-[var(--text-primary)]"
          >
            <div>
              عدد الأصناف:{' '}
              <span data-testid="label-total-items" className="font-mono">
                {tableValidation.totalItems}
              </span>
            </div>
            <div>
              إجمالي عدد التكت:{' '}
              <span data-testid="label-total-labels" className="font-mono">
                {tableValidation.totalLabels}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* نافذة تأكيد مسح الكل */}
      {isConfirmClearOpen && (
        <ModalShell
          title="تأكيد مسح جدول الطباعة"
          subtitle="سيتم تفريغ جميع السطور الحالية من الجدول"
          onClose={() => setIsConfirmClearOpen(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setIsConfirmClearOpen(false)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmClearAll}
                data-testid="label-confirm-clear-btn"
                className="min-h-[44px] px-5 rounded-lg bg-[#D9524F] hover:bg-[#B42318] text-white text-xs font-bold cursor-pointer"
              >
                مسح الكل
              </button>
            </>
          }
        >
          <p className="text-xs text-[var(--text-secondary)]">
            هل أنت متأكد من مسح كل الأصناف الموجودة في جدول طباعة التكت؟
          </p>
        </ModalShell>
      )}

      {/* نافذة الكاميرا لمسح الباركود */}
      <CameraBarcodeScannerModal
        items={activeItems}
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onBarcodeDetected={(code) => {
          handleQuickBarcodeScan(code);
          setIsCameraOpen(false);
        }}
      />
    </PageSurface>
  );
};

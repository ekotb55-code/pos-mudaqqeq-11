import * as XLSX from 'xlsx';
import { Item } from '../types';
import { getCairoToday, normalizeArabicText } from './dateUtils';

export const WAREHOUSE_EXCEL_MAX_ROWS = 2000;
export const SUPPORTED_WAREHOUSE_EXCEL_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

export type WarehouseExcelRowStatus =
  | 'ready'
  | 'not_found'
  | 'duplicate'
  | 'insufficient_stock'
  | 'invalid_quantity';

export interface WarehouseExcelParsedRow {
  rowNumber: number;
  inputName: string;
  inputBarcode: string;
  rawQuantity: string;
  parsedQuantity: number | null;
}

export interface WarehouseExcelEvaluatedRow {
  rowKey: string;
  rowNumber: number;
  inputName: string;
  inputBarcode: string;
  rawQuantity: string;
  itemId?: string;
  itemName: string;
  barcode: string;
  sku: string;
  unit: string;
  purchasePrice: number;
  matchedBy?: 'barcode' | 'name';
  availableFromStock: number;
  availableToStock: number;
  requestedQuantity: number | null;
  status: WarehouseExcelRowStatus;
  statusLabel: string;
  reason: string;
  canUseAvailableStock: boolean;
}

export interface WarehouseExcelSummary {
  totalRows: number;
  readyCount: number;
  errorCount: number;
  notFoundCount: number;
  duplicateCount: number;
  insufficientCount: number;
  invalidQuantityCount: number;
  totalRequestedQuantity: number;
  totalPurchaseValue: number;
  canExecute: boolean;
}

export const WAREHOUSE_EXCEL_STATUS_LABELS: Record<WarehouseExcelRowStatus, string> = {
  ready: 'جاهز',
  not_found: 'غير موجود',
  duplicate: 'مكرر في الملف',
  insufficient_stock: 'الكمية لا تكفي',
  invalid_quantity: 'كمية غير صالحة'
};

export function normalizeItemNameForTransferMatch(text?: string | null): string {
  return normalizeArabicText(text).replace(/\s+/g, ' ').trim();
}

export function normalizeBarcodeForTransferMatch(code?: string | null): string {
  return String(code ?? '').trim().toLowerCase();
}

function isItemActive(item: Item): boolean {
  const st = String(item.status || '').trim().toLowerCase();
  return st !== 'inactive' && st !== 'موقوف' && st !== 'مؤرشف' && st !== 'archived';
}

function convertArabicNumeralsToAscii(input: string): string {
  return input
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.');
}

export function parseQuantityValue(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return Math.round(raw * 1000) / 1000;
  }
  const str = convertArabicNumeralsToAscii(String(raw)).trim();
  if (!str) return null;
  // Remove thousands separators if present (e.g. 1,250)
  const cleaned = str.replace(/,/g, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 1000) / 1000;
}

function normalizeHeaderCell(val: unknown): string {
  return normalizeItemNameForTransferMatch(String(val ?? ''))
    .replace(/[()[\]{}*:：/\\_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAME_HEADER_ALIASES = new Set([
  'اسم الصنف',
  'الصنف',
  'الاسم',
  'اسم المنتج',
  'المنتج',
  'name',
  'item',
  'item name',
  'product',
  'product name'
].map(normalizeHeaderCell));

const QTY_HEADER_ALIASES = new Set([
  'الكميه',
  'كميه',
  'الكميه المطلوبه',
  'الكميه المنقوله',
  'الكمية',
  'كمية',
  'الكمية المطلوبة',
  'الكمية المنقولة',
  'العدد',
  'qty',
  'quantity',
  'amount'
].map(normalizeHeaderCell));

const BARCODE_HEADER_ALIASES = new Set([
  'الباركود',
  'باركود',
  'الباركود اختياري',
  'باركود اختياري',
  'الكود الباركود',
  'الكود',
  'كود',
  'رمز الصنف',
  'sku',
  'barcode',
  'code'
].map(normalizeHeaderCell));

function decodeCsvBuffer(bytes: Uint8Array): string {
  // Strip UTF-8 BOM if present
  const hasUtf8Bom =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const payload = hasUtf8Bom ? bytes.subarray(3) : bytes;

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(payload);
  } catch {
    try {
      return new TextDecoder('windows-1256').decode(payload);
    } catch {
      return new TextDecoder('utf-8').decode(payload);
    }
  }
}

export function getWarehouseExcelExtension(fileName?: string): string {
  const lower = String(fileName || '').trim().toLowerCase();
  const dotIdx = lower.lastIndexOf('.');
  return dotIdx >= 0 ? lower.slice(dotIdx) : '';
}

export function isSupportedWarehouseExcelFile(fileName?: string): boolean {
  const ext = getWarehouseExcelExtension(fileName);
  return (SUPPORTED_WAREHOUSE_EXCEL_EXTENSIONS as readonly string[]).includes(ext);
}

export function parseWarehouseTransferExcelBuffer(
  data: ArrayBuffer | Uint8Array,
  fileName: string
): { ok: true; rows: WarehouseExcelParsedRow[] } | { ok: false; error: string } {
  const ext = getWarehouseExcelExtension(fileName);
  if (!isSupportedWarehouseExcelFile(fileName)) {
    return {
      ok: false,
      error: 'صيغة الملف غير مدعومة. يرجى رفع ملف إكسيل بصيغة ‎.xlsx‎ أو ‎.xls‎ أو ملف ‎.csv‎.'
    };
  }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) {
    return { ok: false, error: 'الملف المرفوع فارغ أو غير صالح.' };
  }

  let wb: XLSX.WorkBook;
  try {
    if (ext === '.csv') {
      const csvText = decodeCsvBuffer(bytes);
      wb = XLSX.read(csvText, { type: 'string', raw: true });
    } else {
      wb = XLSX.read(bytes, { type: 'array', raw: true });
    }
  } catch {
    return {
      ok: false,
      error: 'تعذر قراءة الملف. تأكد أن الملف سليم وغير تالف وبصيغة إكسيل أو CSV صحيحة.'
    };
  }

  const firstSheetName = wb.SheetNames?.[0];
  if (!firstSheetName || !wb.Sheets?.[firstSheetName]) {
    return { ok: false, error: 'لا يحتوي الملف على أي أوراق عمل صالحة.' };
  }

  const ws = wb.Sheets[firstSheetName];
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1,
    defval: '',
    raw: true
  });

  if (!Array.isArray(aoa) || aoa.length === 0) {
    return { ok: false, error: 'الملف فارغ ولا يحتوي على بيانات.' };
  }

  let headerRowIdx = -1;
  let nameColIdx = -1;
  let qtyColIdx = -1;
  let barcodeColIdx = -1;

  for (let r = 0; r < Math.min(aoa.length, 15); r++) {
    const row = Array.isArray(aoa[r]) ? aoa[r] : [];
    const hasAnyValue = row.some(cell => String(cell ?? '').trim() !== '');
    if (!hasAnyValue) continue;

    let foundName = -1;
    let foundQty = -1;
    let foundBarcode = -1;

    row.forEach((cell, cIdx) => {
      const norm = normalizeHeaderCell(cell);
      if (!norm) return;
      if (foundName === -1 && NAME_HEADER_ALIASES.has(norm)) {
        foundName = cIdx;
      } else if (foundQty === -1 && QTY_HEADER_ALIASES.has(norm)) {
        foundQty = cIdx;
      } else if (foundBarcode === -1 && BARCODE_HEADER_ALIASES.has(norm)) {
        foundBarcode = cIdx;
      }
    });

    headerRowIdx = r;
    nameColIdx = foundName;
    qtyColIdx = foundQty;
    barcodeColIdx = foundBarcode;
    break;
  }

  if (headerRowIdx === -1) {
    return { ok: false, error: 'لم يتم العثور على صف العناوين داخل الملف.' };
  }

  if (qtyColIdx === -1 || (nameColIdx === -1 && barcodeColIdx === -1)) {
    return {
      ok: false,
      error:
        'أعمدة الملف غير مطابقة للنموذج. يجب أن يحتوي الملف على عمود «اسم الصنف» وعمود «الكمية» (مع عمود اختياري «الباركود»).'
    };
  }

  const parsedRows: WarehouseExcelParsedRow[] = [];

  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = Array.isArray(aoa[r]) ? aoa[r] : [];
    const rawName = nameColIdx >= 0 ? String(row[nameColIdx] ?? '').trim() : '';
    const rawBarcode = barcodeColIdx >= 0 ? String(row[barcodeColIdx] ?? '').trim() : '';
    const rawQtyCell = qtyColIdx >= 0 ? row[qtyColIdx] : '';
    const rawQuantityStr = String(rawQtyCell ?? '').trim();

    if (!rawName && !rawBarcode && !rawQuantityStr) {
      continue;
    }

    parsedRows.push({
      rowNumber: r + 1,
      inputName: rawName,
      inputBarcode: rawBarcode,
      rawQuantity: rawQuantityStr,
      parsedQuantity: parseQuantityValue(rawQtyCell)
    });
  }

  if (parsedRows.length === 0) {
    return {
      ok: false,
      error: 'الملف لا يحتوي على أي صفوف بيانات للنقل بعد صف العناوين.'
    };
  }

  if (parsedRows.length > WAREHOUSE_EXCEL_MAX_ROWS) {
    return {
      ok: false,
      error: `تم تجاوز الحد الأقصى المسموح به (${WAREHOUSE_EXCEL_MAX_ROWS} صف كحد أقصى في الملف الواحد). يحتوي الملف على ${parsedRows.length} صف.`
    };
  }

  return { ok: true, rows: parsedRows };
}

export function evaluateWarehouseExcelRows(params: {
  parsedRows: WarehouseExcelParsedRow[];
  catalogItems: Item[];
  stocksMap: Record<string, { fromStock: number; toStock: number }>;
  allowNegativeWarehouseTransfer: boolean;
}): { rows: WarehouseExcelEvaluatedRow[]; summary: WarehouseExcelSummary } {
  const { parsedRows, catalogItems, stocksMap, allowNegativeWarehouseTransfer } = params;

  const activeBarcodeMap = new Map<string, Item>();
  const activeNameMap = new Map<string, Item>();
  const inactiveBarcodeMap = new Map<string, Item>();
  const inactiveNameMap = new Map<string, Item>();

  for (const item of catalogItems) {
    const active = isItemActive(item);
    const barcodeMap = active ? activeBarcodeMap : inactiveBarcodeMap;
    const nameMap = active ? activeNameMap : inactiveNameMap;

    const addBarcodeKey = (rawCode?: string | null) => {
      const norm = normalizeBarcodeForTransferMatch(rawCode);
      if (norm && !barcodeMap.has(norm)) {
        barcodeMap.set(norm, item);
      }
    };

    addBarcodeKey(item.barcode);
    addBarcodeKey(item.sku);
    if (Array.isArray(item.secondaryBarcodes)) {
      item.secondaryBarcodes.forEach(addBarcodeKey);
    }
    if (Array.isArray(item.barcodes)) {
      item.barcodes.forEach(b => addBarcodeKey(b.barcode));
    }

    const normName = normalizeItemNameForTransferMatch(item.name);
    if (normName && !nameMap.has(normName)) {
      nameMap.set(normName, item);
    }
  }

  const seenItemFirstRow = new Map<string, number>();

  let readyCount = 0;
  let errorCount = 0;
  let notFoundCount = 0;
  let duplicateCount = 0;
  let insufficientCount = 0;
  let invalidQuantityCount = 0;
  let totalRequestedQuantity = 0;
  let totalPurchaseValue = 0;

  const evaluatedRows: WarehouseExcelEvaluatedRow[] = parsedRows.map(row => {
    const barcodeKey = normalizeBarcodeForTransferMatch(row.inputBarcode);
    const nameKey = normalizeItemNameForTransferMatch(row.inputName);

    let matchedItem: Item | undefined;
    let matchedInactiveItem: Item | undefined;
    let matchedBy: 'barcode' | 'name' | undefined;

    if (barcodeKey) {
      matchedItem = activeBarcodeMap.get(barcodeKey);
      if (!matchedItem) {
        matchedInactiveItem = inactiveBarcodeMap.get(barcodeKey);
      }
      matchedBy = 'barcode';
    } else if (nameKey) {
      matchedItem = activeNameMap.get(nameKey);
      if (!matchedItem) {
        matchedInactiveItem = inactiveNameMap.get(nameKey);
      }
      matchedBy = 'name';
    }

    const baseRow = {
      rowKey: `row-${row.rowNumber}`,
      rowNumber: row.rowNumber,
      inputName: row.inputName,
      inputBarcode: row.inputBarcode,
      rawQuantity: row.rawQuantity
    };

    if (!matchedItem) {
      notFoundCount += 1;
      errorCount += 1;
      const reason = matchedInactiveItem
        ? 'الصنف موقوف أو مؤرشف ولا يمكن نقله'
        : barcodeKey
        ? `لم يُعثر على صنف نشط بالباركود «${row.inputBarcode}»`
        : nameKey
        ? `لم يُعثر على صنف نشط بالاسم «${row.inputName}»`
        : 'لم يُدخل اسم الصنف أو الباركود';

      return {
        ...baseRow,
        itemId: undefined,
        itemName: row.inputName || row.inputBarcode || '—',
        barcode: row.inputBarcode || '',
        sku: '',
        unit: '—',
        purchasePrice: 0,
        matchedBy: undefined,
        availableFromStock: 0,
        availableToStock: 0,
        requestedQuantity: row.parsedQuantity,
        status: 'not_found',
        statusLabel: WAREHOUSE_EXCEL_STATUS_LABELS.not_found,
        reason,
        canUseAvailableStock: false
      };
    }

    const pair = stocksMap[matchedItem.id] || { fromStock: 0, toStock: 0 };
    const fromStock = Math.round(Number(pair.fromStock || 0) * 1000) / 1000;
    const toStock = Math.round(Number(pair.toStock || 0) * 1000) / 1000;
    const purchasePrice = Number(matchedItem.purchasePrice || 0);
    const qty = row.parsedQuantity;

    if (seenItemFirstRow.has(matchedItem.id)) {
      const firstRow = seenItemFirstRow.get(matchedItem.id)!;
      duplicateCount += 1;
      errorCount += 1;
      return {
        ...baseRow,
        itemId: matchedItem.id,
        itemName: matchedItem.name,
        barcode: matchedItem.barcode || matchedItem.sku || '',
        sku: matchedItem.sku || '',
        unit: matchedItem.unit || 'قطعة',
        purchasePrice,
        matchedBy,
        availableFromStock: fromStock,
        availableToStock: toStock,
        requestedQuantity: qty,
        status: 'duplicate',
        statusLabel: WAREHOUSE_EXCEL_STATUS_LABELS.duplicate,
        reason: `الصنف مكرر في الملف (سبق ذكره في الصف ${firstRow})`,
        canUseAvailableStock: false
      };
    }

    seenItemFirstRow.set(matchedItem.id, row.rowNumber);

    if (qty === null || !Number.isFinite(qty) || qty <= 0) {
      invalidQuantityCount += 1;
      errorCount += 1;
      return {
        ...baseRow,
        itemId: matchedItem.id,
        itemName: matchedItem.name,
        barcode: matchedItem.barcode || matchedItem.sku || '',
        sku: matchedItem.sku || '',
        unit: matchedItem.unit || 'قطعة',
        purchasePrice,
        matchedBy,
        availableFromStock: fromStock,
        availableToStock: toStock,
        requestedQuantity: qty,
        status: 'invalid_quantity',
        statusLabel: WAREHOUSE_EXCEL_STATUS_LABELS.invalid_quantity,
        reason: 'يجب أن تكون الكمية المطلوبة رقمًا موجبًا أكبر من صفر',
        canUseAvailableStock: false
      };
    }

    if (!allowNegativeWarehouseTransfer && qty > fromStock) {
      insufficientCount += 1;
      errorCount += 1;
      return {
        ...baseRow,
        itemId: matchedItem.id,
        itemName: matchedItem.name,
        barcode: matchedItem.barcode || matchedItem.sku || '',
        sku: matchedItem.sku || '',
        unit: matchedItem.unit || 'قطعة',
        purchasePrice,
        matchedBy,
        availableFromStock: fromStock,
        availableToStock: toStock,
        requestedQuantity: qty,
        status: 'insufficient_stock',
        statusLabel: WAREHOUSE_EXCEL_STATUS_LABELS.insufficient_stock,
        reason:
          fromStock > 0
            ? `الكمية المطلوبة (${qty}) أكبر من المتاح في المخزن المحوِّل (${fromStock})`
            : 'الرصيد المتاح في المخزن المحوِّل يساوي صفر — احذف الصف للمتابعة',
        canUseAvailableStock: fromStock > 0
      };
    }

    readyCount += 1;
    totalRequestedQuantity = Math.round((totalRequestedQuantity + qty) * 1000) / 1000;
    totalPurchaseValue = Math.round((totalPurchaseValue + qty * purchasePrice) * 100) / 100;

    return {
      ...baseRow,
      itemId: matchedItem.id,
      itemName: matchedItem.name,
      barcode: matchedItem.barcode || matchedItem.sku || '',
      sku: matchedItem.sku || '',
      unit: matchedItem.unit || 'قطعة',
      purchasePrice,
      matchedBy,
      availableFromStock: fromStock,
      availableToStock: toStock,
      requestedQuantity: qty,
      status: 'ready',
      statusLabel: WAREHOUSE_EXCEL_STATUS_LABELS.ready,
      reason:
        matchedBy === 'barcode'
          ? 'مطابق بالباركود'
          : 'مطابق بالاسم بعد توحيد الحروف العربية',
      canUseAvailableStock: false
    };
  });

  return {
    rows: evaluatedRows,
    summary: {
      totalRows: evaluatedRows.length,
      readyCount,
      errorCount,
      notFoundCount,
      duplicateCount,
      insufficientCount,
      invalidQuantityCount,
      totalRequestedQuantity,
      totalPurchaseValue,
      canExecute: evaluatedRows.length > 0 && errorCount === 0
    }
  };
}

export function buildWarehouseTransferTemplateWorkbook(): XLSX.WorkBook {
  const headers = ['اسم الصنف', 'الكمية', 'الباركود'];
  const ws = XLSX.utils.aoa_to_sheet([headers]);

  // ضبط عمود الباركود كنص لحفظ الأصفار البادئة
  for (let r = 1; r <= 100; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: 2 });
    ws[ref] = { t: 's', v: '', z: '@' };
  }

  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: 100, c: headers.length - 1 }
  });
  ws['!cols'] = [{ wch: 34 }, { wch: 16 }, { wch: 24 }];
  ws['!views'] = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'نقل_بين_المخازن');
  return wb;
}

export function downloadWarehouseTransferTemplate(): void {
  const wb = buildWarehouseTransferTemplateWorkbook();
  XLSX.writeFile(wb, 'نموذج-نقل-بين-المخازن.xlsx');
}

export function buildWarehouseTransferErrorsWorkbook(
  errorRows: WarehouseExcelEvaluatedRow[]
): XLSX.WorkBook {
  const headers = [
    'رقم الصف',
    'اسم الصنف',
    'الباركود',
    'المتاح في المخزن المحوِّل',
    'الكمية المطلوبة',
    'الحالة',
    'سبب الخطأ'
  ];

  const aoa: any[][] = [headers];
  for (const row of errorRows) {
    aoa.push([
      row.rowNumber,
      row.inputName || row.itemName || '',
      row.inputBarcode || row.barcode || '',
      row.itemId ? row.availableFromStock : '',
      row.requestedQuantity !== null ? row.requestedQuantity : row.rawQuantity,
      row.statusLabel,
      row.reason
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let r = 1; r <= errorRows.length; r++) {
    const barcodeRef = XLSX.utils.encode_cell({ r, c: 2 });
    if (ws[barcodeRef]) {
      ws[barcodeRef].t = 's';
      ws[barcodeRef].z = '@';
    }
  }
  ws['!cols'] = [
    { wch: 12 },
    { wch: 30 },
    { wch: 20 },
    { wch: 22 },
    { wch: 18 },
    { wch: 20 },
    { wch: 44 }
  ];
  ws['!views'] = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'صفوف_الأخطاء');
  return wb;
}

export function downloadWarehouseTransferErrorsFile(
  errorRows: WarehouseExcelEvaluatedRow[]
): void {
  if (errorRows.length === 0) return;
  const wb = buildWarehouseTransferErrorsWorkbook(errorRows);
  const today = getCairoToday();
  XLSX.writeFile(wb, `اخطاء-نقل-المخازن-${today}.xlsx`);
}

/**
 * رفع صور الأصناف وتصديرها — POS مدقق
 * ---------------------------------------------------------------------------
 * - runPool: عدد محدود في نفس الوقت (رفع 4 / تحميل 6) مع إعادة المحاولة مرتين.
 * - importPackageImages: تصغير ← رفع على /api/upload-image ← ربط بالأصناف على /api/items/images/set كل 50.
 * - buildItemsExportZip: ملف مضغوط فيه «أصناف.xlsx» بنفس أعمدة الاستيراد + فولدر «صور».
 * - prepareImageForUpload: تصغير الصورة لـ 1000 بكسل (المتصفح فقط).
 * القراءة والربط في src/utils/itemImagesPackage.ts.
 */
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  ADD_ITEMS_HEADERS,
  EXPORT_WORKBOOK_NAME,
  FAILED_SHEET_NAME,
  IMAGES_FOLDER,
  ITEMS_SHEET_NAME,
  MAX_IMAGE_SIDE,
  MAX_SOURCE_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_BYTES,
  normalizeBarcode,
  sniffImageExt,
  type ImageMatchEntry,
  type PackageImage
} from './itemImagesPackage.ts';

// ---------------------------------------------------------------------------
// تشغيل عدد محدود في نفس الوقت مع إعادة المحاولة
// ---------------------------------------------------------------------------

export interface PoolOutcome<R> {
  ok: boolean;
  value?: R;
  error?: string;
}

export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  options: { retries?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void; retryDelayMs?: number } = {}
): Promise<PoolOutcome<R>[]> {
  const results: PoolOutcome<R>[] = new Array(items.length);
  const retries = options.retries ?? 2;
  let next = 0;
  let done = 0;
  const runOne = async () => {
    while (next < items.length) {
      if (options.signal?.aborted) return;
      const index = next++;
      let lastError = '';
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (options.signal?.aborted) return;
        try {
          results[index] = { ok: true, value: await worker(items[index], index) };
          lastError = '';
          break;
        } catch (err: any) {
          lastError = String(err?.message || err || 'خطأ غير معروف');
          if (err?.noRetry) break;
          if (attempt < retries && options.retryDelayMs) await new Promise(r => setTimeout(r, options.retryDelayMs! * (attempt + 1)));
        }
      }
      if (lastError) results[index] = { ok: false, error: lastError };
      done++;
      options.onProgress?.(done, items.length);
      // نسيب المتصفح يرسم الشاشة بين الصور
      await new Promise(r => setTimeout(r, 0));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runOne));
  return results;
}

// ---------------------------------------------------------------------------
// رفع الصور وربطها بالأصناف
// ---------------------------------------------------------------------------

export interface ImportImagesReport {
  uploaded: number;
  updated: number;
  skipped: number;
  failed: { excelRow: number; name: string; fileName: string; reason: string }[];
  cancelled: boolean;
}

/**
 * الأصناف تكون اتحفظت قبلها. هنا: تصغير كل صورة ← رفعها (4 في نفس الوقت) ← ربطها بالأصناف كل 50.
 * prepare: تصغير وتجهيز (في المتصفح prepareImageForUpload)، upload: /api/upload-image، setImages: /api/items/images/set.
 */
export async function importPackageImages(params: {
  entries: ImageMatchEntry[];
  replace: boolean;
  prepare: (image: PackageImage) => Promise<string>;
  upload: (dataUrl: string) => Promise<string>;
  setImages: (entries: { key: string; url: string }[], replace: boolean) => Promise<{ key: string; status: string; error?: string }[]>;
  concurrency?: number;
  batchSize?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<ImportImagesReport> {
  const withImage = params.entries.filter(e => e.image && !e.problem);
  const report: ImportImagesReport = { uploaded: 0, updated: 0, skipped: 0, failed: [], cancelled: false };
  for (const e of params.entries) if (e.problem) report.failed.push({ excelRow: e.excelRow, name: e.name || e.key, fileName: e.image?.fileName || '', reason: e.problem });
  const batchSize = params.batchSize ?? 50;
  let pending: { entry: ImageMatchEntry; url: string }[] = [];
  const flush = async () => {
    const batch = pending;
    pending = [];
    if (batch.length === 0) return;
    let results: { key: string; status: string; error?: string }[] = [];
    try {
      results = await params.setImages(batch.map(b => ({ key: b.entry.key, url: b.url })), params.replace);
    } catch (err: any) {
      for (const b of batch) report.failed.push({ excelRow: b.entry.excelRow, name: b.entry.name || b.entry.key, fileName: b.entry.image!.fileName, reason: String(err?.message || 'تعذر ربط الصورة بالصنف') });
      return;
    }
    batch.forEach((b, i) => {
      const r = results[i];
      if (r?.status === 'updated') report.updated++;
      else if (r?.status === 'skipped') report.skipped++;
      else report.failed.push({ excelRow: b.entry.excelRow, name: b.entry.name || b.entry.key, fileName: b.entry.image!.fileName, reason: r?.error || 'تعذر ربط الصورة بالصنف' });
    });
  };
  let chain = Promise.resolve();
  const outcomes = await runPool(
    withImage,
    params.concurrency ?? 4,
    async entry => {
      const dataUrl = await params.prepare(entry.image!);
      const url = await params.upload(dataUrl);
      report.uploaded++;
      pending.push({ entry, url });
      if (pending.length >= batchSize) {
        chain = chain.then(flush);
        await chain;
      }
      return url;
    },
    { retries: 2, signal: params.signal, onProgress: params.onProgress, retryDelayMs: 300 }
  );
  chain = chain.then(flush);
  await chain;
  outcomes.forEach((o, i) => {
    if (o && !o.ok) report.failed.push({ excelRow: withImage[i].excelRow, name: withImage[i].name || withImage[i].key, fileName: withImage[i].image!.fileName, reason: o.error || 'فشل الرفع' });
  });
  report.cancelled = Boolean(params.signal?.aborted);
  report.failed.sort((a, b) => a.excelRow - b.excelRow);
  return report;
}

// ---------------------------------------------------------------------------
// التصدير
// ---------------------------------------------------------------------------

export interface ExportItem {
  id: string;
  name: string;
  printName?: string;
  stockQuantity?: number;
  categoryId?: string;
  categoryName?: string;
  barcode?: string;
  salePrice?: number;
  purchasePrice?: number;
  notes?: string;
  unit?: string;
  reorderLimit?: number;
  supplier?: string;
  taxRate?: number;
  imageUrl?: string;
}

export interface ExportCategory {
  id: string;
  name: string;
  parentCategoryId?: string | null;
}

/** حروف ممنوعة في أسماء الملفات على ويندوز */
export function sanitizeFileName(name: string): string {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  return clean || 'صنف';
}

/**
 * اسم ملف صورة كل صنف (من غير امتداد): الباركود الرئيسي،
 * ولو الباركود فاضي أو لأكتر من صنف: اسم الصنف (ولو اتكرر يتزود رقم).
 */
export function exportImageBaseNames(items: readonly ExportItem[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const it of items) {
    const b = normalizeBarcode(it.barcode);
    if (b) count.set(b, (count.get(b) || 0) + 1);
  }
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const it of items) {
    const b = normalizeBarcode(it.barcode);
    if (b && count.get(b) === 1 && /^[A-Za-z0-9\-_.]+$/.test(b)) {
      out.set(it.id, b);
      taken.add(b.toLowerCase());
    }
  }
  for (const it of items) {
    if (out.has(it.id)) continue;
    const base = sanitizeFileName(it.name);
    let candidate = base;
    let n = 2;
    while (taken.has(candidate.toLowerCase())) candidate = `${base} (${n++})`;
    taken.add(candidate.toLowerCase());
    out.set(it.id, candidate);
  }
  return out;
}

function categoryLabel(categoryId: string | undefined, fallback: string | undefined, categories: readonly ExportCategory[]): string {
  const cat = categories.find(c => c.id === categoryId);
  if (!cat) return String(fallback || '');
  const parent = cat.parentCategoryId ? categories.find(c => c.id === cat.parentCategoryId) : undefined;
  return parent ? `${parent.name} / ${cat.name}` : cat.name;
}

/** صف الصنف بنفس ترتيب أعمدة نموذج الاستيراد */
export function itemExportRow(item: ExportItem, categories: readonly ExportCategory[], imageFile: string, canViewPurchase = true): unknown[] {
  return [
    item.name,
    item.printName || '',
    Number(item.stockQuantity) || 0,
    categoryLabel(item.categoryId, item.categoryName, categories),
    normalizeBarcode(item.barcode),
    Number(item.salePrice) || 0,
    canViewPurchase ? Number(item.purchasePrice) || 0 : '',
    item.notes || '',
    item.unit || '',
    Number(item.reorderLimit) || 0,
    item.supplier || '',
    Number(item.taxRate) || 0,
    imageFile
  ];
}

export interface ExportFailure {
  name: string;
  barcode: string;
  reason: string;
}

export interface ExportResult {
  zipBytes: Uint8Array;
  fileName: string;
  itemsCount: number;
  imagesExported: number;
  failed: ExportFailure[];
  cancelled: boolean;
}

/** تحويل رابط صورة (أو data:) لبايتات — في المتصفح fetch عادي */
export async function defaultFetchImage(url: string): Promise<Uint8Array> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const base64 = url.slice(comma + 1);
    const bin = atob(base64);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`السيرفر رد بـ ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function formatDateForName(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** تقدير حجم الملف قبل التصدير (متوسط 120 كيلو للصورة) */
export function estimateExportSize(items: readonly ExportItem[]): { itemsCount: number; withImage: number; approxBytes: number } {
  const withImage = items.filter(it => String(it.imageUrl || '').trim()).length;
  return { itemsCount: items.length, withImage, approxBytes: withImage * 120 * 1024 + items.length * 200 };
}

export async function buildItemsExportZip(params: {
  items: readonly ExportItem[];
  categories: readonly ExportCategory[];
  shopName: string;
  date?: Date;
  canViewPurchase?: boolean;
  fetchImage?: (url: string) => Promise<Uint8Array>;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<ExportResult> {
  const fetchImage = params.fetchImage || defaultFetchImage;
  const names = exportImageBaseNames(params.items);
  const zip = new JSZip();
  const folder = zip.folder(IMAGES_FOLDER)!;
  const imageFileOf = new Map<string, string>();
  const failed: ExportFailure[] = [];
  const withImage = params.items.filter(it => String(it.imageUrl || '').trim());
  await runPool(
    withImage,
    params.concurrency ?? 6,
    async item => {
      const bytes = await fetchImage(String(item.imageUrl).trim());
      const ext = sniffImageExt(bytes);
      if (!ext) {
        const err: any = new Error('الملف اللي على السيرفر مش صورة');
        err.noRetry = true;
        throw err;
      }
      const file = `${names.get(item.id)}.${ext}`;
      // الصور مضغوطة أصلًا: تتحط زي ما هي
      folder.file(file, bytes, { compression: 'STORE' });
      imageFileOf.set(item.id, file);
    },
    { retries: 2, signal: params.signal, onProgress: params.onProgress, retryDelayMs: 300 }
  ).then(outcomes =>
    outcomes.forEach((o, i) => {
      if (o && !o.ok) failed.push({ name: withImage[i].name, barcode: normalizeBarcode(withImage[i].barcode), reason: o.error || 'تعذر تحميل الصورة' });
    })
  );
  const cancelled = Boolean(params.signal?.aborted);

  const aoa: unknown[][] = [[...ADD_ITEMS_HEADERS]];
  for (const it of params.items) aoa.push(itemExportRow(it, params.categories, imageFileOf.get(it.id) || '', params.canViewPurchase !== false));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // الباركود واسم الصورة نص (علشان الأصفار اللي على الشمال ما تضيعش)
  for (let r = 1; r < aoa.length; r++) {
    for (const c of [4, 12]) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref]) ws[ref] = { t: 's', v: String(ws[ref].v ?? ''), z: '@' };
    }
  }
  ws['!cols'] = [32, 28, 10, 24, 20, 12, 12, 30, 10, 14, 20, 12, 26].map(wch => ({ wch }));
  (ws as any)['!views'] = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
  const wb = XLSX.utils.book_new();
  (wb as any).Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, ITEMS_SHEET_NAME);
  if (failed.length > 0) {
    const fws = XLSX.utils.aoa_to_sheet([['الصنف', 'الباركود', 'السبب'], ...failed.map(f => [f.name, f.barcode, f.reason])]);
    fws['!cols'] = [{ wch: 32 }, { wch: 20 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, fws, FAILED_SHEET_NAME);
  }
  const xlsxBytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  zip.file(EXPORT_WORKBOOK_NAME, new Uint8Array(xlsxBytes));
  const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'DOS' });
  const shop = sanitizeFileName(params.shopName || 'المحل');
  return {
    zipBytes,
    fileName: `أصناف ${shop} ${formatDateForName(params.date || new Date())}.zip`,
    itemsCount: params.items.length,
    imagesExported: imageFileOf.size,
    failed,
    cancelled
  };
}

/** رسالة آخر التصدير */
export function exportSummaryText(result: Pick<ExportResult, 'itemsCount' | 'imagesExported' | 'failed'>): string {
  const n = (v: number) => v.toLocaleString('en-US');
  const base = `اتصدّر ${n(result.itemsCount)} صنف و${n(result.imagesExported)} صورة`;
  return result.failed.length > 0 ? `${base} • ${n(result.failed.length)} صورة ما اتصدرتش` : base;
}

// ---------------------------------------------------------------------------
// تصغير الصورة قبل الرفع (المتصفح فقط)
// ---------------------------------------------------------------------------

export class ImagePrepareError extends Error {
  noRetry = true;
  constructor(message: string) {
    super(message);
    this.name = 'ImagePrepareError';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * يصغّر الصورة لـ 1000 بكسل من الجانب الأطول (لو أكبر)، ويحفظها JPEG بجودة 85%،
 * أو PNG لو فيها خلفية شفافة. يرجع رابط data جاهز لـ /api/upload-image.
 */
export async function prepareImageForUpload(image: PackageImage): Promise<string> {
  if (image.bytes.length > MAX_SOURCE_IMAGE_BYTES) throw new ImagePrepareError('الصورة أكبر من 5 ميجا');
  const ext = sniffImageExt(image.bytes);
  if (!ext) throw new ImagePrepareError('الملف مش صورة (أو نوعها مش مدعوم)');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([image.bytes.slice().buffer as ArrayBuffer], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }));
  } catch {
    throw new ImagePrepareError('الصورة تالفة ومش بتتفتح');
  }
  let scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const draw = () => {
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  };
  draw();
  let transparent = false;
  if (ext !== 'jpg') {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        transparent = true;
        break;
      }
    }
  }
  const type = transparent ? 'image/png' : 'image/jpeg';
  for (let attempt = 0; attempt < 6; attempt++) {
    if (!transparent) {
      // خلفية بيضا بدل الشفافية الجزئية في JPEG
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new ImagePrepareError('تعذر تجهيز الصورة'))), type, 0.85));
    const out = new Uint8Array(await blob.arrayBuffer());
    if (out.length <= MAX_UPLOAD_IMAGE_BYTES) {
      bitmap.close?.();
      return `data:${type};base64,${bytesToBase64(out)}`;
    }
    scale *= 0.8;
    draw();
  }
  bitmap.close?.();
  throw new ImagePrepareError('الصورة كبيرة حتى بعد التصغير');
}

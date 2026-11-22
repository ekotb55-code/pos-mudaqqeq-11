/**
 * أجزاء شاشة «تعديل بالإكسيل» الخاصة بالصور — POS مدقق
 * ---------------------------------------------------------------------------
 * - ItemImagesPreview: المعاينة قبل التأكيد (الأعداد + اختيار الاستبدال)
 * - ItemImagesProgress: خط التقدم أثناء الحفظ والرفع + «إلغاء»
 * - ItemImagesReport: التقرير في الآخر + جدول الصور اللي ما اترفعتش (يتحمّل إكسيل)
 * - uploadItemImages: تصغير ← رفع على السيرفر ← ربط بالأصناف
 * الرفع دايمًا من خلال سيرفر البرنامج (/api/upload-image)، والمتصفح مش بيكلم تخزين الصور مباشرة.
 */
import React from 'react';
import * as XLSX from 'xlsx';
import { AlertCircle, CheckCircle2, Download, Info, RotateCw } from 'lucide-react';
import { api } from '../api/client';
import type { Item } from '../types';
import { normalizeArabicText } from '../utils/dateUtils';
import { IMAGES_ONLY_HEADERS, normalizeBarcode, type ImageMatchEntry, type ImageMatchResult, type ImportMode } from '../utils/itemImagesPackage';
import { importPackageImages, prepareImageForUpload, type ImportImagesReport } from '../utils/itemImagesTransfer';

const n = (v: number) => Number(v || 0).toLocaleString('en-US');

const nameKey = (v: unknown) => normalizeArabicText(String(v ?? '')).replace(/\s+/g, ' ').trim().toLowerCase();

/** نفس طريقة السيرفر: الباركود الرئيسي الأول، وبعدين الاسم (لو لصنف واحد بس) */
export function findItemForImageKey(items: readonly Item[], key: string): Item | undefined {
  const barcode = normalizeBarcode(key);
  if (barcode) {
    const byBarcode = items.filter(it => normalizeBarcode(it.barcode) === barcode);
    if (byBarcode.length === 1) return byBarcode[0];
    if (byBarcode.length > 1) return undefined;
  }
  const k = nameKey(key);
  const byName = items.filter(it => nameKey(it.name) === k);
  return byName.length === 1 ? byName[0] : undefined;
}

export interface ExistingImagesCheck {
  /** أصناف موجودة وليها صورة */
  withOldImage: number;
  /** أصناف موجودة ومن غير صورة */
  withoutOldImage: number;
  /** صفوف فيها صورة بس الصنف مش موجود */
  notFound: number;
}

/** «تعديل الصور»: كام صنف ليه صورة قبل كده وكام صنف مش موجود */
export function checkExistingImages(entries: readonly ImageMatchEntry[], items: readonly Item[]): ExistingImagesCheck {
  const out: ExistingImagesCheck = { withOldImage: 0, withoutOldImage: 0, notFound: 0 };
  for (const e of entries) {
    if (!e.image || e.problem) continue;
    const item = findItemForImageKey(items, e.key);
    if (!item) out.notFound++;
    else if (String(item.imageUrl || '').trim()) out.withOldImage++;
    else out.withoutOldImage++;
  }
  return out;
}

/** نموذج «تعديل الصور»: عمودين «الصنف» و«الصورة» + ورقة شرح */
export function downloadImagesOnlyTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([[...IMAGES_ONLY_HEADERS]]);
  ws['!cols'] = [{ wch: 34 }, { wch: 30 }];
  (ws as any)['!views'] = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
  const guide = XLSX.utils.aoa_to_sheet([
    ['الصنف', 'الصورة'],
    ['6221234567890', '6221234567890.jpg'],
    ['شاحن سامسونج 25 وات', 'شاحن.png'],
    [],
    ['الشرح:'],
    ['1. الصنف: الباركود الرئيسي للصنف أو اسمه زي ما هو في البرنامج.'],
    ['2. الصورة: اسم ملف الصورة جوه الملف المضغوط (zip)، أو حط الصورة نفسها جوه الخانة.'],
    ['3. لو خانة الصورة فاضية: بياخد الصورة اللي اسمها نفس الباركود الرئيسي (زي 6221234567890.jpg).'],
    ['4. حط ملف الإكسيل ده والصور في ملف مضغوط واحد وارفعه. الروابط (http) مش مقبولة.'],
    ['5. الصور المقبولة: jpg و png و webp و gif، والصورة الواحدة لحد 5 ميجا.']
  ]);
  guide['!cols'] = [{ wch: 34 }, { wch: 30 }];
  (guide as any)['!views'] = [{ rightToLeft: true }];
  const wb = XLSX.utils.book_new();
  (wb as any).Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'الصور');
  XLSX.utils.book_append_sheet(wb, guide, 'مثال وتعليمات');
  XLSX.writeFile(wb, 'نموذج تعديل الصور.xlsx');
}

/** رفع صور الملف وربطها بالأصناف (بعد ما الأصناف تكون اتحفظت) */
export async function uploadItemImages(params: {
  entries: ImageMatchEntry[];
  replace: boolean;
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
}): Promise<ImportImagesReport> {
  // نجيب الأصناف بعد الحفظ: ما نرفعش صورة لصنف مش موجود، ولا لصنف هيفضل بصورته
  let items: Item[] | null = null;
  try {
    const res = await api.getItems();
    if (res?.success && Array.isArray(res.items)) items = res.items;
  } catch {
    items = null;
  }
  const failedBefore: ImportImagesReport['failed'] = [];
  let skippedBefore = 0;
  const toSend: ImageMatchEntry[] = [];
  for (const e of params.entries) {
    if (!e.image || e.problem || !items) {
      toSend.push(e);
      continue;
    }
    const item = findItemForImageKey(items, e.key);
    if (!item) {
      failedBefore.push({ excelRow: e.excelRow, name: e.name || e.key, fileName: e.image.fileName, reason: 'الصنف مش موجود في البرنامج (أو ما اتضافش)' });
    } else if (String(item.imageUrl || '').trim() && !params.replace) {
      skippedBefore++;
    } else {
      toSend.push(e);
    }
  }
  const report = await importPackageImages({
    entries: toSend,
    replace: params.replace,
    prepare: prepareImageForUpload,
    upload: async dataUrl => {
      try {
        const res = await api.uploadImage({ imageBase64: dataUrl, folder: 'items' });
        if (!res?.success || !res.url) throw new Error('السيرفر ما رجّعش رابط الصورة');
        return res.url;
      } catch (err: any) {
        // أخطاء الطلب نفسه (الصورة مرفوضة / مفيش صلاحية) مالهاش لازمة نعيدها
        const status = Number(err?.status || 0);
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) err.noRetry = true;
        throw err;
      }
    },
    setImages: async (batch, replace) => {
      const res = await api.setItemImages(batch, replace);
      if (!res?.success) throw new Error(res?.error || 'تعذر ربط الصور بالأصناف');
      return res.results;
    },
    concurrency: 4,
    batchSize: 50,
    signal: params.signal,
    onProgress: params.onProgress
  });
  report.skipped += skippedBefore;
  report.failed = [...failedBefore, ...report.failed].sort((a, b) => a.excelRow - b.excelRow);
  return report;
}

// ---------------------------------------------------------------------------
// المعاينة قبل التأكيد
// ---------------------------------------------------------------------------

export const ItemImagesPreview: React.FC<{
  mode: ImportMode;
  plan: ImageMatchResult;
  replace: boolean;
  onReplaceChange: (value: boolean) => void;
  existing?: ExistingImagesCheck | null;
  storageEnabled: boolean | null;
  disabled?: boolean;
}> = ({ mode, plan, replace, onReplaceChange, existing, storageEnabled, disabled }) => {
  const withImage = plan.entries.filter(e => e.image && !e.problem).length;
  const problems = plan.entries.filter(e => e.problem);
  return (
    <div className="space-y-3 text-xs">
      <div className="font-bold text-[var(--text-primary)]">الصور</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 max-w-xl">
        <div className="flex items-center justify-between gap-3 py-1 border-b border-[var(--border-subtle)]">
          <span className="text-[var(--text-secondary)] font-semibold">عدد الأصناف في الملف</span>
          <span className="font-bold font-mono">{n(plan.stats.rows)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 py-1 border-b border-[var(--border-subtle)]">
          <span className="text-[var(--text-secondary)] font-semibold">ليها صورة</span>
          <span className="font-bold font-mono ui-money-purchase">{n(withImage)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 py-1 border-b border-[var(--border-subtle)]">
          <span className="text-[var(--text-secondary)] font-semibold">من غير صورة</span>
          <span className="font-bold font-mono">{n(plan.stats.rows - withImage)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 py-1 border-b border-[var(--border-subtle)]">
          <span className="text-[var(--text-secondary)] font-semibold">صور مش مربوطة بأي صنف</span>
          <span className={`font-bold font-mono ${plan.unmatchedImages.length > 0 ? 'ui-stock-low' : ''}`}>{n(plan.unmatchedImages.length)}</span>
        </div>
      </div>

      {mode === 'images_only' && existing && (
        <div className="space-y-1">
          {existing.withOldImage > 0 && (
            <div className={`font-bold ${replace ? 'ui-stock-low' : 'text-[var(--text-secondary)]'}`}>
              {replace
                ? `${n(existing.withOldImage)} صنف ليهم صورة وهتتغير`
                : `${n(existing.withOldImage)} صنف ليهم صورة وهيفضلوا بصورتهم`}
            </div>
          )}
          {existing.withoutOldImage > 0 && (
            <div className="font-bold ui-money-purchase">{n(existing.withoutOldImage)} صنف من غير صورة وهياخدوا صورة</div>
          )}
          {existing.notFound > 0 && (
            <div className="font-bold ui-stock-out">{n(existing.notFound)} صف الصنف بتاعه مش موجود في البرنامج</div>
          )}
        </div>
      )}

      <label className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer font-bold text-[var(--text-primary)]">
        <input
          type="checkbox"
          checked={replace}
          onChange={e => onReplaceChange(e.target.checked)}
          disabled={disabled}
          className="w-4 h-4 cursor-pointer"
        />
        <span>استبدال صور الأصناف اللي ليها صورة</span>
      </label>

      {storageEnabled === false && withImage > 0 && (
        <div role="alert" className="font-bold ui-stock-out flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            {mode === 'images_only'
              ? 'تخزين الصور على السيرفر مش مفعّل في النسخة دي، فمش هينفع ترفع صور'
              : 'تخزين الصور على السيرفر مش مفعّل في النسخة دي: الأصناف هتتحفظ من غير صور'}
          </span>
        </div>
      )}

      {problems.length > 0 && (
        <details className="text-[var(--text-secondary)]">
          <summary className="cursor-pointer font-bold ui-stock-low min-h-[32px]">{n(problems.length)} صف فيه مشكلة في الصورة (هيتساب)</summary>
          <ul className="mt-1 space-y-0.5 pr-4 list-disc">
            {problems.slice(0, 200).map(p => (
              <li key={p.excelRow}>
                الصف {p.excelRow}{p.name ? ` (${p.name})` : ''}: {p.problem}
              </li>
            ))}
          </ul>
        </details>
      )}

      {plan.unmatchedImages.length > 0 && (
        <details className="text-[var(--text-secondary)]">
          <summary className="cursor-pointer font-bold min-h-[32px]">أسماء الصور اللي مش مربوطة بأي صنف</summary>
          <div className="mt-1 font-mono break-all">{plan.unmatchedImages.slice(0, 300).join('، ')}</div>
        </details>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// خط التقدم
// ---------------------------------------------------------------------------

export const ItemImagesProgress: React.FC<{
  stage: 'items' | 'images';
  done: number;
  total: number;
  onCancel: () => void;
  cancelling?: boolean;
}> = ({ stage, done, total, onCancel, cancelling }) => {
  const percent = stage === 'images' && total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div role="status" className="space-y-2 py-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-bold text-[var(--text-primary)]">
          <RotateCw className="w-4 h-4 animate-spin" />
          <span>
            {stage === 'items'
              ? 'بيحفظ الأصناف…'
              : `بيرفع الصور: ${done.toLocaleString('en-US')} من ${total.toLocaleString('en-US')}`}
          </span>
        </div>
        {stage === 'images' && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold ui-stock-out hover:bg-[var(--surface-subtle)] cursor-pointer disabled:opacity-60"
          >
            {cancelling ? 'بيلغي…' : 'إلغاء'}
          </button>
        )}
      </div>
      <div className="h-2 rounded-full bg-[var(--surface-subtle)] overflow-hidden max-w-xl" aria-hidden="true">
        <div className="h-full bg-[#168A4A] transition-[width] duration-300" style={{ width: `${stage === 'items' ? 5 : percent}%` }} />
      </div>
      <div className="text-[var(--text-secondary)]">متقفلش الصفحة لحد ما الرفع يخلص.</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// التقرير
// ---------------------------------------------------------------------------

function downloadFailedImagesExcel(failed: ImportImagesReport['failed']) {
  const ws = XLSX.utils.aoa_to_sheet([
    ['الصف', 'الصنف', 'اسم الملف', 'السبب'],
    ...failed.map(f => [f.excelRow, f.name, f.fileName, f.reason])
  ]);
  ws['!cols'] = [{ wch: 8 }, { wch: 32 }, { wch: 28 }, { wch: 50 }];
  (ws as any)['!views'] = [{ rightToLeft: true }];
  const wb = XLSX.utils.book_new();
  (wb as any).Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'صور ما اترفعتش');
  XLSX.writeFile(wb, 'صور ما اترفعتش.xlsx');
}

export const ItemImagesReport: React.FC<{
  mode: ImportMode;
  addedItems?: number;
  report: ImportImagesReport;
  unmatchedImages: string[];
}> = ({ mode, addedItems, report, unmatchedImages }) => (
  <div className="space-y-3 text-xs">
    <div className={`flex items-center gap-2 font-bold ${report.cancelled ? 'ui-stock-low' : 'ui-money-purchase'}`}>
      {report.cancelled ? <Info className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
      <span>{report.cancelled ? 'الرفع اتلغى: اللي اترفع قبل الإلغاء اتحفظ' : 'خلص الاستيراد'}</span>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-1 font-bold">
      {mode === 'add_items' && <span>{n(addedItems || 0)} صنف اتضاف</span>}
      <span className="ui-money-purchase">{n(report.updated)} صورة اترفعت</span>
      {report.skipped > 0 && <span className="text-[var(--text-secondary)]">{n(report.skipped)} صنف فضل بصورته</span>}
      <span className={report.failed.length > 0 ? 'ui-stock-out' : ''}>{n(report.failed.length)} صورة فشلت</span>
    </div>

    {report.failed.length > 0 && (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="font-bold text-[var(--text-primary)]">صور ما اترفعتش</div>
          <button
            type="button"
            onClick={() => downloadFailedImagesExcel(report.failed)}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تحميل الجدول إكسيل</span>
          </button>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto border border-[var(--border-subtle)] rounded-lg">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--surface)]">
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="text-center px-2 py-1.5">الصف</th>
                <th className="text-right px-2 py-1.5">الصنف</th>
                <th className="text-right px-2 py-1.5">اسم الملف</th>
                <th className="text-right px-2 py-1.5">السبب</th>
              </tr>
            </thead>
            <tbody>
              {report.failed.map((f, i) => (
                <tr key={`${f.excelRow}-${i}`} className="border-b border-[var(--border-subtle)]">
                  <td className="text-center font-mono px-2 py-1">{f.excelRow}</td>
                  <td className="px-2 py-1 font-bold">{f.name}</td>
                  <td className="px-2 py-1 font-mono">{f.fileName || '—'}</td>
                  <td className="px-2 py-1 ui-stock-out font-bold">{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {unmatchedImages.length > 0 && (
      <details className="text-[var(--text-secondary)]">
        <summary className="cursor-pointer font-bold min-h-[32px]">
          صور مش مربوطة بأي صنف ({n(unmatchedImages.length)}) — ما اترفعتش
        </summary>
        <div className="mt-1 font-mono break-all">{unmatchedImages.slice(0, 300).join('، ')}</div>
      </details>
    )}
  </div>
);

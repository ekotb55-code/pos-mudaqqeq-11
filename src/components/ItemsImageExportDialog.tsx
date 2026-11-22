/**
 * نافذة «تصدير الأصناف بالصور» — POS مدقق
 * ملف مضغوط فيه «أصناف.xlsx» بنفس أعمدة «إضافة أصناف» + فولدر «صور» (اسم الصورة = الباركود الرئيسي).
 * loadItems: من «تعديل بالإكسيل» كل الأصناف، ومن عرض الأصناف اللي ظاهر بالفلاتر بس.
 */
import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Info, RotateCw } from 'lucide-react';
import { api } from '../api/client';
import type { Item, ProductCategory } from '../types';
import { ModalShell } from './ui';
import { buildItemsExportZip, estimateExportSize, exportSummaryText, type ExportResult } from '../utils/itemImagesTransfer';

const n = (v: number) => Number(v || 0).toLocaleString('en-US');

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString('en-US', { maximumFractionDigits: 1 })} ميجا`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en-US')} كيلو`;
}

interface ItemsImageExportDialogProps {
  /** وصف الأصناف اللي هتتصدر (مثلًا «كل الأصناف» أو «الأصناف الظاهرة بالفلاتر») */
  scopeLabel: string;
  loadItems: () => Promise<Item[]>;
  canViewPurchase: boolean;
  onClose: () => void;
}

export const ItemsImageExportDialog: React.FC<ItemsImageExportDialogProps> = ({ scopeLabel, loadItems, canViewPurchase, onClose }) => {
  const [items, setItems] = useState<Item[] | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [shopName, setShopName] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      loadItems(),
      api.getCategories().then(r => r.categories || []).catch(() => [] as ProductCategory[]),
      api.getConfig().then(c => c.companySettings?.storeName || c.storeName || '').catch(() => '')
    ])
      .then(([list, cats, name]) => {
        if (!alive) return;
        setItems(list);
        setCategories(cats);
        setShopName(name);
      })
      .catch((err: any) => alive && setLoadError(err?.message || 'تعذر تحميل الأصناف'));
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isRunning = progress !== null && result === null;
  const estimate = items ? estimateExportSize(items) : null;

  useEffect(() => {
    if (!isRunning) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isRunning]);

  const handleStart = async () => {
    if (!items) return;
    setError(null);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: 0, total: estimate?.withImage || 0 });
    try {
      const out = await buildItemsExportZip({
        items,
        categories,
        shopName,
        canViewPurchase,
        concurrency: 6,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total })
      });
      if (out.cancelled) {
        setProgress(null);
        setError('التصدير اتلغى ومفيش ملف اتحمّل');
        return;
      }
      const blob = new Blob([out.zipBytes.slice().buffer as ArrayBuffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = out.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setResult(out);
    } catch (err: any) {
      setProgress(null);
      setError(err?.message || 'تعذر تجهيز ملف التصدير');
    } finally {
      abortRef.current = null;
    }
  };

  const handleCancel = () => abortRef.current?.abort();

  return (
    <ModalShell
      title="تصدير الأصناف بالصور"
      subtitle={scopeLabel}
      onClose={() => !isRunning && onClose()}
      closeDisabled={isRunning}
      footer={
        result ? (
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold cursor-pointer"
          >
            تمام
          </button>
        ) : isRunning ? (
          <button
            type="button"
            onClick={handleCancel}
            className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold ui-stock-out hover:bg-[var(--surface-subtle)] cursor-pointer"
          >
            إلغاء
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={!items || items.length === 0}
              className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-[#168A4A] hover:bg-[#12703C] text-white text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              <span>ابدأ التصدير</span>
            </button>
          </>
        )
      }
    >
      <div className="space-y-3 text-xs min-w-[280px] max-w-md">
        {loadError ? (
          <div role="alert" className="font-bold ui-stock-out">{loadError}</div>
        ) : !items || !estimate ? (
          <div className="flex items-center gap-2 text-[var(--text-secondary)] font-bold">
            <RotateCw className="w-4 h-4 animate-spin" />
            <span>بيحمّل الأصناف…</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
              <span className="text-[var(--text-secondary)] font-semibold">عدد الأصناف</span>
              <span className="font-bold font-mono">{n(estimate.itemsCount)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
              <span className="text-[var(--text-secondary)] font-semibold">ليها صورة</span>
              <span className="font-bold font-mono">{n(estimate.withImage)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
              <span className="text-[var(--text-secondary)] font-semibold">حجم تقريبي</span>
              <span className="font-bold">{formatSize(estimate.approxBytes)}</span>
            </div>
            {!result && !isRunning && (
              <p className="text-[var(--text-secondary)] leading-relaxed">
                هيتعمل ملف مضغوط فيه «أصناف.xlsx» بنفس أعمدة «إضافة أصناف» وفولدر «صور»، واسم كل صورة هو الباركود الرئيسي (ولو الباركود فاضي أو متكرر: اسم الصنف). تقدر تعدّل وترفعه تاني من «إضافة أصناف».
              </p>
            )}
          </>
        )}

        {isRunning && progress && (
          <div role="status" className="space-y-2">
            <div className="flex items-center gap-2 font-bold text-[var(--text-primary)]">
              <RotateCw className="w-4 h-4 animate-spin" />
              <span>
                بيجهّز الصور: {progress.done.toLocaleString('en-US')} من {progress.total.toLocaleString('en-US')}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[var(--surface-subtle)] overflow-hidden" aria-hidden="true">
              <div
                className="h-full bg-[#168A4A] transition-[width] duration-300"
                style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 100}%` }}
              />
            </div>
          </div>
        )}

        {result && (
          <div role="status" className="space-y-1">
            <div className="flex items-center gap-2 font-bold ui-money-purchase">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{exportSummaryText(result)}</span>
            </div>
            <div className="text-[var(--text-secondary)]">
              الملف «<bdi>{result.fileName}</bdi>» اتحمّل.
              {result.failed.length > 0 ? ' أسماء الصور اللي ما اتصدرتش في ورقة «صور ما اتصدرتش» جوه ملف الإكسيل.' : ''}
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-center gap-2 font-bold ui-stock-low">
            <Info className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </ModalShell>
  );
};

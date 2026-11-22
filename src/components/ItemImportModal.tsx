import React, { useState } from 'react';
import { Item, UserRole } from '../types';
import { api } from '../api/client';
import {
  X,
  Download,
  FileSpreadsheet,
  ArrowRight,
  AlertCircle
} from 'lucide-react';
import { getHrefForTarget, isPlainLeftClick } from '../config/navigation';

interface ItemImportModalProps {
  existingItems?: Item[];
  userRole: UserRole;
  onClose: () => void;
  onSuccess?: () => void;
  onOpenBulkImport?: () => void;
}

/**
 * نافذة موحّدة لتحويل استيراد الأصناف إلى نوع «إضافة أصناف» داخل صفحة «تعديل بالإكسيل»
 * لمنع وجود شاشتي استيراد منفصلتين وضمان تطبيق قواعد العمودين الإلزاميين والمخازن.
 */
export const ItemImportModal: React.FC<ItemImportModalProps> = ({
  onClose,
  onOpenBulkImport
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDownloadUnifiedTemplate = async () => {
    setErrorMsg(null);
    setIsDownloading(true);
    try {
      const { blob, fileName } = await api.downloadBulkEditExcelTemplate('add_items');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تحميل نموذج الإكسيل الموحد');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">استيراد وإضافة أصناف بالإكسيل</h3>
              <p className="text-xs text-slate-500">الشاشة الموحدة عبر «تعديل بالإكسيل ← إضافة أصناف»</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs text-slate-700 leading-relaxed">
          <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 text-emerald-950 space-y-2">
            <p className="font-extrabold">العمودان الإلزاميان فقط:</p>
            <p className="font-semibold">
              اسم الصنف، الباركود الرئيسي
            </p>
            <p className="text-[11px] text-emerald-800">
              باقي الأعمدة اختيارية (اسم الطباعة، الكمية، التصنيف، سعر البيع، سعر الشراء، وصف الصنف، الوحدة، الحد الأدنى للكمية، المورد، نسبة الضريبة)، وأي خانة فارغة أو عمود محذوف يأخذ صفرًا للأرقام وفراغًا للنصوص. النموذج يضم ورقة «الأصناف» للعناوين فقط وورقة «مثال وتعليمات» للأمثلة والشرح. يدعم ‎.xlsx‎ و‎.xls‎ و‎.csv‎.
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={handleDownloadUnifiedTemplate}
              disabled={isDownloading}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 font-bold transition cursor-pointer disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              <span>{isDownloading ? 'جاري التحميل...' : 'تحميل نموذج الإكسيل'}</span>
            </button>

            {onOpenBulkImport && (
              <a
                href={getHrefForTarget('bulk_edit_excel', 'add_items', {
                  searchParams: { operationType: 'add_items' }
                })}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return;
                  e.preventDefault();
                  onOpenBulkImport();
                }}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-xs transition cursor-pointer"
              >
                <ArrowRight className="w-4 h-4" />
                <span>الانتقال لصفحة «إضافة أصناف»</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

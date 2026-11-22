import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Invoice, CompanySettings, InvoicePrintSettings, Customer, Item } from '../types';
import { Printer, X, CheckCircle, Copy } from 'lucide-react';
import { ReceiptPrintArea } from './ReceiptPrintArea';
import { prepareAndPrintReceipt } from '../utils/printReceiptHelper';

interface PrintReceiptModalProps {
  invoice: Invoice;
  companySettings?: CompanySettings;
  invoicePrintSettings?: InvoicePrintSettings;
  storeName?: string;
  isReprint?: boolean;
  autoPrint?: boolean;
  customers?: Customer[];
  items?: Item[];
  changeGiven?: number;
  customerBalanceAfter?: number;
  onClose: () => void;
}

export const PrintReceiptModal: React.FC<PrintReceiptModalProps> = ({
  invoice,
  companySettings,
  invoicePrintSettings,
  storeName = 'مدقق للنظم',
  isReprint = false,
  autoPrint = false,
  customers = [],
  items = [],
  changeGiven,
  customerBalanceAfter,
  onClose
}) => {
  const [printPortalTarget, setPrintPortalTarget] = useState<HTMLElement | null>(null);
  const [isLogoLoaded, setIsLogoLoaded] = useState(!companySettings?.logoUrl);
  const hasAutoPrintedRef = useRef(false);

  // عرض بطاقة المعاينة على الشاشة
  const paperSize = invoicePrintSettings?.paperSize ?? '80mm';
  const previewWidthClass =
    paperSize === '58mm'
      ? 'max-w-[320px]'
      : paperSize === 'a4'
      ? 'max-w-2xl'
      : 'max-w-md';

  // التأكد من وجود عنصر #print-root كابن مباشر لـ body
  useEffect(() => {
    let el = document.getElementById('print-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'print-root';
      document.body.appendChild(el);
    }
    setPrintPortalTarget(el);

    return () => {
      const dynamicStyle = document.getElementById('print-page-style');
      if (dynamicStyle) dynamicStyle.remove();
    };
  }, []);

  // تحميل الشعار وصورة الهيدر مسبقاً
  useEffect(() => {
    if (companySettings?.logoUrl) {
      const img = new Image();
      img.onload = () => setIsLogoLoaded(true);
      img.onerror = () => setIsLogoLoaded(true);
      img.src = companySettings.logoUrl;
      if (img.complete) {
        setIsLogoLoaded(true);
      }
    } else {
      setIsLogoLoaded(true);
    }
  }, [companySettings?.logoUrl]);

  // تحضير وطباعة الإيصال كقطعة واحدة متصلة
  const handlePrint = useCallback(() => {
    prepareAndPrintReceipt({
      paperSize,
      printableWidthMm: invoicePrintSettings?.printableWidthMm
    });
  }, [paperSize, invoicePrintSettings?.printableWidthMm]);

  // الطباعة التلقائية إن كانت مفعلة
  useEffect(() => {
    if (autoPrint && printPortalTarget && isLogoLoaded && !hasAutoPrintedRef.current) {
      hasAutoPrintedRef.current = true;
      const timer = setTimeout(() => {
        handlePrint();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [autoPrint, printPortalTarget, isLogoLoaded, handlePrint]);

  return (
    <>
      {/* 1. نافذة المعاينة المباشرة على الشاشة */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto no-print">
        <div className={`relative w-full ${previewWidthClass} bg-white rounded-2xl shadow-2xl overflow-hidden my-8 border border-slate-200`}>
          
          {/* رأس التحكم بالمعاينة */}
          <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900 text-white">
            <div className="flex items-center gap-2">
              {isReprint ? (
                <>
                  <Copy className="w-5 h-5 text-amber-400" />
                  <span className="font-bold text-sm">إعادة طباعة (نسخة مكررة)</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                  <span className="font-bold text-sm">تم تسجيل الفاتورة بنجاح</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition active:scale-95 cursor-pointer shadow-xs"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة إيصال ({paperSize})</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* محتوى المعاينة التفاعلي */}
          <div className="max-h-[calc(75vh/var(--app-zoom,1))] overflow-y-auto bg-slate-100 p-4 flex justify-center">
            <div className="w-full bg-white shadow-md rounded-xl overflow-hidden border border-slate-200">
              <ReceiptPrintArea
                invoice={invoice}
                companySettings={companySettings}
                invoicePrintSettings={invoicePrintSettings}
                storeName={storeName}
                isReprint={isReprint}
                customers={customers}
                items={items}
                changeGiven={changeGiven}
                customerBalanceAfter={customerBalanceAfter}
              />
            </div>
          </div>

          {/* أزرار الإغلاق والطباعة في الأسفل */}
          <div className="p-4 bg-slate-50 flex items-center justify-end gap-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 transition cursor-pointer"
            >
              إغلاق
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-cyan-700 hover:bg-cyan-800 rounded-xl shadow-md transition active:scale-95 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة الإيصال الآن</span>
            </button>
          </div>

        </div>
      </div>

      {/* 2. Portal الطباعة المباشر إلى #print-root */}
      {printPortalTarget &&
        createPortal(
          <ReceiptPrintArea
            invoice={invoice}
            companySettings={companySettings}
            invoicePrintSettings={invoicePrintSettings}
            storeName={storeName}
            isReprint={isReprint}
            customers={customers}
            items={items}
            changeGiven={changeGiven}
            customerBalanceAfter={customerBalanceAfter}
          />,
          printPortalTarget
        )}
    </>
  );
};

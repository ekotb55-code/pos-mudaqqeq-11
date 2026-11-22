import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Smartphone, X } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="navbar-glass-chip navbar-glass-chip--mobile-icon gap-1.5 cursor-pointer active:scale-95"
        title="تثبيت التطبيق على جهازك للعمل السريع"
        aria-label="تثبيت التطبيق"
      >
        <Download className="w-[15px] h-[15px] shrink-0" />
        <span className="hidden sm:inline">تثبيت التطبيق</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="navbar-glass-chip navbar-glass-chip--mobile-icon gap-1.5 cursor-pointer active:scale-95"
          title="تثبيت التطبيق على الآيفون"
          aria-label="تثبيت التطبيق على الآيفون"
        >
          <Smartphone className="w-[15px] h-[15px] shrink-0" />
          <span className="hidden sm:inline">تثبيت على الآيفون</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-slate-800 text-right">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-base font-bold text-slate-900">تثبيت التطبيق على iPhone / iPad</h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-600 leading-relaxed">
                <p className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-100 text-cyan-800 font-bold flex items-center justify-center text-xs">١</span>
                  <span>اضغط على زر <strong>المشاركة (Share)</strong> في شريط متصفح Safari بالأسفل.</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-100 text-cyan-800 font-bold flex items-center justify-center text-xs">٢</span>
                  <span>مرر لأسفل واختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-100 text-cyan-800 font-bold flex items-center justify-center text-xs">٣</span>
                  <span>اضغط <strong>إضافة (Add)</strong> بالأعلى لتثبيت التطبيق كبرنامج مستقل وسريع.</span>
                </p>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full py-2.5 rounded-xl bg-cyan-700 text-white font-medium hover:bg-cyan-800 transition"
              >
                فهمت ذلك
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

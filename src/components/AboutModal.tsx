import React from 'react';
import { X, ShieldCheck } from 'lucide-react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto" dir="rtl">
      <div className="bg-white rounded-3xl max-w-lg w-full border border-[#D9E8F3] shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="bg-gradient-to-b from-[#E8F3FB] to-white p-6 pb-4 border-b border-[#D9E8F3] flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 bg-white rounded-2xl p-1.5 border border-[#42BDE5]/40 shadow-xs flex items-center justify-center shrink-0">
              <img
                src="/brand/app-logo.png"
                alt="شعار مدقق للنظم"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-[#164E72] flex items-center gap-2">
                <span>مدقق للنظم</span>
                <span className="text-xs font-bold text-[#42BDE5] border border-[#42BDE5]/30 bg-sky-50 px-2 py-0.5 rounded-full">
                  Mudaqqeq Systems
                </span>
              </h2>
              <p className="text-xs text-[#718293] mt-0.5">
                نظام نقاط البيع وإدارة المخزون وتدقيق مبيعات المنصات الرقمية
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[#718293] hover:text-[#263746] hover:bg-[#E8F3FB] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 text-sm text-[#263746]">
          {/* Highlights & Security */}
          <div className="p-3.5 rounded-2xl bg-[#E8F3FB] border border-[#D9E8F3] text-xs text-[#164E72] space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold">
              <ShieldCheck className="w-4 h-4 text-[#168A78]" />
              <span>أبرز مزايا نظام «مدقق للمنصات»:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-[#263746] pr-1">
              <li>ربط مباشر وحفظ سحابي فوري وموثوق مع قاعدة البيانات.</li>
              <li>تدقيق فوري لعمولات المنصات (أمازون، نون، جوميا، بي تك) ومصاريف الشحن.</li>
              <li>حماية الصلاحيات الصارمة (RBAC) مع حجب الأرباح والتكاليف عن الموظفين.</li>
              <li>دعم كامل للطباعة على إيصالات 80mm و 58mm و A4.</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#F4F9FD] border-t border-[#D9E8F3] flex items-center justify-between text-xs text-[#718293]">
          <span>الإصدار 2.5 • إنتاج 2026</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#1678C2] hover:bg-[#164E72] text-white font-bold transition cursor-pointer"
          >
            إغلاق
          </button>
        </div>

      </div>
    </div>
  );
};

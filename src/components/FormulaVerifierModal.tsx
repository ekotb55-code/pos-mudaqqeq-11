import React, { useState } from 'react';
import { X, Calculator, CheckCircle2, Truck } from 'lucide-react';

interface FormulaVerifierModalProps {
  onClose: () => void;
}

export const FormulaVerifierModal: React.FC<FormulaVerifierModalProps> = ({ onClose }) => {
  // الحالات المعتمدة في النظام
  // الحالات المعتمدة في النظام
  const [salePrice, setSalePrice] = useState<number | ''>(5000);
  const [bnplPercent, setBnplPercent] = useState<number | ''>(0);
  const [discountPercent, setDiscountPercent] = useState<number | ''>(10);
  const [pickupFee, setPickupFee] = useState<number | ''>(0);
  const [deliveryFee, setDeliveryFee] = useState<number | ''>(0);
  const [quantity, setQuantity] = useState<number | ''>(1);

  const loadCase1 = () => {
    setSalePrice(5000);
    setBnplPercent(0);
    setDiscountPercent(10);
    setPickupFee(0);
    setDeliveryFee(0);
    setQuantity(1);
  };

  const loadCase2 = () => {
    setSalePrice(5000);
    setBnplPercent(0);
    setDiscountPercent(10);
    setPickupFee(25);
    setDeliveryFee(0);
    setQuantity(1);
  };

  const loadCase3 = () => {
    setSalePrice(100);
    setBnplPercent(0);
    setDiscountPercent(0);
    setPickupFee(0);
    setDeliveryFee(20);
    setQuantity(1);
  };

  const loadCase4 = () => {
    setSalePrice(5000);
    setBnplPercent(20);
    setDiscountPercent(14.5);
    setPickupFee(0);
    setDeliveryFee(0);
    setQuantity(1);
  };

  // الحسابات بدون أي تقريب وسيط وبدون شحن:
  const basePrice = Number(salePrice) || 0;
  const bp = Number(bnplPercent) || 0;
  const dp = Number(discountPercent) || 0;
  const pf = Number(pickupFee) || 0;
  const df = Number(deliveryFee) || 0;
  const qty = Number(quantity) || 1;

  // 1. سعر العميل للوحدة وزيادة BNPL
  const customerUnitPrice = bp > 0 ? Math.round(basePrice * (1 + bp / 100) * 100) / 100 : basePrice;
  const bnplUnitAmount = Math.round((customerUnitPrice - basePrice) * 100) / 100;

  // 2. إجمالي المنتجات المعروض للعميل = مجموع سعر العميل للوحدة × الكمية
  const totalProducts = customerUnitPrice * qty;

  // 3. بند BNPL المستقطع = زيادة التقسيط المستقطعة بالكامل للمنصة
  const totalBnpl = bnplUnitAmount * qty;

  // 4. عمولة المنصة = تُحسب على السعر الأساسي فقط وليس على سعر العميل
  const unitDiscountValue = basePrice * (dp / 100);
  const totalDiscount = unitDiscountValue * qty;

  // 5. رسوم الالتقاط = رسوم الالتقاط للوحدة × الكمية
  const totalPickupFee = pf * qty;

  // 6. صافي المنتجات = إجمالي المنتجات − استقطاع BNPL − خصم المنصة − رسوم الالتقاط
  const netProducts = totalProducts - totalBnpl - totalDiscount - totalPickupFee;

  // 7. المطلوب من العميل / صافي الفاتورة = صافي المنتجات + رسوم التوصيل
  const finalNetAmount = Math.round((netProducts + df) * 100) / 100;

  // مطابقة الحالات:
  const isCase1 = basePrice === 5000 && bp === 0 && dp === 10 && pf === 0 && df === 0 && qty === 1;
  const isCase1Valid = isCase1 && Math.abs(finalNetAmount - 4500) < 0.001;

  const isCase2 = basePrice === 5000 && bp === 0 && dp === 10 && pf === 25 && df === 0 && qty === 1;
  const isCase2Valid = isCase2 && Math.abs(finalNetAmount - 4475) < 0.001;

  const isCase3 = basePrice === 100 && bp === 0 && dp === 0 && pf === 0 && df === 20 && qty === 1;
  const isCase3Valid = isCase3 && Math.abs(finalNetAmount - 120) < 0.001;

  const isCase4 = basePrice === 5000 && bp === 20 && dp === 14.5 && pf === 0 && df === 0 && qty === 1;
  const isCase4Valid = isCase4 && Math.abs(finalNetAmount - 4275) < 0.001 && Math.abs(totalProducts - 6000) < 0.001 && Math.abs(totalBnpl - 1000) < 0.001;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto" dir="rtl">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden my-8 border border-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="font-extrabold text-base">مدقق ومعاير المعادلات (بعد إزالة الشحن وإضافة التوصيل)</h3>
              <p className="text-[11px] text-slate-400">فحص صافي الاستلام ورسوم الالتقاط والعمولة ورسوم التوصيل</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          
          {/* Quick Action Buttons for Test Cases */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-slate-600">اختبار الحالات القياسية المعتمدة:</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={loadCase1}
                className={`p-2.5 rounded-xl border text-right transition cursor-pointer flex flex-col justify-between ${
                  isCase1
                    ? 'border-cyan-500 bg-cyan-50/80 ring-2 ring-cyan-500/20'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                  <span>الحالة 1 (أساسي):</span>
                  {isCase1Valid && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                </div>
                <div className="text-[10px] text-slate-600 font-mono mt-1 leading-snug">
                  5000 ج • 10% عمولة = <strong className="text-cyan-900">4500 ج.م</strong>
                </div>
              </button>

              <button
                onClick={loadCase2}
                className={`p-2.5 rounded-xl border text-right transition cursor-pointer flex flex-col justify-between ${
                  isCase2
                    ? 'border-cyan-500 bg-cyan-50/80 ring-2 ring-cyan-500/20'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                  <span>الحالة 2 (التقاط):</span>
                  {isCase2Valid && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                </div>
                <div className="text-[10px] text-slate-600 font-mono mt-1 leading-snug">
                  5000 ج • 10% • 25 التقاط = <strong className="text-cyan-900">4475 ج.م</strong>
                </div>
              </button>

              <button
                onClick={loadCase3}
                className={`p-2.5 rounded-xl border text-right transition cursor-pointer flex flex-col justify-between ${
                  isCase3
                    ? 'border-cyan-500 bg-cyan-50/80 ring-2 ring-cyan-500/20'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                  <span>الحالة 3 (توصيل):</span>
                  {isCase3Valid && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                </div>
                <div className="text-[10px] text-slate-600 font-mono mt-1 leading-snug">
                  100 ج أصناف + 20 توصيل = <strong className="text-cyan-900">120 ج.م</strong>
                </div>
              </button>

              <button
                onClick={loadCase4}
                className={`p-2.5 rounded-xl border text-right transition cursor-pointer flex flex-col justify-between ${
                  isCase4
                    ? 'border-purple-500 bg-purple-50/80 ring-2 ring-purple-500/20'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                  <span>الحالة 4 (BNPL تقسيط):</span>
                  {isCase4Valid && <CheckCircle2 className="w-4 h-4 text-purple-600" />}
                </div>
                <div className="text-[10px] text-slate-600 font-mono mt-1 leading-snug">
                  5000 ج • 20% BNPL • 14.5% = <strong className="text-purple-900">4275 ج.م</strong>
                  <span className="block text-[9px] text-purple-600 font-semibold">(مجموع 6000 - 1000 BNPL)</span>
                </div>
              </button>
            </div>
          </div>

          {/* Test Inputs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                سعر البيع الأساسي (ج.م)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-900 bg-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-purple-700 mb-1">
                نسبة BNPL للتقسيط (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={bnplPercent}
                onChange={(e) => setBnplPercent(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-xl border border-purple-300 font-mono font-bold text-purple-900 bg-purple-50/40 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                عمولة المنصة (%)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-900 bg-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                رسوم الالتقاط (ج.م)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={pickupFee}
                onChange={(e) => setPickupFee(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-xl border border-amber-300 font-mono font-bold text-amber-900 bg-amber-50/40 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1">
                <Truck className="w-3 h-3 text-emerald-600" />
                رسوم التوصيل (ج.م)
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={deliveryFee}
                onChange={(e) => setDeliveryFee(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                className="w-full px-2.5 py-1.5 rounded-xl border border-emerald-300 font-mono font-bold text-emerald-900 bg-emerald-50/40 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                الكمية (قطعة)
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-900 bg-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>

          {/* Results Verification Table */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 text-xs">
            <div className="flex items-center justify-between p-2.5 bg-slate-50 font-bold text-slate-600">
              <span>البند الحسابي</span>
              <span>القيمة المحسوبة</span>
            </div>

            <div className="flex items-center justify-between p-2.5 text-slate-800">
              <span>
                إجمالي المنتجات المعروض للعميل ({customerUnitPrice.toFixed(2)} × {qty}):
                {bp > 0 && <span className="text-[10px] text-purple-600 mr-1 font-semibold">(الأساسي: {basePrice} ج.م)</span>}
              </span>
              <span className="font-mono font-bold text-slate-900">
                {totalProducts.toFixed(2)} ج.م
              </span>
            </div>

            {totalBnpl > 0 && (
              <div className="flex items-center justify-between p-2.5 text-purple-900 bg-purple-50/60 font-medium">
                <span>استقطاع تقسيط المنصة (BNPL +{bp}%):</span>
                <span className="font-mono font-bold text-purple-700">
                  - {totalBnpl.toFixed(2)} ج.م
                </span>
              </div>
            )}

            {totalDiscount > 0 && (
              <div className="flex items-center justify-between p-2.5 text-slate-800">
                <span>خصم عمولة المنصة ({dp}% على الأساسي {basePrice} ج):</span>
                <span className="font-mono font-bold text-rose-600">
                  - {totalDiscount.toFixed(2)} ج.م
                </span>
              </div>
            )}

            {totalPickupFee > 0 && (
              <div className="flex items-center justify-between p-2.5 text-amber-900 bg-amber-50/50">
                <span>رسوم الالتقاط ({pf} ج.م × {qty} قطعة):</span>
                <span className="font-mono font-bold text-amber-700">
                  - {totalPickupFee.toFixed(2)} ج.م
                </span>
              </div>
            )}

            {df > 0 && (
              <div className="flex items-center justify-between p-2.5 text-emerald-900 bg-emerald-50/50 font-medium">
                <span>رسوم التوصيل المضافة:</span>
                <span className="font-mono font-bold text-emerald-700">
                  + {df.toFixed(2)} ج.م
                </span>
              </div>
            )}

            <div className="flex items-center justify-between p-3 bg-cyan-50/80 font-bold text-cyan-950">
              <span className="text-sm">صافي الفاتورة / المطلوب للمتجر:</span>
              <span className="font-mono font-black text-lg text-cyan-900">
                {finalNetAmount.toFixed(2)} ج.م
              </span>
            </div>
          </div>

          {/* Verification Status */}
          {(isCase1Valid || isCase2Valid || isCase3Valid || isCase4Valid) && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-950 flex items-start gap-2.5 text-xs">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-extrabold">
                  {isCase1Valid && '✅ الحالة 1 مطابقة 100%: 5000 − 500 (عمولة 10%) = 4500 ج.م'}
                  {isCase2Valid && '✅ الحالة 2 مطابقة 100%: 5000 − 500 (عمولة 10%) − 25 (التقاط) = 4475 ج.م'}
                  {isCase3Valid && '✅ الحالة 3 مطابقة 100%: أصناف 100 + توصيل 20 = 120 ج.م'}
                  {isCase4Valid && '✅ الحالة 4 (BNPL) مطابقة 100%: سعر العميل 6000 − 1000 (BNPL) − 725 (عمولة 14.5% على الأساسي 5000) = 4275 ج.م'}
                </div>
                <div className="text-[11px] text-emerald-800 mt-0.5">
                  القاعدة الذهبية: الصافي مع BNPL مطابق تماماً للصافي بدون BNPL (4275 ج.م)، والعمولة تُحسب على الأساسي فقط.
                </div>
              </div>
            </div>
          )}

          {/* Footer Action */}
          <div className="pt-2 flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer"
            >
              إغلاق الفاحص
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};

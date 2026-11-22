import React, { useState, useMemo } from 'react';
import {
  Invoice,
  Item,
  Platform,
  ItemPlatformCost,
  ReturnRecord,
  UserAccount,
  TaxSettings
} from '../types';
import { hasPermission } from '../utils/permissions';
import {
  AlertTriangle,
  Save,
  CheckCircle2,
  Trash2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Lock
} from 'lucide-react';
import {
  ModalShell,
  SectionHeading,
  CompactTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
} from './ui';

interface EditInvoiceModalProps {
  invoice: Invoice;
  items: Item[];
  platforms: Platform[];
  costs: ItemPlatformCost[];
  returns: ReturnRecord[];
  user: UserAccount | null;
  taxSettings?: TaxSettings;
  latestItemFirst?: boolean;
  onClose: () => void;
  onSave: (updatedInvoicePayload: any) => Promise<void>;
}

interface EditableLine {
  id: string;
  itemId: string;
  itemName: string;
  barcode: string;
  quantity: number;
  salePrice: number;
  minPrice: number;
  purchasePrice: number;
  packagingCost: number;
  taxRate: number;
  pickupFee: number;
  returnedQty: number;
  baseUnitPrice?: number;
  customerUnitPrice?: number;
  bnplPercent?: number;
  bnplUnitAmount?: number;
}

export const EditInvoiceModal: React.FC<EditInvoiceModalProps> = ({
  invoice,
  items,
  platforms,
  costs,
  returns,
  user,
  taxSettings = { taxInclusive: true, platformCommissionOn: 'before_tax' },
  latestItemFirst = false,
  onClose,
  onSave
}) => {
  const isDesigner = user?.role === 'designer' || Boolean(user?.isOwner);

  // الصلاحيات الدقيقة
  const canEditPrice = isDesigner || hasPermission(user, 'invoices.edit_price_after_save');
  const canEditTax = isDesigner || hasPermission(user, 'invoices.edit_tax_after_save');
  const canEditQty = isDesigner || hasPermission(user, 'invoices.edit_quantity_after_save');
  const canEditItems = isDesigner || hasPermission(user, 'invoices.edit_items_after_save');
  const canEditPlatform = isDesigner || hasPermission(user, 'invoices.edit_platform_after_save');
  const canEditCustomer = isDesigner || hasPermission(user, 'invoices.edit_customer_after_save');
  const canEditCashbox = isDesigner || hasPermission(user, 'invoices.edit_cashbox_after_save');
  const canOverrideMinPrice = isDesigner || hasPermission(user, 'prices.override_min_price');
  const canViewProfit = isDesigner || hasPermission(user, 'reports.view_profit');

  // حساب المرتجعات المسجلة على هذه الفاتورة
  const invoiceReturns = useMemo(() => {
    return returns.filter(r => r.invoiceNumber === invoice.invoiceNumber);
  }, [returns, invoice.invoiceNumber]);

  const returnedItemMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ret of invoiceReturns) {
      for (const line of (ret.lines || [])) {
        map[line.itemId] = (map[line.itemId] || 0) + (line.returnedQuantity || 0);
      }
    }
    return map;
  }, [invoiceReturns]);

  // حالة المنصة
  const [platformId, setPlatformId] = useState<string>(() => {
    const found = platforms.find(p => p.name === invoice.platform || p.id === invoice.platformId);
    return found ? found.id : (platforms[0]?.id || '');
  });

  const selectedPlatform = useMemo(() => {
    return platforms.find(p => p.id === platformId) || platforms[0];
  }, [platforms, platformId]);

  // حالة العميل والخزنة والملاحظات
  const [customerName, setCustomerName] = useState<string>(invoice.customerName || '');
  const [notes, setNotes] = useState<string>(invoice.notes || '');
  const [cashboxName, setCashboxName] = useState<string>(invoice.cashboxName || 'الخزينة الرئيسية');
  const [editReason, setEditReason] = useState<string>('');

  // تهيئة أسطر الفاتورة
  const [lines, setLines] = useState<EditableLine[]>(() => {
    return (invoice.lines || []).map((l, idx) => {
      const it = items.find(i => i.id === l.itemId);
      const basePrice = l.baseUnitPrice !== undefined ? Number(l.baseUnitPrice) : Number(l.salePriceAtSale || 0);
      let lineBnpl = l.bnplPercent;
      if (lineBnpl === undefined || lineBnpl === null) {
        if (it?.enableBnpl && it.bnplPercentage !== undefined) {
          lineBnpl = Number(it.bnplPercentage || 0);
        } else if (selectedPlatform?.enableBnpl && selectedPlatform.bnplPercentage !== undefined) {
          lineBnpl = Number(selectedPlatform.bnplPercentage || 0);
        } else {
          lineBnpl = 0;
        }
      }
      const customerUnitPrice = l.customerUnitPrice !== undefined
        ? Number(l.customerUnitPrice)
        : (lineBnpl > 0 ? Math.round(basePrice * (1 + lineBnpl / 100) * 100) / 100 : basePrice);
      const bnplUnitAmount = l.bnplUnitAmount !== undefined
        ? Number(l.bnplUnitAmount)
        : Math.round((customerUnitPrice - basePrice) * 100) / 100;

      return {
        id: `line_${idx}_${l.itemId}`,
        itemId: l.itemId,
        itemName: l.itemNameAtSale || it?.name || 'صنف',
        barcode: l.barcodeAtSale || it?.barcode || '',
        quantity: l.quantity,
        salePrice: basePrice,
        minPrice: it?.minPrice ?? 0,
        purchasePrice: l.purchasePriceAtSale ?? it?.purchasePrice ?? 0,
        packagingCost: l.packagingCostAtSale ?? it?.packagingCost ?? 0,
        taxRate: l.taxRateAtSale ?? it?.taxRate ?? 0,
        pickupFee: l.unitPickupFee ?? Number(selectedPlatform?.pickupFee ?? 0),
        returnedQty: returnedItemMap[l.itemId] || 0,
        baseUnitPrice: basePrice,
        customerUnitPrice,
        bnplPercent: lineBnpl,
        bnplUnitAmount
      };
    });
  });

  const [selectedItemToAdd, setSelectedItemToAdd] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showConfirmation, setShowConfirmation] = useState<boolean>(false);

  // تحديث رسوم الالتقاط عند تغيير المنصة
  const handlePlatformChange = (newPlatId: string) => {
    if (!canEditPlatform) return;
    setPlatformId(newPlatId);
    const newPlat = platforms.find(p => p.id === newPlatId);
    const newPickup = Number(newPlat?.pickupFee || 0);

    setLines(prev => prev.map(l => {
      const it = items.find(i => i.id === l.itemId);
      let lineBnpl = 0;
      if (it?.enableBnpl && it.bnplPercentage !== undefined) {
        lineBnpl = Number(it.bnplPercentage || 0);
      } else if (newPlat?.enableBnpl && newPlat.bnplPercentage !== undefined) {
        lineBnpl = Number(newPlat.bnplPercentage || 0);
      }
      const basePrice = Number(l.salePrice || 0);
      const customerUnitPrice = lineBnpl > 0 ? Math.round(basePrice * (1 + lineBnpl / 100) * 100) / 100 : basePrice;
      const bnplUnitAmount = Math.round((customerUnitPrice - basePrice) * 100) / 100;

      return {
        ...l,
        pickupFee: newPickup,
        bnplPercent: lineBnpl,
        customerUnitPrice,
        bnplUnitAmount
      };
    }));
  };

  // إضافة صنف جديد
  const handleAddItem = (itemId: string) => {
    if (!canEditItems || !itemId) return;
    const it = items.find(i => i.id === itemId);
    if (!it) return;

    const existingIdx = lines.findIndex(l => l.itemId === itemId);
    if (existingIdx >= 0) {
      if (!canEditQty) {
        setErrorMsg('الصنف موجود بالفعل ولا تملك صلاحية تعديل الكمية');
        return;
      }
      const nextQty = lines[existingIdx].quantity + 1;
      if (latestItemFirst) {
        setLines(prev => {
          const idx = prev.findIndex(l => l.itemId === itemId);
          if (idx < 0) return prev;
          const target = prev[idx];
          const updatedLine: EditableLine = { ...target, quantity: target.quantity + 1 };
          return [updatedLine, ...prev.filter((_, i) => i !== idx)];
        });
        setErrorMsg(null);
      } else {
        handleUpdateQuantity(existingIdx, nextQty);
      }
      setSelectedItemToAdd('');
      return;
    }

    const newPickup = Number(selectedPlatform?.pickupFee || 0);
    let lineBnpl = 0;
    if (it.enableBnpl && it.bnplPercentage !== undefined) {
      lineBnpl = Number(it.bnplPercentage || 0);
    } else if (selectedPlatform?.enableBnpl && selectedPlatform.bnplPercentage !== undefined) {
      lineBnpl = Number(selectedPlatform.bnplPercentage || 0);
    }
    const basePrice = Number(it.salePrice || 0);
    const customerUnitPrice = lineBnpl > 0 ? Math.round(basePrice * (1 + lineBnpl / 100) * 100) / 100 : basePrice;
    const bnplUnitAmount = Math.round((customerUnitPrice - basePrice) * 100) / 100;

    const newLine: EditableLine = {
      id: `line_${Date.now()}_${itemId}`,
      itemId: it.id,
      itemName: it.name,
      barcode: it.barcode || '',
      quantity: 1,
      salePrice: basePrice,
      minPrice: it.minPrice ?? 0,
      purchasePrice: it.purchasePrice ?? 0,
      packagingCost: it.packagingCost ?? 0,
      taxRate: it.taxRate ?? 0,
      pickupFee: newPickup,
      returnedQty: 0,
      baseUnitPrice: basePrice,
      customerUnitPrice,
      bnplPercent: lineBnpl,
      bnplUnitAmount
    };
    setLines(prev => (latestItemFirst ? [newLine, ...prev] : [...prev, newLine]));
    setSelectedItemToAdd('');
    setErrorMsg(null);
  };

  // حذف صنف
  const handleRemoveLine = (idx: number) => {
    if (!canEditItems) return;
    const line = lines[idx];
    if (line.returnedQty > 0) {
      setErrorMsg(`لا يمكن حذف الصنف "${line.itemName}" لأنه يحتوي على مرتجع مسجل (${line.returnedQty} قطعة)`);
      return;
    }
    setLines(prev => prev.filter((_, i) => i !== idx));
    setErrorMsg(null);
  };

  // تعديل الكمية
  const handleUpdateQuantity = (idx: number, newQty: number) => {
    if (!canEditQty) return;
    const line = lines[idx];
    if (newQty < line.returnedQty) {
      setErrorMsg(`لا يمكن تقليل كمية الصنف "${line.itemName}" إلى أقل من الكمية المرتجعة المسجلة (${line.returnedQty} قطعة)`);
      return;
    }
    if (newQty <= 0) {
      if (canEditItems) {
        handleRemoveLine(idx);
        return;
      } else {
        setErrorMsg('الكمية يجب أن تكون 1 على الأقل');
        return;
      }
    }
    setLines(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], quantity: newQty };
      return updated;
    });
    setErrorMsg(null);
  };

  // تعديل السعر
  const handleUpdatePrice = (idx: number, newPrice: number) => {
    if (!canEditPrice) return;
    const line = lines[idx];
    if (!canOverrideMinPrice && line.minPrice > 0 && newPrice < line.minPrice) {
      setErrorMsg(`سعر البيع لا يمكن أن يقل عن الحد الأدنى للصنف (${line.minPrice} ج.م) بدون صلاحية تجاوز الحد الأدنى`);
      return;
    }
    const lineBnpl = line.bnplPercent || 0;
    const customerUnitPrice = lineBnpl > 0 ? Math.round(newPrice * (1 + lineBnpl / 100) * 100) / 100 : newPrice;
    const bnplUnitAmount = Math.round((customerUnitPrice - newPrice) * 100) / 100;

    setLines(prev => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        salePrice: newPrice,
        baseUnitPrice: newPrice,
        customerUnitPrice,
        bnplUnitAmount
      };
      return updated;
    });
    setErrorMsg(null);
  };

  // تعديل نسبة الضريبة
  const handleUpdateTaxRate = (idx: number, newTaxRate: number) => {
    if (!canEditTax) return;
    setLines(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], taxRate: newTaxRate };
      return updated;
    });
    setErrorMsg(null);
  };

  // الحسابات المالية التلقائية بعد التعديل
  const recalculatedFinancials = useMemo(() => {
    const discPercent = selectedPlatform?.discountPercentage || 0;
    const taxInclusive = taxSettings.taxInclusive ?? true;
    const commissionOn = taxSettings.platformCommissionOn ?? 'before_tax';

    let totalProducts = 0;
    let totalBnpl = 0;
    let totalDiscount = 0;
    let totalPickup = 0;
    let totalTax = 0;
    let totalCost = 0;

    const calculatedLines = lines.map(line => {
      const basePrice = Number(line.salePrice) || 0;
      const lineBnpl = Number(line.bnplPercent) || 0;
      const customerUnitPrice = lineBnpl > 0 ? Math.round(basePrice * (1 + lineBnpl / 100) * 100) / 100 : basePrice;
      const bnplUnitAmount = Math.round((customerUnitPrice - basePrice) * 100) / 100;
      const effectiveTaxRate = Number(line.taxRate) || 0;
      const qty = Number(line.quantity) || 1;

      let unitBase = basePrice;
      let unitTax = 0;

      if (effectiveTaxRate > 0) {
        if (taxInclusive) {
          unitBase = basePrice / (1 + effectiveTaxRate / 100);
          unitTax = basePrice - unitBase;
        } else {
          unitBase = basePrice;
          unitTax = basePrice * (effectiveTaxRate / 100);
        }
      }

      const commissionBase = commissionOn === 'before_tax' ? unitBase : basePrice;
      const unitDiscount = commissionBase * (discPercent / 100);
      const unitPickup = Number(line.pickupFee) || 0;
      const unitNet = basePrice - unitDiscount - unitPickup;

      const unitProfit = canViewProfit
        ? ((basePrice - unitTax) - unitDiscount - unitPickup) - (line.purchasePrice || 0) - (line.packagingCost || 0)
        : undefined;

      totalProducts += customerUnitPrice * qty;
      totalBnpl += bnplUnitAmount * qty;
      totalDiscount += unitDiscount * qty;
      totalPickup += unitPickup * qty;
      totalTax += unitTax * qty;
      totalCost += ((line.purchasePrice || 0) + (line.packagingCost || 0)) * qty;

      return {
        ...line,
        baseUnitPrice: basePrice,
        customerUnitPrice,
        bnplPercent: lineBnpl,
        bnplUnitAmount,
        unitBase,
        unitTax,
        unitDiscount,
        unitNet,
        unitProfit
      };
    });

    const deliveryFee = Number(invoice.deliveryFee) || 0;
    const netAmount = totalProducts - totalBnpl - totalDiscount - totalPickup + deliveryFee;
    const netProfit = canViewProfit ? ((totalProducts - totalBnpl - totalDiscount - totalPickup) - totalTax - totalCost) : undefined;

    return {
      calculatedLines,
      totalProducts,
      totalBnpl,
      totalDiscount,
      totalPickup,
      deliveryFee,
      totalTax,
      netAmount,
      netProfit,
      totalCost
    };
  }, [lines, selectedPlatform, taxSettings, canViewProfit, invoice.deliveryFee]);

  // التحقق والتجهيز للحفظ
  const handlePrepareSubmit = () => {
    setErrorMsg(null);
    if (lines.length === 0) {
      setErrorMsg('لا يمكن حفظ فاتورة خالية من الأصناف');
      return;
    }
    if (!editReason.trim()) {
      setErrorMsg('يرجى كتابة سبب التعديل بشكل واضح لحفظه في سجل التدقيق');
      return;
    }

    for (const l of lines) {
      if (!canOverrideMinPrice && l.minPrice > 0 && l.salePrice < l.minPrice) {
        setErrorMsg(`الصنف "${l.itemName}" مسعر بـ ${l.salePrice} ج.م وهو أقل من الحد الأدنى (${l.minPrice} ج.م)`);
        return;
      }
      if (l.quantity <= 0) {
        setErrorMsg(`الكمية للصنف "${l.itemName}" غير صالحة`);
        return;
      }
      if (l.returnedQty > 0 && l.quantity < l.returnedQty) {
        setErrorMsg(`الكمية للصنف "${l.itemName}" لا يمكن أن تقل عن المرتجع المسجل (${l.returnedQty})`);
        return;
      }
    }

    setShowConfirmation(true);
  };

  // التنفيذ النهائي للحفظ
  const handleConfirmSubmit = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    const requestId = `edit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const payload = {
        requestId,
        invoiceNumber: invoice.invoiceNumber,
        editReason: editReason.trim(),
        platformId: selectedPlatform?.id,
        platformName: selectedPlatform?.name || invoice.platform,
        customerName: customerName.trim(),
        cashboxName: canEditCashbox ? cashboxName.trim() : (invoice.cashboxName || 'الخزينة الرئيسية'),
        notes: notes.trim(),
        totalBeforeDiscount: recalculatedFinancials.totalProducts,
        bnplTotalAmount: recalculatedFinancials.totalBnpl,
        discountAmount: recalculatedFinancials.totalDiscount,
        pickupFeeAmount: recalculatedFinancials.totalPickup,
        deliveryFee: recalculatedFinancials.deliveryFee,
        taxAmount: recalculatedFinancials.totalTax,
        netAmount: recalculatedFinancials.netAmount,
        lines: recalculatedFinancials.calculatedLines.map(cl => ({
          itemId: cl.itemId,
          itemNameAtSale: cl.itemName,
          barcodeAtSale: cl.barcode,
          quantity: cl.quantity,
          salePriceAtSale: cl.salePrice,
          baseUnitPrice: cl.baseUnitPrice,
          customerUnitPrice: cl.customerUnitPrice,
          bnplPercent: cl.bnplPercent,
          bnplUnitAmount: cl.bnplUnitAmount,
          totalBnplAmount: (cl.bnplUnitAmount || 0) * cl.quantity,
          purchasePriceAtSale: cl.purchasePrice,
          packagingCostAtSale: cl.packagingCost,
          taxRateAtSale: cl.taxRate,
          unitTaxAmount: cl.unitTax,
          platformDiscountPercentAtSale: selectedPlatform?.discountPercentage || 0,
          unitDiscountValue: cl.unitDiscount,
          unitPickupFee: cl.pickupFee,
          totalPickupFee: cl.pickupFee * cl.quantity,
          unitNet: cl.unitNet,
          unitProfit: cl.unitProfit
        }))
      };

      await onSave(payload);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'فشل حفظ تعديل الفاتورة');
      setShowConfirmation(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <ModalShell
        title={`تعديل الفاتورة ${invoice.invoiceNumber}`}
        subtitle="تعديل آمن مع حفظ السجل المالي والمخزني وقيود التدقيق"
        onClose={onClose}
        closeDisabled={isSubmitting}
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] transition cursor-pointer"
            >
              إلغاء التعديل
            </button>
            <button
              type="button"
              onClick={handlePrepareSubmit}
              disabled={isSubmitting || lines.length === 0}
              className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-[#1668B2] hover:bg-[#125592] disabled:opacity-40 text-white text-xs font-bold transition cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>معاينة وتأكيد حفظ التعديل</span>
            </button>
          </>
        }
      >
        {errorMsg && (
          <div className="flex items-center gap-2 text-xs font-bold ui-stock-out">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {invoiceReturns.length > 0 && (
          <div className="border-r-2 border-amber-500 pr-3 text-xs ui-stock-low flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              هذه الفاتورة مسجل عليها مرتجعات سابقة. البنود المرتجعة محمية ولا يمكن تقليل كميتها عن الكمية المرتجعة المسجلة.
            </span>
          </div>
        )}

        {/* بيانات المنصة والعميل والخزينة */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-bold text-[var(--text-primary)] mb-1 flex items-center gap-1.5">
              <span>المنصة / العميل</span>
              {!canEditPlatform && <Lock className="w-3 h-3 text-[var(--text-secondary)]" />}
            </label>
            <select
              disabled={!canEditPlatform}
              value={platformId}
              onChange={(e) => handlePlatformChange(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold disabled:opacity-60`}
            >
              {platforms.map(plt => (
                <option key={plt.id} value={plt.id}>
                  {plt.name} (عمولة {plt.discountPercentage}%) {plt.pickupFee ? `+ ${plt.pickupFee} ج.م` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-[var(--text-primary)] mb-1 flex items-center gap-1.5">
              <span>اسم العميل / المستلم</span>
              {!canEditCustomer && <Lock className="w-3 h-3 text-[var(--text-secondary)]" />}
            </label>
            <input
              type="text"
              disabled={!canEditCustomer}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="عميل مباشر أو اسم المستلم"
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs disabled:opacity-60`}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[var(--text-primary)] mb-1 flex items-center gap-1.5">
              <span>الخزينة المالية</span>
              {!canEditCashbox && <Lock className="w-3 h-3 text-[var(--text-secondary)]" />}
            </label>
            <select
              disabled={!canEditCashbox}
              value={cashboxName}
              onChange={(e) => setCashboxName(e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold disabled:opacity-60`}
            >
              <option value="الخزينة الرئيسية">الخزينة الرئيسية (الكاش)</option>
              <option value="حساب بنكي / تحويل إلكتروني">حساب بنكي / تحويل إلكتروني</option>
              <option value="مستحقات المنصة">مستحقات المنصة المعلقة</option>
            </select>
          </div>
        </div>

        {/* إضافة صنف جديد */}
        {canEditItems && (
          <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <div>
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
                إضافة صنف للفاتورة
              </label>
              <select
                value={selectedItemToAdd}
                onChange={(e) => setSelectedItemToAdd(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-semibold`}
              >
                <option value="">-- اختر صنفاً لإضافته إلى الفاتورة --</option>
                {items.filter(it => it.status !== 'موقوف' && it.status !== 'inactive').map(it => (
                  <option key={it.id} value={it.id}>
                    {it.name} (السعر: {it.salePrice} ج.م | المخزن: {it.stockQuantity})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => handleAddItem(selectedItemToAdd)}
              disabled={!selectedItemToAdd}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125592] disabled:opacity-40 text-white text-xs font-bold transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة</span>
            </button>
          </div>
        )}

        <SectionHeading
          title={`بنود الفاتورة (${lines.length}) — ${canEditPrice ? 'الأسعار قابلة للتعديل' : 'الأسعار مقفلة'} · ${canEditQty ? 'الكميات قابلة للتعديل' : 'الكميات مقفلة'}`}
          withTopDivider
        />

        <CompactTable ariaLabel="بنود الفاتورة المعدلة">
          <thead>
            <tr>
              <th className={COMPACT_TABLE_TEXT_CLASS}>الصنف</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>الكمية</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>السعر الأساسي</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>الضريبة %</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>إجمالي السطر</th>
              {canEditItems && <th className={COMPACT_TABLE_NUM_CLASS}>حذف</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.id}>
                <td className={COMPACT_TABLE_TEXT_CLASS}>
                  <div className="font-bold">{l.itemName}</div>
                  <div className="text-[11px] text-[var(--text-secondary)] font-mono flex flex-wrap gap-x-2">
                    {l.barcode && <span>كود: {l.barcode}</span>}
                    {l.minPrice > 0 && <span>أدنى: {l.minPrice} ج.م</span>}
                    {l.pickupFee > 0 && <span>التقاط: {l.pickupFee} ج.م</span>}
                    {l.returnedQty > 0 && <span className="ui-stock-low font-sans font-bold">مرتجع سابق: {l.returnedQty}</span>}
                  </div>
                </td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <input
                    type="number"
                    min={l.returnedQty || 1}
                    disabled={!canEditQty}
                    value={l.quantity}
                    onChange={(e) => handleUpdateQuantity(idx, Number(e.target.value))}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono font-bold text-xs disabled:opacity-60`}
                  />
                </td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <input
                    type="number"
                    step="any"
                    disabled={!canEditPrice}
                    value={l.salePrice}
                    onChange={(e) => handleUpdatePrice(idx, Number(e.target.value))}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono font-bold text-xs disabled:opacity-60 ${
                      !canOverrideMinPrice && l.minPrice > 0 && l.salePrice < l.minPrice ? 'border-rose-500 ui-stock-out' : ''
                    }`}
                  />
                  {Number(l.bnplPercent || 0) > 0 && (
                    <div className="text-[11px] text-[var(--text-secondary)] font-mono mt-0.5">
                      BNPL +{l.bnplPercent}% · للعميل: {(l.customerUnitPrice || l.salePrice).toFixed(2)} ج.م
                    </div>
                  )}
                </td>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    disabled={!canEditTax}
                    value={l.taxRate}
                    onChange={(e) => handleUpdateTaxRate(idx, Number(e.target.value))}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono font-bold text-xs disabled:opacity-60`}
                  />
                </td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>
                  {(((l.customerUnitPrice || l.salePrice)) * l.quantity).toFixed(2)} ج.م
                </td>
                {canEditItems && (
                  <td className={COMPACT_TABLE_NUM_CLASS}>
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(idx)}
                      disabled={l.returnedQty > 0}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg ui-stock-out hover:bg-[var(--surface-subtle)] disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                      title={l.returnedQty > 0 ? 'لا يمكن حذف صنف به مرتجع' : 'حذف هذا السطر من الفاتورة'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </CompactTable>

        <div>
          <label className="block text-xs font-bold text-[var(--text-primary)] mb-1">
            سبب التعديل (إلزامي للتسجيل بسجل التدقيق المالي والمخزني) *
          </label>
          <textarea
            rows={2}
            required
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            placeholder="اكتب سبب تعديل الفاتورة بالتفصيل..."
            className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs`}
          />
        </div>

        <SectionHeading title="مقارنة القيم المالية (قبل وبعد التعديل)" withTopDivider />

        <CompactTable ariaLabel="ملخص المقارنة المالية">
          <thead>
            <tr>
              <th className={COMPACT_TABLE_TEXT_CLASS}>البند</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>قبل التعديل</th>
              <th className={COMPACT_TABLE_NUM_CLASS}>بعد التعديل</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={COMPACT_TABLE_TEXT_CLASS}>إجمالي المنتجات</td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                {(invoice.totalBeforeDiscount || 0).toFixed(2)} ج.م
              </td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold`}>
                {recalculatedFinancials.totalProducts.toFixed(2)} ج.م
              </td>
            </tr>
            {recalculatedFinancials.totalBnpl > 0 && (
              <tr>
                <td className={COMPACT_TABLE_TEXT_CLASS}>تقسيط المنصة (BNPL)</td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                  - {(invoice.bnplTotalAmount || 0).toFixed(2)} ج.م
                </td>
                <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-purchase`}>
                  - {recalculatedFinancials.totalBnpl.toFixed(2)} ج.م
                </td>
              </tr>
            )}
            <tr>
              <td className={COMPACT_TABLE_TEXT_CLASS}>خصم المنصة</td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                {(invoice.discountAmount || 0).toFixed(2)} ج.م
              </td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-purchase`}>
                {recalculatedFinancials.totalDiscount.toFixed(2)} ج.م
              </td>
            </tr>
            <tr>
              <td className={COMPACT_TABLE_TEXT_CLASS}>رسوم الالتقاط</td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                {(invoice.pickupFeeAmount || 0).toFixed(2)} ج.م
              </td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-stock-low`}>
                {recalculatedFinancials.totalPickup.toFixed(2)} ج.م
              </td>
            </tr>
            <tr>
              <td className={`${COMPACT_TABLE_TEXT_CLASS} font-bold`}>صافي الاستلام</td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono text-[var(--text-secondary)]`}>
                {(invoice.netAmount || 0).toFixed(2)} ج.م
              </td>
              <td className={`${COMPACT_TABLE_NUM_CLASS} font-mono font-bold ui-money-sale`}>
                {recalculatedFinancials.netAmount.toFixed(2)} ج.م
              </td>
            </tr>
          </tbody>
        </CompactTable>
      </ModalShell>

      {showConfirmation && (
        <ModalShell
          title="تأكيد تعديل الفاتورة المحفوظة"
          subtitle="سيتم تسجيل حركات مخزنية ومالية عكسية وجديدة"
          onClose={() => setShowConfirmation(false)}
          closeDisabled={isSubmitting}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowConfirmation(false)}
                disabled={isSubmitting}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
              >
                تراجع
              </button>
              <button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={isSubmitting}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-5 rounded-lg bg-[#1668B2] hover:bg-[#125592] disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
              >
                {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>تأكيد الحفظ النهائي</span>
              </button>
            </>
          }
        >
          <div className="space-y-2 text-xs">
            <div className="flex justify-between gap-6">
              <span className="text-[var(--text-secondary)]">رقم الفاتورة:</span>
              <strong className="font-mono">{invoice.invoiceNumber}</strong>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-[var(--text-secondary)]">الصافي القديم:</span>
              <span className="font-mono">{invoice.netAmount?.toFixed(2)} ج.م</span>
            </div>
            <div className="flex justify-between gap-6 font-bold ui-money-sale">
              <span>الصافي الجديد بعد التعديل:</span>
              <span className="font-mono">{recalculatedFinancials.netAmount.toFixed(2)} ج.م</span>
            </div>
            <div className="pt-2 border-t border-[var(--border-subtle)]">
              <span className="text-[var(--text-secondary)] block">سبب التعديل:</span>
              <p className="font-semibold mt-0.5">{editReason}</p>
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
};

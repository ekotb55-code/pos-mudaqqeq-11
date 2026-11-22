import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Invoice, CompanySettings, InvoicePrintSettings, Customer, Item } from '../types';

export interface ReceiptPrintAreaProps {
  invoice: Invoice;
  companySettings?: CompanySettings;
  invoicePrintSettings?: InvoicePrintSettings;
  storeName?: string;
  isReprint?: boolean;
  className?: string;
  onLogoLoad?: () => void;
  customers?: Customer[];
  items?: Item[];
  changeGiven?: number;
  customerBalanceAfter?: number;
}

/**
 * تحديد النص المطبوع لسطر الصنف في إيصال/فاتورة العميل بحسب إعداد «الاسم المطبوع للعميل»:
 * عند اختيار 'printName':
 * 1) itemPrintNameAtSale المحفوظ في الفاتورة إن كان موجوداً وغير فارغ
 * 2) وإلا اسم الطباعة الحالي للصنف من الكتالوج (items) إن كان غير فارغ
 * 3) وإلا اسم الصنف (itemNameAtSale / name)
 */
export function resolvePrintedItemName(
  line: any,
  printedItemLabel?: 'name' | 'printName',
  catalogItems?: Item[]
): string {
  const fallbackName =
    String(line?.itemNameAtSale || line?.productName || line?.name || 'صنف').trim() || 'صنف';
  if (printedItemLabel !== 'printName') {
    return fallbackName;
  }
  const snapPrintName =
    line?.itemPrintNameAtSale !== undefined && line?.itemPrintNameAtSale !== null
      ? String(line.itemPrintNameAtSale).trim()
      : '';
  if (snapPrintName) {
    return snapPrintName;
  }
  const targetId = line?.itemId || line?.productId;
  const catalogItem =
    targetId && Array.isArray(catalogItems)
      ? catalogItems.find((it) => it.id === targetId)
      : undefined;
  const currentPrintName = catalogItem?.printName ? String(catalogItem.printName).trim() : '';
  if (currentPrintName) {
    return currentPrintName;
  }
  return (
    String(
      line?.itemNameAtSale || catalogItem?.name || line?.productName || line?.name || 'صنف'
    ).trim() || 'صنف'
  );
}

/**
 * تنسيق المبالغ المالية: أرقام إنجليزية برقمين عشريين مع فاصل الآلاف دائماً
 */
export function formatMoney(amount: number | undefined | null): string {
  const val = Number(amount) || 0;
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * تنسيق الكميات: أرقام إنجليزية بدون كسور إن كانت صحيحة، أو برقمين عشريين
 */
export function formatQty(qty: number | undefined | null): string {
  const val = Number(qty) || 0;
  return Number.isInteger(val)
    ? val.toLocaleString('en-US')
    : val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * تنسيق التاريخ والوقت بصيغة YYYY-MM-DD hh:mm ص/م بأرقام إنجليزية
 */
export function formatInvoiceDate(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(d.getTime())) return dateStr || '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'م' : 'ص';
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${minutes} ${period}`;
}

export const ReceiptPrintArea: React.FC<ReceiptPrintAreaProps> = ({
  invoice,
  companySettings,
  invoicePrintSettings,
  storeName = 'مدقق للنظم',
  isReprint = false,
  className = '',
  onLogoLoad,
  customers = [],
  items = [],
  changeGiven,
  customerBalanceAfter
}) => {
  const lines = invoice.lines || (invoice as any).items || [];
  const totalBefore = invoice.totalBeforeDiscount ?? (invoice as any).totalAmount ?? 0;
  const discount = invoice.discountAmount ?? (invoice as any).discount ?? 0;
  const pickupFee = invoice.pickupFeeAmount ?? 0;
  const deliveryFee = invoice.deliveryFee ?? 0;
  const bnplAmount = invoice.bnplTotalAmount ?? lines.reduce((sum: number, l: any) => sum + ((Number(l.bnplUnitAmount) || 0) * (Number(l.quantity) || 1)), 0);
  const net = invoice.netAmount ?? (totalBefore - bnplAmount - discount - pickupFee + deliveryFee);
  const taxAmount = invoice.taxAmount ?? 0;

  const totalPieces = lines.reduce((sum: number, l: any) => sum + (Number(l.quantity) || 1), 0);

  const fallbackConf: InvoicePrintSettings = {
    paperSize: '80mm',
    printableWidthMm: 72,
    showReceiptPreview: false,
    showInvoiceNumber: true,
    showDateTime: true,
    showInvoiceStatus: true,
    showLogo: true,
    showCompanyName: true,
    showTagline: true,
    showTaxNumber: true,
    showCommercialRecord: true,
    showAddress: true,
    showPhone: true,
    showCustomerInfo: true,
    showPlatform: true,
    showDiscounts: true,
    showBarcode: true,
    showNotes: true,
    autoFillCashPaid: true,
    headerText: '',
    footerText: 'شكراً لتعاملكم معنا • جميع المنتجات مدققة ومطابقة لمعايير المنصات',
    termsAndConditions: 'البضاعة المباعة يمكن إرجاعها خلال 14 يومًا بحالتها الأصلية.',
    returnPolicyText: '',
    showHeaderImage: false,
    headerImageUrl: '',
    showCustomerName: true,
    showCustomerPhone: true,
    showCustomerAddress: true,
    showCustomerBalance: false,
    showPaymentDetails: true,
    showItemsCount: true,
    showCashier: true,
    printedItemLabel: 'name'
  };

  const rawConf = invoicePrintSettings ?? fallbackConf;
  const rawHeaderText = rawConf.headerText ?? fallbackConf.headerText ?? '';
  const cleanHeaderText = rawHeaderText === 'فاتورة مبيعات مدققة وموثقة على المنصة' ? '' : rawHeaderText;

  const printConf: InvoicePrintSettings = {
    ...fallbackConf,
    ...rawConf,
    headerText: cleanHeaderText,
    footerText: rawConf.footerText ?? fallbackConf.footerText ?? '',
    termsAndConditions: rawConf.termsAndConditions ?? fallbackConf.termsAndConditions ?? '',
    returnPolicyText: rawConf.returnPolicyText ?? fallbackConf.returnPolicyText ?? '',
    showReceiptPreview: rawConf.showReceiptPreview ?? fallbackConf.showReceiptPreview ?? false,
    printableWidthMm: rawConf.printableWidthMm ?? (rawConf.paperSize === '58mm' ? 48 : 72),
    showInvoiceNumber: rawConf.showInvoiceNumber ?? true,
    showDateTime: rawConf.showDateTime ?? true,
    showInvoiceStatus: rawConf.showInvoiceStatus ?? true,
    printedItemLabel: rawConf.printedItemLabel === 'printName' ? 'printName' : 'name',
  };

  const isSmallPaper = printConf.paperSize === '58mm';
  const tableFontSize = isSmallPaper ? '10.5px' : '11.5px';

  const storeTitle = companySettings?.storeName || storeName;

  // فحص وجود عميل فعلي (غير «الجمهور»)
  const rawCustomerName = (invoice.customerName || '').trim();
  const hasActualCustomer = Boolean(
    (invoice.customerId && invoice.customerId !== 'walkin' && invoice.customerId !== 'default') ||
    (rawCustomerName && rawCustomerName !== 'الجمهور')
  );

  // جلب بيانات العميل من القائمة بـ customerId إن وجد
  const matchedCustomer = invoice.customerId
    ? customers.find((c) => c.id === invoice.customerId)
    : undefined;

  const customerDisplayName = matchedCustomer?.name || rawCustomerName;
  const customerPhone = matchedCustomer?.phone || matchedCustomer?.phoneSecondary;
  const customerAddress = matchedCustomer?.address;

  // حساب بيانات الدفع
  const isCreditInvoice = invoice.paymentType === 'آجل' || invoice.status === 'معلّقة' || Boolean(invoice.creditStatus);
  const paymentType = isCreditInvoice ? 'آجل' : (invoice.paymentType || 'نقدي');
  const creditDue = invoice.creditDueAmount !== undefined
    ? invoice.creditDueAmount
    : (invoice.creditPartyType === 'customer' ? (totalBefore + deliveryFee) : net);

  const displayPaidAmount = invoice.paidAmount !== undefined
    ? invoice.paidAmount
    : paymentType === 'آجل'
    ? 0
    : net;

  const displayChangeToCustomer = changeGiven !== undefined
    ? changeGiven
    : displayPaidAmount > net
    ? displayPaidAmount - net
    : 0;

  const displayRemainingCredit = paymentType === 'آجل'
    ? (invoice.remainingAmount !== undefined ? invoice.remainingAmount : creditDue)
    : invoice.remainingAmount !== undefined
    ? invoice.remainingAmount
    : paymentType === 'جزئي'
    ? Math.max(0, net - displayPaidAmount)
    : 0;

  // رصيد العميل بعد الفاتورة
  const customerBalanceDisplay = customerBalanceAfter !== undefined
    ? customerBalanceAfter
    : matchedCustomer?.currentBalance;

  const sectionStyle: React.CSSProperties = {
    breakInside: 'avoid',
    pageBreakInside: 'avoid',
    boxSizing: 'border-box'
  };

  return (
    <div
      className={`receipt-print-area p-3 sm:p-4 text-black bg-white font-sans text-[12px] leading-snug max-w-full ${className}`}
      dir="rtl"
      style={{
        color: '#000000',
        backgroundColor: '#ffffff',
        boxSizing: 'border-box',
        breakInside: 'avoid',
        pageBreakInside: 'avoid'
      }}
    >
      {/* 1. صورة الهيدر (تظهر أول حاجة في الإيصال لو مفعلة ولها رابط) */}
      {printConf.showHeaderImage && printConf.headerImageUrl && (
        <div className="w-full text-center pb-2 max-w-full overflow-hidden" style={sectionStyle}>
          <img
            src={printConf.headerImageUrl}
            alt="Header"
            className="w-full max-w-full max-h-[30mm] object-contain mx-auto"
            style={{ maxHeight: '30mm', width: '100%', maxWidth: '100%', objectFit: 'contain' }}
          />
        </div>
      )}

      {/* 2. الشعار واسم الشركة والبيانات التجارية */}
      <div className="text-center pb-2.5 border-b border-black space-y-1 max-w-full" style={sectionStyle}>
        {printConf.showLogo && companySettings?.logoUrl && (
          <img
            src={companySettings.logoUrl}
            alt="Logo"
            onLoad={onLogoLoad}
            className="w-14 h-14 max-w-full mx-auto object-contain mb-1"
          />
        )}

        {printConf.showCompanyName && (
          <h2 className="text-[14px] font-bold tracking-wide text-black">
            {storeTitle}
          </h2>
        )}

        {/* تنبيه نسخة مكررة في إعادة الطباعة */}
        {isReprint && (
          <div className="inline-block my-1 px-3 py-0.5 border border-black rounded text-[11px] font-bold text-black bg-transparent">
            *** نسخة مكررة ***
          </div>
        )}

        {printConf.showTagline && companySettings?.brandTagline && (
          <p className="text-[11px] text-black">{companySettings.brandTagline}</p>
        )}

        {printConf.showTaxNumber && companySettings?.taxNumber && (
          <p className="text-[11px] text-black">رقم التسجيل الضريبي: {companySettings.taxNumber}</p>
        )}

        {printConf.showCommercialRecord && companySettings?.commercialRecord && (
          <p className="text-[11px] text-black">س.ت: {companySettings.commercialRecord}</p>
        )}

        {printConf.showAddress && companySettings?.address && (
          <p className="text-[11px] text-black">العنوان: {companySettings.address}</p>
        )}

        {printConf.showPhone && companySettings?.phone && (
          <p className="text-[11px] text-black">هاتف: {companySettings.phone}</p>
        )}
      </div>

      {/* 3. بيانات الفاتورة (العنوان تليه القيمة مباشرة مع gap: 0.75em بدون justify-between) */}
      <div className="py-2 text-[11px] space-y-1 border-b border-black text-black max-w-full" style={sectionStyle}>
        {(invoice.isOffline || invoice.offlinePending || String(invoice.invoiceNumber || '').startsWith('OFF-')) && (
          <div className="py-1 px-2 mb-1 border border-black rounded text-center font-extrabold text-[11px] text-black bg-transparent">
            فاتورة مسجلة بدون إنترنت
          </div>
        )}
        {(printConf.showInvoiceNumber !== false || invoice.isOffline || invoice.offlinePending || String(invoice.invoiceNumber || '').startsWith('OFF-')) && (
          <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
            <span className="shrink-0 font-medium">رقم الفاتورة:</span>
            <span
              className="font-bold text-black text-[12px] tabular-nums"
              dir="ltr"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {invoice.invoiceNumber}
            </span>
          </div>
        )}
        {printConf.showDateTime !== false && (
          <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
            <span className="shrink-0 font-medium">التاريخ والوقت:</span>
            <span
              className="text-black tabular-nums"
              dir="ltr"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatInvoiceDate(invoice.date)}
            </span>
          </div>
        )}
        {printConf.showCashier !== false && (
          <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
            <span className="shrink-0 font-medium">الكاشير:</span>
            <span className="font-semibold text-black">
              {invoice.cashierName || invoice.createdBy || 'كاشير'}
            </span>
          </div>
        )}
        {printConf.showPlatform !== false && (
          <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
            <span className="shrink-0 font-medium">المنصة:</span>
            <span className="font-bold text-black">
              {invoice.platform || (invoice as any).platformName || 'مبيعات مباشرة'}
            </span>
          </div>
        )}
        {invoice.warehouseName && (
          <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
            <span className="shrink-0 font-medium">المخزن:</span>
            <span className="font-bold text-black">
              {invoice.warehouseName}
            </span>
          </div>
        )}
        {printConf.showInvoiceStatus !== false && (
          <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
            <span className="shrink-0 font-medium">حالة الفاتورة:</span>
            <span className="font-bold text-black">{invoice.status || 'تم البيع'}</span>
          </div>
        )}
      </div>

      {/* 4. بيانات العميل (العنوان تليه القيمة مباشرة مع gap: 0.75em بدون justify-between) */}
      {hasActualCustomer && (
        <div className="py-2 text-[11px] space-y-1 border-b border-black text-black max-w-full" style={sectionStyle}>
          {printConf.showCustomerName !== false && customerDisplayName && (
            <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
              <span className="shrink-0 font-medium">العميل:</span>
              <span className="font-bold text-black">{customerDisplayName}</span>
            </div>
          )}
          {printConf.showCustomerPhone !== false && customerPhone && (
            <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
              <span className="shrink-0 font-medium">الموبايل:</span>
              <span
                className="text-black tabular-nums"
                dir="ltr"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {customerPhone}
              </span>
            </div>
          )}
          {printConf.showCustomerAddress !== false && customerAddress && (
            <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
              <span className="shrink-0 font-medium">العنوان:</span>
              <span className="text-black">{customerAddress}</span>
            </div>
          )}
        </div>
      )}

      {/* 5. جدول الأصناف متجاوب ومُوسّط بالكامل (العناوين والقيم) بإطار 1px حول كل خلية */}
      <div className="py-2 w-full max-w-full overflow-hidden" style={sectionStyle}>
        <table
          className="receipt-table w-full text-black"
          style={{
            tableLayout: 'auto',
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: tableFontSize,
            breakInside: 'avoid',
            pageBreakInside: 'avoid'
          }}
        >
          <thead>
            <tr className="bg-transparent text-black" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <th
                style={{
                  minWidth: '35%',
                  textAlign: 'center',
                  verticalAlign: 'middle',
                  padding: '3px 4px',
                  border: '1px solid #000',
                  lineHeight: 1.2,
                  whiteSpace: 'normal',
                  fontWeight: 'bold',
                  breakInside: 'avoid',
                  pageBreakInside: 'avoid'
                }}
              >
                الصنف
              </th>
              <th
                style={{
                  width: '1%',
                  textAlign: 'center',
                  verticalAlign: 'middle',
                  padding: '3px 4px',
                  border: '1px solid #000',
                  lineHeight: 1.2,
                  whiteSpace: 'normal',
                  fontWeight: 'bold',
                  breakInside: 'avoid',
                  pageBreakInside: 'avoid'
                }}
              >
                الكمية
              </th>
              <th
                style={{
                  width: '1%',
                  textAlign: 'center',
                  verticalAlign: 'middle',
                  padding: '3px 4px',
                  border: '1px solid #000',
                  lineHeight: 1.2,
                  whiteSpace: 'normal',
                  fontWeight: 'bold',
                  breakInside: 'avoid',
                  pageBreakInside: 'avoid'
                }}
              >
                سعر القطعة
              </th>
              <th
                style={{
                  width: '1%',
                  textAlign: 'center',
                  verticalAlign: 'middle',
                  padding: '3px 4px',
                  border: '1px solid #000',
                  lineHeight: 1.2,
                  whiteSpace: 'normal',
                  fontWeight: 'bold',
                  breakInside: 'avoid',
                  pageBreakInside: 'avoid'
                }}
              >
                الإجمالي
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line: any, idx: number) => {
              const name = resolvePrintedItemName(line, printConf.printedItemLabel, items);
              const price = Number(line.customerUnitPrice ?? (line.salePriceAtSale !== undefined && line.bnplUnitAmount ? line.salePriceAtSale + line.bnplUnitAmount : (line.salePriceAtSale ?? line.unitPrice ?? 0)));
              const qty = Number(line.quantity ?? 1);
              const lineTotal = price * qty;

              return (
                <tr key={idx} className="border-b border-black" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                  <td
                    style={{
                      minWidth: '35%',
                      textAlign: 'center',
                      verticalAlign: 'middle',
                      padding: '3px 4px',
                      border: '1px solid #000',
                      whiteSpace: 'normal',
                      wordBreak: 'break-word',
                      breakInside: 'avoid',
                      pageBreakInside: 'avoid'
                    }}
                  >
                    <div
                      className="font-bold text-black"
                      style={{
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        lineHeight: 1.25,
                        textAlign: 'center'
                      }}
                    >
                      {name}
                      {Boolean(line.bnplPercent && line.bnplPercent > 0) && (
                        <div className="text-[10px] font-normal text-black" style={{ fontSize: '9px' }}>
                          (تقسيط BNPL +{line.bnplPercent}%)
                        </div>
                      )}
                    </div>
                  </td>
                  <td
                    style={{
                      width: '1%',
                      whiteSpace: 'nowrap',
                      textAlign: 'center',
                      verticalAlign: 'middle',
                      padding: '3px 4px',
                      border: '1px solid #000',
                      fontWeight: 600,
                      breakInside: 'avoid',
                      pageBreakInside: 'avoid'
                    }}
                  >
                    <span
                      dir="ltr"
                      style={{ fontVariantNumeric: 'tabular-nums', display: 'inline-block' }}
                    >
                      {formatQty(qty)}
                    </span>
                  </td>
                  <td
                    style={{
                      width: '1%',
                      whiteSpace: 'nowrap',
                      textAlign: 'center',
                      verticalAlign: 'middle',
                      padding: '3px 4px',
                      border: '1px solid #000',
                      breakInside: 'avoid',
                      pageBreakInside: 'avoid'
                    }}
                  >
                    <span
                      dir="ltr"
                      style={{ fontVariantNumeric: 'tabular-nums', display: 'inline-block' }}
                    >
                      {formatMoney(price)}
                    </span>
                  </td>
                  <td
                    style={{
                      width: '1%',
                      whiteSpace: 'nowrap',
                      textAlign: 'center',
                      verticalAlign: 'middle',
                      padding: '3px 4px',
                      border: '1px solid #000',
                      fontWeight: 'bold',
                      breakInside: 'avoid',
                      pageBreakInside: 'avoid'
                    }}
                  >
                    <span
                      dir="ltr"
                      style={{ fontVariantNumeric: 'tabular-nums', display: 'inline-block' }}
                    >
                      {formatMoney(lineTotal)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 6. عدد الأصناف وعدد القطع */}
      {printConf.showItemsCount !== false && (
        <div className="flex justify-between items-center py-1.5 border-b border-black text-[11px] text-black font-bold max-w-full" style={sectionStyle}>
          <span>
            عدد الأصناف: <span className="tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>{lines.length}</span>
          </span>
          <span>
            عدد القطع: <span className="tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatQty(totalPieces)}</span>
          </span>
        </div>
      )}

      {/* 7. ملخص المنصة والمجاميع (العنوان يمين والمبلغ شمال في سطر واحد) */}
      <div className="py-2 space-y-1 text-[11px] text-black border-b border-black max-w-full" style={sectionStyle}>
        <div className="flex justify-between items-center py-0.5 gap-2">
          <span className="text-right">المجموع قبل الخصم:</span>
          <span
            className="whitespace-nowrap text-left shrink-0 tabular-nums font-semibold"
            dir="ltr"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {formatMoney(totalBefore)} ج.م
          </span>
        </div>

        {bnplAmount > 0 && (
          <div className="flex justify-between items-center py-0.5 gap-2">
            <span className="text-right">تقسيط المنصة (BNPL):</span>
            <span
              className="whitespace-nowrap text-left shrink-0 tabular-nums font-medium"
              dir="ltr"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              - {formatMoney(bnplAmount)} ج.م
            </span>
          </div>
        )}

        {printConf.showDiscounts && discount > 0 && (
          <div className="flex justify-between items-center py-0.5 gap-2">
            <span className="text-right">خصم المنصة:</span>
            <span
              className="whitespace-nowrap text-left shrink-0 tabular-nums font-medium"
              dir="ltr"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              - {formatMoney(discount)} ج.م
            </span>
          </div>
        )}

        {pickupFee > 0 && (
          <div className="flex justify-between items-center py-0.5 gap-2">
            <span className="text-right">رسوم الالتقاط للمنصة:</span>
            <span
              className="whitespace-nowrap text-left shrink-0 tabular-nums font-medium"
              dir="ltr"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              - {formatMoney(pickupFee)} ج.م
            </span>
          </div>
        )}

        {deliveryFee > 0 && (
          <div className="flex justify-between items-center py-0.5 gap-2 font-medium">
            <span className="text-right">رسوم التوصيل:</span>
            <span
              className="whitespace-nowrap text-left shrink-0 tabular-nums font-bold"
              dir="ltr"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              + {formatMoney(deliveryFee)} ج.م
            </span>
          </div>
        )}

        {taxAmount > 0 && (
          <div className="flex justify-between items-center py-0.5 gap-2 font-medium">
            <span className="text-right">ضريبة القيمة المضافة (VAT):</span>
            <span
              className="whitespace-nowrap text-left shrink-0 tabular-nums font-bold"
              dir="ltr"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatMoney(taxAmount)} ج.م
            </span>
          </div>
        )}

        <div className="flex justify-between items-center text-[15px] sm:text-[16px] font-extrabold text-black pt-1.5 border-t border-black gap-2">
          <span className="text-right">الصافي الإجمالي:</span>
          <span
            className="whitespace-nowrap text-left shrink-0 tabular-nums font-extrabold"
            dir="ltr"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {formatMoney(net)} ج.م
          </span>
        </div>
      </div>

      {/* 8. بيانات الدفع (العنوان يمين والمبلغ شمال في سطر واحد) */}
      {printConf.showPaymentDetails !== false && (
        <div className="py-2 space-y-1 text-[11px] text-black border-b border-black max-w-full" style={sectionStyle}>
          <div className="flex justify-between items-center py-0.5 gap-2">
            <span className="text-right">طريقة الدفع:</span>
            <span className="font-bold text-left">{paymentType}</span>
          </div>
          <div className="flex justify-between items-center py-0.5 gap-2">
            <span className="text-right">المطلوب:</span>
            <span
              className="whitespace-nowrap text-left shrink-0 tabular-nums font-bold"
              dir="ltr"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatMoney(net)} ج.م
            </span>
          </div>
          <div className="flex justify-between items-center py-0.5 gap-2">
            <span className="text-right">المدفوع:</span>
            <span
              className="whitespace-nowrap text-left shrink-0 tabular-nums font-bold"
              dir="ltr"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatMoney(displayPaidAmount)} ج.م
            </span>
          </div>
          {!isReprint && displayChangeToCustomer > 0 && (
            <div className="flex justify-between items-center py-0.5 gap-2 font-bold">
              <span className="text-right">الباقي للعميل:</span>
              <span
                className="whitespace-nowrap text-left shrink-0 tabular-nums"
                dir="ltr"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatMoney(displayChangeToCustomer)} ج.م
              </span>
            </div>
          )}
          {displayRemainingCredit > 0 && (paymentType === 'آجل' || paymentType === 'جزئي') && (
            <div className="flex justify-between items-center py-0.5 gap-2 font-bold">
              <span className="text-right">المتبقي آجل:</span>
              <span
                className="whitespace-nowrap text-left shrink-0 tabular-nums"
                dir="ltr"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatMoney(displayRemainingCredit)} ج.م
              </span>
            </div>
          )}
          {invoice.cashboxName && (
            <div className="flex justify-between items-center py-0.5 gap-2">
              <span className="text-right">الخزنة:</span>
              <span className="text-left">{invoice.cashboxName}</span>
            </div>
          )}
        </div>
      )}

      {/* 9. رصيد العميل بعد الفاتورة */}
      {!isReprint && printConf.showCustomerBalance && hasActualCustomer && customerBalanceDisplay !== undefined && (
        <div className="py-1.5 border-b border-black text-[11px] flex justify-between items-center font-bold text-black gap-2 max-w-full" style={sectionStyle}>
          <span className="text-right">رصيد العميل بعد الفاتورة:</span>
          <span
            className="whitespace-nowrap text-left shrink-0 tabular-nums"
            dir="ltr"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {formatMoney(customerBalanceDisplay)} ج.م
          </span>
        </div>
      )}

      {/* 10. الملاحظات ورقم طلب المنصة */}
      {printConf.showNotes && (invoice.notes || (invoice as any).platformOrderId) && (
        <div className="py-1.5 border-b border-black text-[11px] text-black space-y-0.5 max-w-full" style={sectionStyle}>
          {(invoice as any).platformOrderId && (
            <div>
              <span className="font-bold">رقم طلب المنصة:</span>{' '}
              <span className="tabular-nums" dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {(invoice as any).platformOrderId}
              </span>
            </div>
          )}
          {invoice.notes && (
            <div>
              <span className="font-bold">ملاحظات:</span>{' '}
              <span>{invoice.notes}</span>
            </div>
          )}
        </div>
      )}

      {/* 11. QR رقم الفاتورة (مربوط فقط بإعداد showBarcode والـ QR لا يتعدى 30mm) */}
      {printConf.showBarcode && (
        <div className="flex flex-col items-center justify-center pt-2.5 pb-1 space-y-1 text-center max-w-full" style={sectionStyle}>
          <div className="p-1 bg-white inline-block max-w-[30mm] max-h-[30mm]">
            <QRCodeSVG
              value={invoice.invoiceNumber || 'INV'}
              size={80}
              style={{ width: '100%', maxWidth: '30mm', height: 'auto', maxHeight: '30mm' }}
              level="M"
            />
          </div>
          <p
            className="text-[12px] font-bold text-black tabular-nums tracking-wider"
            dir="ltr"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {invoice.invoiceNumber}
          </p>
        </div>
      )}

      {/* 12. نصوص التذييل والشروط (لو أي نص فاضي لا يُرسم أي عنصر له) */}
      <div className="pt-2 text-center space-y-1 text-black max-w-full" style={sectionStyle}>
        {printConf.headerText && printConf.headerText.trim() !== '' && (
          <p className="text-[10px] text-black leading-tight">
            {printConf.headerText.trim()}
          </p>
        )}

        {printConf.footerText && printConf.footerText.trim() !== '' && (
          <p className="text-[10px] text-black font-medium leading-tight">
            {printConf.footerText.trim()}
          </p>
        )}

        {printConf.termsAndConditions && printConf.termsAndConditions.trim() !== '' && (
          <p className="text-[9px] text-black leading-tight">
            {printConf.termsAndConditions.trim()}
          </p>
        )}

        {printConf.returnPolicyText && printConf.returnPolicyText.trim() !== '' && (
          <p className="text-[9px] text-black leading-tight">
            {printConf.returnPolicyText.trim()}
          </p>
        )}
      </div>
    </div>
  );
};

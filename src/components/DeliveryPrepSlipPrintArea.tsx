import React from 'react';
import { DeliveryPrepSlipSettings } from '../types';

export interface DeliveryPrepSlipItem {
  id?: string;
  name: string;
  quantity: number;
}

export interface DeliveryPrepSlipData {
  prepNumber?: string;
  /** رقم الفاتورة: لا يُعرض إلا إذا كانت الفاتورة قد صدرت فعلاً (قيمة غير فارغة) وكان المفتاح مفعلاً */
  invoiceNumber?: string;
  customerName?: string;
  customerPhone?: string;
  items: DeliveryPrepSlipItem[];
}

export interface DeliveryPrepSlipPrintAreaProps {
  data: DeliveryPrepSlipData;
  settings?: Partial<DeliveryPrepSlipSettings>;
  paperSize?: '58mm' | '80mm' | 'a4' | 'custom' | string;
  className?: string;
}

export const DEFAULT_DELIVERY_PREP_SLIP_SETTINGS: DeliveryPrepSlipSettings = {
  enabled: true,
  showPrepNumber: true,
  showInvoiceNumber: false,
  showCustomerName: true,
  showCustomerPhone: true,
  showItemNames: true,
  showItemQuantities: true
};

export function normalizeDeliveryPrepSlipSettings(
  raw?: Partial<DeliveryPrepSlipSettings> | null
): DeliveryPrepSlipSettings {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_DELIVERY_PREP_SLIP_SETTINGS.enabled,
    showPrepNumber:
      typeof s.showPrepNumber === 'boolean'
        ? s.showPrepNumber
        : DEFAULT_DELIVERY_PREP_SLIP_SETTINGS.showPrepNumber,
    showInvoiceNumber:
      typeof s.showInvoiceNumber === 'boolean'
        ? s.showInvoiceNumber
        : DEFAULT_DELIVERY_PREP_SLIP_SETTINGS.showInvoiceNumber,
    showCustomerName:
      typeof s.showCustomerName === 'boolean'
        ? s.showCustomerName
        : DEFAULT_DELIVERY_PREP_SLIP_SETTINGS.showCustomerName,
    showCustomerPhone:
      typeof s.showCustomerPhone === 'boolean'
        ? s.showCustomerPhone
        : DEFAULT_DELIVERY_PREP_SLIP_SETTINGS.showCustomerPhone,
    showItemNames:
      typeof s.showItemNames === 'boolean'
        ? s.showItemNames
        : DEFAULT_DELIVERY_PREP_SLIP_SETTINGS.showItemNames,
    showItemQuantities:
      typeof s.showItemQuantities === 'boolean'
        ? s.showItemQuantities
        : DEFAULT_DELIVERY_PREP_SLIP_SETTINGS.showItemQuantities
  };
}

function formatPrepQty(qty: number | undefined | null): string {
  const val = Number(qty) || 0;
  return Number.isInteger(val)
    ? val.toLocaleString('en-US')
    : val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * قالب طباعة مستقل لورقة تجهيز طلب التوصيل (مرجع تجهيز فقط — ليس فاتورة بيع).
 * لا يعرض الأسعار أو الإجماليات أو طريقة الدفع.
 */
export const DeliveryPrepSlipPrintArea: React.FC<DeliveryPrepSlipPrintAreaProps> = ({
  data,
  settings,
  paperSize = '80mm',
  className = ''
}) => {
  const conf = normalizeDeliveryPrepSlipSettings(settings);
  const isSmallPaper = paperSize === '58mm';
  const tableFontSize = isSmallPaper ? '10.5px' : '11.5px';

  const prepNumber = String(data.prepNumber ?? '').trim();
  const issuedInvoiceNumber = String(data.invoiceNumber ?? '').trim();
  const customerName = String(data.customerName ?? '').trim();
  const customerPhone = String(data.customerPhone ?? '').trim();
  const items = Array.isArray(data.items) ? data.items : [];

  const showPrepNumberRow = conf.showPrepNumber && Boolean(prepNumber);
  // رقم الفاتورة يظهر فقط إذا كان المفتاح مفعلاً وكانت الفاتورة قد صدرت فعلاً
  const showInvoiceNumberRow = conf.showInvoiceNumber && Boolean(issuedInvoiceNumber);
  const showCustomerNameRow = conf.showCustomerName && Boolean(customerName);
  const showCustomerPhoneRow = conf.showCustomerPhone && Boolean(customerPhone);

  const hasMetaRows = showPrepNumberRow || showInvoiceNumberRow;
  const hasCustomerRows = showCustomerNameRow || showCustomerPhoneRow;
  const showItemsTable = (conf.showItemNames || conf.showItemQuantities) && items.length > 0;

  const sectionStyle: React.CSSProperties = {
    breakInside: 'avoid',
    pageBreakInside: 'avoid',
    boxSizing: 'border-box'
  };

  return (
    <div
      className={`receipt-print-area delivery-prep-slip-print-area p-3 sm:p-4 text-black bg-white font-sans text-[12px] leading-snug max-w-full ${className}`}
      dir="rtl"
      data-prep-slip="true"
      style={{
        color: '#000000',
        backgroundColor: '#ffffff',
        boxSizing: 'border-box',
        breakInside: 'avoid',
        pageBreakInside: 'avoid'
      }}
    >
      {/* 1. عنوان الورقة الواضح */}
      <div className="text-center pb-2.5 border-b border-black space-y-1 max-w-full" style={sectionStyle}>
        <h2 className="text-[13px] font-extrabold tracking-wide text-black">
          نموذج تجهيز طلب — ليس فاتورة بيع
        </h2>
      </div>

      {/* 2. أرقام المرجع (رقم طلب التحضير / رقم الفاتورة إن صدرت) */}
      {hasMetaRows && (
        <div className="py-2 text-[11px] space-y-1 border-b border-black text-black max-w-full" style={sectionStyle}>
          {showPrepNumberRow && (
            <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
              <span className="shrink-0 font-medium">رقم طلب التحضير:</span>
              <span
                className="font-bold text-black text-[12px] tabular-nums"
                dir="ltr"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {prepNumber}
              </span>
            </div>
          )}

          {showInvoiceNumberRow && (
            <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
              <span className="shrink-0 font-medium">رقم الفاتورة:</span>
              <span
                className="font-bold text-black text-[12px] tabular-nums"
                dir="ltr"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {issuedInvoiceNumber}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 3. بيانات العميل (الاسم / الهاتف) */}
      {hasCustomerRows && (
        <div className="py-2 text-[11px] space-y-1 border-b border-black text-black max-w-full" style={sectionStyle}>
          {showCustomerNameRow && (
            <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
              <span className="shrink-0 font-medium">اسم العميل:</span>
              <span className="font-bold text-black">{customerName}</span>
            </div>
          )}

          {showCustomerPhoneRow && (
            <div className="flex justify-start items-baseline py-0.5 flex-wrap" style={{ gap: '0.75em' }}>
              <span className="shrink-0 font-medium">هاتف العميل:</span>
              <span
                className="font-bold text-black tabular-nums"
                dir="ltr"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {customerPhone}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 4. جدول الأصناف المطلوب تجهيزها */}
      {showItemsTable && (
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
                {conf.showItemNames && (
                  <th
                    style={{
                      textAlign: 'right',
                      verticalAlign: 'middle',
                      padding: '4px 6px',
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
                )}
                {conf.showItemQuantities && (
                  <th
                    style={{
                      width: conf.showItemNames ? '24%' : '100%',
                      textAlign: 'center',
                      verticalAlign: 'middle',
                      padding: '4px 6px',
                      border: '1px solid #000',
                      lineHeight: 1.2,
                      whiteSpace: 'nowrap',
                      fontWeight: 'bold',
                      breakInside: 'avoid',
                      pageBreakInside: 'avoid'
                    }}
                  >
                    الكمية
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr
                  key={item.id || `${item.name}-${idx}`}
                  style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
                >
                  {conf.showItemNames && (
                    <td
                      style={{
                        textAlign: 'right',
                        verticalAlign: 'middle',
                        padding: '4px 6px',
                        border: '1px solid #000',
                        lineHeight: 1.3,
                        wordBreak: 'break-word',
                        fontWeight: 600
                      }}
                    >
                      {item.name}
                    </td>
                  )}
                  {conf.showItemQuantities && (
                    <td
                      dir="ltr"
                      style={{
                        textAlign: 'center',
                        verticalAlign: 'middle',
                        padding: '4px 6px',
                        border: '1px solid #000',
                        lineHeight: 1.3,
                        fontWeight: 'bold',
                        fontVariantNumeric: 'tabular-nums'
                      }}
                    >
                      {formatPrepQty(item.quantity)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

import type { DeliveryPreparationOrder, DeliveryPreparationStatus } from '../types';
import type { DeliveryPrepSlipData } from '../components/DeliveryPrepSlipPrintArea';

/** أدوات مشتركة لشاشة «أوامر التجهيز» وشاشة البيع (أمر تجهيز التوصيل). */

export function formatPrepMoney(value: number): string {
  const num = Number(value) || 0;
  return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
}

export function formatPrepDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      timeZone: 'Africa/Cairo',
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(dt);
  } catch {
    return dt.toLocaleString('ar-EG');
  }
}

export function prepStatusTextClass(status: DeliveryPreparationStatus): string {
  switch (status) {
    case 'قيد التحضير':
      return 'text-sky-700 dark:text-sky-300';
    case 'جاري الشحن':
      return 'text-amber-700 dark:text-amber-300';
    case 'خرج للتوصيل':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'اتلغى':
      return 'text-rose-700 dark:text-rose-300';
    default:
      return 'text-[var(--text-primary)]';
  }
}

export function prepPaymentLabel(mode: string): string {
  return mode === 'cod' ? 'الدفع عند الاستلام' : 'مدفوع مقدمًا';
}

export function prepAssigneeLabel(order: DeliveryPreparationOrder): string {
  if (!order.assigneeName) return '—';
  return `${order.assigneeType === 'courier' ? 'شركة شحن' : 'طيار'}: ${order.assigneeName}`;
}

/** بيانات بون التجهيز من أمر تجهيز حقيقي: اسم العميل ورقمه واسم الصنف والكمية ورقم الأمر. */
export function buildPrepSlipData(order: DeliveryPreparationOrder): DeliveryPrepSlipData {
  return {
    prepNumber: order.number,
    invoiceNumber: order.invoiceNumber || '',
    customerName: order.customerName || '',
    customerPhone: order.phone || '',
    items: (order.lines || []).map((line) => ({
      id: line.itemId,
      name: line.itemName,
      quantity: line.quantity
    }))
  };
}

/** أمر التجهيز يتعدّل ويتلغي ويتشحن وهو «قيد التحضير» بس، و«جاري الشحن» يتعاد شحنه لاستكمال الربط. */
export function prepCanEdit(order: DeliveryPreparationOrder): boolean {
  return order.status === 'قيد التحضير' && !order.invoiceNumber;
}

export function prepCanDispatch(order: DeliveryPreparationOrder): boolean {
  return order.status === 'قيد التحضير' || order.status === 'جاري الشحن';
}

/** نص الخطأ الظاهر للمستخدم: رسالة السيرفر العربية لو موجودة، وإلا رسالة عربية بديلة. */
export function prepErrorText(err: unknown, fallback: string): string {
  const msg = err && typeof err === 'object' ? String((err as { message?: unknown }).message || '') : '';
  return /[\u0600-\u06FF]/.test(msg) ? msg : fallback;
}

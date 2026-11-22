/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { Invoice, CompanySettings, InvoicePrintSettings, Customer, Item } from '../types';
import { ReceiptPrintArea } from '../components/ReceiptPrintArea';
import { prepareAndPrintReceipt } from './printReceiptHelper';

export interface PrintReceiptOptions {
  companySettings?: CompanySettings;
  invoicePrintSettings?: InvoicePrintSettings;
  storeName?: string;
  isReprint?: boolean;
  customers?: Customer[];
  items?: Item[];
  changeGiven?: number;
  customerBalanceAfter?: number;
  onAfterPrint?: () => void;
}

let activeDirectReceiptCleanup: (() => void) | null = null;

/**
 * وظيفة طباعة الإيصال المباشرة الموحدة عبر #print-root و prepareAndPrintReceipt:
 * 1. إنشاء حاوية مضيفة مؤقتة داخل #print-root مع تنظيف أي حاوية سابقة بشكل آمن
 * 2. رسم ReceiptPrintArea مباشرة دون غلاف .receipt-print-area مكرر
 * 3. تفويض القياس وتفعيل body.printing-receipt و@page والطباعة إلى prepareAndPrintReceipt
 * 4. تنظيف idempotent بعد انتهاء الطباعة (afterprint / المسار الاحتياطي) أو عند فشل الإعداد
 */
export async function printReceipt(
  invoice: Invoice,
  options?: PrintReceiptOptions
): Promise<void> {
  if (activeDirectReceiptCleanup) {
    const prevCleanup = activeDirectReceiptCleanup;
    activeDirectReceiptCleanup = null;
    prevCleanup();
  }

  const paperSize = options?.invoicePrintSettings?.paperSize ?? '80mm';
  const defaultWidth = paperSize === '58mm' ? 48 : paperSize === '80mm' ? 72 : 190;
  const printableWidthMm = options?.invoicePrintSettings?.printableWidthMm ?? defaultWidth;

  let printRoot = document.getElementById('print-root');
  if (!printRoot) {
    printRoot = document.createElement('div');
    printRoot.id = 'print-root';
    document.body.appendChild(printRoot);
  }

  const hostEl = document.createElement('div');
  hostEl.setAttribute('data-direct-receipt-host', 'true');
  hostEl.style.margin = '0';
  hostEl.style.padding = '0';
  hostEl.style.width = '100%';
  printRoot.appendChild(hostEl);

  const root = createRoot(hostEl);
  let hostCleaned = false;
  let afterPrintNotified = false;

  const cleanupHostAndNotify = () => {
    if (!hostCleaned) {
      hostCleaned = true;
      if (activeDirectReceiptCleanup === cleanupHostAndNotify) {
        activeDirectReceiptCleanup = null;
      }
      try {
        root.unmount();
      } catch (_) {}
      if (hostEl.parentNode) {
        hostEl.parentNode.removeChild(hostEl);
      }
    }
    if (!afterPrintNotified) {
      afterPrintNotified = true;
      options?.onAfterPrint?.();
    }
  };

  activeDirectReceiptCleanup = cleanupHostAndNotify;

  try {
    await new Promise<void>((resolve) => {
      root.render(
        <ReceiptPrintArea
          invoice={invoice}
          companySettings={options?.companySettings}
          invoicePrintSettings={options?.invoicePrintSettings}
          storeName={options?.storeName || options?.companySettings?.storeName || 'مدقق للنظم'}
          isReprint={options?.isReprint}
          customers={options?.customers}
          items={options?.items}
          changeGiven={options?.changeGiven}
          customerBalanceAfter={options?.customerBalanceAfter}
        />
      );

      // انتظار إطارين لضمان اكتمال إدراج ReceiptPrintArea في #print-root قبل القياس والطباعة
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });

    await prepareAndPrintReceipt({
      paperSize,
      printableWidthMm,
      onAfterPrint: cleanupHostAndNotify
    });
  } catch (err) {
    console.error('فشل تجهيز طباعة الإيصال المباشرة:', err);
    cleanupHostAndNotify();
  }
}

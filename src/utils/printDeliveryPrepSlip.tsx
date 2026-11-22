import React from 'react';
import { createRoot } from 'react-dom/client';
import { DeliveryPrepSlipSettings } from '../types';
import {
  DeliveryPrepSlipData,
  DeliveryPrepSlipPrintArea,
  normalizeDeliveryPrepSlipSettings
} from '../components/DeliveryPrepSlipPrintArea';
import { prepareAndPrintReceipt } from './printReceiptHelper';

export interface PrintDeliveryPrepSlipOptions {
  settings?: Partial<DeliveryPrepSlipSettings>;
  paperSize?: '58mm' | '80mm' | 'a4' | 'custom' | string;
  printableWidthMm?: number;
  onAfterPrint?: () => void;
}

let activePrepSlipCleanup: (() => void) | null = null;

/**
 * طباعة ورقة تجهيز طلب التوصيل مباشرة عبر #print-root و prepareAndPrintReceipt.
 * إذا كان إعداد طباعة ورقة التجهيز موقوفًا (enabled === false)، تمنع الدالة الطباعة وتعيد false فورًا.
 */
export async function printDeliveryPrepSlip(
  data: DeliveryPrepSlipData,
  options?: PrintDeliveryPrepSlipOptions
): Promise<boolean> {
  const conf = normalizeDeliveryPrepSlipSettings(options?.settings);
  if (!conf.enabled) {
    return false;
  }

  if (activePrepSlipCleanup) {
    const prevCleanup = activePrepSlipCleanup;
    activePrepSlipCleanup = null;
    prevCleanup();
  }

  const paperSize = options?.paperSize ?? '80mm';
  const defaultWidth = paperSize === '58mm' ? 48 : paperSize === '80mm' ? 72 : 190;
  const printableWidthMm = options?.printableWidthMm ?? defaultWidth;

  let printRoot = document.getElementById('print-root');
  if (!printRoot) {
    printRoot = document.createElement('div');
    printRoot.id = 'print-root';
    document.body.appendChild(printRoot);
  }

  const hostEl = document.createElement('div');
  hostEl.setAttribute('data-direct-prep-slip-host', 'true');
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
      if (activePrepSlipCleanup === cleanupHostAndNotify) {
        activePrepSlipCleanup = null;
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

  activePrepSlipCleanup = cleanupHostAndNotify;

  try {
    await new Promise<void>((resolve) => {
      root.render(
        <DeliveryPrepSlipPrintArea
          data={data}
          settings={conf}
          paperSize={paperSize}
        />
      );

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
    return true;
  } catch (err) {
    console.error('فشل تجهيز طباعة ورقة التحضير:', err);
    cleanupHostAndNotify();
    return false;
  }
}

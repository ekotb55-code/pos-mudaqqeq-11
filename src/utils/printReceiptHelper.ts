/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './printReceipt';

export interface PrepareAndPrintReceiptOptions {
  paperSize?: '58mm' | '80mm' | 'a4' | 'custom' | string;
  printableWidthMm?: number;
  onAfterPrint?: () => void;
}

let activePrintCleanup: (() => void) | null = null;

/**
 * وظيفة تحضير وطباعة الإيصال كقطعة واحدة متصلة:
 * 1. رسم الإيصال في حاوية قياس مخفية بنفس العرض printableWidthMm.
 * 2. انتظار اكتمال تحميل وفك تشفير كل الصور (الشعار وصورة الهيدر).
 * 3. قياس scrollHeight وتحويله لـ mm وإضافة 8mm.
 * 4. توليد قاعدة @page مع size: <paperWidth>mm <length>mm; margin: 0.
 * 5. عند فشل القياس أو كونه صفراً، ترك size: <paperWidth>mm بدون طول لتجنب إهدار الورق.
 * 6. تسجيل afterprint قبل window.print وتنفيذ تنظيف idempotent بدون إزالة مبكرة أثناء المعاينة غير المتزامنة.
 */
export async function prepareAndPrintReceipt(options: PrepareAndPrintReceiptOptions): Promise<void> {
  if (activePrintCleanup) {
    const previousCleanup = activePrintCleanup;
    activePrintCleanup = null;
    previousCleanup();
  }

  const { paperSize, printableWidthMm: customWidth, onAfterPrint } = options;
  const defaultWidth = paperSize === '58mm' ? 48 : paperSize === '80mm' ? 72 : 190;
  const printableWidthMm = customWidth ?? defaultWidth;

  let cleaned = false;
  let styleEl: HTMLStyleElement | null = null;
  let fallbackTimer: number | null = null;
  let interactionAttachTimer: number | null = null;
  let mediaQuery: MediaQueryList | null = null;
  let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;
  let sawPrintMedia = false;

  const onUserInteraction = () => {
    cleanup();
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;

    if (activePrintCleanup === cleanup) {
      activePrintCleanup = null;
    }

    window.removeEventListener('afterprint', cleanup);
    window.removeEventListener('pointerdown', onUserInteraction, true);
    window.removeEventListener('keydown', onUserInteraction, true);

    if (fallbackTimer !== null) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (interactionAttachTimer !== null) {
      window.clearTimeout(interactionAttachTimer);
      interactionAttachTimer = null;
    }
    if (mediaQuery && mediaListener) {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', mediaListener);
      } else if (typeof (mediaQuery as any).removeListener === 'function') {
        (mediaQuery as any).removeListener(mediaListener);
      }
    }

    document.body.classList.remove('printing-receipt');

    if (styleEl) {
      const injected = document.getElementById('print-page-style');
      if (injected === styleEl) {
        injected.remove();
      } else if (styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
    }

    onAfterPrint?.();
  };

  activePrintCleanup = cleanup;

  const registerPrintEndListeners = () => {
    window.addEventListener('afterprint', cleanup);
    if (typeof window.matchMedia === 'function') {
      try {
        mediaQuery = window.matchMedia('print');
        mediaListener = (e: MediaQueryListEvent) => {
          if (e.matches) {
            sawPrintMedia = true;
          } else if (sawPrintMedia) {
            cleanup();
          }
        };
        if (typeof mediaQuery.addEventListener === 'function') {
          mediaQuery.addEventListener('change', mediaListener);
        } else if (typeof (mediaQuery as any).addListener === 'function') {
          (mediaQuery as any).addListener(mediaListener);
        }
      } catch (_) {}
    }
  };

  const scheduleFallbackCleanup = () => {
    if (cleaned) return;
    // في البيئات غير المتزامنة، إذا لم يصل حدث afterprint بعد انتهاء المعاينة، يُنظّف عند أول تفاعل أو بعد مهلة طويلة آمنة
    interactionAttachTimer = window.setTimeout(() => {
      if (cleaned) return;
      window.addEventListener('pointerdown', onUserInteraction, true);
      window.addEventListener('keydown', onUserInteraction, true);
    }, 400);
    fallbackTimer = window.setTimeout(cleanup, 120000);
  };

  const rootEl = document.getElementById('print-root');
  if (!rootEl) {
    document.body.classList.remove('printing-receipt');
    registerPrintEndListeners();
    try {
      window.print();
    } catch (_) {
      cleanup();
      return;
    }
    scheduleFallbackCleanup();
    return;
  }

  try {
    // انتظر جاهزية الخطوط إن توفرت
    try {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    } catch (_) {}

    let heightMm: number | null = null;

    if (paperSize !== 'a4') {
      // 1. حاوية قياس مخفية في body بعرض printableWidthMm
      const measureContainer = document.createElement('div');
      measureContainer.id = 'receipt-measure-container';
      measureContainer.style.position = 'absolute';
      measureContainer.style.visibility = 'hidden';
      measureContainer.style.top = '0';
      measureContainer.style.left = '-9999px';
      measureContainer.style.width = `${printableWidthMm}mm`;
      measureContainer.style.maxWidth = `${printableWidthMm}mm`;
      measureContainer.style.boxSizing = 'border-box';
      measureContainer.style.padding = '2mm';
      measureContainer.style.margin = '0 auto';
      measureContainer.style.overflow = 'visible';
      measureContainer.style.height = 'auto';
      measureContainer.style.minHeight = '0';
      measureContainer.style.maxHeight = 'none';
      measureContainer.style.display = 'block';

      // نسخ محتوى الإيصال كاملاً لحاوية القياس
      measureContainer.innerHTML = rootEl.innerHTML;
      document.body.appendChild(measureContainer);

      try {
        // 2. انتظار انتهاء تحميل وفك تشفير الصور
        const images = Array.from(measureContainer.querySelectorAll('img'));
        await Promise.all(
          images.map(async (img) => {
            try {
              if (!img.complete) {
                await new Promise<void>((resolve) => {
                  const onDone = () => {
                    img.removeEventListener('load', onDone);
                    img.removeEventListener('error', onDone);
                    resolve();
                  };
                  img.addEventListener('load', onDone);
                  img.addEventListener('error', onDone);
                });
              }
              if (typeof img.decode === 'function') {
                await img.decode();
              }
            } catch (_) {}
          })
        );

        // انتظار تحديث التخطيط (reflow)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        // 3. قياس scrollHeight وتحويله إلى mm وإضافة 8mm
        const heightPx = measureContainer.scrollHeight || measureContainer.offsetHeight;
        if (heightPx && heightPx > 0) {
          heightMm = Math.ceil((heightPx * 25.4) / 96 + 8);
        }
      } catch (err) {
        console.warn('فشل قياس طول الإيصال:', err);
        heightMm = null;
      } finally {
        measureContainer.remove();
      }
    }

    // 4. توليد قواعد CSS للطباعة وحقنها في head
    const prevStyle = document.getElementById('print-page-style');
    if (prevStyle) prevStyle.remove();

    let pageCss = '';
    if (paperSize === 'a4') {
      pageCss = `
        @page {
          size: A4;
          margin: 10mm;
        }
        body.printing-receipt #print-root {
          width: 100% !important;
          max-width: 190mm !important;
          margin: 0 auto !important;
          padding: 0 !important;
          box-sizing: border-box !important;
          display: block !important;
          position: static !important;
          transform: none !important;
          flex: none !important;
          height: auto !important;
          min-height: 0 !important;
        }
        body.printing-receipt #print-root .receipt-print-area {
          width: 100% !important;
          max-width: 190mm !important;
          margin: 0 auto !important;
          padding: 0 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
      `;
    } else {
      const paperWidthMm = paperSize === '58mm' ? 58 : paperSize === 'custom' ? (printableWidthMm || 80) : 80;
      // لو القياس طلع صفر أو فشل، ما تحطش طول (سيب size: <العرض>mm بس)
      const sizeRule = heightMm && heightMm > 0
        ? `size: ${paperWidthMm}mm ${heightMm}mm;`
        : `size: ${paperWidthMm}mm;`;

      pageCss = `
        @page {
          ${sizeRule}
          margin: 0;
        }
        html, body.printing-receipt {
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          display: block !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        body.printing-receipt #root,
        body.printing-receipt [class*="h-screen"],
        body.printing-receipt [class*="min-h-screen"],
        body.printing-receipt [class*="overflow-hidden"],
        body.printing-receipt [class*="overflow-y-auto"],
        body.printing-receipt [class*="overflow-x-auto"] {
          height: auto !important;
          min-height: 0 !important;
          max-height: none !important;
          overflow: visible !important;
          display: block !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        body.printing-receipt #print-root {
          width: ${printableWidthMm}mm !important;
          max-width: ${printableWidthMm}mm !important;
          margin: 0 auto !important;
          padding: 2mm !important;
          box-sizing: border-box !important;
          overflow: hidden !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          display: block !important;
          position: static !important;
          transform: none !important;
          flex: none !important;
          height: auto !important;
          min-height: 0 !important;
          max-height: none !important;
        }
        body.printing-receipt #print-root .receipt-print-area {
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          box-sizing: border-box !important;
          overflow: hidden !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
        body.printing-receipt #print-root .receipt-print-area > div,
        body.printing-receipt #print-root .receipt-table,
        body.printing-receipt #print-root .receipt-table thead,
        body.printing-receipt #print-root .receipt-table tbody,
        body.printing-receipt #print-root .receipt-table tr {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
      `;
    }

    styleEl = document.createElement('style');
    styleEl.id = 'print-page-style';
    styleEl.innerHTML = pageCss;
    document.head.appendChild(styleEl);

    document.body.classList.add('printing-receipt');

    // تسجيل معالج afterprint قبل استدعاء window.print()
    registerPrintEndListeners();

    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  } catch (err) {
    cleanup();
    return;
  }

  try {
    window.print();
  } catch (_) {
    cleanup();
    return;
  }

  // لا نزيل printing-receipt هنا بعد نجاح استدعاء window.print()؛ ننتظر afterprint مع مسار احتياطي غير متسرع
  scheduleFallbackCleanup();
}

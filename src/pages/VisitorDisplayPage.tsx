import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { UserAccount, VisitorDisplaySettings, VisitorProduct, VisitorSlide } from '../types';
import { api } from '../api/client';
import { CameraBarcodeScannerModal } from '../components/CameraBarcodeScannerModal';
import { Camera, LogOut, Lock, AlertCircle, RefreshCw } from 'lucide-react';

export const VISITOR_CATALOG_STORAGE_KEY = 'mudaqqeq_visitor_catalog_v1';

const DEFAULT_VISITOR_SETTINGS: VisitorDisplaySettings = {
  slideSeconds: 8,
  resultSeconds: 10,
  showWelcome: true,
  welcomeText: 'مرحبًا بكم — امسح باركود المنتج لمعرفة السعر',
  showLogo: true,
  slides: [],
  updatedAt: '',
  updatedBy: ''
};

export function normalizeVisitorBarcode(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function formatVisitorPrice(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.00';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function readCachedVisitorCatalog(): Record<string, VisitorProduct> | null {
  try {
    const raw = localStorage.getItem(VISITOR_CATALOG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.catalog && typeof parsed.catalog === 'object') {
      return parsed.catalog as Record<string, VisitorProduct>;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, VisitorProduct>;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeCachedVisitorCatalog(
  catalog: Record<string, VisitorProduct>,
  generatedAt?: string
): void {
  try {
    localStorage.setItem(
      VISITOR_CATALOG_STORAGE_KEY,
      JSON.stringify({
        catalog,
        generatedAt: generatedAt || new Date().toISOString()
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

interface VisitorDisplayPageProps {
  user: UserAccount;
  isScreenOnlyAccount: boolean;
  onExit: () => void;
  onLogout: () => void;
}

type DisplayMode =
  | { type: 'slides' }
  | { type: 'product'; product: VisitorProduct }
  | { type: 'not_found' }
  | { type: 'offline_error' };

export const VisitorDisplayPage: React.FC<VisitorDisplayPageProps> = ({
  user,
  isScreenOnlyAccount,
  onExit,
  onLogout
}) => {
  const [settings, setSettings] = useState<VisitorDisplaySettings>(DEFAULT_VISITOR_SETTINGS);
  const [company, setCompany] = useState<{ name: string; logoUrl: string }>({
    name: '',
    logoUrl: ''
  });
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [displayMode, setDisplayMode] = useState<DisplayMode>({ type: 'slides' });
  const [productImageFailed, setProductImageFailed] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isCursorHidden, setIsCursorHidden] = useState(false);

  // Screen-only account password exit modal (3-second long press)
  const [isExitPasswordModalOpen, setIsExitPasswordModalOpen] = useState(false);
  const [exitPassword, setExitPassword] = useState('');
  const [exitPasswordError, setExitPasswordError] = useState<string | null>(null);
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);

  const cursorTimerRef = useRef<number | null>(null);
  const resultTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const barcodeBufferRef = useRef<string>('');
  const barcodeFlushTimerRef = useRef<number | null>(null);
  const activeLookupAbortRef = useRef<AbortController | null>(null);

  const isReducedMotion = useMemo(() => {
    if (typeof document !== 'undefined') {
      const motionAttr = document.documentElement.getAttribute('data-motion');
      if (motionAttr === 'off') return true;
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  }, []);

  const orderedSlides: VisitorSlide[] = useMemo(() => {
    return Array.isArray(settings.slides) ? [...settings.slides] : [];
  }, [settings.slides]);

  // Keep slide index within bounds
  useEffect(() => {
    if (orderedSlides.length === 0) {
      setCurrentSlideIndex(0);
    } else if (currentSlideIndex >= orderedSlides.length) {
      setCurrentSlideIndex(0);
    }
  }, [orderedSlides.length, currentSlideIndex]);

  // Preload next slide image
  useEffect(() => {
    if (orderedSlides.length <= 1) return;
    const nextIdx = (currentSlideIndex + 1) % orderedSlides.length;
    const nextSlide = orderedSlides[nextIdx];
    const nextUrl = nextSlide?.url || nextSlide?.imageUrl;
    if (nextUrl && typeof window !== 'undefined' && 'Image' in window) {
      const preloadImg = new window.Image();
      preloadImg.src = nextUrl;
    }
  }, [currentSlideIndex, orderedSlides]);

  // Advance slides every slideSeconds when displaying slides
  useEffect(() => {
    if (displayMode.type !== 'slides' || orderedSlides.length <= 1) return;
    const sec = Math.max(3, Math.min(60, Number(settings.slideSeconds) || 8));
    const id = window.setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % orderedSlides.length);
    }, sec * 1000);
    return () => window.clearInterval(id);
  }, [displayMode.type, orderedSlides.length, settings.slideSeconds]);

  // Fetch config on open and every 5 minutes
  const loadConfig = useCallback(async () => {
    try {
      const res = await api.getVisitorConfig();
      if (res && res.settings) {
        setSettings(res.settings);
      }
      if (res && res.company) {
        setCompany({
          name: res.company.name || '',
          logoUrl: res.company.logoUrl || ''
        });
      }
    } catch {
      // Keep current settings if network fails
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    const id = window.setInterval(() => {
      void loadConfig();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [loadConfig]);

  // Fetch offline catalog on open and every 10 minutes
  const refreshOfflineCatalog = useCallback(async () => {
    try {
      const res = await api.getVisitorCatalog();
      if (res && res.catalog && typeof res.catalog === 'object') {
        writeCachedVisitorCatalog(res.catalog, res.generatedAt);
      }
    } catch {
      // Ignore network failure
    }
  }, []);

  useEffect(() => {
    void refreshOfflineCatalog();
    const id = window.setInterval(() => {
      void refreshOfflineCatalog();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refreshOfflineCatalog]);

  // Screen Wake Lock inside try/catch
  useEffect(() => {
    let wakeLockSentinel: any = null;
    const requestWakeLock = async () => {
      try {
        if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && (navigator as any).wakeLock?.request) {
          wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // Silently ignore if wakeLock is unsupported or denied
      }
    };
    void requestWakeLock();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      try {
        wakeLockSentinel?.release?.();
      } catch {
        // Ignore
      }
    };
  }, []);

  // Hide mouse cursor after 3 seconds of inactivity
  useEffect(() => {
    const scheduleHide = () => {
      setIsCursorHidden(false);
      if (cursorTimerRef.current) {
        window.clearTimeout(cursorTimerRef.current);
      }
      cursorTimerRef.current = window.setTimeout(() => {
        setIsCursorHidden(true);
      }, 3000);
    };

    scheduleHide();
    window.addEventListener('mousemove', scheduleHide, { passive: true });
    window.addEventListener('mousedown', scheduleHide, { passive: true });
    return () => {
      window.removeEventListener('mousemove', scheduleHide);
      window.removeEventListener('mousedown', scheduleHide);
      if (cursorTimerRef.current) {
        window.clearTimeout(cursorTimerRef.current);
      }
    };
  }, []);

  const clearResultTimer = useCallback(() => {
    if (resultTimerRef.current) {
      window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
  }, []);

  const returnToSlides = useCallback(() => {
    clearResultTimer();
    setDisplayMode({ type: 'slides' });
    setProductImageFailed(false);
  }, [clearResultTimer]);

  const scheduleReturnToSlides = useCallback(
    (seconds: number) => {
      clearResultTimer();
      resultTimerRef.current = window.setTimeout(() => {
        setDisplayMode({ type: 'slides' });
        setProductImageFailed(false);
      }, Math.max(1, seconds) * 1000);
    },
    [clearResultTimer]
  );

  useEffect(() => {
    return () => {
      clearResultTimer();
      if (barcodeFlushTimerRef.current) {
        window.clearTimeout(barcodeFlushTimerRef.current);
      }
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
      }
      activeLookupAbortRef.current?.abort();
    };
  }, [clearResultTimer]);

  // Barcode Lookup (2s online timeout -> offline localStorage fallback)
  const handleBarcodeLookup = useCallback(
    async (rawCode: string) => {
      const normalized = normalizeVisitorBarcode(rawCode);
      if (!normalized) return;

      activeLookupAbortRef.current?.abort();
      const controller = new AbortController();
      activeLookupAbortRef.current = controller;

      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, 2000);

      const showProduct = (product: VisitorProduct) => {
        setProductImageFailed(false);
        setDisplayMode({ type: 'product', product });
        const sec = Math.max(3, Math.min(60, Number(settings.resultSeconds) || 6));
        scheduleReturnToSlides(sec);
      };

      const showNotFound = () => {
        setProductImageFailed(false);
        setDisplayMode({ type: 'not_found' });
        scheduleReturnToSlides(4);
      };

      const showOfflineError = () => {
        setProductImageFailed(false);
        setDisplayMode({ type: 'offline_error' });
        scheduleReturnToSlides(4);
      };

      try {
        const res = await api.visitorLookup(normalized, controller.signal);
        window.clearTimeout(timeoutId);
        if (res && res.found && res.product) {
          showProduct(res.product);
        } else {
          showNotFound();
        }
      } catch {
        window.clearTimeout(timeoutId);
        // Offline or network timeout -> search local catalog
        const cachedCatalog = readCachedVisitorCatalog();
        if (!cachedCatalog) {
          showOfflineError();
          return;
        }
        const matched = cachedCatalog[normalized];
        if (matched) {
          showProduct(matched);
        } else {
          showNotFound();
        }
      }
    },
    [scheduleReturnToSlides, settings.resultSeconds]
  );

  // Page-level keyboard barcode listener (active whenever camera & password modal are closed)
  useEffect(() => {
    if (isCameraOpen || isExitPasswordModalOpen) return;

    const flushBuffer = () => {
      if (barcodeFlushTimerRef.current) {
        window.clearTimeout(barcodeFlushTimerRef.current);
        barcodeFlushTimerRef.current = null;
      }
      const code = barcodeBufferRef.current.trim();
      barcodeBufferRef.current = '';
      if (code.length > 0) {
        void handleBarcodeLookup(code);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key === 'Enter') {
        if (barcodeBufferRef.current.trim().length > 0) {
          e.preventDefault();
          flushBuffer();
        }
        return;
      }

      if (e.key.length === 1) {
        barcodeBufferRef.current += e.key;
        if (barcodeFlushTimerRef.current) {
          window.clearTimeout(barcodeFlushTimerRef.current);
          barcodeFlushTimerRef.current = null;
        }
        if (barcodeBufferRef.current.trim().length >= 4) {
          barcodeFlushTimerRef.current = window.setTimeout(() => {
            flushBuffer();
          }, 80);
        } else {
          barcodeFlushTimerRef.current = window.setTimeout(() => {
            barcodeBufferRef.current = '';
            barcodeFlushTimerRef.current = null;
          }, 400);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCameraOpen, isExitPasswordModalOpen, handleBarcodeLookup]);

  // 3-second long press on logo or top corner for screen-only account
  const startLongPress = () => {
    if (!isScreenOnlyAccount) return;
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = window.setTimeout(() => {
      setExitPassword('');
      setExitPasswordError(null);
      setIsExitPasswordModalOpen(true);
    }, 3000);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleConfirmExitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exitPassword.trim()) {
      setExitPasswordError('أدخل كلمة سر الحساب للخروج');
      return;
    }
    setIsVerifyingPassword(true);
    setExitPasswordError(null);
    try {
      const res = await api.login(user.username || user.name, exitPassword);
      if (res && res.user) {
        setIsExitPasswordModalOpen(false);
        onLogout();
      } else {
        setExitPasswordError('كلمة السر غير صحيحة');
      }
    } catch (err: any) {
      setExitPasswordError(err?.message || 'كلمة السر غير صحيحة');
    } finally {
      setIsVerifyingPassword(false);
    }
  };

  const hasValidLogo = Boolean(settings.showLogo && company.logoUrl.trim());
  const hasValidWelcome = Boolean(settings.showWelcome && settings.welcomeText.trim());
  const showTopBar = hasValidLogo || hasValidWelcome;

  const showProductWithImage =
    displayMode.type === 'product' &&
    Boolean(displayMode.product.imageUrl?.trim()) &&
    !productImageFailed;

  return (
    <div
      dir="rtl"
      data-testid="visitor-display-screen"
      className={`fixed inset-0 w-screen h-screen overflow-hidden bg-white text-[#1E293B] flex flex-col ${
        isCursorHidden ? 'cursor-none' : ''
      }`}
    >
      {/* Top Bar (shown over slides if logo or welcome text is active) */}
      {displayMode.type === 'slides' && orderedSlides.length > 0 && showTopBar && (
        <header
          data-testid="visitor-top-bar"
          onPointerDown={startLongPress}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          className={`absolute top-0 inset-x-0 z-20 py-3.5 bg-white/85 backdrop-blur-md border-b border-slate-200/70 flex items-center justify-center gap-3 pl-16 sm:pl-20 ${
            isScreenOnlyAccount ? 'pr-6 sm:pr-12' : 'pr-24 sm:pr-28'
          }`}
        >
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 max-w-full">
            {hasValidLogo && (
              <img
                src={company.logoUrl}
                alt={company.name || 'شعار الشركة'}
                data-testid="visitor-company-logo"
                className="h-9 sm:h-11 w-auto max-w-[120px] sm:max-w-[160px] object-contain shrink-0"
              />
            )}
            {hasValidWelcome && (
              <p
                data-testid="visitor-welcome-text"
                className="text-base sm:text-lg md:text-2xl font-extrabold text-slate-800 tracking-tight truncate"
              >
                {settings.welcomeText}
              </p>
            )}
          </div>
        </header>
      )}

      {/* Corner Hotspot for 3-second Long Press (for screen-only account even if top bar is hidden) */}
      {isScreenOnlyAccount && (
        <div
          data-testid="visitor-longpress-corner"
          onPointerDown={startLongPress}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onMouseDown={startLongPress}
          onMouseUp={cancelLongPress}
          onTouchStart={startLongPress}
          onTouchEnd={cancelLongPress}
          aria-label="منطقة الخروج للمسؤول"
          className="fixed top-0 right-0 z-30 w-16 h-16"
        />
      )}

      {/* Subtle Exit button for non-screen-only users */}
      {!isScreenOnlyAccount && (
        <button
          type="button"
          data-testid="visitor-exit-btn"
          onClick={(e) => {
            e.stopPropagation();
            onExit();
          }}
          className="fixed top-3 right-3 z-30 min-h-[44px] px-3.5 rounded-full bg-white/80 hover:bg-white text-slate-700 border border-slate-200/80 shadow-sm backdrop-blur-md inline-flex items-center gap-1.5 text-xs font-bold transition cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>خروج</span>
        </button>
      )}

      {/* Floating Circular Translucent Camera Button (always >= 44x44px) */}
      <button
        type="button"
        data-testid="visitor-camera-btn"
        aria-label="مسح الباركود بالكاميرا"
        title="مسح الباركود بالكاميرا"
        onClick={(e) => {
          e.stopPropagation();
          setIsCameraOpen(true);
        }}
        className="fixed top-3 left-3 z-30 min-w-[44px] min-h-[44px] w-12 h-12 rounded-full bg-white/80 hover:bg-white text-slate-700 border border-slate-200/80 shadow-sm backdrop-blur-md flex items-center justify-center transition cursor-pointer"
      >
        <Camera className="w-5 h-5" />
      </button>

      {/* Main Content Area */}
      {displayMode.type === 'slides' ? (
        orderedSlides.length > 0 ? (
          <div data-testid="visitor-slides-container" className="relative flex-1 w-full h-full bg-white">
            {orderedSlides.map((slide, idx) => {
              const isActive = idx === currentSlideIndex;
              const slideSrc = slide.url || slide.imageUrl || '';
              return (
                <img
                  key={slide.id}
                  src={slideSrc}
                  alt={`عرض ${idx + 1}`}
                  data-testid={isActive ? 'visitor-active-slide' : `visitor-slide-${idx}`}
                  style={{
                    transitionDuration: isReducedMotion ? '0ms' : '600ms'
                  }}
                  className={`absolute inset-0 w-full h-full object-contain bg-white transition-opacity ease-in-out ${
                    isActive ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                  }`}
                />
              );
            })}
          </div>
        ) : (
          /* Empty Slides State */
          <div
            data-testid="visitor-empty-slides"
            onPointerDown={startLongPress}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onPointerCancel={cancelLongPress}
            className="flex-1 w-full h-full bg-white flex flex-col items-center justify-center px-6 text-center gap-6"
          >
            {hasValidLogo && (
              <img
                src={company.logoUrl}
                alt={company.name || 'شعار الشركة'}
                data-testid="visitor-company-logo"
                className="h-24 md:h-32 w-auto max-w-[280px] object-contain"
              />
            )}
            {hasValidWelcome && (
              <h1
                data-testid="visitor-welcome-text"
                className="text-2xl md:text-4xl font-extrabold text-slate-800 max-w-3xl leading-snug"
              >
                {settings.welcomeText}
              </h1>
            )}
            <p
              data-testid="visitor-empty-prompt"
              className="text-xl md:text-3xl font-bold text-slate-500"
            >
              امسح باركود المنتج لمعرفة السعر
            </p>
          </div>
        )
      ) : displayMode.type === 'product' ? (
        /* Product Price Result Screen (touching/clicking returns immediately to slides) */
        <div
          data-testid="visitor-product-view"
          onClick={returnToSlides}
          className="flex-1 w-full h-full bg-white flex items-center justify-center p-6 md:p-12 lg:p-16 cursor-pointer"
        >
          {showProductWithImage ? (
            <div
              data-testid="visitor-product-with-image"
              className="w-full max-w-6xl h-full flex flex-col md:flex-row items-center justify-center gap-8 md:gap-14"
            >
              {/* Product Image Side */}
              <div className="w-full md:w-1/2 max-h-[42vh] md:max-h-[72vh] flex items-center justify-center">
                <img
                  src={displayMode.product.imageUrl}
                  alt={displayMode.product.name}
                  data-testid="visitor-product-image"
                  onError={() => setProductImageFailed(true)}
                  className="max-w-full max-h-[40vh] md:max-h-[68vh] w-auto h-auto object-contain rounded-2xl"
                />
              </div>

              {/* Product Name & Price Side */}
              <div className="w-full md:w-1/2 flex flex-col items-center md:items-start text-center md:text-start justify-center gap-6">
                <h1
                  data-testid="visitor-product-name"
                  className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-slate-900 leading-tight break-words"
                >
                  {displayMode.product.name}
                </h1>

                {/* Price container sized to comfortably fit a second sub-unit offer line later */}
                <div
                  data-testid="visitor-price-block"
                  className="min-h-[136px] md:min-h-[168px] flex flex-col justify-center gap-2"
                >
                  <div className="flex items-baseline justify-center md:justify-start gap-3 flex-wrap">
                    <span
                      data-testid="visitor-product-price"
                      dir="ltr"
                      className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-[#1668B2] tabular-nums tracking-tight leading-none"
                    >
                      {formatVisitorPrice(displayMode.product.price ?? displayMode.product.salePrice ?? 0)}
                    </span>
                    <span className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-700">
                      ج.م
                    </span>
                  </div>

                  {displayMode.product.unit && displayMode.product.unit.trim() && (
                    <div
                      data-testid="visitor-product-unit"
                      className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-500"
                    >
                      / {displayMode.product.unit.trim()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Product Without Image — centered name & price, NO empty image placeholder */
            <div
              data-testid="visitor-product-without-image"
              className="w-full max-w-4xl flex flex-col items-center justify-center text-center gap-8 px-4"
            >
              <h1
                data-testid="visitor-product-name"
                className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-slate-900 leading-tight break-words"
              >
                {displayMode.product.name}
              </h1>

              {/* Price container sized to comfortably fit a second sub-unit offer line later */}
              <div
                data-testid="visitor-price-block"
                className="min-h-[148px] md:min-h-[180px] flex flex-col items-center justify-center gap-3"
              >
                <div className="flex items-baseline justify-center gap-3 flex-wrap">
                  <span
                    data-testid="visitor-product-price"
                    dir="ltr"
                    className="text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-black text-[#1668B2] tabular-nums tracking-tight leading-none"
                  >
                    {formatVisitorPrice(displayMode.product.price ?? displayMode.product.salePrice ?? 0)}
                  </span>
                  <span className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-slate-700">
                    ج.م
                  </span>
                </div>

                {displayMode.product.unit && displayMode.product.unit.trim() && (
                  <div
                    data-testid="visitor-product-unit"
                    className="text-2xl sm:text-3xl font-bold text-slate-500"
                  >
                    / {displayMode.product.unit.trim()}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : displayMode.type === 'not_found' ? (
        /* Barcode Not Found State (4 seconds) */
        <div
          data-testid="visitor-not-found-view"
          onClick={returnToSlides}
          className="flex-1 w-full h-full bg-white flex flex-col items-center justify-center p-8 text-center cursor-pointer"
        >
          <p
            data-testid="visitor-not-found-message"
            className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-slate-800 leading-snug"
          >
            الصنف غير موجود — اسأل الكاشير
          </p>
        </div>
      ) : (
        /* Offline and No Saved Catalog State */
        <div
          data-testid="visitor-offline-error-view"
          onClick={returnToSlides}
          className="flex-1 w-full h-full bg-white flex flex-col items-center justify-center p-8 text-center cursor-pointer"
        >
          <p
            data-testid="visitor-offline-error-message"
            className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-slate-800 leading-snug"
          >
            تعذر الوصول للأسعار الآن
          </p>
        </div>
      )}

      {/* Camera Barcode Scanner Modal */}
      <CameraBarcodeScannerModal
        items={[]}
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onBarcodeDetected={(code) => {
          setIsCameraOpen(false);
          void handleBarcodeLookup(code);
        }}
      />

      {/* Password Modal for Screen-Only Account Logout */}
      {isExitPasswordModalOpen && (
        <div
          data-testid="visitor-exit-password-modal"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleConfirmExitPassword}
            className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-xl p-6 space-y-4"
          >
            <div className="flex items-center gap-2.5 text-slate-900">
              <Lock className="w-5 h-5 text-[#1668B2]" />
              <h2 className="text-base font-extrabold">تأكيد الخروج من شاشة الزوار</h2>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              أدخل كلمة سر الحساب ({user.username}) لتسجيل الخروج من وضع الشاشة.
            </p>

            <div>
              <input
                type="password"
                value={exitPassword}
                onChange={(e) => setExitPassword(e.target.value)}
                placeholder="كلمة السر"
                autoFocus
                data-testid="visitor-exit-password-input"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-[#1668B2]"
              />
            </div>

            {exitPasswordError && (
              <div
                role="alert"
                className="flex items-center gap-1.5 text-xs font-bold text-[#D9524F]"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{exitPasswordError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isVerifyingPassword}
                onClick={() => setIsExitPasswordModalOpen(false)}
                className="min-h-[44px] px-4 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isVerifyingPassword}
                data-testid="visitor-exit-password-submit"
                className="min-h-[44px] px-5 rounded-lg bg-[#D9524F] hover:bg-[#B42318] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {isVerifyingPassword && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

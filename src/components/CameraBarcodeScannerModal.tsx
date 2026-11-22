import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Item } from '../types';
import {
  Camera,
  X,
  Flashlight,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Barcode,
  Search,
  Volume2,
  VolumeX,
  ArrowRight
} from 'lucide-react';

interface CameraBarcodeScannerModalProps {
  items: Item[];
  isOpen: boolean;
  onClose: () => void;
  onBarcodeDetected: (barcode: string, matchedItem: Item | null) => void;
  onManualSearchRequest?: (searchTerm: string) => void;
}

// إنشاء نغمة رنين تأكيد نجاح المسح عبر Web Audio API
function playScanSuccessBeep() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1760, ctx.currentTime); // نغمة A6 بتردد واضح ومريح
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.12);

    // اهتزاز الهاتف الخفيف إن كان مدعوماً
    if (navigator.vibrate) {
      navigator.vibrate(80);
    }
  } catch (_) {
    // تجاهل أخطاء تشغيل الصوت في المتصفحات المقيدة
  }
}

export const CameraBarcodeScannerModal: React.FC<CameraBarcodeScannerModalProps> = ({
  items,
  isOpen,
  onClose,
  onBarcodeDetected,
  onManualSearchRequest
}) => {
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // حالة النتيجة اللحظية
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [lastMatchedItem, setLastMatchedItem] = useState<Item | null>(null);
  const [scanStatus, setScanStatus] = useState<'idle' | 'success' | 'not_found'>('idle');
  const [isCameraCodeLocked, setIsCameraCodeLocked] = useState<boolean>(false);

  // إدخال يدوي / قارئ USB أو بلوتوث
  const [manualInput, setManualInput] = useState('');

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'interactive-barcode-scanner-view';

  // قفل الحضور المستمر للكاميرا: يمنع تكرار نفس الرمز طالما بقي ظاهرًا في إطارات متتابعة،
  // ويعيد التسليح فقط بعد اختفاء الرمز من مجال الكاميرا لعدة إطارات متتالية أو بطلب إعادة تسليح صريح.
  const lockedCameraCodeRef = useRef<string | null>(null);
  const absentFramesCountRef = useRef<number>(0);
  const lastCameraSeenAtRef = useRef<number>(0);
  const lastCameraEmitAtRef = useRef<number>(0);

  // الاحتفاظ بأحدث المراجع للدوال والبيانات داخل callbacks مكتبة Html5Qrcode
  const itemsRef = useRef<Item[]>(items);
  itemsRef.current = items;
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const onBarcodeDetectedRef = useRef(onBarcodeDetected);
  onBarcodeDetectedRef.current = onBarcodeDetected;

  // البحث عن الصنف بمطابقة الباركود الأساسي أو الفرعي أو الكود
  const findItemByBarcode = (code: string): Item | null => {
    const clean = code.trim().toLowerCase();
    if (!clean) return null;

    return itemsRef.current.find(it => {
      // 1. فحص الباركود الأساسي
      if (it.barcode && it.barcode.trim().toLowerCase() === clean) return true;
      // 2. فحص الباركودات الفرعية
      if (it.secondaryBarcodes && it.secondaryBarcodes.some(sb => sb.trim().toLowerCase() === clean)) return true;
      // 3. فحص كائنات الباركود إن وجدت
      if (it.barcodes && it.barcodes.some(b => b.barcode.trim().toLowerCase() === clean)) return true;
      // 4. فحص كود الصنف SKU
      if (it.sku && it.sku.trim().toLowerCase() === clean) return true;
      return false;
    }) || null;
  };

  // تنفيذ حدث مسح معتمد (من الكاميرا بعد اجتياز قفل الإطارات، أو مباشرة من قارئ USB/Bluetooth)
  const emitScannedBarcode = (rawCode: string) => {
    const cleanCode = rawCode.trim();
    if (!cleanCode) return;

    const matched = findItemByBarcode(cleanCode);
    setLastScannedCode(cleanCode);
    setLastMatchedItem(matched);

    if (matched) {
      setScanStatus('success');
      if (soundEnabledRef.current) {
        playScanSuccessBeep();
      }
      onBarcodeDetectedRef.current(cleanCode, matched);
    } else {
      setScanStatus('not_found');
      onBarcodeDetectedRef.current(cleanCode, null);
    }
  };

  // إعادة تسليح المسح بالكاميرا يدويًا للسماح بمسح نفس الرمز مرة أخرى فورًا
  const rearmCameraScan = () => {
    lockedCameraCodeRef.current = null;
    absentFramesCountRef.current = 0;
    setIsCameraCodeLocked(false);
  };

  // معالجة إطار كاميرا تم فك تشفير باركود فيه
  const handleCameraFrameDecoded = (decodedText: string) => {
    const cleanCode = decodedText.trim();
    if (!cleanCode) return;
    const normalizedCode = cleanCode.toLowerCase();
    const now = Date.now();

    // إذا كان نفس الرمز ما زال ظاهرًا أمام الكاميرا في إطارات متتابعة، اعتبره نفس الحدث ولا تكرر الإضافة
    if (lockedCameraCodeRef.current === normalizedCode) {
      absentFramesCountRef.current = 0;
      lastCameraSeenAtRef.current = now;
      return;
    }

    // فاصل قصير جدًا عند تبديل رمز مختلف أثناء حركة اليد لمنع القراءات المشوشة العابرة
    if (lockedCameraCodeRef.current !== null && now - lastCameraEmitAtRef.current < 250) {
      return;
    }

    lockedCameraCodeRef.current = normalizedCode;
    absentFramesCountRef.current = 0;
    lastCameraSeenAtRef.current = now;
    lastCameraEmitAtRef.current = now;
    setIsCameraCodeLocked(true);

    emitScannedBarcode(cleanCode);
  };

  // معالجة إطار كاميرا خالٍ من الباركود: يعيد تسليح المسح تلقائيًا بعد اختفاء الرمز بوضوح
  const handleCameraFrameAbsent = () => {
    if (lockedCameraCodeRef.current === null) return;
    absentFramesCountRef.current += 1;
    const elapsedSinceLastSeen = Date.now() - lastCameraSeenAtRef.current;
    // 8 إطارات متتالية بدون رمز (حوالي نصف ثانية على 15fps) مع مرور 550ms على آخر ظهور
    if (absentFramesCountRef.current >= 8 && elapsedSinceLastSeen >= 550) {
      lockedCameraCodeRef.current = null;
      absentFramesCountRef.current = 0;
      setIsCameraCodeLocked(false);
    }
  };

  // تشغيل الكاميرا
  const startCamera = async (cameraId?: string) => {
    try {
      setCameraError(null);
      setIsScanning(true);
      rearmCameraScan();

      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop();
          }
          await html5QrCodeRef.current.clear();
        } catch (_) {}
      }

      const scanner = new Html5Qrcode(scannerContainerId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.QR_CODE
        ]
      });
      html5QrCodeRef.current = scanner;

      // إعدادات الكاميرا: تفضيل الكاميرا الخلفية (environment) على الهواتف
      const cameraConfig = cameraId
        ? { deviceId: { exact: cameraId } }
        : { facingMode: 'environment' };

      const qrConfig = {
        fps: 15,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const width = Math.floor(minEdge * 0.82);
          const height = Math.floor(minEdge * 0.55);
          return { width, height };
        },
        aspectRatio: 1.0
      };

      await scanner.start(
        cameraConfig,
        qrConfig,
        (decodedText) => {
          handleCameraFrameDecoded(decodedText);
        },
        () => {
          handleCameraFrameAbsent();
        }
      );

      // فحص دعم الفلاش (Torch)
      try {
        const capabilities = (scanner as any).getRunningTrackCapabilities?.() || {};
        if ('torch' in capabilities) {
          setTorchSupported(true);
        } else {
          setTorchSupported(false);
        }
      } catch (_) {
        setTorchSupported(false);
      }
    } catch (err: any) {
      console.warn('Camera scan start error:', err);
      setIsScanning(false);
      let msg = 'تعذر تشغيل كاميرا الجهاز للمسح.';
      if (err.name === 'NotAllowedError' || err.message?.includes('Permission')) {
        msg = 'تم رفض إذن الوصول للكاميرا. يرجى تفعيل إذن الكاميرا من إعدادات المتصفح.';
      } else if (err.name === 'NotFoundError' || err.message?.includes('No camera')) {
        msg = 'لم يتم العثور على كاميرا متصلة بالجهاز.';
      } else if (err.name === 'NotReadableError' || err.message?.includes('busy')) {
        msg = 'الكاميرا قيد الاستخدام بواسطة تطبيق آخر.';
      }
      setCameraError(msg);
    }
  };

  // إيقاف الكاميرا
  const stopCamera = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        await html5QrCodeRef.current.clear();
      } catch (_) {}
    }
    setIsScanning(false);
    setTorchEnabled(false);
    rearmCameraScan();
  };

  // تبديل كشاف الإضاءة
  const toggleTorch = async () => {
    if (!html5QrCodeRef.current || !torchSupported) return;
    try {
      const nextState = !torchEnabled;
      await html5QrCodeRef.current.applyVideoConstraints({
        advanced: [{ torch: nextState } as any]
      });
      setTorchEnabled(nextState);
    } catch (err) {
      console.warn('Torch toggle error:', err);
    }
  };

  // تحميل قائمة الكاميرات المتوفرة
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    Html5Qrcode.getCameras()
      .then(devices => {
        if (!isMounted) return;
        if (devices && devices.length > 0) {
          const list = devices.map(d => ({ id: d.id, label: d.label || `كاميرا ${d.id.slice(0, 5)}` }));
          setCameras(list);
          // اختيار الكاميرا الخلفية إن أمكن
          const backCam = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('rear'));
          const targetId = backCam ? backCam.id : devices[0].id;
          setSelectedCameraId(targetId);
          startCamera(targetId);
        } else {
          startCamera();
        }
      })
      .catch(() => {
        if (isMounted) startCamera();
      });

    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [isOpen]);

  // إرسال الكود اليدوي أو من قارئ USB / Bluetooth:
  // كل حدث إرسال (نهاية مسح Enter منفصلة) يُنفّذ فورًا كمسحة مستقلة دون حجب بقفل الكاميرا أو مهلة التهدئة
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualInput.trim();
    if (!clean) return;
    setManualInput('');
    emitScannedBarcode(clean);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/80 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[calc(92vh/var(--app-zoom,1))]">
        
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-cyan-900 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center text-cyan-300">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">مسح الباركود بالكاميرا</h2>
              <p className="text-xs text-cyan-200">وجه الكاميرا نحو باركود الصنف ليتم إضافته فورًا</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* زر الصوت */}
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-xl transition cursor-pointer ${
                soundEnabled ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-400'
              }`}
              title={soundEnabled ? 'صوت الرنين مفعل' : 'صوت الرنين مكتوم'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* زر الفلاش إن كان مدعوماً */}
            {torchSupported && (
              <button
                type="button"
                onClick={toggleTorch}
                className={`p-2 rounded-xl transition cursor-pointer ${
                  torchEnabled ? 'bg-amber-500 text-slate-900 shadow-sm' : 'bg-slate-800 text-slate-300'
                }`}
                title="تشغيل / إيقاف الكشاف"
              >
                <Flashlight className="w-4 h-4" />
              </button>
            )}

            {/* زر الإغلاق */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Viewfinder & Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          
          {/* رسائل الخطأ إن وجدت */}
          {cameraError && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <div className="flex-1">
                <p className="font-bold">{cameraError}</p>
                <p className="text-[11px] text-rose-600 mt-1">
                  يمكنك الاستمرار في استخدام قارئ الباركود اللاسلكي أو إدخال الكود يدويًا في الحقل بالأسفل.
                </p>
              </div>
            </div>
          )}

          {/* إطار الكاميرا */}
          <div className="relative rounded-2xl overflow-hidden bg-black border-2 border-slate-700 shadow-inner aspect-4/3 flex items-center justify-center">
            
            {/* حاوية مكتبة المسح */}
            <div id={scannerContainerId} className="w-full h-full object-cover"></div>

            {/* علامات التصويب والخط التفاعلي */}
            {isScanning && !cameraError && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                
                {/* إطار محدد لمكان الباركود */}
                <div className="w-[82%] h-[55%] border-2 border-cyan-400/80 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                  {/* زوايا الإطار */}
                  <div className="absolute -top-1 -right-1 w-4 h-4 border-t-3 border-r-3 border-cyan-300 rounded-tr-md"></div>
                  <div className="absolute -top-1 -left-1 w-4 h-4 border-t-3 border-l-3 border-cyan-300 rounded-tl-md"></div>
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-3 border-r-3 border-cyan-300 rounded-br-md"></div>
                  <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-3 border-l-3 border-cyan-300 rounded-bl-md"></div>

                  {/* شعاع ليزر متحرك */}
                  <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#38bdf8] animate-pulse top-1/2 -translate-y-1/2"></div>
                </div>

                <div className="absolute bottom-2 text-center">
                  <span className="px-2.5 py-1 rounded-full bg-slate-900/80 text-[11px] font-medium text-cyan-200 border border-slate-700/60">
                    {isCameraCodeLocked
                      ? 'تمت قراءة الرمز — أبعد الرمز عن الإطار أو أعد التسليح لمسح جديد'
                      : 'ضع الباركود أو الـ QR داخل الإطار'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* زر إعادة تسليح المسح بوضوح عند بقاء نفس الرمز أمام الكاميرا */}
          {isCameraCodeLocked && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-900 text-xs">
              <span className="font-semibold">
                الكاميرا أوقفت تكرار الرمز الحالي ({lastScannedCode}) حتى يختفي من الإطار
              </span>
              <button
                type="button"
                data-testid="camera-rearm-scan-btn"
                onClick={rearmCameraScan}
                className="px-2.5 py-1 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-[11px] font-bold transition cursor-pointer shrink-0 inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>إعادة تسليح المسح</span>
              </button>
            </div>
          )}

          {/* اختيار الكاميرا إذا وجد أكثر من كاميرا */}
          {cameras.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-700 shrink-0">الكاميرا:</label>
              <select
                value={selectedCameraId}
                onChange={(e) => {
                  setSelectedCameraId(e.target.value);
                  startCamera(e.target.value);
                }}
                className="flex-1 py-1.5 px-3 rounded-xl border border-slate-200 text-xs bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              >
                {cameras.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => startCamera(selectedCameraId)}
                className="p-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                title="إعادة تشغيل الكاميرا"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* تنبيه نتيجة آخر مسح */}
          {scanStatus === 'success' && lastMatchedItem && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-emerald-900">
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">تم مسح الصنف بنجاح:</p>
                  <p className="text-sm font-extrabold text-emerald-700 truncate">{lastMatchedItem.name}</p>
                  <p className="text-[11px] text-emerald-600 font-mono mt-0.5">{lastScannedCode}</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-xl bg-emerald-200/60 text-emerald-800 text-xs font-bold shrink-0">
                {lastMatchedItem.salePrice} EGP
              </span>
            </div>
          )}

          {scanStatus === 'not_found' && lastScannedCode && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col gap-2 text-amber-900">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-bold">لم يُعثر على صنف بهذا الباركود:</p>
                  <p className="font-mono text-slate-800 font-bold bg-white px-2 py-0.5 rounded border border-amber-200 inline-block mt-1">
                    {lastScannedCode}
                  </p>
                </div>
              </div>

              {onManualSearchRequest && (
                <button
                  type="button"
                  onClick={() => {
                    onManualSearchRequest(lastScannedCode);
                    onClose();
                  }}
                  className="self-end px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>بحث بالاسم في شاشة البيع</span>
                </button>
              )}
            </div>
          )}

          {/* حقل المسح اليدوي أو عبر قارئ USB / Bluetooth Scanner */}
          <form onSubmit={handleManualSubmit} className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Barcode className="w-3.5 h-3.5 text-cyan-700" />
                <span>إدخال الباركود يدوياً أو بقارئ الباركود (USB/Bluetooth):</span>
              </span>
              <span className="text-[10px] text-slate-400 font-normal">اضغط Enter بعد المسح</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="أدخل أو امسح الباركود هنا ثم اضغط إضافة..."
                className="flex-1 py-2.5 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
              />
              <button
                type="submit"
                disabled={!manualInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-cyan-700 hover:bg-cyan-800 disabled:opacity-40 text-white text-xs font-bold transition cursor-pointer shrink-0"
              >
                إضافة
              </button>
            </div>
          </form>

        </div>

        {/* Footer */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-500 flex items-center gap-1">
            <span>يدعم: EAN-13, EAN-8, UPC, Code 128, QR</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer min-h-[38px]"
          >
            إغلاق
          </button>
        </div>

      </div>
    </div>
  );
};

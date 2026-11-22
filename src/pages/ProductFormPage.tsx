import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Item,
  Platform,
  ItemPlatformCost,
  UserRole,
  UserAccount,
  ItemChangeLogEntry,
  StockMovement,
  ProductCategory,
  WarehouseItemBreakdown
} from '../types';
import { api } from '../api/client';
import { hasPermission } from '../utils/permissions';
import { toLayoutPx } from '../utils/uiScale';
import { getHrefForTarget, getHrefForItemRoute, isPlainLeftClick } from '../config/navigation';
import {
  X,
  Save,
  Sparkles,
  Copy,
  Check,
  Plus,
  AlertCircle,
  Loader2,
  Camera,
  Upload,
  Image as ImageIcon,
  Link as LinkIcon,
  Shield,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  Trash2
} from 'lucide-react';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS
} from '../components/ui';
import {
  useRegisterShortcuts,
  useModalShortcuts,
  ShortcutBadge
} from '../context/KeyboardShortcutsContext';

export interface ProductFormPageProps {
  mode: 'new' | 'edit';
  itemId?: string;
  item?: Item | null;
  platforms: Platform[];
  costs: ItemPlatformCost[];
  userRole: UserRole;
  user?: UserAccount | null;
  existingItems: Item[];
  categories?: ProductCategory[];
  taxInclusiveSetting?: boolean;
  onSave: (
    itemData: Partial<Item> & { name: string },
    platformCosts?: ItemPlatformCost[]
  ) => Promise<Item>;
  onBackToList: () => void;
  onNavigateItemRoute: (path: string, item?: Item) => void;
  onDirtyChange?: (isDirty: boolean) => void;
  platformsEnabled?: boolean;
}

type SectionId = 'BASIC' | 'CODES' | 'PRICING' | 'STOCK' | 'PLATFORMS' | 'LOGS';

const ITEM_UNITS = ['قطعة', 'علبة', 'كرتونة', 'طقم', 'زوج', 'متر', 'كجم', 'لتر'];

/**
 * دالة مساعدة لتوليد باركود EAN-13 عشوائي صالح مع رقم التحقق (Check Digit)
 */
function generateValidEAN13(existingBarcodes: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let base = '200';
    for (let i = 0; i < 9; i++) {
      base += Math.floor(Math.random() * 10).toString();
    }
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const digit = parseInt(base[i], 10);
      sum += i % 2 === 0 ? digit : digit * 3;
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    const fullBarcode = base + checkDigit.toString();
    if (!existingBarcodes.has(fullBarcode)) {
      return fullBarcode;
    }
  }
  return Date.now().toString().slice(0, 13);
}

/**
 * تطبيع النص للمقارنة الذكية (إزالة المسافات الزائدة وتوحيد الحروف)
 */
function normalizeText(val?: string): string {
  return (val || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export const ProductFormPage: React.FC<ProductFormPageProps> = ({
  mode,
  itemId,
  item,
  platforms,
  costs,
  userRole,
  user,
  existingItems = [],
  categories = [],
  onSave,
  onBackToList,
  onNavigateItemRoute,
  onDirtyChange,
  platformsEnabled = true
}) => {
  const isManager = userRole === 'manager' || userRole === 'designer';
  const canViewPurchase = user ? hasPermission(user, 'prices.view_purchase') : isManager;

  // حل الصنف الحالي سواء من الـ prop أو من القائمة أو بالجلب من الخادم عند تحديث الصفحة مباشرة على /items/:id
  const [fetchedItem, setFetchedItem] = useState<Item | null>(null);
  const [isFetchingItem, setIsFetchingItem] = useState<boolean>(false);
  const [fetchItemError, setFetchItemError] = useState<string | null>(null);
  const [warehouseBreakdown, setWarehouseBreakdown] = useState<WarehouseItemBreakdown[]>([]);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState<boolean>(false);

  const resolvedItem = useMemo<Item | null>(() => {
    if (mode === 'new') return null;
    if (item && (!itemId || item.id === itemId)) return item;
    if (itemId) {
      const fromList = existingItems.find(p => p.id === itemId);
      if (fromList) return fromList;
    }
    if (fetchedItem && (!itemId || fetchedItem.id === itemId)) return fetchedItem;
    return null;
  }, [mode, item, itemId, existingItems, fetchedItem]);

  useEffect(() => {
    let active = true;
    if (mode === 'edit' && itemId && !resolvedItem) {
      setIsFetchingItem(true);
      setFetchItemError(null);
      api
        .getItems()
        .then(list => {
          if (!active) return;
          const found = Array.isArray(list) ? list.find(p => p.id === itemId) || null : null;
          if (found) {
            setFetchedItem(found);
          } else {
            setFetchItemError('لم يتم العثور على الصنف المطلوب أو ربما تم حذفه.');
          }
        })
        .catch((err: any) => {
          if (!active) return;
          setFetchItemError(err?.message || 'تعذر تحميل بيانات الصنف من الخادم.');
        })
        .finally(() => {
          if (active) setIsFetchingItem(false);
        });
    } else {
      setFetchItemError(null);
      setIsFetchingItem(false);
    }
    return () => {
      active = false;
    };
  }, [mode, itemId, resolvedItem]);

  const [currentItem, setCurrentItem] = useState<Item | null>(resolvedItem);

  useEffect(() => {
    setCurrentItem(resolvedItem);
  }, [resolvedItem]);

  // Basic Info State
  const [name, setName] = useState('');
  const [printName, setPrintName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('قطعة');
  const [supplier, setSupplier] = useState('');
  const [status, setStatus] = useState<Item['status']>('نشط');
  const [notes, setNotes] = useState('');
  const [platformIds, setPlatformIds] = useState<string[]>([]);

  // Image State
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageUploadStatus, setImageUploadStatus] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Codes & Barcodes State
  const [barcode, setBarcode] = useState('');
  const [secondaryBarcodes, setSecondaryBarcodes] = useState<string[]>([]);
  const [newSecondaryBarcode, setNewSecondaryBarcode] = useState('');
  const [copiedBarcode, setCopiedBarcode] = useState(false);

  // Pricing & Costs State
  const [salePrice, setSalePrice] = useState<number | ''>('');
  const [minPrice, setMinPrice] = useState<number | ''>('');
  const [purchasePrice, setPurchasePrice] = useState<number | ''>('');
  const [packagingCost, setPackagingCost] = useState<number | ''>('');
  const [taxRate, setTaxRate] = useState<number | ''>(0);
  const [pickupFee, setPickupFee] = useState<number | ''>('');
  const [enableBnpl, setEnableBnpl] = useState<boolean>(false);
  const [bnplPercentage, setBnplPercentage] = useState<number | ''>(20);

  // Inventory & Reorder State
  const [stockQuantity, setStockQuantity] = useState<number | ''>('');
  const [reorderLimit, setReorderLimit] = useState<number | ''>(5);
  const [editReason, setEditReason] = useState('');

  // Platform Specific Costs State
  const [platformCostsState, setPlatformCostsState] = useState<
    Record<string, { returnShippingDeduction: number | '' }>
  >({});

  // Logs State (for existing items)
  const [changeLogs, setChangeLogs] = useState<ItemChangeLogEntry[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // Form Submission & Validation State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedSuccessInfo, setSavedSuccessInfo] = useState<{
    mode: 'new' | 'edit';
    itemName: string;
    itemCode: string;
  } | null>(null);

  // Duplicate / Conflict Warnings State
  const [nameConflict, setNameConflict] = useState<Item | null>(null);
  const [skuConflict, setSkuConflict] = useState<Item | null>(null);
  const [barcodeConflict, setBarcodeConflict] = useState<Item | null>(null);
  const [secBarcodeConflict, setSecBarcodeConflict] = useState<Item | null>(null);

  // حالة القائمة المتعددة المضغوطة للمنصات
  const [isPlatformsOpen, setIsPlatformsOpen] = useState(false);
  const platformsDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPlatformsOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        platformsDropdownRef.current &&
        !platformsDropdownRef.current.contains(event.target as Node)
      ) {
        setIsPlatformsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPlatformsOpen]);

  // شريط الأقسام العلوي يظهر فقط إذا كانت الصفحة أطول من شاشتين
  const formContainerRef = useRef<HTMLFormElement>(null);
  const [showSectionNav, setShowSectionNav] = useState<boolean>(false);
  const [activeSection, setActiveSection] = useState<SectionId>('BASIC');
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>({
    BASIC: null,
    CODES: null,
    PRICING: null,
    STOCK: null,
    PLATFORMS: null,
    LOGS: null
  });

  // نافذة تأكيد الخروج عند وجود تعديلات غير محفوظة
  const [exitConfirmModal, setExitConfirmModal] = useState<{
    open: boolean;
    onConfirm: () => void;
  } | null>(null);

  // بناء شجرة التصنيفات النشطة (تصنيف رئيسي -> تصنيفات فرعية)
  const activeCategories = useMemo(() => {
    return categories
      .filter(c => c.status === 'نشط' || c.id === categoryId)
      .sort((a, b) => (a.displayOrder || 1) - (b.displayOrder || 1));
  }, [categories, categoryId]);

  const rootCategories = useMemo(() => {
    return activeCategories.filter(c => !c.parentCategoryId);
  }, [activeCategories]);

  const [selectedRootId, setSelectedRootId] = useState<string>('');
  const [selectedSubId, setSelectedSubId] = useState<string>('');

  const subCategoriesForSelectedRoot = useMemo(() => {
    if (!selectedRootId) return [];
    return activeCategories.filter(c => c.parentCategoryId === selectedRootId);
  }, [activeCategories, selectedRootId]);

  const activePlatforms = useMemo(
    () => platforms.filter(p => p.status === 'active' || p.status === 'نشطة'),
    [platforms]
  );

  // مرجع البصمة الابتدائية لمعرفة ما إذا كانت هناك تعديلات غير محفوظة (isDirty)
  const [baselineSnapshot, setBaselineSnapshot] = useState<string>('');

  const buildSnapshotString = useCallback(
    (vals: {
      name: string;
      printName: string;
      categoryId: string;
      sku: string;
      unit: string;
      supplier: string;
      status: string;
      notes: string;
      platformIds: string[];
      imageUrl: string;
      barcode: string;
      secondaryBarcodes: string[];
      salePrice: number | '';
      minPrice: number | '';
      purchasePrice: number | '';
      packagingCost: number | '';
      taxRate: number | '';
      pickupFee: number | '';
      enableBnpl: boolean;
      bnplPercentage: number | '';
      stockQuantity: number | '';
      reorderLimit: number | '';
      editReason: string;
      platformCostsState: Record<string, { returnShippingDeduction: number | '' }>;
    }) => {
      return JSON.stringify({
        name: vals.name.trim(),
        printName: vals.printName.trim(),
        categoryId: vals.categoryId,
        sku: vals.sku.trim(),
        unit: vals.unit,
        supplier: vals.supplier.trim(),
        status: vals.status,
        notes: vals.notes.trim(),
        platformIds: [...vals.platformIds].sort(),
        imageUrl: vals.imageUrl.trim(),
        barcode: vals.barcode.trim(),
        secondaryBarcodes: [...vals.secondaryBarcodes],
        salePrice: vals.salePrice === '' ? '' : Number(vals.salePrice),
        minPrice: vals.minPrice === '' ? '' : Number(vals.minPrice),
        purchasePrice: vals.purchasePrice === '' ? '' : Number(vals.purchasePrice),
        packagingCost: vals.packagingCost === '' ? '' : Number(vals.packagingCost),
        taxRate: vals.taxRate === '' ? 0 : Number(vals.taxRate),
        pickupFee: vals.pickupFee === '' ? '' : Number(vals.pickupFee),
        enableBnpl: Boolean(vals.enableBnpl),
        bnplPercentage: vals.bnplPercentage === '' ? 20 : Number(vals.bnplPercentage),
        stockQuantity: vals.stockQuantity === '' ? '' : Number(vals.stockQuantity),
        reorderLimit: vals.reorderLimit === '' ? 5 : Number(vals.reorderLimit),
        editReason: vals.editReason.trim(),
        platformCostsState: Object.keys(vals.platformCostsState)
          .sort()
          .reduce(
            (acc, k) => {
              acc[k] = Number(vals.platformCostsState[k]?.returnShippingDeduction || 0);
              return acc;
            },
            {} as Record<string, number>
          )
      });
    },
    []
  );

  const currentSnapshot = useMemo(
    () =>
      buildSnapshotString({
        name,
        printName,
        categoryId,
        sku,
        unit,
        supplier,
        status,
        notes,
        platformIds,
        imageUrl,
        barcode,
        secondaryBarcodes,
        salePrice,
        minPrice,
        purchasePrice,
        packagingCost,
        taxRate,
        pickupFee,
        enableBnpl,
        bnplPercentage,
        stockQuantity,
        reorderLimit,
        editReason,
        platformCostsState
      }),
    [
      buildSnapshotString,
      name,
      printName,
      categoryId,
      sku,
      unit,
      supplier,
      status,
      notes,
      platformIds,
      imageUrl,
      barcode,
      secondaryBarcodes,
      salePrice,
      minPrice,
      purchasePrice,
      packagingCost,
      taxRate,
      pickupFee,
      enableBnpl,
      bnplPercentage,
      stockQuantity,
      reorderLimit,
      editReason,
      platformCostsState
    ]
  );

  const isDirty = useMemo(() => {
    if (!baselineSnapshot) return false;
    return currentSnapshot !== baselineSnapshot;
  }, [baselineSnapshot, currentSnapshot]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => {
      onDirtyChange?.(false);
    };
  }, [isDirty, onDirtyChange]);

  // تحذير المتصفح عند محاولة إغلاق التبويب مع وجود تعديلات غير محفوظة
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // اعتراض زر الرجوع في المتصفح والموبايل (popstate) إذا كانت هناك تعديلات غير محفوظة
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const currentPath = useMemo(() => {
    if (mode === 'edit' && (currentItem?.id || itemId)) {
      return `/items/${encodeURIComponent(currentItem?.id || itemId || '')}`;
    }
    return '/items/new';
  }, [mode, currentItem?.id, itemId]);

  useEffect(() => {
    const handlePopState = () => {
      if (!isDirtyRef.current) return;
      const nowPath = window.location.pathname;
      if (nowPath !== currentPath) {
        // إعادة العنوان الحالي مؤقتاً وإظهار نافذة التأكيد العربية
        try {
          window.history.pushState({}, '', currentPath);
        } catch {
          // ignore
        }
        setExitConfirmModal({
          open: true,
          onConfirm: () => {
            setExitConfirmModal(null);
            isDirtyRef.current = false;
            onDirtyChange?.(false);
            onBackToList();
          }
        });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentPath, onBackToList, onDirtyChange]);

  const populateFormState = useCallback(
    (targetItem: Item | null) => {
      setErrorMsg(null);
      setSubmitAttempted(false);
      setNameConflict(null);
      setSkuConflict(null);
      setBarcodeConflict(null);
      setSecBarcodeConflict(null);

      const initialPlatformMap: Record<string, { returnShippingDeduction: number | '' }> = {};
      if (targetItem) {
        const initName = targetItem.name || '';
        const initPrintName = targetItem.printName || '';
        let matchedCat = categories.find(c => c.id === targetItem.categoryId);
        if (!matchedCat && targetItem.categoryName) {
          matchedCat = categories.find(c => c.name === targetItem.categoryName);
        }
        const initCatId = matchedCat ? matchedCat.id : targetItem.categoryId || '';
        const initCatName = matchedCat ? matchedCat.name : targetItem.categoryName || '';

        if (matchedCat) {
          if (matchedCat.parentCategoryId) {
            setSelectedRootId(matchedCat.parentCategoryId);
            setSelectedSubId(matchedCat.id);
          } else {
            setSelectedRootId(matchedCat.id);
            setSelectedSubId('');
          }
        } else {
          setSelectedRootId('');
          setSelectedSubId('');
        }

        const initSku = targetItem.sku || '';
        const initUnit = targetItem.unit || 'قطعة';
        const initSupplier = targetItem.supplier || '';
        const initStatus = targetItem.status || 'نشط';
        const initNotes = targetItem.notes || '';
        const initPlatformIds =
          Array.isArray(targetItem.platformIds) && targetItem.platformIds.length > 0
            ? targetItem.platformIds
            : activePlatforms.map(p => p.id);
        const initImg = targetItem.imageUrl || '';
        const initBarcode = targetItem.barcode || '';
        const initSecBarcodes = Array.isArray(targetItem.secondaryBarcodes)
          ? targetItem.secondaryBarcodes
          : [];
        const initSale = targetItem.salePrice ?? '';
        const initMin =
          targetItem.minPrice && targetItem.minPrice > 0 ? targetItem.minPrice : '';
        const initPurchase = targetItem.purchasePrice ?? '';
        const initPackaging = targetItem.packagingCost ?? '';
        const initTax = targetItem.taxRate ?? 0;
        const initPickup =
          targetItem.pickupFee !== undefined && targetItem.pickupFee !== null
            ? targetItem.pickupFee
            : '';
        const initEnableBnpl = Boolean(targetItem.enableBnpl);
        const initBnplPct =
          targetItem.bnplPercentage !== undefined && targetItem.bnplPercentage !== null
            ? targetItem.bnplPercentage
            : 20;
        const initStock = targetItem.stockQuantity ?? '';
        const initReorder = targetItem.reorderLimit ?? 5;

        platforms.forEach(plt => {
          const found = costs.find(
            c => c.itemId === targetItem.id && c.platformId === plt.id
          );
          initialPlatformMap[plt.id] = {
            returnShippingDeduction: found ? found.returnShippingDeduction : 0
          };
        });

        setName(initName);
        setPrintName(initPrintName);
        setCategoryId(initCatId);
        setCategoryName(initCatName);
        setSku(initSku);
        setUnit(initUnit);
        setSupplier(initSupplier);
        setStatus(initStatus);
        setNotes(initNotes);
        setPlatformIds(initPlatformIds);
        setImageUrl(initImg);
        setImagePreview(initImg);
        setBarcode(initBarcode);
        setSecondaryBarcodes(initSecBarcodes);
        setSalePrice(initSale);
        setMinPrice(initMin);
        setPurchasePrice(initPurchase);
        setPackagingCost(initPackaging);
        setTaxRate(initTax);
        setPickupFee(initPickup);
        setEnableBnpl(initEnableBnpl);
        setBnplPercentage(initBnplPct);
        setStockQuantity(initStock);
        setReorderLimit(initReorder);
        setEditReason('');
        setPlatformCostsState(initialPlatformMap);

        setBaselineSnapshot(
          buildSnapshotString({
            name: initName,
            printName: initPrintName,
            categoryId: initCatId,
            sku: initSku,
            unit: initUnit,
            supplier: initSupplier,
            status: initStatus,
            notes: initNotes,
            platformIds: initPlatformIds,
            imageUrl: initImg,
            barcode: initBarcode,
            secondaryBarcodes: initSecBarcodes,
            salePrice: initSale,
            minPrice: initMin,
            purchasePrice: initPurchase,
            packagingCost: initPackaging,
            taxRate: initTax,
            pickupFee: initPickup,
            enableBnpl: initEnableBnpl,
            bnplPercentage: initBnplPct,
            stockQuantity: initStock,
            reorderLimit: initReorder,
            editReason: '',
            platformCostsState: initialPlatformMap
          })
        );
      } else {
        const defaultRoot = rootCategories[0];
        const initCatId = defaultRoot ? defaultRoot.id : '';
        const initCatName = defaultRoot ? defaultRoot.name : '';
        if (defaultRoot) {
          setSelectedRootId(defaultRoot.id);
          setSelectedSubId('');
        } else {
          setSelectedRootId('');
          setSelectedSubId('');
        }
        const initPlatformIds = activePlatforms.map(p => p.id);
        platforms.forEach(plt => {
          initialPlatformMap[plt.id] = {
            returnShippingDeduction: 0
          };
        });

        setName('');
        setPrintName('');
        setCategoryId(initCatId);
        setCategoryName(initCatName);
        setSku('');
        setUnit('قطعة');
        setSupplier('');
        setStatus('نشط');
        setNotes('');
        setPlatformIds(initPlatformIds);
        setImageUrl('');
        setImagePreview('');
        setBarcode('');
        setSecondaryBarcodes([]);
        setSalePrice('');
        setMinPrice('');
        setPurchasePrice('');
        setPackagingCost('');
        setTaxRate(0);
        setPickupFee('');
        setEnableBnpl(false);
        setBnplPercentage(20);
        setStockQuantity('');
        setReorderLimit(5);
        setEditReason('');
        setPlatformCostsState(initialPlatformMap);

        setBaselineSnapshot(
          buildSnapshotString({
            name: '',
            printName: '',
            categoryId: initCatId,
            sku: '',
            unit: 'قطعة',
            supplier: '',
            status: 'نشط',
            notes: '',
            platformIds: initPlatformIds,
            imageUrl: '',
            barcode: '',
            secondaryBarcodes: [],
            salePrice: '',
            minPrice: '',
            purchasePrice: '',
            packagingCost: '',
            taxRate: 0,
            pickupFee: '',
            enableBnpl: false,
            bnplPercentage: 20,
            stockQuantity: '',
            reorderLimit: 5,
            editReason: '',
            platformCostsState: initialPlatformMap
          })
        );
      }
    },
    [categories, rootCategories, activePlatforms, platforms, costs, buildSnapshotString]
  );

  // تهيئة بيانات النموذج عند تغيّر الصنف المستهدف أو الوضع
  const initializedForKeyRef = useRef<string>('');
  useEffect(() => {
    const key = mode === 'new' ? 'NEW' : `EDIT:${currentItem?.id || itemId || ''}:${ Boolean(currentItem) }`;
    if (initializedForKeyRef.current !== key) {
      initializedForKeyRef.current = key;
      setSavedSuccessInfo(null);
      populateFormState(currentItem);
    }
  }, [mode, currentItem, itemId, populateFormState]);

  // تحميل سجل التعديلات والحركات وتوزيع المخازن عند تعديل صنف موجود
  useEffect(() => {
    let active = true;
    if (currentItem?.id) {
      setIsLoadingLogs(true);
      api
        .getItemLogs(currentItem.id)
        .then(res => {
          if (!active) return;
          setChangeLogs(res.changeLogs || []);
          setStockMovements(res.stockMovements || []);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setIsLoadingLogs(false);
        });

      setIsLoadingWarehouses(true);
      api
        .getItemWarehouses(currentItem.id)
        .then(res => {
          if (!active) return;
          if (res.success && Array.isArray(res.warehouses)) {
            setWarehouseBreakdown(res.warehouses);
          } else {
            setWarehouseBreakdown([]);
          }
        })
        .catch(() => {
          if (active) setWarehouseBreakdown([]);
        })
        .finally(() => {
          if (active) setIsLoadingWarehouses(false);
        });
    } else {
      setChangeLogs([]);
      setStockMovements([]);
      setWarehouseBreakdown([]);
    }
    return () => {
      active = false;
    };
  }, [currentItem?.id]);

  // دوال فحص التكرار الفوري
  const findConflictingByName = useCallback(
    (val: string): Item | null => {
      const norm = normalizeText(val);
      if (!norm) return null;
      return (
        existingItems.find(
          it => it.id !== currentItem?.id && normalizeText(it.name) === norm
        ) || null
      );
    },
    [existingItems, currentItem?.id]
  );

  const findConflictingBySku = useCallback(
    (val: string): Item | null => {
      const norm = normalizeText(val);
      if (!norm) return null;
      return (
        existingItems.find(
          it => it.id !== currentItem?.id && normalizeText(it.sku) === norm
        ) || null
      );
    },
    [existingItems, currentItem?.id]
  );

  const findConflictingByBarcode = useCallback(
    (val: string): Item | null => {
      const clean = (val || '').trim();
      if (!clean) return null;
      return (
        existingItems.find(it => {
          if (it.id === currentItem?.id) return false;
          if ((it.barcode || '').trim() === clean) return true;
          if (
            Array.isArray(it.secondaryBarcodes) &&
            it.secondaryBarcodes.some(sb => (sb || '').trim() === clean)
          ) {
            return true;
          }
          return false;
        }) || null
      );
    },
    [existingItems, currentItem?.id]
  );

  const handleBlurName = () => {
    setNameConflict(findConflictingByName(name));
  };

  const handleBlurSku = () => {
    setSkuConflict(findConflictingBySku(sku));
  };

  const handleBlurBarcode = (valToTest?: string) => {
    const target = valToTest !== undefined ? valToTest : barcode;
    setBarcodeConflict(findConflictingByBarcode(target));
  };

  const handleBlurSecondaryBarcode = () => {
    setSecBarcodeConflict(findConflictingByBarcode(newSecondaryBarcode));
  };

  const requestExitWithConfirm = (action: () => void) => {
    if (isDirty) {
      setExitConfirmModal({
        open: true,
        onConfirm: () => {
          setExitConfirmModal(null);
          isDirtyRef.current = false;
          onDirtyChange?.(false);
          action();
        }
      });
    } else {
      action();
    }
  };

  const handleOpenConflictingItem = (conflictItem: Item) => {
    requestExitWithConfirm(() => {
      initializedForKeyRef.current = '';
      onNavigateItemRoute(`/items/${encodeURIComponent(conflictItem.id)}`, conflictItem);
    });
  };

  // حسابات التسعير والربحية الفورية
  const numSale = Number(salePrice) || 0;
  const numPurchase = Number(purchasePrice) || 0;
  const numPackaging = Number(packagingCost) || 0;
  const totalCost = numPurchase + numPackaging;
  const expectedProfit = numSale - totalCost;
  const profitMarginPercent =
    numSale > 0 ? ((expectedProfit / numSale) * 100).toFixed(1) : '0.0';

  const originalStockQuantity = currentItem ? Number(currentItem.stockQuantity || 0) : 0;

  // حساب وجود أخطاء في كل قسم لعرض العلامة الحمراء على شريط الأقسام الثابت
  const sectionErrors = useMemo<Record<SectionId, boolean>>(() => {
    const basicErr =
      Boolean(nameConflict) ||
      Boolean(skuConflict) ||
      (submitAttempted && !name.trim());
    const codesErr = Boolean(barcodeConflict) || Boolean(secBarcodeConflict);
    const pricingErr =
      Number(salePrice || 0) < 0 ||
      Number(purchasePrice || 0) < 0 ||
      Number(packagingCost || 0) < 0 ||
      (submitAttempted && salePrice === '') ||
      (Number(minPrice || 0) > 0 && Number(minPrice || 0) > Number(salePrice || 0));
    const stockErr =
      Number(stockQuantity || 0) < 0 ||
      (submitAttempted && stockQuantity === '') ||
      Boolean(
        currentItem &&
          Number(stockQuantity || 0) !== originalStockQuantity &&
          !editReason.trim() &&
          submitAttempted
      );
    const platformsErr = platformsEnabled && Object.values(platformCostsState).some(
      c => Number(c.returnShippingDeduction || 0) < 0
    );
    return {
      BASIC: basicErr,
      CODES: codesErr,
      PRICING: pricingErr,
      STOCK: stockErr,
      PLATFORMS: platformsErr,
      LOGS: false
    };
  }, [
    nameConflict,
    skuConflict,
    submitAttempted,
    name,
    barcodeConflict,
    secBarcodeConflict,
    salePrice,
    purchasePrice,
    packagingCost,
    minPrice,
    stockQuantity,
    currentItem,
    originalStockQuantity,
    editReason,
    platformCostsState,
    platformsEnabled
  ]);

  const sectionsList = useMemo(() => {
    const base: Array<{
      id: SectionId;
      label: string;
      hasError: boolean;
    }> = [
      { id: 'BASIC', label: 'البيانات الأساسية', hasError: sectionErrors.BASIC },
      { id: 'CODES', label: 'الأكواد والباركود', hasError: sectionErrors.CODES },
      { id: 'PRICING', label: 'الأسعار والتكاليف', hasError: sectionErrors.PRICING },
      { id: 'STOCK', label: 'المخزون والتنبيهات', hasError: sectionErrors.STOCK },
      ...(platformsEnabled
        ? [{ id: 'PLATFORMS' as SectionId, label: 'تكاليف المنصات', hasError: sectionErrors.PLATFORMS }]
        : [])
    ];
    if (currentItem) {
      base.push({
        id: 'LOGS',
        label: 'سجل الحركة والتعديلات',
        hasError: false
      });
    }
    return base;
  }, [sectionErrors, currentItem, platformsEnabled]);

  useEffect(() => {
    const checkHeight = () => {
      const formEl = formContainerRef.current;
      if (!formEl || typeof window === 'undefined') return;
      const isLongPage = formEl.scrollHeight > window.innerHeight * 2;
      setShowSectionNav(prev => (prev !== isLongPage ? isLongPage : prev));
    };

    checkHeight();
    window.addEventListener('resize', checkHeight);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && formContainerRef.current) {
      observer = new ResizeObserver(checkHeight);
      observer.observe(formContainerRef.current);
    }
    return () => {
      window.removeEventListener('resize', checkHeight);
      observer?.disconnect();
    };
  }, [currentItem, enableBnpl, changeLogs.length, stockMovements.length, warehouseBreakdown.length]);

  const scrollToSection = useCallback((sectionId: SectionId) => {
    const el = sectionRefs.current[sectionId];
    if (!el) return;
    setActiveSection(sectionId);
    isProgrammaticScrollRef.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 550);
  }, []);

  // تمييز القسم الحالي تلقائياً أثناء التمرير في الصفحة عند ظهور شريط الأقسام
  useEffect(() => {
    if (!showSectionNav) return;
    const handleScroll = () => {
      if (isProgrammaticScrollRef.current) return;
      const orderedIds: SectionId[] = [
        'BASIC',
        'CODES',
        'PRICING',
        'STOCK',
        ...(platformsEnabled ? (['PLATFORMS'] as SectionId[]) : []),
        ...(currentItem ? (['LOGS'] as SectionId[]) : [])
      ];
      let currentActive: SectionId = 'BASIC';
      const threshold = 160;
      for (const id of orderedIds) {
        const el = sectionRefs.current[id];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (toLayoutPx(rect.top) <= threshold) {
          currentActive = id;
        }
      }
      setActiveSection(prev => (prev !== currentActive ? currentActive : prev));
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [currentItem, showSectionNav, platformsEnabled]);

  // توليد باركود EAN-13
  const handleGenerateBarcode = () => {
    const allCodes = new Set<string>();
    existingItems.forEach(it => {
      if (it.barcode) allCodes.add(it.barcode);
      if (Array.isArray(it.secondaryBarcodes)) {
        it.secondaryBarcodes.forEach(sb => allCodes.add(sb));
      }
    });
    const newCode = generateValidEAN13(allCodes);
    setBarcode(newCode);
    setBarcodeConflict(null);
  };

  const handleCopyBarcode = () => {
    if (!barcode) return;
    navigator.clipboard.writeText(barcode);
    setCopiedBarcode(true);
    setTimeout(() => setCopiedBarcode(false), 1800);
  };

  const handleAddSecondaryBarcode = () => {
    const trimmed = newSecondaryBarcode.trim();
    if (!trimmed) return;
    if (trimmed === barcode.trim() || secondaryBarcodes.includes(trimmed)) {
      setErrorMsg('هذا الباركود مضاف بالفعل لنفس الصنف');
      return;
    }
    const conflict = findConflictingByBarcode(trimmed);
    if (conflict) {
      setSecBarcodeConflict(conflict);
      return;
    }
    setSecondaryBarcodes(prev => [...prev, trimmed]);
    setNewSecondaryBarcode('');
    setSecBarcodeConflict(null);
    setErrorMsg(null);
  };

  const handleRemoveSecondaryBarcode = (index: number) => {
    setSecondaryBarcodes(prev => prev.filter((_, i) => i !== index));
  };

  const togglePlatformAvailability = (pltId: string) => {
    setPlatformIds(prev =>
      prev.includes(pltId) ? prev.filter(id => id !== pltId) : [...prev, pltId]
    );
  };

  // معالجة رفع وضغط الصورة
  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!file.type.startsWith('image/')) {
      setErrorMsg('يرجى اختيار ملف صورة صالح (JPG, PNG, WebP)');
      return;
    }

    setIsUploadingImage(true);
    setImageUploadStatus('جاري تجهيز وضغط الصورة...');
    setErrorMsg(null);

    try {
      const compressedDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 700;
            let width = img.width;
            let height = img.height;

            if (width > height && width > MAX_SIZE) {
              height = Math.round((height * MAX_SIZE) / width);
              width = MAX_SIZE;
            } else if (height > MAX_SIZE) {
              width = Math.round((width * MAX_SIZE) / height);
              height = MAX_SIZE;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('فشل معالجة الصورة'));
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          };
          img.onerror = () => reject(new Error('فشل قراءة ملف الصورة'));
          img.src = event.target?.result as string;
        };
        reader.onerror = () => reject(new Error('فشل قراءة الملف'));
        reader.readAsDataURL(file);
      });

      setImagePreview(compressedDataUrl);
      setImageUploadStatus('جاري رفع الصورة إلى السيرفر...');

      const uploadRes = await api.uploadImage({
        imageBase64: compressedDataUrl,
        fileName: `item_${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        folder: 'items'
      });

      if (uploadRes.success && uploadRes.url) {
        setImageUrl(uploadRes.url);
        setImageUploadStatus('تم رفع الصورة بنجاح');
      } else {
        setImageUrl(compressedDataUrl);
        setImageUploadStatus('تم حفظ الصورة محلياً');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء رفع الصورة');
    } finally {
      setIsUploadingImage(false);
      setTimeout(() => setImageUploadStatus(null), 2500);
    }
  };

  const handleRemoveImage = () => {
    setImageUrl('');
    setImagePreview('');
  };

  const hasDuplicateConflict = Boolean(
    nameConflict || skuConflict || barcodeConflict || secBarcodeConflict
  );

  // إرسال وحفظ كل الأقسام في طلب واحد
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    setErrorMsg(null);
    setSavedSuccessInfo(null);

    const nConf = findConflictingByName(name);
    const sConf = findConflictingBySku(sku);
    const bConf = findConflictingByBarcode(barcode);

    setNameConflict(nConf);
    setSkuConflict(sConf);
    setBarcodeConflict(bConf);

    if (!name.trim()) {
      setErrorMsg('اسم الصنف حقل إلزامي لا يمكن تركه فارغاً');
      scrollToSection('BASIC');
      return;
    }

    if (nConf || sConf) {
      setErrorMsg('يوجد تعارض في البيانات الأساسية مع صنف مسجل بالفعل.');
      scrollToSection('BASIC');
      return;
    }

    if (bConf || secBarcodeConflict) {
      setErrorMsg('يوجد تعارض في الباركود مع صنف مسجل بالفعل.');
      scrollToSection('CODES');
      return;
    }

    if (salePrice === '' || Number(salePrice) < 0) {
      setErrorMsg('يرجى إدخال سعر بيع صحيح (0 أو أكثر)');
      scrollToSection('PRICING');
      return;
    }

    if (Number(minPrice || 0) > 0 && Number(minPrice || 0) > Number(salePrice || 0)) {
      setErrorMsg('الحد الأدنى لسعر البيع لا يمكن أن يكون أكبر من سعر البيع الرسمي');
      scrollToSection('PRICING');
      return;
    }

    if (Number(purchasePrice || 0) < 0 || Number(packagingCost || 0) < 0) {
      setErrorMsg('تكاليف الشراء والتغليف لا يمكن أن تكون بالسالب');
      scrollToSection('PRICING');
      return;
    }

    if (stockQuantity === '' || Number(stockQuantity) < 0) {
      setErrorMsg('يرجى إدخال كمية مخزون صحيحة (0 أو أكثر)');
      scrollToSection('STOCK');
      return;
    }

    const stockChanged =
      currentItem && Number(stockQuantity) !== Number(currentItem.stockQuantity || 0);
    if (stockChanged && !editReason.trim()) {
      setErrorMsg('عند تعديل رصيد المخزون يدوياً، يجب كتابة سبب التسوية أو التعديل');
      scrollToSection('STOCK');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedCat = categories.find(c => c.id === categoryId);
      const finalItem: Partial<Item> & { name: string; editReason?: string } = {
        id: currentItem?.id,
        sku: sku.trim() || undefined,
        barcode: barcode.trim() || undefined,
        secondaryBarcodes,
        name: name.trim(),
        printName: printName.trim().slice(0, 120),
        categoryId: categoryId || '',
        categoryName: selectedCat ? selectedCat.name : categoryName.trim() || 'عام',
        unit: unit.trim() || 'قطعة',
        salePrice: Number(salePrice) || 0,
        minPrice: minPrice === '' ? 0 : Number(minPrice),
        purchasePrice: canViewPurchase
          ? Number(purchasePrice) || 0
          : (currentItem?.purchasePrice ?? 0),
        packagingCost: isManager
          ? Number(packagingCost) || 0
          : (currentItem?.packagingCost ?? 0),
        taxRate: Number(taxRate) || 0,
        pickupFee:
          pickupFee === '' ? undefined : Math.max(0, Number(pickupFee) || 0),
        enableBnpl: Boolean(enableBnpl),
        bnplPercentage: enableBnpl
          ? Math.min(100, Math.max(0, Number(bnplPercentage) || 0))
          : 20,
        stockQuantity: Number(stockQuantity) || 0,
        reorderLimit: Number(reorderLimit) || 0,
        supplier: supplier.trim(),
        status,
        imageUrl: imageUrl.trim() || undefined,
        notes: notes.trim(),
        platformIds,
        editReason: editReason.trim() || undefined
      };

      const platformCostsToSave: ItemPlatformCost[] = platformsEnabled
        ? platforms.map(plt => {
            const st = platformCostsState[plt.id];
            return {
              itemId: currentItem?.id || '',
              platformId: plt.id,
              returnShippingDeduction: Number(st?.returnShippingDeduction) || 0
            };
          })
        : [];

      const savedItem = await onSave(finalItem, platformCostsToSave);
      const wasEdit = Boolean(currentItem);
      setCurrentItem(savedItem);
      setEditReason('');
      setSubmitAttempted(false);

      // تحديث البصمة المرجعية حتى تصبح التعديلات محفوظة (isDirty = false)
      setBaselineSnapshot(
        buildSnapshotString({
          name: savedItem.name || name,
          printName: savedItem.printName !== undefined ? savedItem.printName : printName,
          categoryId: savedItem.categoryId || categoryId,
          sku: savedItem.sku || sku,
          unit: savedItem.unit || unit,
          supplier: savedItem.supplier || supplier,
          status: savedItem.status || status,
          notes: savedItem.notes || notes,
          platformIds: savedItem.platformIds || platformIds,
          imageUrl: savedItem.imageUrl || imageUrl,
          barcode: savedItem.barcode || barcode,
          secondaryBarcodes: savedItem.secondaryBarcodes || secondaryBarcodes,
          salePrice: savedItem.salePrice ?? salePrice,
          minPrice: savedItem.minPrice && savedItem.minPrice > 0 ? savedItem.minPrice : '',
          purchasePrice: savedItem.purchasePrice ?? purchasePrice,
          packagingCost: savedItem.packagingCost ?? packagingCost,
          taxRate: savedItem.taxRate ?? taxRate,
          pickupFee:
            savedItem.pickupFee !== undefined && savedItem.pickupFee !== null
              ? savedItem.pickupFee
              : '',
          enableBnpl: Boolean(savedItem.enableBnpl),
          bnplPercentage: savedItem.bnplPercentage ?? bnplPercentage,
          stockQuantity: savedItem.stockQuantity ?? stockQuantity,
          reorderLimit: savedItem.reorderLimit ?? reorderLimit,
          editReason: '',
          platformCostsState
        })
      );

      setSavedSuccessInfo({
        mode: wasEdit ? 'edit' : 'new',
        itemName: savedItem.name || name.trim(),
        itemCode: savedItem.sku || savedItem.id || ''
      });

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء حفظ الصنف');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartFreshNewItem = () => {
    setSavedSuccessInfo(null);
    setCurrentItem(null);
    initializedForKeyRef.current = 'NEW';
    populateFormState(null);
    onNavigateItemRoute('/items/new');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useModalShortcuts({
    isOpen: Boolean(exitConfirmModal?.open),
    onClose: () => setExitConfirmModal(null)
  });

  useRegisterShortcuts({
    'general.save_form': () => {
      if (isSubmitting || hasDuplicateConflict) return;
      if (formContainerRef.current) {
        formContainerRef.current.requestSubmit();
      }
    },
    'general.close_or_back': () => {
      if (isPlatformsOpen) {
        setIsPlatformsOpen(false);
        return;
      }
      if (!isSubmitting) {
        requestExitWithConfirm(onBackToList);
      }
    }
  });

  if (mode === 'edit' && isFetchingItem) {
    return (
      <PageSurface dir="rtl" title="بطاقة الصنف">
        <div className="py-12 flex flex-col items-center justify-center gap-3 text-[var(--text-secondary)]">
          <Loader2 className="w-7 h-7 animate-spin ui-link" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">جاري تحميل بيانات الصنف...</p>
        </div>
      </PageSurface>
    );
  }

  if (mode === 'edit' && fetchItemError && !currentItem) {
    return (
      <PageSurface dir="rtl" title="تعذر فتح بطاقة الصنف">
        <div className="py-8 flex flex-col items-start gap-4">
          <div className="flex items-center gap-2 ui-stock-out text-xs sm:text-sm font-semibold">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{fetchItemError}</span>
          </div>
          <a
            href={getHrefForTarget('items')}
            onClick={(e) => {
              if (!isPlainLeftClick(e)) return;
              e.preventDefault();
              onBackToList();
            }}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>رجوع للأصناف</span>
          </a>
        </div>
      </PageSurface>
    );
  }

  const selectedPlatformsLabel =
    platformIds.length === 0
      ? 'لا توجد منصات محددة'
      : platformIds.length === activePlatforms.length && activePlatforms.length > 0
      ? `جميع المنصات (${activePlatforms.length})`
      : `${platformIds.length} من ${activePlatforms.length} منصة`;

  return (
    <PageSurface
      dir="rtl"
      title={currentItem ? `تعديل بيانات الصنف: ${currentItem.name}` : 'إضافة صنف جديد'}
      subtitle={
        currentItem
          ? `كود الصنف: ${currentItem.sku || currentItem.id} • الرصيد الحالي: ${currentItem.stockQuantity} ${currentItem.unit}`
          : 'أدخل بيانات الصنف والباركود والتسعير والمخزون في صفحة واحدة'
      }
      actions={
        <>
          {isDirty && (
            <span className="text-xs font-semibold ui-stock-low whitespace-nowrap">
              تعديلات غير محفوظة
            </span>
          )}
          <a
            href={getHrefForTarget('items')}
            onClick={(e) => {
              if (!isPlainLeftClick(e)) return;
              e.preventDefault();
              requestExitWithConfirm(onBackToList);
            }}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] transition cursor-pointer"
            title="رجوع للأصناف"
          >
            <ArrowRight className="w-4 h-4" />
            <span>رجوع للأصناف</span>
          </a>
        </>
      }
    >
      {/* شريط الأقسام العلوي يظهر فقط إذا كانت الصفحة أطول من شاشتين */}
      {showSectionNav && (
        <nav
          aria-label="أقسام بطاقة الصنف"
          className="sticky top-0 z-30 bg-[var(--surface)] border-b border-[var(--border-subtle)] py-2 flex items-center gap-2 overflow-x-auto"
        >
          {sectionsList.map(sec => {
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => scrollToSection(sec.id)}
                className={`min-h-[44px] px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer border ${
                  isActive
                    ? 'bg-[#1668B2] border-[#1668B2] text-white'
                    : sec.hasError
                    ? 'border-[var(--stock-out)] ui-stock-out bg-transparent'
                    : 'border-[var(--border-color)] text-[var(--text-primary)] bg-transparent hover:bg-[var(--surface-subtle)]'
                }`}
              >
                <span>{sec.label}</span>
                {sec.hasError && !isActive && <span className="mr-1">*</span>}
              </button>
            );
          })}
        </nav>
      )}

      {/* رسالة النجاح بعد الحفظ */}
      {savedSuccessInfo && (
        <div
          role="status"
          className="px-3.5 py-2.5 border-s-2 border-[var(--money-purchase)] flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 ui-money-purchase shrink-0" />
            <div className="text-xs sm:text-sm">
              <strong className="text-[var(--text-primary)]">
                {savedSuccessInfo.mode === 'new'
                  ? 'تمت إضافة الصنف بنجاح'
                  : 'تم حفظ تعديلات الصنف بنجاح'}
              </strong>
              <span className="text-[var(--text-secondary)] mr-2">
                ({savedSuccessInfo.itemName}
                {savedSuccessInfo.itemCode ? ` — ${savedSuccessInfo.itemCode}` : ''})
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={getHrefForItemRoute('new')}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return;
                e.preventDefault();
                handleStartFreshNewItem();
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>صنف جديد</span>
            </a>
            <a
              href={getHrefForTarget('items')}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return;
                e.preventDefault();
                onBackToList();
              }}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#157347] hover:bg-[#115C38] text-white text-xs font-bold transition cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>رجوع للأصناف</span>
            </a>
          </div>
        </div>
      )}

      {/* رسائل الخطأ العامة */}
      {errorMsg && (
        <div
          role="alert"
          className="px-3.5 py-2.5 border-s-2 border-[var(--stock-out)] ui-stock-out text-xs font-bold flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form ref={formContainerRef} onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* 1) البيانات الأساسية */}
        <section
          id="section-basic"
          ref={el => {
            sectionRefs.current.BASIC = el;
          }}
          className="space-y-5 scroll-mt-16"
        >
          <SectionHeading
            title="البيانات الأساسية"
            actions={
              sectionErrors.BASIC ? (
                <span className="text-xs font-semibold ui-stock-out">يوجد خطأ في القسم</span>
              ) : undefined
            }
          />

          {/* صورة المنتج 96px بدون بطاقة حولها */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative w-24 h-24 shrink-0">
              {imagePreview ? (
                <>
                  <img
                    src={imagePreview}
                    alt="صورة الصنف"
                    className="w-24 h-24 rounded-lg object-cover border border-[var(--border-color)] bg-[var(--surface)]"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    aria-label="حذف الصورة"
                    title="حذف الصورة"
                    className="absolute -top-2 -left-2 w-7 h-7 rounded-full bg-[#B42318] hover:bg-[#912018] text-white flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <div className="w-24 h-24 rounded-lg border border-dashed border-[var(--border-color)] flex flex-col items-center justify-center text-[var(--text-secondary)]">
                  <ImageIcon className="w-6 h-6 opacity-60" />
                  <span className="text-[11px] mt-1">بدون صورة</span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  ref={galleryInputRef}
                  accept="image/*"
                  onChange={handleImageFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={isUploadingImage}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold text-[var(--text-primary)] transition cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-[var(--text-secondary)]" />
                  <span>{imagePreview ? 'تغيير الصورة' : 'اختيار صورة'}</span>
                </button>

                <input
                  type="file"
                  ref={cameraInputRef}
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={isUploadingImage}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text-primary)] transition cursor-pointer"
                >
                  <Camera className="w-4 h-4 text-[var(--text-secondary)]" />
                  <span>كاميرا</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold ui-link hover:underline cursor-pointer"
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>رابط خارجي</span>
                </button>
              </div>

              {imageUploadStatus && (
                <div className="text-xs ui-link flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{imageUploadStatus}</span>
                </div>
              )}

              {showUrlInput && (
                <input
                  type="url"
                  dir="ltr"
                  value={imageUrl}
                  onChange={e => {
                    setImageUrl(e.target.value);
                    setImagePreview(e.target.value);
                  }}
                  placeholder="https://example.com/image.jpg"
                  aria-label="رابط صورة المنتج"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} text-xs font-mono`}
                />
              )}
            </div>
          </div>

          {/* الحقول في شبكة واحدة متصلة بعروض حسب نوع البيانات */}
          <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
            {/* اسم الصنف (360px) */}
            <div className="max-w-full">
              <label htmlFor="item-name-input" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                اسم الصنف التجاري <span className="ui-stock-out">*</span>
              </label>
              <input
                id="item-name-input"
                type="text"
                required
                value={name}
                onChange={e => {
                  setName(e.target.value);
                  if (nameConflict) setNameConflict(null);
                }}
                onBlur={handleBlurName}
                placeholder="مثال: سماعة بلوتوث لاسلكية موديل Pro..."
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name} font-bold ${
                  nameConflict || (submitAttempted && !name.trim()) ? 'border-[var(--stock-out)]' : ''
                }`}
              />
              {submitAttempted && !name.trim() && (
                <p className="mt-1 text-xs font-semibold ui-stock-out">
                  اسم الصنف حقل إلزامي لا يمكن تركه فارغاً
                </p>
              )}
              {nameConflict && (
                <div className="mt-1 text-xs font-semibold ui-stock-out flex flex-wrap items-center gap-2">
                  <span>
                    مسجل للصنف: ({nameConflict.name} - {nameConflict.sku || nameConflict.id})
                  </span>
                  <a
                    href={getHrefForItemRoute('edit', nameConflict.id)}
                    onClick={(e) => {
                      if (!isPlainLeftClick(e)) return;
                      e.preventDefault();
                      handleOpenConflictingItem(nameConflict);
                    }}
                    className="underline font-bold cursor-pointer"
                  >
                    فتح الصنف الموجود
                  </a>
                </div>
              )}

              {/* اسم الطباعة (تحت اسم الصنف مباشرة) */}
              <div className="mt-3">
                <label htmlFor="item-print-name-input" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                  اسم الطباعة
                </label>
                <input
                  id="item-print-name-input"
                  type="text"
                  maxLength={120}
                  value={printName}
                  onChange={e => setPrintName(e.target.value.slice(0, 120))}
                  placeholder="مثال: سماعة بلوتوث لاسلكية"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.name}`}
                />
                <p className="mt-1 text-[11px] font-medium text-[var(--text-secondary)]">
                  الاسم اللي بيظهر للعميل في الفاتورة المطبوعة. لو سبته فاضي هيتطبع اسم الصنف
                </p>
              </div>
            </div>

            {/* التصنيف الأساسي والفرعي (220px) */}
            <div className="max-w-full">
              <label htmlFor="item-category-root" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                التصنيف الأساسي <span className="ui-stock-out">*</span>
              </label>
              {activeCategories.length > 0 ? (
                <div className="flex flex-wrap items-start gap-3">
                  <select
                    id="item-category-root"
                    value={selectedRootId}
                    onChange={e => {
                      const newRootId = e.target.value;
                      setSelectedRootId(newRootId);
                      setSelectedSubId('');
                      const rootCat = activeCategories.find(c => c.id === newRootId);
                      setCategoryId(newRootId);
                      setCategoryName(rootCat ? rootCat.name : '');
                    }}
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs sm:text-sm font-semibold`}
                  >
                    <option value="">-- بدون تصنيف --</option>
                    {rootCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>

                  {subCategoriesForSelectedRoot.length > 0 && (
                    <select
                      id="item-category-sub"
                      aria-label="التصنيف الفرعي (اختياري)"
                      value={selectedSubId}
                      onChange={e => {
                        const newSubId = e.target.value;
                        setSelectedSubId(newSubId);
                        if (newSubId) {
                          const subCat = activeCategories.find(c => c.id === newSubId);
                          setCategoryId(newSubId);
                          setCategoryName(subCat ? subCat.name : '');
                        } else {
                          const rootCat = activeCategories.find(c => c.id === selectedRootId);
                          setCategoryId(selectedRootId);
                          setCategoryName(rootCat ? rootCat.name : '');
                        }
                      }}
                      className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs sm:text-sm font-semibold`}
                    >
                      <option value="">-- التصنيف الفرعي (اختياري) --</option>
                      {subCategoriesForSelectedRoot.map(sub => (
                        <option key={sub.id} value={sub.id}>
                          {sub.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <input
                  id="item-category-root"
                  type="text"
                  value={categoryName}
                  onChange={e => setCategoryName(e.target.value)}
                  placeholder="مثال: إلكترونيات، إكسسوارات..."
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} font-semibold`}
                />
              )}
            </div>

            {/* كود الصنف الداخلي SKU (220px) */}
            <div className="max-w-full">
              <label htmlFor="item-sku-input" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                كود الصنف الداخلي (SKU)
              </label>
              <input
                id="item-sku-input"
                type="text"
                value={sku}
                onChange={e => {
                  setSku(e.target.value);
                  if (skuConflict) setSkuConflict(null);
                }}
                onBlur={handleBlurSku}
                placeholder="تلقائي إن تُرك فارغاً"
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} font-mono text-xs sm:text-sm ${
                  skuConflict ? 'border-[var(--stock-out)]' : ''
                }`}
              />
              {skuConflict && (
                <div className="mt-1 text-xs font-semibold ui-stock-out flex flex-wrap items-center gap-1.5">
                  <span>مسجل للصنف ({skuConflict.name})</span>
                  <a
                    href={getHrefForItemRoute('edit', skuConflict.id)}
                    onClick={(e) => {
                      if (!isPlainLeftClick(e)) return;
                      e.preventDefault();
                      handleOpenConflictingItem(skuConflict);
                    }}
                    className="underline font-bold cursor-pointer"
                  >
                    فتح الصنف الموجود
                  </a>
                </div>
              )}
            </div>

            {/* وحدة القياس (120px) */}
            <div className="max-w-full">
              <label htmlFor="item-unit-select" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                وحدة القياس
              </label>
              <select
                id="item-unit-select"
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} font-semibold`}
              >
                {ITEM_UNITS.map(u => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            {/* اسم المورد (220px) */}
            <div className="max-w-full">
              <label htmlFor="item-supplier-input" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                اسم المورد
              </label>
              <input
                id="item-supplier-input"
                type="text"
                value={supplier}
                onChange={e => setSupplier(e.target.value)}
                placeholder="اختياري..."
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code}`}
              />
            </div>

            {/* حالة الصنف (160px) */}
            <div className="max-w-full">
              <label htmlFor="item-status-select" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                حالة الصنف
              </label>
              <select
                id="item-status-select"
                value={status}
                onChange={e => setStatus(e.target.value as Item['status'])}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} font-semibold`}
              >
                <option value="نشط">نشط (متاح للبيع)</option>
                <option value="موقوف">غير نشط (موقوف)</option>
                <option value="مؤرشف">مؤرشف</option>
              </select>
            </div>

            {/* قائمة اختيار متعددة مضغوطة للمنصات (220px) */}
            {platformsEnabled && (
            <div ref={platformsDropdownRef} className="relative max-w-full">
              <label className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                المنصات المتاحة
              </label>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isPlatformsOpen}
                aria-label="المنصات المتاح عليها الصنف"
                onClick={() => setIsPlatformsOpen(prev => !prev)}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} flex items-center justify-between gap-2 text-xs sm:text-sm font-semibold cursor-pointer`}
              >
                <span className="truncate">{selectedPlatformsLabel}</span>
                <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] shrink-0 transition-transform ${isPlatformsOpen ? 'rotate-180' : ''}`} />
              </button>

              {isPlatformsOpen && (
                <div
                  role="listbox"
                  aria-multiselectable="true"
                  className="absolute z-40 mt-1 w-[260px] max-w-[calc(90vw/var(--app-zoom,1))] rounded-lg border border-[var(--border-color)] bg-[var(--surface)] p-2 space-y-1"
                >
                  <div className="flex items-center justify-between px-1.5 pb-1.5 border-b border-[var(--border-subtle)] text-xs">
                    <button
                      type="button"
                      onClick={() => setPlatformIds(activePlatforms.map(p => p.id))}
                      className="ui-link hover:underline font-bold cursor-pointer min-h-[32px] px-1"
                    >
                      تحديد الكل
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlatformIds([])}
                      className="text-[var(--text-secondary)] hover:underline font-semibold cursor-pointer min-h-[32px] px-1"
                    >
                      إلغاء الكل
                    </button>
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-[var(--border-subtle)]">
                    {activePlatforms.length === 0 ? (
                      <div className="py-2 px-2 text-xs text-[var(--text-secondary)]">
                        لا توجد منصات نشطة
                      </div>
                    ) : (
                      activePlatforms.map(plt => {
                        const isSelected = platformIds.includes(plt.id);
                        return (
                          <label
                            key={plt.id}
                            className="flex items-center gap-2 min-h-[44px] px-2 cursor-pointer text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] rounded"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => togglePlatformAvailability(plt.id)}
                              className="w-4 h-4 rounded border-[var(--input-border)] cursor-pointer"
                            />
                            <span className="flex-1 truncate">{plt.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* ملاحظات ومواصفات إضافية (480px) */}
            <div className="max-w-full">
              <label htmlFor="item-notes-input" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                ملاحظات ومواصفات إضافية
              </label>
              <textarea
                id="item-notes-input"
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="ملاحظات الصنف أو وصف فني أو شروط الضمان..."
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs sm:text-sm`}
              />
            </div>
          </div>
        </section>

        {/* 2) الأكواد والباركود */}
        <section
          id="section-codes"
          ref={el => {
            sectionRefs.current.CODES = el;
          }}
          className="space-y-5 scroll-mt-16"
        >
          <SectionHeading
            title="الأكواد والباركود"
            withTopDivider
            actions={
              sectionErrors.CODES ? (
                <span className="text-xs font-semibold ui-stock-out">تعارض في الباركود</span>
              ) : undefined
            }
          />

          <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
            {/* الباركود الأساسي (220px) */}
            <div className="max-w-full">
              <label htmlFor="item-barcode-input" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                الباركود الأساسي
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="item-barcode-input"
                  type="text"
                  dir="ltr"
                  value={barcode}
                  onChange={e => {
                    setBarcode(e.target.value);
                    if (barcodeConflict) setBarcodeConflict(null);
                  }}
                  onBlur={() => handleBlurBarcode()}
                  placeholder="امسح أو اكتب الباركود"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} font-mono font-bold text-xs sm:text-sm ${
                    barcodeConflict ? 'border-[var(--stock-out)]' : ''
                  }`}
                />

                <button
                  type="button"
                  onClick={handleGenerateBarcode}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-link text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>توليد تلقائي</span>
                </button>

                {barcode && (
                  <button
                    type="button"
                    onClick={handleCopyBarcode}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer whitespace-nowrap"
                    title="نسخ الباركود"
                  >
                    {copiedBarcode ? (
                      <Check className="w-3.5 h-3.5 ui-money-purchase" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                    )}
                    <span>{copiedBarcode ? 'تم النسخ' : 'نسخ'}</span>
                  </button>
                )}
              </div>
              {barcodeConflict && (
                <div className="mt-1 text-xs font-semibold ui-stock-out flex flex-wrap items-center gap-2">
                  <span>
                    مسجل للصنف: ({barcodeConflict.name} - {barcodeConflict.sku || barcodeConflict.id})
                  </span>
                  <a
                    href={getHrefForItemRoute('edit', barcodeConflict.id)}
                    onClick={(e) => {
                      if (!isPlainLeftClick(e)) return;
                      e.preventDefault();
                      handleOpenConflictingItem(barcodeConflict);
                    }}
                    className="underline font-bold cursor-pointer"
                  >
                    فتح الصنف الموجود
                  </a>
                </div>
              )}
            </div>

            {/* إضافة باركود فرعي بديل (220px) */}
            <div className="max-w-full">
              <label htmlFor="item-secondary-barcode-input" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                إضافة باركود إضافي
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="item-secondary-barcode-input"
                  type="text"
                  dir="ltr"
                  value={newSecondaryBarcode}
                  onChange={e => {
                    setNewSecondaryBarcode(e.target.value);
                    if (secBarcodeConflict) setSecBarcodeConflict(null);
                  }}
                  onBlur={handleBlurSecondaryBarcode}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSecondaryBarcode();
                    }
                  }}
                  placeholder="باركود بديل إضافي"
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} font-mono text-xs sm:text-sm ${
                    secBarcodeConflict ? 'border-[var(--stock-out)]' : ''
                  }`}
                />
                <button
                  type="button"
                  onClick={handleAddSecondaryBarcode}
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة كود</span>
                </button>
              </div>
              {secBarcodeConflict && (
                <div className="mt-1 text-xs font-semibold ui-stock-out flex flex-wrap items-center gap-2">
                  <span>
                    مسجل للصنف: ({secBarcodeConflict.name} - {secBarcodeConflict.sku || secBarcodeConflict.id})
                  </span>
                  <a
                    href={getHrefForItemRoute('edit', secBarcodeConflict.id)}
                    onClick={(e) => {
                      if (!isPlainLeftClick(e)) return;
                      e.preventDefault();
                      handleOpenConflictingItem(secBarcodeConflict);
                    }}
                    className="underline font-bold cursor-pointer"
                  >
                    فتح الصنف الموجود
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* جدول الباركودات الإضافية على قدر بياناته (CompactTable) */}
          {secondaryBarcodes.length > 0 && (
            <CompactTable ariaLabel="الباركودات الإضافية">
              <thead>
                <tr>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>م</th>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الباركود الإضافي</th>
                  <th className="text-center whitespace-nowrap">حذف</th>
                </tr>
              </thead>
              <tbody>
                {secondaryBarcodes.map((code, idx) => (
                  <tr key={`${code}-${idx}`}>
                    <td className={`text-center text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {idx + 1}
                    </td>
                    <td className={`text-center font-mono font-semibold ${COMPACT_TABLE_NUM_CLASS}`} dir="ltr">
                      {code}
                    </td>
                    <td className="text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleRemoveSecondaryBarcode(idx)}
                        aria-label={`حذف الباركود ${code}`}
                        className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center ui-stock-out hover:underline cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </CompactTable>
          )}
        </section>

        {/* 3) الأسعار والتكاليف */}
        <section
          id="section-pricing"
          ref={el => {
            sectionRefs.current.PRICING = el;
          }}
          className="space-y-5 scroll-mt-16"
        >
          <SectionHeading
            title="الأسعار والتكاليف"
            withTopDivider
            actions={
              sectionErrors.PRICING ? (
                <span className="text-xs font-semibold ui-stock-out">يوجد خطأ في الأسعار</span>
              ) : undefined
            }
          />

          {/* جدول صغير على قدر الأرقام للأسعار وهوامش الربح */}
          <CompactTable ariaLabel="جدول الأسعار والتكاليف">
            <thead>
              <tr>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                  سعر البيع الرسمي (ج.م) <span className="ui-stock-out">*</span>
                </th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الحد الأدنى للبيع (ج.م)</th>
                {(canViewPurchase || isManager) && (
                  <>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>سعر الشراء (ج.م)</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>التغليف والتجهيز (ج.م)</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>إجمالي التكلفة</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الربح المتوقع</th>
                    <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>هامش الربح</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <input
                    id="item-sale-price"
                    type="number"
                    step="0.01"
                    min="0"
                    dir="ltr"
                    required
                    aria-label="سعر البيع الرسمي (ج.م)"
                    value={salePrice}
                    onChange={e =>
                      setSalePrice(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center tabular-nums font-bold ${
                      (submitAttempted && salePrice === '') || Number(salePrice || 0) < 0
                        ? 'border-[var(--stock-out)]'
                        : ''
                    }`}
                  />
                </td>

                <td className={COMPACT_TABLE_NUM_CLASS}>
                  <input
                    id="item-min-price"
                    type="number"
                    step="0.01"
                    min="0"
                    dir="ltr"
                    aria-label="الحد الأدنى لسعر البيع المسموح (ج.م)"
                    value={minPrice}
                    onChange={e =>
                      setMinPrice(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    placeholder="اختياري"
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center tabular-nums ${
                      Number(minPrice || 0) > 0 && Number(minPrice || 0) > Number(salePrice || 0)
                        ? 'border-[var(--stock-out)]'
                        : ''
                    }`}
                  />
                </td>

                {(canViewPurchase || isManager) && (
                  <>
                    <td className={COMPACT_TABLE_NUM_CLASS}>
                      <input
                        id="item-purchase-price"
                        type="number"
                        step="0.01"
                        min="0"
                        dir="ltr"
                        aria-label="سعر الشراء (ج.م)"
                        value={purchasePrice}
                        onChange={e =>
                          setPurchasePrice(e.target.value === '' ? '' : Number(e.target.value))
                        }
                        className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center tabular-nums font-semibold`}
                      />
                    </td>

                    <td className={COMPACT_TABLE_NUM_CLASS}>
                      <input
                        id="item-packaging-cost"
                        type="number"
                        step="0.01"
                        min="0"
                        dir="ltr"
                        aria-label="تكلفة التغليف والتجهيز (ج.م)"
                        value={packagingCost}
                        onChange={e =>
                          setPackagingCost(e.target.value === '' ? '' : Number(e.target.value))
                        }
                        className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center tabular-nums font-semibold`}
                      />
                    </td>

                    <td className={`text-center font-bold text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {totalCost.toFixed(2)} ج.م
                    </td>

                    <td
                      className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS} ${
                        expectedProfit >= 0 ? 'ui-money-purchase' : 'ui-stock-out'
                      }`}
                    >
                      {expectedProfit.toFixed(2)} ج.م
                    </td>

                    <td className={`text-center font-bold text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {profitMarginPercent}%
                    </td>
                  </>
                )}
              </tr>
            </tbody>
          </CompactTable>

          {Number(minPrice || 0) > 0 && Number(minPrice || 0) > Number(salePrice || 0) && (
            <p className="text-xs font-semibold ui-stock-out">
              الحد الأدنى لا يمكن أن يكون أكبر من سعر البيع الرسمي
            </p>
          )}

          {!(canViewPurchase || isManager) && (
            <div className="text-xs text-[var(--text-secondary)] flex items-center gap-2">
              <Shield className="w-4 h-4 shrink-0" />
              <span>أسعار الشراء وهوامش الربح محجوبة وفق صلاحيات الحساب الحالي.</span>
            </div>
          )}

          {/* الضريبة، رسوم الالتقاط، وتقسيط المنصات BNPL بعروض Rule 4 */}
          <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
            {/* نسبة الضريبة % (120px) */}
            <div className="max-w-full">
              <label htmlFor="item-tax-rate" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                نسبة الضريبة %
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="item-tax-rate"
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  dir="ltr"
                  value={taxRate}
                  onChange={e =>
                    setTaxRate(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center tabular-nums font-bold`}
                />
                <button
                  type="button"
                  onClick={() => setTaxRate(0)}
                  className={`min-h-[44px] px-3 rounded-lg border text-xs font-bold transition cursor-pointer ${
                    taxRate === 0
                      ? 'bg-[#1668B2] border-[#1668B2] text-white'
                      : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  0% (معفى)
                </button>
                <button
                  type="button"
                  onClick={() => setTaxRate(14)}
                  className={`min-h-[44px] px-3 rounded-lg border text-xs font-bold transition cursor-pointer ${
                    taxRate === 14
                      ? 'bg-[#1668B2] border-[#1668B2] text-white'
                      : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  14% (قيمة مضافة)
                </button>
              </div>
            </div>

            {platformsEnabled && (
              <>
                {/* رسوم الالتقاط للقطعة (120px) */}
                <div className="max-w-full">
                  <label htmlFor="item-pickup-fee" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                    رسوم الالتقاط للقطعة (ج.م)
                  </label>
                  <input
                    id="item-pickup-fee"
                    type="number"
                    step="any"
                    min="0"
                    dir="ltr"
                    value={pickupFee}
                    onChange={e =>
                      setPickupFee(
                        e.target.value === '' ? '' : Math.max(0, Number(e.target.value))
                      )
                    }
                    placeholder="اختياري"
                    className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center tabular-nums font-bold`}
                  />
                </div>

                {/* تقسيط المنصات BNPL */}
                <div className="max-w-full space-y-2">
                  <label
                    htmlFor="item-enable-bnpl"
                    className="inline-flex items-center gap-2 min-h-[44px] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      id="item-enable-bnpl"
                      checked={enableBnpl}
                      onChange={e => setEnableBnpl(e.target.checked)}
                      className="w-4 h-4 rounded border-[var(--input-border)] cursor-pointer"
                    />
                    <span>تفعيل تقسيط المنصات (BNPL)</span>
                  </label>

                  {enableBnpl && (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <label htmlFor="item-bnpl-pct" className="text-xs font-semibold text-[var(--text-secondary)]">
                          نسبة الزيادة %:
                        </label>
                        <input
                          id="item-bnpl-pct"
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          dir="ltr"
                          value={bnplPercentage}
                          onChange={e =>
                            setBnplPercentage(
                              e.target.value === ''
                                ? ''
                                : Math.min(100, Math.max(0, Number(e.target.value)))
                            )
                          }
                          className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-mono font-bold`}
                          placeholder="20"
                        />
                      </div>

                      {numSale > 0 && (
                        <div className="text-xs text-[var(--text-secondary)] flex flex-wrap items-center gap-3 tabular-nums">
                          <span>
                            الزيادة: +
                            {(
                              Math.round(numSale * (1 + (Number(bnplPercentage) || 0) / 100) * 100) /
                                100 -
                              numSale
                            ).toFixed(2)}{' '}
                            ج.م
                          </span>
                          <span className="font-bold text-[var(--text-primary)]">
                            سعر التقسيط للعميل:{' '}
                            {(
                              Math.round(numSale * (1 + (Number(bnplPercentage) || 0) / 100) * 100) /
                              100
                            ).toFixed(2)}{' '}
                            ج.م
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {/* 4) المخزون والتنبيهات */}
        <section
          id="section-stock"
          ref={el => {
            sectionRefs.current.STOCK = el;
          }}
          className="space-y-5 scroll-mt-16"
        >
          <SectionHeading
            title="المخزون والتنبيهات"
            withTopDivider
            actions={
              sectionErrors.STOCK ? (
                <span className="text-xs font-semibold ui-stock-out">بيانات مخزون مطلوبة</span>
              ) : undefined
            }
          />

          <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
            <div className="max-w-full">
              <label htmlFor="item-stock-qty" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                الكمية الحالية ({unit}) <span className="ui-stock-out">*</span>
              </label>
              <input
                id="item-stock-qty"
                type="number"
                min="0"
                dir="ltr"
                required
                value={stockQuantity}
                onChange={e =>
                  setStockQuantity(e.target.value === '' ? '' : Number(e.target.value))
                }
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center tabular-nums font-bold ${
                  (submitAttempted && stockQuantity === '') || Number(stockQuantity || 0) < 0
                    ? 'border-[var(--stock-out)]'
                    : ''
                }`}
              />
            </div>

            <div className="max-w-full">
              <label htmlFor="item-reorder-limit" className="block text-xs font-bold text-[var(--text-primary)] mb-1.5">
                حد إعادة الطلب ({unit})
              </label>
              <input
                id="item-reorder-limit"
                type="number"
                min="0"
                dir="ltr"
                value={reorderLimit}
                onChange={e =>
                  setReorderLimit(e.target.value === '' ? '' : Number(e.target.value))
                }
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center tabular-nums`}
              />
            </div>

            {currentItem && Number(stockQuantity || 0) !== originalStockQuantity && (
              <div className="max-w-full">
                <label htmlFor="item-edit-reason" className="block text-xs font-bold ui-stock-low mb-1.5">
                  سبب تعديل الرصيد ({originalStockQuantity} ← {stockQuantity}) *
                </label>
                <input
                  id="item-edit-reason"
                  type="text"
                  required
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  placeholder="سبب التسوية: جرد دوري، تصحيح خطأ، تالف..."
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.notes} text-xs sm:text-sm ${
                    submitAttempted && !editReason.trim() ? 'border-[var(--stock-out)]' : ''
                  }`}
                />
              </div>
            )}
          </div>

          {/* جدول الكمية في كل مخزن (CompactTable) */}
          {currentItem?.id && (
            <div className="space-y-3">
              <h3 className="text-[13px] font-semibold text-[var(--text-secondary)]">
                الكمية في كل مخزن
              </h3>

              {isLoadingWarehouses ? (
                <div className="text-xs text-[var(--text-secondary)] flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin ui-link" />
                  <span>جارٍ تحميل أرصدة المخازن...</span>
                </div>
              ) : warehouseBreakdown.length === 0 ? (
                <div className="text-xs text-[var(--text-secondary)]">
                  لا توجد أرصدة مخازن مسجلة لهذا الصنف حتى الآن.
                </div>
              ) : (
                <CompactTable ariaLabel="الكمية في كل مخزن">
                  <thead>
                    <tr>
                      <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المخزن</th>
                      <th className="text-center whitespace-nowrap">الحالة</th>
                      <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الكمية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warehouseBreakdown.map(wh => (
                      <tr key={wh.warehouseId}>
                        <td className={`font-semibold ${COMPACT_TABLE_TEXT_CLASS}`}>
                          <span>{wh.warehouseName}</span>
                          {wh.isDefault && (
                            <span className="mr-2 text-[11px] font-semibold ui-link">(رئيسي)</span>
                          )}
                        </td>
                        <td className="text-center whitespace-nowrap text-xs font-semibold">
                          <span className={wh.status === 'نشط' ? 'ui-money-purchase' : 'text-[var(--text-secondary)]'}>
                            {wh.status || 'نشط'}
                          </span>
                        </td>
                        <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                          {Number(wh.quantity || 0).toLocaleString('en-US')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--border-color)] font-bold">
                      <td colSpan={2} className="py-2 px-3 text-xs">
                        الإجمالي الكلي
                      </td>
                      <td className={`py-2 px-3 text-center text-xs ${COMPACT_TABLE_NUM_CLASS}`}>
                        {warehouseBreakdown
                          .reduce((sum, w) => sum + Number(w.quantity || 0), 0)
                          .toLocaleString('en-US')}
                      </td>
                    </tr>
                  </tfoot>
                </CompactTable>
              )}
            </div>
          )}
        </section>

        {/* 5) تكاليف المنصات (CompactTable) */}
        {platformsEnabled && (
        <section
          id="section-platforms"
          ref={el => {
            sectionRefs.current.PLATFORMS = el;
          }}
          className="space-y-5 scroll-mt-16"
        >
          <SectionHeading
            title="تكاليف المنصات"
            withTopDivider
            actions={
              sectionErrors.PLATFORMS ? (
                <span className="text-xs font-semibold ui-stock-out">قيمة غير صالحة</span>
              ) : undefined
            }
          />

          <CompactTable ariaLabel="تكاليف استقطاع المرتجع لكل منصة">
            <thead>
              <tr>
                <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المنصة</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>عمولة المنصة %</th>
                <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>استقطاع المرتجع (ج.م)</th>
              </tr>
            </thead>
            <tbody>
              {activePlatforms.map(plt => {
                const currentCost = platformCostsState[plt.id] || {
                  returnShippingDeduction: 0
                };
                return (
                  <tr key={plt.id}>
                    <td className={`font-semibold ${COMPACT_TABLE_TEXT_CLASS}`}>{plt.name}</td>
                    <td className={`text-center text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {plt.discountPercentage}%
                    </td>
                    <td className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        dir="ltr"
                        aria-label={`استقطاع المرتجع لمنصة ${plt.name}`}
                        value={currentCost.returnShippingDeduction}
                        onChange={e => {
                          const val = e.target.value === '' ? '' : Number(e.target.value);
                          setPlatformCostsState(prev => ({
                            ...prev,
                            [plt.id]: {
                              ...prev[plt.id],
                              returnShippingDeduction: val
                            }
                          }));
                        }}
                        className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.number} text-center font-bold tabular-nums`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </CompactTable>
        </section>
        )}

        {/* 6) سجل الحركة والتعديلات (عند تعديل صنف موجود) */}
        {currentItem && (
          <section
            id="section-logs"
            ref={el => {
              sectionRefs.current.LOGS = el;
            }}
            className="space-y-5 scroll-mt-16"
          >
            <SectionHeading title="سجل الحركة والتعديلات" withTopDivider />

            {isLoadingLogs ? (
              <div className="py-6 text-[var(--text-secondary)] flex items-center gap-2 text-xs">
                <Loader2 className="w-4 h-4 animate-spin ui-link" />
                <span>جاري تحميل سجل الحركات والتعديلات...</span>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-2.5">
                  <h3 className="text-[13px] font-semibold text-[var(--text-secondary)]">
                    سجل تعديلات الصنف
                  </h3>

                  {changeLogs.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)]">
                      لا توجد تعديلات مسجلة بعد على هذا الصنف.
                    </p>
                  ) : (
                    <CompactTable ariaLabel="سجل تعديلات الصنف">
                      <thead>
                        <tr>
                          <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الحقل المعدل</th>
                          <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>القيمة السابقة</th>
                          <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>القيمة الجديدة</th>
                          <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المستخدم</th>
                          <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>التاريخ والسبب</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changeLogs.map(log => (
                          <tr key={log.id}>
                            <td className={`font-semibold ${COMPACT_TABLE_TEXT_CLASS}`}>
                              {log.fieldName}
                            </td>
                            <td className={`font-mono text-[var(--text-secondary)] line-through ${COMPACT_TABLE_TEXT_CLASS}`}>
                              {String(log.oldValue)}
                            </td>
                            <td className={`font-mono font-bold ui-link ${COMPACT_TABLE_TEXT_CLASS}`}>
                              {String(log.newValue)}
                            </td>
                            <td className={COMPACT_TABLE_TEXT_CLASS}>{log.userName}</td>
                            <td className={`text-xs text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                              <div className={COMPACT_TABLE_NUM_CLASS}>
                                {new Date(log.timestamp).toLocaleDateString('ar-EG')}
                              </div>
                              {log.reason && <div>{log.reason}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </CompactTable>
                  )}
                </div>

                <div className="space-y-2.5">
                  <h3 className="text-[13px] font-semibold text-[var(--text-secondary)]">
                    حركات المخزون التاريخية
                  </h3>

                  {stockMovements.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)]">
                      لا توجد حركات مخزون مسجلة لهذا الصنف.
                    </p>
                  ) : (
                    <CompactTable ariaLabel="حركات المخزون التاريخية">
                      <thead>
                        <tr>
                          <th className="text-right whitespace-nowrap">نوع الحركة</th>
                          <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الكمية</th>
                          <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الرصيد بعدها</th>
                          <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>رقم المستند</th>
                          <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>المستخدم والبيان</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockMovements.map(m => (
                          <tr key={m.id}>
                            <td className="font-semibold whitespace-nowrap">{m.movementType}</td>
                            <td className={`text-center font-bold ${COMPACT_TABLE_NUM_CLASS}`}>
                              {m.quantity}
                            </td>
                            <td className={`text-center font-bold ui-link ${COMPACT_TABLE_NUM_CLASS}`}>
                              {m.balanceAfter}
                            </td>
                            <td className={`font-mono text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                              {m.documentNumber || '-'}
                            </td>
                            <td className={`text-xs text-[var(--text-secondary)] ${COMPACT_TABLE_TEXT_CLASS}`}>
                              <div>
                                {m.userName} • {new Date(m.date).toLocaleDateString('ar-EG')}
                              </div>
                              {m.notes && <div>{m.notes}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </CompactTable>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* شريط «حفظ» و«إلغاء» السفلي */}
        <div className="sticky bottom-14 md:bottom-0 z-30 bg-[var(--surface)] border-t border-[var(--border-color)] pt-4 pb-2 flex items-center justify-between gap-3">
          <a
            href={getHrefForTarget('items')}
            aria-disabled={isSubmitting}
            onClick={(e) => {
              if (isSubmitting) {
                e.preventDefault();
                return;
              }
              if (!isPlainLeftClick(e)) return;
              e.preventDefault();
              requestExitWithConfirm(onBackToList);
            }}
            className={`min-h-[44px] inline-flex items-center px-5 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition cursor-pointer ${
              isSubmitting ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            إلغاء
          </a>

          <button
            type="submit"
            data-shortcut-save="true"
            disabled={isSubmitting || hasDuplicateConflict}
            className="min-h-[44px] inline-flex items-center gap-2 px-7 rounded-lg bg-[#157347] hover:bg-[#115C38] text-white font-bold text-xs sm:text-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري الحفظ...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>حفظ</span>
                <ShortcutBadge actionId="general.save_form" className="bg-white/20 text-white border-white/30" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* نافذة تأكيد عربية عند الخروج مع وجود تعديلات غير محفوظة */}
      {exitConfirmModal?.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          dir="rtl"
        >
          <div className="w-full max-w-md rounded-xl bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border-color)] p-6 space-y-4">
            <div className="flex items-center gap-2 ui-stock-low">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                تأكيد الخروج دون حفظ التعديلات
              </h3>
            </div>

            <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
              لديك تعديلات غير محفوظة في صفحة الصنف الحالية. هل أنت متأكد من رغبتك في تجاهلها والخروج؟
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setExitConfirmModal(null)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition cursor-pointer"
              >
                البقاء في الصفحة
              </button>
              <button
                type="button"
                onClick={exitConfirmModal.onConfirm}
                className="min-h-[44px] px-4 rounded-lg bg-[#B42318] hover:bg-[#912018] text-white text-xs font-bold transition cursor-pointer"
              >
                تجاهل التعديلات والخروج
              </button>
            </div>
          </div>
        </div>
      )}
    </PageSurface>
  );
};

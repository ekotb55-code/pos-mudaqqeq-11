import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Images,
  Info,
  RotateCcw,
  RotateCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import {
  BulkEditExcelExecuteResult,
  BulkEditExcelPreviewResult,
  BulkEditExcelRowStatus,
  BulkEditExcelUndoStatus,
  BulkEditOperationType,
  UserAccount,
} from '../types';
import { hasPermission } from '../utils/permissions';
import { useUserWarehouses } from '../hooks/useUserWarehouses';
import {
  PageSurface,
  SectionHeading,
  CompactTable,
  ReportSummaryTable,
  ModalShell,
  COMPACT_TABLE_NUM_CLASS,
  COMPACT_TABLE_TEXT_CLASS,
  INPUT_WIDTH_CLASSES,
  FORM_CONTROL_BASE_CLASS,
  type ReportSummaryRow,
} from '../components/ui';
import { readItemsPackage, matchPackageImages, type ImageMatchResult } from '../utils/itemImagesPackage';
import type { ImportImagesReport } from '../utils/itemImagesTransfer';
import {
  ItemImagesPreview,
  ItemImagesProgress,
  ItemImagesReport,
  checkExistingImages,
  downloadImagesOnlyTemplate,
  uploadItemImages,
  type ExistingImagesCheck,
} from '../components/ItemsImagesImportPanel';
import { ItemsImageExportDialog } from '../components/ItemsImageExportDialog';

interface BulkEditExcelPageProps {
  user: UserAccount;
  onRefreshItems: () => Promise<void> | void;
  initialOperationType?: BulkEditOperationType;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** عمليات الشاشة = عمليات السيرفر + «تعديل الصور» (بتتنفذ من الشاشة: رفع الصور ثم ربطها بالأصناف) */
type PageOperationType = BulkEditOperationType | 'images_only';

const WAREHOUSE_SCOPED_OPS: PageOperationType[] = [
  'add_items',
  'stock_quantity',
  'reorder_limit',
];

const OPERATION_META_UI: Record<
  string,
  {
    label: string;
    shortColDesc: string;
    buttonLabel: string;
    isAdd?: boolean;
    isDelete?: boolean;
  }
> = {
  add_items: {
    label: 'إضافة أصناف',
    shortColDesc:
      'عمودان إلزاميان فقط: «اسم الصنف» و«الباركود الرئيسي» — وباقي الأعمدة اختيارية («اسم الطباعة»، «الكمية»، «التصنيف»، «سعر البيع»، «سعر الشراء»، «وصف الصنف»، «الوحدة»، «الحد الأدنى للكمية»، «المورد»، «نسبة الضريبة»، «الصورة») وتأخذ صفرًا للأرقام وفراغًا للنصوص عند تركها فارغة أو حذف عمودها. ولإضافة الأصناف بصورها: ارفع ملف مضغوط (.zip) فيه ملف الإكسيل والصور، أو ملف إكسيل فيه الصور جوه خانات «الصورة».',
    buttonLabel: 'إضافة أصناف',
    isAdd: true,
  },
  add_categories: {
    label: 'إضافة تصنيفات بالإكسيل',
    shortColDesc:
      'عمودان فقط: «التصنيف الرئيسي» (إلزامي) و«التصنيف الفرعي» (اختياري؛ تركه فارغاً يضيف الرئيسي فقط). يمكن تكرار اسم الرئيسي في عدة صفوف لربط أكثر من فرعي به، ولا يُدعم أكثر من مستويين في هذا القالب.',
    buttonLabel: 'إضافة تصنيفات بالإكسيل',
    isAdd: true,
  },
  delete_categories: {
    label: 'حذف التصنيفات بالإكسيل',
    shortColDesc:
      'عمود واحد فقط بعنوان «اسم التصنيف» — يُطابق اسم التصنيف الكامل حرفياً مع التصنيفات الموجودة (دون تقسيم عند / أو > أو أي علامة ترقيم)، ولا يُسمح بحذف تصنيف مرتبط بأصناف أو له فروع مرتبطة بأصناف أو ترك تصنيفات فرعية يتيمة.',
    buttonLabel: 'حذف التصنيفات بالإكسيل',
    isDelete: true,
  },
  print_name: {
    label: 'تعديل اسم الطباعة',
    shortColDesc: 'عمودان إلزاميان: «اسم الصنف» و«اسم الطباعة»، وعمود اختياري «الكود/الباركود».',
    buttonLabel: 'تعديل اسم الطباعة',
  },
  primary_barcode: {
    label: 'تعديل الباركود الرئيسي',
    shortColDesc: 'عمودان: «اسم الصنف» و«الباركود الجديد» (يستبدل الباركود الرئيسي للصنف).',
    buttonLabel: 'تعديل الباركود الرئيسي',
  },
  add_secondary_barcode: {
    label: 'إضافة باركود فرعي',
    shortColDesc: 'عمودان: «اسم الصنف» و«الباركود المضاف» (يضيف باركود فرعي دون مسح الفرعية الموجودة).',
    buttonLabel: 'إضافة باركود فرعي',
  },
  stock_quantity: {
    label: 'تعديل الكميات',
    shortColDesc: 'عمودان إلزاميان: «اسم الصنف» و«الكمية الجديدة»، وعمود اختياري «الكود/الباركود» (يعدّل رصيد المخزن المحدد فقط).',
    buttonLabel: 'تعديل الكميات',
  },
  reorder_limit: {
    label: 'تعديل الحد الأدنى للكمية',
    shortColDesc: 'عمودان إلزاميان: «اسم الصنف» و«الحد الأدنى للكمية»، وعمود اختياري «الكود/الباركود» (يخص المخزن المحدد).',
    buttonLabel: 'تعديل الحد الأدنى للكمية',
  },
  sale_price: {
    label: 'تعديل سعر البيع',
    shortColDesc: 'عمودان إلزاميان: «اسم الصنف» و«سعر البيع»، وعمود اختياري «الكود/الباركود».',
    buttonLabel: 'تعديل سعر البيع',
  },
  purchase_price: {
    label: 'تعديل سعر الشراء',
    shortColDesc: 'عمودان إلزاميان: «اسم الصنف» و«سعر الشراء»، وعمود اختياري «الكود/الباركود».',
    buttonLabel: 'تعديل سعر الشراء',
  },
  category: {
    label: 'تعديل التصنيف',
    shortColDesc:
      'عمودان إلزاميان: «اسم الصنف» و«التصنيف»، وعمود اختياري «الكود/الباركود» (يقبل اسم تصنيف رئيسي أو فرعي أو «الرئيسي / الفرعي» أو تصنيفاً رئيسياً جديداً، كما يقبل الملفات القديمة بعمودَي «التصنيف الرئيسي» و«التصنيف الفرعي»).',
    buttonLabel: 'تعديل التصنيف',
  },
  unit: {
    label: 'تعديل الوحدة',
    shortColDesc: 'عمودان إلزاميان: «اسم الصنف» و«الوحدة»، وعمود اختياري «الكود/الباركود».',
    buttonLabel: 'تعديل الوحدة',
  },
  images_only: {
    label: 'تعديل الصور',
    shortColDesc:
      'عمودان: «الصنف» (الباركود الرئيسي أو اسم الصنف) و«الصورة» (اسم ملف الصورة جوه الملف المضغوط، أو الصورة نفسها جوه الخانة؛ ولو فاضية بياخد الصورة اللي اسمها نفس الباركود). ارفع ملف مضغوط (.zip) فيه الإكسيل والصور، أو ملف إكسيل (.xlsx) فيه الصور جوه الخانات.',
    buttonLabel: 'تعديل الصور',
  },
  delete_items: {
    label: 'حذف أصناف',
    shortColDesc:
      'عمود واحد فقط: «اسم الصنف» — يُحدَّد الصنف بالاسم، ويُشترط أن يكون رصيده صفراً في كل المخازن ولم يدخل في أي فاتورة بيع أو شراء أو مرتجع.',
    buttonLabel: 'حذف أصناف',
    isDelete: true,
  },
};

function normalizeDigitChars(val: string): string {
  return val
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export const BulkEditExcelPage: React.FC<BulkEditExcelPageProps> = ({
  user,
  onRefreshItems,
  initialOperationType,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canBulkEdit =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'products.bulk_edit_excel');
  const canViewPurchase =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'prices.view_purchase');
  const canCreateItems =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'items.create');
  const canDeleteItems =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'items.delete');
  const canManageCategories =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'categories.manage');
  const canExportItems =
    user.role === 'designer' ||
    Boolean(user.isOwner) ||
    hasPermission(user, 'products.export');

  const [operationType, setOperationType] = useState<PageOperationType>(() => {
    if (initialOperationType && OPERATION_META_UI[initialOperationType]) {
      if (initialOperationType === 'add_items' && !canCreateItems) return 'primary_barcode';
      if ((initialOperationType === 'add_categories' || initialOperationType === 'delete_categories') && !canManageCategories) return 'sale_price';
      if (initialOperationType === 'purchase_price' && !canViewPurchase) return 'sale_price';
      if (initialOperationType === 'delete_items' && !canDeleteItems) return 'sale_price';
      return initialOperationType;
    }
    return canCreateItems ? 'add_items' : 'sale_price';
  });

  useEffect(() => {
    if (initialOperationType && OPERATION_META_UI[initialOperationType]) {
      if (initialOperationType === 'add_items' && !canCreateItems) return;
      if ((initialOperationType === 'add_categories' || initialOperationType === 'delete_categories') && !canManageCategories) return;
      if (initialOperationType === 'purchase_price' && !canViewPurchase) return;
      if (initialOperationType === 'delete_items' && !canDeleteItems) return;
      setOperationType(initialOperationType);
    }
  }, [initialOperationType, canCreateItems, canManageCategories, canViewPurchase, canDeleteItems]);

  const {
    activeAllowedWarehouses: warehouses,
    defaultWarehouseId: userDefaultWarehouseId,
    isLoading: isLoadingWarehouses,
  } = useUserWarehouses(user);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');

  useEffect(() => {
    if (warehouses.length === 0) return;
    setSelectedWarehouseId((prev) => {
      if (prev && warehouses.some((w) => w.id === prev)) return prev;
      if (userDefaultWarehouseId && warehouses.some((w) => w.id === userDefaultWarehouseId)) {
        return userDefaultWarehouseId;
      }
      return warehouses[0].id;
    });
  }, [warehouses, userDefaultWarehouseId]);

  const [undoStatus, setUndoStatus] = useState<BulkEditExcelUndoStatus | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isUndoModalOpen, setIsUndoModalOpen] = useState(false);
  const [undoSuccessMsg, setUndoSuccessMsg] = useState<string | null>(null);

  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [fileBase64, setFileBase64] = useState<string>('');

  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isDownloadingErrors, setIsDownloadingErrors] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const [previewResult, setPreviewResult] = useState<BulkEditExcelPreviewResult | null>(null);
  const [executeResult, setExecuteResult] = useState<BulkEditExcelExecuteResult | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | BulkEditExcelRowStatus | 'warning'>('ALL');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [deleteConfirmCountInput, setDeleteConfirmCountInput] = useState('');

  // ---- الصور (إضافة أصناف بالصور / تعديل الصور) ----
  const [displayFileName, setDisplayFileName] = useState('');
  const [imagePlan, setImagePlan] = useState<ImageMatchResult | null>(null);
  const [replaceExistingImages, setReplaceExistingImages] = useState(false);
  const [imagesStorageEnabled, setImagesStorageEnabled] = useState<boolean | null>(null);
  const [existingImages, setExistingImages] = useState<ExistingImagesCheck | null>(null);
  const [imagesProgress, setImagesProgress] = useState<{ stage: 'items' | 'images'; done: number; total: number } | null>(null);
  const [imagesReport, setImagesReport] = useState<ImportImagesReport | null>(null);
  const [isCancellingImages, setIsCancellingImages] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const imagesAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!canBulkEdit) return;
    api
      .getBulkEditUndoStatus()
      .then((undoRes) => {
        if (undoRes && undoRes.success) {
          setUndoStatus(undoRes);
        }
      })
      .catch(() => {});
  }, [canBulkEdit]);

  useEffect(() => {
    if (!canBulkEdit) return;
    api.getItemImagesConfig()
      .then((res) => setImagesStorageEnabled(Boolean(res?.storageEnabled)))
      .catch(() => setImagesStorageEnabled(null));
  }, [canBulkEdit]);

  // تنبيه لو الصفحة هتتقفل أثناء حفظ الأصناف أو رفع الصور
  const isImagesBusy = imagesProgress !== null;
  useEffect(() => {
    if (!isImagesBusy) return;
    const warnBeforeLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [isImagesBusy]);

  if (!canBulkEdit) {
    return (
      <PageSurface dir="rtl" title="تعديل وإضافة الأصناف بالإكسيل">
        <div className="py-6 text-sm font-bold ui-stock-out">
          غير مصرح لك بالوصول إلى صفحة التعديل بالإكسيل (تفتقر لصلاحية products.bulk_edit_excel)
        </div>
      </PageSurface>
    );
  }

  const isWarehouseScoped = WAREHOUSE_SCOPED_OPS.includes(operationType);
  const selectedWarehouseObj = warehouses.find((w) => w.id === selectedWarehouseId);
  const currentOpMeta = OPERATION_META_UI[operationType] || OPERATION_META_UI.sale_price;
  const operationLabel = currentOpMeta.label;
  const isAddOperation = operationType === 'add_items';
  const isAddCategoriesOperation = operationType === 'add_categories';
  const isDeleteCategoriesOperation = operationType === 'delete_categories';
  const isDeleteItemsOperation = operationType === 'delete_items';
  const isDeleteOperation = isDeleteItemsOperation || isDeleteCategoriesOperation;
  const isImagesOnly = operationType === 'images_only';
  const serverOperationType = operationType as BulkEditOperationType;

  const resetFileAndResults = () => {
    // أثناء رفع الصور: لازم يخلص أو يتلغي الأول
    if (imagesAbortRef.current) return;
    setSelectedFileName('');
    setFileBase64('');
    setPreviewResult(null);
    setExecuteResult(null);
    setStatusFilter('ALL');
    setErrorMsg(null);
    setIsConfirmModalOpen(false);
    setDeleteConfirmCountInput('');
    setDisplayFileName('');
    setImagePlan(null);
    setExistingImages(null);
    setImagesReport(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOperationChange = (nextOp: PageOperationType) => {
    if (nextOp === 'purchase_price' && !canViewPurchase) {
      setErrorMsg('غير مصرح لك بعرض أو تعديل سعر الشراء (تفتقر لصلاحية prices.view_purchase)');
      return;
    }
    if (nextOp === 'add_items' && !canCreateItems) {
      setErrorMsg('غير مصرح لك بإضافة أصناف جديدة (تفتقر لصلاحية items.create)');
      return;
    }
    if (nextOp === 'add_categories' && !canManageCategories) {
      setErrorMsg('غير مصرح لك بإضافة التصنيفات (تفتقر لصلاحية categories.manage)');
      return;
    }
    if (nextOp === 'delete_categories' && !canManageCategories) {
      setErrorMsg('غير مصرح لك بحذف التصنيفات (تفتقر لصلاحية categories.manage)');
      return;
    }
    if (nextOp === 'delete_items' && !canDeleteItems) {
      setErrorMsg('غير مصرح لك بحذف الأصناف (تفتقر لصلاحية items.delete)');
      return;
    }
    setOperationType(nextOp);
    setUndoSuccessMsg(null);
    // «تعديل الصور»: الاستبدال شغال من الأول، و«إضافة أصناف»: مقفول من الأول
    setReplaceExistingImages(nextOp === 'images_only');
    resetFileAndResults();
  };

  const handleWarehouseChange = async (nextWarehouseId: string) => {
    setSelectedWarehouseId(nextWarehouseId);
    setErrorMsg(null);
    setExecuteResult(null);
    if (fileBase64 && selectedFileName && WAREHOUSE_SCOPED_OPS.includes(operationType)) {
      setIsPreviewLoading(true);
      try {
        const res = await api.previewBulkEditExcel({
          operationType: serverOperationType,
          fileName: selectedFileName,
          fileBase64,
          warehouseId: nextWarehouseId,
        });
        if (!res.success) {
          setErrorMsg(res.error || 'تعذر معاينة الملف للمخزن المحدد');
          setPreviewResult(null);
        } else {
          setPreviewResult(res);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'حدث خطأ أثناء إعادة معاينة الملف للمخزن المحدد');
        setPreviewResult(null);
      } finally {
        setIsPreviewLoading(false);
      }
    }
  };

  const handleDownloadTemplate = async () => {
    setErrorMsg(null);
    setIsDownloadingTemplate(true);
    try {
      if (isImagesOnly) {
        downloadImagesOnlyTemplate();
        return;
      }
      const { blob, fileName } = await api.downloadBulkEditExcelTemplate(serverOperationType);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تحميل نموذج الإكسيل');
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    setUndoSuccessMsg(null);
    setPreviewResult(null);
    setExecuteResult(null);
    setStatusFilter('ALL');
    setImagePlan(null);
    setExistingImages(null);
    setImagesReport(null);
    setDisplayFileName('');

    // ملف مضغوط بالصور، أو إكسيل ممكن يكون فيه صور جوه الخانات
    const lowerFileName = file.name.toLowerCase();
    const isZipFile = lowerFileName.endsWith('.zip');
    if (isZipFile || isImagesOnly || (isAddOperation && lowerFileName.endsWith('.xlsx'))) {
      await handlePackageFile(file, isZipFile);
      return;
    }

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls') && !lowerName.endsWith('.csv')) {
      setErrorMsg('يرجى اختيار ملف إكسيل بصيغة ‎.xlsx‎ أو ‎.xls‎ أو ‎.csv‎ فقط.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsPreviewLoading(true);
    setSelectedFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      setFileBase64(base64);

      const res = await api.previewBulkEditExcel({
        operationType,
        fileName: file.name,
        fileBase64: base64,
        warehouseId: isWarehouseScoped ? selectedWarehouseId : undefined,
      });

      if (!res.success) {
        setErrorMsg(res.error || 'تعذر معاينة الملف');
        setPreviewResult(null);
      } else {
        setPreviewResult(res);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'حدث خطأ أثناء قراءة أو معاينة الملف');
      setPreviewResult(null);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handlePackageFile = async (file: File, isZipFile: boolean) => {
    const lowerFileName = file.name.toLowerCase();
    if (isZipFile && !isAddOperation && !isImagesOnly) {
      setErrorMsg('الملف المضغوط (.zip) مقبول بس في «إضافة أصناف» و«تعديل الصور».');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (isImagesOnly && !isZipFile && !lowerFileName.endsWith('.xlsx')) {
      setErrorMsg('في «تعديل الصور» ارفع ملف مضغوط (.zip) فيه الإكسيل والصور، أو ملف إكسيل (.xlsx) فيه الصور جوه الخانات.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsPreviewLoading(true);
    setSelectedFileName(file.name);
    setDisplayFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const mode = isImagesOnly ? 'images_only' : 'add_items';
      const pkg = await readItemsPackage(buffer, file.name, mode);
      const plan = matchPackageImages(pkg, mode);

      if (isImagesOnly) {
        if (plan.headerError) {
          setErrorMsg(plan.headerError);
          return;
        }
        setImagePlan(plan);
        // كام صنف ليه صورة قبل كده (علشان المعاينة تقول «ليهم صورة وهتتغير»)
        try {
          const itemsRes = await api.getItems();
          setExistingImages(checkExistingImages(plan.entries, itemsRes.items || []));
        } catch {
          setExistingImages(null);
        }
        return;
      }

      // «إضافة أصناف»: ملف الإكسيل اللي جوه المضغوط هو اللي بيتبعت للسيرفر للمعاينة والحفظ
      const hasImagesPart =
        !plan.headerError &&
        (isZipFile || plan.entries.some((en) => en.image || (en.problem && en.problem !== 'الباركود الرئيسي فاضي')));
      setImagePlan(hasImagesPart ? plan : null);
      const workbookBytes = pkg.workbookBytes;
      const workbookName = pkg.workbookName;
      const base64 = arrayBufferToBase64(workbookBytes.slice().buffer as ArrayBuffer);
      setSelectedFileName(workbookName);
      setFileBase64(base64);
      const res = await api.previewBulkEditExcel({
        operationType: serverOperationType,
        fileName: workbookName,
        fileBase64: base64,
        warehouseId: isWarehouseScoped ? selectedWarehouseId : undefined,
      });
      if (!res.success) {
        setErrorMsg(res.error || 'تعذر معاينة الملف');
        setPreviewResult(null);
      } else {
        setPreviewResult(res);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'حدث خطأ أثناء قراءة أو معاينة الملف');
      setPreviewResult(null);
      setImagePlan(null);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  /** رفع صور الملف (4 في نفس الوقت) وربطها بالأصناف بعد ما الأصناف تتحفظ */
  const runImagesUpload = async (plan: ImageMatchResult) => {
    const controller = new AbortController();
    imagesAbortRef.current = controller;
    setIsCancellingImages(false);
    const total = plan.entries.filter((en) => en.image && !en.problem).length;
    setImagesProgress({ stage: 'images', done: 0, total });
    try {
      const report = await uploadItemImages({
        entries: plan.entries,
        replace: replaceExistingImages,
        signal: controller.signal,
        onProgress: (done, all) => setImagesProgress({ stage: 'images', done, total: all }),
      });
      setImagesReport(report);
    } catch (err: any) {
      setErrorMsg(err?.message || 'حصل خطأ أثناء رفع الصور');
    } finally {
      imagesAbortRef.current = null;
      setImagesProgress(null);
      setIsCancellingImages(false);
    }
  };

  const handleCancelImages = () => {
    setIsCancellingImages(true);
    imagesAbortRef.current?.abort();
  };

  // «تعديل الصور»: مفيش أصناف تتحفظ، الصور بس
  const handleConfirmImagesOnly = async () => {
    if (!imagePlan) return;
    setErrorMsg(null);
    await runImagesUpload(imagePlan);
    await Promise.resolve(onRefreshItems());
  };

  const handleConfirmExecute = async () => {
    if (!fileBase64 || !selectedFileName) return;

    // «إضافة أصناف» بصور: الأصناف تتحفظ الأول وبعدين الصور تترفع
    const planForImages =
      isAddOperation && imagePlan && imagesStorageEnabled !== false && imagePlan.entries.some((en) => en.image)
        ? imagePlan
        : null;
    setIsExecuting(true);
    setErrorMsg(null);
    if (planForImages) {
      setIsConfirmModalOpen(false);
      setImagesProgress({ stage: 'items', done: 0, total: 0 });
    }

    try {
      const res = await api.executeBulkEditExcel({
        operationType: serverOperationType,
        fileName: selectedFileName,
        fileBase64,
        warehouseId: isWarehouseScoped ? selectedWarehouseId : undefined,
      });

      setIsConfirmModalOpen(false);
      if (res.success) {
        setExecuteResult(res);
        setPreviewResult(null);
        setStatusFilter('ALL');
        if (planForImages) {
          await runImagesUpload(planForImages);
        }
        await Promise.all([
          Promise.resolve(onRefreshItems()),
          api
            .getBulkEditUndoStatus()
            .then((u) => {
              if (u && u.success) setUndoStatus(u);
            })
            .catch(() => {}),
        ]);
      } else {
        setErrorMsg(res.error || 'فشل تنفيذ العملية');
        if (Array.isArray(res.rows) && res.rows.length > 0 && res.summary) {
          setExecuteResult(res);
          setPreviewResult(null);
          setStatusFilter('ALL');
        }
      }
    } catch (err: any) {
      setIsConfirmModalOpen(false);
      setErrorMsg(err?.message || 'حدث خطأ أثناء تنفيذ العملية');
    } finally {
      setIsExecuting(false);
      setImagesProgress(null);
    }
  };

  const handleDownloadErrorsFile = async () => {
    const rowsSource = executeResult?.rows || previewResult?.rows || [];
    const errorRows = rowsSource.filter((r) => r.status === 'error');
    if (errorRows.length === 0) return;

    setIsDownloadingErrors(true);
    setErrorMsg(null);
    try {
      const { blob, fileName } = await api.downloadBulkEditErrorsFile({
        operationType: serverOperationType,
        fileName: selectedFileName || executeResult?.fileName || previewResult?.fileName,
        rows: errorRows,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تحميل ملف الأخطاء');
    } finally {
      setIsDownloadingErrors(false);
    }
  };

  const handleConfirmUndo = async () => {
    setIsUndoing(true);
    setErrorMsg(null);
    setUndoSuccessMsg(null);
    try {
      const res = await api.undoLastBulkEditExcel();
      setIsUndoModalOpen(false);
      if (res.success) {
        setUndoSuccessMsg(res.message || `تم التراجع بنجاح واستعادة ${res.restoredCount} صنف`);
        setUndoStatus({ success: true, available: false });
        resetFileAndResults();
        await onRefreshItems();
      } else {
        setErrorMsg(res.error || 'تعذر التراجع عن آخر عملية');
      }
    } catch (err: any) {
      setIsUndoModalOpen(false);
      setErrorMsg(err?.message || 'حدث خطأ أثناء التراجع عن آخر عملية');
    } finally {
      setIsUndoing(false);
    }
  };

  const activeRows = executeResult?.rows || previewResult?.rows || [];
  const activeSummary = executeResult?.summary || previewResult?.summary;
  const normalizedConfirmCount = normalizeDigitChars(deleteConfirmCountInput);
  const isDeleteConfirmCountValid =
    !isDeleteItemsOperation ||
    (normalizedConfirmCount.length > 0 &&
      /^\d+$/.test(normalizedConfirmCount) &&
      Number(normalizedConfirmCount) === (activeSummary?.willUpdateCount ?? -1));
  const activeWarehouseName =
    executeResult?.warehouseName ||
    previewResult?.warehouseName ||
    (isWarehouseScoped ? selectedWarehouseObj?.name : undefined);
  const warningCount = activeSummary?.warningCount ?? executeResult?.warningCount ?? 0;

  const filteredRows = activeRows.filter((row) => {
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'warning') return Boolean(row.warning);
    return row.status === statusFilter;
  });

  const categorySummary = activeSummary?.categorySummary;

  const summaryRows: ReportSummaryRow[] = activeSummary
    ? isAddCategoriesOperation && categorySummary
      ? [
          {
            label: 'إجمالي الصفوف',
            value: `${activeSummary.totalRows}`,
          },
          {
            label: executeResult ? 'رؤوس جديدة أُضيفت' : 'رؤوس جديدة',
            value: `${executeResult ? (categorySummary.createdRootsCount ?? categorySummary.newRootsCount) : categorySummary.newRootsCount}`,
            tone: 'purchase',
          },
          {
            label: 'رؤوس موجودة أُعيد استخدامها',
            value: `${categorySummary.reusedRootsCount}`,
          },
          {
            label: executeResult ? 'فروع جديدة أُضيفت' : 'فروع جديدة',
            value: `${executeResult ? (categorySummary.createdSubsCount ?? categorySummary.newSubsCount) : categorySummary.newSubsCount}`,
            tone: 'purchase',
          },
          {
            label: 'مكررات',
            value: `${categorySummary.duplicatesCount}`,
          },
          {
            label: executeResult ? 'أخطاء (صفوف مرفوضة/فاشلة)' : 'أخطاء (تُرفض)',
            value: `${executeResult ? executeResult.errorCount : activeSummary.errorCount}`,
            valueClassName:
              (executeResult ? executeResult.errorCount : activeSummary.errorCount) > 0
                ? 'ui-stock-out'
                : 'text-[var(--text-primary)]',
          },
        ]
      : isDeleteCategoriesOperation
      ? [
          {
            label: 'إجمالي الصفوف',
            value: `${activeSummary.totalRows}`,
          },
          {
            label: executeResult ? 'التصنيفات التي تم حذفها' : 'التصنيفات القابلة للحذف',
            value: `${executeResult ? executeResult.updatedCount : activeSummary.willUpdateCount}`,
            valueClassName: 'ui-stock-out',
          },
          {
            label: executeResult ? 'الصفوف المرفوضة (لم تُحذف)' : 'الصفوف المرفوضة (تُرفض)',
            value: `${executeResult ? executeResult.errorCount : activeSummary.errorCount}`,
            valueClassName:
              (executeResult ? executeResult.errorCount : activeSummary.errorCount) > 0
                ? 'ui-stock-out'
                : 'text-[var(--text-primary)]',
          },
        ]
      : [
          {
            label: 'إجمالي الصفوف',
            value: `${activeSummary.totalRows}`,
          },
          {
            label: executeResult
              ? isAddOperation
                ? 'تمت إضافتها بنجاح'
                : isDeleteOperation
                ? 'تم حذفها نهائيًا'
                : 'تم تعديلها بنجاح'
              : isAddOperation
              ? 'الصفوف الجاهزة للإضافة'
              : isDeleteOperation
              ? 'الأصناف الجاهزة للحذف النهائي'
              : 'الصفوف الجاهزة للتعديل',
            value: `${executeResult ? executeResult.updatedCount : activeSummary.willUpdateCount}`,
            tone: isDeleteOperation ? undefined : 'purchase',
            valueClassName: isDeleteOperation ? 'ui-stock-out' : undefined,
          },
          {
            label: executeResult ? 'صفوف بتنبيهات' : 'صفوف بتنبيهات (تُقبل)',
            value: `${warningCount}`,
            valueClassName: warningCount > 0 ? 'ui-stock-low' : 'text-[var(--text-primary)]',
          },
          {
            label: 'بدون تغيير',
            value: `${executeResult ? executeResult.unchangedCount : activeSummary.unchangedCount}`,
          },
          {
            label: executeResult ? 'صفوف مرفوضة بأخطاء' : 'صفوف بأخطاء (تُرفض)',
            value: `${executeResult ? executeResult.errorCount : activeSummary.errorCount}`,
            valueClassName:
              (executeResult ? executeResult.errorCount : activeSummary.errorCount) > 0
                ? 'ui-stock-out'
                : 'text-[var(--text-primary)]',
          },
        ]
    : [];

  return (
    <PageSurface
      dir="rtl"
      title="تعديل وإضافة الأصناف بالإكسيل"
      subtitle="رفع ملفات الإكسيل (.xlsx / .xls / .csv) مع المعاينة الكاملة ودعم المخازن وتحميل ملف الأخطاء • لا يؤثر على الفواتير المسجلة سابقاً"
      actions={
        <>
          {canExportItems && (
            <button
              type="button"
              onClick={() => setIsExportDialogOpen(true)}
              disabled={isExecuting || isImagesBusy}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-[var(--text-primary)] text-xs font-bold transition cursor-pointer disabled:opacity-60"
            >
              <Images className="w-4 h-4" />
              <span>تصدير الأصناف بالصور</span>
            </button>
          )}
          {undoStatus?.available ? (
          <button
            type="button"
            onClick={() => setIsUndoModalOpen(true)}
            disabled={isUndoing || isExecuting}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-bold transition cursor-pointer disabled:opacity-60"
          >
            <RotateCcw className="w-4 h-4" />
            <span>
              التراجع عن آخر عملية ({undoStatus.operationLabel} — {undoStatus.affectedCount} صنف)
            </span>
          </button>
          ) : null}
        </>
      }
    >
      {/* إشعار نجاح التراجع */}
      {undoSuccessMsg && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 py-2 border-b border-[var(--border-subtle)] text-xs font-bold ui-money-purchase"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{undoSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setUndoSuccessMsg(null)}
            aria-label="إغلاق"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* خطوات العمل في صف واحد مضغوط أعلى الصفحة */}
      {!executeResult && !imagesReport && !isImagesBusy && (
        <div className="space-y-3 pb-4 border-b border-[var(--border-subtle)]">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="bulk-edit-op-select"
                className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
              >
                نوع العملية
              </label>
              <select
                id="bulk-edit-op-select"
                value={operationType}
                onChange={(e) => handleOperationChange(e.target.value as PageOperationType)}
                disabled={isPreviewLoading || isExecuting}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold cursor-pointer disabled:opacity-60`}
              >
                {canCreateItems && <option value="add_items">إضافة أصناف</option>}
                {canManageCategories && <option value="add_categories">إضافة تصنيفات بالإكسيل</option>}
                {canManageCategories && <option value="delete_categories">حذف التصنيفات بالإكسيل</option>}
                <option value="print_name">تعديل اسم الطباعة</option>
                <option value="primary_barcode">تعديل الباركود الرئيسي</option>
                <option value="add_secondary_barcode">إضافة باركود فرعي</option>
                <option value="stock_quantity">تعديل الكميات</option>
                <option value="reorder_limit">تعديل الحد الأدنى للكمية</option>
                <option value="sale_price">تعديل سعر البيع</option>
                {canViewPurchase && <option value="purchase_price">تعديل سعر الشراء</option>}
                <option value="category">تعديل التصنيف</option>
                <option value="unit">تعديل الوحدة</option>
                <option value="images_only">تعديل الصور</option>
                {canDeleteItems && <option value="delete_items">حذف أصناف</option>}
              </select>
            </div>

            {isWarehouseScoped && (
              <div>
                <label
                  htmlFor="bulk-edit-warehouse-select"
                  className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
                >
                  المخزن
                </label>
                <select
                  id="bulk-edit-warehouse-select"
                  value={selectedWarehouseId}
                  onChange={(e) => handleWarehouseChange(e.target.value)}
                  disabled={isLoadingWarehouses || isPreviewLoading || isExecuting}
                  className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.code} text-xs font-bold cursor-pointer disabled:opacity-60`}
                >
                  {warehouses.map((wh) => (
                    <option key={wh.id} value={wh.id}>
                      {wh.name} {wh.isDefault ? '(الافتراضي)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={handleDownloadTemplate}
              disabled={isDownloadingTemplate}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-lg bg-[#168A4A] hover:bg-[#12703C] text-white text-xs font-bold transition cursor-pointer disabled:opacity-60"
            >
              {isDownloadingTemplate ? (
                <>
                  <RotateCw className="w-4 h-4 animate-spin" />
                  <span>جاري تجهيز النموذج...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>تحميل نموذج الإكسيل ({currentOpMeta.buttonLabel})</span>
                </>
              )}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.zip"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isPreviewLoading || isExecuting}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer disabled:opacity-60"
            >
              {isPreviewLoading ? (
                <>
                  <RotateCw className="w-4 h-4 animate-spin" />
                  <span>جاري فحص ومعاينة الملف...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>
                    {selectedFileName
                      ? 'اختيار ملف آخر'
                      : isImagesOnly
                      ? 'رفع ملف مضغوط أو إكسيل (.zip / .xlsx)'
                      : isAddOperation
                      ? 'رفع ملف إكسيل أو ملف مضغوط بالصور (.xlsx / .zip)'
                      : 'رفع ملف إكسيل (.xlsx / .xls / .csv)'}
                  </span>
                </>
              )}
            </button>

            {selectedFileName && !isPreviewLoading && (
              <button
                type="button"
                onClick={resetFileAndResults}
                title="مسح الملف"
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] text-xs font-bold ui-stock-out cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>مسح الملف</span>
              </button>
            )}
          </div>

          <div className="text-xs text-[var(--text-secondary)] leading-relaxed space-y-1">
            <div>
              <strong className="text-[var(--text-primary)]">الأعمدة المطلوبة: </strong>
              {currentOpMeta.shortColDesc}{' '}
              <span>
                {isAddCategoriesOperation
                  ? '(النموذج فيه ورقة «التصنيفات» بصف العناوين فقط، وورقة «مثال وتعليمات» فيها مثال للرئيسي وحده ورئيسي تحته عدة فروع، والحد الأقصى 5000 صف.)'
                  : isDeleteCategoriesOperation
                  ? '(النموذج فيه ورقة «حذف التصنيفات» بعمود واحد فقط «اسم التصنيف»، وورقة «مثال وتعليمات» لشرح ضوابط الحذف، والحد الأقصى 5000 صف.)'
                  : isAddOperation || isImagesOnly
                  ? '(النموذج فيه ورقة بصف العناوين بس، وورقة «مثال وتعليمات» فيها الأمثلة والشرح، والحد الأقصى 5000 صف.)'
                  : '(الصف الأول عناوين عربية، والصف الثاني مثال توضيحي، والحد الأقصى 5000 صف.)'}
              </span>
            </div>
            {selectedFileName && (
              <div>
                <strong className="text-[var(--text-primary)]">الملف المحدد: </strong>
                <span className="font-mono">{displayFileName || selectedFileName}</span>
                {isWarehouseScoped && (
                  <span>
                    {' • '}المخزن:{' '}
                    <strong className="text-[var(--text-primary)]">
                      {selectedWarehouseObj?.name || 'المخزن الرئيسي'}
                    </strong>
                  </span>
                )}
              </div>
            )}
            {!canViewPurchase && (
              <div className="ui-stock-low font-semibold">
                ملاحظة: تعديل سعر الشراء متاح فقط لمن يملك صلاحية التكلفة (سعر الشراء).
              </div>
            )}
            {isDeleteOperation && (
              <div
                role="alert"
                className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-xs font-bold ui-stock-out flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>تحذير: الحذف نهائي ولا يمكن التراجع عنه</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* رسالة الخطأ */}
      {errorMsg && (
        <div role="alert" className="no-print text-xs font-bold ui-stock-out flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* «تعديل الصور»: المعاينة قبل التأكيد */}
      {isImagesOnly && imagePlan && !imagesReport && !isImagesBusy && (
        <div className="space-y-4">
          <SectionHeading
            title={`معاينة قبل الحفظ (${operationLabel})`}
            actions={
              <button
                type="button"
                onClick={handleConfirmImagesOnly}
                disabled={imagesStorageEnabled === false || !imagePlan.entries.some((en) => en.image && !en.problem)}
                className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-[#168A4A] hover:bg-[#12703C] text-white text-xs font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>تأكيد الاستيراد</span>
              </button>
            }
          />
          <ItemImagesPreview
            mode="images_only"
            plan={imagePlan}
            replace={replaceExistingImages}
            onReplaceChange={setReplaceExistingImages}
            existing={existingImages}
            storageEnabled={imagesStorageEnabled}
          />
        </div>
      )}

      {/* أثناء الحفظ والرفع */}
      {imagesProgress && (
        <ItemImagesProgress
          stage={imagesProgress.stage}
          done={imagesProgress.done}
          total={imagesProgress.total}
          onCancel={handleCancelImages}
          cancelling={isCancellingImages}
        />
      )}

      {/* تقرير الصور */}
      {imagesReport && (
        <div className="space-y-3 pb-4 border-b border-[var(--border-subtle)]">
          <SectionHeading
            title={`تقرير الصور — ${operationLabel}`}
            actions={
              isImagesOnly ? (
                <button
                  type="button"
                  onClick={resetFileAndResults}
                  className="min-h-[44px] px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer"
                >
                  بدء عملية جديدة
                </button>
              ) : undefined
            }
          />
          <ItemImagesReport
            mode={isImagesOnly ? 'images_only' : 'add_items'}
            addedItems={executeResult?.updatedCount}
            report={imagesReport}
            unmatchedImages={imagePlan?.unmatchedImages || []}
          />
        </div>
      )}

      {/* تقرير النتيجة أو المعاينة */}
      {(previewResult || executeResult) && activeSummary && (
        <div className="space-y-5">
          <SectionHeading
            title={
              executeResult
                ? `تقرير النتيجة — ${operationLabel}${
                    activeWarehouseName ? ` (${activeWarehouseName})` : ''
                  }`
                : `معاينة قبل الحفظ (${operationLabel})${
                    activeWarehouseName ? ` — ${activeWarehouseName}` : ''
                  }`
            }
            actions={
              executeResult ? (
                <>
                  {executeResult.errorCount > 0 && (
                    <button
                      type="button"
                      onClick={handleDownloadErrorsFile}
                      disabled={isDownloadingErrors}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#D9524F] hover:bg-[#B42318] text-white text-xs font-bold transition cursor-pointer disabled:opacity-60"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {isDownloadingErrors
                          ? 'جاري تجهيز ملف الأخطاء...'
                          : `تحميل ملف الأخطاء (${executeResult.errorCount})`}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={resetFileAndResults}
                    disabled={isImagesBusy}
                    className="min-h-[44px] px-4 rounded-lg bg-[#1668B2] hover:bg-[#125491] text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                  >
                    بدء عملية جديدة
                  </button>
                </>
              ) : (
                <>
                  {activeSummary.errorCount > 0 && (
                    <button
                      type="button"
                      onClick={handleDownloadErrorsFile}
                      disabled={isDownloadingErrors}
                      className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-out text-xs font-bold transition cursor-pointer disabled:opacity-60"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {isDownloadingErrors
                          ? 'جاري التحميل...'
                          : `تحميل ملف الأخطاء (${activeSummary.errorCount})`}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteConfirmCountInput('');
                      setIsConfirmModalOpen(true);
                    }}
                    disabled={activeSummary.willUpdateCount === 0 || isExecuting}
                    className={`min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg text-white text-xs font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      isDeleteOperation
                        ? 'bg-[#D9524F] hover:bg-[#B42318]'
                        : 'bg-[#168A4A] hover:bg-[#12703C]'
                    }`}
                  >
                    {isDeleteOperation ? <Trash2 className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                    <span>
                      {isAddCategoriesOperation
                        ? `تنفيذ إضافة التصنيفات (${activeSummary.willUpdateCount})`
                        : isDeleteCategoriesOperation
                        ? `تنفيذ حذف التصنيفات (${activeSummary.willUpdateCount})`
                        : isAddOperation
                        ? `تنفيذ الإضافة (${activeSummary.willUpdateCount})`
                        : isDeleteOperation
                        ? `تنفيذ الحذف النهائي (${activeSummary.willUpdateCount})`
                        : `تنفيذ التعديل (${activeSummary.willUpdateCount})`}
                    </span>
                  </button>
                </>
              )
            }
          />

          {executeResult && (
            <div className="text-xs text-[var(--text-secondary)]">
              رقم الدفعة: <span className="font-mono font-bold text-[var(--text-primary)]">{executeResult.batchId}</span>
              {executeResult.fileName ? ` • الملف: ${executeResult.fileName}` : ''}
            </div>
          )}

          {executeResult?.partialSuccess && (
            <div
              role="alert"
              className="p-3.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs font-bold ui-stock-low flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                {executeResult.message ||
                  `حفظ جزئي: تمت إضافة ${executeResult.updatedCount} صف وتعذر حفظ ${executeResult.errorCount} صف — راجع تفاصيل الصفوف أدناه أو حمّل ملف الأخطاء.`}
              </span>
            </div>
          )}

          {executeResult && (isAddCategoriesOperation || isDeleteCategoriesOperation) && executeResult.success && !executeResult.partialSuccess && executeResult.message && (
            <div
              role="status"
              className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs font-bold ui-money-purchase flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{executeResult.message}</span>
            </div>
          )}

          {/* جدول الملخص المضغوط بدل البطاقات الخمس الملوّنة */}
          <ReportSummaryTable rows={summaryRows} ariaLabel="ملخص نتائج ملف الإكسيل" />

          {isAddOperation && imagePlan && !executeResult && (
            <ItemImagesPreview
              mode="add_items"
              plan={imagePlan}
              replace={replaceExistingImages}
              onReplaceChange={setReplaceExistingImages}
              storageEnabled={imagesStorageEnabled}
              disabled={isExecuting}
            />
          )}

          {(() => {
            const activeNewCategories =
              executeResult?.newCategories ||
              executeResult?.summary?.newCategories ||
              previewResult?.newCategories ||
              previewResult?.summary?.newCategories ||
              [];
            if (!Array.isArray(activeNewCategories) || activeNewCategories.length === 0) {
              return null;
            }
            return (
              <div className="p-3.5 rounded-lg border border-[var(--border-color)] bg-[var(--surface-subtle)] text-xs space-y-1.5">
                <div className="font-bold text-[var(--text-primary)]">
                  {executeResult
                    ? `تصنيفات جديدة اتضافت (${activeNewCategories.length}): `
                    : `تصنيفات جديدة ستُضاف تلقائياً (${activeNewCategories.length}): `}
                  <span className="ui-money-purchase">
                    {activeNewCategories
                      .map((c) => `${c.name} (${c.itemsCount} ${c.itemsCount === 1 ? 'صنف' : 'أصناف'})`)
                      .join('، ')}
                  </span>
                </div>
              </div>
            );
          })()}

          {(() => {
            if (!isAddOperation) return null;
            const zeroSaleCount =
              executeResult?.zeroSalePriceCount ??
              executeResult?.summary?.zeroSalePriceCount ??
              previewResult?.zeroSalePriceCount ??
              previewResult?.summary?.zeroSalePriceCount ??
              activeRows.filter(
                (r) => r.status === 'will_update' && Number(r.newPrice ?? 0) === 0
              ).length;
            if (!zeroSaleCount || zeroSaleCount <= 0) return null;
            const warningText =
              executeResult?.zeroSalePriceWarning ||
              executeResult?.summary?.zeroSalePriceWarning ||
              previewResult?.zeroSalePriceWarning ||
              previewResult?.summary?.zeroSalePriceWarning ||
              `تم استيراد ${zeroSaleCount} صنفًا بسعر بيع صفر — راجع أسعارها`;
            return (
              <div
                role="status"
                className="p-3.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs font-bold ui-stock-low flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{warningText}</span>
              </div>
            );
          })()}

          {isDeleteOperation && !executeResult && (
            <div
              role="alert"
              className="p-3.5 rounded-lg border border-red-500/40 bg-red-500/10 text-xs font-bold ui-stock-out flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                {isDeleteCategoriesOperation
                  ? 'الحذف نهائي ولا يمكن التراجع عنه — راجع التصنيفات القابلة للحذف وأسباب رفض الصفوف الأخرى أدناه قبل التأكيد.'
                  : 'الحذف نهائي ولا يمكن التراجع عنه — تأكد من مراجعة الأصناف الجاهزة للحذف أدناه قبل التأكيد.'}
              </span>
            </div>
          )}

          {!executeResult && activeSummary.errorCount > 0 && activeSummary.willUpdateCount > 0 && (
            <div className="text-xs font-semibold ui-stock-low flex items-center gap-2">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                وجود {activeSummary.errorCount} صف به أخطاء لن يمنع{' '}
                {isAddOperation || isAddCategoriesOperation ? 'إضافة' : isDeleteOperation ? 'حذف' : 'تعديل'} الصفوف الصالحة ({activeSummary.willUpdateCount} صف)،
                ويمكنك تحميل ملف الأخطاء لإصلاحها وإعادة رفعها.
              </span>
            </div>
          )}

          {/* فلاتر الصفوف في سطر مضغوط */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                statusFilter === 'ALL'
                  ? 'bg-[#1668B2] text-white'
                  : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              الكل ({activeSummary.totalRows})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('will_update')}
              className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                statusFilter === 'will_update'
                  ? isDeleteOperation
                    ? 'bg-[#D9524F] text-white'
                    : 'bg-[#168A4A] text-white'
                  : `border border-[var(--border-color)] ${isDeleteOperation ? 'ui-stock-out' : 'ui-money-purchase'} hover:bg-[var(--surface-subtle)]`
              }`}
            >
              {executeResult
                ? isAddOperation || isAddCategoriesOperation
                  ? 'تمت إضافته'
                  : isDeleteOperation
                  ? 'تم الحذف نهائيًا'
                  : 'تم تعديله'
                : isAddOperation || isAddCategoriesOperation
                ? 'جاهز للإضافة'
                : isDeleteOperation
                ? 'سيُحذف نهائيًا'
                : 'سيُعدَّل'}{' '}
              ({activeSummary.willUpdateCount})
            </button>
            {warningCount > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('warning')}
                className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'warning'
                    ? 'bg-[#D97706] text-white'
                    : 'border border-[var(--border-color)] ui-stock-low hover:bg-[var(--surface-subtle)]'
                }`}
              >
                تنبيهات ({warningCount})
              </button>
            )}
            <button
              type="button"
              onClick={() => setStatusFilter('unchanged')}
              className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                statusFilter === 'unchanged'
                  ? 'bg-slate-700 text-white'
                  : 'border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              {isAddCategoriesOperation ? 'مكرر / موجود مسبقاً' : 'بدون تغيير'} ({activeSummary.unchangedCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('error')}
              className={`min-h-[44px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                statusFilter === 'error'
                  ? 'bg-[#D9524F] text-white'
                  : 'border border-[var(--border-color)] ui-stock-out hover:bg-[var(--surface-subtle)]'
              }`}
            >
              أخطاء ({activeSummary.errorCount})
            </button>
          </div>

          <SectionHeading title="تفاصيل الصفوف" />

          <CompactTable ariaLabel="جدول معاينة وتفاصيل ملف الإكسيل">
            <thead>
              {isAddCategoriesOperation ? (
                <tr>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الصف</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>التصنيف الرئيسي</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>التصنيف الفرعي</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الإجراء</th>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>الحالة</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>التفاصيل / سبب الرفض</th>
                </tr>
              ) : isDeleteCategoriesOperation ? (
                <tr>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الصف</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>اسم التصنيف</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الموقع بالهرمية</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>الإجراء</th>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>الحالة</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>التفاصيل / سبب الرفض</th>
                </tr>
              ) : (
                <tr>
                  <th className={`text-center ${COMPACT_TABLE_NUM_CLASS}`}>الصف</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>اسم الصنف</th>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>
                    {isAddOperation ? 'النوع' : 'القيمة الحالية'}
                  </th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>
                    {isAddOperation ? 'بيانات الصنف المضاف' : isDeleteOperation ? 'الإجراء' : 'القيمة الجديدة'}
                  </th>
                  <th className={`text-right ${COMPACT_TABLE_NUM_CLASS}`}>الحالة</th>
                  <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>التنبيهات / سبب الرفض</th>
                </tr>
              )}
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-[var(--text-secondary)] py-8">
                    لا توجد صفوف مطابقة لهذا التصنيف
                  </td>
                </tr>
              ) : isAddCategoriesOperation ? (
                filteredRows.map((row) => (
                  <tr key={`${row.rowNumber}-${row.mainCategoryName || row.inputName}-${row.subCategoryName || ''}`}>
                    <td className={`text-center font-mono font-bold text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {row.rowNumber}
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>
                      <div className="font-bold text-[var(--text-primary)]">
                        {row.mainCategoryName || row.inputName || '—'}
                      </div>
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>
                      {row.subCategoryName ? (
                        <span className="font-semibold text-[var(--text-primary)]">{row.subCategoryName}</span>
                      ) : (
                        <span className="text-xs text-[var(--text-secondary)]">— (رئيسي فقط)</span>
                      )}
                    </td>
                    <td className={`font-bold ${COMPACT_TABLE_TEXT_CLASS}`}>
                      <div
                        className={
                          row.status === 'will_update'
                            ? 'ui-money-purchase'
                            : row.status === 'error'
                            ? 'ui-stock-out'
                            : 'text-[var(--text-primary)]'
                        }
                      >
                        {row.newValueDisplay || '—'}
                      </div>
                      {row.currentValueDisplay && (
                        <div className="text-[11px] font-normal text-[var(--text-secondary)] mt-0.5">
                          {row.currentValueDisplay}
                        </div>
                      )}
                    </td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>
                      {row.status === 'will_update' && (
                        <span className="font-bold ui-money-purchase">
                          {executeResult ? 'تمت الإضافة' : 'جاهز للإضافة'}
                        </span>
                      )}
                      {row.status === 'unchanged' && (
                        <span className="font-bold text-[var(--text-secondary)]">مكرر / موجود</span>
                      )}
                      {row.status === 'error' && (
                        <span className="font-bold ui-stock-out">مرفوض</span>
                      )}
                    </td>
                    <td className={`text-xs ${COMPACT_TABLE_TEXT_CLASS}`}>
                      {row.reason && (
                        <div className={row.status === 'error' ? 'ui-stock-out font-bold' : 'text-[var(--text-secondary)] font-semibold'}>
                          {row.reason}
                        </div>
                      )}
                      {!row.reason && row.status === 'will_update' && (
                        <span className="font-medium ui-money-purchase">
                          {executeResult ? 'تم الحفظ بنجاح' : row.currentValueDisplay || 'جاهز للإضافة'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                filteredRows.map((row) => (
                  <tr key={`${row.rowNumber}-${row.itemId || row.inputName}`}>
                    <td className={`text-center font-mono font-bold text-[var(--text-secondary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {row.rowNumber}
                    </td>
                    <td className={COMPACT_TABLE_TEXT_CLASS}>
                      <div className="font-bold text-[var(--text-primary)]">{row.itemName}</div>
                      {row.codeOrBarcode && (
                        <div className="text-[11px] text-[var(--text-secondary)] font-mono mt-0.5">
                          الباركود/الكود: {row.codeOrBarcode}
                        </div>
                      )}
                      {row.matchedBy === 'code_barcode' &&
                        row.inputName &&
                        row.inputName !== row.itemName && (
                          <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                            الاسم بالملف: {row.inputName}
                          </div>
                        )}
                    </td>
                    <td className={`font-semibold text-[var(--text-primary)] ${COMPACT_TABLE_NUM_CLASS}`}>
                      {row.currentValueDisplay || '—'}
                    </td>
                    <td className={`font-bold ${COMPACT_TABLE_TEXT_CLASS}`}>
                      <span
                        className={
                          row.status === 'will_update'
                            ? isDeleteOperation
                              ? 'ui-stock-out'
                              : 'ui-money-purchase'
                            : row.status === 'error'
                            ? 'ui-stock-out'
                            : 'text-[var(--text-primary)]'
                        }
                      >
                        {row.newValueDisplay || '—'}
                      </span>
                    </td>
                    <td className={COMPACT_TABLE_NUM_CLASS}>
                      {row.status === 'will_update' && (
                        <span className={`font-bold ${isDeleteOperation ? 'ui-stock-out' : 'ui-money-purchase'}`}>
                          {executeResult
                            ? isAddOperation
                              ? 'تمت الإضافة'
                              : isDeleteOperation
                              ? 'تم الحذف نهائيًا'
                              : 'تم التعديل'
                            : isAddOperation
                            ? 'جاهز للإضافة'
                            : isDeleteOperation
                            ? 'سيُحذف نهائيًا'
                            : 'سيُعدَّل'}
                        </span>
                      )}
                      {row.status === 'unchanged' && (
                        <span className="font-bold text-[var(--text-secondary)]">بدون تغيير</span>
                      )}
                      {row.status === 'error' && (
                        <span className="font-bold ui-stock-out">مرفوض</span>
                      )}
                      {row.warning && (
                        <div className="text-[11px] font-bold ui-stock-low mt-0.5">تنبيه سعر</div>
                      )}
                    </td>
                    <td className={`text-xs ${COMPACT_TABLE_TEXT_CLASS}`}>
                      {row.reason && <div className="ui-stock-out font-bold">{row.reason}</div>}
                      {row.warning && <div className="ui-stock-low font-bold">{row.warning}</div>}
                      {!row.reason && !row.warning && row.status === 'will_update' && (
                        <span className={`font-medium ${isDeleteOperation ? 'ui-stock-out' : 'ui-money-purchase'}`}>
                          {isAddOperation
                            ? `جاهز للإضافة${activeWarehouseName ? ` في ${activeWarehouseName}` : ''}`
                            : isDeleteCategoriesOperation
                            ? executeResult
                              ? 'تم حذف التصنيف بنجاح'
                              : 'التصنيف موجود وغير مرتبط بأصناف وقابل للحذف'
                            : isDeleteOperation
                            ? 'مطابق بالاسم — رصيده صفر وبلا معاملات'
                            : row.matchedBy === 'code_barcode'
                            ? 'مطابق بالكود/الباركود'
                            : 'مطابق بالاسم الموحد'}
                        </span>
                      )}
                      {!row.reason && row.status === 'unchanged' && (
                        <span className="text-[var(--text-secondary)]">القيمة الجديدة مطابقة للحالية</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </CompactTable>
        </div>
      )}

      {/* Confirmation Modal */}
      {isConfirmModalOpen && activeSummary && (
        <ModalShell
          title={
            isAddCategoriesOperation
              ? 'تأكيد إضافة التصنيفات بالإكسيل'
              : isDeleteCategoriesOperation
              ? 'تأكيد حذف التصنيفات بالإكسيل'
              : isAddOperation
              ? 'تأكيد إضافة الأصناف'
              : isDeleteOperation
              ? 'تأكيد الحذف النهائي للأصناف'
              : 'تأكيد تنفيذ التعديل'
          }
          subtitle={operationLabel}
          onClose={() => {
            if (!isExecuting) {
              setIsConfirmModalOpen(false);
              setDeleteConfirmCountInput('');
            }
          }}
          closeDisabled={isExecuting}
          footer={
            <>
              <button
                type="button"
                onClick={() => {
                  setIsConfirmModalOpen(false);
                  setDeleteConfirmCountInput('');
                }}
                disabled={isExecuting}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition cursor-pointer disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmExecute}
                disabled={isExecuting || !isDeleteConfirmCountValid}
                className={`min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg text-white text-xs font-bold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  isDeleteOperation
                    ? 'bg-[#D9524F] hover:bg-[#B42318]'
                    : 'bg-[#168A4A] hover:bg-[#12703C]'
                }`}
              >
                {isExecuting ? (
                  <>
                    <RotateCw className="w-4 h-4 animate-spin" />
                    <span>جاري التنفيذ...</span>
                  </>
                ) : (
                  <>
                    {isDeleteOperation ? <Trash2 className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                    <span>
                      {isAddCategoriesOperation
                        ? 'تأكيد وإضافة التصنيفات'
                        : isDeleteCategoriesOperation
                        ? `تأكيد حذف التصنيفات (${activeSummary.willUpdateCount})`
                        : isAddOperation
                        ? imagePlan
                          ? 'تأكيد الاستيراد'
                          : 'تأكيد وإضافة الأصناف'
                        : isDeleteOperation
                        ? 'تأكيد الحذف النهائي'
                        : 'تأكيد وتنفيذ التعديل'}
                    </span>
                  </>
                )}
              </button>
            </>
          }
        >
          <div className="space-y-2 text-xs max-w-md">
            <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
              <span className="text-[var(--text-secondary)] font-semibold">اسم الملف:</span>
              <span className="font-bold text-[var(--text-primary)] truncate max-w-[220px]">
                {selectedFileName}
              </span>
            </div>
            {isAddCategoriesOperation && categorySummary ? (
              <>
                <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)] font-semibold">رؤوس جديدة:</span>
                  <span className="font-bold ui-money-purchase">{categorySummary.newRootsCount}</span>
                </div>
                <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)] font-semibold">رؤوس موجودة أُعيد استخدامها:</span>
                  <span className="font-bold text-[var(--text-primary)]">{categorySummary.reusedRootsCount}</span>
                </div>
                <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)] font-semibold">فروع جديدة:</span>
                  <span className="font-bold ui-money-purchase">{categorySummary.newSubsCount}</span>
                </div>
                <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)] font-semibold">مكررات (لن تُكرَّر أو تُعدَّل):</span>
                  <span className="font-bold">{categorySummary.duplicatesCount}</span>
                </div>
                <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)] font-semibold">أخطاء (لن تُنفَّذ):</span>
                  <span className={`font-bold ${activeSummary.errorCount > 0 ? 'ui-stock-out' : 'text-[var(--text-primary)]'}`}>
                    {activeSummary.errorCount}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed pt-2">
                  سيتم إنشاء كل تصنيف رئيسي جديد مرة واحدة وربط التصنيفات الفرعية به عبر مسار إنشاء التصنيفات المعتمد، دون حذف أو إعادة تسمية أي تصنيفات حالية أو تغيير ربط الأصناف.
                </p>
              </>
            ) : isDeleteCategoriesOperation ? (
              <>
                <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)] font-semibold">إجمالي الصفوف في الملف:</span>
                  <span className="font-bold text-[var(--text-primary)]">{activeSummary.totalRows} صف</span>
                </div>
                <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)] font-semibold">عدد التصنيفات التي ستُحذف:</span>
                  <span className="font-bold ui-stock-out">{activeSummary.willUpdateCount} تصنيف</span>
                </div>
                <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)] font-semibold">عدد الصفوف المرفوضة (لن تُحذف):</span>
                  <span className={`font-bold ${activeSummary.errorCount > 0 ? 'ui-stock-out' : 'text-[var(--text-primary)]'}`}>
                    {activeSummary.errorCount} صف
                  </span>
                </div>
                <div className="p-3 mt-2 rounded-lg border border-red-500/40 bg-red-500/10 ui-stock-out font-bold leading-relaxed">
                  تأكيد الحذف: سيتم حذف ({activeSummary.willUpdateCount}) تصنيف نهائياً من النظام (مع حذف التصنيفات الفرعية أولاً ثم الرئيسية إذا كانت مدرجة معاً)، وتجاهل ({activeSummary.errorCount}) صف مرفوض، مع إعادة التحقق في السيرفر لحظة التنفيذ من عدم ارتباط أي تصنيف بأصناف أو فروع غير محذوفة.
                </div>
              </>
            ) : (
              <>
                {activeWarehouseName && (
                  <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                    <span className="text-[var(--text-secondary)] font-semibold">المخزن المحدد:</span>
                    <span className="font-bold text-[var(--text-primary)]">{activeWarehouseName}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)] font-semibold">
                    {isAddOperation
                      ? 'عدد الأصناف التي ستُضاف:'
                      : isDeleteOperation
                      ? 'عدد الأصناف التي ستُحذف نهائيًا:'
                      : 'عدد الأصناف التي ستُعدَّل:'}
                  </span>
                  <span className={`font-bold ${isDeleteOperation ? 'ui-stock-out' : 'ui-money-purchase'}`}>
                    {activeSummary.willUpdateCount} صنف
                  </span>
                </div>
                {isAddOperation &&
                  Array.isArray(previewResult?.newCategories || activeSummary.newCategories) &&
                  (previewResult?.newCategories || activeSummary.newCategories || []).length > 0 && (
                    <div className="py-1.5 border-b border-[var(--border-subtle)] space-y-1">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-[var(--text-secondary)] font-semibold">
                          تصنيفات رئيسية جديدة ستُنشأ عند التأكيد:
                        </span>
                        <span className="font-bold ui-money-purchase">
                          {(previewResult?.newCategories || activeSummary.newCategories || []).length} تصنيف
                        </span>
                      </div>
                      <div className="text-[11px] font-bold ui-money-purchase leading-relaxed">
                        {(previewResult?.newCategories || activeSummary.newCategories || [])
                          .map((c) => `${c.name} (${c.itemsCount} ${c.itemsCount === 1 ? 'صنف' : 'أصناف'})`)
                          .join('، ')}
                      </div>
                    </div>
                  )}
                {warningCount > 0 && (
                  <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                    <span className="ui-stock-low font-semibold">أصناف بتنبيهات:</span>
                    <span className="font-bold ui-stock-low">{warningCount} صنف</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                  <span className="text-[var(--text-secondary)] font-semibold">صفوف بدون تغيير:</span>
                  <span className="font-bold">{activeSummary.unchangedCount}</span>
                </div>
                {activeSummary.errorCount > 0 && (
                  <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                    <span className="text-[var(--text-secondary)] font-semibold">صفوف مرفوضة (لن تُنفَّذ):</span>
                    <span className="font-bold ui-stock-out">{activeSummary.errorCount}</span>
                  </div>
                )}
                {isAddOperation && imagePlan && (
                  <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                    <span className="text-[var(--text-secondary)] font-semibold">صور هتترفع بعد حفظ الأصناف:</span>
                    <span className="font-bold">
                      {imagesStorageEnabled === false
                        ? 'تخزين الصور مش مفعّل'
                        : imagePlan.entries.filter((en) => en.image && !en.problem).length.toLocaleString('en-US')}
                    </span>
                  </div>
                )}
                {isDeleteItemsOperation ? (
                  <div className="space-y-3 pt-2">
                    <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 ui-stock-out font-bold leading-relaxed">
                      الحذف نهائي ولا يمكن التراجع عنه. سيتم مسح {activeSummary.willUpdateCount} صنف مع باركوداتها وأرصدة مخازنها وتكاليفها وسجلاتها من النظام بالكامل.
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="bulk-delete-confirm-count"
                        className="block font-bold text-[var(--text-primary)]"
                      >
                        للتأكيد، اكتب عدد الأصناف المقرر حذفها ({activeSummary.willUpdateCount}):
                      </label>
                      <input
                        id="bulk-delete-confirm-count"
                        type="text"
                        inputMode="numeric"
                        value={deleteConfirmCountInput}
                        onChange={(e) => setDeleteConfirmCountInput(e.target.value)}
                        placeholder={`اكتب ${activeSummary.willUpdateCount}`}
                        disabled={isExecuting}
                        className={`${FORM_CONTROL_BASE_CLASS} w-full font-mono font-bold text-center`}
                        autoFocus
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed pt-2">
                    {isAddOperation
                      ? `سيتم إضافة ${activeSummary.willUpdateCount} صنف جديد وتسجيل كمياتها كرصيد افتتاحي بالإكسيل في مخزن «${
                          activeWarehouseName || 'المخزن الرئيسي'
                        }» مع توثيق العملية في سجل التدقيق.`
                      : `سيتم تطبيق «${operationLabel}» على ${activeSummary.willUpdateCount} صنف${
                          activeWarehouseName ? ` في مخزن «${activeWarehouseName}»` : ''
                        } دون المساس بأي فواتير مسجلة سابقاً.`}
                  </p>
                )}
              </>
            )}
          </div>
        </ModalShell>
      )}

      {/* نافذة تأكيد التراجع عن آخر عملية */}
      {isUndoModalOpen && undoStatus?.available && (
        <ModalShell
          title="تأكيد التراجع عن آخر عملية"
          subtitle={undoStatus.operationLabel}
          onClose={() => !isUndoing && setIsUndoModalOpen(false)}
          closeDisabled={isUndoing}
          footer={
            <>
              <button
                type="button"
                onClick={() => setIsUndoModalOpen(false)}
                disabled={isUndoing}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition cursor-pointer disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirmUndo}
                disabled={isUndoing}
                className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-bold transition cursor-pointer disabled:opacity-60"
              >
                {isUndoing ? (
                  <>
                    <RotateCw className="w-4 h-4 animate-spin" />
                    <span>جاري الاستعادة...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    <span>تأكيد التراجع والاستعادة</span>
                  </>
                )}
              </button>
            </>
          }
        >
          <div className="space-y-2 text-xs max-w-md">
            <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
              <span className="text-[var(--text-secondary)] font-semibold">نوع العملية:</span>
              <span className="font-bold text-[var(--text-primary)]">{undoStatus.operationLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
              <span className="text-[var(--text-secondary)] font-semibold">عدد الأصناف المتأثرة:</span>
              <span className="font-bold ui-stock-low">{undoStatus.affectedCount} صنف</span>
            </div>
            {undoStatus.fileName && (
              <div className="flex items-center justify-between gap-4 py-1 border-b border-[var(--border-subtle)]">
                <span className="text-[var(--text-secondary)] font-semibold">الملف:</span>
                <span className="font-bold text-[var(--text-primary)] truncate max-w-[200px]">
                  {undoStatus.fileName}
                </span>
              </div>
            )}
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed pt-2">
              سيتم استعادة القيم السابقة لعدد {undoStatus.affectedCount} صنف وتسجيل حركة عكسية في السجل.
            </p>
          </div>
        </ModalShell>
      )}

      {isExportDialogOpen && (
        <ItemsImageExportDialog
          scopeLabel="كل الأصناف"
          loadItems={async () => {
            const res = await api.getItems();
            return res.items || [];
          }}
          canViewPurchase={canViewPurchase}
          onClose={() => setIsExportDialogOpen(false)}
        />
      )}
    </PageSurface>
  );
};

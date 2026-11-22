import crypto from 'crypto';
import { ALL_PERMISSIONS, ROLE_TEMPLATES } from '../src/utils/permissions.ts';
import { INITIAL_USER_PASSWORD } from './config.ts';
import { DEFAULT_LATEST_ITEM_FIRST } from '../src/shared/latestItemFirst.ts';
import type {
  Item,
  ProductCategory,
  ItemBarcode,
  Platform,
  ItemPlatformCost,
  Invoice,
  InvoiceLine,
  ReturnRecord,
  ReturnLine,
  UserAccount,
  PermissionKey,
  CompanySettings,
  ContactSettings,
  InvoicePrintSettings,
  DisplaySettings,
  AuditLogEntry,
  InvoiceEditLogEntry,
  StockMovement,
  CashboxEntry,
  ItemChangeLogEntry,
  SupplierGroup,
  Supplier,
  SupplierLedgerEntry,
  PurchaseInvoice,
  CustomerGroup,
  Customer,
  CustomerLedgerEntry,
  Cashbox,
  CashboxTransaction,
  CashboxTransfer,
  UserCashboxAssignment,
  ImportBatch,
  Warehouse
} from '../src/types/index.ts';

/**
 * دالة تشفير كلمة المرور مع Salt باستخدام SHA-256 متوافقة تماماً مع Google Apps Script
 */
export function hashPassword(password: string, salt: string): string {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export const OFFLINE_PBKDF2_ITERATIONS = 200000;

/**
 * حساب بصمة التحقق بدون إنترنت PBKDF2-SHA256 (200,000 دورة، مع salt عشوائي مستقل)
 * دون تخزين كلمة المرور نفسها على الإطلاق.
 */
export function computeOfflinePasswordVerifier(
  password: string,
  customSaltHex?: string,
  iterations: number = OFFLINE_PBKDF2_ITERATIONS
): { offlineVerifier: string; offlineSalt: string; offlineIterations: number } {
  const offlineSalt =
    customSaltHex && customSaltHex.trim().length >= 16
      ? customSaltHex.trim()
      : crypto.randomBytes(16).toString('hex');
  const validIterations = Number(iterations) > 0 ? Math.floor(Number(iterations)) : OFFLINE_PBKDF2_ITERATIONS;
  const derived = crypto.pbkdf2Sync(
    Buffer.from(String(password), 'utf8'),
    Buffer.from(offlineSalt, 'utf8'),
    validIterations,
    32,
    'sha256'
  );
  return {
    offlineVerifier: derived.toString('hex'),
    offlineSalt,
    offlineIterations: validIterations
  };
}

export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * دالة تطبيع اسم المستخدم (Username Normalization):
 * - إزالة المسافات في البداية والنهاية
 * - دمج المسافات المتكررة لمسافة واحدة
 * - تحويل الأحرف اللاتينية إلى أحرف صغيرة (lowercase)
 * - الحفاظ على الحروف العربية كما هي
 */
export function normalizeUsername(username: string): string {
  if (!username) return '';
  return String(username)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * فحص صحة اسم المستخدم:
 * يقبل الحروف العربية والإنجليزية والأرقام والمسافات والنقاط والشرطات بطول 2 إلى 40 حرف
 */
export function isValidUsernameFormat(username: string): boolean {
  const norm = normalizeUsername(username);
  if (norm.length < 2 || norm.length > 40) return false;
  return /^[\u0600-\u06FFa-zA-Z0-9._ -]{2,40}$/.test(username.trim());
}

/**
 * التحقق من قواعد كلمة المرور الجديدة في النظام كله:
 * - حرفان أو رقمان على الأقل (طول >= 2)
 * - بدون أي شروط تعقيد (الأرقام فقط أو الحروف فقط مقبولة)
 * - لا تساوي كلمة السر المؤقتة الافتراضية (INITIAL_USER_PASSWORD)
 */
export function validatePasswordRules(
  password: string,
  _role?: string,
  options?: { disallowTempPassword?: boolean }
): { valid: boolean; error?: string } {
  const str = typeof password === 'string' ? password : String(password ?? '');
  if (!str || str.length < 2) {
    return { valid: false, error: 'كلمة السر يجب أن تتكون من حرفين أو رقمين على الأقل' };
  }
  const disallowTemp = options?.disallowTempPassword !== false;
  if (disallowTemp && str === INITIAL_USER_PASSWORD) {
    return { valid: false, error: 'لا يمكن استخدام كلمة السر المؤقتة الافتراضية؛ يرجى اختيار كلمة سر مختلفة' };
  }
  return { valid: true };
}

/**
 * التحقق من رقم التواصل: أرقام فقط مع + اختيارية في البداية (أو نص فارغ)
 */
export function validateContactNumber(value: unknown): { valid: boolean; cleaned: string; error?: string } {
  if (value === undefined || value === null) {
    return { valid: true, cleaned: '' };
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return { valid: true, cleaned: '' };
  }
  if (!/^\+?[0-9]+$/.test(trimmed)) {
    return { valid: false, cleaned: trimmed, error: 'رقم التواصل يجب أن يحتوي على أرقام فقط مع علامة + اختيارية في البداية' };
  }
  return { valid: true, cleaned: trimmed };
}

export interface StoredUser extends UserAccount {
  username: string;
  normalizedUsername: string;
  salt: string;
  passwordHash: string;
}

export const defaultContactSettings: ContactSettings = {
  supportWhatsapp: '',
  supportPhone: '',
  salesWhatsapp: '',
  salesPhone: ''
};

// إعدادات هوية ومظهر الشركة الافتراضية
export const defaultCompanySettings: CompanySettings = {
  storeName: 'مدقق للنظم',
  brandTagline: 'Mudaqqeq Systems - نظام إدارة نقاط البيع والتدقيق المحاسبي للمنصات الرقمية',
  logoUrl: '',
  phone: '01012345678',
  email: 'contact@pos-modaqiq.com',
  address: 'القاهرة، مصر',
  taxNumber: '123-456-789',
  commercialRecord: '987654',
  themeColor: '#0e7490',
  accentColor: '#14b8a6',
  fontFamily: 'Tajawal',
  enableDeliveryFee: false,
  supportWhatsapp: '',
  supportPhone: '',
  salesWhatsapp: '',
  salesPhone: '',
  inactivityTimeoutMinutes: 480
};

// إعدادات الفاتورة والطباعة الافتراضية
export const defaultInvoicePrintSettings: InvoicePrintSettings = {
  paperSize: '80mm',
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
  termsAndConditions: 'البضاعة المباعة يمكن استبدالها أو إرجاعها خلال 14 يومًا بحالتها الأصلية.',
  returnPolicyText: 'يتم احتساب استقطاع شحن المرتجع المقرر للمنصة عند استرجاع المنتج.',
  showHeaderImage: false,
  headerImageUrl: '',
  showCustomerName: true,
  showCustomerPhone: true,
  showCustomerAddress: true,
  showCustomerBalance: false,
  showPaymentDetails: true,
  showItemsCount: true,
  showCashier: true,
  showReceiptPreview: false,
  printableWidthMm: 72,
  showInvoiceNumber: true,
  showDateTime: true,
  showInvoiceStatus: true,
  printedItemLabel: 'name'
};

// إعدادات عرض الأصناف وشاشة المبيعات
export const defaultDisplaySettings: DisplaySettings = {
  showItemImages: true,
  showStockQuantity: true,
  showStockStatusBadge: true,
  showSalePrice: true,
  visibleColumns: ['image', 'name', 'salePrice', 'stock', 'actions'],
  posLayout: 'grid',
  enableQuickBarcodeScan: true,
  confirmInvoiceBeforeSave: true,
  autoFillCashPaid: true,
  enableInlineEdit: false,
  posVisibleCategoryIds: [],
  barcodeScanMode: 'increment',
  latestItemFirst: { ...DEFAULT_LATEST_ITEM_FIRST },
  posShowCustomerAddress: true,
  posShowCustomerPhone: true,
  posShowCustomerBalance: true
};

export const MAIN_WAREHOUSE_ID = 'wh-main-001';

export const initialWarehouses: Warehouse[] = [
  {
    id: MAIN_WAREHOUSE_ID,
    name: 'المخزن الرئيسي',
    status: 'نشط',
    notes: 'المخزن الافتراضي الرئيسي للنظام',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z'
  }
];

/**
 * بناء الحسابات الثلاثة الافتراضية لنظام جديد لا يوجد فيه أي مستخدم:
 * 1) admin (مالك النظام، دور designer)
 * 2) manager (مدير، دور manager)
 * 3) cashier (كاشير، دور employee)
 * جميعها بكلمة السر المؤقتة INITIAL_USER_PASSWORD وحقل mustChangePassword = true
 */
export function buildDefaultInitialUsers(tempPassword: string = INITIAL_USER_PASSWORD): StoredUser[] {
  const adminSalt = '9876543210abcdef9876543210abcdef';
  const managerSalt = 'abcdef1234567890abcdef1234567890';
  const cashierSalt = '1234567890abcdef1234567890abcdef';
  const now = new Date().toISOString();

  return [
    {
      id: 'usr-admin-001',
      username: 'admin',
      normalizedUsername: 'admin',
      name: 'مالك النظام',
      phone: '',
      role: 'designer',
      status: 'active',
      createdAt: now,
      salt: adminSalt,
      passwordHash: hashPassword(tempPassword, adminSalt),
      permissions: ALL_PERMISSIONS.map(p => p.key),
      isOwner: true,
      mustChangePassword: true,
      cashboxConfig: {
        allowedSaleCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
        defaultSaleCashboxId: 'cb-main-001',
        allowedReturnCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
        defaultReturnCashboxId: 'cb-main-001',
        allowedReceiptCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
        allowedPaymentCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
        allowedTransferCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003']
      },
      warehouseConfig: {
        allowedWarehouseIds: [MAIN_WAREHOUSE_ID],
        defaultWarehouseId: MAIN_WAREHOUSE_ID
      }
    },
    {
      id: 'usr-manager-002',
      username: 'manager',
      normalizedUsername: 'manager',
      name: 'مدير النظام',
      phone: '',
      role: 'manager',
      status: 'active',
      createdAt: now,
      salt: managerSalt,
      passwordHash: hashPassword(tempPassword, managerSalt),
      permissions: [...ROLE_TEMPLATES.manager],
      isOwner: false,
      mustChangePassword: true,
      cashboxConfig: {
        allowedSaleCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
        defaultSaleCashboxId: 'cb-main-001',
        allowedReturnCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
        defaultReturnCashboxId: 'cb-main-001',
        allowedReceiptCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
        allowedPaymentCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
        allowedTransferCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003']
      },
      warehouseConfig: {
        allowedWarehouseIds: [MAIN_WAREHOUSE_ID],
        defaultWarehouseId: MAIN_WAREHOUSE_ID
      }
    },
    {
      id: 'usr-cashier-003',
      username: 'cashier',
      normalizedUsername: 'cashier',
      name: 'كاشير',
      phone: '',
      role: 'employee',
      status: 'active',
      createdAt: now,
      salt: cashierSalt,
      passwordHash: hashPassword(tempPassword, cashierSalt),
      permissions: [...ROLE_TEMPLATES.employee],
      isOwner: false,
      mustChangePassword: true,
      cashboxConfig: {
        allowedSaleCashboxIds: ['cb-main-001'],
        defaultSaleCashboxId: 'cb-main-001',
        allowedReturnCashboxIds: ['cb-main-001'],
        defaultReturnCashboxId: 'cb-main-001',
        allowedReceiptCashboxIds: ['cb-main-001'],
        allowedPaymentCashboxIds: [],
        allowedTransferCashboxIds: []
      },
      warehouseConfig: {
        allowedWarehouseIds: [MAIN_WAREHOUSE_ID],
        defaultWarehouseId: MAIN_WAREHOUSE_ID
      }
    }
  ];
}

// المستخدمين المبدئيين في الذاكرة (مع تشفير Salt + SHA-256)
export const initialUsers: StoredUser[] = buildDefaultInitialUsers(INITIAL_USER_PASSWORD);


// المنصات الافتراضية
export const initialPlatforms: Platform[] = [
  {
    id: 'plt-amz-001',
    name: 'أمازون (Amazon.eg)',
    discountPercentage: 14.5,
    pickupFee: 25.0,
    notes: 'منصة أمازون مصر بنظام FBM و FBA',
    status: 'نشطة'
  },
  {
    id: 'plt-jum-002',
    name: 'جوميا (Jumia Egypt)',
    discountPercentage: 12.0,
    pickupFee: 20.0,
    notes: 'عمولة منصة جوميا للتجارة الإلكترونية',
    status: 'نشطة'
  },
  {
    id: 'plt-btech-003',
    name: 'بي تك (B.TECH)',
    discountPercentage: 10.0,
    pickupFee: 0,
    notes: 'مبيعات بي تك أونلاين',
    status: 'نشطة'
  },
  {
    id: 'plt-noon-004',
    name: 'نون (Noon Egypt)',
    discountPercentage: 15.0,
    pickupFee: 30.0,
    notes: 'عمولة منصة نون FBP و FBN',
    status: 'نشطة'
  },
  {
    id: 'plt-dir-005',
    name: 'البيع المباشر / المعرض',
    discountPercentage: 0,
    pickupFee: 0,
    notes: 'بيع نقدي مباشر بدون عمولة منصة',
    status: 'نشطة'
  }
];

// التصنيفات الأولية (قاعدة بيانات التصنيفات الشجرية)
export const initialCategories: ProductCategory[] = [
  {
    id: 'cat-elec',
    name: 'إلكترونيات وأجهزة ذكية',
    parentCategoryId: null,
    status: 'نشط',
    showInPOS: true,
    displayOrder: 1,
    createdAt: '2026-02-10T10:00:00.000Z',
    updatedAt: '2026-02-10T10:00:00.000Z'
  },
  {
    id: 'cat-chargers',
    name: 'شواحن وكابلات سريعة',
    parentCategoryId: 'cat-elec',
    status: 'نشط',
    showInPOS: true,
    displayOrder: 1,
    createdAt: '2026-02-10T10:05:00.000Z',
    updatedAt: '2026-02-10T10:05:00.000Z'
  },
  {
    id: 'cat-audio',
    name: 'سماعات وصوتيات',
    parentCategoryId: 'cat-elec',
    status: 'نشط',
    showInPOS: true,
    displayOrder: 2,
    createdAt: '2026-02-10T10:10:00.000Z',
    updatedAt: '2026-02-10T10:10:00.000Z'
  },
  {
    id: 'cat-appliances',
    name: 'أجهزة منزلية ومطبخ',
    parentCategoryId: null,
    status: 'نشط',
    showInPOS: true,
    displayOrder: 2,
    createdAt: '2026-02-10T10:15:00.000Z',
    updatedAt: '2026-02-10T10:15:00.000Z'
  },
  {
    id: 'cat-kettles',
    name: 'غلايات ومحضرات مشروبات',
    parentCategoryId: 'cat-appliances',
    status: 'نشط',
    showInPOS: true,
    displayOrder: 1,
    createdAt: '2026-02-10T10:20:00.000Z',
    updatedAt: '2026-02-10T10:20:00.000Z'
  }
];

// الأصناف الأولية
export const initialItems: Item[] = [
  {
    id: 'item-ank-65w',
    name: 'شاحن سريع أنكر 65 واط ثلاثي المخارج GaN',
    categoryId: 'cat-chargers',
    imageUrl: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=300&q=80',
    barcode: '6934177720016',
    secondaryBarcodes: ['ANK-65W-BLK', '019464402123'],
    supplier: 'شركة الشرق الأوسط للإلكترونيات',
    taxRate: 14,
    salePrice: 850,
    minPrice: 700,
    purchasePrice: 480,
    packagingCost: 20,
    stockQuantity: 42,
    notes: 'يدعم الشحن السريع للابتوب والهواتف الذكية',
    createdAt: '2026-02-15T10:00:00.000Z',
    status: 'نشط'
  },
  {
    id: 'item-cbl-100w',
    name: 'كابل تايب سي نايلون مضفر 1.8 متر 100W',
    categoryId: 'cat-chargers',
    imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=300&q=80',
    barcode: '6934177720023',
    secondaryBarcodes: ['CBL-100W-NYL'],
    supplier: 'مؤسسة النيل للتوريدات الحديثة',
    taxRate: 14,
    salePrice: 195,
    minPrice: 150,
    purchasePrice: 75,
    packagingCost: 10,
    stockQuantity: 110,
    notes: 'كابل فائق التحمل ومقاوم للقطع',
    createdAt: '2026-02-16T12:00:00.000Z',
    status: 'نشط'
  },
  {
    id: 'item-pods-anc',
    name: 'سماعة أذن لاسلكية عازلة للضوضاء ANC برو',
    categoryId: 'cat-audio',
    imageUrl: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=300&q=80',
    barcode: '6934177720030',
    secondaryBarcodes: ['PODS-PRO-ANC', '840123456789'],
    supplier: 'الشركة العالمية للأجهزة الذكية',
    taxRate: 14,
    salePrice: 1250,
    minPrice: 1000,
    purchasePrice: 650,
    packagingCost: 30,
    stockQuantity: 4, // أقل من الحد لتوضيح النواقص
    notes: 'بطارية تدوم حتى 32 ساعة مع الشحن اللاسلكي',
    createdAt: '2026-02-17T14:30:00.000Z',
    status: 'نشط'
  },
  {
    id: 'item-ktl-med',
    name: 'غلاية مياه ستانلس ستيل صحية 1.8 لتر',
    categoryId: 'cat-kettles',
    imageUrl: '/demo-items/item-ktl-med.svg',
    barcode: '6934177720047',
    secondaryBarcodes: ['KTL-18L-SS'],
    supplier: 'مصنع الدلتا للأجهزة المنزلية',
    taxRate: 0,
    salePrice: 590,
    minPrice: 480,
    purchasePrice: 340,
    packagingCost: 25,
    stockQuantity: 18,
    notes: 'فصل أمان تلقائي عند الغليان',
    createdAt: '2026-02-18T09:15:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-01',
    name: 'شاحن سامسونج 25 واط تايب سي',
    categoryId: 'cat-chargers',
    imageUrl: '/demo-items/demo-01.svg',
    barcode: '6224000100018',
    secondaryBarcodes: ['SAM-25W-TC'],
    supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)',
    taxRate: 14,
    salePrice: 450,
    minPrice: 380,
    purchasePrice: 260,
    packagingCost: 10,
    stockQuantity: 35,
    reorderLimit: 10,
    notes: 'شاحن فائق السرعة Super Fast Charging بمنفذ Type-C',
    createdAt: '2026-02-19T10:00:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-02',
    name: 'باور بانك أنكر 20000 مللي أمبير',
    categoryId: 'cat-chargers',
    imageUrl: '/demo-items/demo-02.svg',
    barcode: '6224000100025',
    secondaryBarcodes: ['ANK-PB-20K'],
    supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)',
    taxRate: 14,
    salePrice: 1350,
    minPrice: 1150,
    purchasePrice: 850,
    packagingCost: 20,
    stockQuantity: 20,
    reorderLimit: 5,
    notes: 'سعة كبيرة مع شحن سريع مزدوج PowerIQ',
    createdAt: '2026-02-19T10:05:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-03',
    name: 'كابل آيفون لايتنينج سريع 1 متر',
    categoryId: 'cat-chargers',
    imageUrl: '/demo-items/demo-03.svg',
    barcode: '6224000100032',
    secondaryBarcodes: ['CBL-IP-1M'],
    supplier: 'مؤسسة النيل للتوريدات الحديثة',
    taxRate: 14,
    salePrice: 220,
    minPrice: 180,
    purchasePrice: 110,
    packagingCost: 8,
    stockQuantity: 60,
    reorderLimit: 15,
    notes: 'يدعم الشحن السريع PD ومعتمد لنقل البيانات',
    createdAt: '2026-02-19T10:10:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-04',
    name: 'شاحن سيارة سريع مزدوج 45 واط',
    categoryId: 'cat-chargers',
    imageUrl: '/demo-items/demo-04.svg',
    barcode: '6224000100049',
    secondaryBarcodes: ['CAR-CHG-45W'],
    supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)',
    taxRate: 14,
    salePrice: 320,
    minPrice: 270,
    purchasePrice: 175,
    packagingCost: 10,
    stockQuantity: 25,
    reorderLimit: 8,
    notes: 'هيكل معدني مقاوم للحرارة بمخرجين USB-C و USB-A',
    createdAt: '2026-02-19T10:15:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-05',
    name: 'مشترك كهرباء ذكي 4 مخارج مع USB',
    categoryId: 'cat-chargers',
    imageUrl: '/demo-items/demo-05.svg',
    barcode: '6224000100056',
    secondaryBarcodes: ['PWR-STR-4U'],
    supplier: 'مؤسسة النيل للتوريدات الحديثة',
    taxRate: 14,
    salePrice: 580,
    minPrice: 500,
    purchasePrice: 340,
    packagingCost: 15,
    stockQuantity: 18,
    reorderLimit: 5,
    notes: 'حماية من تذبذب التيار مع 3 منافذ USB ذكية',
    createdAt: '2026-02-19T10:20:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-06',
    name: 'سماعة رأس بلوتوث محيطية ستوديو',
    categoryId: 'cat-audio',
    imageUrl: '/demo-items/demo-06.svg',
    barcode: '6224000100063',
    secondaryBarcodes: ['HDP-BT-STD'],
    supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)',
    taxRate: 14,
    salePrice: 950,
    minPrice: 800,
    purchasePrice: 560,
    packagingCost: 25,
    stockQuantity: 15,
    reorderLimit: 5,
    notes: 'وسائد أذن مريحة وعزل ضوضاء مع بطارية 40 ساعة',
    createdAt: '2026-02-19T10:25:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-07',
    name: 'مكبر صوت بلوتوث محمول ضد الماء',
    categoryId: 'cat-audio',
    imageUrl: '/demo-items/demo-07.svg',
    barcode: '6224000100070',
    secondaryBarcodes: ['SPK-BT-WP'],
    supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)',
    taxRate: 14,
    salePrice: 780,
    minPrice: 650,
    purchasePrice: 450,
    packagingCost: 20,
    stockQuantity: 22,
    reorderLimit: 6,
    notes: 'صوت ستيريو قوي ومقاومة للماء بمعيار IPX7',
    createdAt: '2026-02-19T10:30:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-08',
    name: 'ميكروفون لاسلكي لتسجيل المحتوى',
    categoryId: 'cat-audio',
    imageUrl: '/demo-items/demo-08.svg',
    barcode: '6224000100087',
    secondaryBarcodes: ['MIC-WL-PRO'],
    supplier: 'مؤسسة النيل للتوريدات الحديثة',
    taxRate: 14,
    salePrice: 650,
    minPrice: 550,
    purchasePrice: 370,
    packagingCost: 15,
    stockQuantity: 12,
    reorderLimit: 5,
    notes: 'ميكروفون مشبك لاسلكي مع فلتر تنقية الصوت',
    createdAt: '2026-02-19T10:35:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-09',
    name: 'سماعة أذن سلكية تايب سي مايك عالي النقاء',
    categoryId: 'cat-audio',
    imageUrl: '/demo-items/demo-09.svg',
    barcode: '6224000100094',
    secondaryBarcodes: ['EAR-TC-HD'],
    supplier: 'مؤسسة النيل للتوريدات الحديثة',
    taxRate: 14,
    salePrice: 190,
    minPrice: 150,
    purchasePrice: 95,
    packagingCost: 8,
    stockQuantity: 45,
    reorderLimit: 12,
    notes: 'مدخل Type-C رقمي مع أزرار تحكم في المكالمات',
    createdAt: '2026-02-19T10:40:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-10',
    name: 'صب ووفر مكتبي ستيريو RGB',
    categoryId: 'cat-audio',
    imageUrl: '/demo-items/demo-10.svg',
    barcode: '6224000100100',
    secondaryBarcodes: ['SUB-RGB-21'],
    supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)',
    taxRate: 14,
    salePrice: 890,
    minPrice: 750,
    purchasePrice: 520,
    packagingCost: 30,
    stockQuantity: 8,
    reorderLimit: 4,
    notes: 'نظام صوتي 2.1 للكمبيوتر والشاشات مع إضاءة محيطية',
    createdAt: '2026-02-19T10:45:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-11',
    name: 'ساعة ذكية رياضية ضد الماء شاشة AMOLED',
    categoryId: 'cat-elec',
    imageUrl: '/demo-items/demo-11.svg',
    barcode: '6224000100117',
    secondaryBarcodes: ['WTC-SM-AMO'],
    supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)',
    taxRate: 14,
    salePrice: 1450,
    minPrice: 1250,
    purchasePrice: 880,
    packagingCost: 25,
    stockQuantity: 14,
    reorderLimit: 5,
    notes: 'تدعم المكالمات البلوتوث وقياس نبضات القلب والأكسجين',
    createdAt: '2026-02-19T10:50:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-12',
    name: 'ماوس لاسلكي صامت مريح لليد',
    categoryId: 'cat-elec',
    imageUrl: '/demo-items/demo-12.svg',
    barcode: '6224000100124',
    secondaryBarcodes: ['MSE-WL-SLNT'],
    supplier: 'مؤسسة النيل للتوريدات الحديثة',
    taxRate: 14,
    salePrice: 290,
    minPrice: 240,
    purchasePrice: 155,
    packagingCost: 10,
    stockQuantity: 40,
    reorderLimit: 10,
    notes: 'حساسية 1600 DPI قابلة للتعديل مع نقرات صامتة',
    createdAt: '2026-02-19T10:55:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-13',
    name: 'لوحة مفاتيح ميكانيكية مضيئة RGB',
    categoryId: 'cat-elec',
    imageUrl: '/demo-items/demo-13.svg',
    barcode: '6224000100131',
    secondaryBarcodes: ['KBD-MECH-RGB'],
    supplier: 'مؤسسة النيل للتوريدات الحديثة',
    taxRate: 14,
    salePrice: 1100,
    minPrice: 950,
    purchasePrice: 660,
    packagingCost: 25,
    stockQuantity: 10,
    reorderLimit: 4,
    notes: 'حروف عربي وإنجليزي محفورة بالليزر مع سويتشات حمراء',
    createdAt: '2026-02-19T11:00:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-14',
    name: 'حامل لابتوب ألومنيوم قابل للطي',
    categoryId: 'cat-elec',
    imageUrl: '/demo-items/demo-14.svg',
    barcode: '6224000100148',
    secondaryBarcodes: ['STD-LAP-ALU'],
    supplier: 'مؤسسة النيل للتوريدات الحديثة',
    taxRate: 14,
    salePrice: 420,
    minPrice: 350,
    purchasePrice: 230,
    packagingCost: 15,
    stockQuantity: 28,
    reorderLimit: 8,
    notes: '6 مستويات ارتفاع وتهوية ممتازة لجميع أحجام اللابتوب',
    createdAt: '2026-02-19T11:05:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-15',
    name: 'كاميرا ويب FHD 1080p مع ميكروفون',
    categoryId: 'cat-elec',
    imageUrl: '/demo-items/demo-15.svg',
    barcode: '6224000100155',
    secondaryBarcodes: ['CAM-FHD-1080'],
    supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)',
    taxRate: 14,
    salePrice: 720,
    minPrice: 600,
    purchasePrice: 410,
    packagingCost: 15,
    stockQuantity: 6,
    reorderLimit: 8,
    notes: 'تصحيح إضاءة تلقائي للاجتماعات والبث المباشر',
    createdAt: '2026-02-19T11:10:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-16',
    name: 'ماكينة قهوة تركي كهربائية بالسينسور',
    categoryId: 'cat-kettles',
    imageUrl: '/demo-items/demo-16.svg',
    barcode: '6224000100162',
    secondaryBarcodes: ['COF-TRK-SNS'],
    supplier: 'مصنع الدلتا للأجهزة المنزلية',
    taxRate: 0,
    salePrice: 1650,
    minPrice: 1450,
    purchasePrice: 1020,
    packagingCost: 35,
    stockQuantity: 12,
    reorderLimit: 4,
    notes: 'حساس منع الفوران وتنبيه صوتي عند جهوزية القهوة',
    createdAt: '2026-02-19T11:15:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-17',
    name: 'غلاية مياه زجاج بيركس مضيئة 1.7 لتر',
    categoryId: 'cat-kettles',
    imageUrl: '/demo-items/demo-17.svg',
    barcode: '6224000100179',
    secondaryBarcodes: ['KTL-GLS-17L'],
    supplier: 'مصنع الدلتا للأجهزة المنزلية',
    taxRate: 0,
    salePrice: 680,
    minPrice: 580,
    purchasePrice: 390,
    packagingCost: 25,
    stockQuantity: 20,
    reorderLimit: 6,
    notes: 'زجاج حراري صحي مع إضاءة LED زرقاء أثناء الغليان',
    createdAt: '2026-02-19T11:20:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-18',
    name: 'مضرب نسكافيه ولبن كهربائي ستانلس',
    categoryId: 'cat-kettles',
    imageUrl: '/demo-items/demo-18.svg',
    barcode: '6224000100186',
    secondaryBarcodes: ['FRT-MLK-SS'],
    supplier: 'مصنع الدلتا للأجهزة المنزلية',
    taxRate: 0,
    salePrice: 180,
    minPrice: 140,
    purchasePrice: 90,
    packagingCost: 10,
    stockQuantity: 50,
    reorderLimit: 15,
    notes: 'خفق سريع لرغوة الكابتشينو واللاتيه مع حامل مكتبي',
    createdAt: '2026-02-19T11:25:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-19',
    name: 'خلاط كهربائي 500 واط مع مطحنة توابل',
    categoryId: 'cat-appliances',
    imageUrl: '/demo-items/demo-19.svg',
    barcode: '6224000100193',
    secondaryBarcodes: ['BLD-500W-GR'],
    supplier: 'مصنع الدلتا للأجهزة المنزلية',
    taxRate: 0,
    salePrice: 1280,
    minPrice: 1100,
    purchasePrice: 780,
    packagingCost: 40,
    stockQuantity: 9,
    reorderLimit: 5,
    notes: 'شفرات ستانلس ستيل رباعية لجرش الثلج والخلط السريع',
    createdAt: '2026-02-19T11:30:00.000Z',
    status: 'نشط'
  },
  {
    id: 'demo-20',
    name: 'مكواة بخار سيراميك 2200 واط',
    categoryId: 'cat-appliances',
    imageUrl: '/demo-items/demo-20.svg',
    barcode: '6224000100209',
    secondaryBarcodes: ['IRN-STM-2200'],
    supplier: 'مصنع الدلتا للأجهزة المنزلية',
    taxRate: 0,
    salePrice: 980,
    minPrice: 840,
    purchasePrice: 580,
    packagingCost: 30,
    stockQuantity: 0,
    reorderLimit: 5,
    notes: 'قاعدة سيراميك مانعة للالتصاق مع خاصية التنظيف الذاتي',
    createdAt: '2026-02-19T11:35:00.000Z',
    status: 'نشط'
  }
];

// سجلات الباركودات المرتبطة بالأصناف
export const initialItemBarcodes: ItemBarcode[] = [
  { itemId: 'item-ank-65w', barcode: '6934177720016', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'item-ank-65w', barcode: 'ANK-65W-BLK', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'item-ank-65w', barcode: '019464402123', type: 'secondary', label: 'باركود الشحنة', active: true },
  { itemId: 'item-cbl-100w', barcode: '6934177720023', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'item-cbl-100w', barcode: 'CBL-100W-NYL', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'item-pods-anc', barcode: '6934177720030', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'item-pods-anc', barcode: 'PODS-PRO-ANC', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'item-pods-anc', barcode: '840123456789', type: 'secondary', label: 'كود UPC الدولي', active: true },
  { itemId: 'item-ktl-med', barcode: '6934177720047', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'item-ktl-med', barcode: 'KTL-18L-SS', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-01', barcode: '6224000100018', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-01', barcode: 'SAM-25W-TC', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-02', barcode: '6224000100025', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-02', barcode: 'ANK-PB-20K', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-03', barcode: '6224000100032', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-03', barcode: 'CBL-IP-1M', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-04', barcode: '6224000100049', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-04', barcode: 'CAR-CHG-45W', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-05', barcode: '6224000100056', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-05', barcode: 'PWR-STR-4U', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-06', barcode: '6224000100063', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-06', barcode: 'HDP-BT-STD', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-07', barcode: '6224000100070', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-07', barcode: 'SPK-BT-WP', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-08', barcode: '6224000100087', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-08', barcode: 'MIC-WL-PRO', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-09', barcode: '6224000100094', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-09', barcode: 'EAR-TC-HD', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-10', barcode: '6224000100100', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-10', barcode: 'SUB-RGB-21', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-11', barcode: '6224000100117', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-11', barcode: 'WTC-SM-AMO', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-12', barcode: '6224000100124', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-12', barcode: 'MSE-WL-SLNT', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-13', barcode: '6224000100131', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-13', barcode: 'KBD-MECH-RGB', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-14', barcode: '6224000100148', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-14', barcode: 'STD-LAP-ALU', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-15', barcode: '6224000100155', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-15', barcode: 'CAM-FHD-1080', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-16', barcode: '6224000100162', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-16', barcode: 'COF-TRK-SNS', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-17', barcode: '6224000100179', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-17', barcode: 'KTL-GLS-17L', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-18', barcode: '6224000100186', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-18', barcode: 'FRT-MLK-SS', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-19', barcode: '6224000100193', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-19', barcode: 'BLD-500W-GR', type: 'secondary', label: 'رمز التخزين SKU', active: true },
  { itemId: 'demo-20', barcode: '6224000100209', type: 'primary', label: 'الباركود المصنعي', active: true },
  { itemId: 'demo-20', barcode: 'IRN-STM-2200', type: 'secondary', label: 'رمز التخزين SKU', active: true }
];

// تكاليف شحن الصنف على المنصة وخصم شحن المرتجع
export const initialItemPlatformCosts: ItemPlatformCost[] = [
  {
    itemId: 'item-ank-65w',
    platformId: 'plt-amz-001',
    returnShippingDeduction: 25
  },
  {
    itemId: 'item-ank-65w',
    platformId: 'plt-noon-004',
    returnShippingDeduction: 30
  },
  {
    itemId: 'item-cbl-100w',
    platformId: 'plt-amz-001',
    returnShippingDeduction: 15
  },
  {
    itemId: 'item-pods-anc',
    platformId: 'plt-noon-004',
    returnShippingDeduction: 25
  },
  { itemId: 'demo-01', platformId: 'plt-amz-001', returnShippingDeduction: 20 },
  { itemId: 'demo-01', platformId: 'plt-noon-004', returnShippingDeduction: 25 },
  { itemId: 'demo-02', platformId: 'plt-amz-001', returnShippingDeduction: 30 },
  { itemId: 'demo-02', platformId: 'plt-noon-004', returnShippingDeduction: 30 },
  { itemId: 'demo-03', platformId: 'plt-amz-001', returnShippingDeduction: 15 },
  { itemId: 'demo-03', platformId: 'plt-noon-004', returnShippingDeduction: 20 },
  { itemId: 'demo-04', platformId: 'plt-amz-001', returnShippingDeduction: 20 },
  { itemId: 'demo-04', platformId: 'plt-noon-004', returnShippingDeduction: 25 },
  { itemId: 'demo-05', platformId: 'plt-amz-001', returnShippingDeduction: 25 },
  { itemId: 'demo-05', platformId: 'plt-noon-004', returnShippingDeduction: 30 },
  { itemId: 'demo-06', platformId: 'plt-amz-001', returnShippingDeduction: 25 },
  { itemId: 'demo-06', platformId: 'plt-noon-004', returnShippingDeduction: 30 },
  { itemId: 'demo-07', platformId: 'plt-amz-001', returnShippingDeduction: 25 },
  { itemId: 'demo-07', platformId: 'plt-noon-004', returnShippingDeduction: 30 },
  { itemId: 'demo-08', platformId: 'plt-amz-001', returnShippingDeduction: 20 },
  { itemId: 'demo-08', platformId: 'plt-noon-004', returnShippingDeduction: 25 },
  { itemId: 'demo-09', platformId: 'plt-amz-001', returnShippingDeduction: 15 },
  { itemId: 'demo-09', platformId: 'plt-noon-004', returnShippingDeduction: 20 },
  { itemId: 'demo-10', platformId: 'plt-amz-001', returnShippingDeduction: 35 },
  { itemId: 'demo-10', platformId: 'plt-noon-004', returnShippingDeduction: 35 },
  { itemId: 'demo-11', platformId: 'plt-amz-001', returnShippingDeduction: 25 },
  { itemId: 'demo-11', platformId: 'plt-noon-004', returnShippingDeduction: 30 },
  { itemId: 'demo-12', platformId: 'plt-amz-001', returnShippingDeduction: 15 },
  { itemId: 'demo-12', platformId: 'plt-noon-004', returnShippingDeduction: 20 },
  { itemId: 'demo-13', platformId: 'plt-amz-001', returnShippingDeduction: 30 },
  { itemId: 'demo-13', platformId: 'plt-noon-004', returnShippingDeduction: 30 },
  { itemId: 'demo-14', platformId: 'plt-amz-001', returnShippingDeduction: 25 },
  { itemId: 'demo-14', platformId: 'plt-noon-004', returnShippingDeduction: 30 },
  { itemId: 'demo-15', platformId: 'plt-amz-001', returnShippingDeduction: 20 },
  { itemId: 'demo-15', platformId: 'plt-noon-004', returnShippingDeduction: 25 },
  { itemId: 'demo-16', platformId: 'plt-amz-001', returnShippingDeduction: 35 },
  { itemId: 'demo-16', platformId: 'plt-noon-004', returnShippingDeduction: 40 },
  { itemId: 'demo-17', platformId: 'plt-amz-001', returnShippingDeduction: 30 },
  { itemId: 'demo-17', platformId: 'plt-noon-004', returnShippingDeduction: 35 },
  { itemId: 'demo-18', platformId: 'plt-amz-001', returnShippingDeduction: 15 },
  { itemId: 'demo-18', platformId: 'plt-noon-004', returnShippingDeduction: 20 },
  { itemId: 'demo-19', platformId: 'plt-amz-001', returnShippingDeduction: 40 },
  { itemId: 'demo-19', platformId: 'plt-noon-004', returnShippingDeduction: 45 },
  { itemId: 'demo-20', platformId: 'plt-amz-001', returnShippingDeduction: 35 },
  { itemId: 'demo-20', platformId: 'plt-noon-004', returnShippingDeduction: 35 }
];

// الفواتير الأولية مع لقطة الأسعار والتكاليف وقت البيع Snapshot
export const initialInvoices: Invoice[] = [
  {
    invoiceNumber: 'INV-20260220-4102',
    date: '2026-02-20T14:20:00.000Z',
    platform: 'أمازون (Amazon.eg)',
    totalBeforeDiscount: 1895,
    discountAmount: 274.78, // 14.5% خصم المنصة
    deliveryFee: 0,
    netAmount: 1620.22,
    profit: 535.22,
    status: 'تم البيع',
    notes: 'طلب شحن FBM من أمازون #408-9821345-1234567',
    createdBy: 'المهندس عبدالله (المدير العام)',
    lines: [
      {
        invoiceNumber: 'INV-20260220-4102',
        itemId: 'item-ank-65w',
        itemNameAtSale: 'شاحن سريع أنكر 65 واط ثلاثي المخارج GaN',
        quantity: 2,
        salePriceAtSale: 850,
        purchasePriceAtSale: 480,
        packagingCostAtSale: 20,
        platformDiscountPercentAtSale: 14.5,
        unitDiscountValue: 123.25,
        unitNet: 726.75,
        unitProfit: 226.75
      },
      {
        invoiceNumber: 'INV-20260220-4102',
        itemId: 'item-cbl-100w',
        itemNameAtSale: 'كابل تايب سي نايلون مضفر 1.8 متر 100W',
        quantity: 1,
        salePriceAtSale: 195,
        purchasePriceAtSale: 75,
        packagingCostAtSale: 10,
        platformDiscountPercentAtSale: 14.5,
        unitDiscountValue: 28.28,
        unitNet: 166.72,
        unitProfit: 81.72
      }
    ]
  },
  {
    invoiceNumber: 'INV-20260221-5290',
    date: '2026-02-21T18:10:00.000Z',
    platform: 'نون (Noon Egypt)',
    totalBeforeDiscount: 1250,
    discountAmount: 187.5, // 15%
    deliveryFee: 0,
    netAmount: 1062.5,
    profit: 382.5,
    status: 'تم البيع',
    notes: 'طلب نون إكسبريس EG-NOON-884102',
    createdBy: 'أحمد سعيد (كاشير)',
    lines: [
      {
        invoiceNumber: 'INV-20260221-5290',
        itemId: 'item-pods-anc',
        itemNameAtSale: 'سماعة أذن لاسلكية عازلة للضوضاء ANC برو',
        quantity: 1,
        salePriceAtSale: 1250,
        purchasePriceAtSale: 650,
        packagingCostAtSale: 30,
        platformDiscountPercentAtSale: 15.0,
        unitDiscountValue: 187.5,
        unitNet: 1062.5,
        unitProfit: 382.5
      }
    ]
  }
];

export const initialReturns: ReturnRecord[] = [
  {
    returnNumber: 'RET-20260222-3110',
    invoiceNumber: 'INV-20260220-4102',
    date: '2026-02-22T15:30:00.000Z',
    returnedItemsSummary: 'كابل تايب سي نايلون مضفر (1)',
    totalReturnShippingDeduction: 15,
    returnReason: 'استرجاع عميل منصة - تراجع العميل',
    notes: 'الصنف سليم في علبته وتمت إعادته للمخزن',
    createdBy: 'المهندس عبدالله (المدير العام)',
    lines: [
      {
        returnNumber: 'RET-20260222-3110',
        invoiceNumber: 'INV-20260220-4102',
        invoiceLineIndex: 2,
        itemId: 'item-cbl-100w',
        returnedQuantity: 1,
        returnShippingDeductionPerUnit: 15,
        totalLineReturnShippingDeduction: 15,
        itemCondition: 'يرجع المخزن'
      }
    ]
  }
];

export const initialInvoiceEditLogs: InvoiceEditLogEntry[] = [];

export const initialItemChangeLogs: ItemChangeLogEntry[] = [
  {
    id: 'log-chg-001',
    itemId: 'item-ank-65w',
    itemName: 'شاحن سريع أنكر 65 واط ثلاثي المخارج GaN',
    fieldName: 'salePrice',
    oldValue: 800,
    newValue: 850,
    userName: 'المهندس عبدالله (المدير العام)',
    timestamp: '2026-02-18T10:00:00.000Z',
    reason: 'تحديث تسعير الموزع الرسمي'
  }
];

export const initialStockMovements: StockMovement[] = [
  {
    id: 'sm-001',
    date: '2026-02-15T09:00:00.000Z',
    itemId: 'item-ank-65w',
    itemName: 'شاحن سريع أنكر 65 واط ثلاثي المخارج GaN',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-2026-001',
    quantity: 45,
    balanceAfter: 45,
    notes: 'رصيد افتتاحي عند تدشين النظام',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-002',
    date: '2026-02-16T11:00:00.000Z',
    itemId: 'item-cbl-100w',
    itemName: 'كابل تايب سي نايلون مضفر 1.8 متر 100W',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-2026-002',
    quantity: 111,
    balanceAfter: 111,
    notes: 'رصيد افتتاحي',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-003',
    date: '2026-02-20T14:20:00.000Z',
    itemId: 'item-ank-65w',
    itemName: 'شاحن سريع أنكر 65 واط ثلاثي المخارج GaN',
    movementType: 'بيع',
    documentNumber: 'INV-20260220-4102',
    quantity: -2,
    balanceAfter: 43,
    notes: 'فاتورة مبيعات أمازون',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-004',
    date: '2026-02-20T14:20:00.000Z',
    itemId: 'item-cbl-100w',
    itemName: 'كابل تايب سي نايلون مضفر 1.8 متر 100W',
    movementType: 'بيع',
    documentNumber: 'INV-20260220-4102',
    quantity: -1,
    balanceAfter: 110,
    notes: 'فاتورة مبيعات أمازون',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-005',
    date: '2026-02-22T15:30:00.000Z',
    itemId: 'item-cbl-100w',
    itemName: 'كابل تايب سي نايلون مضفر 1.8 متر 100W',
    movementType: 'مرتجع',
    documentNumber: 'RET-20260222-3110',
    quantity: 1,
    balanceAfter: 111,
    notes: 'إعادة للمخزن بعد فحص الصنف',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-01',
    date: '2026-02-19T10:00:00.000Z',
    itemId: 'demo-01',
    itemName: 'شاحن سامسونج 25 واط تايب سي',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-01',
    quantity: 35,
    balanceAfter: 35,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-02',
    date: '2026-02-19T10:05:00.000Z',
    itemId: 'demo-02',
    itemName: 'باور بانك أنكر 20000 مللي أمبير',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-02',
    quantity: 20,
    balanceAfter: 20,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-03',
    date: '2026-02-19T10:10:00.000Z',
    itemId: 'demo-03',
    itemName: 'كابل آيفون لايتنينج سريع 1 متر',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-03',
    quantity: 60,
    balanceAfter: 60,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-04',
    date: '2026-02-19T10:15:00.000Z',
    itemId: 'demo-04',
    itemName: 'شاحن سيارة سريع مزدوج 45 واط',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-04',
    quantity: 25,
    balanceAfter: 25,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-05',
    date: '2026-02-19T10:20:00.000Z',
    itemId: 'demo-05',
    itemName: 'مشترك كهرباء ذكي 4 مخارج مع USB',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-05',
    quantity: 18,
    balanceAfter: 18,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-06',
    date: '2026-02-19T10:25:00.000Z',
    itemId: 'demo-06',
    itemName: 'سماعة رأس بلوتوث محيطية ستوديو',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-06',
    quantity: 15,
    balanceAfter: 15,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-07',
    date: '2026-02-19T10:30:00.000Z',
    itemId: 'demo-07',
    itemName: 'مكبر صوت بلوتوث محمول ضد الماء',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-07',
    quantity: 22,
    balanceAfter: 22,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-08',
    date: '2026-02-19T10:35:00.000Z',
    itemId: 'demo-08',
    itemName: 'ميكروفون لاسلكي لتسجيل المحتوى',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-08',
    quantity: 12,
    balanceAfter: 12,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-09',
    date: '2026-02-19T10:40:00.000Z',
    itemId: 'demo-09',
    itemName: 'سماعة أذن سلكية تايب سي مايك عالي النقاء',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-09',
    quantity: 45,
    balanceAfter: 45,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-10',
    date: '2026-02-19T10:45:00.000Z',
    itemId: 'demo-10',
    itemName: 'صب ووفر مكتبي ستيريو RGB',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-10',
    quantity: 8,
    balanceAfter: 8,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-11',
    date: '2026-02-19T10:50:00.000Z',
    itemId: 'demo-11',
    itemName: 'ساعة ذكية رياضية ضد الماء شاشة AMOLED',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-11',
    quantity: 14,
    balanceAfter: 14,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-12',
    date: '2026-02-19T10:55:00.000Z',
    itemId: 'demo-12',
    itemName: 'ماوس لاسلكي صامت مريح لليد',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-12',
    quantity: 40,
    balanceAfter: 40,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-13',
    date: '2026-02-19T11:00:00.000Z',
    itemId: 'demo-13',
    itemName: 'لوحة مفاتيح ميكانيكية مضيئة RGB',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-13',
    quantity: 10,
    balanceAfter: 10,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-14',
    date: '2026-02-19T11:05:00.000Z',
    itemId: 'demo-14',
    itemName: 'حامل لابتوب ألومنيوم قابل للطي',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-14',
    quantity: 28,
    balanceAfter: 28,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-15',
    date: '2026-02-19T11:10:00.000Z',
    itemId: 'demo-15',
    itemName: 'كاميرا ويب FHD 1080p مع ميكروفون',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-15',
    quantity: 6,
    balanceAfter: 6,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-16',
    date: '2026-02-19T11:15:00.000Z',
    itemId: 'demo-16',
    itemName: 'ماكينة قهوة تركي كهربائية بالسينسور',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-16',
    quantity: 12,
    balanceAfter: 12,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-17',
    date: '2026-02-19T11:20:00.000Z',
    itemId: 'demo-17',
    itemName: 'غلاية مياه زجاج بيركس مضيئة 1.7 لتر',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-17',
    quantity: 20,
    balanceAfter: 20,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-18',
    date: '2026-02-19T11:25:00.000Z',
    itemId: 'demo-18',
    itemName: 'مضرب نسكافيه ولبن كهربائي ستانلس',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-18',
    quantity: 50,
    balanceAfter: 50,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sm-demo-19',
    date: '2026-02-19T11:30:00.000Z',
    itemId: 'demo-19',
    itemName: 'خلاط كهربائي 500 واط مع مطحنة توابل',
    movementType: 'استيراد رصيد افتتاحي',
    documentNumber: 'OPN-DEMO-19',
    quantity: 9,
    balanceAfter: 9,
    notes: 'رصيد افتتاحي للأصناف التجريبية',
    userName: 'المهندس عبدالله (المدير العام)'
  }
];

export const initialCashboxEntries: CashboxEntry[] = [
  {
    id: 'cbe-001',
    date: '2026-02-20T14:20:00.000Z',
    documentNumber: 'INV-20260220-4102',
    entryType: 'إيراد بيع',
    cashboxName: 'الخزينة الرئيسية (الكاشير)',
    amount: 1680.22,
    platform: 'أمازون (Amazon.eg)',
    notes: 'تحصيل قيمة الفاتورة',
    userName: 'المهندس عبدالله (المدير العام)'
  }
];

// 1. الموردين ومجموعاتهم
export const initialSupplierGroups: SupplierGroup[] = [
  { id: 'grp-sup-01', name: 'موردو الإلكترونيات والشواحن', description: 'توريدات أجهزة الشحن والملحقات الأصلية', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'grp-sup-02', name: 'مستوردو الكابلات والوصلات', description: 'كابلات Type-C و Lightning فائقة التحمل', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'grp-sup-03', name: 'موردي الأجهزة المنزلية الصغيرة', description: 'غلايات وأجهزة كهربائية صغيرة', createdAt: '2026-01-01T00:00:00.000Z' }
];

export const initialSuppliers: Supplier[] = [
  {
    id: 'sup-ank-001',
    name: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)',
    code: 'SUP-ANK-01',
    groupId: 'grp-sup-01',
    phone: '01099887766',
    phoneSecondary: '0223456789',
    email: 'info@middleeast-electronics.eg',
    address: 'المنطقة الصناعية، مدينة نصر، القاهرة',
    taxNumber: '456-789-123',
    commercialRecord: '109823',
    openingBalance: 15000,
    currentBalance: 15000,
    status: 'active',
    notes: 'المورد المعتمد لمنتجات Anker مع ضمان استبدال رسمي',
    createdAt: '2026-01-10T09:00:00.000Z'
  },
  {
    id: 'sup-nile-002',
    name: 'مؤسسة النيل للتوريدات الحديثة',
    code: 'SUP-NILE-02',
    groupId: 'grp-sup-02',
    phone: '01122334455',
    address: 'شارع التحرير، الدقي، الجيزة',
    taxNumber: '654-321-987',
    openingBalance: 0,
    currentBalance: 4200,
    status: 'active',
    notes: 'توريد كابلات وبطاريات بجودة معتمدة',
    createdAt: '2026-01-15T10:30:00.000Z'
  },
  {
    id: 'sup-delta-003',
    name: 'مصنع الدلتا للأجهزة المنزلية',
    code: 'SUP-DELTA-03',
    groupId: 'grp-sup-03',
    phone: '01233445566',
    address: 'العاشر من رمضان، المنطقة الصناعية الثالثة',
    openingBalance: 0,
    currentBalance: 0,
    status: 'active',
    notes: 'توريدات غلايات وأدوات منزلية كهربائية',
    createdAt: '2026-01-20T12:00:00.000Z'
  }
];

export const initialSupplierLedger: SupplierLedgerEntry[] = [
  {
    id: 'sledg-001',
    date: '2026-01-10T09:00:00.000Z',
    supplierId: 'sup-ank-001',
    supplierName: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)',
    transactionType: 'رصيد افتتاحي',
    documentNumber: 'OPN-SUP-01',
    debit: 0,
    credit: 15000,
    balanceAfter: 15000,
    statement: 'تسجيل رصيد افتتاحي مستحق للمورد',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sledg-002',
    date: '2026-02-12T10:00:00.000Z',
    supplierId: 'sup-nile-002',
    supplierName: 'مؤسسة النيل للتوريدات الحديثة',
    transactionType: 'فاتورة شراء',
    documentNumber: 'PUR-20260212-101',
    debit: 0,
    credit: 8200,
    balanceAfter: 8200,
    statement: 'فاتورة شراء كابلات تايب سي دفعة فبراير',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'sledg-003',
    date: '2026-02-15T14:00:00.000Z',
    supplierId: 'sup-nile-002',
    supplierName: 'مؤسسة النيل للتوريدات الحديثة',
    transactionType: 'سند صرف',
    documentNumber: 'PV-20260215-01',
    debit: 4000,
    credit: 0,
    balanceAfter: 4200,
    statement: 'سداد دفعة نقدية من حساب المورد من الخزينة الرئيسية',
    userName: 'المهندس عبدالله (المدير العام)'
  }
];

export const initialPurchases: PurchaseInvoice[] = [
  {
    invoiceNumber: 'PUR-20260212-101',
    supplierInvoiceNumber: 'INV-SUP-88912',
    date: '2026-02-12T10:00:00.000Z',
    supplierId: 'sup-nile-002',
    supplierName: 'مؤسسة النيل للتوريدات الحديثة',
    subtotal: 7500,
    taxAmount: 700,
    discountAmount: 0,
    shippingFee: 0,
    netTotal: 8200,
    paidAmount: 4000,
    remainingAmount: 4200,
    paymentStatus: 'مدفوع جزئياً',
    paymentMethod: 'نقدي',
    cashboxId: 'cb-main-001',
    receivingStatus: 'مستلم بالكامل',
    createdBy: 'المهندس عبدالله (المدير العام)',
    notes: 'توريد كابلات مضفرة معتمدة',
    createdAt: '2026-02-12T10:00:00.000Z',
    lines: [
      {
        invoiceNumber: 'PUR-20260212-101',
        lineIndex: 1,
        itemId: 'item-cbl-100w',
        sku: 'CBL-100W-NYL',
        itemName: 'كابل تايب سي نايلون مضفر 1.8 متر 100W',
        quantity: 100,
        receivedQuantity: 100,
        unitCost: 75,
        packagingCost: 10,
        taxRate: 14,
        taxAmount: 700,
        discountAmount: 0,
        totalLine: 8200,
        barcode: '6934177720023'
      }
    ]
  }
];

// 2. العملاء ومجموعاتهم
export const initialCustomerGroups: CustomerGroup[] = [
  { id: 'cgrp-01', name: 'عملاء القطاعي (أفراد)', discountPercent: 0, description: 'المبيعات المباشرة والشراء الفردي', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'cgrp-02', name: 'تجار ومحلات الجملة', discountPercent: 7.5, description: 'موزعون ومحلات تجارية بأسعار الجملة', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'cgrp-03', name: 'شركات ومؤسسات B2B', discountPercent: 5.0, description: 'توريدات مباشرة للشركات مع فواتير ضريبية', createdAt: '2026-01-01T00:00:00.000Z' }
];

export const initialCustomers: Customer[] = [
  {
    id: 'cust-ret-001',
    name: 'عميل نقدي / مبيعات المعرض',
    code: 'CUST-CASH',
    groupId: 'cgrp-01',
    phone: '01000000000',
    openingBalance: 0,
    currentBalance: 0,
    status: 'active',
    notes: 'حساب افتراضي للمبيعات النقدية السريعة',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'cust-whl-002',
    name: 'مؤسسة الأمل للإلكترونيات (تاجر جملة)',
    code: 'CUST-AMAL-02',
    groupId: 'cgrp-02',
    phone: '01011223344',
    address: 'ميدان العتبة، القاهرة',
    taxNumber: '112-233-445',
    creditLimit: 50000,
    openingBalance: 0,
    currentBalance: 8500,
    status: 'active',
    notes: 'عميل جملة موثوق بسقف ائتمان 50,000 ج.م',
    createdAt: '2026-01-20T10:00:00.000Z'
  },
  {
    id: 'cust-corp-003',
    name: 'شركة النور للحلول البرمجية',
    code: 'CUST-NOOR-03',
    groupId: 'cgrp-03',
    phone: '01223344556',
    address: 'القرية الذكية، الجيزة',
    taxNumber: '998-877-665',
    creditLimit: 30000,
    openingBalance: 0,
    currentBalance: 0,
    status: 'active',
    notes: 'مشتريات ملحقات للموظفين',
    createdAt: '2026-02-01T11:00:00.000Z'
  }
];

export const initialCustomerLedger: CustomerLedgerEntry[] = [
  {
    id: 'cledg-001',
    date: '2026-02-18T12:00:00.000Z',
    customerId: 'cust-whl-002',
    customerName: 'مؤسسة الأمل للإلكترونيات (تاجر جملة)',
    transactionType: 'فاتورة بيع',
    documentNumber: 'INV-20260218-091',
    debit: 13500,
    credit: 0,
    balanceAfter: 13500,
    statement: 'فاتورة بيع 15 شاحن أنكر 65W جملة',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'cledg-002',
    date: '2026-02-21T15:00:00.000Z',
    customerId: 'cust-whl-002',
    customerName: 'مؤسسة الأمل للإلكترونيات (تاجر جملة)',
    transactionType: 'سند قبض',
    documentNumber: 'RV-20260221-02',
    debit: 0,
    credit: 5000,
    balanceAfter: 8500,
    statement: 'سداد دفعة نقدية استلمت بالخزينة الرئيسية',
    userName: 'المهندس عبدالله (المدير العام)'
  }
];

// 3. الخزائن والتحويلات المالية
export const initialCashboxes: Cashbox[] = [
  {
    id: 'cb-main-001',
    name: 'الخزينة الرئيسية (الكاشير)',
    type: 'نقدية محلية',
    currency: 'EGP',
    openingBalance: 10000,
    currentBalance: 12680.22,
    status: 'active',
    notes: 'خزينة الكاشير الرئيسية للنقدية بالمعرض',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'cb-bank-002',
    name: 'حساب البنك الأهلي المصري (NBE)',
    type: 'حساب بنكي',
    currency: 'EGP',
    openingBalance: 50000,
    currentBalance: 50000,
    status: 'active',
    notes: 'الحساب البنكي التجاري للتحويلات والمعاملات الكبيرة',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'cb-vod-003',
    name: 'محفظة فودافون كاش التجارية',
    type: 'محفظة إلكترونية',
    currency: 'EGP',
    openingBalance: 5000,
    currentBalance: 5000,
    status: 'active',
    notes: 'محفظة استقبال دفعات المنصات والعملاء أونلاين',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
];

export const initialCashboxTransactions: CashboxTransaction[] = [
  {
    id: 'cbtx-001',
    date: '2026-01-01T00:00:00.000Z',
    cashboxId: 'cb-main-001',
    cashboxName: 'الخزينة الرئيسية (الكاشير)',
    type: 'إيداع',
    documentNumber: 'OPN-CB-01',
    amount: 10000,
    balanceAfter: 10000,
    statement: 'رصيد افتتاحي للخزينة النقدية الرئيسية',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'cbtx-002',
    date: '2026-02-15T14:00:00.000Z',
    cashboxId: 'cb-main-001',
    cashboxName: 'الخزينة الرئيسية (الكاشير)',
    type: 'سند صرف مورد',
    documentNumber: 'PV-20260215-01',
    amount: -4000,
    balanceAfter: 6000,
    party: 'مؤسسة النيل للتوريدات الحديثة',
    statement: 'سداد دفعة من مشتريات كابلات',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'cbtx-003',
    date: '2026-02-20T14:20:00.000Z',
    cashboxId: 'cb-main-001',
    cashboxName: 'الخزينة الرئيسية (الكاشير)',
    type: 'إيراد مبيعات',
    documentNumber: 'INV-20260220-4102',
    amount: 1680.22,
    balanceAfter: 7680.22,
    party: 'أمازون (Amazon.eg)',
    statement: 'إيراد مبيعات فاتورة أونلاين',
    userName: 'المهندس عبدالله (المدير العام)'
  },
  {
    id: 'cbtx-004',
    date: '2026-02-21T15:00:00.000Z',
    cashboxId: 'cb-main-001',
    cashboxName: 'الخزينة الرئيسية (الكاشير)',
    type: 'سند قبض عميل',
    documentNumber: 'RV-20260221-02',
    amount: 5000,
    balanceAfter: 12680.22,
    party: 'مؤسسة الأمل للإلكترونيات (تاجر جملة)',
    statement: 'تحصيل دفعة من حساب عميل جملة',
    userName: 'المهندس عبدالله (المدير العام)'
  }
];

export const initialCashboxTransfers: CashboxTransfer[] = [
  {
    transferNumber: 'TRF-20260220-01',
    date: '2026-02-20T16:00:00.000Z',
    fromCashboxId: 'cb-main-001',
    fromCashboxName: 'الخزينة الرئيسية (الكاشير)',
    toCashboxId: 'cb-bank-002',
    toCashboxName: 'حساب البنك الأهلي المصري (NBE)',
    amount: 5000,
    fee: 0,
    netReceived: 5000,
    transferredBy: 'المهندس عبدالله (المدير العام)',
    receivedBy: 'المهندس عبدالله (المدير العام)',
    status: 'مكتمل',
    notes: 'إيداع بنكي لحصيلة مبيعات الأسبوع'
  }
];

export const initialUserCashboxAssignments: UserCashboxAssignment[] = [
  {
    id: 'ucba-001',
    userId: 'usr-admin-001',
    userName: 'المهندس عبدالله (مصمم ومالك النظام)',
    cashboxId: 'cb-main-001',
    cashboxName: 'الخزينة الرئيسية (الكاشير)',
    permissionType: 'إدارة كاملة',
    isDefault: true,
    status: 'active'
  },
  {
    id: 'ucba-002',
    userId: 'usr-admin-001',
    userName: 'المهندس عبدالله (مصمم ومالك النظام)',
    cashboxId: 'cb-bank-002',
    cashboxName: 'حساب البنك الأهلي المصري (NBE)',
    permissionType: 'إدارة كاملة',
    isDefault: false,
    status: 'active'
  },
  {
    id: 'ucba-003',
    userId: 'usr-cashier-002',
    userName: 'أحمد كاشير (نقطة البيع)',
    cashboxId: 'cb-main-001',
    cashboxName: 'الخزينة الرئيسية (الكاشير)',
    permissionType: 'إيداع وسحب',
    isDefault: true,
    status: 'active'
  }
];

export const initialImportBatches: ImportBatch[] = [
  {
    id: 'BATCH-20260215-01',
    timestamp: '2026-02-15T10:00:00.000Z',
    dataType: 'أصناف',
    sourceName: 'قائمة_أصناف_أولية.xlsx',
    totalRows: 4,
    successRows: 4,
    failedRows: 0,
    userName: 'المهندس عبدالله (المدير العام)',
    notes: 'استيراد ناجح للأصناف الأساسية'
  }
];


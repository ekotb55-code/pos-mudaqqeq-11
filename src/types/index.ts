export type UserRole = 'designer' | 'manager' | 'employee';

// مفاتيح الصلاحيات المركزية للنظام (Deny by default)
export type PermissionKey =
  // 1. لوحة التحكم
  | 'dashboard.view'
  | 'dashboard.view_cashboxes'
  // 2. الأصناف
  | 'items.view'
  | 'items.create'
  | 'items.edit'
  | 'items.status'
  | 'items.delete'
  // 3. الأسعار
  | 'prices.view_sale'
  | 'prices.view_purchase'
  | 'prices.view_packaging'
  | 'prices.override_min_price'
  // 4. المخزون
  | 'stock.view'
  | 'stock.edit'
  | 'stock.adjust'
  | 'stock.alerts'
  | 'stock.override_negative'
  // 5. المنصات
  | 'platforms.view'
  | 'platforms.create'
  | 'platforms.edit'
  | 'platforms.status'
  | 'platforms.pricing'
  // 6. الفواتير
  | 'invoices.view'
  | 'invoices.view_in_pos'
  | 'invoices.create'
  | 'invoices.edit'
  | 'invoices.cancel'
  | 'invoices.print'
  | 'invoices.export'
  | 'invoices.collect_credit'
  | 'invoices.edit_cash_paid'
  | 'invoices.edit_price_before_save'
  | 'invoices.edit_tax_before_save'
  | 'pos.edit_rates'
  | 'invoices.edit_after_save'
  | 'invoices.edit_price_after_save'
  | 'invoices.edit_tax_after_save'
  | 'invoices.edit_quantity_after_save'
  | 'invoices.edit_items_after_save'
  | 'invoices.edit_platform_after_save'
  | 'invoices.edit_customer_after_save'
  | 'invoices.edit_discount_shipping_after_save'
  | 'invoices.edit_cashbox_after_save'
  // 7. المرتجعات
  | 'returns.view'
  | 'returns.create'
  | 'returns.approve'
  | 'returns.restock'
  // 8. الأرباح والتقارير
  | 'reports.view_profit'
  | 'reports.view_costs'
  | 'reports.view_reports'
  | 'reports.export'
  // 9. المستخدمون
  | 'users.view'
  | 'users.create'
  | 'users.edit'
  | 'users.status'
  // 10. الصلاحيات
  | 'permissions.view'
  | 'permissions.manage'
  // 11. إعدادات الشركة والمظهر
  | 'settings.company_appearance'
  // 12. إعدادات الفاتورة والطباعة
  | 'settings.invoice_print'
  // 13. إعدادات عرض الأصناف وشاشة المبيعات
  | 'settings.display_customization'
  // 14. إعدادات النظام والربط
  | 'settings.system_integration'
  | 'settings.backup'
  | 'settings.bank_link'
  | 'settings.bank_templates'
  | 'settings.sales_rules'
  | 'settings.ui_scale'
  | 'settings.visitor_display'
  | 'visitor.display'
  | 'items.print_labels'
  | 'settings.label_print'
  | 'settings.invoice_numbering'
  | 'delivery.settings'
  | 'delivery.view'
  | 'delivery.manage'
  | 'delivery.edit_fee'
  | 'delivery.settle'
  | 'delivery.reports'
  | 'delivery.driver'
  | 'settings.reset_operations'
  | 'settings.factory_reset'
  | 'settings.negative_stock'
  // 15. عرض سجل التدقيق
  | 'audit.view'
  // 16. الموردين والمشتريات
  | 'suppliers.view'
  | 'suppliers.create'
  | 'suppliers.edit'
  | 'suppliers.delete'
  | 'purchases.view'
  | 'purchases.create'
  | 'purchases.return'
  // 17. العملاء
  | 'customers.view'
  | 'customers.create'
  | 'customers.edit'
  // 18. الخزائن والتحويلات المالية
  | 'cashbox.view'
  | 'cashbox.create'
  | 'cashbox.transfer'
  | 'cashbox.receipt'
  | 'cashbox.payment'
  // 19. استيراد وتصدير الأصناف
  | 'items.import_export'
  | 'products.export'
  | 'products.bulk_edit_excel'
  | 'products.inline_edit'
  // 20. إدارة التصنيفات
  | 'categories.view'
  | 'categories.manage'
  // 21. تقارير حركة وتعديلات المخزون والتقسيط وتقارير المنصات
  | 'reports.item_movement.view'
  | 'reports.unsold_cart_items.view'
  | 'reports.stock_adjustments.view'
  | 'reports.bnpl_view'
  | 'reports.platform_view'
  // 22. إدارة المزامنة والعمل بدون إنترنت
  | 'offline.manage'
  // 23. إدارة المخازن المتعددة
  | 'warehouses.view'
  | 'warehouses.manage'
  | 'warehouses.transfer';

export interface PermissionDefinition {
  key: PermissionKey;
  label: string;
  category: string;
  description: string;
  designerOnly?: boolean;
}

export interface Warehouse {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'نشط' | 'موقوف';
  notes?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface WarehouseStock {
  itemId: string;
  warehouseId: string;
  quantity: number;
  reorderLimit?: number | null;
  updatedAt?: string;
}

export interface UserWarehouseConfig {
  allowedWarehouseIds: string[];
  defaultWarehouseId?: string;
}

export interface WarehouseItemBreakdown {
  warehouseId: string;
  warehouseName: string;
  status: string;
  isDefault: boolean;
  quantity: number;
  reorderLimit?: number;
  customReorderLimit?: number | null;
}

export interface UserWarehousesResponse {
  success: boolean;
  userId?: string;
  role?: UserRole;
  seesAllWarehouses?: boolean;
  warehouseConfig?: UserWarehouseConfig;
  warehouses?: Warehouse[];
  error?: string;
}

export interface UserCashboxConfig {
  allowedSaleCashboxIds: string[];
  defaultSaleCashboxId?: string;
  allowedReturnCashboxIds: string[];
  defaultReturnCashboxId?: string;
  allowedReceiptCashboxIds: string[];
  allowedPaymentCashboxIds: string[];
  allowedTransferCashboxIds: string[];
}

export interface UserAccount {
  id: string;
  username: string; // اسم المستخدم (عربي أو إنجليزي مع أرقام)
  name: string; // الاسم الكامل الظاهر
  phone?: string; // اختياري للتواصل
  role: UserRole;
  status: 'active' | 'inactive' | 'نشط' | 'موقوف';
  permissions: PermissionKey[];
  cashboxConfig?: UserCashboxConfig;
  warehouseConfig?: UserWarehouseConfig;
  createdAt?: string;
  isOwner?: boolean;
  mustChangePassword?: boolean;
  offlineVerifier?: string;
  offlineSalt?: string;
  offlineIterations?: number;
  permissionsUpdatedAt?: string;
  permissionsUpdatedByDevice?: string;
}

export interface AuthSession {
  token: string;
  user: UserAccount;
  expiresAt: number;
  offline?: boolean;
}

export type InactivityTimeoutMinutes = 15 | 30 | 60 | 120 | 240 | 480 | 720 | 1440;

export const INACTIVITY_TIMEOUT_OPTIONS_MINUTES: readonly InactivityTimeoutMinutes[] = [
  15,
  30,
  60,
  120,
  240,
  480,
  720,
  1440
];

export const DEFAULT_INACTIVITY_TIMEOUT_MINUTES: InactivityTimeoutMinutes = 480;

export function isValidInactivityTimeoutMinutes(value: unknown): value is InactivityTimeoutMinutes {
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) && (INACTIVITY_TIMEOUT_OPTIONS_MINUTES as readonly number[]).includes(num);
}

export function normalizeInactivityTimeoutMinutes(value: unknown): InactivityTimeoutMinutes {
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof num === 'number' && Number.isFinite(num) && (INACTIVITY_TIMEOUT_OPTIONS_MINUTES as readonly number[]).includes(num)) {
    return num as InactivityTimeoutMinutes;
  }
  return DEFAULT_INACTIVITY_TIMEOUT_MINUTES;
}

export interface ActiveUserSessionInfo {
  sessionId: string;
  userId: string;
  username: string;
  name: string;
  role: UserRole;
  deviceName: string;
  deviceId?: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  isCurrentSession?: boolean;
}

export type AppTheme = 'light-sky' | 'dark' | 'current' | 'aurora' | 'aurora-sky';
export const VALID_APP_THEMES: readonly AppTheme[] = [
  'light-sky',
  'dark',
  'current',
  'aurora',
  'aurora-sky'
];
export function isValidAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && (VALID_APP_THEMES as readonly string[]).includes(value);
}
export type MotionMode = 'on' | 'off';

export interface ContactSettings {
  supportWhatsapp: string;
  supportPhone: string;
  salesWhatsapp: string;
  salesPhone: string;
}

export type KeyboardShortcutActionId =
  | 'pos.save_and_print'
  | 'pos.save_only'
  | 'pos.cancel_invoice'
  | 'pos.focus_barcode'
  | 'pos.focus_search'
  | 'pos.focus_paid'
  | 'nav.pos'
  | 'nav.dashboard'
  | 'nav.items'
  | 'nav.invoices'
  | 'nav.customers'
  | 'nav.reports'
  | 'general.save_form'
  | 'general.add_new'
  | 'general.focus_search'
  | 'general.print_page'
  | 'general.close_or_back';

export interface KeyboardShortcutBinding {
  key: string;
  enabled: boolean;
}

export interface KeyboardShortcutsSettings {
  enabled: boolean;
  bindings: Record<KeyboardShortcutActionId, KeyboardShortcutBinding>;
}

// 1. هوية الشركة ومظهر التطبيق
export interface CompanySettings {
  storeName: string;
  brandTagline: string;
  logoUrl: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
  commercialRecord: string;
  themeColor: string; // مثل '#0e7490'
  accentColor: string; // مثل '#14b8a6'
  fontFamily: string; // 'Tajawal' | 'Cairo' | 'sans-serif'
  customCss?: string;
  appTheme?: AppTheme;
  motionEnabled?: boolean;
  enableDeliveryFee?: boolean;
  supportWhatsapp?: string;
  supportPhone?: string;
  salesWhatsapp?: string;
  salesPhone?: string;
  keyboardShortcuts?: KeyboardShortcutsSettings;
  inactivityTimeoutMinutes?: InactivityTimeoutMinutes;
}

// 2. إعدادات الفواتير والطباعة
export interface InvoicePrintSettings {
  paperSize: '58mm' | '80mm' | 'a4' | 'custom';
  customWidthMm?: number;
  showLogo: boolean;
  showCompanyName: boolean;
  showTagline: boolean;
  showTaxNumber: boolean;
  showCommercialRecord: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showCustomerInfo?: boolean;
  showPlatform: boolean;
  showDiscounts: boolean;
  showBarcode: boolean;
  showNotes: boolean;
  autoFillCashPaid?: boolean;
  headerText: string;
  footerText: string;
  termsAndConditions: string;
  returnPolicyText: string;

  // إعدادات وتخصيصات الطباعة الجديدة
  showHeaderImage?: boolean;
  headerImageUrl?: string;
  showCustomerName?: boolean;
  showCustomerPhone?: boolean;
  showCustomerAddress?: boolean;
  showCustomerBalance?: boolean;
  showPaymentDetails?: boolean;
  showItemsCount?: boolean;
  showCashier?: boolean;

  // إعدادات الطباعة المباشرة وإصلاح العرض والتحكم بالهيدر
  showReceiptPreview?: boolean;
  printableWidthMm?: number;
  showInvoiceNumber?: boolean;
  showDateTime?: boolean;
  showInvoiceStatus?: boolean;
  printedItemLabel?: 'name' | 'printName';
}

export type BarcodeScanQuantityMode = 'increment' | 'edit_quantity';

export type LatestItemFirstScreenKey =
  | 'pos'
  | 'purchases'
  | 'salesReturn'
  | 'purchaseReturn'
  | 'warehouseTransfer'
  | 'editInvoice';

export interface LatestItemFirstSettings {
  /** نقطة البيع */
  pos: boolean;
  /** فاتورة المشتريات */
  purchases: boolean;
  /** مرتجع المبيعات */
  salesReturn: boolean;
  /** مرتجع المشتريات */
  purchaseReturn: boolean;
  /** التحويل بين المخازن */
  warehouseTransfer: boolean;
  /** تعديل الفاتورة المحفوظة */
  editInvoice: boolean;
}

// 3. إعدادات عرض الأصناف وشاشة المبيعات
export interface DisplaySettings {
  showItemImages: boolean;
  showStockQuantity: boolean;
  showStockStatusBadge: boolean;
  showSalePrice: boolean;
  visibleColumns: string[];
  posLayout: 'grid' | 'compact' | 'list';
  enableQuickBarcodeScan: boolean;
  confirmInvoiceBeforeSave: boolean;
  autoFillCashPaid?: boolean;
  enableInlineEdit?: boolean;
  keyboardShortcuts?: KeyboardShortcutsSettings;
  /** معرّفات التصنيفات المختارة للعرض في شاشة نقطة البيع فقط */
  posVisibleCategoryIds?: string[];
  /** طريقة إضافة الكمية عند مسح الباركود على مستوى المنشأة */
  barcodeScanMode?: BarcodeScanQuantityMode;
  /** إعداد مستقل لكل شاشة معاملات لترتيب آخر صنف مُضاف/ممسوح في أول القائمة */
  latestItemFirst?: LatestItemFirstSettings;
  /** إظهار عنوان العميل داخل شاشة نقطة البيع */
  posShowCustomerAddress?: boolean;
  /** إظهار رقم هاتف العميل داخل شاشة نقطة البيع */
  posShowCustomerPhone?: boolean;
  /** إظهار رصيد العميل داخل شاشة نقطة البيع */
  posShowCustomerBalance?: boolean;
}

// 4. سجل التدقيق
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
}

export interface ItemBarcode {
  id?: string;
  itemId: string;
  barcode: string;
  type: 'primary' | 'secondary';
  label?: string;
  active?: boolean;
  createdAt?: string;
}

export interface TaxSettings {
  taxInclusive: boolean; // هل سعر البيع شامل الضريبة (true) أم تُضاف فوق السعر (false)
  platformCommissionOn: 'before_tax' | 'after_tax'; // هل عمولة المنصة تُحسب قبل أم بعد الضريبة
}

export interface StockSettings {
  allowNegativeStockSale: boolean;
  allowNegativeWarehouseTransfer?: boolean;
}

export interface ProductCategory {
  id: string;
  name: string;
  parentCategoryId?: string | null;
  status: 'active' | 'inactive' | 'نشط' | 'موقوف' | 'معطل';
  showInPOS: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt?: string;
  level?: number;
  parentName?: string;
  itemCount?: number;
  subcategories?: ProductCategory[];
}

export interface Item {
  id: string;
  name: string;
  printName?: string;
  imageUrl: string;
  categoryId?: string; // معرّف التصنيف
  categoryName?: string; // اسم التصنيف الحي أو المحفوظ
  barcode?: string; // الباركود الأساسي
  secondaryBarcodes?: string[]; // الباركودات الفرعية
  barcodes?: ItemBarcode[]; // سجلات الباركود التفصيلية
  sku?: string; // كود الصنف SKU
  supplier?: string; // المورد أو المورد الافتراضي
  unit?: string; // وحدة القياس (قطعة، علبة، كرتونة، إلخ)
  taxRate?: number; // نسبة الضريبة المئوية % (افتراضي 0%)
  salePrice: number;
  minPrice?: number; // الحد الأدنى لسعر البيع (لا يجوز البيع بأقل منه إلا بصلاحية صريحة)
  purchasePrice?: number; // متاح للمخوّلين فقط
  packagingCost?: number; // متاح للمخوّلين فقط
  stockQuantity: number;
  reorderLimit?: number; // حد إعادة الطلب
  notes: string;
  createdAt: string;
  updatedAt?: string;
  purchaseDate?: string;
  expiryDate?: string;
  status: 'active' | 'inactive' | 'نشط' | 'موقوف' | 'مؤرشف';
  enableBnpl?: boolean;
  bnplPercentage?: number;
  pickupFee?: number; // رسوم الالتقاط للقطعة (اختياري)
  platformIds?: string[]; // معرفات المنصات المتاحة لهذا الصنف (فارغ أو غير محدد = كل المنصات)
  warehouseId?: string;
  warehouseName?: string;
  totalStockQuantity?: number;
  generalReorderLimit?: number;
  warehouseStocks?: Array<{
    warehouseId: string;
    warehouseName?: string;
    quantity: number;
    reorderLimit: number;
  }>;
}

export interface Platform {
  id: string;
  name: string;
  discountPercentage: number;
  pickupFee?: number; // رسوم الالتقاط (جنيه لكل قطعة)
  pickupFeeMode?: 'platform' | 'product'; // طريقة رسوم الالتقاط: ثابتة على مستوى المنصة أو حسب الصنف
  enableBnpl?: boolean;
  bnplPercentage?: number;
  currentBalance?: number;
  notes: string;
  status: 'active' | 'inactive' | 'نشطة' | 'موقوفة';
}

export interface ItemPlatformCost {
  itemId: string;
  platformId: string;
  returnShippingDeduction: number;
}

export interface InvoiceLine {
  invoiceNumber: string;
  itemId: string;
  itemNameAtSale: string;
  itemPrintNameAtSale?: string;
  barcodeAtSale?: string;
  quantity: number;
  salePriceAtSale: number;
  baseUnitPrice?: number; // السعر الأساسي للوحدة (بدون زيادة BNPL)
  customerUnitPrice?: number; // سعر البيع للعميل شاملاً زيادة BNPL
  bnplPercent?: number; // نسبة زيادة BNPL المطبقة %
  bnplUnitAmount?: number; // قيمة زيادة BNPL المضافة للوحدة
  totalBnplAmount?: number; // إجمالي زيادة BNPL للسطر
  bnplDeductionUnit?: number; // قيمة استقطاع BNPL للوحدة
  totalBnplDeduction?: number; // إجمالي استقطاع BNPL للسطر
  purchasePriceAtSale?: number; // للمخوّلين فقط
  packagingCostAtSale?: number; // للمخوّلين فقط
  taxRateAtSale?: number; // نسبة الضريبة المطبقة وقت البيع %
  unitTaxAmount?: number; // قيمة الضريبة للقطعة
  platformDiscountPercentAtSale: number;
  unitDiscountValue: number;
  unitPickupFee?: number; // رسوم الالتقاط للوحدة وقت البيع
  totalPickupFee?: number; // إجمالي رسوم الالتقاط لهذا السطر
  unitNet: number;
  unitProfit?: number; // للمخوّلين فقط
}

export interface Invoice {
  invoiceNumber: string;
  date: string;
  platform: string;
  platformName?: string;
  platformId?: string;
  /** رقم الطلب المكتوب على المنصة (اختياري، لفواتير المنصات فقط) */
  platformOrderId?: string;
  customerName?: string;
  customerId?: string;
  cashboxName?: string;
  cashboxId?: string;
  warehouseId?: string;
  warehouseName?: string;
  idempotencyKey?: string;
  cartId?: string;
  paymentType?: 'نقدي' | 'آجل' | 'جزئي';
  /** delivery = الدفع عند الاستلام (بيتسوّى من شاشة التوصيل) */
  creditPartyType?: 'customer' | 'platform' | 'delivery';
  creditPartyId?: string;
  creditPartyName?: string;
  creditDueAmount?: number;
  creditStatus?: 'معلّقة' | 'مسددة';
  paidAmount?: number;
  remainingAmount?: number;
  paymentMethod?: string;
  referenceNumber?: string;
  totalBeforeDiscount: number;
  discountAmount: number;
  pickupFeeAmount?: number; // إجمالي رسوم الالتقاط للفاتورة
  deliveryFee?: number; // رسوم التوصيل
  deliveryOrderId?: string; // طلب التوصيل (لو الفاتورة توصيل)
  preparationId?: string; // معرّف طلب تحضير التوصيل المرتبط (إن وجد)
  preparationNumber?: string; // رقم طلب تحضير التوصيل المرتبط (PRP-...)
  bnplTotalAmount?: number; // إجمالي خصم / زيادة تقسيط المنصة BNPL
  bnplEnabled?: boolean; // حالة تفعيل BNPL على الفاتورة
  bnplPercentApplied?: number; // نسبة BNPL المطبقة على الفاتورة %
  commissionPercentApplied?: number; // نسبة خصم/عمولة المنصة المطبقة على الفاتورة %
  taxAmount?: number; // إجمالي الضريبة
  netAmount: number;
  profit?: number; // للمخوّلين فقط
  status: 'تم البيع' | 'مرتجع جزئي' | 'مرتجع' | 'ملغاة' | 'معلّقة' | 'مسددة';
  notes: string;
  createdBy: string;
  cashierName?: string;
  editCount?: number;
  lastEditedAt?: string;
  lastEditedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  isOffline?: boolean;
  offlinePending?: boolean;
  offlineCollectionPending?: boolean;
  needsReview?: boolean;
  reviewReasons?: string[];
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  deviceId?: string;
  offlineDeviceId?: string;
  offlineProvisionalNo?: string;
  tempInvoiceNumber?: string;
  deviceName?: string;
  deviceTime?: string;
  receivedAt?: string;
  lines: InvoiceLine[];
}

export interface InvoiceEditLogEntry {
  id: string;
  invoiceNumber: string;
  editedAt: string;
  userId: string;
  userName: string;
  editReason: string;
  changesSummary: string;
  beforeSnapshot: any;
  afterSnapshot: any;
  requestId?: string;
}

export interface StockMovement {
  id: string;
  date: string;
  itemId: string;
  itemName: string;
  sku?: string;
  barcode?: string;
  movementType:
    | 'بيع'
    | 'تعديل فاتورة - استرجاع'
    | 'تعديل فاتورة - بيع'
    | 'مرتجع'
    | 'تسوية جرد'
    | 'تسوية مخزون بالإكسيل'
    | 'تعديل يدوي'
    | 'تعديل كمية مباشر'
    | 'استيراد رصيد افتتاحي'
    | 'رصيد افتتاحي بالإكسيل'
    | 'شراء'
    | 'مرتجع شراء'
    | 'إلغاء فاتورة بيع'
    | 'إلغاء فاتورة شراء'
    | 'تحويل_صادر'
    | 'تحويل_وارد';
  documentNumber: string;
  quantity: number; // الكمية المتأثرة
  quantityBefore?: number; // الكمية قبل الحركة
  quantityAfter?: number; // الكمية بعد الحركة
  balanceAfter: number; // الرصيد بعد الحركة
  unitPrice?: number;
  totalAmount?: number;
  party?: string; // العميل أو المورد أو المنصة
  condition?: string; // حالة الصنف في المرتجع (يرجع المخزن / تالف)
  reason?: string; // سبب التعديل اليدوي
  source?: string; // مصدر الحركة (بطاقة الصنف / تسوية جرد / فاتورة...)
  userName: string;
  userId?: string;
  warehouseId?: string;
  warehouseName?: string;
  referenceNumber?: string;
  notes: string;
}

export interface ItemMovementRecord {
  id: string;
  date: string;
  movementType: string;
  documentNumber: string;
  party?: string;
  quantityIn?: number;
  quantityOut?: number;
  inwardQty?: number;
  outwardQty?: number;
  runningBalance?: number;
  unitPrice?: number;
  totalAmount?: number;
  balanceAfter?: number;
  condition?: string;
  userName: string;
  reason?: string;
  notes?: string;
  warehouseId?: string;
  warehouseName?: string;
}

export interface ItemMovementReport {
  item?: Item;
  itemId?: string;
  itemName?: string;
  sku?: string;
  barcode?: string;
  categoryName?: string;
  warehouseId?: string;
  warehouseName?: string;
  currentStock?: number;
  startDate?: string;
  endDate?: string;
  initialBalance: number;
  totalIn?: number;
  totalOut?: number;
  totalInward?: number;
  totalOutward?: number;
  finalBalance: number;
  movements: ItemMovementRecord[];
}

export interface StockAdjustmentRecord {
  id: string;
  date: string;
  itemId: string;
  itemName: string;
  itemCode?: string;
  sku?: string;
  barcode?: string;
  movementType?: string;
  quantityBefore: number;
  previousBalance?: number;
  adjustmentAmount?: number; // مقدار التعديل (+ أو -)
  quantityChange?: number;
  difference?: number;
  quantityAfter: number;
  newBalance?: number;
  reason: string;
  source: string;
  userName: string;
  userId?: string;
  warehouseId?: string;
  warehouseName?: string;
  referenceNumber: string;
}

export interface StockAdjustmentsReport {
  startDate?: string;
  endDate?: string;
  totalIncreases: number;
  totalDecreases: number;
  netChange?: number;
  netAdjustment?: number;
  totalAdjustmentsCount?: number;
  itemId?: string;
  adjustments?: StockAdjustmentRecord[];
  records?: StockAdjustmentRecord[];
}

export interface CashboxEntry {
  id: string;
  date: string;
  documentNumber: string;
  entryType: 'إيراد بيع' | 'تعديل فاتورة - قيد عكسي' | 'تعديل فاتورة - قيد جديد' | 'مرتجع' | 'إلغاء بيع' | 'تحصيل آجل';
  cashboxName: string;
  amount: number;
  platform: string;
  notes: string;
  userName: string;
}

export interface ReturnLine {
  returnNumber: string;
  invoiceNumber: string;
  invoiceLineIndex: number;
  itemId: string;
  returnedQuantity: number;
  returnShippingDeductionPerUnit: number;
  totalLineReturnShippingDeduction: number;
  itemCondition: 'يرجع المخزن' | 'تالف';
}

export interface ReturnRecord {
  returnNumber: string;
  invoiceNumber: string;
  date: string;
  returnedItemsSummary: string;
  totalReturnShippingDeduction: number;
  refundStatus?: 'قيد على الحساب' | 'استرداد نقدي';
  cashboxId?: string;
  cashboxName?: string;
  warehouseId?: string;
  warehouseName?: string;
  refundedAmount?: number;
  idempotencyKey?: string;
  returnReason: string;
  notes: string;
  createdBy: string;
  lines: ReturnLine[];
}

export type DataMode = 'sheets' | 'memory';

export interface ConnectionHealth {
  healthy: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
}

export interface SystemConfig {
  appsScriptUrl: string;
  port: number;
  dataMode?: DataMode;
  persistenceMode?: 'supabase' | 'none';
  isGoogleSheetsConnected: boolean;
  connectionHealth?: ConnectionHealth;
  storeName: string;
  currency: string;
  hasOwner: boolean;
  hasManager: boolean;
  setupCheckError?: boolean;
  setupCheckErrorMessage?: string;
  companySettings?: CompanySettings;
  invoicePrintSettings?: InvoicePrintSettings;
  displaySettings?: DisplaySettings;
  taxSettings?: TaxSettings;
  stockSettings?: StockSettings;
  salesRules?: SalesRules;
  enableDeliveryFee?: boolean;
  inactivityTimeoutMinutes?: InactivityTimeoutMinutes;
  lastSyncTime?: string;
  dataEpoch?: string;
}

export interface ReportsData {
  stale?: boolean;
  lastSyncAt?: string;
  summary: {
    totalRevenue: number;
    totalCost?: number;
    grossProfit?: number;
    totalCommissions: number;
    netProfit?: number;
    invoicesCount: number;
    returnsCount: number;
    itemsCount: number;
    lowStockCount: number;
  };
  platformStats: Array<{
    id: string;
    name: string;
    discountPercentage: number;
    ordersCount: number;
    itemsSold: number;
    revenue: number;
    discountAmount: number;
    netProfit?: number;
  }>;
  lowStockItems: Item[];
  topSelling: Array<{
    name: string;
    quantity: number;
    revenue: number;
  }>;
}

export interface ItemChangeLogEntry {
  id: string;
  itemId: string;
  itemName: string;
  fieldName: string;
  oldValue: any;
  newValue: any;
  userName: string;
  timestamp: string;
  reason?: string;
}

export interface Supplier {
  id: string;
  name: string;
  code?: string;
  groupId?: string;
  phone?: string;
  phoneSecondary?: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  commercialRecord?: string;
  openingBalance: number;
  currentBalance: number;
  status: 'active' | 'inactive' | 'نشط' | 'مؤرشف';
  notes?: string;
  createdAt: string;
}

export interface SupplierGroup {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface PurchaseLine {
  invoiceNumber: string;
  lineIndex: number;
  itemId: string;
  sku?: string;
  itemName: string;
  quantity: number;
  receivedQuantity: number;
  unitCost: number;
  packagingCost?: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  totalLine: number;
  barcode?: string;
  notes?: string;
}

export interface PurchaseInvoice {
  invoiceNumber: string;
  supplierInvoiceNumber?: string;
  date: string;
  supplierId: string;
  supplierName: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  shippingFee: number;
  netTotal: number;
  totalAmount?: number;
  netAmount?: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: 'مدفوع بالكامل' | 'مدفوع جزئياً' | 'آجل';
  paymentMethod: 'نقدي' | 'تحويل بنكي' | 'شيك' | 'آجل';
  paymentType?: 'نقدي' | 'آجل' | 'جزئي' | string;
  cashboxId?: string;
  cashboxName?: string;
  warehouseId?: string;
  warehouseName?: string;
  receivingStatus: 'مستلم بالكامل' | 'مستلم جزئياً' | 'قيد الشحن' | 'ملغاة';
  createdBy: string;
  userName?: string;
  notes?: string;
  createdAt: string;
  idempotencyKey?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  lines: PurchaseLine[];
}

export type Purchase = PurchaseInvoice;

export interface PurchaseReturnLine {
  returnNumber: string;
  lineIndex: number;
  itemId: string;
  itemName: string;
  quantity: number;
  unitCost: number;
  taxAmount: number;
  totalLine: number;
  condition: 'سليم' | 'تالف';
}

export interface PurchaseReturn {
  returnNumber: string;
  purchaseInvoiceNumber: string;
  date: string;
  supplierId: string;
  supplierName: string;
  totalAmount: number;
  taxAmount: number;
  netTotal: number;
  refundStatus: 'استرداد نقدي' | 'قيد على الحساب';
  cashboxId?: string;
  cashboxName?: string;
  warehouseId?: string;
  warehouseName?: string;
  refundedAmount?: number;
  userName?: string;
  reason: string;
  createdBy: string;
  notes?: string;
  idempotencyKey?: string;
  lines: PurchaseReturnLine[];
}

export interface SupplierLedgerEntry {
  id: string;
  date: string;
  supplierId: string;
  supplierName: string;
  transactionType: 'فاتورة شراء' | 'سداد فاتورة شراء' | 'مرتجع شراء' | 'استرداد مرتجع شراء' | 'سند صرف' | 'سند قبض' | 'رصيد افتتاحي' | 'تسوية' | 'إلغاء فاتورة شراء';
  documentNumber: string;
  debit: number; // مدين (لنا)
  credit: number; // دائن (علينا)
  balanceAfter: number;
  statement: string;
  userName: string;
  notes?: string;
}

export interface Customer {
  id: string;
  name: string;
  code?: string;
  groupId?: string;
  phone?: string;
  phoneSecondary?: string;
  email?: string;
  city?: string;
  address?: string;
  /** منطقة التوصيل (لو «حسب المنطقة» شغال) */
  zoneId?: string;
  taxNumber?: string;
  commercialRecord?: string;
  creditLimit?: number;
  openingBalance: number;
  currentBalance: number;
  status: 'active' | 'inactive' | 'نشط' | 'مؤرشف';
  notes?: string;
  createdAt: string;
}

export interface CustomerGroup {
  id: string;
  name: string;
  discountPercent: number;
  description?: string;
  createdAt: string;
}

export interface CustomerLedgerEntry {
  id: string;
  date: string;
  customerId: string;
  customerName: string;
  transactionType: 'فاتورة بيع' | 'فاتورة آجل' | 'تحصيل' | 'فرق تحصيل' | 'سداد فاتورة بيع' | 'مرتجع بيع' | 'سند قبض' | 'سند صرف' | 'رصيد افتتاحي' | 'تسوية' | 'إلغاء فاتورة بيع' | string;
  documentNumber: string;
  debit: number; // مدين (عليه)
  credit: number; // دائن (له)
  balanceAfter: number;
  statement: string;
  userName: string;
  notes?: string;
}

export interface PartyLedgerEntry {
  id: string;
  date: string;
  partyType: 'customer' | 'platform';
  partyId: string;
  partyName: string;
  transactionType: 'فاتورة آجل' | 'تحصيل' | 'فرق تحصيل' | 'تحصيل مكرر' | string;
  documentNumber: string;
  debit: number; // مدين (على الطرف)
  credit: number; // دائن (للطرف)
  balanceAfter: number;
  statement: string;
  userName: string;
  notes?: string;
  needsReview?: boolean;
  reviewReasons?: string[];
}

export interface CollectCreditPayload {
  partyType: 'customer' | 'platform';
  partyId: string;
  invoiceNumbers: string[];
  receivedAmount: number;
  cashboxId: string;
  confirmDifference?: boolean;
  notes?: string;
  idempotencyKey?: string;
  isOffline?: boolean;
  isOfflineSync?: boolean;
  deviceId?: string;
  offlineDeviceId?: string;
  deviceName?: string;
  deviceTime?: string;
}

export interface CollectCreditResult {
  success: boolean;
  statusCode?: number;
  code?: string;
  duplicate?: boolean;
  requiresConfirmation?: boolean;
  collectionId?: string;
  totalDue?: number;
  receivedAmount?: number;
  difference?: number;
  partyBalance?: number;
  settledInvoices?: string[];
  duplicateCollectionInvoices?: string[];
  needsReview?: boolean;
  reviewReasons?: string[];
  ledgerEntriesCreated?: PartyLedgerEntry[];
  error?: string;
}

export interface Cashbox {
  id: string;
  name: string;
  type?: 'نقدية محلية' | 'حساب بنكي' | 'محفظة إلكترونية' | 'خزينة وسيطة';
  currency: string;
  openingBalance: number;
  currentBalance: number;
  responsibleUserName?: string;
  status: 'active' | 'inactive' | 'نشطة' | 'موقوفة';
  notes?: string;
  createdAt: string;
}

export interface DashboardCashbox {
  id: string;
  name: string;
  type?: 'نقدية محلية' | 'حساب بنكي' | 'محفظة إلكترونية' | 'خزينة وسيطة';
  currency: string;
  currentBalance: number;
  status: 'active' | 'inactive' | 'نشطة' | 'موقوفة';
  permissionType: string;
}

export interface CashboxTransaction {
  id: string;
  date: string;
  cashboxId: string;
  cashboxName: string;
  type: 'إيراد مبيعات' | 'تحصيل آجل' | 'مرتجع مبيعات' | 'سداد مشتريات' | 'استرداد مرتجع مشتريات' | 'سند قبض عميل' | 'سند صرف مورد' | 'سند صرف عميل' | 'استرداد مورد' | 'مصروفات' | 'إيداع' | 'سحب' | 'تحويل بين الخزائن' | 'قيد عكسي إلغاء مبيعات' | 'قيد عكسي إلغاء مشتريات' | 'تحصيل توصيل' | 'مستحقات طيار' | 'رسوم شركة شحن';
  transactionType?: string;
  documentNumber: string;
  amount: number;
  balanceAfter: number;
  party?: string;
  statement: string;
  userName: string;
  notes?: string;
}

export interface ReconciliationItem {
  id: string;
  documentType: 'فاتورة بيع' | 'فاتورة شراء' | 'مرتجع بيع' | 'مرتجع شراء' | 'سند عميل' | 'سند مورد';
  documentNumber: string;
  date: string;
  partyName: string;
  totalAmount: number;
  paymentType?: string;
  status: 'مطابق' | 'غير مرحل';
  details: string;
  missingCashbox: boolean;
  missingLedger: boolean;
  missingStock: boolean;
  isHistorical: boolean;
  warehouseId?: string;
  warehouseName?: string;
}

export interface CashboxTransfer {
  id?: string;
  transferNumber: string;
  date: string;
  fromCashboxId: string;
  fromCashboxName: string;
  toCashboxId: string;
  toCashboxName: string;
  amount: number;
  fee: number;
  transferFee?: number;
  netReceived: number;
  transferredBy: string;
  userName?: string;
  createdBy?: string;
  receivedBy?: string;
  status: 'مكتمل' | 'معلق';
  statement?: string;
  notes?: string;
}

export interface UserCashboxAssignment {
  id: string;
  userId: string;
  userName: string;
  cashboxId: string;
  cashboxName: string;
  permissionType: 'إيداع فقط' | 'سحب فقط' | 'إيداع وسحب' | 'إدارة كاملة';
  operations?: ('sale' | 'return' | 'receipt' | 'payment' | 'transfer')[];
  isDefaultSale?: boolean;
  isDefaultReturn?: boolean;
  isDefault: boolean;
  status: 'active' | 'inactive' | 'نشطة' | 'موقوفة';
  assignedAt?: string;
}

export interface ImportBatch {
  id: string;
  timestamp: string;
  dataType: string;
  sourceName: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  userName: string;
  notes?: string;
  errorLog?: string;
}

export type PageType =
  | 'dashboard'
  | 'pos'
  | 'items'
  | 'categories'
  | 'platforms'
  | 'invoices'
  | 'credit_collection'
  | 'returns'
  | 'purchases'
  | 'customers'
  | 'cashboxes'
  | 'reports'
  | 'settings'
  | 'permissions'
  | 'audit'
  | 'bulk_edit_excel'
  | 'sync'
  | 'warehouses'
  | 'warehouse_transfers'
  | 'warehouse_excel_transfer'
  | 'warehouse_dispatch_orders'
  | 'visitor'
  | 'label_print'
  | 'delivery_settings'
  | 'delivery_orders'
  | 'delivery_preparations'
  | 'delivery_settlements'
  | 'delivery_my_orders'
  | 'delivery_reports';

export interface BnplReportLine {
  id: string;
  date: string;
  invoiceNumber: string;
  platformId: string;
  platformName: string;
  itemId: string;
  itemName: string;
  itemBarcode?: string;
  quantity: number;
  baseUnitPrice: number;
  bnplPercent: number;
  customerUnitPrice: number;
  priceIncrease: number;
  bnplAmount: number;
  commission: number;
  net: number;
}

export interface BnplReportSummary {
  invoicesCount: number;
  piecesCount: number;
  totalCustomerPaid: number;
  totalPriceIncrease: number;
  totalBnplAmount: number;
  totalBaseAmount: number;
  totalCommission: number;
  totalLinesNet: number;
  totalInvoicesNetInCashbox: number;
}

export interface BnplReport {
  summary: BnplReportSummary;
  rows: BnplReportLine[];
  groupBy: 'item' | 'platform' | 'invoice';
}

export interface PlatformReportSummary {
  platformId: string;
  platformName: string;
  invoicesCount: number;
  totalGrossSales: number; // إجمالي المبيعات (سعر العميل)
  totalPriceIncrease?: number; // إجمالي زيادة السعر (BNPL)
  totalBnplAmount: number; // إجمالي استقطاع BNPL
  totalBaseSales: number; // إجمالي المبيعات بالسعر الأساسي
  totalCommission: number; // العمولات
  totalPickupFees: number;
  totalDeliveryFees: number;
  totalNet: number; // الصافي
  estimatedProfit: number; // الربح التقديري
  profitMargin: number; // نسبة الربح (الربح ÷ المبيعات بالسعر الأساسي) %
  averageInvoiceValue: number; // متوسط الفاتورة
  pendingDeferredBalance: number; // رصيد الآجل المعلّق على المنصة
}

export interface PlatformReportTopItem {
  itemId: string;
  itemName: string;
  barcode?: string;
  quantity: number;
  revenue: number;
  profit: number;
}

export interface PlatformReportStagnantItem {
  itemId: string;
  itemName: string;
  barcode?: string;
  stockQuantity: number;
  salePrice: number;
  lastSaleDate: string | null;
  daysSinceLastSale: number | null;
}

export interface PlatformReportDaySales {
  date: string;
  invoicesCount: number;
  grossSales: number;
  netSales: number;
}

export interface PlatformReport {
  summary: PlatformReportSummary;
  topByQuantity: PlatformReportTopItem[];
  topByRevenue: PlatformReportTopItem[];
  stagnantItems: PlatformReportStagnantItem[];
  stagnantDays: number;
  dailySales: PlatformReportDaySales[];
  dateRange: { from: string | null; to: string | null };
}

export type BulkEditOperationType =
  | 'sale_price'
  | 'purchase_price'
  | 'primary_barcode'
  | 'add_secondary_barcode'
  | 'stock_quantity'
  | 'reorder_limit'
  | 'name'
  | 'print_name'
  | 'barcode_sku'
  | 'notes'
  | 'category'
  | 'platforms'
  | 'bnpl'
  | 'pickup_fee'
  | 'min_price'
  | 'packaging_cost'
  | 'tax_rate'
  | 'supplier'
  | 'unit'
  | 'status'
  | 'image_url'
  | 'add_items'
  | 'add_categories'
  | 'delete_categories'
  | 'delete_items';

export type BulkEditPriceOperationType = BulkEditOperationType;

export type BulkEditExcelRowStatus = 'will_update' | 'unchanged' | 'error';

export type BulkEditCategoryRowAction =
  | 'new_root'
  | 'new_root_and_sub'
  | 'reused_root_new_sub'
  | 'batch_root_new_sub'
  | 'duplicate_existing'
  | 'duplicate_in_file'
  | 'error';

export interface BulkEditExcelPreviewRow {
  rowNumber: number;
  itemId?: string;
  itemName: string;
  inputName: string;
  codeOrBarcode?: string;
  matchedBy?: 'code_barcode' | 'name';
  currentPrice: number | null;
  newPrice: number | null;
  currentValueDisplay?: string;
  newValueDisplay?: string;
  status: BulkEditExcelRowStatus;
  reason?: string;
  warning?: string;
  rawValues?: Record<string, any>;
  mainCategoryName?: string;
  subCategoryName?: string;
  categoryAction?: BulkEditCategoryRowAction;
}

export interface BulkEditNewCategoryCount {
  id?: string;
  name: string;
  itemsCount: number;
}

export interface BulkEditCategoryImportSummary {
  newRootsCount: number;
  reusedRootsCount: number;
  newSubsCount: number;
  duplicatesCount: number;
  existingDuplicatesCount: number;
  intraFileDuplicatesCount: number;
  errorCount: number;
  createdRootsCount?: number;
  createdSubsCount?: number;
  failedRowsCount?: number;
}

export interface BulkEditExcelSummary {
  totalRows: number;
  willUpdateCount: number;
  unchangedCount: number;
  errorCount: number;
  warningCount?: number;
  zeroSalePriceCount?: number;
  zeroSalePriceWarning?: string;
  newCategories?: BulkEditNewCategoryCount[];
  categorySummary?: BulkEditCategoryImportSummary;
}

export interface BulkEditExcelPreviewResult {
  success: boolean;
  statusCode?: number;
  operationType?: BulkEditOperationType;
  fileName?: string;
  warehouseId?: string;
  warehouseName?: string;
  summary?: BulkEditExcelSummary;
  rows?: BulkEditExcelPreviewRow[];
  newCategories?: BulkEditNewCategoryCount[];
  zeroSalePriceCount?: number;
  zeroSalePriceWarning?: string;
  warnings?: string[];
  error?: string;
}

export interface BulkEditUndoStatus {
  success?: boolean;
  available: boolean;
  batchId?: string;
  operationType?: BulkEditOperationType;
  operationLabel?: string;
  fileName?: string;
  warehouseId?: string;
  warehouseName?: string;
  affectedCount?: number;
  executedAt?: string;
  executedBy?: string;
  error?: string;
}

export type BulkEditExcelUndoStatus = BulkEditUndoStatus;

export interface BulkEditUndoResult {
  success: boolean;
  statusCode?: number;
  batchId?: string;
  operationType?: BulkEditOperationType;
  operationLabel?: string;
  fileName?: string;
  warehouseId?: string;
  warehouseName?: string;
  restoredCount: number;
  message?: string;
  error?: string;
}

export type BulkEditExcelUndoResult = BulkEditUndoResult;

export interface BulkEditExcelExecuteResult {
  success: boolean;
  partialSuccess?: boolean;
  statusCode?: number;
  operationType?: BulkEditOperationType;
  fileName?: string;
  warehouseId?: string;
  warehouseName?: string;
  batchId?: string;
  updatedCount: number;
  unchangedCount: number;
  errorCount: number;
  warningCount?: number;
  zeroSalePriceCount?: number;
  zeroSalePriceWarning?: string;
  warnings?: string[];
  summary?: BulkEditExcelSummary;
  rows?: BulkEditExcelPreviewRow[];
  newCategories?: BulkEditNewCategoryCount[];
  undoAvailable?: boolean;
  error?: string;
  message?: string;
}

export interface WarehouseTransferLine {
  itemId: string;
  itemName: string;
  barcode?: string;
  sku?: string;
  notes?: string;
  unit: string;
  quantity: number;
  purchasePriceAtTransfer?: number;
  lineTotalPurchase?: number;
  fromStockBefore: number;
  fromStockAfter: number;
  toStockBefore: number;
  toStockAfter: number;
}

export interface WarehouseDispatchOrder {
  id: string;
  dispatchNumber: string;
  date: string;
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  userId: string;
  userName: string;
  itemsCount: number;
  totalQuantity: number;
  totalPurchaseValue?: number;
  notes?: string;
  idempotencyKey: string;
  lines: WarehouseTransferLine[];
}

export interface WarehouseTransferInsufficientItem {
  itemId: string;
  itemName: string;
  requested: number;
  available: number;
}

export type UnsoldCartReportEvent =
  | 'open'
  | 'remove'
  | 'reduce'
  | 'clear'
  | 'page_close'
  | 'logout'
  | 'crash'
  | 'other';

export type UnsoldCartReportStatus = 'open' | 'abandoned' | 'sold';

export interface UnsoldCartItemRow {
  cartId: string;
  cartStatus: UnsoldCartReportStatus;
  cartStatusLabel: string;
  event: UnsoldCartReportEvent;
  eventLabel: string;
  itemId: string;
  itemName: string;
  barcode: string;
  quantity: number;
  unitPrice: number;
  value: number;
  fromQty: number | null;
  toQty: number | null;
  at: string;
  userId: string;
  userName: string;
  deviceId: string;
  warehouseName: string;
  platform: string;
  invoiceNumber: string;
  receivedLate: boolean;
}

export interface UnsoldCartJournalAlert {
  id: string;
  type: 'new_device' | 'sequence_gap';
  typeLabel: string;
  deviceId: string;
  userId: string;
  userName: string;
  at: string;
  detail: string;
}

export interface UnsoldCartUserSummary {
  userId: string;
  userName: string;
  rows: number;
  quantity: number;
  value: number;
}

export interface UnsoldCartItemsReport {
  rows: UnsoldCartItemRow[];
  summary: {
    rows: number;
    quantity: number;
    value: number;
    openCarts: number;
    byUser: UnsoldCartUserSummary[];
  };
  alerts: UnsoldCartJournalAlert[];
}

export type BankLinkTemplateDirection = 'in' | 'out' | 'auto' | 'ignore';

export interface BankLinkTemplate {
  id: string;
  name: string;
  sender: string;
  pattern: string;
  direction: BankLinkTemplateDirection;
  enabled: boolean;
}

export interface BankLinkMessageReading {
  kind: 'transaction' | 'ignored' | 'unknown';
  note: string;
  direction: 'in' | 'out' | 'unknown';
  amount: number | null;
  balance: number | null;
  accountSuffix: string;
  counterparty: string;
  reference: string;
  otherNumbers: number[];
  fee?: number;
  readBy?: 'template' | 'auto';
  templateId?: string;
}

export interface BankLinkEntry {
  messageId: string;
  mergedMessageIds: string[];
  sender: string;
  at: string;
  direction: 'in' | 'out' | 'unknown';
  amount: number;
  fee: number;
  balanceAfter: number | null;
  counterparty: string;
  reference: string;
  verifiedBy: 'balance' | 'baseline' | 'none';
  corrections: string[];
  state: 'baseline' | 'needs_review' | 'matched' | 'unclassified';
  stateLabel: string;
  matchedTxId: string;
  createdTxId: string;
}

export interface BankLinkPendingTx {
  id: string;
  date: string;
  amount: number;
  statement: string;
  documentNumber: string;
  userName: string;
  overdue: boolean;
}

export interface BankLinkGap {
  beforeMessageId: string;
  at: string;
  amount: number;
}

export interface BankLinkUnknownMessage {
  messageId: string;
  note: string;
}

export interface BankLinkAccountOverview {
  id: string;
  name: string;
  cashboxId: string;
  cashboxName: string;
  cashboxMissing: boolean;
  enabled: boolean;
  senders: string[];
  accountSuffix: string;
  matchWindowMinutes: number;
  createdAt: string;
  lastMessageAt: string;
  bankBalance: number | null;
  lastConfirmedBalance: number | null;
  bookBalance: number | null;
  pendingTotal: number;
  pending: BankLinkPendingTx[];
  gaps: BankLinkGap[];
  unknownMessages: BankLinkUnknownMessage[];
  entries: BankLinkEntry[];
}

export interface BankLinkUnknownSender {
  sender: string;
  count: number;
  lastAt: string;
}

export interface BankLinkDevice {
  id: string;
  lastSeenAt: string;
  battery: number | null;
  online: boolean;
}

export interface BankLinkOverviewResponse {
  success: boolean;
  accounts: BankLinkAccountOverview[];
  unknownSenders: BankLinkUnknownSender[];
  devices: BankLinkDevice[];
  intakeKey: string;
  intakePath: string;
  heartbeatPath: string;
  canManageTemplates: boolean;
  templates: BankLinkTemplate[];
  error?: string;
}

export interface ManualBalanceRequest {
  accountId: string;
  accountName: string;
  cashboxName: string;
  dueAt: string;
  kind: 'baseline' | 'scheduled';
  mandatory: boolean;
  state: 'due' | 'postponed';
  canPostpone: boolean;
  postponedUntil: string;
  blocking: boolean;
}

export interface ManualBalanceAlert {
  id: string;
  accountId: string;
  accountName: string;
  cashboxId?: string;
  at: string;
  enteredBalance: number;
  bookBalanceBefore: number;
  difference: number;
  userName: string;
}

export interface ManualBalanceEntry {
  id: string;
  accountId?: string;
  accountName?: string;
  cashboxId?: string;
  at: string;
  kind: 'baseline' | 'scheduled' | 'voluntary';
  enteredBalance: number;
  bookBalanceBefore: number;
  difference: number;
  txId?: string;
  userId?: string;
  userName: string;
  reviewed: boolean;
  reviewedBy: string;
  reviewedAt: string;
}

export interface ManualBalanceResponsible {
  id: string;
  name: string;
  missing: boolean;
}

export interface ManualBalanceUserOption {
  id: string;
  name: string;
  username: string;
  role: string;
}

export interface ManualBalanceAccountOverview {
  id: string;
  name: string;
  cashboxId: string;
  cashboxName: string;
  cashboxMissing: boolean;
  enabled: boolean;
  responsibleUserIds: string[];
  responsibles: ManualBalanceResponsible[];
  scheduleType: 'daily' | 'weekdays';
  time: string;
  weekdays: number[];
  mandatory: boolean;
  timezone?: string;
  lastEntryAt: string;
  lastBalance: number | null;
  bookBalance: number | null;
  sinceLastTotal: number | null;
  nextDueAt: string;
  request: ManualBalanceRequest | null;
  unreviewedCount: number;
  entries: ManualBalanceEntry[];
}

export interface ManualBalanceRequestsResponse {
  success: boolean;
  requests: ManualBalanceRequest[];
  alerts: ManualBalanceAlert[];
  postponeMinutes: number;
  error?: string;
}

export interface ManualBalanceOverviewResponse {
  success: boolean;
  accounts: ManualBalanceAccountOverview[];
  alerts: ManualBalanceAlert[];
  users: ManualBalanceUserOption[];
  postponeMinutes: number;
  error?: string;
}

export type DefaultSaleMode = 'last' | 'direct' | 'platform';
export type DefaultSelectionMode = 'first' | 'fixed' | 'manual';
export type DefaultCustomerSelectionMode = 'none' | 'fixed' | 'manual';

export interface SalesRules {
  defaultSaleMode: DefaultSaleMode;
  platformSelection: DefaultSelectionMode;
  defaultPlatformId: string;
  customerSelection: DefaultCustomerSelectionMode;
  defaultCustomerId: string;
  allowZeroPriceSale: boolean;
  allowBelowCostSale: boolean;
  platformAlwaysCredit: boolean;
  /** السماح بالبيع على منصة (مفتاح مستقل في إعدادات البيع) */
  allowPlatformSale?: boolean;
  /** السماح بالبيع المباشر للعميل (مفتاح مستقل في إعدادات البيع) */
  allowDirectSale?: boolean;
  /** القيم الفعلية المحسوبة بعد دمج حالة المنصات ووضع البيع فقط */
  effectiveAllowPlatformSale?: boolean;
  effectiveAllowDirectSale?: boolean;
  platformsEnabled?: boolean;
  salesOnlyMode?: boolean;
  effectiveSaleMode?: DefaultSaleMode;
  updatedAt: string;
  updatedBy: string;
  /** اسم المنصة/العميل المحدد (للعرض فقط) */
  defaultPlatformName?: string;
  defaultCustomerName?: string;
  effectivePlatformSelection: DefaultSelectionMode;
  effectiveCustomerSelection: DefaultCustomerSelectionMode;
  defaultPlatformMissing: boolean;
  defaultCustomerMissing: boolean;
}

export interface InvoiceNumberingSettings {
  prefix: string;
  datePart: 'none' | 'year' | 'month' | 'day';
  separator: '-' | '/' | '';
  digits: number;
  suffix: string;
  resetPeriod: 'never' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  startAt: number;
  platformOrderDuplicates: 'block' | 'allow';
  updatedAt: string;
  updatedBy: string;
}
export interface InvoiceNumberingView {
  settings: InvoiceNumberingSettings;
  counter: { periodKey: string; last: number; resetAt: string; resetBy: string };
  nextNumber: string;
  mayRepeat: boolean;
  mayRepeatNote: string;
}

export interface VisitorSlide {
  id: string;
  url: string;
  imageUrl?: string;
  order?: number;
  createdAt: string;
}

export interface VisitorDisplaySettings {
  slideSeconds: number;
  resultSeconds: number;
  showWelcome: boolean;
  welcomeText: string;
  showLogo: boolean;
  slides: VisitorSlide[];
  updatedAt: string;
  updatedBy: string;
}

export interface VisitorProduct {
  name: string;
  price: number;
  salePrice?: number;
  unit: string;
  imageUrl: string;
}

export interface ImagesStorageStatus {
  success?: boolean;
  storageEnabled: boolean;
  inline: {
    total: number;
    byCollection: Record<string, number>;
  };
}

export interface ImagesMigrationResult {
  success?: boolean;
  moved: number;
  failed: number;
  remaining: number;
  errors: string[];
}

export type DeliveryMode = 'drivers' | 'couriers' | 'both';

export interface DeliveryPrepSlipSettings {
  enabled: boolean;
  showPrepNumber: boolean;
  showInvoiceNumber: boolean;
  showCustomerName: boolean;
  showCustomerPhone: boolean;
  showItemNames: boolean;
  showItemQuantities: boolean;
}

export interface DeliverySettings {
  enabled: boolean;
  mode: DeliveryMode;
  zonePricing: boolean;
  fixedFee: number;
  maxDriverCustody: number;
  lateAfterHours: number;
  prepSlip: DeliveryPrepSlipSettings;
  updatedAt: string;
  updatedBy: string;
}

export interface DeliveryZone {
  id: string;
  name: string;
  customerFee: number;
  driverCommission: number;
  minOrderValue: number;
  active: boolean;
  createdAt: string;
}

export interface DeliveryDriver {
  id: string;
  name: string;
  phone: string;
  monthlySalary: number;
  commissionPerOrder: number;
  active: boolean;
  userId: string;
  createdAt: string;
}

export interface DeliveryCourier {
  id: string;
  name: string;
  feePerOrder: number;
  active: boolean;
  createdAt: string;
}

export interface DeliveryDriverUserOption {
  id: string;
  name: string;
  username: string;
  isDriver: boolean;
}

export interface DeliverySettingsResponse {
  success: boolean;
  settings: DeliverySettings;
  zones: DeliveryZone[];
  drivers: DeliveryDriver[];
  couriers: DeliveryCourier[];
  users: DeliveryDriverUserOption[];
  error?: string;
}

export interface DeliverySettingsSaveResponse {
  success: boolean;
  settings: DeliverySettings;
  zones: DeliveryZone[];
  drivers: DeliveryDriver[];
  couriers: DeliveryCourier[];
  error?: string;
}

export interface DeliveryMasterSaveResponse<T> extends DeliverySettingsSaveResponse {
  saved: T;
}

export type DeliveryAssigneeType = 'driver' | 'courier';
export type DeliveryPaymentMode = 'prepaid' | 'cod';
export type DeliveryOrderStatus =
  | 'جديد'
  | 'خرج للتوصيل'
  | 'اتسلم'
  | 'ما اتسلمش'
  | 'رجع المحل'
  | 'اتلغى';

export interface DeliveryStatusEntry {
  status: DeliveryOrderStatus;
  at: string;
  byId: string;
  byName: string;
  note: string;
}

export interface DeliveryOrder {
  id: string;
  number: string;
  invoiceNumber: string;
  createdAt: string;
  createdBy: string;
  customerId: string;
  customerName: string;
  phone: string;
  address: string;
  zoneId: string;
  zoneName: string;
  zoneCommission: number;
  fee: number;
  feeManual: boolean;
  paymentMode: DeliveryPaymentMode;
  invoiceTotal: number;
  amountDue: number;
  assigneeType: DeliveryAssigneeType | '';
  assigneeId: string;
  assigneeName: string;
  trackingNumber: string;
  status: DeliveryOrderStatus;
  failReason: string;
  log: DeliveryStatusEntry[];
  outAt: string;
  deliveredAt: string;
  closedAt: string;
  commission: number;
  courierFee: number;
  settlementId: string;
  payoutId: string;
  returnNumber: string;
  preparationId?: string;
  preparationNumber?: string;
}

export interface DeliveryConfigZoneOption {
  id: string;
  name: string;
  customerFee: number;
  minOrderValue: number;
}

export interface DeliveryConfigDriverOption {
  id: string;
  name: string;
  phone: string;
}

export interface DeliveryConfigCourierOption {
  id: string;
  name: string;
}

export interface DeliveryConfigResponse {
  success: boolean;
  settings: {
    enabled: boolean;
    mode: DeliveryMode;
    zonePricing: boolean;
    fixedFee: number;
    prepSlip?: DeliveryPrepSlipSettings;
  };
  canEditFee: boolean;
  zones: DeliveryConfigZoneOption[];
  drivers: DeliveryConfigDriverOption[];
  couriers: DeliveryConfigCourierOption[];
  error?: string;
}

export interface CreateInvoiceDeliveryPayload {
  paymentMode: DeliveryPaymentMode;
  address: string;
  phone?: string;
  zoneId?: string;
  fee?: number;
  assigneeType?: DeliveryAssigneeType;
  assigneeId?: string;
  trackingNumber?: string;
}

export interface DeliveryOrdersListParams {
  status?: DeliveryOrderStatus;
  assigneeType?: DeliveryAssigneeType;
  assigneeId?: string;
  from?: string;
  to?: string;
  open?: boolean;
}

export interface DeliveryOrdersListResponse {
  success: boolean;
  orders: DeliveryOrder[];
  lateAfterHours: number;
  error?: string;
}

export interface DeliveryAssignOrderPayload {
  assigneeType: DeliveryAssigneeType;
  assigneeId: string;
  trackingNumber?: string;
}

export interface DeliveryAssignOrderResponse {
  success: boolean;
  order: DeliveryOrder;
  warning: string;
  error?: string;
}

export interface DeliveryChangeOrderStatusPayload {
  status: DeliveryOrderStatus;
  reason?: string;
  note?: string;
  refund?: 'cash' | 'credit';
  refundCashboxId?: string;
  refundDeliveryFee?: boolean;
}

export interface DeliveryChangeOrderStatusResponse {
  success: boolean;
  order: DeliveryOrder;
  warning: string;
  returnNumber: string;
  error?: string;
}

export type DeliveryPreparationStatus = 'قيد التحضير' | 'جاري الشحن' | 'خرج للتوصيل' | 'اتلغى';

export interface DeliveryPreparationLine {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface DeliveryPreparationOrder {
  id: string;
  number: string;
  status: DeliveryPreparationStatus;
  revision: number;
  idempotencyKey: string;
  createdAt: string;
  createdBy: string;
  createdById: string;
  updatedAt: string;
  updatedBy: string;
  updatedById: string;
  cancelledAt: string;
  cancelledBy: string;
  cancelledById: string;
  cancelReason: string;
  customerId: string;
  customerName: string;
  phone: string;
  address: string;
  zoneId: string;
  zoneName: string;
  zoneCommission: number;
  fee: number;
  feeManual: boolean;
  paymentMode: DeliveryPaymentMode;
  assigneeType: DeliveryAssigneeType | '';
  assigneeId: string;
  assigneeName: string;
  trackingNumber: string;
  notes: string;
  lines: DeliveryPreparationLine[];
  itemsSubtotal: number;
  estimatedTotal: number;
  invoiceNumber?: string;
  deliveryOrderId?: string;
  deliveryOrderNumber?: string;
  dispatchedAt?: string;
  dispatchedBy?: string;
  dispatchedById?: string;
  dispatchIdempotencyKey?: string;
}

export interface DeliveryPreparationLineInput {
  itemId: string;
  quantity: number;
}

export interface CreateDeliveryPreparationPayload {
  idempotencyKey: string;
  customerId?: string;
  customerName?: string;
  phone?: string;
  address: string;
  zoneId?: string;
  fee?: number;
  paymentMode: DeliveryPaymentMode;
  assigneeType?: DeliveryAssigneeType | '';
  assigneeId?: string;
  trackingNumber?: string;
  notes?: string;
  lines: DeliveryPreparationLineInput[];
}

export interface UpdateDeliveryPreparationPayload {
  revision: number;
  customerId?: string;
  customerName?: string;
  phone?: string;
  address?: string;
  zoneId?: string;
  fee?: number;
  paymentMode?: DeliveryPaymentMode;
  assigneeType?: DeliveryAssigneeType | '';
  assigneeId?: string;
  trackingNumber?: string;
  notes?: string;
  lines?: DeliveryPreparationLineInput[];
}

export interface CancelDeliveryPreparationPayload {
  reason?: string;
  revision?: number;
}

export interface DispatchDeliveryPreparationPayload {
  revision?: number;
  assigneeType?: DeliveryAssigneeType;
  assigneeId?: string;
  trackingNumber?: string;
  warehouseId?: string;
  cashboxId?: string;
  paymentMethod?: string;
  paidAmount?: number;
  referenceNumber?: string;
  notes?: string;
}

export interface DispatchDeliveryPreparationResponse {
  success: boolean;
  duplicate?: boolean;
  recovered?: boolean;
  order: DeliveryPreparationOrder;
  invoice: Invoice;
  deliveryOrder: DeliveryOrder;
  error?: string;
  code?: string;
}

export interface DeliveryPreparationOrdersListParams {
  status?: DeliveryPreparationStatus;
  customerId?: string;
  zoneId?: string;
  from?: string;
  to?: string;
  open?: boolean;
}

export interface DeliveryPreparationOrderResponse {
  success: boolean;
  duplicate?: boolean;
  order: DeliveryPreparationOrder;
  error?: string;
  code?: string;
}

export interface DeliveryPreparationOrdersListResponse {
  success: boolean;
  orders: DeliveryPreparationOrder[];
  error?: string;
}


export interface DeliverySettlement {
  id: string;
  number: string;
  at: string;
  byId: string;
  byName: string;
  assigneeType: DeliveryAssigneeType;
  assigneeId: string;
  assigneeName: string;
  orderIds: string[];
  invoiceNumbers: string[];
  collected: number;
  courierFees: number;
  expected: number;
  received: number;
  shortage: number;
  cashboxId: string;
  cashboxName: string;
  note: string;
}

export interface DeliverySettlementPreviewResponse {
  success: boolean;
  assigneeType: DeliveryAssigneeType;
  assigneeId: string;
  assigneeName: string;
  orders: DeliveryOrder[];
  collected: number;
  courierFees: number;
  expected: number;
  error?: string;
}

export interface DeliverySettlePayload {
  assigneeType: DeliveryAssigneeType;
  assigneeId: string;
  orderIds?: string[];
  receivedAmount: number;
  cashboxId: string;
  confirmDifference?: boolean;
  note?: string;
  idempotencyKey: string;
}

export interface DeliverySettleResponse {
  success: boolean;
  duplicate?: boolean;
  requiresConfirmation?: boolean;
  expected?: number;
  received?: number;
  shortage?: number;
  settlement?: DeliverySettlement;
  message?: string;
  code?: string;
  error?: string;
}

export interface DeliverySettlementsListParams {
  assigneeType?: DeliveryAssigneeType;
  assigneeId?: string;
  from?: string;
  to?: string;
}

export interface DeliverySettlementsListResponse {
  success: boolean;
  settlements: DeliverySettlement[];
  error?: string;
}

export interface DeliveryDriverDues {
  driverId: string;
  driverName: string;
  monthlySalary: number;
  commissionUnpaid: number;
  unpaidOrderIds: string[];
  shortageOutstanding: number;
  custody: number;
}

export interface DeliveryDriverPayout {
  id: string;
  number: string;
  at: string;
  byId: string;
  byName: string;
  driverId: string;
  driverName: string;
  salary: number;
  commission: number;
  shortageDeducted: number;
  paid: number;
  orderIds: string[];
  cashboxId: string;
  cashboxName: string;
  note: string;
}

export interface DeliveryDriverDuesResponse {
  success: boolean;
  dues: DeliveryDriverDues;
  payouts: DeliveryDriverPayout[];
  error?: string;
}

export interface DeliveryPayoutPreview {
  driverId: string;
  driverName: string;
  salary: number;
  payCommission: boolean;
  deductShortage: boolean;
  commission: number;
  orderIds: string[];
  gross: number;
  shortageOutstanding: number;
  shortageDeducted: number;
  paid: number;
  canPayout: boolean;
}

export interface DeliveryPayoutPreviewParams {
  driverId: string;
  salary: number;
  payCommission: boolean;
  deductShortage: boolean;
}

export interface DeliveryPayoutPreviewResponse {
  success: boolean;
  preview: DeliveryPayoutPreview;
  dues: DeliveryDriverDues;
  error?: string;
}

export interface DeliveryPayoutExpectedPreview {
  salary: number;
  commission: number;
  shortageDeducted: number;
  paid: number;
  orderIds: string[];
}

export interface DeliveryPayoutPayload {
  driverId: string;
  salary: number;
  payCommission: boolean;
  deductShortage: boolean;
  cashboxId: string;
  note?: string;
  idempotencyKey: string;
  expectedPreview?: DeliveryPayoutExpectedPreview;
}

export interface DeliveryPayoutResponse {
  success: boolean;
  duplicate?: boolean;
  requiresConfirmation?: boolean;
  code?: string;
  payout?: DeliveryDriverPayout;
  preview?: DeliveryPayoutPreview;
  dues?: DeliveryDriverDues;
  message?: string;
  error?: string;
}

export type DeliveryDriverAllowedStatus = 'خرج للتوصيل' | 'اتسلم' | 'ما اتسلمش';

export interface DeliveryMyOrdersResponse {
  success: boolean;
  driver: DeliveryDriver;
  open: DeliveryOrder[];
  recent: DeliveryOrder[];
  custody: number;
  error?: string;
  code?: string;
}

export interface DeliveryDriverUpdateStatusPayload {
  status: DeliveryDriverAllowedStatus;
  reason?: string;
  note?: string;
}

export interface DeliveryDriverUpdateStatusResponse {
  success: boolean;
  order: DeliveryOrder;
  warning: string;
  returnNumber: string;
  error?: string;
  code?: string;
}

export interface DeliveryReportsParams {
  from?: string;
  to?: string;
}

export interface DeliveryReportCustodyRow {
  type: DeliveryAssigneeType;
  id: string;
  name: string;
  amount: number;
  orders: number;
  since: string;
}

export interface DeliveryReportPerformanceRow {
  driverId: string;
  driverName: string;
  orders: number;
  delivered: number;
  failed: number;
  deliveredPercent: number;
  avgMinutes: number;
}

export interface DeliveryReportFeeGroupRow {
  name: string;
  total: number;
  orders: number;
}

export interface DeliveryReportDuesRow extends DeliveryDriverDues {
  paidInPeriod: number;
}

export interface DeliveryReportsResponse {
  success: boolean;
  from: string;
  to: string;
  openOrders: {
    total: number;
    late: number;
    lateAfterHours: number;
    byStatus: Record<string, number>;
    lateOrders: DeliveryOrder[];
  };
  custody: DeliveryReportCustodyRow[];
  performance: DeliveryReportPerformanceRow[];
  fees: {
    total: number;
    byZone: DeliveryReportFeeGroupRow[];
    byAssignee: DeliveryReportFeeGroupRow[];
  };
  settlements: {
    count: number;
    expected: number;
    received: number;
    shortage: number;
    list: DeliverySettlement[];
  };
  dues: DeliveryReportDuesRow[];
  error?: string;
}









/**
 * ============================================================================
 * مشروع «POS مدقق للمنصات» - سكريبت الربط الفعلي مع Google Sheets
 * ملف: Code.gs (Google Apps Script Web App)
 * ============================================================================
 * 
 * المبادئ الأمنية الصارمة ونظام الصلاحيات:
 * 1. المصمم هو مالك النظام (designer): أعلى سلطة تحكم كاملة في الهوية والمظهر وإعدادات الفواتير والطباعة وعرض الأصناف.
 * 2. لا اعتماد مطلقًا على requesterRole القادم من المتصفح، ويتم التحقق من الـ Session Token وقراءة الصلاحيات من شيت Users.
 * 3. إنشاء أول مصمم للنظام (First Designer/Owner) يتم حصريًا ويدويًا عبر الدالة bootstrapFirstDesigner() من داخل محرر Apps Script.
 * 4. تشفير وتمليح كلمات المرور (Salt + SHA-256) دون تخزينها كنص صريح.
 * 5. حجب التكاليف وأسعار الشراء والأرباح على مستوى الـ API ما لم يمتلك المستخدم الصلاحية المحددة.
 * 6. تسجيل كل العمليات الحساسة وتعديلات الصلاحيات في ورقة AuditLogs.
 */

// أسماء أوراق العمل الرسمية
var SHEETS = {
  ITEMS: 'Items',
  ITEM_BARCODES: 'ItemBarcodes',
  ITEM_CHANGE_LOG: 'ItemChangeLog',
  PLATFORMS: 'Platforms',
  ITEM_PLATFORM_COSTS: 'ItemPlatformCosts',
  INVOICES: 'Invoices',
  INVOICE_LINES: 'InvoiceLines',
  RETURNS: 'Returns',
  RETURN_LINES: 'ReturnLines',
  USERS: 'Users',
  SETTINGS: 'Settings',
  AUDIT_LOGS: 'AuditLogs',
  SESSIONS: 'Sessions',
  INVOICE_EDIT_LOGS: 'InvoiceEditLogs',
  STOCK_MOVEMENTS: 'StockMovements',
  CASHBOX_ENTRIES: 'CashboxEntries',
  // الأوراق الإضافية للمرحلة الأولى (المشتريات، الموردين، العملاء، الخزائن)
  SUPPLIERS: 'Suppliers',
  SUPPLIER_GROUPS: 'SupplierGroups',
  PURCHASES: 'Purchases',
  PURCHASE_LINES: 'PurchaseLines',
  PURCHASE_RETURNS: 'PurchaseReturns',
  PURCHASE_RETURN_LINES: 'PurchaseReturnLines',
  SUPPLIER_LEDGER: 'SupplierLedger',
  CUSTOMERS: 'Customers',
  CUSTOMER_GROUPS: 'CustomerGroups',
  CUSTOMER_LEDGER: 'CustomerLedger',
  CASHBOXES: 'Cashboxes',
  CASHBOX_TRANSACTIONS: 'CashboxTransactions',
  CASHBOX_TRANSFERS: 'CashboxTransfers',
  USER_CASHBOX_ASSIGNMENTS: 'UserCashboxAssignments',
  IMPORT_BATCHES: 'ImportBatches',
  PRODUCT_CATEGORIES: 'ProductCategories',
  PARTY_LEDGER: 'PartyLedger',
  BULK_EDIT_UNDO: 'BulkEditUndo',
  // أوراق المخازن المتعددة وأوامر الصرف والتحويلات
  WAREHOUSES: 'Warehouses',
  WAREHOUSE_STOCKS: 'WarehouseStocks',
  USER_WAREHOUSES: 'UserWarehouses',
  WAREHOUSE_DISPATCH_ORDERS: 'WarehouseDispatchOrders',
  WAREHOUSE_DISPATCH_ORDER_LINES: 'WarehouseDispatchOrderLines'
};

// قائمة الصلاحيات الرسمية الكاملة (92 صلاحية متطابقة مع src/utils/permissions.ts)
var ALL_PERMISSIONS = [
  'dashboard.view',
  'dashboard.view_cashboxes',
  'items.view', 'items.create', 'items.edit', 'items.status', 'items.delete',
  'categories.view', 'categories.manage',
  'prices.view_sale', 'prices.view_purchase', 'prices.view_packaging', 'prices.override_min_price',
  'stock.view', 'stock.edit', 'stock.adjust', 'stock.alerts', 'stock.override_negative',
  'warehouses.view', 'warehouses.manage', 'warehouses.transfer',
  'platforms.view', 'platforms.create', 'platforms.edit', 'platforms.status', 'platforms.pricing',
  'invoices.view', 'invoices.view_in_pos', 'invoices.create', 'invoices.edit_cash_paid',
  'invoices.edit_price_before_save', 'invoices.edit_tax_before_save', 'pos.edit_rates',
  'invoices.edit',
  'invoices.edit_after_save', 'invoices.edit_price_after_save', 'invoices.edit_tax_after_save',
  'invoices.edit_quantity_after_save', 'invoices.edit_items_after_save', 'invoices.edit_platform_after_save',
  'invoices.edit_customer_after_save', 'invoices.edit_discount_shipping_after_save', 'invoices.edit_cashbox_after_save',
  'invoices.cancel', 'invoices.print', 'invoices.export', 'invoices.collect_credit', 'offline.manage',
  'returns.view', 'returns.create', 'returns.approve', 'returns.restock',
  'reports.view_profit', 'reports.view_costs', 'reports.view_reports', 'reports.export',
  'reports.item_movement.view', 'reports.unsold_cart_items.view', 'reports.stock_adjustments.view', 'reports.bnpl_view', 'reports.platform_view',
  'users.view', 'users.create', 'users.edit', 'users.status',
  'permissions.view', 'permissions.manage',
  'settings.company_appearance',
  'settings.invoice_print',
  'settings.display_customization',
  'settings.system_integration',
  'settings.backup',
  'settings.bank_link',
  'settings.bank_templates',
  'settings.sales_rules',
  'settings.ui_scale',
  'settings.visitor_display',
  'visitor.display',
  'items.print_labels',
  'settings.label_print',
  'settings.invoice_numbering',
  'settings.reset_operations',
  'settings.factory_reset',
  'settings.negative_stock',
  'audit.view',
  'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete',
  'purchases.view', 'purchases.create', 'purchases.return',
  'customers.view', 'customers.create', 'customers.edit',
  'cashbox.view', 'cashbox.create', 'cashbox.transfer', 'cashbox.receipt', 'cashbox.payment',
  'items.import_export',
  'products.export',
  'products.bulk_edit_excel',
  'products.inline_edit',
  'delivery.settings',
  'delivery.view',
  'delivery.manage',
  'delivery.edit_fee',
  'delivery.settle',
  'delivery.reports',
  'delivery.driver'
];

// قوالب الأدوار الافتراضية (متطابقة مع src/utils/permissions.ts)
var ROLE_TEMPLATES = {
  designer: ALL_PERMISSIONS,
  manager: [
    'dashboard.view',
    'dashboard.view_cashboxes',
    'items.view', 'items.create', 'items.edit', 'items.status', 'items.delete', 'items.import_export', 'products.export', 'products.bulk_edit_excel', 'products.inline_edit',
    'categories.view', 'categories.manage',
    'prices.view_sale', 'prices.view_purchase', 'prices.view_packaging',
    'stock.view', 'stock.edit', 'stock.adjust', 'stock.alerts',
    'warehouses.view', 'warehouses.manage', 'warehouses.transfer',
    'platforms.view', 'platforms.create', 'platforms.edit', 'platforms.status', 'platforms.pricing',
    'invoices.view', 'invoices.create', 'invoices.edit_cash_paid', 'pos.edit_rates', 'invoices.edit', 'invoices.cancel', 'invoices.print', 'invoices.export', 'invoices.collect_credit', 'offline.manage',
    'returns.view', 'returns.create', 'returns.approve', 'returns.restock',
    'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete',
    'purchases.view', 'purchases.create', 'purchases.return',
    'customers.view', 'customers.create', 'customers.edit',
    'cashbox.view', 'cashbox.create', 'cashbox.transfer', 'cashbox.receipt', 'cashbox.payment',
    'reports.view_profit', 'reports.view_costs', 'reports.view_reports', 'reports.export',
    'reports.item_movement.view', 'reports.stock_adjustments.view', 'reports.bnpl_view', 'reports.platform_view', 'reports.unsold_cart_items.view',
    'users.view', 'users.create', 'users.edit', 'users.status',
    'permissions.view', 'permissions.manage',
    'settings.invoice_print',
    'settings.display_customization',
    'settings.system_integration',
    'audit.view'
  ],
  employee: [
    'dashboard.view',
    'items.view',
    'prices.view_sale',
    'stock.view',
    'stock.alerts',
    'platforms.view',
    'invoices.view',
    'invoices.view_in_pos',
    'invoices.create',
    'invoices.print',
    'returns.view',
    'returns.create',
    'returns.restock',
    'reports.view_reports'
  ]
};

/**
 * دالة مساعدة لتوليد UUID فريد
 */
function generateUUID() {
  return Utilities.getUuid();
}

/**
 * دالة تطبيع اسم المستخدم (Username Normalization):
 * - إزالة المسافات في البداية والنهاية
 * - دمج المسافات المتكررة لمسافة واحدة
 * - تحويل الأحرف اللاتينية إلى lowercase
 * - الحفاظ على الأحرف العربية
 */
function normalizeUsername(username) {
  if (!username) return '';
  return String(username)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * فحص صحة تنسيق اسم المستخدم (عربي، إنجليزي، أرقام، مسافات، نقاط وشرطات 2-40 حرف)
 */
function isValidUsernameFormat(username) {
  var norm = normalizeUsername(username);
  if (norm.length < 2 || norm.length > 40) return false;
  var re = /^[\u0600-\u06FFa-zA-Z0-9._ -]{2,40}$/;
  return re.test(String(username).trim());
}

/**
 * كلمة السر المؤقتة الافتراضية للحسابات الثلاثة عند تهيئة نظام جديد (قابلة للتخصيص عبر Script Properties)
 */
function getInitialUserPasswordGS() {
  try {
    var props = PropertiesService.getScriptProperties();
    var envVal = props && props.getProperty('INITIAL_USER_PASSWORD');
    if (envVal && String(envVal).trim()) {
      return String(envVal).trim();
    }
  } catch (_) {}
  return '1234';
}

/**
 * التحقق من قواعد كلمة المرور الجديدة في النظام كله:
 * - حرفان أو رقمان على الأقل (طول >= 2)
 * - بدون أي شروط تعقيد (أرقام فقط أو حروف فقط مقبولة)
 * - لا تساوي كلمة السر المؤقتة الافتراضية (INITIAL_USER_PASSWORD)
 */
function validatePasswordRules(password, role, options) {
  var str = (typeof password === 'string') ? password : String(password || '');
  if (!str || str.length < 2) {
    return { valid: false, error: 'كلمة السر يجب أن تتكون من حرفين أو رقمين على الأقل' };
  }
  var disallowTemp = !(options && options.disallowTempPassword === false);
  if (disallowTemp && str === getInitialUserPasswordGS()) {
    return { valid: false, error: 'لا يمكن استخدام كلمة السر المؤقتة الافتراضية؛ يرجى اختيار كلمة سر مختلفة' };
  }
  return { valid: true };
}

/**
 * التحقق من رقم التواصل: أرقام فقط مع + اختيارية في البداية (أو نص فارغ)
 */
function validateContactNumberGS(value) {
  if (value === undefined || value === null) {
    return { valid: true, cleaned: '' };
  }
  var trimmed = String(value).trim();
  if (!trimmed) {
    return { valid: true, cleaned: '' };
  }
  if (!/^\+?[0-9]+$/.test(trimmed)) {
    return { valid: false, cleaned: trimmed, error: 'رقم التواصل يجب أن يحتوي على أرقام فقط مع علامة + اختيارية في البداية' };
  }
  return { valid: true, cleaned: trimmed };
}

/**
 * تهيئة الحسابات الثلاثة الافتراضية (admin, manager, cashier) فقط إذا كان شيت المستخدمين فارغاً تماماً.
 * لا تُنشأ هذه الحسابات ولا تُعدَّل في نظام فيه مستخدمون بالفعل.
 */
function ensureDefaultUsersIfEmptyGS(ss, log) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ensureSheetWithHeaders(ss, SHEETS.USERS, [
    'ID',
    'اسم المستخدم',
    'الاسم',
    'الدور',
    'salt',
    'passwordHash',
    'الحالة',
    'تاريخ الإضافة',
    'permissionsJson',
    'isOwner',
    'رقم الهاتف',
    'cashboxConfigJson',
    'offlineVerifier',
    'offlineSalt',
    'offlineIterations',
    'permissionsUpdatedAt',
    'permissionsUpdatedByDevice',
    'warehouseConfigJson',
    'mustChangePassword'
  ], log);

  if (sheet.getLastRow() >= 2) {
    return { created: false, count: sheet.getLastRow() - 1 };
  }

  var tempPassword = getInitialUserPasswordGS();
  var now = new Date().toISOString();
  var defaultWhConfigJson = JSON.stringify({
    allowedWarehouseIds: ['wh-main-001'],
    defaultWarehouseId: 'wh-main-001'
  });
  var managerCbJson = JSON.stringify({
    allowedSaleCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
    defaultSaleCashboxId: 'cb-main-001',
    allowedReturnCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
    defaultReturnCashboxId: 'cb-main-001',
    allowedReceiptCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
    allowedPaymentCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003'],
    allowedTransferCashboxIds: ['cb-main-001', 'cb-bank-002', 'cb-vf-003']
  });
  var cashierCbJson = JSON.stringify({
    allowedSaleCashboxIds: ['cb-main-001'],
    defaultSaleCashboxId: 'cb-main-001',
    allowedReturnCashboxIds: ['cb-main-001'],
    defaultReturnCashboxId: 'cb-main-001',
    allowedReceiptCashboxIds: ['cb-main-001'],
    allowedPaymentCashboxIds: [],
    allowedTransferCashboxIds: []
  });

  var adminSalt = '9876543210abcdef9876543210abcdef';
  var managerSalt = 'abcdef1234567890abcdef1234567890';
  var cashierSalt = '1234567890abcdef1234567890abcdef';

  var defaultRows = [
    [
      'usr-admin-001',
      'admin',
      'مالك النظام',
      'designer',
      adminSalt,
      hashPassword(tempPassword, adminSalt),
      'نشط',
      now,
      JSON.stringify(ALL_PERMISSIONS),
      true,
      '',
      managerCbJson,
      '',
      '',
      '',
      now,
      'SYSTEM_INIT',
      defaultWhConfigJson,
      true
    ],
    [
      'usr-manager-002',
      'manager',
      'مدير النظام',
      'manager',
      managerSalt,
      hashPassword(tempPassword, managerSalt),
      'نشط',
      now,
      JSON.stringify(ROLE_TEMPLATES.manager),
      false,
      '',
      managerCbJson,
      '',
      '',
      '',
      now,
      'SYSTEM_INIT',
      defaultWhConfigJson,
      true
    ],
    [
      'usr-cashier-003',
      'cashier',
      'كاشير',
      'employee',
      cashierSalt,
      hashPassword(tempPassword, cashierSalt),
      'نشط',
      now,
      JSON.stringify(ROLE_TEMPLATES.employee),
      false,
      '',
      cashierCbJson,
      '',
      '',
      '',
      now,
      'SYSTEM_INIT',
      defaultWhConfigJson,
      true
    ]
  ];

  sheet.getRange(2, 1, defaultRows.length, defaultRows[0].length).setValues(defaultRows);
  if (Array.isArray(log)) {
    log.push('تم إنشاء الحسابات الثلاثة الافتراضية (admin, manager, cashier) بكلمة سر مؤقتة تتغير عند أول دخول');
  }
  return { created: true, count: defaultRows.length };
}

/**
 * فحص وتتبع محاولات الدخول الخاطئة وقفل الحساب مؤقتاً بعد 5 محاولات فاشلة
 */
function checkLoginRateLimit(normUser) {
  var cache = CacheService.getScriptCache();
  var lockKey = 'LOCKOUT_' + normUser;
  var lockedUntil = cache.get(lockKey);
  if (lockedUntil) {
    var remSeconds = Math.max(1, Math.ceil((Number(lockedUntil) - Date.now()) / 1000));
    var remMinutes = Math.ceil(remSeconds / 60);
    return { locked: true, remainingMinutes: remMinutes };
  }
  return { locked: false };
}

function recordFailedLogin(normUser) {
  var cache = CacheService.getScriptCache();
  var countKey = 'FAIL_COUNT_' + normUser;
  var currentCount = Number(cache.get(countKey) || 0) + 1;

  if (currentCount >= 5) {
    var lockKey = 'LOCKOUT_' + normUser;
    var unlockTime = Date.now() + (15 * 60 * 1000); // 15 دقيقة
    cache.put(lockKey, String(unlockTime), 900); // 900 ثانية
    cache.remove(countKey);
    return { lockedNow: true, remainingMinutes: 15 };
  } else {
    cache.put(countKey, String(currentCount), 900);
    return { lockedNow: false, triesLeft: 5 - currentCount };
  }
}

function clearFailedLogins(normUser) {
  var cache = CacheService.getScriptCache();
  cache.remove('LOCKOUT_' + normUser);
  cache.remove('FAIL_COUNT_' + normUser);
}

/**
 * تشفير كلمة المرور مع Salt باستخدام SHA-256
 */
function hashPassword(password, salt) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password + salt,
    Utilities.Charset.UTF_8
  );
  var hex = '';
  for (var i = 0; i < raw.length; i++) {
    var b = raw[i];
    if (b < 0) b += 256;
    var s = b.toString(16);
    if (s.length === 1) hex += '0';
    hex += s;
  }
  return hex;
}

/**
 * دالة مساعدة لإنشاء الورقة أو جلبها
 */
function getOrCreateSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

/**
 * دالة آمنة وقابلة لإعادة التشغيل (Idempotent) لإنشاء الورقة أو تحديث أعمدتها
 * دون مساس بالبيانات السابقة أو حذف أي صفوف أو تكرار الأعمدة
 */
function ensureSheetWithHeaders(ss, sheetName, requiredHeaders, log) {
  return withScriptLock(function() {
    var sheet = getOrCreateSheet(ss, sheetName);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(requiredHeaders);
      if (log) log.push('تم إنشاء ورقة [' + sheetName + '] مع صف العناوين القياسي (' + requiredHeaders.length + ' أعمدة)');
    } else {
      // ترحيل آمن للأعمدة الناقصة دون المساس بالأعمدة والبيانات السابقة
      var lastCol = sheet.getLastColumn();
      var existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || '').trim(); }) : [];
      for (var i = 0; i < requiredHeaders.length; i++) {
        var colName = requiredHeaders[i];
        if (existingHeaders.indexOf(colName) === -1) {
          sheet.getRange(1, lastCol + 1).setValue(colName);
          existingHeaders.push(colName);
          lastCol++;
          if (log) log.push('تمت إضافة عمود [' + colName + '] إلى ورقة [' + sheetName + ']');
        }
      }
    }
    return sheet;
  });
}

/**
 * خريطة أسماء الأعمدة لتفادي الاعتماد على مؤشرات الأعمدة الثابتة
 */
function getHeaderMap(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return { headers: [], map: {}, get: function() { return -1; } };
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').trim();
    if (h) {
      map[h] = i;
    }
  }
  return {
    headers: headers,
    map: map,
    get: function(name, fallbackIdx) {
      if (map[name] !== undefined) return map[name];
      return fallbackIdx !== undefined ? fallbackIdx : -1;
    }
  };
}

var _scriptLockDepth = 0;

/**
 * دالة مساعدة موحدة لقفل العمليات (LockService) لمدة 20 ثانية مع دعم التداخل في نفس التنفيذ
 */
function withScriptLock(fn) {
  if (_scriptLockDepth > 0) {
    _scriptLockDepth++;
    try {
      return fn();
    } finally {
      _scriptLockDepth--;
    }
  }

  var lock = LockService.getScriptLock();
  try {
    var acquired = lock.waitLock(20000);
    if (acquired === false) {
      return { success: false, error: 'النظام مشغول الآن، أعد المحاولة بعد لحظات', code: 'BUSY' };
    }
  } catch (lockErr) {
    return { success: false, error: 'النظام مشغول الآن، أعد المحاولة بعد لحظات', code: 'BUSY' };
  }

  _scriptLockDepth = 1;
  try {
    return fn();
  } finally {
    _scriptLockDepth = 0;
    try { lock.releaseLock(); } catch (_) {}
  }
}

var IDEMPOTENCY_MISSING_ERROR_GS = 'مفتاح منع التكرار (idempotencyKey) مطلوب لإتمام العملية المالية';

function getValidatedIdempotencyKeyGS(payload) {
  if (!payload || typeof payload.idempotencyKey !== 'string') {
    return null;
  }
  var trimmed = payload.idempotencyKey.trim();
  return trimmed ? trimmed : null;
}

function ensureIdempotencyKeyColumnGS(sheet) {
  if (!sheet) return { colIdx: -1, lastCol: 0 };
  return withScriptLock(function() {
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) {
      sheet.getRange(1, 1).setValue('idempotencyKey');
      return { colIdx: 1, lastCol: 1 };
    }
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').trim() === 'idempotencyKey') {
        return { colIdx: i + 1, lastCol: lastCol };
      }
    }
    sheet.getRange(1, lastCol + 1).setValue('idempotencyKey');
    return { colIdx: lastCol + 1, lastCol: lastCol + 1 };
  });
}

function findRowByIdempotencyKeyGS(sheet, key) {
  if (!sheet || !key) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var colInfo = ensureIdempotencyKeyColumnGS(sheet);
  if (colInfo.colIdx < 1) return null;
  var keyValues = sheet.getRange(2, colInfo.colIdx, lastRow - 1, 1).getValues();
  for (var i = 0; i < keyValues.length; i++) {
    if (String(keyValues[i][0] || '').trim() === key) {
      var matchedRow = i + 2;
      var lastCol = sheet.getLastColumn();
      var rowValues = sheet.getRange(matchedRow, 1, 1, lastCol).getValues()[0];
      return { rowIndex: matchedRow, rowValues: rowValues, lastCol: lastCol, keyColIdx: colInfo.colIdx };
    }
  }
  return null;
}

function buildRowWithIdempotencyKeyGS(sheet, baseRow, idempotencyKey) {
  var colInfo = ensureIdempotencyKeyColumnGS(sheet);
  var outRow = baseRow.slice();
  var targetLen = Math.max(colInfo.lastCol, colInfo.colIdx, outRow.length);
  while (outRow.length < targetLen) {
    outRow.push('');
  }
  if (colInfo.colIdx >= 1) {
    outRow[colInfo.colIdx - 1] = idempotencyKey || '';
  }
  return outRow;
}

function buildRowWithWarehouseGS(sheet, baseRow, idempotencyKey, warehouseId) {
  var outRow = buildRowWithIdempotencyKeyGS(sheet, baseRow, idempotencyKey);
  if (sheet && warehouseId !== undefined && warehouseId !== null) {
    var hMap = getHeaderMap(sheet);
    var colWh = hMap.get('warehouseId', -1);
    if (colWh === -1) {
      var lastCol = sheet.getLastColumn();
      sheet.getRange(1, lastCol + 1).setValue('warehouseId');
      colWh = lastCol;
    }
    while (outRow.length <= colWh) {
      outRow.push('');
    }
    outRow[colWh] = String(warehouseId || '');
  }
  return outRow;
}

function buildInvoiceSheetRowGS(sheet, baseRow, idempotencyKey, offlineMeta, warehouseId) {
  var outRow = buildRowWithIdempotencyKeyGS(sheet, baseRow, idempotencyKey);
  var hMap = getHeaderMap(sheet);
  var colWh = hMap.get('warehouseId', 36);

  if (offlineMeta) {
    var colDeviceId = hMap.get('offlineDeviceId', 28);
    var colProvNo = hMap.get('offlineProvisionalNo', 29);
    var colDeviceTime = hMap.get('deviceTime', 30);
    var colNeedsReview = hMap.get('needsReview', 31);
    var colReviewReasons = hMap.get('reviewReasons', 32);

    var maxIdx = Math.max(colDeviceId, colProvNo, colDeviceTime, colNeedsReview, colReviewReasons, colWh);
    while (outRow.length <= maxIdx) {
      outRow.push('');
    }

    if (colDeviceId >= 0) outRow[colDeviceId] = offlineMeta.offlineDeviceId || '';
    if (colProvNo >= 0) outRow[colProvNo] = offlineMeta.offlineProvisionalNo || '';
    if (colDeviceTime >= 0) outRow[colDeviceTime] = offlineMeta.deviceTime || '';
    if (colNeedsReview >= 0) {
      outRow[colNeedsReview] = offlineMeta.isOffline
        ? (offlineMeta.needsReview ? 'نعم' : 'لا')
        : '';
    }
    if (colReviewReasons >= 0) {
      outRow[colReviewReasons] = Array.isArray(offlineMeta.reviewReasons)
        ? offlineMeta.reviewReasons.join('، ')
        : String(offlineMeta.reviewReasons || '');
    }
  }

  if (colWh >= 0) {
    while (outRow.length <= colWh) {
      outRow.push('');
    }
    outRow[colWh] = warehouseId ? String(warehouseId) : '';
  }
  return outRow;
}

function parseReviewReasonsCellGS(rawVal) {
  if (!rawVal) return [];
  if (Array.isArray(rawVal)) return rawVal.map(function(x) { return String(x).trim(); }).filter(Boolean);
  var str = String(rawVal).trim();
  if (!str) return [];
  if (str.charAt(0) === '[') {
    try {
      var parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        return parsed.map(function(x) { return String(x).trim(); }).filter(Boolean);
      }
    } catch (_) {}
  }
  return str.split(/[،,|]+/).map(function(s) { return s.trim(); }).filter(Boolean);
}

function buildInvoiceFromRowGS(sLines, r, idempotencyKey, session) {
  var invNum = String(r[0]);
  var invStatus = String(r[8] || 'تم البيع');
  var payType = r[17] ? String(r[17]) : (invStatus === 'معلّقة' ? 'آجل' : 'نقدي');
  var cPartyType = r[18] ? String(r[18]) : undefined;
  var cPartyId = r[19] ? String(r[19]) : undefined;
  var cPartyName = r[20] ? String(r[20]) : undefined;
  var cDueAmount = (r[21] !== undefined && r[21] !== '') ? Number(r[21]) : undefined;
  var cPaidAmount = (r[22] !== undefined && r[22] !== '') ? Number(r[22]) : (payType === 'آجل' ? 0 : (Number(r[6]) || 0));
  var cRemAmount = (r[23] !== undefined && r[23] !== '') ? Number(r[23]) : (payType === 'آجل' ? (cDueAmount || 0) : 0);
  var cStatus = r[24] ? String(r[24]) : (payType === 'آجل' ? (invStatus === 'مسددة' ? 'مسددة' : 'معلّقة') : undefined);
  var canViewProfit = session ? (session.role === 'designer' || (session.permissions && session.permissions.indexOf('reports.view_profit') !== -1)) : false;
  var canViewPurchase = session ? (session.role === 'designer' || (session.permissions && session.permissions.indexOf('prices.view_purchase') !== -1)) : false;

  var lines = [];
  if (sLines && sLines.getLastRow() > 1) {
    var lLastRow = sLines.getLastRow();
    var lLastCol = sLines.getLastColumn();
    var lInvCols = sLines.getRange(2, 1, lLastRow - 1, 1).getValues();
    for (var j = 0; j < lInvCols.length; j++) {
      if (String(lInvCols[j][0]) === invNum) {
        var lr = sLines.getRange(j + 2, 1, 1, lLastCol).getValues()[0];
        var basePriceVal = lr[17] !== undefined && lr[17] !== '' ? Number(lr[17]) : Number(lr[4]) || 0;
        var bnplPctVal = lr[18] !== undefined && lr[18] !== '' ? Number(lr[18]) : 0;
        var bnplUnitVal = lr[19] !== undefined && lr[19] !== '' ? Number(lr[19]) : 0;
        var custPriceVal = lr[20] !== undefined && lr[20] !== '' ? Number(lr[20]) : Number(lr[4]) || 0;
        var lineQty = Number(lr[3]) || 1;
        var lineObj = {
          invoiceNumber: invNum,
          itemId: String(lr[1]),
          itemNameAtSale: String(lr[2]),
          quantity: lineQty,
          salePriceAtSale: Number(lr[4]) || 0,
          baseUnitPrice: basePriceVal,
          customerUnitPrice: custPriceVal,
          bnplPercent: bnplPctVal,
          bnplUnitAmount: bnplUnitVal,
          totalBnplAmount: bnplUnitVal * lineQty,
          platformDiscountPercentAtSale: Number(lr[7]) || 0,
          unitDiscountValue: Number(lr[8]) || 0,
          unitNet: Number(lr[10]) || 0
        };
        if (lr[21] !== undefined && lr[21] !== '') lineObj.bnplDeductionUnit = Number(lr[21]) || 0;
        if (lr[22] !== undefined && lr[22] !== '') lineObj.totalBnplDeduction = Number(lr[22]) || 0;
        if (lr.length > 23 && lr[23] !== undefined && lr[23] !== '') lineObj.itemPrintNameAtSale = String(lr[23]);
        if (lr[15] !== undefined && lr[15] !== '') lineObj.unitPickupFee = Number(lr[15]) || 0;
        if (lr[16] !== undefined && lr[16] !== '') lineObj.totalPickupFee = Number(lr[16]) || 0;
        if (lr[12] !== undefined && lr[12] !== '') lineObj.barcodeAtSale = String(lr[12]);
        if (lr[13] !== undefined && lr[13] !== '') lineObj.taxRateAtSale = Number(lr[13]) || 0;
        if (lr[14] !== undefined && lr[14] !== '') lineObj.unitTaxAmount = Number(lr[14]) || 0;
        if (canViewPurchase) {
          lineObj.purchasePriceAtSale = Number(lr[5]) || 0;
          lineObj.packagingCostAtSale = Number(lr[6]) || 0;
        }
        if (canViewProfit) {
          lineObj.unitProfit = Number(lr[11]) || 0;
        }
        lines.push(lineObj);
      }
    }
  }

  var inv = {
    id: invNum,
    invoiceNumber: invNum,
    date: String(r[1]),
    receivedAt: String(r[1]),
    platformName: String(r[2]),
    platform: String(r[2]),
    totalBeforeDiscount: Number(r[3]) || 0,
    discountAmount: Number(r[4]) || 0,
    deliveryFee: Number(r[15]) || 0,
    bnplTotalAmount: Number(r[16]) || 0,
    netAmount: Number(r[6]) || 0,
    status: invStatus,
    paymentType: payType,
    creditPartyType: cPartyType,
    creditPartyId: cPartyId,
    creditPartyName: cPartyName,
    customerId: cPartyType === 'customer' ? cPartyId : undefined,
    customerName: cPartyType === 'customer' ? cPartyName : undefined,
    creditDueAmount: cDueAmount,
    paidAmount: cPaidAmount,
    remainingAmount: cRemAmount,
    creditStatus: cStatus,
    notes: String(r[9] || ''),
    createdBy: String(r[10] || ''),
    idempotencyKey: idempotencyKey || (r.length > 27 && r[27] ? String(r[27]) : undefined),
    lines: lines
  };
  if (r[11] !== undefined && r[11] !== '') inv.taxAmount = Number(r[11]) || 0;
  if (r.length > 25 && r[25] !== undefined && r[25] !== '') inv.bnplPercentApplied = Number(r[25]);
  if (r.length > 26 && r[26] !== undefined && r[26] !== '') inv.commissionPercentApplied = Number(r[26]);
  if (r.length > 28 && r[28] !== undefined && String(r[28]).trim() !== '') {
    inv.offlineDeviceId = String(r[28]).trim();
    inv.deviceId = inv.offlineDeviceId;
    inv.isOffline = true;
  }
  if (r.length > 29 && r[29] !== undefined && String(r[29]).trim() !== '') {
    inv.offlineProvisionalNo = String(r[29]).trim();
    inv.isOffline = true;
  }
  if (r.length > 30 && r[30] !== undefined && String(r[30]).trim() !== '') {
    inv.deviceTime = String(r[30]).trim();
  }
  var explicitNeedsReview = false;
  if (r.length > 31 && r[31] !== undefined && String(r[31]).trim() !== '') {
    var nrStr = String(r[31]).trim().toLowerCase();
    explicitNeedsReview = true;
    inv.needsReview = (r[31] === true || nrStr === 'true' || nrStr === 'نعم' || nrStr === '1');
  }
  if (r.length > 32 && r[32] !== undefined && String(r[32]).trim() !== '') {
    inv.reviewReasons = parseReviewReasonsCellGS(r[32]);
    if (inv.reviewReasons.length > 0 && !explicitNeedsReview) inv.needsReview = true;
  }
  if (r.length > 33 && r[33] !== undefined && String(r[33]).trim() !== '') {
    inv.reviewedAt = String(r[33]).trim();
  }
  if (r.length > 34 && r[34] !== undefined && String(r[34]).trim() !== '') {
    inv.reviewedBy = String(r[34]).trim();
  }
  if (r.length > 35 && r[35] !== undefined && String(r[35]).trim() !== '') {
    inv.reviewNote = String(r[35]).trim();
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var whLookup = getWarehouseLookupMapGS(ss);
  var rawWhId = (r.length > 36 && r[36] !== undefined && String(r[36]).trim() !== '')
    ? String(r[36]).trim()
    : whLookup.defaultId;
  inv.warehouseId = rawWhId;
  inv.warehouseName = (whLookup.byId[rawWhId] && whLookup.byId[rawWhId].name) || whLookup.defaultName;
  if (canViewProfit) inv.profit = Number(r[7]) || 0;
  return inv;
}

/**
 * تهيئة الأوراق والأعمدة تلقائيًا مع دعم الترحيل الآمن للبيانات القديمة
 * وضمان عدم حذف أي بيانات سابقة وقابلية إعادة التشغيل المتكرر (Idempotent)
 */
function setupSheets() {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var log = [];

  // 1. Items (الأصناف مع الحقول الجديدة: كود SKU، حد إعادة الطلب، المورد الافتراضي، معرّف التصنيف، تفعيل ونسبة BNPL)
  ensureSheetWithHeaders(ss, SHEETS.ITEMS, [
    'ID',
    'اسم الصنف',
    'رابط الصورة',
    'سعر البيع',
    'سعر الشراء',
    'تكلفة التغليف',
    'الكمية بالمخزن',
    'ملاحظات',
    'تاريخ الإضافة',
    'حالة الصنف',
    'الباركود الأساسي',
    'المورد',
    'نسبة الضريبة',
    'الحد الأدنى لسعر البيع',
    'كود SKU',
    'حد إعادة الطلب',
    'المورد الافتراضي',
    'ID التصنيف',
    'تفعيل BNPL',
    'نسبة BNPL',
    'معرفات المنصات المتاحة',
    'رسوم الالتقاط للقطعة',
    'وحدة القياس',
    'اسم الطباعة'
  ], log);

  // 1b. ItemBarcodes (الباركودات المتعددة والفرعية)
  ensureSheetWithHeaders(ss, SHEETS.ITEM_BARCODES, [
    'ID',
    'ID الصنف',
    'الباركود',
    'نوع الباركود',
    'الوصف أو المسمى',
    'نشط',
    'تاريخ الإنشاء'
  ], log);

  // 1c. ItemChangeLog (سجل تعديل بيانات الصنف والقيم القديمة والجديدة)
  ensureSheetWithHeaders(ss, SHEETS.ITEM_CHANGE_LOG, [
    'ID',
    'ID الصنف',
    'اسم الصنف',
    'الحقل المعدل',
    'القيمة القديمة',
    'القيمة الجديدة',
    'المستخدم',
    'التاريخ والوقت',
    'سبب التعديل'
  ], log);

  // 2. Platforms (المنصات الإلكترونية)
  var sPlatforms = ensureSheetWithHeaders(ss, SHEETS.PLATFORMS, [
    'ID',
    'اسم المنصة / العميل',
    'نسبة الخصم المئوية',
    'ملاحظات',
    'الحالة',
    'رسوم الالتقاط (جنيه لكل قطعة)',
    'تفعيل BNPL',
    'نسبة BNPL',
    'طريقة رسوم الالتقاط'
  ], log);

  if (sPlatforms.getLastRow() === 1) {
    sPlatforms.appendRow([generateUUID(), 'أمازون (Amazon.eg)', 14.5, 'عمولة منصة أمازون مصر', 'نشطة', 25.0, 'لا', 0, 'platform']);
    sPlatforms.appendRow([generateUUID(), 'جوميا (Jumia Egypt)', 12.0, 'عمولة منصة جوميا', 'نشطة', 20.0, 'لا', 0, 'platform']);
    sPlatforms.appendRow([generateUUID(), 'بي تك (B.TECH)', 10.0, 'مبيعات بي تك أونلاين', 'نشطة', 0, 'لا', 0, 'platform']);
    sPlatforms.appendRow([generateUUID(), 'نون (Noon Egypt)', 15.0, 'عمولة منصة نون FBN/FBP', 'نشطة', 30.0, 'لا', 0, 'platform']);
    sPlatforms.appendRow([generateUUID(), 'البيع المباشر / المعرض', 0, 'مبيعات مباشرة بدون عمولة منصة', 'نشطة', 0, 'لا', 0, 'platform']);
    log.push('تمت إضافة المنصات الافتراضية ورسوم الالتقاط وإعدادات BNPL');
  }

  // 3. ItemPlatformCosts (تكاليف شحن المنصات)
  ensureSheetWithHeaders(ss, SHEETS.ITEM_PLATFORM_COSTS, [
    'ID الصنف',
    'ID المنصة',
    'تكلفة الشحن للصنف على المنصة',
    'قيمة خصم المنصة من مصاريف الشحن عند المرتجع'
  ], log);

  // 4. Invoices (الفواتير)
  ensureSheetWithHeaders(ss, SHEETS.INVOICES, [
    'رقم الفاتورة',
    'التاريخ',
    'المنصة',
    'الإجمالي قبل الخصم',
    'قيمة الخصم',
    'مصاريف الشحن',
    'الصافي',
    'الربح',
    'الحالة',
    'ملاحظات',
    'المستخدم الذي أنشأ الفاتورة',
    'إجمالي الضريبة',
    'إجمالي رسوم الالتقاط',
    'معدلة',
    'تاريخ آخر تعديل',
    'رسوم التوصيل',
    'إجمالي خصم BNPL',
    'نوع الدفع',
    'نوع طرف الآجل',
    'معرّف الطرف',
    'اسم الطرف',
    'مبلغ الاستحقاق',
    'المبلغ المدفوع',
    'المبلغ المتبقي',
    'حالة الآجل',
    'نسبة BNPL المطبقة',
    'نسبة عمولة المنصة المطبقة',
    'idempotencyKey',
    'offlineDeviceId',
    'offlineProvisionalNo',
    'deviceTime',
    'needsReview',
    'reviewReasons',
    'reviewedAt',
    'reviewedBy',
    'reviewNote',
    'warehouseId'
  ], log);

  // 5. InvoiceLines (سطور الفواتير)
  ensureSheetWithHeaders(ss, SHEETS.INVOICE_LINES, [
    'رقم الفاتورة',
    'الصنف',
    'اسم الصنف وقت البيع',
    'الكمية',
    'سعر البيع وقت البيع',
    'تكلفة الشراء وقت البيع',
    'تكلفة التغليف وقت البيع',
    'نسبة خصم المنصة وقت البيع',
    'قيمة الخصم للوحدة',
    'تكلفة الشحن للوحدة',
    'صافي الوحدة',
    'ربح الوحدة',
    'الباركود وقت البيع',
    'نسبة الضريبة وقت البيع',
    'قيمة الضريبة للوحدة',
    'رسوم الالتقاط للوحدة',
    'إجمالي رسوم الالتقاط للسطر',
    'السعر الأساسي',
    'نسبة BNPL',
    'قيمة زيادة BNPL',
    'سعر العميل',
    'قيمة استقطاع BNPL للوحدة',
    'إجمالي استقطاع BNPL للسطر',
    'اسم الطباعة وقت البيع'
  ], log);

  // 6. Returns (المرتجعات)
  ensureSheetWithHeaders(ss, SHEETS.RETURNS, [
    'رقم المرتجع',
    'رقم الفاتورة',
    'التاريخ',
    'الأصناف المرتجعة أو ملخصها',
    'إجمالي خصم المنصة من الشحن عند المرتجع',
    'سبب الرجوع',
    'ملاحظات',
    'المستخدم الذي سجل المرتجع',
    'idempotencyKey',
    'warehouseId'
  ], log);

  // 7. ReturnLines (سطور المرتجع)
  ensureSheetWithHeaders(ss, SHEETS.RETURN_LINES, [
    'رقم المرتجع',
    'رقم الفاتورة',
    'رقم سطر الفاتورة',
    'ID الصنف',
    'الكمية المرتجعة',
    'خصم شحن المرتجع للوحدة وقت التسجيل',
    'إجمالي خصم الشحن لهذا السطر',
    'حالة الصنف'
  ], log);

  // 8. Users (المستخدمين والصلاحيات)
  ensureSheetWithHeaders(ss, SHEETS.USERS, [
    'ID',
    'اسم المستخدم',
    'الاسم',
    'الدور',
    'salt',
    'passwordHash',
    'الحالة',
    'تاريخ الإضافة',
    'permissionsJson',
    'isOwner',
    'رقم الهاتف',
    'cashboxConfigJson',
    'offlineVerifier',
    'offlineSalt',
    'offlineIterations',
    'permissionsUpdatedAt',
    'permissionsUpdatedByDevice',
    'warehouseConfigJson',
    'mustChangePassword'
  ], log);
  ensureDefaultUsersIfEmptyGS(ss, log);

  // 9. Settings (الإعدادات)
  var sSettings = ensureSheetWithHeaders(ss, SHEETS.SETTINGS, ['key', 'value', 'updatedAt'], log);
  var defaultCompanySettings = {
    storeName: 'POS مدقق للمنصات الإلكترونية',
    brandTagline: 'نظام التدقيق الشامل ونقاط البيع للمنصات الرقمية',
    logoUrl: '',
    phone: '',
    email: '',
    address: '',
    taxNumber: '',
    commercialRecord: '',
    themeColor: '#0e7490',
    accentColor: '#14b8a6',
    fontFamily: 'Tajawal',
    enableDeliveryFee: false,
    supportWhatsapp: '',
    supportPhone: '',
    salesWhatsapp: '',
    salesPhone: ''
  };
  var defaultInvoiceSettings = {
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
    termsAndConditions: 'البضاعة المباعة يمكن إرجاعها خلال 14 يومًا بحالتها الأصلية وفق سياسة كل منصة.',
    returnPolicyText: 'يتم احتساب استقطاع شحن المرتجع المعتمد للمنصة عند استرجاع المنتج.',
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
  var defaultDisplaySettings = {
    showItemImages: true,
    showStockQuantity: true,
    showStockStatusBadge: true,
    showSalePrice: true,
    visibleColumns: ['image', 'name', 'salePrice', 'stock', 'actions'],
    posLayout: 'grid',
    enableQuickBarcodeScan: true,
    confirmInvoiceBeforeSave: true,
    autoFillCashPaid: true,
    enableInlineEdit: false
  };
  var defaultStockSettings = {
    allowNegativeStockSale: false,
    allowNegativeWarehouseTransfer: false
  };

  if (sSettings.getLastRow() === 1) {
    var nowStr = new Date().toISOString();
    sSettings.appendRow(['storeName', 'POS مدقق للمنصات الإلكترونية', nowStr]);
    sSettings.appendRow(['currency', 'EGP', nowStr]);
    sSettings.appendRow(['lowStockThreshold', '5', nowStr]);
    sSettings.appendRow(['enableDeliveryFee', 'false', nowStr]);
    sSettings.appendRow(['companySettings', JSON.stringify(defaultCompanySettings), nowStr]);
    sSettings.appendRow(['invoicePrintSettings', JSON.stringify(defaultInvoiceSettings), nowStr]);
    sSettings.appendRow(['displaySettings', JSON.stringify(defaultDisplaySettings), nowStr]);
    sSettings.appendRow(['stockSettings', JSON.stringify(defaultStockSettings), nowStr]);
    log.push('تمت إضافة الإعدادات الافتراضية الأولية');
  } else {
    // دمج المفاتيح الناقصة فقط في الجداول القائمة مسبقاً دون مسح أو استبدال أي قيمة موجودة
    var existingSettingsData = sSettings.getDataRange().getValues();
    var defaultsByRowKey = {
      companySettings: defaultCompanySettings,
      invoicePrintSettings: defaultInvoiceSettings,
      displaySettings: defaultDisplaySettings,
      stockSettings: defaultStockSettings
    };
    var foundRowKeys = {};
    for (var sIdx = 1; sIdx < existingSettingsData.length; sIdx++) {
      var rowKey = String(existingSettingsData[sIdx][0]);
      foundRowKeys[rowKey] = true;
      if (defaultsByRowKey[rowKey]) {
        try {
          var currentRowVal = existingSettingsData[sIdx][1];
          var parsedRowObj = (typeof currentRowVal === 'string') ? JSON.parse(currentRowVal) : currentRowVal;
          if (parsedRowObj && typeof parsedRowObj === 'object') {
            var rowUpdated = false;
            var targetDefaults = defaultsByRowKey[rowKey];
            for (var defKey in targetDefaults) {
              if (typeof parsedRowObj[defKey] === 'undefined') {
                parsedRowObj[defKey] = targetDefaults[defKey];
                rowUpdated = true;
              }
            }
            if (rowKey === 'invoicePrintSettings' && parsedRowObj.headerText === 'فاتورة مبيعات مدققة وموثقة على المنصة') {
              parsedRowObj.headerText = '';
              rowUpdated = true;
            }
            if (rowUpdated) {
              sSettings.getRange(sIdx + 1, 2).setValue(JSON.stringify(parsedRowObj));
              sSettings.getRange(sIdx + 1, 3).setValue(new Date().toISOString());
              log.push('تم دمج المفاتيح الافتراضية الناقصة في ' + rowKey + ' دون مسح القيم الحالية');
            }
          }
        } catch (_) {}
      }
    }
    for (var missingRowKey in defaultsByRowKey) {
      if (!foundRowKeys[missingRowKey]) {
        sSettings.appendRow([missingRowKey, JSON.stringify(defaultsByRowKey[missingRowKey]), new Date().toISOString()]);
        log.push('تمت إضافة مفتاح ' + missingRowKey + ' الافتراضي للجدول القائم');
      }
    }
  }

  // 10. AuditLogs (سجل التدقيق)
  ensureSheetWithHeaders(ss, SHEETS.AUDIT_LOGS, [
    'ID',
    'التاريخ والوقت',
    'معرف الفاعل',
    'اسم الفاعل',
    'دور الفاعل',
    'نوع الإجراء',
    'نوع الهدف',
    'معرف الهدف',
    'تفاصيل التغيير'
  ], log);

  // 11. Sessions (جلسات المصادقة)
  ensureSheetWithHeaders(ss, SHEETS.SESSIONS, [
    'رمز الجلسة (Token)',
    'معرف المستخدم',
    'رقم الهاتف',
    'الدور',
    'الصلاحيات',
    'تاريخ الإنشاء',
    'تاريخ الانتهاء'
  ], log);

  // 12. InvoiceEditLogs (سجل تعديل الفواتير)
  ensureSheetWithHeaders(ss, SHEETS.INVOICE_EDIT_LOGS, [
    'ID',
    'رقم الفاتورة',
    'تاريخ ووقت التعديل',
    'المستخدم المعدل',
    'سبب التعديل',
    'ملخص التغييرات',
    'لقطة الفاتورة السابقة (JSON)',
    'لقطة الفاتورة بعد التعديل (JSON)'
  ], log);

  // 13. StockMovements (حركات المخزون التاريخية)
  ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
    'ID',
    'ID الصنف',
    'اسم الصنف',
    'نوع الحركة',
    'الكمية',
    'الرصيد بعد الحركة',
    'السبب',
    'رقم المرجع أو المستند',
    'المستخدم',
    'التاريخ والوقت',
    'ملاحظات',
    'warehouseId'
  ], log);

  // 14. CashboxEntries (قيود الخزينة التاريخية)
  ensureSheetWithHeaders(ss, SHEETS.CASHBOX_ENTRIES, [
    'ID',
    'رقم الفاتورة أو المرجع',
    'نوع القيد',
    'المبلغ',
    'المنصة',
    'التاريخ والوقت',
    'ملاحظات'
  ], log);

  // 15. Suppliers (الموردين)
  ensureSheetWithHeaders(ss, SHEETS.SUPPLIERS, [
    'ID',
    'اسم المورد',
    'كود المورد',
    'المجموعة',
    'رقم الهاتف',
    'الهاتف الإضافي',
    'البريد الإلكتروني',
    'العنوان',
    'الرقم الضريبي',
    'السجل التجاري',
    'الرصيد الافتتاحي',
    'الرصيد الحالي',
    'الحالة',
    'ملاحظات',
    'تاريخ الإضافة'
  ], log);

  // 16. SupplierGroups (مجموعات الموردين)
  ensureSheetWithHeaders(ss, SHEETS.SUPPLIER_GROUPS, [
    'ID',
    'اسم المجموعة',
    'الوصف',
    'تاريخ الإنشاء'
  ], log);

  // 17. Purchases (فواتير المشتريات)
  ensureSheetWithHeaders(ss, SHEETS.PURCHASES, [
    'رقم فاتورة الشراء',
    'رقم فاتورة المورد',
    'التاريخ',
    'ID المورد',
    'اسم المورد',
    'إجمالي المنتجات قبل الضريبة',
    'إجمالي الضريبة',
    'إجمالي الخصم',
    'مصاريف الشحن والتفريغ',
    'الصافي الإجمالي',
    'المبلغ المدفوع',
    'المبلغ المتبقي',
    'حالة الدفع',
    'طريقة الدفع',
    'الخزينة المستخدمة',
    'حالة الاستلام',
    'المستخدم',
    'ملاحظات',
    'تاريخ الإنشاء',
    'idempotencyKey',
    'warehouseId'
  ], log);

  // 18. PurchaseLines (سطور فواتير المشتريات)
  ensureSheetWithHeaders(ss, SHEETS.PURCHASE_LINES, [
    'رقم فاتورة الشراء',
    'رقم سطر الفاتورة',
    'ID الصنف',
    'كود SKU',
    'اسم الصنف',
    'الكمية المطلوبة',
    'الكمية المستلمة',
    'سعر شراء الوحدة',
    'تكلفة التغليف للوحدة',
    'نسبة الضريبة %',
    'قيمة الضريبة',
    'قيمة الخصم',
    'إجمالي السطر',
    'الباركود',
    'ملاحظات'
  ], log);

  // 19. PurchaseReturns (مرتجعات المشتريات)
  ensureSheetWithHeaders(ss, SHEETS.PURCHASE_RETURNS, [
    'رقم إذن مرتجع الشراء',
    'رقم فاتورة الشراء الأصلية',
    'التاريخ',
    'ID المورد',
    'اسم المورد',
    'إجمالي قيمة المرتجع',
    'الضريبة المستردة',
    'الصافي المسترد',
    'حالة الاسترداد المالي',
    'الخزينة المستلمة',
    'سبب الإرجاع',
    'المستخدم',
    'ملاحظات',
    'idempotencyKey',
    'warehouseId'
  ], log);

  // 20. PurchaseReturnLines (سطور مرتجعات المشتريات)
  ensureSheetWithHeaders(ss, SHEETS.PURCHASE_RETURN_LINES, [
    'رقم إذن مرتجع الشراء',
    'رقم سطر المرتجع',
    'ID الصنف',
    'اسم الصنف',
    'الكمية المرتجعة',
    'سعر الوحدة عند الشراء',
    'الضريبة للوحدة',
    'إجمالي السطر المرتجع',
    'حالة الصنف'
  ], log);

  // 21. SupplierLedger (دفتر أستاذ الموردين - كشف الحساب التاريخي)
  ensureSheetWithHeaders(ss, SHEETS.SUPPLIER_LEDGER, [
    'ID',
    'التاريخ والوقت',
    'ID المورد',
    'اسم المورد',
    'نوع المعاملة',
    'رقم المستند / المرجع',
    'مدين (لنا)',
    'دائن (علينا)',
    'الرصيد بعد الحركة',
    'البيان / الشرح',
    'المستخدم',
    'ملاحظات',
    'idempotencyKey'
  ], log);

  // 22. Customers (العملاء)
  ensureSheetWithHeaders(ss, SHEETS.CUSTOMERS, [
    'ID',
    'اسم العميل',
    'كود العميل',
    'المجموعة',
    'رقم الهاتف',
    'الهاتف الإضافي',
    'البريد الإلكتروني',
    'المدينة / المنطقة',
    'العنوان التفصيلي',
    'الرقم الضريبي',
    'حد الائتمان',
    'الرصيد الافتتاحي',
    'الرصيد الحالي',
    'الحالة',
    'ملاحظات',
    'تاريخ الإضافة'
  ], log);

  // 23. CustomerGroups (مجموعات العملاء)
  ensureSheetWithHeaders(ss, SHEETS.CUSTOMER_GROUPS, [
    'ID',
    'اسم المجموعة',
    'نسبة الخصم الافتراضية %',
    'الوصف',
    'تاريخ الإنشاء'
  ], log);

  // 24. CustomerLedger (دفتر أستاذ العملاء - كشف الحساب التاريخي)
  ensureSheetWithHeaders(ss, SHEETS.CUSTOMER_LEDGER, [
    'ID',
    'التاريخ والوقت',
    'ID العميل',
    'اسم العميل',
    'نوع المعاملة',
    'رقم المستند / المرجع',
    'مدين (عليه)',
    'دائن (له)',
    'الرصيد بعد الحركة',
    'البيان / الشرح',
    'المستخدم',
    'ملاحظات',
    'idempotencyKey'
  ], log);

  // 25. Cashboxes (الخزائن ونقاط النقدية)
  var sCashboxes = ensureSheetWithHeaders(ss, SHEETS.CASHBOXES, [
    'ID',
    'اسم الخزينة',
    'نوع الخزينة',
    'العملة',
    'الرصيد الافتتاحي',
    'الرصيد الحالي',
    'الحالة',
    'ملاحظات',
    'تاريخ الإنشاء'
  ], log);

  if (sCashboxes.getLastRow() === 1) {
    sCashboxes.appendRow([generateUUID(), 'الخزينة الرئيسية (الكاشير)', 'نقدية محلية', 'EGP', 0, 0, 'نشطة', 'الخزينة النقدية الرئيسية لنقطة البيع', new Date().toISOString()]);
    log.push('تم إنشاء الخزينة النقدية الرئيسية الافتراضية');
  }

  // 26. CashboxTransactions (حركات الخزينة التفصيلية)
  ensureSheetWithHeaders(ss, SHEETS.CASHBOX_TRANSACTIONS, [
    'ID',
    'التاريخ والوقت',
    'ID الخزينة',
    'اسم الخزينة',
    'نوع الحركة',
    'رقم المستند / المرجع',
    'المبلغ',
    'الرصيد بعد الحركة',
    'الجهة / الطرف الآخر',
    'البيان',
    'المستخدم',
    'ملاحظات',
    'idempotencyKey'
  ], log);

  // 27. CashboxTransfers (التحويلات بين الخزائن)
  ensureSheetWithHeaders(ss, SHEETS.CASHBOX_TRANSFERS, [
    'رقم التحويل',
    'التاريخ والوقت',
    'من خزينة ID',
    'من خزينة اسم',
    'إلى خزينة ID',
    'إلى خزينة اسم',
    'المبلغ المحول',
    'رسوم التحويل',
    'المبلغ الصافي المستلم',
    'المستخدم المحول',
    'المستخدم المستلم',
    'الحالة',
    'ملاحظات',
    'idempotencyKey'
  ], log);

  // 28. UserCashboxAssignments (تخصيص الخزائن للمستخدمين)
  ensureSheetWithHeaders(ss, SHEETS.USER_CASHBOX_ASSIGNMENTS, [
    'ID',
    'ID المستخدم',
    'اسم المستخدم',
    'ID الخزينة',
    'اسم الخزينة',
    'نوع الصلاحية',
    'افتراضية',
    'الحالة',
    'تاريخ التخصيص'
  ], log);

  // 29. ImportBatches (دفعات الاستيراد)
  ensureSheetWithHeaders(ss, SHEETS.IMPORT_BATCHES, [
    'ID الدفعة',
    'التاريخ والوقت',
    'نوع البيانات المستوردة',
    'اسم الملف أو المصدر',
    'عدد السجلات الكلي',
    'عدد السجلات الناجحة',
    'عدد السجلات الفاشلة',
    'المستخدم المنفذ',
    'ملف أو سجل الأخطاء',
    'ملاحظات'
  ], log);

  // 30. ProductCategories (قاعدة بيانات التصنيفات الشجرية)
  var sCategories = ensureSheetWithHeaders(ss, SHEETS.PRODUCT_CATEGORIES, [
    'ID',
    'اسم التصنيف',
    'ID التصنيف الأب',
    'الحالة',
    'الظهور في نقطة البيع',
    'ترتيب العرض',
    'تاريخ الإنشاء',
    'تاريخ التعديل'
  ], log);

  if (sCategories.getLastRow() === 1) {
    var nowIso = new Date().toISOString();
    sCategories.appendRow(['cat-elec', 'إلكترونيات وأجهزة ذكية', '', 'نشط', 'TRUE', 1, nowIso, nowIso]);
    sCategories.appendRow(['cat-chargers', 'شواحن وكابلات سريعة', 'cat-elec', 'نشط', 'TRUE', 1, nowIso, nowIso]);
    sCategories.appendRow(['cat-audio', 'سماعات وصوتيات', 'cat-elec', 'نشط', 'TRUE', 2, nowIso, nowIso]);
    sCategories.appendRow(['cat-appliances', 'أجهزة منزلية ومطبخ', '', 'نشط', 'TRUE', 2, nowIso, nowIso]);
    sCategories.appendRow(['cat-kettles', 'غلايات ومحضرات مشروبات', 'cat-appliances', 'نشط', 'TRUE', 1, nowIso, nowIso]);
    log.push('تمت إضافة التصنيفات الافتراضية الأولية وقاعدة البيانات الشجرية');
  }

  // 31. PartyLedger (سجل حساب الأطراف الموحد بحركات: عميل أو منصة)
  ensureSheetWithHeaders(ss, SHEETS.PARTY_LEDGER, [
    'ID',
    'التاريخ والوقت',
    'نوع الطرف',
    'معرّف الطرف',
    'اسم الطرف',
    'نوع المعاملة',
    'رقم المستند / المرجع',
    'مدين (عليه)',
    'دائن (له)',
    'الرصيد بعد الحركة',
    'البيان / الشرح',
    'المستخدم',
    'ملاحظات',
    'idempotencyKey'
  ], log);

  // 32. BulkEditUndo (لقطات القيم القديمة للتراجع عن آخر عملية تعديل بالإكسيل)
  ensureSheetWithHeaders(ss, SHEETS.BULK_EDIT_UNDO, [
    'ID الدفعة',
    'نوع العملية',
    'وصف العملية',
    'اسم الملف',
    'تاريخ التنفيذ',
    'المستخدم المنفذ',
    'معرف المستخدم',
    'ID الصنف',
    'اسم الصنف',
    'بيانات الصف السابقة (JSON)',
    'الباركودات السابقة (JSON)',
    'معرف المخزن',
    'الكمية السابقة بالمخزن'
  ], log);

  // 33. Warehouses (المخازن)
  ensureSheetWithHeaders(ss, SHEETS.WAREHOUSES, WAREHOUSES_HEADERS_GS, log);

  // 34. WarehouseStocks (أرصدة الأصناف في المخازن)
  ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_STOCKS, WAREHOUSE_STOCKS_HEADERS_GS, log);

  // 35. UserWarehouses (تخصيص المخازن للمستخدمين)
  ensureSheetWithHeaders(ss, SHEETS.USER_WAREHOUSES, USER_WAREHOUSES_HEADERS_GS, log);

  // 36. WarehouseDispatchOrders (أوامر الصرف والتحويل بين المخازن)
  ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_DISPATCH_ORDERS, DISPATCH_ORDERS_HEADERS_GS, log);

  // 37. WarehouseDispatchOrderLines (سطور أوامر الصرف)
  ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_DISPATCH_ORDER_LINES, DISPATCH_ORDER_LINES_HEADERS_GS, log);

  // ترحيل الكميات الحالية إلى المخزن الرئيسي لمرة واحدة مع التحقق الحسابي
  migrateItemStocksToMainWarehouseOnceGS(log);

  return {
    success: true,
    message: 'تمت تهيئة وتحديث جميع جداول قواعد بيانات ونظام أمان POS مدقق بنجاح دون أي مساس بالبيانات القديمة',
    details: log
    };
  });
}

/**
 * ============================================================================
 * دالة التهيئة والترقية اليدوية لقاعدة بيانات POS مدقق
 * ============================================================================
 * 
 * طريقة التشغيل اليدوي من محرر Google Apps Script:
 * 1. افتح مشروع Apps Script عبر Extensions > Apps Script في جدول البيانات.
 * 2. من الشريط العلوي، اختر الدالة: initMudaqqeqDatabase
 * 3. اضغط على زر التشغيل "Run" (أو تشغيل).
 * 4. افتح "Execution log" (سجل التنفيذ) بالأسفل لعرض تقرير التحديث والأوراق التي تم إنشاؤها أو فحصها.
 * 5. الدالة آمنة 100% وقابلة للتكرار (Idempotent) ولا تمسح أي بيانات سابقة.
 */
function initMudaqqeqDatabase() {
  var res = setupSheets();
  Logger.log('=== تقرير تهيئة وترقية قاعدة بيانات POS مدقق للمنصات ===');
  Logger.log(res.message);
  if (res.details && res.details.length > 0) {
    for (var i = 0; i < res.details.length; i++) {
      Logger.log(' [' + (i + 1) + '] ' + res.details[i]);
    }
  } else {
    Logger.log('جميع الجداول والأعمدة محدثة بالفعل ولا توجد أي تعديلات مطلوبة.');
  }
  return res;
}

/**
 * تسجيل حدث في سجل التدقيق AuditLogs
 */
function logAudit(actor, action, targetType, targetId, details) {
  withScriptLock(function() {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sAudit = ss.getSheetByName(SHEETS.AUDIT_LOGS);
      if (!sAudit) return;

      var actorId = actor ? (actor.id || actor.userId || 'system') : 'system';
      var actorName = actor ? (actor.name || 'النظام') : 'النظام';
      var actorRole = actor ? (actor.role || 'system') : 'system';

      sAudit.appendRow([
        generateUUID(),
        new Date().toISOString(),
        actorId,
        actorName,
        actorRole,
        action || '',
        targetType || '',
        targetId || '',
        typeof details === 'object' ? JSON.stringify(details) : String(details || '')
      ]);
    } catch (err) {
      console.error('Failed to write audit log:', err);
    }
  });
}

/**
 * فحص هل يوجد مالك/مصمم مسجل بالنظام
 */
function hasAnyOwner() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.USERS);
  if (!sheet || sheet.getLastRow() < 2) return false;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var role = String(row[3] || '').trim();
    var status = String(row[6] || '').trim();
    var isOwner = row[9] === true || String(row[9] || '').toLowerCase() === 'true';

    var isActive = (status === 'نشط' || status === 'active' || status === 'true');
    if (isActive && (role === 'designer' || role === 'مصمم النظام' || role === 'مالك النظام' || isOwner)) {
      return true;
    }
  }
  return false;
}

/**
 * فحص هل يوجد أي مدير أو مالك مسجل بالنظام
 */
function hasAnyManager() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.USERS);
  if (!sheet || sheet.getLastRow() < 2) return false;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var role = String(data[i][3]).trim();
    var status = String(data[i][6]).trim();
    var isActive = (status === 'نشط' || status === 'active' || status === 'true');
    if (isActive && (role === 'مدير' || role === 'manager' || role === 'designer' || role === 'مصمم النظام')) {
      return true;
    }
  }
  return false;
}

/**
 * إنشاء أول مالك ومصمم للنظام بأمان
 * يتم استدعاؤها حصريًا من داخل محرر Apps Script وليس عبر المتصفح أو API!
 * 
 * خطوات الاستخدام:
 * 1. في محرر Apps Script: Project Settings -> Script Properties
 * 2. أضف:
 *    - DEVELOPER_USERNAME (أو DESIGNER_USERNAME): اسم المستخدم (مثلاً admin أو عبدالله)
 *    - DEVELOPER_PASSWORD (أو DESIGNER_PASSWORD): كلمة مرور قوية (8 خانات على الأقل مع حرف كبير وصغير ورقم ورمز)
 *    - DEVELOPER_NAME: اسم المالك (مثلاً المهندس عبدالله)
 *    - DEVELOPER_PHONE: رقم الهاتف للتواصل (اختياري)
 * 3. اختر دالة bootstrapFirstDesigner() واضغط Run.
 * 4. ستقوم الدالة بالتحقق من عدم وجود مالك سابق، وتشفير كلمة المرور،
 *    وإنشاء المالك، ثم مسح الخصائص المؤقتة من Script Properties تلقائيًا لمنع تكرارها.
 */
function bootstrapFirstDesigner() {
  var lockRes = withScriptLock(function() {
    setupSheets();

    // التحقق من عدم وجود مالك سابق
    if (hasAnyOwner()) {
      throw new Error('يوجد مالك/مصمم مسجل بالفعل للنظام، ولا يمكن تكرار إجراء التهيئة الأولية.');
    }

    var props = PropertiesService.getScriptProperties();
    var rawUsername = String(props.getProperty('DEVELOPER_USERNAME') || props.getProperty('DESIGNER_USERNAME') || props.getProperty('DESIGNER_PHONE') || '').trim();
    var name = String(props.getProperty('DEVELOPER_NAME') || props.getProperty('DESIGNER_NAME') || '').trim() || 'مصمم ومالك النظام';
    var password = String(props.getProperty('DEVELOPER_PASSWORD') || props.getProperty('DESIGNER_PASSWORD') || '').trim();
    var phone = String(props.getProperty('DEVELOPER_PHONE') || props.getProperty('DESIGNER_PHONE') || '').trim();

    if (!rawUsername) {
      throw new Error('اسم المستخدم غير محدد! يرجى إضافة DEVELOPER_USERNAME في Script Properties.');
    }

    if (!isValidUsernameFormat(rawUsername)) {
      throw new Error('اسم المستخدم غير صالح! يقبل الحروف العربية والإنجليزية والأرقام بين 2 و 40 خانة.');
    }

    // التحقق من قوة كلمة المرور لمطور ومالك النظام
    var pwdCheck = validatePasswordRules(password, 'designer');
    if (!pwdCheck.valid) {
      throw new Error(pwdCheck.error);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEETS.USERS);

    var salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    var hash = hashPassword(password, salt);
    var userId = generateUUID();
    var now = new Date().toISOString();

    var permissionsJson = JSON.stringify(ALL_PERMISSIONS);

    sheet.appendRow([
      userId,
      rawUsername,
      name,
      'designer',
      salt,
      hash,
      'نشط',
      now,
      permissionsJson,
      true, // isOwner
      phone
    ]);

    // مسح الخصائص المؤقتة فوراً بعد النجاح لضمان عدم بقاء كلمة المرور في الخصائص
    props.deleteProperty('DEVELOPER_USERNAME');
    props.deleteProperty('DEVELOPER_PASSWORD');
    props.deleteProperty('DEVELOPER_NAME');
    props.deleteProperty('DEVELOPER_PHONE');
    props.deleteProperty('DESIGNER_USERNAME');
    props.deleteProperty('DESIGNER_PHONE');
    props.deleteProperty('DESIGNER_NAME');
    props.deleteProperty('DESIGNER_PASSWORD');

    logAudit(
      { id: userId, name: name, role: 'designer' },
      'BOOTSTRAP_OWNER',
      'User',
      userId,
      'تم إنشاء مالك ومصمم النظام الأول باسم مستخدم (' + rawUsername + ') عبر محرر Apps Script بنجاح'
    );

    Logger.log('========================================================');
    Logger.log('✅ تم بنجاح إنشاء حساب مصمم ومالك النظام الأول!');
    Logger.log('اسم المستخدم: ' + rawUsername);
    Logger.log('الاسم: ' + name);
    Logger.log('الدور: designer (مالك النظام بكامل الصلاحيات)');
    Logger.log('تم حذف بيانات التهيئة المؤقتة من Script Properties بنجاح.');
    Logger.log('========================================================');

    return {
      success: true,
      message: 'تم إنشاء أول مالك ومصمم للنظام بنجاح، ومسح الخصائص المؤقتة',
      userId: userId
    };
  });
  if (lockRes && lockRes.code === 'BUSY') {
    throw new Error('النظام قيد التهيئة حالياً من قبل عملية أخرى.');
  }
  return lockRes;
}

// دالة رديفة بنفس الوظيفة لسهولة الاستدعاء
function bootstrapFirstDeveloper() {
  return bootstrapFirstDesigner();
}

/**
 * تسجيل الدخول باسم المستخدم وكلمة المرور مع الحماية من التخمين
 */
function verifyLogin(usernameInput, password, offlineVerifierData) {
  var rawInput = String(usernameInput || '').trim();
  var normUser = normalizeUsername(rawInput);

  if (!normUser || !password) {
    return { success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' };
  }

  // فحص الحظر المؤقت بعد 5 محاولات خاطئة
  var rateCheck = checkLoginRateLimit(normUser);
  if (rateCheck.locked) {
    return {
      success: false,
      error: 'تم قفل الحساب مؤقتاً لتكرار المحاولات الخاطئة. يرجى المحاولة بعد ' + rateCheck.remainingMinutes + ' دقيقة.'
    };
  }

  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEETS.USERS);

  if (!sheet || sheet.getLastRow() < 2) {
    ensureDefaultUsersIfEmptyGS(ss);
    sheet = ss.getSheetByName(SHEETS.USERS);
  }

  if (!sheet || sheet.getLastRow() < 2) {
    return { success: false, error: 'لا يوجد مستخدمون مسجلون بعد.' };
  }

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var storedUsername = String(row[1] || '').trim();
    var storedPhone = String(row[10] || '').trim();

    // مطابقة اسم المستخدم المطبع أو رقم الهاتف إن وُجد
    var matches = (normalizeUsername(storedUsername) === normUser) || (storedPhone && storedPhone === rawInput);

    if (matches) {
      var status = String(row[6]).trim();
      if (status !== 'نشط' && status !== 'active' && status !== 'true') {
        return { success: false, error: 'هذا الحساب موقوف، يرجى مراجعة مالك النظام' };
      }

      var salt = String(row[4]);
      var storedHash = String(row[5]);
      var computedHash = hashPassword(password, salt);

      if (computedHash === storedHash) {
        // نجاح تسجيل الدخول - مسح عداد المحاولات الفاشلة
        clearFailedLogins(normUser);

        var rawRole = String(row[3]).trim();
        var isOwner = row[9] === true || String(row[9] || '').toLowerCase() === 'true';
        var mustChangePassword = row[18] === true || String(row[18] || '').toLowerCase() === 'true';

        var role = 'employee';
        if (rawRole === 'designer' || isOwner) {
          role = 'designer';
        } else if (rawRole === 'manager' || rawRole === 'مدير') {
          role = 'manager';
        }

        // قراءة الصلاحيات
        var permissions = [];
        var rawPerms = String(row[8] || '').trim();
        if (rawPerms && rawPerms.startsWith('[')) {
          try {
            permissions = JSON.parse(rawPerms);
          } catch (_) {
            permissions = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.employee;
          }
        } else {
          permissions = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.employee;
        }

        // مصمم النظام يمتلك كل الصلاحيات دائمًا
        if (role === 'designer') {
          permissions = ALL_PERMISSIONS;
        }

        var userId = String(row[0]);
        var userName = String(row[2]);

        var cbConfig = null;
        var cbJson = String(row[11] || '').trim();
        if (cbJson && cbJson.indexOf('{') === 0) {
          try {
            cbConfig = JSON.parse(cbJson);
          } catch (_) {}
        }

        var whConfig = null;
        var whJson = String(row[17] || '').trim();
        if (whJson && whJson.indexOf('{') === 0) {
          try {
            whConfig = JSON.parse(whJson);
          } catch (_) {}
        }

        var storedOfflineVerifier = String(row[12] || '').trim();
        var storedOfflineSalt = String(row[13] || '').trim();
        var storedOfflineIterations = Number(row[14] || 0) || 200000;
        var storedPermsUpdatedAt = String(row[15] || row[7] || '').trim();
        var storedPermsUpdatedByDevice = String(row[16] || '').trim();

        if (offlineVerifierData && offlineVerifierData.offlineVerifier && offlineVerifierData.offlineSalt) {
          storedOfflineVerifier = String(offlineVerifierData.offlineVerifier).trim();
          storedOfflineSalt = String(offlineVerifierData.offlineSalt).trim();
          storedOfflineIterations = Number(offlineVerifierData.offlineIterations) || 200000;
          sheet.getRange(i + 1, 13, 1, 3).setValues([[
            storedOfflineVerifier,
            storedOfflineSalt,
            storedOfflineIterations
          ]]);
        }

        // إنشاء رمز جلسة آمن بطول 64 خانة
        var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
        var expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 ساعة
        var nowIso = new Date().toISOString();

        var sSessions = getOrCreateSheet(ss, SHEETS.SESSIONS);
        sSessions.appendRow([
          token,
          userId,
          storedUsername,
          role,
          JSON.stringify(permissions),
          nowIso,
          new Date(expiresAt).toISOString()
        ]);

        logAudit(
          { id: userId, name: userName, role: role },
          'USER_LOGIN',
          'Session',
          userId,
          'تم تسجيل الدخول بنجاح للمستخدم: ' + storedUsername
        );

        return {
          success: true,
          token: token,
          expiresAt: expiresAt,
          user: {
            id: userId,
            username: storedUsername,
            phone: storedPhone,
            name: userName,
            role: role,
            isOwner: role === 'designer' || isOwner,
            mustChangePassword: mustChangePassword,
            permissions: permissions,
            cashboxConfig: cbConfig,
            warehouseConfig: whConfig,
            offlineVerifier: storedOfflineVerifier,
            offlineSalt: storedOfflineSalt,
            offlineIterations: storedOfflineIterations,
            permissionsUpdatedAt: storedPermsUpdatedAt,
            permissionsUpdatedByDevice: storedPermsUpdatedByDevice
          }
        };
      } else {
        // كلمة مرور خاطئة - تسجيل المحاولة الفاشلة
        var failResult = recordFailedLogin(normUser);
        if (failResult.lockedNow) {
          return {
            success: false,
            error: 'تم تجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات). تم إيقاف الحساب مؤقتًا لمدة 15 دقيقة.'
          };
        }
        return {
          success: false,
          error: 'كلمة المرور غير صحيحة. متبقي ' + failResult.triesLeft + ' محاولات قبل الإيقاف المؤقت.'
        };
      }
    }
  }

  // اسم المستخدم غير موجود
  recordFailedLogin(normUser);
  return { success: false, error: 'اسم المستخدم غير مسجل بالنظام' };
  });
}

/**
 * التحقق من صلاحية الجلسة Token واستخراج بيانات المستخدم
 */
function getAuthenticatedSession(token) {
  if (!token) return null;
  var cleanToken = String(token).replace(/^Bearer\s+/i, '').trim();
  if (!cleanToken) return null;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sSessions = ss.getSheetByName(SHEETS.SESSIONS);
  if (!sSessions || sSessions.getLastRow() < 2) return null;

  var data = sSessions.getDataRange().getValues();
  var nowTime = Date.now();

  for (var i = data.length - 1; i >= 1; i--) {
    var row = data[i];
    if (String(row[0]).trim() === cleanToken) {
      var expDate = new Date(row[6]).getTime();
      if (isNaN(expDate) || nowTime > expDate) {
        return null; // منتهية الصلاحية
      }

      var userId = String(row[1]);
      var role = String(row[3] || 'employee');
      var perms = [];
      try {
        perms = JSON.parse(String(row[4] || '[]'));
      } catch (_) {
        perms = ROLE_TEMPLATES[role] || [];
      }

      if (role === 'designer') {
        perms = ALL_PERMISSIONS;
      }

      var mustChangePassword = false;
      var sUsers = ss.getSheetByName(SHEETS.USERS);
      if (sUsers && sUsers.getLastRow() >= 2) {
        var uData = sUsers.getDataRange().getValues();
        for (var u = 1; u < uData.length; u++) {
          if (String(uData[u][0]) === userId) {
            var uStatus = String(uData[u][6] || 'نشط').trim();
            if (uStatus === 'موقوف' || uStatus === 'inactive') {
              return null;
            }
            mustChangePassword = uData[u][18] === true || String(uData[u][18] || '').toLowerCase() === 'true';
            break;
          }
        }
      }

      return {
        token: cleanToken,
        userId: userId,
        phone: String(row[2]),
        role: role,
        isOwner: role === 'designer',
        mustChangePassword: mustChangePassword,
        permissions: perms
      };
    }
  }
  return null;
}

/**
 * فحص الصلاحية الإلزامية Centralized Permission Enforcement
 */
function requirePermission(session, requiredPermission) {
  if (!session) {
    throw new Error('يرجى تسجيل الدخول للمتابعة (جلسة غير صالحة أو منتهية)');
  }
  if (session.role === 'designer') {
    return true; // مصمم النظام يمتلك كل الصلاحيات
  }
  if (!session.permissions || session.permissions.indexOf(requiredPermission) === -1) {
    throw new Error('صلاحية مرفوضة: لا تملك صلاحية [' + requiredPermission + ']');
  }
  return true;
}

/**
 * التحقق الآمن من امتلاك الصلاحية دون رمي أي استثناء
 */
function hasPermission(session, permission) {
  try {
    if (!session) return false;
    if (session.role === 'designer' || session.isOwner === true || String(session.isOwner || '').toLowerCase() === 'true') {
      return true;
    }
    if (!permission || !Array.isArray(session.permissions)) {
      return false;
    }
    return session.permissions.indexOf(permission) !== -1;
  } catch (_) {
    return false;
  }
}

function sanitizeClientErrorMessageGS(error, fallbackMessage) {
  var fallback = fallbackMessage || 'حدث خطأ أثناء معالجة الطلب';
  if (!error) return fallback;
  var msg = typeof error === 'string' ? error : (error.message ? String(error.message) : '');
  msg = msg.trim();
  if (!msg) return fallback;
  // حجب أي تفاصيل داخلية أو مسارات ملفات أو تتبع مكدس (stack) أو أخطاء محرك البرمجة
  if (
    /\bat\s+[^\n]+\([^\n]+:\d+/i.test(msg) ||
    /\.(gs|ts|tsx|js|mjs|cjs)(:\d+|\b)/i.test(msg) ||
    /\/(app|src|server|node_modules|apps-script)\//i.test(msg) ||
    /^(ReferenceError|TypeError|SyntaxError|RangeError|URIError|EvalError|Exception):/i.test(msg)
  ) {
    return fallback;
  }
  return msg.split('\n')[0].trim() || fallback;
}

/**
 * معالج طلبات GET — مقتصر على فحص الاتصال (ping) فقط ويرفض أي إجراء آخر
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action).trim() : 'ping';

  try {
    // الإجراء الوحيد المسموح عبر GET هو ping فقط
    if (action === 'ping') {
      return createJsonResponse({
        success: true,
        message: 'اتصال Google Apps Script نشط وجاهز للخدمة',
        hasOwner: hasAnyOwner(),
        hasManager: hasAnyManager(),
        timestamp: new Date().toISOString()
      });
    }

    return createJsonResponse({
      success: false,
      error: 'غير مسموح بتنفيذ هذا الإجراء عبر GET. جميع الطلبات يجب أن ترسل عبر POST.'
    });
  } catch (error) {
    console.error('[AppsScript doGet Error]:', error && (error.stack || error.message || error));
    return createJsonResponse({
      success: false,
      error: sanitizeClientErrorMessageGS(error, 'حدث خطأ أثناء معالجة الطلب')
    });
  }
}

/**
 * معالج طلبات POST (جميع عمليات القراءة والكتابة والمصادقة؛ رمز الدخول في جسم الطلب فقط)
 */
function doPost(e) {
  var action = '';
  var session = null;
  try {
    var postData = {};
    if (e && e.postData && e.postData.contents) {
      postData = JSON.parse(e.postData.contents);
    }

    action = postData.action;
    var payload = postData.payload || {};
    var token = postData.token || postData.authToken || '';
    session = getAuthenticatedSession(token);
    var responseData;

    // 1. العمليات العامة غير المحمية برمز جلسة (Ping & CheckSetup & Login)
    if (action === 'ping') {
      return createJsonResponse({
        success: true,
        message: 'اتصال Google Apps Script نشط وجاهز للخدمة',
        hasOwner: hasAnyOwner(),
        hasManager: hasAnyManager(),
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'checkSetup') {
      return createJsonResponse({
        success: true,
        hasOwner: hasAnyOwner(),
        hasManager: hasAnyManager()
      });
    }

    if (action === 'login') {
      return createJsonResponse(verifyLogin(payload.username || payload.phone, payload.password, payload));
    }

    if (action === 'bootstrapFirstDesigner' || action === 'setupFirstAdmin') {
      return createJsonResponse({
        success: false,
        error: 'تهيئة مالك النظام الأول متاحة حصرياً عبر محرر Apps Script من خلال دالة bootstrapFirstDesigner().'
      });
    }

    if (action === 'getPublicContactSettings') {
      return createJsonResponse({
        success: true,
        contactSettings: getPublicContactSettingsGS()
      });
    }

    if (action === 'logout') {
      if (token) {
        invalidateSession(token);
      }
      return createJsonResponse({ success: true, message: 'تم إنهاء الجلسة بنجاح' });
    }

    // 2. العمليات المحمية برمز الجلسة والصلاحيات الصارمة
    if (!session) {
      return createJsonResponse({
        success: false,
        error: 'يرجى تسجيل الدخول أولاً، الجلسة غير موجودة أو منتهية الصلاحية',
        expired: true
      });
    }

    // فرض تغيير كلمة السر المؤقتة عند أول دخول في الخادم (Apps Script): يُرفض أي طلب آخر غير إعداد الحساب
    if (session.mustChangePassword && action !== 'completeInitialAccountSetup') {
      return createJsonResponse({
        success: false,
        code: 'MUST_CHANGE_PASSWORD',
        mustChangePassword: true,
        error: 'يرجى استكمال إعداد الحساب وتغيير كلمة السر المؤقتة أولاً قبل استخدام النظام'
      });
    }

    switch (action) {
      case 'completeInitialAccountSetup':
        responseData = completeInitialAccountSetupGS(payload, session);
        break;

      case 'changeOwnPassword':
        responseData = changeOwnPasswordGS(payload, session);
        break;

      case 'deleteUser':
        responseData = deleteUserGS(payload, session);
        break;

      case 'setupSheets':
        requirePermission(session, 'settings.system_integration');
        responseData = setupSheets();
        logAudit(session, 'SETUP_SHEETS', 'System', 'Sheets', 'تمت إعادة تهيئة جداول النظام');
        break;

      case 'syncAll':
      case 'getAllData':
        requirePermission(session, 'dashboard.view');
        responseData = getAllData(session);
        break;

      case 'getSettings':
        responseData = { success: true, data: getSettingsMap() };
        break;

      case 'getUsers':
        requirePermission(session, 'users.view');
        responseData = { success: true, data: getUsersData(session) };
        break;

      case 'getPlatforms':
        requirePermission(session, 'platforms.view');
        responseData = { success: true, data: getPlatformsData() };
        break;

      case 'getItemPlatformCosts':
        requirePermission(session, 'platforms.pricing');
        responseData = { success: true, data: getItemPlatformCostsData() };
        break;

      case 'getCategories':
        requirePermission(session, 'categories.view');
        responseData = { success: true, data: getCategoriesData() };
        break;

      case 'saveCategory':
        requirePermission(session, 'categories.manage');
        responseData = saveCategoryData(payload, session);
        break;

      case 'deleteCategory':
        requirePermission(session, 'categories.manage');
        responseData = deleteCategoryData(payload.id, session);
        break;

      case 'migrateItemCategories':
        requirePermission(session, 'categories.manage');
        responseData = migrateItemCategoriesData(session);
        break;

      case 'adjustItemStock':
        requirePermission(session, 'stock.adjust');
        responseData = adjustItemStockData(payload, session);
        break;

      case 'getItemMovementReport':
        requirePermission(session, 'reports.item_movement.view');
        responseData = getItemMovementReportData(payload, session);
        break;

      case 'getStockAdjustmentsReport':
        requirePermission(session, 'reports.stock_adjustments.view');
        responseData = getStockAdjustmentsReportData(payload, session);
        break;

      case 'getBnplReport':
        requirePermission(session, 'reports.bnpl_view');
        responseData = getBnplReportData(payload, session);
        break;

      case 'getPlatformReport':
        requirePermission(session, 'reports.platform_view');
        responseData = getPlatformReportData(payload, session);
        break;

      case 'saveItem':
        if (payload.id) {
          requirePermission(session, 'items.edit');
        } else {
          requirePermission(session, 'items.create');
        }
        responseData = saveItem(payload, session);
        break;

      case 'inlineUpdateItem':
        requirePermission(session, 'products.inline_edit');
        responseData = inlineUpdateItem(payload, session);
        break;

      case 'deleteItem':
        requirePermission(session, 'items.delete');
        responseData = deleteItem(payload.id, session);
        break;

      case 'archiveItem':
        requirePermission(session, 'items.edit');
        responseData = archiveItem(payload.id, session);
        break;

      case 'getItemLogs':
        requirePermission(session, 'items.view');
        responseData = getItemLogs(payload.itemId, session);
        break;

      case 'getItems':
        requirePermission(session, 'items.view');
        if (payload && (
          payload.page !== undefined ||
          payload.search !== undefined ||
          payload.barcodeOnly !== undefined ||
          payload.categoryId !== undefined ||
          payload.supplier !== undefined ||
          payload.stockStatus !== undefined ||
          payload.stockFilter !== undefined ||
          payload.status !== undefined ||
          payload.statusFilter !== undefined ||
          payload.platformId !== undefined ||
          payload.warehouseId !== undefined
        )) {
          responseData = getItemsFiltered(session, payload);
        } else {
          responseData = { success: true, data: getItemsFiltered(session) };
        }
        break;

      case 'getItemsPaginated':
        requirePermission(session, 'items.view');
        responseData = getItemsFiltered(session, payload || {});
        break;

      case 'importItemsBatch':
        requirePermission(session, 'items.import_export');
        responseData = importItemsBatch(payload, session);
        break;

      case 'previewDuplicateItems':
        if (session.role !== 'designer' && !session.isOwner) {
          throw new Error('غير مصرح: هذه العملية مخصصة لمطور/مصمم النظام (designer) فقط');
        }
        responseData = previewDuplicateItemsData(session);
        break;

      case 'cleanupDuplicateItems':
        if (session.role !== 'designer' && !session.isOwner) {
          throw new Error('غير مصرح: هذه العملية مخصصة لمطور/مصمم النظام (designer) فقط');
        }
        responseData = cleanupDuplicateItemsData(session);
        break;

      case 'bulkEditExcel':
        requirePermission(session, 'products.bulk_edit_excel');
        responseData = bulkEditItemsExcelGS(payload, session);
        break;

      case 'previewBulkEditExcel':
        requirePermission(session, 'products.bulk_edit_excel');
        responseData = bulkEditItemsExcelGS(Object.assign({}, payload || {}, { dryRun: true }), session);
        break;

      case 'executeBulkEditExcel':
        requirePermission(session, 'products.bulk_edit_excel');
        responseData = bulkEditItemsExcelGS(Object.assign({}, payload || {}, { dryRun: false }), session);
        break;

      case 'getBulkEditUndoStatus':
        requirePermission(session, 'products.bulk_edit_excel');
        responseData = getBulkEditUndoStatusGS(session);
        break;

      case 'undoLastBulkEditExcel':
        requirePermission(session, 'products.bulk_edit_excel');
        responseData = undoLastBulkEditExcelGS(session);
        break;

      case 'savePlatform':
        if (payload.id) {
          requirePermission(session, 'platforms.edit');
        } else {
          requirePermission(session, 'platforms.create');
        }
        responseData = savePlatform(payload, session);
        break;

      case 'saveItemPlatformCost':
        requirePermission(session, 'platforms.pricing');
        responseData = saveItemPlatformCost(payload, session);
        break;

      case 'createInvoice':
        requirePermission(session, 'invoices.create');
        responseData = createInvoice(payload, session);
        break;

      case 'syncOfflineOperation':
      case 'syncOfflineInvoice':
        requirePermission(session, 'invoices.create');
        responseData = syncOfflineOperation(payload, session);
        break;

      case 'markOfflineInvoiceReviewed':
        requirePermission(session, 'offline.manage');
        responseData = markOfflineInvoiceReviewedGS(payload, session);
        break;

      case 'editInvoice':
        requirePermission(session, 'invoices.edit_after_save');
        responseData = editInvoice(payload, session);
        break;

      case 'cancelInvoice':
        requirePermission(session, 'invoices.cancel');
        responseData = cancelInvoiceData(payload, session);
        break;

      case 'createReturn':
        requirePermission(session, 'returns.create');
        responseData = createReturn(payload, session);
        break;

      case 'getInvoices':
        requirePermission(session, 'invoices.view');
        responseData = { success: true, data: getInvoicesFiltered(session, payload) };
        break;

      case 'getReturns':
        requirePermission(session, 'returns.view');
        responseData = { success: true, data: getReturnsData(payload) };
        break;

      case 'getAuditLogs':
        requirePermission(session, 'audit.view');
        responseData = { success: true, data: getAuditLogsData(payload) };
        break;

      case 'saveUser':
        responseData = saveUser(payload, session);
        break;

      case 'updateUserPermissions':
        requirePermission(session, 'permissions.manage');
        responseData = updateUserPermissions(payload, session);
        break;

      case 'saveSettings':
        responseData = saveSettingsProtected(payload, session);
        break;

      case 'uploadImage':
        if (!session) {
          throw new Error('يرجى تسجيل الدخول للمتابعة (جلسة غير صالحة أو منتهية)');
        }
        if (session.role !== 'designer') {
          var hasUploadPerm = (session.permissions || []).some(function(p) {
            return p === 'items.edit' || p === 'settings.invoice_print' || p === 'settings.company_appearance';
          });
          if (!hasUploadPerm) {
            throw new Error('صلاحية مرفوضة: لا تملك صلاحية رفع الصور');
          }
        }
        responseData = uploadImageToDrive(payload);
        break;

      // 16. الموردين والمشتريات
      case 'getSuppliers':
        requirePermission(session, 'suppliers.view');
        responseData = { success: true, data: getSuppliersData() };
        break;

      case 'saveSupplier':
        if (payload.id) {
          requirePermission(session, 'suppliers.edit');
        } else {
          requirePermission(session, 'suppliers.create');
        }
        responseData = saveSupplierData(payload, session);
        break;

      case 'getSupplierGroups':
        requirePermission(session, 'suppliers.view');
        responseData = { success: true, data: getSupplierGroupsData() };
        break;

      case 'saveSupplierGroup':
        requirePermission(session, 'suppliers.edit');
        responseData = saveSupplierGroupData(payload, session);
        break;

      case 'getSupplierLedger':
        requirePermission(session, 'suppliers.view');
        responseData = getSupplierLedgerData(payload.supplierId, session, payload);
        break;

      case 'createSupplierVoucher':
        if (payload.type === 'سند صرف') {
          requirePermission(session, 'cashbox.payment');
        } else {
          requirePermission(session, 'cashbox.receipt');
        }
        responseData = createSupplierVoucherData(payload, session);
        break;

      case 'getPurchases':
        requirePermission(session, 'purchases.view');
        responseData = { success: true, data: getPurchasesData(session, payload) };
        break;

      case 'createPurchase':
        requirePermission(session, 'purchases.create');
        responseData = createPurchaseData(payload, session);
        break;

      case 'getPurchaseReturns':
        requirePermission(session, 'purchases.view');
        responseData = { success: true, data: getPurchaseReturnsData(payload) };
        break;

      case 'createPurchaseReturn':
        requirePermission(session, 'purchases.return');
        responseData = createPurchaseReturnData(payload, session);
        break;

      case 'cancelPurchase':
        requirePermission(session, 'purchases.create');
        responseData = cancelPurchaseData(payload, session);
        break;

      case 'getReconciliationReport':
        requirePermission(session, 'reports.view_reports');
        responseData = { success: true, data: getReconciliationReportData(payload) };
        break;

      case 'postReconciliationItem':
        requirePermission(session, 'reports.view_reports');
        responseData = postReconciliationItemData(payload, session);
        break;

      // 17. العملاء
      case 'getCustomers':
        requirePermission(session, 'customers.view');
        responseData = { success: true, data: getCustomersData() };
        break;

      case 'saveCustomer':
        if (payload.id) {
          requirePermission(session, 'customers.edit');
        } else {
          requirePermission(session, 'customers.create');
        }
        responseData = saveCustomerData(payload, session);
        break;

      case 'getCustomerGroups':
        requirePermission(session, 'customers.view');
        responseData = { success: true, data: getCustomerGroupsData() };
        break;

      case 'saveCustomerGroup':
        requirePermission(session, 'customers.edit');
        responseData = saveCustomerGroupData(payload, session);
        break;

      case 'getCustomerLedger':
        requirePermission(session, 'customers.view');
        responseData = getCustomerLedgerData(payload.customerId, session, payload);
        break;

      case 'createCustomerVoucher':
        if (payload.type === 'سند قبض') {
          requirePermission(session, 'cashbox.receipt');
        } else {
          requirePermission(session, 'cashbox.payment');
        }
        responseData = createCustomerVoucherData(payload, session);
        break;

      case 'getPartyLedger':
        if (session.role !== 'designer') {
          var hasPartyPerm = (session.permissions || []).some(function(p) {
            return p === 'invoices.collect_credit' || p === 'customers.view' || p === 'platforms.view';
          });
          if (!hasPartyPerm) {
            throw new Error('صلاحية مرفوضة: لا تملك صلاحية عرض سجل الطرف');
          }
        }
        responseData = getPartyLedgerData(payload, session);
        break;

      case 'collectCreditInvoices':
        requirePermission(session, 'invoices.collect_credit');
        responseData = collectCreditInvoicesData(payload, session);
        break;

      // 18. الخزائن والتحويلات المالية
      case 'getDashboardCashboxes':
        requirePermission(session, 'dashboard.view_cashboxes');
        responseData = { success: true, data: getDashboardCashboxesData(session) };
        break;

      case 'getCashboxes':
        requirePermission(session, 'cashbox.view');
        responseData = { success: true, data: getCashboxesData() };
        break;

      case 'saveCashbox':
        requirePermission(session, 'cashbox.create');
        responseData = saveCashboxData(payload, session);
        break;

      case 'getCashboxTransactions':
        requirePermission(session, 'cashbox.view');
        responseData = getCashboxTransactionsData(payload.cashboxId, payload, session);
        break;

      case 'createCashboxTransfer':
        requirePermission(session, 'cashbox.transfer');
        responseData = createCashboxTransferData(payload, session);
        break;

      case 'getUserCashboxAssignments':
        requirePermission(session, 'permissions.view');
        responseData = { success: true, data: getUserCashboxAssignmentsData() };
        break;

      case 'saveUserCashboxAssignment':
        requirePermission(session, 'permissions.manage');
        responseData = saveUserCashboxAssignmentData(payload, session);
        break;

      case 'getImportBatches':
        requirePermission(session, 'items.import_export');
        responseData = { success: true, data: getImportBatchesData() };
        break;

      // 19. المخازن المتعددة وأوامر الصرف والتحويلات
      case 'getWarehouseMigrationStatus':
        requirePermission(session, 'warehouses.view');
        responseData = { success: true, report: getWarehouseMigrationStatusGS() };
        break;

      case 'migrateWarehouseStocks':
        requirePermission(session, 'warehouses.manage');
        responseData = { success: true, report: migrateItemStocksToMainWarehouseOnceGS() };
        break;

      case 'getWarehouses':
        if (!session) throw new Error('يرجى تسجيل الدخول للمتابعة (جلسة غير صالحة أو منتهية)');
        responseData = {
          success: true,
          data: getWarehousesDataGS(session),
          migration: getWarehouseMigrationStatusGS()
        };
        break;

      case 'saveWarehouse':
        requirePermission(session, 'warehouses.manage');
        responseData = saveWarehouseDataGS(payload, session);
        break;

      case 'deleteWarehouse':
        requirePermission(session, 'warehouses.manage');
        responseData = deleteWarehouseDataGS((payload && (payload.warehouseId || payload.id)) || '', session);
        break;

      case 'getItemWarehouses':
        requirePermission(session, 'items.view');
        responseData = getItemWarehousesDataGS((payload && (payload.itemId || payload.id)) || '', session);
        break;

      case 'getUserWarehouses':
        if (session.role !== 'designer' && !session.isOwner) {
          var canViewUserWh = hasPermission(session, 'users.view') || hasPermission(session, 'permissions.view');
          if (!canViewUserWh) throw new Error('صلاحية مرفوضة: تفتقر لصلاحية عرض مخازن المستخدمين');
        }
        responseData = getUserWarehousesDataGS((payload && (payload.userId || payload.id)) || '');
        break;

      case 'saveUserWarehouses':
        if (session.role !== 'designer' && !session.isOwner) {
          var canEditUserWh = hasPermission(session, 'users.edit') || hasPermission(session, 'permissions.manage') || hasPermission(session, 'warehouses.manage');
          if (!canEditUserWh) throw new Error('صلاحية مرفوضة: تفتقر لصلاحية تخصيص المخازن للمستخدمين');
        }
        responseData = saveUserWarehousesDataGS((payload && (payload.userId || payload.id)) || '', payload || {}, session);
        break;

      case 'getWarehouseTransferContext':
        if (session.role !== 'designer' && !session.isOwner) {
          var canCtxWh = hasPermission(session, 'warehouses.view') || hasPermission(session, 'warehouses.transfer');
          if (!canCtxWh) throw new Error('صلاحية مرفوضة: تفتقر لصلاحية التحويلات بين المخازن');
        }
        responseData = getWarehouseTransferContextGS(session);
        break;

      case 'getWarehouseTransferStocks':
        if (session.role !== 'designer' && !session.isOwner) {
          var canStkWh = hasPermission(session, 'warehouses.view') || hasPermission(session, 'warehouses.transfer');
          if (!canStkWh) throw new Error('صلاحية مرفوضة: تفتقر لصلاحية التحويلات بين المخازن');
        }
        responseData = getWarehouseTransferStocksGS(payload || {}, session);
        break;

      case 'createWarehouseTransfer':
        requirePermission(session, 'warehouses.transfer');
        responseData = createWarehouseTransferGS(payload || {}, session);
        break;

      case 'getWarehouseTransfers':
        if (session.role !== 'designer' && !session.isOwner) {
          var canListTr = hasPermission(session, 'warehouses.view') || hasPermission(session, 'warehouses.transfer');
          if (!canListTr) throw new Error('صلاحية مرفوضة: تفتقر لصلاحية عرض أوامر الصرف');
        }
        responseData = getWarehouseTransfersGS(payload || {}, session);
        break;

      case 'getWarehouseTransferById':
        if (session.role !== 'designer' && !session.isOwner) {
          var canOneTr = hasPermission(session, 'warehouses.view') || hasPermission(session, 'warehouses.transfer');
          if (!canOneTr) throw new Error('صلاحية مرفوضة: تفتقر لصلاحية عرض تفاصيل أمر الصرف');
        }
        responseData = getWarehouseTransferByIdGS((payload && (payload.id || payload.dispatchNumber)) || '', session);
        break;

      default:
        responseData = { success: false, error: 'إجراء POST غير معروف: ' + action };
    }

    return createJsonResponse(responseData);
  } catch (error) {
    var errName = error && error.name ? String(error.name) : '';
    var errMsg = typeof error === 'string'
      ? error
      : (error && error.message ? String(error.message) : String(error || ''));
    var errStack = error && error.stack ? String(error.stack) : '';
    var isRuntimeError =
      /^(ReferenceError|TypeError|SyntaxError|RangeError|URIError|EvalError)$/i.test(errName) ||
      /^(ReferenceError|TypeError|SyntaxError|RangeError|URIError|EvalError):/i.test(errMsg.trim());
    var hasArabic = /[\u0600-\u06FF]/.test(errMsg);
    var hasInternalLeak =
      /\bat\s+[^\n]+\([^\n]+:\d+/i.test(errMsg) ||
      /\.(gs|ts|tsx|js|mjs|cjs)(:\d+|\b)/i.test(errMsg) ||
      /\/(app|src|server|node_modules|apps-script)\//i.test(errMsg);

    if (isRuntimeError || !hasArabic || hasInternalLeak) {
      var unexpectedFallback = 'حدث خطأ غير متوقع في الخادم. برجاء المحاولة أو التواصل مع الدعم';
      var detailMsg =
        '[' + (errName || 'Error') + '] ' + (errMsg || 'Unknown error') +
        (action ? ' | action=' + String(action) : '') +
        (errStack ? ' | stack=' + errStack.split('\n').slice(0, 4).join(' <- ') : '');
      if (typeof Logger !== 'undefined' && Logger && typeof Logger.log === 'function') {
        Logger.log('[AppsScript doPost Unexpected Error] ' + detailMsg);
      }
      console.error('[AppsScript doPost Unexpected Error]:', errStack || errMsg || error);
      try {
        logAudit(
          session,
          'SERVER_UNEXPECTED_ERROR',
          'System',
          String(action || 'doPost'),
          detailMsg
        );
      } catch (_) {}
      return createJsonResponse({
        success: false,
        error: unexpectedFallback
      });
    }

    console.error('[AppsScript doPost Error]:', errStack || errMsg || error);
    return createJsonResponse({
      success: false,
      error: sanitizeClientErrorMessageGS(error, 'حدث خطأ غير متوقع في الخادم. برجاء المحاولة أو التواصل مع الدعم')
    });
  }
}

/**
 * إلغاء جلسة
 */
function invalidateSession(token) {
  if (!token) return;
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sSessions = ss.getSheetByName(SHEETS.SESSIONS);
    if (!sSessions) return;

    var data = sSessions.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(token).trim()) {
        sSessions.deleteRow(i + 1);
        break;
      }
    }
  });
}

/**
 * دالة مساعدة لقراءة قيمة عمود بأمان
 */
function colVal(row, idx, fallback) {
  if (idx === -1 || !row || idx >= row.length || row[idx] === undefined || row[idx] === null) {
    return fallback !== undefined ? fallback : '';
  }
  return row[idx];
}

/**
 * قراءة الأصناف مع حجب أسعار الشراء وتكلفة التغليف لمن لا يمتلك الصلاحية
 * وقراءة الحقول حسب أسماء الأعمدة لتفادي الاعتماد على المؤشرات الثابتة.
 * - عند الاستدعاء بدون معامل ثانٍ: getItemsFiltered(session) ترجع مصفوفة الأصناف النشطة (للتوافق مع POS والتقارير).
 * - عند تمرير params: getItemsFiltered(session, params) ترجع صفحة واحدة (pageSize ثابت 30) مع البحث والفلترة وإجماليات كل النتائج المفلترة.
 */
function getItemsFiltered(session, params) {
  var isPaginatedMode = params !== undefined && params !== null;
  var ITEMS_PAGE_SIZE = 30;
  var emptyPaginated = {
    success: true,
    items: [],
    page: isPaginatedMode ? Math.max(1, Math.floor(Number(params.page) || 1)) : 1,
    pageSize: ITEMS_PAGE_SIZE,
    total: 0,
    totalPages: 0,
    totals: {
      itemsCount: 0,
      totalPieces: 0,
      totalSaleValue: 0
    }
  };

  var canViewPurchase = session ? (session.role === 'designer' || Boolean(session.isOwner) || (session.permissions && session.permissions.indexOf('prices.view_purchase') !== -1)) : false;
  var canViewPackaging = session ? (session.role === 'designer' || Boolean(session.isOwner) || (session.permissions && session.permissions.indexOf('prices.view_packaging') !== -1)) : false;
  if (isPaginatedMode && canViewPurchase) {
    emptyPaginated.totals.totalPurchaseValue = 0;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  migrateItemStocksToMainWarehouseOnceGS();

  // التحقق من فلتر المخزن المحدد (إن وُجد) ومطابقة صلاحيات المستخدم وحالة المخزن
  var filterWarehouseId = '';
  if (isPaginatedMode && params && params.warehouseId !== undefined && params.warehouseId !== null) {
    var rawWhFilter = String(params.warehouseId).trim();
    if (rawWhFilter && rawWhFilter.toUpperCase() !== 'ALL') {
      var whResFilter = resolveWarehouseForOperationGS(ss, rawWhFilter, session, {
        requireActive: false,
        enforceUserAccess: true
      });
      if (!whResFilter.ok) {
        return {
          success: false,
          statusCode: whResFilter.statusCode || 400,
          error: whResFilter.error,
          items: [],
          page: emptyPaginated.page,
          pageSize: ITEMS_PAGE_SIZE,
          total: 0,
          totalPages: 0,
          totals: emptyPaginated.totals
        };
      }
      filterWarehouseId = whResFilter.warehouse.id;
    }
  }

  var sheet = ss.getSheetByName(SHEETS.ITEMS);
  if (!sheet || sheet.getLastRow() < 2) {
    return isPaginatedMode ? emptyPaginated : [];
  }

  // خريطة أرصدة المخازن لحساب إجمالي الصنف أو رصيده في المخزن المحدد
  var whTotalsByItem = {};
  var whSelectedStockByItem = {};
  var whSelectedReorderByItem = {};
  var sWhStocks = ss.getSheetByName(SHEETS.WAREHOUSE_STOCKS);
  var hasWhStocksRows = false;
  if (sWhStocks && sWhStocks.getLastRow() > 1) {
    var wsData = sWhStocks.getDataRange().getValues();
    for (var wsIdx = 1; wsIdx < wsData.length; wsIdx++) {
      var wsItemId = String(wsData[wsIdx][0] || '').trim();
      var wsWhId = String(wsData[wsIdx][1] || '').trim();
      var wsQty = Number(wsData[wsIdx][2]) || 0;
      var wsRawRl = wsData[wsIdx].length > 4 ? wsData[wsIdx][4] : '';
      if (!wsItemId || !wsWhId) continue;
      hasWhStocksRows = true;
      whTotalsByItem[wsItemId] = Math.round(((whTotalsByItem[wsItemId] || 0) + wsQty) * 1000) / 1000;
      if (filterWarehouseId && wsWhId === filterWarehouseId) {
        whSelectedStockByItem[wsItemId] = Math.round(wsQty * 1000) / 1000;
        if (wsRawRl !== '' && wsRawRl !== null && wsRawRl !== undefined && !isNaN(Number(wsRawRl))) {
          whSelectedReorderByItem[wsItemId] = Math.max(0, Math.round(Number(wsRawRl) * 100) / 100);
        }
      }
    }
  }

  // خريطة التصنيفات لتعبئة categoryName في وضع الصفحات
  var catMap = {};
  if (isPaginatedMode) {
    var catSheet = ss.getSheetByName(SHEETS.PRODUCT_CATEGORIES);
    if (catSheet && catSheet.getLastRow() > 1) {
      var cData = catSheet.getDataRange().getValues();
      var ch = getHeaderMap(catSheet);
      var cIdIdx = ch.get('ID', 0);
      var cNameIdx = ch.get('اسم التصنيف', 1);
      for (var c = 1; c < cData.length; c++) {
        var cid = String(colVal(cData[c], cIdIdx, '')).trim();
        if (cid) catMap[cid] = String(colVal(cData[c], cNameIdx, '')).trim();
      }
    }
  }

  // قراءة الباركودات الفرعية من ورقة ItemBarcodes إن وُجدت
  var secondaryBarcodesMap = {};
  var sBarcodes = ss.getSheetByName(SHEETS.ITEM_BARCODES);
  if (sBarcodes && sBarcodes.getLastRow() > 1) {
    var bData = sBarcodes.getDataRange().getValues();
    for (var b = 1; b < bData.length; b++) {
      var bItemId = String(bData[b][1]);
      var bCode = String(bData[b][2] || '').trim();
      var bActive = bData[b][5] !== false && String(bData[b][5]).toLowerCase() !== 'false';
      if (bCode && bActive) {
        if (!secondaryBarcodesMap[bItemId]) {
          secondaryBarcodesMap[bItemId] = [];
        }
        secondaryBarcodesMap[bItemId].push(bCode);
      }
    }
  }

  var h = getHeaderMap(sheet);
  var colId = h.get('ID', 0);
  var colName = h.get('اسم الصنف', 1);
  var colImg = h.get('رابط الصورة', 2);
  var colSale = h.get('سعر البيع', 3);
  var colPurchase = h.get('سعر الشراء', 4);
  var colPackaging = h.get('تكلفة التغليف', 5);
  var colStock = h.get('الكمية بالمخزن', 6);
  var colNotes = h.get('ملاحظات', 7);
  var colCreated = h.get('تاريخ الإضافة', 8);
  var colStatus = h.get('حالة الصنف', 9);
  var colBarcode = h.get('الباركود الأساسي', 10);
  var colSupplier = h.get('المورد', 11);
  if (colSupplier === -1) colSupplier = h.get('المورد الافتراضي', -1);
  var colTax = h.get('نسبة الضريبة', 12);
  var colMinPrice = h.get('الحد الأدنى لسعر البيع', 13);
  var colSku = h.get('كود SKU', -1);
  var colReorder = h.get('حد إعادة الطلب', -1);
  var colCategory = h.get('ID التصنيف', -1);
  if (colCategory === -1) colCategory = h.get('معرف التصنيف', -1);
  if (colCategory === -1) colCategory = h.get('categoryId', -1);
  var colBnplEnable = h.get('تفعيل BNPL', -1);
  var colBnplPercent = h.get('نسبة BNPL', -1);
  var colPlatformIds = h.get('معرفات المنصات المتاحة', -1);
  var colPickupFee = h.get('رسوم الالتقاط للقطعة', -1);
  var colUnit = h.get('وحدة القياس', -1);
  var colUpdatedAt = h.get('تاريخ آخر تعديل', -1);
  var colPurchaseDate = h.get('تاريخ الشراء', -1);
  var colExpiryDate = h.get('تاريخ انتهاء الصلاحية', -1);
  var colPrintName = h.get('اسم الطباعة', -1);

  var data = sheet.getDataRange().getValues();
  var items = [];

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var status = String(colVal(r, colStatus, 'نشط')).trim();
    if (!isPaginatedMode && (status === 'inactive' || status === 'موقوف' || status === 'مؤرشف')) continue;

    var itemId = String(colVal(r, colId, ''));
    if (!itemId) continue;

    var categoryId = colCategory !== -1 ? String(colVal(r, colCategory, '')).trim() : '';

    var platformIdsRaw = colPlatformIds !== -1 ? String(colVal(r, colPlatformIds, '')).trim() : '';
    var platformIds = [];
    if (platformIdsRaw) {
      try {
        if (platformIdsRaw.charAt(0) === '[') {
          platformIds = JSON.parse(platformIdsRaw);
        } else {
          platformIds = platformIdsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        }
      } catch (e) {
        platformIds = platformIdsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      }
    }

    var rawItemPickupFee = colPickupFee !== -1 ? colVal(r, colPickupFee, '') : '';
    var itemPickupFee = (rawItemPickupFee !== '' && rawItemPickupFee !== null && rawItemPickupFee !== undefined && Number(rawItemPickupFee) > 0)
      ? Number(rawItemPickupFee)
      : undefined;

    var rawReorder = colReorder !== -1 ? colVal(r, colReorder, '') : '';
    var hasExplicitReorder = colReorder !== -1 && rawReorder !== '' && rawReorder !== null && rawReorder !== undefined;
    var baseReorderLimit = hasExplicitReorder ? (Number(rawReorder) || 0) : (isPaginatedMode ? undefined : 0);
    var effectiveReorderLimit = (filterWarehouseId && whSelectedReorderByItem[itemId] !== undefined)
      ? whSelectedReorderByItem[itemId]
      : baseReorderLimit;
    var unitVal = colUnit !== -1 ? String(colVal(r, colUnit, '')).trim() : '';
    var createdStr = String(colVal(r, colCreated, ''));
    var updatedStr = colUpdatedAt !== -1 ? String(colVal(r, colUpdatedAt, '')).trim() : '';
    var purchaseDateStr = colPurchaseDate !== -1 ? String(colVal(r, colPurchaseDate, '')).trim() : '';
    var expiryDateStr = colExpiryDate !== -1 ? String(colVal(r, colExpiryDate, '')).trim() : '';
    var printNameVal = colPrintName !== -1 ? String(colVal(r, colPrintName, '')).trim().slice(0, 120) : '';

    var computedTotalStock = hasWhStocksRows
      ? (whTotalsByItem[itemId] !== undefined ? whTotalsByItem[itemId] : 0)
      : (Number(colVal(r, colStock, 0)) || 0);
    var effectiveStockQty = filterWarehouseId
      ? (whSelectedStockByItem[itemId] !== undefined ? whSelectedStockByItem[itemId] : 0)
      : computedTotalStock;

    var item = {
      id: itemId,
      name: String(colVal(r, colName, '')),
      printName: printNameVal,
      categoryId: categoryId || undefined,
      imageUrl: String(colVal(r, colImg, '')),
      salePrice: Number(colVal(r, colSale, 0)) || 0,
      stockQuantity: effectiveStockQty,
      notes: String(colVal(r, colNotes, '')),
      createdAt: createdStr,
      updatedAt: updatedStr || createdStr,
      purchaseDate: purchaseDateStr || undefined,
      expiryDate: expiryDateStr || undefined,
      status: status,
      barcode: String(colVal(r, colBarcode, '')).trim(),
      supplier: String(colVal(r, colSupplier, '')).trim(),
      unit: unitVal || undefined,
      taxRate: Number(colVal(r, colTax, 0)) || 0,
      minPrice: Number(colVal(r, colMinPrice, 0)) || 0,
      sku: String(colVal(r, colSku, '')).trim(),
      reorderLimit: effectiveReorderLimit,
      enableBnpl: colBnplEnable !== -1 ? (r[colBnplEnable] === true || String(r[colBnplEnable]).toLowerCase() === 'true' || String(r[colBnplEnable]).trim() === 'نعم') : false,
      bnplPercentage: colBnplPercent !== -1 ? (Number(colVal(r, colBnplPercent, 0)) || 0) : 0,
      pickupFee: itemPickupFee,
      platformIds: platformIds,
      secondaryBarcodes: secondaryBarcodesMap[itemId] || []
    };

    if (filterWarehouseId) {
      item.warehouseStockQuantity = effectiveStockQty;
    }

    if (isPaginatedMode) {
      item.categoryName = categoryId ? (catMap[categoryId] || '') : '';
    }

    // حجب أسعار الشراء والتغليف تماماً عن غير المخوّل
    if (canViewPurchase) {
      item.purchasePrice = Number(colVal(r, colPurchase, 0)) || 0;
    }
    if (canViewPackaging) {
      item.packagingCost = Number(colVal(r, colPackaging, 0)) || 0;
    }

    items.push(item);
  }

  if (!isPaginatedMode) {
    return items;
  }

  // ===== وضع ترقيم الصفحات والفلترة والبحث وإجماليات كل النتائج المفلترة =====
  var page = Math.max(1, Math.floor(Number(params.page) || 1));
  var barcodeOnly =
    params.barcodeOnly === true ||
    String(params.barcodeOnly || '').toLowerCase() === 'true' ||
    String(params.barcodeOnly || '') === '1';

  var rawSearch = String(params.search || '').trim();
  var normSearchName = normalizeItemName(rawSearch);
  var normSearchBc = normalizeItemBarcode(rawSearch).toLowerCase();
  var categoryIdFilter = String(params.categoryId || '').trim();
  var supplierFilter = String(params.supplier || '').trim();
  var stockStatusFilter = String(params.stockStatus || params.stockFilter || 'ALL').trim().toUpperCase();
  var statusFilter = String(params.status || params.statusFilter || 'ALL').trim().toUpperCase();
  var platformIdFilter = String(params.platformId || 'ALL').trim();

  var filtered = [];
  for (var f = 0; f < items.length; f++) {
    var it = items[f];

    // 1. فلتر الحالة
    if (statusFilter && statusFilter !== 'ALL') {
      var st = String(it.status || '').trim();
      if (statusFilter === 'ACTIVE' && st !== 'active' && st !== 'نشط') continue;
      if (statusFilter === 'INACTIVE' && st !== 'inactive' && st !== 'موقوف') continue;
      if (statusFilter === 'ARCHIVED' && st !== 'مؤرشف') continue;
    }

    // 2. فلتر التصنيف
    if (categoryIdFilter && categoryIdFilter !== 'ALL') {
      if (categoryIdFilter === 'UNCATEGORIZED') {
        if (it.categoryId && String(it.categoryId).trim() !== '') continue;
      } else if (String(it.categoryId || '').trim() !== categoryIdFilter) {
        continue;
      }
    }

    // 3. فلتر المورد
    if (supplierFilter && supplierFilter !== 'ALL') {
      if (supplierFilter === 'NONE') {
        if (it.supplier && String(it.supplier).trim() !== '') continue;
      } else if (normalizeItemName(it.supplier) !== normalizeItemName(supplierFilter)) {
        continue;
      }
    }

    // 4. فلتر المخزون
    if (stockStatusFilter && stockStatusFilter !== 'ALL') {
      var qty = Number(it.stockQuantity || 0);
      var reorderLimit = it.reorderLimit !== undefined ? Number(it.reorderLimit) : 5;
      if (stockStatusFilter === 'AVAILABLE' && !(qty > reorderLimit)) continue;
      if (stockStatusFilter === 'LOW' && !(qty > 0 && qty <= reorderLimit)) continue;
      if (stockStatusFilter === 'OUT' && !(qty <= 0)) continue;
    }

    // 5. فلتر المنصة
    if (platformIdFilter && platformIdFilter !== 'ALL') {
      if (platformIdFilter === 'UNRESTRICTED') {
        if (it.platformIds && it.platformIds.length > 0) continue;
      } else if (it.platformIds && it.platformIds.length > 0 && it.platformIds.indexOf(platformIdFilter) === -1) {
        continue;
      }
    }

    // 6. البحث بالاسم أو الكود أو الباركود
    if (rawSearch.length > 0) {
      var itemBarcodes = [];
      if (it.barcode) {
        var nb = normalizeItemBarcode(it.barcode).toLowerCase();
        if (nb) itemBarcodes.push(nb);
      }
      if (it.secondaryBarcodes && it.secondaryBarcodes.length > 0) {
        for (var sbIdx = 0; sbIdx < it.secondaryBarcodes.length; sbIdx++) {
          var nsb = normalizeItemBarcode(it.secondaryBarcodes[sbIdx]).toLowerCase();
          if (nsb) itemBarcodes.push(nsb);
        }
      }

      if (barcodeOnly) {
        if (!normSearchBc) continue;
        var exactBcMatch = false;
        for (var k = 0; k < itemBarcodes.length; k++) {
          if (itemBarcodes[k] === normSearchBc) {
            exactBcMatch = true;
            break;
          }
        }
        if (!exactBcMatch) continue;
      } else {
        var matchesName = Boolean(normSearchName && normalizeItemName(it.name).indexOf(normSearchName) !== -1);
        var matchesPrintName = Boolean(normSearchName && it.printName && normalizeItemName(it.printName).indexOf(normSearchName) !== -1);
        var matchesSkuBc = Boolean(normSearchBc && it.sku && normalizeItemBarcode(it.sku).toLowerCase().indexOf(normSearchBc) !== -1);
        var matchesSkuText = Boolean(normSearchName && it.sku && normalizeItemName(it.sku).indexOf(normSearchName) !== -1);
        var matchesBc = false;
        if (normSearchBc) {
          for (var k2 = 0; k2 < itemBarcodes.length; k2++) {
            if (itemBarcodes[k2].indexOf(normSearchBc) !== -1) {
              matchesBc = true;
              break;
            }
          }
        }
        if (!matchesName && !matchesPrintName && !matchesSkuBc && !matchesSkuText && !matchesBc) {
          continue;
        }
      }
    }

    filtered.push(it);
  }

  // حساب إجماليات كل النتائج المفلترة (وليس الصفحة الحالية فقط)
  var totalPieces = 0;
  var totalSaleValueRaw = 0;
  var totalPurchaseValueRaw = 0;

  for (var t = 0; t < filtered.length; t++) {
    var fItem = filtered[t];
    var fQty = Number(fItem.stockQuantity || 0);
    var fSale = Number(fItem.salePrice || 0);
    var fPurchase = Number(fItem.purchasePrice || 0);
    totalPieces += fQty;
    totalSaleValueRaw += fQty * fSale;
    if (canViewPurchase) {
      totalPurchaseValueRaw += fQty * fPurchase;
    }
  }

  // ===== ترتيب النتائج على كامل الأصناف المطابقة قبل قص الصفحة (30 صنف) =====
  var rawSortBy = String(params.sortBy || '').trim();
  var rawSortDir = String(params.sortDir || '').trim().toLowerCase();
  var sortAliases = {
    name: 'name',
    printName: 'printName',
    barcode: 'barcode',
    notes: 'notes',
    description: 'notes',
    stockQuantity: 'stockQuantity',
    quantity: 'stockQuantity',
    unit: 'unit',
    salePrice: 'salePrice',
    price: 'salePrice',
    purchasePrice: 'purchasePrice',
    categoryName: 'categoryName',
    category: 'categoryName',
    supplier: 'supplier',
    purchaseDate: 'purchaseDate',
    expiryDate: 'expiryDate'
  };
  var resolvedSortBy = rawSortBy && sortAliases.hasOwnProperty(rawSortBy) ? sortAliases[rawSortBy] : '';
  var effectiveSortBy = (resolvedSortBy && !(resolvedSortBy === 'purchasePrice' && !canViewPurchase))
    ? resolvedSortBy
    : '';
  var effectiveSortDir = (rawSortDir === 'asc' || rawSortDir === 'desc') ? rawSortDir : '';

  if (effectiveSortBy && effectiveSortDir) {
    var dirMul = effectiveSortDir === 'desc' ? -1 : 1;

    var getSortMetaGs = function(it) {
      switch (effectiveSortBy) {
        case 'name': {
          var sName = String(it.name || '').trim();
          return { empty: !sName, type: 'text', val: sName };
        }
        case 'printName': {
          var sPrint = String(it.printName || '').trim();
          return { empty: !sPrint || sPrint === '—', type: 'text', val: sPrint };
        }
        case 'barcode': {
          var sBc = String(it.barcode || '').trim();
          return { empty: !sBc || sBc === '—', type: 'text', val: sBc };
        }
        case 'notes': {
          var sNotes = String(it.notes || '').trim();
          return { empty: !sNotes || sNotes === '—', type: 'text', val: sNotes };
        }
        case 'unit': {
          var sUnit = String(it.unit || '').trim();
          return { empty: !sUnit || sUnit === '—', type: 'text', val: sUnit };
        }
        case 'categoryName': {
          var sCat = String(it.categoryName || '').trim();
          var emptyCat = !sCat || sCat === '—' || sCat === 'بدون تصنيف';
          return { empty: emptyCat, type: 'text', val: emptyCat ? '' : sCat };
        }
        case 'supplier': {
          var sSup = String(it.supplier || '').trim();
          return { empty: !sSup || sSup === '—', type: 'text', val: sSup };
        }
        case 'stockQuantity': {
          if (it.stockQuantity === undefined || it.stockQuantity === null || String(it.stockQuantity).trim() === '') {
            return { empty: true, type: 'num', val: 0 };
          }
          var nQty = Number(it.stockQuantity);
          if (isNaN(nQty)) return { empty: true, type: 'num', val: 0 };
          return { empty: false, type: 'num', val: nQty };
        }
        case 'salePrice': {
          if (it.salePrice === undefined || it.salePrice === null || String(it.salePrice).trim() === '') {
            return { empty: true, type: 'num', val: 0 };
          }
          var nSale = Number(it.salePrice);
          if (isNaN(nSale)) return { empty: true, type: 'num', val: 0 };
          return { empty: false, type: 'num', val: nSale };
        }
        case 'purchasePrice': {
          if (it.purchasePrice === undefined || it.purchasePrice === null || String(it.purchasePrice).trim() === '') {
            return { empty: true, type: 'num', val: 0 };
          }
          var nPur = Number(it.purchasePrice);
          if (isNaN(nPur)) return { empty: true, type: 'num', val: 0 };
          return { empty: false, type: 'num', val: nPur };
        }
        case 'purchaseDate':
        case 'expiryDate': {
          var rawD = effectiveSortBy === 'purchaseDate' ? it.purchaseDate : it.expiryDate;
          var sDate = String(rawD || '').trim();
          if (!sDate || sDate === '—') {
            return { empty: true, type: 'date', val: 0 };
          }
          var ts = Date.parse(sDate);
          if (isNaN(ts)) {
            return { empty: true, type: 'date', val: 0 };
          }
          return { empty: false, type: 'date', val: ts };
        }
        default:
          return { empty: true, type: 'text', val: '' };
      }
    };

    filtered.sort(function(a, b) {
      var ma = getSortMetaGs(a);
      var mb = getSortMetaGs(b);
      // القيم الفارغة في الآخر دائماً في الاتجاهين
      if (ma.empty && mb.empty) return 0;
      if (ma.empty) return 1;
      if (mb.empty) return -1;

      var cmp = 0;
      if (ma.type === 'num' || ma.type === 'date') {
        cmp = Number(ma.val) - Number(mb.val);
      } else {
        cmp = String(ma.val).toLowerCase().localeCompare(String(mb.val).toLowerCase(), 'ar', {
          sensitivity: 'base'
        });
      }
      return cmp * dirMul;
    });
  }

  var total = filtered.length;
  var totalPages = total === 0 ? 0 : Math.ceil(total / ITEMS_PAGE_SIZE);
  var startIdx = (page - 1) * ITEMS_PAGE_SIZE;
  var pagedItems = filtered.slice(startIdx, startIdx + ITEMS_PAGE_SIZE);

  var totals = {
    itemsCount: total,
    totalPieces: totalPieces,
    totalSaleValue: Math.round(totalSaleValueRaw * 100) / 100
  };
  if (canViewPurchase) {
    totals.totalPurchaseValue = Math.round(totalPurchaseValueRaw * 100) / 100;
  }

  return {
    success: true,
    items: pagedItems,
    page: page,
    pageSize: ITEMS_PAGE_SIZE,
    total: total,
    totalPages: totalPages,
    totals: totals
  };
}

/**
 * دالة توحيد اسم الصنف لمنع التكرار (متطابقة تماماً مع server/sheetsService.ts):
 * - إزالة التشكيل والمدّة
 * - توحيد الألف (أ/إ/آ/ٱ -> ا)، التاء المربوطة (ة -> ه)، الألف المقصورة (ى -> ي)
 * - تجاهل حالة الحروف الإنجليزية (lowercase)
 * - إزالة المسافات من الأطراف ودمج المسافات المكررة
 */
function normalizeItemName(rawName) {
  if (!rawName) return '';
  return String(rawName)
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * دالة توحيد الباركود أو الكود (متطابقة تماماً مع server/sheetsService.ts):
 * - تحويل الأرقام العربية (٠-٩) والفارسية (۰-۹) إلى أرقام إنجليزية (0-9)
 * - إزالة جميع المسافات
 */
function normalizeItemBarcode(rawBarcode) {
  if (!rawBarcode) return '';
  return String(rawBarcode)
    .replace(/[\u0660-\u0669]/g, function(d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function(d) { return String(d.charCodeAt(0) - 0x06F0); })
    .replace(/\s+/g, '');
}

/**
 * حذف صفوف محددة من الأسفل للأعلى على دفعات متصلة لتفادي إزاحة أرقام الصفوف وتسريع التنفيذ
 */
function deleteRowsDescendingBatch(sheet, rowNumbers) {
  if (!sheet || !rowNumbers || rowNumbers.length === 0) return;
  return withScriptLock(function() {
    var uniqueMap = {};
    var sorted = [];
    for (var i = 0; i < rowNumbers.length; i++) {
      var rn = Number(rowNumbers[i]);
      if (rn >= 2 && !uniqueMap[rn]) {
        uniqueMap[rn] = true;
        sorted.push(rn);
      }
    }
    if (sorted.length === 0) return;
    sorted.sort(function(a, b) { return b - a; });

    var idx = 0;
    while (idx < sorted.length) {
      var blockEnd = sorted[idx];
      var blockStart = blockEnd;
      while (idx + 1 < sorted.length && sorted[idx + 1] === blockStart - 1) {
        idx++;
        blockStart = sorted[idx];
      }
      var count = blockEnd - blockStart + 1;
      if (count === 1) {
        sheet.deleteRow(blockStart);
      } else {
        sheet.deleteRows(blockStart, count);
      }
      idx++;
    }
  });
}

/**
 * حفظ أو تعديل صنف مع التحقق الموحد من عدم التكرار وقراءة الأعمدة مرة واحدة مع LockService
 * ومع التوثيق التلقائي في سجل التعديل ItemChangeLog
 */
function saveItem(item, session) {
  // التحقق من القيم الرقمية (منع القيم السالبة):
  if (Number(item.salePrice || 0) < 0) {
    return { success: false, error: 'سعر البيع لا يمكن أن يكون سالباً' };
  }
  if (item.purchasePrice !== undefined && Number(item.purchasePrice) < 0) {
    return { success: false, error: 'سعر الشراء لا يمكن أن يكون سالباً' };
  }
  if (item.packagingCost !== undefined && Number(item.packagingCost) < 0) {
    return { success: false, error: 'تكلفة التغليف لا يمكن أن تكون سالبة' };
  }
  if (item.taxRate !== undefined && (Number(item.taxRate) < 0 || Number(item.taxRate) > 100)) {
    return { success: false, error: 'نسبة الضريبة يجب أن تكون بين 0% و 100%' };
  }
  if (item.stockQuantity !== undefined && Number(item.stockQuantity) < 0) {
    return { success: false, error: 'الكمية بالمخزن لا يمكن أن تكون سالبة' };
  }

  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var sheet = ss.getSheetByName(SHEETS.ITEMS);
    if (!sheet) {
      setupSheets();
      sheet = ss.getSheetByName(SHEETS.ITEMS);
    }

    ensureSheetWithHeaders(ss, SHEETS.ITEMS, [
      'ID', 'اسم الصنف', 'رابط الصورة', 'سعر البيع', 'سعر الشراء', 'تكلفة التغليف',
      'الكمية بالمخزن', 'ملاحظات', 'تاريخ الإضافة', 'حالة الصنف', 'الباركود الأساسي',
      'المورد', 'نسبة الضريبة', 'الحد الأدنى لسعر البيع', 'كود SKU', 'حد إعادة الطلب', 'المورد الافتراضي',
      'ID التصنيف', 'تفعيل BNPL', 'نسبة BNPL', 'معرفات المنصات المتاحة', 'رسوم الالتقاط للقطعة',
      'وحدة القياس', 'تاريخ آخر تعديل', 'تاريخ الشراء', 'تاريخ انتهاء الصلاحية', 'اسم الطباعة'
    ]);

    var h = getHeaderMap(sheet);
    var colId = h.get('ID', 0);
    var colName = h.get('اسم الصنف', 1);
    var colBarcode = h.get('الباركود الأساسي', 10);
    var colSku = h.get('كود SKU', -1);
    var colPrintName = h.get('اسم الطباعة', -1);

    // قراءة جدول الأصناف وجدول الباركودات مرة واحدة (getValues)
    var data = sheet.getDataRange().getValues();
    var id = item.id || generateUUID();
    var now = new Date().toISOString();

    var existingRow = -1;
    var oldRowData = null;

    for (var i = 1; i < data.length; i++) {
      var rowId = colVal(data[i], colId);
      if (String(rowId) === String(id)) {
        existingRow = i + 1;
        oldRowData = data[i];
        break;
      }
    }

    var candidateName = item.name !== undefined ? String(item.name) : (oldRowData ? String(colVal(oldRowData, colName, '')) : '');
    var cleanName = String(candidateName || '').trim().replace(/\s+/g, ' ');
    var normName = normalizeItemName(cleanName);
    if (!normName) {
      return { success: false, error: 'اسم الصنف مطلوب' };
    }

    var rawPrimaryBarcode = item.barcode !== undefined
      ? String(item.barcode || '')
      : (oldRowData ? String(colVal(oldRowData, colBarcode, '')) : '');
    var rawSecondaryList = item.secondaryBarcodes !== undefined
      ? (item.secondaryBarcodes || [])
      : [];
    var rawSku = item.sku !== undefined
      ? String(item.sku || '')
      : (item.code !== undefined
          ? String(item.code || '')
          : (oldRowData && colSku !== -1 ? String(colVal(oldRowData, colSku, '')) : ''));

    var barcode = normalizeItemBarcode(rawPrimaryBarcode);
    var sku = normalizeItemBarcode(rawSku);

    // فحص تكرار الباركودات داخل نفس الصنف وتجهيز قائمة موحدة
    var candidateBarcodes = [];
    var seenSelfBc = {};
    if (barcode) {
      seenSelfBc[barcode.toLowerCase()] = true;
      candidateBarcodes.push(barcode);
    }
    for (var sbIdx = 0; sbIdx < rawSecondaryList.length; sbIdx++) {
      var normSb = normalizeItemBarcode(String(rawSecondaryList[sbIdx] || ''));
      if (!normSb) continue;
      var normSbKey = normSb.toLowerCase();
      if (seenSelfBc[normSbKey]) {
        return { success: false, error: 'الباركود [' + normSb + '] مكرر أكثر من مرة داخل نفس الصنف' };
      }
      seenSelfBc[normSbKey] = true;
      candidateBarcodes.push(normSb);
    }

    var formatOtherInfo = function(otherRow) {
      var oName = String(colVal(otherRow, colName, '')).trim();
      var oSku = colSku !== -1 ? String(colVal(otherRow, colSku, '')).trim() : '';
      var oBc = String(colVal(otherRow, colBarcode, '')).trim();
      var oId = String(colVal(otherRow, colId, '')).trim();
      var parts = [];
      if (oSku) parts.push(oSku);
      if (oBc && oBc !== oSku) parts.push(oBc);
      if (parts.length === 0 && oId) parts.push(oId);
      return '"' + oName + '" (الكود: ' + parts.join(' / ') + ')';
    };

    var itemRowById = {};
    // فحص التكرار على عمودَي الاسم والباركود (والكود) من المصفوفة المقروءة دفعة واحدة
    for (var r = 1; r < data.length; r++) {
      var rRow = data[r];
      var otherId = String(colVal(rRow, colId, '')).trim();
      if (otherId) itemRowById[otherId] = rRow;
      if (otherId && String(otherId) === String(id)) continue;

      var otherName = String(colVal(rRow, colName, ''));
      if (normalizeItemName(otherName) === normName) {
        return {
          success: false,
          error: 'اسم الصنف "' + cleanName + '" مكرر مع صنف آخر: ' + formatOtherInfo(rRow)
        };
      }

      if (sku) {
        var skuKey = sku.toLowerCase();
        var otherSkuNorm = colSku !== -1 ? normalizeItemBarcode(colVal(rRow, colSku, '')).toLowerCase() : '';
        var otherIdNorm = normalizeItemBarcode(otherId).toLowerCase();
        if ((otherSkuNorm && otherSkuNorm === skuKey) || (otherIdNorm && otherIdNorm === skuKey)) {
          return {
            success: false,
            error: 'كود الصنف [' + sku + '] مسجل بالفعل لصنف آخر: ' + formatOtherInfo(rRow)
          };
        }
      }

      var otherBcNorm = normalizeItemBarcode(colVal(rRow, colBarcode, '')).toLowerCase();
      if (otherBcNorm) {
        for (var cb = 0; cb < candidateBarcodes.length; cb++) {
          if (candidateBarcodes[cb].toLowerCase() === otherBcNorm) {
            return {
              success: false,
              error: 'الباركود [' + candidateBarcodes[cb] + '] مسجل بالفعل لصنف آخر: ' + formatOtherInfo(rRow)
            };
          }
        }
      }
    }

    // قراءة جدول الباركودات مرة واحدة لفحص الباركودات الفرعية أيضاً
    var sBarcodes = getOrCreateSheet(ss, SHEETS.ITEM_BARCODES);
    var bRows = (sBarcodes && sBarcodes.getLastRow() > 1) ? sBarcodes.getDataRange().getValues() : [];
    if (bRows.length > 1 && candidateBarcodes.length > 0) {
      for (var br = 1; br < bRows.length; br++) {
        var bItemId = String(bRows[br][1] || '').trim();
        if (!bItemId || bItemId === String(id)) continue;
        var bActive = bRows[br][5] !== false && String(bRows[br][5]).toLowerCase() !== 'false';
        if (!bActive) continue;
        var bNorm = normalizeItemBarcode(bRows[br][2]).toLowerCase();
        if (!bNorm) continue;
        for (var cb2 = 0; cb2 < candidateBarcodes.length; cb2++) {
          if (candidateBarcodes[cb2].toLowerCase() === bNorm) {
            var cRow = itemRowById[bItemId];
            var conflictDesc = cRow ? formatOtherInfo(cRow) : ('"صنف معرف: ' + bItemId + '"');
            return {
              success: false,
              error: 'الباركود [' + candidateBarcodes[cb2] + '] مسجل بالفعل لصنف آخر: ' + conflictDesc
            };
          }
        }
      }
    }

    var oldPurchasePrice = oldRowData ? (Number(colVal(oldRowData, h.get('سعر الشراء', 4))) || 0) : 0;
    var oldPackagingCost = oldRowData ? (Number(colVal(oldRowData, h.get('تكلفة التغليف', 5))) || 0) : 0;

    var canViewPurchase = session.role === 'designer' || (session.permissions && session.permissions.indexOf('prices.view_purchase') !== -1);
    var purchasePrice = canViewPurchase ? (item.purchasePrice !== undefined ? Number(item.purchasePrice) : oldPurchasePrice) : oldPurchasePrice;
    var packagingCost = canViewPurchase ? (item.packagingCost !== undefined ? Number(item.packagingCost) : oldPackagingCost) : oldPackagingCost;

    var supplier = String(item.supplier || '').trim();
    var taxRate = Math.max(0, Number(item.taxRate || 0));
    var minPrice = Math.max(0, Number(item.minPrice || 0));
    var reorderLimit = item.reorderLimit !== undefined ? Number(item.reorderLimit) : 0;
    var categoryId = item.categoryId ? String(item.categoryId).trim() : '';

    var rowData = existingRow > 0 ? oldRowData.slice() : new Array(h.headers.length).fill('');
    while (rowData.length < h.headers.length) rowData.push('');

    function setVal(name, val, fallbackIdx) {
      var idx = h.get(name, fallbackIdx);
      if (idx !== -1 && idx < rowData.length) {
        rowData[idx] = val;
      }
    }

    setVal('ID', id, 0);
    setVal('اسم الصنف', cleanName, 1);
    setVal('رابط الصورة', item.imageUrl || '', 2);
    setVal('سعر البيع', Number(item.salePrice || 0), 3);
    setVal('سعر الشراء', purchasePrice, 4);
    setVal('تكلفة التغليف', packagingCost, 5);
    setVal('الكمية بالمخزن', Number(item.stockQuantity || 0), 6);
    setVal('ملاحظات', item.notes || '', 7);
    setVal('تاريخ الإضافة', item.createdAt || (oldRowData ? colVal(oldRowData, h.get('تاريخ الإضافة', 8)) : '') || now, 8);
    setVal('حالة الصنف', item.status || (oldRowData ? colVal(oldRowData, h.get('حالة الصنف', 9)) : '') || 'نشط', 9);
    setVal('الباركود الأساسي', barcode, 10);
    setVal('المورد', supplier, 11);
    if (h.get('المورد الافتراضي') !== -1) setVal('المورد الافتراضي', supplier);
    setVal('نسبة الضريبة', taxRate, 12);
    setVal('الحد الأدنى لسعر البيع', minPrice, 13);
    if (h.get('كود SKU') !== -1) setVal('كود SKU', sku);
    if (h.get('حد إعادة الطلب') !== -1) setVal('حد إعادة الطلب', reorderLimit);
    if (h.get('ID التصنيف') !== -1) setVal('ID التصنيف', categoryId);
    else if (h.get('معرف التصنيف') !== -1) setVal('معرف التصنيف', categoryId);
    else if (h.get('categoryId') !== -1) setVal('categoryId', categoryId);
    setVal('تفعيل BNPL', item.enableBnpl === true ? 'نعم' : 'لا');
    setVal('نسبة BNPL', Number(item.bnplPercentage || 0));
    var pIds = Array.isArray(item.platformIds) ? item.platformIds.filter(Boolean) : [];
    setVal('معرفات المنصات المتاحة', pIds.length > 0 ? JSON.stringify(pIds) : '');
    var itemPickupFeeVal = (item.pickupFee !== undefined && item.pickupFee !== null && item.pickupFee !== '' && Number(item.pickupFee) > 0)
      ? Number(item.pickupFee)
      : '';
    setVal('رسوم الالتقاط للقطعة', itemPickupFeeVal);
    if (h.get('وحدة القياس') !== -1) setVal('وحدة القياس', item.unit !== undefined ? String(item.unit || '').trim() : (oldRowData ? colVal(oldRowData, h.get('وحدة القياس', -1), '') : ''));
    if (h.get('تاريخ آخر تعديل') !== -1) setVal('تاريخ آخر تعديل', now);
    if (h.get('تاريخ الشراء') !== -1) setVal('تاريخ الشراء', item.purchaseDate !== undefined ? String(item.purchaseDate || '') : (oldRowData ? colVal(oldRowData, h.get('تاريخ الشراء', -1), '') : ''));
    if (h.get('تاريخ انتهاء الصلاحية') !== -1) setVal('تاريخ انتهاء الصلاحية', item.expiryDate !== undefined ? String(item.expiryDate || '') : (oldRowData ? colVal(oldRowData, h.get('تاريخ انتهاء الصلاحية', -1), '') : ''));
    var oldPrintName = (oldRowData && colPrintName !== -1) ? String(colVal(oldRowData, colPrintName, '')).trim() : '';
    var cleanPrintName = item.printName !== undefined
      ? String(item.printName || '').trim().replace(/\s+/g, ' ').slice(0, 120)
      : oldPrintName;
    if (colPrintName !== -1) setVal('اسم الطباعة', cleanPrintName);
    item.name = cleanName;
    item.printName = cleanPrintName;
    item.barcode = barcode;
    item.sku = sku;
    item.platformIds = pIds;
    item.updatedAt = now;

    var userName = (session && (session.name || session.phone)) || 'المستخدم';
    var hasExplicitWhOnSave = item.warehouseId !== undefined && item.warehouseId !== null && String(item.warehouseId).trim() !== '';
    var targetWhResOnSave = resolveWarehouseForOperationGS(
      ss,
      hasExplicitWhOnSave ? item.warehouseId : null,
      session,
      hasExplicitWhOnSave ? { requireActive: true, enforceUserAccess: true } : { requireActive: false, enforceUserAccess: false }
    );
    if (!targetWhResOnSave.ok) {
      return { success: false, statusCode: targetWhResOnSave.statusCode || 400, error: targetWhResOnSave.error };
    }
    var targetWhOnSave = targetWhResOnSave.warehouse;

    if (existingRow > 0) {
      var oldTotalStock = Number(colVal(oldRowData, h.get('الكمية بالمخزن', 6))) || 0;
      var oldWhStock = getItemWarehouseStockGS(ss, id, targetWhOnSave.id);
      var newWhStock = oldWhStock;
      var whDiff = 0;

      if (item.stockQuantity !== undefined && item.stockQuantity !== null && item.stockQuantity !== '') {
        var requestedQty = Math.max(0, Number(item.stockQuantity) || 0);
        if (hasExplicitWhOnSave) {
          whDiff = Math.round((requestedQty - oldWhStock) * 1000) / 1000;
          if (whDiff !== 0) {
            setItemWarehouseBalanceGS(ss, id, targetWhOnSave.id, requestedQty, now);
            newWhStock = requestedQty;
          }
        } else {
          var totalDiff = Math.round((requestedQty - oldTotalStock) * 1000) / 1000;
          if (totalDiff !== 0) {
            newWhStock = Math.max(0, Math.round((oldWhStock + totalDiff) * 1000) / 1000);
            whDiff = Math.round((newWhStock - oldWhStock) * 1000) / 1000;
            setItemWarehouseBalanceGS(ss, id, targetWhOnSave.id, newWhStock, now);
          }
        }
      }

      var recomputedTotal = recomputeItemTotalStockGS(ss, id, null);
      setVal('الكمية بالمخزن', recomputedTotal, 6);
      item.stockQuantity = recomputedTotal;
      sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);

      // توثيق التغييرات في ItemChangeLog
      var sChangeLog = getOrCreateSheet(ss, SHEETS.ITEM_CHANGE_LOG);
      if (sChangeLog && oldRowData) {
        var oldSalePrice = Number(colVal(oldRowData, h.get('سعر البيع', 3))) || 0;
        var newSalePrice = Number(item.salePrice || 0);
        var editReason = item.editReason || 'تعديل بيانات الصنف';

        if (oldSalePrice !== newSalePrice) {
          sChangeLog.appendRow([generateUUID(), id, cleanName, 'سعر البيع', oldSalePrice, newSalePrice, userName, now, editReason]);
        }
        if (oldPurchasePrice !== purchasePrice) {
          sChangeLog.appendRow([generateUUID(), id, cleanName, 'سعر الشراء', oldPurchasePrice, purchasePrice, userName, now, editReason]);
        }
        if (oldPrintName !== cleanPrintName) {
          sChangeLog.appendRow([generateUUID(), id, cleanName, 'اسم الطباعة', oldPrintName || 'فارغ', cleanPrintName || 'فارغ', userName, now, editReason]);
        }
        if (whDiff !== 0) {
          sChangeLog.appendRow([generateUUID(), id, cleanName, 'الكمية بالمخزن', oldWhStock, newWhStock, userName, now, editReason]);
          var sMovements = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
            'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
            'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
          ]);
          if (sMovements) {
            sMovements.appendRow(buildRowWithWarehouseGS(sMovements, [
              generateUUID(),
              id,
              cleanName,
              'تسوية جرد',
              Math.abs(whDiff),
              newWhStock,
              editReason,
              'ADJ-' + now.slice(0, 10),
              userName,
              now,
              'تسوية كمية مخزون يدوية (' + (whDiff > 0 ? '+' + whDiff : whDiff) + ')'
            ], targetWhOnSave.id));
          }
        }
      }
    } else {
      var initialQty = Math.max(0, Number(item.stockQuantity || 0));
      setItemWarehouseBalanceGS(ss, id, targetWhOnSave.id, initialQty, now);
      var totalNewStock = recomputeItemTotalStockGS(ss, id, null);
      setVal('الكمية بالمخزن', totalNewStock, 6);
      item.stockQuantity = totalNewStock;
      sheet.appendRow(rowData);
      if (initialQty > 0) {
        var sMovementsNew = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
          'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
          'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
        ]);
        if (sMovementsNew) {
          sMovementsNew.appendRow(buildRowWithWarehouseGS(sMovementsNew, [
            generateUUID(),
            id,
            cleanName,
            'استيراد رصيد افتتاحي',
            initialQty,
            initialQty,
            'رصيد افتتاحي',
            'INIT-' + now.slice(0, 10),
            userName,
            now,
            'رصيد افتتاحي عند إنشاء الصنف'
          ], targetWhOnSave.id));
        }
      }
    }

    // مزامنة ورقة الباركودات ItemBarcodes (حذف الصفوف القديمة دفعة واحدة من الأسفل للأعلى)
    if (sBarcodes) {
      if (bRows.length > 1) {
        var toDeleteBarcodeRows = [];
        for (var bDel = 1; bDel < bRows.length; bDel++) {
          if (String(bRows[bDel][1]) === String(id)) {
            toDeleteBarcodeRows.push(bDel + 1);
          }
        }
        deleteRowsDescendingBatch(sBarcodes, toDeleteBarcodeRows);
      }
      var cleanSec = [];
      if (barcode) {
        sBarcodes.appendRow([generateUUID(), id, barcode, 'primary', 'الباركود الأساسي', true, now]);
      }
      for (var s = 0; s < rawSecondaryList.length; s++) {
        var sc = normalizeItemBarcode(String(rawSecondaryList[s] || ''));
        if (sc && sc.toLowerCase() !== barcode.toLowerCase()) {
          cleanSec.push(sc);
          sBarcodes.appendRow([generateUUID(), id, sc, 'secondary', 'باركود فرعي ' + cleanSec.length, true, now]);
        }
      }
      item.secondaryBarcodes = cleanSec;
    }

    logAudit(session, existingRow > 0 ? 'ITEM_EDIT' : 'ITEM_CREATE', 'Item', id, 'حفظ صنف: ' + cleanName);

    return { success: true, id: id, item: item };
  });
}

/**
 * تعديل مباشر لحقول محددة من الصنف داخل جدول الأصناف في Google Sheets
 * يطبق نفس قواعد بطاقة الصنف + منع الكتابة فوق تعديل آخر + تسجيل التدقيق بالقديم والجديد
 */
function inlineUpdateItem(payload, session) {
  var id = String((payload && payload.id) || '').trim();
  if (!id) {
    return { success: false, statusCode: 400, error: 'معرف الصنف مطلوب' };
  }

  var isPrivileged = Boolean(session && (session.role === 'designer' || session.isOwner));
  var hasInlinePerm = isPrivileged || Boolean(session && session.permissions && session.permissions.indexOf('products.inline_edit') !== -1);
  if (!hasInlinePerm) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية التعديل المباشر من جدول الأصناف [products.inline_edit]'
    };
  }

  var canViewPurchase = isPrivileged || Boolean(session && session.permissions && session.permissions.indexOf('prices.view_purchase') !== -1);
  var canViewPackaging = isPrivileged || Boolean(session && session.permissions && session.permissions.indexOf('prices.view_packaging') !== -1);
  var canOverrideMinPrice = isPrivileged || Boolean(session && session.permissions && session.permissions.indexOf('prices.override_min_price') !== -1);

  if (payload.purchasePrice !== undefined && !canViewPurchase) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح لك بعرض أو تعديل سعر الشراء'
    };
  }

  if (payload.salePrice !== undefined) {
    var numSaleCheck = Number(payload.salePrice);
    if (isNaN(numSaleCheck) || numSaleCheck < 0) {
      return { success: false, statusCode: 400, error: 'سعر البيع لا يمكن أن يكون سالباً' };
    }
  }
  if (payload.purchasePrice !== undefined) {
    var numPurchaseCheck = Number(payload.purchasePrice);
    if (isNaN(numPurchaseCheck) || numPurchaseCheck < 0) {
      return { success: false, statusCode: 400, error: 'سعر الشراء لا يمكن أن يكون سالباً' };
    }
  }
  if (payload.name !== undefined && !normalizeItemName(String(payload.name))) {
    return { success: false, statusCode: 400, error: 'اسم الصنف مطلوب' };
  }

  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEETS.ITEMS);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: false, statusCode: 404, error: 'الصنف غير موجود' };
    }

    ensureSheetWithHeaders(ss, SHEETS.ITEMS, [
      'ID', 'اسم الصنف', 'رابط الصورة', 'سعر البيع', 'سعر الشراء', 'تكلفة التغليف',
      'الكمية بالمخزن', 'ملاحظات', 'تاريخ الإضافة', 'حالة الصنف', 'الباركود الأساسي',
      'المورد', 'نسبة الضريبة', 'الحد الأدنى لسعر البيع', 'كود SKU', 'حد إعادة الطلب', 'المورد الافتراضي',
      'ID التصنيف', 'تفعيل BNPL', 'نسبة BNPL', 'معرفات المنصات المتاحة', 'رسوم الالتقاط للقطعة',
      'وحدة القياس', 'تاريخ آخر تعديل', 'تاريخ الشراء', 'تاريخ انتهاء الصلاحية', 'اسم الطباعة'
    ]);

    var h = getHeaderMap(sheet);
    var colId = h.get('ID', 0);
    var colName = h.get('اسم الصنف', 1);
    var colSale = h.get('سعر البيع', 3);
    var colPurchase = h.get('سعر الشراء', 4);
    var colNotes = h.get('ملاحظات', 7);
    var colCreated = h.get('تاريخ الإضافة', 8);
    var colBarcode = h.get('الباركود الأساسي', 10);
    var colMinPrice = h.get('الحد الأدنى لسعر البيع', 13);
    var colSku = h.get('كود SKU', -1);
    var colCategory = h.get('ID التصنيف', -1);
    if (colCategory === -1) colCategory = h.get('معرف التصنيف', -1);
    if (colCategory === -1) colCategory = h.get('categoryId', -1);
    var colUnit = h.get('وحدة القياس', -1);
    var colUpdatedAt = h.get('تاريخ آخر تعديل', -1);
    var colPrintName = h.get('اسم الطباعة', -1);

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;
    var oldRowData = null;

    for (var i = 1; i < data.length; i++) {
      if (String(colVal(data[i], colId, '')) === id) {
        existingRow = i + 1;
        oldRowData = data[i];
        break;
      }
    }

    if (existingRow < 0 || !oldRowData) {
      return { success: false, statusCode: 404, error: 'الصنف غير موجود' };
    }

    var currentUpdatedAt = colUpdatedAt !== -1 ? String(colVal(oldRowData, colUpdatedAt, '')).trim() : '';
    var currentCreatedAt = String(colVal(oldRowData, colCreated, '')).trim();
    var currentLastUpdated = currentUpdatedAt || currentCreatedAt;

    if (
      payload.lastUpdated !== undefined &&
      currentLastUpdated &&
      String(payload.lastUpdated).trim() !== currentLastUpdated
    ) {
      return {
        success: false,
        statusCode: 409,
        code: 'CONFLICT',
        error: 'الصنف عُدّل من مستخدم آخر، حدّث الصفحة'
      };
    }

    var oldName = String(colVal(oldRowData, colName, ''));
    var oldPrintName = colPrintName !== -1 ? String(colVal(oldRowData, colPrintName, '')).trim() : '';
    var oldNotes = String(colVal(oldRowData, colNotes, ''));
    var oldSalePrice = Number(colVal(oldRowData, colSale, 0)) || 0;
    var oldPurchasePrice = Number(colVal(oldRowData, colPurchase, 0)) || 0;
    var oldBarcode = String(colVal(oldRowData, colBarcode, '')).trim();
    var oldCategoryId = colCategory !== -1 ? String(colVal(oldRowData, colCategory, '')).trim() : '';
    var oldUnit = colUnit !== -1 ? String(colVal(oldRowData, colUnit, '')).trim() : '';
    var minPriceVal = Number(colVal(oldRowData, colMinPrice, 0)) || 0;

    var nextSalePrice = payload.salePrice !== undefined ? (Math.round(Number(payload.salePrice) * 100) / 100) : oldSalePrice;
    if (payload.salePrice !== undefined && minPriceVal > 0 && nextSalePrice < minPriceVal && !canOverrideMinPrice) {
      return {
        success: false,
        statusCode: 403,
        error: 'سعر البيع (' + nextSalePrice + ') أقل من الحد الأدنى المسموح به للصنف (' + minPriceVal + ') ولا تملك صلاحية التجاوز'
      };
    }

    var nextName = payload.name !== undefined ? String(payload.name).trim().replace(/\s+/g, ' ') : oldName;
    var normNextName = normalizeItemName(nextName);
    if (!normNextName) {
      return { success: false, statusCode: 400, error: 'اسم الصنف مطلوب' };
    }

    var nextBarcode = payload.barcode !== undefined ? normalizeItemBarcode(String(payload.barcode || '')) : oldBarcode;

    // فحص عدم تكرار الاسم أو الباركود
    for (var r = 1; r < data.length; r++) {
      var rRow = data[r];
      var otherId = String(colVal(rRow, colId, '')).trim();
      if (!otherId || otherId === id) continue;

      var otherName = String(colVal(rRow, colName, ''));
      if (normalizeItemName(otherName) === normNextName) {
        return {
          success: false,
          statusCode: 400,
          error: 'اسم الصنف "' + nextName + '" مكرر مع صنف آخر: "' + otherName.trim() + '"'
        };
      }

      if (nextBarcode) {
        var otherBc = normalizeItemBarcode(colVal(rRow, colBarcode, '')).toLowerCase();
        if (otherBc && otherBc === nextBarcode.toLowerCase()) {
          return {
            success: false,
            statusCode: 400,
            error: 'الباركود [' + nextBarcode + '] مسجل بالفعل لصنف آخر: "' + otherName.trim() + '"'
          };
        }
      }
    }

    var sBarcodes = getOrCreateSheet(ss, SHEETS.ITEM_BARCODES);
    var bRows = (sBarcodes && sBarcodes.getLastRow() > 1) ? sBarcodes.getDataRange().getValues() : [];
    if (nextBarcode && bRows.length > 1) {
      for (var br = 1; br < bRows.length; br++) {
        var bItemId = String(bRows[br][1] || '').trim();
        if (!bItemId || bItemId === id) continue;
        var bActive = bRows[br][5] !== false && String(bRows[br][5]).toLowerCase() !== 'false';
        if (!bActive) continue;
        var bNorm = normalizeItemBarcode(bRows[br][2]).toLowerCase();
        if (bNorm && bNorm === nextBarcode.toLowerCase()) {
          return {
            success: false,
            statusCode: 400,
            error: 'الباركود [' + nextBarcode + '] مسجل بالفعل لصنف آخر'
          };
        }
      }
    }

    var nextPrintName = payload.printName !== undefined
      ? String(payload.printName || '').trim().replace(/\s+/g, ' ').slice(0, 120)
      : oldPrintName;
    var nextNotes = payload.notes !== undefined ? String(payload.notes) : oldNotes;
    var nextPurchasePrice = (payload.purchasePrice !== undefined && canViewPurchase)
      ? (Math.round(Number(payload.purchasePrice) * 100) / 100)
      : oldPurchasePrice;
    var nextCategoryId = payload.categoryId !== undefined ? (payload.categoryId ? String(payload.categoryId).trim() : '') : oldCategoryId;
    var nextUnit = payload.unit !== undefined ? String(payload.unit || '').trim() : oldUnit;

    var changes = [];
    if (oldName !== nextName) {
      changes.push({ label: 'اسم الصنف', oldVal: oldName, newVal: nextName });
    }
    if (oldPrintName !== nextPrintName) {
      changes.push({ label: 'اسم الطباعة', oldVal: oldPrintName || 'فارغ', newVal: nextPrintName || 'فارغ' });
    }
    if (oldNotes !== nextNotes) {
      changes.push({ label: 'الوصف', oldVal: oldNotes || 'فارغ', newVal: nextNotes || 'فارغ' });
    }
    if (payload.purchasePrice !== undefined && canViewPurchase && oldPurchasePrice !== nextPurchasePrice) {
      changes.push({ label: 'سعر الشراء', oldVal: oldPurchasePrice, newVal: nextPurchasePrice });
    }
    if (payload.salePrice !== undefined && oldSalePrice !== nextSalePrice) {
      changes.push({ label: 'سعر البيع', oldVal: oldSalePrice, newVal: nextSalePrice });
    }
    if (oldBarcode !== nextBarcode) {
      changes.push({ label: 'الباركود الرئيسي', oldVal: oldBarcode || 'فارغ', newVal: nextBarcode || 'فارغ' });
    }
    if (oldCategoryId !== nextCategoryId) {
      changes.push({ label: 'التصنيف', oldVal: oldCategoryId || 'بدون تصنيف', newVal: nextCategoryId || 'بدون تصنيف' });
    }
    if (oldUnit !== nextUnit) {
      changes.push({ label: 'الوحدة', oldVal: oldUnit || 'فارغ', newVal: nextUnit || 'فارغ' });
    }

    var now = new Date().toISOString();
    if (changes.length > 0 && now === currentLastUpdated) {
      now = new Date(new Date().getTime() + 1).toISOString();
    }
    var rowData = oldRowData.slice();
    while (rowData.length < h.headers.length) rowData.push('');

    function setRowVal(name, val, fallbackIdx) {
      var idx = h.get(name, fallbackIdx);
      if (idx !== -1 && idx < rowData.length) {
        rowData[idx] = val;
      }
    }

    if (changes.length > 0) {
      setRowVal('اسم الصنف', nextName, 1);
      setRowVal('سعر البيع', nextSalePrice, 3);
      setRowVal('سعر الشراء', nextPurchasePrice, 4);
      setRowVal('ملاحظات', nextNotes, 7);
      setRowVal('الباركود الأساسي', nextBarcode, 10);
      if (colCategory !== -1) rowData[colCategory] = nextCategoryId;
      if (colUnit !== -1) rowData[colUnit] = nextUnit;
      if (colPrintName !== -1) rowData[colPrintName] = nextPrintName;
      if (colUpdatedAt !== -1) rowData[colUpdatedAt] = now;

      sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);

      var sChangeLog = getOrCreateSheet(ss, SHEETS.ITEM_CHANGE_LOG);
      var userName = (session && (session.name || session.phone)) || 'المستخدم';
      if (sChangeLog) {
        for (var ci = 0; ci < changes.length; ci++) {
          var ch = changes[ci];
          sChangeLog.appendRow([
            generateUUID(),
            id,
            nextName,
            ch.label,
            ch.oldVal,
            ch.newVal,
            userName,
            now,
            'تعديل مباشر من جدول الأصناف'
          ]);
        }
      }

      var detailsParts = [];
      for (var dp = 0; dp < changes.length; dp++) {
        detailsParts.push(changes[dp].label + ': من [' + changes[dp].oldVal + '] إلى [' + changes[dp].newVal + ']');
      }
      logAudit(session, 'ITEM_INLINE_EDIT', 'Item', id, 'تعديل مباشر للصنف (' + nextName + ') — ' + detailsParts.join(' ، '));
    }

    var updatedObj = {
      id: id,
      name: nextName,
      printName: nextPrintName,
      categoryId: nextCategoryId || undefined,
      salePrice: nextSalePrice,
      notes: nextNotes,
      barcode: nextBarcode,
      unit: nextUnit || undefined,
      minPrice: minPriceVal,
      createdAt: currentCreatedAt,
      updatedAt: changes.length > 0 ? now : (currentLastUpdated || now)
    };
    if (canViewPurchase) {
      updatedObj.purchasePrice = nextPurchasePrice;
    }

    return {
      success: true,
      item: updatedObj
    };
  });
}

/**
 * تحليل مجموعات الأصناف المكررة (بالاسم أو الباركود) في Google Sheets بقراءة كل ورقة مرة واحدة
 */
function analyzeDuplicateItemsInSheet(ss) {
  var sheet = ss.getSheetByName(SHEETS.ITEMS);
  if (!sheet || sheet.getLastRow() < 2) {
    return {
      success: true,
      totalItems: 0,
      duplicateGroupsCount: 0,
      totalDeleteCount: 0,
      totalKeptCount: 0,
      totalNotDeletedCount: 0,
      groups: [],
      _rowById: {}
    };
  }

  var h = getHeaderMap(sheet);
  var colId = h.get('ID', 0);
  var colName = h.get('اسم الصنف', 1);
  var colSale = h.get('سعر البيع', 3);
  var colStock = h.get('الكمية بالمخزن', 6);
  var colCreated = h.get('تاريخ الإضافة', 8);
  var colStatus = h.get('حالة الصنف', 9);
  var colBarcode = h.get('الباركود الأساسي', 10);
  var colSku = h.get('كود SKU', -1);

  var itemData = sheet.getDataRange().getValues();
  var itemsList = [];
  var rowById = {};

  // قراءة الباركودات الفرعية مرة واحدة
  var allBarcodesByItem = {};
  var sBarcodes = ss.getSheetByName(SHEETS.ITEM_BARCODES);
  if (sBarcodes && sBarcodes.getLastRow() > 1) {
    var bData = sBarcodes.getDataRange().getValues();
    for (var b = 1; b < bData.length; b++) {
      var bItemId = String(bData[b][1] || '').trim();
      var bActive = bData[b][5] !== false && String(bData[b][5]).toLowerCase() !== 'false';
      var bNorm = normalizeItemBarcode(bData[b][2]).toLowerCase();
      if (bItemId && bActive && bNorm) {
        if (!allBarcodesByItem[bItemId]) allBarcodesByItem[bItemId] = [];
        if (allBarcodesByItem[bItemId].indexOf(bNorm) === -1) allBarcodesByItem[bItemId].push(bNorm);
      }
    }
  }

  // قراءة حركات الفواتير والمرتجعات والمشتريات والمخزون مرة واحدة لكل ورقة
  var txReasonsByItem = {};
  function addTxReason(itemId, reason) {
    var k = String(itemId || '').trim();
    if (!k) return;
    if (!txReasonsByItem[k]) txReasonsByItem[k] = [];
    if (txReasonsByItem[k].indexOf(reason) === -1) txReasonsByItem[k].push(reason);
  }

  var sInvLines = ss.getSheetByName(SHEETS.INVOICE_LINES);
  if (sInvLines && sInvLines.getLastRow() > 1) {
    var hInvL = getHeaderMap(sInvLines);
    var cInvItem = hInvL.get('الصنف', -1);
    if (cInvItem === -1) cInvItem = hInvL.get('ID الصنف', 1);
    var invData = sInvLines.getDataRange().getValues();
    for (var iv = 1; iv < invData.length; iv++) {
      addTxReason(invData[iv][cInvItem], 'فواتير بيع مسجلة');
    }
  }

  var sRetLines = ss.getSheetByName(SHEETS.RETURN_LINES);
  if (sRetLines && sRetLines.getLastRow() > 1) {
    var hRetL = getHeaderMap(sRetLines);
    var cRetItem = hRetL.get('ID الصنف', 3);
    var retData = sRetLines.getDataRange().getValues();
    for (var rt = 1; rt < retData.length; rt++) {
      addTxReason(retData[rt][cRetItem], 'مرتجعات مبيعات مسجلة');
    }
  }

  var sPurLines = ss.getSheetByName(SHEETS.PURCHASE_LINES);
  if (sPurLines && sPurLines.getLastRow() > 1) {
    var hPurL = getHeaderMap(sPurLines);
    var cPurItem = hPurL.get('ID الصنف', 2);
    var purData = sPurLines.getDataRange().getValues();
    for (var pr = 1; pr < purData.length; pr++) {
      addTxReason(purData[pr][cPurItem], 'فواتير شراء مسجلة');
    }
  }

  var sPurRetLines = ss.getSheetByName(SHEETS.PURCHASE_RETURN_LINES);
  if (sPurRetLines && sPurRetLines.getLastRow() > 1) {
    var hPrL = getHeaderMap(sPurRetLines);
    var cPrItem = hPrL.get('ID الصنف', 2);
    var prData = sPurRetLines.getDataRange().getValues();
    for (var prr = 1; prr < prData.length; prr++) {
      addTxReason(prData[prr][cPrItem], 'مرتجعات شراء مسجلة');
    }
  }

  var sStock = ss.getSheetByName(SHEETS.STOCK_MOVEMENTS);
  if (sStock && sStock.getLastRow() > 1) {
    var hSm = getHeaderMap(sStock);
    var cSmItem = hSm.get('ID الصنف', 1);
    var cSmType = hSm.get('نوع الحركة', 3);
    var smData = sStock.getDataRange().getValues();
    for (var sm = 1; sm < smData.length; sm++) {
      var mType = String(smData[sm][cSmType] || '').trim();
      if (mType !== 'استيراد رصيد افتتاحي') {
        addTxReason(smData[sm][cSmItem], 'حركات مخزون سابقة');
      }
    }
  }

  for (var i = 1; i < itemData.length; i++) {
    var r = itemData[i];
    var id = String(colVal(r, colId, '')).trim();
    if (!id) continue;
    var name = String(colVal(r, colName, '')).trim();
    var barcode = normalizeItemBarcode(colVal(r, colBarcode, ''));
    var sku = colSku !== -1 ? normalizeItemBarcode(colVal(r, colSku, '')) : '';
    var createdAtVal = colVal(r, colCreated, '');
    var createdAtStr = createdAtVal instanceof Date ? createdAtVal.toISOString() : String(createdAtVal || '');
    var bcs = allBarcodesByItem[id] ? allBarcodesByItem[id].slice() : [];
    if (barcode && bcs.indexOf(barcode.toLowerCase()) === -1) {
      bcs.unshift(barcode.toLowerCase());
    }
    rowById[id] = i + 1;
    itemsList.push({
      id: id,
      rowNumber: i + 1,
      name: name,
      normName: normalizeItemName(name),
      sku: sku || undefined,
      barcode: barcode || undefined,
      allBarcodes: bcs,
      createdAt: createdAtStr,
      stockQuantity: Number(colVal(r, colStock, 0)) || 0,
      salePrice: Number(colVal(r, colSale, 0)) || 0,
      status: String(colVal(r, colStatus, 'نشط')).trim(),
      transactionReasons: txReasonsByItem[id] || []
    });
  }

  var n = itemsList.length;
  if (n < 2) {
    return {
      success: true,
      totalItems: n,
      duplicateGroupsCount: 0,
      totalDeleteCount: 0,
      totalKeptCount: 0,
      totalNotDeletedCount: 0,
      groups: [],
      _rowById: rowById
    };
  }

  // Union-Find لتجميع المكررات بالاسم أو الباركود
  var parent = [];
  for (var p = 0; p < n; p++) parent.push(p);
  function findRoot(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function unionIdx(a, b) {
    var ra = findRoot(a);
    var rb = findRoot(b);
    if (ra !== rb) parent[rb] = ra;
  }

  var nameFirst = {};
  var bcFirst = {};
  for (var idx = 0; idx < n; idx++) {
    var it = itemsList[idx];
    if (it.normName) {
      if (nameFirst[it.normName] !== undefined) unionIdx(nameFirst[it.normName], idx);
      else nameFirst[it.normName] = idx;
    }
    for (var bi = 0; bi < it.allBarcodes.length; bi++) {
      var bKey = it.allBarcodes[bi];
      if (bcFirst[bKey] !== undefined) unionIdx(bcFirst[bKey], idx);
      else bcFirst[bKey] = idx;
    }
  }

  var components = {};
  for (var ci = 0; ci < n; ci++) {
    var rtIdx = findRoot(ci);
    if (!components[rtIdx]) components[rtIdx] = [];
    components[rtIdx].push(itemsList[ci]);
  }

  function parseCreatedMs(val) {
    if (!val) return 9007199254740991;
    var t = Date.parse(val);
    return isNaN(t) ? 9007199254740991 : t;
  }

  var groups = [];
  var totalDeleteCount = 0;
  var totalKeptCount = 0;
  var totalNotDeletedCount = 0;

  var compKeys = Object.keys(components);
  for (var ck = 0; ck < compKeys.length; ck++) {
    var grpItems = components[compKeys[ck]];
    if (grpItems.length < 2) continue;

    // ترتيب من الأقدم إضافةً إلى الأحدث (الصف الأصغر أقدم عند تساوي التاريخ)
    grpItems.sort(function(a, b) {
      var ta = parseCreatedMs(a.createdAt);
      var tb = parseCreatedMs(b.createdAt);
      if (ta !== tb) return ta - tb;
      return a.rowNumber - b.rowNumber;
    });

    var gNameCounts = {};
    var gBcCounts = {};
    for (var gi = 0; gi < grpItems.length; gi++) {
      var gIt = grpItems[gi];
      if (gIt.normName) gNameCounts[gIt.normName] = (gNameCounts[gIt.normName] || 0) + 1;
      for (var gbi = 0; gbi < gIt.allBarcodes.length; gbi++) {
        var gbc = gIt.allBarcodes[gbi];
        gBcCounts[gbc] = (gBcCounts[gbc] || 0) + 1;
      }
    }

    var matchReasons = [];
    var firstMatchedName = '';
    var matchedBcs = [];
    for (var gj = 0; gj < grpItems.length; gj++) {
      var gIt2 = grpItems[gj];
      if (gIt2.normName && gNameCounts[gIt2.normName] > 1) {
        if (matchReasons.indexOf('name') === -1) matchReasons.push('name');
        if (!firstMatchedName) firstMatchedName = gIt2.name;
      }
      for (var gbj = 0; gbj < gIt2.allBarcodes.length; gbj++) {
        var gbc2 = gIt2.allBarcodes[gbj];
        if (gBcCounts[gbc2] > 1) {
          if (matchReasons.indexOf('barcode') === -1) matchReasons.push('barcode');
          if (matchedBcs.indexOf(gbc2) === -1) matchedBcs.push(gbc2);
        }
      }
    }

    var summaries = [];
    var protectedList = [];
    var cleanList = [];
    for (var gs = 0; gs < grpItems.length; gs++) {
      var sItem = grpItems[gs];
      var summary = {
        id: sItem.id,
        name: sItem.name,
        sku: sItem.sku,
        barcode: sItem.barcode,
        createdAt: sItem.createdAt,
        stockQuantity: sItem.stockQuantity,
        salePrice: sItem.salePrice,
        status: sItem.status,
        hasTransactions: sItem.transactionReasons.length > 0,
        transactionReasons: sItem.transactionReasons
      };
      summaries.push(summary);
      if (summary.hasTransactions) protectedList.push(summary);
      else cleanList.push(summary);
    }

    var keptItems = [];
    var deleteItems = [];
    var notDeletedItems = [];

    if (protectedList.length === 0) {
      keptItems = [cleanList[0]];
      deleteItems = cleanList.slice(1);
    } else if (cleanList.length === 0) {
      for (var np = 0; np < protectedList.length; np++) {
        var pObj = protectedList[np];
        notDeletedItems.push({
          id: pObj.id,
          name: pObj.name,
          sku: pObj.sku,
          barcode: pObj.barcode,
          createdAt: pObj.createdAt,
          stockQuantity: pObj.stockQuantity,
          salePrice: pObj.salePrice,
          status: pObj.status,
          hasTransactions: true,
          transactionReasons: pObj.transactionReasons,
          skipReason: 'مرتبط بحركات سابقة لا تسمح بالحذف (' + pObj.transactionReasons.join('، ') + ')'
        });
      }
    } else {
      keptItems = [protectedList[0]];
      deleteItems = cleanList;
      for (var np2 = 1; np2 < protectedList.length; np2++) {
        var pObj2 = protectedList[np2];
        notDeletedItems.push({
          id: pObj2.id,
          name: pObj2.name,
          sku: pObj2.sku,
          barcode: pObj2.barcode,
          createdAt: pObj2.createdAt,
          stockQuantity: pObj2.stockQuantity,
          salePrice: pObj2.salePrice,
          status: pObj2.status,
          hasTransactions: true,
          transactionReasons: pObj2.transactionReasons,
          skipReason: 'مرتبط بحركات سابقة لا تسمح بالحذف (' + pObj2.transactionReasons.join('، ') + ')'
        });
      }
    }

    var labelParts = [];
    if (firstMatchedName) labelParts.push('الاسم: ' + firstMatchedName);
    if (matchedBcs.length > 0) labelParts.push('الباركود: ' + matchedBcs.join('، '));

    groups.push({
      groupKey: summaries.map(function(x) { return x.id; }).join('|'),
      matchReasons: matchReasons,
      matchLabel: labelParts.join(' | ') || summaries[0].name,
      keptItems: keptItems,
      deleteItems: deleteItems,
      notDeletedItems: notDeletedItems
    });

    totalDeleteCount += deleteItems.length;
    totalKeptCount += keptItems.length;
    totalNotDeletedCount += notDeletedItems.length;
  }

  return {
    success: true,
    totalItems: n,
    duplicateGroupsCount: groups.length,
    totalDeleteCount: totalDeleteCount,
    totalKeptCount: totalKeptCount,
    totalNotDeletedCount: totalNotDeletedCount,
    groups: groups,
    _rowById: rowById
  };
}

/**
 * معاينة الأصناف المكررة قبل الحذف — للمطور/designer فقط
 */
function previewDuplicateItemsData(session) {
  if (!session || (session.role !== 'designer' && !session.isOwner)) {
    return { success: false, error: 'غير مصرح: هذه العملية مخصصة لمطور/مصمم النظام (designer) فقط' };
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var res = analyzeDuplicateItemsInSheet(ss);
  delete res._rowById;
  return res;
}

/**
 * تنفيذ حذف الأصناف المكررة من الأسفل للأعلى دفعة واحدة مع بياناتها التابعة — للمطور/designer فقط
 */
function cleanupDuplicateItemsData(session) {
  if (!session || (session.role !== 'designer' && !session.isOwner)) {
    return { success: false, error: 'غير مصرح: هذه العملية مخصصة لمطور/مصمم النظام (designer) فقط' };
  }

  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var beforeRes = analyzeDuplicateItemsInSheet(ss);

    var deleteIdMap = {};
    var deletedItems = [];
    var keptItems = [];
    var notDeletedItems = [];
    var itemRowsToDelete = [];

    for (var g = 0; g < beforeRes.groups.length; g++) {
      var grp = beforeRes.groups[g];
      for (var k = 0; k < grp.keptItems.length; k++) {
        keptItems.push({
          id: grp.keptItems[k].id,
          name: grp.keptItems[k].name,
          sku: grp.keptItems[k].sku,
          barcode: grp.keptItems[k].barcode
        });
      }
      for (var d = 0; d < grp.deleteItems.length; d++) {
        var delItem = grp.deleteItems[d];
        deleteIdMap[delItem.id] = true;
        deletedItems.push({
          id: delItem.id,
          name: delItem.name,
          sku: delItem.sku,
          barcode: delItem.barcode
        });
        if (beforeRes._rowById && beforeRes._rowById[delItem.id]) {
          itemRowsToDelete.push(beforeRes._rowById[delItem.id]);
        }
      }
      for (var nd = 0; nd < grp.notDeletedItems.length; nd++) {
        var ndItem = grp.notDeletedItems[nd];
        notDeletedItems.push({
          id: ndItem.id,
          name: ndItem.name,
          sku: ndItem.sku,
          barcode: ndItem.barcode,
          reason: ndItem.skipReason
        });
      }
    }

    var deletedCostsCount = 0;
    var deletedBarcodesCount = 0;

    if (deletedItems.length > 0) {
      // 1. حذف صفوف الأصناف المكررة من الأسفل للأعلى دفعة واحدة (دون إضافة كمياتها على المتبقي)
      var sItems = ss.getSheetByName(SHEETS.ITEMS);
      deleteRowsDescendingBatch(sItems, itemRowsToDelete);

      // 2. حذف الباركودات التابعة من الأسفل للأعلى دفعة واحدة
      var sBarcodes = ss.getSheetByName(SHEETS.ITEM_BARCODES);
      if (sBarcodes && sBarcodes.getLastRow() > 1) {
        var bData = sBarcodes.getDataRange().getValues();
        var bRowsToDelete = [];
        for (var bi = 1; bi < bData.length; bi++) {
          if (deleteIdMap[String(bData[bi][1] || '').trim()]) {
            bRowsToDelete.push(bi + 1);
          }
        }
        deletedBarcodesCount = bRowsToDelete.length;
        deleteRowsDescendingBatch(sBarcodes, bRowsToDelete);
      }

      // 3. حذف أسعار وتكاليف المنصات التابعة من الأسفل للأعلى دفعة واحدة
      var sCosts = ss.getSheetByName(SHEETS.ITEM_PLATFORM_COSTS);
      if (sCosts && sCosts.getLastRow() > 1) {
        var cData = sCosts.getDataRange().getValues();
        var cRowsToDelete = [];
        for (var ci = 1; ci < cData.length; ci++) {
          if (deleteIdMap[String(cData[ci][0] || '').trim()]) {
            cRowsToDelete.push(ci + 1);
          }
        }
        deletedCostsCount = cRowsToDelete.length;
        deleteRowsDescendingBatch(sCosts, cRowsToDelete);
      }

      // 4. تنظيف سجلات التعديل والرصيد الافتتاحي للأصناف المحذوفة من الأسفل للأعلى
      var sChangeLog = ss.getSheetByName(SHEETS.ITEM_CHANGE_LOG);
      if (sChangeLog && sChangeLog.getLastRow() > 1) {
        var clData = sChangeLog.getDataRange().getValues();
        var clRowsToDelete = [];
        for (var cl = 1; cl < clData.length; cl++) {
          if (deleteIdMap[String(clData[cl][1] || '').trim()]) {
            clRowsToDelete.push(cl + 1);
          }
        }
        deleteRowsDescendingBatch(sChangeLog, clRowsToDelete);
      }

      var sStock = ss.getSheetByName(SHEETS.STOCK_MOVEMENTS);
      if (sStock && sStock.getLastRow() > 1) {
        var hSm = getHeaderMap(sStock);
        var cSmItem = hSm.get('ID الصنف', 1);
        var cSmType = hSm.get('نوع الحركة', 3);
        var smData = sStock.getDataRange().getValues();
        var smRowsToDelete = [];
        for (var sm = 1; sm < smData.length; sm++) {
          var smItemId = String(smData[sm][cSmItem] || '').trim();
          var smType = String(smData[sm][cSmType] || '').trim();
          if (deleteIdMap[smItemId] && smType === 'استيراد رصيد افتتاحي') {
            smRowsToDelete.push(sm + 1);
          }
        }
        deleteRowsDescendingBatch(sStock, smRowsToDelete);
      }
    }

    var afterRes = analyzeDuplicateItemsInSheet(ss);
    var deletedNames = deletedItems.map(function(x) { return x.name; }).join('، ');
    logAudit(
      session,
      'ITEMS_DUPLICATES_CLEANUP',
      'Item',
      'BATCH',
      'تنظيف الأصناف المكررة: حذف ' + deletedItems.length + ' صنف (' + (deletedNames || 'لا يوجد') + ')، الإبقاء على ' + keptItems.length + '، لم يُحذف ' + notDeletedItems.length + '، حذف ' + deletedCostsCount + ' ربط/سعر منصة'
    );

    return {
      success: true,
      duplicateGroupsBefore: beforeRes.duplicateGroupsCount,
      duplicateGroupsAfter: afterRes.duplicateGroupsCount,
      deletedCount: deletedItems.length,
      keptCount: keptItems.length,
      notDeletedCount: notDeletedItems.length,
      deletedItems: deletedItems,
      keptItems: keptItems,
      notDeletedItems: notDeletedItems,
      deletedCostsCount: deletedCostsCount,
      deletedBarcodesCount: deletedBarcodesCount,
      message: deletedItems.length > 0
        ? ('تم حذف ' + deletedItems.length + ' صنف مكرر بنجاح (' + deletedNames + ')')
        : 'لم يتم حذف أي صنف مكرر'
    };
  });
}

/**
 * فحص هل الصنف مرتبط بأي معاملات سابقة
 */
function isItemUsedInTransactions(ss, id) {
  // فحص سطور الفواتير
  var sInvLines = ss.getSheetByName(SHEETS.INVOICE_LINES);
  if (sInvLines && sInvLines.getLastRow() > 1) {
    var invData = sInvLines.getDataRange().getValues();
    for (var i = 1; i < invData.length; i++) {
      if (String(invData[i][1]) === String(id)) return true;
    }
  }

  // فحص سطور المرتجعات
  var sRetLines = ss.getSheetByName(SHEETS.RETURN_LINES);
  if (sRetLines && sRetLines.getLastRow() > 1) {
    var retData = sRetLines.getDataRange().getValues();
    for (var r = 1; r < retData.length; r++) {
      if (String(retData[r][3]) === String(id)) return true;
    }
  }

  // فحص سطور المشتريات
  var sPurLines = ss.getSheetByName(SHEETS.PURCHASE_LINES);
  if (sPurLines && sPurLines.getLastRow() > 1) {
    var purData = sPurLines.getDataRange().getValues();
    for (var p = 1; p < purData.length; p++) {
      if (String(purData[p][2]) === String(id) || String(purData[p][1]) === String(id)) return true;
    }
  }

  // فحص سطور مرتجعات المشتريات
  var sPurRetLines = ss.getSheetByName(SHEETS.PURCHASE_RETURN_LINES);
  if (sPurRetLines && sPurRetLines.getLastRow() > 1) {
    var prData = sPurRetLines.getDataRange().getValues();
    for (var pr = 1; pr < prData.length; pr++) {
      if (String(prData[pr][2]) === String(id) || String(prData[pr][1]) === String(id)) return true;
    }
  }

  // فحص سطور أوامر الصرف بين المخازن
  var sDispLines = ss.getSheetByName(SHEETS.WAREHOUSE_DISPATCH_ORDER_LINES);
  if (sDispLines && sDispLines.getLastRow() > 1) {
    var dlData = sDispLines.getDataRange().getValues();
    for (var dl = 1; dl < dlData.length; dl++) {
      if (String(dlData[dl][2]) === String(id)) return true;
    }
  }

  // فحص حركات المخزون
  var sStock = ss.getSheetByName(SHEETS.STOCK_MOVEMENTS);
  if (sStock && sStock.getLastRow() > 1) {
    var smData = sStock.getDataRange().getValues();
    for (var sm = 1; sm < smData.length; sm++) {
      if (String(smData[sm][1]) === String(id)) return true;
    }
  }

  return false;
}

/**
 * حذف صنف مع حظر الحذف في حال وجود رصيد مخزني أو فواتير أو حركات مرتبطة
 */
function deleteItem(id, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var sheet = ss.getSheetByName(SHEETS.ITEMS);
    if (!sheet || sheet.getLastRow() < 2) return { success: false, error: 'الصنف غير موجود' };

    var h = getHeaderMap(sheet);
    var colId = h.get('ID', 0);
    var colStock = h.get('الكمية بالمخزن', 6);
    var data = sheet.getDataRange().getValues();

    var sWhStocks = ss.getSheetByName(SHEETS.WAREHOUSE_STOCKS);
    if (sWhStocks && sWhStocks.getLastRow() > 1) {
      var wsRows = sWhStocks.getDataRange().getValues();
      for (var wsi = 1; wsi < wsRows.length; wsi++) {
        if (String(wsRows[wsi][0]) === String(id) && (Number(wsRows[wsi][2]) || 0) !== 0) {
          return {
            success: false,
            hasTransactions: true,
            error: 'لا يمكن حذف هذا الصنف لأن رصيده في أحد المخازن (' + Number(wsRows[wsi][2]) + ') لا يساوي صفراً. يجب تصفية المخزون أو أرشفة الصنف بدلاً من حذفه.'
          };
        }
      }
    }

    for (var i = 1; i < data.length; i++) {
      if (String(colVal(data[i], colId)) === String(id)) {
        var currentStock = Number(colVal(data[i], colStock)) || 0;
        if (currentStock > 0) {
          return {
            success: false,
            hasTransactions: true,
            error: 'لا يمكن حذف هذا الصنف لأن كميته بالمخزن (' + currentStock + ') أكبر من صفر. يجب تصفية المخزون أو أرشفة الصنف بدلاً من حذفه.'
          };
        }
        break;
      }
    }

    if (isItemUsedInTransactions(ss, id)) {
      return {
        success: false,
        hasTransactions: true,
        error: 'لا يمكن حذف هذا الصنف لوجود معاملات سابقة مرتبطة به (مبيعات أو مشتريات أو مرتجعات أو تحويلات أو حركات مخزون). يمكنك أرشفة الصنف بدلاً من حذفه لإيقاف ظهوره مع حماية السجلات المالية التاريخية.'
      };
    }

    for (var i = 1; i < data.length; i++) {
      if (String(colVal(data[i], colId)) === String(id)) {
        var itemName = colVal(data[i], h.get('اسم الصنف', 1));
        sheet.deleteRow(i + 1);

        // حذف الباركودات المرتبطة
        var sBarcodes = ss.getSheetByName(SHEETS.ITEM_BARCODES);
        if (sBarcodes && sBarcodes.getLastRow() > 1) {
          var bRows = sBarcodes.getDataRange().getValues();
          for (var br = bRows.length - 1; br >= 1; br--) {
            if (String(bRows[br][1]) === String(id)) {
              sBarcodes.deleteRow(br + 1);
            }
          }
        }

        // تنظيف أرصدة المخازن الصفرية للصنف المحذوف
        if (sWhStocks && sWhStocks.getLastRow() > 1) {
          var wsRowsDel = sWhStocks.getDataRange().getValues();
          for (var wsd = wsRowsDel.length - 1; wsd >= 1; wsd--) {
            if (String(wsRowsDel[wsd][0]) === String(id)) {
              sWhStocks.deleteRow(wsd + 1);
            }
          }
        }

        logAudit(session, 'ITEM_DELETE', 'Item', id, 'حذف صنف نهائي: ' + itemName);
        return { success: true, message: 'تم حذف الصنف بنجاح' };
      }
    }
    return { success: false, error: 'الصنف غير موجود' };
  });
}

/**
 * أرشفة صنف (إيقاف ظهوره في المبيعات مع حفظ قيوده التاريخية)
 */
function archiveItem(id, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEETS.ITEMS);
    if (!sheet || sheet.getLastRow() < 2) return { success: false, error: 'الصنف غير موجود' };

    var h = getHeaderMap(sheet);
    var colId = h.get('ID', 0);
    var colStatus = h.get('حالة الصنف', 9);
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(colVal(data[i], colId)) === String(id)) {
        var itemName = colVal(data[i], h.get('اسم الصنف', 1));
        sheet.getRange(i + 1, colStatus + 1).setValue('مؤرشف');
        logAudit(session, 'ITEM_ARCHIVE', 'Item', id, 'أرشفة صنف: ' + itemName);
        return { success: true, message: 'تم أرشفة الصنف بنجاح' };
      }
    }
    return { success: false, error: 'الصنف غير موجود' };
  });
}

/**
 * جلب سجل التعديلات وحركات المخزون لصنف
 */
function getItemLogs(itemId, session) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var changeLogs = [];
  var stockMovements = [];

  // 1. سجل التعديلات
  var sChangeLog = ss.getSheetByName(SHEETS.ITEM_CHANGE_LOG);
  if (sChangeLog && sChangeLog.getLastRow() > 1) {
    var cData = sChangeLog.getDataRange().getValues();
    for (var c = cData.length - 1; c >= 1; c--) {
      var cr = cData[c];
      if (String(cr[1]) === String(itemId)) {
        changeLogs.push({
          id: String(cr[0]),
          itemId: String(cr[1]),
          itemName: String(cr[2]),
          fieldName: String(cr[3]),
          oldValue: cr[4],
          newValue: cr[5],
          userName: String(cr[6]),
          timestamp: String(cr[7]),
          reason: String(cr[8] || '')
        });
      }
    }
  }

  // 2. حركات المخزون
  var sMovements = ss.getSheetByName(SHEETS.STOCK_MOVEMENTS);
  if (sMovements && sMovements.getLastRow() > 1) {
    var mData = sMovements.getDataRange().getValues();
    for (var m = mData.length - 1; m >= 1; m--) {
      var mr = mData[m];
      if (String(mr[1]) === String(itemId)) {
        stockMovements.push({
          id: String(mr[0]),
          itemId: String(mr[1]),
          itemName: String(mr[2]),
          movementType: String(mr[3]),
          quantity: Number(mr[4]),
          balanceAfter: Number(mr[5]),
          notes: String(mr[6] || mr[10] || ''),
          documentNumber: String(mr[7] || ''),
          userName: String(mr[8] || ''),
          date: String(mr[9] || '')
        });
      }
    }
  }

  return {
    success: true,
    data: {
      changeLogs: changeLogs,
      stockMovements: stockMovements
    }
  };
}

/**
 * استيراد دفعة أصناف بالجملة من Apps Script
 */
function importItemsBatch(payload, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var items = payload.items || [];
    var updateExisting = Boolean(payload.updateExisting);
    var batchId = payload.batchId || ('BATCH-' + generateUUID().slice(0, 8));
    var fileName = payload.fileName || 'ملف استيراد';
    var now = new Date().toISOString();
    var userName = (session && (session.name || session.phone)) || 'المستخدم';
    var canManageCategories = hasCategoriesManagePermGS(session);

    var sCats = ss.getSheetByName(SHEETS.PRODUCT_CATEGORIES);
    var categoriesList = [];
    var maxCatDisplayOrder = 0;
    if (sCats && sCats.getLastRow() > 1) {
      var cData = sCats.getDataRange().getValues();
      var ch = getHeaderMap(sCats);
      var cIdIdx = ch.get('ID', 0);
      var cNameIdx = ch.get('اسم التصنيف', 1);
      var cParentIdx = ch.get('ID التصنيف الأب', 2);
      var cStatusIdx = ch.get('الحالة', 3);
      var cOrderIdx = ch.get('ترتيب العرض', 5);
      for (var c = 1; c < cData.length; c++) {
        var cid = String(colVal(cData[c], cIdIdx, '')).trim();
        if (!cid) continue;
        var ordVal = Number(colVal(cData[c], cOrderIdx, 0)) || 0;
        if (ordVal > maxCatDisplayOrder) maxCatDisplayOrder = ordVal;
        categoriesList.push({
          id: cid,
          name: String(colVal(cData[c], cNameIdx, '')).trim(),
          parentCategoryId: String(colVal(cData[c], cParentIdx, '')).trim() || null,
          status: String(colVal(cData[c], cStatusIdx, 'نشط')).trim()
        });
      }
    }

    var createdCatsByNorm = {};
    var createdNewCatsStatsByNorm = {};

    var insertedCount = 0;
    var updatedCount = 0;
    var errors = [];

    for (var i = 0; i < items.length; i++) {
      var raw = items[i] || {};
      var rowNum = i + 2;
      var item = Object.assign({}, raw);
      if (item.name === undefined && raw['اسم الصنف'] !== undefined) item.name = raw['اسم الصنف'];
      if (item.printName === undefined && raw['اسم الطباعة'] !== undefined) item.printName = raw['اسم الطباعة'];
      if (item.notes === undefined && raw['وصف الصنف'] !== undefined) item.notes = raw['وصف الصنف'];
      if (item.stockQuantity === undefined && raw['الكمية'] !== undefined) item.stockQuantity = raw['الكمية'];
      if (item.barcode === undefined && raw['الباركود الرئيسي'] !== undefined) item.barcode = raw['الباركود الرئيسي'];
      if (item.salePrice === undefined && raw['سعر البيع'] !== undefined) item.salePrice = raw['سعر البيع'];
      if (item.purchasePrice === undefined && raw['سعر الشراء'] !== undefined) item.purchasePrice = raw['سعر الشراء'];
      if (item.unit === undefined && raw['الوحدة'] !== undefined) item.unit = raw['الوحدة'];
      if (item.reorderLimit === undefined && raw['الحد الأدنى للكمية'] !== undefined) item.reorderLimit = raw['الحد الأدنى للكمية'];
      if (item.supplier === undefined && raw['المورد'] !== undefined) item.supplier = raw['المورد'];
      if (item.taxRate === undefined && raw['نسبة الضريبة'] !== undefined) item.taxRate = raw['نسبة الضريبة'];
      if (payload.warehouseId && !item.warehouseId) item.warehouseId = payload.warehouseId;

      var cleanItemName = String(item.name || '').trim();
      if (!cleanItemName) {
        errors.push('السطر ' + rowNum + ': خانة "اسم الصنف" الإلزامية فارغة');
        continue;
      }

      var hasPrintNameKey =
        raw.printName !== undefined ||
        Object.prototype.hasOwnProperty.call(raw, 'اسم الطباعة');
      if (hasPrintNameKey) {
        var cleanPn = String(item.printName === null || item.printName === undefined ? '' : item.printName).trim().replace(/\s+/g, ' ');
        if (!cleanPn) {
          errors.push('السطر ' + rowNum + ': خانة "اسم الطباعة" الإلزامية فارغة');
          continue;
        }
        if (cleanPn.length > 120) {
          errors.push('السطر ' + rowNum + ' (' + cleanItemName + '): اسم الطباعة لا يتجاوز 120 حرفاً');
          continue;
        }
        item.printName = cleanPn;
      }

      var hasCategoryInput =
        raw.category !== undefined ||
        raw.rootCategory !== undefined ||
        raw.categoryName !== undefined ||
        Object.prototype.hasOwnProperty.call(raw, 'التصنيف') ||
        raw.subCategory !== undefined ||
        Object.prototype.hasOwnProperty.call(raw, 'التصنيف الفرعي');

      var pendingNewCatInfo = null;
      if (!item.categoryId && hasCategoryInput) {
        var rawMainCat = String(
          raw.category !== undefined ? raw.category
            : (raw.rootCategory !== undefined ? raw.rootCategory
              : (raw.categoryName !== undefined ? raw.categoryName
                : (raw['التصنيف'] !== undefined ? raw['التصنيف'] : '')))
        );
        var rawSubCat = String(
          raw.subCategory !== undefined ? raw.subCategory : (raw['التصنيف الفرعي'] !== undefined ? raw['التصنيف الفرعي'] : '')
        );
        var catRes = resolveSingleColumnImportCategoryGS(
          rawMainCat,
          rawSubCat,
          categoriesList,
          canManageCategories
        );
        if (!catRes.ok) {
          errors.push(
            catRes.error.indexOf('فارغة') !== -1
              ? ('السطر ' + rowNum + ': ' + catRes.error)
              : ('السطر ' + rowNum + ' (' + cleanItemName + '): ' + catRes.error)
          );
          continue;
        }
        if (catRes.isNewRootCategory) {
          pendingNewCatInfo = {
            normName: catRes.newRootNormName,
            exactName: catRes.newRootCategoryName
          };
        } else {
          item.categoryId = catRes.categoryId;
          item.categoryName = catRes.categoryName;
        }
      }

      try {
        if (pendingNewCatInfo) {
          var existingCreatedCat = createdCatsByNorm[pendingNewCatInfo.normName] || null;
          if (!existingCreatedCat) {
            for (var exCi = 0; exCi < categoriesList.length; exCi++) {
              var candCat = categoriesList[exCi];
              if (!candCat.parentCategoryId && isCategoryActiveForImportGS(candCat) && normalizeItemName(candCat.name) === pendingNewCatInfo.normName) {
                existingCreatedCat = candCat;
                break;
              }
            }
          }
          if (!existingCreatedCat) {
            var sCatEnsure = ensureSheetWithHeaders(ss, SHEETS.PRODUCT_CATEGORIES, [
              'ID', 'اسم التصنيف', 'ID التصنيف الأب', 'الحالة', 'الظهور في نقطة البيع', 'ترتيب العرض', 'تاريخ الإنشاء', 'تاريخ التعديل'
            ]);
            maxCatDisplayOrder += 1;
            var newCatObj = {
              id: generateUUID(),
              name: pendingNewCatInfo.exactName,
              parentCategoryId: null,
              status: 'نشط'
            };
            sCatEnsure.appendRow([
              newCatObj.id,
              newCatObj.name,
              '',
              'نشط',
              'TRUE',
              maxCatDisplayOrder,
              now,
              now
            ]);
            categoriesList.push(newCatObj);
            createdCatsByNorm[pendingNewCatInfo.normName] = newCatObj;
            existingCreatedCat = newCatObj;
            logAudit(session, 'CATEGORY_CREATE', 'ProductCategory', newCatObj.id, 'إنشاء تصنيف رئيسي جديد تلقائياً أثناء الاستيراد: ' + newCatObj.name + ' (' + fileName + ')');
          } else {
            createdCatsByNorm[pendingNewCatInfo.normName] = existingCreatedCat;
          }
          item.categoryId = existingCreatedCat.id;
          item.categoryName = existingCreatedCat.name;
        }

        var saveRes = saveItem(item, session);
        if (saveRes.success) {
          if (pendingNewCatInfo && item.categoryId) {
            if (!createdNewCatsStatsByNorm[pendingNewCatInfo.normName]) {
              createdNewCatsStatsByNorm[pendingNewCatInfo.normName] = {
                id: item.categoryId,
                name: item.categoryName,
                itemsCount: 1
              };
            } else {
              createdNewCatsStatsByNorm[pendingNewCatInfo.normName].itemsCount += 1;
            }
          } else if (item.categoryId) {
            for (var exStatK in createdNewCatsStatsByNorm) {
              if (
                Object.prototype.hasOwnProperty.call(createdNewCatsStatsByNorm, exStatK) &&
                createdNewCatsStatsByNorm[exStatK].id === item.categoryId
              ) {
                createdNewCatsStatsByNorm[exStatK].itemsCount += 1;
                break;
              }
            }
          }
          if (item.id) {
            updatedCount++;
          } else {
            insertedCount++;
          }
        } else {
          errors.push('السطر ' + rowNum + ' (' + cleanItemName + '): ' + (saveRes.error || 'فشل الحفظ'));
        }
      } catch (err) {
        errors.push('السطر ' + rowNum + ' (' + cleanItemName + '): ' + err.message);
      }
    }

    var newCategoriesList = [];
    for (var ncK in createdNewCatsStatsByNorm) {
      if (Object.prototype.hasOwnProperty.call(createdNewCatsStatsByNorm, ncK)) {
        newCategoriesList.push(createdNewCatsStatsByNorm[ncK]);
      }
    }

    // توثيق الدفعة في ImportBatches
    var sBatches = getOrCreateSheet(ss, SHEETS.IMPORT_BATCHES);
    if (sBatches) {
      sBatches.appendRow([
        batchId,
        now,
        'Items',
        fileName,
        items.length,
        insertedCount + updatedCount,
        errors.length,
        userName,
        'استيراد ' + insertedCount + ' جديد وتحديث ' + updatedCount + (newCategoriesList.length > 0 ? (' | تصنيفات جديدة: ' + newCategoriesList.map(function(c) { return c.name + ' (' + c.itemsCount + ')'; }).join('، ')) : ''),
        errors.join('\n')
      ]);
    }

    var respData = {
      batchId: batchId,
      insertedCount: insertedCount,
      updatedCount: updatedCount,
      errors: errors
    };
    if (newCategoriesList.length > 0) {
      respData.newCategories = newCategoriesList;
    }

    return {
      success: insertedCount + updatedCount > 0,
      data: respData
    };
  });
}

/**
 * قراءة المنصات
 */
function getPlatformsData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.PLATFORMS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var h = getHeaderMap(sheet);
  var colBnplEnable = h.get('تفعيل BNPL', 6);
  var colBnplPercent = h.get('نسبة BNPL', 7);
  var colPickupMode = h.get('طريقة رسوم الالتقاط', 8);

  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var isBnpl = colBnplEnable !== -1 ? (r[colBnplEnable] === true || String(r[colBnplEnable]).toLowerCase() === 'true' || String(r[colBnplEnable]).trim() === 'نعم') : false;
    var bnplPct = colBnplPercent !== -1 ? (Number(r[colBnplPercent]) || 0) : 0;
    var rawMode = colPickupMode !== -1 && colPickupMode < r.length ? String(r[colPickupMode] || '').trim() : '';
    var pickupFeeMode = (rawMode === 'product' || rawMode === 'حسب الصنف') ? 'product' : 'platform';

    var platId = String(r[0]);
    list.push({
      id: platId,
      name: String(r[1]),
      discountPercentage: Number(r[2]) || 0,
      notes: String(r[3] || ''),
      status: String(r[4] || 'نشطة'),
      pickupFee: Number(r[5]) || 0,
      pickupFeeMode: pickupFeeMode,
      enableBnpl: isBnpl,
      bnplPercentage: bnplPct,
      currentBalance: computePartyBalanceGS(ss, 'platform', platId)
    });
  }
  return list;
}

/**
 * حفظ أو تعديل منصة مع رسوم الالتقاط وBNPL
 */
function savePlatform(plt, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.PLATFORMS);
  if (!sheet) {
    setupSheets();
    sheet = ss.getSheetByName(SHEETS.PLATFORMS);
  }

  ensureSheetWithHeaders(ss, SHEETS.PLATFORMS, [
    'ID', 'اسم المنصة / العميل', 'نسبة الخصم المئوية', 'ملاحظات', 'الحالة', 'رسوم الالتقاط (جنيه لكل قطعة)',
    'تفعيل BNPL', 'نسبة BNPL', 'طريقة رسوم الالتقاط'
  ]);

  var id = plt.id || generateUUID();
  var pickupFeeMode = plt.pickupFeeMode === 'product' ? 'product' : 'platform';
  var rowData = [
    id,
    plt.name || '',
    Number(plt.discountPercentage || 0),
    plt.notes || '',
    plt.status || 'نشطة',
    Math.max(0, Number(plt.pickupFee || 0)),
    plt.enableBnpl === true ? 'نعم' : 'لا',
    Number(plt.bnplPercentage || 0),
    pickupFeeMode
  ];

  var data = sheet.getDataRange().getValues();
  var existingRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      existingRow = i + 1;
      break;
    }
  }

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  plt.pickupFeeMode = pickupFeeMode;
  logAudit(session, existingRow > 0 ? 'PLATFORM_EDIT' : 'PLATFORM_CREATE', 'Platform', id, 'منصة: ' + plt.name);
  return { success: true, id: id, platform: plt };
  });
}

/**
 * قراءة تكاليف شحن المنصات
 */
function getItemPlatformCostsData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.ITEM_PLATFORM_COSTS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    list.push({
      itemId: String(r[0]),
      platformId: String(r[1]),
      returnShippingDeduction: Number(r[3]) || 0
    });
  }
  return list;
}

/**
 * حفظ تكاليف شحن المنصة
 */
function saveItemPlatformCost(costObj, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEETS.ITEM_PLATFORM_COSTS);
    var data = sheet.getDataRange().getValues();

    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(costObj.itemId) && String(data[i][1]) === String(costObj.platformId)) {
        existingRow = i + 1;
        break;
      }
    }

    var rowData = [
      costObj.itemId,
      costObj.platformId,
      0, // عمود تكلفة الشحن القديم (مهمل)
      Number(costObj.returnShippingDeduction || 0)
    ];

    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }

    logAudit(session, 'PLATFORM_COST_UPDATE', 'ItemPlatformCost', costObj.itemId + '_' + costObj.platformId, 'تعديل خصم شحن مرتجع المنصة');
    return { success: true };
  });
}

/**
 * إنشاء فاتورة وفق معادلات القسم 9 وحفظ لقطة الأسعار
 */
function createInvoice(payload, session) {
  var reqIdemKey = getValidatedIdempotencyKeyGS(payload);
  if (!reqIdemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR_GS };
  }
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var sInvoices = ensureSheetWithHeaders(ss, SHEETS.INVOICES, [
      'رقم الفاتورة', 'التاريخ', 'المنصة', 'الإجمالي قبل الخصم', 'قيمة الخصم', 'مصاريف الشحن',
      'الصافي', 'الربح', 'الحالة', 'ملاحظات', 'المستخدم الذي أنشأ الفاتورة', 'إجمالي الضريبة',
      'إجمالي رسوم الالتقاط', 'معدلة', 'تاريخ آخر تعديل', 'رسوم التوصيل', 'إجمالي خصم BNPL',
      'نوع الدفع', 'نوع طرف الآجل', 'معرّف الطرف', 'اسم الطرف', 'مبلغ الاستحقاق',
      'المبلغ المدفوع', 'المبلغ المتبقي', 'حالة الآجل',
      'نسبة BNPL المطبقة', 'نسبة عمولة المنصة المطبقة', 'idempotencyKey',
      'offlineDeviceId', 'offlineProvisionalNo', 'deviceTime', 'needsReview', 'reviewReasons',
      'reviewedAt', 'reviewedBy', 'reviewNote', 'warehouseId'
    ]);
    var sLines = ss.getSheetByName(SHEETS.INVOICE_LINES);
    var dupInvoiceMatch = findRowByIdempotencyKeyGS(sInvoices, reqIdemKey);
    if (dupInvoiceMatch) {
      var dupInv = buildInvoiceFromRowGS(sLines, dupInvoiceMatch.rowValues, reqIdemKey, session);
      return {
        success: true,
        duplicate: true,
        invoiceNumber: dupInv.invoiceNumber,
        finalInvoiceNumber: dupInv.invoiceNumber,
        provisionalInvoiceNumber: dupInv.offlineProvisionalNo || payload.offlineProvisionalNo || payload.tempInvoiceNumber || '',
        invoice: dupInv,
        message: 'تم استرجاع الفاتورة المسجلة مسبقاً (منع التكرار)'
      };
    }

    var isOfflineMode = Boolean(
      payload.isOfflineSync ||
      payload.isOffline ||
      payload.offlineProvisionalNo ||
      payload.tempInvoiceNumber
    );
    var offlineDeviceId = isOfflineMode
      ? String(payload.offlineDeviceId || payload.deviceId || '').trim()
      : '';
    var offlineProvisionalNo = isOfflineMode
      ? String(
          payload.offlineProvisionalNo ||
          payload.tempInvoiceNumber ||
          (payload.invoiceNumber && String(payload.invoiceNumber).indexOf('OFF-') === 0 ? payload.invoiceNumber : '')
        ).trim()
      : '';
    var deviceTimeStr = isOfflineMode
      ? String(payload.deviceTime || payload.createdAt || '').trim()
      : '';

    var lines = payload.lines || payload.items || [];
    if (!Array.isArray(lines) || lines.length === 0) {
      return {
        success: false,
        statusCode: 400,
        error: isOfflineMode ? 'بيانات الفاتورة تالفة: لا توجد أصناف في الفاتورة' : 'لا يمكن حفظ فاتورة خالية من الأصناف'
      };
    }

    // التحقق من سلامة بيانات الأسطر ضد التلف
    for (var vIdx = 0; vIdx < lines.length; vIdx++) {
      var vLine = lines[vIdx];
      if (!vLine || typeof vLine !== 'object') {
        return { success: false, statusCode: 400, error: 'بيانات الفاتورة تالفة: سطر صنف غير صالح' };
      }
      var vItemId = String(vLine.itemId || vLine.productId || '').trim();
      var vQty = Number(vLine.quantity !== undefined ? vLine.quantity : 1);
      if (!vItemId || isNaN(vQty) || vQty <= 0) {
        return { success: false, statusCode: 400, error: 'بيانات الفاتورة تالفة: معرّف الصنف أو الكمية غير صالحة' };
      }
      if (vLine.salePriceAtSale !== undefined && (isNaN(Number(vLine.salePriceAtSale)) || Number(vLine.salePriceAtSale) < 0)) {
        return { success: false, statusCode: 400, error: 'بيانات الفاتورة تالفة: سعر البيع المسجل غير صالح' };
      }
    }

    var sItems = ss.getSheetByName(SHEETS.ITEMS);
    var sPlatforms = ss.getSheetByName(SHEETS.PLATFORMS);
    var sCosts = ss.getSheetByName(SHEETS.ITEM_PLATFORM_COSTS);

    var platformName = payload.platformName || payload.platform || 'البيع المباشر';
    var platformId = payload.platformId || '';
    var platformDiscountPercent = 0;
    var platformPickupFee = 0;
    var platformBnpl = false;
    var platformBnplPct = 0;
    var platformPickupFeeMode = 'platform';

    if (sPlatforms && sPlatforms.getLastRow() > 1) {
      var hPlat = getHeaderMap(sPlatforms);
      var colPlatPickupMode = hPlat.get('طريقة رسوم الالتقاط', 8);
      var pData = sPlatforms.getDataRange().getValues();
      for (var p = 1; p < pData.length; p++) {
        var rowPlatId = String(pData[p][0]);
        var rowPlatName = String(pData[p][1]);
        if (rowPlatId === platformId || rowPlatName.toLowerCase() === platformName.toLowerCase()) {
          platformDiscountPercent = Number(pData[p][2]) || 0;
          platformName = rowPlatName;
          platformId = rowPlatId;
          platformPickupFee = Math.max(0, Number(pData[p][5]) || 0);
          platformBnpl = pData[p][6] === true || String(pData[p][6]).toLowerCase() === 'true' || String(pData[p][6]).trim() === 'نعم';
          platformBnplPct = Number(pData[p][7]) || 0;
          var rawPlatMode = colPlatPickupMode !== -1 && colPlatPickupMode < pData[p].length ? String(pData[p][colPlatPickupMode] || '').trim() : '';
          platformPickupFeeMode = (rawPlatMode === 'product' || rawPlatMode === 'حسب الصنف') ? 'product' : 'platform';
          break;
        }
      }
    }
    var isDesigner = session && session.role === 'designer';
    var canEditPosRates = isDesigner || Boolean(session && session.permissions && session.permissions.indexOf('pos.edit_rates') !== -1);

    var hasBnplPercentOverride = payload.bnplPercentOverride !== undefined && payload.bnplPercentOverride !== null && payload.bnplPercentOverride !== '';
    var hasCommissionPercentOverride = payload.commissionPercentOverride !== undefined && payload.commissionPercentOverride !== null && payload.commissionPercentOverride !== '';
    var hasLegacyDiscountOverride = payload.platformDiscountPercentage !== undefined && payload.platformDiscountPercentage !== null && payload.platformDiscountPercentage !== '' && Number(payload.platformDiscountPercentage) !== Number(platformDiscountPercent || 0);

    if (!isOfflineMode && (hasBnplPercentOverride || hasCommissionPercentOverride || hasLegacyDiscountOverride) && !canEditPosRates) {
      return { success: false, error: 'غير مصرح: لا تملك صلاحية تعديل نسبة BNPL أو نسبة خصم المنصة في نقطة البيع' };
    }

    var bnplPercentOverrideVal = undefined;
    if (hasBnplPercentOverride) {
      var parsedBnpl = Number(payload.bnplPercentOverride);
      if (isNaN(parsedBnpl) || parsedBnpl < 0 || parsedBnpl > 100) {
        return { success: false, error: 'نسبة BNPL يجب أن تكون قيمة رقمية بين 0 و 100' };
      }
      bnplPercentOverrideVal = parsedBnpl;
    }

    var commissionPercentOverrideVal = undefined;
    if (hasCommissionPercentOverride) {
      var parsedComm = Number(payload.commissionPercentOverride);
      if (isNaN(parsedComm) || parsedComm < 0 || parsedComm > 100) {
        return { success: false, error: 'نسبة خصم المنصة يجب أن تكون قيمة رقمية بين 0 و 100' };
      }
      commissionPercentOverrideVal = parsedComm;
    }

    if (commissionPercentOverrideVal !== undefined) {
      platformDiscountPercent = commissionPercentOverrideVal;
    } else if (payload.platformDiscountPercentage !== undefined && payload.platformDiscountPercentage !== null && payload.platformDiscountPercentage !== '') {
      platformDiscountPercent = Number(payload.platformDiscountPercentage);
    } else if (isOfflineMode && payload.commissionPercentApplied !== undefined && payload.commissionPercentApplied !== null) {
      platformDiscountPercent = Number(payload.commissionPercentApplied);
    }

    if (isNaN(platformDiscountPercent) || platformDiscountPercent < 0 || platformDiscountPercent > 100) {
      return { success: false, error: 'نسبة خصم المنصة يجب أن تكون قيمة رقمية بين 0 و 100' };
    }

    var isBnplDisabled = payload.bnplEnabled === false;

    var costMap = {};
    if (sCosts && sCosts.getLastRow() > 1) {
      var cData = sCosts.getDataRange().getValues();
      for (var c = 1; c < cData.length; c++) {
        var cItemId = String(cData[c][0]);
        var cPlatId = String(cData[c][1]);
        costMap[cItemId + '_' + cPlatId] = {
          returnDeduction: Number(cData[c][3]) || 0
        };
      }
    }

    var itemData = sItems && sItems.getLastRow() > 1 ? sItems.getDataRange().getValues() : [];
    var hItems = sItems ? getHeaderMap(sItems) : { get: function() { return -1; } };
    var colItemStatus = hItems.get('حالة الصنف', 9);
    var colItemTax = hItems.get('نسبة الضريبة', 12);
    var colItemBnpl = hItems.get('تفعيل BNPL', -1);
    var colItemBnplPct = hItems.get('نسبة BNPL', -1);
    var colItemPlatforms = hItems.get('معرفات المنصات المتاحة', -1);
    var colItemPickupFee = hItems.get('رسوم الالتقاط للقطعة', -1);
    var colItemPrintName = hItems.get('اسم الطباعة', -1);

    var itemMap = {};
    for (var k = 1; k < itemData.length; k++) {
      var isItemBnpl = colItemBnpl !== -1 ? (itemData[k][colItemBnpl] === true || String(itemData[k][colItemBnpl]).toLowerCase() === 'true' || String(itemData[k][colItemBnpl]).trim() === 'نعم') : false;
      var itBnplPct = colItemBnplPct !== -1 ? (Number(itemData[k][colItemBnplPct]) || 0) : 0;
      var itTaxRate = colItemTax !== -1 ? (Number(itemData[k][colItemTax]) || 0) : 0;
      var itStatus = colItemStatus !== -1 ? String(colVal(itemData[k], colItemStatus, 'نشط')).trim() : 'نشط';
      var rawItPickup = colItemPickupFee !== -1 ? colVal(itemData[k], colItemPickupFee, '') : '';
      var itPickupFee = (rawItPickup !== '' && rawItPickup !== null && rawItPickup !== undefined && Number(rawItPickup) > 0)
        ? Number(rawItPickup)
        : undefined;
      var itPrintName = colItemPrintName !== -1 ? String(colVal(itemData[k], colItemPrintName, '')).trim().slice(0, 120) : '';

      var platIdsRaw = colItemPlatforms !== -1 ? String(colVal(itemData[k], colItemPlatforms, '')).trim() : '';
      var platIds = [];
      if (platIdsRaw) {
        try {
          if (platIdsRaw.charAt(0) === '[') platIds = JSON.parse(platIdsRaw);
          else platIds = platIdsRaw.split(',').map(function(s){return s.trim();}).filter(Boolean);
        } catch(e) {
          platIds = platIdsRaw.split(',').map(function(s){return s.trim();}).filter(Boolean);
        }
      }

      itemMap[String(itemData[k][0])] = {
        rowIndex: k + 1,
        name: String(itemData[k][1]),
        printName: itPrintName,
        salePrice: Number(itemData[k][3]) || 0,
        purchasePrice: Number(itemData[k][4]) || 0,
        packagingCost: Number(itemData[k][5]) || 0,
        currentStock: Number(itemData[k][6]) || 0,
        status: itStatus,
        taxRate: itTaxRate,
        enableBnpl: isItemBnpl,
        bnplPercentage: itBnplPct,
        pickupFee: itPickupFee,
        platformIds: platIds
      };
    }

    // التحقق من توافق الأصناف مع المنصة المحددة (للفواتير الحية فقط)
    if (!isOfflineMode) {
      for (var chkIdx = 0; chkIdx < lines.length; chkIdx++) {
        var chkLine = lines[chkIdx];
        var chkItId = String(chkLine.itemId || chkLine.productId);
        var chkItemInfo = itemMap[chkItId];
        if (chkItemInfo && platformId && Array.isArray(chkItemInfo.platformIds) && chkItemInfo.platformIds.length > 0) {
          if (chkItemInfo.platformIds.indexOf(platformId) === -1) {
            return {
              success: false,
              error: 'الصنف "' + chkItemInfo.name + '" غير متاح للبيع على منصة "' + platformName + '"'
            };
          }
        }
      }
    }

    var whResInv = resolveWarehouseForOperationGS(
      ss,
      payload.warehouseId || payload.warehouseName || null,
      session,
      isOfflineMode
        ? { requireActive: false, enforceUserAccess: false }
        : { requireActive: true, enforceUserAccess: true }
    );
    if (!whResInv.ok) {
      return {
        success: false,
        statusCode: whResInv.statusCode || 400,
        error: whResInv.error
      };
    }
    var resolvedWarehouse = whResInv.warehouse;

    var settingsMap = getSettingsMap();
    var stockSettings = settingsMap.stockSettings || { allowNegativeStockSale: false };
    var allowNegativeStock = isOfflineMode ? true : Boolean(stockSettings.allowNegativeStockSale);

    // تجميع الكميات المطلوبة لكل صنف
    var requestedQtyMap = {};
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var itId = String(line.itemId || line.productId);
      var q = Number(line.quantity || 1);
      requestedQtyMap[itId] = (requestedQtyMap[itId] || 0) + q;
    }

    if (!allowNegativeStock) {
      for (var reqItemId in requestedQtyMap) {
        var itemInfo = itemMap[reqItemId];
        if (!itemInfo) {
          return { success: false, error: 'الصنف غير مسجل بقاعدة البيانات: ' + reqItemId };
        }
        var totalReq = requestedQtyMap[reqItemId];
        var availableInWarehouse = getItemWarehouseStockGS(ss, reqItemId, resolvedWarehouse.id);
        if (availableInWarehouse < totalReq) {
          return {
            success: false,
            error: 'الكمية غير متوفرة للصنف "' + itemInfo.name + '" في مخزن "' + resolvedWarehouse.name + '". المتاح: ' + availableInWarehouse
          };
        }
      }
    }

    // فحص أسباب المراجعة للعمليات المرفوعة من وضع عدم الاتصال (أوفلاين)
    var reviewReasonsList = [];
    function addReviewReasonGS(reasonText) {
      if (reviewReasonsList.indexOf(reasonText) === -1) {
        reviewReasonsList.push(reasonText);
      }
    }

    var now = new Date();
    if (isOfflineMode) {
      // 1) فحص حالة المستخدم (المستخدم موقوف)
      var sUsers = ss.getSheetByName(SHEETS.USERS);
      if (sUsers && sUsers.getLastRow() > 1) {
        var uData = sUsers.getDataRange().getValues();
        var targetUserId = String(payload.userId || (session && session.userId) || '').trim();
        var targetUserPhone = String((session && session.phone) || '').trim();
        for (var uIdx = 1; uIdx < uData.length; uIdx++) {
          var uRowId = String(uData[uIdx][0] || '').trim();
          var uRowUsername = String(uData[uIdx][1] || '').trim();
          var uRowPhone = String(uData[uIdx][10] || '').trim();
          if (
            (targetUserId && uRowId === targetUserId) ||
            (targetUserPhone && (uRowPhone === targetUserPhone || uRowUsername === targetUserPhone))
          ) {
            var uStatus = String(uData[uIdx][6] || 'نشط').trim().toLowerCase();
            if (uStatus === 'موقوف' || uStatus === 'inactive' || uStatus === 'false') {
              addReviewReasonGS('المستخدم موقوف');
            }
            break;
          }
        }
      }
      if (payload.userSuspended === true) {
        addReviewReasonGS('المستخدم موقوف');
      }

      // 2) فحص فرق وقت الجهاز عن وقت الاستلام (أكثر من 10 دقائق)
      if (deviceTimeStr) {
        var parsedDevMs = new Date(deviceTimeStr).getTime();
        if (!isNaN(parsedDevMs) && Math.abs(now.getTime() - parsedDevMs) > 10 * 60 * 1000) {
          addReviewReasonGS('فرق في وقت الجهاز أكثر من 10 دقائق');
        }
      }

      // 3) فحص الرصيد السالب وحالة الأصناف وتغير الأسعار
      for (var rItemId in requestedQtyMap) {
        var rInfo = itemMap[rItemId];
        var reqQtyVal = requestedQtyMap[rItemId];
        if (!rInfo) {
          addReviewReasonGS('الصنف موقوف أو محذوف');
          addReviewReasonGS('رصيد سالب');
        } else {
          var stNorm = String(rInfo.status || 'نشط').trim().toLowerCase();
          if (stNorm === 'موقوف' || stNorm === 'inactive' || stNorm === 'مؤرشف') {
            addReviewReasonGS('الصنف موقوف أو محذوف');
          }
          var availWhOffline = getItemWarehouseStockGS(ss, rItemId, resolvedWarehouse.id);
          if (availWhOffline < reqQtyVal) {
            addReviewReasonGS('رصيد سالب');
          }
        }
      }
      if (payload.needsReview === true && reviewReasonsList.indexOf('رصيد سالب') === -1 && reviewReasonsList.length === 0) {
        addReviewReasonGS('رصيد سالب');
      }
    }

    // التحقق من رسوم التوصيل
    var deliveryFee = 0;
    if (payload.deliveryFee !== undefined && payload.deliveryFee !== null && payload.deliveryFee !== '') {
      var rawDelivery = Number(payload.deliveryFee);
      if (isNaN(rawDelivery) || rawDelivery < 0) {
        return { success: false, error: 'رسوم التوصيل يجب أن تكون قيمة رقمية موجبة' };
      }
      deliveryFee = Math.round(rawDelivery * 100) / 100;
    }

    var rawTaxSettings = (payload && payload.taxSettings) || settingsMap.taxSettings || {};
    var taxSettings = {
      taxInclusive: rawTaxSettings.taxInclusive !== undefined ? Boolean(rawTaxSettings.taxInclusive) : true,
      platformCommissionOn: rawTaxSettings.platformCommissionOn || 'before_tax'
    };

    // معادلات النظام مع دعم BNPL ورسوم التوصيل واستخدام أسعار البيع المسجلة وقت البيع
    var totalBeforeDiscount = 0;
    var totalBnplAmount = 0;
    var totalDiscount = 0;
    var totalPickupFee = 0;
    var totalTax = 0;
    var totalCostSum = 0;
    var calculatedLines = [];

    for (var j = 0; j < lines.length; j++) {
      var ln = lines[j];
      var lItemId = String(ln.itemId || ln.productId);
      var lQty = Number(ln.quantity || 1);
      var itInfo = itemMap[lItemId];

      // في وضع الأوفلاين إذا كان الصنف قد حُذف من قاعدة البيانات، نبني بياناته من لقطة البيع المسجلة ولا نرفض الفاتورة
      if (!itInfo && isOfflineMode) {
        itInfo = {
          rowIndex: -1,
          name: String(ln.itemNameAtSale || ln.itemName || 'صنف محذوف'),
          printName: String(ln.itemPrintNameAtSale || '').trim().slice(0, 120),
          salePrice: Number(ln.salePriceAtSale !== undefined ? ln.salePriceAtSale : (ln.baseUnitPrice || 0)),
          purchasePrice: Number(ln.purchasePriceAtSale || 0),
          packagingCost: Number(ln.packagingCostAtSale || 0),
          currentStock: 0,
          status: 'محذوف',
          taxRate: Number(ln.taxRateAtSale || 0),
          enableBnpl: Number(ln.bnplPercent || 0) > 0,
          bnplPercentage: Number(ln.bnplPercent || 0),
          pickupFee: ln.unitPickupFee !== undefined ? Number(ln.unitPickupFee) : undefined,
          platformIds: []
        };
      }

      if (!itInfo) {
        return { success: false, error: 'الصنف غير مسجل بقاعدة البيانات: ' + lItemId };
      }

      var recordedSalePrice = ln.salePriceAtSale !== undefined
        ? Number(ln.salePriceAtSale)
        : (ln.baseUnitPrice !== undefined ? Number(ln.baseUnitPrice) : undefined);

      if (isOfflineMode && itInfo.rowIndex > 0 && recordedSalePrice !== undefined) {
        if (Math.abs(Number(itInfo.salePrice || 0) - recordedSalePrice) > 0.009) {
          addReviewReasonGS('سعر الصنف تغيّر بعد البيع');
        }
      }

      var salePriceForUnit = recordedSalePrice !== undefined ? recordedSalePrice : itInfo.salePrice;
      var purchasePriceForUnit = (isOfflineMode && ln.purchasePriceAtSale !== undefined)
        ? Number(ln.purchasePriceAtSale)
        : itInfo.purchasePrice;
      var packagingCostForUnit = (isOfflineMode && ln.packagingCostAtSale !== undefined)
        ? Number(ln.packagingCostAtSale)
        : itInfo.packagingCost;

      var lineBnplPercent = isBnplDisabled
        ? 0
        : (bnplPercentOverrideVal !== undefined
            ? bnplPercentOverrideVal
            : (isOfflineMode && ln.bnplPercent !== undefined && ln.bnplPercent !== null
                ? Number(ln.bnplPercent)
                : (itInfo.enableBnpl && itInfo.bnplPercentage
                    ? Number(itInfo.bnplPercentage)
                    : (ln.bnplPercent !== undefined && ln.bnplPercent !== null
                        ? Number(ln.bnplPercent)
                        : ((payload.bnplEnabled === true || platformBnpl) && platformBnplPct
                            ? Number(platformBnplPct)
                            : 0)))));

      var baseUnitPrice = salePriceForUnit;
      var customerUnitPrice = lineBnplPercent > 0
        ? Math.round(baseUnitPrice * (1 + lineBnplPercent / 100) * 100) / 100
        : baseUnitPrice;
      var bnplUnitAmount = Math.round((customerUnitPrice - baseUnitPrice) * 100) / 100;
      var bnplDeductionUnit = lineBnplPercent > 0
        ? Math.round(customerUnitPrice * (lineBnplPercent / 100) * 100) / 100
        : 0;
      var totalBnplDeduction = bnplDeductionUnit * lQty;

      var resolvedPickupFee = platformPickupFeeMode === 'product'
        ? (itInfo && itInfo.pickupFee !== undefined && itInfo.pickupFee !== null && Number(itInfo.pickupFee) > 0
            ? Number(itInfo.pickupFee)
            : Number(platformPickupFee || 0))
        : Number(platformPickupFee || 0);
      var unitPickupFee = Math.max(0, Number(ln.unitPickupFee !== undefined ? ln.unitPickupFee : resolvedPickupFee));
      var taxRate = Number(ln.taxRateAtSale !== undefined ? ln.taxRateAtSale : (itInfo.taxRate || 0));

      var basePriceForUnit = customerUnitPrice;
      var unitTaxAmount = 0;

      if (taxRate > 0) {
        if (taxSettings.taxInclusive) {
          basePriceForUnit = customerUnitPrice / (1 + (taxRate / 100));
          unitTaxAmount = customerUnitPrice - basePriceForUnit;
        } else {
          basePriceForUnit = customerUnitPrice;
          unitTaxAmount = customerUnitPrice * (taxRate / 100);
        }
      }

      // احتساب خصم/عمولة المنصة على سعر العميل (السعر المرفوع عند تفعيل BNPL أو السعر الأساسي بدونه)
      var commissionBase = taxSettings.platformCommissionOn === 'before_tax' ? basePriceForUnit : customerUnitPrice;
      var unitDiscountValue = commissionBase * (platformDiscountPercent / 100);
      var unitNet = customerUnitPrice - bnplDeductionUnit - unitDiscountValue - unitPickupFee;
      var unitRevenueExcludingTax = (customerUnitPrice - unitTaxAmount) - bnplDeductionUnit - unitDiscountValue - unitPickupFee;
      var unitProfit = unitRevenueExcludingTax - purchasePriceForUnit - packagingCostForUnit;

      totalBeforeDiscount += customerUnitPrice * lQty;
      totalBnplAmount += totalBnplDeduction;
      totalDiscount += unitDiscountValue * lQty;
      totalPickupFee += unitPickupFee * lQty;
      totalTax += unitTaxAmount * lQty;
      totalCostSum += (purchasePriceForUnit + packagingCostForUnit) * lQty;

      calculatedLines.push({
        itemId: lItemId,
        name: itInfo.name,
        itemPrintNameAtSale: String(itInfo.printName || '').trim().slice(0, 120),
        qty: lQty,
        salePriceAtSale: baseUnitPrice,
        baseUnitPrice: baseUnitPrice,
        customerUnitPrice: customerUnitPrice,
        bnplPercent: lineBnplPercent,
        bnplUnitAmount: bnplUnitAmount,
        totalBnplAmount: bnplUnitAmount * lQty,
        bnplDeductionUnit: bnplDeductionUnit,
        totalBnplDeduction: totalBnplDeduction,
        purchasePriceAtSale: purchasePriceForUnit,
        packagingCostAtSale: packagingCostForUnit,
        platformDiscountPercentAtSale: platformDiscountPercent,
        unitDiscountValue: unitDiscountValue,
        unitPickupFee: unitPickupFee,
        totalPickupFee: unitPickupFee * lQty,
        unitNet: unitNet,
        unitProfit: unitProfit,
        barcodeAtSale: ln.barcodeAtSale || '',
        taxRateAtSale: taxRate,
        unitTaxAmount: unitTaxAmount,
        rowIndex: itInfo.rowIndex,
        currentStock: itInfo.currentStock
      });
    }

    // صافي المنتجات = إجمالي المعروض للعميل − استقطاع BNPL − خصم المنصة − رسوم الالتقاط
    var netBeforeDelivery = totalBeforeDiscount - totalBnplAmount - totalDiscount - totalPickupFee;
    // المطلوب من العميل / صافي الفاتورة = صافي المنتجات + رسوم التوصيل
    var netAmount = Math.round((netBeforeDelivery + deliveryFee) * 100) / 100;
    // الربح التقديري الصافي
    var totalProfit = netBeforeDelivery - totalTax - totalCostSum;

    var dateStr = Utilities.formatDate(now, 'GMT+2', 'yyyyMMdd');
    var requestedInvNum = payload.invoiceNumber ? String(payload.invoiceNumber).trim() : '';
    var invoiceNumber = (requestedInvNum && requestedInvNum.indexOf('OFF-') !== 0)
      ? requestedInvNum
      : ('INV-' + dateStr + '-' + Math.floor(1000 + Math.random() * 9000));
    var isoDate = now.toISOString();
    var paymentType = payload.paymentType || 'نقدي';
    if (isOfflineMode && paymentType !== 'نقدي' && paymentType !== 'آجل') {
      return { success: false, statusCode: 400, error: 'بيانات الفاتورة تالفة: نوع الدفع غير مدعوم في وضع عدم الاتصال' };
    }
    var isCredit = (paymentType === 'آجل');
    var creditPartyType = undefined;
    var creditPartyId = undefined;
    var creditPartyName = undefined;
    var creditDueAmount = undefined;
    var creditStatus = undefined;

    if (isCredit) {
      var requestedPartyType = payload.creditPartyType || (payload.customerId ? 'customer' : 'platform');
      if (requestedPartyType === 'customer') {
        if (!payload.customerId) {
          return { success: false, error: 'يجب اختيار العميل لإصدار فاتورة آجلة على عميل' };
        }
        var customersAll = getCustomersData();
        var targetCust = null;
        for (var ci = 0; ci < customersAll.length; ci++) {
          if (String(customersAll[ci].id) === String(payload.customerId)) {
            targetCust = customersAll[ci];
            break;
          }
        }
        if (!targetCust) {
          return { success: false, error: 'العميل المحدد غير موجود' };
        }
        creditPartyType = 'customer';
        creditPartyId = targetCust.id;
        creditPartyName = targetCust.name;
        creditDueAmount = Math.round((totalBeforeDiscount + deliveryFee) * 100) / 100;
      } else if (requestedPartyType === 'platform') {
        if (!platformId) {
          return { success: false, error: 'يجب اختيار منصة صالحة لإصدار فاتورة آجلة على منصة' };
        }
        creditPartyType = 'platform';
        creditPartyId = platformId;
        creditPartyName = platformName;
        creditDueAmount = Math.round(netAmount * 100) / 100;
      } else {
        return { success: false, error: 'يجب تحديد طرف صالح (عميل أو منصة) للفاتورة الآجلة' };
      }
      creditStatus = 'معلّقة';
    }

    var paidAmount = 0;
    var remainingAmount = 0;
    if (isCredit) {
      paidAmount = 0;
      remainingAmount = creditDueAmount;
    } else if (paymentType === 'نقدي') {
      var canEditCashPaid = isOfflineMode || !session || session.role === 'designer' || Boolean(session.isOwner) || hasPermission(session, 'invoices.edit_cash_paid');
      if (payload.paidAmount !== undefined && payload.paidAmount !== null && String(payload.paidAmount).trim() !== '') {
        var reqCashPaid = Math.round(Number(payload.paidAmount) * 100) / 100;
        if (isNaN(reqCashPaid) || reqCashPaid < 0) {
          return { success: false, error: 'قيمة المدفوع النقدي غير صالحة' };
        }
        if (Math.abs(reqCashPaid - netAmount) > 0.01 && !canEditCashPaid) {
          return { success: false, error: 'غير مصرح: لا تملك صلاحية تعديل المدفوع النقدي (invoices.edit_cash_paid)، يجب أن يساوي المدفوع إجمالي الفاتورة المطلوب' };
        }
        paidAmount = reqCashPaid;
      } else {
        paidAmount = netAmount;
      }
      remainingAmount = 0;
    } else {
      paidAmount = Math.max(0, Math.min(Number(payload.paidAmount || 0), netAmount));
      remainingAmount = Math.max(0, netAmount - paidAmount);
    }
    var invoiceStatus = isCredit ? 'معلّقة' : 'تم البيع';

    ensureSheetWithHeaders(ss, SHEETS.INVOICE_LINES, [
      'رقم الفاتورة', 'الصنف', 'اسم الصنف وقت البيع', 'الكمية', 'سعر البيع وقت البيع',
      'تكلفة الشراء وقت البيع', 'تكلفة التغليف وقت البيع', 'نسبة خصم المنصة وقت البيع',
      'قيمة الخصم للوحدة', 'تكلفة الشحن للوحدة', 'صافي الوحدة', 'ربح الوحدة',
      'الباركود وقت البيع', 'نسبة الضريبة وقت البيع', 'قيمة الضريبة للوحدة',
      'رسوم الالتقاط للوحدة', 'إجمالي رسوم الالتقاط للسطر', 'السعر الأساسي',
      'نسبة BNPL', 'قيمة زيادة BNPL', 'سعر العميل',
      'قيمة استقطاع BNPL للوحدة', 'إجمالي استقطاع BNPL للسطر', 'اسم الطباعة وقت البيع'
    ]);

    var sMovementsSale = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
      'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
      'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
    ]);
    var saleActorName = (session && (session.name || session.phone)) || payload.createdBy || 'كاشير';

    for (var m = 0; m < calculatedLines.length; m++) {
      var cl = calculatedLines[m];
      sLines.appendRow([
        invoiceNumber,
        cl.itemId,
        cl.name,
        cl.qty,
        cl.salePriceAtSale,
        cl.purchasePriceAtSale,
        cl.packagingCostAtSale,
        cl.platformDiscountPercentAtSale,
        cl.unitDiscountValue,
        0, // عمود شحن الوحدة القديم - مهمل
        cl.unitNet,
        cl.unitProfit,
        cl.barcodeAtSale,
        cl.taxRateAtSale,
        cl.unitTaxAmount,
        cl.unitPickupFee,
        cl.totalPickupFee,
        cl.baseUnitPrice,
        cl.bnplPercent,
        cl.bnplUnitAmount,
        cl.customerUnitPrice,
        cl.bnplDeductionUnit,
        cl.totalBnplDeduction,
        cl.itemPrintNameAtSale || ''
      ]);

      var newWhBalanceAfterSale = 0;
      if (cl.rowIndex > 0 && itemMap[cl.itemId]) {
        var saleAdj = adjustItemWarehouseDeltaGS(ss, cl.itemId, resolvedWarehouse.id, -cl.qty, isoDate);
        newWhBalanceAfterSale = saleAdj.balanceAfter;
        var totalStockAfterSale = recomputeItemTotalStockGS(ss, cl.itemId, sItems);
        itemMap[cl.itemId].currentStock = totalStockAfterSale;
      }
      if (sMovementsSale) {
        sMovementsSale.appendRow(buildRowWithWarehouseGS(sMovementsSale, [
          generateUUID(),
          cl.itemId,
          cl.name,
          'بيع',
          -cl.qty,
          newWhBalanceAfterSale,
          'فاتورة بيع رقم ' + invoiceNumber,
          invoiceNumber,
          saleActorName,
          isoDate,
          payload.notes || ''
        ], resolvedWarehouse.id));
      }
    }

    var bnplPercentApplied = 0;
    if (!isBnplDisabled) {
      if (bnplPercentOverrideVal !== undefined) {
        bnplPercentApplied = bnplPercentOverrideVal;
      } else {
        var foundLineBnpl = undefined;
        for (var bIdx = 0; bIdx < calculatedLines.length; bIdx++) {
          if (calculatedLines[bIdx].bnplPercent > 0) {
            foundLineBnpl = calculatedLines[bIdx].bnplPercent;
            break;
          }
        }
        bnplPercentApplied = foundLineBnpl !== undefined
          ? foundLineBnpl
          : ((payload.bnplEnabled === true || platformBnpl) ? Number(platformBnplPct || 0) : 0);
      }
    }
    var commissionPercentApplied = platformDiscountPercent;
    var finalNeedsReview = isOfflineMode ? (Boolean(payload.needsReview) || reviewReasonsList.length > 0) : false;

    sInvoices.appendRow(buildInvoiceSheetRowGS(sInvoices, [
      invoiceNumber,
      isoDate,
      platformName,
      totalBeforeDiscount,
      totalDiscount,
      '', // مصاريف الشحن - عمود قديم مهمل
      netAmount,
      totalProfit,
      invoiceStatus,
      payload.notes || '',
      session.phone ? (session.phone + ' (' + session.role + ')') : (payload.createdBy || 'كاشير'),
      totalTax,
      totalPickupFee,
      '', // معدلة
      '', // تاريخ آخر تعديل
      deliveryFee,
      totalBnplAmount,
      paymentType,
      creditPartyType || '',
      creditPartyId || payload.customerId || '',
      creditPartyName || payload.customerName || '',
      creditDueAmount !== undefined ? creditDueAmount : '',
      paidAmount,
      remainingAmount,
      creditStatus || '',
      bnplPercentApplied,
      commissionPercentApplied
    ], reqIdemKey, isOfflineMode ? {
      isOffline: true,
      offlineDeviceId: offlineDeviceId,
      offlineProvisionalNo: offlineProvisionalNo,
      deviceTime: deviceTimeStr || isoDate,
      needsReview: finalNeedsReview,
      reviewReasons: reviewReasonsList
    } : null, resolvedWarehouse.id));

    // تسجيل حركة سجل الطرف للفاتورة الآجلة (دون أي حركة في الخزنة)
    if (isCredit && creditPartyType && creditPartyId && creditDueAmount !== undefined) {
      var sPartyLedger = getOrCreateSheet(ss, SHEETS.PARTY_LEDGER);
      ensureSheetWithHeaders(ss, SHEETS.PARTY_LEDGER, [
        'ID', 'التاريخ والوقت', 'نوع الطرف', 'معرّف الطرف', 'اسم الطرف', 'نوع المعاملة',
        'رقم المستند / المرجع', 'مدين (عليه)', 'دائن (له)', 'الرصيد بعد الحركة',
        'البيان / الشرح', 'المستخدم', 'ملاحظات', 'idempotencyKey'
      ]);
      var prevPartyBal = computePartyBalanceGS(ss, creditPartyType, creditPartyId);
      var newPartyBal = Math.round((prevPartyBal + creditDueAmount) * 100) / 100;
      var actorLabel = session.phone || payload.createdBy || 'كاشير';
      var ledgerId = generateUUID();
      var stmt = creditPartyType === 'customer'
        ? ('فاتورة مبيعات آجلة على العميل رقم ' + invoiceNumber + ' (إجمالي الفاتورة)')
        : ('فاتورة مبيعات آجلة على المنصة رقم ' + invoiceNumber + ' (الصافي المستحق)');

      sPartyLedger.appendRow([
        ledgerId,
        isoDate,
        creditPartyType,
        creditPartyId,
        creditPartyName || '',
        'فاتورة آجل',
        invoiceNumber,
        creditDueAmount,
        0,
        newPartyBal,
        stmt,
        actorLabel,
        payload.notes || ''
      ]);

      if (creditPartyType === 'customer') {
        var sCustLedger = getOrCreateSheet(ss, SHEETS.CUSTOMER_LEDGER);
        sCustLedger.appendRow([
          ledgerId,
          isoDate,
          creditPartyId,
          creditPartyName || '',
          'فاتورة مبيعات آجلة',
          invoiceNumber,
          creditDueAmount,
          0,
          newPartyBal,
          stmt,
          actorLabel,
          payload.notes || ''
        ]);
        var sCustomersSheet = ss.getSheetByName(SHEETS.CUSTOMERS);
        if (sCustomersSheet && sCustomersSheet.getLastRow() > 1) {
          var cRows = sCustomersSheet.getDataRange().getValues();
          for (var cr = 1; cr < cRows.length; cr++) {
            if (String(cRows[cr][0]) === String(creditPartyId)) {
              sCustomersSheet.getRange(cr + 1, 13).setValue(newPartyBal);
              break;
            }
          }
        }
      }
    }

    if (isOfflineMode) {
      logAudit(
        session,
        'OFFLINE_INVOICE_SYNC',
        'Invoice',
        invoiceNumber,
        'رفع فاتورة مسجلة بدون إنترنت (أوفلاين): ' +
          invoiceNumber +
          (offlineProvisionalNo ? ' | الرقم المؤقت: ' + offlineProvisionalNo : '') +
          (offlineDeviceId ? ' | الجهاز: ' + offlineDeviceId : '') +
          (finalNeedsReview ? ' | تحتاج مراجعة (' + reviewReasonsList.join('، ') + ')' : '')
      );
    } else {
      logAudit(session, 'INVOICE_CREATE', 'Invoice', invoiceNumber, 'إصدار فاتورة: ' + invoiceNumber + ' (' + paymentType + ') بقيمة صافية: ' + netAmount);
    }

    var canViewProfit = session.role === 'designer' || (session.permissions && session.permissions.indexOf('reports.view_profit') !== -1);
    var canViewPurchase = session.role === 'designer' || (session.permissions && session.permissions.indexOf('prices.view_purchase') !== -1);

    return {
      success: true,
      invoiceNumber: invoiceNumber,
      finalInvoiceNumber: invoiceNumber,
      provisionalInvoiceNumber: offlineProvisionalNo || undefined,
      invoice: {
        id: invoiceNumber,
        invoiceNumber: invoiceNumber,
        date: isoDate,
        receivedAt: isoDate,
        platformId: platformId,
        platformName: platformName,
        platform: platformName,
        warehouseId: resolvedWarehouse.id,
        warehouseName: resolvedWarehouse.name,
        customerId: creditPartyType === 'customer' ? creditPartyId : payload.customerId,
        customerName: creditPartyType === 'customer' ? creditPartyName : payload.customerName,
        paymentType: paymentType,
        creditPartyType: creditPartyType,
        creditPartyId: creditPartyId,
        creditPartyName: creditPartyName,
        creditDueAmount: creditDueAmount,
        creditStatus: creditStatus,
        paidAmount: paidAmount,
        remainingAmount: remainingAmount,
        totalBeforeDiscount: totalBeforeDiscount,
        bnplTotalAmount: totalBnplAmount,
        bnplEnabled: !isBnplDisabled && (Boolean(payload.bnplEnabled) || totalBnplAmount > 0 || Boolean(platformBnpl)),
        bnplPercentApplied: bnplPercentApplied,
        commissionPercentApplied: commissionPercentApplied,
        discountAmount: totalDiscount,
        pickupFeeAmount: totalPickupFee,
        deliveryFee: deliveryFee,
        taxAmount: totalTax,
        netAmount: netAmount,
        profit: canViewProfit ? totalProfit : undefined,
        status: invoiceStatus,
        notes: payload.notes || '',
        createdBy: payload.createdBy || session.phone || 'كاشير',
        idempotencyKey: reqIdemKey,
        isOffline: isOfflineMode ? true : undefined,
        offlineDeviceId: offlineDeviceId || undefined,
        deviceId: offlineDeviceId || undefined,
        offlineProvisionalNo: offlineProvisionalNo || undefined,
        deviceTime: isOfflineMode ? (deviceTimeStr || isoDate) : undefined,
        needsReview: isOfflineMode ? finalNeedsReview : undefined,
        reviewReasons: isOfflineMode ? reviewReasonsList : undefined,
        lines: calculatedLines.map(function(cl) {
          return {
            invoiceNumber: invoiceNumber,
            itemId: cl.itemId,
            itemNameAtSale: cl.name,
            itemPrintNameAtSale: cl.itemPrintNameAtSale || '',
            quantity: cl.qty,
            salePriceAtSale: cl.salePriceAtSale,
            baseUnitPrice: cl.baseUnitPrice,
            customerUnitPrice: cl.customerUnitPrice,
            bnplPercent: cl.bnplPercent,
            bnplUnitAmount: cl.bnplUnitAmount,
            totalBnplAmount: cl.totalBnplAmount,
            bnplDeductionUnit: cl.bnplDeductionUnit,
            totalBnplDeduction: cl.totalBnplDeduction,
            purchasePriceAtSale: canViewPurchase ? cl.purchasePriceAtSale : undefined,
            packagingCostAtSale: canViewPurchase ? cl.packagingCostAtSale : undefined,
            taxRateAtSale: cl.taxRateAtSale,
            unitTaxAmount: cl.unitTaxAmount,
            platformDiscountPercentAtSale: cl.platformDiscountPercentAtSale,
            unitDiscountValue: cl.unitDiscountValue,
            unitPickupFee: cl.unitPickupFee,
            totalPickupFee: cl.totalPickupFee,
            unitNet: cl.unitNet,
            unitProfit: canViewProfit ? cl.unitProfit : undefined
          };
        })
      },
      message: isOfflineMode
        ? 'تم رفع الفاتورة المسجلة بدون إنترنت وحفظها بنجاح'
        : 'تم تسجيل الفاتورة وحفظ لقطة الأسعار وتحديث المخزون بنجاح'
    };
  });
}

/**
 * استقبال ومزامنة عملية مسجلة بدون إنترنت (أوفلاين)
 */
function syncOfflineOperation(payload, session) {
  if (!payload || typeof payload !== 'object') {
    return { success: false, statusCode: 400, error: 'بيانات العملية التالفة: الطلب فارغ أو غير صالح' };
  }
  var innerPayload = (payload.payload && typeof payload.payload === 'object') ? payload.payload : payload;
  var opType = String(
    payload.type ||
    payload.operationType ||
    innerPayload.type ||
    innerPayload.operationType ||
    (Array.isArray(innerPayload.invoiceNumbers) ? 'collectCredit' : 'createInvoice')
  ).trim();

  var mergedPayload = {};
  for (var k in innerPayload) {
    if (Object.prototype.hasOwnProperty.call(innerPayload, k)) {
      mergedPayload[k] = innerPayload[k];
    }
  }
  mergedPayload.isOfflineSync = true;
  mergedPayload.isOffline = true;
  mergedPayload.idempotencyKey = payload.idempotencyKey || innerPayload.idempotencyKey;
  mergedPayload.offlineDeviceId = payload.offlineDeviceId || payload.deviceId || innerPayload.offlineDeviceId || innerPayload.deviceId || '';
  mergedPayload.deviceTime = payload.deviceTime || innerPayload.deviceTime || payload.createdAt || innerPayload.createdAt || '';
  mergedPayload.userId = payload.userId || innerPayload.userId || (session && session.userId) || '';
  mergedPayload.createdBy = payload.userName || innerPayload.userName || innerPayload.createdBy || (session && session.phone) || 'كاشير';
  if (payload.needsReview !== undefined) {
    mergedPayload.needsReview = Boolean(payload.needsReview);
  }
  if (payload.userSuspended !== undefined) {
    mergedPayload.userSuspended = Boolean(payload.userSuspended);
  }

  if (opType === 'authAudit' || opType === 'OFFLINE_LOGIN' || opType === 'OFFLINE_LOGOUT') {
    var auditAction = (opType === 'OFFLINE_LOGOUT' || mergedPayload.auditAction === 'OFFLINE_LOGOUT' || mergedPayload.operationType === 'OFFLINE_LOGOUT')
      ? 'OFFLINE_LOGOUT'
      : 'OFFLINE_LOGIN';
    var actorId = String(mergedPayload.userId || (session && session.userId) || 'offline-user');
    var actorName = String(mergedPayload.userName || mergedPayload.username || mergedPayload.createdBy || (session && session.name) || 'مستخدم');
    var actorRole = String(mergedPayload.userRole || (session && session.role) || 'employee');
    var devId = String(mergedPayload.offlineDeviceId || mergedPayload.deviceId || '');
    var devName = String(mergedPayload.deviceName || devId || 'جهاز محلي');
    var devTime = String(mergedPayload.deviceTime || new Date().toISOString());

    logAudit(
      { id: actorId, name: actorName, role: actorRole },
      auditAction,
      'Session',
      actorId,
      (auditAction === 'OFFLINE_LOGIN' ? 'تسجيل دخول بدون إنترنت' : 'تسجيل خروج بدون إنترنت') +
        ' للمستخدم (' + actorName + ') على الجهاز (' + devName + (devId ? ' - ' + devId : '') + ') بوقت الجهاز (' + devTime + ')'
    );
    return {
      success: true,
      auditAction: auditAction
    };
  }

  if (opType === 'updatePermissions' || opType === 'updateUserPermissions') {
    return updateUserPermissions(mergedPayload, session);
  }

  if (opType === 'collectCredit' || opType === 'collectCreditInvoices') {
    return collectCreditInvoicesData(mergedPayload, session);
  }

  if (opType !== 'createInvoice') {
    return { success: false, statusCode: 400, error: 'نوع العملية غير مدعوم للمزامنة: ' + opType };
  }

  mergedPayload.offlineProvisionalNo =
    payload.offlineProvisionalNo ||
    payload.tempInvoiceNumber ||
    payload.invoiceNumber ||
    innerPayload.offlineProvisionalNo ||
    innerPayload.tempInvoiceNumber ||
    innerPayload.invoiceNumber ||
    '';
  return createInvoice(mergedPayload, session);
}

/**
 * اعتماد مراجعة فاتورة أوفلاين تحتاج مراجعة (تمت المراجعة) مع ملاحظة المراجع
 */
function markOfflineInvoiceReviewedGS(payload, session) {
  return withScriptLock(function() {
    var invNum = String((payload && (payload.invoiceNumber || payload.id)) || '').trim();
    var reviewNote = String((payload && (payload.reviewNote || payload.note)) || '').trim();
    if (!invNum) {
      return { success: false, statusCode: 400, error: 'رقم الفاتورة مطلوب لاعتماد المراجعة' };
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sInvoices = ensureSheetWithHeaders(ss, SHEETS.INVOICES, [
      'رقم الفاتورة', 'التاريخ', 'المنصة', 'الإجمالي قبل الخصم', 'قيمة الخصم', 'مصاريف الشحن',
      'الصافي', 'الربح', 'الحالة', 'ملاحظات', 'المستخدم الذي أنشأ الفاتورة', 'إجمالي الضريبة',
      'إجمالي رسوم الالتقاط', 'معدلة', 'تاريخ آخر تعديل', 'رسوم التوصيل', 'إجمالي خصم BNPL',
      'نوع الدفع', 'نوع طرف الآجل', 'معرّف الطرف', 'اسم الطرف', 'مبلغ الاستحقاق',
      'المبلغ المدفوع', 'المبلغ المتبقي', 'حالة الآجل',
      'نسبة BNPL المطبقة', 'نسبة عمولة المنصة المطبقة', 'idempotencyKey',
      'offlineDeviceId', 'offlineProvisionalNo', 'deviceTime', 'needsReview', 'reviewReasons',
      'reviewedAt', 'reviewedBy', 'reviewNote'
    ]);
    var sLines = ss.getSheetByName(SHEETS.INVOICE_LINES);
    var data = sInvoices.getDataRange().getValues();
    var hMap = getHeaderMap(sInvoices);
    var colNeedsReview = hMap.get('needsReview', 31);
    var colReviewedAt = hMap.get('reviewedAt', 33);
    var colReviewedBy = hMap.get('reviewedBy', 34);
    var colReviewNote = hMap.get('reviewNote', 35);

    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      var rowInvNum = String(r[0] || '').trim();
      var rowProvNo = (r.length > 29 && r[29] !== undefined) ? String(r[29]).trim() : '';
      if (rowInvNum === invNum || (rowProvNo && rowProvNo === invNum)) {
        var rowIndex = i + 1;
        var nowIso = new Date().toISOString();
        var reviewerName = (session && (session.name || session.phone)) || (payload && payload.reviewedBy) || 'المدير';

        sInvoices.getRange(rowIndex, colNeedsReview + 1).setValue('لا');
        sInvoices.getRange(rowIndex, colReviewedAt + 1).setValue(nowIso);
        sInvoices.getRange(rowIndex, colReviewedBy + 1).setValue(reviewerName);
        sInvoices.getRange(rowIndex, colReviewNote + 1).setValue(reviewNote);

        var updatedRow = sInvoices.getRange(rowIndex, 1, 1, sInvoices.getLastColumn()).getValues()[0];
        var updatedInv = buildInvoiceFromRowGS(sLines, updatedRow, updatedRow[27], session);
        updatedInv.needsReview = false;
        updatedInv.reviewedAt = nowIso;
        updatedInv.reviewedBy = reviewerName;
        updatedInv.reviewNote = reviewNote;

        logAudit(
          session,
          'OFFLINE_INVOICE_REVIEWED',
          'Invoice',
          updatedInv.invoiceNumber,
          'تمت مراجعة فاتورة الأوفلاين رقم (' + updatedInv.invoiceNumber + ')' +
            (reviewNote ? ' — ملاحظة المراجعة: ' + reviewNote : '')
        );

        return {
          success: true,
          invoice: updatedInv,
          message: 'تم اعتماد مراجعة الفاتورة بنجاح'
        };
      }
    }

    return { success: false, statusCode: 404, error: 'الفاتورة غير موجودة' };
  });
}

/**
 * تعديل فاتورة بعد الحفظ مع حفظ قيود المخزون وسجل التدقيق ولقطة BNPL
 */
function editInvoice(payload, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var sInvoices = ensureSheetWithHeaders(ss, SHEETS.INVOICES, [
      'رقم الفاتورة', 'التاريخ', 'المنصة', 'الإجمالي قبل الخصم', 'قيمة الخصم', 'مصاريف الشحن',
      'الصافي', 'الربح', 'الحالة', 'ملاحظات', 'المستخدم الذي أنشأ الفاتورة', 'إجمالي الضريبة',
      'إجمالي رسوم الالتقاط', 'معدلة', 'تاريخ آخر تعديل', 'رسوم التوصيل', 'إجمالي خصم BNPL',
      'نوع الدفع', 'نوع طرف الآجل', 'معرّف الطرف', 'اسم الطرف', 'مبلغ الاستحقاق',
      'المبلغ المدفوع', 'المبلغ المتبقي', 'حالة الآجل',
      'نسبة BNPL المطبقة', 'نسبة عمولة المنصة المطبقة', 'idempotencyKey',
      'offlineDeviceId', 'offlineProvisionalNo', 'deviceTime', 'needsReview', 'reviewReasons',
      'reviewedAt', 'reviewedBy', 'reviewNote', 'warehouseId'
    ]);
    var sLines = ss.getSheetByName(SHEETS.INVOICE_LINES);
    var sItems = ss.getSheetByName(SHEETS.ITEMS);
    var sPlatforms = ss.getSheetByName(SHEETS.PLATFORMS);

    var invNum = payload.invoiceNumber;
    var editReason = payload.editReason || 'تعديل معتمد';

    var invData = sInvoices.getDataRange().getValues();
    var invRow = -1;
    var oldInvRow = null;
    for (var i = 1; i < invData.length; i++) {
      if (String(invData[i][0]) === invNum) {
        invRow = i + 1;
        oldInvRow = invData[i];
        break;
      }
    }
    if (invRow === -1) return { success: false, error: 'الفاتورة غير موجودة: ' + invNum };

    var hInvMap = getHeaderMap(sInvoices);
    var colInvWh = hInvMap.get('warehouseId', 36);
    var oldWhId = (colInvWh !== -1 && oldInvRow.length > colInvWh && String(oldInvRow[colInvWh] || '').trim() !== '')
      ? String(oldInvRow[colInvWh]).trim()
      : 'wh-main';
    var oldWhRes = resolveWarehouseForOperationGS(ss, oldWhId, session, {
      requireActive: false,
      enforceUserAccess: false
    });
    var oldWh = oldWhRes.ok ? oldWhRes.warehouse : { id: 'wh-main', name: 'المخزن الرئيسي' };

    var requestedTargetWhId = payload.warehouseId ? String(payload.warehouseId).trim() : oldWh.id;
    var targetWhRes = resolveWarehouseForOperationGS(ss, requestedTargetWhId, session, {
      requireActive: true,
      enforceUserAccess: true
    });
    if (!targetWhRes.ok) {
      return { success: false, statusCode: targetWhRes.statusCode || 400, error: targetWhRes.error };
    }
    var targetWh = targetWhRes.warehouse;

    // المنصة وعمولتها وBNPL
    var platformName = payload.platformName || payload.platform || String(oldInvRow[2]);
    var platformId = payload.platformId || '';
    var platformDiscountPercent = 0;
    var platformPickupFee = 0;
    var platformBnpl = false;
    var platformBnplPct = 0;
    var platformPickupFeeMode = 'platform';

    if (sPlatforms && sPlatforms.getLastRow() > 1) {
      var hPlat = getHeaderMap(sPlatforms);
      var colPlatPickupMode = hPlat.get('طريقة رسوم الالتقاط', 8);
      var pData = sPlatforms.getDataRange().getValues();
      for (var p = 1; p < pData.length; p++) {
        var rowPlatId = String(pData[p][0]);
        var rowPlatName = String(pData[p][1]);
        if (rowPlatId === platformId || rowPlatName.toLowerCase() === platformName.toLowerCase()) {
          platformDiscountPercent = Number(pData[p][2]) || 0;
          platformName = rowPlatName;
          platformPickupFee = Math.max(0, Number(pData[p][5]) || 0);
          platformBnpl = pData[p][6] === true || String(pData[p][6]).toLowerCase() === 'true' || String(pData[p][6]).trim() === 'نعم';
          platformBnplPct = Number(pData[p][7]) || 0;
          var rawPlatMode = colPlatPickupMode !== -1 && colPlatPickupMode < pData[p].length ? String(pData[p][colPlatPickupMode] || '').trim() : '';
          platformPickupFeeMode = (rawPlatMode === 'product' || rawPlatMode === 'حسب الصنف') ? 'product' : 'platform';
          break;
        }
      }
    }
    var isDesigner = session && session.role === 'designer';
    var canEditPosRates = isDesigner || Boolean(session && session.permissions && session.permissions.indexOf('pos.edit_rates') !== -1);

    var hasBnplPercentOverride = payload.bnplPercentOverride !== undefined && payload.bnplPercentOverride !== null && payload.bnplPercentOverride !== '';
    var hasCommissionPercentOverride = payload.commissionPercentOverride !== undefined && payload.commissionPercentOverride !== null && payload.commissionPercentOverride !== '';
    var hasLegacyDiscountOverride = payload.platformDiscountPercentage !== undefined && payload.platformDiscountPercentage !== null && payload.platformDiscountPercentage !== '' && Number(payload.platformDiscountPercentage) !== Number(platformDiscountPercent || 0);

    if ((hasBnplPercentOverride || hasCommissionPercentOverride || hasLegacyDiscountOverride) && !canEditPosRates) {
      return { success: false, error: 'غير مصرح: لا تملك صلاحية تعديل نسبة BNPL أو نسبة خصم المنصة في نقطة البيع' };
    }

    var bnplPercentOverrideVal = undefined;
    if (hasBnplPercentOverride) {
      var parsedBnpl = Number(payload.bnplPercentOverride);
      if (isNaN(parsedBnpl) || parsedBnpl < 0 || parsedBnpl > 100) {
        return { success: false, error: 'نسبة BNPL يجب أن تكون قيمة رقمية بين 0 و 100' };
      }
      bnplPercentOverrideVal = parsedBnpl;
    }

    var commissionPercentOverrideVal = undefined;
    if (hasCommissionPercentOverride) {
      var parsedComm = Number(payload.commissionPercentOverride);
      if (isNaN(parsedComm) || parsedComm < 0 || parsedComm > 100) {
        return { success: false, error: 'نسبة خصم المنصة يجب أن تكون قيمة رقمية بين 0 و 100' };
      }
      commissionPercentOverrideVal = parsedComm;
    }

    if (commissionPercentOverrideVal !== undefined) {
      platformDiscountPercent = commissionPercentOverrideVal;
    } else if (payload.platformDiscountPercentage !== undefined && payload.platformDiscountPercentage !== null && payload.platformDiscountPercentage !== '') {
      platformDiscountPercent = Number(payload.platformDiscountPercentage);
    } else if (oldInvRow.length > 26 && oldInvRow[26] !== undefined && oldInvRow[26] !== '' && platformName === String(oldInvRow[2])) {
      platformDiscountPercent = Number(oldInvRow[26]);
    }

    if (isNaN(platformDiscountPercent) || platformDiscountPercent < 0 || platformDiscountPercent > 100) {
      return { success: false, error: 'نسبة خصم المنصة يجب أن تكون قيمة رقمية بين 0 و 100' };
    }

    var isBnplDisabled = payload.bnplEnabled === false;

    var itemData = sItems.getDataRange().getValues();
    var hItems = getHeaderMap(sItems);
    var colItemTax = hItems.get('نسبة الضريبة', 12);
    var colItemBnpl = hItems.get('تفعيل BNPL', -1);
    var colItemBnplPct = hItems.get('نسبة BNPL', -1);
    var colItemPlatforms = hItems.get('معرفات المنصات المتاحة', -1);
    var colItemPickupFee = hItems.get('رسوم الالتقاط للقطعة', -1);
    var colItemPrintName = hItems.get('اسم الطباعة', -1);

    var itemMap = {};
    for (var k = 1; k < itemData.length; k++) {
      var isItemBnpl = colItemBnpl !== -1 ? (itemData[k][colItemBnpl] === true || String(itemData[k][colItemBnpl]).toLowerCase() === 'true' || String(itemData[k][colItemBnpl]).trim() === 'نعم') : false;
      var itBnplPct = colItemBnplPct !== -1 ? (Number(itemData[k][colItemBnplPct]) || 0) : 0;
      var itTaxRate = colItemTax !== -1 ? (Number(itemData[k][colItemTax]) || 0) : 0;
      var rawItPickup = colItemPickupFee !== -1 ? colVal(itemData[k], colItemPickupFee, '') : '';
      var itPickupFee = (rawItPickup !== '' && rawItPickup !== null && rawItPickup !== undefined && Number(rawItPickup) > 0)
        ? Number(rawItPickup)
        : undefined;
      var itPrintName = colItemPrintName !== -1 ? String(colVal(itemData[k], colItemPrintName, '')).trim().slice(0, 120) : '';

      var platIdsRaw = colItemPlatforms !== -1 ? String(colVal(itemData[k], colItemPlatforms, '')).trim() : '';
      var platIds = [];
      if (platIdsRaw) {
        try {
          if (platIdsRaw.charAt(0) === '[') platIds = JSON.parse(platIdsRaw);
          else platIds = platIdsRaw.split(',').map(function(s){return s.trim();}).filter(Boolean);
        } catch(e) {
          platIds = platIdsRaw.split(',').map(function(s){return s.trim();}).filter(Boolean);
        }
      }

      itemMap[String(itemData[k][0])] = {
        rowIndex: k + 1,
        name: String(itemData[k][1]),
        printName: itPrintName,
        salePrice: Number(itemData[k][3]) || 0,
        purchasePrice: Number(itemData[k][4]) || 0,
        packagingCost: Number(itemData[k][5]) || 0,
        currentStock: Number(itemData[k][6]) || 0,
        taxRate: itTaxRate,
        enableBnpl: isItemBnpl,
        bnplPercentage: itBnplPct,
        pickupFee: itPickupFee,
        platformIds: platIds
      };
    }

    var checkLines = payload.lines || [];
    for (var chkEditIdx = 0; chkEditIdx < checkLines.length; chkEditIdx++) {
      var chkLn = checkLines[chkEditIdx];
      var chkItId = String(chkLn.itemId);
      var chkItInfo = itemMap[chkItId];
      if (chkItInfo && platformId && Array.isArray(chkItInfo.platformIds) && chkItInfo.platformIds.length > 0) {
        if (chkItInfo.platformIds.indexOf(platformId) === -1) {
          return {
            success: false,
            error: 'الصنف "' + chkItInfo.name + '" غير متاح للبيع على منصة "' + platformName + '"'
          };
        }
      }
    }

    // جمع الأسطر القديمة للفاتورة للتحقق من الرصيد قبل أي تعديل فعلي
    var oldLinesRowsToDelete = [];
    var oldLinesList = [];
    var oldQtyByItem = {};
    if (sLines && sLines.getLastRow() > 1) {
      var lData = sLines.getDataRange().getValues();
      for (var ol = 1; ol < lData.length; ol++) {
        if (String(lData[ol][0]) === invNum) {
          var oItemId = String(lData[ol][1]);
          var oName = String(lData[ol][2] || (itemMap[oItemId] ? itemMap[oItemId].name : 'صنف'));
          var oQty = Number(lData[ol][3]) || 0;
          oldLinesRowsToDelete.push(ol + 1);
          oldLinesList.push({ itemId: oItemId, name: oName, qty: oQty });
          oldQtyByItem[oItemId] = (oldQtyByItem[oItemId] || 0) + oQty;
        }
      }
    }

    var settingsMap = getSettingsMap();
    var stockSettingsEdit = settingsMap.stockSettings || { allowNegativeStockSale: false };
    var allowNegativeEdit = Boolean(stockSettingsEdit.allowNegativeStockSale);

    var reqNewQtyByItem = {};
    for (var nqIdx = 0; nqIdx < checkLines.length; nqIdx++) {
      var nqLn = checkLines[nqIdx];
      var nqItemId = String(nqLn.itemId);
      var nqVal = Number(nqLn.quantity || 1);
      reqNewQtyByItem[nqItemId] = (reqNewQtyByItem[nqItemId] || 0) + nqVal;
    }

    if (!allowNegativeEdit) {
      for (var checkItemId in reqNewQtyByItem) {
        var checkItemInfo = itemMap[checkItemId];
        if (!checkItemInfo) {
          return { success: false, error: 'الصنف غير مسجل بقاعدة البيانات: ' + checkItemId };
        }
        var curWhAvail = getItemWarehouseStockGS(ss, checkItemId, targetWh.id);
        var effectiveWhAvail = curWhAvail + (oldWh.id === targetWh.id ? (oldQtyByItem[checkItemId] || 0) : 0);
        var neededQty = reqNewQtyByItem[checkItemId];
        if (effectiveWhAvail < neededQty) {
          return {
            success: false,
            error: 'الكمية غير متوفرة للصنف "' + checkItemInfo.name + '" في مخزن "' + targetWh.name + '". المتاح: ' + effectiveWhAvail
          };
        }
      }
    }

    var nowIso = new Date().toISOString();
    var editActor = (session && (session.name || session.phone)) || 'المسؤول';
    var sMovementsEdit = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
      'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
      'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
    ]);
    var affectedEditItems = {};

    // إرجاع كميات المخزون القديمة إلى مخزن الفاتورة القديم وحذف الأسطر القديمة
    for (var revIdx = 0; revIdx < oldLinesList.length; revIdx++) {
      var oldLineEntry = oldLinesList[revIdx];
      if (oldLineEntry.qty > 0 && itemMap[oldLineEntry.itemId]) {
        var revAdj = adjustItemWarehouseDeltaGS(ss, oldLineEntry.itemId, oldWh.id, oldLineEntry.qty, nowIso);
        affectedEditItems[oldLineEntry.itemId] = true;
        if (sMovementsEdit) {
          sMovementsEdit.appendRow(buildRowWithWarehouseGS(sMovementsEdit, [
            generateUUID(),
            oldLineEntry.itemId,
            oldLineEntry.name,
            'تعديل فاتورة - استرجاع',
            oldLineEntry.qty,
            revAdj.balanceAfter,
            'استرجاع لتعديل الفاتورة (' + editReason + ')',
            invNum,
            editActor,
            nowIso,
            editReason
          ], oldWh.id));
        }
      }
    }
    if (oldLinesRowsToDelete.length > 0 && sLines) {
      deleteRowsDescendingBatch(sLines, oldLinesRowsToDelete);
    }

    var rawTaxSettings = (payload && payload.taxSettings) || settingsMap.taxSettings || {};
    var taxSettings = {
      taxInclusive: rawTaxSettings.taxInclusive !== undefined ? Boolean(rawTaxSettings.taxInclusive) : true,
      platformCommissionOn: rawTaxSettings.platformCommissionOn || 'before_tax'
    };

    var newLines = payload.lines || [];
    var deliveryFee = Number(payload.deliveryFee !== undefined ? payload.deliveryFee : oldInvRow[15]) || 0;
    var totalBeforeDiscount = 0;
    var totalBnplAmount = 0;
    var totalDiscount = 0;
    var totalPickupFee = 0;
    var totalTax = 0;
    var totalCostSum = 0;
    var calculatedLines = [];

    for (var j = 0; j < newLines.length; j++) {
      var ln = newLines[j];
      var lItemId = String(ln.itemId);
      var lQty = Number(ln.quantity || 1);
      var itInfo = itemMap[lItemId];

      var salePriceForUnit = ln.salePriceAtSale !== undefined ? Number(ln.salePriceAtSale) : (itInfo ? itInfo.salePrice : 0);
      var purchasePriceForUnit = ln.purchasePriceAtSale !== undefined ? Number(ln.purchasePriceAtSale) : (itInfo ? itInfo.purchasePrice : 0);
      var packagingCostForUnit = ln.packagingCostAtSale !== undefined ? Number(ln.packagingCostAtSale) : (itInfo ? itInfo.packagingCost : 0);

      var lineBnplPercent = isBnplDisabled
        ? 0
        : (bnplPercentOverrideVal !== undefined
            ? bnplPercentOverrideVal
            : (itInfo && itInfo.enableBnpl && itInfo.bnplPercentage
                ? Number(itInfo.bnplPercentage)
                : (ln.bnplPercent !== undefined && ln.bnplPercent !== null
                    ? Number(ln.bnplPercent)
                    : ((payload.bnplEnabled === true || platformBnpl) && platformBnplPct
                        ? Number(platformBnplPct)
                        : 0))));

      var baseUnitPrice = salePriceForUnit;
      var customerUnitPrice = lineBnplPercent > 0
        ? Math.round(baseUnitPrice * (1 + lineBnplPercent / 100) * 100) / 100
        : baseUnitPrice;
      var bnplUnitAmount = Math.round((customerUnitPrice - baseUnitPrice) * 100) / 100;
      var bnplDeductionUnit = lineBnplPercent > 0
        ? Math.round(customerUnitPrice * (lineBnplPercent / 100) * 100) / 100
        : 0;
      var totalBnplDeduction = bnplDeductionUnit * lQty;

      var resolvedPickupFee = platformPickupFeeMode === 'product'
        ? (itInfo && itInfo.pickupFee !== undefined && itInfo.pickupFee !== null && Number(itInfo.pickupFee) > 0
            ? Number(itInfo.pickupFee)
            : Number(platformPickupFee || 0))
        : Number(platformPickupFee || 0);
      var unitPickupFee = Math.max(0, Number(ln.unitPickupFee !== undefined ? ln.unitPickupFee : resolvedPickupFee));
      var taxRate = Number(ln.taxRateAtSale !== undefined ? ln.taxRateAtSale : (itInfo ? (itInfo.taxRate || 0) : 0));

      var basePriceForUnit = customerUnitPrice;
      var unitTaxAmount = 0;

      if (taxRate > 0) {
        if (taxSettings.taxInclusive) {
          basePriceForUnit = customerUnitPrice / (1 + (taxRate / 100));
          unitTaxAmount = customerUnitPrice - basePriceForUnit;
        } else {
          basePriceForUnit = customerUnitPrice;
          unitTaxAmount = customerUnitPrice * (taxRate / 100);
        }
      }

      // احتساب خصم/عمولة المنصة على سعر العميل (السعر المرفوع عند تفعيل BNPL أو السعر الأساسي بدونه)
      var commissionBase = taxSettings.platformCommissionOn === 'before_tax' ? basePriceForUnit : customerUnitPrice;
      var unitDiscountValue = commissionBase * (platformDiscountPercent / 100);
      var unitNet = customerUnitPrice - bnplDeductionUnit - unitDiscountValue - unitPickupFee;
      var unitRevenueExcludingTax = (customerUnitPrice - unitTaxAmount) - bnplDeductionUnit - unitDiscountValue - unitPickupFee;
      var unitProfit = unitRevenueExcludingTax - purchasePriceForUnit - packagingCostForUnit;

      totalBeforeDiscount += customerUnitPrice * lQty;
      totalBnplAmount += totalBnplDeduction;
      totalDiscount += unitDiscountValue * lQty;
      totalPickupFee += unitPickupFee * lQty;
      totalTax += unitTaxAmount * lQty;
      totalCostSum += (purchasePriceForUnit + packagingCostForUnit) * lQty;

      calculatedLines.push({
        itemId: lItemId,
        name: ln.itemNameAtSale || (itInfo ? itInfo.name : 'صنف'),
        itemPrintNameAtSale: itInfo ? (itInfo.printName || '') : String(ln.itemPrintNameAtSale || '').trim().slice(0, 120),
        qty: lQty,
        salePriceAtSale: baseUnitPrice,
        baseUnitPrice: baseUnitPrice,
        customerUnitPrice: customerUnitPrice,
        bnplPercent: lineBnplPercent,
        bnplUnitAmount: bnplUnitAmount,
        totalBnplAmount: bnplUnitAmount * lQty,
        bnplDeductionUnit: bnplDeductionUnit,
        totalBnplDeduction: totalBnplDeduction,
        purchasePriceAtSale: purchasePriceForUnit,
        packagingCostAtSale: packagingCostForUnit,
        platformDiscountPercentAtSale: platformDiscountPercent,
        unitDiscountValue: unitDiscountValue,
        unitPickupFee: unitPickupFee,
        totalPickupFee: unitPickupFee * lQty,
        unitNet: unitNet,
        unitProfit: unitProfit,
        barcodeAtSale: ln.barcodeAtSale || '',
        taxRateAtSale: taxRate,
        unitTaxAmount: unitTaxAmount,
        rowIndex: itInfo ? itInfo.rowIndex : -1
      });
    }

    var netBeforeDelivery = totalBeforeDiscount - totalBnplAmount - totalDiscount - totalPickupFee;
    var netAmount = Math.round((netBeforeDelivery + deliveryFee) * 100) / 100;
    var totalProfit = netBeforeDelivery - totalTax - totalCostSum;

    ensureSheetWithHeaders(ss, SHEETS.INVOICE_LINES, [
      'رقم الفاتورة', 'الصنف', 'اسم الصنف وقت البيع', 'الكمية', 'سعر البيع وقت البيع',
      'تكلفة الشراء وقت البيع', 'تكلفة التغليف وقت البيع', 'نسبة خصم المنصة وقت البيع',
      'قيمة الخصم للوحدة', 'تكلفة الشحن للوحدة', 'صافي الوحدة', 'ربح الوحدة',
      'الباركود وقت البيع', 'نسبة الضريبة وقت البيع', 'قيمة الضريبة للوحدة',
      'رسوم الالتقاط للوحدة', 'إجمالي رسوم الالتقاط للسطر', 'السعر الأساسي',
      'نسبة BNPL', 'قيمة زيادة BNPL', 'سعر العميل',
      'قيمة استقطاع BNPL للوحدة', 'إجمالي استقطاع BNPL للسطر', 'اسم الطباعة وقت البيع'
    ]);

    // خصم المخزون الجديد وإضافة أسطر الفاتورة
    for (var m = 0; m < calculatedLines.length; m++) {
      var cl = calculatedLines[m];
      sLines.appendRow([
        invNum,
        cl.itemId,
        cl.name,
        cl.qty,
        cl.salePriceAtSale,
        cl.purchasePriceAtSale,
        cl.packagingCostAtSale,
        cl.platformDiscountPercentAtSale,
        cl.unitDiscountValue,
        0, // عمود شحن الوحدة القديم
        cl.unitNet,
        cl.unitProfit,
        cl.barcodeAtSale,
        cl.taxRateAtSale,
        cl.unitTaxAmount,
        cl.unitPickupFee,
        cl.totalPickupFee,
        cl.baseUnitPrice,
        cl.bnplPercent,
        cl.bnplUnitAmount,
        cl.customerUnitPrice,
        cl.bnplDeductionUnit,
        cl.totalBnplDeduction,
        cl.itemPrintNameAtSale || ''
      ]);

      var editLineWhBal = 0;
      if (cl.rowIndex > 0 && itemMap[cl.itemId]) {
        var deductAdj = adjustItemWarehouseDeltaGS(ss, cl.itemId, targetWh.id, -cl.qty, nowIso);
        editLineWhBal = deductAdj.balanceAfter;
        affectedEditItems[cl.itemId] = true;
      }
      if (sMovementsEdit) {
        sMovementsEdit.appendRow(buildRowWithWarehouseGS(sMovementsEdit, [
          generateUUID(),
          cl.itemId,
          cl.name,
          'تعديل فاتورة - بيع',
          -cl.qty,
          editLineWhBal,
          'خصم جديد بعد تعديل الفاتورة (' + editReason + ')',
          invNum,
          editActor,
          nowIso,
          editReason
        ], targetWh.id));
      }
    }

    // إعادة احتساب الإجمالي الكلي للأصناف المتأثرة من أرصدة جميع المخازن
    for (var affId in affectedEditItems) {
      if (Object.prototype.hasOwnProperty.call(affectedEditItems, affId)) {
        var newTot = recomputeItemTotalStockGS(ss, affId, sItems);
        if (itemMap[affId]) itemMap[affId].currentStock = newTot;
      }
    }

    var bnplPercentApplied = 0;
    if (!isBnplDisabled) {
      if (bnplPercentOverrideVal !== undefined) {
        bnplPercentApplied = bnplPercentOverrideVal;
      } else {
        var foundEditLineBnpl = undefined;
        for (var ebIdx = 0; ebIdx < calculatedLines.length; ebIdx++) {
          if (calculatedLines[ebIdx].bnplPercent > 0) {
            foundEditLineBnpl = calculatedLines[ebIdx].bnplPercent;
            break;
          }
        }
        bnplPercentApplied = foundEditLineBnpl !== undefined
          ? foundEditLineBnpl
          : ((payload.bnplEnabled === true || platformBnpl) ? Number(platformBnplPct || 0) : 0);
      }
    }
    var commissionPercentApplied = platformDiscountPercent;

    // تحديث صف الفاتورة
    sInvoices.getRange(invRow, 3).setValue(platformName);
    sInvoices.getRange(invRow, 4).setValue(totalBeforeDiscount);
    sInvoices.getRange(invRow, 5).setValue(totalDiscount);
    sInvoices.getRange(invRow, 7).setValue(netAmount);
    sInvoices.getRange(invRow, 8).setValue(totalProfit);
    sInvoices.getRange(invRow, 10).setValue(payload.notes || '');
    sInvoices.getRange(invRow, 12).setValue(totalTax);
    sInvoices.getRange(invRow, 13).setValue(totalPickupFee);
    sInvoices.getRange(invRow, 14).setValue('نعم');
    sInvoices.getRange(invRow, 15).setValue(nowIso);
    sInvoices.getRange(invRow, 16).setValue(deliveryFee);
    sInvoices.getRange(invRow, 17).setValue(totalBnplAmount);
    sInvoices.getRange(invRow, 26).setValue(bnplPercentApplied);
    sInvoices.getRange(invRow, 27).setValue(commissionPercentApplied);
    var colWhUpd = getHeaderMap(sInvoices).get('warehouseId', 36);
    if (colWhUpd !== -1) {
      sInvoices.getRange(invRow, colWhUpd + 1).setValue(targetWh.id);
    }

    logAudit(session, 'INVOICE_EDIT', 'Invoice', invNum, 'تعديل فاتورة ' + invNum + '. السبب: ' + editReason + ' (صافي جديد: ' + netAmount + ')');

    var canViewProfit = session.role === 'designer' || (session.permissions && session.permissions.indexOf('reports.view_profit') !== -1);
    var canViewPurchase = session.role === 'designer' || (session.permissions && session.permissions.indexOf('prices.view_purchase') !== -1);

    var updatedInv = {
      invoiceNumber: invNum,
      date: String(oldInvRow[1]),
      platform: platformName,
      warehouseId: targetWh.id,
      warehouseName: targetWh.name,
      totalBeforeDiscount: totalBeforeDiscount,
      bnplTotalAmount: totalBnplAmount,
      bnplEnabled: !isBnplDisabled && (Boolean(payload.bnplEnabled) || totalBnplAmount > 0 || Boolean(platformBnpl)),
      bnplPercentApplied: bnplPercentApplied,
      commissionPercentApplied: commissionPercentApplied,
      discountAmount: totalDiscount,
      pickupFeeAmount: totalPickupFee,
      deliveryFee: deliveryFee,
      taxAmount: totalTax,
      netAmount: netAmount,
      profit: canViewProfit ? totalProfit : undefined,
      status: 'تم البيع',
      notes: payload.notes || '',
      createdBy: String(oldInvRow[10]),
      lines: calculatedLines.map(function(cl) {
        return {
          invoiceNumber: invNum,
          itemId: cl.itemId,
          itemNameAtSale: cl.name,
          itemPrintNameAtSale: cl.itemPrintNameAtSale || '',
          quantity: cl.qty,
          salePriceAtSale: cl.salePriceAtSale,
          baseUnitPrice: cl.baseUnitPrice,
          customerUnitPrice: cl.customerUnitPrice,
          bnplPercent: cl.bnplPercent,
          bnplUnitAmount: cl.bnplUnitAmount,
          totalBnplAmount: cl.totalBnplAmount,
          bnplDeductionUnit: cl.bnplDeductionUnit,
          totalBnplDeduction: cl.totalBnplDeduction,
          purchasePriceAtSale: canViewPurchase ? cl.purchasePriceAtSale : undefined,
          packagingCostAtSale: canViewPurchase ? cl.packagingCostAtSale : undefined,
          taxRateAtSale: cl.taxRateAtSale,
          unitTaxAmount: cl.unitTaxAmount,
          platformDiscountPercentAtSale: cl.platformDiscountPercentAtSale,
          unitDiscountValue: cl.unitDiscountValue,
          unitPickupFee: cl.unitPickupFee,
          totalPickupFee: cl.totalPickupFee,
          unitNet: cl.unitNet,
          unitProfit: canViewProfit ? cl.unitProfit : undefined
        };
      })
    };

    return {
      success: true,
      invoice: updatedInv,
      message: 'تم حفظ تعديل الفاتورة وتحديث المخزون بنجاح'
    };
  });
}

/**
 * قراءة الفواتير مع حجب الأرباح والتكاليف عن غير المخوّلين
 */
function getInvoicesFiltered(session, filters) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sInvoices = ss.getSheetByName(SHEETS.INVOICES);
  var sLines = ss.getSheetByName(SHEETS.INVOICE_LINES);

  if (!sInvoices || sInvoices.getLastRow() < 2) return { invoices: [], lines: [] };

  var canViewProfit = session ? (session.role === 'designer' || (session.permissions && session.permissions.indexOf('reports.view_profit') !== -1)) : false;
  var canViewPurchase = session ? (session.role === 'designer' || (session.permissions && session.permissions.indexOf('prices.view_purchase') !== -1)) : false;

  var fromDate = filters ? (filters.from || filters.startDate || null) : null;
  var toDate = filters ? (filters.to || filters.endDate || null) : null;

  var invData = sInvoices.getDataRange().getValues();
  var whLookupInv = getWarehouseLookupMapGS(ss);
  var invoices = [];
  var matchingInvoiceNums = {};

  for (var i = 1; i < invData.length; i++) {
    var r = invData[i];
    var invDateStr = String(r[1]);

    if (fromDate || toDate) {
      if (!isDateInRangeGS(invDateStr, fromDate, toDate)) {
        continue;
      }
    }

    var invNum = String(r[0]);
    matchingInvoiceNums[invNum] = true;

    var invStatus = String(r[8] || 'تم البيع');
    var payType = r[17] ? String(r[17]) : (invStatus === 'معلّقة' ? 'آجل' : 'نقدي');
    var cPartyType = r[18] ? String(r[18]) : undefined;
    var cPartyId = r[19] ? String(r[19]) : undefined;
    var cPartyName = r[20] ? String(r[20]) : undefined;
    var cDueAmount = (r[21] !== undefined && r[21] !== '') ? Number(r[21]) : undefined;
    var cPaidAmount = (r[22] !== undefined && r[22] !== '') ? Number(r[22]) : (payType === 'آجل' ? 0 : (Number(r[6]) || 0));
    var cRemAmount = (r[23] !== undefined && r[23] !== '') ? Number(r[23]) : (payType === 'آجل' ? (cDueAmount || 0) : 0);
    var cStatus = r[24] ? String(r[24]) : (payType === 'آجل' ? (invStatus === 'مسددة' ? 'مسددة' : 'معلّقة') : undefined);

    var inv = {
      id: invNum,
      invoiceNumber: invNum,
      date: invDateStr,
      platformName: String(r[2]),
      platform: String(r[2]),
      totalBeforeDiscount: Number(r[3]) || 0,
      discountAmount: Number(r[4]) || 0,
      deliveryFee: Number(r[15]) || 0,
      bnplTotalAmount: Number(r[16]) || 0,
      netAmount: Number(r[6]) || 0,
      status: invStatus,
      paymentType: payType,
      creditPartyType: cPartyType,
      creditPartyId: cPartyId,
      creditPartyName: cPartyName,
      customerId: cPartyType === 'customer' ? cPartyId : undefined,
      customerName: cPartyType === 'customer' ? cPartyName : undefined,
      creditDueAmount: cDueAmount,
      paidAmount: cPaidAmount,
      remainingAmount: cRemAmount,
      creditStatus: cStatus,
      notes: String(r[9] || ''),
      createdBy: String(r[10] || ''),
      lines: []
    };

    if (r[11] !== undefined && r[11] !== '') {
      inv.taxAmount = Number(r[11]) || 0;
    }

    if (r.length > 25 && r[25] !== undefined && r[25] !== '') {
      inv.bnplPercentApplied = Number(r[25]);
    }
    if (r.length > 26 && r[26] !== undefined && r[26] !== '') {
      inv.commissionPercentApplied = Number(r[26]);
    }
    if (r.length > 27 && r[27] !== undefined && String(r[27]).trim() !== '') {
      inv.idempotencyKey = String(r[27]).trim();
    }
    if (r.length > 28 && r[28] !== undefined && String(r[28]).trim() !== '') {
      inv.offlineDeviceId = String(r[28]).trim();
      inv.deviceId = inv.offlineDeviceId;
      inv.isOffline = true;
    }
    if (r.length > 29 && r[29] !== undefined && String(r[29]).trim() !== '') {
      inv.offlineProvisionalNo = String(r[29]).trim();
      inv.isOffline = true;
    }
    if (r.length > 30 && r[30] !== undefined && String(r[30]).trim() !== '') {
      inv.deviceTime = String(r[30]).trim();
    }
    var explicitNeedsRev = false;
    if (r.length > 31 && r[31] !== undefined && String(r[31]).trim() !== '') {
      var nrStr = String(r[31]).trim().toLowerCase();
      explicitNeedsRev = true;
      inv.needsReview = (r[31] === true || nrStr === 'true' || nrStr === 'نعم' || nrStr === '1');
    }
    if (r.length > 32 && r[32] !== undefined && String(r[32]).trim() !== '') {
      inv.reviewReasons = parseReviewReasonsCellGS(r[32]);
      if (inv.reviewReasons.length > 0 && !explicitNeedsRev) inv.needsReview = true;
    }
    if (r.length > 33 && r[33] !== undefined && String(r[33]).trim() !== '') {
      inv.reviewedAt = String(r[33]).trim();
    }
    if (r.length > 34 && r[34] !== undefined && String(r[34]).trim() !== '') {
      inv.reviewedBy = String(r[34]).trim();
    }
    if (r.length > 35 && r[35] !== undefined && String(r[35]).trim() !== '') {
      inv.reviewNote = String(r[35]).trim();
    }

    var invWhId = (r.length > 36 && r[36] !== undefined && String(r[36]).trim() !== '')
      ? String(r[36]).trim()
      : whLookupInv.defaultId;
    inv.warehouseId = invWhId;
    inv.warehouseName = whLookupInv.byId[invWhId] || whLookupInv.defaultName;

    if (canViewProfit) {
      inv.profit = Number(r[7]) || 0;
    }

    invoices.push(inv);
  }

  var lineData = sLines ? sLines.getDataRange().getValues() : [];
  var lines = [];
  var linesByInvoice = {};

  for (var j = 1; j < lineData.length; j++) {
    var lr = lineData[j];
    var lInvNum = String(lr[0]);

    if (fromDate || toDate) {
      if (!matchingInvoiceNums[lInvNum]) {
        continue;
      }
    }

    var basePriceVal = lr[17] !== undefined && lr[17] !== '' ? Number(lr[17]) : Number(lr[4]) || 0;
    var bnplPctVal = lr[18] !== undefined && lr[18] !== '' ? Number(lr[18]) : 0;
    var bnplUnitVal = lr[19] !== undefined && lr[19] !== '' ? Number(lr[19]) : 0;
    var custPriceVal = lr[20] !== undefined && lr[20] !== '' ? Number(lr[20]) : Number(lr[4]) || 0;
    var hasBnplDedUnit = lr[21] !== undefined && lr[21] !== '';
    var hasTotalBnplDed = lr[22] !== undefined && lr[22] !== '';
    var lineQty = Number(lr[3]) || 1;

    var line = {
      invoiceNumber: lInvNum,
      itemId: String(lr[1]),
      itemNameAtSale: String(lr[2]),
      quantity: lineQty,
      salePriceAtSale: Number(lr[4]) || 0,
      baseUnitPrice: basePriceVal,
      customerUnitPrice: custPriceVal,
      bnplPercent: bnplPctVal,
      bnplUnitAmount: bnplUnitVal,
      totalBnplAmount: bnplUnitVal * lineQty,
      platformDiscountPercentAtSale: Number(lr[7]) || 0,
      unitDiscountValue: Number(lr[8]) || 0,
      unitNet: Number(lr[10]) || 0
    };

    if (hasBnplDedUnit) {
      line.bnplDeductionUnit = Number(lr[21]) || 0;
    }
    if (hasTotalBnplDed) {
      line.totalBnplDeduction = Number(lr[22]) || 0;
    } else if (hasBnplDedUnit) {
      line.totalBnplDeduction = (Number(lr[21]) || 0) * lineQty;
    }
    if (lr[15] !== undefined && lr[15] !== '') {
      line.unitPickupFee = Number(lr[15]) || 0;
    }
    if (lr[16] !== undefined && lr[16] !== '') {
      line.totalPickupFee = Number(lr[16]) || 0;
    }
    if (lr[12] !== undefined && lr[12] !== '') {
      line.barcodeAtSale = String(lr[12]);
    }
    if (lr[13] !== undefined && lr[13] !== '') {
      line.taxRateAtSale = Number(lr[13]) || 0;
    }
    if (lr[14] !== undefined && lr[14] !== '') {
      line.unitTaxAmount = Number(lr[14]) || 0;
    }
    if (lr.length > 23 && lr[23] !== undefined && lr[23] !== '') {
      line.itemPrintNameAtSale = String(lr[23]);
    }

    if (canViewPurchase) {
      line.purchasePriceAtSale = Number(lr[5]) || 0;
      line.packagingCostAtSale = Number(lr[6]) || 0;
    }
    if (canViewProfit) {
      line.unitProfit = Number(lr[11]) || 0;
    }

    lines.push(line);
    if (!linesByInvoice[lInvNum]) {
      linesByInvoice[lInvNum] = [];
    }
    linesByInvoice[lInvNum].push(line);
  }

  for (var k = 0; k < invoices.length; k++) {
    invoices[k].lines = linesByInvoice[invoices[k].invoiceNumber] || [];
  }

  return { invoices: invoices, lines: lines };
}

/**
 * تسجيل مرتجع
 */
function createReturn(payload, session) {
  var reqIdemKey = getValidatedIdempotencyKeyGS(payload);
  if (!reqIdemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR_GS };
  }
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var sReturns = ensureSheetWithHeaders(ss, SHEETS.RETURNS, [
      'رقم المرتجع', 'رقم الفاتورة', 'التاريخ', 'الأصناف المرتجعة أو ملخصها',
      'إجمالي خصم المنصة من الشحن عند المرتجع', 'سبب الرجوع', 'ملاحظات',
      'المستخدم الذي سجل المرتجع', 'idempotencyKey', 'warehouseId'
    ]);
    var sReturnLines = ss.getSheetByName(SHEETS.RETURN_LINES);
    var whLookupRet = getWarehouseLookupMapGS(ss);
    var dupRetMatch = findRowByIdempotencyKeyGS(sReturns, reqIdemKey);
    if (dupRetMatch) {
      var dr = dupRetMatch.rowValues;
      var dupRetNum = String(dr[0]);
      var dupRetWhId = (dr.length > 9 && dr[9] !== undefined && String(dr[9]).trim() !== '')
        ? String(dr[9]).trim()
        : whLookupRet.defaultId;
      var dupRetLines = [];
      if (sReturnLines && sReturnLines.getLastRow() > 1) {
        var rlLastRow = sReturnLines.getLastRow();
        var rlLastCol = sReturnLines.getLastColumn();
        var rlKeys = sReturnLines.getRange(2, 1, rlLastRow - 1, 1).getValues();
        for (var rli = 0; rli < rlKeys.length; rli++) {
          if (String(rlKeys[rli][0]) === dupRetNum) {
            var lr = sReturnLines.getRange(rli + 2, 1, 1, rlLastCol).getValues()[0];
            dupRetLines.push({
              returnNumber: dupRetNum,
              invoiceNumber: String(lr[1]),
              invoiceLineIndex: lr[2],
              itemId: String(lr[3]),
              returnedQuantity: Number(lr[4]) || 0,
              returnShippingDeductionPerUnit: Number(lr[5]) || 0,
              totalLineReturnShippingDeduction: Number(lr[6]) || 0,
              itemCondition: String(lr[7] || 'يرجع المخزن')
            });
          }
        }
      }
      var dupRecord = {
        returnNumber: dupRetNum,
        invoiceNumber: String(dr[1]),
        date: String(dr[2]),
        returnedItemsSummary: String(dr[3]),
        totalReturnShippingDeduction: Number(dr[4]) || 0,
        returnReason: String(dr[5] || ''),
        notes: String(dr[6] || ''),
        createdBy: String(dr[7] || ''),
        idempotencyKey: reqIdemKey,
        warehouseId: dupRetWhId,
        warehouseName: whLookupRet.byId[dupRetWhId] || whLookupRet.defaultName,
        lines: dupRetLines
      };
      return {
        success: true,
        duplicate: true,
        returnNumber: dupRetNum,
        returnRecord: dupRecord,
        message: 'تم استرجاع المرتجع المسجل مسبقاً (منع التكرار)'
      };
    }

    var sInvoices = ss.getSheetByName(SHEETS.INVOICES);
    var sItems = ss.getSheetByName(SHEETS.ITEMS);

    // تحديد المخزن للمرتجع: المخزن المرسل أو مخزن الفاتورة الأصلية أو المخزن الافتراضي
    var origInvoiceWhId = '';
    var invMatchRowIdx = -1;
    if (payload.invoiceNumber && sInvoices && sInvoices.getLastRow() > 1) {
      var invDataForRet = sInvoices.getDataRange().getValues();
      var colInvWhRet = getHeaderMap(sInvoices).get('warehouseId', 36);
      for (var m = 1; m < invDataForRet.length; m++) {
        if (String(invDataForRet[m][0]) === String(payload.invoiceNumber)) {
          invMatchRowIdx = m + 1;
          if (colInvWhRet !== -1 && invDataForRet[m].length > colInvWhRet && String(invDataForRet[m][colInvWhRet] || '').trim() !== '') {
            origInvoiceWhId = String(invDataForRet[m][colInvWhRet]).trim();
          }
          break;
        }
      }
    }

    var hasExplicitRetWh = payload.warehouseId !== undefined && payload.warehouseId !== null && String(payload.warehouseId).trim() !== '';
    var retWhRes = resolveWarehouseForOperationGS(
      ss,
      hasExplicitRetWh ? payload.warehouseId : (origInvoiceWhId || null),
      session,
      hasExplicitRetWh
        ? { requireActive: true, enforceUserAccess: true }
        : { requireActive: false, enforceUserAccess: false }
    );
    if (!retWhRes.ok) {
      return { success: false, statusCode: retWhRes.statusCode || 400, error: retWhRes.error };
    }
    var targetWhRet = retWhRes.warehouse;

    var now = new Date();
    var dateStr = Utilities.formatDate(now, 'GMT+2', 'yyyyMMdd');
    var returnNumber = payload.returnNumber || ('RET-' + dateStr + '-' + Math.floor(1000 + Math.random() * 9000));
    var isoDate = now.toISOString();

    var lines = payload.lines || payload.items || [];
    var totalDeduction = 0;
    var itemsSummary = [];
    var savedReturnLines = [];

    var itemData = sItems ? sItems.getDataRange().getValues() : [];
    var itemMap = {};
    for (var k = 1; k < itemData.length; k++) {
      itemMap[String(itemData[k][0])] = {
        rowIndex: k + 1,
        name: String(itemData[k][1] || ''),
        stock: Number(itemData[k][6]) || 0
      };
    }

    var sMovementsRet = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
      'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
      'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
    ]);
    var retActor = (session && (session.name || session.phone)) || payload.createdBy || 'المسؤول';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var qty = Number(line.returnedQuantity || line.quantity || 1);
      var deductionPerUnit = Number(line.returnShippingDeductionPerUnit || line.refundUnitPrice || 0);
      var lineTotalDeduction = qty * deductionPerUnit;
      totalDeduction += lineTotalDeduction;

      var condition = (line.itemCondition === 'تالف' || line.restockInventory === false) ? 'تالف' : 'يرجع المخزن';
      var itemId = String(line.itemId || line.productId);
      var lineIdx = line.invoiceLineIndex || (i + 1);
      var itemNameForRet = line.itemName || line.productName || (itemMap[itemId] ? itemMap[itemId].name : 'صنف');

      sReturnLines.appendRow([
        returnNumber,
        payload.invoiceNumber,
        lineIdx,
        itemId,
        qty,
        deductionPerUnit,
        lineTotalDeduction,
        condition
      ]);

      savedReturnLines.push({
        returnNumber: returnNumber,
        invoiceNumber: payload.invoiceNumber,
        invoiceLineIndex: lineIdx,
        itemId: itemId,
        returnedQuantity: qty,
        returnShippingDeductionPerUnit: deductionPerUnit,
        totalLineReturnShippingDeduction: lineTotalDeduction,
        itemCondition: condition
      });

      itemsSummary.push(itemNameForRet + ' (' + qty + ')');

      // زيادة رصيد المخزن المحدد فقط عندما تكون الحالة "يرجع المخزن"
      if (condition === 'يرجع المخزن' && itemMap[itemId]) {
        var retAdj = adjustItemWarehouseDeltaGS(ss, itemId, targetWhRet.id, qty, isoDate);
        var newTotAfterRet = recomputeItemTotalStockGS(ss, itemId, sItems);
        itemMap[itemId].stock = newTotAfterRet;
        if (sMovementsRet) {
          sMovementsRet.appendRow(buildRowWithWarehouseGS(sMovementsRet, [
            generateUUID(),
            itemId,
            itemNameForRet,
            'مرتجع',
            qty,
            retAdj.balanceAfter,
            payload.returnReason || payload.reason || 'إرجاع منصة',
            returnNumber,
            retActor,
            isoDate,
            payload.notes || ''
          ], targetWhRet.id));
        }
      }
    }

    sReturns.appendRow(buildRowWithWarehouseGS(sReturns, [
      returnNumber,
      payload.invoiceNumber,
      isoDate,
      itemsSummary.join('، '),
      totalDeduction,
      payload.returnReason || payload.reason || 'إرجاع منصة',
      payload.notes || '',
      session.phone || payload.createdBy || 'المسؤول'
    ], targetWhRet.id, reqIdemKey));

    if (invMatchRowIdx > 0 && sInvoices) {
      sInvoices.getRange(invMatchRowIdx, 9).setValue(payload.isPartial ? 'مرتجع جزئي' : 'مرتجع');
    }

    logAudit(session, 'RETURN_CREATE', 'Return', returnNumber, 'تسجيل مرتجع للفاتورة: ' + payload.invoiceNumber);

    return {
      success: true,
      returnNumber: returnNumber,
      returnRecord: {
        returnNumber: returnNumber,
        invoiceNumber: payload.invoiceNumber,
        date: isoDate,
        returnedItemsSummary: itemsSummary.join('، '),
        totalReturnShippingDeduction: totalDeduction,
        refundStatus: payload.refundStatus || 'قيد على الحساب',
        returnReason: payload.returnReason || payload.reason || 'إرجاع منصة',
        notes: payload.notes || '',
        createdBy: session.phone || payload.createdBy || 'المسؤول',
        idempotencyKey: reqIdemKey,
        warehouseId: targetWhRet.id,
        warehouseName: targetWhRet.name,
        lines: savedReturnLines
      },
      message: 'تم تسجيل المرتجع وتحديث المخزون بنجاح'
    };
  });
}

/**
 * قراءة سجلات المرتجعات
 */
function getReturnsData(filters) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sReturns = ss.getSheetByName(SHEETS.RETURNS);
  var sReturnLines = ss.getSheetByName(SHEETS.RETURN_LINES);

  if (!sReturns || sReturns.getLastRow() < 2) return { returns: [], lines: [] };

  var fromDate = filters ? (filters.from || filters.startDate || null) : null;
  var toDate = filters ? (filters.to || filters.endDate || null) : null;

  var whLookup = getWarehouseLookupMapGS(ss);
  var retData = sReturns.getDataRange().getValues();
  var returns = [];
  var matchingReturnNums = {};

  for (var i = 1; i < retData.length; i++) {
    var r = retData[i];
    var retDateStr = String(r[2]);

    if (fromDate || toDate) {
      if (!isDateInRangeGS(retDateStr, fromDate, toDate)) {
        continue;
      }
    }

    var retNum = String(r[0]);
    matchingReturnNums[retNum] = true;
    var retWhId = (r.length > 9 && r[9] !== undefined && String(r[9]).trim() !== '')
      ? String(r[9]).trim()
      : whLookup.defaultId;

    returns.push({
      returnNumber: retNum,
      invoiceNumber: String(r[1]),
      date: retDateStr,
      returnedItemsSummary: String(r[3]),
      totalReturnShippingDeduction: Number(r[4]) || 0,
      returnReason: String(r[5] || ''),
      notes: String(r[6] || ''),
      createdBy: String(r[7] || ''),
      warehouseId: retWhId,
      warehouseName: whLookup.byId[retWhId] || whLookup.defaultName,
      lines: []
    });
  }

  var lineData = sReturnLines ? sReturnLines.getDataRange().getValues() : [];
  var lines = [];
  var linesByReturn = {};

  for (var j = 1; j < lineData.length; j++) {
    var lr = lineData[j];
    var lRetNum = String(lr[0]);

    if (fromDate || toDate) {
      if (!matchingReturnNums[lRetNum]) {
        continue;
      }
    }

    var line = {
      returnNumber: lRetNum,
      invoiceNumber: String(lr[1]),
      invoiceLineIndex: lr[2],
      itemId: String(lr[3]),
      returnedQuantity: Number(lr[4]) || 0,
      returnShippingDeductionPerUnit: Number(lr[5]) || 0,
      totalLineReturnShippingDeduction: Number(lr[6]) || 0,
      itemCondition: String(lr[7] || 'يرجع المخزن')
    };

    lines.push(line);
    if (!linesByReturn[lRetNum]) {
      linesByReturn[lRetNum] = [];
    }
    linesByReturn[lRetNum].push(line);
  }

  for (var k = 0; k < returns.length; k++) {
    returns[k].lines = linesByReturn[returns[k].returnNumber] || [];
  }

  return { returns: returns, lines: lines };
}

/**
 * قراءة خريطة الإعدادات بالكامل
 */
function getSettingsMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (!sheet || sheet.getLastRow() < 2) return {};

  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var val = data[i][1];
    var key = String(data[i][0]);
    if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
      try {
        map[key] = JSON.parse(val);
      } catch (_) {
        map[key] = val;
      }
    } else {
      map[key] = val;
    }
  }

  // دمج القيم الافتراضية مع المحفوظة لكافة كائنات الإعدادات حتى لا تختفي أي مفاتيح قديمة أو جديدة
  var defaultCompanySettings = {
    storeName: 'POS مدقق للمنصات الإلكترونية',
    brandTagline: 'نظام التدقيق الشامل ونقاط البيع للمنصات الرقمية',
    logoUrl: '',
    phone: '',
    email: '',
    address: '',
    taxNumber: '',
    commercialRecord: '',
    themeColor: '#0e7490',
    accentColor: '#14b8a6',
    fontFamily: 'Tajawal',
    enableDeliveryFee: false,
    supportWhatsapp: '',
    supportPhone: '',
    salesWhatsapp: '',
    salesPhone: ''
  };
  var defaultInvoiceSettings = {
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
    termsAndConditions: 'البضاعة المباعة يمكن إرجاعها خلال 14 يومًا بحالتها الأصلية وفق سياسة كل منصة.',
    returnPolicyText: 'يتم احتساب استقطاع شحن المرتجع المعتمد للمنصة عند استرجاع المنتج.',
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
  var defaultDisplaySettings = {
    showItemImages: true,
    showStockQuantity: true,
    showStockStatusBadge: true,
    showSalePrice: true,
    visibleColumns: ['image', 'name', 'salePrice', 'stock', 'actions'],
    posLayout: 'grid',
    enableQuickBarcodeScan: true,
    confirmInvoiceBeforeSave: true,
    autoFillCashPaid: true,
    enableInlineEdit: false
  };
  var defaultStockSettings = {
    allowNegativeStockSale: false,
    allowNegativeWarehouseTransfer: false
  };

  if (map['companySettings'] && typeof map['companySettings'] === 'object') {
    for (var ck in defaultCompanySettings) {
      if (typeof map['companySettings'][ck] === 'undefined') {
        map['companySettings'][ck] = defaultCompanySettings[ck];
      }
    }
  } else if (!map['companySettings']) {
    map['companySettings'] = defaultCompanySettings;
  }

  if (map['invoicePrintSettings'] && typeof map['invoicePrintSettings'] === 'object') {
    if (map['invoicePrintSettings'].headerText === 'فاتورة مبيعات مدققة وموثقة على المنصة') {
      map['invoicePrintSettings'].headerText = '';
      try {
        withScriptLock(function() {
          var sSettingsSheet = ss.getSheetByName(SHEETS.SETTINGS);
          if (sSettingsSheet) {
            var sData = sSettingsSheet.getDataRange().getValues();
            for (var rIdx = 1; rIdx < sData.length; rIdx++) {
              if (String(sData[rIdx][0]) === 'invoicePrintSettings') {
                sSettingsSheet.getRange(rIdx + 1, 2).setValue(JSON.stringify(map['invoicePrintSettings']));
                sSettingsSheet.getRange(rIdx + 1, 3).setValue(new Date().toISOString());
                break;
              }
            }
          }
        });
      } catch (_) {}
    }
    for (var k in defaultInvoiceSettings) {
      if (typeof map['invoicePrintSettings'][k] === 'undefined') {
        map['invoicePrintSettings'][k] = defaultInvoiceSettings[k];
      }
    }
  } else if (!map['invoicePrintSettings']) {
    map['invoicePrintSettings'] = defaultInvoiceSettings;
  }

  if (map['displaySettings'] && typeof map['displaySettings'] === 'object') {
    for (var dk in defaultDisplaySettings) {
      if (typeof map['displaySettings'][dk] === 'undefined') {
        map['displaySettings'][dk] = defaultDisplaySettings[dk];
      }
    }
  } else if (!map['displaySettings']) {
    map['displaySettings'] = defaultDisplaySettings;
  }

  if (map['stockSettings'] && typeof map['stockSettings'] === 'object') {
    for (var sk in defaultStockSettings) {
      if (typeof map['stockSettings'][sk] === 'undefined') {
        map['stockSettings'][sk] = defaultStockSettings[sk];
      }
    }
  } else if (!map['stockSettings']) {
    map['stockSettings'] = defaultStockSettings;
  }

  return map;
}

/**
 * قراءة أرقام التواصل الأربعة فقط بدون أي إعداد آخر (نقطة عامة لصفحة تسجيل الدخول)
 */
function getPublicContactSettingsGS() {
  var map = getSettingsMap();
  var cs = (map && map['companySettings']) ? map['companySettings'] : {};
  return {
    supportWhatsapp: String(cs.supportWhatsapp || ''),
    supportPhone: String(cs.supportPhone || ''),
    salesWhatsapp: String(cs.salesWhatsapp || ''),
    salesPhone: String(cs.salesPhone || '')
  };
}

/**
 * حفظ الإعدادات مع فحص الصلاحيات المحددة ودمج الكائنات مع القيم المحفوظة بدل استبدالها بالكامل
 */
function saveSettingsProtected(payload, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.SETTINGS);
  var data = sheet.getDataRange().getValues();
  var now = new Date().toISOString();

  // فحص الصلاحيات بحسب نوع الإعداد
  if (payload.companySettings || payload.enableDeliveryFee !== undefined) {
    requirePermission(session, 'settings.company_appearance');
    if (
      payload.companySettings &&
      typeof payload.companySettings.appTheme !== 'undefined' &&
      payload.companySettings.appTheme !== ''
    ) {
      var validAppThemes = ['light-sky', 'dark', 'current', 'aurora', 'aurora-sky'];
      if (validAppThemes.indexOf(String(payload.companySettings.appTheme)) === -1) {
        throw new Error('قيمة الثيم المختار غير صالحة: ' + payload.companySettings.appTheme);
      }
    }
    if (payload.companySettings && typeof payload.companySettings === 'object') {
      var contactKeys = ['supportWhatsapp', 'supportPhone', 'salesWhatsapp', 'salesPhone'];
      for (var cIdx = 0; cIdx < contactKeys.length; cIdx++) {
        var cKey = contactKeys[cIdx];
        if (typeof payload.companySettings[cKey] !== 'undefined') {
          var cCheck = validateContactNumberGS(payload.companySettings[cKey]);
          if (!cCheck.valid) {
            throw new Error(cCheck.error);
          }
          payload.companySettings[cKey] = cCheck.cleaned;
        }
      }
    }
  }
  if (payload.invoicePrintSettings) {
    requirePermission(session, 'settings.invoice_print');
    if (payload.invoicePrintSettings.headerText === 'فاتورة مبيعات مدققة وموثقة على المنصة') {
      payload.invoicePrintSettings.headerText = '';
    }
  }
  if (payload.displaySettings) {
    requirePermission(session, 'settings.display_customization');
  }
  if (payload.stockSettings) {
    requirePermission(session, 'settings.negative_stock');
  }

  for (var k in payload) {
    var val = payload[k];
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === k) {
        var finalValStr = '';
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          var existingObj = {};
          try {
            var parsedExisting = (typeof data[i][1] === 'string') ? JSON.parse(data[i][1]) : data[i][1];
            if (parsedExisting && typeof parsedExisting === 'object' && !Array.isArray(parsedExisting)) {
              existingObj = parsedExisting;
            }
          } catch (_) {}
          var mergedObj = {};
          for (var ek in existingObj) {
            mergedObj[ek] = existingObj[ek];
          }
          for (var nk in val) {
            mergedObj[nk] = val[nk];
          }
          finalValStr = JSON.stringify(mergedObj);
        } else {
          finalValStr = (typeof val === 'object') ? JSON.stringify(val) : String(val);
        }
        sheet.getRange(i + 1, 2).setValue(finalValStr);
        sheet.getRange(i + 1, 3).setValue(now);
        found = true;
        break;
      }
    }
    if (!found) {
      var newValStr = (typeof val === 'object') ? JSON.stringify(val) : String(val);
      sheet.appendRow([k, newValStr, now]);
    }
  }

  logAudit(session, 'SETTINGS_UPDATE', 'Settings', 'Global', 'تحديث إعدادات النظام');
  return { success: true, message: 'تم حفظ وتطبيق الإعدادات بنجاح' };
  });
}

/**
 * قراءة قائمة المستخدمين مع حجب كلمات المرور والـ Salt
 */
function getUsersData(session) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.USERS);
  if (!sheet || sheet.getLastRow() < 2) {
    ensureDefaultUsersIfEmptyGS(ss);
    sheet = ss.getSheetByName(SHEETS.USERS);
  }
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getDataRange().getValues();
  var users = [];

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var role = String(r[3] || 'employee');
    var isOwner = r[9] === true || String(r[9] || '').toLowerCase() === 'true';
    if (role === 'designer') isOwner = true;
    var mustChangePassword = r[18] === true || String(r[18] || '').toLowerCase() === 'true';

    var perms = [];
    var pJson = String(r[8] || '').trim();
    if (pJson && pJson.startsWith('[')) {
      try {
        perms = JSON.parse(pJson);
      } catch (_) {
        perms = ROLE_TEMPLATES[role] || [];
      }
    } else {
      perms = ROLE_TEMPLATES[role] || [];
    }

    if (role === 'designer') {
      perms = ALL_PERMISSIONS;
    }

    var storedUsername = String(r[1] || '').trim();
    var storedPhone = String(r[10] || '').trim();

    var cbConfig = null;
    var cbJson = String(r[11] || '').trim();
    if (cbJson && cbJson.startsWith('{')) {
      try {
        cbConfig = JSON.parse(cbJson);
      } catch (_) {}
    }

    var whConfig = null;
    var whJson = String(r[17] || '').trim();
    if (whJson && whJson.startsWith('{')) {
      try {
        whConfig = JSON.parse(whJson);
      } catch (_) {}
    }

    var offlineVerifier = String(r[12] || '').trim();
    var offlineSalt = String(r[13] || '').trim();
    var offlineIterations = r[14] ? Number(r[14]) : undefined;
    var permissionsUpdatedAt = String(r[15] || r[7] || '').trim();
    var permissionsUpdatedByDevice = String(r[16] || '').trim();

    users.push({
      id: String(r[0]),
      username: storedUsername,
      phone: storedPhone,
      name: String(r[2]),
      role: role,
      status: String(r[6] || 'نشط'),
      createdAt: String(r[7] || ''),
      permissions: perms,
      isOwner: isOwner,
      mustChangePassword: mustChangePassword,
      cashboxConfig: cbConfig,
      warehouseConfig: whConfig || undefined,
      offlineVerifier: offlineVerifier || undefined,
      offlineSalt: offlineSalt || undefined,
      offlineIterations: offlineIterations,
      permissionsUpdatedAt: permissionsUpdatedAt || undefined,
      permissionsUpdatedByDevice: permissionsUpdatedByDevice || undefined
    });
  }

  return users;
}

/**
 * استكمال إعداد الحساب عند أول دخول (تعديل الاسم الظاهر، اسم المستخدم، وكلمة السر الجديدة)
 */
function completeInitialAccountSetupGS(payload, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEETS.USERS);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: false, error: 'المستخدم غير موجود' };
    }

    var targetUserId = String((payload && payload.userId) || session.userId || '').trim();
    var cleanName = String((payload && payload.name) || '').trim();
    var rawUsername = String((payload && payload.username) || '').trim();
    var normUser = normalizeUsername(rawUsername);
    var newPassword = (payload && typeof payload.newPassword === 'string') ? payload.newPassword : String((payload && payload.newPassword) || '');

    if (!cleanName || cleanName.length < 2) {
      return { success: false, error: 'الاسم الظاهر مطلوب ويجب أن يتكون من حرفين على الأقل' };
    }
    if (!rawUsername) {
      return { success: false, error: 'اسم المستخدم مطلوب' };
    }
    if (!isValidUsernameFormat(rawUsername)) {
      return { success: false, error: 'اسم المستخدم غير صالح. يقبل حروفاً عربية أو إنجليزية أو أرقاماً بين 2 و 40 خانة.' };
    }

    var pwdCheck = validatePasswordRules(newPassword);
    if (!pwdCheck.valid) {
      return { success: false, error: pwdCheck.error };
    }

    var data = sheet.getDataRange().getValues();
    var rowIndex = -1;
    var rowData = null;

    for (var i = 1; i < data.length; i++) {
      var rId = String(data[i][0]);
      var rUsername = String(data[i][1] || '').trim();
      if (rId !== targetUserId && normalizeUsername(rUsername) === normUser) {
        return { success: false, error: 'اسم المستخدم "' + rawUsername + '" مستخدم بالفعل لحساب آخر' };
      }
      if (rId === targetUserId) {
        rowIndex = i + 1;
        rowData = data[i];
      }
    }

    if (rowIndex === -1 || !rowData) {
      return { success: false, error: 'المستخدم غير موجود' };
    }

    var currentSalt = String(rowData[4] || '');
    var currentHash = String(rowData[5] || '');
    var currentMustChange = rowData[18] === true || String(rowData[18] || '').toLowerCase() === 'true';
    if (currentMustChange && hashPassword(newPassword, currentSalt) === currentHash) {
      return { success: false, error: 'لا يمكن استخدام كلمة السر المؤقتة الحالية؛ يرجى اختيار كلمة سر جديدة' };
    }

    var newSalt = Utilities.getUuid().slice(0, 16);
    var newHash = hashPassword(newPassword, newSalt);

    while (rowData.length < 19) {
      rowData.push('');
    }
    rowData[1] = rawUsername;
    rowData[2] = cleanName;
    rowData[4] = newSalt;
    rowData[5] = newHash;
    if (payload && payload.offlineVerifier) {
      rowData[12] = String(payload.offlineVerifier);
      rowData[13] = String(payload.offlineSalt || '');
      rowData[14] = Number(payload.offlineIterations) || 200000;
    }
    rowData[18] = false;

    sheet.getRange(rowIndex, 1, 1, 19).setValues([rowData.slice(0, 19)]);

    logAudit(session, 'USER_INITIAL_SETUP', 'User', targetUserId, 'استكمال إعداد الحساب عند أول دخول للمستخدم: ' + rawUsername);

    var role = String(rowData[3] || 'employee');
    var isOwner = rowData[9] === true || String(rowData[9] || '').toLowerCase() === 'true' || role === 'designer';
    var perms = ROLE_TEMPLATES[role] || [];
    try {
      if (String(rowData[8] || '').trim().indexOf('[') === 0) {
        perms = JSON.parse(String(rowData[8]));
      }
    } catch (_) {}
    if (role === 'designer') perms = ALL_PERMISSIONS;

    return {
      success: true,
      user: {
        id: targetUserId,
        username: rawUsername,
        name: cleanName,
        phone: String(rowData[10] || ''),
        role: role,
        status: String(rowData[6] || 'نشط'),
        permissions: perms,
        isOwner: isOwner,
        mustChangePassword: false
      }
    };
  });
}

/**
 * تغيير كلمة السر الشخصية للمستخدم الحالي
 */
function changeOwnPasswordGS(payload, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEETS.USERS);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: false, error: 'المستخدم غير موجود' };
    }

    var targetUserId = String((payload && payload.userId) || session.userId || '').trim();
    var currentPassword = (payload && typeof payload.currentPassword === 'string') ? payload.currentPassword : '';
    var newPassword = (payload && typeof payload.newPassword === 'string') ? payload.newPassword : String((payload && payload.newPassword) || '');

    var pwdCheck = validatePasswordRules(newPassword);
    if (!pwdCheck.valid) {
      return { success: false, error: pwdCheck.error };
    }

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === targetUserId) {
        var rowData = data[i];
        if (currentPassword) {
          var currentSalt = String(rowData[4] || '');
          var currentHash = String(rowData[5] || '');
          if (hashPassword(currentPassword, currentSalt) !== currentHash) {
            return { success: false, error: 'كلمة السر الحالية غير صحيحة' };
          }
        }
        var newSalt = Utilities.getUuid().slice(0, 16);
        var newHash = hashPassword(newPassword, newSalt);
        while (rowData.length < 19) rowData.push('');
        rowData[4] = newSalt;
        rowData[5] = newHash;
        if (payload && payload.offlineVerifier) {
          rowData[12] = String(payload.offlineVerifier);
          rowData[13] = String(payload.offlineSalt || '');
          rowData[14] = Number(payload.offlineIterations) || 200000;
        }
        rowData[18] = false;
        sheet.getRange(i + 1, 1, 1, 19).setValues([rowData.slice(0, 19)]);
        logAudit(session, 'USER_CHANGE_OWN_PASSWORD', 'User', targetUserId, 'تغيير كلمة السر الشخصية');
        return { success: true };
      }
    }
    return { success: false, error: 'المستخدم غير موجود' };
  });
}

/**
 * حذف مستخدم مع منع حذف آخر حساب نشط بدور مالك النظام
 */
function deleteUserGS(payload, session) {
  return withScriptLock(function() {
    if (
      session.role !== 'designer' &&
      (!session.permissions || (session.permissions.indexOf('users.edit') === -1 && session.permissions.indexOf('users.status') === -1))
    ) {
      return { success: false, error: 'غير مصرح: تفتقر لصلاحية حذف المستخدمين' };
    }

    var targetUserId = String((payload && (payload.userId || payload.id)) || '').trim();
    if (!targetUserId) {
      return { success: false, error: 'معرف المستخدم مطلوب' };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEETS.USERS);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: false, error: 'المستخدم غير موجود' };
    }

    var data = sheet.getDataRange().getValues();
    var targetRowIdx = -1;
    var targetRow = null;
    var activeDesignersCount = 0;

    for (var i = 1; i < data.length; i++) {
      var rId = String(data[i][0]);
      var rRole = String(data[i][3] || '');
      var rStatus = String(data[i][6] || 'نشط');
      var rOwner = data[i][9] === true || String(data[i][9] || '').toLowerCase() === 'true';
      if ((rRole === 'designer' || rOwner) && (rStatus === 'نشط' || rStatus === 'active')) {
        activeDesignersCount++;
      }
      if (rId === targetUserId) {
        targetRowIdx = i + 1;
        targetRow = data[i];
      }
    }

    if (targetRowIdx === -1 || !targetRow) {
      return { success: false, error: 'المستخدم غير موجود' };
    }

    var targetRole = String(targetRow[3] || '');
    var targetIsOwner = targetRow[9] === true || String(targetRow[9] || '').toLowerCase() === 'true';
    if ((targetRole === 'designer' || targetIsOwner) && activeDesignersCount <= 1) {
      return { success: false, error: 'غير مسموح: لا يمكن حذف آخر حساب نشط بدور مالك النظام' };
    }

    sheet.deleteRow(targetRowIdx);
    logAudit(session, 'USER_DELETE', 'User', targetUserId, 'حذف المستخدم: ' + String(targetRow[1] || ''));
    return { success: true };
  });
}

/**
 * حفظ أو تعديل مستخدم مع تطبيق قيود الحماية:
 * - التحقق من تطبيع اسم المستخدم وصيغته
 * - منع تكرار اسم المستخدم
 * - التحقق من قواعد كلمة المرور الجديدة (حرفان أو رقمان على الأقل، ولا تساوي المؤقتة)
 * - عند إعادة تعيين كلمة سر مستخدم من المدير يصبح mustChangePassword=true تلقائياً
 * - حماية آخر مصمم نشط من الإيقاف أو تغيير دوره
 */
function saveUser(user, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.USERS);

  var rawUsername = String(user.username || user.phone || '').trim();
  var normUser = normalizeUsername(rawUsername);

  if (!rawUsername) {
    return { success: false, error: 'اسم المستخدم مطلوب' };
  }

  if (!isValidUsernameFormat(rawUsername)) {
    return { success: false, error: 'اسم المستخدم غير صالح. يقبل حروفاً عربية أو إنجليزية أو أرقاماً بين 2 و 40 خانة.' };
  }

  var isCreating = !user.id;
  if (isCreating) {
    requirePermission(session, 'users.create');
  } else {
    requirePermission(session, 'users.edit');
  }

  // إدارة تعيينات الخزائن مخصصة للمصمم أو صلاحية إدارة الخزائن
  if (user.cashboxConfig && session.role !== 'designer') {
    return { success: false, error: 'غير مصرح: المصمم وحده يدير تعيينات الخزائن وصلاحيات المستخدمين.' };
  }

  var data = sheet.getDataRange().getValues();
  var existingRowIndex = -1;
  var existingSalt = '';
  var existingHash = '';
  var existingPhone = '';
  var existingName = 'مستخدم';
  var existingCbJson = '';
  var existingWhJson = '';
  var existingOfflineVerifier = '';
  var existingOfflineSalt = '';
  var existingOfflineIterations = 0;
  var existingPermsUpdatedAt = '';
  var existingPermsDevice = '';
  var existingMustChangePassword = false;
  var targetIsOwner = false;
  var targetRole = '';
  var existingStatus = 'نشط';

  for (var i = 1; i < data.length; i++) {
    var rowUserId = String(data[i][0]);
    var rowUsername = String(data[i][1] || '').trim();
    var rowNorm = normalizeUsername(rowUsername);

    // التحقق من تكرار اسم المستخدم لمستخدم آخر
    if ((!user.id || rowUserId !== String(user.id)) && rowNorm === normUser) {
      return { success: false, error: 'اسم المستخدم "' + rawUsername + '" محجوز بالفعل لمستخدم آخر' };
    }

    if ((user.id && rowUserId === String(user.id)) || rowNorm === normUser) {
      existingRowIndex = i + 1;
      existingName = String(data[i][2] || 'مستخدم');
      existingSalt = String(data[i][4]);
      existingHash = String(data[i][5]);
      targetRole = String(data[i][3]);
      existingStatus = String(data[i][6] || 'نشط');
      targetIsOwner = data[i][9] === true || String(data[i][9] || '').toLowerCase() === 'true';
      existingPhone = String(data[i][10] || '').trim();
      existingCbJson = String(data[i][11] || '').trim();
      existingOfflineVerifier = String(data[i][12] || '').trim();
      existingOfflineSalt = String(data[i][13] || '').trim();
      existingOfflineIterations = Number(data[i][14] || 0);
      existingPermsUpdatedAt = String(data[i][15] || data[i][7] || '').trim();
      existingPermsDevice = String(data[i][16] || '').trim();
      existingWhJson = String(data[i][17] || '').trim();
      existingMustChangePassword = data[i][18] === true || String(data[i][18] || '').toLowerCase() === 'true';
    }
  }

  var requestedRole = user.role || targetRole || 'employee';
  var requestedStatus = user.status || existingStatus || 'نشط';

  // حماية آخر مصمم نشط من الإيقاف أو تحويل دوره، مع السماح بتعديل الاسم الظاهر واسم المستخدم بصلاحية إدارة المستخدمين
  if (targetIsOwner || targetRole === 'designer') {
    var isAttemptingDeactivation = requestedStatus === 'موقوف' || requestedStatus === 'inactive';
    var isAttemptingRoleDowngrade = requestedRole !== 'designer';
    if (isAttemptingDeactivation || isAttemptingRoleDowngrade) {
      var activeDesignersCount = 0;
      for (var d = 1; d < data.length; d++) {
        var rRole = String(data[d][3]);
        var rStatus = String(data[d][6] || 'نشط');
        var rOwner = data[d][9] === true || String(data[d][9] || '').toLowerCase() === 'true';
        if ((rRole === 'designer' || rOwner) && (rStatus === 'نشط' || rStatus === 'active')) {
          activeDesignersCount++;
        }
      }
      if (activeDesignersCount <= 1) {
        return {
          success: false,
          error: 'غير مسموح: لا يمكن إيقاف أو تعديل دور مصمم ومالك النظام الأخير، يجب أن يظل هناك مصمم نشط واحد على الأقل.'
        };
      }
      if (session.role !== 'designer') {
        return { success: false, error: 'غير مصرح: لا يمكن إيقاف حساب مالك النظام أو تغيير دوره إلا من قِبل مالك نظام آخر.' };
      }
    }
  } else if (requestedRole === 'designer' && session.role !== 'designer') {
    return { success: false, error: 'غير مصرح: لا يمكن تعيين دور مصمم ومالك النظام إلا من قِبل مالك النظام الحالي.' };
  }

  // فحص كلمة المرور وإعادة التعيين
  var salt = existingSalt || Utilities.getUuid().slice(0, 16);
  var hash = existingHash;
  var passwordWasReset = false;

  if (user.password && String(user.password).trim() !== '') {
    var pwdCheck = validatePasswordRules(String(user.password).trim(), requestedRole);
    if (!pwdCheck.valid) {
      return { success: false, error: pwdCheck.error };
    }
    salt = Utilities.getUuid().slice(0, 16);
    hash = hashPassword(String(user.password).trim(), salt);
    passwordWasReset = true;
  } else if (existingRowIndex === -1) {
    return { success: false, error: 'كلمة المرور مطلوبة لإنشاء حساب جديد' };
  }

  // التحقق من الصلاحيات الممنوحة: لا يمكن للمدير منح صلاحيات لا يملكها هو نفسه
  var userPerms = user.permissions;
  if (!Array.isArray(userPerms)) {
    userPerms = ROLE_TEMPLATES[requestedRole] || ROLE_TEMPLATES.employee;
  }

  if (session.role !== 'designer') {
    userPerms = userPerms.filter(function(p) {
      return session.permissions && session.permissions.indexOf(p) !== -1;
    });
  }

  var userId = user.id || generateUUID();
  var now = new Date().toISOString();
  var isOwner = (requestedRole === 'designer') ? true : false;
  var phone = user.phone ? String(user.phone).trim() : existingPhone;
  var finalName = user.name ? String(user.name).trim() : existingName;
  var cashboxConfigJson = user.cashboxConfig !== undefined
    ? (user.cashboxConfig ? JSON.stringify(user.cashboxConfig) : '')
    : existingCbJson;

  var normalizedWhConfigObj = null;
  if (user.warehouseConfig !== undefined) {
    if (user.warehouseConfig && typeof user.warehouseConfig === 'object') {
      var rawAllowedWh = Array.isArray(user.warehouseConfig.allowedWarehouseIds) ? user.warehouseConfig.allowedWarehouseIds : [];
      var uniqAllowedWh = [];
      for (var wai = 0; wai < rawAllowedWh.length; wai++) {
        var widClean = String(rawAllowedWh[wai] || '').trim();
        if (widClean && uniqAllowedWh.indexOf(widClean) === -1) uniqAllowedWh.push(widClean);
      }
      var defWhIdVal = user.warehouseConfig.defaultWarehouseId ? String(user.warehouseConfig.defaultWarehouseId).trim() : '';
      if (!defWhIdVal && uniqAllowedWh.length === 1) defWhIdVal = uniqAllowedWh[0];
      normalizedWhConfigObj = { allowedWarehouseIds: uniqAllowedWh };
      if (defWhIdVal) normalizedWhConfigObj.defaultWarehouseId = defWhIdVal;
    }
  } else if (existingWhJson && existingWhJson.indexOf('{') === 0) {
    try { normalizedWhConfigObj = JSON.parse(existingWhJson); } catch (_) {}
  }

  var warehouseConfigJson = user.warehouseConfig !== undefined
    ? (normalizedWhConfigObj ? JSON.stringify(normalizedWhConfigObj) : '')
    : existingWhJson;

  var finalOfflineVerifier = passwordWasReset || existingRowIndex === -1
    ? String(user.offlineVerifier || '')
    : (String(user.offlineVerifier || '') || existingOfflineVerifier);
  var finalOfflineSalt = passwordWasReset || existingRowIndex === -1
    ? String(user.offlineSalt || '')
    : (String(user.offlineSalt || '') || existingOfflineSalt);
  var finalOfflineIterations = passwordWasReset || existingRowIndex === -1
    ? (Number(user.offlineIterations) || (finalOfflineVerifier ? 200000 : 0))
    : (Number(user.offlineIterations) || existingOfflineIterations || (finalOfflineVerifier ? 200000 : 0));
  var finalPermsUpdatedAt = (user.permissions !== undefined || existingRowIndex === -1)
    ? now
    : (existingPermsUpdatedAt || now);
  var finalPermsDevice = (user.permissions !== undefined || existingRowIndex === -1)
    ? String(user.deviceId || 'ONLINE')
    : existingPermsDevice;

  // عند إعادة تعيين كلمة سر مستخدم من المدير يصبح mustChangePassword=true تلقائياً
  var finalMustChangePassword = (passwordWasReset && existingRowIndex > 0)
    ? true
    : (typeof user.mustChangePassword !== 'undefined' ? Boolean(user.mustChangePassword) : existingMustChangePassword);

  var rowData = [
    userId,
    rawUsername,
    finalName,
    requestedRole,
    salt,
    hash,
    requestedStatus,
    now,
    JSON.stringify(userPerms),
    isOwner,
    phone,
    cashboxConfigJson,
    finalOfflineVerifier,
    finalOfflineSalt,
    finalOfflineIterations || '',
    finalPermsUpdatedAt,
    finalPermsDevice,
    warehouseConfigJson,
    finalMustChangePassword
  ];

  ensureSheetWithHeaders(ss, SHEETS.USERS, [
    'ID', 'اسم المستخدم', 'الاسم', 'الدور', 'salt', 'passwordHash', 'الحالة', 'تاريخ الإضافة',
    'permissionsJson', 'isOwner', 'رقم الهاتف', 'cashboxConfigJson', 'offlineVerifier', 'offlineSalt',
    'offlineIterations', 'permissionsUpdatedAt', 'permissionsUpdatedByDevice', 'warehouseConfigJson',
    'mustChangePassword'
  ]);

  if (existingRowIndex > 0) {
    sheet.getRange(existingRowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  if (user.warehouseConfig !== undefined) {
    syncUserWarehousesRowsGS(ss, userId, finalName || rawUsername, normalizedWhConfigObj, requestedStatus);
  }

  // تحديث وتزامن جدول تعيينات الخزائن UserCashboxAssignments
  if (user.cashboxConfig) {
    var ucbSheet = getOrCreateSheet(ss, SHEETS.USER_CASHBOX_ASSIGNMENTS);
    if (ucbSheet) {
      var ucbData = ucbSheet.getDataRange().getValues();
      for (var k = ucbData.length - 1; k >= 1; k--) {
        if (String(ucbData[k][1]) === String(userId)) {
          ucbSheet.deleteRow(k + 1);
        }
      }

      var cfg = user.cashboxConfig;
      var allAssignedIds = [];
      var addId = function(id) {
        if (id && allAssignedIds.indexOf(id) === -1) allAssignedIds.push(id);
      };
      (cfg.allowedSaleCashboxIds || []).forEach(addId);
      (cfg.allowedReturnCashboxIds || []).forEach(addId);
      (cfg.allowedReceiptCashboxIds || []).forEach(addId);
      (cfg.allowedPaymentCashboxIds || []).forEach(addId);
      (cfg.allowedTransferCashboxIds || []).forEach(addId);

      for (var a = 0; a < allAssignedIds.length; a++) {
        var cId = allAssignedIds[a];
        var isDef = (cId === cfg.defaultSaleCashboxId) || (cId === cfg.defaultReturnCashboxId);
        var ops = [];
        if ((cfg.allowedSaleCashboxIds || []).indexOf(cId) !== -1) ops.push('sale');
        if ((cfg.allowedReturnCashboxIds || []).indexOf(cId) !== -1) ops.push('return');
        if ((cfg.allowedReceiptCashboxIds || []).indexOf(cId) !== -1) ops.push('receipt');
        if ((cfg.allowedPaymentCashboxIds || []).indexOf(cId) !== -1) ops.push('payment');
        if ((cfg.allowedTransferCashboxIds || []).indexOf(cId) !== -1) ops.push('transfer');

        ucbSheet.appendRow([
          generateUUID(),
          userId,
          finalName || rawUsername,
          cId,
          '',
          ops.join(','),
          isDef,
          requestedStatus === 'موقوف' || requestedStatus === 'inactive' ? 'inactive' : 'active',
          now
        ]);
      }
    }
  }

  // إلغاء الجلسات النشطة فورًا إذا تم إيقاف الحساب
  if (requestedStatus === 'موقوف' || requestedStatus === 'inactive') {
    var sessSheet = ss.getSheetByName(SHEETS.SESSIONS);
    if (sessSheet && sessSheet.getLastRow() > 1) {
      var sessData = sessSheet.getDataRange().getValues();
      for (var s = sessData.length - 1; s >= 1; s--) {
        if (String(sessData[s][1]) === String(userId)) {
          sessSheet.deleteRow(s + 1);
        }
      }
    }
    logAudit(session, 'USER_STATUS_CHANGE', 'User', userId, 'إيقاف حساب المستخدم (' + rawUsername + ') وإلغاء جلساته النشطة');
  }

  if (passwordWasReset) {
    logAudit(session, 'USER_PASSWORD_RESET', 'User', userId, 'إعادة تعيين كلمة المرور للمستخدم (' + rawUsername + ')');
  }

  if (user.cashboxConfig) {
    logAudit(session, 'USER_CASHBOX_ASSIGN', 'User', userId, 'تحديث تعيينات الخزائن للمستخدم (' + rawUsername + ')');
  }

  logAudit(
    session,
    existingRowIndex > 0 ? 'USER_UPDATE' : 'USER_CREATE',
    'User',
    userId,
    'حفظ بيانات المستخدم (' + rawUsername + ') بالدور: ' + requestedRole + ' والحالة: ' + requestedStatus
  );

  return {
    success: true,
    userId: userId,
    user: {
      id: userId,
      username: rawUsername,
      name: finalName,
      phone: phone,
      role: requestedRole,
      status: requestedStatus,
      permissions: userPerms,
      isOwner: isOwner,
      mustChangePassword: finalMustChangePassword,
      cashboxConfig: user.cashboxConfig,
      warehouseConfig: normalizedWhConfigObj || undefined,
      offlineVerifier: finalOfflineVerifier || undefined,
      offlineSalt: finalOfflineSalt || undefined,
      offlineIterations: finalOfflineIterations || undefined,
      permissionsUpdatedAt: finalPermsUpdatedAt,
      permissionsUpdatedByDevice: finalPermsDevice
    },
    message: 'تم حفظ المستخدم وتعيينات الخزائن بنجاح'
  };
  });
}

/**
 * تحديث صلاحيات مستخدم محدد مع التسجيل في سجل التدقيق ودعم مزامنة التعديلات الأوفلاين وحل التعارضات
 */
function updateUserPermissions(payload, session) {
  var userId = payload.targetUserId || payload.userId;
  var newPermissions = payload.permissions || [];
  var isOfflineSync = Boolean(payload.isOfflineSync || payload.isOffline);

  if (!userId || !Array.isArray(newPermissions)) {
    return { success: false, error: 'معرف المستخدم وقائمة الصلاحيات مطلوبة' };
  }

  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEETS.USERS);
    var data = sheet.getDataRange().getValues();

    var targetRow = -1;
    var targetRole = '';
    var targetName = '';
    var targetIsOwner = false;
    var currentPermsUpdatedAt = '';
    var currentPermsDevice = '';
    var existingPerms = [];

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(userId)) {
        targetRow = i + 1;
        targetName = String(data[i][2] || data[i][1] || userId);
        targetRole = String(data[i][3]);
        targetIsOwner = data[i][9] === true || String(data[i][9] || '').toLowerCase() === 'true';
        var rawOldPerms = String(data[i][8] || '').trim();
        if (rawOldPerms && rawOldPerms.indexOf('[') === 0) {
          try { existingPerms = JSON.parse(rawOldPerms); } catch (_) {}
        }
        currentPermsUpdatedAt = String(data[i][15] || '').trim();
        currentPermsDevice = String(data[i][16] || '').trim();
        break;
      }
    }

    if (targetRow === -1) {
      return { success: false, error: 'المستخدم غير موجود' };
    }

    // حماية مالك النظام
    if (targetIsOwner || targetRole === 'designer') {
      if (session.role !== 'designer') {
        return { success: false, error: 'لا يمكن تعديل صلاحيات مالك النظام.' };
      }
    }

    // لا يمكن للمدير منح صلاحيات لا يملكها
    if (session.role !== 'designer') {
      newPermissions = newPermissions.filter(function(p) {
        return session.permissions && session.permissions.indexOf(p) !== -1;
      });
    }

    var nowIso = new Date().toISOString();
    var incomingEditedAt = String(payload.editedAt || payload.updatedAt || payload.deviceTime || nowIso).trim();
    var baseUpdatedAt = String(payload.baseUpdatedAt || '').trim();
    var incomingDeviceId = String(payload.offlineDeviceId || payload.deviceId || (isOfflineSync ? 'OFFLINE_DEVICE' : 'ONLINE')).trim();
    var incomingDeviceName = String(payload.deviceName || incomingDeviceId).trim();

    var conflictDetected = Boolean(
      isOfflineSync &&
      currentPermsUpdatedAt &&
      currentPermsDevice &&
      currentPermsDevice !== incomingDeviceId &&
      (!baseUpdatedAt || currentPermsUpdatedAt !== baseUpdatedAt)
    );

    var incomingMs = Date.parse(incomingEditedAt) || 0;
    var currentMs = Date.parse(currentPermsUpdatedAt) || 0;
    var incomingWins = !isOfflineSync || !currentPermsUpdatedAt || incomingMs >= currentMs;

    if (incomingWins) {
      sheet.getRange(targetRow, 9).setValue(JSON.stringify(newPermissions));
      sheet.getRange(targetRow, 16, 1, 2).setValues([[incomingEditedAt, incomingDeviceId]]);
    }

    if (conflictDetected) {
      logAudit(
        session,
        'PERMISSIONS_SYNC_CONFLICT',
        'UserPermissions',
        userId,
        'تعارض تعديل صلاحيات للمالك على المستخدم (' + targetName + '): وُجد تعديل من الجهاز (' + incomingDeviceName + ' / ' + incomingDeviceId + ') بوقت (' + incomingEditedAt + ') مع تعديل آخر من الجهاز (' + currentPermsDevice + ') بوقت (' + currentPermsUpdatedAt + '). تم اعتماد التعديل الأحدث زمنيًا.'
      );
    }

    logAudit(
      session,
      'PERMISSIONS_UPDATE',
      'UserPermissions',
      userId,
      'تعديل صلاحيات المستخدم (' + targetName + '). الصلاحيات الجديدة: ' + (incomingWins ? newPermissions.length : existingPerms.length) + ' صلاحية'
    );

    return {
      success: true,
      conflictDetected: conflictDetected,
      appliedIncoming: incomingWins,
      winningTimestamp: incomingWins ? incomingEditedAt : currentPermsUpdatedAt,
      permissions: incomingWins ? newPermissions : existingPerms,
      needsReview: conflictDetected,
      reviewReasons: conflictDetected ? ['تعارض تعديل صلاحيات من جهازين'] : [],
      message: 'تم تحديث صلاحيات المستخدم بنجاح'
    };
  });
}

/**
 * قراءة سجل التدقيق AuditLogs
 */
function getAuditLogsData(filters) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.AUDIT_LOGS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var fromDate = filters ? (filters.from || filters.startDate || null) : null;
  var toDate = filters ? (filters.to || filters.endDate || null) : null;
  var userId = filters && filters.userId && filters.userId !== 'ALL' ? String(filters.userId) : null;
  var actionFilter = filters && filters.action && filters.action !== 'ALL' ? String(filters.action) : null;
  var q = filters && filters.q && String(filters.q).trim() ? normalizeArabicTextGS(filters.q) : null;
  var hasFilters = Boolean(fromDate || toDate || userId || actionFilter || q);

  var data = sheet.getDataRange().getValues();
  var logs = [];

  var startRow = hasFilters ? 1 : Math.max(1, data.length - 100);
  for (var i = data.length - 1; i >= startRow; i--) {
    var r = data[i];
    var timestampStr = String(r[1]);
    var actorId = String(r[2]);
    var actorName = String(r[3]);
    var actorRole = String(r[4]);
    var actStr = String(r[5]);
    var targetType = String(r[6]);
    var targetId = String(r[7]);
    var details = String(r[8] || '');

    if (fromDate || toDate) {
      if (!isDateInRangeGS(timestampStr, fromDate, toDate)) {
        continue;
      }
    }

    if (userId) {
      if (actorId !== userId && actorName !== userId) {
        continue;
      }
    }

    if (actionFilter) {
      if (actStr !== actionFilter) {
        continue;
      }
    }

    if (q) {
      var rowText = normalizeArabicTextGS(actorName + ' ' + actorRole + ' ' + actStr + ' ' + targetType + ' ' + targetId + ' ' + details);
      if (rowText.indexOf(q) === -1) {
        continue;
      }
    }

    logs.push({
      id: String(r[0]),
      timestamp: timestampStr,
      actorId: actorId,
      actorName: actorName,
      actorRole: actorRole,
      action: actStr,
      targetType: targetType,
      targetId: targetId,
      details: details
    });
  }

  return logs;
}

/**
 * رفع صورة إلى Google Drive
 */
function uploadImageToDrive(payload) {
  try {
    var rawBase64 = payload.imageBase64 || '';
    if (!rawBase64) {
      return { success: false, error: 'لم يتم إرسال بيانات الصورة (Base64)' };
    }

    var cleanBase64 = rawBase64;
    var commaIdx = rawBase64.indexOf(',');
    if (commaIdx !== -1) {
      cleanBase64 = rawBase64.substring(commaIdx + 1);
    }

    var mimeType = payload.mimeType || 'image/jpeg';
    var fileName = payload.fileName || ('item_' + Utilities.formatDate(new Date(), 'GMT+2', 'yyyyMMdd_HHmmss') + '.jpg');

    var folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
    var folder = null;

    if (folderId) {
      try {
        folder = DriveApp.getFolderById(folderId);
      } catch (e) {
        folder = null;
      }
    }

    if (!folder) {
      var folders = DriveApp.getFoldersByName('POS Modaqiq Images');
      if (folders.hasNext()) {
        folder = folders.next();
      } else {
        folder = DriveApp.createFolder('POS Modaqiq Images');
        try {
          folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (_) {}
      }
      PropertiesService.getScriptProperties().setProperty('DRIVE_FOLDER_ID', folder.getId());
    }

    var decodedBytes = Utilities.base64Decode(cleanBase64);
    var blob = Utilities.newBlob(decodedBytes, mimeType, fileName);
    var file = folder.createFile(blob);

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (_) {}

    var fileId = file.getId();
    var viewUrl = 'https://drive.google.com/uc?export=view&id=' + fileId;

    return {
      success: true,
      url: viewUrl,
      fileId: fileId,
      fileName: fileName,
      message: 'تم رفع الصورة وحفظها بنجاح في Google Drive'
    };
  } catch (err) {
    console.error('[AppsScript uploadImageToDrive Error]:', err && (err.stack || err.message || err));
    return {
      success: false,
      error: sanitizeClientErrorMessageGS(err, 'فشل رفع الصورة إلى Google Drive')
    };
  }
}

/**
 * مزامنة جميع البيانات بفلترة الصلاحيات
 */
function getAllData(session) {
  var migReport = migrateItemStocksToMainWarehouseOnceGS();
  return {
    success: true,
    hasOwner: hasAnyOwner(),
    hasManager: hasAnyManager(),
    data: {
      settings: getSettingsMap(),
      items: getItemsFiltered(session),
      categories: getCategoriesData(),
      platforms: getPlatformsData(),
      itemPlatformCosts: getItemPlatformCostsData(),
      invoices: getInvoicesFiltered(session),
      returns: getReturnsData(),
      warehouses: getWarehousesDataGS(session),
      warehouseStocks: getWarehouseStocksListGS(),
      warehouseMigrationStatus: migReport,
      users: getUsersData(session)
    }
  };
}

/**
 * ===================== 16. الموردين والمشتريات (Suppliers & Purchases) ===================== //
 */

function getSuppliersData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.SUPPLIERS);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getDataRange().getValues();
  var suppliers = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    suppliers.push({
      id: String(r[0]),
      name: String(r[1]),
      code: String(r[2] || ''),
      groupId: String(r[3] || ''),
      phone: String(r[4] || ''),
      phoneSecondary: String(r[5] || ''),
      email: String(r[6] || ''),
      address: String(r[7] || ''),
      taxNumber: String(r[8] || ''),
      commercialRecord: String(r[9] || ''),
      openingBalance: Number(r[10]) || 0,
      currentBalance: Number(r[11]) || 0,
      status: String(r[12] || 'active'),
      notes: String(r[13] || ''),
      createdAt: String(r[14] || '')
    });
  }
  return suppliers;
}

function saveSupplierData(supplier, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, SHEETS.SUPPLIERS);
  var isEdit = Boolean(supplier.id);
  var nowStr = new Date().toISOString();

  if (isEdit) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(supplier.id)) {
        var row = i + 1;
        sheet.getRange(row, 2).setValue(supplier.name);
        if (supplier.code !== undefined) sheet.getRange(row, 3).setValue(supplier.code);
        if (supplier.groupId !== undefined) sheet.getRange(row, 4).setValue(supplier.groupId);
        if (supplier.phone !== undefined) sheet.getRange(row, 5).setValue(supplier.phone);
        if (supplier.phoneSecondary !== undefined) sheet.getRange(row, 6).setValue(supplier.phoneSecondary);
        if (supplier.email !== undefined) sheet.getRange(row, 7).setValue(supplier.email);
        if (supplier.address !== undefined) sheet.getRange(row, 8).setValue(supplier.address);
        if (supplier.taxNumber !== undefined) sheet.getRange(row, 9).setValue(supplier.taxNumber);
        if (supplier.commercialRecord !== undefined) sheet.getRange(row, 10).setValue(supplier.commercialRecord);
        if (supplier.status !== undefined) sheet.getRange(row, 13).setValue(supplier.status);
        if (supplier.notes !== undefined) sheet.getRange(row, 14).setValue(supplier.notes);

        logAudit(session, 'SUPPLIER_EDIT', 'Supplier', supplier.id, 'تعديل بيانات المورد: ' + supplier.name);
        return { success: true, supplier: supplier };
      }
    }
    return { success: false, error: 'المورد غير موجود' };
  } else {
    var newId = supplier.id || ('sup-' + generateUUID().slice(0, 8));
    var opening = Number(supplier.openingBalance) || 0;
    var code = supplier.code || ('SUP-' + Math.floor(100 + Math.random() * 900));

    sheet.appendRow([
      newId,
      supplier.name,
      code,
      supplier.groupId || '',
      supplier.phone || '',
      supplier.phoneSecondary || '',
      supplier.email || '',
      supplier.address || '',
      supplier.taxNumber || '',
      supplier.commercialRecord || '',
      opening,
      opening,
      supplier.status || 'active',
      supplier.notes || '',
      nowStr
    ]);

    if (opening !== 0) {
      var sLedger = getOrCreateSheet(ss, SHEETS.SUPPLIER_LEDGER);
      sLedger.appendRow([
        generateUUID(),
        nowStr,
        newId,
        supplier.name,
        'رصيد افتتاحي',
        'OPN-' + code,
        opening < 0 ? Math.abs(opening) : 0,
        opening > 0 ? opening : 0,
        opening,
        'تسجيل رصيد افتتاحي للمورد',
        session.phone || 'المسؤول',
        ''
      ]);
    }

    logAudit(session, 'SUPPLIER_CREATE', 'Supplier', newId, 'إضافة مورد جديد: ' + supplier.name);
    return {
      success: true,
      supplier: {
        id: newId,
        name: supplier.name,
        code: code,
        groupId: supplier.groupId || '',
        phone: supplier.phone || '',
        openingBalance: opening,
        currentBalance: opening,
        status: supplier.status || 'active',
        createdAt: nowStr
      }
    };
  }
  });
}

function getSupplierGroupsData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.SUPPLIER_GROUPS);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getDataRange().getValues();
  var groups = [];
  for (var i = 1; i < data.length; i++) {
    groups.push({
      id: String(data[i][0]),
      name: String(data[i][1]),
      description: String(data[i][2] || ''),
      createdAt: String(data[i][3] || '')
    });
  }
  return groups;
}

function saveSupplierGroupData(group, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet(ss, SHEETS.SUPPLIER_GROUPS);
    var newId = group.id || ('grp-sup-' + generateUUID().slice(0, 8));
    var nowStr = new Date().toISOString();

    sheet.appendRow([newId, group.name, group.description || '', nowStr]);
    return { success: true, group: { id: newId, name: group.name, description: group.description || '', createdAt: nowStr } };
  });
}

function getSupplierLedgerData(supplierId, session, filters) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.SUPPLIER_LEDGER);
  var suppliers = getSuppliersData();
  var sup = null;
  for (var s = 0; s < suppliers.length; s++) {
    if (String(suppliers[s].id) === String(supplierId)) {
      sup = suppliers[s];
      break;
    }
  }

  var allLedger = [];
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (String(r[2]) === String(supplierId)) {
        allLedger.push({
          id: String(r[0]),
          date: String(r[1]),
          supplierId: String(r[2]),
          supplierName: String(r[3]),
          transactionType: String(r[4]),
          documentNumber: String(r[5]),
          debit: Number(r[6]) || 0,
          credit: Number(r[7]) || 0,
          balanceAfter: Number(r[8]) || 0,
          statement: String(r[9] || ''),
          userName: String(r[10] || ''),
          notes: String(r[11] || '')
        });
      }
    }
  }

  allLedger.sort(function(a, b) {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  var fromDate = filters ? (filters.from || filters.startDate || null) : null;
  var toDate = filters ? (filters.to || filters.endDate || null) : null;

  var hasOpeningEntry = false;
  for (var k = 0; k < allLedger.length; k++) {
    if (allLedger[k].transactionType === 'رصيد افتتاحي') {
      hasOpeningEntry = true;
      break;
    }
  }

  var baseOpening = hasOpeningEntry ? 0 : (sup ? (Number(sup.openingBalance) || 0) : 0);

  if (!fromDate && !toDate) {
    var runningAll = baseOpening;
    for (var a = 0; a < allLedger.length; a++) {
      runningAll += (Number(allLedger[a].credit) || 0) - (Number(allLedger[a].debit) || 0);
      allLedger[a].balanceAfter = runningAll;
    }
    return {
      success: true,
      ledger: allLedger,
      supplier: sup,
      openingBalanceForPeriod: sup ? (Number(sup.openingBalance) || 0) : 0
    };
  }

  var openingBalanceBeforeFrom = baseOpening;
  if (fromDate) {
    for (var m = 0; m < allLedger.length; m++) {
      var entryDateStr = toCairoDateStrGS(allLedger[m].date);
      if (entryDateStr && entryDateStr < fromDate) {
        openingBalanceBeforeFrom += (Number(allLedger[m].credit) || 0) - (Number(allLedger[m].debit) || 0);
      }
    }
  }

  var inPeriod = [];
  var runningPeriod = openingBalanceBeforeFrom;
  for (var p = 0; p < allLedger.length; p++) {
    if (isDateInRangeGS(allLedger[p].date, fromDate, toDate)) {
      var itemCopy = {};
      for (var prop in allLedger[p]) {
        itemCopy[prop] = allLedger[p][prop];
      }
      runningPeriod += (Number(itemCopy.credit) || 0) - (Number(itemCopy.debit) || 0);
      itemCopy.balanceAfter = runningPeriod;
      inPeriod.push(itemCopy);
    }
  }

  return {
    success: true,
    ledger: inPeriod,
    supplier: sup,
    openingBalanceForPeriod: openingBalanceBeforeFrom
  };
}

function createSupplierVoucherData(payload, session) {
  var reqIdemKey = getValidatedIdempotencyKeyGS(payload);
  if (!reqIdemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR_GS };
  }
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sSuppliers = getOrCreateSheet(ss, SHEETS.SUPPLIERS);
    var sLedger = ensureSheetWithHeaders(ss, SHEETS.SUPPLIER_LEDGER, [
      'ID', 'التاريخ والوقت', 'ID المورد', 'اسم المورد', 'نوع المعاملة', 'رقم المستند / المرجع',
      'مدين (لنا)', 'دائن (علينا)', 'الرصيد بعد الحركة', 'البيان / الشرح', 'المستخدم', 'ملاحظات', 'idempotencyKey'
    ]);
    var dupMatch = findRowByIdempotencyKeyGS(sLedger, reqIdemKey);
    if (dupMatch) {
      return { success: true, duplicate: true, voucherId: String(dupMatch.rowValues[5] || '') };
    }

    var sCashboxes = getOrCreateSheet(ss, SHEETS.CASHBOXES);
    var sCashboxTx = ensureSheetWithHeaders(ss, SHEETS.CASHBOX_TRANSACTIONS, [
      'ID', 'التاريخ والوقت', 'ID الخزينة', 'اسم الخزينة', 'نوع الحركة', 'رقم المستند / المرجع',
      'المبلغ', 'الرصيد بعد الحركة', 'الجهة / الطرف الآخر', 'البيان', 'المستخدم', 'ملاحظات', 'idempotencyKey'
    ]);

    var now = new Date();
    var dateStr = Utilities.formatDate(now, 'GMT+2', 'yyyyMMdd');
    var prefix = payload.type === 'سند صرف' ? 'PV' : 'RV';
    var docNumber = prefix + '-' + dateStr + '-' + Math.floor(1000 + Math.random() * 9000);
    var isoDate = now.toISOString();
    var amount = Number(payload.amount) || 0;

    var supData = sSuppliers.getDataRange().getValues();
    var supRow = -1;
    var supName = '';
    var currentSupBal = 0;

    for (var i = 1; i < supData.length; i++) {
      if (String(supData[i][0]) === String(payload.supplierId)) {
        supRow = i + 1;
        supName = String(supData[i][1]);
        currentSupBal = Number(supData[i][11]) || 0;
        break;
      }
    }

    if (supRow === -1) return { success: false, error: 'المورد غير موجود' };

    var newSupBal = payload.type === 'سند صرف' ? (currentSupBal - amount) : (currentSupBal + amount);
    sSuppliers.getRange(supRow, 12).setValue(newSupBal);

    sLedger.appendRow(buildRowWithIdempotencyKeyGS(sLedger, [
      generateUUID(),
      isoDate,
      payload.supplierId,
      supName,
      payload.type,
      docNumber,
      payload.type === 'سند صرف' ? amount : 0,
      payload.type === 'سند قبض' ? amount : 0,
      newSupBal,
      payload.statement || (payload.type + ' للمورد ' + supName),
      session.phone || 'المسؤول',
      payload.notes || ''
    ], reqIdemKey));

    var cbData = sCashboxes.getDataRange().getValues();
    for (var c = 1; c < cbData.length; c++) {
      if (String(cbData[c][0]) === String(payload.cashboxId)) {
        var cbRow = c + 1;
        var cbName = String(cbData[c][1]);
        var cbBal = Number(cbData[c][5]) || 0;
        var newCbBal = payload.type === 'سند صرف' ? (cbBal - amount) : (cbBal + amount);
        sCashboxes.getRange(cbRow, 6).setValue(newCbBal);

        sCashboxTx.appendRow(buildRowWithIdempotencyKeyGS(sCashboxTx, [
          generateUUID(),
          isoDate,
          payload.cashboxId,
          cbName,
          payload.type === 'سند صرف' ? 'سند صرف مورد' : 'إيداع',
          docNumber,
          payload.type === 'سند صرف' ? -amount : amount,
          newCbBal,
          supName,
          payload.type + ' - ' + supName,
          session.phone || 'المسؤول',
          payload.notes || ''
        ], reqIdemKey));
        break;
      }
    }

    logAudit(session, 'SUPPLIER_VOUCHER', 'Supplier', payload.supplierId, payload.type + ' رقم ' + docNumber + ' بمبلغ: ' + amount);
    return { success: true, voucherId: docNumber };
  });
}

function getPurchasesData(session, filters) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sPurchases = ss.getSheetByName(SHEETS.PURCHASES);
  var sLines = ss.getSheetByName(SHEETS.PURCHASE_LINES);
  if (!sPurchases || sPurchases.getLastRow() <= 1) return [];

  var fromDate = filters ? (filters.from || filters.startDate || null) : null;
  var toDate = filters ? (filters.to || filters.endDate || null) : null;

  var pData = sPurchases.getDataRange().getValues();
  var lineMap = {};

  if (sLines && sLines.getLastRow() > 1) {
    var lData = sLines.getDataRange().getValues();
    for (var j = 1; j < lData.length; j++) {
      var invNo = String(lData[j][0]);
      if (!lineMap[invNo]) lineMap[invNo] = [];
      lineMap[invNo].push({
        invoiceNumber: invNo,
        lineIndex: Number(lData[j][1]),
        itemId: String(lData[j][2]),
        sku: String(lData[j][3] || ''),
        itemName: String(lData[j][4]),
        quantity: Number(lData[j][5]) || 0,
        receivedQuantity: Number(lData[j][6]) || 0,
        unitCost: Number(lData[j][7]) || 0,
        packagingCost: Number(lData[j][8]) || 0,
        taxRate: Number(lData[j][9]) || 0,
        taxAmount: Number(lData[j][10]) || 0,
        discountAmount: Number(lData[j][11]) || 0,
        totalLine: Number(lData[j][12]) || 0,
        barcode: String(lData[j][13] || ''),
        notes: String(lData[j][14] || '')
      });
    }
  }

  var whLookupPur = getWarehouseLookupMapGS(ss);
  var purchases = [];
  for (var i = 1; i < pData.length; i++) {
    var r = pData[i];
    var purDateStr = String(r[2]);
    if (fromDate || toDate) {
      if (!isDateInRangeGS(purDateStr, fromDate, toDate)) {
        continue;
      }
    }
    var invNum = String(r[0]);
    var purWhId = (r.length > 20 && r[20] !== undefined && String(r[20]).trim() !== '')
      ? String(r[20]).trim()
      : whLookupPur.defaultId;
    purchases.push({
      invoiceNumber: invNum,
      supplierInvoiceNumber: String(r[1] || ''),
      date: purDateStr,
      supplierId: String(r[3]),
      supplierName: String(r[4]),
      subtotal: Number(r[5]) || 0,
      taxAmount: Number(r[6]) || 0,
      discountAmount: Number(r[7]) || 0,
      shippingFee: Number(r[8]) || 0,
      netTotal: Number(r[9]) || 0,
      paidAmount: Number(r[10]) || 0,
      remainingAmount: Number(r[11]) || 0,
      paymentStatus: String(r[12] || 'آجل'),
      paymentMethod: String(r[13] || 'نقدي'),
      cashboxId: String(r[14] || ''),
      receivingStatus: String(r[15] || 'مستلم بالكامل'),
      createdBy: String(r[16] || ''),
      notes: String(r[17] || ''),
      createdAt: String(r[18] || ''),
      warehouseId: purWhId,
      warehouseName: whLookupPur.byId[purWhId] || whLookupPur.defaultName,
      lines: lineMap[invNum] || []
    });
  }
  return purchases;
}

function createPurchaseData(payload, session) {
  var reqIdemKey = getValidatedIdempotencyKeyGS(payload);
  if (!reqIdemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR_GS };
  }
  return withScriptLock(function() {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      migrateItemStocksToMainWarehouseOnceGS();
      var sPurchases = ensureSheetWithHeaders(ss, SHEETS.PURCHASES, [
        'رقم فاتورة الشراء', 'رقم فاتورة المورد', 'التاريخ', 'ID المورد', 'اسم المورد',
        'إجمالي المنتجات قبل الضريبة', 'إجمالي الضريبة', 'إجمالي الخصم', 'مصاريف الشحن والتفريغ',
        'الصافي الإجمالي', 'المبلغ المدفوع', 'المبلغ المتبقي', 'حالة الدفع', 'طريقة الدفع',
        'الخزينة المستخدمة', 'حالة الاستلام', 'المستخدم', 'ملاحظات', 'تاريخ الإنشاء', 'idempotencyKey', 'warehouseId'
      ]);
      var whLookupDupPur = getWarehouseLookupMapGS(ss);
      var dupPurMatch = findRowByIdempotencyKeyGS(sPurchases, reqIdemKey);
      if (dupPurMatch) {
        var pr = dupPurMatch.rowValues;
        var dupPurWhId = (pr.length > 20 && pr[20] !== undefined && String(pr[20]).trim() !== '')
          ? String(pr[20]).trim()
          : whLookupDupPur.defaultId;
        return {
          success: true,
          duplicate: true,
          invoice: {
            invoiceNumber: String(pr[0] || ''),
            netTotal: Number(pr[9]) || 0,
            idempotencyKey: reqIdemKey,
            warehouseId: dupPurWhId,
            warehouseName: whLookupDupPur.byId[dupPurWhId] || whLookupDupPur.defaultName
          }
        };
      }

      var purWhRes = resolveWarehouseForOperationGS(
        ss,
        payload.warehouseId || null,
        session,
        payload.warehouseId
          ? { requireActive: true, enforceUserAccess: true }
          : { requireActive: false, enforceUserAccess: false }
      );
      if (!purWhRes.ok) {
        return { success: false, statusCode: purWhRes.statusCode || 400, error: purWhRes.error };
      }
      var targetWhPur = purWhRes.warehouse;

      var sLines = getOrCreateSheet(ss, SHEETS.PURCHASE_LINES);
      var sItems = getOrCreateSheet(ss, SHEETS.ITEMS);
      var sSuppliers = getOrCreateSheet(ss, SHEETS.SUPPLIERS);
      var sLedger = getOrCreateSheet(ss, SHEETS.SUPPLIER_LEDGER);
      var sMovements = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
        'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
        'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
      ]);
      var sCashboxes = getOrCreateSheet(ss, SHEETS.CASHBOXES);
      var sCashboxTx = ensureSheetWithHeaders(ss, SHEETS.CASHBOX_TRANSACTIONS, [
        'ID', 'التاريخ والوقت', 'ID الخزينة', 'اسم الخزينة', 'نوع الحركة', 'رقم المستند / المرجع',
        'المبلغ', 'الرصيد بعد الحركة', 'الجهة / الطرف الآخر', 'البيان', 'المستخدم', 'ملاحظات', 'idempotencyKey'
      ]);

      var now = new Date();
      var dateStr = Utilities.formatDate(now, 'GMT+2', 'yyyyMMdd');
      var invoiceNumber = payload.invoiceNumber || ('PUR-' + dateStr + '-' + Math.floor(1000 + Math.random() * 9000));
      var isoDate = now.toISOString();

      var itemData = sItems.getDataRange().getValues();
      var itemMap = {};
      for (var k = 1; k < itemData.length; k++) {
        itemMap[String(itemData[k][0])] = {
          rowIndex: k + 1,
          name: String(itemData[k][1]),
          currentStock: Number(itemData[k][6]) || 0
        };
      }

      var lines = payload.lines || [];
      var subtotal = 0;
      var taxTotal = 0;
      var discountTotal = Number(payload.discountAmount) || 0;
      var shippingTotal = Number(payload.shippingFee) || 0;

      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        var qty = Number(ln.quantity) || 1;
        var unitCost = Number(ln.unitCost) || 0;
        var taxRate = Number(ln.taxRate) || 0;
        var taxAmt = (unitCost * qty) * (taxRate / 100);
        var discAmt = Number(ln.discountAmount) || 0;
        var lineTot = (unitCost * qty) + taxAmt - discAmt;

        subtotal += unitCost * qty;
        taxTotal += taxAmt;

        sLines.appendRow([
          invoiceNumber,
          i + 1,
          ln.itemId,
          ln.sku || '',
          ln.itemName,
          qty,
          qty,
          unitCost,
          Number(ln.packagingCost) || 0,
          taxRate,
          taxAmt,
          discAmt,
          lineTot,
          ln.barcode || '',
          ln.notes || ''
        ]);

        var itInfo = itemMap[String(ln.itemId)];
        if (itInfo) {
          var purAdj = adjustItemWarehouseDeltaGS(ss, String(ln.itemId), targetWhPur.id, qty, isoDate);
          var newTotStock = recomputeItemTotalStockGS(ss, String(ln.itemId), sItems);
          if (unitCost > 0) sItems.getRange(itInfo.rowIndex, 5).setValue(unitCost);

          sMovements.appendRow(buildRowWithWarehouseGS(sMovements, [
            generateUUID(),
            ln.itemId,
            itInfo.name,
            'شراء',
            qty,
            purAdj.balanceAfter,
            'فاتورة شراء من المورد: ' + (payload.supplierName || ''),
            invoiceNumber,
            session.phone || 'المسؤول',
            isoDate,
            ln.notes || ''
          ], targetWhPur.id));
          itInfo.currentStock = newTotStock;
        }
      }

      var netTotal = subtotal + taxTotal - discountTotal + shippingTotal;
      var paidAmount = Number(payload.paidAmount) || 0;
      var remainingAmount = Math.max(0, netTotal - paidAmount);

      sPurchases.appendRow(buildRowWithWarehouseGS(sPurchases, [
        invoiceNumber,
        payload.supplierInvoiceNumber || '',
        isoDate,
        payload.supplierId,
        payload.supplierName,
        subtotal,
        taxTotal,
        discountTotal,
        shippingTotal,
        netTotal,
        paidAmount,
        remainingAmount,
        remainingAmount === 0 ? 'مدفوع بالكامل' : (paidAmount > 0 ? 'مدفوع جزئياً' : 'آجل'),
        payload.paymentMethod || 'نقدي',
        payload.cashboxId || '',
        'مستلم بالكامل',
        session.phone || 'المسؤول',
        payload.notes || '',
        isoDate
      ], targetWhPur.id, reqIdemKey));

      // تحديث رصيد المورد
      var supData = sSuppliers.getDataRange().getValues();
      for (var s = 1; s < supData.length; s++) {
        if (String(supData[s][0]) === String(payload.supplierId)) {
          var supRow = s + 1;
          var currentSupBal = Number(supData[s][11]) || 0;
          var updatedSupBal = currentSupBal + remainingAmount;
          sSuppliers.getRange(supRow, 12).setValue(updatedSupBal);

          sLedger.appendRow([
            generateUUID(),
            isoDate,
            payload.supplierId,
            payload.supplierName,
            'فاتورة شراء',
            invoiceNumber,
            0,
            netTotal,
            updatedSupBal,
            'فاتورة شراء ' + invoiceNumber,
            session.phone || 'المسؤول',
            payload.notes || ''
          ]);
          break;
        }
      }

      // إذا تم الدفع من خزينة
      if (paidAmount > 0 && payload.cashboxId) {
        var cbData = sCashboxes.getDataRange().getValues();
        for (var c = 1; c < cbData.length; c++) {
          if (String(cbData[c][0]) === String(payload.cashboxId)) {
            var cbRow = c + 1;
            var cbName = String(cbData[c][1]);
            var cbBal = Number(cbData[c][5]) || 0;
            var newCbBal = cbBal - paidAmount;
            sCashboxes.getRange(cbRow, 6).setValue(newCbBal);

            sCashboxTx.appendRow(buildRowWithIdempotencyKeyGS(sCashboxTx, [
              generateUUID(),
              isoDate,
              payload.cashboxId,
              cbName,
              'سداد مشتريات',
              invoiceNumber,
              -paidAmount,
              newCbBal,
              payload.supplierName,
              'سداد فاتورة شراء ' + invoiceNumber,
              session.phone || 'المسؤول',
              payload.notes || ''
            ], reqIdemKey));
            break;
          }
        }
      }

      logAudit(session, 'PURCHASE_CREATE', 'Purchase', invoiceNumber, 'إنشاء فاتورة شراء بقيمة: ' + netTotal);
      return {
        success: true,
        invoice: {
          invoiceNumber: invoiceNumber,
          netTotal: netTotal,
          idempotencyKey: reqIdemKey,
          warehouseId: targetWhPur.id,
          warehouseName: targetWhPur.name
        }
      };
    } catch (err) {
      console.error('[AppsScript createPurchaseData Error]:', err && (err.stack || err.message || err));
      return { success: false, error: sanitizeClientErrorMessageGS(err, 'تعذر حفظ فاتورة الشراء') };
    }
  });
}

function getPurchaseReturnsData(filters) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.PURCHASE_RETURNS);
  var sLines = ss.getSheetByName(SHEETS.PURCHASE_RETURN_LINES);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var fromDate = filters ? (filters.from || filters.startDate || null) : null;
  var toDate = filters ? (filters.to || filters.endDate || null) : null;

  var lineMap = {};
  if (sLines && sLines.getLastRow() > 1) {
    var lData = sLines.getDataRange().getValues();
    for (var j = 1; j < lData.length; j++) {
      var retNo = String(lData[j][0]);
      if (!lineMap[retNo]) lineMap[retNo] = [];
      lineMap[retNo].push({
        returnNumber: retNo,
        lineIndex: Number(lData[j][1]) || (j),
        itemId: String(lData[j][2]),
        itemName: String(lData[j][3]),
        quantity: Number(lData[j][4]) || 0,
        unitCost: Number(lData[j][5]) || 0,
        taxAmount: Number(lData[j][6]) || 0,
        totalLine: Number(lData[j][7]) || 0,
        condition: String(lData[j][8] || 'سليم')
      });
    }
  }

  var whLookupPRet = getWarehouseLookupMapGS(ss);
  var data = sheet.getDataRange().getValues();
  var returns = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var retDateStr = String(r[2]);
    if (fromDate || toDate) {
      if (!isDateInRangeGS(retDateStr, fromDate, toDate)) {
        continue;
      }
    }
    var retNum = String(r[0]);
    var pRetWhId = (r.length > 14 && r[14] !== undefined && String(r[14]).trim() !== '')
      ? String(r[14]).trim()
      : whLookupPRet.defaultId;
    returns.push({
      returnNumber: retNum,
      purchaseInvoiceNumber: String(r[1] || ''),
      date: retDateStr,
      supplierId: String(r[3]),
      supplierName: String(r[4]),
      totalAmount: Number(r[5]) || 0,
      taxAmount: Number(r[6]) || 0,
      netTotal: Number(r[7]) || 0,
      refundStatus: String(r[8]),
      cashboxId: String(r[9] || ''),
      reason: String(r[10] || ''),
      createdBy: String(r[11] || ''),
      notes: String(r[12] || ''),
      warehouseId: pRetWhId,
      warehouseName: whLookupPRet.byId[pRetWhId] || whLookupPRet.defaultName,
      lines: lineMap[retNum] || []
    });
  }
  return returns;
}

function createPurchaseReturnData(payload, session) {
  var reqIdemKey = getValidatedIdempotencyKeyGS(payload);
  if (!reqIdemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR_GS };
  }
  return withScriptLock(function() {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      migrateItemStocksToMainWarehouseOnceGS();
      var sReturns = ensureSheetWithHeaders(ss, SHEETS.PURCHASE_RETURNS, [
        'رقم إذن مرتجع الشراء', 'رقم فاتورة الشراء الأصلية', 'التاريخ', 'ID المورد', 'اسم المورد',
        'إجمالي قيمة المرتجع', 'الضريبة المستردة', 'الصافي المسترد', 'حالة الاسترداد المالي',
        'الخزينة المستلمة', 'سبب الإرجاع', 'المستخدم', 'ملاحظات', 'idempotencyKey', 'warehouseId'
      ]);
      var whLookupDupPR = getWarehouseLookupMapGS(ss);
      var dupPRetMatch = findRowByIdempotencyKeyGS(sReturns, reqIdemKey);
      if (dupPRetMatch) {
        var prr = dupPRetMatch.rowValues;
        var dupPRWhId = (prr.length > 14 && prr[14] !== undefined && String(prr[14]).trim() !== '')
          ? String(prr[14]).trim()
          : whLookupDupPR.defaultId;
        return {
          success: true,
          duplicate: true,
          returnRecord: {
            returnNumber: String(prr[0] || ''),
            netTotal: Number(prr[7]) || 0,
            idempotencyKey: reqIdemKey,
            warehouseId: dupPRWhId,
            warehouseName: whLookupDupPR.byId[dupPRWhId] || whLookupDupPR.defaultName
          }
        };
      }

      // تحديد المخزن لمرتجع الشراء: المخزن المرسل أو مخزن فاتورة الشراء الأصلية أو المخزن الافتراضي
      var origPurWhId = '';
      if (payload.purchaseInvoiceNumber) {
        var sPurchasesForRet = ss.getSheetByName(SHEETS.PURCHASES);
        if (sPurchasesForRet && sPurchasesForRet.getLastRow() > 1) {
          var purRowsForRet = sPurchasesForRet.getDataRange().getValues();
          var colPurWhRet = getHeaderMap(sPurchasesForRet).get('warehouseId', 20);
          for (var pi = 1; pi < purRowsForRet.length; pi++) {
            if (String(purRowsForRet[pi][0]) === String(payload.purchaseInvoiceNumber)) {
              if (colPurWhRet !== -1 && purRowsForRet[pi].length > colPurWhRet && String(purRowsForRet[pi][colPurWhRet] || '').trim() !== '') {
                origPurWhId = String(purRowsForRet[pi][colPurWhRet]).trim();
              }
              break;
            }
          }
        }
      }

      var hasExplicitPRWh = payload.warehouseId !== undefined && payload.warehouseId !== null && String(payload.warehouseId).trim() !== '';
      var pRetWhRes = resolveWarehouseForOperationGS(
        ss,
        hasExplicitPRWh ? payload.warehouseId : (origPurWhId || null),
        session,
        hasExplicitPRWh
          ? { requireActive: true, enforceUserAccess: true }
          : { requireActive: false, enforceUserAccess: false }
      );
      if (!pRetWhRes.ok) {
        return { success: false, statusCode: pRetWhRes.statusCode || 400, error: pRetWhRes.error };
      }
      var targetWhPRet = pRetWhRes.warehouse;

      var sLines = getOrCreateSheet(ss, SHEETS.PURCHASE_RETURN_LINES);
      var sItems = getOrCreateSheet(ss, SHEETS.ITEMS);
      var sSuppliers = getOrCreateSheet(ss, SHEETS.SUPPLIERS);
      var sLedger = getOrCreateSheet(ss, SHEETS.SUPPLIER_LEDGER);
      var sMovements = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
        'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
        'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
      ]);

      var now = new Date();
      var dateStr = Utilities.formatDate(now, 'GMT+2', 'yyyyMMdd');
      var returnNumber = 'PRET-' + dateStr + '-' + Math.floor(1000 + Math.random() * 9000);
      var isoDate = now.toISOString();

      var itemData = sItems.getDataRange().getValues();
      var itemMap = {};
      for (var k = 1; k < itemData.length; k++) {
        itemMap[String(itemData[k][0])] = {
          rowIndex: k + 1,
          name: String(itemData[k][1]),
          currentStock: Number(itemData[k][6]) || 0
        };
      }

      var lines = payload.lines || [];
      var totalAmount = 0;
      var taxTotal = 0;

      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        var qty = Number(ln.quantity) || 1;
        var unitCost = Number(ln.unitCost) || 0;
        var taxAmt = Number(ln.taxAmount) || 0;
        var lineTot = (unitCost * qty) + taxAmt;

        totalAmount += unitCost * qty;
        taxTotal += taxAmt;

        sLines.appendRow([
          returnNumber,
          i + 1,
          ln.itemId,
          ln.itemName,
          qty,
          unitCost,
          taxAmt,
          lineTot,
          ln.condition || 'سليم'
        ]);

        var itInfo = itemMap[String(ln.itemId)];
        if (itInfo) {
          var pRetAdj = adjustItemWarehouseDeltaGS(ss, String(ln.itemId), targetWhPRet.id, -qty, isoDate);
          var newTotAfterPRet = recomputeItemTotalStockGS(ss, String(ln.itemId), sItems);
          sMovements.appendRow(buildRowWithWarehouseGS(sMovements, [
            generateUUID(),
            ln.itemId,
            itInfo.name,
            'مرتجع شراء',
            -qty,
            pRetAdj.balanceAfter,
            'مرتجع مشتريات للمورد: ' + (payload.supplierName || ''),
            returnNumber,
            session.phone || 'المسؤول',
            isoDate,
            ''
          ], targetWhPRet.id));
          itInfo.currentStock = newTotAfterPRet;
        }
      }

      var netTotal = totalAmount + taxTotal;

      sReturns.appendRow(buildRowWithWarehouseGS(sReturns, [
        returnNumber,
        payload.purchaseInvoiceNumber || '',
        isoDate,
        payload.supplierId,
        payload.supplierName,
        totalAmount,
        taxTotal,
        netTotal,
        payload.refundStatus || 'قيد على الحساب',
        payload.cashboxId || '',
        payload.reason || '',
        session.phone || 'المسؤول',
        payload.notes || ''
      ], targetWhPRet.id, reqIdemKey));

      // تخفيض رصيد المورد
      var supData = sSuppliers.getDataRange().getValues();
      for (var s = 1; s < supData.length; s++) {
        if (String(supData[s][0]) === String(payload.supplierId)) {
          var supRow = s + 1;
          var currentSupBal = Number(supData[s][11]) || 0;
          var updatedSupBal = Math.max(0, currentSupBal - netTotal);
          sSuppliers.getRange(supRow, 12).setValue(updatedSupBal);

          sLedger.appendRow([
            generateUUID(),
            isoDate,
            payload.supplierId,
            payload.supplierName,
            'مرتجع شراء',
            returnNumber,
            netTotal,
            0,
            updatedSupBal,
            'مرتجع مشتريات ' + returnNumber,
            session.phone || 'المسؤول',
            ''
          ]);
          break;
        }
      }

      logAudit(session, 'PURCHASE_RETURN', 'PurchaseReturn', returnNumber, 'تسجيل مرتجع شراء بقيمة: ' + netTotal);
      return {
        success: true,
        returnRecord: {
          returnNumber: returnNumber,
          netTotal: netTotal,
          idempotencyKey: reqIdemKey,
          warehouseId: targetWhPRet.id,
          warehouseName: targetWhPRet.name
        }
      };
    } catch (err) {
      console.error('[AppsScript createPurchaseReturnData Error]:', err && (err.stack || err.message || err));
      return { success: false, error: sanitizeClientErrorMessageGS(err, 'تعذر حفظ مرتجع الشراء') };
    }
  });
}

/**
 * ===================== 17. العملاء (Customers) ===================== //
 */

function getCustomersData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.CUSTOMERS);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getDataRange().getValues();
  var customers = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var custId = String(r[0]);
    customers.push({
      id: custId,
      name: String(r[1]),
      code: String(r[2] || ''),
      groupId: String(r[3] || ''),
      phone: String(r[4] || ''),
      phoneSecondary: String(r[5] || ''),
      email: String(r[6] || ''),
      city: String(r[7] || ''),
      address: String(r[8] || ''),
      taxNumber: String(r[9] || ''),
      creditLimit: Number(r[10]) || 0,
      openingBalance: Number(r[11]) || 0,
      currentBalance: computePartyBalanceGS(ss, 'customer', custId),
      status: String(r[13] || 'active'),
      notes: String(r[14] || ''),
      createdAt: String(r[15] || '')
    });
  }
  return customers;
}

function saveCustomerData(customer, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, SHEETS.CUSTOMERS);
  var isEdit = Boolean(customer.id);
  var nowStr = new Date().toISOString();

  if (isEdit) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(customer.id)) {
        var row = i + 1;
        sheet.getRange(row, 2).setValue(customer.name);
        if (customer.code !== undefined) sheet.getRange(row, 3).setValue(customer.code);
        if (customer.groupId !== undefined) sheet.getRange(row, 4).setValue(customer.groupId);
        if (customer.phone !== undefined) sheet.getRange(row, 5).setValue(customer.phone);
        if (customer.phoneSecondary !== undefined) sheet.getRange(row, 6).setValue(customer.phoneSecondary);
        if (customer.email !== undefined) sheet.getRange(row, 7).setValue(customer.email);
        if (customer.city !== undefined) sheet.getRange(row, 8).setValue(customer.city);
        if (customer.address !== undefined) sheet.getRange(row, 9).setValue(customer.address);
        if (customer.taxNumber !== undefined) sheet.getRange(row, 10).setValue(customer.taxNumber);
        if (customer.creditLimit !== undefined) sheet.getRange(row, 11).setValue(Number(customer.creditLimit) || 0);
        if (customer.status !== undefined) sheet.getRange(row, 14).setValue(customer.status);
        if (customer.notes !== undefined) sheet.getRange(row, 15).setValue(customer.notes);

        logAudit(session, 'CUSTOMER_EDIT', 'Customer', customer.id, 'تعديل بيانات العميل: ' + customer.name);
        return { success: true, customer: customer };
      }
    }
    return { success: false, error: 'العميل غير موجود' };
  } else {
    var newId = customer.id || ('cust-' + generateUUID().slice(0, 8));
    var opening = Number(customer.openingBalance) || 0;
    var code = customer.code || ('CUST-' + Math.floor(100 + Math.random() * 900));

    sheet.appendRow([
      newId,
      customer.name,
      code,
      customer.groupId || '',
      customer.phone || '',
      customer.phoneSecondary || '',
      customer.email || '',
      customer.city || '',
      customer.address || '',
      customer.taxNumber || '',
      Number(customer.creditLimit) || 0,
      opening,
      opening,
      customer.status || 'active',
      customer.notes || '',
      nowStr
    ]);

    if (opening !== 0) {
      var sLedger = getOrCreateSheet(ss, SHEETS.CUSTOMER_LEDGER);
      sLedger.appendRow([
        generateUUID(),
        nowStr,
        newId,
        customer.name,
        'رصيد افتتاحي',
        'OPN-' + code,
        opening > 0 ? opening : 0,
        opening < 0 ? Math.abs(opening) : 0,
        opening,
        'تسجيل رصيد افتتاحي للعميل',
        session.phone || 'المسؤول',
        ''
      ]);
    }

    logAudit(session, 'CUSTOMER_CREATE', 'Customer', newId, 'إضافة عميل جديد: ' + customer.name);
    return {
      success: true,
      customer: {
        id: newId,
        name: customer.name,
        code: code,
        openingBalance: opening,
        currentBalance: opening,
        status: customer.status || 'active',
        createdAt: nowStr
      }
    };
  }
  });
}

function getCustomerGroupsData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.CUSTOMER_GROUPS);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getDataRange().getValues();
  var groups = [];
  for (var i = 1; i < data.length; i++) {
    groups.push({
      id: String(data[i][0]),
      name: String(data[i][1]),
      discountPercent: Number(data[i][2]) || 0,
      description: String(data[i][3] || ''),
      createdAt: String(data[i][4] || '')
    });
  }
  return groups;
}

function saveCustomerGroupData(group, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet(ss, SHEETS.CUSTOMER_GROUPS);
    var newId = group.id || ('cgrp-' + generateUUID().slice(0, 8));
    var nowStr = new Date().toISOString();

    sheet.appendRow([newId, group.name, Number(group.discountPercent) || 0, group.description || '', nowStr]);
    return { success: true, group: { id: newId, name: group.name, discountPercent: Number(group.discountPercent) || 0, createdAt: nowStr } };
  });
}

function getCustomerLedgerData(customerId, session, filters) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.CUSTOMER_LEDGER);
  var customers = getCustomersData();
  var cust = null;
  for (var c = 0; c < customers.length; c++) {
    if (String(customers[c].id) === String(customerId)) {
      cust = customers[c];
      break;
    }
  }

  var allLedger = [];
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (String(r[2]) === String(customerId)) {
        allLedger.push({
          id: String(r[0]),
          date: String(r[1]),
          customerId: String(r[2]),
          customerName: String(r[3]),
          transactionType: String(r[4]),
          documentNumber: String(r[5]),
          debit: Number(r[6]) || 0,
          credit: Number(r[7]) || 0,
          balanceAfter: Number(r[8]) || 0,
          statement: String(r[9] || ''),
          userName: String(r[10] || ''),
          notes: String(r[11] || '')
        });
      }
    }
  }

  allLedger.sort(function(a, b) {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  var fromDate = filters ? (filters.from || filters.startDate || null) : null;
  var toDate = filters ? (filters.to || filters.endDate || null) : null;

  var hasOpeningEntry = false;
  for (var k = 0; k < allLedger.length; k++) {
    if (allLedger[k].transactionType === 'رصيد افتتاحي') {
      hasOpeningEntry = true;
      break;
    }
  }

  var baseOpening = hasOpeningEntry ? 0 : (cust ? (Number(cust.openingBalance) || 0) : 0);

  if (!fromDate && !toDate) {
    var runningAll = baseOpening;
    for (var a = 0; a < allLedger.length; a++) {
      runningAll += (Number(allLedger[a].debit) || 0) - (Number(allLedger[a].credit) || 0);
      allLedger[a].balanceAfter = runningAll;
    }
    return {
      success: true,
      ledger: allLedger,
      customer: cust,
      openingBalanceForPeriod: cust ? (Number(cust.openingBalance) || 0) : 0
    };
  }

  var openingBalanceBeforeFrom = baseOpening;
  if (fromDate) {
    for (var m = 0; m < allLedger.length; m++) {
      var entryDateStr = toCairoDateStrGS(allLedger[m].date);
      if (entryDateStr && entryDateStr < fromDate) {
        openingBalanceBeforeFrom += (Number(allLedger[m].debit) || 0) - (Number(allLedger[m].credit) || 0);
      }
    }
  }

  var inPeriod = [];
  var runningPeriod = openingBalanceBeforeFrom;
  for (var p = 0; p < allLedger.length; p++) {
    if (isDateInRangeGS(allLedger[p].date, fromDate, toDate)) {
      var itemCopy = {};
      for (var prop in allLedger[p]) {
        itemCopy[prop] = allLedger[p][prop];
      }
      runningPeriod += (Number(itemCopy.debit) || 0) - (Number(itemCopy.credit) || 0);
      itemCopy.balanceAfter = runningPeriod;
      inPeriod.push(itemCopy);
    }
  }

  return {
    success: true,
    ledger: inPeriod,
    customer: cust,
    openingBalanceForPeriod: openingBalanceBeforeFrom
  };
}

function createCustomerVoucherData(payload, session) {
  var reqIdemKey = getValidatedIdempotencyKeyGS(payload);
  if (!reqIdemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR_GS };
  }
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sCustomers = getOrCreateSheet(ss, SHEETS.CUSTOMERS);
    var sLedger = ensureSheetWithHeaders(ss, SHEETS.CUSTOMER_LEDGER, [
      'ID', 'التاريخ والوقت', 'ID العميل', 'اسم العميل', 'نوع المعاملة', 'رقم المستند / المرجع',
      'مدين (عليه)', 'دائن (له)', 'الرصيد بعد الحركة', 'البيان / الشرح', 'المستخدم', 'ملاحظات', 'idempotencyKey'
    ]);
    var dupMatch = findRowByIdempotencyKeyGS(sLedger, reqIdemKey);
    if (dupMatch) {
      return { success: true, duplicate: true, voucherId: String(dupMatch.rowValues[5] || '') };
    }

    var sCashboxes = getOrCreateSheet(ss, SHEETS.CASHBOXES);
    var sCashboxTx = ensureSheetWithHeaders(ss, SHEETS.CASHBOX_TRANSACTIONS, [
      'ID', 'التاريخ والوقت', 'ID الخزينة', 'اسم الخزينة', 'نوع الحركة', 'رقم المستند / المرجع',
      'المبلغ', 'الرصيد بعد الحركة', 'الجهة / الطرف الآخر', 'البيان', 'المستخدم', 'ملاحظات', 'idempotencyKey'
    ]);

    var now = new Date();
    var dateStr = Utilities.formatDate(now, 'GMT+2', 'yyyyMMdd');
    var prefix = payload.type === 'سند قبض' ? 'RV' : 'PV';
    var docNumber = prefix + '-CUST-' + dateStr + '-' + Math.floor(1000 + Math.random() * 9000);
    var isoDate = now.toISOString();
    var amount = Number(payload.amount) || 0;

    var custData = sCustomers.getDataRange().getValues();
    var custRow = -1;
    var custName = '';
    var currentCustBal = 0;

    for (var i = 1; i < custData.length; i++) {
      if (String(custData[i][0]) === String(payload.customerId)) {
        custRow = i + 1;
        custName = String(custData[i][1]);
        currentCustBal = Number(custData[i][12]) || 0;
        break;
      }
    }

    if (custRow === -1) return { success: false, error: 'العميل غير موجود' };

    var newCustBal = payload.type === 'سند قبض' ? (currentCustBal - amount) : (currentCustBal + amount);
    sCustomers.getRange(custRow, 13).setValue(newCustBal);

    sLedger.appendRow(buildRowWithIdempotencyKeyGS(sLedger, [
      generateUUID(),
      isoDate,
      payload.customerId,
      custName,
      payload.type,
      docNumber,
      payload.type === 'سند صرف' ? amount : 0,
      payload.type === 'سند قبض' ? amount : 0,
      newCustBal,
      payload.statement || (payload.type + ' للعميل ' + custName),
      session.phone || 'المسؤول',
      payload.notes || ''
    ], reqIdemKey));

    var cbData = sCashboxes.getDataRange().getValues();
    for (var c = 1; c < cbData.length; c++) {
      if (String(cbData[c][0]) === String(payload.cashboxId)) {
        var cbRow = c + 1;
        var cbName = String(cbData[c][1]);
        var cbBal = Number(cbData[c][5]) || 0;
        var newCbBal = payload.type === 'سند قبض' ? (cbBal + amount) : (cbBal - amount);
        sCashboxes.getRange(cbRow, 6).setValue(newCbBal);

        sCashboxTx.appendRow(buildRowWithIdempotencyKeyGS(sCashboxTx, [
          generateUUID(),
          isoDate,
          payload.cashboxId,
          cbName,
          payload.type === 'سند قبض' ? 'سند قبض عميل' : 'سحب',
          docNumber,
          payload.type === 'سند قبض' ? amount : -amount,
          newCbBal,
          custName,
          payload.type + ' - ' + custName,
          session.phone || 'المسؤول',
          payload.notes || ''
        ], reqIdemKey));
        break;
      }
    }

    logAudit(session, 'CUSTOMER_VOUCHER', 'Customer', payload.customerId, payload.type + ' رقم ' + docNumber + ' بمبلغ: ' + amount);
    return { success: true, voucherId: docNumber };
  });
}

/**
 * ===================== 18. الخزائن والتحويلات المالية (Cashboxes & Transfers) ===================== //
/**
 * جلب خزن لوحة التحكم المخصصة للمستخدم الحالي وفق الصلاحيات والتعيينات
 */
function getDashboardCashboxesData(session) {
  var cashboxes = getCashboxesData();
  var isDesigner = session.role === 'designer' || Boolean(session.isOwner);

  if (isDesigner) {
    return cashboxes.map(function(c) {
      return {
        id: c.id,
        name: c.name,
        type: c.type || 'نقدية محلية',
        currency: c.currency || 'EGP',
        currentBalance: Number(c.currentBalance) || 0,
        status: c.status,
        permissionType: 'إدارة كاملة'
      };
    });
  }

  // مستخدم عادي معه الصلاحية
  var assignments = getUserCashboxAssignmentsData();
  var userAssignments = assignments.filter(function(a) {
    var isUserMatch = String(a.userId) === String(session.userId);
    var isAssignActive = a.status === 'active' || a.status === 'نشطة' || !a.status;
    return isUserMatch && isAssignActive;
  });

  var assignedMap = {};
  userAssignments.forEach(function(a) {
    assignedMap[String(a.cashboxId)] = a.permissionType || 'إيداع وسحب';
  });

  var result = [];
  cashboxes.forEach(function(c) {
    var isInactive = c.status === 'inactive' || c.status === 'موقوفة';
    if (isInactive) return;

    if (assignedMap[String(c.id)]) {
      result.push({
        id: c.id,
        name: c.name,
        type: c.type || 'نقدية محلية',
        currency: c.currency || 'EGP',
        currentBalance: Number(c.currentBalance) || 0,
        status: c.status,
        permissionType: assignedMap[String(c.id)]
      });
    }
  });

  return result;
}

function getCashboxesData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.CASHBOXES);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getDataRange().getValues();
  var cashboxes = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    cashboxes.push({
      id: String(r[0]),
      name: String(r[1]),
      type: String(r[2] || 'نقدية محلية'),
      currency: String(r[3] || 'EGP'),
      openingBalance: Number(r[4]) || 0,
      currentBalance: Number(r[5]) || 0,
      status: String(r[6] || 'active'),
      notes: String(r[7] || ''),
      createdAt: String(r[8] || '')
    });
  }
  return cashboxes;
}

function saveCashboxData(cashbox, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, SHEETS.CASHBOXES);
  var isEdit = Boolean(cashbox.id);
  var nowStr = new Date().toISOString();

  if (isEdit) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(cashbox.id)) {
        var row = i + 1;
        sheet.getRange(row, 2).setValue(cashbox.name);
        if (cashbox.type !== undefined) sheet.getRange(row, 3).setValue(cashbox.type);
        if (cashbox.currency !== undefined) sheet.getRange(row, 4).setValue(cashbox.currency);
        if (cashbox.status !== undefined) sheet.getRange(row, 7).setValue(cashbox.status);
        if (cashbox.notes !== undefined) sheet.getRange(row, 8).setValue(cashbox.notes);

        return { success: true, cashbox: cashbox };
      }
    }
    return { success: false, error: 'الخزينة غير موجودة' };
  } else {
    var newId = cashbox.id || ('cb-' + generateUUID().slice(0, 8));
    var opening = Number(cashbox.openingBalance) || 0;

    sheet.appendRow([
      newId,
      cashbox.name,
      cashbox.type || 'نقدية محلية',
      cashbox.currency || 'EGP',
      opening,
      opening,
      cashbox.status || 'active',
      cashbox.notes || '',
      nowStr
    ]);

    return {
      success: true,
      cashbox: {
        id: newId,
        name: cashbox.name,
        type: cashbox.type || 'نقدية محلية',
        currency: cashbox.currency || 'EGP',
        openingBalance: opening,
        currentBalance: opening,
        status: cashbox.status || 'active',
        createdAt: nowStr
      }
    };
  }
  });
}

function getCashboxTransactionsData(cashboxId, filters, session) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.CASHBOX_TRANSACTIONS);
  var sTransfers = ss.getSheetByName(SHEETS.CASHBOX_TRANSFERS);

  var fromDate = filters ? (filters.from || filters.startDate || null) : null;
  var toDate = filters ? (filters.to || filters.endDate || null) : null;
  var filterAll = !cashboxId || String(cashboxId) === 'ALL';

  var isDesigner = !session || session.role === 'designer' || Boolean(session.isOwner);
  var allowedCashboxMap = null;
  if (!isDesigner && session && session.userId) {
    allowedCashboxMap = {};
    var assignments = getUserCashboxAssignmentsData();
    for (var a = 0; a < assignments.length; a++) {
      var asg = assignments[a];
      var isActive = asg.status === 'active' || asg.status === 'نشطة' || !asg.status;
      if (String(asg.userId) === String(session.userId) && isActive) {
        allowedCashboxMap[String(asg.cashboxId)] = true;
      }
    }
  }

  var txs = [];
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      var rowCbId = String(r[2]);
      if (allowedCashboxMap && !allowedCashboxMap[rowCbId]) {
        continue;
      }
      if (filterAll || rowCbId === String(cashboxId)) {
        var txDateStr = String(r[1]);
        if (fromDate || toDate) {
          if (!isDateInRangeGS(txDateStr, fromDate, toDate)) {
            continue;
          }
        }
        txs.push({
          id: String(r[0]),
          date: txDateStr,
          cashboxId: rowCbId,
          cashboxName: String(r[3]),
          type: String(r[4]),
          documentNumber: String(r[5]),
          amount: Number(r[6]) || 0,
          balanceAfter: Number(r[7]) || 0,
          party: String(r[8] || ''),
          statement: String(r[9] || ''),
          userName: String(r[10] || ''),
          notes: String(r[11] || '')
        });
      }
    }
  }

  txs.sort(function(a, b) {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  var transfers = [];
  if (sTransfers && sTransfers.getLastRow() > 1) {
    var trData = sTransfers.getDataRange().getValues();
    for (var t = 1; t < trData.length; t++) {
      var tr = trData[t];
      var trDateStr = String(tr[1]);
      var fromCbId = String(tr[2]);
      var toCbId = String(tr[4]);
      if (allowedCashboxMap && !allowedCashboxMap[fromCbId] && !allowedCashboxMap[toCbId]) {
        continue;
      }
      if (!filterAll && fromCbId !== String(cashboxId) && toCbId !== String(cashboxId)) {
        continue;
      }
      if (fromDate || toDate) {
        if (!isDateInRangeGS(trDateStr, fromDate, toDate)) {
          continue;
        }
      }
      transfers.push({
        transferNumber: String(tr[0]),
        date: trDateStr,
        fromCashboxId: fromCbId,
        fromCashboxName: String(tr[3]),
        toCashboxId: toCbId,
        toCashboxName: String(tr[5]),
        amount: Number(tr[6]) || 0,
        fee: Number(tr[7]) || 0,
        netReceived: Number(tr[8]) || 0,
        transferredBy: String(tr[9] || ''),
        receivedBy: String(tr[10] || ''),
        status: String(tr[11] || 'مكتمل'),
        notes: String(tr[12] || '')
      });
    }
  }

  transfers.sort(function(a, b) {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  return { success: true, transactions: txs, transfers: transfers };
}

function createCashboxTransferData(payload, session) {
  var reqIdemKey = getValidatedIdempotencyKeyGS(payload);
  if (!reqIdemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR_GS };
  }
  return withScriptLock(function() {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sCashboxes = getOrCreateSheet(ss, SHEETS.CASHBOXES);
    var sTransfers = ensureSheetWithHeaders(ss, SHEETS.CASHBOX_TRANSFERS, [
      'رقم التحويل', 'التاريخ والوقت', 'من خزينة ID', 'من خزينة اسم', 'إلى خزينة ID',
      'إلى خزينة اسم', 'المبلغ المحول', 'رسوم التحويل', 'المبلغ الصافي المستلم',
      'المستخدم المحول', 'المستخدم المستلم', 'الحالة', 'ملاحظات', 'idempotencyKey'
    ]);
    var dupTrMatch = findRowByIdempotencyKeyGS(sTransfers, reqIdemKey);
    if (dupTrMatch) {
      var tr = dupTrMatch.rowValues;
      return {
        success: true,
        duplicate: true,
        transfer: {
          transferNumber: String(tr[0] || ''),
          date: String(tr[1] || ''),
          fromCashboxId: String(tr[2] || ''),
          fromCashboxName: String(tr[3] || ''),
          toCashboxId: String(tr[4] || ''),
          toCashboxName: String(tr[5] || ''),
          amount: Number(tr[6]) || 0,
          fee: Number(tr[7]) || 0,
          netReceived: Number(tr[8]) || 0,
          status: String(tr[11] || 'مكتمل')
        }
      };
    }

    var sTx = ensureSheetWithHeaders(ss, SHEETS.CASHBOX_TRANSACTIONS, [
      'ID', 'التاريخ والوقت', 'ID الخزينة', 'اسم الخزينة', 'نوع الحركة', 'رقم المستند / المرجع',
      'المبلغ', 'الرصيد بعد الحركة', 'الجهة / الطرف الآخر', 'البيان', 'المستخدم', 'ملاحظات', 'idempotencyKey'
    ]);

    var now = new Date();
    var dateStr = Utilities.formatDate(now, 'GMT+2', 'yyyyMMdd');
    var transferNumber = 'TRF-' + dateStr + '-' + Math.floor(1000 + Math.random() * 9000);
    var isoDate = now.toISOString();

    var amount = Number(payload.amount) || 0;
    var fee = Number(payload.fee) || 0;
    var totalDeduction = amount + fee;

    var cbData = sCashboxes.getDataRange().getValues();
    var fromRow = -1;
    var toRow = -1;
    var fromName = '';
    var toName = '';
    var fromBal = 0;
    var toBal = 0;

    for (var i = 1; i < cbData.length; i++) {
      if (String(cbData[i][0]) === String(payload.fromCashboxId)) {
        fromRow = i + 1;
        fromName = String(cbData[i][1]);
        fromBal = Number(cbData[i][5]) || 0;
      }
      if (String(cbData[i][0]) === String(payload.toCashboxId)) {
        toRow = i + 1;
        toName = String(cbData[i][1]);
        toBal = Number(cbData[i][5]) || 0;
      }
    }

    if (fromRow === -1 || toRow === -1) return { success: false, error: 'إحدى الخزائن غير موجودة' };
    if (fromBal < totalDeduction) return { success: false, error: 'الرصيد في الخزينة المصدر غير كافٍ' };

    var newFromBal = fromBal - totalDeduction;
    var newToBal = toBal + amount;

    sCashboxes.getRange(fromRow, 6).setValue(newFromBal);
    sCashboxes.getRange(toRow, 6).setValue(newToBal);

    sTransfers.appendRow(buildRowWithIdempotencyKeyGS(sTransfers, [
      transferNumber,
      isoDate,
      payload.fromCashboxId,
      fromName,
      payload.toCashboxId,
      toName,
      amount,
      fee,
      amount,
      session.phone || 'المسؤول',
      session.phone || 'المسؤول',
      'مكتمل',
      payload.notes || ''
    ], reqIdemKey));

    sTx.appendRow(buildRowWithIdempotencyKeyGS(sTx, [
      generateUUID(),
      isoDate,
      payload.fromCashboxId,
      fromName,
      'تحويل بين الخزائن',
      transferNumber,
      -totalDeduction,
      newFromBal,
      toName,
      'تحويل صادر إلى ' + toName,
      session.phone || 'المسؤول',
      payload.notes || ''
    ], reqIdemKey));

    sTx.appendRow(buildRowWithIdempotencyKeyGS(sTx, [
      generateUUID(),
      isoDate,
      payload.toCashboxId,
      toName,
      'تحويل بين الخزائن',
      transferNumber,
      amount,
      newToBal,
      fromName,
      'تحويل وارد من ' + fromName,
      session.phone || 'المسؤول',
      payload.notes || ''
    ], reqIdemKey));

    logAudit(session, 'CASHBOX_TRANSFER', 'CashboxTransfer', transferNumber, 'تحويل مبلغ ' + amount + ' ج.م من ' + fromName + ' إلى ' + toName);
    return { success: true, transfer: { transferNumber: transferNumber, amount: amount } };
    } catch (err) {
      console.error('[AppsScript createCashboxTransferData Error]:', err && (err.stack || err.message || err));
      return { success: false, error: sanitizeClientErrorMessageGS(err, 'تعذر تنفيذ التحويل المالي') };
    }
  });
}

function getUserCashboxAssignmentsData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.USER_CASHBOX_ASSIGNMENTS);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getDataRange().getValues();
  var assignments = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    assignments.push({
      id: String(r[0]),
      userId: String(r[1]),
      userName: String(r[2] || ''),
      cashboxId: String(r[3]),
      cashboxName: String(r[4] || ''),
      permissionType: String(r[5] || 'إيداع وسحب'),
      isDefault: Boolean(r[6]),
      status: String(r[7] || 'active'),
      assignedAt: String(r[8] || '')
    });
  }
  return assignments;
}

function saveUserCashboxAssignmentData(payload, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet(ss, SHEETS.USER_CASHBOX_ASSIGNMENTS);
    var newId = payload.id || generateUUID();
    var nowStr = new Date().toISOString();

    sheet.appendRow([
      newId,
      payload.userId,
      payload.userName || '',
      payload.cashboxId,
      payload.cashboxName || '',
      payload.permissionType || 'إيداع وسحب',
      Boolean(payload.isDefault),
      'active',
      nowStr
    ]);

    return { success: true, assignment: { id: newId, userId: payload.userId, cashboxId: payload.cashboxId } };
  });
}

function getImportBatchesData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.IMPORT_BATCHES);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getDataRange().getValues();
  var batches = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    batches.push({
      id: String(r[0]),
      timestamp: String(r[1]),
      dataType: String(r[2]),
      sourceName: String(r[3]),
      totalRows: Number(r[4]) || 0,
      successRows: Number(r[5]) || 0,
      failedRows: Number(r[6]) || 0,
      userName: String(r[7] || ''),
      errorLog: String(r[8] || ''),
      notes: String(r[9] || '')
    });
  }
  return batches;
}

/**
 * إلغاء فاتورة بيع معتمدة عبر قيد عكسي
 */
function cancelInvoiceData(payload, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var sInvoices = ss.getSheetByName(SHEETS.INVOICES);
    var sLines = ss.getSheetByName(SHEETS.INVOICE_LINES);
    var sItems = ss.getSheetByName(SHEETS.ITEMS);
    var sStock = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
      'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
      'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
    ]);

    var invNum = payload.invoiceNumber;
    var reason = payload.reason || 'إلغاء معتمد';

    if (!sInvoices || sInvoices.getLastRow() < 2) return { success: false, error: 'الفاتورة غير موجودة' };
    var invData = sInvoices.getDataRange().getValues();
    var invRow = -1;
    var invWhId = 'wh-main';
    var colInvWhCancel = getHeaderMap(sInvoices).get('warehouseId', 36);
    for (var i = 1; i < invData.length; i++) {
      if (String(invData[i][0]) === invNum) {
        invRow = i + 1;
        if (String(invData[i][8]) === 'ملغاة') {
          return { success: false, error: 'الفاتورة ملغاة بالفعل' };
        }
        if (colInvWhCancel !== -1 && invData[i].length > colInvWhCancel && String(invData[i][colInvWhCancel] || '').trim() !== '') {
          invWhId = String(invData[i][colInvWhCancel]).trim();
        }
        break;
      }
    }
    if (invRow === -1) return { success: false, error: 'الفاتورة غير موجودة' };

    var now = new Date();
    var isoDate = now.toISOString();
    var userName = session.name || session.phone || 'المسؤول';

    if (sLines && sLines.getLastRow() > 1 && sItems) {
      var linesData = sLines.getDataRange().getValues();
      for (var l = 1; l < linesData.length; l++) {
        if (String(linesData[l][0]) === invNum) {
          var itemId = String(linesData[l][1]);
          var itemName = String(linesData[l][2]);
          var qty = Number(linesData[l][3]) || 0;
          var cancelAdj = adjustItemWarehouseDeltaGS(ss, itemId, invWhId, qty, isoDate);
          recomputeItemTotalStockGS(ss, itemId, sItems);
          if (sStock) {
            sStock.appendRow(buildRowWithWarehouseGS(sStock, [
              generateUUID(),
              itemId,
              itemName,
              'إلغاء فاتورة بيع',
              qty,
              cancelAdj.balanceAfter,
              'قيد عكسي لإلغاء مبيعات: ' + reason,
              invNum,
              userName,
              isoDate,
              reason
            ], invWhId));
          }
        }
      }
    }

    sInvoices.getRange(invRow, 9).setValue('ملغاة');
    logAudit(session, 'INVOICE_CANCEL', 'Invoice', invNum, 'إلغاء فاتورة بيع معتمدة بقيد عكسي: ' + reason);

    return { success: true, message: 'تم إلغاء الفاتورة وتسجيل القيود العكسية بنجاح' };
  });
}

/**
 * إلغاء فاتورة شراء معتمدة عبر قيد عكسي
 */
function cancelPurchaseData(payload, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var sPurchases = ss.getSheetByName(SHEETS.PURCHASES);
    var sPLines = ss.getSheetByName(SHEETS.PURCHASE_LINES);
    var sItems = ss.getSheetByName(SHEETS.ITEMS);
    var sStock = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
      'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
      'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
    ]);

    var invNum = payload.invoiceNumber;
    var reason = payload.reason || 'إلغاء معتمد';

    if (!sPurchases || sPurchases.getLastRow() < 2) return { success: false, error: 'فاتورة الشراء غير موجودة' };
    var purData = sPurchases.getDataRange().getValues();
    var hPurCancel = getHeaderMap(sPurchases);
    var colRecStatus = hPurCancel.get('حالة الاستلام', 15);
    var colPurWhCancel = hPurCancel.get('warehouseId', 20);
    var purRow = -1;
    var purWhId = 'wh-main';
    for (var i = 1; i < purData.length; i++) {
      if (String(purData[i][0]) === invNum) {
        purRow = i + 1;
        var curRecStatus = String(colVal(purData[i], colRecStatus, '')).trim();
        if (curRecStatus === 'ملغاة' || String(purData[i][16] || '').trim() === 'ملغاة') {
          return { success: false, error: 'فاتورة الشراء ملغاة بالفعل' };
        }
        if (colPurWhCancel !== -1 && purData[i].length > colPurWhCancel && String(purData[i][colPurWhCancel] || '').trim() !== '') {
          purWhId = String(purData[i][colPurWhCancel]).trim();
        }
        break;
      }
    }
    if (purRow === -1) return { success: false, error: 'فاتورة الشراء غير موجودة' };

    var now = new Date();
    var isoDate = now.toISOString();
    var userName = session.name || session.phone || 'المسؤول';

    if (sPLines && sPLines.getLastRow() > 1 && sItems) {
      var linesData = sPLines.getDataRange().getValues();
      for (var l = 1; l < linesData.length; l++) {
        if (String(linesData[l][0]) === invNum) {
          var itemId = String(linesData[l][2]);
          var itemName = String(linesData[l][4]);
          var qty = Number(linesData[l][5]) || 0;
          var cancelPurAdj = adjustItemWarehouseDeltaGS(ss, itemId, purWhId, -qty, isoDate);
          recomputeItemTotalStockGS(ss, itemId, sItems);
          if (sStock) {
            sStock.appendRow(buildRowWithWarehouseGS(sStock, [
              generateUUID(),
              itemId,
              itemName,
              'إلغاء فاتورة شراء',
              -qty,
              cancelPurAdj.balanceAfter,
              'قيد عكسي لإلغاء مشتريات: ' + reason,
              invNum,
              userName,
              isoDate,
              reason
            ], purWhId));
          }
        }
      }
    }

    sPurchases.getRange(purRow, colRecStatus + 1).setValue('ملغاة');
    logAudit(session, 'PURCHASE_CANCEL', 'Purchase', invNum, 'إلغاء فاتورة شراء بقيد عكسي: ' + reason);

    return { success: true, message: 'تم إلغاء فاتورة الشراء وتسجيل القيود العكسية بنجاح' };
  });
}

/**
 * تقرير المطابقة المحاسبية وترحيل العمليات في Apps Script
 */
function getReconciliationReportData(filters) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sInvoices = ss.getSheetByName(SHEETS.INVOICES);
  var sPurchases = ss.getSheetByName(SHEETS.PURCHASES);
  var sCashboxTx = ss.getSheetByName(SHEETS.CASHBOX_TRANSACTIONS);
  var sStock = ss.getSheetByName(SHEETS.STOCK_MOVEMENTS);
  var sSupplierLedger = ss.getSheetByName(SHEETS.SUPPLIER_LEDGER);

  var fromDate = filters ? (filters.from || filters.startDate || null) : null;
  var toDate = filters ? (filters.to || filters.endDate || null) : null;

  var txDocs = {};
  if (sCashboxTx && sCashboxTx.getLastRow() > 1) {
    var txData = sCashboxTx.getDataRange().getValues();
    for (var t = 1; t < txData.length; t++) {
      txDocs[String(txData[t][5])] = true;
    }
  }

  var stockDocs = {};
  if (sStock && sStock.getLastRow() > 1) {
    var stockData = sStock.getDataRange().getValues();
    for (var s = 1; s < stockData.length; s++) {
      if (stockData[s][5]) stockDocs[String(stockData[s][5])] = true;
      if (stockData[s][7]) stockDocs[String(stockData[s][7])] = true;
    }
  }

  var supLedgerDocs = {};
  if (sSupplierLedger && sSupplierLedger.getLastRow() > 1) {
    var slData = sSupplierLedger.getDataRange().getValues();
    for (var l = 1; l < slData.length; l++) {
      if (slData[l][5]) supLedgerDocs[String(slData[l][5])] = true;
    }
  }

  var items = [];
  var discrepantCashbox = 0;
  var discrepantLedger = 0;
  var totalAudited = 0;

  if (sInvoices && sInvoices.getLastRow() > 1) {
    var invData = sInvoices.getDataRange().getValues();
    for (var i = 1; i < invData.length; i++) {
      var invDateStr = String(invData[i][1]);
      if (fromDate || toDate) {
        if (!isDateInRangeGS(invDateStr, fromDate, toDate)) {
          continue;
        }
      }
      var docNum = String(invData[i][0]);
      var status = String(invData[i][8]);
      if (status === 'ملغاة') continue;
      totalAudited++;

      var netAmount = Number(invData[i][6]) || 0;
      var hasCashbox = Boolean(txDocs[docNum]);
      var hasStock = Boolean(stockDocs[docNum]);

      if (!hasCashbox || !hasStock) {
        if (!hasCashbox) discrepantCashbox += netAmount;
        var invReasons = [];
        if (!hasCashbox) invReasons.push('حركة الخزينة غير مسجلة');
        if (!hasStock) invReasons.push('حركة المخزون غير موثقة');
        items.push({
          id: docNum,
          documentType: 'فاتورة بيع',
          documentNumber: docNum,
          date: invDateStr,
          partyName: String(invData[i][2]),
          totalAmount: netAmount,
          paymentType: 'نقدي',
          status: 'غير مرحل',
          details: invReasons.join(' | '),
          missingCashbox: !hasCashbox,
          missingLedger: false,
          missingStock: !hasStock,
          isHistorical: true
        });
      }
    }
  }

  if (sPurchases && sPurchases.getLastRow() > 1) {
    var purData = sPurchases.getDataRange().getValues();
    for (var p = 1; p < purData.length; p++) {
      var purDateStr = String(purData[p][2]);
      if (fromDate || toDate) {
        if (!isDateInRangeGS(purDateStr, fromDate, toDate)) {
          continue;
        }
      }
      var pDocNum = String(purData[p][0]);
      var recStatus = String(purData[p][15] || '');
      if (recStatus === 'ملغاة' || String(purData[p][16] || '') === 'ملغاة') continue;
      totalAudited++;

      var pNetTotal = Number(purData[p][9]) || 0;
      var pPaid = Number(purData[p][10]) || 0;
      var pRemaining = Number(purData[p][11]) || 0;
      var pSupplierId = String(purData[p][3] || '');

      var pHasCashbox = pPaid > 0 ? Boolean(txDocs[pDocNum]) : true;
      var pHasLedger = pSupplierId ? Boolean(supLedgerDocs[pDocNum]) : true;
      var pHasStock = Boolean(stockDocs[pDocNum]);

      if (!pHasCashbox || !pHasLedger || !pHasStock) {
        if (!pHasCashbox && pPaid > 0) discrepantCashbox += pPaid;
        if (!pHasLedger && pRemaining > 0) discrepantLedger += pRemaining;

        var purReasons = [];
        if (!pHasCashbox) purReasons.push('حركة صرف الخزينة غير مسجلة للمبلغ المدفوع');
        if (!pHasLedger) purReasons.push('قيد استحقاق المورد غير مسجل بالدفتر');
        if (!pHasStock) purReasons.push('حركة إضافة المخزون غير موثقة');

        items.push({
          id: pDocNum,
          documentType: 'فاتورة شراء',
          documentNumber: pDocNum,
          date: purDateStr,
          partyName: String(purData[p][4] || 'مورد'),
          totalAmount: pNetTotal,
          paymentType: String(purData[p][13] || (pPaid >= pNetTotal ? 'نقدي' : 'آجل')),
          status: 'غير مرحل',
          details: purReasons.join(' | '),
          missingCashbox: !pHasCashbox,
          missingLedger: !pHasLedger,
          missingStock: !pHasStock,
          isHistorical: true
        });
      }
    }
  }

  return {
    totalAudited: totalAudited,
    unpostedCount: items.length,
    discrepantCashboxAmount: discrepantCashbox,
    discrepantLedgerAmount: discrepantLedger,
    items: items
  };
}

/**
 * ترحيل يدوي معتمد لعملية سابقة عبر Apps Script
 */
function postReconciliationItemData(payload, session) {
  return withScriptLock(function() {
    logAudit(session, 'POST_RECONCILIATION', payload.documentType, payload.documentNumber, 'ترحيل يدوي معتمد');
    return { success: true, message: 'تم ترحيل العملية بنجاح' };
  });
}

/**
 * ============================================================================
 * إدارة التصنيفات (Product Categories) في Google Sheets
 * ============================================================================
 */
function getCategoriesData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.PRODUCT_CATEGORIES);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getDataRange().getValues();
  var h = getHeaderMap(sheet);
  var colId = h.get('ID', 0);
  var colName = h.get('اسم التصنيف', 1);
  var colParent = h.get('ID التصنيف الأب', 2);
  var colStatus = h.get('الحالة', 3);
  var colPos = h.get('الظهور في نقطة البيع', 4);
  var colOrder = h.get('ترتيب العرض', 5);
  var colCreated = h.get('تاريخ الإنشاء', 6);
  var colUpdated = h.get('تاريخ التعديل', 7);

  var categories = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = String(colVal(row, colId) || '').trim();
    if (!id) continue;
    var isShowInPos = colVal(row, colPos);
    var showInPOS = isShowInPos === true || String(isShowInPos).toLowerCase() === 'true';

    categories.push({
      id: id,
      name: String(colVal(row, colName) || '').trim(),
      parentCategoryId: String(colVal(row, colParent) || '').trim() || null,
      status: String(colVal(row, colStatus) || 'نشط').trim(),
      showInPOS: showInPOS,
      displayOrder: Number(colVal(row, colOrder)) || 0,
      createdAt: String(colVal(row, colCreated) || ''),
      updatedAt: String(colVal(row, colUpdated) || '')
    });
  }

  return categories;
}

function saveCategoryData(payload, session) {
  var name = String(payload.name || '').trim();
  if (!name) return { success: false, error: 'اسم التصنيف مطلوب' };

  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, SHEETS.PRODUCT_CATEGORIES);
  ensureSheetWithHeaders(ss, SHEETS.PRODUCT_CATEGORIES, [
    'ID', 'اسم التصنيف', 'ID التصنيف الأب', 'الحالة', 'الظهور في نقطة البيع', 'ترتيب العرض', 'تاريخ الإنشاء', 'تاريخ التعديل'
  ]);

  var h = getHeaderMap(sheet);
  var data = sheet.getDataRange().getValues();
  var id = payload.id || generateUUID();
  var parentCategoryId = payload.parentCategoryId ? String(payload.parentCategoryId).trim() : null;

  if (payload.id && parentCategoryId === payload.id) {
    return { success: false, error: 'لا يمكن ربط التصنيف بنفسه كتصنيف أب' };
  }

  // منع العلاقات الدائرية (منع اختيار أحد الأبناء أو الأحفاد كأب)
  if (payload.id && parentCategoryId) {
    var curr = parentCategoryId;
    var visited = {};
    while (curr) {
      if (curr === String(id)) {
        return { success: false, error: 'لا يمكن تعيين تصنيف فرعي ليكون تصنيفاً أباً (منع العلاقات الدائرية)' };
      }
      if (visited[curr]) break;
      visited[curr] = true;
      var nextParent = null;
      for (var ci = 1; ci < data.length; ci++) {
        if (String(colVal(data[ci], h.get('ID', 0))) === curr) {
          nextParent = String(colVal(data[ci], h.get('ID التصنيف الأب', 2)) || '').trim() || null;
          break;
        }
      }
      curr = nextParent;
    }
  }

  // فحص عدم تكرار الاسم في نفس المستوى
  for (var i = 1; i < data.length; i++) {
    var rowId = String(colVal(data[i], h.get('ID', 0)));
    var rowParent = String(colVal(data[i], h.get('ID التصنيف الأب', 2)) || '').trim() || null;
    var rowName = String(colVal(data[i], h.get('اسم التصنيف', 1)) || '').trim();
    if (rowId !== id && rowParent === parentCategoryId && rowName.toLowerCase() === name.toLowerCase()) {
      return { success: false, error: 'يوجد تصنيف آخر بنفس الاسم ضمن هذا المستوى' };
    }
  }

  var now = new Date().toISOString();
  var existingRow = -1;
  var oldCreated = now;

  for (var j = 1; j < data.length; j++) {
    if (String(colVal(data[j], h.get('ID', 0))) === String(id)) {
      existingRow = j + 1;
      oldCreated = String(colVal(data[j], h.get('تاريخ الإنشاء', 6)) || now);
      break;
    }
  }

  var showInPOS = payload.showInPOS !== undefined ? Boolean(payload.showInPOS) : true;
  var status = payload.status || 'نشط';
  var displayOrder = Number(payload.displayOrder || 0);

  var rowData = [
    id,
    name,
    parentCategoryId || '',
    status,
    showInPOS ? 'TRUE' : 'FALSE',
    displayOrder,
    payload.createdAt || oldCreated,
    now
  ];

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
    // عند إخفاء التصنيف، إخفاء الفروع التابعة أيضاً
    if (!showInPOS) {
      for (var k = 1; k < data.length; k++) {
        var subParent = String(colVal(data[k], h.get('ID التصنيف الأب', 2)) || '').trim();
        if (subParent === id) {
          sheet.getRange(k + 1, h.get('الظهور في نقطة البيع', 4) + 1).setValue('FALSE');
        }
      }
    }
    logAudit(session, 'CATEGORY_UPDATE', 'ProductCategory', id, 'تعديل تصنيف: ' + name);
  } else {
    sheet.appendRow(rowData);
    logAudit(session, 'CATEGORY_CREATE', 'ProductCategory', id, 'إنشاء تصنيف جديد: ' + name);
  }

  return {
    success: true,
    category: {
      id: id,
      name: name,
      parentCategoryId: parentCategoryId,
      status: status,
      showInPOS: showInPOS,
      displayOrder: displayOrder,
      createdAt: payload.createdAt || oldCreated,
      updatedAt: now
    }
  };
  });
}

function deleteCategoryData(id, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.PRODUCT_CATEGORIES);
  if (!sheet || sheet.getLastRow() < 2) return { success: false, error: 'التصنيف غير موجود' };

  var h = getHeaderMap(sheet);
  var data = sheet.getDataRange().getValues();

  // 1. فحص وجود تصنيفات فرعية
  for (var i = 1; i < data.length; i++) {
    var pId = String(colVal(data[i], h.get('ID التصنيف الأب', 2)) || '').trim();
    if (pId === id) {
      return { success: false, error: 'لا يمكن حذف هذا التصنيف لأنه يحتوي على تصنيفات فرعية تحته. يرجى نقل أو حذف التصنيفات الفرعية أولاً.' };
    }
  }

  // 2. فحص ارتباط أصناف بالتصنيف
  var sItems = ss.getSheetByName(SHEETS.ITEMS);
  if (sItems && sItems.getLastRow() > 1) {
    var itemH = getHeaderMap(sItems);
    var colCat = itemH.get('ID التصنيف', -1);
    if (colCat !== -1) {
      var itemData = sItems.getDataRange().getValues();
      for (var j = 1; j < itemData.length; j++) {
        if (String(colVal(itemData[j], colCat)) === String(id)) {
          return { success: false, error: 'لا يمكن حذف هذا التصنيف لوجود أصناف مرتبطة به حالياً. يمكنك نقل الأصناف لتصنيف آخر أو أرشفة التصنيف بدلاً من حذفه.' };
        }
      }
    }
  }

  for (var k = 1; k < data.length; k++) {
    if (String(colVal(data[k], h.get('ID', 0))) === String(id)) {
      var catName = String(colVal(data[k], h.get('اسم التصنيف', 1)));
      sheet.deleteRow(k + 1);
      logAudit(session, 'CATEGORY_DELETE', 'ProductCategory', id, 'حذف تصنيف: ' + catName);
      return { success: true };
    }
  }

  return { success: false, error: 'التصنيف غير موجود' };
  });
}

/**
 * ترحيل آمن وتكراري (Idempotent) لربط الأصناف القديمة بمعرفات التصنيفات (category IDs)
 * - يفحص ورقة Items وورقة ProductCategories
 * - يبحث عن اسم التصنيف إذا كان مدخلاً كنص في عمود "التصنيف" أو "ID التصنيف"
 * - يطابق فقط المطابقات الفريدة والواضحة (اسم التصنيف يطابق تصنيفاً واحداً فقط دون التباس)
 * - عند وجود أكثر من تصنيف بنفس الاسم لا يخمن ويترك السجل دون تعديل مع توثيقه
 * - لا يحذف بيانات ولا ينشئ تصنيفات مكررة
 */
function migrateItemCategoriesData(session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sItems = ss.getSheetByName(SHEETS.ITEMS);
  var sCategories = ss.getSheetByName(SHEETS.PRODUCT_CATEGORIES);

  if (!sItems || sItems.getLastRow() < 2) {
    return {
      success: true,
      totalItems: 0,
      migrated: 0,
      alreadyLinked: 0,
      ambiguous: 0,
      unmatched: 0,
      needsReview: 0,
      details: [],
      message: 'ورقة الأصناف فارغة أو غير موجودة'
    };
  }

  // 1. جلب كل التصنيفات الحالية وبناء الفهارس
  var categories = getCategoriesData();
  var catById = {};
  var catByName = {}; // خريطة الأسماء المنظفة إلى قائمة التصنيفات

  for (var c = 0; c < categories.length; c++) {
    var cat = categories[c];
    catById[cat.id] = cat;
    var normName = String(cat.name || '').trim().toLowerCase();
    if (!catByName[normName]) {
      catByName[normName] = [];
    }
    catByName[normName].push(cat);
  }

  // 2. فحص وتأمين وجود عمود 'ID التصنيف' في ورقة Items دون مساس بالبيانات
  ensureSheetWithHeaders(ss, SHEETS.ITEMS, ['ID التصنيف']);
  var itemH = getHeaderMap(sItems);
  var colId = itemH.get('ID', 0);
  var colName = itemH.get('اسم الصنف', 1);
  var colCatId = itemH.get('ID التصنيف', -1);
  if (colCatId === -1) colCatId = itemH.get('معرف التصنيف', -1);
  if (colCatId === -1) colCatId = itemH.get('categoryId', -1);

  // البحث عن أعمدة قديمة قد تحتوي على اسم التصنيف كنص
  var colLegacyCat = itemH.get('التصنيف', -1);
  if (colLegacyCat === -1) colLegacyCat = itemH.get('الفئة', -1);
  if (colLegacyCat === -1) colLegacyCat = itemH.get('تصنيف الصنف', -1);

  var itemData = sItems.getDataRange().getValues();
  var totalItems = itemData.length - 1;
  var alreadyLinked = 0;
  var migrated = 0;
  var ambiguous = 0;
  var unmatched = 0;
  var details = [];

  for (var i = 1; i < itemData.length; i++) {
    var row = itemData[i];
    var itemId = String(colVal(row, colId, '')).trim();
    var itemName = String(colVal(row, colName, '')).trim();
    if (!itemId) continue;

    var currentCatVal = colCatId !== -1 ? String(colVal(row, colCatId, '')).trim() : '';
    var legacyCatVal = colLegacyCat !== -1 ? String(colVal(row, colLegacyCat, '')).trim() : '';

    // إذا كان الحقل يحتوي بالفعل على ID صالح موجود في جدول التصنيفات
    if (currentCatVal && catById[currentCatVal]) {
      alreadyLinked++;
      continue;
    }

    // تحديد القيمة النصية المراد مطابقتها: إما من عمود التصنيف القديم، أو من عمود ID التصنيف إذا كان نصاً غير معرّف
    var textToMatch = '';
    if (currentCatVal && !catById[currentCatVal]) {
      textToMatch = currentCatVal;
    } else if (legacyCatVal) {
      textToMatch = legacyCatVal;
    }

    if (!textToMatch) {
      // صنف بدون أي إشارة لتصنيف
      continue;
    }

    var normText = textToMatch.trim().toLowerCase();
    var matchedCats = catByName[normText] || [];

    if (matchedCats.length === 1) {
      // مطابقة قطعية وفريدة 100%
      var matchedId = matchedCats[0].id;
      sItems.getRange(i + 1, colCatId + 1).setValue(matchedId);
      migrated++;
      details.push({
        itemId: itemId,
        itemName: itemName,
        oldValue: textToMatch,
        assignedCategoryId: matchedId,
        assignedCategoryName: matchedCats[0].name,
        status: 'migrated'
      });
    } else if (matchedCats.length > 1) {
      // التباس: أكثر من تصنيف بنفس الاسم في مستويات مختلفة، نتركه دون تخمين
      ambiguous++;
      details.push({
        itemId: itemId,
        itemName: itemName,
        oldValue: textToMatch,
        reason: 'يوجد أكثر من تصنيف بنفس الاسم (' + matchedCats.length + ')، لا يمكن التخمين الآلي منعاً لخلط الفروع',
        candidateCategoryIds: matchedCats.map(function(m) { return m.id; }),
        status: 'ambiguous_needs_review'
      });
    } else {
      // لم نجد تصنيف بهذا الاسم
      unmatched++;
      details.push({
        itemId: itemId,
        itemName: itemName,
        oldValue: textToMatch,
        reason: 'لم يتم العثور على تصنيف مطابق لهذا الاسم',
        status: 'unmatched'
      });
    }
  }

  logAudit(session, 'MIGRATE_CATEGORIES', 'Items', 'all', 'ترحيل تصنيفات الأصناف: ربط ' + migrated + ' صنف، التباس ' + ambiguous + ' صنف');

  return {
    success: true,
    totalItems: totalItems,
    alreadyLinked: alreadyLinked,
    migrated: migrated,
    ambiguous: ambiguous,
    unmatched: unmatched,
    needsReview: ambiguous + unmatched,
    details: details,
    message: 'تم ترحيل ' + migrated + ' صنف بنجاح. السجلات التي تحتاج مراجعة يدوية: ' + (ambiguous + unmatched)
  };
  });
}

/**
 * تعديل كمية صنف مباشر مع قفل LockService وتسجيل حركة مخزون
 */
function adjustItemStockData(payload, session) {
  var reason = String(payload.reason || '').trim();
  if (!reason) return { success: false, error: 'سبب تعديل الكمية إجباري ومطلوب لتوثيق الحركة' };

  var newQty = Number(payload.newQuantity);
  if (isNaN(newQty) || newQty < 0) return { success: false, error: 'الكمية غير صالحة' };

  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var sheet = ss.getSheetByName(SHEETS.ITEMS);
    if (!sheet || sheet.getLastRow() < 2) return { success: false, error: 'الصنف غير موجود' };

    var whResAdj = resolveWarehouseForOperationGS(ss, payload.warehouseId || null, session, {
      requireActive: true,
      enforceUserAccess: true
    });
    if (!whResAdj.ok) {
      return { success: false, statusCode: whResAdj.statusCode || 400, error: whResAdj.error };
    }
    var targetWhAdj = whResAdj.warehouse;

    var h = getHeaderMap(sheet);
    var data = sheet.getDataRange().getValues();
    var itemId = String(payload.itemId || '');
    var rowIndex = -1;
    var itemRow = null;

    for (var i = 1; i < data.length; i++) {
      if (String(colVal(data[i], h.get('ID', 0))) === itemId) {
        rowIndex = i + 1;
        itemRow = data[i];
        break;
      }
    }

    if (rowIndex === -1 || !itemRow) return { success: false, error: 'الصنف غير موجود' };

    var oldQty = getItemWarehouseStockGS(ss, itemId, targetWhAdj.id);
    var diff = Math.round((newQty - oldQty) * 1000) / 1000;
    var itemName = String(colVal(itemRow, h.get('اسم الصنف', 1)));
    var now = new Date().toISOString();
    var docNumber = 'ADJ-' + Date.now().toString().slice(-6);
    var movementId = generateUUID();

    // تحديث رصيد الصنف في المخزن المحدد ثم إعادة احتساب الإجمالي في ورقة Items
    setItemWarehouseBalanceGS(ss, itemId, targetWhAdj.id, newQty, now);
    var totalStockAfterAdj = recomputeItemTotalStockGS(ss, itemId, sheet);

    // تسجيل حركة المخزون في StockMovements
    var sMovements = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
      'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
      'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
    ]);
    sMovements.appendRow(buildRowWithWarehouseGS(sMovements, [
      movementId,
      itemId,
      itemName,
      'تعديل كمية مباشر',
      Math.abs(diff),
      newQty,
      reason,
      docNumber,
      session.name || session.phone || 'المستخدم',
      now,
      (diff > 0 ? 'زيادة' : 'خصم') + ' مباشر (' + (diff > 0 ? '+' + diff : diff) + ') في مخزن [' + targetWhAdj.name + ']. السبب: ' + reason
    ], targetWhAdj.id));

    logAudit(
      session,
      'STOCK_DIRECT_ADJUST',
      'Item',
      itemId,
      'تعديل كمية مباشر لصنف "' + itemName + '" في مخزن "' + targetWhAdj.name + '": من ' + oldQty + ' إلى ' + newQty + ' (إجمالي المخازن: ' + totalStockAfterAdj + '). السبب: ' + reason + ' [' + docNumber + ']'
    );

    return {
      success: true,
      item: {
        id: itemId,
        name: itemName,
        stockQuantity: totalStockAfterAdj,
        warehouseId: targetWhAdj.id,
        warehouseName: targetWhAdj.name,
        warehouseStockQuantity: newQty
      },
      movement: {
        id: movementId,
        documentNumber: docNumber,
        quantityBefore: oldQty,
        quantityAfter: newQty,
        difference: diff,
        reason: reason,
        warehouseId: targetWhAdj.id,
        warehouseName: targetWhAdj.name
      }
    };
  });
}

function parseStockMovementsSheetGS(ss) {
  var sMovements = ss.getSheetByName(SHEETS.STOCK_MOVEMENTS);
  if (!sMovements || sMovements.getLastRow() < 2) return [];

  var whLookup = getWarehouseLookupMapGS(ss);
  var data = sMovements.getDataRange().getValues();
  var list = [];

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var id = String(r[0] || '');
    if (!id) continue;

    // توافق مع كلا الترتيبين: الترتيب القياسي (r[1]=itemId, r[9]=date) أو صفوف الإلغاء القديمة (r[1]=isoDate, r[2]=itemId)
    var col1Str = String(r[1] || '');
    var isLegacyCancelRow = /^\d{4}-\d{2}-\d{2}T/.test(col1Str) && !r[9];

    var itemId = isLegacyCancelRow ? String(r[2] || '') : col1Str;
    var itemName = isLegacyCancelRow ? String(r[3] || '') : String(r[2] || '');
    var movementType = isLegacyCancelRow ? String(r[4] || '') : String(r[3] || '');
    var docNumber = isLegacyCancelRow ? String(r[5] || '') : String(r[7] || '');
    var rawQty = isLegacyCancelRow ? (Number(r[6]) || 0) : (Number(r[4]) || 0);
    var balanceAfter = isLegacyCancelRow ? (Number(r[7]) || 0) : (Number(r[5]) || 0);
    var reason = isLegacyCancelRow ? String(r[8] || '') : String(r[6] || '');
    var userName = isLegacyCancelRow ? String(r[9] || '') : String(r[8] || '');
    var dateStr = isLegacyCancelRow ? col1Str : String(r[9] || '');
    var notes = isLegacyCancelRow ? '' : String(r[10] || '');
    var whId = (!isLegacyCancelRow && r.length > 11 && r[11] !== undefined && String(r[11]).trim() !== '')
      ? String(r[11]).trim()
      : whLookup.defaultId;
    var whName = whLookup.byId[whId] || whLookup.defaultName;

    var quantityBefore = undefined;
    var quantityAfter = balanceAfter;

    if (movementType === 'تعديل كمية مباشر' || movementType === 'تسوية جرد' || movementType === 'تسوية مخزون بالإكسيل') {
      var signedMatch = notes.match(/\(([+-]?\d+(?:\.\d+)?)\)/);
      if (signedMatch) {
        var signedDiff = Number(signedMatch[1]) || 0;
        quantityBefore = balanceAfter - signedDiff;
      } else if (notes.indexOf('خصم') !== -1) {
        quantityBefore = balanceAfter + Math.abs(rawQty);
      } else {
        quantityBefore = balanceAfter - Math.abs(rawQty);
      }
    }

    list.push({
      id: id,
      date: dateStr,
      itemId: itemId,
      itemName: itemName,
      movementType: movementType,
      documentNumber: docNumber,
      quantity: Math.abs(rawQty),
      rawQuantity: rawQty,
      balanceAfter: balanceAfter,
      quantityBefore: quantityBefore,
      quantityAfter: quantityAfter,
      reason: reason,
      userName: userName,
      notes: notes,
      warehouseId: whId,
      warehouseName: whName
    });
  }

  return list;
}

function getItemMovementReportData(payload, session) {
  var itemId = payload ? String(payload.itemId || '') : '';
  if (!itemId) {
    return { success: false, error: 'معرّف الصنف مطلوب لعرض تقرير الحركة' };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var items = getItemsFiltered(session);
  var item = null;
  for (var i = 0; i < items.length; i++) {
    if (String(items[i].id) === itemId) {
      item = items[i];
      break;
    }
  }

  if (!item) {
    return { success: false, error: 'الصنف المطلوب غير موجود' };
  }

  var canViewPurchase = session ? (session.role === 'designer' || (session.permissions && session.permissions.indexOf('prices.view_purchase') !== -1)) : false;

  var categories = getCategoriesData();
  var categoryName = undefined;
  if (item.categoryId) {
    for (var c = 0; c < categories.length; c++) {
      if (String(categories[c].id) === String(item.categoryId)) {
        categoryName = categories[c].name;
        break;
      }
    }
  }

  var sInvoices = ss.getSheetByName(SHEETS.INVOICES);
  var invoicePartyMap = {};
  if (sInvoices && sInvoices.getLastRow() > 1) {
    var invData = sInvoices.getDataRange().getValues();
    for (var iv = 1; iv < invData.length; iv++) {
      invoicePartyMap[String(invData[iv][0])] = String(invData[iv][2] || '');
    }
  }

  var sPurchases = ss.getSheetByName(SHEETS.PURCHASES);
  var purchasePartyMap = {};
  if (sPurchases && sPurchases.getLastRow() > 1) {
    var purData = sPurchases.getDataRange().getValues();
    for (var pr = 1; pr < purData.length; pr++) {
      purchasePartyMap[String(purData[pr][0])] = String(purData[pr][4] || '');
    }
  }

  var filterWhId = (payload && payload.warehouseId && String(payload.warehouseId).trim() !== '' && String(payload.warehouseId).trim().toUpperCase() !== 'ALL')
    ? String(payload.warehouseId).trim()
    : null;

  var allMovements = parseStockMovementsSheetGS(ss);
  var allItemMovements = [];
  for (var mIdx = 0; mIdx < allMovements.length; mIdx++) {
    var mvEntry = allMovements[mIdx];
    if (String(mvEntry.itemId) !== itemId) continue;
    if (filterWhId && String(mvEntry.warehouseId || 'wh-main') !== filterWhId) continue;
    allItemMovements.push(mvEntry);
  }

  allItemMovements.sort(function(a, b) {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  var rawStart = payload.startDate || payload.from || null;
  var rawEnd = payload.endDate || payload.to || null;
  var startDateStr = rawStart ? toCairoDateStrGS(rawStart) : null;
  var endDateStr = rawEnd ? toCairoDateStrGS(rawEnd) : null;

  var initialBalance = 0;
  var inPeriodRecords = [];
  var totalInward = 0;
  var totalOutward = 0;
  var runningBalance = 0;

  for (var k = 0; k < allItemMovements.length; k++) {
    var m = allItemMovements[k];
    var mDateStr = toCairoDateStrGS(m.date);
    var inwardQty = 0;
    var outwardQty = 0;

    switch (m.movementType) {
      case 'شراء':
      case 'استيراد رصيد افتتاحي':
      case 'إلغاء فاتورة بيع':
      case 'تحويل_وارد':
      case 'تعديل فاتورة - استرجاع':
        inwardQty = m.quantity;
        break;
      case 'بيع':
      case 'مرتجع شراء':
      case 'إلغاء فاتورة شراء':
      case 'تحويل_صادر':
      case 'تعديل فاتورة - بيع':
        outwardQty = m.quantity;
        break;
      case 'مرتجع':
        if (!m.condition || m.condition === 'يرجع المخزن') {
          inwardQty = m.quantity;
        }
        break;
      case 'تعديل كمية مباشر':
      case 'تسوية جرد':
      case 'تسوية مخزون بالإكسيل':
        if (m.quantityAfter !== undefined && m.quantityBefore !== undefined) {
          if (m.quantityAfter >= m.quantityBefore) {
            inwardQty = m.quantityAfter - m.quantityBefore;
          } else {
            outwardQty = m.quantityBefore - m.quantityAfter;
          }
        } else {
          inwardQty = m.quantity;
        }
        break;
      default:
        inwardQty = m.quantity;
    }

    if (startDateStr && mDateStr < startDateStr) {
      runningBalance += (inwardQty - outwardQty);
      initialBalance = runningBalance;
    } else if (!endDateStr || mDateStr <= endDateStr) {
      runningBalance += (inwardQty - outwardQty);
      totalInward += inwardQty;
      totalOutward += outwardQty;

      var party = m.party;
      if (!party) {
        if (m.movementType === 'بيع') {
          party = invoicePartyMap[m.documentNumber] || undefined;
        } else if (m.movementType === 'شراء') {
          party = purchasePartyMap[m.documentNumber] || undefined;
        }
      }

      var unitPrice = canViewPurchase ? (item.purchasePrice !== undefined ? item.purchasePrice : item.salePrice) : item.salePrice;
      var activeQty = inwardQty > 0 ? inwardQty : outwardQty;

      inPeriodRecords.push({
        id: m.id,
        date: m.date,
        movementType: m.movementType,
        documentNumber: m.documentNumber,
        inwardQty: inwardQty,
        outwardQty: outwardQty,
        runningBalance: runningBalance,
        unitPrice: unitPrice || 0,
        totalAmount: activeQty * (unitPrice || 0),
        party: party,
        userName: m.userName,
        reason: m.reason || m.notes,
        condition: m.condition,
        warehouseId: m.warehouseId,
        warehouseName: m.warehouseName
      });
    }
  }

  var finalBalance = runningBalance;
  var currentReportStock = filterWhId ? getItemWarehouseStockGS(ss, item.id, filterWhId) : item.stockQuantity;

  var report = {
    itemId: item.id,
    itemName: item.name,
    sku: item.sku,
    barcode: item.barcode,
    categoryName: categoryName,
    currentStock: currentReportStock,
    warehouseId: filterWhId || undefined,
    startDate: rawStart || undefined,
    endDate: rawEnd || undefined,
    initialBalance: initialBalance,
    totalInward: totalInward,
    totalOutward: totalOutward,
    finalBalance: finalBalance,
    movements: inPeriodRecords
  };

  return { success: true, report: report };
}

function getStockAdjustmentsReportData(payload, session) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var params = payload || {};
  var rawStart = params.startDate || params.from || null;
  var rawEnd = params.endDate || params.to || null;
  var startDateStr = rawStart ? toCairoDateStrGS(rawStart) : null;
  var endDateStr = rawEnd ? toCairoDateStrGS(rawEnd) : null;
  var filterItemId = params.itemId ? String(params.itemId) : null;
  var filterWhId = (params.warehouseId && String(params.warehouseId).trim() !== '' && String(params.warehouseId).trim().toUpperCase() !== 'ALL')
    ? String(params.warehouseId).trim()
    : null;

  var items = getItemsFiltered(session);
  var itemMetaMap = {};
  for (var i = 0; i < items.length; i++) {
    itemMetaMap[String(items[i].id)] = items[i];
  }

  var allMovements = parseStockMovementsSheetGS(ss);
  var adjustments = [];

  for (var k = 0; k < allMovements.length; k++) {
    var m = allMovements[k];
    if (m.movementType !== 'تعديل كمية مباشر' && m.movementType !== 'تسوية جرد' && m.movementType !== 'تسوية مخزون بالإكسيل') continue;
    if (filterItemId && String(m.itemId) !== filterItemId) continue;
    if (filterWhId && String(m.warehouseId || 'wh-main') !== filterWhId) continue;
    var mDateStr = toCairoDateStrGS(m.date);
    if (startDateStr && mDateStr < startDateStr) continue;
    if (endDateStr && mDateStr > endDateStr) continue;
    adjustments.push(m);
  }

  adjustments.sort(function(a, b) {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  var totalIncreases = 0;
  var totalDecreases = 0;
  var records = [];

  for (var j = 0; j < adjustments.length; j++) {
    var adj = adjustments[j];
    var before = adj.quantityBefore !== undefined ? adj.quantityBefore : 0;
    var after = adj.quantityAfter !== undefined ? adj.quantityAfter : (adj.balanceAfter || 0);
    var diff = after - before;

    if (diff > 0) totalIncreases += diff;
    else totalDecreases += Math.abs(diff);

    var itMeta = itemMetaMap[String(adj.itemId)];

    records.push({
      id: adj.id,
      date: adj.date,
      itemId: adj.itemId,
      itemName: adj.itemName || (itMeta ? itMeta.name : ''),
      sku: itMeta ? itMeta.sku : undefined,
      barcode: itMeta ? itMeta.barcode : undefined,
      movementType: adj.movementType,
      quantityBefore: before,
      difference: diff,
      quantityAfter: after,
      reason: adj.reason || adj.notes || 'تعديل مباشر',
      userName: adj.userName || 'المستخدم',
      source: adj.movementType === 'تسوية مخزون بالإكسيل' ? 'تعديل بالإكسيل' : 'شاشة الأصناف',
      referenceNumber: adj.documentNumber,
      warehouseId: adj.warehouseId,
      warehouseName: adj.warehouseName
    });
  }

  var report = {
    records: records,
    totalIncreases: totalIncreases,
    totalDecreases: totalDecreases,
    netAdjustment: totalIncreases - totalDecreases,
    totalAdjustmentsCount: records.length,
    startDate: rawStart || undefined,
    endDate: rawEnd || undefined,
    itemId: filterItemId || undefined,
    warehouseId: filterWhId || undefined
  };

  return { success: true, report: report };
}

/**
 * تحويل أي تاريخ إلى YYYY-MM-DD بتوقيت القاهرة
 */
function toCairoDateStrGS(val) {
  if (!val) return '';
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'Africa/Cairo', 'yyyy-MM-dd');
    }
    return val.substring(0, 10);
  }
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Africa/Cairo', 'yyyy-MM-dd');
  }
  return '';
}

/**
 * فحص نطاق التاريخ شاملاً اليوم بتوقيت القاهرة
 */
function isDateInRangeGS(val, from, to) {
  if (!val) return false;
  var cDate = toCairoDateStrGS(val);
  if (!cDate) return false;
  if (from && cDate < from) return false;
  if (to && cDate > to) return false;
  return true;
}

/**
 * تقرير تقسيط المنصات (BNPL)
 */
function getBnplReportData(payload, session) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var params = payload || {};
  var rawStart = params.from || params.startDate || null;
  var rawEnd = params.to || params.endDate || null;
  var fromDate = rawStart ? toCairoDateStrGS(rawStart) : null;
  var toDate = rawEnd ? toCairoDateStrGS(rawEnd) : null;
  var targetPlatformId = params.platformId && params.platformId !== 'ALL' ? String(params.platformId) : null;
  var normalizedQuery = params.productQuery ? normalizeArabicTextGS(params.productQuery) : null;
  var groupBy = params.groupBy || 'item';

  var returnsRes = getReturnsData();
  var returns = returnsRes && returnsRes.returns ? returnsRes.returns : [];
  var returnLines = returnsRes && returnsRes.lines ? returnsRes.lines : [];

  var returnsByInvoice = {};
  var returnLinesByInvoice = {};
  for (var rIdx = 0; rIdx < returns.length; rIdx++) {
    var ret = returns[rIdx];
    if (!ret.invoiceNumber) continue;
    if (!returnsByInvoice[ret.invoiceNumber]) returnsByInvoice[ret.invoiceNumber] = [];
    returnsByInvoice[ret.invoiceNumber].push(ret);
  }
  for (var rlIdx = 0; rlIdx < returnLines.length; rlIdx++) {
    var rl = returnLines[rlIdx];
    if (!rl.invoiceNumber) continue;
    if (!returnLinesByInvoice[rl.invoiceNumber]) returnLinesByInvoice[rl.invoiceNumber] = [];
    returnLinesByInvoice[rl.invoiceNumber].push(rl);
  }

  var items = getItemsFiltered(session);
  var itemMetaMap = {};
  for (var itIdx = 0; itIdx < items.length; itIdx++) {
    itemMetaMap[String(items[itIdx].id)] = items[itIdx];
  }

  var invoicesRes = getInvoicesFiltered({}, session);
  var invoices = invoicesRes && invoicesRes.invoices ? invoicesRes.invoices : [];

  var matchedInvoiceNumbers = {};
  var matchedInvoiceCount = 0;
  var matchedInvoicesMap = {};
  var totalPieces = 0;
  var totalCustomerPaid = 0;
  var totalPriceIncrease = 0;
  var totalBnplAmount = 0;
  var totalBaseAmount = 0;
  var totalCommission = 0;
  var totalLinesNet = 0;
  var processedLines = [];

  for (var i = 0; i < invoices.length; i++) {
    var inv = invoices[i];
    if (inv.status === 'ملغاة') continue;
    if (targetPlatformId && String(inv.platformId) !== targetPlatformId) continue;
    if (fromDate || toDate) {
      if (!isDateInRangeGS(inv.date, fromDate, toDate)) continue;
    }

    var invNum = String(inv.invoiceNumber);
    var invRetLines = returnLinesByInvoice[invNum] || [];
    var returnedQtyByItem = {};
    for (var rli = 0; rli < invRetLines.length; rli++) {
      var rLine = invRetLines[rli];
      var itId = String(rLine.itemId);
      returnedQtyByItem[itId] = (returnedQtyByItem[itId] || 0) + (Number(rLine.returnedQuantity) || 0);
    }

    var invoiceHasBnplLine = false;
    var lines = inv.lines || [];

    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      var bnplPercent = Number(line.bnplPercent) || 0;
      if (bnplPercent <= 0) continue;

      var itmId = String(line.itemId);
      var returnedSoFar = returnedQtyByItem[itmId] || 0;
      var deductQty = 0;
      if (returnedSoFar > 0) {
        deductQty = Math.min(Number(line.quantity) || 0, returnedSoFar);
        returnedQtyByItem[itmId] -= deductQty;
      }
      var netQuantity = (Number(line.quantity) || 0) - deductQty;
      if (netQuantity <= 0) continue;

      if (normalizedQuery) {
        var nameNorm = normalizeArabicTextGS(line.itemNameAtSale);
        var idNorm = normalizeArabicTextGS(line.itemId);
        var barcodeNorm = line.barcodeAtSale ? normalizeArabicTextGS(line.barcodeAtSale) : '';
        var master = itemMetaMap[itmId];
        var masterBarcode = master && master.barcode ? normalizeArabicTextGS(master.barcode) : '';
        var masterName = master && master.name ? normalizeArabicTextGS(master.name) : '';

        var matched =
          nameNorm.indexOf(normalizedQuery) !== -1 ||
          idNorm.indexOf(normalizedQuery) !== -1 ||
          barcodeNorm.indexOf(normalizedQuery) !== -1 ||
          masterBarcode.indexOf(normalizedQuery) !== -1 ||
          masterName.indexOf(normalizedQuery) !== -1;

        if (!matched) continue;
      }

      invoiceHasBnplLine = true;

      var baseUnitPrice = Number(line.baseUnitPrice != null ? line.baseUnitPrice : line.salePriceAtSale) || 0;
      var customerUnitPrice = Number(
        line.customerUnitPrice != null
          ? line.customerUnitPrice
          : Math.round(baseUnitPrice * (1 + bnplPercent / 100) * 100) / 100
      );
      var bnplUnitAmount = Number(
        line.bnplUnitAmount != null ? line.bnplUnitAmount : customerUnitPrice - baseUnitPrice
      );
      var bnplDeductionUnit = Number(
        line.bnplDeductionUnit !== undefined && line.bnplDeductionUnit !== null
          ? line.bnplDeductionUnit
          : bnplUnitAmount
      );

      var lineCustomerPaid = Math.round(customerUnitPrice * netQuantity * 100) / 100;
      var linePriceIncrease = Math.round(bnplUnitAmount * netQuantity * 100) / 100;
      var lineBnplTotal = Math.round(bnplDeductionUnit * netQuantity * 100) / 100;
      var lineBaseTotal = Math.round(baseUnitPrice * netQuantity * 100) / 100;

      var commissionRate = Number(line.platformDiscountPercentAtSale) || 0;
      var unitCommission =
        line.unitDiscountValue !== undefined && line.unitDiscountValue !== null
          ? Number(line.unitDiscountValue)
          : baseUnitPrice * (commissionRate / 100);
      var lineCommission = Math.round(unitCommission * netQuantity * 100) / 100;
      var lineNet = Math.round((lineCustomerPaid - lineBnplTotal - lineCommission) * 100) / 100;

      totalPieces += netQuantity;
      totalCustomerPaid += lineCustomerPaid;
      totalPriceIncrease += linePriceIncrease;
      totalBnplAmount += lineBnplTotal;
      totalBaseAmount += lineBaseTotal;
      totalCommission += lineCommission;
      totalLinesNet += lineNet;

      processedLines.push({
        date: toCairoDateStrGS(inv.date),
        invoiceNumber: invNum,
        platformId: String(inv.platformId),
        platformName: String(inv.platformName || ''),
        itemId: itmId,
        itemName: String(line.itemNameAtSale || ''),
        itemBarcode: String(line.barcodeAtSale || ''),
        quantity: netQuantity,
        baseUnitPrice: baseUnitPrice,
        bnplPercent: bnplPercent,
        customerUnitPrice: customerUnitPrice,
        priceIncrease: linePriceIncrease,
        bnplAmount: lineBnplTotal,
        commission: lineCommission,
        net: lineNet
      });
    }

    if (invoiceHasBnplLine) {
      if (!matchedInvoiceNumbers[invNum]) {
        matchedInvoiceNumbers[invNum] = true;
        matchedInvoiceCount++;
      }
      matchedInvoicesMap[invNum] = inv;
    }
  }

  var totalInvoicesNetInCashbox = 0;
  for (var mInvNum in matchedInvoiceNumbers) {
    var mInv = matchedInvoicesMap[mInvNum];
    var invRets = returnsByInvoice[mInvNum] || [];
    var refunds = 0;
    for (var ri = 0; ri < invRets.length; ri++) {
      if (invRets[ri].refundStatus === 'استرداد نقدي' && invRets[ri].refundedAmount) {
        refunds += Number(invRets[ri].refundedAmount) || 0;
      }
    }
    var actualNet = Math.max(0, (Number(mInv.netAmount) || 0) - refunds);
    totalInvoicesNetInCashbox += actualNet;
  }

  var rows = [];

  if (groupBy === 'item') {
    var groupedItem = {};
    for (var li = 0; li < processedLines.length; li++) {
      var pl = processedLines[li];
      if (!groupedItem[pl.itemId]) {
        groupedItem[pl.itemId] = {
          itemId: pl.itemId,
          itemName: pl.itemName,
          itemBarcode: pl.itemBarcode,
          platformNames: {},
          invoiceNumbers: {},
          quantity: 0,
          totalBase: 0,
          totalCustomerPaid: 0,
          totalPriceIncrease: 0,
          totalBnpl: 0,
          commission: 0,
          net: 0
        };
      }
      var gi = groupedItem[pl.itemId];
      gi.platformNames[pl.platformName] = true;
      gi.invoiceNumbers[pl.invoiceNumber] = true;
      gi.quantity += pl.quantity;
      gi.totalBase += pl.baseUnitPrice * pl.quantity;
      gi.totalCustomerPaid += pl.customerUnitPrice * pl.quantity;
      gi.totalPriceIncrease += pl.priceIncrease;
      gi.totalBnpl += pl.bnplAmount;
      gi.commission += pl.commission;
      gi.net += pl.net;
    }

    for (var giKey in groupedItem) {
      var itmObj = groupedItem[giKey];
      var pNames = Object.keys(itmObj.platformNames);
      var invNums = Object.keys(itmObj.invoiceNumbers);
      var avgBase = itmObj.quantity > 0 ? Math.round((itmObj.totalBase / itmObj.quantity) * 100) / 100 : 0;
      var avgCustomer = itmObj.quantity > 0 ? Math.round((itmObj.totalCustomerPaid / itmObj.quantity) * 100) / 100 : 0;
      var avgBnplPercent = itmObj.totalBase > 0 ? Math.round((itmObj.totalPriceIncrease / itmObj.totalBase) * 10000) / 100 : 0;
      var pltName = pNames.length === 1 ? pNames[0] : 'متعدد';

      rows.push({
        id: 'item-' + itmObj.itemId,
        date: '-',
        invoiceNumber: invNums.length + ' فواتير',
        platformId: 'ALL',
        platformName: pltName,
        itemId: itmObj.itemId,
        itemName: itmObj.itemName,
        itemBarcode: itmObj.itemBarcode,
        quantity: itmObj.quantity,
        baseUnitPrice: avgBase,
        bnplPercent: avgBnplPercent,
        customerUnitPrice: avgCustomer,
        priceIncrease: Math.round(itmObj.totalPriceIncrease * 100) / 100,
        bnplAmount: Math.round(itmObj.totalBnpl * 100) / 100,
        commission: Math.round(itmObj.commission * 100) / 100,
        net: Math.round(itmObj.net * 100) / 100
      });
    }
  } else if (groupBy === 'platform') {
    var groupedPlt = {};
    for (var lpi = 0; lpi < processedLines.length; lpi++) {
      var pl2 = processedLines[lpi];
      if (!groupedPlt[pl2.platformId]) {
        groupedPlt[pl2.platformId] = {
          platformId: pl2.platformId,
          platformName: pl2.platformName,
          itemNames: {},
          invoiceNumbers: {},
          quantity: 0,
          totalBase: 0,
          totalCustomerPaid: 0,
          totalPriceIncrease: 0,
          totalBnpl: 0,
          commission: 0,
          net: 0
        };
      }
      var gp = groupedPlt[pl2.platformId];
      gp.itemNames[pl2.itemName] = true;
      gp.invoiceNumbers[pl2.invoiceNumber] = true;
      gp.quantity += pl2.quantity;
      gp.totalBase += pl2.baseUnitPrice * pl2.quantity;
      gp.totalCustomerPaid += pl2.customerUnitPrice * pl2.quantity;
      gp.totalPriceIncrease += pl2.priceIncrease;
      gp.totalBnpl += pl2.bnplAmount;
      gp.commission += pl2.commission;
      gp.net += pl2.net;
    }

    for (var gpKey in groupedPlt) {
      var pltObj = groupedPlt[gpKey];
      var itmCount = Object.keys(pltObj.itemNames).length;
      var invCount = Object.keys(pltObj.invoiceNumbers).length;
      var avgBase2 = pltObj.quantity > 0 ? Math.round((pltObj.totalBase / pltObj.quantity) * 100) / 100 : 0;
      var avgCustomer2 = pltObj.quantity > 0 ? Math.round((pltObj.totalCustomerPaid / pltObj.quantity) * 100) / 100 : 0;
      var avgBnplPercent2 = pltObj.totalBase > 0 ? Math.round((pltObj.totalPriceIncrease / pltObj.totalBase) * 10000) / 100 : 0;

      rows.push({
        id: 'plt-' + pltObj.platformId,
        date: '-',
        invoiceNumber: invCount + ' فواتير',
        platformId: pltObj.platformId,
        platformName: pltObj.platformName,
        itemId: '-',
        itemName: itmCount + ' أصناف',
        quantity: pltObj.quantity,
        baseUnitPrice: avgBase2,
        bnplPercent: avgBnplPercent2,
        customerUnitPrice: avgCustomer2,
        priceIncrease: Math.round(pltObj.totalPriceIncrease * 100) / 100,
        bnplAmount: Math.round(pltObj.totalBnpl * 100) / 100,
        commission: Math.round(pltObj.commission * 100) / 100,
        net: Math.round(pltObj.net * 100) / 100
      });
    }
  } else {
    // groupBy === 'invoice'
    var groupedInv = {};
    for (var lii = 0; lii < processedLines.length; lii++) {
      var pl3 = processedLines[lii];
      if (!groupedInv[pl3.invoiceNumber]) {
        groupedInv[pl3.invoiceNumber] = {
          invoiceNumber: pl3.invoiceNumber,
          date: pl3.date,
          platformId: pl3.platformId,
          platformName: pl3.platformName,
          itemNames: [],
          quantity: 0,
          totalBase: 0,
          totalCustomerPaid: 0,
          totalPriceIncrease: 0,
          totalBnpl: 0,
          commission: 0,
          net: 0
        };
      }
      var ginv = groupedInv[pl3.invoiceNumber];
      if (ginv.itemNames.indexOf(pl3.itemName) === -1) {
        ginv.itemNames.push(pl3.itemName);
      }
      ginv.quantity += pl3.quantity;
      ginv.totalBase += pl3.baseUnitPrice * pl3.quantity;
      ginv.totalCustomerPaid += pl3.customerUnitPrice * pl3.quantity;
      ginv.totalPriceIncrease += pl3.priceIncrease;
      ginv.totalBnpl += pl3.bnplAmount;
      ginv.commission += pl3.commission;
      ginv.net += pl3.net;
    }

    for (var ginvKey in groupedInv) {
      var invObj = groupedInv[ginvKey];
      var avgBase3 = invObj.quantity > 0 ? Math.round((invObj.totalBase / invObj.quantity) * 100) / 100 : 0;
      var avgCustomer3 = invObj.quantity > 0 ? Math.round((invObj.totalCustomerPaid / invObj.quantity) * 100) / 100 : 0;
      var avgBnplPercent3 = invObj.totalBase > 0 ? Math.round((invObj.totalPriceIncrease / invObj.totalBase) * 10000) / 100 : 0;
      var itemDisplay = invObj.itemNames.length === 1
        ? invObj.itemNames[0]
        : (invObj.itemNames[0] + ' (+' + (invObj.itemNames.length - 1) + ' أصناف)');

      rows.push({
        id: 'inv-' + invObj.invoiceNumber,
        date: invObj.date,
        invoiceNumber: invObj.invoiceNumber,
        platformId: invObj.platformId,
        platformName: invObj.platformName,
        itemId: '-',
        itemName: itemDisplay,
        quantity: invObj.quantity,
        baseUnitPrice: avgBase3,
        bnplPercent: avgBnplPercent3,
        customerUnitPrice: avgCustomer3,
        priceIncrease: Math.round(invObj.totalPriceIncrease * 100) / 100,
        bnplAmount: Math.round(invObj.totalBnpl * 100) / 100,
        commission: Math.round(invObj.commission * 100) / 100,
        net: Math.round(invObj.net * 100) / 100
      });
    }
  }

  var summary = {
    invoicesCount: matchedInvoiceCount,
    piecesCount: totalPieces,
    totalCustomerPaid: Math.round(totalCustomerPaid * 100) / 100,
    totalPriceIncrease: Math.round(totalPriceIncrease * 100) / 100,
    totalBnplAmount: Math.round(totalBnplAmount * 100) / 100,
    totalBaseAmount: Math.round(totalBaseAmount * 100) / 100,
    totalCommission: Math.round(totalCommission * 100) / 100,
    totalLinesNet: Math.round(totalLinesNet * 100) / 100,
    totalInvoicesNetInCashbox: Math.round(totalInvoicesNetInCashbox * 100) / 100
  };

  return {
    success: true,
    report: {
      summary: summary,
      rows: rows,
      groupBy: groupBy
    }
  };
}

/**
 * تقرير المنصة المالي والتشغيلي
 */
function getPlatformReportData(payload, session) {
  var params = payload || {};
  var platformId = params.platformId ? String(params.platformId) : '';
  if (!platformId) {
    return { success: false, error: 'يجب تحديد المنصة لعرض التقرير' };
  }

  var rawStart = params.from || params.startDate || null;
  var rawEnd = params.to || params.endDate || null;
  var fromDate = rawStart ? toCairoDateStrGS(rawStart) : null;
  var toDate = rawEnd ? toCairoDateStrGS(rawEnd) : null;
  var stagnantDaysThreshold = Math.max(1, Number(params.stagnantDays) || 30);

  var platformsRes = getPlatformsData();
  var platforms = platformsRes && platformsRes.platforms ? platformsRes.platforms : [];
  var platform = null;
  for (var p = 0; p < platforms.length; p++) {
    if (String(platforms[p].id) === platformId) {
      platform = platforms[p];
      break;
    }
  }
  if (!platform) {
    return { success: false, error: 'المنصة المحددة غير موجودة' };
  }

  var items = getItemsFiltered(session);
  var itemMap = {};
  for (var it = 0; it < items.length; it++) {
    itemMap[String(items[it].id)] = items[it];
  }

  var returnsRes = getReturnsData();
  var returnLines = returnsRes && returnsRes.lines ? returnsRes.lines : [];
  var returnLinesByInvoice = {};
  for (var rlIdx = 0; rlIdx < returnLines.length; rlIdx++) {
    var rl = returnLines[rlIdx];
    if (!rl.invoiceNumber) continue;
    if (!returnLinesByInvoice[rl.invoiceNumber]) returnLinesByInvoice[rl.invoiceNumber] = [];
    returnLinesByInvoice[rl.invoiceNumber].push(rl);
  }

  var invoicesRes = getInvoicesFiltered({}, session);
  var invoices = invoicesRes && invoicesRes.invoices ? invoicesRes.invoices : [];

  var pendingDeferredBalance = 0;
  var lastSaleDateByItemOnPlatform = {};

  for (var i = 0; i < invoices.length; i++) {
    var inv = invoices[i];
    if (String(inv.platformId) !== platformId || inv.status === 'ملغاة') continue;

    if (Number(inv.remainingAmount || 0) > 0) {
      pendingDeferredBalance += Number(inv.remainingAmount || 0);
    }

    var lines = inv.lines || [];
    for (var lIdx = 0; lIdx < lines.length; lIdx++) {
      var l = lines[lIdx];
      var prevDate = lastSaleDateByItemOnPlatform[l.itemId];
      if (!prevDate || new Date(inv.date).getTime() > new Date(prevDate).getTime()) {
        lastSaleDateByItemOnPlatform[l.itemId] = inv.date;
      }
    }
  }

  var invoicesCount = 0;
  var totalGrossSales = 0;
  var totalPriceIncrease = 0;
  var totalBnplAmount = 0;
  var totalBaseSales = 0;
  var totalCommission = 0;
  var totalPickupFees = 0;
  var totalDeliveryFees = 0;
  var totalNet = 0;
  var totalCost = 0;

  var itemStatsMap = {};
  var dailySalesMap = {};

  for (var invIdx = 0; invIdx < invoices.length; invIdx++) {
    var inv2 = invoices[invIdx];
    if (String(inv2.platformId) !== platformId || inv2.status === 'ملغاة') continue;

    if (fromDate || toDate) {
      if (!isDateInRangeGS(inv2.date, fromDate, toDate)) continue;
    }

    invoicesCount++;

    var invRetLines = returnLinesByInvoice[inv2.invoiceNumber] || [];
    var returnedQtyByItem = {};
    for (var rli = 0; rli < invRetLines.length; rli++) {
      var retL = invRetLines[rli];
      returnedQtyByItem[retL.itemId] = (returnedQtyByItem[retL.itemId] || 0) + (Number(retL.returnedQuantity) || 0);
    }

    var invGross = 0;
    var invPriceIncrease = 0;
    var invBnpl = 0;
    var invBase = 0;
    var invCost = 0;
    var invCommission = 0;
    var invPickup = 0;

    var invLines = inv2.lines || [];
    for (var j = 0; j < invLines.length; j++) {
      var line = invLines[j];
      var returnedSoFar = returnedQtyByItem[line.itemId] || 0;
      var deductQty = 0;
      if (returnedSoFar > 0) {
        deductQty = Math.min(line.quantity, returnedSoFar);
        returnedQtyByItem[line.itemId] -= deductQty;
      }
      var netQty = line.quantity - deductQty;
      if (netQty <= 0) continue;

      var baseUnitPrice = line.baseUnitPrice !== undefined && line.baseUnitPrice !== null ? Number(line.baseUnitPrice) : Number(line.salePriceAtSale || 0);
      var customerUnitPrice = line.customerUnitPrice !== undefined && line.customerUnitPrice !== null ? Number(line.customerUnitPrice) : Number(line.salePriceAtSale || 0);
      var bnplUnitAmount = line.bnplUnitAmount !== undefined && line.bnplUnitAmount !== null ? Number(line.bnplUnitAmount) : Math.max(0, customerUnitPrice - baseUnitPrice);
      var bnplDeductionUnit = line.bnplDeductionUnit !== undefined && line.bnplDeductionUnit !== null ? Number(line.bnplDeductionUnit) : bnplUnitAmount;

      var lineBase = baseUnitPrice * netQty;
      var lineGross = customerUnitPrice * netQty;
      var linePriceIncrease = bnplUnitAmount * netQty;
      var lineBnpl = bnplDeductionUnit * netQty;

      var itemObj = itemMap[line.itemId];
      var unitPurchase = line.purchasePriceAtSale !== undefined ? Number(line.purchasePriceAtSale) : Number(itemObj ? (itemObj.purchasePrice || 0) : 0);
      var unitPackaging = line.packagingCostAtSale !== undefined ? Number(line.packagingCostAtSale) : Number(itemObj ? (itemObj.packagingCost || 0) : 0);
      var unitCost = unitPurchase + unitPackaging;
      var lineCost = unitCost * netQty;

      var commPercent = line.platformDiscountPercentAtSale !== undefined && line.platformDiscountPercentAtSale !== null ? Number(line.platformDiscountPercentAtSale) : Number(platform.discountPercentage || 0);
      var unitComm = line.unitDiscountValue !== undefined && line.unitDiscountValue !== null ? Number(line.unitDiscountValue) : (baseUnitPrice * (commPercent / 100));
      var lineCommission = unitComm * netQty;

      var unitPickup = line.unitPickupFee !== undefined ? Number(line.unitPickupFee) : Number(platform.pickupFee || 0);
      var linePickup = unitPickup * netQty;

      invGross += lineGross;
      invPriceIncrease += linePriceIncrease;
      invBnpl += lineBnpl;
      invBase += lineBase;
      invCost += lineCost;
      invCommission += lineCommission;
      invPickup += linePickup;

      if (!itemStatsMap[line.itemId]) {
        itemStatsMap[line.itemId] = {
          itemId: line.itemId,
          itemName: line.itemNameAtSale || (itemObj ? itemObj.name : line.itemId),
          barcode: itemObj ? itemObj.barcode : '',
          quantity: 0,
          revenue: 0,
          profit: 0
        };
      }
      var stat = itemStatsMap[line.itemId];
      stat.quantity += netQty;
      stat.revenue += lineGross;
      stat.profit += (lineGross - lineBnpl - lineCost - lineCommission - linePickup);
    }

    var deliveryFee = Number(inv2.deliveryFee || 0);
    var pickupFee = invPickup > 0 || invRetLines.length > 0 ? invPickup : Number(inv2.pickupFeeAmount || 0);
    var commission = invCommission > 0 || invRetLines.length > 0 ? invCommission : Number(inv2.discountAmount || 0);

    totalGrossSales += invGross + deliveryFee;
    totalPriceIncrease += invPriceIncrease;
    totalBnplAmount += invBnpl;
    totalBaseSales += invBase;
    totalCommission += commission;
    totalPickupFees += pickupFee;
    totalDeliveryFees += deliveryFee;
    totalCost += invCost;

    var invNet = Math.max(0, invGross - invBnpl + deliveryFee - commission - pickupFee);
    totalNet += invNet;

    var dayStr = toCairoDateStrGS(inv2.date);
    if (!dailySalesMap[dayStr]) {
      dailySalesMap[dayStr] = {
        date: dayStr,
        invoicesCount: 0,
        grossSales: 0,
        netSales: 0
      };
    }
    var dayStat = dailySalesMap[dayStr];
    dayStat.invoicesCount += 1;
    dayStat.grossSales += invGross + deliveryFee;
    dayStat.netSales += invNet;
  }

  var estimatedProfit = Math.round((totalGrossSales - totalBnplAmount - totalCost - totalCommission - totalPickupFees) * 100) / 100;
  var profitMargin = totalBaseSales > 0 ? Math.round((estimatedProfit / totalBaseSales) * 10000) / 100 : 0;
  var averageInvoiceValue = invoicesCount > 0 ? Math.round((totalGrossSales / invoicesCount) * 100) / 100 : 0;

  var allItemStats = [];
  for (var itKey in itemStatsMap) {
    allItemStats.push(itemStatsMap[itKey]);
  }

  var topByQuantity = allItemStats.slice().sort(function(a, b) { return b.quantity - a.quantity; }).slice(0, 10).map(function(i) {
    return {
      itemId: i.itemId,
      itemName: i.itemName,
      barcode: i.barcode,
      quantity: i.quantity,
      revenue: Math.round(i.revenue * 100) / 100,
      profit: Math.round(i.profit * 100) / 100
    };
  });

  var topByRevenue = allItemStats.slice().sort(function(a, b) { return b.revenue - a.revenue; }).slice(0, 10).map(function(i) {
    return {
      itemId: i.itemId,
      itemName: i.itemName,
      barcode: i.barcode,
      quantity: i.quantity,
      revenue: Math.round(i.revenue * 100) / 100,
      profit: Math.round(i.profit * 100) / 100
    };
  });

  var nowMs = new Date().getTime();
  var stagnantItems = [];

  for (var sIdx = 0; sIdx < items.length; sIdx++) {
    var itCandidate = items[sIdx];
    if (Number(itCandidate.stockQuantity || 0) <= 0) continue;

    var isAvailableOnPlatform = !itCandidate.platformIds || itCandidate.platformIds.length === 0 || itCandidate.platformIds.indexOf(platformId) !== -1;
    if (!isAvailableOnPlatform) continue;

    var lastSale = lastSaleDateByItemOnPlatform[itCandidate.id] || null;
    var daysSince = null;
    if (lastSale) {
      daysSince = Math.floor((nowMs - new Date(lastSale).getTime()) / (1000 * 60 * 60 * 24));
    }

    if (lastSale === null || (daysSince !== null && daysSince >= stagnantDaysThreshold)) {
      stagnantItems.push({
        itemId: itCandidate.id,
        itemName: itCandidate.name,
        barcode: itCandidate.barcode,
        stockQuantity: itCandidate.stockQuantity,
        salePrice: itCandidate.salePrice,
        lastSaleDate: lastSale,
        daysSinceLastSale: daysSince
      });
    }
  }

  stagnantItems.sort(function(a, b) {
    if (a.daysSinceLastSale === null && b.daysSinceLastSale !== null) return -1;
    if (a.daysSinceLastSale !== null && b.daysSinceLastSale === null) return 1;
    if (a.daysSinceLastSale !== null && b.daysSinceLastSale !== null) {
      return b.daysSinceLastSale - a.daysSinceLastSale;
    }
    return b.stockQuantity - a.stockQuantity;
  });

  var dayKeys = Object.keys(dailySalesMap).sort();
  var dailySales = [];
  for (var dk = 0; dk < dayKeys.length; dk++) {
    dailySales.push(dailySalesMap[dayKeys[dk]]);
  }

  var summary = {
    platformId: platform.id,
    platformName: platform.name,
    invoicesCount: invoicesCount,
    totalGrossSales: Math.round(totalGrossSales * 100) / 100,
    totalPriceIncrease: Math.round(totalPriceIncrease * 100) / 100,
    totalBnplAmount: Math.round(totalBnplAmount * 100) / 100,
    totalBaseSales: Math.round(totalBaseSales * 100) / 100,
    totalCommission: Math.round(totalCommission * 100) / 100,
    totalPickupFees: Math.round(totalPickupFees * 100) / 100,
    totalDeliveryFees: Math.round(totalDeliveryFees * 100) / 100,
    totalNet: Math.round(totalNet * 100) / 100,
    estimatedProfit: estimatedProfit,
    profitMargin: profitMargin,
    averageInvoiceValue: averageInvoiceValue,
    pendingDeferredBalance: Math.round(pendingDeferredBalance * 100) / 100
  };

  return {
    success: true,
    report: {
      summary: summary,
      topByQuantity: topByQuantity,
      topByRevenue: topByRevenue,
      stagnantItems: stagnantItems,
      stagnantDays: stagnantDaysThreshold,
      dailySales: dailySales,
      dateRange: { from: fromDate, to: toDate }
    }
  };
}

/**
 * توحيد الحروف العربية للبحث الدقيق
 */
function normalizeArabicTextGS(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .trim();
}

/**
 * استجابة JSON سليمة
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * فحص يدوي لتطابق قوائم الصلاحيات وقوالب الأدوار مع الواجهة الأمامية (src/utils/permissions.ts)
 * يُشغّل يدويًا من محرر Apps Script ويعرض النتائج في Logger
 */
function checkPermissionsSync() {
  var expectedPermissions = [
    'dashboard.view',
    'dashboard.view_cashboxes',
    'items.view', 'items.create', 'items.edit', 'items.status', 'items.delete',
    'categories.view', 'categories.manage',
    'prices.view_sale', 'prices.view_purchase', 'prices.view_packaging', 'prices.override_min_price',
    'stock.view', 'stock.edit', 'stock.adjust', 'stock.alerts', 'stock.override_negative',
    'warehouses.view', 'warehouses.manage', 'warehouses.transfer',
    'platforms.view', 'platforms.create', 'platforms.edit', 'platforms.status', 'platforms.pricing',
    'invoices.view', 'invoices.view_in_pos', 'invoices.create', 'invoices.edit_cash_paid',
    'invoices.edit_price_before_save', 'invoices.edit_tax_before_save', 'pos.edit_rates',
    'invoices.edit',
    'invoices.edit_after_save', 'invoices.edit_price_after_save', 'invoices.edit_tax_after_save',
    'invoices.edit_quantity_after_save', 'invoices.edit_items_after_save', 'invoices.edit_platform_after_save',
    'invoices.edit_customer_after_save', 'invoices.edit_discount_shipping_after_save', 'invoices.edit_cashbox_after_save',
    'invoices.cancel', 'invoices.print', 'invoices.export', 'invoices.collect_credit', 'offline.manage',
    'returns.view', 'returns.create', 'returns.approve', 'returns.restock',
    'reports.view_profit', 'reports.view_costs', 'reports.view_reports', 'reports.export',
    'reports.item_movement.view', 'reports.stock_adjustments.view', 'reports.bnpl_view', 'reports.platform_view',
    'users.view', 'users.create', 'users.edit', 'users.status',
    'permissions.view', 'permissions.manage',
    'settings.company_appearance',
    'settings.invoice_print',
    'settings.display_customization',
    'settings.system_integration',
    'settings.negative_stock',
    'audit.view',
    'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete',
    'purchases.view', 'purchases.create', 'purchases.return',
    'customers.view', 'customers.create', 'customers.edit',
    'cashbox.view', 'cashbox.create', 'cashbox.transfer', 'cashbox.receipt', 'cashbox.payment',
    'items.import_export',
    'products.export',
    'products.bulk_edit_excel',
    'products.inline_edit'
  ];

  var missingInCodeGs = expectedPermissions.filter(function(k) {
    return ALL_PERMISSIONS.indexOf(k) === -1;
  });
  var extraInCodeGs = ALL_PERMISSIONS.filter(function(k) {
    return expectedPermissions.indexOf(k) === -1;
  });

  var managerOutsideAll = (ROLE_TEMPLATES.manager || []).filter(function(k) {
    return ALL_PERMISSIONS.indexOf(k) === -1;
  });
  var employeeOutsideAll = (ROLE_TEMPLATES.employee || []).filter(function(k) {
    return ALL_PERMISSIONS.indexOf(k) === -1;
  });

  Logger.log('=== فحص تطابق الصلاحيات (checkPermissionsSync) ===');
  Logger.log('إجمالي ALL_PERMISSIONS في Code.gs: ' + ALL_PERMISSIONS.length);
  Logger.log('إجمالي الصلاحيات المتوقعة (permissions.ts): ' + expectedPermissions.length);
  Logger.log('مفاتيح ناقصة في Code.gs: ' + (missingInCodeGs.length ? missingInCodeGs.join(', ') : 'لا يوجد'));
  Logger.log('مفاتيح زائدة في Code.gs: ' + (extraInCodeGs.length ? extraInCodeGs.join(', ') : 'لا يوجد'));
  Logger.log('مفاتيح في قالب manager غير موجودة في ALL_PERMISSIONS: ' + (managerOutsideAll.length ? managerOutsideAll.join(', ') : 'لا يوجد'));
  Logger.log('مفاتيح في قالب employee غير موجودة في ALL_PERMISSIONS: ' + (employeeOutsideAll.length ? employeeOutsideAll.join(', ') : 'لا يوجد'));

  var isSynced = missingInCodeGs.length === 0 && extraInCodeGs.length === 0 && managerOutsideAll.length === 0 && employeeOutsideAll.length === 0;
  Logger.log('النتيجة النهائية: ' + (isSynced ? 'متطابق 100% ✅' : 'يوجد اختلاف ❌'));
  return {
    synced: isSynced,
    totalInCodeGs: ALL_PERMISSIONS.length,
    missingInCodeGs: missingInCodeGs,
    extraInCodeGs: extraInCodeGs,
    managerOutsideAll: managerOutsideAll,
    employeeOutsideAll: employeeOutsideAll
  };
}

/**
 * دالة يدوية لإضافة 20 صنفًا تجريبيًا في أوراق العمل دون تكرار (تُشغّل يدويًا من محرر Apps Script)
 */
function seedDemoItems() {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupSheets();

  var sItems = ss.getSheetByName(SHEETS.ITEMS);
  var sBarcodes = ss.getSheetByName(SHEETS.ITEM_BARCODES);
  var sPlatformCosts = ss.getSheetByName(SHEETS.ITEM_PLATFORM_COSTS);
  var sMovements = ss.getSheetByName(SHEETS.STOCK_MOVEMENTS);

  var hItems = getHeaderMap(sItems);
  var itemsData = sItems.getDataRange().getValues();
  var barcodesData = sBarcodes ? sBarcodes.getDataRange().getValues() : [];

  var existingBarcodes = {};
  var existingIds = {};
  for (var i = 1; i < itemsData.length; i++) {
    var rowId = String(colVal(itemsData[i], hItems.get('ID', 0)) || '').trim();
    var rowBc = String(colVal(itemsData[i], hItems.get('الباركود الأساسي', 10)) || '').trim();
    if (rowId) existingIds[rowId] = true;
    if (rowBc) existingBarcodes[rowBc] = true;
  }
  for (var j = 1; j < barcodesData.length; j++) {
    var bcVal = String(barcodesData[j][2] || '').trim();
    if (bcVal) existingBarcodes[bcVal] = true;
  }

  var demoItems = [
    { id: 'demo-01', name: 'شاحن سامسونج 25 واط تايب سي', categoryId: 'cat-chargers', salePrice: 450, minPrice: 380, purchasePrice: 260, packagingCost: 10, taxRate: 14, stockQuantity: 35, reorderLimit: 10, barcode: '6224000100018', secondaryBarcode: 'SAM-25W-TC', supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)', amzShip: 30, amzRet: 20, noonShip: 35, noonRet: 25 },
    { id: 'demo-02', name: 'باور بانك أنكر 20000 مللي أمبير', categoryId: 'cat-chargers', salePrice: 1350, minPrice: 1150, purchasePrice: 850, packagingCost: 20, taxRate: 14, stockQuantity: 20, reorderLimit: 5, barcode: '6224000100025', secondaryBarcode: 'ANK-PB-20K', supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)', amzShip: 40, amzRet: 30, noonShip: 45, noonRet: 30 },
    { id: 'demo-03', name: 'كابل آيفون لايتنينج سريع 1 متر', categoryId: 'cat-chargers', salePrice: 220, minPrice: 180, purchasePrice: 110, packagingCost: 8, taxRate: 14, stockQuantity: 60, reorderLimit: 15, barcode: '6224000100032', secondaryBarcode: 'CBL-IP-1M', supplier: 'مؤسسة النيل للتوريدات الحديثة', amzShip: 25, amzRet: 15, noonShip: 30, noonRet: 20 },
    { id: 'demo-04', name: 'شاحن سيارة سريع مزدوج 45 واط', categoryId: 'cat-chargers', salePrice: 320, minPrice: 270, purchasePrice: 175, packagingCost: 10, taxRate: 14, stockQuantity: 25, reorderLimit: 8, barcode: '6224000100049', secondaryBarcode: 'CAR-CHG-45W', supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)', amzShip: 30, amzRet: 20, noonShip: 35, noonRet: 25 },
    { id: 'demo-05', name: 'مشترك كهرباء ذكي 4 مخارج مع USB', categoryId: 'cat-chargers', salePrice: 580, minPrice: 500, purchasePrice: 340, packagingCost: 15, taxRate: 14, stockQuantity: 18, reorderLimit: 5, barcode: '6224000100056', secondaryBarcode: 'PWR-STR-4U', supplier: 'مؤسسة النيل للتوريدات الحديثة', amzShip: 35, amzRet: 25, noonShip: 40, noonRet: 30 },
    { id: 'demo-06', name: 'سماعة رأس بلوتوث محيطية ستوديو', categoryId: 'cat-audio', salePrice: 950, minPrice: 800, purchasePrice: 560, packagingCost: 25, taxRate: 14, stockQuantity: 15, reorderLimit: 5, barcode: '6224000100063', secondaryBarcode: 'HDP-BT-STD', supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)', amzShip: 35, amzRet: 25, noonShip: 40, noonRet: 30 },
    { id: 'demo-07', name: 'مكبر صوت بلوتوث محمول ضد الماء', categoryId: 'cat-audio', salePrice: 780, minPrice: 650, purchasePrice: 450, packagingCost: 20, taxRate: 14, stockQuantity: 22, reorderLimit: 6, barcode: '6224000100070', secondaryBarcode: 'SPK-BT-WP', supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)', amzShip: 35, amzRet: 25, noonShip: 40, noonRet: 30 },
    { id: 'demo-08', name: 'ميكروفون لاسلكي لتسجيل المحتوى', categoryId: 'cat-audio', salePrice: 650, minPrice: 550, purchasePrice: 370, packagingCost: 15, taxRate: 14, stockQuantity: 12, reorderLimit: 5, barcode: '6224000100087', secondaryBarcode: 'MIC-WL-PRO', supplier: 'مؤسسة النيل للتوريدات الحديثة', amzShip: 30, amzRet: 20, noonShip: 35, noonRet: 25 },
    { id: 'demo-09', name: 'سماعة أذن سلكية تايب سي مايك عالي النقاء', categoryId: 'cat-audio', salePrice: 190, minPrice: 150, purchasePrice: 95, packagingCost: 8, taxRate: 14, stockQuantity: 45, reorderLimit: 12, barcode: '6224000100094', secondaryBarcode: 'EAR-TC-HD', supplier: 'مؤسسة النيل للتوريدات الحديثة', amzShip: 25, amzRet: 15, noonShip: 30, noonRet: 20 },
    { id: 'demo-10', name: 'صب ووفر مكتبي ستيريو RGB', categoryId: 'cat-audio', salePrice: 890, minPrice: 750, purchasePrice: 520, packagingCost: 30, taxRate: 14, stockQuantity: 8, reorderLimit: 4, barcode: '6224000100100', secondaryBarcode: 'SUB-RGB-21', supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)', amzShip: 45, amzRet: 35, noonShip: 50, noonRet: 35 },
    { id: 'demo-11', name: 'ساعة ذكية رياضية ضد الماء شاشة AMOLED', categoryId: 'cat-elec', salePrice: 1450, minPrice: 1250, purchasePrice: 880, packagingCost: 25, taxRate: 14, stockQuantity: 14, reorderLimit: 5, barcode: '6224000100117', secondaryBarcode: 'WTC-SM-AMO', supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)', amzShip: 35, amzRet: 25, noonShip: 40, noonRet: 30 },
    { id: 'demo-12', name: 'ماوس لاسلكي صامت مريح لليد', categoryId: 'cat-elec', salePrice: 290, minPrice: 240, purchasePrice: 155, packagingCost: 10, taxRate: 14, stockQuantity: 40, reorderLimit: 10, barcode: '6224000100124', secondaryBarcode: 'MSE-WL-SLNT', supplier: 'مؤسسة النيل للتوريدات الحديثة', amzShip: 25, amzRet: 15, noonShip: 30, noonRet: 20 },
    { id: 'demo-13', name: 'لوحة مفاتيح ميكانيكية مضيئة RGB', categoryId: 'cat-elec', salePrice: 1100, minPrice: 950, purchasePrice: 660, packagingCost: 25, taxRate: 14, stockQuantity: 10, reorderLimit: 4, barcode: '6224000100131', secondaryBarcode: 'KBD-MECH-RGB', supplier: 'مؤسسة النيل للتوريدات الحديثة', amzShip: 40, amzRet: 30, noonShip: 45, noonRet: 30 },
    { id: 'demo-14', name: 'حامل لابتوب ألومنيوم قابل للطي', categoryId: 'cat-elec', salePrice: 420, minPrice: 350, purchasePrice: 230, packagingCost: 15, taxRate: 14, stockQuantity: 28, reorderLimit: 8, barcode: '6224000100148', secondaryBarcode: 'STD-LAP-ALU', supplier: 'مؤسسة النيل للتوريدات الحديثة', amzShip: 35, amzRet: 25, noonShip: 40, noonRet: 30 },
    { id: 'demo-15', name: 'كاميرا ويب FHD 1080p مع ميكروفون', categoryId: 'cat-elec', salePrice: 720, minPrice: 600, purchasePrice: 410, packagingCost: 15, taxRate: 14, stockQuantity: 6, reorderLimit: 8, barcode: '6224000100155', secondaryBarcode: 'CAM-FHD-1080', supplier: 'شركة الشرق الأوسط للإلكترونيات (وكيل أنكر)', amzShip: 30, amzRet: 20, noonShip: 35, noonRet: 25 },
    { id: 'demo-16', name: 'ماكينة قهوة تركي كهربائية بالسينسور', categoryId: 'cat-kettles', salePrice: 1650, minPrice: 1450, purchasePrice: 1020, packagingCost: 35, taxRate: 0, stockQuantity: 12, reorderLimit: 4, barcode: '6224000100162', secondaryBarcode: 'COF-TRK-SNS', supplier: 'مصنع الدلتا للأجهزة المنزلية', amzShip: 50, amzRet: 35, noonShip: 55, noonRet: 40 },
    { id: 'demo-17', name: 'غلاية مياه زجاج بيركس مضيئة 1.7 لتر', categoryId: 'cat-kettles', salePrice: 680, minPrice: 580, purchasePrice: 390, packagingCost: 25, taxRate: 0, stockQuantity: 20, reorderLimit: 6, barcode: '6224000100179', secondaryBarcode: 'KTL-GLS-17L', supplier: 'مصنع الدلتا للأجهزة المنزلية', amzShip: 45, amzRet: 30, noonShip: 50, noonRet: 35 },
    { id: 'demo-18', name: 'مضرب نسكافيه ولبن كهربائي ستانلس', categoryId: 'cat-kettles', salePrice: 180, minPrice: 140, purchasePrice: 90, packagingCost: 10, taxRate: 0, stockQuantity: 50, reorderLimit: 15, barcode: '6224000100186', secondaryBarcode: 'FRT-MLK-SS', supplier: 'مصنع الدلتا للأجهزة المنزلية', amzShip: 25, amzRet: 15, noonShip: 30, noonRet: 20 },
    { id: 'demo-19', name: 'خلاط كهربائي 500 واط مع مطحنة توابل', categoryId: 'cat-appliances', salePrice: 1280, minPrice: 1100, purchasePrice: 780, packagingCost: 40, taxRate: 0, stockQuantity: 9, reorderLimit: 5, barcode: '6224000100193', secondaryBarcode: 'BLD-500W-GR', supplier: 'مصنع الدلتا للأجهزة المنزلية', amzShip: 55, amzRet: 40, noonShip: 60, noonRet: 45 },
    { id: 'demo-20', name: 'مكواة بخار سيراميك 2200 واط', categoryId: 'cat-appliances', salePrice: 980, minPrice: 840, purchasePrice: 580, packagingCost: 30, taxRate: 0, stockQuantity: 0, reorderLimit: 5, barcode: '6224000100209', secondaryBarcode: 'IRN-STM-2200', supplier: 'مصنع الدلتا للأجهزة المنزلية', amzShip: 45, amzRet: 35, noonShip: 50, noonRet: 35 }
  ];

  var nowStr = new Date().toISOString();
  var addedCount = 0;
  var skippedCount = 0;

  for (var k = 0; k < demoItems.length; k++) {
    var d = demoItems[k];
    if (existingIds[d.id] || existingBarcodes[d.barcode]) {
      skippedCount++;
      continue;
    }

    var rowData = new Array(hItems.headers.length).fill('');
    function setCol(name, val, fallbackIdx) {
      var idx = hItems.get(name, fallbackIdx);
      if (idx !== -1 && idx < rowData.length) rowData[idx] = val;
    }

    setCol('ID', d.id, 0);
    setCol('اسم الصنف', d.name, 1);
    setCol('رابط الصورة', '/demo-items/' + d.id + '.svg', 2);
    setCol('سعر البيع', d.salePrice, 3);
    setCol('سعر الشراء', d.purchasePrice, 4);
    setCol('تكلفة التغليف', d.packagingCost, 5);
    setCol('الكمية بالمخزن', d.stockQuantity, 6);
    setCol('ملاحظات', 'صنف تجريبي للاختبار', 7);
    setCol('تاريخ الإضافة', nowStr, 8);
    setCol('حالة الصنف', 'نشط', 9);
    setCol('الباركود الأساسي', d.barcode, 10);
    setCol('المورد', d.supplier, 11);
    setCol('نسبة الضريبة', d.taxRate, 12);
    setCol('الحد الأدنى لسعر البيع', d.minPrice, 13);
    setCol('كود SKU', d.secondaryBarcode, 14);
    setCol('حد إعادة الطلب', d.reorderLimit, 15);
    setCol('المورد الافتراضي', d.supplier, 16);
    setCol('ID التصنيف', d.categoryId, 17);

    sItems.appendRow(rowData);

    if (sBarcodes) {
      sBarcodes.appendRow([generateUUID(), d.id, d.barcode, 'primary', 'الباركود المصنعي', true, nowStr]);
      sBarcodes.appendRow([generateUUID(), d.id, d.secondaryBarcode, 'secondary', 'رمز التخزين SKU', true, nowStr]);
    }

    if (sPlatformCosts) {
      sPlatformCosts.appendRow([d.id, 'plt-amz-001', d.amzShip, d.amzRet]);
      sPlatformCosts.appendRow([d.id, 'plt-noon-004', d.noonShip, d.noonRet]);
    }

    setItemWarehouseBalanceGS(ss, d.id, 'wh-main', d.stockQuantity, nowStr);

    if (sMovements && d.stockQuantity > 0) {
      sMovements.appendRow(buildRowWithWarehouseGS(sMovements, [
        'sm-' + d.id,
        d.id,
        d.name,
        'استيراد رصيد افتتاحي',
        d.stockQuantity,
        d.stockQuantity,
        'رصيد افتتاحي تجريبي',
        'OPN-DEMO-' + (k + 1),
        'المهندس عبدالله (المدير العام)',
        nowStr,
        'رصيد افتتاحي للأصناف التجريبية'
      ], 'wh-main'));
    }

    existingIds[d.id] = true;
    existingBarcodes[d.barcode] = true;
    addedCount++;
  }

  Logger.log('=== seedDemoItems ===');
  Logger.log('تمت إضافة: ' + addedCount + ' صنف | تم تخطي (موجود مسبقًا): ' + skippedCount + ' صنف');
  return { added: addedCount, skipped: skippedCount };
  });
}

/**
 * حساب رصيد الطرف (عميل أو منصة) من مجموع حركات السجل (مدين - دائن)
 * الموجب يعني على الطرف، والسالب يعني له رصيد دائن
 */
function computePartyBalanceGS(ss, partyType, partyId) {
  var entries = getRawPartyLedgerEntriesGS(ss, partyType, partyId);
  var sum = 0;
  for (var i = 0; i < entries.length; i++) {
    sum += (Number(entries[i].debit) || 0) - (Number(entries[i].credit) || 0);
  }
  return Math.round(sum * 100) / 100;
}

function getRawPartyLedgerEntriesGS(ss, partyType, partyId) {
  var list = [];
  var seenIds = {};
  var sParty = ss.getSheetByName(SHEETS.PARTY_LEDGER);
  if (sParty && sParty.getLastRow() > 1) {
    var pData = sParty.getDataRange().getValues();
    for (var i = 1; i < pData.length; i++) {
      var r = pData[i];
      if (String(r[2]) === String(partyType) && String(r[3]) === String(partyId)) {
        var entryId = String(r[0]);
        seenIds[entryId] = true;
        list.push({
          id: entryId,
          date: String(r[1]),
          partyType: String(r[2]),
          partyId: String(r[3]),
          partyName: String(r[4]),
          transactionType: String(r[5]),
          documentNumber: String(r[6]),
          debit: Number(r[7]) || 0,
          credit: Number(r[8]) || 0,
          balanceAfter: Number(r[9]) || 0,
          statement: String(r[10] || ''),
          userName: String(r[11] || ''),
          notes: String(r[12] || '')
        });
      }
    }
  }

  // استكمال حركات العملاء السابقة من CustomerLedger إن لم تكن مسجلة في PartyLedger
  if (partyType === 'customer') {
    var sCustLedger = ss.getSheetByName(SHEETS.CUSTOMER_LEDGER);
    if (sCustLedger && sCustLedger.getLastRow() > 1) {
      var cData = sCustLedger.getDataRange().getValues();
      for (var j = 1; j < cData.length; j++) {
        var cr = cData[j];
        var cId = String(cr[0]);
        if (String(cr[2]) === String(partyId) && !seenIds[cId]) {
          seenIds[cId] = true;
          list.push({
            id: cId,
            date: String(cr[1]),
            partyType: 'customer',
            partyId: String(cr[2]),
            partyName: String(cr[3]),
            transactionType: String(cr[4]),
            documentNumber: String(cr[5]),
            debit: Number(cr[6]) || 0,
            credit: Number(cr[7]) || 0,
            balanceAfter: Number(cr[8]) || 0,
            statement: String(cr[9] || ''),
            userName: String(cr[10] || ''),
            notes: String(cr[11] || '')
          });
        }
      }
    }
  }

  list.sort(function(a, b) {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  var running = 0;
  for (var k = 0; k < list.length; k++) {
    running = Math.round((running + (Number(list[k].debit) || 0) - (Number(list[k].credit) || 0)) * 100) / 100;
    list[k].balanceAfter = running;
  }

  return list;
}

/**
 * جلب سجل حساب الطرف والفواتير الآجلة المعلّقة مع الفلترة بالتاريخ بتوقيت القاهرة
 */
function getPartyLedgerData(payload, session) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var partyType = payload.partyType === 'platform' ? 'platform' : 'customer';
  var partyId = String(payload.partyId || '');
  if (!partyId) {
    return { success: false, error: 'يجب تحديد الطرف' };
  }

  var fromDate = payload.from || payload.startDate || null;
  var toDate = payload.to || payload.endDate || null;

  var allEntries = getRawPartyLedgerEntriesGS(ss, partyType, partyId);
  var totalBalance = computePartyBalanceGS(ss, partyType, partyId);

  var openingBalanceBeforeFrom = 0;
  if (fromDate) {
    for (var i = 0; i < allEntries.length; i++) {
      var dStr = toCairoDateStrGS(allEntries[i].date);
      if (dStr && dStr < fromDate) {
        openingBalanceBeforeFrom = Math.round((openingBalanceBeforeFrom + (Number(allEntries[i].debit) || 0) - (Number(allEntries[i].credit) || 0)) * 100) / 100;
      }
    }
  }

  var filteredLedger = [];
  var runningPeriod = openingBalanceBeforeFrom;
  for (var j = 0; j < allEntries.length; j++) {
    if (!fromDate && !toDate || isDateInRangeGS(allEntries[j].date, fromDate, toDate)) {
      var copy = {};
      for (var k in allEntries[j]) copy[k] = allEntries[j][k];
      runningPeriod = Math.round((runningPeriod + (Number(copy.debit) || 0) - (Number(copy.credit) || 0)) * 100) / 100;
      copy.balanceAfter = runningPeriod;
      filteredLedger.push(copy);
    }
  }

  // جلب الفواتير الآجلة المعلّقة للطرف
  var invRes = getInvoicesFiltered(session, {});
  var allInvoices = invRes.invoices || [];
  var pendingInvoices = [];
  for (var m = 0; m < allInvoices.length; m++) {
    var inv = allInvoices[m];
    if (inv.status === 'ملغاة') continue;
    var isPending = (inv.paymentType === 'آجل' && (inv.creditStatus === 'معلّقة' || inv.status === 'معلّقة' || (inv.creditStatus !== 'مسددة' && inv.status !== 'مسددة' && Number(inv.remainingAmount || 0) > 0)));
    if (!isPending) continue;

    var belongs = false;
    if (inv.creditPartyType && inv.creditPartyId) {
      belongs = (inv.creditPartyType === partyType && String(inv.creditPartyId) === partyId);
    } else if (partyType === 'customer') {
      belongs = (String(inv.customerId || '') === partyId);
    } else if (partyType === 'platform') {
      belongs = (String(inv.platformId || '') === partyId && !inv.customerId);
    }
    if (!belongs) continue;

    if (fromDate || toDate) {
      if (!isDateInRangeGS(inv.date, fromDate, toDate)) continue;
    }

    inv.creditDueAmount = partyType === 'customer'
      ? Math.round(((Number(inv.totalBeforeDiscount) || 0) + (Number(inv.deliveryFee) || 0)) * 100) / 100
      : Math.round((Number(inv.netAmount) || 0) * 100) / 100;

    pendingInvoices.push(inv);
  }

  return {
    success: true,
    partyType: partyType,
    partyId: partyId,
    ledger: filteredLedger,
    pendingInvoices: pendingInvoices,
    currentBalance: totalBalance,
    openingBalanceForPeriod: openingBalanceBeforeFrom
  };
}

/**
 * تحصيل الفواتير الآجلة المعلّقة لطرف (عميل أو منصة) مع التحقق الصارم وإعادة الحساب على السيرفر
 */
function collectCreditInvoicesData(payload, session) {
  var reqIdemKey = getValidatedIdempotencyKeyGS(payload);
  if (!reqIdemKey) {
    return { success: false, statusCode: 400, error: IDEMPOTENCY_MISSING_ERROR_GS };
  }
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sPartyLedger = ensureSheetWithHeaders(ss, SHEETS.PARTY_LEDGER, [
      'ID', 'التاريخ والوقت', 'نوع الطرف', 'معرّف الطرف', 'اسم الطرف', 'نوع المعاملة',
      'رقم المستند / المرجع', 'مدين (عليه)', 'دائن (له)', 'الرصيد بعد الحركة',
      'البيان / الشرح', 'المستخدم', 'ملاحظات', 'idempotencyKey'
    ]);
    var dupColMatch = findRowByIdempotencyKeyGS(sPartyLedger, reqIdemKey);
    if (dupColMatch) {
      var r0 = dupColMatch.rowValues;
      var dupDoc = String(r0[6] || '');
      var dupPartyType = String(r0[2] || 'customer');
      var dupPartyId = String(r0[3] || '');
      var dupPartyName = String(r0[4] || '');
      var dupTotalDue = Number(r0[8]) || 0;
      var dupFinalBal = Number(r0[9]) || 0;
      var dupStmt = String(r0[10] || '');
      var settledList = [];
      var listMatch = dupStmt.match(/\(([^)]+)\)/);
      if (listMatch && listMatch[1]) {
        settledList = listMatch[1].split('،').map(function(s) { return s.trim(); }).filter(Boolean);
      }
      var dupReceived = dupTotalDue;
      var recMatch = dupStmt.match(/المستلم الفعلي:\s*([0-9]+(?:\.[0-9]+)?)/);
      if (recMatch && recMatch[1]) {
        dupReceived = Number(recMatch[1]);
      }
      var dupDiff = Math.round((dupReceived - dupTotalDue) * 100) / 100;
      if (dupColMatch.rowIndex < sPartyLedger.getLastRow()) {
        var nextRow = sPartyLedger.getRange(dupColMatch.rowIndex + 1, 1, 1, dupColMatch.lastCol).getValues()[0];
        if (String(nextRow[6] || '') === dupDoc + '-DIFF') {
          dupFinalBal = Number(nextRow[9]) || dupFinalBal;
        }
      }
      return {
        success: true,
        duplicate: true,
        documentNumber: dupDoc,
        collectionId: dupDoc,
        partyType: dupPartyType,
        partyId: dupPartyId,
        partyName: dupPartyName,
        settledInvoices: settledList,
        totalDue: dupTotalDue,
        receivedAmount: dupReceived,
        differenceAmount: dupDiff,
        partyBalanceAfter: dupFinalBal
      };
    }

    var isOfflineMode = Boolean(payload && (payload.isOfflineSync || payload.isOffline));
    var partyType = payload.partyType;
    var partyId = String(payload.partyId || '').trim();
    var invoiceNumbers = Array.isArray(payload.invoiceNumbers) ? payload.invoiceNumbers : [];
    var cashboxId = String(payload.cashboxId || '').trim();
    var receivedAmount = Number(payload.receivedAmount);
    var confirmDifference = payload.confirmDifference === true || isOfflineMode;

    if (partyType !== 'customer' && partyType !== 'platform') {
      return { success: false, statusCode: 400, error: 'نوع الطرف غير صالح (يجب أن يكون عميل أو منصة)' };
    }
    if (!partyId) {
      return { success: false, statusCode: 400, error: 'يجب اختيار الطرف' };
    }

    var partyName = '';
    if (partyType === 'customer') {
      var customers = getCustomersData();
      for (var c = 0; c < customers.length; c++) {
        if (String(customers[c].id) === partyId) {
          partyName = customers[c].name;
          break;
        }
      }
      if (!partyName) return { success: false, statusCode: 400, error: 'العميل المحدد غير موجود' };
    } else {
      var platforms = getPlatformsData();
      for (var p = 0; p < platforms.length; p++) {
        if (String(platforms[p].id) === partyId) {
          partyName = platforms[p].name;
          break;
        }
      }
      if (!partyName) return { success: false, statusCode: 400, error: 'المنصة المحددة غير موجودة' };
    }

    // إزالة التكرار من أرقام الفواتير
    var uniqueNums = [];
    var seenNums = {};
    for (var u = 0; u < invoiceNumbers.length; u++) {
      var n = String(invoiceNumbers[u] || '').trim();
      if (n && !seenNums[n]) {
        seenNums[n] = true;
        uniqueNums.push(n);
      }
    }
    if (uniqueNums.length === 0) {
      return { success: false, statusCode: 400, error: 'يجب تحديد فاتورة معلّقة واحدة على الأقل للتحصيل' };
    }

    if (isNaN(receivedAmount) || receivedAmount < 0) {
      return { success: false, statusCode: 400, error: 'المبلغ المستلم يجب أن يكون رقماً صالحاً (صفر أو أكبر)' };
    }
    receivedAmount = Math.round(receivedAmount * 100) / 100;

    // فحص الخزنة
    var sCashboxes = getOrCreateSheet(ss, SHEETS.CASHBOXES);
    var cbData = sCashboxes.getDataRange().getValues();
    var cbRow = -1;
    var cbName = '';
    var cbBalance = 0;
    for (var cbIdx = 1; cbIdx < cbData.length; cbIdx++) {
      if (String(cbData[cbIdx][0]) === cashboxId && String(cbData[cbIdx][6] || 'نشطة') !== 'موقوفة') {
        cbRow = cbIdx + 1;
        cbName = String(cbData[cbIdx][1]);
        cbBalance = Number(cbData[cbIdx][5]) || 0;
        break;
      }
    }
    if (cbRow === -1) {
      return { success: false, statusCode: 400, error: 'يجب اختيار خزنة صالحة ونشطة لإيداع التحصيل' };
    }

    // قراءة الفواتير وإعادة حساب المستحق على السيرفر
    var sInvoices = ss.getSheetByName(SHEETS.INVOICES);
    if (!sInvoices || sInvoices.getLastRow() < 2) {
      return { success: false, statusCode: 400, error: 'لا توجد فواتير مسجلة' };
    }
    ensureSheetWithHeaders(ss, SHEETS.INVOICES, [
      'رقم الفاتورة', 'التاريخ', 'المنصة', 'الإجمالي قبل الخصم', 'قيمة الخصم', 'مصاريف الشحن',
      'الصافي', 'الربح', 'الحالة', 'ملاحظات', 'المستخدم الذي أنشأ الفاتورة', 'إجمالي الضريبة',
      'إجمالي رسوم الالتقاط', 'معدلة', 'تاريخ آخر تعديل', 'رسوم التوصيل', 'إجمالي خصم BNPL',
      'نوع الدفع', 'نوع طرف الآجل', 'معرّف الطرف', 'اسم الطرف', 'مبلغ الاستحقاق',
      'المبلغ المدفوع', 'المبلغ المتبقي', 'حالة الآجل',
      'نسبة BNPL المطبقة', 'نسبة عمولة المنصة المطبقة',
      'تاريخ الإلغاء', 'المستخدم الذي ألغى', 'سبب الإلغاء', 'idempotencyKey',
      'معرف الجهاز أوفلاين', 'الرقم المؤقت أوفلاين', 'وقت الجهاز أوفلاين', 'تحتاج مراجعة', 'أسباب المراجعة'
    ]);

    var invData = sInvoices.getDataRange().getValues();
    var totalDue = 0;
    var pendingTotalDue = 0;
    var targetRows = [];
    var duplicateRows = [];
    var duplicateInvNums = [];
    var settledInvNums = [];

    for (var idx = 0; idx < uniqueNums.length; idx++) {
      var targetInvNum = uniqueNums[idx];
      var foundRow = -1;
      var r = null;
      for (var ir = 1; ir < invData.length; ir++) {
        if (String(invData[ir][0]) === targetInvNum || String(invData[ir][32] || '') === targetInvNum) {
          foundRow = ir + 1;
          r = invData[ir];
          break;
        }
      }
      if (foundRow === -1 || !r) {
        return { success: false, statusCode: 400, error: 'الفاتورة رقم ' + targetInvNum + ' غير موجودة' };
      }

      var actualInvNum = String(r[0]);
      var rowStatus = String(r[8] || '');
      var rowPayType = String(r[17] || (rowStatus === 'معلّقة' ? 'آجل' : 'نقدي'));
      var rowCreditPartyType = String(r[18] || '');
      var rowCreditPartyId = String(r[19] || '');
      var rowCreditStatus = String(r[24] || '');

      if (rowStatus === 'ملغاة') {
        return { success: false, statusCode: 400, error: 'الفاتورة رقم ' + actualInvNum + ' ملغاة ولا يمكن تحصيلها' };
      }
      if (rowPayType !== 'آجل') {
        return { success: false, statusCode: 400, error: 'الفاتورة رقم ' + actualInvNum + ' ليست فاتورة آجلة' };
      }

      var belongsToParty = false;
      if (rowCreditPartyType && rowCreditPartyId) {
        belongsToParty = (rowCreditPartyType === partyType && rowCreditPartyId === partyId);
      } else if (partyType === 'platform') {
        belongsToParty = (String(r[2]).toLowerCase() === partyName.toLowerCase());
      }
      if (!belongsToParty) {
        return { success: false, statusCode: 400, error: 'الفاتورة رقم ' + actualInvNum + ' لا تخص الطرف المحدد (' + partyName + ')' };
      }

      // إعادة حساب المستحق على السيرفر: للعميل = إجمالي الفاتورة، وللمنصة = الصافي
      var grossTotal = (Number(r[3]) || 0) + (Number(r[15]) || 0);
      var netTotal = Number(r[6]) || 0;
      var serverDue = partyType === 'customer'
        ? Math.round(grossTotal * 100) / 100
        : Math.round(netTotal * 100) / 100;

      totalDue = Math.round((totalDue + serverDue) * 100) / 100;

      if (rowCreditStatus === 'مسددة' || rowStatus === 'مسددة') {
        if (!isOfflineMode) {
          return { success: false, statusCode: 400, error: 'الفاتورة رقم ' + actualInvNum + ' مسددة بالفعل ولا يمكن تحصيلها مرتين' };
        }
        duplicateRows.push({
          rowIndex: foundRow,
          invoiceNumber: actualInvNum,
          dueAmount: serverDue,
          existingReasons: String(r[35] || '')
        });
        duplicateInvNums.push(actualInvNum);
      } else {
        pendingTotalDue = Math.round((pendingTotalDue + serverDue) * 100) / 100;
        targetRows.push({
          rowIndex: foundRow,
          invoiceNumber: actualInvNum,
          dueAmount: serverDue
        });
        settledInvNums.push(actualInvNum);
      }
    }

    var hasDuplicateCollection = duplicateRows.length > 0;
    var differenceAmount = Math.round((receivedAmount - totalDue) * 100) / 100;
    var hasDifference = Math.abs(differenceAmount) >= 0.01;

    if (!hasDuplicateCollection && hasDifference && !confirmDifference) {
      var diffAbs = Math.abs(differenceAmount);
      var msg = differenceAmount < 0
        ? ('المبلغ أقل من المستحق بمقدار ' + diffAbs + '، وسيُرحَّل الفرق على ' + partyName)
        : ('المبلغ أعلى من المستحق بمقدار ' + diffAbs + '، وسيُسجَّل كرصيد دائن لـ ' + partyName);
      return {
        success: false,
        statusCode: 400,
        requiresConfirmation: true,
        totalDue: totalDue,
        receivedAmount: receivedAmount,
        differenceAmount: differenceAmount,
        error: msg
      };
    }

    var now = new Date();
    var dateStr = Utilities.formatDate(now, 'GMT+2', 'yyyyMMdd');
    var docNumber = 'COL-' + dateStr + '-' + Math.floor(1000 + Math.random() * 9000);
    var isoDate = now.toISOString();
    var actorName = session.phone || payload.createdBy || 'محاسب';

    // 1. تحديث الفواتير المعلقة لتصبح مسددة
    for (var t = 0; t < targetRows.length; t++) {
      var tr = targetRows[t];
      sInvoices.getRange(tr.rowIndex, 9).setValue('مسددة'); // الحالة
      sInvoices.getRange(tr.rowIndex, 22).setValue(tr.dueAmount); // مبلغ الاستحقاق
      sInvoices.getRange(tr.rowIndex, 23).setValue(tr.dueAmount); // المبلغ المدفوع
      sInvoices.getRange(tr.rowIndex, 24).setValue(0); // المبلغ المتبقي
      sInvoices.getRange(tr.rowIndex, 25).setValue('مسددة'); // حالة الآجل
    }

    // في حال وجود فواتير حُصّلت من جهاز آخر: تعليمها بـ needsReview وسبب «تحصيل مكرر»
    for (var d = 0; d < duplicateRows.length; d++) {
      var dr = duplicateRows[d];
      var mergedReasons = dr.existingReasons
        ? (dr.existingReasons.indexOf('تحصيل مكرر') === -1 ? dr.existingReasons + '، تحصيل مكرر' : dr.existingReasons)
        : 'تحصيل مكرر';
      sInvoices.getRange(dr.rowIndex, 35).setValue('نعم');
      sInvoices.getRange(dr.rowIndex, 36).setValue(mergedReasons);
    }

    // 2. تسجيل حركة التحصيل في سجل حساب الطرف
    ensureSheetWithHeaders(ss, SHEETS.PARTY_LEDGER, [
      'ID', 'التاريخ والوقت', 'نوع الطرف', 'معرّف الطرف', 'اسم الطرف', 'نوع المعاملة',
      'رقم المستند / المرجع', 'مدين (عليه)', 'دائن (له)', 'الرصيد بعد الحركة',
      'البيان / الشرح', 'المستخدم', 'ملاحظات', 'idempotencyKey'
    ]);

    var currentPartyBal = computePartyBalanceGS(ss, partyType, partyId);
    var sCustLedger = partyType === 'customer' ? getOrCreateSheet(ss, SHEETS.CUSTOMER_LEDGER) : null;
    var finalPartyBalance = currentPartyBal;

    if (!hasDuplicateCollection) {
      var balAfterCollection = Math.round((currentPartyBal - totalDue) * 100) / 100;
      var colEntryId = generateUUID();
      var colStmt = 'تحصيل فواتير آجلة (' + settledInvNums.join('، ') + ') - المستحق: ' + totalDue + ' - المستلم الفعلي: ' + receivedAmount;

      sPartyLedger.appendRow(buildRowWithIdempotencyKeyGS(sPartyLedger, [
        colEntryId,
        isoDate,
        partyType,
        partyId,
        partyName,
        'تحصيل',
        docNumber,
        0,
        totalDue,
        balAfterCollection,
        colStmt,
        actorName,
        payload.notes || ''
      ], reqIdemKey));

      if (sCustLedger) {
        sCustLedger.appendRow([
          colEntryId,
          isoDate,
          partyId,
          partyName,
          'تحصيل',
          docNumber,
          0,
          totalDue,
          balAfterCollection,
          colStmt,
          actorName,
          payload.notes || ''
        ]);
      }

      finalPartyBalance = balAfterCollection;
      if (hasDifference) {
        var isShortfall = differenceAmount < 0;
        var absDiff = Math.round(Math.abs(differenceAmount) * 100) / 100;
        var diffDebit = isShortfall ? absDiff : 0;
        var diffCredit = isShortfall ? 0 : absDiff;
        finalPartyBalance = Math.round((balAfterCollection + diffDebit - diffCredit) * 100) / 100;

        var diffDoc = docNumber + '-DIFF';
        var diffId = generateUUID();
        var diffStmt = isShortfall
          ? ('فرق تحصيل (أقل من المستحق بمقدار ' + absDiff + ') مُرحّل على ' + partyName + ' للفواتير: ' + settledInvNums.join('، '))
          : ('فرق تحصيل (أعلى من المستحق بمقدار ' + absDiff + ') مسجّل كرصيد دائن لـ ' + partyName + ' للفواتير: ' + settledInvNums.join('، '));

        sPartyLedger.appendRow([
          diffId,
          isoDate,
          partyType,
          partyId,
          partyName,
          'فرق تحصيل',
          diffDoc,
          diffDebit,
          diffCredit,
          finalPartyBalance,
          diffStmt,
          actorName,
          payload.notes || ''
        ]);

        if (sCustLedger) {
          sCustLedger.appendRow([
            diffId,
            isoDate,
            partyId,
            partyName,
            'فرق تحصيل',
            diffDoc,
            diffDebit,
            diffCredit,
            finalPartyBalance,
            diffStmt,
            actorName,
            payload.notes || ''
          ]);
        }
      }
    } else {
      // حالة وجود فاتورة أو أكثر حُصّلت من جهاز آخر:
      // أ) تحصيل الفواتير التي ما زالت معلقة (إن وجدت)
      if (settledInvNums.length > 0 && pendingTotalDue > 0) {
        var balAfterPending = Math.round((finalPartyBalance - pendingTotalDue) * 100) / 100;
        var pendColId = generateUUID();
        var pendStmt = 'تحصيل فواتير آجلة (' + settledInvNums.join('، ') + ') - المستحق: ' + pendingTotalDue;

        sPartyLedger.appendRow(buildRowWithIdempotencyKeyGS(sPartyLedger, [
          pendColId,
          isoDate,
          partyType,
          partyId,
          partyName,
          'تحصيل',
          docNumber,
          0,
          pendingTotalDue,
          balAfterPending,
          pendStmt,
          actorName,
          payload.notes || ''
        ], reqIdemKey));

        if (sCustLedger) {
          sCustLedger.appendRow([
            pendColId,
            isoDate,
            partyId,
            partyName,
            'تحصيل',
            docNumber,
            0,
            pendingTotalDue,
            balAfterPending,
            pendStmt,
            actorName,
            payload.notes || ''
          ]);
        }
        finalPartyBalance = balAfterPending;
      }

      // ب) تسجيل المبلغ المتبقي كرصيد دائن للطرف مع needsReview وسبب «تحصيل مكرر»
      var dupCreditAmount = Math.max(0, Math.round((receivedAmount - pendingTotalDue) * 100) / 100);
      finalPartyBalance = Math.round((finalPartyBalance - dupCreditAmount) * 100) / 100;
      var dupEntryId = generateUUID();
      var dupEntryDoc = settledInvNums.length > 0 ? (docNumber + '-DUP') : docNumber;
      var dupStmtText = 'رصيد دائن لـ ' + partyName + ' نتيجة تحصيل مكرر للفواتير (' + duplicateInvNums.join('، ') + ') - يحتاج مراجعة: تحصيل مكرر';

      sPartyLedger.appendRow(buildRowWithIdempotencyKeyGS(sPartyLedger, [
        dupEntryId,
        isoDate,
        partyType,
        partyId,
        partyName,
        'تحصيل مكرر',
        dupEntryDoc,
        0,
        dupCreditAmount,
        finalPartyBalance,
        dupStmtText,
        actorName,
        (payload.notes ? payload.notes + ' | ' : '') + 'تحصيل مكرر - يحتاج مراجعة'
      ], settledInvNums.length > 0 ? (reqIdemKey + '-dup') : reqIdemKey));

      if (sCustLedger) {
        sCustLedger.appendRow([
          dupEntryId,
          isoDate,
          partyId,
          partyName,
          'تحصيل مكرر',
          dupEntryDoc,
          0,
          dupCreditAmount,
          finalPartyBalance,
          dupStmtText,
          actorName,
          (payload.notes ? payload.notes + ' | ' : '') + 'تحصيل مكرر - يحتاج مراجعة'
        ]);
      }
    }

    // تحديث عمود الرصيد في Customers إن كان عميلاً
    if (partyType === 'customer') {
      var sCustSheet = ss.getSheetByName(SHEETS.CUSTOMERS);
      if (sCustSheet && sCustSheet.getLastRow() > 1) {
        var custRows = sCustSheet.getDataRange().getValues();
        for (var crIdx = 1; crIdx < custRows.length; crIdx++) {
          if (String(custRows[crIdx][0]) === partyId) {
            sCustSheet.getRange(crIdx + 1, 13).setValue(finalPartyBalance);
            break;
          }
        }
      }
    }

    // 3. الخزنة يدخلها المبلغ المستلم فقط
    if (receivedAmount > 0) {
      var newCbBalance = Math.round((cbBalance + receivedAmount) * 100) / 100;
      sCashboxes.getRange(cbRow, 6).setValue(newCbBalance);

      var sCashboxTx = ensureSheetWithHeaders(ss, SHEETS.CASHBOX_TRANSACTIONS, [
        'ID', 'التاريخ والوقت', 'ID الخزينة', 'اسم الخزينة', 'نوع الحركة', 'رقم المستند / المرجع',
        'المبلغ', 'الرصيد بعد الحركة', 'الجهة / الطرف الآخر', 'البيان', 'المستخدم', 'ملاحظات', 'idempotencyKey'
      ]);
      sCashboxTx.appendRow(buildRowWithIdempotencyKeyGS(sCashboxTx, [
        generateUUID(),
        isoDate,
        cashboxId,
        cbName,
        'تحصيل آجل',
        docNumber,
        receivedAmount,
        newCbBalance,
        partyName,
        'تحصيل آجل من ' + (partyType === 'customer' ? 'العميل' : 'المنصة') + ' ' + partyName + ' للفواتير: ' + uniqueNums.join('، ') + (hasDuplicateCollection ? ' (يحتاج مراجعة: تحصيل مكرر)' : ''),
        actorName,
        payload.notes || ''
      ], reqIdemKey));
    }

    logAudit(
      session,
      isOfflineMode ? 'OFFLINE_CREDIT_COLLECTION_SYNC' : 'CREDIT_COLLECTION',
      partyType === 'customer' ? 'Customer' : 'Platform',
      partyId,
      'تحصيل آجل [' + docNumber + '] للطرف ' + partyName + ': الفواتير (' + uniqueNums.join(', ') + ') | المستحق: ' + totalDue + ' | المستلم: ' + receivedAmount + ' | الفرق: ' + differenceAmount + (hasDuplicateCollection ? ' | تحصيل مكرر يحتاج مراجعة (' + duplicateInvNums.join(', ') + ')' : '')
    );

    return {
      success: true,
      documentNumber: docNumber,
      collectionId: docNumber,
      partyType: partyType,
      partyId: partyId,
      partyName: partyName,
      settledInvoices: settledInvNums,
      duplicateCollectionInvoices: duplicateInvNums,
      needsReview: hasDuplicateCollection,
      reviewReasons: hasDuplicateCollection ? ['تحصيل مكرر'] : [],
      totalDue: totalDue,
      receivedAmount: receivedAmount,
      differenceAmount: differenceAmount,
      partyBalanceAfter: finalPartyBalance
    };
  });
}

/**
 * ============================================================================
 * التعديل / الإضافة / الحذف الجماعي للأصناف عبر ملف إكسيل (Bulk Edit Excel)
 * ============================================================================
 */

var BULK_EDIT_EXCEL_MAX_ROWS_GS = 5000;

var BULK_EDIT_OP_LABELS_GS = {
  sale_price: 'تعديل سعر البيع',
  purchase_price: 'تعديل سعر الشراء',
  stock_quantity: 'تعديل الكميات',
  name: 'تعديل الاسم',
  print_name: 'تعديل اسم الطباعة',
  barcode_sku: 'تعديل الباركود / الكود',
  primary_barcode: 'تعديل الباركود الرئيسي',
  add_secondary_barcode: 'إضافة باركود فرعي',
  notes: 'تعديل الوصف',
  category: 'تعديل التصنيف',
  platforms: 'تعديل المنصات المرتبطة',
  bnpl: 'تعديل BNPL',
  pickup_fee: 'تعديل رسوم الالتقاط للقطعة',
  min_price: 'تعديل الحد الأدنى لسعر البيع',
  packaging_cost: 'تعديل تكلفة التغليف',
  tax_rate: 'تعديل نسبة الضريبة %',
  reorder_limit: 'تعديل الحد الأدنى للكمية',
  supplier: 'تعديل المورد',
  unit: 'تعديل وحدة القياس',
  status: 'تعديل الحالة',
  image_url: 'تعديل رابط الصورة',
  add_items: 'إضافة أصناف',
  delete_items: 'حذف أصناف'
};

var BULK_EDIT_ITEMS_HEADERS_GS = [
  'ID',
  'اسم الصنف',
  'رابط الصورة',
  'سعر البيع',
  'سعر الشراء',
  'تكلفة التغليف',
  'الكمية بالمخزن',
  'ملاحظات',
  'تاريخ الإضافة',
  'حالة الصنف',
  'الباركود الأساسي',
  'المورد',
  'نسبة الضريبة',
  'الحد الأدنى لسعر البيع',
  'كود SKU',
  'حد إعادة الطلب',
  'المورد الافتراضي',
  'ID التصنيف',
  'تفعيل BNPL',
  'نسبة BNPL',
  'معرفات المنصات المتاحة',
  'رسوم الالتقاط للقطعة',
  'وحدة القياس',
  'اسم الطباعة'
];

var BULK_EDIT_UNDO_HEADERS_GS = [
  'ID الدفعة',
  'نوع العملية',
  'وصف العملية',
  'اسم الملف',
  'تاريخ التنفيذ',
  'المستخدم المنفذ',
  'معرف المستخدم',
  'ID الصنف',
  'اسم الصنف',
  'بيانات الصف السابقة (JSON)',
  'الباركودات السابقة (JSON)',
  'معرف المخزن',
  'الكمية السابقة بالمخزن',
  'الحد الأدنى السابق بالمخزن'
];

function hasSessionPermGS(session, perm) {
  if (!session) return false;
  if (session.role === 'designer' || Boolean(session.isOwner)) return true;
  return Array.isArray(session.permissions) && session.permissions.indexOf(perm) !== -1;
}

function hasBulkEditExcelPermGS(session) {
  return hasSessionPermGS(session, 'products.bulk_edit_excel');
}

function hasPurchasePricePermGS(session) {
  return hasSessionPermGS(session, 'prices.view_purchase');
}

function hasPackagingCostPermGS(session) {
  return hasSessionPermGS(session, 'prices.view_packaging');
}

function hasCreateItemsPermGS(session) {
  return hasSessionPermGS(session, 'items.create');
}

function hasDeleteItemsPermGS(session) {
  return hasSessionPermGS(session, 'items.delete');
}

function hasCategoriesManagePermGS(session) {
  if (!session) return false;
  if (session.role === 'designer' || session.role === 'owner' || Boolean(session.isOwner)) return true;
  return Array.isArray(session.permissions) && (session.permissions.indexOf('categories.manage') !== -1 || session.permissions.indexOf('*') !== -1);
}

function isCategoryActiveForImportGS(cat) {
  if (!cat) return false;
  var st = String(cat.status || 'نشط').trim().toLowerCase();
  return st !== 'موقوف' && st !== 'inactive';
}

function resolveSingleColumnImportCategoryGS(rawCategoryInput, rawLegacySubCategoryInput, categoriesList, canManageCategories) {
  var rawMain = String(rawCategoryInput === null || rawCategoryInput === undefined ? '' : rawCategoryInput).trim().replace(/\s+/g, ' ');
  var rawLegacySub = String(rawLegacySubCategoryInput === null || rawLegacySubCategoryInput === undefined ? '' : rawLegacySubCategoryInput).trim().replace(/\s+/g, ' ');

  if (!rawMain) {
    return { ok: false, error: 'خانة "التصنيف" الإلزامية فارغة' };
  }

  var activeRoots = [];
  var activeRootsById = {};
  var activeCategories = [];
  for (var i = 0; i < categoriesList.length; i++) {
    var cat = categoriesList[i];
    if (!isCategoryActiveForImportGS(cat)) continue;
    activeCategories.push(cat);
    if (!cat.parentCategoryId) {
      activeRoots.push(cat);
      activeRootsById[cat.id] = cat;
    }
  }
  var activeSubs = [];
  for (var j = 0; j < activeCategories.length; j++) {
    var sc = activeCategories[j];
    if (sc.parentCategoryId && activeRootsById[sc.parentCategoryId]) {
      activeSubs.push(sc);
    }
  }

  var explicitRootRaw = '';
  var explicitSubRaw = '';
  if (rawLegacySub) {
    explicitRootRaw = rawMain;
    explicitSubRaw = rawLegacySub;
  } else if (rawMain.indexOf('/') !== -1) {
    var slashIdx = rawMain.indexOf('/');
    explicitRootRaw = rawMain.slice(0, slashIdx).trim().replace(/\s+/g, ' ');
    explicitSubRaw = rawMain.slice(slashIdx + 1).trim().replace(/\s+/g, ' ');
  }

  // (أ) لو النص بصيغة «رئيسي / فرعي» أو جاء من ملف قديم فيه عمود التصنيف الفرعي
  if (explicitRootRaw && explicitSubRaw) {
    var normRoot = normalizeItemName(explicitRootRaw);
    var normSub = normalizeItemName(explicitSubRaw);
    var rootCat = null;
    for (var rIdx = 0; rIdx < activeRoots.length; rIdx++) {
      if (normalizeItemName(activeRoots[rIdx].name) === normRoot) {
        rootCat = activeRoots[rIdx];
        break;
      }
    }
    if (!rootCat) {
      return {
        ok: false,
        error: 'التصنيف الفرعي ' + explicitSubRaw + ' غير موجود تحت ' + explicitRootRaw
      };
    }
    var subCat = null;
    for (var sIdx = 0; sIdx < activeSubs.length; sIdx++) {
      if (activeSubs[sIdx].parentCategoryId === rootCat.id && normalizeItemName(activeSubs[sIdx].name) === normSub) {
        subCat = activeSubs[sIdx];
        break;
      }
    }
    if (!subCat) {
      return {
        ok: false,
        error: 'التصنيف الفرعي ' + explicitSubRaw + ' غير موجود تحت ' + rootCat.name
      };
    }
    return {
      ok: true,
      categoryId: subCat.id,
      categoryName: rootCat.name + ' / ' + subCat.name,
      isNewRootCategory: false
    };
  }

  var singleName = explicitRootRaw || rawMain;
  var normSingle = normalizeItemName(singleName);
  if (!normSingle) {
    return { ok: false, error: 'خانة "التصنيف" الإلزامية فارغة' };
  }

  // (ب) يطابق تصنيف رئيسي نشط (الرئيسي يكسب لو نفس الاسم في رئيسي وفرعي)
  for (var mr = 0; mr < activeRoots.length; mr++) {
    if (normalizeItemName(activeRoots[mr].name) === normSingle) {
      return {
        ok: true,
        categoryId: activeRoots[mr].id,
        categoryName: activeRoots[mr].name,
        isNewRootCategory: false
      };
    }
  }

  // (ج) و (د) فحص التصنيفات الفرعية النشطة
  var matchedSubs = [];
  for (var ms = 0; ms < activeSubs.length; ms++) {
    if (normalizeItemName(activeSubs[ms].name) === normSingle) {
      matchedSubs.push(activeSubs[ms]);
    }
  }
  if (matchedSubs.length === 1) {
    var singleSub = matchedSubs[0];
    var parentCat = activeRootsById[singleSub.parentCategoryId];
    return {
      ok: true,
      categoryId: singleSub.id,
      categoryName: parentCat ? (parentCat.name + ' / ' + singleSub.name) : singleSub.name,
      isNewRootCategory: false
    };
  }
  if (matchedSubs.length > 1) {
    return {
      ok: false,
      error: 'التصنيف ' + singleName + ' موجود تحت أكتر من تصنيف رئيسي. اكتبه بالشكل: الرئيسي / الفرعي'
    };
  }

  // (هـ) مش موجود خالص <- تصنيف رئيسي جديد بالاسم المكتوب (مع فحص صلاحية categories.manage)
  if (!canManageCategories) {
    return {
      ok: false,
      error: 'التصنيف ' + singleName + ' غير موجود، وليس لديك صلاحية إضافة تصنيفات'
    };
  }

  return {
    ok: true,
    categoryId: '',
    categoryName: singleName,
    isNewRootCategory: true,
    newRootCategoryName: singleName,
    newRootNormName: normSingle
  };
}

function validateBulkEditAccessGS(operationType, session) {
  if (!hasBulkEditExcelPermGS(session)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لحق الوصول أو صلاحية [products.bulk_edit_excel]'
    };
  }
  if (!operationType || !BULK_EDIT_OP_LABELS_GS[operationType]) {
    return {
      ok: false,
      statusCode: 400,
      error: 'نوع العملية غير صالح.'
    };
  }
  if (operationType === 'purchase_price' && !hasPurchasePricePermGS(session)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية عرض وتعديل سعر الشراء [prices.view_purchase]'
    };
  }
  if (operationType === 'packaging_cost' && !hasPackagingCostPermGS(session)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية عرض وتعديل تكلفة التغليف [prices.view_packaging]'
    };
  }
  if (operationType === 'add_items' && !hasCreateItemsPermGS(session)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية إضافة الأصناف [items.create]'
    };
  }
  if (operationType === 'delete_items' && !hasDeleteItemsPermGS(session)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية حذف الأصناف [items.delete]'
    };
  }
  return { ok: true, opType: operationType };
}

function isCellEmptyGS(val) {
  return val === null || val === undefined || String(val).trim() === '';
}

function isScientificNotationBarcodeGS(raw) {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'number') {
    if (!isFinite(raw)) return false;
    if (Math.abs(raw) >= 1e11 || String(raw).indexOf('e') !== -1 || String(raw).indexOf('E') !== -1) {
      return true;
    }
    return false;
  }
  var str = String(raw)
    .replace(/[\u0660-\u0669]/g, function(d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function(d) { return String(d.charCodeAt(0) - 0x06F0); })
    .replace(/٫/g, '.')
    .trim();
  return /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(str);
}

function normalizeBulkNumericStringGS(raw) {
  return String(raw === null || raw === undefined ? '' : raw)
    .replace(/[\u0660-\u0669]/g, function(d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function(d) { return String(d.charCodeAt(0) - 0x06F0); })
    .replace(/٫/g, '.')
    .replace(/,/g, '')
    .trim();
}

function parseNonNegativeNumberGS(raw, fieldLabel, decimals, maxValue, allowNegative) {
  var dec = decimals !== undefined ? decimals : 2;
  if (raw === null || raw === undefined) {
    return { valid: false, reason: fieldLabel + ' مطلوب' };
  }
  if (typeof raw === 'boolean') {
    return { valid: false, reason: 'قيمة ' + fieldLabel + ' غير صالحة' };
  }

  var num;
  if (typeof raw === 'number') {
    if (!isFinite(raw)) {
      return { valid: false, reason: 'قيمة ' + fieldLabel + ' غير صالحة' };
    }
    num = raw;
  } else {
    var str = normalizeBulkNumericStringGS(raw);
    if (!str) {
      return { valid: false, reason: fieldLabel + ' مطلوب' };
    }
    if (!/^-?\d+(\.\d+)?$/.test(str)) {
      return { valid: false, reason: fieldLabel + ' يجب أن يكون رقماً صالحاً' };
    }
    num = Number(str);
    if (!isFinite(num)) {
      return { valid: false, reason: 'قيمة ' + fieldLabel + ' غير صالحة' };
    }
  }

  if (!allowNegative && num < 0) {
    return { valid: false, reason: fieldLabel + ' لا يمكن أن تكون سالبة' };
  }
  if (maxValue !== undefined && num > maxValue) {
    return { valid: false, reason: fieldLabel + ' يجب أن يكون بين 0 و ' + maxValue };
  }

  var factor = Math.pow(10, dec);
  return { valid: true, value: Math.round(num * factor) / factor };
}

function parseArabicBooleanCellGS(raw) {
  if (typeof raw === 'boolean') {
    return { valid: true, value: raw };
  }
  if (typeof raw === 'number') {
    if (raw === 1) return { valid: true, value: true };
    if (raw === 0) return { valid: true, value: false };
    return { valid: false, reason: 'قيمة تفعيل BNPL يجب أن تكون "نعم" أو "لا"' };
  }
  var str = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!str) {
    return { valid: false, reason: 'قيمة تفعيل BNPL مطلوبة (نعم أو لا)' };
  }
  var norm = normalizeArabicTextGS(str.toLowerCase());
  if (['نعم', 'مفعل', 'تفعيل', 'true', 'yes', 'y', '1', 'on'].indexOf(norm) !== -1) {
    return { valid: true, value: true };
  }
  if (['لا', 'غير مفعل', 'معطل', 'تعطيل', 'false', 'no', 'n', '0', 'off'].indexOf(norm) !== -1) {
    return { valid: true, value: false };
  }
  return { valid: false, reason: 'قيمة تفعيل BNPL "' + str + '" غير صالحة (استخدم نعم أو لا)' };
}

function parseItemStatusCellGS(raw) {
  var str = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!str) {
    return { valid: false, reason: 'الحالة الجديدة مطلوبة (نشط / موقوف / مؤرشف)' };
  }
  var norm = normalizeArabicTextGS(str.toLowerCase());
  if (['نشط', 'فعال', 'متاح', 'active'].indexOf(norm) !== -1) {
    return { valid: true, value: 'نشط' };
  }
  if (['موقوف', 'متوقف', 'معطل', 'غير نشط', 'inactive'].indexOf(norm) !== -1) {
    return { valid: true, value: 'موقوف' };
  }
  if (['مؤرشف', 'ارشيف', 'archived'].indexOf(norm) !== -1) {
    return { valid: true, value: 'مؤرشف' };
  }
  return { valid: false, reason: 'الحالة "' + str + '" غير صالحة (القيم المسموحة: نشط، موقوف، مؤرشف)' };
}

function normalizeExistingItemStatusGS(status) {
  if (!status || status === 'active' || status === 'نشط') return 'نشط';
  if (status === 'inactive' || status === 'موقوف') return 'موقوف';
  if (status === 'مؤرشف') return 'مؤرشف';
  return String(status);
}

function isValidImageUrlCellGS(raw) {
  var trimmed = String(raw || '').trim();
  if (!trimmed) return false;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  if (trimmed.charAt(0) === '/') return true;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) return true;
  return false;
}

function formatBarcodeSkuDisplayGS(barcode, sku, secondaryBarcodes) {
  var parts = [];
  if (barcode) parts.push('باركود: ' + barcode);
  if (sku) parts.push('SKU: ' + sku);
  if (secondaryBarcodes && secondaryBarcodes.length > 0) {
    parts.push('فرعي: ' + secondaryBarcodes.join('، '));
  }
  return parts.length > 0 ? parts.join(' | ') : 'بدون أكواد';
}

function parsePlatformIdsRawGS(rawVal) {
  var platformIdsRaw = String(rawVal || '').trim();
  if (!platformIdsRaw) return [];
  try {
    if (platformIdsRaw.charAt(0) === '[') {
      var parsed = JSON.parse(platformIdsRaw);
      if (Array.isArray(parsed)) {
        return parsed.map(function(s) { return String(s || '').trim(); }).filter(Boolean);
      }
    }
  } catch (_) {}
  return platformIdsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

function formatConflictItemInfoGS(it) {
  var parts = [];
  if (it.sku && String(it.sku).trim()) parts.push(String(it.sku).trim());
  if (it.barcode && String(it.barcode).trim() && String(it.barcode).trim() !== String(it.sku || '').trim()) {
    parts.push(String(it.barcode).trim());
  }
  if (parts.length === 0 && it.id) parts.push(it.id);
  return '"' + it.name + '" (الكود: ' + parts.join(' / ') + ')';
}

function formatItemCategoryDisplayGS(item, categoryById) {
  if (!item.categoryId) {
    return (item.categoryName && String(item.categoryName).trim()) || 'غير مصنف';
  }
  var cat = categoryById[item.categoryId];
  if (!cat) {
    return (item.categoryName && String(item.categoryName).trim()) || 'غير مصنف';
  }
  if (cat.parentCategoryId) {
    var parent = categoryById[cat.parentCategoryId];
    return parent ? (parent.name + ' / ' + cat.name) : cat.name;
  }
  return cat.name;
}

function formatItemPlatformsDisplayGS(platformIds, platformById) {
  if (!Array.isArray(platformIds) || platformIds.length === 0) {
    return 'الكل';
  }
  var names = [];
  for (var i = 0; i < platformIds.length; i++) {
    var pid = platformIds[i];
    if (!pid) continue;
    var p = platformById[pid];
    names.push(p ? p.name : pid);
  }
  return names.length > 0 ? names.join('، ') : 'الكل';
}

function checkItemUniquenessIndexedGS(params, itemsList, byNormName, byNormSkuOrId, byNormBarcode) {
  var targetExcludeId = String(params.excludeId || params.itemId || params.id || '').trim();
  var conflicts = [];

  if (params.name !== undefined && params.name !== null) {
    var normName = normalizeItemName(params.name);
    if (normName.length > 0) {
      var nameMatches = byNormName[normName] || [];
      for (var i = 0; i < nameMatches.length; i++) {
        var other = nameMatches[i];
        if (targetExcludeId && other.id === targetExcludeId) continue;
        conflicts.push({
          field: 'name',
          message: 'اسم الصنف "' + String(params.name).trim() + '" مكرر مع صنف آخر: ' + formatConflictItemInfoGS(other)
        });
        break;
      }
    }
  }

  var rawSku = params.sku !== undefined ? params.sku : params.code;
  if (rawSku !== undefined && rawSku !== null) {
    var normSku = normalizeItemBarcode(rawSku);
    if (normSku.length > 0) {
      var normSkuKey = normSku.toLowerCase();
      var skuMatches = byNormSkuOrId[normSkuKey] || [];
      for (var s = 0; s < skuMatches.length; s++) {
        var otherSku = skuMatches[s];
        if (targetExcludeId && otherSku.id === targetExcludeId) continue;
        conflicts.push({
          field: 'sku',
          message: 'كود الصنف [' + normSku + '] مسجل بالفعل لصنف آخر: ' + formatConflictItemInfoGS(otherSku)
        });
        break;
      }
    }
  }

  var rawBarcodesList = [];
  if (params.barcode !== undefined && params.barcode !== null && String(params.barcode).trim() !== '') {
    rawBarcodesList.push(String(params.barcode));
  }
  if (Array.isArray(params.secondaryBarcodes)) {
    for (var sb = 0; sb < params.secondaryBarcodes.length; sb++) {
      var secVal = params.secondaryBarcodes[sb];
      if (secVal !== undefined && secVal !== null && String(secVal).trim() !== '') {
        rawBarcodesList.push(String(secVal));
      }
    }
  }

  var seenNormalizedBarcodes = {};
  for (var b = 0; b < rawBarcodesList.length; b++) {
    var rawBc = rawBarcodesList[b];
    var normBc = normalizeItemBarcode(rawBc);
    if (!normBc) continue;
    var normBcKey = normBc.toLowerCase();

    if (seenNormalizedBarcodes[normBcKey]) {
      conflicts.push({
        field: 'barcode',
        message: 'الباركود [' + normBc + '] مكرر أكثر من مرة داخل نفس الصنف'
      });
      continue;
    }
    seenNormalizedBarcodes[normBcKey] = true;

    var bcMatches = byNormBarcode[normBcKey] || [];
    for (var bm = 0; bm < bcMatches.length; bm++) {
      var otherBc = bcMatches[bm];
      if (targetExcludeId && otherBc.id === targetExcludeId) continue;
      conflicts.push({
        field: 'barcode',
        message: 'الباركود [' + normBc + '] مسجل بالفعل لصنف آخر: ' + formatConflictItemInfoGS(otherBc)
      });
      break;
    }
  }

  var firstConflict = conflicts.length > 0 ? conflicts[0] : null;
  return {
    isDuplicate: conflicts.length > 0,
    conflicts: conflicts,
    error: firstConflict ? firstConflict.message : undefined
  };
}

function splitCleanBarcodesListGS(rawVal) {
  if (isCellEmptyGS(rawVal)) return [];
  var parts = String(rawVal).split(/[,،\n]+/);
  var seen = {};
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var clean = normalizeItemBarcode(parts[i]);
    if (!clean) continue;
    var key = clean.toLowerCase();
    if (!seen[key]) {
      seen[key] = true;
      out.push(clean);
    }
  }
  return out;
}

function parseSheetHeaderRowSafeGS(sheet) {
  if (!sheet || sheet.getLastColumn() < 1) return { headers: [], map: {}, get: function() { return -1; } };
  return getHeaderMap(sheet);
}

function clearBulkEditUndoSheetGS(ss) {
  return withScriptLock(function() {
    var sUndo = ss.getSheetByName(SHEETS.BULK_EDIT_UNDO);
    if (!sUndo || sUndo.getLastRow() <= 1) return;
    var rowNums = [];
    var lastRow = sUndo.getLastRow();
    for (var r = 2; r <= lastRow; r++) {
      rowNums.push(r);
    }
    deleteRowsDescendingBatch(sUndo, rowNums);
  });
}

/**
 * الدالة الموحدة لمعاينة وتنفيذ التعديل / الإضافة / الحذف الجماعي بالإكسيل في Google Sheets
 * - قراءة جميع الأوراق المطلوبة مرة واحدة (getValues)
 * - الكتابة دفعة واحدة (setValues) والحذف من الأسفل للأعلى (deleteRowsDescendingBatch)
 * - حماية متزامنة عبر LockService أثناء التنفيذ
 */
function bulkEditItemsExcelGS(payload, session) {
  var opRaw = payload ? payload.operationType : '';
  var access = validateBulkEditAccessGS(opRaw, session);
  if (!access.ok) {
    return {
      success: false,
      statusCode: access.statusCode,
      updatedCount: 0,
      unchangedCount: 0,
      errorCount: 0,
      error: access.error
    };
  }

  var opType = access.opType;
  var dryRun = Boolean(payload && payload.dryRun);
  var inputRows = payload && Array.isArray(payload.rows) ? payload.rows : null;

  // التحقق من الأعمدة الأساسية السبعة عند إضافة أصناف إذا أُرسلت ترويسة الأعمدة
  if (opType === 'add_items' && payload && Array.isArray(payload.headers)) {
    var mandatoryAddSpecs = [
      { label: 'اسم الصنف', aliases: ['اسم الصنف', 'اسم المنتج', 'الاسم'] },
      { label: 'اسم الطباعة', aliases: ['اسم الطباعة', 'الاسم المطبوع', 'اسم الفاتورة'] },
      { label: 'الكمية', aliases: ['الكمية', 'الكمية بالمخزن', 'الرصيد الافتتاحي', 'الرصيد'] },
      { label: 'التصنيف', aliases: ['التصنيف', 'التصنيف الرئيسي'] },
      { label: 'الباركود الرئيسي', aliases: ['الباركود الرئيسي', 'الباركود الأساسي', 'الباركود'] },
      { label: 'سعر البيع', aliases: ['سعر البيع', 'السعر'] },
      { label: 'سعر الشراء', aliases: ['سعر الشراء'] }
    ];
    var normHeaderArr = [];
    for (var hi = 0; hi < payload.headers.length; hi++) {
      normHeaderArr.push(normalizeArabicTextGS(String(payload.headers[hi] || '').trim().replace(/\s+/g, ' ')));
    }
    var usedHeaderIdx = {};
    var missingAddCols = [];
    for (var mi = 0; mi < mandatoryAddSpecs.length; mi++) {
      var spec = mandatoryAddSpecs[mi];
      var foundSpecIdx = -1;
      for (var ai0 = 0; ai0 < spec.aliases.length && foundSpecIdx === -1; ai0++) {
        var normAlias = normalizeArabicTextGS(spec.aliases[ai0]);
        for (var hi2 = 0; hi2 < normHeaderArr.length; hi2++) {
          if (!usedHeaderIdx[hi2] && normHeaderArr[hi2] === normAlias) {
            foundSpecIdx = hi2;
            break;
          }
        }
      }
      if (foundSpecIdx === -1) {
        missingAddCols.push(spec.label);
      } else {
        usedHeaderIdx[foundSpecIdx] = true;
      }
    }
    if (missingAddCols.length > 0) {
      return {
        success: false,
        statusCode: 400,
        updatedCount: 0,
        unchangedCount: 0,
        errorCount: 0,
        error: 'الملف ناقص عمود: ' + missingAddCols.join('، ') + ' — نزّل النموذج الجديد'
      };
    }
  }

  if (!inputRows) {
    return {
      success: false,
      statusCode: 400,
      updatedCount: 0,
      unchangedCount: 0,
      errorCount: 0,
      error: 'يرجى رفع ملف الإكسيل (‎.xlsx‎ أو ‎.xls‎ أو ‎.csv‎) للمعاينة.'
    };
  }
  if (inputRows.length === 0) {
    return {
      success: false,
      statusCode: 400,
      updatedCount: 0,
      unchangedCount: 0,
      errorCount: 0,
      error: 'الملف لا يحتوي على أي صفوف بيانات.'
    };
  }
  if (inputRows.length > BULK_EDIT_EXCEL_MAX_ROWS_GS) {
    return {
      success: false,
      statusCode: 400,
      updatedCount: 0,
      unchangedCount: 0,
      errorCount: 0,
      error: 'تم تجاوز الحد الأقصى المسموح به (' + BULK_EDIT_EXCEL_MAX_ROWS_GS + ' صف كحد أقصى في الملف الواحد).'
    };
  }

  var executeBulkEditBody = function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();

    var targetWhBulk = null;
    if (opType === 'stock_quantity' || opType === 'reorder_limit' || opType === 'add_items') {
      var whResBulk = resolveWarehouseForOperationGS(
        ss,
        payload && payload.warehouseId ? payload.warehouseId : null,
        session,
        { requireActive: true, enforceUserAccess: true, allowFallbackWhenOmitted: true }
      );
      if (!whResBulk.ok) {
        return {
          success: false,
          statusCode: whResBulk.statusCode || 400,
          updatedCount: 0,
          unchangedCount: 0,
          errorCount: 0,
          error: whResBulk.error
        };
      }
      targetWhBulk = whResBulk.warehouse;
    }

    var sItems = dryRun
      ? ss.getSheetByName(SHEETS.ITEMS)
      : ensureSheetWithHeaders(ss, SHEETS.ITEMS, BULK_EDIT_ITEMS_HEADERS_GS);

    var hItems = parseSheetHeaderRowSafeGS(sItems);
    var colId = hItems.get('ID', 0);
    var colName = hItems.get('اسم الصنف', 1);
    var colImg = hItems.get('رابط الصورة', 2);
    var colSale = hItems.get('سعر البيع', 3);
    var colPurchase = hItems.get('سعر الشراء', 4);
    var colPackaging = hItems.get('تكلفة التغليف', 5);
    var colStock = hItems.get('الكمية بالمخزن', 6);
    var colNotes = hItems.get('ملاحظات', 7);
    var colCreated = hItems.get('تاريخ الإضافة', 8);
    var colStatus = hItems.get('حالة الصنف', 9);
    var colBarcode = hItems.get('الباركود الأساسي', 10);
    var colSupplier = hItems.get('المورد', 11);
    var colDefaultSupplier = hItems.get('المورد الافتراضي', -1);
    if (colSupplier === -1) colSupplier = colDefaultSupplier;
    var colTax = hItems.get('نسبة الضريبة', 12);
    var colMinPrice = hItems.get('الحد الأدنى لسعر البيع', 13);
    var colSku = hItems.get('كود SKU', -1);
    var colReorder = hItems.get('حد إعادة الطلب', -1);
    var colCategory = hItems.get('ID التصنيف', -1);
    if (colCategory === -1) colCategory = hItems.get('معرف التصنيف', -1);
    if (colCategory === -1) colCategory = hItems.get('categoryId', -1);
    var colBnplEnable = hItems.get('تفعيل BNPL', -1);
    var colBnplPercent = hItems.get('نسبة BNPL', -1);
    var colPlatformIds = hItems.get('معرفات المنصات المتاحة', -1);
    var colPickupFee = hItems.get('رسوم الالتقاط للقطعة', -1);
    var colUnit = hItems.get('وحدة القياس', -1);
    var colPrintName = hItems.get('اسم الطباعة', -1);

    var itemData = (sItems && sItems.getLastRow() > 0) ? sItems.getDataRange().getValues() : [];
    var colCount = hItems.headers.length > 0 ? hItems.headers.length : BULK_EDIT_ITEMS_HEADERS_GS.length;
    for (var padR = 0; padR < itemData.length; padR++) {
      while (itemData[padR].length < colCount) itemData[padR].push('');
    }

    // قراءة ItemBarcodes مرة واحدة
    var sBarcodes = dryRun
      ? ss.getSheetByName(SHEETS.ITEM_BARCODES)
      : ensureSheetWithHeaders(ss, SHEETS.ITEM_BARCODES, [
          'ID', 'ID الصنف', 'الباركود', 'نوع الباركود', 'الوصف أو المسمى', 'نشط', 'تاريخ الإنشاء'
        ]);
    var bRows = (sBarcodes && sBarcodes.getLastRow() > 1) ? sBarcodes.getDataRange().getValues() : [];
    var barcodesByItemId = {};
    var barcodeSheetRowsByItemId = {};
    for (var b = 1; b < bRows.length; b++) {
      var bRow = bRows[b];
      var bItemId = String(bRow[1] || '').trim();
      if (!bItemId) continue;
      if (!barcodeSheetRowsByItemId[bItemId]) barcodeSheetRowsByItemId[bItemId] = [];
      barcodeSheetRowsByItemId[bItemId].push(b + 1);

      var bActive = bRow[5] !== false && String(bRow[5]).toLowerCase() !== 'false';
      var bCode = String(bRow[2] || '').trim();
      var bType = String(bRow[3] || 'secondary').trim();
      if (bActive && bCode) {
        if (!barcodesByItemId[bItemId]) barcodesByItemId[bItemId] = [];
        barcodesByItemId[bItemId].push({
          id: String(bRow[0] || ''),
          itemId: bItemId,
          barcode: bCode,
          type: bType,
          label: String(bRow[4] || ''),
          active: true,
          createdAt: String(bRow[6] || '')
        });
      }
    }

    // قراءة التصنيفات مرة واحدة
    var sCats = ss.getSheetByName(SHEETS.PRODUCT_CATEGORIES);
    var categoriesList = [];
    var categoryById = {};
    var maxCatDisplayOrder = 0;
    if (sCats && sCats.getLastRow() > 1) {
      var cData = sCats.getDataRange().getValues();
      var ch = getHeaderMap(sCats);
      var cIdIdx = ch.get('ID', 0);
      var cNameIdx = ch.get('اسم التصنيف', 1);
      var cParentIdx = ch.get('ID التصنيف الأب', 2);
      var cStatusIdx = ch.get('الحالة', 3);
      var cOrderIdx = ch.get('ترتيب العرض', 5);
      for (var c = 1; c < cData.length; c++) {
        var cid = String(colVal(cData[c], cIdIdx, '')).trim();
        if (!cid) continue;
        var cOrd = Number(colVal(cData[c], cOrderIdx, 0)) || 0;
        if (cOrd > maxCatDisplayOrder) maxCatDisplayOrder = cOrd;
        var catObj = {
          id: cid,
          name: String(colVal(cData[c], cNameIdx, '')).trim(),
          parentCategoryId: String(colVal(cData[c], cParentIdx, '')).trim() || null,
          status: String(colVal(cData[c], cStatusIdx, 'نشط')).trim()
        };
        categoriesList.push(catObj);
        categoryById[cid] = catObj;
      }
    }

    // قراءة المنصات مرة واحدة
    var sPlts = ss.getSheetByName(SHEETS.PLATFORMS);
    var platformsList = [];
    var platformById = {};
    if (sPlts && sPlts.getLastRow() > 1) {
      var pData = sPlts.getDataRange().getValues();
      var ph = getHeaderMap(sPlts);
      var pIdIdx = ph.get('ID', 0);
      var pNameIdx = ph.get('اسم المنصة / العميل', -1);
      if (pNameIdx === -1) pNameIdx = ph.get('اسم المنصة', 1);
      for (var p = 1; p < pData.length; p++) {
        var pid = String(colVal(pData[p], pIdIdx, '')).trim();
        if (!pid) continue;
        var pObj = {
          id: pid,
          name: String(colVal(pData[p], pNameIdx, '')).trim()
        };
        platformsList.push(pObj);
        platformById[pid] = pObj;
      }
    }

    // فحص الارتباطات بالحركات والفواتير دفعة واحدة عند الحذف فقط
    var usedInInvoicesSet = {};
    var usedInReturnsSet = {};
    var usedInPurchasesSet = {};
    var usedInPurchaseReturnsSet = {};
    var usedInStockMovementsSet = {};
    var usedInDispatchOrdersSet = {};
    var nonZeroWhStockByItem = {};

    if (opType === 'delete_items') {
      var sInvLines = ss.getSheetByName(SHEETS.INVOICE_LINES);
      if (sInvLines && sInvLines.getLastRow() > 1) {
        var ilH = getHeaderMap(sInvLines);
        var ilCol = ilH.get('الصنف', 1);
        var ilData = sInvLines.getDataRange().getValues();
        for (var il = 1; il < ilData.length; il++) {
          var ilId = String(colVal(ilData[il], ilCol, '')).trim();
          if (ilId) usedInInvoicesSet[ilId] = true;
        }
      }

      var sRetLines = ss.getSheetByName(SHEETS.RETURN_LINES);
      if (sRetLines && sRetLines.getLastRow() > 1) {
        var rlH = getHeaderMap(sRetLines);
        var rlCol = rlH.get('ID الصنف', 3);
        var rlData = sRetLines.getDataRange().getValues();
        for (var rl = 1; rl < rlData.length; rl++) {
          var rlId = String(colVal(rlData[rl], rlCol, '')).trim();
          if (rlId) usedInReturnsSet[rlId] = true;
        }
      }

      var sPurLines = ss.getSheetByName(SHEETS.PURCHASE_LINES);
      if (sPurLines && sPurLines.getLastRow() > 1) {
        var plH = getHeaderMap(sPurLines);
        var plCol = plH.get('ID الصنف', 2);
        var plData = sPurLines.getDataRange().getValues();
        for (var pl = 1; pl < plData.length; pl++) {
          var plId = String(colVal(plData[pl], plCol, '')).trim();
          if (plId) usedInPurchasesSet[plId] = true;
        }
      }

      var sPurRetLines = ss.getSheetByName(SHEETS.PURCHASE_RETURN_LINES);
      if (sPurRetLines && sPurRetLines.getLastRow() > 1) {
        var prH = getHeaderMap(sPurRetLines);
        var prCol = prH.get('ID الصنف', 2);
        var prData = sPurRetLines.getDataRange().getValues();
        for (var pr = 1; pr < prData.length; pr++) {
          var prId = String(colVal(prData[pr], prCol, '')).trim();
          if (prId) usedInPurchaseReturnsSet[prId] = true;
        }
      }

      var sSm = ss.getSheetByName(SHEETS.STOCK_MOVEMENTS);
      if (sSm && sSm.getLastRow() > 1) {
        var smData = sSm.getDataRange().getValues();
        for (var sm = 1; sm < smData.length; sm++) {
          var smCol1 = String(smData[sm][1] || '');
          var isLegacySm = /^\d{4}-\d{2}-\d{2}T/.test(smCol1) && !smData[sm][9];
          var smItemId = isLegacySm ? String(smData[sm][2] || '').trim() : smCol1.trim();
          if (smItemId) usedInStockMovementsSet[smItemId] = true;
        }
      }

      var sDispLines = ss.getSheetByName(SHEETS.WAREHOUSE_DISPATCH_ORDER_LINES);
      if (sDispLines && sDispLines.getLastRow() > 1) {
        var dlData = sDispLines.getDataRange().getValues();
        for (var dl = 1; dl < dlData.length; dl++) {
          var dlItemId = String(dlData[dl][2] || '').trim();
          if (dlItemId) usedInDispatchOrdersSet[dlItemId] = true;
        }
      }

      var sWhStocksDel = ss.getSheetByName(SHEETS.WAREHOUSE_STOCKS);
      if (sWhStocksDel && sWhStocksDel.getLastRow() > 1) {
        var wsDelData = sWhStocksDel.getDataRange().getValues();
        for (var wsd = 1; wsd < wsDelData.length; wsd++) {
          var wsdItemId = String(wsDelData[wsd][0] || '').trim();
          var wsdQty = Number(wsDelData[wsd][2] || 0);
          if (wsdItemId && Math.abs(wsdQty) > 0.0001) {
            nonZeroWhStockByItem[wsdItemId] = true;
          }
        }
      }
    }

    // بناء فهارس الأصناف من itemData
    var itemsList = [];
    var itemEntryById = {};
    var byNormName = {};
    var byNormCode = {};
    var byNormSkuOrId = {};
    var byNormBarcode = {};

    function pushMapList(mapObj, key, val) {
      if (!key) return;
      if (!mapObj[key]) mapObj[key] = [];
      if (mapObj[key].indexOf(val) === -1) mapObj[key].push(val);
    }

    for (var i = 1; i < itemData.length; i++) {
      var r = itemData[i];
      var itemId = String(colVal(r, colId, '')).trim();
      if (!itemId) continue;

      var primaryBc = String(colVal(r, colBarcode, '')).trim();
      var normPrimaryBc = normalizeItemBarcode(primaryBc).toLowerCase();
      var skuVal = colSku !== -1 ? String(colVal(r, colSku, '')).trim() : '';
      var catIdVal = colCategory !== -1 ? String(colVal(r, colCategory, '')).trim() : '';
      var rawReorderVal = colReorder !== -1 ? colVal(r, colReorder, '') : '';
      var unitVal = colUnit !== -1 ? String(colVal(r, colUnit, '')).trim() : '';
      var bnplEnRaw = colBnplEnable !== -1 ? colVal(r, colBnplEnable, '') : '';
      var enableBnplVal = bnplEnRaw === true || String(bnplEnRaw).toLowerCase() === 'true' || String(bnplEnRaw).trim() === 'نعم';
      var rawPickup = colPickupFee !== -1 ? colVal(r, colPickupFee, '') : '';

      var rawBcEntries = barcodesByItemId[itemId] || [];
      var secList = [];
      var seenSec = {};
      for (var be = 0; be < rawBcEntries.length; be++) {
        var bEntry = rawBcEntries[be];
        var normEntryBc = normalizeItemBarcode(bEntry.barcode);
        if (!normEntryBc) continue;
        var normEntryKey = normEntryBc.toLowerCase();
        if (bEntry.type !== 'primary' && normEntryKey !== normPrimaryBc && !seenSec[normEntryKey]) {
          seenSec[normEntryKey] = true;
          secList.push(normEntryBc);
        }
      }

      var itemObj = {
        arrIndex: i,
        sheetRow: i + 1,
        id: itemId,
        name: String(colVal(r, colName, '')),
        printName: colPrintName !== -1 ? String(colVal(r, colPrintName, '')).trim().slice(0, 120) : '',
        imageUrl: String(colVal(r, colImg, '')),
        salePrice: Number(colVal(r, colSale, 0)) || 0,
        purchasePrice: Number(colVal(r, colPurchase, 0)) || 0,
        packagingCost: Number(colVal(r, colPackaging, 0)) || 0,
        stockQuantity: Number(colVal(r, colStock, 0)) || 0,
        notes: String(colVal(r, colNotes, '')),
        createdAt: String(colVal(r, colCreated, '')),
        status: String(colVal(r, colStatus, 'نشط')).trim(),
        barcode: primaryBc,
        secondaryBarcodes: secList,
        barcodes: rawBcEntries,
        supplier: String(colVal(r, colSupplier, '')).trim(),
        taxRate: Number(colVal(r, colTax, 0)) || 0,
        minPrice: Number(colVal(r, colMinPrice, 0)) || 0,
        sku: skuVal,
        reorderLimit: (colReorder !== -1 && rawReorderVal !== '' && rawReorderVal !== null && rawReorderVal !== undefined) ? (Number(rawReorderVal) || 0) : 0,
        categoryId: catIdVal,
        categoryName: catIdVal && categoryById[catIdVal] ? categoryById[catIdVal].name : '',
        enableBnpl: enableBnplVal,
        bnplPercentage: colBnplPercent !== -1 ? (Number(colVal(r, colBnplPercent, 0)) || 0) : 0,
        platformIds: colPlatformIds !== -1 ? parsePlatformIdsRawGS(colVal(r, colPlatformIds, '')) : [],
        pickupFee: (rawPickup !== '' && rawPickup !== null && rawPickup !== undefined && Number(rawPickup) > 0) ? Number(rawPickup) : 0,
        unit: unitVal || 'قطعة'
      };

      itemsList.push(itemObj);
      itemEntryById[itemId] = itemObj;

      var normN = normalizeItemName(itemObj.name);
      pushMapList(byNormName, normN, itemObj);

      var normSku = normalizeItemBarcode(skuVal).toLowerCase();
      var normIdKey = normalizeItemBarcode(itemId).toLowerCase();
      pushMapList(byNormCode, normSku, itemObj);
      pushMapList(byNormCode, normIdKey, itemObj);
      pushMapList(byNormSkuOrId, normSku, itemObj);
      pushMapList(byNormSkuOrId, normIdKey, itemObj);

      if (normPrimaryBc) {
        pushMapList(byNormCode, normPrimaryBc, itemObj);
        pushMapList(byNormBarcode, normPrimaryBc, itemObj);
      }
      for (var sc = 0; sc < secList.length; sc++) {
        var secKey = normalizeItemBarcode(secList[sc]).toLowerCase();
        pushMapList(byNormCode, secKey, itemObj);
        pushMapList(byNormBarcode, secKey, itemObj);
      }
      for (var ab = 0; ab < rawBcEntries.length; ab++) {
        var abKey = normalizeItemBarcode(rawBcEntries[ab].barcode).toLowerCase();
        pushMapList(byNormCode, abKey, itemObj);
        pushMapList(byNormBarcode, abKey, itemObj);
      }
    }

    var evaluated = [];
    var itemIdToRowNumbers = {};
    var fileNewNamesMap = {};
    var fileSkusMap = {};
    var fileBarcodesMap = {};
    var canManageCategoriesAdd = hasCategoriesManagePermGS(session);
    var pendingNewRootNamesByNorm = {};

    for (var idx = 0; idx < inputRows.length; idx++) {
      var rawRow = inputRows[idx] || {};
      var rowNumber = Number(rawRow.rowNumber || (idx + 2));
      var inputName = String(rawRow.name === null || rawRow.name === undefined ? '' : rawRow.name).trim();
      var codeOrBarcode = String(rawRow.codeOrBarcode === null || rawRow.codeOrBarcode === undefined ? '' : rawRow.codeOrBarcode).trim();
      var values = (rawRow.values && typeof rawRow.values === 'object') ? rawRow.values : {};
      var reasons = [];
      var rowWarning = undefined;

      var normCode = normalizeItemBarcode(codeOrBarcode).toLowerCase();
      var normName = normalizeItemName(inputName);

      var matchedItem = null;
      var matchedBy = undefined;

      if (opType !== 'add_items') {
        if (normCode && opType !== 'delete_items' && opType !== 'primary_barcode' && opType !== 'add_secondary_barcode') {
          var codeMatches = byNormCode[normCode] || [];
          if (codeMatches.length === 0) {
            reasons.push('لم يتم العثور على صنف مطابق للكود/الباركود (' + codeOrBarcode + ')');
          } else if (codeMatches.length > 1) {
            reasons.push('الكود/الباركود (' + codeOrBarcode + ') يطابق أكثر من صنف في النظام');
          } else {
            matchedItem = codeMatches[0];
            matchedBy = 'code_barcode';
          }
        } else if (normName) {
          var nameMatches = byNormName[normName] || [];
          if (nameMatches.length === 0) {
            reasons.push('لم يتم العثور على صنف باسم "' + inputName + '" في المخزن');
          } else if (nameMatches.length > 1) {
            reasons.push('يوجد أكثر من صنف بنفس الاسم "' + inputName + '"؛ يرجى تحديد الكود/الباركود');
          } else {
            matchedItem = nameMatches[0];
            matchedBy = 'name';
          }
        } else {
          reasons.push(
            opType === 'name'
              ? 'الاسم الحالي أو الكود/الباركود مطلوب'
              : (opType === 'delete_items' || opType === 'primary_barcode' || opType === 'add_secondary_barcode' ? 'اسم الصنف مطلوب' : 'اسم الصنف أو الكود/الباركود مطلوب')
          );
        }

        if (matchedItem) {
          if (!itemIdToRowNumbers[matchedItem.id]) itemIdToRowNumbers[matchedItem.id] = [];
          itemIdToRowNumbers[matchedItem.id].push(rowNumber);
        }
      }

      var currentPrice = null;
      var newPrice = null;
      var currentValueDisplay = '—';
      var newValueDisplay = '—';
      var isUnchanged = false;
      var actionPayload = null;

      var primaryRawVal = values.primary !== undefined ? values.primary : rawRow.newPriceRaw;

      switch (opType) {
        case 'sale_price':
        case 'purchase_price':
        case 'pickup_fee':
        case 'min_price':
        case 'packaging_cost':
        case 'tax_rate':
        case 'reorder_limit': {
          var fieldLabelMap = {
            sale_price: 'سعر البيع الجديد',
            purchase_price: 'سعر الشراء الجديد',
            pickup_fee: 'رسوم الالتقاط',
            min_price: 'الحد الأدنى لسعر البيع',
            packaging_cost: 'تكلفة التغليف',
            tax_rate: 'نسبة الضريبة %',
            reorder_limit: 'الحد الأدنى للكمية'
          };
          var maxVal = opType === 'tax_rate' ? 100 : undefined;
          var parsedNum = parseNonNegativeNumberGS(primaryRawVal, fieldLabelMap[opType] || BULK_EDIT_OP_LABELS_GS[opType], 2, maxVal);
          var unitSuffix = opType === 'tax_rate' ? '%' : (opType === 'reorder_limit' ? '' : ' ج.م');

          if (matchedItem) {
            var curValRaw =
              opType === 'sale_price' ? (matchedItem.salePrice || 0) :
              opType === 'purchase_price' ? (matchedItem.purchasePrice || 0) :
              opType === 'pickup_fee' ? (matchedItem.pickupFee || 0) :
              opType === 'min_price' ? (matchedItem.minPrice || 0) :
              opType === 'packaging_cost' ? (matchedItem.packagingCost || 0) :
              opType === 'tax_rate' ? (matchedItem.taxRate || 0) :
              (targetWhBulk
                ? getItemWarehouseReorderLimitGS(ss, matchedItem.id, targetWhBulk.id, matchedItem.reorderLimit !== undefined ? matchedItem.reorderLimit : 5)
                : (matchedItem.reorderLimit !== undefined ? matchedItem.reorderLimit : 5));
            currentPrice = Math.round(Number(curValRaw) * 100) / 100;
            currentValueDisplay = currentPrice + unitSuffix;
          }

          if (!parsedNum.valid) {
            reasons.push(parsedNum.reason);
          } else {
            newPrice = parsedNum.value;
            newValueDisplay = newPrice + unitSuffix;

            if (opType === 'min_price' && matchedItem && newPrice > 0) {
              var saleP = Math.round(Number(matchedItem.salePrice || 0) * 100) / 100;
              if (newPrice > saleP) {
                reasons.push('الحد الأدنى للسعر (' + newPrice + ') لا يجوز أن يتجاوز سعر البيع الحالي (' + saleP + ')');
              }
            }

            if (currentPrice !== null && newPrice === currentPrice) {
              isUnchanged = true;
            } else if (reasons.length === 0) {
              actionPayload = { kind: 'number_field', newValue: newPrice };
            }
          }
          break;
        }

        case 'stock_quantity': {
          var parsedQty = parseNonNegativeNumberGS(
            values.quantity !== undefined ? values.quantity : rawRow.newPriceRaw,
            'الكمية الجديدة',
            3
          );
          var reasonStr = String(values.reason === null || values.reason === undefined ? '' : values.reason).trim();

          if (matchedItem) {
            var oldQty = targetWhBulk
              ? getItemWarehouseStockGS(ss, matchedItem.id, targetWhBulk.id)
              : (Math.round(Number(matchedItem.stockQuantity || 0) * 1000) / 1000);
            currentPrice = oldQty;
            currentValueDisplay = String(oldQty);
          }

          if (!parsedQty.valid) {
            reasons.push(parsedQty.reason);
          } else {
            newPrice = parsedQty.value;
            if (currentPrice !== null) {
              var diff = Math.round((newPrice - currentPrice) * 1000) / 1000;
              var diffLabel = diff === 0 ? 'بدون فرق' : (diff > 0 ? ('+' + diff) : String(diff));
              newValueDisplay = newPrice + ' (' + diffLabel + ')';
              if (diff === 0) {
                isUnchanged = true;
              } else if (reasons.length === 0) {
                actionPayload = {
                  kind: 'stock_quantity',
                  newQuantity: newPrice,
                  reason: reasonStr || undefined
                };
              }
            } else {
              newValueDisplay = String(newPrice);
            }
          }
          break;
        }

        case 'name': {
          var rawNewName = String(values.newName === null || values.newName === undefined ? '' : values.newName).trim().replace(/\s+/g, ' ');
          var normNewName = normalizeItemName(rawNewName);

          if (matchedItem) {
            currentValueDisplay = matchedItem.name;
          }
          if (!normNewName) {
            reasons.push('الاسم الجديد مطلوب');
          } else {
            newValueDisplay = rawNewName;
            if (!fileNewNamesMap[normNewName]) fileNewNamesMap[normNewName] = [];
            fileNewNamesMap[normNewName].push(rowNumber);

            if (matchedItem) {
              if (normalizeItemName(matchedItem.name) === normNewName && String(matchedItem.name).trim() === rawNewName) {
                isUnchanged = true;
              } else {
                var uNameCheck = checkItemUniquenessIndexedGS(
                  { excludeId: matchedItem.id, name: rawNewName },
                  itemsList, byNormName, byNormSkuOrId, byNormBarcode
                );
                if (uNameCheck.isDuplicate) {
                  reasons.push(uNameCheck.error || ('الاسم الجديد "' + rawNewName + '" مستخدم لصنف آخر بالفعل'));
                } else if (reasons.length === 0) {
                  actionPayload = { kind: 'name', newName: rawNewName, normNewName: normNewName };
                }
              }
            }
          }
          break;
        }

        case 'print_name': {
          var rawPrintNameCell = values.printName !== undefined ? values.printName : primaryRawVal;
          var rawNewPrintName = String(rawPrintNameCell === null || rawPrintNameCell === undefined ? '' : rawPrintNameCell).trim().replace(/\s+/g, ' ');
          if (matchedItem) {
            currentValueDisplay = (matchedItem.printName && String(matchedItem.printName).trim()) || 'فارغ';
          }
          if (rawNewPrintName.length > 120) {
            reasons.push('اسم الطباعة لا يتجاوز 120 حرف');
          }
          newValueDisplay = rawNewPrintName || 'فارغ';
          if (matchedItem) {
            if (String(matchedItem.printName || '').trim() === rawNewPrintName) {
              isUnchanged = true;
            } else if (reasons.length === 0) {
              actionPayload = { kind: 'print_name', printName: rawNewPrintName };
            }
          }
          break;
        }

        case 'primary_barcode': {
          var rawPrimaryBcCell = values.barcode !== undefined ? values.barcode : primaryRawVal;
          if (matchedItem) {
            currentValueDisplay = (matchedItem.barcode && String(matchedItem.barcode).trim()) || 'بدون باركود';
          }
          if (isCellEmptyGS(rawPrimaryBcCell)) {
            reasons.push('الباركود الجديد مطلوب ولا يمكن أن يكون فارغاً');
            break;
          }
          if (isScientificNotationBarcodeGS(rawPrimaryBcCell)) {
            reasons.push('نسّق عمود الباركود كنص في الإكسيل (تم اكتشاف صيغة علمية مثل 6.22E+12)');
            newValueDisplay = String(rawPrimaryBcCell);
            break;
          }
          var nextPrimaryBc = normalizeItemBarcode(String(rawPrimaryBcCell));
          if (!nextPrimaryBc) {
            reasons.push('الباركود الجديد غير صالح');
            break;
          }
          newValueDisplay = nextPrimaryBc;

          var pBcKey = nextPrimaryBc.toLowerCase();
          if (!fileBarcodesMap[pBcKey]) fileBarcodesMap[pBcKey] = [];
          fileBarcodesMap[pBcKey].push({ rowNumber: rowNumber, itemId: matchedItem ? matchedItem.id : undefined });

          if (matchedItem) {
            var oldPrimaryBc = normalizeItemBarcode(matchedItem.barcode || '');
            var existingSecP = [];
            if (Array.isArray(matchedItem.secondaryBarcodes)) {
              for (var esp = 0; esp < matchedItem.secondaryBarcodes.length; esp++) {
                var spClean = normalizeItemBarcode(matchedItem.secondaryBarcodes[esp]);
                if (spClean) existingSecP.push(spClean);
              }
            }
            if (oldPrimaryBc.toLowerCase() === pBcKey) {
              isUnchanged = true;
            } else {
              var inOwnSec = false;
              for (var ios = 0; ios < existingSecP.length; ios++) {
                if (existingSecP[ios].toLowerCase() === pBcKey) {
                  inOwnSec = true;
                  break;
                }
              }
              if (inOwnSec) {
                reasons.push('الباركود [' + nextPrimaryBc + '] مسجل بالفعل كباركود فرعي لنفس الصنف "' + matchedItem.name + '"');
              } else {
                var uPrimCheck = checkItemUniquenessIndexedGS(
                  {
                    excludeId: matchedItem.id,
                    barcode: nextPrimaryBc,
                    secondaryBarcodes: existingSecP,
                    sku: matchedItem.sku
                  },
                  itemsList, byNormName, byNormSkuOrId, byNormBarcode
                );
                if (uPrimCheck.isDuplicate) {
                  reasons.push(uPrimCheck.error || ('الباركود [' + nextPrimaryBc + '] مسجل بالفعل لصنف آخر'));
                } else if (reasons.length === 0) {
                  actionPayload = {
                    kind: 'barcode_sku',
                    barcode: nextPrimaryBc,
                    sku: normalizeItemBarcode(matchedItem.sku || ''),
                    secondaryBarcodes: existingSecP
                  };
                }
              }
            }
          }
          break;
        }

        case 'add_secondary_barcode': {
          var rawAddedSecCell = values.secondaryBarcodes !== undefined ? values.secondaryBarcodes : primaryRawVal;
          if (matchedItem) {
            currentValueDisplay = (matchedItem.secondaryBarcodes && matchedItem.secondaryBarcodes.length > 0)
              ? matchedItem.secondaryBarcodes.join('، ')
              : 'بدون باركود فرعي';
          }
          if (isCellEmptyGS(rawAddedSecCell)) {
            reasons.push('الباركود المضاف مطلوب ولا يمكن أن يكون فارغاً');
            break;
          }
          if (isScientificNotationBarcodeGS(rawAddedSecCell)) {
            reasons.push('نسّق عمود الباركود كنص في الإكسيل (تم اكتشاف صيغة علمية مثل 6.22E+12)');
            newValueDisplay = String(rawAddedSecCell);
            break;
          }
          var addedSecBc = normalizeItemBarcode(String(rawAddedSecCell));
          if (!addedSecBc) {
            reasons.push('الباركود المضاف غير صالح');
            break;
          }

          var sBcKey = addedSecBc.toLowerCase();
          if (!fileBarcodesMap[sBcKey]) fileBarcodesMap[sBcKey] = [];
          fileBarcodesMap[sBcKey].push({ rowNumber: rowNumber, itemId: matchedItem ? matchedItem.id : undefined });

          if (matchedItem) {
            var oldPrimForSec = normalizeItemBarcode(matchedItem.barcode || '');
            var existingSecList = [];
            if (Array.isArray(matchedItem.secondaryBarcodes)) {
              for (var esl = 0; esl < matchedItem.secondaryBarcodes.length; esl++) {
                var scClean = normalizeItemBarcode(matchedItem.secondaryBarcodes[esl]);
                if (scClean) existingSecList.push(scClean);
              }
            }

            var sameAsPrimary = oldPrimForSec && oldPrimForSec.toLowerCase() === sBcKey;
            var alreadyInSecondary = false;
            for (var ais = 0; ais < existingSecList.length; ais++) {
              if (existingSecList[ais].toLowerCase() === sBcKey) {
                alreadyInSecondary = true;
                break;
              }
            }

            if (sameAsPrimary) {
              reasons.push('الباركود [' + addedSecBc + '] مسجل بالفعل كباركود رئيسي لنفس الصنف "' + matchedItem.name + '"');
              newValueDisplay = addedSecBc;
            } else if (alreadyInSecondary) {
              reasons.push('الباركود [' + addedSecBc + '] مضاف مسبقاً ضمن الباركودات الفرعية للصنف "' + matchedItem.name + '"');
              newValueDisplay = addedSecBc;
            } else {
              var combinedSecondary = existingSecList.concat([addedSecBc]);
              newValueDisplay = combinedSecondary.join('، ');
              var uSecCheck = checkItemUniquenessIndexedGS(
                {
                  excludeId: matchedItem.id,
                  barcode: oldPrimForSec,
                  secondaryBarcodes: combinedSecondary,
                  sku: matchedItem.sku
                },
                itemsList, byNormName, byNormSkuOrId, byNormBarcode
              );
              if (uSecCheck.isDuplicate) {
                reasons.push(uSecCheck.error || ('الباركود [' + addedSecBc + '] مسجل بالفعل لصنف آخر'));
              } else if (reasons.length === 0) {
                actionPayload = {
                  kind: 'barcode_sku',
                  barcode: oldPrimForSec,
                  sku: normalizeItemBarcode(matchedItem.sku || ''),
                  secondaryBarcodes: combinedSecondary
                };
              }
            }
          } else {
            newValueDisplay = addedSecBc;
          }
          break;
        }

        case 'barcode_sku': {
          var hasBc = !isCellEmptyGS(values.barcode);
          var hasSku = !isCellEmptyGS(values.sku);
          var hasSec = !isCellEmptyGS(values.secondaryBarcodes);

          if (matchedItem) {
            currentValueDisplay = formatBarcodeSkuDisplayGS(
              matchedItem.barcode,
              matchedItem.sku,
              matchedItem.secondaryBarcodes
            );
          }

          if (!hasBc && !hasSku && !hasSec) {
            reasons.push('يرجى إدخال قيمة واحدة على الأقل (الباركود الأساسي أو كود SKU أو باركودات فرعية)');
            break;
          }

          if ((hasBc && isScientificNotationBarcodeGS(values.barcode)) || (hasSec && isScientificNotationBarcodeGS(values.secondaryBarcodes))) {
            reasons.push('نسّق عمود الباركود كنص في الإكسيل (تم اكتشاف صيغة علمية مثل 6.22E+12)');
            break;
          }

          var nextBarcode = hasBc
            ? normalizeItemBarcode(String(values.barcode))
            : normalizeItemBarcode(matchedItem ? (matchedItem.barcode || '') : '');
          var nextSku = hasSku
            ? normalizeItemBarcode(String(values.sku))
            : normalizeItemBarcode(matchedItem ? (matchedItem.sku || '') : '');

          var nextSecondary = [];
          if (hasSec) {
            nextSecondary = splitCleanBarcodesListGS(values.secondaryBarcodes);
          } else if (matchedItem && Array.isArray(matchedItem.secondaryBarcodes)) {
            for (var sb0 = 0; sb0 < matchedItem.secondaryBarcodes.length; sb0++) {
              var sClean = normalizeItemBarcode(matchedItem.secondaryBarcodes[sb0]);
              if (sClean && sClean.toLowerCase() !== nextBarcode.toLowerCase()) {
                nextSecondary.push(sClean);
              }
            }
          }

          newValueDisplay = formatBarcodeSkuDisplayGS(
            nextBarcode || undefined,
            nextSku || undefined,
            nextSecondary
          );

          if (nextSku) {
            var skuKey = nextSku.toLowerCase();
            if (!fileSkusMap[skuKey]) fileSkusMap[skuKey] = [];
            fileSkusMap[skuKey].push({ rowNumber: rowNumber, itemId: matchedItem ? matchedItem.id : undefined });
          }
          var allRowBarcodes = [];
          if (nextBarcode) allRowBarcodes.push(nextBarcode);
          for (var nb = 0; nb < nextSecondary.length; nb++) allRowBarcodes.push(nextSecondary[nb]);
          for (var arb = 0; arb < allRowBarcodes.length; arb++) {
            var bcKey = allRowBarcodes[arb].toLowerCase();
            if (!fileBarcodesMap[bcKey]) fileBarcodesMap[bcKey] = [];
            fileBarcodesMap[bcKey].push({ rowNumber: rowNumber, itemId: matchedItem ? matchedItem.id : undefined });
          }

          if (matchedItem) {
            var oldBc = normalizeItemBarcode(matchedItem.barcode || '');
            var oldSku = normalizeItemBarcode(matchedItem.sku || '');
            var oldSec = [];
            if (Array.isArray(matchedItem.secondaryBarcodes)) {
              for (var os = 0; os < matchedItem.secondaryBarcodes.length; os++) {
                var oClean = normalizeItemBarcode(matchedItem.secondaryBarcodes[os]);
                if (oClean) oldSec.push(oClean);
              }
            }
            var sameSec = oldSec.length === nextSecondary.length;
            if (sameSec) {
              for (var si = 0; si < oldSec.length; si++) {
                if (oldSec[si] !== nextSecondary[si]) {
                  sameSec = false;
                  break;
                }
              }
            }
            if (oldBc === nextBarcode && oldSku === nextSku && sameSec) {
              isUnchanged = true;
            } else {
              var uBcCheck = checkItemUniquenessIndexedGS(
                {
                  excludeId: matchedItem.id,
                  barcode: nextBarcode,
                  secondaryBarcodes: nextSecondary,
                  sku: nextSku
                },
                itemsList, byNormName, byNormSkuOrId, byNormBarcode
              );
              if (uBcCheck.isDuplicate) {
                reasons.push(uBcCheck.error || 'الباركود أو كود SKU مكرر مع صنف آخر');
              } else if (reasons.length === 0) {
                actionPayload = {
                  kind: 'barcode_sku',
                  barcode: nextBarcode,
                  sku: nextSku,
                  secondaryBarcodes: nextSecondary
                };
              }
            }
          }
          break;
        }

        case 'notes': {
          var nextNotes = String(values.notes === null || values.notes === undefined ? '' : values.notes).trim();
          if (matchedItem) {
            currentValueDisplay = (matchedItem.notes && String(matchedItem.notes).trim()) || 'بدون وصف';
          }
          if (!nextNotes) {
            reasons.push('الوصف الجديد مطلوب');
          } else {
            newValueDisplay = nextNotes;
            if (matchedItem && String(matchedItem.notes || '').trim() === nextNotes) {
              isUnchanged = true;
            } else if (reasons.length === 0) {
              actionPayload = { kind: 'notes', notes: nextNotes };
            }
          }
          break;
        }

        case 'category': {
          var rootName = String(values.rootCategory === null || values.rootCategory === undefined ? '' : values.rootCategory).trim().replace(/\s+/g, ' ');
          var subName = String(values.subCategory === null || values.subCategory === undefined ? '' : values.subCategory).trim().replace(/\s+/g, ' ');
          if (matchedItem) {
            currentValueDisplay = formatItemCategoryDisplayGS(matchedItem, categoryById);
          }

          if (!rootName) {
            reasons.push('التصنيف الرئيسي مطلوب');
            break;
          }

          var normRoot = normalizeArabicTextGS(rootName);
          var rootCat = null;
          for (var rc = 0; rc < categoriesList.length; rc++) {
            var candR = categoriesList[rc];
            if (!candR.parentCategoryId && normalizeArabicTextGS(candR.name.trim().replace(/\s+/g, ' ')) === normRoot) {
              rootCat = candR;
              break;
            }
          }
          if (!rootCat) {
            reasons.push('التصنيف الرئيسي "' + rootName + '" غير موجود في النظام (يُرفض ولا يُنشأ تلقائياً)');
            newValueDisplay = subName ? (rootName + ' / ' + subName) : rootName;
            break;
          }

          var targetCat = rootCat;
          var displayCat = rootCat.name;

          if (subName) {
            var normSub = normalizeArabicTextGS(subName);
            var subCat = null;
            for (var sc2 = 0; sc2 < categoriesList.length; sc2++) {
              var candS = categoriesList[sc2];
              if (candS.parentCategoryId === rootCat.id && normalizeArabicTextGS(candS.name.trim().replace(/\s+/g, ' ')) === normSub) {
                subCat = candS;
                break;
              }
            }
            if (!subCat) {
              reasons.push('التصنيف الفرعي "' + subName + '" غير موجود تحت "' + rootCat.name + '" (يُرفض ولا يُنشأ تلقائياً)');
              newValueDisplay = rootCat.name + ' / ' + subName;
              break;
            }
            targetCat = subCat;
            displayCat = rootCat.name + ' / ' + subCat.name;
          }

          newValueDisplay = displayCat;
          if (matchedItem && matchedItem.categoryId === targetCat.id) {
            isUnchanged = true;
          } else if (reasons.length === 0) {
            actionPayload = { kind: 'category', categoryId: targetCat.id, categoryName: displayCat };
          }
          break;
        }

        case 'platforms': {
          var rawPlts = String(values.platforms === null || values.platforms === undefined ? '' : values.platforms).trim();
          if (matchedItem) {
            currentValueDisplay = formatItemPlatformsDisplayGS(matchedItem.platformIds, platformById);
          }

          if (!rawPlts) {
            reasons.push('يرجى إدخال أسماء المنصات المرتبطة أو كتابة "الكل"');
            break;
          }

          var normWholePlt = normalizeArabicTextGS(rawPlts.toLowerCase());
          var newPlatformIds = [];

          if (['الكل', 'كل المنصات', 'all'].indexOf(normWholePlt) !== -1) {
            newPlatformIds = [];
            newValueDisplay = 'الكل';
          } else {
            var pltTokens = rawPlts.split(/[,،\n]+/).map(function(t) { return t.trim().replace(/\s+/g, ' '); }).filter(Boolean);
            if (pltTokens.length === 0) {
              reasons.push('يرجى إدخال أسماء المنصات المرتبطة أو كتابة "الكل"');
              break;
            }

            var matchedPltIds = [];
            var missingPltNames = [];
            for (var pt = 0; pt < pltTokens.length; pt++) {
              var token = pltTokens[pt];
              var normToken = normalizeArabicTextGS(token);
              var foundPlt = null;
              for (var pi = 0; pi < platformsList.length; pi++) {
                if (normalizeArabicTextGS(platformsList[pi].name.trim().replace(/\s+/g, ' ')) === normToken) {
                  foundPlt = platformsList[pi];
                  break;
                }
              }
              if (!foundPlt) {
                missingPltNames.push(token);
              } else if (matchedPltIds.indexOf(foundPlt.id) === -1) {
                matchedPltIds.push(foundPlt.id);
              }
            }

            if (missingPltNames.length > 0) {
              reasons.push('المنصات التالية غير موجودة في النظام: ' + missingPltNames.join('، '));
              newValueDisplay = rawPlts;
              break;
            }

            newPlatformIds = matchedPltIds;
            newValueDisplay = formatItemPlatformsDisplayGS(newPlatformIds, platformById);
          }

          if (matchedItem) {
            var oldSorted = (matchedItem.platformIds || []).slice().sort().join(',');
            var newSorted = newPlatformIds.slice().sort().join(',');
            if (oldSorted === newSorted) {
              isUnchanged = true;
            } else if (reasons.length === 0) {
              actionPayload = { kind: 'platforms', platformIds: newPlatformIds };
            }
          }
          break;
        }

        case 'bnpl': {
          if (matchedItem) {
            var curEn = Boolean(matchedItem.enableBnpl);
            var curPct = Math.round(Number(matchedItem.bnplPercentage || 0) * 100) / 100;
            currentValueDisplay = (curEn ? 'نعم' : 'لا') + ' (' + curPct + '%)';
          }

          var parsedEnable = parseArabicBooleanCellGS(values.enableBnpl);
          if (!parsedEnable.valid) {
            reasons.push(parsedEnable.reason);
          }

          var pctEmpty = isCellEmptyGS(values.bnplPercentage);
          var parsedPctValue = 0;

          if (pctEmpty) {
            if (parsedEnable.valid && parsedEnable.value) {
              reasons.push('نسبة BNPL % مطلوبة عند التفعيل (بين 0 و 100)');
            }
          } else {
            var parsedPct = parseNonNegativeNumberGS(values.bnplPercentage, 'نسبة BNPL %', 2, 100);
            if (!parsedPct.valid) {
              reasons.push(parsedPct.reason);
            } else {
              parsedPctValue = parsedPct.value;
            }
          }

          if (parsedEnable.valid) {
            newValueDisplay = (parsedEnable.value ? 'نعم' : 'لا') + ' (' + parsedPctValue + '%)';
            if (reasons.length === 0 && matchedItem) {
              var oldEn = Boolean(matchedItem.enableBnpl);
              var oldPct = Math.round(Number(matchedItem.bnplPercentage || 0) * 100) / 100;
              if (oldEn === parsedEnable.value && oldPct === parsedPctValue) {
                isUnchanged = true;
              } else {
                actionPayload = {
                  kind: 'bnpl',
                  enableBnpl: parsedEnable.value,
                  bnplPercentage: parsedPctValue
                };
              }
            }
          }
          break;
        }

        case 'supplier': {
          var nextSupplier = String(values.supplier === null || values.supplier === undefined ? '' : values.supplier).trim().replace(/\s+/g, ' ');
          if (matchedItem) {
            currentValueDisplay = (matchedItem.supplier && String(matchedItem.supplier).trim()) || 'بدون مورد';
          }
          if (!nextSupplier) {
            reasons.push('اسم المورد مطلوب');
          } else {
            newValueDisplay = nextSupplier;
            if (matchedItem && String(matchedItem.supplier || '').trim() === nextSupplier) {
              isUnchanged = true;
            } else if (reasons.length === 0) {
              actionPayload = { kind: 'supplier', supplier: nextSupplier };
            }
          }
          break;
        }

        case 'unit': {
          var nextUnit = String(values.unit === null || values.unit === undefined ? '' : values.unit).trim().replace(/\s+/g, ' ');
          if (matchedItem) {
            currentValueDisplay = (matchedItem.unit && String(matchedItem.unit).trim()) || 'قطعة';
          }
          if (!nextUnit) {
            reasons.push('وحدة القياس مطلوبة');
          } else {
            newValueDisplay = nextUnit;
            if (matchedItem && ((matchedItem.unit && String(matchedItem.unit).trim()) || 'قطعة') === nextUnit) {
              isUnchanged = true;
            } else if (reasons.length === 0) {
              actionPayload = { kind: 'unit', unit: nextUnit };
            }
          }
          break;
        }

        case 'status': {
          if (matchedItem) {
            currentValueDisplay = normalizeExistingItemStatusGS(matchedItem.status);
          }
          var parsedStatus = parseItemStatusCellGS(values.status);
          if (!parsedStatus.valid) {
            reasons.push(parsedStatus.reason);
          } else {
            newValueDisplay = parsedStatus.value;
            if (matchedItem && normalizeExistingItemStatusGS(matchedItem.status) === parsedStatus.value) {
              isUnchanged = true;
            } else if (reasons.length === 0) {
              actionPayload = { kind: 'status', status: parsedStatus.value };
            }
          }
          break;
        }

        case 'image_url': {
          var nextUrl = String(values.imageUrl === null || values.imageUrl === undefined ? '' : values.imageUrl).trim();
          if (matchedItem) {
            currentValueDisplay = (matchedItem.imageUrl && String(matchedItem.imageUrl).trim()) || 'بدون صورة';
          }
          if (!isValidImageUrlCellGS(nextUrl)) {
            reasons.push('رابط الصورة غير صالح (يجب أن يبدأ بـ http:// أو https:// أو / أو data:image/)');
          } else {
            newValueDisplay = nextUrl;
            if (matchedItem && String(matchedItem.imageUrl || '').trim() === nextUrl) {
              isUnchanged = true;
            } else if (reasons.length === 0) {
              actionPayload = { kind: 'image_url', imageUrl: nextUrl };
            }
          }
          break;
        }

        case 'add_items': {
          var cleanNameAdd = inputName.replace(/\s+/g, ' ');
          var cleanNormNameAdd = normalizeItemName(cleanNameAdd);
          currentValueDisplay = 'صنف جديد';

          // 1) فحص الخانات الأساسية السبعة (الإلزامية) مع ذكر رقم السطر واسم الخانة الفارغة
          var mandatoryCellChecks = [
            { label: 'اسم الصنف', val: inputName },
            { label: 'اسم الطباعة', val: values.printName },
            { label: 'الكمية', val: values.stockQuantity },
            { label: 'التصنيف', val: values.rootCategory },
            { label: 'الباركود الرئيسي', val: values.barcode },
            { label: 'سعر البيع', val: values.salePrice },
            { label: 'سعر الشراء', val: values.purchasePrice }
          ];
          for (var mc = 0; mc < mandatoryCellChecks.length; mc++) {
            var mField = mandatoryCellChecks[mc];
            if (isCellEmptyGS(mField.val)) {
              reasons.push('السطر ' + rowNumber + ': خانة "' + mField.label + '" الإلزامية فارغة');
            }
          }

          if (cleanNormNameAdd) {
            if (!fileNewNamesMap[cleanNormNameAdd]) fileNewNamesMap[cleanNormNameAdd] = [];
            fileNewNamesMap[cleanNormNameAdd].push(rowNumber);
          }

          // 2) فحص الصيغة العلمية وتطبيع الباركود الرئيسي
          var rawBarcodeValAdd = values.barcode;
          var cleanBarcodeAdd = '';
          if (!isCellEmptyGS(rawBarcodeValAdd)) {
            if (isScientificNotationBarcodeGS(rawBarcodeValAdd)) {
              reasons.push('نسّق عمود الباركود كنص في الإكسيل (تم اكتشاف صيغة علمية مثل 6.22E+12)');
            } else {
              cleanBarcodeAdd = normalizeItemBarcode(String(rawBarcodeValAdd));
              if (!cleanBarcodeAdd) {
                reasons.push('السطر ' + rowNumber + ': خانة "الباركود الرئيسي" الإلزامية فارغة');
              }
            }
          }

          var cleanSkuAdd = normalizeItemBarcode(String(values.sku === null || values.sku === undefined ? '' : values.sku));
          var cleanSecondaryAdd = [];
          if (!isCellEmptyGS(values.secondaryBarcodes)) {
            if (isScientificNotationBarcodeGS(values.secondaryBarcodes)) {
              reasons.push('نسّق عمود الباركود كنص في الإكسيل (تم اكتشاف صيغة علمية مثل 6.22E+12)');
            } else {
              cleanSecondaryAdd = splitCleanBarcodesListGS(values.secondaryBarcodes);
            }
          }

          if (cleanSkuAdd) {
            var addSkuK = cleanSkuAdd.toLowerCase();
            if (!fileSkusMap[addSkuK]) fileSkusMap[addSkuK] = [];
            fileSkusMap[addSkuK].push({ rowNumber: rowNumber });
          }
          var addAllBcs = [];
          if (cleanBarcodeAdd) addAllBcs.push(cleanBarcodeAdd);
          for (var asb = 0; asb < cleanSecondaryAdd.length; asb++) addAllBcs.push(cleanSecondaryAdd[asb]);
          for (var abc = 0; abc < addAllBcs.length; abc++) {
            var addBcK = addAllBcs[abc].toLowerCase();
            if (!fileBarcodesMap[addBcK]) fileBarcodesMap[addBcK] = [];
            fileBarcodesMap[addBcK].push({ rowNumber: rowNumber });
          }

          if (cleanNormNameAdd || cleanBarcodeAdd || cleanSkuAdd || cleanSecondaryAdd.length > 0) {
            var uniqAdd = checkItemUniquenessIndexedGS(
              {
                name: cleanNameAdd || undefined,
                barcode: cleanBarcodeAdd || undefined,
                secondaryBarcodes: cleanSecondaryAdd.length > 0 ? cleanSecondaryAdd : undefined,
                sku: cleanSkuAdd || undefined
              },
              itemsList, byNormName, byNormSkuOrId, byNormBarcode
            );
            if (uniqAdd.isDuplicate) {
              for (var uc = 0; uc < uniqAdd.conflicts.length; uc++) {
                reasons.push(uniqAdd.conflicts[uc].message);
              }
            }
          }

          // 3) سعر البيع وسعر الشراء (أرقام >= 0، وتنبيه عند سعر البيع < سعر الشراء دون رفض الصف)
          var salePriceValAdd = 0;
          var saleParsedAdd = !isCellEmptyGS(values.salePrice)
            ? parseNonNegativeNumberGS(values.salePrice, 'سعر البيع', 2)
            : null;
          if (saleParsedAdd) {
            if (!saleParsedAdd.valid) {
              reasons.push(saleParsedAdd.reason);
            } else {
              salePriceValAdd = saleParsedAdd.value;
            }
          }

          var purchasePriceValAdd = 0;
          var purParsedAdd = !isCellEmptyGS(values.purchasePrice)
            ? parseNonNegativeNumberGS(values.purchasePrice, 'سعر الشراء', 2)
            : null;
          if (purParsedAdd) {
            if (!purParsedAdd.valid) {
              reasons.push(purParsedAdd.reason);
            } else if (hasPurchasePricePermGS(session)) {
              purchasePriceValAdd = purParsedAdd.value;
            } else {
              purchasePriceValAdd = 0;
            }
          }

          if (
            hasPurchasePricePermGS(session) &&
            saleParsedAdd &&
            saleParsedAdd.valid &&
            purParsedAdd &&
            purParsedAdd.valid &&
            salePriceValAdd < purchasePriceValAdd
          ) {
            rowWarning = 'تنبيه: سعر البيع (' + salePriceValAdd + ') أقل من سعر الشراء (' + purchasePriceValAdd + ')';
          }

          var minPriceValAdd = undefined;
          if (!isCellEmptyGS(values.minPrice)) {
            var minParsedAdd = parseNonNegativeNumberGS(values.minPrice, 'الحد الأدنى لسعر البيع', 2);
            if (!minParsedAdd.valid) {
              reasons.push(minParsedAdd.reason);
            } else {
              if (minParsedAdd.value > 0 && saleParsedAdd && saleParsedAdd.valid && minParsedAdd.value > salePriceValAdd) {
                reasons.push('الحد الأدنى للسعر (' + minParsedAdd.value + ') لا يجوز أن يتجاوز سعر البيع (' + salePriceValAdd + ')');
              } else if (minParsedAdd.value > 0) {
                minPriceValAdd = minParsedAdd.value;
              }
            }
          }

          var packagingCostValAdd = 0;
          if (!isCellEmptyGS(values.packagingCost)) {
            var pkgParsedAdd = parseNonNegativeNumberGS(values.packagingCost, 'تكلفة التغليف', 2);
            if (!pkgParsedAdd.valid) {
              reasons.push(pkgParsedAdd.reason);
            } else if (hasPackagingCostPermGS(session)) {
              packagingCostValAdd = pkgParsedAdd.value;
            }
          }

          var taxRateValAdd = 0;
          if (!isCellEmptyGS(values.taxRate)) {
            var rawTaxAdd = typeof values.taxRate === 'string'
              ? String(values.taxRate).replace(/%/g, '').trim()
              : values.taxRate;
            var taxParsedAdd = parseNonNegativeNumberGS(rawTaxAdd, 'نسبة الضريبة', 2, 100);
            if (!taxParsedAdd.valid) reasons.push(taxParsedAdd.reason);
            else taxRateValAdd = taxParsedAdd.value;
          }

          var pickupFeeValAdd = undefined;
          if (!isCellEmptyGS(values.pickupFee)) {
            var pkParsedAdd = parseNonNegativeNumberGS(values.pickupFee, 'رسوم الالتقاط', 2);
            if (!pkParsedAdd.valid) reasons.push(pkParsedAdd.reason);
            else if (pkParsedAdd.value > 0) pickupFeeValAdd = pkParsedAdd.value;
          }

          var enableBnplValAdd = false;
          if (!isCellEmptyGS(values.enableBnpl)) {
            var enParsedAdd = parseArabicBooleanCellGS(values.enableBnpl);
            if (!enParsedAdd.valid) reasons.push(enParsedAdd.reason);
            else enableBnplValAdd = enParsedAdd.value;
          }

          var bnplPctValAdd = 0;
          if (!isCellEmptyGS(values.bnplPercentage)) {
            var pctParsedAdd = parseNonNegativeNumberGS(values.bnplPercentage, 'نسبة BNPL %', 2, 100);
            if (!pctParsedAdd.valid) reasons.push(pctParsedAdd.reason);
            else bnplPctValAdd = pctParsedAdd.value;
          }

          // 4) الكمية: رقم >= 0 (الصفر مقبول)
          var stockQtyValAdd = 0;
          if (!isCellEmptyGS(values.stockQuantity)) {
            var qtyParsedAdd = parseNonNegativeNumberGS(values.stockQuantity, 'الكمية', 3);
            if (!qtyParsedAdd.valid) reasons.push(qtyParsedAdd.reason);
            else stockQtyValAdd = qtyParsedAdd.value;
          }

          var reorderLimitValAdd = 5;
          if (!isCellEmptyGS(values.reorderLimit)) {
            var rlParsedAdd = parseNonNegativeNumberGS(values.reorderLimit, 'الحد الأدنى للكمية', 2);
            if (!rlParsedAdd.valid) reasons.push(rlParsedAdd.reason);
            else reorderLimitValAdd = rlParsedAdd.value;
          }

          // 5) التصنيف من العمود الواحد (مع دعم عمود «التصنيف الفرعي» للملفات القديمة)
          var addRootName = String(values.rootCategory === null || values.rootCategory === undefined ? '' : values.rootCategory).trim().replace(/\s+/g, ' ');
          var addSubName = String(values.subCategory === null || values.subCategory === undefined ? '' : values.subCategory).trim().replace(/\s+/g, ' ');
          var categoryIdValAdd = undefined;
          var categoryNameValAdd = undefined;
          var isNewRootCategoryValAdd = false;
          var newRootCategoryNameValAdd = undefined;
          var newRootNormNameValAdd = undefined;

          if (addRootName) {
            var catResAdd = resolveSingleColumnImportCategoryGS(
              addRootName,
              addSubName,
              categoriesList,
              canManageCategoriesAdd
            );
            if (!catResAdd.ok) {
              reasons.push(catResAdd.error);
            } else {
              categoryIdValAdd = catResAdd.categoryId || undefined;
              isNewRootCategoryValAdd = Boolean(catResAdd.isNewRootCategory);
              if (catResAdd.isNewRootCategory && catResAdd.newRootNormName && catResAdd.newRootCategoryName) {
                var firstWrittenCatName = pendingNewRootNamesByNorm[catResAdd.newRootNormName] || catResAdd.newRootCategoryName;
                pendingNewRootNamesByNorm[catResAdd.newRootNormName] = firstWrittenCatName;
                newRootCategoryNameValAdd = firstWrittenCatName;
                newRootNormNameValAdd = catResAdd.newRootNormName;
                categoryNameValAdd = firstWrittenCatName + ' (تصنيف جديد)';
              } else {
                categoryNameValAdd = catResAdd.categoryName;
              }
            }
          }

          var platformIdsValAdd = [];
          if (!isCellEmptyGS(values.platforms)) {
            var addRawPlts = String(values.platforms).trim();
            var addNormWhole = normalizeArabicTextGS(addRawPlts.toLowerCase());
            if (['الكل', 'كل المنصات', 'all'].indexOf(addNormWhole) === -1) {
              var addTokens = addRawPlts.split(/[,،\n]+/).map(function(t) { return t.trim().replace(/\s+/g, ' '); }).filter(Boolean);
              var addMissingPlts = [];
              for (var at = 0; at < addTokens.length; at++) {
                var aTok = addTokens[at];
                var aNormTok = normalizeArabicTextGS(aTok);
                var aPlt = null;
                for (var ap = 0; ap < platformsList.length; ap++) {
                  if (normalizeArabicTextGS(platformsList[ap].name.trim().replace(/\s+/g, ' ')) === aNormTok) {
                    aPlt = platformsList[ap];
                    break;
                  }
                }
                if (!aPlt) addMissingPlts.push(aTok);
                else if (platformIdsValAdd.indexOf(aPlt.id) === -1) platformIdsValAdd.push(aPlt.id);
              }
              if (addMissingPlts.length > 0) {
                reasons.push('المنصات التالية غير موجودة في النظام: ' + addMissingPlts.join('، '));
              }
            }
          }

          var statusValAdd = 'نشط';
          if (!isCellEmptyGS(values.status)) {
            var stParsedAdd = parseItemStatusCellGS(values.status);
            if (!stParsedAdd.valid) reasons.push(stParsedAdd.reason);
            else statusValAdd = stParsedAdd.value;
          }

          var imageUrlValAdd = '';
          if (!isCellEmptyGS(values.imageUrl)) {
            var addRawUrl = String(values.imageUrl).trim();
            if (!isValidImageUrlCellGS(addRawUrl)) {
              reasons.push('رابط الصورة غير صالح (يجب أن يبدأ بـ http:// أو https:// أو / أو data:image/)');
            } else {
              imageUrlValAdd = addRawUrl;
            }
          }

          var supplierValAdd = String(values.supplier === null || values.supplier === undefined ? '' : values.supplier).trim().replace(/\s+/g, ' ') || '';
          var unitValAdd = String(values.unit === null || values.unit === undefined ? '' : values.unit).trim().replace(/\s+/g, ' ') || 'قطعة';
          var notesValAdd = String(values.notes === null || values.notes === undefined ? '' : values.notes).trim();
          var printNameValAdd = String(values.printName === null || values.printName === undefined ? '' : values.printName).trim().replace(/\s+/g, ' ');
          if (printNameValAdd.length > 120) {
            reasons.push('السطر ' + rowNumber + ': اسم الطباعة لا يتجاوز 120 حرفاً');
          }

          codeOrBarcode = cleanBarcodeAdd || String(rawBarcodeValAdd === null || rawBarcodeValAdd === undefined ? '' : rawBarcodeValAdd).trim();
          newPrice = salePriceValAdd;
          newValueDisplay =
            'الباركود: ' + (cleanBarcodeAdd || '—') +
            ' | الكمية: ' + stockQtyValAdd +
            ' | بيع: ' + salePriceValAdd + ' ج.م' +
            (hasPurchasePricePermGS(session) ? (' | شراء: ' + purchasePriceValAdd + ' ج.م') : '') +
            (categoryNameValAdd ? (' | ' + categoryNameValAdd) : '');

          if (reasons.length === 0) {
            actionPayload = {
              kind: 'add_item',
              itemData: {
                name: cleanNameAdd,
                printName: printNameValAdd || '',
                sku: cleanSkuAdd || '',
                barcode: cleanBarcodeAdd || '',
                secondaryBarcodes: cleanSecondaryAdd,
                notes: notesValAdd,
                categoryId: categoryIdValAdd || '',
                categoryName: isNewRootCategoryValAdd ? (newRootCategoryNameValAdd || '') : (categoryNameValAdd || ''),
                isNewRootCategory: isNewRootCategoryValAdd,
                newRootCategoryName: newRootCategoryNameValAdd || '',
                newRootNormName: newRootNormNameValAdd || '',
                salePrice: salePriceValAdd,
                minPrice: minPriceValAdd || 0,
                purchasePrice: purchasePriceValAdd,
                packagingCost: packagingCostValAdd,
                taxRate: taxRateValAdd,
                pickupFee: pickupFeeValAdd,
                enableBnpl: enableBnplValAdd,
                bnplPercentage: bnplPctValAdd,
                stockQuantity: stockQtyValAdd,
                reorderLimit: reorderLimitValAdd,
                platformIds: platformIdsValAdd,
                supplier: supplierValAdd,
                unit: unitValAdd,
                status: statusValAdd,
                imageUrl: imageUrlValAdd
              }
            };
          }
          break;
        }

        case 'delete_items': {
          if (matchedItem) {
            currentValueDisplay = 'الرصيد: ' + matchedItem.stockQuantity + ' | السعر: ' + matchedItem.salePrice + ' ج.م';
            newValueDisplay = 'حذف نهائي';

            var txReasons = [];
            if (Number(matchedItem.stockQuantity || 0) > 0 || nonZeroWhStockByItem[matchedItem.id]) {
              txReasons.push('كمية بالمخزن (' + matchedItem.stockQuantity + ')');
            }
            if (usedInInvoicesSet[matchedItem.id]) {
              txReasons.push('فواتير بيع مسجلة');
            }
            if (usedInReturnsSet[matchedItem.id]) {
              txReasons.push('سجلات مرتجعات مبيعات');
            }
            if (usedInPurchasesSet[matchedItem.id]) {
              txReasons.push('فواتير شراء مسجلة');
            }
            if (usedInPurchaseReturnsSet[matchedItem.id]) {
              txReasons.push('سجلات مرتجعات شراء');
            }
            if (usedInStockMovementsSet[matchedItem.id]) {
              txReasons.push('حركات مخزون مسجلة');
            }
            if (usedInDispatchOrdersSet[matchedItem.id]) {
              txReasons.push('أوامر صرف مخزنية مسجلة');
            }

            if (txReasons.length > 0) {
              reasons.push('لا يمكن حذف "' + matchedItem.name + '" لوجود معاملات أو رصيد مرتبط به (' + txReasons.join('، ') + ')');
            } else if (reasons.length === 0) {
              actionPayload = { kind: 'delete_item' };
            }
          } else {
            newValueDisplay = 'حذف نهائي';
          }
          break;
        }
      }

      var rawValuesSnapshot = {
        'اسم الصنف': inputName
      };
      if (opType === 'add_items' && values && typeof values === 'object') {
        rawValuesSnapshot['اسم الطباعة'] = values.printName !== undefined && values.printName !== null ? values.printName : '';
        rawValuesSnapshot['الكمية'] = values.stockQuantity !== undefined && values.stockQuantity !== null ? values.stockQuantity : '';
        rawValuesSnapshot['التصنيف'] = values.rootCategory !== undefined && values.rootCategory !== null ? values.rootCategory : '';
        rawValuesSnapshot['الباركود الرئيسي'] = values.barcode !== undefined && values.barcode !== null ? values.barcode : '';
        rawValuesSnapshot['سعر البيع'] = values.salePrice !== undefined && values.salePrice !== null ? values.salePrice : '';
        rawValuesSnapshot['سعر الشراء'] = values.purchasePrice !== undefined && values.purchasePrice !== null ? values.purchasePrice : '';
        rawValuesSnapshot['وصف الصنف'] = values.notes !== undefined && values.notes !== null ? values.notes : '';
        rawValuesSnapshot['الوحدة'] = values.unit !== undefined && values.unit !== null ? values.unit : '';
        rawValuesSnapshot['الحد الأدنى للكمية'] = values.reorderLimit !== undefined && values.reorderLimit !== null ? values.reorderLimit : '';
        rawValuesSnapshot['المورد'] = values.supplier !== undefined && values.supplier !== null ? values.supplier : '';
        rawValuesSnapshot['نسبة الضريبة'] = values.taxRate !== undefined && values.taxRate !== null ? values.taxRate : '';
        if (values.subCategory !== undefined && values.subCategory !== null && String(values.subCategory).trim() !== '') {
          rawValuesSnapshot['التصنيف الفرعي'] = values.subCategory;
        }
      } else if (values && typeof values === 'object') {
        for (var rvKey in values) {
          if (Object.prototype.hasOwnProperty.call(values, rvKey)) {
            rawValuesSnapshot[rvKey] = values[rvKey];
          }
        }
      }

      evaluated.push({
        rowNumber: rowNumber,
        inputName: inputName,
        codeOrBarcode: codeOrBarcode,
        matchedItem: matchedItem,
        matchedBy: matchedBy,
        currentPrice: currentPrice,
        newPrice: newPrice,
        currentValueDisplay: currentValueDisplay,
        newValueDisplay: newValueDisplay,
        isUnchanged: isUnchanged,
        actionPayload: actionPayload,
        reasons: reasons,
        warning: rowWarning,
        rawValues: rawValuesSnapshot
      });
    }

    // اكتشاف التكرار داخل الملف نفسه
    var duplicateItemIds = {};
    for (var dupId in itemIdToRowNumbers) {
      if (itemIdToRowNumbers[dupId].length > 1) {
        duplicateItemIds[dupId] = true;
      }
    }

    var intraFileConflictReasons = {};
    function addIntraConflict(rNum, msg) {
      if (!intraFileConflictReasons[rNum]) intraFileConflictReasons[rNum] = [];
      if (intraFileConflictReasons[rNum].indexOf(msg) === -1) {
        intraFileConflictReasons[rNum].push(msg);
      }
    }

    if (opType === 'name' || opType === 'add_items') {
      for (var fnKey in fileNewNamesMap) {
        var fRowNums = fileNewNamesMap[fnKey];
        if (fRowNums.length > 1) {
          for (var fr = 0; fr < fRowNums.length; fr++) {
            addIntraConflict(fRowNums[fr], 'اسم الصنف مكرر داخل الملف (الصفوف: ' + fRowNums.join('، ') + ')');
          }
        }
      }
    }

    if (opType === 'barcode_sku' || opType === 'primary_barcode' || opType === 'add_secondary_barcode' || opType === 'add_items') {
      for (var fsKey in fileSkusMap) {
        var skuEntries = fileSkusMap[fsKey];
        var uniqSkuTargets = {};
        var uniqSkuCount = 0;
        var skuRowNums = [];
        for (var se = 0; se < skuEntries.length; se++) {
          var tKey = skuEntries[se].itemId || ('row-' + skuEntries[se].rowNumber);
          if (!uniqSkuTargets[tKey]) {
            uniqSkuTargets[tKey] = true;
            uniqSkuCount++;
          }
          skuRowNums.push(skuEntries[se].rowNumber);
        }
        if (uniqSkuCount > 1) {
          for (var se2 = 0; se2 < skuEntries.length; se2++) {
            addIntraConflict(
              skuEntries[se2].rowNumber,
              'كود SKU [' + fsKey + '] مكرر لأكثر من صنف داخل الملف (الصفوف: ' + skuRowNums.join('، ') + ')'
            );
          }
        }
      }

      for (var fbKey in fileBarcodesMap) {
        var bcEntries = fileBarcodesMap[fbKey];
        var uniqBcTargets = {};
        var uniqBcCount = 0;
        var bcRowNums = [];
        for (var bce = 0; bce < bcEntries.length; bce++) {
          var btKey = bcEntries[bce].itemId || ('row-' + bcEntries[bce].rowNumber);
          if (!uniqBcTargets[btKey]) {
            uniqBcTargets[btKey] = true;
            uniqBcCount++;
          }
          bcRowNums.push(bcEntries[bce].rowNumber);
        }
        if (uniqBcCount > 1) {
          for (var bce2 = 0; bce2 < bcEntries.length; bce2++) {
            addIntraConflict(
              bcEntries[bce2].rowNumber,
              'الباركود [' + fbKey + '] مكرر لأكثر من صنف داخل الملف (الصفوف: ' + bcRowNums.join('، ') + ')'
            );
          }
        }
      }
    }

    var finalRows = [];
    var publicRows = [];
    var willUpdateCount = 0;
    var unchangedCount = 0;
    var errorCount = 0;
    var warningCount = 0;

    for (var fi = 0; fi < evaluated.length; fi++) {
      var ev = evaluated[fi];
      var rowReasons = ev.reasons.slice();
      if (ev.matchedItem && duplicateItemIds[ev.matchedItem.id]) {
        var dupRows = itemIdToRowNumbers[ev.matchedItem.id] || [];
        rowReasons.unshift('الصنف مكرر داخل الملف (الصفوف: ' + dupRows.join('، ') + ') — تم رفض جميع صفوف هذا الصنف');
      }
      var intraList = intraFileConflictReasons[ev.rowNumber];
      if (intraList && intraList.length > 0) {
        for (var ilIdx = 0; ilIdx < intraList.length; ilIdx++) {
          rowReasons.push(intraList[ilIdx]);
        }
      }

      var rowStatus;
      if (rowReasons.length > 0 || (opType !== 'add_items' && !ev.matchedItem)) {
        rowStatus = 'error';
        errorCount++;
      } else if (ev.isUnchanged || !ev.actionPayload) {
        rowStatus = 'unchanged';
        unchangedCount++;
      } else {
        rowStatus = 'will_update';
        willUpdateCount++;
        if (ev.warning) {
          warningCount++;
        }
      }

      var pubRow = {
        rowNumber: ev.rowNumber,
        itemId: ev.matchedItem ? ev.matchedItem.id : undefined,
        itemName: (ev.matchedItem && ev.matchedItem.name) || ev.inputName || 'بدون اسم',
        inputName: ev.inputName,
        codeOrBarcode: ev.codeOrBarcode || undefined,
        matchedBy: ev.matchedBy,
        currentPrice: ev.currentPrice,
        newPrice: ev.newPrice,
        currentValueDisplay: ev.currentValueDisplay,
        newValueDisplay: ev.newValueDisplay,
        status: rowStatus,
        reason: rowReasons.length > 0 ? rowReasons.join(' • ') : undefined,
        warning: rowStatus === 'will_update' ? ev.warning : undefined,
        rawValues: ev.rawValues
      };
      publicRows.push(pubRow);
      finalRows.push({
        pub: pubRow,
        matchedItem: ev.matchedItem,
        actionPayload: rowStatus === 'will_update' ? ev.actionPayload : null
      });
    }

    var previewNewCatsByNorm = {};
    var previewNewCatsList = [];
    if (opType === 'add_items') {
      for (var pnc = 0; pnc < finalRows.length; pnc++) {
        var fPnc = finalRows[pnc];
        if (!fPnc.actionPayload || fPnc.actionPayload.kind !== 'add_item') continue;
        var pncD = fPnc.actionPayload.itemData;
        if (pncD.isNewRootCategory && pncD.newRootNormName && pncD.newRootCategoryName) {
          if (!previewNewCatsByNorm[pncD.newRootNormName]) {
            var pncStat = { name: pncD.newRootCategoryName, itemsCount: 1 };
            previewNewCatsByNorm[pncD.newRootNormName] = pncStat;
            previewNewCatsList.push(pncStat);
          } else {
            previewNewCatsByNorm[pncD.newRootNormName].itemsCount += 1;
          }
        }
      }
    }

    var summary = {
      totalRows: publicRows.length,
      willUpdateCount: willUpdateCount,
      unchangedCount: unchangedCount,
      errorCount: errorCount,
      warningCount: warningCount
    };
    if (previewNewCatsList.length > 0) {
      summary.newCategories = previewNewCatsList;
    }

    var fileName = String((payload && payload.fileName) || '');

    if (dryRun) {
      var dryRes = {
        success: true,
        statusCode: 200,
        operationType: opType,
        fileName: fileName,
        warehouseId: targetWhBulk ? targetWhBulk.id : undefined,
        warehouseName: targetWhBulk ? targetWhBulk.name : undefined,
        summary: summary,
        rows: publicRows
      };
      if (previewNewCatsList.length > 0) {
        dryRes.newCategories = previewNewCatsList;
      }
      return dryRes;
    }

    // ===== مرحلة التنفيذ الفعلي على Google Sheets =====
    if (willUpdateCount === 0) {
      return {
        success: false,
        statusCode: 400,
        operationType: opType,
        fileName: fileName,
        updatedCount: 0,
        unchangedCount: unchangedCount,
        errorCount: errorCount,
        summary: summary,
        rows: publicRows,
        error: errorCount > 0
          ? 'لم يتم تنفيذ أي صف لأن جميع الصفوف تحتوي على أخطاء أو بدون تغيير.'
          : 'لا توجد تغييرات فعلية لتنفيذها.'
      };
    }

    var customBatchId = String((payload && payload.batchId) || '').trim();
    var opLabel = BULK_EDIT_OP_LABELS_GS[opType];
    var now = new Date().toISOString();
    var batchSuffix = Date.now().toString().slice(-6);
    var batchPrefix = opType === 'add_items' ? 'BULK-ADD' : (opType === 'delete_items' ? 'BULK-DEL' : 'BULK-EDIT');
    var batchId = customBatchId || (batchPrefix + '-' + batchSuffix);
    var userName = (session && (session.name || session.phone)) || 'مستخدم النظام';
    var userId = (session && (session.userId || session.id)) || '';
    var displayFileName = fileName || 'غير مسمى';
    var updatedCount = 0;
    var undoAvailable = false;

    var execNewCatsList = [];

    if (opType === 'add_items') {
      var newCategorySheetRows = [];
      var createdCatsByNormAdd = {};
      var createdNewCatsStatsByNormAdd = {};
      var newItemSheetRows = [];
      var newBarcodeSheetRows = [];
      var newWarehouseStockRows = [];
      var newMovementSheetRows = [];
      var addWhId = targetWhBulk ? targetWhBulk.id : 'wh-main';
      var addWhName = targetWhBulk ? targetWhBulk.name : 'المخزن الرئيسي';

      for (var ai = 0; ai < finalRows.length; ai++) {
        var fAdd = finalRows[ai];
        if (!fAdd.actionPayload || fAdd.actionPayload.kind !== 'add_item') continue;
        var d = fAdd.actionPayload.itemData;
        var newId = generateUUID();

        if (d.isNewRootCategory && d.newRootNormName && d.newRootCategoryName) {
          var resolvedCatObj = createdCatsByNormAdd[d.newRootNormName] || null;
          if (!resolvedCatObj) {
            for (var eci = 0; eci < categoriesList.length; eci++) {
              var eCat = categoriesList[eci];
              if (!eCat.parentCategoryId && isCategoryActiveForImportGS(eCat) && normalizeItemName(eCat.name) === d.newRootNormName) {
                resolvedCatObj = eCat;
                break;
              }
            }
          }
          if (!resolvedCatObj) {
            maxCatDisplayOrder += 1;
            resolvedCatObj = {
              id: generateUUID(),
              name: d.newRootCategoryName,
              parentCategoryId: null,
              status: 'نشط'
            };
            categoriesList.push(resolvedCatObj);
            categoryById[resolvedCatObj.id] = resolvedCatObj;
            createdCatsByNormAdd[d.newRootNormName] = resolvedCatObj;
            newCategorySheetRows.push([
              resolvedCatObj.id,
              resolvedCatObj.name,
              '',
              'نشط',
              'TRUE',
              maxCatDisplayOrder,
              now,
              now
            ]);
            logAudit(
              session,
              'CATEGORY_CREATE',
              'ProductCategory',
              resolvedCatObj.id,
              'إنشاء تصنيف رئيسي جديد تلقائياً أثناء استيراد الإكسيل: ' + resolvedCatObj.name + ' (' + displayFileName + ')'
            );
          } else {
            createdCatsByNormAdd[d.newRootNormName] = resolvedCatObj;
          }

          d.categoryId = resolvedCatObj.id;
          d.categoryName = resolvedCatObj.name;

          if (!createdNewCatsStatsByNormAdd[d.newRootNormName]) {
            var newStatObj = {
              id: resolvedCatObj.id,
              name: resolvedCatObj.name,
              itemsCount: 1
            };
            createdNewCatsStatsByNormAdd[d.newRootNormName] = newStatObj;
            execNewCatsList.push(newStatObj);
          } else {
            createdNewCatsStatsByNormAdd[d.newRootNormName].itemsCount += 1;
          }
        }

        var addQtyRounded = Math.round(Number(d.stockQuantity || 0) * 1000) / 1000;
        var addRlVal = (d.reorderLimit !== undefined && d.reorderLimit !== null) ? Math.max(0, Math.round(Number(d.reorderLimit) * 100) / 100) : '';

        var newRow = new Array(colCount).fill('');
        function setNewCell(cIdx, val) {
          if (cIdx >= 0 && cIdx < newRow.length) newRow[cIdx] = val;
        }
        setNewCell(colId, newId);
        setNewCell(colName, d.name);
        setNewCell(colImg, d.imageUrl || '');
        setNewCell(colSale, d.salePrice);
        setNewCell(colPurchase, d.purchasePrice);
        setNewCell(colPackaging, d.packagingCost);
        setNewCell(colStock, addQtyRounded);
        setNewCell(colNotes, d.notes || '');
        setNewCell(colCreated, now);
        setNewCell(colStatus, d.status);
        setNewCell(colBarcode, d.barcode || '');
        setNewCell(colSupplier, d.supplier || '');
        if (colDefaultSupplier !== -1) setNewCell(colDefaultSupplier, d.supplier || '');
        setNewCell(colTax, d.taxRate);
        setNewCell(colMinPrice, d.minPrice || 0);
        setNewCell(colSku, d.sku || '');
        setNewCell(colReorder, d.reorderLimit);
        setNewCell(colCategory, d.categoryId || '');
        setNewCell(colBnplEnable, d.enableBnpl ? 'نعم' : 'لا');
        setNewCell(colBnplPercent, d.bnplPercentage);
        setNewCell(colPlatformIds, (d.platformIds && d.platformIds.length > 0) ? JSON.stringify(d.platformIds) : '');
        setNewCell(colPickupFee, (d.pickupFee && Number(d.pickupFee) > 0) ? Number(d.pickupFee) : '');
        setNewCell(colUnit, d.unit || 'قطعة');
        if (colPrintName !== -1) setNewCell(colPrintName, d.printName || '');

        newItemSheetRows.push(newRow);

        if (d.barcode) {
          newBarcodeSheetRows.push([generateUUID(), newId, d.barcode, 'primary', 'الباركود الأساسي', true, now]);
        }
        if (Array.isArray(d.secondaryBarcodes)) {
          for (var sbAdd = 0; sbAdd < d.secondaryBarcodes.length; sbAdd++) {
            newBarcodeSheetRows.push([
              generateUUID(),
              newId,
              d.secondaryBarcodes[sbAdd],
              'secondary',
              'باركود فرعي',
              true,
              now
            ]);
          }
        }

        newWarehouseStockRows.push([newId, addWhId, addQtyRounded, now, addRlVal]);

        newMovementSheetRows.push([
          generateUUID(),
          newId,
          d.name,
          'رصيد افتتاحي بالإكسيل',
          addQtyRounded,
          addQtyRounded,
          'رصيد افتتاحي بالإكسيل (' + addWhName + ')',
          'INIT-XLS-' + batchSuffix + '-' + (updatedCount + 1),
          userName,
          now,
          'رصيد افتتاحي عند إضافة الصنف بالإكسيل في مخزن (' + addWhName + ') — الملف: ' + displayFileName,
          addWhId
        ]);

        fAdd.pub.itemId = newId;
        updatedCount++;
      }

      var WRITE_CHUNK_SIZE = 500;
      if (newCategorySheetRows.length > 0) {
        var sCatsWrite = ensureSheetWithHeaders(ss, SHEETS.PRODUCT_CATEGORIES, [
          'ID', 'اسم التصنيف', 'ID التصنيف الأب', 'الحالة', 'الظهور في نقطة البيع', 'ترتيب العرض', 'تاريخ الإنشاء', 'تاريخ التعديل'
        ]);
        var baseStartCatRow = sCatsWrite.getLastRow() + 1;
        sCatsWrite.getRange(baseStartCatRow, 1, newCategorySheetRows.length, 8).setValues(newCategorySheetRows);
      }
      if (newItemSheetRows.length > 0) {
        var baseStartAddRow = sItems.getLastRow() + 1;
        for (var cStart = 0; cStart < newItemSheetRows.length; cStart += WRITE_CHUNK_SIZE) {
          var chunkRows = newItemSheetRows.slice(cStart, cStart + WRITE_CHUNK_SIZE);
          var chunkRowStart = baseStartAddRow + cStart;
          if (colBarcode >= 0) {
            sItems.getRange(chunkRowStart, colBarcode + 1, chunkRows.length, 1).setNumberFormat('@');
          }
          if (colSku >= 0) {
            sItems.getRange(chunkRowStart, colSku + 1, chunkRows.length, 1).setNumberFormat('@');
          }
          sItems.getRange(chunkRowStart, 1, chunkRows.length, colCount).setValues(chunkRows);
        }
      }
      if (newBarcodeSheetRows.length > 0 && sBarcodes) {
        var baseStartAddBcRow = sBarcodes.getLastRow() + 1;
        for (var bcStart = 0; bcStart < newBarcodeSheetRows.length; bcStart += WRITE_CHUNK_SIZE) {
          var bcChunk = newBarcodeSheetRows.slice(bcStart, bcStart + WRITE_CHUNK_SIZE);
          var bcRowStart = baseStartAddBcRow + bcStart;
          sBarcodes.getRange(bcRowStart, 3, bcChunk.length, 1).setNumberFormat('@');
          sBarcodes.getRange(bcRowStart, 1, bcChunk.length, 7).setValues(bcChunk);
        }
      }
      if (newWarehouseStockRows.length > 0) {
        var sWhStocksAdd = ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_STOCKS, WAREHOUSE_STOCKS_HEADERS_GS);
        var baseStartWhStockRow = sWhStocksAdd.getLastRow() + 1;
        for (var wsStart = 0; wsStart < newWarehouseStockRows.length; wsStart += WRITE_CHUNK_SIZE) {
          var wsChunk = newWarehouseStockRows.slice(wsStart, wsStart + WRITE_CHUNK_SIZE);
          var wsRowStart = baseStartWhStockRow + wsStart;
          sWhStocksAdd.getRange(wsRowStart, 1, wsChunk.length, WAREHOUSE_STOCKS_HEADERS_GS.length).setValues(wsChunk);
        }
      }
      if (newMovementSheetRows.length > 0) {
        var sMovAdd = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
          'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
          'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
        ]);
        var baseStartAddMovRow = sMovAdd.getLastRow() + 1;
        for (var mStart = 0; mStart < newMovementSheetRows.length; mStart += WRITE_CHUNK_SIZE) {
          var movChunk = newMovementSheetRows.slice(mStart, mStart + WRITE_CHUNK_SIZE);
          var movRowStart = baseStartAddMovRow + mStart;
          sMovAdd.getRange(movRowStart, 1, movChunk.length, 12).setValues(movChunk);
        }
      }

      // الإضافة غير قابلة للتراجع، وتُصفّر سجل آخر عملية
      clearBulkEditUndoSheetGS(ss);
      undoAvailable = false;
    } else if (opType === 'delete_items') {
      var itemRowsToDelete = [];
      var deletedItemIdMap = {};

      for (var di = 0; di < finalRows.length; di++) {
        var fDel = finalRows[di];
        var mDel = fDel.matchedItem;
        if (!fDel.actionPayload || fDel.actionPayload.kind !== 'delete_item' || !mDel) continue;
        itemRowsToDelete.push(mDel.sheetRow);
        deletedItemIdMap[mDel.id] = true;
        updatedCount++;
      }

      if (itemRowsToDelete.length > 0) {
        // الحذف من الأسفل للأعلى دفعة واحدة
        deleteRowsDescendingBatch(sItems, itemRowsToDelete);

        if (sBarcodes && bRows.length > 1) {
          var bcRowsToDel = [];
          for (var bd = 1; bd < bRows.length; bd++) {
            var bDelItemId = String(bRows[bd][1] || '').trim();
            if (deletedItemIdMap[bDelItemId]) {
              bcRowsToDel.push(bd + 1);
            }
          }
          deleteRowsDescendingBatch(sBarcodes, bcRowsToDel);
        }

        var sCosts = ss.getSheetByName(SHEETS.ITEM_PLATFORM_COSTS);
        if (sCosts && sCosts.getLastRow() > 1) {
          var costData = sCosts.getDataRange().getValues();
          var costRowsToDel = [];
          for (var cd = 1; cd < costData.length; cd++) {
            var cItemId = String(costData[cd][0] || '').trim();
            if (deletedItemIdMap[cItemId]) {
              costRowsToDel.push(cd + 1);
            }
          }
          deleteRowsDescendingBatch(sCosts, costRowsToDel);
        }

        var sWhStDel = ss.getSheetByName(SHEETS.WAREHOUSE_STOCKS);
        if (sWhStDel && sWhStDel.getLastRow() > 1) {
          var whStData = sWhStDel.getDataRange().getValues();
          var whStRowsToDel = [];
          for (var wsd2 = 1; wsd2 < whStData.length; wsd2++) {
            var wsDelItemId = String(whStData[wsd2][0] || '').trim();
            if (deletedItemIdMap[wsDelItemId]) {
              whStRowsToDel.push(wsd2 + 1);
            }
          }
          deleteRowsDescendingBatch(sWhStDel, whStRowsToDel);
        }
      }

      // الحذف غير قابل للتراجع، ويُصفّر سجل آخر عملية
      clearBulkEditUndoSheetGS(ss);
      undoAvailable = false;
    } else {
      var minModifiedArrIdx = itemData.length;
      var maxModifiedArrIdx = 0;
      var changeLogRowsBatch = [];
      var movementRowsBatch = [];
      var barcodeRowsToDelete = [];
      var barcodeRowsToAppend = [];
      var undoSheetRows = [];
      var reasonTag = 'تعديل جماعي بالإكسيل (' + (fileName || batchId) + ')';

      function setItemCell(rowArr, cIdx, val) {
        if (cIdx >= 0 && cIdx < rowArr.length) rowArr[cIdx] = val;
      }

      for (var ei = 0; ei < finalRows.length; ei++) {
        var fEdit = finalRows[ei];
        var target = fEdit.matchedItem;
        var act = fEdit.actionPayload;
        if (!target || !act) continue;

        var oldRowCopy = itemData[target.arrIndex].slice();
        var oldBarcodesCopy = (barcodesByItemId[target.id] || []).slice();
        var rowArr = itemData[target.arrIndex];
        var rowApplied = false;

        switch (opType) {
          case 'sale_price':
          case 'purchase_price':
          case 'pickup_fee':
          case 'min_price':
          case 'packaging_cost':
          case 'tax_rate':
          case 'reorder_limit': {
            if (act.kind !== 'number_field') break;
            var oldNumDisplay = fEdit.pub.currentValueDisplay || '';
            var newNumDisplay = fEdit.pub.newValueDisplay || '';
            var fieldChangedLabel = opLabel.replace(/^تعديل\s+/, '');
            if (opType === 'sale_price') setItemCell(rowArr, colSale, act.newValue);
            else if (opType === 'purchase_price') setItemCell(rowArr, colPurchase, act.newValue);
            else if (opType === 'pickup_fee') setItemCell(rowArr, colPickupFee, act.newValue > 0 ? act.newValue : '');
            else if (opType === 'min_price') setItemCell(rowArr, colMinPrice, act.newValue > 0 ? act.newValue : 0);
            else if (opType === 'packaging_cost') setItemCell(rowArr, colPackaging, act.newValue);
            else if (opType === 'tax_rate') setItemCell(rowArr, colTax, act.newValue);
            else if (opType === 'reorder_limit') {
              var rlWhId = targetWhBulk ? targetWhBulk.id : 'wh-main';
              var rlWhName = targetWhBulk ? targetWhBulk.name : 'المخزن الرئيسي';
              var prevWhReorder = getRawItemWarehouseReorderLimitGS(ss, target.id, rlWhId);
              fEdit._oldWhReorderForUndo = prevWhReorder !== undefined ? prevWhReorder : '__UNSET__';
              fEdit._whIdForUndo = rlWhId;
              setItemWarehouseReorderLimitGS(ss, target.id, rlWhId, act.newValue, now);
              if (!targetWhBulk || targetWhBulk.isDefault || rlWhId === 'wh-main') {
                setItemCell(rowArr, colReorder, act.newValue);
              }
              fieldChangedLabel = 'الحد الأدنى للكمية (' + rlWhName + ')';
            }

            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              target.name,
              fieldChangedLabel,
              oldNumDisplay || fEdit.pub.currentPrice,
              newNumDisplay || act.newValue,
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }

          case 'stock_quantity': {
            if (act.kind !== 'stock_quantity') break;
            var editWhId = targetWhBulk ? targetWhBulk.id : 'wh-main';
            var editWhName = targetWhBulk ? targetWhBulk.name : 'المخزن الرئيسي';
            var oldQtyExec = getItemWarehouseStockGS(ss, target.id, editWhId);
            var newQtyExec = act.newQuantity;
            var diffExec = Math.round((newQtyExec - oldQtyExec) * 1000) / 1000;
            if (diffExec === 0) break;

            var docNum = 'XLS-' + batchSuffix + '-' + (updatedCount + 1);
            var movId = generateUUID();
            var adjReason = act.reason || 'تسوية مخزون بالإكسيل';

            setItemWarehouseBalanceGS(ss, target.id, editWhId, newQtyExec, now);
            var totalAfterBulk = recomputeItemTotalStockGS(ss, target.id, null);
            setItemCell(rowArr, colStock, totalAfterBulk);

            movementRowsBatch.push([
              movId,
              target.id,
              target.name,
              'تسوية مخزون بالإكسيل',
              Math.abs(diffExec),
              newQtyExec,
              adjReason,
              docNum,
              userName,
              now,
              (diffExec > 0 ? 'زيادة' : 'خصم') + ' تسوية مخزون بالإكسيل (' + (diffExec > 0 ? ('+' + diffExec) : diffExec) + ') من ' + oldQtyExec + ' إلى ' + newQtyExec + ' بالمخزن (' + editWhName + '). الملف: ' + displayFileName + (act.reason ? (' • السبب: ' + act.reason) : ''),
              editWhId
            ]);

            changeLogRowsBatch.push([
              movId,
              target.id,
              target.name,
              'الكمية بالمخزن (' + editWhName + ')',
              oldQtyExec,
              newQtyExec,
              userName,
              now,
              reasonTag + ' — ' + adjReason
            ]);
            fEdit._oldWhQtyForUndo = oldQtyExec;
            fEdit._whIdForUndo = editWhId;
            rowApplied = true;
            break;
          }

          case 'name': {
            if (act.kind !== 'name') break;
            var oldNameExec = target.name;
            setItemCell(rowArr, colName, act.newName);
            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              act.newName,
              'اسم الصنف',
              oldNameExec,
              act.newName,
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }

          case 'print_name': {
            if (act.kind !== 'print_name') break;
            var oldPrintNameExec = target.printName || 'فارغ';
            if (colPrintName !== -1) setItemCell(rowArr, colPrintName, act.printName || '');
            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              target.name,
              'اسم الطباعة',
              oldPrintNameExec,
              act.printName || 'فارغ',
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }

          case 'primary_barcode':
          case 'add_secondary_barcode':
          case 'barcode_sku': {
            if (act.kind !== 'barcode_sku') break;
            var oldBcSummary = opType === 'primary_barcode'
              ? (target.barcode || 'بدون باركود')
              : opType === 'add_secondary_barcode'
              ? ((target.secondaryBarcodes && target.secondaryBarcodes.length > 0) ? target.secondaryBarcodes.join('، ') : 'بدون باركود فرعي')
              : formatBarcodeSkuDisplayGS(target.barcode, target.sku, target.secondaryBarcodes);

            setItemCell(rowArr, colBarcode, act.barcode || '');
            setItemCell(rowArr, colSku, act.sku || '');

            var existingBcRows = barcodeSheetRowsByItemId[target.id] || [];
            for (var ebr = 0; ebr < existingBcRows.length; ebr++) {
              barcodeRowsToDelete.push(existingBcRows[ebr]);
            }
            if (act.barcode) {
              barcodeRowsToAppend.push([
                generateUUID(),
                target.id,
                act.barcode,
                'primary',
                'الباركود الأساسي',
                true,
                now
              ]);
            }
            for (var nbs = 0; nbs < act.secondaryBarcodes.length; nbs++) {
              barcodeRowsToAppend.push([
                generateUUID(),
                target.id,
                act.secondaryBarcodes[nbs],
                'secondary',
                'باركود فرعي',
                true,
                now
              ]);
            }

            var newBcSummary = opType === 'primary_barcode'
              ? (act.barcode || 'بدون باركود')
              : opType === 'add_secondary_barcode'
              ? (act.secondaryBarcodes.length > 0 ? act.secondaryBarcodes.join('، ') : 'بدون باركود فرعي')
              : formatBarcodeSkuDisplayGS(act.barcode || undefined, act.sku || undefined, act.secondaryBarcodes);

            var bcFieldLabel = opType === 'primary_barcode'
              ? 'الباركود الرئيسي'
              : opType === 'add_secondary_barcode'
              ? 'الباركودات الفرعية'
              : 'الباركود / الكود';

            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              target.name,
              bcFieldLabel,
              oldBcSummary,
              newBcSummary,
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }

          case 'notes': {
            if (act.kind !== 'notes') break;
            var oldNotesExec = target.notes || '';
            setItemCell(rowArr, colNotes, act.notes);
            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              target.name,
              'الوصف',
              oldNotesExec || 'فارغ',
              act.notes,
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }

          case 'category': {
            if (act.kind !== 'category') break;
            var oldCatExec = formatItemCategoryDisplayGS(target, categoryById);
            setItemCell(rowArr, colCategory, act.categoryId);
            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              target.name,
              'التصنيف',
              oldCatExec,
              act.categoryName,
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }

          case 'platforms': {
            if (act.kind !== 'platforms') break;
            var oldPltsExec = formatItemPlatformsDisplayGS(target.platformIds, platformById);
            setItemCell(rowArr, colPlatformIds, (act.platformIds && act.platformIds.length > 0) ? JSON.stringify(act.platformIds) : '');
            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              target.name,
              'المنصات المرتبطة',
              oldPltsExec,
              formatItemPlatformsDisplayGS(act.platformIds, platformById),
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }

          case 'bnpl': {
            if (act.kind !== 'bnpl') break;
            var oldBnplDisplay = (target.enableBnpl ? 'نعم' : 'لا') + ' (' + (Number(target.bnplPercentage || 0)) + '%)';
            setItemCell(rowArr, colBnplEnable, act.enableBnpl ? 'نعم' : 'لا');
            setItemCell(rowArr, colBnplPercent, act.bnplPercentage);
            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              target.name,
              'BNPL',
              oldBnplDisplay,
              (act.enableBnpl ? 'نعم' : 'لا') + ' (' + act.bnplPercentage + '%)',
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }

          case 'supplier': {
            if (act.kind !== 'supplier') break;
            var oldSupExec = target.supplier || 'فارغ';
            setItemCell(rowArr, colSupplier, act.supplier);
            if (colDefaultSupplier !== -1) setItemCell(rowArr, colDefaultSupplier, act.supplier);
            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              target.name,
              'المورد',
              oldSupExec,
              act.supplier,
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }

          case 'unit': {
            if (act.kind !== 'unit') break;
            var oldUnitExec = target.unit || 'قطعة';
            setItemCell(rowArr, colUnit, act.unit);
            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              target.name,
              'وحدة القياس',
              oldUnitExec,
              act.unit,
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }

          case 'status': {
            if (act.kind !== 'status') break;
            var oldStatusExec = normalizeExistingItemStatusGS(target.status);
            setItemCell(rowArr, colStatus, act.status);
            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              target.name,
              'الحالة',
              oldStatusExec,
              act.status,
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }

          case 'image_url': {
            if (act.kind !== 'image_url') break;
            var oldUrlExec = target.imageUrl || 'فارغ';
            setItemCell(rowArr, colImg, act.imageUrl);
            changeLogRowsBatch.push([
              generateUUID(),
              target.id,
              target.name,
              'رابط الصورة',
              oldUrlExec,
              act.imageUrl,
              userName,
              now,
              reasonTag
            ]);
            rowApplied = true;
            break;
          }
        }

        if (rowApplied) {
          if (target.arrIndex < minModifiedArrIdx) minModifiedArrIdx = target.arrIndex;
          if (target.arrIndex > maxModifiedArrIdx) maxModifiedArrIdx = target.arrIndex;

          undoSheetRows.push([
            batchId,
            opType,
            opLabel,
            displayFileName,
            now,
            userName,
            userId,
            target.id,
            target.name,
            JSON.stringify(oldRowCopy),
            JSON.stringify(oldBarcodesCopy),
            fEdit._whIdForUndo !== undefined ? fEdit._whIdForUndo : (targetWhBulk ? targetWhBulk.id : ''),
            fEdit._oldWhQtyForUndo !== undefined ? fEdit._oldWhQtyForUndo : '',
            fEdit._oldWhReorderForUndo !== undefined ? fEdit._oldWhReorderForUndo : ''
          ]);
          updatedCount++;
        }
      }

      if (updatedCount > 0 && maxModifiedArrIdx >= minModifiedArrIdx) {
        var modCount = maxModifiedArrIdx - minModifiedArrIdx + 1;
        var modSlice = itemData.slice(minModifiedArrIdx, maxModifiedArrIdx + 1);
        var startWriteRow = minModifiedArrIdx + 1;
        if (colBarcode >= 0) {
          sItems.getRange(startWriteRow, colBarcode + 1, modCount, 1).setNumberFormat('@');
        }
        if (colSku >= 0) {
          sItems.getRange(startWriteRow, colSku + 1, modCount, 1).setNumberFormat('@');
        }
        sItems.getRange(startWriteRow, 1, modCount, colCount).setValues(modSlice);
      }

      if (barcodeRowsToDelete.length > 0 && sBarcodes) {
        deleteRowsDescendingBatch(sBarcodes, barcodeRowsToDelete);
      }
      if (barcodeRowsToAppend.length > 0 && sBarcodes) {
        var startAppendBcRow = sBarcodes.getLastRow() + 1;
        sBarcodes.getRange(startAppendBcRow, 3, barcodeRowsToAppend.length, 1).setNumberFormat('@');
        sBarcodes.getRange(startAppendBcRow, 1, barcodeRowsToAppend.length, 7).setValues(barcodeRowsToAppend);
      }

      if (movementRowsBatch.length > 0) {
        var sMovEdit = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
          'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
          'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
        ]);
        var startEditMovRow = sMovEdit.getLastRow() + 1;
        sMovEdit.getRange(startEditMovRow, 1, movementRowsBatch.length, 12).setValues(movementRowsBatch);
      }

      if (changeLogRowsBatch.length > 0) {
        var sLogEdit = ensureSheetWithHeaders(ss, SHEETS.ITEM_CHANGE_LOG, [
          'ID', 'ID الصنف', 'اسم الصنف', 'الحقل المعدل', 'القيمة القديمة', 'القيمة الجديدة',
          'المستخدم', 'التاريخ والوقت', 'سبب التعديل'
        ]);
        var startEditLogRow = sLogEdit.getLastRow() + 1;
        sLogEdit.getRange(startEditLogRow, 1, changeLogRowsBatch.length, 9).setValues(changeLogRowsBatch);
      }

      if (undoSheetRows.length > 0) {
        clearBulkEditUndoSheetGS(ss);
        var sUndo = ensureSheetWithHeaders(ss, SHEETS.BULK_EDIT_UNDO, BULK_EDIT_UNDO_HEADERS_GS);
        sUndo.getRange(2, 1, undoSheetRows.length, BULK_EDIT_UNDO_HEADERS_GS.length).setValues(undoSheetRows);
        undoAvailable = true;
      }
    }

    var auditAction =
      opType === 'add_items' ? 'PRODUCTS_BULK_ADD_EXCEL' :
      (opType === 'delete_items' ? 'PRODUCTS_BULK_DELETE_EXCEL' : 'PRODUCTS_BULK_EDIT_EXCEL');

    var actionVerb =
      opType === 'add_items' ? 'إضافة' : (opType === 'delete_items' ? 'حذف' : 'تعديل');

    var skipAuditLog = Boolean(payload && payload.skipAuditLog);
    if (!skipAuditLog) {
      var auditSum = payload && payload.auditSummary ? payload.auditSummary : null;
      var logUpd = auditSum && auditSum.updatedCount !== undefined ? Number(auditSum.updatedCount) : updatedCount;
      var logUnch = auditSum && auditSum.unchangedCount !== undefined ? Number(auditSum.unchangedCount) : unchangedCount;
      var logErr = auditSum && auditSum.errorCount !== undefined ? Number(auditSum.errorCount) : errorCount;
      var auditWhPart = targetWhBulk ? (' | المخزن: ' + targetWhBulk.name) : '';

      logAudit(
        session,
        auditAction,
        'Item',
        batchId,
        'عملية بالإكسيل — المستخدم: ' + userName + ' | النوع: ' + opLabel + auditWhPart + ' | العدد المنفذ: ' + logUpd + ' صنف | بدون تغيير: ' + logUnch + ' | مرفوض: ' + logErr + ' | الملف: ' + displayFileName
      );
    }

    if (execNewCatsList.length > 0) {
      summary.newCategories = execNewCatsList;
    } else {
      delete summary.newCategories;
    }

    var execRes = {
      success: true,
      statusCode: 200,
      operationType: opType,
      fileName: fileName,
      warehouseId: targetWhBulk ? targetWhBulk.id : undefined,
      warehouseName: targetWhBulk ? targetWhBulk.name : undefined,
      batchId: batchId,
      updatedCount: updatedCount,
      unchangedCount: unchangedCount,
      errorCount: errorCount,
      warningCount: warningCount,
      summary: summary,
      rows: publicRows,
      undoAvailable: undoAvailable,
      message: 'تم ' + actionVerb + ' ' + updatedCount + ' صنف بنجاح (' + opLabel + (targetWhBulk ? (' — ' + targetWhBulk.name) : '') + ')'
    };
    if (execNewCatsList.length > 0) {
      execRes.newCategories = execNewCatsList;
    }
    return execRes;
  };

  if (dryRun) {
    return executeBulkEditBody();
  }
  var lockRes = withScriptLock(executeBulkEditBody);
  if (lockRes && lockRes.code === 'BUSY' && lockRes.statusCode === undefined) {
    return {
      success: false,
      statusCode: 409,
      code: 'BUSY',
      updatedCount: 0,
      unchangedCount: 0,
      errorCount: 0,
      error: lockRes.error
    };
  }
  return lockRes;
}

/**
 * استعلام عن حالة آخر عملية تعديل بالإكسيل قابلة للتراجع من ورقة BulkEditUndo
 */
function getBulkEditUndoStatusGS(session) {
  if (!hasBulkEditExcelPermGS(session)) {
    return {
      success: false,
      statusCode: 403,
      available: false,
      error: 'غير مصرح: تفتقر لصلاحية [products.bulk_edit_excel]'
    };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sUndo = ss.getSheetByName(SHEETS.BULK_EDIT_UNDO);
  if (!sUndo || sUndo.getLastRow() < 2) {
    return {
      success: true,
      statusCode: 200,
      available: false
    };
  }

  var data = sUndo.getDataRange().getValues();
  var h = getHeaderMap(sUndo);
  var colBatch = h.get('ID الدفعة', 0);
  var colOpType = h.get('نوع العملية', 1);
  var colOpLabel = h.get('وصف العملية', 2);
  var colFile = h.get('اسم الملف', 3);
  var colExecAt = h.get('تاريخ التنفيذ', 4);
  var colExecBy = h.get('المستخدم المنفذ', 5);
  var colItemId = h.get('ID الصنف', 7);

  var validRows = 0;
  var firstRow = null;
  for (var i = 1; i < data.length; i++) {
    var rowItemId = String(colVal(data[i], colItemId, '')).trim();
    if (!rowItemId) continue;
    if (!firstRow) firstRow = data[i];
    validRows++;
  }

  if (!firstRow || validRows === 0) {
    return {
      success: true,
      statusCode: 200,
      available: false
    };
  }

  return {
    success: true,
    statusCode: 200,
    available: true,
    batchId: String(colVal(firstRow, colBatch, '')),
    operationType: String(colVal(firstRow, colOpType, '')),
    operationLabel: String(colVal(firstRow, colOpLabel, '')),
    fileName: String(colVal(firstRow, colFile, '')),
    affectedCount: validRows,
    executedAt: String(colVal(firstRow, colExecAt, '')),
    executedBy: String(colVal(firstRow, colExecBy, ''))
  };
}

/**
 * التراجع عن آخر عملية تعديل بالإكسيل (للتعديلات فقط، لآخر عملية فقط) من ورقة BulkEditUndo
 */
function undoLastBulkEditExcelGS(session) {
  if (!hasBulkEditExcelPermGS(session)) {
    return {
      success: false,
      statusCode: 403,
      restoredCount: 0,
      error: 'غير مصرح: تفتقر لصلاحية التعديل بالإكسيل [products.bulk_edit_excel]'
    };
  }

  var lockRes = withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sUndo = ss.getSheetByName(SHEETS.BULK_EDIT_UNDO);
    if (!sUndo || sUndo.getLastRow() < 2) {
      return {
        success: false,
        statusCode: 400,
        restoredCount: 0,
        error: 'لا توجد عملية تعديل بالإكسيل قابلة للتراجع حالياً (التراجع متاح لآخر عملية تعديل فقط وغير متاح للإضافة أو الحذف).'
      };
    }

    var uData = sUndo.getDataRange().getValues();
    var uh = getHeaderMap(sUndo);
    var colBatch = uh.get('ID الدفعة', 0);
    var colOpType = uh.get('نوع العملية', 1);
    var colOpLabel = uh.get('وصف العملية', 2);
    var colFile = uh.get('اسم الملف', 3);
    var colItemId = uh.get('ID الصنف', 7);
    var colItemName = uh.get('اسم الصنف', 8);
    var colOldRowJson = uh.get('بيانات الصف السابقة (JSON)', 9);
    var colOldBcJson = uh.get('الباركودات السابقة (JSON)', 10);
    var colUndoWhId = uh.get('معرف المخزن', 11);
    var colUndoPrevWhQty = uh.get('الكمية السابقة بالمخزن', 12);
    var colUndoPrevWhReorder = uh.get('الحد الأدنى السابق بالمخزن', 13);

    var snapshots = [];
    var batchId = '';
    var operationType = '';
    var operationLabel = '';
    var fileName = '';

    for (var i = 1; i < uData.length; i++) {
      var uRow = uData[i];
      var sItemId = String(colVal(uRow, colItemId, '')).trim();
      if (!sItemId) continue;
      if (!batchId) {
        batchId = String(colVal(uRow, colBatch, ''));
        operationType = String(colVal(uRow, colOpType, ''));
        operationLabel = String(colVal(uRow, colOpLabel, '')) || (BULK_EDIT_OP_LABELS_GS[operationType] || operationType);
        fileName = String(colVal(uRow, colFile, ''));
      }
      var parsedPrevRow = null;
      var parsedPrevBcs = [];
      try {
        parsedPrevRow = JSON.parse(String(colVal(uRow, colOldRowJson, '[]')));
      } catch (_) {}
      try {
        parsedPrevBcs = JSON.parse(String(colVal(uRow, colOldBcJson, '[]')));
        if (!Array.isArray(parsedPrevBcs)) parsedPrevBcs = [];
      } catch (_) {
        parsedPrevBcs = [];
      }
      if (Array.isArray(parsedPrevRow)) {
        var rawUndoWhId = String(colVal(uRow, colUndoWhId, '') || '').trim();
        var rawUndoPrevWhQty = colVal(uRow, colUndoPrevWhQty, '');
        var rawUndoPrevWhReorder = colUndoPrevWhReorder >= 0 ? colVal(uRow, colUndoPrevWhReorder, '') : '';
        snapshots.push({
          itemId: sItemId,
          itemName: String(colVal(uRow, colItemName, '')),
          previousRow: parsedPrevRow,
          previousBarcodes: parsedPrevBcs,
          previousWarehouseId: rawUndoWhId || 'wh-main',
          previousWarehouseQty: (rawUndoPrevWhQty !== '' && rawUndoPrevWhQty !== null && rawUndoPrevWhQty !== undefined)
            ? Number(rawUndoPrevWhQty)
            : null,
          previousWarehouseReorder: (rawUndoPrevWhReorder !== '' && rawUndoPrevWhReorder !== null && rawUndoPrevWhReorder !== undefined)
            ? (String(rawUndoPrevWhReorder) === '__UNSET__' ? undefined : Number(rawUndoPrevWhReorder))
            : '__NONE__'
        });
      }
    }

    if (snapshots.length === 0) {
      return {
        success: false,
        statusCode: 400,
        restoredCount: 0,
        error: 'لا توجد عملية تعديل بالإكسيل قابلة للتراجع حالياً (التراجع متاح لآخر عملية تعديل فقط وغير متاح للإضافة أو الحذف).'
      };
    }

    if (operationType === 'purchase_price' && !hasPurchasePricePermGS(session)) {
      return {
        success: false,
        statusCode: 403,
        restoredCount: 0,
        error: 'غير مصرح: تفتقر لصلاحية سعر الشراء [prices.view_purchase] للتراجع عن هذه العملية'
      };
    }
    if (operationType === 'packaging_cost' && !hasPackagingCostPermGS(session)) {
      return {
        success: false,
        statusCode: 403,
        restoredCount: 0,
        error: 'غير مصرح: تفتقر لصلاحية تكلفة التغليف [prices.view_packaging] للتراجع عن هذه العملية'
      };
    }

    var sItems = ss.getSheetByName(SHEETS.ITEMS);
    if (!sItems || sItems.getLastRow() < 2) {
      clearBulkEditUndoSheetGS(ss);
      return {
        success: false,
        statusCode: 400,
        restoredCount: 0,
        error: 'جدول الأصناف فارغ ولا يمكن استعادة السجلات.'
      };
    }

    var hItems = getHeaderMap(sItems);
    var colId = hItems.get('ID', 0);
    var colName = hItems.get('اسم الصنف', 1);
    var colStock = hItems.get('الكمية بالمخزن', 6);
    var colBarcode = hItems.get('الباركود الأساسي', 10);
    var colSku = hItems.get('كود SKU', -1);

    var itemData = sItems.getDataRange().getValues();
    var colCount = hItems.headers.length > 0 ? hItems.headers.length : BULK_EDIT_ITEMS_HEADERS_GS.length;
    var itemArrIdxById = {};
    for (var ir = 1; ir < itemData.length; ir++) {
      while (itemData[ir].length < colCount) itemData[ir].push('');
      var idStr = String(colVal(itemData[ir], colId, '')).trim();
      if (idStr) itemArrIdxById[idStr] = ir;
    }

    var sBarcodes = ss.getSheetByName(SHEETS.ITEM_BARCODES);
    var bRows = (sBarcodes && sBarcodes.getLastRow() > 1) ? sBarcodes.getDataRange().getValues() : [];
    var barcodeSheetRowsByItemId = {};
    for (var br = 1; br < bRows.length; br++) {
      var bItemId = String(bRows[br][1] || '').trim();
      if (!bItemId) continue;
      if (!barcodeSheetRowsByItemId[bItemId]) barcodeSheetRowsByItemId[bItemId] = [];
      barcodeSheetRowsByItemId[bItemId].push(br + 1);
    }

    var now = new Date().toISOString();
    var undoBatchId = 'UNDO-' + batchId;
    var userName = (session && (session.name || session.phone)) || 'مستخدم النظام';
    var restoredCount = 0;
    var minModifiedArrIdx = itemData.length;
    var maxModifiedArrIdx = 0;
    var movementRowsBatch = [];
    var changeLogRowsBatch = [];
    var barcodeRowsToDelete = [];
    var barcodeRowsToAppend = [];

    for (var si = 0; si < snapshots.length; si++) {
      var snap = snapshots[si];
      var arrIdx = itemArrIdxById[snap.itemId];
      if (arrIdx === undefined) continue;

      var currentRow = itemData[arrIdx];
      var restoredRow = snap.previousRow.slice();
      while (restoredRow.length < colCount) restoredRow.push('');
      if (restoredRow.length > colCount) restoredRow = restoredRow.slice(0, colCount);

      var restoredName = String(colVal(restoredRow, colName, snap.itemName || ''));

      if (operationType === 'stock_quantity') {
        var targetWhIdUndo = snap.previousWarehouseId || 'wh-main';
        var curWhQty = getItemWarehouseStockGS(ss, snap.itemId, targetWhIdUndo);
        var prevWhQty = (snap.previousWarehouseQty !== null && snap.previousWarehouseQty !== undefined && !isNaN(Number(snap.previousWarehouseQty)))
          ? Number(snap.previousWarehouseQty)
          : (Number(colVal(restoredRow, colStock, 0)) || 0);
        var diff = Math.round((prevWhQty - curWhQty) * 1000) / 1000;

        setItemWarehouseBalanceGS(ss, snap.itemId, targetWhIdUndo, prevWhQty, now);
        var totalRestored = recomputeItemTotalStockGS(ss, snap.itemId, null);
        if (colStock >= 0 && colStock < restoredRow.length) {
          restoredRow[colStock] = totalRestored;
        }
        itemData[arrIdx] = restoredRow;

        if (diff !== 0) {
          movementRowsBatch.push([
            generateUUID(),
            snap.itemId,
            restoredName,
            'تسوية مخزون بالإكسيل',
            Math.abs(diff),
            prevWhQty,
            'تراجع عن آخر عملية تعديل بالإكسيل (' + batchId + ')',
            'UNDO-XLS-' + (restoredCount + 1),
            userName,
            now,
            'تراجع عن تسوية مخزون بالإكسيل (' + (diff > 0 ? ('+' + diff) : diff) + ') من ' + curWhQty + ' إلى ' + prevWhQty + ' للملف: ' + fileName,
            targetWhIdUndo
          ]);
        }
      } else if (operationType === 'reorder_limit') {
        var targetWhIdRlUndo = snap.previousWarehouseId || 'wh-main';
        if (snap.previousWarehouseReorder !== '__NONE__') {
          setItemWarehouseReorderLimitGS(ss, snap.itemId, targetWhIdRlUndo, snap.previousWarehouseReorder, now);
        }
        itemData[arrIdx] = restoredRow;
      } else {
        itemData[arrIdx] = restoredRow;
        var existingBcRows = barcodeSheetRowsByItemId[snap.itemId] || [];
        for (var ebr = 0; ebr < existingBcRows.length; ebr++) {
          barcodeRowsToDelete.push(existingBcRows[ebr]);
        }
        for (var pbi = 0; pbi < snap.previousBarcodes.length; pbi++) {
          var pb = snap.previousBarcodes[pbi];
          if (!pb || !pb.barcode) continue;
          barcodeRowsToAppend.push([
            pb.id || generateUUID(),
            snap.itemId,
            pb.barcode,
            pb.type || 'secondary',
            pb.label || (pb.type === 'primary' ? 'الباركود الأساسي' : 'باركود فرعي'),
            pb.active !== false,
            pb.createdAt || now
          ]);
        }
      }

      if (arrIdx < minModifiedArrIdx) minModifiedArrIdx = arrIdx;
      if (arrIdx > maxModifiedArrIdx) maxModifiedArrIdx = arrIdx;

      changeLogRowsBatch.push([
        generateUUID(),
        snap.itemId,
        restoredName,
        'تراجع (' + operationLabel + ')',
        'القيمة المعدلة',
        'القيمة الأصلية المستعادة',
        userName,
        now,
        'تراجع عن آخر عملية تعديل بالإكسيل (' + batchId + ' - ' + fileName + ')'
      ]);

      restoredCount++;
    }

    if (restoredCount > 0 && maxModifiedArrIdx >= minModifiedArrIdx) {
      var modCount = maxModifiedArrIdx - minModifiedArrIdx + 1;
      var modSlice = itemData.slice(minModifiedArrIdx, maxModifiedArrIdx + 1);
      var startWriteRow = minModifiedArrIdx + 1;
      if (colBarcode >= 0) {
        sItems.getRange(startWriteRow, colBarcode + 1, modCount, 1).setNumberFormat('@');
      }
      if (colSku >= 0) {
        sItems.getRange(startWriteRow, colSku + 1, modCount, 1).setNumberFormat('@');
      }
      sItems.getRange(startWriteRow, 1, modCount, colCount).setValues(modSlice);
    }

    if (barcodeRowsToDelete.length > 0 && sBarcodes) {
      deleteRowsDescendingBatch(sBarcodes, barcodeRowsToDelete);
    }
    if (barcodeRowsToAppend.length > 0 && sBarcodes) {
      var startBcRow = sBarcodes.getLastRow() + 1;
      sBarcodes.getRange(startBcRow, 3, barcodeRowsToAppend.length, 1).setNumberFormat('@');
      sBarcodes.getRange(startBcRow, 1, barcodeRowsToAppend.length, 7).setValues(barcodeRowsToAppend);
    }

    if (movementRowsBatch.length > 0) {
      var sMovUndo = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
        'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
        'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
      ]);
      var startUndoMovRow = sMovUndo.getLastRow() + 1;
      sMovUndo.getRange(startUndoMovRow, 1, movementRowsBatch.length, 12).setValues(movementRowsBatch);
    }

    if (changeLogRowsBatch.length > 0) {
      var sLogUndo = ensureSheetWithHeaders(ss, SHEETS.ITEM_CHANGE_LOG, [
        'ID', 'ID الصنف', 'اسم الصنف', 'الحقل المعدل', 'القيمة القديمة', 'القيمة الجديدة',
        'المستخدم', 'التاريخ والوقت', 'سبب التعديل'
      ]);
      var startUndoLogRow = sLogUndo.getLastRow() + 1;
      sLogUndo.getRange(startUndoLogRow, 1, changeLogRowsBatch.length, 9).setValues(changeLogRowsBatch);
    }

    clearBulkEditUndoSheetGS(ss);

    logAudit(
      session,
      'PRODUCTS_BULK_UNDO_EXCEL',
      'Item',
      undoBatchId,
      'تراجع عن آخر عملية بالإكسيل — المستخدم: ' + userName + ' | النوع: ' + operationLabel + ' | العدد المستعاد: ' + restoredCount + ' صنف | الملف: ' + fileName
    );

    return {
      success: true,
      statusCode: 200,
      batchId: batchId,
      operationType: operationType,
      operationLabel: operationLabel,
      fileName: fileName,
      restoredCount: restoredCount,
      message: 'تم التراجع عن آخر عملية (' + operationLabel + ') واستعادة القيم السابقة لعدد ' + restoredCount + ' صنف'
    };
  });
  if (lockRes && lockRes.code === 'BUSY' && lockRes.statusCode === undefined) {
    return {
      success: false,
      statusCode: 409,
      code: 'BUSY',
      restoredCount: 0,
      error: lockRes.error
    };
  }
  return lockRes;
}

// =========================================================================
// 22. المخازن المتعددة والتحويلات وأوامر الصرف (Multi-Warehouse & Transfers)
// =========================================================================

var MAIN_WAREHOUSE_ID_GS = 'wh-main';
var MAIN_WAREHOUSE_NAME_GS = 'المخزن الرئيسي';
var WAREHOUSE_ALL_TOKEN_GS = 'ALL';
var WAREHOUSE_MIGRATION_SETTING_KEY_GS = 'warehouse_migration_v1_completed';

var WAREHOUSES_HEADERS_GS = [
  'ID', 'اسم المخزن', 'الحالة', 'افتراضي', 'ملاحظات', 'تاريخ الإنشاء', 'تاريخ آخر تعديل'
];

var WAREHOUSE_STOCKS_HEADERS_GS = [
  'itemId', 'warehouseId', 'quantity', 'updatedAt', 'reorderLimit'
];

var USER_WAREHOUSES_HEADERS_GS = [
  'userId', 'allowedWarehouseIdsJson', 'defaultWarehouseId', 'updatedAt'
];

var DISPATCH_ORDERS_HEADERS_GS = [
  'ID', 'رقم أمر الصرف', 'التاريخ', 'من مخزن (ID)', 'من مخزن (الاسم)',
  'إلى مخزن (ID)', 'إلى مخزن (الاسم)', 'عدد الأصناف', 'إجمالي الكميات',
  'إجمالي التكلفة (سعر الشراء)', 'المستخدم المنفذ (ID)', 'اسم المستخدم المنفذ',
  'ملاحظات', 'تاريخ الإنشاء', 'idempotencyKey'
];

var DISPATCH_ORDER_LINES_HEADERS_GS = [
  'ID', 'ID أمر الصرف', 'ID الصنف', 'اسم الصنف', 'الباركود',
  'الوحدة', 'الكمية', 'سعر الشراء وقت الصرف', 'إجمالي السطر (بسعر الشراء)',
  'رصيد المصدر قبل', 'رصيد المصدر بعد', 'رصيد الوجهة قبل', 'رصيد الوجهة بعد',
  'كود SKU', 'ملاحظات الصنف'
];

function normalizeWarehouseNameGS(name) {
  return normalizeArabicTextGS(String(name || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWarehouseStatusGS(status) {
  var s = String(status || '').trim().toLowerCase();
  if (s === 'inactive' || s === 'موقوف' || s === 'غير نشط' || s === 'معطل') {
    return 'موقوف';
  }
  return 'نشط';
}

function isWarehouseActiveGS(wh) {
  if (!wh) return false;
  return normalizeWarehouseStatusGS(wh.status) === 'نشط';
}

function ensureMainWarehouseRowGS(ss, optLog) {
  var sheet = ensureSheetWithHeaders(ss, SHEETS.WAREHOUSES, WAREHOUSES_HEADERS_GS, optLog);
  var data = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
  var now = new Date().toISOString();
  var foundMainIdx = -1;
  var foundDefaultIdx = -1;

  for (var i = 1; i < data.length; i++) {
    var rId = String(data[i][0] || '').trim();
    var rName = String(data[i][1] || '').trim();
    var rDef = data[i][3] === true || String(data[i][3]).toLowerCase() === 'true' || String(data[i][3]).trim() === 'نعم';
    if (rId === MAIN_WAREHOUSE_ID_GS || normalizeWarehouseNameGS(rName) === normalizeWarehouseNameGS(MAIN_WAREHOUSE_NAME_GS)) {
      foundMainIdx = i;
    }
    if (rDef && foundDefaultIdx === -1) {
      foundDefaultIdx = i;
    }
  }

  if (foundMainIdx === -1) {
    var isDef = foundDefaultIdx === -1;
    var mainRow = [
      MAIN_WAREHOUSE_ID_GS,
      MAIN_WAREHOUSE_NAME_GS,
      'نشط',
      isDef,
      'المخزن الافتراضي الرئيسي للنظام',
      now,
      now
    ];
    sheet.appendRow(mainRow);
    return {
      id: MAIN_WAREHOUSE_ID_GS,
      name: MAIN_WAREHOUSE_NAME_GS,
      status: 'نشط',
      isDefault: isDef,
      notes: 'المخزن الافتراضي الرئيسي للنظام',
      createdAt: now,
      updatedAt: now
    };
  }

  var mainRowArr = data[foundMainIdx];
  var mainId = String(mainRowArr[0] || MAIN_WAREHOUSE_ID_GS).trim() || MAIN_WAREHOUSE_ID_GS;
  var mainName = String(mainRowArr[1] || MAIN_WAREHOUSE_NAME_GS).trim() || MAIN_WAREHOUSE_NAME_GS;
  var mainStatus = normalizeWarehouseStatusGS(mainRowArr[2]);
  var mainIsDefault = mainRowArr[3] === true || String(mainRowArr[3]).toLowerCase() === 'true' || String(mainRowArr[3]).trim() === 'نعم';
  if (foundDefaultIdx === -1 && !mainIsDefault) {
    mainIsDefault = true;
    sheet.getRange(foundMainIdx + 1, 4).setValue(true);
  }
  return {
    id: mainId,
    name: mainName,
    status: mainStatus,
    isDefault: mainIsDefault,
    notes: String(mainRowArr[4] || ''),
    createdAt: String(mainRowArr[5] || now),
    updatedAt: String(mainRowArr[6] || mainRowArr[5] || now)
  };
}

function getRawWarehousesListGS(ss) {
  ensureMainWarehouseRowGS(ss);
  var sheet = ss.getSheetByName(SHEETS.WAREHOUSES);
  if (!sheet || sheet.getLastRow() <= 1) {
    var now = new Date().toISOString();
    return [{
      id: MAIN_WAREHOUSE_ID_GS,
      name: MAIN_WAREHOUSE_NAME_GS,
      status: 'نشط',
      isDefault: true,
      notes: 'المخزن الافتراضي الرئيسي للنظام',
      createdAt: now,
      updatedAt: now
    }];
  }
  var data = sheet.getDataRange().getValues();
  var list = [];
  var hasDefault = false;
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][0] || '').trim();
    if (!id) continue;
    var isDef = data[i][3] === true || String(data[i][3]).toLowerCase() === 'true' || String(data[i][3]).trim() === 'نعم';
    if (isDef) hasDefault = true;
    list.push({
      sheetRow: i + 1,
      id: id,
      name: String(data[i][1] || '').trim() || id,
      status: normalizeWarehouseStatusGS(data[i][2]),
      isDefault: isDef,
      notes: String(data[i][4] || ''),
      createdAt: String(data[i][5] || ''),
      updatedAt: String(data[i][6] || data[i][5] || '')
    });
  }
  if (!hasDefault && list.length > 0) {
    var mIdx = 0;
    for (var j = 0; j < list.length; j++) {
      if (list[j].id === MAIN_WAREHOUSE_ID_GS) {
        mIdx = j;
        break;
      }
    }
    list[mIdx].isDefault = true;
  }
  return list;
}

function getWarehouseLookupMapGS(ss) {
  var list = getRawWarehousesListGS(ss);
  var byId = {};
  var defaultId = MAIN_WAREHOUSE_ID_GS;
  var defaultName = MAIN_WAREHOUSE_NAME_GS;
  for (var i = 0; i < list.length; i++) {
    var w = list[i];
    byId[w.id] = w;
    if (w.isDefault) {
      defaultId = w.id;
      defaultName = w.name;
    }
  }
  if (!byId[defaultId] && list.length > 0) {
    defaultId = list[0].id;
    defaultName = list[0].name;
  }
  return {
    byId: byId,
    list: list,
    defaultId: defaultId,
    defaultName: defaultName
  };
}

function getWarehouseStocksListGS(ss) {
  var sheet = ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_STOCKS, WAREHOUSE_STOCKS_HEADERS_GS);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var itemId = String(data[i][0] || '').trim();
    var warehouseId = String(data[i][1] || '').trim();
    if (!itemId || !warehouseId) continue;
    var rawRl = data[i].length > 4 ? data[i][4] : '';
    var hasRl = rawRl !== '' && rawRl !== null && rawRl !== undefined && !isNaN(Number(rawRl));
    out.push({
      itemId: itemId,
      warehouseId: warehouseId,
      quantity: Math.round(Number(data[i][2] || 0) * 1000) / 1000,
      updatedAt: String(data[i][3] || ''),
      reorderLimit: hasRl ? Math.max(0, Math.round(Number(rawRl) * 100) / 100) : undefined
    });
  }
  return out;
}

function getItemWarehouseStockGS(ss, itemId, warehouseId) {
  var targetItem = String(itemId || '').trim();
  var targetWh = String(warehouseId || '').trim() || MAIN_WAREHOUSE_ID_GS;
  if (!targetItem) return 0;
  var sheet = ss.getSheetByName(SHEETS.WAREHOUSE_STOCKS);
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === targetItem && String(data[i][1] || '').trim() === targetWh) {
      return Math.round(Number(data[i][2] || 0) * 1000) / 1000;
    }
  }
  return 0;
}

function getRawItemWarehouseReorderLimitGS(ss, itemId, warehouseId) {
  var targetItem = String(itemId || '').trim();
  var targetWh = String(warehouseId || '').trim() || MAIN_WAREHOUSE_ID_GS;
  if (!targetItem) return undefined;
  var sheet = ss.getSheetByName(SHEETS.WAREHOUSE_STOCKS);
  if (!sheet || sheet.getLastRow() <= 1) return undefined;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === targetItem && String(data[i][1] || '').trim() === targetWh) {
      var rawRl = data[i].length > 4 ? data[i][4] : '';
      if (rawRl !== '' && rawRl !== null && rawRl !== undefined && !isNaN(Number(rawRl))) {
        return Math.max(0, Math.round(Number(rawRl) * 100) / 100);
      }
      return undefined;
    }
  }
  return undefined;
}

function getItemWarehouseReorderLimitGS(ss, itemId, warehouseId, fallbackItemReorderLimit) {
  var explicitRl = getRawItemWarehouseReorderLimitGS(ss, itemId, warehouseId);
  if (explicitRl !== undefined) return explicitRl;
  if (fallbackItemReorderLimit !== undefined && fallbackItemReorderLimit !== null && !isNaN(Number(fallbackItemReorderLimit))) {
    return Math.max(0, Math.round(Number(fallbackItemReorderLimit) * 100) / 100);
  }
  return 0;
}

function setItemWarehouseReorderLimitGS(ss, itemId, warehouseId, newReorderLimit, updatedAt) {
  var targetItem = String(itemId || '').trim();
  var targetWh = String(warehouseId || '').trim() || MAIN_WAREHOUSE_ID_GS;
  var now = updatedAt || new Date().toISOString();
  var hasVal = newReorderLimit !== undefined && newReorderLimit !== null && newReorderLimit !== '' && !isNaN(Number(newReorderLimit));
  var cleanRl = hasVal ? Math.max(0, Math.round(Number(newReorderLimit) * 100) / 100) : '';
  var sheet = ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_STOCKS, WAREHOUSE_STOCKS_HEADERS_GS);
  var data = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === targetItem && String(data[i][1] || '').trim() === targetWh) {
      sheet.getRange(i + 1, 4, 1, 2).setValues([[now, cleanRl]]);
      return hasVal ? cleanRl : undefined;
    }
  }
  if (hasVal) {
    sheet.appendRow([targetItem, targetWh, 0, now, cleanRl]);
  }
  return hasVal ? cleanRl : undefined;
}

function setItemWarehouseBalanceGS(ss, itemId, warehouseId, newQty, updatedAt) {
  var targetItem = String(itemId || '').trim();
  var targetWh = String(warehouseId || '').trim() || MAIN_WAREHOUSE_ID_GS;
  var rounded = Math.round(Number(newQty || 0) * 1000) / 1000;
  var now = updatedAt || new Date().toISOString();
  var sheet = ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_STOCKS, WAREHOUSE_STOCKS_HEADERS_GS);
  var data = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === targetItem && String(data[i][1] || '').trim() === targetWh) {
      sheet.getRange(i + 1, 3, 1, 2).setValues([[rounded, now]]);
      return rounded;
    }
  }
  sheet.appendRow([targetItem, targetWh, rounded, now, '']);
  return rounded;
}

function adjustItemWarehouseDeltaGS(ss, itemId, warehouseId, deltaQty, updatedAt) {
  var targetItem = String(itemId || '').trim();
  var targetWh = String(warehouseId || '').trim() || MAIN_WAREHOUSE_ID_GS;
  var delta = Number(deltaQty || 0);
  var now = updatedAt || new Date().toISOString();
  var sheet = ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_STOCKS, WAREHOUSE_STOCKS_HEADERS_GS);
  var data = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === targetItem && String(data[i][1] || '').trim() === targetWh) {
      var before = Math.round(Number(data[i][2] || 0) * 1000) / 1000;
      var after = Math.round((before + delta) * 1000) / 1000;
      sheet.getRange(i + 1, 3, 1, 2).setValues([[after, now]]);
      return { balanceBefore: before, balanceAfter: after };
    }
  }
  var initialAfter = Math.round(delta * 1000) / 1000;
  sheet.appendRow([targetItem, targetWh, initialAfter, now]);
  return { balanceBefore: 0, balanceAfter: initialAfter };
}

function recomputeItemTotalStockGS(ss, itemId, optItemsSheet) {
  var targetItem = String(itemId || '').trim();
  if (!targetItem) return 0;
  var sStocks = ss.getSheetByName(SHEETS.WAREHOUSE_STOCKS);
  var sum = 0;
  if (sStocks && sStocks.getLastRow() > 1) {
    var stData = sStocks.getDataRange().getValues();
    for (var i = 1; i < stData.length; i++) {
      if (String(stData[i][0] || '').trim() === targetItem) {
        sum += Number(stData[i][2] || 0);
      }
    }
  }
  var rounded = Math.round(sum * 1000) / 1000;
  if (optItemsSheet && optItemsSheet.getLastRow() > 1) {
    var iData = optItemsSheet.getDataRange().getValues();
    for (var r = 1; r < iData.length; r++) {
      if (String(iData[r][0] || '').trim() === targetItem) {
        optItemsSheet.getRange(r + 1, 7).setValue(rounded);
        break;
      }
    }
  }
  return rounded;
}

function migrateItemStocksToMainWarehouseOnceGS(optLog) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mainWh = ensureMainWarehouseRowGS(ss, optLog);
    ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_STOCKS, WAREHOUSE_STOCKS_HEADERS_GS, optLog);
    ensureSheetWithHeaders(ss, SHEETS.USER_WAREHOUSES, USER_WAREHOUSES_HEADERS_GS, optLog);
    ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_DISPATCH_ORDERS, DISPATCH_ORDERS_HEADERS_GS, optLog);
    ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_DISPATCH_ORDER_LINES, DISPATCH_ORDER_LINES_HEADERS_GS, optLog);

    var sSet = ensureSheetWithHeaders(ss, SHEETS.SETTINGS, ['key', 'value', 'updatedAt'], optLog);
    var setRows = sSet.getLastRow() > 1 ? sSet.getDataRange().getValues() : [];
    var existingMigrationJson = '';
    var migrationRowIdx = -1;
    for (var sr = 1; sr < setRows.length; sr++) {
      if (String(setRows[sr][0] || '').trim() === WAREHOUSE_MIGRATION_SETTING_KEY_GS) {
        existingMigrationJson = String(setRows[sr][1] || '').trim();
        migrationRowIdx = sr + 1;
        break;
      }
    }

    var sWhStocks = ss.getSheetByName(SHEETS.WAREHOUSE_STOCKS);
    var whStockRows = (sWhStocks && sWhStocks.getLastRow() > 1) ? sWhStocks.getDataRange().getValues() : [];

    if (existingMigrationJson) {
      try {
        var parsedReport = JSON.parse(existingMigrationJson);
        if (parsedReport && parsedReport.completed) {
          return parsedReport;
        }
      } catch (_) {}
    }

    var sItems = ss.getSheetByName(SHEETS.ITEMS);
    var itemRows = (sItems && sItems.getLastRow() > 1) ? sItems.getDataRange().getValues() : [];

    var existingStockMap = {};
    for (var ws = 1; ws < whStockRows.length; ws++) {
      var wsItemId = String(whStockRows[ws][0] || '').trim();
      var wsWhId = String(whStockRows[ws][1] || '').trim();
      if (wsItemId && wsWhId) {
        existingStockMap[wsItemId + '::' + wsWhId] = Math.round(Number(whStockRows[ws][2] || 0) * 1000) / 1000;
      }
    }

    var prePerItem = {};
    var preTotal = 0;
    var itemsCount = 0;
    var now = new Date().toISOString();
    var rowsToAppend = [];

    for (var i = 1; i < itemRows.length; i++) {
      var itemId = String(itemRows[i][0] || '').trim();
      if (!itemId) continue;
      itemsCount++;
      var qty = Math.round(Number(itemRows[i][6] || 0) * 1000) / 1000;
      prePerItem[itemId] = qty;
      preTotal = Math.round((preTotal + qty) * 1000) / 1000;

      var key = itemId + '::' + mainWh.id;
      if (existingStockMap[key] === undefined) {
        rowsToAppend.push([itemId, mainWh.id, qty, now]);
        existingStockMap[key] = qty;
      }
    }

    if (rowsToAppend.length > 0) {
      var startRow = sWhStocks.getLastRow() + 1;
      sWhStocks.getRange(startRow, 1, rowsToAppend.length, 4).setValues(rowsToAppend);
    }

    // التحقق أن المجموع لكل صنف والمجموع العام لم يتغير
    var postTotal = 0;
    var updatedWhRows = (sWhStocks && sWhStocks.getLastRow() > 1) ? sWhStocks.getDataRange().getValues() : [];
    var sumByItem = {};
    for (var u = 1; u < updatedWhRows.length; u++) {
      var uItem = String(updatedWhRows[u][0] || '').trim();
      if (!uItem) continue;
      sumByItem[uItem] = Math.round(((sumByItem[uItem] || 0) + Number(updatedWhRows[u][2] || 0)) * 1000) / 1000;
    }

    for (var idKey in prePerItem) {
      var computed = Math.round(Number(sumByItem[idKey] || 0) * 1000) / 1000;
      postTotal = Math.round((postTotal + computed) * 1000) / 1000;
    }

    var verifiedExactMatch = Math.abs(postTotal - preTotal) <= 0.0001;
    if (!verifiedExactMatch && rowsToAppend.length > 0) {
      throw new Error('فشل التحقق من مجموع المخزون بعد الترحيل: قبل ' + preTotal + ' وبعد ' + postTotal);
    }

    var report = {
      completed: true,
      migratedAt: now,
      mainWarehouseId: mainWh.id,
      itemsMigratedCount: itemsCount,
      preMigrationTotalStock: preTotal,
      postMigrationTotalStock: postTotal,
      verifiedExactMatch: true
    };

    if (migrationRowIdx !== -1) {
      sSet.getRange(migrationRowIdx, 2, 1, 2).setValues([[JSON.stringify(report), now]]);
    } else {
      sSet.appendRow([WAREHOUSE_MIGRATION_SETTING_KEY_GS, JSON.stringify(report), now]);
    }

    if (optLog && Array.isArray(optLog)) {
      optLog.push('تم ترحيل أرصدة الأصناف إلى المخزن الرئيسي والتحقق من تطابق الإجمالي (' + postTotal + ').');
    }

    return report;
  });
}

function getWarehouseMigrationStatusGS() {
  var res = migrateItemStocksToMainWarehouseOnceGS();
  return {
    success: true,
    status: res
  };
}

function syncUserWarehousesRowsGS(ss, userId, warehouseConfig, nowIso) {
  var uid = String(userId || '').trim();
  if (!uid || !warehouseConfig || typeof warehouseConfig !== 'object') return;
  var now = nowIso || new Date().toISOString();
  var allowedIds = Array.isArray(warehouseConfig.allowedWarehouseIds)
    ? warehouseConfig.allowedWarehouseIds.map(function(x) { return String(x || '').trim(); }).filter(Boolean)
    : [];
  var defId = warehouseConfig.defaultWarehouseId ? String(warehouseConfig.defaultWarehouseId).trim() : '';
  var sheet = ensureSheetWithHeaders(ss, SHEETS.USER_WAREHOUSES, USER_WAREHOUSES_HEADERS_GS);
  var data = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === uid) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[JSON.stringify(allowedIds), defId, now]]);
      return;
    }
  }
  sheet.appendRow([uid, JSON.stringify(allowedIds), defId, now]);
}

function normalizePhoneForCompare(value) {
  if (value === null || value === undefined) return '';
  var cleaned = String(value).replace(/\s+/g, '').toLowerCase();
  if (!cleaned) return '';
  var digits = cleaned.replace(/\D/g, '');
  if (digits.length >= 7) {
    if (digits.indexOf('0020') === 0) {
      return '0' + digits.slice(4);
    }
    if (digits.indexOf('20') === 0) {
      return '0' + digits.slice(2);
    }
    return digits;
  }
  return cleaned;
}

function findUserRowForWarehouseSessionGS(ss, session) {
  if (!session) return null;
  var sUsers = ss.getSheetByName(SHEETS.USERS);
  if (!sUsers || sUsers.getLastRow() <= 1) return null;
  var hUsers = getHeaderMap(sUsers);
  var colId = hUsers.get('ID', 0);
  var colUsername = hUsers.get('اسم المستخدم', 1);
  var colPhone = hUsers.get('رقم الهاتف', 10);
  var uData = sUsers.getDataRange().getValues();
  var targetId = String(session.userId || session.id || '').trim();
  var targetPhone = normalizePhoneForCompare(session.phone || session.username || '');

  for (var i = 1; i < uData.length; i++) {
    var row = uData[i];
    var rId = String(colVal(row, colId, '')).trim();
    var rUser = String(colVal(row, colUsername, '')).trim();
    var rPhone = String(colVal(row, colPhone, '')).trim();
    if (targetId && rId === targetId) {
      return { rowIndex: i + 1, row: row, headerMap: hUsers };
    }
    if (targetPhone && (normalizePhoneForCompare(rPhone) === targetPhone || normalizePhoneForCompare(rUser) === targetPhone)) {
      return { rowIndex: i + 1, row: row, headerMap: hUsers };
    }
  }
  return null;
}

function getUserWarehouseConfigInternalGS(ss, userId, optUserRow) {
  var uid = String(userId || '').trim();
  if (!uid) return undefined;

  var sUw = ss.getSheetByName(SHEETS.USER_WAREHOUSES);
  if (sUw && sUw.getLastRow() > 1) {
    var uwData = sUw.getDataRange().getValues();
    for (var i = 1; i < uwData.length; i++) {
      if (String(uwData[i][0] || '').trim() === uid) {
        var allowed = [];
        try {
          allowed = JSON.parse(String(uwData[i][1] || '[]'));
          if (!Array.isArray(allowed)) allowed = [];
        } catch (_) {
          allowed = [];
        }
        var defId = String(uwData[i][2] || '').trim();
        var cfg = { allowedWarehouseIds: allowed };
        if (defId) cfg.defaultWarehouseId = defId;
        return cfg;
      }
    }
  }

  var uRow = optUserRow;
  if (!uRow) {
    var sUsers = ss.getSheetByName(SHEETS.USERS);
    if (sUsers && sUsers.getLastRow() > 1) {
      var uData = sUsers.getDataRange().getValues();
      for (var r = 1; r < uData.length; r++) {
        if (String(uData[r][0] || '').trim() === uid) {
          uRow = uData[r];
          break;
        }
      }
    }
  }

  if (uRow && uRow[17]) {
    try {
      var parsed = JSON.parse(String(uRow[17]));
      if (parsed && typeof parsed === 'object') {
        return {
          allowedWarehouseIds: Array.isArray(parsed.allowedWarehouseIds) ? parsed.allowedWarehouseIds : [],
          defaultWarehouseId: parsed.defaultWarehouseId ? String(parsed.defaultWarehouseId).trim() : undefined
        };
      }
    } catch (_) {}
  }

  return undefined;
}

function getAllowedWarehouseIdsForSessionGS(ss, session) {
  if (!session) return WAREHOUSE_ALL_TOKEN_GS;
  if (session.role === 'designer' || session.role === 'manager' || session.role === 'general_manager' || Boolean(session.isOwner)) {
    return WAREHOUSE_ALL_TOKEN_GS;
  }
  var userEntry = findUserRowForWarehouseSessionGS(ss, session);
  var whLookup = getWarehouseLookupMapGS(ss);
  if (!userEntry) {
    return [whLookup.defaultId];
  }
  var uRow = userEntry.row;
  var sUsers = ss.getSheetByName(SHEETS.USERS);
  var hUsers = userEntry.headerMap || (sUsers ? getHeaderMap(sUsers) : { get: function(_name, fallbackIdx) { return fallbackIdx !== undefined ? fallbackIdx : -1; } });
  var colId = hUsers.get('ID', 0);
  var colRole = hUsers.get('الدور', 3);
  var colIsOwner = hUsers.get('isOwner', 9);
  var role = String(colVal(uRow, colRole, '')).trim();
  var rawOwner = colVal(uRow, colIsOwner, false);
  var isOwner = rawOwner === true || String(rawOwner).toLowerCase() === 'true';
  if (role === 'designer' || role === 'manager' || role === 'general_manager' || isOwner) {
    return WAREHOUSE_ALL_TOKEN_GS;
  }
  var cfg = getUserWarehouseConfigInternalGS(ss, String(colVal(uRow, colId, '')), uRow);
  if (!cfg) {
    return [whLookup.defaultId];
  }
  return Array.isArray(cfg.allowedWarehouseIds) ? cfg.allowedWarehouseIds : [];
}

function resolveWarehouseForOperationGS(ss, requestedWarehouseIdOrName, session, options) {
  var opts = options || {};
  var requireActive = opts.requireActive !== false;
  var enforceUserAccess = opts.enforceUserAccess !== false;
  var rawReq = String(requestedWarehouseIdOrName || '').trim();
  var allowed = getAllowedWarehouseIdsForSessionGS(ss, session);
  var whLookup = getWarehouseLookupMapGS(ss);
  var warehousesList = whLookup.list;
  var defaultWh = whLookup.byId[whLookup.defaultId] || warehousesList[0];

  var userEntry = findUserRowForWarehouseSessionGS(ss, session);
  var userCfg = userEntry ? getUserWarehouseConfigInternalGS(ss, String(userEntry.row[0] || ''), userEntry.row) : undefined;

  var chosen = null;

  if (rawReq && rawReq.toUpperCase() !== WAREHOUSE_ALL_TOKEN_GS) {
    var normReq = normalizeWarehouseNameGS(rawReq);
    for (var i = 0; i < warehousesList.length; i++) {
      var w = warehousesList[i];
      if (w.id === rawReq || normalizeWarehouseNameGS(w.name) === normReq) {
        chosen = w;
        break;
      }
    }
    if (!chosen) {
      return { ok: false, statusCode: 400, error: 'المخزن المحدد غير مسجل بالنظام' };
    }
    if (enforceUserAccess && allowed !== WAREHOUSE_ALL_TOKEN_GS && allowed.indexOf(chosen.id) === -1) {
      return { ok: false, statusCode: 403, error: 'غير مصرح: المخزن "' + chosen.name + '" غير مسموح لك' };
    }
    if (requireActive && !isWarehouseActiveGS(chosen)) {
      return { ok: false, statusCode: 400, error: 'المخزن "' + chosen.name + '" موقوف ولا يمكن إجراء حركات عليه' };
    }
    return { ok: true, warehouse: chosen };
  }

  if (enforceUserAccess && allowed !== WAREHOUSE_ALL_TOKEN_GS) {
    if (allowed.length === 0) {
      if (opts.allowFallbackWhenOmitted) {
        return { ok: true, warehouse: defaultWh };
      }
      return { ok: false, statusCode: 403, error: 'غير مصرح: لم يتم تعيين أي مخزن مسموح لحسابك' };
    }
    if (allowed.length === 1) {
      chosen = whLookup.byId[allowed[0]] || null;
      if (!chosen) {
        return { ok: false, statusCode: 400, error: 'المخزن المعيّن لحسابك غير موجود بالنظام' };
      }
      if (requireActive && !isWarehouseActiveGS(chosen)) {
        return { ok: false, statusCode: 400, error: 'المخزن "' + chosen.name + '" موقوف ولا يمكن إجراء حركات عليه' };
      }
      return { ok: true, warehouse: chosen };
    }

    var candidateIds = [];
    if (opts.fallbackWarehouseId) candidateIds.push(String(opts.fallbackWarehouseId).trim());
    if (userCfg && userCfg.defaultWarehouseId) candidateIds.push(String(userCfg.defaultWarehouseId).trim());

    for (var c = 0; c < candidateIds.length; c++) {
      var cId = candidateIds[c];
      if (cId && allowed.indexOf(cId) !== -1) {
        var cand = whLookup.byId[cId];
        if (cand && (!requireActive || isWarehouseActiveGS(cand))) {
          return { ok: true, warehouse: cand };
        }
      }
    }

    if (opts.allowFallbackWhenOmitted) {
      for (var a = 0; a < allowed.length; a++) {
        var aw = whLookup.byId[allowed[a]];
        if (aw && (!requireActive || isWarehouseActiveGS(aw))) {
          return { ok: true, warehouse: aw };
        }
      }
      return { ok: true, warehouse: defaultWh };
    }

    return { ok: false, statusCode: 400, error: 'يرجى تحديد المخزن لإتمام العملية' };
  }

  if (opts.fallbackWarehouseId) {
    var fb = whLookup.byId[String(opts.fallbackWarehouseId).trim()];
    if (fb && (!requireActive || isWarehouseActiveGS(fb))) {
      return { ok: true, warehouse: fb };
    }
  }
  if (userCfg && userCfg.defaultWarehouseId) {
    var uDef = whLookup.byId[String(userCfg.defaultWarehouseId).trim()];
    if (uDef && (!requireActive || isWarehouseActiveGS(uDef))) {
      return { ok: true, warehouse: uDef };
    }
  }
  if (requireActive && !isWarehouseActiveGS(defaultWh)) {
    for (var k = 0; k < warehousesList.length; k++) {
      if (isWarehouseActiveGS(warehousesList[k])) {
        return { ok: true, warehouse: warehousesList[k] };
      }
    }
    return { ok: false, statusCode: 400, error: 'لا يوجد أي مخزن نشط متاح بالنظام' };
  }
  return { ok: true, warehouse: defaultWh };
}

function getWarehousesDataGS(session) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  migrateItemStocksToMainWarehouseOnceGS();
  var all = getRawWarehousesListGS(ss);
  var allowed = getAllowedWarehouseIdsForSessionGS(ss, session);
  var filtered = allowed === WAREHOUSE_ALL_TOKEN_GS
    ? all
    : all.filter(function(w) { return allowed.indexOf(w.id) !== -1; });

  return {
    success: true,
    data: filtered.map(function(w) {
      return {
        id: w.id,
        name: w.name,
        status: w.status,
        isDefault: w.isDefault,
        notes: w.notes || '',
        createdAt: w.createdAt || '',
        updatedAt: w.updatedAt || ''
      };
    })
  };
}

function saveWarehouseDataGS(payload, session) {
  if (!hasSessionPermGS(session, 'warehouses.manage')) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية إدارة المخازن [warehouses.manage]'
    };
  }

  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var sheet = ensureSheetWithHeaders(ss, SHEETS.WAREHOUSES, WAREHOUSES_HEADERS_GS);
    var list = getRawWarehousesListGS(ss);

    var id = payload && payload.id ? String(payload.id).trim() : '';
    var existing = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        existing = list[i];
        break;
      }
    }
    if (id && !existing) {
      return { success: false, statusCode: 404, error: 'المخزن المطلوب تعديله غير موجود' };
    }

    var rawName = (payload && payload.name !== undefined) ? String(payload.name) : (existing ? existing.name : '');
    var cleanName = rawName.trim().replace(/\s+/g, ' ');
    var normName = normalizeWarehouseNameGS(cleanName);
    if (!normName) {
      return { success: false, statusCode: 400, error: 'اسم المخزن مطلوب' };
    }

    for (var j = 0; j < list.length; j++) {
      if (list[j].id !== id && normalizeWarehouseNameGS(list[j].name) === normName) {
        return { success: false, statusCode: 400, error: 'يوجد مخزن مسجل بالفعل باسم "' + cleanName + '"' };
      }
    }

    var rawStatus = (payload && payload.status !== undefined) ? String(payload.status).trim() : (existing ? existing.status : 'نشط');
    var nextStatus = normalizeWarehouseStatusGS(rawStatus);
    var nextIsDefault = (payload && payload.isDefault !== undefined) ? Boolean(payload.isDefault) : Boolean(existing && existing.isDefault);

    if (existing && existing.isDefault && payload && payload.isDefault === false) {
      return {
        success: false,
        statusCode: 400,
        error: 'يجب أن يظل هناك مخزن افتراضي واحد على الأقل، اختر مخزناً آخر كافتراضي أولاً'
      };
    }

    if (nextIsDefault && nextStatus === 'موقوف') {
      return {
        success: false,
        statusCode: 400,
        error: 'لا يمكن إيقاف المخزن الافتراضي الرئيسي قبل تعيين مخزن افتراضي آخر'
      };
    }

    var now = new Date().toISOString();
    var savedId = existing
      ? existing.id
      : (id || ('wh-' + Date.now().toString(36) + '-' + Math.floor(100 + Math.random() * 900)));
    var savedNotes = (payload && payload.notes !== undefined) ? String(payload.notes).trim() : (existing ? (existing.notes || '') : '');
    var savedCreatedAt = existing && existing.createdAt ? existing.createdAt : now;

    if (nextIsDefault) {
      for (var k = 0; k < list.length; k++) {
        if (list[k].id !== savedId && list[k].isDefault) {
          sheet.getRange(list[k].sheetRow, 4).setValue(false);
        }
      }
    }

    var rowVals = [savedId, cleanName, nextStatus, nextIsDefault, savedNotes, savedCreatedAt, now];
    if (existing) {
      sheet.getRange(existing.sheetRow, 1, 1, 7).setValues([rowVals]);
      if (existing.name !== cleanName) {
        var sDisp = ss.getSheetByName(SHEETS.WAREHOUSE_DISPATCH_ORDERS);
        if (sDisp && sDisp.getLastRow() > 1) {
          var dRows = sDisp.getDataRange().getValues();
          for (var dr = 1; dr < dRows.length; dr++) {
            if (String(dRows[dr][3] || '').trim() === savedId) {
              sDisp.getRange(dr + 1, 5).setValue(cleanName);
            }
            if (String(dRows[dr][5] || '').trim() === savedId) {
              sDisp.getRange(dr + 1, 7).setValue(cleanName);
            }
          }
        }
      }
      logAudit(session, 'WAREHOUSE_UPDATE', 'Warehouse', savedId, 'تعديل بيانات المخزن: ' + cleanName + ' (' + nextStatus + ')');
    } else {
      sheet.appendRow(rowVals);
      logAudit(session, 'WAREHOUSE_CREATE', 'Warehouse', savedId, 'إنشاء مخزن جديد: ' + cleanName);
    }

    return {
      success: true,
      warehouse: {
        id: savedId,
        name: cleanName,
        status: nextStatus,
        isDefault: nextIsDefault,
        notes: savedNotes,
        createdAt: savedCreatedAt,
        updatedAt: now
      }
    };
  });
}

function deleteWarehouseDataGS(warehouseId, session) {
  if (!hasSessionPermGS(session, 'warehouses.manage')) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية إدارة المخازن [warehouses.manage]'
    };
  }

  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var targetId = String(warehouseId || '').trim();
    var list = getRawWarehousesListGS(ss);
    var target = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === targetId) {
        target = list[i];
        break;
      }
    }
    if (!target) {
      return { success: false, statusCode: 404, error: 'المخزن غير موجود' };
    }
    if (target.isDefault || target.id === MAIN_WAREHOUSE_ID_GS) {
      return { success: false, statusCode: 400, error: 'لا يمكن حذف المخزن الافتراضي الرئيسي، يمكن تعديله فقط' };
    }

    var sWhStocks = ss.getSheetByName(SHEETS.WAREHOUSE_STOCKS);
    var whStRows = (sWhStocks && sWhStocks.getLastRow() > 1) ? sWhStocks.getDataRange().getValues() : [];
    var zeroStockRowsToDelete = [];
    for (var ws = 1; ws < whStRows.length; ws++) {
      if (String(whStRows[ws][1] || '').trim() === targetId) {
        var q = Number(whStRows[ws][2] || 0);
        if (Math.abs(q) > 0.0001) {
          return {
            success: false,
            statusCode: 400,
            error: 'لا يمكن حذف المخزن "' + target.name + '" لوجود أرصدة أصناف بداخله، يمكنك إيقافه فقط'
          };
        }
        zeroStockRowsToDelete.push(ws + 1);
      }
    }

    function sheetHasWarehouseRef(sheetName, colIdx) {
      var sh = ss.getSheetByName(sheetName);
      if (!sh || sh.getLastRow() <= 1) return false;
      var d = sh.getDataRange().getValues();
      for (var r = 1; r < d.length; r++) {
        if (String(d[r][colIdx] || '').trim() === targetId) return true;
      }
      return false;
    }

    var hasMovements =
      sheetHasWarehouseRef(SHEETS.STOCK_MOVEMENTS, 11) ||
      sheetHasWarehouseRef(SHEETS.INVOICES, 24) ||
      sheetHasWarehouseRef(SHEETS.PURCHASES, 12) ||
      sheetHasWarehouseRef(SHEETS.RETURNS, 10) ||
      sheetHasWarehouseRef(SHEETS.PURCHASE_RETURNS, 8) ||
      sheetHasWarehouseRef(SHEETS.WAREHOUSE_DISPATCH_ORDERS, 3) ||
      sheetHasWarehouseRef(SHEETS.WAREHOUSE_DISPATCH_ORDERS, 5);

    if (hasMovements) {
      return {
        success: false,
        statusCode: 400,
        error: 'لا يمكن حذف المخزن "' + target.name + '" لوجود حركات أو مستندات مسجلة عليه، يمكنك إيقافه فقط'
      };
    }

    var sWh = ss.getSheetByName(SHEETS.WAREHOUSES);
    if (sWh) {
      sWh.deleteRow(target.sheetRow);
    }
    if (zeroStockRowsToDelete.length > 0 && sWhStocks) {
      deleteRowsDescendingBatch(sWhStocks, zeroStockRowsToDelete);
    }

    // تنظيف صلاحيات المستخدمين المرتبطة بهذا المخزن
    var sUw = ss.getSheetByName(SHEETS.USER_WAREHOUSES);
    if (sUw && sUw.getLastRow() > 1) {
      var uwData = sUw.getDataRange().getValues();
      var now = new Date().toISOString();
      for (var u = 1; u < uwData.length; u++) {
        var allowed = [];
        try {
          allowed = JSON.parse(String(uwData[u][1] || '[]'));
          if (!Array.isArray(allowed)) allowed = [];
        } catch (_) {
          allowed = [];
        }
        var nextAllowed = allowed.filter(function(x) { return String(x) !== targetId; });
        var curDef = String(uwData[u][2] || '').trim();
        var nextDef = curDef === targetId ? (nextAllowed[0] || '') : curDef;
        if (nextAllowed.length !== allowed.length || nextDef !== curDef) {
          sUw.getRange(u + 1, 2, 1, 3).setValues([[JSON.stringify(nextAllowed), nextDef, now]]);
        }
      }
    }

    logAudit(session, 'WAREHOUSE_DELETE', 'Warehouse', targetId, 'حذف المخزن: ' + target.name);
    return { success: true };
  });
}

function getItemWarehousesDataGS(itemId, session) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  migrateItemStocksToMainWarehouseOnceGS();
  var targetId = String(itemId || '').trim();
  var sItems = ss.getSheetByName(SHEETS.ITEMS);
  if (!sItems || sItems.getLastRow() <= 1) {
    return { success: false, statusCode: 404, error: 'الصنف غير موجود' };
  }
  var iData = sItems.getDataRange().getValues();
  var foundItem = null;
  for (var i = 1; i < iData.length; i++) {
    if (String(iData[i][0] || '').trim() === targetId) {
      foundItem = {
        id: targetId,
        name: String(iData[i][1] || ''),
        stockQuantity: Number(iData[i][6] || 0)
      };
      break;
    }
  }
  if (!foundItem) {
    return { success: false, statusCode: 404, error: 'الصنف غير موجود' };
  }

  var allWarehouses = getRawWarehousesListGS(ss);
  var allowed = getAllowedWarehouseIdsForSessionGS(ss, session);
  var visibleWarehouses = allowed === WAREHOUSE_ALL_TOKEN_GS
    ? allWarehouses
    : allWarehouses.filter(function(w) { return allowed.indexOf(w.id) !== -1; });

  var totalStock = recomputeItemTotalStockGS(ss, targetId, null);

  return {
    success: true,
    itemId: foundItem.id,
    itemName: foundItem.name,
    totalStockQuantity: totalStock,
    warehouses: visibleWarehouses.map(function(w) {
      return {
        warehouseId: w.id,
        warehouseName: w.name,
        status: w.status,
        isDefault: w.isDefault,
        quantity: getItemWarehouseStockGS(ss, foundItem.id, w.id)
      };
    })
  };
}

function getUserWarehousesDataGS(userId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  migrateItemStocksToMainWarehouseOnceGS();
  var uid = String(userId || '').trim();
  var sUsers = ss.getSheetByName(SHEETS.USERS);
  if (!sUsers || sUsers.getLastRow() <= 1) {
    return { success: false, statusCode: 404, error: 'المستخدم غير موجود' };
  }
  var uData = sUsers.getDataRange().getValues();
  var userRow = null;
  for (var i = 1; i < uData.length; i++) {
    if (String(uData[i][0] || '').trim() === uid) {
      userRow = uData[i];
      break;
    }
  }
  if (!userRow) {
    return { success: false, statusCode: 404, error: 'المستخدم غير موجود' };
  }

  var role = String(userRow[5] || '').trim();
  var isOwner = userRow[8] === true || String(userRow[8]).toLowerCase() === 'true';
  var seesAll = role === 'designer' || role === 'manager' || role === 'general_manager' || isOwner;
  var allWh = getRawWarehousesListGS(ss);
  var cfg = getUserWarehouseConfigInternalGS(ss, uid, userRow);
  var allowedIds = seesAll
    ? allWh.map(function(w) { return w.id; })
    : (cfg && Array.isArray(cfg.allowedWarehouseIds) ? cfg.allowedWarehouseIds : []);
  var defWhId = cfg && cfg.defaultWarehouseId ? cfg.defaultWarehouseId : undefined;

  return {
    success: true,
    userId: uid,
    role: role,
    seesAllWarehouses: seesAll,
    warehouseConfig: {
      allowedWarehouseIds: allowedIds,
      defaultWarehouseId: defWhId
    },
    warehouses: allWh
      .filter(function(w) { return allowedIds.indexOf(w.id) !== -1; })
      .map(function(w) {
        return {
          id: w.id,
          name: w.name,
          status: w.status,
          isDefault: w.isDefault,
          notes: w.notes || '',
          createdAt: w.createdAt || '',
          updatedAt: w.updatedAt || ''
        };
      })
  };
}

function saveUserWarehousesDataGS(userId, config, session) {
  return withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var uid = String(userId || '').trim();
    var sUsers = ss.getSheetByName(SHEETS.USERS);
    if (!sUsers || sUsers.getLastRow() <= 1) {
      return { success: false, statusCode: 404, error: 'المستخدم غير موجود' };
    }
    var uData = sUsers.getDataRange().getValues();
    var userRowIdx = -1;
    var userRow = null;
    for (var i = 1; i < uData.length; i++) {
      if (String(uData[i][0] || '').trim() === uid) {
        userRowIdx = i + 1;
        userRow = uData[i];
        break;
      }
    }
    if (!userRow) {
      return { success: false, statusCode: 404, error: 'المستخدم غير موجود' };
    }

    var targetRole = String(userRow[5] || '').trim();
    var targetIsOwner = userRow[8] === true || String(userRow[8]).toLowerCase() === 'true';
    var actorIsDesigner = session && (session.role === 'designer' || Boolean(session.isOwner));
    if ((targetRole === 'designer' || targetIsOwner) && !actorIsDesigner) {
      return {
        success: false,
        statusCode: 403,
        error: 'غير مصرح: لا يمكن تعديل إعدادات مالك ومصمم النظام إلا من قِبل مالك النظام'
      };
    }

    var whLookup = getWarehouseLookupMapGS(ss);
    var rawAllowed = (config && Array.isArray(config.allowedWarehouseIds)) ? config.allowedWarehouseIds : [];
    var uniqueAllowed = [];
    var seen = {};
    for (var a = 0; a < rawAllowed.length; a++) {
      var wid = String(rawAllowed[a] || '').trim();
      if (wid && !seen[wid]) {
        seen[wid] = true;
        uniqueAllowed.push(wid);
      }
    }

    for (var c = 0; c < uniqueAllowed.length; c++) {
      if (!whLookup.byId[uniqueAllowed[c]]) {
        return { success: false, statusCode: 400, error: 'المخزن غير موجود بالنظام: ' + uniqueAllowed[c] };
      }
    }

    var defaultWarehouseId = (config && config.defaultWarehouseId) ? String(config.defaultWarehouseId).trim() : '';
    if (defaultWarehouseId) {
      if (!whLookup.byId[defaultWarehouseId]) {
        return { success: false, statusCode: 400, error: 'المخزن الافتراضي المحدد غير موجود بالنظام' };
      }
      var isTargetAll = targetRole === 'designer' || targetRole === 'manager' || targetRole === 'general_manager' || targetIsOwner;
      if (!isTargetAll && uniqueAllowed.indexOf(defaultWarehouseId) === -1) {
        return {
          success: false,
          statusCode: 400,
          error: 'المخزن الافتراضي يجب أن يكون ضمن قائمة المخازن المسموحة للمستخدم'
        };
      }
    } else if (uniqueAllowed.length === 1) {
      defaultWarehouseId = uniqueAllowed[0];
    }

    var nextConfig = {
      allowedWarehouseIds: uniqueAllowed
    };
    if (defaultWarehouseId) {
      nextConfig.defaultWarehouseId = defaultWarehouseId;
    }

    var now = new Date().toISOString();
    sUsers.getRange(userRowIdx, 18).setValue(JSON.stringify(nextConfig));
    syncUserWarehousesRowsGS(ss, uid, nextConfig, now);

    logAudit(
      session,
      'USER_WAREHOUSE_ASSIGN',
      'User',
      uid,
      'تحديث المخازن المسموحة للمستخدم (' + String(userRow[1] || '') + '): [' + uniqueAllowed.join(', ') + '] | الافتراضي: ' + (defaultWarehouseId || 'بدون')
    );

    return {
      success: true,
      warehouseConfig: nextConfig
    };
  });
}

function canSessionTransferWarehousesGS(session) {
  return hasSessionPermGS(session, 'warehouses.transfer');
}

function canSessionViewWarehouseTransfersGS(session) {
  return hasSessionPermGS(session, 'warehouses.transfer') || hasSessionPermGS(session, 'warehouses.view');
}

function sanitizeWarehouseTransferOrderGS(order, canViewPurchase) {
  var lines = (order.lines || []).map(function(l) {
    var lineCopy = {
      itemId: l.itemId,
      itemName: l.itemName,
      barcode: l.barcode || '',
      sku: l.sku || '',
      notes: l.notes || '',
      unit: l.unit || 'قطعة',
      quantity: Number(l.quantity || 0),
      fromStockBefore: l.fromStockBefore,
      fromStockAfter: l.fromStockAfter,
      toStockBefore: l.toStockBefore,
      toStockAfter: l.toStockAfter
    };
    if (canViewPurchase) {
      lineCopy.purchasePriceAtTransfer = Number(l.purchasePriceAtTransfer || 0);
      lineCopy.lineTotalPurchase = Number(l.lineTotalPurchase || 0);
    }
    return lineCopy;
  });

  var orderCopy = {
    id: order.id,
    dispatchNumber: order.dispatchNumber,
    date: order.date,
    fromWarehouseId: order.fromWarehouseId,
    fromWarehouseName: order.fromWarehouseName,
    toWarehouseId: order.toWarehouseId,
    toWarehouseName: order.toWarehouseName,
    userId: order.userId,
    userName: order.userName,
    itemsCount: Number(order.itemsCount || lines.length),
    totalQuantity: Number(order.totalQuantity || 0),
    notes: order.notes || undefined,
    idempotencyKey: order.idempotencyKey || '',
    lines: lines
  };
  if (canViewPurchase) {
    orderCopy.totalPurchaseValue = Number(order.totalPurchaseValue || 0);
  }
  return orderCopy;
}

function getStockSettingsObjectGS(ss) {
  var settings = getSettingsMap(ss);
  return Object.assign(
    {
      allowNegativeStock: false,
      allowNegativeWarehouseTransfer: false,
      deductStockOnCreate: true
    },
    settings.stockSettings || {}
  );
}

function getWarehouseTransferContextGS(session) {
  if (!canSessionViewWarehouseTransfersGS(session)) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية عرض أو تنفيذ التحويلات بين المخازن'
    };
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  migrateItemStocksToMainWarehouseOnceGS();
  var allWh = getRawWarehousesListGS(ss).map(function(w) {
    return {
      id: w.id,
      name: w.name,
      status: w.status,
      isDefault: w.isDefault,
      notes: w.notes || '',
      createdAt: w.createdAt || '',
      updatedAt: w.updatedAt || ''
    };
  });
  var activeWh = allWh.filter(function(w) { return isWarehouseActiveGS(w); });
  var allowed = getAllowedWarehouseIdsForSessionGS(ss, session);
  var sourceWh = allowed === WAREHOUSE_ALL_TOKEN_GS
    ? activeWh
    : activeWh.filter(function(w) { return allowed.indexOf(w.id) !== -1; });

  return {
    success: true,
    sourceWarehouses: sourceWh,
    targetWarehouses: activeWh,
    allWarehouses: allWh,
    stockSettings: getStockSettingsObjectGS(ss)
  };
}

function getWarehouseTransferStocksGS(params, session) {
  if (!canSessionViewWarehouseTransfersGS(session)) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية التحويل بين المخازن'
    };
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  migrateItemStocksToMainWarehouseOnceGS();
  var whLookup = getWarehouseLookupMapGS(ss);

  var fromWarehouseId = String((params && params.fromWarehouseId) || '').trim();
  var toWarehouseId = String((params && params.toWarehouseId) || '').trim();

  if (!fromWarehouseId || !whLookup.byId[fromWarehouseId]) {
    return { success: false, statusCode: 400, error: 'المخزن المحوِّل غير موجود' };
  }
  if (toWarehouseId && !whLookup.byId[toWarehouseId]) {
    return { success: false, statusCode: 400, error: 'المخزن المحوَّل إليه غير موجود' };
  }

  var allowed = getAllowedWarehouseIdsForSessionGS(ss, session);
  if (allowed !== WAREHOUSE_ALL_TOKEN_GS && allowed.indexOf(fromWarehouseId) === -1) {
    return { success: false, statusCode: 403, error: 'غير مصرح: المخزن المحوِّل غير مسموح لحسابك' };
  }

  var targetIds = (params && Array.isArray(params.itemIds) && params.itemIds.length > 0)
    ? params.itemIds
    : null;

  if (!targetIds) {
    targetIds = [];
    var sItems = ss.getSheetByName(SHEETS.ITEMS);
    if (sItems && sItems.getLastRow() > 1) {
      var iRows = sItems.getDataRange().getValues();
      for (var i = 1; i < iRows.length; i++) {
        var iid = String(iRows[i][0] || '').trim();
        if (iid) targetIds.push(iid);
      }
    }
  }

  var sWhSt = ss.getSheetByName(SHEETS.WAREHOUSE_STOCKS);
  var stMap = {};
  if (sWhSt && sWhSt.getLastRow() > 1) {
    var stRows = sWhSt.getDataRange().getValues();
    for (var r = 1; r < stRows.length; r++) {
      var stItem = String(stRows[r][0] || '').trim();
      var stWh = String(stRows[r][1] || '').trim();
      if (stItem && stWh) {
        stMap[stItem + '::' + stWh] = Math.round(Number(stRows[r][2] || 0) * 1000) / 1000;
      }
    }
  }

  var stocks = {};
  for (var t = 0; t < targetIds.length; t++) {
    var itemId = String(targetIds[t] || '').trim();
    if (!itemId) continue;
    stocks[itemId] = {
      fromStock: stMap[itemId + '::' + fromWarehouseId] || 0,
      toStock: toWarehouseId ? (stMap[itemId + '::' + toWarehouseId] || 0) : 0
    };
  }

  return {
    success: true,
    stocks: stocks
  };
}

function readAllDispatchOrdersGS(ss) {
  var sOrders = ss.getSheetByName(SHEETS.WAREHOUSE_DISPATCH_ORDERS);
  if (!sOrders || sOrders.getLastRow() <= 1) return [];
  var oData = sOrders.getDataRange().getValues();

  var sLines = ss.getSheetByName(SHEETS.WAREHOUSE_DISPATCH_ORDER_LINES);
  var lData = (sLines && sLines.getLastRow() > 1) ? sLines.getDataRange().getValues() : [];
  var linesByOrderId = {};
  for (var l = 1; l < lData.length; l++) {
    var lr = lData[l];
    var orderId = String(lr[1] || '').trim();
    if (!orderId) continue;
    if (!linesByOrderId[orderId]) linesByOrderId[orderId] = [];
    linesByOrderId[orderId].push({
      id: String(lr[0] || ''),
      orderId: orderId,
      itemId: String(lr[2] || ''),
      itemName: String(lr[3] || ''),
      barcode: String(lr[4] || ''),
      unit: String(lr[5] || 'قطعة'),
      quantity: Number(lr[6] || 0),
      purchasePriceAtTransfer: Number(lr[7] || 0),
      lineTotalPurchase: Number(lr[8] || 0),
      fromStockBefore: lr[9] !== '' && lr[9] !== undefined ? Number(lr[9]) : undefined,
      fromStockAfter: lr[10] !== '' && lr[10] !== undefined ? Number(lr[10]) : undefined,
      toStockBefore: lr[11] !== '' && lr[11] !== undefined ? Number(lr[11]) : undefined,
      toStockAfter: lr[12] !== '' && lr[12] !== undefined ? Number(lr[12]) : undefined,
      sku: String(lr[13] || ''),
      notes: String(lr[14] || '')
    });
  }

  var orders = [];
  for (var i = oData.length - 1; i >= 1; i--) {
    var r = oData[i];
    var oid = String(r[0] || '').trim();
    if (!oid) continue;
    var oLines = linesByOrderId[oid] || [];
    orders.push({
      id: oid,
      dispatchNumber: String(r[1] || ''),
      date: String(r[2] || ''),
      fromWarehouseId: String(r[3] || ''),
      fromWarehouseName: String(r[4] || ''),
      toWarehouseId: String(r[5] || ''),
      toWarehouseName: String(r[6] || ''),
      itemsCount: Number(r[7] || oLines.length),
      totalQuantity: Number(r[8] || 0),
      totalPurchaseValue: Number(r[9] || 0),
      userId: String(r[10] || ''),
      userName: String(r[11] || ''),
      notes: String(r[12] || '') || undefined,
      createdAt: String(r[13] || ''),
      idempotencyKey: String(r[14] || ''),
      lines: oLines
    });
  }
  return orders;
}

function createWarehouseTransferGS(payload, session) {
  if (!canSessionTransferWarehousesGS(session)) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية التحويل بين المخازن (warehouses.transfer)'
    };
  }

  var lockRes = withScriptLock(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateItemStocksToMainWarehouseOnceGS();
    var canViewPurchase = hasPurchasePricePermGS(session);

    var idemKey = payload && typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey.trim() : '';
    if (!idemKey) {
      return {
        success: false,
        statusCode: 400,
        error: 'مفتاح منع التكرار (idempotencyKey) مطلوب لإتمام عملية التحويل'
      };
    }

    var sOrders = ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_DISPATCH_ORDERS, DISPATCH_ORDERS_HEADERS_GS);
    var sLines = ensureSheetWithHeaders(ss, SHEETS.WAREHOUSE_DISPATCH_ORDER_LINES, DISPATCH_ORDER_LINES_HEADERS_GS);

    var existingOrders = readAllDispatchOrdersGS(ss);
    for (var eo = 0; eo < existingOrders.length; eo++) {
      if (existingOrders[eo].idempotencyKey === idemKey) {
        return {
          success: true,
          duplicate: true,
          order: sanitizeWarehouseTransferOrderGS(existingOrders[eo], canViewPurchase)
        };
      }
    }

    var fromWarehouseId = String((payload && payload.fromWarehouseId) || '').trim();
    var toWarehouseId = String((payload && payload.toWarehouseId) || '').trim();

    if (!fromWarehouseId || !toWarehouseId) {
      return {
        success: false,
        statusCode: 400,
        error: 'يرجى تحديد المخزن المحوِّل والمخزن المحوَّل إليه'
      };
    }

    if (fromWarehouseId === toWarehouseId) {
      return {
        success: false,
        statusCode: 400,
        error: 'لا يمكن التحويل من مخزن إلى نفس المخزن'
      };
    }

    var whLookup = getWarehouseLookupMapGS(ss);
    var fromWh = whLookup.byId[fromWarehouseId];
    var toWh = whLookup.byId[toWarehouseId];
    if (!fromWh || !toWh) {
      return {
        success: false,
        statusCode: 400,
        error: 'أحد المخازن المحددة غير موجود بالنظام'
      };
    }

    if (!isWarehouseActiveGS(fromWh)) {
      return {
        success: false,
        statusCode: 400,
        error: 'المخزن "' + fromWh.name + '" موقوف ولا يمكن التحويل منه'
      };
    }

    if (!isWarehouseActiveGS(toWh)) {
      return {
        success: false,
        statusCode: 400,
        error: 'المخزن "' + toWh.name + '" موقوف ولا يمكن التحويل إليه'
      };
    }

    var allowed = getAllowedWarehouseIdsForSessionGS(ss, session);
    if (allowed !== WAREHOUSE_ALL_TOKEN_GS && allowed.indexOf(fromWh.id) === -1) {
      return {
        success: false,
        statusCode: 403,
        error: 'غير مصرح: المخزن "' + fromWh.name + '" غير مسموح لحسابك'
      };
    }

    var rawLines = (payload && Array.isArray(payload.lines)) ? payload.lines : [];
    if (rawLines.length === 0) {
      return {
        success: false,
        statusCode: 400,
        error: 'يرجى إضافة صنف واحد على الأقل لإتمام التحويل'
      };
    }

    var sItems = ss.getSheetByName(SHEETS.ITEMS);
    var iRows = (sItems && sItems.getLastRow() > 1) ? sItems.getDataRange().getValues() : [];
    var itemsById = {};
    for (var ir = 1; ir < iRows.length; ir++) {
      var iid = String(iRows[ir][0] || '').trim();
      if (!iid) continue;
      itemsById[iid] = {
        sheetRow: ir + 1,
        id: iid,
        name: String(iRows[ir][1] || ''),
        purchasePrice: Number(iRows[ir][4] || 0),
        notes: String(iRows[ir][7] || ''),
        barcode: String(iRows[ir][10] || ''),
        sku: String(iRows[ir][14] || ''),
        unit: String(iRows[ir][21] || 'قطعة') || 'قطعة'
      };
    }

    var seenItemIds = {};
    var validatedInputs = [];

    for (var lIdx = 0; lIdx < rawLines.length; lIdx++) {
      var rawLine = rawLines[lIdx] || {};
      var itemId = String(rawLine.itemId || '').trim();
      if (!itemId) {
        return {
          success: false,
          statusCode: 400,
          error: 'يوجد سطر بدون معرّف صنف صالح'
        };
      }
      if (seenItemIds[itemId]) {
        return {
          success: false,
          statusCode: 400,
          error: 'لا يمكن تكرار نفس الصنف داخل أمر الصرف الواحد'
        };
      }
      seenItemIds[itemId] = true;

      var item = itemsById[itemId];
      if (!item) {
        return {
          success: false,
          statusCode: 400,
          error: 'الصنف غير موجود بالنظام (' + itemId + ')'
        };
      }

      var numQty = Number(rawLine.quantity);
      if (!isFinite(numQty) || isNaN(numQty) || numQty <= 0) {
        return {
          success: false,
          statusCode: 400,
          error: 'الكمية غير صالحة للصنف "' + item.name + '": يجب أن تكون أكبر من صفر'
        };
      }
      var quantity = Math.round(numQty * 1000) / 1000;
      if (quantity <= 0) {
        return {
          success: false,
          statusCode: 400,
          error: 'الكمية غير صالحة للصنف "' + item.name + '": يجب أن تكون أكبر من صفر'
        };
      }

      validatedInputs.push({ item: item, quantity: quantity });
    }

    var stockSettings = getStockSettingsObjectGS(ss);
    var allowNegative = Boolean(stockSettings.allowNegativeWarehouseTransfer);

    if (!allowNegative) {
      var insufficientItems = [];
      for (var v = 0; v < validatedInputs.length; v++) {
        var entryCheck = validatedInputs[v];
        var available = getItemWarehouseStockGS(ss, entryCheck.item.id, fromWh.id);
        if (entryCheck.quantity > available) {
          insufficientItems.push({
            itemId: entryCheck.item.id,
            itemName: entryCheck.item.name,
            requested: entryCheck.quantity,
            available: available
          });
        }
      }
      if (insufficientItems.length > 0) {
        var detailsList = insufficientItems.map(function(it) {
          return it.itemName + ' (المطلوب: ' + it.requested + '، المتاح: ' + it.available + ')';
        }).join(' | ');
        return {
          success: false,
          statusCode: 400,
          error: 'الكمية المطلوبة تتجاوز الرصيد المتاح في مخزن "' + fromWh.name + '": ' + detailsList,
          insufficientItems: insufficientItems
        };
      }
    }

    // توليد رقم أمر الصرف التسلسلي DSP-0001
    var maxSeq = 0;
    for (var s = 0; s < existingOrders.length; s++) {
      var m = String(existingOrders[s].dispatchNumber || '').match(/^DSP-(\d+)$/i);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > maxSeq) maxSeq = n;
      }
    }
    var nextSeq = maxSeq + 1;
    var dispatchNumber = 'DSP-' + String(nextSeq).padStart(4, '0');
    var now = new Date().toISOString();
    var actorName = (session && (session.name || session.phone || session.username)) || 'المستخدم';
    var actorId = (session && (session.userId || session.id)) || '';
    var notes = (payload && payload.notes) ? String(payload.notes).trim() : '';
    var orderId = generateUUID();

    var transferLines = [];
    var lineSheetRows = [];
    var movementSheetRows = [];
    var totalQuantity = 0;
    var totalPurchaseValue = 0;
    var noteSuffix = notes ? (' — ' + notes) : '';

    for (var idx = 0; idx < validatedInputs.length; idx++) {
      var entry = validatedInputs[idx];
      var it = entry.item;
      var qty = entry.quantity;

      var fromRes = adjustItemWarehouseDeltaGS(ss, it.id, fromWh.id, -qty, now);
      var toRes = adjustItemWarehouseDeltaGS(ss, it.id, toWh.id, qty, now);
      recomputeItemTotalStockGS(ss, it.id, sItems);

      var purchasePriceAtTransfer = Math.round(Number(it.purchasePrice || 0) * 100) / 100;
      var lineTotalPurchase = Math.round(purchasePriceAtTransfer * qty * 100) / 100;

      totalQuantity = Math.round((totalQuantity + qty) * 1000) / 1000;
      totalPurchaseValue = Math.round((totalPurchaseValue + lineTotalPurchase) * 100) / 100;

      var lineObj = {
        itemId: it.id,
        itemName: it.name,
        barcode: it.barcode || '',
        sku: it.sku || '',
        notes: it.notes || '',
        unit: it.unit || 'قطعة',
        quantity: qty,
        purchasePriceAtTransfer: purchasePriceAtTransfer,
        lineTotalPurchase: lineTotalPurchase,
        fromStockBefore: fromRes.balanceBefore,
        fromStockAfter: fromRes.balanceAfter,
        toStockBefore: toRes.balanceBefore,
        toStockAfter: toRes.balanceAfter
      };
      transferLines.push(lineObj);

      lineSheetRows.push([
        generateUUID(),
        orderId,
        it.id,
        it.name,
        it.barcode || '',
        it.unit || 'قطعة',
        qty,
        purchasePriceAtTransfer,
        lineTotalPurchase,
        fromRes.balanceBefore,
        fromRes.balanceAfter,
        toRes.balanceBefore,
        toRes.balanceAfter,
        it.sku || '',
        it.notes || ''
      ]);

      movementSheetRows.push([
        generateUUID(),
        it.id,
        it.name,
        'تحويل_صادر',
        qty,
        fromRes.balanceAfter,
        'أمر صرف وتحويل مخزني',
        dispatchNumber,
        actorName,
        now,
        'تحويل صادر من "' + fromWh.name + '" إلى "' + toWh.name + '"' + noteSuffix,
        fromWh.id
      ]);

      movementSheetRows.push([
        generateUUID(),
        it.id,
        it.name,
        'تحويل_وارد',
        qty,
        toRes.balanceAfter,
        'أمر صرف وتحويل مخزني',
        dispatchNumber,
        actorName,
        now,
        'تحويل وارد إلى "' + toWh.name + '" من "' + fromWh.name + '"' + noteSuffix,
        toWh.id
      ]);
    }

    sOrders.appendRow([
      orderId,
      dispatchNumber,
      now,
      fromWh.id,
      fromWh.name,
      toWh.id,
      toWh.name,
      transferLines.length,
      totalQuantity,
      totalPurchaseValue,
      actorId,
      actorName,
      notes,
      now,
      idemKey
    ]);

    if (lineSheetRows.length > 0) {
      var startLineRow = sLines.getLastRow() + 1;
      sLines.getRange(startLineRow, 5, lineSheetRows.length, 1).setNumberFormat('@');
      sLines.getRange(startLineRow, 1, lineSheetRows.length, DISPATCH_ORDER_LINES_HEADERS_GS.length).setValues(lineSheetRows);
    }

    if (movementSheetRows.length > 0) {
      var sMov = ensureSheetWithHeaders(ss, SHEETS.STOCK_MOVEMENTS, [
        'ID', 'ID الصنف', 'اسم الصنف', 'نوع الحركة', 'الكمية', 'الرصيد بعد الحركة',
        'السبب', 'رقم المرجع أو المستند', 'المستخدم', 'التاريخ والوقت', 'ملاحظات', 'warehouseId'
      ]);
      var startMovRow = sMov.getLastRow() + 1;
      sMov.getRange(startMovRow, 1, movementSheetRows.length, 12).setValues(movementSheetRows);
    }

    var order = {
      id: orderId,
      dispatchNumber: dispatchNumber,
      date: now,
      fromWarehouseId: fromWh.id,
      fromWarehouseName: fromWh.name,
      toWarehouseId: toWh.id,
      toWarehouseName: toWh.name,
      userId: actorId,
      userName: actorName,
      itemsCount: transferLines.length,
      totalQuantity: totalQuantity,
      totalPurchaseValue: totalPurchaseValue,
      notes: notes || undefined,
      idempotencyKey: idemKey,
      lines: transferLines
    };

    logAudit(
      session,
      'WAREHOUSE_TRANSFER',
      'WarehouseDispatchOrder',
      dispatchNumber,
      'إنشاء وتنفيذ أمر صرف رقم ' + dispatchNumber + ' من مخزن "' + fromWh.name + '" إلى مخزن "' + toWh.name + '" (' + transferLines.length + ' صنف، إجمالي الكمية: ' + totalQuantity + ')'
    );

    return {
      success: true,
      duplicate: false,
      order: sanitizeWarehouseTransferOrderGS(order, canViewPurchase)
    };
  });

  if (lockRes && lockRes.code === 'BUSY' && lockRes.statusCode === undefined) {
    return {
      success: false,
      statusCode: 409,
      code: 'BUSY',
      error: lockRes.error
    };
  }
  return lockRes;
}

function getWarehouseTransfersGS(filters, session) {
  if (!canSessionViewWarehouseTransfersGS(session)) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية عرض أوامر الصرف والتحويلات المخزنية'
    };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  migrateItemStocksToMainWarehouseOnceGS();
  var canViewPurchase = hasPurchasePricePermGS(session);
  var allowed = getAllowedWarehouseIdsForSessionGS(ss, session);
  var list = readAllDispatchOrdersGS(ss);

  if (allowed !== WAREHOUSE_ALL_TOKEN_GS) {
    list = list.filter(function(o) {
      return allowed.indexOf(o.fromWarehouseId) !== -1 || allowed.indexOf(o.toWarehouseId) !== -1;
    });
  }

  var dispatchQuery = String((filters && (filters.dispatchNumber || filters.q)) || '').trim();
  if (dispatchQuery) {
    var normQ = normalizeArabicTextGS(dispatchQuery);
    list = list.filter(function(o) {
      var hay = normalizeArabicTextGS(
        (o.dispatchNumber || '') + ' ' + (o.fromWarehouseName || '') + ' ' + (o.toWarehouseName || '') + ' ' + (o.userName || '') + ' ' + (o.notes || '')
      );
      return hay.indexOf(normQ) !== -1;
    });
  }

  var fromWhFilter = String((filters && filters.fromWarehouseId) || '').trim();
  if (fromWhFilter && fromWhFilter !== 'ALL') {
    list = list.filter(function(o) { return o.fromWarehouseId === fromWhFilter; });
  }

  var toWhFilter = String((filters && filters.toWarehouseId) || '').trim();
  if (toWhFilter && toWhFilter !== 'ALL') {
    list = list.filter(function(o) { return o.toWarehouseId === toWhFilter; });
  }

  var fromDate = (filters && filters.from) ? toCairoDateStrGS(filters.from) : null;
  var toDate = (filters && filters.to) ? toCairoDateStrGS(filters.to) : null;
  if (fromDate || toDate) {
    list = list.filter(function(o) {
      return isDateInRangeGS(o.date, fromDate, toDate);
    });
  }

  var pageSize = Math.min(100, Math.max(1, Number(filters && filters.pageSize) || 20));
  var total = list.length;
  var totalPages = Math.max(1, Math.ceil(total / pageSize));
  var page = Math.min(totalPages, Math.max(1, Number(filters && filters.page) || 1));
  var start = (page - 1) * pageSize;
  var paged = list.slice(start, start + pageSize);

  return {
    success: true,
    orders: paged.map(function(o) { return sanitizeWarehouseTransferOrderGS(o, canViewPurchase); }),
    total: total,
    page: page,
    pageSize: pageSize,
    totalPages: totalPages
  };
}

function getWarehouseTransferByIdGS(idOrOrderNumber, session) {
  if (!canSessionViewWarehouseTransfersGS(session)) {
    return {
      success: false,
      statusCode: 403,
      error: 'غير مصرح: تفتقر لصلاحية عرض تفاصيل أمر الصرف'
    };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  migrateItemStocksToMainWarehouseOnceGS();
  var key = String(idOrOrderNumber || '').trim();
  var list = readAllDispatchOrdersGS(ss);
  var found = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === key || String(list[i].dispatchNumber || '').toUpperCase() === key.toUpperCase()) {
      found = list[i];
      break;
    }
  }
  if (!found) {
    return { success: false, statusCode: 404, error: 'أمر الصرف غير موجود' };
  }

  var allowed = getAllowedWarehouseIdsForSessionGS(ss, session);
  if (
    allowed !== WAREHOUSE_ALL_TOKEN_GS &&
    allowed.indexOf(found.fromWarehouseId) === -1 &&
    allowed.indexOf(found.toWarehouseId) === -1
  ) {
    return { success: false, statusCode: 403, error: 'غير مصرح لك بعرض أمر الصرف هذا' };
  }

  var canViewPurchase = hasPurchasePricePermGS(session);
  return {
    success: true,
    order: sanitizeWarehouseTransferOrderGS(found, canViewPurchase)
  };
}

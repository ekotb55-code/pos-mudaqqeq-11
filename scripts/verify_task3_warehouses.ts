process.env.SKIP_SERVER_LISTEN = '1';

import type { AddressInfo } from 'node:net';
import { createServerApp } from '../server.ts';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_TEMPLATES
} from '../src/utils/permissions.ts';
import { MAIN_WAREHOUSE_ID } from '../server/mockData.ts';
import {
  getWarehouseMigrationStatus,
  getWarehouses,
  saveWarehouse,
  deleteWarehouse,
  getItemWarehouses,
  getUserWarehouses,
  saveUserWarehouses,
  saveUser,
  saveItem,
  deleteItem,
  getItems,
  getItemsPaginated,
  adjustItemStock,
  createInvoice,
  updateInvoice,
  createReturn,
  createPurchase,
  createPurchaseReturn,
  cancelPurchase,
  getStockAdjustmentsReport,
  getItemMovementReport,
  getItemLogs
} from '../server/sheetsService.ts';
import type { PermissionKey } from '../src/types/index.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

const designerSession = {
  userId: 'user-admin-001',
  id: 'user-admin-001',
  role: 'designer' as const,
  isOwner: true,
  phone: 'admin',
  username: 'admin',
  name: 'المصمم',
  permissions: ALL_PERMISSIONS.map(p => p.key) as PermissionKey[]
};

const managerSession = {
  userId: 'mgr-test-001',
  id: 'mgr-test-001',
  role: 'manager' as const,
  isOwner: false,
  phone: 'manager1',
  username: 'manager1',
  name: 'مدير النظام',
  permissions: ROLE_TEMPLATES.manager as PermissionKey[]
};

async function runTests() {
  console.log('=== Verifying Task 3: Multi-Warehouses (Server In-Memory Mode) ===');

  // 1. الصلاحيات الثلاث الجديدة
  const permKeys = ALL_PERMISSIONS.map(p => p.key);
  const serverPermKeys = PERMISSIONS.map(p => p.key);
  for (const k of ['warehouses.view', 'warehouses.manage', 'warehouses.transfer'] as PermissionKey[]) {
    assert(permKeys.includes(k), `ALL_PERMISSIONS missing ${k}`);
    assert(serverPermKeys.includes(k), `PERMISSIONS missing ${k}`);
    assert(ROLE_TEMPLATES.manager.includes(k), `ROLE_TEMPLATES.manager missing ${k}`);
    assert(ROLE_TEMPLATES.designer.includes(k), `ROLE_TEMPLATES.designer missing ${k}`);
  }
  console.log('1) Permissions check passed.');

  // 2. التحقق من الترحيل الموحد للمخزن الرئيسي عند التشغيل
  const mig = getWarehouseMigrationStatus();
  assert(mig.completed === true, 'Warehouse migration must be marked completed');
  assert(mig.verifiedExactMatch === true, 'Migration stock conservation must verify true');
  assert(mig.mainWarehouseId === MAIN_WAREHOUSE_ID, 'Main warehouse ID mismatch');
  assert(mig.preMigrationTotalStock === mig.postMigrationTotalStock, 'Pre vs Post migration stock total mismatch');
  assert(mig.preMigrationTotalStock > 0, 'Initial mock items total stock should be > 0');

  const initialWarehouses = await getWarehouses(designerSession);
  const mainWh = initialWarehouses.find(w => w.id === MAIN_WAREHOUSE_ID);
  assert(mainWh && mainWh.isDefault === true && mainWh.name === 'المخزن الرئيسي', 'Main default warehouse missing');

  // لا يمكن حذف المخزن الافتراضي الرئيسي
  const delMainRes = await deleteWarehouse(MAIN_WAREHOUSE_ID, designerSession);
  assert(!delMainRes.success && delMainRes.statusCode === 400, 'Deleting default warehouse must fail with 400');

  // تعديل المخزن الرئيسي كمخزن عادي (الملاحظات) مع بقاء اسمه الافتراضي
  const editMainRes = await saveWarehouse({ id: MAIN_WAREHOUSE_ID, notes: 'مخزن الترحيل الرئيسي المعتمد' }, designerSession);
  assert(editMainRes.success && editMainRes.warehouse?.notes === 'مخزن الترحيل الرئيسي المعتمد', 'Main warehouse should be editable like any warehouse');
  console.log('2) Migration & Main warehouse verification passed.');

  // 3. إنشاء مخزن فرعي وفحص تفرد الاسم وحذف المخزن الفارغ النظيف
  const dupWhRes = await saveWarehouse({ name: '  المخزن   الرئيسي ' }, designerSession);
  assert(!dupWhRes.success && dupWhRes.statusCode === 400, 'Duplicate normalized warehouse name must be rejected');

  const branchRes = await saveWarehouse({ name: 'مخزن فرع المعادي', notes: 'فرع المعادي' }, designerSession);
  assert(branchRes.success && branchRes.warehouse && branchRes.warehouse.isDefault === false, 'Failed creating branch warehouse');
  const branchWh = branchRes.warehouse!;

  const cleanEmptyWhRes = await saveWarehouse({ name: 'مخزن مؤقت نظيف' }, designerSession);
  assert(cleanEmptyWhRes.success && cleanEmptyWhRes.warehouse, 'Failed creating clean temporary warehouse');
  const delCleanRes = await deleteWarehouse(cleanEmptyWhRes.warehouse!.id, designerSession);
  assert(delCleanRes.success, 'Clean empty warehouse with zero balance and no movements should be deletable');

  // إنشاء مخزن ثانٍ مستخدم لاختبار رفض الحذف بعد استخدامه حتى لو أصبح رصيده 0
  const usedEmptyWhRes = await saveWarehouse({ name: 'مخزن تجربة الحركات' }, designerSession);
  assert(usedEmptyWhRes.success && usedEmptyWhRes.warehouse, 'Failed creating usedEmptyWh');
  const usedEmptyWh = usedEmptyWhRes.warehouse!;
  console.log('3) Warehouse CRUD, uniqueness & clean deletion passed.');

  // 4. إنشاء صنف جديد واختبار عزل الأرصدة وحساب item.stockQuantity كمجموع
  const itemCreateRes = await saveItem(
    {
      name: 'صنف اختبار المخازن المتعددة',
      barcode: '6229998887771',
      sku: 'WH-TEST-001',
      salePrice: 100,
      purchasePrice: 60,
      packagingCost: 5,
      stockQuantity: 10,
      reorderLimit: 5,
      status: 'نشط'
    },
    designerSession
  );
  assert(itemCreateRes.success && itemCreateRes.item, `Failed creating test item: ${itemCreateRes.error}`);
  const testItemId = itemCreateRes.item!.id;

  // في البداية: 10 في الرئيسي و 0 في المعادي
  let itemWh = await getItemWarehouses(testItemId, designerSession);
  assert(itemWh.success && itemWh.totalStockQuantity === 10, `Expected initial total 10, got ${itemWh.totalStockQuantity}`);
  assert(itemWh.warehouses!.find(w => w.warehouseId === MAIN_WAREHOUSE_ID)?.quantity === 10, 'Main warehouse should have 10');
  assert(itemWh.warehouses!.find(w => w.warehouseId === branchWh.id)?.quantity === 0, 'Branch warehouse should have 0');

  // شراء 15 قطعة وإدخالها إلى مخزن فرع المعادي فقط
  const purRes = await createPurchase(
    {
      idempotencyKey: `pur-wh-test-${Date.now()}`,
      supplierId: 'sup-ank-001',
      warehouseId: branchWh.id,
      paymentType: 'آجل',
      lines: [{ itemId: testItemId, quantity: 15, unitCost: 60 }]
    },
    designerSession
  );
  assert(purRes.success && purRes.invoice?.warehouseId === branchWh.id, `Purchase failed: ${purRes.error}`);

  itemWh = await getItemWarehouses(testItemId, designerSession);
  assert(itemWh.warehouses!.find(w => w.warehouseId === MAIN_WAREHOUSE_ID)?.quantity === 10, 'Main warehouse must remain 10 after branch purchase');
  assert(itemWh.warehouses!.find(w => w.warehouseId === branchWh.id)?.quantity === 15, 'Branch warehouse must be 15 after purchase');
  assert(itemWh.totalStockQuantity === 25, `Total item.stockQuantity must equal 10+15=25, got ${itemWh.totalStockQuantity}`);

  // رفض حذف مخزن المعادي لوجود أرصدة بداخله
  const delNonEmptyRes = await deleteWarehouse(branchWh.id, designerSession);
  assert(!delNonEmptyRes.success && delNonEmptyRes.statusCode === 400, 'Cannot delete warehouse with non-zero balances');

  // تعديل كمية مباشر على مخزن المعادي إلى 20
  const adjRes = await adjustItemStock(
    testItemId,
    { newQuantity: 20, reason: 'جرد فرع المعادي', warehouseId: branchWh.id },
    designerSession
  );
  assert(adjRes.success && adjRes.movement?.warehouseId === branchWh.id && adjRes.movement?.warehouseName === branchWh.name, `Adjust stock failed: ${adjRes.error}`);

  itemWh = await getItemWarehouses(testItemId, designerSession);
  assert(itemWh.warehouses!.find(w => w.warehouseId === MAIN_WAREHOUSE_ID)?.quantity === 10, 'Main warehouse must remain 10');
  assert(itemWh.warehouses!.find(w => w.warehouseId === branchWh.id)?.quantity === 20, 'Branch warehouse must be 20');
  assert(itemWh.totalStockQuantity === 30, `Total stockQuantity must equal 10+20=30, got ${itemWh.totalStockQuantity}`);

  // محاولة بيع 12 قطعة من المخزن الرئيسي (المتاح بالرئيسي = 10 بينما المعادي = 20 والإجمالي = 30!)
  // يجب أن يُرفض لأن الرصيد يُفحص في المخزن المحدد فقط
  const overSellMainRes = await createInvoice(
    {
      idempotencyKey: `inv-over-main-${Date.now()}`,
      warehouseId: MAIN_WAREHOUSE_ID,
      platform: 'البيع المباشر',
      paymentType: 'نقدي',
      lines: [{ itemId: testItemId, quantity: 12 }]
    },
    designerSession
  );
  assert(!overSellMainRes.success && overSellMainRes.statusCode === 400, 'Selling 12 from Main (avail 10, branch 20) MUST be rejected!');

  // بيع 3 قطع من المخزن الرئيسي
  const sellMainRes = await createInvoice(
    {
      idempotencyKey: `inv-sell-main-${Date.now()}`,
      warehouseId: MAIN_WAREHOUSE_ID,
      platform: 'البيع المباشر',
      paymentType: 'نقدي',
      lines: [{ itemId: testItemId, quantity: 3 }]
    },
    designerSession
  );
  assert(sellMainRes.success && sellMainRes.invoice?.warehouseId === MAIN_WAREHOUSE_ID, `Sale from Main failed: ${sellMainRes.error}`);
  const soldInvNo = sellMainRes.invoice!.invoiceNumber;

  itemWh = await getItemWarehouses(testItemId, designerSession);
  assert(itemWh.warehouses!.find(w => w.warehouseId === MAIN_WAREHOUSE_ID)?.quantity === 7, 'Main warehouse must be 7 after selling 3');
  assert(itemWh.warehouses!.find(w => w.warehouseId === branchWh.id)?.quantity === 20, 'Branch warehouse must stay 20');
  assert(itemWh.totalStockQuantity === 27, 'Total stockQuantity must equal 7+20=27');

  // تعديل الفاتورة من 3 إلى 5 قطع -> يصبح الرئيسي 5 و الإجمالي 25
  const updInvRes = await updateInvoice(
    soldInvNo,
    {
      editReason: 'تعديل الكمية من 3 إلى 5',
      lines: [{ itemId: testItemId, quantity: 5, salePriceAtSale: 100 }]
    },
    designerSession
  );
  assert(updInvRes.success && updInvRes.invoice?.warehouseId === MAIN_WAREHOUSE_ID, `Update invoice failed: ${updInvRes.error}`);
  itemWh = await getItemWarehouses(testItemId, designerSession);
  assert(itemWh.warehouses!.find(w => w.warehouseId === MAIN_WAREHOUSE_ID)?.quantity === 5, 'Main warehouse must be 5 after update to qty 5');
  assert(itemWh.totalStockQuantity === 25, 'Total must be 25');

  // مرتجع مبيعات 1 قطعة -> يرجع للمخزن الرئيسي (يرث مخزن الفاتورة تلقائياً)
  const retRes = await createReturn(
    {
      idempotencyKey: `ret-main-${Date.now()}`,
      invoiceNumber: soldInvNo,
      refundStatus: 'قيد على الحساب',
      lines: [{ itemId: testItemId, returnedQuantity: 1, itemCondition: 'يرجع المخزن' }]
    },
    designerSession
  );
  assert(retRes.success && retRes.returnRecord?.warehouseId === MAIN_WAREHOUSE_ID, `Return failed: ${retRes.error}`);
  itemWh = await getItemWarehouses(testItemId, designerSession);
  assert(itemWh.warehouses!.find(w => w.warehouseId === MAIN_WAREHOUSE_ID)?.quantity === 6, 'Main warehouse must be 6 after returning 1');
  assert(itemWh.warehouses!.find(w => w.warehouseId === branchWh.id)?.quantity === 20, 'Branch must still be 20');
  assert(itemWh.totalStockQuantity === 26, 'Total must be 26');

  // مرتجع شراء 5 من مخزن المعادي -> يصبح المعادي 15 والإجمالي 21
  const pRetRes = await createPurchaseReturn(
    {
      idempotencyKey: `pret-branch-${Date.now()}`,
      supplierId: 'sup-ank-001',
      purchaseInvoiceNumber: purRes.invoice!.invoiceNumber,
      refundStatus: 'قيد على الحساب',
      lines: [{ itemId: testItemId, quantity: 5, unitCost: 60 }]
    },
    designerSession
  );
  assert(pRetRes.success && pRetRes.returnRecord?.warehouseId === branchWh.id, `Purchase return failed: ${pRetRes.error}`);
  itemWh = await getItemWarehouses(testItemId, designerSession);
  assert(itemWh.warehouses!.find(w => w.warehouseId === branchWh.id)?.quantity === 15, 'Branch must be 15 after purchase return 5');
  assert(itemWh.totalStockQuantity === 21, 'Total must be 21');
  console.log('4) Stock isolation across purchases, adjust, sales, invoice update, returns, and purchase returns passed.');

  // 5. تقارير الحركات وتسويات المخزون تحمل المخزن
  const itemLogs = await getItemLogs(testItemId, designerSession);
  assert(itemLogs.stockMovements.length >= 6, 'Item movements should include all warehouse transactions');
  for (const mv of itemLogs.stockMovements) {
    assert(Boolean(mv.warehouseId) && Boolean(mv.warehouseName), `Movement ${mv.movementType} missing warehouseId/warehouseName`);
  }
  const adjReport = await getStockAdjustmentsReport({ itemId: testItemId, warehouseId: branchWh.id }, designerSession);
  assert(adjReport.success && adjReport.report!.records.some(r => r.warehouseId === branchWh.id), 'Stock adjustments report must track warehouse');

  const mvReportBranch = await getItemMovementReport({ itemId: testItemId, warehouseId: branchWh.id }, designerSession);
  assert(mvReportBranch.success && mvReportBranch.report!.currentStock === 15, `Item movement report filtered to branch should show currentStock=15, got ${mvReportBranch.report?.currentStock}`);
  console.log('5) Warehouse audit fields in stock movements & reports passed.');

  // 6. اختبار حذف مخزن رصيده صفر لكنه عليه حركات سابقة (يجب أن يُمنع الحذف، ويمكن الإيقاف فقط)
  const addUsedRes = await adjustItemStock(testItemId, { newQuantity: 4, reason: 'اختبار', warehouseId: usedEmptyWh.id }, designerSession);
  assert(addUsedRes.success, 'Adjust on usedEmptyWh failed');
  const zeroUsedRes = await adjustItemStock(testItemId, { newQuantity: 0, reason: 'تصفير', warehouseId: usedEmptyWh.id }, designerSession);
  assert(zeroUsedRes.success, 'Zeroing usedEmptyWh failed');
  const tryDelUsedRes = await deleteWarehouse(usedEmptyWh.id, designerSession);
  assert(!tryDelUsedRes.success && tryDelUsedRes.statusCode === 400, 'Warehouse with zero stock but historical movements must NOT be deletable');
  const deactUsedRes = await saveWarehouse({ id: usedEmptyWh.id, status: 'موقوف' }, designerSession);
  assert(deactUsedRes.success && deactUsedRes.warehouse?.status === 'موقوف', 'Deactivating used warehouse should succeed');
  console.log('6) Used-warehouse delete prevention & deactivation passed.');

  // 7. ربط المستخدمين بالمخازن وصلاحيات المدير والموظف والمخزن الموقوف
  const createEmpRes = await saveUser(
    {
      username: 'wh_emp_test',
      name: 'كاشير فرع المعادي',
      password: 'Password@123',
      role: 'employee',
      permissions: ['items.view', 'invoices.create', 'warehouses.view'],
      warehouseConfig: {
        allowedWarehouseIds: [branchWh.id],
        defaultWarehouseId: branchWh.id
      }
    },
    designerSession
  );
  assert(createEmpRes.success && createEmpRes.user, `Failed creating employee user: ${createEmpRes.error}`);
  const empUser = createEmpRes.user!;
  const empSession = {
    userId: empUser.id,
    id: empUser.id,
    role: 'employee' as const,
    isOwner: false,
    username: empUser.username,
    phone: empUser.phone,
    name: empUser.name,
    permissions: empUser.permissions
  };

  // الموظف يرى مخزنه فقط والمدير يرى الكل
  const empVisibleWh = await getWarehouses(empSession);
  assert(empVisibleWh.length === 1 && empVisibleWh[0].id === branchWh.id, 'Employee must see ONLY assigned warehouse');
  const mgrVisibleWh = await getWarehouses(managerSession);
  assert(mgrVisibleWh.length >= 3, 'Manager must see ALL warehouses automatically');

  // عند إغفال warehouseId: الموظف بمخزن واحد يختار مخزنه تلقائياً (فرع المعادي)
  const autoEmpInvRes = await createInvoice(
    {
      idempotencyKey: `emp-auto-wh-${Date.now()}`,
      platform: 'البيع المباشر',
      paymentType: 'نقدي',
      lines: [{ itemId: testItemId, quantity: 2 }]
    },
    empSession
  );
  assert(autoEmpInvRes.success && autoEmpInvRes.invoice?.warehouseId === branchWh.id, `Employee auto-select single warehouse failed: ${autoEmpInvRes.error}`);
  itemWh = await getItemWarehouses(testItemId, designerSession);
  assert(itemWh.warehouses!.find(w => w.warehouseId === branchWh.id)?.quantity === 13, 'Branch should drop from 15 to 13');
  assert(itemWh.warehouses!.find(w => w.warehouseId === MAIN_WAREHOUSE_ID)?.quantity === 6, 'Main must stay 6');

  // محاولة الموظف البيع من مخزن غير مسموح (المخزن الرئيسي) -> 403
  const forbiddenInvRes = await createInvoice(
    {
      idempotencyKey: `emp-forbid-wh-${Date.now()}`,
      warehouseId: MAIN_WAREHOUSE_ID,
      platform: 'البيع المباشر',
      paymentType: 'نقدي',
      lines: [{ itemId: testItemId, quantity: 1 }]
    },
    empSession
  );
  assert(!forbiddenInvRes.success && forbiddenInvRes.statusCode === 403, 'Employee selling from unauthorized warehouse MUST fail with 403');

  // محاولة البيع من مخزن موقوف -> 400
  const inactiveSellRes = await createInvoice(
    {
      idempotencyKey: `inactive-wh-${Date.now()}`,
      warehouseId: usedEmptyWh.id,
      platform: 'البيع المباشر',
      paymentType: 'نقدي',
      lines: [{ itemId: testItemId, quantity: 1 }]
    },
    designerSession
  );
  assert(!inactiveSellRes.success && inactiveSellRes.statusCode === 400, 'Selling from inactive warehouse MUST fail with 400');

  // تحديث مخازن المستخدم عبر saveUserWarehouses والتحقق من المنع لافتراضي خارج المسموح
  const badCfgRes = await saveUserWarehouses(empUser.id, { allowedWarehouseIds: [branchWh.id], defaultWarehouseId: MAIN_WAREHOUSE_ID }, designerSession);
  assert(!badCfgRes.success && badCfgRes.statusCode === 400, 'Default warehouse outside allowed list for employee must fail');
  const empUserWh = await getUserWarehouses(empUser.id);
  assert(empUserWh.success && empUserWh.seesAllWarehouses === false && empUserWh.warehouses!.length === 1, 'getUserWarehouses mismatch');
  console.log('7) User-warehouse restrictions, auto-selection, 403, and inactive warehouse 400 checks passed.');

  // 8. getItemsPaginated مع warehouseId و ALL
  const pagBranchRes = await getItemsPaginated({ page: 1, search: 'WH-TEST-001', warehouseId: branchWh.id }, designerSession);
  assert(pagBranchRes.success && pagBranchRes.items.length === 1, 'Paginated branch search failed');
  assert(pagBranchRes.items[0].stockQuantity === 13, `Expected branch stockQuantity=13, got ${pagBranchRes.items[0].stockQuantity}`);
  assert(pagBranchRes.items[0].totalStockQuantity === 19, `Expected totalStockQuantity=19, got ${pagBranchRes.items[0].totalStockQuantity}`);
  assert(pagBranchRes.totals.totalPieces === 13, `Branch totals.totalPieces expected 13, got ${pagBranchRes.totals.totalPieces}`);
  assert(pagBranchRes.totals.totalSaleValue === 1300, `Branch totals.totalSaleValue expected 1300, got ${pagBranchRes.totals.totalSaleValue}`);

  const pagAllRes = await getItemsPaginated({ page: 1, search: 'WH-TEST-001', warehouseId: 'ALL' }, designerSession);
  assert(pagAllRes.success && pagAllRes.items[0].stockQuantity === 19, `Expected ALL stockQuantity=19, got ${pagAllRes.items[0].stockQuantity}`);
  assert(pagAllRes.totals.totalPieces === 19 && pagAllRes.totals.totalSaleValue === 1900, 'ALL totals mismatch');

  // موظف يطلب مخزن غير مسموح في getItemsPaginated -> 403
  const pagForbidRes = await getItemsPaginated({ page: 1, warehouseId: MAIN_WAREHOUSE_ID }, empSession);
  assert(!pagForbidRes.success && (pagForbidRes as any).statusCode === 403, 'Employee querying unauthorized warehouseId in getItemsPaginated MUST fail with 403');
  console.log('8) getItemsPaginated per-warehouse totals & authorization passed.');

  // 9. التحقق النهائي أن كل الأصناف في النظام تحقق item.stockQuantity === sum(warehouses)
  const allItemsNow = await getItems(designerSession);
  for (const it of allItemsNow) {
    const breakdown = await getItemWarehouses(it.id, designerSession);
    const sum = (breakdown.warehouses || []).reduce((s, w) => s + Number(w.quantity || 0), 0);
    assert(Math.abs(sum - Number(it.stockQuantity || 0)) < 0.0001, `Item ${it.id} stockQuantity=${it.stockQuantity} != sum(${sum})`);
  }
  console.log('9) Global stock conservation invariant verified across all items.');

  console.log('\n✅ ALL TASK 3 IN-MEMORY SERVICE TESTS PASSED!');
}

async function runHttpTests() {
  console.log('\n=== Verifying Task 3 Live HTTP Endpoints ===');
  const { app } = await createServerApp({ attachVite: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const initialPassword = process.env.INITIAL_USER_PASSWORD || '1234';

    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: initialPassword })
    });
    const adminLogin = await adminLoginRes.json();
    assert(adminLogin.success && adminLogin.token, 'HTTP admin login failed');

    if (adminLogin.user?.mustChangePassword) {
      const setupAdminRes = await fetch(`${baseUrl}/api/auth/complete-initial-setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminLogin.token}`
        },
        body: JSON.stringify({
          name: adminLogin.user.name || 'مدير النظام',
          username: 'admin',
          newPassword: 'Admin@NewPassword1'
        })
      });
      assert(setupAdminRes.status === 200, `HTTP admin initial setup failed with ${setupAdminRes.status}`);
    }

    const cashierLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cashier', password: initialPassword })
    });
    const cashierLogin = await cashierLoginRes.json();
    assert(cashierLogin.success && cashierLogin.token, 'HTTP cashier login failed');

    if (cashierLogin.user?.mustChangePassword) {
      const setupCashierRes = await fetch(`${baseUrl}/api/auth/complete-initial-setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierLogin.token}`
        },
        body: JSON.stringify({
          name: cashierLogin.user.name || 'كاشير',
          username: 'cashier',
          newPassword: 'Cashier@NewPassword1'
        })
      });
      assert(setupCashierRes.status === 200, `HTTP cashier initial setup failed with ${setupCashierRes.status}`);
    }

    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminLogin.token}`
    };
    const cashierHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cashierLogin.token}`
    };

    // 1) GET /api/warehouses
    const listRes = await fetch(`${baseUrl}/api/warehouses`, { headers: adminHeaders });
    assert(listRes.status === 200, `GET /api/warehouses expected 200, got ${listRes.status}`);
    const listJson = await listRes.json();
    assert(
      listJson.success &&
        listJson.migration?.completed === true &&
        Array.isArray(listJson.warehouses) &&
        listJson.warehouses.some((w: any) => w.id === MAIN_WAREHOUSE_ID),
      'GET /api/warehouses response invalid'
    );

    // 2) POST /api/warehouses (ممنوع للموظف بدون warehouses.manage -> 403، ومسموح للأدمن -> 200)
    const suffix = Date.now();
    const forbiddenCreate = await fetch(`${baseUrl}/api/warehouses`, {
      method: 'POST',
      headers: cashierHeaders,
      body: JSON.stringify({ name: `مخزن موظف ${suffix}` })
    });
    assert(forbiddenCreate.status === 403, `POST /api/warehouses for cashier expected 403, got ${forbiddenCreate.status}`);

    const createRes = await fetch(`${baseUrl}/api/warehouses`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: `مخزن HTTP ${suffix}`, notes: 'اختبار HTTP' })
    });
    assert(createRes.status === 200, `POST /api/warehouses expected 200, got ${createRes.status}`);
    const createJson = await createRes.json();
    assert(createJson.success && createJson.warehouse?.id, 'Created warehouse missing ID');
    const httpWhId = createJson.warehouse.id;

    // 3) PUT /api/warehouses/:id
    const updateRes = await fetch(`${baseUrl}/api/warehouses/${httpWhId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ notes: 'محدث عبر HTTP' })
    });
    assert(updateRes.status === 200, `PUT /api/warehouses/:id expected 200, got ${updateRes.status}`);

    // 4) GET /api/items/:id/warehouses + GET /api/items/paginated?warehouseId=...
    const itemWhRes = await fetch(`${baseUrl}/api/items/item-ank-65w/warehouses`, { headers: adminHeaders });
    assert(itemWhRes.status === 200, `GET /api/items/:id/warehouses expected 200, got ${itemWhRes.status}`);
    const itemWhJson = await itemWhRes.json();
    assert(itemWhJson.success && Array.isArray(itemWhJson.warehouses), 'Invalid item warehouses payload');

    const pagWhRes = await fetch(`${baseUrl}/api/items/paginated?warehouseId=${MAIN_WAREHOUSE_ID}&page=1&limit=10`, {
      headers: adminHeaders
    });
    assert(pagWhRes.status === 200, `GET /api/items/paginated?warehouseId expected 200, got ${pagWhRes.status}`);

    // 5) GET & PUT /api/users/:id/warehouses + 403 على مخزن غير مسموح للكاشير
    const cashierUserId = cashierLogin.user?.id || 'usr-cashier-003';
    const userWhRes = await fetch(`${baseUrl}/api/users/${cashierUserId}/warehouses`, { headers: adminHeaders });
    assert(userWhRes.status === 200, `GET /api/users/:id/warehouses expected 200, got ${userWhRes.status}`);

    const cashierForbiddenPag = await fetch(`${baseUrl}/api/items/paginated?warehouseId=${httpWhId}&page=1`, {
      headers: cashierHeaders
    });
    assert(
      cashierForbiddenPag.status === 403,
      `Cashier querying unassigned warehouse in paginated endpoint expected 403, got ${cashierForbiddenPag.status}`
    );

    // 6) DELETE /api/warehouses/:id (نظيف لم يمسح عليه حركات -> ينجح) + حذف الرئيسي -> 400
    const delMainHttp = await fetch(`${baseUrl}/api/warehouses/${MAIN_WAREHOUSE_ID}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert(delMainHttp.status === 400, `DELETE default main warehouse expected 400, got ${delMainHttp.status}`);

    const delHttpWh = await fetch(`${baseUrl}/api/warehouses/${httpWhId}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert(delHttpWh.status === 200, `DELETE clean temp HTTP warehouse expected 200, got ${delHttpWh.status}`);

    console.log('✅ ALL TASK 3 LIVE HTTP ENDPOINT TESTS PASSED!');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function main() {
  await runTests();
  await runHttpTests();
  console.log('\n🎉 ALL TASK 3 MULTI-WAREHOUSE TESTS (SERVICE + HTTP) PASSED SUCCESSFULLY!');
}

main().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});

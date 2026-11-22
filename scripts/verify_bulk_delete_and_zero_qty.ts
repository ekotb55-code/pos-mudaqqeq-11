import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import * as XLSX from 'xlsx';
import {
  getItems,
  saveItem,
  deleteItem,
  getItemsPaginated,
  getWarehouses,
  saveWarehouse,
  getStockSettings,
  saveStockSettings,
  getSuppliers,
  saveSupplier,
  getCashboxes,
  saveCashbox,
  getCustomers,
  saveCustomer,
  getPlatforms,
  saveItemPlatformCost,
  getItemPlatformCosts,
  createInvoice,
  cancelInvoice,
  createReturn,
  createPurchase,
  createPurchaseReturn,
  createWarehouseTransfer,
  getAuditLogs,
  getItemLogs,
  generateBulkPriceEditTemplateBuffer,
  previewBulkPriceEditExcel,
  executeBulkPriceEditExcel,
  getBulkEditUndoStatus,
  saveUser,
  deleteUser,
  getUsers
} from '../server/sheetsService.ts';
import type { PermissionKey } from '../src/types/index.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function buildXlsxBuffer(aoa: any[][], sheetName = 'Sheet1'): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const designerSession = {
  id: 'verify-del-designer',
  userId: 'verify-del-designer',
  name: 'مصمم النظام (اختبار الحذف والصفر)',
  phone: '01099990001',
  role: 'designer' as const,
  isOwner: true,
  permissions: [
    'items.view',
    'items.create',
    'items.edit',
    'items.delete',
    'categories.manage',
    'prices.view_purchase',
    'products.bulk_edit_excel',
    'warehouses.view',
    'warehouses.manage',
    'warehouses.transfer',
    'invoices.create',
    'invoices.cancel',
    'returns.create',
    'purchases.create',
    'settings.manage'
  ] as PermissionKey[]
};

const bulkEditWithoutDeleteSession = {
  id: 'verify-bulk-no-delete',
  userId: 'verify-bulk-no-delete',
  name: 'موظف تعديل إكسيل بدون حذف',
  phone: '01099990002',
  role: 'employee' as const,
  isOwner: false,
  permissions: ['items.view', 'items.create', 'items.edit', 'products.bulk_edit_excel'] as PermissionKey[]
};

async function runStaticUiChecks() {
  console.log('=== 1. Running Static Frontend UI Checks ===');
  const bulkPagePath = path.resolve(process.cwd(), 'src/pages/BulkEditExcelPage.tsx');
  const bulkPageCode = fs.readFileSync(bulkPagePath, 'utf8');

  assert(bulkPageCode.includes("canDeleteItems && <option value=\"delete_items\">حذف أصناف</option>"), 'BulkEditExcelPage must show delete_items only when user has items.delete permission');
  assert(bulkPageCode.includes("hasPermission(user, 'items.delete')"), 'BulkEditExcelPage must check items.delete permission');
  const whScopedMatch = bulkPageCode.match(/const\s+WAREHOUSE_SCOPED_OPS[^=]*=\s*\[([\s\S]*?)\];/);
  assert(whScopedMatch && !whScopedMatch[1].includes('delete_items'), 'delete_items must NOT be in WAREHOUSE_SCOPED_OPS');
  assert(bulkPageCode.includes('الحذف نهائي ولا يمكن التراجع عنه'), 'BulkEditExcelPage must show clear irreversible deletion warning');
  assert(bulkPageCode.includes('deleteConfirmCountInput') && bulkPageCode.includes('willUpdateCount'), 'Confirmation modal must require entering exact count of items to be deleted');
  assert(bulkPageCode.includes('سيُحذف نهائيًا'), 'Preview status must show سيُحذف نهائيًا');

  const productsPagePath = path.resolve(process.cwd(), 'src/pages/ProductsPage.tsx');
  const productsPageCode = fs.readFileSync(productsPagePath, 'utf8');
  assert(productsPageCode.includes("currentTab === 'OUT_OF_STOCK'") && productsPageCode.includes("currentTab === 'LOW_STOCK'"), 'ProductsPage must handle navigation tabs OUT_OF_STOCK / LOW_STOCK');

  console.log('  [PASS] Static Frontend UI Checks');
}

async function runPart1DeleteItemsTests() {
  console.log('=== 2. Running Part 1: Bulk Delete Items Tests ===');

  // 2a) Template check
  const tplNoPerm = await generateBulkPriceEditTemplateBuffer('delete_items', bulkEditWithoutDeleteSession);
  assert(!tplNoPerm.success && tplNoPerm.statusCode === 403, 'User without items.delete must get 403 for delete_items template');

  const tplOk = await generateBulkPriceEditTemplateBuffer('delete_items', designerSession);
  assert(tplOk.success && tplOk.buffer, `Designer should get delete_items template: ${tplOk.error}`);
  const tplWb = XLSX.read(tplOk.buffer!, { type: 'buffer' });
  const tplRows = XLSX.utils.sheet_to_json<any[]>(tplWb.Sheets[tplWb.SheetNames[0]], { header: 1 });
  assert(
    tplRows[0].length === 1 && tplRows[0][0] === 'اسم الصنف',
    `delete_items template headers must be exactly ['اسم الصنف'], got ${JSON.stringify(tplRows[0])}`
  );

  // Setup auxiliary records (secondary warehouse, customer, supplier, cashbox, platform)
  const warehouses = await getWarehouses(designerSession);
  const mainWh = warehouses.find(w => w.isDefault) || warehouses[0];
  let secWh = warehouses.find(w => !w.isDefault && w.status === 'نشط');
  if (!secWh) {
    const whRes = await saveWarehouse({ name: 'مخزن فرعي اختبار الحذف', status: 'نشط' }, designerSession);
    assert(whRes.success && whRes.warehouse, 'Failed to create secondary warehouse');
    secWh = whRes.warehouse!;
  }

  let suppliers = await getSuppliers(designerSession);
  let supplier = suppliers[0];
  if (!supplier) {
    const supRes = await saveSupplier({ name: 'مورد اختبار الحذف', phone: '01011122233' }, designerSession);
    assert(supRes.success && supRes.supplier, 'Failed to create supplier');
    supplier = supRes.supplier!;
  }

  let cashboxes = await getCashboxes(designerSession);
  let cashbox = cashboxes[0];
  if (!cashbox) {
    const cbRes = await saveCashbox({ name: 'خزينة اختبار الحذف', initialBalance: 100000, currentBalance: 100000 }, designerSession);
    assert(cbRes.success && cbRes.cashbox, 'Failed to create cashbox');
    cashbox = cbRes.cashbox!;
  } else if (cashbox.currentBalance < 10000) {
    await saveCashbox({ ...cashbox, currentBalance: 100000 }, designerSession);
  }

  let customers = await getCustomers(designerSession);
  let customer = customers[0];
  if (!customer) {
    const custRes = await saveCustomer({ name: 'عميل اختبار الحذف', phone: '01044455566' }, designerSession);
    assert(custRes.success && custRes.customer, 'Failed to create customer');
    customer = custRes.customer!;
  }

  const platforms = await getPlatforms(designerSession);
  const platformId = platforms[0]?.id || 'direct';

  const suffix = Date.now().toString().slice(-6);
  const itemAName = `صنف_حذف_سليم_صفر_${suffix}`;
  const itemBName = `صنف_حذف_بعد_تحويل_وتسوية_${suffix}`;
  const itemCName = `صنف_مرفوض_رصيد_${suffix}`;
  const itemDName = `صنف_مرفوض_فاتورة_بيع_ملغاة_${suffix}`;
  const itemEName = `صنف_مرفوض_مرتجع_بيع_${suffix}`;
  const itemFName = `صنف_مرفوض_فاتورة_شراء_${suffix}`;
  const itemGName = `صنف_مرفوض_مرتجع_شراء_${suffix}`;
  const missingItemName = `صنف_غير_موجود_${suffix}`;

  // Create Item A: direct zero stock + platform cost (to verify cascade cleanup)
  const resA = await saveItem({
    name: itemAName,
    barcode: `DELA${suffix}`,
    salePrice: 50,
    purchasePrice: 30,
    stockQuantity: 0,
    status: 'نشط'
  }, designerSession);
  assert(resA.success && resA.item, 'Create Item A');
  const itemA = resA.item!;
  await saveItemPlatformCost({
    id: `cost-${itemA.id}`,
    itemId: itemA.id,
    platformId,
    packagingCost: 2,
    extraFees: 1,
    customCommissionPercentage: 0
  } as any, designerSession);

  // Create Item B via Excel add_items with stock 5 -> creates opening StockMovement -> transfer 2 to secWh -> zero out both -> stock=0 everywhere with StockMovements!
  const addBBuf = buildXlsxBuffer([
    ['اسم الصنف', 'الباركود الرئيسي', 'الكمية', 'سعر البيع'],
    [itemBName, `DELB${suffix}`, 5, 60]
  ]);
  const addBExec = await executeBulkPriceEditExcel({
    operationType: 'add_items',
    fileName: 'add-b.xlsx',
    fileBase64: addBBuf.toString('base64'),
    warehouseId: mainWh.id
  }, designerSession);
  assert(addBExec.success && addBExec.updatedCount === 1, 'Create Item B via add_items');
  const itemB = (await getItems(designerSession)).find(it => it.name === itemBName)!;
  assert(itemB, 'Item B must exist');

  const trRes = await createWarehouseTransfer({
    fromWarehouseId: mainWh.id,
    toWarehouseId: secWh.id,
    lines: [{ itemId: itemB.id, quantity: 2 }],
    notes: 'تحويل اختبار الحذف',
    idempotencyKey: `tr-del-${suffix}`
  }, designerSession);
  assert(trRes.success, `Warehouse transfer for Item B failed: ${trRes.error}`);

  // Zero out mainWh and secWh via stock_quantity bulk edit
  for (const whId of [mainWh.id, secWh.id]) {
    const zeroBuf = buildXlsxBuffer([
      ['اسم الصنف', 'الكمية الجديدة'],
      [itemBName, 0]
    ]);
    const zeroRes = await executeBulkPriceEditExcel({
      operationType: 'stock_quantity',
      fileName: 'zero-b.xlsx',
      fileBase64: zeroBuf.toString('base64'),
      warehouseId: whId
    }, designerSession);
    assert(zeroRes.success, `Zeroing Item B in warehouse ${whId} failed: ${zeroRes.error}`);
  }

  // Create Item C with positive stock 5 in secondary warehouse
  const resC = await saveItem({
    name: itemCName,
    barcode: `DELC${suffix}`,
    salePrice: 40,
    purchasePrice: 20,
    stockQuantity: 0,
    status: 'نشط'
  }, designerSession);
  assert(resC.success && resC.item, 'Create Item C');
  const itemC = resC.item!;
  await executeBulkPriceEditExcel({
    operationType: 'stock_quantity',
    fileName: 'set-c-5.xlsx',
    fileBase64: buildXlsxBuffer([['اسم الصنف', 'الكمية الجديدة'], [itemCName, 5]]).toString('base64'),
    warehouseId: secWh.id
  }, designerSession);

  // Create Item D: used in a sales invoice that gets CANCELLED -> stock returns to 0, still must be rejected!
  const resD = await saveItem({
    name: itemDName,
    barcode: `DELD${suffix}`,
    salePrice: 100,
    purchasePrice: 50,
    stockQuantity: 1,
    status: 'نشط'
  }, designerSession);
  assert(resD.success && resD.item, 'Create Item D');
  const itemD = resD.item!;
  const invDRes = await createInvoice({
    idempotencyKey: `inv-del-d-${suffix}`,
    customerId: customer.id,
    customerName: customer.name,
    platformId,
    warehouseId: mainWh.id,
    paymentType: 'آجل',
    lines: [{ itemId: itemD.id, itemName: itemD.name, quantity: 1, unitPrice: 100 }]
  }, designerSession);
  assert(invDRes.success && invDRes.invoice, `Create Invoice D failed: ${invDRes.error}`);
  const cancelDRes = await cancelInvoice(invDRes.invoice!.invoiceNumber, 'إلغاء اختباري', designerSession);
  assert(cancelDRes.success, `Cancel Invoice D failed: ${cancelDRes.error}`);
  // Set stock D back to 0 so ONLY cancelled invoice blocks it
  await executeBulkPriceEditExcel({
    operationType: 'stock_quantity',
    fileName: 'zero-d.xlsx',
    fileBase64: buildXlsxBuffer([['اسم الصنف', 'الكمية الجديدة'], [itemDName, 0]]).toString('base64'),
    warehouseId: mainWh.id
  }, designerSession);

  // Create Item E: sales invoice + sales return -> zero out stock -> rejected because of invoice & sales return
  const resE = await saveItem({
    name: itemEName,
    barcode: `DELE${suffix}`,
    salePrice: 100,
    purchasePrice: 50,
    stockQuantity: 2,
    status: 'نشط'
  }, designerSession);
  assert(resE.success && resE.item, 'Create Item E');
  const itemE = resE.item!;
  const invERes = await createInvoice({
    idempotencyKey: `inv-del-e-${suffix}`,
    customerId: customer.id,
    customerName: customer.name,
    platformId,
    warehouseId: mainWh.id,
    paymentType: 'آجل',
    lines: [{ itemId: itemE.id, itemName: itemE.name, quantity: 2, unitPrice: 100 }]
  }, designerSession);
  assert(invERes.success && invERes.invoice, `Create Invoice E failed: ${invERes.error}`);
  const retERes = await createReturn({
    idempotencyKey: `ret-del-e-${suffix}`,
    invoiceNumber: invERes.invoice!.invoiceNumber,
    warehouseId: mainWh.id,
    returnReason: 'مرتجع اختبار الحذف',
    lines: [{ itemId: itemE.id, returnedQuantity: 1 }]
  }, designerSession);
  assert(retERes.success, `Create Return E failed: ${retERes.error}`);
  await executeBulkPriceEditExcel({
    operationType: 'stock_quantity',
    fileName: 'zero-e.xlsx',
    fileBase64: buildXlsxBuffer([['اسم الصنف', 'الكمية الجديدة'], [itemEName, 0]]).toString('base64'),
    warehouseId: mainWh.id
  }, designerSession);

  // Create Item F & Item G: Purchase invoice + Purchase return -> zero out stock -> rejected
  const resF = await saveItem({
    name: itemFName,
    barcode: `DELF${suffix}`,
    salePrice: 90,
    purchasePrice: 45,
    stockQuantity: 0,
    status: 'نشط'
  }, designerSession);
  assert(resF.success && resF.item, 'Create Item F');
  const itemF = resF.item!;

  const resG = await saveItem({
    name: itemGName,
    barcode: `DELG${suffix}`,
    salePrice: 90,
    purchasePrice: 45,
    stockQuantity: 0,
    status: 'نشط'
  }, designerSession);
  assert(resG.success && resG.item, 'Create Item G');
  const itemG = resG.item!;

  const purRes = await createPurchase({
    idempotencyKey: `pur-del-${suffix}`,
    supplierId: supplier.id,
    warehouseId: mainWh.id,
    paymentType: 'آجل',
    lines: [
      { itemId: itemF.id, itemName: itemF.name, quantity: 2, unitCost: 45 },
      { itemId: itemG.id, itemName: itemG.name, quantity: 2, unitCost: 45 }
    ]
  }, designerSession);
  assert(purRes.success && purRes.invoice, `Create Purchase failed: ${purRes.error}`);

  const pRetRes = await createPurchaseReturn({
    idempotencyKey: `pret-del-${suffix}`,
    supplierId: supplier.id,
    purchaseInvoiceNumber: purRes.invoice!.invoiceNumber,
    warehouseId: mainWh.id,
    returnReason: 'مرتجع شراء اختبار',
    lines: [{ itemId: itemG.id, itemName: itemG.name, quantity: 2, unitCost: 45 }]
  }, designerSession);
  assert(pRetRes.success, `Create Purchase Return failed: ${pRetRes.error}`);

  await executeBulkPriceEditExcel({
    operationType: 'stock_quantity',
    fileName: 'zero-fg.xlsx',
    fileBase64: buildXlsxBuffer([
      ['اسم الصنف', 'الكمية الجديدة'],
      [itemFName, 0],
      [itemGName, 0]
    ]).toString('base64'),
    warehouseId: mainWh.id
  }, designerSession);

  // Build mixed delete Excel file
  const delBuf = buildXlsxBuffer([
    ['اسم الصنف'],
    [itemAName],
    [itemBName],
    [itemCName],
    [itemDName],
    [itemEName],
    [itemFName],
    [itemGName],
    [missingItemName]
  ]);
  const delBase64 = delBuf.toString('base64');

  // Preview without permission must fail 403
  const prevNoPerm = await previewBulkPriceEditExcel({
    operationType: 'delete_items',
    fileName: 'delete-mixed.xlsx',
    fileBase64: delBase64
  }, bulkEditWithoutDeleteSession);
  assert(!prevNoPerm.success && prevNoPerm.statusCode === 403, 'Preview delete_items without items.delete must fail with 403');

  // Preview with designer session
  const delPreview = await previewBulkPriceEditExcel({
    operationType: 'delete_items',
    fileName: 'delete-mixed.xlsx',
    fileBase64: delBase64
  }, designerSession);
  assert(delPreview.success && delPreview.summary && delPreview.rows, `Delete preview failed: ${delPreview.error}`);
  assert(delPreview.summary.willUpdateCount === 2, `Expected 2 items ready for deletion, got ${delPreview.summary.willUpdateCount}`);
  assert(delPreview.summary.errorCount === 6, `Expected 6 rejected rows, got ${delPreview.summary.errorCount}`);

  const rowMap = new Map(delPreview.rows.map(r => [r.inputName, r]));
  assert(rowMap.get(itemAName)?.status === 'will_update' && rowMap.get(itemAName)?.newValueDisplay === 'سيُحذف نهائيًا', 'Item A must be will_update with سيُحذف نهائيًا');
  assert(rowMap.get(itemBName)?.status === 'will_update' && rowMap.get(itemBName)?.newValueDisplay === 'سيُحذف نهائيًا', 'Item B (with opening/adjustment/transfer movements & 0 balance) must be will_update');
  assert(rowMap.get(itemCName)?.status === 'error' && rowMap.get(itemCName)?.reason?.includes('وجود رصيد 5'), `Item C reason mismatch: ${rowMap.get(itemCName)?.reason}`);
  assert(rowMap.get(itemDName)?.status === 'error' && rowMap.get(itemDName)?.reason?.includes('فواتير بيع'), `Item D reason mismatch: ${rowMap.get(itemDName)?.reason}`);
  assert(rowMap.get(itemEName)?.status === 'error' && rowMap.get(itemEName)?.reason?.includes('فواتير بيع') && rowMap.get(itemEName)?.reason?.includes('مرتجعات بيع'), `Item E reason mismatch: ${rowMap.get(itemEName)?.reason}`);
  assert(rowMap.get(itemFName)?.status === 'error' && rowMap.get(itemFName)?.reason?.includes('فواتير شراء'), `Item F reason mismatch: ${rowMap.get(itemFName)?.reason}`);
  assert(rowMap.get(itemGName)?.status === 'error' && rowMap.get(itemGName)?.reason?.includes('مرتجعات شراء'), `Item G reason mismatch: ${rowMap.get(itemGName)?.reason}`);
  assert(rowMap.get(missingItemName)?.status === 'error' && rowMap.get(missingItemName)?.reason?.includes('لم يتم العثور'), `Missing item reason mismatch: ${rowMap.get(missingItemName)?.reason}`);

  // Execute mixed delete batch
  const delExec = await executeBulkPriceEditExcel({
    operationType: 'delete_items',
    fileName: 'delete-mixed.xlsx',
    fileBase64: delBase64
  }, designerSession);
  assert(delExec.success && delExec.updatedCount === 2 && delExec.errorCount === 6, `Unexpected execute result: ${JSON.stringify(delExec)}`);

  // Verify deleted items & exclusive child records are gone
  const remainingItems = await getItems(designerSession);
  assert(!remainingItems.some(it => it.id === itemA.id), 'Item A must be removed from memoryItems');
  assert(!remainingItems.some(it => it.id === itemB.id), 'Item B must be removed from memoryItems');
  assert(remainingItems.some(it => it.id === itemC.id), 'Item C must remain');

  const itemALogs = await getItemLogs(itemA.id, designerSession);
  assert(itemALogs.stockMovements.length === 0 && itemALogs.changeLogs.length === 0, 'Item A stockMovements & changeLogs must be cascade-deleted');
  const itemBLogs = await getItemLogs(itemB.id, designerSession);
  assert(itemBLogs.stockMovements.length === 0 && itemBLogs.changeLogs.length === 0, 'Item B stockMovements & changeLogs must be cascade-deleted');
  const allCosts = await getItemPlatformCosts(designerSession);
  assert(!allCosts.some(c => c.itemId === itemA.id), 'Item A platform costs must be cascade-deleted');

  // Verify undo is NOT available
  const undoStatus = await getBulkEditUndoStatus(designerSession);
  assert(undoStatus.success && undoStatus.available === false, 'Bulk delete must NOT allow undo (available must be false)');

  // Verify audit log records user name, count, and deleted item names
  const auditLogs = await getAuditLogs({ action: 'PRODUCTS_BULK_DELETE_EXCEL' }, designerSession);
  const matchingAudit = auditLogs.find((l: any) => l.details?.includes(itemAName) && l.details?.includes(itemBName));
  assert(matchingAudit, 'Audit log must include PRODUCTS_BULK_DELETE_EXCEL with deleted item names');
  assert(matchingAudit.actorName === designerSession.name && matchingAudit.details?.includes('2'), 'Audit log must record actor name and deleted count');

  // Clean up test Item C so balance can be zeroed then deleted
  await executeBulkPriceEditExcel({
    operationType: 'stock_quantity',
    fileName: 'zero-c.xlsx',
    fileBase64: buildXlsxBuffer([['اسم الصنف', 'الكمية الجديدة'], [itemCName, 0]]).toString('base64'),
    warehouseId: secWh.id
  }, designerSession);
  await deleteItem(itemC.id, designerSession);

  console.log('  [PASS] Part 1 Bulk Delete Items Tests');
}

async function runPart2ZeroQuantityAndHttpTests() {
  console.log('=== 3. Running Part 2: Zero Quantity & HTTP E2E Tests ===');

  process.env.SKIP_SERVER_LISTEN = '1';
  const { createServerApp } = await import('../server.ts');
  const { app } = await createServerApp({ attachVite: false });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const users = await getUsers(designerSession);
    const designerUser = users.find(u => u.role === 'designer' && (u.status === 'active' || (u.status as any) === 'نشط'));
    assert(designerUser, 'Need an active designer user in memoryUsers for HTTP test');

    // Create a temporary employee WITH items.delete & products.bulk_edit_excel & one WITHOUT items.delete
    const suffix = Date.now().toString().slice(-6);
    const empWithDelUsername = `test_del_${suffix}`;
    const empNoDelUsername = `test_nodel_${suffix}`;

    const u1Res = await saveUser({
      name: 'اختبار HTTP مع حذف',
      username: empWithDelUsername,
      role: 'employee',
      status: 'active',
      password: 'TempPass123!',
      permissions: ['items.view', 'items.create', 'items.edit', 'items.delete', 'products.bulk_edit_excel', 'settings.manage']
    }, designerSession);
    assert(u1Res.success && u1Res.user, `Create user with delete failed: ${u1Res.error}`);

    const u2Res = await saveUser({
      name: 'اختبار HTTP بدون حذف',
      username: empNoDelUsername,
      role: 'employee',
      status: 'active',
      password: 'TempPass123!',
      permissions: ['items.view', 'items.create', 'items.edit', 'products.bulk_edit_excel']
    }, designerSession);
    assert(u2Res.success && u2Res.user, `Create user without delete failed: ${u2Res.error}`);

    async function httpLogin(username: string, initialPass: string): Promise<string> {
      const loginResp = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: initialPass })
      });
      const loginJson: any = await loginResp.json();
      assert(loginResp.ok && loginJson.success && loginJson.token, `Login failed for ${username}: ${JSON.stringify(loginJson)}`);
      if (loginJson.user?.mustChangePassword) {
        const chResp = await fetch(`${baseUrl}/api/auth/change-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${loginJson.token}`
          },
          body: JSON.stringify({ currentPassword: initialPass, newPassword: 'FinalPass456!' })
        });
        const chJson: any = await chResp.json();
        assert(chResp.ok && chJson.success, `Change password failed for ${username}: ${JSON.stringify(chJson)}`);
        return chJson.token || loginJson.token;
      }
      return loginJson.token;
    }

    const tokenWithDel = await httpLogin(empWithDelUsername, 'TempPass123!');
    const tokenNoDel = await httpLogin(empNoDelUsername, 'TempPass123!');

    // HTTP RBAC check for delete_items
    const delHttpBuf = buildXlsxBuffer([['اسم الصنف'], ['غير_موجود_اختبار']]);
    const noDelHttpPreview = await fetch(`${baseUrl}/api/items/bulk-edit-excel/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenNoDel}` },
      body: JSON.stringify({
        operationType: 'delete_items',
        fileName: 'del-check.xlsx',
        fileBase64: delHttpBuf.toString('base64')
      })
    });
    assert(noDelHttpPreview.status === 403, `Expected HTTP 403 for user without items.delete, got ${noDelHttpPreview.status}`);

    // HTTP Part 2a: add_items with numeric 0, string "0", Arabic "٠", RTL mark "\u200f0", and empty cell ""
    const zeroItems = [
      { name: `صنف_صفر_رقمي_${suffix}`, bc: `ZR1${suffix}`, qty: 0 },
      { name: `صنف_صفر_نصي_${suffix}`, bc: `ZR2${suffix}`, qty: '0' },
      { name: `صنف_صفر_عربي_${suffix}`, bc: `ZR3${suffix}`, qty: '٠' },
      { name: `صنف_صفر_علامة_اتجاه_${suffix}`, bc: `ZR4${suffix}`, qty: '\u200f0' },
      { name: `صنف_صفر_فارغ_${suffix}`, bc: `ZR5${suffix}`, qty: '' }
    ];
    const addZeroBuf = buildXlsxBuffer([
      ['اسم الصنف', 'الباركود الرئيسي', 'الكمية', 'سعر البيع'],
      ...zeroItems.map(z => [z.name, z.bc, z.qty, 25])
    ]);

    const addZeroPrevResp = await fetch(`${baseUrl}/api/items/bulk-edit-excel/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenWithDel}` },
      body: JSON.stringify({
        operationType: 'add_items',
        fileName: 'add-zero-cases.xlsx',
        fileBase64: addZeroBuf.toString('base64')
      })
    });
    const addZeroPrev: any = await addZeroPrevResp.json();
    assert(
      addZeroPrevResp.ok && addZeroPrev.success && addZeroPrev.summary?.willUpdateCount === 5 && addZeroPrev.summary?.errorCount === 0,
      `add_items preview with 5 zero cases failed: ${JSON.stringify(addZeroPrev)}`
    );

    const addZeroExecResp = await fetch(`${baseUrl}/api/items/bulk-edit-excel/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenWithDel}` },
      body: JSON.stringify({
        operationType: 'add_items',
        fileName: 'add-zero-cases.xlsx',
        fileBase64: addZeroBuf.toString('base64')
      })
    });
    const addZeroExec: any = await addZeroExecResp.json();
    assert(
      addZeroExecResp.ok && addZeroExec.success && addZeroExec.updatedCount === 5 && addZeroExec.errorCount === 0,
      `add_items execute with 5 zero cases failed: ${JSON.stringify(addZeroExec)}`
    );

    // Check /api/items/paginated visibility (both default and stockStatus=OUT and Arabic status=نشط)
    for (const z of zeroItems) {
      const pagResp = await fetch(`${baseUrl}/api/items/paginated?search=${encodeURIComponent(z.name)}&status=${encodeURIComponent('نشط')}&stockStatus=OUT`, {
        headers: { Authorization: `Bearer ${tokenWithDel}` }
      });
      const pagJson: any = await pagResp.json();
      assert(
        pagResp.ok && pagJson.success && Array.isArray(pagJson.items) && pagJson.items.some((it: any) => it.name === z.name && Number(it.stockQuantity) === 0),
        `Zero-quantity imported item "${z.name}" must appear in /api/items/paginated: ${JSON.stringify(pagJson)}`
      );
    }

    // HTTP Part 2b: stock_quantity tests (5 -> 0, 0 -> 0 unchanged, 0 -> "\u200f٠" unchanged, 0 -> 3, negative qty rejection vs allowNegativeStockSale)
    const fiveItemName = `صنف_تصفير_من_5_${suffix}`;
    await executeBulkPriceEditExcel({
      operationType: 'add_items',
      fileName: 'add-5.xlsx',
      fileBase64: buildXlsxBuffer([['اسم الصنف', 'الباركود الرئيسي', 'الكمية'], [fiveItemName, `ZRFIVE${suffix}`, 5]]).toString('base64')
    }, designerSession);

    const qtyBuf = buildXlsxBuffer([
      ['اسم الصنف', 'الكمية الجديدة'],
      [fiveItemName, 0],                   // 5 -> 0 (will_update)
      [zeroItems[0].name, 0],              // 0 -> 0 (unchanged)
      [zeroItems[1].name, '\u200f٠'],      // 0 -> 0 Arabic+RTL (unchanged)
      [zeroItems[2].name, 3],              // 0 -> 3 (will_update)
      [zeroItems[3].name, -2]              // negative (error when disabled)
    ]);

    const prevNegOffResp = await fetch(`${baseUrl}/api/items/bulk-edit-excel/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenWithDel}` },
      body: JSON.stringify({
        operationType: 'stock_quantity',
        fileName: 'qty-test.xlsx',
        fileBase64: qtyBuf.toString('base64')
      })
    });
    const prevNegOff: any = await prevNegOffResp.json();
    assert(prevNegOffResp.ok && prevNegOff.success, `stock_quantity preview failed: ${JSON.stringify(prevNegOff)}`);

    const qRows = new Map<string, any>(prevNegOff.rows.map((r: any) => [r.inputName, r]));
    assert(qRows.get(fiveItemName)?.status === 'will_update' && qRows.get(fiveItemName)?.newPrice === 0 && String(qRows.get(fiveItemName)?.newValueDisplay).startsWith('0'), `5->0 should be will_update: ${JSON.stringify(qRows.get(fiveItemName))}`);
    assert(qRows.get(zeroItems[0].name)?.status === 'unchanged', `0->0 should be unchanged: ${JSON.stringify(qRows.get(zeroItems[0].name))}`);
    assert(qRows.get(zeroItems[1].name)?.status === 'unchanged', `0->\\u200f٠ should be unchanged: ${JSON.stringify(qRows.get(zeroItems[1].name))}`);
    assert(qRows.get(zeroItems[2].name)?.status === 'will_update' && qRows.get(zeroItems[2].name)?.newPrice === 3 && String(qRows.get(zeroItems[2].name)?.newValueDisplay).startsWith('3'), `0->3 should be will_update: ${JSON.stringify(qRows.get(zeroItems[2].name))}`);
    assert(qRows.get(zeroItems[3].name)?.status === 'error', `Negative qty should be rejected when negative stock setting is disabled: ${JSON.stringify(qRows.get(zeroItems[3].name))}`);

    // Execute stock_quantity and confirm 5 -> 0 and 0 -> 3 actually persisted
    const execQtyResp = await fetch(`${baseUrl}/api/items/bulk-edit-excel/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenWithDel}` },
      body: JSON.stringify({
        operationType: 'stock_quantity',
        fileName: 'qty-test.xlsx',
        fileBase64: qtyBuf.toString('base64')
      })
    });
    const execQty: any = await execQtyResp.json();
    assert(execQtyResp.ok && execQty.success && execQty.updatedCount === 2 && execQty.unchangedCount === 2 && execQty.errorCount === 1, `stock_quantity execute mismatch: ${JSON.stringify(execQty)}`);

    const afterItems = await getItems(designerSession);
    assert(afterItems.find(it => it.name === fiveItemName)?.stockQuantity === 0, 'fiveItemName must now have stock 0');
    assert(afterItems.find(it => it.name === zeroItems[2].name)?.stockQuantity === 3, 'zeroItems[2] must now have stock 3');

    // Negative stock test when enabled
    const prevStockSettings = getStockSettings();
    try {
      await saveStockSettings({ allowNegativeStockSale: true }, designerSession);
      const negAllowResp = await fetch(`${baseUrl}/api/items/bulk-edit-excel/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenWithDel}` },
        body: JSON.stringify({
          operationType: 'stock_quantity',
          fileName: 'qty-neg-allowed.xlsx',
          fileBase64: buildXlsxBuffer([['اسم الصنف', 'الكمية الجديدة'], [zeroItems[3].name, -2]]).toString('base64')
        })
      });
      const negAllowJson: any = await negAllowResp.json();
      assert(negAllowResp.ok && negAllowJson.success && negAllowJson.summary?.willUpdateCount === 1, `Negative stock should be allowed when setting enabled: ${JSON.stringify(negAllowJson)}`);
    } finally {
      await saveStockSettings(prevStockSettings, designerSession);
    }

    // Cleanup all created zero-test items via HTTP delete_items
    await executeBulkPriceEditExcel({
      operationType: 'stock_quantity',
      fileName: 'zero-z2.xlsx',
      fileBase64: buildXlsxBuffer([['اسم الصنف', 'الكمية الجديدة'], [zeroItems[2].name, 0]]).toString('base64')
    }, designerSession);

    const cleanupDelBuf = buildXlsxBuffer([
      ['اسم الصنف'],
      [fiveItemName],
      ...zeroItems.map(z => [z.name])
    ]);
    const httpDelResp = await fetch(`${baseUrl}/api/items/bulk-edit-excel/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenWithDel}` },
      body: JSON.stringify({
        operationType: 'delete_items',
        fileName: 'cleanup-del.xlsx',
        fileBase64: cleanupDelBuf.toString('base64')
      })
    });
    const httpDelJson: any = await httpDelResp.json();
    assert(httpDelResp.ok && httpDelJson.success && httpDelJson.updatedCount === 6, `HTTP delete_items cleanup failed: ${JSON.stringify(httpDelJson)}`);

    // Cleanup temp users
    if (u1Res.user?.id) await deleteUser(u1Res.user.id, designerSession);
    if (u2Res.user?.id) await deleteUser(u2Res.user.id, designerSession);

    console.log('  [PASS] Part 2 Zero Quantity & HTTP E2E Tests');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function main() {
  await runStaticUiChecks();
  await runPart1DeleteItemsTests();
  await runPart2ZeroQuantityAndHttpTests();
  console.log('\nALL TESTS PASSED SUCCESSFULLY (Bulk Delete Items + Zero Quantity Import/Update)');
}

main().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});

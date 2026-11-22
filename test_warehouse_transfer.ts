process.env.SKIP_SERVER_LISTEN = '1';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServerApp } from './server.ts';
import {
  saveUser,
  saveWarehouse,
  deleteWarehouse,
  getItems,
  getItemWarehouses,
  getStockSettings,
  saveStockSettings,
  getItemMovementReport,
  getAuditLogs
} from './server/sheetsService.ts';
import type { PermissionKey } from './src/types/index.ts';

async function httpLogin(baseUrl: string, username: string, password: string, setupNewPassword?: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (data.success && data.token && data.user?.mustChangePassword) {
    const setupRes = await fetch(`${baseUrl}/api/auth/complete-initial-setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.token}`
      },
      body: JSON.stringify({
        name: data.user.name || username,
        username,
        newPassword: setupNewPassword || `${password}_New1!`
      })
    });
    const setupData = await setupRes.json();
    assert.equal(setupRes.status, 200, `Initial setup failed for ${username}: ${setupData.error || ''}`);
  }
  return data;
}

async function apiJson(
  baseUrl: string,
  path: string,
  token: string,
  options: RequestInit = {}
) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function runTests() {
  console.log('=== Starting Warehouse Transfer & Dispatch Orders Tests ===');

  const { app } = await createServerApp({ attachVite: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Login as owner designer via HTTP /api/auth/login
    const adminLogin = await httpLogin(
      baseUrl,
      'admin',
      process.env.INITIAL_USER_PASSWORD || '1234',
      'Admin@NewPassword1'
    );
    assert.equal(adminLogin.success, true, 'Admin login failed');
    const adminToken = adminLogin.token!;
    const adminSession = {
      token: adminToken,
      role: adminLogin.user!.role,
      isOwner: true,
      userId: adminLogin.user!.id,
      id: adminLogin.user!.id,
      name: adminLogin.user!.name,
      permissions: adminLogin.user!.permissions
    };
    console.log('✓ 1. Logged in as designer');

    // 2. Create destination warehouse + stopped warehouse
    const whTagRes = await saveWarehouse(
      { name: 'مخزن التجمع الخامس', status: 'نشط', notes: 'فرع التجمع' },
      adminSession
    );
    assert.equal(whTagRes.success, true, 'Failed creating active destination warehouse');
    const tagWarehouse = whTagRes.warehouse!;

    const whStoppedRes = await saveWarehouse(
      { name: 'مخزن تحت الصيانة', status: 'موقوف', notes: 'موقوف للاختبار' },
      adminSession
    );
    assert.equal(whStoppedRes.success, true, 'Failed creating stopped warehouse');
    const stoppedWarehouse = whStoppedRes.warehouse!;

    const ctxRes = await apiJson(baseUrl, '/api/warehouse-transfers/context', adminToken);
    assert.equal(ctxRes.status, 200);
    assert.equal(ctxRes.data.success, true);
    const mainWh = (ctxRes.data.sourceWarehouses as any[]).find(w => w.isDefault);
    assert.ok(mainWh, 'Default main warehouse must exist');
    assert.equal(ctxRes.data.stockSettings.allowNegativeWarehouseTransfer, false, 'Negative warehouse transfer must default to false');
    console.log('✓ 2. Warehouses created & context verified');

    // 3. Pick 2 catalog items and verify initial balances
    const itemsList = await getItems(adminSession as any);
    assert.ok(itemsList.length >= 2, 'Need at least 2 items in catalog');
    const itemA = itemsList[0];
    const itemB = itemsList[1];

    const itemAWhBefore = await getItemWarehouses(itemA.id, adminSession as any);
    const itemBWhBefore = await getItemWarehouses(itemB.id, adminSession as any);
    const aMainBefore = itemAWhBefore.warehouses!.find(w => w.warehouseId === mainWh.id)!.quantity;
    const bMainBefore = itemBWhBefore.warehouses!.find(w => w.warehouseId === mainWh.id)!.quantity;
    const aTotalBefore = itemAWhBefore.totalStockQuantity!;
    const bTotalBefore = itemBWhBefore.totalStockQuantity!;
    assert.ok(aMainBefore >= 3 && bMainBefore >= 2, 'Test items must have initial stock >= 3 and >= 2');

    // 4. Verify allowNegativeWarehouseTransfer is separate from allowNegativeStockSale
    await saveStockSettings({ allowNegativeStockSale: true }, adminSession as any);
    assert.equal(getStockSettings().allowNegativeStockSale, true);
    assert.equal(getStockSettings().allowNegativeWarehouseTransfer, false, 'allowNegativeWarehouseTransfer must remain false even when allowNegativeStockSale is enabled');
    console.log('✓ 3. allowNegativeWarehouseTransfer confirmed independent of allowNegativeStockSale');

    // 5. Rejections BEFORE mutation
    // 5a. Same warehouse
    const sameWhRes = await apiJson(baseUrl, '/api/warehouse-transfers', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: mainWh.id,
        toWarehouseId: mainWh.id,
        lines: [{ itemId: itemA.id, quantity: 1 }],
        idempotencyKey: 'test-same-wh'
      })
    });
    assert.equal(sameWhRes.status, 400);
    assert.equal(sameWhRes.data.success, false);

    // 5b. Zero / negative quantity
    const zeroQtyRes = await apiJson(baseUrl, '/api/warehouse-transfers', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: mainWh.id,
        toWarehouseId: tagWarehouse.id,
        lines: [{ itemId: itemA.id, quantity: 0 }],
        idempotencyKey: 'test-zero-qty'
      })
    });
    assert.equal(zeroQtyRes.status, 400);

    const negQtyRes = await apiJson(baseUrl, '/api/warehouse-transfers', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: mainWh.id,
        toWarehouseId: tagWarehouse.id,
        lines: [{ itemId: itemA.id, quantity: -2 }],
        idempotencyKey: 'test-neg-qty'
      })
    });
    assert.equal(negQtyRes.status, 400);

    // 5c. Duplicate item in same dispatch order
    const dupItemRes = await apiJson(baseUrl, '/api/warehouse-transfers', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: mainWh.id,
        toWarehouseId: tagWarehouse.id,
        lines: [
          { itemId: itemA.id, quantity: 1 },
          { itemId: itemA.id, quantity: 1 }
        ],
        idempotencyKey: 'test-dup-item'
      })
    });
    assert.equal(dupItemRes.status, 400);

    // 5d. Stopped warehouse (source or destination)
    const stoppedDestRes = await apiJson(baseUrl, '/api/warehouse-transfers', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: mainWh.id,
        toWarehouseId: stoppedWarehouse.id,
        lines: [{ itemId: itemA.id, quantity: 1 }],
        idempotencyKey: 'test-stopped-dest'
      })
    });
    assert.equal(stoppedDestRes.status, 400);

    const stoppedSrcRes = await apiJson(baseUrl, '/api/warehouse-transfers', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: stoppedWarehouse.id,
        toWarehouseId: mainWh.id,
        lines: [{ itemId: itemA.id, quantity: 1 }],
        idempotencyKey: 'test-stopped-src'
      })
    });
    assert.equal(stoppedSrcRes.status, 400);

    // 5e. User without warehouses.transfer permission rejected (403)
    const noTransferUserRes = await saveUser(
      {
        username: 'viewer_only',
        name: 'مشاهد مخازن فقط',
        phone: '01011223344',
        role: 'employee',
        password: 'Pass@1234',
        status: 'active',
        permissions: ['warehouses.view', 'items.view'] as PermissionKey[],
        warehouseConfig: {
          allowedWarehouseIds: [mainWh.id, tagWarehouse.id],
          defaultWarehouseId: mainWh.id
        }
      },
      adminSession as any
    );
    assert.equal(noTransferUserRes.success, true);
    const noTransferLogin = await httpLogin(baseUrl, 'viewer_only', 'Pass@1234');
    assert.equal(noTransferLogin.success, true);

    const unauthTransferRes = await apiJson(baseUrl, '/api/warehouse-transfers', noTransferLogin.token!, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: mainWh.id,
        toWarehouseId: tagWarehouse.id,
        lines: [{ itemId: itemA.id, quantity: 1 }],
        idempotencyKey: 'test-unauth'
      })
    });
    assert.equal(unauthTransferRes.status, 403);
    console.log('✓ 4. All invalid/unauthorized transfer rejections verified');

    // 6. Atomic oversized rejection when allowNegativeWarehouseTransfer is false
    const atomicFailRes = await apiJson(baseUrl, '/api/warehouse-transfers', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: mainWh.id,
        toWarehouseId: tagWarehouse.id,
        lines: [
          { itemId: itemA.id, quantity: 1 }, // sufficient
          { itemId: itemB.id, quantity: bMainBefore + 50 } // insufficient
        ],
        idempotencyKey: 'test-atomic-fail'
      })
    });
    assert.equal(atomicFailRes.status, 400);
    assert.equal(atomicFailRes.data.success, false);
    assert.ok(Array.isArray(atomicFailRes.data.insufficientItems));
    assert.equal(atomicFailRes.data.insufficientItems.length, 1);
    assert.equal(atomicFailRes.data.insufficientItems[0].itemId, itemB.id);
    assert.equal(atomicFailRes.data.insufficientItems[0].available, bMainBefore);

    // Ensure itemA (sufficient line) was NOT touched!
    const itemAWhAfterFail = await getItemWarehouses(itemA.id, adminSession as any);
    assert.equal(
      itemAWhAfterFail.warehouses!.find(w => w.warehouseId === mainWh.id)!.quantity,
      aMainBefore,
      'Atomicity violation: itemA source balance changed after failed batch'
    );
    assert.equal(
      itemAWhAfterFail.warehouses!.find(w => w.warehouseId === tagWarehouse.id)!.quantity,
      0,
      'Atomicity violation: itemA destination balance changed after failed batch'
    );
    console.log('✓ 5. Atomic oversized rejection leaves zero partial changes');

    // 7. Successful transfer + idempotency + 2 movements + total conservation
    const idemKey1 = 'transfer-idem-001';
    const okRes1 = await apiJson(baseUrl, '/api/warehouse-transfers', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: mainWh.id,
        toWarehouseId: tagWarehouse.id,
        lines: [
          { itemId: itemA.id, quantity: 2 },
          { itemId: itemB.id, quantity: 1 }
        ],
        notes: 'ترحيل أولي للفرع',
        idempotencyKey: idemKey1
      })
    });
    assert.equal(okRes1.status, 200);
    assert.equal(okRes1.data.success, true);
    assert.equal(okRes1.data.duplicate, false);
    const order1 = okRes1.data.order;
    assert.equal(order1.dispatchNumber, 'DSP-0001');
    assert.equal(order1.itemsCount, 2);
    assert.equal(order1.totalQuantity, 3);
    assert.ok(typeof order1.totalPurchaseValue === 'number', 'Designer should receive totalPurchaseValue');

    // Duplicate same idempotencyKey -> must NOT deduct again
    const okResDup = await apiJson(baseUrl, '/api/warehouse-transfers', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: mainWh.id,
        toWarehouseId: tagWarehouse.id,
        lines: [
          { itemId: itemA.id, quantity: 2 },
          { itemId: itemB.id, quantity: 1 }
        ],
        idempotencyKey: idemKey1
      })
    });
    assert.equal(okResDup.status, 200);
    assert.equal(okResDup.data.duplicate, true);
    assert.equal(okResDup.data.order.dispatchNumber, 'DSP-0001');

    // Check balances & total conservation
    const itemAWhAfterOk = await getItemWarehouses(itemA.id, adminSession as any);
    const itemBWhAfterOk = await getItemWarehouses(itemB.id, adminSession as any);

    assert.equal(itemAWhAfterOk.warehouses!.find(w => w.warehouseId === mainWh.id)!.quantity, aMainBefore - 2);
    assert.equal(itemAWhAfterOk.warehouses!.find(w => w.warehouseId === tagWarehouse.id)!.quantity, 2);
    assert.equal(itemAWhAfterOk.totalStockQuantity, aTotalBefore, 'Total stock of itemA must remain constant');

    assert.equal(itemBWhAfterOk.warehouses!.find(w => w.warehouseId === mainWh.id)!.quantity, bMainBefore - 1);
    assert.equal(itemBWhAfterOk.warehouses!.find(w => w.warehouseId === tagWarehouse.id)!.quantity, 1);
    assert.equal(itemBWhAfterOk.totalStockQuantity, bTotalBefore, 'Total stock of itemB must remain constant');

    // Check 2 stock movements per line (in & out) via movement report
    const aMoveMain = await getItemMovementReport({ itemId: itemA.id, warehouseId: mainWh.id }, adminSession as any);
    const aMoveTag = await getItemMovementReport({ itemId: itemA.id, warehouseId: tagWarehouse.id }, adminSession as any);
    assert.ok(aMoveMain.report!.movements.some(r => r.documentNumber === 'DSP-0001' && r.movementType === 'تحويل_صادر' && r.outwardQty === 2));
    assert.ok(aMoveTag.report!.movements.some(r => r.documentNumber === 'DSP-0001' && r.movementType === 'تحويل_وارد' && r.inwardQty === 2));
    console.log('✓ 6. Normal transfer, idempotency, total conservation, and dual movements verified');

    // 8. Negative warehouse transfer when setting enabled
    const enableNegRes = await apiJson(baseUrl, '/api/settings/stock', adminToken, {
      method: 'POST',
      body: JSON.stringify({ allowNegativeWarehouseTransfer: true })
    });
    assert.equal(enableNegRes.status, 200);
    assert.equal(enableNegRes.data.settings.allowNegativeWarehouseTransfer, true);

    const aMainCurr = aMainBefore - 2;
    const negQtyTransfer = aMainCurr + 5;
    const negOkRes = await apiJson(baseUrl, '/api/warehouse-transfers', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: mainWh.id,
        toWarehouseId: tagWarehouse.id,
        lines: [{ itemId: itemA.id, quantity: negQtyTransfer }],
        idempotencyKey: 'transfer-neg-allowed'
      })
    });
    assert.equal(negOkRes.status, 200);
    assert.equal(negOkRes.data.order.dispatchNumber, 'DSP-0002');

    const itemAWhAfterNeg = await getItemWarehouses(itemA.id, adminSession as any);
    assert.equal(itemAWhAfterNeg.warehouses!.find(w => w.warehouseId === mainWh.id)!.quantity, -5);
    assert.equal(itemAWhAfterNeg.warehouses!.find(w => w.warehouseId === tagWarehouse.id)!.quantity, 2 + negQtyTransfer);
    assert.equal(itemAWhAfterNeg.totalStockQuantity, aTotalBefore, 'Total stock must stay constant even during negative warehouse transfer');
    console.log('✓ 7. Negative warehouse transfer succeeds when setting enabled and conserves total');

    // 9. Cost visibility stripped for user WITHOUT prices.view_purchase
    const clerkNoCostRes = await saveUser(
      {
        username: 'transfer_clerk_nocost',
        name: 'أمين مخزن بدون تكلفة',
        phone: '01022334455',
        role: 'employee',
        password: 'Clerk@1234',
        status: 'active',
        permissions: ['warehouses.transfer', 'warehouses.view', 'items.view'] as PermissionKey[],
        warehouseConfig: {
          allowedWarehouseIds: [mainWh.id, tagWarehouse.id],
          defaultWarehouseId: tagWarehouse.id
        }
      },
      adminSession as any
    );
    assert.equal(clerkNoCostRes.success, true);
    const clerkLogin = await httpLogin(baseUrl, 'transfer_clerk_nocost', 'Clerk@1234');
    assert.equal(clerkLogin.success, true);

    const clerkListRes = await apiJson(baseUrl, '/api/warehouse-transfers?dispatchNumber=DSP-0001', clerkLogin.token!);
    assert.equal(clerkListRes.status, 200);
    assert.equal(clerkListRes.data.orders.length, 1);
    const strippedOrder = clerkListRes.data.orders[0];
    assert.equal(strippedOrder.totalPurchaseValue, undefined, 'totalPurchaseValue must be stripped for user without prices.view_purchase');
    assert.equal(strippedOrder.lines[0].purchasePriceAtTransfer, undefined, 'purchasePriceAtTransfer must be stripped');
    assert.equal(strippedOrder.lines[0].lineTotalPurchase, undefined, 'lineTotalPurchase must be stripped');

    // Clerk executes a transfer back (2 -> mainWh) and gets stripped cost fields in response too
    const clerkTransferRes = await apiJson(baseUrl, '/api/warehouse-transfers', clerkLogin.token!, {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: tagWarehouse.id,
        toWarehouseId: mainWh.id,
        lines: [{ itemId: itemA.id, quantity: 3 }],
        idempotencyKey: 'clerk-transfer-003'
      })
    });
    assert.equal(clerkTransferRes.status, 200);
    assert.equal(clerkTransferRes.data.order.dispatchNumber, 'DSP-0003');
    assert.equal(clerkTransferRes.data.order.totalPurchaseValue, undefined);
    console.log('✓ 8. Purchase cost visibility strictly enforced');

    // 10. Filtering, pagination, audit logs, and delete warehouse protection
    const page1 = await apiJson(baseUrl, '/api/warehouse-transfers?page=1&pageSize=2', adminToken);
    assert.equal(page1.status, 200);
    assert.equal(page1.data.total, 3);
    assert.equal(page1.data.totalPages, 2);
    assert.equal(page1.data.orders.length, 2);

    const byFromWh = await apiJson(baseUrl, `/api/warehouse-transfers?fromWarehouseId=${encodeURIComponent(tagWarehouse.id)}`, adminToken);
    assert.equal(byFromWh.data.total, 1);
    assert.equal(byFromWh.data.orders[0].dispatchNumber, 'DSP-0003');

    const logs = await getAuditLogs(adminSession as any, { action: 'WAREHOUSE_TRANSFER' });
    assert.ok(logs.length >= 3, 'Audit logs must record WAREHOUSE_TRANSFER entries');

    const policyLogs = await getAuditLogs(adminSession as any, { action: 'SETTINGS_WAREHOUSE_TRANSFER_POLICY' });
    assert.ok(policyLogs.length >= 1, 'Audit logs must record SETTINGS_WAREHOUSE_TRANSFER_POLICY');

    const delRes = await deleteWarehouse(tagWarehouse.id, adminSession);
    assert.equal(delRes.success, false, 'Warehouse with transfers must not be deletable');
    console.log('✓ 9. Pagination, filtering, audit logs, and delete protection verified');

    console.log('=== ALL WAREHOUSE TRANSFER TESTS PASSED (9/9) ===');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

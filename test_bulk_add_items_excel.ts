process.env.SKIP_SERVER_LISTEN = '1';

import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

const MANDATORY_HEADERS = [
  'اسم الصنف',
  'الباركود الرئيسي'
];

const ALL_TEMPLATE_HEADERS = [
  'اسم الصنف',
  'اسم الطباعة',
  'الكمية',
  'التصنيف',
  'الباركود الرئيسي',
  'سعر البيع',
  'سعر الشراء',
  'وصف الصنف',
  'الوحدة',
  'الحد الأدنى للكمية',
  'المورد',
  'نسبة الضريبة',
  'الصورة'
];

async function requestJson(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: any
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function requestBuffer(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: any
): Promise<{ status: number; headers: Headers; buffer: Buffer }> {
  const reqHeaders: Record<string, string> = {};
  if (body !== undefined) reqHeaders['Content-Type'] = 'application/json';
  if (token) reqHeaders['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: reqHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const ab = await res.arrayBuffer();
  return { status: res.status, headers: res.headers, buffer: Buffer.from(ab) };
}

function makeWorkbookBase64(aoa: any[][], bookType: 'xlsx' | 'biff8' | 'csv'): string {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'إضافة أصناف');
  if (bookType === 'csv') {
    const csvStr = XLSX.utils.sheet_to_csv(ws);
    return Buffer.from(`\uFEFF${csvStr}`, 'utf8').toString('base64');
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
  return buf.toString('base64');
}

async function runTests() {
  console.log('=== Starting Bulk Add Items Excel Tests ===');

  const { createServerApp } = await import('./server');
  const { app } = await createServerApp({ attachVite: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Login as designer/admin using default initial password ('1234') and complete setup if needed
    const loginRes = await requestJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      username: 'admin',
      password: process.env.INITIAL_USER_PASSWORD || '1234'
    });
    assert.equal(loginRes.status, 200);
    const adminToken = loginRes.data.token as string;
    assert.ok(adminToken);

    if (loginRes.data.user?.mustChangePassword) {
      const setupRes = await requestJson(
        baseUrl,
        'POST',
        '/api/auth/complete-initial-setup',
        adminToken,
        {
          name: loginRes.data.user.name || 'مدير النظام',
          username: 'admin',
          newPassword: 'Admin@NewPassword1'
        }
      );
      assert.equal(setupRes.status, 200);
    }

    // 1. Download template & check 12 headers, example row, and text barcode formatting
    const tplRes = await requestBuffer(
      baseUrl,
      'GET',
      '/api/items/bulk-edit-excel/template?operationType=add_items',
      adminToken
    );
    assert.equal(tplRes.status, 200);
    const tplWb = XLSX.read(tplRes.buffer, { type: 'buffer', raw: true, cellNF: true });
    const tplSheet = tplWb.Sheets[tplWb.SheetNames[0]];
    const tplAoa = XLSX.utils.sheet_to_json<any[]>(tplSheet, { header: 1, defval: '' });
    assert.deepEqual(tplAoa[0], ALL_TEMPLATE_HEADERS, 'Template headers must match exact Arabic order');
    assert.ok(tplWb.SheetNames.length >= 2, 'Template must include a second sheet for examples & instructions');
    const guideSheet = tplWb.Sheets[tplWb.SheetNames[1]];
    const guideAoa = XLSX.utils.sheet_to_json<any[]>(guideSheet, { header: 1, defval: '' });
    assert.ok(String(guideAoa[1][0]).trim().length > 0, 'Guide sheet row 2 must contain an example item');
    assert.equal(guideSheet['E2']?.t, 's');
    assert.equal(guideSheet['E2']?.z, '@', 'Barcode column (E) in guide sheet must be text formatted');
    console.log('✓ 1. Template download headers, example guide sheet, and text barcode format (col E) verified');

    // Create category and secondary warehouse for isolation & uniqueness tests
    const catRes = await requestJson(baseUrl, 'POST', '/api/categories', adminToken, {
      name: 'ملحقات اختبارية'
    });
    assert.equal(catRes.status, 200);
    const testCategoryName = catRes.data.category.name as string;

    const whMainCtx = await requestJson(baseUrl, 'GET', '/api/warehouse-transfers/context', adminToken);
    assert.equal(whMainCtx.status, 200);
    const mainWh = whMainCtx.data.sourceWarehouses.find((w: any) => w.isDefault) || whMainCtx.data.sourceWarehouses[0];

    const branchWhRes = await requestJson(baseUrl, 'POST', '/api/warehouses', adminToken, {
      name: 'مخزن فرعي للإضافة',
      status: 'نشط'
    });
    assert.equal(branchWhRes.status, 200);
    const branchWh = branchWhRes.data.warehouse;

    // 2. Reject entire file if a mandatory column ('الباركود الرئيسي') is missing
    const missingColBase64 = makeWorkbookBase64(
      [
        ['اسم الصنف', 'اسم الطباعة', 'الكمية', 'التصنيف', 'سعر البيع', 'سعر الشراء'],
        ['منتج ناقص عمود', 'منتج', 5, testCategoryName, 100, 70]
      ],
      'xlsx'
    );
    const missingColPreview = await requestJson(
      baseUrl,
      'POST',
      '/api/items/bulk-edit-excel/preview',
      adminToken,
      {
        operationType: 'add_items',
        fileName: 'missing-col.xlsx',
        fileBase64: missingColBase64,
        warehouseId: branchWh.id
      }
    );
    assert.equal(missingColPreview.status, 400);
    assert.equal(missingColPreview.data.success, false);
    assert.ok(String(missingColPreview.data.error).includes('الباركود الرئيسي'));
    console.log('✓ 2. Missing mandatory column rejects entire file mentioning column name');

    // 3. Support .xlsx, .xls (BIFF8), and .csv formats cleanly (with mandatory columns only)
    for (const fmt of ['xlsx', 'biff8', 'csv'] as const) {
      const ext = fmt === 'biff8' ? 'xls' : fmt;
      const b64 = makeWorkbookBase64(
        [
          MANDATORY_HEADERS,
          [`منتج صيغة ${ext}`, `62200020000${ext === 'xlsx' ? '1' : ext === 'xls' ? '2' : '3'}`]
        ],
        fmt
      );
      const prevFmt = await requestJson(
        baseUrl,
        'POST',
        '/api/items/bulk-edit-excel/preview',
        adminToken,
        {
          operationType: 'add_items',
          fileName: `format.${ext}`,
          fileBase64: b64,
          warehouseId: branchWh.id
        }
      );
      assert.equal(prevFmt.status, 200, `${ext} format should preview successfully`);
      assert.equal(prevFmt.data.summary.willUpdateCount, 1);
    }
    console.log('✓ 3. .xlsx, .xls, and .csv file parsing verified');

    // Seed an existing item via items API to verify existing duplicate & barcode conflicts
    const existingItemRes = await requestJson(baseUrl, 'POST', '/api/items', adminToken, {
      name: 'بطارية محمولة أصلية',
      notes: 'صنف موجود مسبقاً',
      stockQuantity: 10,
      barcode: '6229990000011',
      secondaryBarcodes: ['6229990000022'],
      salePrice: 500,
      purchasePrice: 350,
      categoryId: catRes.data.category.id,
      categoryName: testCategoryName
    });
    assert.equal(existingItemRes.status, 200);

    // Build scientific notation workbook cell explicitly (column order:
    // اسم الصنف, اسم الطباعة, الكمية, التصنيف, الباركود الرئيسي, سعر البيع, سعر الشراء, وصف الصنف, الوحدة, الحد الأدنى للكمية, المورد, نسبة الضريبة)
    const wsComplex = XLSX.utils.aoa_to_sheet([
      ALL_TEMPLATE_HEADERS,
      // Row 2: Valid item + Arabic digits barcode + salePrice < purchasePrice warning (200 < 300)
      ['كابل شحن مضفر', 'كابل شحن 2م', 15, testCategoryName, '٦٢٢٣٣٣٠٠٠٠٠٠١', 200, 300, 'كابل عالي الجودة 2 متر', 'قطعة', 3, 'مورد النيل', 14],
      // Row 3: Invalid non-numeric سعر البيع (must be rejected, not coerced to 0)
      ['سماعة سلكية ستيريو', '', 10, testCategoryName, '6223330000002', 'غير رقمي', 80, 'وصف سماعة', '', '', '', ''],
      // Row 4: Normalized Arabic duplicate of existing item ('بطاريه محموله اصليه')
      ['بطاريه محموله اصليه', '', 5, testCategoryName, '6223330000003', 550, 400, 'وصف مكرر', '', '', '', ''],
      // Row 5: Duplicate secondary barcode of existing item
      ['حامل هاتف مكتبي', '', 8, testCategoryName, '6229990000022', 180, 110, 'حامل ألمنيوم', '', '', '', ''],
      // Row 6: Empty mandatory barcode cell
      ['باور بانك صغير', '', 6, testCategoryName, '', 400, 250, 'وصف', '', '', '', ''],
      // Row 7: Scientific notation barcode cell (column E)
      ['شاحن سيارة سريع', '', 7, testCategoryName, 6.22123e12, 220, 150, 'وصف شاحن', '', '', '', ''],
      // Row 8 & Row 9: Intra-file duplicate name
      ['قلم ذكي للتابلت', '', 3, testCategoryName, '6223330000088', 350, 220, 'وصف قلم 1', '', '', '', ''],
      ['قلم ذكي للتابلت', '', 4, testCategoryName, '6223330000089', 360, 220, 'وصف قلم 2', '', '', '', ''],
      // Row 10: Valid zero-quantity item with Arabic-normalized existing category ('ملحقات اختباريه')
      ['جراب حماية سيليكون', '', 0, 'ملحقات اختباريه', '6223330000010', 95, 45, 'جراب مرن شفاف', 'قطعة', 2, '', 0],
      // Row 11: Valid item with ONLY mandatory columns (all optional fields empty -> default to 0 / '')
      ['صنف بحقول إلزامية فقط', '', '', '', '6223330000011', '', '', '', '', '', '', '']
    ]);
    // Set Row 7 column E explicitly as numeric with scientific format
    wsComplex['E7'] = { t: 'n', v: 6221230000000, z: '0.00E+00', w: '6.22E+12' };
    const wbComplex = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbComplex, wsComplex, 'إضافة أصناف');
    const complexBase64 = (XLSX.write(wbComplex, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');

    const catsBeforeRes = await requestJson(baseUrl, 'GET', '/api/categories', adminToken);
    const catsCountBefore = catsBeforeRes.data.categories.length;

    const prevComplex = await requestJson(
      baseUrl,
      'POST',
      '/api/items/bulk-edit-excel/preview',
      adminToken,
      {
        operationType: 'add_items',
        fileName: 'complex-add.xlsx',
        fileBase64: complexBase64,
        warehouseId: branchWh.id
      }
    );
    assert.equal(prevComplex.status, 200);
    assert.equal(prevComplex.data.summary.totalRows, 10);
    assert.equal(prevComplex.data.summary.willUpdateCount, 3, 'Rows 2, 10, and 11 should pass');
    assert.equal(prevComplex.data.summary.errorCount, 7);
    assert.equal(prevComplex.data.summary.warningCount, 1, 'Row 2 triggers sale < purchase amber warning');

    const rMap = new Map<number, any>();
    for (const r of prevComplex.data.rows) rMap.set(r.rowNumber, r);

    assert.equal(rMap.get(2).status, 'will_update');
    assert.ok(String(rMap.get(2).warning || '').includes('سعر البيع'));
    assert.ok(String(rMap.get(2).newValueDisplay).includes('6223330000001'), 'Arabic digits converted to English');
    assert.equal(rMap.get(3).status, 'error');
    assert.ok(String(rMap.get(3).reason).includes('سعر البيع'));
    assert.equal(rMap.get(4).status, 'error');
    assert.equal(rMap.get(5).status, 'error');
    assert.equal(rMap.get(6).status, 'error');
    assert.ok(String(rMap.get(6).reason).includes('الباركود الرئيسي'));
    assert.equal(rMap.get(7).status, 'error');
    assert.ok(String(rMap.get(7).reason).includes('نسّق عمود الباركود كنص في الإكسيل'));
    assert.equal(rMap.get(8).status, 'error');
    assert.equal(rMap.get(9).status, 'error');
    assert.equal(rMap.get(10).status, 'will_update');
    assert.equal(rMap.get(11).status, 'will_update');
    console.log('✓ 4. All validation, Arabic normalization, duplicate, scientific barcode, optional defaults, and warning rules verified');

    // Execute complex file
    const execComplex = await requestJson(
      baseUrl,
      'POST',
      '/api/items/bulk-edit-excel/execute',
      adminToken,
      {
        operationType: 'add_items',
        fileName: 'complex-add.xlsx',
        fileBase64: complexBase64,
        warehouseId: branchWh.id
      }
    );
    assert.equal(execComplex.status, 200);
    assert.equal(execComplex.data.success, true);
    assert.equal(execComplex.data.updatedCount, 3);
    assert.equal(execComplex.data.errorCount, 7);

    // Verify Row 11 saved with defaults (0 for numbers, '' for text, no category)
    const execRow11 = execComplex.data.rows.find((r: any) => r.rowNumber === 11);
    assert.ok(execRow11?.itemId);
    const itemsAfterExec = await requestJson(baseUrl, 'GET', '/api/items', adminToken);
    const savedRow11 = itemsAfterExec.data.items.find((i: any) => i.id === execRow11.itemId);
    assert.equal(savedRow11.stockQuantity, 0);
    assert.equal(savedRow11.salePrice, 0);
    assert.equal(savedRow11.purchasePrice, 0);
    assert.equal(savedRow11.notes || '', '');

    // Categories count must remain untouched (no new category rows added here)
    const catsAfterRes = await requestJson(baseUrl, 'GET', '/api/categories', adminToken);
    assert.equal(catsAfterRes.data.categories.length, catsCountBefore, 'Categories count should remain untouched');

    // Verify warehouse isolation & opening movement on newly added item
    const execRow2 = execComplex.data.rows.find((r: any) => r.rowNumber === 2);
    assert.ok(execRow2?.itemId);
    const itemWhRes = await requestJson(
      baseUrl,
      'GET',
      `/api/items/${execRow2.itemId}/warehouses`,
      adminToken
    );
    assert.equal(itemWhRes.status, 200);
    const branchStockEntry = (itemWhRes.data.warehouses || []).find((s: any) => s.warehouseId === branchWh.id);
    const mainStockEntry = (itemWhRes.data.warehouses || []).find((s: any) => s.warehouseId === mainWh.id);
    assert.equal(branchStockEntry?.quantity, 15, 'Quantity must be added only in selected warehouse');
    assert.equal(mainStockEntry?.quantity || 0, 0, 'Other warehouse quantity must be 0');

    const movBranchRes = await requestJson(
      baseUrl,
      'GET',
      `/api/reports/item-movement?itemId=${encodeURIComponent(execRow2.itemId)}&warehouseId=${encodeURIComponent(branchWh.id)}`,
      adminToken
    );
    assert.equal(movBranchRes.status, 200);
    assert.ok(
      (movBranchRes.data.report?.movements || []).some(
        (m: any) => m.movementType === 'رصيد افتتاحي بالإكسيل' && m.inwardQty === 15
      ),
      'Opening balance movement must be recorded in target warehouse'
    );
    const movMainRes = await requestJson(
      baseUrl,
      'GET',
      `/api/reports/item-movement?itemId=${encodeURIComponent(execRow2.itemId)}&warehouseId=${encodeURIComponent(mainWh.id)}`,
      adminToken
    );
    assert.equal(movMainRes.status, 200);
    assert.equal((movMainRes.data.report?.movements || []).length, 0, 'Main warehouse must have zero movements');

    // Re-uploading the exact same file adds 0 items
    const reuploadExec = await requestJson(
      baseUrl,
      'POST',
      '/api/items/bulk-edit-excel/execute',
      adminToken,
      {
        operationType: 'add_items',
        fileName: 'complex-add.xlsx',
        fileBase64: complexBase64,
        warehouseId: branchWh.id
      }
    );
    assert.equal(reuploadExec.status, 400);
    assert.equal(reuploadExec.data.updatedCount, 0, 'Re-uploading same file must add 0 items');

    // Verify errors-file download contains the rejected rows with template headers + السبب
    const errorRowsOnly = execComplex.data.rows.filter((r: any) => r.status === 'error');
    const errFileRes = await requestBuffer(
      baseUrl,
      'POST',
      '/api/items/bulk-edit-excel/errors-file',
      adminToken,
      {
        operationType: 'add_items',
        fileName: 'complex-add.xlsx',
        rows: errorRowsOnly
      }
    );
    assert.equal(errFileRes.status, 200);
    const errWb = XLSX.read(errFileRes.buffer, { type: 'buffer' });
    const errAoa = XLSX.utils.sheet_to_json<any[]>(errWb.Sheets[errWb.SheetNames[0]], { header: 1 });
    assert.equal(errAoa.length, 8, '1 header + 7 error rows');
    assert.ok(errAoa[0].includes('السبب'), 'Error export must contain السبب column');

    // Verify audit log records user, count, warehouse, fileName
    const auditRes = await requestJson(baseUrl, 'GET', '/api/audit-logs', adminToken);
    assert.equal(auditRes.status, 200);
    const bulkAddLog = (auditRes.data.logs || []).find((l: any) => l.action === 'PRODUCTS_BULK_ADD_EXCEL');
    assert.ok(bulkAddLog, 'Audit log must include PRODUCTS_BULK_ADD_EXCEL');
    assert.ok(String(bulkAddLog.details).includes('complex-add.xlsx'));
    assert.ok(String(bulkAddLog.details).includes(branchWh.name));
    assert.ok(String(bulkAddLog.details).includes('3 صنف'));
    console.log('✓ 5. Execution, warehouse isolation, re-upload idempotency, error export, and audit log verified');

    // 6. Test employee without prices.view_purchase + unauthorized warehouse restriction
    const limitedUserRes = await requestJson(baseUrl, 'POST', '/api/users', adminToken, {
      name: 'موظف إدخال محدود',
      username: 'limited_adder',
      phone: '01099887766',
      role: 'employee',
      password: 'User@12345',
      mustChangePassword: false,
      permissions: ['products.bulk_edit_excel', 'items.create', 'items.view'],
      warehouseConfig: {
        allowedWarehouseIds: [mainWh.id],
        defaultWarehouseId: mainWh.id
      }
    });
    assert.equal(limitedUserRes.status, 200);

    const limitedLogin = await requestJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      username: 'limited_adder',
      password: 'User@12345'
    });
    assert.equal(limitedLogin.status, 200);
    const limitedToken = limitedLogin.data.token as string;

    // Unauthorized warehouse -> 403
    const unauthWhB64 = makeWorkbookBase64(
      [ALL_TEMPLATE_HEADERS, ['صنف لمخزن غير مصرح', '', 5, testCategoryName, '6225550000011', 100, 90, 'وصف', '', '', '', '']],
      'xlsx'
    );
    const unauthWhRes = await requestJson(
      baseUrl,
      'POST',
      '/api/items/bulk-edit-excel/preview',
      limitedToken,
      {
        operationType: 'add_items',
        fileName: 'unauth-wh.xlsx',
        fileBase64: unauthWhB64,
        warehouseId: branchWh.id
      }
    );
    assert.equal(unauthWhRes.status, 403);

    // Without categories.manage, non-existent category is rejected and NOT auto-created
    const noCatPermB64 = makeWorkbookBase64(
      [ALL_TEMPLATE_HEADERS, ['صنف بتصنيف غير موجود', '', 5, 'تصنيف غير موجود نهائياً', '6225550000019', 100, 50, '', '', '', '', '']],
      'xlsx'
    );
    const noCatPermPrev = await requestJson(
      baseUrl,
      'POST',
      '/api/items/bulk-edit-excel/preview',
      limitedToken,
      {
        operationType: 'add_items',
        fileName: 'no-cat-perm.xlsx',
        fileBase64: noCatPermB64
      }
    );
    assert.equal(noCatPermPrev.status, 200);
    assert.equal(noCatPermPrev.data.rows[0].status, 'error');
    const catsAfterLimited = await requestJson(baseUrl, 'GET', '/api/categories', adminToken);
    assert.equal(catsAfterLimited.data.categories.length, catsCountBefore, 'Non-admin missing category must NOT auto-create');

    // Without prices.view_purchase, no purchase-price warning leaks & purchasePrice saved as 0 (even when warehouseId omitted -> uses user's defaultWarehouseId = mainWh.id)
    const noCostB64 = makeWorkbookBase64(
      [ALL_TEMPLATE_HEADERS, ['منتج بدون صلاحية شراء', '', 9, testCategoryName, '6225550000022', 100, 250, 'وصف منتج', '', '', '', '']],
      'xlsx'
    );
    const noCostPrev = await requestJson(
      baseUrl,
      'POST',
      '/api/items/bulk-edit-excel/preview',
      limitedToken,
      {
        operationType: 'add_items',
        fileName: 'no-cost.xlsx',
        fileBase64: noCostB64
      }
    );
    assert.equal(noCostPrev.status, 200);
    assert.equal(noCostPrev.data.warehouseId, mainWh.id);
    assert.equal(noCostPrev.data.summary.warningCount, 0, 'Must not leak sale < purchase warning without cost perm');
    assert.ok(!String(noCostPrev.data.rows[0].newValueDisplay).includes('الشراء:'));

    const noCostExec = await requestJson(
      baseUrl,
      'POST',
      '/api/items/bulk-edit-excel/execute',
      limitedToken,
      {
        operationType: 'add_items',
        fileName: 'no-cost.xlsx',
        fileBase64: noCostB64
      }
    );
    assert.equal(noCostExec.status, 200);
    const createdLimitedItemId = noCostExec.data.rows[0].itemId;
    const allItemsAdmin = await requestJson(baseUrl, 'GET', '/api/items', adminToken);
    const limitedSavedItem = allItemsAdmin.data.items.find((i: any) => i.id === createdLimitedItemId);
    assert.equal(limitedSavedItem.purchasePrice, 0, 'Purchase price must save as 0 when user lacks prices.view_purchase');
    console.log('✓ 6. Unauthorized warehouse 403 + cost permission protection verified');

    // 7. Max 5000 rows boundary
    const rows5001: Array<{ rowNumber: number; name: string; values: Record<string, any> }> = [];
    for (let i = 1; i <= 5001; i++) {
      rows5001.push({
        rowNumber: i + 1,
        name: `صنف حد أقصى ${i}`,
        values: {
          notes: 'وصف',
          stockQuantity: 1,
          barcode: `622888${String(i).padStart(7, '0')}`,
          salePrice: 100,
          purchasePrice: 50,
          rootCategory: testCategoryName
        }
      });
    }
    const overLimitRes = await requestJson(
      baseUrl,
      'POST',
      '/api/items/bulk-edit-excel/preview',
      adminToken,
      {
        operationType: 'add_items',
        fileName: '5001.xlsx',
        rows: rows5001,
        warehouseId: mainWh.id
      }
    );
    assert.equal(overLimitRes.status, 400);
    assert.ok(String(overLimitRes.data.error).includes('5000'));

    const rows5000Res = await requestJson(
      baseUrl,
      'POST',
      '/api/items/bulk-edit-excel/preview',
      adminToken,
      {
        operationType: 'add_items',
        fileName: '5000.xlsx',
        rows: rows5001.slice(0, 5000),
        warehouseId: mainWh.id
      }
    );
    assert.equal(rows5000Res.status, 200);
    assert.equal(rows5000Res.data.summary.willUpdateCount, 5000);
    console.log('✓ 7. 5000-row limit boundary verified');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  console.log('=== ALL BULK ADD ITEMS EXCEL TESTS PASSED (7/7) ===');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

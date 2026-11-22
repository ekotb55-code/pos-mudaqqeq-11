process.env.SKIP_SERVER_LISTEN = '1';

import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { createServerApp } from './server';
import {
  WAREHOUSE_EXCEL_MAX_ROWS,
  buildWarehouseTransferErrorsWorkbook,
  buildWarehouseTransferTemplateWorkbook,
  evaluateWarehouseExcelRows,
  parseWarehouseTransferExcelBuffer
} from './src/utils/warehouseExcelTransfer';
import { Item } from './src/types';

async function requestJson(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: any
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function makeWorkbookBytes(
  aoa: any[][],
  bookType: 'xlsx' | 'biff8' | 'csv'
): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  if (bookType === 'csv') {
    const csvStr = XLSX.utils.sheet_to_csv(ws);
    return new TextEncoder().encode(`\uFEFF${csvStr}`);
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
  return new Uint8Array(buf);
}

async function runTests() {
  console.log('=== Starting Warehouse Excel Transfer Tests ===');

  // 1. Template workbook structure
  const templateWb = buildWarehouseTransferTemplateWorkbook();
  const templateWs = templateWb.Sheets[templateWb.SheetNames[0]];
  const templateAoa = XLSX.utils.sheet_to_json<any[]>(templateWs, { header: 1 });
  assert.deepEqual(templateAoa[0], ['اسم الصنف', 'الكمية', 'الباركود']);
  assert.equal(templateWb.Workbook?.Views?.[0]?.RTL, true);
  console.log('✓ 1. Template workbook headers & RTL verified');

  // 2. .xls (97-2003 BIFF8), .xlsx, and .csv read to identical parsed rows
  const sampleAoa = [
    ['اسم الصنف', 'الكمية', 'الباركود'],
    ['شاي أحمد الأخضر', 5, '622100001'],
    ['قهوة تركية سادة', 3.5, ''],
    ['مستحضر ندى', 10, '']
  ];
  const xlsxBytes = makeWorkbookBytes(sampleAoa, 'xlsx');
  const xlsBytes = makeWorkbookBytes(sampleAoa, 'biff8');
  const csvBytes = makeWorkbookBytes(sampleAoa, 'csv');

  const parsedXlsx = parseWarehouseTransferExcelBuffer(xlsxBytes, 'transfer.xlsx');
  const parsedXls = parseWarehouseTransferExcelBuffer(xlsBytes, 'transfer.xls');
  const parsedCsv = parseWarehouseTransferExcelBuffer(csvBytes, 'transfer.csv');

  assert.equal(parsedXlsx.ok, true, 'xlsx should parse');
  assert.equal(parsedXls.ok, true, 'xls should parse');
  assert.equal(parsedCsv.ok, true, 'csv should parse');
  if (!parsedXlsx.ok || !parsedXls.ok || !parsedCsv.ok) throw new Error('Parse failed');

  assert.deepEqual(
    parsedXls.rows,
    parsedXlsx.rows,
    '.xls (97-2003) and .xlsx MUST parse into the exact same result'
  );
  assert.deepEqual(
    parsedCsv.rows,
    parsedXlsx.rows,
    '.csv and .xlsx MUST parse into the exact same result'
  );
  console.log('✓ 2. .xls, .xlsx, and .csv produce identical parsed rows');

  // 3. Matching priority: barcode first, otherwise Arabic-normalized name (أ/إ/آ→ا, ة→ه, ى→ي)
  const sampleItems: Item[] = [
    {
      id: 'item-1',
      name: 'شاي أحمد الأخضر',
      sku: 'SKU-1',
      barcode: '622100001',
      salePrice: 50,
      purchasePrice: 35,
      stockQuantity: 10,
      status: 'active',
      unit: 'علبة'
    },
    {
      id: 'item-2',
      name: 'قهوة تركية سادة',
      sku: 'SKU-2',
      barcode: '622100002',
      salePrice: 80,
      purchasePrice: 55,
      stockQuantity: 4,
      status: 'active',
      unit: 'كيس'
    },
    {
      id: 'item-3',
      name: 'مستحضر ندى',
      sku: 'SKU-3',
      barcode: '622100003',
      salePrice: 120,
      purchasePrice: 90,
      stockQuantity: 8,
      status: 'active',
      unit: 'عبوة'
    }
  ];

  const matchCheckAoa = [
    ['اسم الصنف', 'الكمية', 'الباركود'],
    // Barcode matches item-1 even though name text is omitted
    ['', 2, '622100001'],
    // Name uses هـ instead of ة and ي instead of ى -> matches item-2 and item-3 via Arabic normalization
    ['قهوه تركيه ساده', 1, ''],
    ['مستحضر ندي', 3, '']
  ];
  const parsedNorm = parseWarehouseTransferExcelBuffer(
    makeWorkbookBytes(matchCheckAoa, 'xls'),
    'arabic-norm.xls'
  );
  assert.equal(parsedNorm.ok, true);
  if (!parsedNorm.ok) throw new Error('Normalize parse failed');

  const evalNorm = evaluateWarehouseExcelRows({
    parsedRows: parsedNorm.rows,
    catalogItems: sampleItems,
    stocksMap: {
      'item-1': { fromStock: 10, toStock: 0 },
      'item-2': { fromStock: 4, toStock: 0 },
      'item-3': { fromStock: 8, toStock: 0 }
    },
    allowNegativeWarehouseTransfer: false
  });
  assert.equal(evalNorm.summary.readyCount, 3);
  assert.equal(evalNorm.summary.errorCount, 0);
  assert.equal(evalNorm.summary.canExecute, true);
  assert.equal(evalNorm.rows[0].itemId, 'item-1');
  assert.equal(evalNorm.rows[0].matchedBy, 'barcode');
  assert.equal(evalNorm.rows[1].itemId, 'item-2');
  assert.equal(evalNorm.rows[1].matchedBy, 'name');
  assert.equal(evalNorm.rows[2].itemId, 'item-3');
  assert.equal(evalNorm.rows[2].matchedBy, 'name');
  console.log('✓ 3. Barcode priority & Arabic normalization (أ/إ/آ→ا، ة→ه، ى→ي) verified');

  // 4. All error statuses & blocking behavior + resolution (delete + use available stock) + error export
  const complexAoa = [
    ['اسم الصنف', 'الكمية', 'الباركود'],
    ['شاي أحمد الأخضر', 3, '622100001'],      // row 2: ready
    ['صنف غير موجود اطلاقا', 2, ''],          // row 3: not_found
    ['شاي احمد الاخضر', 1, ''],               // row 4: duplicate of item-1
    ['قهوة تركية سادة', 15, '622100002'],     // row 5: insufficient_stock (requested 15 > available 4)
    ['مستحضر ندى', 0, '622100003']            // row 6: invalid_quantity (0)
  ];
  const parsedComplex = parseWarehouseTransferExcelBuffer(
    makeWorkbookBytes(complexAoa, 'xlsx'),
    'complex.xlsx'
  );
  assert.equal(parsedComplex.ok, true);
  if (!parsedComplex.ok) throw new Error('Complex parse failed');

  const stocksComplex = {
    'item-1': { fromStock: 10, toStock: 1 },
    'item-2': { fromStock: 4, toStock: 2 },
    'item-3': { fromStock: 8, toStock: 0 }
  };

  const evalComplex = evaluateWarehouseExcelRows({
    parsedRows: parsedComplex.rows,
    catalogItems: sampleItems,
    stocksMap: stocksComplex,
    allowNegativeWarehouseTransfer: false
  });

  assert.equal(evalComplex.rows[0].status, 'ready');
  assert.equal(evalComplex.rows[1].status, 'not_found');
  assert.equal(evalComplex.rows[2].status, 'duplicate');
  assert.equal(evalComplex.rows[3].status, 'insufficient_stock');
  assert.equal(evalComplex.rows[3].canUseAvailableStock, true);
  assert.equal(evalComplex.rows[4].status, 'invalid_quantity');
  assert.equal(evalComplex.summary.errorCount, 4);
  assert.equal(evalComplex.summary.canExecute, false);

  // Verify error workbook export contains all 4 error rows
  const errRows = evalComplex.rows.filter(r => r.status !== 'ready');
  const errWb = buildWarehouseTransferErrorsWorkbook(errRows);
  const errAoa = XLSX.utils.sheet_to_json<any[]>(errWb.Sheets[errWb.SheetNames[0]], { header: 1 });
  assert.equal(errAoa.length, 5, '1 header + 4 error rows');
  assert.equal(errAoa[1][5], 'غير موجود');
  assert.equal(errAoa[2][5], 'مكرر في الملف');
  assert.equal(errAoa[3][5], 'الكمية لا تكفي');
  assert.equal(errAoa[4][5], 'كمية غير صالحة');

  // Fix: delete row 3 (not_found), row 4 (duplicate), row 6 (invalid_quantity), and still keep row 5 oversized -> still blocked!
  let editedParsed = parsedComplex.rows.filter(r => ![3, 4, 6].includes(r.rowNumber));
  let evalMid = evaluateWarehouseExcelRows({
    parsedRows: editedParsed,
    catalogItems: sampleItems,
    stocksMap: stocksComplex,
    allowNegativeWarehouseTransfer: false
  });
  assert.equal(evalMid.summary.canExecute, false, 'Oversized row MUST still block execution');
  assert.equal(evalMid.summary.insufficientCount, 1);

  // Now click "استخدم الكمية المتاحة" on row 5 (available = 4)
  editedParsed = editedParsed.map(r =>
    r.rowNumber === 5 ? { ...r, rawQuantity: '4', parsedQuantity: 4 } : r
  );
  const evalFixed = evaluateWarehouseExcelRows({
    parsedRows: editedParsed,
    catalogItems: sampleItems,
    stocksMap: stocksComplex,
    allowNegativeWarehouseTransfer: false
  });
  assert.equal(evalFixed.summary.errorCount, 0);
  assert.equal(evalFixed.summary.readyCount, 2);
  assert.equal(evalFixed.summary.canExecute, true);
  console.log('✓ 4. Preview error states, blocking, error file export & correction workflow verified');

  // 5. 2000-row limit enforcement
  const rows2000: any[][] = [['اسم الصنف', 'الكمية']];
  for (let i = 1; i <= WAREHOUSE_EXCEL_MAX_ROWS; i++) {
    rows2000.push([`صنف ${i}`, 1]);
  }
  const parsed2000 = parseWarehouseTransferExcelBuffer(
    makeWorkbookBytes(rows2000, 'xlsx'),
    '2000.xlsx'
  );
  assert.equal(parsed2000.ok, true, 'Exactly 2000 rows must be accepted');

  const rows2001 = [...rows2000, ['صنف 2001', 1]];
  const parsed2001 = parseWarehouseTransferExcelBuffer(
    makeWorkbookBytes(rows2001, 'xlsx'),
    '2001.xlsx'
  );
  assert.equal(parsed2001.ok, false, '2001 rows must be rejected');
  if (!parsed2001.ok) {
    assert.ok(parsed2001.error.includes('2000'), 'Error should mention 2000 row limit');
  }
  console.log('✓ 5. Max 2000-row validation verified');

  // 6. Real HTTP end-to-end integration test via createServerApp()
  const { app } = await createServerApp({ attachVite: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const loginRes = await requestJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      username: 'admin',
      password: process.env.INITIAL_USER_PASSWORD || '1234'
    });
    assert.equal(loginRes.status, 200);
    const token = loginRes.data.token as string;
    assert.ok(token);

    if (loginRes.data.user?.mustChangePassword) {
      const setupRes = await requestJson(baseUrl, 'POST', '/api/auth/complete-initial-setup', token, {
        name: loginRes.data.user.name || 'مدير النظام',
        username: 'admin',
        newPassword: 'Admin@NewPassword1'
      });
      assert.equal(setupRes.status, 200);
    }

    // Get default warehouse + create branch warehouse
    const whCtxRes = await requestJson(baseUrl, 'GET', '/api/warehouse-transfers/context', token);
    assert.equal(whCtxRes.status, 200);
    const mainWh = whCtxRes.data.sourceWarehouses.find((w: any) => w.isDefault) || whCtxRes.data.sourceWarehouses[0];

    const branchRes = await requestJson(baseUrl, 'POST', '/api/warehouses', token, {
      name: 'مخزن إكسيل تجريبي',
      status: 'نشط'
    });
    assert.equal(branchRes.status, 200);
    const branchWh = branchRes.data.warehouse;

    // Fetch live items & stocks
    const itemsRes = await requestJson(baseUrl, 'GET', '/api/items', token);
    assert.equal(itemsRes.status, 200);
    const catalog = itemsRes.data.items as Item[];
    assert.ok(catalog.length >= 2);
    const firstItem = catalog[0];
    const secondItem = catalog[1];

    // Ensure known stocks in mainWh
    await requestJson(baseUrl, 'POST', `/api/items/${firstItem.id}/adjust-stock`, token, {
      warehouseId: mainWh.id,
      newQuantity: 20,
      reason: 'تهيئة اختبار النقل بالإكسيل'
    });
    await requestJson(baseUrl, 'POST', `/api/items/${secondItem.id}/adjust-stock`, token, {
      warehouseId: mainWh.id,
      newQuantity: 7,
      reason: 'تهيئة اختبار النقل بالإكسيل'
    });

    const stocksRes = await requestJson(
      baseUrl,
      'GET',
      `/api/warehouse-transfers/stocks?fromWarehouseId=${encodeURIComponent(mainWh.id)}&toWarehouseId=${encodeURIComponent(branchWh.id)}`,
      token
    );
    assert.equal(stocksRes.status, 200);
    const liveStocks = stocksRes.data.stocks;

    // Build .xls file with 1 valid row, 1 not_found row, and 1 oversized row
    const e2eAoa = [
      ['اسم الصنف', 'الكمية', 'الباركود'],
      [firstItem.name, 5, firstItem.barcode || ''],
      ['صنف وهمي غير موجود', 2, ''],
      [secondItem.name, 99, ''] // 99 > available 7
    ];
    const e2eParsedXls = parseWarehouseTransferExcelBuffer(
      makeWorkbookBytes(e2eAoa, 'biff8'),
      'e2e.xls'
    );
    const e2eParsedXlsx = parseWarehouseTransferExcelBuffer(
      makeWorkbookBytes(e2eAoa, 'xlsx'),
      'e2e.xlsx'
    );
    assert.equal(e2eParsedXls.ok, true);
    assert.equal(e2eParsedXlsx.ok, true);
    if (!e2eParsedXls.ok || !e2eParsedXlsx.ok) throw new Error('E2E parse failed');
    assert.deepEqual(e2eParsedXls.rows, e2eParsedXlsx.rows);

    const e2eEvalInitial = evaluateWarehouseExcelRows({
      parsedRows: e2eParsedXls.rows,
      catalogItems: catalog,
      stocksMap: liveStocks,
      allowNegativeWarehouseTransfer: false
    });
    assert.equal(e2eEvalInitial.summary.canExecute, false);
    assert.equal(e2eEvalInitial.rows[1].status, 'not_found');
    assert.equal(e2eEvalInitial.rows[2].status, 'insufficient_stock');

    // User fixes: deletes not_found row (row 3) and applies "استخدم الكمية المتاحة" on row 4 (available = 7)
    const fixedParsedRows = e2eParsedXls.rows
      .filter(r => r.rowNumber !== 3)
      .map(r => (r.rowNumber === 4 ? { ...r, parsedQuantity: 7, rawQuantity: '7' } : r));

    const e2eEvalFixed = evaluateWarehouseExcelRows({
      parsedRows: fixedParsedRows,
      catalogItems: catalog,
      stocksMap: liveStocks,
      allowNegativeWarehouseTransfer: false
    });
    assert.equal(e2eEvalFixed.summary.canExecute, true);

    // Execute via existing dispatch order endpoint (same function!)
    const ordersBeforeRes = await requestJson(baseUrl, 'GET', '/api/warehouse-transfers', token);
    const countBefore = ordersBeforeRes.data.total || 0;

    const createRes = await requestJson(baseUrl, 'POST', '/api/warehouse-transfers', token, {
      fromWarehouseId: mainWh.id,
      toWarehouseId: branchWh.id,
      lines: e2eEvalFixed.rows.map(r => ({
        itemId: r.itemId!,
        quantity: r.requestedQuantity!
      })),
      notes: 'نقل بالإكسيل (e2e.xls)',
      idempotencyKey: `excel-e2e-${Date.now()}`
    });
    assert.equal(createRes.status, 200);
    assert.equal(createRes.data.success, true);
    assert.equal(createRes.data.order.itemsCount, 2);
    assert.equal(createRes.data.order.totalQuantity, 12);

    const ordersAfterRes = await requestJson(baseUrl, 'GET', '/api/warehouse-transfers', token);
    assert.equal(ordersAfterRes.data.total, countBefore + 1, 'Exactly ONE dispatch order created');

    const stocksAfterRes = await requestJson(
      baseUrl,
      'GET',
      `/api/warehouse-transfers/stocks?fromWarehouseId=${encodeURIComponent(mainWh.id)}&toWarehouseId=${encodeURIComponent(branchWh.id)}`,
      token
    );
    assert.equal(stocksAfterRes.data.stocks[firstItem.id].fromStock, 15);
    assert.equal(stocksAfterRes.data.stocks[firstItem.id].toStock, 5);
    assert.equal(stocksAfterRes.data.stocks[secondItem.id].fromStock, 0);
    assert.equal(stocksAfterRes.data.stocks[secondItem.id].toStock, 7);

    console.log('✓ 6. E2E HTTP execution via existing dispatch order endpoint verified');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  console.log('=== ALL WAREHOUSE EXCEL TRANSFER TESTS PASSED (6/6) ===');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

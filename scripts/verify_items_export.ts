import zlib from 'zlib';
import * as XLSX from 'xlsx';
import {
  getItems,
  saveItem,
  deleteItem,
  exportAllItemsExcelBuffer,
  getAuditLogs
} from '../server/sheetsService.ts';
import type { PermissionKey } from '../src/types/index.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function getExpectedCairoDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/**
 * استخراج نص xml من داخل ملف zip (.xlsx) للتحقق من rightToLeft و frozen top row
 */
function extractWorksheetXmlFromXlsx(zipBuf: Buffer, targetFileName = 'xl/worksheets/sheet1.xml'): string {
  const eocdSig = 0x06054b50;
  let eocdOff = -1;
  for (let i = Math.max(0, zipBuf.length - 65557); i <= zipBuf.length - 22; i++) {
    if (zipBuf.readUInt32LE(i) === eocdSig) {
      eocdOff = i;
      break;
    }
  }
  assert(eocdOff >= 0, 'Valid ZIP EOCD signature must exist in .xlsx buffer');

  const cdOffset = zipBuf.readUInt32LE(eocdOff + 16);
  const cdSize = zipBuf.readUInt32LE(eocdOff + 12);
  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;

  while (pos < cdEnd) {
    assert(zipBuf.readUInt32LE(pos) === 0x02014b50, 'Valid Central Directory signature');
    const compMethod = zipBuf.readUInt16LE(pos + 10);
    const compSize = zipBuf.readUInt32LE(pos + 20);
    const nameLen = zipBuf.readUInt16LE(pos + 28);
    const extraLen = zipBuf.readUInt16LE(pos + 30);
    const commentLen = zipBuf.readUInt16LE(pos + 32);
    const localOff = zipBuf.readUInt32LE(pos + 42);
    const name = zipBuf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');

    if (name === targetFileName) {
      const localNameLen = zipBuf.readUInt16LE(localOff + 26);
      const localExtraLen = zipBuf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + localNameLen + localExtraLen;
      const compData = zipBuf.subarray(dataStart, dataStart + compSize);
      const raw = compMethod === 8 ? zlib.inflateRawSync(compData) : compData;
      return raw.toString('utf8');
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }

  throw new Error(`${targetFileName} not found inside .xlsx archive`);
}

const designerSession = {
  id: 'verify-designer',
  userId: 'verify-designer',
  name: 'مصمم النظام',
  phone: '01000000001',
  role: 'designer' as const,
  isOwner: true,
  permissions: [
    'items.view',
    'items.create',
    'items.edit',
    'items.delete',
    'products.export',
    'prices.view_purchase',
    'prices.view_packaging'
  ] as PermissionKey[]
};

const exportNoCostSession = {
  id: 'verify-exporter-no-cost',
  userId: 'verify-exporter-no-cost',
  name: 'موظف تصدير بدون تكلفة',
  phone: '01000000002',
  role: 'employee' as const,
  isOwner: false,
  permissions: ['items.view', 'products.export'] as PermissionKey[]
};

const unauthorizedExporterSession = {
  id: 'verify-no-export-perm',
  userId: 'verify-no-export-perm',
  name: 'موظف بدون صلاحية تصدير',
  phone: '01000000003',
  role: 'employee' as const,
  isOwner: false,
  permissions: ['items.view', 'prices.view_purchase'] as PermissionKey[]
};

async function runVerification() {
  console.log('--- Verifying Inventory Excel Export (65/65 items, formatting, permissions, audit log) ---');

  const initialAll = await getItems(designerSession);
  const initialCount = initialAll.length;
  console.log(`Initial items count: ${initialCount}`);

  const createdIds: string[] = [];
  const neededFor65 = Math.max(0, 65 - initialCount);

  try {
    for (let i = 1; i <= neededFor65; i++) {
      const idxStr = String(i).padStart(3, '0');
      const isSpecialLeadZero = i === 1;
      const res = await saveItem(
        {
          name: `صنف اختبار التصدير ${idxStr}`,
          sku: `EXP-${idxStr}`,
          barcode: isSpecialLeadZero ? '00622111000999' : `62299900${idxStr}`,
          secondaryBarcodes: isSpecialLeadZero ? ['00622111000888', '622111000777'] : [],
          supplier: i <= 20 ? 'مورد التصدير أ' : 'مورد التصدير ب',
          unit: 'قطعة',
          salePrice: 120.5 + i,
          minPrice: 100 + i,
          purchasePrice: 70 + i,
          packagingCost: 6,
          stockQuantity: 10 + (i % 7),
          reorderLimit: 4,
          taxRate: 14,
          notes: `وصف الصنف رقم ${idxStr}`,
          enableBnpl: i % 2 === 0,
          bnplPercentage: i % 2 === 0 ? 5.5 : 0,
          pickupFee: 3.25,
          imageUrl: i === 1 ? 'https://example.com/item-001.jpg' : '',
          status: 'نشط'
        },
        designerSession
      );
      assert(res.success && res.item?.id, `Failed creating export test item #${i}: ${res.error}`);
      createdIds.push(res.item!.id);
    }

    const all65 = await getItems(designerSession);
    assert(all65.length === 65, `Expected 65 items in store, got ${all65.length}`);

    // 1) تصدير كامل بصلاحية مصمم النظام (تشمل التكلفة)
    const exportRes = await exportAllItemsExcelBuffer(designerSession);
    assert(exportRes.success && exportRes.buffer, `Expected successful export buffer: ${exportRes.error}`);
    assert(exportRes.totalItems === 65, `Expected totalItems=65, got ${exportRes.totalItems}`);

    const expectedDate = getExpectedCairoDate();
    assert(
      exportRes.fileName === `أصناف-المخزن-${expectedDate}.xlsx`,
      `Unexpected filename: ${exportRes.fileName} vs أصناف-المخزن-${expectedDate}.xlsx`
    );

    // قراءة الملف المصدّر فعليًا كـ xlsx والتأكد من 65 صنف من 65
    const wb = XLSX.read(exportRes.buffer!, { type: 'buffer', cellNF: true });
    assert(wb.SheetNames.length >= 1, 'Workbook must contain at least 1 sheet');
    assert(wb.Workbook?.Views?.[0]?.RTL === true, 'Workbook RTL view must be enabled');

    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
    assert(rows.length === 66, `Expected 1 header row + 65 item rows = 66, got ${rows.length}`);

    const headers = rows[0] as string[];
    const expectedImportHeaders = [
      'اسم الصنف',
      'اسم الطباعة',
      'كود SKU',
      'الباركود الأساسي',
      'باركودات فرعية (مفصولة بفواصل)',
      'المورد',
      'وحدة القياس',
      'سعر البيع',
      'الحد الأدنى لسعر البيع',
      'سعر الشراء',
      'تكلفة التغليف',
      'الكمية بالمخزن',
      'حد إعادة الطلب',
      'نسبة الضريبة %',
      'ملاحظات'
    ];
    expectedImportHeaders.forEach((h, idx) => {
      assert(headers[idx] === h, `Header[${idx}] mismatch: expected "${h}", got "${headers[idx]}"`);
    });

    const requiredExtraHeaders = [
      'معرف الصنف (ID)',
      'التصنيف الرئيسي',
      'التصنيف الفرعي',
      'الحالة',
      'المنصات المتاحة',
      'تفعيل BNPL',
      'نسبة BNPL %',
      'رسوم الالتقاط',
      'خصم شحن المرتجع بالمنصات',
      'رابط الصورة',
      'تاريخ الإضافة',
      'آخر تعديل'
    ];
    for (const h of requiredExtraHeaders) {
      assert(headers.includes(h), `Missing product card header: "${h}"`);
    }

    // التحقق من أنواع الخلايا: الباركود نص + يحتفظ بالصفر البادئ، والأرقام أرقام
    const barcodeColIdx = headers.indexOf('الباركود الأساسي');
    const secBarcodeColIdx = headers.indexOf('باركودات فرعية (مفصولة بفواصل)');
    const skuColIdx = headers.indexOf('كود SKU');
    const salePriceColIdx = headers.indexOf('سعر البيع');
    const qtyColIdx = headers.indexOf('الكمية بالمخزن');
    const purchasePriceColIdx = headers.indexOf('سعر الشراء');
    const nameColIdx = headers.indexOf('اسم الصنف');

    let foundLeadZeroRow = false;
    for (let r = 1; r < rows.length; r++) {
      const bcCell = ws[XLSX.utils.encode_cell({ r, c: barcodeColIdx })];
      const secBcCell = ws[XLSX.utils.encode_cell({ r, c: secBarcodeColIdx })];
      const skuCell = ws[XLSX.utils.encode_cell({ r, c: skuColIdx })];
      const priceCell = ws[XLSX.utils.encode_cell({ r, c: salePriceColIdx })];
      const qtyCell = ws[XLSX.utils.encode_cell({ r, c: qtyColIdx })];
      const purchaseCell = ws[XLSX.utils.encode_cell({ r, c: purchasePriceColIdx })];

      if (bcCell) {
        assert(bcCell.t === 's', `Row ${r} barcode cell must be string ('s'), got '${bcCell.t}'`);
      }
      if (secBcCell) {
        assert(secBcCell.t === 's', `Row ${r} secondary barcode cell must be string ('s'), got '${secBcCell.t}'`);
      }
      if (skuCell) {
        assert(skuCell.t === 's', `Row ${r} SKU cell must be string ('s'), got '${skuCell.t}'`);
      }
      assert(priceCell && priceCell.t === 'n', `Row ${r} salePrice cell must be numeric ('n')`);
      assert(qtyCell && qtyCell.t === 'n', `Row ${r} stockQuantity cell must be numeric ('n')`);
      assert(purchaseCell && purchaseCell.t === 'n', `Row ${r} purchasePrice cell must be numeric ('n')`);

      if (rows[r][nameColIdx] === 'صنف اختبار التصدير 001') {
        foundLeadZeroRow = true;
        assert(bcCell?.v === '00622111000999', `Leading zero barcode must be preserved, got "${bcCell?.v}"`);
      }
    }
    if (neededFor65 >= 1) {
      assert(foundLeadZeroRow, 'Created leading-zero barcode item should be present in export');
    }

    // التحقق من XML الورقة: rightToLeft="1" وتثبيت الصف الأول ySplit="1" state="frozen"
    const sheetXml = extractWorksheetXmlFromXlsx(exportRes.buffer!);
    assert(sheetXml.includes('rightToLeft="1"'), 'Worksheet XML must have rightToLeft="1"');
    assert(
      sheetXml.includes('<pane') && sheetXml.includes('ySplit="1"') && sheetXml.includes('state="frozen"'),
      'Worksheet XML must have frozen first row (<pane ySplit="1" ... state="frozen"/>)'
    );

    // التحقق من تسجيل عملية التصدير في سجل التدقيق
    const logs = await getAuditLogs({ action: 'PRODUCTS_EXPORT' });
    assert(logs.length >= 1, 'Expected PRODUCTS_EXPORT entry in audit logs');
    assert(
      logs[0].details.includes('65 صنف') && logs[0].targetId === exportRes.fileName,
      `Audit log entry mismatch: ${JSON.stringify(logs[0])}`
    );

    // 2) مستخدم بصلاحية products.export ولكن بدون صلاحية prices.view_purchase -> يحذف عمود سعر الشراء
    const noCostExport = await exportAllItemsExcelBuffer(exportNoCostSession);
    assert(noCostExport.success && noCostExport.buffer, 'Export without cost permission should succeed');
    assert(noCostExport.includesPurchasePrice === false, 'includesPurchasePrice should be false');

    const wbNoCost = XLSX.read(noCostExport.buffer!, { type: 'buffer' });
    const rowsNoCost = XLSX.utils.sheet_to_json<any[]>(wbNoCost.Sheets[wbNoCost.SheetNames[0]], { header: 1 });
    assert(rowsNoCost.length === 66, 'Export without cost permission must still contain all 65 items + header');
    const headersNoCost = rowsNoCost[0] as string[];
    assert(!headersNoCost.includes('سعر الشراء'), 'سعر الشراء column MUST be omitted when lacking prices.view_purchase');
    assert(!headersNoCost.includes('تكلفة التغليف'), 'تكلفة التغليف column MUST be omitted when lacking prices.view_packaging');

    // 3) مستخدم بدون صلاحية products.export -> يُرفض بـ 403
    const deniedRes = await exportAllItemsExcelBuffer(unauthorizedExporterSession);
    assert(deniedRes.success === false && deniedRes.statusCode === 403, `Expected 403 rejection, got ${JSON.stringify(deniedRes)}`);

    console.log('✅ All 65/65 Excel export, formatting, RTL, freeze-row, permission & audit tests PASSED!');
  } finally {
    for (const id of createdIds) {
      await deleteItem(id, designerSession);
    }
  }
}

runVerification().catch(err => {
  console.error(err);
  process.exit(1);
});

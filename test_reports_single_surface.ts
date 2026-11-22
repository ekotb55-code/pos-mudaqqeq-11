import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportsPage } from './src/pages/ReportsPage';
import { BnplReportView } from './src/components/reports/BnplReportView';
import { PlatformReportView } from './src/components/reports/PlatformReportView';
import { AuditLogsPage } from './src/pages/AuditLogsPage';
import { Item, Platform, Invoice, ReturnRecord, UserAccount } from './src/types';

// Ensure current Cairo date matches 'THIS_MONTH' preset so sample invoices are included
const today = new Date().toISOString().slice(0, 10);

const mockDesigner: UserAccount = {
  id: 'u-designer',
  username: 'owner',
  name: 'مصمم النظام',
  role: 'designer',
  isOwner: true,
  status: 'نشط',
  permissions: [],
};

const mockPlatforms: Platform[] = [
  {
    id: 'plt-noon',
    name: 'نون',
    discountPercentage: 10,
    enableBnpl: true,
    bnplPercentage: 5,
    pickupFee: 10,
    status: 'نشط',
  } as Platform,
  {
    id: 'plt-direct',
    name: 'مباشر',
    discountPercentage: 0,
    enableBnpl: false,
    bnplPercentage: 0,
    pickupFee: 0,
    status: 'نشط',
  } as Platform,
];

const mockItems: Item[] = [
  {
    id: 'item-1',
    name: 'سماعة بلوتوث احترافية',
    sku: 'SKU-101',
    barcode: '62210000101',
    supplier: 'شركة النور',
    category: 'إلكترونيات',
    purchasePrice: 200,
    sellingPrice: 350,
    minSellingPrice: 300,
    stockQuantity: 3,
    reorderLimit: 5,
    unit: 'قطعة',
    status: 'متاح',
  } as Item,
  {
    id: 'item-2',
    name: 'شاحن سريع 65 واط',
    sku: 'SKU-102',
    barcode: '62210000102',
    supplier: 'شركة النور',
    category: 'إلكترونيات',
    purchasePrice: 120,
    sellingPrice: 220,
    minSellingPrice: 180,
    stockQuantity: 0,
    reorderLimit: 4,
    unit: 'قطعة',
    status: 'متاح',
  } as Item,
  {
    id: 'item-3',
    name: 'حامل لابتوب معدني',
    sku: 'SKU-103',
    barcode: '62210000103',
    supplier: 'المورد الذهبي',
    category: 'إكسسوارات',
    purchasePrice: 150,
    sellingPrice: 280,
    minSellingPrice: 240,
    stockQuantity: 25,
    reorderLimit: 5,
    unit: 'قطعة',
    status: 'متاح',
  } as Item,
];

const mockInvoices: Invoice[] = [
  {
    id: 'inv-1',
    invoiceNumber: 'INV-1001',
    date: `${today}T10:00:00.000Z`,
    platformId: 'plt-noon',
    platform: 'نون',
    platformName: 'نون',
    totalBeforeDiscount: 700,
    netAmount: 630,
    taxAmount: 70,
    profit: 180,
    status: 'مكتملة',
    lines: [
      {
        itemId: 'item-1',
        itemName: 'سماعة بلوتوث احترافية',
        quantity: 2,
        purchasePriceAtSale: 200,
        packagingCostAtSale: 10,
      } as any,
    ],
  } as Invoice,
  {
    id: 'inv-2',
    invoiceNumber: 'INV-1002',
    date: `${today}T12:00:00.000Z`,
    platformId: 'plt-direct',
    platform: 'مباشر',
    platformName: 'مباشر',
    totalBeforeDiscount: 280,
    netAmount: 280,
    taxAmount: 28,
    profit: 110,
    status: 'مكتملة',
    lines: [
      {
        itemId: 'item-3',
        itemName: 'حامل لابتوب معدني',
        quantity: 1,
        purchasePriceAtSale: 150,
        packagingCostAtSale: 20,
      } as any,
    ],
  } as Invoice,
];

const mockReturns: ReturnRecord[] = [
  {
    id: 'ret-1',
    returnNumber: 'RET-1',
    date: `${today}T14:00:00.000Z`,
  } as ReturnRecord,
];

// 1. Verify exact numerical parity for FINANCIAL report
// Expected math (unchanged formulas):
// totalSalesBeforeDiscount = 700 + 280 = 980
// totalSalesRevenue = 630 + 280 = 910
// totalSalesTax = 70 + 28 = 98
// totalGoodsCost = (200+10)*2 + (150+20)*1 = 420 + 170 = 590
// netRealizedProfit = 180 + 110 = 290
// profitMargin = (290 / 910 * 100).toFixed(1) = "31.9"
const expectedSalesRevenue = (910).toLocaleString();
const expectedBeforeDiscount = (980).toLocaleString();
const expectedTax = (98).toLocaleString();
const expectedGoodsCost = (590).toLocaleString();
const expectedProfit = (290).toLocaleString();
const expectedNoonRev = (630).toLocaleString();
const expectedNoonProfit = (180).toLocaleString();
const expectedDirectRev = (280).toLocaleString();
const expectedDirectProfit = (110).toLocaleString();

const financialHtml = renderToStaticMarkup(
  React.createElement(ReportsPage, {
    reports: null,
    items: mockItems,
    platforms: mockPlatforms,
    invoices: mockInvoices,
    returns: mockReturns,
    user: mockDesigner,
    userRole: 'designer',
    initialTab: 'FINANCIAL',
  })
);

for (const expectedVal of [
  `${expectedSalesRevenue} ج.م`,
  `${expectedBeforeDiscount} ج.م`,
  `${expectedTax} ج.م`,
  `${expectedGoodsCost} ج.م`,
  `${expectedProfit} ج.م`,
  '31.9%',
  `${expectedNoonRev} ج.م`,
  `${expectedNoonProfit} ج.م`,
  `${expectedDirectRev} ج.م`,
  `${expectedDirectProfit} ج.م`,
  'الإجمالي (2 منصة)',
]) {
  assert(
    financialHtml.includes(expectedVal),
    `Expected financial output to contain "${expectedVal}"`
  );
}
console.log('✓ Numerical parity check passed for FINANCIAL report (Sales=910, Tax=98, Cost=590, Profit=290, Margin=31.9%, Platform totals=910/290).');

// 2. Verify Single-Surface rules across all ReportsPage tabs
const tabs = [
  'FINANCIAL',
  'SALES_PURCHASES',
  'CASH_FLOW',
  'BALANCES',
  'LOW_STOCK',
  'RECONCILIATION',
  'ITEM_MOVEMENT',
  'STOCK_ADJUSTMENTS',
  'BNPL',
] as const;

const forbiddenPatterns = [
  /rounded-3xl/,
  /\bshadow-(?:xs|sm|md|lg|xl|2xs)\b/,
  /\brounded-full\b/,
  /\bbg-(?:amber|emerald|rose|cyan|indigo)-(?:50|100)\b/,
];

for (const tab of tabs) {
  const html = renderToStaticMarkup(
    React.createElement(ReportsPage, {
      reports: null,
      items: mockItems,
      platforms: mockPlatforms,
      invoices: mockInvoices,
      returns: mockReturns,
      user: mockDesigner,
      userRole: 'designer',
      initialTab: tab,
    })
  );

  // Must have exactly one PageSurface
  const surfaceMatches = html.match(/class="page-surface(?:\s|")/g) || [];
  assert.equal(
    surfaceMatches.length,
    1,
    `Tab ${tab}: expected exactly 1 .page-surface, found ${surfaceMatches.length}`
  );

  // Must NOT contain internal report tab switcher bar
  assert(
    !html.includes('تقرير المبيعات والمشتريات') || tab === 'SALES_PURCHASES',
    `Tab ${tab}: must not render internal tab switcher buttons`
  );

  // Must include Print button
  assert(html.includes('طباعة'), `Tab ${tab}: missing print button`);

  // Must obey forbidden patterns
  for (const pat of forbiddenPatterns) {
    assert(!pat.test(html), `Tab ${tab}: matched forbidden class ${pat}`);
  }
}
console.log('✓ All 9 ReportsPage tabs pass Single-Surface DOM & zero-card/zero-pill checks.');

// 3. Verify LOW_STOCK exact counts & tfoot
const lowStockHtml = renderToStaticMarkup(
  React.createElement(ReportsPage, {
    reports: null,
    items: mockItems,
    platforms: mockPlatforms,
    invoices: mockInvoices,
    returns: mockReturns,
    user: mockDesigner,
    userRole: 'designer',
    initialTab: 'LOW_STOCK',
  })
);
assert(lowStockHtml.includes('2 صنف'), 'LOW_STOCK expected 2 low-stock items');
assert(lowStockHtml.includes('نفد: 1 • منخفض: 1'), 'LOW_STOCK expected tfoot summary (نفد: 1 • منخفض: 1)');
assert(lowStockHtml.includes('<tfoot>'), 'LOW_STOCK expected <tfoot> totals row');
console.log('✓ LOW_STOCK report counts (total=2, zero=1, low=1) & tfoot verified.');

// 4. Verify SALES_PURCHASES numerical parity
const salesPurchasesHtml = renderToStaticMarkup(
  React.createElement(ReportsPage, {
    reports: null,
    items: mockItems,
    platforms: mockPlatforms,
    invoices: mockInvoices,
    returns: mockReturns,
    user: mockDesigner,
    userRole: 'designer',
    initialTab: 'SALES_PURCHASES',
  })
);
assert(salesPurchasesHtml.includes(`${expectedSalesRevenue} ج.م`), 'SALES_PURCHASES expected total sales 910 ج.م');
assert(salesPurchasesHtml.includes('INV-1001') && salesPurchasesHtml.includes('INV-1002'), 'SALES_PURCHASES expected invoice numbers');
console.log('✓ SALES_PURCHASES numerical parity & invoice rows verified.');

// 5. Verify BnplReportView, PlatformReportView, and AuditLogsPage
for (const [name, element, expectsInitialTable] of [
  [
    'BnplReportView',
    React.createElement(BnplReportView, {
      user: mockDesigner,
      userRole: 'designer',
      platforms: mockPlatforms,
    }),
    true,
  ],
  [
    'PlatformReportView',
    React.createElement(PlatformReportView, {
      platforms: mockPlatforms,
    }),
    false,
  ],
  [
    'AuditLogsPage',
    React.createElement(AuditLogsPage, {
      users: [mockDesigner],
    }),
    true,
  ],
] as const) {
  const html = renderToStaticMarkup(element);
  const surfaceMatches = html.match(/class="page-surface(?:\s|")/g) || [];
  assert.equal(surfaceMatches.length, 1, `${name}: expected 1 .page-surface`);
  if (expectsInitialTable) {
    assert(html.includes('compact-table'), `${name}: expected .compact-table`);
    assert(html.includes('البند') && html.includes('القيمة'), `${name}: expected ReportSummaryTable`);
  }
  assert(html.includes('طباعة'), `${name}: expected print button`);
  for (const pat of forbiddenPatterns) {
    assert(!pat.test(html), `${name}: matched forbidden class ${pat}`);
  }
}
console.log('✓ BnplReportView, PlatformReportView, and AuditLogsPage pass Single-Surface checks.');

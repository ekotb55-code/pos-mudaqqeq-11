process.env.SKIP_SERVER_LISTEN = '1';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServerApp } from './server.ts';
import { PosInvoicePanel, PosInvoicePanelProps } from './src/components/pos/PosInvoicePanel.tsx';
import { calculateInvoice, calculateInvoiceLine } from './src/shared/invoiceCalc.ts';
import { getItems, getPlatforms, getWarehouses, getCashboxes, getCustomers } from './server/sheetsService.ts';
import { INITIAL_USER_PASSWORD } from './server/config.ts';
import type { Cashbox, Customer, Item, Platform, Warehouse } from './src/types/index.ts';

function buildBaseProps(overrides: Partial<PosInvoicePanelProps> = {}): PosInvoicePanelProps {
  const wh1: Warehouse = {
    id: 'wh-main',
    name: 'المخزن الرئيسي',
    isDefault: true,
    status: 'نشط'
  };
  const plt1: Platform = {
    id: 'plt-amz',
    name: 'أمازون',
    discountPercentage: 10,
    pickupFee: 15,
    pickupFeeMode: 'fixed',
    notes: '',
    status: 'نشطة',
    enableBnpl: true,
    bnplPercentage: 5
  };
  const cb1: Cashbox = {
    id: 'cb-1',
    name: 'الخزينة الرئيسية',
    type: 'نقدي',
    currency: 'ج.م',
    openingBalance: 1000,
    currentBalance: 1000,
    status: 'نشطة'
  };
  const cust1: Customer = {
    id: 'cust-1',
    name: 'أحمد علي',
    phone: '01012345678',
    address: 'القاهرة',
    openingBalance: 0,
    currentBalance: 250,
    status: 'نشط',
    createdAt: '2026-01-01T00:00:00Z'
  };
  const item1: Item = {
    id: 'item-test-1',
    name: 'سماعة بلوتوث',
    imageUrl: '',
    barcode: '123456',
    salePrice: 200,
    purchasePrice: 120,
    packagingCost: 10,
    stockQuantity: 10,
    taxRate: 14,
    notes: '',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'نشط'
  };

  return {
    saleMode: 'platform',
    onSaleModeChange: () => {},
    denominationsStorageKey: 'test_denom_key',
    cart: [
      {
        item: item1,
        quantity: 2,
        salePriceAtSale: 200,
        baseUnitPrice: 200,
        customerUnitPrice: 210,
        bnplPercent: 5,
        bnplUnitAmount: 10,
        bnplDeductionUnit: 10.5,
        taxRateAtSale: 14,
        unitTaxAmount: 25.79,
        unitBasePrice: 184.21,
        unitPickupFee: 15,
        platformDiscountPercent: 10,
        unitDiscountValue: 18.42,
        unitNetAfterDiscount: 166.08,
        unitNet: 166.08
      }
    ],
    items: [item1],
    allowNegativeStockSale: false,
    onAddToCart: () => {},
    onUpdateQuantity: () => {},
    onRemoveFromCart: () => {},
    onUpdateLinePrice: () => {},
    canEditPriceBeforeSave: true,
    canOverrideMinPrice: false,
    warehouses: [wh1],
    selectedWarehouseId: wh1.id,
    onSelectWarehouse: () => {},
    isLoadingWarehouseStock: false,
    activePlatforms: [plt1],
    selectedPlatformId: plt1.id,
    onSelectPlatform: () => {},
    selectedPlatform: plt1,
    bnplEnabled: true,
    onBnplEnabledChange: () => {},
    bnplPercentInput: 5,
    onBnplPercentChange: () => {},
    commissionPercentInput: 10,
    onCommissionPercentChange: () => {},
    canEditPosRates: true,
    customers: [cust1],
    selectedCustomerId: cust1.id,
    onSelectCustomer: () => {},
    canCreateCustomer: true,
    onCustomerCreated: () => {},
    barcodeInput: '',
    onBarcodeInput: () => {},
    onBarcodeSubmit: () => {},
    onOpenScanner: () => {},
    notes: '',
    onNotesChange: () => {},
    totalBeforeDiscount: 420,
    totalBnpl: 21,
    totalDiscount: 36.84,
    totalPickup: 30,
    enableDeliveryFee: false,
    deliveryFee: 0,
    onDeliveryFeeChange: () => {},
    totalTax: 51.58,
    netAmount: 332.16,
    totalProfit: 20.58,
    canViewProfit: false,
    taxSettings: { taxInclusive: true, platformCommissionOn: 'before_tax' },
    paymentType: 'نقدي',
    onPaymentTypeChange: () => {},
    creditPartyType: 'platform',
    onCreditPartyTypeChange: () => {},
    paidAmountInput: '332.16',
    onPaidAmountChange: () => {},
    autoFillCashPaid: true,
    canEditCashPaid: true,
    isManualCashOverride: false,
    onSetManualCashOverride: () => {},
    allowedSaleCashboxes: [cb1],
    selectedCashboxId: cb1.id,
    onSelectCashbox: () => {},
    onCheckout: () => {},
    onClearCart: () => {},
    isSubmitting: false,
    hasStockExceeded: false,
    isOffline: false,
    ...overrides
  };
}

async function runTests() {
  console.log('--- Starting PosInvoicePanel & Selling Modes Verification ---');

  // 1. Single warehouse hides warehouse selector; >1 warehouse shows it
  const singleWhHtml = renderToStaticMarkup(React.createElement(PosInvoicePanel, buildBaseProps()));
  assert.ok(!singleWhHtml.includes('data-testid="pos-warehouse-selector"'), 'Warehouse selector must be hidden when user has only 1 warehouse');
  assert.ok(!singleWhHtml.includes('المخزن الرئيسي'), 'Single warehouse name box must not render inside panel');
  console.log('✓ 1. Single warehouse hides warehouse selector completely');

  const multiWhHtml = renderToStaticMarkup(
    React.createElement(
      PosInvoicePanel,
      buildBaseProps({
        warehouses: [
          { id: 'wh-1', name: 'المخزن الرئيسي', isDefault: true, status: 'نشط' },
          { id: 'wh-2', name: 'مخزن الإسكندرية', isDefault: false, status: 'نشط' }
        ],
        selectedWarehouseId: 'wh-1'
      })
    )
  );
  assert.ok(multiWhHtml.includes('data-testid="pos-warehouse-selector"'), 'Warehouse selector must render when warehouses > 1');
  assert.ok(multiWhHtml.includes('مخزن الإسكندرية'), 'Second warehouse option must render');
  console.log('✓ 2. Multiple warehouses display warehouse selector with options');

  // 2. Single cashbox hides cashbox selector; >1 cashbox shows it
  assert.ok(!singleWhHtml.includes('data-testid="pos-cashbox-selector"'), 'Cashbox selector must be hidden when allowedSaleCashboxes <= 1');
  const multiCbHtml = renderToStaticMarkup(
    React.createElement(
      PosInvoicePanel,
      buildBaseProps({
        allowedSaleCashboxes: [
          { id: 'cb-1', name: 'خزنة 1', type: 'نقدي', currency: 'ج.م', openingBalance: 0, currentBalance: 100, status: 'نشطة' },
          { id: 'cb-2', name: 'خزنة 2', type: 'نقدي', currency: 'ج.م', openingBalance: 0, currentBalance: 200, status: 'نشطة' }
        ]
      })
    )
  );
  assert.ok(multiCbHtml.includes('data-testid="pos-cashbox-selector"'), 'Cashbox selector must render when allowedSaleCashboxes > 1');
  console.log('✓ 3. Cashbox selector visibility respects allowedSaleCashboxes.length > 1');

  // 3. Platform mode renders platform section, hides customer section, removes bottom item count, and collapses denominations
  assert.ok(singleWhHtml.includes('data-testid="pos-platform-section"'), 'Platform section must render in platform mode');
  assert.ok(!singleWhHtml.includes('data-testid="pos-customer-section"'), 'Customer section must be hidden in platform mode');
  assert.ok(singleWhHtml.includes('صافي الاستلام من المنصة:'), 'Platform mode must show net platform payout label');
  assert.ok(!singleWhHtml.includes('عدد الأصناف:'), 'Bottom item count line must be removed');
  assert.ok(singleWhHtml.includes('data-testid="pos-denominations-toggle"'), 'Denominations toggle must appear in نقدي mode');
  assert.ok(!singleWhHtml.includes('data-testid="pos-denominations-row"'), 'Denominations row must be collapsed by default');
  console.log('✓ 4. Platform mode hides customer section, hides bottom item count, and collapses denominations by default');

  // 4. Summary hides zero-value lines (>0 only)
  const zeroLinesHtml = renderToStaticMarkup(
    React.createElement(
      PosInvoicePanel,
      buildBaseProps({
        saleMode: 'platform',
        totalBnpl: 0,
        totalDiscount: 0,
        totalPickup: 0,
        totalTax: 0
      })
    )
  );
  assert.ok(!zeroLinesHtml.includes('تقسيط المنصة (BNPL):'), 'BNPL line must hide when 0');
  assert.ok(!zeroLinesHtml.includes('خصم المنصة ('), 'Platform discount line must hide when 0');
  assert.ok(!zeroLinesHtml.includes('رسوم الالتقاط ('), 'Pickup line must hide when 0');
  assert.ok(!zeroLinesHtml.includes('ضريبة القيمة المضافة'), 'VAT line must hide when 0');
  console.log('✓ 5. Summary hides zero-value lines cleanly');

  // 5. Customer mode renders customer section, hides platform section, shows المطلوب and hides BNPL/commission/pickup
  const custModeHtml = renderToStaticMarkup(
    React.createElement(
      PosInvoicePanel,
      buildBaseProps({
        saleMode: 'customer',
        paymentType: 'آجل'
      })
    )
  );
  assert.ok(custModeHtml.includes('data-testid="pos-customer-section"'), 'Customer section must render in customer mode');
  assert.ok(!custModeHtml.includes('data-testid="pos-platform-section"'), 'Platform section must be hidden in customer mode');
  assert.ok(!custModeHtml.includes('صافي الاستلام من المنصة:'), 'Customer mode must not show platform payout label');
  assert.ok(custModeHtml.includes('المطلوب:'), 'Customer mode must show المطلوب label');
  assert.ok(!custModeHtml.includes('تقسيط المنصة (BNPL):'), 'Customer mode summary must hide BNPL');
  assert.ok(!custModeHtml.includes('خصم المنصة ('), 'Customer mode summary must hide platform discount');
  assert.ok(!custModeHtml.includes('data-testid="pos-denominations-toggle"'), 'Denominations must not appear when paymentType is آجل');
  assert.ok(!custModeHtml.includes('placeholder="0.00"'), 'Cash paid input must be hidden when paymentType is آجل');
  console.log('✓ 6. Customer mode hides platform section/lines and آجل hides cash-paid & denominations');

  // 6. Verify invoiceCalc behavior unchanged for platform vs customer (direct sale)
  const testItem: Item = {
    id: 'calc-item-1',
    name: 'منتج اختبار',
    imageUrl: '',
    barcode: '999000',
    salePrice: 100,
    purchasePrice: 60,
    packagingCost: 5,
    stockQuantity: 50,
    taxRate: 14,
    notes: '',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'نشط'
  };
  const testPlatform: Platform = {
    id: 'plt-test',
    name: 'منصة الاختبار',
    discountPercentage: 10,
    pickupFee: 15,
    pickupFeeMode: 'fixed',
    notes: '',
    status: 'نشطة',
    enableBnpl: true,
    bnplPercentage: 5
  };

  // Customer mode calculation (no platform => 0 commission, 0 BNPL, 0 pickup fee)
  const customerCalc = calculateInvoice({
    lines: [{ item: testItem, line: { itemId: testItem.id, quantity: 2, salePriceAtSale: 100, taxRateAtSale: 14 } }],
    platform: undefined,
    taxSettings: { taxInclusive: true, platformCommissionOn: 'before_tax' },
    bnplEnabled: false,
    platformDiscountPercent: 0
  });
  assert.equal(customerCalc.totalBeforeDiscount, 200);
  assert.equal(customerCalc.totalBnpl, 0);
  assert.equal(customerCalc.totalDiscount, 0);
  assert.equal(customerCalc.totalPickupFee, 0);
  assert.equal(customerCalc.netAmount, 200);
  console.log('✓ 7. Customer mode invoiceCalc gives 0 commission, 0 BNPL, 0 pickup fee');

  // Platform mode calculation remains exact and unchanged
  const platformLine = calculateInvoiceLine({
    item: testItem,
    quantity: 2,
    platform: testPlatform,
    taxSettings: { taxInclusive: true, platformCommissionOn: 'before_tax' },
    bnplEnabled: true,
    platformDiscountPercent: 10
  });
  const platformCalc = calculateInvoice({
    lines: [{ item: testItem, line: { itemId: testItem.id, quantity: 2, salePriceAtSale: 100, taxRateAtSale: 14 } }],
    platform: testPlatform,
    taxSettings: { taxInclusive: true, platformCommissionOn: 'before_tax' },
    bnplEnabled: true,
    platformDiscountPercent: 10
  });
  assert.equal(platformLine.bnplPercent, 5);
  assert.equal(platformLine.customerUnitPrice, 105);
  assert.equal(platformCalc.totalBeforeDiscount, 210);
  assert.equal(platformCalc.totalBnpl, 10.5);
  assert.equal(platformCalc.totalPickupFee, 30);
  assert.ok(platformCalc.totalDiscount > 0);
  assert.equal(
    platformCalc.netAmount,
    Math.round((platformCalc.totalBeforeDiscount - platformCalc.totalBnpl - platformCalc.totalDiscount - platformCalc.totalPickupFee) * 100) / 100
  );
  console.log('✓ 8. Platform invoiceCalc formulas remain 100% unchanged');

  // 7. Server-side HTTP /api/invoices check for both modes
  const { app } = await createServerApp({ attachVite: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const loginHttp = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: INITIAL_USER_PASSWORD })
    });
    const loginRes = await loginHttp.json();
    assert.ok(loginRes.success && loginRes.token, `Admin HTTP login must succeed: ${JSON.stringify(loginRes)}`);

    if (loginRes.user?.mustChangePassword) {
      const setupRes = await fetch(`${baseUrl}/api/auth/complete-initial-setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${loginRes.token}`
        },
        body: JSON.stringify({
          name: loginRes.user.name,
          username: loginRes.user.username,
          newPassword: 'TestPassword@2026'
        })
      });
      const setupJson = await setupRes.json();
      assert.ok(setupJson.success, `Initial setup must succeed: ${JSON.stringify(setupJson)}`);
    }

    const adminSession = {
      token: loginRes.token as string,
      role: loginRes.user!.role,
      isOwner: true,
      userId: loginRes.user!.id,
      id: loginRes.user!.id,
      permissions: loginRes.user!.permissions
    };

    const [items, platforms, warehouses, cashboxes, customers] = await Promise.all([
      getItems(adminSession),
      getPlatforms(adminSession),
      getWarehouses(adminSession),
      getCashboxes(adminSession),
      getCustomers(adminSession)
    ]);

    const saleItem = items.find(i => (!i.platformIds || i.platformIds.length === 0) && i.stockQuantity >= 5) || items[0];
    const activePlt = platforms.find(p => p.status !== 'inactive' && p.status !== 'موقوفة') || platforms[0];
    const activeWh = warehouses[0];
    const activeCb = cashboxes[0];
    const activeCust = customers[0];
    assert.ok(saleItem && activePlt && activeWh && activeCb, 'Mock seed entities must exist');

    // 7a. Customer mode server payload -> 0 commission, 0 BNPL, 0 pickup
    const directHttp = await fetch(`${baseUrl}/api/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginRes.token}`
      },
      body: JSON.stringify({
        idempotencyKey: `test-direct-${Date.now()}`,
        warehouseId: activeWh.id,
        warehouseName: activeWh.name,
        platformId: undefined,
        platformName: 'البيع المباشر',
        platformDiscountPercentage: 0,
        bnplEnabled: false,
        paymentType: 'نقدي',
        cashboxId: activeCb.id,
        customerId: activeCust?.id || undefined,
        lines: [
          {
            itemId: saleItem.id,
            quantity: 1,
            salePriceAtSale: saleItem.salePrice,
            taxRateAtSale: saleItem.taxRate || 0,
            unitPickupFee: 0
          }
        ]
      })
    });
    const directInvRes = await directHttp.json();
    assert.ok(directInvRes.success && directInvRes.invoice, `Direct customer invoice must succeed: ${JSON.stringify(directInvRes)}`);
    assert.equal(directInvRes.invoice.platform, 'البيع المباشر');
    assert.equal(directInvRes.invoice.discountAmount, 0);
    assert.equal(directInvRes.invoice.bnplTotalAmount || 0, 0);
    assert.equal(directInvRes.invoice.pickupFeeAmount || 0, 0);
    console.log('✓ 9. Server customer mode creates invoice with 0 commission, 0 BNPL, 0 pickup fee');

    // 7b. Platform mode server payload -> no customerId (الجمهور default)
    const pltHttp = await fetch(`${baseUrl}/api/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginRes.token}`
      },
      body: JSON.stringify({
        idempotencyKey: `test-plt-${Date.now()}`,
        warehouseId: activeWh.id,
        warehouseName: activeWh.name,
        platformId: activePlt.id,
        platformName: activePlt.name,
        platformDiscountPercentage: activePlt.discountPercentage,
        bnplEnabled: Boolean(activePlt.enableBnpl),
        paymentType: 'نقدي',
        cashboxId: activeCb.id,
        customerId: undefined,
        lines: [
          {
            itemId: saleItem.id,
            quantity: 1,
            salePriceAtSale: saleItem.salePrice,
            taxRateAtSale: saleItem.taxRate || 0
          }
        ]
      })
    });
    const pltInvRes = await pltHttp.json();
    assert.ok(pltInvRes.success && pltInvRes.invoice, `Platform invoice must succeed: ${JSON.stringify(pltInvRes)}`);
    assert.equal(pltInvRes.invoice.platformId, activePlt.id);
    assert.equal(pltInvRes.invoice.customerId || '', '');
    assert.equal(pltInvRes.invoice.customerName || '', '');
    console.log('✓ 10. Server platform mode sends empty customer (الجمهور default)');
  } finally {
    server.close();
  }

  console.log('\n========================================');
  console.log('ALL POS INVOICE PANEL & MODE TESTS PASSED!');
  console.log('========================================');
}

runTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('TEST FAILED:', err);
    process.exit(1);
  });

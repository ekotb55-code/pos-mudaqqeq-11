import { loginUser, saveUser, createInvoice, getItems, getPlatforms } from './server/sheetsService.ts';
import type { PermissionKey } from './src/types/index.ts';

async function runTests() {
  console.log('--- Starting User Management & Cashbox Security Verification ---');

  // 1. Login as designer
  const adminLogin = await loginUser('admin', process.env.INITIAL_USER_PASSWORD || '1234');
  if (!adminLogin.success || !adminLogin.user) {
    throw new Error('Failed to login as admin: ' + adminLogin.error);
  }
  console.log('✓ 1. Admin designer logged in successfully:', adminLogin.user.name);

  // 2. Create new user with granular cashboxConfig
  const testUserData = {
    username: 'cashier_test',
    name: 'كاشير التجربة',
    phone: '01099998888',
    role: 'employee' as const,
    password: 'cashierPass123',
    status: 'active' as const,
    permissions: ['invoices.create', 'invoices.view', 'returns.create'] as PermissionKey[],
    cashboxConfig: {
      allowedSaleCashboxIds: ['cb-main-001'],
      defaultSaleCashboxId: 'cb-main-001',
      allowedReturnCashboxIds: ['cb-main-001'],
      defaultReturnCashboxId: 'cb-main-001',
      allowedReceiptCashboxIds: ['cb-main-001'],
      allowedPaymentCashboxIds: [],
      allowedTransferCashboxIds: []
    }
  };

  const createRes = await saveUser(testUserData, adminLogin.user);
  if (!createRes.success || !createRes.user) {
    throw new Error('Failed to create test user: ' + (createRes as any).error);
  }
  console.log('✓ 2. Created cashier user with cashboxConfig. User ID:', createRes.user.id);
  console.log('   Assigned sale cashboxes:', createRes.user.cashboxConfig?.allowedSaleCashboxIds);

  // 3. Login as test cashier
  const cashierLogin = await loginUser('cashier_test', 'cashierPass123');
  if (!cashierLogin.success || !cashierLogin.user) {
    throw new Error('Cashier login failed: ' + cashierLogin.error);
  }
  console.log('✓ 3. Cashier logged in successfully. Role:', cashierLogin.user.role);

  const catalogItems = await getItems(adminLogin.user);
  const testItem = catalogItems.find(i => i.stockQuantity >= 5) || catalogItems[0];
  const platforms = await getPlatforms();
  const testPlatform = platforms.find(p => p.name === 'البيع المباشر') || platforms[0];
  if (!testItem || !testPlatform) {
    throw new Error('Missing seed item or platform for cashbox security test');
  }

  // 4. Test invoice creation with UNASSIGNED cashbox 'cb-cairo-002'
  const unauthInvoice = await createInvoice({
    idempotencyKey: 'test-cashbox-sec-unassigned',
    platformId: testPlatform.id,
    date: new Date().toISOString(),
    cashboxId: 'cb-cairo-002', // Not in cashier's allowedSaleCashboxIds!
    paymentType: 'نقدي',
    lines: [{ itemId: testItem.id, quantity: 1, unitPrice: testItem.salePrice || 100 }]
  }, cashierLogin.user);
  if (unauthInvoice.success || !String(unauthInvoice.error || '').includes('الخزينة')) {
    throw new Error('SECURITY VIOLATION: Cashier unauthorized cashbox cb-cairo-002 was not rejected for cashbox permission! Got: ' + JSON.stringify(unauthInvoice));
  }
  console.log('✓ 4. Security check passed: Unauthorized cashbox rejected with error ->', unauthInvoice.error);

  // 5. Test invoice creation with ASSIGNED cashbox 'cb-main-001'
  const validInvoice = await createInvoice({
    idempotencyKey: 'test-cashbox-sec-assigned',
    platformId: testPlatform.id,
    date: new Date().toISOString(),
    cashboxId: 'cb-main-001', // Assigned!
    paymentType: 'نقدي',
    lines: [{ itemId: testItem.id, quantity: 1, unitPrice: testItem.salePrice || 100 }]
  }, cashierLogin.user);
  if (!validInvoice.success || !validInvoice.invoice?.invoiceNumber) {
    throw new Error('Authorized cashbox invoice failed: ' + validInvoice.error);
  }
  console.log('✓ 5. Authorized cashbox accepted successfully. Invoice #:', validInvoice.invoice.invoiceNumber);

  // 6. Test suspending user
  const suspendRes = await saveUser({
    id: createRes.user.id,
    username: 'cashier_test',
    status: 'موقوف'
  }, adminLogin.user);
  if (!suspendRes.success) {
    throw new Error('Failed to suspend cashier: ' + (suspendRes as any).error);
  }
  console.log('✓ 6. Cashier account suspended successfully.');

  // Check login while suspended
  const tryLoginSuspended = await loginUser('cashier_test', 'cashierPass123');
  if (tryLoginSuspended.success) {
    throw new Error('SECURITY VIOLATION: Suspended user was able to log in!');
  }
  console.log('✓ 7. Suspended user login rejected ->', tryLoginSuspended.error);

  // 8. Test protecting the last active designer account
  const suspendLastDesigner = await saveUser({
    id: adminLogin.user.id,
    username: adminLogin.user.username,
    status: 'موقوف'
  }, adminLogin.user);
  if (suspendLastDesigner.success) {
    throw new Error('SECURITY VIOLATION: Last designer account was allowed to be deactivated!');
  }
  console.log('✓ 8. Last active designer protected from suspension ->', (suspendLastDesigner as any).error);

  const downgradeLastDesigner = await saveUser({
    id: adminLogin.user.id,
    username: adminLogin.user.username,
    role: 'employee'
  }, adminLogin.user);
  if (downgradeLastDesigner.success) {
    throw new Error('SECURITY VIOLATION: Last designer account was allowed to be downgraded!');
  }
  console.log('✓ 9. Last active designer protected from role downgrade ->', (downgradeLastDesigner as any).error);

  console.log('\n========================================');
  console.log('ALL CASHBOX & USER MANAGEMENT TESTS PASSED!');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

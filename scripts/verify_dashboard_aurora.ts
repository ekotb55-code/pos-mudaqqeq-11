import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeDashboardAuroraMetrics,
  getAuroraCashboxGradient,
  computeTodayPlatformSales,
  getRecentInvoicesList,
  getInvoiceStatusBadge,
  getQuickActionsForUser
} from '../src/components/DashboardAurora.tsx';
import {
  initialInvoices,
  initialItems,
  initialUsers,
  initialPlatforms,
  initialCashboxes
} from '../server/mockData.ts';
import type { Invoice, UserAccount, DashboardCashbox } from '../src/types/index.ts';

function computeLegacyDashboardMetrics(invoices: Invoice[], items: typeof initialItems, isManager: boolean) {
  const completedInvoices = invoices.filter(i => i.status === 'تم البيع');
  const totalRevenue = completedInvoices.reduce((s, i) => s + (i.netAmount || 0), 0);

  let totalCost: number | undefined = undefined;
  let grossProfit: number | undefined = undefined;
  if (isManager) {
    let costSum = 0;
    for (const inv of completedInvoices) {
      for (const line of inv.lines || []) {
        costSum += ((line.purchasePriceAtSale || 0) + (line.packagingCostAtSale || 0)) * (line.quantity || 1);
      }
    }
    totalCost = costSum;
    grossProfit = totalRevenue - totalCost;
  }

  const lowStockItems = items.filter(p => p.status !== 'inactive' && p.stockQuantity <= 5);
  return {
    completedInvoicesCount: completedInvoices.length,
    totalRevenue,
    grossProfit,
    lowStockCount: lowStockItems.length
  };
}

// 1. Seed data parity check (Manager)
const managerUser = initialUsers.find(u => u.role === 'manager' || u.role === 'designer') as unknown as UserAccount;
const employeeUser = initialUsers.find(u => u.role === 'employee') as unknown as UserAccount;

const legacyManager = computeLegacyDashboardMetrics(initialInvoices, initialItems, true);
const auroraManager = computeDashboardAuroraMetrics({
  invoices: initialInvoices,
  items: initialItems,
  userRole: 'manager',
  user: managerUser
});

assert.equal(auroraManager.netReceiptTotal, legacyManager.totalRevenue, 'صافي الاستلام must match DashboardPage totalRevenue');
assert.equal(auroraManager.grossProfit, legacyManager.grossProfit, 'الربح التقديري must match DashboardPage grossProfit');
assert.equal(auroraManager.lowStockCount, legacyManager.lowStockCount, 'تحتاج تموين must match DashboardPage lowStockItems.length');
assert.equal(auroraManager.completedInvoices.length, legacyManager.completedInvoicesCount, 'Completed invoice count must match');
assert.equal(auroraManager.canViewProfit, true, 'Manager must have profit visibility');
assert.equal(auroraManager.canAddItem, true, 'Manager must see Add Item button');

// 2. Employee permission gating check
const auroraEmployee = computeDashboardAuroraMetrics({
  invoices: initialInvoices,
  items: initialItems,
  userRole: 'employee',
  user: employeeUser
});
assert.equal(auroraEmployee.canViewProfit, false, 'Employee must NOT see profit');
assert.equal(auroraEmployee.grossProfit, undefined, 'Employee grossProfit must be undefined');
assert.equal(auroraEmployee.canAddItem, false, 'Employee must NOT see Add Item button');

// 3. Manager without reports.view_profit permission check
const managerNoProfit: UserAccount = {
  ...managerUser,
  role: 'manager',
  isOwner: false,
  permissions: managerUser.permissions.filter(p => p !== 'reports.view_profit')
};
const auroraManagerNoProfit = computeDashboardAuroraMetrics({
  invoices: initialInvoices,
  items: initialItems,
  userRole: 'manager',
  user: managerNoProfit
});
assert.equal(auroraManagerNoProfit.canViewProfit, false, 'Manager missing reports.view_profit must NOT see profit');

// 4. Today + Yesterday + 7-day + Pending Credit + Today Platform Sales checks
const sampleInvoices: Invoice[] = [
  {
    ...initialInvoices[0],
    invoiceNumber: 'INV-TODAY-1',
    date: '2026-11-14T10:00:00.000Z',
    platform: 'أمازون (Amazon.eg)',
    totalBeforeDiscount: 2000,
    netAmount: 1700,
    status: 'تم البيع',
    lines: [{ ...initialInvoices[0].lines[0], quantity: 3 }]
  },
  {
    ...initialInvoices[1],
    invoiceNumber: 'INV-TODAY-2',
    date: '2026-11-14T12:00:00.000Z',
    platform: 'نون (Noon Egypt)',
    totalBeforeDiscount: 1000,
    netAmount: 850,
    status: 'تم البيع',
    lines: [{ ...initialInvoices[1].lines[0], quantity: 2 }]
  },
  {
    ...initialInvoices[0],
    invoiceNumber: 'INV-TODAY-3',
    date: '2026-11-14T13:00:00.000Z',
    platform: 'أمازون (Amazon.eg)',
    totalBeforeDiscount: 500,
    netAmount: 425,
    status: 'تم البيع',
    lines: [{ ...initialInvoices[0].lines[0], quantity: 1 }]
  },
  {
    ...initialInvoices[0],
    invoiceNumber: 'INV-YEST-1',
    date: '2026-11-13T11:00:00.000Z',
    totalBeforeDiscount: 2000,
    netAmount: 1700,
    status: 'تم البيع',
    lines: [{ ...initialInvoices[0].lines[0], quantity: 1 }]
  },
  {
    ...initialInvoices[0],
    invoiceNumber: 'INV-CREDIT-1',
    date: '2026-11-12T11:00:00.000Z',
    totalBeforeDiscount: 500,
    netAmount: 450,
    paymentType: 'آجل',
    creditStatus: 'معلّقة',
    remainingAmount: 450,
    status: 'معلّقة',
    lines: []
  },
  {
    ...initialInvoices[0],
    invoiceNumber: 'INV-OLD-6',
    date: '2026-11-10T11:00:00.000Z',
    totalBeforeDiscount: 300,
    netAmount: 250,
    status: 'تم البيع',
    lines: []
  }
];

const withRecent = computeDashboardAuroraMetrics({
  invoices: sampleInvoices,
  items: initialItems,
  userRole: 'manager',
  user: managerUser,
  todayOverride: '2026-11-14'
});

assert.equal(withRecent.todaySales, 3500);
assert.equal(withRecent.todayInvoicesCount, 3);
assert.equal(withRecent.todayPiecesSold, 6);
assert.equal(withRecent.yesterdayHasData, true);
assert.equal(withRecent.hasLast7DaysData, true);
assert.equal(withRecent.pendingCreditCount, 1);
assert.equal(withRecent.pendingCreditTotal, 450);

// 5. Row 2: Cashboxes colors + sum parity
assert.equal(getAuroraCashboxGradient(0, 'aurora'), 'linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)');
assert.equal(getAuroraCashboxGradient(1, 'aurora'), 'linear-gradient(135deg, #10B981 0%, #0F766E 100%)');
assert.equal(getAuroraCashboxGradient(2, 'aurora'), 'linear-gradient(135deg, #6366F1 0%, #7C3AED 100%)');
assert.equal(getAuroraCashboxGradient(2, 'aurora-sky'), 'linear-gradient(135deg, #1E3A8A 0%, #0F2540 100%)');
assert.equal(getAuroraCashboxGradient(3, 'aurora'), 'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)');
assert.equal(getAuroraCashboxGradient(4, 'aurora'), 'linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)');
assert.equal(getAuroraCashboxGradient(5, 'aurora'), getAuroraCashboxGradient(0, 'aurora'), 'Cashbox colors must repeat');

const mockCashboxes: DashboardCashbox[] = initialCashboxes.map(cb => ({
  id: cb.id,
  name: cb.name,
  type: cb.type,
  currency: cb.currency,
  currentBalance: cb.currentBalance,
  status: cb.status,
  permissionType: 'إيداع وسحب'
}));
const directCardSum = mockCashboxes.reduce((s, c) => s + (c.currentBalance || 0), 0);
const totalsByCurrencyMap: Record<string, number> = {};
mockCashboxes.forEach(c => {
  const cur = c.currency || 'EGP';
  totalsByCurrencyMap[cur] = (totalsByCurrencyMap[cur] || 0) + (c.currentBalance || 0);
});
const totalsSum = Object.values(totalsByCurrencyMap).reduce((s, v) => s + v, 0);
assert.equal(totalsSum, directCardSum, 'Sum of cashbox card balances MUST equal displayed total');

// 6. Row 2: Today Platform Sales descending order & empty state
const pltSalesToday = computeTodayPlatformSales(sampleInvoices, initialPlatforms, '2026-11-14');
assert.equal(pltSalesToday.length, 2);
assert.equal(pltSalesToday[0].amount, 2500);
assert.equal(pltSalesToday[1].amount, 1000);
assert.equal(pltSalesToday[0].widthPct, 100);
assert.ok(pltSalesToday[1].widthPct > 0 && pltSalesToday[1].widthPct < 100);

const pltSalesEmpty = computeTodayPlatformSales(initialInvoices, initialPlatforms, '2026-11-14');
assert.equal(pltSalesEmpty.length, 0, 'Empty platform sales today should yield empty array');

// 7. Row 3: Recent 5 Invoices + status badges
const recent5 = getRecentInvoicesList(sampleInvoices, 5);
assert.equal(recent5.length, 5, 'Should show at most 5 recent invoices');
assert.equal(recent5[0].invoiceNumber, 'INV-TODAY-3', 'Newest invoice must appear first');
assert.equal(getInvoiceStatusBadge(sampleInvoices[0]).label, 'مدفوعة');
assert.equal(getInvoiceStatusBadge(sampleInvoices[0]).tone, 'emerald');
assert.equal(getInvoiceStatusBadge(sampleInvoices[4]).label, 'آجل');
assert.equal(getInvoiceStatusBadge(sampleInvoices[4]).tone, 'amber');

// 8. Row 3: Quick Actions RBAC permission gating
const managerQuickActions = getQuickActionsForUser(managerUser, 'manager');
assert.equal(managerQuickActions.length, 4, 'Manager should see all 4 quick actions');
assert.deepEqual(
  managerQuickActions.map(a => a.label),
  ['تحصيل آجل', 'تحويل بين الخزن', 'فاتورة شراء', 'تقرير اليوم']
);

const employeeQuickActions = getQuickActionsForUser(employeeUser, 'employee');
assert.equal(employeeQuickActions.length, 1, 'Default employee only has reports.view_reports among the 4 quick actions');
assert.equal(employeeQuickActions[0].id, 'today_report');

const noQuickActionUser: UserAccount = {
  ...employeeUser,
  permissions: ['dashboard.view']
};
assert.equal(getQuickActionsForUser(noQuickActionUser, 'employee').length, 0);

// 9. Theme scoping, layout classes & 1100px breakpoint verification
const dashboardPageCode = fs.readFileSync(path.resolve('src/pages/DashboardPage.tsx'), 'utf8');
assert.ok(
  dashboardPageCode.includes("appTheme === 'aurora' || appTheme === 'aurora-sky'"),
  'DashboardAurora must only activate for aurora and aurora-sky'
);
assert.ok(
  dashboardPageCode.includes('<DashboardAurora'),
  'DashboardPage must render DashboardAurora'
);

const auroraCode = fs.readFileSync(path.resolve('src/components/DashboardAurora.tsx'), 'utf8');
assert.ok(auroraCode.includes('min-h-[262px]'), 'Hero card must have ~262px min height');
assert.ok(auroraCode.includes('rounded-[30px]'), 'Hero card must have 30px radius');
assert.ok(auroraCode.includes('h-[150px]'), 'Cashbox bank cards must have 150px height');
assert.ok(auroraCode.includes('rounded-[22px]'), 'Cashbox bank cards must have 22px radius');
assert.ok(auroraCode.includes('min-[1100px]:grid-cols-'), 'Rows must stack cleanly below 1100px');
assert.ok(auroraCode.includes('tabular-nums'), 'Numbers must use tabular-nums');
assert.ok(auroraCode.includes('min-h-[44px]'), 'Buttons must satisfy >= 44px touch target');
assert.ok(auroraCode.includes('آخر الفواتير'), 'Recent invoices card present');
assert.ok(auroraCode.includes('إجراءات سريعة'), 'Quick actions card present');
assert.ok(auroraCode.includes('معاينة الأصناف'), 'Low stock preview button present');
assert.ok(auroraCode.includes('مبيعات المنصات اليوم'), 'Platform sales today card present');

console.log('All DashboardAurora (Rows 1, 2, 3) verification assertions passed!');
console.log(
  JSON.stringify(
    {
      cashboxesCount: mockCashboxes.length,
      cashboxesSum: directCardSum,
      totalsSum,
      seedTotalRevenue: auroraManager.netReceiptTotal,
      seedGrossProfit: auroraManager.grossProfit,
      seedLowStockCount: auroraManager.lowStockCount
    },
    null,
    2
  )
);

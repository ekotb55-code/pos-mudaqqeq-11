/**
 * اختبار واجهة سجل شاشة البيع وتقرير «أصناف لم تُبع من شاشة البيع»
 * التشغيل: npx tsx scripts/verify_cart_journal_ui.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NAV_GROUPS,
  isGroupVisible,
  isSubItemVisible,
  resolvePathToTarget
} from '../src/config/navigation.ts';
import { createFakeTransport } from '../server/persistence/statePersistence.ts';
import { CartJournalClient } from '../src/offline/cartJournal.ts';
import type { UserAccount } from '../src/types/index.ts';

if (typeof globalThis.navigator !== 'undefined' && (globalThis.navigator as any).onLine === undefined) {
  Object.defineProperty(globalThis.navigator, 'onLine', {
    value: true,
    writable: true,
    configurable: true
  });
}

let passed = 0;
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

function makeUser(overrides: Partial<UserAccount>): UserAccount {
  return {
    id: 'u-test',
    name: 'مستخدم اختبار',
    username: 'test_user',
    role: 'cashier',
    status: 'نشط',
    permissions: [],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides
  };
}

async function runUiChecks() {
  const { UnsoldCartItemsReportView } = await import('../src/components/reports/UnsoldCartItemsReportView.tsx');
  const { ReportsPage } = await import('../src/pages/ReportsPage.tsx');

  // 1. التحقق من مسار القائمة والصلاحيات
  const route = resolvePathToTarget('/reports/unsold-cart-items');
  check(
    route.page === 'reports' && route.tab === 'UNSOLD_CART_ITEMS' && route.path === '/reports/unsold-cart-items',
    'تحليل مسار /reports/unsold-cart-items يرجع reports + UNSOLD_CART_ITEMS'
  );

  const reportsGroup = NAV_GROUPS.find(g => g.id === 'reports')!;
  const unsoldSubItem = reportsGroup.subItems.find(s => s.id === 'reports-unsold-cart-items')!;
  check(Boolean(reportsGroup) && Boolean(unsoldSubItem), 'مجموعة التقارير وعنصر reports-unsold-cart-items موجودان');

  const cashierWithoutPerm = makeUser({ id: 'u-cashier', role: 'cashier', permissions: ['pos.sell'] });
  check(
    !isSubItemVisible(unsoldSubItem, cashierWithoutPerm),
    'العنصر مخفي عن الكاشير بدون صلاحية reports.unsold_cart_items.view'
  );

  const auditorOnlyThisReport = makeUser({
    id: 'u-auditor',
    role: 'cashier',
    permissions: ['reports.unsold_cart_items.view']
  });
  check(
    isGroupVisible(reportsGroup, auditorOnlyThisReport) &&
      isSubItemVisible(unsoldSubItem, auditorOnlyThisReport) &&
      unsoldSubItem.labelAr === 'أصناف لم تُبع من شاشة البيع',
    'العنصر ومجموعة التقارير يظهران لمن معه reports.unsold_cart_items.view فقط'
  );

  // 2. تصيير UnsoldCartItemsReportView بدون صلاحية
  const deniedHtml = renderToStaticMarkup(
    React.createElement(UnsoldCartItemsReportView, {
      user: cashierWithoutPerm,
      userRole: 'cashier',
      users: [cashierWithoutPerm]
    })
  );
  check(deniedHtml.includes('غير مصرح بعرض تقرير أصناف لم تُبع من شاشة البيع'), 'منع العرض عند غياب الصلاحية');

  // 3. تصيير UnsoldCartItemsReportView بصلاحية
  const allowedHtml = renderToStaticMarkup(
    React.createElement(UnsoldCartItemsReportView, {
      user: auditorOnlyThisReport,
      userRole: 'cashier',
      users: [auditorOnlyThisReport, cashierWithoutPerm]
    })
  );
  check(allowedHtml.includes('أصناف لم تُبع من شاشة البيع'), 'عنوان صفحة التقرير يظهر بالعربية');
  check(allowedHtml.includes('جميع المستخدمين'), 'فلتر جميع المستخدمين موجود');
  check(allowedHtml.includes('مفتوحة الآن') && allowedHtml.includes('متروكة بدون بيع') && allowedHtml.includes('بيعت الفاتورة'), 'خيارات فلتر الحالة بالعربية');
  check(
    allowedHtml.includes('حذف صنف') &&
      allowedHtml.includes('تقليل الكمية') &&
      allowedHtml.includes('تفريغ الفاتورة') &&
      allowedHtml.includes('إغلاق أو تحديث الصفحة') &&
      allowedHtml.includes('تسجيل خروج') &&
      allowedHtml.includes('إغلاق مفاجئ'),
    'خيارات فلتر الحدث بالعربية'
  );
  check(
    allowedHtml.includes('عدد السطور') &&
      allowedHtml.includes('إجمالي الكمية') &&
      allowedHtml.includes('إجمالي القيمة') &&
      allowedHtml.includes('عدد الفواتير المفتوحة الآن'),
    'عناصر ملخص المؤشرات الرقمية الأربعة موجودة'
  );
  check(allowedHtml.includes('ملخص حسب المستخدم'), 'قسم ملخص حسب المستخدم موجود');
  check(!allowedHtml.includes('تنبيهات الأجهزة'), 'قسم تنبيهات الأجهزة لا يظهر عندما لا توجد تنبيهات');

  // 4. تصيير ReportsPage على التبويب الجديد
  const reportsTabHtml = renderToStaticMarkup(
    React.createElement(ReportsPage, {
      reports: null,
      items: [],
      platforms: [],
      invoices: [],
      returns: [],
      user: auditorOnlyThisReport,
      userRole: 'cashier',
      users: [auditorOnlyThisReport],
      initialTab: 'UNSOLD_CART_ITEMS'
    })
  );
  check(reportsTabHtml.includes('أصناف لم تُبع من شاشة البيع'), 'ReportsPage يوجّه تبويب UNSOLD_CART_ITEMS إلى المكون الجديد');

  // 5. التحقق الساكن من ربط الملفات وعدم انتظار السجل أو إظهار أخطاء للكاشير
  const posSource = fs.readFileSync(path.resolve('src/pages/POSPage.tsx'), 'utf8');
  const appSource = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  const apiSource = fs.readFileSync(path.resolve('src/api/client.ts'), 'utf8');
  const offlineDbSource = fs.readFileSync(path.resolve('src/offline/db.ts'), 'utf8');
  const viewSource = fs.readFileSync(path.resolve('src/components/reports/UnsoldCartItemsReportView.tsx'), 'utf8');

  check(viewSource.includes('التقرير يحتاج اتصالًا بالإنترنت'), 'التقرير يعرض رسالة الحاجة للإنترنت عند الأوفلاين');
  check(viewSource.includes('وصل متأخرًا (أوفلاين)'), 'التقرير يميّز الأحداث المتأخرة القادمة من الأوفلاين');
  check(viewSource.includes('تنبيهات الأجهزة'), 'التقرير يضم قسم تنبيهات الأجهزة عند وجود تنبيهات');

  check(posSource.includes('getCartJournal().syncCart('), 'POSPage يستدعي syncCart');
  check(posSource.includes('cartId: getCartJournal().currentCartId()'), 'POSPage يرسل cartId في الفاتورة');
  check(posSource.includes('getCartJournal().cartSaved()'), 'POSPage يستدعي cartSaved بعد حفظ الفاتورة');
  const cartSavedIdx = posSource.indexOf('getCartJournal().cartSaved()');
  const setCartEmptyIdx = posSource.indexOf('setCart([])', cartSavedIdx);
  check(cartSavedIdx > 0 && setCartEmptyIdx > cartSavedIdx, 'cartSaved يُستدعى قبل setCart([]) لمنع تسجيل تفريغ وهمي');

  check(appSource.includes("getCartJournal().closeCart('logout')"), 'App يستدعي closeCart(logout) عند الخروج وتبديل المستخدم');
  check(appSource.includes('getCartJournal().flush()'), 'App يرفع الأحداث المعلقة عند الفتح والدخول وعودة الإنترنت');

  check(apiSource.includes("keepalive: Boolean(keepalive)") && apiSource.includes('/api/cart-journal/events'), 'sendCartJournalEvents يرسل POST بـ keepalive');
  check(!apiSource.slice(apiSource.indexOf('sendCartJournalEvents')).includes('sessionExpiredHandler'), 'sendCartJournalEvents لا يستدعي sessionExpiredHandler عند الفشل');
  check(offlineDbSource.includes('cartId: invoicePayload.cartId'), 'createOfflineInvoiceInDb يحفظ cartId داخل الفاتورة المحلية');
}

async function runOfflineSyncCartIdE2E() {
  // 6. محاكاة كاملة لمسار الأوفلاين: حفظ الفاتورة محليًا ثم مزامنتها عبر /api/offline/sync مع cartId
  const TENANT = 'test_cjui_sync';
  const NEW_PASSWORD = 'JournalUi#2026';
  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { app, persistence, cartJournal } = await createServerApp({
    attachVite: false,
    persistenceTransport: fake.transport,
    persistenceTenant: TENANT
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;

  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data: any = await res.json().catch(() => null);
    return { status: res.status, data };
  };

  try {
    const login = await call('POST', '/api/auth/login', {
      username: 'admin',
      password: process.env.INITIAL_USER_PASSWORD || '1234'
    });
    const token = login.data.token as string;
    await call('POST', '/api/auth/complete-initial-setup', { name: 'المدير', username: 'admin', newPassword: NEW_PASSWORD }, token);

    await call('POST', '/api/platforms', { name: 'البيع المباشر', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, token);
    const itemRes = await call(
      'POST',
      '/api/items',
      { name: 'دفتر سلك', barcode: '6229990001112', purchasePrice: 10, salePrice: 20, stockQuantity: 50, unit: 'قطعة' },
      token
    );
    const item = itemRes.data.item;

    const map = new Map<string, string>();
    const client = new CartJournalClient({
      storage: {
        getItem: k => map.get(k) ?? null,
        setItem: (k, v) => void map.set(k, v),
        removeItem: k => void map.delete(k)
      },
      autoTimers: false,
      send: async payload => {
        const res = await call('POST', '/api/cart-journal/events', payload, token);
        if (res.status !== 200 || !res.data?.success) throw new Error('send failed');
        return { lastSeq: res.data.lastSeq };
      }
    });
    client.start();

    // المستخدم أضاف 4 قطع ثم خفّضها إلى 1 وحفظ الفاتورة أوفلاين
    client.syncCart([{ itemId: item.id, name: item.name, barcode: item.barcode, unitPrice: 20, quantity: 4 }], {
      warehouseName: 'المخزن الرئيسي',
      platform: 'البيع المباشر'
    });
    client.syncCart([{ itemId: item.id, name: item.name, barcode: item.barcode, unitPrice: 20, quantity: 1 }]);
    const cartId = client.currentCartId();
    client.cartSaved();

    // عند رجوع الإنترنت: رفع الفاتورة عبر /api/offline/sync ثم رفع أحداث السجل
    const syncRes = await call(
      'POST',
      '/api/offline/sync',
      {
        type: 'createInvoice',
        idempotencyKey: `off-cj-${Date.now()}`,
        offlineProvisionalNo: `OFF-DEV-TEST-0001`,
        offlineDeviceId: 'dev-ui-test-01',
        deviceTime: new Date().toISOString(),
        cartId,
        platform: 'البيع المباشر',
        paymentType: 'نقدي',
        lines: [{ itemId: item.id, quantity: 1 }]
      },
      token
    );
    check(
      syncRes.status === 200 && syncRes.data?.success,
      `مزامنة فاتورة الأوفلاين مع cartId تنجح: ${syncRes.data?.error || ''}`
    );
    const syncedInvoiceNo = syncRes.data?.finalInvoiceNumber || syncRes.data?.invoice?.invoiceNumber;
    check(Boolean(syncedInvoiceNo), 'نتيجة مزامنة الأوفلاين ترجع رقم الفاتورة');

    check(await client.flush(), 'رفع أحداث السجل المخزنة بعد رجوع الإنترنت ينجح');
    await new Promise(resolve => setTimeout(resolve, 100));

    const reportRes = await call('GET', '/api/reports/unsold-cart-items', undefined, token);
    check(reportRes.status === 200 && Array.isArray(reportRes.data?.report?.rows), 'تقرير غير المباع يسترجع الصفوف');
    const rows = reportRes.data.report.rows as any[];
    check(
      rows.length === 1 &&
        rows[0].event === 'reduce' &&
        rows[0].quantity === 3 &&
        rows[0].cartStatus === 'sold' &&
        rows[0].invoiceNumber === syncedInvoiceNo,
      'الخصم عبر /api/offline/sync يطابق cartId ويبقي الـ 3 قطع المخفضة مرتبطة برقم الفاتورة'
    );
  } finally {
    persistence?.stop();
    cartJournal?.stop();
    server.close();
  }
}

async function main() {
  await runUiChecks();
  await runOfflineSyncCartIdE2E();
  console.log(`\n🎉 نجحت كل اختبارات واجهة وربط سجل شاشة البيع (${passed} تحققًا).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌', err?.message || err);
    process.exit(1);
  });

/**
 * اختبار حفظ «الربح وتكلفة الصنف وقت البيع» في كل فاتورة، وإخفاؤهم في كل مسار قراءة حسب الصلاحية
 * (بدون إنترنت — ناقل وهمي)
 * التشغيل:  npx tsx scripts/verify_invoice_cost_snapshot.ts
 *
 * المشكلة اللي بيحرسها: الفاتورة كانت بتتحفظ من غير الربح وسعر الشراء لو اللي عملها أو عدّلها
 * معندوش صلاحية يشوفهم، فتقرير الأرباح كان بيحسب فواتير الكاشير بصفر.
 * القاعدة: الفاتورة المحفوظة كاملة دايمًا، والإخفاء في الرد بس.
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import { createFakeTransport } from '../server/persistence/statePersistence.ts';

const TENANT = 'test_cost_snapshot';
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '1234';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

/** هل الكائن (أو أي فاتورة جواه) فيه ربح أو تكلفة؟ */
function leaksCost(value: unknown): string {
  const found: string[] = [];
  const walk = (v: any, path: string) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    for (const key of ['profit', 'unitProfit', 'purchasePriceAtSale', 'packagingCostAtSale']) {
      if (v[key] !== undefined && v[key] !== null) found.push(`${path}.${key}`);
    }
    for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
  };
  walk(value, '$');
  return found.join('، ');
}

async function main() {
  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { app, persistence } = await createServerApp({ attachVite: false, persistenceTransport: fake.transport, persistenceTenant: TENANT });
  assert(persistence && persistence.isReady(), 'طبقة الحفظ جاهزة');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  };
  const stored = (invoiceNumber: string) =>
    fake
      .dump(TENANT)
      .rows.filter(r => r.collection === 'invoices')
      .map(r => (r.data as any)?.v ?? r.data)
      .find((inv: any) => inv.invoiceNumber === invoiceNumber);
  const near = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.005;
  let seq = 0;
  const key = (p: string) => `${p}-${Date.now()}-${++seq}`;

  try {
    const login = async (username: string, password: string) => {
      const res = await call('POST', '/api/auth/login', { username, password });
      assert(res.status === 200 && res.data?.token, `دخول ${username}: ${res.data?.error || ''}`);
      return res.data.token as string;
    };
    let owner = await login('admin', INITIAL_PASSWORD);
    assert((await call('POST', '/api/auth/complete-initial-setup', { name: 'صاحب المحل', username: 'admin', newPassword: 'Cost#Owner2026' }, owner)).status === 200, 'إعداد حساب المالك');
    owner = await login('admin', 'Cost#Owner2026');

    const makeUser = async (username: string, name: string, phone: string, permissions: string[]) => {
      const created = await call('POST', '/api/users', { username, name, phone, role: 'employee', password: `${username}#2026x`, status: 'active', permissions }, owner);
      assert(created.status === 200, `مستخدم ${username}: ${created.data?.error || ''}`);
      let token = await login(username, `${username}#2026x`);
      if ((await call('GET', '/api/auth/me', undefined, token)).data?.user?.mustChangePassword) {
        await call('POST', '/api/auth/complete-initial-setup', { name, username, newPassword: `${username}#2026y` }, token);
        token = await login(username, `${username}#2026y`);
      }
      return token;
    };
    // كلهم من غير reports.view_profit ومن غير prices.view_purchase
    const seller = await makeUser('seller1', 'كاشير', '01066660001', ['invoices.create', 'invoices.view', 'invoices.view_in_pos', 'platforms.view', 'dashboard.view']);
    const editor = await makeUser('editor1', 'مشرف فواتير', '01066660002', ['invoices.view', 'invoices.create', 'invoices.edit_after_save', 'invoices.cancel', 'offline.manage', 'platforms.view']);
    const dispatcher = await makeUser('dispatch1', 'مسؤول توصيل', '01066660003', ['invoices.create', 'invoices.view', 'delivery.manage', 'delivery.view']);

    // ---- بيانات التجربة: صنف سعره 100 وتكلفته 60 + 5 تغليف → ربح القطعة 35 ----
    assert((await call('POST', '/api/platforms', { name: 'البيع المباشر', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, owner)).status === 200, 'منصة البيع المباشر');
    const noon = await call('POST', '/api/platforms', { name: 'نون', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, owner);
    assert(noon.status === 200 && noon.data?.platform?.id, 'منصة نون');
    const noonId = noon.data.platform.id as string;
    const category = await call('POST', '/api/categories', { name: 'عام' }, owner);
    const item = await call('POST', '/api/items', { name: 'شاحن', barcode: '6221000000777', purchasePrice: 60, packagingCost: 5, salePrice: 100, stockQuantity: 100, categoryId: category.data.category.id, unit: 'قطعة' }, owner);
    assert(item.status === 200 && item.data?.item?.id, `صنف: ${item.data?.error || ''}`);
    const itemId = item.data.item.id as string;
    const sell = (token: string, idem: string, extra: Record<string, unknown> = {}) =>
      call('POST', '/api/invoices', { idempotencyKey: idem, platform: 'البيع المباشر', paymentType: 'نقدي', lines: [{ itemId, quantity: 2 }], ...extra }, token);

    // ---- 1) فاتورة الكاشير: الرد من غير تكلفة، والمحفوظ كامل ----
    const sellerKey = key('cost-seller');
    const sellerSale = await sell(seller, sellerKey);
    assert(sellerSale.status === 200 && sellerSale.data?.invoice?.invoiceNumber, `بيع الكاشير: ${sellerSale.data?.error || ''}`);
    const sellerNo = sellerSale.data.invoice.invoiceNumber as string;
    assert(!leaksCost(sellerSale.data), `رد البيع للكاشير ما يكشفش الربح أو التكلفة (${leaksCost(sellerSale.data)})`);
    const savedSeller = stored(sellerNo);
    assert(near(savedSeller?.profit, 70), `فاتورة الكاشير محفوظة بالربح = 70 (المحفوظ: ${savedSeller?.profit})`);
    assert(near(savedSeller?.lines?.[0]?.purchasePriceAtSale, 60), `فاتورة الكاشير محفوظة بسعر الشراء وقت البيع = 60 (المحفوظ: ${savedSeller?.lines?.[0]?.purchasePriceAtSale})`);
    assert(near(savedSeller?.lines?.[0]?.packagingCostAtSale, 5), 'فاتورة الكاشير محفوظة بتكلفة التغليف وقت البيع');
    assert(near(savedSeller?.lines?.[0]?.unitProfit, 35), 'فاتورة الكاشير محفوظة بربح القطعة');

    // نفس الطلب مرتين (نت قطع ورجع): ما يتسجلش تاني، والرد برضه من غير تكلفة
    const again = await sell(seller, sellerKey);
    assert(again.status === 200 && again.data?.duplicate === true && again.data.invoice?.invoiceNumber === sellerNo, 'الطلب المكرر بيرجّع نفس الفاتورة');
    assert(!leaksCost(again.data), `رد الطلب المكرر ما يكشفش التكلفة (${leaksCost(again.data)})`);

    // ---- 2) القراءة: المالك يشوف، الكاشير لأ ----
    const ownerList = await call('GET', '/api/invoices', undefined, owner);
    const ownerSees = (ownerList.data?.invoices || []).find((i: any) => i.invoiceNumber === sellerNo);
    assert(near(ownerSees?.profit, 70), `المالك يشوف ربح فاتورة الكاشير في قائمة الفواتير (جاله: ${ownerSees?.profit})`);
    assert(near(ownerSees?.lines?.[0]?.purchasePriceAtSale, 60), 'المالك يشوف سعر الشراء وقت البيع');
    const sellerList = await call('GET', '/api/invoices', undefined, seller);
    assert(sellerList.status === 200 && !leaksCost(sellerList.data), `قائمة الفواتير للكاشير من غير تكلفة (${leaksCost(sellerList.data)})`);
    const sellerSync = await call('GET', '/api/sync', undefined, seller);
    assert(sellerSync.status === 200 && !leaksCost(sellerSync.data?.data?.invoices), `المزامنة الكاملة للكاشير من غير تكلفة (${leaksCost(sellerSync.data?.data?.invoices)})`);

    // ---- 3) تعديل الفاتورة بمستخدم معندوش صلاحية الربح: المحفوظ ما يتمسحش ----
    const ownerSale = await sell(owner, key('cost-owner'));
    const ownerNo = ownerSale.data.invoice.invoiceNumber as string;
    const edit = await call('PUT', `/api/invoices/${encodeURIComponent(ownerNo)}`, {
      editReason: 'تصحيح ملاحظة',
      notes: 'ملاحظة جديدة',
      // نفس السطور زي ما هي (سعر وكمية وضريبة) — التعديل في الملاحظات بس
      lines: ownerSale.data.invoice.lines
    }, editor);
    assert(edit.status === 200 && edit.data?.success, `تعديل الفاتورة: ${edit.data?.error || ''}`);
    assert(!leaksCost(edit.data), `رد التعديل ما يكشفش التكلفة (${leaksCost(edit.data)})`);
    const savedAfterEdit = stored(ownerNo);
    assert(savedAfterEdit?.notes === 'ملاحظة جديدة', 'التعديل اتحفظ');
    assert(near(savedAfterEdit?.profit, 70) && near(savedAfterEdit?.lines?.[0]?.purchasePriceAtSale, 60), `التعديل ما مسحش الربح وسعر الشراء من المحفوظ (الربح: ${savedAfterEdit?.profit})`);

    // سجل تعديلات الفاتورة فيه نسخة قبل وبعد: ما يكشفش التكلفة لغير المخوّل
    const logs = await call('GET', `/api/invoices/${encodeURIComponent(ownerNo)}/logs`, undefined, seller);
    assert(logs.status === 200 && (logs.data?.logs || []).length >= 1, 'سجل التعديلات موجود');
    assert(!leaksCost(logs.data), `سجل التعديلات للكاشير من غير تكلفة (${leaksCost(logs.data)})`);
    const ownerLogs = await call('GET', `/api/invoices/${encodeURIComponent(ownerNo)}/logs`, undefined, owner);
    assert(near(ownerLogs.data?.logs?.[0]?.afterSnapshot?.profit, 70), 'المالك يشوف الربح في سجل التعديلات');

    // ---- 4) كشف حساب المنصة: الفواتير المعلقة من غير تكلفة للكاشير ----
    const credit = await call('POST', '/api/invoices', {
      idempotencyKey: key('cost-credit'), platform: 'نون', platformId: noonId, platformName: 'نون',
      paymentType: 'آجل', creditPartyType: 'platform', lines: [{ itemId, quantity: 1 }]
    }, owner);
    assert(credit.status === 200, `فاتورة آجل على نون: ${credit.data?.error || ''}`);
    const creditNo = credit.data.invoice.invoiceNumber as string;
    const ledger = await call('GET', `/api/ledger/party?partyType=platform&partyId=${encodeURIComponent(noonId)}`, undefined, seller);
    assert(ledger.status === 200 && (ledger.data?.pendingInvoices || []).some((i: any) => i.invoiceNumber === creditNo), `كشف حساب نون للكاشير: ${ledger.data?.error || ''}`);
    assert(!leaksCost(ledger.data), `كشف حساب المنصة للكاشير من غير تكلفة (${leaksCost(ledger.data)})`);

    // رقم طلب المنصة بعد الحفظ
    const orderEdit = await call('PUT', `/api/invoices/${encodeURIComponent(creditNo)}/platform-order`, { platformOrderId: 'NOON-555', reason: 'نسيت أكتبه' }, editor);
    assert(orderEdit.status === 200, `تعديل رقم طلب المنصة: ${orderEdit.data?.error || ''}`);
    assert(!leaksCost(orderEdit.data), `رد تعديل رقم طلب المنصة من غير تكلفة (${leaksCost(orderEdit.data)})`);

    // ---- 5) الإلغاء: الرد من غير تكلفة، والمحفوظ كامل ----
    const cancel = await call('POST', `/api/invoices/${encodeURIComponent(sellerNo)}/cancel`, { reason: 'العميل رجع في كلامه' }, editor);
    assert(cancel.status === 200 && cancel.data?.success, `إلغاء الفاتورة: ${cancel.data?.error || ''}`);
    assert(!leaksCost(cancel.data), `رد الإلغاء من غير تكلفة (${leaksCost(cancel.data)})`);
    assert(near(stored(sellerNo)?.profit, 70), 'الفاتورة الملغاة محفوظة بتكلفتها');

    // ---- 6) فاتورة أوفلاين واعتماد مراجعتها ----
    const offline = await call('POST', '/api/offline/sync', {
      idempotencyKey: key('cost-offline'), isOfflineSync: true, invoiceNumber: `OFF-COST-${seq}`,
      platform: 'البيع المباشر', paymentType: 'نقدي',
      lines: [{ itemId, quantity: 1, baseUnitPrice: 90, salePriceAtSale: 90 }]
    }, seller);
    assert(offline.status === 200 && offline.data?.invoice?.invoiceNumber, `مزامنة فاتورة أوفلاين: ${offline.data?.error || ''}`);
    assert(!leaksCost(offline.data), `رد مزامنة الأوفلاين من غير تكلفة (${leaksCost(offline.data)})`);
    const offlineNo = offline.data.invoice.invoiceNumber as string;
    assert(near(stored(offlineNo)?.lines?.[0]?.purchasePriceAtSale, 60), 'فاتورة الأوفلاين محفوظة بسعر الشراء وقت البيع');
    const review = await call('POST', `/api/invoices/${encodeURIComponent(offlineNo)}/review`, { reviewNote: 'تمام' }, editor);
    assert(review.status === 200, `اعتماد المراجعة: ${review.data?.error || ''}`);
    assert(!leaksCost(review.data), `رد اعتماد المراجعة من غير تكلفة (${leaksCost(review.data)})`);

    // ---- 7) شحن طلب تجهيز توصيل: الفاتورة الراجعة من غير تكلفة ----
    assert((await call('POST', '/api/delivery/settings', { enabled: true, mode: 'both', zonePricing: false }, owner)).status === 200, 'تشغيل التوصيل');
    const driver = await call('POST', '/api/delivery/drivers', { name: 'سامي', phone: '01066660009', commissionPerOrder: 5 }, owner);
    assert(driver.status === 200, `طيار: ${driver.data?.error || ''}`);
    const driverId = (driver.data?.driver?.id || driver.data?.drivers?.[0]?.id) as string;
    const customer = await call('POST', '/api/customers', { name: 'عميل توصيل', phone: '01066660010', address: 'شارع 10' }, owner);
    const customerId = (customer.data?.customer?.id || customer.data?.data?.id || customer.data?.id) as string;
    const prep = await call('POST', '/api/delivery/preparations', { idempotencyKey: key('cost-prep'), customerId, paymentMode: 'cod', address: 'شارع 10', lines: [{ itemId, quantity: 1 }] }, dispatcher);
    assert(prep.status === 200 && prep.data?.order?.id, `طلب تجهيز: ${prep.data?.error || ''}`);
    const dispatch = await call('POST', `/api/delivery/preparations/${encodeURIComponent(prep.data.order.id)}/dispatch`, { revision: prep.data.order.revision, assigneeType: 'driver', assigneeId: driverId }, dispatcher);
    assert(dispatch.status === 200 && dispatch.data?.invoice?.invoiceNumber, `شحن طلب التجهيز: ${dispatch.data?.error || ''}`);
    assert(!leaksCost(dispatch.data), `رد شحن طلب التجهيز من غير تكلفة (${leaksCost(dispatch.data)})`);
    assert(near(stored(dispatch.data.invoice.invoiceNumber)?.lines?.[0]?.purchasePriceAtSale, 60), 'فاتورة التوصيل محفوظة بسعر الشراء وقت البيع');
    const dispatchAgain = await call('POST', `/api/delivery/preparations/${encodeURIComponent(prep.data.order.id)}/dispatch`, { revision: prep.data.order.revision, assigneeType: 'driver', assigneeId: driverId }, dispatcher);
    assert(!leaksCost(dispatchAgain.data), `رد إعادة الشحن (مكرر) من غير تكلفة (${leaksCost(dispatchAgain.data)})`);

    console.log(`✅ اختبار حفظ تكلفة الفاتورة وإخفائها حسب الصلاحية: ${passed} تحقق نجح`);
  } finally {
    server.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(`❌ ${err?.message || err}`);
    process.exit(1);
  });

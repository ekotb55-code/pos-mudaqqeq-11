/**
 * اختبار نظام التوصيل كامل عبر الـ API (ناقل وهمي):
 * طلب ← توزيع ← خرج ← اتسلم ← تسوية بعجز ← مرتجع ← إلغاء مدفوع مقدمًا ← شركة شحن ← صرف مستحقات الطيار.
 * بيتأكد إن المخزون والخزنة وعهدة الطيار مظبوطين بالقرش.
 * التشغيل:  npx tsx scripts/verify_delivery_wiring.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import { createFakeTransport } from '../server/persistence/statePersistence.ts';
import { readBackup } from '../server/backup.ts';

const TENANT = 'test_delivery';
const ADMIN_PASSWORD = 'Delivery#Admin2026';
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '1234';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}
const near = (a: number, b: number) => Math.abs(Number(a) - Number(b)) < 0.001;

async function main() {
  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { app, persistence } = await createServerApp({ attachVite: false, persistenceTransport: fake.transport, persistenceTenant: TENANT, imageStorage: null });
  assert(persistence && persistence.isReady(), 'طبقة الحفظ جاهزة');
  const engine = persistence!;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, url: string, body?: unknown, token?: string) => {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    let data: any = null;
    try {
      data = JSON.parse(buffer.toString('utf8'));
    } catch {
      data = null;
    }
    return { status: res.status, data, buffer };
  };
  const db = (collection: string) => fake.dump(TENANT).rows.filter(r => r.collection === collection);
  const docOf = (row: any) => (row?.data as any)?.v ?? row?.data;
  const arabic = /[\u0600-\u06FF]/;
  let counter = 0;
  const key = (p: string) => `${p}-${Date.now()}-${++counter}`;

  try {
    const login = async (username: string, password: string) => (await call('POST', '/api/auth/login', { username, password })).data?.token as string;
    let owner = await login('admin', INITIAL_PASSWORD);
    assert((await call('POST', '/api/auth/complete-initial-setup', { name: 'صاحب المحل', username: 'admin', newPassword: ADMIN_PASSWORD }, owner)).status === 200, 'إعداد المالك');
    owner = await login('admin', ADMIN_PASSWORD);
    const makeUser = async (username: string, name: string, phone: string, permissions: string[]) => {
      const created = await call('POST', '/api/users', { username, name, phone, role: 'employee', password: `${username}#2026x`, status: 'active', permissions }, owner);
      assert(created.status === 200, `مستخدم ${username}: ${created.data?.error || ''}`);
      let token = await login(username, `${username}#2026x`);
      if ((await call('GET', '/api/auth/me', undefined, token)).data?.user?.mustChangePassword) {
        await call('POST', '/api/auth/complete-initial-setup', { name, username, newPassword: `${username}#2026y` }, token);
        token = await login(username, `${username}#2026y`);
      }
      const userId = String(created.data?.user?.id || (await call('GET', '/api/auth/me', undefined, token)).data?.user?.id || '');
      return { token, userId };
    };
    const cashier = await makeUser('cashier1', 'كاشير', '01055551001', ['invoices.create', 'invoices.view', 'delivery.view']);
    const d1 = await makeUser('driver1', 'أحمد الطيار', '01055551002', ['delivery.driver']);
    const d2 = await makeUser('driver2', 'محمود الطيار', '01055551003', ['delivery.driver']);
    assert(d1.userId && d2.userId, 'حسابات الطيارين');

    // ---- بيانات التجربة ----
    assert((await call('POST', '/api/platforms', { name: 'البيع المباشر', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, owner)).status === 200, 'منصة البيع المباشر');
    const noon = await call('POST', '/api/platforms', { name: 'نون', discountPercentage: 10, pickupFee: 0, status: 'نشطة' }, owner);
    const category = await call('POST', '/api/categories', { name: 'عام' }, owner);
    const item = await call('POST', '/api/items', { name: 'شاحن', barcode: '6221000000101', purchasePrice: 60, salePrice: 100, stockQuantity: 50, categoryId: category.data.category.id, unit: 'قطعة' }, owner);
    assert(item.status === 200, `صنف: ${item.data?.error || ''}`);
    const itemId = item.data.item.id as string;
    const cb = await call('POST', '/api/cashboxes', { name: 'خزنة التوصيل', openingBalance: 2000 }, owner);
    assert(cb.status === 200, `خزنة: ${cb.data?.error || ''}`);
    const cashboxId = (cb.data.cashbox?.id || cb.data.id) as string;
    const balance = async () => Number(((await call('GET', '/api/cashboxes', undefined, owner)).data.cashboxes || []).find((c: any) => c.id === cashboxId)?.currentBalance);
    const stock = async () => Number(((await call('GET', '/api/items', undefined, owner)).data.items || []).find((i: any) => i.id === itemId)?.stockQuantity);
    assert(near(await balance(), 2000) && near(await stock(), 50), 'البداية: الخزنة 2000 والمخزون 50');

    const sell = (token: string, extra: Record<string, unknown> = {}, qty = 1) =>
      call('POST', '/api/invoices', { idempotencyKey: key('inv'), platform: 'البيع المباشر', paymentType: 'نقدي', cashboxId, lines: [{ itemId, quantity: qty }], ...extra }, token);

    // ==================== التوصيل مقفول ====================
    let r = await sell(owner, { delivery: { paymentMode: 'cod', address: 'شارع 9' } });
    assert(r.status === 400 && r.data.code === 'DELIVERY_DISABLED' && arabic.test(r.data.error), 'التوصيل مقفول: الفاتورة بتوصيل تترفض');
    assert((await call('GET', '/api/delivery/settings', undefined, cashier.token)).status === 403, 'الإعدادات محتاجة صلاحية');

    // ==================== الإعدادات ====================
    assert((await call('POST', '/api/delivery/settings', { mode: 'bikes' }, owner)).status === 400, 'مين بيوصّل غلط يترفض');
    let s = await call('POST', '/api/delivery/settings', { enabled: true, mode: 'both', zonePricing: true, maxDriverCustody: 300, lateAfterHours: 2 }, owner);
    assert(s.status === 200 && s.data.settings.enabled === true && s.data.settings.zonePricing === true, 'تشغيل التوصيل حسب المنطقة');
    const zA = await call('POST', '/api/delivery/zones', { name: 'المعادي', customerFee: 30, driverCommission: 15, minOrderValue: 150 }, owner);
    const zB = await call('POST', '/api/delivery/zones', { name: 'حلوان', customerFee: 20, driverCommission: 10 }, owner);
    assert(zA.status === 200 && zB.status === 200, 'منطقتين');
    assert((await call('POST', '/api/delivery/zones', { name: 'المعادي' }, owner)).status === 400, 'اسم منطقة مكرر يترفض');
    const zoneA = zA.data.saved.id as string;
    const zoneB = zB.data.saved.id as string;
    const dr1 = await call('POST', '/api/delivery/drivers', { name: 'أحمد', phone: '01055551002', monthlySalary: 1000, commissionPerOrder: 5, userId: d1.userId }, owner);
    const dr2 = await call('POST', '/api/delivery/drivers', { name: 'محمود', phone: '01055551003', userId: d2.userId }, owner);
    assert(dr1.status === 200 && dr2.status === 200, `طيارين: ${dr1.data?.error || dr2.data?.error || ''}`);
    assert((await call('POST', '/api/delivery/drivers', { name: 'تالت', userId: d1.userId }, owner)).status === 400, 'نفس الحساب لطيارين يترفض');
    const driver1 = dr1.data.saved.id as string;
    const driver2 = dr2.data.saved.id as string;
    const co = await call('POST', '/api/delivery/couriers', { name: 'بوسطة', feePerOrder: 25 }, owner);
    assert(co.status === 200, 'شركة شحن');
    const courier = co.data.saved.id as string;
    const full = await call('GET', '/api/delivery/settings', undefined, owner);
    assert(full.data.users.some((u: any) => u.id === d1.userId && u.isDriver), 'الإعدادات فيها حسابات الطيارين للربط');
    assert(db('auditLogs').some(rw => String(docOf(rw).action) === 'DELIVERY_SETTINGS_UPDATED'), 'الإعدادات في سجل التدقيق');

    const pub = await call('GET', '/api/delivery/config', undefined, cashier.token);
    assert(pub.status === 200 && pub.data.settings.enabled && pub.data.zones.length === 2 && pub.data.canEditFee === false, 'شاشة البيع: التوصيل شغال والمناطق');
    assert(pub.data.drivers.every((d: any) => d.monthlySalary === undefined), 'شاشة البيع ما تشوفش المرتبات');

    const cust = await call('POST', '/api/customers', { name: 'سارة محمد', phone: '01099990001', address: 'المعادي شارع 9', zoneId: zoneA }, owner);
    const customerId = (cust.data?.customer?.id || cust.data?.id) as string;
    assert(cust.status === 200 && customerId, 'عميل بمنطقة');

    // ==================== 1) الدفع عند الاستلام مع الطيار ====================
    r = await sell(cashier.token, { customerId, delivery: { paymentMode: 'cod' } }, 2);
    assert(r.status === 200, `طلب 1: ${r.data?.error || ''}`);
    const inv1 = r.data.invoice;
    assert(inv1.paymentType === 'آجل' && inv1.creditPartyType === 'delivery' && near(inv1.deliveryFee, 30) && near(inv1.netAmount, 230) && inv1.deliveryOrderId, 'الفاتورة: آجل على التوصيل، الرسوم من منطقة العميل 30، الإجمالي 230');
    assert(near(await balance(), 2000), 'الدفع عند الاستلام: الخزنة ما اتغيرتش');
    assert(near(await stock(), 48), 'المخزون اتخصم وقت الفاتورة (48)');
    let orders = (await call('GET', '/api/delivery/orders', undefined, cashier.token)).data.orders;
    const o1 = orders.find((o: any) => o.invoiceNumber === inv1.invoiceNumber);
    assert(o1 && o1.status === 'جديد' && near(o1.amountDue, 230) && o1.address === 'المعادي شارع 9' && o1.zoneName === 'المعادي' && o1.log[0].byName === 'كاشير', 'طلب التوصيل: جديد بالعنوان والمنطقة من العميل');

    // أقل قيمة طلب / الرسوم اليدوية / البيع على منصة
    const stockBefore = await stock();
    r = await sell(cashier.token, { customerId, delivery: { paymentMode: 'cod' } }, 1);
    assert(r.status === 400 && r.data.code === 'DELIVERY_MIN_ORDER' && near(await stock(), stockBefore), 'أقل من أقل قيمة طلب للمنطقة: مرفوض والمخزون زي ما هو');
    r = await sell(cashier.token, { delivery: { paymentMode: 'cod', address: 'حلوان', zoneId: zoneB, fee: 0 } });
    assert(r.status === 403 && r.data.code === 'DELIVERY_FEE_FORBIDDEN', 'تعديل الرسوم من غير صلاحية مرفوض');
    r = await sell(owner, { platform: 'نون', platformId: noon.data.platform.id, platformName: 'نون', delivery: { paymentMode: 'cod', address: 'x', zoneId: zoneB } });
    assert(r.status === 400 && r.data.code === 'DELIVERY_DIRECT_ONLY', 'التوصيل للبيع المباشر بس');
    r = await sell(cashier.token, { delivery: { paymentMode: 'cod', zoneId: zoneB } });
    assert(r.status === 400 && arabic.test(r.data.error), 'من غير عنوان مرفوض');
    r = await sell(cashier.token, { paymentType: 'آجل', creditPartyType: 'delivery' });
    assert(r.status === 400, 'آجل على التوصيل من غير طلب توصيل مرفوض');

    // ==================== التوزيع والطيار ====================
    assert((await call('POST', `/api/delivery/orders/${o1.id}/assign`, { assigneeType: 'driver', assigneeId: driver1 }, cashier.token)).status === 403, 'التوزيع محتاج صلاحية');
    r = await call('POST', `/api/delivery/orders/${o1.id}/assign`, { assigneeType: 'driver', assigneeId: driver1 }, owner);
    assert(r.status === 200 && r.data.order.assigneeName === 'أحمد', 'توزيع طلب 1 على أحمد');
    let mine1 = (await call('GET', '/api/delivery/my-orders', undefined, d1.token)).data;
    let mine2 = (await call('GET', '/api/delivery/my-orders', undefined, d2.token)).data;
    assert(mine1.open.length === 1 && mine1.open[0].id === o1.id && mine2.open.length === 0, 'كل طيار يشوف طلباته هو بس');
    assert((await call('GET', '/api/delivery/orders', undefined, d1.token)).status === 403, 'الطيار ما يشوفش شاشة التوصيل كلها');
    assert((await call('POST', `/api/delivery/my-orders/${o1.id}/status`, { status: 'خرج للتوصيل' }, d2.token)).status === 403, 'طيار تاني ما يغيّرش طلب مش بتاعه');
    assert((await call('POST', `/api/delivery/my-orders/${o1.id}/status`, { status: 'اتسلم' }, d1.token)).status === 400, 'اتسلم قبل خرج: مرفوض');
    r = await call('POST', `/api/delivery/my-orders/${o1.id}/status`, { status: 'خرج للتوصيل' }, d1.token);
    assert(r.status === 200 && r.data.order.status === 'خرج للتوصيل', 'الطيار: خرجت');
    r = await call('POST', `/api/delivery/my-orders/${o1.id}/status`, { status: 'اتسلم' }, d1.token);
    assert(r.status === 200 && r.data.order.status === 'اتسلم' && near(r.data.order.commission, 15) && !r.data.warning, 'الطيار: اتسلم، عمولة المنطقة 15، من غير تنبيه');
    mine1 = (await call('GET', '/api/delivery/my-orders', undefined, d1.token)).data;
    assert(near(mine1.custody, 230), 'عهدة الطيار 230');
    assert(near(await balance(), 2000), 'لسه ما دخلتش الخزنة');

    // ==================== 2) طلب تاني يعدّي الحد ====================
    r = await sell(cashier.token, { delivery: { paymentMode: 'cod', address: 'حلوان شارع 5', zoneId: zoneB, phone: '01099990002' } }, 3);
    assert(r.status === 200 && near(r.data.invoice.netAmount, 320), `طلب 2: 300 + 20 = 320 (${r.data?.error || ''})`);
    const inv2 = r.data.invoice;
    const o2 = inv2.deliveryOrderId as string;
    await call('POST', `/api/delivery/orders/${o2}/assign`, { assigneeType: 'driver', assigneeId: driver1 }, owner);
    await call('POST', `/api/delivery/orders/${o2}/status`, { status: 'خرج للتوصيل' }, owner);
    r = await call('POST', `/api/delivery/orders/${o2}/status`, { status: 'اتسلم' }, owner);
    assert(r.status === 200 && arabic.test(r.data.warning) && r.data.warning.includes('550'), `عهدة 550 أكتر من 300: تنبيه (${r.data.warning})`);
    assert(near(await stock(), 45), 'المخزون 45');

    // ==================== التسوية بعجز ====================
    const prev = await call('GET', `/api/delivery/settlement-preview?assigneeType=driver&assigneeId=${driver1}`, undefined, owner);
    assert(prev.status === 200 && prev.data.orders.length === 2 && near(prev.data.expected, 550), 'التسوية: طلبين والمفروض 550');
    const settleKey = key('stl');
    r = await call('POST', '/api/delivery/settle', { assigneeType: 'driver', assigneeId: driver1, receivedAmount: 540, cashboxId, idempotencyKey: settleKey }, owner);
    assert(r.status === 400 && r.data.requiresConfirmation && near(r.data.shortage, 10) && arabic.test(r.data.error), 'عجز 10: محتاج تأكيد');
    assert(near(await balance(), 2000), 'قبل التأكيد: الخزنة زي ما هي');
    r = await call('POST', '/api/delivery/settle', { assigneeType: 'driver', assigneeId: driver1, receivedAmount: 540, cashboxId, confirmDifference: true, idempotencyKey: settleKey }, owner);
    assert(r.status === 200 && near(r.data.settlement.shortage, 10) && near(r.data.settlement.received, 540), `التسوية اتسجلت بعجز 10 (${r.data?.error || ''})`);
    assert(near(await balance(), 2540), 'الخزنة 2540 (دخل 540 بالظبط)');
    r = await call('POST', '/api/delivery/settle', { assigneeType: 'driver', assigneeId: driver1, receivedAmount: 540, cashboxId, confirmDifference: true, idempotencyKey: settleKey }, owner);
    assert(r.status === 200 && r.data.duplicate === true && near(await balance(), 2540), 'نفس التسوية مرتين: ما تتسجلش تاني');
    const invDocs = () => db('invoices').map(docOf);
    assert([inv1, inv2].every(i => invDocs().find(x => x.invoiceNumber === i.invoiceNumber)?.creditStatus === 'مسددة'), 'الفواتير بقت مسددة');
    mine1 = (await call('GET', '/api/delivery/my-orders', undefined, d1.token)).data;
    assert(near(mine1.custody, 0), 'العهدة اتصفرت');
    const txs = db('cashboxTransactions').map(docOf).filter((t: any) => t.cashboxId === cashboxId && t.type === 'تحصيل توصيل');
    assert(txs.length === 1 && near(txs[0].amount, 540) && /^STL-/.test(txs[0].documentNumber), 'حركة الخزنة «تحصيل توصيل» برقم التسوية');

    // ==================== 3) ما اتسلمش ← رجع المحل ====================
    r = await sell(cashier.token, { customerId, delivery: { paymentMode: 'cod' } }, 2);
    const inv3 = r.data.invoice;
    const o3 = inv3.deliveryOrderId as string;
    assert(near(await stock(), 43), 'المخزون 43');
    await call('POST', `/api/delivery/orders/${o3}/assign`, { assigneeType: 'driver', assigneeId: driver1 }, owner);
    await call('POST', `/api/delivery/my-orders/${o3}/status`, { status: 'خرج للتوصيل' }, d1.token);
    assert((await call('POST', `/api/delivery/my-orders/${o3}/status`, { status: 'ما اتسلمش' }, d1.token)).status === 400, 'ما اتسلمش من غير سبب: مرفوض');
    r = await call('POST', `/api/delivery/my-orders/${o3}/status`, { status: 'ما اتسلمش', reason: 'العميل مش بيرد' }, d1.token);
    assert(r.status === 200 && r.data.order.failReason === 'العميل مش بيرد', 'الطيار: ما اتسلمش + السبب');
    assert((await call('POST', `/api/delivery/my-orders/${o3}/status`, { status: 'رجع المحل' }, d1.token)).status === 403, 'الطيار ما يرجّعش الطلب للمحل');
    const custBalBefore = Number(((await call('GET', '/api/customers', undefined, owner)).data.customers || []).find((c: any) => c.id === customerId)?.currentBalance || 0);
    r = await call('POST', `/api/delivery/orders/${o3}/status`, { status: 'رجع المحل' }, owner);
    assert(r.status === 200 && r.data.order.status === 'رجع المحل' && /^RET-/.test(r.data.returnNumber), `رجع المحل بمرتجع رسمي (${r.data?.error || ''})`);
    assert(near(await stock(), 45), 'البضاعة رجعت المخزون (45)');
    assert(near(await balance(), 2540), 'الخزنة ما اتغيرتش');
    const inv3Doc = invDocs().find(x => x.invoiceNumber === inv3.invoiceNumber);
    assert(inv3Doc.status === 'مرتجع' && inv3Doc.creditStatus === 'مسددة' && near(inv3Doc.remainingAmount, 0), 'الفاتورة مرتجع ومفيش عليها فلوس');
    const custBalAfter = Number(((await call('GET', '/api/customers', undefined, owner)).data.customers || []).find((c: any) => c.id === customerId)?.currentBalance || 0);
    assert(near(custBalBefore, custBalAfter), 'حساب العميل ما اتأثرش');
    assert(db('returns').map(docOf).some(x => x.invoiceNumber === inv3.invoiceNumber && x.refundStatus === 'قيد على الحساب'), 'المرتجع محفوظ');
    assert((await call('POST', `/api/delivery/orders/${o3}/status`, { status: 'اتلغى' }, owner)).status === 400, 'بعد ما رجع: الحالة مقفولة');

    // ==================== 4) مدفوع مقدمًا ← اتلغى ====================
    r = await sell(cashier.token, { delivery: { paymentMode: 'prepaid', address: 'حلوان', zoneId: zoneB } }, 1);
    const inv4 = r.data.invoice;
    assert(r.status === 200 && inv4.paymentType === 'نقدي' && near(inv4.netAmount, 120), 'مدفوع مقدمًا: نقدي 120');
    assert(near(await balance(), 2660) && near(await stock(), 44), 'الفلوس في الخزنة من الأول (2660) والمخزون 44');
    const o4 = inv4.deliveryOrderId as string;
    r = await call('POST', `/api/delivery/orders/${o4}/status`, { status: 'اتلغى' }, owner);
    assert(r.status === 400 && arabic.test(r.data.error), 'إلغاء مدفوع مقدمًا من غير خزنة الاسترداد: مرفوض');
    r = await call('POST', `/api/delivery/orders/${o4}/status`, { status: 'اتلغى', refundCashboxId: cashboxId, refundDeliveryFee: true, reason: 'العميل لغى' }, owner);
    assert(r.status === 200 && r.data.order.status === 'اتلغى', `اتلغى (${r.data?.error || ''})`);
    assert(near(await balance(), 2540) && near(await stock(), 45), 'رجعله 120 بالرسوم (2540) والبضاعة رجعت (45)');

    // ==================== 5) شركة شحن بالدفع عند الاستلام ====================
    r = await sell(cashier.token, { delivery: { paymentMode: 'cod', address: 'المعادي', zoneId: zoneA, assigneeType: 'courier', assigneeId: courier, trackingNumber: 'BOL-77' } }, 2);
    const inv5 = r.data.invoice;
    const o5 = inv5.deliveryOrderId as string;
    orders = (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders;
    assert(orders.find((o: any) => o.id === o5)?.trackingNumber === 'BOL-77', 'رقم البوليصة');
    await call('POST', `/api/delivery/orders/${o5}/status`, { status: 'خرج للتوصيل' }, owner);
    r = await call('POST', `/api/delivery/orders/${o5}/status`, { status: 'اتسلم' }, owner);
    assert(near(r.data.order.courierFee, 25), 'رسوم الشركة 25');
    const prevC = await call('GET', `/api/delivery/settlement-preview?assigneeType=courier&assigneeId=${courier}`, undefined, owner);
    assert(near(prevC.data.collected, 230) && near(prevC.data.courierFees, 25) && near(prevC.data.expected, 205), 'الشركة: محصل 230 − رسوم 25 = 205');
    r = await call('POST', '/api/delivery/settle', { assigneeType: 'courier', assigneeId: courier, receivedAmount: 205, cashboxId, idempotencyKey: key('stl') }, owner);
    assert(r.status === 200 && near(r.data.settlement.shortage, 0), 'تسوية الشركة من غير فرق');
    assert(near(await balance(), 2745), 'الخزنة 2745');

    // ==================== مستحقات الطيار ====================
    let dues = (await call('GET', `/api/delivery/drivers/${driver1}/dues`, undefined, owner)).data.dues;
    assert(near(dues.commissionUnpaid, 25) && near(dues.shortageOutstanding, 10) && near(dues.monthlySalary, 1000), 'المستحق: عمولة 15+10 = 25، عجز 10، مرتب 1000');
    r = await call('POST', '/api/delivery/payouts', { driverId: driver1, salary: 1000, payCommission: true, deductShortage: true, cashboxId, idempotencyKey: key('pay') }, owner);
    assert(r.status === 200 && near(r.data.payout.paid, 1015), `صرف 1000 + 25 − 10 = 1015 (${r.data?.error || ''})`);
    assert(near(await balance(), 1730), 'الخزنة 1730 بالظبط');
    dues = (await call('GET', `/api/delivery/drivers/${driver1}/dues`, undefined, owner)).data.dues;
    assert(near(dues.commissionUnpaid, 0) && near(dues.shortageOutstanding, 0), 'بعد الصرف: مفيش عمولة ولا عجز');
    assert((await call('POST', '/api/delivery/payouts', { driverId: driver1, payCommission: true, cashboxId, idempotencyKey: key('pay') }, owner)).status === 400, 'مفيش مستحقات: مرفوض');
    assert((await call('POST', '/api/delivery/payouts', { driverId: driver2, salary: 99999, cashboxId, idempotencyKey: key('pay') }, owner)).status === 400, 'رصيد الخزنة مش كفاية: مرفوض');

    // ==================== منع تعديل فاتورة التوصيل من برا ====================
    r = await sell(cashier.token, { customerId, delivery: { paymentMode: 'cod' } }, 2);
    const inv6 = r.data.invoice;
    r = await call('POST', `/api/invoices/${encodeURIComponent(inv6.invoiceNumber)}/cancel`, { reason: 'تجربة' }, owner);
    assert(r.status >= 400 && r.data.code === 'DELIVERY_INVOICE', 'إلغاء فاتورة التوصيل من الفواتير: مرفوض');
    r = await call('PUT', `/api/invoices/${encodeURIComponent(inv6.invoiceNumber)}`, { editReason: 'تجربة', lines: [{ itemId, quantity: 1 }] }, owner);
    assert(r.status >= 400 && (r.data.code === 'DELIVERY_INVOICE' || arabic.test(r.data.error)), 'تعديل فاتورة التوصيل: مرفوض');
    r = await call('POST', '/api/returns', { idempotencyKey: key('ret'), invoiceNumber: inv6.invoiceNumber, lines: [{ itemId, returnedQuantity: 1 }] }, owner);
    assert(r.status >= 400 && r.data.code === 'DELIVERY_INVOICE', 'مرتجع يدوي لطلب مفتوح: مرفوض');
    r = await call('POST', '/api/returns', { idempotencyKey: key('ret'), invoiceNumber: inv1.invoiceNumber, lines: [{ itemId, returnedQuantity: 1 }] }, owner);
    assert(r.status === 200, `بعد التسليم والتسوية: المرتجع العادي مسموح (${r.data?.error || ''})`);

    // ==================== التقارير ====================
    const rep = await call('GET', '/api/delivery/reports', undefined, owner);
    assert(rep.status === 200 && rep.data.openOrders.total === 1, 'التقرير: طلب مفتوح واحد');
    const perf = rep.data.performance.find((p: any) => p.driverId === driver1);
    assert(perf.orders === 3 && perf.delivered === 2 && perf.failed === 1 && perf.deliveredPercent === 67, 'أداء أحمد: 3 طلبات، 2 اتسلموا، 1 ما اتسلمش');
    assert(rep.data.settlements.count === 2 && near(rep.data.settlements.shortage, 10) && near(rep.data.settlements.received, 745), 'التسويات: 2، مستلم 745، عجز 10');
    assert(near(rep.data.fees.total, 80) && rep.data.fees.byZone.some((z: any) => z.name === 'المعادي' && near(z.total, 60)), 'رسوم التوصيل: 80 (المعادي 60)');
    assert(rep.data.custody.length === 0, 'مفيش عهدة مفتوحة');
    assert((await call('GET', '/api/delivery/reports', undefined, cashier.token)).status === 403, 'التقارير محتاجة صلاحية');

    // ==================== الحفظ وإعادة التشغيل والنسخة الاحتياطية وإعادة الضبط ====================
    const savedOps = docOf(db('delivery.operations')[0]);
    assert(savedOps.orders.length === 6 && savedOps.settlements.length === 2 && savedOps.payouts.length === 1, 'الطلبات والتسويات والصرف في قاعدة البيانات');
    await engine.lock.run(async () => {
      assert(await engine.recover(), 'تحميل الحالة بعد إعادة التشغيل');
    });
    orders = (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders;
    assert(orders.length === 6, 'بعد إعادة التشغيل: نفس الطلبات');
    const exported = await call('GET', '/api/backup/export', undefined, owner);
    assert(((readBackup(exported.buffer).data['delivery.config'] as any)?.drivers || []).length === 2, 'النسخة الاحتياطية فيها التوصيل');
    const status = await call('GET', '/api/system/reset-status', undefined, owner);
    const ops = await call('POST', '/api/system/reset-operations', { password: ADMIN_PASSWORD, confirmText: status.data.phrases.operations }, owner);
    assert(ops.status === 200, `إعادة ضبط العمليات: ${ops.data?.error || ''}`);
    owner = await login('admin', ADMIN_PASSWORD);
    assert((await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length === 0, 'إعادة ضبط العمليات: الطلبات اتمسحت');
    assert((await call('GET', '/api/delivery/settings', undefined, owner)).data.drivers.length === 2, 'والطيارين والمناطق فضلوا');
    const factory = await call('POST', '/api/system/factory-reset', { password: ADMIN_PASSWORD, confirmText: status.data.phrases.factory }, owner);
    assert(factory.status === 200, `إعادة ضبط المصنع: ${factory.data?.error || ''}`);
    const cfgAfter = docOf(db('delivery.config')[0]);
    assert(cfgAfter.settings.enabled === false && cfgAfter.drivers.length === 0, 'إعادة ضبط المصنع: التوصيل للافتراضي');

    console.log(`\n🎉 كل اختبارات نظام التوصيل نجحت (${passed} تحققًا).`);
  } finally {
    engine.stop();
    server.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌', err?.message || err);
    process.exit(1);
  });

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

    // ==================== المرحلة الثانية: طلبات تحضير التوصيل (قبل الشحن والفاتورة) ====================
    const invoicesBeforePrep = db('invoices').length;
    const stockBeforePrep = await stock();
    const balanceBeforePrep = await balance();
    const deliveryOrdersBeforePrep = (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length;
    const returnsBeforePrep = db('returns').length;
    const nextInvPeekBeforePrep = (await call('GET', '/api/invoices/next-number', undefined, cashier.token)).data?.nextNumber;

    // 1) الطيار لا يملك صلاحية إنشاء أو عرض طلبات التحضير، بينما الكاشير (invoices.create) والمالك يملكانها
    const prepIdemKey = key('prep');
    assert(
      (await call('POST', '/api/delivery/preparations', {
        idempotencyKey: prepIdemKey,
        customerId,
        paymentMode: 'cod',
        address: 'المعادي شارع 9 - عمارة 12',
        lines: [{ itemId, quantity: 2 }]
      }, d1.token)).status === 403,
      'الطيار مش مسموح له ينشئ طلب تحضير توصيل'
    );

    const prepCreate1 = await call('POST', '/api/delivery/preparations', {
      idempotencyKey: prepIdemKey,
      customerId,
      paymentMode: 'cod',
      address: 'المعادي شارع 9 - عمارة 12',
      notes: 'تجهيز كرتونة كبيرة',
      lines: [{ itemId, quantity: 2 }]
    }, cashier.token);
    assert(
      prepCreate1.status === 200 &&
        prepCreate1.data.order?.number === 'PRP-000001' &&
        prepCreate1.data.order?.status === 'قيد التحضير' &&
        prepCreate1.data.order?.revision === 1 &&
        near(prepCreate1.data.order?.itemsSubtotal, 200) &&
        near(prepCreate1.data.order?.fee, 30) &&
        near(prepCreate1.data.order?.estimatedTotal, 230),
      `إنشاء طلب تحضير التوصيل من الكاشير (${prepCreate1.data?.error || ''})`
    );
    const prepId1 = prepCreate1.data.order.id as string;

    // التحقق الصارم: لا فاتورة، لا رقم فاتورة مستهلك، لا خصم مخزون، لا حركة خزنة، لا طلب توصيل فاتورة
    const nextInvPeekAfterPrep = (await call('GET', '/api/invoices/next-number', undefined, cashier.token)).data?.nextNumber;
    assert(
      db('invoices').length === invoicesBeforePrep &&
        nextInvPeekAfterPrep === nextInvPeekBeforePrep &&
        near(await stock(), stockBeforePrep) &&
        near(await balance(), balanceBeforePrep) &&
        (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length === deliveryOrdersBeforePrep,
      'طلب التحضير لا ينشئ فاتورة ولا يستهلك رقم فاتورة ولا يخصم مخزونًا ولا يحرك الخزنة ولا ينشئ DeliveryOrder'
    );

    // 2) عدم التكرار بنفس idempotencyKey
    const prepCreateDup = await call('POST', '/api/delivery/preparations', {
      idempotencyKey: prepIdemKey,
      customerId,
      paymentMode: 'cod',
      address: 'عنوان مختلف لا يُعتمد عند التكرار',
      lines: [{ itemId, quantity: 4 }]
    }, cashier.token);
    assert(
      prepCreateDup.status === 200 &&
        prepCreateDup.data.duplicate === true &&
        prepCreateDup.data.order?.id === prepId1 &&
        prepCreateDup.data.order?.number === 'PRP-000001' &&
        (await call('GET', '/api/delivery/preparations', undefined, cashier.token)).data.orders.length === 1,
      'إعادة الإرسال بنفس idempotencyKey ترجع نفس طلب التحضير بدون تكرار'
    );

    // 3) تعديل الأصناف والكميات وبيانات العميل قبل الشحن
    const prepUpdate1 = await call('PUT', `/api/delivery/preparations/${encodeURIComponent(prepId1)}`, {
      revision: 1,
      address: 'المعادي شارع 105 - شقة 4',
      phone: '01099990077',
      notes: 'تعديل الكمية لـ 3 قطع',
      lines: [{ itemId, quantity: 3 }]
    }, cashier.token);
    assert(
      prepUpdate1.status === 200 &&
        prepUpdate1.data.order?.revision === 2 &&
        prepUpdate1.data.order?.address === 'المعادي شارع 105 - شقة 4' &&
        prepUpdate1.data.order?.phone === '01099990077' &&
        prepUpdate1.data.order?.lines?.length === 1 &&
        prepUpdate1.data.order?.lines[0]?.quantity === 3 &&
        near(prepUpdate1.data.order?.itemsSubtotal, 300) &&
        near(prepUpdate1.data.order?.estimatedTotal, 330) &&
        near(await stock(), stockBeforePrep),
      `تعديل طلب التحضير قبل الشحن بدون المساس بالمخزون (${prepUpdate1.data?.error || ''})`
    );

    // 4) رفض التعديل المتعارض عند اختلاف رقم المراجعة (409 REVISION_CONFLICT)
    const prepConflict = await call('PUT', `/api/delivery/preparations/${encodeURIComponent(prepId1)}`, {
      revision: 1,
      address: 'تعديل متأخر برقم مراجعة قديم'
    }, owner);
    assert(
      prepConflict.status === 409 &&
        prepConflict.data?.code === 'REVISION_CONFLICT' &&
        arabic.test(prepConflict.data?.error || ''),
      'رفض التعديل المتعارض برقم مراجعة قديم (409 REVISION_CONFLICT)'
    );

    // 5) إنشاء طلب تحضير ثانٍ ثم إلغاؤه قبل الشحن بدون أي حركة مخزون أو مرتجع أو خزنة
    const prepCreate2 = await call('POST', '/api/delivery/preparations', {
      idempotencyKey: key('prep2'),
      customerName: 'عميل تحضير تجريبي',
      phone: '01088887777',
      paymentMode: 'prepaid',
      address: 'حلوان شارع المراغي',
      zoneId: zoneB,
      lines: [{ itemId, quantity: 2 }]
    }, owner);
    assert(prepCreate2.status === 200 && prepCreate2.data.order?.number === 'PRP-000002', 'إنشاء طلب تحضير ثانٍ PRP-000002');
    const prepId2 = prepCreate2.data.order.id as string;

    const prepCancel2 = await call('POST', `/api/delivery/preparations/${encodeURIComponent(prepId2)}/cancel`, {
      reason: 'العميل ألغى الطلب قبل التجهيز والشحن',
      revision: 1
    }, cashier.token);
    assert(
      prepCancel2.status === 200 &&
        prepCancel2.data.order?.status === 'اتلغى' &&
        prepCancel2.data.order?.revision === 2 &&
        prepCancel2.data.order?.cancelReason === 'العميل ألغى الطلب قبل التجهيز والشحن' &&
        db('returns').length === returnsBeforePrep &&
        near(await stock(), stockBeforePrep) &&
        near(await balance(), balanceBeforePrep),
      'إلغاء طلب التحضير قبل الشحن لا ينشئ مرتجعًا ولا يغير المخزون أو الخزنة'
    );

    const openPreps = await call('GET', '/api/delivery/preparations?open=1', undefined, cashier.token);
    assert(
      openPreps.status === 200 && openPreps.data.orders.length === 1 && openPreps.data.orders[0].id === prepId1,
      'فلتر طلبات التحضير المفتوحة يرجع الطلبات قيد التحضير فقط'
    );

    // 6) التحقق من رفض العملية أوفلاين ومنع دخولها إلى Outbox
    const { assertNotDeliveryPreparationOutboxOperation, enqueueOutboxOperation } = await import('../src/offline/db.ts');
    const { api } = await import('../src/api/client.ts');
    let outboxRejected = false;
    try {
      assertNotDeliveryPreparationOutboxOperation({ type: 'createDeliveryPreparation' as any, payload: { isDeliveryPreparation: true } });
    } catch (err: any) {
      outboxRejected = err?.code === 'DELIVERY_PREP_OFFLINE_FORBIDDEN' && arabic.test(err?.message || '');
    }
    assert(outboxRejected, 'حارس Outbox يرفض عمليات تحضير التوصيل برسالة عربية واضحة');

    let enqueueRejected = false;
    try {
      await enqueueOutboxOperation({
        idempotencyKey: 'offline-prep-1',
        type: 'createDeliveryPreparation' as any,
        payload: { isDeliveryPreparation: true }
      });
    } catch (err: any) {
      enqueueRejected = err?.code === 'DELIVERY_PREP_OFFLINE_FORBIDDEN' && arabic.test(err?.message || '');
    }
    assert(enqueueRejected, 'enqueueOutboxOperation يرفض إدراج طلب تحضير التوصيل في Outbox');

    const prevNavigator = (globalThis as any).navigator;
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
        writable: true
      });
      let clientOfflineRejected = false;
      try {
        await api.createDeliveryPreparationOrder({
          idempotencyKey: 'offline-client-prep-1',
          address: 'المعادي',
          paymentMode: 'cod',
          lines: [{ itemId, quantity: 1 }]
        });
      } catch (err: any) {
        clientOfflineRejected = err?.code === 'DELIVERY_PREP_OFFLINE_FORBIDDEN' && arabic.test(err?.message || '');
      }
      assert(clientOfflineRejected, 'عميل الواجهة يرفض إنشاء طلب التحضير أوفلاين برسالة عربية واضحة');
      let clientDispatchOfflineRejected = false;
      try {
        await api.dispatchDeliveryPreparationOrder(prepId1, {
          revision: 2,
          assigneeType: 'driver',
          assigneeId: driver1
        });
      } catch (err: any) {
        clientDispatchOfflineRejected = err?.code === 'DELIVERY_PREP_OFFLINE_FORBIDDEN' && arabic.test(err?.message || '');
      }
      assert(clientDispatchOfflineRejected, 'عميل الواجهة يرفض شحن طلب التحضير أوفلاين برسالة عربية واضحة');
    } finally {
      if (prevNavigator === undefined) {
        delete (globalThis as any).navigator;
      } else {
        Object.defineProperty(globalThis, 'navigator', {
          value: prevNavigator,
          configurable: true,
          writable: true
        });
      }
    }

    // ==================== المرحلة الثالثة: شحن طلب التحضير وإصدار الفاتورة الرسمية وربطها ====================
    // التحقق من حماية الصلاحيات: الكاشير يملك invoices.create فقط ولا يملك delivery.manage، وموظف التوصيل يملك delivery.manage فقط ولا يملك invoices.create
    const dispatcherOnly = await makeUser('dispatcher_only', 'مسؤول توزيع فقط', '01055551099', ['delivery.manage', 'delivery.view']);
    const fullDispatcher = await makeUser('pos_dispatcher', 'مسؤول بيع وتوصيل', '01055551098', ['invoices.create', 'invoices.view', 'delivery.manage', 'delivery.view']);

    assert(
      (await call('POST', `/api/delivery/preparations/${encodeURIComponent(prepId1)}/dispatch`, {
        revision: 2,
        assigneeType: 'driver',
        assigneeId: driver1
      }, cashier.token)).status === 403,
      'حماية الصلاحيات: من يملك invoices.create بدون delivery.manage لا يمكنه شحن طلب التحضير'
    );
    assert(
      (await call('POST', `/api/delivery/preparations/${encodeURIComponent(prepId1)}/dispatch`, {
        revision: 2,
        assigneeType: 'driver',
        assigneeId: driver1
      }, dispatcherOnly.token)).status === 403,
      'حماية الصلاحيات: من يملك delivery.manage بدون invoices.create لا يمكنه إصدار فاتورة شحن طلب التحضير'
    );

    // السيناريو (1): رفض الشحن بدون طيار أو شركة شحن نشطة، مع صفر أثر جانبي
    const invCountBeforeS1 = db('invoices').length;
    const stockBeforeS1 = await stock();
    const balBeforeS1 = await balance();
    const dlvCountBeforeS1 = (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length;

    const noAssigneeRes = await call('POST', `/api/delivery/preparations/${encodeURIComponent(prepId1)}/dispatch`, {
      revision: 2
    }, fullDispatcher.token);
    assert(
      noAssigneeRes.status === 400 &&
        noAssigneeRes.data?.code === 'ASSIGNEE_REQUIRED' &&
        arabic.test(noAssigneeRes.data?.error || ''),
      `السيناريو 1-أ: رفض الشحن بدون تحديد طيار أو شركة شحن (${noAssigneeRes.data?.error || ''})`
    );

    // إيقاف الطيار الثاني مؤقتًا ومحاولة الشحن عليه
    await call('POST', '/api/delivery/drivers', { id: driver2, name: 'محمود', phone: '01055551003', userId: d2.userId, active: false }, owner);
    const inactiveDriverRes = await call('POST', `/api/delivery/preparations/${encodeURIComponent(prepId1)}/dispatch`, {
      revision: 2,
      assigneeType: 'driver',
      assigneeId: driver2
    }, fullDispatcher.token);
    assert(
      inactiveDriverRes.status === 400 &&
        arabic.test(inactiveDriverRes.data?.error || '') &&
        db('invoices').length === invCountBeforeS1 &&
        near(await stock(), stockBeforeS1) &&
        near(await balance(), balBeforeS1) &&
        (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length === dlvCountBeforeS1 &&
        (await call('GET', `/api/delivery/preparations/${encodeURIComponent(prepId1)}`, undefined, owner)).data.order?.status === 'قيد التحضير',
      `السيناريو 1-ب: رفض الشحن بطيار موقوف مع صفر أثر جانبي وبقاء الطلب قيد التحضير (${inactiveDriverRes.data?.error || ''})`
    );
    await call('POST', '/api/delivery/drivers', { id: driver2, name: 'محمود', phone: '01055551003', userId: d2.userId, active: true }, owner);

    // السيناريو (2): رفض الشحن عند نفاد المخزون بعد التحضير، مع صفر فاتورة وصفر حركة مخزون وصفر قيد خزنة، وبقاء طلب التحضير قابلًا للتعديل
    // أنشئ صنفًا جديدًا بكمية 3، وأنشئ له طلب تحضير بكمية 3 وسعر 150، ثم اسحب قطعتين في بيع مباشر ليصبح المتاح 1 فقط (الكمية الناقصة: 2)
    const scarceItemRes = await call('POST', '/api/items', {
      name: 'سماعة بلوتوث احترافية',
      barcode: '6221000000999',
      purchasePrice: 90,
      salePrice: 150,
      stockQuantity: 3,
      categoryId: category.data.category.id,
      unit: 'قطعة'
    }, owner);
    assert(scarceItemRes.status === 200, 'إنشاء صنف لاختبار نفاد المخزون والسعر المحفوظ');
    const scarceItemId = scarceItemRes.data.item.id as string;
    const scarceStock = async () => Number(((await call('GET', '/api/items', undefined, owner)).data.items || []).find((i: any) => i.id === scarceItemId)?.stockQuantity);

    const prepScarceCreate = await call('POST', '/api/delivery/preparations', {
      idempotencyKey: key('prep-scarce'),
      customerId,
      paymentMode: 'cod',
      address: 'المعادي شارع 9 - شقة 8',
      assigneeType: 'driver',
      assigneeId: driver1,
      lines: [{ itemId: scarceItemId, quantity: 3 }]
    }, fullDispatcher.token);
    assert(prepScarceCreate.status === 200 && prepScarceCreate.data.order?.number === 'PRP-000003', 'إنشاء طلب تحضير PRP-000003 بكمية 3');
    const prepScarceId = prepScarceCreate.data.order.id as string;

    // بيع قطعتين من الصنف مباشرة ليصبح المتاح 1 فقط بعد التحضير
    const directConsume = await call('POST', '/api/invoices', {
      idempotencyKey: key('inv-consume'),
      platform: 'البيع المباشر',
      paymentType: 'نقدي',
      cashboxId,
      lines: [{ itemId: scarceItemId, quantity: 2 }]
    }, cashier.token);
    assert(directConsume.status === 200 && near(await scarceStock(), 1), 'استهلاك قطعتين بعد التحضير ليصبح المتاح 1');

    const invCountBeforeS2 = db('invoices').length;
    const movCountBeforeS2 = db('stockMovements').length;
    const cbTxCountBeforeS2 = db('cashboxTransactions').length;
    const dlvCountBeforeS2 = (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length;
    const nextInvPeekBeforeS2 = (await call('GET', '/api/invoices/next-number', undefined, cashier.token)).data?.nextNumber;

    const insufficientRes = await call('POST', `/api/delivery/preparations/${encodeURIComponent(prepScarceId)}/dispatch`, {
      revision: 1,
      assigneeType: 'driver',
      assigneeId: driver1
    }, fullDispatcher.token);
    assert(
      insufficientRes.status === 409 &&
        insufficientRes.data?.code === 'INSUFFICIENT_STOCK' &&
        String(insufficientRes.data?.error || '').includes('سماعة بلوتوث احترافية') &&
        String(insufficientRes.data?.error || '').includes('الكمية الناقصة: 2') &&
        db('invoices').length === invCountBeforeS2 &&
        db('stockMovements').length === movCountBeforeS2 &&
        db('cashboxTransactions').length === cbTxCountBeforeS2 &&
        (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length === dlvCountBeforeS2 &&
        (await call('GET', '/api/invoices/next-number', undefined, cashier.token)).data?.nextNumber === nextInvPeekBeforeS2 &&
        near(await scarceStock(), 1),
      `السيناريو 2-أ: رفض الشحن عند نقص المخزون برسالة عربية تحدد الصنف والكمية الناقصة وصفر أثر جانبي (${insufficientRes.data?.error || ''})`
    );

    // التحقق من بقاء طلب التحضير قابلًا للتعديل بعد فشل المخزون، وتقليل الكمية إلى 1، وتغيير سعر كتالوج الصنف للتأكد أن الشحن يحترم السعر المحفوظ في التحضير (150 وليس 180)
    await call('PUT', `/api/items/${encodeURIComponent(scarceItemId)}`, {
      name: 'سماعة بلوتوث احترافية',
      salePrice: 180
    }, owner);
    const editAfterInsufficient = await call('PUT', `/api/delivery/preparations/${encodeURIComponent(prepScarceId)}`, {
      revision: 1,
      notes: 'تعديل الملاحظة فقط مع الاحتفاظ بالسعر المحفوظ'
    }, fullDispatcher.token);
    assert(
      editAfterInsufficient.status === 200 &&
        editAfterInsufficient.data.order?.status === 'قيد التحضير' &&
        editAfterInsufficient.data.order?.revision === 2 &&
        near(editAfterInsufficient.data.order?.lines?.[0]?.unitPrice, 150),
      'السيناريو 2-ب: بقاء طلب التحضير قابلًا للتعديل بعد رفض الشحن لنقص المخزون مع الحفاظ على السعر المحفوظ (150)'
    );
    // إلغاء PRP-000003 بعد التعديل للتأكد من بقائه قابلًا للإلغاء أيضًا
    const cancelAfterInsufficient = await call('POST', `/api/delivery/preparations/${encodeURIComponent(prepScarceId)}/cancel`, {
      revision: 2,
      reason: 'نفاد الكمية المطلوبة'
    }, fullDispatcher.token);
    assert(cancelAfterInsufficient.status === 200 && cancelAfterInsufficient.data.order?.status === 'اتلغى', 'السيناريو 2-ج: بقاء طلب التحضير قابلًا للإلغاء بعد رفض الشحن');

    // السيناريو (3): نجاح الشحن — فاتورة واحدة، خصم مخزون واحد، وسجل توصيل واحد مرتبط بطلب التحضير، مع تطابق الحالة ورقم الفاتورة واحترام السعر المحفوظ
    // لنعدّل سعر الصنف الأساسي (شاحن) في الكتالوج من 100 إلى 125 بعد التحضير لنتأكد أن طلب التحضير prepId1 (3 قطع × 100 = 300 + 30 رسوم = 330) يشحن بالسعر المحفوظ (100) وليس 125!
    await call('PUT', `/api/items/${encodeURIComponent(itemId)}`, {
      name: 'شاحن',
      salePrice: 125
    }, owner);

    const invCountBeforeS3 = db('invoices').length;
    const stockBeforeS3 = await stock();
    const balBeforeS3 = await balance();
    const dlvCountBeforeS3 = (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length;

    const dispatchRes1 = await call('POST', `/api/delivery/preparations/${encodeURIComponent(prepId1)}/dispatch`, {
      revision: 2,
      assigneeType: 'driver',
      assigneeId: driver1
    }, fullDispatcher.token);
    assert(
      dispatchRes1.status === 200 &&
        dispatchRes1.data?.order?.status === 'خرج للتوصيل' &&
        dispatchRes1.data?.order?.revision === 3 &&
        Boolean(dispatchRes1.data?.order?.invoiceNumber) &&
        dispatchRes1.data?.order?.invoiceNumber === dispatchRes1.data?.invoice?.invoiceNumber &&
        dispatchRes1.data?.order?.deliveryOrderId === dispatchRes1.data?.deliveryOrder?.id &&
        dispatchRes1.data?.order?.deliveryOrderNumber === dispatchRes1.data?.deliveryOrder?.number &&
        dispatchRes1.data?.deliveryOrder?.status === 'خرج للتوصيل' &&
        dispatchRes1.data?.deliveryOrder?.preparationId === prepId1 &&
        dispatchRes1.data?.deliveryOrder?.preparationNumber === 'PRP-000001' &&
        dispatchRes1.data?.invoice?.preparationId === prepId1 &&
        dispatchRes1.data?.invoice?.preparationNumber === 'PRP-000001' &&
        near(dispatchRes1.data?.invoice?.lines?.[0]?.salePriceAtSale, 100) &&
        near(dispatchRes1.data?.invoice?.totalBeforeDiscount, 300) &&
        near(dispatchRes1.data?.invoice?.deliveryFee, 30) &&
        near(dispatchRes1.data?.invoice?.netAmount, 330) &&
        near(dispatchRes1.data?.deliveryOrder?.amountDue, 330) &&
        db('invoices').length === invCountBeforeS3 + 1 &&
        near(await stock(), stockBeforeS3 - 3) &&
        near(await balance(), balBeforeS3) &&
        (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length === dlvCountBeforeS3 + 1,
      `السيناريو 3: نجاح الشحن — فاتورة واحدة (${dispatchRes1.data?.invoice?.invoiceNumber}) بالسعر المحفوظ (100)، خصم مخزون واحد (-3)، وسجل توصيل واحد فقط (${dispatchRes1.data?.deliveryOrder?.number}) في حالة خرج للتوصيل مرتبط بطلب التحضير (${dispatchRes1.data?.error || ''})`
    );
    const dispatchedInvoiceNumber1 = dispatchRes1.data.invoice.invoiceNumber as string;
    const dispatchedDeliveryOrderId1 = dispatchRes1.data.deliveryOrder.id as string;

    // إعادة سعر الصنف إلى 100
    await call('PUT', `/api/items/${encodeURIComponent(itemId)}`, {
      name: 'شاحن',
      salePrice: 100
    }, owner);

    // السيناريو (4): تكرار طلب الشحن بنفس المفتاح/الطلب لا يكرر الفاتورة أو الخصم أو سجل التوصيل
    const stockBeforeS4 = await stock();
    const invCountBeforeS4 = db('invoices').length;
    const dlvCountBeforeS4 = (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length;

    const dispatchDupRes = await call('POST', `/api/delivery/preparations/${encodeURIComponent(prepId1)}/dispatch`, {
      revision: 2,
      assigneeType: 'driver',
      assigneeId: driver1
    }, fullDispatcher.token);
    assert(
      dispatchDupRes.status === 200 &&
        dispatchDupRes.data?.duplicate === true &&
        dispatchDupRes.data?.invoice?.invoiceNumber === dispatchedInvoiceNumber1 &&
        dispatchDupRes.data?.deliveryOrder?.id === dispatchedDeliveryOrderId1 &&
        dispatchDupRes.data?.order?.invoiceNumber === dispatchedInvoiceNumber1 &&
        db('invoices').length === invCountBeforeS4 &&
        near(await stock(), stockBeforeS4) &&
        (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length === dlvCountBeforeS4,
      'السيناريو 4: تكرار طلب الشحن لا يكرر الفاتورة ولا خصم المخزون ولا سجل التوصيل'
    );

    // السيناريو (5): محاكاة انقطاع بعد createInvoice وقبل ربط طلب التحضير، ثم إعادة المحاولة واستكمال الربط على نفس الفاتورة دون تكرار
    const prepInterruptCreate = await call('POST', '/api/delivery/preparations', {
      idempotencyKey: key('prep-interrupt'),
      customerId,
      paymentMode: 'prepaid',
      address: 'المعادي شارع 9 - برج النيل',
      lines: [{ itemId, quantity: 2 }]
    }, fullDispatcher.token);
    assert(prepInterruptCreate.status === 200 && prepInterruptCreate.data.order?.number === 'PRP-000004', 'إنشاء طلب تحضير PRP-000004 لاختبار الانقطاع والاستعادة');
    const prepInterruptId = prepInterruptCreate.data.order.id as string;

    const stockBeforeS5 = await stock();
    const balBeforeS5 = await balance();
    const invCountBeforeS5 = db('invoices').length;
    const dlvCountBeforeS5 = (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length;

    const { dispatchPreparationOrder } = await import('../server/deliveryService.ts');
    let simulatedCrashCaught = false;
    try {
      await dispatchPreparationOrder(
        prepInterruptId,
        { revision: 1, assigneeType: 'driver', assigneeId: driver1, cashboxId },
        { userId: fullDispatcher.userId, name: 'مسؤول بيع وتوصيل', role: 'employee', permissions: ['invoices.create', 'invoices.view', 'delivery.manage', 'delivery.view'] },
        { simulateInterruptAfterInvoice: true }
      );
    } catch (err: any) {
      simulatedCrashCaught = String(err?.message || '') === 'SIMULATED_INTERRUPT_AFTER_INVOICE';
    }
    await engine.lock.run(async () => {
      await engine.persist();
    });
    assert(
      simulatedCrashCaught &&
        db('invoices').length === invCountBeforeS5 + 1 &&
        near(await stock(), stockBeforeS5 - 2) &&
        near(await balance(), balBeforeS5 + 230) &&
        (await call('GET', `/api/delivery/preparations/${encodeURIComponent(prepInterruptId)}`, undefined, owner)).data.order?.status === 'جاري الشحن' &&
        (await call('GET', `/api/delivery/preparations/${encodeURIComponent(prepInterruptId)}`, undefined, owner)).data.order?.invoiceNumber === '',
      'السيناريو 5-أ: الانقطاع بعد createInvoice أنشأ الفاتورة وخصم المخزون مرة واحدة بينما بقي طلب التحضير غير مربوط في حالة جاري الشحن'
    );

    // أثناء حالة جاري الشحن (قبل استكمال الربط) يُمنع التعديل أو الإلغاء حتى لا يحدث تضارب مع الفاتورة المنشأة
    assert(
      (await call('PUT', `/api/delivery/preparations/${encodeURIComponent(prepInterruptId)}`, { revision: 1, address: 'منع تعديل أثناء الانقطاع' }, fullDispatcher.token)).status === 409,
      'السيناريو 5-ب: منع تعديل طلب التحضير المعلّق في جاري الشحن قبل استكمال ربط فاتورته'
    );

    // إعادة محاولة الشحن عبر الـ API تستعيد الفاتورة الموجودة بالمفتاح الحتمي وتستكمل الربط دون تكرار الفاتورة أو الخصم أو الخزنة أو سجل التوصيل
    const retryAfterInterrupt = await call('POST', `/api/delivery/preparations/${encodeURIComponent(prepInterruptId)}/dispatch`, {
      revision: 1,
      assigneeType: 'driver',
      assigneeId: driver1,
      cashboxId
    }, fullDispatcher.token);
    assert(
      retryAfterInterrupt.status === 200 &&
        retryAfterInterrupt.data?.recovered === true &&
        retryAfterInterrupt.data?.duplicate === true &&
        retryAfterInterrupt.data?.order?.status === 'خرج للتوصيل' &&
        Boolean(retryAfterInterrupt.data?.order?.invoiceNumber) &&
        retryAfterInterrupt.data?.order?.invoiceNumber === retryAfterInterrupt.data?.invoice?.invoiceNumber &&
        retryAfterInterrupt.data?.order?.deliveryOrderId === retryAfterInterrupt.data?.deliveryOrder?.id &&
        retryAfterInterrupt.data?.deliveryOrder?.status === 'خرج للتوصيل' &&
        retryAfterInterrupt.data?.deliveryOrder?.preparationId === prepInterruptId &&
        db('invoices').length === invCountBeforeS5 + 1 &&
        near(await stock(), stockBeforeS5 - 2) &&
        near(await balance(), balBeforeS5 + 230) &&
        (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length === dlvCountBeforeS5 + 1,
      `السيناريو 5-ج: إعادة المحاولة بعد الانقطاع عثرت على الفاتورة الموجودة واستكملت الربط بدون تكرار الفاتورة أو خصم المخزون أو الخزنة أو سجل التوصيل (${retryAfterInterrupt.data?.error || ''})`
    );

    // السيناريو (6): رفض تعديل أو إلغاء طلب التحضير بعد شحنه
    const editDispatchedRes = await call('PUT', `/api/delivery/preparations/${encodeURIComponent(prepId1)}`, {
      revision: 3,
      address: 'محاولة تعديل بعد الشحن'
    }, owner);
    assert(
      editDispatchedRes.status === 409 &&
        editDispatchedRes.data?.code === 'ALREADY_DISPATCHED' &&
        arabic.test(editDispatchedRes.data?.error || ''),
      'السيناريو 6-أ: رفض تعديل طلب التحضير بعد إرساله للشحن (409 ALREADY_DISPATCHED)'
    );

    const cancelDispatchedRes = await call('POST', `/api/delivery/preparations/${encodeURIComponent(prepId1)}/cancel`, {
      revision: 3,
      reason: 'محاولة إلغاء بعد الشحن'
    }, owner);
    assert(
      cancelDispatchedRes.status === 409 &&
        cancelDispatchedRes.data?.code === 'ALREADY_DISPATCHED' &&
        arabic.test(cancelDispatchedRes.data?.error || ''),
      'السيناريو 6-ب: رفض إلغاء طلب التحضير بعد إرساله للشحن (409 ALREADY_DISPATCHED)'
    );

    // السيناريو (7) + الحفظ وإعادة التشغيل والنسخة الاحتياطية وإعادة الضبط ====================
    const savedOps = docOf(db('delivery.operations')[0]);
    const savedPreps = db('delivery.preparations').map(docOf);
    assert(savedOps.orders.length === 8 && savedOps.settlements.length === 2 && savedOps.payouts.length === 1, 'الطلبات والتسويات والصرف في قاعدة البيانات');
    assert(
      savedPreps.length === 4 &&
        savedOps.preparations === undefined &&
        savedPreps.some((p: any) => p.id === prepId1 && p.status === 'خرج للتوصيل' && p.invoiceNumber === dispatchedInvoiceNumber1),
      'طلبات التحضير المشحونة محفوظة في مجموعة مستقلة delivery.preparations مع رقم الفاتورة المرتبط'
    );
    await engine.lock.run(async () => {
      assert(await engine.recover(), 'تحميل الحالة بعد إعادة التشغيل');
    });
    orders = (await call('GET', '/api/delivery/orders', undefined, owner)).data.orders;
    assert(
      orders.length === 8 &&
        orders.some((o: any) => o.id === dispatchedDeliveryOrderId1 && o.preparationId === prepId1 && o.status === 'خرج للتوصيل') &&
        orders.some((o: any) => o.id === o1.id && !o.preparationId),
      'السيناريو 7: بعد إعادة التشغيل تتعايش سجلات التوصيل القديمة (بدون preparationId) والجديدة المرتبطة بطلب التحضير بتوافق كامل'
    );
    const prepsAfterRecover = (await call('GET', '/api/delivery/preparations', undefined, owner)).data.orders;
    assert(
      prepsAfterRecover.length === 4 &&
        prepsAfterRecover.find((p: any) => p.id === prepId1)?.status === 'خرج للتوصيل' &&
        prepsAfterRecover.find((p: any) => p.id === prepId1)?.invoiceNumber === dispatchedInvoiceNumber1 &&
        prepsAfterRecover.find((p: any) => p.id === prepId2)?.status === 'اتلغى',
      'بعد إعادة التشغيل: استرجاع طلبات التحضير بكامل بنودها ومراجعاتها وحالات الشحن وأرقام الفواتير'
    );
    const exported = await call('GET', '/api/backup/export', undefined, owner);
    const parsedBackup = readBackup(exported.buffer);
    assert(((parsedBackup.data['delivery.config'] as any)?.drivers || []).length === 2, 'النسخة الاحتياطية فيها التوصيل');
    assert(Array.isArray(parsedBackup.data['delivery.preparations']) && (parsedBackup.data['delivery.preparations'] as any[]).length === 4, 'النسخة الاحتياطية تشمل طلبات التحضير');
    const status = await call('GET', '/api/system/reset-status', undefined, owner);
    const ops = await call('POST', '/api/system/reset-operations', { password: ADMIN_PASSWORD, confirmText: status.data.phrases.operations }, owner);
    assert(ops.status === 200, `إعادة ضبط العمليات: ${ops.data?.error || ''}`);
    owner = await login('admin', ADMIN_PASSWORD);
    assert((await call('GET', '/api/delivery/orders', undefined, owner)).data.orders.length === 0, 'إعادة ضبط العمليات: الطلبات اتمسحت');
    assert((await call('GET', '/api/delivery/preparations', undefined, owner)).data.orders.length === 0 && db('delivery.preparations').length === 0, 'إعادة ضبط العمليات: طلبات التحضير اتمسحت من الذاكرة وقاعدة البيانات');
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

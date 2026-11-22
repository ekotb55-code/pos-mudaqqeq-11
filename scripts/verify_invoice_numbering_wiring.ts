/**
 * اختبار ربط ترقيم الفواتير ورقم طلب المنصة و«بيع المنصات دايمًا آجل» بالسيرفر عبر الـ API (ناقل وهمي)
 * التشغيل:  npx tsx scripts/verify_invoice_numbering_wiring.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import { createFakeTransport } from '../server/persistence/statePersistence.ts';
import { readBackup } from '../server/backup.ts';

const TENANT = 'test_numbering';
const ADMIN_PASSWORD = 'Numbers#Admin2026';
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '1234';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

/** تاريخ اليوم بتوقيت القاهرة بالشكل 20261120 */
function cairoToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value;
  return `${get('year')}${get('month')}${get('day')}`;
}

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
  const invoiceDocs = () => db('invoices').map(docOf);
  const arabic = /[\u0600-\u06FF]/;
  const today = cairoToday();
  let counter = 0;

  try {
    const loginAs = async (username: string, name: string, newPassword: string) => {
      const login = await call('POST', '/api/auth/login', { username, password: INITIAL_PASSWORD });
      const token = login.data.token as string;
      const setup = await call('POST', '/api/auth/complete-initial-setup', { name, username, newPassword }, token);
      assert(setup.status === 200, `إعداد حساب ${username}: ${setup.data?.error || ''}`);
      return token;
    };
    let owner = await loginAs('admin', 'صاحب المحل', ADMIN_PASSWORD);
    const manager = await loginAs('manager', 'مدير الفرع', 'Numbers#Manager2026');

    // ---- بيانات التجربة ----
    assert((await call('POST', '/api/platforms', { name: 'البيع المباشر', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, owner)).status === 200, 'منصة البيع المباشر');
    const noon = await call('POST', '/api/platforms', { name: 'نون', discountPercentage: 10, pickupFee: 0, status: 'نشطة' }, owner);
    const jumia = await call('POST', '/api/platforms', { name: 'جوميا', discountPercentage: 12, pickupFee: 0, status: 'نشطة' }, owner);
    assert(noon.status === 200 && jumia.status === 200, 'منصتان');
    const noonId = noon.data.platform.id as string;
    const jumiaId = jumia.data.platform.id as string;
    const category = await call('POST', '/api/categories', { name: 'عام' }, owner);
    const item = await call('POST', '/api/items', { name: 'سماعة', barcode: '6221000000011', purchasePrice: 50, salePrice: 100, stockQuantity: 500, categoryId: category.data.category.id, unit: 'قطعة' }, owner);
    assert(item.status === 200, 'صنف');
    const itemId = item.data.item.id as string;
    const customer = await call('POST', '/api/customers', { name: 'محمد علي', phone: '01000000002' }, owner);
    const customerId = (customer.data?.customer?.id || customer.data?.data?.id || customer.data?.id) as string;
    assert(customer.status === 200 && customerId, 'عميل');

    const sell = (token: string, extra: Record<string, unknown> = {}) =>
      call('POST', '/api/invoices', { idempotencyKey: `num-${Date.now()}-${++counter}`, platform: 'البيع المباشر', paymentType: 'نقدي', lines: [{ itemId, quantity: 1 }], ...extra }, token);
    const noonSale = (token: string, extra: Record<string, unknown> = {}) =>
      sell(token, { platform: 'نون', platformId: noonId, platformName: 'نون', ...extra });
    const noonCredit = (token: string, extra: Record<string, unknown> = {}) =>
      noonSale(token, { paymentType: 'آجل', creditPartyType: 'platform', creditPartyId: noonId, creditPartyName: 'نون', paidAmount: 0, ...extra });

    // ==================== الترقيم ====================
    assert((await call('GET', '/api/settings/invoice-numbering')).status === 401, 'بدون دخول مرفوض');
    assert((await call('GET', '/api/settings/invoice-numbering', undefined, manager)).status === 403, 'بدون صلاحية ترقيم الفواتير مرفوض');
    let view = await call('GET', '/api/settings/invoice-numbering', undefined, owner);
    assert(view.status === 200 && view.data.settings.prefix === 'INV-' && view.data.nextNumber === `INV-${today}-0001` && view.data.mayRepeat === false, `الافتراضي والرقم الجاي: ${view.data?.nextNumber}`);

    const a = await sell(manager);
    const b = await sell(manager);
    assert(a.status === 200 && a.data.invoice.invoiceNumber === `INV-${today}-0001`, `أول فاتورة 0001: ${a.data?.invoice?.invoiceNumber || a.data?.error}`);
    assert(b.data.invoice.invoiceNumber === `INV-${today}-0002`, 'التانية 0002');
    // فاتورة مرفوضة لا تستهلك رقمًا
    const refused = await sell(manager, { lines: [{ itemId: 'nope', quantity: 1 }] });
    assert(refused.status >= 400, 'فاتورة غلط تُرفض');
    const c = await sell(manager);
    assert(c.data.invoice.invoiceNumber === `INV-${today}-0003`, 'الرفض ما عملش فجوة: 0003');
    // إعادة إرسال نفس الطلب (نفس مفتاح منع التكرار) ترجع نفس الرقم
    const key = `num-same-${Date.now()}`;
    const r1 = await call('POST', '/api/invoices', { idempotencyKey: key, platform: 'البيع المباشر', paymentType: 'نقدي', lines: [{ itemId, quantity: 1 }] }, manager);
    const r2 = await call('POST', '/api/invoices', { idempotencyKey: key, platform: 'البيع المباشر', paymentType: 'نقدي', lines: [{ itemId, quantity: 1 }] }, manager);
    assert(r1.data.invoice.invoiceNumber === `INV-${today}-0004` && (r2.data.invoice?.invoiceNumber || r2.data.finalInvoiceNumber) === r1.data.invoice.invoiceNumber, 'إعادة الإرسال لا تأخذ رقمًا جديدًا');
    // فاتورة أوفلاين تاخد الرقم المتسلسل عند المزامنة
    const off = await sell(manager, { isOfflineSync: true, invoiceNumber: 'OFF-DEV1-20261120-1' });
    assert(off.status === 200 && off.data.invoice.invoiceNumber === `INV-${today}-0005` && off.data.invoice.offlineProvisionalNo === 'OFF-DEV1-20261120-1', 'الأوفلاين: الرقم النهائي متسلسل والمؤقت محفوظ');

    // ---- تغيير الشكل ----
    let bad = await call('POST', '/api/settings/invoice-numbering', { prefix: 'IN V' }, owner);
    assert(bad.status === 400 && arabic.test(bad.data.error), 'شكل غلط يُرفض برسالة عربية');
    assert((await call('POST', '/api/settings/invoice-numbering', { prefix: 'F' }, manager)).status === 403, 'المدير بدون الصلاحية ما يعدّلش');
    let saved = await call('POST', '/api/settings/invoice-numbering', { prefix: 'ON-', datePart: 'none', digits: 5, suffix: '-M', resetPeriod: 'never', startAt: 100 }, owner);
    assert(saved.status === 200 && saved.data.settings.prefix === 'ON-' && saved.data.nextNumber === 'ON-00006-M', `حفظ الشكل والعد يكمل: ${saved.data?.nextNumber || saved.data?.error}`);
    assert(db('auditLogs').some(r => String(docOf(r).action) === 'INVOICE_NUMBERING_UPDATED'), 'تعديل الترقيم في سجل التدقيق');
    const d1 = await sell(manager);
    assert(d1.data.invoice.invoiceNumber === 'ON-00006-M', 'الفاتورة بالشكل الجديد');
    // تصفير يدوي
    let reset = await call('POST', '/api/settings/invoice-numbering/reset-counter', {}, owner);
    assert(reset.status === 200 && reset.data.nextNumber === 'ON-00100-M' && reset.data.counter.resetBy === 'صاحب المحل', 'تصفير العد: يبدأ من رقم البداية');
    assert(db('auditLogs').some(r => String(docOf(r).action) === 'INVOICE_NUMBERING_RESET'), 'التصفير في سجل التدقيق');
    assert((await sell(manager)).data.invoice.invoiceNumber === 'ON-00100-M', 'بعد التصفير');
    reset = await call('POST', '/api/settings/invoice-numbering/reset-counter', { startAt: 6 }, owner);
    assert(reset.data.nextNumber === 'ON-00007-M', 'تصفير لرقم مستخدم: يتعدّى المستخدم');
    assert((await call('POST', '/api/settings/invoice-numbering/reset-counter', { startAt: 0 }, owner)).status === 400, 'رقم بداية غلط يُرفض');
    saved = await call('POST', '/api/settings/invoice-numbering', { resetPeriod: 'daily' }, owner);
    assert(saved.data.mayRepeat === true && arabic.test(saved.data.mayRepeatNote), 'بدون تاريخ + تصفير يومي: تنبيه');
    const numbers = invoiceDocs().map(i => i.invoiceNumber);
    assert(new Set(numbers).size === numbers.length, 'مفيش رقم فاتورة متكرر');

    // ==================== رقم طلب المنصة ====================
    const p1 = await noonSale(manager, { platformOrderId: '  NOON-5001  ' });
    assert(p1.status === 200 && p1.data.invoice.platformOrderId === 'NOON-5001', `رقم طلب المنصة يتحفظ: ${p1.data?.error || ''}`);
    let dup = await noonSale(manager, { platformOrderId: 'noon-5001' });
    assert(dup.status >= 400 && dup.status < 500 && dup.data.code === 'PLATFORM_ORDER_DUPLICATE' && dup.data.error.includes(p1.data.invoice.invoiceNumber), 'التكرار على نفس المنصة ممنوع (الافتراضي) والرسالة فيها رقم الفاتورة');
    const otherPlatform = await sell(manager, { platform: 'جوميا', platformId: jumiaId, platformName: 'جوميا', platformOrderId: 'NOON-5001' });
    assert(otherPlatform.status === 200, 'نفس الرقم على منصة تانية مسموح');
    const directWithOrder = await sell(manager, { platformOrderId: 'X-1' });
    assert(directWithOrder.status === 200 && !directWithOrder.data.invoice.platformOrderId, 'البيع المباشر: رقم الطلب يتجاهل');
    assert((await noonSale(manager)).status === 200, 'رقم الطلب اختياري');
    assert((await noonSale(manager, { platformOrderId: 'x'.repeat(61) })).status === 400, 'رقم طلب طويل يُرفض');
    const offDup = await noonSale(manager, { platformOrderId: 'NOON-5001', isOfflineSync: true, invoiceNumber: 'OFF-DEV1-20261120-2' });
    assert(offDup.status === 200 && (offDup.data.reviewReasons || []).includes('رقم طلب المنصة مكرر'), 'الأوفلاين المكرر يُقبل ويُعلَّم للمراجعة');
    saved = await call('POST', '/api/settings/invoice-numbering', { platformOrderDuplicates: 'allow' }, owner);
    assert(saved.data.settings.platformOrderDuplicates === 'allow', 'السماح بالتكرار');
    assert((await noonSale(manager, { platformOrderId: 'NOON-5001' })).status === 200, 'بعد السماح: التكرار مقبول');
    await call('POST', '/api/settings/invoice-numbering', { platformOrderDuplicates: 'block' }, owner);

    // تعديل رقم الطلب بعد الحفظ
    const target = (await noonSale(manager, { platformOrderId: 'NOON-WRONG' })).data.invoice.invoiceNumber as string;
    assert((await call('PUT', `/api/invoices/${encodeURIComponent(target)}/platform-order`, { platformOrderId: 'NOON-6001', reason: 'رقم غلط' }, manager)).status === 403, 'التعديل يحتاج صلاحية تعديل الفواتير بعد الحفظ');
    assert((await call('PUT', `/api/invoices/${encodeURIComponent(target)}/platform-order`, { platformOrderId: 'NOON-6001' }, owner)).status === 400, 'السبب إلزامي');
    const dupEdit = await call('PUT', `/api/invoices/${encodeURIComponent(target)}/platform-order`, { platformOrderId: 'NOON-5001', reason: 'تصحيح' }, owner);
    assert(dupEdit.status === 409 && dupEdit.data.code === 'PLATFORM_ORDER_DUPLICATE', 'التعديل لرقم مكرر يُرفض');
    const edited = await call('PUT', `/api/invoices/${encodeURIComponent(target)}/platform-order`, { platformOrderId: 'NOON-6001', reason: 'الرقم اتكتب غلط' }, owner);
    assert(edited.status === 200 && edited.data.invoice.platformOrderId === 'NOON-6001', 'تعديل رقم الطلب');
    assert(invoiceDocs().find(i => i.invoiceNumber === target)?.platformOrderId === 'NOON-6001', 'التعديل محفوظ في قاعدة البيانات');
    assert(db('auditLogs').some(r => String(docOf(r).action) === 'INVOICE_PLATFORM_ORDER_EDIT' && String(docOf(r).details || docOf(r).description || JSON.stringify(docOf(r))).includes('NOON-WRONG')), 'التعديل في سجل التدقيق بالقيمة القديمة');
    const directNo = directWithOrder.data.invoice.invoiceNumber as string;
    assert((await call('PUT', `/api/invoices/${encodeURIComponent(directNo)}/platform-order`, { platformOrderId: 'X', reason: 'x' }, owner)).status === 400, 'فاتورة بيع مباشر: لا رقم طلب منصة');
    assert((await call('PUT', '/api/invoices/NOPE/platform-order', { platformOrderId: 'X', reason: 'x' }, owner)).status === 404, 'فاتورة غير موجودة');

    // ==================== بيع المنصات دايمًا آجل ====================
    let rules = await call('GET', '/api/settings/sales-rules', undefined, manager);
    assert(rules.data.rules.platformAlwaysCredit === false, 'الافتراضي: مقفول');
    assert((await noonSale(manager)).status === 200, 'مقفول: بيع منصة نقدي مسموح');
    rules = await call('POST', '/api/settings/sales-rules', { platformAlwaysCredit: true }, owner);
    assert(rules.status === 200 && rules.data.rules.platformAlwaysCredit === true, 'تشغيل المفتاح');
    assert(db('auditLogs').some(r => /دايمًا آجل على المنصة/.test(JSON.stringify(docOf(r)))), 'تشغيل المفتاح في سجل التدقيق');
    const beforeCount = invoiceDocs().length;
    const cash = await noonSale(manager);
    assert(cash.status >= 400 && cash.status < 500 && cash.data.code === 'PLATFORM_CREDIT_ONLY' && arabic.test(cash.data.error), 'بيع منصة نقدي يُرفض');
    assert((await noonSale(owner)).status >= 400, 'القاعدة على الكل حتى المالك');
    const onCustomer = await noonSale(manager, { paymentType: 'آجل', creditPartyType: 'customer', customerId, paidAmount: 0 });
    assert(onCustomer.status >= 400 && onCustomer.data.code === 'PLATFORM_CREDIT_ONLY', 'بيع منصة آجل على عميل يُرفض');
    assert(invoiceDocs().length === beforeCount, 'المرفوض ما اتحفظش');
    const credit = await noonCredit(manager, { customerId, customerName: 'محمد علي' });
    assert(credit.status === 200 && credit.data.invoice.paymentType === 'آجل' && credit.data.invoice.creditPartyType === 'platform' && credit.data.invoice.customerName === 'محمد علي', `آجل على المنصة مقبول، والعميل اسم في الفاتورة: ${credit.data?.error || ''}`);
    assert((await sell(manager)).status === 200, 'البيع المباشر النقدي لا يتأثر');
    const offCash = await noonSale(manager, { isOfflineSync: true, invoiceNumber: 'OFF-DEV1-20261120-3' });
    assert(offCash.status === 200 && (offCash.data.reviewReasons || []).includes('بيع منصة بغير الآجل على المنصة'), 'أوفلاين: يُقبل ويُعلَّم للمراجعة');
    // التحصيل زي ما هو
    const cashboxes = (await call('GET', '/api/cashboxes', undefined, owner)).data?.cashboxes || [];
    assert(cashboxes.length > 0, 'خزنة للتحصيل');
    const collect = await call('POST', '/api/invoices/collect-credit', { invoiceNumbers: [credit.data.invoice.invoiceNumber], receivedAmount: credit.data.invoice.netAmount, partyType: 'platform', partyId: noonId, cashboxId: cashboxes[0].id, idempotencyKey: `col-${Date.now()}` }, owner);
    assert(collect.status === 200 && collect.data.success === true, `التحصيل يشتغل كالمعتاد: تختار الفاتورة وتكتب المستلم (${collect.data?.error || ''})`);
    assert(invoiceDocs().find(i => i.invoiceNumber === credit.data.invoice.invoiceNumber)?.creditStatus === 'مسددة', 'الفاتورة اتسددت');

    // ==================== الحفظ وإعادة التشغيل والنسخة الاحتياطية وإعادة الضبط ====================
    const nextBefore = (await call('GET', '/api/settings/invoice-numbering', undefined, owner)).data.nextNumber;
    assert(docOf(db('settings.invoiceNumbering')[0])?.settings?.prefix === 'ON-', 'الإعدادات محفوظة في قاعدة البيانات');
    await engine.lock.run(async () => {
      assert(await engine.recover(), 'تحميل الحالة بعد إعادة التشغيل');
    });
    const afterRestart = await call('GET', '/api/settings/invoice-numbering', undefined, owner);
    assert(afterRestart.data.nextNumber === nextBefore && afterRestart.data.settings.suffix === '-M', 'بعد إعادة التشغيل: نفس الشكل ونفس العد');
    assert((await call('GET', '/api/settings/sales-rules', undefined, owner)).data.rules.platformAlwaysCredit === true, 'بعد إعادة التشغيل: آجل المنصة مفتوح');
    const exported = await call('GET', '/api/backup/export', undefined, owner);
    assert((readBackup(exported.buffer).data['settings.invoiceNumbering'] as any)?.settings?.prefix === 'ON-', 'ملف النسخة الاحتياطية فيه الترقيم');

    owner = (await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD })).data.token;
    const status = await call('GET', '/api/system/reset-status', undefined, owner);
    const ops = await call('POST', '/api/system/reset-operations', { password: ADMIN_PASSWORD, confirmText: status.data.phrases.operations }, owner);
    assert(ops.status === 200, `إعادة ضبط العمليات: ${ops.data?.error || ''}`);
    owner = (await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD })).data.token;
    const afterOps = await call('GET', '/api/settings/invoice-numbering', undefined, owner);
    assert(afterOps.data.settings.prefix === 'ON-' && afterOps.data.nextNumber === 'ON-00100-M', `إعادة ضبط العمليات: العد من البداية والشكل يفضل (${afterOps.data.nextNumber})`);
    const factory = await call('POST', '/api/system/factory-reset', { password: ADMIN_PASSWORD, confirmText: status.data.phrases.factory }, owner);
    assert(factory.status === 200, `إعادة ضبط المصنع: ${factory.data?.error || ''}`);
    const afterFactory = docOf(db('settings.invoiceNumbering')[0]);
    assert(afterFactory.settings.prefix === 'INV-' && afterFactory.state.last === 0, 'إعادة ضبط المصنع: الترقيم الافتراضي');
    assert((docOf(db('settings.salesRules')[0]) as any).platformAlwaysCredit === false, 'إعادة ضبط المصنع: آجل المنصة مقفول');

    console.log(`\n🎉 كل اختبارات ربط ترقيم الفواتير وآجل المنصة نجحت (${passed} تحققًا).`);
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

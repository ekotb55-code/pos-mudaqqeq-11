/**
 * اختبار مسار استقبال رسائل الهاتف: أسماء الحقول المقبولة من تطبيقات التحويل، وعدم ضياع أي رسالة في صمت
 * (بدون إنترنت — ناقل وهمي)
 * التشغيل:  npx tsx scripts/verify_bank_intake_fields.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import { createFakeTransport } from '../server/persistence/statePersistence.ts';

const TENANT = 'test_intakefields';
const ADMIN_PASSWORD = 'Intake#Admin2026';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

async function main() {
  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { app, persistence } = await createServerApp({ attachVite: false, persistenceTransport: fake.transport, persistenceTenant: TENANT });
  assert(persistence && persistence.isReady(), 'طبقة الحفظ جاهزة');
  const engine = persistence!;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, url: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
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
  const db = (collection: string) => fake.dump(TENANT).rows.filter(r => r.collection === collection);
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();
  const arabic = /[\u0600-\u06FF]/;

  try {
    const login = await call('POST', '/api/auth/login', { username: 'admin', password: process.env.INITIAL_USER_PASSWORD || '1234' });
    const admin = login.data.token as string;
    assert((await call('POST', '/api/auth/complete-initial-setup', { name: 'صاحب المحل', username: 'admin', newPassword: ADMIN_PASSWORD }, admin)).status === 200, 'إعداد المالك');
    const cashboxes = await call('GET', '/api/cashboxes', undefined, admin);
    const cashbox = (cashboxes.data.cashboxes || cashboxes.data.data || cashboxes.data)[0];
    assert(cashbox?.id, 'الخزينة الرئيسية موجودة');
    const created = await call('POST', '/api/bank-link/accounts', { name: 'محفظة المحل', cashboxId: cashbox.id, senders: ['VF-Cash', 'com.wallet.app'] }, admin);
    assert(created.status === 200, `إنشاء حساب مربوط: ${created.data?.error || ''}`);
    const key = (await call('GET', '/api/bank-link/overview', undefined, admin)).data.intakeKey as string;
    assert(key, 'مفتاح الاستقبال');
    const balance = () => (db('cashboxes').find(r => (r.data as any).v.id === cashbox.id)!.data as any).v.currentBalance;
    const text = (amount: number, total: number) => `تم استلام مبلغ ${amount} جنيه من 01012345678 رصيدك الحالي ${total} جنيه`;

    // 1) الأسماء الأساسية + المفتاح في الترويسة
    let r = await call('POST', '/api/bank-link/intake', { sender: 'VF-Cash', text: text(1000, 3000), at: minutesAgo(50) }, undefined, { 'x-intake-key': key });
    assert(r.status === 200 && r.data.status === 'recorded' && balance() === 3000, 'sender / text / at');

    // 2) from / content / timestamp رقمي + المفتاح في الرابط
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { from: 'VF-Cash', content: text(200, 3200), timestamp: Date.now() - 45 * 60000 });
    assert(r.status === 200 && r.data.status === 'recorded' && balance() === 3200, 'from / content / timestamp');

    // 3) address / msg / time
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { address: 'VF-Cash', msg: text(50, 3250), time: minutesAgo(40) });
    assert(r.status === 200 && r.data.status === 'recorded' && balance() === 3250, 'address / msg / time');

    // 4) message / body / sms
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { sender: 'VF-Cash', message: text(10, 3260), date: minutesAgo(35) });
    assert(r.data.status === 'recorded' && balance() === 3260, 'message / date');
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { sender: 'VF-Cash', body: text(10, 3270), receivedAt: minutesAgo(30) });
    assert(r.data.status === 'recorded' && balance() === 3270, 'body / receivedAt');
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { sender: 'VF-Cash', sms: text(10, 3280), at: minutesAgo(25) });
    assert(r.data.status === 'recorded' && balance() === 3280, 'sms');

    // 5) كل البيانات في الرابط بدون جسم (تطبيقات ترسل الطلب كرابط فقط)
    const query = new URLSearchParams({ key, sender: 'VF-Cash', text: text(20, 3300), at: minutesAgo(20) }).toString();
    r = await call('POST', `/api/bank-link/intake?${query}`);
    assert(r.status === 200 && r.data.status === 'recorded' && balance() === 3300, 'البيانات في الرابط بدون جسم');

    // 6) جسم الطلب له الأولوية على الرابط
    r = await call('POST', `/api/bank-link/intake?key=${key}&text=${encodeURIComponent('نص من الرابط')}`, { sender: 'VF-Cash', text: text(100, 3400), at: minutesAgo(15) });
    assert(r.data.status === 'recorded' && balance() === 3400, 'جسم الطلب له الأولوية على الرابط');

    // 7) إشعار تطبيق: اسم الحزمة هو المرسل حتى لو يوجد عنوان متغير للإشعار
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { package: 'com.wallet.app', title: 'تحويل جديد من أحمد', text: text(100, 3500), at: minutesAgo(10) });
    assert(r.data.status === 'recorded' && balance() === 3500, 'package له الأولوية على title');
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { packageName: 'com.wallet.app', content: text(100, 3600), at: minutesAgo(8) });
    assert(r.data.status === 'recorded' && balance() === 3600, 'packageName / content');

    // 8) لا ضياع صامت: رسالة بلا مرسل أو بلا نص تُرفض برسالة عربية واضحة ولا تُسجَّل
    const stored = db('bank.messages').length;
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { sender: 'VF-Cash', unknownField: text(1, 1) });
    assert(r.status === 400 && r.data.success === false && r.data.status === 'empty' && arabic.test(r.data.error) && /sender/.test(r.data.error) && /text/.test(r.data.error), 'رسالة بلا نص: رفض واضح يذكر أسماء الحقول');
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { text: text(1, 1) });
    assert(r.status === 400 && r.data.status === 'empty', 'رسالة بلا مرسل: رفض واضح');
    r = await call('POST', `/api/bank-link/intake?key=${key}`);
    assert(r.status === 400 && r.data.status === 'empty', 'طلب فارغ: رفض واضح');
    assert(db('bank.messages').length === stored && balance() === 3600, 'الرسائل المرفوضة لم تُسجَّل ولم تغيّر الخزنة');

    // 9) المفتاح
    assert((await call('POST', '/api/bank-link/intake', { sender: 'VF-Cash', text: text(5, 5) })).status === 401, 'بدون مفتاح مرفوض');
    assert((await call('POST', '/api/bank-link/intake?key=wrong', { sender: 'VF-Cash', text: text(5, 5) })).status === 401, 'مفتاح خاطئ مرفوض');

    // 10) المرسل غير المربوط والرسالة المكررة يردّان بنجاح (ليسا خطأ إعداد)
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { from: 'ماما', content: 'هات عيش' });
    assert(r.status === 200 && r.data.status === 'unknown_sender' && !JSON.stringify(fake.dump(TENANT)).includes('هات عيش'), 'مرسل غير مربوط: نجاح بدون حفظ النص');
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { packageName: 'com.wallet.app', content: text(100, 3600), at: minutesAgo(8) });
    assert(r.status === 200 && (r.data.status === 'duplicate' || r.data.status === 'recorded') && balance() === 3600, 'إعادة إرسال نفس الرسالة لا تغيّر الرصيد');

    // 11) حالة الهاتف: الأسماء البديلة من الجسم ومن الرابط
    r = await call('POST', `/api/bank-link/intake?key=${key}`, { sender: 'VF-Cash', text: text(100, 3700), at: minutesAgo(5), deviceName: 'phone-A', batteryLevel: 81 });
    assert(r.data.status === 'recorded' && balance() === 3700, 'رسالة مع deviceName / batteryLevel');
    assert((await call('POST', `/api/bank-link/heartbeat?key=${key}&device=phone-B&battery=64`)).status === 200, 'نبضة من الرابط');
    assert((await call('POST', `/api/bank-link/heartbeat?key=${key}`, { deviceName: 'phone-C', batteryLevel: 33 })).status === 200, 'نبضة بأسماء بديلة');
    const devices = (await call('GET', '/api/bank-link/overview', undefined, admin)).data.devices as any[];
    const battery = (id: string) => devices.find(d => d.id === id)?.battery;
    assert(battery('phone-A') === 81 && battery('phone-B') === 64 && battery('phone-C') === 33, 'حالة الهواتف الثلاثة والبطارية');

    // 12) النتيجة النهائية
    const account = (await call('GET', '/api/bank-link/overview', undefined, admin)).data.accounts[0];
    assert(account.bankBalance === 3700 && account.bookBalance === 3700 && account.gaps.length === 0, 'رصيد البنك = رصيد الخزنة بلا فروق');

    console.log(`\n🎉 كل اختبارات حقول استقبال رسائل الهاتف نجحت (${passed} تحققًا).`);
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

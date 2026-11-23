/**
 * اختبار أمان تعديل الخزنة (بدون إنترنت — ناقل وهمي)
 * التشغيل:  npx tsx scripts/verify_cashbox_edit_safety.ts
 *
 * المشكلة اللي بيحرسها: تعديل الخزنة كان بيدمج كل اللي جاي في الطلب فوق الخزنة،
 * فأي حد معاه cashbox.create يقدر يكتب الرصيد الحالي مباشرة من غير حركة ولا سجل تدقيق.
 * القاعدة: الرصيد الحالي بيتغير بحركات بس. وتعديل الرصيد الافتتاحي (موجود في شاشة الخزن)
 * بيتسجل بحركة ظاهرة بالفرق + سطر في سجل التدقيق.
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import { createFakeTransport } from '../server/persistence/statePersistence.ts';

const TENANT = 'test_cashbox_edit';
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '1234';

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
  const db = (collection: string) => fake.dump(TENANT).rows.filter(r => r.collection === collection).map(r => (r.data as any)?.v ?? r.data);
  const box = (id: string) => db('cashboxes').find((c: any) => c.id === id);
  const txOf = (id: string) => db('cashboxTransactions').filter((t: any) => t.cashboxId === id);
  const near = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.005;
  const sumTx = (id: string) => Math.round(txOf(id).reduce((s: number, t: any) => s + Number(t.amount || 0), 0) * 100) / 100;
  const arabic = /[\u0600-\u06FF]/;

  try {
    const login = async (username: string, password: string) => {
      const res = await call('POST', '/api/auth/login', { username, password });
      assert(res.status === 200 && res.data?.token, `دخول ${username}: ${res.data?.error || ''}`);
      return res.data.token as string;
    };
    let owner = await login('admin', INITIAL_PASSWORD);
    assert((await call('POST', '/api/auth/complete-initial-setup', { name: 'صاحب المحل', username: 'admin', newPassword: 'Box#Owner2026' }, owner)).status === 200, 'إعداد حساب المالك');
    owner = await login('admin', 'Box#Owner2026');
    let manager = await login('manager', INITIAL_PASSWORD);
    assert((await call('POST', '/api/auth/complete-initial-setup', { name: 'مدير الفرع', username: 'manager', newPassword: 'Box#Manager2026' }, manager)).status === 200, 'إعداد حساب المدير');
    manager = await login('manager', 'Box#Manager2026');

    // خزنة جديدة برصيد افتتاحي 500
    const created = await call('POST', '/api/cashboxes', { name: 'درج 2', currency: 'EGP', openingBalance: 500 }, owner);
    assert(created.status === 200 && created.data?.cashbox?.id, `إنشاء خزنة: ${created.data?.error || ''}`);
    const id = created.data.cashbox.id as string;
    assert(near(box(id)?.currentBalance, 500) && txOf(id).length === 1 && near(sumTx(id), 500), 'الإنشاء: رصيد 500 وحركة افتتاحية واحدة');

    // 1) طلب فيه currentBalance: الرصيد ما يتغيرش، والاسم بيتغير
    const auditBefore = db('auditLogs').length;
    const forged = await call('POST', '/api/cashboxes', { id, name: 'درج الكاشير 2', currentBalance: 999999 }, owner);
    assert(forged.status === 200 && forged.data?.success, `تعديل الاسم: ${forged.data?.error || ''}`);
    assert(box(id)?.name === 'درج الكاشير 2', 'الاسم اتغير');
    assert(near(box(id)?.currentBalance, 500), `الرصيد الحالي ما يتاخدش من الطلب (الرصيد: ${box(id)?.currentBalance})`);
    assert(txOf(id).length === 1, 'تعديل الاسم ما عملش حركات');
    assert(db('auditLogs').length > auditBefore, 'تعديل الخزنة اتسجل في سجل التدقيق');
    const forgedByManager = await call('POST', '/api/cashboxes', { id, name: 'درج الكاشير 2', currentBalance: 1, createdAt: '2000-01-01T00:00:00.000Z' }, manager);
    assert(forgedByManager.status === 200 && near(box(id)?.currentBalance, 500), 'المدير برضه ما يقدرش يكتب الرصيد');
    assert(box(id)?.createdAt !== '2000-01-01T00:00:00.000Z', 'تاريخ الإنشاء ما يتاخدش من الطلب');

    // 2) تعديل الرصيد الافتتاحي من 500 لـ 600: حركة ظاهرة +100، والرصيد 600
    const up = await call('POST', '/api/cashboxes', { id, name: 'درج الكاشير 2', openingBalance: 600 }, owner);
    assert(up.status === 200 && up.data?.success, `تعديل الرصيد الافتتاحي: ${up.data?.error || ''}`);
    assert(near(box(id)?.openingBalance, 600) && near(box(id)?.currentBalance, 600), `بعد التعديل: الافتتاحي 600 والحالي 600 (الحالي: ${box(id)?.currentBalance})`);
    const upTx = txOf(id).find((t: any) => near(t.amount, 100));
    assert(upTx && upTx.type === 'إيداع' && arabic.test(upTx.statement) && near(upTx.balanceAfter, 600), 'حركة «إيداع» بالفرق +100 ظاهرة في حركات الخزنة');
    const upAudit = db('auditLogs').find((a: any) => a.targetId === id && /500/.test(a.details) && /600/.test(a.details));
    assert(upAudit && upAudit.actorName === 'صاحب المحل', 'سطر في سجل التدقيق فيه القيمة القديمة والجديدة واسم اللي عدّل');

    // 3) تعديل بالنقص من 600 لـ 450: حركة «سحب» -150
    const down = await call('POST', '/api/cashboxes', { id, name: 'درج الكاشير 2', openingBalance: 450 }, owner);
    assert(down.status === 200 && near(box(id)?.currentBalance, 450), 'بعد النقص: الرصيد 450');
    const downTx = txOf(id).find((t: any) => near(t.amount, -150));
    assert(downTx && downTx.type === 'سحب', 'حركة «سحب» بالفرق -150');

    // 4) نفس التعديل مرتين (ضغطة مرتين): ما يعملش حركة تانية
    const txCount = txOf(id).length;
    await call('POST', '/api/cashboxes', { id, name: 'درج الكاشير 2', openingBalance: 450 }, owner);
    assert(txOf(id).length === txCount && near(box(id)?.currentBalance, 450), 'تكرار نفس القيمة ما يعملش حركة');

    // 5) التطابق: مجموع الحركات = الرصيد
    assert(near(sumTx(id), Number(box(id)?.currentBalance)), `مجموع حركات الخزنة (${sumTx(id)}) = رصيدها (${box(id)?.currentBalance})`);

    // 6) رصيد افتتاحي مش رقم: يترفض برسالة عربية ومن غير أي تغيير
    const bad = await call('POST', '/api/cashboxes', { id, name: 'درج الكاشير 2', openingBalance: 'abc' }, owner);
    assert(bad.data?.success === false && arabic.test(bad.data?.error || ''), 'رصيد افتتاحي مش رقم يترفض برسالة عربية');
    assert(near(box(id)?.currentBalance, 450) && txOf(id).length === txCount, 'الرفض ما غيّرش حاجة');

    console.log(`✅ اختبار أمان تعديل الخزنة: ${passed} تحقق نجح`);
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

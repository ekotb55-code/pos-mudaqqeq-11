/**
 * اختبار ربط «إدخال الرصيد يدويًا» بالسيرفر عبر الـ API (بدون إنترنت — ناقل وهمي)
 * التشغيل:  npx tsx scripts/verify_manual_balance_wiring.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import { createFakeTransport } from '../server/persistence/statePersistence.ts';

const TENANT = 'test_manualbalance';
const ADMIN_PASSWORD = 'Manual#Admin2026';
const INITIAL_PASSWORD = process.env.INITIAL_USER_PASSWORD || '1234';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

async function main() {
  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { app, persistence, manualBalances } = await createServerApp({ attachVite: false, persistenceTransport: fake.transport, persistenceTenant: TENANT });
  assert(persistence && persistence.isReady() && manualBalances, 'طبقة الحفظ جاهزة');
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
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  };
  const db = (collection: string) => fake.dump(TENANT).rows.filter(r => r.collection === collection);
  const dbCashbox = (id: string) => (db('cashboxes').find(r => (r.data as any).v.id === id)!.data as any).v;
  // مسار كتابة غير موجود: يكشف هل وسيط الإجبار يوقف الطلب (423) أم يتركه يمر (404)
  const probe = async (token: string) => (await call('POST', '/api/gate-probe', {}, token)).status;
  const arabic = /[\u0600-\u06FF]/;

  try {
    const loginAs = async (username: string, name: string, newPassword: string) => {
      const login = await call('POST', '/api/auth/login', { username, password: INITIAL_PASSWORD });
      const token = login.data.token as string;
      const setup = await call('POST', '/api/auth/complete-initial-setup', { name, username, newPassword }, token);
      assert(setup.status === 200, `إعداد حساب ${username}: ${setup.data?.error || ''}`);
      return { token };
    };
    const owner = await loginAs('admin', 'صاحب المحل', ADMIN_PASSWORD);
    const manager = await loginAs('manager', 'مدير الحساب', 'Manual#Manager2026');
    const cashier = await loginAs('cashier', 'أحمد كاشير', 'Manual#Cashier2026');

    const cashboxes = await call('GET', '/api/cashboxes', undefined, owner.token);
    const cashbox = (cashboxes.data.cashboxes || cashboxes.data.data || cashboxes.data)[0];
    assert(cashbox?.id, 'الخزينة الرئيسية موجودة');
    const startBalance = Number(cashbox.currentBalance) || 0;

    // ---- الإعدادات: صلاحية ربط الخزن ----
    assert((await call('GET', '/api/bank-link/manual/overview')).status === 401, 'العرض بدون دخول مرفوض');
    assert((await call('GET', '/api/bank-link/manual/overview', undefined, cashier.token)).status === 403, 'الكاشير لا يرى إعدادات المتابعة اليدوية');
    let overview = await call('GET', '/api/bank-link/manual/overview', undefined, owner.token);
    assert(overview.status === 200 && overview.data.accounts.length === 0 && overview.data.postponeMinutes === 60, 'عرض فارغ في البداية');
    const managerUser = overview.data.users.find((u: any) => u.username === 'manager');
    assert(managerUser?.id && overview.data.users.some((u: any) => u.username === 'cashier'), 'قائمة المستخدمين لاختيار المسؤول');

    const definition = { name: 'حساب البنك', cashboxId: cashbox.id, responsibleUserIds: [managerUser.id], scheduleType: 'daily', time: '22:00', weekdays: [], mandatory: true };
    const bad = await call('POST', '/api/bank-link/manual/accounts', { ...definition, responsibleUserIds: [] }, owner.token);
    assert(bad.status === 400 && arabic.test(bad.data.error), 'بدون مسؤول يُرفض برسالة عربية');
    assert((await call('POST', '/api/bank-link/manual/accounts', definition, cashier.token)).status === 403, 'الكاشير لا ينشئ متابعة');
    const created = await call('POST', '/api/bank-link/manual/accounts', definition, owner.token);
    assert(created.status === 200 && created.data.account.enabled === true && created.data.account.mandatory === true, `إنشاء متابعة يدوية: ${created.data?.error || ''}`);
    const accountId = created.data.account.id as string;
    assert(db('bank.manualAccounts').length === 1, 'التعريف محفوظ في قاعدة البيانات');

    // خزنة واحدة = طريقة واحدة
    const byMessages = await call('POST', '/api/bank-link/accounts', { name: 'بنك بالرسائل', cashboxId: cashbox.id, senders: ['BANK'] }, owner.token);
    assert(byMessages.status === 400 && /رصيد يدوي/.test(byMessages.data.error), 'الخزنة المتابَعة يدويًا لا تُربط بالرسائل');

    // ---- الطلب يظهر للمسؤول فقط ----
    assert((await call('GET', '/api/bank-link/balance-requests')).status === 401, 'طلبات الرصيد بدون دخول مرفوضة');
    let mine = await call('GET', '/api/bank-link/balance-requests', undefined, manager.token);
    assert(mine.status === 200 && mine.data.requests.length === 1 && mine.data.requests[0].kind === 'baseline' && mine.data.requests[0].blocking === true && mine.data.requests[0].canPostpone === true, 'المسؤول يُطلب منه الرصيد عند بدء المتابعة');
    assert(mine.data.alerts.length === 0, 'المسؤول بلا صلاحية الإدارة لا يرى تنبيهات');
    assert((await call('GET', '/api/bank-link/balance-requests', undefined, cashier.token)).data.requests.length === 0, 'الكاشير لا يُطلب منه شيء');
    assert((await call('GET', '/api/bank-link/balance-requests', undefined, owner.token)).data.requests.length === 0, 'المالك غير المسؤول لا يُطلب منه شيء');

    // ---- الإجبار: المسؤول لا يكمل أي عملية كتابة، والكاشير يكمل ----
    const blocked = await call('POST', '/api/gate-probe', {}, manager.token);
    assert(blocked.status === 423 && blocked.data.code === 'BALANCE_REQUIRED' && blocked.data.accountId === accountId && arabic.test(blocked.data.error), 'المسؤول موقوف برسالة عربية حتى يكتب الرصيد');
    assert((await probe(cashier.token)) !== 423 && (await probe(owner.token)) !== 423, 'الكاشير والمالك لا يتأثران');
    assert((await call('GET', '/api/auth/me', undefined, manager.token)).status === 200, 'القراءة مسموحة للمسؤول الموقوف');
    assert((await call('POST', '/api/offline/sync', { operations: [] }, manager.token)).status !== 423, 'رفع عمليات الأوفلاين المسجلة مسبقًا لا يتوقف');

    // ---- التأجيل مرة واحدة ----
    assert((await call('POST', `/api/bank-link/balance-requests/${accountId}/postpone`, {}, cashier.token)).status === 403, 'الكاشير لا يؤجل');
    const postponed = await call('POST', `/api/bank-link/balance-requests/${accountId}/postpone`, {}, manager.token);
    assert(postponed.status === 200 && postponed.data.request.state === 'postponed' && postponed.data.request.canPostpone === false && postponed.data.requests[0].blocking === false, 'التأجيل ساعة');
    assert((await probe(manager.token)) !== 423, 'أثناء التأجيل المسؤول يكمل عمله');
    const secondPostpone = await call('POST', `/api/bank-link/balance-requests/${accountId}/postpone`, {}, manager.token);
    assert(secondPostpone.status === 400 && arabic.test(secondPostpone.data.error), 'التأجيل مرة ثانية مرفوض');
    assert((db('bank.manualAccounts')[0].data as any).v.postponedUntil, 'التأجيل محفوظ في قاعدة البيانات');

    // انتهت الساعة
    const realNow = () => new Date();
    (manualBalances as any).now = () => new Date(Date.now() + 61 * 60000);
    assert((await probe(manager.token)) === 423, 'بعد ساعة التأجيل يعود الإيقاف');
    mine = await call('GET', '/api/bank-link/balance-requests', undefined, manager.token);
    assert(mine.data.requests[0].state === 'due' && mine.data.requests[0].canPostpone === false, 'بعد الساعة لا تأجيل ثانٍ');
    (manualBalances as any).now = realNow;

    // ---- إدخال الرصيد ----
    assert((await call('POST', `/api/bank-link/balance-requests/${accountId}/submit`, { balance: 5000 }, cashier.token)).status === 403, 'الكاشير لا يكتب الرصيد');
    const invalid = await call('POST', `/api/bank-link/balance-requests/${accountId}/submit`, { balance: 'abc' }, manager.token);
    assert(invalid.status === 400 && arabic.test(invalid.data.error), 'رصيد غير رقمي يُرفض برسالة عربية');
    // فشل الحفظ: لا يتغير شيء، وإعادة المحاولة تنجح
    fake.failNext('NETWORK');
    const failed = await call('POST', `/api/bank-link/balance-requests/${accountId}/submit`, { balance: 5000 }, manager.token);
    assert(failed.status === 503 && db('bank.manualEntries').length === 0 && dbCashbox(cashbox.id).currentBalance === startBalance, 'فشل الحفظ: الرصيد لم يُسجَّل والخزنة لم تتغير');
    const first = await call('POST', `/api/bank-link/balance-requests/${accountId}/submit`, { balance: 5000 }, manager.token);
    assert(first.status === 200 && first.data.entry.kind === 'baseline' && first.data.entry.reviewed === true && first.data.requests.length === 0, `أول رصيد: ${first.data?.error || ''}`);
    assert(db('bank.manualEntries').length === 1 && dbCashbox(cashbox.id).currentBalance === 5000, 'الرصيد وحركة الخزنة محفوظان معًا في قاعدة البيانات');
    assert(startBalance === 5000 || db('cashboxTransactions').some(r => /مطابقة رصيد/.test((r.data as any).v.statement) && (r.data as any).v.amount === 5000 - startBalance), 'حركة مطابقة الرصيد محفوظة');
    assert((await probe(manager.token)) !== 423, 'بعد كتابة الرصيد المسؤول يكمل عمله');
    const list = await call('GET', '/api/cashboxes', undefined, owner.token);
    assert((list.data.cashboxes || list.data.data || list.data)[0].currentBalance === 5000, 'رصيد الخزنة في النظام = الرصيد المُدخل');

    // ---- الموعد التالي: فرق يُسجَّل فورًا وينبَّه المالك ----
    overview = await call('GET', '/api/bank-link/manual/overview', undefined, owner.token);
    const nextDueAt = overview.data.accounts[0].nextDueAt as string;
    assert(nextDueAt && Date.parse(nextDueAt) > Date.now() && overview.data.accounts[0].request === null && overview.data.accounts[0].responsibles[0].name === 'مدير الحساب', 'الموعد القادم واسم المسؤول في العرض');
    (manualBalances as any).now = () => new Date(Date.parse(nextDueAt) + 60000);
    mine = await call('GET', '/api/bank-link/balance-requests', undefined, manager.token);
    assert(mine.data.requests.length === 1 && mine.data.requests[0].kind === 'scheduled' && mine.data.requests[0].dueAt === nextDueAt && (await probe(manager.token)) === 423, 'في الموعد يُطلب الرصيد ويعود الإيقاف');
    const second = await call('POST', `/api/bank-link/balance-requests/${accountId}/submit`, { balance: '4,800' }, manager.token);
    assert(second.status === 200 && second.data.entry.difference === -200 && second.data.entry.reviewed === false, 'فرق −200 مسجل');
    assert(dbCashbox(cashbox.id).currentBalance === 4800 && db('cashboxTransactions').some(r => /للمراجعة/.test((r.data as any).v.statement) && (r.data as any).v.amount === -200 && (r.data as any).v.userName === 'مدير الحساب'), 'الفرق حركة ظاهرة على الخزنة باسم من كتبه');
    let ownerView = await call('GET', '/api/bank-link/balance-requests', undefined, owner.token);
    assert(ownerView.data.alerts.length === 1 && ownerView.data.alerts[0].difference === -200 && ownerView.data.alerts[0].userName === 'مدير الحساب', 'تنبيه الفرق يظهر للمالك');
    assert((await call('GET', '/api/bank-link/balance-requests', undefined, cashier.token)).data.alerts.length === 0, 'الكاشير لا يرى تنبيهات الفروق');
    const entryId = second.data.entry.id as string;
    assert((await call('POST', `/api/bank-link/manual/entries/${entryId}/reviewed`, {}, cashier.token)).status === 403, 'الكاشير لا يعلّم المراجعة');
    const reviewed = await call('POST', `/api/bank-link/manual/entries/${entryId}/reviewed`, {}, owner.token);
    assert(reviewed.status === 200 && reviewed.data.entry.reviewedBy === 'صاحب المحل' && reviewed.data.alerts.length === 0, 'المالك يعلّم الفرق «تمت المراجعة»');
    // المالك (صلاحية الإدارة) يكتب الرصيد لأي خزنة من الإعدادات
    const byOwner = await call('POST', `/api/bank-link/balance-requests/${accountId}/submit`, { balance: 4800 }, owner.token);
    assert(byOwner.status === 200 && byOwner.data.entry.difference === 0, 'صاحب صلاحية الإدارة يكتب الرصيد');

    // ---- زر التفعيل / الإيقاف ----
    assert((await call('POST', `/api/bank-link/manual/accounts/${accountId}/enabled`, { enabled: false }, cashier.token)).status === 403, 'الكاشير لا يوقف المتابعة');
    assert((await call('POST', `/api/bank-link/manual/accounts/${accountId}/enabled`, { enabled: false }, owner.token)).data.account.enabled === false, 'إيقاف المتابعة');
    (manualBalances as any).now = () => new Date(Date.parse(nextDueAt) + 3 * 24 * 60 * 60000);
    assert((await call('GET', '/api/bank-link/balance-requests', undefined, manager.token)).data.requests.length === 0 && (await probe(manager.token)) !== 423, 'الموقوف لا يطلب ولا يوقف');
    assert((await call('POST', `/api/bank-link/manual/accounts/${accountId}/enabled`, { enabled: true }, owner.token)).data.account.enabled === true, 'إعادة التفعيل');

    // ---- تعديل التعريف: أيام معينة وغير إجباري ----
    const edited = await call('POST', '/api/bank-link/manual/accounts', { ...definition, id: accountId, scheduleType: 'weekdays', weekdays: [5], time: '09:30', mandatory: false }, owner.token);
    assert(edited.status === 200 && edited.data.account.scheduleType === 'weekdays' && edited.data.account.weekdays.join() === '5' && edited.data.account.mandatory === false, 'تعديل الموعد إلى أيام معينة');
    const noDays = await call('POST', '/api/bank-link/manual/accounts', { ...definition, id: accountId, scheduleType: 'weekdays', weekdays: [] }, owner.token);
    assert(noDays.status === 400 && arabic.test(noDays.data.error), 'أيام الأسبوع بدون يوم تُرفض');
    (manualBalances as any).now = realNow;

    // ---- إعادة تشغيل السيرفر ----
    const before = JSON.stringify((await call('GET', '/api/bank-link/manual/overview', undefined, owner.token)).data.accounts);
    await engine.lock.run(async () => {
      assert(await engine.recover(), 'تحميل الحالة بعد إعادة التشغيل');
    });
    assert(JSON.stringify((await call('GET', '/api/bank-link/manual/overview', undefined, owner.token)).data.accounts) === before, 'المتابعة اليدوية مطابقة بعد إعادة التشغيل');
    assert(!engine.hasPendingChanges(), 'لا تغييرات معلقة');

    // ---- سجل التدقيق ----
    const audit = db('auditLogs').map(r => String((r.data as any).v.action || ''));
    assert(audit.includes('MANUAL_BALANCE_ACCOUNT_SAVED') && audit.includes('MANUAL_BALANCE_POSTPONED') && audit.includes('MANUAL_BALANCE_ENTERED') && audit.includes('MANUAL_BALANCE_DIFFERENCE') && audit.includes('MANUAL_BALANCE_REVIEWED'), 'كل خطوة مسجلة في سجل التدقيق');

    // ---- إعادة ضبط العمليات: التعريف يبقى والأرصدة المُدخلة تُمسح ----
    const status = await call('GET', '/api/system/reset-status', undefined, owner.token);
    const reset = await call('POST', '/api/system/reset-operations', { password: ADMIN_PASSWORD, confirmText: status.data.phrases.operations }, owner.token);
    assert(reset.status === 200, `إعادة ضبط العمليات: ${reset.data?.error || ''}`);
    assert(db('bank.manualEntries').length === 0 && db('bank.manualAccounts').length === 1 && (db('bank.manualAccounts')[0].data as any).v.lastBalance === null, 'بعد إعادة ضبط العمليات: الأرصدة مُسحت والتعريف باقٍ');

    console.log(`\n🎉 كل اختبارات ربط إدخال الرصيد يدويًا نجحت (${passed} تحققًا).`);
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

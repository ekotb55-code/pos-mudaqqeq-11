/**
 * اختبار ربط «الخزن المربوطة برسائل البنك» بالسيرفر والـ API والحفظ وإعادة الضبط (ناقل وهمي بدون إنترنت)
 * التشغيل:  npx tsx scripts/verify_linked_accounts_wiring.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import { ALL_PERMISSIONS, ROLE_TEMPLATES } from '../src/utils/permissions.ts';
import { createFakeTransport } from '../server/persistence/statePersistence.ts';

const TENANT = 'test_banklink';
const ADMIN_PASSWORD = 'Bank#Admin2026';
const MANAGER_PASSWORD = 'Bank#Manager2026';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

async function main() {
  // 1) تحقق الصلاحيات
  assert(ALL_PERMISSIONS.some(p => p.key === 'settings.bank_link'), 'صلاحية settings.bank_link موجودة في ALL_PERMISSIONS');
  assert(ALL_PERMISSIONS.some(p => p.key === 'settings.bank_templates'), 'صلاحية settings.bank_templates موجودة في ALL_PERMISSIONS');
  assert(
    !ROLE_TEMPLATES.manager.includes('settings.bank_link') &&
      !ROLE_TEMPLATES.manager.includes('settings.bank_templates') &&
      !ROLE_TEMPLATES.employee.includes('settings.bank_link') &&
      !ROLE_TEMPLATES.employee.includes('settings.bank_templates'),
    'الصلاحيتان الجديدتان غير مضمّنتين افتراضيًا في قوالب المدير والموظف'
  );

  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { getPersistenceCollections } = await import('../server/sheetsService.ts');
  const { app, persistence, linkedAccounts } = await createServerApp({
    attachVite: false,
    persistenceTransport: fake.transport,
    persistenceTenant: TENANT
  });
  assert(persistence && persistence.isReady() && Boolean(linkedAccounts), 'طبقة الحفظ ووحدة الخزن المربوطة جاهزتان');
  const engine = persistence!;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;

  const call = async (method: string, url: string, body?: unknown, headers?: Record<string, string>) => {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
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
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const db = (collection: string) => fake.dump(TENANT).rows.filter(r => r.collection === collection);

  const loginAndSetup = async (username: string, name: string, password: string) => {
    const login = await call('POST', '/api/auth/login', { username, password: process.env.INITIAL_USER_PASSWORD || '1234' });
    assert(login.status === 200 && login.data?.token, `دخول ${username}`);
    const setup = await call('POST', '/api/auth/complete-initial-setup', { name, username, newPassword: password }, auth(login.data.token));
    assert(setup.status === 200 && setup.data?.success, `استكمال إعداد ${username}: ${setup.data?.error || ''}`);
    return login.data.token as string;
  };

  try {
    let admin = await loginAndSetup('admin', 'مالك النظام', ADMIN_PASSWORD);
    const managerToken = await loginAndSetup('manager', 'مدير الفرع', MANAGER_PASSWORD);

    // 2) حدود المصادقة والصلاحيات
    assert((await call('GET', '/api/bank-link/overview')).status === 401, 'رفض overview بدون تسجيل دخول');
    assert((await call('GET', '/api/bank-link/overview', undefined, auth(managerToken))).status === 403, 'رفض overview للمدير بدون صلاحية settings.bank_link');

    // منح المدير صلاحية settings.bank_link فقط بدون settings.bank_templates
    const usersCol = getPersistenceCollections().find(c => c.name === 'users')!;
    const managerUser = (usersCol.get() as any[]).find(u => u.username === 'manager');
    managerUser.permissions = [...(managerUser.permissions || []), 'settings.bank_link'];
    const managerLinkToken = (await call('POST', '/api/auth/login', { username: 'manager', password: MANAGER_PASSWORD })).data.token as string;

    const mgrOv = await call('GET', '/api/bank-link/overview', undefined, auth(managerLinkToken));
    assert(
      mgrOv.status === 200 && mgrOv.data.canManageTemplates === false && Array.isArray(mgrOv.data.templates) && mgrOv.data.templates.length === 0,
      'صاحب settings.bank_link يرى overview بدون صلاحية القوالب'
    );
    assert((await call('POST', '/api/bank-link/templates', { name: 'قالب', pattern: 'مبلغ {المبلغ}' }, auth(managerLinkToken))).status === 403, 'منع حفظ قالب بدون settings.bank_templates');
    assert((await call('POST', '/api/bank-link/templates/suggest', { text: 'تم إيداع 100 ج.م' }, auth(managerLinkToken))).status === 403, 'منع اقتراح قالب بدون settings.bank_templates');
    assert((await call('GET', '/api/bank-link/templates/export', undefined, auth(managerLinkToken))).status === 403, 'منع تصدير القوالب بدون settings.bank_templates');

    // 3) التحقق من نظرة عامة للمالك + إنشاء خزنة وربطها
    const adminOv0 = await call('GET', '/api/bank-link/overview', undefined, auth(admin));
    assert(
      adminOv0.status === 200 &&
        adminOv0.data.canManageTemplates === true &&
        typeof adminOv0.data.intakeKey === 'string' &&
        adminOv0.data.intakeKey.startsWith('mq_') &&
        adminOv0.data.intakePath === '/api/bank-link/intake' &&
        adminOv0.data.heartbeatPath === '/api/bank-link/heartbeat',
      'المالك يرى overview كاملًا مع مفتاح الاستقبال والمسارات'
    );
    const key1 = adminOv0.data.intakeKey as string;

    // إنشاء خزنة بنكية عبر المسار أو استخدام الخزينة الرئيسية
    const cashboxesRes = await call('GET', '/api/cashboxes', undefined, auth(admin));
    assert(cashboxesRes.status === 200 && cashboxesRes.data.cashboxes.length >= 1, 'قراءة الخزائن');
    const mainCashboxId = cashboxesRes.data.cashboxes[0].id as string;

    // خطأ مدخلات عربي
    const badAcc = await call('POST', '/api/bank-link/accounts', { name: '', cashboxId: mainCashboxId, senders: ['NBE'] }, auth(admin));
    assert(badAcc.status === 400 && /[\u0600-\u06FF]/.test(badAcc.data?.error || ''), 'رفض حساب غير صالح برسالة عربية');

    // إنشاء الحساب المربوط
    const createdAcc = await call(
      'POST',
      '/api/bank-link/accounts',
      { name: 'حساب البنك الأهلي', cashboxId: mainCashboxId, senders: ['NBE'], matchWindowMinutes: 30 },
      auth(admin)
    );
    assert(createdAcc.status === 200 && createdAcc.data.account?.id, `إنشاء حساب مربوط: ${createdAcc.data?.error || ''}`);
    const accountId = createdAcc.data.account.id as string;
    assert(db('bank.accounts').length === 1, 'حفظ الحساب المربوط في قاعدة البيانات');
    assert(db('auditLogs').some(r => (r.data as any).v.action === 'BANK_LINK_ACCOUNT_CREATED'), 'تسجيل ربط الحساب في سجل التدقيق');

    // 4) رفض استقبال بدون مفتاح أو بمفتاح خاطئ
    const noKeyIntake = await call('POST', '/api/bank-link/intake', { sender: 'NBE', text: 'تم إيداع 100 ج.م الرصيد 100 ج.م' });
    assert(noKeyIntake.status === 401 && /[\u0600-\u06FF]/.test(noKeyIntake.data?.error || ''), 'رفض intake بدون مفتاح برسالة عربية');
    const badKeyHb = await call('POST', '/api/bank-link/heartbeat', { deviceId: 'phone-1', battery: 90 }, { 'x-intake-key': 'wrong' });
    assert(badKeyHb.status === 401, 'رفض heartbeat بمفتاح خاطئ');

    // 5) نبضة الهاتف واستقبال رسائل مع حفظ ذرّي للخزنة والرسائل معًا
    const hbOk = await call('POST', '/api/bank-link/heartbeat', { deviceId: 'phone-1', battery: 91 }, { 'x-intake-key': key1 });
    assert(hbOk.status === 200 && hbOk.data.success, 'تسجيل نبضة الهاتف بنجاح');

    const nowIso = new Date().toISOString();
    const intake1 = await call(
      'POST',
      '/api/bank-link/intake',
      { sender: 'NBE', text: 'تم إيداع 500 ج.م في حسابك الرصيد المتاح 2000 ج.م', at: nowIso },
      { 'x-intake-key': key1 }
    );
    assert(intake1.status === 200 && intake1.data.status === 'recorded', `تسجيل رسالة بدء الربط: ${intake1.data?.message || ''}`);
    assert(db('bank.messages').length === 1 && db('bank.postings').length === 1, 'حفظ الرسالة والقيد في قاعدة البيانات');
    const cbAfter1 = (await call('GET', '/api/cashboxes', undefined, auth(admin))).data.cashboxes.find((c: any) => c.id === mainCashboxId);
    assert(cbAfter1.currentBalance === 2000, 'تحديث رصيد الخزنة في قاعدة البيانات إلى 2000');

    // 6) فشل الحفظ عند استقبال رسالة: تراجع كامل عن الرسالة وعن الخزنة معًا
    fake.failNext('NETWORK');
    const intakeFail = await call(
      'POST',
      '/api/bank-link/intake',
      { sender: 'NBE', text: 'تم إيداع 700 ج.م في حسابك الرصيد المتاح 2700 ج.م', at: new Date(Date.now() + 60_000).toISOString() },
      { 'x-intake-key': key1 }
    );
    assert(intakeFail.status === 503, 'فشل الحفظ يعيد 503');
    const cbAfterFail = (await call('GET', '/api/cashboxes', undefined, auth(admin))).data.cashboxes.find((c: any) => c.id === mainCashboxId);
    assert(cbAfterFail.currentBalance === 2000 && db('bank.messages').length === 1, 'التراجع التام عن رصيد الخزنة والرسالة عند فشل الحفظ');

    // إعادة إرسال الرسالة بنجاح عبر query ?key=
    const intake2 = await call(
      'POST',
      `/api/bank-link/intake?key=${encodeURIComponent(key1)}`,
      { sender: 'NBE', text: 'تم إيداع 700 ج.م في حسابك الرصيد المتاح 2700 ج.م', at: new Date(Date.now() + 60_000).toISOString() }
    );
    assert(intake2.status === 200 && intake2.data.status === 'recorded', 'استقبال الرسالة بنجاح عبر ?key=');
    const cbAfter2 = (await call('GET', '/api/cashboxes', undefined, auth(admin))).data.cashboxes.find((c: any) => c.id === mainCashboxId);
    assert(cbAfter2.currentBalance === 2700 && db('bank.messages').length === 2, 'تحديث رصيد الخزنة إلى 2700 بعد الرسالة الثانية');

    // 7) إيقاف وتفعيل الحساب
    const disableRes = await call('POST', `/api/bank-link/accounts/${accountId}/enabled`, { enabled: false }, auth(admin));
    assert(disableRes.status === 200 && disableRes.data.account.enabled === false, 'إيقاف الحساب المربوط');
    assert(db('auditLogs').some(r => (r.data as any).v.action === 'BANK_LINK_ACCOUNT_TOGGLED'), 'تسجيل إيقاف الحساب في سجل التدقيق');
    const disabledIntake = await call(
      'POST',
      '/api/bank-link/intake',
      { sender: 'NBE', text: 'تم إيداع 50 ج.م في حسابك الرصيد المتاح 2750 ج.م' },
      { 'x-intake-key': key1 }
    );
    assert(disabledIntake.status === 200 && disabledIntake.data.status === 'disabled', 'الحساب الموقوف لا يسجل رسائل');
    assert((await call('POST', `/api/bank-link/accounts/${accountId}/enabled`, { enabled: true }, auth(admin))).data.account.enabled === true, 'إعادة تفعيل الحساب');

    // 8) القوالب ونص الرسالة
    const suggestRes = await call('POST', '/api/bank-link/templates/suggest', { text: 'تم استلام مبلغ 150 ج.م والرصيد المتاح 2850 ج.م' }, auth(admin));
    assert(suggestRes.status === 200 && suggestRes.data.suggestion?.pattern?.includes('{المبلغ}'), 'مسار اقتراح القالب يعمل');

    const saveTpl = await call(
      'POST',
      '/api/bank-link/templates',
      { name: 'قالب الأهلي الخاص', pattern: 'اشعار خاص {المبلغ} رصيد {الرصيد}', direction: 'in', sender: 'NBE' },
      auth(admin)
    );
    assert(saveTpl.status === 200 && saveTpl.data.template?.id && db('bank.templates').length === 1, 'حفظ قالب جديد في قاعدة البيانات');
    const tplId = saveTpl.data.template.id as string;

    const testTpl = await call('POST', '/api/bank-link/templates/test', { sender: 'NBE', text: 'اشعار خاص 90 رصيد 2790' }, auth(admin));
    assert(testTpl.status === 200 && testTpl.data.reading?.amount === 90 && testTpl.data.reading?.balance === 2790, 'مسار تجربة القالب يقرأ المبلغ والرصيد');

    const expRes = await call('GET', '/api/bank-link/templates/export', undefined, auth(admin));
    assert(expRes.status === 200 && expRes.data.templates.length === 1, 'تصدير القوالب');

    const impRes = await call(
      'POST',
      '/api/bank-link/templates/import',
      { templates: [{ name: 'قالب تجاهل', pattern: 'رسالة دعائية', direction: 'ignore', sender: '*' }] },
      auth(admin)
    );
    assert(impRes.status === 200 && impRes.data.added === 1 && db('bank.templates').length === 2, 'استيراد القوالب');

    // عرض نص رسالة محفوظة (مسموح لصاحب settings.bank_templates وممنوع لغيره)
    const ovWithMsg = await call('GET', '/api/bank-link/overview', undefined, auth(admin));
    const msgId = ovWithMsg.data.accounts[0].entries[0].messageId as string;
    assert((await call('GET', `/api/bank-link/messages/${msgId}`, undefined, auth(managerLinkToken))).status === 403, 'منع قراءة نص الرسالة بدون settings.bank_templates');
    const msgRes = await call('GET', `/api/bank-link/messages/${msgId}`, undefined, auth(admin));
    assert(msgRes.status === 200 && msgRes.data.message?.sender === 'NBE' && msgRes.data.message?.text?.includes('700'), 'قراءة نص الرسالة لصاحب الصلاحية');
    assert((await call('GET', '/api/bank-link/messages/missing-id', undefined, auth(admin))).status === 404, 'رسالة غير موجودة تعيد 404');

    // حذف القالب الأول
    assert((await call('DELETE', `/api/bank-link/templates/${tplId}`, undefined, auth(admin))).status === 200 && db('bank.templates').length === 1, 'حذف القالب بنجاح');

    // 9) تجديد مفتاح الاستقبال
    const regenRes = await call('POST', '/api/bank-link/intake-key/regenerate', {}, auth(admin));
    assert(regenRes.status === 200 && regenRes.data.intakeKey && regenRes.data.intakeKey !== key1, 'تجديد مفتاح الاستقبال');
    const key2 = regenRes.data.intakeKey as string;
    assert((await call('POST', '/api/bank-link/heartbeat', { deviceId: 'phone-1', battery: 80 }, { 'x-intake-key': key1 })).status === 401, 'المفتاح القديم لم يعد يعمل');
    assert((await call('POST', '/api/bank-link/heartbeat', { deviceId: 'phone-1', battery: 80 }, { 'x-intake-key': key2 })).status === 200, 'المفتاح الجديد يعمل');

    // 10) بقاء البيانات بعد إعادة التحميل (استعادة السيرفر من القاعدة)
    await engine.lock.run(async () => {
      assert(await engine.recover(), 'إعادة تحميل الحالة من قاعدة البيانات');
    });
    const ovAfterRecover = await call('GET', '/api/bank-link/overview', undefined, auth(admin));
    assert(
      ovAfterRecover.status === 200 &&
        ovAfterRecover.data.accounts.length === 1 &&
        ovAfterRecover.data.accounts[0].bookBalance === 2700 &&
        ovAfterRecover.data.templates.length === 1 &&
        ovAfterRecover.data.intakeKey === key2 &&
        ovAfterRecover.data.devices.length === 1,
      'بقاء الحسابات والرصيد والقوالب والمفتاح والأجهزة بعد إعادة التشغيل'
    );

    // 11) إعادة ضبط العمليات: تمسح الرسائل والتسجيلات وتُبقي الحسابات والقوالب والمفتاح
    const resetStatus = await call('GET', '/api/system/reset-status', undefined, auth(admin));
    assert(resetStatus.status === 200 && resetStatus.data.unclassifiedCollections.length === 0, 'لا توجد مجموعات غير مصنفة بعد ربط الخزن');

    const opsReset = await call(
      'POST',
      '/api/system/reset-operations',
      { password: ADMIN_PASSWORD, confirmText: resetStatus.data.phrases.operations },
      auth(admin)
    );
    assert(opsReset.status === 200 && opsReset.data.success, 'نجاح إعادة ضبط العمليات');
    await new Promise(resolve => setTimeout(resolve, 50));
    admin = (await call('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD })).data.token as string;

    assert(
      db('bank.accounts').length === 1 &&
        db('bank.templates').length === 1 &&
        db('bank.messages').length === 0 &&
        db('bank.postings').length === 0,
      'إعادة ضبط العمليات تمسح رسائل وتسجيلات البنك وتُبقي الحسابات والقوالب'
    );
    const ovAfterOps = await call('GET', '/api/bank-link/overview', undefined, auth(admin));
    assert(
      ovAfterOps.data.intakeKey === key2 &&
        ovAfterOps.data.accounts[0].lastMessageAt === '' &&
        ovAfterOps.data.accounts[0].bookBalance === 0,
      'بعد إعادة ضبط العمليات: المفتاح باقٍ والرصيد صفر وآخر رسالة فارغ'
    );

    // 12) إعادة ضبط المصنع: تمسح كل شيء بما فيه الحسابات والقوالب والمفتاح
    const facReset = await call(
      'POST',
      '/api/system/factory-reset',
      { password: ADMIN_PASSWORD, confirmText: resetStatus.data.phrases.factory },
      auth(admin)
    );
    assert(facReset.status === 200 && facReset.data.success, 'نجاح إعادة ضبط المصنع');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert(
      db('bank.accounts').length === 0 &&
        db('bank.templates').length === 0 &&
        db('bank.messages').length === 0 &&
        db('bank.postings').length === 0,
      'إعادة ضبط المصنع تمسح كل مجموعات ربط البنك'
    );
    assert((await call('POST', '/api/bank-link/heartbeat', { deviceId: 'phone-1', battery: 50 }, { 'x-intake-key': key2 })).status === 401, 'المفتاح القديم لا يعمل بعد إعادة ضبط المصنع');
    assert(engine.isReady() && !engine.hasPendingChanges(), 'طبقة الحفظ جاهزة ولا توجد تغييرات معلقة');

    console.log('✅ اختبارات الصلاحيات والـ API والحفظ وإعادة الضبط نجحت');
    console.log(`🎉 كل اختبارات ربط الخزن برسائل البنك نجحت (${passed} تحققًا).`);
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

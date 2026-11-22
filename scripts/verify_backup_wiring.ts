/**
 * اختبار ربط النسخ الاحتياطي وشاشة قاعدة البيانات بالسيرفر عبر الـ API (بدون إنترنت — ناقل وهمي)
 * التشغيل:  npx tsx scripts/verify_backup_wiring.ts
 */
process.env.SKIP_SERVER_LISTEN = '1';
delete process.env.APPS_SCRIPT_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

import zlib from 'node:zlib';
import { createFakeTransport, PersistenceError, type RpcTransport } from '../server/persistence/statePersistence.ts';

const TENANT = 'test_backupwiring';
const PASSWORD_AT_BACKUP = 'Backup#Test2026';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

async function listen(app: any) {
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
    return { status: res.status, data, buffer, headers: res.headers };
  };
  return { server, call };
}

async function main() {
  const fake = createFakeTransport();
  const { createServerApp } = await import('../server.ts');
  const { app, persistence } = await createServerApp({ attachVite: false, persistenceTransport: fake.transport, persistenceTenant: TENANT });
  assert(persistence && persistence.isReady(), 'طبقة الحفظ جاهزة');
  const { server, call } = await listen(app);
  const dbCount = (collection: string) => fake.dump(TENANT).rows.filter(r => r.collection === collection).length;

  try {
    // تجهيز بيانات
    const login = await call('POST', '/api/auth/login', { username: 'admin', password: process.env.INITIAL_USER_PASSWORD || '1234' });
    let admin = login.data.token as string;
    const setup = await call('POST', '/api/auth/complete-initial-setup', { name: 'صاحب المحل', username: 'admin', newPassword: PASSWORD_AT_BACKUP }, admin);
    assert(setup.status === 200 && setup.data?.success, `استكمال إعداد المالك: ${setup.data?.error || ''}`);
    assert((await call('POST', '/api/platforms', { name: 'البيع المباشر', discountPercentage: 0, pickupFee: 0, status: 'نشطة' }, admin)).status === 200, 'إضافة منصة');
    const item = await call('POST', '/api/items', { name: 'قلم جاف أزرق', barcode: '6221234567890', purchasePrice: 5, salePrice: 10, stockQuantity: 100, unit: 'قطعة' }, admin);
    assert(item.status === 200 && item.data?.item?.id, `إضافة صنف: ${item.data?.error || ''}`);
    const itemId = item.data.item.id as string;

    // ---- شاشة قاعدة البيانات ----
    const status = await call('GET', '/api/database/status', undefined, admin);
    assert(status.status === 200 && status.data.persistenceMode === 'supabase' && status.data.tenant === TENANT && status.data.status.ready === true, 'حالة قاعدة البيانات');
    assert(Array.isArray(status.data.requiredEnvNames) && status.data.requiredEnvNames.length === 3, 'أسماء متغيرات السيرفر المطلوبة');
    assert(!JSON.stringify(status.data).includes('sb_secret'), 'الحالة لا تعرض أي مفتاح');
    const check = await call('POST', '/api/database/check', {}, admin);
    assert(check.status === 200 && check.data.configured === true && check.data.check.connected && check.data.check.initialized, 'فحص الاتصال والتهيئة');
    const publicReady = await call('GET', '/api/database/public-status');
    assert(publicReady.status === 200 && publicReady.data.ready === true && publicReady.data.needsSetup === false && !('check' in publicReady.data), 'الحالة العامة لا تعرض تفاصيل عندما القاعدة جاهزة');
    assert((await call('GET', '/api/database/setup-sql')).status === 401, 'كود التهيئة غير متاح للزوار عندما القاعدة جاهزة');
    const sql = await call('GET', '/api/database/setup-sql', undefined, admin);
    assert(sql.status === 200 && sql.buffer.toString('utf8').includes('app_persist_changes'), 'كود التهيئة متاح لصاحب الصلاحية');
    assert((await call('GET', '/api/database/status')).status === 401, 'حالة قاعدة البيانات تحتاج تسجيل دخول');

    // ---- تنزيل نسخة ----
    const exported = await call('GET', '/api/backup/export', undefined, admin);
    assert(exported.status === 200 && exported.buffer[0] === 0x1f && exported.buffer[1] === 0x8b, 'تنزيل ملف النسخة (gzip)');
    assert(/^mudaqqeq-backup-test_backupwiring-\d{8}-\d{4}\.json\.gz$/.test(String(exported.headers.get('x-backup-file-name'))), 'اسم ملف النسخة');
    const fileBase64 = exported.buffer.toString('base64');
    const backupStatus = await call('GET', '/api/backup/status', undefined, admin);
    assert(backupStatus.status === 200 && backupStatus.data.backup.lastBackupAt && backupStatus.data.backup.lastBackupBy === 'صاحب المحل', 'تسجيل وقت آخر نسخة');
    assert(dbCount('state.backupMeta') === 1, 'وقت آخر نسخة محفوظ في قاعدة البيانات');
    const content = JSON.parse(zlib.gunzipSync(exported.buffer).toString('utf8'));
    assert(!('state.backupMeta' in content.data) && !('idempotencyCache' in content.data), 'بيانات المتابعة والمؤقتة لا تدخل الملف');
    assert(content.data.platforms.length === 1 && content.data.items.length === 1 && content.data.users.length === 3, 'الملف يحتوي بيانات الشركة');

    // ---- تغييرات بعد النسخة ----
    assert((await call('POST', '/api/platforms', { name: 'منصة بعد النسخة', discountPercentage: 2, pickupFee: 0, status: 'نشطة' }, admin)).status === 200, 'منصة جديدة بعد النسخة');
    const invoice = await call('POST', '/api/invoices', { idempotencyKey: `bk-${Date.now()}`, platform: 'البيع المباشر', paymentType: 'نقدي', lines: [{ itemId, quantity: 4 }] }, admin);
    assert(invoice.status === 200, `فاتورة بعد النسخة: ${invoice.data?.error || ''}`);
    assert(dbCount('platforms') === 2 && dbCount('invoices') === 1, 'التغييرات محفوظة');

    // ---- فحص الملف قبل الاسترجاع ----
    const inspect = await call('POST', '/api/backup/inspect', { fileBase64 }, admin);
    assert(inspect.status === 200 && inspect.data.summary.counts.platforms === 1 && inspect.data.summary.createdBy === 'صاحب المحل' && inspect.data.tenantMismatch === false, 'ملخص الملف قبل الاسترجاع');
    assert(dbCount('platforms') === 2, 'فحص الملف لا يغيّر شيئًا');

    // ---- محاولات مرفوضة: لا تغيّر شيئًا ----
    const wrongConfirm = await call('POST', '/api/backup/restore', { fileBase64, password: PASSWORD_AT_BACKUP, confirmText: 'نعم' }, admin);
    assert(wrongConfirm.status === 400 && /[\u0600-\u06ff]/.test(wrongConfirm.data.error), 'بدون كلمة التأكيد يُرفض');
    const wrongPassword = await call('POST', '/api/backup/restore', { fileBase64, password: 'wrong-password', confirmText: 'استرجاع' }, admin);
    assert(wrongPassword.status === 403, 'كلمة سر خاطئة تُرفض');
    const tampered = { header: content.header, data: { ...content.data, platforms: [] } };
    const tamperedFile = zlib.gzipSync(Buffer.from(JSON.stringify(tampered))).toString('base64');
    const badFile = await call('POST', '/api/backup/restore', { fileBase64: tamperedFile, password: PASSWORD_AT_BACKUP, confirmText: 'استرجاع' }, admin);
    assert(badFile.status === 400 && badFile.data.code === 'CHECKSUM_MISMATCH', 'ملف معدَّل يُرفض');
    const noFile = await call('POST', '/api/backup/restore', { password: PASSWORD_AT_BACKUP, confirmText: 'استرجاع' }, admin);
    assert(noFile.status === 400, 'بدون ملف يُرفض');
    assert(dbCount('platforms') === 2 && dbCount('invoices') === 1, 'المحاولات المرفوضة لم تغيّر شيئًا');

    // ---- فشل الحفظ أثناء الاسترجاع: لا يتغير شيء ----
    fake.failNext('NETWORK');
    const failedRestore = await call('POST', '/api/backup/restore', { fileBase64, password: PASSWORD_AT_BACKUP, confirmText: 'استرجاع' }, admin);
    assert(failedRestore.status === 503 && failedRestore.data.code === 'SAVE_FAILED', 'فشل الحفظ أثناء الاسترجاع يرجع خطأ');
    assert(dbCount('platforms') === 2 && dbCount('invoices') === 1, 'قاعدة البيانات لم تتغير بعد استرجاع فاشل');
    const stillThere = await call('GET', '/api/platforms', undefined, admin);
    assert(stillThere.status === 200 && stillThere.data.platforms.length === 2, 'النظام على حاله بعد استرجاع فاشل والجلسة ما زالت تعمل');

    // ---- استرجاع ناجح ----
    const restored = await call('POST', '/api/backup/restore', { fileBase64, password: PASSWORD_AT_BACKUP, confirmText: 'استرجاع' }, admin);
    assert(restored.status === 200 && restored.data.success && restored.data.restored.platforms === 1, `استرجاع ناجح: ${restored.data?.error || ''}`);
    assert(dbCount('platforms') === 1 && dbCount('invoices') === 0, 'قاعدة البيانات رجعت لحالة النسخة (استبدال لا دمج)');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert((await call('GET', '/api/platforms', undefined, admin)).status === 401, 'بعد الاسترجاع كل الجلسات تنتهي');
    const relogin = await call('POST', '/api/auth/login', { username: 'admin', password: PASSWORD_AT_BACKUP });
    assert(relogin.status === 200 && relogin.data.token, 'الدخول بكلمة السر وقت النسخة');
    admin = relogin.data.token;
    const items = await call('GET', '/api/items', undefined, admin);
    assert(items.data.items.find((i: any) => i.id === itemId)?.stockQuantity === 100, 'رصيد الصنف رجع كما كان وقت النسخة');
    const after = await call('GET', '/api/backup/status', undefined, admin);
    assert(after.data.backup.lastRestoreAt && after.data.backup.lastRestoreFromBackupAt === inspect.data.summary.createdAt, 'تسجيل وقت آخر استرجاع');
    assert(persistence!.isReady() && !persistence!.hasPendingChanges(), 'لا تغييرات معلقة بعد الاسترجاع');

    // ---- الصلاحيات ----
    assert((await call('GET', '/api/backup/export')).status === 401, 'تنزيل النسخة بدون دخول مرفوض');
    const cashierLogin = await call('POST', '/api/auth/login', { username: 'cashier', password: process.env.INITIAL_USER_PASSWORD || '1234' });
    await call('POST', '/api/auth/complete-initial-setup', { name: 'أحمد كاشير', username: 'cashier', newPassword: 'Cashier#Test2026' }, cashierLogin.data.token);
    assert((await call('GET', '/api/backup/export', undefined, cashierLogin.data.token)).status === 403, 'الكاشير بدون الصلاحية لا ينزّل نسخة');
    assert((await call('POST', '/api/backup/restore', { fileBase64, password: 'Cashier#Test2026', confirmText: 'استرجاع' }, cashierLogin.data.token)).status === 403, 'الكاشير بدون الصلاحية لا يسترجع');
    assert((await call('POST', '/api/database/check', {}, cashierLogin.data.token)).status === 403, 'الكاشير لا يفحص قاعدة البيانات');
  } finally {
    persistence?.stop();
    server.close();
  }

  // ---- قاعدة بيانات جديدة غير مهيأة: شاشة الدخول تعرض خطوات التهيئة بدون تسجيل دخول ----
  let initialized = false;
  const fresh = createFakeTransport();
  const uninitialized: RpcTransport = async (fn, args) => {
    if (!initialized) throw new PersistenceError('DB_ERROR', `خطأ من قاعدة البيانات (${fn}) [404]: Could not find the function public.${fn} in the schema cache`);
    return fresh.transport(fn, args);
  };
  const second = await createServerApp({ attachVite: false, persistenceTransport: uninitialized, persistenceTenant: 'test_backupwiring_new' });
  assert(second.persistence && !second.persistence.isReady(), 'قاعدة غير مهيأة: النظام غير جاهز');
  const b = await listen(second.app);
  try {
    const publicStatus = await b.call('GET', '/api/database/public-status');
    assert(publicStatus.status === 200 && publicStatus.data.needsSetup === true && publicStatus.data.check.connected === true && publicStatus.data.check.initialized === false, 'الحالة العامة تعرض أن القاعدة تحتاج تهيئة');
    const publicSql = await b.call('GET', '/api/database/setup-sql');
    assert(publicSql.status === 200 && publicSql.buffer.toString('utf8').includes('create table if not exists app_documents'), 'كود التهيئة متاح بدون دخول في وضع التهيئة فقط');
    const blockedLogin = await b.call('POST', '/api/auth/login', { username: 'admin', password: '1234' });
    assert(blockedLogin.status === 503 && blockedLogin.data.code === 'DATABASE_UNAVAILABLE', 'لا دخول قبل تهيئة قاعدة البيانات');
    initialized = true; // المستخدم شغّل كود التهيئة في SQL Editor
    assert(await second.persistence!.start(), 'بعد التهيئة يبدأ النظام تلقائيًا');
    const nowReady = await b.call('GET', '/api/database/public-status');
    assert(nowReady.data.ready === true && nowReady.data.needsSetup === false, 'الحالة العامة: جاهز بعد التهيئة');
  } finally {
    second.persistence?.stop();
    b.server.close();
  }

  console.log(`\n🎉 كل اختبارات ربط النسخ الاحتياطي وشاشة قاعدة البيانات نجحت (${passed} تحققًا).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌', err?.message || err);
    process.exit(1);
  });

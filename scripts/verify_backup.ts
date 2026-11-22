/**
 * اختبار وحدتي النسخ الاحتياطي (server/backup.ts) وفحص قاعدة البيانات (server/persistence/setupCheck.ts)
 * التشغيل:  npx tsx scripts/verify_backup.ts
 */
import zlib from 'node:zlib';
import {
  buildBackup,
  readBackup,
  applyBackup,
  BackupError,
  BACKUP_FORMAT,
  getBackupMeta,
  noteBackupTaken,
  noteBackupRestored,
  getBackupMetaCollection
} from '../server/backup.ts';
import { checkDatabaseSetup, readSetupSql, describeDatabaseTarget } from '../server/persistence/setupCheck.ts';
import { createFakeTransport, PersistenceError, type CollectionDef, type RpcTransport } from '../server/persistence/statePersistence.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

function world() {
  const state: any = {
    items: [{ id: 'i1', name: 'قلم', qty: 5 }, { id: 'i2', name: 'كراس', qty: 2 }],
    invoices: [{ invoiceNumber: 'INV-1', lines: [{ itemId: 'i1', quantity: 1 }], '10': 'x', '2': 'y' }],
    settings: { storeName: 'مكتبة النور', theme: 'a' },
    idempotencyCache: [{ key: 'k', result: 1 }],
    extra: []
  };
  const defs: CollectionDef[] = [
    { name: 'items', kind: 'list', get: () => state.items, set: v => { state.items = v; }, idOf: d => d.id },
    { name: 'invoices', kind: 'list', get: () => state.invoices, set: v => { state.invoices = v; } },
    { name: 'settings', kind: 'single', get: () => state.settings, set: v => { state.settings = v; } },
    { name: 'idempotencyCache', kind: 'list', get: () => state.idempotencyCache, set: v => { state.idempotencyCache = v; } },
    { name: 'extra', kind: 'list', get: () => state.extra, set: v => { state.extra = v; } }
  ];
  return { state, defs };
}

function expectBackupError(fn: () => unknown, code: string, message: string) {
  let caught: any = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof BackupError && caught.code === code && /[\u0600-\u06ff]/.test(caught.message), message);
}

async function main() {
  // ---- النسخ والاسترجاع ----
  const source = world();
  const backup = buildBackup(source.defs, { tenant: 'main', createdBy: 'صاحب المحل', storeName: 'مكتبة النور', now: new Date('2026-11-18T21:30:00.000Z') });
  assert(backup.fileName === 'mudaqqeq-backup-main-20261118-2130.json.gz', `اسم الملف (${backup.fileName})`);
  assert(backup.buffer[0] === 0x1f && backup.buffer[1] === 0x8b, 'الملف مضغوط gzip');
  assert(backup.summary.totalRecords === 3 && backup.summary.counts.items === 2 && backup.summary.counts.settings === 1, 'ملخص الأعداد');
  assert(!('idempotencyCache' in backup.summary.counts), 'المجموعات المؤقتة لا تدخل النسخة');

  const parsed = readBackup(backup.buffer);
  assert(parsed.summary.format === BACKUP_FORMAT && parsed.summary.tenant === 'main' && parsed.summary.createdBy === 'صاحب المحل', 'قراءة ترويسة الملف');
  assert(parsed.summary.createdAt === '2026-11-18T21:30:00.000Z' && parsed.summary.storeName === 'مكتبة النور' && parsed.summary.totalRecords === 3, 'تاريخ النسخة واسم المتجر والعدد');

  const target = world();
  target.state.items = [{ id: 'old', name: 'قديم' }];
  target.state.invoices = [];
  target.state.settings = { storeName: 'قديم' };
  target.state.extra = [{ id: 'leftover' }];
  const result = applyBackup(target.defs, parsed);
  assert(JSON.stringify(target.state.items) === JSON.stringify(source.state.items), 'الاسترجاع يستبدل القوائم (لا يدمج)');
  assert(JSON.stringify(target.state.invoices) === JSON.stringify(source.state.invoices), 'الفواتير مطابقة');
  assert(target.state.settings.storeName === 'مكتبة النور', 'الإعدادات مسترجعة');
  assert(target.state.extra.length === 0 && target.state.idempotencyCache.length === 0, 'القوائم غير الموجودة في الملف والمؤقتة تُفرَّغ');
  assert(result.totalRecords === 3 && result.restored.items === 2 && result.ignored.length === 0, 'نتيجة الاسترجاع');
  target.state.items[0].name = 'تغيير';
  assert((parsed.data.items as any[])[0].name === 'قلم', 'الذاكرة لا تشترك مع كائن النسخة');

  // مجموعة في الملف غير معروفة للبرنامج، ومجموعة مسجلة غير موجودة في الملف
  const fewer = world();
  const subset = fewer.defs.filter(d => d.name !== 'invoices');
  const partial = applyBackup(subset, parsed);
  assert(partial.ignored.includes('invoices'), 'مجموعة غير معروفة تُتجاهل وتُذكر');
  const older = readBackup(buildBackup(subset, { tenant: 'main', createdBy: 'x' }).buffer);
  const intoFull = world();
  const olderResult = applyBackup(intoFull.defs, older);
  assert(olderResult.missing.includes('invoices') && intoFull.state.invoices.length === 0, 'مجموعة ناقصة من الملف تُفرَّغ وتُذكر');

  // ---- ملفات مرفوضة ----
  expectBackupError(() => readBackup(Buffer.from('not a backup')), 'INVALID_FILE', 'ملف غير مضغوط يُرفض');
  expectBackupError(() => readBackup(zlib.gzipSync(Buffer.from('hello'))), 'INVALID_FILE', 'محتوى غير JSON يُرفض');
  expectBackupError(() => readBackup(zlib.gzipSync(Buffer.from(JSON.stringify({ header: { format: 'other' }, data: {} })))), 'INVALID_FILE', 'ملف من برنامج آخر يُرفض');
  const raw = JSON.parse(zlib.gunzipSync(backup.buffer).toString('utf8'));
  const tampered = { header: raw.header, data: { ...raw.data, items: [{ id: 'i1', name: 'قلم', qty: 5000 }] } };
  expectBackupError(() => readBackup(zlib.gzipSync(Buffer.from(JSON.stringify(tampered)))), 'CHECKSUM_MISMATCH', 'ملف معدَّل يُرفض ببصمة التحقق');
  const future = { header: { ...raw.header, version: 99 }, data: raw.data };
  expectBackupError(() => readBackup(zlib.gzipSync(Buffer.from(JSON.stringify(future)))), 'UNSUPPORTED_VERSION', 'إصدار أحدث يُرفض');
  const truncated = backup.buffer.subarray(0, Math.floor(backup.buffer.length / 2));
  expectBackupError(() => readBackup(truncated), 'INVALID_FILE', 'ملف مقطوع يُرفض');

  // ---- بيانات المتابعة ----
  const metaDef = getBackupMetaCollection();
  noteBackupTaken('صاحب المحل', new Date('2026-11-18T21:31:00.000Z'));
  noteBackupRestored('صاحب المحل', '2026-11-10T00:00:00.000Z', new Date('2026-11-18T21:32:00.000Z'));
  const meta = getBackupMeta();
  assert(meta.lastBackupAt === '2026-11-18T21:31:00.000Z' && meta.lastRestoreFromBackupAt === '2026-11-10T00:00:00.000Z', 'تسجيل آخر نسخة وآخر استرجاع');
  metaDef.set({ lastBackupAt: '2026-01-01T00:00:00.000Z' });
  assert(getBackupMeta().lastBackupAt === '2026-01-01T00:00:00.000Z' && getBackupMeta().lastRestoreAt === '', 'تحميل بيانات المتابعة من قاعدة البيانات');
  assert(metaDef.name === 'state.backupMeta' && metaDef.kind === 'single', 'مجموعة بيانات المتابعة');

  // ---- فحص قاعدة البيانات ----
  const fake = createFakeTransport();
  const healthy = await checkDatabaseSetup(fake.transport, 'main');
  assert(healthy.connected && healthy.initialized && healthy.items.length === 4 && healthy.items.every(i => i.ok), 'قاعدة مهيأة: كل الفحوص ناجحة');
  assert(fake.dump('main').rows.length === 0 && fake.dump('main').generation === 0, 'الفحص لا يكتب أي بيانات');

  const notInitialized: RpcTransport = async fn => {
    throw new PersistenceError('DB_ERROR', `خطأ من قاعدة البيانات (${fn}) [404]: Could not find the function public.${fn} in the schema cache`);
  };
  const empty = await checkDatabaseSetup(notInitialized, 'main');
  assert(empty.connected && !empty.initialized && empty.message.includes('غير مهيأة'), 'قاعدة جديدة: الاتصال سليم والتهيئة ناقصة');

  const partialDb: RpcTransport = async (fn, args) => {
    if (fn === 'app_persist_stage') throw new PersistenceError('DB_ERROR', 'Could not find the function public.app_persist_stage');
    return fake.transport(fn, args);
  };
  const half = await checkDatabaseSetup(partialDb, 'main');
  assert(half.connected && !half.initialized && half.items.find(i => i.key === 'app_persist_stage')?.ok === false, 'تهيئة ناقصة تُكتشف بالدالة الناقصة');

  const down: RpcTransport = async () => {
    throw new PersistenceError('NETWORK', 'تعذر الاتصال بقاعدة البيانات');
  };
  const offline = await checkDatabaseSetup(down, 'main');
  assert(!offline.connected && !offline.initialized && offline.message.includes('SUPABASE_URL'), 'انقطاع الاتصال');

  const badKey: RpcTransport = async () => {
    throw new PersistenceError('AUTH', 'قاعدة البيانات رفضت المفتاح (401)');
  };
  const denied = await checkDatabaseSetup(badKey, 'main');
  assert(!denied.connected && denied.message.includes('SUPABASE_SECRET_KEY'), 'مفتاح مرفوض');

  // ---- كود التهيئة ومعرّف المشروع ----
  const sql = readSetupSql();
  for (const name of ['app_documents', 'app_state_meta', 'app_persist_staging', 'app_get_generation', 'app_persist_changes', 'app_persist_stage', 'app_persist_commit', 'app_persist_abort', 'app_load_page', 'app_reset_test_tenant']) {
    assert(sql.includes(name), `كود التهيئة يحتوي ${name}`);
  }
  assert(!/sb_secret_|eyJ[A-Za-z0-9_-]{10,}/.test(sql), 'كود التهيئة لا يحتوي أي مفاتيح');
  const targetInfo = describeDatabaseTarget('https://abcdefghijklmnopqrst.supabase.co');
  assert(targetInfo.projectRef === 'abcdefghijklmnopqrst' && targetInfo.sqlEditorUrl === 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst/sql/new', 'رابط SQL Editor');
  assert(describeDatabaseTarget('http://localhost:54330').sqlEditorUrl === '' && describeDatabaseTarget('not a url').host === '', 'رابط غير Supabase');

  console.log(`\n🎉 كل اختبارات النسخ الاحتياطي وفحص قاعدة البيانات نجحت (${passed} تحققًا).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌', err?.message || err);
    process.exit(1);
  });

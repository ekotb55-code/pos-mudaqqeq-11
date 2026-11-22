/**
 * اختبار محرّك الحفظ الدائم (server/persistence/statePersistence.ts)
 * التشغيل:  npx tsx scripts/verify_state_persistence.ts
 * يعمل افتراضيًا على ناقل وهمي داخل الذاكرة (بدون إنترنت).
 * لو المتغيرات SUPABASE_URL و SUPABASE_SECRET_KEY مضبوطة يُعاد نفس الاختبار
 * على قاعدة البيانات الحقيقية داخل شركة اختبار معزولة تبدأ بـ test_ ثم تُمسح.
 */
import {
  StatePersistence,
  createFakeTransport,
  createSupabaseTransport,
  readPersistenceEnv,
  PersistenceError,
  type CollectionDef,
  type RpcTransport
} from '../server/persistence/statePersistence.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

interface World {
  items: any[];
  logs: any[];
  noIds: any[];
  settings: any;
  counter: any;
}

function makeWorld(): World {
  return { items: [], logs: [], noIds: [], settings: { theme: 'a' }, counter: { seq: 0 } };
}

function defsFor(world: World): CollectionDef[] {
  return [
    { name: 'items', kind: 'list', get: () => world.items, set: v => { world.items = v; }, idOf: d => d.id },
    { name: 'logs', kind: 'list', get: () => world.logs, set: v => { world.logs = v; }, idOf: d => d.id, appendOnly: true },
    { name: 'noIds', kind: 'list', get: () => world.noIds, set: v => { world.noIds = v; } },
    { name: 'settings', kind: 'single', get: () => world.settings, set: v => { world.settings = v; } },
    { name: 'counter', kind: 'single', get: () => ({ seq: world.counter.seq }), set: v => { world.counter = { seq: Number(v?.seq) || 0 }; } }
  ];
}

const canon = (v: any): any =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
    : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function makeEngine(transport: RpcTransport, tenant: string, world: World, extra: Partial<ConstructorParameters<typeof StatePersistence>[0]> = {}) {
  return new StatePersistence({ transport, tenant, collections: defsFor(world), log: () => undefined, ...extra });
}

/** يحمّل الحالة في «سيرفر جديد» ويعيد عالَمه */
async function reload(transport: RpcTransport, tenant: string): Promise<{ world: World; engine: StatePersistence }> {
  const world = makeWorld();
  const engine = makeEngine(transport, tenant, world);
  const ok = await engine.start();
  assert(ok, 'يجب أن ينجح تحميل الحالة في سيرفر جديد');
  return { world, engine };
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function runSuite(label: string, transport: RpcTransport, tenant: string, resetTenant: () => Promise<void>) {
  console.log(`\n=== ${label} ===`);
  await resetTenant();

  // 1) قاعدة بيانات فارغة: تُستدعى onEmpty ثم تُحفظ الحالة الابتدائية
  const world = makeWorld();
  let emptyCalls = 0;
  const engine = makeEngine(transport, tenant, world, {
    onEmpty: () => {
      emptyCalls++;
      world.items = [{ id: 'i1', name: 'قلم', qty: 5 }];
    }
  });
  assert(!engine.isReady(), 'المحرك غير جاهز قبل البدء');
  assert(await engine.start(), 'يجب أن ينجح البدء');
  assert(emptyCalls === 1, 'onEmpty تُستدعى مرة واحدة عند قاعدة فارغة');
  assert(engine.isReady() && engine.getStatus().generation === 1, 'بعد البدء: جاهز والإصدار = 1');
  assert(!engine.hasPendingChanges(), 'لا تغييرات معلقة بعد البدء');

  // 2) لا تغيير = لا حفظ
  let r = await engine.persist();
  assert(r.changed === 0 && r.generation === 1, 'حفظ بدون تغييرات لا يرفع الإصدار');

  // 3) إضافة بالآخر وبالأول، تعديل في المكان، حذف، إعادة إسناد المصفوفة
  world.items.push({ id: 'i2', name: 'كراس', qty: 1 });
  world.items.unshift({ id: 'i0', name: 'مسطرة', qty: 9 });
  world.items[1].qty = 7;
  world.logs.unshift({ id: 'l1', text: 'أول' });
  world.noIds.push({ a: 1 }, { a: 1 }, { b: 2 });
  world.settings = { ...world.settings, theme: 'b' };
  world.counter.seq = 4;
  r = await engine.persist();
  assert(r.upserts === 9 && r.deletes === 0, `عدد التغييرات المتوقع 9 وجاء ${r.upserts}/${r.deletes}`);
  let fresh = await reload(transport, tenant);
  assert(same(fresh.world, world), 'السيرفر الجديد يرى نفس الحالة ونفس الترتيب (1)');
  assert(fresh.world.items.map((d: any) => d.id).join(',') === 'i0,i1,i2', 'ترتيب العناصر محفوظ بعد unshift/push');
  assert(!fresh.engine.hasPendingChanges(), 'لا تغييرات معلقة بعد التحميل');

  // السيرفر الجديد كتب؟ لا — لكن الإصدار عند المحرك الأول ما زال صحيحًا
  world.items = world.items.filter((d: any) => d.id !== 'i1');
  world.items.splice(1, 0, { id: 'i9', name: 'وسط', qty: 0 });
  r = await engine.persist();
  assert(r.upserts === 1 && r.deletes === 1, 'حذف عنصر وإدراج عنصر في المنتصف = تغييران فقط');
  fresh = await reload(transport, tenant);
  assert(fresh.world.items.map((d: any) => d.id).join(',') === 'i0,i9,i2', 'الإدراج في المنتصف يحافظ على الترتيب');

  // 4) إعادة ترتيب كاملة
  world.items.reverse();
  await engine.persist();
  fresh = await reload(transport, tenant);
  assert(same(fresh.world.items, world.items), 'إعادة الترتيب تُحفظ');

  // 5) سجل لا يُحذف من قاعدة البيانات (appendOnly)
  world.logs.unshift({ id: 'l2', text: 'ثاني' });
  await engine.persist();
  world.logs = world.logs.slice(0, 1);
  r = await engine.persist();
  assert(r.deletes === 0, 'مجموعة appendOnly لا تُرسل حذفًا');
  fresh = await reload(transport, tenant);
  assert(fresh.world.logs.length === 2, 'سجلات appendOnly باقية في قاعدة البيانات');

  // 6) تعارض الإصدار: سيرفر ثانٍ كتب على نفس الشركة
  const other = await reload(transport, tenant);
  other.world.items.push({ id: 'other', name: 'من سيرفر آخر' });
  await other.engine.persist();
  world.items.push({ id: 'mine', name: 'محلي' });
  let conflict: any = null;
  try {
    await engine.persist();
  } catch (err) {
    conflict = err;
  }
  assert(conflict instanceof PersistenceError && conflict.code === 'STATE_CONFLICT', 'الكتابة بإصدار قديم تُرفض بـ STATE_CONFLICT');
  assert(await engine.recover(), 'الاستعادة بعد التعارض تنجح');
  assert(world.items.some((d: any) => d.id === 'other') && !world.items.some((d: any) => d.id === 'mine'),
    'بعد الاستعادة: الذاكرة تطابق قاعدة البيانات (تراجع عن التغيير المحلي)');
  world.items.push({ id: 'mine', name: 'محلي' });
  r = await engine.persist();
  assert(r.changed === 1, 'بعد الاستعادة تنجح إعادة العملية');

  // 7) حفظ مرحلي لعملية كبيرة (ذرّي)
  const bigWorld = makeWorld();
  const big = makeEngine(transport, tenant, bigWorld, { directLimit: 50 });
  assert(await big.start(), 'تحميل قبل العملية الكبيرة');
  const before = bigWorld.items.length;
  for (let i = 0; i < 1234; i++) bigWorld.items.push({ id: `bulk-${i}`, name: `صنف ${i}`, qty: i });
  bigWorld.items = bigWorld.items.filter((d: any) => d.id !== 'mine');
  r = await big.persist();
  assert(r.staged && r.upserts === 1234 && r.deletes === 1, 'العملية الكبيرة تمر بالحفظ المرحلي');
  fresh = await reload(transport, tenant);
  assert(fresh.world.items.length === before + 1233, 'كل سجلات العملية الكبيرة محفوظة');
  assert(same(fresh.world.items, bigWorld.items), 'ترتيب ومحتوى العملية الكبيرة مطابق');

  // 8) اختبار عشوائي: مئات العمليات مع حفظ بعد كل عملية ومقارنة دورية بسيرفر جديد
  const rnd = mulberry32(20261118);
  const fz = await reload(transport, tenant);
  let nextId = 0;
  for (let step = 1; step <= 300; step++) {
    const w = fz.world;
    const roll = rnd();
    const pick = () => Math.floor(rnd() * w.items.length);
    if (roll < 0.25) w.items.push({ id: `f${nextId++}`, n: step });
    else if (roll < 0.45) w.items.unshift({ id: `f${nextId++}`, n: step });
    else if (roll < 0.6 && w.items.length) w.items.splice(pick(), 0, { id: `f${nextId++}`, n: step });
    else if (roll < 0.75 && w.items.length) w.items[pick()].n = step;
    else if (roll < 0.85 && w.items.length) w.items.splice(pick(), 1);
    else if (roll < 0.9 && w.items.length) w.items = w.items.filter((_: any, i: number) => i % 7 !== 3);
    else if (roll < 0.93) w.items.sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
    else if (roll < 0.97) w.noIds.push({ t: step, same: step % 3 });
    else w.settings = { theme: `t${step}` };
    w.counter.seq = step;
    await fz.engine.persist();
    if (step % 60 === 0) {
      const check = await reload(transport, tenant);
      assert(same(check.world, w), `مطابقة كاملة بعد ${step} عملية عشوائية`);
    }
  }

  await resetTenant();
  console.log(`✅ ${label}: نجح`);
}

async function runFailureTests() {
  console.log('\n=== محاكاة الأعطال (ناقل وهمي) ===');
  const fake = createFakeTransport();
  const world = makeWorld();
  const engine = makeEngine(fake.transport, 'test_fail', world);
  assert(await engine.start(), 'بدء');
  world.items.push({ id: 'a', v: 1 });
  await engine.persist();

  // فشل شبكة أثناء الحفظ: لا شيء يُحفظ، وبعد الاستعادة ترجع الذاكرة لآخر حالة محفوظة
  world.items.push({ id: 'b', v: 2 });
  fake.failNext('NETWORK', 'app_persist_changes');
  let failed = false;
  try {
    await engine.persist();
  } catch {
    failed = true;
  }
  assert(failed, 'فشل الشبكة يظهر كخطأ');
  assert(fake.dump('test_fail').rows.filter(r => r.collection === 'items').length === 1, 'لم يُحفظ شيء عند الفشل');
  assert(await engine.recover(), 'استعادة');
  assert(world.items.length === 1 && world.items[0].id === 'a', 'الذاكرة رجعت لآخر حالة محفوظة');

  // فشل في منتصف عملية كبيرة: لا يُحفظ أي جزء
  const bigWorld = makeWorld();
  const big = makeEngine(fake.transport, 'test_fail', bigWorld, { directLimit: 10 });
  assert(await big.start(), 'بدء 2');
  for (let i = 0; i < 100; i++) bigWorld.items.push({ id: `x${i}` });
  fake.failNext('NETWORK', 'app_persist_commit');
  failed = false;
  try {
    await big.persist();
  } catch {
    failed = true;
  }
  assert(failed, 'فشل الاعتماد يظهر كخطأ');
  assert(fake.dump('test_fail').rows.filter(r => r.collection === 'items').length === 1, 'لا يُحفظ جزء من عملية كبيرة فاشلة');

  // فشل التحميل عند البدء: المحرك غير جاهز ولا يكتب
  const downWorld = makeWorld();
  const down = makeEngine(fake.transport, 'test_fail', downWorld);
  fake.failNext('NETWORK', 'app_load_page');
  assert((await down.start()) === false && !down.isReady(), 'فشل التحميل = غير جاهز');
  let notReady = false;
  try {
    await down.persist();
  } catch (err: any) {
    notReady = err.code === 'NOT_READY';
  }
  assert(notReady, 'ممنوع الحفظ قبل الجاهزية');
  down.stop();

  // إعدادات البيئة
  assert(readPersistenceEnv({}).enabled === false, 'بدون متغيرات = غير مفعّل');
  assert(readPersistenceEnv({ SUPABASE_URL: 'https://x.supabase.co' }).problem !== null, 'متغير واحد فقط = مشكلة');
  const okEnv = readPersistenceEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k' });
  assert(okEnv.enabled && !okEnv.problem && okEnv.tenant === 'main', 'القيمة الافتراضية للشركة main');
  assert(readPersistenceEnv({ SUPABASE_URL: 'https://x', SUPABASE_SECRET_KEY: 'k', SUPABASE_TENANT_ID: 'a b' }).problem !== null, 'اسم شركة غير صالح');
  console.log('✅ محاكاة الأعطال: نجح');
}

async function main() {
  const fake = createFakeTransport();
  await runSuite('الناقل الوهمي', fake.transport, 'test_unit', async () => {
    await fake.transport('app_reset_test_tenant', { p_tenant: 'test_unit' });
  });
  await runFailureTests();

  const env = readPersistenceEnv();
  if (env.enabled && !env.problem) {
    const real = createSupabaseTransport({ url: env.url, secretKey: env.secretKey, restUrl: env.restUrl || undefined });
    const tenant = `test_engine_${Date.now().toString(36)}`;
    await runSuite('قاعدة البيانات الحقيقية (شركة اختبار معزولة)', real, tenant, async () => {
      await real('app_reset_test_tenant', { p_tenant: tenant });
    });
  } else {
    console.log('\nℹ️ لم تُضبط متغيرات Supabase — تم تخطي اختبار قاعدة البيانات الحقيقية.');
  }
  console.log(`\n🎉 كل اختبارات محرّك الحفظ نجحت (${passed} تحققًا).`);
}

main().catch(err => {
  console.error('❌', err?.message || err);
  process.exit(1);
});

import {
  loginUser,
  saveUser,
  getUsers,
  updateUserPermissions,
  syncOfflineOperation,
  getAuditLogs,
  saveItem,
  getCashboxes,
  OFFLINE_PBKDF2_ITERATIONS,
  computeOfflinePasswordVerifier
} from '../server/sheetsService';
import {
  saveOfflineSnapshot,
  loadOfflineSnapshot,
  getOrCreateDeviceUsersCryptoKey,
  getEncryptedUsersRawFromOfflineStore,
  getDecryptedOfflineUsers,
  computeBrowserOfflineVerifier,
  authenticateOfflineUser,
  recordOfflineAuthEventInOutbox,
  updateOfflineUserPermissionsInDb,
  createOfflineInvoiceInDb,
  getOutboxOperations,
  getOutboxPendingCount,
  syncOutboxOperations,
  getMetaValue
} from '../src/offline/db';
import { UserAccount } from '../src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ فشل الاختبار: ${message}`);
  }
}

// محاكاة IndexedDB في بيئة Node.js مع دعم تخزين كائنات CryptoKey غير القابلة للاستخراج
function setupMockIndexedDB() {
  const stores = new Map<string, { keyPath: string; records: Map<string, any> }>();

  function clonePreservingCryptoKey(val: any): any {
    if (val === null || val === undefined || typeof val !== 'object') return val;
    if (typeof CryptoKey !== 'undefined' && val instanceof CryptoKey) return val;
    if ('type' in val && 'extractable' in val && 'algorithm' in val && 'usages' in val) {
      return val;
    }
    if (Array.isArray(val)) {
      return val.map(item => clonePreservingCryptoKey(item));
    }
    const copy: any = {};
    for (const [k, v] of Object.entries(val)) {
      copy[k] = clonePreservingCryptoKey(v);
    }
    return copy;
  }

  function makeRequest<T>(executor: () => T): any {
    const req: any = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null
    };
    queueMicrotask(() => {
      try {
        req.result = executor();
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      } catch (err) {
        req.error = err;
        if (typeof req.onerror === 'function') req.onerror({ target: req });
      }
    });
    return req;
  }

  const dbObj: any = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name)
    },
    createObjectStore: (name: string, opts: { keyPath: string }) => {
      const storeData = { keyPath: opts.keyPath, records: new Map<string, any>() };
      stores.set(name, storeData);
      return {
        createIndex: () => {}
      };
    },
    transaction: (_storeNames: string[], _mode?: string, _opts?: any) => {
      const tx: any = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore: (name: string) => {
          const s = stores.get(name)!;
          return {
            get: (key: string) =>
              makeRequest(() => {
                const v = s.records.get(String(key));
                return v !== undefined ? clonePreservingCryptoKey(v) : undefined;
              }),
            getAll: (filterVal?: string) =>
              makeRequest(() => {
                const all = Array.from(s.records.values()).map(v => clonePreservingCryptoKey(v));
                if (filterVal !== undefined) {
                  return all.filter(item => item.status === filterVal);
                }
                return all;
              }),
            put: (val: any) =>
              makeRequest(() => {
                const k = String(val[s.keyPath]);
                s.records.set(k, clonePreservingCryptoKey(val));
                return k;
              }),
            delete: (key: string) =>
              makeRequest(() => {
                s.records.delete(String(key));
                return undefined;
              }),
            clear: () =>
              makeRequest(() => {
                s.records.clear();
                return undefined;
              }),
            index: (idxName: string) => ({
              getAll: (val?: string) =>
                makeRequest(() => {
                  const all = Array.from(s.records.values()).map(v => clonePreservingCryptoKey(v));
                  if (val !== undefined) {
                    return all.filter(item => item[idxName] === val);
                  }
                  return all;
                })
            })
          };
        }
      };
      setTimeout(() => {
        if (typeof tx.oncomplete === 'function') tx.oncomplete();
      }, 5);
      return tx;
    },
    close: () => {}
  };

  (globalThis as any).indexedDB = {
    open: (_name: string, _version: number) => {
      const req: any = {
        result: dbObj,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null
      };
      queueMicrotask(() => {
        if (stores.size === 0 && typeof req.onupgradeneeded === 'function') {
          req.onupgradeneeded();
        }
        if (typeof req.onsuccess === 'function') {
          req.onsuccess();
        }
      });
      return req;
    }
  };
}

async function runTests() {
  console.log('=== بدء اختبارات المهمة 12: تسجيل الدخول والخروج وتعديل الصلاحيات بدون إنترنت ===\n');

  setupMockIndexedDB();

  const ownerSession = {
    role: 'designer' as const,
    permissions: [] as any[],
    phone: '01000000000',
    userId: 'u-designer',
    name: 'مالك النظام'
  };

  // =========================================================================
  // 1) اختبار بصمة التحقق أوفلاين (PBKDF2-SHA256 بـ 200,000 دورة و salt عشوائي)
  // =========================================================================
  console.log('1) اختبار: حساب بصمة PBKDF2-SHA256 (200,000 دورة) عند الإنشاء والدخول وتطابق الخادم مع المتصفح...');

  const verifierCheck = computeOfflinePasswordVerifier('SecretPass#2026');
  assert(verifierCheck.offlineIterations === 200000, 'عدد دورات PBKDF2 يجب أن يكون 200,000');
  assert(verifierCheck.offlineSalt.length >= 32, 'يجب توليد salt عشوائي فريد');
  assert(verifierCheck.offlineVerifier.length === 64, 'طول بصمة SHA-256 بالـ hex يجب أن يكون 64 حرفًا');

  const browserComputed = await computeBrowserOfflineVerifier(
    'SecretPass#2026',
    verifierCheck.offlineSalt,
    verifierCheck.offlineIterations
  );
  assert(
    browserComputed === verifierCheck.offlineVerifier,
    'بصمة المتصفح WebCrypto يجب أن تطابق بصمة الخادم تمامًا'
  );

  // إنشاء مدير مفوض يملك صلاحية تعديل الصلاحيات، وموظف كاشير، ومستخدم قديم بدون بصمة
  const managerUsername = `mgr_off_${Date.now()}`;
  const cashierUsername = `cash_off_${Date.now()}`;
  const noVerifierUsername = `nover_off_${Date.now()}`;

  const mgrSaveRes = await saveUser(
    {
      name: 'مدير الصلاحيات',
      username: managerUsername,
      phone: `01011${String(Date.now()).slice(-6)}`,
      password: 'ManagerPassword!1',
      role: 'manager',
      status: 'active',
      permissions: ['permissions.view', 'permissions.manage', 'users.view', 'sales.create', 'products.view', 'sales.collect_credit']
    },
    ownerSession
  );
  assert(mgrSaveRes.success && Boolean(mgrSaveRes.user), 'فشل إنشاء حساب المدير');

  const cashSaveRes = await saveUser(
    {
      name: 'كاشير الفرع',
      username: cashierUsername,
      phone: `01022${String(Date.now()).slice(-6)}`,
      password: 'CashierPassword!1',
      role: 'employee',
      status: 'active',
      permissions: ['sales.create', 'products.view'],
      cashboxConfig: {
        allowedCashboxIds: ['cb-main'],
        defaultCashboxId: 'cb-main',
        allowChangeInPOS: false
      }
    },
    ownerSession
  );
  assert(cashSaveRes.success && Boolean(cashSaveRes.user), 'فشل إنشاء حساب الكاشير');

  const allUsersFromServer = await getUsers();
  const savedMgr = allUsersFromServer.find(u => u.username === managerUsername)!;
  const savedCashier = allUsersFromServer.find(u => u.username === cashierUsername)!;

  assert(
    Boolean(savedMgr.offlineVerifier && savedMgr.offlineSalt && savedMgr.offlineIterations === OFFLINE_PBKDF2_ITERATIONS),
    'يجب حفظ offlineVerifier و offlineSalt و offlineIterations عند إنشاء المستخدم'
  );
  assert(!('password' in savedMgr), 'كلمة السر نفسها لا يجوز أن تُخزَّن أو تُعاد أبدًا');

  // إضافة مستخدم بدون بصمة لاختبار منعه من الدخول أوفلاين بالرسالة المطلوبة نصًا
  const userWithoutVerifier: UserAccount = {
    id: `u-nover-${Date.now()}`,
    name: 'مستخدم لم يسجل دخول أونلاين',
    username: noVerifierUsername,
    phone: '01099000111',
    role: 'employee',
    status: 'active',
    permissions: ['sales.create'],
    offlineVerifier: '',
    offlineSalt: ''
  };

  console.log('   ✅ نجح: توليد وحفظ بصمة PBKDF2-SHA256 (200,000 دورة) بدون حفظ كلمة السر.');

  // =========================================================================
  // 2) اختبار تنزيل كل المستخدمين وتشفيرهم بـ AES-GCM بمفتاح جهاز غير قابل للاستخراج (extractable=false)
  // =========================================================================
  console.log('2) اختبار: تشفير المستخدمين بـ AES-GCM بمفتاح جهاز CryptoKey (extractable=false) في مخزن users...');

  const usersToStore = [...allUsersFromServer, userWithoutVerifier];
  await saveOfflineSnapshot({
    user: savedMgr,
    users: usersToStore
  });

  const deviceKey = await getOrCreateDeviceUsersCryptoKey();
  assert(deviceKey.extractable === false, 'مفتاح تشفير الجهاز CryptoKey يجب أن يكون extractable: false');
  const storedKeyInMeta = await getMetaValue<CryptoKey>('deviceUsersCryptoKey');
  assert(Boolean(storedKeyInMeta && storedKeyInMeta.extractable === false), 'المفتاح المحفوظ في IndexedDB meta يجب أن يكون extractable: false');

  const rawEncryptedRecords = await getEncryptedUsersRawFromOfflineStore();
  assert(rawEncryptedRecords.length >= 3, 'يجب تخزين جميع المستخدمين في مخزن users');
  for (const encRec of rawEncryptedRecords) {
    assert(encRec.encrypted === true && encRec.algorithm === 'AES-GCM', 'كل سجل في مخزن users يجب أن يكون مشفرًا بـ AES-GCM');
    assert(Boolean(encRec.ivHex && encRec.ciphertextHex), 'يجب وجود ivHex و ciphertextHex لكل مستخدم مشفر');
    assert(!('name' in encRec) && !('offlineVerifier' in encRec) && !('password' in encRec), 'لا يجوز وجود بيانات نصية مكشوفة في السجل المشفر');
  }

  const decryptedUsers = await getDecryptedOfflineUsers();
  const decCashier = decryptedUsers.find(u => u.id === savedCashier.id)!;
  assert(Boolean(decCashier), 'يجب فك تشفير المستخدمين بنجاح');
  assert(decCashier.name === 'كاشير الفرع' && decCashier.role === 'employee', 'يجب استرجاع الاسم والدور بعد فك التشفير');
  assert(decCashier.cashboxConfig?.defaultCashboxId === 'cb-main', 'يجب استرجاع إعدادات الخزن بعد فك التشفير');
  assert(decCashier.offlineVerifier === savedCashier.offlineVerifier, 'يجب استرجاع البصمة بعد فك التشفير');

  console.log('   ✅ نجح: تخزين جميع المستخدمين مشفرين بـ AES-GCM بمفتاح جهاز غير قابل للاستخراج (extractable=false).');

  // =========================================================================
  // 3) اختبار منع المستخدم الذي لا يملك بصمة من الدخول أوفلاين بالرسالة المطلوبة نصًا
  // =========================================================================
  console.log('3) اختبار: منع المستخدم الذي لا يملك بصمة من الدخول أوفلاين...');

  const noVerAuth = await authenticateOfflineUser(noVerifierUsername, 'AnyPassword123');
  assert(noVerAuth.success === false, 'يجب رفض دخول المستخدم الذي لا يملك بصمة أوفلاين');
  assert(
    noVerAuth.error === 'سجّل الدخول مرة واحدة مع وجود الإنترنت أولًا',
    `الرسالة غير مطابقة للمطلوب، الفعلي: ${noVerAuth.error}`
  );
  console.log(`   ✅ نجح: ظهرت الرسالة المطلوبة نصًا: «${noVerAuth.error}».`);

  // =========================================================================
  // 4) اختبار الدخول أوفلاين، عدم القفل بعد المحاولات الفاشلة، والجلسة offline:true، وتسجيل الدخول والخروج في outbox
  // =========================================================================
  console.log('4) اختبار: عدم القفل بعد المحاولات الفاشلة أوفلاين، وجلسة offline:true، وتسجيل الدخول والخروج في outbox...');

  for (let attempt = 1; attempt <= 8; attempt++) {
    const wrongAttempt = await authenticateOfflineUser(cashierUsername, `WrongPass_${attempt}`);
    assert(wrongAttempt.success === false, 'يجب رفض كلمة المرور الخاطئة أوفلاين');
  }

  // المحاولة الصحيحة بعد 8 محاولات فاشلة يجب أن تنجح فورًا (لا قفل أوفلاين)
  const rightAttempt = await authenticateOfflineUser(cashierUsername, 'CashierPassword!1');
  assert(rightAttempt.success === true, 'لا يجوز قفل الحساب بعد المحاولات الفاشلة أوفلاين');
  if (rightAttempt.success) {
    assert(rightAttempt.session.offline === true, 'الجلسة أوفلاين يجب أن تحمل offline: true');
    assert(
      Array.isArray(rightAttempt.session.user.permissions) &&
        rightAttempt.session.user.permissions.includes('sales.create'),
      'الجلسة أوفلاين يجب أن تعمل بصلاحيات النسخة المحلية'
    );
  }

  // تسجيل الخروج أوفلاين
  await recordOfflineAuthEventInOutbox({
    action: 'OFFLINE_LOGOUT',
    user: savedCashier
  });

  const outboxAfterAuth = await getOutboxOperations();
  const loginEventOp = outboxAfterAuth.find(op => op.type === 'authAudit' && op.operationType === 'OFFLINE_LOGIN');
  const logoutEventOp = outboxAfterAuth.find(op => op.type === 'authAudit' && op.operationType === 'OFFLINE_LOGOUT');
  assert(Boolean(loginEventOp), 'يجب حفظ حدث الدخول أوفلاين (OFFLINE_LOGIN) في outbox');
  assert(Boolean(logoutEventOp), 'يجب حفظ حدث الخروج أوفلاين (OFFLINE_LOGOUT) في outbox');

  console.log('   ✅ نجح: الدخول أوفلاين يعمل بدون قفل، والجلسة تحمل offline:true، والدخول والخروج محفوظان في outbox.');

  // =========================================================================
  // 5) اختبار تعديل الصلاحيات أوفلاين وحسم التعارض عند المزامنة
  // =========================================================================
  console.log('5) اختبار: تعديل الصلاحيات أوفلاين وتطبيقه فورًا وحسم التعارض (الأحدث يفوز + تسجيل تعارض للمالك)...');

  // الكاشير الذي لا يملك permissions.manage يُمنع من تعديل الصلاحيات أوفلاين
  let unauthorizedBlocked = false;
  try {
    await updateOfflineUserPermissionsInDb({
      targetUserId: savedCashier.id,
      permissions: ['sales.create', 'reports.view'],
      actor: savedCashier
    });
  } catch (_) {
    unauthorizedBlocked = true;
  }
  assert(unauthorizedBlocked, 'يجب منع من لا يملك صلاحية تعديل الصلاحيات من التعديل أوفلاين');

  // المدير الذي يملك permissions.manage يعدل صلاحيات الكاشير أوفلاين في وقت T2 (أحدث)
  const t1Iso = new Date(Date.now() - 60000).toISOString();
  const t2Iso = new Date(Date.now() + 5000).toISOString();

  // جهاز ثانٍ (DEVICE-SECOND) عدّل صلاحيات نفس الكاشير على الخادم في وقت T1 (أقدم من T2)
  const secondDeviceSyncRes = await syncOfflineOperation(
    {
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      type: 'updatePermissions',
      operationType: 'updateUserPermissions',
      deviceId: 'DEVICE-SECOND',
      deviceName: 'جهاز الفرع الثاني',
      deviceTime: t1Iso,
      payload: {
        targetUserId: savedCashier.id,
        permissions: ['sales.create'],
        editedAt: t1Iso
      }
    },
    ownerSession
  );
  assert(secondDeviceSyncRes.success === true, 'فشل تسجيل تعديل الجهاز الثاني على الخادم');

  // الجهاز الأول يعدل صلاحيات الكاشير أوفلاين في وقت T2 (أحدث من T1)
  const offlinePermEdit = await updateOfflineUserPermissionsInDb({
    targetUserId: savedCashier.id,
    permissions: ['sales.create', 'products.view', 'sales.collect_credit'],
    actor: savedMgr,
    editedAt: t2Iso
  });
  assert(offlinePermEdit.success === true, 'يجب نجاح تعديل الصلاحيات أوفلاين لمن يملك الصلاحية');

  // التحقق من تطبيقه على الجهاز فورًا
  const localUsersAfterEdit = await getDecryptedOfflineUsers();
  const localCashierAfterEdit = localUsersAfterEdit.find(u => u.id === savedCashier.id)!;
  assert(
    Boolean(localCashierAfterEdit.permissions?.includes('sales.collect_credit')),
    'تعديل الصلاحيات أوفلاين يجب أن يُطبَّق على الجهاز فورًا'
  );

  // الآن نرفع كل عمليات outbox (بما فيها OFFLINE_LOGIN و OFFLINE_LOGOUT و updatePermissions) إلى الخادم
  const syncResult = await syncOutboxOperations({
    user: savedMgr,
    sender: payload => syncOfflineOperation(payload, ownerSession),
    skipSnapshotRefresh: true,
    disableAutoRetrySchedule: true
  });
  assert(syncResult.success === true, `فشل رفع عمليات outbox: ${syncResult.lastError}`);

  // التحقق من رفع أحداث الدخول والخروج وتعديل الصلاحيات وحسم التعارض في سجل التدقيق
  const usersAfterSync = await getUsers();
  const serverCashierAfterSync = usersAfterSync.find(u => u.id === savedCashier.id)!;
  assert(
    Boolean(serverCashierAfterSync.permissions?.includes('sales.collect_credit')),
    'التعديل الأحدث (T2) يجب أن يفوز عند المزامنة'
  );

  // لو أرسل جهاز ثالث تعديلًا بوقت أقدم T0 (أقدم من T2)، يجب أن يفوز T2 ويُسجل تعارض أيضًا
  const t0Iso = new Date(Date.now() - 120000).toISOString();
  const olderDeviceSyncRes = await syncOfflineOperation(
    {
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      type: 'updatePermissions',
      operationType: 'updateUserPermissions',
      deviceId: 'DEVICE-THIRD',
      deviceName: 'جهاز ثالث',
      deviceTime: t0Iso,
      payload: {
        targetUserId: savedCashier.id,
        permissions: ['products.view'],
        editedAt: t0Iso
      }
    },
    ownerSession
  );
  assert(olderDeviceSyncRes.success === true, 'يجب معالجة تعديل الجهاز الثالث بدون خطأ');
  assert((olderDeviceSyncRes as any).conflictDetected === true && (olderDeviceSyncRes as any).appliedIncoming === false, 'يجب رفض تطبيق التعديل الأقدم مع تسجيل التعارض');

  const usersAfterOlderSync = await getUsers();
  const cashierStillHasNewerPerms = usersAfterOlderSync.find(u => u.id === savedCashier.id)!;
  assert(
    Boolean(cashierStillHasNewerPerms.permissions?.includes('sales.collect_credit')),
    'صلاحيات التعديل الأحدث يجب أن تبقى محفوظة ولا تُستبدل بتعديل أقدم'
  );

  const auditLogs = await getAuditLogs();
  const hasOfflineLoginAudit = auditLogs.some(l => l.action === 'OFFLINE_LOGIN');
  const hasOfflineLogoutAudit = auditLogs.some(l => l.action === 'OFFLINE_LOGOUT');
  const hasConflictAudit = auditLogs.some(l => l.action === 'PERMISSIONS_SYNC_CONFLICT');
  assert(hasOfflineLoginAudit, 'يجب وجود حدث OFFLINE_LOGIN في سجل التدقيق بعد المزامنة');
  assert(hasOfflineLogoutAudit, 'يجب وجود حدث OFFLINE_LOGOUT في سجل التدقيق بعد المزامنة');
  assert(hasConflictAudit, 'يجب تسجيل تعارض (PERMISSIONS_SYNC_CONFLICT) للمالك في سجل التدقيق عند تعديل نفس المستخدم من جهازين');

  console.log('   ✅ نجح: تطبيق الصلاحيات محليًا فورًا، فوز التعديل الأحدث، وتسجيل التعارض والأحداث في سجل التدقيق.');

  // =========================================================================
  // 6) اختبار مستخدم أُوقف أو تغيرت كلمة سره يُحدَّث على الجهاز عند أول اتصال
  // =========================================================================
  console.log('6) اختبار: تحديث المستخدم الذي أُوقف أو تغيرت كلمة سره على الجهاز عند أول اتصال...');

  // تغيير كلمة سر المدير وإيقاف الكاشير على الخادم
  await saveUser(
    {
      id: savedMgr.id,
      name: savedMgr.name,
      username: savedMgr.username,
      phone: savedMgr.phone,
      password: 'NewManagerPassword!99',
      role: savedMgr.role,
      status: 'active',
      permissions: savedMgr.permissions
    },
    ownerSession
  );

  await saveUser(
    {
      id: savedCashier.id,
      name: savedCashier.name,
      username: savedCashier.username,
      phone: savedCashier.phone,
      role: savedCashier.role,
      status: 'inactive',
      permissions: savedCashier.permissions
    },
    ownerSession
  );

  // عند أول اتصال يتم تحديث نسخة الجهاز (saveOfflineSnapshot)
  const updatedServerUsers = await getUsers();
  await saveOfflineSnapshot({
    user: updatedServerUsers.find(u => u.id === savedMgr.id)!,
    users: updatedServerUsers
  });

  // الكاشير الموقوف لا يستطيع الدخول أوفلاين بعد التحديث
  const suspendedAuth = await authenticateOfflineUser(cashierUsername, 'CashierPassword!1');
  assert(suspendedAuth.success === false, 'المستخدم الموقوف يجب أن يُمنع من الدخول أوفلاين بعد تحديث الجهاز');

  // المدير لا يستطيع الدخول بكلمة السر القديمة أوفلاين، ويستطيع الدخول بكلمة السر الجديدة
  const oldPassAuth = await authenticateOfflineUser(managerUsername, 'ManagerPassword!1');
  assert(oldPassAuth.success === false, 'كلمة السر القديمة يجب أن ترفض بعد تحديث البصمة على الجهاز');
  const newPassAuth = await authenticateOfflineUser(managerUsername, 'NewManagerPassword!99');
  assert(newPassAuth.success === true, 'كلمة السر الجديدة يجب أن تعمل أوفلاين بعد تحديث الجهاز');

  // تنظيف حدث الدخول من outbox قبل الاختبار الأخير
  await syncOutboxOperations({
    user: savedMgr,
    sender: payload => syncOfflineOperation(payload, ownerSession),
    skipSnapshotRefresh: true,
    disableAutoRetrySchedule: true
  });

  console.log('   ✅ نجح: تحديث المستخدم الموقوف أو الذي تغيرت كلمة سره على الجهاز عند أول اتصال.');

  // =========================================================================
  // 7) اختبار انتهاء رمز الجلسة أوفلاين لا يوقف البيع، وعند رجوع الاتصال يُطلب دخول جديد ثم تُرفع العمليات المعلّقة
  // =========================================================================
  console.log('7) اختبار: انتهاء رمز الجلسة أوفلاين لا يوقف البيع، ورفع العمليات المعلّقة بعد تسجيل الدخول الجديد...');

  const itemRes = await saveItem(
    {
      name: `صنف اختبار جلسة أوفلاين ${Date.now()}`,
      barcode: `BC-AUTH-${Date.now()}`,
      salePrice: 150,
      purchasePrice: 100,
      packagingCost: 0,
      stockQuantity: 20,
      taxRate: 0,
      status: 'نشط'
    },
    ownerSession
  );
  const testItem = itemRes.item!;

  const cashboxes = await getCashboxes();
  const mainCashbox = cashboxes[0];

  await saveOfflineSnapshot({
    user: savedMgr,
    items: [testItem],
    cashboxes,
    users: updatedServerUsers
  });

  // إنشاء فاتورة بيع أوفلاين أثناء انتهاء صلاحية الجلسة (لا يتوقف البيع)
  const expiredSessionOfflineSale = await createOfflineInvoiceInDb({
    user: savedMgr,
    fallbackItems: [testItem],
    fallbackCashboxes: cashboxes,
    invoicePayload: {
      idempotencyKey: crypto.randomUUID(),
      platformId: 'direct',
      platform: 'البيع المباشر',
      paymentType: 'نقدي',
      cashboxId: mainCashbox.id,
      lines: [
        {
          itemId: testItem.id,
          itemNameAtSale: testItem.name,
          quantity: 2,
          salePriceAtSale: 150,
          baseUnitPrice: 150
        }
      ]
    }
  });
  assert(Boolean(expiredSessionOfflineSale.invoice), 'انتهاء رمز الجلسة أوفلاين لا يجوز أن يوقف البيع');

  // عند رجوع الاتصال قبل تسجيل الدخول الجديد، إذا أعاد الخادم 401 تبقى العملية معلّقة في outbox ولا تضيع
  const syncWithExpiredToken = await syncOutboxOperations({
    user: savedMgr,
    sender: async () => {
      const err: any = new Error('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا');
      err.status = 401;
      throw err;
    },
    skipSnapshotRefresh: true,
    disableAutoRetrySchedule: true
  });
  assert(syncWithExpiredToken.remainingCount > 0, 'يجب الاحتفاظ بالعملية المعلّقة في outbox عند انتهاء الجلسة');

  // بعد تسجيل الدخول الجديد أونلاين، تُرفع العمليات المعلّقة بنجاح
  const reLoginRes = await loginUser(managerUsername, 'NewManagerPassword!99');
  assert(reLoginRes.success === true && Boolean(reLoginRes.user), 'فشل تسجيل الدخول الجديد أونلاين');

  const syncAfterReLogin = await syncOutboxOperations({
    user: reLoginRes.user!,
    sender: payload => syncOfflineOperation(payload, ownerSession),
    skipSnapshotRefresh: true,
    disableAutoRetrySchedule: true
  });
  assert(
    syncAfterReLogin.success === true && syncAfterReLogin.remainingCount === 0,
    'يجب رفع جميع العمليات المعلّقة بنجاح فور تسجيل الدخول الجديد'
  );
  assert(
    syncAfterReLogin.syncedInvoices.length === 1,
    'يجب رفع الفاتورة التي أُنشئت أثناء انتهاء الجلسة أوفلاين'
  );

  console.log('   ✅ نجح: البيع يستمر أوفلاين رغم انتهاء الجلسة، وتُرفع العمليات المعلّقة فور تسجيل الدخول الجديد.');
  console.log('\n🎉 اكتملت جميع اختبارات المهمة 12 بنجاح تام!');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

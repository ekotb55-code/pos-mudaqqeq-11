process.env.SKIP_SERVER_LISTEN = '1';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { getSystemConfig, setAppsScriptUrl, INITIAL_USER_PASSWORD } from '../server/config.ts';
import { getStoredUserById } from '../server/sheetsService.ts';
import { ALL_PERMISSIONS } from '../src/utils/permissions.ts';

const MOCK_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzMockSheetsMustChangePasswordVerify1234567890abcdef/exec';

interface SimSheetUser {
  id: string;
  username: string;
  name: string;
  phone: string;
  role: 'designer' | 'manager' | 'employee';
  status: 'active' | 'inactive';
  password: string;
  mustChangePassword: boolean;
  permissions: string[];
  isOwner: boolean;
}

async function runTests() {
  console.log('=== بدء اختبار التحقق من mustChangePassword في وضع sheets ووضع الذاكرة ===\n');

  const originalFetch = globalThis.fetch.bind(globalThis);

  // حالة محاكاة مستخدمي Google Sheets (Code.gs)
  const sheetUser: SimSheetUser = {
    id: 'usr-admin-001',
    username: 'admin',
    name: 'مالك النظام بالشيت',
    phone: '01000000001',
    role: 'designer',
    status: 'active',
    password: INITIAL_USER_PASSWORD,
    mustChangePassword: true,
    permissions: ALL_PERMISSIONS.map(p => p.key),
    isOwner: true
  };

  let sheetTokenCounter = 0;
  const sheetSessions = new Map<string, string>();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr === MOCK_APPS_SCRIPT_URL) {
      const rawBody = typeof init?.body === 'string' ? init.body : '{}';
      const reqBody = JSON.parse(rawBody);
      const { action, payload, token } = reqBody;

      const jsonRes = (obj: unknown) =>
        new Response(JSON.stringify(obj), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

      if (action === 'login') {
        const inputUser = String(payload?.username || '').trim().toLowerCase();
        const inputPass = String(payload?.password || '');
        if (inputUser !== sheetUser.username.toLowerCase() || inputPass !== sheetUser.password) {
          return jsonRes({ success: false, error: 'بيانات الدخول غير صحيحة في الشيت' });
        }
        if (sheetUser.status !== 'active') {
          return jsonRes({ success: false, error: 'هذا الحساب موقوف' });
        }
        sheetTokenCounter += 1;
        const newToken = `sheets-tok-${sheetTokenCounter}`;
        sheetSessions.set(newToken, sheetUser.id);
        return jsonRes({
          success: true,
          token: newToken,
          user: {
            id: sheetUser.id,
            username: sheetUser.username,
            name: sheetUser.name,
            phone: sheetUser.phone,
            role: sheetUser.role,
            status: sheetUser.status,
            permissions: sheetUser.permissions,
            isOwner: sheetUser.isOwner,
            mustChangePassword: sheetUser.mustChangePassword
          }
        });
      }

      if (action === 'completeInitialAccountSetup') {
        if (!token || !sheetSessions.has(token)) {
          return jsonRes({ success: false, expired: true, error: 'جلسة غير صالحة' });
        }
        sheetUser.name = String(payload?.name || sheetUser.name).trim();
        sheetUser.username = String(payload?.username || sheetUser.username).trim();
        sheetUser.password = String(payload?.newPassword || sheetUser.password);
        sheetUser.mustChangePassword = false;
        return jsonRes({
          success: true,
          user: {
            id: sheetUser.id,
            username: sheetUser.username,
            name: sheetUser.name,
            phone: sheetUser.phone,
            role: sheetUser.role,
            status: sheetUser.status,
            permissions: sheetUser.permissions,
            isOwner: sheetUser.isOwner,
            mustChangePassword: false
          }
        });
      }

      if (action === 'getItems') {
        if (!token || !sheetSessions.has(token)) {
          return jsonRes({ success: false, expired: true, error: 'جلسة غير صالحة' });
        }
        if (sheetUser.status !== 'active') {
          return jsonRes({ success: false, expired: true, error: 'تم إيقاف الحساب' });
        }
        if (sheetUser.mustChangePassword) {
          return jsonRes({
            success: false,
            code: 'MUST_CHANGE_PASSWORD',
            error: 'يرجى تغيير كلمة السر المؤقتة أولاً'
          });
        }
        return jsonRes({
          success: true,
          data: [
            {
              id: 'item-sheet-1',
              name: 'صنف اختبار الشيت',
              barcode: 'SH-001',
              salePrice: 100,
              stockQuantity: 10,
              status: 'نشط'
            }
          ]
        });
      }

      if (action === 'logout') {
        if (token) sheetSessions.delete(token);
        return jsonRes({ success: true });
      }

      return jsonRes({ success: true, data: [] });
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  const { createServerApp } = await import('../server.ts');
  const { app } = await createServerApp({ attachVite: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function requestJson(path: string, options: RequestInit = {}, token?: string) {
    const res = await originalFetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  try {
    // التحقق أن مستخدم الذاكرة usr-admin-001 علامته true قبل الاختبار
    const memAdminBefore = getStoredUserById('usr-admin-001');
    assert.ok(memAdminBefore, 'يجب وجود المستخدم الافتراضي usr-admin-001 في الذاكرة');
    assert.equal(
      Boolean(memAdminBefore.mustChangePassword),
      true,
      'مستخدم الذاكرة usr-admin-001 يجب أن يبدأ بـ mustChangePassword = true'
    );

    // =========================================================================
    // (أ) وضع sheets: دخول بـ usr-admin-001 وعلامته true -> إعداد الحساب -> GET /api/items يرجع 200
    // =========================================================================
    setAppsScriptUrl(MOCK_APPS_SCRIPT_URL);
    assert.equal(getSystemConfig().dataMode, 'sheets', 'يجب أن يكون الوضع الحالي sheets');

    const loginA = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: INITIAL_USER_PASSWORD })
    });
    assert.equal(loginA.status, 200, 'فشل تسجيل الدخول في وضع sheets');
    assert.equal(loginA.data.success, true);
    assert.equal(loginA.data.user.id, 'usr-admin-001');
    assert.equal(loginA.data.user.mustChangePassword, true, 'يجب أن تأتي العلامة true من رد Code.gs');
    const tokenA = loginA.data.token as string;
    assert.ok(tokenA, 'يجب إرجاع رمز الجلسة');

    // قبل استكمال الإعداد يجب رفض GET /api/items بـ 403
    const itemsBeforeSetup = await requestJson('/api/items', { method: 'GET' }, tokenA);
    assert.equal(itemsBeforeSetup.status, 403, 'قبل استكمال الإعداد يجب أن يرجع 403');
    assert.equal(itemsBeforeSetup.data.code, 'MUST_CHANGE_PASSWORD');

    // استكمال إعداد الحساب وتغيير كلمة السر المؤقتة
    const setupRes = await requestJson(
      '/api/auth/complete-initial-setup',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'مالك الشيت المحدث',
          username: 'sheet_owner',
          newPassword: 'NewSheetPass@2026'
        })
      },
      tokenA
    );
    assert.equal(setupRes.status, 200, 'يجب نجاح complete-initial-setup');
    assert.equal(setupRes.data.success, true);
    assert.equal(setupRes.data.user.mustChangePassword, false);

    // التحقق أن GET /api/items بعد الإعداد يرجع 200 وليس 403
    const itemsAfterSetup = await requestJson('/api/items', { method: 'GET' }, tokenA);
    assert.equal(
      itemsAfterSetup.status,
      200,
      `بعد استكمال الإعداد يجب أن يرجع GET /api/items الحالة 200 وليس 403، الفعلي: ${itemsAfterSetup.status} (${itemsAfterSetup.data?.error || ''})`
    );
    assert.equal(itemsAfterSetup.data.success, true);
    assert.equal(itemsAfterSetup.data.items.length, 1);

    const meAfterSetup = await requestJson('/api/auth/me', { method: 'GET' }, tokenA);
    assert.equal(meAfterSetup.status, 200);
    assert.equal(meAfterSetup.data.user.mustChangePassword, false);

    // التأكد أن مستخدم الذاكرة usr-admin-001 لم يتلوث وظلّ في الذاكرة كما هو (true)
    assert.equal(
      Boolean(getStoredUserById('usr-admin-001')?.mustChangePassword),
      true,
      'مستخدم الذاكرة usr-admin-001 ما زال true ولم يفسد الجلسة في وضع sheets'
    );
    console.log('✅ (أ) نجح: في وضع sheets بعد complete-initial-setup، GET /api/items رجع 200 وليس 403.');

    // =========================================================================
    // (ب) وضع sheets: دخول جديد بعد الإعداد (Code.gs يرجع false) -> لا يوجد 403
    // =========================================================================
    const loginB = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'sheet_owner', password: 'NewSheetPass@2026' })
    });
    assert.equal(loginB.status, 200, 'فشل تسجيل الدخول الجديد في وضع sheets');
    assert.equal(loginB.data.success, true);
    assert.equal(loginB.data.user.id, 'usr-admin-001');
    assert.equal(loginB.data.user.mustChangePassword, false, 'يجب أن يأخذ الدخول mustChangePassword=false من رد Code.gs');
    const tokenB = loginB.data.token as string;

    const itemsFreshLogin = await requestJson('/api/items', { method: 'GET' }, tokenB);
    assert.equal(
      itemsFreshLogin.status,
      200,
      `بعد دخول جديد والعلامة false يجب أن يرجع 200 وليس 403، الفعلي: ${itemsFreshLogin.status}`
    );
    assert.equal(itemsFreshLogin.data.success, true);

    const meFreshLogin = await requestJson('/api/auth/me', { method: 'GET' }, tokenB);
    assert.equal(meFreshLogin.status, 200);
    assert.equal(meFreshLogin.data.user.mustChangePassword, false);
    console.log('✅ (ب) نجح: دخول جديد في وضع sheets أخذ mustChangePassword=false من Code.gs ولم يرجع 403.');

    // =========================================================================
    // (ج) وضع الذاكرة: التحقق أن السلوك الحالي لم يتغير
    // =========================================================================
    setAppsScriptUrl('');
    assert.equal(getSystemConfig().dataMode, 'memory', 'يجب التحويل إلى وضع الذاكرة');

    const memLogin = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: INITIAL_USER_PASSWORD })
    });
    assert.equal(memLogin.status, 200, 'فشل الدخول في وضع الذاكرة');
    assert.equal(memLogin.data.user.mustChangePassword, true, 'في وضع الذاكرة يجب أن يبدأ admin بـ mustChangePassword=true');
    const memToken = memLogin.data.token as string;

    // قبل الإعداد في وضع الذاكرة -> 403
    const memItemsBlocked = await requestJson('/api/items', { method: 'GET' }, memToken);
    assert.equal(memItemsBlocked.status, 403, 'في وضع الذاكرة يجب منع الوصول قبل تغيير كلمة السر المؤقتة');

    // استكمال الإعداد في وضع الذاكرة
    const memSetup = await requestJson(
      '/api/auth/complete-initial-setup',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'مالك الذاكرة',
          username: 'admin_mem_updated',
          newPassword: 'MemPassword@2026'
        })
      },
      memToken
    );
    assert.equal(memSetup.status, 200, 'يجب نجاح الإعداد في وضع الذاكرة');
    assert.equal(memSetup.data.user.mustChangePassword, false);

    const memItemsAllowed = await requestJson('/api/items', { method: 'GET' }, memToken);
    assert.equal(memItemsAllowed.status, 200, 'في وضع الذاكرة بعد الإعداد يجب أن يرجع 200');

    // التحقق أن authMiddleware في وضع الذاكرة ما زال يقرأ liveUser من getStoredUserById
    const mgrLogin = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'manager', password: INITIAL_USER_PASSWORD })
    });
    assert.equal(mgrLogin.status, 200);
    const mgrToken = mgrLogin.data.token as string;
    const mgrSetup = await requestJson(
      '/api/auth/complete-initial-setup',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'مدير الذاكرة',
          username: 'manager_mem',
          newPassword: 'MgrPass@2026'
        })
      },
      mgrToken
    );
    assert.equal(mgrSetup.status, 200);

    const mgrStored = getStoredUserById('usr-manager-002');
    assert.ok(mgrStored, 'يجب وجود usr-manager-002 في الذاكرة');

    // إذا تغيرت mustChangePassword في الذاكرة إلى true، يجب أن يفرضها authMiddleware في وضع الذاكرة
    mgrStored.mustChangePassword = true;
    const mgrMustChangeRes = await requestJson('/api/items', { method: 'GET' }, mgrToken);
    assert.equal(mgrMustChangeRes.status, 403, 'في وضع الذاكرة يجب أن يقرأ authMiddleware علامة mustChangePassword من الذاكرة');
    assert.equal(mgrMustChangeRes.data.code, 'MUST_CHANGE_PASSWORD');

    // وعند إيقاف الحساب في الذاكرة، يجب أن تلغى الجلسة فوراً بـ 401 مع suspended: true
    mgrStored.mustChangePassword = false;
    mgrStored.status = 'inactive';
    const mgrAfterSuspend = await requestJson('/api/items', { method: 'GET' }, mgrToken);
    assert.equal(mgrAfterSuspend.status, 401, 'في وضع الذاكرة يجب إلغاء الجلسة فوراً عند إيقاف الحساب');
    assert.equal(mgrAfterSuspend.data.suspended, true);

    console.log('✅ (ج) نجح: وضع الذاكرة يعمل بالسلوك الحالي كاملاً بدون أي تغيير.');
    console.log('\n🎉 اكتملت جميع اختبارات التحقق من mustChangePassword بنجاح!');
  } finally {
    globalThis.fetch = originalFetch;
    setAppsScriptUrl('');
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

runTests().catch(err => {
  console.error('❌ فشل الاختبار:', err);
  process.exit(1);
});

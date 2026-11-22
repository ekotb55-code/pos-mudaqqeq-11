import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const codeGsPath = path.resolve(__dirname, '../apps-script/Code.gs');

function createMockSheet(initialRows: any[][]) {
  const rows = initialRows.map(r => [...r]);
  return {
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => (rows[0] ? rows[0].length : 0),
    getRange: (row: number, col: number, numRows = 1, numCols = 1) => ({
      getValues: () => {
        const out: any[][] = [];
        for (let r = 0; r < numRows; r++) {
          const src = rows[row - 1 + r] || [];
          const slice: any[] = [];
          for (let c = 0; c < numCols; c++) {
            slice.push(src[col - 1 + c]);
          }
          out.push(slice);
        }
        return out;
      },
      setValue: (val: any) => {
        if (!rows[row - 1]) rows[row - 1] = [];
        rows[row - 1][col - 1] = val;
      },
      setValues: (vals: any[][]) => {
        for (let r = 0; r < vals.length; r++) {
          if (!rows[row - 1 + r]) rows[row - 1 + r] = [];
          for (let c = 0; c < vals[r].length; c++) {
            rows[row - 1 + r][col - 1 + c] = vals[r][c];
          }
        }
      }
    }),
    getDataRange: () => ({
      getValues: () => rows.map(r => [...r])
    }),
    appendRow: (row: any[]) => {
      rows.push([...row]);
    }
  };
}

function runTests() {
  console.log('=== بدء اختبار إصلاحات apps-script/Code.gs ===\n');

  const code = fs.readFileSync(codeGsPath, 'utf8');
  const loggerEntries: string[] = [];

  const usersSheetStandard = createMockSheet([
    [
      'ID',
      'اسم المستخدم',
      'الاسم',
      'الدور',
      'salt',
      'passwordHash',
      'الحالة',
      'تاريخ الإضافة',
      'permissionsJson',
      'isOwner',
      'رقم الهاتف',
      'cashboxConfigJson',
      'offlineVerifier',
      'offlineSalt',
      'offlineIterations',
      'permissionsUpdatedAt',
      'permissionsUpdatedByDevice',
      'warehouseConfigJson',
      'mustChangePassword'
    ],
    [
      'usr-emp-001',
      'emp1',
      'موظف المخزن',
      'employee',
      's1',
      'hash1',
      'نشط',
      '2026-01-01',
      '["items.view"]',
      false,
      '01012345678',
      '',
      '',
      '',
      '',
      '',
      '',
      JSON.stringify({ allowedWarehouseIds: ['wh-sub-1'], defaultWarehouseId: 'wh-sub-1' }),
      false
    ],
    [
      'usr-mgr-002',
      'mgr1',
      'مدير عام',
      'manager',
      's2',
      'hash2',
      'نشط',
      '2026-01-01',
      '[]',
      false,
      '+20 112 233 4455',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      false
    ],
    [
      'usr-owner-003',
      'owner_flag',
      'صاحب صلاحية مالك',
      'employee',
      's3',
      'hash3',
      'نشط',
      '2026-01-01',
      '[]',
      true,
      '01200001111',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      false
    ]
  ]);

  const warehousesSheet = createMockSheet([
    ['ID', 'الاسم', 'الحالة', 'افتراضي', 'ملاحظات', 'تاريخ الإنشاء', 'تاريخ التحديث'],
    ['wh-main', 'المخزن الرئيسي', 'نشط', true, '', '2026-01-01', '2026-01-01'],
    ['wh-sub-1', 'مخزن المعادي', 'نشط', false, '', '2026-01-01', '2026-01-01']
  ]);

  const userWarehousesSheet = createMockSheet([
    ['userId', 'allowedWarehouseIdsJson', 'defaultWarehouseId', 'updatedAt'],
    ['usr-emp-001', '["wh-sub-1"]', 'wh-sub-1', '2026-01-01']
  ]);

  const sessionsSheet = createMockSheet([
    ['token', 'userId', 'phone', 'role', 'permissionsJson', 'createdAt', 'expiresAt'],
    ['tok-emp', 'usr-emp-001', '01012345678', 'employee', '["items.view"]', '2026-01-01', '2099-01-01T00:00:00.000Z']
  ]);

  const auditSheet = createMockSheet([
    ['ID', 'التاريخ', 'actorId', 'actorName', 'actorRole', 'action', 'targetType', 'targetId', 'details']
  ]);

  const sheetsMap: Record<string, any> = {
    Users: usersSheetStandard,
    Warehouses: warehousesSheet,
    UserWarehouses: userWarehousesSheet,
    Sessions: sessionsSheet,
    AuditLogs: auditSheet
  };

  const mockSpreadsheet = {
    getSheetByName: (name: string) => sheetsMap[name] || null
  };

  const sandbox: any = {
    console,
    Date,
    JSON,
    Math,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    ReferenceError,
    TypeError,
    SyntaxError,
    Logger: {
      log: (msg: any) => loggerEntries.push(String(msg))
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => true,
        releaseLock: () => {}
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => mockSpreadsheet
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt: string) => ({
        setMimeType: () => ({ getContent: () => txt, content: txt })
      })
    },
    Utilities: {
      getUuid: () => 'uuid-test-1234'
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null,
        setProperty: () => {}
      })
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  // 1) اختبار hasPermission
  assert.equal(sandbox.hasPermission(null, 'items.view'), false);
  assert.equal(sandbox.hasPermission(undefined, 'items.view'), false);
  assert.equal(sandbox.hasPermission({ role: 'designer', permissions: [] }, 'anything'), true);
  assert.equal(sandbox.hasPermission({ role: 'employee', isOwner: true, permissions: [] }, 'anything'), true);
  assert.equal(sandbox.hasPermission({ role: 'employee', permissions: ['items.view'] }, 'items.view'), true);
  assert.equal(sandbox.hasPermission({ role: 'employee', permissions: ['items.view'] }, 'items.edit'), false);
  assert.equal(sandbox.hasPermission({ role: 'employee', permissions: 'invalid' }, 'items.view'), false);
  console.log('✅ 1. hasPermission تعمل بدقة في كل الحالات ولا ترمي أي خطأ.');

  // 2) اختبار normalizePhoneForCompare
  assert.equal(sandbox.normalizePhoneForCompare(null), '');
  assert.equal(sandbox.normalizePhoneForCompare(undefined), '');
  assert.equal(sandbox.normalizePhoneForCompare('   '), '');
  assert.equal(sandbox.normalizePhoneForCompare('+20 101 234 5678'), '01012345678');
  assert.equal(sandbox.normalizePhoneForCompare('0020 101 234 5678'), '01012345678');
  assert.equal(sandbox.normalizePhoneForCompare('201012345678'), '01012345678');
  assert.equal(sandbox.normalizePhoneForCompare('0101-234-5678'), '01012345678');
  assert.equal(sandbox.normalizePhoneForCompare('  Admin_User  '), 'admin_user');
  assert.equal(sandbox.normalizePhoneForCompare('user123'), 'user123');
  console.log('✅ 2. normalizePhoneForCompare توحد أرقام الهواتف المصرية وتنظف النصوص.');

  // 3) اختبار findUserRowForWarehouseSessionGS و getAllowedWarehouseIdsForSessionGS باستخدام getHeaderMap
  // أ) مطابقة بالهاتف بصيغة مختلفة (+20 مقابل 0020) مع عدم وجود userId
  const mgrByPhone = sandbox.findUserRowForWarehouseSessionGS(mockSpreadsheet, {
    phone: '00201122334455',
    role: 'employee'
  });
  assert.ok(mgrByPhone, 'يجب العثور على المستخدم برقم الهاتف المطبّع عبر عمود رقم الهاتف');
  assert.equal(mgrByPhone.row[0], 'usr-mgr-002');

  // ب) التحقق أن الدور يُقرأ من عمود «الدور» وليس العمود الخامس (passwordHash)
  const mgrAllowed = Array.from(
    sandbox.getAllowedWarehouseIdsForSessionGS(mockSpreadsheet, {
      phone: '01122334455',
      role: 'employee'
    })
  );
  // الدالة ترجع 'ALL' للمدير بناءً على عمود «الدور» في الشيت
  assert.equal(
    sandbox.getAllowedWarehouseIdsForSessionGS(mockSpreadsheet, { phone: '01122334455', role: 'employee' }),
    'ALL',
    'يجب قراءة الدور من عمود «الدور»'
  );
  assert.ok(mgrAllowed.length > 0);

  // ج) التحقق أن isOwner يُقرأ من عمود isOwner وليس العمود الثامن (permissionsJson)
  assert.equal(
    sandbox.getAllowedWarehouseIdsForSessionGS(mockSpreadsheet, { userId: 'usr-owner-003', role: 'employee' }),
    'ALL',
    'يجب قراءة isOwner من عمود isOwner'
  );

  // د) الموظف العادي يُرجع قائمة مخازنه المخصصة فقط
  const empAllowed = Array.from(
    sandbox.getAllowedWarehouseIdsForSessionGS(mockSpreadsheet, { userId: 'usr-emp-001', role: 'employee' })
  );
  assert.deepEqual(empAllowed, ['wh-sub-1']);

  // هـ) اختبار نفس الدالتين عند إعادة ترتيب أعمدة شيت Users بالكامل
  sheetsMap.Users = createMockSheet([
    ['رقم الهاتف', 'isOwner', 'الدور', 'اسم المستخدم', 'ID', 'warehouseConfigJson'],
    ['+20 155 999 8877', false, 'manager', 'reordered_mgr', 'usr-re-1', ''],
    ['01551112233', true, 'employee', 'reordered_own', 'usr-re-2', '']
  ]);
  const reorderedFind = sandbox.findUserRowForWarehouseSessionGS(mockSpreadsheet, { phone: '01559998877' });
  assert.ok(reorderedFind, 'يجب إيجاد المستخدم حتى لو تغير ترتيب أعمدة شيت Users');
  assert.equal(reorderedFind.row[4], 'usr-re-1');
  assert.equal(
    sandbox.getAllowedWarehouseIdsForSessionGS(mockSpreadsheet, { phone: '01559998877', role: 'employee' }),
    'ALL'
  );
  assert.equal(
    sandbox.getAllowedWarehouseIdsForSessionGS(mockSpreadsheet, { userId: 'usr-re-2', role: 'employee' }),
    'ALL'
  );
  console.log('✅ 3. findUserRowForWarehouseSessionGS و getAllowedWarehouseIdsForSessionGS تقرآن الأعمدة عبر getHeaderMap بنجاح.');

  // 4) اختبار doPost للأخطاء غير المتوقعة مقابل الرسائل العربية المقصودة
  // أ) خطأ غير متوقع (ReferenceError)
  sandbox.getItemsFiltered = () => {
    throw new ReferenceError('someUndefinedHelper is not defined');
  };
  const errRespRaw = sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'getItems',
        token: 'tok-emp'
      })
    }
  });
  const errResp = JSON.parse(errRespRaw.content);
  assert.equal(errResp.success, false);
  assert.equal(
    errResp.error,
    'حدث خطأ غير متوقع في الخادم. برجاء المحاولة أو التواصل مع الدعم',
    'يجب إرجاع الرسالة العربية الموحدة للأخطاء غير المتوقعة'
  );
  assert.ok(
    loggerEntries.some(e => e.includes('ReferenceError') && e.includes('someUndefinedHelper is not defined')),
    'يجب تسجيل التفاصيل الإنجليزية في Logger'
  );
  assert.ok(
    auditSheet.rows.some(r => r[5] === 'SERVER_UNEXPECTED_ERROR' && String(r[8]).includes('someUndefinedHelper is not defined')),
    'يجب تسجيل التفاصيل الإنجليزية في سجل المراجعة AuditLogs'
  );

  // ب) رسالة عربية مقصودة (مثل صلاحية مرفوضة) تبقى كما هي
  const permDeniedRaw = sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'getUsers',
        token: 'tok-emp'
      })
    }
  });
  const permDenied = JSON.parse(permDeniedRaw.content);
  assert.equal(permDenied.success, false);
  assert.ok(
    String(permDenied.error).includes('صلاحية مرفوضة'),
    `الرسالة العربية المقصودة يجب أن تبقى كما هي، الفعلي: ${permDenied.error}`
  );

  console.log('✅ 4. معالجة أخطاء doPost تُرجع الرسالة العربية الموحدة للأخطاء غير المتوقعة وتسجل التفاصيل في Logger وسجل المراجعة، وتُبقي الرسائل العربية المقصودة كما هي.');
  console.log('\n🎉 اكتملت جميع اختبارات التحقق من Code.gs بنجاح!');
}

runTests();

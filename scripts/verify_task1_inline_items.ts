import assert from 'node:assert/strict';
import {
  saveItem,
  inlineUpdateItem,
  getAuditLogs,
  getItemLogs,
  getDisplaySettings,
  saveDisplaySettings
} from '../server/sheetsService.ts';
import { ALL_PERMISSIONS, ROLE_TEMPLATES } from '../src/utils/permissions.ts';

async function runTests() {
  console.log('=== بدء اختبارات المهمة (1 من 7): أعمدة شاشة الأصناف + التعديل المباشر ===');

  // 1) التحقق من وجود الصلاحية الجديدة products.inline_edit والإعداد الافتراضي مغلق
  const inlinePermDef = ALL_PERMISSIONS.find(p => p.key === 'products.inline_edit');
  assert.ok(inlinePermDef, 'يجب وجود صلاحية products.inline_edit في ALL_PERMISSIONS');
  assert.ok(
    ROLE_TEMPLATES.manager.includes('products.inline_edit'),
    'يجب وجود صلاحية products.inline_edit في قالب المدير'
  );

  const initialDisplay = getDisplaySettings();
  assert.equal(
    Boolean(initialDisplay.enableInlineEdit),
    false,
    'الإعداد الافتراضي للتعديل المباشر من جدول الأصناف يجب أن يكون مغلقًا (false)'
  );

  const toggleOnRes = await saveDisplaySettings(
    { enableInlineEdit: true },
    { role: 'designer', permissions: ALL_PERMISSIONS.map(p => p.key) }
  );
  assert.equal(toggleOnRes.success, true);
  assert.equal(getDisplaySettings().enableInlineEdit, true);

  // إعادة الإعداد للوضع الافتراضي بعد التحقق
  await saveDisplaySettings(
    { enableInlineEdit: false },
    { role: 'designer', permissions: ALL_PERMISSIONS.map(p => p.key) }
  );
  assert.equal(getDisplaySettings().enableInlineEdit, false);
  console.log('✓ 1. الصلاحية products.inline_edit والإعداد (الافتراضي مغلق) يعملان بنجاح');

  // تجهيز صنفين للاختبار
  const managerSession = {
    id: 'usr-mgr-test',
    userId: 'usr-mgr-test',
    name: 'مدير الاختبار',
    role: 'manager' as const,
    permissions: [
      'items.view',
      'items.create',
      'items.edit',
      'products.inline_edit',
      'prices.view_sale',
      'prices.view_purchase'
    ] as any
  };

  const createdA = await saveItem(
    {
      name: 'صنف اختبار تعديل مباشر أ',
      barcode: 'BC-INLINE-1001',
      salePrice: 150,
      minPrice: 120,
      purchasePrice: 100,
      stockQuantity: 10,
      unit: 'قطعة',
      notes: 'وصف قديم'
    },
    managerSession
  );
  assert.equal(createdA.success, true);
  const itemA = createdA.item!;
  assert.ok(itemA.updatedAt, 'يجب أن يحتوي الصنف على طابع وقت آخر تعديل updatedAt');

  const createdB = await saveItem(
    {
      name: 'صنف اختبار تعديل مباشر ب',
      barcode: 'BC-INLINE-1002',
      salePrice: 200,
      purchasePrice: 140,
      stockQuantity: 5,
      unit: 'علبة',
      notes: ''
    },
    managerSession
  );
  assert.equal(createdB.success, true);
  const itemB = createdB.item!;

  // 2) تعديل سعر من الجدول يُحفظ ويُسجَّل في audit log بالقديم والجديد
  const updatePriceRes = await inlineUpdateItem(
    itemA.id,
    {
      salePrice: 175.5,
      purchasePrice: 110,
      notes: 'وصف محدث من الجدول',
      unit: 'كرتونة',
      lastUpdated: itemA.updatedAt
    },
    managerSession
  );
  assert.equal(updatePriceRes.success, true, 'يجب نجاح التعديل المباشر للسعر والوصف والوحدة');
  assert.equal(updatePriceRes.item?.salePrice, 175.5);
  assert.equal(updatePriceRes.item?.purchasePrice, 110);
  assert.equal(updatePriceRes.item?.notes, 'وصف محدث من الجدول');
  assert.equal(updatePriceRes.item?.unit, 'كرتونة');

  const auditLogs = await getAuditLogs();
  const latestInlineAudit = auditLogs.find(
    l => l.action === 'ITEM_INLINE_EDIT' && l.targetId === itemA.id
  );
  assert.ok(latestInlineAudit, 'يجب تسجيل التعديل المباشر في Audit Log');
  assert.ok(
    latestInlineAudit.details.includes('150') && latestInlineAudit.details.includes('175.5'),
    `يجب أن يتضمن سجل التدقيق القيمة القديمة والجديدة للسعر، الفعلي: ${latestInlineAudit.details}`
  );
  assert.ok(
    latestInlineAudit.details.includes('100') && latestInlineAudit.details.includes('110'),
    `يجب أن يتضمن سجل التدقيق القيمة القديمة والجديدة لسعر الشراء، الفعلي: ${latestInlineAudit.details}`
  );

  const itemChangeLogsRes: any = await getItemLogs(itemA.id);
  const itemChangeLogs = Array.isArray(itemChangeLogsRes) ? itemChangeLogsRes : (itemChangeLogsRes?.changeLogs || itemChangeLogsRes?.logs || []);
  assert.ok(
    itemChangeLogs.some((l: any) => l.fieldName === 'سعر البيع' && Number(l.oldValue) === 150 && Number(l.newValue) === 175.5),
    'يجب تسجيل تغير سعر البيع بالقديم والجديد في سجل تغييرات الصنف'
  );
  console.log('✓ 2. تعديل السعر والبيانات من الجدول يُحفظ ويُسجَّل في audit log بالقديم والجديد');

  // 3) تكرار باركود أو اسم يُرفض
  const dupBarcodeRes = await inlineUpdateItem(
    itemA.id,
    {
      barcode: itemB.barcode,
      lastUpdated: updatePriceRes.item?.updatedAt
    },
    managerSession
  );
  assert.equal(dupBarcodeRes.success, false, 'يجب رفض الباركود المكرر');
  assert.ok(
    dupBarcodeRes.error?.includes('باركود') || dupBarcodeRes.error?.includes('مسجل بالفعل'),
    `رسالة خطأ الباركود المكرر غير متوقعة: ${dupBarcodeRes.error}`
  );

  const dupNameRes = await inlineUpdateItem(
    itemA.id,
    {
      name: itemB.name,
      lastUpdated: updatePriceRes.item?.updatedAt
    },
    managerSession
  );
  assert.equal(dupNameRes.success, false, 'يجب رفض الاسم المكرر');
  assert.ok(
    dupNameRes.error?.includes('مكرر'),
    `رسالة خطأ الاسم المكرر غير متوقعة: ${dupNameRes.error}`
  );
  console.log('✓ 3. تكرار الباركود وتكرار الاسم يُرفضان برسالة عربية واضحة');

  // 4) مستخدم بلا صلاحية products.inline_edit يُرفض من الخادم
  const unprivilegedSession = {
    id: 'usr-emp-test',
    userId: 'usr-emp-test',
    name: 'موظف بدون صلاحية تعديل مباشر',
    role: 'employee' as const,
    permissions: ['items.view', 'items.edit', 'prices.view_sale'] as any
  };
  const noPermRes = await inlineUpdateItem(
    itemA.id,
    {
      salePrice: 180,
      lastUpdated: updatePriceRes.item?.updatedAt
    },
    unprivilegedSession
  );
  assert.equal(noPermRes.success, false, 'يجب رفض المستخدم الذي لا يملك صلاحية products.inline_edit');
  assert.equal(noPermRes.statusCode, 403);

  // مستخدم يملك products.inline_edit لكن لا يملك prices.view_purchase يحاول تعديل سعر الشراء
  const noCostPermSession = {
    id: 'usr-emp-inline',
    userId: 'usr-emp-inline',
    name: 'موظف تعديل مباشر بدون تكلفة',
    role: 'employee' as const,
    permissions: ['items.view', 'products.inline_edit', 'prices.view_sale'] as any
  };
  const noCostRes = await inlineUpdateItem(
    itemA.id,
    {
      purchasePrice: 95,
      lastUpdated: updatePriceRes.item?.updatedAt
    },
    noCostPermSession
  );
  assert.equal(noCostRes.success, false, 'يجب رفض تعديل سعر الشراء لمن لا يملك صلاحية رؤية التكلفة');
  assert.equal(noCostRes.statusCode, 403);

  // محاولة النزول تحت الحد الأدنى لسعر البيع بدون صلاحية التجاوز
  const belowMinRes = await inlineUpdateItem(
    itemA.id,
    {
      salePrice: 105, // أقل من minPrice = 120
      lastUpdated: updatePriceRes.item?.updatedAt
    },
    managerSession
  );
  assert.equal(belowMinRes.success, false, 'يجب رفض النزول تحت الحد الأدنى لسعر البيع بدون صلاحية التجاوز');
  assert.equal(belowMinRes.statusCode, 403);
  console.log('✓ 4. مستخدم بلا صلاحية (أو بدون صلاحية التكلفة أو تجاوز الحد الأدنى) يُرفض من الخادم');

  // 5) تعديل متعارض (منع الكتابة فوق تعديل آخر) يُرفض برسالة «الصنف عُدّل من مستخدم آخر، حدّث الصفحة»
  const staleTimestamp = itemA.updatedAt; // طابع وقت قديم قبل التعديل الأول
  const conflictRes = await inlineUpdateItem(
    itemA.id,
    {
      salePrice: 190,
      lastUpdated: staleTimestamp
    },
    managerSession
  );
  assert.equal(conflictRes.success, false, 'يجب رفض التعديل المتعارض عند تغير وقت آخر تعديل على الخادم');
  assert.equal(conflictRes.statusCode, 409);
  assert.equal(conflictRes.code, 'CONFLICT');
  assert.equal(
    conflictRes.error,
    'الصنف عُدّل من مستخدم آخر، حدّث الصفحة',
    `رسالة التعارض يجب أن تطابق النص المطلوب، الفعلي: ${conflictRes.error}`
  );
  console.log('✓ 5. التعديل المتعارض يُرفض برسالة «الصنف عُدّل من مستخدم آخر، حدّث الصفحة»');

  console.log('=== نجحت جميع اختبارات المهمة (1 من 7) بنسبة 100% ===');
}

runTests().catch(err => {
  console.error('فشل أحد الاختبارات:', err);
  process.exit(1);
});

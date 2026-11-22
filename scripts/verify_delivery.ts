/**
 * اختبار قواعد التوصيل (server/delivery.ts) من غير سيرفر
 * التشغيل:  npx tsx scripts/verify_delivery.ts
 */
import * as D from '../server/delivery.ts';

let passed = 0;
function check(name: string, cond: unknown) {
  if (!cond) throw new Error(`فشل التحقق: ${name}`);
  passed++;
}
function throws(name: string, fn: () => unknown, code?: string) {
  try {
    fn();
  } catch (err: any) {
    check(`${name} (رسالة عربي)`, err instanceof D.DeliveryError && /[\u0600-\u06FF]/.test(err.message) && (!code || err.code === code));
    return;
  }
  throw new Error(`فشل التحقق: ${name} — كان المفروض يترفض`);
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
const owner: D.DeliveryActor = { userId: 'u-owner', name: 'المالك', role: 'designer' };
const cashier: D.DeliveryActor = { userId: 'u-cash', name: 'كاشير', role: 'employee', permissions: [] };

D.resetDelivery();

// ---- الإعدادات ----
check('الافتراضي: مقفول، طيارين، رسوم ثابتة 0', !D.getDeliverySettings().enabled && D.getDeliverySettings().mode === 'drivers' && D.getDeliverySettings().fixedFee === 0);
throws('مين بيوصّل غلط', () => D.saveDeliverySettings({ mode: 'x' }, 'م'));
throws('رسوم بالسالب', () => D.saveDeliverySettings({ fixedFee: -5 }, 'م'));
throws('ساعات التأخير غلط', () => D.saveDeliverySettings({ lateAfterHours: 0 }, 'م'));
throws('التوصيل مقفول', () => D.prepareDeliveryPlan({ paymentMode: 'cod', address: 'x' }, { isDirectSale: true }), 'DELIVERY_DISABLED');
D.saveDeliverySettings({ enabled: true, mode: 'drivers', zonePricing: false, fixedFee: 25 }, 'المالك');
check('اتحفظ مع اسم اللي عدّل', D.getDeliverySettings().updatedBy === 'المالك' && D.getDeliverySettings().fixedFee === 25);

// ---- رسوم ثابتة ----
throws('للبيع المباشر بس', () => D.prepareDeliveryPlan({ paymentMode: 'cod', address: 'x' }, { isDirectSale: false }), 'DELIVERY_DIRECT_ONLY');
throws('لازم طريقة الدفع', () => D.prepareDeliveryPlan({ address: 'x' }, { isDirectSale: true }));
throws('لازم عنوان', () => D.prepareDeliveryPlan({ paymentMode: 'cod' }, { isDirectSale: true }));
let plan = D.prepareDeliveryPlan({ paymentMode: 'cod' }, { isDirectSale: true, customer: { id: 'c1', name: 'سارة', phone: '0100', address: 'المعادي' } });
check('العنوان والموبايل من العميل والرسوم الثابتة', plan.address === 'المعادي' && plan.phone === '0100' && plan.fee === 25 && !plan.feeManual);
throws('تعديل الرسوم من غير صلاحية', () => D.prepareDeliveryPlan({ paymentMode: 'cod', address: 'x', fee: 10 }, { isDirectSale: true, actor: cashier }), 'DELIVERY_FEE_FORBIDDEN');
plan = D.prepareDeliveryPlan({ paymentMode: 'prepaid', address: 'x', fee: 10 }, { isDirectSale: true, actor: { ...cashier, permissions: ['delivery.edit_fee'] } });
check('تعديل الرسوم بالصلاحية', plan.fee === 10 && plan.feeManual);
plan = D.prepareDeliveryPlan({ paymentMode: 'prepaid', address: 'x', fee: 25 }, { isDirectSale: true, actor: cashier });
check('نفس الرسوم المحسوبة مش تعديل', plan.fee === 25 && !plan.feeManual);

// ---- الطيارين والشركات ----
const users = new Set(['u-d1', 'u-d2']);
const drv = D.saveDriver({ name: 'أحمد', commissionPerOrder: 7, monthlySalary: 2000, userId: 'u-d1' }, id => users.has(id));
throws('حساب مش موجود', () => D.saveDriver({ name: 'س', userId: 'nope' }, id => users.has(id)));
throws('اسم طيار مكرر', () => D.saveDriver({ name: 'أحمد' }, () => true));
const cour = D.saveCourier({ name: 'بوسطة', feePerOrder: 20 });
check('findDriverByUserId', D.findDriverByUserId('u-d1')?.id === drv.id);
throws('الوضع «طيارين بس» ما يقبلش شركة', () => D.prepareDeliveryPlan({ paymentMode: 'cod', address: 'x', assigneeType: 'courier', assigneeId: cour.id }, { isDirectSale: true }));

// ---- دورة طلب بعمولة ثابتة ----
plan = D.prepareDeliveryPlan({ paymentMode: 'cod', address: 'شارع 1', assigneeType: 'driver', assigneeId: drv.id }, { isDirectSale: true, customerName: 'زائر' });
const o1 = D.createOrderForInvoice(plan, { invoiceNumber: 'INV-1', total: 125 }, owner);
check('رقم الطلب DLV-000001 والمطلوب 125', o1.number === 'DLV-000001' && near(o1.amountDue, 125) && o1.status === 'جديد' && o1.assigneeName === 'أحمد');
throws('اتسلم قبل خرج', () => D.checkTransition(o1.id, 'اتسلم'));
throws('حالة غلط', () => D.checkTransition(o1.id, 'طار'));
D.checkTransition(o1.id, 'خرج للتوصيل');
D.applyTransition(o1.id, 'خرج للتوصيل', owner);
throws('الطيار ما يرجّعش للمحل', () => D.checkTransition(o1.id, 'رجع المحل', { asDriverId: drv.id }), 'FORBIDDEN');
throws('خرج ← رجع المحل مباشرة مش مسموح', () => D.checkTransition(o1.id, 'رجع المحل'));
const done = D.applyTransition(o1.id, 'اتسلم', { userId: 'u-d1', name: 'أحمد' });
check('اتسلم: عمولة ثابتة 7 والعهدة 125', near(done.order.commission, 7) && near(D.driverCustody(drv.id), 125));
check('السجل: 3 حالات بمين عملها', done.order.log.length === 3 && done.order.log[2].byName === 'أحمد');
throws('بعد اتسلم: مقفول', () => D.checkTransition(o1.id, 'اتلغى'));

// ---- طلب مدفوع مقدمًا ما بيدخلش العهدة ----
const o2 = D.createOrderForInvoice(D.prepareDeliveryPlan({ paymentMode: 'prepaid', address: 'x' }, { isDirectSale: true }), { invoiceNumber: 'INV-2', total: 60 });
check('مدفوع مقدمًا: المطلوب 0', o2.amountDue === 0);
throws('خرج من غير توزيع', () => D.checkTransition(o2.id, 'خرج للتوصيل'));
D.assignOrder(o2.id, { assigneeType: 'driver', assigneeId: drv.id });
D.applyTransition(o2.id, 'خرج للتوصيل', owner);
D.applyTransition(o2.id, 'اتسلم', owner);
check('العهدة لسه 125', near(D.driverCustody(drv.id), 125));
check('التسوية فيها الدفع عند الاستلام بس', D.previewSettlement('driver', drv.id).orders.length === 1);

// ---- التسوية والصرف ----
const prev = D.previewSettlement('driver', drv.id);
throws('طلب مش من طلباته', () => D.previewSettlement('driver', drv.id, [o2.id]));
const st = D.recordSettlement(prev, { received: 120, cashboxId: 'cb', cashboxName: 'الخزنة', key: 'k1' }, owner);
check('التسوية: عجز 5', near(st.shortage, 5) && st.number === 'STL-000001' && D.settlementByKey('k1')?.id === st.id);
check('العهدة اتصفرت', near(D.driverCustody(drv.id), 0) && D.previewSettlement('driver', drv.id).orders.length === 0);
let dues = D.driverDues(drv.id);
check('المستحق: عمولة 14 وعجز 5', near(dues.commissionUnpaid, 14) && near(dues.shortageOutstanding, 5));
throws('مفيش حاجة تتصرف', () => D.planPayout(drv.id, { payCommission: false }));
const pp = D.planPayout(drv.id, { salary: 2000 });
check('الصرف: 2000 + 14 − 5 = 2009', near(pp.paid, 2009) && near(pp.shortageDeducted, 5));
D.recordPayout(pp, { cashboxId: 'cb', cashboxName: 'الخزنة', key: 'p1' }, owner);
dues = D.driverDues(drv.id);
check('بعد الصرف: صفر', near(dues.commissionUnpaid, 0) && near(dues.shortageOutstanding, 0) && D.payoutByKey('p1'));

// ---- حسب المنطقة + شركات الشحن ----
D.saveDeliverySettings({ zonePricing: true, mode: 'both', maxDriverCustody: 100 }, 'المالك');
const zone = D.saveZone({ name: 'حلوان', customerFee: 15, driverCommission: 9, minOrderValue: 200 });
const off = D.saveZone({ name: 'مقفولة', customerFee: 5, active: false });
throws('لازم منطقة', () => D.prepareDeliveryPlan({ paymentMode: 'cod', address: 'x' }, { isDirectSale: true }));
throws('منطقة موقوفة', () => D.prepareDeliveryPlan({ paymentMode: 'cod', address: 'x', zoneId: off.id }, { isDirectSale: true }));
plan = D.prepareDeliveryPlan({ paymentMode: 'cod', address: 'x' }, { isDirectSale: true, customer: { id: 'c', name: 'ع', zoneId: zone.id } });
check('المنطقة من العميل ورسومها', plan.zoneId === zone.id && plan.fee === 15 && plan.zoneCommission === 9);
throws('أقل قيمة طلب', () => D.checkPlanTotals(plan, 150), 'DELIVERY_MIN_ORDER');
D.checkPlanTotals(plan, 200);
const o3 = D.createOrderForInvoice(plan, { invoiceNumber: 'INV-3', total: 215 });
D.assignOrder(o3.id, { assigneeType: 'driver', assigneeId: drv.id });
D.applyTransition(o3.id, 'خرج للتوصيل', owner);
const d3 = D.applyTransition(o3.id, 'اتسلم', owner);
check('حسب المنطقة: عمولة المنطقة 9 وتنبيه العهدة', near(d3.order.commission, 9) && /أكتر من الحد/.test(d3.warning));
const o4 = D.createOrderForInvoice({ ...plan, paymentMode: 'prepaid' }, { invoiceNumber: 'INV-4', total: 215 });
D.assignOrder(o4.id, { assigneeType: 'courier', assigneeId: cour.id, trackingNumber: 'B-1' });
D.applyTransition(o4.id, 'خرج للتوصيل', owner);
D.applyTransition(o4.id, 'اتسلم', owner);
const pc = D.previewSettlement('courier', cour.id);
check('الشركة: مدفوع مقدمًا ← المستحق للشركة −20', pc.orders.length === 1 && near(pc.expected, -20));

// ---- التقارير ----
const o5 = D.createOrderForInvoice({ ...plan, assignee: null }, { invoiceNumber: 'INV-5', total: 215 }, owner, new Date(Date.now() - 5 * 3600_000));
D.assignOrder(o5.id, { assigneeType: 'driver', assigneeId: drv.id });
D.applyTransition(o5.id, 'خرج للتوصيل', owner);
D.applyTransition(o5.id, 'ما اتسلمش', owner, { reason: 'مقفول' });
const rep = D.buildDeliveryReports();
check('مفتوح 1 ومتأخر 1 (أكتر من 3 ساعات)', rep.openOrders.total === 1 && rep.openOrders.late === 1);
check('العهدة: أحمد 215 والشركة −20', rep.custody.some(c => c.name === 'أحمد' && near(c.amount, 215)) && rep.custody.some(c => c.name === 'بوسطة' && near(c.amount, -20)));
const perf = rep.performance.find(p => p.driverId === drv.id)!;
check('أداء أحمد: 4 طلبات، 3 اتسلموا، 1 ما اتسلمش', perf.orders === 4 && perf.delivered === 3 && perf.failed === 1 && perf.deliveredPercent === 75);
check('الرسوم: 25 + 25 + 15 + 15 = 80', near(rep.fees.total, 80));

// ---- الحفظ وإعادة الضبط ----
const [cfgCol, opsCol] = D.getDeliveryCollections();
const cfgCopy = JSON.parse(JSON.stringify(cfgCol.get()));
const opsCopy = JSON.parse(JSON.stringify(opsCol.get()));
D.resetDeliveryOperations();
check('إعادة ضبط العمليات: الطلبات اتمسحت والطيارين فضلوا', D.listOrders().length === 0 && D.listDrivers().length === 1);
opsCol.set(opsCopy);
cfgCol.set(cfgCopy);
check('الاسترجاع من قاعدة البيانات', D.listOrders().length === 5 && D.getDeliverySettings().zonePricing === true);
const o6 = D.createOrderForInvoice({ ...plan }, { invoiceNumber: 'INV-6', total: 1 });
check('العد بيكمل بعد الاسترجاع', o6.number === 'DLV-000006');
D.resetDelivery();
check('إعادة ضبط المصنع', !D.getDeliverySettings().enabled && D.listDrivers().length === 0 && D.listOrders().length === 0);

console.log(`\n🎉 كل اختبارات قواعد التوصيل نجحت (${passed} تحققًا).`);

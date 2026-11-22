/**
 * التوصيل: العمليات اللي بتلمس الفلوس والمخزون — POS مدقق
 * ---------------------------------------------------------------------------
 * - تغيير حالة الطلب: «رجع المحل» و«اتلغى» بيعملوا مرتجع رسمي للبضاعة الأول، وبعدين الحالة تتغير.
 *     الدفع عند الاستلام: المرتجع ما يلمسش حساب العميل ولا الخزنة.
 *     مدفوع مقدمًا: فلوس العميل بترجعله من خزنة تختارها (أو تتقيد على حسابه لو عميل آجل).
 * - التسوية: الطلبات اللي اتسلمت ولسه ما اتسوتش ← الفلوس تدخل الخزنة، والعجز يتسجل على الطيار،
 *   ورسوم شركة الشحن تتخصم. الفواتير تبقى «مسددة».
 * - صرف مستحقات الطيار: المرتب + العمولة − العجز، من خزنة.
 * كل عملية فلوس ليها مفتاح عدم تكرار (لو الطلب اتبعت مرتين ما يتسجلش مرتين).
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import * as D from './delivery.ts';
import {
  createReturn,
  getInvoiceForDelivery,
  remainingReturnLines,
  resolveDeliveryCashbox,
  postDeliveryCashboxMovement,
  markDeliveryInvoicesPaid,
  closeDeliveryInvoiceAfterReturn,
  recordAuditLog
} from './sheetsService.ts';

export interface DeliverySession {
  userId: string;
  name?: string;
  username?: string;
  phone?: string;
  role: any;
  isOwner?: boolean;
  permissions: any[];
  token?: string;
}

const r2 = D.r2;

function who(session: DeliverySession) {
  return { id: session.userId, name: session.name, role: session.role, phone: session.phone };
}

function idemKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (key.length < 8 || key.length > 120) throw new D.DeliveryError('مفتاح العملية ناقص (idempotencyKey)');
  return key;
}

/** الطيار المربوط بالحساب ده */
export function driverForSession(session: DeliverySession): D.DeliveryDriver {
  const d = D.findDriverByUserId(session.userId);
  if (!d) throw new D.DeliveryError('حسابك مش مربوط بطيار في إعدادات التوصيل', 'NOT_A_DRIVER', 403);
  if (!d.active) throw new D.DeliveryError('حساب الطيار موقوف', 'DRIVER_INACTIVE', 403);
  return d;
}

/**
 * تغيير حالة الطلب.
 * body: { status, reason, note, refund: 'cash' | 'credit', refundCashboxId, refundDeliveryFee }
 */
export async function changeOrderStatus(
  orderId: string,
  body: any,
  session: DeliverySession,
  opts: { asDriver?: boolean } = {}
): Promise<{ order: D.DeliveryOrder; warning: string; returnNumber: string }> {
  const asDriverId = opts.asDriver ? driverForSession(session).id : undefined;
  const order = D.checkTransition(orderId, body?.status, { reason: body?.reason, asDriverId });
  const target = String(body.status) as D.DeliveryStatus;
  let returnNumber = '';

  if (target === 'رجع المحل' || target === 'اتلغى') {
    const inv = getInvoiceForDelivery(order.invoiceNumber);
    if (!inv) throw new D.DeliveryError(`فاتورة الطلب ${order.invoiceNumber} مش موجودة`);
    const lines = remainingReturnLines(order.invoiceNumber);
    if (lines.length > 0 && inv.status !== 'ملغاة') {
      const cod = order.paymentMode === 'cod';
      let refundStatus: 'قيد على الحساب' | 'استرداد نقدي' = 'قيد على الحساب';
      let cashboxId: string | undefined;
      let refundedAmount: number | undefined;
      if (!cod) {
        const customerCredit = inv.paymentType === 'آجل' || (body?.refund === 'credit' && Boolean(inv.customerId));
        if (!customerCredit) {
          if (!body?.refundCashboxId) throw new D.DeliveryError('الطلب مدفوع مقدمًا: اختار الخزنة اللي فلوس العميل هترجع منها');
          const cb = resolveDeliveryCashbox(body.refundCashboxId, session, 'payment');
          if (!cb.ok) throw new D.DeliveryError(cb.error || 'الخزنة مش متاحة');
          refundStatus = 'استرداد نقدي';
          cashboxId = cb.cashbox!.id;
          const itemsValue = (inv.lines || []).reduce((s, l) => {
            const left = lines.find(x => x.itemId === l.itemId);
            return s + (left ? Number(l.unitNet || 0) * Number(l.quantity || 0) : 0);
          }, 0);
          refundedAmount = r2(itemsValue + (body?.refundDeliveryFee ? Number(inv.deliveryFee || 0) : 0));
        }
      }
      const res = await createReturn(
        {
          invoiceNumber: order.invoiceNumber,
          idempotencyKey: `delivery-return-${order.id}`,
          warehouseId: inv.warehouseId,
          lines: lines.map(l => ({ itemId: l.itemId, itemName: l.itemName, returnedQuantity: l.returnedQuantity, itemCondition: 'يرجع المخزن' })),
          refundStatus,
          cashboxId,
          refundedAmount,
          returnReason: target === 'اتلغى' ? 'طلب توصيل اتلغى' : 'طلب توصيل رجع المحل',
          notes: `طلب التوصيل ${order.number}${body?.reason ? ` — ${String(body.reason).slice(0, 200)}` : ''}`
        },
        session as any,
        { fromDelivery: true, noCustomerEffect: cod }
      );
      if (!res.success || !res.returnRecord) throw new D.DeliveryError(res.error || 'تعذر عمل مرتجع البضاعة', res.code || 'RETURN_FAILED');
      returnNumber = res.returnRecord.returnNumber;
      if (cod) closeDeliveryInvoiceAfterReturn(order.invoiceNumber);
    }
  }

  const result = D.applyTransition(order.id, target, session, { reason: body?.reason, note: body?.note, returnNumber });
  recordAuditLog(
    who(session),
    'DELIVERY_STATUS',
    'DeliveryOrder',
    order.number,
    `طلب التوصيل ${order.number} (فاتورة ${order.invoiceNumber}): ${order.status} ← ${target}${body?.reason ? ` — ${String(body.reason).slice(0, 120)}` : ''}${returnNumber ? ` — مرتجع ${returnNumber}` : ''}${opts.asDriver ? ' (من الطيار)' : ''}`
  );
  return { ...result, returnNumber };
}

export function assignOrder(orderId: string, body: any, session: DeliverySession) {
  const result = D.assignOrder(orderId, body, session);
  recordAuditLog(who(session), 'DELIVERY_ASSIGN', 'DeliveryOrder', result.order.number, `توزيع طلب التوصيل ${result.order.number} على «${result.order.assigneeName}»`);
  return result;
}

export interface SettleResult {
  success: boolean;
  duplicate?: boolean;
  requiresConfirmation?: boolean;
  expected?: number;
  received?: number;
  shortage?: number;
  settlement?: D.DeliverySettlement;
  message?: string;
}

/**
 * التسوية. body: { assigneeType, assigneeId, orderIds, receivedAmount, cashboxId, confirmDifference, note, idempotencyKey }
 * الطيار: المستلم من 0 وطالع. شركة الشحن: ممكن يبقى بالسالب (رسومها أكتر من المحصل ← بتدفعلها).
 */
export function settle(body: any, session: DeliverySession): SettleResult {
  const key = idemKey(body?.idempotencyKey);
  const done = D.settlementByKey(key);
  if (done) return { success: true, duplicate: true, settlement: done };

  const preview = D.previewSettlement(body?.assigneeType, body?.assigneeId, body?.orderIds);
  if (preview.orders.length === 0) throw new D.DeliveryError(`مفيش طلبات اتسلمت ومستنية تسوية مع «${preview.assigneeName}»`);

  const raw = Number(body?.receivedAmount);
  if (body?.receivedAmount === undefined || body?.receivedAmount === null || String(body.receivedAmount).trim() === '' || !Number.isFinite(raw)) {
    throw new D.DeliveryError('اكتب المبلغ اللي استلمته فعلًا');
  }
  const received = r2(raw);
  if (preview.assigneeType === 'driver' && received < 0) throw new D.DeliveryError('المبلغ المستلم من الطيار لازم من 0 وطالع');

  const diff = r2(received - preview.expected);
  if (Math.abs(diff) >= 0.01 && body?.confirmDifference !== true) {
    return {
      success: false,
      requiresConfirmation: true,
      expected: preview.expected,
      received,
      shortage: r2(-diff),
      message:
        diff < 0
          ? `المستلم أقل من المفروض بـ ${Math.abs(diff)} ج.م، والعجز هيتسجل على «${preview.assigneeName}»`
          : `المستلم أكتر من المفروض بـ ${diff} ج.م، والزيادة هتتسجل لـ «${preview.assigneeName}»`
    };
  }

  const cb = resolveDeliveryCashbox(body?.cashboxId, session, received >= 0 ? 'receipt' : 'payment');
  if (!cb.ok) throw new D.DeliveryError(cb.error || 'الخزنة مش متاحة');

  const number = D.nextSettlementNumber();
  const actor = session.name || session.username || session.phone || 'المسؤول';
  if (received !== 0) {
    const moved = postDeliveryCashboxMovement({
      cashboxId: cb.cashbox!.id,
      amount: received,
      type: received > 0 ? 'تحصيل توصيل' : 'رسوم شركة شحن',
      documentNumber: number,
      party: preview.assigneeName,
      statement:
        received > 0
          ? `تسوية توصيل ${number} من «${preview.assigneeName}» (${preview.orders.length} طلب، المفروض ${preview.expected} ج.م)`
          : `رسوم شركة الشحن «${preview.assigneeName}» في التسوية ${number}`,
      userName: actor
    });
    if (!moved.ok) throw new D.DeliveryError(moved.error || 'تعذر تسجيل الحركة على الخزنة');
  }
  markDeliveryInvoicesPaid(preview.orders.filter(o => o.paymentMode === 'cod').map(o => o.invoiceNumber));
  const settlement = D.recordSettlement(preview, { received, cashboxId: cb.cashbox!.id, cashboxName: cb.cashbox!.name, note: body?.note, key }, session);
  recordAuditLog(
    who(session),
    'DELIVERY_SETTLE',
    'DeliverySettlement',
    settlement.number,
    `تسوية توصيل ${settlement.number} مع «${settlement.assigneeName}»: ${settlement.orderIds.length} طلب، المفروض ${settlement.expected}، المستلم ${settlement.received}${settlement.shortage ? `، ${settlement.shortage > 0 ? 'عجز' : 'زيادة'} ${Math.abs(settlement.shortage)}` : ''} ج.م — خزنة ${settlement.cashboxName}`
  );
  return { success: true, settlement };
}

export interface PayDriverResult {
  success: boolean;
  duplicate?: boolean;
  requiresConfirmation?: boolean;
  code?: string;
  payout?: D.DriverPayout;
  preview?: D.PayoutPreview;
  dues?: D.DriverDues;
  message?: string;
}

function sameOrderIdSet(a: unknown, b: string[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  const left = a.map(String).sort();
  const right = [...b].sort();
  return left.every((id, idx) => id === right[idx]);
}

function hasPayoutPreviewChanged(body: any, fresh: D.PayoutPreview): boolean {
  const eqMoney = (v: unknown, actual: number): boolean => {
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(r2(n) - actual) < 0.005;
  };
  const exp = body?.expectedPreview;
  if (exp && typeof exp === 'object') {
    if (!eqMoney(exp.paid, fresh.paid)) return true;
    if (exp.salary !== undefined && !eqMoney(exp.salary, fresh.salary)) return true;
    if (exp.commission !== undefined && !eqMoney(exp.commission, fresh.commission)) return true;
    if (exp.shortageDeducted !== undefined && !eqMoney(exp.shortageDeducted, fresh.shortageDeducted)) return true;
    if (exp.orderIds !== undefined && !sameOrderIdSet(exp.orderIds, fresh.orderIds)) return true;
    return false;
  }
  if (body?.expectedPaid !== undefined && body?.expectedPaid !== null && String(body.expectedPaid).trim() !== '') {
    return !eqMoney(body.expectedPaid, fresh.paid);
  }
  return false;
}

/** صرف مستحقات الطيار. body: { driverId, salary, payCommission, deductShortage, cashboxId, note, idempotencyKey, expectedPreview? } */
export function payDriver(body: any, session: DeliverySession): PayDriverResult {
  const key = idemKey(body?.idempotencyKey);
  const done = D.payoutByKey(key);
  if (done) return { success: true, duplicate: true, payout: done };

  const hasPreviewExpectation =
    (body?.expectedPreview && typeof body.expectedPreview === 'object') ||
    (body?.expectedPaid !== undefined && body?.expectedPaid !== null && String(body.expectedPaid).trim() !== '');

  if (hasPreviewExpectation) {
    const fresh = D.previewPayout(body?.driverId, body);
    if (hasPayoutPreviewChanged(body, fresh.preview)) {
      return {
        success: false,
        requiresConfirmation: true,
        code: 'PAYOUT_PREVIEW_CHANGED',
        preview: fresh.preview,
        dues: fresh.dues,
        message: 'تغيّرت مستحقات الطيار أو صافي المبلغ منذ المعاينة. راجع المعاينة المحدثة وأكّد الصرف من جديد.'
      };
    }
  }

  const plan = D.planPayout(body?.driverId, body);
  const cb = resolveDeliveryCashbox(body?.cashboxId, session, 'payment');
  if (!cb.ok) throw new D.DeliveryError(cb.error || 'الخزنة مش متاحة');
  const number = D.nextPayoutNumber();
  if (plan.paid > 0) {
    const moved = postDeliveryCashboxMovement({
      cashboxId: cb.cashbox!.id,
      amount: -plan.paid,
      type: 'مستحقات طيار',
      documentNumber: number,
      party: plan.driver.name,
      statement: `صرف مستحقات الطيار «${plan.driver.name}» ${number}: مرتب ${plan.salary} + عمولة ${plan.commission}${plan.shortageDeducted ? ` − عجز ${plan.shortageDeducted}` : ''} ج.م`,
      userName: session.name || session.username || session.phone || 'المسؤول'
    });
    if (!moved.ok) throw new D.DeliveryError(moved.error || 'تعذر تسجيل الحركة على الخزنة');
  }
  const payout = D.recordPayout(plan, { cashboxId: cb.cashbox!.id, cashboxName: cb.cashbox!.name, note: body?.note, key }, session);
  recordAuditLog(
    who(session),
    'DELIVERY_PAYOUT',
    'DriverPayout',
    payout.number,
    `صرف مستحقات الطيار «${payout.driverName}» ${payout.number}: ${payout.paid} ج.م (مرتب ${payout.salary}، عمولة ${payout.commission}، عجز مخصوم ${payout.shortageDeducted}) — خزنة ${payout.cashboxName}`
  );
  return { success: true, payout };
}

/** طلبات الطيار: المفتوحة + آخر 30 طلب اتقفلت */
export function myOrders(session: DeliverySession): { driver: D.DeliveryDriver; open: D.DeliveryOrder[]; recent: D.DeliveryOrder[]; custody: number } {
  const driver = driverForSession(session);
  const mine = D.listOrders({ assigneeType: 'driver', assigneeId: driver.id });
  return {
    driver,
    open: mine.filter(o => !D.FINAL_STATUSES.includes(o.status)),
    recent: mine.filter(o => D.FINAL_STATUSES.includes(o.status)).slice(0, 30),
    custody: D.driverCustody(driver.id)
  };
}

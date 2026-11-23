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
  createInvoice,
  createReturn,
  getInvoiceForDelivery,
  remainingReturnLines,
  resolveDeliveryCashbox,
  postDeliveryCashboxMovement,
  markDeliveryInvoicesPaid,
  closeDeliveryInvoiceAfterReturn,
  resolveForDeliveryPreparation,
  findInvoiceByIdempotencyKey,
  findInvoiceByNumber,
  linkInvoiceToPreparation,
  recordAuditLog
} from './sheetsService.ts';
import { DIRECT_SALE_PLATFORM_NAME } from './salesRules.ts';
import type { Invoice } from '../src/types/index.ts';

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

// ---------------------------------------------------------------------------
// طلبات تحضير التوصيل (المرحلة الثانية — تحضير قبل الشحن والفاتورة)
// ---------------------------------------------------------------------------

export function createPreparationOrder(
  body: any,
  session: DeliverySession
): { order: D.DeliveryPreparationOrder; duplicate?: boolean } {
  const key = idemKey(body?.idempotencyKey);
  const existing = D.preparationByKey(key);
  if (existing) {
    return { order: existing, duplicate: true };
  }

  const resolved = resolveForDeliveryPreparation({
    customerId: body?.customerId ?? '',
    lines: body?.lines,
    requireLines: true
  });
  if (!resolved.ok) {
    throw new D.DeliveryError(resolved.error || 'بيانات طلب التحضير غير صالحة', resolved.code || 'INVALID_INPUT');
  }

  const result = D.createPreparationOrder(
    { ...body, idempotencyKey: key },
    { customer: resolved.customer ?? null, lines: resolved.lines },
    session
  );

  if (!result.duplicate) {
    recordAuditLog(
      who(session),
      'DELIVERY_PREP_CREATED',
      'DeliveryPreparationOrder',
      result.order.number,
      `إنشاء طلب تحضير توصيل ${result.order.number} للعميل «${result.order.customerName}» (${result.order.lines.length} صنف — إجمالي تقديري ${result.order.estimatedTotal} ج.م)`
    );
  }
  return result;
}

export function updatePreparationOrder(
  idOrNumber: string,
  body: any,
  session: DeliverySession
): { order: D.DeliveryPreparationOrder } {
  const hasCustomerField = body && typeof body === 'object' && 'customerId' in body;
  const hasLinesField = body && typeof body === 'object' && body.lines !== undefined;

  const resolved = resolveForDeliveryPreparation({
    customerId: hasCustomerField ? body.customerId : undefined,
    lines: hasLinesField ? body.lines : undefined,
    requireLines: false
  });
  if (!resolved.ok) {
    throw new D.DeliveryError(resolved.error || 'بيانات تعديل طلب التحضير غير صالحة', resolved.code || 'INVALID_INPUT');
  }

  const order = D.updatePreparationOrder(
    idOrNumber,
    body,
    {
      customer: hasCustomerField ? (resolved.customer ?? null) : undefined,
      lines: hasLinesField ? resolved.lines : undefined
    },
    session
  );

  recordAuditLog(
    who(session),
    'DELIVERY_PREP_UPDATED',
    'DeliveryPreparationOrder',
    order.number,
    `تعديل طلب تحضير توصيل ${order.number} (المراجعة ${order.revision}) للعميل «${order.customerName}» (${order.lines.length} صنف — إجمالي تقديري ${order.estimatedTotal} ج.م)`
  );
  return { order };
}

export function cancelPreparationOrder(
  idOrNumber: string,
  body: any,
  session: DeliverySession
): { order: D.DeliveryPreparationOrder } {
  const order = D.cancelPreparationOrder(
    idOrNumber,
    { reason: body?.reason, revision: body?.revision },
    session
  );

  recordAuditLog(
    who(session),
    'DELIVERY_PREP_CANCELLED',
    'DeliveryPreparationOrder',
    order.number,
    `إلغاء طلب تحضير توصيل ${order.number} قبل الشحن${order.cancelReason ? ` — السبب: ${order.cancelReason}` : ''}`
  );
  return { order };
}

/**
 * المرحلة الثالثة: إرسال طلب تحضير قائم للشحن، وإصدار فاتورة البيع الرسمية وربطها بالطلب وسجل التوصيل.
 * - يتطلب وجود طيار أو شركة شحن صالحة ونشطة حسب إعدادات التوصيل الحالية.
 * - يعيد التحقق من الأصناف والكميات والمخزون المتاح فعليًا وقت الشحن.
 * - يستخدم مفتاح عدم تكرار حتمي مشتق من هوية طلب التحضير (`delivery-prep-dispatch:<prep.id>`).
 * - في حال انقطاع التنفيذ بعد `createInvoice` وقبل ربط طلب التحضير، تستعيد إعادة المحاولة الفاتورة الموجودة وتستكمل الربط دون تكرار الفاتورة أو خصم المخزون أو إنشاء `DeliveryOrder` ثانٍ.
 */
export async function dispatchPreparationOrder(
  idOrNumber: string,
  body: any,
  session: DeliverySession,
  options?: { simulateInterruptAfterInvoice?: boolean }
): Promise<{
  order: D.DeliveryPreparationOrder;
  invoice: Invoice;
  deliveryOrder: D.DeliveryOrder;
  duplicate?: boolean;
  recovered?: boolean;
}> {
  const src = body && typeof body === 'object' ? body : {};
  const { order: prep, alreadyDispatched, dispatchIdempotencyKey } = D.beginPreparationDispatch(
    idOrNumber,
    { revision: src.revision }
  );

  try {
    let existingInvoice =
      findInvoiceByIdempotencyKey(dispatchIdempotencyKey) ||
      (prep.invoiceNumber ? findInvoiceByNumber(prep.invoiceNumber) : undefined);

    if (alreadyDispatched && existingInvoice) {
      let existingDeliveryOrder =
        (prep.deliveryOrderId ? D.getOrder(prep.deliveryOrderId) : undefined) ||
        D.findOrderForInvoice(existingInvoice.invoiceNumber);

      if (existingDeliveryOrder) {
        existingDeliveryOrder =
          D.linkOrderToPreparation(existingDeliveryOrder.id, {
            id: prep.id,
            number: prep.number
          }) || existingDeliveryOrder;
        if (existingDeliveryOrder.status === 'جديد' && existingDeliveryOrder.assigneeId) {
          existingDeliveryOrder = D.applyTransition(
            existingDeliveryOrder.id,
            'خرج للتوصيل',
            session,
            { note: `شحن طلب التحضير ${prep.number} وإصدار الفاتورة ${existingInvoice.invoiceNumber}` }
          ).order;
        }
      }

      existingInvoice =
        linkInvoiceToPreparation(existingInvoice.invoiceNumber, {
          preparationId: prep.id,
          preparationNumber: prep.number,
          deliveryOrderId: existingDeliveryOrder?.id
        }) || existingInvoice;

      if (!existingDeliveryOrder) {
        throw new D.DeliveryError('سجل التوصيل المرتبط بالفاتورة غير موجود', 'DELIVERY_ORDER_NOT_FOUND', 404);
      }

      return {
        order: prep,
        invoice: existingInvoice,
        deliveryOrder: existingDeliveryOrder,
        duplicate: true
      };
    }

    const assigneeType = String(
      src.assigneeType !== undefined && String(src.assigneeType).trim() !== ''
        ? src.assigneeType
        : prep.assigneeType || ''
    ).trim();
    const assigneeId = String(
      src.assigneeId !== undefined && String(src.assigneeId).trim() !== ''
        ? src.assigneeId
        : prep.assigneeId || ''
    ).trim();
    const trackingNumber = String(
      src.trackingNumber !== undefined ? src.trackingNumber : prep.trackingNumber || ''
    ).trim();

    if ((assigneeType !== 'driver' && assigneeType !== 'courier') || !assigneeId) {
      throw new D.DeliveryError(
        'لازم تختار طيار أو شركة شحن نشطة قبل إرسال طلب التحضير للشحن',
        'ASSIGNEE_REQUIRED',
        400
      );
    }

    const resolvedCustomer = prep.customerId
      ? resolveForDeliveryPreparation({ customerId: prep.customerId, requireLines: false })
      : { ok: true, customer: null };
    if (!resolvedCustomer.ok) {
      throw new D.DeliveryError(
        resolvedCustomer.error || 'بيانات العميل غير صالحة',
        resolvedCustomer.code || 'CUSTOMER_NOT_FOUND',
        400
      );
    }

    const deliveryPlanInput = {
      paymentMode: prep.paymentMode,
      address: prep.address,
      phone: prep.phone,
      zoneId: prep.zoneId || undefined,
      fee: prep.feeManual ? prep.fee : undefined,
      preserveManualFee: prep.feeManual,
      assigneeType,
      assigneeId,
      trackingNumber,
      preparationId: prep.id,
      preparationNumber: prep.number
    };

    const plan = D.prepareDeliveryPlan(deliveryPlanInput, {
      isDirectSale: true,
      actor: session,
      customer:
        resolvedCustomer.customer ??
        (prep.customerId
          ? {
              id: prep.customerId,
              name: prep.customerName,
              phone: prep.phone,
              address: prep.address,
              zoneId: prep.zoneId
            }
          : null),
      customerName: prep.customerName
    });

    if (!plan.assignee) {
      throw new D.DeliveryError(
        'لازم تختار طيار أو شركة شحن نشطة قبل إرسال طلب التحضير للشحن',
        'ASSIGNEE_REQUIRED',
        400
      );
    }

    D.checkPlanTotals(plan, prep.itemsSubtotal);

    const hadInvoiceBeforeCall = Boolean(existingInvoice);
    const dispatchNotes = src.notes !== undefined ? String(src.notes ?? '') : prep.notes;

    const invRes = await createInvoice(
      {
        idempotencyKey: dispatchIdempotencyKey,
        preparationId: prep.id,
        preparationNumber: prep.number,
        platform: DIRECT_SALE_PLATFORM_NAME,
        customerId: prep.customerId || undefined,
        customerName: prep.customerName || undefined,
        warehouseId: src.warehouseId ? String(src.warehouseId) : undefined,
        cashboxId: src.cashboxId ? String(src.cashboxId) : undefined,
        paymentType: prep.paymentMode === 'cod' ? 'آجل' : 'نقدي',
        creditPartyType: prep.paymentMode === 'cod' ? 'delivery' : undefined,
        paymentMethod: src.paymentMethod ? String(src.paymentMethod) : undefined,
        paidAmount: src.paidAmount !== undefined ? Number(src.paidAmount) : undefined,
        referenceNumber: src.referenceNumber ? String(src.referenceNumber) : undefined,
        notes: dispatchNotes,
        lines: prep.lines.map(l => ({
          itemId: l.itemId,
          itemNameAtSale: l.itemName,
          quantity: l.quantity,
          salePriceAtSale: l.unitPrice,
          baseUnitPrice: l.unitPrice
        })),
        delivery: deliveryPlanInput
      },
      session as any
    );

    if (!invRes.success || !invRes.invoice) {
      const errCode = String((invRes as any).code || 'INVOICE_CREATE_FAILED');
      const rawStatus = Number((invRes as any).statusCode) || (errCode === 'INSUFFICIENT_STOCK' ? 409 : 400);
      const statusCode = errCode === 'INSUFFICIENT_STOCK' ? 409 : rawStatus;
      throw new D.DeliveryError(
        invRes.error || 'تعذر إصدار فاتورة البيع لطلب التحضير',
        errCode,
        statusCode
      );
    }

    if (options?.simulateInterruptAfterInvoice) {
      throw new Error('SIMULATED_INTERRUPT_AFTER_INVOICE');
    }

    const invoice = invRes.invoice;
    const wasRecovered = Boolean(hadInvoiceBeforeCall || (invRes as any).duplicate) && !alreadyDispatched;

    let deliveryOrder =
      (invoice.deliveryOrderId ? D.getOrder(invoice.deliveryOrderId) : undefined) ||
      D.findOrderForInvoice(invoice.invoiceNumber);

    if (!deliveryOrder) {
      deliveryOrder = D.createOrderForInvoice(
        plan,
        {
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.netAmount,
          preparationId: prep.id,
          preparationNumber: prep.number
        },
        session
      );
    }

    deliveryOrder =
      D.linkOrderToPreparation(deliveryOrder.id, {
        id: prep.id,
        number: prep.number
      }) || deliveryOrder;

    if (
      !deliveryOrder.assigneeId ||
      (deliveryOrder.status === 'جديد' &&
        (deliveryOrder.assigneeType !== plan.assignee.type ||
          deliveryOrder.assigneeId !== plan.assignee.id ||
          deliveryOrder.trackingNumber !== plan.trackingNumber))
    ) {
      deliveryOrder = D.assignOrder(
        deliveryOrder.id,
        {
          assigneeType: plan.assignee.type,
          assigneeId: plan.assignee.id,
          trackingNumber: plan.trackingNumber
        },
        session
      ).order;
    }

    if (deliveryOrder.status === 'جديد') {
      D.checkTransition(deliveryOrder.id, 'خرج للتوصيل');
      deliveryOrder = D.applyTransition(
        deliveryOrder.id,
        'خرج للتوصيل',
        session,
        { note: `شحن طلب التحضير ${prep.number} وإصدار الفاتورة ${invoice.invoiceNumber}` }
      ).order;
    }

    const linkedInvoice =
      linkInvoiceToPreparation(invoice.invoiceNumber, {
        preparationId: prep.id,
        preparationNumber: prep.number,
        deliveryOrderId: deliveryOrder.id
      }) || invoice;

    const updatedPrep = D.completePreparationDispatch(
      prep.id,
      {
        invoiceNumber: linkedInvoice.invoiceNumber,
        deliveryOrderId: deliveryOrder.id,
        deliveryOrderNumber: deliveryOrder.number,
        dispatchIdempotencyKey,
        assigneeType: deliveryOrder.assigneeType as D.AssigneeType,
        assigneeId: deliveryOrder.assigneeId,
        assigneeName: deliveryOrder.assigneeName,
        trackingNumber: deliveryOrder.trackingNumber,
        fee: deliveryOrder.fee,
        feeManual: deliveryOrder.feeManual,
        zoneId: deliveryOrder.zoneId,
        zoneName: deliveryOrder.zoneName,
        zoneCommission: deliveryOrder.zoneCommission,
        notes: src.notes !== undefined ? dispatchNotes : undefined
      },
      session
    );

    recordAuditLog(
      who(session),
      'DELIVERY_PREP_DISPATCHED',
      'DeliveryPreparationOrder',
      updatedPrep.number,
      `شحن طلب التحضير ${updatedPrep.number} وإصدار الفاتورة ${linkedInvoice.invoiceNumber} وسجل التوصيل ${deliveryOrder.number} (${deliveryOrder.assigneeName} — ${linkedInvoice.netAmount} ج.م)${
        wasRecovered ? ' [استكمال ربط بعد إعادة محاولة]' : ''
      }`
    );

    return {
      order: updatedPrep,
      invoice: linkedInvoice,
      deliveryOrder,
      ...(wasRecovered ? { duplicate: true, recovered: true } : {})
    };
  } catch (err) {
    // إذا فشل التحقق أو إصدار الفاتورة قبل إنشاء أي فاتورة في الذاكرة، نعيد طلب التحضير لحالته القابلة للتعديل «قيد التحضير»
    const createdInv = findInvoiceByIdempotencyKey(dispatchIdempotencyKey);
    if (!createdInv && !alreadyDispatched) {
      D.revertPreparationDispatch(prep.id);
    }
    throw err;
  }
}


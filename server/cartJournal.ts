/**
 * سجل أصناف شاشة البيع غير المباعة — POS مدقق
 * ---------------------------------------------------------------------------
 * كل صنف يُضرب في شاشة البيع يصل هنا خلال ثانية تقريبًا (أو عند رجوع الإنترنت).
 * عند حفظ الفاتورة يُخصم ما بِيع، وما يبقى هو «أصناف دخلت الفاتورة ولم تُبع»
 * مع الحدث: حذف / تقليل كمية / تفريغ / إغلاق الصفحة / تسجيل خروج / إغلاق مفاجئ.
 *
 * مهم للأداء: هذا السجل له حالته وقفله وحفظه المستقل (شركة فرعية باسم <tenant>_journal)
 * ولا يمر بطابور الحفظ الرئيسي، فلا يؤخر حفظ الفواتير.
 *
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import { StatePersistence, type RpcTransport, type CollectionDef } from './persistence/statePersistence.ts';

export type CartLineEvent = 'scan' | 'remove' | 'reduce' | 'clear';
export type CartCloseReason = 'page_close' | 'logout' | 'crash' | 'other';
export type ReportEvent = 'open' | 'remove' | 'reduce' | 'clear' | 'page_close' | 'logout' | 'crash' | 'other';
export type ReportCartStatus = 'open' | 'abandoned' | 'sold';

export interface JournalEventInput {
  eventId?: string;
  seq: number;
  at?: string;
  cartId: string;
  type: 'qty' | 'clear' | 'close';
  itemId?: string;
  itemName?: string;
  barcode?: string;
  unitPrice?: number;
  /** الكمية الإجمالية للصنف داخل الفاتورة بعد الحدث (0 = حُذف) */
  qty?: number;
  reason?: string;
  warehouseId?: string;
  warehouseName?: string;
  platform?: string;
}

export interface JournalActor {
  userId: string;
  userName: string;
}

interface CartLine {
  itemId: string;
  itemName: string;
  barcode: string;
  unitPrice: number;
  peakQty: number;
  currentQty: number;
  lastEvent: CartLineEvent;
  lastEventAt: string;
}

interface CartRecord {
  id: string;
  deviceId: string;
  userId: string;
  userName: string;
  warehouseId: string;
  warehouseName: string;
  platform: string;
  openedAt: string;
  lastActivityAt: string;
  status: 'open' | 'closed' | 'sold';
  closeReason: CartCloseReason | '';
  closedAt: string;
  invoiceNumbers: string[];
  soldAt: string;
  sold: Record<string, number>;
  receivedLate: boolean;
  lines: CartLine[];
}

interface DeviceRecord {
  id: string;
  userId: string;
  userName: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSeq: number;
  seenEventIds?: string[];
  missingSeqs?: number[];
}

export interface JournalAlert {
  id: string;
  type: 'new_device' | 'sequence_gap';
  typeLabel: string;
  deviceId: string;
  userId: string;
  userName: string;
  at: string;
  detail: string;
}

export interface UnsoldReportRow {
  cartId: string;
  cartStatus: ReportCartStatus;
  cartStatusLabel: string;
  event: ReportEvent;
  eventLabel: string;
  itemId: string;
  itemName: string;
  barcode: string;
  quantity: number;
  unitPrice: number;
  value: number;
  fromQty: number | null;
  toQty: number | null;
  at: string;
  userId: string;
  userName: string;
  deviceId: string;
  warehouseName: string;
  platform: string;
  invoiceNumber: string;
  receivedLate: boolean;
}

export interface UnsoldReportFilters {
  from?: string;
  to?: string;
  userId?: string;
  status?: ReportCartStatus | '';
  event?: ReportEvent | '';
}

export interface UnsoldReport {
  rows: UnsoldReportRow[];
  summary: {
    rows: number;
    quantity: number;
    value: number;
    openCarts: number;
    byUser: { userId: string; userName: string; rows: number; quantity: number; value: number }[];
  };
  alerts: JournalAlert[];
}

export class CartJournalError extends Error {
  code: 'INVALID_INPUT' | 'UNAVAILABLE';
  constructor(code: 'INVALID_INPUT' | 'UNAVAILABLE', message: string) {
    super(message);
    this.name = 'CartJournalError';
    this.code = code;
  }
}

export interface CartJournalOptions {
  /** ناقل قاعدة البيانات. بدون ناقل يعمل السجل في الذاكرة فقط (وضع المعاينة والاختبارات) */
  transport?: RpcTransport | null;
  /** اسم الشركة الأساسية؛ يُحفظ السجل تحت <tenant>_journal */
  tenant?: string;
  now?: () => Date;
  log?: (message: string) => void;
  /** مدة عدم النشاط التي تُعتبر بعدها الفاتورة المفتوحة «متروكة» */
  idleMs?: number;
}

const MAX_EVENTS_PER_BATCH = 500;
const MAX_DEVICE_TRACKED_HISTORY = 4000;
const SOLD_CART_KEEP_MS = 3 * 24 * 60 * 60 * 1000;
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const LATE_MS = 2 * 60 * 1000;
const PURGE_EVERY_MS = 10 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

const EVENT_LABELS: Record<ReportEvent, string> = {
  open: 'فاتورة مفتوحة الآن',
  remove: 'حذف صنف من الفاتورة',
  reduce: 'تقليل الكمية',
  clear: 'تفريغ الفاتورة',
  page_close: 'إغلاق أو تحديث الصفحة',
  logout: 'تسجيل خروج',
  crash: 'إغلاق مفاجئ أو ترك الفاتورة',
  other: 'إغلاق الفاتورة بدون بيع'
};

const STATUS_LABELS: Record<ReportCartStatus, string> = {
  open: 'مفتوحة الآن',
  abandoned: 'متروكة بدون بيع',
  sold: 'بيعت الفاتورة'
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (value: unknown, max = 200) => String(value ?? '').trim().slice(0, max);
const formatQty = (n: number) => String(round3(n));

export class CartJournal {
  private carts: CartRecord[] = [];
  private devices: DeviceRecord[] = [];
  private alerts: JournalAlert[] = [];
  private cartIndex = new Map<string, CartRecord>();
  private deviceIndex = new Map<string, DeviceRecord>();
  private engine: StatePersistence | null = null;
  private now: () => Date;
  private log: (message: string) => void;
  private idleMs: number;
  private flushing: Promise<void> | null = null;
  private dirty = false;
  private lastPurgeAt = 0;
  private alertCounter = 0;
  private soldResolver: ((cartId: string) => { invoiceNumber: string; lines: { itemId: string; quantity: number }[] } | null) | null = null;

  constructor(options: CartJournalOptions = {}) {
    this.now = options.now || (() => new Date());
    this.log = options.log || (message => console.log(`[cart-journal] ${message}`));
    this.idleMs = options.idleMs ?? 10 * 60 * 1000;

    if (options.transport) {
      const base = text(options.tenant || 'main', 40) || 'main';
      const collections: CollectionDef[] = [
        { name: 'carts', kind: 'list', get: () => this.carts, set: v => { this.carts = v; }, idOf: d => d.id },
        { name: 'devices', kind: 'list', get: () => this.devices, set: v => { this.devices = v; }, idOf: d => d.id },
        { name: 'alerts', kind: 'list', get: () => this.alerts, set: v => { this.alerts = v; }, idOf: d => d.id }
      ];
      this.engine = new StatePersistence({
        transport: options.transport,
        tenant: `${base}_journal`,
        collections,
        afterHydrate: () => this.rebuildIndexes(),
        log: message => this.log(message)
      });
    }
  }

  /** يربط السجل بالفواتير: لو الفاتورة محفوظة ولم يصل إشعار بيعها للسجل يُصحَّح تلقائيًا عند عرض التقرير */
  setSoldResolver(resolver: (cartId: string) => { invoiceNumber: string; lines: { itemId: string; quantity: number }[] } | null) {
    this.soldResolver = resolver;
  }

  async start(): Promise<boolean> {
    if (!this.engine) return true;
    const ok = await this.engine.start();
    this.rebuildIndexes();
    return ok;
  }

  stop() {
    if (this.engine) this.engine.stop();
  }

  isReady(): boolean {
    return !this.engine || this.engine.isReady();
  }

  private rebuildIndexes() {
    this.cartIndex = new Map(this.carts.map(c => [c.id, c]));
    this.deviceIndex = new Map(this.devices.map(d => [d.id, d]));
  }

  // ---- الحفظ المجمّع: عدة طلبات متزامنة تشترك في عملية حفظ واحدة ----------

  private async flush(): Promise<void> {
    if (!this.engine) return;
    this.dirty = true;
    while (this.flushing) await this.flushing;
    if (!this.dirty) return;
    this.dirty = false;
    const engine = this.engine;
    this.flushing = engine.lock
      .run(async () => {
        try {
          await engine.persist();
        } catch (err) {
          await engine.recover();
          this.rebuildIndexes();
          throw err;
        }
      })
      .finally(() => {
        this.flushing = null;
      });
    await this.flushing;
  }

  private async mutate<T>(fn: () => T): Promise<T> {
    if (!this.isReady()) {
      throw new CartJournalError('UNAVAILABLE', 'سجل شاشة البيع غير متاح حاليًا. ستُعاد المحاولة تلقائيًا.');
    }
    this.purgeIfDue();
    const result = fn();
    try {
      await this.flush();
    } catch {
      throw new CartJournalError('UNAVAILABLE', 'تعذر حفظ سجل شاشة البيع. ستُعاد المحاولة تلقائيًا.');
    }
    return result;
  }

  // ---- استقبال الأحداث -------------------------------------------------------

  private eventTime(raw: unknown, nowMs: number): { iso: string; late: boolean } {
    const parsed = typeof raw === 'string' ? Date.parse(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed > nowMs + LATE_MS) {
      return { iso: new Date(nowMs).toISOString(), late: false };
    }
    return { iso: new Date(parsed).toISOString(), late: nowMs - parsed > LATE_MS };
  }

  private addAlert(type: JournalAlert['type'], device: DeviceRecord, detail: string) {
    const nowIso = this.now().toISOString();
    this.alertCounter += 1;
    this.alerts.unshift({
      id: `al-${Date.parse(nowIso).toString(36)}-${this.alertCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      typeLabel: type === 'new_device' ? 'جهاز جديد بدأ التسجيل' : 'سجل الجهاز ناقص',
      deviceId: device.id,
      userId: device.userId,
      userName: device.userName,
      at: nowIso,
      detail
    });
  }

  private getOrCreateCart(cartId: string, deviceId: string, actor: JournalActor, atIso: string): CartRecord {
    let cart = this.cartIndex.get(cartId);
    if (!cart) {
      cart = {
        id: cartId,
        deviceId,
        userId: actor.userId,
        userName: actor.userName,
        warehouseId: '',
        warehouseName: '',
        platform: '',
        openedAt: atIso,
        lastActivityAt: atIso,
        status: 'open',
        closeReason: '',
        closedAt: '',
        invoiceNumbers: [],
        soldAt: '',
        sold: {},
        receivedLate: false,
        lines: []
      };
      this.carts.unshift(cart);
      this.cartIndex.set(cartId, cart);
    }
    return cart;
  }

  /**
   * يستقبل دفعة أحداث من جهاز.
   * - آمن للتكرار عبر معرّف الحدث الثابت (eventId) ورقم التسلسل (seq).
   * - لا يُسقط أحداثًا أقدم إذا وصلت دفعة أحدث أولًا: يسجل الفجوات في missingSeqs ويقبل الأحداث المتأخرة عند وصولها.
   * - يرجع آخر رقم مسلسل مستلم ليحذف الجهاز ما تم تأكيده فقط.
   */
  async applyEvents(deviceIdRaw: unknown, eventsRaw: unknown, actor: JournalActor): Promise<{ lastSeq: number; applied: number; duplicates: number }> {
    const deviceId = text(deviceIdRaw, 64);
    if (!ID_PATTERN.test(deviceId)) throw new CartJournalError('INVALID_INPUT', 'معرّف الجهاز غير صالح');
    if (!Array.isArray(eventsRaw)) throw new CartJournalError('INVALID_INPUT', 'قائمة الأحداث غير صالحة');
    if (eventsRaw.length > MAX_EVENTS_PER_BATCH) {
      throw new CartJournalError('INVALID_INPUT', `عدد الأحداث في الطلب الواحد يجب ألا يتجاوز ${MAX_EVENTS_PER_BATCH}`);
    }
    const userId = text(actor?.userId, 80);
    if (!userId) throw new CartJournalError('INVALID_INPUT', 'المستخدم غير معروف');
    const cleanActor: JournalActor = { userId, userName: text(actor?.userName, 120) };

    const events = (eventsRaw as any[])
      .filter(e => e && Number.isInteger(e.seq) && e.seq > 0 && ID_PATTERN.test(text(e.cartId, 64)) && ['qty', 'clear', 'close'].includes(e.type))
      .sort((a, b) => a.seq - b.seq) as JournalEventInput[];

    return this.mutate(() => {
      const nowMs = this.now().getTime();
      const nowIso = new Date(nowMs).toISOString();
      let device = this.deviceIndex.get(deviceId);
      const isNewDevice = !device;
      if (!device) {
        device = {
          id: deviceId,
          userId: cleanActor.userId,
          userName: cleanActor.userName,
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          lastSeq: 0,
          seenEventIds: [],
          missingSeqs: []
        };
        this.devices.push(device);
        this.deviceIndex.set(deviceId, device);
        this.addAlert('new_device', device, 'أول تسجيل من هذا الجهاز أو المتصفح (أو تم مسح بياناته)');
      }
      device.userId = cleanActor.userId;
      device.userName = cleanActor.userName;
      device.lastSeenAt = nowIso;

      const seenIdsSet = new Set<string>(Array.isArray(device.seenEventIds) ? device.seenEventIds : []);
      const missingSeqsSet = new Set<number>(Array.isArray(device.missingSeqs) ? device.missingSeqs : []);

      let applied = 0;
      let duplicates = 0;
      for (const event of events) {
        const rawEventId = text(event.eventId, 64);
        const cleanEventId = rawEventId && ID_PATTERN.test(rawEventId) ? rawEventId : '';

        if (cleanEventId && seenIdsSet.has(cleanEventId)) {
          missingSeqsSet.delete(event.seq);
          duplicates++;
          continue;
        }

        let isOutOfOrderHistorical = false;
        if (event.seq <= device.lastSeq) {
          if (missingSeqsSet.has(event.seq)) {
            // حدث أقدم وصل بعد دفعة أحدث كانت قد سبقته: نقبله ولا نسقطه
            missingSeqsSet.delete(event.seq);
            isOutOfOrderHistorical = true;
          } else {
            duplicates++;
            continue;
          }
        } else {
          if (event.seq > device.lastSeq + 1) {
            const gapStart = Math.max(device.lastSeq + 1, event.seq - MAX_DEVICE_TRACKED_HISTORY);
            for (let missing = gapStart; missing < event.seq; missing++) {
              missingSeqsSet.add(missing);
            }
            // جهاز يظهر لأول مرة قد يبدأ من أي رقم (مثلًا بعد إعادة ضبط النظام): لا نصدر تنبيه نقص في أول حدث له
            if (!(isNewDevice && applied === 0)) {
              this.addAlert('sequence_gap', device, `أحداث مفقودة من رقم ${device.lastSeq + 1} إلى رقم ${event.seq - 1}`);
            }
          }
          device.lastSeq = event.seq;
        }

        if (cleanEventId) {
          seenIdsSet.add(cleanEventId);
        }
        applied++;

        const time = this.eventTime(event.at, nowMs);
        const cart = this.getOrCreateCart(text(event.cartId, 64), deviceId, cleanActor, time.iso);
        cart.userId = cleanActor.userId;
        cart.userName = cleanActor.userName;
        if (time.late) cart.receivedLate = true;
        if (time.iso > cart.lastActivityAt) cart.lastActivityAt = time.iso;
        if (event.warehouseId) cart.warehouseId = text(event.warehouseId, 80);
        if (event.warehouseName) cart.warehouseName = text(event.warehouseName, 120);
        if (event.platform) cart.platform = text(event.platform, 120);

        if (event.type === 'qty') {
          const itemId = text(event.itemId, 80);
          const qty = Number(event.qty);
          if (!itemId || !Number.isFinite(qty) || qty < 0) continue;
          let line = cart.lines.find(l => l.itemId === itemId);
          const isNewLine = !line;
          if (!line) {
            line = { itemId, itemName: '', barcode: '', unitPrice: 0, peakQty: 0, currentQty: 0, lastEvent: 'scan', lastEventAt: time.iso };
            cart.lines.push(line);
          }
          if (event.itemName) line.itemName = text(event.itemName, 200);
          if (event.barcode) line.barcode = text(event.barcode, 80);
          if (Number.isFinite(Number(event.unitPrice)) && Number(event.unitPrice) >= 0) line.unitPrice = round2(Number(event.unitPrice));
          const next = round3(qty);
          line.peakQty = Math.max(line.peakQty, next);
          const isOlderThanCurrentLineState = !isNewLine && isOutOfOrderHistorical && time.iso < line.lastEventAt;
          if (!isOlderThanCurrentLineState) {
            if (next > line.currentQty) line.lastEvent = 'scan';
            else if (next === 0) line.lastEvent = 'remove';
            else if (next < line.currentQty) line.lastEvent = 'reduce';
            line.currentQty = next;
            line.lastEventAt = time.iso;
            if (cart.status === 'closed') {
              cart.status = 'open';
              cart.closeReason = '';
              cart.closedAt = '';
            }
          }
        } else if (event.type === 'clear') {
          for (const line of cart.lines) {
            const isOlderThanLine = isOutOfOrderHistorical && time.iso < line.lastEventAt;
            if (!isOlderThanLine && line.currentQty > 0) {
              line.currentQty = 0;
              line.lastEvent = 'clear';
              line.lastEventAt = time.iso;
            }
          }
        } else if (event.type === 'close') {
          const isOlderThanCartActivity = isOutOfOrderHistorical && time.iso < cart.lastActivityAt;
          if (!isOlderThanCartActivity) {
            const reason = text(event.reason, 20);
            cart.closeReason = (['page_close', 'logout', 'crash'].includes(reason) ? reason : 'other') as CartCloseReason;
            cart.closedAt = time.iso;
            if (cart.status === 'open') cart.status = 'closed';
          }
        }
      }

      device.seenEventIds = Array.from(seenIdsSet).slice(-MAX_DEVICE_TRACKED_HISTORY);
      device.missingSeqs = Array.from(missingSeqsSet).slice(-MAX_DEVICE_TRACKED_HISTORY);
      return { lastSeq: device.lastSeq, applied, duplicates };
    });
  }

  // ---- إشعار البيع ---------------------------------------------------------

  private applySold(cartIdRaw: unknown, invoiceNumberRaw: unknown, soldLines: { itemId: string; quantity: number }[], actor: JournalActor): boolean {
    const cartId = text(cartIdRaw, 64);
    const invoiceNumber = text(invoiceNumberRaw, 80);
    if (!ID_PATTERN.test(cartId) || !invoiceNumber) return false;
    const nowIso = this.now().toISOString();
    const cart = this.getOrCreateCart(cartId, '', { userId: text(actor?.userId, 80), userName: text(actor?.userName, 120) }, nowIso);
    if (cart.invoiceNumbers.includes(invoiceNumber)) return false;
    cart.invoiceNumbers.push(invoiceNumber);
    for (const line of Array.isArray(soldLines) ? soldLines : []) {
      const itemId = text(line?.itemId, 80);
      const quantity = Number(line?.quantity);
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0) continue;
      cart.sold[itemId] = round3((cart.sold[itemId] || 0) + quantity);
    }
    cart.status = 'sold';
    cart.soldAt = nowIso;
    return true;
  }

  /** يُستدعى بعد حفظ الفاتورة بنجاح: يخصم ما بِيع من سجل الفاتورة المفتوحة */
  async markCartSold(cartId: unknown, invoiceNumber: unknown, soldLines: { itemId: string; quantity: number }[], actor: JournalActor): Promise<boolean> {
    if (!ID_PATTERN.test(text(cartId, 64))) return false;
    return this.mutate(() => this.applySold(cartId, invoiceNumber, soldLines, actor));
  }

  /** إعادة الضبط: يمسح الفواتير المفتوحة والمتروكة، ومع keepDevices=false يمسح الأجهزة والتنبيهات أيضًا */
  async resetAll(options: { keepDevices?: boolean } = {}): Promise<void> {
    await this.mutate(() => {
      this.carts = [];
      if (!options.keepDevices) {
        this.devices = [];
        this.alerts = [];
      }
      this.rebuildIndexes();
    });
  }

  // ---- التنظيف -----------------------------------------------------------------

  private purgeIfDue() {
    const nowMs = this.now().getTime();
    if (nowMs - this.lastPurgeAt < PURGE_EVERY_MS) return;
    this.lastPurgeAt = nowMs;
    const before = this.carts.length;
    this.carts = this.carts.filter(cart => {
      const last = Date.parse(cart.soldAt || cart.lastActivityAt) || nowMs;
      if (nowMs - last > RETENTION_MS) return false;
      if (cart.status === 'sold' && nowMs - last > SOLD_CART_KEEP_MS && !this.cartHasLeftover(cart)) return false;
      return true;
    });
    this.alerts = this.alerts.filter(alert => nowMs - (Date.parse(alert.at) || nowMs) <= RETENTION_MS);
    if (this.carts.length !== before) this.rebuildIndexes();
  }

  private cartHasLeftover(cart: CartRecord): boolean {
    return cart.lines.some(line => round3(line.peakQty - (cart.sold[line.itemId] || 0)) > 0);
  }

  // ---- التقرير -----------------------------------------------------------------

  getReport(filters: UnsoldReportFilters = {}): UnsoldReport {
    const nowMs = this.now().getTime();

    // تصحيح ذاتي: فاتورة محفوظة لم يصل إشعار بيعها للسجل
    if (this.soldResolver) {
      let healed = false;
      for (const cart of this.carts) {
        if (cart.status === 'sold') continue;
        const sale = this.soldResolver(cart.id);
        if (sale && this.applySold(cart.id, sale.invoiceNumber, sale.lines, { userId: cart.userId, userName: cart.userName })) healed = true;
      }
      if (healed) this.flush().catch(() => undefined);
    }

    const fromMs = filters.from ? Date.parse(filters.from) : NaN;
    const toMs = filters.to ? Date.parse(filters.to) : NaN;
    const inRange = (iso: string) => {
      const t = Date.parse(iso);
      if (Number.isFinite(fromMs) && t < fromMs) return false;
      if (Number.isFinite(toMs) && t > toMs) return false;
      return true;
    };

    const rows: UnsoldReportRow[] = [];
    let openCarts = 0;
    for (const cart of this.carts) {
      let cartStatus: ReportCartStatus;
      let cartEvent: ReportEvent;
      if (cart.status === 'sold') {
        cartStatus = 'sold';
        cartEvent = 'remove';
      } else if (cart.closeReason) {
        cartStatus = 'abandoned';
        cartEvent = cart.closeReason;
      } else if (nowMs - (Date.parse(cart.lastActivityAt) || nowMs) > this.idleMs) {
        cartStatus = 'abandoned';
        cartEvent = 'crash';
      } else {
        cartStatus = 'open';
        cartEvent = 'open';
      }
      if (cartStatus === 'open' && cart.lines.some(l => l.currentQty > 0)) openCarts++;

      const push = (line: CartLine, event: ReportEvent, quantity: number, at: string, fromQty: number | null, toQty: number | null) => {
        if (!(quantity > 0)) return;
        const eventLabel =
          event === 'reduce' && fromQty !== null && toQty !== null
            ? `قلّت الكمية من ${formatQty(fromQty)} إلى ${formatQty(toQty)}`
            : EVENT_LABELS[event];
        rows.push({
          cartId: cart.id,
          cartStatus,
          cartStatusLabel: STATUS_LABELS[cartStatus],
          event,
          eventLabel,
          itemId: line.itemId,
          itemName: line.itemName,
          barcode: line.barcode,
          quantity: round3(quantity),
          unitPrice: line.unitPrice,
          value: round2(quantity * line.unitPrice),
          fromQty,
          toQty,
          at,
          userId: cart.userId,
          userName: cart.userName,
          deviceId: cart.deviceId,
          warehouseName: cart.warehouseName,
          platform: cart.platform,
          invoiceNumber: cart.invoiceNumbers.join('، '),
          receivedLate: cart.receivedLate
        });
      };

      for (const line of cart.lines) {
        if (!(line.peakQty > 0)) continue;
        // الكمية «الباقية في الفاتورة»: للمباعة = ما بِيع فعلًا، ولغير المباعة = الكمية الحالية
        const kept = cart.status === 'sold' ? Math.min(line.peakQty, cart.sold[line.itemId] || 0) : line.currentQty;
        const removed = round3(line.peakQty - kept);
        if (removed > 0) {
          const event: ReportEvent = kept > 0 ? 'reduce' : line.lastEvent === 'clear' ? 'clear' : 'remove';
          push(line, event, removed, line.lastEventAt, kept > 0 ? line.peakQty : null, kept > 0 ? kept : null);
        }
        if (cart.status !== 'sold' && kept > 0) {
          push(line, cartEvent, kept, cart.closedAt || cart.lastActivityAt, null, null);
        }
      }
    }

    const filtered = rows
      .filter(row => inRange(row.at))
      .filter(row => !filters.userId || row.userId === filters.userId)
      .filter(row => !filters.status || row.cartStatus === filters.status)
      .filter(row => !filters.event || row.event === filters.event)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    const byUser = new Map<string, { userId: string; userName: string; rows: number; quantity: number; value: number }>();
    for (const row of filtered) {
      const entry = byUser.get(row.userId) || { userId: row.userId, userName: row.userName, rows: 0, quantity: 0, value: 0 };
      entry.rows += 1;
      entry.quantity = round3(entry.quantity + row.quantity);
      entry.value = round2(entry.value + row.value);
      byUser.set(row.userId, entry);
    }

    return {
      rows: filtered,
      summary: {
        rows: filtered.length,
        quantity: round3(filtered.reduce((sum, row) => sum + row.quantity, 0)),
        value: round2(filtered.reduce((sum, row) => sum + row.value, 0)),
        openCarts,
        byUser: Array.from(byUser.values()).sort((a, b) => b.value - a.value)
      },
      alerts: this.alerts.filter(alert => inRange(alert.at)).slice(0, 200)
    };
  }
}

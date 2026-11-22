/**
 * طبقة حفظ الحالة الدائم — POS مدقق
 * ---------------------------------------------------------------------------
 * الفكرة: منطق النظام كله يعمل على مصفوفات الذاكرة كما هو. هذه الطبقة:
 *   1) تحمّل الحالة من قاعدة البيانات عند تشغيل السيرفر.
 *   2) بعد كل عملية كتابة تقارن الحالة الحالية بآخر حالة محفوظة،
 *      وترسل الفروق فقط في معاملة واحدة ذرّية (الكل أو لا شيء).
 *   3) عند فشل الحفظ تعيد تحميل الحالة من قاعدة البيانات (تراجع كامل).
 *
 * ملاحظات مهمة:
 *   - الملف لا يستخدم إلا صياغة TypeScript القابلة للإزالة (بدون enum وبدون
 *     parameter properties) حتى يعمل مع `node server.ts` مباشرة.
 *   - لا يعتمد على أي مكتبة خارجية: الاتصال بـ Supabase عبر fetch فقط.
 *   - المفتاح السري لا يُطبع في السجلات أبدًا.
 *
 * هذا الملف: المحرّك (الأنواع + قفل الكتابة + التحميل + حساب الفروق + الحفظ).
 */
 
import { randomUUID, createHash } from 'node:crypto';
 
// ---------------------------------------------------------------------------
// الأنواع
// ---------------------------------------------------------------------------
 
export type RpcTransport = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
 
export type PersistenceErrorCode =
  | 'STATE_CONFLICT'
  | 'NETWORK'
  | 'AUTH'
  | 'DB_ERROR'
  | 'NOT_READY'
  | 'CONFIG';
 
export class PersistenceError extends Error {
  code: PersistenceErrorCode;
  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
  }
}
 
export interface CollectionDef {
  /** اسم ثابت للمجموعة في قاعدة البيانات — ممنوع تغييره بعد أول تشغيل */
  name: string;
  /** list = مصفوفة سجلات، single = كائن واحد (إعدادات مثلًا) */
  kind: 'list' | 'single';
  get: () => any;
  set: (value: any) => void;
  /** معرّف السجل داخل المجموعة (للمصفوفات فقط). لو غير موجود يُستخدم بصمة المحتوى */
  idOf?: (doc: any) => string | number | null | undefined;
  /** سجلات لا تُحذف من قاعدة البيانات حتى لو اختفت من الذاكرة (سجل التدقيق) */
  appendOnly?: boolean;
}
 
interface BaselineEntry {
  json: string;
  rank: number;
}
 
export interface ChangeRow {
  collection: string;
  id: string;
  data?: unknown;
}
 
interface DiffResult {
  upserts: ChangeRow[];
  deletes: ChangeRow[];
  next: Map<string, Map<string, BaselineEntry>>;
  approxBytes: number;
}
 
export interface PersistResult {
  changed: number;
  upserts: number;
  deletes: number;
  generation: number;
  staged: boolean;
}
 
export interface PersistenceStatus {
  enabled: boolean;
  ready: boolean;
  tenant: string;
  generation: number;
  documents: number;
  lastLoadAt: string | null;
  lastPersistAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}
 
export interface StatePersistenceOptions {
  transport: RpcTransport;
  tenant: string;
  collections: CollectionDef[];
  /** اسم السيرفر الكاتب (للتشخيص فقط) */
  writer?: string;
  /** تُستدعى عندما تكون قاعدة البيانات فارغة: جهّز الحالة الابتدائية النظيفة */
  onEmpty?: () => void | Promise<void>;
  /** تُستدعى بعد كل تحميل ناجح من قاعدة البيانات */
  afterHydrate?: () => void | Promise<void>;
  log?: (message: string) => void;
  /** أقصى عدد تغييرات في الطلب المباشر قبل التحويل للحفظ المرحلي */
  directLimit?: number;
  /** أقصى حجم تقريبي (بايت) للطلب الواحد */
  maxChunkBytes?: number;
  pageSize?: number;
}
 
const SINGLE_ID = '_';
const RANK_STEP = 1024;
const MIN_RANK_GAP = 1e-6;
 
// ---------------------------------------------------------------------------
// قفل الكتابة: عملية كتابة واحدة في كل لحظة
// ---------------------------------------------------------------------------
 
export class WriteLock {
  private tail: Promise<void> = Promise.resolve();
 
  /** ينتظر الدور ثم يعيد دالة تحرير القفل (آمنة للاستدعاء أكثر من مرة) */
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>(resolve => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => next);
    let released = false;
    return previous.then(() => () => {
      if (!released) {
        released = true;
        release();
      }
    });
  }
 
  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
 
// ---------------------------------------------------------------------------
// المحرّك
// ---------------------------------------------------------------------------
 
function safeStringify(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) return 'null';
  // قاعدة البيانات لا تقبل الحرف الصفري داخل النصوص
  return json.includes('\\u0000') ? json.split('\\u0000').join('') : json;
}
 
function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}
 
/** مفتاح بديل للسجلات التي ليس لها معرّف: بصمة المحتوى (لا تتأثر بترتيب المفاتيح) */
function contentKey(json: string): string {
  const canonical = JSON.stringify(canonicalize(JSON.parse(json)));
  return `~${createHash('sha1').update(canonical).digest('hex').slice(0, 20)}`;
}
 
export class StatePersistence {
  readonly lock = new WriteLock();
  private transport: RpcTransport;
  private tenant: string;
  private writer: string;
  private collections: CollectionDef[];
  private byName = new Map<string, CollectionDef>();
  private baseline = new Map<string, Map<string, BaselineEntry>>();
  private generation = 0;
  private ready = false;
  private onEmpty?: () => void | Promise<void>;
  private afterHydrate?: () => void | Promise<void>;
  private log: (message: string) => void;
  private directLimit: number;
  private maxChunkBytes: number;
  private pageSize: number;
  private lastLoadAt: string | null = null;
  private lastPersistAt: string | null = null;
  private lastError: string | null = null;
  private lastErrorAt: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private warned = new Set<string>();
 
  constructor(options: StatePersistenceOptions) {
    const tenant = String(options.tenant || '').trim();
    if (!tenant) throw new PersistenceError('CONFIG', 'اسم الشركة (tenant) مطلوب لطبقة الحفظ');
    this.transport = options.transport;
    this.tenant = tenant;
    this.writer = options.writer || `srv-${randomUUID().slice(0, 8)}`;
    this.collections = options.collections;
    this.onEmpty = options.onEmpty;
    this.afterHydrate = options.afterHydrate;
    this.log = options.log || (message => console.log(`[persistence] ${message}`));
    this.directLimit = options.directLimit ?? 400;
    this.maxChunkBytes = options.maxChunkBytes ?? 1_500_000;
    this.pageSize = options.pageSize ?? 1000;
 
    for (const def of this.collections) {
      if (!def.name || this.byName.has(def.name)) {
        throw new PersistenceError('CONFIG', `اسم مجموعة مكرر أو فارغ في سجل الحفظ: "${def.name}"`);
      }
      this.byName.set(def.name, def);
    }
  }
 
  isReady(): boolean {
    return this.ready;
  }
 
  getStatus(): PersistenceStatus {
    let documents = 0;
    for (const map of this.baseline.values()) documents += map.size;
    return {
      enabled: true,
      ready: this.ready,
      tenant: this.tenant,
      generation: this.generation,
      documents,
      lastLoadAt: this.lastLoadAt,
      lastPersistAt: this.lastPersistAt,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt
    };
  }
 
  /** نسخة JSON كاملة من الحالة الحالية (للاختبارات والمقارنة) */
  exportState(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const def of this.collections) {
      out[def.name] = JSON.parse(safeStringify(def.get() ?? (def.kind === 'list' ? [] : null)));
    }
    return out;
  }
 
  private noteError(err: unknown) {
    this.lastError = String((err as any)?.message || err);
    this.lastErrorAt = new Date().toISOString();
  }
 
  private warnOnce(key: string, message: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.log(`تحذير: ${message}`);
  }
 
  // ---- التحميل ------------------------------------------------------------
 
  private async fetchAllRows(): Promise<{ generation: number; rows: ChangeRow[] }> {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const rows: ChangeRow[] = [];
      let generation: number | null = null;
      let afterCollection = '';
      let afterId = '';
      let consistent = true;
      for (;;) {
        const page: any = await this.transport('app_load_page', {
          p_tenant: this.tenant,
          p_after_collection: afterCollection,
          p_after_id: afterId,
          p_limit: this.pageSize
        });
        const pageGeneration = Number(page?.generation ?? 0);
        const pageRows: ChangeRow[] = Array.isArray(page?.rows) ? page.rows : [];
        if (generation === null) generation = pageGeneration;
        else if (generation !== pageGeneration) {
          consistent = false;
          break;
        }
        rows.push(...pageRows);
        if (pageRows.length < this.pageSize) break;
        const last = pageRows[pageRows.length - 1];
        afterCollection = last.collection;
        afterId = last.id;
      }
      if (consistent) return { generation: generation ?? 0, rows };
      this.log(`تغيّرت الحالة أثناء التحميل — إعادة المحاولة (${attempt})`);
    }
    throw new PersistenceError('STATE_CONFLICT', 'تعذر تحميل حالة ثابتة: سيرفر آخر يكتب على نفس الشركة');
  }
 
  /** تحميل الحالة من قاعدة البيانات وتعبئة الذاكرة بها */
  async load(): Promise<{ empty: boolean; documents: number; generation: number }> {
    const { generation, rows } = await this.fetchAllRows();
    this.generation = generation;
    this.baseline = new Map();
 
    if (rows.length === 0) {
      this.lastLoadAt = new Date().toISOString();
      return { empty: true, documents: 0, generation };
    }
 
    const grouped = new Map<string, { id: string; rank: number; value: any }[]>();
    for (const row of rows) {
      const wrapper: any = row.data;
      const hasWrapper = wrapper && typeof wrapper === 'object' && 'v' in wrapper;
      const entry = {
        id: row.id,
        rank: hasWrapper && typeof wrapper.r === 'number' ? wrapper.r : 0,
        value: hasWrapper ? wrapper.v : wrapper
      };
      if (!grouped.has(row.collection)) grouped.set(row.collection, []);
      grouped.get(row.collection)!.push(entry);
    }
 
    for (const name of grouped.keys()) {
      if (!this.byName.has(name)) {
        this.warnOnce(`unknown:${name}`, `مجموعة "${name}" موجودة في قاعدة البيانات وغير مسجلة في الكود — تُترك كما هي`);
      }
    }
 
    for (const def of this.collections) {
      const entries = grouped.get(def.name) || [];
      const map = new Map<string, BaselineEntry>();
      if (def.kind === 'single') {
        const entry = entries.find(e => e.id === SINGLE_ID) || entries[0];
        if (entry) {
          def.set(entry.value);
          // نقرأ القيمة عبر get حتى يطابق ترتيب المفاتيح ما سيُقارن به لاحقًا
          const current = def.get();
          map.set(SINGLE_ID, { json: safeStringify(current ?? entry.value), rank: 0 });
        }
      } else {
        entries.sort((a, b) => (a.rank === b.rank ? (a.id < b.id ? -1 : 1) : a.rank - b.rank));
        def.set(entries.map(e => e.value));
        const current = def.get();
        const aligned = Array.isArray(current) && current.length === entries.length;
        entries.forEach((e, index) => {
          map.set(e.id, { json: safeStringify(aligned ? current[index] : e.value), rank: e.rank });
        });
      }
      this.baseline.set(def.name, map);
    }
 
    this.lastLoadAt = new Date().toISOString();
    return { empty: false, documents: rows.length, generation };
  }
 
  // ---- حساب الفروق ---------------------------------------------------------
 
  private assignRanks(keys: string[], previous: Map<string, BaselineEntry>): number[] {
    const count = keys.length;
    const ranks: (number | undefined)[] = keys.map(k => previous.get(k)?.rank);
    const renumber = () => keys.map((_, i) => (i + 1) * RANK_STEP);
 
    let lastKnown = -Infinity;
    for (const r of ranks) {
      if (r === undefined) continue;
      if (!(r > lastKnown)) return renumber();
      lastKnown = r;
    }
 
    let i = 0;
    while (i < count) {
      if (ranks[i] !== undefined) {
        i++;
        continue;
      }
      let j = i;
      while (j < count && ranks[j] === undefined) j++;
      const before = i > 0 ? (ranks[i - 1] as number) : undefined;
      const after = j < count ? (ranks[j] as number) : undefined;
      const missing = j - i;
      if (before === undefined && after === undefined) {
        for (let k = 0; k < missing; k++) ranks[i + k] = (k + 1) * RANK_STEP;
      } else if (before === undefined) {
        for (let k = 0; k < missing; k++) ranks[i + k] = (after as number) - (missing - k) * RANK_STEP;
      } else if (after === undefined) {
        for (let k = 0; k < missing; k++) ranks[i + k] = before + (k + 1) * RANK_STEP;
      } else {
        const gap = (after - before) / (missing + 1);
        if (!(gap > MIN_RANK_GAP)) return renumber();
        for (let k = 0; k < missing; k++) ranks[i + k] = before + gap * (k + 1);
      }
      i = j;
    }
    return ranks as number[];
  }
 
  private computeDiff(): DiffResult {
    const upserts: ChangeRow[] = [];
    const deletes: ChangeRow[] = [];
    const next = new Map<string, Map<string, BaselineEntry>>();
    let approxBytes = 0;
 
    for (const def of this.collections) {
      const previous = this.baseline.get(def.name) || new Map<string, BaselineEntry>();
      const current = new Map<string, BaselineEntry>();
 
      if (def.kind === 'single') {
        const value = def.get();
        if (value !== undefined && value !== null) {
          const json = safeStringify(value);
          const old = previous.get(SINGLE_ID);
          if (!old || old.json !== json) {
            upserts.push({ collection: def.name, id: SINGLE_ID, data: { r: 0, v: JSON.parse(json) } });
            approxBytes += json.length;
            current.set(SINGLE_ID, { json, rank: 0 });
          } else {
            current.set(SINGLE_ID, old);
          }
        } else if (previous.has(SINGLE_ID)) {
          deletes.push({ collection: def.name, id: SINGLE_ID });
        }
        next.set(def.name, current);
        continue;
      }
 
      const list: any[] = Array.isArray(def.get()) ? def.get() : [];
      const keys: string[] = [];
      const jsons: string[] = [];
      const seen = new Set<string>();
      for (const doc of list) {
        if (doc === undefined || doc === null) continue;
        const json = safeStringify(doc);
        let key = '';
        if (def.idOf) {
          const raw = def.idOf(doc);
          key = raw === undefined || raw === null ? '' : String(raw).trim();
        }
        if (!key) key = contentKey(json);
        if (seen.has(key)) {
          this.warnOnce(`dup:${def.name}`, `معرّف مكرر في المجموعة "${def.name}" (${key}) — تم تمييزه تلقائيًا`);
          let n = 2;
          while (seen.has(`${key}#${n}`)) n++;
          key = `${key}#${n}`;
        }
        seen.add(key);
        keys.push(key);
        jsons.push(json);
      }
 
      const ranks = this.assignRanks(keys, previous);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const old = previous.get(key);
        if (old && old.json === jsons[i] && old.rank === ranks[i]) {
          current.set(key, old);
        } else {
          upserts.push({ collection: def.name, id: key, data: { r: ranks[i], v: JSON.parse(jsons[i]) } });
          approxBytes += jsons[i].length + 64;
          current.set(key, { json: jsons[i], rank: ranks[i] });
        }
      }
      if (!def.appendOnly) {
        for (const key of previous.keys()) {
          if (!current.has(key)) {
            deletes.push({ collection: def.name, id: key });
            approxBytes += 64;
          }
        }
      }
      next.set(def.name, current);
    }
    return { upserts, deletes, next, approxBytes };
  }
 
  /** هل توجد تغييرات لم تُحفظ بعد؟ */
  hasPendingChanges(): boolean {
    const diff = this.computeDiff();
    return diff.upserts.length + diff.deletes.length > 0;
  }
 
  // ---- الحفظ ----------------------------------------------------------------
 
  /**
   * يحفظ كل ما تغيّر منذ آخر حفظ في معاملة واحدة.
   * يجب استدعاؤها داخل قفل الكتابة (الوسيط يفعل ذلك تلقائيًا).
   */
  async persist(): Promise<PersistResult> {
    if (!this.ready) throw new PersistenceError('NOT_READY', 'قاعدة البيانات غير جاهزة بعد');
    const diff = this.computeDiff();
    const total = diff.upserts.length + diff.deletes.length;
    if (total === 0) {
      return { changed: 0, upserts: 0, deletes: 0, generation: this.generation, staged: false };
    }
 
    let newGeneration: unknown;
    let staged = false;
    try {
      if (total <= this.directLimit && diff.approxBytes <= this.maxChunkBytes) {
        newGeneration = await this.transport('app_persist_changes', {
          p_tenant: this.tenant,
          p_expected_generation: this.generation,
          p_upserts: diff.upserts,
          p_deletes: diff.deletes,
          p_writer: this.writer
        });
      } else {
        staged = true;
        const tx = randomUUID();
        try {
          let chunk: ChangeRow[] = [];
          let chunkBytes = 0;
          const flushUpserts = async () => {
            if (chunk.length === 0) return;
            await this.transport('app_persist_stage', { p_tx: tx, p_tenant: this.tenant, p_upserts: chunk, p_deletes: [] });
            chunk = [];
            chunkBytes = 0;
          };
          for (const row of diff.upserts) {
            const size = safeStringify(row.data).length + 64;
            if (chunk.length >= this.directLimit || (chunk.length > 0 && chunkBytes + size > this.maxChunkBytes)) {
              await flushUpserts();
            }
            chunk.push(row);
            chunkBytes += size;
          }
          await flushUpserts();
          for (let i = 0; i < diff.deletes.length; i += 2000) {
            await this.transport('app_persist_stage', {
              p_tx: tx,
              p_tenant: this.tenant,
              p_upserts: [],
              p_deletes: diff.deletes.slice(i, i + 2000)
            });
          }
          newGeneration = await this.transport('app_persist_commit', {
            p_tx: tx,
            p_tenant: this.tenant,
            p_expected_generation: this.generation,
            p_writer: this.writer
          });
        } catch (err) {
          this.transport('app_persist_abort', { p_tx: tx }).catch(() => undefined);
          throw err;
        }
      }
    } catch (err) {
      this.noteError(err);
      throw err;
    }
 
    this.generation = Number(newGeneration);
    this.baseline = diff.next;
    this.lastPersistAt = new Date().toISOString();
    this.lastError = null;
    return { changed: total, upserts: diff.upserts.length, deletes: diff.deletes.length, generation: this.generation, staged };
  }
 
  // ---- التشغيل والاستعادة ---------------------------------------------------
 
  private async loadAndPrepare(): Promise<void> {
    const result = await this.load();
    if (result.empty) {
      if (this.onEmpty) await this.onEmpty();
      this.ready = true;
      const saved = await this.persist();
      this.log(`قاعدة البيانات فارغة للشركة "${this.tenant}" — تم إنشاء الحالة الابتدائية (${saved.changed} سجل)`);
    } else {
      this.ready = true;
      this.log(`تم تحميل ${result.documents} سجل للشركة "${this.tenant}" (إصدار ${result.generation})`);
    }
    if (this.afterHydrate) await this.afterHydrate();
    this.lastError = null;
  }
 
  /**
   * بدء التشغيل: يحمّل الحالة. لو فشل الاتصال يبقى النظام «غير جاهز»
   * ويعيد المحاولة تلقائيًا كل 10 ثوانٍ دون إسقاط السيرفر.
   */
  async start(): Promise<boolean> {
    return this.lock.run(async () => {
      try {
        await this.loadAndPrepare();
        return true;
      } catch (err) {
        this.ready = false;
        this.noteError(err);
        this.log(`فشل تحميل الحالة: ${this.lastError}`);
        this.scheduleRetry();
        return false;
      }
    });
  }
 
  private scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.start().catch(() => undefined);
    }, 10_000);
    if (typeof (this.retryTimer as any).unref === 'function') (this.retryTimer as any).unref();
  }
 
  /**
   * الاستعادة بعد فشل الحفظ: تجاهل ما في الذاكرة وأعد التحميل من قاعدة البيانات.
   * تُستدعى داخل قفل الكتابة.
   */
  async recover(): Promise<boolean> {
    try {
      const result = await this.load();
      if (result.empty) {
        if (this.onEmpty) await this.onEmpty();
        this.ready = true;
        await this.persist();
      }
      this.ready = true;
      if (this.afterHydrate) await this.afterHydrate();
      this.log('تمت استعادة الحالة من قاعدة البيانات بعد فشل عملية');
      return true;
    } catch (err) {
      this.ready = false;
      this.noteError(err);
      this.log(`فشل استعادة الحالة: ${this.lastError}`);
      this.scheduleRetry();
      return false;
    }
  }
 
  /** حفظ دوري للتغييرات التي تحدث خارج الطلبات (مؤقتات، ترحيلات عند القراءة) */
  startAutoFlush(intervalMs = 60_000) {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      if (!this.ready) return;
      this.lock
        .run(async () => {
          if (!this.ready) return;
          try {
            await this.persist();
          } catch {
            await this.recover();
          }
        })
        .catch(() => undefined);
    }, intervalMs);
    if (typeof (this.flushTimer as any).unref === 'function') (this.flushTimer as any).unref();
  }
 
  stop() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.flushTimer = null;
    this.retryTimer = null;
  }
}

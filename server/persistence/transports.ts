/**
 * نواقل طبقة الحفظ — POS مدقق
 *   - createSupabaseTransport: الاتصال الحقيقي بـ Supabase (PostgREST RPC عبر HTTPS).
 *   - createFakeTransport: قاعدة بيانات وهمية داخل الذاكرة للاختبارات الآلية فقط.
 * المفتاح السري لا يُطبع في السجلات أبدًا.
 */
import { PersistenceError, type RpcTransport, type PersistenceErrorCode, type ChangeRow } from './engine.ts';

// ---------------------------------------------------------------------------
// ناقل Supabase (PostgREST RPC عبر HTTPS)
// ---------------------------------------------------------------------------

export function createSupabaseTransport(opts: {
  url: string;
  secretKey: string;
  timeoutMs?: number;
  /** للاختبارات المحلية فقط: عنوان PostgREST مباشر بدل <url>/rest/v1 */
  restUrl?: string;
}): RpcTransport {
  const base = (opts.restUrl || `${String(opts.url || '').replace(/\/+$/, '')}/rest/v1`).replace(/\/+$/, '');
  const key = String(opts.secretKey || '').trim();
  const timeoutMs = opts.timeoutMs ?? 45000;

  return async (fn, args) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    let text = '';
    try {
      res = await fetch(`${base}/rpc/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify(args),
        signal: controller.signal
      });
      text = await res.text();
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? 'انتهت مهلة الاتصال' : String(err?.message || err);
      throw new PersistenceError('NETWORK', `تعذر الاتصال بقاعدة البيانات (${fn}): ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      const message = String((body && (body.message || body.error || body.msg)) || text || res.statusText);
      if (message.includes('STATE_CONFLICT')) {
        throw new PersistenceError('STATE_CONFLICT', `STATE_CONFLICT ${body?.details || ''}`.trim());
      }
      if (res.status === 401 || res.status === 403) {
        throw new PersistenceError('AUTH', `قاعدة البيانات رفضت المفتاح (${res.status}): ${message}`);
      }
      throw new PersistenceError('DB_ERROR', `خطأ من قاعدة البيانات (${fn}) [${res.status}]: ${message}`);
    }
    return body;
  };
}

// ---------------------------------------------------------------------------
// ناقل وهمي داخل الذاكرة — للاختبارات الآلية فقط (نفس سلوك دوال قاعدة البيانات)
// ---------------------------------------------------------------------------

export interface FakeTransportHandle {
  transport: RpcTransport;
  /** محتوى «قاعدة البيانات» الوهمية */
  dump: (tenant: string) => { generation: number; rows: ChangeRow[] };
  /** اجعل النداء التالي يفشل (لمحاكاة انقطاع الشبكة) */
  failNext: (code?: PersistenceErrorCode, fnName?: string) => void;
  calls: { fn: string; rows: number }[];
}

export function createFakeTransport(): FakeTransportHandle {
  const docs = new Map<string, Map<string, { collection: string; id: string; data: unknown }>>();
  const generations = new Map<string, number>();
  const staging = new Map<string, { tenant: string; op: 'upsert' | 'delete'; row: ChangeRow }[]>();
  const calls: { fn: string; rows: number }[] = [];
  let pendingFailure: { code: PersistenceErrorCode; fn?: string } | null = null;

  const tenantDocs = (tenant: string) => {
    if (!docs.has(tenant)) docs.set(tenant, new Map());
    return docs.get(tenant)!;
  };
  const docKey = (collection: string, id: string) => `${collection}\u0001${id}`;
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const validate = (rows: any[], needData: boolean) => {
    for (const row of rows) {
      if (!row || !row.collection || !row.id || (needData && (row.data === undefined || row.data === null))) {
        throw new PersistenceError('DB_ERROR', 'INVALID_CHANGE_ROW');
      }
    }
  };
  const checkGeneration = (tenant: string, expected: number) => {
    const actual = generations.get(tenant) ?? 0;
    if (actual !== expected) {
      throw new PersistenceError('STATE_CONFLICT', `STATE_CONFLICT expected=${expected} actual=${actual}`);
    }
    return actual;
  };

  const transport: RpcTransport = async (fn, args: any) => {
    const upserts: any[] = Array.isArray(args.p_upserts) ? args.p_upserts : [];
    const deletes: any[] = Array.isArray(args.p_deletes) ? args.p_deletes : [];
    calls.push({ fn, rows: upserts.length + deletes.length });
    if (pendingFailure && (!pendingFailure.fn || pendingFailure.fn === fn)) {
      const failure = pendingFailure;
      pendingFailure = null;
      throw new PersistenceError(failure.code, `محاكاة فشل (${fn})`);
    }
    const tenant = String(args.p_tenant || '');
    switch (fn) {
      case 'app_get_generation':
        return generations.get(tenant) ?? 0;
      case 'app_persist_changes': {
        const g = checkGeneration(tenant, Number(args.p_expected_generation));
        validate(upserts, true);
        validate(deletes, false);
        const store = tenantDocs(tenant);
        for (const row of upserts) store.set(docKey(row.collection, row.id), clone({ collection: row.collection, id: row.id, data: row.data }));
        for (const row of deletes) store.delete(docKey(row.collection, row.id));
        generations.set(tenant, g + 1);
        return g + 1;
      }
      case 'app_persist_stage': {
        validate(upserts, true);
        validate(deletes, false);
        const tx = String(args.p_tx);
        if (!staging.has(tx)) staging.set(tx, []);
        const list = staging.get(tx)!;
        for (const row of upserts) list.push({ tenant, op: 'upsert', row: clone(row) });
        for (const row of deletes) list.push({ tenant, op: 'delete', row: clone(row) });
        return upserts.length + deletes.length;
      }
      case 'app_persist_commit': {
        const g = checkGeneration(tenant, Number(args.p_expected_generation));
        const store = tenantDocs(tenant);
        for (const entry of staging.get(String(args.p_tx)) || []) {
          if (entry.tenant !== tenant) continue;
          if (entry.op === 'upsert') store.set(docKey(entry.row.collection, entry.row.id), entry.row as any);
          else store.delete(docKey(entry.row.collection, entry.row.id));
        }
        staging.delete(String(args.p_tx));
        generations.set(tenant, g + 1);
        return g + 1;
      }
      case 'app_persist_abort': {
        const n = (staging.get(String(args.p_tx)) || []).length;
        staging.delete(String(args.p_tx));
        return n;
      }
      case 'app_load_page': {
        const limit = Math.min(Math.max(Number(args.p_limit) || 1000, 1), 5000);
        const afterCollection = String(args.p_after_collection || '');
        const afterId = String(args.p_after_id || '');
        const sorted = Array.from(tenantDocs(tenant).values()).sort((a, b) =>
          a.collection === b.collection ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.collection < b.collection ? -1 : 1
        );
        const rows = sorted
          .filter(r => r.collection > afterCollection || (r.collection === afterCollection && r.id > afterId))
          .slice(0, limit)
          .map(r => clone(r));
        return { generation: generations.get(tenant) ?? 0, count: rows.length, rows };
      }
      case 'app_reset_test_tenant': {
        if (!(tenant.startsWith('test_') || tenant.startsWith('dev'))) {
          throw new PersistenceError('DB_ERROR', 'ONLY_TEST_TENANTS_CAN_BE_RESET');
        }
        const n = tenantDocs(tenant).size;
        docs.delete(tenant);
        generations.delete(tenant);
        return n;
      }
      default:
        throw new PersistenceError('DB_ERROR', `دالة غير معروفة: ${fn}`);
    }
  };

  return {
    transport,
    calls,
    failNext: (code = 'NETWORK', fnName) => {
      pendingFailure = { code, fn: fnName };
    },
    dump: tenant => ({
      generation: generations.get(tenant) ?? 0,
      rows: Array.from(tenantDocs(tenant).values()).map(r => clone(r))
    })
  };
}

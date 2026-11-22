/**
 * ربط طبقة الحفظ بـ Express — POS مدقق
 *   - createPersistenceMiddleware: وسيط «احفظ ثم رُد» مع قفل كتابة واحد.
 *   - readPersistenceEnv: قراءة إعدادات Supabase من متغيرات البيئة.
 */
import type { StatePersistence } from './engine.ts';

// ---------------------------------------------------------------------------
// وسيط Express: «احفظ ثم رُد»
// ---------------------------------------------------------------------------

export interface PersistenceMiddlewareOptions {
  /** مسارات تُستثنى تمامًا (تعمل حتى لو قاعدة البيانات غير متاحة) */
  alwaysAllow?: (path: string, method: string) => boolean;
  /** أقصى مدة احتفاظ بالقفل لطلب واحد */
  lockTimeoutMs?: number;
}

const UNAVAILABLE_MESSAGE = 'قاعدة البيانات غير متاحة حاليًا. حاول مرة أخرى بعد لحظات.';
const SAVE_FAILED_MESSAGE =
  'تعذر حفظ العملية في قاعدة البيانات، ولم يتم تسجيلها. راجع البيانات ثم أعد المحاولة.';
const CONFLICT_MESSAGE =
  'تم تحديث البيانات من مصدر آخر. تمت إعادة تحميل البيانات — أعد العملية مرة أخرى.';

export function createPersistenceMiddleware(engine: StatePersistence | null, options: PersistenceMiddlewareOptions = {}) {
  const lockTimeoutMs = options.lockTimeoutMs ?? 120_000;

  return function persistenceMiddleware(req: any, res: any, next: (err?: unknown) => void) {
    if (!engine) return next();
    const method = String(req.method || 'GET').toUpperCase();
    const path = String(req.path || req.url || '');
    if (options.alwaysAllow && options.alwaysAllow(path, method)) return next();

    if (!engine.isReady()) {
      res.status(503).json({ success: false, code: 'DATABASE_UNAVAILABLE', error: UNAVAILABLE_MESSAGE });
      return;
    }
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

    engine.lock.acquire().then(release => {
      const safety = setTimeout(release, lockTimeoutMs);
      const done = () => {
        clearTimeout(safety);
        release();
      };

      if (!engine.isReady()) {
        done();
        res.status(503).json({ success: false, code: 'DATABASE_UNAVAILABLE', error: UNAVAILABLE_MESSAGE });
        return;
      }

      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      const originalEnd = res.end.bind(res);
      let finalizing = false;

      const finalize = (sendOriginal: () => void) => {
        if (finalizing) {
          sendOriginal();
          return;
        }
        finalizing = true;

        const fail = (err: any) => {
          const conflict = err && err.code === 'STATE_CONFLICT';
          if (!res.headersSent) {
            res.status(conflict ? 409 : 503);
            originalJson({
              success: false,
              code: conflict ? 'STATE_CONFLICT' : 'SAVE_FAILED',
              error: conflict ? CONFLICT_MESSAGE : SAVE_FAILED_MESSAGE
            });
          } else {
            originalEnd();
          }
        };

        (async () => {
          // خطأ داخلي في المعالجة: لا نحفظ حالة ناقصة، بل نتراجع لآخر حالة محفوظة
          if (res.statusCode >= 500) {
            if (engine.hasPendingChanges()) await engine.recover();
            sendOriginal();
            return;
          }
          try {
            await engine.persist();
            sendOriginal();
          } catch (err) {
            await engine.recover();
            fail(err);
          }
        })()
          .catch(err => {
            try {
              fail(err);
            } catch {
              /* تجاهل */
            }
          })
          .finally(done);
      };

      res.json = (body: unknown) => {
        finalize(() => originalJson(body));
        return res;
      };
      res.send = (body: unknown) => {
        finalize(() => originalSend(body));
        return res;
      };
      res.end = (...args: unknown[]) => {
        finalize(() => originalEnd(...args));
        return res;
      };

      next();
    });
  };
}

// ---------------------------------------------------------------------------
// قراءة الإعدادات من متغيرات البيئة
// ---------------------------------------------------------------------------

export interface PersistenceEnv {
  enabled: boolean;
  url: string;
  secretKey: string;
  tenant: string;
  restUrl: string;
  problem: string | null;
}

export function readPersistenceEnv(env: Record<string, string | undefined> = process.env): PersistenceEnv {
  const url = String(env.SUPABASE_URL || '').trim();
  const secretKey = String(env.SUPABASE_SECRET_KEY || '').trim();
  const tenant = String(env.SUPABASE_TENANT_ID || 'main').trim() || 'main';
  const restUrl = String(env.SUPABASE_REST_URL || '').trim();
  let problem: string | null = null;
  if (!url && !secretKey) {
    return { enabled: false, url, secretKey, tenant, restUrl, problem };
  }
  if (!url || !secretKey) {
    problem = 'يجب ضبط SUPABASE_URL و SUPABASE_SECRET_KEY معًا';
  } else if (!/^https?:\/\//i.test(url)) {
    problem = 'قيمة SUPABASE_URL يجب أن تبدأ بـ https://';
  } else if (!/^[a-z0-9_-]{1,40}$/i.test(tenant)) {
    problem = 'قيمة SUPABASE_TENANT_ID يجب أن تكون حروفًا إنجليزية وأرقامًا فقط';
  }
  return { enabled: true, url, secretKey, tenant, restUrl, problem };
}

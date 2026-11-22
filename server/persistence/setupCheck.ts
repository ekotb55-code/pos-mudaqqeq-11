/**
 * فحص اتصال وتهيئة قاعدة البيانات — POS مدقق
 * كل الفحوص آمنة: لا تكتب ولا تغيّر أي بيانات.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RpcTransport } from './engine.ts';

export interface DatabaseCheckItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface DatabaseCheckResult {
  /** الاتصال بقاعدة البيانات يعمل والمفتاح مقبول */
  connected: boolean;
  /** كل دوال وجداول التهيئة موجودة */
  initialized: boolean;
  latencyMs: number | null;
  message: string;
  items: DatabaseCheckItem[];
}

function classify(err: any): { missing: boolean; auth: boolean; network: boolean; text: string } {
  const text = String(err?.message || err || '');
  const code = String(err?.code || '');
  return {
    missing: /Could not find the function|PGRST202|does not exist|42883|دالة غير معروفة/i.test(text),
    auth: code === 'AUTH' || /permission denied|42501|Invalid API key|JWT/i.test(text),
    network: code === 'NETWORK',
    text
  };
}

/**
 * يفحص الاتصال ثم وجود دوال التهيئة واحدة واحدة.
 * tenant: اسم الشركة الحالية (للقراءة فقط).
 */
export async function checkDatabaseSetup(transport: RpcTransport, tenant: string): Promise<DatabaseCheckResult> {
  const items: DatabaseCheckItem[] = [];
  let connected = false;
  let latencyMs: number | null = null;

  const run = async (key: string, label: string, call: () => Promise<unknown>, expectError?: RegExp) => {
    try {
      await call();
      items.push({ key, label, ok: true, detail: 'موجودة وتعمل' });
      return true;
    } catch (err) {
      const info = classify(err);
      if (expectError && expectError.test(info.text)) {
        items.push({ key, label, ok: true, detail: 'موجودة وتعمل' });
        return true;
      }
      const detail = info.network
        ? 'تعذر الوصول إلى قاعدة البيانات'
        : info.auth
        ? 'المفتاح السري غير مقبول أو لا يملك الصلاحية'
        : info.missing
        ? 'غير موجودة — شغّل كود التهيئة'
        : `خطأ: ${info.text.slice(0, 160)}`;
      items.push({ key, label, ok: false, detail });
      return false;
    }
  };

  // 1) الاتصال: أبسط نداء قراءة
  const started = Date.now();
  let firstError: ReturnType<typeof classify> | null = null;
  try {
    await transport('app_load_page', { p_tenant: tenant, p_after_collection: '', p_after_id: '', p_limit: 1 });
    connected = true;
    latencyMs = Date.now() - started;
    items.push({ key: 'app_load_page', label: 'تحميل البيانات', ok: true, detail: 'موجودة وتعمل' });
  } catch (err) {
    firstError = classify(err);
    // لو الرد «الدالة غير موجودة» فالاتصال نفسه سليم لكن القاعدة غير مهيأة
    connected = firstError.missing;
    if (connected) latencyMs = Date.now() - started;
    items.push({
      key: 'app_load_page',
      label: 'تحميل البيانات',
      ok: false,
      detail: firstError.network
        ? 'تعذر الوصول إلى قاعدة البيانات'
        : firstError.auth
        ? 'المفتاح السري غير مقبول أو لا يملك الصلاحية'
        : firstError.missing
        ? 'غير موجودة — شغّل كود التهيئة'
        : `خطأ: ${firstError.text.slice(0, 160)}`
    });
  }

  if (connected) {
    await run('app_persist_stage', 'تجهيز العمليات الكبيرة', () =>
      transport('app_persist_stage', { p_tx: randomUUID(), p_tenant: tenant, p_upserts: [], p_deletes: [] })
    );
    await run('app_persist_abort', 'إلغاء عملية مجهّزة', () => transport('app_persist_abort', { p_tx: randomUUID() }));
    // نداء مرفوض عمدًا: اسم شركة غير تجريبي، فالدالة ترد بالرفض دون أن تمسح شيئًا
    await run(
      'app_reset_test_tenant',
      'حماية بيانات الشركات الحقيقية',
      () => transport('app_reset_test_tenant', { p_tenant: 'check-only-not-a-test-tenant' }),
      /ONLY_TEST_TENANTS_CAN_BE_RESET/
    );
  }

  const initialized = connected && items.every(item => item.ok);
  const message = !connected
    ? firstError?.auth
      ? 'قاعدة البيانات رفضت المفتاح السري. راجع قيمة SUPABASE_SECRET_KEY.'
      : 'تعذر الاتصال بقاعدة البيانات. راجع قيمة SUPABASE_URL واتصال السيرفر بالإنترنت.'
    : initialized
    ? 'الاتصال سليم وقاعدة البيانات مهيأة.'
    : 'الاتصال سليم لكن قاعدة البيانات غير مهيأة. انسخ كود التهيئة وشغّله في SQL Editor.';

  return { connected, initialized, latencyMs, message, items };
}

/** كود التهيئة (SQL) المرفق مع البرنامج — يُلصق مرة واحدة في SQL Editor لأي قاعدة بيانات جديدة */
export function readSetupSql(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(here, 'setup.sql'), 'utf8');
}

/** يستخرج معرّف مشروع Supabase من الرابط لفتح SQL Editor مباشرة (بدون أي بيانات سرية) */
export function describeDatabaseTarget(url: string): { host: string; projectRef: string; sqlEditorUrl: string } {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = '';
  }
  const match = /^([a-z0-9]{15,30})\.supabase\.co$/i.exec(host);
  const projectRef = match ? match[1] : '';
  return {
    host,
    projectRef,
    sqlEditorUrl: projectRef ? `https://supabase.com/dashboard/project/${projectRef}/sql/new` : ''
  };
}

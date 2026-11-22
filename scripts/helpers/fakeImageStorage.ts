/**
 * تخزين صور وهمي يحاكي Supabase Storage للاختبارات (بدون إنترنت)
 * يُستخدم من scripts/verify_image_storage.ts و scripts/verify_visitor_display_wiring.ts و scripts/verify_image_upload_wiring.ts
 */
export function createFakeImageStorage(baseUrl = 'https://fake.supabase.test') {
  const buckets = new Map<string, any>();
  const objects = new Map<string, { bytes: Buffer; type: string }>();
  const calls: { method: string; path: string; headers: Record<string, string> }[] = [];
  let failNext: 'network' | number | null = null;
  const fetchImpl = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/storage\/v1/, '');
    const method = String(init.method || 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = String(v);
    calls.push({ method, path, headers });
    if (failNext === 'network') {
      failNext = null;
      throw new TypeError('fetch failed');
    }
    if (typeof failNext === 'number') {
      const status = failNext;
      failNext = null;
      return new Response(JSON.stringify({ error: 'fail' }), { status });
    }
    if (!headers.apikey || headers.authorization !== `Bearer ${headers.apikey}`) return new Response('{"error":"unauthorized"}', { status: 401 });
    let m: RegExpExecArray | null;
    if (method === 'GET' && (m = /^\/bucket\/([^/]+)$/.exec(path))) {
      return buckets.has(m[1]) ? new Response(JSON.stringify(buckets.get(m[1])), { status: 200 }) : new Response('{"error":"not found"}', { status: 400 });
    }
    if (method === 'POST' && path === '/bucket') {
      const body = JSON.parse(String(init.body || '{}'));
      if (buckets.has(body.id)) return new Response('{"error":"Duplicate","message":"The resource already exists"}', { status: 409 });
      buckets.set(body.id, body);
      return new Response(JSON.stringify({ name: body.id }), { status: 200 });
    }
    if (method === 'POST' && (m = /^\/object\/([^/]+)\/(.+)$/.exec(path))) {
      if (!buckets.has(m[1])) return new Response('{"error":"Bucket not found"}', { status: 404 });
      const key = `${m[1]}/${decodeURIComponent(m[2])}`;
      if (objects.has(key) && headers['x-upsert'] !== 'true') return new Response('{"error":"Duplicate"}', { status: 409 });
      objects.set(key, { bytes: Buffer.from(init.body as Uint8Array), type: headers['content-type'] || '' });
      return new Response(JSON.stringify({ Key: key }), { status: 200 });
    }
    if (method === 'DELETE' && (m = /^\/object\/([^/]+)$/.exec(path))) {
      const body = JSON.parse(String(init.body || '{}'));
      for (const p of body.prefixes || []) objects.delete(`${m[1]}/${p}`);
      return new Response('[]', { status: 200 });
    }
    return new Response('{"error":"unknown"}', { status: 404 });
  }) as typeof fetch;
  return {
    baseUrl,
    fetchImpl,
    buckets,
    objects,
    calls,
    failNext: (mode: 'network' | number) => {
      failNext = mode;
    }
  };
}

/** صور صغيرة حقيقية للاختبار */
export const TEST_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const TEST_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
export const TEST_GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1').toString('base64');
export const TEST_WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 ')]).toString('base64');

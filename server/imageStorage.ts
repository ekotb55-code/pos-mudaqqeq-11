/**
 * تخزين الصور على Supabase Storage — POS مدقق
 * ---------------------------------------------------------------------------
 * كل صورة تُرفع داخل البرنامج (صور الأصناف، صورة هيدر الإيصال، شعار الشركة، صور شاشة الزوار)
 * تُرفع على السيرفر في حاوية عامة، ويُحفظ في البيانات رابطها فقط (وليس الصورة نفسها كنص).
 *
 *   - اسم الملف = بصمة محتواه، فرفع نفس الصورة مرتين لا ينشئ ملفين.
 *   - نوع الملف يُتحقق منه من محتواه الفعلي (وليس من الاسم أو النوع المرسل).
 *   - كل شركة في مجلد باسمها داخل الحاوية: <الشركة>/<المجلد>/<البصمة>.<الامتداد>
 *   - الصور القديمة المحفوظة كنص داخل البيانات تُنقل للتخزين بـ migrateInlineImages.
 *
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import { createHash } from 'node:crypto';
import type { CollectionDef } from './persistence/statePersistence.ts';

export const IMAGE_BUCKET = 'mudaqqeq-images';
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_FOLDERS = ['items', 'print', 'company', 'visitor', 'misc'] as const;
export type ImageFolder = (typeof IMAGE_FOLDERS)[number];

const MIME_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

export class ImageStorageError extends Error {
  code: 'INVALID_INPUT' | 'TOO_LARGE' | 'UNAVAILABLE';
  constructor(code: 'INVALID_INPUT' | 'TOO_LARGE' | 'UNAVAILABLE', message: string) {
    super(message);
    this.name = 'ImageStorageError';
    this.code = code;
  }
}

/** يحدد نوع الصورة من أول بايتات في الملف */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

/** يقرأ صورة مرسلة كنص (رابط data أو base64 فقط) ويتحقق منها */
export function decodeImage(input: unknown): { bytes: Buffer; mime: string; ext: string } {
  const raw = String(input ?? '').trim();
  if (!raw) throw new ImageStorageError('INVALID_INPUT', 'بيانات الصورة مطلوبة');
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(raw);
  const payload = match ? match[3] : raw;
  if (match && !match[2]) throw new ImageStorageError('INVALID_INPUT', 'صيغة الصورة غير مدعومة');
  const clean = payload.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new ImageStorageError('INVALID_INPUT', 'بيانات الصورة تالفة');
  // حد الحجم قبل فك الترميز (base64 أكبر بحوالي الثلث)
  if (clean.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8) throw new ImageStorageError('TOO_LARGE', 'حجم الصورة أكبر من 2 ميجا. صغّرها ثم ارفعها من جديد');
  const bytes = Buffer.from(clean, 'base64');
  if (bytes.length === 0) throw new ImageStorageError('INVALID_INPUT', 'بيانات الصورة تالفة');
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageStorageError('TOO_LARGE', 'حجم الصورة أكبر من 2 ميجا. صغّرها ثم ارفعها من جديد');
  const mime = sniffImageMime(bytes);
  if (!mime) throw new ImageStorageError('INVALID_INPUT', 'الملف ليس صورة مدعومة. الصيغ المقبولة: JPG و PNG و WEBP و GIF');
  return { bytes, mime, ext: MIME_EXT[mime] };
}

export function isInlineImage(value: unknown): boolean {
  return typeof value === 'string' && /^data:image\//i.test(value.trim());
}

const cleanFolder = (folder: unknown): ImageFolder => (IMAGE_FOLDERS.includes(folder as ImageFolder) ? (folder as ImageFolder) : 'misc');
const cleanTenant = (tenant: string) => String(tenant || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 60) || 'main';

export interface ImageStorageOptions {
  url: string;
  secretKey: string;
  tenant: string;
  bucket?: string;
  fetchImpl?: typeof fetch;
}

export interface StoredImage {
  url: string;
  path: string;
  bytes: number;
  mime: string;
}

export class ImageStorage {
  private base: string;
  private key: string;
  private tenant: string;
  private bucket: string;
  private fetchImpl: typeof fetch;
  private bucketReady = false;

  constructor(options: ImageStorageOptions) {
    this.base = String(options.url || '').replace(/\/+$/, '');
    this.key = String(options.secretKey || '');
    this.tenant = cleanTenant(options.tenant);
    this.bucket = options.bucket || IMAGE_BUCKET;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, ...extra };
  }

  private async call(method: string, path: string, body?: BodyInit, extraHeaders: Record<string, string> = {}): Promise<{ status: number; text: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/storage/v1${path}`, { method, headers: this.headers(extraHeaders), body });
    } catch {
      throw new ImageStorageError('UNAVAILABLE', 'تعذر الاتصال بتخزين الصور. تأكد من الاتصال وحاول مرة أخرى');
    }
    return { status: res.status, text: await res.text().catch(() => '') };
  }

  /** ينشئ الحاوية العامة لو غير موجودة (مرة واحدة لكل تشغيل) */
  async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    const found = await this.call('GET', `/bucket/${this.bucket}`);
    if (found.status === 200) {
      this.bucketReady = true;
      return;
    }
    const created = await this.call(
      'POST',
      '/bucket',
      JSON.stringify({ id: this.bucket, name: this.bucket, public: true, file_size_limit: MAX_IMAGE_BYTES, allowed_mime_types: Object.keys(MIME_EXT) }),
      { 'Content-Type': 'application/json' }
    );
    if (created.status >= 200 && created.status < 300) {
      this.bucketReady = true;
      return;
    }
    // الحاوية أُنشئت بالتوازي أو كانت موجودة
    if (created.status === 409 || /already exists|duplicate/i.test(created.text)) {
      this.bucketReady = true;
      return;
    }
    throw new ImageStorageError('UNAVAILABLE', `تعذر تجهيز تخزين الصور (${created.status}). تأكد من صلاحية مفتاح السيرفر`);
  }

  publicUrl(path: string): string {
    return `${this.base}/storage/v1/object/public/${this.bucket}/${path}`;
  }

  /** هل الرابط صورة مخزنة عندنا؟ يرجع مسارها داخل الحاوية أو فارغ */
  pathFromUrl(url: unknown): string {
    const prefix = `${this.base}/storage/v1/object/public/${this.bucket}/`;
    const value = String(url ?? '');
    return value.startsWith(prefix) ? value.slice(prefix.length) : '';
  }

  async upload(input: { imageBase64: unknown; folder?: unknown }): Promise<StoredImage> {
    const image = decodeImage(input.imageBase64);
    await this.ensureBucket();
    const hash = createHash('sha256').update(image.bytes).digest('hex').slice(0, 32);
    const path = `${this.tenant}/${cleanFolder(input.folder)}/${hash}.${image.ext}`;
    const res = await this.call('POST', `/object/${this.bucket}/${path}`, new Uint8Array(image.bytes), {
      'Content-Type': image.mime,
      'x-upsert': 'true',
      'cache-control': '31536000'
    });
    if (res.status < 200 || res.status >= 300) {
      throw new ImageStorageError('UNAVAILABLE', `تعذر رفع الصورة على السيرفر (${res.status}). حاول مرة أخرى`);
    }
    return { url: this.publicUrl(path), path, bytes: image.bytes.length, mime: image.mime };
  }

  /** حذف صور من التخزين (لا يرمي خطأ: الحذف تنظيف فقط) */
  async remove(paths: string[]): Promise<boolean> {
    const mine = paths.filter(p => typeof p === 'string' && p.startsWith(`${this.tenant}/`));
    if (mine.length === 0) return true;
    try {
      const res = await this.call('DELETE', `/object/${this.bucket}`, JSON.stringify({ prefixes: mine }), { 'Content-Type': 'application/json' });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// نقل الصور القديمة المحفوظة كنص داخل البيانات إلى التخزين
// ---------------------------------------------------------------------------

/** أماكن الصور في البيانات: المجموعة، الحقل، والمجلد في التخزين */
export const IMAGE_FIELDS: readonly { collection: string; field: string; folder: ImageFolder }[] = [
  { collection: 'items', field: 'imageUrl', folder: 'items' },
  { collection: 'settings.invoicePrint', field: 'headerImageUrl', folder: 'print' },
  { collection: 'settings.company', field: 'logoUrl', folder: 'company' }
];

export function countInlineImages(collections: CollectionDef[]): { total: number; byCollection: Record<string, number> } {
  const byCollection: Record<string, number> = {};
  let total = 0;
  for (const spec of IMAGE_FIELDS) {
    const def = collections.find(c => c.name === spec.collection);
    if (!def) continue;
    const value = def.get();
    const docs: any[] = def.kind === 'list' ? (Array.isArray(value) ? value : []) : value ? [value] : [];
    const count = docs.filter(doc => doc && isInlineImage(doc[spec.field])).length;
    if (count > 0) {
      byCollection[spec.collection] = count;
      total += count;
    }
  }
  return { total, byCollection };
}

export interface MigrationResult {
  moved: number;
  failed: number;
  remaining: number;
  errors: string[];
}

/**
 * ينقل كل صورة محفوظة كنص إلى التخزين ويضع رابطها مكانها.
 * الصورة التي تفشل تبقى كما هي (لا يضيع شيء)، ويمكن إعادة المحاولة.
 * limit = أقصى عدد صور في المرة الواحدة (حتى لا يطول الطلب).
 */
export async function migrateInlineImages(collections: CollectionDef[], storage: ImageStorage, limit = 200): Promise<MigrationResult> {
  let moved = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const spec of IMAGE_FIELDS) {
    const def = collections.find(c => c.name === spec.collection);
    if (!def) continue;
    const value = def.get();
    const docs: any[] = def.kind === 'list' ? (Array.isArray(value) ? value : []) : value ? [value] : [];
    for (const doc of docs) {
      if (moved + failed >= limit) break;
      if (!doc || !isInlineImage(doc[spec.field])) continue;
      try {
        const stored = await storage.upload({ imageBase64: doc[spec.field], folder: spec.folder });
        doc[spec.field] = stored.url;
        moved++;
      } catch (err: any) {
        failed++;
        const label = String(doc.name || doc.storeName || doc.id || spec.collection);
        if (errors.length < 10) errors.push(`${label}: ${err?.message || 'تعذر النقل'}`);
      }
    }
    if (def.kind === 'single' && value) def.set(value);
  }
  return { moved, failed, remaining: countInlineImages(collections).total, errors };
}

/**
 * النسخ الاحتياطي والاسترجاع — POS مدقق
 * ---------------------------------------------------------------------------
 * النسخة ملف واحد مضغوط (gzip) يحتوي كل بيانات الشركة المسجلة في سجل الحفظ،
 * ومعه تاريخ النسخة واسم الشركة وعدد السجلات وبصمة تحقق (sha256).
 * الاسترجاع يستبدل كل بيانات الشركة بما في الملف (لا يدمج).
 *
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import type { CollectionDef } from './persistence/statePersistence.ts';

export const BACKUP_FORMAT = 'mudaqqeq-pos-backup';
export const BACKUP_VERSION = 1;
/** أقصى حجم للبيانات بعد فك الضغط (حماية من الملفات الخبيثة) */
const MAX_UNCOMPRESSED_BYTES = 600 * 1024 * 1024;
/** مجموعات مؤقتة بطبيعتها لا تدخل النسخة */
const DEFAULT_EXCLUDED = ['idempotencyCache'];

export class BackupError extends Error {
  code: 'INVALID_FILE' | 'UNSUPPORTED_VERSION' | 'CHECKSUM_MISMATCH';
  constructor(code: 'INVALID_FILE' | 'UNSUPPORTED_VERSION' | 'CHECKSUM_MISMATCH', message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export interface BackupSummary {
  format: string;
  version: number;
  createdAt: string;
  tenant: string;
  createdBy: string;
  storeName: string;
  totalRecords: number;
  counts: Record<string, number>;
}

export interface ParsedBackup {
  summary: BackupSummary;
  data: Record<string, unknown>;
}

export interface BuildBackupOptions {
  tenant: string;
  createdBy: string;
  storeName?: string;
  now?: Date;
  exclude?: string[];
}

export interface ApplyBackupResult {
  restored: Record<string, number>;
  totalRecords: number;
  /** مجموعات موجودة في الملف وغير معروفة لهذه النسخة من البرنامج (تُتجاهل) */
  ignored: string[];
  /** مجموعات مسجلة في البرنامج وغير موجودة في الملف (تُفرَّغ القوائم وتبقى الإعدادات الافتراضية) */
  missing: string[];
}

function checksumOf(dataJson: string): string {
  return createHash('sha256').update(dataJson, 'utf8').digest('hex');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ينشئ ملف النسخة الاحتياطية من الحالة الحالية */
export function buildBackup(collections: CollectionDef[], options: BuildBackupOptions): { fileName: string; buffer: Buffer; summary: BackupSummary } {
  const exclude = new Set(options.exclude || DEFAULT_EXCLUDED);
  const data: Record<string, unknown> = {};
  const counts: Record<string, number> = {};
  let totalRecords = 0;

  for (const def of collections) {
    if (exclude.has(def.name)) continue;
    const value = def.get();
    if (def.kind === 'list') {
      const list = Array.isArray(value) ? value.filter(doc => doc !== undefined && doc !== null) : [];
      data[def.name] = list;
      counts[def.name] = list.length;
      totalRecords += list.length;
    } else if (value !== undefined && value !== null) {
      data[def.name] = value;
      counts[def.name] = 1;
    }
  }

  const dataJson = JSON.stringify(data);
  const now = options.now || new Date();
  const summary: BackupSummary = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    tenant: String(options.tenant || ''),
    createdBy: String(options.createdBy || ''),
    storeName: String(options.storeName || ''),
    totalRecords,
    counts
  };
  const fileJson = `{"header":${JSON.stringify({ ...summary, checksum: checksumOf(dataJson) })},"data":${dataJson}}`;
  const buffer = zlib.gzipSync(Buffer.from(fileJson, 'utf8'), { level: 6 });
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
  const safeTenant = String(options.tenant || 'main').replace(/[^A-Za-z0-9_-]/g, '') || 'main';
  return { fileName: `mudaqqeq-backup-${safeTenant}-${stamp}.json.gz`, buffer, summary };
}

/** يقرأ ملف نسخة احتياطية ويتحقق من سلامته. لا يغيّر أي شيء في النظام */
export function readBackup(file: Buffer | Uint8Array): ParsedBackup {
  let json: string;
  try {
    json = zlib.gunzipSync(Buffer.from(file), { maxOutputLength: MAX_UNCOMPRESSED_BYTES }).toString('utf8');
  } catch {
    throw new BackupError('INVALID_FILE', 'الملف ليس نسخة احتياطية صالحة (تعذر فك الضغط)');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BackupError('INVALID_FILE', 'الملف ليس نسخة احتياطية صالحة (محتوى غير مقروء)');
  }

  const header = parsed?.header;
  const data = parsed?.data;
  if (!header || header.format !== BACKUP_FORMAT || !data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BackupError('INVALID_FILE', 'الملف ليس نسخة احتياطية من نظام POS مدقق');
  }
  if (!Number.isInteger(header.version) || header.version < 1 || header.version > BACKUP_VERSION) {
    throw new BackupError('UNSUPPORTED_VERSION', 'هذه النسخة الاحتياطية من إصدار أحدث من البرنامج الحالي ولا يمكن استرجاعها');
  }
  if (typeof header.checksum !== 'string' || checksumOf(JSON.stringify(data)) !== header.checksum) {
    throw new BackupError('CHECKSUM_MISMATCH', 'ملف النسخة الاحتياطية تالف أو تم تعديله (بصمة التحقق غير مطابقة)');
  }

  const counts: Record<string, number> = {};
  let totalRecords = 0;
  for (const [name, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      counts[name] = value.length;
      totalRecords += value.length;
    } else {
      counts[name] = 1;
    }
  }

  return {
    summary: {
      format: BACKUP_FORMAT,
      version: header.version,
      createdAt: String(header.createdAt || ''),
      tenant: String(header.tenant || ''),
      createdBy: String(header.createdBy || ''),
      storeName: String(header.storeName || ''),
      totalRecords,
      counts
    },
    data
  };
}

/**
 * يستبدل الحالة الحالية في الذاكرة بمحتوى النسخة (لا يدمج).
 * الحفظ في قاعدة البيانات يتم بعدها عبر طبقة الحفظ كعملية واحدة ذرّية.
 */
export function applyBackup(collections: CollectionDef[], backup: ParsedBackup, options: { exclude?: string[] } = {}): ApplyBackupResult {
  const exclude = new Set(options.exclude || DEFAULT_EXCLUDED);
  const known = new Set(collections.map(def => def.name));
  const restored: Record<string, number> = {};
  const missing: string[] = [];
  let totalRecords = 0;

  for (const def of collections) {
    if (exclude.has(def.name)) {
      if (def.kind === 'list') def.set([]);
      continue;
    }
    const has = Object.prototype.hasOwnProperty.call(backup.data, def.name);
    const value = has ? backup.data[def.name] : undefined;
    if (def.kind === 'list') {
      if (!has) missing.push(def.name);
      const list = Array.isArray(value) ? value.filter(doc => doc !== undefined && doc !== null) : [];
      // نسخة عميقة حتى لا تشترك الذاكرة مع كائن النسخة
      def.set(JSON.parse(JSON.stringify(list)));
      restored[def.name] = list.length;
      totalRecords += list.length;
    } else if (has && value !== undefined && value !== null) {
      def.set(JSON.parse(JSON.stringify(value)));
      restored[def.name] = 1;
    } else {
      missing.push(def.name);
    }
  }

  const ignored = Object.keys(backup.data).filter(name => !known.has(name));
  return { restored, totalRecords, ignored, missing };
}

// ---------------------------------------------------------------------------
// بيانات متابعة النسخ (آخر نسخة / آخر استرجاع) — تُسجَّل ضمن سجل الحفظ
// ---------------------------------------------------------------------------

export interface BackupMeta {
  lastBackupAt: string;
  lastBackupBy: string;
  lastRestoreAt: string;
  lastRestoreBy: string;
  lastRestoreFromBackupAt: string;
}

let backupMeta: BackupMeta = { lastBackupAt: '', lastBackupBy: '', lastRestoreAt: '', lastRestoreBy: '', lastRestoreFromBackupAt: '' };

export function getBackupMeta(): BackupMeta {
  return { ...backupMeta };
}

export function noteBackupTaken(by: string, at: Date = new Date()) {
  backupMeta = { ...backupMeta, lastBackupAt: at.toISOString(), lastBackupBy: String(by || '') };
}

export function noteBackupRestored(by: string, backupCreatedAt: string, at: Date = new Date()) {
  backupMeta = { ...backupMeta, lastRestoreAt: at.toISOString(), lastRestoreBy: String(by || ''), lastRestoreFromBackupAt: String(backupCreatedAt || '') };
}

/** تُضاف إلى قائمة مجموعات الحفظ في server.ts حتى تبقى بعد إعادة التشغيل (ولا تدخل ملف النسخة) */
export function getBackupMetaCollection(): CollectionDef {
  return {
    name: 'state.backupMeta',
    kind: 'single',
    get: () => backupMeta,
    set: value => {
      backupMeta = {
        lastBackupAt: String(value?.lastBackupAt || ''),
        lastBackupBy: String(value?.lastBackupBy || ''),
        lastRestoreAt: String(value?.lastRestoreAt || ''),
        lastRestoreBy: String(value?.lastRestoreBy || ''),
        lastRestoreFromBackupAt: String(value?.lastRestoreFromBackupAt || '')
      };
    }
  };
}

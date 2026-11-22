/**
 * إعدادات الخادم والربط المركزي مع Google Apps Script وGoogle Sheets
 * هذا هو الموضع المركزي الوحيد لرابط Apps Script في المشروع
 */

export interface TaxSettings {
  taxInclusive: boolean; // هل سعر البيع شامل الضريبة أم تُضاف فوق السعر
  platformCommissionOn: 'before_tax' | 'after_tax'; // هل عمولة المنصة تُحسب قبل أم بعد الضريبة
}

export type DataMode = 'sheets' | 'memory';

export interface ConnectionHealth {
  healthy: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
}

export interface SystemConfig {
  appsScriptUrl: string;
  port: number;
  dataMode: DataMode;
  connectionHealth: ConnectionHealth;
  isGoogleSheetsConnected: boolean;
  storeName: string;
  currency: string;
  hasOwner?: boolean;
  hasManager?: boolean;
  lastSyncTime?: string;
  taxSettings?: TaxSettings;
  enableDeliveryFee?: boolean;
  inactivityTimeoutMinutes?: number;
}

/**
 * فحص صحة رابط Google Apps Script وتجاهل الروابط الوهمية والتجريبية (Placeholders)
 */
export function isValidAppsScriptUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://script.google.com/macros/s/')) return false;
  if (
    trimmed.includes('EXAMPLE') ||
    trimmed.includes('EXAMPLE_ID') ||
    trimmed.includes('...') ||
    trimmed.includes('placeholder') ||
    trimmed.includes('your-script') ||
    trimmed.includes('AKfycbx_')
  ) {
    return false;
  }
  return trimmed.endsWith('/exec') && trimmed.length > 50;
}

export function isDatabasePersistenceConfigured(): boolean {
  return Boolean((process.env.SUPABASE_URL || '').trim() && (process.env.SUPABASE_SECRET_KEY || '').trim());
}

// قراءة الرابط من متغيرات البيئة إن وجد وتصفيته
const initialEnvUrl = (process.env.APPS_SCRIPT_URL || '').trim();
let currentAppsScriptUrl = isValidAppsScriptUrl(initialEnvUrl) ? initialEnvUrl : '';
const initialDataMode: DataMode = isValidAppsScriptUrl(currentAppsScriptUrl) ? 'sheets' : 'memory';

/**
 * كلمة السر المؤقتة الافتراضية للحسابات الثلاثة عند تهيئة نظام جديد (4 أرقام بسيطة)
 * قابلة للتخصيص عبر متغير البيئة INITIAL_USER_PASSWORD
 */
export const INITIAL_USER_PASSWORD = (process.env.INITIAL_USER_PASSWORD || '1234').trim() || '1234';

const defaultTaxSettings: TaxSettings = {
  taxInclusive: true, // سعر البيع شامل الضريبة افتراضياً
  platformCommissionOn: 'before_tax' // احتساب العمولة قبل الضريبة افتراضياً
};

// حالة النظام الحالية - منفذ 3000 الإلزامي للعمل داخل AI Studio
const systemConfig: SystemConfig = {
  appsScriptUrl: currentAppsScriptUrl,
  port: 3000,
  dataMode: initialDataMode,
  connectionHealth: {
    healthy: initialDataMode === 'sheets',
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    lastSuccessAt: null
  },
  isGoogleSheetsConnected: initialDataMode === 'sheets',
  storeName: 'مدقق للنظم',
  currency: 'EGP',
  hasOwner: false,
  hasManager: false,
  taxSettings: defaultTaxSettings,
  enableDeliveryFee: false,
  inactivityTimeoutMinutes: 480
};

/**
 * الحصول على الإعدادات الحالية
 */
export function getSystemConfig(): SystemConfig {
  if (isDatabasePersistenceConfigured() && systemConfig.appsScriptUrl) {
    // عند تفعيل قاعدة البيانات لا يُستخدم Google Sheets إطلاقًا
    currentAppsScriptUrl = '';
    systemConfig.appsScriptUrl = '';
  }
  const mode: DataMode = isValidAppsScriptUrl(systemConfig.appsScriptUrl) ? 'sheets' : 'memory';
  systemConfig.dataMode = mode;
  systemConfig.isGoogleSheetsConnected = mode === 'sheets';
  return {
    ...systemConfig,
    connectionHealth: { ...systemConfig.connectionHealth }
  };
}

/**
 * تحديث إعدادات الضريبة وحسابات العمولات
 */
export function setTaxSettings(settings: Partial<TaxSettings>): TaxSettings {
  systemConfig.taxSettings = {
    ...defaultTaxSettings,
    ...(systemConfig.taxSettings || {}),
    ...settings
  };
  return systemConfig.taxSettings;
}

/**
 * تحديث رابط Google Apps Script ديناميكيًا من الواجهة وحفظه
 */
export function setAppsScriptUrl(newUrl: string): SystemConfig {
  currentAppsScriptUrl = isDatabasePersistenceConfigured() ? '' : (newUrl || '').trim();
  const valid = isValidAppsScriptUrl(currentAppsScriptUrl);
  const mode: DataMode = valid ? 'sheets' : 'memory';
  systemConfig.appsScriptUrl = currentAppsScriptUrl;
  systemConfig.dataMode = mode;
  systemConfig.isGoogleSheetsConnected = mode === 'sheets';

  if (mode === 'memory') {
    systemConfig.connectionHealth = {
      healthy: false,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      lastSuccessAt: null
    };
  } else {
    systemConfig.connectionHealth = {
      ...systemConfig.connectionHealth,
      healthy: true,
      lastError: null,
      consecutiveFailures: 0
    };
  }

  return getSystemConfig();
}

/**
 * تعيين حالة صحة الاتصال وتوقيت آخر مزامنة دون تغيير dataMode أو isGoogleSheetsConnected
 */
export function setConnectionStatus(connected: boolean, errorMessage?: string) {
  const now = new Date().toISOString();
  const mode: DataMode = isValidAppsScriptUrl(systemConfig.appsScriptUrl) ? 'sheets' : 'memory';
  systemConfig.dataMode = mode;
  systemConfig.isGoogleSheetsConnected = mode === 'sheets';

  if (connected) {
    systemConfig.lastSyncTime = now;
    systemConfig.connectionHealth = {
      healthy: true,
      lastError: null,
      lastErrorAt: systemConfig.connectionHealth.lastErrorAt,
      consecutiveFailures: 0,
      lastSuccessAt: now
    };
  } else {
    systemConfig.connectionHealth = {
      healthy: false,
      lastError: errorMessage || 'تعذر الاتصال بـ Google Apps Script',
      lastErrorAt: now,
      consecutiveFailures: (systemConfig.connectionHealth.consecutiveFailures || 0) + 1,
      lastSuccessAt: systemConfig.connectionHealth.lastSuccessAt
    };
  }
}

/**
 * إعدادات النظام التي يجب أن تبقى بعد إعادة التشغيل (تُحفظ ضمن طبقة الحفظ الدائم)
 */
export function exportPersistedConfig() {
  return {
    storeName: systemConfig.storeName,
    currency: systemConfig.currency,
    hasOwner: Boolean(systemConfig.hasOwner),
    hasManager: Boolean(systemConfig.hasManager),
    taxSettings: { ...defaultTaxSettings, ...(systemConfig.taxSettings || {}) },
    enableDeliveryFee: Boolean(systemConfig.enableDeliveryFee),
    inactivityTimeoutMinutes: typeof systemConfig.inactivityTimeoutMinutes === 'number' ? systemConfig.inactivityTimeoutMinutes : 480
  };
}

export function importPersistedConfig(value: any): void {
  if (!value || typeof value !== 'object') return;
  if (typeof value.storeName === 'string') systemConfig.storeName = value.storeName;
  if (typeof value.currency === 'string') systemConfig.currency = value.currency;
  if (typeof value.hasOwner === 'boolean') systemConfig.hasOwner = value.hasOwner;
  if (typeof value.hasManager === 'boolean') systemConfig.hasManager = value.hasManager;
  if (value.taxSettings && typeof value.taxSettings === 'object') {
    systemConfig.taxSettings = { ...defaultTaxSettings, ...value.taxSettings };
  }
  if (typeof value.enableDeliveryFee === 'boolean') systemConfig.enableDeliveryFee = value.enableDeliveryFee;
  if (typeof value.inactivityTimeoutMinutes === 'number') systemConfig.inactivityTimeoutMinutes = value.inactivityTimeoutMinutes;
}

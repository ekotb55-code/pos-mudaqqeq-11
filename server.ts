import http from 'http';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { getSystemConfig, setAppsScriptUrl } from './server/config.ts';
import {
  testConnection,
  setupSheets,
  checkHasOwner,
  checkHasManager,
  setupFirstDesignerLocal,
  loginUser,
  logoutUserSession,
  syncAllData,
  getItems,
  getItemsPaginated,
  exportAllItemsExcelBuffer,
  generateBulkPriceEditTemplateBuffer,
  previewBulkPriceEditExcel,
  executeBulkPriceEditExcel,
  getBulkEditUndoStatus,
  undoLastBulkEditExcel,
  generateBulkEditErrorsExcelBuffer,
  saveItem,
  inlineUpdateItem,
  deleteItem,
  archiveItem,
  getItemLogs,
  importItemsBatch,
  checkItemUniqueness,
  normalizeItemName,
  normalizeItemBarcode,
  previewDuplicateItems,
  cleanupDuplicateItems,
  getPlatforms,
  savePlatform,
  getItemPlatformCosts,
  saveItemPlatformCost,
  getInvoices,
  createInvoice,
  syncOfflineOperation,
  markOfflineInvoiceReviewed,
  updateInvoice,
  setInvoicePlatformOrderId,
  isInvoiceNumberUsed,
  setItemImages,
  isImageUrlReferenced,
  getInvoiceEditLogs,
  getReturns,
  createReturn,
  getUsers,
  saveUser,
  deleteUser,
  completeInitialAccountSetup,
  changeOwnPassword,
  updateUserPermissions,
  saveCompanySettings,
  getPublicContactSettings,
  saveContactSettings,
  saveInvoicePrintSettings,
  saveDisplaySettings,
  saveTaxSettings,
  getAuditLogs,
  uploadImage,
  getSuppliers,
  saveSupplier,
  getSupplierGroups,
  saveSupplierGroup,
  getSupplierLedger,
  createSupplierVoucher,
  getPurchases,
  createPurchase,
  getPurchaseReturns,
  createPurchaseReturn,
  getCustomers,
  saveCustomer,
  getCustomerGroups,
  saveCustomerGroup,
  getCustomerLedger,
  createCustomerVoucher,
  getDashboardCashboxes,
  getCashboxes,
  saveCashbox,
  getCashboxTransactions,
  createCashboxTransfer,
  getUserCashboxAssignments,
  saveUserCashboxAssignment,
  getImportBatches,
  cancelInvoice,
  cancelPurchase,
  getReconciliationReport,
  postReconciliationItem,
  setOnUserSuspended,
  getStoredUserById,
  getCategories,
  saveCategory,
  deleteCategory,
  migrateItemCategories,
  adjustItemStock,
  getItemMovementReport,
  getStockAdjustmentsReport,
  getBnplReport,
  getPlatformReport,
  getStockSettings,
  saveStockSettings,
  getCompanySettings,
  getInvoicePrintSettings,
  getDisplaySettings,
  getPartyLedger,
  collectCreditInvoices,
  getWarehouses,
  saveWarehouse,
  deleteWarehouse,
  getItemWarehouses,
  getUserWarehouses,
  saveUserWarehouses,
  getWarehouseMigrationStatus,
  getWarehouseTransferContext,
  getWarehouseTransferStocks,
  createWarehouseTransfer,
  getWarehouseTransfers,
  getWarehouseTransferById,
  SheetsUnavailableError,
  getStaleMeta,
  getPersistenceCollections,
  applyCleanInitialState,
  recordAuditLog,
  verifyUserPasswordById,
  findInvoiceSaleByCartId
} from './server/sheetsService.ts';
import { CartJournal, CartJournalError } from './server/cartJournal.ts';
import {
  StatePersistence,
  createSupabaseTransport,
  createPersistenceMiddleware,
  readPersistenceEnv,
  type RpcTransport,
  type CollectionDef
} from './server/persistence/statePersistence.ts';
import {
  buildBackup,
  readBackup,
  applyBackup,
  BackupError,
  getBackupMeta,
  noteBackupTaken,
  noteBackupRestored,
  getBackupMetaCollection
} from './server/backup.ts';
import {
  resetOperations,
  factoryReset,
  findUnclassifiedCollections,
  getResetMeta,
  noteReset,
  isBeforeLastReset,
  getResetMetaCollection
} from './server/dataReset.ts';
import { LinkedAccounts, LinkedAccountsError } from './server/linkedAccounts.ts';
import { ManualBalances, ManualBalanceError, POSTPONE_MINUTES } from './server/manualBalance.ts';
import { getSalesRules, saveSalesRules, describeSalesRules, resetSalesRules, getSalesRulesCollection, arePlatformsEnabled, isSalesOnlyMode, SalesRulesError } from './server/salesRules.ts';
import {
  getInvoiceNumberingSettings,
  saveInvoiceNumberingSettings,
  describeInvoiceNumbering,
  resetInvoiceCounter,
  getInvoiceNumberingCollection,
  resetInvoiceCounterState,
  resetInvoiceNumbering,
  InvoiceNumberingError
} from './server/invoiceNumbering.ts';
import { ImageStorage, ImageStorageError, countInlineImages, migrateInlineImages } from './server/imageStorage.ts';
import { getLabelSettings, saveLabelSettings, getLabelSettingsCollection, resetLabelSettings, LabelSettingsError } from './server/labelSettings.ts';
import * as delivery from './server/delivery.ts';
import * as deliveryService from './server/deliveryService.ts';
import { encodeBarcode, itemBarcodeList } from './src/utils/labelPrint.ts';
import {
  getVisitorSettings,
  saveVisitorSettings,
  addVisitorSlide,
  removeVisitorSlide,
  reorderVisitorSlides,
  lookupVisitorProduct,
  buildVisitorCatalog,
  getVisitorSettingsCollection,
  resetVisitorSettings,
  VisitorDisplayError,
  MAX_VISITOR_SLIDES
} from './server/visitorDisplay.ts';
import {
  checkDatabaseSetup,
  readSetupSql,
  describeDatabaseTarget,
  type DatabaseCheckResult
} from './server/persistence/setupCheck.ts';
import {
  isValidAppTheme,
  normalizeInactivityTimeoutMinutes,
  type UserRole,
  type UserAccount,
  type PermissionKey,
  type CompanySettings,
  type InvoicePrintSettings,
  type DisplaySettings,
  type StockSettings,
  type ActiveUserSessionInfo
} from './src/types/index.ts';
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_TEMPLATES } from './src/utils/permissions.ts';
export { PERMISSIONS };

dotenv.config();
process.env.DISABLE_HMR = 'true';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// إدارة الجلسات مع مدة صلاحية مطلقة (24 ساعة) ومهلة عدم نشاط قابلة للضبط
export interface SessionData {
  sessionId: string;
  userId: string;
  username: string;
  phone?: string;
  name: string;
  role: UserRole;
  permissions: PermissionKey[];
  isOwner: boolean;
  mustChangePassword?: boolean;
  deviceName: string;
  deviceId?: string;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
}

export interface RevokedSessionData {
  reason: 'TERMINATED_BY_ADMIN' | 'INACTIVITY_TIMEOUT' | 'USER_SUSPENDED';
  message: string;
  revokedAt: number;
  expiresAt: number;
}

const activeSessions = new Map<string, SessionData>();
const revokedSessions = new Map<string, RevokedSessionData>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 ساعة

function getInactivityTimeoutMs(): number {
  const minutes = normalizeInactivityTimeoutMinutes(getCompanySettings().inactivityTimeoutMinutes);
  return minutes * 60 * 1000;
}

function parseUserAgentLabel(uaRaw?: string): string {
  const ua = String(uaRaw || '').trim();
  if (!ua) return 'متصفح ويب';
  let browser = 'متصفح';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

  let os = '';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return os ? `${browser} على ${os}` : browser;
}

function decodeHeaderValue(raw: unknown, maxLen = 120): string {
  if (typeof raw !== 'string') return '';
  let val = raw.trim();
  if (!val) return '';
  try {
    val = decodeURIComponent(val).trim();
  } catch {
    // keep raw if not URI-encoded
  }
  return val.slice(0, maxLen);
}

function describeDeviceFromRequest(req?: Request): { deviceName: string; deviceId?: string } {
  const headerDeviceName = decodeHeaderValue(req?.headers?.['x-device-name'], 120);
  const bodyDeviceName = typeof (req as any)?.body?.deviceName === 'string'
    ? String((req as any).body.deviceName).trim().slice(0, 120)
    : '';
  const uaLabel = parseUserAgentLabel(typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : '');
  const deviceName = bodyDeviceName || headerDeviceName || uaLabel || 'متصفح ويب';

  const headerDeviceId = decodeHeaderValue(req?.headers?.['x-device-id'], 80);
  const bodyDeviceId = typeof (req as any)?.body?.deviceId === 'string'
    ? String((req as any).body.deviceId).trim().slice(0, 80)
    : '';
  const deviceId = bodyDeviceId || headerDeviceId || undefined;

  return { deviceName, deviceId };
}

function pruneExpiredSessions(): void {
  const now = Date.now();
  const idleLimitMs = getInactivityTimeoutMs();

  for (const [token, rev] of revokedSessions.entries()) {
    if (now > rev.expiresAt) {
      revokedSessions.delete(token);
    }
  }

  for (const [token, session] of activeSessions.entries()) {
    if (now > session.expiresAt) {
      activeSessions.delete(token);
      continue;
    }
    const lastActive = session.lastActivityAt || session.createdAt || (session.expiresAt - SESSION_TTL_MS);
    if (now - lastActive > idleLimitMs) {
      activeSessions.delete(token);
      revokedSessions.set(token, {
        reason: 'INACTIVITY_TIMEOUT',
        message: 'انتهت الجلسة بسبب عدم النشاط، يرجى تسجيل الدخول مجددًا',
        revokedAt: now,
        expiresAt: session.expiresAt
      });
    }
  }
}

function getAuthSessionsCollection(): CollectionDef {
  return {
    name: 'state.authSessions',
    kind: 'single',
    get: () => {
      const now = Date.now();
      return {
        active: Array.from(activeSessions.entries())
          .filter(([, s]) => now <= s.expiresAt)
          .map(([token, s]) => ({
            token,
            sessionId: s.sessionId,
            userId: s.userId,
            username: s.username,
            phone: s.phone,
            name: s.name,
            role: s.role,
            permissions: s.permissions,
            isOwner: s.isOwner,
            mustChangePassword: Boolean(s.mustChangePassword),
            deviceName: s.deviceName || 'متصفح ويب',
            deviceId: s.deviceId,
            createdAt: s.createdAt,
            lastActivityAt: s.lastActivityAt,
            expiresAt: s.expiresAt
          })),
        revoked: Array.from(revokedSessions.entries())
          .filter(([, r]) => now <= r.expiresAt)
          .map(([token, r]) => ({
            token,
            reason: r.reason,
            message: r.message,
            revokedAt: r.revokedAt,
            expiresAt: r.expiresAt
          }))
      };
    },
    set: (val: any) => {
      activeSessions.clear();
      revokedSessions.clear();
      if (!val || typeof val !== 'object') return;
      const now = Date.now();
      if (Array.isArray(val.active)) {
        for (const item of val.active) {
          if (!item || typeof item.token !== 'string' || !item.userId) continue;
          const expiresAt = Number(item.expiresAt) || 0;
          if (now > expiresAt) continue;
          const createdAt = Number(item.createdAt) || (expiresAt - SESSION_TTL_MS);
          const lastActivityAt = Number(item.lastActivityAt) || createdAt;
          activeSessions.set(item.token, {
            sessionId: typeof item.sessionId === 'string' && item.sessionId ? item.sessionId : crypto.randomBytes(12).toString('hex'),
            userId: String(item.userId),
            username: String(item.username || ''),
            phone: item.phone ? String(item.phone) : undefined,
            name: String(item.name || item.username || ''),
            role: item.role as UserRole,
            permissions: Array.isArray(item.permissions) ? item.permissions : [],
            isOwner: Boolean(item.isOwner),
            mustChangePassword: Boolean(item.mustChangePassword),
            deviceName: typeof item.deviceName === 'string' && item.deviceName.trim() ? item.deviceName.trim() : 'متصفح ويب',
            deviceId: typeof item.deviceId === 'string' && item.deviceId.trim() ? item.deviceId.trim() : undefined,
            createdAt,
            lastActivityAt,
            expiresAt
          });
        }
      }
      if (Array.isArray(val.revoked)) {
        for (const item of val.revoked) {
          if (!item || typeof item.token !== 'string') continue;
          const expiresAt = Number(item.expiresAt) || 0;
          if (now > expiresAt) continue;
          revokedSessions.set(item.token, {
            reason: item.reason || 'TERMINATED_BY_ADMIN',
            message: typeof item.message === 'string' && item.message ? item.message : 'تم إنهاء الجلسة من قِبل إدارة النظام، يرجى تسجيل الدخول مجددًا',
            revokedAt: Number(item.revokedAt) || now,
            expiresAt
          });
        }
      }
    }
  };
}

setOnUserSuspended((suspendedUserId: string) => {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (session.userId === suspendedUserId) {
      activeSessions.delete(token);
      revokedSessions.set(token, {
        reason: 'USER_SUSPENDED',
        message: 'تم إيقاف حسابك من قِبل إدارة النظام، يرجى مراجعة المسؤول',
        revokedAt: now,
        expiresAt: session.expiresAt
      });
    }
  }
});

function createSession(
  user: UserAccount,
  existingToken?: string,
  req?: Request
): { token: string; sessionId: string; expiresAt: number; permissions: PermissionKey[] } {
  const token = existingToken || crypto.randomBytes(32).toString('hex');
  const sessionId = crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const permissions = user.role === 'designer'
    ? ALL_PERMISSIONS.map(p => p.key)
    : (user.permissions || ROLE_TEMPLATES[user.role] || ROLE_TEMPLATES.employee);
  const { deviceName, deviceId } = describeDeviceFromRequest(req);

  revokedSessions.delete(token);
  activeSessions.set(token, {
    sessionId,
    userId: user.id,
    username: user.username,
    phone: user.phone,
    name: user.name,
    role: user.role,
    permissions,
    isOwner: user.role === 'designer' || Boolean(user.isOwner),
    mustChangePassword: Boolean(user.mustChangePassword),
    deviceName,
    deviceId,
    createdAt: now,
    lastActivityAt: now,
    expiresAt
  });
  return { token, sessionId, expiresAt, permissions };
}

// وسيط التحقق من المصادقة وانتهاء الجلسة
export interface AuthenticatedRequest extends Request {
  userSession?: SessionData;
  authToken?: string;
  authRevoked?: RevokedSessionData;
}

const MUST_CHANGE_PASSWORD_ALLOWED_PATHS = new Set<string>([
  '/api/auth/complete-initial-setup',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/activity',
  '/api/public/contact-settings',
  '/api/health'
]);

const PUBLIC_OR_AUTH_BOOTSTRAP_PATHS = new Set<string>([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/setup-designer-local',
  '/api/auth/setup-status',
  '/api/public/contact-settings',
  '/api/config',
  '/api/health',
  '/api/database/public-status',
  '/api/visitor-display'
]);

function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.userSession = undefined;
    req.authToken = undefined;
    return next();
  }

  const token = authHeader.slice(7).trim();
  req.authToken = token;
  const session = activeSessions.get(token);
  const cleanPath = req.path.replace(/\/+$/, '') || '/';

  if (!session) {
    req.userSession = undefined;
    const revoked = revokedSessions.get(token);
    if (revoked) {
      if ( Date.now() > revoked.expiresAt) {
        revokedSessions.delete(token);
      } else {
        req.authRevoked = revoked;
        if (!PUBLIC_OR_AUTH_BOOTSTRAP_PATHS.has(cleanPath)) {
          res.status(401).json({
            success: false,
            error: revoked.message,
            expired: true,
            code: revoked.reason
          });
          return;
        }
      }
    }
    return next();
  }

  const now = Date.now();
  if (now > session.expiresAt) {
    activeSessions.delete(token);
    if (PUBLIC_OR_AUTH_BOOTSTRAP_PATHS.has(cleanPath)) {
      req.userSession = undefined;
      return next();
    }
    res.status(401).json({
      success: false,
      error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجددًا',
      expired: true
    });
    return;
  }

  // التحقق من مهلة عدم النشاط لجميع الجلسات الحالية والجديدة
  const idleLimitMs = getInactivityTimeoutMs();
  const lastActive = session.lastActivityAt || session.createdAt || (session.expiresAt - SESSION_TTL_MS);
  if (now - lastActive > idleLimitMs) {
    activeSessions.delete(token);
    const message = 'انتهت الجلسة بسبب عدم النشاط، يرجى تسجيل الدخول مجددًا';
    const revokedInfo: RevokedSessionData = {
      reason: 'INACTIVITY_TIMEOUT',
      message,
      revokedAt: now,
      expiresAt: session.expiresAt
    };
    revokedSessions.set(token, revokedInfo);
    req.authRevoked = revokedInfo;
    if (PUBLIC_OR_AUTH_BOOTSTRAP_PATHS.has(cleanPath)) {
      req.userSession = undefined;
      return next();
    }
    res.status(401).json({
      success: false,
      error: message,
      expired: true,
      code: 'INACTIVITY_TIMEOUT'
    });
    return;
  }

  // التحقق الفوري من حالة الحساب: في وضع الذاكرة فقط نتحقق من مستخدمي الذاكرة؛ أما في وضع sheets فـ Code.gs يفرض الإيقاف وتغيير كلمة السر مع كل طلب
  if (getSystemConfig().dataMode === 'memory') {
    const liveUser = getStoredUserById(session.userId);
    if (liveUser) {
      if (liveUser.status === 'inactive' || (liveUser.status as any) === 'موقوف') {
        if (req.path === '/api/offline/sync') {
          (req as any).userSuspended = true;
          req.userSession = session;
          return next();
        }
        activeSessions.delete(token);
        const suspendedMsg = 'تم إيقاف حسابك من قِبل إدارة النظام، يرجى مراجعة المسؤول';
        revokedSessions.set(token, {
          reason: 'USER_SUSPENDED',
          message: suspendedMsg,
          revokedAt: now,
          expiresAt: session.expiresAt
        });
        res.status(401).json({
          success: false,
          error: suspendedMsg,
          expired: true,
          suspended: true
        });
        return;
      }
      session.mustChangePassword = Boolean(liveUser.mustChangePassword);
    }
  }

  // تحديث آخر نشاط فقط عند تفاعل المستخدم الفعلي (تجاهل طلبات الخلفية والفحص الدوري)
  const isBackgroundPoll =
    req.headers['x-background-poll'] === '1' ||
    req.headers['x-user-activity'] === '0' ||
    cleanPath === '/api/health' ||
    cleanPath === '/api/cart-journal/events';

  if (!isBackgroundPoll) {
    const isExplicitUserActivity =
      req.headers['x-user-activity'] === '1' ||
      cleanPath === '/api/auth/activity' ||
      (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS');
    if (isExplicitUserActivity) {
      session.lastActivityAt = now;
    }
  }

  const headerDevName = decodeHeaderValue(req.headers['x-device-name'], 120);
  if (headerDevName) {
    session.deviceName = headerDevName;
  }
  const headerDevId = decodeHeaderValue(req.headers['x-device-id'], 80);
  if (headerDevId) {
    session.deviceId = headerDevId;
  }

  // فرض استكمال إعداد الحساب عند أول دخول في الخادم: رفض أي طلب API آخر برسالة عربية واضحة
  if (session.mustChangePassword && req.path.startsWith('/api/')) {
    if (!MUST_CHANGE_PASSWORD_ALLOWED_PATHS.has(cleanPath)) {
      res.status(403).json({
        success: false,
        code: 'MUST_CHANGE_PASSWORD',
        mustChangePassword: true,
        error: 'يرجى استكمال إعداد الحساب وتغيير كلمة السر المؤقتة أولاً قبل استخدام النظام'
      });
      return;
    }
  }

  req.userSession = session;
  next();
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.userSession) {
    const revoked = req.authRevoked;
    res.status(401).json({
      success: false,
      error: revoked?.message || 'يرجى تسجيل الدخول للمتابعة',
      expired: true,
      ...(revoked?.reason ? { code: revoked.reason } : {})
    });
    return;
  }
  next();
}

/**
 * وسيط التحقق المركزي من الصلاحيات (Deny by default)
 */
function requirePermission(perm: PermissionKey) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.userSession) {
      res.status(401).json({
        success: false,
        error: 'يرجى تسجيل الدخول للمتابعة',
        expired: true
      });
      return;
    }

    // مصمم ومالك النظام يمتلك كل الصلاحيات دائمًا
    if (req.userSession.role === 'designer' || req.userSession.isOwner) {
      return next();
    }

    if (!req.userSession.permissions || !req.userSession.permissions.includes(perm)) {
      res.status(403).json({
        success: false,
        error: `غير مصرح: تفتقر لحق الوصول أو صلاحية [${perm}]`
      });
      return;
    }

    next();
  };
}

function requireAnyPermission(perms: PermissionKey[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.userSession) {
      res.status(401).json({
        success: false,
        error: 'يرجى تسجيل الدخول للمتابعة',
        expired: true
      });
      return;
    }

    if (req.userSession.role === 'designer' || req.userSession.isOwner) {
      return next();
    }

    const userPerms = req.userSession.permissions || [];
    if (!perms.some(p => userPerms.includes(p))) {
      res.status(403).json({
        success: false,
        error: `غير مصرح: تفتقر لإحدى الصلاحيات المطلوبة [${perms.join(' أو ')}]`
      });
      return;
    }

    next();
  };
}

/**
 * فحص الصلاحية فقط لمصمم ومالك النظام
 */
function requireDesigner(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.userSession || (req.userSession.role !== 'designer' && !req.userSession.isOwner)) {
    res.status(403).json({
      success: false,
      error: 'غير مصرح: هذا الإجراء مخصص حصريًا لمالك ومصمم النظام'
    });
    return;
  }
  next();
}

function requirePlatformsEnabled(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!arePlatformsEnabled()) {
    res.status(403).json({
      success: false,
      code: 'PLATFORMS_DISABLED',
      error: 'مبيعات ووظائف المنصات معطلة حاليًا من إعدادات النظام'
    });
    return;
  }
  next();
}

function requireFullMode(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (isSalesOnlyMode()) {
    res.status(403).json({
      success: false,
      code: 'SALES_ONLY_MODE',
      error: 'هذه الوظيفة غير متاحة أثناء تفعيل «وضع البيع فقط»'
    });
    return;
  }
  next();
}

function sanitizeErrorMessageForClient(rawMessage: unknown, fallbackMessage = 'حدث خطأ غير متوقع'): string {
  if (typeof rawMessage !== 'string') return fallbackMessage;
  const trimmed = rawMessage.trim();
  if (!trimmed) return fallbackMessage;

  // منع كشف أي تفاصيل داخلية مثل تتبع المكدس (stack) أو أسماء ومسارات الملفات أو أخطاء محرك البرمجة
  if (
    /\bat\s+[^\n]+\([^\n]+:\d+/i.test(trimmed) ||
    /\.(ts|tsx|js|mjs|cjs|gs|json)(:\d+|\b)/i.test(trimmed) ||
    /\/(app|src|server|node_modules|apps-script)\//i.test(trimmed) ||
    /[A-Za-z]:\\/.test(trimmed) ||
    /^(ReferenceError|TypeError|SyntaxError|RangeError|URIError|EvalError|SystemError|Error):/i.test(trimmed) ||
    /\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EACCES|EPERM|ENOENT)\b/i.test(trimmed)
  ) {
    return fallbackMessage;
  }

  const firstLine = trimmed.split('\n')[0].trim();
  return firstLine || fallbackMessage;
}

function sanitizeResultPayload(result: any, fallbackMessage = 'حدث خطأ أثناء تنفيذ العملية') {
  if (!result || typeof result !== 'object') return result;
  const cleaned: Record<string, any> = { ...result };
  delete cleaned.stack;
  if (typeof cleaned.error === 'string') {
    cleaned.error = sanitizeErrorMessageForClient(cleaned.error, fallbackMessage);
  }
  return cleaned;
}

function sendWriteResult(res: Response, result: any, failureStatusIfCode?: number) {
  const safeResult = sanitizeResultPayload(result);
  if (!safeResult?.success) {
    if (safeResult?.code === 'SHEETS_UNAVAILABLE') {
      res.status(503).json(safeResult);
      return;
    }
    if (safeResult?.code === 'UNKNOWN_RESULT') {
      res.status(504).json(safeResult);
      return;
    }
    if (failureStatusIfCode !== undefined) {
      res.status(failureStatusIfCode).json(safeResult);
      return;
    }
  }
  res.json(safeResult);
}

function handleCatchError(res: Response, err: any, fallbackMessage = 'حدث خطأ غير متوقع') {
  console.error('[Server Error]:', err?.stack || err?.message || err);

  if (err instanceof SheetsUnavailableError || err?.name === 'SheetsUnavailableError') {
    res.status(err.statusCode || (err.code === 'UNKNOWN_RESULT' ? 504 : 503)).json({
      success: false,
      code: err.code || 'SHEETS_UNAVAILABLE',
      error: sanitizeErrorMessageForClient(err.message, fallbackMessage)
    });
    return;
  }
  const status =
    err?.statusCode ||
    (err?.code === 'UNKNOWN_RESULT' ? 504 : err?.code === 'SHEETS_UNAVAILABLE' ? 503 : 500);
  res.status(status).json({
    success: false,
    ...(err?.code ? { code: err.code } : {}),
    error: sanitizeErrorMessageForClient(err?.message, fallbackMessage)
  });
}

export async function createServerApp(options?: { attachVite?: boolean; persistenceTransport?: RpcTransport; persistenceTenant?: string; imageStorage?: ImageStorage | null }) {
  const app = express();
  const httpServer = http.createServer(app);
  // منفذ 3000 الإلزامي للعمل داخل بيئة AI Studio iFrame
const PORT = Number(process.env.PORT || 3000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`قيمة PORT غير صالحة: ${process.env.PORT}`);
}

  // ترويسات الأمان عبر helmet بإعدادات متوافقة مع iFrame والواجهة والخطوط والطباعة
  app.set('trust proxy', 1);
  app.use(
    helmet({
      frameguard: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
          connectSrc: ["'self'", 'https:', 'wss:', 'ws:'],
          workerSrc: ["'self'", 'blob:'],
          mediaSrc: ["'self'", 'blob:', 'data:'],
          frameAncestors: ['*'],
          upgradeInsecureRequests: null
        }
      }
    })
  );

  // محددات معدل الطلبات (Rate Limiters) برسائل عربية
  const loginRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        success: false,
        error: 'تم تجاوز الحد المسموح لمحاولات تسجيل الدخول (10 محاولات في الدقيقة). يرجى الانتظار دقيقة والمحاولة مرة أخرى.'
      });
    }
  });

  const apiRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: Request) =>
      req.originalUrl.startsWith('/api/auth/login') ||
      req.originalUrl.startsWith('/api/cart-journal/events'),
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        success: false,
        error: 'تم تجاوز الحد المسموح للطلبات (300 طلب في الدقيقة). يرجى الانتظار قليلًا والمحاولة مجددًا.'
      });
    }
  });

  app.use('/api/auth/login', loginRateLimiter);
  app.use('/api', apiRateLimiter);

  // سجل شاشة البيع يرسل طلبًا صغيرًا كل ثانية تقريبًا من كل كاشير، فله حد مستقل أعلى
  app.use(
    '/api/cart-journal/events',
    rateLimit({
      windowMs: 60 * 1000,
      max: 1200,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req: Request, res: Response) => {
        res.status(429).json({ success: false, error: 'تم تجاوز الحد المسموح لطلبات سجل شاشة البيع. ستُعاد المحاولة تلقائيًا.' });
      }
    })
  );

  // حد حجم الطلب: 15MB لمسارات الاستيراد والإكسيل فقط، و2MB لكافة المسارات الأخرى
  const jsonParser2MB = express.json({ limit: '2mb' });
  const jsonParser15MB = express.json({ limit: '15mb' });
  const LARGE_PAYLOAD_PATHS = new Set([
    '/api/items/import-batch',
    '/api/items/bulk-edit-excel/preview',
    '/api/items/bulk-edit-excel/execute',
    '/api/items/bulk-edit-excel/errors-file',
    '/api/backup/inspect',
    '/api/backup/restore'
  ]);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const cleanPath = req.path.replace(/\/+$/, '');
    const parser = LARGE_PAYLOAD_PATHS.has(cleanPath) ? jsonParser15MB : jsonParser2MB;
    parser(req, res, (err: any) => {
      if (err) {
        if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
          const maxLabel = LARGE_PAYLOAD_PATHS.has(cleanPath) ? '15 ميجابايت' : '2 ميجابايت';
          res.status(413).json({
            success: false,
            error: `حجم البيانات المرسلة يتجاوز الحد المسموح (${maxLabel})`
          });
          return;
        }
        console.error('[Body Parser Error]:', err?.stack || err?.message || err);
        res.status(400).json({
          success: false,
          error: 'بيانات الطلب غير صالحة'
        });
        return;
      }
      next();
    });
  });

  // طبقة الحفظ الدائم (Supabase): تُفعَّل فقط عند ضبط SUPABASE_URL و SUPABASE_SECRET_KEY
  // (أو عند تمرير ناقل اختبار عبر options.persistenceTransport في الاختبارات الآلية)
  const persistenceEnv = readPersistenceEnv();
  // مجموعات بيانات الشركة (هي ما يدخل ملف النسخة الاحتياطية)
  const dataCollections = getPersistenceCollections();
  const persistenceTenant = options?.persistenceTenant || persistenceEnv.tenant;
  const cashboxesCollection = dataCollections.find(c => c.name === 'cashboxes');
  const cashboxTransactionsCollection = dataCollections.find(c => c.name === 'cashboxTransactions');
  const linkedAccounts = new LinkedAccounts({
    getCashboxes: () => (cashboxesCollection ? cashboxesCollection.get() : []),
    getCashboxTransactions: () => (cashboxTransactionsCollection ? cashboxTransactionsCollection.get() : [])
  });
  // الخزن المتابَعة برصيد يدوي (بديل الخصوصية): المسؤول يكتب الرصيد في موعده، ويُحفظ مع حركة الخزنة في نفس العملية
  const usersCollection = dataCollections.find((def) => def.name === 'users')!;
  const manualBalances = new ManualBalances({
    getCashboxes: () => (cashboxesCollection ? cashboxesCollection.get() : []) || [],
    getCashboxTransactions: () => (cashboxTransactionsCollection ? cashboxTransactionsCollection.get() : []) || [],
    getUsers: () => usersCollection.get() || [],
    cashboxLinkedByMessages: (cashboxId) => linkedAccounts.listAccounts().find((a) => a.cashboxId === cashboxId)?.name || ''
  });
  // إعدادات البيع وقواعد السعر: تُحفظ مع باقي البيانات وتدخل ملف النسخة الاحتياطية
  const salesRulesCollection = getSalesRulesCollection();
  // إعدادات شاشة الزوار (صور العرض روابط في تخزين الصور)
  const visitorSettingsCollection = getVisitorSettingsCollection();
  // إعدادات طابعة الباركود (التكت)
  const labelSettingsCollection = getLabelSettingsCollection();
  // ترقيم الفواتير (الشكل + العد الحالي) وإعداد تكرار رقم طلب المنصة
  const invoiceNumberingCollection = getInvoiceNumberingCollection();
  // التوصيل: الإعدادات والمناطق والطيارين والشركات + الطلبات والتسويات والصرف
  const deliveryCollections = delivery.getDeliveryCollections();
  // ما يدخل ملف النسخة الاحتياطية: بيانات الشركة + إعدادات البيع + شاشة الزوار + الترقيم + الخزن المربوطة (رسائل ورصيد يدوي) + التوصيل
  const backupCollections = [...dataCollections, salesRulesCollection, visitorSettingsCollection, labelSettingsCollection, invoiceNumberingCollection, ...linkedAccounts.collections(), ...manualBalances.collections(), ...deliveryCollections];
  // تخزين الصور على Supabase Storage: يعمل مع قاعدة البيانات (نفس العنوان والمفتاح، ومجلد لكل شركة)
  const imageStorage: ImageStorage | null =
    options?.imageStorage !== undefined
      ? options.imageStorage
      : persistenceEnv.enabled
        ? new ImageStorage({ url: persistenceEnv.url, secretKey: persistenceEnv.secretKey, tenant: options?.persistenceTenant || persistenceEnv.tenant })
        : null;
  const sendImageStorageError = (res: Response, err: any): boolean => {
    if (!(err instanceof ImageStorageError)) return false;
    res.status(err.code === 'TOO_LARGE' ? 413 : err.code === 'UNAVAILABLE' ? 503 : 400).json({ success: false, code: err.code, error: err.message });
    return true;
  };
  let persistence: StatePersistence | null = null;
  let persistenceTransport: RpcTransport | null = null;
  if (options?.persistenceTransport || persistenceEnv.enabled) {
    if (!options?.persistenceTransport && persistenceEnv.problem) {
      throw new Error(`إعدادات قاعدة البيانات غير صحيحة: ${persistenceEnv.problem}`);
    }
    persistenceTransport =
      options?.persistenceTransport ||
      createSupabaseTransport({
        url: persistenceEnv.url,
        secretKey: persistenceEnv.secretKey,
        restUrl: persistenceEnv.restUrl || undefined
      });
    persistence = new StatePersistence({
      transport: persistenceTransport,
      tenant: persistenceTenant,
      collections: [...dataCollections, getBackupMetaCollection(), getResetMetaCollection(), getAuthSessionsCollection(), ...linkedAccounts.collections(), ...manualBalances.collections(), salesRulesCollection, visitorSettingsCollection, labelSettingsCollection, invoiceNumberingCollection, ...deliveryCollections],
      onEmpty: () => applyCleanInitialState()
    });
    await persistence.start();
    persistence.startAutoFlush(60_000);
  }
  app.use(
    '/api',
    createPersistenceMiddleware(persistence, {
      alwaysAllow: (p) =>
        p === '/health' ||
        p === '/health/' ||
        p === '/cart-journal/events' ||
        p === '/database/public-status' ||
        p === '/database/setup-sql' ||
        p === '/database/check' ||
        // رفع صورة لا يغيّر البيانات (يرجع رابطًا فقط): لا يحجز قفل الحفظ حتى لا يعطّل البيع أثناء الرفع
        p === '/upload-image'
    })
  );

  // سجل أصناف شاشة البيع غير المباعة: حالة وحفظ مستقلان عن طابور الحفظ الرئيسي
  const cartJournal = new CartJournal({
    transport: persistenceTransport,
    tenant: options?.persistenceTenant || persistenceEnv.tenant
  });
  await cartJournal.start();
  cartJournal.setSoldResolver((cartId) => findInvoiceSaleByCartId(cartId));

  app.use(authMiddleware as any);

  // إجبار إدخال الرصيد: المسؤول عن خزنة «إجباري» لا يكمل أي عملية قبل كتابة الرصيد أو التأجيل (مرة واحدة لمدة ساعة).
  // القراءة مسموحة دائمًا، وكذلك الدخول/الخروج ومسارات إدخال الرصيد نفسها ورفع عمليات الأوفلاين المسجلة مسبقًا.
  app.use((req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.userSession || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const p = req.path;
    if (!p.startsWith('/api/') || p.startsWith('/api/auth/') || p.startsWith('/api/bank-link/') || p === '/api/offline/sync' || p === '/api/cart-journal/events') return next();
    const blocking = manualBalances.blockingFor(req.userSession.userId);
    if (!blocking) return next();
    res.status(423).json({
      success: false,
      code: 'BALANCE_REQUIRED',
      accountId: blocking.accountId,
      error: `اكتب الرصيد الحالي للحساب «${blocking.accountName}» أولًا حتى تكمل العمل`
    });
  });

  // ===================== API ENDPOINTS ===================== //

  // ===================== قاعدة البيانات: الحالة والفحص وكود التهيئة ===================== //

  let cachedSetupCheck: { at: number; result: DatabaseCheckResult } | null = null;
  const runDatabaseCheck = async (force: boolean): Promise<DatabaseCheckResult | null> => {
    if (!persistenceTransport) return null;
    if (!force && cachedSetupCheck && Date.now() - cachedSetupCheck.at < 10_000) return cachedSetupCheck.result;
    const result = await checkDatabaseSetup(persistenceTransport, persistenceTenant);
    cachedSetupCheck = { at: Date.now(), result };
    return result;
  };
  const databaseNeedsSetup = () => Boolean(persistence && !persistence.isReady());

  // حالة عامة بدون تسجيل دخول: تُستخدم في شاشة الدخول لعرض خطوات التهيئة عندما تكون قاعدة البيانات غير جاهزة
  app.get('/api/database/public-status', async (_req: Request, res: Response) => {
    try {
      const needsSetup = databaseNeedsSetup();
      const check = needsSetup ? await runDatabaseCheck(false) : null;
      res.json({
        success: true,
        configured: Boolean(persistence),
        ready: persistence ? persistence.isReady() : true,
        needsSetup,
        ...(needsSetup
          ? { check, sqlEditorUrl: describeDatabaseTarget(persistenceEnv.url).sqlEditorUrl }
          : {})
      });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر قراءة حالة قاعدة البيانات');
    }
  });

  // كود التهيئة: عام فقط عندما تكون القاعدة غير جاهزة، وغير ذلك يحتاج صلاحية ربط النظام
  app.get('/api/database/setup-sql', (req: AuthenticatedRequest, res: Response) => {
    try {
      const allowed = databaseNeedsSetup() || Boolean(req.userSession?.permissions?.includes('settings.system_integration')) || Boolean(req.userSession?.role === 'designer' || req.userSession?.isOwner);
      if (!allowed) {
        res.status(req.userSession ? 403 : 401).json({ success: false, error: 'غير مصرح لك بعرض كود تهيئة قاعدة البيانات' });
        return;
      }
      res.type('text/plain; charset=utf-8').send(readSetupSql());
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر قراءة كود التهيئة');
    }
  });

  app.get('/api/database/status', requirePermission('settings.system_integration') as any, (_req: AuthenticatedRequest, res: Response) => {
    res.json({
      success: true,
      persistenceMode: persistence ? 'supabase' : 'none',
      tenant: persistence ? persistenceTenant : '',
      target: persistence ? describeDatabaseTarget(persistenceEnv.url) : { host: '', projectRef: '', sqlEditorUrl: '' },
      status: persistence ? persistence.getStatus() : { enabled: false },
      backup: getBackupMeta(),
      requiredEnvNames: ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_TENANT_ID']
    });
  });

  app.post('/api/database/check', requirePermission('settings.system_integration') as any, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      if (!persistenceTransport) {
        res.json({ success: true, configured: false, message: 'قاعدة البيانات غير مضبوطة على هذا السيرفر (وضع المعاينة — البيانات لا تُحفظ).' });
        return;
      }
      const check = await runDatabaseCheck(true);
      res.json({ success: true, configured: true, check });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر فحص قاعدة البيانات');
    }
  });

  // ===================== النسخ الاحتياطي والاسترجاع ===================== //

  app.get('/api/backup/status', requirePermission('settings.backup') as any, (_req: AuthenticatedRequest, res: Response) => {
    res.json({ success: true, backup: getBackupMeta(), tenant: persistenceTenant, persistenceMode: persistence ? 'supabase' : 'none' });
  });

  app.get('/api/backup/export', requirePermission('settings.backup') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const produce = async () => {
        try {
          if (persistence) await persistence.persist();
          const backup = buildBackup(backupCollections, {
            tenant: persistenceTenant,
            createdBy: session.name || session.username || '',
            storeName: getCompanySettings().storeName
          });
          noteBackupTaken(session.name || session.username || '');
          recordAuditLog(
            { id: session.userId, name: session.name, role: session.role, phone: session.phone },
            'BACKUP_EXPORT',
            'system',
            'backup',
            `تنزيل نسخة احتياطية (${backup.summary.totalRecords} سجل)`
          );
          if (persistence) await persistence.persist();
          return backup;
        } catch (err) {
          if (persistence) await persistence.recover();
          throw err;
        }
      };
      const backup = persistence ? await persistence.lock.run(produce) : await produce();
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${backup.fileName}"`);
      res.setHeader('X-Backup-File-Name', backup.fileName);
      res.send(backup.buffer);
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر إنشاء النسخة الاحتياطية');
    }
  });

  const decodeBackupFile = (raw: unknown): Buffer => {
    if (typeof raw !== 'string' || raw.length < 20) {
      throw new BackupError('INVALID_FILE', 'لم يتم إرفاق ملف النسخة الاحتياطية');
    }
    return Buffer.from(raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw, 'base64');
  };

  // قراءة ملخص الملف فقط قبل الاسترجاع (لا يغيّر شيئًا)
  app.post('/api/backup/inspect', requirePermission('settings.backup') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = readBackup(decodeBackupFile(req.body?.fileBase64));
      res.json({
        success: true,
        summary: parsed.summary,
        currentTenant: persistenceTenant,
        tenantMismatch: Boolean(parsed.summary.tenant) && parsed.summary.tenant !== persistenceTenant
      });
    } catch (err: any) {
      if (err instanceof BackupError) {
        res.status(400).json({ success: false, code: err.code, error: err.message });
        return;
      }
      handleCatchError(res, err, 'تعذر قراءة ملف النسخة الاحتياطية');
    }
  });

  // الاسترجاع: يستبدل كل بيانات الشركة بمحتوى الملف. الحفظ في قاعدة البيانات ذرّي عبر وسيط الحفظ
  app.post('/api/backup/restore', requirePermission('settings.backup') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      if (String(req.body?.confirmText || '').trim() !== 'استرجاع') {
        res.status(400).json({ success: false, error: 'للتأكيد اكتب كلمة «استرجاع» كما هي' });
        return;
      }
      if (!verifyUserPasswordById(session.userId, String(req.body?.password || ''))) {
        res.status(403).json({ success: false, error: 'كلمة السر غير صحيحة' });
        return;
      }
      const parsed = readBackup(decodeBackupFile(req.body?.fileBase64));
      const result = applyBackup(backupCollections, parsed);
      noteBackupRestored(session.name || session.username || '', parsed.summary.createdAt);
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        'BACKUP_RESTORE',
        'system',
        'backup',
        `استرجاع نسخة احتياطية بتاريخ ${parsed.summary.createdAt} (${result.totalRecords} سجل)`
      );
      // بعد اكتمال الرد: كل المستخدمين يسجلون الدخول من جديد ببيانات النسخة المسترجعة
      res.on('finish', () => {
        if (res.statusCode < 400) activeSessions.clear();
      });
      res.json({ success: true, summary: parsed.summary, restored: result.restored, totalRecords: result.totalRecords, ignored: result.ignored, missing: result.missing });
    } catch (err: any) {
      if (err instanceof BackupError) {
        res.status(400).json({ success: false, code: err.code, error: err.message });
        return;
      }
      handleCatchError(res, err, 'تعذر استرجاع النسخة الاحتياطية');
    }
  });

  // ===================== إعادة الضبط ===================== //

  const RESET_OPERATIONS_PHRASE = 'مسح العمليات';
  const FACTORY_RESET_PHRASE = 'مسح كل شيء';

  app.get('/api/system/reset-status', requireAuth as any, (req: AuthenticatedRequest, res: Response) => {
    const perms = req.userSession?.permissions || [];
    if (!perms.includes('settings.reset_operations') && !perms.includes('settings.factory_reset')) {
      res.status(403).json({ success: false, error: 'غير مصرح لك بعرض حالة إعادة الضبط' });
      return;
    }
    res.json({
      success: true,
      reset: getResetMeta(),
      canResetOperations: perms.includes('settings.reset_operations'),
      canFactoryReset: perms.includes('settings.factory_reset'),
      phrases: { operations: RESET_OPERATIONS_PHRASE, factory: FACTORY_RESET_PHRASE },
      unclassifiedCollections: findUnclassifiedCollections(dataCollections)
    });
  });

  const confirmResetRequest = (req: AuthenticatedRequest, res: Response, phrase: string): boolean => {
    if (String(req.body?.confirmText || '').trim() !== phrase) {
      res.status(400).json({ success: false, error: `للتأكيد اكتب «${phrase}» كما هي` });
      return false;
    }
    if (!verifyUserPasswordById(req.userSession!.userId, String(req.body?.password || ''))) {
      res.status(403).json({ success: false, error: 'كلمة السر غير صحيحة' });
      return false;
    }
    return true;
  };

  // إعادة ضبط العمليات: تمسح الحركة وتصفّر الكميات والأرصدة وتُبقي الأسماء. الحفظ ذرّي عبر وسيط الحفظ
  app.post('/api/system/reset-operations', requirePermission('settings.reset_operations') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      if (!confirmResetRequest(req, res, RESET_OPERATIONS_PHRASE)) return;
      const unclassified = findUnclassifiedCollections(dataCollections);
      if (unclassified.length > 0) {
        res.status(500).json({ success: false, error: `لا يمكن إعادة الضبط: مجموعات بيانات غير مصنفة (${unclassified.join('، ')})` });
        return;
      }
      const result = resetOperations(dataCollections);
      linkedAccounts.resetOperationsState();
      manualBalances.resetOperationsState();
      resetInvoiceCounterState();
      delivery.resetDeliveryOperations();
      noteReset('operations', session.name || session.username || '');
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        'SYSTEM_RESET_OPERATIONS',
        'system',
        'reset',
        `إعادة ضبط العمليات: مسح ${result.totalCleared} سجل حركة وتصفير الكميات والأرصدة مع بقاء الأسماء`
      );
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        activeSessions.clear();
        cartJournal.resetAll({ keepDevices: true }).catch((err) => console.error('[cart-journal] تعذر مسح السجل بعد إعادة الضبط:', err?.message || err));
      });
      res.json({ success: true, ...result });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر تنفيذ إعادة ضبط العمليات');
    }
  });

  // إعادة ضبط المصنع: كل شيء يُمسح، ويبقى حساب مالك النظام وحساب من نفّذ العملية فقط
  app.post('/api/system/factory-reset', requirePermission('settings.factory_reset') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      if (!confirmResetRequest(req, res, FACTORY_RESET_PHRASE)) return;
      const result = factoryReset(dataCollections, {
        applyCleanInitialState: () => applyCleanInitialState(),
        keepUser: (user: any) => user.id === session.userId || user.role === 'designer' || Boolean(user.isOwner)
      });
      linkedAccounts.resetAll();
      manualBalances.resetAll();
      resetSalesRules();
      resetInvoiceNumbering();
      delivery.resetDelivery();
      resetLabelSettings();
      const visitorImagePaths = resetVisitorSettings();
      res.on('finish', () => {
        if (res.statusCode < 400 && imageStorage && visitorImagePaths.length) imageStorage.remove(visitorImagePaths).catch(() => undefined);
      });
      noteReset('factory', session.name || session.username || '');
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        'SYSTEM_FACTORY_RESET',
        'system',
        'reset',
        `إعادة ضبط المصنع: مسح كل البيانات (${result.totalCleared} سجل). الحسابات الباقية: ${result.keptUsers.map((u) => u.name).join('، ')}`
      );
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        activeSessions.clear();
        cartJournal.resetAll({ keepDevices: false }).catch((err) => console.error('[cart-journal] تعذر مسح السجل بعد إعادة الضبط:', err?.message || err));
      });
      res.json({ success: true, ...result });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر تنفيذ إعادة ضبط المصنع');
    }
  });

  // ===================== إعدادات البيع وقواعد السعر ===================== //

  // القراءة لأي مستخدم مسجل (شاشة البيع تحتاجها)، والتعديل لمن معه صلاحية settings.sales_rules
  const salesRulesContext = () => ({
    platforms: (dataCollections.find((def) => def.name === 'platforms')?.get() || []) as any[],
    customers: (dataCollections.find((def) => def.name === 'customers')?.get() || []) as any[]
  });

  app.get('/api/settings/sales-rules', requireAuth as any, (_req: AuthenticatedRequest, res: Response) => {
    try {
      res.json({ success: true, rules: describeSalesRules(salesRulesContext()) });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر تحميل إعدادات البيع');
    }
  });

  app.post('/api/settings/sales-rules', requirePermission('settings.sales_rules') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const before = getSalesRules();
      const saved = saveSalesRules(req.body || {}, { ...salesRulesContext(), by: session.name || session.username || '' });
      const changes: string[] = [];
      if (before.defaultSaleMode !== saved.defaultSaleMode) changes.push(`وضع البيع الافتراضي: ${saved.defaultSaleMode}`);
      if (before.platformSelection !== saved.platformSelection || before.defaultPlatformId !== saved.defaultPlatformId) changes.push(`المنصة الافتراضية: ${saved.platformSelection}${saved.defaultPlatformId ? ` (${saved.defaultPlatformId})` : ''}`);
      if (before.customerSelection !== saved.customerSelection || before.defaultCustomerId !== saved.defaultCustomerId) changes.push(`العميل الافتراضي: ${saved.customerSelection}${saved.defaultCustomerId ? ` (${saved.defaultCustomerId})` : ''}`);
      if (before.allowZeroPriceSale !== saved.allowZeroPriceSale) changes.push(`البيع بسعر صفر: ${saved.allowZeroPriceSale ? 'مسموح' : 'ممنوع'}`);
      if (before.allowBelowCostSale !== saved.allowBelowCostSale) changes.push(`البيع بأقل من سعر الشراء: ${saved.allowBelowCostSale ? 'مسموح' : 'ممنوع'}`);
      if (before.platformAlwaysCredit !== saved.platformAlwaysCredit) changes.push(`بيع المنصات: ${saved.platformAlwaysCredit ? 'دايمًا آجل على المنصة' : 'حسب اختيار الكاشير'}`);
      if ((before.allowPlatformSale ?? true) !== saved.allowPlatformSale) changes.push(`السماح بالبيع على منصة: ${saved.allowPlatformSale ? 'مفعّل' : 'معطّل'}`);
      if ((before.allowDirectSale ?? true) !== saved.allowDirectSale) changes.push(`السماح بالبيع المباشر للعميل: ${saved.allowDirectSale ? 'مفعّل' : 'معطّل'}`);
      if ((before.platformsEnabled ?? true) !== saved.platformsEnabled) changes.push(`وظائف المنصات: ${saved.platformsEnabled ? 'مفعّلة' : 'موقوفة'}`);
      if (Boolean(before.salesOnlyMode) !== Boolean(saved.salesOnlyMode)) changes.push(`وضع البيع فقط: ${saved.salesOnlyMode ? 'مفعّل' : 'متوقف'}`);
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        'SALES_RULES_UPDATED',
        'settings',
        'sales-rules',
        `تعديل إعدادات البيع وقواعد السعر: ${changes.join('، ') || 'بدون تغيير'}`
      );
      res.json({ success: true, rules: describeSalesRules(salesRulesContext()) });
    } catch (err: any) {
      if (err instanceof SalesRulesError) {
        res.status(400).json({ success: false, code: err.code, error: err.message });
        return;
      }
      handleCatchError(res, err, 'تعذر حفظ إعدادات البيع');
    }
  });

  // ===================== ترقيم الفواتير ورقم طلب المنصة ===================== //

  const sendNumberingView = (res: Response) => {
    res.json({ success: true, ...describeInvoiceNumbering(new Date(), isInvoiceNumberUsed) });
  };

  app.get('/api/settings/invoice-numbering', requirePermission('settings.invoice_numbering') as any, (_req: AuthenticatedRequest, res: Response) => {
    try {
      sendNumberingView(res);
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر تحميل إعدادات ترقيم الفواتير');
    }
  });

  app.post('/api/settings/invoice-numbering', requirePermission('settings.invoice_numbering') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const saved = saveInvoiceNumberingSettings(req.body || {}, session.name || session.username || '');
      const preview = describeInvoiceNumbering(new Date(), isInvoiceNumberUsed);
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        'INVOICE_NUMBERING_UPDATED',
        'settings',
        'invoice-numbering',
        `تعديل ترقيم الفواتير: الفاتورة الجاية ${preview.nextNumber}، التصفير ${saved.resetPeriod}، تكرار رقم طلب المنصة ${saved.platformOrderDuplicates === 'block' ? 'ممنوع' : 'مسموح'}`
      );
      sendNumberingView(res);
    } catch (err: any) {
      if (err instanceof InvoiceNumberingError) {
        res.status(400).json({ success: false, code: err.code, error: err.message });
        return;
      }
      handleCatchError(res, err, 'تعذر حفظ إعدادات ترقيم الفواتير');
    }
  });

  // زرار «تصفير العدد الآن»
  app.post('/api/settings/invoice-numbering/reset-counter', requirePermission('settings.invoice_numbering') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const counter = resetInvoiceCounter(req.body || {}, session.name || session.username || '');
      const preview = describeInvoiceNumbering(new Date(), isInvoiceNumberUsed);
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        'INVOICE_NUMBERING_RESET',
        'settings',
        'invoice-numbering',
        `تصفير عد الفواتير: البداية من ${counter.last + 1}، الفاتورة الجاية ${preview.nextNumber}`
      );
      sendNumberingView(res);
    } catch (err: any) {
      if (err instanceof InvoiceNumberingError) {
        res.status(400).json({ success: false, code: err.code, error: err.message });
        return;
      }
      handleCatchError(res, err, 'تعذر تصفير عد الفواتير');
    }
  });

  // تعديل رقم طلب المنصة لفاتورة محفوظة
  app.put('/api/invoices/:id/platform-order', requirePlatformsEnabled as any, requirePermission('invoices.edit_after_save') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = setInvoicePlatformOrderId(req.params.id, req.body || {}, { role: session.role, permissions: session.permissions, name: session.name, phone: session.phone });
      if (!result.success) {
        res.status(result.statusCode || 400).json({ success: false, code: result.code, error: result.error });
        return;
      }
      res.json({ success: true, invoice: result.invoice });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر تعديل رقم طلب المنصة');
    }
  });

  // ===================== تخزين الصور ===================== //

  // كل المجموعات التي قد تحتوي صورًا محفوظة كنص داخل البيانات
  const imageCollections = () => [...dataCollections, visitorSettingsCollection];

  app.get('/api/system/images/status', requirePermission('settings.system_integration') as any, (_req: AuthenticatedRequest, res: Response) => {
    res.json({ success: true, storageEnabled: Boolean(imageStorage), inline: countInlineImages(imageCollections()) });
  });

  // نقل الصور القديمة المحفوظة كنص داخل البيانات إلى التخزين (على دفعات، يُكرر حتى يصبح الباقي صفرًا)
  app.post('/api/system/images/migrate', requirePermission('settings.system_integration') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!imageStorage) {
        res.status(503).json({ success: false, error: 'تخزين الصور غير مفعّل: اربط قاعدة البيانات أولًا' });
        return;
      }
      const result = await migrateInlineImages(imageCollections(), imageStorage, 200);
      const session = req.userSession!;
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        'IMAGES_MIGRATED',
        'system',
        'images',
        `نقل ${result.moved} صورة إلى تخزين الصور${result.failed ? ` (تعذر نقل ${result.failed})` : ''} — الباقي ${result.remaining}`
      );
      res.json({ success: true, ...result });
    } catch (err: any) {
      if (sendImageStorageError(res, err)) return;
      handleCatchError(res, err, 'تعذر نقل الصور');
    }
  });

  // ===================== شاشة الزوار ===================== //

  const sendVisitorError = (res: Response, err: any, fallback: string) => {
    if (err instanceof VisitorDisplayError) {
      res.status(err.code === 'NOT_FOUND' ? 404 : 400).json({ success: false, code: err.code, error: err.message });
      return;
    }
    if (sendImageStorageError(res, err)) return;
    handleCatchError(res, err, fallback);
  };
  // الشاشة نفسها: لمن معه «شاشة الزوار» أو «إعدادات شاشة الزوار» (للمعاينة)
  const requireVisitorScreen = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const session = req.userSession;
    if (!session) {
      res.status(401).json({ success: false, error: 'يرجى تسجيل الدخول للمتابعة', expired: true });
      return;
    }
    const perms = session.permissions || [];
    if (session.role === 'designer' || session.isOwner || perms.includes('visitor.display') || perms.includes('settings.visitor_display')) return next();
    res.status(403).json({ success: false, error: 'غير مصرح: تفتقر لصلاحية [visitor.display]' });
  };
  const visitorContext = () => ({
    items: (dataCollections.find((def) => def.name === 'items')?.get() || []) as any[],
    taxInclusive: getSystemConfig().taxSettings?.taxInclusive !== false
  });
  const companyForVisitor = () => {
    const company: any = dataCollections.find((def) => def.name === 'settings.company')?.get() || {};
    return { name: String(company.storeName || ''), logoUrl: String(company.logoUrl || '') };
  };

  app.get('/api/visitor/config', requireVisitorScreen as any, (_req: AuthenticatedRequest, res: Response) => {
    const current = getVisitorSettings();
    res.json({
      success: true,
      settings: { ...current, slides: current.slides.map((s) => ({ id: s.id, url: s.url })) },
      company: companyForVisitor()
    });
  });

  app.get('/api/visitor/lookup', requireVisitorScreen as any, (req: AuthenticatedRequest, res: Response) => {
    const product = lookupVisitorProduct(req.query.barcode, visitorContext());
    res.json({ success: true, found: Boolean(product), product });
  });

  // نسخة مضغوطة من الأسعار للعمل بدون اتصال
  app.get('/api/visitor/catalog', requireVisitorScreen as any, (_req: AuthenticatedRequest, res: Response) => {
    res.json({ success: true, catalog: buildVisitorCatalog(visitorContext()), generatedAt: new Date().toISOString() });
  });

  app.post('/api/visitor/settings', requirePermission('settings.visitor_display') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const saved = saveVisitorSettings(req.body || {}, session.name || session.username || '');
      recordAuditLog({ id: session.userId, name: session.name, role: session.role, phone: session.phone }, 'VISITOR_DISPLAY_UPDATED', 'settings', 'visitor-display', 'تعديل إعدادات شاشة الزوار');
      res.json({ success: true, settings: saved });
    } catch (err: any) {
      sendVisitorError(res, err, 'تعذر حفظ إعدادات شاشة الزوار');
    }
  });

  app.post('/api/visitor/slides', requirePermission('settings.visitor_display') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!imageStorage) {
        res.status(503).json({ success: false, error: 'تخزين الصور غير مفعّل: اربط قاعدة البيانات أولًا' });
        return;
      }
      if (getVisitorSettings().slides.length >= MAX_VISITOR_SLIDES) {
        res.status(400).json({ success: false, code: 'INVALID_INPUT', error: `الحد الأقصى ${MAX_VISITOR_SLIDES} صورة. احذف صورة قبل إضافة غيرها` });
        return;
      }
      const stored = await imageStorage.upload({ imageBase64: req.body?.imageBase64, folder: 'visitor' });
      const slide = addVisitorSlide({ url: stored.url, path: stored.path });
      res.json({ success: true, slide, settings: getVisitorSettings() });
    } catch (err: any) {
      sendVisitorError(res, err, 'تعذر إضافة الصورة');
    }
  });

  app.delete('/api/visitor/slides/:id', requirePermission('settings.visitor_display') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const removed = removeVisitorSlide(String(req.params.id));
      // حذف الملف من التخزين بعد نجاح حفظ البيانات فقط
      res.on('finish', () => {
        if (res.statusCode < 400 && imageStorage && removed.path && !removed.stillUsed) imageStorage.remove([removed.path]).catch(() => undefined);
      });
      res.json({ success: true, settings: getVisitorSettings() });
    } catch (err: any) {
      sendVisitorError(res, err, 'تعذر حذف الصورة');
    }
  });

  app.post('/api/visitor/slides/order', requirePermission('settings.visitor_display') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      reorderVisitorSlides(req.body?.ids);
      res.json({ success: true, settings: getVisitorSettings() });
    } catch (err: any) {
      sendVisitorError(res, err, 'تعذر ترتيب الصور');
    }
  });

  // ===================== طباعة التكت (ستيكر الباركود) ===================== //

  const requireLabelAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const session = req.userSession;
    if (!session) {
      res.status(401).json({ success: false, error: 'يرجى تسجيل الدخول للمتابعة', expired: true });
      return;
    }
    const perms = session.permissions || [];
    if (session.role === 'designer' || session.isOwner || perms.includes('items.print_labels') || perms.includes('settings.label_print')) return next();
    res.status(403).json({ success: false, error: 'غير مصرح: تفتقر لصلاحية [items.print_labels]' });
  };

  app.get('/api/labels/settings', requireFullMode as any, requireLabelAccess as any, (_req: AuthenticatedRequest, res: Response) => {
    res.json({ success: true, settings: getLabelSettings() });
  });

  app.post('/api/labels/settings', requireFullMode as any, requirePermission('settings.label_print') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const saved = saveLabelSettings(req.body || {}, session.name || session.username || '');
      recordAuditLog({ id: session.userId, name: session.name, role: session.role, phone: session.phone }, 'LABEL_SETTINGS_UPDATED', 'settings', 'label-print', `تعديل إعدادات طابعة الباركود: ${saved.labelWidthMm}×${saved.labelHeightMm} مم، ${saved.columns} في الصف`);
      res.json({ success: true, settings: saved });
    } catch (err: any) {
      if (err instanceof LabelSettingsError) {
        res.status(400).json({ success: false, code: err.code, error: err.message });
        return;
      }
      handleCatchError(res, err, 'تعذر حفظ إعدادات طابعة الباركود');
    }
  });

  // إضافة باركود فرعي لصنف (من شاشة طباعة التكت عند طباعة باركود غير مسجل)
  app.post('/api/items/:id/barcodes', requireFullMode as any, requirePermission('items.edit') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const barcode = String(req.body?.barcode ?? '').trim().replace(/\s+/g, '');
      if (!barcode || barcode.length > 64) {
        res.status(400).json({ success: false, error: 'اكتب الباركود (حتى 64 حرفًا)' });
        return;
      }
      try {
        encodeBarcode(barcode, 'auto');
      } catch (err: any) {
        res.status(400).json({ success: false, error: err?.message || 'الباركود لا يمكن طباعته' });
        return;
      }
      const items = (dataCollections.find((def) => def.name === 'items')?.get() || []) as any[];
      const item = items.find((i) => String(i.id) === String(req.params.id));
      if (!item) {
        res.status(404).json({ success: false, error: 'الصنف غير موجود' });
        return;
      }
      const owner = items.find((i) => itemBarcodeList(i).some((b) => b.toUpperCase() === barcode.toUpperCase()));
      if (owner && owner.id === item.id) {
        res.json({ success: true, item, alreadyRegistered: true });
        return;
      }
      if (owner) {
        res.status(400).json({ success: false, error: `الباركود ${barcode} مسجل على صنف آخر: «${owner.name}»` });
        return;
      }
      const result = await saveItem(
        { ...item, secondaryBarcodes: [...(Array.isArray(item.secondaryBarcodes) ? item.secondaryBarcodes : []), barcode], editReason: 'إضافة باركود فرعي من طباعة التكت' } as any,
        { token: req.authToken, role: session.role, permissions: session.permissions, phone: session.phone }
      );
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر إضافة الباركود');
    }
  });

  // ===================== الخزن المربوطة برسائل البنك والمحافظ ===================== //

  const readIntakeKey = (req: Request): string => {
    const headerKey = req.headers['x-intake-key'];
    const raw = Array.isArray(headerKey) ? headerKey[0] : (headerKey || req.query?.key || req.body?.key || '');
    return String(raw || '').trim();
  };

  const handleBankLinkError = (res: Response, err: any, fallback: string) => {
    if (err instanceof LinkedAccountsError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'UNAUTHORIZED' ? 401 : 400;
      res.status(status).json({ success: false, code: err.code, error: err.message });
      return;
    }
    handleCatchError(res, err, fallback);
  };

  // أسماء الحقول تختلف من تطبيق تحويل لآخر: نقبل الأسماء الشائعة، من جسم الطلب أولًا ثم من الرابط
  const INTAKE_FIELD_NAMES = {
    sender: ['sender', 'from', 'address', 'package', 'packageName', 'app', 'appName', 'title'],
    text: ['text', 'content', 'message', 'msg', 'body', 'sms'],
    at: ['at', 'time', 'timestamp', 'date', 'receivedAt'],
    deviceId: ['deviceId', 'device', 'deviceName'],
    battery: ['battery', 'batteryLevel']
  };
  const pickIntakeField = (req: Request, names: string[]): unknown => {
    for (const source of [req.body, req.query] as any[]) {
      if (!source || typeof source !== 'object') continue;
      for (const name of names) {
        const value = source[name];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
      }
    }
    return undefined;
  };

  // استقبال رسالة دفع من تطبيق الهاتف (بدون تسجيل دخول — يعتمد على مفتاح الاستقبال فقط)
  app.post('/api/bank-link/intake', (req: Request, res: Response) => {
    try {
      if (!linkedAccounts.isValidIntakeKey(readIntakeKey(req))) {
        res.status(401).json({ success: false, error: 'مفتاح الاستقبال غير صحيح' });
        return;
      }
      const result = linkedAccounts.intake({
        sender: pickIntakeField(req, INTAKE_FIELD_NAMES.sender),
        text: pickIntakeField(req, INTAKE_FIELD_NAMES.text),
        at: pickIntakeField(req, INTAKE_FIELD_NAMES.at),
        deviceId: pickIntakeField(req, INTAKE_FIELD_NAMES.deviceId),
        battery: pickIntakeField(req, INTAKE_FIELD_NAMES.battery)
      });
      if (result.status === 'empty') {
        // لا نرد «نجاح» على رسالة لم تُفهم حقولها: تطبيق الهاتف يجب أن يظهر الخطأ وقت الإعداد بدل أن تضيع الرسائل في صمت
        res.status(400).json({
          success: false,
          ...result,
          error: 'الرسالة وصلت بدون اسم المرسل أو بدون النص. أرسل المرسل في الحقل sender (أو from) والنص في الحقل text (أو content أو message أو msg أو body)'
        });
        return;
      }
      res.json({ success: true, ...result });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر استقبال الرسالة');
    }
  });

  // نبضة حالة الهاتف (بدون تسجيل دخول — يعتمد على مفتاح الاستقبال فقط)
  app.post('/api/bank-link/heartbeat', (req: Request, res: Response) => {
    try {
      if (!linkedAccounts.isValidIntakeKey(readIntakeKey(req))) {
        res.status(401).json({ success: false, error: 'مفتاح الاستقبال غير صحيح' });
        return;
      }
      linkedAccounts.heartbeat(pickIntakeField(req, INTAKE_FIELD_NAMES.deviceId), pickIntakeField(req, INTAKE_FIELD_NAMES.battery));
      res.json({ success: true });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر تسجيل حالة الهاتف');
    }
  });

  app.get('/api/bank-link/overview', requirePermission('settings.bank_link') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const canManageTemplates =
        session.role === 'designer' ||
        session.isOwner ||
        (session.permissions || []).includes('settings.bank_templates');
      const intakeKey = linkedAccounts.getIntakeKey();
      if (persistence && persistence.hasPendingChanges()) {
        await persistence.lock.run(() => persistence!.persist());
      }
      const overview = linkedAccounts.getOverview();
      res.json({
        success: true,
        ...overview,
        intakeKey,
        intakePath: '/api/bank-link/intake',
        heartbeatPath: '/api/bank-link/heartbeat',
        canManageTemplates,
        templates: canManageTemplates ? linkedAccounts.listTemplates() : []
      });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر تحميل بيانات الخزن المربوطة');
    }
  });

  app.post('/api/bank-link/intake-key/regenerate', requirePermission('settings.bank_link') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const intakeKey = linkedAccounts.regenerateIntakeKey();
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        'BANK_LINK_KEY_REGENERATED',
        'system',
        'bank-link',
        'تجديد مفتاح استقبال رسائل البنك'
      );
      res.json({ success: true, intakeKey });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر تجديد مفتاح الاستقبال');
    }
  });

  app.post('/api/bank-link/accounts', requirePermission('settings.bank_link') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const isEdit = Boolean(req.body?.id);
      const manualName = manualBalances.accountNameForCashbox(String(req.body?.cashboxId || ''));
      if (manualName) {
        res.status(400).json({ success: false, code: 'INVALID_INPUT', error: `هذه الخزنة متابَعة برصيد يدوي في الحساب «${manualName}». الخزنة الواحدة تُتابَع بطريقة واحدة` });
        return;
      }
      const account = linkedAccounts.saveAccount(req.body || {});
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        isEdit ? 'BANK_LINK_ACCOUNT_UPDATED' : 'BANK_LINK_ACCOUNT_CREATED',
        'bank-link',
        account.id,
        `${isEdit ? 'تعديل' : 'ربط'} حساب بنكي «${account.name}» بالخزنة (${account.cashboxId})`
      );
      res.json({ success: true, account });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر حفظ الحساب المربوط');
    }
  });

  app.post('/api/bank-link/accounts/:id/enabled', requirePermission('settings.bank_link') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const account = linkedAccounts.setAccountEnabled(req.params.id, Boolean(req.body?.enabled));
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        'BANK_LINK_ACCOUNT_TOGGLED',
        'bank-link',
        account.id,
        `${account.enabled ? 'تفعيل' : 'إيقاف'} استقبال رسائل الحساب «${account.name}»`
      );
      res.json({ success: true, account });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر تغيير حالة الحساب المربوط');
    }
  });

  app.delete('/api/bank-link/accounts/:id', requirePermission('settings.bank_link') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      linkedAccounts.deleteAccount(req.params.id);
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        'BANK_LINK_ACCOUNT_DELETED',
        'bank-link',
        req.params.id,
        `حذف ربط الحساب البنكي (${req.params.id})`
      );
      res.json({ success: true });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر حذف الحساب المربوط');
    }
  });

  app.post('/api/bank-link/templates', requirePermission('settings.bank_templates') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const template = linkedAccounts.saveTemplate(req.body || {});
      res.json({ success: true, template });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر حفظ القالب');
    }
  });

  app.delete('/api/bank-link/templates/:id', requirePermission('settings.bank_templates') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      linkedAccounts.deleteTemplate(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر حذف القالب');
    }
  });

  app.post('/api/bank-link/templates/suggest', requirePermission('settings.bank_templates') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const suggestion = linkedAccounts.suggestTemplate(String(req.body?.text || ''));
      res.json({ success: true, suggestion });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر اقتراح قالب من النص');
    }
  });

  app.post('/api/bank-link/templates/test', requirePermission('settings.bank_templates') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const reading = linkedAccounts.testMessage(String(req.body?.text || ''), String(req.body?.sender || ''));
      res.json({ success: true, reading });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر تجربة قراءة الرسالة');
    }
  });

  app.get('/api/bank-link/templates/export', requirePermission('settings.bank_templates') as any, (_req: AuthenticatedRequest, res: Response) => {
    try {
      res.json({ success: true, templates: linkedAccounts.exportTemplates() });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر تصدير القوالب');
    }
  });

  app.post('/api/bank-link/templates/import', requirePermission('settings.bank_templates') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const list = Array.isArray(req.body) ? req.body : req.body?.templates;
      const added = linkedAccounts.importTemplates(list);
      res.json({ success: true, added, templates: linkedAccounts.listTemplates() });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر استيراد القوالب');
    }
  });

  app.get('/api/bank-link/messages/:id', requirePermission('settings.bank_templates') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const message = linkedAccounts.getMessageText(req.params.id);
      if (!message) {
        res.status(404).json({ success: false, error: 'الرسالة غير موجودة' });
        return;
      }
      res.json({ success: true, message });
    } catch (err: any) {
      handleBankLinkError(res, err, 'تعذر قراءة نص الرسالة');
    }
  });

  // ===================== الخزن المتابَعة برصيد يدوي (بدون قراءة رسائل) ===================== //

  const sendManualBalanceError = (res: Response, err: any, fallback: string) => {
    if (err instanceof ManualBalanceError) {
      res.status(err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400).json({ success: false, code: err.code, error: err.message });
      return;
    }
    handleCatchError(res, err, fallback);
  };
  const canManageBankLink = (session: SessionData) => session.role === 'designer' || Boolean(session.isOwner) || Boolean(session.permissions?.includes('settings.bank_link'));
  const auditActor = (session: SessionData) => ({ id: session.userId, name: session.name, role: session.role, phone: session.phone });

  // ما المطلوب من المستخدم الحالي الآن؟ (لأي مستخدم مسجل: المسؤول يرى طلباته، وصاحب صلاحية الإدارة يرى تنبيهات الفروق)
  app.get('/api/bank-link/balance-requests', requireAuth as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      res.json({
        success: true,
        requests: manualBalances.getRequestsFor(session.userId),
        alerts: canManageBankLink(session) ? manualBalances.getAlerts() : [],
        postponeMinutes: POSTPONE_MINUTES
      });
    } catch (err: any) {
      sendManualBalanceError(res, err, 'تعذر تحميل طلبات الرصيد');
    }
  });

  // المسؤول يكتب الرصيد الحالي: الفرق (إن وُجد) يُسجَّل فورًا على الخزنة ويُعلَّم للمراجعة
  app.post('/api/bank-link/balance-requests/:accountId/submit', requireAuth as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const entry = manualBalances.submitBalance(String(req.params.accountId), {
        balance: req.body?.balance,
        userId: session.userId,
        userName: session.name || session.username || '',
        canManage: canManageBankLink(session)
      });
      recordAuditLog(
        auditActor(session),
        entry.difference !== 0 && entry.kind !== 'baseline' ? 'MANUAL_BALANCE_DIFFERENCE' : 'MANUAL_BALANCE_ENTERED',
        'cashbox',
        entry.cashboxId,
        entry.difference === 0
          ? `إدخال رصيد «${entry.accountName}»: ${entry.enteredBalance} — مطابق لرصيد النظام`
          : `إدخال رصيد «${entry.accountName}»: ${entry.enteredBalance} — رصيد النظام كان ${entry.bookBalanceBefore} — الفرق ${entry.difference}${entry.kind === 'baseline' ? ' (مطابقة رصيد عند بدء المتابعة)' : ' (للمراجعة)'}`
      );
      res.json({ success: true, entry, requests: manualBalances.getRequestsFor(session.userId) });
    } catch (err: any) {
      sendManualBalanceError(res, err, 'تعذر تسجيل الرصيد');
    }
  });

  // تأجيل لمرة واحدة لمدة ساعة
  app.post('/api/bank-link/balance-requests/:accountId/postpone', requireAuth as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const request = manualBalances.postpone(String(req.params.accountId), session.userId);
      recordAuditLog(auditActor(session), 'MANUAL_BALANCE_POSTPONED', 'cashbox', request.accountId, `تأجيل إدخال رصيد «${request.accountName}» لمدة ${POSTPONE_MINUTES} دقيقة`);
      res.json({ success: true, request, requests: manualBalances.getRequestsFor(session.userId) });
    } catch (err: any) {
      sendManualBalanceError(res, err, 'تعذر تأجيل طلب الرصيد');
    }
  });

  // ---- الإعدادات: لمن معه صلاحية ربط الخزن ----
  app.get('/api/bank-link/manual/overview', requirePermission('settings.bank_link') as any, (_req: AuthenticatedRequest, res: Response) => {
    try {
      const users = (usersCollection.get() || []).map((u: any) => ({ id: String(u.id), name: String(u.name || u.username || ''), username: String(u.username || ''), role: String(u.role || '') }));
      res.json({ success: true, ...manualBalances.getOverview(), users, postponeMinutes: POSTPONE_MINUTES });
    } catch (err: any) {
      sendManualBalanceError(res, err, 'تعذر تحميل الخزن المتابَعة برصيد يدوي');
    }
  });

  app.post('/api/bank-link/manual/accounts', requirePermission('settings.bank_link') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const account = manualBalances.saveAccount(req.body || {});
      recordAuditLog(auditActor(req.userSession!), 'MANUAL_BALANCE_ACCOUNT_SAVED', 'cashbox', account.cashboxId, `حفظ متابعة الخزنة برصيد يدوي: ${account.name} — الموعد ${account.time}${account.mandatory ? ' — إجباري' : ''}`);
      res.json({ success: true, account });
    } catch (err: any) {
      sendManualBalanceError(res, err, 'تعذر حفظ الحساب');
    }
  });

  // زر التفعيل / الإيقاف
  app.post('/api/bank-link/manual/accounts/:id/enabled', requirePermission('settings.bank_link') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const account = manualBalances.setAccountEnabled(String(req.params.id), Boolean(req.body?.enabled));
      recordAuditLog(auditActor(req.userSession!), account.enabled ? 'MANUAL_BALANCE_ENABLED' : 'MANUAL_BALANCE_DISABLED', 'cashbox', account.cashboxId, `${account.enabled ? 'تفعيل' : 'إيقاف'} متابعة الخزنة برصيد يدوي: ${account.name}`);
      res.json({ success: true, account });
    } catch (err: any) {
      sendManualBalanceError(res, err, 'تعذر تغيير حالة الحساب');
    }
  });

  app.delete('/api/bank-link/manual/accounts/:id', requirePermission('settings.bank_link') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      manualBalances.deleteAccount(String(req.params.id));
      recordAuditLog(auditActor(req.userSession!), 'MANUAL_BALANCE_ACCOUNT_DELETED', 'cashbox', String(req.params.id), 'حذف متابعة خزنة برصيد يدوي');
      res.json({ success: true });
    } catch (err: any) {
      sendManualBalanceError(res, err, 'تعذر حذف الحساب');
    }
  });

  // المالك يعلّم الفرق «تمت المراجعة»
  app.post('/api/bank-link/manual/entries/:id/reviewed', requirePermission('settings.bank_link') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const entry = manualBalances.markReviewed(String(req.params.id), session.name || session.username || '');
      recordAuditLog(auditActor(session), 'MANUAL_BALANCE_REVIEWED', 'cashbox', entry.cashboxId, `مراجعة فرق رصيد «${entry.accountName}»: ${entry.difference}`);
      res.json({ success: true, entry, alerts: manualBalances.getAlerts() });
    } catch (err: any) {
      sendManualBalanceError(res, err, 'تعذر تسجيل المراجعة');
    }
  });

  // 0. فحص صحة النظام ووضع البيانات
  app.get('/api/health', (_req: Request, res: Response) => {
    const conf = getSystemConfig();
    const isDegraded =
      (persistence && !persistence.isReady()) ||
      !(conf.dataMode === 'memory' || conf.connectionHealth.healthy);
    res.json({
      success: true,
      status: isDegraded ? 'degraded' : 'ok',
      dataMode: conf.dataMode,
      isGoogleSheetsConnected: conf.isGoogleSheetsConnected,
      connectionHealth: conf.connectionHealth,
      persistence: persistence ? persistence.getStatus() : { enabled: false },
      timestamp: new Date().toISOString()
    });
  });

  // 0b. نقطة API عامة لقراءة أرقام التواصل الأربعة فقط بدون تسجيل دخول ولا ترجع أي إعداد آخر
  app.get('/api/public/contact-settings', async (_req: Request, res: Response) => {
    try {
      const contact = await getPublicContactSettings();
      res.json({
        supportWhatsapp: String(contact.supportWhatsapp || ''),
        supportPhone: String(contact.supportPhone || ''),
        salesWhatsapp: String(contact.salesWhatsapp || ''),
        salesPhone: String(contact.salesPhone || '')
      });
    } catch {
      res.json({
        supportWhatsapp: '',
        supportPhone: '',
        salesWhatsapp: '',
        salesPhone: ''
      });
    }
  });

  // 1. الإعدادات وحالة التهيئة
  app.get('/api/config', async (_req: Request, res: Response) => {
    const conf = getSystemConfig();
    let hasOwner = true;
    let hasManager = true;
    let setupCheckError = false;
    let setupCheckErrorMessage: string | undefined;
    try {
      hasOwner = await checkHasOwner();
      hasManager = await checkHasManager();
    } catch (err: any) {
      // في وضع sheets عند تعذر الاتصال، نمنع ظهور شاشة إنشاء المالك ونُظهر تنبيه توقف الاتصال
      console.error('[Config Setup Check Error]:', err?.stack || err?.message || err);
      hasOwner = true;
      hasManager = true;
      setupCheckError = true;
      setupCheckErrorMessage = sanitizeErrorMessageForClient(err?.message, 'تعذر التحقق من حالة الإعداد في Google Sheets');
    }
    const latestConf = getSystemConfig();
    const stockSettings = getStockSettings();
    const companySettings = getCompanySettings();
    const invoicePrintSettings = getInvoicePrintSettings();
    const displaySettings = getDisplaySettings();
    const salesRules = describeSalesRules(salesRulesContext());
    res.json({
      ...latestConf,
      inactivityTimeoutMinutes: normalizeInactivityTimeoutMinutes(companySettings.inactivityTimeoutMinutes),
      dataEpoch: getResetMeta().lastResetAt,
      persistenceMode: persistence ? 'supabase' : 'none',
      hasOwner,
      hasManager,
      ...(setupCheckError ? { setupCheckError: true, setupCheckErrorMessage } : {}),
      stockSettings,
      companySettings,
      invoicePrintSettings,
      displaySettings,
      salesRules
    });
  });

  app.post('/api/config', requirePermission('settings.system_integration') as any, (req: Request, res: Response) => {
    const { appsScriptUrl } = req.body;
    if (typeof appsScriptUrl !== 'string') {
      res.status(400).json({ success: false, error: 'الرابط غير صالح' });
      return;
    }
    const updated = setAppsScriptUrl(appsScriptUrl);
    res.json({ success: true, config: updated });
  });

  // فحص الاتصال بـ Google Sheets
  app.post('/api/sheets/test-connection', requirePermission('settings.system_integration') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { appsScriptUrl } = req.body;
      const result = await testConnection(appsScriptUrl);
      const conf = getSystemConfig();
      res.json({
        ...result,
        dataMode: conf.dataMode,
        connectionHealth: conf.connectionHealth
      });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر فحص الاتصال');
    }
  });

  // دالة تهيئة الشيتات والأعمدة setupSheets
  app.post('/api/sheets/setup', requirePermission('settings.system_integration') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { appsScriptUrl } = req.body;
      const result = await setupSheets(req.authToken, appsScriptUrl);
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err, 'فشلت تهيئة الأوراق');
    }
  });

  // 2. قائمة الصلاحيات والقوالب
  app.get('/api/permissions', (_req: Request, res: Response) => {
    res.json({
      success: true,
      permissions: ALL_PERMISSIONS,
      templates: ROLE_TEMPLATES
    });
  });

  // 3. المصادقة والجلسات
  app.get('/api/auth/setup-status', async (_req: Request, res: Response) => {
    try {
      const hasOwner = await checkHasOwner();
      const hasManager = await checkHasManager();
      res.json({ success: true, hasOwner, hasManager });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر التحقق من حالة الإعداد في Google Sheets');
    }
  });

  // تهيئة المالك الأول محليًا (متاحة فقط إذا لم يكن هناك أي مالك مسجل بالنظام)
  app.post('/api/auth/setup-designer-local', async (req: Request, res: Response) => {
    try {
      const hasOwner = await checkHasOwner();
      if (hasOwner) {
        res.status(400).json({
          success: false,
          error: 'يوجد مالك مسجل بالفعل للنظام. يرجى تسجيل الدخول.'
        });
        return;
      }

      const { username, name, password, phone } = req.body;
      if (!username || !password) {
        res.status(400).json({ success: false, error: 'اسم المستخدم وكلمة المرور مطلوبان' });
        return;
      }

      const result = await setupFirstDesignerLocal(username, name, password, phone);

      if (result.success) {
        const loginRes = await loginUser(username, password);
        if (loginRes.success && loginRes.user) {
          const session = createSession(loginRes.user, loginRes.token, req);
          res.json({
            success: true,
            message: 'تم إنشاء أول حساب مصمم للنظام بنجاح',
            token: session.token,
            sessionId: session.sessionId,
            expiresAt: session.expiresAt,
            user: loginRes.user
          });
          return;
        }
      }

      sendWriteResult(res, result, 400);
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر إنشاء حساب المصمم');
    }
  });

  // تسجيل الدخول باسم المستخدم وكلمة المرور
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { username, phone, password } = req.body;
      const userIdentifier = username || phone;
      if (!userIdentifier || !password) {
        res.status(400).json({ success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
        return;
      }

      const result = await loginUser(userIdentifier, password);
      if (result.success && result.user) {
        const session = createSession(result.user, result.token, req);
        res.json({
          success: true,
          token: session.token,
          sessionId: session.sessionId,
          expiresAt: session.expiresAt,
          user: {
            ...result.user,
            permissions: session.permissions
          }
        });
        return;
      }

      sendWriteResult(res, result, 401);
    } catch (err: any) {
      handleCatchError(res, err, 'فشل تسجيل الدخول');
    }
  });

  // تسجيل الخروج (يلغي الجلسة في الخادم وفي Google Apps Script فعليًا)
  app.post('/api/auth/logout', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const token = req.authToken;
      if (token) {
        activeSessions.delete(token);
        revokedSessions.delete(token);
      }
      await logoutUserSession(token);
      res.json({ success: true, message: 'تم إنهاء الجلسة بنجاح' });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر إنهاء الجلسة');
    }
  });

  // تحديث وقت آخر نشاط فعلي للمستخدم (لا يُستدعى من طلبات الفحص الخلفية)
  app.post('/api/auth/activity', requireAuth as any, (req: AuthenticatedRequest, res: Response) => {
    const session = req.userSession!;
    const now = Date.now();
    session.lastActivityAt = now;
    const { deviceName, deviceId } = describeDeviceFromRequest(req);
    if (deviceName) session.deviceName = deviceName;
    if (deviceId) session.deviceId = deviceId;
    const inactivityTimeoutMinutes = normalizeInactivityTimeoutMinutes(getCompanySettings().inactivityTimeoutMinutes);
    res.json({
      success: true,
      lastActivityAt: new Date(now).toISOString(),
      inactivityTimeoutMinutes
    });
  });

  // فحص صحة الجلسة الحالية
  app.get('/api/auth/me', requireAuth as any, (req: AuthenticatedRequest, res: Response) => {
    const session = req.userSession!;
    const inactivityTimeoutMinutes = normalizeInactivityTimeoutMinutes(getCompanySettings().inactivityTimeoutMinutes);
    res.json({
      success: true,
      user: {
        id: session.userId,
        username: session.username,
        phone: session.phone,
        name: session.name,
        role: session.role,
        permissions: session.permissions,
        isOwner: session.isOwner,
        mustChangePassword: Boolean(session.mustChangePassword)
      },
      sessionId: session.sessionId,
      lastActivityAt: new Date(session.lastActivityAt || session.createdAt).toISOString(),
      inactivityTimeoutMinutes,
      expiresAt: session.expiresAt
    });
  });

  // استكمال إعداد الحساب وتغيير كلمة السر المؤقتة عند أول دخول
  app.post('/api/auth/complete-initial-setup', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const { name, username, newPassword } = req.body || {};
      const result = await completeInitialAccountSetup(
        session.userId,
        {
          name: String(name || ''),
          username: String(username || ''),
          newPassword: typeof newPassword === 'string' ? newPassword : String(newPassword ?? '')
        },
        {
          token: req.authToken,
          role: session.role,
          phone: session.phone,
          username: session.username,
          name: session.name
        }
      );

      if (result.success && result.user) {
        session.name = result.user.name;
        session.username = result.user.username;
        session.mustChangePassword = false;
        res.json({
          success: true,
          user: {
            ...result.user,
            mustChangePassword: false,
            permissions: session.permissions
          }
        });
        return;
      }

      sendWriteResult(res, result, 400);
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر حفظ إعداد الحساب');
    }
  });

  // تغيير كلمة السر الشخصية للمستخدم الحالي
  app.post('/api/auth/change-password', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const { currentPassword, newPassword } = req.body || {};
      const result = await changeOwnPassword(
        session.userId,
        typeof currentPassword === 'string' ? currentPassword : String(currentPassword ?? ''),
        typeof newPassword === 'string' ? newPassword : String(newPassword ?? ''),
        {
          token: req.authToken,
          role: session.role,
          phone: session.phone,
          username: session.username,
          name: session.name
        }
      );
      if (result.success) {
        session.mustChangePassword = false;
      }
      sendWriteResult(res, result, 400);
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر تغيير كلمة السر');
    }
  });

  // 4. المزامنة العامة
  app.get(['/api/sync', '/api/sync-all'], requirePermission('dashboard.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession;
      const result = await syncAllData(session ? {
        token: req.authToken,
        userId: session.userId,
        id: session.userId,
        phone: session.phone,
        role: session.role,
        isOwner: session.isOwner,
        permissions: session.permissions
      } : undefined);
      if (!result?.success) {
        sendWriteResult(res, result, 503);
        return;
      }
      res.json(result);
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر المزامنة مع Google Sheets');
    }
  });

  // 4b. المخازن المتعددة Warehouses
  app.get('/api/warehouses', requirePermission('warehouses.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const warehouses = await getWarehouses({
        token: req.authToken,
        role: session.role,
        isOwner: session.isOwner,
        userId: session.userId,
        id: session.userId,
        phone: session.phone,
        username: session.username
      });
      res.json({
        success: true,
        warehouses,
        migration: getWarehouseMigrationStatus()
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/warehouses', requireFullMode as any, requirePermission('warehouses.manage') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await saveWarehouse(req.body || {}, {
        token: req.authToken,
        role: session.role,
        isOwner: session.isOwner,
        userId: session.userId,
        id: session.userId,
        phone: session.phone,
        name: session.name
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  const handleUpdateWarehouse = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await saveWarehouse({ ...(req.body || {}), id: req.params.id }, {
        token: req.authToken,
        role: session.role,
        isOwner: session.isOwner,
        userId: session.userId,
        id: session.userId,
        phone: session.phone,
        name: session.name
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  };
  app.put('/api/warehouses/:id', requireFullMode as any, requirePermission('warehouses.manage') as any, handleUpdateWarehouse as any);
  app.patch('/api/warehouses/:id', requireFullMode as any, requirePermission('warehouses.manage') as any, handleUpdateWarehouse as any);

  app.delete('/api/warehouses/:id', requireFullMode as any, requirePermission('warehouses.manage') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await deleteWarehouse(req.params.id, {
        token: req.authToken,
        role: session.role,
        isOwner: session.isOwner,
        userId: session.userId,
        id: session.userId,
        phone: session.phone,
        name: session.name
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 4c. التحويل بين المخازن وأوامر الصرف Warehouse Transfers & Dispatch Orders
  app.get('/api/warehouse-transfers/context', requireFullMode as any, requireAnyPermission(['warehouses.transfer', 'warehouses.view']) as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await getWarehouseTransferContext({
        token: req.authToken,
        role: session.role,
        isOwner: session.isOwner,
        userId: session.userId,
        id: session.userId,
        phone: session.phone,
        username: session.username,
        name: session.name,
        permissions: session.permissions
      });
      sendWriteResult(res, result, result.statusCode || 403);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/warehouse-transfers/stocks', requireFullMode as any, requireAnyPermission(['warehouses.transfer', 'warehouses.view']) as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const fromWarehouseId = String(req.query.fromWarehouseId || '').trim();
      const toWarehouseId = req.query.toWarehouseId ? String(req.query.toWarehouseId).trim() : undefined;
      const itemIdsRaw = req.query.itemIds ? String(req.query.itemIds).trim() : '';
      const itemIds = itemIdsRaw ? itemIdsRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined;
      const result = await getWarehouseTransferStocks(
        { fromWarehouseId, toWarehouseId, itemIds },
        {
          token: req.authToken,
          role: session.role,
          isOwner: session.isOwner,
          userId: session.userId,
          id: session.userId,
          phone: session.phone,
          username: session.username,
          name: session.name,
          permissions: session.permissions
        }
      );
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/warehouse-transfers', requireFullMode as any, requireAnyPermission(['warehouses.transfer', 'warehouses.view']) as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const q = req.query as Record<string, any>;
      const result = await getWarehouseTransfers(
        {
          dispatchNumber: q.dispatchNumber !== undefined ? String(q.dispatchNumber) : undefined,
          q: q.q !== undefined ? String(q.q) : undefined,
          fromWarehouseId: q.fromWarehouseId !== undefined ? String(q.fromWarehouseId) : undefined,
          toWarehouseId: q.toWarehouseId !== undefined ? String(q.toWarehouseId) : undefined,
          from: (q.from || q.startDate) !== undefined ? String(q.from || q.startDate) : undefined,
          to: (q.to || q.endDate) !== undefined ? String(q.to || q.endDate) : undefined,
          page: q.page !== undefined ? Number(q.page) : 1,
          pageSize: q.pageSize !== undefined ? Number(q.pageSize) : 20
        },
        {
          token: req.authToken,
          role: session.role,
          isOwner: session.isOwner,
          userId: session.userId,
          id: session.userId,
          phone: session.phone,
          username: session.username,
          name: session.name,
          permissions: session.permissions
        }
      );
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/warehouse-transfers/:id', requireFullMode as any, requireAnyPermission(['warehouses.transfer', 'warehouses.view']) as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await getWarehouseTransferById(req.params.id, {
        token: req.authToken,
        role: session.role,
        isOwner: session.isOwner,
        userId: session.userId,
        id: session.userId,
        phone: session.phone,
        username: session.username,
        name: session.name,
        permissions: session.permissions
      });
      sendWriteResult(res, result, result.statusCode || 404);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/warehouse-transfers', requireFullMode as any, requirePermission('warehouses.transfer') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await createWarehouseTransfer(req.body || {}, {
        token: req.authToken,
        role: session.role,
        isOwner: session.isOwner,
        userId: session.userId,
        id: session.userId,
        phone: session.phone,
        username: session.username,
        name: session.name,
        permissions: session.permissions
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 5. الأصناف Items
  app.get('/api/items', requirePermission('items.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const items = await getItems({
        token: req.authToken,
        role: session.role,
        permissions: session.permissions
      });
      const staleMeta = getStaleMeta(items);
      res.json({
        success: true,
        items,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // جلب الأصناف بترقيم الصفحات (pageSize ثابت 30) مع البحث والفلترة وإجماليات كل النتائج المفلترة
  app.get('/api/items/paginated', requirePermission('items.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const q = req.query as Record<string, any>;
      const result = await getItemsPaginated(
        {
          page: q.page !== undefined ? Number(q.page) : 1,
          // pageSize ثابت دائماً على 30 في الخادم ولا يقبل تغييره من العميل
          search: q.search !== undefined ? String(q.search) : undefined,
          barcodeOnly: q.barcodeOnly !== undefined ? String(q.barcodeOnly) : undefined,
          categoryId: q.categoryId !== undefined ? String(q.categoryId) : undefined,
          supplier: q.supplier !== undefined ? String(q.supplier) : undefined,
          stockStatus: (q.stockStatus ?? q.stockFilter) !== undefined ? String(q.stockStatus ?? q.stockFilter) : undefined,
          status: (q.status ?? q.statusFilter) !== undefined ? String(q.status ?? q.statusFilter) : undefined,
          platformId: q.platformId !== undefined ? String(q.platformId) : undefined,
          warehouseId: q.warehouseId !== undefined ? String(q.warehouseId) : undefined,
          sortBy: q.sortBy !== undefined ? String(q.sortBy) : undefined,
          sortDir: q.sortDir !== undefined ? String(q.sortDir) : undefined
        },
        {
          token: req.authToken,
          role: session.role,
          isOwner: session.isOwner,
          userId: session.userId,
          id: session.userId,
          phone: session.phone,
          username: session.username,
          permissions: session.permissions
        }
      );
      if (!result.success) {
        sendWriteResult(res, result, (result as any).statusCode || 503);
        return;
      }
      res.json(result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // تصدير جميع أصناف المخزن إلى ملف Excel (.xlsx) من الخادم (محمية بصلاحية products.export)
  app.get('/api/items/export-excel', requireFullMode as any, requirePermission('products.export') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await exportAllItemsExcelBuffer({
        token: req.authToken,
        id: session.userId,
        userId: session.userId,
        name: session.name,
        phone: session.phone,
        role: session.role,
        isOwner: session.isOwner,
        permissions: session.permissions
      });
      if (!result.success || !result.buffer || !result.fileName) {
        sendWriteResult(res, {
          success: false,
          ...(result as any).code ? { code: (result as any).code } : {},
          error: result.error || 'فشل تجهيز ملف الإكسيل'
        }, result.statusCode || 500);
        return;
      }

      const asciiFallbackName = `inventory-items-${result.cairoDate || new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallbackName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
      );
      res.setHeader('X-Export-Filename', encodeURIComponent(result.fileName));
      res.setHeader('X-Total-Items', String(result.totalItems || 0));
      res.send(result.buffer);
    } catch (err: any) {
      handleCatchError(res, err, 'حدث خطأ أثناء تصدير ملف الإكسيل');
    }
  });

  // تنزيل نموذج الإكسيل للتعديل الجماعي للأسعار (محمية بصلاحية products.bulk_edit_excel)
  app.get('/api/items/bulk-edit-excel/template', requireFullMode as any, requirePermission('products.bulk_edit_excel') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const operationType = typeof req.query.operationType === 'string' ? req.query.operationType : undefined;
      const result = await generateBulkPriceEditTemplateBuffer(operationType, {
        token: req.authToken,
        id: session.userId,
        userId: session.userId,
        name: session.name,
        phone: session.phone,
        role: session.role,
        isOwner: session.isOwner,
        permissions: session.permissions
      });
      if (!result.success || !result.buffer || !result.fileName) {
        sendWriteResult(res, {
          success: false,
          ...(result as any).code ? { code: (result as any).code } : {},
          error: result.error || 'فشل تجهيز نموذج الإكسيل'
        }, result.statusCode || 400);
        return;
      }

      const asciiFallbackName =
        operationType === 'add_items'
          ? 'bulk-add-items-template.xlsx'
          : operationType === 'add_categories'
          ? 'bulk-add-categories-template.xlsx'
          : operationType === 'delete_categories'
          ? 'bulk-delete-categories-template.xlsx'
          : operationType === 'delete_items'
          ? 'bulk-delete-items-template.xlsx'
          : operationType === 'purchase_price'
          ? 'bulk-edit-purchase-price-template.xlsx'
          : operationType === 'print_name'
          ? 'bulk-edit-print-name-template.xlsx'
          : 'bulk-edit-sale-price-template.xlsx';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallbackName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
      );
      res.setHeader('X-Export-Filename', encodeURIComponent(result.fileName));
      res.send(result.buffer);
    } catch (err: any) {
      handleCatchError(res, err, 'حدث خطأ أثناء تجهيز نموذج الإكسيل');
    }
  });

  // معاينة ملف التعديل الجماعي للأسعار قبل الحفظ (محمية بصلاحية products.bulk_edit_excel)
  app.post('/api/items/bulk-edit-excel/preview', requireFullMode as any, requirePermission('products.bulk_edit_excel') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await previewBulkPriceEditExcel(req.body || {}, {
        token: req.authToken,
        id: session.userId,
        userId: session.userId,
        name: session.name,
        phone: session.phone,
        role: session.role,
        isOwner: session.isOwner,
        permissions: session.permissions
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err, 'حدث خطأ أثناء معاينة الملف');
    }
  });

  // تنفيذ التعديل الجماعي للأسعار بالإكسيل (محمية بصلاحية products.bulk_edit_excel)
  app.post('/api/items/bulk-edit-excel/execute', requireFullMode as any, requirePermission('products.bulk_edit_excel') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await executeBulkPriceEditExcel(req.body || {}, {
        token: req.authToken,
        id: session.userId,
        userId: session.userId,
        name: session.name,
        phone: session.phone,
        role: session.role,
        isOwner: session.isOwner,
        permissions: session.permissions
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err, 'حدث خطأ أثناء تنفيذ التعديل');
    }
  });

  // استعلام عن حالة آخر عملية تعديل بالإكسيل قابلة للتراجع
  app.get('/api/items/bulk-edit-excel/undo-status', requireFullMode as any, requirePermission('products.bulk_edit_excel') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await getBulkEditUndoStatus({
        token: req.authToken,
        id: session.userId,
        userId: session.userId,
        name: session.name,
        phone: session.phone,
        role: session.role,
        isOwner: session.isOwner,
        permissions: session.permissions
      });
      res.status(result.statusCode || 200).json(result);
    } catch (err: any) {
      handleCatchError(res, err, 'حدث خطأ أثناء التحقق من حالة التراجع');
    }
  });

  // التراجع عن آخر عملية تعديل بالإكسيل
  app.post('/api/items/bulk-edit-excel/undo', requireFullMode as any, requirePermission('products.bulk_edit_excel') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await undoLastBulkEditExcel({
        token: req.authToken,
        id: session.userId,
        userId: session.userId,
        name: session.name,
        phone: session.phone,
        role: session.role,
        isOwner: session.isOwner,
        permissions: session.permissions
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err, 'حدث خطأ أثناء التراجع عن العملية');
    }
  });

  // تصدير ملف إكسيل بالصفوف المرفوضة وسبب رفض كل صف
  app.post('/api/items/bulk-edit-excel/errors-file', requireFullMode as any, requirePermission('products.bulk_edit_excel') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await generateBulkEditErrorsExcelBuffer(req.body || {}, {
        token: req.authToken,
        id: session.userId,
        userId: session.userId,
        name: session.name,
        phone: session.phone,
        role: session.role,
        isOwner: session.isOwner,
        permissions: session.permissions
      });
      if (!result.success || !result.buffer || !result.fileName) {
        sendWriteResult(res, {
          success: false,
          error: result.error || 'فشل تجهيز ملف الأخطاء'
        }, result.statusCode || 400);
        return;
      }

      const asciiFallbackName = 'bulk-edit-errors.xlsx';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallbackName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
      );
      res.setHeader('X-Export-Filename', encodeURIComponent(result.fileName));
      res.send(result.buffer);
    } catch (err: any) {
      handleCatchError(res, err, 'حدث خطأ أثناء تجهيز ملف الأخطاء');
    }
  });

  // نقطة API خفيفة للتحقق من عدم تكرار اسم الصنف أو الباركود أو الكود قبل الحفظ
  const handleCheckItemUnique = (req: AuthenticatedRequest, res: Response) => {
    try {
      const source = req.method === 'GET' ? req.query : req.body || {};
      const rawSec = source.secondaryBarcodes;
      const secondaryBarcodes: string[] | undefined = Array.isArray(rawSec)
        ? rawSec.map((b: any) => String(b))
        : (typeof rawSec === 'string' && rawSec.trim()
            ? rawSec.split(/[,،]+/).map((b: string) => b.trim()).filter(Boolean)
            : undefined);

      const result = checkItemUniqueness({
        excludeId: source.excludeId || source.itemId || source.id,
        name: source.name !== undefined ? String(source.name) : undefined,
        barcode: source.barcode !== undefined ? String(source.barcode) : undefined,
        secondaryBarcodes,
        barcodes: Array.isArray(source.barcodes) ? source.barcodes : undefined,
        sku: source.sku !== undefined ? String(source.sku) : undefined,
        code: source.code !== undefined ? String(source.code) : undefined
      });
      res.json(result);
    } catch (err: any) {
      console.error('[Check Item Unique Error]:', err?.stack || err?.message || err);
      res.status(500).json({
        success: false,
        isDuplicate: false,
        conflicts: [],
        error: sanitizeErrorMessageForClient(err?.message, 'تعذر فحص تكرار الصنف')
      });
    }
  };

  app.get(['/api/items/check-unique', '/api/items/check-duplicate', '/api/items/validate-unique'], requireAuth as any, handleCheckItemUnique as any);
  app.post(['/api/items/check-unique', '/api/items/check-duplicate', '/api/items/validate-unique'], requireAuth as any, handleCheckItemUnique as any);

  // معاينة وحذف الأصناف المكررة — محصورة للمطور/مصمم النظام (designer) فقط
  app.get('/api/items/duplicates/preview', requireFullMode as any, requireDesigner as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await previewDuplicateItems({
        token: req.authToken,
        role: session.role,
        isOwner: session.isOwner,
        name: session.name,
        phone: session.phone
      });
      if (!result.success) {
        sendWriteResult(res, result, result.error?.includes('غير مصرح') ? 403 : 400);
        return;
      }
      res.json(result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/items/duplicates/cleanup', requireFullMode as any, requireDesigner as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await cleanupDuplicateItems({
        token: req.authToken,
        id: session.userId,
        userId: session.userId,
        role: session.role,
        isOwner: session.isOwner,
        name: session.name,
        phone: session.phone
      });
      if (!result.success) {
        sendWriteResult(res, result, result.error?.includes('غير مصرح') ? 403 : 400);
        return;
      }
      res.json(result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/items', requireFullMode as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isEdit = Boolean(req.body.id);
      const permRequired = isEdit ? 'items.edit' : 'items.create';
      if (!req.userSession || (!req.userSession.permissions.includes(permRequired) && req.userSession.role !== 'designer')) {
        res.status(403).json({ success: false, error: `غير مصرح: تفتقر لصلاحية [${permRequired}]` });
        return;
      }

      const result = await saveItem(req.body, {
        token: req.authToken,
        role: req.userSession.role,
        permissions: req.userSession.permissions,
        phone: req.userSession.phone
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.put('/api/items/:id', requireFullMode as any, requirePermission('items.edit') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await saveItem({ ...req.body, id: req.params.id }, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        phone: req.userSession!.phone
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // التعديل المباشر لحقول محددة من الصنف من داخل جدول الأصناف
  const handleInlineUpdateItem = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await inlineUpdateItem(req.params.id, req.body || {}, {
        token: req.authToken,
        userId: session.userId,
        name: session.name,
        phone: session.phone,
        role: session.role,
        isOwner: session.isOwner,
        permissions: session.permissions
      });
      sendWriteResult(res, result, result.statusCode);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  };
  app.patch('/api/items/:id/inline', requireFullMode as any, requirePermission('products.inline_edit') as any, handleInlineUpdateItem as any);
  app.post('/api/items/:id/inline', requireFullMode as any, requirePermission('products.inline_edit') as any, handleInlineUpdateItem as any);

  app.delete('/api/items/:id', requireFullMode as any, requirePermission('items.delete') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await deleteItem(req.params.id, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // عرض أرصدة صنف محدد عبر كافة المخازن المسموحة للمستخدم
  app.get('/api/items/:id/warehouses', requirePermission('items.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await getItemWarehouses(req.params.id, {
        token: req.authToken,
        role: session.role,
        isOwner: session.isOwner,
        userId: session.userId,
        id: session.userId,
        phone: session.phone,
        username: session.username
      });
      sendWriteResult(res, result, result.statusCode || 404);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // تعديل كمية صنف مباشرة مع سبب إجباري
  app.post('/api/items/:id/adjust-stock', requireFullMode as any, requirePermission('stock.adjust') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await adjustItemStock(req.params.id, req.body, {
        token: req.authToken,
        role: session.role,
        permissions: session.permissions,
        name: session.name,
        phone: session.phone,
        userId: session.userId
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // إدارة التصنيفات Categories
  app.get('/api/categories', requirePermission('categories.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const categories = await getCategories({
        token: req.authToken,
        role: session.role,
        permissions: session.permissions
      });
      const staleMeta = getStaleMeta(categories);
      res.json({
        success: true,
        categories,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/categories', requireFullMode as any, requirePermission('categories.manage') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await saveCategory(req.body, {
        token: req.authToken,
        role: session.role,
        permissions: session.permissions,
        name: session.name,
        phone: session.phone,
        userId: session.userId
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.delete('/api/categories/:id', requireFullMode as any, requirePermission('categories.manage') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await deleteCategory(req.params.id, {
        token: req.authToken,
        role: session.role,
        permissions: session.permissions,
        name: session.name,
        phone: session.phone
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // ترحيل آمن وتكراري لربط الأصناف القديمة بمعرفات التصنيفات المطابقة
  app.post('/api/categories/migrate', requireFullMode as any, requirePermission('categories.manage') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await migrateItemCategories({
        token: req.authToken,
        role: session.role,
        permissions: session.permissions,
        name: session.name,
        phone: session.phone
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // أرشفة صنف
  app.post('/api/items/archive/:id', requireFullMode as any, requirePermission('items.edit') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await archiveItem(req.params.id, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        name: req.userSession!.name,
        phone: req.userSession!.phone
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // جلب سجل الحركات والتعديلات لصنف
  app.get('/api/items/:id/logs', requireFullMode as any, requirePermission('items.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await getItemLogs(req.params.id, { token: req.authToken });
      sendWriteResult(res, result, 503);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // استيراد دفعة أصناف بالجملة من Excel أو CSV
  app.post('/api/items/import-batch', requireFullMode as any, requirePermission('items.import_export') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await importItemsBatch(req.body, {
        token: req.authToken,
        userId: req.userSession!.userId,
        role: req.userSession!.role,
        isOwner: req.userSession!.isOwner,
        permissions: req.userSession!.permissions,
        name: req.userSession!.name,
        phone: req.userSession!.phone
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 6. المنصات Platforms
  app.get('/api/platforms', requirePermission('platforms.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const platforms = await getPlatforms({ token: req.authToken });
      const staleMeta = getStaleMeta(platforms);
      res.json({
        success: true,
        platforms,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/platforms', requirePlatformsEnabled as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isEdit = Boolean(req.body.id);
      const permRequired = isEdit ? 'platforms.edit' : 'platforms.create';
      if (!req.userSession || (!req.userSession.permissions.includes(permRequired) && req.userSession.role !== 'designer')) {
        res.status(403).json({ success: false, error: `غير مصرح: تفتقر لصلاحية [${permRequired}]` });
        return;
      }

      const result = await savePlatform(req.body, {
        token: req.authToken,
        role: req.userSession.role,
        permissions: req.userSession.permissions
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // تكاليف شحن المنصات
  app.get('/api/item-platform-costs', requirePermission('platforms.pricing') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const costs = await getItemPlatformCosts({ token: req.authToken });
      const staleMeta = getStaleMeta(costs);
      res.json({
        success: true,
        costs,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/item-platform-costs', requirePlatformsEnabled as any, requirePermission('platforms.pricing') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await saveItemPlatformCost(req.body, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 7. الفواتير Invoices
  app.get('/api/invoices', requirePermission('invoices.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const from = (req.query.from || req.query.startDate) as string | undefined;
      const to = (req.query.to || req.query.endDate) as string | undefined;
      const invoices = await getInvoices({
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions
      }, { from, to });
      const staleMeta = getStaleMeta(invoices);
      res.json({
        success: true,
        invoices,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/invoices', requirePermission('invoices.create') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const invoicePayload = {
        ...req.body,
        createdBy: req.userSession?.name || req.userSession?.phone || 'كاشير'
      };
      const result = await createInvoice(invoicePayload, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        phone: req.userSession!.phone,
        userId: req.userSession!.userId,
        name: req.userSession!.name
      });
      sendWriteResult(res, result, result.statusCode || 400);
      const soldInvoice: any = (result as any)?.invoice;
      if (result?.success && soldInvoice?.invoiceNumber && typeof req.body?.cartId === 'string') {
        cartJournal
          .markCartSold(
            req.body.cartId,
            soldInvoice.invoiceNumber,
            (soldInvoice.lines || []).map((line: any) => ({ itemId: line.itemId, quantity: Number(line.quantity) || 0 })),
            { userId: req.userSession!.userId, userName: req.userSession!.name || req.userSession!.username || '' }
          )
          .catch((err) => console.error('[cart-journal] تعذر تسجيل بيع الفاتورة في السجل:', err?.message || err));
      }
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // استقبال أحداث سجل شاشة البيع من الأجهزة (طلب خفيف خارج طابور الحفظ الرئيسي)
  app.post('/api/cart-journal/events', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await cartJournal.applyEvents(req.body?.deviceId, req.body?.events, {
        userId: session.userId,
        userName: session.name || session.username || ''
      });
      res.json({ success: true, ...result });
    } catch (err: any) {
      if (err instanceof CartJournalError) {
        res.status(err.code === 'INVALID_INPUT' ? 400 : 503).json({ success: false, code: err.code, error: err.message });
        return;
      }
      handleCatchError(res, err, 'تعذر تسجيل حركة شاشة البيع');
    }
  });

  // تقرير الأصناف التي دخلت فاتورة شاشة البيع ولم تُبع
  app.get('/api/reports/unsold-cart-items', requireFullMode as any, requirePermission('reports.unsold_cart_items.view') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const q = req.query || {};
      const report = cartJournal.getReport({
        from: typeof q.from === 'string' ? q.from : undefined,
        to: typeof q.to === 'string' ? q.to : undefined,
        userId: typeof q.userId === 'string' ? q.userId : undefined,
        status: typeof q.status === 'string' ? (q.status as any) : undefined,
        event: typeof q.event === 'string' ? (q.event as any) : undefined
      });
      res.json({ success: true, report });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر تحميل تقرير أصناف شاشة البيع غير المباعة');
    }
  });

  // رفع العمليات المحفوظة أوفلاين من صندوق الصادر (Outbox) عند رجوع الاتصال
  app.post('/api/offline/sync', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const body = req.body || {};
      const inner = body.payload && typeof body.payload === 'object' ? body.payload : body;
      const opType = String(
        body.type ||
        body.operationType ||
        inner.type ||
        inner.operationType ||
        (Array.isArray(inner.invoiceNumbers) ? 'collectCredit' : 'createInvoice')
      ).trim();

      const isAuthAuditOp =
        opType === 'authAudit' || opType === 'OFFLINE_LOGIN' || opType === 'OFFLINE_LOGOUT';

      if (!isAuthAuditOp) {
        const requiredPerm: PermissionKey =
          opType === 'collectCredit' || opType === 'collectCreditInvoices'
            ? 'invoices.collect_credit'
            : opType === 'updatePermissions' || opType === 'updateUserPermissions'
            ? 'permissions.manage'
            : 'invoices.create';

        if (
          session.role !== 'designer' &&
          !session.isOwner &&
          (!session.permissions || !session.permissions.includes(requiredPerm))
        ) {
          res.status(403).json({
            success: false,
            error: `غير مصرح: تفتقر لحق الوصول أو صلاحية [${requiredPerm}]`
          });
          return;
        }
      }

      // عملية أوفلاين أُنشئت على الجهاز قبل آخر إعادة ضبط للنظام: لا تُرفع حتى لا ترجع بيانات تم مسحها
      if (!isAuthAuditOp && isBeforeLastReset(body.deviceTime || inner.deviceTime || body.createdAt || inner.createdAt)) {
        res.status(409).json({
          success: false,
          code: 'BEFORE_RESET',
          error: 'هذه العملية سُجّلت على الجهاز قبل إعادة ضبط النظام، ولن تُرفع.'
        });
        return;
      }

      const payload = {
        ...body,
        createdBy: body?.createdBy || session?.name || session?.phone || 'كاشير'
      };
      const result = await syncOfflineOperation(payload, {
        token: req.authToken,
        role: session.role,
        permissions: session.permissions,
        phone: session.phone,
        userId: session.userId,
        name: session.name,
        userSuspended: Boolean((req as any).userSuspended)
      });
      sendWriteResult(res, result, result.statusCode || 400);
      const offlineSoldInvoice: any = (result as any)?.invoice;
      const offlineCartId = typeof inner?.cartId === 'string' ? inner.cartId : typeof body?.cartId === 'string' ? body.cartId : '';
      if (opType === 'createInvoice' && result?.success && offlineSoldInvoice?.invoiceNumber && offlineCartId) {
        cartJournal
          .markCartSold(
            offlineCartId,
            offlineSoldInvoice.invoiceNumber,
            (offlineSoldInvoice.lines || []).map((line: any) => ({ itemId: line.itemId, quantity: Number(line.quantity) || 0 })),
            { userId: session.userId, userName: session.name || session.username || '' }
          )
          .catch((err) => console.error('[cart-journal] تعذر تسجيل بيع فاتورة الأوفلاين في السجل:', err?.message || err));
      }
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // اعتماد مراجعة فاتورة أو عملية أوفلاين (محمية بصلاحية offline.manage)
  app.post(
    ['/api/offline/review', '/api/invoices/:id/review'],
    requirePermission('offline.manage') as any,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const session = req.userSession!;
        const invoiceNumber = String(req.params.id || req.body?.invoiceNumber || '').trim();
        const reviewNote = String(req.body?.reviewNote ?? req.body?.note ?? '').trim();
        const result = await markOfflineInvoiceReviewed(
          { invoiceNumber, reviewNote },
          {
            token: req.authToken,
            role: session.role,
            isOwner: session.isOwner,
            permissions: session.permissions,
            phone: session.phone,
            userId: session.userId,
            name: session.name
          }
        );
        sendWriteResult(res, result, result.statusCode || 400);
      } catch (err: any) {
        handleCatchError(res, err);
      }
    }
  );

  // تعديل فاتورة بعد الحفظ
  app.put('/api/invoices/:id', requirePermission('invoices.edit_after_save') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const invoiceNumber = req.params.id;
      const result = await updateInvoice(invoiceNumber, req.body, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        phone: req.userSession!.phone,
        userId: req.userSession!.userId,
        name: req.userSession!.name
      } as any);
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // جلب سجلات تعديل الفاتورة
  app.get('/api/invoices/:id/logs', requirePermission('invoices.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const logs = await getInvoiceEditLogs(req.params.id);
      const staleMeta = getStaleMeta(logs);
      res.json({
        success: true,
        logs,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // إلغاء فاتورة بيع معتمدة عبر قيد عكسي
  app.post('/api/invoices/:id/cancel', requirePermission('invoices.cancel') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await cancelInvoice(req.params.id, req.body.reason, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        phone: req.userSession!.phone,
        name: req.userSession!.name
      });
      sendWriteResult(res, result, 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 8. المرتجعات Returns
  app.get('/api/returns', requireFullMode as any, requirePermission('returns.view') as any, async (req: Request, res: Response) => {
    try {
      const from = (req.query.from || req.query.startDate) as string | undefined;
      const to = (req.query.to || req.query.endDate) as string | undefined;
      const returns = await getReturns({ token: (req as any).authToken }, { from, to });
      const staleMeta = getStaleMeta(returns);
      res.json({
        success: true,
        returns,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/returns', requireFullMode as any, requirePermission('returns.create') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const returnPayload = {
        ...req.body,
        createdBy: req.userSession?.name || req.userSession?.phone || 'المسؤول'
      };
      const result = await createReturn(returnPayload, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        phone: req.userSession!.phone,
        userId: req.userSession!.userId,
        name: req.userSession!.name
      } as any);
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 9. التقارير والأرباح (الأرباح والتكاليف محجوبة ما لم تُمنح الصلاحية صراحة)
  app.get('/api/reports', requireFullMode as any, requirePermission('reports.view_reports') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const canViewProfit = session.role === 'designer' || session.permissions.includes('reports.view_profit');
      const canViewCosts = session.role === 'designer' || session.permissions.includes('reports.view_costs');

      const from = (req.query.from || req.query.startDate) as string | undefined;
      const to = (req.query.to || req.query.endDate) as string | undefined;

      const [invoices, items, returns, platforms] = await Promise.all([
        getInvoices({ token: req.authToken, role: session.role, permissions: session.permissions }, { from, to }),
        getItems({ token: req.authToken, role: session.role, permissions: session.permissions }),
        getReturns({ token: req.authToken }, { from, to }),
        getPlatforms({ token: req.authToken })
      ]);

      const completedInvoices = invoices.filter(i => i.status === 'تم البيع' || (i.status as any) === 'completed');
      const totalRevenue = completedInvoices.reduce((sum, inv) => sum + (inv.netAmount || 0), 0);
      const totalCommissions = completedInvoices.reduce((sum, inv) => sum + (inv.discountAmount || 0), 0);

      let totalCost: number | undefined = undefined;
      let grossProfit: number | undefined = undefined;
      let netProfit: number | undefined = undefined;

      if (canViewCosts || canViewProfit) {
        let costSum = 0;
        let profitSum = 0;
        for (const inv of completedInvoices) {
          profitSum += (inv.profit || 0);
          for (const line of (inv.lines || [])) {
            costSum += ((line.purchasePriceAtSale || 0) + (line.packagingCostAtSale || 0)) * (line.quantity || 1);
          }
        }
        if (canViewCosts) totalCost = costSum;
        if (canViewProfit) {
          netProfit = profitSum;
          grossProfit = totalRevenue - costSum;
        }
      }

      // إحصائيات المنصات
      const platformStats = platforms.map((plt: any) => {
        const pltInvoices = completedInvoices.filter(i => i.platform.toLowerCase().includes(plt.name.toLowerCase()) || i.platform.toLowerCase().includes(plt.id));
        const rev = pltInvoices.reduce((s, i) => s + i.netAmount, 0);
        const disc = pltInvoices.reduce((s, i) => s + (i.discountAmount || 0), 0);
        let itemsSold = 0;
        let pltNetProfit: number | undefined = undefined;

        for (const inv of pltInvoices) {
          if (canViewProfit) {
            pltNetProfit = (pltNetProfit || 0) + (inv.profit || 0);
          }
          for (const line of (inv.lines || [])) {
            itemsSold += (line.quantity || 1);
          }
        }

        return {
          id: plt.id,
          name: plt.name,
          discountPercentage: plt.discountPercentage,
          ordersCount: pltInvoices.length,
          itemsSold,
          revenue: rev,
          discountAmount: disc,
          netProfit: canViewProfit ? pltNetProfit : undefined
        };
      });

      const lowStockItems = items.filter((it: any) => it.stockQuantity <= 5);

      const salesMap: Record<string, { name: string; quantity: number; revenue: number }> = {};
      for (const inv of completedInvoices) {
        for (const line of (inv.lines || [])) {
          if (!salesMap[line.itemId]) {
            salesMap[line.itemId] = {
              name: line.itemNameAtSale,
              quantity: 0,
              revenue: 0
            };
          }
          salesMap[line.itemId].quantity += (line.quantity || 1);
          salesMap[line.itemId].revenue += (line.unitNet || line.salePriceAtSale) * (line.quantity || 1);
        }
      }

      const topSelling = Object.values(salesMap).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
      const staleMetas = [invoices, items, returns, platforms].map(getStaleMeta).filter(m => m.stale);
      const isStale = staleMetas.length > 0;
      const lastSyncAt = staleMetas.map(m => m.lastSyncAt).filter(Boolean).sort()[0];

      res.json({
        success: true,
        ...(isStale ? { stale: true, lastSyncAt } : {}),
        summary: {
          totalRevenue,
          totalCost,
          grossProfit,
          totalCommissions,
          netProfit,
          invoicesCount: completedInvoices.length,
          returnsCount: returns.length,
          itemsCount: items.length,
          lowStockCount: lowStockItems.length
        },
        platformStats,
        lowStockItems,
        topSelling
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // تقرير المطابقة وترحيل القيود المحاسبية
  app.get('/api/reconciliation', requireFullMode as any, requirePermission('reports.view_reports') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const from = (req.query.from || req.query.startDate) as string | undefined;
      const to = (req.query.to || req.query.endDate) as string | undefined;
      const report = await getReconciliationReport({ token: req.authToken }, { from, to });
      const staleMeta = getStaleMeta(report);
      res.json({
        success: true,
        report,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // ترحيل يدوي معتمد لعملية تاريخية
  app.post('/api/reconciliation/post-item', requireFullMode as any, requirePermission('reports.view_reports') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await postReconciliationItem(req.body, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        phone: req.userSession!.phone,
        name: req.userSession!.name
      });
      sendWriteResult(res, result, 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // تقرير حركة صنف تفصيلي خلال فترة زمنية
  app.get('/api/reports/item-movement', requireFullMode as any, requirePermission('reports.item_movement.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await getItemMovementReport({
        itemId: String(req.query.itemId || ''),
        startDate: (req.query.startDate || req.query.from) as string,
        endDate: (req.query.endDate || req.query.to) as string,
        warehouseId: req.query.warehouseId ? String(req.query.warehouseId) : undefined
      }, {
        token: req.authToken,
        role: session.role,
        permissions: session.permissions
      });
      sendWriteResult(res, result, (result as any).statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // تقرير تعديلات كميات الأصناف المباشرة
  app.get('/api/reports/stock-adjustments', requireFullMode as any, requirePermission('reports.stock_adjustments.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await getStockAdjustmentsReport({
        itemId: req.query.itemId ? String(req.query.itemId) : undefined,
        startDate: (req.query.startDate || req.query.from) as string,
        endDate: (req.query.endDate || req.query.to) as string,
        warehouseId: req.query.warehouseId ? String(req.query.warehouseId) : undefined
      }, {
        token: req.authToken,
        role: session.role,
        permissions: session.permissions
      });
      sendWriteResult(res, result, (result as any).statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // تقرير تقسيط المنصات (BNPL)
  app.get('/api/reports/bnpl', requirePlatformsEnabled as any, requirePermission('reports.bnpl_view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const result = await getBnplReport({
        from: (req.query.from || req.query.startDate) as string,
        to: (req.query.to || req.query.endDate) as string,
        platformId: req.query.platformId ? String(req.query.platformId) : undefined,
        productQuery: req.query.productQuery ? String(req.query.productQuery) : undefined,
        groupBy: (req.query.groupBy as 'item' | 'platform' | 'invoice') || 'item'
      }, {
        token: req.authToken,
        role: session.role,
        permissions: session.permissions
      });
      sendWriteResult(res, result, (result as any).statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // تقرير المنصة (Platform Report)
  app.get('/api/reports/platform', requirePlatformsEnabled as any, requirePermission('reports.platform_view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const platformId = req.query.platformId ? String(req.query.platformId) : '';
      if (!platformId) {
        res.status(400).json({ success: false, error: 'معرف المنصة مطلوب' });
        return;
      }
      const result = await getPlatformReport({
        platformId,
        from: (req.query.from || req.query.startDate) as string,
        to: (req.query.to || req.query.endDate) as string,
        stagnantDays: req.query.stagnantDays ? Number(req.query.stagnantDays) : undefined
      }, {
        token: req.authToken,
        role: session.role,
        permissions: session.permissions
      });
      sendWriteResult(res, result, (result as any).statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 10. إدارة المستخدمين Users
  app.get('/api/users', requirePermission('users.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const users = await getUsers({ token: req.authToken });
      const staleMeta = getStaleMeta(users);
      res.json({
        success: true,
        users,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // عرض الجلسات النشطة للمستخدمين (من دون إرجاع رمز الجلسة أو أي سر)
  app.get('/api/users/sessions', requireAuth as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const caller = req.userSession!;
      const canViewSessions =
        caller.role === 'designer' ||
        caller.isOwner ||
        caller.permissions.includes('users.view') ||
        caller.permissions.includes('users.edit') ||
        caller.permissions.includes('users.status');
      if (!canViewSessions) {
        res.status(403).json({ success: false, error: 'غير مصرح: تفتقر لصلاحية عرض جلسات المستخدمين' });
        return;
      }

      pruneExpiredSessions();
      const sessions: ActiveUserSessionInfo[] = [];
      for (const [token, sess] of activeSessions.entries()) {
        const createdMs = sess.createdAt || (sess.expiresAt - SESSION_TTL_MS);
        const lastActiveMs = sess.lastActivityAt || createdMs;
        sessions.push({
          sessionId: sess.sessionId,
          userId: sess.userId,
          username: sess.username,
          name: sess.name,
          role: sess.role,
          deviceName: sess.deviceName || 'متصفح ويب',
          deviceId: sess.deviceId,
          createdAt: new Date(createdMs).toISOString(),
          lastActivityAt: new Date(lastActiveMs).toISOString(),
          expiresAt: new Date(sess.expiresAt).toISOString(),
          isCurrentSession: token === req.authToken
        });
      }

      sessions.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

      res.json({
        success: true,
        sessions,
        inactivityTimeoutMinutes: normalizeInactivityTimeoutMinutes(getCompanySettings().inactivityTimeoutMinutes)
      });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر جلب جلسات المستخدمين');
    }
  });

  // إنهاء جلسة محددة لمستخدم
  app.delete('/api/users/:id/sessions/:sessionId', requireAuth as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const caller = req.userSession!;
      const canTerminate =
        caller.role === 'designer' ||
        caller.isOwner ||
        caller.permissions.includes('users.edit') ||
        caller.permissions.includes('users.status');
      if (!canTerminate) {
        res.status(403).json({ success: false, error: 'غير مصرح: تفتقر لصلاحية إنهاء جلسات المستخدمين' });
        return;
      }

      pruneExpiredSessions();
      const targetUserId = String(req.params.id || '').trim();
      const targetSessionId = String(req.params.sessionId || '').trim();

      let matchedToken: string | null = null;
      let matchedSession: SessionData | null = null;
      for (const [token, sess] of activeSessions.entries()) {
        if (sess.userId === targetUserId && sess.sessionId === targetSessionId) {
          matchedToken = token;
          matchedSession = sess;
          break;
        }
      }

      if (!matchedToken || !matchedSession) {
        res.status(404).json({ success: false, error: 'الجلسة المطلوبة غير موجودة أو انتهت بالفعل' });
        return;
      }

      const targetIsOwner = matchedSession.role === 'designer' || Boolean(matchedSession.isOwner);
      const callerIsOwner = caller.role === 'designer' || Boolean(caller.isOwner);
      if (targetIsOwner && !callerIsOwner) {
        res.status(403).json({ success: false, error: 'غير مصرح: لا يمكن لغير المالك إنهاء جلسات مالك النظام' });
        return;
      }

      activeSessions.delete(matchedToken);
      revokedSessions.set(matchedToken, {
        reason: 'TERMINATED_BY_ADMIN',
        message: 'تم إنهاء الجلسة من قِبل إدارة النظام، يرجى تسجيل الدخول مجددًا',
        revokedAt: Date.now(),
        expiresAt: matchedSession.expiresAt
      });

      recordAuditLog(
        { id: caller.userId, name: caller.name, role: caller.role, phone: caller.phone },
        'USER_SESSION_TERMINATED',
        'Session',
        matchedSession.userId,
        `إنهاء جلسة للمستخدم ${matchedSession.name} (@${matchedSession.username}) — الجهاز: ${matchedSession.deviceName || 'متصفح ويب'}`
      );

      res.json({
        success: true,
        terminatedCount: 1,
        terminatedCurrentSession: matchedToken === req.authToken,
        message: `تم إنهاء جلسة المستخدم «${matchedSession.name}» بنجاح`
      });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر إنهاء الجلسة');
    }
  });

  // إنهاء جميع الجلسات النشطة لمستخدم
  app.delete('/api/users/:id/sessions', requireAuth as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const caller = req.userSession!;
      const canTerminate =
        caller.role === 'designer' ||
        caller.isOwner ||
        caller.permissions.includes('users.edit') ||
        caller.permissions.includes('users.status');
      if (!canTerminate) {
        res.status(403).json({ success: false, error: 'غير مصرح: تفتقر لصلاحية إنهاء جلسات المستخدمين' });
        return;
      }

      pruneExpiredSessions();
      const targetUserId = String(req.params.id || '').trim();
      const storedTarget = getStoredUserById(targetUserId);

      const matchingEntries: Array<[string, SessionData]> = [];
      for (const [token, sess] of activeSessions.entries()) {
        if (sess.userId === targetUserId) {
          matchingEntries.push([token, sess]);
        }
      }

      const targetIsOwner =
        storedTarget?.role === 'designer' ||
        Boolean(storedTarget?.isOwner) ||
        matchingEntries.some(([, s]) => s.role === 'designer' || Boolean(s.isOwner));
      const callerIsOwner = caller.role === 'designer' || Boolean(caller.isOwner);
      if (targetIsOwner && !callerIsOwner) {
        res.status(403).json({ success: false, error: 'غير مصرح: لا يمكن لغير المالك إنهاء جلسات مالك النظام' });
        return;
      }

      let terminatedCurrentSession = false;
      const now = Date.now();
      for (const [token, sess] of matchingEntries) {
        activeSessions.delete(token);
        revokedSessions.set(token, {
          reason: 'TERMINATED_BY_ADMIN',
          message: 'تم إنهاء الجلسة من قِبل إدارة النظام، يرجى تسجيل الدخول مجددًا',
          revokedAt: now,
          expiresAt: sess.expiresAt
        });
        if (token === req.authToken) {
          terminatedCurrentSession = true;
        }
      }

      const targetName = storedTarget?.name || matchingEntries[0]?.[1]?.name || targetUserId;
      const targetUsername = storedTarget?.username || matchingEntries[0]?.[1]?.username || '';

      recordAuditLog(
        { id: caller.userId, name: caller.name, role: caller.role, phone: caller.phone },
        'USER_ALL_SESSIONS_TERMINATED',
        'Session',
        targetUserId,
        `إنهاء جميع الجلسات النشطة (${matchingEntries.length}) للمستخدم ${targetName}${targetUsername ? ` (@${targetUsername})` : ''}`
      );

      res.json({
        success: true,
        terminatedCount: matchingEntries.length,
        terminatedCurrentSession,
        message: matchingEntries.length > 0
          ? `تم إنهاء جميع الجلسات النشطة (${matchingEntries.length}) للمستخدم «${targetName}»`
          : `لا توجد جلسات نشطة حاليًا للمستخدم «${targetName}»`
      });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر إنهاء جلسات المستخدم');
    }
  });

  app.post('/api/users', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isCreate = !req.body.id;
      const permRequired = isCreate ? 'users.create' : 'users.edit';
      if (!req.userSession || (!req.userSession.permissions.includes(permRequired) && req.userSession.role !== 'designer')) {
        res.status(403).json({ success: false, error: `غير مصرح: تفتقر لصلاحية [${permRequired}]` });
        return;
      }

      // المصمم وحده يدير تعيينات الخزائن
      if (req.body.cashboxConfig && req.userSession.role !== 'designer') {
        res.status(403).json({ success: false, error: 'غير مصرح: المصمم وحده يدير تعيينات الخزائن للمستخدمين.' });
        return;
      }

      const canManageWarehouses =
        req.userSession.role === 'designer' ||
        req.userSession.role === 'manager' ||
        req.userSession.isOwner ||
        req.userSession.permissions.includes('permissions.manage') ||
        req.userSession.permissions.includes('warehouses.manage');
      if (req.body.warehouseConfig && !canManageWarehouses) {
        res.status(403).json({ success: false, error: 'غير مصرح: تفتقر لصلاحية تعيين المخازن للمستخدمين' });
        return;
      }

      const result = await saveUser(req.body, {
        token: req.authToken,
        role: req.userSession.role,
        permissions: req.userSession.permissions,
        phone: req.userSession.phone
      });

      if (result.success && result.user) {
        for (const [, sess] of activeSessions.entries()) {
          if (sess.userId === result.user.id) {
            sess.name = result.user.name;
            sess.username = result.user.username;
            sess.mustChangePassword = Boolean(result.user.mustChangePassword);
          }
        }
      }

      sendWriteResult(res, result, 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // حذف مستخدم مع منع حذف آخر مالك للنظام
  app.delete('/api/users/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (
        !req.userSession ||
        (!req.userSession.permissions.includes('users.edit') &&
          !req.userSession.permissions.includes('users.status') &&
          req.userSession.role !== 'designer')
      ) {
        res.status(403).json({ success: false, error: 'غير مصرح: تفتقر لصلاحية إدارة أو حذف المستخدمين' });
        return;
      }

      const result = await deleteUser(req.params.id, {
        token: req.authToken,
        role: req.userSession.role,
        permissions: req.userSession.permissions,
        userId: req.userSession.userId,
        id: req.userSession.userId,
        phone: req.userSession.phone,
        name: req.userSession.name
      });

      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر حذف المستخدم');
    }
  });

  // تحديث صلاحيات مستخدم محدد
  app.post('/api/users/:id/permissions', requirePermission('permissions.manage') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { permissions } = req.body;
      const result = await updateUserPermissions(req.params.id, permissions, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // جلب وتعيين المخازن المسموحة والمخزن الافتراضي لمستخدم محدد
  app.get('/api/users/:id/warehouses', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const canView =
        session.role === 'designer' ||
        session.role === 'manager' ||
        session.isOwner ||
        session.userId === req.params.id ||
        session.permissions.includes('users.view') ||
        session.permissions.includes('permissions.view') ||
        session.permissions.includes('warehouses.view');
      if (!canView) {
        res.status(403).json({ success: false, error: 'غير مصرح: لا تملك صلاحية عرض مخازن المستخدمين' });
        return;
      }
      const result = await getUserWarehouses(req.params.id);
      sendWriteResult(res, result, result.statusCode || 404);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  const handleSaveUserWarehouses = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const canManage =
        session.role === 'designer' ||
        session.role === 'manager' ||
        session.isOwner ||
        session.permissions.includes('permissions.manage') ||
        session.permissions.includes('warehouses.manage');
      if (!canManage) {
        res.status(403).json({ success: false, error: 'غير مصرح: تفتقر لصلاحية تعيين المخازن للمستخدمين' });
        return;
      }
      const result = await saveUserWarehouses(req.params.id, req.body || {}, {
        token: req.authToken,
        role: session.role,
        isOwner: session.isOwner,
        userId: session.userId,
        id: session.userId,
        phone: session.phone,
        name: session.name,
        permissions: session.permissions
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  };
  app.put('/api/users/:id/warehouses', requireAuth as any, handleSaveUserWarehouses as any);
  app.post('/api/users/:id/warehouses', requireAuth as any, handleSaveUserWarehouses as any);

  // 11. إعدادات هوية ومظهر الشركة
  app.post('/api/settings/company', requirePermission('settings.company_appearance') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requestedTheme = req.body?.appTheme;
      if (requestedTheme !== undefined && requestedTheme !== '' && !isValidAppTheme(requestedTheme)) {
        res.status(400).json({
          success: false,
          error: `قيمة الثيم المختار غير صالحة (${String(requestedTheme)})`
        });
        return;
      }
      const result = await saveCompanySettings(req.body, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions
      });
      sendWriteResult(res, result, (result as any).statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 11a. حفظ أرقام التواصل (قسم «بيانات التواصل» في الإعدادات) بصلاحية الإعدادات الحالية
  app.post('/api/settings/contact', requirePermission('settings.company_appearance') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await saveContactSettings(req.body || {}, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر حفظ بيانات التواصل');
    }
  });

  // 11b. خيار تفعيل/إيقاف رسوم التوصيل
  app.post('/api/settings/delivery-fee', requirePermission('settings.company_appearance') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { enableDeliveryFee } = req.body;
      const result = await saveCompanySettings({ enableDeliveryFee: Boolean(enableDeliveryFee) }, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 12. إعدادات الفاتورة والطباعة
  app.post('/api/settings/invoice-print', requirePermission('settings.invoice_print') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await saveInvoicePrintSettings(req.body, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 13. إعدادات عرض الأصناف وشاشة المبيعات
  app.post('/api/settings/display', requirePermission('settings.display_customization') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await saveDisplaySettings(req.body, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 14. إعدادات الضريبة والعمولات
  app.post('/api/settings/tax', requirePermission('settings.company_appearance') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await saveTaxSettings(req.body, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 14b. إعدادات سياسة المخزون (البيع بالسالب)
  app.post('/api/settings/stock', requirePermission('settings.negative_stock') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await saveStockSettings(req.body, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        actorId: req.userSession!.userId,
        actorName: req.userSession!.name,
        name: req.userSession!.name,
        phone: req.userSession!.phone,
        id: req.userSession!.userId
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 14. سجل التدقيق
  app.get('/api/audit-logs', requirePermission('audit.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const from = (req.query.from || req.query.startDate) as string | undefined;
      const to = (req.query.to || req.query.endDate) as string | undefined;
      const userId = req.query.userId as string | undefined;
      const action = req.query.action as string | undefined;
      const q = req.query.q as string | undefined;
      const logs = await getAuditLogs({ token: req.authToken }, { from, to, userId, action, q });
      const staleMeta = getStaleMeta(logs);
      res.json({
        success: true,
        logs,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // 15. رفع الصور
  app.post('/api/upload-image', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { imageBase64, fileName, mimeType, folder } = req.body;
      if (!imageBase64) {
        res.status(400).json({ success: false, error: 'بيانات الصورة مطلوبة' });
        return;
      }
      // قاعدة البيانات مفعّلة: الصورة تُرفع على تخزين الصور ويُحفظ رابطها فقط
      if (imageStorage) {
        const stored = await imageStorage.upload({ imageBase64, folder });
        res.json({ success: true, url: stored.url, path: stored.path, message: 'تم رفع الصورة' });
        return;
      }
      const result = await uploadImage({ imageBase64, fileName, mimeType }, req.authToken);
      sendWriteResult(res, result);
    } catch (err: any) {
      if (sendImageStorageError(res, err)) return;
      handleCatchError(res, err, 'حدث خطأ أثناء رفع الصورة');
    }
  });

  // ===================== صور الأصناف بالجملة (الاستيراد والتعديل بالإكسيل) ===================== //

  // هل تخزين الصور مفعّل؟ (الاستيراد بالصور يحتاجه، والتصدير لا)
  app.get('/api/items/images/config', requireAuth as any, (_req: AuthenticatedRequest, res: Response) => {
    res.json({ success: true, storageEnabled: Boolean(imageStorage), maxImageBytes: 2 * 1024 * 1024 });
  });

  /**
   * ربط صور اترفعت بالفعل على تخزين الصور (من /api/upload-image) بالأصناف — حتى 100 صورة في الطلب.
   * الصنف بالباركود الرئيسي أو الاسم. الصورة القديمة تتمسح من التخزين لو مفيش أي حاجة تانية بتستخدمها.
   */
  app.post('/api/items/images/set', requireFullMode as any, requirePermission('products.bulk_edit_excel') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!imageStorage) {
        res.status(503).json({ success: false, code: 'STORAGE_DISABLED', error: 'تخزين الصور على السيرفر مش مفعّل في النسخة دي، فمش هينفع ترفع صور' });
        return;
      }
      const session = req.userSession!;
      const replace = req.body?.replace === true;
      const result = setItemImages(req.body?.entries, { replace, isOurUrl: url => Boolean(imageStorage.pathFromUrl(url)) }, { name: session.name, phone: session.phone });
      if (!result.success) {
        res.status(result.statusCode || 400).json({ success: false, error: result.error });
        return;
      }
      // مسح الصور القديمة اللي ما بقتش مستخدمة (الصورة الواحدة ممكن تكون لأكتر من صنف)
      const slideUrls = new Set(getVisitorSettings().slides.map(slide => slide.url));
      const unused = new Set<string>();
      for (const r of result.results || []) {
        if (r.status !== 'updated' || !r.oldUrl) continue;
        const path = imageStorage.pathFromUrl(r.oldUrl);
        if (path && !isImageUrlReferenced(r.oldUrl) && !slideUrls.has(r.oldUrl)) unused.add(path);
      }
      if (unused.size > 0) await imageStorage.remove([...unused]);
      if ((result.updated || 0) > 0) {
        recordAuditLog(
          { id: session.userId, name: session.name, role: session.role, phone: session.phone },
          'ITEM_IMAGES_IMPORTED',
          'Item',
          'images',
          `استيراد صور الأصناف: ${result.updated} صورة اتحطت${replace ? ' (مع استبدال الصور الموجودة)' : ''}، ${result.skipped} اتسابت، ${result.failed} فشلت`
        );
      }
      res.json({ success: true, results: result.results, updated: result.updated, skipped: result.skipped, failed: result.failed, removedOldFiles: unused.size });
    } catch (err: any) {
      handleCatchError(res, err, 'تعذر حفظ صور الأصناف');
    }
  });

  // ===================== التوصيل ===================== //
  const sendDeliveryError = (res: Response, err: any, fallback: string) => {
    if (err instanceof delivery.DeliveryError) {
      res.status(err.statusCode).json({ success: false, code: err.code, error: err.message });
      return;
    }
    handleCatchError(res, err, fallback);
  };
  const deliverySessionOf = (req: AuthenticatedRequest): deliveryService.DeliverySession => {
    const s = req.userSession!;
    return { userId: s.userId, name: s.name, username: s.username, phone: s.phone, role: s.role, isOwner: s.isOwner, permissions: s.permissions || [], token: req.authToken };
  };
  const deliveryUsers = () =>
    ((usersCollection.get() || []) as any[]).map((u) => ({ id: String(u.id), name: String(u.name || u.username || ''), username: String(u.username || ''), isDriver: Array.isArray(u.permissions) && u.permissions.includes('delivery.driver') }));
  const deliveryFullConfig = () => ({
    success: true,
    settings: delivery.getDeliverySettings(),
    zones: delivery.listZones(),
    drivers: delivery.listDrivers(),
    couriers: delivery.listCouriers()
  });

  // شاشة البيع: هل التوصيل شغال؟ والمناطق والطيارين والشركات الشغالين (من غير مرتبات ولا عمولات)
  app.get('/api/delivery/config', requireAuth as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const s = delivery.getDeliverySettings();
      const session = req.userSession!;
      const canEditFee = session.role === 'designer' || Boolean(session.isOwner) || (session.permissions || []).includes('delivery.edit_fee');
      res.json({
        success: true,
        settings: {
          enabled: s.enabled,
          mode: s.mode,
          zonePricing: s.zonePricing,
          fixedFee: s.fixedFee,
          prepSlip: s.prepSlip
        },
        canEditFee,
        zones: delivery.listZones().filter((z) => z.active).map((z) => ({ id: z.id, name: z.name, customerFee: z.customerFee, minOrderValue: z.minOrderValue })),
        drivers: s.mode === 'couriers' ? [] : delivery.listDrivers().filter((d) => d.active).map((d) => ({ id: d.id, name: d.name, phone: d.phone })),
        couriers: s.mode === 'drivers' ? [] : delivery.listCouriers().filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))
      });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر تحميل إعدادات التوصيل');
    }
  });

  app.get('/api/delivery/settings', requireFullMode as any, requirePermission('delivery.settings') as any, (_req: AuthenticatedRequest, res: Response) => {
    try {
      res.json({ ...deliveryFullConfig(), users: deliveryUsers() });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر تحميل إعدادات التوصيل');
    }
  });

  app.post('/api/delivery/settings', requireFullMode as any, requirePermission('delivery.settings') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const saved = delivery.saveDeliverySettings(req.body || {}, session.name || session.username || '');
      recordAuditLog(
        { id: session.userId, name: session.name, role: session.role, phone: session.phone },
        'DELIVERY_SETTINGS_UPDATED',
        'settings',
        'delivery',
        `إعدادات التوصيل: ${saved.enabled ? 'شغال' : 'مقفول'}، ${saved.mode === 'drivers' ? 'طيارين بس' : saved.mode === 'couriers' ? 'شركات شحن بس' : 'طيارين وشركات'}، ${saved.zonePricing ? 'الرسوم حسب المنطقة' : `رسوم ثابتة ${saved.fixedFee} ج.م`}، أقصى عهدة ${saved.maxDriverCustody || 'من غير حد'}`
      );
      res.json(deliveryFullConfig());
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر حفظ إعدادات التوصيل');
    }
  });

  const deliveryMasterRoute = (path: string, label: string, save: (body: any) => { id: string; name: string }) => {
    app.post(path, requireFullMode as any, requirePermission('delivery.settings') as any, (req: AuthenticatedRequest, res: Response) => {
      try {
        const session = req.userSession!;
        const isNew = !req.body?.id;
        const saved = save(req.body || {});
        recordAuditLog(
          { id: session.userId, name: session.name, role: session.role, phone: session.phone },
          'DELIVERY_MASTER_SAVED',
          'delivery',
          saved.id,
          `${isNew ? 'إضافة' : 'تعديل'} ${label}: ${saved.name}`
        );
        res.json({ ...deliveryFullConfig(), saved });
      } catch (err: any) {
        sendDeliveryError(res, err, `تعذر حفظ ${label}`);
      }
    });
  };
  deliveryMasterRoute('/api/delivery/zones', 'منطقة توصيل', (body) => delivery.saveZone(body));
  deliveryMasterRoute('/api/delivery/drivers', 'طيار', (body) =>
    delivery.saveDriver(body, (userId) => ((usersCollection.get() || []) as any[]).some((u) => String(u.id) === userId))
  );
  deliveryMasterRoute('/api/delivery/couriers', 'شركة شحن', (body) => delivery.saveCourier(body));

  // شاشة «التوصيل»: كل الطلبات
  app.get('/api/delivery/orders', requirePermission('delivery.view') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const q = req.query as Record<string, string>;
      const orders = delivery.listOrders({
        status: q.status || undefined,
        assigneeType: q.assigneeType || undefined,
        assigneeId: q.assigneeId || undefined,
        from: q.from || undefined,
        to: q.to || undefined,
        open: q.open === '1' || q.open === 'true'
      });
      res.json({ success: true, orders, lateAfterHours: delivery.getDeliverySettings().lateAfterHours });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر تحميل طلبات التوصيل');
    }
  });

  app.post('/api/delivery/orders/:id/assign', requirePermission('delivery.manage') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = deliveryService.assignOrder(req.params.id, req.body || {}, deliverySessionOf(req));
      res.json({ success: true, ...result });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر توزيع الطلب');
    }
  });

  app.post('/api/delivery/orders/:id/status', requirePermission('delivery.manage') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await deliveryService.changeOrderStatus(req.params.id, req.body || {}, deliverySessionOf(req));
      res.json({ success: true, ...result });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر تغيير حالة الطلب');
    }
  });

  // الطيار من موبايله: طلباته هو بس
  app.get('/api/delivery/my-orders', requirePermission('delivery.driver') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      res.json({ success: true, ...deliveryService.myOrders(deliverySessionOf(req)) });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر تحميل طلباتك');
    }
  });

  app.post('/api/delivery/my-orders/:id/status', requirePermission('delivery.driver') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await deliveryService.changeOrderStatus(req.params.id, req.body || {}, deliverySessionOf(req), { asDriver: true });
      res.json({ success: true, ...result });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر تغيير حالة الطلب');
    }
  });

  // التسوية
  app.get('/api/delivery/settlement-preview', requireFullMode as any, requirePermission('delivery.settle') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const q = req.query as Record<string, string>;
      res.json({ success: true, ...delivery.previewSettlement(q.assigneeType, q.assigneeId) });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر تحميل طلبات التسوية');
    }
  });

  app.post('/api/delivery/settle', requireFullMode as any, requirePermission('delivery.settle') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = deliveryService.settle(req.body || {}, deliverySessionOf(req));
      if (result.requiresConfirmation) {
        res.status(400).json({ ...result, code: 'CONFIRM_DIFFERENCE', error: result.message });
        return;
      }
      res.json(result);
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر تسجيل التسوية');
    }
  });

  app.get('/api/delivery/settlements', requireFullMode as any, requirePermission('delivery.settle') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const q = req.query as Record<string, string>;
      res.json({ success: true, settlements: delivery.listSettlements({ assigneeType: q.assigneeType, assigneeId: q.assigneeId, from: q.from, to: q.to }) });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر تحميل التسويات');
    }
  });

  // مستحقات الطيار وصرفها
  app.get('/api/delivery/drivers/:id/dues', requireFullMode as any, requirePermission('delivery.settle') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      res.json({ success: true, dues: delivery.driverDues(req.params.id), payouts: delivery.listPayouts({ driverId: req.params.id }) });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر تحميل مستحقات الطيار');
    }
  });

  app.get('/api/delivery/payout-preview', requireFullMode as any, requirePermission('delivery.settle') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const q = req.query as Record<string, string>;
      res.json({
        success: true,
        ...delivery.previewPayout(q.driverId, {
          salary: q.salary,
          payCommission: q.payCommission,
          deductShortage: q.deductShortage
        })
      });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر معاينة صرف مستحقات الطيار');
    }
  });

  app.post('/api/delivery/payouts', requireFullMode as any, requirePermission('delivery.settle') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = deliveryService.payDriver(req.body || {}, deliverySessionOf(req));
      if (result.requiresConfirmation) {
        res.status(409).json({ ...result, code: result.code || 'PAYOUT_PREVIEW_CHANGED', error: result.message });
        return;
      }
      res.json(result);
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر صرف مستحقات الطيار');
    }
  });

  app.get('/api/delivery/reports', requireFullMode as any, requirePermission('delivery.reports') as any, (req: AuthenticatedRequest, res: Response) => {
    try {
      const q = req.query as Record<string, string>;
      res.json({ success: true, ...delivery.buildDeliveryReports({ from: q.from, to: q.to }) });
    } catch (err: any) {
      sendDeliveryError(res, err, 'تعذر تحميل تقارير التوصيل');
    }
  });

  // ===================== 16. الموردين والمشتريات ===================== //

  app.get('/api/suppliers', requireFullMode as any, requirePermission('suppliers.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const suppliers = await getSuppliers({ token: req.authToken });
      const staleMeta = getStaleMeta(suppliers);
      res.json({
        success: true,
        suppliers,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/suppliers', requireFullMode as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isEdit = Boolean(req.body.id);
      const permRequired = isEdit ? 'suppliers.edit' : 'suppliers.create';
      if (!req.userSession || (!req.userSession.permissions.includes(permRequired) && req.userSession.role !== 'designer')) {
        res.status(403).json({ success: false, error: `غير مصرح: تفتقر لصلاحية [${permRequired}]` });
        return;
      }
      const result = await saveSupplier(req.body, {
        token: req.authToken,
        role: req.userSession.role,
        permissions: req.userSession.permissions,
        phone: req.userSession.phone,
        name: req.userSession.name
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/supplier-groups', requireFullMode as any, requirePermission('suppliers.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const groups = await getSupplierGroups({ token: req.authToken });
      const staleMeta = getStaleMeta(groups);
      res.json({
        success: true,
        groups,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/supplier-groups', requireFullMode as any, requirePermission('suppliers.edit') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await saveSupplierGroup(req.body, { token: req.authToken });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/suppliers/:id/ledger', requireFullMode as any, requirePermission('suppliers.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const from = (req.query.from || req.query.startDate) as string | undefined;
      const to = (req.query.to || req.query.endDate) as string | undefined;
      const result = await getSupplierLedger(req.params.id, { token: req.authToken }, { from, to });
      sendWriteResult(res, result, 404);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/suppliers/voucher', requireFullMode as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isPayment = req.body.type === 'سند صرف';
      const permRequired = isPayment ? 'cashbox.payment' : 'cashbox.receipt';
      if (!req.userSession || (!req.userSession.permissions.includes(permRequired) && req.userSession.role !== 'designer')) {
        res.status(403).json({ success: false, error: `غير مصرح: تفتقر لصلاحية [${permRequired}]` });
        return;
      }
      const result = await createSupplierVoucher(req.body, {
        token: req.authToken,
        role: req.userSession.role,
        permissions: req.userSession.permissions,
        phone: req.userSession.phone,
        name: req.userSession.name
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/purchases', requireFullMode as any, requirePermission('purchases.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const from = (req.query.from || req.query.startDate) as string | undefined;
      const to = (req.query.to || req.query.endDate) as string | undefined;
      const purchases = await getPurchases({
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions
      }, { from, to });
      const staleMeta = getStaleMeta(purchases);
      res.json({
        success: true,
        purchases,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/purchases', requireFullMode as any, requirePermission('purchases.create') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await createPurchase(req.body, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        phone: req.userSession!.phone,
        userId: req.userSession!.userId,
        name: req.userSession!.name
      } as any);
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/purchase-returns', requireFullMode as any, requirePermission('purchases.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const from = (req.query.from || req.query.startDate) as string | undefined;
      const to = (req.query.to || req.query.endDate) as string | undefined;
      const returns = await getPurchaseReturns({ token: req.authToken }, { from, to });
      const staleMeta = getStaleMeta(returns);
      res.json({
        success: true,
        returns,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/purchases/return', requireFullMode as any, requirePermission('purchases.return') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await createPurchaseReturn(req.body, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        phone: req.userSession!.phone,
        userId: req.userSession!.userId,
        name: req.userSession!.name
      } as any);
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // إلغاء فاتورة شراء معتمدة عبر قيد عكسي
  app.post('/api/purchases/:id/cancel', requireFullMode as any, requirePermission('purchases.create') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await cancelPurchase(req.params.id, req.body.reason, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        phone: req.userSession!.phone,
        name: req.userSession!.name
      });
      sendWriteResult(res, result, 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // ===================== 17. العملاء ===================== //

  app.get('/api/customers', requirePermission('customers.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const customers = await getCustomers({ token: req.authToken });
      const staleMeta = getStaleMeta(customers);
      res.json({
        success: true,
        customers,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/customers', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isEdit = Boolean(req.body.id);
      const permRequired = isEdit ? 'customers.edit' : 'customers.create';
      if (!req.userSession || (!req.userSession.permissions.includes(permRequired) && req.userSession.role !== 'designer')) {
        res.status(403).json({ success: false, error: `غير مصرح: تفتقر لصلاحية [${permRequired}]` });
        return;
      }
      const result = await saveCustomer(req.body, {
        token: req.authToken,
        role: req.userSession.role,
        permissions: req.userSession.permissions,
        phone: req.userSession.phone,
        name: req.userSession.name
      });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/customer-groups', requirePermission('customers.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const groups = await getCustomerGroups({ token: req.authToken });
      const staleMeta = getStaleMeta(groups);
      res.json({
        success: true,
        groups,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/customer-groups', requirePermission('customers.edit') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await saveCustomerGroup(req.body, { token: req.authToken });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/customers/:id/ledger', requirePermission('customers.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const from = (req.query.from || req.query.startDate) as string | undefined;
      const to = (req.query.to || req.query.endDate) as string | undefined;
      const result = await getCustomerLedger(req.params.id, { token: req.authToken }, { from, to });
      sendWriteResult(res, result, 404);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/customers/voucher', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isReceipt = req.body.type === 'سند قبض';
      const permRequired = isReceipt ? 'cashbox.receipt' : 'cashbox.payment';
      if (!req.userSession || (!req.userSession.permissions.includes(permRequired) && req.userSession.role !== 'designer')) {
        res.status(403).json({ success: false, error: `غير مصرح: تفتقر لصلاحية [${permRequired}]` });
        return;
      }
      const result = await createCustomerVoucher(req.body, {
        token: req.authToken,
        role: req.userSession.role,
        permissions: req.userSession.permissions,
        phone: req.userSession.phone,
        name: req.userSession.name
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // سجل حساب الطرف الموحد (عميل أو منصة) مع الفواتير الآجلة المعلّقة
  app.get('/api/ledger/party', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const session = req.userSession!;
      const canView =
        session.role === 'designer' ||
        session.isOwner ||
        session.permissions.includes('invoices.collect_credit') ||
        session.permissions.includes('customers.view') ||
        session.permissions.includes('platforms.view');
      if (!canView) {
        res.status(403).json({
          success: false,
          error: 'غير مصرح: لا تملك صلاحية عرض سجل الطرف أو تحصيل الآجل'
        });
        return;
      }

      const partyType = req.query.partyType === 'platform' ? 'platform' : 'customer';
      if (partyType === 'platform' && !arePlatformsEnabled()) {
        res.status(403).json({
          success: false,
          code: 'PLATFORMS_DISABLED',
          error: 'مبيعات ووظائف المنصات معطلة حاليًا من إعدادات النظام'
        });
        return;
      }
      const partyId = String(req.query.partyId || '').trim();
      if (!partyId) {
        res.status(400).json({ success: false, error: 'يجب تحديد الطرف' });
        return;
      }

      const from = (req.query.from || req.query.startDate) as string | undefined;
      const to = (req.query.to || req.query.endDate) as string | undefined;

      const result = await getPartyLedger(
        { partyType, partyId, from, to },
        {
          token: req.authToken,
          role: session.role,
          permissions: session.permissions
        }
      );
      sendWriteResult(res, result, 404);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // تحصيل الفواتير الآجلة المعلّقة لطرف (عميل أو منصة)
  app.post('/api/invoices/collect-credit', requirePermission('invoices.collect_credit') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (req.body?.partyType === 'platform' && !arePlatformsEnabled()) {
        res.status(403).json({
          success: false,
          code: 'PLATFORMS_DISABLED',
          error: 'مبيعات ووظائف المنصات معطلة حاليًا من إعدادات النظام'
        });
        return;
      }
      const session = req.userSession!;
      const result = await collectCreditInvoices(req.body, {
        token: req.authToken,
        userId: session.userId,
        name: session.name,
        phone: session.phone,
        role: session.role,
        permissions: session.permissions
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // ===================== 18. الخزائن والتحويلات المالية ===================== //

  // جلب خزن لوحة التحكم المخصصة للمستخدم الحالي (مفلترة ومحمية بالصلاحيات والتعيينات)
  app.get('/api/dashboard/cashboxes', requireFullMode as any, requirePermission('dashboard.view_cashboxes') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const cashboxes = await getDashboardCashboxes({
        userId: req.userSession!.userId,
        role: req.userSession!.role,
        isOwner: req.userSession!.isOwner,
        token: req.authToken
      });
      const staleMeta = getStaleMeta(cashboxes);
      res.json({
        success: true,
        cashboxes,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/cashboxes', requirePermission('cashbox.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const cashboxes = await getCashboxes({ token: req.authToken });
      const staleMeta = getStaleMeta(cashboxes);
      res.json({
        success: true,
        cashboxes,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/cashboxes', requireFullMode as any, requirePermission('cashbox.create') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await saveCashbox(req.body, { token: req.authToken });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/cashboxes/:id/transactions', requireFullMode as any, requirePermission('cashbox.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const from = (req.query.from || req.query.startDate) as string | undefined;
      const to = (req.query.to || req.query.endDate) as string | undefined;
      const session = req.userSession;
      const result = await getCashboxTransactions(
        req.params.id,
        {
          token: req.authToken,
          userId: session?.userId,
          role: session?.role,
          isOwner: session?.isOwner,
          phone: session?.phone
        },
        { from, to }
      );
      sendWriteResult(res, result, 404);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/cashboxes/transfer', requireFullMode as any, requirePermission('cashbox.transfer') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await createCashboxTransfer(req.body, {
        token: req.authToken,
        role: req.userSession!.role,
        permissions: req.userSession!.permissions,
        phone: req.userSession!.phone,
        name: req.userSession!.name
      });
      sendWriteResult(res, result, result.statusCode || 400);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.get('/api/cashbox-assignments', requirePermission('permissions.view') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const assignments = await getUserCashboxAssignments({ token: req.authToken });
      const staleMeta = getStaleMeta(assignments);
      res.json({
        success: true,
        assignments,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  app.post('/api/cashbox-assignments', requireFullMode as any, requirePermission('permissions.manage') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await saveUserCashboxAssignment(req.body, { token: req.authToken });
      sendWriteResult(res, result);
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // سجل دفعات الاستيراد
  app.get('/api/import-batches', requireFullMode as any, requirePermission('items.import_export') as any, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const batches = await getImportBatches({ token: req.authToken });
      const staleMeta = getStaleMeta(batches);
      res.json({
        success: true,
        batches,
        ...(staleMeta.stale ? { stale: true, lastSyncAt: staleMeta.lastSyncAt } : {})
      });
    } catch (err: any) {
      handleCatchError(res, err);
    }
  });

  // ===================== VITE & STATIC HANDLING ===================== //

  const shouldAttachVite = options?.attachVite ?? (process.env.NODE_ENV !== 'production');
  if (shouldAttachVite) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      plugins: [
        {
          name: 'disable-hmr-websocket-client',
          enforce: 'post',
          transform(code, id) {
            if (id.replace(/\\/g, '/').endsWith('/vite/dist/client/client.mjs')) {
              return code
                .replace(
                  /const transport = normalizeModuleRunnerTransport\(\(\(\) => \{[\s\S]*?\}\)\(\)\);/,
                  'const transport = normalizeModuleRunnerTransport({ connect() {}, disconnect() {}, send() {} });'
                )
                .replace(
                  'setupForwardConsoleHandler(transport, forwardConsole);',
                  '/* Console forwarding disabled */'
                );
            }
          },
        },
      ],
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  return { app, httpServer, PORT, persistence, cartJournal, linkedAccounts, manualBalances, imageStorage };
}

async function startServer() {
  const { httpServer, PORT } = await createServerApp();
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 POS Modaqiq Server is running on port ${PORT} at http://0.0.0.0:${PORT}`);
  });
}

if (process.env.SKIP_SERVER_LISTEN !== '1') {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

import {
  KeyboardShortcutActionId,
  KeyboardShortcutsSettings,
  PageType,
  UserAccount
} from '../types';
import { NAV_GROUPS, isGroupVisible, isSubItemVisible, isPageAllowedByFeatureModes, type FeatureModeFlags } from '../config/navigation';
import { hasPermission } from './permissions';

export type ShortcutGroupId = 'pos' | 'navigation' | 'general';

/**
 * Scope rules:
 * - 'pos': active only on the POS screen (when no modal is open)
 * - 'non_pos': active on non-POS screens (or inside modals for save_form)
 * - 'global': active across both POS and non-POS screens (navigation & Esc)
 *
 * Two actions conflict if and only if their scopes overlap:
 * - 'pos' conflicts with 'pos' and 'global'
 * - 'non_pos' conflicts with 'non_pos' and 'global'
 * - 'global' conflicts with 'pos', 'non_pos', and 'global'
 * - 'pos' and 'non_pos' do NOT conflict (an action in POS can share a key with an action that does not run in POS)
 */
export type ShortcutScope = 'pos' | 'non_pos' | 'global';

export interface KeyboardShortcutDefinition {
  id: KeyboardShortcutActionId;
  groupId: ShortcutGroupId;
  groupTitle: string;
  label: string;
  description?: string;
  defaultKey: string;
  defaultEnabled: boolean;
  fixed?: boolean;
  scope: ShortcutScope;
  navPage?: PageType;
}

export const KEYBOARD_SHORTCUT_GROUPS: Array<{
  id: ShortcutGroupId;
  title: string;
}> = [
  { id: 'pos', title: 'أ) نقطة البيع' },
  { id: 'navigation', title: 'ب) التنقل بين الشاشات' },
  { id: 'general', title: 'ج) عامة في أي شاشة' }
];

export const KEYBOARD_SHORTCUT_DEFINITIONS: KeyboardShortcutDefinition[] = [
  // أ) نقطة البيع
  {
    id: 'pos.save_and_print',
    groupId: 'pos',
    groupTitle: 'أ) نقطة البيع',
    label: 'حفظ الفاتورة مع الطباعة',
    defaultKey: 'F2',
    defaultEnabled: true,
    scope: 'pos'
  },
  {
    id: 'pos.save_only',
    groupId: 'pos',
    groupTitle: 'أ) نقطة البيع',
    label: 'حفظ الفاتورة بدون طباعة',
    defaultKey: 'F3',
    defaultEnabled: true,
    scope: 'pos'
  },
  {
    id: 'pos.cancel_invoice',
    groupId: 'pos',
    groupTitle: 'أ) نقطة البيع',
    label: 'إلغاء الفاتورة',
    defaultKey: 'F4',
    defaultEnabled: true,
    scope: 'pos'
  },
  {
    id: 'pos.focus_barcode',
    groupId: 'pos',
    groupTitle: 'أ) نقطة البيع',
    label: 'الانتقال لخانة الباركود',
    description: 'غير مفعّل افتراضيًا لأن مسح الباركود يوجّه التركيز تلقائيًا',
    defaultKey: 'F6',
    defaultEnabled: false,
    scope: 'pos'
  },
  {
    id: 'pos.focus_search',
    groupId: 'pos',
    groupTitle: 'أ) نقطة البيع',
    label: 'الانتقال لخانة البحث عن صنف',
    defaultKey: 'F7',
    defaultEnabled: false,
    scope: 'pos'
  },
  {
    id: 'pos.focus_paid',
    groupId: 'pos',
    groupTitle: 'أ) نقطة البيع',
    label: 'الانتقال لخانة المدفوع',
    defaultKey: 'F8',
    defaultEnabled: false,
    scope: 'pos'
  },

  // ب) التنقل بين الشاشات
  {
    id: 'nav.pos',
    groupId: 'navigation',
    groupTitle: 'ب) التنقل بين الشاشات',
    label: 'فتح نقطة البيع',
    defaultKey: 'Alt+1',
    defaultEnabled: true,
    scope: 'global',
    navPage: 'pos'
  },
  {
    id: 'nav.dashboard',
    groupId: 'navigation',
    groupTitle: 'ب) التنقل بين الشاشات',
    label: 'فتح لوحة التحكم',
    defaultKey: 'Alt+2',
    defaultEnabled: true,
    scope: 'global',
    navPage: 'dashboard'
  },
  {
    id: 'nav.items',
    groupId: 'navigation',
    groupTitle: 'ب) التنقل بين الشاشات',
    label: 'فتح الأصناف',
    defaultKey: 'Alt+3',
    defaultEnabled: true,
    scope: 'global',
    navPage: 'items'
  },
  {
    id: 'nav.invoices',
    groupId: 'navigation',
    groupTitle: 'ب) التنقل بين الشاشات',
    label: 'فتح سجل الفواتير',
    defaultKey: 'Alt+4',
    defaultEnabled: true,
    scope: 'global',
    navPage: 'invoices'
  },
  {
    id: 'nav.customers',
    groupId: 'navigation',
    groupTitle: 'ب) التنقل بين الشاشات',
    label: 'فتح العملاء',
    defaultKey: 'Alt+5',
    defaultEnabled: true,
    scope: 'global',
    navPage: 'customers'
  },
  {
    id: 'nav.reports',
    groupId: 'navigation',
    groupTitle: 'ب) التنقل بين الشاشات',
    label: 'فتح التقارير',
    defaultKey: 'Alt+6',
    defaultEnabled: true,
    scope: 'global',
    navPage: 'reports'
  },

  // ج) عامة في أي شاشة
  {
    id: 'general.save_form',
    groupId: 'general',
    groupTitle: 'ج) عامة في أي شاشة',
    label: 'حفظ النموذج الحالي',
    defaultKey: 'Ctrl+S',
    defaultEnabled: true,
    scope: 'non_pos'
  },
  {
    id: 'general.add_new',
    groupId: 'general',
    groupTitle: 'ج) عامة في أي شاشة',
    label: 'إضافة جديد (صنف، عميل، مورد... حسب الشاشة المفتوحة)',
    defaultKey: 'Alt+N',
    defaultEnabled: true,
    scope: 'non_pos'
  },
  {
    id: 'general.focus_search',
    groupId: 'general',
    groupTitle: 'ج) عامة في أي شاشة',
    label: 'الانتقال لخانة البحث في الشاشة الحالية',
    defaultKey: 'Ctrl+F',
    defaultEnabled: true,
    scope: 'non_pos'
  },
  {
    id: 'general.print_page',
    groupId: 'general',
    groupTitle: 'ج) عامة في أي شاشة',
    label: 'طباعة الصفحة الحالية',
    defaultKey: 'Ctrl+P',
    defaultEnabled: true,
    scope: 'non_pos'
  },
  {
    id: 'general.close_or_back',
    groupId: 'general',
    groupTitle: 'ج) عامة في أي شاشة',
    label: 'إغلاق النافذة المنبثقة أو الرجوع',
    description: 'ثابت لا يُعدَّل',
    defaultKey: 'Esc',
    defaultEnabled: true,
    fixed: true,
    scope: 'global'
  }
];

export const SHORTCUT_DEFINITION_MAP: Record<KeyboardShortcutActionId, KeyboardShortcutDefinition> =
  KEYBOARD_SHORTCUT_DEFINITIONS.reduce((acc, def) => {
    acc[def.id] = def;
    return acc;
  }, {} as Record<KeyboardShortcutActionId, KeyboardShortcutDefinition>);

export function getDefaultKeyboardShortcutsSettings(): KeyboardShortcutsSettings {
  const bindings = {} as KeyboardShortcutsSettings['bindings'];
  for (const def of KEYBOARD_SHORTCUT_DEFINITIONS) {
    bindings[def.id] = {
      key: def.defaultKey,
      enabled: def.defaultEnabled
    };
  }
  return {
    enabled: true,
    bindings
  };
}

export function resolveKeyboardShortcutsSettings(
  raw?: Partial<KeyboardShortcutsSettings> | null
): KeyboardShortcutsSettings {
  const defaults = getDefaultKeyboardShortcutsSettings();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const resolvedBindings = { ...defaults.bindings };
  if (raw.bindings && typeof raw.bindings === 'object') {
    for (const def of KEYBOARD_SHORTCUT_DEFINITIONS) {
      const candidate = raw.bindings[def.id];
      if (candidate && typeof candidate === 'object') {
        const normalizedCandidateKey =
          typeof candidate.key === 'string' && candidate.key.trim()
            ? normalizeKeyString(candidate.key.trim())
            : '';
        const safeKey =
          !def.fixed &&
          normalizedCandidateKey &&
          !EXPLICIT_FORBIDDEN_KEYS.has(normalizedCandidateKey.toUpperCase())
            ? normalizedCandidateKey
            : def.defaultKey;
        resolvedBindings[def.id] = {
          key: def.fixed ? def.defaultKey : safeKey,
          enabled:
            typeof candidate.enabled === 'boolean' ? candidate.enabled : def.defaultEnabled
        };
      }
    }
  }

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    bindings: resolvedBindings
  };
}

// خريطة الحروف العربية إلى مقابلاتها على لوحة مفاتيح QWERTY لضمان عمل الاختصارات حتى مع لغة الكتابة العربية
const ARABIC_CHAR_TO_LATIN: Record<string, string> = {
  ض: 'Q',
  ص: 'W',
  ث: 'E',
  ق: 'R',
  ف: 'T',
  غ: 'Y',
  ع: 'U',
  ه: 'I',
  خ: 'O',
  ح: 'P',
  ش: 'A',
  س: 'S',
  ي: 'D',
  ب: 'F',
  ل: 'G',
  ا: 'H',
  أ: 'H',
  إ: 'H',
  آ: 'N',
  ت: 'J',
  ن: 'K',
  م: 'L',
  ئ: 'Z',
  ء: 'X',
  ؤ: 'C',
  ر: 'V',
  ى: 'N',
  ة: 'M',
  و: ',',
  ز: '.',
  ظ: '/',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9'
};

export interface KeyLikeEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

export function normalizeKeyString(raw: string): string {
  const parts = raw
    .split('+')
    .map(p => p.trim())
    .filter(Boolean);
  let hasCtrl = false;
  let hasCmd = false;
  let hasAlt = false;
  let hasShift = false;
  let baseKey = '';

  for (const part of parts) {
    const upper = part.toUpperCase();
    if (upper === 'CTRL' || upper === 'CONTROL') {
      hasCtrl = true;
    } else if (upper === 'CMD' || upper === 'COMMAND' || upper === 'META') {
      hasCmd = true;
    } else if (upper === 'ALT' || upper === 'OPTION') {
      hasAlt = true;
    } else if (upper === 'SHIFT') {
      hasShift = true;
    } else if (upper === 'ESC' || upper === 'ESCAPE') {
      baseKey = 'Esc';
    } else if (upper === 'TAB') {
      baseKey = 'Tab';
    } else if (upper === 'ENTER' || upper === 'RETURN') {
      baseKey = 'Enter';
    } else if (/^F([1-9]|1[0-2])$/.test(upper)) {
      baseKey = upper;
    } else if (ARABIC_CHAR_TO_LATIN[part]) {
      baseKey = ARABIC_CHAR_TO_LATIN[part];
    } else if (part.length === 1) {
      baseKey = upper;
    } else {
      baseKey = part;
    }
  }

  const mods: string[] = [];
  if (hasCtrl) mods.push('Ctrl');
  if (hasCmd) mods.push('Cmd');
  if (hasAlt) mods.push('Alt');
  if (hasShift) mods.push('Shift');
  return baseKey ? [...mods, baseKey].join('+') : mods.join('+');
}

/**
 * تحويل حدث لوحة المفاتيح إلى صيغة قياسية مثل: F2, Ctrl+S, Alt+1, Esc
 * يعيد null إذا كان المفتاح المضغوط مجرد مفتاح معدِّل (Ctrl / Alt / Shift / Meta) بمفرده.
 */
export function formatKeyboardEventToKey(e: KeyLikeEvent): string | null {
  const rawKey = e.key || '';
  const rawCode = e.code || '';

  if (
    rawKey === 'Control' ||
    rawKey === 'Alt' ||
    rawKey === 'Shift' ||
    rawKey === 'Meta' ||
    rawKey === 'AltGraph' ||
    rawKey === 'OS'
  ) {
    return null;
  }

  let baseKey = '';

  if (rawKey === 'Escape' || rawKey === 'Esc' || rawCode === 'Escape') {
    baseKey = 'Esc';
  } else if (rawKey === 'Tab' || rawCode === 'Tab') {
    baseKey = 'Tab';
  } else if (rawKey === 'Enter' || rawCode === 'Enter' || rawCode === 'NumpadEnter') {
    baseKey = 'Enter';
  } else if (/^F([1-9]|1[0-2])$/i.test(rawKey)) {
    baseKey = rawKey.toUpperCase();
  } else if (/^F([1-9]|1[0-2])$/i.test(rawCode)) {
    baseKey = rawCode.toUpperCase();
  } else if (/^Key([A-Z])$/i.test(rawCode)) {
    baseKey = rawCode.slice(3).toUpperCase();
  } else if (/^(?:Digit|Numpad)([0-9])$/i.test(rawCode)) {
    baseKey = rawCode.replace(/^(?:Digit|Numpad)/i, '');
  } else if (ARABIC_CHAR_TO_LATIN[rawKey]) {
    baseKey = ARABIC_CHAR_TO_LATIN[rawKey];
  } else if (rawKey.length === 1) {
    baseKey = rawKey.toUpperCase();
  } else {
    baseKey = rawKey;
  }

  if (!baseKey) return null;

  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.metaKey) mods.push('Cmd');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  return [...mods, baseKey].join('+');
}

const EXPLICIT_FORBIDDEN_KEYS = new Set<string>([
  'F5',
  'F11',
  'F12',
  'CTRL+C',
  'CMD+C',
  'CTRL+W',
  'CTRL+T',
  'CTRL+N',
  'CTRL+R',
  'ALT+F4',
  'TAB',
  'ENTER',
  'ESC'
]);

const ALLOWED_STANDALONE_FUNCTION_KEYS = new Set<string>([
  'F1',
  'F2',
  'F3',
  'F4',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10'
]);

export function doScopesOverlap(scopeA: ShortcutScope, scopeB: ShortcutScope): boolean {
  if (scopeA === 'global' || scopeB === 'global') return true;
  return scopeA === scopeB;
}

export interface ShortcutValidationResult {
  valid: boolean;
  normalizedKey: string;
  error?: string;
  conflictingActionId?: KeyboardShortcutActionId;
  conflictingActionLabel?: string;
}

export function validateShortcutKeyAssignment(
  actionId: KeyboardShortcutActionId,
  candidateKey: string,
  currentSettings: KeyboardShortcutsSettings
): ShortcutValidationResult {
  const targetDef = SHORTCUT_DEFINITION_MAP[actionId];
  if (!targetDef) {
    return { valid: false, normalizedKey: candidateKey, error: 'هذا المفتاح غير متاح' };
  }
  if (targetDef.fixed) {
    return { valid: false, normalizedKey: targetDef.defaultKey, error: 'هذا المفتاح غير متاح' };
  }

  const normalizedKey = normalizeKeyString(candidateKey);
  if (!normalizedKey) {
    return { valid: false, normalizedKey: '', error: 'هذا المفتاح غير متاح' };
  }

  const upperCombo = normalizedKey.toUpperCase();

  // 1. فحص المفاتيح المحجوزة للمتصفح والنظام
  if (EXPLICIT_FORBIDDEN_KEYS.has(upperCombo)) {
    return { valid: false, normalizedKey, error: 'هذا المفتاح غير متاح' };
  }

  const parts = normalizedKey.split('+');
  const baseKey = parts[parts.length - 1];
  const upperBase = baseKey.toUpperCase();
  const hasCtrl = parts.includes('Ctrl');
  const hasAlt = parts.includes('Alt');

  // منع Tab و Enter و F5 و F11 و F12 و Esc و Space حتى مع أي مفتاح آخر
  if (
    upperBase === 'TAB' ||
    upperBase === 'ENTER' ||
    upperBase === 'F5' ||
    upperBase === 'F11' ||
    upperBase === 'F12' ||
    upperBase === 'ESC' ||
    upperBase === 'ESCAPE' ||
    upperBase === ' ' ||
    upperBase === 'SPACE'
  ) {
    return { valid: false, normalizedKey, error: 'هذا المفتاح غير متاح' };
  }

  // منع الحروف أو الأرقام أو الرموز المفردة بدون Ctrl أو Alt (يُسمح فقط بمفاتيح F1..F10 بدون F5)
  if (!hasCtrl && !hasAlt) {
    if (!ALLOWED_STANDALONE_FUNCTION_KEYS.has(upperCombo)) {
      return { valid: false, normalizedKey, error: 'هذا المفتاح غير متاح' };
    }
  } else {
    // مع Ctrl أو Alt يجب أن يكون المفتاح الأساسي حرفاً (A-Z) أو رقماً (0-9) أو مفتاح وظيفة مسموحاً (F1..F10 ما عدا Alt+F4)
    const isAlphaNum = /^[A-Z0-9]$/.test(upperBase);
    const isAllowedFn = ALLOWED_STANDALONE_FUNCTION_KEYS.has(upperBase);
    if (!isAlphaNum && !isAllowedFn) {
      return { valid: false, normalizedKey, error: 'هذا المفتاح غير متاح' };
    }
  }

  // 2. فحص عدم تكرار المفتاح في نفس النطاق
  // (يُسمح بنفس المفتاح لإجراء في نقطة البيع وإجراء لا يعمل فيها)
  for (const otherDef of KEYBOARD_SHORTCUT_DEFINITIONS) {
    if (otherDef.id === actionId) continue;
    const otherBinding = currentSettings.bindings[otherDef.id];
    const otherKey = otherDef.fixed
      ? otherDef.defaultKey
      : otherBinding?.key || otherDef.defaultKey;

    if (normalizeKeyString(otherKey).toUpperCase() === upperCombo) {
      if (doScopesOverlap(targetDef.scope, otherDef.scope)) {
        return {
          valid: false,
          normalizedKey,
          error: `المفتاح «${normalizedKey}» مستخدم بالفعل للإجراء «${otherDef.label}» في نفس النطاق`,
          conflictingActionId: otherDef.id,
          conflictingActionLabel: otherDef.label
        };
      }
    }
  }

  return {
    valid: true,
    normalizedKey
  };
}

/**
 * التحقق من صلاحية المستخدم للانتقال عبر اختصار تنقل، وإرجاع الصفحة والتبويب الهدف
 */
export function resolveNavigationShortcutTarget(
  actionId: KeyboardShortcutActionId,
  user: UserAccount | null,
  featureFlags?: FeatureModeFlags
): { allowed: boolean; page: PageType; tab?: string } | null {
  if (!user) return null;

  switch (actionId) {
    case 'nav.pos': {
      const allowed =
        isPageAllowedByFeatureModes('pos', undefined, featureFlags) &&
        (user.role === 'designer' ||
          Boolean(user.isOwner) ||
          hasPermission(user, 'invoices.create'));
      return { allowed, page: 'pos' };
    }
    case 'nav.dashboard': {
      const group = NAV_GROUPS.find(g => g.id === 'dashboard');
      const allowed = group ? isGroupVisible(group, user, featureFlags) : false;
      return { allowed, page: 'dashboard' };
    }
    case 'nav.items': {
      const allowed =
        isPageAllowedByFeatureModes('items', 'ALL', featureFlags) &&
        (user.role === 'designer' ||
          Boolean(user.isOwner) ||
          hasPermission(user, 'items.view'));
      return { allowed, page: 'items' };
    }
    case 'nav.invoices': {
      const allowed =
        isPageAllowedByFeatureModes('invoices', undefined, featureFlags) &&
        (user.role === 'designer' ||
          Boolean(user.isOwner) ||
          hasPermission(user, 'invoices.view'));
      return { allowed, page: 'invoices' };
    }
    case 'nav.customers': {
      const allowed =
        isPageAllowedByFeatureModes('customers', 'CUSTOMERS', featureFlags) &&
        (user.role === 'designer' ||
          Boolean(user.isOwner) ||
          hasPermission(user, 'customers.view'));
      return { allowed, page: 'customers', tab: 'CUSTOMERS' };
    }
    case 'nav.reports': {
      const group = NAV_GROUPS.find(g => g.id === 'reports');
      if (!group || !isGroupVisible(group, user, featureFlags)) return { allowed: false, page: 'reports' };
      const firstVisibleSub = group.subItems.find(sub => isSubItemVisible(sub, user, featureFlags));
      return {
        allowed: Boolean(firstVisibleSub),
        page: 'reports',
        tab: firstVisibleSub?.tab || 'FINANCIAL'
      };
    }
    default:
      return null;
  }
}

/**
 * خريطة مساعدة لمعرفة اختصار التنقل المرتبط بعنصر في القائمة الجانبية
 */
export function getNavShortcutActionForTarget(
  page: PageType,
  tab?: string
): KeyboardShortcutActionId | null {
  if (page === 'pos') return 'nav.pos';
  if (page === 'dashboard') return 'nav.dashboard';
  if (page === 'items' && (!tab || tab === '' || tab === 'ALL')) return 'nav.items';
  if (page === 'invoices') return 'nav.invoices';
  if (page === 'customers' && (!tab || tab === 'CUSTOMERS' || tab === 'LIST')) return 'nav.customers';
  if (page === 'reports' && (!tab || tab === 'FINANCIAL' || tab === 'OVERVIEW')) return 'nav.reports';
  return null;
}

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useState
} from 'react';
import {
  KeyboardShortcutActionId,
  KeyboardShortcutsSettings,
  PageType,
  UserAccount
} from '../types';
import type { FeatureModeFlags } from '../config/navigation';
import {
  SHORTCUT_DEFINITION_MAP,
  formatKeyboardEventToKey,
  getDefaultKeyboardShortcutsSettings,
  normalizeKeyString,
  resolveKeyboardShortcutsSettings,
  resolveNavigationShortcutTarget
} from '../utils/keyboardShortcuts';

export type ShortcutActionHandler = () => void | Promise<void> | boolean;

export type ScreenShortcutHandlers = Partial<
  Record<
    KeyboardShortcutActionId,
    | ShortcutActionHandler
    | {
        handler: ShortcutActionHandler;
        disabled?: boolean;
      }
  >
>;

export interface ModalShortcutRegistration {
  id: string;
  onClose?: () => void;
  onSave?: () => void | Promise<void>;
  closeDisabled?: boolean;
  saveDisabled?: boolean;
}

interface KeyboardShortcutsContextValue {
  settings: KeyboardShortcutsSettings;
  getShortcutKey: (actionId: KeyboardShortcutActionId) => string | null;
  isShortcutEnabled: (actionId: KeyboardShortcutActionId) => boolean;
  isCapturing: boolean;
  setIsCapturing: (capturing: boolean) => void;
  registerScreenHandlers: (id: string, getHandlers: () => ScreenShortcutHandlers) => () => void;
  registerModal: (id: string, getModal: () => Omit<ModalShortcutRegistration, 'id'>) => () => void;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue>({
  settings: getDefaultKeyboardShortcutsSettings(),
  getShortcutKey: () => null,
  isShortcutEnabled: () => false,
  isCapturing: false,
  setIsCapturing: () => {},
  registerScreenHandlers: () => () => {},
  registerModal: () => () => {}
});

export interface KeyboardShortcutsProviderProps {
  rawSettings?: Partial<KeyboardShortcutsSettings> | null;
  user: UserAccount | null;
  currentPage: PageType;
  featureFlags?: FeatureModeFlags;
  onNavigate: (page: PageType, tab?: string) => void;
  children: React.ReactNode;
}

export const KeyboardShortcutsProvider: React.FC<KeyboardShortcutsProviderProps> = ({
  rawSettings,
  user,
  currentPage,
  featureFlags,
  onNavigate,
  children
}) => {
  const settings = useMemo(
    () => resolveKeyboardShortcutsSettings(rawSettings),
    [rawSettings]
  );

  const [isCapturing, setIsCapturing] = useState(false);

  // Refs for latest state inside the single global keydown listener
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const userRef = useRef(user);
  userRef.current = user;

  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  const featureFlagsRef = useRef(featureFlags);
  featureFlagsRef.current = featureFlags;

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const isCapturingRef = useRef(isCapturing);
  isCapturingRef.current = isCapturing;

  // Guard against concurrent / duplicate execution while an async save is in flight
  const isExecutingRef = useRef(false);

  // Registered screen action layers (LIFO order)
  const screenRegistrationsRef = useRef<
    Array<{ id: string; getHandlers: () => ScreenShortcutHandlers }>
  >([]);

  // Registered open modals (LIFO stack: last is top-most open modal)
  const modalStackRef = useRef<
    Array<{ id: string; getModal: () => Omit<ModalShortcutRegistration, 'id'> }>
  >([]);

  const registerScreenHandlers = useCallback(
    (id: string, getHandlers: () => ScreenShortcutHandlers) => {
      screenRegistrationsRef.current = [
        ...screenRegistrationsRef.current.filter(r => r.id !== id),
        { id, getHandlers }
      ];
      return () => {
        screenRegistrationsRef.current = screenRegistrationsRef.current.filter(r => r.id !== id);
      };
    },
    []
  );

  const registerModal = useCallback(
    (id: string, getModal: () => Omit<ModalShortcutRegistration, 'id'>) => {
      modalStackRef.current = [
        ...modalStackRef.current.filter(m => m.id !== id),
        { id, getModal }
      ];
      return () => {
        modalStackRef.current = modalStackRef.current.filter(m => m.id !== id);
      };
    },
    []
  );

  const isShortcutEnabled = useCallback(
    (actionId: KeyboardShortcutActionId): boolean => {
      if (!user) return false;
      if (!settings.enabled) return false;
      const binding = settings.bindings[actionId];
      return Boolean(binding && binding.enabled);
    },
    [user, settings]
  );

  const getShortcutKey = useCallback(
    (actionId: KeyboardShortcutActionId): string | null => {
      if (!user) return null;
      if (!settings.enabled) return null;
      const binding = settings.bindings[actionId];
      if (!binding || !binding.enabled || !binding.key) return null;
      return binding.key;
    },
    [user, settings]
  );

  // المدير المركزي الوحيد لأحداث لوحة المفاتيح في البرنامج كله
  useEffect(() => {
    const runSafely = async (fn: ShortcutActionHandler) => {
      if (isExecutingRef.current) return;
      isExecutingRef.current = true;
      try {
        await fn();
      } finally {
        isExecutingRef.current = false;
      }
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 1. لا تعمل الاختصارات في صفحة تسجيل الدخول
      if (!userRef.current) return;

      // 2. إذا كان المستخدم يلتقط مفتاحاً جديداً في صفحة الإعدادات، يتولى وضع الالتقاط الحدث
      if (isCapturingRef.current) return;

      // 3. إذا كان المفتاح العام «تفعيل الاختصارات» مغلقاً، لا نفعل شيئاً ولا نمنع سلوك المتصفح
      const currentSettings = settingsRef.current;
      if (!currentSettings.enabled) return;

      const pressedKey = formatKeyboardEventToKey(e);
      if (!pressedKey) return;
      const upperPressed = normalizeKeyString(pressedKey).toUpperCase();
      if (upperPressed === 'CTRL+C' || upperPressed === 'CMD+C') return;

      // هل توجد نافذة منبثقة مفتوحة حالياً؟
      const modalEntries = modalStackRef.current;
      const topModalEntry =
        modalEntries.length > 0 ? modalEntries[modalEntries.length - 1] : null;
      const domDialog =
        typeof document !== 'undefined'
          ? (document.querySelector(
              '[role="dialog"][aria-modal="true"], [data-shortcut-modal="true"]'
            ) as HTMLElement | null)
          : null;
      const isModalOpen = Boolean(topModalEntry || domDialog);

      // دالة مساعدة للتحقق مما إذا كان إجراء معين مفعلاً ومطابقاً للمفتاح المضغوط
      const matchesEnabledAction = (actionId: KeyboardShortcutActionId): boolean => {
        const binding = currentSettings.bindings[actionId];
        if (!binding || !binding.enabled || !binding.key) return false;
        return normalizeKeyString(binding.key).toUpperCase() === upperPressed;
      };

      // 4. عند فتح نافذة منبثقة: يعمل فقط Ctrl+S (حفظها) و Esc (إغلاقها)، وتتوقف اختصارات التنقل ونقطة البيع حتى تُغلق
      if (isModalOpen) {
        if (matchesEnabledAction('general.close_or_back')) {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat || isExecutingRef.current) return;

          if (topModalEntry) {
            const modalProps = topModalEntry.getModal();
            if (!modalProps.closeDisabled && modalProps.onClose) {
              modalProps.onClose();
            }
          } else if (domDialog) {
            const closeBtn = domDialog.querySelector<HTMLButtonElement>(
              'button[aria-label="إغلاق"]:not(:disabled), button[data-modal-close="true"]:not(:disabled)'
            );
            closeBtn?.click();
          }
          return;
        }

        if (matchesEnabledAction('general.save_form')) {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat || isExecutingRef.current) return;

          if (topModalEntry) {
            const modalProps = topModalEntry.getModal();
            if (!modalProps.saveDisabled && modalProps.onSave) {
              void runSafely(modalProps.onSave);
              return;
            }
          }
          // في حال وجود نموذج <form> داخل النافذة المنبثقة أو زر حفظ رئيسي
          const dialogRoot =
            domDialog ||
            (typeof document !== 'undefined'
              ? (document.querySelector('[role="dialog"]') as HTMLElement | null)
              : null);
          if (dialogRoot) {
            const formEl = dialogRoot.querySelector('form');
            if (formEl) {
              if (typeof formEl.requestSubmit === 'function') {
                formEl.requestSubmit();
              } else {
                formEl.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
              }
              return;
            }
            const saveBtn = dialogRoot.querySelector<HTMLButtonElement>(
              'button[data-modal-save="true"]:not(:disabled), button[type="submit"]:not(:disabled)'
            );
            if (saveBtn) {
              saveBtn.click();
            }
          }
          return;
        }

        // إذا كان المفتاح المضغوط يطابق أحد اختصارات البرنامج الأخرى المفعلة أثناء فتح النافذة المنبثقة:
        // نمنع سلوك المتصفح الافتراضي (مثل F3 أو Ctrl+P) لكن لا ننفذ الإجراء لأن النافذة المنبثقة مفتوحة
        for (const actionId of Object.keys(currentSettings.bindings) as KeyboardShortcutActionId[]) {
          if (matchesEnabledAction(actionId)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
        return;
      }

      const activePage = currentPageRef.current;
      const isPosScreen = activePage === 'pos';

      // دالة للبحث عن معالج مسجّل من الشاشة الحالية
      const findRegisteredHandler = (
        actionId: KeyboardShortcutActionId
      ): { handler: ShortcutActionHandler; disabled?: boolean } | null => {
        const regs = screenRegistrationsRef.current;
        for (let i = regs.length - 1; i >= 0; i--) {
          const map = regs[i].getHandlers();
          const entry = map[actionId];
          if (entry) {
            if (typeof entry === 'function') {
              return { handler: entry, disabled: false };
            }
            return entry;
          }
        }
        return null;
      };

      // 5. اختصارات نقطة البيع (تعمل فقط في شاشة نقطة البيع)
      if (isPosScreen) {
        const posActions: KeyboardShortcutActionId[] = [
          'pos.save_and_print',
          'pos.save_only',
          'pos.cancel_invoice',
          'pos.focus_barcode',
          'pos.focus_search',
          'pos.focus_paid'
        ];
        for (const posActionId of posActions) {
          if (matchesEnabledAction(posActionId)) {
            e.preventDefault();
            e.stopPropagation();
            if (e.repeat || isExecutingRef.current) return;

            const reg = findRegisteredHandler(posActionId);
            if (reg && !reg.disabled) {
              void runSafely(reg.handler);
            }
            return;
          }
        }
      }

      // 6. اختصارات التنقل بين الشاشات (تحترم صلاحيات المستخدم وتأكيد التغييرات غير المحفوظة)
      const navActions: KeyboardShortcutActionId[] = [
        'nav.pos',
        'nav.dashboard',
        'nav.items',
        'nav.invoices',
        'nav.customers',
        'nav.reports'
      ];
      for (const navActionId of navActions) {
        if (matchesEnabledAction(navActionId)) {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat || isExecutingRef.current) return;

          const target = resolveNavigationShortcutTarget(navActionId, userRef.current, featureFlagsRef.current);
          if (!target || !target.allowed) {
            // المستخدم لا يملك صلاحية هذه الشاشة: لا يفعل الاختصار شيئاً
            return;
          }
          onNavigateRef.current(target.page, target.tab);
          return;
        }
      }

      // 7. اختصار Esc العام (إغلاق القوائم المنسدلة أو الرجوع إن وُجد معالج مسجل)
      if (matchesEnabledAction('general.close_or_back')) {
        const reg = findRegisteredHandler('general.close_or_back');
        if (reg && !reg.disabled) {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat || isExecutingRef.current) return;
          void runSafely(reg.handler);
          return;
        }
      }

      // 8. الاختصارات العامة خارج نقطة البيع (حفظ النموذج، إضافة جديد، البحث، الطباعة)
      if (!isPosScreen) {
        if (matchesEnabledAction('general.save_form')) {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat || isExecutingRef.current) return;

          const reg = findRegisteredHandler('general.save_form');
          if (reg) {
            if (!reg.disabled) {
              void runSafely(reg.handler);
            }
            return;
          }

          // بديل تلقائي: إذا وُجد زر حفظ أو نموذج في الشاشة المفتوحة
          const saveBtn = document.querySelector<HTMLButtonElement>(
            'button[data-shortcut-save="true"]:not(:disabled), form button[type="submit"]:not(:disabled)'
          );
          if (saveBtn) {
            saveBtn.click();
          }
          return;
        }

        if (matchesEnabledAction('general.add_new')) {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat || isExecutingRef.current) return;

          const reg = findRegisteredHandler('general.add_new');
          if (reg) {
            if (!reg.disabled) {
              void runSafely(reg.handler);
            }
            return;
          }

          const addBtn = document.querySelector<HTMLButtonElement>(
            'button[data-shortcut-add="true"]:not(:disabled)'
          );
          if (addBtn) {
            addBtn.click();
          }
          return;
        }

        if (matchesEnabledAction('general.focus_search')) {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat || isExecutingRef.current) return;

          const reg = findRegisteredHandler('general.focus_search');
          if (reg && !reg.disabled) {
            void runSafely(reg.handler);
            return;
          }

          // البحث عن أول خانة بحث مرئية في الشاشة الحالية
          const searchInputs = Array.from(
            document.querySelectorAll<HTMLInputElement>(
              'input[data-shortcut-search="true"], input[type="search"], input[placeholder*="ابحث"], input[placeholder*="بحث"]'
            )
          );
          const visibleInput = searchInputs.find(
            el => !el.disabled && !el.readOnly && el.offsetParent !== null
          );
          if (visibleInput) {
            visibleInput.focus();
            visibleInput.select();
          }
          return;
        }

        if (matchesEnabledAction('general.print_page')) {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat || isExecutingRef.current) return;

          const reg = findRegisteredHandler('general.print_page');
          if (reg) {
            if (!reg.disabled) {
              void runSafely(reg.handler);
            }
            return;
          }

          const printBtn = document.querySelector<HTMLButtonElement>(
            'button[data-shortcut-print="true"]:not(:disabled)'
          );
          if (printBtn) {
            printBtn.click();
          } else {
            window.print();
          }
          return;
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const contextValue = useMemo<KeyboardShortcutsContextValue>(
    () => ({
      settings,
      getShortcutKey,
      isShortcutEnabled,
      isCapturing,
      setIsCapturing,
      registerScreenHandlers,
      registerModal
    }),
    [
      settings,
      getShortcutKey,
      isShortcutEnabled,
      isCapturing,
      registerScreenHandlers,
      registerModal
    ]
  );

  return (
    <KeyboardShortcutsContext.Provider value={contextValue}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
};

export function useKeyboardShortcuts() {
  return useContext(KeyboardShortcutsContext);
}

/**
 * خطاف لتسجيل إجراءات الشاشة الحالية مع المدير المركزي لاختصارات لوحة المفاتيح
 */
export function useRegisterShortcuts(handlers: ScreenShortcutHandlers, active = true) {
  const { registerScreenHandlers } = useKeyboardShortcuts();
  const handlersRef = useRef<ScreenShortcutHandlers>(handlers);
  handlersRef.current = handlers;
  const idRef = useRef(`screen_${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (!active) return;
    return registerScreenHandlers(idRef.current, () => handlersRef.current);
  }, [active, registerScreenHandlers]);
}

/**
 * خطاف لتسجيل نافذة منبثقة مفتوحة: يفعّل فيها فقط Ctrl+S و Esc ويوقف اختصارات التنقل ونقطة البيع حتى تُغلق
 */
export function useModalShortcuts(options: {
  isOpen: boolean;
  onClose?: () => void;
  onSave?: () => void | Promise<void>;
  closeDisabled?: boolean;
  saveDisabled?: boolean;
}) {
  const { registerModal } = useKeyboardShortcuts();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const idRef = useRef(`modal_${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (!options.isOpen) return;
    return registerModal(idRef.current, () => ({
      onClose: optionsRef.current.onClose,
      onSave: optionsRef.current.onSave,
      closeDisabled: optionsRef.current.closeDisabled,
      saveDisabled: optionsRef.current.saveDisabled
    }));
  }, [options.isOpen, registerModal]);
}

/**
 * شارة صغيرة لعرض مفتاح الاختصار بجانب نص الزر (تختفي تلقائياً إذا عُطِّل الاختصار أو المفتاح العام)
 */
export const ShortcutBadge: React.FC<{
  actionId: KeyboardShortcutActionId;
  className?: string;
}> = ({ actionId, className = '' }) => {
  const { getShortcutKey } = useKeyboardShortcuts();
  const keyText = getShortcutKey(actionId);
  if (!keyText) return null;

  return (
    <kbd
      dir="ltr"
      aria-label={`اختصار ${SHORTCUT_DEFINITION_MAP[actionId]?.label || ''}: ${keyText}`}
      className={`no-print inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold leading-none tracking-tight bg-black/15 text-current border border-current/20 shrink-0 ${className}`.trim()}
    >
      {keyText}
    </kbd>
  );
};

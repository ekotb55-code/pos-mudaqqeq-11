/**
 * اختبار واجهة «إدخال الرصيد يدويًا» للخزن المربوطة بالبنك
 * التشغيل: npx tsx scripts/verify_manual_balance_ui.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ManualBalanceModal,
  normalizeArabicDigits,
} from '../src/components/ManualBalancePrompt.tsx';
import { Navbar } from '../src/components/Navbar.tsx';
import {
  BankLinkSection,
  MANUAL_WEEKDAY_OPTIONS,
  formatManualSchedule,
} from '../src/components/settings/BankLinkSection.tsx';
import { CashboxesPage } from '../src/pages/CashboxesPage.tsx';
import { KeyboardShortcutsProvider } from '../src/context/KeyboardShortcutsContext.tsx';
import type {
  BankLinkOverviewResponse,
  Cashbox,
  ManualBalanceAccountOverview,
  ManualBalanceEntry,
  ManualBalanceOverviewResponse,
  ManualBalanceRequest,
  SystemConfig,
  UserAccount,
} from '../src/types/index.ts';

let passed = 0;
function check(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`فشل التحقق: ${message}`);
  }
  passed += 1;
}

function makeUser(overrides: Partial<UserAccount>): UserAccount {
  return {
    id: 'u-resp-1',
    name: 'أحمد المدير',
    username: 'ahmed_mgr',
    role: 'manager',
    status: 'نشط',
    permissions: ['cashbox.view'],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const dummyConfig: SystemConfig = {
  storeName: 'متجر اختبار',
  currency: 'ج.م',
  enableDeliveryFee: false,
  persistenceMode: 'supabase',
};

const sampleCashboxes: Cashbox[] = [
  {
    id: 'cb-nbe',
    name: 'حساب البنك الأهلي',
    currency: 'ج.م',
    openingBalance: 1000,
    currentBalance: 12500,
    status: 'نشط',
    responsibleUserName: 'أحمد المدير',
  },
  {
    id: 'cb-insta',
    name: 'محفظة إنستا باي',
    currency: 'ج.م',
    openingBalance: 0,
    currentBalance: 4800,
    status: 'نشط',
    responsibleUserName: 'أحمد المدير',
  },
  {
    id: 'cb-vf',
    name: 'فودافون كاش',
    currency: 'ج.م',
    openingBalance: 0,
    currentBalance: 900,
    status: 'نشط',
    responsibleUserName: 'سارة',
  },
  {
    id: 'cb-free',
    name: 'الخزينة النقدية',
    currency: 'ج.م',
    openingBalance: 500,
    currentBalance: 1500,
    status: 'نشط',
    responsibleUserName: 'كريم',
  },
];

function makeDueRequest(overrides?: Partial<ManualBalanceRequest>): ManualBalanceRequest {
  return {
    accountId: 'mb-1',
    accountName: 'حساب البنك الأهلي يدوي',
    cashboxName: 'محفظة إنستا باي',
    kind: 'scheduled',
    mandatory: true,
    state: 'due',
    dueAt: '2026-11-19T20:00:00.000Z',
    postponedUntil: '',
    canPostpone: true,
    blocking: true,
    ...overrides,
  };
}

function makeManualEntry(overrides?: Partial<ManualBalanceEntry>): ManualBalanceEntry {
  return {
    id: 'me-1',
    accountId: 'mb-1',
    accountName: 'محفظة إنستا باي اليدوية',
    cashboxId: 'cb-insta',
    at: '2026-11-19T20:05:00.000Z',
    userId: 'u-resp-1',
    userName: 'أحمد المدير',
    kind: 'scheduled',
    enteredBalance: 4650,
    bookBalanceBefore: 4800,
    difference: -150,
    txId: 'tx-adj-1',
    reviewed: false,
    reviewedAt: '',
    reviewedBy: '',
    ...overrides,
  };
}

function makeManualAccount(overrides?: Partial<ManualBalanceAccountOverview>): ManualBalanceAccountOverview {
  const entry = makeManualEntry();
  return {
    id: 'mb-1',
    name: 'محفظة إنستا باي اليدوية',
    cashboxId: 'cb-insta',
    cashboxName: 'محفظة إنستا باي',
    cashboxMissing: false,
    responsibleUserIds: ['u-resp-1', 'u-deleted-9'],
    responsibles: [
      { id: 'u-resp-1', name: 'أحمد المدير', missing: false },
      { id: 'u-deleted-9', name: '', missing: true },
    ],
    scheduleType: 'weekdays',
    time: '22:00',
    weekdays: [0, 2, 4],
    mandatory: true,
    enabled: true,
    bookBalance: 4800,
    lastEntryAt: entry.at,
    lastBalance: entry.enteredBalance,
    sinceLastTotal: 150,
    nextDueAt: '2026-11-22T20:00:00.000Z',
    request: makeDueRequest({ accountId: 'mb-1', accountName: 'محفظة إنستا باي اليدوية' }),
    unreviewedCount: 2,
    entries: [entry],
    ...overrides,
  };
}

function makeManualOverview(): ManualBalanceOverviewResponse {
  const activeAcc = makeManualAccount();
  const pausedAcc = makeManualAccount({
    id: 'mb-2',
    name: 'حساب فودافون كاش اليدوي',
    cashboxId: 'cb-vf',
    cashboxName: 'فودافون كاش',
    scheduleType: 'daily',
    weekdays: [],
    mandatory: false,
    enabled: false,
    lastEntryAt: '',
    lastBalance: null,
    sinceLastTotal: null,
    request: makeDueRequest({
      accountId: 'mb-2',
      accountName: 'حساب فودافون كاش اليدوي',
      state: 'postponed',
      postponedUntil: '2026-11-19T21:00:00.000Z',
      canPostpone: false,
      blocking: false,
    }),
    unreviewedCount: 0,
    entries: [],
  });

  return {
    success: true,
    postponeMinutes: 60,
    accounts: [activeAcc, pausedAcc],
    alerts: [
      {
        ...makeManualEntry(),
        accountId: activeAcc.id,
        accountName: activeAcc.name,
      },
    ],
    users: [
      { id: 'u-resp-1', name: 'أحمد المدير', username: 'ahmed_mgr', role: 'manager' },
      { id: 'u-resp-2', name: 'منى المحاسبة', username: 'mona_acc', role: 'employee' },
    ],
  };
}

function makeSmsOverview(): BankLinkOverviewResponse {
  return {
    success: true,
    intakeKey: 'mq_hidden_key_test',
    intakePath: '/api/bank-link/intake',
    heartbeatPath: '/api/bank-link/heartbeat',
    canManageTemplates: false,
    devices: [],
    unknownSenders: [],
    templates: [],
    accounts: [
      {
        id: 'la-1',
        name: 'الأهلي الرئيسي',
        cashboxId: 'cb-nbe',
        cashboxName: 'حساب البنك الأهلي',
        cashboxMissing: false,
        enabled: true,
        senders: ['NBE'],
        accountSuffix: '1234',
        matchWindowMinutes: 30,
        createdAt: '2026-11-01T08:00:00.000Z',
        lastMessageAt: '',
        bankBalance: 12500,
        lastConfirmedBalance: 12500,
        bookBalance: 12500,
        pendingTotal: 0,
        entries: [],
        pending: [],
        gaps: [],
        unknownMessages: [],
      },
    ],
  };
}

function renderWithProviders(element: React.ReactElement): string {
  return renderToStaticMarkup(
    React.createElement(KeyboardShortcutsProvider, { children: element })
  );
}

function runChecks() {
  console.log('1) التحقق من تحويل الأرقام العربية ونافذة طلب الرصيد الإجبارية وغير الإجبارية...');
  check(
    normalizeArabicDigits('١٢٣٤٫٥٠') === '1234.50' && normalizeArabicDigits('۹۸٬۷۶۵') === '98765',
    'تحويل الأرقام العربية والفارسية والفاصلة العشرية إلى أرقام إنجليزية يعمل بدقة'
  );

  // نافذة إجبارية مع إمكانية التأجيل
  const mandatoryCanPostponeHtml = renderToStaticMarkup(
    React.createElement(ManualBalanceModal, {
      request: makeDueRequest({ mandatory: true, canPostpone: true }),
      onCloseDone: () => {},
    })
  );
  check(
    mandatoryCanPostponeHtml.includes('data-testid="manual-balance-modal"') &&
      mandatoryCanPostponeHtml.includes('data-mandatory="true"') &&
      !mandatoryCanPostponeHtml.includes('aria-label="إغلاق"') &&
      !mandatoryCanPostponeHtml.includes('data-testid="manual-balance-later-btn"') &&
      mandatoryCanPostponeHtml.includes('data-testid="manual-balance-postpone-btn"') &&
      mandatoryCanPostponeHtml.includes('تأجيل ساعة') &&
      mandatoryCanPostponeHtml.includes('تسجيل الرصيد') &&
      mandatoryCanPostponeHtml.includes('إدخال الرصيد إجباري لهذه الخزنة'),
    'النافذة الإجبارية لا تحتوي على زر إغلاق أو «لاحقًا» وتُظهر «تأجيل ساعة» عند canPostpone=true'
  );
  check(
    !mandatoryCanPostponeHtml.includes('4,800') &&
      !mandatoryCanPostponeHtml.includes('4800') &&
      !mandatoryCanPostponeHtml.includes('رصيد الخزنة في النظام'),
    'نافذة طلب الرصيد لا تعرض رصيد الخزنة في النظام قبل الإدخال أبدًا'
  );

  // نافذة إجبارية بعد استنفاد التأجيل (canPostpone = false)
  const mandatoryNoPostponeHtml = renderToStaticMarkup(
    React.createElement(ManualBalanceModal, {
      request: makeDueRequest({ mandatory: true, canPostpone: false }),
      onCloseDone: () => {},
    })
  );
  check(
    !mandatoryNoPostponeHtml.includes('data-testid="manual-balance-postpone-btn"') &&
      !mandatoryNoPostponeHtml.includes('تأجيل ساعة') &&
      !mandatoryNoPostponeHtml.includes('aria-label="إغلاق"') &&
      mandatoryNoPostponeHtml.includes('تم استخدام التأجيل لهذا الموعد'),
    'عند canPostpone=false يختفي زر «تأجيل ساعة» وتظهر ملاحظة استنفاد التأجيل مع بقاء النافذة الإجبارية غير قابلة للإغلاق'
  );

  // نافذة غير إجبارية
  const nonMandatoryHtml = renderToStaticMarkup(
    React.createElement(ManualBalanceModal, {
      request: makeDueRequest({ mandatory: false, canPostpone: true }),
      onCloseDone: () => {},
    })
  );
  check(
    nonMandatoryHtml.includes('aria-label="إغلاق"') &&
      nonMandatoryHtml.includes('data-testid="manual-balance-later-btn"') &&
      nonMandatoryHtml.includes('لاحقًا') &&
      nonMandatoryHtml.includes('تأجيل ساعة'),
    'النافذة غير الإجبارية تعرض زر الإغلاق وزر «لاحقًا» وزر «تأجيل ساعة»'
  );

  // نافذة الإدخال الاختياري الفوري بدون تأجيل
  const voluntaryNoPostponeHtml = renderToStaticMarkup(
    React.createElement(ManualBalanceModal, {
      request: makeDueRequest({ mandatory: false, canPostpone: true }),
      allowPostpone: false,
      voluntaryMode: true,
      onCloseDone: () => {},
    })
  );
  check(
    !voluntaryNoPostponeHtml.includes('data-testid="manual-balance-postpone-btn"') &&
      voluntaryNoPostponeHtml.includes('aria-label="إغلاق"'),
    'نافذة «إدخال الرصيد الآن» من بطاقة الحساب لا تعرض زر «تأجيل ساعة»'
  );

  console.log('2) التحقق من رسائل النتيجة الثلاث بعد الإدخال...');
  const baselineResultHtml = renderToStaticMarkup(
    React.createElement(ManualBalanceModal, {
      request: makeDueRequest({ kind: 'baseline' }),
      initialResult: makeManualEntry({ kind: 'baseline', enteredBalance: 5000, bookBalanceBefore: 0, difference: 0 }),
      onCloseDone: () => {},
    })
  );
  check(
    baselineResultHtml.includes('data-testid="manual-balance-result"') &&
      baselineResultHtml.includes('تم ضبط رصيد الخزنة على') &&
      baselineResultHtml.includes('5,000.00 ج.م') &&
      baselineResultHtml.includes('data-testid="manual-balance-done-btn"'),
    'رسالة نتيجة أول إدخال (baseline) تعرض «تم ضبط رصيد الخزنة على …» وزر «تم»'
  );

  const matchResultHtml = renderToStaticMarkup(
    React.createElement(ManualBalanceModal, {
      request: makeDueRequest(),
      initialResult: makeManualEntry({ kind: 'scheduled', enteredBalance: 4800, bookBalanceBefore: 4800, difference: 0 }),
      onCloseDone: () => {},
    })
  );
  check(
    matchResultHtml.includes('data-testid="manual-balance-result"') &&
      matchResultHtml.includes('الرصيد مطابق لرصيد النظام'),
    'رسالة نتيجة التطابق تعرض «الرصيد مطابق لرصيد النظام»'
  );

  const diffMinusHtml = renderToStaticMarkup(
    React.createElement(ManualBalanceModal, {
      request: makeDueRequest(),
      initialResult: makeManualEntry({ kind: 'scheduled', enteredBalance: 4650, bookBalanceBefore: 4800, difference: -150 }),
      onCloseDone: () => {},
    })
  );
  const diffPlusHtml = renderToStaticMarkup(
    React.createElement(ManualBalanceModal, {
      request: makeDueRequest(),
      initialResult: makeManualEntry({ kind: 'scheduled', enteredBalance: 5050, bookBalanceBefore: 4800, difference: 250 }),
      onCloseDone: () => {},
    })
  );
  check(
    diffMinusHtml.includes('data-testid="manual-balance-result-diff"') &&
      diffMinusHtml.includes('-150.00 ج.م') &&
      diffMinusHtml.includes('text-rose-700') &&
      diffMinusHtml.includes('4,800.00 ج.م') &&
      diffMinusHtml.includes('تم تسجيل الفرق على الخزنة للمراجعة وسيصل تنبيه للمالك') &&
      diffPlusHtml.includes('+250.00 ج.م') &&
      diffPlusHtml.includes('text-emerald-700'),
    'رسالة نتيجة الفرق تعرض القيمة بالإشارة واللون المناسب (أخضر للزيادة / أحمر للنقص) ورصيد النظام السابق وإشعار المالك'
  );

  console.log('3) التحقق من الشريط العلوي (Navbar): شارات المسؤول وشارة المالك...');
  const sampleAlerts = [
    { ...makeManualEntry({ id: 'a-1' }), accountId: 'mb-1', accountName: 'الأهلي' },
    { ...makeManualEntry({ id: 'a-2' }), accountId: 'mb-1', accountName: 'الأهلي' },
    { ...makeManualEntry({ id: 'a-3' }), accountId: 'mb-2', accountName: 'إنستا باي' },
  ];
  const navbarHtml = renderWithProviders(
    React.createElement(Navbar, {
      currentPage: 'pos',
      onNavigate: () => {},
      config: dummyConfig,
      user: makeUser({ isOwner: true, permissions: ['settings.bank_link'] }),
      onLogout: () => {},
      onSync: () => {},
      isSyncing: false,
      manualBalanceRequests: [
        makeDueRequest({
          accountId: 'mb-p1',
          accountName: 'الأهلي',
          state: 'postponed',
          postponedUntil: '2026-11-19T21:30:00.000Z',
        }),
        makeDueRequest({
          accountId: 'mb-d1',
          accountName: 'فودافون كاش',
          mandatory: false,
          state: 'due',
          dueAt: '2026-11-19T20:00:00.000Z',
        }),
      ],
      dismissedManualDueKeys: { 'mb-d1': '2026-11-19T20:00:00.000Z' },
      manualBalanceAlerts: sampleAlerts,
      onOpenManualBalanceRequest: () => {},
      onOpenManualBalanceAlerts: () => {},
    })
  );
  check(
    navbarHtml.includes('data-testid="navbar-manual-postponed-mb-p1"') &&
      navbarHtml.includes('رصيد الأهلي مؤجل حتى') &&
      navbarHtml.includes('data-testid="navbar-manual-due-mb-d1"') &&
      navbarHtml.includes('مطلوب رصيد فودافون كاش') &&
      navbarHtml.includes('data-testid="navbar-manual-alerts-badge"') &&
      navbarHtml.includes('3 فرق رصيد يحتاج مراجعة'),
    'الشريط العلوي يعرض شارة التأجيل وشارة الطلب غير الإجباري وشارة تنبيه المالك للفروق'
  );

  const navbarNoAlertsHtml = renderWithProviders(
    React.createElement(Navbar, {
      currentPage: 'pos',
      onNavigate: () => {},
      config: dummyConfig,
      user: makeUser({ permissions: ['cashbox.view'] }),
      onLogout: () => {},
      onSync: () => {},
      isSyncing: false,
      manualBalanceAlerts: [],
    })
  );
  check(
    !navbarNoAlertsHtml.includes('data-testid="navbar-manual-alerts-badge"'),
    'شارة فروق الرصيد للمالك تختفي عندما يكون عدد التنبيهات 0'
  );

  console.log('4) التحقق من صفحة الخزن المربوطة بالبنك: تنبيهات الفروق + النموذج اليدوي + بطاقة الحساب...');
  const bankLinkManualFormHtml = renderWithProviders(
    React.createElement(BankLinkSection, {
      cashboxes: sampleCashboxes,
      users: [makeUser({})],
      formatDateTimeCairo: (s) => String(s || '—'),
      initialOverview: makeSmsOverview(),
      initialManualOverview: makeManualOverview(),
      initialSelectedManualAccountId: 'mb-1',
      initialShowAccountForm: true,
      initialAccountMethod: 'manual',
      initialManualScheduleType: 'weekdays',
    })
  );

  check(
    bankLinkManualFormHtml.includes('data-testid="manual-balance-alerts-section"') &&
      bankLinkManualFormHtml.includes('فروق تحتاج مراجعة (1)') &&
      bankLinkManualFormHtml.includes('الفرق مسجل بالفعل كحركة على الخزنة. زر تمت المراجعة يخفي التنبيه فقط') &&
      bankLinkManualFormHtml.includes('تمت المراجعة'),
    'قسم «فروق تحتاج مراجعة» يظهر أعلى الصفحة مع الجدول والملاحظة الثابتة وزر «تمت المراجعة»'
  );

  check(
    bankLinkManualFormHtml.includes('data-testid="bank-link-method-selector"') &&
      bankLinkManualFormHtml.includes('رسائل الهاتف (تلقائي)') &&
      bankLinkManualFormHtml.includes('إدخال الرصيد يدويًا (بدون قراءة رسائل)') &&
      bankLinkManualFormHtml.includes('data-testid="manual-balance-account-form"') &&
      bankLinkManualFormHtml.includes('data-testid="manual-balance-weekdays"') &&
      MANUAL_WEEKDAY_OPTIONS.length === 7 &&
      MANUAL_WEEKDAY_OPTIONS.every((d) => bankLinkManualFormHtml.includes(d.label)) &&
      bankLinkManualFormHtml.includes('بتوقيت القاهرة') &&
      bankLinkManualFormHtml.includes('data-testid="manual-balance-mandatory-toggle"') &&
      bankLinkManualFormHtml.includes('بعد الحفظ سيُطلب من المسؤول أول رصيد فورًا ليبدأ رصيد الخزنة منه'),
    'نموذج الإضافة يتضمن اختيار طريقة المتابعة والنموذج اليدوي وأيام الأسبوع الـ 7 وخيار «إجباري» وتوقيت القاهرة والملاحظة الثابتة'
  );

  check(
    bankLinkManualFormHtml.includes('مربوطة برسائل البنك في «الأهلي الرئيسي»') &&
      bankLinkManualFormHtml.includes('متابَعة برصيد يدوي في «محفظة إنستا باي اليدوية»'),
    'قائمة الخزن في النموذج اليدوي تعطّل الخزن المربوطة برسائل البنك أو بمتابعة يدوية أخرى'
  );

  check(
    formatManualSchedule({ scheduleType: 'daily', time: '22:00', weekdays: [] }) === 'كل يوم 22:00' &&
      formatManualSchedule({ scheduleType: 'weekdays', time: '22:00', weekdays: [0, 2, 4] }) ===
        'الأحد والثلاثاء والخميس 22:00',
    'دالة تنسيق موعد المتابعة اليدوية تعرض اليومي وأيام الأسبوع بشكل صحيح'
  );

  check(
    bankLinkManualFormHtml.includes('data-testid="manual-balance-account-card-mb-1"') &&
      bankLinkManualFormHtml.includes('data-testid="manual-balance-card-badge"') &&
      bankLinkManualFormHtml.includes('رصيد يدوي') &&
      bankLinkManualFormHtml.includes('مستخدم محذوف') &&
      bankLinkManualFormHtml.includes('الأحد والثلاثاء والخميس 22:00') &&
      bankLinkManualFormHtml.includes('data-testid="manual-balance-three-metrics"') &&
      bankLinkManualFormHtml.includes('آخر رصيد كتبه المسؤول') &&
      bankLinkManualFormHtml.includes('حركات النظام بعده') &&
      bankLinkManualFormHtml.includes('رصيد الخزنة في النظام') &&
      bankLinkManualFormHtml.includes('مطلوب الآن') &&
      bankLinkManualFormHtml.includes('مؤجل حتى') &&
      bankLinkManualFormHtml.includes('2 فرق لم يُراجَع') &&
      bankLinkManualFormHtml.includes('إدخال الرصيد الآن') &&
      bankLinkManualFormHtml.includes('حذف المتابعة') &&
      bankLinkManualFormHtml.includes('data-testid="manual-balance-log-table-mb-1"'),
    'بطاقة الحساب اليدوي تعرض الشارة والمسؤولين (ومستخدم محذوف بالأحمر) والأرقام الثلاثة وحالة الطلب والفروق والأزرار وجدول السجل'
  );

  console.log('5) التحقق من شارة الخزن في CashboxesPage وربط App.tsx و client.ts...');
  const cashboxesOwnerHtml = renderWithProviders(
    React.createElement(CashboxesPage, {
      user: makeUser({ permissions: ['settings.bank_link'] }),
      userRole: 'manager',
      initialTab: 'CASHBOXES',
      initialCashboxes: sampleCashboxes,
      initialManualBalanceAccounts: [
        { id: 'mb-1', cashboxId: 'cb-insta', name: 'محفظة إنستا باي اليدوية', enabled: true },
        { id: 'mb-2', cashboxId: 'cb-vf', name: 'حساب فودافون كاش اليدوي', enabled: false },
      ],
    })
  );
  check(
    cashboxesOwnerHtml.includes('متابعة برصيد يدوي') &&
      cashboxesOwnerHtml.includes('المتابعة موقوفة') &&
      cashboxesOwnerHtml.includes('تفاصيل المتابعة'),
    'صفحة الخزن تعرض «متابعة برصيد يدوي» و«المتابعة موقوفة» ورابط «تفاصيل المتابعة» لصاحب الصلاحية'
  );

  const cashboxesCashierHtml = renderWithProviders(
    React.createElement(CashboxesPage, {
      user: makeUser({ permissions: ['cashbox.view'] }),
      userRole: 'employee',
      initialTab: 'CASHBOXES',
      initialCashboxes: sampleCashboxes,
      initialManualBalanceAccounts: [
        { id: 'mb-1', cashboxId: 'cb-insta', name: 'محفظة إنستا باي اليدوية', enabled: true },
      ],
    })
  );
  check(
    cashboxesCashierHtml.includes('متابعة برصيد يدوي') &&
      !cashboxesCashierHtml.includes('تفاصيل المتابعة'),
    'في صفحة الخزن لا يظهر رابط «تفاصيل المتابعة» لمن لا يملك صلاحية settings.bank_link'
  );

  const clientSrc = fs.readFileSync(path.resolve('src/api/client.ts'), 'utf8');
  for (const needle of [
    '/api/bank-link/balance-requests',
    '/submit',
    '/postpone',
    '/api/bank-link/manual/overview',
    '/api/bank-link/manual/accounts',
    '/enabled',
    '/api/bank-link/manual/entries/',
    '/reviewed',
    'BALANCE_REQUIRED',
    'res.status === 423',
    'MANUAL_BALANCE_UPDATED',
  ]) {
    check(clientSrc.includes(needle), `client.ts يحتوي على ${needle}`);
  }

  const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  for (const needle of [
    'ManualBalanceModal',
    'getManualBalanceRequests',
    'BALANCE_REQUIRED',
    'MANUAL_BALANCE_UPDATED',
    'visibilitychange',
    '60_000',
  ]) {
    check(appSrc.includes(needle), `App.tsx يحتوي على ${needle}`);
  }

  // شاشة النتيجة تبقى ظاهرة بعد تسجيل الرصيد، والرقم المكتوب لا يُمسح في الإدخال الاختياري
  for (const needle of [
    'manualBalanceResultHold?.request ||',
    'initialResult={manualBalanceResultHold?.entry || null}',
    'setManualBalanceResultHold({ request: activeManualRequest, entry })',
    'setManualBalanceResultHold(null)'
  ]) {
    check(appSrc.includes(needle), `App.tsx يحتوي على ${needle}`);
  }
  const promptSrc = fs.readFileSync(path.resolve('src/components/ManualBalancePrompt.tsx'), 'utf8');
  check(promptSrc.includes("voluntaryMode ? 'voluntary' : request.dueAt"), 'مفتاح إعادة التهيئة لا يعتمد على وقت الطلب في الإدخال الاختياري');
  check(!promptSrc.includes('[request.accountId, request.dueAt, initialResult]'), 'لا إعادة تهيئة للنافذة مع كل إعادة رسم');

  console.log(`\n🎉 نجحت جميع اختبارات واجهة إدخال الرصيد يدويًا (${passed} تحققًا).`);
}

runChecks();

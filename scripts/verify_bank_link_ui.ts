/**
 * اختبار واجهة «الخزن المربوطة بالبنك» وقوالب الرسائل وشارات صفحة الخزن
 * التشغيل: npx tsx scripts/verify_bank_link_ui.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ALL_NAV_SUB_ITEMS,
  NAV_GROUPS,
  isGroupVisible,
  isSubItemVisible,
} from '../src/config/navigation.ts';
import {
  BankLinkSection,
  TEMPLATE_SLOT_BUTTONS,
} from '../src/components/settings/BankLinkSection.tsx';
import { SettingsPage } from '../src/pages/SettingsPage.tsx';
import { CashboxesPage } from '../src/pages/CashboxesPage.tsx';
import { KeyboardShortcutsProvider } from '../src/context/KeyboardShortcutsContext.tsx';
import type {
  BankLinkOverviewResponse,
  Cashbox,
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
    id: 'u-test',
    name: 'مستخدم اختبار',
    username: 'test_user',
    role: 'employee',
    status: 'نشط',
    permissions: [],
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
    currentBalance: 4500,
    status: 'نشط',
    responsibleUserName: 'أحمد',
  },
  {
    id: 'cb-vf',
    name: 'فودافون كاش',
    currency: 'ج.م',
    openingBalance: 0,
    currentBalance: 850,
    status: 'نشط',
    responsibleUserName: 'محمد',
  },
  {
    id: 'cb-free',
    name: 'الخزينة النقدية',
    currency: 'ج.م',
    openingBalance: 500,
    currentBalance: 1200,
    status: 'نشط',
    responsibleUserName: 'كريم',
  },
];

const SECRET_INTAKE_KEY = 'mq_secret_test_key_never_show_by_default_999';

function makeSampleOverview(overrides?: Partial<BankLinkOverviewResponse>): BankLinkOverviewResponse {
  return {
    success: true,
    intakeKey: SECRET_INTAKE_KEY,
    intakePath: '/api/bank-link/intake',
    heartbeatPath: '/api/bank-link/heartbeat',
    canManageTemplates: true,
    devices: [
      {
        id: 'samsung-shop-1',
        lastSeenAt: '2026-11-19T09:00:00.000Z',
        battery: 78,
        online: false,
      },
    ],
    unknownSenders: [
      {
        sender: 'InstaPay-EG',
        count: 4,
        lastAt: '2026-11-19T09:10:00.000Z',
      },
    ],
    templates: [
      {
        id: 'tpl-1',
        name: 'قالب البنك الأهلي',
        sender: 'NBE',
        pattern: 'تم إيداع {المبلغ} ج.م الرصيد {الرصيد} ج.م',
        direction: 'in',
        enabled: true,
      },
    ],
    accounts: [
      {
        id: 'la-1',
        name: 'الأهلي الرئيسي',
        cashboxId: 'cb-nbe',
        cashboxName: 'حساب البنك الأهلي',
        cashboxMissing: false,
        enabled: true,
        senders: ['NBE', 'AlAhly'],
        accountSuffix: '1234',
        matchWindowMinutes: 30,
        createdAt: '2026-11-01T08:00:00.000Z',
        lastMessageAt: '2026-11-19T09:15:00.000Z',
        bankBalance: 4200,
        lastConfirmedBalance: 4200,
        bookBalance: 4500,
        pendingTotal: 300,
        entries: [
          {
            messageId: 'm-1',
            mergedMessageIds: [],
            sender: 'NBE',
            at: '2026-11-19T09:15:00.000Z',
            direction: 'in',
            amount: 500,
            fee: 5,
            balanceAfter: 4200,
            counterparty: 'شركة النور',
            reference: 'REF-100',
            verifiedBy: 'balance',
            corrections: ['تم تصحيح الاتجاه تلقائيًا من معادلة الرصيد'],
            state: 'matched',
            stateLabel: 'مطابقة لحركة في النظام',
            matchedTxId: 'tx-1',
            createdTxId: '',
          },
        ],
        pending: [
          {
            id: 'tx-p1',
            date: '2026-11-19T08:00:00.000Z',
            amount: 300,
            statement: 'فاتورة بيع تحويل INV-44',
            documentNumber: 'INV-44',
            userName: 'سارة',
            overdue: true,
          },
        ],
        gaps: [
          {
            beforeMessageId: 'm-1',
            at: '2026-11-19T08:30:00.000Z',
            amount: 150,
          },
        ],
        unknownMessages: [
          {
            messageId: 'm-unk-1',
            note: 'رسالة تبدو حركة مالية لكن لم يُعثر فيها على مبلغ',
          },
        ],
      },
      {
        id: 'la-2',
        name: 'محفظة المتجر',
        cashboxId: 'cb-vf',
        cashboxName: 'فودافون كاش',
        cashboxMissing: false,
        enabled: false,
        senders: ['VF-Cash'],
        accountSuffix: '',
        matchWindowMinutes: 30,
        createdAt: '2026-11-02T08:00:00.000Z',
        lastMessageAt: '',
        bankBalance: null,
        lastConfirmedBalance: null,
        bookBalance: 850,
        pendingTotal: 0,
        entries: [],
        pending: [],
        gaps: [],
        unknownMessages: [],
      },
    ],
    ...overrides,
  };
}

function renderWithProviders(element: React.ReactElement): string {
  return renderToStaticMarkup(
    React.createElement(KeyboardShortcutsProvider, { children: element })
  );
}

function runChecks() {
  console.log('1) التحقق من صلاحيات القائمة الجانبية وصفحة الإعدادات...');
  const settingsGroup = NAV_GROUPS.find((g) => g.id === 'settings')!;
  const bankLinkSubItem = ALL_NAV_SUB_ITEMS.find((s) => s.id === 'settings-bank-link')!;
  check(Boolean(bankLinkSubItem) && bankLinkSubItem.labelAr === 'الخزن المربوطة بالبنك', 'عنصر القائمة «الخزن المربوطة بالبنك» معرّف في navigation.ts');

  const userBankLinkOnly = makeUser({ id: 'u-bl', permissions: ['settings.bank_link'] });
  const userTemplatesOnly = makeUser({ id: 'u-tpl', permissions: ['settings.bank_templates'] });
  const userBoth = makeUser({ id: 'u-both', permissions: ['settings.bank_link', 'settings.bank_templates'] });
  const userNone = makeUser({ id: 'u-none', permissions: ['cashbox.view'] });
  const ownerUser = makeUser({ id: 'u-owner', role: 'designer', isOwner: true, permissions: [] });

  check(
    isGroupVisible(settingsGroup, userBankLinkOnly) && isSubItemVisible(bankLinkSubItem, userBankLinkOnly),
    'صاحب settings.bank_link يرى مجموعة الإعدادات وصفحة الخزن المربوطة بالبنك'
  );
  check(
    !isSubItemVisible(bankLinkSubItem, userNone) && !isSubItemVisible(bankLinkSubItem, userTemplatesOnly),
    'من لا يملك settings.bank_link لا يرى صفحة الخزن المربوطة بالبنك في القائمة'
  );
  check(
    isSubItemVisible(bankLinkSubItem, ownerUser),
    'مالك النظام يرى صفحة الخزن المربوطة بالبنك'
  );

  const settingsWithPermHtml = renderWithProviders(
    React.createElement(SettingsPage, {
      config: dummyConfig,
      users: [userBankLinkOnly],
      currentUser: userBankLinkOnly,
      onSaveUser: async () => ({ success: true }),
      onSyncAll: async () => {},
      initialTab: 'bank_link',
    })
  );
  check(
    settingsWithPermHtml.includes('id="settings-bank-link-section"') &&
      settingsWithPermHtml.includes('الخزن المربوطة بالبنك'),
    'SettingsPage يعرض قسم الخزن المربوطة بالبنك عند توفر الصلاحية settings.bank_link'
  );

  const settingsNoPermHtml = renderWithProviders(
    React.createElement(SettingsPage, {
      config: dummyConfig,
      users: [userNone],
      currentUser: userNone,
      onSaveUser: async () => ({ success: true }),
      onSyncAll: async () => {},
      initialTab: 'bank_link',
    })
  );
  check(
    !settingsNoPermHtml.includes('id="settings-bank-link-section"'),
    'SettingsPage لا يعرض قسم الخزن المربوطة بالبنك لمن يفتقر لصلاحية settings.bank_link'
  );

  console.log('2) التحقق من قسم القوالب حسب صلاحية settings.bank_templates...');
  const noTemplatesHtml = renderWithProviders(
    React.createElement(BankLinkSection, {
      cashboxes: sampleCashboxes,
      formatDateTimeCairo: (s) => String(s || '—'),
      initialOverview: makeSampleOverview({ canManageTemplates: false, templates: [] }),
      initialSelectedAccountId: 'la-1',
      initialDetailTab: 'all',
    })
  );
  check(
    !noTemplatesHtml.includes('data-testid="bank-link-templates-section"') &&
      !noTemplatesHtml.includes('عرّف قالبًا'),
    'بدون settings.bank_templates يختفي قسم القوالب وزر «عرّف قالبًا» تمامًا'
  );

  const withTemplatesHtml = renderWithProviders(
    React.createElement(BankLinkSection, {
      cashboxes: sampleCashboxes,
      formatDateTimeCairo: (s) => String(s || '—'),
      initialOverview: makeSampleOverview({ canManageTemplates: true }),
      initialSelectedAccountId: 'la-1',
      initialDetailTab: 'all',
      initialShowAccountForm: true,
      initialShowTemplateEditor: true,
    })
  );
  check(
    withTemplatesHtml.includes('data-testid="bank-link-templates-section"') &&
      withTemplatesHtml.includes('عرّف قالبًا') &&
      withTemplatesHtml.includes('تصدير القوالب') &&
      withTemplatesHtml.includes('استيراد قوالب'),
    'مع settings.bank_templates يظهر قسم القوالب وزر «عرّف قالبًا» وأزرار التصدير والاستيراد'
  );

  console.log('3) التحقق من شريط الهاتف، بطاقة الحساب، الأرقام الثلاثة، والتفاصيل الأربع...');
  check(
    withTemplatesHtml.includes('data-testid="bank-link-phone-offline-warning"') &&
      withTemplatesHtml.includes('هاتف استقبال الرسائل غير متصل — التحويلات لن تُسجَّل تلقائيًا حتى يعود') &&
      withTemplatesHtml.includes('samsung-shop-1') &&
      withTemplatesHtml.includes('78%'),
    'شريط حالة الهاتف يعرض الأجهزة والبطارية وتحذير عدم الاتصال عند وجود حساب مفعّل'
  );

  const onlinePhoneHtml = renderWithProviders(
    React.createElement(BankLinkSection, {
      cashboxes: sampleCashboxes,
      formatDateTimeCairo: (s) => String(s || '—'),
      initialOverview: makeSampleOverview({
        devices: [{ id: 'samsung-shop-1', lastSeenAt: '2026-11-19T09:15:00.000Z', battery: 92, online: true }],
      }),
    })
  );
  check(
    !onlinePhoneHtml.includes('data-testid="bank-link-phone-offline-warning"') &&
      onlinePhoneHtml.includes('متصل'),
    'عند وجود هاتف متصل يختفي تحذير الانقطاع وتظهر حالة «متصل»'
  );

  check(
    withTemplatesHtml.includes('data-testid="bank-link-toggle-enabled"') &&
      withTemplatesHtml.includes('مفعّل') &&
      withTemplatesHtml.includes('موقوف'),
    'زر التفعيل/الإيقاف الكبير موجود ويعرض حالتي «مفعّل» و«موقوف»'
  );

  check(
    withTemplatesHtml.includes('data-testid="bank-link-three-metrics"') &&
      withTemplatesHtml.includes('رصيد البنك (من آخر رسالة)') &&
      withTemplatesHtml.includes('معلّق لم تصل رسالته') &&
      withTemplatesHtml.includes('رصيد الخزنة في النظام') &&
      withTemplatesHtml.includes('رصيد الخزنة = رصيد البنك + المعلّق') &&
      withTemplatesHtml.includes('يوجد فرق غير مفسَّر (رسالة بنك ناقصة)'),
    'الأرقام الثلاثة البارزة والسطر التوضيحي وشارة تحذير الفروق موجودة في بطاقة الحساب'
  );

  check(
    withTemplatesHtml.includes('data-testid="bank-link-detail-entries"') &&
      withTemplatesHtml.includes('حركات البنك') &&
      withTemplatesHtml.includes('مطابقة لحركة في النظام') &&
      withTemplatesHtml.includes('مؤكدة بالرصيد') &&
      withTemplatesHtml.includes('تصحيح تلقائي') &&
      withTemplatesHtml.includes('data-testid="bank-link-detail-pending"') &&
      withTemplatesHtml.includes('في انتظار رسالة البنك') &&
      withTemplatesHtml.includes('لم يصل التحويل') &&
      withTemplatesHtml.includes('data-testid="bank-link-detail-gaps"') &&
      withTemplatesHtml.includes('فروق غير مفسَّرة') &&
      withTemplatesHtml.includes('دخل غير مسجل') &&
      withTemplatesHtml.includes('data-testid="bank-link-detail-unknown"') &&
      withTemplatesHtml.includes('رسائل تحتاج تعريف'),
    'أقسام التفاصيل الأربعة (حركات البنك، في انتظار رسالة البنك، فروق غير مفسَّرة، رسائل تحتاج تعريف) مكتملة'
  );

  console.log('4) التحقق من نموذج الإضافة وصندوق تجهيز الهاتف وأزرار الخانات السبع...');
  check(
    withTemplatesHtml.includes('data-testid="bank-link-account-form"') &&
      withTemplatesHtml.includes('مرسلون وصلت منهم رسائل ولم يُربطوا') &&
      withTemplatesHtml.includes('InstaPay-EG') &&
      withTemplatesHtml.includes('مطلوب لو نفس البنك يرسل لأكثر من حساب عندك') &&
      withTemplatesHtml.includes('أقصى فرق زمني بين تسجيل الحركة في النظام ووصول رسالة البنك لتُعتبرا حركة واحدة'),
    'نموذج الإضافة/التعديل يعرض المرسلين غير المربوطين والتوضيحات المطلوبة'
  );

  check(
    withTemplatesHtml.includes('data-testid="bank-link-phone-setup"') &&
      withTemplatesHtml.includes('تجهيز هاتف استقبال الرسائل') &&
      withTemplatesHtml.includes('/api/bank-link/intake') &&
      withTemplatesHtml.includes('/api/bank-link/heartbeat') &&
      withTemplatesHtml.includes('توليد مفتاح جديد') &&
      withTemplatesHtml.includes('x-intake-key') &&
      withTemplatesHtml.includes('الرسائل من مرسلين غير مربوطين لا يُحفظ نصها') &&
      !withTemplatesHtml.includes(SECRET_INTAKE_KEY),
    'صندوق تجهيز الهاتف موجود ومفتاح الاستقبال مخفي افتراضيًا ولا يظهر نصه الصريح'
  );

  const expectedSlots = ['{المبلغ}', '{الرصيد}', '{الحساب}', '{الاسم}', '{المرجع}', '{الرسوم}', '{تجاهل}'];
  check(
    TEMPLATE_SLOT_BUTTONS.length === 7 &&
      expectedSlots.every((slot) => withTemplatesHtml.includes(slot)) &&
      withTemplatesHtml.includes('الصق رسالة حقيقية') &&
      withTemplatesHtml.includes('اقترح قالبًا') &&
      withTemplatesHtml.includes('الخانتان الأساسيتان: {المبلغ} و{الرصيد}') &&
      withTemplatesHtml.includes('data-testid="bank-link-template-test"'),
    'محرر القالب يحتوي على أزرار الخانات السبع والاقتراح والتجربة والتنبيه الثابت'
  );

  console.log('5) التحقق من صفحة الخزن الحالية وملف client.ts...');
  const cashboxesWithPermHtml = renderWithProviders(
    React.createElement(CashboxesPage, {
      user: userBoth,
      userRole: 'manager',
      initialTab: 'CASHBOXES',
      initialCashboxes: sampleCashboxes,
      initialBankLinkedAccounts: [
        { id: 'la-1', cashboxId: 'cb-nbe', name: 'الأهلي الرئيسي', enabled: true },
        { id: 'la-2', cashboxId: 'cb-vf', name: 'محفظة المتجر', enabled: false },
      ],
    })
  );
  check(
    cashboxesWithPermHtml.includes('مربوطة برسائل البنك') &&
      cashboxesWithPermHtml.includes('الربط موقوف') &&
      cashboxesWithPermHtml.includes('تفاصيل الربط'),
    'صفحة الخزن تعرض شارة «مربوطة برسائل البنك» و«الربط موقوف» ورابط «تفاصيل الربط» لمن معه settings.bank_link'
  );

  const cashboxesNoPermHtml = renderWithProviders(
    React.createElement(CashboxesPage, {
      user: userNone,
      userRole: 'employee',
      initialTab: 'CASHBOXES',
      initialCashboxes: sampleCashboxes,
      initialBankLinkedAccounts: [
        { id: 'la-1', cashboxId: 'cb-nbe', name: 'الأهلي الرئيسي', enabled: true },
      ],
    })
  );
  check(
    cashboxesNoPermHtml.includes('مربوطة برسائل البنك') && !cashboxesNoPermHtml.includes('تفاصيل الربط'),
    'في صفحة الخزن لا يظهر رابط تفاصيل الربط لمن لا يملك settings.bank_link'
  );

  const clientSource = fs.readFileSync(path.resolve('src/api/client.ts'), 'utf8');
  for (const endpoint of [
    '/api/bank-link/overview',
    '/api/bank-link/accounts',
    '/enabled',
    '/api/bank-link/intake-key/regenerate',
    '/api/bank-link/templates',
    '/api/bank-link/templates/suggest',
    '/api/bank-link/templates/test',
    '/api/bank-link/templates/export',
    '/api/bank-link/templates/import',
    '/api/bank-link/messages/',
  ]) {
    check(clientSource.includes(endpoint), `client.ts يحتوي على مسار ${endpoint}`);
  }

  console.log(`\n🎉 نجحت جميع اختبارات واجهة الخزن المربوطة بالبنك (${passed} تحققًا).`);
}

runChecks();

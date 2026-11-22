/**
 * اختبار وحدة الخزن المربوطة برسائل البنك (server/linkedAccounts.ts)
 * التشغيل:  npx tsx scripts/verify_linked_accounts.ts
 */
import { LinkedAccounts, LinkedAccountsError } from '../server/linkedAccounts.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

function expectError(fn: () => unknown, code: LinkedAccountsError['code'], label: string) {
  let caught: any = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert(
    caught instanceof LinkedAccountsError && caught.code === code && /[\u0600-\u06FF]/.test(caught.message),
    label
  );
}

function run() {
  let nowMs = Date.parse('2026-11-19T10:00:00.000Z');
  const cashboxes: any[] = [
    { id: 'cb-bank1', name: 'حساب البنك الأهلي', currentBalance: 200 },
    { id: 'cb-bank2', name: 'حساب البنك الثانوي', currentBalance: 0 },
    { id: 'cb-wallet', name: 'فودافون كاش', currentBalance: 500 }
  ];
  const cashboxTransactions: any[] = [];

  const la = new LinkedAccounts({
    getCashboxes: () => cashboxes,
    getCashboxTransactions: () => cashboxTransactions,
    now: () => new Date(nowMs)
  });

  // 1) مفتاح الاستقبال
  const k1 = la.getIntakeKey();
  assert(k1.startsWith('mq_') && k1.length > 20, 'توليد مفتاح استقبال صالح');
  assert(la.getIntakeKey() === k1, 'ثبات مفتاح الاستقبال بين الاستدعاءات');
  assert(la.isValidIntakeKey(k1) && !la.isValidIntakeKey('') && !la.isValidIntakeKey('wrong'), 'التحقق من صحة مفتاح الاستقبال');
  const k2 = la.regenerateIntakeKey();
  assert(k2 !== k1 && la.isValidIntakeKey(k2) && !la.isValidIntakeKey(k1), 'تجديد مفتاح الاستقبال يُبطل القديم');

  // 2) التحقق من صحة مدخلات الحساب المربوط
  expectError(() => la.saveAccount({ name: '  ', cashboxId: 'cb-bank1', senders: ['NBE'] }), 'INVALID_INPUT', 'رفض حساب بدون اسم برسالة عربية');
  expectError(() => la.saveAccount({ name: 'بنك', cashboxId: 'cb-missing', senders: ['NBE'] }), 'INVALID_INPUT', 'رفض خزنة غير موجودة');
  expectError(() => la.saveAccount({ name: 'بنك', cashboxId: 'cb-bank1', senders: [] }), 'INVALID_INPUT', 'رفض حساب بدون مرسلين');

  // 3) إنشاء الحسابات وقواعد عدم التعارض
  const acc1 = la.saveAccount({ name: 'الأهلي الرئيسي', cashboxId: 'cb-bank1', senders: ['NBE', 'AlAhly'], accountSuffix: '1234', matchWindowMinutes: 30 });
  assert(acc1.id.startsWith('la-') && acc1.enabled === true && acc1.matchWindowMinutes === 30, 'إنشاء حساب مربوط بنجاح');
  assert(la.listAccounts().length === 1, 'قائمة الحسابات تحتوي الحساب المنشأ');

  expectError(
    () => la.saveAccount({ name: 'مكرر', cashboxId: 'cb-bank1', senders: ['OtherBank'] }),
    'INVALID_INPUT',
    'منع ربط نفس الخزنة بحسابين'
  );
  expectError(
    () => la.saveAccount({ name: 'الأهلي 2', cashboxId: 'cb-bank2', senders: ['NBE'], accountSuffix: '1234' }),
    'INVALID_INPUT',
    'منع مشاركة نفس المرسل بنفس آخر أرقام الحساب'
  );
  const acc2 = la.saveAccount({ name: 'الأهلي الفرعي', cashboxId: 'cb-bank2', senders: ['NBE'], accountSuffix: '5678' });
  assert(acc2.accountSuffix === '5678', 'السماح بمشاركة المرسل عند اختلاف آخر أرقام الحساب');

  const accWallet = la.saveAccount({ name: 'محفظة المتجر', cashboxId: 'cb-wallet', senders: ['VF-Cash'] });
  assert(la.listAccounts().length === 3, 'إضافة حساب محفظة ثالث');

  // 4) استقبال الرسائل: حالات الرفض والتوجيه
  const emptyRes = la.intake({ sender: '', text: 'test' });
  assert(emptyRes.status === 'empty', 'رسالة بدون مرسل تعود empty');

  const unknownRes = la.intake({ sender: 'FriendSMS', text: 'السلام عليكم' });
  assert(unknownRes.status === 'unknown_sender', 'مرسل غير معروف يعود unknown_sender');
  assert(la.getOverview().unknownSenders.length === 1 && la.getOverview().unknownSenders[0].sender === 'FriendSMS', 'تسجيل اسم المرسل غير المعروف فقط');

  const otpRes = la.intake({ sender: 'VF-Cash', text: 'كود التحقق OTP الخاص بك هو 849201 لا تشاركه مع أحد' });
  assert(otpRes.status === 'ignored', 'رسالة رمز التحقق تُتجاهل ولا تُسجَّل');

  const ambRes = la.intake({ sender: 'NBE', text: 'تم إيداع 100 ج.م في حسابك والرصيد 1100 ج.م' });
  assert(ambRes.status === 'ambiguous', 'رسالة لمرسل مشترك بدون رقم حساب تعود ambiguous');

  // إيقاف حساب يمنع استقبال رسائله
  la.setAccountEnabled(acc2.id, false);
  const disRes = la.intake({ sender: 'NBE', text: 'تم إيداع 100 ج.م في حساب رقم **5678 والرصيد 100 ج.م' });
  assert(disRes.status === 'disabled' && disRes.accountId === acc2.id, 'الحساب الموقوف يرفض الاستقبال');
  la.setAccountEnabled(acc2.id, true);

  // 5) رصيد بدء الربط (baseline) + التكرار
  const t1 = '2026-11-19T10:00:00.000Z';
  const baseRes = la.intake({
    sender: 'VF-Cash',
    text: 'تم استلام مبلغ 100 ج.م رصيدك الحالي 1000 ج.م',
    at: t1,
    deviceId: 'phone-main',
    battery: 87
  });
  assert(baseRes.status === 'recorded' && baseRes.accountId === accWallet.id, 'تسجيل أول رسالة لبدء الربط');
  assert(cashboxes[2].currentBalance === 1000, 'مطابقة رصيد الخزنة تلقائيًا مع رصيد البنك عند بدء الربط');
  assert(cashboxTransactions.length === 1 && cashboxTransactions[0].amount === 500, 'تسجيل قيد فرق مطابقة بدء الربط (1000 - 500 = 500)');

  const dupRes = la.intake({
    sender: 'VF-Cash',
    text: 'تم استلام مبلغ 100 ج.م رصيدك الحالي 1000 ج.م',
    at: t1
  });
  assert(dupRes.status === 'duplicate', 'منع تكرار نفس الرسالة');
  assert(cashboxes[2].currentBalance === 1000 && cashboxTransactions.length === 1, 'التكرار لا يضيف قيدًا للخزنة');

  // 6) منع تغيير الخزنة بعد تسجيل حركات
  expectError(
    () => la.saveAccount({ id: accWallet.id, name: 'محفظة المتجر', cashboxId: 'cb-bank2', senders: ['VF-Cash'] }),
    'INVALID_INPUT',
    'منع تغيير الخزنة بعد وجود تسجيلات'
  );

  // 7) تحويل وارد غير مصنف (بدون حركة نظام مقابلة)
  nowMs = Date.parse('2026-11-19T10:05:00.000Z');
  const inRes = la.intake({
    sender: 'VF-Cash',
    text: 'تم استلام مبلغ 250 ج.م من 01012345678 رصيدك الحالي 1250 ج.م',
    at: '2026-11-19T10:05:00.000Z'
  });
  assert(inRes.status === 'recorded', 'تسجيل تحويل وارد غير مصنف');
  assert(cashboxes[2].currentBalance === 1250, 'تحديث رصيد الخزنة بعد التحويل الوارد');

  // 8) مطابقة حركة نظام موجودة في الخزنة خلال نافذة المطابقة (لا تُسجل مرتين)
  cashboxTransactions.push({
    id: 'sys-tx-1',
    date: '2026-11-19T10:12:00.000Z',
    cashboxId: 'cb-wallet',
    cashboxName: 'فودافون كاش',
    type: 'إيداع',
    documentNumber: 'INV-100',
    amount: 300,
    balanceAfter: 1550,
    party: 'عميل نقدي',
    statement: 'فاتورة بيع INV-100',
    userName: 'أحمد',
    notes: ''
  });
  cashboxes[2].currentBalance = 1550;

  nowMs = Date.parse('2026-11-19T10:15:00.000Z');
  const matchRes = la.intake({
    sender: 'VF-Cash',
    text: 'تم استلام مبلغ 300 ج.م رصيدك الحالي 1550 ج.م',
    at: '2026-11-19T10:15:00.000Z'
  });
  assert(matchRes.status === 'recorded', 'استقبال رسالة مطابقة لحركة نظام');
  assert(cashboxes[2].currentBalance === 1550, 'عدم تكرار إضافة المبلغ عند مطابقة حركة النظام');
  const walletOv1 = la.getOverview().accounts.find(a => a.id === accWallet.id)!;
  assert(walletOv1.entries[0].state === 'matched' && walletOv1.entries[0].matchedTxId === 'sys-tx-1', 'تحديد حالة الرسالة كمطابقة لحركة النظام');

  // 9) سحب مع رسوم + حركة نظام معلّقة لم تصل رسالتها بعد
  nowMs = Date.parse('2026-11-19T10:20:00.000Z');
  la.intake({
    sender: 'VF-Cash',
    text: 'تم تحويل مبلغ 200 ج.م برسوم 5 ج.م رصيدك الحالي 1345 ج.م',
    at: '2026-11-19T10:20:00.000Z'
  });
  assert(cashboxes[2].currentBalance === 1345, 'خصم التحويل الصادر والرسوم ومطابقة الرصيد 1345');

  cashboxTransactions.push({
    id: 'sys-tx-pending',
    date: '2026-11-19T10:25:00.000Z',
    cashboxId: 'cb-wallet',
    cashboxName: 'فودافون كاش',
    type: 'إيداع',
    documentNumber: 'INV-101',
    amount: 120,
    balanceAfter: 1465,
    party: 'عميل',
    statement: 'فاتورة بيع INV-101',
    userName: 'أحمد',
    notes: ''
  });
  cashboxes[2].currentBalance = 1465;

  nowMs = Date.parse('2026-11-19T10:30:00.000Z');
  const ovPendingBefore = la.getOverview().accounts.find(a => a.id === accWallet.id)!;
  assert(ovPendingBefore.pending.length === 1 && ovPendingBefore.pendingTotal === 120 && ovPendingBefore.pending[0].overdue === false, 'ظهور حركة النظام المعلقة قبل انتهاء النافذة');

  nowMs = Date.parse('2026-11-19T11:05:00.000Z');
  const ovPendingAfter = la.getOverview().accounts.find(a => a.id === accWallet.id)!;
  assert(ovPendingAfter.pending[0].overdue === true, 'تمييز الحركة المعلقة كمتأخرة بعد انتهاء النافذة');

  // 10) فجوة رسالة ناقصة ثم وصول الرسالة المتأخرة وتصحيحها تلقائيًا
  nowMs = Date.parse('2026-11-19T11:10:00.000Z');
  // نسقط حركة المعلق من الرصيد بمقارنتها مع بنك الحساب الأول (cb-bank1)
  la.intake({
    sender: 'NBE',
    text: 'حساب **1234 تم إيداع 500 ج.م الرصيد المتاح 1000 ج.م',
    at: '2026-11-19T10:00:00.000Z'
  });
  assert(cashboxes[0].currentBalance === 1000, 'بدء ربط الحساب الأول عند 1000');

  // تصل رسالة تالية برصيد 1500 بمبلغ 200 فقط -> هناك رسالة ناقصة بـ +300
  la.intake({
    sender: 'NBE',
    text: 'حساب **1234 تم إيداع 200 ج.م الرصيد المتاح 1500 ج.م',
    at: '2026-11-19T10:20:00.000Z'
  });
  const acc1GapOv = la.getOverview().accounts.find(a => a.id === acc1.id)!;
  assert(acc1GapOv.gaps.length === 1 && acc1GapOv.gaps[0].amount === 300, 'اكتشاف فجوة رسالة ناقصة بقيمة 300');
  assert(cashboxes[0].currentBalance === 1500, 'بقاء رصيد الخزنة مطابقًا لرصيد البنك 1500 عبر قيد الفرق');

  // وصول الرسالة المتأخرة بـ 300 في الوسط (10:10) -> تُعكس الفجوة ويبقى الرصيد 1500
  la.intake({
    sender: 'NBE',
    text: 'حساب **1234 تم إيداع 300 ج.م الرصيد المتاح 1300 ج.م',
    at: '2026-11-19T10:10:00.000Z'
  });
  const acc1FixedOv = la.getOverview().accounts.find(a => a.id === acc1.id)!;
  assert(acc1FixedOv.gaps.length === 0 && cashboxes[0].currentBalance === 1500, 'اختفاء الفجوة وبقاء الرصيد 1500 بعد وصول الرسالة المتأخرة');

  // 11) القوالب: اقتراح، تجربة، حفظ، تصدير، استيراد، حذف
  const suggestion = la.suggestTemplate('تم استلام مبلغ 450.50 ج.م والرصيد المتاح 2450.50 ج.م');
  assert(Boolean(suggestion.pattern && suggestion.pattern.includes('{المبلغ}') && suggestion.pattern.includes('{الرصيد}')), 'اقتراح قالب يحتوي خانتي {المبلغ} و{الرصيد}');

  expectError(
    () => la.saveTemplate({ name: 'ناقص', pattern: 'نص بدون خانة مبلغ', direction: 'in', sender: 'Custom' }),
    'INVALID_INPUT',
    'رفض قالب بدون خانة {المبلغ}'
  );

  const tpl = la.saveTemplate({
    name: 'قالب مخصص',
    pattern: 'كود-بنك {المبلغ} رصيد {الرصيد}',
    direction: 'in',
    sender: 'VF-Cash'
  });
  assert(tpl.id.startsWith('tpl-') && la.listTemplates().length === 1, 'حفظ قالب مخصص بنجاح');

  const testRead = la.testMessage('كود-بنك 75 رصيد 1420', 'VF-Cash');
  assert(testRead.kind === 'transaction' && testRead.amount === 75 && testRead.balance === 1420, 'تجربة القالب تقرأ المبلغ والرصيد بدقة');

  const exported = la.exportTemplates();
  assert(exported.length === 1, 'تصدير القوالب');
  assert(la.importTemplates(exported) === 0, 'استيراد قوالب مكررة لا يضيف تكرارًا');
  assert(
    la.importTemplates([{ name: 'قالب تجاهل', pattern: 'عرض خاص اليوم', direction: 'ignore', sender: '*' }]) === 1,
    'استيراد قالب جديد بنجاح'
  );
  la.deleteTemplate(tpl.id);
  assert(la.listTemplates().length === 1, 'حذف القالب بنجاح');
  expectError(() => la.deleteTemplate('tpl-missing'), 'NOT_FOUND', 'رفض حذف قالب غير موجود');

  // 12) حالة الهاتف ونص الرسالة
  const devBefore = la.getOverview().devices[0];
  assert(devBefore.id === 'phone-main' && devBefore.battery === 87 && devBefore.online === false, 'تمييز الهاتف غير متصل بعد مرور أكثر من 15 دقيقة');
  la.heartbeat('phone-main', 150);
  const devAfter = la.getOverview().devices[0];
  assert(devAfter.battery === 100 && devAfter.online === true, 'تحديث نبضة الهاتف وتقييد نسبة البطارية عند 100');

  const someMsgId = acc1FixedOv.entries[0].messageId;
  const msgText = la.getMessageText(someMsgId);
  assert(Boolean(msgText && msgText.sender === 'NBE' && msgText.text.includes('1234')), 'قراءة نص رسالة محفوظة');
  assert(la.getMessageText('non-existent-id') === null, 'رسالة غير موجودة تعيد null');

  // 13) حفظ واسترجاع المجموعات (collections)
  const snapshot = new Map<string, any>();
  for (const col of la.collections()) snapshot.set(col.name, JSON.parse(JSON.stringify(col.get())));
  const la2 = new LinkedAccounts({
    getCashboxes: () => cashboxes,
    getCashboxTransactions: () => cashboxTransactions,
    now: () => new Date(nowMs)
  });
  for (const col of la2.collections()) col.set(snapshot.get(col.name));
  assert(
    la2.listAccounts().length === 3 &&
      la2.listTemplates().length === 1 &&
      la2.isValidIntakeKey(k2) &&
      la2.getMessageText(someMsgId)?.sender === 'NBE',
    'حفظ واسترجاع كل مجموعات LinkedAccounts بدقة'
  );

  // 14) حذف حساب يبقي حركات الخزنة
  const txCountBeforeDelete = cashboxTransactions.length;
  la.deleteAccount(acc2.id);
  assert(la.listAccounts().length === 2 && cashboxTransactions.length === txCountBeforeDelete, 'حذف ربط الحساب يبقي حركات الخزنة كما هي');
  expectError(() => la.deleteAccount('la-missing'), 'NOT_FOUND', 'رفض حذف حساب غير موجود');

  // 15) إعادة ضبط العمليات وإعادة ضبط المصنع
  la.resetOperationsState();
  assert(
    la.listAccounts().length === 2 &&
      la.listTemplates().length === 1 &&
      la.isValidIntakeKey(k2) &&
      la.listAccounts().every(a => a.lastMessageAt === '') &&
      la.getMessageText(someMsgId) === null,
    'إعادة ضبط العمليات تمسح الرسائل وتبقي الحسابات والقوالب والمفتاح'
  );

  la.resetAll();
  assert(
    la.listAccounts().length === 0 &&
      la.listTemplates().length === 0 &&
      !la.isValidIntakeKey(k2) &&
      la.getOverview().devices.length === 0,
    'إعادة ضبط المصنع تمسح كل شيء'
  );

  console.log(`🎉 كل اختبارات الخزن المربوطة نجحت (${passed} تحققًا).`);
}

run();

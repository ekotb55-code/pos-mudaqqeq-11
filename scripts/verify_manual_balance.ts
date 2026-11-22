/**
 * اختبار الخزن المتابَعة برصيد يدوي (server/manualBalance.ts)
 * التشغيل: npx tsx scripts/verify_manual_balance.ts
 */
import { ManualBalances, ManualBalanceError } from '../server/manualBalance.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

// الخميس 19 نوفمبر 2026 — القاهرة = التوقيت العالمي + ساعتان (22:00 القاهرة = 20:00 عالمي)
let clock = Date.parse('2026-11-19T10:00:00.000Z');
const now = () => new Date(clock);
const setClock = (iso: string) => {
  clock = Date.parse(iso);
};

function makeWorld() {
  const cashboxes: any[] = [
    { id: 'cb-bank', name: 'حساب البنك', currentBalance: 700, openingBalance: 0 },
    { id: 'cb-wallet', name: 'محفظة', currentBalance: 0, openingBalance: 0 },
    { id: 'cb-msg', name: 'خزنة مربوطة بالرسائل', currentBalance: 0, openingBalance: 0 }
  ];
  const transactions: any[] = [];
  const users: any[] = [
    { id: 'u-owner', name: 'صاحب المحل', username: 'admin' },
    { id: 'u-manager', name: 'مدير الحساب', username: 'manager' },
    { id: 'u-cashier', name: 'كاشير', username: 'cashier' }
  ];
  const manual = new ManualBalances({
    getCashboxes: () => cashboxes,
    getCashboxTransactions: () => transactions,
    getUsers: () => users,
    cashboxLinkedByMessages: id => (id === 'cb-msg' ? 'بنك الرسائل' : ''),
    now
  });
  // حركة يسجلها النظام نفسه على الخزنة (فاتورة تحويل، مصروف…)
  const systemTx = (cashboxId: string, amount: number) => {
    const cashbox = cashboxes.find(c => c.id === cashboxId);
    cashbox.currentBalance = Math.round((cashbox.currentBalance + amount) * 100) / 100;
    transactions.push({ id: `sys-${transactions.length + 1}`, date: now().toISOString(), cashboxId, cashboxName: cashbox.name, type: 'إيراد مبيعات', amount, balanceAfter: cashbox.currentBalance, statement: 'فاتورة تحويل', userName: 'كاشير' });
  };
  const balanceOf = (id: string) => cashboxes.find(c => c.id === id).currentBalance;
  const overview = (name: string) => manual.getOverview().accounts.find(a => a.name === name)!;
  return { cashboxes, transactions, users, manual, systemTx, balanceOf, overview };
}

function expectError(fn: () => unknown, code: string, label: string) {
  let caught: any = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof ManualBalanceError && caught.code === code && /[\u0600-\u06FF]/.test(caught.message), label);
}

const base = { name: 'حساب البنك', cashboxId: 'cb-bank', responsibleUserIds: ['u-manager'], scheduleType: 'daily' as const, time: '22:00', weekdays: [], mandatory: true };
const asManager = (balance: unknown) => ({ balance, userId: 'u-manager', userName: 'مدير الحساب' });

// ===================== التعريف =====================
{
  const w = makeWorld();
  expectError(() => w.manual.saveAccount({ ...base, name: '' }), 'INVALID_INPUT', 'اسم فارغ يُرفض');
  expectError(() => w.manual.saveAccount({ ...base, cashboxId: 'nope' }), 'INVALID_INPUT', 'خزنة غير موجودة تُرفض');
  expectError(() => w.manual.saveAccount({ ...base, responsibleUserIds: [] }), 'INVALID_INPUT', 'بدون مسؤول يُرفض');
  expectError(() => w.manual.saveAccount({ ...base, responsibleUserIds: ['ghost'] }), 'INVALID_INPUT', 'مسؤول غير موجود يُرفض');
  expectError(() => w.manual.saveAccount({ ...base, time: '25:00' }), 'INVALID_INPUT', 'وقت غير صحيح يُرفض');
  expectError(() => w.manual.saveAccount({ ...base, time: '9 مساء' }), 'INVALID_INPUT', 'وقت بصيغة خاطئة يُرفض');
  expectError(() => w.manual.saveAccount({ ...base, scheduleType: 'weekdays', weekdays: [] }), 'INVALID_INPUT', 'أيام الأسبوع بدون أي يوم تُرفض');
  expectError(() => w.manual.saveAccount({ ...base, timezone: 'Mars/Phobos' }), 'INVALID_INPUT', 'منطقة زمنية خاطئة تُرفض');
  expectError(() => w.manual.saveAccount({ ...base, cashboxId: 'cb-msg' }), 'INVALID_INPUT', 'خزنة مربوطة بالرسائل لا تُتابَع يدويًا');
  const account = w.manual.saveAccount(base);
  assert(account.enabled && account.mandatory && account.timezone === 'Africa/Cairo' && w.manual.accountNameForCashbox('cb-bank') === 'حساب البنك', 'إنشاء متابعة يدوية');
  expectError(() => w.manual.saveAccount({ ...base, name: 'مكرر' }), 'INVALID_INPUT', 'خزنة واحدة لا تُتابَع مرتين');
  expectError(() => w.manual.saveAccount({ ...base, id: 'nope' }), 'NOT_FOUND', 'تعديل حساب غير موجود');
  expectError(() => w.manual.setAccountEnabled('nope', true), 'NOT_FOUND', 'تفعيل حساب غير موجود');
}

// ===================== يوم كامل: الطلب، التأجيل، الإجبار، الفرق =====================
{
  setClock('2026-11-19T10:00:00.000Z');
  const w = makeWorld();
  const account = w.manual.saveAccount(base);

  // بداية المتابعة: أول رصيد يُطلب من المسؤول فورًا — ومن المسؤول فقط
  let requests = w.manual.getRequestsFor('u-manager');
  assert(requests.length === 1 && requests[0].kind === 'baseline' && requests[0].state === 'due' && requests[0].blocking && requests[0].canPostpone && !('bookBalance' in requests[0]), 'عند بدء المتابعة يُطلب الرصيد من المسؤول فورًا');
  assert(w.manual.getRequestsFor('u-cashier').length === 0 && w.manual.getRequestsFor('u-owner').length === 0 && w.manual.getRequestsFor('').length === 0, 'غير المسؤول لا يُطلب منه شيء');
  assert(w.manual.blockingFor('u-manager')?.accountId === account.id && w.manual.blockingFor('u-cashier') === null, 'الإجبار يوقف المسؤول فقط والكاشير يكمل');
  expectError(() => w.manual.submitBalance(account.id, { balance: 5000, userId: 'u-cashier', userName: 'كاشير' }), 'FORBIDDEN', 'الكاشير لا يكتب الرصيد');
  expectError(() => w.manual.postpone(account.id, 'u-cashier'), 'FORBIDDEN', 'الكاشير لا يؤجل');
  expectError(() => w.manual.submitBalance('nope', asManager(1)), 'NOT_FOUND', 'حساب غير موجود');
  expectError(() => w.manual.submitBalance(account.id, asManager('')), 'INVALID_INPUT', 'رصيد فارغ يُرفض');
  expectError(() => w.manual.submitBalance(account.id, asManager('abc')), 'INVALID_INPUT', 'رصيد غير رقمي يُرفض');
  assert(w.balanceOf('cb-bank') === 700 && w.transactions.length === 0, 'المحاولات المرفوضة لا تغيّر الخزنة');

  // التأجيل: مرة واحدة لمدة ساعة
  const postponed = w.manual.postpone(account.id, 'u-manager');
  assert(postponed.state === 'postponed' && !postponed.blocking && !postponed.canPostpone && postponed.postponedUntil === '2026-11-19T11:00:00.000Z', 'التأجيل ساعة واحدة يرفع الإيقاف مؤقتًا');
  assert(w.manual.blockingFor('u-manager') === null, 'أثناء مهلة التأجيل المسؤول يكمل عمله');
  setClock('2026-11-19T10:59:00.000Z');
  assert(w.manual.blockingFor('u-manager') === null, 'قبل نهاية الساعة لا إيقاف');
  setClock('2026-11-19T11:00:30.000Z');
  requests = w.manual.getRequestsFor('u-manager');
  assert(requests[0].state === 'due' && requests[0].blocking && !requests[0].canPostpone, 'بعد الساعة: إيقاف بلا تأجيل ثانٍ');
  expectError(() => w.manual.postpone(account.id, 'u-manager'), 'INVALID_INPUT', 'التأجيل مرة ثانية مرفوض');

  // أول رصيد: مطابقة رصيد وليست فرقًا للمراجعة
  let entry = w.manual.submitBalance(account.id, asManager('5,000'));
  assert(entry.kind === 'baseline' && entry.enteredBalance === 5000 && entry.bookBalanceBefore === 700 && entry.difference === 4300 && entry.reviewed, 'أول رصيد = مطابقة رصيد');
  assert(w.balanceOf('cb-bank') === 5000 && w.transactions.length === 1 && w.transactions[0].amount === 4300 && w.transactions[0].type === 'إيداع' && /مطابقة رصيد/.test(w.transactions[0].statement) && w.transactions[0].userName === 'مدير الحساب', 'رصيد الخزنة يبدأ من الرصيد المُدخل بحركة واحدة');
  assert(w.manual.getAlerts().length === 0 && w.manual.getRequestsFor('u-manager').length === 0 && w.manual.blockingFor('u-manager') === null, 'بعد الإدخال لا طلب ولا إيقاف ولا تنبيه');
  const again = w.manual.submitBalance(account.id, asManager(5000));
  assert(again.id === entry.id && w.transactions.length === 1, 'ضغطتان متتاليتان = إدخال واحد');

  // خلال اليوم: النظام يسجل تحويلًا — وقبل الموعد لا يُطلب شيء
  setClock('2026-11-19T15:00:00.000Z');
  w.systemTx('cb-bank', 350);
  let o = w.overview('حساب البنك');
  assert(o.bookBalance === 5350 && o.lastBalance === 5000 && o.sinceLastTotal === 350 && o.request === null && o.nextDueAt === '2026-11-19T20:00:00.000Z', 'قبل الموعد: لا طلب، والموعد القادم 22:00 بتوقيت القاهرة');
  setClock('2026-11-19T19:59:00.000Z');
  assert(w.manual.getRequestsFor('u-manager').length === 0, 'قبل الموعد بدقيقة لا طلب');

  // الموعد حلّ: الرصيد مطابق ← لا حركة ولا تنبيه
  setClock('2026-11-19T20:00:00.000Z');
  requests = w.manual.getRequestsFor('u-manager');
  assert(requests.length === 1 && requests[0].kind === 'scheduled' && requests[0].dueAt === '2026-11-19T20:00:00.000Z' && requests[0].blocking && requests[0].canPostpone, 'في الموعد يُطلب الرصيد');
  entry = w.manual.submitBalance(account.id, asManager(5350));
  assert(entry.kind === 'scheduled' && entry.difference === 0 && entry.txId === '' && entry.reviewed && w.transactions.length === 2 && w.manual.getAlerts().length === 0, 'رصيد مطابق: لا حركة ولا تنبيه');
  assert(w.overview('حساب البنك').nextDueAt === '2026-11-20T20:00:00.000Z', 'الموعد القادم غدًا');

  // اليوم التالي: فرق ← يُسجَّل فورًا ويُعلَّم للمراجعة وينبَّه المالك
  setClock('2026-11-20T12:00:00.000Z');
  w.systemTx('cb-bank', 200);
  setClock('2026-11-20T20:05:00.000Z');
  w.manual.postpone(account.id, 'u-manager');
  setClock('2026-11-20T21:10:00.000Z');
  assert(w.manual.blockingFor('u-manager') !== null, 'تأجيل اليوم الجديد انتهى');
  entry = w.manual.submitBalance(account.id, asManager(5400));
  assert(entry.difference === -150 && entry.bookBalanceBefore === 5550 && !entry.reviewed && entry.txId, 'فرق −150 بين الرصيد المُدخل ورصيد النظام');
  const diffTx = w.transactions.find(t => t.id === entry.txId);
  assert(w.balanceOf('cb-bank') === 5400 && diffTx.amount === -150 && diffTx.type === 'سحب' && /للمراجعة/.test(diffTx.statement) && diffTx.balanceAfter === 5400 && diffTx.notes === 'bank-manual', 'الفرق سُجّل فورًا ورصيد الخزنة = الرصيد المُدخل');
  let alerts = w.manual.getAlerts();
  assert(alerts.length === 1 && alerts[0].id === entry.id && alerts[0].accountName === 'حساب البنك' && w.overview('حساب البنك').unreviewedCount === 1, 'تنبيه للمالك بالفرق');
  expectError(() => w.manual.markReviewed('nope', 'صاحب المحل'), 'NOT_FOUND', 'مراجعة إدخال غير موجود');
  const reviewed = w.manual.markReviewed(entry.id, 'صاحب المحل');
  assert(reviewed.reviewed && reviewed.reviewedBy === 'صاحب المحل' && w.manual.getAlerts().length === 0, 'المالك يعلّم الفرق «تمت المراجعة»');
  const net = w.transactions.reduce((sum, t) => sum + t.amount, 0);
  assert(Math.abs(700 + net - 5400) < 0.01, 'مجموع حركات الخزنة يساوي رصيدها');

  // إدخال قبل الموعد بأقل من نصف ساعة يُحسب للموعد
  setClock('2026-11-21T19:45:00.000Z');
  entry = w.manual.submitBalance(account.id, asManager(5400));
  assert(entry.kind === 'voluntary' && entry.difference === 0, 'إدخال اختياري قبل الموعد');
  assert(w.overview('حساب البنك').nextDueAt === '2026-11-22T20:00:00.000Z', 'الموعد الذي غطّاه إدخال مبكر لا يظهر كموعد قادم');
  setClock('2026-11-21T20:10:00.000Z');
  assert(w.manual.getRequestsFor('u-manager').length === 0, 'إدخال قبل الموعد بربع ساعة يكفي عن الطلب');

  // إدخال بعيد عن الموعد لا يُغني عنه
  setClock('2026-11-22T10:00:00.000Z');
  w.manual.submitBalance(account.id, asManager(5400));
  setClock('2026-11-22T20:00:00.000Z');
  assert(w.manual.getRequestsFor('u-manager').length === 1, 'إدخال الصباح لا يُغني عن موعد آخر اليوم');

  // غياب عدة أيام = طلب واحد فقط (آخر موعد)
  setClock('2026-11-25T08:00:00.000Z');
  requests = w.manual.getRequestsFor('u-manager');
  assert(requests.length === 1 && requests[0].dueAt === '2026-11-24T20:00:00.000Z', 'غياب أيام = طلب واحد بآخر موعد');
  w.manual.submitBalance(account.id, { balance: 5400, userId: 'u-owner', userName: 'صاحب المحل', canManage: true });
  assert(w.manual.getRequestsFor('u-manager').length === 0, 'صاحب صلاحية الإدارة يكتب الرصيد لأي خزنة');

  // الإيقاف وإعادة التفعيل
  w.manual.setAccountEnabled(account.id, false);
  setClock('2026-11-26T21:00:00.000Z');
  assert(w.manual.getRequestsFor('u-manager').length === 0 && w.overview('حساب البنك').nextDueAt === '', 'الموقوف لا يطلب رصيدًا');
  expectError(() => w.manual.submitBalance(account.id, asManager(1)), 'INVALID_INPUT', 'الموقوف لا يقبل رصيدًا');
  w.manual.setAccountEnabled(account.id, true);
  assert(w.manual.getRequestsFor('u-manager').length === 0, 'بعد إعادة التفعيل لا تُطلب مواعيد فترة الإيقاف');
  setClock('2026-11-27T20:00:00.000Z');
  assert(w.manual.getRequestsFor('u-manager').length === 1, 'الموعد التالي بعد إعادة التفعيل يُطلب');

  // تغيير الموعد يلغي الطلب القديم، وتغيير المسؤول ينقل الطلب
  w.manual.saveAccount({ ...base, id: account.id, time: '23:30' });
  assert(w.manual.getRequestsFor('u-manager').length === 0 && w.overview('حساب البنك').nextDueAt === '2026-11-27T21:30:00.000Z', 'تغيير الوقت يبدأ من الموعد الجديد');
  setClock('2026-11-27T21:30:00.000Z');
  w.manual.saveAccount({ ...base, id: account.id, time: '23:30', responsibleUserIds: ['u-owner'], mandatory: false });
  assert(w.manual.getRequestsFor('u-manager').length === 0 && w.manual.getRequestsFor('u-owner').length === 1, 'تغيير المسؤول ينقل الطلب');
  assert(w.manual.getRequestsFor('u-owner')[0].blocking === false && w.manual.blockingFor('u-owner') === null, 'غير الإجباري: تذكير فقط بلا إيقاف');
  expectError(() => w.manual.saveAccount({ ...base, id: account.id, cashboxId: 'cb-wallet' }), 'INVALID_INPUT', 'لا تغيير للخزنة بعد تسجيل أرصدة');

  // الحفظ والاسترجاع
  const before = JSON.stringify(w.manual.getOverview());
  for (const def of w.manual.collections()) def.set(JSON.parse(JSON.stringify(def.get())));
  assert(JSON.stringify(w.manual.getOverview()) === before, 'الحالة تُحفظ وتُسترجع بدون تغيير');
  assert(w.manual.collections().map(c => c.name).join() === 'bank.manualAccounts,bank.manualEntries', 'مجموعتا الحفظ');

  // إعادة الضبط
  w.manual.resetOperationsState();
  o = w.overview('حساب البنك');
  assert(o.entries.length === 0 && o.lastBalance === null && o.request?.kind === 'baseline', 'إعادة ضبط العمليات: التعريف باقٍ والمتابعة تبدأ من جديد');
  w.manual.deleteAccount(account.id);
  assert(w.manual.listAccounts().length === 0, 'حذف المتابعة');
  expectError(() => w.manual.deleteAccount(account.id), 'NOT_FOUND', 'حذف حساب غير موجود');
}

// ===================== أيام معينة في الأسبوع + أكثر من خزنة =====================
{
  setClock('2026-11-19T10:00:00.000Z'); // الخميس
  const w = makeWorld();
  const daily = w.manual.saveAccount(base);
  // الجمعة (5) والاثنين (1) الساعة 09:30 — غير إجباري، ومسؤولان
  const weekly = w.manual.saveAccount({ name: 'محفظة المدير', cashboxId: 'cb-wallet', responsibleUserIds: ['u-manager', 'u-owner'], scheduleType: 'weekdays', time: '09:30', weekdays: [5, 1, 5], mandatory: false });
  assert(weekly.weekdays.join() === '1,5' && w.manual.listAccounts().length === 2, 'خزنتان بمتابعة يدوية في نفس النسخة');
  assert(w.manual.getRequestsFor('u-manager').length === 2 && w.manual.getRequestsFor('u-owner').length === 1, 'كل مسؤول يرى خزنه فقط');
  w.manual.submitBalance(daily.id, asManager(700));
  w.manual.submitBalance(weekly.id, { balance: 0, userId: 'u-owner', userName: 'صاحب المحل' });
  assert(w.transactions.length === 0 && w.manual.getRequestsFor('u-manager').length === 0 && w.manual.getRequestsFor('u-owner').length === 0, 'رصيد مطابق عند البدء: لا حركات، وإدخال أحد المسؤولين يكفي');
  assert(w.overview('محفظة المدير').nextDueAt === '2026-11-20T07:30:00.000Z', 'الموعد القادم الجمعة 09:30 بتوقيت القاهرة');

  setClock('2026-11-20T07:29:00.000Z');
  assert(w.manual.getRequestsFor('u-owner').length === 0, 'قبل موعد الجمعة لا طلب');
  setClock('2026-11-20T07:30:00.000Z');
  const request = w.manual.getRequestsFor('u-owner')[0];
  assert(request.accountId === weekly.id && !request.blocking && request.canPostpone && w.manual.blockingFor('u-owner') === null, 'موعد الجمعة: تذكير غير إجباري');
  w.manual.submitBalance(weekly.id, asManager(1250.5));
  assert(w.balanceOf('cb-wallet') === 1250.5 && w.manual.getAlerts().length === 1 && w.manual.getAlerts()[0].difference === 1250.5, 'فرق موجب يُسجَّل إيداعًا للمراجعة');
  assert(w.overview('محفظة المدير').nextDueAt === '2026-11-23T07:30:00.000Z', 'بعد الجمعة: الموعد القادم الاثنين');
  setClock('2026-11-21T12:00:00.000Z'); // السبت
  assert(w.manual.getRequestsFor('u-owner').length === 0, 'السبت ليس من الأيام المختارة');
  setClock('2026-11-22T12:00:00.000Z'); // الأحد
  assert(w.manual.getRequestsFor('u-owner').length === 0, 'الأحد ليس من الأيام المختارة');
  setClock('2026-11-23T07:30:00.000Z'); // الاثنين
  assert(w.manual.getRequestsFor('u-owner').length === 1 && w.manual.getRequestsFor('u-owner')[0].dueAt === '2026-11-23T07:30:00.000Z', 'الاثنين: الطلب في موعده');

  // مسؤول حُذف من المستخدمين يظهر في العرض «غير موجود»
  w.users.splice(1, 1);
  assert(w.overview('محفظة المدير').responsibles.some(r => r.id === 'u-manager' && r.missing) && w.overview('محفظة المدير').responsibles.some(r => r.id === 'u-owner' && !r.missing && r.name === 'صاحب المحل'), 'أسماء المسؤولين في العرض');

  w.manual.resetAll();
  assert(w.manual.listAccounts().length === 0 && w.manual.getAlerts().length === 0, 'إعادة ضبط المصنع: مسح كل شيء');
}

// ===================== «الموعد القادم» المعروض هو فعلًا الموعد الذي سيُطلب فيه الرصيد =====================
{
  // مهما كان وقت كتابة الرصيد (كل 7 دقائق على مدى يومين): عند حلول «الموعد القادم» يجب أن يوجد طلب بنفس الموعد
  const start = Date.parse('2026-11-19T00:00:00.000Z');
  const broken: string[] = [];
  for (let minute = 0; minute < 2 * 24 * 60; minute += 7) {
    for (const schedule of [{ scheduleType: 'daily' as const, weekdays: [] as number[] }, { scheduleType: 'weekdays' as const, weekdays: [0, 2, 5] }]) {
      clock = start;
      const w = makeWorld();
      const account = w.manual.saveAccount({ ...base, ...schedule });
      w.manual.submitBalance(account.id, asManager(700));
      clock = start + minute * 60000 + 11000;
      w.manual.submitBalance(account.id, asManager(700));
      const nextDueAt = w.overview('حساب البنك').nextDueAt;
      clock = Date.parse(nextDueAt) + 60000;
      const request = w.manual.getRequestsFor('u-manager')[0];
      if (!nextDueAt || !request || request.dueAt !== nextDueAt || !request.blocking) broken.push(`${schedule.scheduleType}@${new Date(start + minute * 60000).toISOString()}`);
    }
  }
  assert(broken.length === 0, `الموعد القادم المعروض يطابق الطلب الفعلي في كل الأوقات (${broken.slice(0, 3).join('، ')})`);
}

// ===================== التوقيت الصيفي =====================
{
  const w = makeWorld();
  setClock('2026-07-10T12:00:00.000Z');
  const london = w.manual.saveAccount({ ...base, timezone: 'Europe/London' });
  assert(w.overview('حساب البنك').nextDueAt === '2026-07-10T21:00:00.000Z', 'صيفًا: 22:00 لندن = 21:00 عالمي');
  setClock('2026-01-10T12:00:00.000Z');
  assert(w.overview('حساب البنك').nextDueAt === '2026-01-10T22:00:00.000Z', 'شتاءً: 22:00 لندن = 22:00 عالمي');
  // موعد بعد منتصف الليل محليًا يقع في اليوم العالمي السابق
  w.manual.saveAccount({ ...base, id: london.id, timezone: 'Africa/Cairo', time: '00:30' });
  setClock('2026-11-19T10:00:00.000Z');
  assert(w.overview('حساب البنك').nextDueAt === '2026-11-19T22:30:00.000Z', '00:30 القاهرة = 22:30 عالمي من اليوم السابق');
}

console.log(`\n🎉 كل اختبارات إدخال الرصيد يدويًا نجحت (${passed} تحققًا).`);

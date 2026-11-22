/**
 * الخزن المتابَعة برصيد يدوي (بدون قراءة رسائل) — POS مدقق
 * ---------------------------------------------------------------------------
 * بديل الخصوصية لربط الخزنة برسائل البنك: لا هاتف ولا رسائل.
 * في موعد يحدده المالك من الإعدادات (كل يوم في وقت ثابت، أو أيام معينة من الأسبوع)
 * يطلب البرنامج من «المسؤول عن الرصيد» (المدير صاحب الحساب) أن يكتب رصيد الحساب الحالي.
 *
 * العلاقة بين الرصيد المُدخل والخزنة:
 *   - الرصيد الذي يكتبه المسؤول هو الحقيقة. لو اختلف عن رصيد الخزنة في النظام يُسجَّل الفرق فورًا
 *     كحركة على الخزنة «فرق رصيد — للمراجعة»، فيصبح رصيد الخزنة = الرصيد المُدخل.
 *   - الفرق يظهر للمالك في تنبيه حتى يعلّمه «تمت المراجعة».
 *   - أول إدخال بعد بدء المتابعة هو «مطابقة رصيد» ولا يُعتبر فرقًا.
 *   - طلب الرصيد لا يعرض رصيد النظام: المسؤول يكتب ما يراه في حسابه فقط.
 *
 * الإجبار: لو الخزنة «إجباري» فالمسؤول يستطيع التأجيل مرة واحدة لمدة ساعة،
 * وبعدها لا يكمل أي عملية في البرنامج حتى يكتب الرصيد.
 *
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import { randomBytes } from 'node:crypto';
import type { CollectionDef } from './persistence/statePersistence.ts';

export interface ManualAccount {
  id: string;
  name: string;
  cashboxId: string;
  /** زر التفعيل: الموقوف لا يطلب رصيدًا ولا يوقف أحدًا */
  enabled: boolean;
  /** المستخدمون الذين يُطلب منهم الرصيد (المدير صاحب الحساب) */
  responsibleUserIds: string[];
  /** daily = كل يوم في الوقت المحدد، weekdays = الأيام المختارة فقط */
  scheduleType: 'daily' | 'weekdays';
  /** وقت الطلب بتوقيت الشركة، بصيغة HH:MM (24 ساعة) */
  time: string;
  /** أيام الأسبوع عند النوع weekdays: 0 = الأحد … 6 = السبت */
  weekdays: number[];
  /** إجباري: بعد التأجيل مرة واحدة لا يكمل المسؤول العمل قبل كتابة الرصيد */
  mandatory: boolean;
  timezone: string;
  createdAt: string;
  /** بداية المتابعة: لا تُطلب مواعيد قبلها (تاريخ الإنشاء أو آخر إعادة ضبط) */
  scheduleSince: string;
  lastEntryAt: string;
  lastBalance: number | null;
  /** الموعد الذي استُخدم فيه التأجيل، ونهاية مهلة التأجيل */
  postponedSlot: string;
  postponedUntil: string;
}

export interface ManualEntry {
  id: string;
  accountId: string;
  accountName: string;
  cashboxId: string;
  at: string;
  /** baseline = أول إدخال، scheduled = في موعده، voluntary = إدخال بدون طلب */
  kind: 'baseline' | 'scheduled' | 'voluntary';
  enteredBalance: number;
  bookBalanceBefore: number;
  /** الرصيد المُدخل − رصيد النظام (موجب = زيادة غير مسجلة، سالب = نقص غير مسجل) */
  difference: number;
  /** حركة الخزنة التي سجّلت الفرق (فارغ لو لا يوجد فرق) */
  txId: string;
  userId: string;
  userName: string;
  reviewed: boolean;
  reviewedBy: string;
  reviewedAt: string;
}

export interface BalanceRequest {
  accountId: string;
  accountName: string;
  cashboxName: string;
  dueAt: string;
  kind: 'baseline' | 'scheduled';
  mandatory: boolean;
  /** due = مطلوب الآن، postponed = مؤجَّل ولم تنتهِ المهلة */
  state: 'due' | 'postponed';
  canPostpone: boolean;
  postponedUntil: string;
  /** true = لا يكمل المسؤول أي عملية قبل كتابة الرصيد أو التأجيل */
  blocking: boolean;
}

type ManualErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN';

export class ManualBalanceError extends Error {
  code: ManualErrorCode;
  constructor(code: ManualErrorCode, message: string) {
    super(message);
    this.name = 'ManualBalanceError';
    this.code = code;
  }
}

export interface ManualBalancesOptions {
  getCashboxes: () => any[];
  getCashboxTransactions: () => any[];
  getUsers: () => any[];
  /** اسم الحساب المربوط بالرسائل على نفس الخزنة (أو فارغ): خزنة واحدة لا تُتابَع بالطريقتين */
  cashboxLinkedByMessages?: (cashboxId: string) => string;
  now?: () => Date;
}

export const MANUAL_BALANCE_NOTE = 'bank-manual';
export const POSTPONE_MINUTES = 60;
const DEFAULT_TIMEZONE = 'Africa/Cairo';
const EARLY_ENTRY_MINUTES = 30;
const MAX_ENTRIES_PER_ACCOUNT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) < 0.011;
const clean = (value: unknown, max = 200) => String(value ?? '').trim().slice(0, max);
const money = (n: number) => round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// المواعيد بتوقيت الشركة
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

function isValidTimezone(timezone: string): boolean {
  try {
    formatterOf(timezone);
    return true;
  } catch {
    return false;
  }
}

/** أجزاء التاريخ والوقت كما يراها أهل هذه المنطقة الزمنية */
function zonedParts(ms: number, timezone: string) {
  const parts: Record<string, number> = {};
  for (const part of formatterOf(timezone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute };
}

/** يحوّل وقتًا محليًا في المنطقة الزمنية إلى لحظة عالمية (يراعي التوقيت الصيفي) */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): number {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, timezone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (seen === wanted) break;
    guess -= seen - wanted;
  }
  return guess;
}

/** موعد الطلب في اليوم المحلي الذي يبعد offsetDays عن اليوم (أو null لو اليوم غير مختار) */
function slotOnDay(account: ManualAccount, nowMs: number, offsetDays: number): number | null {
  const today = zonedParts(nowMs, account.timezone);
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offsetDays));
  if (account.scheduleType === 'weekdays' && !account.weekdays.includes(date.getUTCDay())) return null;
  const [hour, minute] = account.time.split(':').map(Number);
  return zonedToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, account.timezone);
}

/** آخر موعد حلّ (≤ الآن) */
export function latestSlot(account: ManualAccount, nowMs: number): number | null {
  for (let back = 1; back >= -8; back--) {
    const slot = slotOnDay(account, nowMs, back);
    if (slot !== null && slot <= nowMs) return slot;
  }
  return null;
}

/** أول موعد قادم (> الآن) */
export function nextSlot(account: ManualAccount, nowMs: number): number | null {
  for (let ahead = -1; ahead <= 8; ahead++) {
    const slot = slotOnDay(account, nowMs, ahead);
    if (slot !== null && slot > nowMs) return slot;
  }
  return null;
}

// ---------------------------------------------------------------------------

export class ManualBalances {
  private accounts: ManualAccount[] = [];
  private entries: ManualEntry[] = [];
  private getCashboxes: () => any[];
  private getCashboxTransactions: () => any[];
  private getUsers: () => any[];
  private cashboxLinkedByMessages: (cashboxId: string) => string;
  private now: () => Date;

  constructor(options: ManualBalancesOptions) {
    this.getCashboxes = options.getCashboxes;
    this.getCashboxTransactions = options.getCashboxTransactions;
    this.getUsers = options.getUsers;
    this.cashboxLinkedByMessages = options.cashboxLinkedByMessages || (() => '');
    this.now = options.now || (() => new Date());
  }

  /** تُضاف إلى قائمة مجموعات الحفظ في server.ts ليُحفظ الإدخال مع حركة الخزنة في عملية واحدة */
  collections(): CollectionDef[] {
    return [
      { name: 'bank.manualAccounts', kind: 'list', get: () => this.accounts, set: v => { this.accounts = v; }, idOf: d => d.id },
      { name: 'bank.manualEntries', kind: 'list', get: () => this.entries, set: v => { this.entries = v; }, idOf: d => d.id }
    ];
  }

  // ---- التعريف ----------------------------------------------------------------

  listAccounts(): ManualAccount[] {
    return this.accounts.map(a => ({ ...a, responsibleUserIds: [...a.responsibleUserIds], weekdays: [...a.weekdays] }));
  }

  /** اسم المتابعة اليدوية على هذه الخزنة (أو فارغ) */
  accountNameForCashbox(cashboxId: string): string {
    return this.accounts.find(a => a.cashboxId === cashboxId)?.name || '';
  }

  saveAccount(input: Partial<ManualAccount> & { name: string; cashboxId: string }): ManualAccount {
    const name = clean(input.name, 80);
    if (!name) throw new ManualBalanceError('INVALID_INPUT', 'اكتب اسمًا للحساب');
    const cashbox = this.getCashboxes().find(c => c.id === input.cashboxId);
    if (!cashbox) throw new ManualBalanceError('INVALID_INPUT', 'اختر خزنة موجودة');

    const existing = input.id ? this.accounts.find(a => a.id === input.id) : undefined;
    if (input.id && !existing) throw new ManualBalanceError('NOT_FOUND', 'الحساب غير موجود');
    const other = this.accounts.find(a => a.cashboxId === input.cashboxId && a.id !== existing?.id);
    if (other) throw new ManualBalanceError('INVALID_INPUT', `هذه الخزنة متابَعة بالفعل بالحساب «${other.name}»`);
    const byMessages = this.cashboxLinkedByMessages(String(input.cashboxId));
    if (byMessages) throw new ManualBalanceError('INVALID_INPUT', `هذه الخزنة مربوطة برسائل البنك في الحساب «${byMessages}». الخزنة الواحدة تُتابَع بطريقة واحدة`);

    const users = this.getUsers();
    const responsibleUserIds = Array.from(new Set((Array.isArray(input.responsibleUserIds) ? input.responsibleUserIds : []).map(id => clean(id, 80)).filter(Boolean)));
    if (responsibleUserIds.length === 0) throw new ManualBalanceError('INVALID_INPUT', 'اختر المسؤول عن إدخال الرصيد (مستخدم واحد على الأقل)');
    if (responsibleUserIds.length > 10) throw new ManualBalanceError('INVALID_INPUT', 'الحد الأقصى 10 مسؤولين للخزنة الواحدة');
    for (const id of responsibleUserIds) {
      if (!users.some(u => String(u.id) === id)) throw new ManualBalanceError('INVALID_INPUT', 'أحد المسؤولين المختارين غير موجود في المستخدمين');
    }

    const scheduleType = input.scheduleType === 'weekdays' ? 'weekdays' : 'daily';
    const time = clean(input.time, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ManualBalanceError('INVALID_INPUT', 'اكتب وقت الطلب بصيغة ساعة:دقيقة مثل 22:00');
    const weekdays = Array.from(new Set((Array.isArray(input.weekdays) ? input.weekdays : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b);
    if (scheduleType === 'weekdays' && weekdays.length === 0) throw new ManualBalanceError('INVALID_INPUT', 'اختر يومًا واحدًا على الأقل من أيام الأسبوع');
    const timezone = clean(input.timezone, 60) || existing?.timezone || DEFAULT_TIMEZONE;
    if (!isValidTimezone(timezone)) throw new ManualBalanceError('INVALID_INPUT', 'المنطقة الزمنية غير صحيحة');
    const mandatory = Boolean(input.mandatory);

    if (existing) {
      if (existing.cashboxId !== input.cashboxId && this.entries.some(e => e.accountId === existing.id)) {
        throw new ManualBalanceError('INVALID_INPUT', 'لا يمكن تغيير الخزنة بعد تسجيل أرصدة. أوقف هذا الحساب وأنشئ حسابًا جديدًا');
      }
      const scheduleChanged = existing.scheduleType !== scheduleType || existing.time !== time || existing.weekdays.join() !== weekdays.join() || existing.timezone !== timezone;
      Object.assign(existing, { name, cashboxId: input.cashboxId, responsibleUserIds, scheduleType, time, weekdays, mandatory, timezone });
      if (typeof input.enabled === 'boolean') existing.enabled = input.enabled;
      if (scheduleChanged) {
        // موعد جديد: لا يُحاسَب المسؤول على مواعيد الجدول القديم
        existing.postponedSlot = '';
        existing.postponedUntil = '';
        if (existing.lastEntryAt) existing.scheduleSince = this.now().toISOString();
      }
      return { ...existing };
    }
    const nowIso = this.now().toISOString();
    const account: ManualAccount = {
      id: `ma-${randomBytes(6).toString('hex')}`,
      name,
      cashboxId: input.cashboxId,
      enabled: input.enabled !== false,
      responsibleUserIds,
      scheduleType,
      time,
      weekdays,
      mandatory,
      timezone,
      createdAt: nowIso,
      scheduleSince: nowIso,
      lastEntryAt: '',
      lastBalance: null,
      postponedSlot: '',
      postponedUntil: ''
    };
    this.accounts.push(account);
    return { ...account };
  }

  /** زر التفعيل / الإيقاف */
  setAccountEnabled(id: string, enabled: boolean): ManualAccount {
    const account = this.accounts.find(a => a.id === id);
    if (!account) throw new ManualBalanceError('NOT_FOUND', 'الحساب غير موجود');
    const wasEnabled = account.enabled;
    account.enabled = Boolean(enabled);
    // عند إعادة التفعيل لا تُطلب مواعيد فترة الإيقاف
    if (!wasEnabled && account.enabled && account.lastEntryAt) account.scheduleSince = this.now().toISOString();
    return { ...account };
  }

  /** حذف المتابعة فقط: حركات الخزنة المسجلة تبقى كما هي */
  deleteAccount(id: string): void {
    if (!this.accounts.some(a => a.id === id)) throw new ManualBalanceError('NOT_FOUND', 'الحساب غير موجود');
    this.accounts = this.accounts.filter(a => a.id !== id);
    this.entries = this.entries.filter(e => e.accountId !== id);
  }

  // ---- طلب الرصيد ---------------------------------------------------------------

  /** الطلب الحالي لهذا الحساب (أو null لو لا يوجد شيء مطلوب الآن) */
  private requestOf(account: ManualAccount): BalanceRequest | null {
    if (!account.enabled) return null;
    const cashbox = this.getCashboxes().find(c => c.id === account.cashboxId);
    if (!cashbox) return null;
    const nowMs = this.now().getTime();
    let dueMs: number;
    let kind: BalanceRequest['kind'];
    if (!account.lastEntryAt) {
      // بداية المتابعة: أول رصيد يُطلب فورًا ليبدأ رصيد الخزنة من رصيد الحساب
      dueMs = Date.parse(account.scheduleSince) || nowMs;
      kind = 'baseline';
    } else {
      const slot = latestSlot(account, nowMs);
      if (slot === null || slot <= (Date.parse(account.scheduleSince) || 0)) return null;
      const lastEntryMs = Date.parse(account.lastEntryAt) || 0;
      if (lastEntryMs >= slot - EARLY_ENTRY_MINUTES * 60 * 1000) return null;
      dueMs = slot;
      kind = 'scheduled';
    }
    const dueAt = new Date(dueMs).toISOString();
    const postponeUsed = account.postponedSlot === dueAt;
    const postponed = postponeUsed && nowMs < (Date.parse(account.postponedUntil) || 0);
    return {
      accountId: account.id,
      accountName: account.name,
      cashboxName: cashbox.name || '',
      dueAt,
      kind,
      mandatory: account.mandatory,
      state: postponed ? 'postponed' : 'due',
      canPostpone: !postponeUsed,
      postponedUntil: postponed ? account.postponedUntil : '',
      blocking: account.mandatory && !postponed
    };
  }

  /** الطلبات التي تخص هذا المستخدم (هو مسؤول عنها) */
  getRequestsFor(userId: string): BalanceRequest[] {
    const id = String(userId || '');
    if (!id) return [];
    const requests: BalanceRequest[] = [];
    for (const account of this.accounts) {
      if (!account.responsibleUserIds.includes(id)) continue;
      const request = this.requestOf(account);
      if (request) requests.push(request);
    }
    return requests;
  }

  /** الطلب الإجباري الذي يوقف هذا المستخدم الآن (أو null) */
  blockingFor(userId: string): BalanceRequest | null {
    return this.getRequestsFor(userId).find(r => r.blocking) || null;
  }

  /** تأجيل لمرة واحدة لمدة ساعة */
  postpone(accountId: string, userId: string): BalanceRequest {
    const account = this.accounts.find(a => a.id === accountId);
    if (!account) throw new ManualBalanceError('NOT_FOUND', 'الحساب غير موجود');
    if (!account.responsibleUserIds.includes(String(userId || ''))) throw new ManualBalanceError('FORBIDDEN', 'التأجيل متاح للمسؤول عن رصيد هذه الخزنة فقط');
    const request = this.requestOf(account);
    if (!request) throw new ManualBalanceError('INVALID_INPUT', 'لا يوجد طلب رصيد مستحق الآن');
    if (!request.canPostpone) throw new ManualBalanceError('INVALID_INPUT', 'تم استخدام التأجيل من قبل لهذا الموعد. اكتب الرصيد الحالي للمتابعة');
    account.postponedSlot = request.dueAt;
    account.postponedUntil = new Date(this.now().getTime() + POSTPONE_MINUTES * 60 * 1000).toISOString();
    return this.requestOf(account)!;
  }

  // ---- إدخال الرصيد --------------------------------------------------------------

  /**
   * يسجل الرصيد الذي كتبه المسؤول. لو اختلف عن رصيد الخزنة يُسجَّل الفرق فورًا ويُعلَّم للمراجعة.
   * canManage = المستخدم معه صلاحية إدارة الخزن المربوطة (يُدخل لأي خزنة).
   */
  submitBalance(accountId: string, input: { balance: unknown; userId: string; userName: string; canManage?: boolean }): ManualEntry {
    const account = this.accounts.find(a => a.id === accountId);
    if (!account) throw new ManualBalanceError('NOT_FOUND', 'الحساب غير موجود');
    const userId = String(input.userId || '');
    if (!input.canManage && !account.responsibleUserIds.includes(userId)) throw new ManualBalanceError('FORBIDDEN', 'إدخال الرصيد متاح للمسؤول عن رصيد هذه الخزنة فقط');
    if (!account.enabled) throw new ManualBalanceError('INVALID_INPUT', 'متابعة هذه الخزنة موقوفة. فعّلها أولًا');
    const cashbox = this.getCashboxes().find(c => c.id === account.cashboxId);
    if (!cashbox) throw new ManualBalanceError('INVALID_INPUT', 'الخزنة المرتبطة بهذا الحساب غير موجودة');
    const raw = typeof input.balance === 'number' ? input.balance : Number(clean(input.balance, 30).replace(/,/g, ''));
    if (clean(input.balance, 30) === '' || !Number.isFinite(raw) || Math.abs(raw) > 1e12) throw new ManualBalanceError('INVALID_INPUT', 'اكتب الرصيد الحالي رقمًا صحيحًا');
    const balance = round2(raw);
    const now = this.now();
    const nowIso = now.toISOString();

    // ضغطتان متتاليتان بنفس الرصيد = إدخال واحد
    const last = this.entries.filter(e => e.accountId === account.id).slice(-1)[0];
    if (last && last.userId === userId && near(last.enteredBalance, balance) && now.getTime() - (Date.parse(last.at) || 0) < 10 * 1000) return { ...last };

    const request = this.requestOf(account);
    const kind: ManualEntry['kind'] = !account.lastEntryAt ? 'baseline' : request ? 'scheduled' : 'voluntary';
    const bookBalanceBefore = round2(Number(cashbox.currentBalance) || 0);
    const difference = round2(balance - bookBalanceBefore);
    const id = `mbe-${randomBytes(8).toString('hex')}`;
    const userName = clean(input.userName, 80) || 'مستخدم';
    let txId = '';
    if (!near(difference, 0)) {
      cashbox.currentBalance = round2(bookBalanceBefore + difference);
      txId = `mtx-${randomBytes(8).toString('hex')}`;
      this.getCashboxTransactions().push({
        id: txId,
        date: nowIso,
        cashboxId: cashbox.id,
        cashboxName: cashbox.name,
        type: difference >= 0 ? 'إيداع' : 'سحب',
        documentNumber: `MBL-${id.slice(4, 12).toUpperCase()}`,
        amount: difference,
        balanceAfter: cashbox.currentBalance,
        party: '',
        statement:
          kind === 'baseline'
            ? 'مطابقة رصيد الخزنة مع رصيد الحساب عند بدء المتابعة (إدخال يدوي)'
            : `فرق رصيد عند إدخال الرصيد يدويًا — للمراجعة (الرصيد المُدخل ${money(balance)}، رصيد النظام ${money(bookBalanceBefore)})`,
        userName,
        notes: MANUAL_BALANCE_NOTE
      });
    }
    const entry: ManualEntry = {
      id,
      accountId: account.id,
      accountName: account.name,
      cashboxId: account.cashboxId,
      at: nowIso,
      kind,
      enteredBalance: balance,
      bookBalanceBefore,
      difference: near(difference, 0) ? 0 : difference,
      txId,
      userId,
      userName,
      reviewed: kind === 'baseline' || near(difference, 0),
      reviewedBy: '',
      reviewedAt: ''
    };
    this.entries.push(entry);
    account.lastEntryAt = nowIso;
    account.lastBalance = balance;
    account.postponedSlot = '';
    account.postponedUntil = '';

    const mine = this.entries.filter(e => e.accountId === account.id);
    if (mine.length > MAX_ENTRIES_PER_ACCOUNT) {
      // الأقدم يُحذف أولًا، والفروق التي لم تُراجَع لا تُحذف
      const drop = new Set(mine.filter(e => e.reviewed).slice(0, mine.length - MAX_ENTRIES_PER_ACCOUNT).map(e => e.id));
      this.entries = this.entries.filter(e => !drop.has(e.id));
    }
    return { ...entry };
  }

  /** فروق لم يراجعها المالك بعد (تنبيه المالك) */
  getAlerts(): ManualEntry[] {
    return this.entries.filter(e => !e.reviewed).map(e => ({ ...e })).reverse();
  }

  /** المالك يعلّم الفرق «تمت المراجعة» */
  markReviewed(entryId: string, reviewerName: string): ManualEntry {
    const entry = this.entries.find(e => e.id === entryId);
    if (!entry) throw new ManualBalanceError('NOT_FOUND', 'الإدخال غير موجود');
    if (!entry.reviewed) {
      entry.reviewed = true;
      entry.reviewedBy = clean(reviewerName, 80);
      entry.reviewedAt = this.now().toISOString();
    }
    return { ...entry };
  }

  // ---- العرض -------------------------------------------------------------------

  getOverview() {
    const nowMs = this.now().getTime();
    const users = this.getUsers();
    const accounts = this.accounts.map(account => {
      const cashbox = this.getCashboxes().find(c => c.id === account.cashboxId);
      const bookBalance = cashbox ? round2(Number(cashbox.currentBalance) || 0) : null;
      // الموعد القادم الذي سيُطلب فيه الرصيد فعلًا: الموعد الذي غطّاه إدخال مبكر (قبله بأقل من نصف ساعة) يُتخطّى
      let next = account.enabled ? nextSlot(account, nowMs) : null;
      const lastEntryMs = account.lastEntryAt ? Date.parse(account.lastEntryAt) || 0 : 0;
      if (next !== null && lastEntryMs > 0 && lastEntryMs >= next - EARLY_ENTRY_MINUTES * 60 * 1000) next = nextSlot(account, next);
      const mine = this.entries.filter(e => e.accountId === account.id);
      return {
        ...account,
        cashboxName: cashbox?.name || '',
        cashboxMissing: !cashbox,
        responsibles: account.responsibleUserIds.map(id => {
          const user = users.find(u => String(u.id) === id);
          return { id, name: user ? String(user.name || user.username || '') : '', missing: !user };
        }),
        bookBalance,
        /** حركات النظام على الخزنة منذ آخر رصيد كتبه المسؤول */
        sinceLastTotal: bookBalance !== null && account.lastBalance !== null ? round2(bookBalance - account.lastBalance) : null,
        nextDueAt: next === null ? '' : new Date(next).toISOString(),
        request: this.requestOf(account),
        unreviewedCount: mine.filter(e => !e.reviewed).length,
        entries: mine.slice(-100).reverse().map(e => ({ ...e }))
      };
    });
    return { accounts, alerts: this.getAlerts() };
  }

  // ---- إعادة الضبط -------------------------------------------------------------

  /** مع «إعادة ضبط العمليات»: تُمسح الأرصدة المُدخلة ويبقى التعريف، وتبدأ المتابعة من جديد */
  resetOperationsState(): void {
    const nowIso = this.now().toISOString();
    this.entries = [];
    for (const account of this.accounts) {
      account.lastEntryAt = '';
      account.lastBalance = null;
      account.postponedSlot = '';
      account.postponedUntil = '';
      account.scheduleSince = nowIso;
    }
  }

  /** مع «إعادة ضبط المصنع»: يُمسح كل شيء */
  resetAll(): void {
    this.accounts = [];
    this.entries = [];
  }
}

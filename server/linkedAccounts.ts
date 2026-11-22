/**
 * الخزن المربوطة برسائل البنك / المحفظة / إنستا باي — POS مدقق
 * ---------------------------------------------------------------------------
 * «حساب مربوط» = خزنة من خزن النظام + مرسلو الرسائل الذين يخصّونها + زر تفعيل/إيقاف.
 * يمكن ربط أي عدد من الخزن بنفس الطريقة (أكثر من حساب أو أكثر من شخص).
 *
 * العلاقة بين الرسائل والخزنة:
 *   - رسالة البنك هي الحقيقة. كل حركة في الرسائل إمّا:
 *       (أ) تُطابَق مع حركة مسجلة في الخزنة من النظام (فاتورة تحويل، تحصيل، مصروف…) بنفس المبلغ
 *           وفي نفس الوقت تقريبًا ← لا تُسجَّل مرة ثانية، وتصبح الحركة «مؤكدة من البنك».
 *       (ب) أو لا يوجد لها مقابل ← تُسجَّل تلقائيًا في الخزنة «إيداع/سحب غير مصنف» ليصنفها المدير.
 *   - لو ضاعت رسالة يظهر الفرق كحركة «فرق غير مفسَّر»، فيبقى:
 *         رصيد الخزنة في النظام = رصيد البنك من آخر رسالة + حركات النظام التي لم تصل رسالتها بعد
 *   - عند بدء الربط تُسجَّل حركة «مطابقة رصيد» واحدة ليبدأ رصيد الخزنة من رصيد البنك.
 *
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { CollectionDef } from './persistence/statePersistence.ts';
import {
  computeStream,
  compileTemplate,
  suggestTemplate,
  normalizeMessageText,
  readPaymentMessage,
  type IncomingMessage,
  type PaymentTemplate,
  type StreamEntry,
  type StreamResult
} from './paymentMessages.ts';

export interface LinkedAccount {
  id: string;
  name: string;
  cashboxId: string;
  /** زر التفعيل: الموقوف لا يستقبل ولا يسجل أي رسائل */
  enabled: boolean;
  /** أسماء مرسلي الرسائل النصية أو أسماء حزم التطبيقات التي تخص هذا الحساب */
  senders: string[];
  /** آخر أرقام الحساب/البطاقة (اختياري): يلزم لو نفس المرسل يرسل لأكثر من حساب */
  accountSuffix: string;
  /** أقصى فرق زمني (بالدقائق) بين حركة النظام ورسالة البنك ليُعتبرا حركة واحدة */
  matchWindowMinutes: number;
  createdAt: string;
  lastMessageAt: string;
}

interface StoredMessage {
  id: string;
  accountId: string;
  sender: string;
  text: string;
  at: string;
  receivedAt: string;
}

interface Posting {
  key: string;
  accountId: string;
  kind: 'entry' | 'gap' | 'baseline' | 'fee';
  /** حركة أنشأها هذا النظام في الخزنة (فارغ لو طوبقت مع حركة موجودة) */
  createdTxId: string;
  /** حركة موجودة في الخزنة طوبقت مع الرسالة */
  matchedTxId: string;
  signedAmount: number;
  at: string;
}

interface LinkSettings {
  intakeKey: string;
  unknownSenders: { sender: string; count: number; lastAt: string }[];
  devices: { id: string; lastSeenAt: string; battery: number | null }[];
}

export interface IntakeResult {
  status: 'recorded' | 'duplicate' | 'disabled' | 'unknown_sender' | 'ambiguous' | 'ignored' | 'empty';
  accountId: string;
  message: string;
}

export class LinkedAccountsError extends Error {
  code: 'INVALID_INPUT' | 'NOT_FOUND' | 'UNAUTHORIZED';
  constructor(code: 'INVALID_INPUT' | 'NOT_FOUND' | 'UNAUTHORIZED', message: string) {
    super(message);
    this.name = 'LinkedAccountsError';
    this.code = code;
  }
}

export interface LinkedAccountsOptions {
  getCashboxes: () => any[];
  getCashboxTransactions: () => any[];
  now?: () => Date;
}

const MAX_MESSAGES_PER_ACCOUNT = 3000;
const BANK_USER = 'النظام (رسائل البنك)';
const BANK_NOTE = 'bank-link';
const round2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) < 0.011;
const clean = (value: unknown, max = 200) => String(value ?? '').trim().slice(0, max);
const senderKey = (value: unknown) => normalizeMessageText(String(value ?? ''));

export class LinkedAccounts {
  private accounts: LinkedAccount[] = [];
  private messages: StoredMessage[] = [];
  private postings: Posting[] = [];
  private templates: PaymentTemplate[] = [];
  private settings: LinkSettings = { intakeKey: '', unknownSenders: [], devices: [] };
  private getCashboxes: () => any[];
  private getCashboxTransactions: () => any[];
  private now: () => Date;

  constructor(options: LinkedAccountsOptions) {
    this.getCashboxes = options.getCashboxes;
    this.getCashboxTransactions = options.getCashboxTransactions;
    this.now = options.now || (() => new Date());
  }

  /** تُضاف إلى قائمة مجموعات الحفظ في server.ts ليُحفظ كل شيء مع حركة الخزنة في عملية واحدة */
  collections(): CollectionDef[] {
    return [
      { name: 'bank.accounts', kind: 'list', get: () => this.accounts, set: v => { this.accounts = v; }, idOf: d => d.id },
      { name: 'bank.messages', kind: 'list', get: () => this.messages, set: v => { this.messages = v; }, idOf: d => d.id },
      { name: 'bank.postings', kind: 'list', get: () => this.postings, set: v => { this.postings = v; }, idOf: d => d.key },
      { name: 'bank.templates', kind: 'list', get: () => this.templates, set: v => { this.templates = v; }, idOf: d => d.id },
      {
        name: 'bank.settings',
        kind: 'single',
        get: () => this.settings,
        set: v => {
          this.settings = {
            intakeKey: clean(v?.intakeKey, 100),
            unknownSenders: Array.isArray(v?.unknownSenders) ? v.unknownSenders : [],
            devices: Array.isArray(v?.devices) ? v.devices : []
          };
        }
      }
    ];
  }

  // ---- مفتاح الاستقبال -----------------------------------------------------

  getIntakeKey(): string {
    if (!this.settings.intakeKey) this.settings.intakeKey = `mq_${randomBytes(18).toString('hex')}`;
    return this.settings.intakeKey;
  }

  regenerateIntakeKey(): string {
    this.settings.intakeKey = `mq_${randomBytes(18).toString('hex')}`;
    return this.settings.intakeKey;
  }

  isValidIntakeKey(key: unknown): boolean {
    const given = clean(key, 100);
    return Boolean(given) && Boolean(this.settings.intakeKey) && given === this.settings.intakeKey;
  }

  // ---- الحسابات المربوطة ----------------------------------------------------

  listAccounts(): LinkedAccount[] {
    return this.accounts.map(a => ({ ...a, senders: [...a.senders] }));
  }

  saveAccount(input: Partial<LinkedAccount> & { name: string; cashboxId: string; senders: string[] }): LinkedAccount {
    const name = clean(input.name, 80);
    if (!name) throw new LinkedAccountsError('INVALID_INPUT', 'اكتب اسمًا للحساب المربوط');
    const cashbox = this.getCashboxes().find(c => c.id === input.cashboxId);
    if (!cashbox) throw new LinkedAccountsError('INVALID_INPUT', 'اختر خزنة موجودة لربطها');
    const senders = Array.from(new Set((Array.isArray(input.senders) ? input.senders : []).map(s => clean(s, 80)).filter(Boolean)));
    if (senders.length === 0) throw new LinkedAccountsError('INVALID_INPUT', 'أضف مرسلًا واحدًا على الأقل (اسم البنك في الرسائل أو اسم التطبيق)');
    const accountSuffix = clean(input.accountSuffix, 8).replace(/\D/g, '');
    const windowMinutes = Number(input.matchWindowMinutes);
    const matchWindowMinutes = Number.isFinite(windowMinutes) && windowMinutes >= 1 && windowMinutes <= 1440 ? Math.round(windowMinutes) : 30;

    const existing = input.id ? this.accounts.find(a => a.id === input.id) : undefined;
    if (input.id && !existing) throw new LinkedAccountsError('NOT_FOUND', 'الحساب المربوط غير موجود');
    const other = this.accounts.find(a => a.cashboxId === input.cashboxId && a.id !== existing?.id);
    if (other) throw new LinkedAccountsError('INVALID_INPUT', `هذه الخزنة مربوطة بالفعل بالحساب «${other.name}»`);
    // نفس المرسل لأكثر من حساب: لازم كل حساب يكون له آخر أرقام مختلفة
    for (const a of this.accounts) {
      if (a.id === existing?.id) continue;
      const shared = a.senders.some(s => senders.some(x => senderKey(x) === senderKey(s)));
      if (shared && (!accountSuffix || !a.accountSuffix || a.accountSuffix === accountSuffix)) {
        throw new LinkedAccountsError('INVALID_INPUT', `المرسل مشترك مع الحساب «${a.name}». اكتب آخر أرقام الحساب لكل منهما حتى تُوزَّع الرسائل صح`);
      }
    }

    if (existing) {
      const cashboxChanged = existing.cashboxId !== input.cashboxId;
      if (cashboxChanged && this.postings.some(p => p.accountId === existing.id)) {
        throw new LinkedAccountsError('INVALID_INPUT', 'لا يمكن تغيير الخزنة بعد تسجيل حركات. أوقف هذا الحساب وأنشئ حسابًا جديدًا');
      }
      Object.assign(existing, { name, cashboxId: input.cashboxId, senders, accountSuffix, matchWindowMinutes });
      if (typeof input.enabled === 'boolean') existing.enabled = input.enabled;
      return { ...existing };
    }
    const account: LinkedAccount = {
      id: `la-${randomBytes(6).toString('hex')}`,
      name,
      cashboxId: input.cashboxId,
      enabled: input.enabled !== false,
      senders,
      accountSuffix,
      matchWindowMinutes,
      createdAt: this.now().toISOString(),
      lastMessageAt: ''
    };
    this.accounts.push(account);
    this.getIntakeKey();
    return { ...account };
  }

  /** زر التفعيل / الإيقاف */
  setAccountEnabled(id: string, enabled: boolean): LinkedAccount {
    const account = this.accounts.find(a => a.id === id);
    if (!account) throw new LinkedAccountsError('NOT_FOUND', 'الحساب المربوط غير موجود');
    account.enabled = Boolean(enabled);
    return { ...account };
  }

  /** حذف الربط فقط: حركات الخزنة المسجلة تبقى كما هي */
  deleteAccount(id: string): void {
    if (!this.accounts.some(a => a.id === id)) throw new LinkedAccountsError('NOT_FOUND', 'الحساب المربوط غير موجود');
    this.accounts = this.accounts.filter(a => a.id !== id);
    this.messages = this.messages.filter(m => m.accountId !== id);
    this.postings = this.postings.filter(p => p.accountId !== id);
  }

  // ---- القوالب ----------------------------------------------------------------

  listTemplates(): PaymentTemplate[] {
    return this.templates.map(t => ({ ...t }));
  }

  suggestTemplate(text: string) {
    return suggestTemplate(clean(text, 2000));
  }

  /** تجربة قراءة رسالة بالقوالب الحالية (لشاشة التجربة) */
  testMessage(text: string, sender: string) {
    return readPaymentMessage(clean(text, 2000), { sender: clean(sender, 80), templates: this.templates });
  }

  saveTemplate(input: Partial<PaymentTemplate> & { name: string; pattern: string }): PaymentTemplate {
    const name = clean(input.name, 80);
    const pattern = clean(input.pattern, 2000);
    if (!name) throw new LinkedAccountsError('INVALID_INPUT', 'اكتب اسمًا للقالب');
    const direction = input.direction && ['in', 'out', 'ignore', 'auto'].includes(input.direction) ? input.direction : 'auto';
    try {
      const compiled = compileTemplate(pattern);
      if (direction !== 'ignore' && !compiled.slots.includes('amount')) {
        throw new Error('القالب يجب أن يحتوي خانة {المبلغ}');
      }
    } catch (err: any) {
      throw new LinkedAccountsError('INVALID_INPUT', String(err?.message || 'القالب غير صالح'));
    }
    const sender = clean(input.sender, 80) || '*';
    const existing = input.id ? this.templates.find(t => t.id === input.id) : undefined;
    if (input.id && !existing) throw new LinkedAccountsError('NOT_FOUND', 'القالب غير موجود');
    if (existing) {
      Object.assign(existing, { name, pattern, direction, sender, enabled: input.enabled !== false });
    } else {
      this.templates.push({ id: `tpl-${randomBytes(6).toString('hex')}`, name, pattern, direction, sender, enabled: input.enabled !== false });
    }
    // القوالب تغيّر قراءة الرسائل: نعيد حساب كل الحسابات المفعّلة
    for (const account of this.accounts) if (account.enabled) this.reconcile(account);
    return { ...(existing || this.templates[this.templates.length - 1]) };
  }

  deleteTemplate(id: string): void {
    if (!this.templates.some(t => t.id === id)) throw new LinkedAccountsError('NOT_FOUND', 'القالب غير موجود');
    this.templates = this.templates.filter(t => t.id !== id);
    for (const account of this.accounts) if (account.enabled) this.reconcile(account);
  }

  exportTemplates(): PaymentTemplate[] {
    return this.listTemplates();
  }

  importTemplates(list: unknown): number {
    if (!Array.isArray(list)) throw new LinkedAccountsError('INVALID_INPUT', 'ملف القوالب غير صالح');
    let added = 0;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const duplicate = this.templates.some(t => t.pattern === (item as any).pattern && t.sender === ((item as any).sender || '*'));
      if (duplicate) continue;
      this.saveTemplate({ name: (item as any).name, pattern: (item as any).pattern, direction: (item as any).direction, sender: (item as any).sender, enabled: (item as any).enabled !== false });
      added++;
    }
    return added;
  }

  // ---- استقبال الرسائل من الهاتف -----------------------------------------------

  heartbeat(deviceId: unknown, battery: unknown): void {
    const id = clean(deviceId, 60) || 'phone';
    const level = Number(battery);
    const entry = { id, lastSeenAt: this.now().toISOString(), battery: Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : null };
    this.settings.devices = [entry, ...this.settings.devices.filter(d => d.id !== id)].slice(0, 10);
  }

  private parseTime(value: unknown): string {
    const nowMs = this.now().getTime();
    let ms = NaN;
    if (typeof value === 'number' || /^\d{10,13}$/.test(String(value ?? ''))) {
      const n = Number(value);
      ms = n < 1e12 ? n * 1000 : n;
    } else if (value) {
      ms = Date.parse(String(value));
    }
    if (!Number.isFinite(ms) || ms > nowMs + 5 * 60 * 1000 || ms < nowMs - 30 * 24 * 60 * 60 * 1000) ms = nowMs;
    return new Date(ms).toISOString();
  }

  /** يستقبل رسالة واحدة من تطبيق الهاتف. آمن للتكرار */
  intake(input: { sender?: unknown; text?: unknown; at?: unknown; deviceId?: unknown; battery?: unknown }): IntakeResult {
    if (input.deviceId !== undefined || input.battery !== undefined) this.heartbeat(input.deviceId, input.battery);
    const sender = clean(input.sender, 80);
    const text = clean(input.text, 2000);
    if (!sender || !text) return { status: 'empty', accountId: '', message: 'رسالة بدون مرسل أو بدون نص' };
    const key = senderKey(sender);

    const matching = this.accounts.filter(a => a.senders.some(s => senderKey(s) === key || key.includes(senderKey(s))));
    if (matching.length === 0) {
      // مرسل غير معرّف: لا نخزن نص الرسالة (قد تكون شخصية) — نسجل اسم المرسل فقط للمساعدة في الإعداد
      const nowIso = this.now().toISOString();
      const known = this.settings.unknownSenders.find(u => u.sender === sender);
      if (known) {
        known.count += 1;
        known.lastAt = nowIso;
      } else {
        this.settings.unknownSenders = [{ sender, count: 1, lastAt: nowIso }, ...this.settings.unknownSenders].slice(0, 30);
      }
      return { status: 'unknown_sender', accountId: '', message: 'مرسل غير مربوط بأي خزنة' };
    }

    // رموز التحقق والإعلانات لا تُخزَّن إطلاقًا
    const reading = readPaymentMessage(text, { sender, templates: this.templates });
    if (reading.kind === 'ignored') return { status: 'ignored', accountId: '', message: reading.note || 'رسالة ليست حركة مالية' };

    let account: LinkedAccount | undefined;
    if (matching.length === 1) {
      account = matching[0];
    } else {
      account = matching.find(a => a.accountSuffix && reading.accountSuffix && reading.accountSuffix.endsWith(a.accountSuffix));
      if (!account) return { status: 'ambiguous', accountId: '', message: 'المرسل مشترك بين أكثر من خزنة والرسالة لا تحدد رقم الحساب' };
    }
    if (!account.enabled) return { status: 'disabled', accountId: account.id, message: 'الحساب المربوط موقوف' };

    const at = this.parseTime(input.at);
    const id = createHash('sha1').update(`${account.id}|${key}|${normalizeMessageText(text)}|${at.slice(0, 16)}`).digest('hex').slice(0, 24);
    if (this.messages.some(m => m.id === id)) return { status: 'duplicate', accountId: account.id, message: 'الرسالة مسجلة من قبل' };

    this.messages.push({ id, accountId: account.id, sender, text, at, receivedAt: this.now().toISOString() });
    account.lastMessageAt = at;
    const mine = this.messages.filter(m => m.accountId === account!.id);
    if (mine.length > MAX_MESSAGES_PER_ACCOUNT) {
      const drop = new Set(mine.sort((a, b) => (a.at < b.at ? -1 : 1)).slice(0, mine.length - MAX_MESSAGES_PER_ACCOUNT).map(m => m.id));
      this.messages = this.messages.filter(m => !drop.has(m.id));
    }
    this.reconcile(account);
    return { status: 'recorded', accountId: account.id, message: 'تم تسجيل الرسالة' };
  }

  // ---- المطابقة والتسجيل في الخزنة ---------------------------------------------

  private streamOf(account: LinkedAccount): StreamResult {
    const messages: IncomingMessage[] = this.messages.filter(m => m.accountId === account.id).map(m => ({ id: m.id, sender: m.sender, text: m.text, at: m.at }));
    return computeStream(messages, this.templates);
  }

  private postToCashbox(account: LinkedAccount, signedAmount: number, at: string, statement: string, party: string, documentNumber: string): string {
    const cashbox = this.getCashboxes().find(c => c.id === account.cashboxId);
    if (!cashbox) return '';
    cashbox.currentBalance = round2((Number(cashbox.currentBalance) || 0) + signedAmount);
    const id = `btx-${randomBytes(8).toString('hex')}`;
    this.getCashboxTransactions().push({
      id,
      date: at,
      cashboxId: cashbox.id,
      cashboxName: cashbox.name,
      type: signedAmount >= 0 ? 'إيداع' : 'سحب',
      documentNumber,
      amount: round2(signedAmount),
      balanceAfter: cashbox.currentBalance,
      party,
      statement,
      userName: BANK_USER,
      notes: BANK_NOTE
    });
    return id;
  }

  private findSystemTransaction(account: LinkedAccount, signedAmount: number, at: string): any | null {
    const taken = new Set(this.postings.filter(p => p.matchedTxId).map(p => p.matchedTxId));
    const windowMs = account.matchWindowMinutes * 60 * 1000;
    const target = Date.parse(at);
    let best: any = null;
    let bestDistance = Infinity;
    for (const tx of this.getCashboxTransactions()) {
      if (tx.cashboxId !== account.cashboxId || tx.notes === BANK_NOTE || taken.has(tx.id)) continue;
      if (!near(Number(tx.amount) || 0, signedAmount)) continue;
      const distance = Math.abs((Date.parse(tx.date) || 0) - target);
      if (distance <= windowMs && distance < bestDistance) {
        best = tx;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** يعيد حساب حركات الحساب من رسائله ويسجل في الخزنة ما لم يُسجَّل، ويعكس ما لم يعد صحيحًا */
  private reconcile(account: LinkedAccount): void {
    const stream = this.streamOf(account);
    const short = (id: string) => id.slice(0, 8).toUpperCase();

    interface Wanted {
      key: string;
      kind: Posting['kind'];
      signedAmount: number;
      at: string;
      statement: string;
      party: string;
      aliases: string[];
      matchable: boolean;
    }
    const wanted: Wanted[] = [];
    stream.entries.forEach((entry: StreamEntry) => {
      if (entry.verifiedBy === 'baseline') {
        wanted.push({ key: `baseline:${entry.messageId}`, kind: 'baseline', signedAmount: 0, at: entry.at, statement: 'مطابقة رصيد الخزنة مع رصيد البنك عند بدء الربط', party: '', aliases: [], matchable: false });
        return;
      }
      if (entry.direction === 'unknown') return; // تظهر في المراجعة ولا تُسجَّل حتى تتضح
      const sign = entry.direction === 'out' ? -1 : 1;
      wanted.push({
        key: `entry:${entry.messageId}`,
        kind: 'entry',
        signedAmount: round2(sign * entry.amount),
        at: entry.at,
        statement: entry.direction === 'in' ? 'تحويل وارد غير مصنف (من رسائل البنك)' : 'خصم بنكي غير مصنف (من رسائل البنك)',
        party: entry.counterparty,
        aliases: entry.mergedMessageIds.map(id => `entry:${id}`),
        matchable: true
      });
      if (entry.fee > 0) {
        wanted.push({ key: `fee:${entry.messageId}`, kind: 'fee', signedAmount: round2(-entry.fee), at: entry.at, statement: 'رسوم بنكية (من رسائل البنك)', party: '', aliases: [], matchable: true });
      }
    });
    for (const gap of stream.gaps) {
      wanted.push({ key: `gap:${gap.beforeMessageId}:${gap.amount}`, kind: 'gap', signedAmount: gap.amount, at: gap.at, statement: 'فرق غير مفسَّر — رسالة بنك ناقصة', party: '', aliases: [], matchable: false });
    }

    const mine = this.postings.filter(p => p.accountId === account.id);
    const wantedKeys = new Set(wanted.map(w => w.key));

    // 1) تسجيلات لم تعد مطلوبة: تُنقل لو الرسالة دُمجت في أخرى، وإلا تُعكس
    for (const posting of mine) {
      if (wantedKeys.has(posting.key)) continue;
      const heir = wanted.find(w => w.aliases.includes(posting.key) && !mine.some(p => p.key === w.key));
      if (heir) {
        posting.key = heir.key;
        continue;
      }
      if (posting.createdTxId && !near(posting.signedAmount, 0)) {
        this.postToCashbox(account, -posting.signedAmount, this.now().toISOString(), 'تصحيح تلقائي بعد وصول رسالة بنك متأخرة', '', `BNK-${short(posting.key.split(':')[1] || posting.key)}-R`);
      }
      this.postings = this.postings.filter(p => p !== posting);
    }

    // 2) تسجيلات مطلوبة وغير موجودة
    for (const item of wanted) {
      if (this.postings.some(p => p.accountId === account.id && p.key === item.key)) continue;
      const posting: Posting = { key: item.key, accountId: account.id, kind: item.kind, createdTxId: '', matchedTxId: '', signedAmount: item.signedAmount, at: item.at };
      if (item.kind === 'baseline') {
        const entry = stream.entries.find(e => `baseline:${e.messageId}` === item.key)!;
        const cashbox = this.getCashboxes().find(c => c.id === account.cashboxId);
        const difference = round2((entry.balanceAfter || 0) - (Number(cashbox?.currentBalance) || 0));
        posting.signedAmount = difference;
        if (!near(difference, 0)) posting.createdTxId = this.postToCashbox(account, difference, item.at, item.statement, '', `BNK-${short(entry.messageId)}`);
      } else {
        const existing = item.matchable ? this.findSystemTransaction(account, item.signedAmount, item.at) : null;
        if (existing) posting.matchedTxId = existing.id;
        else posting.createdTxId = this.postToCashbox(account, item.signedAmount, item.at, item.statement, item.party, `BNK-${short(item.key.split(':')[1] || item.key)}`);
      }
      this.postings.push(posting);
    }
  }

  // ---- العرض -------------------------------------------------------------------

  getOverview() {
    const nowMs = this.now().getTime();
    const accounts = this.accounts.map(account => {
      const cashbox = this.getCashboxes().find(c => c.id === account.cashboxId);
      const stream = this.streamOf(account);
      const mine = this.postings.filter(p => p.accountId === account.id);
      const matched = new Set(mine.filter(p => p.matchedTxId).map(p => p.matchedTxId));
      const windowMs = account.matchWindowMinutes * 60 * 1000;
      const linkedSince = Date.parse(account.createdAt) || 0;
      const baseline = stream.entries.find(e => e.verifiedBy === 'baseline');
      const since = Math.max(linkedSince, baseline ? Date.parse(baseline.at) || 0 : Infinity);
      // حركات النظام على الخزنة التي لم تصل رسالتها من البنك بعد
      const pending = this.getCashboxTransactions()
        .filter(tx => tx.cashboxId === account.cashboxId && tx.notes !== BANK_NOTE && !matched.has(tx.id) && (Date.parse(tx.date) || 0) > since)
        .map(tx => ({
          id: tx.id,
          date: tx.date,
          amount: Number(tx.amount) || 0,
          statement: tx.statement || tx.type || '',
          documentNumber: tx.documentNumber || '',
          userName: tx.userName || '',
          overdue: nowMs - (Date.parse(tx.date) || nowMs) > windowMs
        }));
      const entries = stream.entries.map(entry => {
        const posting = mine.find(p => p.key === `entry:${entry.messageId}` || p.key === `baseline:${entry.messageId}`);
        const state = entry.verifiedBy === 'baseline' ? 'baseline' : entry.direction === 'unknown' ? 'needs_review' : posting?.matchedTxId ? 'matched' : 'unclassified';
        return {
          ...entry,
          state,
          stateLabel: state === 'baseline' ? 'رصيد بدء الربط' : state === 'needs_review' ? 'تحتاج مراجعة' : state === 'matched' ? 'مطابقة لحركة في النظام' : 'غير مصنفة',
          matchedTxId: posting?.matchedTxId || '',
          createdTxId: posting?.createdTxId || ''
        };
      });
      return {
        ...account,
        cashboxName: cashbox?.name || '',
        cashboxMissing: !cashbox,
        bankBalance: stream.currentBalance,
        lastConfirmedBalance: stream.lastConfirmedBalance,
        bookBalance: cashbox ? round2(Number(cashbox.currentBalance) || 0) : null,
        pendingTotal: round2(pending.reduce((sum, p) => sum + p.amount, 0)),
        pending,
        gaps: stream.gaps,
        unknownMessages: stream.unknown,
        entries: entries.slice(-200).reverse()
      };
    });
    return {
      accounts,
      unknownSenders: this.settings.unknownSenders,
      devices: this.settings.devices.map(d => ({ ...d, online: nowMs - (Date.parse(d.lastSeenAt) || 0) < 15 * 60 * 1000 }))
    };
  }

  /** نص رسالة محفوظة (لمن معه صلاحية التعريف فقط) */
  getMessageText(messageId: string): { sender: string; text: string; at: string } | null {
    const message = this.messages.find(m => m.id === messageId);
    return message ? { sender: message.sender, text: message.text, at: message.at } : null;
  }

  // ---- إعادة الضبط -------------------------------------------------------------

  /** مع «إعادة ضبط العمليات»: تُمسح الرسائل والتسجيلات ويبقى تعريف الحسابات والقوالب */
  resetOperationsState(): void {
    this.messages = [];
    this.postings = [];
    for (const account of this.accounts) account.lastMessageAt = '';
  }

  /** مع «إعادة ضبط المصنع»: يُمسح كل شيء */
  resetAll(): void {
    this.accounts = [];
    this.messages = [];
    this.postings = [];
    this.templates = [];
    this.settings = { intakeKey: '', unknownSenders: [], devices: [] };
  }
}

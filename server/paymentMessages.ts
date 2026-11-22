/**
 * قارئ رسائل الدفع (بنوك / محافظ / إنستا باي) — POS مدقق
 * ---------------------------------------------------------------------------
 * الهدف: دور العميل شبه معدوم. لا قوالب تُكتب ولا إعداد لكل بنك:
 *   1) القراءة: الرسالة (عربي أو إنجليزي) تُفهم بالكلمات المفتاحية: داخل/خارج، المبلغ،
 *      الرصيد، آخر أرقام الحساب، اسم الطرف الآخر. أكواد التحقق والإعلانات تُتجاهل.
 *   2) المراجعة بالحساب: لو الرسائل فيها رصيد، يُراجَع كل شيء بالمعادلة
 *      (الرصيد السابق ± المبلغ = الرصيد الجديد). لو القراءة أخطأت الاتجاه أو المبلغ
 *      تُصحَّح تلقائيًا من الحساب، ولو ضاعت رسالة يظهر «فرق غير مفسَّر».
 *   3) الدمج: إشعار التطبيق ورسالة البنك لنفس الحركة يُحسبان حركة واحدة.
 * كل الدوال هنا خالصة (بدون حالة ولا شبكة) ليسهل اختبارها.
 *
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */

export type MessageDirection = 'in' | 'out' | 'unknown';

export interface IncomingMessage {
  id: string;
  /** اسم مرسل الرسالة النصية أو اسم حزمة التطبيق صاحب الإشعار */
  sender: string;
  text: string;
  /** وقت الرسالة على الهاتف (ISO) */
  at: string;
}

export interface MessageReading {
  kind: 'transaction' | 'ignored' | 'unknown';
  /** سبب التجاهل أو عدم الفهم (عربي) */
  note: string;
  direction: MessageDirection;
  amount: number | null;
  balance: number | null;
  /** آخر أرقام الحساب أو البطاقة إن ظهرت في الرسالة */
  accountSuffix: string;
  counterparty: string;
  reference: string;
  /** أرقام أخرى في الرسالة قد تكون المبلغ الحقيقي أو رسومًا (تُستخدم في المراجعة بالحساب) */
  otherNumbers: number[];
  /** رسوم محددة صراحة في القالب */
  fee?: number;
  /** template = قُرئت بقالب معرَّف، auto = قُرئت تلقائيًا */
  readBy?: 'template' | 'auto';
  templateId?: string;
}

/**
 * قالب قراءة لمرسل معيّن — يعرّفه فريق مدقق من الإعدادات عند الحاجة لدقة أعلى.
 * النص يُكتب كما في الرسالة مع وضع خانات مكان القيم المتغيرة:
 *   {المبلغ} {الرصيد} {الحساب} {الاسم} {المرجع} {الرسوم} {تجاهل}
 * مثال: تم إيداع مبلغ {المبلغ} جم في حسابك رقم ****{الحساب} {تجاهل} الرصيد المتاح {الرصيد} جم
 */
export interface PaymentTemplate {
  id: string;
  name: string;
  /** اسم المرسل الذي يطبَّق عليه القالب، أو * لكل المرسلين */
  sender: string;
  pattern: string;
  /** in = داخل، out = خارج، ignore = رسالة تُتجاهل، auto = يُحدَّد من الكلمات ثم من الرصيد */
  direction: 'in' | 'out' | 'ignore' | 'auto';
  enabled: boolean;
}

export interface StreamEntry {
  messageId: string;
  /** معرّفات رسائل أخرى تصف نفس الحركة ودُمجت في هذه */
  mergedMessageIds: string[];
  sender: string;
  at: string;
  direction: MessageDirection;
  amount: number;
  fee: number;
  balanceAfter: number | null;
  counterparty: string;
  reference: string;
  /** balance = مؤكدة بمعادلة الرصيد، baseline = أول رصيد معروف، none = لا يوجد رصيد للمراجعة */
  verifiedBy: 'balance' | 'baseline' | 'none';
  corrections: string[];
}

export interface StreamGap {
  /** قبل أي رسالة ظهر الفرق */
  beforeMessageId: string;
  at: string;
  /** موجب = دخل مبلغ غير مسجل، سالب = خرج مبلغ غير مسجل */
  amount: number;
}

export interface StreamResult {
  entries: StreamEntry[];
  gaps: StreamGap[];
  /** آخر رصيد مؤكد من رسالة */
  lastConfirmedBalance: number | null;
  /** الرصيد الحالي المتوقع = آخر رصيد مؤكد ± الحركات التي بعده بلا رصيد */
  currentBalance: number | null;
  ignored: number;
  unknown: { messageId: string; note: string }[];
}

const TOLERANCE = 0.011;
const MERGE_WINDOW_MS = 5 * 60 * 1000;

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// التطبيع
// ---------------------------------------------------------------------------

/** يوحّد الأرقام والحروف حتى تُقرأ الرسالة العربية والإنجليزية بنفس القواعد */
export function normalizeMessageText(raw: string): string {
  let text = String(raw ?? '');
  // أرقام عربية وفارسية ← لاتينية
  text = text.replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06f0));
  // فواصل الأرقام العربية
  text = text.replace(/\u066B/g, '.').replace(/\u066C/g, ',');
  // علامات اتجاه ومحارف مخفية
  text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').replace(/\u00A0/g, ' ');
  // تشكيل وتطويل
  text = text.replace(/[\u064B-\u0652\u0670\u0640]/g, '');
  // توحيد الألف والياء والتاء المربوطة
  text = text.replace(/[آأإ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// القواميس (بعد التطبيع: أ/إ/آ ← ا ، ى ← ي ، ة ← ه)
// ---------------------------------------------------------------------------

const OTP_WORDS = /(otp|one[- ]time|verification code|passcode|password|رمز التحقق|كود التحقق|رمز التفعيل|كود التفعيل|الرقم السري|كلمه السر|كلمه المرور|رمز الدخول|لا تشارك|do not share|don't share)/;

const IN_PHRASES: [RegExp, number][] = [
  [/(الي|في|علي|ل)\s?حسابك|لحسابكم|الي محفظتك|في محفظتك|to your (account|wallet|card)|into your (account|wallet)/, 3],
  [/تحويل وارد|حواله وارده|incoming transfer|تم استلام|استلمت|تم استقبال|received|credited|has been credited/, 4],
  [/ايداع|تم اضافه|اضيف|اضافه مبلغ|deposit|deposited|refund|استرداد|رد مبلغ|added to/, 3],
  [/\bcredit\b|وارد/, 1]
];

const OUT_PHRASES: [RegExp, number][] = [
  [/من حسابك|من حسابكم|من محفظتك|من بطاقتك|from your (account|wallet|card)/, 3],
  [/تحويل صادر|حواله صادره|outgoing transfer|debited|has been debited|withdrawn|withdrawal|تم خصم|خصم مبلغ|تم سحب|سحب نقدي|سحب مبلغ/, 4],
  [/شراء|مشتريات|عمليه شراء|purchase|spent|charged|paid to|payment to|تم دفع|سداد|sent to|تم ارسال|ارسلت/, 3],
  [/\bdebit\b|صادر|رسوم|مصاريف|fees?\b/, 1]
];

const BALANCE_WORDS = /(الرصيد المتاح|رصيدك المتاح|رصيدك الحالي|الرصيد الحالي|رصيد حسابك|رصيد محفظتك|رصيدك|الرصيد|رصيد|المتاح|available balance|avail?\.? ?bal(?:ance)?\.?|avl\.? ?bal(?:ance)?\.?|current balance|new balance|balance|\bbal\b)/g;
const AMOUNT_WORDS = /(بمبلغ|مبلغ وقدره|مبلغ|قيمته|بقيمه|قيمه|amount of|amount|amt|of egp|for egp)/g;
const CURRENCY = '(?:egp|e\\.g\\.p|l\\.e\\.?|le|جنيها|جنيه|جم|ج\\.م\\.?|ج م)';
const ACCOUNT_WORDS = '(?:حساب(?:ك|كم)?(?: رقم)?|بطاقه(?: رقم)?|بطاقتك|كارت|محفظه|account(?: no\\.?| number)?|a\\/c|acct?\\.?|card(?: no\\.?| number)?|ending(?: with| in)?|المنتهي(?:ه)? ب|تنتهي ب|رقم)';

// ---------------------------------------------------------------------------
// القراءة
// ---------------------------------------------------------------------------

interface NumberToken {
  value: number;
  index: number;
  end: number;
  hasCurrency: boolean;
}

function parseNumber(token: string): number | null {
  let t = token;
  // فاصلة تتبعها 3 أرقام = فاصل آلاف، غير ذلك = علامة عشرية
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  const value = Number(t);
  return Number.isFinite(value) ? value : null;
}

function score(text: string, phrases: [RegExp, number][]): number {
  let total = 0;
  for (const [pattern, weight] of phrases) if (pattern.test(text)) total += weight;
  return total;
}

/**
 * يقرأ رسالة واحدة.
 * لو للمرسل قالب مطابق يُستخدم القالب (أدق)، وإلا تُقرأ الرسالة تلقائيًا بالكلمات المفتاحية.
 */
export function readPaymentMessage(rawText: string, options: { sender?: string; templates?: PaymentTemplate[] } = {}): MessageReading {
  if (options.templates && options.templates.length > 0) {
    const fromTemplate = readWithTemplates(rawText, options.sender || '', options.templates);
    if (fromTemplate) return fromTemplate;
  }
  return readAutomatically(rawText);
}

/** القراءة التلقائية بالكلمات المفتاحية (بدون قوالب) */
export function readAutomatically(rawText: string): MessageReading {
  const empty: MessageReading = { kind: 'unknown', note: '', direction: 'unknown', amount: null, balance: null, accountSuffix: '', counterparty: '', reference: '', otherNumbers: [] };
  const text = normalizeMessageText(rawText);
  if (!text) return { ...empty, kind: 'ignored', note: 'رسالة فارغة' };

  const inScore = score(text, IN_PHRASES);
  const outScore = score(text, OUT_PHRASES);
  const mentionsBalance = /رصيد|المتاح|balance|\bbal\b/.test(text);

  if (OTP_WORDS.test(text) && inScore + outScore < 4) {
    return { ...empty, kind: 'ignored', note: 'رمز تحقق أو رسالة أمان — لا تُسجَّل' };
  }

  // نعمل على نسخة تُحجب منها الأجزاء التي ليست مبالغ، مع الحفاظ على أطوال النص
  let work = text;
  const blank = (pattern: RegExp, keep?: (match: string, ...groups: string[]) => void) => {
    work = work.replace(pattern, (match: string, ...groups: any[]) => {
      if (keep) keep(match, ...groups);
      return ' '.repeat(match.length);
    });
  };

  // تواريخ وأوقات
  blank(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g);
  blank(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g);
  blank(/\b\d{1,2}[-/ ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/ ]\d{2,4}\b/g);
  blank(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:am|pm|ص|م))?(?!\d|\.\d)/g);

  // آخر أرقام الحساب/البطاقة: مقنّعة بنجوم أو x أو بعد كلمة حساب/بطاقة
  let accountSuffix = '';
  blank(/(?:[*x#•]{1,}[\s-]?){1,}(\d{3,6})\b/g, (_m, digits) => {
    if (!accountSuffix) accountSuffix = digits;
  });
  blank(new RegExp(`${ACCOUNT_WORDS}\\s*[:#-]?\\s*(\\d{3,6})(?!\\d|[.,]\\d)`, 'g'), (_m, digits) => {
    if (!accountSuffix) accountSuffix = digits;
  });

  // أرقام هواتف
  let phone = '';
  blank(/(?:\+?2)?01[0125]\d{8}\b/g, m => {
    if (!phone) phone = m;
  });

  // أرقام مرجعية طويلة
  let reference = '';
  blank(/\b[a-z]{0,4}\d{9,}\b/g, m => {
    if (!reference) reference = m.toUpperCase();
  });
  blank(/(?:ref(?:erence)?(?: no\.?| number)?|رقم مرجعي|الرقم المرجعي|مرجع|رقم العمليه|transaction (?:id|no\.?))\s*[:#-]?\s*([a-z0-9-]{4,})/g, (_m, ref) => {
    if (!reference) reference = String(ref).toUpperCase();
  });

  // الأرقام الباقية
  const numbers: NumberToken[] = [];
  const numberPattern = new RegExp(`(${CURRENCY}\\s?)?(\\d[\\d,]*(?:\\.\\d+)?)(\\s?${CURRENCY})?`, 'g');
  let match: RegExpExecArray | null;
  while ((match = numberPattern.exec(work)) !== null) {
    const value = parseNumber(match[2].replace(/,$/, ''));
    if (value === null) continue;
    numbers.push({ value, index: match.index, end: match.index + match[0].length, hasCurrency: Boolean(match[1] || match[3]) });
  }

  if (numbers.length === 0) {
    if (inScore + outScore === 0) return { ...empty, kind: 'ignored', note: 'رسالة ليست حركة مالية' };
    return { ...empty, kind: 'unknown', note: 'رسالة تبدو حركة مالية لكن لم يُعثر فيها على مبلغ', accountSuffix, reference };
  }
  if (inScore + outScore === 0 && !mentionsBalance) {
    return { ...empty, kind: 'ignored', note: 'رسالة ليست حركة مالية' };
  }

  // الرصيد: أول رقم بعد كلمة «رصيد» (وأقرب كلمة رصيد للرقم)
  const nearestAfter = (pattern: RegExp, maxDistance: number, exclude: Set<NumberToken>): NumberToken | null => {
    let best: NumberToken | null = null;
    let bestDistance = Infinity;
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(work)) !== null) {
      const from = m.index + m[0].length;
      for (const token of numbers) {
        if (exclude.has(token)) continue;
        const distance = token.index - from;
        if (distance >= -1 && distance <= maxDistance && distance < bestDistance) {
          best = token;
          bestDistance = distance;
        }
      }
    }
    return best;
  };

  const used = new Set<NumberToken>();
  const balanceToken = nearestAfter(BALANCE_WORDS, 30, used);
  if (balanceToken) used.add(balanceToken);

  // المبلغ: بعد كلمة «مبلغ»، وإلا أول رقم معه عملة، وإلا أول رقم باقٍ
  let amountToken = nearestAfter(AMOUNT_WORDS, 20, used);
  if (!amountToken) amountToken = numbers.find(t => !used.has(t) && t.hasCurrency) || null;
  if (!amountToken) amountToken = numbers.find(t => !used.has(t)) || null;
  if (amountToken) used.add(amountToken);

  if (!amountToken || !(amountToken.value > 0)) {
    return { ...empty, kind: 'unknown', note: 'لم يُعثر على مبلغ الحركة في الرسالة', balance: balanceToken ? balanceToken.value : null, accountSuffix, reference };
  }

  // الطرف الآخر (اسم أو رقم هاتف) — أفضل ما يمكن
  let counterparty = phone;
  if (!counterparty) {
    const party = /(?:^|\s)(?:من|from|الي|to|عند|لدي|at)\s+(?!حساب|محفظ|بطاق|your|رصيد)([^\d.,:;\n]{2,40}?)(?=\s+(?:بمبلغ|مبلغ|في|بتاريخ|رقم|الرصيد|رصيد|عبر|عن طريق|on|at|via|through|ref|avl|available|balance|amount|egp)(?:\s|$|[.,:;])|[.,:;]|\s*$|\s+\d)/.exec(work);
    if (party) {
      counterparty = party[1]
        .replace(/\s+(?:to account|to your|يوم|والرصيد|ورصيد|المتاح|الرصيد)(?:\s.*)?$/, '')
        .replace(/^(?:حساب|الرقم|رقم|account|acc)\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (/^(?:on|at|via|to|من|في|الي)?$/.test(counterparty)) counterparty = '';
    }
  }

  const direction: MessageDirection = inScore === outScore ? 'unknown' : inScore > outScore ? 'in' : 'out';
  const otherNumbers = numbers.filter(t => !used.has(t) && t.value > 0).map(t => t.value);

  return {
    kind: 'transaction',
    note: '',
    direction,
    amount: round2(amountToken.value),
    balance: balanceToken ? round2(balanceToken.value) : null,
    accountSuffix,
    counterparty,
    reference,
    otherNumbers,
    readBy: 'auto'
  };
}

// ---------------------------------------------------------------------------
// القوالب
// ---------------------------------------------------------------------------

const SLOT_NAMES: Record<string, 'amount' | 'balance' | 'account' | 'name' | 'reference' | 'fee' | 'skip'> = {
  'المبلغ': 'amount',
  'الرصيد': 'balance',
  'الحساب': 'account',
  'الاسم': 'name',
  'المرجع': 'reference',
  'الرسوم': 'fee',
  'تجاهل': 'skip'
};
const SLOT_REGEX: Record<string, string> = {
  amount: '(\\d[\\d,]*(?:\\.\\d+)?)',
  balance: '(\\d[\\d,]*(?:\\.\\d+)?)',
  fee: '(\\d[\\d,]*(?:\\.\\d+)?)',
  account: '(\\d{2,8})',
  name: '(.+?)',
  reference: '([a-z0-9-]+)',
  skip: '(?:.*?)'
};

export interface CompiledTemplate {
  regex: RegExp;
  slots: string[];
}

/** يحوّل نص القالب إلى نمط مطابقة. يرمي خطأ عربيًا لو القالب غير صالح */
export function compileTemplate(pattern: string): CompiledTemplate {
  const text = String(pattern ?? '');
  const slots: string[] = [];
  let source = '';
  let hasAmount = false;
  const parts = text.split(/(\{[^{}]*\})/);
  for (const part of parts) {
    if (!part) continue;
    const slotMatch = /^\{([^{}]*)\}$/.exec(part);
    if (slotMatch) {
      const type = SLOT_NAMES[slotMatch[1].trim()];
      if (!type) throw new Error(`خانة غير معروفة في القالب: ${part} — الخانات المتاحة: {المبلغ} {الرصيد} {الحساب} {الاسم} {المرجع} {الرسوم} {تجاهل}`);
      source += SLOT_REGEX[type];
      if (type !== 'skip') slots.push(type);
      if (type === 'amount') hasAmount = true;
      continue;
    }
    // النص الثابت يُطبَّع مثل الرسائل، والمسافات مرنة
    const literal = part.replace(/\s+/g, ' ');
    const normalized = normalizeMessageText(` ${literal} `.replace(/^ (?=\S)/, '').replace(/(?<=\S) $/, ''));
    const keepLead = /^\s/.test(literal) ? ' ' : '';
    const keepTail = /\s$/.test(literal) ? ' ' : '';
    source += `${keepLead}${normalized}${keepTail}`
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/ +/g, '\\s*');
  }
  if (!source.trim()) throw new Error('القالب فارغ');
  if (!hasAmount && !/\S/.test(text.replace(/\{[^{}]*\}/g, ''))) throw new Error('القالب يجب أن يحتوي نصًا ثابتًا من الرسالة');
  return { regex: new RegExp(`^\\s*${source}\\s*$`), slots };
}

const templateCache = new Map<string, CompiledTemplate | null>();
function compiled(template: PaymentTemplate): CompiledTemplate | null {
  const key = template.pattern;
  if (!templateCache.has(key)) {
    try {
      templateCache.set(key, compileTemplate(template.pattern));
    } catch {
      templateCache.set(key, null);
    }
  }
  return templateCache.get(key) || null;
}

/** يجرّب قوالب المرسل بالترتيب. يرجع null لو لا قالب مطابق */
export function readWithTemplates(rawText: string, sender: string, templates: PaymentTemplate[]): MessageReading | null {
  const text = normalizeMessageText(rawText);
  const senderKey = String(sender || '').trim().toLowerCase();
  for (const template of templates) {
    if (!template.enabled) continue;
    const templateSender = String(template.sender || '').trim().toLowerCase();
    if (templateSender !== '*' && templateSender !== senderKey) continue;
    const compiledTemplate = compiled(template);
    if (!compiledTemplate) continue;
    const match = compiledTemplate.regex.exec(text);
    if (!match) continue;

    if (template.direction === 'ignore') {
      return { kind: 'ignored', note: `رسالة تُتجاهل حسب القالب «${template.name}»`, direction: 'unknown', amount: null, balance: null, accountSuffix: '', counterparty: '', reference: '', otherNumbers: [], readBy: 'template', templateId: template.id };
    }
    const values: Record<string, string> = {};
    compiledTemplate.slots.forEach((slot, index) => {
      if (values[slot] === undefined) values[slot] = match[index + 1] || '';
    });
    const amount = values.amount !== undefined ? parseNumber(values.amount.replace(/,$/, '')) : null;
    if (amount === null || !(amount > 0)) continue;
    const balance = values.balance !== undefined ? parseNumber(values.balance.replace(/,$/, '')) : null;
    const fee = values.fee !== undefined ? parseNumber(values.fee.replace(/,$/, '')) : null;
    let direction: MessageDirection = template.direction === 'in' || template.direction === 'out' ? template.direction : 'unknown';
    if (template.direction === 'auto') {
      const auto = readAutomatically(rawText);
      direction = auto.direction;
    }
    return {
      kind: 'transaction',
      note: '',
      direction,
      amount: round2(amount),
      balance: balance === null ? null : round2(balance),
      accountSuffix: values.account || '',
      counterparty: (values.name || '').trim(),
      reference: (values.reference || '').toUpperCase(),
      otherNumbers: [],
      fee: fee === null ? undefined : round2(fee),
      readBy: 'template',
      templateId: template.id
    };
  }
  return null;
}

/**
 * يقترح قالبًا من رسالة حقيقية: يقرأها تلقائيًا ثم يضع الخانات مكان القيم التي فهمها.
 * فريق مدقق يراجع الاقتراح ويعدّله قبل الحفظ.
 */
export function suggestTemplate(rawText: string): { pattern: string; direction: PaymentTemplate['direction']; reading: MessageReading } {
  const reading = readAutomatically(rawText);
  let pattern = normalizeMessageText(rawText);
  const hide = (regex: RegExp, slot: string) => {
    pattern = pattern.replace(regex, slot);
  };
  hide(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, '{تجاهل}');
  hide(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '{تجاهل}');
  hide(/\b\d{1,2}[-/ ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/ ]\d{2,4}\b/g, '{تجاهل}');
  hide(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:am|pm|ص|م))?(?!\d|\.\d)/g, '{تجاهل}');
  hide(/(?:\+?2)?01[0125]\d{8}\b/g, '{الاسم}');
  hide(/\b[a-z]{0,4}\d{9,}\b/g, '{المرجع}');
  const numberText = (value: number) => {
    const fixed = value.toFixed(2);
    const [whole, fraction] = fixed.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return [`${grouped}.${fraction}`, `${whole}.${fraction}`, fraction === '00' ? grouped : '', fraction === '00' ? whole : '', fraction.endsWith('0') && fraction !== '00' ? `${whole}.${fraction[0]}` : ''].filter(Boolean);
  };
  const replaceFirst = (candidates: string[], slot: string) => {
    for (const candidate of candidates) {
      const index = pattern.search(new RegExp(`(?<![\\d.,])${candidate.replace(/[.,]/g, '\\$&')}(?![\\d]|[.,]\\d)`));
      if (index >= 0) {
        pattern = pattern.slice(0, index) + slot + pattern.slice(index + candidate.length);
        return;
      }
    }
  };
  if (reading.balance !== null) replaceFirst(numberText(reading.balance), '{الرصيد}');
  if (reading.amount !== null) replaceFirst(numberText(reading.amount), '{المبلغ}');
  if (reading.accountSuffix) pattern = pattern.replace(new RegExp(`(?<!\\d)${reading.accountSuffix}(?!\\d)`), '{الحساب}');
  if (reading.counterparty && !/^\d+$/.test(reading.counterparty) && pattern.includes(reading.counterparty)) pattern = pattern.replace(reading.counterparty, '{الاسم}');
  pattern = pattern.replace(/(?:\{تجاهل\}\s*){2,}/g, '{تجاهل} ');
  return { pattern, direction: reading.direction === 'unknown' ? 'auto' : reading.direction, reading };
}

// ---------------------------------------------------------------------------
// المراجعة بالحساب لحساب واحد (خزنة واحدة)
// ---------------------------------------------------------------------------

const signed = (direction: MessageDirection, amount: number) => (direction === 'out' ? -amount : amount);
const near = (a: number, b: number) => Math.abs(a - b) < TOLERANCE;

/**
 * يحسب حركات حساب واحد من كل رسائله (من أي عدد من المرسلين: رسائل البنك + إشعار التطبيق).
 * الرسائل تُرتَّب بوقتها على الهاتف لا بوقت وصولها. الدالة خالصة: نفس المدخلات = نفس النتيجة.
 */
export function computeStream(messages: IncomingMessage[], templates: PaymentTemplate[] = []): StreamResult {
  const sorted = [...messages].sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1));
  const entries: StreamEntry[] = [];
  const gaps: StreamGap[] = [];
  const unknown: { messageId: string; note: string }[] = [];
  let ignored = 0;
  let anchor: number | null = null; // آخر رصيد مؤكد
  let pending: StreamEntry[] = []; // حركات بعد آخر رصيد مؤكد وليس فيها رصيد

  const timeOf = (iso: string) => Date.parse(iso) || 0;
  const sameMovement = (a: StreamEntry, direction: MessageDirection, amount: number, sender: string, at: string) =>
    a.sender !== sender &&
    near(a.amount, amount) &&
    (a.direction === direction || a.direction === 'unknown' || direction === 'unknown') &&
    Math.abs(timeOf(a.at) - timeOf(at)) <= MERGE_WINDOW_MS;

  for (const message of sorted) {
    const reading = readPaymentMessage(message.text, { sender: message.sender, templates });
    if (reading.kind === 'ignored') {
      ignored++;
      continue;
    }
    if (reading.kind === 'unknown' || reading.amount === null) {
      unknown.push({ messageId: message.id, note: reading.note || 'رسالة غير مفهومة' });
      continue;
    }

    let direction = reading.direction;
    let amount = reading.amount;
    let fee = reading.fee || 0;
    const corrections: string[] = [];

    // ---- رسالة بلا رصيد (مثل إشعار إنستا باي) ----
    if (reading.balance === null) {
      // هل هي نفس حركة مسجلة للتو من مصدر آخر؟
      const twin = [...entries].reverse().find(e => !e.mergedMessageIds.includes(message.id) && sameMovement(e, direction, amount, message.sender, message.at));
      if (twin) {
        twin.mergedMessageIds.push(message.id);
        if (!twin.counterparty && reading.counterparty) twin.counterparty = reading.counterparty;
        if (!twin.reference && reading.reference) twin.reference = reading.reference;
        if (twin.direction === 'unknown' && direction !== 'unknown') twin.direction = direction;
        continue;
      }
      const entry: StreamEntry = {
        messageId: message.id,
        mergedMessageIds: [],
        sender: message.sender,
        at: message.at,
        direction,
        amount,
        fee: 0,
        balanceAfter: null,
        counterparty: reading.counterparty,
        reference: reading.reference,
        verifiedBy: 'none',
        corrections
      };
      entries.push(entry);
      pending.push(entry);
      continue;
    }

    // ---- رسالة فيها رصيد ----
    const balance = reading.balance;

    // إشعار بلا رصيد وصل قبلها لنفس الحركة: يُدمج فيها ولا يُحسب مرتين
    const twinIndex = pending.findIndex(e => sameMovement(e, direction, amount, message.sender, message.at));
    let mergedFrom: StreamEntry | null = null;
    if (twinIndex >= 0) {
      mergedFrom = pending[twinIndex];
      pending.splice(twinIndex, 1);
      entries.splice(entries.indexOf(mergedFrom), 1);
      if (direction === 'unknown') direction = mergedFrom.direction;
    }

    let verifiedBy: StreamEntry['verifiedBy'] = 'baseline';
    if (anchor !== null) {
      const pendingSum = pending.reduce((sum, e) => sum + signed(e.direction, e.amount), 0);
      const delta = round2(balance - anchor - pendingSum); // التغير الذي يجب أن تفسّره هذه الرسالة
      verifiedBy = 'balance';
      if (direction !== 'unknown' && near(delta, signed(direction, amount) - fee)) {
        // القراءة مطابقة للحساب
      } else if (near(Math.abs(delta), amount)) {
        direction = delta >= 0 ? 'in' : 'out';
        if (reading.direction !== 'unknown') corrections.push('صُحِّح اتجاه الحركة من الرصيد');
      } else {
        const candidates = reading.otherNumbers;
        const asAmount = candidates.find(c => near(Math.abs(delta), c));
        const asFee = candidates.find(c => near(Math.abs(delta), amount + c));
        if (asAmount !== undefined) {
          amount = round2(asAmount);
          direction = delta >= 0 ? 'in' : 'out';
          corrections.push('صُحِّح مبلغ الحركة من الرصيد');
        } else if (asFee !== undefined && delta < 0) {
          fee = round2(asFee);
          direction = 'out';
          corrections.push('أُضيفت رسوم مذكورة في الرسالة');
        } else {
          // لا تفسير: رسالة ضاعت قبل هذه
          if (direction === 'unknown') direction = delta >= 0 ? 'in' : 'out';
          const gap = round2(delta - signed(direction, amount));
          if (!near(gap, 0)) gaps.push({ beforeMessageId: message.id, at: message.at, amount: gap });
        }
      }
      // الحركات المعلقة قبلها أصبحت مؤكدة ضمن نفس المعادلة (ما لم يظهر فرق)
      const gapHere = gaps.length > 0 && gaps[gaps.length - 1].beforeMessageId === message.id;
      if (!gapHere) for (const e of pending) e.verifiedBy = 'balance';
    } else if (direction === 'unknown') {
      direction = 'in';
      corrections.push('اتجاه الحركة غير واضح في أول رسالة — راجعها');
    }

    entries.push({
      messageId: message.id,
      mergedMessageIds: mergedFrom ? [mergedFrom.messageId, ...mergedFrom.mergedMessageIds] : [],
      sender: message.sender,
      at: message.at,
      direction,
      amount,
      fee,
      balanceAfter: balance,
      counterparty: reading.counterparty || (mergedFrom ? mergedFrom.counterparty : ''),
      reference: reading.reference || (mergedFrom ? mergedFrom.reference : ''),
      verifiedBy,
      corrections
    });
    anchor = balance;
    pending = [];
  }

  const pendingSum = pending.reduce((sum, e) => sum + signed(e.direction, e.amount), 0);
  return {
    entries,
    gaps,
    lastConfirmedBalance: anchor,
    currentBalance: anchor === null ? null : round2(anchor + pendingSum),
    ignored,
    unknown
  };
}

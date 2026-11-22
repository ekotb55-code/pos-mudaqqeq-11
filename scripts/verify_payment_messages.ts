/**
 * اختبار قارئ رسائل الدفع (server/paymentMessages.ts)
 * التشغيل:  npx tsx scripts/verify_payment_messages.ts
 * الرسائل هنا أمثلة مصنوعة للاختبار بصياغات متنوعة (عربي وإنجليزي) وليست نصوص بنوك حقيقية.
 */
import {
  readPaymentMessage,
  computeStream,
  normalizeMessageText,
  compileTemplate,
  suggestTemplate,
  type IncomingMessage,
  type PaymentTemplate
} from '../server/paymentMessages.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}

function expectRead(text: string, want: { kind?: string; direction?: string; amount?: number | null; balance?: number | null; account?: string }, label: string) {
  const r = readPaymentMessage(text);
  const problems: string[] = [];
  if (want.kind !== undefined && r.kind !== want.kind) problems.push(`النوع ${r.kind}`);
  if (want.direction !== undefined && r.direction !== want.direction) problems.push(`الاتجاه ${r.direction}`);
  if (want.amount !== undefined && r.amount !== want.amount) problems.push(`المبلغ ${r.amount}`);
  if (want.balance !== undefined && r.balance !== want.balance) problems.push(`الرصيد ${r.balance}`);
  if (want.account !== undefined && r.accountSuffix !== want.account) problems.push(`الحساب "${r.accountSuffix}"`);
  assert(problems.length === 0, `${label} ← ${problems.join('، ')} | ${JSON.stringify(r)}`);
}

// ---- التطبيع ----
assert(normalizeMessageText('تمَّ إيداع ١٬٢٥٠٫٥٠ جنيهاً') === 'تم ايداع 1,250.50 جنيها', 'تطبيع الأرقام العربية والتشكيل');
assert(normalizeMessageText('\u200FAvailable\u00A0\u00A0Balance\u200B one-time') === 'available balance one-time', 'تطبيع الإنجليزية والمحارف المخفية');

// ---- قراءة رسائل عربية ----
expectRead('تم إيداع مبلغ 1,500.00 جم في حسابك رقم ****4321 بتاريخ 19/11/2026 الساعة 14:05. الرصيد المتاح 12,750.25 جم', { kind: 'transaction', direction: 'in', amount: 1500, balance: 12750.25, account: '4321' }, 'إيداع عربي');
expectRead('تم خصم مبلغ ٢٥٠ جنيه من حسابك المنتهي بـ 4321 عملية شراء لدى كارفور. رصيدك الحالي ١٢٥٠٠٫٢٥ جنيه', { direction: 'out', amount: 250, balance: 12500.25, account: '4321' }, 'خصم بأرقام عربية');
expectRead('تحويل وارد بمبلغ 350 ج.م من أحمد محمد علي إلى حسابك ****4321. الرصيد 12850.25', { direction: 'in', amount: 350, balance: 12850.25, account: '4321' }, 'تحويل وارد');
expectRead('تم تحويل مبلغ 1000 جنيه من حسابك ****4321 إلى محمد حسن. الرصيد المتاح 11850.25 جنيه. رقم مرجعي 20261119123456', { direction: 'out', amount: 1000, balance: 11850.25 }, 'تحويل صادر من حسابك');
expectRead('تم استلام مبلغ 200.00 جنيه من 01012345678 رصيدك الحالي 950.75 جنيه', { direction: 'in', amount: 200, balance: 950.75 }, 'محفظة: استلام');
expectRead('تم سحب 500 جنيه من محفظتك. رسوم الخدمة 5 جنيه. رصيدك 445.75 جنيه', { direction: 'out', amount: 500, balance: 445.75 }, 'محفظة: سحب برسوم');
expectRead('لقد استلمت 350 جنيه من AHMED MOHAMED عبر إنستا باي', { direction: 'in', amount: 350, balance: null }, 'إشعار بلا رصيد');

// ---- قراءة رسائل إنجليزية ----
expectRead('Your account ending 4321 has been credited with EGP 2,000.00 on 19-Nov-2026 14:10. Available balance EGP 13,850.25', { direction: 'in', amount: 2000, balance: 13850.25, account: '4321' }, 'credit EN');
expectRead('EGP 120.50 was debited from your account XXXX4321 at SPINNEYS on 19/11/2026. Avl Bal EGP 13,729.75', { direction: 'out', amount: 120.5, balance: 13729.75, account: '4321' }, 'debit EN');
expectRead('You received EGP 75 from Mona Ali. Ref: IPN99887766', { direction: 'in', amount: 75, balance: null }, 'received EN بلا رصيد');
expectRead('Purchase of EGP 1,299 on card **** 9876 at AMAZON. Balance: EGP 8,701.00', { direction: 'out', amount: 1299, balance: 8701, account: '9876' }, 'purchase EN');
expectRead('Withdrawal of 3000 EGP from your account a/c 4321. Fees 5 EGP. New balance 10724.75 EGP', { direction: 'out', amount: 3000, balance: 10724.75, account: '4321' }, 'withdrawal EN برسوم');

// ---- رسائل تُتجاهل ----
expectRead('رمز التحقق الخاص بك هو 482913 لا تشاركه مع أي شخص', { kind: 'ignored' }, 'رمز تحقق عربي');
expectRead('Your OTP is 771204. Do not share it with anyone.', { kind: 'ignored' }, 'OTP EN');
expectRead('عرض خاص! خصم 50% على كل المنتجات حتى 30/11', { kind: 'ignored' }, 'إعلان');
expectRead('مرحبا بك في خدمة الإشعارات', { kind: 'ignored' }, 'رسالة ترحيب');
assert(readPaymentMessage('رمز التحقق 482913').amount === null, 'رمز التحقق لا يُقرأ كمبلغ');

// ---- المراجعة بالحساب ----
const at = (minute: number) => new Date(Date.UTC(2026, 10, 19, 10, minute)).toISOString();
const sms = (id: string, minute: number, text: string, sender = 'BANK'): IncomingMessage => ({ id, sender, at: at(minute), text });

// 1) سلسلة سليمة: أول رسالة خط أساس ثم كل حركة مؤكدة بالرصيد
let stream = computeStream([
  sms('m1', 0, 'تم إيداع مبلغ 1000 جم في حسابك ****4321. الرصيد المتاح 5000 جم'),
  sms('m2', 5, 'تم خصم مبلغ 200 جم من حسابك ****4321. الرصيد المتاح 4800 جم'),
  sms('m3', 9, 'Your account ending 4321 has been credited with EGP 350.00. Available balance EGP 5,150.00')
]);
assert(stream.entries.length === 3 && stream.gaps.length === 0, 'سلسلة سليمة: 3 حركات بلا فروق');
assert(stream.entries[0].verifiedBy === 'baseline' && stream.entries[1].verifiedBy === 'balance' && stream.entries[2].verifiedBy === 'balance', 'التأكيد بالرصيد');
assert(stream.currentBalance === 5150 && stream.lastConfirmedBalance === 5150, 'الرصيد يتبع آخر رسالة');

// 2) رسالة ضاعت: يظهر فرق غير مفسَّر بقيمتها
stream = computeStream([
  sms('m1', 0, 'تم إيداع مبلغ 1000 جم في حسابك. الرصيد المتاح 5000 جم'),
  sms('m3', 9, 'تم إيداع مبلغ 300 جم في حسابك. الرصيد المتاح 5800 جم')
]);
assert(stream.gaps.length === 1 && stream.gaps[0].amount === 500 && stream.gaps[0].beforeMessageId === 'm3', 'رسالة ضائعة = فرق غير مفسَّر 500');
assert(stream.currentBalance === 5800, 'الرصيد يساوي الحساب الحقيقي حتى مع الفرق');

// 3) تصحيح الاتجاه من الرصيد (صياغة ملتبسة)
stream = computeStream([
  sms('m1', 0, 'الرصيد المتاح 2000 جم بعد عملية بمبلغ 100 جم'),
  sms('m2', 3, 'عملية تحويل بمبلغ 400 جم على حسابك. الرصيد المتاح 1600 جم')
]);
assert(stream.entries[1].direction === 'out' && stream.entries[1].amount === 400 && stream.gaps.length === 0, 'اتجاه غير واضح يُستنتج من الرصيد');

// 4) تصحيح المبلغ من الرصيد (رقم آخر في الرسالة هو المبلغ الحقيقي)
stream = computeStream([
  sms('m1', 0, 'تم إيداع مبلغ 100 جم في حسابك. الرصيد المتاح 1000 جم'),
  sms('m2', 4, 'تم خصم قسط 3 من 12 بمبلغ 250 جم من حسابك. الرصيد المتاح 750 جم')
]);
assert(stream.entries[1].amount === 250 && stream.entries[1].direction === 'out' && stream.gaps.length === 0, 'المبلغ الصحيح يُختار بالحساب');

// 5) رسوم مذكورة في الرسالة
stream = computeStream([
  sms('m1', 0, 'تم استلام مبلغ 1000 جنيه من 01012345678 رصيدك الحالي 1000 جنيه', 'WALLET'),
  sms('m2', 6, 'تم سحب 500 جنيه من محفظتك. رسوم الخدمة 5 جنيه. رصيدك 495 جنيه', 'WALLET')
]);
assert(stream.entries[1].amount === 500 && stream.entries[1].fee === 5 && stream.gaps.length === 0, 'الرسوم تُحسب ولا تُعتبر فرقًا');

// 6) دمج إشعار التطبيق مع رسالة البنك لنفس التحويل (الإشعار أولًا)
stream = computeStream([
  sms('m1', 0, 'تم إيداع مبلغ 100 جم في حسابك. الرصيد المتاح 1000 جم'),
  { id: 'n1', sender: 'instapay.app', at: at(10), text: 'لقد استلمت 350 جنيه من AHMED MOHAMED عبر إنستا باي' },
  sms('m2', 11, 'تحويل وارد بمبلغ 350 جم إلى حسابك. الرصيد المتاح 1350 جم')
]);
assert(stream.entries.length === 2 && stream.gaps.length === 0, 'الإشعار ورسالة البنك = حركة واحدة');
assert(stream.entries[1].mergedMessageIds.includes('n1') && /ahmed mohamed/.test(stream.entries[1].counterparty), 'اسم المحوّل يؤخذ من الإشعار');
assert(stream.currentBalance === 1350, 'لا يُحسب التحويل مرتين');

// 7) الدمج عندما تصل رسالة البنك أولًا
stream = computeStream([
  sms('m1', 0, 'تم إيداع مبلغ 100 جم في حسابك. الرصيد المتاح 1000 جم'),
  sms('m2', 10, 'تحويل وارد بمبلغ 350 جم إلى حسابك. الرصيد المتاح 1350 جم'),
  { id: 'n1', sender: 'instapay.app', at: at(11), text: 'You received EGP 350 from Ahmed Mohamed' }
]);
assert(stream.entries.length === 2 && stream.entries[1].mergedMessageIds.includes('n1') && stream.currentBalance === 1350, 'الدمج بترتيب عكسي');

// 8) إشعار بلا رصيد وحده: يُحسب مؤقتًا ثم يتأكد عند أول رسالة فيها رصيد
stream = computeStream([
  sms('m1', 0, 'تم إيداع مبلغ 100 جم في حسابك. الرصيد المتاح 1000 جم'),
  { id: 'n1', sender: 'instapay.app', at: at(10), text: 'لقد استلمت 200 جنيه من MONA ALI' }
]);
assert(stream.currentBalance === 1200 && stream.lastConfirmedBalance === 1000 && stream.entries[1].verifiedBy === 'none', 'حركة بلا رصيد تُضاف للرصيد المتوقع وتبقى غير مؤكدة');
stream = computeStream([
  sms('m1', 0, 'تم إيداع مبلغ 100 جم في حسابك. الرصيد المتاح 1000 جم'),
  { id: 'n1', sender: 'instapay.app', at: at(10), text: 'لقد استلمت 200 جنيه من MONA ALI' },
  sms('m2', 40, 'تم خصم مبلغ 50 جم من حسابك. الرصيد المتاح 1150 جم')
]);
assert(stream.gaps.length === 0 && stream.entries[1].verifiedBy === 'balance' && stream.currentBalance === 1150, 'الحركة غير المؤكدة تتأكد من الرصيد التالي');

// 9) الترتيب بوقت الرسالة لا بوقت الوصول، وأكواد التحقق لا تُحسب
stream = computeStream([
  sms('m3', 9, 'تم إيداع مبلغ 300 جم في حسابك. الرصيد المتاح 1100 جم'),
  sms('otp', 4, 'رمز التحقق الخاص بك هو 482913'),
  sms('m1', 0, 'تم إيداع مبلغ 1000 جم في حسابك. الرصيد المتاح 1000 جم'),
  sms('m2', 5, 'تم خصم مبلغ 200 جم من حسابك. الرصيد المتاح 800 جم')
]);
assert(stream.entries.map(e => e.messageId).join() === 'm1,m2,m3' && stream.gaps.length === 0 && stream.ignored === 1, 'الترتيب بوقت الرسالة وتجاهل رمز التحقق');

// 10) رسالة تبدو حركة لكن بلا مبلغ: تذهب للمراجعة ولا تُهمل
stream = computeStream([sms('u1', 0, 'تم خصم مبلغ من حسابك. للاستعلام اتصل بخدمة العملاء')]);
assert(stream.entries.length === 0 && stream.unknown.length === 1 && /[\u0600-\u06FF]/.test(stream.unknown[0].note), 'رسالة غير مفهومة تذهب للمراجعة برسالة عربية');

// 11) نفس المدخلات = نفس النتيجة
const again = [sms('a', 0, 'تم إيداع مبلغ 10 جم في حسابك. الرصيد المتاح 10 جم'), sms('b', 1, 'تم خصم مبلغ 4 جم من حسابك. الرصيد المتاح 6 جم')];
assert(JSON.stringify(computeStream(again)) === JSON.stringify(computeStream([...again].reverse())), 'النتيجة لا تتأثر بترتيب الوصول');

// ---------------------------------------------------------------------------
// القوالب: يعرّفها فريق الدعم بوضع خانة {المبلغ} وخانة {الرصيد} مكان القيم في نص الرسالة
// ---------------------------------------------------------------------------
const tpl = (id: string, pattern: string, direction: PaymentTemplate['direction'], sender = '*', enabled = true): PaymentTemplate => ({ id, name: id, sender, pattern, direction, enabled });

// 12) اقتراح قالب من رسالة حقيقية ثم قراءة رسالة أخرى بنفس الشكل
const sampleDeposit = 'تم إيداع مبلغ 1,500.00 جم في حسابك رقم ****4321 بتاريخ 19/11/2026 الساعة 14:05. الرصيد المتاح 12,750.25 جم';
const suggestion = suggestTemplate(sampleDeposit);
assert(suggestion.pattern.includes('{المبلغ}') && suggestion.pattern.includes('{الرصيد}') && suggestion.direction === 'in', `الاقتراح يضع خانتي المبلغ والرصيد: ${suggestion.pattern}`);
assert(!/1,500|12,750/.test(suggestion.pattern), 'الاقتراح لا يترك أرقام الرسالة النموذجية داخل القالب');
compileTemplate(suggestion.pattern);
const suggested = tpl('t-deposit', suggestion.pattern, suggestion.direction, 'BANK');
let viaTemplate = readPaymentMessage('تم إيداع مبلغ ٧٥٫٥٠ جم في حسابك رقم ****4321 بتاريخ 20/11/2026 الساعة 09:12. الرصيد المتاح ١٢٬٨٢٥٫٧٥ جم', { sender: 'BANK', templates: [suggested] });
assert(viaTemplate.readBy === 'template' && viaTemplate.templateId === 't-deposit' && viaTemplate.amount === 75.5 && viaTemplate.balance === 12825.75 && viaTemplate.direction === 'in', `قراءة رسالة جديدة بالقالب المقترح (وبأرقام عربية): ${JSON.stringify(viaTemplate)}`);

// 13) رسالة تخطئها القراءة التلقائية ويصلحها قالب بخانتين
const odd = 'Txn 77 approved 120.00 bal 880.00';
assert(readPaymentMessage(odd).amount !== 120, 'القراءة التلقائية لا تعرف المبلغ في هذه الصياغة (لذلك نحتاج القالب)');
const oddTemplate = tpl('t-odd', 'Txn {تجاهل} approved {المبلغ} bal {الرصيد}', 'out', 'CARD');
viaTemplate = readPaymentMessage('Txn 78 approved 45.50 bal 834.50', { sender: 'CARD', templates: [oddTemplate] });
assert(viaTemplate.readBy === 'template' && viaTemplate.amount === 45.5 && viaTemplate.balance === 834.5 && viaTemplate.direction === 'out', 'القالب يحدد خانة المبلغ وخانة الرصيد بالضبط');

// 14) القالب خاص بمرسله، والمعطَّل لا يُستخدم، وغير المطابق يرجع للقراءة التلقائية
assert(readPaymentMessage('Txn 78 approved 45.50 bal 834.50', { sender: 'OTHER', templates: [oddTemplate] }).readBy !== 'template', 'قالب مرسل آخر لا يُطبَّق');
assert(readPaymentMessage('Txn 78 approved 45.50 bal 834.50', { sender: 'CARD', templates: [{ ...oddTemplate, enabled: false }] }).readBy !== 'template', 'القالب المعطَّل لا يُستخدم');
const fallback = readPaymentMessage('تم خصم مبلغ 200 جم من حسابك. الرصيد المتاح 4800 جم', { sender: 'CARD', templates: [oddTemplate] });
assert(fallback.readBy !== 'template' && fallback.amount === 200 && fallback.balance === 4800 && fallback.direction === 'out', 'رسالة لا تطابق القالب تُقرأ تلقائيًا');

// 15) قالب «تتجاهل» وقالب بخانة رسوم وقالب بلا رصيد
const ignoreTemplate = tpl('t-ad', 'عميلنا العزيز {تجاهل}', 'ignore');
assert(readPaymentMessage('عميلنا العزيز استمتع بخصم 20 جنيه على فاتورتك القادمة', { sender: 'BANK', templates: [ignoreTemplate] }).kind === 'ignored', 'قالب «تتجاهل»');
const feeTemplate = tpl('t-fee', 'تم سحب {المبلغ} جنيه من محفظتك. رسوم الخدمة {الرسوم} جنيه. رصيدك {الرصيد} جنيه', 'out', 'WALLET');
viaTemplate = readPaymentMessage('تم سحب 500 جنيه من محفظتك. رسوم الخدمة 5 جنيه. رصيدك 495 جنيه', { sender: 'WALLET', templates: [feeTemplate] });
assert(viaTemplate.amount === 500 && viaTemplate.fee === 5 && viaTemplate.balance === 495, 'خانة الرسوم');
const notifyTemplate = tpl('t-ipn', 'لقد استلمت {المبلغ} جنيه من {الاسم} عبر إنستا باي', 'in', 'instapay.app');
viaTemplate = readPaymentMessage('لقد استلمت 350 جنيه من AHMED MOHAMED عبر إنستا باي', { sender: 'instapay.app', templates: [notifyTemplate] });
assert(viaTemplate.amount === 350 && viaTemplate.balance === null && viaTemplate.counterparty === 'ahmed mohamed', 'قالب بلا رصيد يقرأ المبلغ واسم المحوّل');

// 16) أخطاء تعريف القالب برسائل عربية
for (const bad of ['تم إيداع {القيمة} جم', '']) {
  let message = '';
  try {
    compileTemplate(bad);
  } catch (err: any) {
    message = String(err?.message || '');
  }
  assert(/[\u0600-\u06FF]/.test(message), `قالب غير صالح يُرفض برسالة عربية ("${bad}")`);
}

// 17) القوالب داخل المراجعة بالحساب، والحساب يكشف القالب المكتوب غلط
stream = computeStream(
  [sms('c1', 0, 'Txn 77 approved 120.00 bal 880.00', 'CARD'), sms('c2', 5, 'Txn 78 approved 45.50 bal 834.50', 'CARD')],
  [oddTemplate]
);
assert(stream.entries.length === 2 && stream.gaps.length === 0 && stream.entries[1].verifiedBy === 'balance' && stream.currentBalance === 834.5, 'سلسلة مقروءة بالقالب ومؤكدة بالرصيد');
stream = computeStream(
  [sms('w1', 0, 'تم استلام مبلغ 1000 جنيه من 01012345678 رصيدك الحالي 1000 جنيه', 'WALLET'), sms('w2', 6, 'تم سحب 500 جنيه من محفظتك. رسوم الخدمة 5 جنيه. رصيدك 495 جنيه', 'WALLET')],
  [feeTemplate]
);
assert(stream.entries[1].fee === 5 && stream.gaps.length === 0, 'رسوم القالب تدخل في معادلة الرصيد');
const swapped = tpl('t-wrong', 'Txn {تجاهل} approved {الرصيد} bal {المبلغ}', 'out', 'CARD');
stream = computeStream(
  [sms('c1', 0, 'Txn 77 approved 120.00 bal 880.00', 'CARD'), sms('c2', 5, 'Txn 78 approved 45.50 bal 834.50', 'CARD')],
  [swapped]
);
assert(stream.gaps.length > 0 || stream.entries.some(e => e.corrections.length > 0), 'قالب مكتوب غلط (الخانتان معكوستان) يكشفه الحساب ولا يمر بصمت');

console.log(`\n🎉 كل اختبارات قارئ رسائل الدفع نجحت (${passed} تحققًا).`);

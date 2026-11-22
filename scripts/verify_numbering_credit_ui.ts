/**
 * اختبار واجهة «ترقيم الفواتير ورقم طلب المنصة» و«بيع المنصات دايمًا آجل» (فحص نصي للملفات بدون متصفح)
 * التشغيل: npx tsx scripts/verify_numbering_credit_ui.ts
 */
import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`✅ ${name}`);
  } else {
    failed++;
    console.error(`❌ ${name}`);
  }
}

const root = process.cwd();
const read = (file: string) => (fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : '');
/** كل ملفات .ts/.tsx في مجلد (لأن الصفحات ممكن تكون مقسومة لمكونات) */
const readDir = (dir: string): string => {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return '';
  return fs
    .readdirSync(full, { withFileTypes: true })
    .map(entry => {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) return readDir(rel);
      return /\.(ts|tsx)$/.test(entry.name) ? read(rel) : '';
    })
    .join('\n');
};

const types = read('src/types/index.ts');
const client = read('src/api/client.ts');
const nav = read('src/config/navigation.ts');
const settingsUi = read('src/pages/SettingsPage.tsx') + '\n' + readDir('src/components/settings');
const posUi = read('src/pages/POSPage.tsx') + '\n' + readDir('src/components/pos');
const panel = readDir('src/components/pos');
const invoicesUi = read('src/pages/InvoicesPage.tsx') + '\n' + readDir('src/components/invoices');
const collectionUi = read('src/components/CreditCollectionView.tsx');
const receipt = read('src/components/ReceiptPrintArea.tsx');

// ---- الأنواع ----
const salesRulesType = types.slice(types.indexOf('export interface SalesRules'), types.indexOf('}', types.indexOf('export interface SalesRules')));
check('SalesRules فيه platformAlwaysCredit', /platformAlwaysCredit\??:\s*boolean/.test(salesRulesType));
check('Invoice فيه platformOrderId', /platformOrderId\?:\s*string/.test(types));
check('نوع إعدادات الترقيم InvoiceNumberingSettings', types.includes('export interface InvoiceNumberingSettings') && ['prefix', 'datePart', 'separator', 'digits', 'suffix', 'resetPeriod', 'startAt', 'platformOrderDuplicates'].every(f => types.includes(`${f}:`)));
check('الصلاحية settings.invoice_numbering في PermissionKey', types.includes("| 'settings.invoice_numbering'"));

// ---- دوال الاتصال ----
const fn = (name: string) => {
  const i = client.indexOf(`async ${name}(`);
  return i === -1 ? '' : client.slice(i, i + 500);
};
check('getInvoiceNumbering ← GET /api/settings/invoice-numbering', fn('getInvoiceNumbering').includes("'/api/settings/invoice-numbering'"));
check('saveInvoiceNumbering ← POST /api/settings/invoice-numbering', fn('saveInvoiceNumbering').includes("'/api/settings/invoice-numbering'") && fn('saveInvoiceNumbering').includes("method: 'POST'"));
check('resetInvoiceCounter ← POST …/reset-counter', fn('resetInvoiceCounter').includes('/api/settings/invoice-numbering/reset-counter') && fn('resetInvoiceCounter').includes("method: 'POST'"));
check('setInvoicePlatformOrder ← PUT /api/invoices/:id/platform-order', fn('setInvoicePlatformOrder').includes('/platform-order') && fn('setInvoicePlatformOrder').includes("method: 'PUT'") && fn('setInvoicePlatformOrder').includes('encodeURIComponent'));

// ---- القائمة ----
check('مجموعة الإعدادات تظهر لمن معه settings.invoice_numbering', nav.includes("'settings.invoice_numbering'"));

// ---- إعدادات البيع: آجل المنصة ----
check('مفتاح «بيع المنصات دايمًا آجل على المنصة»', settingsUi.includes('بيع المنصات دايمًا آجل على المنصة') && settingsUi.includes('platformAlwaysCredit'));
check('شرح المفتاح: على الكل حتى المالك، والتحصيل زي ما هو', settingsUi.includes('على كل المستخدمين حتى المالك') && settingsUi.includes('التحصيل'));

// ---- إعدادات الترقيم ----
check('قسم «ترقيم الفواتير» بصلاحيته', settingsUi.includes('id="settings-invoice-numbering-section"') && settingsUi.includes('ترقيم الفواتير') && settingsUi.includes("'settings.invoice_numbering'"));
check(
  'خانات الشكل',
  ['النص قبل الرقم', 'التاريخ في الرقم', 'الفاصل', 'عدد خانات العدد', 'النص بعد الرقم'].every(t => settingsUi.includes(t))
);
check('اختيارات التاريخ', ['بدون تاريخ', 'السنة', 'السنة والشهر', 'اليوم كامل'].every(t => settingsUi.includes(t)));
check('اختيارات بداية العد', ['بداية العد من جديد', 'كل يوم', 'كل أسبوع (يبدأ السبت)', 'كل شهر', 'كل سنة', 'أبدًا'].every(t => settingsUi.includes(t)));
check('رقم البداية وزرار التصفير بتأكيد', settingsUi.includes('رقم البداية') && settingsUi.includes('تصفير العدد الآن') && settingsUi.includes('api.resetInvoiceCounter'));
check('الفاتورة الجاية من السيرفر + مثال وقت الكتابة', settingsUi.includes('الفاتورة الجاية:') && settingsUi.includes('nextNumber') && settingsUi.includes('مثال:'));
check('تنبيه التكرار من السيرفر', settingsUi.includes('mayRepeatNote'));
check('تكرار رقم طلب المنصة: ممنوع / مسموح', settingsUi.includes('ممنوع يتكرر على نفس المنصة') && settingsUi.includes('مسموح يتكرر') && settingsUi.includes('platformOrderDuplicates'));
check('الحفظ عبر api.saveInvoiceNumbering برسالة تأكيد', settingsUi.includes('api.saveInvoiceNumbering') && settingsUi.includes('تم حفظ ترقيم الفواتير'));

// ---- شاشة البيع ----
check('شاشة البيع تقرأ platformAlwaysCredit', posUi.includes('platformAlwaysCredit'));
check('بيع المنصات مع المفتاح: آجل على المنصة إجباري', posUi.includes("setPaymentType('آجل')") && posUi.includes("setCreditPartyType('platform')"));
check('رسالة المنع قبل الإرسال', posUi.includes('بيع المنصات آجل فقط حسب إعدادات البيع'));
check('خانة «رقم طلب المنصة» منفصلة عن الملاحظات', panel.includes('رقم طلب المنصة') && !panel.includes('ملاحظات / رقم طلب المنصة'));
check('رقم طلب المنصة يتبعت مع الفاتورة', posUi.includes('platformOrderId'));
check('رقم الطلب المكرر: الخانة بالأحمر', panel.includes('aria-invalid={platformOrderError}') || panel.includes('aria-invalid={platformOrderFieldError}'));
check('الإيصال يطبع رقم طلب المنصة', receipt.includes('platformOrderId') && receipt.includes('رقم طلب المنصة'));

// ---- الفواتير والتحصيل ----
check('صفحة الفواتير تعرض وتبحث برقم طلب المنصة', invoicesUi.includes('platformOrderId') && invoicesUi.includes('رقم طلب المنصة'));
check('تعديل رقم طلب المنصة بسبب وبالصلاحية', invoicesUi.includes('تعديل رقم طلب المنصة') && invoicesUi.includes('api.setInvoicePlatformOrder') && invoicesUi.includes("'invoices.edit_after_save'"));
check('شاشة التحصيل تعرض وتبحث برقم طلب المنصة', collectionUi.includes('platformOrderId'));

// ---- عربي فقط ----
const visible = (settingsUi + panel).match(/>[^<>{}]*[A-Za-z]{4,}[^<>{}]*</g) || [];
check('لا نصوص إنجليزي ظاهرة في الأقسام الجديدة', !visible.some(t => /invoice numbering|platform order|always credit/i.test(t)));

console.log(`\nالنتيجة: نجح ${passed} — فشل ${failed}`);
if (failed > 0) process.exit(1);
console.log(`🎉 كل اختبارات واجهة الترقيم وآجل المنصة نجحت (${passed} تحققًا).`);

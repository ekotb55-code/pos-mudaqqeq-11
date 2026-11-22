/**
 * اختبار طباعة التكت (src/utils/labelPrint.ts)
 * التشغيل: npx tsx scripts/verify_label_print.ts
 *
 * أنماط الباركود المرجعية بالأسفل اتقرت بقارئ باركود حقيقي (zxing) بعد رسمها بدقة طابعة 203 نقطة:
 * أي تغيير في طريقة الرسم يجب أن يحافظ عليها حرفيًا.
 */
import {
  ean13CheckDigit,
  isValidEan13,
  code128Values,
  code128Modules,
  ean13Modules,
  encodeBarcode,
  barcodeSvg,
  defaultLabelSettings,
  normalizeLabelSettings,
  validateLabelSettings,
  itemBarcodeList,
  defaultBarcodeFor,
  parseExpiry,
  parseLabelSheet,
  labelPrice,
  labelItemName,
  renderLabel,
  buildLabelPrintHtml,
  LabelError,
  MAX_LABELS_PER_PRINT,
  type LabelItem,
  type LabelLine
} from '../src/utils/labelPrint.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}
const arabic = /[\u0600-\u06FF]/;
function expectLabelError(fn: () => unknown, label: string) {
  let caught: any = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof LabelError && arabic.test(caught.message), label);
}

// ---- أنماط مرجعية (مقروءة بقارئ باركود حقيقي) ----
const GOLDEN: Record<string, { type: 'ean13' | 'code128'; modules: string }> = {
  '1234567': { type: 'code128', modules: '110100100001001110011010111011110111011011101011101100010000101100100011110101100011101011' },
  '12345678': { type: 'code128', modules: '1101001110010110011100100010110001110001011011000010100100011101101100011101011' },
  '4006381333931': { type: 'ean13', modules: '10100011010100111010111101111010001001011001101010100001010000101000010111010010000101100110101' },
  '6221000000011': { type: 'code128', modules: '110100100001100111010010111011110110011101001100100010011011001100110110011001101100110011000100100100100110001100011101011' },
  'A-77': { type: 'code128', modules: '1101001000010100011000100110111001110110111011101101110101110011001100011101011' },
  'BOX-9': { type: 'code128', modules: '110100100001000101100010001110110111000101101001101110011100101100111100010101100011101011' }
};
for (const [code, want] of Object.entries(GOLDEN)) {
  const got = encodeBarcode(code);
  assert(got.type === want.type && got.modules === want.modules, `نمط الباركود المرجعي ${code} (${want.type})`);
}

// ---- EAN-13 ----
assert(ean13CheckDigit('400638133393') === 1 && ean13CheckDigit('622100000001') === 0, 'رقم التحقق');
assert(isValidEan13('4006381333931') && !isValidEan13('4006381333932') && !isValidEan13('400638133393') && !isValidEan13('40063813339a1'), 'EAN-13 صحيح وغير صحيح');
for (let first = 0; first <= 9; first++) {
  const body = `${first}22123456789`;
  const code = body + ean13CheckDigit(body);
  const modules = ean13Modules(code);
  assert(modules.length === 95 && modules.startsWith('101') && modules.endsWith('101') && modules.slice(45, 50) === '01010', `EAN-13 يبدأ بـ ${first}: 95 وحدة وحدود صحيحة`);
}
expectLabelError(() => ean13Modules('1234567890123'), 'EAN-13 برقم تحقق غلط يُرفض');

// ---- Code128 ----
const v = code128Values('123456');
assert(v.join() === '105,12,34,56', 'أرقام زوجية: Code C (كل رقمين في خانة)');
assert(code128Values('1234567').join() === '104,17,99,23,45,67', 'أرقام فردية: أول رقم B ثم C');
assert(code128Values('A-7').join() === '104,33,13,23', 'حروف: Code B');
assert(code128Modules('123456').length === 68, 'طول Code128: 5 رموز × 11 + التوقف 13');
expectLabelError(() => code128Values('قلم'), 'حروف عربية لا تُطبع في الباركود');
expectLabelError(() => encodeBarcode(''), 'باركود فارغ');
assert(encodeBarcode('4006381333931').type === 'ean13' && encodeBarcode('4006381333932').type === 'code128' && encodeBarcode('012345678905').type === 'code128', 'تلقائي: EAN-13 للصحيح فقط وإلا Code128 (نفس ما يقرؤه قارئ البيع)');
assert(encodeBarcode('4006381333931', 'code128').type === 'code128', 'إجبار Code128');

// ---- الرسم بالمليمتر وعلى نقاط الطابعة ----
let svg = barcodeSvg('4006381333931', { widthMm: 38, heightMm: 10, printerDpi: 203 });
assert(svg.type === 'ean13' && svg.moduleMm === 0.25 && !svg.tooDense && svg.usedWidthMm <= 38, '38 مم على 203: الخط نقطتين (0.25 مم)');
assert(svg.svg.startsWith('<svg') && svg.svg.includes('height="10mm"') && svg.svg.includes('viewBox="0 0 117 1"') && svg.svg.includes('crispEdges'), 'SVG بالمليمتر وحواف حادة');
svg = barcodeSvg('4006381333931', { widthMm: 38, heightMm: 10, printerDpi: 300 });
assert(Math.abs(svg.moduleMm - 3 / (300 / 25.4)) < 0.001 && !svg.tooDense, '300 نقطة: الخط 3 نقاط');
svg = barcodeSvg('12345678901234567890', { widthMm: 20, heightMm: 8, printerDpi: 203 });
assert(svg.tooDense === true, 'باركود طويل على عرض صغير: تحذير أن الخطوط رفيعة جدًا');
const rects = (barcodeSvg('123456', { widthMm: 38, heightMm: 10 }).svg.match(/<rect /g) || []).length;
assert(rects === code128Modules('123456').split(/0+/).filter(Boolean).length, 'كل خط متصل = مستطيل واحد');

// ---- الإعدادات ----
const d = defaultLabelSettings();
assert(d.paper === 'roll' && d.labelWidthMm === 40 && d.labelHeightMm === 25 && d.columns === 1 && d.barcodeWidthMm === 38 && d.printerDpi === 203, 'الافتراضي: رول 40×25، تكت واحدة في الصف، باركود 38 مم');
assert(d.elements.map(e => e.key).join() === 'shopName,logo,itemName,barcode,barcodeText,price,unit,expiry', 'ترتيب العناصر الافتراضي');
assert(d.elements.filter(e => e.show).map(e => e.key).join() === 'shopName,itemName,barcode,barcodeText,price', 'الظاهر افتراضيًا: المحل، الصنف، الباركود، رقمه، السعر');
let n = normalizeLabelSettings({ paper: 'roll', columns: 2, labelWidthMm: 30, barcodeWidthMm: 50, elements: [{ key: 'price', show: true, align: 'right', fontSizePt: 99, bold: true }, { key: 'price' }, { key: 'bogus' }] });
assert(n.columns === 2 && n.barcodeWidthMm === 30, 'رول اثنين في الصف، والباركود لا يتعدى عرض التكت');
assert(n.elements[0].key === 'price' && n.elements[0].align === 'right' && n.elements[0].fontSizePt === 24 && n.elements.length === 8, 'ترتيب العناصر محفوظ، الخط بحد أقصى، والناقص يُضاف');
n = normalizeLabelSettings({ paper: 'x', labelWidthMm: 'abc', columns: 99, printerDpi: 600 });
assert(n.paper === 'roll' && n.labelWidthMm === 40 && n.columns === 4 && n.printerDpi === 203, 'القيم الغلط ترجع للافتراضي أو الحد');
assert(normalizeLabelSettings({ paper: 'a4', columns: 5 }).columns === 5, 'A4 حتى 8 أعمدة');
assert(validateLabelSettings({ labelWidthMm: 5 })[0].includes('عرض التكت') && validateLabelSettings({ labelWidthMm: 30, barcodeWidthMm: 35 }).some(e => e.includes('أكبر من عرض التكت')) && validateLabelSettings(null).length === 1, 'رسائل أخطاء الإعدادات عربية');
assert(validateLabelSettings(defaultLabelSettings()).length === 0, 'الإعدادات الافتراضية سليمة');

// ---- الأصناف والباركود الافتراضي ----
const items: LabelItem[] = [
  { id: 'i1', name: 'قلم 12 ق', printName: 'قلم جاف أزرق', notes: 'قلم سن رفيع', barcode: '4006381333931', secondaryBarcodes: ['A-77'], salePrice: 10, taxRate: 14, unit: 'قطعة', status: 'نشط' },
  { id: 'i2', name: 'كراسة', barcode: '', barcodes: [{ barcode: 'BOX-9', active: true }], salePrice: 25.5, unit: 'علبة', status: 'active' },
  { id: 'i3', name: 'موقوف', barcode: '1111', salePrice: 1, status: 'موقوف' },
  { id: 'i4', name: 'مكرر', barcode: '2222', salePrice: 1, status: 'نشط' },
  { id: 'i5', name: 'مكرر', barcode: '3333', salePrice: 1, status: 'نشط' },
  { id: 'i6', name: 'بدون باركود', barcode: '', salePrice: 5, status: 'نشط' },
  { id: 'i7', name: '<b>خطر</b>', barcode: '4444', salePrice: 1, status: 'نشط' }
];
assert(itemBarcodeList(items[0]).join() === '4006381333931,A-77' && defaultBarcodeFor(items[0]) === '4006381333931', 'الباركود الأساسي هو الافتراضي');
assert(defaultBarcodeFor(items[1]) === 'BOX-9' && defaultBarcodeFor(items[5]) === '', 'بدون أساسي: أول باركود متاح، وإلا فارغ');

// ---- تاريخ الصلاحية ----
assert(parseExpiry('2026-12-31') === '2026-12-31' && parseExpiry('31/12/2026') === '2026-12-31' && parseExpiry('1.2.2027') === '2027-02-01', 'صيغ التاريخ');
assert(parseExpiry(46387) === '2026-12-31' && parseExpiry('') === '' && parseExpiry(undefined) === '', 'رقم تاريخ الإكسيل، والفارغ مسموح');
assert(parseExpiry('31/02/2026') === null && parseExpiry('غدا') === null && parseExpiry('2026-13-01') === null, 'تاريخ غلط');

// ---- ملف الإكسيل ----
const sheet = parseLabelSheet(
  [
    ['الصنف', 'عدد التكت', 'الباركود', 'تاريخ الصلاحية'],
    ['قلم 12 ق', 3],
    ['قلم جاف أزرق', '2', 'A-77', '31/12/2026'],
    ['box-9', 1],
    ['4006381333931', 1, 'NEW-1'],
    ['غير موجود', 1],
    ['مكرر', 1],
    ['موقوف', 1],
    ['كراسة', 0],
    ['كراسة', 1.5],
    ['كراسة', 1, '4006381333931'],
    ['بدون باركود', 1],
    ['كراسة', 1, 'قلم'],
    ['كراسة', 1, '', '30/02/2026'],
    [],
    ['', 5]
  ],
  items
);
assert(sheet.lines.length === 4 && sheet.totalLabels === 7, 'السطور الصحيحة وإجمالي التكت');
assert(sheet.lines[0].itemId === 'i1' && sheet.lines[0].barcode === '4006381333931' && sheet.lines[0].count === 3 && !sheet.lines[0].unregisteredBarcode, 'بالاسم وبدون باركود: الأساسي');
assert(sheet.lines[1].barcode === 'A-77' && sheet.lines[1].expiry === '2026-12-31', 'باسم الطباعة، بباركود فرعي وتاريخ صلاحية');
assert(sheet.lines[2].itemId === 'i2' && sheet.lines[2].barcode === 'BOX-9', 'الصنف بالباركود (بحروف صغيرة)');
assert(sheet.lines[3].barcode === 'NEW-1' && sheet.lines[3].unregisteredBarcode === true && sheet.warnings.length === 1 && sheet.warnings[0].row === 5 && arabic.test(sheet.warnings[0].message), 'باركود غير مسجل: يُطبع مع تحذير');
const errorRows = sheet.errors.map(e => e.row).join();
assert(errorRows === '6,7,8,9,10,11,12,13,14,16', `صفوف الأخطاء (${errorRows})`);
assert(sheet.errors.every(e => arabic.test(e.message)), 'كل رسائل الأخطاء عربية');
assert(sheet.errors.find(e => e.row === 7)!.message.includes('أكثر من صنف') && sheet.errors.find(e => e.row === 11)!.message.includes('صنف آخر'), 'اسم مكرر، وباركود صنف آخر');
const big = parseLabelSheet([['قلم 12 ق', 1000], ['قلم 12 ق', 1000], ['قلم 12 ق', 1000], ['قلم 12 ق', 1000], ['قلم 12 ق', 1000], ['قلم 12 ق', 1]], items);
assert(big.totalLabels === 5001 && big.errors.some(e => e.message.includes(String(MAX_LABELS_PER_PRINT))), 'الحد الأقصى للتكت في المرة الواحدة');

// ---- السعر والاسم ----
assert(labelPrice(items[0], true) === 10 && labelPrice(items[0], false) === 11.4 && labelPrice(items[1], false) === 25.5, 'السعر بالضريبة لو الأسعار غير شاملة');
assert(labelItemName(items[0], 'name') === 'قلم 12 ق' && labelItemName(items[0], 'printName') === 'قلم جاف أزرق' && labelItemName(items[0], 'description') === 'قلم سن رفيع', 'مصدر اسم الصنف');
assert(labelItemName(items[1], 'printName') === 'كراسة' && labelItemName(items[1], 'description') === 'كراسة', 'بدون اسم طباعة أو وصف: اسم الصنف');

// ---- محتوى التكت ----
const context = { items, companyName: 'مدقق للنظم', logoUrl: '', taxInclusive: true };
const line = (itemId: string, barcode: string, extra: Partial<LabelLine> = {}): LabelLine => ({ itemId, barcode, count: 1, expiry: '', unregisteredBarcode: false, ...extra });
let html = renderLabel(line('i1', '4006381333931'), d, context);
assert(html.includes('مدقق للنظم') && html.includes('قلم جاف أزرق') && html.includes('10.00 ج.م') && html.includes('>4006381333931<') && html.includes('<svg'), 'التكت فيها المحل والصنف والسعر والباركود ورقمه');
assert(html.indexOf('مدقق للنظم') < html.indexOf('قلم جاف أزرق') && html.indexOf('قلم جاف أزرق') < html.indexOf('<svg') && html.indexOf('<svg') < html.indexOf('10.00 ج.م'), 'العناصر بالترتيب');
assert(!html.includes('صلاحية') && !html.includes('<img') && !html.includes('قطعة'), 'العناصر المخفية لا تظهر');
const custom = normalizeLabelSettings({
  shopNameText: 'فرع منفلوط',
  itemNameSource: 'description',
  elements: [
    { key: 'price', show: true, align: 'right', fontSizePt: 9, bold: true },
    { key: 'barcode', show: true, align: 'left' },
    { key: 'expiry', show: true, align: 'center', fontSizePt: 6 },
    { key: 'unit', show: true, align: 'center', fontSizePt: 6 },
    { key: 'logo', show: true, align: 'center' },
    { key: 'itemName', show: true, align: 'center', fontSizePt: 7 },
    { key: 'shopName', show: true, align: 'center', fontSizePt: 6 },
    { key: 'barcodeText', show: false, align: 'center', fontSizePt: 6 }
  ]
});
html = renderLabel(line('i1', 'A-77', { expiry: '2026-12-31' }), custom, { ...context, logoUrl: 'https://cdn.test/logo.png' });
assert(html.indexOf('10.00 ج.م') < html.indexOf('<svg') && html.includes('justify-content:flex-end') && html.includes('text-align:right;font-size:9pt;font-weight:700'), 'تغيير الترتيب والمحاذاة والخط');
assert(html.includes('صلاحية: 31/12/2026') && html.includes('قطعة') && html.includes('src="https://cdn.test/logo.png"') && html.includes('قلم سن رفيع') && html.includes('فرع منفلوط') && !html.includes('>A-77<'), 'الصلاحية والوحدة والشعار والوصف واسم الفرع، ورقم الباركود مخفي');
html = renderLabel(line('i7', '4444'), d, context);
assert(html.includes('&lt;b&gt;خطر&lt;/b&gt;') && !html.includes('<b>خطر'), 'النصوص آمنة (لا تُنفَّذ كـ HTML)');
assert(renderLabel(line('nope', '1'), d, context) === '', 'صنف غير موجود: تكت فارغة');

// ---- صفحة الطباعة ----
let job = buildLabelPrintHtml([line('i1', '4006381333931', { count: 3 }), line('i2', 'BOX-9', { count: 2 })], d, context);
assert(job.totalLabels === 5 && job.pages === 5 && job.html.includes('@page { size: 40mm 25mm; margin: 0; }') && (job.html.match(/class="lb"/g) || []).length === 5, 'رول تكت واحدة في الصف: صفحة لكل تكت بالمقاس الحقيقي');
const two = normalizeLabelSettings({ columns: 2, gapXMm: 2, labelWidthMm: 40, labelHeightMm: 25, pageMargin: { top: 0, bottom: 0, right: 1, left: 1 } });
job = buildLabelPrintHtml([line('i1', '4006381333931', { count: 3 })], two, context);
assert(job.pages === 2 && job.html.includes('@page { size: 84mm 25mm; margin: 0; }') && job.html.includes('grid-template-columns: repeat(2, 40mm)'), 'ورق مقسوم على اثنين: صفحة لكل صف (عرض الصفحة = 2×40 + المسافة + الهوامش)');
const a4 = normalizeLabelSettings({ paper: 'a4', columns: 3, rows: 8, labelWidthMm: 63, labelHeightMm: 33, gapXMm: 3, gapYMm: 2, pageMargin: { top: 10, bottom: 10, right: 8, left: 8 } });
job = buildLabelPrintHtml([line('i2', 'BOX-9', { count: 30 })], a4, context);
assert(job.pages === 2 && job.html.includes('@page { size: 210mm 297mm; margin: 0; }') && job.html.includes('repeat(3, 63mm)'), 'A4: 24 تكت في الصفحة، 30 تكت = صفحتان');
job = buildLabelPrintHtml([line('i1', '12345678901234567890')], normalizeLabelSettings({ barcodeWidthMm: 20, labelWidthMm: 25 }), context);
assert(job.denseBarcodes.includes('12345678901234567890'), 'تحذير الباركود الرفيع يصل للشاشة قبل الطباعة');
assert(job.html.startsWith('<!doctype html>') && job.html.includes('dir="rtl"') && job.html.includes('print-color-adjust: exact'), 'صفحة طباعة كاملة');

console.log(`\n🎉 كل اختبارات طباعة التكت نجحت (${passed} تحققًا).`);

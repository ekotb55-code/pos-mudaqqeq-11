/**
 * اختبار قراءة وتصدير الأصناف بالصور (src/utils/itemImagesPackage.ts) — بدون سيرفر وبدون متصفح
 * التشغيل: npx tsx scripts/verify_item_images_package.ts
 */
import zlib from 'zlib';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  ADD_ITEMS_HEADERS,
  IMAGES_FOLDER,
  EXPORT_WORKBOOK_NAME,
  FAILED_SHEET_NAME,
  ITEMS_SHEET_NAME,
  sniffImageExt,
  normalizeBarcode,
  decodeZipFileName,
  decodeCp720,
  readItemsPackage,
  matchPackageImages,
  extractEmbeddedImages,
  ItemImagesPackageError
} from '../src/utils/itemImagesPackage.ts';
import {
  runPool,
  importPackageImages,
  buildItemsExportZip,
  estimateExportSize,
  exportSummaryText,
  exportImageBaseNames,
  sanitizeFileName,
  type ExportItem
} from '../src/utils/itemImagesTransfer.ts';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}
async function expectReject(fn: () => Promise<unknown>, part: string, label: string) {
  let caught: any = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof ItemImagesPackageError && String(caught.message).includes(part), `${label} (${caught?.message || 'ما رفضش'})`);
}

// صور صغيرة حقيقية
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const jpeg = (n: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, n, n, n]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const same = (a: Uint8Array | undefined, b: Uint8Array) => Boolean(a) && Buffer.compare(Buffer.from(a!), Buffer.from(b)) === 0;

/** ملف إكسيل بورقة «الأصناف» */
function workbook(rows: unknown[][], sheetName = ITEMS_SHEET_NAME): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** ملف zip بسيط بأسماء بايتات خام ومن غير علامة UTF-8 (زي ضغط ويندوز القديم) */
function rawZip(entries: { nameBytes: Uint8Array; data: Uint8Array; utf8?: boolean }[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data);
    const crc = zlib.crc32(data);
    const flag = e.utf8 ? 0x0800 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flag, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(e.nameBytes.length, 26);
    const localPart = Buffer.concat([local, Buffer.from(e.nameBytes), data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flag, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(e.nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, Buffer.from(e.nameBytes)]));
    locals.push(localPart);
    offset += localPart.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

// ترميز CP720 (العكس من جدول فك الأسماء) علشان نعمل ملف زي ضغط ويندوز العربي
const CP720 = new Map<string, number>();
for (let b = 0x80; b <= 0xff; b++) CP720.set(decodeCp720(Uint8Array.from([b])), b);
const cp720 = (text: string) => Uint8Array.from([...text].map(ch => (ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : CP720.get(ch) ?? 0x3f)));

async function main() {
  // ==================== أدوات صغيرة ====================
  assert(sniffImageExt(PNG) === 'png' && sniffImageExt(jpeg(1)) === 'jpg' && sniffImageExt(WEBP) === 'webp' && sniffImageExt(Buffer.from('hello')) === null, 'معرفة نوع الصورة من محتواها');
  assert(normalizeBarcode(' ٦٢٢ ١٢٣ ') === '622123' && normalizeBarcode('۱۲3') === '123', 'توحيد الباركود (أرقام عربية ومسافات)');
  assert(sanitizeFileName('كابل 1/2 متر: "أبيض"?') === 'كابل 1-2 متر- -أبيض--' && sanitizeFileName('   ') === 'صنف' && sanitizeFileName('اسم.') === 'اسم', 'تنظيف اسم الملف من الحروف الممنوعة');
  const names = exportImageBaseNames([
    { id: 'a', name: 'قلم', barcode: '6221000000011' },
    { id: 'b', name: 'كراسة', barcode: '6221000000028' },
    { id: 'c', name: 'كراسة 2', barcode: '6221000000028' },
    { id: 'd', name: 'ممحاة', barcode: '' },
    { id: 'e', name: 'كابل 1/2', barcode: undefined },
    { id: 'f', name: 'كابل 1-2', barcode: '' },
    { id: 'g', name: 'غريب', barcode: 'A B/7' }
  ]);
  assert(names.get('a') === '6221000000011', 'الصورة باسم الباركود الرئيسي');
  assert(names.get('b') === 'كراسة' && names.get('c') === 'كراسة 2', 'باركود لصنفين: الصورة باسم الصنف');
  assert(names.get('d') === 'ممحاة' && names.get('e') === 'كابل 1-2' && names.get('f') === 'كابل 1-2 (2)', 'من غير باركود: اسم الصنف، والتكرار يتزود له رقم');
  assert(names.get('g') === 'غريب', 'باركود فيه حروف ممنوعة في اسم الملف: اسم الصنف');

  // ==================== أسماء الملفات العربي ====================
  assert(decodeZipFileName(new TextEncoder().encode('صور/قلم.jpg')) === 'صور/قلم.jpg', 'اسم UTF-8 من غير علامة');
  assert(decodeZipFileName(cp720('صور/قلم أزرق.jpg')) === 'صور/قلم أزرق.jpg', 'اسم بترميز ويندوز العربي القديم (CP720)');
  const cp1256 = Uint8Array.from([0xd5, 0xe6, 0xd1, 0x2e, 0x6a, 0x70, 0x67]); // «صور.jpg» بترميز Windows-1256
  assert(decodeZipFileName(cp1256) === 'صور.jpg', 'اسم بترميز Windows-1256');
  assert(decodeZipFileName(Uint8Array.from([0x61, 0x2e, 0x70, 0x6e, 0x67])) === 'a.png', 'اسم إنجليزي');

  // ==================== قراءة ملف مضغوط ====================
  const header = [...ADD_ITEMS_HEADERS];
  const rows = [
    header,
    ['قلم جاف', '', 5, '', '6221000000011', 10, 6, '', '', '', '', '', ''], // صورة باسم الباركود (حروف كبيرة)
    ['كراسة', '', 3, '', '6221000000028', 25, 15, '', '', '', '', '', 'Copy Book.PNG'], // اسم الملف مكتوب
    ['ممحاة', '', 1, '', '6221000000035', 5, 2, '', '', '', '', '', 'https://example.com/a.jpg'], // رابط
    ['مسطرة', '', 1, '', '6221000000042', 5, 2, '', '', '', '', '', 'مش-موجودة.jpg'], // ملف مش موجود
    ['برجل', '', 1, '', '6221000000059', 5, 2, '', '', '', '', '', ''], // من غير صورة
    ['قلم أزرق', '', 1, '', '٦٢٢١٠٠٠٠٠٠٠٦٦', 5, 2, '', '', '', '', '', 'قلم أزرق.jpg'] // اسم عربي + باركود بأرقام عربية
  ];
  const zip = new JSZip();
  zip.file('أصناف/الأصناف.xlsx', workbook(rows));
  zip.file('صور/فولدر1/6221000000011.JPG', jpeg(1));
  zip.file('صور/6221000000011.png', PNG); // نفس الباركود بامتداد تاني: jpg أولى
  zip.file('Copy Book.png', jpeg(2));
  zip.file('زيادة/صورة زيادة.webp', WEBP);
  zip.file('قلم أزرق.jpg', jpeg(3));
  zip.file('__MACOSX/._6221000000011.JPG', 'junk');
  zip.file('ملاحظات.txt', 'نص');
  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const pkg = await readItemsPackage(zipBytes, 'اصناف.zip');
  assert(pkg.kind === 'zip' && pkg.workbookName === 'الأصناف.xlsx' && pkg.rows.length === 7, 'ملف الإكسيل جوه الملف المضغوط اتقرا');
  assert(pkg.images.size === 5 && !pkg.images.has('ملاحظات.txt'), 'الصور بس اتقرت (من غير ملفات ماك والنصوص)');
  const match = matchPackageImages(pkg);
  const byName = new Map(match.entries.map(e => [e.name, e]));
  assert(same(byName.get('قلم جاف')?.image?.bytes, jpeg(1)) && byName.get('قلم جاف')?.source === 'الباركود', 'صورة باسم الباركود (من غير فرق كبير/صغير وفي أي فولدر، و jpg أولى من png)');
  assert(same(byName.get('كراسة')?.image?.bytes, jpeg(2)) && byName.get('كراسة')?.source === 'اسم الملف', 'اسم الملف المكتوب في خانة الصورة');
  assert(byName.get('ممحاة')?.problem?.includes('رابط') && !byName.get('ممحاة')?.image, 'الرابط مش مقبول');
  assert(byName.get('مسطرة')?.problem?.includes('مش موجودة'), 'ملف مكتوب ومش موجود');
  assert(!byName.get('برجل')?.image && !byName.get('برجل')?.problem, 'صنف من غير صورة: عادي');
  assert(same(byName.get('قلم أزرق')?.image?.bytes, jpeg(3)) && byName.get('قلم أزرق')?.key === '6221000000066', 'اسم ملف عربي + باركود بأرقام عربية');
  assert(match.unmatchedImages.sort().join() === ['6221000000011.png', 'صورة زيادة.webp'].sort().join(), `صور مش مربوطة بأي صنف (${match.unmatchedImages.join('، ')})`);
  assert(match.stats.rows === 6 && match.stats.withImage === 3 && match.stats.withoutImage === 3 && match.stats.problems === 2, 'أرقام المعاينة');

  // ملف ويندوز القديم: أسماء عربي من غير علامة UTF-8
  const winZip = rawZip([
    { nameBytes: cp720('اصناف.xlsx'), data: workbook([header, ['قلم', '', 1, '', '111', 1, 1, '', '', '', '', '', 'قلم أحمر.jpg']]) },
    { nameBytes: cp720('صور/قلم أحمر.jpg'), data: jpeg(9) }
  ]);
  const winPkg = await readItemsPackage(winZip, 'w.zip');
  const winMatch = matchPackageImages(winPkg);
  assert(winPkg.workbookName === 'اصناف.xlsx' && same(winMatch.entries[0]?.image?.bytes, jpeg(9)), 'ملف مضغوط من ويندوز بأسماء عربي (CP720)');

  await expectReject(async () => readItemsPackage(await new JSZip().file('a.jpg', jpeg(1)).generateAsync({ type: 'uint8array' }), 'a.zip'), 'مفيهوش ملف إكسيل', 'ملف مضغوط من غير إكسيل');
  const two = new JSZip();
  two.file('1.xlsx', workbook(rows));
  two.file('2.xlsx', workbook(rows));
  await expectReject(async () => readItemsPackage(await two.generateAsync({ type: 'uint8array' }), 'b.zip'), 'أكتر من ملف إكسيل', 'أكتر من ملف إكسيل');
  await expectReject(() => readItemsPackage(new TextEncoder().encode('hello'), 'x.pdf'), 'نوع الملف', 'نوع ملف غلط');
  await expectReject(() => readItemsPackage(Uint8Array.from([0x50, 0x4b, 3, 4, 1, 2, 3]), 'x.zip'), 'تالف', 'ملف مضغوط تالف');
  assert(matchPackageImages({ rows: [['اسم', 'سعر']], images: new Map(), embedded: new Map() }).headerError?.includes('الباركود الرئيسي'), 'عمود ناقص');

  // ==================== صور جوه ملف الإكسيل ====================
  const embRows = [header, ['شاحن', '', 1, '', '7001', 1, 1, '', '', '', '', '', 'IMG2'], ['كابل', '', 1, '', '7002', 1, 1, '', '', '', '', '', 'IMG3'], ['سماعة', '', 1, '', '7003', 1, 1, '', '', '', '', '', 'IMG4']];
  const base = await JSZip.loadAsync(workbook(embRows));
  const sheetPath = 'xl/worksheets/sheet1.xml';
  let sheetXml = await base.file(sheetPath)!.async('string');
  // صف 2: صورة فوق الخانة (drawing) — صف 3: صورة جوه الخانة (Excel 365) — صف 4: صورة WPS
  sheetXml = sheetXml.replace(/<c r="M3"[^>]*>[\s\S]*?<\/c>/, '<c r="M3" t="e" vm="1"><v>#VALUE!</v></c>');
  sheetXml = sheetXml.replace(/<c r="M4"[^>]*>[\s\S]*?<\/c>/, '<c r="M4" t="str"><f>_xlfn.DISPIMG("ID_ABC123",1)</f><v>=DISPIMG("ID_ABC123",1)</v></c>');
  sheetXml = sheetXml.replace('</worksheet>', '<drawing r:id="rIdDr1"/></worksheet>');
  if (!sheetXml.includes('xmlns:r=')) sheetXml = sheetXml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  base.file(sheetPath, sheetXml);
  base.file('xl/worksheets/_rels/sheet1.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
  base.file(
    'xl/drawings/drawing1.xml',
    '<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>13</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Picture 1"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImg1"/></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>' +
      '<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="1" cy="1"/><xdr:pic><xdr:blipFill><a:blip r:embed="rIdImg9"/></xdr:blipFill></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>' +
      '</xdr:wsDr>'
  );
  base.file('xl/drawings/_rels/drawing1.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpeg"/><Relationship Id="rIdImg9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>');
  base.file('xl/media/image1.jpeg', jpeg(21));
  base.file('xl/media/logo.png', PNG);
  base.file('xl/media/image2.png', PNG);
  base.file('xl/media/image3.jpeg', jpeg(41));
  base.file(
    'xl/metadata.xml',
    '<?xml version="1.0" encoding="UTF-8"?><metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"><metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000"/></metadataTypes><futureMetadata name="XLRICHVALUE" count="1"><bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="0"/></ext></extLst></bk></futureMetadata><valueMetadata count="1"><bk><rc t="1" v="0"/></bk></valueMetadata></metadata>'
  );
  base.file('xl/richData/rdrichvaluestructure.xml', '<?xml version="1.0" encoding="UTF-8"?><rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>');
  base.file('xl/richData/rdrichvalue.xml', '<?xml version="1.0" encoding="UTF-8"?><rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><rv s="0"><v>0</v><v>5</v></rv></rvData>');
  base.file('xl/richData/richValueRel.xml', '<?xml version="1.0" encoding="UTF-8"?><richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><rel r:id="rId1"/></richValueRels>');
  base.file('xl/richData/_rels/richValueRel.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/></Relationships>');
  base.file('xl/cellimages.xml', '<?xml version="1.0" encoding="UTF-8"?><etc:cellImages xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData"><etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="ID_ABC123"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdW1"/></xdr:blipFill><xdr:spPr/></xdr:pic></etc:cellImage></etc:cellImages>');
  base.file('xl/_rels/cellimages.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdW1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image3.jpeg"/></Relationships>');
  const embBytes = await base.generateAsync({ type: 'uint8array' });
  const embedded = await extractEmbeddedImages(embBytes, ITEMS_SHEET_NAME, 12);
  assert(same(embedded.get(1)?.bytes, jpeg(21)), 'صورة فوق الخانة (Insert Picture) — والأولوية لعمود «الصورة»');
  assert(same(embedded.get(2)?.bytes, PNG), 'صورة جوه الخانة (Excel 365 «Place in Cell»)');
  assert(same(embedded.get(3)?.bytes, jpeg(41)), 'صورة WPS (=DISPIMG)');
  const embPkg = await readItemsPackage(embBytes, 'أصناف بالصور.xlsx');
  const embMatch = matchPackageImages(embPkg);
  assert(embPkg.kind === 'xlsx' && embMatch.stats.withImage === 3 && embMatch.entries.every(e => e.source === 'خانة' && !e.problem), 'ملف إكسيل لوحده بالصور جوه الخانات: 3 أصناف بصورهم');
  assert(embMatch.entries.find(e => e.key === '7002')?.image?.ext === 'png', 'الصورة اللي جوه الخانة اتربطت بصنف نفس الصف');

  // ==================== تعديل الصور بس ====================
  const onlyZip = new JSZip();
  onlyZip.file('صور.xlsx', workbook([['الصنف', 'الصورة'], ['6221000000011', ''], ['كراسة', 'k.jpg'], ['قلم أزرق', '']], 'Sheet1'));
  onlyZip.file('6221000000011.jpg', jpeg(5));
  onlyZip.file('k.jpg', jpeg(6));
  const onlyPkg = await readItemsPackage(await onlyZip.generateAsync({ type: 'uint8array' }), 'only.zip', 'images_only');
  const onlyMatch = matchPackageImages(onlyPkg, 'images_only');
  assert(onlyMatch.entries[0].key === '6221000000011' && same(onlyMatch.entries[0].image?.bytes, jpeg(5)), 'تعديل الصور: بالباركود');
  assert(onlyMatch.entries[1].key === 'كراسة' && same(onlyMatch.entries[1].image?.bytes, jpeg(6)), 'تعديل الصور: بالاسم + اسم الملف');
  assert(onlyMatch.entries[2].key === 'قلم أزرق' && !onlyMatch.entries[2].image, 'تعديل الصور: اسم من غير صورة (مفيش بحث بالاسم في الصور)');
  assert(matchPackageImages({ rows: [['الصنف']], images: new Map(), embedded: new Map() }, 'images_only').headerError?.includes('«الصورة»'), 'تعديل الصور: عمود الصورة إلزامي');

  // ==================== التشغيل المتوازي وإعادة المحاولة ====================
  let active = 0;
  let maxActive = 0;
  const attempts = new Map<number, number>();
  const progress: number[] = [];
  const pool = await runPool(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    4,
    async n => {
      active++;
      maxActive = Math.max(maxActive, active);
      attempts.set(n, (attempts.get(n) || 0) + 1);
      await new Promise(r => setTimeout(r, 5));
      active--;
      if (n === 3 && attempts.get(n)! < 3) throw new Error('شبكة');
      if (n === 7) throw new Error('فشل دايمًا');
      if (n === 9) {
        const e: any = new Error('ملف مش صورة');
        e.noRetry = true;
        throw e;
      }
      return n * 10;
    },
    { retries: 2, onProgress: d => progress.push(d) }
  );
  assert(maxActive <= 4, `مش أكتر من 4 في نفس الوقت (${maxActive})`);
  assert(pool[2].ok && pool[2].value === 30 && attempts.get(3) === 3, 'فشل مرتين ونجح في التالتة');
  assert(!pool[6].ok && attempts.get(7) === 3 && pool[6].error === 'فشل دايمًا', 'فشل 3 مرات: يتسجل ويكمل');
  assert(!pool[8].ok && attempts.get(9) === 1, 'خطأ مالوش لازمة يتعاد (مش صورة): مرة واحدة');
  assert(pool.filter(p => p.ok).length === 8 && progress[progress.length - 1] === 10, 'الباقي اتنفذ والتقدم وصل للآخر');
  const abort = new AbortController();
  let ran = 0;
  await runPool([1, 2, 3, 4, 5, 6], 1, async () => {
    ran++;
    if (ran === 2) abort.abort();
  }, { signal: abort.signal });
  assert(ran === 2, 'الإلغاء بيوقف الباقي');

  // ==================== رفع الصور وربطها ====================
  const uploads: string[] = [];
  const setCalls: { entries: { key: string; url: string }[]; replace: boolean }[] = [];
  let failOnce = true;
  const report = await importPackageImages({
    entries: match.entries,
    replace: false,
    prepare: async img => `data:image/jpeg;base64,${Buffer.from(img.bytes).toString('base64')}`,
    upload: async dataUrl => {
      if (failOnce) {
        failOnce = false;
        throw new Error('انقطاع');
      }
      uploads.push(dataUrl);
      return `https://cdn.test/${uploads.length}.jpg`;
    },
    setImages: async (entries, replace) => {
      setCalls.push({ entries, replace });
      return entries.map(e => (e.key === '6221000000028' ? { key: e.key, status: 'skipped' } : { key: e.key, status: 'updated' }));
    },
    batchSize: 2
  });
  assert(uploads.length === 3 && report.uploaded === 3, 'رفع الصور الـ 3 (واحدة فشلت مرة واتعادت)');
  assert(setCalls.length === 2 && setCalls[0].entries.length === 2 && setCalls.every(c => c.replace === false), 'الربط على دفعات');
  assert(report.updated === 2 && report.skipped === 1, 'اتحطت 2 واتسابت 1 (الصنف ليه صورة)');
  assert(report.failed.length === 2 && report.failed.some(f => f.reason.includes('رابط')) && report.failed.some(f => f.reason.includes('مش موجودة')), 'التقرير فيه الصور اللي ما اترفعتش وسببها');
  const badReport = await importPackageImages({
    entries: match.entries.filter(e => e.image),
    replace: true,
    prepare: async img => {
      if (img.ext === 'png') throw Object.assign(new Error('الصورة أكبر من 5 ميجا'), { noRetry: true });
      return 'data:';
    },
    upload: async () => 'https://cdn.test/x.jpg',
    setImages: async entries => entries.map(e => ({ key: e.key, status: 'error', error: 'مفيش صنف' }))
  });
  assert(badReport.failed.length === 3 && badReport.failed.filter(f => f.reason.includes('مفيش صنف')).length === 2 && badReport.failed.filter(f => f.reason.includes('5 ميجا')).length === 1, 'أخطاء التجهيز والربط من السيرفر تتسجل لكل صورة بسببها');

  // ==================== التصدير ====================
  const items: ExportItem[] = [
    { id: '1', name: 'قلم جاف', printName: 'قلم', stockQuantity: 5, categoryId: 'c2', barcode: '0621000000011', salePrice: 10, purchasePrice: 6, notes: 'أزرق', unit: 'قطعة', reorderLimit: 2, supplier: 'مورد', taxRate: 14, imageUrl: 'https://cdn.test/pen.jpg' },
    { id: '2', name: 'كراسة', barcode: '6221000000028', salePrice: 25, imageUrl: 'data:image/png;base64,' + PNG.toString('base64') },
    { id: '3', name: 'كراسة كبيرة', barcode: '6221000000028', salePrice: 30, imageUrl: 'https://cdn.test/big.jpg' },
    { id: '4', name: 'ممحاة', barcode: '', salePrice: 5, imageUrl: 'https://cdn.test/broken.jpg' },
    { id: '5', name: 'برجل', barcode: '6221000000059', salePrice: 5, imageUrl: '' }
  ];
  const categories = [
    { id: 'c1', name: 'أدوات', parentCategoryId: null },
    { id: 'c2', name: 'أقلام', parentCategoryId: 'c1' }
  ];
  const fetched: string[] = [];
  const est = estimateExportSize(items);
  assert(est.itemsCount === 5 && est.withImage === 4 && est.approxBytes > 0, 'المعاينة قبل التصدير');
  const exportProgress: number[] = [];
  const exported = await buildItemsExportZip({
    items,
    categories,
    shopName: 'محل: النور',
    date: new Date('2026-11-20T10:00:00Z'),
    fetchImage: async url => {
      fetched.push(url);
      if (url.endsWith('broken.jpg')) throw new Error('السيرفر رد بـ 404');
      if (url.startsWith('data:')) return Uint8Array.from(PNG);
      return url.endsWith('pen.jpg') ? jpeg(11) : jpeg(12);
    },
    onProgress: d => exportProgress.push(d)
  });
  assert(exported.fileName === 'أصناف محل- النور 2026-11-20.zip', `اسم الملف (${exported.fileName})`);
  assert(exported.itemsCount === 5 && exported.imagesExported === 3 && exported.failed.length === 1 && exported.failed[0].name === 'ممحاة', 'اتصدّر 5 أصناف و3 صور وصورة فشلت');
  assert(fetched.filter(u => u.endsWith('broken.jpg')).length === 3, 'الصورة اللي فشلت اتجربت 3 مرات');
  assert(exportSummaryText({ itemsCount: 4286, imagesExported: 4250, failed: new Array(36) }) === 'اتصدّر 4,286 صنف و4,250 صورة • 36 صورة ما اتصدرتش', 'رسالة آخر التصدير');
  const out = await JSZip.loadAsync(exported.zipBytes);
  const fileNames = Object.keys(out.files).filter(n => !out.files[n].dir).sort();
  assert(JSON.stringify(fileNames) === JSON.stringify([EXPORT_WORKBOOK_NAME, `${IMAGES_FOLDER}/0621000000011.jpg`, `${IMAGES_FOLDER}/كراسة كبيرة.jpg`, `${IMAGES_FOLDER}/كراسة.png`].sort()), `محتوى الملف المضغوط (${fileNames.join('، ')})`);
  assert((out.files[`${IMAGES_FOLDER}/0621000000011.jpg`] as any)._data.compression.magic === '\x00\x00', 'الصور اتحطت من غير ضغط تاني');
  const outWb = XLSX.read(await out.file(EXPORT_WORKBOOK_NAME)!.async('uint8array'), { type: 'array' });
  const outRows = XLSX.utils.sheet_to_json<unknown[]>(outWb.Sheets[ITEMS_SHEET_NAME], { header: 1, defval: '' });
  assert(JSON.stringify(outRows[0]) === JSON.stringify(ADD_ITEMS_HEADERS), 'نفس أعمدة نموذج الاستيراد وبنفس الترتيب');
  assert(JSON.stringify(outRows[1]) === JSON.stringify(['قلم جاف', 'قلم', 5, 'أدوات / أقلام', '0621000000011', 10, 6, 'أزرق', 'قطعة', 2, 'مورد', 14, '0621000000011.jpg']), 'صف الصنف كامل (والباركود بالصفر اللي على الشمال)');
  assert(outRows[4][12] === '' && outRows[5][12] === '', 'الصورة اللي فشلت والصنف اللي ملوش صورة: الخانة فاضية');
  const failedRows = XLSX.utils.sheet_to_json<unknown[]>(outWb.Sheets[FAILED_SHEET_NAME], { header: 1, defval: '' });
  assert(failedRows.length === 2 && failedRows[1][0] === 'ممحاة' && String(failedRows[1][2]).includes('404'), 'شيت «صور ما اتصدرتش»');

  // ==================== التصدير ثم الاستيراد تاني ====================
  const back = await readItemsPackage(exported.zipBytes, exported.fileName);
  const backMatch = matchPackageImages(back);
  const backByName = new Map(backMatch.entries.map(e => [e.name, e]));
  assert(same(backByName.get('قلم جاف')?.image?.bytes, jpeg(11)) && same(backByName.get('كراسة')?.image?.bytes, PNG) && same(backByName.get('كراسة كبيرة')?.image?.bytes, jpeg(12)), 'الملف المصدّر يتستورد تاني بنفس الصور');
  assert(!backByName.get('ممحاة')?.image && !backByName.get('برجل')?.image && backMatch.unmatchedImages.length === 0 && backMatch.stats.problems === 1, 'من غير صور زيادة، والمشكلة الوحيدة: صنف من غير باركود');
  assert(backByName.get('ممحاة')?.problem === 'الباركود الرئيسي فاضي', 'صنف من غير باركود: الاستيراد بيقول السبب');

  console.log(`\n🎉 كل اختبارات استيراد وتصدير الأصناف بالصور نجحت (${passed} تحققًا).`);
}

main().catch(err => {
  console.error('❌', err?.message || err);
  process.exit(1);
});

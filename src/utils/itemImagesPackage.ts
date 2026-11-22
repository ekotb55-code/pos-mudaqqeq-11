/**
 * استيراد وتصدير الأصناف بالصور — POS مدقق
 * ---------------------------------------------------------------------------
 * الملف المقبول في «تعديل بالإكسيل»:
 *   1) ملف مضغوط (.zip) فيه ملف إكسيل واحد + الصور (في أي فولدر).
 *   2) ملف إكسيل عادي (.xlsx) والصور محطوطة جوه خانات عمود «الصورة» (صورة جوه الخانة أو فوقها).
 * ربط الصورة بالصنف (بالترتيب):
 *   صورة جوه خانة الصف ← اسم الملف المكتوب في خانة «الصورة» ← صورة اسمها نفس الباركود الرئيسي.
 *   الروابط (http) مش مقبولة. البحث بالاسم الملف بدون فرق بين الحروف الكبيرة والصغيرة وبدون اسم الفولدر.
 * التصدير: ملف مضغوط فيه «أصناف.xlsx» بنفس أعمدة نموذج «إضافة أصناف» + فولدر «صور» باسم الباركود الرئيسي،
 *   ولو الباركود فاضي أو متكرر: باسم الصنف. والصور تتحط زي ما هي من غير ضغط تاني.
 * الملف ده: قراءة الملف المرفوع وربط الصور بالأصناف. الرفع والتصدير وتصغير الصور في src/utils/itemImagesTransfer.ts.
 * بيشتغل في المتصفح والاختبارات على Node.
 */
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

export const ITEMS_SHEET_NAME = 'الأصناف';
export const IMAGE_COLUMN = 'الصورة';
export const IMAGES_FOLDER = 'صور';
export const EXPORT_WORKBOOK_NAME = 'أصناف.xlsx';
export const FAILED_SHEET_NAME = 'صور ما اتصدرتش';
/** نفس أعمدة نموذج «إضافة أصناف» على السيرفر وبنفس الترتيب */
export const ADD_ITEMS_HEADERS = [
  'اسم الصنف',
  'اسم الطباعة',
  'الكمية',
  'التصنيف',
  'الباركود الرئيسي',
  'سعر البيع',
  'سعر الشراء',
  'وصف الصنف',
  'الوحدة',
  'الحد الأدنى للكمية',
  'المورد',
  'نسبة الضريبة',
  'الصورة'
] as const;
/** أعمدة «تعديل الصور بس» */
export const IMAGES_ONLY_HEADERS = ['الصنف', 'الصورة'] as const;
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;
/** أقصى حجم للصورة الأصلية قبل التصغير */
export const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
/** أقصى حجم بعد التصغير (حد السيرفر 2 ميجا، والإرسال كنص بيزوّد الحجم الثلث) */
export const MAX_UPLOAD_IMAGE_BYTES = 1400 * 1024;
export const MAX_IMAGE_SIDE = 1000;

export type ImportMode = 'add_items' | 'images_only';

export interface PackageImage {
  fileName: string;
  bytes: Uint8Array;
  ext: string;
}

export class ItemImagesPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemImagesPackageError';
  }
}

// ---------------------------------------------------------------------------
// أدوات صغيرة
// ---------------------------------------------------------------------------

/** نوع الصورة من أول بايتات الملف (مش من الامتداد) */
export function sniffImageExt(bytes: Uint8Array): 'jpg' | 'png' | 'gif' | 'webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  return null;
}

const ARABIC_INDIC = /[٠-٩]/g;
const PERSIAN_INDIC = /[۰-۹]/g;

/** نفس توحيد الباركود في السيرفر: أرقام عربية ← إنجليزية، ومن غير مسافات */
export function normalizeBarcode(value: unknown): string {
  return String(value ?? '')
    .replace(ARABIC_INDIC, d => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_INDIC, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, '');
}

/** اسم الملف من غير الفولدر */
export function baseName(path: string): string {
  const parts = String(path || '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

function splitExt(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, i), ext: name.slice(i + 1).toLowerCase() };
}

/** مفتاح المقارنة لاسم ملف: من غير فولدر وبدون فرق كبير/صغير، وتوحيد الشكل */
export function imageNameKey(name: string): string {
  return baseName(String(name || '').trim()).normalize('NFC').toLowerCase();
}

function headerKey(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u200E\u200F\u202A-\u202E\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// أسماء الملفات العربي جوه الملف المضغوط
// ---------------------------------------------------------------------------

// النصف العلوي لجدول ترميز ويندوز العربي القديم (CP720) — ضغط ويندوز بيستخدمه لما مايعلّمش الأسماء UTF-8
const CP720_HIGH =
  '\u0080\u0081éâ\u0084à\u0086çêëèïî\u008d\u008e\u008f' +
  '\u0090ّْô¤ـûùءآأؤ£إئا' +
  'بةتثجحخدذرزسشص«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'ضطظعغفµقكلمنهوىي' +
  '≡ًٌٍَُِ≈°∙·√ⁿ²■\u00A0';

export function decodeCp720(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : CP720_HIGH[b - 0x80];
  return out;
}

const arabicScore = (text: string) => (text.match(/[ء-ي]/g) || []).length - (text.match(/[─-◿\u0080-\u009f�]/g) || []).length * 2;

/**
 * فك اسم ملف جوه zip مش متعلّم UTF-8: نجرب UTF-8، وبعدين CP720 و Windows-1256، وناخد اللي حروفه العربي أوضح.
 */
export function decodeZipFileName(bytes: Uint8Array | string[] | string): string {
  const raw = typeof bytes === 'string' ? Uint8Array.from(bytes, c => c.charCodeAt(0) & 0xff) : Array.isArray(bytes) ? Uint8Array.from(bytes.map(c => String(c).charCodeAt(0) & 0xff)) : bytes;
  if (raw.every(b => b < 0x80)) return String.fromCharCode(...raw);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    // مش UTF-8
  }
  const candidates = [decodeCp720(raw)];
  try {
    candidates.push(new TextDecoder('windows-1256').decode(raw));
  } catch {
    // المتصفح مش داعم الترميز ده
  }
  return candidates.sort((a, b) => arabicScore(b) - arabicScore(a))[0];
}

// ---------------------------------------------------------------------------
// قراءة الصور اللي جوه ملف الإكسيل نفسه
// ---------------------------------------------------------------------------

function cellRefToRowCol(ref: string): { row: number; col: number } | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

function resolvePath(fromFile: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const dir = fromFile.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') dir.pop();
    else if (part && part !== '.') dir.push(part);
  }
  return dir.join('/');
}

async function readRels(zip: JSZip, relsPath: string, ownerPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const file = zip.file(relsPath);
  if (!file) return map;
  const xml = await file.async('string');
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) map.set(id, resolvePath(ownerPath, target));
  }
  return map;
}

function relsPathOf(path: string): string {
  const parts = path.split('/');
  const name = parts.pop();
  return [...parts, '_rels', `${name}.rels`].join('/');
}

async function mediaImage(zip: JSZip, path: string): Promise<PackageImage | null> {
  const file = zip.file(path);
  if (!file) return null;
  const bytes = await file.async('uint8array');
  const ext = sniffImageExt(bytes);
  if (!ext) return null;
  return { fileName: baseName(path), bytes, ext };
}

/** مسار ورقة العمل جوه ملف الإكسيل من اسمها */
async function sheetPathByName(zip: JSZip, sheetName: string): Promise<string | null> {
  const wbFile = zip.file('xl/workbook.xml');
  if (!wbFile) return null;
  const wbXml = await wbFile.async('string');
  const rels = await readRels(zip, 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml');
  const sheets = [...wbXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)].map(m => ({
    name: decodeXml(/\bname="([^"]*)"/.exec(m[1])?.[1] || ''),
    rid: /\br:id="([^"]+)"/.exec(m[1])?.[1] || /\bid="([^"]+)"/.exec(m[1])?.[1] || ''
  }));
  const wanted = sheets.find(s => headerKey(s.name) === headerKey(sheetName)) || sheets[0];
  return wanted ? rels.get(wanted.rid) || null : null;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * الصور اللي جوه ورقة الأصناف، لكل صف (رقم الصف يبدأ من 0 = صف العناوين):
 * - صورة جوه الخانة (Excel «Place in Cell»)
 * - صورة فوق الخانة (Insert Picture العادي) — تتحسب للصف اللي بدايتها فيه
 * - صورة WPS (=DISPIMG)
 * imageCol: عمود «الصورة» لو معروف (لو في الصف أكتر من صورة نفضّل اللي في العمود ده)
 */
export async function extractEmbeddedImages(xlsxBytes: Uint8Array, sheetName: string, imageCol = -1): Promise<Map<number, PackageImage>> {
  const result = new Map<number, { image: PackageImage; col: number }>();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(xlsxBytes);
  } catch {
    return new Map();
  }
  const sheetPath = await sheetPathByName(zip, sheetName);
  if (!sheetPath || !zip.file(sheetPath)) return new Map();
  const sheetXml = await zip.file(sheetPath)!.async('string');
  const put = (row: number, col: number, image: PackageImage | null) => {
    if (!image || row < 1) return;
    const current = result.get(row);
    if (!current || (current.col !== imageCol && col === imageCol)) result.set(row, { image, col });
  };

  // 1) صور فوق الخانات (drawing)
  const sheetRels = await readRels(zip, relsPathOf(sheetPath), sheetPath);
  for (const m of sheetXml.matchAll(/<(?:\w+:)?drawing\b[^>]*\br:id="([^"]+)"/g)) {
    const drawingPath = sheetRels.get(m[1]);
    if (!drawingPath || !zip.file(drawingPath)) continue;
    const drawingXml = await zip.file(drawingPath)!.async('string');
    const drawingRels = await readRels(zip, relsPathOf(drawingPath), drawingPath);
    for (const a of drawingXml.matchAll(/<(?:\w+:)?(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/(?:\w+:)?\1>/g)) {
      const block = a[0];
      const from = /<(?:\w+:)?from>([\s\S]*?)<\/(?:\w+:)?from>/.exec(block)?.[1] || '';
      const col = Number(/<(?:\w+:)?col>(\d+)</.exec(from)?.[1]);
      const row = Number(/<(?:\w+:)?row>(\d+)</.exec(from)?.[1]);
      const embed = /<(?:\w+:)?blip\b[^>]*\br:embed="([^"]+)"/.exec(block)?.[1];
      if (!Number.isFinite(row) || !Number.isFinite(col) || !embed) continue;
      const mediaPath = drawingRels.get(embed);
      if (mediaPath) put(row, col, await mediaImage(zip, mediaPath));
    }
  }

  // 2) صور جوه الخانات (Excel 365): الخانة عليها vm → metadata → richData → الصورة
  const metadataFile = zip.file('xl/metadata.xml');
  const rvFile = zip.file('xl/richData/rdrichvalue.xml');
  const relFile = zip.file('xl/richData/richValueRel.xml');
  if (metadataFile && rvFile && relFile) {
    const metadataXml = await metadataFile.async('string');
    const futureBlock = /<(?:\w+:)?futureMetadata\b[^>]*name="XLRICHVALUE"[^>]*>([\s\S]*?)<\/(?:\w+:)?futureMetadata>/.exec(metadataXml)?.[1] || '';
    const futureIdx = [...futureBlock.matchAll(/<(?:\w+:)?bk\b[^>]*>([\s\S]*?)<\/(?:\w+:)?bk>/g)].map(b => Number(/<(?:\w+:)?rvb\b[^>]*\bi="(\d+)"/.exec(b[1])?.[1]));
    const valueBlock = /<(?:\w+:)?valueMetadata\b[^>]*>([\s\S]*?)<\/(?:\w+:)?valueMetadata>/.exec(metadataXml)?.[1] || '';
    const valueToFuture = [...valueBlock.matchAll(/<(?:\w+:)?bk\b[^>]*>([\s\S]*?)<\/(?:\w+:)?bk>/g)].map(b => Number(/<(?:\w+:)?rc\b[^>]*\bv="(\d+)"/.exec(b[1])?.[1]));
    const structureFile = zip.file('xl/richData/rdrichvaluestructure.xml');
    const structures = structureFile
      ? [...(await structureFile.async('string')).matchAll(/<(?:\w+:)?s\b[^>]*>([\s\S]*?)<\/(?:\w+:)?s>/g)].map(s => [...s[1].matchAll(/<(?:\w+:)?k\b[^>]*\bn="([^"]+)"/g)].map(k => k[1]))
      : [];
    const rvXml = await rvFile.async('string');
    const richValues = [...rvXml.matchAll(/<(?:\w+:)?rv\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?rv>/g)].map(rv => {
      const s = Number(/\bs="(\d+)"/.exec(rv[1])?.[1] ?? 0);
      const values = [...rv[2].matchAll(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/g)].map(v => v[1]);
      const keys = structures[s] || [];
      const pos = keys.indexOf('_rvRel:LocalImageIdentifier');
      return Number(values[pos >= 0 ? pos : 0]);
    });
    const relXml = await relFile.async('string');
    const relIds = [...relXml.matchAll(/<(?:\w+:)?rel\b[^>]*\br:id="([^"]+)"/g)].map(r => r[1]);
    const richRels = await readRels(zip, 'xl/richData/_rels/richValueRel.xml.rels', 'xl/richData/richValueRel.xml');
    for (const c of sheetXml.matchAll(/<(?:\w+:)?c\b([^>]*)>/g)) {
      const vm = /\bvm="(\d+)"/.exec(c[1])?.[1];
      const ref = /\br="([A-Z]+\d+)"/i.exec(c[1])?.[1];
      if (!vm || !ref) continue;
      const pos = cellRefToRowCol(ref);
      const futurePos = valueToFuture[Number(vm) - 1];
      const rvIndex = futureIdx[futurePos];
      const relIndex = richValues[rvIndex];
      const mediaPath = richRels.get(relIds[relIndex]);
      if (pos && mediaPath) put(pos.row, pos.col, await mediaImage(zip, mediaPath));
    }
  }

  // 3) صور WPS: =DISPIMG("ID_…",1) + xl/cellimages.xml
  const wpsFile = zip.file('xl/cellimages.xml');
  if (wpsFile) {
    const wpsXml = await wpsFile.async('string');
    const wpsRels = await readRels(zip, 'xl/_rels/cellimages.xml.rels', 'xl/cellimages.xml');
    const byName = new Map<string, string>();
    for (const pic of wpsXml.matchAll(/<(?:\w+:)?pic\b[\s\S]*?<\/(?:\w+:)?pic>/g)) {
      const name = /<(?:\w+:)?cNvPr\b[^>]*\bname="([^"]+)"/.exec(pic[0])?.[1];
      const embed = /<(?:\w+:)?blip\b[^>]*\br:embed="([^"]+)"/.exec(pic[0])?.[1];
      const mediaPath = embed ? wpsRels.get(embed) : undefined;
      if (name && mediaPath) byName.set(name, mediaPath);
    }
    for (const c of sheetXml.matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g)) {
      const id = /DISPIMG\(&quot;([^&]+)&quot;|DISPIMG\("([^"]+)"/.exec(c[2]);
      const ref = /\br="([A-Z]+\d+)"/i.exec(c[1])?.[1];
      const mediaPath = id ? byName.get(id[1] || id[2]) : undefined;
      const pos = ref ? cellRefToRowCol(ref) : null;
      if (pos && mediaPath) put(pos.row, pos.col, await mediaImage(zip, mediaPath));
    }
  }
  return new Map([...result].map(([row, v]) => [row, v.image]));
}

// ---------------------------------------------------------------------------
// قراءة الملف المرفوع
// ---------------------------------------------------------------------------

export interface ReadPackageResult {
  kind: 'zip' | 'xlsx';
  /** ملف الإكسيل نفسه (بيتبعت للسيرفر زي ما هو للمعاينة والحفظ) */
  workbookBytes: Uint8Array;
  workbookName: string;
  sheetName: string;
  rows: unknown[][];
  /** صور الملف المضغوط: المفتاح = اسم الملف بحروف صغيرة ومن غير فولدر */
  images: Map<string, PackageImage>;
  /** صور جوه خانات الإكسيل: المفتاح = رقم الصف (0 = العناوين) */
  embedded: Map<number, PackageImage>;
  warnings: string[];
}

const isExcelName = (name: string) => /\.(xlsx|xls)$/i.test(name);
const isZipBytes = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

/** هل ملف الـ xlsx ده ملف إكسيل ولا ملف مضغوط عادي؟ (الاتنين بيبدأوا بنفس البايتات) */
async function isXlsxZip(zip: JSZip): Promise<boolean> {
  return Boolean(zip.file('[Content_Types].xml') && zip.file('xl/workbook.xml'));
}

export async function readItemsPackage(data: ArrayBuffer | Uint8Array, fileName: string, mode: ImportMode = 'add_items'): Promise<ReadPackageResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const warnings: string[] = [];
  let kind: 'zip' | 'xlsx' = 'xlsx';
  let workbookBytes = bytes;
  let workbookName = baseName(fileName);
  const images = new Map<string, PackageImage>();

  if (isZipBytes(bytes)) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes, { decodeFileName: decodeZipFileName as any });
    } catch {
      throw new ItemImagesPackageError('الملف ده تالف أو مش ملف مضغوط سليم');
    }
    if (!(await isXlsxZip(zip))) {
      kind = 'zip';
      const entries = Object.values(zip.files).filter(f => !f.dir && !/(^|\/)__MACOSX\//.test(f.name) && !baseName(f.name).startsWith('._') && !baseName(f.name).startsWith('~$'));
      const excels = entries.filter(f => isExcelName(f.name));
      if (excels.length === 0) throw new ItemImagesPackageError('الملف المضغوط مفيهوش ملف إكسيل بالأصناف');
      if (excels.length > 1) throw new ItemImagesPackageError(`الملف المضغوط فيه أكتر من ملف إكسيل (${excels.map(f => baseName(f.name)).join('، ')}). سيب ملف واحد بس`);
      workbookBytes = await excels[0].async('uint8array');
      workbookName = baseName(excels[0].name);
      for (const f of entries) {
        if (f === excels[0]) continue;
        const { ext } = splitExt(baseName(f.name));
        if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) continue;
        const imgBytes = await f.async('uint8array');
        const key = imageNameKey(f.name);
        if (images.has(key)) {
          warnings.push(`فيه أكتر من صورة بنفس الاسم «${baseName(f.name)}»، واتاخدت الأولى`);
          continue;
        }
        images.set(key, { fileName: baseName(f.name), bytes: imgBytes, ext });
      }
    }
  } else if (!/\.(xls|csv)$/i.test(fileName)) {
    throw new ItemImagesPackageError('نوع الملف مش مقبول. ارفع ملف إكسيل (.xlsx) أو ملف مضغوط (.zip)');
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(workbookBytes, { type: 'array' });
  } catch {
    throw new ItemImagesPackageError('تعذر قراءة ملف الإكسيل');
  }
  const wanted = mode === 'add_items' ? ITEMS_SHEET_NAME : '';
  const sheetName = (wanted && wb.SheetNames.find(n => headerKey(n) === headerKey(wanted))) || wb.SheetNames[0];
  if (!sheetName) throw new ItemImagesPackageError('ملف الإكسيل مفيهوش أي ورقة');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '', raw: true });
  const imageCol = (rows[0] || []).findIndex(h => headerKey(h) === IMAGE_COLUMN);
  const embedded = isZipBytes(workbookBytes) ? await extractEmbeddedImages(workbookBytes, sheetName, imageCol) : new Map<number, PackageImage>();
  return { kind, workbookBytes, workbookName, sheetName, rows, images, embedded, warnings };
}

// ---------------------------------------------------------------------------
// ربط الصور بالأصناف (قبل أي حفظ)
// ---------------------------------------------------------------------------

export interface ImageMatchEntry {
  /** رقم الصف في الإكسيل (2 = أول صنف) للعرض */
  excelRow: number;
  /** اللي بيتبعت للسيرفر علشان يلاقي الصنف: الباركود الرئيسي، أو في «تعديل الصور بس» الباركود أو الاسم */
  key: string;
  name: string;
  barcode: string;
  image?: PackageImage;
  source?: 'خانة' | 'اسم الملف' | 'الباركود';
  problem?: string;
}

export interface ImageMatchResult {
  headerError?: string;
  entries: ImageMatchEntry[];
  /** صور في الملف المضغوط مش مربوطة بأي صنف */
  unmatchedImages: string[];
  stats: { rows: number; withImage: number; withoutImage: number; problems: number };
}

const EXT_PRIORITY = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

export function matchPackageImages(pkg: Pick<ReadPackageResult, 'rows' | 'images' | 'embedded'>, mode: ImportMode = 'add_items'): ImageMatchResult {
  const header = (pkg.rows[0] || []).map(headerKey);
  const imageCol = header.indexOf(IMAGE_COLUMN);
  const nameCol = mode === 'add_items' ? header.indexOf('اسم الصنف') : -1;
  const barcodeCol = mode === 'add_items' ? header.indexOf('الباركود الرئيسي') : -1;
  const keyCol = mode === 'images_only' ? header.findIndex(h => ['الصنف', 'اسم الصنف', 'الباركود الرئيسي', 'الباركود'].includes(h)) : barcodeCol;
  const empty: ImageMatchResult = { entries: [], unmatchedImages: [], stats: { rows: 0, withImage: 0, withoutImage: 0, problems: 0 } };
  if (mode === 'add_items' && (nameCol < 0 || barcodeCol < 0)) return { ...empty, headerError: 'لازم الملف يكون فيه عمودين «اسم الصنف» و«الباركود الرئيسي»' };
  if (mode === 'images_only' && (keyCol < 0 || imageCol < 0)) return { ...empty, headerError: 'لازم الملف يكون فيه عمودين «الصنف» و«الصورة»' };

  // صور اسمها الباركود: المفتاح = الاسم من غير امتداد
  const byStem = new Map<string, PackageImage>();
  for (const ext of EXT_PRIORITY) {
    for (const [key, img] of pkg.images) {
      const parts = splitExt(key);
      if (parts.ext === ext && !byStem.has(parts.stem)) byStem.set(parts.stem, img);
    }
  }
  const used = new Set<PackageImage>();
  const entries: ImageMatchEntry[] = [];
  for (let r = 1; r < pkg.rows.length; r++) {
    const row = pkg.rows[r] || [];
    const name = nameCol >= 0 ? String(row[nameCol] ?? '').trim() : '';
    const rawKey = String(row[keyCol] ?? '').trim();
    if (!rawKey && !name && !pkg.embedded.has(r)) continue;
    const barcode = mode === 'add_items' || /^[\d٠-٩۰-۹\s]+$/.test(rawKey) ? normalizeBarcode(rawKey) : '';
    const key = mode === 'add_items' ? barcode : rawKey;
    const entry: ImageMatchEntry = { excelRow: r + 1, key, name: name || (mode === 'images_only' ? rawKey : ''), barcode };
    if (!key) {
      entry.problem = mode === 'add_items' ? 'الباركود الرئيسي فاضي' : 'خانة الصنف فاضية';
      entries.push(entry);
      continue;
    }
    const cellText = imageCol >= 0 ? String(row[imageCol] ?? '').trim() : '';
    const embedded = pkg.embedded.get(r);
    if (embedded) {
      entry.image = embedded;
      entry.source = 'خانة';
    } else if (cellText && !/^#/.test(cellText)) {
      if (/^https?:\/\//i.test(cellText)) {
        entry.problem = 'الصورة رابط لموقع تاني ومش مقبول: حط الصورة نفسها في الملف';
      } else {
        const img = pkg.images.get(imageNameKey(cellText));
        if (img) {
          entry.image = img;
          entry.source = 'اسم الملف';
        } else {
          entry.problem = `الصورة «${baseName(cellText)}» مش موجودة في الملف المضغوط`;
        }
      }
    } else if (barcode && byStem.has(barcode.toLowerCase())) {
      entry.image = byStem.get(barcode.toLowerCase());
      entry.source = 'الباركود';
    }
    if (entry.image) used.add(entry.image);
    entries.push(entry);
  }
  const unmatchedImages = [...pkg.images.values()].filter(img => !used.has(img)).map(img => img.fileName);
  const withImage = entries.filter(e => e.image).length;
  return {
    entries,
    unmatchedImages,
    stats: {
      rows: entries.length,
      withImage,
      withoutImage: entries.length - withImage,
      problems: entries.filter(e => e.problem).length
    }
  };
}

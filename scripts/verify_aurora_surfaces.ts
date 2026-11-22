import fs from 'fs';
import path from 'path';
import assert from 'assert';

const root = process.cwd();
const cssPath = path.join(root, 'src', 'index.css');
const css = fs.readFileSync(cssPath, 'utf8');

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function blendAlpha(fg: [number, number, number], bg: [number, number, number], alpha: number): [number, number, number] {
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha))
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const linear = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Extract section helper
function getSection(startMarker: string, endMarker: string): string {
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker, start);
  assert(start !== -1, `Missing start marker: ${startMarker}`);
  assert(end !== -1, `Missing end marker: ${endMarker}`);
  return css.slice(start, end);
}

console.log('1) Checking Aurora & Aurora-Sky CSS Tokens & 4-corner Gradients...');
const auroraBlock = getSection('[data-theme="aurora"] {', '[data-theme="aurora-sky"] {');
const auroraSkyBlock = getSection('[data-theme="aurora-sky"] {', 'body {');

for (const color of ['#F1EFFB', '#C9CDFF', '#FFD3EC', '#BFEFE2', '#FFE3C4', 'transparent 60%']) {
  assert(auroraBlock.includes(color), `Aurora block missing ${color}`);
}
for (const color of ['#EEF5FD', '#BFDDFF', '#CDEFFF', '#C4F1EE', '#DDE5FF', 'transparent 60%']) {
  assert(auroraSkyBlock.includes(color), `Aurora-Sky block missing ${color}`);
}

assert(auroraBlock.includes('rgba(255, 255, 255, 0.66)'), 'Aurora glass bg missing');
assert(auroraBlock.includes('blur(24px) saturate(170%)'), 'Aurora glass blur missing');
assert(auroraBlock.includes('rgba(255, 255, 255, 0.92)'), 'Aurora glass border missing');
assert(auroraBlock.includes('0 18px 44px rgba(64, 48, 140, 0.11), inset 0 1px 0 rgba(255, 255, 255, 0.9)'), 'Aurora glass shadow missing');

assert(auroraSkyBlock.includes('rgba(255, 255, 255, 0.66)'), 'Aurora-Sky glass bg missing');
assert(auroraSkyBlock.includes('blur(24px) saturate(170%)'), 'Aurora-Sky glass blur missing');
assert(auroraSkyBlock.includes('rgba(255, 255, 255, 0.92)'), 'Aurora-Sky glass border missing');
assert(auroraSkyBlock.includes('0 18px 44px rgba(20, 90, 170, 0.11), inset 0 1px 0 rgba(255, 255, 255, 0.9)'), 'Aurora-Sky glass shadow missing');

console.log('2) Checking scoping: 3 existing themes untouched...');
const existingThemesSection = getSection('[data-theme="light-sky"]', '[data-theme="aurora"]');
assert(!existingThemesSection.includes('rgba(255, 255, 255, 0.66)'), 'Existing themes must not have glass-bg');
assert(!existingThemesSection.includes('blur(24px)'), 'Existing themes must not have glass-blur');

const darkLightSkyOverrides = getSection('Dark Mode Cascading Overrides', 'Aurora & Aurora Sky Surfaces');
assert(!darkLightSkyOverrides.includes('backdrop-filter'), 'Dark/Light-sky cascading section must not contain backdrop-filter');

console.log('3) Checking fixed background attachment, glass surfaces, exclusions & fallbacks...');
const auroraOverrides = getSection('Aurora & Aurora Sky Surfaces', 'Motion Effects & Animations');
assert(auroraOverrides.includes('background-attachment: fixed;'), 'Missing background-attachment: fixed');
assert(auroraOverrides.includes('#root header.mudaqqeq-navbar') && auroraOverrides.includes('.navbar-glass-chip'), 'Missing header container & glass chip selector');
assert(auroraOverrides.includes('#root aside'), 'Missing sidebar glass selector');
assert(auroraOverrides.includes('#root nav.fixed.bottom-0'), 'Missing mobile bottom nav glass selector');
assert(auroraOverrides.includes('main .bg-white:is(.rounded-xl, .rounded-2xl, .rounded-3xl'), 'Missing cards glass selector');

// Exclusions
for (const sel of [
  'main .bg-white:has(table)',
  'main .bg-white:has(form)',
  '.fixed.inset-0 .bg-white',
  '[role="dialog"] .bg-white',
  '.animate-modal-content',
  'main:has(#pos-barcode-input) .bg-white',
  'main:has(#sales-history-section) .bg-white',
  'main .bg-white .bg-white',
  'tbody tr',
  'ul > li'
]) {
  assert(auroraOverrides.includes(sel), `Missing clarity/list exclusion selector: ${sel}`);
}

// Fallbacks
assert(auroraOverrides.includes('[data-theme="aurora"][data-motion="off"]'), 'Missing aurora motion=off fallback');
assert(auroraOverrides.includes('[data-theme="aurora-sky"][data-motion="off"]'), 'Missing aurora-sky motion=off fallback');
assert(auroraOverrides.includes('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))'), 'Missing @supports fallback');
assert(auroraOverrides.includes('@media (prefers-reduced-transparency: reduce)'), 'Missing prefers-reduced-transparency fallback');
assert(auroraOverrides.includes('@media (prefers-reduced-motion: reduce)'), 'Missing prefers-reduced-motion fallback');

// Print protection
const printSection = getSection('@media print {', '/* Custom scrollbar */');
assert(printSection.includes('body:not(.printing-receipt)') && printSection.includes('background-image: none !important;'), 'Print section should reset page body background & gradients');
assert(printSection.includes('body.printing-receipt'), 'Print section should reset receipt body');
assert(printSection.includes('background: #ffffff !important;'), 'Print background must remain #ffffff');
assert(printSection.includes('color: #000000 !important;'), 'Print text must remain #000000');
assert(printSection.includes('backdrop-filter: none !important;'), 'Print backdrop-filter must be none');

console.log('4) Checking WCAG contrast (>= 4.5:1) over glass surfaces...');
const white: [number, number, number] = [255, 255, 255];

const auroraCanvasSamples = ['#F1EFFB', '#C9CDFF', '#FFD3EC', '#BFEFE2', '#FFE3C4'];
const auroraTextChecks = [
  { name: 'aurora --text-primary', hex: '#17153B' },
  { name: 'aurora --text-secondary', hex: '#5E5A80' },
  { name: 'aurora --primary-on-white', hex: '#4338CA' }
];
for (const text of auroraTextChecks) {
  for (const bgHex of auroraCanvasSamples) {
    const surface = blendAlpha(white, hexToRgb(bgHex), 0.66);
    const ratio = contrastRatio(hexToRgb(text.hex), surface);
    assert(ratio >= 4.5, `${text.name} (${text.hex}) over glass on ${bgHex} contrast ${ratio.toFixed(2)} < 4.5`);
  }
}

const skyCanvasSamples = ['#EEF5FD', '#BFDDFF', '#CDEFFF', '#C4F1EE', '#DDE5FF'];
const skyTextChecks = [
  { name: 'aurora-sky --text-primary', hex: '#0F2540' },
  { name: 'aurora-sky --text-secondary', hex: '#55667E' },
  { name: 'aurora-sky --primary-on-white', hex: '#0A5FC2' }
];
for (const text of skyTextChecks) {
  for (const bgHex of skyCanvasSamples) {
    const surface = blendAlpha(white, hexToRgb(bgHex), 0.66);
    const ratio = contrastRatio(hexToRgb(text.hex), surface);
    assert(ratio >= 4.5, `${text.name} (${text.hex}) over glass on ${bgHex} contrast ${ratio.toFixed(2)} < 4.5`);
  }
}

console.log('All Aurora & Aurora-Sky surface checks and WCAG contrast checks (>= 4.5:1) PASSED!');

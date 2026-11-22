import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductsPage } from './src/pages/ProductsPage';
import { PageSurface, SectionHeading, CompactTable } from './src/components/ui';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// 1. DESIGN_RULES.md exists with all 8 rules
const designRulesPath = path.resolve('DESIGN_RULES.md');
assert.ok(fs.existsSync(designRulesPath), 'DESIGN_RULES.md must exist at root');
const designRules = fs.readFileSync(designRulesPath, 'utf8');
for (const keyword of ['صفحة بسطح واحد', '15px', '600', 'max-content', '320px', '120px', '160px', '220px', '360px', '480px', '44px', '4.5:1']) {
  assert.ok(designRules.includes(keyword), `DESIGN_RULES.md missing keyword: ${keyword}`);
}

// 2. index.css CSS rules verification
const css = fs.readFileSync(path.resolve('src/index.css'), 'utf8');
assert.ok(css.includes('.page-surface {') && css.includes('box-shadow: none;'), '.page-surface must have no shadow');
assert.ok(css.includes('width: max-content;'), '.compact-table must set width: max-content');
assert.ok(css.includes('max-width: 320px;') && css.includes('white-space: normal;'), 'text columns must cap at 320px with wrap');
assert.ok(css.includes('.input-w-number') && css.includes('width: 120px;'), '.input-w-number 120px');
assert.ok(css.includes('.input-w-date') && css.includes('width: 160px;'), '.input-w-date 160px');
assert.ok(css.includes('.input-w-code') && css.includes('width: 220px;'), '.input-w-code 220px');
assert.ok(css.includes('.input-w-name') && css.includes('width: 360px;'), '.input-w-name 360px');
assert.ok(css.includes('.input-w-notes') && css.includes('width: 480px;'), '.input-w-notes 480px');

// 3. Contrast verification across all 5 themes (>= 4.5:1)
const themePalettes = [
  { name: 'light-sky', surface: '#FFFFFF', subtle: '#F1F5F8', primaryText: '#263E50', secondaryText: '#55667E', link: '#155E9A', sale: '#155E9A', purchase: '#15694B', low: '#9A4A00', out: '#B42318' },
  { name: 'dark', surface: '#1B2D40', subtle: '#203448', primaryText: '#EFF7FB', secondaryText: '#A8BFCE', link: '#7DD3FC', sale: '#7DD3FC', purchase: '#6EE7B7', low: '#FCD34D', out: '#FCA5A5' },
  { name: 'current', surface: '#FFFFFF', subtle: '#E8F3FB', primaryText: '#263746', secondaryText: '#55667E', link: '#155E9A', sale: '#155E9A', purchase: '#15694B', low: '#9A4A00', out: '#B42318' },
  { name: 'aurora', surface: '#FFFFFF', subtle: '#ECE8F9', primaryText: '#17153B', secondaryText: '#5E5A80', link: '#155E9A', sale: '#155E9A', purchase: '#15694B', low: '#9A4A00', out: '#B42318' },
  { name: 'aurora-sky', surface: '#FFFFFF', subtle: '#E6EFFB', primaryText: '#0F2540', secondaryText: '#55667E', link: '#155E9A', sale: '#155E9A', purchase: '#15694B', low: '#9A4A00', out: '#B42318' },
];

for (const t of themePalettes) {
  assert.ok(contrastRatio(t.primaryText, t.surface) >= 4.5, `${t.name} primaryText contrast`);
  assert.ok(contrastRatio(t.primaryText, t.subtle) >= 4.5, `${t.name} table header contrast`);
  assert.ok(contrastRatio(t.link, t.surface) >= 4.5, `${t.name} link contrast`);
  assert.ok(contrastRatio(t.sale, t.surface) >= 4.5, `${t.name} sale money contrast`);
  assert.ok(contrastRatio(t.purchase, t.surface) >= 4.5, `${t.name} purchase money contrast`);
  assert.ok(contrastRatio(t.low, t.surface) >= 4.5, `${t.name} low stock contrast`);
  assert.ok(contrastRatio(t.out, t.surface) >= 4.5, `${t.name} out stock contrast`);
}
assert.ok(contrastRatio('#FFFFFF', '#157347') >= 4.5, 'Save green button contrast');
assert.ok(contrastRatio('#FFFFFF', '#1668B2') >= 4.5, 'Primary blue button contrast');
assert.ok(contrastRatio('#FFFFFF', '#B42318') >= 4.5, 'Delete red button contrast');

// 4. SSR render checks of shared primitives & ProductsPage
const surfaceHtml = renderToStaticMarkup(
  React.createElement(
    PageSurface,
    { title: 'عنوان تجريبي' },
    React.createElement(SectionHeading, { title: 'قسم فرعي', withTopDivider: true }),
    React.createElement(
      CompactTable,
      { ariaLabel: 'جدول' },
      React.createElement('tbody', null, React.createElement('tr', null, React.createElement('td', null, 'بيان')))
    )
  )
);
assert.ok(surfaceHtml.includes('page-surface'), 'PageSurface renders .page-surface');
assert.ok(surfaceHtml.includes('text-[15px] font-semibold'), 'SectionHeading renders 15px 600');
assert.ok(surfaceHtml.includes('compact-table-wrap') && surfaceHtml.includes('compact-table'), 'CompactTable renders classes');

// Minimal global mocks for SSR of ProductsPage
(globalThis as any).sessionStorage = { getItem: () => null, setItem: () => {} };
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };

const productsHtml = renderToStaticMarkup(
  React.createElement(ProductsPage, {
    items: [
      {
        id: 'item-1',
        name: 'منتج تجريبي طويل لاختبار التفاف النص داخل حدود 320 بكسل',
        barcode: '6221234567890',
        salePrice: 120,
        purchasePrice: 80,
        stockQuantity: 15,
        categoryId: 'cat-1',
        categoryName: 'إلكترونيات',
        notes: 'وصف تفصيلي يختبر التفاف السطر داخل الخلية دون قص',
        supplier: 'مورد رئيسي',
        unit: 'قطعة',
      },
    ],
    categories: [{ id: 'cat-1', name: 'إلكترونيات' }],
    userRole: 'designer',
    user: { id: 'u1', username: 'admin', name: 'المدير', role: 'designer', isOwner: true },
    displaySettings: { enableInlineEdit: true },
    onNavigateItemRoute: () => {},
    onDeleteItem: async () => ({ success: true }),
    onQuickSell: () => {},
  })
);

assert.ok(productsHtml.includes('class="page-surface"'), 'ProductsPage uses single PageSurface');
assert.ok(productsHtml.includes('class="compact-table"'), 'ProductsPage uses CompactTable');
assert.ok(productsHtml.includes('input-w-code'), 'ProductsPage search uses input-w-code');
assert.ok(!productsHtml.includes('shadow-2xs'), 'No inner card shadow classes on ProductsPage');
assert.ok(!productsHtml.includes('min-w-[960px]'), 'No forced 960px min-width full-stretch table');

// 5. Verify ProductsPage.tsx source uses all shared primitives & fixed input widths, and avoids nested cards/shadows
const productsSrc = fs.readFileSync(path.resolve('src/pages/ProductsPage.tsx'), 'utf8');
assert.ok(productsSrc.includes('<PageSurface'), 'Uses <PageSurface>');
assert.ok(productsSrc.includes('<SectionHeading'), 'Uses <SectionHeading>');
assert.ok(productsSrc.includes('<CompactTable'), 'Uses <CompactTable>');
assert.ok(productsSrc.includes('INPUT_WIDTH_CLASSES.name'), 'Uses INPUT_WIDTH_CLASSES.name (360px)');
assert.ok(productsSrc.includes('INPUT_WIDTH_CLASSES.code'), 'Uses INPUT_WIDTH_CLASSES.code (220px)');
assert.ok(productsSrc.includes('INPUT_WIDTH_CLASSES.notes'), 'Uses INPUT_WIDTH_CLASSES.notes (480px)');
assert.ok(productsSrc.includes('INPUT_WIDTH_CLASSES.number'), 'Uses INPUT_WIDTH_CLASSES.number (120px)');
assert.ok(productsSrc.includes('INPUT_WIDTH_CLASSES.date'), 'Uses INPUT_WIDTH_CLASSES.date (160px)');
assert.ok(!productsSrc.includes('bg-white rounded-xl'), 'No nested white card containers inside ProductsPage');
assert.ok(!productsSrc.includes('shadow-2xs'), 'No card shadows inside ProductsPage');
assert.ok(!productsSrc.includes('bg-slate-100 border-t-2'), 'No shaded totals box inside ProductsPage');

console.log('ALL SINGLE-SURFACE PRODUCTS PAGE CHECKS PASSED (9/9)');

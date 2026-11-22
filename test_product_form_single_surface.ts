import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { ProductFormPage } from './src/pages/ProductFormPage';
import type { Item, Platform, ItemPlatformCost, ProductCategory, UserAccount } from './src/types';

function assert(cond: unknown, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

const mockUser: UserAccount = {
  id: 'u1',
  username: 'admin',
  fullName: 'أحمد المدير',
  role: 'designer',
  status: 'نشط',
  permissions: []
};

const mockCategories: ProductCategory[] = [
  { id: 'cat-1', name: 'إلكترونيات', displayOrder: 1, status: 'نشط', createdAt: '2026-01-01' },
  { id: 'cat-2', name: 'سماعات', parentCategoryId: 'cat-1', displayOrder: 2, status: 'نشط', createdAt: '2026-01-01' }
];

const mockPlatforms: Platform[] = [
  { id: 'plt-1', name: 'أمازون', discountPercentage: 10, defaultPickupFee: 15, status: 'نشطة' },
  { id: 'plt-2', name: 'نون', discountPercentage: 12, defaultPickupFee: 20, status: 'active' }
];

const mockItem: Item = {
  id: 'item-1',
  sku: 'SKU-101',
  barcode: '2001234567890',
  secondaryBarcodes: ['2009998887771', '2009998887772'],
  name: 'سماعة بلوتوث احترافية',
  categoryId: 'cat-2',
  categoryName: 'سماعات',
  unit: 'قطعة',
  salePrice: 500,
  minPrice: 450,
  purchasePrice: 300,
  packagingCost: 20,
  taxRate: 14,
  pickupFee: 15,
  enableBnpl: true,
  bnplPercentage: 20,
  stockQuantity: 25,
  reorderLimit: 5,
  supplier: 'المورد الذهبي',
  status: 'نشط',
  imageUrl: 'https://example.com/item.jpg',
  notes: 'ضمان سنة كاملة',
  platformIds: ['plt-1', 'plt-2']
};

const mockCosts: ItemPlatformCost[] = [
  { itemId: 'item-1', platformId: 'plt-1', returnShippingDeduction: 35 },
  { itemId: 'item-1', platformId: 'plt-2', returnShippingDeduction: 40 }
];

const noopSave = async () => mockItem;
const noop = () => {};

const htmlNew = renderToStaticMarkup(
  React.createElement(ProductFormPage, {
    mode: 'new',
    platforms: mockPlatforms,
    costs: [],
    userRole: 'designer',
    user: mockUser,
    existingItems: [mockItem],
    categories: mockCategories,
    onSave: noopSave,
    onBackToList: noop,
    onNavigateItemRoute: noop
  })
);

const htmlEdit = renderToStaticMarkup(
  React.createElement(ProductFormPage, {
    mode: 'edit',
    itemId: mockItem.id,
    item: mockItem,
    platforms: mockPlatforms,
    costs: mockCosts,
    userRole: 'designer',
    user: mockUser,
    existingItems: [mockItem],
    categories: mockCategories,
    onSave: noopSave,
    onBackToList: noop,
    onNavigateItemRoute: noop
  })
);

// 1. صفحة بسطح واحد بدون بطاقات متداخلة أو خلفيات ملونة أو ظلال
for (const [label, html] of [
  ['NEW', htmlNew],
  ['EDIT', htmlEdit]
] as const) {
  assert(/class="page-surface[" ]/.test(html), `${label}: must use PageSurface (.page-surface)`);
  assert(html.includes('page-surface-divider') && html.includes('text-[15px] font-semibold'), `${label}: must use SectionHeading (15px 600 + divider)`);
  assert(!html.includes('rounded-3xl'), `${label}: must not contain nested rounded-3xl cards`);
  assert(!html.includes('shadow-'), `${label}: must not contain shadow-* utility classes`);
  assert(!html.includes('bg-slate-50'), `${label}: must not contain tinted bg-slate-50 cards`);
  assert(!html.includes('bg-purple-50'), `${label}: must not contain tinted bg-purple-50 cards`);
  assert(!html.includes('bg-amber-50'), `${label}: must not contain tinted bg-amber-50 cards`);
  assert(!html.includes('bg-emerald-50'), `${label}: must not contain tinted bg-emerald-50 cards`);

  // 2. شريط الأقسام العلوي محذوف مبدئيًا ولا يظهر إلا إذا تجاوز الارتفاع شاشتين
  assert(!html.includes('aria-label="أقسام بطاقة الصنف"'), `${label}: top section nav should not render initially`);

  // 3. صورة الصنف 96px (w-24 h-24)
  assert(html.includes('w-24 h-24'), `${label}: product image container must be 96px (w-24 h-24)`);

  // 4. قائمة المنصات متعددة الاختيار المضغوطة بدل الأزرار الكبيرة
  assert(html.includes('aria-haspopup="listbox"'), `${label}: platforms selector must be compact multi-select listbox button`);

  // 5. جدول الأسعار والربح داخل CompactTable بعروض أرقام
  assert(html.includes('aria-label="جدول الأسعار والتكاليف"'), `${label}: pricing table must be inside CompactTable`);
  assert(html.includes('id="item-sale-price"'), `${label}: missing salePrice input`);
  assert(html.includes('id="item-min-price"'), `${label}: missing minPrice input`);
  assert(html.includes('id="item-purchase-price"'), `${label}: missing purchasePrice input`);
  assert(html.includes('id="item-packaging-cost"'), `${label}: missing packagingCost input`);

  // 6. تكاليف المنصات داخل CompactTable
  assert(html.includes('aria-label="تكاليف استقطاع المرتجع لكل منصة"'), `${label}: platform costs must be inside CompactTable`);

  // 7. الحقول الأساسية والتسعير والمخزون وعروض Rule 4
  for (const fieldId of [
    'item-name-input',
    'item-category-root',
    'item-sku-input',
    'item-unit-select',
    'item-supplier-input',
    'item-status-select',
    'item-notes-input',
    'item-barcode-input',
    'item-secondary-barcode-input',
    'item-tax-rate',
    'item-pickup-fee',
    'item-enable-bnpl',
    'item-stock-qty',
    'item-reorder-limit'
  ]) {
    assert(html.includes(`id="${fieldId}"`), `${label}: missing field id="${fieldId}"`);
  }

  for (const widthClass of ['input-w-name', 'input-w-code', 'input-w-notes', 'input-w-number', 'input-w-date']) {
    assert(html.includes(widthClass), `${label}: missing Rule 4 width class ${widthClass}`);
  }

  // 8. شريط الحفظ والإلغاء
  assert(html.includes('type="submit"'), `${label}: missing submit button`);
  assert(html.includes('حفظ') && html.includes('إلغاء'), `${label}: missing Arabic save/cancel buttons`);
}

// 9. التحقق في وضع التعديل من وجود أقسام السجلات والتصنيف الفرعي والباركودات الإضافية
assert(htmlEdit.includes('سجل تعديلات الصنف'), 'EDIT: change logs section missing');
assert(htmlEdit.includes('حركات المخزون التاريخية'), 'EDIT: stock movements section missing');
assert(htmlEdit.includes('الكمية في كل مخزن'), 'EDIT: warehouse breakdown section missing');

// 10. التحقق من الكود المصدري لحفظ البيانات وبنية onSave وحفظ كل الحقول والملحقات المشروطة
const src = fs.readFileSync('src/pages/ProductFormPage.tsx', 'utf8');
assert(src.includes('id="item-category-sub"'), 'Source must contain sub-category select');
assert(src.includes('id="item-bnpl-pct"'), 'Source must contain bnpl percentage input');
assert(src.includes('ariaLabel="الباركودات الإضافية"'), 'Source must render secondary barcodes inside CompactTable');
assert(src.includes('ariaLabel="الكمية في كل مخزن"'), 'Source must render warehouse breakdown inside CompactTable');
assert(src.includes('ariaLabel="سجل تعديلات الصنف"'), 'Source must render change logs inside CompactTable');
assert(src.includes('ariaLabel="حركات المخزون التاريخية"'), 'Source must render stock movements inside CompactTable');
assert(src.includes('await onSave(finalItem, platformCostsToSave)'), 'Source must keep exact onSave payload call');
assert(src.includes('formEl.scrollHeight > window.innerHeight * 2'), 'Source must keep conditional > 2 screens check for section nav');
for (const payloadKey of [
  'sku:',
  'barcode:',
  'secondaryBarcodes,',
  'name:',
  'categoryId:',
  'categoryName:',
  'unit:',
  'salePrice:',
  'minPrice:',
  'purchasePrice:',
  'packagingCost:',
  'taxRate:',
  'pickupFee:',
  'enableBnpl:',
  'bnplPercentage:',
  'stockQuantity:',
  'reorderLimit:',
  'supplier:',
  'status,',
  'imageUrl:',
  'notes:',
  'platformIds,',
  'editReason:'
]) {
  assert(src.includes(payloadKey), `Source payload missing field binding: ${payloadKey}`);
}

console.log('ALL PRODUCT FORM SINGLE-SURFACE & FIELD-PARITY CHECKS PASSED (NEW + EDIT)');

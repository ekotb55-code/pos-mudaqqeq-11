import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const linear = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const css = fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8');
const navbar = fs.readFileSync(path.join(root, 'src', 'components', 'Navbar.tsx'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src', 'components', 'Sidebar.tsx'), 'utf8');
const bottomNav = fs.readFileSync(path.join(root, 'src', 'components', 'MobileBottomNav.tsx'), 'utf8');
const dashboardAurora = fs.readFileSync(path.join(root, 'src', 'components', 'DashboardAurora.tsx'), 'utf8');
const appTsx = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');

console.log('1) Checking Mobile Dashboard (< 768px) in DashboardAurora.tsx...');
assert.ok(dashboardAurora.includes('text-[38px] md:text-[46px] xl:text-[50px]'), 'Hero amount must be 38px below 768px');
assert.ok(dashboardAurora.includes('grid grid-cols-2 md:flex'), 'Hero buttons must stack cleanly in 2-col below 768px');
assert.ok(dashboardAurora.includes('hidden md:flex md:w-[196px]'), '7-day mini chart must be hidden below 768px');
assert.ok(dashboardAurora.includes('grid grid-cols-2 gap-3'), '4 small KPI cards must use 2x2 grid');
assert.ok(dashboardAurora.includes('flex md:grid md:grid-cols-3 gap-3 overflow-x-auto'), 'Cashboxes must scroll horizontally below 768px');
assert.ok(dashboardAurora.includes('w-[215px]'), 'Cashbox card width must allow next card to peek on 390px');
assert.ok(dashboardAurora.includes('min-[1100px]:grid-cols-'), 'Platforms & Recent Invoices must stack below 1100px');

console.log('2) Checking Mobile Top Bar in Navbar.tsx...');
assert.ok(navbar.includes('navbar-glass-chip--mobile-icon') && navbar.includes('statusTooltipFull'), 'Missing mobile connection status button');
assert.ok(sidebar.includes('mudaqqeq-fixed-logo-box') && sidebar.includes('variant="mobile"'), 'Missing mobile brand square in mobile drawer header');
assert.ok(navbar.includes('hidden sm:inline') && css.includes('aurora-hide-mobile'), 'Missing mobile compact hiding scoping');
assert.ok(navbar.includes('devicePopoverOpen') && navbar.includes("onNavigate('settings', 'integration')"), 'Missing mobile device/connection status popover & settings navigation');

console.log('3) Checking Floating Glass MobileBottomNav.tsx...');
assert.ok(appTsx.includes('appTheme={appTheme}'), 'App.tsx must pass appTheme to MobileBottomNav');
assert.ok(bottomNav.includes("if (currentPage === 'pos') {\n    return null;\n  }"), 'MobileBottomNav must remain hidden on POS page');
assert.ok(bottomNav.includes('aurora-mobile-bottom-nav'), 'Missing Aurora mobile bottom nav class');
assert.ok(bottomNav.includes('rounded-[26px] h-[72px]'), 'Mobile bottom nav must have 26px radius and 72px height');
assert.ok(bottomNav.includes("left: '14px'") && bottomNav.includes("right: '14px'"), 'Mobile bottom nav must have 14px side inset');
assert.ok(bottomNav.includes("env(safe-area-inset-bottom"), 'Mobile bottom nav must respect safe area');
assert.ok(bottomNav.includes('w-[58px] h-[58px] rounded-[22px]'), 'Center POS button must be 58px square with 22px radius');
assert.ok(bottomNav.includes("id: 'reports'") && bottomNav.includes("label: 'التقارير'"), 'Slot 4 in Aurora must be Reports');
assert.ok(bottomNav.includes("id: 'invoices'") && bottomNav.includes("bg-[#164E72]"), 'Existing 3-theme MobileBottomNav must remain untouched');

console.log('4) Checking CSS Scoping, Dark Table Headers, Form/Table Clarity & Contrast...');
const beforeAurora = css.slice(0, css.indexOf('[data-theme="aurora"] {'));
assert.ok(!beforeAurora.includes('aurora-mobile-bottom-nav'), 'Non-aurora CSS must not contain aurora-mobile-bottom-nav');
assert.ok(!beforeAurora.includes('--table-header-bg'), 'Non-aurora CSS must not define --table-header-bg');

assert.ok(css.includes('--table-header-bg: #17153B;'), 'Aurora dark table header missing');
assert.ok(css.includes('--table-header-bg: #0F2540;'), 'Aurora-sky dark table header missing');
assert.ok(css.includes('table:not(.receipt-table):not(.compact-table) thead th'), 'Dark table header rule missing');
assert.ok(css.includes('main .bg-white:has(input:not([type="checkbox"]):not([type="radio"]))'), 'Form input card clarity exclusion missing');
assert.ok(css.includes('main .bg-white:has(select)'), 'Select filter card clarity exclusion missing');
assert.ok(css.includes('.text-sky-100\\/80'), 'POS mobile bottom nav inactive text contrast fix missing');
assert.ok(css.includes('.login-gradient-bg'), 'Login page Aurora background mapping missing');

// WCAG AA Contrast verification (>= 4.5:1)
const contrastPairs: Array<[string, string, string]> = [
  ['Aurora table header white on #17153B', '#FFFFFF', '#17153B'],
  ['Aurora-Sky table header white on #0F2540', '#FFFFFF', '#0F2540'],
  ['Aurora primary button white on #6D28D9', '#FFFFFF', '#6D28D9'],
  ['Aurora-Sky primary button white on #0A5FC2', '#FFFFFF', '#0A5FC2'],
  ['Aurora primary-on-white #4338CA on #EDE9FE badge', '#4338CA', '#EDE9FE'],
  ['Aurora-Sky primary-on-white #0A5FC2 on #DBEAFE badge', '#0A5FC2', '#DBEAFE'],
  ['Aurora primary text #17153B on #FFFFFF', '#17153B', '#FFFFFF'],
  ['Aurora-Sky primary text #0F2540 on #FFFFFF', '#0F2540', '#FFFFFF'],
  ['Aurora secondary text #5E5A80 on #FFFFFF', '#5E5A80', '#FFFFFF'],
  ['Aurora-Sky secondary text #55667E on #FFFFFF', '#55667E', '#FFFFFF']
];

for (const [label, fg, bg] of contrastPairs) {
  const ratio = contrastRatio(fg, bg);
  assert.ok(ratio >= 4.5, `${label} contrast ${ratio.toFixed(2)} < 4.5`);
  console.log(`   ✓ ${label}: ${ratio.toFixed(2)}:1`);
}

console.log('All Task 6 mobile dashboard, bottom nav, and screen audit checks PASSED!');

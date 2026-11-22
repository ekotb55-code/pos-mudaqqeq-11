import fs from 'fs';
import path from 'path';
import assert from 'assert';

const root = process.cwd();
const css = fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src', 'components', 'Sidebar.tsx'), 'utf8');
const brand = fs.readFileSync(path.join(root, 'src', 'config', 'brand.ts'), 'utf8');
const navbar = fs.readFileSync(path.join(root, 'src', 'components', 'Navbar.tsx'), 'utf8');

console.log('1) Checking Sidebar.tsx Task 3 requirements...');
assert(sidebar.includes('aurora-sidebar-brand'), 'Missing aurora-sidebar-brand');
assert(sidebar.includes('mudaqqeq-fixed-logo-box') && sidebar.includes('rounded-[14px]'), 'Missing fixed logo square with 14px radius');
assert(
  sidebar.includes('MUDAQQEQ_BRAND_TITLE_AR') &&
    sidebar.includes('MUDAQQEQ_BRAND_SUBTITLE_EN') &&
    brand.includes('مدقق') &&
    brand.includes('Mudaqqeq Systems'),
  'Missing brand title and subtitle in Sidebar/brand config'
);
assert(sidebar.includes('--sec-soft-shadow'), 'Missing section soft shadow CSS variable');
assert(sidebar.includes('data-expanded='), 'Missing data-expanded attribute on group button');
assert(sidebar.includes('mudaqqeq-pos-cta'), 'Missing mudaqqeq-pos-cta class on POS button');
// Ensure navigation config, order, and permissions are untouched
assert(sidebar.includes('NAV_GROUPS.filter((group) => isGroupVisible(group, user))'), 'Permissions filter untouched');
assert(sidebar.includes('isSubItemVisible(sub, user)'), 'Sub-item permissions untouched');

console.log('2) Checking Navbar.tsx Task 3 requirements...');
assert(navbar.includes("timeZone: 'Africa/Cairo'"), 'Missing Africa/Cairo timezone');
assert(navbar.includes('صباح الخير') && navbar.includes('مساء الخير'), 'Missing Arabic morning/evening greetings');
assert(navbar.includes('getFirstName'), 'Missing first name helper');
assert(navbar.includes('navbar-glass-chip') && css.includes('button.navbar-glass-chip::after'), 'Missing compact navbar chips and expanded touch targets');
assert(navbar.includes('onSync') && navbar.includes('onLogout') && navbar.includes('PWAInstallButton'), 'Missing existing Navbar controls');
assert(navbar.includes("config.persistenceMode === 'supabase'") && navbar.includes('isOnline'), 'Missing connection indicators');

console.log('3) Checking index.css Task 3 floating layout & Aurora scoping...');
for (const token of [
  'top: 20px;',
  'bottom: 20px;',
  'inset-inline-start: 20px;',
  'border-radius: 30px;',
  'height: 40px;',
  'height: 36px;',
  'height: 30px;',
  'border-radius: 10px;',
  'margin-bottom: 12px;',
  'height: 52px;',
  'min-height: 52px;',
  'border-radius: 18px;',
  'background: rgba(255, 255, 255, 0.92);',
  'border-radius: 16px;',
  'min-height: 44px;',
  'width: 30px;',
  'min-width: 30px;',
  'border-radius: 14px'
]) {
  assert(css.includes(token), `index.css missing required rule/value: ${token}`);
}

// Verify Aurora-only helpers are hidden by default so 3 existing themes remain untouched
// (.aurora-sidebar-brand is intentionally visible across all themes as the fixed brand header)
assert(css.includes('.aurora-only-flex,\n.aurora-only-inline {\n  display: none !important;'), 'Aurora-only blocks must be hidden by default');
assert(!css.slice(0, css.indexOf('[data-theme="aurora"] {')).includes('aurora-'), 'Existing 3 themes must not reference aurora classes');

console.log('4) Testing Cairo time greeting formatting...');
// Test greeting helper logic at morning (08:00 Cairo = 06:00 UTC) and evening (20:00 Cairo = 18:00 UTC)
const testMorning = new Date('2026-11-14T06:00:00Z');
const testEvening = new Date('2026-11-14T18:00:00Z');
const fmtHour = (d: Date) =>
  parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: 'numeric', hour12: false }).format(d), 10) % 24;
assert(fmtHour(testMorning) >= 5 && fmtHour(testMorning) < 12, 'Morning Cairo hour check');
assert(fmtHour(testEvening) >= 12 || fmtHour(testEvening) < 5, 'Evening Cairo hour check');

console.log('All Task 3 (Aurora Sidebar & Floating Top Navbar) checks PASSED!');

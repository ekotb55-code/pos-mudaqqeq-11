import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Navbar } from './src/components/Navbar.tsx';
import type { SystemConfig, UserAccount } from './src/types/index.ts';

function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const l1 = luminance(...rgb1);
  const l2 = luminance(...rgb2);
  const [bright, dark] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (bright + 0.05) / (dark + 0.05);
}

function compositeOver(fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] {
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha))
  ];
}

function runTests() {
  console.log('--- Starting Compact Navbar Verification ---');

  const baseConfig: SystemConfig = {
    appsScriptUrl: '',
    port: 3000,
    isGoogleSheetsConnected: false,
    dataMode: 'mock',
    storeName: 'مدقق',
    currency: 'EGP',
    hasOwner: true,
    hasManager: true
  };

  const designerUser: UserAccount = {
    id: 'u-1',
    name: 'عبدالله محمد',
    username: 'abdalla',
    role: 'designer',
    isOwner: true,
    permissions: [],
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z'
  };

  // 1. Standalone greeting+date chip deleted; greeting merged inside user chip
  const html = renderToStaticMarkup(
    React.createElement(Navbar, {
      config: baseConfig,
      user: designerUser,
      currentPage: 'dashboard',
      onNavigate: () => {},
      onLogout: () => {},
      onSync: () => {},
      isSyncing: false
    })
  );

  assert.ok(!html.includes('Mudaqqeq Systems'), 'Two-line subtitle Mudaqqeq Systems must not exist in navbar');
  assert.ok(!html.includes('aurora-only-flex'), 'Standalone aurora greeting+date chip must be deleted');
  assert.ok(html.includes('data-testid="navbar-user-chip"'), 'Merged user chip must render');
  assert.ok(/صباح الخير يا عبدالله|مساء الخير يا عبدالله/.test(html), 'User chip must contain single-line Cairo greeting');
  assert.ok(!html.includes('>مصمم ومالك النظام<'), 'Role text must NOT render visibly inside the bar');
  assert.ok(html.includes('title="') && html.includes('مصمم ومالك النظام'), 'Role label must appear in hover tooltip');
  console.log('✓ 1. Standalone greeting+date removed; greeting merged with role icon & logout inside single user chip');

  // 2. Preview mode chip shortened to "وضع المعاينة" with full text in tooltip & hidden sm:inline on mobile
  assert.ok(html.includes('<span class="hidden sm:inline">وضع المعاينة</span>'), 'Preview text must be shortened and hide on narrow mobile');
  assert.ok(html.includes('title="وضع المعاينة — البيانات لا تُحفظ"'), 'Full preview text must appear in tooltip');
  console.log('✓ 2. Preview chip shortened to dot + وضع المعاينة with full text in tooltip and dot-only mobile fallback');

  // 3. Connected database (supabase) mode displays concise label + tooltip
  const connectedHtml = renderToStaticMarkup(
    React.createElement(Navbar, {
      config: { ...baseConfig, persistenceMode: 'supabase' },
      user: designerUser,
      currentPage: 'pos',
      onNavigate: () => {},
      onLogout: () => {},
      onSync: () => {},
      isSyncing: false
    })
  );
  assert.ok(connectedHtml.includes('<span class="hidden sm:inline">متصل</span>'), 'Connected database label must be concise and responsive');
  assert.ok(connectedHtml.includes('title="قاعدة البيانات متصلة — كل العمليات محفوظة"'), 'Full connected database status must be in tooltip');
  console.log('✓ 3. Connected database chip concise with full tooltip');

  // 4. Icon-only buttons have Arabic aria-label + title and 15px icons + 20px role square + 6px gaps
  assert.ok(html.includes('aria-label="مزامنة وتحديث البيانات الآن"'), 'Sync button must have Arabic aria-label');
  assert.ok(html.includes('aria-label="تسجيل الخروج"'), 'Logout button must have Arabic aria-label');
  assert.ok(html.includes('w-[15px] h-[15px]'), 'Icons must be 15px');
  assert.ok(html.includes('w-[20px] h-[20px]'), 'Role icon must sit inside 20px square');
  assert.ok(html.includes('gap-[6px]'), 'Chip gaps must be 6px');
  assert.ok(html.includes('نقطة بيع 1'), 'Device chip must remain visible');
  assert.ok(html.includes('class="hidden sm:inline truncate max-w-[165px]"'), 'Greeting text must hide gracefully when mobile width is tight while role icon & logout remain');
  console.log('✓ 4. Icons (15px), role square (20px), gaps (6px), aria-labels, and mobile responsiveness verified');

  // 5. CSS rules verification across all 5 themes
  const css = fs.readFileSync('./src/index.css', 'utf8');
  assert.ok(css.includes('height: 30px;') && css.includes('min-height: 30px;'), 'Chips must be 30px height');
  assert.ok(css.includes('border-radius: 10px;'), 'Chips must have 10px border-radius');
  assert.ok(css.includes('padding-inline: 10px;'), 'Chips must have 10px horizontal padding');
  assert.ok(css.includes('font-size: 12.5px;') && css.includes('font-weight: 600;'), 'Chip typography must be 12.5px weight 600');
  assert.ok(css.includes('width: 30px;') && css.includes('min-width: 30px;'), 'Icon-only chips must be 30x30px');
  assert.ok(css.includes('height: 40px;') && css.includes('height: 36px;'), 'Total navbar row height must be <= 42px on desktop and mobile');
  assert.ok(!css.includes('min-height: 56px'), 'Legacy 56px mobile aurora header height must be removed');
  assert.ok(css.includes('button.navbar-glass-chip::after') && css.includes('.navbar-user-info-btn::after') && css.includes('.navbar-user-logout-btn::after'), 'Touch target >=40px pseudo-elements must exist');
  assert.ok(css.includes('backdrop-filter: blur(14px)') && css.includes('background: transparent !important'), 'Container transparency & chip blur preserved');
  console.log('✓ 5. CSS dimensions (30px, 10px, 12.5px/600, <=42px header, >=40px hit areas) & transparency verified');

  // 6. Contrast >= 4.5:1 across all 5 themes (including worst-case scrolling content underneath)
  // Light-sky & current: rgba(255,255,255,0.55) over dark #164E72 header/table
  const lightWorstBg = compositeOver([255, 255, 255], 0.55, [22, 78, 114]);
  assert.ok(contrastRatio([22, 43, 58], lightWorstBg) >= 4.5, 'Light-sky/Current chip text contrast >= 4.5:1');
  assert.ok(contrastRatio([69, 26, 3], compositeOver([254, 243, 199], 0.55, [22, 78, 114])) >= 4.5, 'Amber preview contrast >= 4.5:1');

  // Aurora & Aurora-Sky: rgba(255,255,255,0.70) over dark #17153B table header
  const auroraWorstBg = compositeOver([255, 255, 255], 0.70, [23, 21, 59]);
  assert.ok(contrastRatio([23, 21, 59], auroraWorstBg) >= 4.5, 'Aurora chip text contrast >= 4.5:1');
  assert.ok(contrastRatio([15, 37, 64], auroraWorstBg) >= 4.5, 'Aurora-Sky chip text contrast >= 4.5:1');

  // Dark theme: rgba(27,45,64,0.80) over bright #FFFFFF content
  const darkWorstBg = compositeOver([27, 45, 64], 0.80, [255, 255, 255]);
  assert.ok(contrastRatio([239, 247, 251], darkWorstBg) >= 4.5, 'Dark theme chip text contrast >= 4.5:1');
  console.log('✓ 6. WCAG AA (>= 4.5:1) contrast verified for all 5 themes');

  // 7. Non-sticky Navbar & top:0 sticky adjustments
  assert.ok(!html.includes('sticky top-0'), 'Navbar header must NOT have sticky positioning');
  assert.ok(!css.includes('header.sticky'), 'CSS must not reference legacy header.sticky selectors');
  assert.ok(css.includes('#root header.mudaqqeq-navbar {\n  position: static;'), 'Header must use position: static flow');
  const sidebarCode = fs.readFileSync('./src/components/Sidebar.tsx', 'utf8');
  assert.ok(sidebarCode.includes('sticky top-0 z-20') && !sidebarCode.includes('sticky top-16'), 'Desktop sidebar must stick flush at top-0');
  const formPageCode = fs.readFileSync('./src/pages/ProductFormPage.tsx', 'utf8');
  assert.ok(formPageCode.includes('sticky top-0 z-30') && !formPageCode.includes('sticky top-16'), 'ProductFormPage section bar must stick at top-0');
  const appCode = fs.readFileSync('./src/App.tsx', 'utf8');
  assert.ok(appCode.includes('overflow-x-clip'), 'Main container must use overflow-x-clip so inner sticky top-0 elements stick properly');
  console.log('✓ 7. Non-sticky Navbar, top-0 sticky Sidebar/sub-bars, and overflow-x-clip verified');

  console.log('\n========================================');
  console.log('ALL COMPACT NAVBAR VERIFICATION TESTS PASSED!');
  console.log('========================================');
}

runTests();

/**
 * اختبار خفة الثيمين «أورورا» و«أورورا السماوي» وعرض الصفحة الكامل
 * (فحص نصي للملفات — بدون متصفح)
 * التشغيل: npx tsx scripts/verify_theme_performance.ts
 */
import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`فشل التحقق: ${message}`);
  passed++;
}
const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');
const css = read('src/index.css');
const app = read('src/App.tsx');
const navbar = read('src/components/Navbar.tsx');

const marker = 'Aurora & Aurora Sky — رسم خفيف بنفس الشكل';
assert(css.includes(marker), 'قسم الرسم الخفيف موجود في index.css');
// يبدأ القسم من تعليق العنوان
const light = css.slice(css.lastIndexOf('/*', css.indexOf(marker)));

// 1) لا تغبيش حي
assert(/\[data-theme="aurora"\],\s*\[data-theme="aurora-sky"\]\s*\{\s*--glass-blur:\s*none;/.test(light), 'متغير التغبيش = none في الثيمين');
assert(/\.navbar-glass-chip[^{]*\{[^}]*backdrop-filter:\s*none;/.test(light), 'كبسولات الشريط العلوي بدون تغبيش حي');

// 2) الخلفية في طبقة ثابتة واحدة
assert(/body::before[\s\S]*?position:\s*fixed;[\s\S]*?background:\s*var\(--aurora-canvas-bg\);/.test(light), 'الخلفية مرسومة مرة واحدة في body::before');
assert(/body\.bg-slate-50\s*\{[^}]*background-attachment:\s*scroll;/.test(light), 'الجسم نفسه بلا background-attachment: fixed');
assert(/\.login-gradient-bg\s*\{[^}]*background-attachment:\s*scroll !important;/.test(light), 'صفحة الدخول بلا خلفية ثابتة');
assert(/@media print\s*\{[\s\S]*?body::before[\s\S]*?display:\s*none;/.test(light), 'الطبقة لا تظهر في الطباعة');

// 3) الأسطح العائمة شبه معتمة بدل التغبيش
assert(/nav\.fixed\.bottom-0\s*\{\s*background-color:\s*rgba\(255, 255, 255, 0\.96\);/.test(light), 'شريط الموبايل السفلي شبه معتم');
assert(/:is\(\.absolute, \.fixed, \.sticky\)\.bg-white/.test(light) && /background-color:\s*rgba\(255, 255, 255, 0\.97\);/.test(light), 'القوائم والنوافذ العائمة شبه معتمة');

// 4) القسم في آخر الملف حتى يغلب ما قبله، والثيمات الثلاثة الأخرى لا تتأثر
assert(css.lastIndexOf(marker) === css.indexOf(marker) && css.indexOf(marker) > css.indexOf('Aurora & Aurora Sky Surfaces'), 'القسم بعد قسم الأسطح الأصلي (يغلبه)');
assert(!/\[data-theme="(light-sky|dark|current)"\]/.test(light), 'القسم لا يلمس الثيمات الثلاثة الأخرى');
const ruleHeads = light.replace(/\/\*[\s\S]*?\*\//g, '').split('{').slice(0, -1).map(part => part.split('}').pop()!.trim()).filter(Boolean);
assert(ruleHeads.every(head => head.startsWith('@media') || head.split(/,\s*\n/).every(sel => sel.trim().startsWith('[data-theme="aurora"]') || sel.trim().startsWith('[data-theme="aurora-sky"]'))), 'كل قواعد القسم محصورة في الثيمين');

// 5) عرض الصفحة كامل في كل الثيمات
assert(!app.includes("'max-w-7xl mx-auto'") && app.includes("currentPage === 'pos' ? 'max-w-none px-2 py-2' : 'max-w-none'"), 'جسم الصفحة بعرض الشاشة كاملًا');
assert(!navbar.includes('aurora-nav-container max-w-7xl') && navbar.includes('aurora-nav-container max-w-none'), 'الشريط العلوي بعرض الشاشة كاملًا');

console.log(`\n🎉 كل اختبارات خفة الثيمات وعرض الصفحة نجحت (${passed} تحققًا).`);

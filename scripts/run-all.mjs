/**
 * تشغيل كل اختبارات المشروع مرة واحدة مع ملخص واضح — POS مدقق
 * التشغيل:  npm run test:all   (أو: node scripts/run-all.mjs)
 * يشغّل كل ملفات scripts/*.ts وملفات test_*.ts في جذر المشروع واحدًا بعد الآخر،
 * ويطبع لكل ملف «نجح / فشل» ثم ملخصًا في النهاية. يخرج بالكود 1 لو فشل أي ملف.
 * تشغيل ملفات محددة فقط:  node scripts/run-all.mjs manual_balance backup
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 240_000;
const filters = process.argv.slice(2);

const files = [
  ...readdirSync(path.join(root, 'scripts')).filter(f => f.endsWith('.ts')).sort().map(f => path.join('scripts', f)),
  ...readdirSync(root).filter(f => /^test_.*\.ts$/.test(f)).sort()
].filter(f => filters.length === 0 || filters.some(x => f.includes(x)));

if (files.length === 0) {
  console.error('لا توجد ملفات اختبار مطابقة.');
  process.exit(1);
}

const tsx = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const failed = [];
const startedAll = Date.now();

for (const file of files) {
  const started = Date.now();
  const run = spawnSync(tsx, [file], { cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS, env: process.env });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const timedOut = run.error && run.error.code === 'ETIMEDOUT';
  const ok = !run.error && run.status === 0;
  if (ok) {
    console.log(`✅ نجح  ${file}  (${seconds} ث)`);
    continue;
  }
  const output = `${run.stdout || ''}\n${run.stderr || ''}`.split('\n').map(line => line.trimEnd()).filter(Boolean);
  const reason = timedOut
    ? `تجاوز المهلة (${TIMEOUT_MS / 1000} ثانية)`
    : output.find(line => /فشل|FAIL|Error|❌/.test(line)) || output[output.length - 1] || run.error?.message || 'خرج بكود غير صفري';
  failed.push({ file, reason: reason.slice(0, 220) });
  console.log(`❌ فشل  ${file}  (${seconds} ث)`);
  console.log(`      ${reason.slice(0, 220)}`);
}

const total = ((Date.now() - startedAll) / 1000).toFixed(0);
console.log('\n================ الملخص ================');
console.log(`الملفات: ${files.length} — نجح: ${files.length - failed.length} — فشل: ${failed.length} — الوقت: ${total} ثانية`);
if (failed.length > 0) {
  console.log('\nالملفات الفاشلة:');
  for (const item of failed) console.log(`- ${item.file}\n    ${item.reason}`);
  process.exit(1);
}
console.log('🎉 كل اختبارات المشروع نجحت.');

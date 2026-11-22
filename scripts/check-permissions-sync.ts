import fs from 'fs';
import path from 'path';
import { ALL_PERMISSIONS, ROLE_TEMPLATES } from '../src/utils/permissions';

const codeGsPath = path.resolve(process.cwd(), 'apps-script/Code.gs');
const codeGsContent = fs.readFileSync(codeGsPath, 'utf-8');

function extractStringArray(source: string, blockRegex: RegExp): string[] {
  const match = source.match(blockRegex);
  if (!match || !match[1]) {
    throw new Error(`Could not extract block matching ${blockRegex}`);
  }
  const items: string[] = [];
  const strRegex = /'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = strRegex.exec(match[1])) !== null) {
    items.push(m[1]);
  }
  return items;
}

const tsAllPermissions = ALL_PERMISSIONS.map((p) => p.key);
const gsAllPermissions = extractStringArray(
  codeGsContent,
  /var\s+ALL_PERMISSIONS\s*=\s*\[([\s\S]*?)\];/
);

const roleTemplatesBlockMatch = codeGsContent.match(
  /var\s+ROLE_TEMPLATES\s*=\s*\{([\s\S]*?)\n\};/
);
if (!roleTemplatesBlockMatch) {
  throw new Error('Could not find ROLE_TEMPLATES in apps-script/Code.gs');
}
const roleTemplatesBlock = roleTemplatesBlockMatch[1];

const gsManagerPermissions = extractStringArray(
  roleTemplatesBlock,
  /manager\s*:\s*\[([\s\S]*?)\]/
);
const gsEmployeePermissions = extractStringArray(
  roleTemplatesBlock,
  /employee\s*:\s*\[([\s\S]*?)\]/
);

function diffArrays(label: string, tsArr: string[], gsArr: string[]) {
  const missingInGs = tsArr.filter((k) => !gsArr.includes(k));
  const extraInGs = gsArr.filter((k) => !tsArr.includes(k));
  const orderMismatch =
    missingInGs.length === 0 &&
    extraInGs.length === 0 &&
    tsArr.some((k, idx) => gsArr[idx] !== k);

  console.log(`\n=== ${label} ===`);
  console.log(`permissions.ts count: ${tsArr.length} | Code.gs count: ${gsArr.length}`);
  console.log(`Missing in Code.gs: ${missingInGs.length === 0 ? 'None (0)' : missingInGs.join(', ')}`);
  console.log(`Extra in Code.gs:   ${extraInGs.length === 0 ? 'None (0)' : extraInGs.join(', ')}`);
  console.log(`Exact order match:  ${!orderMismatch ? 'YES' : 'NO'}`);

  return missingInGs.length === 0 && extraInGs.length === 0 && !orderMismatch;
}

const okAll = diffArrays('ALL_PERMISSIONS', tsAllPermissions, gsAllPermissions);
const okManager = diffArrays('ROLE_TEMPLATES.manager', ROLE_TEMPLATES.manager, gsManagerPermissions);
const okEmployee = diffArrays('ROLE_TEMPLATES.employee', ROLE_TEMPLATES.employee, gsEmployeePermissions);

if (okAll && okManager && okEmployee) {
  console.log('\n✅ SUCCESS: All permissions and role templates in src/utils/permissions.ts and apps-script/Code.gs are 100% synchronized!');
  process.exit(0);
} else {
  console.error('\n❌ ERROR: Permissions mismatch detected!');
  process.exit(1);
}

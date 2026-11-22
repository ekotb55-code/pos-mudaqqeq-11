import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { VALID_APP_THEMES, isValidAppTheme, type PermissionKey } from '../src/types/index.ts';
import { getCompanySettings, saveCompanySettings } from '../server/sheetsService.ts';

function assert(cond: unknown, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

const designerSession = {
  role: 'designer' as const,
  permissions: ['settings.company_appearance'] as PermissionKey[]
};

async function verifyThemes() {
  console.log('--- Verifying 5 Themes Registration, CSS Tokens, Server & Code.gs Validation ---');

  // 1) Types & Helpers
  assert(
    JSON.stringify(VALID_APP_THEMES) === JSON.stringify(['light-sky', 'dark', 'current', 'aurora', 'aurora-sky']),
    `Unexpected VALID_APP_THEMES: ${JSON.stringify(VALID_APP_THEMES)}`
  );
  for (const t of VALID_APP_THEMES) {
    assert(isValidAppTheme(t), `isValidAppTheme("${t}") should be true`);
  }
  assert(!isValidAppTheme('unknown-theme'), 'Invalid theme ID must return false');

  // 2) CSS variables check
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
  for (const t of VALID_APP_THEMES) {
    assert(css.includes(`[data-theme="${t}"]`), `Missing CSS block [data-theme="${t}"]`);
  }
  // Aurora exact tokens
  const auroraBlock = css.slice(css.indexOf('[data-theme="aurora"]'), css.indexOf('[data-theme="aurora-sky"]'));
  assert(auroraBlock.includes('--app-bg: #F1EFFB;'), 'Aurora --app-bg mismatch');
  assert(auroraBlock.includes('--primary: #6D28D9;'), 'Aurora --primary mismatch');
  assert(auroraBlock.includes('--primary-on-white: #4338CA;'), 'Aurora --primary-on-white mismatch');
  assert(
    auroraBlock.includes('linear-gradient(118deg, #4338CA 0%, #7C3AED 46%, #DB2777 100%)'),
    'Aurora --brand-gradient mismatch'
  );
  assert(auroraBlock.includes('--text-primary: #17153B;'), 'Aurora --text-primary mismatch');
  assert(auroraBlock.includes('--text-secondary: #5E5A80;'), 'Aurora --text-secondary mismatch');
  assert(auroraBlock.includes('--border-color: rgba(23, 21, 59, 0.08);'), 'Aurora --border-color mismatch');
  assert(auroraBlock.includes('--surface: #FFFFFF;'), 'Aurora --surface mismatch');
  assert(auroraBlock.includes('--success: #15803D;'), 'Aurora --success mismatch');
  assert(auroraBlock.includes('--danger: #B42318;'), 'Aurora --danger mismatch');
  assert(auroraBlock.includes('--warning: #B45309;'), 'Aurora --warning mismatch');
  assert(auroraBlock.includes('--radius-card: 28px;'), 'Aurora --radius-card mismatch');
  assert(auroraBlock.includes('--radius-sm: 16px;'), 'Aurora --radius-sm mismatch');

  // Aurora Sky exact tokens
  const skyStart = css.indexOf('[data-theme="aurora-sky"]');
  const skyBlock = css.slice(skyStart, css.indexOf('body {', skyStart));
  assert(skyBlock.includes('--app-bg: #EEF5FD;'), 'Aurora Sky --app-bg mismatch');
  assert(skyBlock.includes('--primary: #0A5FC2;'), 'Aurora Sky --primary mismatch');
  assert(
    skyBlock.includes('linear-gradient(118deg, #0A5FC2 0%, #1687E0 50%, #35C1F1 100%)'),
    'Aurora Sky --brand-gradient mismatch'
  );
  assert(skyBlock.includes('--text-primary: #0F2540;'), 'Aurora Sky --text-primary mismatch');
  assert(skyBlock.includes('--text-secondary: #55667E;'), 'Aurora Sky --text-secondary mismatch');
  assert(skyBlock.includes('--border-color: rgba(15, 37, 64, 0.08);'), 'Aurora Sky --border-color mismatch');
  assert(skyBlock.includes('--surface: #FFFFFF;'), 'Aurora Sky --surface mismatch');
  assert(skyBlock.includes('--success: #15803D;'), 'Aurora Sky --success mismatch');
  assert(skyBlock.includes('--danger: #B42318;'), 'Aurora Sky --danger mismatch');
  assert(skyBlock.includes('--warning: #B45309;'), 'Aurora Sky --warning mismatch');
  assert(skyBlock.includes('--radius-card: 28px;'), 'Aurora Sky --radius-card mismatch');
  assert(skyBlock.includes('--radius-sm: 16px;'), 'Aurora Sky --radius-sm mismatch');

  // 3) index.html bootstrap check
  const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  assert(html.includes("'aurora'") && html.includes("'aurora-sky'"), 'index.html bootstrap must allow aurora and aurora-sky');

  // 4) Switch & save all 5 themes in server/sheetsService.ts + reject invalid theme
  const originalSettings = getCompanySettings();
  try {
    for (const themeId of VALID_APP_THEMES) {
      const saveRes = await saveCompanySettings({ appTheme: themeId }, designerSession);
      assert(saveRes.success, `Failed saving theme "${themeId}": ${(saveRes as any).error}`);
      const loaded = getCompanySettings();
      assert(loaded.appTheme === themeId, `Expected persisted theme "${themeId}", got "${loaded.appTheme}"`);
    }

    const invalidRes = await saveCompanySettings({ appTheme: 'bad-theme' as any }, designerSession);
    assert(invalidRes.success === false && (invalidRes as any).statusCode === 400, 'Invalid theme must be rejected with 400');
  } finally {
    await saveCompanySettings(originalSettings, designerSession);
  }

  // 5) Validate Code.gs saveSettingsProtected theme validation in VM sandbox
  const code = fs.readFileSync(path.resolve(process.cwd(), 'apps-script/Code.gs'), 'utf8');
  let storedCompanySettingsJson = JSON.stringify({ storeName: 'Test Store' });
  const fakeRows = [
    ['key', 'value', 'updatedAt'],
    ['companySettings', storedCompanySettingsJson, '2026-01-01T00:00:00Z']
  ];
  const fakeSheet = {
    getDataRange: () => ({ getValues: () => fakeRows.map(r => [...r]) }),
    getRange: (r: number, c: number) => ({
      setValue: (v: string) => {
        fakeRows[r - 1][c - 1] = v;
      }
    }),
    appendRow: (row: any[]) => fakeRows.push(row)
  };
  const sandbox: any = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: () => fakeSheet
      })
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => true,
        releaseLock: () => {}
      })
    },
    Logger: {
      log: () => {}
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null,
        setProperty: () => {}
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt: string) => ({
        setMimeType: () => ({ getContent: () => txt, content: txt })
      })
    },
    SHEETS: { SETTINGS: 'Settings' },
    Utilities: { getUuid: () => 'test-uuid-0001' },
    console,
    JSON,
    Math,
    Object,
    String,
    Number,
    Boolean,
    Array,
    RegExp,
    Date,
    Error,
    ReferenceError,
    TypeError,
    SyntaxError
  };
  vm.createContext(sandbox);
  new vm.Script(code, { filename: 'apps-script/Code.gs' }).runInContext(sandbox);

  const gsSession = { role: 'designer', isOwner: true, permissions: ['settings.company_appearance'] };
  for (const themeId of VALID_APP_THEMES) {
    sandbox.saveSettingsProtected({ companySettings: { appTheme: themeId } }, gsSession);
    const parsed = JSON.parse(fakeRows[1][1]);
    assert(parsed.appTheme === themeId, `Code.gs failed persisting "${themeId}"`);
  }

  let gsRejectedInvalid = false;
  try {
    sandbox.saveSettingsProtected({ companySettings: { appTheme: 'unknown-theme' } }, gsSession);
  } catch (err: any) {
    gsRejectedInvalid = String(err.message).includes('غير صالحة');
  }
  assert(gsRejectedInvalid, 'Code.gs saveSettingsProtected MUST reject invalid appTheme with Arabic error');

  console.log('✅ All 5 themes verified across types, CSS tokens, index.html, sheetsService, and Code.gs!');
}

verifyThemes().catch(err => {
  console.error(err);
  process.exit(1);
});

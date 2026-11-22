/**
 * إعدادات طابعة الباركود (التكت) على السيرفر — POS مدقق
 * ---------------------------------------------------------------------------
 * الإعدادات على النسخة كلها بصلاحية settings.label_print، وتُقرأ لمن يطبع التكت (items.print_labels).
 * الرسم والترتيب نفسه في src/utils/labelPrint.ts (مشترك مع الواجهة).
 * الملف يستخدم صياغة TypeScript القابلة للإزالة فقط (بدون enum وبدون parameter properties).
 */
import type { CollectionDef } from './persistence/statePersistence.ts';
import { defaultLabelSettings, normalizeLabelSettings, validateLabelSettings, type LabelSettings } from '../src/utils/labelPrint.ts';

export class LabelSettingsError extends Error {
  code: 'INVALID_INPUT';
  constructor(message: string) {
    super(message);
    this.name = 'LabelSettingsError';
    this.code = 'INVALID_INPUT';
  }
}

let settings: LabelSettings = defaultLabelSettings();

export function getLabelSettings(): LabelSettings {
  return JSON.parse(JSON.stringify(settings));
}

export function saveLabelSettings(input: unknown, by: string, now: Date = new Date()): LabelSettings {
  const merged = input && typeof input === 'object' ? { ...settings, ...(input as any) } : input;
  const errors = validateLabelSettings(merged);
  if (errors.length > 0) throw new LabelSettingsError(errors.join('، '));
  settings = normalizeLabelSettings({ ...(merged as any), updatedAt: now.toISOString(), updatedBy: String(by || '').slice(0, 80) });
  return getLabelSettings();
}

export function getLabelSettingsCollection(): CollectionDef {
  return {
    name: 'settings.labelPrint',
    kind: 'single',
    get: () => settings,
    set: value => {
      settings = normalizeLabelSettings(value);
    }
  };
}

/** مع «إعادة ضبط المصنع» */
export function resetLabelSettings(): void {
  settings = defaultLabelSettings();
}

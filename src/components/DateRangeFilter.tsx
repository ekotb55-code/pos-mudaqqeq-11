import React, { useEffect, useState, useMemo } from 'react';
import { Calendar, X, AlertCircle } from 'lucide-react';
import {
  DatePresetKey,
  DateRange,
  getDateRangeForPreset,
} from '../utils/dateUtils';
import { FORM_CONTROL_BASE_CLASS, INPUT_WIDTH_CLASSES } from './ui/formWidths';

export interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  storageKey?: string;
  defaultPreset?: DatePresetKey;
  className?: string;
  showPresets?: boolean;
  inline?: boolean;
}

interface PresetOption {
  key: DatePresetKey;
  label: string;
}

const PRESETS: PresetOption[] = [
  { key: 'TODAY', label: 'اليوم' },
  { key: 'YESTERDAY', label: 'أمس' },
  { key: 'LAST_7_DAYS', label: 'آخر 7 أيام' },
  { key: 'THIS_MONTH', label: 'هذا الشهر' },
  { key: 'LAST_MONTH', label: 'الشهر الماضي' },
  { key: 'THIS_YEAR', label: 'هذه السنة' },
  { key: 'ALL', label: 'الكل' },
];

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  value,
  onChange,
  storageKey,
  defaultPreset = 'THIS_MONTH',
  className = '',
  showPresets = true,
  inline = false,
}) => {
  // Local input state to allow smooth typing/picking
  const [fromInput, setFromInput] = useState<string>(value.from || '');
  const [toInput, setToInput] = useState<string>(value.to || '');

  // Keep internal inputs in sync if external value changes (e.g. initial load or parent reset)
  useEffect(() => {
    setFromInput(value.from || '');
    setToInput(value.to || '');
  }, [value.from, value.to]);

  // Load from localStorage on initial mount if available and no initial value was set
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(`date_filter_${storageKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.from !== undefined || parsed.to !== undefined)) {
          // If valid range
          if (!parsed.from || !parsed.to || parsed.from <= parsed.to) {
            onChange({ from: parsed.from || null, to: parsed.to || null });
            return;
          }
        }
      }
    } catch {
      // Ignore localStorage errors
    }

    // If nothing saved and defaultPreset is provided, set it
    if (defaultPreset && defaultPreset !== 'ALL' && !value.from && !value.to) {
      const initialRange = getDateRangeForPreset(defaultPreset);
      onChange(initialRange);
    }
  }, [storageKey]);

  // Validation: from > to
  const isInvalidRange = useMemo(() => {
    if (fromInput && toInput && fromInput > toInput) {
      return true;
    }
    return false;
  }, [fromInput, toInput]);

  // Determine which preset is currently active
  const activePreset = useMemo<DatePresetKey | 'CUSTOM'>(() => {
    if (!value.from && !value.to) {
      return 'ALL';
    }
    for (const p of PRESETS) {
      if (p.key === 'ALL') continue;
      const range = getDateRangeForPreset(p.key);
      if (range.from === value.from && range.to === value.to) {
        return p.key;
      }
    }
    return 'CUSTOM';
  }, [value.from, value.to]);

  // Save to localStorage whenever a valid value changes
  const saveToStorage = (range: DateRange) => {
    if (!storageKey) return;
    try {
      localStorage.setItem(`date_filter_${storageKey}`, JSON.stringify(range));
    } catch {
      // Ignore
    }
  };

  const handleApplyRange = (newFrom: string, newTo: string) => {
    setFromInput(newFrom);
    setToInput(newTo);

    if (newFrom && newTo && newFrom > newTo) {
      // Do not apply invalid range
      return;
    }

    const newRange: DateRange = {
      from: newFrom || null,
      to: newTo || null,
    };
    onChange(newRange);
    saveToStorage(newRange);
  };

  const handlePresetClick = (presetKey: DatePresetKey) => {
    const range = getDateRangeForPreset(presetKey);
    setFromInput(range.from || '');
    setToInput(range.to || '');
    onChange(range);
    saveToStorage(range);
  };

  const handleClear = () => {
    handlePresetClick('ALL');
  };

  const activePresetLabel = useMemo(() => {
    const found = PRESETS.find((p) => p.key === activePreset);
    return found ? found.label : 'فترة مخصصة';
  }, [activePreset]);

  const printPeriodText = useMemo(() => {
    if (!value.from && !value.to) {
      return `الفترة: ${activePresetLabel} (جميع التواريخ)`;
    }
    return `الفترة: ${activePresetLabel} (من ${value.from || 'البداية'} إلى ${value.to || 'الآن'})`;
  }, [activePresetLabel, value.from, value.to]);

  if (inline) {
    return (
      <>
        <div className={`flex flex-wrap items-end gap-3 no-print ${className}`.trim()}>
          {showPresets && (
            <div>
              <label
                htmlFor={`preset-date-${storageKey || 'default'}`}
                className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
              >
                الفترة
              </label>
              <select
                id={`preset-date-${storageKey || 'default'}`}
                value={activePreset === 'CUSTOM' ? 'CUSTOM' : activePreset}
                onChange={(e) => {
                  const val = e.target.value as DatePresetKey | 'CUSTOM';
                  if (val !== 'CUSTOM') handlePresetClick(val);
                }}
                className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} text-xs font-semibold`}
              >
                {PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
                {activePreset === 'CUSTOM' && (
                  <option value="CUSTOM">فترة مخصصة</option>
                )}
              </select>
            </div>
          )}

          <div>
            <label
              htmlFor={`from-date-${storageKey || 'default'}`}
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              من تاريخ
            </label>
            <input
              id={`from-date-${storageKey || 'default'}`}
              type="date"
              dir="ltr"
              value={fromInput}
              onChange={(e) => handleApplyRange(e.target.value, toInput)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} text-xs font-mono`}
            />
          </div>

          <div>
            <label
              htmlFor={`to-date-${storageKey || 'default'}`}
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1"
            >
              إلى تاريخ
            </label>
            <input
              id={`to-date-${storageKey || 'default'}`}
              type="date"
              dir="ltr"
              value={toInput}
              onChange={(e) => handleApplyRange(fromInput, e.target.value)}
              className={`${FORM_CONTROL_BASE_CLASS} ${INPUT_WIDTH_CLASSES.date} text-xs font-mono`}
            />
          </div>

          {(value.from || value.to) && (
            <button
              type="button"
              onClick={handleClear}
              className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--surface-subtle)] ui-stock-out text-xs font-semibold transition cursor-pointer"
              title="مسح الفلتر"
            >
              <X className="w-3.5 h-3.5" />
              <span>مسح</span>
            </button>
          )}

          {isInvalidRange && (
            <div className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-semibold ui-stock-out">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>تاريخ البداية بعد تاريخ النهاية</span>
            </div>
          )}
        </div>
        <div className="print-only print-filter-summary">
          {printPeriodText}
        </div>
      </>
    );
  }

  return (
    <>
      <div
        className={`no-print bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 shadow-sm transition-all ${className}`}
      >
        <div className="flex flex-col gap-3">
          {/* Presets Bar */}
          {showPresets && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
              <span className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap pl-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                الفترة:
              </span>
              {PRESETS.map((p) => {
                const isActive = activePreset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => handlePresetClick(p.key)}
                    className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
                      isActive
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-200'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Date Inputs + Clear Button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {/* From Input */}
            <div className="flex-1 flex items-center bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500">
              <label
                htmlFor={`from-date-${storageKey || 'default'}`}
                className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap ml-2 font-medium"
              >
                من تاريخ:
              </label>
              <input
                id={`from-date-${storageKey || 'default'}`}
                type="date"
                value={fromInput}
                onChange={(e) => handleApplyRange(e.target.value, toInput)}
                className="w-full bg-transparent text-sm text-slate-800 dark:text-slate-100 outline-none min-h-[36px]"
              />
            </div>

            {/* To Input */}
            <div className="flex-1 flex items-center bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500">
              <label
                htmlFor={`to-date-${storageKey || 'default'}`}
                className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap ml-2 font-medium"
              >
                إلى تاريخ:
              </label>
              <input
                id={`to-date-${storageKey || 'default'}`}
                type="date"
                value={toInput}
                onChange={(e) => handleApplyRange(fromInput, e.target.value)}
                className="w-full bg-transparent text-sm text-slate-800 dark:text-slate-100 outline-none min-h-[36px]"
              />
            </div>

            {/* Clear Button */}
            {(value.from || value.to) && (
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 dark:text-rose-300 dark:bg-rose-950/40 dark:hover:bg-rose-900/40 rounded-lg transition-colors min-h-[36px]"
                title="مسح الفلتر"
              >
                <X className="w-3.5 h-3.5" />
                <span>مسح الفلتر</span>
              </button>
            )}
          </div>

          {/* Validation Error Message */}
          {isInvalidRange && (
            <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-lg p-2 animate-fadeIn">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="font-medium">تاريخ البداية بعد تاريخ النهاية</span>
            </div>
          )}
        </div>
      </div>
      <div className="print-only print-filter-summary">
        {printPeriodText}
      </div>
    </>
  );
};

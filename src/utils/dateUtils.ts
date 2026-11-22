/**
 * Utility functions for Cairo timezone date filtering, presets, and Arabic text normalization.
 */

export type DatePresetKey =
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_7_DAYS'
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'THIS_YEAR'
  | 'ALL'
  | 'CUSTOM';

export interface DateRange {
  from: string | null;
  to: string | null;
}

/**
 * Normalizes any timestamp/date string/Date object to 'YYYY-MM-DD' in Africa/Cairo timezone.
 */
export function toCairoDateStr(input: string | Date | number | null | undefined): string {
  if (!input) return '';

  if (typeof input === 'string') {
    // Pure YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      return input;
    }

    try {
      const d = new Date(input);
      if (!isNaN(d.getTime())) {
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Africa/Cairo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        return formatter.format(d);
      }
    } catch {
      return input.slice(0, 10);
    }
    return input.slice(0, 10);
  }

  if (input instanceof Date || typeof input === 'number') {
    const d = new Date(input);
    if (!isNaN(d.getTime())) {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return formatter.format(d);
    }
  }

  return '';
}

/**
 * Returns current date in Africa/Cairo as 'YYYY-MM-DD'.
 */
export function getCairoToday(): string {
  return toCairoDateStr(new Date());
}

/**
 * Calculates start and end dates (YYYY-MM-DD) for a given preset in Cairo timezone.
 */
export function getDateRangeForPreset(preset: DatePresetKey): DateRange {
  if (preset === 'ALL') {
    return { from: null, to: null };
  }

  const todayStr = getCairoToday();
  const [yearStr, monthStr, dayStr] = todayStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  switch (preset) {
    case 'TODAY':
      return { from: todayStr, to: todayStr };

    case 'YESTERDAY': {
      const yestDate = new Date(Date.UTC(year, month - 1, day - 1));
      const yestStr = yestDate.toISOString().slice(0, 10);
      return { from: yestStr, to: yestStr };
    }

    case 'LAST_7_DAYS': {
      const pastDate = new Date(Date.UTC(year, month - 1, day - 6));
      const pastStr = pastDate.toISOString().slice(0, 10);
      return { from: pastStr, to: todayStr };
    }

    case 'THIS_MONTH': {
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { from, to };
    }

    case 'LAST_MONTH': {
      const prevMonthRef = new Date(Date.UTC(year, month - 2, 1));
      const prevYear = prevMonthRef.getUTCFullYear();
      const prevMonth = prevMonthRef.getUTCMonth() + 1;
      const prevLastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
      const from = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
      const to = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevLastDay).padStart(2, '0')}`;
      return { from, to };
    }

    case 'THIS_YEAR':
      return {
        from: `${year}-01-01`,
        to: `${year}-12-31`,
      };

    default:
      return { from: null, to: null };
  }
}

/**
 * Checks if a given item date (in ISO or local format) falls within [from, to] (inclusive).
 */
export function isDateInRange(
  dateVal: string | Date | number | null | undefined,
  from: string | null,
  to: string | null
): boolean {
  if (!dateVal) return false;
  const cairoDate = toCairoDateStr(dateVal);
  if (!cairoDate) return false;

  if (from && cairoDate < from) return false;
  if (to && cairoDate > to) return false;

  return true;
}

/**
 * Arabic normalization function for search and matching.
 * Normalizes:
 * - أ / إ / آ / ٱ -> ا
 * - ة -> ه
 * - ى -> ي
 * - removes tashkeel / diacritics
 */
export function normalizeArabicText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .trim();
}

/**
 * Standard money formatting helper (e.g. 5,000.00).
 */
export function formatMoney(amount: number | undefined | null): string {
  if (amount == null || isNaN(amount)) return '0.00';
  return Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}


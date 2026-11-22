/**
 * Fixed input width classes by data type (Rule 4 — Single-Surface Design Rules).
 * - number (price, quantity, percentage): 120px
 * - date: 160px
 * - code (barcode / sku): 220px
 * - name: 360px
 * - notes (description / notes): 480px
 */
export const INPUT_WIDTH_CLASSES = {
  number: 'input-w-number',
  date: 'input-w-date',
  code: 'input-w-code',
  name: 'input-w-name',
  notes: 'input-w-notes',
} as const;

export const INPUT_WIDTH_PX = {
  number: 120,
  date: 160,
  code: 220,
  name: 360,
  notes: 480,
} as const;

export const FORM_CONTROL_BASE_CLASS =
  'min-h-[44px] px-3 py-2 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-ring)]';

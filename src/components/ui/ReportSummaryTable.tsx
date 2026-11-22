import React from 'react';
import { CompactTable, COMPACT_TABLE_NUM_CLASS, COMPACT_TABLE_TEXT_CLASS } from './CompactTable';

export interface ReportSummaryRow {
  label: string;
  value: React.ReactNode;
  note?: string;
  valueClassName?: string;
  tone?: 'default' | 'sale' | 'purchase' | 'accent';
  emphasize?: boolean;
}

export interface ReportSummaryTableProps {
  rows: ReportSummaryRow[];
  ariaLabel?: string;
  labelHeader?: string;
  valueHeader?: string;
}

function resolveToneClass(tone?: ReportSummaryRow['tone']): string {
  switch (tone) {
    case 'sale':
      return 'ui-money-sale';
    case 'purchase':
      return 'ui-money-purchase';
    case 'accent':
      return 'ui-link';
    default:
      return 'text-[var(--text-primary)]';
  }
}

/**
 * جدول المؤشرات الرقمية المختصر أعلى التقرير (عمودان: البند | القيمة) على قدر البيانات.
 */
export const ReportSummaryTable: React.FC<ReportSummaryTableProps> = ({
  rows,
  ariaLabel = 'ملخص المؤشرات الرقمية',
  labelHeader = 'البند',
  valueHeader = 'القيمة',
}) => {
  if (!rows.length) return null;

  return (
    <CompactTable ariaLabel={ariaLabel}>
      <thead>
        <tr>
          <th className={`text-right ${COMPACT_TABLE_TEXT_CLASS}`}>{labelHeader}</th>
          <th className={`text-left ${COMPACT_TABLE_NUM_CLASS}`}>{valueHeader}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const toneClass = row.valueClassName || resolveToneClass(row.tone);
          const emphasizeClass = row.emphasize ? 'text-sm font-extrabold' : 'font-bold';
          return (
            <tr
              key={`${row.label}-${idx}`}
              className={row.emphasize ? 'border-t border-[var(--border-color)]' : undefined}
            >
              <td className={COMPACT_TABLE_TEXT_CLASS}>
                <div className={`${row.emphasize ? 'font-bold' : 'font-semibold'} text-[var(--text-primary)]`}>
                  {row.label}
                </div>
                {row.note && (
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{row.note}</div>
                )}
              </td>
              <td className={`text-left ${COMPACT_TABLE_NUM_CLASS} ${emphasizeClass} ${toneClass}`}>
                {row.value}
              </td>
            </tr>
          );
        })}
      </tbody>
    </CompactTable>
  );
};

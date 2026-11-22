import React from 'react';

export const COMPACT_TABLE_NUM_CLASS = 'compact-table-num-col';
export const COMPACT_TABLE_TEXT_CLASS = 'compact-table-text-col';

export interface CompactTableProps {
  children: React.ReactNode;
  wrapperClassName?: string;
  tableClassName?: string;
  ariaLabel?: string;
}

/**
 * Content-sized data table (Rule 3):
 * - width: max-content (never stretched to 100%)
 * - starts from inline-start (right in RTL), leaving unused viewport space empty
 * - scrolls horizontally inside its own container only on narrow viewports
 */
export const CompactTable: React.FC<CompactTableProps> = ({
  children,
  wrapperClassName = '',
  tableClassName = '',
  ariaLabel,
}) => {
  return (
    <div className={`compact-table-wrap ${wrapperClassName}`.trim()}>
      <table
        aria-label={ariaLabel}
        className={`compact-table ${tableClassName}`.trim()}
      >
        {children}
      </table>
    </div>
  );
};

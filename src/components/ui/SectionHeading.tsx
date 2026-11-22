import React from 'react';

export interface SectionHeadingProps {
  title: React.ReactNode;
  actions?: React.ReactNode;
  withTopDivider?: boolean;
  className?: string;
}

/**
 * Unified section separator & heading (Rule 2):
 * 15px font-size, 600 weight, thin light hairline divider, 20px spacing.
 */
export const SectionHeading: React.FC<SectionHeadingProps> = ({
  title,
  actions,
  withTopDivider = false,
  className = '',
}) => {
  return (
    <div
      className={`${
        withTopDivider ? 'page-surface-divider' : ''
      } flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-[var(--border-subtle)] ${className}`.trim()}
    >
      <h2 className="text-[15px] font-semibold leading-snug text-[var(--text-primary)] m-0">
        {title}
      </h2>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
};

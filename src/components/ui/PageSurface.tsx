import React from 'react';
import {
  PrintHeader,
  PrintSurfaceNestingProvider,
  usePrintCompany,
} from './PrintHeader';

export interface PageSurfaceProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  dir?: 'rtl' | 'ltr';
  className?: string;
  children: React.ReactNode;
}

/**
 * Unified single-surface page container (Rule 1).
 * Uses theme surface color without inner nested cards, shadows, or section boxes.
 */
export const PageSurface: React.FC<PageSurfaceProps> = ({
  title,
  subtitle,
  actions,
  dir = 'rtl',
  className = '',
  children,
}) => {
  const { insidePageSurface } = usePrintCompany();
  const hasHeader = Boolean(title || subtitle || actions);

  return (
    <PrintSurfaceNestingProvider>
      <section
        dir={dir}
        className={`page-surface ${className}`.trim()}
      >
        {!insidePageSurface && title && (
          <PrintHeader title={title} subtitle={subtitle} />
        )}
        {hasHeader && (
          <header className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-[var(--border-subtle)] no-print">
            <div className="min-w-0">
              {title && (
                <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] leading-snug">
                  {title}
                </h1>
              )}
              {subtitle && (
                <p className="mt-1 text-xs font-medium text-[var(--text-secondary)] leading-relaxed">
                  {subtitle}
                </p>
              )}
            </div>
            {actions && (
              <div className="flex flex-wrap items-center gap-2 shrink-0 no-print">
                {actions}
              </div>
            )}
          </header>
        )}
        {children}
      </section>
    </PrintSurfaceNestingProvider>
  );
};

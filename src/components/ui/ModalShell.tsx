import React from 'react';
import { X } from 'lucide-react';
import { useModalShortcuts } from '../../context/KeyboardShortcutsContext';

export interface ModalShellProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  onSave?: () => void | Promise<void>;
  saveDisabled?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  dir?: 'rtl' | 'ltr';
  className?: string;
  bodyClassName?: string;
  closeDisabled?: boolean;
  printable?: boolean;
}

/**
 * Single-surface content-sized modal dialog:
 * - No nested boxes or dark headers; inherits theme surface & text tokens
 * - Width fits content (`w-fit min-w-[300px] max-w-[calc(95vw/var(--app-zoom,1))]`)
 * - Accessible close button (`min-h-[44px] min-w-[44px]`)
 */
export const ModalShell: React.FC<ModalShellProps> = ({
  title,
  subtitle,
  onClose,
  onSave,
  saveDisabled = false,
  children,
  footer,
  dir = 'rtl',
  className = '',
  bodyClassName = '',
  closeDisabled = false,
  printable = false,
}) => {
  useModalShortcuts({
    isOpen: true,
    onClose,
    onSave,
    closeDisabled,
    saveDisabled
  });

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/55 overflow-y-auto ${
        printable ? 'print-modal-backdrop' : 'no-print'
      }`}
      dir={dir}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-fit min-w-[300px] max-w-[calc(95vw/var(--app-zoom,1))] max-h-[calc(90vh/var(--app-zoom,1))] flex flex-col rounded-2xl bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border-color)] overflow-hidden ${
          printable ? 'print-modal-dialog' : ''
        } ${className}`.trim()}
      >
        <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-[var(--text-primary)] leading-snug">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={closeDisabled}
            onClick={onClose}
            aria-label="إغلاق"
            className="no-print min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] transition cursor-pointer disabled:opacity-40 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={`p-5 overflow-y-auto space-y-4 flex-1 ${bodyClassName}`.trim()}>
          {children}
        </div>

        {footer && (
          <div className="no-print px-5 py-3.5 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

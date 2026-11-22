import React, { createContext, useContext, useEffect, useState } from 'react';

interface PrintCompanyContextValue {
  storeName?: string;
  logoUrl?: string;
  insidePageSurface: boolean;
}

const PrintCompanyContext = createContext<PrintCompanyContextValue>({
  storeName: undefined,
  logoUrl: undefined,
  insidePageSurface: false,
});

export interface PrintCompanyProviderProps {
  storeName?: string;
  logoUrl?: string;
  children: React.ReactNode;
}

export const PrintCompanyProvider: React.FC<PrintCompanyProviderProps> = ({
  storeName,
  logoUrl,
  children,
}) => {
  return (
    <PrintCompanyContext.Provider
      value={{
        storeName,
        logoUrl,
        insidePageSurface: false,
      }}
    >
      {children}
    </PrintCompanyContext.Provider>
  );
};

export const PrintSurfaceNestingProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const parent = useContext(PrintCompanyContext);
  return (
    <PrintCompanyContext.Provider
      value={{
        storeName: parent.storeName,
        logoUrl: parent.logoUrl,
        insidePageSurface: true,
      }}
    >
      {children}
    </PrintCompanyContext.Provider>
  );
};

export function usePrintCompany(): PrintCompanyContextValue {
  return useContext(PrintCompanyContext);
}

function formatCairoTimestamp(date: Date): string {
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toLocaleString('ar-EG');
  }
}

export interface PrintHeaderProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
}

/**
 * ترويسة طباعة موحدة تظهر في وضع الطباعة فقط أعلى الصفحة المطبوعة
 * (تُخفى على الشاشة عبر .print-only وتظهر عبر @media print لغير الإيصالات).
 */
export const PrintHeader: React.FC<PrintHeaderProps> = ({ title, subtitle }) => {
  const { storeName, logoUrl } = usePrintCompany();
  const [printedAt, setPrintedAt] = useState<Date>(() => new Date());

  useEffect(() => {
    const handleBeforePrint = () => {
      setPrintedAt(new Date());
    };
    window.addEventListener('beforeprint', handleBeforePrint);
    return () => window.removeEventListener('beforeprint', handleBeforePrint);
  }, []);

  const displayStoreName = (storeName || '').trim() || 'مدقق للنظم';

  return (
    <div className="print-only print-header" dir="rtl">
      <div className="print-header-row">
        <div className="print-header-brand">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={displayStoreName}
              className="print-header-logo"
            />
          ) : null}
          <div className="print-header-titles">
            <div className="print-header-company">{displayStoreName}</div>
            {title ? <div className="print-header-report-title">{title}</div> : null}
            {subtitle ? <div className="print-header-subtitle">{subtitle}</div> : null}
          </div>
        </div>

        <div className="print-header-meta">
          <div className="print-header-meta-label">تاريخ ووقت الطباعة (القاهرة)</div>
          <div className="print-header-meta-value" dir="ltr">
            {formatCairoTimestamp(printedAt)}
          </div>
        </div>
      </div>
    </div>
  );
};

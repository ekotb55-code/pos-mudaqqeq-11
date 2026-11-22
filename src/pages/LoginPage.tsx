import React, { useState, useEffect, useCallback } from 'react';
import { AuthSession, ContactSettings } from '../types';
import { api, DatabasePublicStatusResponse } from '../api/client';
import { Lock, KeyRound, AlertCircle, Phone, Database, CheckCircle, XCircle, Copy, ExternalLink, RefreshCw, Check } from 'lucide-react';
import {
  MUDAQQEQ_BRAND_URL,
  MUDAQQEQ_LOGO_PATH,
  MUDAQQEQ_LOGO_ALT,
  MUDAQQEQ_LINK_ARIA_LABEL,
  MUDAQQEQ_FALLBACK_LETTER
} from '../config/brand';

interface LoginPageProps {
  hasOwner?: boolean;
  hasManager?: boolean;
  onLoginSuccess: (session: AuthSession) => void;
  sessionExpiredMsg?: string | null;
  currentLang?: 'en' | 'ar';
  onLanguageChange?: (lang: 'en' | 'ar') => void;
}

function formatWhatsappHref(raw?: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\D/g, '').replace(/^0+/, '');
  if (!cleaned) return null;
  return `https://wa.me/${cleaned}`;
}

function formatTelHref(raw?: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, '');
  if (!cleaned) return null;
  return `tel:${cleaned}`;
}

const WhatsAppIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.79 14.07c-.24.68-1.42 1.3-1.97 1.38-.5.08-1.14.11-1.84-.11-.43-.14-.98-.32-1.69-.63-2.97-1.28-4.91-4.27-5.06-4.47-.15-.2-1.21-1.61-1.21-3.07 0-1.46.77-2.18 1.04-2.48.27-.3.6-.37.8-.37.2 0 .4 0 .57.01.18.01.43-.07.67.51.25.6.85 2.07.92 2.22.08.15.13.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.3.77 1.27 1.65 2.06 1.13 1.01 2.09 1.32 2.39 1.47.3.15.47.12.64-.08.18-.2.74-.86.94-1.16.2-.3.4-.25.67-.15.27.1 1.73.82 2.03.97.3.15.5.22.57.34.08.12.08.7-.16 1.38z" />
  </svg>
);

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginSuccess,
  sessionExpiredMsg,
  currentLang,
  onLanguageChange
}) => {
  const [lang, setLang] = useState<'en' | 'ar'>(() => {
    if (currentLang) return currentLang;
    try {
      const saved = localStorage.getItem('mudaqqeq_lang');
      if (saved === 'ar' || saved === 'en') {
        return saved;
      }
    } catch (_) {}
    return 'ar';
  });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(sessionExpiredMsg || null);
  const [logoImgError, setLogoImgError] = useState(false);
  const [contactSettings, setContactSettings] = useState<ContactSettings | null>(null);

  // حالة قاعدة البيانات العامة (لوحة التهيئة قبل تسجيل الدخول)
  const [publicDbStatus, setPublicDbStatus] = useState<DatabasePublicStatusResponse | null>(null);
  const [isCheckingDb, setIsCheckingDb] = useState(false);
  const [isCopyingSql, setIsCopyingSql] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const fetchPublicDbStatus = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsCheckingDb(true);
    try {
      const res = await api.getDatabasePublicStatus();
      setPublicDbStatus(res);
      setSetupError(null);
    } catch (err: any) {
      if (showSpinner) {
        setSetupError(err?.message || 'تعذر قراءة حالة قاعدة البيانات');
      }
    } finally {
      if (showSpinner) setIsCheckingDb(false);
    }
  }, []);

  useEffect(() => {
    void fetchPublicDbStatus(false);
  }, [fetchPublicDbStatus]);

  useEffect(() => {
    if (!publicDbStatus?.needsSetup) return;
    const timer = window.setInterval(() => {
      void fetchPublicDbStatus(false);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [publicDbStatus?.needsSetup, fetchPublicDbStatus]);

  const handleCopySetupSql = async () => {
    setIsCopyingSql(true);
    setSetupError(null);
    try {
      const sqlText = await api.getDatabaseSetupSql();
      await navigator.clipboard.writeText(sqlText);
      setSqlCopied(true);
      window.setTimeout(() => setSqlCopied(false), 3000);
    } catch (err: any) {
      setSetupError(err?.message || 'تعذر نسخ كود التهيئة');
    } finally {
      setIsCopyingSql(false);
    }
  };

  useEffect(() => {
    let active = true;
    api.getPublicContactSettings()
      .then((res) => {
        if (active && res) {
          setContactSettings(res);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const isRtl = lang === 'ar';
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('mudaqqeq_lang', lang);
    } catch (_) {}
    if (onLanguageChange) {
      onLanguageChange(lang);
    }
  }, [lang, onLanguageChange]);

  const handleLanguageToggle = (selectedLang: 'en' | 'ar') => {
    setLang(selectedLang);
    setError(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername || !password.trim()) {
      setError(
        lang === 'ar'
          ? 'يرجى إدخال اسم المستخدم وكلمة المرور'
          : 'Please enter username and password'
      );
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const session = await api.login(cleanUsername, password.trim());
      if (session.token && session.user) {
        onLoginSuccess(session);
      }
    } catch (err: any) {
      if (err?.code === 'DATABASE_UNAVAILABLE') {
        void fetchPublicDbStatus(false);
      }
      setError(
        err.message ||
          (lang === 'ar'
            ? 'فشل تسجيل الدخول، تأكد من صحة اسم المستخدم وكلمة المرور'
            : 'Login failed. Please check your username and password')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const isRtl = lang === 'ar';
  const needsDatabaseSetup = Boolean(publicDbStatus?.needsSetup && !publicDbStatus?.ready);

  const t = {
    appName: isRtl ? 'مدقق للنظم' : 'Mudaqqeq Systems',
    systemDescription: isRtl
      ? 'نظام إدارة نقاط البيع والتدقيق المحاسبي للمنصات الرقمية'
      : 'POS & Accounting Management for Digital Marketplaces',
    welcomeHeading: isRtl ? 'تسجيل الدخول للنظام' : 'Sign in to your account',
    welcomeSub: isRtl
      ? 'أدخل بيانات الاعتماد للمتابعة إلى لوحة التحكم'
      : 'Enter your credentials to access the portal',
    usernameLabel: isRtl ? 'اسم المستخدم' : 'Username',
    usernamePlaceholder: isRtl ? 'أدخل اسم المستخدم' : 'Enter username',
    passwordLabel: isRtl ? 'كلمة المرور' : 'Password',
    passwordPlaceholder: isRtl ? 'أدخل كلمة المرور' : 'Enter password',
    signInBtn: isRtl ? 'تسجيل الدخول' : 'Sign in',
    signingInBtn: isRtl ? 'جاري تسجيل الدخول...' : 'Signing in...',
    contactHeading: isRtl ? 'تواصل معنا' : 'Contact Us',
    supportTitle: isRtl ? 'الدعم الفني' : 'Technical Support',
    salesTitle: isRtl ? 'المبيعات' : 'Sales',
    copyright: isRtl
      ? '© 2026 مدقق للنظم • جميع الحقوق محفوظة'
      : '© 2026 Mudaqqeq Systems • All rights reserved'
  };

  const supportWaHref = formatWhatsappHref(contactSettings?.supportWhatsapp);
  const supportTelHref = formatTelHref(contactSettings?.supportPhone);
  const salesWaHref = formatWhatsappHref(contactSettings?.salesWhatsapp);
  const salesTelHref = formatTelHref(contactSettings?.salesPhone);
  const salesDisplayText = (contactSettings?.salesPhone || contactSettings?.salesWhatsapp || '').trim();

  const hasSupportRow = Boolean(supportWaHref || supportTelHref);
  const hasSalesRow = Boolean(salesWaHref || salesTelHref);
  const hasAnyContact = hasSupportRow || hasSalesRow;

  const ContactSection = () => {
    if (!hasAnyContact) return null;
    return (
      <div className="mt-6 pt-5 border-t border-[#D9E8F3]/80">
        <p className="text-xs font-extrabold text-[#164E72] mb-2.5 text-start">
          {t.contactHeading}
        </p>
        <div className="space-y-2">
          {hasSupportRow && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-[#F4F9FD] login-subtle-bg border border-[#D9E8F3]">
              <span className="text-xs font-bold text-[#164E72] text-start">{t.supportTitle}</span>
              <div className="flex items-center gap-2 shrink-0">
                {supportWaHref && (
                  <a
                    href={supportWaHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="واتساب الدعم الفني"
                    title="واتساب الدعم الفني"
                    className="login-wa-btn min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 inline-flex items-center justify-center transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                  >
                    <WhatsAppIcon className="w-5 h-5" />
                  </a>
                )}
                {supportTelHref && (
                  <a
                    href={supportTelHref}
                    aria-label="الاتصال بالدعم الفني"
                    title="الاتصال بالدعم الفني"
                    className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-[#1678C2] inline-flex items-center justify-center transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1678C2]"
                  >
                    <Phone className="w-5 h-5" />
                  </a>
                )}
              </div>
            </div>
          )}

          {hasSalesRow && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-[#F4F9FD] login-subtle-bg border border-[#D9E8F3]">
              <div className="min-w-0 flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2.5 text-start">
                <span className="text-xs font-bold text-[#164E72] shrink-0">{t.salesTitle}</span>
                {salesDisplayText && (
                  <span
                    dir="ltr"
                    className="text-xs font-mono font-bold text-[#263746] tabular-nums truncate"
                  >
                    {salesDisplayText}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {salesWaHref && (
                  <a
                    href={salesWaHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="واتساب المبيعات"
                    title="واتساب المبيعات"
                    className="login-wa-btn min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 inline-flex items-center justify-center transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                  >
                    <WhatsAppIcon className="w-5 h-5" />
                  </a>
                )}
                {salesTelHref && (
                  <a
                    href={salesTelHref}
                    aria-label="الاتصال بالمبيعات"
                    title="الاتصال بالمبيعات"
                    className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-[#1678C2] inline-flex items-center justify-center transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1678C2]"
                  >
                    <Phone className="w-5 h-5" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const LanguageToggle = () => (
    <div
      className="login-lang-track inline-flex items-center gap-1 p-1 rounded-xl bg-[#E8F3FB] border border-[#D9E8F3] text-xs font-bold shadow-2xs shrink-0"
      role="group"
      aria-label={isRtl ? 'تبديل اللغة' : 'Switch language'}
    >
      <button
        type="button"
        onClick={() => handleLanguageToggle('en')}
        aria-pressed={lang === 'en'}
        className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1678C2] ${
          lang === 'en'
            ? 'bg-[#1678C2] text-white shadow-xs font-black'
            : 'text-[#164E72] hover:text-[#1678C2]'
        }`}
      >
        English
      </button>
      <span className="login-muted-text opacity-50 select-none" aria-hidden="true">|</span>
      <button
        type="button"
        onClick={() => handleLanguageToggle('ar')}
        aria-pressed={lang === 'ar'}
        className={`px-2.5 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1678C2] ${
          lang === 'ar'
            ? 'bg-[#1678C2] text-white shadow-xs font-black'
            : 'text-[#164E72] hover:text-[#1678C2]'
        }`}
      >
        العربية
      </button>
    </div>
  );

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="relative min-h-[calc(100vh/var(--app-zoom,1))] w-full overflow-x-hidden flex items-center justify-center bg-gradient-to-br from-[#EBF5FB] via-[#F4F9FD] to-[#E5F2FA] login-gradient-bg px-4 py-4 md:p-6"
    >
      <div className="absolute top-[-5%] start-[-5%] w-72 sm:w-96 h-72 sm:h-96 rounded-full bg-cyan-200/30 blur-3xl pointer-events-none animate-float-gentle" />
      <div className="absolute bottom-[-5%] end-[-5%] w-80 sm:w-[420px] h-80 sm:h-[420px] rounded-full bg-sky-200/30 blur-3xl pointer-events-none animate-float-reverse" />

      <main className="relative w-full max-w-[960px] md:min-h-[560px] grid grid-cols-1 md:grid-cols-[2fr_3fr] bg-white login-card-surface rounded-3xl shadow-2xl shadow-sky-950/8 border border-[#D9E8F3] overflow-hidden my-auto">
        {/* Brand Panel (40% on >=768px, Compact Top Header on <768px) */}
        <section
          aria-label={t.appName}
          className="min-w-0 flex flex-col items-center text-center bg-gradient-to-b from-[#EBF5FB] via-[#F3F9FD] to-[#F9FCFF] login-subtle-bg p-5 pb-5 md:py-8 md:px-6 lg:px-8 border-b md:border-b-0 md:border-e border-[#D9E8F3]/80"
        >
          {/* Mobile (<768px) top language bar */}
          <div className="w-full flex items-center justify-end mb-2 md:hidden shrink-0">
            <LanguageToggle />
          </div>

          {/* Vertically centered brand block in the exact space above copyright */}
          <div className="flex-1 flex flex-col items-center justify-center w-full my-auto">
            <a
              href={MUDAQQEQ_BRAND_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mudaqqeq-login-logo-box w-[72px] h-[72px] md:w-[144px] md:h-[144px] p-2 md:p-3 bg-white rounded-[18px] md:rounded-[28px] shadow-md shadow-sky-950/8 border border-[#E2E8F0] flex items-center justify-center transition-all duration-300 hover:scale-105 hover:border-[#1678C2] hover:shadow-lg active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1678C2] focus-visible:ring-offset-2 cursor-pointer group shrink-0"
              style={{ backgroundColor: '#FFFFFF', filter: 'none' }}
              title={MUDAQQEQ_LINK_ARIA_LABEL}
              aria-label={MUDAQQEQ_LINK_ARIA_LABEL}
            >
              {!logoImgError ? (
                <img
                  src={MUDAQQEQ_LOGO_PATH}
                  alt={MUDAQQEQ_LOGO_ALT}
                  onError={() => setLogoImgError(true)}
                  className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105"
                  style={{ objectFit: 'contain', filter: 'none' }}
                />
              ) : (
                <span
                  className="font-extrabold text-2xl md:text-5xl leading-none"
                  style={{ color: '#0A5FC2' }}
                  aria-label={MUDAQQEQ_LOGO_ALT}
                >
                  {MUDAQQEQ_FALLBACK_LETTER}
                </span>
              )}
            </a>

            <h1 className="mt-6 text-[28px] font-bold text-[#164E72] leading-tight tracking-normal text-center">
              {t.appName}
            </h1>

            <p className="mt-2 text-[14.5px] login-muted-text font-medium leading-relaxed max-w-[280px] mx-auto text-center">
              {t.systemDescription}
            </p>
          </div>

          {/* Desktop (>=768px) copyright pinned at bottom center */}
          <p className="hidden md:block shrink-0 text-[12px] login-muted-text text-center leading-relaxed">
            {t.copyright}
          </p>
        </section>

        {/* Form or Database Setup Column (60% on >=768px) */}
        <section
          aria-label={needsDatabaseSetup ? 'قاعدة البيانات غير جاهزة' : t.welcomeHeading}
          className="min-w-0 p-5 sm:p-7 md:p-10 flex flex-col justify-center"
        >
          {needsDatabaseSetup ? (
            <div className="space-y-4 w-full text-start" dir="rtl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg md:text-xl font-bold text-[#164E72] leading-snug">
                    قاعدة البيانات غير جاهزة
                  </h2>
                  <p className="text-xs text-[#5E7082] mt-0.5 font-medium">
                    يُعاد فحص الجاهزية تلقائيًا كل 10 ثوانٍ، وعند اكتمال التهيئة سيظهر نموذج الدخول.
                  </p>
                </div>
              </div>

              {publicDbStatus?.check?.message && (
                <div
                  role="status"
                  className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs font-bold leading-relaxed"
                >
                  {publicDbStatus.check.message}
                </div>
              )}

              {publicDbStatus?.check?.items && publicDbStatus.check.items.length > 0 && (
                <div className="rounded-xl border border-[#D9E8F3] bg-[#F4F9FD] p-3.5 space-y-2">
                  <div className="text-xs font-extrabold text-[#164E72]">قائمة الفحوص:</div>
                  <ul className="space-y-2">
                    {publicDbStatus.check.items.map((item) => (
                      <li key={item.key} className="flex items-start justify-between gap-2 text-xs">
                        <div className="flex items-start gap-2 min-w-0">
                          {item.ok ? (
                            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0">
                            <div className="font-bold text-[#263746]">{item.label}</div>
                            {item.detail && (
                              <div className="text-[11px] text-[#5E7082] mt-0.5">{item.detail}</div>
                            )}
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-bold shrink-0 ${
                            item.ok ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {item.ok ? 'جاهز' : 'ناقص'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {setupError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-[#B42318] text-xs font-semibold flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{setupError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleCopySetupSql}
                  disabled={isCopyingSql}
                  className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-xl bg-[#1678C2] hover:bg-[#164E72] text-white font-bold text-xs transition cursor-pointer disabled:opacity-60"
                >
                  {sqlCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{sqlCopied ? 'تم النسخ' : 'نسخ كود التهيئة'}</span>
                </button>

                {publicDbStatus?.sqlEditorUrl && (
                  <a
                    href={publicDbStatus.sqlEditorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-xl border border-[#D9E8F3] bg-white hover:bg-[#F4F9FD] text-[#164E72] font-bold text-xs transition"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>فتح SQL Editor</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => void fetchPublicDbStatus(true)}
                  disabled={isCheckingDb}
                  className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-xl border border-[#D9E8F3] bg-white hover:bg-[#F4F9FD] text-[#263746] font-bold text-xs transition cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${isCheckingDb ? 'animate-spin' : ''}`} />
                  <span>{isCheckingDb ? 'جاري الفحص...' : 'إعادة الفحص'}</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Top header row: Heading + Subtitle on start, Language Toggle on end (>=768px) */}
              <div className="flex items-center justify-between gap-4 mb-5 md:mb-6">
                <div className="min-w-0 text-start">
                  <h2 className="text-lg md:text-xl font-bold text-[#164E72] leading-snug">
                    {t.welcomeHeading}
                  </h2>
                  <p className="text-xs login-muted-text mt-1 font-medium leading-relaxed">
                    {t.welcomeSub}
                  </p>
                </div>
                <div className="hidden md:block shrink-0">
                  <LanguageToggle />
                </div>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-4 w-full">
                <div>
                  <label
                    htmlFor="login-username"
                    className="block text-xs font-bold text-[#164E72] mb-1.5 text-start"
                  >
                    {t.usernameLabel} <span className="text-[#D6535B]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="login-username"
                      type="text"
                      required
                      autoFocus
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={t.usernamePlaceholder}
                      className="w-full h-12 ps-11 pe-4 rounded-xl border border-[#D9E8F3] bg-white text-[#263746] placeholder:text-[#5E7082] text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1678C2] focus-visible:ring-offset-1 focus:border-[#1678C2] transition shadow-2xs"
                    />
                    <Lock
                      aria-hidden="true"
                      className="w-4 h-4 login-muted-text absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-bold text-[#164E72] mb-1.5 text-start"
                  >
                    {t.passwordLabel} <span className="text-[#D6535B]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t.passwordPlaceholder}
                      className="w-full h-12 ps-11 pe-4 rounded-xl border border-[#D9E8F3] bg-white text-[#263746] placeholder:text-[#5E7082] text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1678C2] focus-visible:ring-offset-1 focus:border-[#1678C2] transition shadow-2xs"
                    />
                    <KeyRound
                      aria-hidden="true"
                      className="w-4 h-4 login-muted-text absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none"
                    />
                  </div>
                </div>

                {error && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="login-error-box p-3 rounded-xl bg-rose-50 border border-rose-200 text-[#B42318] text-xs flex items-center gap-2.5 animate-fadeIn text-start"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="leading-relaxed font-semibold">{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 rounded-xl bg-[#1678C2] hover:bg-[#164E72] text-white font-extrabold text-sm shadow-md shadow-sky-600/15 transition-all duration-200 active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1678C2] focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span>{isLoading ? t.signingInBtn : t.signInBtn}</span>
                </button>
              </form>
            </>
          )}

          <ContactSection />

          {/* Mobile (<768px) copyright at bottom */}
          <p className="md:hidden mt-6 text-[12px] login-muted-text text-center leading-relaxed">
            {t.copyright}
          </p>
        </section>
      </main>
    </div>
  );
};

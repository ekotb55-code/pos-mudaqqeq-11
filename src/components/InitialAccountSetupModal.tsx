import React, { useState } from 'react';
import { UserAccount } from '../types';
import { api } from '../api/client';
import { ShieldCheck, User, Lock, KeyRound, Eye, EyeOff, AlertCircle, LogOut, CheckCircle2 } from 'lucide-react';

interface InitialAccountSetupModalProps {
  user: UserAccount;
  onCompleted: (updatedUser: UserAccount) => void;
  onLogout: () => void;
}

export const InitialAccountSetupModal: React.FC<InitialAccountSetupModalProps> = ({
  user,
  onCompleted,
  onLogout
}) => {
  const [name, setName] = useState(user.name || '');
  const [username, setUsername] = useState(user.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = name.trim();
    const cleanUsername = username.trim();
    const cleanPassword = newPassword.trim();
    const cleanConfirm = confirmPassword.trim();

    if (!cleanName) {
      setError('الاسم الظاهر مطلوب');
      return;
    }

    if (!cleanUsername) {
      setError('اسم المستخدم مطلوب');
      return;
    }

    if (cleanPassword.length < 2) {
      setError('كلمة السر الجديدة يجب أن تتكون من حرفين أو رقمين على الأقل');
      return;
    }

    if (cleanPassword !== cleanConfirm) {
      setError('كلمة السر الجديدة وتأكيدها غير متطابقين');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.completeInitialAccountSetup({
        name: cleanName,
        username: cleanUsername,
        newPassword: cleanPassword
      });

      if (res.success && res.user) {
        onCompleted({
          ...user,
          ...res.user,
          mustChangePassword: false
        });
      } else {
        setError(res.error || 'تعذر حفظ إعداد الحساب');
      }
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ إعداد الحساب');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      dir="rtl"
      className="min-h-[calc(100vh/var(--app-zoom,1))] w-full flex items-center justify-center bg-gradient-to-br from-[#EBF5FB] via-[#F4F9FD] to-[#E5F2FA] p-4 sm:p-6"
    >
      <div className="w-full max-w-lg bg-white rounded-3xl border border-[#D9E8F3] shadow-2xl shadow-sky-950/10 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-l from-[#164E72] to-[#1678C2] text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-white">إعداد الحساب</h1>
              <p className="text-xs text-sky-100 mt-0.5">
                يرجى تحديث بيانات الحساب وتعيين كلمة سر جديدة للمتابعة
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition cursor-pointer min-h-[40px]"
            title="تسجيل الخروج"
          >
            <LogOut className="w-4 h-4" />
            <span>خروج</span>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200 text-xs text-[#164E72] leading-relaxed font-semibold">
            لأمان حسابك عند أول دخول (أو بعد إعادة تعيين كلمة السر)، يجب اختيار كلمة سر جديدة مختلفة قبل الوصول إلى النظام. يُقبل أي رقمين أو حرفين على الأقل.
          </div>

          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#164E72] mb-1.5">
              الاسم الظاهر <span className="text-rose-600">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="أدخل الاسم الظاهر"
                className="w-full pr-10 pl-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#42BDE5] focus:border-[#1678C2] min-h-[44px]"
              />
              <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#164E72] mb-1.5">
              اسم المستخدم <span className="text-rose-600">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                required
                dir="ltr"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                className="w-full pr-10 pl-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-mono text-slate-900 text-left focus:outline-none focus:ring-2 focus:ring-[#42BDE5] focus:border-[#1678C2] min-h-[44px]"
              />
              <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#164E72] mb-1.5">
              كلمة السر الجديدة <span className="text-rose-600">*</span>
            </label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="حرفان أو رقمان على الأقل"
                className="w-full pr-10 pl-11 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#42BDE5] focus:border-[#1678C2] min-h-[44px]"
              />
              <KeyRound className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
              <button
                type="button"
                onClick={() => setShowNewPassword(prev => !prev)}
                aria-label={showNewPassword ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'}
                className="absolute left-2 top-1.5 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#164E72] mb-1.5">
              تأكيد كلمة السر الجديدة <span className="text-rose-600">*</span>
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="أعد إدخال كلمة السر الجديدة"
                className="w-full pr-10 pl-11 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#42BDE5] focus:border-[#1678C2] min-h-[44px]"
              />
              <KeyRound className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(prev => !prev)}
                aria-label={showConfirmPassword ? 'إخفاء تأكيد كلمة السر' : 'إظهار تأكيد كلمة السر'}
                className="absolute left-2 top-1.5 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-[#1678C2] hover:bg-[#164E72] text-white font-extrabold text-sm shadow-md transition active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2 min-h-[46px] disabled:opacity-60"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isSubmitting ? 'جاري حفظ إعداد الحساب...' : 'حفظ ومتابعة للدخول'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};

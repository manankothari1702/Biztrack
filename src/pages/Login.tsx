import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { confirmSignUp, resendSignUpCode } from 'aws-amplify/auth';
import { logger } from '../utils/logger';
import { normalizeEmail } from '../utils/stringUtils';
import GoogleConsentModal from '../components/common/GoogleConsentModal';

type Mode = 'login' | 'signup' | 'verify' | 'forgot';

const Login: React.FC = () => {
    const { login, signup, googleSignIn, resetPassword } = useAuth();
    const navigate = useNavigate();

    const [mode, setMode]               = useState<Mode>('login');
    const [name, setName]               = useState('');
    const [email, setEmail]             = useState('');
    const [password, setPassword]       = useState('');
    const [verifyCode, setVerifyCode]   = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe]   = useState(true);
    const [error, setError]             = useState('');
    const [info, setInfo]               = useState('');
    const [loading, setLoading]         = useState(false);
    const [resendCooldown, setResendCooldown]       = useState(0);
    const [showGoogleConsent, setShowGoogleConsent] = useState(false);

    // ── Helpers ─────────────────────────────────────────────────────────────

    const mapError = (err: unknown): string => {
        const code = (err as { name?: string }).name ?? '';
        const msg  = (err as { message?: string }).message ?? '';
        if (code === 'UserNotFoundException')           return 'No account found with this email.';
        if (code === 'NotAuthorizedException')          return 'Email or password is incorrect.';
        if (code === 'UsernameExistsException')         return 'An account with this email already exists. Sign in instead.';
        if (code === 'CodeMismatchException')           return 'Incorrect verification code. Please try again.';
        if (code === 'ExpiredCodeException')            return 'Code expired. Request a new one below.';
        if (code === 'LimitExceededException')          return 'Too many attempts. Please wait a few minutes.';
        if (code === 'TooManyRequestsException')        return 'Too many requests. Please try again later.';
        if (code === 'NetworkError' || msg.includes('Network')) return 'Network error. Check your connection.';
        return 'Something went wrong. Please try again.';
    };

    const startResendCooldown = () => {
        setResendCooldown(60);
        const interval = setInterval(() => {
            setResendCooldown(prev => {
                if (prev <= 1) { clearInterval(interval); return 0; }
                return prev - 1;
            });
        }, 1000);
    };

    // ── Submit handlers ──────────────────────────────────────────────────────

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setInfo('');

        if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
        if (!/[A-Z]/.test(password)) { setError('Password must contain at least one uppercase letter.'); return; }
        if (!/[0-9]/.test(password)) { setError('Password must contain at least one number.'); return; }

        setLoading(true);
        try {
            await signup(normalizeEmail(email), password, name);
            setInfo(`Verification code sent to ${email}. Check your inbox.`);
            setMode('verify');
            startResendCooldown();
        } catch (err) {
            logger.error('Signup error', err);
            setError(mapError(err));
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setInfo('');
        setLoading(true);
        try {
            await confirmSignUp({ username: normalizeEmail(email), confirmationCode: verifyCode.trim() });
            // Auto-login after verification
            await login(normalizeEmail(email), password);
            navigate('/');
        } catch (err) {
            logger.error('Verify error', err);
            setError(mapError(err));
        } finally {
            setLoading(false);
        }
    };

    const handleResendCode = async () => {
        if (resendCooldown > 0) return;
        setError(''); setInfo('');
        try {
            await resendSignUpCode({ username: normalizeEmail(email) });
            setInfo('New code sent! Check your inbox.');
            startResendCooldown();
        } catch (err) {
            setError(mapError(err));
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setInfo('');
        setLoading(true);
        try {
            await login(normalizeEmail(email), password);
            navigate('/');
        } catch (err) {
            logger.error('Login error', err);
            setError(mapError(err));
        } finally {
            setLoading(false);
        }
    };

    const handleForgot = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setInfo('');
        setLoading(true);
        try {
            await resetPassword(normalizeEmail(email));
            setInfo(`Password reset email sent to ${email}.`);
        } catch (err) {
            logger.error('Reset error', err);
            setError(mapError(err));
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleConsentContinue = async () => {
        setError(''); setLoading(true);
        try {
            await googleSignIn(); // triggers redirect — page unloads, so loading stays true
        } catch (err) {
            logger.error('Google sign-in error', err);
            setError('Google sign-in failed. Please try again.');
            setLoading(false);
            setShowGoogleConsent(false);
        }
    };

    const switchMode = (next: Mode) => { setMode(next); setError(''); setInfo(''); };

    // ── UI ───────────────────────────────────────────────────────────────────

    const titles: Record<Mode, string> = {
        login:  'Sign in to manage your business',
        signup: 'Create your account',
        verify: 'Verify your email',
        forgot: 'Reset your password',
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden">
            {showGoogleConsent && (
                <GoogleConsentModal
                    loading={loading}
                    onCancel={() => setShowGoogleConsent(false)}
                    onContinue={handleGoogleConsentContinue}
                />
            )}
            {/* Background blobs */}
            <div className="absolute inset-0 z-0 opacity-40">
                <div className="absolute top-0 -left-4 w-72 h-72 bg-blue-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob" />
                <div className="absolute top-0 -right-4 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-2000" />
                <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-4000" />
            </div>

            <div className="max-w-md w-full bg-white/80 backdrop-blur-xl p-8 rounded-2xl shadow-2xl z-10 border border-white/20">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-extrabold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2 tracking-tight">
                        BizTrack
                    </h1>
                    <p className="text-slate-500 font-medium">{titles[mode]}</p>
                </div>

                {/* Feedback banners */}
                {error && (
                    <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm mb-6 border border-red-100 flex items-center gap-2">
                        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {error}
                    </div>
                )}
                {info && (
                    <div className="bg-blue-50 text-blue-700 p-4 rounded-xl text-sm mb-6 border border-blue-100 flex items-center gap-2">
                        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {info}
                    </div>
                )}

                {/* ── VERIFY mode ── */}
                {mode === 'verify' && (
                    <form onSubmit={handleVerify} className="space-y-5">
                        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
                            We sent a 6-digit code to <span className="font-bold">{email}</span>. Enter it below to activate your account.
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5 ml-1">Verification Code</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                required
                                value={verifyCode}
                                onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none text-center text-2xl font-bold tracking-[0.5em] placeholder:text-slate-300"
                                placeholder="······"
                                autoFocus
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading || verifyCode.length < 6}
                            className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold hover:shadow-lg hover:shadow-blue-500/30 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
                        >
                            {loading ? <Spinner /> : 'Verify & Sign In'}
                        </button>

                        <div className="text-center text-sm text-slate-500">
                            Didn't receive the code?{' '}
                            <button
                                type="button"
                                onClick={handleResendCode}
                                disabled={resendCooldown > 0}
                                className="text-blue-600 font-bold hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                            </button>
                        </div>
                    </form>
                )}

                {/* ── LOGIN / SIGNUP / FORGOT modes ── */}
                {mode !== 'verify' && (
                    <>
                        {/* Google button (not on forgot) */}
                        {mode !== 'forgot' && (
                            <>
                                <button
                                    onClick={() => setShowGoogleConsent(true)}
                                    disabled={loading}
                                    className="w-full py-3 px-4 bg-white border border-slate-200 rounded-xl text-slate-700 font-semibold hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center gap-3 shadow-sm mb-6"
                                >
                                    <GoogleIcon />
                                    {mode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}
                                </button>
                                <Divider />
                            </>
                        )}

                        <form
                            onSubmit={mode === 'signup' ? handleSignup : mode === 'forgot' ? handleForgot : handleLogin}
                            className="space-y-5"
                        >
                            {/* Name — signup only */}
                            {mode === 'signup' && (
                                <Field label="Full Name">
                                    <PersonIcon />
                                    <input
                                        type="text" required value={name}
                                        onChange={e => setName(e.target.value)}
                                        className={inputCls}
                                        placeholder="John Doe"
                                    />
                                </Field>
                            )}

                            {/* Email */}
                            <Field label="Email Address">
                                <EmailIcon />
                                <input
                                    type="email" required value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    onBlur={e => setEmail(normalizeEmail(e.target.value))}
                                    className={inputCls}
                                    placeholder="you@example.com"
                                />
                            </Field>

                            {/* Password — not on forgot */}
                            {mode !== 'forgot' && (
                                <Field label="Password">
                                    <LockIcon />
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        required value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        className={`${inputCls} pr-10`}
                                        placeholder="••••••••"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(v => !v)}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                                    >
                                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                                    </button>
                                    {mode === 'login' && (
                                        <div className="absolute -bottom-7 w-full flex items-center justify-between">
                                            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                                                <input
                                                    type="checkbox" checked={rememberMe}
                                                    onChange={e => setRememberMe(e.target.checked)}
                                                    className="rounded border-slate-300"
                                                />
                                                Remember me
                                            </label>
                                            <button type="button" onClick={() => switchMode('forgot')}
                                                className="text-xs font-medium text-blue-600 hover:underline">
                                                Forgot Password?
                                            </button>
                                        </div>
                                    )}
                                </Field>
                            )}

                            {/* Spacer for remember-me row */}
                            {mode === 'login' && <div className="pt-3" />}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold hover:shadow-lg hover:shadow-blue-500/30 active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
                            >
                                {loading ? <Spinner /> : mode === 'signup' ? 'Create Account' : mode === 'forgot' ? 'Send Reset Email' : 'Sign In'}
                            </button>
                        </form>

                        {/* Mode switcher */}
                        <div className="mt-8 text-center text-sm text-slate-500">
                            {mode === 'signup' && <>Already have an account?{' '}<ModeBtn onClick={() => switchMode('login')}>Sign In</ModeBtn></>}
                            {mode === 'login'  && <>Don't have an account?{' '}<ModeBtn onClick={() => switchMode('signup')}>Sign Up</ModeBtn></>}
                            {mode === 'forgot' && <ModeBtn onClick={() => switchMode('login')}>← Back to Sign In</ModeBtn>}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// ── Small reusable pieces ──────────────────────────────────────────────────

const inputCls = 'w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-400';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5 ml-1">{label}</label>
        <div className="relative flex items-center">{children}</div>
    </div>
);

const iconCls = 'absolute left-3 h-5 w-5 text-slate-400 pointer-events-none';

const ModeBtn: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
    <button onClick={onClick} className="text-blue-600 hover:text-blue-700 font-bold hover:underline">{children}</button>
);

const Divider = () => (
    <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
        <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white text-slate-400 font-medium">Or continue with email</span>
        </div>
    </div>
);

const Spinner = () => (
    <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
);

const GoogleIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
);

const PersonIcon = () => <svg className={iconCls} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>;
const EmailIcon  = () => <svg className={iconCls} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" /></svg>;
const LockIcon   = () => <svg className={iconCls} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>;
const EyeIcon    = () => <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>;
const EyeOffIcon = () => <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>;

export default Login;

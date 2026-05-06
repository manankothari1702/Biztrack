import React from 'react';

interface Props {
    onCancel:   () => void;
    onContinue: () => void;
    loading:    boolean;
}

const GoogleConsentModal: React.FC<Props> = ({ onCancel, onContinue, loading }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

        {/* Panel */}
        <div
            className="relative w-full max-w-sm rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            style={{ background: '#1e1e1e', color: '#fff' }}
        >
            {/* Top section */}
            <div className="flex flex-col items-center px-8 pt-8 pb-6 gap-4">
                {/* Google + BizTrack logos */}
                <div className="flex items-center gap-3">
                    <GoogleIcon size={32} />
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M4 10h12M10 4l6 6-6 6" stroke="#9aa0a6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm select-none">
                        B
                    </div>
                </div>

                <div className="text-center">
                    <p className="text-[13px]" style={{ color: '#9aa0a6' }}>
                        Google will share the following with
                    </p>
                    <p className="font-semibold text-white text-[15px]">BizTrack</p>
                </div>
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid #2e2e2e' }} />

            {/* Permissions list */}
            <div className="px-8 py-5 flex flex-col gap-3">
                <PermissionRow
                    icon={
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" style={{ color: '#9aa0a6' }}>
                            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                        </svg>
                    }
                    label="Name and profile picture"
                />
                <PermissionRow
                    icon={
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" style={{ color: '#9aa0a6' }}>
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                            <polyline points="22,6 12,13 2,6" />
                        </svg>
                    }
                    label="Email address"
                />
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid #2e2e2e' }} />

            {/* Actions */}
            <div className="flex gap-3 px-8 py-5">
                <button
                    onClick={onCancel}
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50"
                    style={{ border: '1px solid #444', color: '#e0e0e0', background: 'transparent' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#2a2a2a')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                    Cancel
                </button>
                <button
                    onClick={onContinue}
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ border: '1px solid #4a90d9', color: '#4a90d9', background: 'transparent' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(74,144,217,0.1)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                    {loading ? <Spinner /> : 'Continue'}
                </button>
            </div>

            {/* Footer note */}
            <div className="px-8 pb-6 text-center text-[11px]" style={{ color: '#5f6368' }}>
                Make sure you trust BizTrack before sharing your info.
            </div>
        </div>
    </div>
);

// ── Small pieces ──────────────────────────────────────────────────────────────

const PermissionRow: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
    <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm" style={{ color: '#e0e0e0' }}>{label}</span>
    </div>
);

const Spinner = () => (
    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
);

const GoogleIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
);

export default GoogleConsentModal;
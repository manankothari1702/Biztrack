import React, { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';

const CompleteProfileModal: React.FC = () => {
    const { needsProfileSetup, completeProfileSetup } = useData();
    const { getUserAttributes, logout } = useAuth();

    const [name, setName]         = useState('');
    const [email, setEmail]       = useState('');
    const [picture, setPicture]   = useState('');
    const [saving, setSaving]     = useState(false);
    const [error, setError]       = useState('');
    const [loadingAttrs, setLoadingAttrs] = useState(true);

    useEffect(() => {
        if (!needsProfileSetup) return;
        setLoadingAttrs(true);
        getUserAttributes().then(attrs => {
            if (attrs.name)    setName(attrs.name);
            if (attrs.email)   setEmail(attrs.email);
            if (attrs.picture) setPicture(attrs.picture);
            setLoadingAttrs(false);
        });
    }, [needsProfileSetup, getUserAttributes]);

    if (!needsProfileSetup) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) { setError('Please enter your display name.'); return; }
        setSaving(true);
        setError('');
        try {
            await completeProfileSetup(name.trim(), email);
        } catch {
            setError('Failed to create your account. Please try again.');
            setSaving(false);
        }
    };

    const initial = name?.charAt(0).toUpperCase() || '?';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-100 overflow-hidden">

                {/* Top banner */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 pt-8 pb-12 text-center relative">
                    <div className="flex items-center justify-center gap-2 mb-1">
                        <svg className="w-5 h-5 text-white/80" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff" opacity=".9"/>
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity=".9"/>
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" opacity=".9"/>
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity=".9"/>
                        </svg>
                        <span className="text-white/90 text-sm font-medium">Signed in with Google</span>
                    </div>
                    <h2 className="text-white text-xl font-bold">Complete your BizTrack account</h2>
                </div>

                {/* Profile picture — overlaps banner */}
                <div className="flex justify-center -mt-10 mb-2">
                    {loadingAttrs ? (
                        <div className="w-20 h-20 rounded-full bg-slate-200 animate-pulse ring-4 ring-white shadow-lg" />
                    ) : picture ? (
                        <img
                            src={picture}
                            alt={name}
                            className="w-20 h-20 rounded-full object-cover ring-4 ring-white shadow-lg"
                        />
                    ) : (
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-3xl font-bold ring-4 ring-white shadow-lg">
                            {initial}
                        </div>
                    )}
                </div>

                <div className="px-8 pb-8">
                    {/* Confirmed info */}
                    <div className="bg-slate-50 rounded-xl p-4 mb-5 space-y-2 border border-slate-100">
                        <div className="flex items-center gap-3">
                            <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                            </svg>
                            <span className="text-sm text-slate-600 truncate">{email || '—'}</span>
                            <span className="ml-auto shrink-0 flex items-center gap-1 text-xs text-green-600 font-semibold bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                Verified
                            </span>
                        </div>
                        <div className="border-t border-slate-200" />
                        <p className="text-xs text-slate-400 text-center">Your email is verified by Google — no code needed</p>
                    </div>

                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm mb-4 border border-red-100 flex items-center gap-2">
                            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Editable display name */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                Display Name
                                <span className="ml-2 text-xs font-normal text-slate-400">You can edit this</span>
                            </label>
                            <div className="relative">
                                <svg className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                <input
                                    type="text"
                                    required
                                    autoFocus
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="Your display name"
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-slate-800 font-medium"
                                />
                            </div>
                            <p className="text-xs text-slate-400 mt-1 ml-1">This is how your name will appear in BizTrack</p>
                        </div>

                        <button
                            type="submit"
                            disabled={saving || !name.trim() || loadingAttrs}
                            className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold hover:shadow-lg hover:shadow-blue-500/30 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {saving ? (
                                <>
                                    <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Creating your account...
                                </>
                            ) : (
                                <>
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                    </svg>
                                    Confirm & Get Started
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-4 text-center">
                        <button
                            type="button"
                            onClick={() => logout()}
                            className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            Cancel & Sign Out
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CompleteProfileModal;

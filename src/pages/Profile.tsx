import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faUser,
    faEnvelope,
    faPhone,
    faTrophy,
    faShieldAlt,
    faClock,
    faSignOutAlt,
    faKey,
    faCheckCircle,
    faPen,
    faSave,
    faTimes,
    faTrash,
    faCamera
} from '@fortawesome/free-solid-svg-icons';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import PhoneNumberInput from '../components/common/PhoneNumberInput';
import { OrgLevel } from '../types';
import { logger } from '../utils/logger';

const MAX_PHOTO_BYTES = 200 * 1024; // 200 KB
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const Profile: React.FC = () => {
    const { userProfile, updateUserProfile } = useData();
    const { success, error: showError, info } = useToast();
    const { currentUser, resetPassword, updateName, deleteAccount, logout } = useAuth();

    // Inline Editing States
    const [isEditing, setIsEditing] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isSignOutModalOpen, setIsSignOutModalOpen] = useState(false);

    // Form Data State
    const [formData, setFormData] = useState({
        name: '',
        level: OrgLevel.Supervisor,
        phoneNumber: '',
        countryCode: '+91',
        mobile: '',
        photoURL: ''
    });

    // Loading / Feedback States
    const [isSaving, setIsSaving] = useState(false);
    // Removed local message states in favor of toast

    // Derived Data
    const joinDate = currentUser?.metadata.creationTime
        ? new Date(currentUser.metadata.creationTime).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        })
        : 'Unknown';

    const lastLogin = currentUser?.metadata.lastSignInTime
        ? (() => {
            const d = new Date(currentUser.metadata.lastSignInTime);
            return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} • ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
        })()
        : 'First Session';

    // -- Handlers --

    const handleStartEdit = () => {
        setFormData({
            name: userProfile.name || '',
            level: userProfile.level || OrgLevel.Supervisor,
            phoneNumber: userProfile.phoneNumber || '',
            countryCode: userProfile.countryCode || '+91',
            mobile: userProfile.countryCode && userProfile.phoneNumber ? `${userProfile.countryCode}${userProfile.phoneNumber}` : '',
            photoURL: userProfile.photoURL || ''
        });
        setIsEditing(true);
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
    };

    const handleRemovePhoto = () => {
        setFormData(prev => ({ ...prev, photoURL: '' }));
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
            showError('Invalid File', 'Only JPEG, PNG, WebP, or GIF images are allowed.');
            e.target.value = '';
            return;
        }
        if (file.size > MAX_PHOTO_BYTES) {
            showError('File Too Large', 'Profile photo must be under 200 KB.');
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            setFormData(prev => ({ ...prev, photoURL: reader.result as string }));
        };
        reader.readAsDataURL(file);
    };

    const handleSaveProfile = async () => {
        setIsSaving(true);
        try {
            // Update Auth Profile Name if changed
            if (formData.name !== currentUser?.displayName) {
                await updateName(formData.name);
            }

            // Update Firestore Profile
            await updateUserProfile({
                ...userProfile,
                name: formData.name,
                level: formData.level,
                phoneNumber: formData.phoneNumber,
                countryCode: formData.countryCode,
                photoURL: formData.photoURL
            });

            success('Profile Updated', 'Your profile changes have been saved.');
            setIsEditing(false);

        } catch (error: unknown) {
            logger.error("Profile update failed", error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            showError('Update Failed', message);
        } finally {
            setIsSaving(false);
        }
    };

    const handlePhoneChange = (fullNumber: string, data: { country: string, countryCode: string, number: string }) => {
        setFormData(prev => ({
            ...prev,
            mobile: fullNumber,
            phoneNumber: data.number,
            countryCode: data.countryCode
        }));
    };

    const handleLogout = async () => {
        try {
            await logout();
        } catch (err) {
            logger.error("Logout failed", err);
            showError('Logout Failed', "Could not sign out. Please try again.");
        }
    };

    const handleDeleteAccount = async () => {
        try {
            await deleteAccount();
        } catch (err) {
            logger.error("Delete account failed", err);
            showError('Delete Failed', "Could not delete account. Please try again.");
        }
    };

    const handlePasswordReset = async () => {
        if (!userProfile.email) return;
        try {
            await resetPassword(userProfile.email);
            success('Email Sent', `Password reset email sent to ${userProfile.email}`);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            showError('Request Failed', message);
        }
    };

    const handleReportTimeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = e.target.value;
        try {
            await updateUserProfile({
                ...userProfile,
                reportGenerationTime: time
            });
        } catch (err) {
            logger.error("Failed to update report time:", err);
            showError('Update Failed', 'Failed to save report time.');
        }
    };

    const handleTestReport = () => {
        info('Test Report Triggered', "Report generation test triggered for " + (userProfile.reportGenerationTime || "current time"));
    };

    // Avatar Logic
    const displayPhoto = isEditing ? formData.photoURL : userProfile.photoURL;
    const initial = (isEditing ? formData.name : userProfile.name)?.charAt(0).toUpperCase() || '?';
    // Use persistent color if available, otherwise fallback to a default (e.g. blue-500 equivalent)
    // We render the background color dynamically if it's a hex code, or use a class if it's not set
    const avatarStyle = !displayPhoto && userProfile.avatarColor ? { backgroundColor: userProfile.avatarColor } : {};
    const avatarClass = !displayPhoto && !userProfile.avatarColor ? "bg-gradient-to-br from-blue-500 to-indigo-600" : "";

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-fade-in-up">

            {/* 1) Top Profile Header / Hero Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
                {/* Decorative Background Blur */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-50"></div>

                <div className="flex flex-col md:flex-row items-center gap-6 z-10">
                    <div className="relative group">
                        <div
                            className={`w-24 h-24 rounded-full flex items-center justify-center text-white text-4xl font-bold shadow-lg ring-4 ring-white overflow-hidden ${avatarClass}`}
                            style={avatarStyle}
                        >
                            {displayPhoto ? (
                                <img src={displayPhoto} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                <span>{initial}</span>
                            )}
                        </div>
                        {isEditing && (
                            <div className="absolute -bottom-2 -right-2 flex gap-2">
                                {displayPhoto && (
                                    <button
                                        onClick={handleRemovePhoto}
                                        className="bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors border-2 border-white"
                                        title="Remove Photo"
                                        type="button"
                                    >
                                        <FontAwesomeIcon icon={faTrash} className="text-xs" />
                                    </button>
                                )}
                                <label className="bg-slate-900 text-white w-8 h-8 rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:bg-slate-700 transition-colors border-2 border-white">
                                    <FontAwesomeIcon icon={faCamera} className="text-xs" />
                                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                                </label>
                            </div>
                        )}
                    </div>

                    <div className="text-center md:text-left space-y-2">
                        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                            {isEditing ? formData.name : (userProfile.name || 'User')}
                        </h1>

                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                            <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase border border-blue-200">
                                {userProfile.level || 'Supervisor'}
                            </span>
                            <span className="text-slate-500 text-sm font-medium flex items-center gap-1.5">
                                <FontAwesomeIcon icon={faClock} className="text-slate-400" />
                                Joined {joinDate}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Edit Controls */}
                <div className="z-10 flex flex-col items-end gap-2">
                    {/* Replaced inline messages with Toast */}

                    {!isEditing ? (
                        <button
                            onClick={handleStartEdit}
                            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-md active:scale-95"
                        >
                            <FontAwesomeIcon icon={faPen} className="text-sm" />
                            Update Profile
                        </button>
                    ) : (
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleCancelEdit}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
                            >
                                <FontAwesomeIcon icon={faTimes} />
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveProfile}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all disabled:opacity-70"
                            >
                                {isSaving ? (
                                    <>Saving...</>
                                ) : (
                                    <>
                                        <FontAwesomeIcon icon={faSave} />
                                        Save Changes
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* 2) Core Identity Card (Left Column, Span 2) */}
                <div className="lg:col-span-2 space-y-8">
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                                Core Identity
                            </h3>
                        </div>
                        <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-8">
                            {/* Legal Name */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Full Name</label>
                                {isEditing ? (
                                    <div className="relative">
                                        <FontAwesomeIcon icon={faUser} className="absolute left-3 top-3.5 text-slate-400 text-xs" />
                                        <input
                                            type="text"
                                            value={formData.name}
                                            onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                                            className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 font-semibold bg-slate-50/50"
                                        />
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                                        <FontAwesomeIcon icon={faUser} className="text-slate-400" />
                                        <span className="font-semibold text-slate-700">{userProfile.name}</span>
                                    </div>
                                )}
                            </div>

                            {/* Primary Email */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Primary Email</label>
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100 opacity-80" title="Email cannot be changed directly">
                                    <FontAwesomeIcon icon={faEnvelope} className="text-slate-400" />
                                    <span className="font-semibold text-slate-700 truncate">{userProfile.email}</span>
                                </div>
                            </div>

                            {/* Contact Number */}
                            <div>
                                <label className="flex items-center gap-2 md:flex-nowrap text-xs font-bold text-slate-400 uppercase mb-2">
                                    <span className="md:whitespace-nowrap">Contact Number</span>
                                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">WHATSAPP</span>
                                </label>
                                {isEditing ? (
                                    <PhoneNumberInput
                                        value={formData.mobile}
                                        onChange={handlePhoneChange}
                                        placeholder="Phone Number"
                                        hideLabel={true}
                                    />
                                ) : (
                                    <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                                        <FontAwesomeIcon icon={faPhone} className="text-slate-400" />
                                        <span className="font-semibold text-slate-700">
                                            {userProfile.countryCode} {userProfile.phoneNumber || '--'}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Business Tier (Renamed from Professional Level) */}
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Business Tier</label>
                                {isEditing ? (
                                    <div className="relative">
                                        <FontAwesomeIcon icon={faTrophy} className="absolute left-3 top-3.5 text-yellow-500 text-xs" />
                                        <select
                                            value={formData.level}
                                            onChange={e => setFormData(p => ({ ...p, level: e.target.value as OrgLevel }))}
                                            className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50 appearance-none cursor-pointer font-semibold text-slate-700"
                                        >
                                            {Object.values(OrgLevel).filter(l => l !== OrgLevel.Root).map(l => (
                                                <option key={l} value={l}>{l}</option>
                                            ))}
                                        </select>
                                        <div className="absolute right-3 top-3.5 pointer-events-none text-slate-400">
                                            <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                                        <FontAwesomeIcon icon={faTrophy} className="text-yellow-500" />
                                        <span className="font-semibold text-slate-700">{userProfile.level}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 6) Outreach Automation Card (Full Width) */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                                Outreach Automation
                            </h3>
                        </div>
                        <div className="p-6 md:p-8">
                            <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-100 rounded-xl p-6 mb-6">
                                <div className="flex items-start gap-4">
                                    <div className="bg-green-500 text-white rounded-lg p-3 shadow-sm">
                                        <FontAwesomeIcon icon={faWhatsapp} className="text-2xl" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-green-900 text-lg mb-1">Automated Admin Reporting</h4>
                                        <p className="text-green-800/80 text-sm leading-relaxed max-w-2xl">
                                            Structured daily agendas containing client names and call descriptions are uniquely prepared for your admin account.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col md:flex-row items-end gap-6 max-w-xl">
                                <div className="w-full">
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Report Generation Time</label>
                                    <input
                                        type="time"
                                        className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 text-slate-700 font-semibold cursor-pointer"
                                        value={userProfile.reportGenerationTime || ''}
                                        onChange={handleReportTimeChange}
                                        onClick={(e) => e.currentTarget.showPicker()}
                                    />
                                </div>
                                <div className="w-full md:w-auto">
                                    <button
                                        onClick={handleTestReport}
                                        className="w-full md:w-auto px-6 py-3 bg-white border border-green-200 text-green-700 hover:bg-green-50 font-bold rounded-xl transition-colors shadow-sm whitespace-nowrap"
                                    >
                                        Test WhatsApp Report
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 5) Security & Login Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                                Security & Login
                            </h3>
                            <button
                                onClick={handlePasswordReset}
                                className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors"
                            >
                                Change Password
                            </button>
                        </div>
                        {/* Replaced inline password message with Toast */}
                        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                                <span className="block text-xs font-bold text-slate-400 uppercase mb-1">Password</span>
                                <div className="flex items-center gap-2">
                                    <FontAwesomeIcon icon={faKey} className="text-slate-300" />
                                    <span className="font-semibold text-slate-700">Last changed Never</span>
                                </div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                                <span className="block text-xs font-bold text-slate-400 uppercase mb-1">Last Login</span>
                                <span className="font-semibold text-slate-700 text-sm block">{lastLogin}</span>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 flex items-center justify-between md:flex-col md:items-start md:justify-center md:gap-2 min-[1441px]:!flex-row min-[1441px]:!items-center min-[1441px]:!justify-between min-[1441px]:!gap-0">
                                <span className="block text-xs font-bold text-slate-400 uppercase">Status</span>
                                <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold border border-green-200 whitespace-nowrap inline-flex max-w-full overflow-hidden text-ellipsis items-center gap-1.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                                    ACTIVE
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column (Span 1) */}
                <div className="space-y-8 h-fit">
                    {/* 3) Account Metadata Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                                Account Metadata
                            </h3>
                        </div>
                        <div className="p-6 space-y-5">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-500">Business Tier</span>
                                <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs font-bold">
                                    {userProfile.level}
                                </span>
                            </div>
                            <div className="h-px bg-slate-100"></div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-500">Data Isolation</span>
                                <span className="text-green-600 text-xs font-bold flex items-center gap-1.5">
                                    <FontAwesomeIcon icon={faCheckCircle} /> ENABLED
                                </span>
                            </div>
                            <div className="h-px bg-slate-100"></div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-500">Last Check-in</span>
                                <span className="text-slate-700 text-xs font-bold">{lastLogin}</span>
                            </div>
                        </div>
                    </div>

                    {/* 4) Sign Out Card (Matching Style) */}
                    <div className="bg-white rounded-xl shadow-sm border border-yellow-200 overflow-hidden">
                        <div className="px-6 py-4 border-b border-yellow-100 bg-yellow-50/30">
                            <h3 className="text-xs font-bold text-yellow-600 uppercase tracking-widest flex items-center gap-2">
                                <FontAwesomeIcon icon={faSignOutAlt} /> Session
                            </h3>
                        </div>
                        <div className="p-6">
                            <p className="text-slate-600 text-sm mb-6 leading-relaxed">
                                Securely sign out of your account on this device. You will need to sign in again to access your dashboard.
                            </p>
                            <button
                                onClick={() => setIsSignOutModalOpen(true)}
                                className="w-full bg-yellow-50 hover:bg-yellow-100 text-yellow-700 border border-yellow-200 py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
                            >
                                <FontAwesomeIcon icon={faSignOutAlt} />
                                Sign Out
                            </button>
                        </div>
                    </div>

                    {/* 5) Protected Zone Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
                        <div className="px-6 py-4 border-b border-red-50 bg-red-50/30">
                            <h3 className="text-xs font-bold text-red-600 uppercase tracking-widest flex items-center gap-2">
                                <FontAwesomeIcon icon={faShieldAlt} /> Protected Zone
                            </h3>
                        </div>
                        <div className="p-6">
                            <p className="text-slate-600 text-sm mb-6 leading-relaxed">
                                Permanently delete your account and all related data. This action cannot be undone and you will lose access to your business data immediately.
                            </p>
                            <button
                                onClick={() => setIsDeleteModalOpen(true)}
                                className="w-full bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
                            >
                                <FontAwesomeIcon icon={faTrash} />
                                Delete Account
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Confirmation Modal for Logout */}
            {/* Confirmation Modal for Delete Account */}
            <ConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteAccount}
                title="Delete Account?"
                message="Are you sure you want to permanently delete your account? All your data including clients, tasks, and organization structure will be erased. This action CANNOT be undone."
                confirmText="Delete Permanently"
                isDestructive={true}
            />

            {/* Confirmation Modal for Sign Out */}
            <ConfirmationModal
                isOpen={isSignOutModalOpen}
                onClose={() => setIsSignOutModalOpen(false)}
                onConfirm={handleLogout}
                title="Sign Out"
                message="Are you sure you want to sign out?"
                confirmText="Sign Out"
                isDestructive={false}
            />
        </div>
    );
};

export default Profile;

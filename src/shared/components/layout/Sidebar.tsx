import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faChartLine,
    faCalendarAlt,
    faTasks,
    faUsers,
    faSitemap,
    faBoxesStacked,
    faSignOutAlt,
    faUserCircle
} from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../../../features/auth/context/AuthContext';
import { useData } from '../../context/DataContext';
import { logger } from '../../utils/logger';

const Sidebar: React.FC = () => {
    const { logout } = useAuth();
    const { userProfile } = useData();
    const [isSignOutModalOpen, setIsSignOutModalOpen] = useState(false);

    const handleLogout = async () => {
        try {
            await logout();
        } catch (error) {
            logger.error("Logout failed", error);
        }
    };

    const navItems = [
        { to: '/', icon: faChartLine, label: 'Dashboard' },
        { to: '/calendar', icon: faCalendarAlt, label: 'Calendar' },
        { to: '/tasks', icon: faTasks, label: 'Tasks' },
        { to: '/clients', icon: faUsers, label: 'Follow Ups' },
        { to: '/inventory', icon: faBoxesStacked, label: 'Inventory' },
        { to: '/team', icon: faSitemap, label: 'My Organization' },
    ];

    return (
        <aside className="hidden md:flex flex-col w-64 h-screen bg-white border-r border-slate-200 fixed left-0 top-0 z-50">
            {/* Header / Logo */}
            <div className="p-6 border-b border-slate-100">
                <h1 className="text-2xl font-bold font-mono tracking-tight text-slate-900">
                    BizTrack
                </h1>
                <p className="text-xs font-sans text-slate-500 mt-1">Manage your empire</p>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto font-sans">
                {navItems.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-sm font-medium ${isActive
                                ? 'bg-primary text-white shadow-md shadow-primary/20'
                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                            }`
                        }
                    >
                        <FontAwesomeIcon icon={item.icon} className={`w-5 ${({ isActive }: { isActive: boolean }) => isActive ? 'text-white' : 'text-slate-400'}`} />
                        <span className="">{item.label}</span>
                    </NavLink>
                ))}
            </nav>

            {/* User Profile */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/50">
                <NavLink to="/profile" className="flex items-center gap-3 mb-4 p-2 rounded-lg hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-200 transition-all cursor-pointer group">
                    <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-slate-400 overflow-hidden ring-2 ring-white shadow-sm ${!userProfile.photoURL && !userProfile.avatarColor ? 'bg-slate-200' : ''}`}
                        style={!userProfile.photoURL && userProfile.avatarColor ? { backgroundColor: userProfile.avatarColor, color: 'white' } : {}}
                    >
                        {userProfile.photoURL ? (
                            <img src={userProfile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                            userProfile.name ? <span className="font-bold text-sm">{userProfile.name.charAt(0).toUpperCase()}</span> : <FontAwesomeIcon icon={faUserCircle} className="text-2xl" />
                        )}
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <p className="font-semibold text-sm text-slate-700 truncate group-hover:text-primary transition-colors">{userProfile.name}</p>
                        <p className="text-xs text-slate-500 truncate">{userProfile.level}</p>
                    </div>
                </NavLink>
                <button
                    onClick={() => setIsSignOutModalOpen(true)}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 hover:text-red-500 hover:border-red-200 transition-all text-sm font-medium shadow-sm hover:shadow"
                >
                    <FontAwesomeIcon icon={faSignOutAlt} />
                    <span>Sign Out</span>
                </button>
            </div>

            <ConfirmationModal
                isOpen={isSignOutModalOpen}
                onClose={() => setIsSignOutModalOpen(false)}
                onConfirm={handleLogout}
                title="Sign Out"
                message="Are you sure you want to sign out?"
                confirmText="Sign Out"
                isDestructive={false}
            />
        </aside>
    );
};

export default Sidebar;
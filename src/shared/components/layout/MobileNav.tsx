import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faChartLine,
    faCalendarAlt,
    faTasks,
    faUsers,
    faSitemap,
    faBars,
    faTimes,
    faSignOutAlt,
    faUserCircle
} from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../../../features/auth/context/AuthContext';
import { useData } from '../../context/DataContext';

const MobileNav: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const { logout } = useAuth();
    const { userProfile } = useData();

    const toggleOpen = () => setIsOpen(!isOpen);

    const navItems = [
        { to: '/', icon: faChartLine, label: 'Dashboard' },
        { to: '/calendar', icon: faCalendarAlt, label: 'Calendar' },
        { to: '/tasks', icon: faTasks, label: 'Tasks' },
        { to: '/clients', icon: faUsers, label: 'Follow Ups' },
        { to: '/team', icon: faSitemap, label: 'My Team' },
    ];

    return (
        <>
            {/* Top Bar */}
            <div className="md:hidden flex items-center justify-between p-4 bg-white text-slate-900 border-b border-slate-200 shadow-sm fixed top-0 left-0 w-full z-[60]">
                <h1 className="text-xl font-bold font-mono tracking-tight text-primary">
                    BizTrack
                </h1>
                <button onClick={toggleOpen} className="text-slate-600 focus:outline-none p-2 -mr-2 hover:bg-slate-100 rounded-lg">
                    <FontAwesomeIcon icon={isOpen ? faTimes : faBars} className="text-lg" />
                </button>
            </div>

            {/* Overlay Drawer */}
            {isOpen && (
                <div className="md:hidden fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm" onClick={toggleOpen}>
                    <div
                        className="absolute right-0 top-0 h-full w-64 bg-white shadow-xl p-4 flex flex-col pt-20 border-l border-slate-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <nav className="flex-1 space-y-2 font-sans">
                            {navItems.map((item) => (
                                <NavLink
                                    key={item.to}
                                    to={item.to}
                                    onClick={() => setIsOpen(false)}
                                    className={({ isActive }) =>
                                        `flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium ${isActive
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
                        <div className="mt-auto border-t border-slate-100 pt-4 bg-slate-50/50 -mx-4 px-4 pb-4">
                            <NavLink to="/profile" onClick={() => setIsOpen(false)} className="flex items-center gap-3 mb-4 p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition-all">
                                <FontAwesomeIcon icon={faUserCircle} className="text-3xl text-slate-300" />
                                <div>
                                    <p className="font-semibold text-slate-900 text-sm">{userProfile.name}</p>
                                    <p className="text-xs text-slate-500">{userProfile.level}</p>
                                </div>
                            </NavLink>
                            <button
                                onClick={() => {
                                    logout();
                                    setIsOpen(false);
                                }}
                                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-red-50 hover:text-red-500 hover:border-red-200 shadow-sm transition-colors text-sm font-medium"
                            >
                                <FontAwesomeIcon icon={faSignOutAlt} />
                                <span>Sign Out</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default MobileNav;
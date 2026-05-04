import React, { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';

interface LayoutProps {
    children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const location = useLocation();
    const isCalendar = location.pathname === '/calendar';

    return (
        <div className="min-h-screen bg-background flex font-sans">
            {/* Desktop Sidebar */}
            <Sidebar />

            {/* Mobile Nav */}
            <MobileNav />

            {/* Main Content Area - prevent overflow on tablet */}
            <main className={`
                flex-1 md:ml-64 transition-all duration-300 w-full min-w-0
                pt-20 md:pt-0
                ${isCalendar ? 'p-0 px-0' : 'p-3 md:p-6 lg:p-8'}
            `}>
                <div className="w-full max-w-full mx-auto h-full flex flex-col">
                    {children}
                </div>
            </main>
        </div>
    );
};

export default Layout;

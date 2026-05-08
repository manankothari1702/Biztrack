import React from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus, faTasks, faCalendarAlt, faUsers } from '@fortawesome/free-solid-svg-icons';

const actions = [
    {
        to: '/clients?action=add',
        icon: faUserPlus,
        label: 'Add client',
        primary: true,
    },
    {
        to: '/tasks?action=add',
        icon: faTasks,
        label: 'Add task',
        primary: false,
    },
    {
        to: '/calendar',
        icon: faCalendarAlt,
        label: 'Calendar',
        primary: false,
    },
    {
        to: '/clients',
        icon: faUsers,
        label: 'All clients',
        primary: false,
    },
];

const QuickActions: React.FC = () => {
    return (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4" aria-label="Quick actions">
            {actions.map(({ to, icon, label, primary }) => (
                <Link
                    key={to}
                    to={to}
                    className={`
                        flex flex-col items-center justify-center gap-2 min-h-[88px] md:min-h-[96px] rounded-2xl
                        transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2
                        active:scale-[0.98]
                        ${primary
                            ? 'bg-slate-900 text-white shadow-sm hover:bg-slate-800 focus:ring-slate-400'
                            : 'bg-white border border-slate-200/80 text-slate-700 shadow-sm hover:border-slate-300 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] focus:ring-blue-400'
                        }
                    `}
                >
                    <FontAwesomeIcon icon={icon} className="text-xl md:text-2xl" aria-hidden />
                    <span className="text-sm font-medium">{label}</span>
                </Link>
            ))}
        </section>
    );
};

export default QuickActions;
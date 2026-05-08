import React, { useState } from 'react';
import { OrgLevel } from '../../../shared/types';
import type { OrgNode } from '../../../shared/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faEdit, faTrash, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';

interface OrgNodeComponentProps {
    node: OrgNode;
    onAdd: (parentId: string) => void;
    onEdit: (node: OrgNode) => void;
    onDelete: (id: string) => void;
    isRoot?: boolean;
}

const levelStyles: Record<OrgLevel, string> = {
    [OrgLevel.Root]: 'bg-slate-800 text-white',
    [OrgLevel.Supervisor]: 'bg-green-600 text-white',
    [OrgLevel.WorldTeam]: 'bg-orange-500 text-white',
    [OrgLevel.ActiveWorldTeam]: 'bg-blue-500 text-white',
    [OrgLevel.GET]: 'bg-red-600 text-white',
    [OrgLevel.GET2500]: 'bg-orange-600 text-white',
    [OrgLevel.Millionaire]: 'bg-emerald-700 text-white',
    [OrgLevel.Mill7500]: 'bg-cyan-600 text-white',
    [OrgLevel.President]: 'bg-blue-400 text-white',
    [OrgLevel.Chairman]: 'bg-gray-300 text-slate-800',
    [OrgLevel.Founder]: 'bg-gray-100 text-slate-800',
};

const OrgNodeComponent: React.FC<OrgNodeComponentProps> = ({ node, onAdd, onEdit, onDelete, isRoot = false }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    const headerClass = levelStyles[node.level] || 'bg-slate-700 text-white';

    return (
        <div className="flex flex-col items-center animate-fade-in">
            <div
                className="relative z-10 flex flex-col items-center w-64 bg-white rounded-2xl shadow-md overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 group"
            >
                {/* Colored Header */}
                <div className={`${headerClass} w-full py-4 flex flex-col items-center relative`}>
                    <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-slate-700 text-lg font-bold shadow-md mb-2">
                        {node.name.charAt(0)}
                    </div>
                    <h4 className="font-bold text-base">{node.name}</h4>
                    <p className="text-[10px] uppercase font-bold tracking-widest opacity-90">{node.level}</p>

                    {/* Expand/Collapse Toggle Button (only if has children) */}
                    {node.children.length > 0 && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                            className="absolute -bottom-3 bg-white text-slate-400 rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-sm border border-slate-100 hover:text-blue-600 transition-colors z-20"
                        >
                            <FontAwesomeIcon icon={isExpanded ? faChevronUp : faChevronDown} />
                        </button>
                    )}
                </div>

                {/* Actions Overlay */}
                <div className="flex justify-center gap-4 py-3 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity bg-slate-50 w-full border-t border-slate-100">
                    <button onClick={() => onAdd(node.id)} className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center" title="Add Team Member">
                        <FontAwesomeIcon icon={faPlus} className="text-xs" />
                    </button>
                    <button onClick={() => onEdit(node)} className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-600 hover:text-white transition-all flex items-center justify-center" title="Edit Member">
                        <FontAwesomeIcon icon={faEdit} className="text-xs" />
                    </button>
                    {!isRoot && (
                        <button onClick={() => onDelete(node.id)} className="w-8 h-8 rounded-full bg-red-100 text-red-600 hover:bg-red-600 hover:text-white transition-all flex items-center justify-center" title="Delete Member">
                            <FontAwesomeIcon icon={faTrash} className="text-xs" />
                        </button>
                    )}
                </div>
            </div>

            {/* Tree Lines */}
            {node.children.length > 0 && isExpanded && (
                <>
                    <div className="h-6 w-px bg-slate-300"></div>

                    <div className="flex gap-4 relative items-start pt-4 px-4">
                        {/* Horizontal Connector Line */}
                        {node.children.length > 1 && (
                            <div className="absolute top-0 left-[calc(50%-0.5px)] -translate-x-1/2 h-px bg-slate-300 w-full"></div>
                        )}

                        {/* We need a better structure for pure CSS tree lines logic in flexbox.
                             The common pattern is:
                             Parent
                               |
                             ----------------
                             |      |       |
                            Child  Child   Child

                            In this component recursion, we are rendering:
                            Parent
                            |
                            <Wrapper> -> Draws horizontal line across top
                                <ChildWrapper> -> Draws vertical line from middle top to child
                         */}

                        <div className="flex gap-8">
                            {node.children.map((child, index) => (
                                <div key={child.id} className="flex flex-col items-center relative">
                                    {/* Vertical line up to the horizontal connector */}
                                    <div className="absolute top-[-1rem] h-4 w-px bg-slate-300"></div>

                                    {/* Horizontal extension for first/last children to connect to center */}
                                    {node.children.length > 1 && (
                                        <>
                                            {/* Line to the Right (if not last) */}
                                            {index < node.children.length - 1 && (
                                                <div className="absolute top-[-1rem] left-1/2 w-[calc(50%+1rem)] h-px bg-slate-300"></div>
                                            )}
                                            {/* Line to the Left (if not first) */}
                                            {index > 0 && (
                                                <div className="absolute top-[-1rem] right-1/2 w-[calc(50%+1rem)] h-px bg-slate-300"></div>
                                            )}
                                        </>
                                    )}

                                    <OrgNodeComponent
                                        node={child}
                                        onAdd={onAdd}
                                        onEdit={onEdit}
                                        onDelete={onDelete}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default OrgNodeComponent;
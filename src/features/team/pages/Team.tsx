import React, { useState, useEffect } from 'react';
import { useData } from '../../../shared/context/DataContext';
import { useToast } from '../../../shared/context/ToastContext';
import { OrgLevel } from '../../../shared/types';
import type { OrgNode, FlatOrgNode } from '../../../shared/types';
import OrgNodeComponent from '../components/OrgNodeComponent';
import NodeModal from '../components/NodeModal';
import { BusinessLevelLegend } from '../../../shared/components/common/BusinessLevelLegend';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearchPlus, faSearchMinus } from '@fortawesome/free-solid-svg-icons';
import { logger } from '../../../shared/utils/logger';

import { ConfirmationModal } from '../../../shared/components/common/ConfirmationModal';

const Team: React.FC = () => {
    const { orgTree, userProfile, addOrgNode, updateOrgNode, deleteOrgNode } = useData();
    const { success, error } = useToast();
    const [zoom, setZoom] = useState(1);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingNode, setEditingNode] = useState<OrgNode | null>(null);
    const [parentIdForAdd, setParentIdForAdd] = useState<string | null>(null);

    // Delete confirmation state
    const [deleteNodeId, setDeleteNodeId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Initial Tree Setup if empty
    useEffect(() => {
        if (!orgTree && userProfile.name) {
            // Create root node for the user if tree is empty
            const rootNode: FlatOrgNode = {
                id: 'root',
                name: userProfile.name,
                role: 'You',
                level: userProfile.level || OrgLevel.Root,
                parentId: null,
            };
            addOrgNode(rootNode).catch(err => logger.error(err));
        }
    }, [orgTree, userProfile, addOrgNode]);

    const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.1, 1.5));
    const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.1, 0.5));

    const onAddClick = (parentId: string) => {
        setParentIdForAdd(parentId);
        setEditingNode(null);
        setIsModalOpen(true);
    };

    const onEditClick = (node: OrgNode) => {
        setParentIdForAdd(null);
        setEditingNode(node);
        setIsModalOpen(true);
    };

    const onDeleteClick = (id: string) => {
        // Prevent root deletion
        if (orgTree && id === orgTree.id) return;
        setDeleteNodeId(id);
    };

    const handleConfirmDelete = async () => {
        if (!deleteNodeId) return;

        setIsDeleting(true);
        try {
            // One call — the server deletes the whole subtree (audit B3). No client-side
            // recursion / Promise.all, which orphaned subtrees on a mid-way failure.
            await deleteOrgNode(deleteNodeId);
            success('Node Deleted', 'Team member and subordinates removed.');
        } catch (err) {
            logger.error("Error deleting node:", err);
            error('Delete Failed', "Failed to delete node. Please try again.");
        } finally {
            setIsDeleting(false);
            setDeleteNodeId(null);
        }
    };

    const handleCancelDelete = () => {
        if (isDeleting) return;
        setDeleteNodeId(null);
    };

    const handleSaveNode = async (nodeData: Partial<FlatOrgNode>) => {
        try {
            if (editingNode) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { children, ...flatEditing } = editingNode;
                const updatedNode: FlatOrgNode = { ...flatEditing, ...nodeData };
                await updateOrgNode(updatedNode);
            } else if (parentIdForAdd) {
                const newNode: FlatOrgNode = {
                    id: crypto.randomUUID(),
                    name: nodeData.name!,
                    role: nodeData.role!,
                    level: nodeData.level!,
                    parentId: parentIdForAdd,
                };
                await addOrgNode(newNode);
                success('Member Added', `${newNode.name} added to the team.`);
            }
            setIsModalOpen(false);
        } catch (err) {
            logger.error("Error saving node:", err);
            error('Save Failed', "Failed to save team member. Please try again.");
        }
    };

    if (!orgTree) {
        return (
            <div className="h-full flex items-center justify-center">
                <p className="text-slate-500">Loading Organization...</p>
            </div>
        );
    }

    return (
        <div className="max-w-[1600px] mx-auto w-full h-full flex flex-col animate-fade-in pb-10">
            {/* Header Section */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-6 px-4">
                <div>
                    <h2 className="text-3xl font-black text-slate-900 leading-tight">My Organization</h2>
                    <p className="text-slate-500 text-sm mt-1">Manage your team hierarchy and business levels</p>
                </div>

                {/* Legend */}
                <div className="w-full xl:w-auto">
                    <BusinessLevelLegend />
                </div>
            </div>

            {/* Tree Visualization Area */}
            <div className="flex-1 bg-slate-50 rounded-xl border border-slate-200 overflow-hidden relative shadow-inner mx-4">

                {/* Zoom Controls */}
                <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-white p-2 rounded-lg shadow-sm border border-slate-200">
                    <button onClick={handleZoomOut} className="p-2 text-slate-500 hover:text-blue-600 rounded-full hover:bg-slate-100 transition-colors">
                        <FontAwesomeIcon icon={faSearchMinus} />
                    </button>
                    <span className="text-xs font-bold text-slate-600 w-10 text-center">{Math.round(zoom * 100)}%</span>
                    <button onClick={handleZoomIn} className="p-2 text-slate-500 hover:text-blue-600 rounded-full hover:bg-slate-100 transition-colors">
                        <FontAwesomeIcon icon={faSearchPlus} />
                    </button>
                </div>

                {/* Tree Container */}
                <div className="absolute inset-0 overflow-auto cursor-grab active:cursor-grabbing custom-scrollbar">
                    <div
                        className="min-w-fit min-h-fit p-20 flex justify-center origin-top transition-transform duration-200"
                        style={{ transform: `scale(${zoom})` }}
                    >
                        <OrgNodeComponent
                            node={orgTree}
                            onAdd={onAddClick}
                            onEdit={onEditClick}
                            onDelete={onDeleteClick}
                            isRoot={true}
                        />
                    </div>
                </div>
            </div>

            <NodeModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveNode}
                initialNode={editingNode}
            />

            <ConfirmationModal
                isOpen={!!deleteNodeId}
                onClose={handleCancelDelete}
                onConfirm={handleConfirmDelete}
                title="Delete Node"
                message="Are you sure you want to delete this node and all its child nodes?"
                confirmText="Delete"
                isDestructive={true}
                isLoading={isDeleting}
            />
        </div>
    );
};

export default Team;
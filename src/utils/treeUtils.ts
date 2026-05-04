import type { FlatOrgNode, OrgNode } from '../types';
import { logger } from './logger';

export const buildOrgTree = (nodes: FlatOrgNode[]): OrgNode | null => {
    if (!nodes || nodes.length === 0) return null;

    // Create a map for constant time lookup
    const nodeMap = new Map<string, OrgNode>();

    // Initialize map and clear children to ensure fresh reconstruction
    nodes.forEach(node => {
        // Create a shallow copy to avoid mutating original immutable state objects if they come from strict stores
        nodeMap.set(node.id, { ...node, children: [] });
    });

    let rootDetails: OrgNode | null = null;

    // Build the tree
    nodeMap.forEach(node => {
        if (!node.parentId) {
            // This is a potential root. 
            // In our schema, the top-level user might have parentId = 'root' or null.
            // If there are multiple matching this (which shouldn't happen for a single user's org view ideally), 
            // we'll take the first one or logic specific to identifying the "Me" node.
            if (!rootDetails) {
                rootDetails = node;
            }
        } else {
            const parent = nodeMap.get(node.parentId);
            if (parent) {
                parent.children.push(node);
            } else {
                // Orphaned node or parent not in list
                logger.warn(`Orphaned node found: ${node.name} (${node.id}) with parentId: ${node.parentId}`);
            }
        }
    });

    return rootDetails;
};

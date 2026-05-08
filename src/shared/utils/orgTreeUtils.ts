import type { OrgNode } from '../types';

export const findNode = (root: OrgNode, id: string): OrgNode | null => {
    if (root.id === id) return root;
    for (const child of root.children) {
        const found = findNode(child, id);
        if (found) return found;
    }
    return null;
};

// Returns a NEW tree with the node added
export const addNodeToTree = (root: OrgNode, parentId: string, newNode: OrgNode): OrgNode => {
    if (root.id === parentId) {
        return { ...root, children: [...root.children, newNode] };
    }
    return {
        ...root,
        children: root.children.map(child => addNodeToTree(child, parentId, newNode))
    };
};

// Returns a NEW tree with the node updated
export const updateNodeInTree = (root: OrgNode, updatedNode: OrgNode): OrgNode => {
    if (root.id === updatedNode.id) {
        // Keep children, update other props.
        // Assuming updatedNode comes with empty children or we want to preserve existing children structure?
        // Logic: The modal probably returns a node without knowing its children.
        // So we should merge.
        return { ...root, ...updatedNode, children: root.children };
    }
    return {
        ...root,
        children: root.children.map(child => updateNodeInTree(child, updatedNode))
    };
};

// Returns a NEW tree with the node deleted
export const deleteNodeFromTree = (root: OrgNode, nodeId: string): OrgNode => {
    return {
        ...root,
        children: root.children
            .filter(child => child.id !== nodeId)
            .map(child => deleteNodeFromTree(child, nodeId))
    };
};
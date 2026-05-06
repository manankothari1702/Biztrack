import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import LoadingScreen from '../components/common/LoadingScreen';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { logger } from '../utils/logger';
import { OrgLevel } from '../types';
import type { OrgNode, FlatOrgNode, User } from '../types';
import { userApi, ApiError } from '../services/apiService';
import { buildOrgTree } from '../utils/treeUtils';

interface DataContextType {
    orgTree: OrgNode | null;
    userProfile: User;
    loading: boolean;
    needsProfileSetup: boolean;
    completeProfileSetup: (name: string, email: string) => Promise<void>;
    updateUserProfile: (user: User, skipSync?: boolean) => Promise<void>;
    addOrgNode: (node: FlatOrgNode) => Promise<void>;
    updateOrgNode: (node: FlatOrgNode, skipSync?: boolean) => Promise<void>;
    deleteOrgNode: (nodeId: string) => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

const defaultUser: User = {
    name: '',
    email: '',
    level: OrgLevel.Supervisor,
};

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { currentUser } = useAuth();
    const toast = useToast();
    const toastRef = useRef(toast);
    const [loading, setLoading] = useState(true);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        toastRef.current = toast;
    }, [toast]);

    const [orgNodes, setOrgNodes] = useState<FlatOrgNode[]>([]);
    const [userProfile, setUserProfile] = useState<User>(defaultUser);
    const [needsProfileSetup, setNeedsProfileSetup] = useState(false);

    const orgTree = useMemo(() => buildOrgTree(orgNodes), [orgNodes]);

    const fetchAll = useCallback(async (retries = 2) => {
        try {
            const [profile, { orgNodes: nodes }] = await Promise.all([
                userApi.getProfile(),
                userApi.getOrgNodes(),
            ]);
            setUserProfile(profile);
            setOrgNodes(nodes);
            setNeedsProfileSetup(false);
        } catch (err) {
            if (err instanceof ApiError && err.status === 404) {
                // New Google user — no profile in DynamoDB yet
                setNeedsProfileSetup(true);
                setOrgNodes([]);
            } else if (retries > 0) {
                // Token may not be ready yet right after OAuth redirect — retry after short delay
                await new Promise(r => setTimeout(r, 1500));
                return fetchAll(retries - 1);
            } else {
                logger.error('Failed to fetch user data:', err);
                toastRef.current.error('Sync Error', 'Unable to sync profile. Please refresh the page.');
            }
        }
    }, []);

    useEffect(() => {
        if (!currentUser) {
            setOrgNodes([]);
            setUserProfile(defaultUser);
            setLoading(false);
            if (pollingRef.current) clearInterval(pollingRef.current);
            return;
        }

        setLoading(true);
        fetchAll().finally(() => setLoading(false));

        // Poll every 30 seconds for updates
        pollingRef.current = setInterval(fetchAll, 30_000);

        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, [currentUser, fetchAll]);

    const completeProfileSetup = useCallback(async (name: string, email: string) => {
        const newProfile: User = { ...defaultUser, name, email, level: OrgLevel.Supervisor };
        const created = await userApi.updateProfile(newProfile);
        setUserProfile(created);
        setNeedsProfileSetup(false);
    }, []);

    const updateUserProfile = useCallback(async (user: User, skipSync: boolean = false) => {
        if (!currentUser) throw new Error('User not authenticated');
        try {
            const updated = await userApi.updateProfile(user);
            setUserProfile(updated);

            if (!skipSync) {
                const rootNode = orgNodes.find(n => n.id === 'root' || n.level === OrgLevel.Root);
                if (rootNode && (rootNode.name !== user.name || rootNode.level !== user.level)) {
                    const updatedFlatNode: FlatOrgNode = { ...rootNode, name: user.name, level: user.level };
                    await userApi.updateOrgNode(updatedFlatNode);
                    setOrgNodes(prev => prev.map(n => n.id === rootNode.id ? updatedFlatNode : n));
                }
            }
        } catch (error) {
            logger.error('Error updating user profile:', error);
            throw error;
        }
    }, [currentUser, orgNodes]);

    const addOrgNode = useCallback(async (node: FlatOrgNode) => {
        if (!currentUser) throw new Error('User not authenticated');
        try {
            const added = await userApi.addOrgNode(node);
            setOrgNodes(prev => [...prev, added]);
        } catch (error) {
            logger.error('Error adding org node:', error);
            throw error;
        }
    }, [currentUser]);

    const updateOrgNode = useCallback(async (node: FlatOrgNode, skipSync: boolean = false) => {
        if (!currentUser) throw new Error('User not authenticated');
        try {
            const updated = await userApi.updateOrgNode(node);
            setOrgNodes(prev => prev.map(n => n.id === node.id ? updated : n));

            if (!skipSync && node.id === 'root') {
                const hasChanged = node.name !== userProfile.name || node.level !== userProfile.level;
                if (hasChanged) {
                    const updatedProfile: User = { ...userProfile, name: node.name, level: node.level };
                    await userApi.updateProfile(updatedProfile);
                    setUserProfile(updatedProfile);
                }
            }
        } catch (error) {
            logger.error('Error updating org node:', error);
            throw error;
        }
    }, [currentUser, userProfile]);

    const deleteOrgNode = useCallback(async (nodeId: string) => {
        if (!currentUser) throw new Error('User not authenticated');
        try {
            await userApi.deleteOrgNode(nodeId);
            setOrgNodes(prev => prev.filter(n => n.id !== nodeId));
        } catch (error) {
            logger.error('Error deleting org node:', error);
            throw error;
        }
    }, [currentUser]);

    return (
        <DataContext.Provider
            value={{
                orgTree,
                userProfile,
                loading,
                needsProfileSetup,
                completeProfileSetup,
                updateUserProfile,
                addOrgNode,
                updateOrgNode,
                deleteOrgNode
            }}
        >
            {loading && !needsProfileSetup ? <LoadingScreen /> : children}
        </DataContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useData = () => {
    const context = useContext(DataContext);
    if (!context) throw new Error('useData must be used within a DataProvider');
    return context;
};

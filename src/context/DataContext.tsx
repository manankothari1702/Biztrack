import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import LoadingScreen from '../components/common/LoadingScreen';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { logger } from '../utils/logger';
import { OrgLevel } from '../types';
import type { OrgNode, FlatOrgNode, User } from '../types';
import { db } from '../lib/firebase';
import {
    collection,
    doc,
    setDoc,
    deleteDoc,
    onSnapshot,
    query,
    type FirestoreError
} from 'firebase/firestore';
import { buildOrgTree } from '../utils/treeUtils';

// DataContext owns only user profile and org tree.
// Client and task data is managed by useClients(), useTasks(),
// useDashboardData(), and useCalendarData() hooks.
interface DataContextType {
    orgTree: OrgNode | null;
    userProfile: User;
    loading: boolean;
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

    // Keep toast ref current for use in subscription error callbacks
    useEffect(() => {
        toastRef.current = toast;
    }, [toast]);

    // Data States
    const [orgNodes, setOrgNodes] = useState<FlatOrgNode[]>([]);
    const [userProfile, setUserProfile] = useState<User>(defaultUser);

    // Derived State
    const orgTree = useMemo(() => buildOrgTree(orgNodes), [orgNodes]);

    // Subscriptions
    useEffect(() => {
        if (!currentUser) {
            setOrgNodes([]);
            setUserProfile(defaultUser);
            setLoading(false);
            return;
        }

        setLoading(true);
        const uid = currentUser.uid;

        // Helper for error callbacks
        const handleSubscriptionError = (collectionName: string) => (error: FirestoreError) => {
            logger.error(`${collectionName} subscription error:`, {
                collection: collectionName,
                userId: uid,
                code: error.code,
                message: error.message
            });
            toastRef.current.error('Sync Error', `Unable to sync ${collectionName.toLowerCase()}. Please refresh the page.`);
        };

        const userDocRef = doc(db, 'users', uid);
        const orgNodesRef = collection(db, 'users', uid, 'orgNodes');

        // 1. User Profile Listener
        const unsubProfile = onSnapshot(
            userDocRef,
            (docSnap) => {
                if (docSnap.exists()) {
                    setUserProfile(docSnap.data() as User);
                } else {
                    // Profile doesn't exist (e.g. deleted or not yet created)
                    // Do NOT auto-create here as it interferes with account deletion
                    setUserProfile(defaultUser);
                }
            },
            handleSubscriptionError('Profile')
        );

        // Org Nodes Listener
        const unsubOrg = onSnapshot(
            query(orgNodesRef),
            (snapshot) => {
                const loadedNodes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FlatOrgNode));
                setOrgNodes(loadedNodes);
                setLoading(false);
            },
            (error: FirestoreError) => {
                handleSubscriptionError('Organization')(error);
                setLoading(false); // Prevent infinite loading state on error
            }
        );

        return () => {
            unsubProfile();
            unsubOrg();
        };
    }, [currentUser]);

    // Profile
    const updateUserProfile = useCallback(async (user: User, skipSync: boolean = false) => {
        if (!currentUser) {
            throw new Error('User not authenticated');
        }
        try {
            await setDoc(doc(db, 'users', currentUser.uid), user, { merge: true });

            // Also update the root node of the org tree if it exists and matches
            if (!skipSync) {
                const rootNode = orgNodes.find(n => n.id === 'root' || n.level === OrgLevel.Root);
                if (rootNode && (rootNode.name !== user.name || rootNode.level !== user.level)) {
                    const updatedFlatNode: FlatOrgNode = { ...rootNode, name: user.name, level: user.level };
                    await setDoc(doc(db, 'users', currentUser.uid, 'orgNodes', rootNode.id), updatedFlatNode, { merge: true });
                }
            }
        } catch (error) {
            logger.error("Error updating user profile:", error);
            throw error;
        }
    }, [currentUser, orgNodes]);

    // Org Tree - granular updates
    const addOrgNode = useCallback(async (node: FlatOrgNode) => {
        if (!currentUser) {
            throw new Error('User not authenticated');
        }
        try {
            await setDoc(doc(db, 'users', currentUser.uid, 'orgNodes', node.id), node);
        } catch (error) {
            logger.error("Error adding org node:", error);
            throw error;
        }
    }, [currentUser]);

    const updateOrgNode = useCallback(async (node: FlatOrgNode, skipSync: boolean = false) => {
        if (!currentUser) {
            throw new Error('User not authenticated');
        }
        try {
            await setDoc(doc(db, 'users', currentUser.uid, 'orgNodes', node.id), node, { merge: true });

            // Sync to User Profile if Root Node (direct setDoc to avoid circular dependency)
            if (!skipSync && node.id === 'root') {
                const hasChanged = node.name !== userProfile.name || node.level !== userProfile.level;
                if (hasChanged) {
                    const updatedProfile: User = {
                        ...userProfile,
                        name: node.name,
                        level: node.level
                    };
                    await setDoc(doc(db, 'users', currentUser.uid), updatedProfile, { merge: true });
                }
            }
        } catch (error) {
            logger.error("Error updating org node:", error);
            throw error;
        }
    }, [currentUser, userProfile]);

    const deleteOrgNode = useCallback(async (nodeId: string) => {
        if (!currentUser) {
            throw new Error('User not authenticated');
        }
        try {
            await deleteDoc(doc(db, 'users', currentUser.uid, 'orgNodes', nodeId));
        } catch (error) {
            logger.error("Error deleting org node:", error);
            throw error;
        }
    }, [currentUser]);


    return (
        <DataContext.Provider
            value={{
                orgTree,
                userProfile,
                loading,
                updateUserProfile,
                addOrgNode,
                updateOrgNode,
                deleteOrgNode
            }}
        >
            {loading ? <LoadingScreen /> : children}
        </DataContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useData = () => {
    const context = useContext(DataContext);
    if (!context) {
        throw new Error('useData must be used within a DataProvider');
    }
    return context;
};

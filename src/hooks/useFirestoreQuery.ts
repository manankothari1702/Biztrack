import { useState, useEffect, useCallback, useRef } from 'react';
import {
    collection,
    query,
    onSnapshot,
    limit,
    startAfter,
    getDocs,
    QueryConstraint,
    type DocumentData,
    QueryDocumentSnapshot,
    type Unsubscribe
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { queryCache } from '../utils/cache';
import { logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface UseFirestoreQueryResult<T> {
    data: T[];
    loading: boolean;
    error: Error | null;
    hasMore: boolean;
    loadMore: () => Promise<void>;
    refresh: () => void;
}

/**
 * Real-time Firestore query hook with pagination support.
 * Uses onSnapshot for reactive updates - data automatically updates when Firestore changes.
 * 
 * @param collectionPath - Sub-collection path under users/{uid}/ (e.g., 'clients', 'tasks')
 * @param constraints - Firestore query constraints (where, orderBy, etc.)
 * @param pageSize - Number of documents per page
 * @param dependencies - Array of values that should trigger query re-execution
 */
export function useFirestoreQuery<T extends { id: string }>(
    collectionPath: string,
    constraints: QueryConstraint[] = [],
    pageSize: number = 50,
    dependencies: unknown[] = []
): UseFirestoreQueryResult<T> {
    const { currentUser } = useAuth();
    const { error: showError } = useToast();

    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [hasMore, setHasMore] = useState(true);

    // Track loaded pages for pagination
    const loadedPagesRef = useRef<number>(1);
    const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
    const unsubscribeRef = useRef<Unsubscribe | null>(null);

    // Subscription setup
    useEffect(() => {
        if (!currentUser) {
            setData([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        loadedPagesRef.current = 1;
        lastDocRef.current = null;

        const fullPath = `users/${currentUser.uid}/${collectionPath}`;
        const colRef = collection(db, fullPath);

        // Initial query with first page limit
        const q = query(colRef, ...constraints, limit(pageSize));

        // Set up real-time listener
        unsubscribeRef.current = onSnapshot(
            q,
            (snapshot) => {
                const results = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                } as T));

                setData(results);
                setHasMore(snapshot.docs.length === pageSize);

                // Track last doc for pagination
                if (snapshot.docs.length > 0) {
                    lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
                }

                setLoading(false);
                setError(null);

                // Update cache for offline support
                const cacheKey = queryCache.generateKey(collectionPath, currentUser.uid, {
                    constraints: dependencies,
                    page: 'first'
                });
                queryCache.set(cacheKey, results, currentUser.uid).catch(() => {
                    // Ignore cache errors
                });
            },
            (err) => {
                logger.error("Firestore subscription error:", err);
                setError(err);
                showError("Failed to load data. Please try again.");
                setLoading(false);
            }
        );

        // Cleanup subscription on unmount or dependency change
        return () => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser, collectionPath, pageSize, ...dependencies]);

    // Load more pages (fetch-based, not subscription-based for simplicity)
    const loadMore = useCallback(async () => {
        if (!currentUser || !hasMore || loading || !lastDocRef.current) return;

        try {
            setLoading(true);

            const fullPath = `users/${currentUser.uid}/${collectionPath}`;
            const colRef = collection(db, fullPath);

            // Query for next page starting after last document
            const q = query(
                colRef,
                ...constraints,
                startAfter(lastDocRef.current),
                limit(pageSize)
            );

            const snapshot = await getDocs(q);
            const newResults = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as T));

            // Append to existing data
            setData(prev => [...prev, ...newResults]);
            setHasMore(snapshot.docs.length === pageSize);

            if (snapshot.docs.length > 0) {
                lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
                loadedPagesRef.current += 1;
            }

        } catch (err) {
            logger.error("Firestore loadMore error:", err);
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, [currentUser, collectionPath, constraints, pageSize, hasMore, loading]);

    // Refresh triggers re-subscription by changing a dependency
    const refresh = useCallback(() => {
        // Force re-subscribe by resetting state
        // The subscription will automatically get latest data
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
        }
        setLoading(true);
        loadedPagesRef.current = 1;
        lastDocRef.current = null;

        // Re-establish subscription
        if (!currentUser) return;

        const fullPath = `users/${currentUser.uid}/${collectionPath}`;
        const colRef = collection(db, fullPath);
        const q = query(colRef, ...constraints, limit(pageSize * loadedPagesRef.current));

        unsubscribeRef.current = onSnapshot(
            q,
            (snapshot) => {
                const results = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                } as T));

                setData(results);
                setHasMore(snapshot.docs.length >= pageSize);

                if (snapshot.docs.length > 0) {
                    lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];
                }

                setLoading(false);
                setError(null);
            },
            (err) => {
                logger.error("Firestore refresh error:", err);
                setError(err);
                setLoading(false);
            }
        );
    }, [currentUser, collectionPath, constraints, pageSize]);

    return { data, loading, error, hasMore, loadMore, refresh };
}

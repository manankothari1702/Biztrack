import {
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    writeBatch,
    type UpdateData,
    type DocumentData
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Task, Client, FlatOrgNode } from '../types';
import { logger } from '../utils/logger';

// Firestore hard limit is 500 writes per batch — stay safely under it
const BATCH_SIZE = 499;

/**
 * Commits an array of steps in sequence. If any step fails, runs the
 * corresponding compensation for every previously committed step in reverse
 * order, then re-throws the original error.
 *
 * This gives best-effort atomicity across multiple Firestore batches.
 * Compensation failures are logged but do not suppress the original error.
 */
async function commitInOrder(
    steps: Array<{ commit: () => Promise<void>; compensate: () => Promise<void> }>
): Promise<void> {
    const compensations: Array<() => Promise<void>> = [];

    for (const step of steps) {
        try {
            await step.commit();
            compensations.unshift(step.compensate); // prepend → reverse order
        } catch (err) {
            for (const compensate of compensations) {
                try { await compensate(); }
                catch (rbErr) { logger.error('Compensation step failed:', rbErr); }
            }
            throw err;
        }
    }
}

export const firebaseService = {
    // --- Tasks ---
    async addTask(userId: string, task: Task): Promise<void> {
        try {
            const taskRef = doc(db, 'users', userId, 'tasks', task.id);
            await setDoc(taskRef, task);
        } catch (error) {
            logger.error('Error adding task:', error);
            throw error;
        }
    },

    async updateTask(userId: string, task: Task): Promise<void> {
        try {
            const taskRef = doc(db, 'users', userId, 'tasks', task.id);
            await setDoc(taskRef, task, { merge: true });
        } catch (error) {
            logger.error('Error updating task:', error);
            throw error;
        }
    },

    async deleteTask(userId: string, taskId: string): Promise<void> {
        try {
            await deleteDoc(doc(db, 'users', userId, 'tasks', taskId));
        } catch (error) {
            logger.error('Error deleting task:', error);
            throw error;
        }
    },

    // --- Clients ---
    async addClient(userId: string, client: Client): Promise<void> {
        try {
            const clientRef = doc(db, 'users', userId, 'clients', client.id);

            // Prepare Search Fields
            const clientNameLower = client.clientName.toLowerCase();
            // Use phoneNumber (local part) to avoid country code prefix issues
            const phoneSource = client.phoneNumber || client.mobile || '';
            const mobileDigits = phoneSource.replace(/\D/g, '');
            const mobileReverse = mobileDigits.split('').reverse().join('');

            const clientWithSearch = {
                ...client,
                clientNameLower,
                mobileDigits,
                mobileReverse
            };
            await setDoc(clientRef, clientWithSearch);
        } catch (error) {
            logger.error('Error adding client:', error);
            throw error;
        }
    },

    async updateClient(userId: string, client: Client): Promise<void> {
        try {
            const clientRef = doc(db, 'users', userId, 'clients', client.id);
            const updates = { ...client };

            // Update Search Fields
            if (client.clientName) {
                updates.clientNameLower = client.clientName.toLowerCase();
            }
            // Use phoneNumber (local part) to avoid country code prefix issues
            const phoneSource = client.phoneNumber || client.mobile;
            if (phoneSource) {
                const digits = phoneSource.replace(/\D/g, '');
                updates.mobileDigits = digits;
                updates.mobileReverse = digits.split('').reverse().join('');
            }

            await setDoc(clientRef, updates, { merge: true });
        } catch (error) {
            logger.error('Error updating client:', error);
            throw error;
        }
    },

    async deleteClient(userId: string, clientId: string): Promise<void> {
        try {
            await deleteDoc(doc(db, 'users', userId, 'clients', clientId));
        } catch (error) {
            logger.error('Error deleting client:', error);
            throw error;
        }
    },

    async bulkDeleteClients(userId: string, clientIds: string[]): Promise<void> {
        // Pre-read all documents so we can restore them if a later batch fails
        const snapshots = await Promise.all(
            clientIds.map(id => getDoc(doc(db, 'users', userId, 'clients', id)))
        );
        const originals = snapshots
            .filter(s => s.exists())
            .map(s => ({ id: s.id, data: s.data() as DocumentData }));

        const chunks: string[][] = [];
        for (let i = 0; i < clientIds.length; i += BATCH_SIZE) {
            chunks.push(clientIds.slice(i, i + BATCH_SIZE));
        }

        const steps = chunks.map((chunk, chunkIndex) => ({
            commit: async () => {
                const batch = writeBatch(db);
                chunk.forEach(id => batch.delete(doc(db, 'users', userId, 'clients', id)));
                await batch.commit();
            },
            compensate: async () => {
                // Restore only the documents that belonged to this chunk
                const chunkSet = new Set(chunk);
                const toRestore = originals.filter(o => chunkSet.has(o.id));
                if (toRestore.length === 0) return;
                const batch = writeBatch(db);
                toRestore.forEach(({ id, data }) =>
                    batch.set(doc(db, 'users', userId, 'clients', id), data)
                );
                await batch.commit();
                logger.warn(`bulkDeleteClients: restored ${toRestore.length} docs from chunk ${chunkIndex + 1} after failure`);
            }
        }));

        try {
            await commitInOrder(steps);
        } catch (error) {
            logger.error('bulkDeleteClients failed — affected rows have been restored:', error);
            throw error;
        }
    },

    async bulkAddClients(userId: string, clients: Client[]): Promise<void> {
        // Assign IDs up front so compensation can delete exactly what was added
        const prepared = clients.map(client => {
            const clientId = client.id || crypto.randomUUID();
            const phoneSource = client.phoneNumber || client.mobile || '';
            const mobileDigits = phoneSource.replace(/\D/g, '');
            return {
                ...client,
                id: clientId,
                clientNameLower: client.clientName ? client.clientName.toLowerCase() : '',
                mobileDigits,
                mobileReverse: mobileDigits.split('').reverse().join(''),
            };
        });

        const chunks: typeof prepared[] = [];
        for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
            chunks.push(prepared.slice(i, i + BATCH_SIZE));
        }

        const steps = chunks.map((chunk, chunkIndex) => ({
            commit: async () => {
                const batch = writeBatch(db);
                chunk.forEach(client =>
                    batch.set(doc(db, 'users', userId, 'clients', client.id), client, { merge: true })
                );
                await batch.commit();
            },
            compensate: async () => {
                // Delete every document this chunk added
                const batch = writeBatch(db);
                chunk.forEach(client =>
                    batch.delete(doc(db, 'users', userId, 'clients', client.id))
                );
                await batch.commit();
                logger.warn(`bulkAddClients: removed ${chunk.length} docs from chunk ${chunkIndex + 1} after failure`);
            }
        }));

        try {
            await commitInOrder(steps);
        } catch (error) {
            logger.error('bulkAddClients failed — successfully added records have been removed:', error);
            throw error;
        }
    },

    async bulkUpdateClients(userId: string, ids: string[], updates: Partial<Client>): Promise<void> {
        // Pre-read originals so we can restore the exact previous values on failure
        const snapshots = await Promise.all(
            ids.map(id => getDoc(doc(db, 'users', userId, 'clients', id)))
        );
        const originals = snapshots
            .filter(s => s.exists())
            .map(s => ({ id: s.id, data: s.data() as DocumentData }));

        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            chunks.push(ids.slice(i, i + BATCH_SIZE));
        }

        const steps = chunks.map((chunk, chunkIndex) => ({
            commit: async () => {
                const batch = writeBatch(db);
                chunk.forEach(id => {
                    batch.update(doc(db, 'users', userId, 'clients', id), updates as UpdateData<Client>);
                });
                await batch.commit();
            },
            compensate: async () => {
                const chunkSet = new Set(chunk);
                const toRestore = originals.filter(o => chunkSet.has(o.id));
                if (toRestore.length === 0) return;
                const batch = writeBatch(db);
                toRestore.forEach(({ id, data }) =>
                    batch.set(doc(db, 'users', userId, 'clients', id), data)
                );
                await batch.commit();
                logger.warn(`bulkUpdateClients: restored ${toRestore.length} docs from chunk ${chunkIndex + 1} after failure`);
            }
        }));

        try {
            await commitInOrder(steps);
        } catch (error) {
            logger.error('bulkUpdateClients failed — affected rows have been restored:', error);
            throw error;
        }
    },

    // --- Org Nodes ---
    async addOrgNode(userId: string, node: FlatOrgNode): Promise<void> {
        try {
            await setDoc(doc(db, 'users', userId, 'orgNodes', node.id), node);
        } catch (error) {
            logger.error('Error adding org node:', error);
            throw error;
        }
    },

    async updateOrgNode(userId: string, node: FlatOrgNode): Promise<void> {
        try {
            await setDoc(doc(db, 'users', userId, 'orgNodes', node.id), node, { merge: true });
        } catch (error) {
            logger.error('Error updating org node:', error);
            throw error;
        }
    },

    async deleteOrgNode(userId: string, nodeId: string): Promise<void> {
        try {
            await deleteDoc(doc(db, 'users', userId, 'orgNodes', nodeId));
        } catch (error) {
            logger.error('Error deleting org node:', error);
            throw error;
        }
    }
};

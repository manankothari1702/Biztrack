
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Client } from '../types';
import { logger } from '../utils/logger';

// V3: Force recalculate mobileDigits using phoneNumber (local number without country code)
const MIGRATION_KEY = 'biztrack_migration_v3_phone_local';

// Firestore hard limit is 500 writes per batch — stay safely under it
const BATCH_SIZE = 499;

export const runDataMigration = async (userId: string): Promise<void> => {
    if (localStorage.getItem(MIGRATION_KEY) === 'done') return;

    logger.info('Starting client search index migration (v3)...');

    const clientsRef = collection(db, 'users', userId, 'clients');
    const snapshot = await getDocs(clientsRef);

    // Build the full list of updates needed before touching Firestore
    const updates: Array<{ id: string; fields: Record<string, string> }> = [];

    snapshot.docs.forEach(docSnap => {
        const client = docSnap.data() as Client;
        const fields: Record<string, string> = {};

        if (!client.clientNameLower && client.clientName) {
            fields.clientNameLower = client.clientName.toLowerCase();
        }

        const phoneSource = client.phoneNumber || client.mobile;
        if (phoneSource) {
            const correctDigits = phoneSource.replace(/\D/g, '');
            if (!client.mobileDigits || client.mobileDigits !== correctDigits) {
                fields.mobileDigits = correctDigits;
                fields.mobileReverse = correctDigits.split('').reverse().join('');
            }
        }

        if (Object.keys(fields).length > 0) {
            updates.push({ id: docSnap.id, fields });
        }
    });

    if (updates.length === 0) {
        logger.info('Migration complete: No clients needed update.');
        localStorage.setItem(MIGRATION_KEY, 'done');
        return;
    }

    // Commit in chunks — each chunk is atomic; if any chunk throws, we stop
    // and do NOT mark migration as done so it retries cleanly on next load.
    const totalChunks = Math.ceil(updates.length / BATCH_SIZE);

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const chunk = updates.slice(i, i + BATCH_SIZE);
        const chunkIndex = Math.floor(i / BATCH_SIZE) + 1;

        const batch = writeBatch(db);
        chunk.forEach(({ id, fields }) => {
            batch.update(doc(db, 'users', userId, 'clients', id), fields);
        });

        // Let errors propagate — caller is responsible for surfacing them to the user.
        // Do not catch here: a failed commit leaves localStorage unset so the next
        // app load retries from scratch (migration is idempotent).
        await batch.commit();
        logger.info(`Migration chunk ${chunkIndex}/${totalChunks} committed (${chunk.length} clients).`);
    }

    localStorage.setItem(MIGRATION_KEY, 'done');
    logger.info(`Migration complete: Updated ${updates.length} clients across ${totalChunks} batch(es).`);
};

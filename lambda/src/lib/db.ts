import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

export const db = DynamoDBDocumentClient.from(client, {
    marshallOptions:   { removeUndefinedValues: true },
    unmarshallOptions: { wrapNumbers: false },
});

export const TABLE = process.env.TABLE_NAME ?? 'biztrack';

// Invoice numbering counters — one per user per document type.
export type CounterType = 'SALE' | 'PURCHASE';

/**
 * Resolve a record id that arrived in a request body.
 *
 * NEVER build a key straight from `body.id`. When it was absent the key became
 * the literal `CLIENT#undefined`, the write was a bare Put, and because every
 * such request landed on that SAME key a second one silently overwrote the
 * first — two different clients collapsing into one row, 201 both times, with
 * no soft delete and no audit trail to recover from (FU-EOS-13). In the bulk
 * path it was worse: a whole import of id-less rows collapsed onto one key.
 *
 * Generating server-side rather than rejecting keeps the caller working and
 * matches the guard `products.ts` has always had, so this is the codebase's
 * existing convention rather than a new one. A caller that does send an id
 * keeps it, which is what preserves retry idempotency: replaying a create
 * rewrites the same row instead of producing a duplicate.
 */
export const safeId = (v: unknown): string =>
    typeof v === 'string' && v.trim() ? v.trim() : randomUUID();

// Key helpers — single-table design
export const keys = {
    profile:  (uid: string) => ({ PK: `USER#${uid}`, SK: 'PROFILE' }),
    client:   (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `CLIENT#${id}` }),
    task:     (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `TASK#${id}` }),
    orgNode:  (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `ORG#${id}` }),

    // ── Inventory & invoicing ───────────────────────────────────────────────

    product:  (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `PRODUCT#${id}` }),

    // Expiry is IN the key, so a same-expiry restock is a single atomic
    // `UpdateItem … ADD quantity :q` and a new expiry is simply a new item.
    // List one product's batches with begins_with(SK, `BATCH#${productId}#`).
    batch:    (uid: string, productId: string, expiry: string) =>
                ({ PK: `USER#${uid}`, SK: `BATCH#${productId}#${expiry}` }),

    // createdAt leads the suffix so ScanIndexForward:false yields newest-first.
    stockMove:(uid: string, createdAt: string, id: string) =>
                ({ PK: `USER#${uid}`, SK: `STOCKMOVE#${createdAt}#${id}` }),

    // The client-generated id is the WHOLE suffix — that is what makes point
    // reads (get/finalize/cancel/delete by id) and the duplicate-submit guard
    // `attribute_not_exists(PK)` work. Chronological ordering comes from
    // GSI6-InventoryDate (invDate = createdAt), not from this sort key.
    invoice:  (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `INVOICE#${id}` }),

    counter:  (uid: string, type: CounterType) =>
                ({ PK: `USER#${uid}`, SK: `COUNTER#${type}` }),
};
